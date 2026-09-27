'use strict';

// [INTEGRATION] v1.339 r1 gate fixes on POST /api/config (plan
// docs/exec-plans/completed/2026-09-26-fouc-toctou-audit.md, `## Gate` r1: W and
// the suggestions).
//
// W (data loss, pre-existing): Settings opened while GET /api/config failed
// left the form empty with no base, and Save POSTed `{folders: [],
// folderSettings: {}}` with no `baseVersion` - the legacy path replaced the
// tables with nothing and the scan the save fires pruned the library. The
// client now refuses that Save (test/unit/setup-save-config-cas.test.js); the
// server independently refuses a LEGACY write (no baseVersion) that would leave
// none of the stored folders configured - 409, both tables byte-identical, no
// scan. A legacy write that keeps at least one stored folder still saves, and a
// write WITH a matching base may remove every folder (a deliberate choice made
// on the current list).
//
// Suggestions: a throw in the handler's pre-mutator code (the stored-folder
// read before the loop, the overlap nets' root reads) is a 500, never a hung
// socket (Express 4 does not observe a rejected async handler - bound here
// with a timeout so a hang is red); the module's synthetic download root that
// GET injects while its directory does not exist yet is never reported in
// `skippedFolders`.

const { DATA_DIR } = require('../helpers/isolate-data-dir');
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, __resetDatabaseForTests, folderStore, folderSettingsStore, scanState, booksDb } = require('../../server');
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

// Records every write of `true` to scanState.scanning / rescanRequested (the
// first synchronous thing scanDirectories() does), so "a scan was started" is
// observed at the call.
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
const rec = (name) => ({ name, hidden: false, hiddenFromSidebar: false });
const withTimeout = (p, ms = 4000) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`no response within ${ms}ms (the handler hung)`)), ms))]);

function tableBytes() {
  const p = readPersistedDatabase(DATA_DIR);
  return JSON.stringify({ list: folderStore.list(), map: folderSettingsStore.getAll(), pFolders: p.folders, pSettings: p.folderSettings });
}

// The route's handler, invoked directly (no middleware in front of it, so a
// stubbed store read can only be reached by the handler itself).
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
    headersSent: false,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.headersSent = true; resolve({ status: this.statusCode, body }); return this; },
  };
  return { res, done };
}
const admin = { username: 'admin', role: 'admin' };

// ---------------------------------------------------------------------------
// W: the legacy wipe
// ---------------------------------------------------------------------------

test('W: a legacy POST of an EMPTY folder list (the failed-load Save) is refused with 409 - both tables byte-identical, no scan', async () => {
  const A = mk('ft-guard-a-'); const B = mk('ft-guard-b-');
  seedState({ folders: [A, B], folderSettings: { [A]: rec('Alpha'), [B]: rec('Beta') }, metadata: {} });
  const before = tableBytes();
  const spy = spyScanStarts();
  let res;
  try {
    res = await withTimeout(post({ folders: [], folderSettings: {} }));
  } finally {
    spy.restore();
  }
  const body = await res.json();
  assert.strictEqual(res.status, 409, JSON.stringify(body));
  assert.match(body.error, /^Refusing to remove every configured folder/);
  assert.ok(!('configVersion' in body), 'no version handed out: the caller is told to reload, not to retry blind');
  assert.strictEqual(tableBytes(), before, 'THE binding: nothing written (list, map and the persisted snapshot)');
  assert.deepStrictEqual(spy.starts, [], 'no scan started');
});

test('W: a legacy POST that drops EVERY stored folder while adding a new one (a failed-load form plus a typed path) is refused too', async () => {
  const A = mk('ft-guard-c-'); const B = mk('ft-guard-d-'); const C = mk('ft-guard-e-');
  seedState({ folders: [A, B], folderSettings: { [A]: rec('Alpha') }, metadata: {} });
  const before = tableBytes();
  const res = await withTimeout(post({ folders: [C], folderSettings: {} }));
  assert.strictEqual(res.status, 409, await res.text());
  assert.strictEqual(tableBytes(), before);
});

