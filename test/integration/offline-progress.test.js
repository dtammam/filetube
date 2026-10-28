'use strict';

// [INTEGRATION] v1.387.0 offline playback, plan D4 (W3) - the offline position sync,
// POST /api/offline/progress, against the REAL server, stores and coalescer buffers.
// The data-loss surface of this release: an offline event must NEVER overwrite a
// newer online position - in the stored row, in the LIVE buffer, and in the gap
// between a flush's snapshot and its commit, in both orders, for both buffered kinds
// (media, music); a newer offline rewind wins; a phone a year ahead, a year behind, five
// minutes ahead; a replay is a no-op; a hidden item (restriction kinds that DIVERGE)
// refuses with nothing written; the latches are set like the online path's and never
// cleared; no presence is announced; stamps are ISO moments; the Feed's stale rule
// sees the write; a mixed batch keeps its order; the same through a device token.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-offline-progress-'));
process.env.PROGRESS_FLUSH_MS = '600000'; // flushes are driven by hand below, never by the timer
const DATA_DIR = process.env.DATA_DIR;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const {
  app, updateDatabase, userStore, musicDb, tvDb, podcastsDb, __mintTestSession, __presenceForTests, feedServed,
  flushPendingProgress, flushPendingMusicProgress, pendingProgress, pendingProgressKey, __holdWriteChainForTests, getCachedDatabase,
} = require('../../server');
const { seedState } = require('../helpers/seed-state');
const { authenticateFetch } = require('../helpers/auth');
const authCrypto = require('../../lib/auth/crypto');
const musicStore = require('../../lib/music/store');
const tvStore = require('../../lib/tv/store');
const podcastStore = require('../../lib/podcasts/store');

let server, base, auth, uid, kid, kidToken;
const lib = path.join(DATA_DIR, 'lib');
const f = (rel) => { const full = path.join(lib, rel); fs.mkdirSync(path.dirname(full), { recursive: true }); fs.writeFileSync(full, 'BYTES'); return full; };
let track, hiddenTrack;
const SUB = 'a'.repeat(32), HIDDEN_SUB = 'b'.repeat(32);
let ep, epPending, epHidden;
const ISO_RE = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const SEC = 1000, MIN = 60 * SEC, YEAR = 365 * 24 * 60 * MIN;

