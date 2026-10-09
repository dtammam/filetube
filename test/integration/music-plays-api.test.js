'use strict';

// [INTEGRATION] v1.378.0 music stations W1 (plan docs/exec-plans/completed/2026-10-09-music-stations.md):
// POST /api/music/plays through a real server on an isolated DATA_DIR with projected library audio
// (the REAL /api/music shape, LESSONS 2): the session user's own counts only, every id validated against
// the caller's VISIBLE list (a hidden-folder id is a 404 with nothing written - LESSONS 10), the body
// bounds, the per-user rate bound, and the counts reaching the radio picker's draw (D3) through the real
// route.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-plays-'));
const DATA_DIR = process.env.DATA_DIR;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, updateDatabase, userStore, __mintTestSession } = require('../../server');
const { seedState } = require('../helpers/seed-state');
const { authenticateFetch } = require('../helpers/auth');

let server, base, auth, member, other;
const ROOT = path.join(DATA_DIR, 'ytdlp');
const SECRET_ROOT = path.join(ROOT, 'secret');

function audioItem(id, folderName, artist, genre, extra) {
  const tags = { title: id + ' title', artist, genre, date: '1990' };
  return Object.assign({
    id, type: 'audio', title: id + ' title', name: id + '.mp3',
    filePath: path.join(ROOT, folderName, id + '.mp3'), rootFolder: ROOT, folderName, channelName: artist,
    duration: 200, hasThumbnail: true, ext: '.mp3', addedAt: 1788000000000, tags,
  }, extra || {});
}

before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  auth = authenticateFetch(server, base);
  seedState({ folders: [ROOT], folderSettings: {}, metadata: {}, liked: [], settings: { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30 } });
  await updateDatabase((db) => {
    db.metadata = {};
    for (let i = 0; i < 12; i += 1) db.metadata['rk' + i] = audioItem('rk' + i, 'rock', 'Rocker ' + (i % 4), 'Rock');
    for (let i = 0; i < 3; i += 1) db.metadata['sec' + i] = Object.assign(audioItem('sec' + i, 'secret', 'Rocker 1', 'Rock'), { filePath: path.join(SECRET_ROOT, 'sec' + i + '.mp3') });
    return true;
  });
  member = __mintTestSession({ username: 'playsmember', role: 'member' });
  userStore.setRestrictions(member.user.id, [{ kind: 'path', value: SECRET_ROOT }]);
  other = __mintTestSession({ username: 'playsother', role: 'member' });
});

