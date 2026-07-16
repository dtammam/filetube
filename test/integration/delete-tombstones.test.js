'use strict';

// [INTEGRATION] v1.41.3 deletion tombstones (tech-debt #32 + #35a): a delete
// that reports success WITHOUT verifying the unlink (resolver "gone" on a
// non-round-tripping name, ENOENT alreadyGone, removeAnyway) must not let the
// file resurrect the library entry on the next scan -- the scan retries the
// unlink at its own enumerated (guaranteed-round-tripping) path instead. A
// VERIFIED unlink mints no tombstone at all (adversarial-gate CRITICAL this
// release: tombstoning verified deletes would reap mtime-preserving restores
// -- rsync -a / Syncthing / backup tools). A file the user puts back with
// newer mtime is re-indexed normally either way.
//
// The unverified class is reproduced via the alreadyGone path: remove the
// file from disk before calling DELETE (byte-identical, from the handler's
// point of view, to the false-"already gone" #35a variant -- a raw
// invalid-UTF-8 fixture can't be expressed portably in source; the v1.37.5
// \u-escape lesson extends to bytes that don't round-trip at all).
//
// Isolated DATA_DIR before requiring the app, per the existing pattern
// (test/integration/scan-clobber.test.js).

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-tomb-'));
const DATA_DIR = process.env.DATA_DIR;
const DB_FILE = path.join(DATA_DIR, 'db.json');

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const { app, scanDirectories, saveDatabase, getMediaId } = require('../../server');

const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
const rootSkip = isRoot ? 'unlink perms are not enforceable as root' : false;

let server;
let base;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

function baseSettings() {
  return {
    scanIntervalMinutes: 30,
    pruneMissing: false,
    cacheMaxBytes: null,
    cacheMaxAgeDays: 30,
  };
}

// Seed via the exported `saveDatabase()` (the established primitive; keeps
// the in-process read cache coherent -- see scan-clobber.test.js).
function writeDb(db) {
  saveDatabase(db);
}

