'use strict';

// [INTEGRATION] v1.146 T6 - the daily auto-update gate and the boot
// reconcile, driven directly through lib/ytdlp's exported seams (the
// scheduledPollTick posture: tests fire ticks, never wait out intervals).
// Binds the ruling's term 4 (opt-in, default OFF, 24h ledger) and the
// anti-flap revert guard: an UNATTENDED trigger never reinstalls the exact
// build the runtime net reverted.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const { EventEmitter } = require('node:events');
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

const ytdlp = require('../../lib/ytdlp');
const engine = require('../../lib/ytdlp/engine');

const originalSpawn = cp.spawn;
let dataDir, bells, deps;

const NIGHTLY = '2026.8.17.73947.dev0';
const NEWER_NIGHTLY = '2026.8.18.10203.dev0';

function fakeChild({ code = 0, stdout = '', stderr = '' } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => { setImmediate(() => child.emit('close', null, 'SIGKILL')); };
  setImmediate(() => {
    if (stdout) child.stdout.emit('data', Buffer.from(stdout));
    if (stderr) child.stderr.emit('data', Buffer.from(stderr));
    child.emit('close', code, null);
  });
  return child;
}

function armSpawns(reportedVersion = '2026.08.17.073947') {
  const venvBin = path.join(dataDir, 'ytdlp-engine', 'venv', 'bin');
  cp.spawn = (cmd, argv) => {
    if (cmd === 'python3' && argv[0] === '--version') return fakeChild({ stdout: 'Python 3.12.9\n' });
    if (cmd === 'python3' && argv[1] === 'venv') {
      fs.mkdirSync(venvBin, { recursive: true });
      fs.writeFileSync(path.join(venvBin, 'python'), '#!fake');
      fs.writeFileSync(path.join(venvBin, 'pip'), '#!fake');
      return fakeChild({});
    }
    if (cmd.endsWith(path.join('bin', 'pip'))) {
      fs.writeFileSync(path.join(venvBin, 'yt-dlp'), '#!fake');
      return fakeChild({});
    }
    if (cmd.endsWith(path.join('bin', 'yt-dlp'))) return fakeChild({ stdout: `${reportedVersion}\n` });
    if (cmd === 'yt-dlp') return fakeChild({ stdout: '2026.8.10.11111.dev0\n' });
    throw new Error(`unexpected spawn in boot test: ${cmd} ${argv.join(' ')}`);
  };
}

function armPypi(latestNightly = NIGHTLY) {
  engine._setFetchImplForTests(() => {
    const bytes = Buffer.from(JSON.stringify({
      releases: { '2026.7.4': [{ yanked: false }], [latestNightly]: [{ yanked: false }] },
    }));
    return Promise.resolve({ ok: true, status: 200, body: (async function* () { yield bytes; })() });
  });
}

async function awaitJob() {
  const job = ytdlp.currentEngineJob();
  if (job && job.promise) await job.promise;
}

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-engine-boot-'));
  engine._resetForTests();
  bells = [];
  deps = { dataDir, recordEngineEvent: (event, version) => bells.push({ event, version }) };
  engine.initRuntime({ dataDir });
  armPypi();
});

