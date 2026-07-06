'use strict';

// [INTEGRATION] C3+C7 + D1 (T4 fix round #2) + E1 (T4 fix round #3, CRITICAL
// regression fix): the module-owned scan root (`ytdlp.extraScanRoots()`),
// merged into `server.js`'s `runScanDirectories` at the single
// `currentFolders` anchor (server.js:945). Proves, against the REAL
// server.js scan path (not a re-implementation):
//   - Enabled: a file placed directly in `FILETUBE_YTDLP_DOWNLOAD_DIR` is
//     scanned/indexed by the EXISTING scanner with zero scanner changes
//     (AC17), even though the directory was NEVER added to `db.folders`.
//   - `db.folders` (the persisted array) never lists the download dir --
//     closes C3+C7(i). NOTE (v1.12.0, FR-G part 2, Dean-approved): the prior
//     C7(ii) ("`GET /api/config` never lists a folder the operator didn't
//     add") is INTENTIONALLY SOFTENED starting v1.12.0 -- the download dir
//     now DOES appear in the `GET /api/config` RESPONSE as a synthetic,
//     display-only folder (merged in, never persisted into `db.folders`; see
//     `test/integration/ytdlp-synthetic-folder.test.js` for the dedicated
//     coverage of that behavior). The invariant this file keeps proving is
//     the one that actually matters for C3/C7's original intent: the
//     download dir is never WRITTEN to `db.folders`, so a `POST
//     /api/config` save can never evict it and it carries no scan/prune
//     authority of its own -- `extraScanRoots()` remains authoritative.
//   - Disabled AND the directory was never created (fresh-install case):
//     `extraScanRoots()` contributes nothing, so `currentFolders` is exactly
//     `db.folders` -- byte-identical to a never-enabled install (ACs 1-6).
//   - D1 (CRITICAL, Dean's decision): disabled AND the directory STILL
//     EXISTS with content (a was-enabled-then-disabled install) -- the
//     content keeps being scanned, so `pruneMissing` never reaps it.
//   - E1 (CRITICAL, CONFIRMED regression the D1 fix introduced, now fixed):
//     `extraScanRoots` gates on `isEnabled(config)` OR `fs.existsSync` -- an
//     OR-gate, not `fs.existsSync` alone. ENABLED + the directory
//     TRANSIENTLY ABSENT (simulating an unmount) must still contribute
//     `downloadDir` to the scan set UNCONDITIONALLY, so it lands in
//     `missingRoots` and the mount-loss guard (`selectPrunableIds`,
//     server.js:444) protects previously-downloaded ids/thumbnails/transcode
//     sidecars/`db.progress` instead of `pruneMissing` reaping them.
//
// Isolated DATA_DIR before requiring the app, per the existing pattern
// (test/integration/scan-api.test.js, ytdlp-disabled-noop.test.js).

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-test-'));
delete process.env.FILETUBE_YTDLP_ENABLED;
delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, scanDirectories, loadDatabase, updateDatabase, getMediaId, transcodedPath } = require('../../server');
const ytdlp = require('../../lib/ytdlp');

const DATA_DIR = process.env.DATA_DIR;
const THUMBNAIL_DIR = path.join(DATA_DIR, '.thumbnails');

let server;
let base;
let downloadDir;

before(async () => {
  downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-scanroot-'));
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  delete process.env.FILETUBE_YTDLP_ENABLED;
  delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(downloadDir, { recursive: true, force: true });
});

test('disabled AND dir absent: extraScanRoots contributes nothing -- a file in a NEVER-CREATED download dir is never scanned (inert, fresh-install case)', async () => {
  const neverCreatedDir = path.join(os.tmpdir(), `filetube-ytdlp-never-created-${Date.now()}`);
  // Deliberately never mkdir'd -- simulates a fresh install that has never
  // been enabled, so `ensureDownloadDir` has never run.
  assert.equal(fs.existsSync(neverCreatedDir), false, 'sanity: the dir must not exist on disk for this case');
  process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = neverCreatedDir;
  try {
    await scanDirectories();

    const db = loadDatabase();
    const paths = Object.values(db.metadata || {}).map((m) => m.filePath);
    assert.ok(!paths.some((p) => p && p.startsWith(neverCreatedDir)), 'a never-created download dir must never contribute to the scan');
    assert.deepEqual(db.folders || [], [], 'db.folders must be untouched');
    assert.deepEqual(ytdlp.extraScanRoots(ytdlp.parseYtdlpConfig({ FILETUBE_YTDLP_DOWNLOAD_DIR: neverCreatedDir })), []);
  } finally {
    delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
  }
});

