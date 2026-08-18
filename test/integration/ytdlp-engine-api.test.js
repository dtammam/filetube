'use strict';

// [INTEGRATION] v1.146 T4 - the downloader-engine routes against the REAL
// app: admin-only fail-closed gating (all three routes, first-line), the
// status shape, channel switching through the gated install job (fake
// spawns + fake PyPI - nothing touches the network or a real pip), the
// health-gated activation, bell production, and honest failure surfaces.
// The forcing net (route-write-classification) separately proves the
// flag-less-member 403s across every mutating route; this file binds the
// engine-specific behavior.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-engineapi-'));
process.env.FILETUBE_YTDLP_ENABLED = 'true';
process.env.FILETUBE_YTDLP_POLL_MINUTES = '0';

const cp = require('node:child_process');
const { EventEmitter } = require('node:events');
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const { app, userStore, __resetDatabaseForTests, __mintTestSession } = require('../../server');
const ytdlp = require('../../lib/ytdlp');
const engine = require('../../lib/ytdlp/engine');
const { authenticateFetch } = require('../helpers/auth');

const DATA_DIR = path.resolve(process.env.DATA_DIR);
const originalSpawn = cp.spawn;
let server, base, auth;

const NIGHTLY = '2026.8.17.73947.dev0';
const STABLE = '2026.7.4';
const PYPI_DOC = {
  releases: {
    [STABLE]: [{ yanked: false }],
    '2026.6.9': [{ yanked: false }],
    [NIGHTLY]: [{ yanked: false }],
  },
};

function fakePypiFetch() {
  const bytes = Buffer.from(JSON.stringify(PYPI_DOC));
  return Promise.resolve({
    ok: true,
    status: 200,
    body: (async function* () { yield bytes; })(),
  });
}

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

// The install-flow dispatcher (the unit suite's twin, retargeted at the
// app's real DATA_DIR). Overridable per test for failure injection.
function armSpawns(overrides = {}) {
  const venvBin = path.join(DATA_DIR, 'ytdlp-engine', 'venv', 'bin');
  cp.spawn = (cmd, argv) => {
    if (cmd === 'python3' && argv[0] === '--version') return fakeChild({ stdout: 'Python 3.12.9\n' });
    if (cmd === 'python3' && argv[1] === 'venv') {
      fs.mkdirSync(venvBin, { recursive: true });
      fs.writeFileSync(path.join(venvBin, 'python'), '#!fake');
      fs.writeFileSync(path.join(venvBin, 'pip'), '#!fake');
      return fakeChild({});
    }
    if (cmd.endsWith(path.join('bin', 'pip'))) {
      const spec = overrides.pip || {};
      if (!spec.code) fs.writeFileSync(path.join(venvBin, 'yt-dlp'), '#!fake');
      return fakeChild(spec);
    }
    if (cmd.endsWith(path.join('bin', 'yt-dlp')) && argv[0] === '--version') {
      return fakeChild(overrides.probe || { stdout: '2026.08.17.073947\n' });
    }
    if (cmd === 'yt-dlp' && argv[0] === '--version') {
      return fakeChild({ stdout: '2026.8.10.11111.dev0\n' });
    }
    throw new Error(`unexpected spawn in engine-api test: ${cmd} ${argv.join(' ')}`);
  };
}

async function awaitEngineJob() {
  const job = ytdlp.currentEngineJob();
  if (job && job.promise) await job.promise;
}

function engineBellRows() {
  return userStore.listNotifications(auth.user.id).items.filter((i) => i.kind === 'engine');
}

before(async () => {
  engine._setFetchImplForTests(fakePypiFetch);
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  auth = authenticateFetch(server, base);
});

after(async () => {
  cp.spawn = originalSpawn;
  engine._setFetchImplForTests(null);
  auth.restore();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(async () => {
  await __resetDatabaseForTests();
  await awaitEngineJob(); // never let a prior test's job bleed across
  cp.spawn = originalSpawn;
  fs.rmSync(path.join(DATA_DIR, 'ytdlp-engine'), { recursive: true, force: true });
});

test('all three engine routes are admin-only, first-line (a member sees 403, never a 400/spawn)', async () => {
  const member = __mintTestSession({ username: 'nocaps-eng', role: 'member' });
  const asMember = (url, opts = {}) => fetch(`${base}${url}`, { ...opts, headers: { ...(opts.headers || {}), Cookie: member.cookie } });
  assert.equal((await asMember('/api/ytdlp/engine')).status, 403);
  const p1 = await asMember('/api/ytdlp/engine', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ junk: 1 }) });
  assert.equal(p1.status, 403, 'the admin gate must win BEFORE body validation');
  const p2 = await asMember('/api/ytdlp/engine/update', { method: 'POST' });
  assert.equal(p2.status, 403);
});

