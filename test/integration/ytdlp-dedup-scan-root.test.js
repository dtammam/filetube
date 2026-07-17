'use strict';

// [INTEGRATION/UNIT] FR-G part 1 (v1.12.0, yt-dlp module parity): the
// `normalizeScanRoot`-keyed DEDUP hardening at the `currentFolders` merge
// (server.js's `runScanDirectories`, the anchor right before the dedup loop)
// and the resolved-key dedup (WITHOUT rewriting the persisted spelling) at
// `POST /api/config`. Proves, against the REAL server.js scan + config
// routes (not a re-implementation):
//   - AC38: two divergent spellings of the SAME real directory tree
//     (a symlink alias of the yt-dlp download dir, registered as a manual
//     `db.folders` entry, aliasing the same tree `extraScanRoots()` already
//     contributes) collapse to ONE scanned root -> ONE set of media ids, not
//     duplicated library rows -- this is the confirmed server.js:955-class
//     duplicate-entry bug this hardening fixes.
//   - AC39 (regression): two genuinely DISTINCT real folders are never
//     collapsed by the same hardening.
//   - AC40: a relative/divergent-but-equivalent re-spelling of an
//     already-configured folder submitted in the same `POST /api/config`
//     save does not create a second `db.folders` entry -- deduped via a
//     resolved KEY only; the persisted string is the first-seen ORIGINAL
//     spelling, never a `path.resolve`-rewritten one (FIX-1, two-reviewer
//     gate, BLOCKER: rewriting a stored spelling churns every file's
//     `getMediaId`-derived id under that root on the next scan, and
//     `pruneMissing` -- default ON -- reaps the old ids' metadata/
//     thumbnails/`db.progress`).
//   - AC41: the full end-to-end -- a bind-mount/symlink re-add of a tree
//     already covered by `extraScanRoots` under a different spelling yields
//     ONE scanned entry, not a duplicated library row.
//   - FIX-1 regression tests (two-reviewer gate, BLOCKER): a symlinked
//     `db.folders` root's PRE-EXISTING ids/thumbnails/`db.progress` survive a
//     `pruneMissing` scan unchanged (no realpath-driven re-id/reap), the
//     dedup-collapsed entry above is id'd under the KEPT ORIGINAL spelling
//     (never a realpath rewrite), and a `POST /api/config` re-save of
//     existing folders leaves the stored strings byte-identical.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-test-'));
delete process.env.FILETUBE_YTDLP_ENABLED;
delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, scanDirectories, loadDatabase, updateDatabase, getMediaId, transcodedPath } = require('../../server');
const { authenticateFetch } = require('../helpers/auth');

const DATA_DIR = process.env.DATA_DIR;
const THUMBNAIL_DIR = path.join(DATA_DIR, '.thumbnails');

let server;
let base;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
  authenticateFetch(server, base); // v1.43: auth through the real gate
});