test('W: the refusal compares RESOLVED paths - a legacy POST re-spelling a stored folder keeps it and saves', async () => {
  const A = mk('ft-guard-f-');
  seedState({ folders: [A], folderSettings: {}, metadata: {} });
  const res = await withTimeout(post({ folders: [A + path.sep], folderSettings: {} }));
  assert.strictEqual(res.status, 200, await res.text());
  await waitForScanIdle();
});

test('W control: a legit legacy POST that keeps one stored folder (drops one, adds one) still saves and scans', async () => {
  const A = mk('ft-guard-g-'); const B = mk('ft-guard-h-'); const C = mk('ft-guard-i-');
  seedState({ folders: [A, B], folderSettings: { [A]: rec('Alpha'), [B]: rec('Beta') }, metadata: {} });
  const spy = spyScanStarts();
  let res;
  try {
    res = await withTimeout(post({ folders: [B, C], folderSettings: { [B]: rec('Beta') } }));
  } finally {
    spy.restore();
  }
  assert.strictEqual(res.status, 200, await res.text());
  assert.deepStrictEqual(folderStore.list(), [B, C]);
  assert.deepStrictEqual(folderSettingsStore.getAll(), { [B]: rec('Beta') });
  assert.ok(spy.starts.length > 0, 'the save fired its scan');
  await waitForScanIdle();
});

test('W control: a legacy POST against an EMPTY store saves (nothing to wipe - a first setup)', async () => {
  const A = mk('ft-guard-j-');
  seedState({ folders: [], folderSettings: {}, metadata: {} });
  const res = await withTimeout(post({ folders: [A], folderSettings: {} }));
  assert.strictEqual(res.status, 200, await res.text());
  assert.deepStrictEqual(folderStore.list(), [A]);
  await waitForScanIdle();
});

test('W control: removing EVERY folder with the MATCHING base is a deliberate choice on the current list - it saves', async () => {
  const A = mk('ft-guard-k-');
  seedState({ folders: [A], folderSettings: { [A]: rec('Alpha') }, metadata: {} });
  const cfg = await getConfig();
  assert.strictEqual(typeof cfg.configVersion, 'string', 'populated: an admin GET carries the base');
  const res = await withTimeout(post({ folders: [], folderSettings: {}, baseVersion: cfg.configVersion }));
  assert.strictEqual(res.status, 200, await res.text());
  assert.deepStrictEqual(folderStore.list(), []);
  await waitForScanIdle();
});

test('W: the refusal reads the tables INSIDE the mutator - a same-turn legacy empty POST behind a folder add is still refused', async () => {
  const A = mk('ft-guard-l-'); const B = mk('ft-guard-m-');
  seedState({ folders: [], folderSettings: {}, metadata: {} });
  const handler = configPostHandler();
  const r1 = fakeRes(); const r2 = fakeRes();
  // 1 adds A and B to an empty store; 2 (queued in the same turn, so its
  // pre-mutator code saw the store EMPTY) posts an empty legacy list. Only the
  // mutator's fresh read knows there are folders to wipe by then.
  handler({ user: admin, body: { folders: [A, B], folderSettings: {} } }, r1.res);
  handler({ user: admin, body: { folders: [], folderSettings: {} } }, r2.res);
  const [o1, o2] = await withTimeout(Promise.all([r1.done, r2.done]));
  assert.deepStrictEqual([o1.status, o2.status], [200, 409]);
  assert.deepStrictEqual(folderStore.list(), [A, B], 'the add survived the stale empty save');
  await waitForScanIdle();
});

// ---------------------------------------------------------------------------
// Express 4: a throw before the mutator is a 500, never a hang
// ---------------------------------------------------------------------------

