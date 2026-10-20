'use strict';

// [INTEGRATION] v1.392.0 (plan 2026-10-20-download-hang, R7): a yt-dlp whose HELPER outlives it must never wedge
// the download queue. Through the REAL `child_process.spawn` (no spawn monkey-patch): a fake `yt-dlp` shell
// script on PATH forks a grandchild (`sleep 600 &`) that inherits stdout/stderr and so holds the pipes open,
// exactly like an ffmpeg merge or the node challenge solver yt-dlp leaves behind. Before v1.392.0 the spawners
// settled ONLY on the child's 'close', which waits for EVERY holder of the pipes: the promise never settled, the
// heavy gate never released, and only a container recreate cleared it.
//
// Each case asserts the promise settles within grace + slack, the grandchild is DEAD afterwards, and (for the
// queue cases) the next job runs. The `escaped holder` cases use `setsid` so the grandchild leaves yt-dlp's
// process group: the group kill (R2) cannot reach it, so ONLY the exit/kill + grace settle (R1) can free the job.
// Those are the cases that bind R1; the same-group cases bind R2 (the grandchild must be dead).

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const express = require('express');

const run = require('../../lib/ytdlp/run');
const heavyGate = require('../../lib/heavyGate');
const ytdlp = require('../../lib/ytdlp');
const ytdlpStoreModule = require('../../lib/ytdlp/store');
const { featureStoreFor, docView } = require('../helpers/scratch-feature-store');

const SLACK_MS = 3000;
const TEST_GRACE_MS = 400;

let binDir;
let workDir;
let originalPath;
const originalConsoleError = console.error;
const originalProbeChannel = run.probeChannel;

// The fake yt-dlp. Each invocation takes the next mode from `$FAKE_YTDLP_DIR/modes` (one per line) and appends
// every grandchild pid it starts to `$FAKE_YTDLP_DIR/pids`, so the test can check them and clean them up.
const FAKE_SCRIPT = `#!/bin/sh
d="$FAKE_YTDLP_DIR"
n=$(cat "$d/count" 2>/dev/null || echo 0)
n=$((n + 1))
echo "$n" > "$d/count"
mode=$(sed -n "\${n}p" "$d/modes")
[ -z "$mode" ] && mode=ok
case "$mode" in
  exit-linger)
    sleep 600 &
    echo $! >> "$d/pids"
    echo "[download] 100% of 1.00MiB"
    exit 0 ;;
  hang-linger)
    sleep 600 &
    echo $! >> "$d/pids"
    echo "[download]   1.0% of 1.00MiB"
    wait ;;
  escape-exit)
    setsid sleep 600 &
    g=$!
    echo $g >> "$d/pids"
    # wait until the helper has really left this group (else the exit group kill can still reach it)
    i=0; while [ "$(ps -o pgid= -p $g | tr -d ' ')" = "$(ps -o pgid= -p $$ | tr -d ' ')" ] && [ $i -lt 50 ]; do sleep 0.02; i=$((i + 1)); done
    echo "[download] 100% of 1.00MiB"
    exit 0 ;;
  escape-hang)
    setsid sleep 600 &
    g=$!
    echo $g >> "$d/pids"
    # wait until the helper has really left this group (else the exit group kill can still reach it)
    i=0; while [ "$(ps -o pgid= -p $g | tr -d ' ')" = "$(ps -o pgid= -p $$ | tr -d ' ')" ] && [ $i -lt 50 ]; do sleep 0.02; i=$((i + 1)); done
    echo "[download]   1.0% of 1.00MiB"
    wait ;;
  ignore-term-hang)
    trap '' TERM
    echo $$ >> "$d/pids"
    sleep 600 &
    echo $! >> "$d/pids"
    echo "[download]   1.0% of 1.00MiB"
    wait ;;
  *)
    exit 0 ;;
esac
`;