after(async () => {
  delete process.env.FILETUBE_YTDLP_ENABLED;
  delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

test('AC38/AC41: extraScanRoots (yt-dlp download dir) + a symlink-aliased manual db.folders entry pointing at the SAME real tree collapse to ONE scanned entry', async () => {
  const realDownloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-dedup-real-'));
  const aliasDir = path.join(os.tmpdir(), `filetube-dedup-alias-${Date.now()}`);
  fs.symlinkSync(realDownloadDir, aliasDir, 'dir');
  try {
    const filePath = path.join(realDownloadDir, 'episode.mp4');
    fs.writeFileSync(filePath, 'not a real video');

    process.env.FILETUBE_YTDLP_ENABLED = 'true';
    process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = realDownloadDir;

    // Simulate an operator ALSO manually adding a divergently-spelled alias
    // of the same real tree to db.folders (the exact confirmed root cause:
    // the module contributes path.resolve(downloadDir) via extraScanRoots,
    // while db.folders held a byte-different (here: symlinked) spelling).
    await updateDatabase((db) => {
      db.folders = [aliasDir];
      return true;
    });

    await scanDirectories();

    const db = loadDatabase();
    const idsForFile = Object.values(db.metadata || {}).filter((m) =>
      fs.realpathSync(m.filePath) === fs.realpathSync(filePath)
    );
    assert.equal(idsForFile.length, 1, `expected exactly ONE library entry for the same real file, got ${idsForFile.length}`);

    // FIX-1 regression (two-reviewer gate, BLOCKER) (b): `db.folders` is
    // iterated BEFORE `extraScanRoots` in the merge, so its alias spelling is
    // the first-seen ORIGINAL and is what gets kept/walked -- the surviving
    // id must be computed from THAT spelling (the alias), never from
    // `extraScanRoots`' realpath spelling. This is the same guarantee that
    // prevents an existing id from churning across an upgrade: the KEPT
    // spelling is never rewritten by the dedup step.
    const aliasFilePath = path.join(aliasDir, 'episode.mp4');
    const keptId = getMediaId(aliasFilePath);
    const realpathId = getMediaId(filePath);
    assert.ok(db.metadata[keptId], 'the surviving id must be computed from the KEPT ORIGINAL (db.folders alias) spelling, not a realpath rewrite');
    assert.equal(db.metadata[keptId].filePath, aliasFilePath);
    assert.equal(keptId, idsForFile[0].id, 'sanity: the one surviving entry IS the alias-spelling id');
    assert.ok(!db.metadata[realpathId], 'must not ALSO create a second entry under extraScanRoots\' realpath spelling');
  } finally {
    delete process.env.FILETUBE_YTDLP_ENABLED;
    delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
    fs.rmSync(aliasDir, { force: true });
    fs.rmSync(realDownloadDir, { recursive: true, force: true });
    await updateDatabase((db) => { db.folders = []; return true; });
  }
});

// ---- FIX-1 regression (two-reviewer gate, BLOCKER, data-loss): a symlinked -
// db.folders root's PRE-EXISTING ids/thumbnails/db.progress must survive a ---
// pruneMissing scan UNCHANGED -- the realpath-rewrite bug this closes would --
// have silently re-id'd (and therefore reaped) every file under such a root. -

test('FIX-1 regression (BLOCKER) (a): a symlinked db.folders root -- pre-existing ids computed from the symlink spelling survive a pruneMissing scan unchanged (no realpath re-id, no reap)', async () => {
  const realDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-fix1-real-'));
  const aliasDir = path.join(os.tmpdir(), `filetube-fix1-alias-${Date.now()}`);
  fs.symlinkSync(realDir, aliasDir, 'dir');
  try {
    fs.writeFileSync(path.join(realDir, 'episode.mp4'), 'not a real video');
    const filePath = path.join(aliasDir, 'episode.mp4'); // the path AS WALKED, under the symlink spelling

    await updateDatabase((db) => {
      db.folders = [aliasDir];
      return true;
    });

    // First scan: establishes the id under the SYMLINK spelling -- exactly
    // the pre-existing-install scenario this regression protects.
    await scanDirectories();
    const id = getMediaId(filePath);
    let db = loadDatabase();
    assert.ok(db.metadata[id], 'sanity: the file must be indexed under the symlink spelling on the first scan');
    assert.equal(db.metadata[id].filePath, filePath, 'sanity: the walked/stored filePath is the SYMLINK spelling, never its realpath');

    // Seed the exact footprint a real download/watch history leaves behind --
    // the sinks server.js's prune path touches.
    fs.mkdirSync(THUMBNAIL_DIR, { recursive: true });
    fs.writeFileSync(path.join(THUMBNAIL_DIR, `${id}.jpg`), 'thumb');
    const sidecarPath = transcodedPath(id);
    fs.mkdirSync(path.dirname(sidecarPath), { recursive: true });
    fs.writeFileSync(sidecarPath, 'transcoded');
    await updateDatabase((fresh) => {
      fresh.metadata[id].hasThumbnail = true;
      fresh.progress[id] = { position: 42, duration: 100 };
      return true;
    });
    assert.ok(loadDatabase().progress[id], 'sanity: the watch-progress entry was seeded');
    assert.equal(loadDatabase().settings.pruneMissing, true, 'sanity: pruneMissing must be ON for this regression to be meaningful');

    // Second scan (pruneMissing ON): the pre-fix bug realpath'd db.folders
    // entries BEFORE walking, which would have rewritten this alias to
    // realDir, recomputed the id under THAT path, and let the OLD
    // (symlink-spelling) id stop surviving -- reaped by pruneMissing.
    await scanDirectories();

    db = loadDatabase();
    assert.ok(db.metadata[id], 'FIX-1: the id computed from the ORIGINAL (symlink) spelling must survive -- never re-id churned by a realpath rewrite');
    assert.ok(db.progress[id], 'FIX-1: the watch-progress entry for that id must survive (not reaped)');
    assert.ok(fs.existsSync(path.join(THUMBNAIL_DIR, `${id}.jpg`)), 'FIX-1: the thumbnail must survive (not reaped)');
    assert.ok(fs.existsSync(sidecarPath), 'FIX-1: the transcode sidecar must survive (not reaped)');
  } finally {
    fs.rmSync(aliasDir, { force: true });
    fs.rmSync(realDir, { recursive: true, force: true });
    await updateDatabase((db) => { db.folders = []; db.progress = {}; return true; });
  }
});

test('AC39 REGRESSION: two genuinely distinct real folders registered via db.folders are scanned as two separate roots, never collapsed', async () => {
  const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-distinct-a-'));
  const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-distinct-b-'));
  try {
    fs.writeFileSync(path.join(dirA, 'a.mp4'), 'not a real video');
    fs.writeFileSync(path.join(dirB, 'b.mp4'), 'not a real video');

    await updateDatabase((db) => {
      db.folders = [dirA, dirB];
      return true;
    });

    await scanDirectories();

    const db = loadDatabase();
    const paths = Object.values(db.metadata || {}).map((m) => m.filePath).sort();
    assert.deepEqual(paths, [path.join(dirA, 'a.mp4'), path.join(dirB, 'b.mp4')].sort(), 'both distinct folders must be scanned independently, not merged');
  } finally {
    fs.rmSync(dirA, { recursive: true, force: true });
    fs.rmSync(dirB, { recursive: true, force: true });
    await updateDatabase((db) => { db.folders = []; return true; });
  }
});

test('AC40: POST /api/config dedupes a relative-spelling re-add of an already-configured folder using a RESOLVED KEY, without rewriting the persisted spelling (FIX-1)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-resolve-write-'));
  try {
    // `path.join` would normalize away a trailing `/.` itself, so build the
    // divergent (but resolve-equivalent) spelling as a raw string the way an
    // actual client payload would arrive over the wire -- byte-different from
    // `dir`, but `path.resolve` collapses it back to the same canonical path.
    const divergentSpelling = `${dir}${path.sep}.`;
    assert.notEqual(divergentSpelling, dir, 'sanity: the two spellings must be byte-different strings');
    assert.equal(path.resolve(divergentSpelling), path.resolve(dir), 'sanity: the two spellings must resolve to the same path');

    const res = await fetch(`${base}/api/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folders: [dir, divergentSpelling], folderSettings: {} }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.folders.length, 1, 'two spellings of the same folder submitted together must collapse to one persisted entry');
    // FIX-1 (two-reviewer gate, BLOCKER): the KEPT entry is the first-seen
    // ORIGINAL string as submitted -- `path.resolve` is used only as the
    // dedup comparison KEY, never persisted in place of the original. `dir`
    // here already equals its own resolved form (a plain mkdtempSync path
    // with no relative segments), so this also happens to equal
    // `path.resolve(dir)` -- the dedicated byte-identical regression test
    // below uses a spelling that does NOT coincidentally resolve to itself.
    assert.equal(body.folders[0], dir, 'the persisted entry must be the first-seen ORIGINAL spelling, not a path.resolve rewrite');

    const persisted = loadDatabase().folders;
    assert.equal(persisted.length, 1, 'db.folders itself must also hold exactly one entry');
    assert.equal(persisted[0], dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    await updateDatabase((db) => { db.folders = []; return true; });
  }
});

test('FIX-1 regression (BLOCKER) (c): POST /api/config re-saving an existing (non-canonical) folder spelling leaves it byte-identical -- never rewritten to its resolved form', async () => {
  const realDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-fix1-config-real-'));
  const aliasDir = path.join(os.tmpdir(), `filetube-fix1-config-alias-${Date.now()}`);
  fs.symlinkSync(realDir, aliasDir, 'dir');
  try {
    assert.notEqual(fs.realpathSync(aliasDir), aliasDir, 'sanity: the alias must NOT already equal its own realpath -- otherwise this test proves nothing');

    // A save that submits ONLY the symlink alias -- exactly what re-saving an
    // existing, unchanged configuration looks like from the client's
    // perspective (it just echoes back what GET /api/config last returned).
    const res = await fetch(`${base}/api/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folders: [aliasDir], folderSettings: {} }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.folders.length, 1);
    assert.equal(body.folders[0], aliasDir, 'FIX-1: a save must never rewrite an existing stored spelling to its resolved/realpath form');

    const persisted = loadDatabase().folders;
    assert.equal(persisted.length, 1);
    assert.equal(persisted[0], aliasDir, 'FIX-1: db.folders itself must hold the byte-identical, un-rewritten spelling after a re-save');
  } finally {
    fs.rmSync(aliasDir, { force: true });
    fs.rmSync(realDir, { recursive: true, force: true });
    await updateDatabase((db) => { db.folders = []; return true; });
  }
});

