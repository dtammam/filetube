'use strict';

// [INTEGRATION] v1.378.0 music stations W2 (plan docs/exec-plans/completed/2026-10-09-music-stations.md): the
// station routes through a real server on an isolated DATA_DIR with projected library audio (the REAL
// /api/music shape, LESSONS 2). The plan's falsifiers: a restricted member's station list and counts
// differ from the admin's EXACTLY by the hidden songs (D9), a Reggae station plays no non-reggae song in
// its first 20 picks through the real radio route, a station that matches nothing cannot be saved, the
// writes are the session user's own and bounded, and hiding is per user (D8).

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-stations-'));
const DATA_DIR = process.env.DATA_DIR;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, updateDatabase, userStore, __mintTestSession } = require('../../server');
const { seedState } = require('../helpers/seed-state');
const { authenticateFetch } = require('../helpers/auth');

let server, base, auth, member, other;
const ROOT = path.join(DATA_DIR, 'ytdlp');
const SECRET_ROOT = path.join(ROOT, 'secret');

function audioItem(id, folderName, artist, genre, title, extra) {
  const tags = { title: title || (id + ' title'), artist, date: '2020' };
  if (genre) tags.genre = genre;
  return Object.assign({
    id, type: 'audio', title: title || (id + ' title'), name: id + '.mp3',
    filePath: path.join(ROOT, folderName, id + '.mp3'), rootFolder: ROOT, folderName, channelName: artist,
    duration: 200, hasThumbnail: true, ext: '.mp3', addedAt: 1788000000000 + Number(id.replace(/\D/g, '') || 0) * 1000, tags,
  }, extra || {});
}

before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  auth = authenticateFetch(server, base);
  seedState({ folders: [ROOT], folderSettings: {}, metadata: {}, liked: [], settings: { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30 } });
  await updateDatabase((db) => {
    db.metadata = {};
    // Reggae: 45 songs from 4 artists, by genre tag (30) and by title words (15: dub / dancehall)
    for (let i = 0; i < 30; i += 1) db.metadata['rg' + i] = audioItem('rg' + i, 'reggae', 'Reggae Band ' + (i % 3), 'Reggae');
    for (let i = 0; i < 15; i += 1) db.metadata['dh' + i] = audioItem('dh' + i, 'island', 'Island Sound', 'Music', 'Dancehall Dub Session ' + i);
    // Rock: 50 songs from 5 artists
    for (let i = 0; i < 50; i += 1) db.metadata['rk' + i] = audioItem('rk' + i, 'rock', 'Rocker ' + (i % 5), 'Rock');
    // a hidden folder with 10 MORE reggae songs by a 5th artist: the member must never see them anywhere
    for (let i = 0; i < 10; i += 1) db.metadata['sec' + i] = Object.assign(audioItem('sec' + i, 'secret', 'Secret Reggae', 'Reggae'), { filePath: path.join(SECRET_ROOT, 'sec' + i + '.mp3') });
    // a hidden folder that is the ONLY source of a Jazz station (40 songs, 3 artists): absent for the member entirely
    for (let i = 0; i < 40; i += 1) db.metadata['jz' + i] = Object.assign(audioItem('jz' + i, 'secret', 'Jazz Cat ' + (i % 3), 'Jazz'), { filePath: path.join(SECRET_ROOT, 'jz' + i + '.mp3') });
    return true;
  });
  member = __mintTestSession({ username: 'stationsmember', role: 'member' });
  userStore.setRestrictions(member.user.id, [{ kind: 'path', value: SECRET_ROOT }]);
  other = __mintTestSession({ username: 'stationsother', role: 'member' });
});