function setModes(modes) {
  fs.writeFileSync(path.join(workDir, 'modes'), `${modes.join('\n')}\n`);
  fs.rmSync(path.join(workDir, 'count'), { force: true });
  fs.rmSync(path.join(workDir, 'pids'), { force: true });
}

function invocations() {
  try { return Number(fs.readFileSync(path.join(workDir, 'count'), 'utf8').trim()) || 0; } catch (_) { return 0; }
}

function grandchildPids() {
  let raw = '';
  try { raw = fs.readFileSync(path.join(workDir, 'pids'), 'utf8'); } catch (_) { return []; }
  return raw.split('\n').map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0);
}

// Alive = the pid exists and is not a zombie (a reaped-later zombie still answers kill(pid, 0)).
function isAlive(pid) {
  try { process.kill(pid, 0); } catch (err) { return err.code !== 'ESRCH'; }
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const state = stat.slice(stat.lastIndexOf(')') + 2, stat.lastIndexOf(')') + 3);
    return state !== 'Z' && state !== 'X';
  } catch (_) {
    return false;
  }
}

async function waitDead(pid, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return !isAlive(pid);
}

function killStragglers() {
  for (const pid of grandchildPids()) {
    try { process.kill(pid, 'SIGKILL'); } catch (_) { /* gone */ }
  }
}

// Settles with the promise's value, or with the HANG sentinel once `ms` passes.
const HANG = Symbol('hang');
function within(promise, ms) {
  let t;
  return Promise.race([
    promise.finally(() => clearTimeout(t)),
    new Promise((resolve) => { t = setTimeout(() => resolve(HANG), ms); }),
  ]);
}

before(() => {
  binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-fake-ytdlp-bin-'));
  fs.writeFileSync(path.join(binDir, 'yt-dlp'), FAKE_SCRIPT, { mode: 0o755 });
  originalPath = process.env.PATH;
  process.env.PATH = `${binDir}${path.delimiter}${originalPath}`;
});

after(() => {
  process.env.PATH = originalPath;
  fs.rmSync(binDir, { recursive: true, force: true });
});

beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-fake-ytdlp-run-'));
  process.env.FAKE_YTDLP_DIR = workDir;
  console.error = () => {};
});

afterEach(() => {
  killStragglers();
  console.error = originalConsoleError;
  run.probeChannel = originalProbeChannel;
  delete process.env.FAKE_YTDLP_DIR;
  fs.rmSync(workDir, { recursive: true, force: true });
});

// ---- the download spawner ----------------------------------------------------------------------------------

test('download: yt-dlp exits but a grandchild in its group holds the pipes -> settles, and the grandchild is killed', async () => {
  setModes(['exit-linger']);
  const result = await within(run.spawnYtdlpDownload(['x'], { exitGraceMs: TEST_GRACE_MS }), TEST_GRACE_MS + SLACK_MS);
  assert.notEqual(result, HANG, 'the download promise never settled: a grandchild holding the pipes wedged it');
  assert.equal(result.ok, true, 'a clean exit is still a success');
  assert.equal(result.code, 0);
  const pids = grandchildPids();
  assert.equal(pids.length, 1);
  assert.ok(await waitDead(pids[0], 1000), `the grandchild ${pids[0]} must not outlive the job (group kill after exit)`);
});

test('download: the stall watchdog kills a hung yt-dlp whose grandchild holds the pipes -> settles ESTALLED, grandchild dead', async () => {
  setModes(['hang-linger']);
  const result = await within(run.spawnYtdlpDownload(['x'], { stallMs: 300, exitGraceMs: TEST_GRACE_MS }), 300 + TEST_GRACE_MS + SLACK_MS);
  assert.notEqual(result, HANG, 'a stall kill never settled the job');
  assert.equal(result.ok, false);
  assert.equal(result.code, 'ESTALLED', 'the stalled flag still names the reason');
  const pids = grandchildPids();
  assert.equal(pids.length, 1);
  assert.ok(await waitDead(pids[0], 1000), 'the stall kill must kill the whole group, grandchild included');
});