test('D1: disabled AND dir EXISTS with content -- still scanned/indexed (preserved), even though the module is off', async () => {
  fs.writeFileSync(path.join(downloadDir, 'preserved.mp4'), 'not a real video');

  // FILETUBE_YTDLP_ENABLED is NOT set here -- the module is disabled -- but
  // the directory (from the shared `before()` mkdtemp) genuinely exists on
  // disk, exactly like a was-enabled-then-disabled install whose downloads
  // are still sitting there.
  assert.equal(process.env.FILETUBE_YTDLP_ENABLED, undefined, 'sanity: the module must be disabled for this case');
  assert.deepEqual(
    ytdlp.extraScanRoots(ytdlp.parseYtdlpConfig({ FILETUBE_YTDLP_DOWNLOAD_DIR: downloadDir })),
    [path.resolve(downloadDir)],
    'extraScanRoots must still contribute an existing download dir even when disabled (D1)',
  );

  process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = downloadDir;
  try {
    await scanDirectories();

    const db = loadDatabase();
    const paths = Object.values(db.metadata || {}).map((m) => m.filePath);
    assert.ok(paths.includes(path.join(downloadDir, 'preserved.mp4')), 'a disabled module must still scan a download dir that exists with content (D1)');
    assert.deepEqual(db.folders || [], [], 'db.folders must still never be written to, even in the D1 disabled-but-scanned case');
  } finally {
    delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
  }
});

// ---- D1 MANDATED footgun-closed regression: enable -> download+index a file
// (with a thumbnail, a transcode sidecar, and a db.progress entry) -> disable
// -> scan with pruneMissing ON -> everything survives. -----------------------

test('D1 footgun-closed: disabling the module after a download preserves the id, its thumbnail, its transcode sidecar, and its db.progress entry through a pruneMissing scan', async () => {
  const footgunDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-footgun-'));
  try {
    // 1. Enable, and "download" a file directly into the module's download
    // dir (simulating a completed yt-dlp download -- this test doesn't spawn
    // the real binary, it just proves the SCAN/PRUNE interaction).
    process.env.FILETUBE_YTDLP_ENABLED = 'true';
    process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = footgunDir;
    const filePath = path.join(footgunDir, 'downloaded-episode.mp4');
    fs.writeFileSync(filePath, 'not a real video');

    await scanDirectories();

    const id = getMediaId(filePath);
    let db = loadDatabase();
    assert.ok(db.metadata[id], 'sanity: the downloaded file must be indexed while enabled');
    assert.deepEqual(db.folders || [], [], 'sanity: still never written into db.folders');

    // Simulate the rest of a real download's footprint: a thumbnail, a
    // transcode sidecar, and a watch-progress entry -- exactly the sinks
    // server.js's prune path touches (thumbnails :1044ish, transcode :1053ish,
    // db.progress :1116ish).
    fs.mkdirSync(THUMBNAIL_DIR, { recursive: true });
    fs.writeFileSync(path.join(THUMBNAIL_DIR, `${id}.jpg`), 'thumb');
    const sidecarPath = transcodedPath(id);
    fs.mkdirSync(path.dirname(sidecarPath), { recursive: true });
    fs.writeFileSync(sidecarPath, 'transcoded');
    await updateDatabase((fresh) => {
      fresh.metadata[id].hasThumbnail = true;
      fresh.progress[id] = { position: 42, duration: 100 };
    });
    assert.ok(loadDatabase().progress[id], 'sanity: the watch-progress entry was seeded');

    // Sanity: pruneMissing is ON (the default) -- this is the exact toggle
    // state the footgun requires to reap anything at all.
    assert.equal(loadDatabase().settings.pruneMissing, true, 'sanity: pruneMissing must be ON for this regression to be meaningful');

    // 2. Disable the module -- the download dir on disk is untouched.
    delete process.env.FILETUBE_YTDLP_ENABLED;

    // 3. Run the scan again (pruneMissing ON, module disabled).
    await scanDirectories();

    // 4. Everything must survive: the id, its thumbnail, its transcode
    // sidecar, and its db.progress entry -- NONE of it pruned just because
    // the module was disabled.
    db = loadDatabase();
    assert.ok(db.metadata[id], 'the id must survive a pruneMissing scan after disabling (D1)');
    assert.ok(db.progress[id], 'the db.progress watch-progress entry must survive');
    assert.ok(fs.existsSync(path.join(THUMBNAIL_DIR, `${id}.jpg`)), 'the thumbnail must survive');
    assert.ok(fs.existsSync(sidecarPath), 'the transcode sidecar must survive');
  } finally {
    delete process.env.FILETUBE_YTDLP_ENABLED;
    delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
    fs.rmSync(footgunDir, { recursive: true, force: true });
  }
});

