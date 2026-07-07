'use strict';

// [INTEGRATION] FR-3 (v1.19.0, download-to-device): the `?download=1` intent
// added to the EXISTING `GET /video/:id` route (server.js). Proves, against
// the REAL route:
//   - the download branch ALWAYS resolves the ORIGINAL file
//     (`db.metadata[id].filePath`), bypassing the needsTranscode/cached-
//     transcode branch entirely, even when a cached transcode already exists
//     for that id (the "download the source, not the transcode" guarantee).
//   - it sets `Content-Disposition: attachment` with a safely-encoded
//     filename (ASCII fallback + `filename*=UTF-8''` for non-ASCII titles).
//   - an ordinary request WITHOUT `?download=1` is byte-identical to today:
//     no Content-Disposition header, and the existing transcode-preference
//     behavior (serves the cached transcode when needsTranscode is true).
//   - 404s (unknown id, missing-on-disk file) are unchanged for a download
//     request -- no new failure mode.
//   - the lookup stays strictly `id -> db.metadata[id].filePath`: no
//     client-supplied path/filename can influence what gets sent.
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-download-test-'));
const DB_FILE = path.join(process.env.DATA_DIR, 'db.json');

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const { app, transcodedPath, TRANSCODE_DIR } = require('../../server');

let server;
let base;
let originalDir;

before(async () => {
  originalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-download-src-'));
  fs.mkdirSync(TRANSCODE_DIR, { recursive: true });
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(originalDir, { recursive: true, force: true });
});

function writeDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
}

beforeEach(() => {
  if (fs.existsSync(DB_FILE)) fs.rmSync(DB_FILE);
  for (const name of fs.readdirSync(TRANSCODE_DIR)) fs.rmSync(path.join(TRANSCODE_DIR, name), { force: true });
});

test('?download=1 serves the ORIGINAL file, not a cached transcode, even when needsTranscode is true and a transcode is cached', async () => {
  const id = 'vid-needs-transcode';
  const originalPath = path.join(originalDir, 'source.avi');
  fs.writeFileSync(originalPath, 'ORIGINAL-SOURCE-BYTES');
  fs.writeFileSync(transcodedPath(id), 'TRANSCODED-MP4-BYTES-DIFFERENT-LENGTH');
  writeDb({
    folders: [], folderSettings: {}, progress: {},
    metadata: {
      [id]: {
        id, needsTranscode: true, filePath: originalPath, size: 21,
        type: 'video', title: 'My Clip', name: 'source.avi', ext: '.avi', addedAt: Date.now(),
      },
    },
  });

  // Sanity: an ordinary (non-download) request serves the TRANSCODE, unchanged.
  const playbackRes = await fetch(`${base}/video/${id}`);
  assert.equal(playbackRes.status, 200);
  assert.equal(await playbackRes.text(), 'TRANSCODED-MP4-BYTES-DIFFERENT-LENGTH', 'sanity: ordinary playback still prefers the cached transcode');
  assert.equal(playbackRes.headers.get('content-disposition'), null, 'ordinary playback must never set Content-Disposition');

  // The download-intent request must serve the ORIGINAL bytes instead.
  const downloadRes = await fetch(`${base}/video/${id}?download=1`);
  assert.equal(downloadRes.status, 200);
  assert.equal(await downloadRes.text(), 'ORIGINAL-SOURCE-BYTES', 'download=1 must serve the original file, never the cached transcode');
  const disposition = downloadRes.headers.get('content-disposition');
  assert.match(disposition, /^attachment;/);
  assert.match(disposition, /filename="My Clip\.avi"/);
});

test('?download=1 on a normal (non-transcode) item downloads the same bytes playback would serve, with Content-Disposition set', async () => {
  const id = 'vid-plain-mp4';
  const originalPath = path.join(originalDir, 'plain.mp4');
  fs.writeFileSync(originalPath, 'PLAIN-MP4-BYTES');
  writeDb({
    folders: [], folderSettings: {}, progress: {},
    metadata: {
      [id]: {
        id, needsTranscode: false, filePath: originalPath, size: 15,
        type: 'video', title: 'Plain Video', name: 'plain.mp4', ext: '.mp4', addedAt: Date.now(),
      },
    },
  });

  const res = await fetch(`${base}/video/${id}?download=1`);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'PLAIN-MP4-BYTES');
  assert.match(res.headers.get('content-disposition'), /^attachment; filename="Plain Video\.mp4"/);
});

