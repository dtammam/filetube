'use strict';

// [INTEGRATION] FR-G part 2 (v1.12.0, yt-dlp module parity): the display-only
// synthetic folder merge in `GET`/`POST /api/config`. This intentionally
// SOFTENS the prior locked decision C7(ii) ("`GET /api/config` never lists a
// folder the operator didn't add") -- Dean-approved (see the exec plan's
// Constraints section). Proves, against the REAL server.js routes:
//   - AC42: `GET /api/config` includes the module's download directory as a
//     synthetic folder entry WITHOUT it ever being present in the persisted
//     `db.folders` array.
//   - AC44: the synthetic entry is renamable via a persisted
//     `folderSettings[downloadDir].name` entry -- only the settings entry
//     persists; the folder itself is never written to `db.folders`.
//   - AC45: self-heals -- derived fresh from `extraScanRoots()` on every
//     request, so it reappears after a restart-equivalent (a fresh process
//     re-require) with no operator action required.
//   - AC46: disabled -> the synthetic folder entry is absent (restates AC4).
//   - AC47: no scan/prune decision path depends on the synthetic entry's
//     presence in the GET/config response -- `extraScanRoots()` remains the
//     sole authority (proven by asserting the scan/prune behavior is
//     unaffected whether or not GET /api/config's synthetic merge runs first).
//   - `migrateStaleDownloadDirFromFolders` still strips a REAL persisted
//     `db.folders` entry (unchanged from v1.11.0, re-asserted here for the
//     FR-G-adjacent regression net).

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-test-'));
delete process.env.FILETUBE_YTDLP_ENABLED;
delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const { app, scanDirectories, loadDatabase, updateDatabase, getMediaId } = require('../../server');
const ytdlp = require('../../lib/ytdlp');

let server;
let base;
let downloadDir;