test('download: the absolute timeout kills a hung yt-dlp whose grandchild holds the pipes -> settles ETIMEDOUT, grandchild dead', async () => {
  setModes(['hang-linger']);
  const result = await within(run.spawnYtdlpDownload(['x'], { timeoutMs: 300, exitGraceMs: TEST_GRACE_MS }), 300 + TEST_GRACE_MS + SLACK_MS);
  assert.notEqual(result, HANG, 'a timeout kill never settled the job');
  assert.equal(result.ok, false);
  assert.equal(result.code, 'ETIMEDOUT');
  const pids = grandchildPids();
  assert.ok(await waitDead(pids[0], 1000), 'the timeout kill must kill the whole group, grandchild included');
});

test('download: a helper that ESCAPED the group (setsid) still cannot wedge the job: exit + grace settles it (settledBy exit-grace)', async () => {
  setModes(['escape-exit']);
  const started = Date.now();
  let child = null;
  const traced = [];
  const result = await within(run.spawnYtdlpDownload(['x'], { exitGraceMs: TEST_GRACE_MS, onChild: (c) => { child = c; }, onTrace: (ev, f) => traced.push([ev, f]) }), TEST_GRACE_MS + SLACK_MS);
  assert.notEqual(result, HANG, 'only the exit + grace settle can free a job whose pipe holder left the group');
  assert.ok(Date.now() - started >= TEST_GRACE_MS - 50, 'the grace period is honoured before giving up on close');
  assert.equal(result.ok, true);
  assert.equal(result.code, 0);
  assert.equal(result.settledBy, 'exit-grace');
  assert.ok(child.stdout.destroyed && child.stderr.destroyed, 'the late pipes are destroyed (no fds held for the escaped helper)');
  const settle = traced.filter(([ev]) => ev === 'settle');
  assert.equal(settle.length, 1);
  assert.equal(settle[0][1].groupSurvivors, false, 'at the exit the group was already empty: the holder had left it');
  assert.ok(!run.liveGroupsForTests().includes(child.pid), 'a settled, exited run leaves the server-exit list');
});

test('download: a Cancel AFTER yt-dlp exited never signals its (reaped) group again', async () => {
  setModes(['escape-exit']);
  let child = null;
  const settled = run.spawnYtdlpDownload(['x'], { exitGraceMs: TEST_GRACE_MS, onChild: (c) => { child = c; } });
  await waitFor(() => child && child.exitCode !== null, 3000);
  const originalKill = process.kill;
  const negative = [];
  // Records group signals and forwards only one aimed at this job's own group (never anything else).
  process.kill = (pid, sig) => {
    if (pid < 0) {
      negative.push(pid);
      if (-pid !== child.pid) return true;
    }
    return originalKill.call(process, pid, sig);
  };
  try {
    run.killYtdlp(child, 'SIGKILL');
  } finally {
    process.kill = originalKill;
  }
  assert.deepEqual(negative, [], 'the exit-time group kill already ran; a later kill sends no group signal');
  assert.equal((await within(settled, TEST_GRACE_MS + SLACK_MS)).settledBy, 'exit-grace');
});

