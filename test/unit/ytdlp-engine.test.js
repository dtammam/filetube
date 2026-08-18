'use strict';

// [UNIT] lib/ytdlp/engine.js -- the downloader-engine module's core (v1.146
// T1): paths, persisted state, version normalization/comparison, and PyPI
// channel ranking. The version tests bind the wave's named attack surface
// directly: the two real-world spellings of ONE nightly
// (PyPI `2026.8.17.73947.dev0` vs the binary's self-reported
// `2026.08.17.073947`) must compare EQUAL in both directions, or "update
// available" sticks true forever. Every fs test uses its own temp dataDir.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const { EventEmitter } = require('node:events');
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

const engine = require('../../lib/ytdlp/engine');

const originalSpawn = cp.spawn;
let dataDir;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-engine-test-'));
  engine._resetForTests();
});

afterEach(() => {
  cp.spawn = originalSpawn;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

// A fake spawned child: emits the scripted output on the next tick, then
// closes. `neverClose: true` models a wedged process - it closes only when
// killed (the timeout path).
function fakeChild({ code = 0, stdout = '', stderr = '', neverClose = false } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => { setImmediate(() => child.emit('close', null)); };
  if (!neverClose) {
    setImmediate(() => {
      if (stdout) child.stdout.emit('data', Buffer.from(stdout));
      if (stderr) child.stderr.emit('data', Buffer.from(stderr));
      child.emit('close', code);
    });
  }
  return child;
}

// A dispatching fake for the multi-step install flows: routes each spawned
// command to a handler by shape, records the call log, and lets handlers
// create real files under the test dataDir (ensureVenv/pipInstall check
// fs.existsSync on the venv layout).
function installDispatcher(overrides = {}) {
  const calls = [];
  const venvBin = path.join(dataDir, 'ytdlp-engine', 'venv', 'bin');
  const seedVenv = (withPip) => {
    fs.mkdirSync(venvBin, { recursive: true });
    fs.writeFileSync(path.join(venvBin, 'python'), '#!fake');
    if (withPip) fs.writeFileSync(path.join(venvBin, 'pip'), '#!fake');
  };
  cp.spawn = (cmd, argv) => {
    calls.push({ cmd, argv });
    if (cmd === 'python3' && argv[0] === '--version') {
      return fakeChild(overrides.python || { stdout: 'Python 3.12.9\n' });
    }
    if (cmd === 'python3' && argv[1] === 'venv' && !argv.includes('--without-pip')) {
      const spec = overrides.venvCreate || {};
      if (!spec.code) seedVenv(!spec.noPip); // success seeds the venv layout (sans pip when scripted)
      return fakeChild(spec);
    }
    if (cmd === 'python3' && argv[1] === 'venv' && argv.includes('--without-pip')) {
      const spec = overrides.venvBare || {};
      if (!spec.code) seedVenv(false);
      return fakeChild(spec);
    }
    if (cmd.endsWith(path.join('bin', 'pip')) || (cmd === 'python3' && argv[1] === 'pip')) {
      const spec = overrides.pip || {};
      if (!spec.code) fs.writeFileSync(path.join(venvBin, 'yt-dlp'), '#!fake');
      return fakeChild(spec);
    }
    if (cmd.endsWith(path.join('bin', 'yt-dlp')) && argv[0] === '--version') {
      return fakeChild(overrides.probe || { stdout: '2026.08.17.073947\n' });
    }
    if (cmd === 'yt-dlp' && argv[0] === '--version') {
      return fakeChild(overrides.bundled || { stdout: '2026.8.17.73947.dev0\n' });
    }
    throw new Error(`unexpected spawn in test: ${cmd} ${argv.join(' ')}`);
  };
  return calls;
}

// A fake PyPI fetch response whose body is an async-iterable byte stream
// (the shape engine.fetchChannelLatest consumes).
function fakePypiResponse(payload, { status = 200, chunkSize = 65536 } = {}) {
  const bytes = Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload));
  return {
    ok: status >= 200 && status < 300,
    status,
    body: (async function* () {
      for (let i = 0; i < bytes.length; i += chunkSize) yield bytes.subarray(i, i + chunkSize);
    })(),
  };
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

test('all engine paths join under <dataDir>/ytdlp-engine/', () => {
  const dir = engine.resolveEngineDir(dataDir);
  assert.equal(dir, path.join(dataDir, 'ytdlp-engine'));
  assert.equal(engine.resolveStatePath(dataDir), path.join(dir, 'state.json'));
  assert.equal(engine.resolveVenvDir(dataDir), path.join(dir, 'venv'));
  assert.equal(engine.resolveVenvBinaryPath(dataDir), path.join(dir, 'venv', 'bin', 'yt-dlp'));
  assert.equal(engine.resolveVenvPythonPath(dataDir), path.join(dir, 'venv', 'bin', 'python'));
  assert.equal(engine.resolveVenvPipPath(dataDir), path.join(dir, 'venv', 'bin', 'pip'));
});

test('BUNDLED_BINARY is the bare PATH-resolved command (pre-wave posture)', () => {
  assert.equal(engine.BUNDLED_BINARY, 'yt-dlp');
});

// ---------------------------------------------------------------------------
// Version charset gate (the pip-argv security boundary)
// ---------------------------------------------------------------------------

test('isSafeVersionString accepts both real-world spellings and plain stables', () => {
  assert.equal(engine.isSafeVersionString('2026.7.4'), true);
  assert.equal(engine.isSafeVersionString('2026.8.17.73947.dev0'), true);
  assert.equal(engine.isSafeVersionString('2026.08.17.073947'), true);
  assert.equal(engine.isSafeVersionString('2026'), true);
});

test('isSafeVersionString rejects argv-smuggling and malformed shapes', () => {
  for (const bad of [
    '', ' 2026.7.4', '2026.7.4 ', '2026.7.4;rm -rf /', '2026.7.4 --extra-index-url http://evil',
    '2026.7.4.post1', '2026.7.4rc1', '1.0a1', 'v2026.7.4', '2026..7', '.2026.7', '2026.7.',
    '2026.7.4.dev', '2026.7.4.dev0x', '2026.7.4.DEV0', '12345678901.0', // 11-digit segment
    '1.2.3.4.5.6.7.8.9', // 9 segments
    null, undefined, 42, {}, ['2026.7.4'],
  ]) {
    assert.equal(engine.isSafeVersionString(bad), false, `expected unsafe: ${String(bad)}`);
  }
});

// ---------------------------------------------------------------------------
// Version normalization + comparison (the sticky-"update available" killer)
// ---------------------------------------------------------------------------

test('parseVersionTuple normalizes both spellings of one nightly to the same tuple', () => {
  const pypi = engine.parseVersionTuple('2026.8.17.73947.dev0');
  const self = engine.parseVersionTuple('2026.08.17.073947');
  assert.deepEqual(pypi, { tuple: [2026, 8, 17, 73947], nightly: true });
  assert.deepEqual(self, { tuple: [2026, 8, 17, 73947], nightly: false });
});

test('parseVersionTuple returns null for unsafe input', () => {
  assert.equal(engine.parseVersionTuple('2026.7.4; echo pwned'), null);
  assert.equal(engine.parseVersionTuple(null), null);
});

test('versionsEqual holds across the PyPI/self-report spelling divide, both directions', () => {
  assert.equal(engine.versionsEqual('2026.8.17.73947.dev0', '2026.08.17.073947'), true);
  assert.equal(engine.versionsEqual('2026.08.17.073947', '2026.8.17.73947.dev0'), true);
  // Stable spelling divide: git tags zero-pad, PyPI strips.
  assert.equal(engine.versionsEqual('2026.07.04', '2026.7.4'), true);
  assert.equal(engine.versionsEqual('2026.7.4', '2026.7.5'), false);
  // Unparseable never equals anything, including itself.
  assert.equal(engine.versionsEqual('garbage', 'garbage'), false);
});

test('compareVersionStrings orders numerically, zero-fills, ignores dev tails', () => {
  assert.ok(engine.compareVersionStrings('2026.8.17.73947.dev0', '2026.7.4') > 0);
  assert.ok(engine.compareVersionStrings('2026.7.4', '2026.8.17.73947.dev0') < 0);
  assert.equal(engine.compareVersionStrings('2026.7', '2026.7.0'), 0);
  assert.ok(engine.compareVersionStrings('2027.1.1', '2026.12.31.235959.dev0') > 0); // year boundary
  assert.ok(engine.compareVersionStrings('2026.10.1', '2026.9.30') > 0); // numeric, not lexicographic
});

test('an unparseable side sorts lowest and never wins', () => {
  assert.ok(engine.compareVersionStrings('junk', '2026.7.4') < 0);
  assert.ok(engine.compareVersionStrings('2026.7.4', 'junk') > 0);
  assert.equal(engine.compareVersionStrings('junk', 'also junk'), 0);
});

test('isUpdateAvailable: equal-across-spellings reads as NO update (the sticky-true regression)', () => {
  // Installed nightly self-reports normalized; PyPI's latest is the same
  // release in dev spelling. This must be "already current".
  assert.equal(engine.isUpdateAvailable('2026.08.17.073947', '2026.8.17.73947.dev0'), false);
  assert.equal(engine.isUpdateAvailable('2026.8.17.73947.dev0', '2026.08.17.073947'), false);
});

test('isUpdateAvailable: strictly-newer latest reads true, older/unknown latest reads false', () => {
  assert.equal(engine.isUpdateAvailable('2026.08.17.073947', '2026.8.18.10203.dev0'), true);
  assert.equal(engine.isUpdateAvailable('2026.8.18.10203.dev0', '2026.08.17.073947'), false);
  assert.equal(engine.isUpdateAvailable('2026.7.4', 'not-a-version'), false);
  // An engine that cannot self-report a sane version deserves the update path.
  assert.equal(engine.isUpdateAvailable(null, '2026.7.4'), true);
});

// ---------------------------------------------------------------------------
// PyPI channel ranking
// ---------------------------------------------------------------------------

function fileOk() { return { yanked: false }; }
function fileYanked() { return { yanked: true }; }

test('pickChannelVersions ranks stable and nightly independently by numeric tuple', () => {
  const doc = {
    releases: {
      '2026.7.4': [fileOk()],
      '2026.6.1': [fileOk()],
      '2026.8.17.73947.dev0': [fileOk()],
      '2026.8.16.31245.dev0': [fileOk()],
    },
  };
  assert.deepEqual(engine.pickChannelVersions(doc), {
    stable: '2026.7.4',
    nightly: '2026.8.17.73947.dev0',
  });
});

test('pickChannelVersions skips yanked-only, empty-file, and unsafe-key releases', () => {
  const doc = {
    releases: {
      '2026.7.4': [fileYanked()],            // fully yanked - known-bad
      '2026.6.1': [fileYanked(), fileOk()],  // partially yanked - still installable
      '2026.9.9': [],                        // no files - uninstallable
      '2026.5.5;rm -rf /': [fileOk()],       // unsafe key - never considered
      '2026.8.17.73947.dev0': [fileOk()],
    },
  };
  assert.deepEqual(engine.pickChannelVersions(doc), {
    stable: '2026.6.1',
    nightly: '2026.8.17.73947.dev0',
  });
});

test('pickChannelVersions is defensive about the document shape', () => {
  const empty = { stable: null, nightly: null };
  assert.deepEqual(engine.pickChannelVersions(null), empty);
  assert.deepEqual(engine.pickChannelVersions({}), empty);
  assert.deepEqual(engine.pickChannelVersions({ releases: [] }), empty);
  assert.deepEqual(engine.pickChannelVersions({ releases: 'nope' }), empty);
  assert.deepEqual(engine.pickChannelVersions('nope'), empty);
});

test('pickChannelVersions only walks own keys (a __proto__ releases key is inert)', () => {
  const releases = JSON.parse('{"__proto__": {"polluted": [{"yanked": false}]}, "2026.7.4": [{"yanked": false}]}');
  const picked = engine.pickChannelVersions({ releases });
  assert.deepEqual(picked, { stable: '2026.7.4', nightly: null });
  assert.equal({}.polluted, undefined);
});

// ---------------------------------------------------------------------------
// Persisted state
// ---------------------------------------------------------------------------

test('readState on a missing file yields the default state and creates nothing', () => {
  const state = engine.readState(dataDir);
  assert.deepEqual(state, engine.defaultState());
  assert.equal(fs.existsSync(engine.resolveEngineDir(dataDir)), false);
});

test('defaultState: bundled channel, auto-update OFF, bundled active (the ruling terms 1+4)', () => {
  const s = engine.defaultState();
  assert.equal(s.channel, 'bundled');
  assert.equal(s.autoUpdate, false);
  assert.equal(s.active, 'bundled');
  assert.equal(s.installed, null);
});

test('writeState -> readState roundtrips a full valid state, atomically', () => {
  const state = engine.defaultState();
  state.channel = 'nightly';
  state.autoUpdate = true;
  state.installed = { version: '2026.8.17.73947.dev0', channel: 'nightly', installedAt: 1755500000000 };
  state.active = 'venv';
  state.lastCheckAt = 1755500000000;
  state.lastResult = { at: 1755500000000, ok: true, action: 'install', version: '2026.8.17.73947.dev0', message: 'installed and healthy' };
  assert.equal(engine.writeState(dataDir, state), true);
  assert.deepEqual(engine.readState(dataDir), engine.sanitizeState(state));
  // No temp files left behind.
  const leftovers = fs.readdirSync(engine.resolveEngineDir(dataDir)).filter((f) => f.endsWith('.tmp'));
  assert.deepEqual(leftovers, []);
});

test('readState survives garbage, truncation, and non-object JSON', () => {
  fs.mkdirSync(engine.resolveEngineDir(dataDir), { recursive: true });
  for (const junk of ['not json at all', '{"channel": "night', '42', '"str"', 'null', '[]']) {
    fs.writeFileSync(engine.resolveStatePath(dataDir), junk);
    assert.deepEqual(engine.readState(dataDir), engine.defaultState(), `junk: ${junk}`);
  }
});

test('sanitizeState enforces the venv-requires-installed invariant', () => {
  // active says venv but nothing is installed: fall to bundled.
  const s1 = engine.sanitizeState({ channel: 'nightly', active: 'venv', installed: null });
  assert.equal(s1.active, 'bundled');
  assert.equal(s1.channel, 'nightly');
  // installed record with an unsafe version string is dropped entirely,
  // taking active down with it.
  const s2 = engine.sanitizeState({
    active: 'venv',
    installed: { version: '2026.7.4; rm -rf /', channel: 'stable', installedAt: 5 },
  });
  assert.equal(s2.installed, null);
  assert.equal(s2.active, 'bundled');
});

test('sanitizeState drops unknown channels, bogus kinds, and bounds free text', () => {
  const s = engine.sanitizeState({
    channel: 'canary',
    autoUpdate: 'yes',
    installed: { version: '2026.7.4', channel: 'bundled', installedAt: 5 }, // bundled is never "installed"
    lastCheckAt: -5,
    lastResult: { at: 'now', ok: 1, action: 'x'.repeat(1000), version: 'bad ver', message: 'm'.repeat(1000) },
    revert: { fromVersion: '2026.7.4', reason: 'r'.repeat(1000), at: 0 },
    extraField: 'dropped',
  });
  assert.equal(s.channel, 'bundled');
  assert.equal(s.autoUpdate, false); // strict boolean, never truthy-coerced
  assert.equal(s.installed, null);
  assert.equal(s.lastCheckAt, null);
  assert.equal(s.lastResult.ok, false);
  assert.equal(s.lastResult.at, null);
  assert.equal(s.lastResult.version, null);
  assert.ok(s.lastResult.action.length <= 300);
  assert.ok(s.lastResult.message.length <= 300);
  assert.equal(s.revert.fromVersion, '2026.7.4');
  assert.ok(s.revert.reason.length <= 300);
  assert.equal(s.revert.at, null);
  assert.equal('extraField' in s, false);
});

test('writeState sanitizes on the way out (a buggy caller cannot persist a broken shape)', () => {
  assert.equal(engine.writeState(dataDir, { channel: 'stable', active: 'venv', installed: null }), true);
  const onDisk = JSON.parse(fs.readFileSync(engine.resolveStatePath(dataDir), 'utf8'));
  assert.equal(onDisk.active, 'bundled');
  assert.equal(onDisk.channel, 'stable');
});

test('writeState degrades gracefully when dataDir is unusable', () => {
  assert.equal(engine.writeState('', engine.defaultState()), false);
  // A dataDir that is actually a FILE cannot host ytdlp-engine/: mkdir
  // throws ENOTDIR, writeState must swallow it and report false.
  const filePath = path.join(dataDir, 'not-a-dir');
  fs.writeFileSync(filePath, 'occupied');
  assert.equal(engine.writeState(filePath, engine.defaultState()), false);
});

// ---------------------------------------------------------------------------
// T2: runEngineProcess (the bounded, never-throwing process runner)
// ---------------------------------------------------------------------------

test('runEngineProcess captures output and reports ok on exit 0', async () => {
  cp.spawn = () => fakeChild({ stdout: 'hello\n', stderr: 'warn\n' });
  const r = await engine.runEngineProcess('anything', []);
  assert.equal(r.ok, true);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, 'hello\n');
  assert.equal(r.stderr, 'warn\n');
  assert.equal(r.error, null);
});

