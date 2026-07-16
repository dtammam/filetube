'use strict';

// [INTEGRATION] v1.41.10 -- the leaked-streaming-fd / DELETE_PENDING fix
// (the "undeletable emoji files" incident, 2026-07-16). The full production
// failure chain, each link tested against the REAL routes:
//
//   1. every browser seek aborts its in-flight Range request; `.pipe()` never
//      destroyed the source fs.ReadStream, stranding one open fd per seek
//      (~180 were found pinned on three files) ................ test "seek-abort"
//   2. deleting a file this process still holds open puts an SMB/CIFS file
//      into server-side DELETE_PENDING; the fix destroys OUR OWN live streams
//      before the unlink ............................. test "delete-mid-stream"
//   3. when the unlink ENOENTs but the parent dir STILL enumerates the leaf
//      (the DELETE_PENDING signature -- an open handle on another machine,
//      or one we failed to release), the delete must not claim the file is
//      gone: honest fileRemainsOnDisk+deletePending response + a tombstone,
//      never the old fake "File deleted successfully" ..... test "post-verify"
//   4. the scan's deferred retry used to CONSUME the tombstone and re-index
//      on any retry failure -- under DELETE_PENDING (retry ENOENTs forever
//      while the dirent stays enumerable) that was the infinite resurrect
//      loop; ENOENT now keeps the tombstone + keeps the file hidden, and the
//      first scan after the handles clear finishes the job . test "scan-retry"
//
// DELETE_PENDING itself cannot be reproduced on a local POSIX fs (unlink of
// an open file succeeds immediately), so tests 3+ simulate its exact
// observable contract at the fs seam: the dirent remains enumerable while
// unlink AND every new open report ENOENT (the production probe confirmed
// delete-pending files refuse opens -- that unopenability is exactly what
// the route's post-verify discriminates on, per this release's adversarial
// CRITICAL: an enumerated-but-OPENABLE leaf is a brand-new file that landed
// in the unlink->readdir window and must NOT be tombstoned). server.js and
// this test share the SAME `fs` module instance, so patching fs.unlinkSync/
// fs.openSync here patches the route.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-pending-'));
const DB_FILE = path.join(process.env.DATA_DIR, 'db.json');

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const {
  app, saveDatabase, getMediaId, scanDirectories, activeMediaStreams,
} = require('../../server');

let server;
let base;
let libDir;

before(async () => {
  libDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-pending-lib-'));
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(libDir, { recursive: true, force: true });
});

beforeEach(() => {
  if (fs.existsSync(DB_FILE)) fs.rmSync(DB_FILE);
  for (const name of fs.readdirSync(libDir)) fs.rmSync(path.join(libDir, name), { force: true });
  activeMediaStreams.clear();
});

function baseSettings() {
  return { scanIntervalMinutes: 30, pruneMissing: false, cacheMaxBytes: null, cacheMaxAgeDays: 30 };
}

function readDb() {
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

// 8 MiB: large enough that neither the server's socket buffer nor the
// client's can swallow the whole body, so the read stream is genuinely
// mid-flight when the client goes away.
const BIG = 8 * 1024 * 1024;

function seedVideo(fileName, bytes = BIG) {
  const filePath = path.join(libDir, fileName);
  fs.writeFileSync(filePath, Buffer.alloc(bytes, 7));
  const id = getMediaId(filePath);
  saveDatabase({
    folders: [libDir],
    folderSettings: {},
    progress: {},
    metadata: {
      [id]: {
        id, name: fileName, title: fileName, filePath,
        folderName: path.basename(libDir), size: bytes, ext: path.extname(fileName),
        type: 'video', addedAt: new Date().toISOString(), duration: 12,
        hasThumbnail: false, rootFolder: libDir, videoCodec: 'h264',
        audioCodec: 'aac', needsTranscode: false,
        releaseDate: new Date().toISOString(), youtubeId: null,
      },
    },
    liked: [],
    deleteTombstones: {},
    settings: baseSettings(),
  });
  return { filePath, id };
}

function pollUntil(cond, what, timeoutMs = 5000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    (function tick() {
      if (cond()) return resolve();
      if (Date.now() - started > timeoutMs) return reject(new Error(`timed out waiting for ${what}`));
      setTimeout(tick, 20);
    })();
  });
}