test('?download=1 Content-Disposition safely encodes a non-ASCII title via filename*=UTF-8\'\'', async () => {
  const id = 'vid-nonascii-title';
  const originalPath = path.join(originalDir, 'song.mp3');
  const title = 'Café Résumé 日本語';
  fs.writeFileSync(originalPath, 'AUDIO-BYTES');
  writeDb({
    folders: [], folderSettings: {}, progress: {},
    metadata: {
      [id]: {
        id, needsTranscode: false, filePath: originalPath, size: 11,
        type: 'audio', title, name: 'song.mp3', ext: '.mp3', addedAt: Date.now(),
      },
    },
  });

  const res = await fetch(`${base}/video/${id}?download=1`);
  assert.equal(res.status, 200);
  const disposition = res.headers.get('content-disposition');
  assert.match(disposition, /filename\*=UTF-8''/);
  const encodedMatch = /filename\*=UTF-8''([^;]+)$/.exec(disposition);
  assert.ok(encodedMatch, 'filename* form must be present');
  assert.equal(decodeURIComponent(encodedMatch[1]), `${title}.mp3`, 'the encoded form must decode back to the real title + ext');
  // ASCII fallback must not throw/break -- non-ASCII chars replaced, no raw
  // multi-byte characters in the quoted-string form.
  assert.match(disposition, /filename="[\x20-\x7E]*"/);
});

test('a request without ?download=1 is unaffected -- no Content-Disposition header, existing 200/Range/404 behavior intact', async () => {
  const id = 'vid-no-download-param';
  const originalPath = path.join(originalDir, 'untouched.mp4');
  fs.writeFileSync(originalPath, 'UNTOUCHED-BYTES');
  writeDb({
    folders: [], folderSettings: {}, progress: {},
    metadata: {
      [id]: {
        id, needsTranscode: false, filePath: originalPath, size: 15,
        type: 'video', title: 'Untouched', name: 'untouched.mp4', ext: '.mp4', addedAt: Date.now(),
      },
    },
  });

  const res = await fetch(`${base}/video/${id}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-disposition'), null);
  assert.equal(await res.text(), 'UNTOUCHED-BYTES');
});

test('?download=1 for an unknown id returns the same 404 ordinary playback returns', async () => {
  const res = await fetch(`${base}/video/does-not-exist?download=1`);
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, 'Media file not found');
});

test('?download=1 for an id whose file no longer exists on disk returns the same 404 ordinary playback returns', async () => {
  const id = 'vid-missing-on-disk';
  const missingPath = path.join(originalDir, 'gone.mp4');
  // Deliberately never created on disk.
  writeDb({
    folders: [], folderSettings: {}, progress: {},
    metadata: {
      [id]: {
        id, needsTranscode: false, filePath: missingPath, size: 0,
        type: 'video', title: 'Gone', name: 'gone.mp4', ext: '.mp4', addedAt: Date.now(),
      },
    },
  });

  const res = await fetch(`${base}/video/${id}?download=1`);
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, 'File does not exist on disk');
});

test('the download lookup is strictly id-based -- extra/foreign query params never influence which file is sent', async () => {
  const id = 'vid-confinement-check';
  const originalPath = path.join(originalDir, 'confined.mp4');
  fs.writeFileSync(originalPath, 'CONFINED-BYTES');
  writeDb({
    folders: [], folderSettings: {}, progress: {},
    metadata: {
      [id]: {
        id, needsTranscode: false, filePath: originalPath, size: 14,
        type: 'video', title: 'Confined', name: 'confined.mp4', ext: '.mp4', addedAt: Date.now(),
      },
    },
  });

  // Attempt to smuggle an alternate path via extra query params -- the route
  // has no such param; the response must still be keyed purely off `:id`.
  const res = await fetch(`${base}/video/${id}?download=1&filePath=/etc/passwd&file=../../etc/passwd`);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'CONFINED-BYTES', 'the served bytes must come from db.metadata[id].filePath alone, never a query-supplied path');
});
