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

function fakeChild({ code = 0, stdout = '', stderr = '', neverClose = false, errorEvent = null } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => { setImmediate(() => child.emit('close', null, 'SIGKILL')); };
  setImmediate(() => {
    if (errorEvent) { child.emit('error', errorEvent); return; }
    if (neverClose) return; // held open until the test closes it explicitly
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

// ---------------------------------------------------------------------------
// Gate round 1 fixes: the FIFO-gate binding (adversarial W1), the
// startBackground wiring (adversarial W2), and the reconcile heals
// (both seats' W5/QA W1 mismatch + QA W2 state honesty).
// ---------------------------------------------------------------------------

test('adversarial W1: an engine install queued behind a held FIFO job does NOT touch the venv until the gate frees', async () => {
  armSpawns();
  engine.setAutoUpdate({ dataDir, enabled: true });
  engine.setChannelIntent({ dataDir, channel: 'nightly' });
  // Hold the gate open with a foreign heavy job (a 3h download stand-in).
  let releaseBlocker;
  const blocker = ytdlp.runExclusive(
    () => new Promise((resolve) => { releaseBlocker = resolve; }),
    { kind: 'channel', label: 'blocker-download' }
  );
  const r = await ytdlp.engineAutoUpdateTick(deps, Date.now());
  assert.deepEqual(r, { queued: true });
  // The job must sit QUEUED behind the blocker with the venv untouched -
  // the mutant that drops the runExclusive wrapper runs it immediately.
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ytdlp.currentEngineJob().status, 'queued');
  assert.equal(fs.existsSync(engine.resolveVenvDir(dataDir)), false, 'the venv must not be touched while the gate is held');
  releaseBlocker();
  await blocker;
  await awaitJob();
  assert.equal(engine.readState(dataDir).installed.version, NIGHTLY, 'the install completes after the gate frees');
});

test('adversarial W2: startBackground itself binds the seam, reconciles, and arms the daily gate', async () => {
  const prevEnv = {
    FILETUBE_YTDLP_ENABLED: process.env.FILETUBE_YTDLP_ENABLED,
    FILETUBE_YTDLP_POLL_MINUTES: process.env.FILETUBE_YTDLP_POLL_MINUTES,
    FILETUBE_READ_ONLY_MEDIA: process.env.FILETUBE_READ_ONLY_MEDIA,
    FILETUBE_YTDLP_DOWNLOAD_DIR: process.env.FILETUBE_YTDLP_DOWNLOAD_DIR,
  };
  process.env.FILETUBE_YTDLP_ENABLED = 'true';
  process.env.FILETUBE_YTDLP_POLL_MINUTES = '0';
  process.env.FILETUBE_READ_ONLY_MEDIA = '1'; // skips boot migration/requeue - this test binds the ENGINE lines
  process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = path.join(dataDir, 'dl');
  try {
    armSpawns();
    engine.setChannelIntent({ dataDir, channel: 'nightly' }); // wanted engine, venv missing
    engine._resetForTests(); // startBackground must do the binding itself
    ytdlp.startBackground({
      updateDatabase: async () => {},
      loadDatabase: () => ({ ytdlp: { subscriptions: [] }, settings: {}, metadata: {} }),
      scanDirectories: async () => {},
      getMediaId: () => 'x',
      dataDir,
      recordEngineEvent: (event, version) => bells.push({ event, version }),
    });
    assert.ok(ytdlp.currentEngineTimer(), 'the daily gate timer is armed by startBackground');
    await awaitJob();
    const state = engine.readState(dataDir);
    assert.equal(state.active, 'venv', 'boot recovery installed the wanted engine');
    assert.equal(state.installed.channel, 'nightly');
    // And the seam is bound: run.js would now resolve the venv binary.
    assert.equal(engine.activeBinaryPath(), engine.resolveVenvBinaryPath(dataDir));
  } finally {
    const t = ytdlp.currentEngineTimer();
    if (t) clearInterval(t);
    for (const [k, v] of Object.entries(prevEnv)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});

test('W5 heal: boot reconcile treats an installed-channel/intent mismatch as unhealthy and recovers', async () => {
  armSpawns();
  engine.setChannelIntent({ dataDir, channel: 'nightly' });
  ytdlp.reconcileEngineAtBoot(deps);
  await awaitJob();
  // Simulate the half-applied switch (or a restored older state file):
  // intent stable, installed nightly, venv binary present.
  const state = engine.readState(dataDir);
  state.channel = 'stable';
  engine.writeState(dataDir, state);
  armSpawns('2026.07.04'); // the recovery installs latest STABLE
  const r = ytdlp.reconcileEngineAtBoot(deps);
  assert.deepEqual(r, { action: 'queued' }, 'mismatch is NOT healthy');
  await awaitJob();
  const healed = engine.readState(dataDir);
  assert.equal(healed.installed.channel, 'stable');
  assert.equal(healed.channel, 'stable');
});

test('QA W2 heal: a venv-active state whose binary is GONE is repaired to bundled BEFORE the recovery (PyPI down)', async () => {
  armSpawns();
  engine.setChannelIntent({ dataDir, channel: 'nightly' });
  ytdlp.reconcileEngineAtBoot(deps);
  await awaitJob();
  fs.rmSync(engine.resolveVenvBinaryPath(dataDir));
  // PyPI unreachable: the recovery install will dead-end - the state must
  // already be honest by then.
  engine._setFetchImplForTests(() => Promise.reject(new Error('getaddrinfo ENOTFOUND pypi.org')));
  const r = ytdlp.reconcileEngineAtBoot(deps);
  assert.deepEqual(r, { action: 'queued' });
  const repaired = engine.readState(dataDir);
  assert.equal(repaired.active, 'bundled', 'repaired synchronously, not after the async recovery');
  assert.equal(repaired.installed, null);
  assert.equal(repaired.revert, null, 'a repair is not a revert - no false alarm');
  await awaitJob();
  const after = engine.readState(dataDir);
  assert.equal(after.active, 'bundled');
  assert.match(after.lastResult.message, /ENOTFOUND|unreachable/);
});

test('adversarial round 2 W-WIRE: the REAL initRuntime wiring suppresses failure reports mid-install (through startBackground)', async () => {
  const run = require('../../lib/ytdlp/run');
  const prevEnv = {
    FILETUBE_YTDLP_ENABLED: process.env.FILETUBE_YTDLP_ENABLED,
    FILETUBE_YTDLP_POLL_MINUTES: process.env.FILETUBE_YTDLP_POLL_MINUTES,
    FILETUBE_READ_ONLY_MEDIA: process.env.FILETUBE_READ_ONLY_MEDIA,
    FILETUBE_YTDLP_DOWNLOAD_DIR: process.env.FILETUBE_YTDLP_DOWNLOAD_DIR,
  };
  process.env.FILETUBE_YTDLP_ENABLED = 'true';
  process.env.FILETUBE_YTDLP_POLL_MINUTES = '0';
  process.env.FILETUBE_READ_ONLY_MEDIA = '1';
  process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = path.join(dataDir, 'dl');
  const venvBin = path.join(dataDir, 'ytdlp-engine', 'venv', 'bin');
  let releasePip = null;
  let pipDone = false;
  try {
    // Bind the runtime through the REAL wiring (deleting isInstallActive
    // from index.js's initRuntime call sites turns this test red).
    armSpawns();
    engine.setChannelIntent({ dataDir, channel: 'nightly' });
    engine.setAutoUpdate({ dataDir, enabled: true });
    engine._resetForTests();
    ytdlp.startBackground({
      updateDatabase: async () => {}, loadDatabase: () => ({ ytdlp: { subscriptions: [] }, settings: {}, metadata: {} }),
      scanDirectories: async () => {}, getMediaId: () => 'x', dataDir,
      recordEngineEvent: (event, version) => bells.push({ event, version }),
    });
    await awaitJob(); // boot recovery completes: venv active
    assert.equal(engine.readState(dataDir).active, 'venv');
    bells.length = 0;
    // Now an UPDATE whose pip HOLDS mid-install, with a newer build offered.
    armPypi(NEWER_NIGHTLY);
    cp.spawn = (cmd, argv) => {
      if (cmd === 'python3' && argv[0] === '--version') return fakeChild({ stdout: 'Python 3.12.9\n' });
      if (cmd === 'python3' && argv[1] === 'venv') {
        fs.mkdirSync(venvBin, { recursive: true });
        fs.writeFileSync(path.join(venvBin, 'python'), '#!fake');
        fs.writeFileSync(path.join(venvBin, 'pip'), '#!fake');
        return fakeChild({});
      }
      if (cmd.endsWith(path.join('bin', 'pip'))) {
        const child = fakeChild({ neverClose: true });
        releasePip = () => {
          pipDone = true;
          fs.writeFileSync(path.join(venvBin, 'yt-dlp'), '#!fake');
          child.emit('close', 0, null);
        };
        return child;
      }
      if (cmd.endsWith(path.join('bin', 'yt-dlp'))) {
        // While pip is still rewriting the venv, its binary fails to spawn
        // - the exact measured race. After release: the healthy probe.
        if (pipDone) return fakeChild({ stdout: '2026.08.18.010203\n' });
        return fakeChild({ errorEvent: new Error('spawn ENOENT (half-written venv)') });
      }
      if (cmd === 'yt-dlp') return fakeChild({ stdout: '2026.8.10.11111.dev0\n' });
      throw new Error(`unexpected spawn in wire test: ${cmd} ${argv.join(' ')}`);
    };
    await ytdlp.engineAutoUpdateTick(deps, Date.now() + ytdlp.ENGINE_AUTO_UPDATE_INTERVAL_MS + 1);
    // Wait until pip has actually spawned and is being HELD open.
    await new Promise((resolve) => {
      const check = () => (releasePip !== null ? resolve() : setImmediate(check));
      check();
    });
    assert.equal(ytdlp.currentEngineJob().status, 'installing');
    // The race: an ungated spawn fails against the mid-rewrite venv. With
    // the REAL wire, this must be suppressed - no revert, no bell.
    const raceResult = await run.spawnYtdlp(["--version"], { phaseLabel: "version check" });
    assert.equal(raceResult.ok, false);
    assert.equal(engine.readState(dataDir).active, 'venv', 'no revert while the install rewrites the venv');
    assert.equal(bells.filter((b) => b.event === 'reverted').length, 0, 'no false alarm bell');
    // Release pip; the install completes, probes healthy, activates.
    releasePip();
    await awaitJob();
    const state = engine.readState(dataDir);
    assert.equal(state.active, 'venv');
    assert.equal(state.installed.version, NEWER_NIGHTLY);
    assert.deepEqual(bells, [{ event: 'updated', version: '2026.08.18.010203' }]);
  } finally {
    if (releasePip) { try { releasePip(); } catch (_) { /* already released */ } }
    const t = ytdlp.currentEngineTimer();
    if (t) clearInterval(t);
    for (const [k, v] of Object.entries(prevEnv)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});