function readDb() {
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function seedLibraryWithVideo(libDir, fileName) {
  const filePath = path.join(libDir, fileName);
  fs.writeFileSync(filePath, 'video-bytes');
  const id = getMediaId(filePath);
  writeDb({
    folders: [libDir],
    folderSettings: {},
    progress: {},
    metadata: {
      [id]: {
        id,
        name: fileName,
        title: fileName,
        filePath,
        folderName: path.basename(libDir),
        size: fs.statSync(filePath).size,
        ext: path.extname(fileName),
        type: 'video',
        addedAt: new Date().toISOString(),
        duration: 12,
        hasThumbnail: false,
        rootFolder: libDir,
        videoCodec: 'h264',
        audioCodec: 'aac',
        needsTranscode: false,
        releaseDate: new Date().toISOString(),
        youtubeId: null,
      },
    },
    liked: [],
    deleteTombstones: {},
    settings: baseSettings(),
  });
  return { filePath, id };
}

// SEAM 1/2 (v1.41.9): seed a yt-dlp item whose STORED filePath spelling differs
// from the REAL on-disk spelling in a way NFC/NFD cannot bridge (the id is
// md5(STORED) as in real life, while the bytes live at `diskName`). Models the
// full-width-'?' / emoji / invalid-UTF-8 / relocation divergence that made the
// delete fake success and the tombstone unmatchable.
function seedDivergentVideo(libDir, storedName, diskName) {
  const storedPath = path.join(libDir, storedName);
  const diskPath = path.join(libDir, diskName);
  fs.writeFileSync(diskPath, 'video-bytes');
  const id = getMediaId(storedPath);
  writeDb({
    folders: [libDir],
    folderSettings: {},
    progress: {},
    metadata: {
      [id]: {
        id,
        name: storedName,
        title: storedName,
        filePath: storedPath,
        folderName: path.basename(libDir),
        size: fs.statSync(diskPath).size,
        ext: path.extname(storedName),
        type: 'video',
        addedAt: new Date().toISOString(),
        duration: 12,
        hasThumbnail: false,
        rootFolder: libDir,
        videoCodec: 'h264',
        audioCodec: 'aac',
        needsTranscode: false,
        releaseDate: new Date().toISOString(),
        youtubeId: null,
      },
    },
    liked: [],
    deleteTombstones: {},
    settings: baseSettings(),
  });
  return { storedPath, diskPath, id };
}

// v1.41.13: a NON-YouTube divergent survivor -- stored under one [Extractor=id]
// spelling, real bytes under a divergent spelling of the SAME bracket. Carries
// sourceExtractor/sourceId so the delete mints a sourceRef tombstone and SEAM-2
// can reap it by bracket identity.
function seedDivergentUniversalVideo(libDir, storedName, diskName, extractor, id) {
  const storedPath = path.join(libDir, storedName);
  const diskPath = path.join(libDir, diskName);
  fs.writeFileSync(diskPath, 'video-bytes');
  const mediaId = getMediaId(storedPath);
  writeDb({
    folders: [libDir], folderSettings: {}, progress: {},
    metadata: {
      [mediaId]: {
        id: mediaId, name: storedName, title: storedName, filePath: storedPath,
        folderName: path.basename(libDir), size: fs.statSync(diskPath).size,
        ext: path.extname(storedName), type: 'video', addedAt: new Date().toISOString(),
        duration: 12, hasThumbnail: false, rootFolder: libDir,
        videoCodec: 'h264', audioCodec: 'aac', needsTranscode: false,
        releaseDate: new Date().toISOString(), youtubeId: null,
        sourceExtractor: extractor, sourceId: id,
      },
    },
    liked: [], deleteTombstones: {}, settings: baseSettings(),
  });
  return { storedPath, diskPath, id: mediaId };
}

// An UNVERIFIED-success delete: the file is gone from disk when the handler
// runs, so it concludes "already gone" -- success without a watched unlink.
async function unverifiedDelete(filePath, id) {
  fs.rmSync(filePath);
  const res = await fetch(`${base}/api/videos/${id}`, { method: 'DELETE' });
  assert.strictEqual(res.status, 200);
  assert.strictEqual((await res.json()).success, true);
}

function backdate(filePath, deletedAt) {
  const t = (deletedAt - 60000) / 1000;
  fs.utimesSync(filePath, t, t);
}

beforeEach(() => {
  if (fs.existsSync(DB_FILE)) fs.rmSync(DB_FILE);
});

test('an UNVERIFIED delete (file absent at delete time) mints a tombstone; a VERIFIED unlink mints none', async () => {
  const libDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-tomb-lib-'));

  const un = seedLibraryWithVideo(libDir, 'unverified.mp4');
  await unverifiedDelete(un.filePath, un.id);
  let db = readDb();
  assert.strictEqual(db.metadata[un.id], undefined, 'metadata entry removed');
  assert.ok(db.deleteTombstones[un.id], 'unverified success minted a tombstone');
  assert.strictEqual(db.deleteTombstones[un.id].filePath, un.filePath);
  assert.strictEqual(typeof db.deleteTombstones[un.id].deletedAt, 'number');

  const ok = seedLibraryWithVideo(libDir, 'verified.mp4');
  const res = await fetch(`${base}/api/videos/${ok.id}`, { method: 'DELETE' });
  assert.strictEqual((await res.json()).success, true);
  assert.ok(!fs.existsSync(ok.filePath), 'file really unlinked');
  db = readDb();
  assert.strictEqual(db.deleteTombstones[ok.id], undefined, 'verified unlink minted NO tombstone');
});

test('HEADLINE (the resurrect bug): a file surviving its unverified "successful" delete is removed by the next scan, not re-indexed', async () => {
  const libDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-tomb-lib-'));
  const { filePath, id } = seedLibraryWithVideo(libDir, 'survivor.mp4');

  await unverifiedDelete(filePath, id);

  // The #35a reality: the file was on disk all along (the handler just
  // couldn't see it under its stored spelling) -- same path, pre-delete mtime.
  fs.writeFileSync(filePath, 'video-bytes');
  fs.writeFileSync(path.join(libDir, 'survivor.en.vtt'), 'WEBVTT'); // its subtitle sidecar
  backdate(filePath, readDb().deleteTombstones[id].deletedAt);

  await scanDirectories();

  assert.ok(!fs.existsSync(filePath), 'deferred retry unlinked the survivor');
  assert.ok(!fs.existsSync(path.join(libDir, 'survivor.en.vtt')), 'subtitle sidecar swept too');
  const db = readDb();
  assert.strictEqual(db.metadata[id], undefined, 'entry NOT resurrected');
  assert.strictEqual(db.deleteTombstones[id], undefined, 'tombstone consumed');
});

// ---- SEAM 1 (v1.41.9): the actual recurring resurrect bug. The prior HEADLINE
// above recreates the survivor at the SAME byte-spelling as item.filePath, so
// md5(disk)==md5(stored), the tombstone matches, and the scan reaps it -- the
// divergent-spelling case (the REAL bug) was never exercised. Here the on-disk
// spelling DIVERGES from the stored spelling (full-width U+FF1F, not
// NFC/NFD-bridgeable). On main the delete-time resolver reports `gone`, the
// delete fakes success WITHOUT unlinking, mints a tombstone keyed by
// md5(storedPath), and the next scan (keying by md5(diskPath)) re-indexes the
// survivor -> the video REAPPEARS. SEAM 1 makes the delete find the file by its
// stable `[id]` bracket and VERIFY-unlink it: no survivor, no tombstone.
// FAILS on main (the file survives the delete); PASSES with SEAM 1.
test('HEADLINE (SEAM 1 -- the resurrect bug): a divergent-spelling yt-dlp file is VERIFY-unlinked by its [id] bracket, never resurrected', async () => {
  const libDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-tomb-lib-'));
  const storedName = 'What is Love- [dQw4w9WgXcQ].mp4'; // ASCII '-' (persisted)
  const diskName = 'What is Love\uFF1F [dQw4w9WgXcQ].mp4'; // full-width '?' (on disk)
  const { diskPath, id } = seedDivergentVideo(libDir, storedName, diskName);

  const res = await fetch(`${base}/api/videos/${id}`, { method: 'DELETE' });
  assert.strictEqual(res.status, 200);
  assert.strictEqual((await res.json()).success, true);
  // The core fix: the real bytes are gone, unlinked despite the divergence.
  assert.ok(!fs.existsSync(diskPath), 'SEAM 1: the real on-disk file was unlinked (found by its id bracket)');
  let db = readDb();
  assert.strictEqual(db.deleteTombstones[id], undefined, 'a VERIFIED unlink mints NO tombstone');

  await scanDirectories();
  db = readDb();
  assert.strictEqual(db.metadata[id], undefined, 'not resurrected under the stored-spelling id');
  assert.strictEqual(db.metadata[getMediaId(diskPath)], undefined, 'not resurrected under the on-disk-spelling id');
});

// ---- SEAM 2 (v1.41.9): defense-in-depth. When SEAM 1 RESOLVES the file but
// the unlink still cannot happen (a read-only/permission-denied parent taken
// with removeAnyway), a tombstone is minted keyed by md5(storedPath) -- which
// the scan (keying by md5(diskPath)) cannot match directly. The tombstone now
// also carries the yt-dlp id, and the scan does a SECONDARY match by that id
// (confined to the module's own download roots, exact id, mtime<=deletedAt) so
// the deferred retry still completes. Uses FILETUBE_YTDLP_DOWNLOAD_DIR so the
// files sit under a real download root (matchRootFolder must succeed).
// v1.41.13 (design D4/D5): the SAME SEAM-2 defense-in-depth for a NON-YouTube
// item -- an undeletable divergent [Vimeo=id] survivor is reaped by the scan's
// bracket-vs-bracket secondary match, and the delete mints a sourceRef
// tombstone (never a raw-vs-bracket compare).
test('SEAM 1 (universal): a divergent non-YouTube survivor is VERIFY-unlinked by its [Extractor=id] bracket at delete time', { skip: rootSkip }, async () => {
  const prev = process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
  const dl = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-tomb-udl-'));
  process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = dl;
  try {
    // Stored under one spelling, real bytes under a DIVERGENT spelling of the
    // SAME [Vimeo=76979871] bracket (full-width vs ascii before the bracket).
    const storedName = 'Clip- [Vimeo=76979871].mp4';
    const diskName = 'Clip？ [Vimeo=76979871].mp4';
    const { diskPath, id } = seedDivergentUniversalVideo(dl, storedName, diskName, 'Vimeo', '76979871');
    // Sanity: the stored spelling doesn't exist; only the divergent one does.
    assert.notStrictEqual(getMediaId(diskPath), id, 'md5(disk) != md5(stored): the primary path misses');

    const res = await fetch(`${base}/api/videos/${id}`, { method: 'DELETE' });
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.ok(!body.fileRemainsOnDisk, 'SEAM 1 found and unlinked the real file -- nothing remains');
    assert.ok(!fs.existsSync(diskPath), 'the divergent-spelling file was VERIFY-unlinked by its bracket');

    const db = readDb();
    assert.strictEqual(db.metadata[id], undefined, 'library entry removed');
    // A VERIFIED unlink mints NO tombstone (v1.41.3 contract) -- nothing to reap.
    assert.strictEqual(db.deleteTombstones[id], undefined, 'a verified universal unlink mints no tombstone');
  } finally {
    if (prev === undefined) delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
    else process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = prev;
  }
});

test('SEAM 2 (universal): an UNDELETABLE-at-delete-time divergent survivor is reaped by the scan via the sourceRef bracket match', { skip: rootSkip }, async () => {
  const prev = process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
  const dl = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-tomb-udl2-'));
  process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = dl;
  try {
    const storedName = 'Clip- [Vimeo=76979871].mp4';
    const diskName = 'Clip？ [Vimeo=76979871].mp4';
    const { diskPath, id } = seedDivergentUniversalVideo(dl, storedName, diskName, 'Vimeo', '76979871');

    // Read+exec only: SEAM 1 RESOLVES the file (dir readable) but the unlink
    // fails (dir not writable) -> removeAnyway -> unverified sourceRef tombstone.
    fs.chmodSync(dl, 0o555);
    let res;
    try { res = await fetch(`${base}/api/videos/${id}?removeAnyway=true`, { method: 'DELETE' }); }
    finally { fs.chmodSync(dl, 0o755); }
    assert.strictEqual((await res.json()).fileRemainsOnDisk, true);

    let db = readDb();
    assert.ok(db.deleteTombstones[id] && db.deleteTombstones[id].sourceRef, 'a universal delete mints a sourceRef tombstone');
    assert.strictEqual(db.deleteTombstones[id].sourceRef.extractor, 'Vimeo');
    assert.strictEqual(db.deleteTombstones[id].sourceRef.bracketId, '76979871');
    assert.ok(fs.existsSync(diskPath), 'the divergent survivor is still on disk');
    backdate(diskPath, db.deleteTombstones[id].deletedAt);

    await scanDirectories();

    assert.ok(!fs.existsSync(diskPath), 'SEAM 2 (universal): the scan reaped the divergent survivor by bracket identity');
    db = readDb();
    assert.strictEqual(db.metadata[getMediaId(diskPath)], undefined, 'not resurrected');
    assert.strictEqual(db.deleteTombstones[id], undefined, 'tombstone consumed');
  } finally {
    if (prev === undefined) delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
    else process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = prev;
  }
});

test('SEAM 2 (universal) SAFETY: a same-source-id copy in a DIFFERENT folder is SPARED', { skip: rootSkip }, async () => {
  const prev = process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
  const dl = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-tomb-usafe-'));
  process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = dl;
  try {
    const chanA = path.join(dl, 'ChanA'); fs.mkdirSync(chanA);
    const chanB = path.join(dl, 'ChanB'); fs.mkdirSync(chanB);
    const storedName = 'A- [Vimeo=76979871].mp4';
    const diskNameA = 'A？ [Vimeo=76979871].mp4';
    const { diskPath: survivorA, id } = seedDivergentUniversalVideo(chanA, storedName, diskNameA, 'Vimeo', '76979871');
    // A DIFFERENT copy of the same source id in ChanB -- the user never deleted this.
    const copyB = path.join(chanB, 'B [Vimeo=76979871].mp4');
    fs.writeFileSync(copyB, 'a different file the user keeps');

    fs.chmodSync(chanA, 0o555);
    try { await fetch(`${base}/api/videos/${id}?removeAnyway=true`, { method: 'DELETE' }); }
    finally { fs.chmodSync(chanA, 0o755); }
    const db = readDb();
    backdate(survivorA, db.deleteTombstones[id].deletedAt);
    backdate(copyB, db.deleteTombstones[id].deletedAt); // even with a reap-eligible mtime

    await scanDirectories();

    assert.ok(!fs.existsSync(survivorA), 'the same-folder divergent survivor IS reaped');
    assert.ok(fs.existsSync(copyB), 'CRITICAL: the different-folder copy of the same source id is SPARED');
  } finally {
    if (prev === undefined) delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
    else process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = prev;
  }
});

test('SEAM 2: a divergent survivor left undeletable at delete time is reaped by the scan via the youtube-id secondary match', { skip: rootSkip }, async () => {
  const prev = process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
  const dl = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-tomb-dl-'));
  process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = dl;
  try {
    const storedName = 'Clip- [dQw4w9WgXcQ].mp4';
    const diskName = 'Clip\uFF1F [dQw4w9WgXcQ].mp4';
    const { diskPath, id } = seedDivergentVideo(dl, storedName, diskName);

    // Read+exec only: SEAM 1 RESOLVES the file (dir is readable) but the unlink
    // fails (dir not writable) -> removeAnyway -> unverified tombstone minted.
    fs.chmodSync(dl, 0o555);
    let res;
    try {
      res = await fetch(`${base}/api/videos/${id}?removeAnyway=true`, { method: 'DELETE' });
    } finally {
      fs.chmodSync(dl, 0o755); // the transient condition clears before the scan
    }
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.fileRemainsOnDisk, true);

    let db = readDb();
    assert.ok(db.deleteTombstones[id], 'unverified success minted a tombstone keyed by md5(storedPath)');
    assert.strictEqual(db.deleteTombstones[id].youtubeId, 'dQw4w9WgXcQ', 'tombstone carries the yt-dlp id for the secondary match');
    assert.ok(fs.existsSync(diskPath), 'the real file survived (read-only parent at delete time)');
    // Direct key lookup CANNOT match -- prove the divergence the secondary match must bridge.
    assert.notStrictEqual(getMediaId(diskPath), id, 'md5(disk) != md5(stored): the primary lookup misses');
    backdate(diskPath, db.deleteTombstones[id].deletedAt);

    await scanDirectories();

    assert.ok(!fs.existsSync(diskPath), 'SEAM 2: the scan reaped the survivor via the youtube-id secondary match');
    db = readDb();
    assert.strictEqual(db.metadata[getMediaId(diskPath)], undefined, 'not resurrected');
    assert.strictEqual(db.deleteTombstones[id], undefined, 'tombstone consumed (one deferred retry per delete)');
  } finally {
    if (prev === undefined) delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
    else process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = prev;
  }
});