test('runEngineProcess: a synchronous spawn throw resolves ok:false, never rejects', async () => {
  cp.spawn = () => { throw new Error('boom'); };
  const r = await engine.runEngineProcess('anything', []);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'boom');
});

test('runEngineProcess: an async spawn error (ENOENT) resolves ok:false', async () => {
  cp.spawn = () => {
    const child = fakeChild({ neverClose: true });
    setImmediate(() => child.emit('error', new Error('spawn python3 ENOENT')));
    return child;
  };
  const r = await engine.runEngineProcess('python3', ['--version']);
  assert.equal(r.ok, false);
  assert.match(r.error, /ENOENT/);
});

test('runEngineProcess kills and reports a wedged process at the timeout', async () => {
  cp.spawn = () => fakeChild({ neverClose: true });
  const r = await engine.runEngineProcess('anything', [], { timeoutMs: 30, phaseLabel: 'pip install' });
  assert.equal(r.ok, false);
  assert.equal(r.timedOut, true);
  assert.match(r.error, /pip install timed out/);
});

test('runEngineProcess bounds stdout/stderr to a tail', async () => {
  cp.spawn = () => {
    const child = fakeChild({ neverClose: true });
    setImmediate(() => {
      for (let i = 0; i < 20; i++) child.stdout.emit('data', Buffer.from('x'.repeat(1024)));
      child.stdout.emit('data', Buffer.from('THE-TAIL'));
      child.emit('close', 0);
    });
    return child;
  };
  const r = await engine.runEngineProcess('anything', []);
  assert.ok(r.stdout.length <= 8 * 1024);
  assert.ok(r.stdout.endsWith('THE-TAIL'));
});