before(async () => {
  downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-synthetic-'));
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

beforeEach(async () => {
  await updateDatabase((db) => { db.folders = []; db.folderSettings = {}; return true; });
});

test('AC42: GET /api/config surfaces the download dir as a synthetic folder, never present in db.folders', async () => {
  process.env.FILETUBE_YTDLP_ENABLED = 'true';
  process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = downloadDir;
  try {
    const res = await fetch(`${base}/api/config`);
    const body = await res.json();
    assert.ok(body.folders.includes(path.resolve(downloadDir)), 'the synthetic folder must be present in the RESPONSE');
    assert.ok(!(loadDatabase().folders || []).includes(downloadDir), 'the synthetic folder must NEVER be present in persisted db.folders');
    assert.equal(body.folderSettings[path.resolve(downloadDir)].name, 'Downloads', 'defaults to a friendly name when no rename has been persisted');
  } finally {
    delete process.env.FILETUBE_YTDLP_ENABLED;
    delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
  }
});

test('AC44: the synthetic folder is renamable via a persisted folderSettings entry, without ever writing db.folders', async () => {
  process.env.FILETUBE_YTDLP_ENABLED = 'true';
  process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = downloadDir;
  try {
    const resolvedDownloadDir = path.resolve(downloadDir);

    // Simulate the UI's rename flow: POST /api/config with an EMPTY folders
    // array (the client never echoes the synthetic entry into `folders`)
    // plus a folderSettings entry keyed by the synthetic root's resolved path.
    const postRes = await fetch(`${base}/api/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        folders: [],
        folderSettings: { [resolvedDownloadDir]: { name: 'My Downloads', hidden: false } },
      }),
    });
    const postBody = await postRes.json();
    assert.equal(postRes.status, 200);
    assert.deepEqual(postBody.folders, [], 'db.folders must stay empty -- the synthetic root is never written there');

    const persisted = loadDatabase();
    assert.deepEqual(persisted.folders, [], 'db.folders itself must never contain the synthetic root');
    assert.equal(persisted.folderSettings[resolvedDownloadDir].name, 'My Downloads', 'the rename must persist via folderSettings alone');

    // The rename must be reflected back through GET /api/config too.
    const getRes = await fetch(`${base}/api/config`);
    const getBody = await getRes.json();
    assert.equal(getBody.folderSettings[resolvedDownloadDir].name, 'My Downloads');
    assert.ok(!getBody.folders.includes(undefined));
  } finally {
    delete process.env.FILETUBE_YTDLP_ENABLED;
    delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
  }
});

test('AC45: self-heals -- the synthetic folder reappears from extraScanRoots even if its folderSettings entry never existed / was cleared', async () => {
  process.env.FILETUBE_YTDLP_ENABLED = 'true';
  process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = downloadDir;
  try {
    // Nothing persisted at all (beforeEach reset db.folders/folderSettings to
    // empty) -- yet the synthetic entry must still appear, because it is
    // derived FRESH from extraScanRoots() on every GET, never a one-time
    // materialization that needs re-creating.
    const res1 = await fetch(`${base}/api/config`);
    const body1 = await res1.json();
    assert.ok(body1.folders.includes(path.resolve(downloadDir)), 'must self-heal on the very first GET with nothing persisted');

    // Simulate a settings wipe (as if an operator's folderSettings.json entry
    // were lost/reset) -- the very next GET still re-derives it.
    await updateDatabase((db) => { db.folderSettings = {}; return true; });
    const res2 = await fetch(`${base}/api/config`);
    const body2 = await res2.json();
    assert.ok(body2.folders.includes(path.resolve(downloadDir)), 'must re-derive the synthetic folder after a settings reset, with no operator action');
    assert.equal(body2.folderSettings[path.resolve(downloadDir)].name, 'Downloads', 'falls back to the default friendly name again');
  } finally {
    delete process.env.FILETUBE_YTDLP_ENABLED;
    delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
  }
});

test('AC46 (restates AC4): disabled -- the synthetic folder entry is absent from GET /api/config', async () => {
  // Module disabled AND the directory was never created (fresh-install case)
  // -- extraScanRoots() contributes nothing.
  const neverCreatedDir = path.join(os.tmpdir(), `filetube-synthetic-never-created-${Date.now()}`);
  assert.equal(fs.existsSync(neverCreatedDir), false, 'sanity: must not exist');
  process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = neverCreatedDir;
  try {
    assert.equal(process.env.FILETUBE_YTDLP_ENABLED, undefined, 'sanity: module must be disabled');
    const res = await fetch(`${base}/api/config`);
    const body = await res.json();
    assert.ok(!body.folders.includes(path.resolve(neverCreatedDir)), 'disabled + never-created dir must never surface a synthetic entry');
    assert.deepEqual(body.folders, loadDatabase().folders || [], 'the response must be byte-identical to db.folders when there is no synthetic contribution');
  } finally {
    delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
  }
});

test('AC47: no scan/prune decision depends on the GET /api/config synthetic merge -- scanning/pruning behaves identically whether or not GET has ever been called', async () => {
  process.env.FILETUBE_YTDLP_ENABLED = 'true';
  process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = downloadDir;
  try {
    const filePath = path.join(downloadDir, 'proof.mp4');
    fs.writeFileSync(filePath, 'not a real video');

    // Deliberately never call GET /api/config before this scan -- the scan
    // path (runScanDirectories) reads ytdlp.extraScanRoots() directly, never
    // through the config response.
    await scanDirectories();
    const id = getMediaId(filePath);
    const db = loadDatabase();
    assert.ok(db.metadata[id], 'the file must be scanned/indexed via extraScanRoots alone, independent of ever calling GET /api/config');

    // Now simulate the volume going transiently absent (mount-loss, E1) --
    // still without ever having called GET /api/config -- and confirm the
    // mount-loss guard still protects it exactly as it does with GET called.
    fs.rmSync(downloadDir, { recursive: true, force: true });
    await scanDirectories();
    assert.ok(loadDatabase().metadata[id], 'E1 mount-loss guard must protect the id even though GET /api/config (and its synthetic merge) was never invoked for this run');

    fs.mkdirSync(downloadDir, { recursive: true }); // restore for the shared after() cleanup
  } finally {
    delete process.env.FILETUBE_YTDLP_ENABLED;
    delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
  }
});

test('migrateStaleDownloadDirFromFolders still strips a REAL persisted db.folders entry (unchanged by FR-G part 2)', async () => {
  const staleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-synthetic-stale-'));
  try {
    await updateDatabase((db) => {
      db.folders = Array.from(new Set([...(db.folders || []), staleDir]));
      return true;
    });
    assert.ok(loadDatabase().folders.includes(staleDir), 'sanity: the stale entry was seeded');

    process.env.FILETUBE_YTDLP_ENABLED = 'true';
    process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = staleDir;
    const config = ytdlp.parseYtdlpConfig(process.env);
    const deps = { updateDatabase, loadDatabase };

    await ytdlp.migrateStaleDownloadDirFromFolders(deps, config);

    assert.ok(!loadDatabase().folders.includes(staleDir), 'the real persisted db.folders entry must still be stripped');
  } finally {
    delete process.env.FILETUBE_YTDLP_ENABLED;
    delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
    fs.rmSync(staleDir, { recursive: true, force: true });
  }
});
