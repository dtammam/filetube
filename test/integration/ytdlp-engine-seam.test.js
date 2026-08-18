'use strict';

// [INTEGRATION] the T3 spawn seam (v1.146 downloader-engine): run.js must
// resolve its binary through engine.activeBinaryPath() at spawn time, and
// its settled results must feed the engine's runtime failure net - the
// NARROW one. The revert triggers are exactly: spawn-level failure of the
// venv engine, or an import-time Python crash. A 403, a timeout, or any
// ordinary download failure must NEVER revert the admin's channel choice
// (the thrash-loop attack surface). Deleting the run.js seam or the settle
// screen turns these red.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const { EventEmitter } = require('node:events');
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

const engine = require('../../lib/ytdlp/engine');
const run = require('../../lib/ytdlp/run');

const originalSpawn = cp.spawn;
let dataDir;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-engine-seam-test-'));
  engine._resetForTests();
});

afterEach(() => {
  cp.spawn = originalSpawn;
  engine._resetForTests();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function fakeChild({ code = 0, stdout = '', stderr = '', errorEvent = null, neverClose = false } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => { setImmediate(() => child.emit('close', null, 'SIGKILL')); };
  setImmediate(() => {
    if (errorEvent) {
      child.emit('error', errorEvent);
      return;
    }
    if (neverClose) return;
    if (stdout) child.stdout.emit('data', Buffer.from(stdout));
    if (stderr) child.stderr.emit('data', Buffer.from(stderr));
    child.emit('close', code, null);
  });
  return child;
}

function captureSpawns(spec = {}) {
  const spawned = [];
  cp.spawn = (cmd, argv) => {
    spawned.push({ cmd, argv });
    return fakeChild(spec);
  };
  return spawned;
}

// Persist a venv-active nightly state WITH the venv binary present on disk
// (activeBinaryPath checks existence at the seam).
const NIGHTLY = '2026.8.17.73947.dev0';
function activateVenvState() {
  const bin = engine.resolveVenvBinaryPath(dataDir);
  fs.mkdirSync(path.dirname(bin), { recursive: true });
  fs.writeFileSync(bin, '#!fake engine');
  const state = engine.defaultState();
  state.channel = 'nightly';
  state.installed = { version: NIGHTLY, reported: '2026.08.17.073947', channel: 'nightly', installedAt: 1 };
  state.active = 'venv';
  engine.writeState(dataDir, state);
  return bin;
}

test('unbound runtime spawns the bare yt-dlp - the pre-wave default posture', async () => {
  const spawned = captureSpawns({ stdout: '2026.07.04\n' });
  const result = await run.spawnYtdlp(['--version'], { phaseLabel: 'version check' });
  assert.equal(result.ok, true);
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0].cmd, 'yt-dlp');
});

test('a bound runtime with a venv-active engine retargets BOTH spawn wrappers', async () => {
  engine.initRuntime({ dataDir });
  const bin = activateVenvState();
  const spawned = captureSpawns({ stdout: '2026.08.17.073947\n' });
  await run.spawnYtdlp(['--version'], { phaseLabel: 'version check' });
  await run.spawnYtdlpDownload(['--newline', 'https://example.com'], {});
  assert.deepEqual(spawned.map((s) => s.cmd), [bin, bin]);
});

test('venv-active state whose binary file is GONE falls back to bundled at the seam itself', async () => {
  engine.initRuntime({ dataDir });
  const bin = activateVenvState();
  fs.rmSync(bin);
  const spawned = captureSpawns({ stdout: '2026.07.04\n' });
  await run.spawnYtdlp(['--version'], { phaseLabel: 'version check' });
  assert.equal(spawned[0].cmd, 'yt-dlp');
});

test('spawn-level ENOENT of the ACTIVE venv engine auto-reverts to bundled and fires the callback', async () => {
  const reverts = [];
  engine.initRuntime({ dataDir, onAutoRevert: (info) => reverts.push(info) });
  activateVenvState();
  cp.spawn = () => fakeChild({ errorEvent: new Error('spawn /x/yt-dlp ENOENT') });
  const result = await run.spawnYtdlp(['--version'], { phaseLabel: 'version check' });
  assert.equal(result.ok, false);
  const state = engine.readState(dataDir);
  assert.equal(state.active, 'bundled');
  assert.equal(state.channel, 'nightly'); // the intent is never silently rewritten
  assert.equal(state.installed, null); // the distrusted venv cannot silently re-activate
  assert.equal(state.revert.fromVersion, NIGHTLY);
  assert.match(state.revert.reason, /ENOENT/);
  assert.equal(reverts.length, 1);
  assert.equal(reverts[0].fromVersion, NIGHTLY);
});

test('an import-time Python crash (ModuleNotFoundError traceback) auto-reverts too', async () => {
  const reverts = [];
  engine.initRuntime({ dataDir, onAutoRevert: (info) => reverts.push(info) });
  activateVenvState();
  captureSpawns({
    code: 1,
    stderr: 'Traceback (most recent call last):\n  File "/x/yt-dlp", line 5, in <module>\nModuleNotFoundError: No module named \'yt_dlp\'\n',
  });
  await run.spawnYtdlpDownload(['--newline', 'https://example.com'], {});
  assert.equal(engine.readState(dataDir).active, 'bundled');
  assert.equal(reverts.length, 1);
});

test('an ordinary download failure (403) NEVER reverts the channel choice', async () => {
  const reverts = [];
  engine.initRuntime({ dataDir, onAutoRevert: (info) => reverts.push(info) });
  activateVenvState();
  captureSpawns({
    code: 1,
    stderr: 'ERROR: unable to download video data: HTTP Error 403: Forbidden\n',
  });
  const result = await run.spawnYtdlpDownload(['--newline', 'https://example.com'], {});
  assert.equal(result.ok, false);
  const state = engine.readState(dataDir);
  assert.equal(state.active, 'venv'); // still the admin's engine
  assert.equal(state.revert, null);
  assert.equal(reverts.length, 0);
});

test('a timeout kill NEVER reverts either (slow video != broken engine)', async () => {
  engine.initRuntime({ dataDir });
  activateVenvState();
  captureSpawns({ neverClose: true });
  // run.js's timeout timer is (correctly) unref'd - a REAL child keeps the
  // event loop alive, but this fake one does not, so the test holds its own
  // ref long enough for the 30ms budget to fire.
  const keepAlive = setTimeout(() => {}, 5000);
  const result = await run.spawnYtdlp(['--version'], { timeoutMs: 30, phaseLabel: 'version check' });
  clearTimeout(keepAlive);
  assert.equal(result.code, 'ETIMEDOUT');
  assert.equal(engine.readState(dataDir).active, 'venv');
});

test('a crash of the BUNDLED engine records no revert (nothing to revert to)', async () => {
  const reverts = [];
  engine.initRuntime({ dataDir, onAutoRevert: (info) => reverts.push(info) });
  // default state: bundled active
  cp.spawn = () => fakeChild({ errorEvent: new Error('spawn yt-dlp ENOENT') });
  await run.spawnYtdlp(['--version'], { phaseLabel: 'version check' });
  const state = engine.readState(dataDir);
  assert.equal(state.active, 'bundled');
  assert.equal(state.revert, null);
  assert.equal(reverts.length, 0);
});