// ---------------------------------------------------------------------------
// T2: support + bundled-version probes (cached)
// ---------------------------------------------------------------------------

test('getSupportInfo: python3 present -> supported, and the probe is cached', async () => {
  const calls = installDispatcher();
  assert.deepEqual(await engine.getSupportInfo(), { supported: true, reason: null });
  await engine.getSupportInfo();
  assert.equal(calls.length, 1); // second call answered from cache
});

test('getSupportInfo: python3 absent -> honest degrade message, bundled stays', async () => {
  cp.spawn = () => { throw new Error('spawn python3 ENOENT'); };
  const info = await engine.getSupportInfo();
  assert.equal(info.supported, false);
  assert.match(info.reason, /python3 is not available/);
  assert.match(info.reason, /bundled engine stays in use/);
});

test('getBundledVersion probes the bare yt-dlp on PATH and caches; garbage reads null', async () => {
  const calls = installDispatcher();
  assert.equal(await engine.getBundledVersion({ now: () => 1000 }), '2026.8.17.73947.dev0');
  await engine.getBundledVersion({ now: () => 2000 });
  assert.equal(calls.filter((c) => c.cmd === 'yt-dlp').length, 1);
  engine._resetForTests();
  installDispatcher({ bundled: { stdout: 'not a version\n' } });
  assert.equal(await engine.getBundledVersion({ now: () => 1000 }), null);
});