afterEach(async () => {
  await awaitJob();
  cp.spawn = originalSpawn;
  const t = ytdlp.currentEngineTimer();
  if (t) clearInterval(t);
  engine._resetForTests();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('the tick is a four-way no-op gate: opt-out, bundled channel, not-due, busy', async () => {
  // Default state: autoUpdate OFF -> opt-out, and nothing spawns/fetches.
  cp.spawn = () => { throw new Error('the opt-out tick must never spawn'); };
  assert.deepEqual(await ytdlp.engineAutoUpdateTick(deps), { skipped: 'opt-out' });
  // Opted in but channel bundled.
  engine.setAutoUpdate({ dataDir, enabled: true });
  assert.deepEqual(await ytdlp.engineAutoUpdateTick(deps), { skipped: 'bundled' });
  // Nightly channel with a fresh check ledger: not due.
  engine.setChannelIntent({ dataDir, channel: 'nightly' });
  const state = engine.readState(dataDir);
  state.lastCheckAt = 1000;
  engine.writeState(dataDir, state);
  assert.deepEqual(
    await ytdlp.engineAutoUpdateTick(deps, 1000 + ytdlp.ENGINE_AUTO_UPDATE_INTERVAL_MS - 1),
    { skipped: 'not-due' }
  );
});

test('a due tick queues, installs, activates, and bells "updated"', async () => {
  armSpawns();
  engine.setAutoUpdate({ dataDir, enabled: true });
  engine.setChannelIntent({ dataDir, channel: 'nightly' });
  const r = await ytdlp.engineAutoUpdateTick(deps, Date.now());
  assert.deepEqual(r, { queued: true });
  await awaitJob();
  const state = engine.readState(dataDir);
  assert.equal(state.active, 'venv');
  assert.equal(state.installed.version, NIGHTLY);
  assert.ok(state.lastCheckAt > 0, 'the 24h ledger was stamped');
  assert.deepEqual(bells, [{ event: 'updated', version: '2026.08.17.073947' }]);
});

test('anti-flap: a daily tick will NOT reinstall the exact build the runtime net reverted', async () => {
  armSpawns();
  engine.setAutoUpdate({ dataDir, enabled: true });
  engine.setChannelIntent({ dataDir, channel: 'nightly' });
  await ytdlp.engineAutoUpdateTick(deps, Date.now());
  await awaitJob();
  // The runtime net reverts the freshly-installed nightly (runtime already
  // bound via initRuntime in beforeEach).
  engine.reportEngineFailure({ binaryUsed: engine.resolveVenvBinaryPath(dataDir), reason: 'spawn ENOENT' });
  bells.length = 0;
  // Next due tick: PyPI still offers the SAME nightly -> held, no install,
  // no bell, active stays bundled.
  const past = engine.readState(dataDir);
  past.lastCheckAt = 1000;
  engine.writeState(dataDir, past);
  await ytdlp.engineAutoUpdateTick(deps, Date.now());
  await awaitJob();
  const held = engine.readState(dataDir);
  assert.equal(held.active, 'bundled');
  assert.match(held.lastResult.message, /same build that was reverted - waiting for a newer one/);
  assert.deepEqual(bells, []);
  // A NEWER nightly appears -> the next due tick installs it.
  armPypi(NEWER_NIGHTLY);
  armSpawns('2026.08.18.010203');
  const again = engine.readState(dataDir);
  again.lastCheckAt = 1000;
  engine.writeState(dataDir, again);
  await ytdlp.engineAutoUpdateTick(deps, Date.now());
  await awaitJob();
  const healed = engine.readState(dataDir);
  assert.equal(healed.active, 'venv');
  assert.equal(healed.installed.version, NEWER_NIGHTLY);
  assert.deepEqual(bells, [{ event: 'updated', version: '2026.08.18.010203' }]);
});

test('boot reconcile: bundled intent is a no-op; a wanted-but-missing engine recovers async', async () => {
  assert.deepEqual(ytdlp.reconcileEngineAtBoot(deps), { action: 'none' });
  // The recovery installs latest STABLE (2026.7.4) - the probe must
  // self-report the zero-padded stable spelling or the health gate
  // (correctly) refuses to activate.
  armSpawns('2026.07.04');
  engine.setChannelIntent({ dataDir, channel: 'stable' });
  const r = ytdlp.reconcileEngineAtBoot(deps);
  assert.deepEqual(r, { action: 'queued' });
  await awaitJob();
  const state = engine.readState(dataDir);
  assert.equal(state.active, 'venv');
  assert.equal(state.installed.channel, 'stable');
});

test('boot reconcile: a healthy venv engine is left alone (no spurious reinstall)', async () => {
  armSpawns();
  engine.setChannelIntent({ dataDir, channel: 'nightly' });
  ytdlp.reconcileEngineAtBoot(deps);
  await awaitJob();
  cp.spawn = () => { throw new Error('a healthy reconcile must never spawn'); };
  assert.deepEqual(ytdlp.reconcileEngineAtBoot(deps), { action: 'none' });
});

test('armEngineTimer arms one interval, re-arming replaces it, and the accessor sees it', () => {
  const first = ytdlp.armEngineTimer(deps);
  assert.ok(first);
  assert.equal(ytdlp.currentEngineTimer(), first);
  const second = ytdlp.armEngineTimer(deps);
  assert.notEqual(second, first);
  assert.equal(ytdlp.currentEngineTimer(), second);
  clearInterval(second);
});
