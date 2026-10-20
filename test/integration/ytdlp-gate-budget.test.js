'use strict';

// [INTEGRATION] v1.393.0 W3 (plan 2026-10-20-listing-overflow, R3): the gate-job budget watchdog, wired. Bound here:
// (1) the safety property - a hung job whose child is alive is released ONLY after that child (its whole group) is
// gone, so two yt-dlp never run at once, and the hung job, if it wakes late, cannot start a child; (2) a channel
// job that hangs outside any child (the orphaned-promise shape) is released, its row says why, the poll moves on to
// the next channel and pollBusy clears; (3) the budget is DERIVED from the job's own timeouts.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { test, beforeEach, afterEach, after } = require('node:test');
const assert = require('node:assert');

const ytdlp = require('../../lib/ytdlp');
const ytdlpStoreModule = require('../../lib/ytdlp/store');
const { featureStoreFor, docView } = require('../helpers/scratch-feature-store');
const engine = require('../../lib/ytdlp/engine');
const run = require('../../lib/ytdlp/run');
const store = require('../../lib/ytdlp/store');
const gate = require('../../lib/heavyGate');
const activity = require('../../lib/ytdlp/activity');

// The watchdog's timers are unref'd (the server keeps the process alive); the test runner needs a keep-alive.
const keepAlive = setInterval(() => {}, 1000);
after(() => clearInterval(keepAlive));

let tmpDir;
const origBinary = engine.activeBinaryPath;
const origRunList = run.runList;
beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-gate-budget-')); });
afterEach(() => {
  engine.activeBinaryPath = origBinary;
  run.runList = origRunList;
  ytdlp.setGateBudgetOverrideForTests(null);
  ytdlp.resetPollRerunStateForTests();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await tick(20); }
  throw new Error('timed out waiting');
}
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
const quiet = async (fn) => {
  const orig = console.error;
  const lines = [];
  console.error = (...a) => { lines.push(a.join(' ')); };
  try { return { value: await fn(), lines }; } finally { console.error = orig; }
};

test('R3 safety: a hung job with a LIVE child is released only after the child is gone; the next job never overlaps it; the hung job cannot spawn when it wakes', async () => {
  // First run: hangs and records its pid. Later runs: record whether the hung one was still alive at their start.
  const bin = path.join(tmpDir, 'fake-ytdlp');
  fs.writeFileSync(bin, `#!${process.execPath}
const fs = require('fs');
const dir = ${JSON.stringify(tmpDir)};
if (!fs.existsSync(dir + '/first.pid')) {
  fs.writeFileSync(dir + '/first.pid', String(process.pid));
  setInterval(() => {}, 1000);
} else {
  const first = Number(fs.readFileSync(dir + '/first.pid', 'utf8'));
  let alive = true;
  try { process.kill(first, 0); } catch { alive = false; }
  fs.writeFileSync(dir + '/second.saw-first-alive', String(alive));
  fs.appendFileSync(dir + '/runs', 'x');
  process.exit(0);
}
`, { mode: 0o755 });
  engine.activeBinaryPath = () => bin;

  let wake;
  const woken = new Promise((r) => { wake = r; });
  let lateSpawn = null;
  const { value } = await quiet(async () => {
    const a = gate.runExclusive(async () => {
      run.spawnYtdlp(['--dump-json', 'x'], { timeoutMs: 600000 }); // the child; its promise is dropped: the orphaned-promise shape
      await woken; // never settles on its own
      lateSpawn = await run.spawnYtdlp(['--dump-json', 'x'], { timeoutMs: 10000 });
    }, { kind: 'channel', label: 'hung', budgetMs: 300, onBudgetExceeded: () => run.killAllLiveYtdlp() });
    const b = gate.runExclusive(() => run.spawnYtdlp(['--dump-json', 'x'], { timeoutMs: 10000 }), { kind: 'channel', label: 'next' });
    const aResult = await a;
    const bResult = await b;
    wake();
    await tick(100);
    return { aResult, bResult };
  });
  const firstPid = Number(fs.readFileSync(path.join(tmpDir, 'first.pid'), 'utf8'));
  assert.strictEqual(value.aResult.code, 'EBUDGET');
  assert.strictEqual(value.bResult.ok, true, JSON.stringify(value.bResult));
  assert.strictEqual(alive(firstPid), false, 'the hung job\'s child is dead');
  assert.strictEqual(fs.readFileSync(path.join(tmpDir, 'second.saw-first-alive'), 'utf8'), 'false', 'the next job started only after the hung one\'s child was gone');
  assert.strictEqual(fs.readFileSync(path.join(tmpDir, 'runs'), 'utf8'), 'x', 'exactly one later run: the woken hung job spawned nothing');
  assert.strictEqual(lateSpawn.code, 'EABANDONED', JSON.stringify(lateSpawn));
  assert.deepStrictEqual(run.liveGroupsForTests(), []);
});