// ---------------------------------------------------------------------------
// T2: PyPI channel fetch (TTL-cached, size-capped, never throws)
// ---------------------------------------------------------------------------

const PYPI_DOC = {
  releases: {
    '2026.7.4': [{ yanked: false }],
    '2026.6.9': [{ yanked: false }],
    '2026.8.17.73947.dev0': [{ yanked: false }],
    '2026.8.4.234419.dev0': [{ yanked: false }], // string-sorts ABOVE 8.17 - the comparator must not
  },
};

test('fetchChannelLatest ranks channels numerically and caches by TTL', async () => {
  let fetches = 0;
  const fetchImpl = async () => { fetches++; return fakePypiResponse(PYPI_DOC); };
  const first = await engine.fetchChannelLatest({ fetchImpl, now: () => 1000 });
  assert.equal(first.stable, '2026.7.4');
  assert.equal(first.nightly, '2026.8.17.73947.dev0'); // NOT the lexicographic winner 8.4
  assert.equal(first.error, null);
  await engine.fetchChannelLatest({ fetchImpl, now: () => 2000 });
  assert.equal(fetches, 1); // inside TTL - cached
  await engine.fetchChannelLatest({ fetchImpl, now: () => 2000, force: true });
  assert.equal(fetches, 2); // force bypasses the TTL
});

