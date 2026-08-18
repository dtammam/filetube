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
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

const engine = require('../../lib/ytdlp/engine');

let dataDir;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-engine-test-'));
});

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

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
