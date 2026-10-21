'use strict';

// [INTEGRATION] v1.393.0 W3 (plan 2026-10-20-listing-overflow, R4): Cancel frees a LISTING. Before this, a
// subscription in its 'listing' state had no tracked child, Cancel was refused, and only a restart freed a list
// pass that held the whole queue (production: 9 hours). Driven through a REAL fake yt-dlp (no run.js stubs): the
// list child of channel A hangs; Cancel kills its process group, A settles 'cancelled' (not an error that counts
// toward the breaker), and the poll moves on to channel B, whose list child really runs.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const express = require('express');

const ytdlp = require('../../lib/ytdlp');
const ytdlpStoreModule = require('../../lib/ytdlp/store');
const { featureStoreFor, docView } = require('../helpers/scratch-feature-store');
const engine = require('../../lib/ytdlp/engine');
const store = require('../../lib/ytdlp/store');

let tmpDir;
const origBinary = engine.activeBinaryPath;
beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-listing-cancel-')); });
afterEach(() => {
  engine.activeBinaryPath = origBinary;
  ytdlp.resetPollRerunStateForTests();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeFakeDeps() {
  const db = {};
  return {
    ytdlpDb: featureStoreFor(ytdlpStoreModule.FEATURE, db),
    loadDatabase: () => docView(db, featureStoreFor(ytdlpStoreModule.FEATURE, db)),
    updateDatabase: (mutatorFn) => Promise.resolve(mutatorFn(db)),
    scanDirectories: async () => {},
    getMediaId: (input) => crypto.createHash('md5').update(input).digest('hex'),
  };
}
const enabledConfig = () => ytdlp.parseYtdlpConfig({ FILETUBE_YTDLP_ENABLED: 'true', FILETUBE_YTDLP_POLL_MINUTES: '0', FILETUBE_YTDLP_DOWNLOAD_DIR: tmpDir });
const addSub = (deps, channelUrl) => store.addSubscription(deps, { channelUrl, format: 'video', quality: 'best' });
async function startTestApp(deps, config) {
  const app = express();
  app.use(express.json());
  ytdlp.registerRoutes(app, deps, config);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  return { base: `http://127.0.0.1:${server.address().port}`, close: async () => { server.closeAllConnections?.(); await new Promise((r) => server.close(r)); } };
}
const post = (base, p) => fetch(`${base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
const status = async (base) => (await (await fetch(`${base}/api/subscriptions/status`)).json()).subscriptions;
async function until(fn, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 20)); }
  throw new Error('timed out waiting');
}
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

// A fake yt-dlp: the FIRST run for @chanA (its list pass) hangs and records its pid; every other run (a later
// avatar probe of A, anything for B) exits 0 and records the visit.
function installFakeYtdlp() {
  const bin = path.join(tmpDir, 'fake-ytdlp');
  fs.writeFileSync(bin, `#!${process.execPath}
const fs = require('fs');
const argv = process.argv.slice(2).join(' ');
if (argv.includes('chanA') && !fs.existsSync(${JSON.stringify(path.join(tmpDir, 'chanA.pid'))})) {
  fs.writeFileSync(${JSON.stringify(path.join(tmpDir, 'chanA.pid'))}, String(process.pid));
  setInterval(() => {}, 1000);
} else {
  fs.appendFileSync(${JSON.stringify(path.join(tmpDir, 'visited'))}, (argv.includes('chanB') ? 'B' : 'A-after') + '\\n');
  process.exit(0);
}
`, { mode: 0o755 });
  engine.activeBinaryPath = () => bin;
}

for (const route of ['single', 'stop-all']) {
  test(`R4 ${route} cancel on a LISTING subscription kills the list child's group, settles 'cancelled', and the poll moves to the next channel`, async () => {
    installFakeYtdlp();
    const deps = makeFakeDeps();
    const config = enabledConfig();
    const subA = await addSub(deps, 'https://www.youtube.com/@chanA');
    await addSub(deps, 'https://www.youtube.com/@chanB');
    const { base, close } = await startTestApp(deps, config);
    let pollPromise;
    try {
      pollPromise = ytdlp.runPoll(deps, config);
      await until(async () => (await status(base))[subA.id].state === 'listing');
      const pid = Number(await until(() => (fs.existsSync(path.join(tmpDir, 'chanA.pid')) ? fs.readFileSync(path.join(tmpDir, 'chanA.pid'), 'utf8') : null)));
      assert.ok(alive(pid), 'the list child is running');

      const res = await post(base, route === 'single' ? `/api/subscriptions/${subA.id}/cancel` : '/api/subscriptions/downloads/cancel');
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      if (route === 'single') assert.deepStrictEqual(body, { cancelled: true, id: subA.id });
      else assert.strictEqual(body.cancelled >= 1, true, JSON.stringify(body));
      assert.strictEqual((await status(base))[subA.id].state, 'cancelled');

      await until(() => !alive(pid), 5000);
      await pollPromise;
      if (route === 'single') {
        assert.match(fs.readFileSync(path.join(tmpDir, 'visited'), 'utf8'), /^B$/m, 'the poll moved on and really listed channel B');
      }
      const subs = store.listSubscriptions(deps);
      const a = subs.find((s) => s.id === subA.id);
      assert.strictEqual(a.lastStatus, 'cancelled', 'cancelled, not a synthesized list error: ' + a.lastStatus);
      assert.strictEqual((await status(base))[subA.id].state, 'cancelled');
    } finally {
      if (fs.existsSync(path.join(tmpDir, 'chanA.pid'))) {
        try { process.kill(Number(fs.readFileSync(path.join(tmpDir, 'chanA.pid'), 'utf8')), 'SIGKILL'); } catch { /* gone */ }
      }
      if (pollPromise) await pollPromise.catch(() => {});
      await close();
    }
  });
}

test('R4 a Cancel with no live list child is still the harmless no-op (cancelled: false), never a fake success', async () => {
  const deps = makeFakeDeps();
  const config = enabledConfig();
  const subA = await addSub(deps, 'https://www.youtube.com/@chanA');
  const { base, close } = await startTestApp(deps, config);
  try {
    const res = await post(base, `/api/subscriptions/${subA.id}/cancel`);
    assert.deepStrictEqual(await res.json(), { cancelled: false, id: subA.id });
  } finally {
    await close();
  }
});