test('fetchChannelLatest: HTTP error, hostile JSON, and a thrown fetch all degrade to nulls', async () => {
  const cases = [
    { fetchImpl: async () => fakePypiResponse('', { status: 503 }), match: /503/ },
    { fetchImpl: async () => fakePypiResponse('{"releases": [truncated'), match: /PyPI check failed/ },
    { fetchImpl: async () => { throw new Error('getaddrinfo ENOTFOUND pypi.org'); }, match: /ENOTFOUND/ },
  ];
  for (const c of cases) {
    engine._resetForTests();
    const r = await engine.fetchChannelLatest({ fetchImpl: c.fetchImpl, now: () => 1000 });
    assert.equal(r.stable, null);
    assert.equal(r.nightly, null);
    assert.match(r.error, c.match);
  }
});

test('fetchChannelLatest aborts an oversized response at the byte cap', async () => {
  const huge = `{"releases": {"2026.7.4": [{"comment": "${'x'.repeat(9 * 1024 * 1024)}"}]}}`;
  const r = await engine.fetchChannelLatest({ fetchImpl: async () => fakePypiResponse(huge), now: () => 1000 });
  assert.equal(r.stable, null);
  assert.match(r.error, /size cap/);
});

// ---------------------------------------------------------------------------
// T2: ensureVenv (the Alpine-ensurepip defense-in-depth chain)
// ---------------------------------------------------------------------------