test('AC40/QW2: a folderSettings rename submitted under a non-canonical spelling persists keyed by the SAME original spelling db.folders uses (not the resolved key)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-resolve-settings-'));
  try {
    const divergentSpelling = `${dir}${path.sep}.`;
    const res = await fetch(`${base}/api/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        folders: [divergentSpelling],
        folderSettings: { [divergentSpelling]: { name: 'My Custom Name', hidden: false } },
      }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    // QW2 (fast-follow, correctness fix): FIX-1 already reverted `db.folders`
    // to store the ORIGINAL submitted spelling -- so `folderSettings` must be
    // keyed by that SAME original spelling, not by `path.resolve`'s
    // comparison key, or the client's `item.rootFolder`-keyed lookups
    // (resolveChannelName, the sidebar, the GET /api/videos hidden-folder
    // filter) can never find it.
    assert.equal(body.folders[0], divergentSpelling, 'sanity: db.folders keeps the original, non-canonical spelling (FIX-1)');
    const resolved = path.resolve(dir);
    assert.equal(body.folderSettings[resolved], undefined, 'QW2: the settings entry must NOT be keyed by the resolved path');
    assert.ok(body.folderSettings[divergentSpelling], 'QW2: the settings entry must be keyed by the SAME original spelling db.folders uses');
    assert.equal(body.folderSettings[divergentSpelling].name, 'My Custom Name');

    const persisted = loadDatabase();
    assert.equal(persisted.folders[0], divergentSpelling);
    assert.equal(persisted.folderSettings[resolved], undefined, 'QW2: db.folderSettings on disk must not be keyed by the resolved path either');
    assert.ok(persisted.folderSettings[divergentSpelling], 'QW2: db.folderSettings on disk must be keyed by the original spelling');
    assert.equal(persisted.folderSettings[divergentSpelling].name, 'My Custom Name');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    await updateDatabase((db) => { db.folders = []; db.folderSettings = {}; return true; });
  }
});

test('QW2: a rename on a non-canonical folder spelling round-trips AND is reachable by the item.rootFolder lookup the client actually uses', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-resolve-settings-reach-'));
  try {
    const divergentSpelling = `${dir}${path.sep}.`;

    const res = await fetch(`${base}/api/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        folders: [divergentSpelling],
        folderSettings: { [divergentSpelling]: { name: 'Renamed Folder', hidden: false } },
      }),
    });
    assert.equal(res.status, 200);

    // A GET /api/config round-trip (what the settings page actually does on
    // load) must surface the rename under the exact same key `db.folders`
    // holds -- this is the key the client's `resolveChannelName` looks up via
    // `item.rootFolder` (server.js: an indexed file's `rootFolder` is set to
    // the raw, as-scanned `db.folders` entry, i.e. `divergentSpelling` here,
    // never its resolved form).
    const getRes = await fetch(`${base}/api/config`);
    const getBody = await getRes.json();
    assert.ok(getBody.folders.includes(divergentSpelling), 'sanity: db.folders still holds the original spelling');
    assert.ok(getBody.folderSettings[divergentSpelling], 'QW2: the rename must be reachable keyed by the exact db.folders spelling (item.rootFolder)');
    assert.equal(getBody.folderSettings[divergentSpelling].name, 'Renamed Folder');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    await updateDatabase((db) => { db.folders = []; db.folderSettings = {}; return true; });
  }
});