// CRITICAL regression (v1.41.9 gate, proven by a runnable repro): SEAM 2 must
// NOT reap a DIFFERENT file that merely shares the youtube id. Deleting "copy A
// in chan1" (unverified -> tombstone with the id) must never authorize the scan
// to unlink an unrelated "copy B of the same video in chan2" (a cross-post, a
// Topic/VEVO mirror, the same video in two subscriptions). mtime is no safety
// net: yt-dlp's default --mtime back-dates a fresh copy B to the video's UPLOAD
// time, so it has an OLD mtime and fails the mtime<=deletedAt gate. The
// dirname+extname confinement on the secondary match is what spares copy B.
// FAILS if the dirname/extname guard is reverted (copy B is reaped = data loss).
test('SEAM 2 SAFETY (CRITICAL): a same-id copy in a DIFFERENT folder is SPARED, whatever its mtime', { skip: rootSkip }, async () => {
  const prev = process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-tomb-root-'));
  const chan1 = path.join(root, 'chan1');
  const chan2 = path.join(root, 'chan2');
  fs.mkdirSync(chan1); fs.mkdirSync(chan2);
  process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = root;
  try {
    const YID = 'dQw4w9WgXcQ';
    // Copy A: stored in chan1, real file already gone -> unverified delete.
    const aName = `Song A [${YID}].mp4`;
    const aPath = path.join(chan1, aName);
    const aId = getMediaId(aPath);
    // Copy B: a REAL second copy in chan2 (a different subscription), unindexed,
    // OLD mtime (yt-dlp back-dates by default) -- the only copy of B.
    const bPath = path.join(chan2, `Song B [${YID}].mp4`);
    fs.writeFileSync(bPath, 'the-only-copy-of-B');

    writeDb({
      folders: [chan1, chan2],
      folderSettings: {},
      progress: {},
      metadata: {
        [aId]: {
          id: aId, name: aName, title: aName, filePath: aPath,
          folderName: 'chan1', size: 10, ext: '.mp4', type: 'video',
          addedAt: new Date().toISOString(), duration: 12, hasThumbnail: false,
          rootFolder: chan1, videoCodec: 'h264', audioCodec: 'aac',
          needsTranscode: false, releaseDate: new Date().toISOString(),
          youtubeId: YID,
        },
      },
      liked: [],
      deleteTombstones: {},
      settings: baseSettings(),
    });

    const res = await fetch(`${base}/api/videos/${aId}`, { method: 'DELETE' });
    assert.strictEqual(res.status, 200);
    const db0 = readDb();
    assert.ok(db0.deleteTombstones[aId], 'tombstone minted for copy A');
    assert.strictEqual(db0.deleteTombstones[aId].youtubeId, YID, 'tombstone carries the id');

    // Back-date copy B to BEFORE the delete (models yt-dlp --mtime upload time).
    backdate(bPath, db0.deleteTombstones[aId].deletedAt);

    await scanDirectories();

    assert.ok(fs.existsSync(bPath), 'DATA LOSS GUARD: copy B in chan2 must SURVIVE deleting copy A in chan1');
    const db = readDb();
    assert.ok(db.metadata[getMediaId(bPath)], 'copy B indexed normally');
  } finally {
    if (prev === undefined) delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
    else process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = prev;
  }
});