// A FAKE child's pid must be a SACRIFICIAL process, never a made-up number: with this guard mutated away the code
// group-kills the fake's pid, and a fixture of pid 1 turned that mutant into process.kill(-1, 'SIGKILL'), which
// killed every process the user owned (v1.392.0 build: twice, every session on the box). So the fake carries the
// pid of a detached `sleep` (its own process group, nothing else in it), the mutant can only kill that sleeper,
// and the spy forwards only signals aimed at the sleeper's own group.
test('download: a fake child (not a real ChildProcess) is never group-killed (a sacrificial sleeper stays alive)', async () => {
  const cp = require('node:child_process');
  const { EventEmitter } = require('node:events');
  const sleeper = cp.spawn('sleep', ['600'], { detached: true, stdio: 'ignore' });
  assert.ok(Number.isInteger(sleeper.pid) && sleeper.pid > 1, 'the sacrificial sleeper started');
  const originalSpawn = cp.spawn;
  const originalKill = process.kill;
  const groupSignals = [];
  cp.spawn = () => {
    const fake = new EventEmitter();
    fake.stdout = new EventEmitter(); fake.stderr = new EventEmitter();
    fake.pid = sleeper.pid;
    fake.kill = () => { setImmediate(() => { fake.emit('exit', null, 'SIGKILL'); fake.emit('close', null, 'SIGKILL'); }); };
    setImmediate(() => fake.emit('exit', 0, null));
    setImmediate(() => fake.emit('close', 0, null));
    return fake;
  };
  process.kill = (pid, sig) => {
    if (pid < 0) {
      groupSignals.push(pid);
      if (-pid !== sleeper.pid) return true; // never forward a group signal to anything but the sleeper
    }
    return originalKill.call(process, pid, sig);
  };
  try {
    const result = await within(run.spawnYtdlpDownload(['x'], { exitGraceMs: TEST_GRACE_MS }), SLACK_MS);
    assert.notEqual(result, HANG);
    assert.equal(result.ok, true);
    await new Promise((r) => setTimeout(r, 100));
    assert.ok(isAlive(sleeper.pid), 'the sacrificial sleeper is alive: the fake child was never group-killed');
    assert.deepEqual(groupSignals, [], 'only a real, spawned ChildProcess is ever signalled as a group');
  } finally {
    cp.spawn = originalSpawn;
    process.kill = originalKill;
    try { process.kill(sleeper.pid, 'SIGKILL'); } catch (_) { /* gone */ }
  }
});

test('download: a stall kill whose pipe holder escaped the group settles at exit + grace, still ESTALLED', async () => {
  setModes(['escape-hang']);
  const result = await within(run.spawnYtdlpDownload(['x'], { stallMs: 300, exitGraceMs: TEST_GRACE_MS }), 300 + TEST_GRACE_MS + SLACK_MS);
  assert.notEqual(result, HANG);
  assert.equal(result.code, 'ESTALLED', 'the stalled flag survives a settle without close');
  assert.equal(result.settledBy, 'exit-grace', 'the group kill ended yt-dlp itself; only the escaped helper held the pipes');
});

test('download: a kill that never ends the process (it ignores the signal) settles at kill + grace (settledBy kill-grace)', async () => {
  setModes(['ignore-term-hang']);
  const started = Date.now();
  const result = await within(run.spawnYtdlpDownload(['x'], { stallMs: 300, killSignal: 'SIGTERM', exitGraceMs: TEST_GRACE_MS }), 300 + TEST_GRACE_MS + SLACK_MS);
  assert.notEqual(result, HANG, 'a kill whose process never exits must still settle the job');
  assert.ok(Date.now() - started >= 300 + TEST_GRACE_MS - 50, 'it waited the grace period after the kill');
  assert.equal(result.code, 'ESTALLED');
  assert.equal(result.settledBy, 'kill-grace');
});

test('download: kill + grace reports groupSurvivors unknown (null), and the never-exited group stays on the server-exit list until it exits', async () => {
  setModes(['ignore-term-hang']);
  let child = null;
  const traced = [];
  const result = await within(run.spawnYtdlpDownload(['x'], { stallMs: 300, killSignal: 'SIGTERM', exitGraceMs: TEST_GRACE_MS, onChild: (c) => { child = c; }, onTrace: (ev, f) => traced.push([ev, f]) }), 300 + TEST_GRACE_MS + SLACK_MS);
  assert.equal(result.settledBy, 'kill-grace');
  const settle = traced.find(([ev]) => ev === 'settle');
  assert.equal(settle[1].groupSurvivors, null, 'a kill-time signal says nothing about helpers: unknown');
  assert.ok(run.liveGroupsForTests().includes(child.pid), 'still alive, so the server exit must still kill it');
  const exited = new Promise((r) => child.once('exit', r));
  process.kill(-child.pid, 'SIGKILL');
  await within(exited, SLACK_MS);
  assert.ok(!run.liveGroupsForTests().includes(child.pid), 'it leaves the list once it really exits');
});

