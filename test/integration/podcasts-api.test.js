'use strict';

// [INTEGRATION] v1.69.0 T7 - the podcasts routes against the REAL app.
// Seeds db.podcasts directly (the music-config test pattern; the poll
// pipeline is covered in test/unit/podcasts-poll.test.js with injected
// transports). Feed URLs use the .invalid TLD so any background poll a route
// legitimately fires fails CLOSED at DNS (hostResolvesPublic) - no network.
// Binds: the token-never-in-db/API guarantee, secret-file lifecycle (0600,
// delete-on-unsubscribe), the feed-url re-entry lane, per-user progress +
// the 95% auto-latch, played toggling, streaming with Range, and the
// zero-subscription no-op guarantee (no podcasts dir is ever created).

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-podcastsapi-'));

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, updateDatabase } = require('../../server');
const podcastStore = require('../../lib/podcasts/store');
const secrets = require('../../lib/podcasts/secrets');
const { authenticateFetch } = require('../helpers/auth');

const DATA_DIR = process.env.DATA_DIR;
const TOKEN = 'IntegrationSecretTok42';
const FEED_URL = `https://feeds.invalid/rss/myshow?auth=${TOKEN}&show=1234`;

let server, base;

before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  authenticateFetch(server, base);
});
after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

const get = (p, opts) => fetch(`${base}${p}`, opts);
const postJson = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const patchJson = (p, body) => fetch(`${base}${p}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const del = (p) => fetch(`${base}${p}`, { method: 'DELETE' });

test('fresh install: health is zeroed and NO podcasts directory exists', async () => {
  const r = await get('/api/podcasts/health');
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(await r.json(), { shows: 0, episodes: 0 });
  assert.ok(!fs.existsSync(path.join(DATA_DIR, 'podcasts')), 'zero subscriptions = no dir, the no-op guarantee');
});

let subId;

test('POST subscription: 201; the token lands ONLY in the 0600 secrets file, never the db or the API', async () => {
  const r = await postJson('/api/podcasts/subscriptions', { feedUrl: FEED_URL, backfill: 'all' });
  assert.strictEqual(r.status, 201);
  const body = await r.json();
  subId = body.id;
  assert.match(subId, /^[0-9a-f]{32}$/);

  // The secrets file: exists, 0600, holds the full URL.
  const secretsPath = secrets.resolveSecretsPath(DATA_DIR);
  assert.ok(fs.existsSync(secretsPath));
  if (process.platform !== 'win32') {
    assert.strictEqual(fs.statSync(secretsPath).mode & 0o777, 0o600);
  }
  assert.strictEqual(secrets.loadFeedSecrets(DATA_DIR)[subId], FEED_URL);

  // The DB and the list API: display form only, token nowhere.
  const list = await (await get('/api/podcasts/subscriptions')).json();
  assert.strictEqual(list.subscriptions.length, 1);
  const sub = list.subscriptions[0];
  assert.strictEqual(sub.feedUrlDisplay, 'https://feeds.invalid/rss/myshow');
  assert.ok(!JSON.stringify(list).includes(TOKEN), 'token never in an API response');
  const rawDb = fs.readFileSync(path.join(DATA_DIR, 'filetube.db'));
  assert.ok(!rawDb.includes(Buffer.from(TOKEN)), 'token never in the database FILE');

  // Idempotent re-add.
  const again = await postJson('/api/podcasts/subscriptions', { feedUrl: FEED_URL });
  assert.strictEqual(again.status, 200);
  assert.strictEqual((await again.json()).existed, true);
});

test('input rejection: bad URLs, private hosts, bad backfill - neutral errors, never echoing the input', async () => {
  for (const [body, wantStatus] of [
    [{ feedUrl: 'http://127.0.0.1/feed' }, 400],
    [{ feedUrl: 'file:///etc/passwd' }, 400],
    [{ feedUrl: 'https://ok.invalid/feed', backfill: 'sometimes' }, 400],
    [{}, 400],
  ]) {
    const r = await postJson('/api/podcasts/subscriptions', body);
    assert.strictEqual(r.status, wantStatus, JSON.stringify(body));
    const e = await r.json();
    if (body.feedUrl && body.feedUrl.length > 12) {
      assert.ok(!JSON.stringify(e).includes(body.feedUrl), 'no input echo');
    }
  }
});

test('PATCH: allowlisted fields only; unknown sub 404', async () => {
  assert.strictEqual((await patchJson(`/api/podcasts/subscriptions/${subId}`, { paused: true })).status, 200);
  assert.strictEqual((await patchJson(`/api/podcasts/subscriptions/${subId}`, { lastStatus: 'forged' })).status, 400);
  assert.strictEqual((await patchJson('/api/podcasts/subscriptions/ffffffffffffffffffffffffffffffff', { paused: true })).status, 404);
  const sub = (await (await get('/api/podcasts/subscriptions')).json()).subscriptions[0];
  assert.strictEqual(sub.paused, true);
  await patchJson(`/api/podcasts/subscriptions/${subId}`, { paused: false });
});

// Seed two episodes directly: one downloaded (real temp file), one pending.
let epDownloaded, epPending, mediaFile;

test('seeded episodes: list newest-first with per-user state; stream honors Range; pending is not streamable', async () => {
  // Seed INSIDE the podcasts root, as production always does - the v1.70
  // delta-round read-confinement refuses to stream anything outside it (this
  // seed used to be a temp dir, which the new guard correctly rejected).
  const showDir = path.join(DATA_DIR, 'podcasts', 'Seeded Show');
  fs.mkdirSync(showDir, { recursive: true });
  mediaFile = path.join(showDir, 'Ep Two [rss=g2].mp3');
  fs.writeFileSync(mediaFile, 'MP3BYTES-0123456789');
  epDownloaded = podcastStore.episodeIdFor(subId, 'g2');
  epPending = podcastStore.episodeIdFor(subId, 'g1');
  await updateDatabase((db) => {
    const ns = podcastStore.ensurePodcasts(db);
    podcastStore.reduceUpsertEpisodes(ns, subId, [
      { guid: 'g1', title: 'Ep One', pubDateMs: 1000, durationSec: 100 },
      { guid: 'g2', title: 'Ep Two', pubDateMs: 2000, durationSec: 200 },
    ], 'pending', 5000);
    podcastStore.reduceEpisodeDownloaded(ns, epDownloaded, { fileName: path.basename(mediaFile), filePath: mediaFile, bytes: 19, nowMs: 6000 });
    return true;
  });

  const r = await get(`/api/podcasts/shows/${subId}/episodes`);
  assert.strictEqual(r.status, 200);
  const data = await r.json();
  assert.deepStrictEqual(data.episodes.map((e) => e.title), ['Ep Two', 'Ep One'], 'newest-first');
  assert.strictEqual(data.episodes[0].status, 'downloaded');
  assert.strictEqual(data.episodes[0].played, false);
  assert.strictEqual(data.episodes[0].progress, null);
  assert.ok(!('filePath' in data.episodes[0]), 'server paths never leak to the client');

  const whole = await get(`/episode/${epDownloaded}`);
  assert.strictEqual(whole.status, 200);
  assert.strictEqual(await whole.text(), 'MP3BYTES-0123456789');

  const range = await get(`/episode/${epDownloaded}`, { headers: { Range: 'bytes=0-7' } });
  assert.strictEqual(range.status, 206);
  assert.strictEqual(await range.text(), 'MP3BYTES');

  assert.strictEqual((await get(`/episode/${epPending}`)).status, 404, 'a pending episode has no file to stream');
  assert.strictEqual((await get('/episode/ffffffffffffffffffffffffffffffff')).status, 404);
});

test('progress: phantom 400; real persists; >=95% auto-latches played; manual toggle both ways', async () => {
  assert.strictEqual((await postJson('/api/podcasts/progress', { episodeId: 'ffffffffffffffffffffffffffffffff', position: 5 })).status, 400);
  assert.strictEqual((await postJson('/api/podcasts/progress', { episodeId: epDownloaded, position: -3 })).status, 400);

  assert.strictEqual((await postJson('/api/podcasts/progress', { episodeId: epDownloaded, position: 50, duration: 200 })).status, 200);
  let data = await (await get(`/api/podcasts/shows/${subId}/episodes`)).json();
  assert.strictEqual(data.episodes[0].progress.position, 50);
  assert.strictEqual(data.episodes[0].played, false, '25% is not played');

  assert.strictEqual((await postJson('/api/podcasts/progress', { episodeId: epDownloaded, position: 195, duration: 200 })).status, 200);
  data = await (await get(`/api/podcasts/shows/${subId}/episodes`)).json();
  assert.strictEqual(data.episodes[0].played, true, '97.5% auto-latches');

  assert.strictEqual((await postJson(`/api/podcasts/episodes/${epDownloaded}/played`, { played: false })).status, 200);
  data = await (await get(`/api/podcasts/shows/${subId}/episodes`)).json();
  assert.strictEqual(data.episodes[0].played, false, 'manual unplay wins');
  assert.strictEqual((await postJson(`/api/podcasts/episodes/${epPending}/played`, { played: true })).status, 200);
  assert.strictEqual((await postJson('/api/podcasts/episodes/ffffffffffffffffffffffffffffffff/played', {})).status, 400, 'phantom id 400');
});

test('progress: the shared player controller\'s {id, timestamp} body shape and the read route both work', async () => {
  // saveProgressToServer (public/js/player.js) posts {id, timestamp, duration}
  // to every progressEndpoint - the podcasts route must accept it.
  assert.strictEqual((await postJson('/api/podcasts/progress', { id: epDownloaded, timestamp: 77, duration: 200 })).status, 200);
  const read = await (await get(`/api/podcasts/progress/${epDownloaded}`)).json();
  assert.strictEqual(read.position, 77, 'the player read route reflects the player write shape');
  const never = await (await get('/api/podcasts/progress/ffffffffffffffffffffffffffffffff')).json();
  assert.strictEqual(never.position, 0, 'a never-played episode reads 0, not an error (the player treats it as start-from-top)');
});

test('v1.69 gate fix (adversarial #4): the pretty /podcasts route gets the shell treatment (no-cache), same as /music', async () => {
  const pretty = await get('/podcasts');
  assert.strictEqual(pretty.status, 200);
  assert.strictEqual(pretty.headers.get('cache-control'), 'no-cache', 'the linked route rides the shell middleware');
  const music = await get('/music');
  assert.strictEqual(music.headers.get('cache-control'), 'no-cache', 'parity with the /music arm');
});

test('podcastart: SVG placeholder when no art exists', async () => {
  const r = await get(`/podcastart/${subId}`);
  assert.strictEqual(r.status, 200);
  assert.match(r.headers.get('content-type'), /image\/svg\+xml/);
});

test('feed-url re-entry: a rotated token for the SAME feed is accepted; a different feed is refused', async () => {
  const rotated = 'https://feeds.invalid/rss/myshow?auth=NewRotatedTok777&show=1234';
  const r = await postJson(`/api/podcasts/subscriptions/${subId}/feed-url`, { feedUrl: rotated });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(secrets.loadFeedSecrets(DATA_DIR)[subId], rotated, 'secret replaced');

  const other = await postJson(`/api/podcasts/subscriptions/${subId}/feed-url`, { feedUrl: 'https://feeds.invalid/rss/DIFFERENT?auth=x' });
  assert.strictEqual(other.status, 400);
  assert.strictEqual((await postJson('/api/podcasts/subscriptions/ffffffffffffffffffffffffffffffff/feed-url', { feedUrl: rotated })).status, 404);
});

test('settings: pollMinutes round-trips with validation; downloadDir is reported', async () => {
  const before = await (await get('/api/podcasts/settings')).json();
  assert.strictEqual(before.pollMinutes, 60, 'the default');
  assert.ok(before.downloadDir.endsWith(path.join(path.basename(DATA_DIR), 'podcasts')) || before.downloadDir.includes('podcasts'));
  assert.strictEqual((await postJson('/api/podcasts/settings', { pollMinutes: 120 })).status, 200);
  assert.strictEqual((await (await get('/api/podcasts/settings')).json()).pollMinutes, 120);
  assert.strictEqual((await postJson('/api/podcasts/settings', { pollMinutes: -1 })).status, 400);
  assert.strictEqual((await postJson('/api/podcasts/settings', { pollMinutes: 1.5 })).status, 400);
  assert.strictEqual((await postJson('/api/podcasts/settings', {})).status, 400);
});

test('v1.70: delete -> trash -> restore round-trip; collisions and wrong states refuse; per-user state survives trash', async () => {
  // Seed a downloaded episode INSIDE the podcasts root so computeTrashTarget
  // confines correctly under the real root.
  const root = path.join(DATA_DIR, 'podcasts');
  const showDir = path.join(root, 'RoundTrip Show');
  fs.mkdirSync(showDir, { recursive: true });
  const epFile = path.join(showDir, 'Trip [rss=t1].mp3');
  fs.writeFileSync(epFile, 'TRIPBYTES');
  const epId = podcastStore.episodeIdFor(subId, 't1');
  await updateDatabase((db) => {
    const ns = podcastStore.ensurePodcasts(db);
    podcastStore.reduceUpsertEpisodes(ns, subId, [{ guid: 't1', title: 'Trip', pubDateMs: 3000, durationSec: 100 }], 'pending', 5000);
    podcastStore.reduceEpisodeDownloaded(ns, epId, { fileName: path.basename(epFile), filePath: epFile, bytes: 9, nowMs: 6000 });
    return true;
  });
  // Per-user state before the trash trip.
  await postJson('/api/podcasts/progress', { episodeId: epId, position: 42, duration: 100 });

  // DELETE: file moves into <root>/.filetube-trash, record flips, row survives.
  const del = await fetch(`${base}/api/podcasts/episodes/${epId}`, { method: 'DELETE' });
  assert.strictEqual(del.status, 200);
  assert.strictEqual((await del.json()).status, 'trashed');
  assert.ok(!fs.existsSync(epFile), 'the original path is empty');
  const trashDir = path.join(root, '.filetube-trash');
  const trashed = fs.readdirSync(trashDir).filter((f) => f.includes('Trip'));
  assert.strictEqual(trashed.length, 1, 'the bytes are IN the trash, recoverable');
  let data = await (await get(`/api/podcasts/shows/${subId}/episodes`)).json();
  let row = data.episodes.find((e) => e.id === epId);
  assert.strictEqual(row.status, 'trashed');
  assert.ok(Number.isFinite(row.trashedAt));
  assert.ok(!('trashPath' in row), 'server paths never leak');
  assert.strictEqual(row.progress.position, 42, 'per-user state SURVIVES the trash trip');

  // Wrong-state refusals + the streaming guard now being load-bearing.
  assert.strictEqual((await fetch(`${base}/api/podcasts/episodes/${epId}`, { method: 'DELETE' })).status, 400, 'double-delete refuses');
  assert.strictEqual((await get(`/episode/${epId}`)).status, 404, 'a trashed episode does not stream (the status guard is now load-bearing)');

  // Restore-collision: plant a file at the original path -> 409, trash intact.
  fs.writeFileSync(epFile, 'INTRUDER');
  const collide = await postJson(`/api/podcasts/episodes/${epId}/restore`, {});
  assert.strictEqual(collide.status, 409);
  assert.strictEqual(fs.readFileSync(epFile, 'utf8'), 'INTRUDER', 'never clobbers');
  assert.strictEqual(fs.readdirSync(trashDir).filter((f) => f.includes('Trip')).length, 1, 'trash untouched');
  fs.unlinkSync(epFile);

  // Clean restore: bytes return, record flips, progress intact.
  const restore = await postJson(`/api/podcasts/episodes/${epId}/restore`, {});
  assert.strictEqual(restore.status, 200);
  assert.strictEqual(fs.readFileSync(epFile, 'utf8'), 'TRIPBYTES', 'byte-identical bytes back at the original path');
  data = await (await get(`/api/podcasts/shows/${subId}/episodes`)).json();
  row = data.episodes.find((e) => e.id === epId);
  assert.strictEqual(row.status, 'downloaded');
  assert.strictEqual(row.progress.position, 42, 'resume position survives the whole round-trip');
  assert.strictEqual((await postJson(`/api/podcasts/episodes/${epId}/restore`, {})).status, 400, 'restoring a non-trashed episode refuses');

  // Vanished trash file: 410 + honest tombstone + per-user purge.
  const del2 = await fetch(`${base}/api/podcasts/episodes/${epId}`, { method: 'DELETE' });
  assert.strictEqual(del2.status, 200);
  for (const f of fs.readdirSync(trashDir)) fs.unlinkSync(path.join(trashDir, f));
  const gone = await postJson(`/api/podcasts/episodes/${epId}/restore`, {});
  assert.strictEqual(gone.status, 410);
  data = await (await get(`/api/podcasts/shows/${subId}/episodes`)).json();
  assert.strictEqual(data.episodes.find((e) => e.id === epId).status, 'tombstone');
  const { userStore } = require('../../server');
  const u = userStore.listUsers()[0];
  assert.strictEqual(userStore.getOnePodcastProgress(u.id, epId), null, 'purge retires the rows (trash kept them)');

  // Phantom + non-downloaded refusals.
  assert.strictEqual((await fetch(`${base}/api/podcasts/episodes/ffffffffffffffffffffffffffffffff`, { method: 'DELETE' })).status, 404);
});

test('v1.71 T3: /episode/:id?download=1 sends an attachment disposition with the episode title; plain streaming stays undisposed', async () => {
  const root = path.join(DATA_DIR, 'podcasts');
  const showDir = path.join(root, 'RoundTrip Show');
  fs.mkdirSync(showDir, { recursive: true });
  const epFile = path.join(showDir, 'Save Me [rss=dl1].mp3');
  fs.writeFileSync(epFile, 'DOWNLOADBYTES');
  const epId = podcastStore.episodeIdFor(subId, 'dl1');
  await updateDatabase((db) => {
    const ns = podcastStore.ensurePodcasts(db);
    podcastStore.reduceUpsertEpisodes(ns, subId, [{ guid: 'dl1', title: 'Sävê "Me"', pubDateMs: 3200, durationSec: 10 }], 'pending', 5200);
    podcastStore.reduceEpisodeDownloaded(ns, epId, { fileName: path.basename(epFile), filePath: epFile, bytes: 13, nowMs: 6200 });
    return true;
  });

  const dl = await get(`/episode/${epId}?download=1`);
  assert.strictEqual(dl.status, 200);
  const dispo = dl.headers.get('content-disposition');
  assert.ok(dispo && dispo.startsWith('attachment;'), `attachment disposition present: ${dispo}`);
  assert.ok(dispo.includes("filename*=UTF-8''"), 'RFC 5987 arm present (the shared helper, not an ad-hoc header)');
  assert.ok(dispo.includes('.mp3'), 'extension rides the filename');
  assert.ok(!dispo.includes('"Sävê'), 'non-ASCII title never lands raw in the quoted ASCII arm');
  assert.strictEqual(await dl.text(), 'DOWNLOADBYTES', 'the same confined bytes stream');

  const plain = await get(`/episode/${epId}`);
  assert.strictEqual(plain.status, 200);
  assert.strictEqual(plain.headers.get('content-disposition'), null, 'no disposition without the flag - inline playback untouched');
});

test('v1.71 T4: episode likes - toggle round-trip, phantom 404, liked filter list with showName, no-filter 400', async () => {
  const root = path.join(DATA_DIR, 'podcasts');
  const showDir = path.join(root, 'RoundTrip Show');
  fs.mkdirSync(showDir, { recursive: true });
  const epFile = path.join(showDir, 'Liked [rss=like1].mp3');
  fs.writeFileSync(epFile, 'LIKEBYTES');
  const epId = podcastStore.episodeIdFor(subId, 'like1');
  await updateDatabase((db) => {
    const ns = podcastStore.ensurePodcasts(db);
    podcastStore.reduceUpsertEpisodes(ns, subId, [{ guid: 'like1', title: 'Likeable', pubDateMs: 3300, durationSec: 10 }], 'pending', 5300);
    podcastStore.reduceEpisodeDownloaded(ns, epId, { fileName: path.basename(epFile), filePath: epFile, bytes: 9, nowMs: 6300 });
    return true;
  });

  // Phantom-id discipline on the like verb.
  assert.strictEqual((await postJson('/api/podcasts/episodes/ffffffffffffffffffffffffffffffff/liked', {})).status, 404);

  // Like -> the id lands in GET /api/podcasts/liked and the row's payload.
  const like = await postJson(`/api/podcasts/episodes/${epId}/liked`, {});
  assert.strictEqual(like.status, 200);
  assert.deepStrictEqual(await like.json(), { liked: true });
  const ids = await (await get('/api/podcasts/liked')).json();
  assert.ok(ids.episodeIds.includes(epId));
  const showData = await (await get(`/api/podcasts/shows/${subId}/episodes`)).json();
  assert.strictEqual(showData.episodes.find((e) => e.id === epId).liked, true, 'the show list carries the heart state');

  // The Liked lane list: cross-show shape with showName, downloaded only.
  const lane = await (await get('/api/podcasts/episodes?filter=liked')).json();
  const row = lane.episodes.find((e) => e.id === epId);
  assert.ok(row, 'the liked episode is in the lane');
  assert.strictEqual(typeof row.showName, 'string', 'the lane names the owning show');
  assert.strictEqual(row.liked, true);
  assert.ok(!('trashPath' in row) && !('filePath' in row), 'server paths never leak');

  // Unlike: idempotent, and the lane empties.
  assert.deepStrictEqual(await (await fetch(`${base}/api/podcasts/episodes/${epId}/liked`, { method: 'DELETE' })).json(), { liked: false });
  assert.deepStrictEqual(await (await fetch(`${base}/api/podcasts/episodes/${epId}/liked`, { method: 'DELETE' })).json(), { liked: false }, 'unliking the unliked is a no-op success');
  assert.ok(!(await (await get('/api/podcasts/liked')).json()).episodeIds.includes(epId));

  // The selection surface refuses to be a catalog dump.
  assert.strictEqual((await get('/api/podcasts/episodes')).status, 400);
});

test('v1.71 (gate W4): the like routes act as the AUTHENTICATED user - a wrong-user mutant fails HERE, at the route layer', async () => {
  const { __mintTestSession } = require('../../server');
  const b = __mintTestSession({ username: 'likeactor', role: 'member' });
  const asB = (p, opts) => fetch(`${base}${p}`, { ...(opts || {}), headers: { ...((opts || {}).headers || {}), Cookie: b.cookie } });

  const root = path.join(DATA_DIR, 'podcasts');
  const showDir = path.join(root, 'RoundTrip Show');
  fs.mkdirSync(showDir, { recursive: true });
  const epFile = path.join(showDir, 'Actor [rss=act1].mp3');
  fs.writeFileSync(epFile, 'ACTORBYTES');
  const epId = podcastStore.episodeIdFor(subId, 'act1');
  await updateDatabase((db) => {
    const ns = podcastStore.ensurePodcasts(db);
    podcastStore.reduceUpsertEpisodes(ns, subId, [{ guid: 'act1', title: 'Actor Ep', pubDateMs: 3500, durationSec: 10 }], 'pending', 5500);
    podcastStore.reduceEpisodeDownloaded(ns, epId, { fileName: path.basename(epFile), filePath: epFile, bytes: 10, nowMs: 6500 });
    return true;
  });

  // A likes; B must not see it - by ids, by lane, or on the row payload.
  await postJson(`/api/podcasts/episodes/${epId}/liked`, {});
  assert.ok(!(await (await asB('/api/podcasts/liked')).json()).episodeIds.includes(epId), 'B never sees A\'s like ids');
  const bLane = await (await asB('/api/podcasts/episodes?filter=liked')).json();
  assert.ok(!bLane.episodes.some((e) => e.id === epId), 'B\'s Liked lane is B\'s alone');
  const bShow = await (await asB(`/api/podcasts/shows/${subId}/episodes`)).json();
  assert.strictEqual(bShow.episodes.find((e) => e.id === epId).liked, false, 'B\'s row payload carries B\'s heart state');

  // B likes then unlikes; A's like survives untouched.
  await asB(`/api/podcasts/episodes/${epId}/liked`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.ok((await (await asB('/api/podcasts/liked')).json()).episodeIds.includes(epId), 'B\'s own like registered as B');
  await asB(`/api/podcasts/episodes/${epId}/liked`, { method: 'DELETE' });
  assert.ok((await (await get('/api/podcasts/liked')).json()).episodeIds.includes(epId), 'B\'s unlike NEVER touches A\'s like');

  // Cleanup: unlike as A so later liked-count assertions stay honest.
  await fetch(`${base}/api/podcasts/episodes/${epId}/liked`, { method: 'DELETE' });
});

test('v1.71 T5: recent-listening selection - position>0 downloaded episodes, updatedAt desc; single-episode GET resolves the deep link', async () => {
  const root = path.join(DATA_DIR, 'podcasts');
  const showDir = path.join(root, 'RoundTrip Show');
  fs.mkdirSync(showDir, { recursive: true });
  const mk = (guid) => {
    const f = path.join(showDir, `${guid} [rss=${guid}].mp3`);
    fs.writeFileSync(f, 'B');
    return f;
  };
  const idA = podcastStore.episodeIdFor(subId, 'cl-a');
  const idB = podcastStore.episodeIdFor(subId, 'cl-b');
  const idC = podcastStore.episodeIdFor(subId, 'cl-c');
  await updateDatabase((db) => {
    const ns = podcastStore.ensurePodcasts(db);
    podcastStore.reduceUpsertEpisodes(ns, subId, [
      { guid: 'cl-a', title: 'A', pubDateMs: 3400, durationSec: 100 },
      { guid: 'cl-b', title: 'B', pubDateMs: 3401, durationSec: 100 },
      { guid: 'cl-c', title: 'C', pubDateMs: 3402, durationSec: 100 },
    ], 'pending', 5400);
    podcastStore.reduceEpisodeDownloaded(ns, idA, { fileName: 'a', filePath: mk('cl-a'), bytes: 1, nowMs: 6400 });
    podcastStore.reduceEpisodeDownloaded(ns, idB, { fileName: 'b', filePath: mk('cl-b'), bytes: 1, nowMs: 6401 });
    podcastStore.reduceEpisodeDownloaded(ns, idC, { fileName: 'c', filePath: mk('cl-c'), bytes: 1, nowMs: 6402 });
    return true;
  });
  // A: older listen; B: newer listen; C: zero position (never counts).
  await postJson('/api/podcasts/progress', { episodeId: idA, position: 10, duration: 100 });
  await postJson('/api/podcasts/progress', { episodeId: idB, position: 20, duration: 100 });
  await postJson('/api/podcasts/progress', { episodeId: idC, position: 0, duration: 100 });

  const data = await (await get('/api/podcasts/episodes?filter=recent-listening&limit=10')).json();
  const ids = data.episodes.map((e) => e.id).filter((id) => [idA, idB, idC].includes(id));
  assert.ok(!ids.includes(idC), 'position 0 never rides the row');
  assert.ok(ids.indexOf(idB) < ids.indexOf(idA), 'most recent listen first (updatedAt desc)');
  const rowA = data.episodes.find((e) => e.id === idA);
  assert.strictEqual(rowA.progress.position, 10, 'the card carries the resume position');
  assert.strictEqual(typeof rowA.showName, 'string');

  // The deep-link resolver.
  const one = await (await get(`/api/podcasts/episodes/${idB}`)).json();
  assert.strictEqual(one.subId, subId, 'names the owning show id');
  assert.strictEqual(typeof one.showName, 'string');
  assert.strictEqual(one.progress.position, 20);
  assert.ok(!('trashPath' in one) && !('filePath' in one), 'server paths never leak');
  assert.strictEqual((await get('/api/podcasts/episodes/ffffffffffffffffffffffffffffffff')).status, 404);
});

test('v1.70 (QA S4): DELETE of an episode whose file already vanished records deleted-on-disk, no trash trip', async () => {
  const root = path.join(DATA_DIR, 'podcasts');
  const missing = path.join(root, 'RoundTrip Show', 'Gone [rss=gone1].mp3'); // never written
  const epId = podcastStore.episodeIdFor(subId, 'gone1');
  await updateDatabase((db) => {
    const ns = podcastStore.ensurePodcasts(db);
    podcastStore.reduceUpsertEpisodes(ns, subId, [{ guid: 'gone1', title: 'Gone', pubDateMs: 3100, durationSec: 10 }], 'pending', 5100);
    podcastStore.reduceEpisodeDownloaded(ns, epId, { fileName: path.basename(missing), filePath: missing, bytes: 9, nowMs: 6100 });
    return true;
  });
  const r = await fetch(`${base}/api/podcasts/episodes/${epId}`, { method: 'DELETE' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual((await r.json()).status, 'deleted-on-disk', 'records the truth instead of failing the intent');
  const data = await (await get(`/api/podcasts/shows/${subId}/episodes`)).json();
  assert.strictEqual(data.episodes.find((e) => e.id === epId).status, 'deleted-on-disk');
  assert.strictEqual((await postJson(`/api/podcasts/episodes/${epId}/restore`, {})).status, 400, 'a deleted-on-disk episode is not restorable');
});

test('v1.70 gate CRITICAL#1: a hostile record cannot read, write or destroy outside the podcasts root', async () => {
  // The adversarial seat's exact attack shapes, reachable in production via
  // an admin backup bundle (validateBackupBundle checks container shapes,
  // not episode record contents). Every one must refuse BEFORE any I/O.
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-victim-'));
  const victim = path.join(outside, 'session-secret');
  fs.writeFileSync(victim, 'SUPER-SECRET-SIGNING-KEY');
  const target = path.join(outside, 'planted.mp3');
  const root = path.join(DATA_DIR, 'podcasts');
  const legitTrash = path.join(root, '.filetube-trash', 'legit.mp3');
  fs.mkdirSync(path.dirname(legitTrash), { recursive: true });
  fs.writeFileSync(legitTrash, 'LEGITBYTES');

  const escapeReadId = podcastStore.episodeIdFor(subId, 'esc-read');
  const escapeWriteId = podcastStore.episodeIdFor(subId, 'esc-write');
  const escapeDeleteId = podcastStore.episodeIdFor(subId, 'esc-del');
  await updateDatabase((db) => {
    const ns = podcastStore.ensurePodcasts(db);
    podcastStore.reduceUpsertEpisodes(ns, subId, [
      { guid: 'esc-read', title: 'R', pubDateMs: 1 },
      { guid: 'esc-write', title: 'W', pubDateMs: 2 },
      { guid: 'esc-del', title: 'D', pubDateMs: 3 },
    ], 'pending', 5000);
    // 1a: restore FROM outside (arbitrary read + destroy-at-source).
    Object.assign(ns.episodes[escapeReadId], { status: 'trashed', trashPath: victim, filePath: path.join(root, 'S', 'stolen.mp3'), trashedAt: 1 });
    // 1b: restore INTO outside (arbitrary create) from a legit trash file.
    Object.assign(ns.episodes[escapeWriteId], { status: 'trashed', trashPath: legitTrash, filePath: target, trashedAt: 1 });
    // 1b-mirror: DELETE a file that lives outside the root.
    Object.assign(ns.episodes[escapeDeleteId], { status: 'downloaded', filePath: victim });
    return true;
  });

  const r1 = await postJson(`/api/podcasts/episodes/${escapeReadId}/restore`, {});
  assert.strictEqual(r1.status, 409, 'restore-from-outside refuses');
  assert.strictEqual(fs.readFileSync(victim, 'utf8'), 'SUPER-SECRET-SIGNING-KEY', 'the victim file is untouched');
  assert.strictEqual((await get(`/episode/${escapeReadId}`)).status, 404, 'and nothing is streamable');

  const r2 = await postJson(`/api/podcasts/episodes/${escapeWriteId}/restore`, {});
  assert.strictEqual(r2.status, 409, 'restore-into-outside refuses');
  assert.ok(!fs.existsSync(target), 'no file planted outside the root');
  assert.strictEqual(fs.readFileSync(legitTrash, 'utf8'), 'LEGITBYTES', 'the legit trash file is untouched');

  const r3 = await fetch(`${base}/api/podcasts/episodes/${escapeDeleteId}`, { method: 'DELETE' });
  assert.strictEqual(r3.status, 409, 'deleting an out-of-root file refuses');
  assert.strictEqual(fs.readFileSync(victim, 'utf8'), 'SUPER-SECRET-SIGNING-KEY', 'still untouched after the delete attempt');

  fs.rmSync(outside, { recursive: true, force: true });
});

test('v1.70 delta CRITICAL: /episode/:id refuses an out-of-root filePath (the READ primitive, no move needed)', async () => {
  // With the move lanes sealed, the streaming route was the shortest path to
  // the same arbitrary-file read - it served ep.filePath, which a restored
  // bundle authors, with no confinement at all (the seat's repro returned a
  // live session-secret over HTTP).
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-readvictim-'));
  const victim = path.join(outside, 'session-secret');
  fs.writeFileSync(victim, 'SUPER-SECRET-SIGNING-KEY');
  const readId = podcastStore.episodeIdFor(subId, 'read-esc');
  await updateDatabase((db) => {
    const ns = podcastStore.ensurePodcasts(db);
    podcastStore.reduceUpsertEpisodes(ns, subId, [{ guid: 'read-esc', title: 'X', pubDateMs: 1 }], 'pending', 5000);
    // A fully 'downloaded' record whose file lives outside the root.
    Object.assign(ns.episodes[readId], { status: 'downloaded', filePath: victim });
    return true;
  });
  const r = await get(`/episode/${readId}`);
  assert.strictEqual(r.status, 404, 'the read is refused');
  const body = await r.text();
  assert.ok(!body.includes('SUPER-SECRET'), 'no bytes of the victim leak');
  assert.ok(!body.includes(victim), 'and the refusal never confirms the path');
  assert.strictEqual(fs.readFileSync(victim, 'utf8'), 'SUPER-SECRET-SIGNING-KEY');
  fs.rmSync(outside, { recursive: true, force: true });
});

test('v1.70 gate MV1: a non-downloaded episode never streams (the guard is load-bearing now)', async () => {
  // Bound at last (this mutant survived the v1.69 gate as MP9 and the v1.70
  // implementation as MV1): a pending episode with a REAL file on disk must
  // still 404 - status, not file existence, is the authority.
  const root = path.join(DATA_DIR, 'podcasts');
  const showDir = path.join(root, 'Guard Show');
  fs.mkdirSync(showDir, { recursive: true });
  const realFile = path.join(showDir, 'Guarded [rss=gg1].mp3');
  fs.writeFileSync(realFile, 'REALBYTES');
  const gId = podcastStore.episodeIdFor(subId, 'gg1');
  await updateDatabase((db) => {
    const ns = podcastStore.ensurePodcasts(db);
    podcastStore.reduceUpsertEpisodes(ns, subId, [{ guid: 'gg1', title: 'Guarded', pubDateMs: 9 }], 'pending', 5000);
    ns.episodes[gId].filePath = realFile; // a real, readable file behind a non-downloaded status
    return true;
  });
  assert.strictEqual((await get(`/episode/${gId}`)).status, 404, 'status is the authority, not file existence');
  await updateDatabase((db) => podcastStore.reduceEpisodeDownloaded(podcastStore.ensurePodcasts(db), gId, { fileName: path.basename(realFile), filePath: realFile, bytes: 9, nowMs: 1 }));
  assert.strictEqual((await get(`/episode/${gId}`)).status, 200, 'and it streams once genuinely downloaded');
});

test('the FOUR-way root guard: media/music/books configs all reject the podcasts root (both directions by shape)', async () => {
  const podcastsRoot = path.join(DATA_DIR, 'podcasts');
  const nested = path.join(podcastsRoot, 'Some Show');
  // The config routes silently drop NONEXISTENT folders before any guard
  // runs - the overlap rejection is only reachable for real directories.
  fs.mkdirSync(nested, { recursive: true });
  for (const [route, key] of [['/api/config', 'folders'], ['/api/music/config', 'folders'], ['/api/books/config', 'folders']]) {
    for (const target of [podcastsRoot, nested]) {
      const r = await postJson(route, { [key]: [target] });
      assert.strictEqual(r.status, 400, `${route} must reject ${target}`);
      const body = await r.json();
      assert.match(body.error, /podcasts folder/i, `${route}: ${body.error}`);
    }
  }
});

test('DELETE subscription: records + per-user rows + secret gone; the FILE stays on disk', async () => {
  const r = await del(`/api/podcasts/subscriptions/${subId}`);
  assert.strictEqual(r.status, 200);
  assert.strictEqual((await r.json()).filesKept, true);

  assert.deepStrictEqual(await (await get('/api/podcasts/health')).json(), { shows: 0, episodes: 0 });
  assert.strictEqual(secrets.loadFeedSecrets(DATA_DIR)[subId], undefined, 'secret deleted');
  assert.ok(fs.existsSync(mediaFile), 'the downloaded file SURVIVES unsubscribe');
  const { userStore } = require('../../server');
  const anyUser = userStore.listUsers()[0];
  assert.equal(userStore.getOnePodcastProgress(anyUser.id, epDownloaded), null, 'per-user rows purged');
  assert.deepStrictEqual({ ...userStore.getPodcastPlayed(anyUser.id) }, {}, 'played rows purged');

  assert.strictEqual((await del(`/api/podcasts/subscriptions/${subId}`)).status, 404, 'second delete 404s');
});

// ---- v1.72 (intake ruling 5): show pins in the Playlists surface ------------

test('v1.72 show pins: existence-gated POST, idempotent re-pin, pre-shaped GET payload, DELETE, reorder, wrong-user isolation, unsubscribe carrier', async () => {
  const { userStore, __mintTestSession } = require('../../server');
  // Fresh subscriptions of our own - the suite's earlier tests DELETE the
  // shared subId, so this test never leans on it. Two rows: reorder needs
  // a pair and the unsubscribe carrier needs a survivor to prove scoping.
  const rA = await postJson('/api/podcasts/subscriptions', { feedUrl: 'https://feeds.invalid/rss/pinshow?a=1' });
  assert.strictEqual(rA.status, 201);
  const subId = (await rA.json()).id;
  const r2 = await postJson('/api/podcasts/subscriptions', { feedUrl: 'https://feeds.invalid/rss/second?y=2' });
  assert.strictEqual(r2.status, 201);
  const subB = (await r2.json()).id;

  assert.strictEqual((await postJson('/api/podcasts/pins', { subId: 'nope' })).status, 404, 'phantom subscription refused');
  const p1 = await postJson('/api/podcasts/pins', { subId });
  assert.strictEqual(p1.status, 200);
  const rec1 = await p1.json();
  assert.strictEqual(rec1.id, subId);
  assert.strictEqual(rec1.order, 0);
  const again = await postJson('/api/podcasts/pins', { subId });
  assert.strictEqual((await again.json()).order, 0, 'idempotent re-pin returns the EXISTING record');
  await postJson('/api/podcasts/pins', { subId: subB });

  // GET pre-shapes for the shared renderer: href wins, art is the show cover.
  const list = await (await get('/api/podcasts/pins')).json();
  assert.strictEqual(list.length, 2);
  assert.strictEqual(list[0].href, `/podcasts?show=${subId}`);
  assert.strictEqual(list[0].channelAvatarUrl, `/podcastart/${subId}`);
  assert.ok(list[0].channelDir.length > 0, 'a non-empty channelDir keeps the shared renderer contract');

  // Reorder: B first.
  const ro = await postJson('/api/podcasts/pins/reorder', { orderedIds: [subB, subId] });
  assert.strictEqual(ro.status, 200);
  assert.deepStrictEqual((await (await get('/api/podcasts/pins')).json()).map((p) => p.id), [subB, subId]);
  assert.strictEqual((await postJson('/api/podcasts/pins/reorder', { orderedIds: [42] })).status, 400);

  // Wrong-user: a second session sees no pins and its unpin never crosses.
  const second = __mintTestSession({ username: 'showPinOther' });
  const otherList = await (await fetch(`${base}/api/podcasts/pins`, { headers: { Cookie: second.cookie } })).json();
  assert.deepStrictEqual(otherList, [], 'pins are per-user');
  const otherDel = await fetch(`${base}/api/podcasts/pins/${subId}`, { method: 'DELETE', headers: { Cookie: second.cookie } });
  assert.strictEqual(otherDel.status, 404, 'unpinning a pin you do not hold is a 404, never a cross-user delete');
  assert.strictEqual(userStore.getPodcastPins((await (async () => second.user)()).id).length, 0);
  assert.strictEqual((await (await get('/api/podcasts/pins')).json()).length, 2, 'our pins survived');

  // DELETE our own.
  assert.strictEqual((await fetch(`${base}/api/podcasts/pins/${subB}`, { method: 'DELETE' })).status, 200);
  assert.deepStrictEqual((await (await get('/api/podcasts/pins')).json()).map((p) => p.id), [subId]);

  // The unsubscribe carrier: deleting the pinned show retires its pin rows
  // (both rows LIVE at the destructive moment - the pin exists right now).
  assert.strictEqual((await del(`/api/podcasts/subscriptions/${subId}`)).status, 200);
  assert.deepStrictEqual((await (await get('/api/podcasts/pins')).json()), [], 'the pin retired with the subscription');
});