// Proves the dirname guard did NOT over-restrict: the REAL divergent-same-file
// case (same folder, same ext, same id, OLD mtime) is still reaped -- exactly
// the bug SEAM 2 exists to close, and with the sound (dirname+ext), not the
// unsound (mtime), safety net.
test('SEAM 2: a same-folder, same-id, OLDER-mtime divergent survivor IS still reaped (guard did not over-restrict)', { skip: rootSkip }, async () => {
  const prev = process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
  const dl = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-tomb-dl-'));
  process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = dl;
  try {
    const storedName = 'Clip- [dQw4w9WgXcQ].mp4';
    const diskName = 'Clip\uFF1F [dQw4w9WgXcQ].mp4';
    const { diskPath, id } = seedDivergentVideo(dl, storedName, diskName);

    fs.chmodSync(dl, 0o555);
    try {
      await fetch(`${base}/api/videos/${id}?removeAnyway=true`, { method: 'DELETE' });
    } finally {
      fs.chmodSync(dl, 0o755);
    }
    const db0 = readDb();
    assert.ok(db0.deleteTombstones[id], 'tombstone minted');
    backdate(diskPath, db0.deleteTombstones[id].deletedAt); // OLDER than the delete

    await scanDirectories();

    assert.ok(!fs.existsSync(diskPath), 'the genuine same-file survivor is reaped (older mtime, same dir+ext)');
    const db = readDb();
    assert.strictEqual(db.metadata[getMediaId(diskPath)], undefined, 'not resurrected');
    assert.strictEqual(db.deleteTombstones[id], undefined, 'tombstone consumed');
  } finally {
    if (prev === undefined) delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
    else process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = prev;
  }
});