test('download: a normal exit with no lingering helper still settles on close (no settledBy, no grace wait)', async () => {
  setModes(['ok']);
  const started = Date.now();
  const result = await within(run.spawnYtdlpDownload(['x'], { exitGraceMs: 5000 }), SLACK_MS);
  assert.notEqual(result, HANG);
  assert.equal(result.ok, true);
  assert.equal(result.settledBy, undefined, 'a close settle carries no settledBy (callers unchanged)');
  assert.ok(Date.now() - started < 2000, 'a clean close never waits for the grace period');
});

// ---- the list spawner --------------------------------------------------------------------------------------

test('list: the timeout kills a hung yt-dlp whose grandchild holds the pipes -> settles ETIMEDOUT, grandchild dead', async () => {
  setModes(['hang-linger']);
  const result = await within(run.spawnYtdlp(['x'], { timeoutMs: 300, exitGraceMs: TEST_GRACE_MS }), 300 + TEST_GRACE_MS + SLACK_MS);
  assert.notEqual(result, HANG, 'a list timeout kill never settled');
  assert.equal(result.ok, false);
  assert.equal(result.code, 'ETIMEDOUT');
  const pids = grandchildPids();
  assert.ok(await waitDead(pids[0], 1000), 'the list timeout must kill the whole group');
});

test('list: yt-dlp exits but a grandchild holds the pipes -> settles with its stdout, grandchild killed', async () => {
  setModes(['exit-linger']);
  const result = await within(run.spawnYtdlp(['x'], { exitGraceMs: TEST_GRACE_MS }), TEST_GRACE_MS + SLACK_MS);
  assert.notEqual(result, HANG);
  assert.equal(result.ok, true);
  assert.match(result.stdout, /100% of 1\.00MiB/, 'the stdout read before the settle is kept');
  assert.ok(await waitDead(grandchildPids()[0], 1000));
});

test('list: a helper that escaped the group settles at exit + grace, and the late pipes are destroyed', async () => {
  setModes(['escape-exit']);
  const cp = require('node:child_process');
  const originalSpawn = cp.spawn;
  let child = null;
  cp.spawn = (...a) => { child = originalSpawn(...a); return child; };
  let result;
  try {
    result = await within(run.spawnYtdlp(['x'], { exitGraceMs: TEST_GRACE_MS }), TEST_GRACE_MS + SLACK_MS);
  } finally {
    cp.spawn = originalSpawn;
  }
  assert.notEqual(result, HANG);
  assert.equal(result.ok, true);
  assert.equal(result.settledBy, 'exit-grace');
  assert.ok(child.stdout.destroyed && child.stderr.destroyed, 'the late pipes are destroyed');
});

// ---- the heavy gate (R4): a job whose child never closes its pipes releases the queue ----------------------

test('heavy gate: a job whose pipe holder escaped the group releases the gate, and the next queued job runs', async () => {
  setModes(['escape-exit', 'ok']);
  const first = heavyGate.runExclusive(() => run.spawnYtdlpDownload(['x'], { exitGraceMs: TEST_GRACE_MS }));
  const second = heavyGate.runExclusive(() => run.spawnYtdlpDownload(['x'], { exitGraceMs: TEST_GRACE_MS }));
  const both = await within(Promise.all([first, second]), TEST_GRACE_MS * 2 + SLACK_MS);
  assert.notEqual(both, HANG, 'the gate stayed held by the wedged first job');
  assert.equal(invocations(), 2, 'the queued job ran');
  assert.equal(both[1].ok, true);
});

// ---- cancel through the real route (R2: both cancel routes use the group kill) -----------------------------

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

