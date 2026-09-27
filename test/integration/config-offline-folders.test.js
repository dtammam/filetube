'use strict';

// [INTEGRATION] v1.339 S2b (plan docs/exec-plans/active/2026-09-26-fouc-toctou-audit.md,
// the offline-folder follow-up to T-C1): POST /api/config used to DROP any
// submitted folder that failed `fs.existsSync`, so saving Settings (or dragging
// a sidebar row) while a drive / NAS share was unmounted un-configured it, and
// the scan the save fires pruned every item under it with its progress.
//
// Now an ALREADY-configured folder that is missing on disk is kept (under its
// stored spelling), and the scan's missing-root guard protects its items; only
// a NEWLY added folder must exist (still dropped, and named in
// `skippedFolders`). The keep is re-verified inside the updateDatabase mutator,
// so a legacy (no baseVersion) POST cannot resurrect a folder removed in the
// same turn.
//
// Every test uses a REAL temp dir with a real file, scanned into the library,
// then renamed away (the unmount) before the save, and drives a real scan after.

const { DATA_DIR } = require('../helpers/isolate-data-dir');
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, __resetDatabaseForTests, folderStore, folderSettingsStore, scanState, scanDirectories, getMediaId } = require('../../server');
const { seedState } = require('../helpers/seed-state');
const { authenticateFetch } = require('../helpers/auth');
const { readPersistedDatabase } = require('../../lib/db/sqlite');

let server;
let base;
before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  authenticateFetch(server, base);
});
after(async () => {
  await waitForScanIdle();
  server.closeAllConnections?.();
  await new Promise((r) => server.close(r));
});
beforeEach(async () => {
  await waitForScanIdle();
  __resetDatabaseForTests();
});

async function waitForScanIdle(maxWaitMs = 15000) {
  const start = Date.now();
  while ((scanState.scanning || scanState.rescanRequested) && Date.now() - start < maxWaitMs) {
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.equal(scanState.scanning, false, 'a background scan must settle before the next step');
}

const post = (body) => fetch(`${base}/api/config`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const getConfig = async () => (await fetch(`${base}/api/config`)).json();
const mk = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const readDb = () => readPersistedDatabase(DATA_DIR);
const rec = (name) => ({ name, hidden: false, hiddenFromSidebar: false });

// Two configured roots, each with one real video, scanned into the library,
// with watch progress on the item under `share` (the one that goes offline).
async function libraryWithShare() {
  const share = mk('ft-offline-share-');
  const local = mk('ft-offline-local-');
  const shareFile = path.join(share, 'Chan', 'episode.mp4');
  const localFile = path.join(local, 'Chan', 'other.mp4');
  for (const f of [shareFile, localFile]) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, 'video-bytes'); }
  const id = getMediaId(shareFile);
  seedState({ folders: [share, local], folderSettings: { [share]: rec('My NAS') }, settings: { pruneMissing: true, scanIntervalMinutes: 30 } });
  await scanDirectories();
  await waitForScanIdle();
  assert.ok(readDb().metadata[id], 'populated: the share item is in the library');
  seedState({ progress: { [id]: { position: 42 } } });
  assert.ok(readDb().progress[id], 'populated: it has watch progress');
  return { share, local, id, offline: share + '.offline' };
}

test('a configured folder that is OFFLINE at save time stays configured, and the following scan keeps its items and progress', async () => {
  const { share, local, id, offline } = await libraryWithShare();
  const cfg = await getConfig(); // the page loads while the share is up
  fs.renameSync(share, offline); // the share goes offline (unmount)
  try {
    assert.strictEqual(fs.existsSync(share), false, 'populated: the configured root is missing on disk');
    // A Save / sidebar drag round-trips the config with a MATCHING base.
    const res = await post({ folders: [local, share], folderSettings: cfg.folderSettings, baseVersion: cfg.configVersion });
    assert.strictEqual(res.status, 200, await res.clone().text());
    const body = await res.json();
    assert.deepStrictEqual(folderStore.list(), [local, share], 'the offline folder is still configured (the reorder landed)');
    assert.deepStrictEqual(folderSettingsStore.getAll()[share], rec('My NAS'), 'its settings row survived');
    assert.deepStrictEqual(body.skippedFolders, [], 'nothing was refused');
    await waitForScanIdle(); // the scan the save fired
    await scanDirectories(); // and one more, explicitly
    await waitForScanIdle();
    const db = readDb();
    assert.ok(db.metadata[id], 'the offline folder item was NOT pruned by the scan');
    assert.strictEqual(db.progress[id] && db.progress[id].position, 42, 'its watch progress survived');
  } finally {
    fs.renameSync(offline, share);
  }
});