after(async () => {
  auth.restore();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

async function api(method, p, body, cookie) {
  const init = { method, headers: {} };
  if (cookie) init.headers.Cookie = cookie;
  if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
  const r = await fetch(base + p, init);
  return { status: r.status, body: await r.json() };
}
const list = (cookie) => api('GET', '/api/music/stations', undefined, cookie).then((r) => { assert.strictEqual(r.status, 200); return r.body.stations; });
const find = (arr, key) => arr.find((s) => s.key === key);

test('W2 (D9): the member\'s stations and counts differ from the admin\'s EXACTLY by the hidden songs; a station the member cannot fill is not listed; no art tile names a hidden song', async () => {
  const admin = await list();
  const mem = await list(member.cookie);
  const aReg = find(admin, 's:reggae'); const mReg = find(mem, 's:reggae');
  assert.ok(aReg && mReg, 'both see Reggae: ' + admin.map((s) => s.key).join(' ') + ' | ' + mem.map((s) => s.key).join(' '));
  assert.strictEqual(aReg.count, 55, 'admin: 30 tagged + 15 by title + 10 hidden');
  assert.strictEqual(mReg.count, 45, 'member: exactly the 10 hidden songs fewer');
  assert.strictEqual(find(admin, 'g:rock').count, find(mem, 'g:rock').count, 'a station with no hidden song counts the same');
  assert.ok(find(admin, 's:jazz'), 'admin sees the Jazz station (its songs are all in the hidden folder; Jazz is a style word, so the key is the style\'s)');
  assert.ok(!find(mem, 's:jazz') && !find(mem, 'g:jazz'), 'the member never learns a Jazz station exists');
  assert.ok(!find(mem, 'g:reggae'), 'the style names the genre: no second Reggae station');
  for (const s of mem) for (const id of s.artIds) assert.ok(!/^(sec|jz)/.test(id), 'a hidden song\'s art id leaked into ' + s.key + ': ' + id);
  // the shape every card reads
  for (const s of mem) {
    assert.ok(typeof s.name === 'string' && s.name && typeof s.count === 'number' && Array.isArray(s.artIds) && s.artIds.length <= 4 && ['main', 'more'].includes(s.group) && typeof s.hidden === 'boolean', JSON.stringify(s));
  }
  assert.deepStrictEqual(mem.filter((s) => s.kind === 'builtin').map((s) => s.key), ['recent'], 'built-ins the member can fill: Recently added (no likes, no counts yet: Favorites is empty; uploads carry no release year: no decade)');
  assert.strictEqual(find(mem, 'recent').count, 45 + 50, 'the member\'s Recently added holds only visible songs');
});

test('W2 (the Reggae falsifier): a Reggae station plays NO non-reggae song in its first 20 picks through the real route, for the member too; a strict custom station never leaves its songs', async () => {
  const reggae = new Set();
  for (let i = 0; i < 30; i += 1) reggae.add('rg' + i);
  for (let i = 0; i < 15; i += 1) reggae.add('dh' + i);
  for (let i = 0; i < 10; i += 1) reggae.add('sec' + i);
  for (const cookie of [null, member.cookie]) {
    const played = [];
    for (let b = 0; b < 4; b += 1) {
      const r = await api('GET', '/api/music/radio?seed=' + encodeURIComponent('station:s:reggae') + '&count=5&rng=' + (b + 1) + (played.length ? '&exclude=' + played.join(',') : ''), undefined, cookie);
      assert.strictEqual(r.status, 200);
      for (const t of r.body.items) played.push(t.id);
    }
    assert.strictEqual(played.length, 20);
    assert.ok(played.every((id) => reggae.has(id)), (cookie ? 'member' : 'admin') + ': a non-reggae song in the first 20: ' + played.join(' '));
    if (cookie) assert.ok(!played.some((id) => id.startsWith('sec')), 'the member never gets a hidden reggae song');
  }
  // an unknown station key answers an empty batch, like an unknown seed
  const none = await api('GET', '/api/music/radio?seed=' + encodeURIComponent('station:s:nope'));
  assert.deepStrictEqual([none.status, none.body], [200, { items: [] }]);
});

test('W2 (D7): create, list, edit, delete the viewer\'s own station; another user cannot see or edit it; a station matching nothing is refused; the count preview', async () => {
  const bad = await api('POST', '/api/music/stations', { name: 'Nothing', words: ['zzzqqq'] }, other.cookie);
  assert.deepStrictEqual([bad.status, bad.body.error], [400, 'this station matches no songs']);
  const prev = await api('POST', '/api/music/stations/preview', { name: 'x', artists: ['Rocker 1', 'Rocker 2'] }, other.cookie);
  assert.deepStrictEqual([prev.status, prev.body], [200, { count: 20, artists: 2 }]);
  const prev0 = await api('POST', '/api/music/stations/preview', { name: 'x', words: ['zzzqqq'] }, other.cookie);
  assert.deepStrictEqual([prev0.status, prev0.body], [200, { count: 0, artists: 0 }], 'a preview may say nothing matches');
  const made = await api('POST', '/api/music/stations', { name: ' Two  Rockers ', artists: ['Rocker 1', 'Rocker 2'], strict: true }, other.cookie);
  assert.strictEqual(made.status, 201, JSON.stringify(made.body));
  const st = made.body.station;
  assert.ok(/^c:[0-9a-f]{12}$/.test(st.key), st.key);
  assert.deepStrictEqual([st.name, st.kind, st.count, st.strict, st.def.artists, st.def.strict], ['Two Rockers', 'custom', 20, true, ['Rocker 1', 'Rocker 2'], true]);
  const id = st.def.id;
  const mine = await list(other.cookie);
  assert.ok(find(mine, st.key), 'listed for its owner');
  assert.ok(!find(await list(member.cookie), st.key), 'never listed for another user');
  assert.ok(!find(await list(), st.key), 'nor for admin');
  // another user cannot edit or delete it
  const notMine = await api('PUT', '/api/music/stations/' + id, { name: 'Hijack', artists: ['Rocker 1'] }, member.cookie);
  assert.strictEqual(notMine.status, 404);
  await api('DELETE', '/api/music/stations/' + id, undefined, member.cookie);
  assert.ok(find(await list(other.cookie), st.key), 'a stranger\'s DELETE is a no-op');
  // the owner edits it; a strict station plays only its songs through the radio route
  const edited = await api('PUT', '/api/music/stations/' + id, { name: 'One Rocker', artists: ['Rocker 1'], strict: true }, other.cookie);
  assert.strictEqual(edited.status, 200);
  assert.deepStrictEqual([edited.body.station.name, edited.body.station.count], ['One Rocker', 10]);
  const played = [];
  for (let b = 0; b < 4; b += 1) {
    const r = await api('GET', '/api/music/radio?seed=' + encodeURIComponent('station:' + st.key) + '&count=5&rng=' + (b + 1) + (played.length ? '&exclude=' + played.join(',') : ''), undefined, other.cookie);
    for (const t of r.body.items) played.push(t.id);
  }
  assert.strictEqual(played.length, 20, 'never silent once its 10 songs are spent (it repeats)');
  assert.ok(played.every((id) => id.startsWith('rk') && Number(id.slice(2)) % 5 === 1), 'strict: Rocker 1 only, repeated: ' + played.join(' '));
  assert.strictEqual(new Set(played.slice(0, 10)).size, 10, 'all 10 before any repeat');
  // an edit that would match nothing is refused and the station is unchanged
  const empty = await api('PUT', '/api/music/stations/' + id, { name: 'One Rocker', words: ['zzzqqq'] }, other.cookie);
  assert.strictEqual(empty.status, 400);
  assert.strictEqual(find(await list(other.cookie), st.key).count, 10);
  // another user's station seed is not this viewer's: an empty batch
  const foreign = await api('GET', '/api/music/radio?seed=' + encodeURIComponent('station:' + st.key), undefined, member.cookie);
  assert.deepStrictEqual(foreign.body, { items: [] });
  const gone = await api('DELETE', '/api/music/stations/' + id, undefined, other.cookie);
  assert.deepStrictEqual([gone.status, gone.body], [200, { ok: true }]);
  assert.ok(!find(await list(other.cookie), st.key));
  const badId = await api('PUT', '/api/music/stations/not-an-id', { name: 'x', artists: ['Rocker 1'] }, other.cookie);
  assert.strictEqual(badId.status, 404);
});

test('W2 bounds: hostile and oversized definitions are 400s and nothing is saved; the name comes back as sent (escaping is the renderer\'s)', async () => {
  const before = (await list(other.cookie)).length;
  for (const body of [
    { name: '', artists: ['Rocker 1'] }, { name: 'x'.repeat(41), artists: ['Rocker 1'] }, { name: 'A' },
    { name: 'A', artists: 'Rocker 1' }, { name: 'A', artists: new Array(21).fill('Rocker 1') }, { name: 'A', words: ['w'.repeat(61)] },
    { name: 'A', artists: ['Rocker 1'], yearFrom: 2000, yearTo: 1990 }, { name: 'A', artists: ['Rocker 1'], yearFrom: 'soon' }, ['a'], 'x',
  ]) {
    const r = await api('POST', '/api/music/stations', body, other.cookie);
    assert.strictEqual(r.status, 400, JSON.stringify(body).slice(0, 60));
  }
  assert.strictEqual((await list(other.cookie)).length, before, 'nothing saved');
  const hostile = await api('POST', '/api/music/stations', { name: '<img src=x onerror=alert(1)>', artists: ['Rocker 3'], exclude: ['__proto__'] }, other.cookie);
  assert.strictEqual(hostile.status, 201);
  assert.strictEqual(hostile.body.station.name, '<img src=x onerror=alert(1)>', 'stored as text; the client escapes on render');
  assert.deepStrictEqual(hostile.body.station.def.exclude, ['__proto__']);
  await api('DELETE', '/api/music/stations/' + hostile.body.station.def.id, undefined, other.cookie);
});

test('W2 (D8): hiding is per user and undoable; a custom station cannot be hidden; an unknown key is a 404', async () => {
  const h = await api('POST', '/api/music/stations/hidden', { key: 'g:rock', hidden: true }, member.cookie);
  assert.deepStrictEqual([h.status, h.body], [200, { ok: true, key: 'g:rock', hidden: true }]);
  assert.strictEqual(find(await list(member.cookie), 'g:rock').hidden, true, 'flagged for the member');
  assert.strictEqual(find(await list(), 'g:rock').hidden, false, 'not for admin');
  const un = await api('POST', '/api/music/stations/hidden', { key: 'g:rock', hidden: false }, member.cookie);
  assert.strictEqual(un.status, 200);
  assert.strictEqual(find(await list(member.cookie), 'g:rock').hidden, false);
  assert.strictEqual((await api('POST', '/api/music/stations/hidden', { key: 's:jazz', hidden: true }, member.cookie)).status, 404, 'a station the member cannot see is unknown to them');
  assert.strictEqual((await api('POST', '/api/music/stations/hidden', { key: 's:jazz', hidden: true })).status, 200, 'admin can hide it');
  await api('POST', '/api/music/stations/hidden', { key: 's:jazz', hidden: false });
  assert.strictEqual((await api('POST', '/api/music/stations/hidden', { key: 'c:abcdefabcdef', hidden: true }, member.cookie)).status, 400);
  assert.strictEqual((await api('POST', '/api/music/stations/hidden', { key: 'g:rock', hidden: 'yes' }, member.cookie)).status, 400);
  assert.strictEqual((await api('POST', '/api/music/stations/hidden', { key: 'x'.repeat(121), hidden: true }, member.cookie)).status, 400);
});

test('W2 rate bound: a flood of previews from one user is a 429; another user is unaffected', async () => {
  const flood = __mintTestSession({ username: 'stationsflood', role: 'member' });
  let okN = 0; let refused = 0;
  for (let i = 0; i < 90; i += 1) {
    const r = await api('POST', '/api/music/stations/preview', { name: 'x', artists: ['Rocker 1'] }, flood.cookie);
    if (r.status === 200) okN += 1; else if (r.status === 429) refused += 1; else assert.fail('unexpected ' + r.status);
  }
  assert.ok(okN >= 60 && okN <= 66, 'the burst (60) plus a little refill: ' + okN);
  assert.ok(refused >= 24, 'the rest refused: ' + refused);
  assert.strictEqual((await api('POST', '/api/music/stations/preview', { name: 'x', artists: ['Rocker 1'] }, other.cookie)).status, 200);
});

// ---- gate r1 (adversary W3 M40, security W1) -----------------------------------------------------------
test('gate r1 adversary M40: a user keeps at most CUSTOM_MAX stations - the 51st create is refused with nothing saved', async () => {
  const hoarder = __mintTestSession({ username: 'stationshoarder', role: 'member' });
  for (let i = 0; i < 50; i += 1) {
    const r = await api('POST', '/api/music/stations', { name: 'S' + i, artists: ['Rocker ' + (i % 5)] }, hoarder.cookie);
    assert.strictEqual(r.status, 201, 'create ' + i + ': ' + JSON.stringify(r.body));
  }
  const over = await api('POST', '/api/music/stations', { name: 'S50', artists: ['Rocker 1'] }, hoarder.cookie);
  assert.deepStrictEqual([over.status, over.body.error], [400, 'you can keep at most 50 stations']);
  assert.strictEqual(userStore.getMusicStations(hoarder.user.id).length, 50);
});

test('gate r1 security W1: the station list and a station radio batch share the per-user bucket (429 after the burst); another user is unaffected; a song radio batch is not bounded by it', async () => {
  const flood = __mintTestSession({ username: 'stationslist', role: 'member' });
  let okN = 0; let refused = 0;
  for (let i = 0; i < 80; i += 1) {
    const r = await api('GET', '/api/music/stations', undefined, flood.cookie);
    if (r.status === 200) okN += 1; else if (r.status === 429) refused += 1; else assert.fail('unexpected ' + r.status);
  }
  assert.ok(okN >= 60 && okN <= 70, 'the burst (60) plus a little refill: ' + okN);
  assert.ok(refused >= 10, 'then refused: ' + refused);
  const batch = await api('GET', '/api/music/radio?seed=' + encodeURIComponent('station:g:rock') + '&count=1', undefined, flood.cookie);
  assert.strictEqual(batch.status, 429, 'a station batch draws from the same bucket');
  const song = await api('GET', '/api/music/radio?seed=' + encodeURIComponent('track:rk0') + '&count=1', undefined, flood.cookie);
  assert.strictEqual(song.status, 200, 'a song radio batch is not behind the station bucket');
  const preview = await api('POST', '/api/music/stations/preview', { name: 'x', artists: ['Rocker 1'] }, flood.cookie);
  assert.strictEqual(preview.status, 200, 'the editor\'s preview has its own bucket (gate r2 qa S10): a spent station bucket never blocks typing, and fast typing never starves a station batch');
  assert.strictEqual((await api('GET', '/api/music/stations', undefined, other.cookie)).status, 200, 'another user\'s bucket is its own');
});