test('a mtime-preserving RESTORE after a verified delete is indexed normally (no tombstone, no reap)', async () => {
  const libDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-tomb-lib-'));
  const { filePath, id } = seedLibraryWithVideo(libDir, 'restored.mp4');

  const deletedAt = Date.now();
  const res = await fetch(`${base}/api/videos/${id}`, { method: 'DELETE' });
  assert.strictEqual((await res.json()).success, true);

  // rsync -a / Syncthing restore: same content, ORIGINAL (pre-delete) mtime.
  fs.writeFileSync(filePath, 'video-bytes');
  backdate(filePath, deletedAt);

  await scanDirectories();

  assert.ok(fs.existsSync(filePath), 'restored file left alone');
  assert.ok(readDb().metadata[id], 'restored file re-indexed');
});

test('a deliberately re-added file (newer mtime) after an unverified delete is re-indexed and consumes the tombstone', async () => {
  const libDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-tomb-lib-'));
  const { filePath, id } = seedLibraryWithVideo(libDir, 'comeback.mp4');

  await unverifiedDelete(filePath, id);

  fs.writeFileSync(filePath, 'new-video-bytes');
  const t = (readDb().deleteTombstones[id].deletedAt + 60000) / 1000;
  fs.utimesSync(filePath, t, t);

  await scanDirectories();

  assert.ok(fs.existsSync(filePath), 'the new file is left alone');
  const db = readDb();
  assert.ok(db.metadata[id], 'entry re-indexed (user put it back on purpose)');
  assert.strictEqual(db.deleteTombstones[id], undefined, 'tombstone consumed');
});