test('ensureVenv: plain venv with pip -> pipMode venv', async () => {
  installDispatcher();
  assert.deepEqual(await engine.ensureVenv(dataDir), { ok: true, pipMode: 'venv' });
});

test('ensureVenv: venv created but ensurepip gave no pip -> pipMode system', async () => {
  installDispatcher({ venvCreate: { noPip: true } });
  assert.deepEqual(await engine.ensureVenv(dataDir), { ok: true, pipMode: 'system' });
});

test('ensureVenv: plain creation fails, --without-pip works -> pipMode system', async () => {
  installDispatcher({ venvCreate: { code: 1, stderr: 'ensurepip is not available\n' } });
  assert.deepEqual(await engine.ensureVenv(dataDir), { ok: true, pipMode: 'system' });
});

test('ensureVenv: both creation routes fail -> honest message', async () => {
  installDispatcher({
    venvCreate: { code: 1, stderr: 'ensurepip is not available\n' },
    venvBare: { code: 1, stderr: 'no venv module\n' },
  });
  const r = await engine.ensureVenv(dataDir);
  assert.equal(r.ok, false);
  assert.match(r.message, /could not create the engine environment/);
});

// ---------------------------------------------------------------------------
// T2: installEngine (install -> probe -> activate, honest on every failure)
// ---------------------------------------------------------------------------