test('a throw in the stored-folder read BEFORE the validation loop answers 500 (bounded: a hang is red) and writes nothing', async () => {
  const A = mk('ft-guard-n-');
  seedState({ folders: [A], folderSettings: {}, metadata: {} });
  const before = tableBytes();
  const realList = folderStore.list;
  let thrown = 0;
  folderStore.list = () => { thrown++; throw new Error('simulated store read failure'); };
  let out;
  try {
    const r = fakeRes();
    configPostHandler()({ user: admin, body: { folders: [A], folderSettings: {} } }, r.res);
    out = await withTimeout(r.done);
  } finally {
    folderStore.list = realList;
  }
  assert.ok(thrown >= 1, 'populated: the stubbed read was reached');
  assert.strictEqual(out.status, 500, JSON.stringify(out.body));
  assert.match(out.body.error, /simulated store read failure/);
  assert.strictEqual(tableBytes(), before);
});

test('a throw in an overlap net\'s root read (the books roots) answers 500 too, never a hang', async () => {
  const A = mk('ft-guard-o-');
  seedState({ folders: [A], folderSettings: {}, metadata: {} });
  const realRead = booksDb.read;
  let thrown = 0;
  booksDb.read = () => { thrown++; throw new Error('simulated books read failure'); };
  let out;
  try {
    const r = fakeRes();
    configPostHandler()({ user: admin, body: { folders: [A], folderSettings: {} } }, r.res);
    out = await withTimeout(r.done);
  } finally {
    booksDb.read = realRead;
  }
  assert.ok(thrown >= 1, 'populated: the stubbed read was reached');
  assert.strictEqual(out.status, 500, JSON.stringify(out.body));
  assert.deepStrictEqual(folderStore.list(), [A]);
});

// ---------------------------------------------------------------------------
// skippedFolders and the synthetic download root
// ---------------------------------------------------------------------------

test('skippedFolders never names the synthetic download root GET injects while its directory does not exist yet', async () => {
  const A = mk('ft-guard-p-');
  const downloadDir = path.join(mk('ft-guard-dlparent-'), 'not-created-yet');
  process.env.FILETUBE_YTDLP_ENABLED = 'true';
  process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = downloadDir;
  try {
    seedState({ folders: [A], folderSettings: {}, metadata: {} });
    assert.strictEqual(fs.existsSync(downloadDir), false, 'populated: the download dir does not exist');
    const cfg = await getConfig();
    const synth = path.resolve(downloadDir);
    assert.deepStrictEqual(cfg.folders, [A, synth], 'populated: GET injected the synthetic root');
    // A Save round-trips the projection, synthetic root first (a reorder).
    const res = await withTimeout(post({ folders: [synth, A], folderSettings: cfg.folderSettings, baseVersion: cfg.configVersion }));
    const body = await res.json();
    assert.strictEqual(res.status, 200, JSON.stringify(body));
    assert.deepStrictEqual(body.skippedFolders, [], 'THE binding: the synthetic root is not a refused new folder');
    assert.deepStrictEqual(folderStore.list(), [A], 'and it is still never stored');
    assert.strictEqual(folderSettingsStore.getAll()[synth].order, 0, 'its display position is recorded like an existing root\'s');
    // A genuinely new nonexistent path in the same save is still named.
    const cfg2 = await getConfig();
    const ghost = path.join(os.tmpdir(), 'ft-guard-ghost-does-not-exist');
    const res2 = await withTimeout(post({ folders: [...cfg2.folders, ghost], folderSettings: cfg2.folderSettings, baseVersion: cfg2.configVersion }));
    const body2 = await res2.json();
    assert.strictEqual(res2.status, 200, JSON.stringify(body2));
    assert.deepStrictEqual(body2.skippedFolders, [ghost], 'only the real new missing path is reported');
    await waitForScanIdle();
  } finally {
    delete process.env.FILETUBE_YTDLP_ENABLED;
    delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
  }
});