test('GET returns the full status shape: bundled defaults, live channel versions, support info', async () => {
  armSpawns();
  const res = await fetch(`${base}/api/ytdlp/engine`);
  assert.equal(res.status, 200);
  const s = await res.json();
  assert.equal(s.supported, true);
  assert.equal(s.channel, 'bundled');
  assert.equal(s.active, 'bundled');
  assert.equal(s.autoUpdate, false);
  assert.equal(s.installed, null);
  assert.equal(s.latest.stable, STABLE);
  assert.equal(s.latest.nightly, NIGHTLY);
  assert.equal(typeof s.bundledVersion === 'string' || s.bundledVersion === null, true);
});

test('POST validates strictly: unknown keys, bad channel, non-boolean autoUpdate all 400', async () => {
  for (const body of [{ junk: 1 }, { channel: 'canary' }, { autoUpdate: 'yes' }]) {
    const res = await fetch(`${base}/api/ytdlp/engine`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(body)}`);
  }
});

test('POST autoUpdate round-trips (strict opt-in, default OFF)', async () => {
  const on = await (await fetch(`${base}/api/ytdlp/engine`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ autoUpdate: true }),
  })).json();
  assert.equal(on.autoUpdate, true);
  const off = await (await fetch(`${base}/api/ytdlp/engine`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ autoUpdate: false }),
  })).json();
  assert.equal(off.autoUpdate, false);
});

test('channel switch to nightly: gated install -> health probe -> venv active + an "updated" bell', async () => {
  armSpawns();
  const res = await fetch(`${base}/api/ytdlp/engine`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel: 'nightly' }),
  });
  assert.equal(res.status, 200);
  await awaitEngineJob();
  const s = await (await fetch(`${base}/api/ytdlp/engine`)).json();
  assert.equal(s.channel, 'nightly');
  assert.equal(s.active, 'venv');
  assert.equal(s.installed.version, NIGHTLY);
  assert.equal(s.installed.reported, '2026.08.17.073947');
  assert.equal(s.busy, null);
  assert.equal(s.lastResult.ok, true);
  const bells = engineBellRows();
  assert.equal(bells.length, 1);
  assert.equal(bells[0].mediaId, 'engine:updated:2026.08.17.073947');
});

test('channel back to bundled is immediate; a further Update now 400s honestly', async () => {
  armSpawns();
  await fetch(`${base}/api/ytdlp/engine`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel: 'nightly' }),
  });
  await awaitEngineJob();
  const s = await (await fetch(`${base}/api/ytdlp/engine`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel: 'bundled' }),
  })).json();
  assert.equal(s.channel, 'bundled');
  assert.equal(s.active, 'bundled');
  const upd = await fetch(`${base}/api/ytdlp/engine/update`, { method: 'POST' });
  assert.equal(upd.status, 400);
  assert.match((await upd.json()).error, /bundled engine updates with the app image/);
});

test('Update now while already on the latest short-circuits: action "check", NO new bell', async () => {
  armSpawns();
  await fetch(`${base}/api/ytdlp/engine`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel: 'nightly' }),
  });
  await awaitEngineJob();
  const bellsBefore = engineBellRows().length;
  await fetch(`${base}/api/ytdlp/engine/update`, { method: 'POST' });
  await awaitEngineJob();
  const s = await (await fetch(`${base}/api/ytdlp/engine`)).json();
  assert.equal(s.lastResult.action, 'check');
  assert.match(s.lastResult.message, /already on the latest nightly/);
  assert.equal(s.active, 'venv', 'a no-op check must not touch the active engine');
  assert.equal(engineBellRows().length, bellsBefore, 'no bell spam for "nothing to do"');
});

test('a failed install demotes honestly and bells "update-failed" - never activates', async () => {
  armSpawns({ pip: { code: 1, stderr: 'ERROR: No matching distribution found\n' } });
  await fetch(`${base}/api/ytdlp/engine`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel: 'stable' }),
  });
  await awaitEngineJob();
  const s = await (await fetch(`${base}/api/ytdlp/engine`)).json();
  assert.equal(s.channel, 'stable', 'the intent survives the failure');
  assert.equal(s.active, 'bundled');
  assert.equal(s.installed, null);
  assert.equal(s.lastResult.ok, false);
  assert.match(s.lastResult.message, /No matching distribution/);
  const bells = engineBellRows();
  assert.equal(bells.length, 1);
  assert.equal(bells[0].mediaId, `engine:update-failed:${STABLE}`);
});

test('a probe-lying binary never activates (health gate binds the route flow end to end)', async () => {
  armSpawns({ probe: { stdout: '2020.01.01\n' } });
  await fetch(`${base}/api/ytdlp/engine`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel: 'nightly' }),
  });
  await awaitEngineJob();
  const s = await (await fetch(`${base}/api/ytdlp/engine`)).json();
  assert.equal(s.active, 'bundled');
  assert.match(s.lastResult.message, /reports 2020\.01\.01, expected/);
});

test('T8: /api/stats reports the ACTIVE engine - venv after a switch, bundled after switching back', async () => {
  armSpawns();
  await fetch(`${base}/api/ytdlp/engine`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel: 'nightly' }),
  });
  await awaitEngineJob();
  let stats = await (await fetch(`${base}/api/stats`)).json();
  assert.deepEqual(stats.system.ytdlp.engine, { channel: 'nightly', active: 'venv' });
  await fetch(`${base}/api/ytdlp/engine`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel: 'bundled' }),
  });
  stats = await (await fetch(`${base}/api/stats`)).json();
  assert.deepEqual(stats.system.ytdlp.engine, { channel: 'bundled', active: 'bundled' });
});

// ---------------------------------------------------------------------------
// Gate round 1 fixes (route-level halves)
// ---------------------------------------------------------------------------

test('W5/QA W1: a channel write while an engine job is pending is refused WHOLE (409, nothing persisted)', async () => {
  armSpawns();
  // Hold the FIFO gate so the first switch stays queued.
  let releaseBlocker;
  const blocker = ytdlp.runExclusive(
    () => new Promise((resolve) => { releaseBlocker = resolve; }),
    { kind: 'channel', label: 'blocker-download' }
  );
  await fetch(`${base}/api/ytdlp/engine`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel: 'nightly' }),
  });
  assert.equal(ytdlp.currentEngineJob().status, 'queued');
  // Second switch while busy: refused, intent untouched.
  const second = await fetch(`${base}/api/ytdlp/engine`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel: 'stable' }),
  });
  assert.equal(second.status, 409);
  // A bundled flip while busy is refused too (it would race the pending activation).
  const toBundled = await fetch(`${base}/api/ytdlp/engine`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel: 'bundled' }),
  });
  assert.equal(toBundled.status, 409);
  // autoUpdate-only writes stay fine while busy.
  const auto = await fetch(`${base}/api/ytdlp/engine`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ autoUpdate: true }),
  });
  assert.equal(auto.status, 200);
  releaseBlocker();
  await blocker;
  await awaitEngineJob();
  const s = await (await fetch(`${base}/api/ytdlp/engine`)).json();
  assert.equal(s.channel, 'nightly', 'the refused switches never half-applied');
  assert.equal(s.installed.channel, 'nightly');
  assert.equal(s.autoUpdate, true);
  // restore for later tests
  await fetch(`${base}/api/ytdlp/engine`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ autoUpdate: false }),
  });
});

test('QA W2: the status surfaces report bundled the moment the venv binary is gone', async () => {
  armSpawns();
  await fetch(`${base}/api/ytdlp/engine`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel: 'nightly' }),
  });
  await awaitEngineJob();
  fs.rmSync(path.join(DATA_DIR, 'ytdlp-engine', 'venv', 'bin', 'yt-dlp'));
  const s = await (await fetch(`${base}/api/ytdlp/engine`)).json();
  assert.equal(s.active, 'bundled', 'never claim a venv whose binary is gone');
  assert.equal(s.channel, 'nightly');
  const stats = await (await fetch(`${base}/api/stats`)).json();
  assert.equal(stats.system.ytdlp.engine.active, 'bundled');
});

test('adversarial S1: the version cache reports the NEW engine as soon as the install job completes', async () => {
  armSpawns();
  await fetch(`${base}/api/ytdlp/engine`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel: 'nightly' }),
  });
  await awaitEngineJob();
  // The refresh is AWAITED inside the gated job, so this read is ordered.
  const stats = await (await fetch(`${base}/api/stats`)).json();
  assert.equal(stats.system.ytdlp.version, '2026.08.17.073947');
});

test('QA S2: without requireAdmin in the deps bundle the engine routes fail CLOSED (403 for everyone)', async () => {
  const express = require('express');
  const bare = express();
  bare.use(express.json());
  ytdlp.registerRoutes(bare, { dataDir: DATA_DIR }, ytdlp.parseYtdlpConfig());
  const bareServer = await new Promise((resolve) => { const s = bare.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const bareBase = `http://127.0.0.1:${bareServer.address().port}`;
    for (const [method, url] of [['GET', '/api/ytdlp/engine'], ['POST', '/api/ytdlp/engine'], ['POST', '/api/ytdlp/engine/update']]) {
      const r = await fetch(`${bareBase}${url}`, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'POST' ? '{}' : undefined });
      assert.equal(r.status, 403, `${method} ${url} must refuse everyone with no gate wired`);
    }
  } finally {
    bareServer.closeAllConnections?.();
    await new Promise((resolve) => bareServer.close(resolve));
  }
});