// Start a GET /video/:id whose response body is deliberately never consumed
// (res.pause()), parking a live fs.ReadStream in the registry -- the exact
// state a viewer mid-playback (or an abandoned seek, pre-fix) holds.
function openStalledStream(id, range) {
  return new Promise((resolve, reject) => {
    const req = http.get(`${base}/video/${id}`, range ? { headers: { Range: range } } : {}, (res) => {
      res.once('data', () => {
        res.pause();
        resolve({ req, res });
      });
      res.on('error', () => {}); // the test tears this connection down on purpose
    });
    req.on('error', reject);
  });
}

test('seek-abort: destroying the client mid-Range-request destroys the read stream (no stranded fd)', async () => {
  const { filePath, id } = seedVideo('leak-check [aaaaaaaaaaa].mp4');

  const { res } = await openStalledStream(id, `bytes=0-${BIG - 1}`);
  assert.ok(activeMediaStreams.has(filePath), 'mid-flight stream is registered');

  res.destroy(); // what every browser seek does to the previous request
  await pollUntil(() => !activeMediaStreams.has(filePath), 'registry to drain after client abort');
  // Registry emptiness IS fd closure here: entries only leave on the stream's
  // own 'close' event, which fs streams emit after the underlying fd closes.
});

test('delete-mid-stream: DELETE destroys our own live streams first, then the unlink succeeds cleanly', async () => {
  const { filePath, id } = seedVideo('watched-while-deleted \u{1F633} [bbbbbbbbbbb].mp4');

  await openStalledStream(id); // a viewer is mid-playback right now
  assert.ok(activeMediaStreams.has(filePath), 'playback stream is registered');

  const del = await fetch(`${base}/api/videos/${id}`, { method: 'DELETE' });
  assert.equal(del.status, 200);
  const body = await del.json();
  assert.equal(body.success, true);
  assert.ok(!body.fileRemainsOnDisk, 'a clean local delete must not claim the file remains');
  assert.ok(!body.deletePending, 'nothing pending on a local fs');

  assert.ok(!fs.existsSync(filePath), 'file genuinely unlinked');
  assert.ok(!activeMediaStreams.has(filePath), 'the playback stream was destroyed by the delete');
  const db = readDb();
  assert.strictEqual(db.metadata[id], undefined, 'library entry removed');
  assert.deepStrictEqual(db.deleteTombstones, {}, 'a VERIFIED unlink mints no tombstone (v1.41.3 contract)');
});

// Patch the fs seam to the DELETE_PENDING contract for one path: the dirent
// stays enumerable while unlink and every new open throw ENOENT. Returns a
// restore function. `unlinkMode: 'noop'` models the OTHER production shape --
// the FIRST delete on CIFS, where unlink reports success (the server accepted
// the disposition) yet the dirent survives.
function patchDeletePending(filePath, { unlinkMode = 'throw' } = {}) {
  const realUnlinkSync = fs.unlinkSync;
  const realOpenSync = fs.openSync;
  const enoent = (op, s) => {
    const err = new Error(`ENOENT: no such file or directory, ${op} '${s}'`);
    err.code = 'ENOENT';
    return err;
  };
  fs.unlinkSync = (p) => {
    const s = Buffer.isBuffer(p) ? p.toString('utf8') : String(p);
    if (s === filePath) {
      if (unlinkMode === 'noop') return undefined; // "success" without the file going away
      throw enoent('unlink', s);
    }
    return realUnlinkSync(p);
  };
  fs.openSync = (p, ...args) => {
    const s = Buffer.isBuffer(p) ? p.toString('utf8') : String(p);
    if (s === filePath) throw enoent('open', s); // delete-pending refuses every new open
    return realOpenSync(p, ...args);
  };
  return () => {
    fs.unlinkSync = realUnlinkSync;
    fs.openSync = realOpenSync;
  };
}