test('an undeletable survivor is re-indexed honestly (tombstone consumed, no forever-suppress)', { skip: rootSkip }, async () => {
  const libDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-tomb-lib-'));
  const { filePath, id } = seedLibraryWithVideo(libDir, 'stuck.mp4');

  await unverifiedDelete(filePath, id);

  fs.writeFileSync(filePath, 'video-bytes');
  backdate(filePath, readDb().deleteTombstones[id].deletedAt);
  // Read+execute only: the walk can still enumerate/stat, but unlink
  // (a WRITE on the parent dir) fails -- the EROFS/EACCES-ish shape of #32.
  fs.chmodSync(libDir, 0o555);

  try {
    await scanDirectories();
  } finally {
    fs.chmodSync(libDir, 0o755);
  }

  assert.ok(fs.existsSync(filePath), 'file could not be removed');
  const db = readDb();
  assert.ok(db.metadata[id], 're-indexed honestly rather than hidden');
  assert.strictEqual(db.deleteTombstones[id], undefined, 'tombstone still consumed (one retry per delete)');
});

test('a 409 (read-only, no removeAnyway) mints NO tombstone and leaves the entry intact', { skip: rootSkip }, async () => {
  const libDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-tomb-lib-'));
  const { filePath, id } = seedLibraryWithVideo(libDir, 'readonly.mp4');

  fs.chmodSync(libDir, 0o555);
  let res;
  try {
    res = await fetch(`${base}/api/videos/${id}`, { method: 'DELETE' });
  } finally {
    fs.chmodSync(libDir, 0o755);
  }
  assert.strictEqual(res.status, 409);

  const db = readDb();
  assert.ok(db.metadata[id], 'library entry untouched');
  assert.strictEqual(db.deleteTombstones[id], undefined, 'no tombstone on a refused delete');
  assert.ok(fs.existsSync(filePath), 'file untouched');
});