// ---- E1 MANDATED regression: module ENABLED + downloadDir TRANSIENTLY
// ABSENT on disk (simulating an unmount) must still be mount-loss-protected,
// NOT reaped -- the coverage the D1 test above never exercised (it only ever
// disabled the module; it never tested a directory going missing WHILE
// enabled). This is the exact regression the adversarial /code-review
// confirmed round #2 introduced. ----------------------------------------------

test('E1 mount-loss regression: ENABLED module + downloadDir absent on disk (simulated unmount) preserves the id, its thumbnail, its transcode sidecar, and its db.progress entry through a pruneMissing scan', async () => {
  const unmountDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-unmount-'));
  try {
    // 1. Enable, and "download" a file directly into the module's download
    // dir while it genuinely exists on disk, so the real server.js scan
    // indexes it (mirrors the D1 footgun test's setup).
    process.env.FILETUBE_YTDLP_ENABLED = 'true';
    process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = unmountDir;
    const filePath = path.join(unmountDir, 'downloaded-episode.mp4');
    fs.writeFileSync(filePath, 'not a real video');

    await scanDirectories();

    const id = getMediaId(filePath);
    let db = loadDatabase();
    assert.ok(db.metadata[id], 'sanity: the downloaded file must be indexed while enabled and mounted');
    assert.equal(db.metadata[id].rootFolder, path.resolve(unmountDir), 'sanity: rootFolder must be the resolved download dir, matching what extraScanRoots contributes');
    assert.deepEqual(db.folders || [], [], 'sanity: still never written into db.folders');

    // Simulate the rest of a real download's footprint: a thumbnail, a
    // transcode sidecar, and a watch-progress entry -- exactly the sinks
    // server.js's prune path touches (thumbnails :1051, transcode :1061,
    // db.progress :1123).
    fs.mkdirSync(THUMBNAIL_DIR, { recursive: true });
    fs.writeFileSync(path.join(THUMBNAIL_DIR, `${id}.jpg`), 'thumb');
    const sidecarPath = transcodedPath(id);
    fs.mkdirSync(path.dirname(sidecarPath), { recursive: true });
    fs.writeFileSync(sidecarPath, 'transcoded');
    await updateDatabase((fresh) => {
      fresh.metadata[id].hasThumbnail = true;
      fresh.progress[id] = { position: 42, duration: 100 };
    });
    assert.ok(loadDatabase().progress[id], 'sanity: the watch-progress entry was seeded');

    // Sanity: pruneMissing is ON (the default) -- the exact toggle state the
    // regression requires to reap anything at all.
    assert.equal(loadDatabase().settings.pruneMissing, true, 'sanity: pruneMissing must be ON for this regression to be meaningful');

    // 2. Simulate a transient unmount: the directory itself goes ABSENT from
    // disk, WHILE the module REMAINS ENABLED (this is the exact scenario D1's
    // `fs.existsSync`-only gate defeated -- the module never got disabled;
    // an infra hiccup made the volume vanish out from under it).
    fs.rmSync(unmountDir, { recursive: true, force: true });
    assert.equal(fs.existsSync(unmountDir), false, 'sanity: the download dir must be genuinely absent for this regression');
    assert.equal(process.env.FILETUBE_YTDLP_ENABLED, 'true', 'sanity: the module must still be ENABLED for this regression');

    // extraScanRoots must contribute the dir UNCONDITIONALLY while enabled,
    // even though it does not currently exist on disk -- this is the E1 fix
    // itself, asserted directly against the pure helper before proving the
    // end-to-end scan/prune consequence below.
    const cfg = ytdlp.parseYtdlpConfig({ FILETUBE_YTDLP_ENABLED: 'true', FILETUBE_YTDLP_DOWNLOAD_DIR: unmountDir });
    assert.deepEqual(
      ytdlp.extraScanRoots(cfg),
      [path.resolve(unmountDir)],
      'extraScanRoots must contribute an enabled downloadDir even when it is transiently absent on disk (E1)',
    );

    // 3. Run the real server.js scan again (pruneMissing ON, module still
    // enabled, directory absent). Because extraScanRoots still contributed
    // `downloadDir`, the per-folder loop's own `fs.existsSync` check
    // (server.js:961) marks it a `missingRoot` -- landing it in
    // `selectPrunableIds`'s mount-loss guard (server.js:444) instead of
    // letting the id fall through to prune.
    await scanDirectories();

    // 4. Everything must survive: the id, its thumbnail, its transcode
    // sidecar, and its db.progress entry -- NONE of it pruned just because
    // the volume was transiently gone WHILE STILL ENABLED.
    db = loadDatabase();
    assert.ok(db.metadata[id], 'the id must survive a pruneMissing scan while enabled and the download dir is transiently absent (E1)');
    assert.ok(db.progress[id], 'the db.progress watch-progress entry must survive');
    assert.ok(fs.existsSync(path.join(THUMBNAIL_DIR, `${id}.jpg`)), 'the thumbnail must survive');
    assert.ok(fs.existsSync(sidecarPath), 'the transcode sidecar must survive');
  } finally {
    delete process.env.FILETUBE_YTDLP_ENABLED;
    delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
    fs.rmSync(unmountDir, { recursive: true, force: true });
  }
});