test('the offline folder is kept under its STORED spelling even when the client re-spells it', async () => {
  const { share, local, id, offline } = await libraryWithShare();
  const cfg = await getConfig();
  fs.renameSync(share, offline);
  try {
    const respelled = share + path.sep; // same resolved root, different string
    const res = await post({ folders: [respelled, local], folderSettings: { [respelled]: rec('Renamed NAS') }, baseVersion: cfg.configVersion });
    assert.strictEqual(res.status, 200, await res.text());
    assert.deepStrictEqual(folderStore.list(), [share, local], 'stored spelling kept (a re-spelled offline root would detach its items)');
    assert.deepStrictEqual(folderSettingsStore.getAll()[share], rec('Renamed NAS'), 'the settings follow the stored spelling');
    await waitForScanIdle();
    await scanDirectories();
    await waitForScanIdle();
    assert.ok(readDb().metadata[id], 'still protected by the missing-root guard after the scan');
  } finally {
    fs.renameSync(offline, share);
  }
});

test('a NEW folder that does not exist is still not added, and is named in skippedFolders', async () => {
  const { share, local } = await libraryWithShare();
  const cfg = await getConfig();
  const ghost = path.join(os.tmpdir(), `ft-offline-never-${process.pid}-${Date.now()}`);
  assert.strictEqual(fs.existsSync(ghost), false);
  const res = await post({ folders: [share, local, ghost], folderSettings: { [ghost]: rec('Ghost') }, baseVersion: cfg.configVersion });
  assert.strictEqual(res.status, 200, await res.clone().text());
  const body = await res.json();
  assert.deepStrictEqual(folderStore.list(), [share, local], 'the nonexistent NEW path was not added');
  assert.ok(!Object.prototype.hasOwnProperty.call(folderSettingsStore.getAll(), ghost), 'nor its settings row');
  assert.deepStrictEqual(body.skippedFolders, [ghost], 'the response says so');
  await waitForScanIdle();
});

// The route's handler, invoked directly so two calls land in ONE synchronous
// turn (both run to their `await updateDatabase` before either mutator runs).
function configPostHandler() {
  const layer = app._router.stack.find((l) => l.route && l.route.path === '/api/config' && l.route.methods.post);
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}
function fakeRes() {
  let resolve;
  const done = new Promise((r) => { resolve = r; });
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { resolve({ status: this.statusCode, body: b }); return this; } };
  return { res, done };
}

test('the keep is re-verified INSIDE the mutator: a legacy POST cannot resurrect an offline folder removed in the same turn', async () => {
  const { share, local, offline } = await libraryWithShare();
  fs.renameSync(share, offline);
  try {
    const handler = configPostHandler();
    const admin = { username: 'admin', role: 'admin' };
    const r1 = fakeRes(); const r2 = fakeRes();
    // 1: the operator removes the offline share. 2: a stale legacy client
    // (no baseVersion) still lists it. Same turn: 2's pre-loop read still sees
    // the share stored; only the mutator's fresh read knows it is gone.
    handler({ user: admin, body: { folders: [local], folderSettings: {} } }, r1.res);
    handler({ user: admin, body: { folders: [share, local], folderSettings: {} } }, r2.res);
    const [o1, o2] = await Promise.all([r1.done, r2.done]);
    assert.deepStrictEqual([o1.status, o2.status], [200, 200]);
    assert.deepStrictEqual(folderStore.list(), [local], 'the removed offline folder was not resurrected');
    assert.deepStrictEqual(o2.body.folders, [local], 'the response reports what was stored');
    assert.deepStrictEqual(o2.body.skippedFolders, [share], 'and names the folder it did not keep');
    await waitForScanIdle();
  } finally {
    fs.renameSync(offline, share);
  }
});
