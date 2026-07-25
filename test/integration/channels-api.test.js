'use strict';

// [INTEGRATION] v1.47: GET /api/channels — the grouped channel list backing
// the Roku Channels view. Pure read; no ffmpeg involved.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-channels-'));

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, saveDatabase, getMediaId } = require('../../server');
const { authenticateFetch } = require('../helpers/auth');

let server;
let base;
let mediaDir;
let otherRoot;

function item(root, folder, name, extra = {}) {
  const filePath = path.join(root, folder, name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, `bytes-${name}`);
  const id = getMediaId(filePath);
  return {
    id, name, title: name, filePath,
    folderName: folder,
    size: 10, ext: path.extname(name), type: 'video', addedAt: 1000,
    duration: 1, hasThumbnail: false, artist: '', needsTranscode: false,
    rootFolder: root,
    ...extra,
  };
}

let hiddenRoot;

before(async () => {
  mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-chan-media-'));
  otherRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-chan-other-'));
  hiddenRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-chan-hidden-'));
  const items = [
    item(mediaDir, 'planetclue', 'a.mp4', { channelName: 'Planet Clue', channelAvatarUrl: 'https://example.test/pc.jpg', addedAt: 2000 }),
    item(mediaDir, 'planetclue', 'b.mp4', { channelName: 'Planet Clue', channelAvatarUrl: 'https://example.test/pc.jpg' }),
    item(mediaDir, 'homemovies', 'c.mp4'), // no channelName/avatar: falls back to folder name
    item(otherRoot, 'elsewhere', 'd.mp4', { channelName: 'Elsewhere TV' }),
    item(hiddenRoot, 'secretstuff', 'e.mp4', { channelName: 'Secret Stuff' }),
  ];
  const metadata = {};
  for (const it of items) metadata[it.id] = it;
  saveDatabase({
    folders: [mediaDir, otherRoot, hiddenRoot],
    folderSettings: { [hiddenRoot]: { name: 'Hidden', hidden: true, order: 0 } },
    progress: {}, metadata,
    settings: { scanIntervalMinutes: 0, pruneMissing: false, cacheMaxBytes: null, cacheMaxAgeDays: 30 },
  });
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  authenticateFetch(server, base);
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(mediaDir, { recursive: true, force: true });
  fs.rmSync(otherRoot, { recursive: true, force: true });
});

test('groups by folderName with channelName/avatar when recorded, folder-name fallback otherwise, sorted by name', async () => {
  const res = await fetch(`${base}/api/channels`);
  assert.equal(res.status, 200);
  const { channels } = await res.json();
  assert.deepEqual(channels.map(c => c.folder), ['elsewhere', 'homemovies', 'planetclue']);
  const pc = channels.find(c => c.folder === 'planetclue');
  assert.equal(pc.name, 'Planet Clue');
  assert.equal(pc.avatarUrl, 'https://example.test/pc.jpg');
  assert.equal(pc.count, 2);
  assert.equal(pc.latestAddedAt, 2000);
  const hm = channels.find(c => c.folder === 'homemovies');
  assert.equal(hm.name, 'homemovies');
  assert.equal(hm.avatarUrl, null);
});

test('?root= scopes to one configured library root', async () => {
  const res = await fetch(`${base}/api/channels?root=${encodeURIComponent(mediaDir)}`);
  const { channels } = await res.json();
  assert.deepEqual(channels.map(c => c.folder).sort(), ['homemovies', 'planetclue']);
});

test('hidden roots are excluded from the default listing but reachable when asked for explicitly (gate W4)', async () => {
  const all = await (await fetch(`${base}/api/channels`)).json();
  assert.equal(all.channels.some(c => c.folder === 'secretstuff'), false, 'hidden-root channel must not surface by default');
  const explicit = await (await fetch(`${base}/api/channels?root=${encodeURIComponent(hiddenRoot)}`)).json();
  assert.deepEqual(explicit.channels.map(c => c.folder), ['secretstuff']);
});

test('unknown ?root= yields an empty list, and prefix-sibling roots do not leak (gate W5)', async () => {
  const unknown = await (await fetch(`${base}/api/channels?root=${encodeURIComponent('/nope/never')}`)).json();
  assert.deepEqual(unknown.channels, []);
  // A root that is a string-prefix of another path must not match it.
  const sibling = await (await fetch(`${base}/api/channels?root=${encodeURIComponent(mediaDir.slice(0, -1))}`)).json();
  assert.equal(sibling.channels.some(c => c.folder === 'planetclue'), false);
});

test('is behind the auth gate', async () => {
  // A raw request without the patched fetch's cookie must be rejected.
  const http = require('node:http');
  const code = await new Promise((resolve) => {
    http.get(`${base}/api/channels`, (r) => { r.resume(); resolve(r.statusCode); });
  });
  assert.equal(code, 401);
});