// ---- D2 MANDATED upgrade-path migration test: a stale db.folders entry from
// the pre-fix branch is removed, never surfaced by GET /api/config, and the
// content is still scanned via extraScanRoots. -------------------------------

test('D2: an upgraded db.json with a stale downloadDir entry in db.folders is migrated out on startBackground, GET /api/config stays clean, content still scans', async () => {
  const upgradeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-upgrade-'));
  try {
    // Simulate the pre-fix branch's leftover: downloadDir pushed straight
    // into the client-owned db.folders (what `updateDatabase` looked like
    // before the C3+C7 module-owned scan root replaced it).
    await updateDatabase((db) => {
      db.folders = Array.from(new Set([...(db.folders || []), upgradeDir]));
    });
    assert.ok(loadDatabase().folders.includes(upgradeDir), 'sanity: the stale entry was seeded');

    const filePath = path.join(upgradeDir, 'legacy-download.mp4');
    fs.writeFileSync(filePath, 'not a real video');

    process.env.FILETUBE_YTDLP_ENABLED = 'true';
    process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = upgradeDir;
    const config = ytdlp.parseYtdlpConfig(process.env);
    const deps = { updateDatabase, loadDatabase, scanDirectories, getMediaId };

    // Directly await the migration (the production function `startBackground`
    // itself calls) for a deterministic assertion, independent of any timer
    // arming/interval side effects `startBackground` would also trigger.
    await ytdlp.migrateStaleDownloadDirFromFolders(deps, config);

    const migratedDb = loadDatabase();
    assert.ok(!migratedDb.folders.includes(upgradeDir), 'the stale downloadDir entry must be removed from db.folders');

    // FR-G part 2 (v1.12.0, Dean-approved C7(ii) softening): the migrated-out
    // dir DOES still appear in the GET /api/config RESPONSE -- but only as
    // the synthetic, display-only merge (derived fresh from extraScanRoots
    // on every request), never because it was re-added to db.folders (which
    // migratedDb.folders above already proved stays clean).
    const configRes = await fetch(`${base}/api/config`);
    const configBody = await configRes.json();
    assert.ok(configBody.folders.includes(path.resolve(upgradeDir)), 'GET /api/config must surface the migrated dir as the FR-G synthetic folder (not because it was re-added to db.folders)');
    assert.ok(!loadDatabase().folders.includes(upgradeDir), 'the underlying db.folders must still never contain it -- the GET response merge is display-only');

    // Content must still be scanned -- via extraScanRoots, independent of
    // db.folders now being clean.
    await scanDirectories();
    const paths = Object.values(loadDatabase().metadata || {}).map((m) => m.filePath);
    assert.ok(paths.includes(filePath), 'content under the (now module-owned) download dir must still be scanned after the migration');

    // Idempotent: calling it again with a clean db.folders is a true no-op.
    await ytdlp.migrateStaleDownloadDirFromFolders(deps, config);
    assert.ok(!loadDatabase().folders.includes(upgradeDir));
  } finally {
    delete process.env.FILETUBE_YTDLP_ENABLED;
    delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
    fs.rmSync(upgradeDir, { recursive: true, force: true });
  }
});

