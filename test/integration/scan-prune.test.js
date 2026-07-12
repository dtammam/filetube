'use strict';

// Isolated DATA_DIR before requiring the app so the suite never reads or
// writes real project data. Own process per file (node --test) mirrors
// test/integration/scan-api.test.js / api.test.js.
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-scan-prune-'));
const DATA_DIR = process.env.DATA_DIR;
const DB_FILE = path.join(DATA_DIR, 'db.json');
const THUMBNAIL_DIR = path.join(DATA_DIR, '.thumbnails');
const TRANSCODE_DIR = path.join(DATA_DIR, 'transcoded');

const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const { scanDirectories, getMediaId, recordServed, saveDatabase } = require('../../server');

function baseSettings(overrides) {
  return {
    scanIntervalMinutes: 30,
    pruneMissing: true,
    cacheMaxBytes: null,
    cacheMaxAgeDays: 30,
    ...overrides,
  };
}

// v1.30 A3 (in-memory DB read cache): seed via the exported `saveDatabase()`
// (an established test primitive, see CONTRIBUTING.md) rather than a raw
// `fs.writeFileSync`, so the in-process db cache stays coherent.
function writeDb(db) {
  saveDatabase(db);
}

function readDb() {
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

beforeEach(() => {
  // Start every test from a fresh db.json and empty sidecar dirs so
  // prune/cleanup assertions aren't polluted across cases.
  if (fs.existsSync(DB_FILE)) fs.rmSync(DB_FILE);
  for (const dir of [THUMBNAIL_DIR, TRANSCODE_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
    for (const name of fs.readdirSync(dir)) fs.rmSync(path.join(dir, name));
  }
});

// ---- (a) THE CATASTROPHE GUARD -------------------------------------------
// The single most important test in the feature: a configured root folder
// that is entirely missing/unmounted must NEVER lose its db.metadata
// entries during a scan — regardless of the pruneMissing toggle.

test('(a) CATASTROPHE GUARD: entries under a missing/unmounted root survive with pruneMissing=true', async () => {
  const missingRoot = path.join(os.tmpdir(), `filetube-missing-${Date.now()}-true`);
  // Never created on disk -> simulates an unmounted/removed drive.
  const filePath = path.join(missingRoot, 'ghost.mp4');
  const id = getMediaId(filePath);
  writeDb({
    folders: [missingRoot],
    folderSettings: {},
    progress: { [id]: { position: 12 } },
    metadata: {
      [id]: {
        id, name: 'ghost.mp4', title: 'ghost', filePath, folderName: 'ghost-lib',
        size: 123, ext: '.mp4', type: 'video', addedAt: Date.now(),
        duration: 10, hasThumbnail: false, artist: '', rootFolder: missingRoot,
      },
    },
    settings: baseSettings({ pruneMissing: true }),
  });

  await scanDirectories();

  const db = readDb();
  assert.ok(db.metadata[id], 'entry under a missing root must survive the scan even with pruneMissing on');
  assert.equal(db.metadata[id].filePath, filePath);
  assert.ok(db.progress[id], 'watch progress for a retained (mount-loss) entry must not be touched');
});

test('(a) CATASTROPHE GUARD: entries under a missing/unmounted root survive with pruneMissing=false', async () => {
  const missingRoot = path.join(os.tmpdir(), `filetube-missing-${Date.now()}-false`);
  const filePath = path.join(missingRoot, 'ghost2.mp4');
  const id = getMediaId(filePath);
  writeDb({
    folders: [missingRoot],
    folderSettings: {},
    progress: {},
    metadata: {
      [id]: {
        id, name: 'ghost2.mp4', title: 'ghost2', filePath, folderName: 'ghost-lib',
        size: 123, ext: '.mp4', type: 'video', addedAt: Date.now(),
        duration: 10, hasThumbnail: false, artist: '', rootFolder: missingRoot,
      },
    },
    settings: baseSettings({ pruneMissing: false }),
  });

  await scanDirectories();

  const db = readDb();
  assert.ok(db.metadata[id], 'entry under a missing root must survive the scan with pruneMissing off too (toggle-independent)');
});

// ---- (b)/(c) individually-gone file under a PRESENT root -----------------

test('(b) pruneMissing=true + present root + individually-gone file: pruned, sidecars cleaned up', async () => {
  const presentRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-present-'));
  // v1.33 T4: a second, SURVIVING file under the same root -- without it,
  // this root's entire prior content would vanish at once and the new
  // empty-but-present unmount signature (detectVanishedRoots) would
  // deliberately retain everything instead of pruning. An INDIVIDUAL
  // deletion, by definition, leaves siblings behind; this keeper is that
  // sibling. (The full-vanish behavior has its own dedicated tests in
  // scan-prune-vanished-root.test.js.)
  const keeperPath = path.join(presentRoot, 'keeper.mp4');
  fs.writeFileSync(keeperPath, 'keeper-bytes');
  const filePath = path.join(presentRoot, 'gone.mp4');
  // Deliberately never created on disk -> simulates a deleted individual file.
  const id = getMediaId(filePath);
  fs.writeFileSync(path.join(THUMBNAIL_DIR, `${id}.jpg`), 'thumb');
  fs.writeFileSync(path.join(TRANSCODE_DIR, `${id}.mp4`), 'transcoded');

  writeDb({
    folders: [presentRoot],
    folderSettings: {},
    progress: { [id]: { position: 42 } },
    metadata: {
      [id]: {
        id, name: 'gone.mp4', title: 'gone', filePath, folderName: path.basename(presentRoot),
        size: 100, ext: '.mp4', type: 'video', addedAt: Date.now(),
        duration: 10, hasThumbnail: false, artist: '', rootFolder: presentRoot,
      },
    },
    settings: baseSettings({ pruneMissing: true }),
  });

  await scanDirectories();

  const db = readDb();
  assert.ok(!db.metadata[id], 'an individually-deleted file under a present root should be pruned when pruneMissing is on');
  assert.ok(!db.progress[id], 'watch progress for a pruned entry should be removed');
  assert.ok(!fs.existsSync(path.join(THUMBNAIL_DIR, `${id}.jpg`)), 'thumbnail sidecar should be deleted on prune');
  assert.ok(!fs.existsSync(path.join(TRANSCODE_DIR, `${id}.mp4`)), 'transcode sidecar should be deleted on prune');
});

test('(c) pruneMissing=false + present root + individually-gone file: retained as a stale entry', async () => {
  const presentRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-present-'));
  const filePath = path.join(presentRoot, 'gone2.mp4');
  const id = getMediaId(filePath);
  fs.writeFileSync(path.join(THUMBNAIL_DIR, `${id}.jpg`), 'thumb');
  fs.writeFileSync(path.join(TRANSCODE_DIR, `${id}.mp4`), 'transcoded');

  writeDb({
    folders: [presentRoot],
    folderSettings: {},
    progress: { [id]: { position: 7 } },
    metadata: {
      [id]: {
        id, name: 'gone2.mp4', title: 'gone2', filePath, folderName: path.basename(presentRoot),
        size: 100, ext: '.mp4', type: 'video', addedAt: Date.now(),
        duration: 10, hasThumbnail: false, artist: '', rootFolder: presentRoot,
      },
    },
    settings: baseSettings({ pruneMissing: false }),
  });

  await scanDirectories();

  const db = readDb();
  assert.ok(db.metadata[id], 'entry should be retained (not pruned) when pruneMissing is off');
  assert.ok(db.progress[id], 'progress for a retained entry should not be cleaned up');
  assert.ok(fs.existsSync(path.join(THUMBNAIL_DIR, `${id}.jpg`)), 'thumbnail sidecar should NOT be deleted when retained');
  assert.ok(fs.existsSync(path.join(TRANSCODE_DIR, `${id}.mp4`)), 'transcode sidecar should NOT be deleted when retained');
});

// ---- (e) B: mount-loss guard depth -- unreadable subtree / nested-mount drop ----
// Simulate a nested/child mount dropping (or any transiently-unreadable
// subdirectory, e.g. EACCES/EIO/ESTALE) by chmod-ing a subdirectory
// unreadable. This is realistic for BOTH the "nested mount under a present
// root drops" case and the "subdirectory read error" case -- both surface as
// a readdir failure on that subtree, which scanDirRecursive now records into
// `unreadablePaths` and selectPrunableIds retains unconditionally. Skipped
// when running as root (root bypasses chmod 000 restrictions).
const runningAsRoot = typeof process.getuid === 'function' && process.getuid() === 0;

test('(e) nested-mount / subdir read-error: an entry under an UNREADABLE subdirectory is retained, not pruned', { skip: runningAsRoot }, async () => {
  const presentRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-present-'));
  const subDir = path.join(presentRoot, 'nested-mount');
  fs.mkdirSync(subDir);
  const filePath = path.join(subDir, 'movie.mp4');
  fs.writeFileSync(filePath, 'video-bytes');
  const id = getMediaId(filePath);

  writeDb({
    folders: [presentRoot],
    folderSettings: {},
    progress: { [id]: { position: 5 } },
    metadata: {
      [id]: {
        id, name: 'movie.mp4', title: 'movie', filePath, folderName: 'nested-mount',
        size: fs.statSync(filePath).size, ext: '.mp4', type: 'video', addedAt: Date.now(),
        duration: 10, hasThumbnail: false, artist: '', rootFolder: presentRoot,
      },
    },
    settings: baseSettings({ pruneMissing: true }),
  });

  // Drop the nested mount / make the subtree unreadable (simulates a dropped
  // nested mount or a transient EACCES/EIO on that subtree).
  fs.chmodSync(subDir, 0o000);
  try {
    await scanDirectories();
  } finally {
    fs.chmodSync(subDir, 0o755); // restore so cleanup/rmSync works
  }

  const db = readDb();
  assert.ok(db.metadata[id], 'entry under an unreadable subtree must be retained, not mistaken for a bulk deletion');
  assert.ok(db.progress[id], 'watch progress for a retained (unreadable-subtree) entry must not be touched');
});

// ---- (f) B: legacy rootFolder-less entry under a missing root -----------
test('(f) legacy entry with no rootFolder under a missing/unresolvable root is retained', async () => {
  const missingRoot = path.join(os.tmpdir(), `filetube-missing-legacy-${Date.now()}`);
  const filePath = path.join(missingRoot, 'legacy.mp4');
  const id = getMediaId(filePath);

  writeDb({
    folders: [missingRoot],
    folderSettings: {},
    progress: {},
    metadata: {
      [id]: {
        id, name: 'legacy.mp4', title: 'legacy', filePath, folderName: 'legacy-lib',
        size: 100, ext: '.mp4', type: 'video', addedAt: Date.now(),
        duration: 10, hasThumbnail: false, artist: '',
        // No rootFolder -- simulates a pre-backfill legacy entry.
      },
    },
    settings: baseSettings({ pruneMissing: true }),
  });

  await scanDirectories();

  const db = readDb();
  assert.ok(db.metadata[id], 'a legacy rootFolder-less entry whose derived root is missing must be retained');
});

// ---- (g) FR3.1: per-FILE statSync throw (readdir succeeded) ---------------
// A transient per-file stat error (ESTALE/EIO/EACCES on a flaky mount) even
// though the containing directory's OWN readdir succeeds must not be
// mistaken for the file having been deleted -- scanDirRecursive now marks the
// CONTAINING directory unreadable (mirroring the readdir-failure guard, one
// level deeper), so selectPrunableIds retains every entry under it. A
// genuinely-gone file elsewhere in the SAME scan (a different, fully-readable
// directory under the same present root) must still prune normally -- proving
// the fix isn't a blanket "retain everything this scan" no-op. (A
// genuinely-gone file inside the SAME directory as the flaky file would also
// be retained this pass by design -- the whole subtree is conservatively kept
// for one pass and re-evaluated next scan -- so this test uses a sibling
// directory to demonstrate selective, not blanket, retention.)
test('(g) FR3.1: a present file whose statSync throws mid-scan is retained, while a genuinely-gone file elsewhere in the same scan still prunes', async () => {
  const presentRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-present-'));
  // v1.33 T4: a surviving sibling, so the flaky-stat + gone pair doesn't
  // read as "the root's entire content vanished" to detectVanishedRoots
  // (which would retain the gone file too) -- same rationale as test (b).
  fs.writeFileSync(path.join(presentRoot, 'keeper.mp4'), 'keeper-bytes');
  const flakyDir = path.join(presentRoot, 'flaky-subtree');
  fs.mkdirSync(flakyDir);
  const flakyPath = path.join(flakyDir, 'flaky.mp4');
  fs.writeFileSync(flakyPath, 'video-bytes');
  const flakySize = fs.statSync(flakyPath).size;
  const flakyId = getMediaId(flakyPath);

  const otherDir = path.join(presentRoot, 'other');
  fs.mkdirSync(otherDir);
  const goneFilePath = path.join(otherDir, 'gone.mp4');
  // Deliberately never created on disk -> a genuinely-deleted file in an
  // UNRELATED, fully-readable directory elsewhere in the same scan.
  const goneId = getMediaId(goneFilePath);

  writeDb({
    folders: [presentRoot],
    folderSettings: {},
    progress: { [flakyId]: { position: 3 }, [goneId]: { position: 9 } },
    metadata: {
      [flakyId]: {
        id: flakyId, name: 'flaky.mp4', title: 'flaky', filePath: flakyPath, folderName: 'flaky-subtree',
        size: flakySize, ext: '.mp4', type: 'video', addedAt: Date.now(),
        duration: 10, hasThumbnail: false, artist: '', rootFolder: presentRoot,
      },
      [goneId]: {
        id: goneId, name: 'gone.mp4', title: 'gone', filePath: goneFilePath, folderName: 'other',
        size: 100, ext: '.mp4', type: 'video', addedAt: Date.now(),
        duration: 10, hasThumbnail: false, artist: '', rootFolder: presentRoot,
      },
    },
    settings: baseSettings({ pruneMissing: true }),
  });

  // Simulate a transient per-file stat error for exactly the flaky file, even
  // though its directory's own readdir succeeds -- the scenario FR3.1 closes.
  // Every other stat call passes through untouched.
  // v1.30 A2: `scanDirRecursive` now stats each file via `fs.promises.stat`
  // (not `fs.statSync`) -- `fs.promises.stat` is a SEPARATE implementation
  // (not a thin wrapper around the sync version), so patching `fs.statSync`
  // alone would silently no-op here and this test would stop exercising the
  // FR3.1 guard at all (the flaky file would just stat successfully and take
  // the normal reuse path) while still happening to pass on unrelated
  // grounds. Patch `fs.promises.stat` instead.
  const originalPromisesStat = fs.promises.stat;
  fs.promises.stat = (p, ...rest) => {
    if (p === flakyPath) {
      const err = new Error(`EACCES: permission denied, stat '${p}'`);
      err.code = 'EACCES';
      return Promise.reject(err);
    }
    return originalPromisesStat.call(fs.promises, p, ...rest);
  };

  try {
    await scanDirectories();
  } finally {
    fs.promises.stat = originalPromisesStat;
  }

  const db = readDb();
  assert.ok(db.metadata[flakyId], 'a present file whose statSync throws mid-scan must be retained, not pruned as if genuinely deleted');
  assert.ok(db.progress[flakyId], 'watch progress for the retained flaky entry must not be touched');
  assert.ok(!db.metadata[goneId], 'a genuinely-gone file elsewhere in the same scan must still prune (not a blanket no-op)');
  assert.ok(!db.progress[goneId], 'watch progress for the genuinely-pruned entry should be removed');
});

// ---- (h) FR3.2: persistedServedAt cleanup on prune -------------------------
// The `persistedServedAt` write-throttle map must be cleared for an id when
// the scan prunes it -- otherwise a stale map entry can suppress
// `lastServedAt` persistence for a re-added same-id path (same filePath,
// hence same md5-derived id) within RECENT_STREAM_MS, because recordServed's
// hot-path short-circuit would see a "recent" map entry left over from the
// file's PRIOR incarnation and never touch disk for the new one.
test('(h) FR3.2: a pruned id\'s persistedServedAt entry is cleared, so a re-added same-id file persists lastServedAt normally', async () => {
  const presentRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-present-'));
  // v1.33 T4: a surviving sibling so the churn file's deletion stays an
  // INDIVIDUAL prune rather than tripping detectVanishedRoots' full-vanish
  // retention -- same rationale as tests (b)/(g).
  fs.writeFileSync(path.join(presentRoot, 'keeper.mp4'), 'keeper-bytes');
  const filePath = path.join(presentRoot, 'churn.mp4');
  fs.writeFileSync(filePath, 'v1');
  const id = getMediaId(filePath);

  writeDb({
    folders: [presentRoot],
    folderSettings: {},
    progress: {},
    metadata: {
      [id]: {
        id, name: 'churn.mp4', title: 'churn', filePath, folderName: path.basename(presentRoot),
        size: fs.statSync(filePath).size, ext: '.mp4', type: 'video', addedAt: Date.now(),
        duration: 10, hasThumbnail: false, artist: '', rootFolder: presentRoot,
      },
    },
    settings: baseSettings({ pruneMissing: true }),
  });

  // Seed the write-throttle map (mirrors the /video Range-request hot path):
  // this persists a lastServedAt AND sets a "recent" persistedServedAt[id].
  // recordServed's actual write is serialized through updateDatabase (a
  // promise chain), so `await` it to observe the persisted write
  // deterministically -- see server.js's recordServed doc comment.
  await recordServed(id);
  assert.equal(typeof readDb().metadata[id].lastServedAt, 'number', 'sanity: recordServed persisted an initial lastServedAt');

  // The file is deleted -> the scan prunes this id (pruneMissing on).
  fs.rmSync(filePath);
  await scanDirectories();
  assert.ok(!readDb().metadata[id], 'sanity: the id was actually pruned by this scan');

  // The SAME path is re-added (a new file lands at the identical filePath, so
  // getMediaId derives the identical id) -- a fresh incarnation with no
  // lastServedAt of its own.
  fs.writeFileSync(filePath, 'v2');
  await scanDirectories();
  assert.ok(readDb().metadata[id], 'sanity: the re-added file was picked back up by the scan');
  assert.equal(readDb().metadata[id].lastServedAt, undefined, 'sanity: the freshly re-added entry starts with no lastServedAt');

  // If the stale persistedServedAt[id] entry from the PRIOR incarnation had
  // survived the prune, this call would short-circuit on the map lookup and
  // never persist -- proving the prune-path cleanup actually ran.
  await recordServed(id);
  assert.equal(typeof readDb().metadata[id].lastServedAt, 'number',
    're-added same-id file must persist lastServedAt normally, not be suppressed by a stale pre-prune persistedServedAt entry');
});

// ---- (d) zero-regression: a normal, all-present scan behaves as before ----

test('(d) all roots present and all files present: no spurious retention or pruning', async () => {
  const presentRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-present-'));
  const filePath = path.join(presentRoot, 'keep.mp4');
  fs.writeFileSync(filePath, 'video-bytes');
  const size = fs.statSync(filePath).size;
  const id = getMediaId(filePath);

  writeDb({
    folders: [presentRoot],
    folderSettings: {},
    progress: {},
    metadata: {
      [id]: {
        id, name: 'keep.mp4', title: 'keep', filePath, folderName: path.basename(presentRoot),
        size, ext: '.mp4', type: 'video', addedAt: Date.now(),
        duration: 10, hasThumbnail: false, artist: '', rootFolder: presentRoot,
      },
    },
    settings: baseSettings({ pruneMissing: true }),
  });

  await scanDirectories();

  const db = readDb();
  assert.ok(db.metadata[id], 'a present, unchanged file must remain in metadata');
  assert.equal(Object.keys(db.metadata).length, 1, 'no spurious retained/pruned extras appear');
});