after(async () => {
  auth.restore();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

async function post(body, cookie) {
  const r = await fetch(base + '/api/music/plays', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, cookie ? { Cookie: cookie } : {}), body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}
const counts = (userId) => userStore.getMusicPlays(userId);
const adminId = () => auth.user.id;

test('W1: one event and a batch are counted for the session user only; the shape comes back', async () => {
  const one = await post({ id: 'rk0', kind: 'play' });
  assert.deepStrictEqual([one.status, one.body], [200, { ok: true, recorded: 1 }]);
  const batch = await post({ events: [{ id: 'rk0', kind: 'finish' }, { id: 'rk1', kind: 'skip' }, { id: 'rk1', kind: 'skip' }] });
  assert.deepStrictEqual([batch.status, batch.body], [200, { ok: true, recorded: 3 }]);
  const c = counts(adminId());
  assert.deepStrictEqual([c.rk0.plays, c.rk0.finishes, c.rk1.skips, c.rk1.plays], [1, 1, 2, 0]);
  assert.ok(typeof c.rk0.lastPlayedAt === 'string' && c.rk0.lastPlayedAt, 'the play stamped last_played_at');
  assert.deepStrictEqual(counts(member.user.id), Object.create(null), 'another user has no counts');
  // a chapter id is its own row (the client reports the segment it played)
  await updateDatabase((db) => { db.metadata.ch = Object.assign(audioItem('ch', 'rock', 'Rocker 0', 'Rock'), { duration: 600, chapters: [{ startTime: 0, title: 'a' }, { startTime: 300, title: 'b' }] }); return true; });
  const chap = await post({ id: 'ch::c1', kind: 'play' });
  assert.strictEqual(chap.status, 200);
  assert.strictEqual(counts(adminId())['ch::c1'].plays, 1);
  assert.strictEqual(counts(adminId()).ch, undefined, 'the file id itself got nothing');
});

test('W1 (LESSONS 10): a hidden-folder id is a 404 with NOTHING written, even beside visible ids; an invented id too; admin reaches the same id (discrimination)', async () => {
  const hidden = await post({ events: [{ id: 'rk2', kind: 'play' }, { id: 'sec0', kind: 'play' }] }, member.cookie);
  assert.strictEqual(hidden.status, 404);
  assert.deepStrictEqual(counts(member.user.id), Object.create(null), 'the visible id beside the hidden one was not written either');
  const ghost = await post({ id: 'nope', kind: 'play' }, member.cookie);
  assert.strictEqual(ghost.status, 404);
  const ok = await post({ id: 'rk2', kind: 'play' }, member.cookie);
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(counts(member.user.id).rk2.plays, 1);
  const adm = await post({ id: 'sec0', kind: 'play' });
  assert.strictEqual(adm.status, 200, 'admin can see the secret folder');
  assert.strictEqual(counts(adminId()).sec0.plays, 1);
  assert.strictEqual(counts(member.user.id).sec0, undefined);
});

test('W1 bounds: a bad kind, a missing id, an over-long id, an empty or oversized batch, a non-object body are 400s', async () => {
  for (const body of [{ id: 'rk0', kind: 'like' }, { kind: 'play' }, { id: 'x'.repeat(201), kind: 'play' }, { events: [] }, { events: new Array(21).fill({ id: 'rk0', kind: 'play' }) }, [{ id: 'rk0', kind: 'play' }], 'rk0']) {
    const r = await post(body);
    assert.strictEqual(r.status, 400, JSON.stringify(body).slice(0, 60));
  }
  // the 20-event cap is inclusive
  const full = await post({ events: new Array(20).fill({ id: 'rk3', kind: 'skip' }) }, other.cookie);
  assert.strictEqual(full.status, 200);
  assert.strictEqual(counts(other.user.id).rk3.skips, 20);
});

test('W1 rate bound: a flood from one user is a 429 after the bucket empties; another user is unaffected; nothing is written for a refused request', async () => {
  const flood = __mintTestSession({ username: 'playsflood', role: 'member' });
  let okN = 0; let refused = 0;
  for (let i = 0; i < 80; i += 1) {
    const r = await post({ id: 'rk4', kind: 'play' }, flood.cookie);
    if (r.status === 200) okN += 1; else if (r.status === 429) refused += 1; else assert.fail('unexpected ' + r.status);
  }
  assert.ok(okN >= 60 && okN <= 62, 'the burst capacity (60) plus at most the refill during the loop: ' + okN);
  assert.ok(refused >= 18, 'the rest were refused: ' + refused);
  assert.strictEqual(counts(flood.user.id).rk4.plays, okN, 'exactly the accepted requests were counted');
  const fresh = await post({ id: 'rk4', kind: 'play' }, other.cookie);
  assert.strictEqual(fresh.status, 200, 'another user\'s bucket is its own');
});

test('W1 -> D3: the counts reach the radio draw through the real route - a song skipped 3 times and never finished is left out while the station has other songs; 2 skips weigh it down', async () => {
  const skipper = __mintTestSession({ username: 'playsskipper', role: 'member' });
  // rk5 skipped 3x (left out), rk6 skipped 2x (0.3x), the rest untouched
  await post({ events: [{ id: 'rk5', kind: 'skip' }, { id: 'rk5', kind: 'skip' }, { id: 'rk5', kind: 'skip' }, { id: 'rk6', kind: 'skip' }, { id: 'rk6', kind: 'skip' }] }, skipper.cookie);
  const tally = {};
  for (let s = 1; s <= 300; s += 1) {
    const r = await fetch(base + '/api/music/radio?seed=' + encodeURIComponent('genre:Rock') + '&count=1&rng=' + s, { headers: { Cookie: skipper.cookie } });
    const d = await r.json();
    const id = d.items[0] && d.items[0].id;
    tally[id] = (tally[id] || 0) + 1;
  }
  assert.strictEqual(tally.rk5, undefined, 'the 3x-skipped song never played in 300 single-pick draws: ' + JSON.stringify(tally));
  const others = Object.keys(tally).filter((id) => id !== 'rk6').map((id) => tally[id]);
  const mean = others.reduce((x, y) => x + y, 0) / others.length;
  assert.ok((tally.rk6 || 0) < mean * 0.7, 'the 2x-skipped song drew well under the others (0.3x): rk6 ' + (tally.rk6 || 0) + ' vs mean ' + mean.toFixed(1));
  // a different user's counts never shape this viewer's station: admin (no skips) still draws rk5
  let adminRk5 = 0;
  for (let s = 1; s <= 120; s += 1) {
    const r = await fetch(base + '/api/music/radio?seed=' + encodeURIComponent('genre:Rock') + '&count=1&rng=' + s); // the admin cookie (authenticateFetch)
    const d = await r.json();
    if (d.items[0] && d.items[0].id === 'rk5') adminRk5 += 1;
  }
  assert.ok(adminRk5 > 0, 'admin, with no skips of their own, still draws rk5 (another user\'s skips do not reach them)');
});
