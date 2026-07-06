'use strict';

// [INTEGRATION/UNIT] FR-G part 1 (v1.12.0, yt-dlp module parity): the
// realpath-normalize hardening at the `currentFolders` merge
// (server.js's `runScanDirectories`, the anchor right before its `Set`
// dedup) and the `path.resolve`-on-write at `POST /api/config`. Proves,
// against the REAL server.js scan + config routes (not a re-implementation):
//   - AC38: two divergent spellings of the SAME real directory tree
//     (a symlink alias of the yt-dlp download dir, registered as a manual
//     `db.folders` entry, aliasing the same tree `extraScanRoots()` already
//     contributes) collapse to ONE scanned root -> ONE set of media ids, not
//     duplicated library rows -- this is the confirmed server.js:955-class
//     duplicate-entry bug this hardening fixes.
//   - AC39 (regression): two genuinely DISTINCT real folders are never
//     collapsed by the same hardening.
//   - AC40: `db.folders` entries are `path.resolve`d at `POST /api/config`
//     write time, so a relative/divergent-but-equivalent re-spelling of an
//     already-configured folder submitted in the same save does not create
//     a second `db.folders` entry.
//   - AC41: the full end-to-end -- a bind-mount/symlink re-add of a tree
//     already covered by `extraScanRoots` under a different spelling yields
//     ONE scanned entry, not a duplicated library row.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-test-'));
delete process.env.FILETUBE_YTDLP_ENABLED;
delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, scanDirectories, loadDatabase, updateDatabase } = require('../../server');

let server;
let base;

before(async () => {
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
  } finally {
    delete process.env.FILETUBE_YTDLP_ENABLED;
    delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
    fs.rmSync(aliasDir, { force: true });
    fs.rmSync(realDownloadDir, { recursive: true, force: true });
    await updateDatabase((db) => { db.folders = []; return true; });
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

test('AC40: POST /api/config resolves folder entries at write time -- a relative-spelling re-add of an already-configured folder submitted in the same save does not create a second db.folders entry', async () => {
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
    assert.equal(body.folders[0], path.resolve(dir));

    const persisted = loadDatabase().folders;
    assert.equal(persisted.length, 1, 'db.folders itself must also hold exactly one (resolved) entry');
    assert.equal(persisted[0], path.resolve(dir));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    await updateDatabase((db) => { db.folders = []; return true; });
  }
});

test('AC40: a folderSettings rename submitted under the pre-resolve spelling still persists against the resolved key', async () => {
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
    const resolved = path.resolve(dir);
    assert.ok(body.folderSettings[resolved], 'the settings entry must be keyed by the RESOLVED path, even though submitted under a pre-resolve spelling');
    assert.equal(body.folderSettings[resolved].name, 'My Custom Name');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    await updateDatabase((db) => { db.folders = []; db.folderSettings = {}; return true; });
  }
});