async function startTestApp(deps, config) {
  const app = express();
  app.use(express.json());
  ytdlp.registerRoutes(app, deps, config);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: async () => {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function postJson(base, urlPath, body) {
  return fetch(`${base}${urlPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function waitFor(fn, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

// The cancel routes must kill through `run.killYtdlp` (the group kill that also arms the kill + grace settle). A
// plain `child.kill` is MASKED in the grandchild assertions: yt-dlp dies, and the exit-time group kill takes the
// grandchild anyway; what it loses is the kill + grace settle for a process the kill cannot end (D state), which
// no fake can reproduce. So each cancel case also spies the wiring (it delegates, so the real kill still runs).
function spyKillYtdlp() {
  const original = run.killYtdlp;
  const calls = [];
  run.killYtdlp = (child, signal, why) => {
    calls.push({ pid: child && child.pid, signal });
    return original(child, signal, why);
  };
  return { calls, restore: () => { run.killYtdlp = original; } };
}

test('one-off Cancel: kills the yt-dlp group (grandchild dead), the job settles, and the one-off queued behind it runs', async () => {
  run.probeChannel = async () => null;
  setModes(['hang-linger', 'ok']);
  const dlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-fake-ytdlp-dl-'));
  const deps = makeFakeDeps();
  const config = ytdlp.parseYtdlpConfig({
    FILETUBE_YTDLP_ENABLED: 'true',
    FILETUBE_YTDLP_POLL_MINUTES: '0',
    FILETUBE_YTDLP_DOWNLOAD_DIR: dlDir,
  });
  const { base, close } = await startTestApp(deps, config);
  const status = async () => (await (await fetch(`${base}/api/subscriptions/status`)).json()).oneShots || {};
  try {
    const r1 = await postJson(base, '/api/ytdlp/download', { url: 'https://youtu.be/dQw4w9WgXcQ' });
    assert.equal(r1.status, 202);
    const { jobId: first } = await r1.json();
    assert.ok(await waitFor(() => grandchildPids().length === 1, 5000), 'the first job spawned its yt-dlp and grandchild');
    const r2 = await postJson(base, '/api/ytdlp/download', { url: 'https://youtu.be/9bZkp7q19f0' });
    assert.equal(r2.status, 202);
    const { jobId: second } = await r2.json();

    const spy = spyKillYtdlp();
    let cancel;
    try { cancel = await postJson(base, `/api/ytdlp/download/${first}/cancel`); } finally { spy.restore(); }
    assert.equal(cancel.status, 200);
    assert.equal(spy.calls.length, 1, 'the one-off cancel route kills through run.killYtdlp');
    assert.equal(spy.calls[0].signal, 'SIGKILL');
    assert.ok(await waitDead(grandchildPids()[0], 2000), 'Cancel must kill the whole yt-dlp group, grandchild included');
    const ran = await waitFor(async () => invocations() === 2 && ['done', 'error'].includes((await status())[second]?.state), 5000 + SLACK_MS);
    assert.ok(ran, `the one-off queued behind the cancelled one never ran (invocations=${invocations()}, state=${(await status())[second]?.state})`);
    assert.equal((await status())[first].state, 'cancelled');
  } finally {
    killStragglers();
    await close();
    fs.rmSync(dlDir, { recursive: true, force: true });
  }
});

test('playlist Cancel: kills the running video\'s yt-dlp group (grandchild dead) and the job settles', async () => {
  run.probeChannel = async () => null;
  setModes(['hang-linger']);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-fake-ytdlp-data-'));
  const dlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-fake-ytdlp-dl-'));
  const deps = { ...makeFakeDeps(), dataDir };
  const config = ytdlp.parseYtdlpConfig({ FILETUBE_YTDLP_ENABLED: 'true', FILETUBE_YTDLP_POLL_MINUTES: '0', FILETUBE_YTDLP_DOWNLOAD_DIR: dlDir });
  const { base, close } = await startTestApp(deps, config);
  const status = async () => (await (await fetch(`${base}/api/subscriptions/status`)).json()).oneShots || {};
  try {
    const r = await postJson(base, '/api/ytdlp/download-playlist', { listId: 'PLUtyNbQXMTLg', title: 'Hang', ids: ['vid00000001', 'vid00000002'], format: 'video', quality: 'best' });
    assert.equal(r.status, 202);
    const { jobId } = await r.json();
    assert.ok(await waitFor(() => grandchildPids().length === 1, 5000), 'the first video spawned yt-dlp and its grandchild');
    const spy = spyKillYtdlp();
    let cancel;
    try { cancel = await postJson(base, `/api/ytdlp/download/${jobId}/cancel`); } finally { spy.restore(); }
    assert.equal(cancel.status, 200);
    assert.equal(spy.calls.length, 1, 'the playlist cancel kills the running video through run.killYtdlp');
    assert.ok(await waitDead(grandchildPids()[0], 2000), 'Cancel must kill the running video\'s whole yt-dlp group');
    assert.ok(await waitFor(async () => invocations() === 1 && (await status())[jobId]?.state === 'cancelled', SLACK_MS), 'the playlist job settles as cancelled and spawns nothing more');
  } finally {
    killStragglers();
    await close();
    fs.rmSync(dlDir, { recursive: true, force: true });
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

// ---- both subscription cancel routes (index.js: stop-all and single) through the real spawn ------------------

const runlog = require('../../lib/ytdlp/runlog');
const oneshotTrace = require('../../lib/ytdlp/oneshotTrace');
const store = require('../../lib/ytdlp/store');
const originalRunList = run.runList;

async function startSubscriptionDownload(dataDir) {
  const dlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-fake-ytdlp-dl-'));
  const deps = { ...makeFakeDeps(), dataDir };
  const config = ytdlp.parseYtdlpConfig({
    FILETUBE_YTDLP_ENABLED: 'true',
    FILETUBE_YTDLP_POLL_MINUTES: '0',
    FILETUBE_YTDLP_DOWNLOAD_DIR: dlDir,
  });
  const sub = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@somechannel', format: 'video', quality: 'best' });
  run.runList = async () => ({ ok: true, stdout: JSON.stringify({ id: 'survivor1', availability: 'public' }), stderr: '' });
  const app = await startTestApp(deps, config);
  const poll = ytdlp.runPoll(deps, config);
  return { deps, config, sub, app, poll, dlDir };
}

for (const route of ['single', 'stop-all']) {
  test(`subscription Cancel (${route}): kills the yt-dlp group (grandchild dead) and the poll settles`, async () => {
    setModes(['hang-linger']);
    const { sub, app, poll, dlDir } = await startSubscriptionDownload(undefined);
    try {
      assert.ok(await waitFor(() => grandchildPids().length === 1, 5000), 'the subscription download spawned yt-dlp and its grandchild');
      const spy = spyKillYtdlp();
      let res;
      try { res = await postJson(app.base, route === 'single' ? `/api/subscriptions/${sub.id}/cancel` : '/api/subscriptions/downloads/cancel'); } finally { spy.restore(); }
      assert.equal(res.status, 200);
      assert.equal(spy.calls.length, 1, `the ${route} cancel route kills through run.killYtdlp`);
      assert.ok(await waitDead(grandchildPids()[0], 2000), 'Cancel must kill the whole yt-dlp group, grandchild included');
      const settled = await within(poll, SLACK_MS);
      assert.notEqual(settled, HANG, 'the poll stayed wedged on the cancelled download');
    } finally {
      killStragglers();
      run.runList = originalRunList;
      ytdlp.resetPollRerunStateForTests();
      await within(poll, 10000);
      await app.close();
      fs.rmSync(dlDir, { recursive: true, force: true });
    }
  });
}

// ---- R6: the hang explains itself (runlog row, one-off trace line), at the production grace ------------------

test('subscription: a download freed at exit + grace marks its runlog row settledBy exit-grace', async () => {
  setModes(['escape-exit']);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-fake-ytdlp-data-'));
  const { app, poll, dlDir } = await startSubscriptionDownload(dataDir);
  try {
    const settled = await within(poll, run.EXIT_SETTLE_GRACE_MS + SLACK_MS);
    assert.notEqual(settled, HANG);
    const rows = runlog.readRuns(dataDir).filter((r) => r.kind === 'subscription');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].settledBy, 'exit-grace');
  } finally {
    killStragglers();
    run.runList = originalRunList;
    ytdlp.resetPollRerunStateForTests();
    await app.close();
    fs.rmSync(dlDir, { recursive: true, force: true });
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('one-off: a download freed at exit + grace writes a settle trace line and marks its runlog row', async () => {
  run.probeChannel = async () => null;
  setModes(['escape-exit']);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-fake-ytdlp-data-'));
  const dlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-fake-ytdlp-dl-'));
  const deps = { ...makeFakeDeps(), dataDir };
  const config = ytdlp.parseYtdlpConfig({ FILETUBE_YTDLP_ENABLED: 'true', FILETUBE_YTDLP_POLL_MINUTES: '0', FILETUBE_YTDLP_DOWNLOAD_DIR: dlDir });
  const { base, close } = await startTestApp(deps, config);
  try {
    const r = await postJson(base, '/api/ytdlp/download', { url: 'https://youtu.be/dQw4w9WgXcQ' });
    const { jobId } = await r.json();
    const done = await waitFor(() => runlog.readRuns(dataDir).some((row) => row.id === jobId && row.kind === 'one-shot' && row.outcome !== 'requeued'), run.EXIT_SETTLE_GRACE_MS + SLACK_MS);
    assert.ok(done, 'the one-off never reached its terminal runlog row');
    const row = runlog.readRuns(dataDir).find((x) => x.id === jobId && x.kind === 'one-shot');
    assert.equal(row.settledBy, 'exit-grace');
    const settle = oneshotTrace.readEntries(dataDir).filter((e) => e.jobId === jobId && e.ev === 'settle');
    assert.equal(settle.length, 1, 'exactly one settle line');
    assert.equal(settle[0].settledBy, 'exit-grace');
    assert.equal(typeof settle[0].pid, 'number');
    assert.ok(settle[0].msSinceExit >= run.EXIT_SETTLE_GRACE_MS - 50, `msSinceExit=${settle[0].msSinceExit}`);
    assert.equal(settle[0].groupSurvivors, false, 'the helper escaped the group, so the group kill found it empty');
  } finally {
    killStragglers();
    await close();
    fs.rmSync(dlDir, { recursive: true, force: true });
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

// ---- R2: a detached yt-dlp still dies with the server --------------------------------------------------------

test('server exit: a still-running detached yt-dlp group is killed when the server process exits (SIGTERM path)', async () => {
  setModes(['hang-linger']);
  const cp = require('node:child_process');
  const runPath = require.resolve('../../lib/ytdlp/run');
  // A stand-in for server.js: start a download, then exit the way server.js's SIGTERM handler does (process.exit).
  const script = `
    const run = require(${JSON.stringify(runPath)});
    run.spawnYtdlpDownload(['x'], {});
    process.on('SIGTERM', () => process.exit(0));
    setInterval(() => {}, 1000);
  `;
  const server = cp.spawn(process.execPath, ['-e', script], { stdio: 'ignore', env: process.env });
  try {
    assert.ok(await waitFor(() => grandchildPids().length === 1, 5000), 'the stand-in server spawned yt-dlp and its grandchild');
    const exited = new Promise((resolve) => server.on('exit', resolve));
    server.kill('SIGTERM');
    await within(exited, SLACK_MS);
    assert.ok(await waitDead(grandchildPids()[0], 2000), 'the server exit must take the detached yt-dlp group with it');
  } finally {
    try { server.kill('SIGKILL'); } catch (_) { /* gone */ }
    killStragglers();
  }
});