test('post-verify: ENOENT unlink + still-enumerated unopenable dirent -> honest deletePending response + tombstone, never fake success', async () => {
  const { filePath, id } = seedVideo('undead ？ [ccccccccccc].mp4', 1024);

  const restore = patchDeletePending(filePath);
  try {
    const del = await fetch(`${base}/api/videos/${id}`, { method: 'DELETE' });
    assert.equal(del.status, 200);
    const body = await del.json();
    assert.equal(body.success, true, 'library removal still succeeds');
    assert.equal(body.fileRemainsOnDisk, true, '...but the response must admit the file survives');
    assert.equal(body.deletePending, true, 'and name the held-open state');
    assert.match(body.message, /held open/i, 'the message explains the mechanism to the user');

    assert.ok(fs.existsSync(filePath), 'the dirent indeed still exists');
    const db = readDb();
    assert.strictEqual(db.metadata[id], undefined, 'entry removed from the library');
    assert.ok(db.deleteTombstones[id], 'unverified conclusion minted a tombstone');
  } finally {
    restore();
  }
});

test('post-verify, verified shape: unlink "succeeds" but the unopenable dirent survives -> deletePending + tombstone (the first-delete-on-CIFS shape)', async () => {
  const { filePath, id } = seedVideo('quiet-survivor [eeeeeeeeeee].mp4', 1024);

  const restore = patchDeletePending(filePath, { unlinkMode: 'noop' });
  try {
    const del = await fetch(`${base}/api/videos/${id}`, { method: 'DELETE' });
    assert.equal(del.status, 200);
    const body = await del.json();
    assert.equal(body.success, true);
    assert.equal(body.fileRemainsOnDisk, true, 'a watched unlink whose dirent survives must NOT claim the file is gone');
    assert.equal(body.deletePending, true);
    const db = readDb();
    assert.strictEqual(db.metadata[id], undefined);
    assert.ok(db.deleteTombstones[id], 'the downgrade minted a tombstone so the scan keeps it hidden');
  } finally {
    restore();
  }
});

test('C1 regression: a NEW file recreated at the same path in the unlink window is NEVER tombstoned, and the scan indexes it instead of reaping it', async () => {
  const { filePath, id } = seedVideo('recreated-in-window [fffffffffff].mp4', 1024);

  // The adversarial gate's repro: the unlink genuinely succeeds, and an
  // external writer (an in-flight yt-dlp re-download, a sync client) lands a
  // brand-new file at the same leaf before the route's post-verify readdir --
  // with a BACKDATED mtime (yt-dlp's default --mtime), which defeats the
  // scan's mtime<=deletedAt restore check. Pre-fix, the post-verify
  // tombstoned the new file and the next scan unlinked it: silent data loss.
  const realUnlinkSync = fs.unlinkSync;
  fs.unlinkSync = (p) => {
    const s = Buffer.isBuffer(p) ? p.toString('utf8') : String(p);
    realUnlinkSync(p);
    if (s === filePath) {
      fs.writeFileSync(filePath, 'BRAND-NEW-CONTENT-THE-USER-NEVER-DELETED');
      const past = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      fs.utimesSync(filePath, past, past); // backdated: mtime is NO safety net
    }
  };
  try {
    const del = await fetch(`${base}/api/videos/${id}`, { method: 'DELETE' });
    assert.equal(del.status, 200);
    const body = await del.json();
    assert.equal(body.success, true);
    assert.ok(!body.fileRemainsOnDisk, 'the DELETED file is gone; the survivor is different content');
    assert.ok(!body.deletePending, 'an openable survivor is not delete-pending');

    let db = readDb();
    assert.deepStrictEqual(db.deleteTombstones, {}, 'CRITICAL C1: the recreated file must NOT be tombstoned');

    await scanDirectories();
    db = readDb();
    assert.ok(fs.existsSync(filePath), 'the new file SURVIVES the next scan (pre-fix it was reaped here)');
    assert.equal(fs.readFileSync(filePath, 'utf8'), 'BRAND-NEW-CONTENT-THE-USER-NEVER-DELETED');
    assert.ok(db.metadata[id], 'and is indexed as the new content it is');
  } finally {
    fs.unlinkSync = realUnlinkSync;
  }
});

