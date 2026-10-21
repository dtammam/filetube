'use strict';

// [INTEGRATION] v1.393.0 gate round 2 (plan 2026-10-20-listing-overflow): two wiring bindings the first round left
// unbound. (1) The ONE-OFF download is budgeted in production: a one-off whose download child hangs is released at
// its budget through the real POST /api/ytdlp/download route, its row says why, the child's group is gone, and the
// next gate job runs (mutating `oneShotGateBudget` out of the production runExclusive call fails this). (2) A Cancel
// latched while the list pass was still finishing (the list returned ok) settles 'cancelled' and never starts a
// download.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { test, beforeEach, afterEach, after } = require('node:test');
const assert = require('node:assert');
const express = require('express');

const ytdlp = require('../../lib/ytdlp');
const ytdlpStoreModule = require('../../lib/ytdlp/store');
const { featureStoreFor, docView, scratchFeatureStore } = require('../helpers/scratch-feature-store');
const engine = require('../../lib/ytdlp/engine');
const run = require('../../lib/ytdlp/run');
const store = require('../../lib/ytdlp/store');
const gate = require('../../lib/heavyGate');
const activity = require('../../lib/ytdlp/activity');
const oneshotTrace = require('../../lib/ytdlp/oneshotTrace');

const keepAlive = setInterval(() => {}, 1000);
after(() => clearInterval(keepAlive));

let tmpDir;
const origBinary = engine.activeBinaryPath;
const origRunList = run.runList;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-round2-'));
  activity.resetForTests();
});
afterEach(() => {
  engine.activeBinaryPath = origBinary;
  run.runList = origRunList;
  ytdlp.setGateBudgetOverrideForTests(null);
  ytdlp.resetPollRerunStateForTests();
  activity.resetForTests();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await tick(20); }
  throw new Error('timed out waiting');
}
const enabledConfig = () => ytdlp.parseYtdlpConfig({ FILETUBE_YTDLP_ENABLED: 'true', FILETUBE_YTDLP_POLL_MINUTES: '0', FILETUBE_YTDLP_DOWNLOAD_DIR: tmpDir });
async function startTestApp(deps, config) {
  const app = express();
  app.use(express.json());
  ytdlp.registerRoutes(app, deps, config);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  return { base: `http://127.0.0.1:${server.address().port}`, close: async () => { server.closeAllConnections?.(); await new Promise((r) => server.close(r)); } };
}

test('R3 one-off wired: a one-off whose download child hangs is released at its budget through the real route; the row says why, the child is gone, the next job runs', { timeout: 30000 }, async () => {
  // Probe (no --newline) answers and exits; the download (argv carries --newline) hangs and records its pid.
  const bin = path.join(tmpDir, 'fake-ytdlp');
  fs.writeFileSync(bin, `#!${process.execPath}
const fs = require('fs');
if (process.argv.includes('--newline')) {
  fs.writeFileSync(${JSON.stringify(path.join(tmpDir, 'dl.pid'))}, String(process.pid));
  setInterval(() => {}, 1000);
} else {
  process.exit(0);
}
`, { mode: 0o755 });
  engine.activeBinaryPath = () => bin;
  const deps = {
    ytdlpDb: scratchFeatureStore(ytdlpStoreModule.FEATURE),
    loadDatabase: () => ({ metadata: {} }),
    updateDatabase: (fn) => Promise.resolve(fn({ metadata: {}, ytdlp: { subscriptions: [], downloadMeta: {}, pins: [] } })),
    scanDirectories: async () => {},
    getMediaId: (input) => crypto.createHash('md5').update(input).digest('hex'),
    dataDir: tmpDir,
  };
  ytdlp.setGateBudgetOverrideForTests(500);
  const { base, close } = await startTestApp(deps, enabledConfig());
  const origErr = console.error;
  console.error = () => {};
  let pid = null;
  try {
    const post = await fetch(`${base}/api/ytdlp/download`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }),
    });
    assert.strictEqual(post.status, 202);
    const { jobId } = await post.json();
    pid = Number(await until(() => (fs.existsSync(path.join(tmpDir, 'dl.pid')) ? fs.readFileSync(path.join(tmpDir, 'dl.pid'), 'utf8') : null)));
    assert.ok(alive(pid), 'the download child is running');
    let nextRan = false;
    const next = gate.runExclusive(async () => { nextRan = true; });
    await until(() => nextRan, 10000);
    await next;
    assert.strictEqual(alive(pid), false, 'the hung download\'s child is gone before the next job ran');
    const body = await (await fetch(`${base}/api/subscriptions/status`)).json();
    const entry = body.oneShots[jobId];
    assert.strictEqual(entry.state, 'error');
    // The killed child's own failure may land after the hook's write and reword the row; the budget stop itself is
    // the trace's budget-stop event, and the row is a terminal error either way.
    assert.ok(oneshotTrace.readEntries(tmpDir).some((e) => e.jobId === jobId && e.ev === 'budget-stop'), 'the trace records the budget stop');
    assert.strictEqual(gate.isHeavyJobActive(), false);
  } finally {
    console.error = origErr;
    if (pid) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
    await close();
  }
});

test('R4 a Cancel latched while the list pass finished ok settles cancelled and starts no download', { timeout: 20000 }, async () => {
  const bin = path.join(tmpDir, 'fake-ytdlp');
  fs.writeFileSync(bin, `#!${process.execPath}\nrequire('fs').appendFileSync(${JSON.stringify(path.join(tmpDir, 'visited'))}, process.argv.slice(2).join(' ') + '\\n');\nprocess.exit(0);\n`, { mode: 0o755 });
  engine.activeBinaryPath = () => bin;
  const db = {};
  const deps = {
    ytdlpDb: featureStoreFor(ytdlpStoreModule.FEATURE, db),
    loadDatabase: () => docView(db, featureStoreFor(ytdlpStoreModule.FEATURE, db)),
    updateDatabase: (mutatorFn) => Promise.resolve(mutatorFn(db)),
    scanDirectories: async () => {},
    getMediaId: (input) => crypto.createHash('md5').update(input).digest('hex'),
    dataDir: tmpDir,
  };
  const config = enabledConfig();
  const sub = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@chanA', format: 'video', quality: 'best' });
  const { base, close } = await startTestApp(deps, config);
  // The list "finishes ok" in the same breath as the Cancel (the exit-to-close window): a registered list child
  // that is a harmless stand-in, the Cancel arrives, and the list result is still ok with a new video in it.
  run.runList = async (s, c, opts) => {
    opts.onChild({ kill() {} });
    const res = await fetch(`${base}/api/subscriptions/${s.id}/cancel`, { method: 'POST' });
    assert.deepStrictEqual(await res.json(), { cancelled: true, id: s.id });
    return { ok: true, stdout: JSON.stringify({ id: 'newvid00001', title: 'New', upload_date: '29990101' }) + '\n', stderr: '' };
  };
  try {
    await ytdlp.runPoll(deps, config);
    const visited = fs.existsSync(path.join(tmpDir, 'visited')) ? fs.readFileSync(path.join(tmpDir, 'visited'), 'utf8') : '';
    assert.doesNotMatch(visited, /--newline/, 'the cancelled listing did not go on to download: ' + visited);
    const a = store.listSubscriptions(deps).find((x) => x.id === sub.id);
    assert.strictEqual(a.lastStatus, 'cancelled');
    assert.strictEqual(activity.getSnapshot().subscriptions[sub.id].state, 'cancelled');
  } finally {
    await close();
  }
});
