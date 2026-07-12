'use strict';

// [INTEGRATION] v1.33 T5 (coverage backfill) -- three thin core endpoints:
//
//   - POST /api/config validation branches: non-array folders -> 400;
//     nonexistent / non-string entries silently dropped; duplicate spellings
//     deduplicated by RESOLVED key while the ORIGINAL submitted spelling is
//     what persists (the FIX-1 id-stability contract).
//   - GET /thumbnail/:id: real .jpg when present; the SVG placeholder
//     fallback (typed AUDIO/VIDEO, unknown-id 'Media' variant); title
//     HTML-escaping inside the SVG (injection guard).
//   - GET /api/cache/size + POST /api/cache/clear: completed transcodes
//     (.mp4 AND .m4a) counted/cleared; an in-flight `.tmp.mp4` is neither.
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-core-endpoints-'));
const DATA_DIR = process.env.DATA_DIR;
const THUMBNAIL_DIR = path.join(DATA_DIR, '.thumbnails');
const TRANSCODE_DIR = path.join(DATA_DIR, 'transcoded');

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const { app, saveDatabase, getMediaId } = require('../../server');

let server;
let base;
let mediaDir;

function baseDb(metadata = {}) {
  return {
    folders: [mediaDir],
    folderSettings: {},
    progress: {},
    metadata,
    settings: { scanIntervalMinutes: 0, pruneMissing: false, cacheMaxBytes: null, cacheMaxAgeDays: 30 },
  };
}

function seedItem(name, extra = {}) {
  const filePath = path.join(mediaDir, name);
  fs.writeFileSync(filePath, 'media-bytes');
  const id = getMediaId(filePath);
  return {
    id, name, title: path.basename(name, path.extname(name)), filePath,
    folderName: path.basename(mediaDir), size: 11, ext: path.extname(name),
    type: extra.type || 'video', addedAt: Date.now(), duration: 10,
    hasThumbnail: false, artist: '', ...extra,
  };
}

before(async () => {
  mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-core-media-'));
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(mediaDir, { recursive: true, force: true });
});