test('removeAnyway (transient EBUSY-class failure) mints a tombstone; the next scan finishes the delete once the failure clears', { skip: rootSkip }, async () => {
  const libDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-tomb-lib-'));
  const { filePath, id } = seedLibraryWithVideo(libDir, 'busy.mp4');

  fs.chmodSync(libDir, 0o555);
  let res;
  try {
    res = await fetch(`${base}/api/videos/${id}?removeAnyway=true`, { method: 'DELETE' });
  } finally {
    fs.chmodSync(libDir, 0o755); // the transient condition clears
  }
  const body = await res.json();
  assert.strictEqual(body.success, true);
  assert.strictEqual(body.fileRemainsOnDisk, true);

  const afterDelete = readDb();
  assert.strictEqual(afterDelete.metadata[id], undefined, 'entry removed from the library');
  assert.ok(afterDelete.deleteTombstones[id], 'unverified (removeAnyway) success minted a tombstone');
  assert.ok(fs.existsSync(filePath), 'file deliberately left on disk');
  backdate(filePath, afterDelete.deleteTombstones[id].deletedAt);

  await scanDirectories();

  assert.ok(!fs.existsSync(filePath), 'the deferred retry finished the delete');
  const db = readDb();
  assert.strictEqual(db.metadata[id], undefined, 'entry stays gone');
  assert.strictEqual(db.deleteTombstones[id], undefined, 'tombstone consumed');
});
