'use strict';

// [INTEGRATION] v1.94 hover preview clips - GET /preview/:id serving + RBAC, and
// the id-keyed .pv.mp4 sidecar following the media id through trash -> restore
// -> purge. Same disk-keyed model as the storyboard sprite: serve on
// eligibility (derived from duration) + the on-disk clip, no persisted flag.
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-pv-'));
const DATA_DIR = process.env.DATA_DIR;
const THUMBNAIL_DIR = path.join(DATA_DIR, '.thumbnails');

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const { app, saveDatabase, getMediaId, scanState, userStore, __mintTestSession, __resetDatabaseForTests, previewClipPath, previewClipEligible } = require('../../server');
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

function writeClip(id, bytes = 'PREVIEWMP4DATA') {
  fs.mkdirSync(THUMBNAIL_DIR, { recursive: true });
  fs.writeFileSync(previewClipPath(id), bytes);
}

before(async () => {
  mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-pv-media-'));
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

test('GET /preview/:id: serves the .pv.mp4 (video/mp4) when eligible + file exists', async () => {
  const item = seedItem('has-pv.mp4'); // eligible: video, duration 120
  saveDatabase(baseDb({ [item.id]: item }));
  writeClip(item.id);

  const res = await fetch(`${base}/preview/${item.id}`);
  assert.equal(res.status, 200, 'serves on eligibility + on-disk clip, no db flag needed');
  assert.match(res.headers.get('content-type') || '', /video\/mp4/);
  assert.match(res.headers.get('cache-control') || '', /max-age=86400/);
  assert.equal(Buffer.from(await res.arrayBuffer()).toString(), 'PREVIEWMP4DATA');
});

test('GET /preview/:id: 404 when eligible but the clip file is missing', async () => {
  const item = seedItem('elig-noclip.mp4');
  saveDatabase(baseDb({ [item.id]: item })); // NO writeClip
  assert.equal((await fetch(`${base}/preview/${item.id}`)).status, 404);
});

test('GET /preview/:id: 404 for an INELIGIBLE item even with a stray clip file', async () => {
  const audio = seedItem('song.mp3', { type: 'audio', duration: 200 });
  saveDatabase(baseDb({ [audio.id]: audio }));
  writeClip(audio.id); // a stray sidecar
  assert.equal((await fetch(`${base}/preview/${audio.id}`)).status, 404, 'audio is ineligible -> 404');

  const short = seedItem('tiny.mp4', { duration: 3 }); // below PV_MIN_DURATION
  saveDatabase(baseDb({ [short.id]: short }));
  writeClip(short.id);
  assert.equal((await fetch(`${base}/preview/${short.id}`)).status, 404, 'too-short is ineligible -> 404');
  // sanity: the eligibility helper agrees
  assert.equal(previewClipEligible(audio), false);
  assert.equal(previewClipEligible(short), false);
});

test('GET /preview/:id: 404 for an unknown id (client stays on poster)', async () => {
  saveDatabase(baseDb());
  assert.equal((await fetch(`${base}/preview/completely-unknown`)).status, 404);
});

// ---- RBAC -------------------------------------------------------------------

test('GET /preview/:id: a restricted member 404s; admin still serves it', async () => {
  const item = seedItem('adult.mp4', { folderName: 'Adult' });
  saveDatabase(baseDb({ [item.id]: item }));
  writeClip(item.id);

  assert.equal((await fetch(`${base}/preview/${item.id}`)).status, 200, 'admin sees it');

  const kid = __mintTestSession({ username: 'kidPv', role: 'member' });
  userStore.setRestrictions(kid.user.id, [{ kind: 'folder', value: 'Adult' }]);
  const res = await fetch(`${base}/preview/${item.id}`, { headers: { Cookie: kid.cookie } });
  assert.equal(res.status, 404, 'restricted member gets 404, not the clip');
});

// ---- lifecycle: the .pv.mp4 follows the id through trash/restore/purge -------

test('preview-clip sidecar follows the id through trash -> restore -> purge', async () => {
  await __resetDatabaseForTests();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-pvlib-'));
  fs.mkdirSync(path.join(root, 'Chan'), { recursive: true });
  const filePath = path.join(root, 'Chan', 'movie.mp4');
  fs.writeFileSync(filePath, 'movie-bytes');
  const id = getMediaId(filePath);
  saveDatabase({
    folders: [root], folderSettings: {}, progress: {},
    metadata: { [id]: { id, name: 'movie.mp4', title: 'The Movie', filePath, folderName: 'Chan', rootFolder: root, size: 11, ext: '.mp4', type: 'video', addedAt: 1700000000000, duration: 90 } },
    settings: { scanIntervalMinutes: 0, pruneMissing: false, cacheMaxBytes: null, cacheMaxAgeDays: 0 },
  });
  writeClip(id, 'CLIP-BYTES');
  const delVideo = (i) => fetch(`${base}/api/videos/${encodeURIComponent(i)}`, { method: 'DELETE' });

  // TRASH -> re-key original -> trashId
  const tid = (await (await delVideo(id)).json()).trashId;
  assert.ok(tid && tid !== id, 'trash produced a distinct trashId');
  assert.equal(fs.existsSync(previewClipPath(id)), false, 'clip no longer under the original id');
  assert.ok(fs.existsSync(previewClipPath(tid)), 'clip re-keyed to the trashId');
  assert.equal(fs.readFileSync(previewClipPath(tid), 'utf8'), 'CLIP-BYTES', 'same clip bytes, re-keyed');

  // RESTORE -> re-key trashId -> original
  const resBody = await (await fetch(`${base}/api/trash/${encodeURIComponent(tid)}/restore`, { method: 'POST' })).json();
  assert.equal(resBody.restoredId, id);
  assert.ok(fs.existsSync(previewClipPath(id)), 'clip restored to the original id');
  assert.equal(fs.existsSync(previewClipPath(tid)), false, 'no trashId clip left behind');

  // PURGE -> unlink (no leak)
  const tid2 = (await (await delVideo(id)).json()).trashId;
  assert.ok(fs.existsSync(previewClipPath(tid2)), 'clip under the new trashId before purge');
  const pr = await fetch(`${base}/api/trash/${encodeURIComponent(tid2)}`, { method: 'DELETE' });
  assert.equal(pr.status, 200);
  assert.equal(fs.existsSync(previewClipPath(tid2)), false, 'purge unlinks the clip - no orphaned .pv.mp4 leak');
  assert.equal(fs.existsSync(previewClipPath(id)), false, 'nothing lingers under the original id either');
});