beforeEach(() => {
  for (const dir of [THUMBNAIL_DIR, TRANSCODE_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
    for (const name of fs.readdirSync(dir)) fs.rmSync(path.join(dir, name), { recursive: true, force: true });
  }
});

// ---- POST /api/config -------------------------------------------------------

test('POST /api/config: a non-array folders body is a 400, and nothing is persisted', async () => {
  saveDatabase(baseDb());
  for (const bad of ['/not/an/array', 42, { nested: true }, null]) {
    const res = await fetch(`${base}/api/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folders: bad }),
    });
    assert.equal(res.status, 400, `folders=${JSON.stringify(bad)} must 400`);
    assert.equal((await res.json()).error, 'folders must be an array of paths');
  }
  const cfg = await (await fetch(`${base}/api/config`)).json();
  assert.deepEqual(cfg.folders, [mediaDir], 'the persisted folder list must be untouched by rejected requests');
});

test('POST /api/config: nonexistent and non-string entries are dropped; duplicates dedupe by resolved key but the ORIGINAL spelling persists', async () => {
  saveDatabase(baseDb());
  const trailing = mediaDir + path.sep; // same root, non-canonical spelling
  const res = await fetch(`${base}/api/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      folders: [mediaDir, trailing, '/definitely/not/a/real/dir', 42, '   '],
      folderSettings: {},
    }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.deepEqual(body.folders, [mediaDir],
    'one surviving entry: the FIRST submitted spelling, byte-identical (never path.resolve-rewritten); dupes/garbage dropped');
});

// ---- GET /thumbnail/:id -----------------------------------------------------

test('GET /thumbnail/:id: serves the real .jpg when the item has one', async () => {
  const item = seedItem('has-thumb.mp4', { hasThumbnail: true });
  saveDatabase(baseDb({ [item.id]: item }));
  fs.writeFileSync(path.join(THUMBNAIL_DIR, `${item.id}.jpg`), 'jpeg-bytes');

  const res = await fetch(`${base}/thumbnail/${item.id}`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /image\/jpeg/);
  assert.equal(Buffer.from(await res.arrayBuffer()).toString(), 'jpeg-bytes');
});

test('GET /thumbnail/:id: SVG placeholder fallback -- hasThumbnail flag with a MISSING file, typed per item, and the unknown-id variant', async () => {
  const video = seedItem('no-thumb-video.mp4', { hasThumbnail: true }); // flag set, file missing
  const audio = seedItem('no-thumb-audio.mp3', { type: 'audio' });
  saveDatabase(baseDb({ [video.id]: video, [audio.id]: audio }));

  const videoRes = await fetch(`${base}/thumbnail/${video.id}`);
  assert.equal(videoRes.status, 200);
  assert.match(videoRes.headers.get('content-type') || '', /image\/svg\+xml/);
  const videoSvg = await videoRes.text();
  assert.ok(videoSvg.includes('VIDEO'), 'a video item gets the VIDEO placeholder');
  assert.ok(videoSvg.includes('no-thumb-video'), 'the item title renders in the placeholder');

  const audioSvg = await (await fetch(`${base}/thumbnail/${audio.id}`)).text();
  assert.ok(audioSvg.includes('AUDIO'), 'an audio item gets the AUDIO placeholder');

  const unknownRes = await fetch(`${base}/thumbnail/completely-unknown-id`);
  assert.equal(unknownRes.status, 200, 'an unknown id degrades to a generic placeholder, never a 404 broken image');
  assert.ok((await unknownRes.text()).includes('Media'), 'the generic variant labels itself Media');
});

test('GET /thumbnail/:id: a hostile title is HTML-escaped inside the SVG (no markup injection)', async () => {
  const item = seedItem('hostile.mp4', { title: '<script>alert(1)</script>' });
  saveDatabase(baseDb({ [item.id]: item }));

  const svg = await (await fetch(`${base}/thumbnail/${item.id}`)).text();
  assert.ok(!svg.includes('<script>'), 'raw markup must never survive into the SVG');
  assert.ok(svg.includes('&lt;script&gt;'), 'it must be entity-escaped instead');
});

// ---- GET /api/cache/size + POST /api/cache/clear ----------------------------

test('cache size counts completed transcodes (.mp4 AND .m4a) but never an in-flight .tmp.mp4; clear removes exactly the completed set', async () => {
  saveDatabase(baseDb());
  fs.writeFileSync(path.join(TRANSCODE_DIR, 'aaaa1111.mp4'), Buffer.alloc(1000));
  fs.writeFileSync(path.join(TRANSCODE_DIR, 'bbbb2222.m4a'), Buffer.alloc(500));
  fs.writeFileSync(path.join(TRANSCODE_DIR, 'cccc3333.mp4.tmp.mp4'), Buffer.alloc(9999)); // in-flight

  const size = await (await fetch(`${base}/api/cache/size`)).json();
  assert.equal(size.bytes, 1500, 'completed video + audio sidecars counted; the in-flight tmp excluded');

  const clear = await (await fetch(`${base}/api/cache/clear`, { method: 'POST' })).json();
  assert.equal(clear.success, true);
  assert.equal(clear.removed, 2);
  assert.equal(clear.freedBytes, 1500);
  assert.ok(!fs.existsSync(path.join(TRANSCODE_DIR, 'aaaa1111.mp4')));
  assert.ok(!fs.existsSync(path.join(TRANSCODE_DIR, 'bbbb2222.m4a')));
  assert.ok(fs.existsSync(path.join(TRANSCODE_DIR, 'cccc3333.mp4.tmp.mp4')),
    'an in-flight .tmp.mp4 must survive a cache clear -- killing a running job\'s output is the transcode worker\'s call, not this endpoint\'s');

  const sizeAfter = await (await fetch(`${base}/api/cache/size`)).json();
  assert.equal(sizeAfter.bytes, 0);
});
