'use strict';

// [INTEGRATION] v1.38 -- the real DELETE /api/videos/:id route must actually
// remove a file whose on-disk name is a Unicode NORMALIZATION variant of the
// stored path (NFD on disk vs NFC in db.metadata), and must NOT report a fake
// success (dropping the library entry) when it cannot even confirm the file's
// absence. Boots the real app against an isolated DATA_DIR (same pattern as
// ytdlp-delete-stays-gone.test.js) so the production handler's own
// loadDatabase/updateDatabase and this test's HTTP client share one db.json.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-del-unicode-'));

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, updateDatabase, loadDatabase, getMediaId } = require('../../server');

// Force the two normalization forms explicitly (never trust the source
// file's own on-disk normalization, which an editor can silently unify).
const NFD_NAME = 'Re\u0301sume\u0301 clip.mp4'; // NFD: 'e' + U+0301, twice
const NFC_NAME = 'R\u00e9sum\u00e9 clip.mp4'; // NFC: precomposed U+00E9

let server;
let base;
let libDir;

before(async () => {
  libDir = path.join(process.env.DATA_DIR, 'library');
  fs.mkdirSync(libDir, { recursive: true });
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

test('deletes an NFD-on-disk file addressed by its NFC stored path (success + file truly gone)', async () => {
  const onDisk = path.join(libDir, NFD_NAME);
  fs.writeFileSync(onDisk, 'data');
  const storedPath = path.join(libDir, NFC_NAME);
  assert.ok(!fs.existsSync(storedPath), 'precondition: existsSync misses the NFC form on this FS');

  const id = getMediaId(storedPath);
  await updateDatabase((db) => {
    db.metadata[id] = { id, name: NFC_NAME, title: 'Résumé clip', filePath: storedPath, type: 'video' };
    return true;
  });

  const res = await fetch(`${base}/api/videos/${id}`, { method: 'DELETE' });
  const body = await res.json();
  assert.strictEqual(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(body)}`);
  assert.strictEqual(body.success, true);
  assert.ok(!fs.existsSync(onDisk), 'the real NFD file must be gone from disk (not just the library card)');

  const db = await loadDatabase();
  assert.ok(!db.metadata[id], 'the library entry must be removed too');
});

test('does NOT fake success when the parent dir is un-enumerable -- 409, entry kept', async () => {
  // Make the stored path\'s parent a FILE (ENOTDIR on readdir) -- a
  // root-independent stand-in for "cannot confirm the file is gone".
  const notADir = path.join(libDir, 'blocker');
  fs.writeFileSync(notADir, 'x');
  const storedPath = path.join(notADir, 'child.mp4');
  const id = getMediaId(storedPath);
  await updateDatabase((db) => {
    db.metadata[id] = { id, name: 'child.mp4', title: 'child', filePath: storedPath, type: 'video' };
    return true;
  });

  const res = await fetch(`${base}/api/videos/${id}`, { method: 'DELETE' });
  const body = await res.json();
  assert.strictEqual(res.status, 409, `expected a recoverable 409, got ${res.status}: ${JSON.stringify(body)}`);
  assert.strictEqual(body.readOnly, true);

  const db = await loadDatabase();
  assert.ok(db.metadata[id], 'the library entry must survive an unconfirmable delete, not silently vanish');

  // ...and the opt-in removeAnyway follow-up DOES drop the entry.
  const res2 = await fetch(`${base}/api/videos/${id}?removeAnyway=true`, { method: 'DELETE' });
  const body2 = await res2.json();
  assert.strictEqual(res2.status, 200, `removeAnyway should succeed, got ${res2.status}: ${JSON.stringify(body2)}`);
  assert.strictEqual(body2.fileRemainsOnDisk, true);
  const db2 = await loadDatabase();
  assert.ok(!db2.metadata[id], 'removeAnyway must finally remove the entry');
});