const NIGHTLY = '2026.8.17.73947.dev0';

test('installEngine happy path: installs, probes, activates, persists', async () => {
  const calls = installDispatcher();
  const r = await engine.installEngine({ dataDir, version: NIGHTLY, channel: 'nightly', deps: { now: () => 5000 } });
  assert.equal(r.ok, true);
  assert.equal(r.becameActive, true);
  assert.equal(r.reported, '2026.08.17.073947'); // the normalized self-report
  const state = engine.readState(dataDir);
  assert.equal(state.active, 'venv');
  assert.deepEqual(state.installed, { version: NIGHTLY, reported: '2026.08.17.073947', channel: 'nightly', installedAt: 5000 });
  assert.equal(state.revert, null);
  assert.equal(state.lastResult.ok, true);
  // The pip argv used the exact validated pin, array-form.
  const pipCall = calls.find((c) => c.cmd.endsWith(path.join('bin', 'pip')));
  assert.ok(pipCall.argv.includes(`yt-dlp==${NIGHTLY}`));
  assert.ok(pipCall.argv.includes('--no-cache-dir'));
});

test('installEngine refuses an unsafe version/channel BEFORE any spawn', async () => {
  const calls = installDispatcher();
  const r1 = await engine.installEngine({ dataDir, version: '2026.7.4; rm -rf /', channel: 'stable' });
  assert.equal(r1.ok, false);
  assert.match(r1.message, /failed validation/);
  const r2 = await engine.installEngine({ dataDir, version: '2026.7.4', channel: 'bundled' });
  assert.equal(r2.ok, false);
  assert.equal(calls.length, 0);
  assert.deepEqual(engine.readState(dataDir), engine.defaultState()); // state untouched
});

test('installEngine on an unsupported host fails early and leaves state untouched', async () => {
  cp.spawn = () => { throw new Error('spawn python3 ENOENT'); };
  const r = await engine.installEngine({ dataDir, version: '2026.7.4', channel: 'stable' });
  assert.equal(r.ok, false);
  assert.match(r.message, /python3 is not available/);
  assert.deepEqual(engine.readState(dataDir), engine.defaultState());
});

test('installEngine: pip failure demotes to bundled with the stderr tail in lastResult', async () => {
  installDispatcher({ pip: { code: 1, stderr: 'ERROR: No matching distribution found for yt-dlp==2026.9.9\n' } });
  const r = await engine.installEngine({ dataDir, version: '2026.9.9', channel: 'stable', deps: { now: () => 5000 } });
  assert.equal(r.ok, false);
  assert.equal(r.reverted, false); // nothing was venv-active before
  const state = engine.readState(dataDir);
  assert.equal(state.active, 'bundled');
  assert.equal(state.installed, null);
  assert.equal(state.lastResult.ok, false);
  assert.match(state.lastResult.message, /No matching distribution/);
});

test('installEngine: probe version mismatch demotes (never activates a liar)', async () => {
  installDispatcher({ probe: { stdout: '2026.01.01\n' } });
  const r = await engine.installEngine({ dataDir, version: NIGHTLY, channel: 'nightly' });
  assert.equal(r.ok, false);
  assert.match(r.message, /reports 2026\.01\.01, expected/);
  assert.equal(engine.readState(dataDir).active, 'bundled');
});

