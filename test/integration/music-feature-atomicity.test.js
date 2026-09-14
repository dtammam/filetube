'use strict';

// [INTEGRATION] Wave 5 of the relational-migration arc (music) - the music
// namespace is four tables behind a feature store whose writes ride the doc
// commit. Through the REAL routes and scan, populate first, then the failure
// axis, then the happy path:
//   - POST /api/music/config whose doc save FAILS leaves the root list untouched
//     (500, never a hang); the committed POST replaces it;
//   - POST /api/folders/music-flag (the "show in Music" mark) whose doc save
//     FAILS leaves the marks untouched; the committed write lands one row;
//   - the scan merge whose doc save FAILS leaves the track rows untouched; the
//     committed pass indexes the file and an unchanged pass writes nothing;
//   - the bundle carries `music` in its container shape (the marks included),
//     a restore round-trips it, and a malformed `music` is a 400 BEFORE the wipe.

const { DATA_DIR } = require('../helpers/isolate-data-dir');
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, __resetDatabaseForTests, __failNextSaveForTests, scanMusic, musicDb, getMediaId } = require('../../server');
const { seedState } = require('../helpers/seed-state');
const { authenticateFetch } = require('../helpers/auth');
const { readPersistedDatabase } = require('../../lib/db/sqlite');

let server;
let base;
before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  authenticateFetch(server, base);
});
after(async () => { server.closeAllConnections?.(); await new Promise((r) => server.close(r)); });
beforeEach(() => __resetDatabaseForTests());

const post = (url, body) => fetch(`${base}${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const withTimeout = (p, ms = 4000) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`no response within ${ms}ms (the handler hung)`)), ms))]);
const settings = { scanIntervalMinutes: 0, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 0 };
const empty = { folders: [], tracks: {}, settings: {}, channels: {} };

test('POST /api/music/config: a FAILED doc save leaves the root list untouched and answers 500; the committed POST replaces it', async () => {
  const A = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-mu-a-'));
  const B = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-mu-b-'));
  seedState({ folders: [], folderSettings: {}, metadata: {}, settings, music: { ...empty, folders: [A] } });
  assert.deepStrictEqual(musicDb.read().folders, [A], 'populated');
  __failNextSaveForTests(new Error('simulated save failure'));
  const failed = await withTimeout(post('/api/music/config', { folders: [B] }));
  assert.strictEqual(failed.status, 500, await failed.text());
  assert.deepStrictEqual(musicDb.read().folders, [A], 'a failed save wrote nothing');
  assert.deepStrictEqual(readPersistedDatabase(DATA_DIR).music.folders, [A], 'on disk too');
  const ok = await withTimeout(post('/api/music/config', { folders: [B] }));
  assert.strictEqual(ok.status, 200, await ok.text());
  assert.deepStrictEqual(musicDb.read().folders, [B]);
});

test('POST /api/folders/music-flag: a FAILED doc save leaves the marks untouched (500, never a hang); the committed write lands one row; a clear removes it', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-mu-flag-'));
  const filePath = path.join(root, 'Chan', 'a.mp3');
  fs.mkdirSync(path.dirname(filePath));
  fs.writeFileSync(filePath, 'bytes');
  const id = getMediaId(filePath);
  seedState({
    folders: [root], folderSettings: {}, settings,
    metadata: { [id]: { id, name: 'a.mp3', title: 'a', filePath, folderName: 'Chan', rootFolder: root, size: 5, ext: '.mp3', type: 'audio', addedAt: Date.now(), duration: 10 } },
    music: { ...empty, channels: { Other: 'off' } },
  });
  __failNextSaveForTests(new Error('simulated save failure'));
  const failed = await withTimeout(post('/api/folders/music-flag', { folderName: 'Chan', music: 'on' }));
  assert.strictEqual(failed.status, 500, await failed.text());
  assert.deepStrictEqual(musicDb.read().channels, { Other: 'off' }, 'a failed save wrote nothing');
  const ok = await withTimeout(post('/api/folders/music-flag', { folderName: 'Chan', music: 'on' }));
  assert.strictEqual(ok.status, 200, await ok.text());
  assert.deepStrictEqual(musicDb.read().channels, { Other: 'off', Chan: 'on' });
  const cleared = await withTimeout(post('/api/folders/music-flag', { folderName: 'Chan', music: null }));
  assert.strictEqual(cleared.status, 200, await cleared.text());
  assert.deepStrictEqual(musicDb.read().channels, { Other: 'off' });
});

test('the scan merge: a FAILED doc save leaves the track rows untouched; the committed pass indexes the file; an unchanged pass writes nothing', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-mu-scan-'));
  fs.mkdirSync(path.join(root, 'Artist', 'Album'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Artist', 'Album', '01 Song.mp3'), 'bytes');
  seedState({ folders: [], folderSettings: {}, metadata: {}, settings, music: { ...empty, folders: [root] } });
  __failNextSaveForTests(new Error('simulated save failure'));
  await scanMusic().catch(() => {});
  assert.deepStrictEqual(musicDb.read().tracks, {}, 'a failed merge indexed nothing');
  await scanMusic();
  assert.strictEqual(Object.keys(musicDb.read().tracks).length, 1, 'the committed pass indexed the track');
  assert.deepStrictEqual(musicDb.syncFrom(musicDb.read()), { rowsWritten: 0, rowsDeleted: 0 }, 'an unchanged pass writes nothing (the diff, not a rewrite)');
});

test('the bundle carries `music` (marks included) and a restore round-trips it; a malformed `music` is a 400 BEFORE the wipe', async () => {
  const ns = { folders: ['/music'], tracks: { t1: { id: 't1', title: 'One', artist: 'A', album: 'Al', filePath: '/music/A/Al/one.flac', rootFolder: '/music' } }, settings: { x: 1 }, channels: { NESTALGIA: 'on' } };
  seedState({ folders: [], folderSettings: {}, metadata: {}, settings, music: ns });
  const bundle = await (await fetch(`${base}/api/admin/backup`)).json();
  delete bundle.users;
  assert.deepStrictEqual(bundle.music, ns);
  for (const bad of [['x'], { playlists: {} }, { tracks: { '': {} } }, { channels: ['x'] }, { folders: [7] }]) {
    const r = await withTimeout(post('/api/admin/restore', { ...bundle, music: bad }));
    assert.strictEqual(r.status, 400, `${JSON.stringify(bad)}: ${await r.clone().text()}`);
    assert.deepStrictEqual(musicDb.read().channels, { NESTALGIA: 'on' }, 'the live rows survived the refusal');
  }
  musicDb.replaceAll({ folders: ['/scratch'] });
  const r = await post('/api/admin/restore', bundle);
  assert.strictEqual(r.status, 200, await r.text());
  assert.deepStrictEqual(musicDb.read(), ns, 'the own export restored verbatim');
  const without = { ...bundle };
  delete without.music;
  assert.strictEqual((await post('/api/admin/restore', without)).status, 200);
  assert.deepStrictEqual(musicDb.read(), empty, 'a bundle without the key restores to an empty namespace');
});
