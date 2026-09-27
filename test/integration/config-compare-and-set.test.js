'use strict';

// [INTEGRATION] v1.339 S2 (plan docs/exec-plans/active/2026-09-26-fouc-toctou-audit.md,
// finding T-C1, decision D2): POST /api/config is compare-and-set.
//
// Before: the home sidebar drag, the Settings sidebar drag and the Settings
// Save POSTed a full `{folders, folderSettings}` the page had loaded earlier;
// the route replaced both tables wholesale and fired a scan, so a folder
// another device added in between was dropped (and its items pruned). Now GET
// hands out `configVersion` (a hash of the STORED rows) and a POST carrying a
// `baseVersion` that no longer matches gets 409 with the current version and
// writes NOTHING - no replaceAll, no scan. A POST without `baseVersion` is the
// legacy contract and still saves (the disclosed residual) - except one that
// would leave none of the stored folders configured, refused since v1.339 r1
// (test/integration/config-save-guards.test.js).
//
// Through the REAL routes and the real updateDatabase mutator seam:
//   - a stale base -> 409 { error, configVersion }, both tables byte-identical,
//     and no scan started (scanState.scanning is spied, never set);
//   - a matching base saves, starts the scan, and returns the NEW version, which
//     equals what the next GET reports;
//   - an absent base still saves (legacy) when a stored folder survives;
//   - the compare is INSIDE the mutator: two POSTs carrying the same base,
//     enqueued in the SAME synchronous turn (the handler invoked directly, so
//     neither mutator can run before both handlers have), -> exactly one 200
//     and one 409;
//   - the version hashes STORAGE, not the GET projection: with the yt-dlp
//     synthetic root spliced into GET's folders and its default 'Downloads'
//     name injected, the version still equals the hash of the stored rows.

const { DATA_DIR } = require('../helpers/isolate-data-dir');
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, __resetDatabaseForTests, folderStore, folderSettingsStore, scanState } = require('../../server');
const { seedState } = require('../helpers/seed-state');
const { authenticateFetch } = require('../helpers/auth');
const { readPersistedDatabase } = require('../../lib/db/sqlite');
const { computeConfigVersion } = require('../../lib/config/configVersion');

let server;
let base;
before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  authenticateFetch(server, base);
});
after(async () => {
  await waitForScanIdle();
  delete process.env.FILETUBE_YTDLP_ENABLED;
  delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
  server.closeAllConnections?.();
  await new Promise((r) => server.close(r));
});
beforeEach(async () => {
  await waitForScanIdle();
  __resetDatabaseForTests();
});