test('ENOENT shape + OPENABLE survivor keeps the pre-v1.41.10 contract: success, tombstone, no deletePending flag', async () => {
  const { filePath, id } = seedVideo('openable-enoent [ggggggggggg].mp4', 1024);

  // unlink ENOENTs but the file opens fine (e.g. recreated after an external
  // delete): not the pending signature -- the response must not claim a held-
  // open file, and the v1.41.3 unverified tombstone still lets the scan's
  // mtime/fresh-db checks decide what the surviving bytes are.
  const realUnlinkSync = fs.unlinkSync;
  fs.unlinkSync = (p) => {
    const s = Buffer.isBuffer(p) ? p.toString('utf8') : String(p);
    if (s === filePath) {
      const err = new Error(`ENOENT: no such file or directory, unlink '${s}'`);
      err.code = 'ENOENT';
      throw err;
    }
    return realUnlinkSync(p);
  };
  try {
    const del = await fetch(`${base}/api/videos/${id}`, { method: 'DELETE' });
    assert.equal(del.status, 200);
    const body = await del.json();
    assert.equal(body.success, true);
    assert.ok(!body.deletePending, 'openable survivor must not be labeled delete-pending');
    const db = readDb();
    assert.strictEqual(db.metadata[id], undefined);
    assert.ok(db.deleteTombstones[id], 'the v1.41.3 unverified tombstone is unchanged');
  } finally {
    fs.unlinkSync = realUnlinkSync;
  }
});

test('scan-retry: ENOENT keeps the tombstone + keeps the file hidden; the first clean scan finishes the delete', async () => {
  const { filePath, id } = seedVideo('pending-then-cleared [ddddddddddd].mp4', 1024);

  // Delete while the fs reports the DELETE_PENDING contract (as above).
  const restore = patchDeletePending(filePath);
  try {
    const del = await fetch(`${base}/api/videos/${id}`, { method: 'DELETE' });
    assert.equal((await del.json()).deletePending, true, 'precondition: delete saw the pending state');

    // Scan #1: still pending. Pre-fix this consumed the tombstone and
    // re-indexed the survivor -- the infinite resurrect loop.
    await scanDirectories();
    let db = readDb();
    assert.strictEqual(db.metadata[id], undefined, 'survivor NOT re-indexed while pending');
    assert.ok(db.deleteTombstones[id], 'tombstone KEPT (not consumed) while pending');

    // Scan #2, same conditions: stays suppressed scan after scan.
    await scanDirectories();
    db = readDb();
    assert.strictEqual(db.metadata[id], undefined, 'still hidden on the next scan');
    assert.ok(db.deleteTombstones[id], 'tombstone still standing');
  } finally {
    restore();
  }

  // The pinning handle "closes" (fs behaves normally again): the very next
  // scan's deferred retry unlinks for real and consumes the tombstone.
  await scanDirectories();
  const db = readDb();
  assert.ok(!fs.existsSync(filePath), 'first clean scan removed the file');
  assert.strictEqual(db.metadata[id], undefined, 'never resurrected');
  assert.strictEqual(db.deleteTombstones[id], undefined, 'tombstone consumed once the delete truly finished');
});