before(async () => {
  const files = { v1: f('Kids/cartoon.mp4'), v2: f('Kids/second.mp4'), v3: f('Kids/third.mp4'), v4: f('Kids/fourth.mp4'), hid: f('Adult/secret.mp4'), aud: f('Talks/talk.m4a'), audHidden: f('AdultTalks/hush.m4a') };
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  auth = authenticateFetch(server, base);
  uid = auth.user.id;
  const meta = (id, filePath, extra) => ({ id, title: id, filePath, folderName: path.basename(path.dirname(filePath)), rootFolder: lib, type: 'video', ext: path.extname(filePath), duration: 100, size: 5, addedAt: 1, codec: 'h264', audioCodec: 'aac', ...extra });
  seedState({
    folders: [lib], folderSettings: {}, liked: [],
    settings: { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30 },
    metadata: {
      v1: meta('v1', files.v1, {}), v2: meta('v2', files.v2, {}), v3: meta('v3', files.v3, {}), v4: meta('v4', files.v4, {}), hid: meta('hid', files.hid, {}),
      aud: meta('aud', files.aud, { type: 'audio', codec: 'aac', duration: 90, tags: { artist: 'Speaker', album: 'Talks' }, chapters: [{ startTime: 0, title: 'One' }, { startTime: 30, title: 'Two' }] }),
      audHidden: meta('audHidden', files.audHidden, { type: 'audio', codec: 'aac', duration: 90 }),
    },
  });
  const mk = (rel, metaT) => { const full = f(rel); return Object.assign({ id: crypto.createHash('md5').update(full).digest('hex'), filePath: full, rootFolder: lib, ext: '.flac', codec: 'flac', addedAt: '2026-01-01T00:00:00.000Z', albumArtKey: null, durationSec: 200 }, metaT); };
  track = mk('Music/Floyd/Wall/01 Mother.flac', { artist: 'Pink Floyd', albumArtist: 'Pink Floyd', album: 'The Wall', title: 'Mother', trackNo: 1 });
  hiddenTrack = mk('Music/Blocked/Secret/01 Hush.flac', { artist: 'Nobody', albumArtist: 'Nobody', album: 'Secret', title: 'Hush', trackNo: 1 });
  await updateDatabase(() => musicDb.mutate((db) => { const ns = musicStore.ensureMusic(db); ns.tracks = { [track.id]: track, [hiddenTrack.id]: hiddenTrack }; ns.folders = [path.join(lib, 'Music')]; return true; }));
  const showDir = path.join(DATA_DIR, 'podcasts', 'Show'); fs.mkdirSync(showDir, { recursive: true }); fs.writeFileSync(path.join(showDir, 'ep1.mp3'), 'E');
  ep = podcastStore.episodeIdFor(SUB, 'g1'); epPending = podcastStore.episodeIdFor(SUB, 'g2'); epHidden = podcastStore.episodeIdFor(HIDDEN_SUB, 'h1');
  await updateDatabase(() => podcastsDb.mutate((h) => {
    const p = podcastStore.ensurePodcasts(h); p.subscriptions = []; p.episodes = {};
    podcastStore.reduceAddSubscription(p, { id: SUB, name: 'The Show', feedUrl: 'https://e.com/f.xml' });
    podcastStore.reduceAddSubscription(p, { id: HIDDEN_SUB, name: 'Hidden', feedUrl: 'https://e.com/h.xml' });
    podcastStore.reduceUpsertEpisodes(p, SUB, [{ guid: 'g1', title: 'One', pubDateMs: 1, durationSec: 1800 }, { guid: 'g2', title: 'Two', pubDateMs: 2, durationSec: 1700 }], 'pending', 5000);
    podcastStore.reduceUpsertEpisodes(p, HIDDEN_SUB, [{ guid: 'h1', title: 'Hush', pubDateMs: 1, durationSec: 100 }], 'pending', 5000);
    podcastStore.reduceEpisodeDownloaded(p, ep, { fileName: 'ep1.mp3', filePath: path.join(showDir, 'ep1.mp3'), bytes: 1, nowMs: 6000 });
    return true;
  }));
  const tvRoot = path.join(DATA_DIR, 'tv');
  const e1 = f('../tv/Kids Show/Season 1/Kids Show S01E01 - Hello.mp4'); const blk = f('../tv/Adult Show/Season 1/Adult Show S01E01 - Pilot.mp4');
  await updateDatabase(() => tvDb.mutate((db) => {
    const ns = tvStore.ensureTv(db); ns.folders = [tvRoot];
    ns.episodes = {
      e1: { id: 'e1', filePath: e1, rootFolder: tvRoot, showId: 'sh', showPath: path.join(tvRoot, 'Kids Show'), showName: 'Kids Show', seasonNum: 1, episodeNum: 1, title: 'Hello', ext: '.mp4', codec: 'h264', audioCodec: 'aac', durationSec: 100, addedAt: 1 },
      blk: { id: 'blk', filePath: blk, rootFolder: tvRoot, showId: 'sb', showPath: path.join(tvRoot, 'Adult Show'), showName: 'Adult Show', seasonNum: 1, episodeNum: 1, title: 'Pilot', ext: '.mp4', codec: 'h264', audioCodec: 'aac', durationSec: 100, addedAt: 2 },
    };
    return true;
  }));
  const k0 = __mintTestSession({ username: 'kid', role: 'member' });
  userStore.updatePassword(k0.user.id, await authCrypto.hashPassword('kid-password-1'));
  kid = __mintTestSession({ username: 'kid', role: 'member' });
  userStore.setRestrictions(kid.user.id, [
    { kind: 'folder', value: 'Adult' }, { kind: 'folder', value: 'AdultTalks' }, { kind: 'show', value: HIDDEN_SUB },
    { kind: 'path', value: path.join(lib, 'Music', 'Blocked') }, { kind: 'path', value: path.join(tvRoot, 'Adult Show') },
  ]);
  const paired = await fetch(`${base}/api/devices`, { method: 'POST', headers: { Cookie: kid.cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Kid phone', platform: 'ios', password: 'kid-password-1' }) });
  assert.strictEqual(paired.status, 201);
  kidToken = (await paired.json()).token;
});
after(async () => {
  auth.restore();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

const json = (p, body, headers) => fetch(`${base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(headers || {}) }, body: JSON.stringify(body) });
// Send a batch with the phone's clock = ours (skew ~ 0) unless `sentAt` is given.
async function sync(events, { sentAt, headers } = {}) {
  const r = await json('/api/offline/progress', { sentAt: sentAt === undefined ? Date.now() : sentAt, events }, headers);
  return { status: r.status, body: await r.json() };
}
const ev = (kind, id, positionSec, at, extra = {}) => ({ kind, id, positionSec, durationSec: 100, at, ...extra });
const onlineMedia = (id, timestamp) => json('/api/progress', { id, timestamp, duration: 100 });
const onlineMusic = (id, position) => json('/api/music/progress', { id, position, duration: 200 });
const near = (iso, expectedMs, slackMs = 3000) => { const t = Date.parse(iso); assert.ok(Math.abs(t - expectedMs) < slackMs, `${iso} is ${t - expectedMs} ms from the expected moment`); };

test('shape: events array (max 200), sentAt required; more than 5 minutes ahead is 400 restamp; a bad element is {applied:false, reason:invalid} in place', async () => {
  assert.strictEqual((await json('/api/offline/progress', {})).status, 400);
  assert.strictEqual((await json('/api/offline/progress', { events: [] })).status, 400, 'sentAt required');
  assert.strictEqual((await json('/api/offline/progress', { sentAt: 'now', events: [] })).status, 400);
  assert.strictEqual((await sync(Array.from({ length: 201 }, () => ev('video', 'v1', 1, Date.now())))).status, 400);
  const ahead = await sync([ev('video', 'v1', 1, Date.now())], { sentAt: Date.now() + 5 * MIN + 10 * SEC });
  assert.strictEqual(ahead.status, 400); assert.deepStrictEqual(ahead.body, { error: 'restamp' });
  assert.strictEqual((await sync([], { sentAt: Date.now() + 4 * MIN })).status, 200, 'four minutes ahead is ordinary skew');
  const r = await sync([
    null, { kind: 'album', id: 'x', positionSec: 1, durationSec: 100, at: Date.now() }, ev('video', 'v1', -1, Date.now()), ev('video', 'v1', 1, Date.now(), { durationSec: 0 }),
    ev('video', 'v1', 102, Date.now()), ev('video', 'v1', '5', Date.now()), ev('video', 'v1', 1, 'now'), ev('video', 'v1', 1, Date.now(), { finished: 'yes' }), ev('video', 'x'.repeat(513), 1, Date.now()),
  ]);
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.body.results.map((x) => x.applied + ':' + x.reason), Array(9).fill('false:invalid'));
  assert.strictEqual(userStore.getOneProgress(uid, 'v1'), null, 'nothing written');
});

test('a fresh item: applied, the stored stamp is the corrected MOMENT as an ISO string (never the phone\'s string), the position lands; a chapter row writes to the parent file', async () => {
  const at = Date.now() - 10 * SEC;
  const docBefore = getCachedDatabase();
  const r = await sync([ev('video', 'v1', 42.5, at), ev('track', 'aud::c1', 55, at)]);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(getCachedDatabase(), docBefore, 'the sync writes per-user rows only: no doc-table save (the cache object keeps its identity)');
  assert.strictEqual(r.body.results[0].applied, true);
  assert.match(r.body.results[0].updatedAt, ISO_RE);
  const row = userStore.getOneProgress(uid, 'v1');
  assert.strictEqual(row.timestamp, 42.5); assert.strictEqual(row.duration, 100);
  assert.match(row.updatedAt, ISO_RE); near(row.updatedAt, at);
  assert.strictEqual(row.updatedAt, r.body.results[0].updatedAt);
  const parent = userStore.getOneProgress(uid, 'aud');
  assert.strictEqual(parent.timestamp, 55, 'the chapter row wrote the PARENT file\'s media row');
  assert.strictEqual(r.body.results[1].id, 'aud::c1', 'the request id is echoed');
});

test('newer wins, strictly: an older offline event is refused with the stored value; a newer one lands; a newer REWIND lands too; a replay of the same batch changes nothing', async () => {
  userStore.setProgress(uid, 'v2', { timestamp: 60, duration: 100, updatedAt: new Date(Date.now() - 5 * SEC).toISOString() });
  const older = await sync([ev('video', 'v2', 70, Date.now() - 10 * SEC)]);
  assert.deepStrictEqual(older.body.results[0], { kind: 'video', id: 'v2', applied: false, reason: 'older', stored: { positionSec: 60, durationSec: 100, updatedAt: userStore.getOneProgress(uid, 'v2').updatedAt } });
  assert.strictEqual(userStore.getOneProgress(uid, 'v2').timestamp, 60, 'untouched');
  const newerAt = Date.now() - 1 * SEC;
  const newer = await sync([ev('video', 'v2', 70, newerAt)]);
  assert.strictEqual(newer.body.results[0].applied, true);
  assert.strictEqual(userStore.getOneProgress(uid, 'v2').timestamp, 70);
  const rewindAt = Date.now() - 200;
  const rewind = await sync([ev('video', 'v2', 12, rewindAt)]);
  assert.strictEqual(rewind.body.results[0].applied, true, 'a deliberate rewind that is newer is real intent (not forward-only)');
  assert.strictEqual(userStore.getOneProgress(uid, 'v2').timestamp, 12);
  const stamp = userStore.getOneProgress(uid, 'v2').updatedAt;
  // A replay: the same events, the same `at`, a fresh sentAt. The comparison is strict, so the only way a
  // replayed event can land again is the residual error the plan discloses (each request's skew carries
  // its own network latency, a few ms): the POSITION never changes and the stamp never moves by more than that.
  for (let i = 0; i < 3; i++) {
    const replay = await sync([ev('video', 'v2', 12, rewindAt)]);
    if (!replay.body.results[0].applied) assert.strictEqual(replay.body.results[0].reason, 'older');
    assert.strictEqual(userStore.getOneProgress(uid, 'v2').timestamp, 12, 'a replay changes no position');
    assert.ok(Math.abs(Date.parse(userStore.getOneProgress(uid, 'v2').updatedAt) - Date.parse(stamp)) < 1000, 'the stamp moves by at most the request latency');
  }
  // Strictly later: an event one full second BEFORE the stored moment is refused even with latency in its favour.
  const before = await sync([ev('video', 'v2', 99, Date.parse(stamp) - 1000)]);
  assert.strictEqual(before.body.results[0].applied, false);
  assert.strictEqual(userStore.getOneProgress(uid, 'v2').timestamp, 12);
});

test('the LIVE media buffer: a newer buffered online ping refuses the offline event and still flushes; an older buffered ping is DELETED when the offline event wins, so the flush cannot land it afterwards', async () => {
  await updateDatabase(() => false); // drain the chain
  // (1) buffered newer: online ping now, offline event 10 s earlier.
  assert.strictEqual((await onlineMedia('v1', 80)).status, 200);
  assert.ok(pendingProgress.has(pendingProgressKey(uid, 'v1')), 'the ping sits in the buffer');
  const r1 = await sync([ev('video', 'v1', 5, Date.now() - 10 * SEC)]);
  assert.strictEqual(r1.body.results[0].applied, false); assert.strictEqual(r1.body.results[0].reason, 'older');
  assert.strictEqual(r1.body.results[0].stored.positionSec, 80, 'the refusal quotes the BUFFERED value');
  // Gate r1 order E: the handler flushes the buffer in its own tick, so the ping is already committed when the mutator runs
  // (the refusal quoted the row, which the flush landed first); a later flush has nothing.
  assert.strictEqual(pendingProgress.has(pendingProgressKey(uid, 'v1')), false, 'the handler flushed the buffer ahead of its mutator');
  assert.strictEqual(await flushPendingProgress(), false);
  assert.strictEqual(userStore.getOneProgress(uid, 'v1').timestamp, 80, 'the online ping landed');
  // (2) buffered older: online ping, wait, offline event newer -> applied, the buffer entry is gone, a flush is a no-op.
  assert.strictEqual((await onlineMedia('v1', 81)).status, 200);
  await new Promise((r) => setTimeout(r, 30));
  const r2 = await sync([ev('video', 'v1', 7, Date.now())]);
  assert.strictEqual(r2.body.results[0].applied, true);
  assert.strictEqual(pendingProgress.has(pendingProgressKey(uid, 'v1')), false, 'the older buffered ping was deleted');
  assert.strictEqual(await flushPendingProgress(), false, 'nothing left to flush');
  assert.strictEqual(userStore.getOneProgress(uid, 'v1').timestamp, 7, 'the offline position stands');
});

test('the snapshot-to-commit GAP (media), both orders: a flush whose snapshot is taken but not yet committed never lets an older offline event through, and a newer one still wins', async () => {
  // Order A: flush first (snapshot + clear, mutator queued BEHIND a held chain), then the offline OLDER event arrives
  // while the row is still unwritten and the buffer already empty; the chain is released only after the request is in.
  // The precondition is EVENT-LOOP ORDER (the hold), never timing (LESSONS 2).
  assert.strictEqual((await onlineMedia('v1', 90)).status, 200);
  let release = __holdWriteChainForTests();
  const flushA = flushPendingProgress(); // snapshot taken, buffer cleared, commit pending behind the hold
  assert.strictEqual(pendingProgress.size, 0, 'the gap: the buffer is empty and the row is not written yet');
  const pA = sync([ev('video', 'v1', 3, Date.now() - 10 * SEC)]);
  await new Promise((r) => setTimeout(r, 150)); // the request has reached the server and queued its mutator behind the flush
  assert.notStrictEqual(userStore.getOneProgress(uid, 'v1').timestamp, 90, 'the flush has not committed yet (the hold works)');
  release();
  const rA = await pA; await flushA;
  assert.strictEqual(rA.body.results[0].applied, false, 'the D4 mutator ran AFTER the flush commit and saw the newer row');
  assert.strictEqual(userStore.getOneProgress(uid, 'v1').timestamp, 90);
  // Order B: the same gap, the offline NEWER event: it lands over the committed row, never under it.
  assert.strictEqual((await onlineMedia('v1', 91)).status, 200);
  await new Promise((r) => setTimeout(r, 30));
  release = __holdWriteChainForTests();
  const flushB = flushPendingProgress();
  const pB = sync([ev('video', 'v1', 4, Date.now())]);
  await new Promise((r) => setTimeout(r, 150));
  release();
  const rB = await pB; await flushB;
  assert.strictEqual(rB.body.results[0].applied, true);
  assert.strictEqual(userStore.getOneProgress(uid, 'v1').timestamp, 4);
  // Order C: offline OLDER first (refused by the buffered newer), then the flush commits the online value.
  assert.strictEqual((await onlineMedia('v1', 92)).status, 200);
  const rC = await sync([ev('video', 'v1', 2, Date.now() - 10 * SEC)]);
  const flushC = flushPendingProgress();
  await flushC;
  assert.strictEqual(rC.body.results[0].applied, false);
  assert.strictEqual(userStore.getOneProgress(uid, 'v1').timestamp, 92);
  // Order D: offline NEWER first (deletes the buffered older), then the flush has nothing.
  assert.strictEqual((await onlineMedia('v1', 93)).status, 200);
  await new Promise((r) => setTimeout(r, 30));
  const rD = await sync([ev('video', 'v1', 6, Date.now())]);
  assert.strictEqual(await flushPendingProgress(), false);
  assert.strictEqual(rD.body.results[0].applied, true);
  assert.strictEqual(userStore.getOneProgress(uid, 'v1').timestamp, 6);
});

test('the music buffer and its gap, both orders: a native track goes through the music store; an older offline event never overwrites a newer online ping', async () => {
  const id = track.id;
  assert.strictEqual((await onlineMusic(id, 50)).status, 200);
  const r1 = await sync([{ kind: 'track', id, positionSec: 5, durationSec: 200, at: Date.now() - 10 * SEC }]);
  assert.strictEqual(r1.body.results[0].applied, false);
  assert.strictEqual(r1.body.results[0].stored.positionSec, 50, 'quotes the buffered music ping');
  await flushPendingMusicProgress();
  assert.strictEqual(userStore.getOneMusicProgress(uid, id).position, 50);
  assert.strictEqual(userStore.getOneProgress(uid, id), null, 'a native track never touches the media store');
  // the gap, flush first (held) then the older event arrives before the commit: refused in chain order
  assert.strictEqual((await onlineMusic(id, 51)).status, 200);
  const release = __holdWriteChainForTests();
  const fl = flushPendingMusicProgress();
  const p2 = sync([{ kind: 'track', id, positionSec: 6, durationSec: 200, at: Date.now() - 10 * SEC }]);
  await new Promise((r) => setTimeout(r, 150));
  assert.strictEqual(userStore.getOneMusicProgress(uid, id).position, 50, 'the flush has not committed yet');
  release();
  const r2 = await p2; await fl;
  assert.strictEqual(r2.body.results[0].applied, false);
  assert.strictEqual(userStore.getOneMusicProgress(uid, id).position, 51);
  // newer offline wins and deletes the buffered older ping
  assert.strictEqual((await onlineMusic(id, 52)).status, 200);
  await new Promise((r) => setTimeout(r, 30));
  const r3 = await sync([{ kind: 'track', id, positionSec: 7, durationSec: 200, at: Date.now() }]);
  assert.strictEqual(r3.body.results[0].applied, true);
  assert.strictEqual(await flushPendingMusicProgress(), false, 'the older ping was deleted from the music buffer');
  assert.strictEqual(userStore.getOneMusicProgress(uid, id).position, 7);
  assert.match(userStore.getOneMusicProgress(uid, id).updatedAt, ISO_RE);
});

test('clock correction: a phone a year AHEAD is refused with 400 restamp (more than 5 minutes ahead, the r2 rule) and plants nothing; four minutes ahead is corrected to its real moment and never a future stamp; a phone a year BEHIND is not "older forever"', async () => {
  // A year ahead: the batch is refused outright (the app re-stamps; a clock that far out cannot sync until fixed).
  const yearAhead = await sync([ev('video', 'v2', 33, Date.now() + YEAR - 10 * SEC)], { sentAt: Date.now() + YEAR });
  assert.strictEqual(yearAhead.status, 400); assert.deepStrictEqual(yearAhead.body, { error: 'restamp' });
  assert.notStrictEqual(userStore.getOneProgress(uid, 'v2').timestamp, 33, 'nothing planted');
  // Four minutes ahead: the phone says +4 min; the event was reached 10 s before it sent, and the row is 5 min old.
  // The stored stamp becomes ~now - 10 s (the corrected moment), never the phone's +4 min.
  userStore.setProgress(uid, 'v2', { timestamp: 1, duration: 100, updatedAt: new Date(Date.now() - 5 * MIN).toISOString() });
  const phoneNow = Date.now() + 4 * MIN;
  const r = await sync([ev('video', 'v2', 33, phoneNow - 10 * SEC)], { sentAt: phoneNow });
  assert.strictEqual(r.body.results[0].applied, true);
  const row = userStore.getOneProgress(uid, 'v2');
  assert.strictEqual(row.timestamp, 33);
  near(row.updatedAt, Date.now() - 10 * SEC);
  assert.ok(Date.parse(row.updatedAt) <= Date.now(), 'never in the future');
  // A laptop write that follows beats it (no wedge).
  assert.strictEqual((await onlineMedia('v2', 34)).status, 200);
  await flushPendingProgress();
  assert.strictEqual(userStore.getOneProgress(uid, 'v2').timestamp, 34);
  // Behind: the phone says 2025; an event reached a minute before it sent compares as ~now - 60 s and beats a 5-minute-old row.
  userStore.setProgress(uid, 'v2', { timestamp: 1, duration: 100, updatedAt: new Date(Date.now() - 5 * MIN).toISOString() });
  const behindNow = Date.now() - YEAR;
  const rb = await sync([ev('video', 'v2', 35, behindNow - 60 * SEC)], { sentAt: behindNow });
  assert.strictEqual(rb.body.results[0].applied, true, 'a year behind is corrected, not refused forever');
  near(userStore.getOneProgress(uid, 'v2').updatedAt, Date.now() - 60 * SEC);
  // An event stamped AFTER the phone sent (a clock jump: at = sentAt + 60 s) corrects to a moment past server now and is
  // CLAMPED to server now, never beyond - a far-future stamp would wedge the item against every later laptop write.
  const sent = Date.now() + 2 * MIN;
  const rc = await sync([ev('video', 'v2', 36, sent + 60 * SEC)], { sentAt: sent });
  assert.strictEqual(rc.body.results[0].applied, true);
  const clamped = Date.parse(userStore.getOneProgress(uid, 'v2').updatedAt);
  assert.ok(clamped <= Date.now(), 'clamped to server time');
  assert.ok(clamped > Date.now() - 5 * SEC, 'and to NOW, not to some earlier moment');
});

test('visibility with DIVERGING restriction kinds: a hidden video (folder), a library track under a hidden folder, a native track under a blocked path, a hidden podcast show and a blocked tv path each refuse {gone} with NOTHING written - cookie and device token alike; an unknown id is gone too', async () => {
  const now = Date.now();
  // Each pass carries its OWN moment: the visible event is replayed through the cookie and then the token, and the product's
  // strict newer-wins rule reads a second event at the SAME moment as older (only request latency ever let it land).
  let pass = 0;
  for (const headers of [{ Cookie: kid.cookie }, { Cookie: '', Authorization: `Bearer ${kidToken}` }]) {
    const at = now - (1 - pass++) * SEC; // the cookie pass a second earlier, the token pass at now (later tests write at a later now)
    const events = [ev('video', 'hid', 10, at), ev('track', 'audHidden', 10, at), { kind: 'track', id: hiddenTrack.id, positionSec: 10, durationSec: 200, at }, ev('podcastEpisode', epHidden, 10, at), ev('tvEpisode', 'blk', 10, at), ev('video', 'nope', 10, at), ev('video', 'v1', 10, at)];
    const r = await sync(events, { headers });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.body.results.map((x) => (x.applied ? 'applied' : x.reason)), ['gone', 'gone', 'gone', 'gone', 'gone', 'gone', 'applied']);
  }
  const k = kid.user.id;
  assert.strictEqual(userStore.getOneProgress(k, 'hid'), null);
  assert.strictEqual(userStore.getOneProgress(k, 'audHidden'), null);
  assert.strictEqual(userStore.getOneMusicProgress(k, hiddenTrack.id), null);
  assert.strictEqual(userStore.getOnePodcastProgress(k, epHidden), null);
  assert.strictEqual(userStore.getOneTvProgress(k, 'blk'), null);
  assert.strictEqual(userStore.isWatched(k, 'hid'), false);
  assert.strictEqual(userStore.getOneProgress(k, 'v1').timestamp, 10, 'discrimination: the visible one landed for the kid');
  // The admin writes the same hidden ids fine.
  const ra = await sync([ev('video', 'hid', 10, now), ev('tvEpisode', 'blk', 10, now), ev('podcastEpisode', epHidden, 10, now)]);
  assert.deepStrictEqual(ra.body.results.map((x) => x.applied), [true, true, true]);
});

test('latches mirror the online path and are never cleared: media 90% sets watched and leaves Watch later; podcast 95% sets played and leaves Watch later; tv 90% sets played; finished:true latches even when the position is refused as older', async () => {
  const now = Date.now();
  userStore.addWatchLater(uid, 'v3', new Date().toISOString());
  userStore.addWatchLater(uid, userStore.watchLaterKey('podcast', ep), new Date().toISOString());
  assert.ok(userStore.getWatchLater(uid).includes('v3'));
  // Below the thresholds: no latch.
  await sync([ev('video', 'v3', 89, now - 2 * SEC), ev('podcastEpisode', ep, 94, now - 2 * SEC), ev('tvEpisode', 'e1', 89, now - 2 * SEC)]);
  assert.strictEqual(userStore.isWatched(uid, 'v3'), false);
  assert.strictEqual(userStore.getPodcastPlayed(uid)[ep], undefined);
  assert.strictEqual(userStore.getTvPlayed(uid).e1, undefined);
  // At the thresholds: latched, Watch later left.
  const r = await sync([ev('video', 'v3', 90, now - 1 * SEC), ev('podcastEpisode', ep, 95, now - 1 * SEC), ev('tvEpisode', 'e1', 90, now - 1 * SEC)]);
  assert.deepStrictEqual(r.body.results.map((x) => x.applied), [true, true, true]);
  assert.strictEqual(userStore.isWatched(uid, 'v3'), true);
  assert.ok(!userStore.getWatchLater(uid).includes('v3'), 'finishing a video leaves Watch later (the online rule)');
  assert.ok(userStore.getPodcastPlayed(uid)[ep]);
  assert.ok(!userStore.getWatchLater(uid).includes(userStore.watchLaterKey('podcast', ep)), 'finishing an episode leaves Watch later (the online rule)');
  assert.ok(userStore.getTvPlayed(uid).e1);
  assert.strictEqual(userStore.getOnePodcastProgress(uid, ep).position, 95);
  // A later, newer rewind to 0 keeps every latch (sticky) while the position moves.
  const back = await sync([ev('video', 'v3', 0, Date.now()), ev('podcastEpisode', ep, 0, Date.now()), ev('tvEpisode', 'e1', 0, Date.now())]);
  assert.deepStrictEqual(back.body.results.map((x) => x.applied), [true, true, true]);
  assert.strictEqual(userStore.getOneProgress(uid, 'v3').timestamp, 0);
  assert.strictEqual(userStore.isWatched(uid, 'v3'), true); assert.ok(userStore.getPodcastPlayed(uid)[ep]); assert.ok(userStore.getTvPlayed(uid).e1);
  // finished:true with an OLDER moment: the position is refused, the latch is set anyway (v4 / a pending episode / tv are fresh here).
  userStore.setProgress(uid, 'v4', { timestamp: 50, duration: 100, updatedAt: new Date().toISOString() });
  userStore.setTvProgress(uid, 'e1', { position: 50, duration: 100, updatedAt: new Date().toISOString() });
  userStore.clearTvPlayed(uid, 'e1');
  assert.strictEqual(userStore.isWatched(uid, 'v4'), false);
  const fin = await sync([ev('video', 'v4', 10, now - 60 * SEC, { finished: true }), ev('tvEpisode', 'e1', 10, now - 60 * SEC, { finished: true }), ev('podcastEpisode', epPending, 10, now, { finished: true })]);
  assert.strictEqual(fin.body.results[0].applied, false); assert.strictEqual(fin.body.results[0].reason, 'older');
  assert.strictEqual(userStore.getOneProgress(uid, 'v4').timestamp, 50, 'the older position did not land');
  assert.strictEqual(userStore.isWatched(uid, 'v4'), true, 'but the latch is set (sticky, only ever set)');
  assert.strictEqual(fin.body.results[1].applied, false);
  assert.ok(userStore.getTvPlayed(uid).e1, 'tv played set by finished even when older');
  assert.strictEqual(fin.body.results[2].applied, true, 'a pending (not downloaded) episode the user can see still syncs');
  assert.ok(userStore.getPodcastPlayed(uid)[epPending]);
  // Music has no latch and no counts: a 100% track event writes only the position.
  const m = await sync([{ kind: 'track', id: track.id, positionSec: 200, durationSec: 200, at: Date.now(), finished: true }]);
  assert.strictEqual(m.body.results[0].applied, true);
  assert.strictEqual(userStore.getOneMusicProgress(uid, track.id).position, 200);
});

test('no presence is announced for an offline replay, even when the body carries a deviceId; the Feed\'s stale rule sees the write; a mixed batch keeps its order', async () => {
  __presenceForTests.clear();
  const r = await json('/api/offline/progress', { sentAt: Date.now(), deviceId: 'phone-1', deviceLabel: 'Phone', presenceState: 'playing', events: [ev('video', 'v1', 20, Date.now())] });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(__presenceForTests.deviceCount(uid), 0, 'an offline replay never shows as "playing now"');
  // Feed: a card served from the stored stamp, then a D4 write -> stale.
  const before = userStore.getOneProgress(uid, 'v1').updatedAt;
  feedServed.mark(uid, 'media', 'v1', before);
  assert.strictEqual(feedServed.status(uid, 'media', 'v1', before), 'ok');
  await sync([ev('video', 'v1', 21, Date.now())]);
  const after = userStore.getOneProgress(uid, 'v1').updatedAt;
  assert.notStrictEqual(after, before);
  assert.strictEqual(feedServed.status(uid, 'media', 'v1', after), 'stale', 'the Feed refuses to write over the offline position');
  // Mixed batch: results align with events, invalid and gone in place.
  const now = Date.now();
  const mixed = await sync([ev('tvEpisode', 'e1', 1, now), { bad: true }, ev('video', 'nope', 1, now), { kind: 'track', id: track.id, positionSec: 1, durationSec: 200, at: now }, ev('podcastEpisode', ep, 1, now), ev('video', 'v1', 22, now - YEAR)]);
  assert.deepStrictEqual(mixed.body.results.map((x) => [x.kind, x.applied ? 'applied' : x.reason]), [['tvEpisode', 'applied'], [undefined, 'invalid'], ['video', 'gone'], ['track', 'applied'], ['podcastEpisode', 'applied'], ['video', 'older']]);
});

test('a device token syncs its own positions (its offline write; since v1.397.0 the online progress routes are in scope too, the web\'s resume record is not); the audit line is a mutation of the kid', async () => {
  const r = await sync([ev('video', 'v1', 30, Date.now())], { headers: { Cookie: '', Authorization: `Bearer ${kidToken}` } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.results[0].applied, true);
  assert.strictEqual(userStore.getOneProgress(kid.user.id, 'v1').timestamp, 30, 'written under the TOKEN\'s user');
  assert.notStrictEqual(userStore.getOneProgress(uid, 'v1').timestamp, 30, 'never under another user');
  // v1.397.0 (native audio D8): the online progress routes JOINED the device scope (the native engine posts to them with the
  // web's bodies); the web's own resume record did not.
  const online = await fetch(`${base}/api/progress`, { method: 'POST', headers: { Cookie: '', Authorization: `Bearer ${kidToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'v1', timestamp: 1, duration: 100 }) });
  assert.strictEqual(online.status, 200, 'the online progress route is in the token\'s scope since v1.397.0 (D8)');
  const other = await fetch(`${base}/api/music/resume`, { method: 'POST', headers: { Cookie: '', Authorization: `Bearer ${kidToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ lastTrackId: 'x', position: 0 }) });
  assert.strictEqual(other.status, 403, 'the web\'s own resume record stays outside the token\'s scope');
});

test('the snapshot-to-commit GAP, order E (gate r1 adversary CRITICAL): the sync is queued behind a busy chain, THEN the coalescer snapshots an OLDER buffered ping and queues its commit behind the sync; the handler flushes first, so the older ping commits ahead and the newer offline position stands (media and music)', async () => {
  await updateDatabase(() => false); // drain the chain
  // Media: the OLDER online ping sits in the buffer; the chain is held; the NEWER offline event is queued; then the timer's
  // flush runs (before the fix: it snapshotted the old ping and queued its commit BEHIND the sync, which saw an empty buffer
  // and a stale row, answered applied:true, and was then overwritten). The precondition is event-loop order, never timing.
  userStore.setProgress(uid, 'v2', { timestamp: 1, duration: 100, updatedAt: new Date(Date.now() - 10 * MIN).toISOString() });
  assert.strictEqual((await onlineMedia('v2', 10)).status, 200);
  await new Promise((r) => setTimeout(r, 30));
  let release = __holdWriteChainForTests();
  const pE = sync([ev('video', 'v2', 50, Date.now())]);
  await new Promise((r) => setTimeout(r, 150)); // the request reached the server: its handler flushed, then queued its mutator
  assert.strictEqual(pendingProgress.size, 0, 'the handler flushed the buffer in its own tick');
  const flushE = flushPendingProgress(); // the timer's flush now finds nothing
  release();
  const rE = await pE; assert.strictEqual(await flushE, false, 'nothing was left for the later flush');
  assert.strictEqual(rE.body.results[0].applied, true);
  assert.strictEqual(userStore.getOneProgress(uid, 'v2').timestamp, 50, 'the older ping committed FIRST; the newer offline position stands');
  // Music: the same order through the music buffer.
  const id = track.id;
  assert.strictEqual((await onlineMusic(id, 10)).status, 200);
  await new Promise((r) => setTimeout(r, 30));
  release = __holdWriteChainForTests();
  const pM = sync([{ kind: 'track', id, positionSec: 60, durationSec: 200, at: Date.now() }]);
  await new Promise((r) => setTimeout(r, 150));
  const flushM = flushPendingMusicProgress();
  release();
  const rM = await pM; assert.strictEqual(await flushM, false);
  assert.strictEqual(rM.body.results[0].applied, true);
  assert.strictEqual(userStore.getOneMusicProgress(uid, id).position, 60);
  // And the older-offline arm of the same order still refuses: the ping commits first, the older event sees it in the row.
  assert.strictEqual((await onlineMedia('v2', 11)).status, 200);
  release = __holdWriteChainForTests();
  const pO = sync([ev('video', 'v2', 49, Date.now() - 10 * SEC)]);
  await new Promise((r) => setTimeout(r, 150));
  release();
  const rO = await pO;
  assert.strictEqual(rO.body.results[0].applied, false); assert.strictEqual(rO.body.results[0].reason, 'older');
  assert.strictEqual(userStore.getOneProgress(uid, 'v2').timestamp, 11);
});

test('an extreme, negative or future `at` is {invalid} in place and never a 500 (gate r1 W2): the batch\'s other events land, nothing is written for the poison event; a negative sentAt is 400', async () => {
  const before = userStore.getOneProgress(uid, 'v4');
  const r = await sync([
    ev('video', 'v3', 11, Date.now()),
    ev('video', 'v4', 12, Date.now(), { at: -9e15 }), ev('video', 'v4', 13, Date.now(), { at: 9e15 }),
    ev('video', 'v4', 14, Date.now() + 6 * MIN), ev('video', 'v4', 15, Date.now(), { at: -1 }),
  ]);
  assert.strictEqual(r.status, 200, 'never a 500: the whole batch is answered');
  assert.deepStrictEqual(r.body.results.map((x) => x.applied + ':' + (x.reason || 'ok')), ['true:ok', 'false:invalid', 'false:invalid', 'false:invalid', 'false:invalid']);
  assert.strictEqual(userStore.getOneProgress(uid, 'v3').timestamp, 11, 'the good event landed');
  assert.deepStrictEqual(userStore.getOneProgress(uid, 'v4'), before, 'nothing written for the poison events');
  assert.strictEqual((await sync([], { sentAt: -1 })).status, 400);
});