async function waitForScanIdle(maxWaitMs = 10000) {
  const start = Date.now();
  while ((scanState.scanning || scanState.rescanRequested) && Date.now() - start < maxWaitMs) {
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.equal(scanState.scanning, false, 'a background scan must settle before the next step');
}

// Records every write of `true` to scanState.scanning / rescanRequested - the
// FIRST synchronous thing scanDirectories() does - so "a scan was started" is
// observed at the call, never inferred from timing.
function spyScanStarts() {
  const starts = [];
  const real = { scanning: scanState.scanning, rescanRequested: scanState.rescanRequested };
  for (const key of ['scanning', 'rescanRequested']) {
    Object.defineProperty(scanState, key, {
      configurable: true, enumerable: true,
      get() { return real[key]; },
      set(v) { if (v === true) starts.push(key); real[key] = v; },
    });
  }
  const restore = () => {
    for (const key of ['scanning', 'rescanRequested']) {
      Object.defineProperty(scanState, key, { configurable: true, enumerable: true, writable: true, value: real[key] });
    }
  };
  return { starts, restore };
}

const post = (body) => fetch(`${base}/api/config`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const getConfig = async () => (await fetch(`${base}/api/config`)).json();
const mk = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const rec = (name, extra) => ({ name, hidden: false, hiddenFromSidebar: false, ...(extra || {}) });

// Everything the two folder tables hold, as bytes: the store reads AND the
// persisted snapshot a fresh process would load.
function tableBytes() {
  const p = readPersistedDatabase(DATA_DIR);
  return JSON.stringify({ list: folderStore.list(), map: folderSettingsStore.getAll(), pFolders: p.folders, pSettings: p.folderSettings });
}

test('a STALE baseVersion gets 409 with the current version; both folder tables stay byte-identical and no scan starts', async () => {
  const A = mk('ft-cas-a-'); const B = mk('ft-cas-b-'); const C = mk('ft-cas-c-');
  seedState({ folders: [A, B], folderSettings: { [A]: rec('AA') }, metadata: {} });
  const loaded = await getConfig(); // device A loads the config
  assert.match(loaded.configVersion, /^[0-9a-f]{40}$/);
  // Device B adds folder C (and renames B) - the stored config moves on.
  const bSave = await post({ folders: [A, B, C], folderSettings: { [A]: rec('AA'), [B]: rec('BB') }, baseVersion: loaded.configVersion });
  assert.strictEqual(bSave.status, 200, await bSave.text());
  await waitForScanIdle();
  const before = tableBytes();
  assert.ok(before.includes(C), 'populated: C is configured before the stale write');
  const current = computeConfigVersion(folderStore.list(), folderSettingsStore.getAll());
  assert.notStrictEqual(current, loaded.configVersion, 'the version moved with the stored config');

  // Device A drags with its STALE list (no C) and its stale base.
  const spy = spyScanStarts();
  let res;
  try {
    res = await post({ folders: [B, A], folderSettings: { [A]: rec('AA') }, baseVersion: loaded.configVersion });
  } finally { spy.restore(); }
  assert.strictEqual(res.status, 409);
  const body = await res.json();
  assert.strictEqual(typeof body.error, 'string');
  assert.strictEqual(body.configVersion, current, 'the 409 carries the CURRENT stored version');
  assert.strictEqual(tableBytes(), before, 'NOTHING written: both tables byte-identical, C still configured');
  assert.deepStrictEqual(spy.starts, [], 'no scan started by a refused write');
});

test('a MATCHING baseVersion saves, starts the scan, and returns the new version the next GET reports', async () => {
  const A = mk('ft-cas-d-'); const B = mk('ft-cas-e-');
  seedState({ folders: [A, B], folderSettings: {}, metadata: {} });
  const loaded = await getConfig();
  const spy = spyScanStarts();
  let res;
  try {
    res = await post({ folders: [B, A], folderSettings: { [A]: rec('AA') }, baseVersion: loaded.configVersion });
  } finally { spy.restore(); }
  assert.strictEqual(res.status, 200, await res.clone().text());
  const body = await res.json();
  assert.strictEqual(body.success, true);
  assert.deepStrictEqual(folderStore.list(), [B, A], 'the reorder landed');
  assert.deepStrictEqual(folderSettingsStore.getAll(), { [A]: rec('AA') });
  assert.ok(spy.starts.length >= 1, 'the save started a scan (the positive control for the 409 test)');
  const after = await getConfig();
  assert.strictEqual(body.configVersion, after.configVersion, 'the POST returns the version GET now reports');
  assert.notStrictEqual(body.configVersion, loaded.configVersion);
  await waitForScanIdle();
});

test('an ABSENT baseVersion still saves (the legacy contract, disclosed residual); a non-string base is a 400 that writes nothing', async () => {
  const A = mk('ft-cas-f-'); const B = mk('ft-cas-g-');
  seedState({ folders: [A], folderSettings: {}, metadata: {} });
  const res = await post({ folders: [A, B], folderSettings: {} });
  assert.strictEqual(res.status, 200, await res.text());
  assert.deepStrictEqual(folderStore.list(), [A, B]);
  await waitForScanIdle();
  const before = tableBytes();
  const bad = await post({ folders: [B], folderSettings: {}, baseVersion: 42 });
  assert.strictEqual(bad.status, 400);
  assert.strictEqual(tableBytes(), before, 'a malformed base is never a silent legacy write');
});

// The route's handler, invoked directly so two calls land in ONE synchronous
// turn: each runs synchronously up to its `await updateDatabase(...)`, so both
// mutators are queued before either runs. A compare hoisted OUT of the mutator
// (before the await) passes for both and both write; the compare inside the
// mutator lets exactly one through.
function configPostHandler() {
  const layer = app._router.stack.find((l) => l.route && l.route.path === '/api/config' && l.route.methods.post);
  assert.ok(layer, 'POST /api/config is registered');
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}
function fakeRes() {
  let resolve;
  const done = new Promise((r) => { resolve = r; });
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { resolve({ status: this.statusCode, body }); return this; },
  };
  return { res, done };
}

test('the compare runs INSIDE the mutator: two POSTs with the same base in the same synchronous turn -> exactly one wins, the other 409s', async () => {
  const A = mk('ft-cas-h-'); const B = mk('ft-cas-i-'); const C = mk('ft-cas-j-');
  seedState({ folders: [A, B], folderSettings: {}, metadata: {} });
  const baseVersion = (await getConfig()).configVersion;
  const handler = configPostHandler();
  const admin = { username: 'admin', role: 'admin' };
  const r1 = fakeRes(); const r2 = fakeRes();
  // Same turn, no await between them.
  handler({ user: admin, body: { folders: [A, B, C], folderSettings: {}, baseVersion } }, r1.res);
  handler({ user: admin, body: { folders: [B, A], folderSettings: {}, baseVersion } }, r2.res);
  const [o1, o2] = await Promise.all([r1.done, r2.done]);
  assert.deepStrictEqual([o1.status, o2.status], [200, 409], 'the first queued write wins; the second sees the moved version');
  assert.deepStrictEqual(folderStore.list(), [A, B, C], 'the loser wrote nothing over the winner (C survives)');
  assert.strictEqual(o2.body.configVersion, o1.body.configVersion, "the 409 carries the winner's version");
  await waitForScanIdle();
});

test('the version hashes STORAGE, never the GET projection: the synthetic root splice and its injected name do not enter it', async () => {
  const A = mk('ft-cas-k-');
  const downloadDir = mk('ft-cas-dl-');
  process.env.FILETUBE_YTDLP_ENABLED = 'true';
  process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = downloadDir;
  try {
    seedState({ folders: [A], folderSettings: {}, metadata: {} });
    const cfg = await getConfig();
    const synth = path.resolve(downloadDir);
    assert.ok(cfg.folders.includes(synth), 'populated: GET spliced the synthetic root in');
    assert.strictEqual(cfg.folderSettings[synth].name, 'Downloads', 'populated: GET injected the default name');
    assert.strictEqual(cfg.configVersion, computeConfigVersion([A], {}), 'the version is the hash of the STORED rows');
    assert.notStrictEqual(cfg.configVersion, computeConfigVersion(cfg.folders, cfg.folderSettings), 'and NOT of the projection');
    // Round-trip: a client that POSTs the projection back with that version is accepted.
    const res = await post({ folders: cfg.folders, folderSettings: cfg.folderSettings, baseVersion: cfg.configVersion });
    assert.strictEqual(res.status, 200, await res.text());
    assert.deepStrictEqual(folderStore.list(), [A], 'the synthetic root is still never stored');
    await waitForScanIdle();
  } finally {
    delete process.env.FILETUBE_YTDLP_ENABLED;
    delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
  }
});

test('computeConfigVersion: folder ORDER is data, settings KEY order is not, and a __proto__ key stays inert', () => {
  const v = computeConfigVersion(['/a', '/b'], { '/a': { name: 'x', hidden: false } });
  assert.notStrictEqual(v, computeConfigVersion(['/b', '/a'], { '/a': { name: 'x', hidden: false } }), 'a reorder moves the version');
  assert.strictEqual(v, computeConfigVersion(['/a', '/b'], { '/a': { hidden: false, name: 'x' } }), 'key order never does');
  assert.notStrictEqual(v, computeConfigVersion(['/a', '/b'], { '/a': { name: 'y', hidden: false } }), 'a rename moves it');
  const proto = {};
  Object.defineProperty(proto, '__proto__', { value: { name: 'p' }, enumerable: true, writable: true, configurable: true });
  assert.notStrictEqual(computeConfigVersion([], proto), computeConfigVersion([], {}), 'a stored __proto__ row is hashed as data');
  assert.strictEqual(Object.prototype.polluted, undefined);
});