test('R3 killAllLiveYtdlp: true at once when nothing is alive; kills a real hanging child and reports true only when it has exited', async () => {
  assert.strictEqual(await run.killAllLiveYtdlp(200), true);
  const bin = path.join(tmpDir, 'hang');
  fs.writeFileSync(bin, `#!${process.execPath}\nrequire('fs').writeFileSync(${JSON.stringify(path.join(tmpDir, 'pid'))}, String(process.pid));\nsetInterval(() => {}, 1000);\n`, { mode: 0o755 });
  engine.activeBinaryPath = () => bin;
  const p = run.spawnYtdlp(['x'], { timeoutMs: 600000 });
  const pid = Number(await until(() => (fs.existsSync(path.join(tmpDir, 'pid')) ? fs.readFileSync(path.join(tmpDir, 'pid'), 'utf8') : null)));
  assert.ok(alive(pid));
  assert.strictEqual(await run.killAllLiveYtdlp(5000), true);
  assert.strictEqual(alive(pid), false);
  await p;
});

test('R3 wired: a channel job that hangs (no child, the orphaned-promise shape) is released at its budget, its row says why, the poll moves on and pollBusy clears', { timeout: 20000 }, async () => {
  const deps = makeFakeDeps();
  const config = enabledConfig();
  const subA = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@chanA', format: 'video', quality: 'best' });
  const subB = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@chanB', format: 'video', quality: 'best' });
  const listed = [];
  run.runList = (sub) => {
    listed.push(sub.id);
    if (sub.id === subA.id) return new Promise(() => {}); // never settles
    return Promise.resolve({ ok: true, stdout: '', stderr: '' });
  };
  ytdlp.setGateBudgetOverrideForTests(300);
  const { lines } = await quiet(async () => {
    await ytdlp.runPoll(deps, config);
  });
  assert.deepStrictEqual(listed, [subA.id, subB.id], 'channel B was reached after A was released');
  assert.strictEqual(ytdlp.isPollBusy(), false, 'pollBusy cleared');
  assert.ok(lines.some((l) => /^gate job exceeded its budget: channel .* \d+$/.test(l)), lines.join('\n'));
  const snap = activity.getSnapshot().subscriptions;
  assert.strictEqual(snap[subA.id].state, 'error');
  assert.strictEqual(snap[subA.id].error, 'stopped: exceeded its time budget');
  const a = store.listSubscriptions(deps).find((s) => s.id === subA.id);
  assert.match(a.lastStatus, /stopped: exceeded its time budget/);
  assert.ok(a.lastCheckedAt, 'recorded as a failed check, so the channel backs off instead of wedging the next poll the same way');
  assert.strictEqual(gate.isHeavyJobActive(), false);
});

test('R3 the budget is DERIVED from the job\'s own timeouts (list + probe + two downloads + grace + slack), not a guess', () => {
  const config = enabledConfig();
  const sub = { channelUrl: 'https://www.youtube.com/@x' };
  const grace = 5 * 1000;
  const oneDownload = 180 * 60 * 1000 + grace; // the default absolute download ceiling
  const slack = 10 * 60 * 1000;
  const list = Math.min(config.listTimeoutMinutes * 60 * 1000 + 200 * 3 * 1000 * (config.sleepRequests ?? 1), 60 * 60 * 1000);
  const channel = run.gateBudgetMs('channel', { sub, config });
  assert.ok(channel >= 2 * oneDownload + slack, 'covers the retried download: ' + channel);
  assert.ok(channel <= 60 * 60 * 1000 + grace + 30 * 1000 + 2 * oneDownload + slack, 'no more than list cap + probe + 2 downloads + slack: ' + channel);
  assert.ok(channel >= list + 2 * oneDownload + slack - 1, 'covers its own list budget');
  assert.strictEqual(run.gateBudgetMs('oneshot', { config }), 30 * 1000 + grace + 2 * oneDownload + slack);
  assert.strictEqual(run.gateBudgetMs('probe', { config }), 0, 'unbudgeted kinds return 0');
  // A longer configured ceiling lengthens the budget (it follows the config, never a constant).
  const longer = ytdlp.parseYtdlpConfig({ FILETUBE_YTDLP_ENABLED: 'true', FILETUBE_YTDLP_DOWNLOAD_DIR: tmpDir, FILETUBE_YTDLP_DOWNLOAD_TIMEOUT_MINUTES: '300' });
  assert.ok(run.gateBudgetMs('oneshot', { config: longer }) > run.gateBudgetMs('oneshot', { config }));
});