test('installEngine: a failed upgrade OVER an active venv engine records the revert', async () => {
  // First, a successful install makes venv active.
  installDispatcher();
  await engine.installEngine({ dataDir, version: NIGHTLY, channel: 'nightly', deps: { now: () => 5000 } });
  // Then an upgrade attempt whose pip fails: the --clear'ed venv is gone,
  // so the state must fall to bundled AND say why.
  installDispatcher({ pip: { code: 1, stderr: 'network unreachable\n' } });
  const r = await engine.installEngine({ dataDir, version: '2026.8.18.10203.dev0', channel: 'nightly', deps: { now: () => 9000 } });
  assert.equal(r.ok, false);
  assert.equal(r.reverted, true);
  const state = engine.readState(dataDir);
  assert.equal(state.active, 'bundled');
  assert.equal(state.installed, null);
  assert.equal(state.revert.fromVersion, NIGHTLY);
  assert.equal(state.revert.at, 9000);
  assert.match(state.revert.reason, /network unreachable/);
});

test('installEngine: venv creation failure after an active install also demotes (the --clear scar)', async () => {
  installDispatcher();
  await engine.installEngine({ dataDir, version: NIGHTLY, channel: 'nightly' });
  installDispatcher({
    venvCreate: { code: 1, stderr: 'disk full\n' },
    venvBare: { code: 1, stderr: 'disk full\n' },
  });
  const r = await engine.installEngine({ dataDir, version: '2026.8.18.10203.dev0', channel: 'nightly' });
  assert.equal(r.ok, false);
  assert.equal(r.reverted, true);
  assert.equal(engine.readState(dataDir).active, 'bundled');
});

// ---------------------------------------------------------------------------
// T2: intent setters + activateBundled (conscious choice vs auto-revert)
// ---------------------------------------------------------------------------

test('setChannelIntent to bundled is the conscious choice: takes effect now, revert clears', async () => {
  installDispatcher();
  engine.setChannelIntent({ dataDir, channel: 'nightly' });
  await engine.installEngine({ dataDir, version: NIGHTLY, channel: 'nightly' });
  const state = engine.setChannelIntent({ dataDir, channel: 'bundled' });
  assert.equal(state.channel, 'bundled');
  assert.equal(state.active, 'bundled');
  assert.equal(state.revert, null);
  // The venv install record survives - its files are intact, just inactive.
  assert.equal(state.installed.version, NIGHTLY);
});

test('setChannelIntent to stable/nightly records intent WITHOUT activating anything', () => {
  const state = engine.setChannelIntent({ dataDir, channel: 'nightly' });
  assert.equal(state.channel, 'nightly');
  assert.equal(state.active, 'bundled'); // activation is the install job's job
  // Unknown channels are no-ops.
  assert.equal(engine.setChannelIntent({ dataDir, channel: 'canary' }).channel, 'nightly');
});

test('setAutoUpdate is a strict-boolean opt-in', () => {
  assert.equal(engine.setAutoUpdate({ dataDir, enabled: true }).autoUpdate, true);
  assert.equal(engine.setAutoUpdate({ dataDir, enabled: 'yes' }).autoUpdate, false);
  assert.equal(engine.readState(dataDir).autoUpdate, false);
});

test('activateBundled is the AUTO revert: channel intent kept, installed distrusted', async () => {
  installDispatcher();
  engine.setChannelIntent({ dataDir, channel: 'nightly' });
  await engine.installEngine({ dataDir, version: NIGHTLY, channel: 'nightly' });
  const state = engine.activateBundled({ dataDir, reason: 'engine failed to start: spawn ENOENT', deps: { now: () => 7000 } });
  assert.equal(state.channel, 'nightly'); // the intent survives the revert
  assert.equal(state.active, 'bundled');
  assert.equal(state.installed, null); // no silent re-activation path
  assert.equal(state.revert.fromVersion, NIGHTLY);
  assert.equal(state.revert.at, 7000);
  assert.match(state.revert.reason, /spawn ENOENT/);
});

test('activateBundled while already bundled records nothing new (no thrash)', () => {
  const before = engine.readState(dataDir);
  const state = engine.activateBundled({ dataDir, reason: 'spurious' });
  assert.equal(state.active, 'bundled');
  assert.equal(state.revert, null);
  assert.deepEqual(state, before);
});