test('enabled: a file placed directly in FILETUBE_YTDLP_DOWNLOAD_DIR is scanned/indexed WITHOUT ever being added to db.folders (AC17, C3+C7)', async () => {
  process.env.FILETUBE_YTDLP_ENABLED = 'true';
  process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = downloadDir;
  try {
    const filePath = path.join(downloadDir, 'video.mp4');
    fs.writeFileSync(filePath, 'not a real video');

    await scanDirectories();

    const db = loadDatabase();
    const paths = Object.values(db.metadata || {}).map((m) => m.filePath);
    assert.ok(paths.includes(filePath), 'the file in the module-owned download dir must be indexed by the existing scanner');
    assert.ok(!(db.folders || []).includes(downloadDir), 'downloadDir must NEVER be written into db.folders (C3+C7)');

    // FR-G part 2 (v1.12.0, Dean-approved C7(ii) softening): GET /api/config
    // NOW surfaces the module's download dir in its response folders array,
    // as a synthetic, display-only merge -- but db.folders (asserted above)
    // still never contains it, so it still carries no persisted-config
    // authority and a POST /api/config save can never evict it.
    const configRes = await fetch(`${base}/api/config`);
    const configBody = await configRes.json();
    assert.ok(configBody.folders.includes(path.resolve(downloadDir)), 'GET /api/config must surface the module-owned download dir as the FR-G synthetic folder');
  } finally {
    delete process.env.FILETUBE_YTDLP_ENABLED;
    delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
  }
});

// ---- FIX-9 (two-reviewer gate): cleanDisplayTitle's false-positive fix -----
// must be scoped to files actually rooted under the yt-dlp download dir, not
// applied library-wide -- a coincidentally 11-char-bracketed non-yt-dlp file
// must be left completely untouched.

test('FIX-9 regression: a non-yt-dlp library file with a coincidentally 11-char bracket keeps its raw title, while a genuine yt-dlp download (under the module root) is still cleaned', async () => {
  const libraryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-fix9-library-'));
  process.env.FILETUBE_YTDLP_ENABLED = 'true';
  process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = downloadDir;
  try {
    // A legit, non-yt-dlp file whose bracketed suffix HAPPENS to be exactly
    // 11 id-shaped characters ('Holiday2024' is 11 chars) -- the false-
    // positive shape this fix protects against.
    const libraryFilePath = path.join(libraryDir, 'Vacation_2024 [Holiday2024].mp4');
    fs.writeFileSync(libraryFilePath, 'not a real video');

    // A genuine yt-dlp download under the module's own root, same bracket shape.
    const downloadFilePath = path.join(downloadDir, 'Amazing_Video_Title [dQw4w9WgXcQ].mp4');
    fs.writeFileSync(downloadFilePath, 'not a real video');

    await updateDatabase((db) => {
      db.folders = [libraryDir];
      return true;
    });

    await scanDirectories();

    const db = loadDatabase();
    const libraryEntry = Object.values(db.metadata || {}).find((m) => m.filePath === libraryFilePath);
    const downloadEntry = Object.values(db.metadata || {}).find((m) => m.filePath === downloadFilePath);
    assert.ok(libraryEntry, 'sanity: the library file must be indexed');
    assert.ok(downloadEntry, 'sanity: the yt-dlp download-dir file must be indexed');

    assert.equal(libraryEntry.title, 'Vacation_2024 [Holiday2024]', 'FIX-9: a non-yt-dlp library file must keep its raw title unchanged, even though its bracket happens to be 11 id-shaped characters');
    assert.equal(downloadEntry.title, 'Amazing Video Title', 'a genuine yt-dlp download (under the module root) must still have its title cleaned');
  } finally {
    delete process.env.FILETUBE_YTDLP_ENABLED;
    delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
    fs.rmSync(libraryDir, { recursive: true, force: true });
    await updateDatabase((db) => { db.folders = []; return true; });
  }
});

test('extraScanRoots() is path.resolve-normalized and empty when disabled/unconfigured', () => {
  assert.deepEqual(ytdlp.extraScanRoots(ytdlp.parseYtdlpConfig({})), []);
  const cfg = ytdlp.parseYtdlpConfig({
    FILETUBE_YTDLP_ENABLED: 'true',
    FILETUBE_YTDLP_DOWNLOAD_DIR: `${downloadDir}${path.sep}.`,
  });
  assert.deepEqual(ytdlp.extraScanRoots(cfg), [path.resolve(downloadDir)]);
});
