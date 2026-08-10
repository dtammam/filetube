'use strict';

// [INTEGRATION] v1.93.2 storyboard sprites - GET /storyboard/:id serving + RBAC,
// and the API item projections that carry the DERIVED descriptor to the client.
// v1.93.2 keys serving off ELIGIBILITY (a video with a real duration, via
// storyboardDescriptor) + the on-disk sprite FILE - NOT a persisted db flag
// (which never reached db.json on a large library -> 0/2943 prod served).
//
//   - serves the real .sb.jpg when the item is eligible + the file exists
//   - 404s when eligible but the file is missing, when the item is INELIGIBLE
//     even with a stray sprite file, and for an unknown id (client degrades)
//   - RBAC: a restricted member 404s exactly like a missing item (the sprite
//     reveals content visually - same guard as /thumbnail and /video)
//   - /api/videos/:id and /api/videos carry the DERIVED descriptor to the client
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-sb-serve-'));
const DATA_DIR = process.env.DATA_DIR;
const THUMBNAIL_DIR = path.join(DATA_DIR, '.thumbnails');

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const { app, saveDatabase, getMediaId, scanState, userStore, __mintTestSession, storyboardDescriptor } = require('../../server');
const { authenticateFetch } = require('../helpers/auth');

let server, base, mediaDir;

async function waitForScanIdle(maxWaitMs = 10000) {
  const start = Date.now();
  while ((scanState.scanning || scanState.rescanRequested) && Date.now() - start < maxWaitMs) {
    await new Promise((r) => setTimeout(r, 25));
  }
}

function baseDb(metadata = {}) {
  return {
    folders: [mediaDir], folderSettings: {}, progress: {}, metadata,
    settings: { scanIntervalMinutes: 0, pruneMissing: false, cacheMaxBytes: null, cacheMaxAgeDays: 30 },
  };
}

function seedItem(name, extra = {}) {
  const sub = extra.folderName ? path.join(mediaDir, extra.folderName) : mediaDir;
  fs.mkdirSync(sub, { recursive: true });
  const filePath = path.join(sub, name);
  fs.writeFileSync(filePath, 'media-bytes');
  const id = getMediaId(filePath);
  return {
    id, name, title: path.basename(name, path.extname(name)), filePath,
    folderName: extra.folderName || path.basename(mediaDir), rootFolder: mediaDir,
    size: 11, ext: path.extname(name), type: 'video', addedAt: Date.now(), duration: 120,
    hasThumbnail: false, artist: '', ...extra,
  };
}

function writeSprite(id, bytes = 'SPRITEJPEGDATA') {
  fs.mkdirSync(THUMBNAIL_DIR, { recursive: true });
  fs.writeFileSync(path.join(THUMBNAIL_DIR, `${id}.sb.jpg`), bytes);
}

before(async () => {
  mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-sb-media-'));
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  authenticateFetch(server, base); // admin session
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(mediaDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await waitForScanIdle();
  fs.mkdirSync(THUMBNAIL_DIR, { recursive: true });
  for (const name of fs.readdirSync(THUMBNAIL_DIR)) fs.rmSync(path.join(THUMBNAIL_DIR, name), { recursive: true, force: true });
});

// ---- serving ----------------------------------------------------------------

test('GET /storyboard/:id: serves the real .sb.jpg when the item is eligible + file exists', async () => {
  const item = seedItem('has-sb.mp4'); // eligible: video, duration 120, NO persisted flag
  saveDatabase(baseDb({ [item.id]: item }));
  writeSprite(item.id);

  const res = await fetch(`${base}/storyboard/${item.id}`);
  assert.equal(res.status, 200, 'serves on eligibility + on-disk sprite, no db flag needed');
  assert.match(res.headers.get('content-type') || '', /image\/jpeg/);
  assert.match(res.headers.get('cache-control') || '', /max-age=86400/);
  assert.equal(Buffer.from(await res.arrayBuffer()).toString(), 'SPRITEJPEGDATA');
});

test('GET /storyboard/:id: 404 when eligible but the sprite file is missing', async () => {
  const item = seedItem('elig-nofile.mp4');
  saveDatabase(baseDb({ [item.id]: item })); // NO writeSprite
  const res = await fetch(`${base}/storyboard/${item.id}`);
  assert.equal(res.status, 404);
});

test('GET /storyboard/:id: 404 for an INELIGIBLE item even with a stray sprite file', async () => {
  // The eligibility gate stops a stale sidecar under an audio/too-short id from
  // serving a preview the client can never map to (no derivable geometry).
  const audio = seedItem('song.mp3', { type: 'audio', duration: 200 });
  saveDatabase(baseDb({ [audio.id]: audio }));
  writeSprite(audio.id); // a stray/leftover sidecar
  assert.equal((await fetch(`${base}/storyboard/${audio.id}`)).status, 404, 'audio is ineligible -> 404');

  const short = seedItem('clip.mp4', { duration: 1 });
  saveDatabase(baseDb({ [short.id]: short }));
  writeSprite(short.id);
  assert.equal((await fetch(`${base}/storyboard/${short.id}`)).status, 404, 'too-short is ineligible -> 404');
});

test('GET /storyboard/:id: 404 for an unknown id (client degrades to poster)', async () => {
  saveDatabase(baseDb());
  const res = await fetch(`${base}/storyboard/completely-unknown-id`);
  assert.equal(res.status, 404);
});

// ---- RBAC -------------------------------------------------------------------

test('GET /storyboard/:id: a restricted member 404s; admin still serves it', async () => {
  const item = seedItem('adult-clip.mp4', { folderName: 'Adult' });
  saveDatabase(baseDb({ [item.id]: item }));
  writeSprite(item.id);

  // admin (the patched fetch) sees it
  assert.equal((await fetch(`${base}/storyboard/${item.id}`)).status, 200);

  // a member restricted from the 'Adult' folder must not
  const kid = __mintTestSession({ username: 'kidSb', role: 'member' });
  userStore.setRestrictions(kid.user.id, [{ kind: 'folder', value: 'Adult' }]);
  const res = await fetch(`${base}/storyboard/${item.id}`, { headers: { Cookie: kid.cookie } });
  assert.equal(res.status, 404, 'restricted member gets 404, not the sprite');
});

// ---- API projections carry the DERIVED descriptor ---------------------------

test('GET /api/videos/:id and /api/videos carry the DERIVED storyboard descriptor', async () => {
  const item = seedItem('proj.mp4'); // no persisted flag; geometry derived from duration
  saveDatabase(baseDb({ [item.id]: item }));
  const expected = storyboardDescriptor(item); // what the client should receive
  assert.ok(expected && expected.count > 0, 'the fixture is eligible');

  const one = await (await fetch(`${base}/api/videos/${item.id}`)).json();
  assert.deepStrictEqual(one.storyboard, expected, 'single-item projection sends the derived descriptor');

  const listBody = await (await fetch(`${base}/api/videos`)).json();
  const row = listBody.items.find((r) => r.id === item.id);
  assert.ok(row, 'item present in the list');
  assert.deepStrictEqual(row.storyboard, expected, 'list projection carries the derived descriptor');
});
