'use strict';

// v1.146 T1 (downloader-engine channel selector): the engine module's core -
// disk layout, persisted state, version normalization/comparison, and PyPI
// release-channel ranking for the runtime yt-dlp engine selector (Dean's
// 2026-08-18 ruling overturning the Dockerfile's locked decision D5).
//
// The module owns `<dataDir>/ytdlp-engine/` - `state.json` (which channel
// the admin chose, what is installed, which engine is ACTIVE) and `venv/`
// (ONE persistent virtualenv reused across channels and versions, so disk
// stays bounded; it lives under DATA_DIR so it survives container
// recreation). Like every yt-dlp submodule (runlog/pending/faillog) it only
// ever JOINS paths under a caller-supplied `dataDir` string - it never
// resolves DATA_DIR itself.
//
// SIDE-EFFECT-FREE IMPORT: requiring this file touches no filesystem,
// spawns nothing, registers no routes/timers - the `lib/ytdlp/config.js`
// posture. `state.json` is created lazily on the first write; reads of a
// missing/corrupt file yield the default state and never throw or create
// anything (the disabled-module no-op guarantee).
//
// INTENT vs ACTIVE (the ruling's terms 1-3): `state.channel` is the admin's
// INTENT (bundled/stable/nightly); `state.active` is the engine actually
// spawned ('bundled' = the image's pinned binary on PATH, 'venv' = the
// installed one). A failed health probe or a runtime engine-execution
// failure flips `active` to 'bundled' WITHOUT rewriting `channel` - the
// bundled binary is never removed and is always the fallback.
//
// VERSION SPELLINGS (the v1.145 gate S1 lesson, now load-bearing): PyPI
// spells a nightly `2026.8.17.73947.dev0` while the installed binary
// self-reports the normalized `2026.08.17.073947` (zero-padded, `.dev0`
// dropped). Every comparison in this module therefore goes through
// `parseVersionTuple` - numeric segments compared as numbers with the dev
// suffix stripped - NEVER through string equality, or "update available"
// would stick true forever (a named attack surface of this wave).

const fs = require('fs');
const path = require('path');

// Directory + filenames, always joined under the caller-supplied dataDir.
const ENGINE_DIRNAME = 'ytdlp-engine';
const STATE_FILENAME = 'state.json';
const VENV_DIRNAME = 'venv';

// The bundled engine is whatever `yt-dlp` resolves to on PATH - the image's
// pinned pip install (Dockerfile ARG YTDLP_VERSION), or a bare-metal
// install. A bare command name, deliberately: PATH resolution is the
// pre-wave behavior and stays byte-identical for the default channel.
const BUNDLED_BINARY = 'yt-dlp';

const CHANNELS = ['bundled', 'stable', 'nightly'];

// The ONLY version spellings this module will ever compare, rank, or (in
// T2) hand to pip: dotted numeric segments with an optional `.devN` tail.
// Everything else - including anything PyPI might publish that does not
// match - is SKIPPED, never coerced: these strings cross into a pip argv,
// so the charset gate is a security boundary, not a convenience.
// Bounds: at most 8 segments of at most 10 digits each keeps tuples inside
// safe-integer territory and the whole string well under argv limits.
const SAFE_VERSION_PATTERN = /^[0-9]{1,10}(?:\.[0-9]{1,10}){0,7}(?:\.dev[0-9]{1,10})?$/;

// A PyPI PRE-release (yt-dlp's nightly channel) is exactly a `.devN` tail.
const NIGHTLY_SUFFIX_PATTERN = /\.dev[0-9]+$/;

// Bounds for persisted free-text (probe/revert reasons originate in stderr
// tails - bounded upstream, re-bounded here so a hand-edited or hostile
// state.json cannot balloon memory or the UI).
const MAX_TEXT_LENGTH = 300;

// Monotonic per-process temp-name counter (the runlog/saveDatabase idiom).
let stateTmpSeq = 0;

function resolveEngineDir(dataDir) {
  return path.join(dataDir, ENGINE_DIRNAME);
}

function resolveStatePath(dataDir) {
  return path.join(resolveEngineDir(dataDir), STATE_FILENAME);
}

function resolveVenvDir(dataDir) {
  return path.join(resolveEngineDir(dataDir), VENV_DIRNAME);
}

// POSIX layout only (`venv/bin/...`): FileTube's supported deployments are
// the Linux Docker image and Linux/macOS bare metal. On a platform without
// a usable python3 the feature degrades to supported:false (T2) - it never
// guesses at Scripts\ layouts.
function resolveVenvBinaryPath(dataDir) {
  return path.join(resolveVenvDir(dataDir), 'bin', 'yt-dlp');
}

function resolveVenvPythonPath(dataDir) {
  return path.join(resolveVenvDir(dataDir), 'bin', 'python');
}

function resolveVenvPipPath(dataDir) {
  return path.join(resolveVenvDir(dataDir), 'bin', 'pip');
}

/**
 * Is `v` a version string this module is willing to compare/rank/install?
 * The charset gate every PyPI-supplied string must pass BEFORE it is used
 * anywhere (comparison, state, and - in T2 - a pip argv).
 *
 * @param {*} v candidate version string
 * @returns {boolean}
 */
function isSafeVersionString(v) {
  return typeof v === 'string' && SAFE_VERSION_PATTERN.test(v);
}

/**
 * Parse a version string into its comparable form: an array of numeric
 * segments with the `.devN` tail STRIPPED, plus whether that tail was
 * present (= the PyPI pre-release/nightly marker). Both real-world
 * spellings of one nightly parse to the SAME tuple:
 *
 *   '2026.8.17.73947.dev0'   -> { tuple: [2026, 8, 17, 73947], nightly: true }
 *   '2026.08.17.073947'      -> { tuple: [2026, 8, 17, 73947], nightly: false }
 *
 * (Number() eats the zero-padding; the dev tail is ordering-irrelevant for
 * this module's purposes - see compareVersionStrings.)
 *
 * @param {*} v version string in either spelling
 * @returns {{tuple: number[], nightly: boolean} | null} null when unsafe/unparseable
 */
function parseVersionTuple(v) {
  if (!isSafeVersionString(v)) return null;
  const nightly = NIGHTLY_SUFFIX_PATTERN.test(v);
  const core = nightly ? v.replace(NIGHTLY_SUFFIX_PATTERN, '') : v;
  return { tuple: core.split('.').map(Number), nightly };
}

/**
 * Numeric-tuple comparison of two version strings; missing trailing
 * segments compare as 0 (so '2026.7' == '2026.7.0'). The dev suffix is
 * IGNORED for ordering: this module never needs PEP 440's "dev sorts
 * before its release" rule, because the two channels are ranked separately
 * (pickChannelVersions) and equality across spellings is exactly what the
 * self-report check needs. An unparseable side sorts LOWEST (never wins a
 * "newer than" comparison, never reads as an available update).
 *
 * @param {*} a version string
 * @param {*} b version string
 * @returns {number} negative / 0 / positive as a < b / a == b / a > b
 */
function compareVersionStrings(a, b) {
  const pa = parseVersionTuple(a);
  const pb = parseVersionTuple(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;
  const len = Math.max(pa.tuple.length, pb.tuple.length);
  for (let i = 0; i < len; i++) {
    const va = i < pa.tuple.length ? pa.tuple[i] : 0;
    const vb = i < pb.tuple.length ? pb.tuple[i] : 0;
    if (va !== vb) return va < vb ? -1 : 1;
  }
  return 0;
}

/**
 * Are these the same release, across spellings? This is the health probe's
 * "did the binary we installed self-report the version we asked for" check
 * and the UI's "is the installed engine already the latest" check.
 *
 * @param {*} a version string
 * @param {*} b version string
 * @returns {boolean} true only when BOTH parse and their tuples match
 */
function versionsEqual(a, b) {
  return Boolean(parseVersionTuple(a)) && Boolean(parseVersionTuple(b)) &&
    compareVersionStrings(a, b) === 0;
}

/**
 * Is `latest` strictly newer than `current`? False whenever `latest` is
 * unparseable (an unknown latest must never render an update prompt), and
 * true when `current` is unparseable but `latest` is fine (an engine that
 * cannot self-report a sane version deserves the update path).
 *
 * @param {*} current the installed/bundled engine's version string
 * @param {*} latest the channel's latest version string (PyPI spelling)
 * @returns {boolean}
 */
function isUpdateAvailable(current, latest) {
  if (!parseVersionTuple(latest)) return false;
  return compareVersionStrings(latest, current) > 0;
}

/**
 * Rank a parsed PyPI JSON document (https://pypi.org/pypi/yt-dlp/json) into
 * the two channels' latest versions. Defensive on every axis: only own
 * string keys of `releases` are considered (a crafted `__proto__` key must
 * not walk the prototype chain); keys failing the charset gate are skipped;
 * a release with no files, or with EVERY file yanked, is uninstallable /
 * known-bad and is skipped too.
 *
 * @param {*} doc the parsed PyPI JSON document (untrusted)
 * @returns {{stable: string|null, nightly: string|null}} latest per channel, PyPI spelling
 */
function pickChannelVersions(doc) {
  const out = { stable: null, nightly: null };
  const releases = doc && typeof doc === 'object' && doc.releases &&
    typeof doc.releases === 'object' && !Array.isArray(doc.releases)
    ? doc.releases : null;
  if (!releases) return out;
  for (const key of Object.keys(releases)) {
    if (!isSafeVersionString(key)) continue;
    const files = releases[key];
    if (!Array.isArray(files) || files.length === 0) continue;
    if (files.every((f) => f && f.yanked === true)) continue;
    const slot = NIGHTLY_SUFFIX_PATTERN.test(key) ? 'nightly' : 'stable';
    if (out[slot] === null || compareVersionStrings(key, out[slot]) > 0) {
      out[slot] = key;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Persisted state
// ---------------------------------------------------------------------------

function defaultState() {
  return {
    // The admin's INTENT - which channel this instance is pinned to.
    channel: 'bundled',
    // The daily-check opt-in (the ruling's term 4: DEFAULT OFF).
    autoUpdate: false,
    // What the venv currently holds: { version (PyPI spelling), reported
    // (the binary's normalized self-report, from the health probe), channel,
    // installedAt } or null when nothing was ever installed (or the last
    // install failed and the venv content is no longer trusted).
    installed: null,
    // Which engine spawns actually use: 'bundled' | 'venv'. Diverges from
    // `channel` only while an install is pending/failed or after a revert.
    active: 'bundled',
    // Epoch ms of the last completed update check (manual or daily), or null.
    lastCheckAt: null,
    // The last install/update/check outcome, for the Setup status line:
    // { at, ok, action, version, message } or null. Strings bounded.
    lastResult: null,
    // The last auto-revert, until the next successful activation:
    // { fromVersion, reason, at } or null. Strings bounded.
    revert: null,
  };
}

function boundedText(v) {
  return typeof v === 'string' ? v.slice(0, MAX_TEXT_LENGTH) : '';
}

function finitePositiveOrNull(v) {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * Coerce anything (a hand-edited, truncated-then-reparsed, or hostile
 * state.json) into a state object every consumer can trust. Unknown fields
 * are dropped; invalid fields fall to their defaults; and the one CROSS-
 * FIELD invariant is enforced here so no caller ever re-checks it:
 * `active === 'venv'` requires a well-formed `installed` record, else the
 * engine falls back to bundled (never a venv pointer at nothing).
 *
 * @param {*} raw whatever JSON.parse produced
 * @returns {object} a complete, valid state object
 */
function sanitizeState(raw) {
  const state = defaultState();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return state;
  if (CHANNELS.includes(raw.channel)) state.channel = raw.channel;
  state.autoUpdate = raw.autoUpdate === true;
  const inst = raw.installed;
  if (inst && typeof inst === 'object' && !Array.isArray(inst) &&
      isSafeVersionString(inst.version) &&
      (inst.channel === 'stable' || inst.channel === 'nightly')) {
    state.installed = {
      version: inst.version,
      reported: isSafeVersionString(inst.reported) ? inst.reported : null,
      channel: inst.channel,
      installedAt: finitePositiveOrNull(inst.installedAt),
    };
  }
  if (raw.active === 'venv' && state.installed) state.active = 'venv';
  state.lastCheckAt = finitePositiveOrNull(raw.lastCheckAt);
  const lr = raw.lastResult;
  if (lr && typeof lr === 'object' && !Array.isArray(lr)) {
    state.lastResult = {
      at: finitePositiveOrNull(lr.at),
      ok: lr.ok === true,
      action: boundedText(lr.action),
      version: isSafeVersionString(lr.version) ? lr.version : null,
      message: boundedText(lr.message),
    };
  }
  const rv = raw.revert;
  if (rv && typeof rv === 'object' && !Array.isArray(rv)) {
    state.revert = {
      fromVersion: isSafeVersionString(rv.fromVersion) ? rv.fromVersion : null,
      reason: boundedText(rv.reason),
      at: finitePositiveOrNull(rv.at),
    };
  }
  return state;
}

/**
 * Read + sanitize the persisted state. A missing file (fresh install, or
 * the feature never touched), unreadable file, or garbage content all yield
 * the default state - never throws, never creates anything on disk.
 *
 * @param {*} dataDir absolute path to the app's data directory
 * @returns {object} a complete, valid state object
 */
function readState(dataDir) {
  if (typeof dataDir !== 'string' || dataDir === '') return defaultState();
  let raw;
  try {
    raw = fs.readFileSync(resolveStatePath(dataDir), 'utf8');
  } catch (_) {
    return defaultState();
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (_) {
    return defaultState();
  }
  return sanitizeState(parsed);
}

/**
 * Persist state atomically (temp + fsync + rename in the same directory -
 * the saveDatabase/runlog posture: a crash leaves the OLD file intact or
 * the NEW one, never a torn write). Creates `<dataDir>/ytdlp-engine/`
 * lazily. The state is sanitized on the way OUT too, so a buggy caller can
 * never persist a shape readState would then have to repair.
 *
 * Degrades gracefully (logs, returns false) on any fs failure - a lost
 * state write must never crash a poll or a route handler.
 *
 * @param {*} dataDir absolute path to the app's data directory
 * @param {*} state the state object to persist
 * @returns {boolean} true when the rename landed
 */
function writeState(dataDir, state) {
  if (typeof dataDir !== 'string' || dataDir === '') return false;
  const filePath = resolveStatePath(dataDir);
  const tmp = `${filePath}.${process.pid}.${stateTmpSeq++}.tmp`;
  try {
    fs.mkdirSync(resolveEngineDir(dataDir), { recursive: true });
    const json = JSON.stringify(sanitizeState(state), null, 2) + '\n';
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeFileSync(fd, json, 'utf8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, filePath);
    return true;
  } catch (err) {
    console.error('Error writing yt-dlp engine state:', err);
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch (cleanupErr) {
      console.error('Error cleaning up temp engine-state file:', cleanupErr);
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// T2: the install/probe runner (every spawn injectable, every failure honest)
// ---------------------------------------------------------------------------

// Deliberately required as a whole module and dereferenced at call time so
// tests can monkey-patch `require('child_process').spawn` - the exact
// `lib/ytdlp/run.js` seam, kept identical so one test idiom covers both.
const cp = require('child_process');

// PyPI metadata: host PINNED to pypi.org over https - the engine never
// follows a configurable index URL (that would widen the supply-chain
// surface this wave deliberately keeps narrow; the trade-off itself is
// disclosed in README/ROADMAP). Measured live 2026-08-18: the yt-dlp doc is
// ~1.2 MB across 629 releases, so the 8 MB cap is ~7x headroom while still
// bounding a hostile/broken response.
const PYPI_URL = 'https://pypi.org/pypi/yt-dlp/json';
const PYPI_TIMEOUT_MS = 15 * 1000;
const PYPI_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const PYPI_CACHE_TTL_MS = 30 * 60 * 1000;

// Process timeouts. pip resolves + downloads one small wheel; venv creation
// copies/links an interpreter; the probe is `--version`. All bounded, all
// SIGKILLed on expiry - a wedged pip must never wedge the FIFO gate.
const VENV_CREATE_TIMEOUT_MS = 2 * 60 * 1000;
const PIP_INSTALL_TIMEOUT_MS = 10 * 60 * 1000;
const PROBE_TIMEOUT_MS = 30 * 1000;
const PYTHON_CHECK_TIMEOUT_MS = 10 * 1000;

// Bounded output tails (the run.js stderr-tail posture): enough to diagnose
// a pip/probe failure, never an unbounded buffer.
const OUTPUT_TAIL_LIMIT = 8 * 1024;

// Module-level runtime caches, all reset by _resetForTests():
// - pypiCache: the picked channel-latest pair (never the raw 1MB doc).
// - supportCache: is python3 usable here at all (bare-metal degrade).
// - bundledVersionCache: the image/system binary's self-report (the Setup
//   section shows it side by side with the channels; the existing ytdlp
//   version cache tracks the ACTIVE binary, which may be the venv's).
let pypiCache = null;
let supportCache = null;
let bundledVersionCache = null;

// T3: the spawn-seam runtime. `run.js` resolves the binary through
// `activeBinaryPath()` at EVERY spawn; until `initRuntime` is called (by
// `registerRoutes`/`startBackground`, T4/T6) the module answers with the
// bundled binary - so importing server.js for tests, and every deployment
// that never opts in, spawns exactly what it spawned before this wave.
let runtime = { dataDir: null, onAutoRevert: null, isInstallActive: null };

// Test-only seam for the PyPI fetch: route handlers call fetchChannelLatest
// with no deps, so integration tests running the REAL app need a module-
// level override to keep pypi.org off the wire (the run.js child_process
// deref idiom, applied to fetch).
let fetchImplOverrideForTests = null;

function _setFetchImplForTests(fn) {
  fetchImplOverrideForTests = typeof fn === 'function' ? fn : null;
}

function _resetForTests() {
  pypiCache = null;
  supportCache = null;
  bundledVersionCache = null;
  runtime = { dataDir: null, onAutoRevert: null, isInstallActive: null };
  fetchImplOverrideForTests = null;
}

function nowOf(deps) {
  return deps && typeof deps.now === 'function' ? deps.now() : Date.now();
}

/**
 * Spawn one bounded engine-management process (python/venv/pip/probe -
 * NEVER a media download; those stay in run.js). Resolves - never rejects -
 * with `{ ok, code, timedOut, stdout, stderr, error }`, stdout/stderr kept
 * as bounded TAILS. No shell, ever.
 *
 * @param {string} command binary to spawn
 * @param {string[]} args argv (already validated by the caller)
 * @param {object} opts { timeoutMs, phaseLabel }
 * @returns {Promise<object>}
 */
function runEngineProcess(command, args, opts = {}) {
  const timeoutMs = opts.timeoutMs || PROBE_TIMEOUT_MS;
  const phaseLabel = opts.phaseLabel || 'engine';
  return new Promise((resolve) => {
    let child;
    try {
      child = cp.spawn(command, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        // Deliberately NO `shell` key: spawn defaults to `shell: false`.
      });
    } catch (err) {
      resolve({ ok: false, code: null, timedOut: false, stdout: '', stderr: '', error: err.message });
      return;
    }
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    // Deliberately NOT unref'd: this per-operation timer is always cleared
    // in finish() (close/error both land there), so it can never outlive
    // the child - and it must be able to keep the loop alive to SIGKILL a
    // wedged pip. Only long-lived ARMED timers get the unref treatment.
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGKILL'); } catch (_) { /* already gone */ }
    }, timeoutMs);
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    child.stdout.on('data', (chunk) => {
      stdout = (stdout + chunk.toString()).slice(-OUTPUT_TAIL_LIMIT);
    });
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-OUTPUT_TAIL_LIMIT);
    });
    child.on('error', (err) => {
      finish({ ok: false, code: null, timedOut, stdout, stderr, error: err.message });
    });
    child.on('close', (code) => {
      finish({
        ok: !timedOut && code === 0,
        code,
        timedOut,
        stdout,
        stderr,
        error: timedOut ? `${phaseLabel} timed out after ${Math.round(timeoutMs / 1000)}s` : null,
      });
    });
  });
}

/**
 * Can this host run the engine selector at all? Requires a spawnable
 * `python3` (the spawn comes from the module's child_process seam). Cached
 * for the process lifetime (interpreters do not appear mid-run; a fresh
 * check is one `_resetForTests()` away in tests). Bare metal without
 * python3 = `{ supported: false, reason }` - the Setup section renders the
 * honest message and the feature degrades; boot is never blocked (nothing
 * here runs at import).
 *
 * @returns {Promise<{supported: boolean, reason: string|null}>}
 */
async function getSupportInfo() {
  if (supportCache) return supportCache;
  const result = await runEngineProcess('python3', ['--version'], {
    timeoutMs: PYTHON_CHECK_TIMEOUT_MS, phaseLabel: 'python check',
  });
  supportCache = result.ok
    ? { supported: true, reason: null }
    : { supported: false, reason: 'python3 is not available on this system, so alternate downloader engines cannot be installed. The bundled engine stays in use.' };
  return supportCache;
}

/**
 * The bundled binary's self-reported version (side-by-side display). Same
 * `--version` probe the ytdlp module uses, but ALWAYS against the bare
 * `yt-dlp` on PATH - the active engine may be the venv's. Cached 6h like
 * the ytdlp version cache; null when the bundled binary is absent/broken
 * (bare metal without yt-dlp).
 *
 * @param {object} [deps] { now? }
 * @returns {Promise<string|null>}
 */
async function getBundledVersion(deps = {}) {
  const now = nowOf(deps);
  if (bundledVersionCache && now - bundledVersionCache.at < 6 * 60 * 60 * 1000) {
    return bundledVersionCache.version;
  }
  const result = await runEngineProcess(BUNDLED_BINARY, ['--version'], {
    timeoutMs: PROBE_TIMEOUT_MS, phaseLabel: 'bundled version check',
  });
  const version = result.ok && isSafeVersionString(result.stdout.trim()) ? result.stdout.trim() : null;
  bundledVersionCache = { at: now, version };
  return version;
}

/**
 * Fetch + rank the PyPI channel metadata, TTL-cached. Never throws; never
 * blocks anything but its caller; offline/malformed/oversized responses
 * yield `{ stable: null, nightly: null, error }` and the UI shows bundled
 * only (the ruling's term 5). Only the RANKED pair is cached, never the
 * raw megabyte document.
 *
 * @param {object} [deps] { fetchImpl?, now?, force? }
 * @returns {Promise<{stable: string|null, nightly: string|null, checkedAt: number, error: string|null}>}
 */
async function fetchChannelLatest(deps = {}) {
  const now = nowOf(deps);
  if (!deps.force && pypiCache && now - pypiCache.checkedAt < PYPI_CACHE_TTL_MS) {
    return pypiCache;
  }
  const fetchImpl = deps.fetchImpl || fetchImplOverrideForTests || globalThis.fetch;
  let outcome;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PYPI_TIMEOUT_MS);
    if (timer.unref) timer.unref();
    try {
      const res = await fetchImpl(PYPI_URL, {
        signal: controller.signal,
        headers: { accept: 'application/json' },
      });
      if (!res || !res.ok) {
        outcome = { stable: null, nightly: null, error: `PyPI responded ${res ? res.status : 'with nothing'}` };
      } else {
        let size = 0;
        const chunks = [];
        let oversized = false;
        for await (const chunk of res.body) {
          size += chunk.length;
          if (size > PYPI_MAX_RESPONSE_BYTES) {
            oversized = true;
            controller.abort();
            break;
          }
          chunks.push(chunk);
        }
        if (oversized) {
          outcome = { stable: null, nightly: null, error: 'PyPI response exceeded the size cap' };
        } else {
          const doc = JSON.parse(Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8'));
          const picked = pickChannelVersions(doc);
          outcome = { stable: picked.stable, nightly: picked.nightly, error: null };
        }
      }
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    outcome = { stable: null, nightly: null, error: `PyPI check failed: ${err && err.message ? err.message : 'unknown error'}` };
  }
  pypiCache = { ...outcome, checkedAt: now };
  return pypiCache;
}

/**
 * The cached PyPI ranking WITHOUT any network - null when nothing was ever
 * fetched. POST responses use this so a settings write never waits on (or
 * fails with) the network.
 *
 * @returns {object|null}
 */
function peekChannelLatest() {
  return pypiCache;
}

/**
 * Ensure the persistent venv exists and decide which pip drives the
 * install. Preference order (the Alpine-ensurepip defense-in-depth chain,
 * unverifiable on the dev box and therefore layered):
 *   1. `python3 -m venv --clear` and the venv's own pip -> 'venv'
 *   2. venv created but pip missing -> system `python3 -m pip --python`
 *      targeting the venv interpreter -> 'system'
 *   3. plain venv creation failed -> `python3 -m venv --without-pip
 *      --clear` + the system pip route -> 'system'
 * Any dead end returns `{ ok: false, message }` honestly.
 *
 * @param {string} dataDir
 * @returns {Promise<{ok: boolean, pipMode?: 'venv'|'system', message?: string}>}
 */
async function ensureVenv(dataDir) {
  const venvDir = resolveVenvDir(dataDir);
  const create = await runEngineProcess('python3', ['-m', 'venv', '--clear', venvDir], {
    timeoutMs: VENV_CREATE_TIMEOUT_MS, phaseLabel: 'venv create',
  });
  if (create.ok) {
    if (fs.existsSync(resolveVenvPipPath(dataDir))) return { ok: true, pipMode: 'venv' };
    // venv module worked but ensurepip did not seed a pip - fall through to
    // the system-pip route against the venv interpreter we DID get.
    if (fs.existsSync(resolveVenvPythonPath(dataDir))) return { ok: true, pipMode: 'system' };
    return { ok: false, message: 'venv creation produced no usable interpreter' };
  }
  const bare = await runEngineProcess('python3', ['-m', 'venv', '--without-pip', '--clear', venvDir], {
    timeoutMs: VENV_CREATE_TIMEOUT_MS, phaseLabel: 'venv create (without pip)',
  });
  if (bare.ok && fs.existsSync(resolveVenvPythonPath(dataDir))) return { ok: true, pipMode: 'system' };
  const detail = (create.stderr || create.error || bare.stderr || bare.error || 'unknown error').trim();
  return { ok: false, message: `could not create the engine environment: ${detail.slice(0, MAX_TEXT_LENGTH)}` };
}

/**
 * Run the pip install for an exact, ALREADY charset-validated version pin.
 * argv is array-form with no shell anywhere; `--no-cache-dir` keeps
 * DATA_DIR growth bounded (one venv, no wheel cache - the disk-growth
 * attack surface).
 */
async function pipInstall(dataDir, version, pipMode) {
  const spec = `yt-dlp==${version}`;
  const common = ['install', '--no-cache-dir', '--disable-pip-version-check', spec];
  if (pipMode === 'venv') {
    return runEngineProcess(resolveVenvPipPath(dataDir), common, {
      timeoutMs: PIP_INSTALL_TIMEOUT_MS, phaseLabel: 'pip install',
    });
  }
  return runEngineProcess('python3', ['-m', 'pip', '--python', resolveVenvPythonPath(dataDir), ...common], {
    timeoutMs: PIP_INSTALL_TIMEOUT_MS, phaseLabel: 'pip install (system pip)',
  });
}

/**
 * The health probe (the ruling's term 3, install-time half): the freshly
 * installed binary must run AND self-report the version we asked for,
 * compared through the tuple normalizer (PyPI vs self-report spelling).
 * Version-only BY DESIGN - a network extraction probe would flake offline
 * and against YouTube's mood; the runtime failure hook (T3) is the second
 * net for "runs but broken".
 *
 * @returns {Promise<{ok: boolean, reported: string|null, message: string}>}
 */
async function probeInstalledBinary(dataDir, expectedVersion) {
  const result = await runEngineProcess(resolveVenvBinaryPath(dataDir), ['--version'], {
    timeoutMs: PROBE_TIMEOUT_MS, phaseLabel: 'health probe',
  });
  const reported = result.ok ? result.stdout.trim() : null;
  if (!result.ok) {
    const detail = (result.stderr || result.error || `exit code ${result.code}`).trim();
    return { ok: false, reported: null, message: `health probe failed: ${detail.slice(0, MAX_TEXT_LENGTH)}` };
  }
  if (!isSafeVersionString(reported)) {
    return { ok: false, reported: null, message: 'health probe failed: the binary did not report a recognizable version' };
  }
  if (!versionsEqual(reported, expectedVersion)) {
    return { ok: false, reported, message: `health probe failed: installed binary reports ${reported}, expected ${expectedVersion}` };
  }
  return { ok: true, reported, message: 'healthy' };
}

/**
 * Install `version` for `channel` into the persistent venv and - only on a
 * passed health probe - activate it. MUST be called inside the FIFO
 * runExclusive gate (the caller's job, T4/T6): an install rewrites the venv
 * binary in place and must never race a gated spawn.
 *
 * State honesty on failure: if pip TOUCHED the venv and anything after
 * that failed, the venv contents are no longer trusted - `installed` is
 * cleared and `active` falls to bundled (with a revert record when the
 * venv was the active engine). A failure BEFORE the venv was touched
 * (support missing, PyPI down, bad version string) leaves the existing
 * engine exactly as it was.
 *
 * @param {object} opts { dataDir, version (PyPI spelling), channel, deps? }
 * @returns {Promise<{ok: boolean, version: string, reported: string|null, message: string, becameActive: boolean, reverted: boolean}>}
 */
async function installEngine(opts) {
  const { dataDir, version, channel } = opts;
  const deps = opts.deps || {};
  const fail = (message, extra) => ({
    ok: false, version, reported: null, message, becameActive: false, reverted: false, ...extra,
  });
  if (channel !== 'stable' && channel !== 'nightly') return fail(`unknown channel: ${String(channel)}`);
  if (!isSafeVersionString(version)) return fail('refusing to install: version string failed validation');
  const support = await getSupportInfo();
  if (!support.supported) return fail(support.reason);

  const prior = readState(dataDir);
  const wasVenvActive = prior.active === 'venv';
  const priorVersion = prior.installed ? prior.installed.version : null;

  // From ensureVenv onward the venv is TOUCHED (`--clear` destroys the old
  // contents BEFORE recreating, even when creation then fails): any failure
  // from here down must demote it - its contents are no longer trusted.
  const demote = (message) => {
    const state = readState(dataDir);
    state.installed = null;
    state.active = 'bundled';
    if (wasVenvActive) {
      state.revert = { fromVersion: priorVersion, reason: boundedText(message), at: nowOf(deps) };
    }
    state.lastResult = { at: nowOf(deps), ok: false, action: 'install', version, message: boundedText(message) };
    writeState(dataDir, state);
    return fail(message, { reverted: wasVenvActive });
  };

  const venv = await ensureVenv(dataDir);
  if (!venv.ok) return demote(venv.message);

  const install = await pipInstall(dataDir, version, venv.pipMode);
  if (!install.ok) {
    const detail = (install.stderr || install.error || `exit code ${install.code}`).trim();
    return demote(`install failed: ${detail.slice(0, MAX_TEXT_LENGTH)}`);
  }
  const probe = await probeInstalledBinary(dataDir, version);
  if (!probe.ok) return demote(probe.message);

  const state = readState(dataDir);
  state.installed = { version, reported: probe.reported, channel, installedAt: nowOf(deps) };
  state.active = 'venv';
  state.revert = null;
  state.lastResult = {
    at: nowOf(deps), ok: true, action: 'install', version,
    message: `installed ${probe.reported} (${channel}) and passed the health check`,
  };
  writeState(dataDir, state);
  return { ok: true, version, reported: probe.reported, message: state.lastResult.message, becameActive: true, reverted: false };
}

/**
 * Persist the admin's channel INTENT (the T4 routes' one writer). Choosing
 * 'bundled' takes effect immediately (active flips, any revert record is
 * cleared - a conscious choice is not a revert); choosing stable/nightly
 * records the intent only - activation happens when the gated install job
 * passes its health probe. An unknown channel is a no-op (the route
 * validates first; this is the belt to its suspenders).
 *
 * @param {object} opts { dataDir, channel }
 * @returns {object} the persisted state
 */
function setChannelIntent(opts) {
  const { dataDir, channel } = opts;
  const state = readState(dataDir);
  if (!CHANNELS.includes(channel)) return state;
  state.channel = channel;
  if (channel === 'bundled') {
    state.active = 'bundled';
    state.revert = null;
  }
  writeState(dataDir, state);
  return state;
}

/**
 * Persist the daily auto-update opt-in (strict boolean; term 4 of the
 * ruling - the default is OFF and only an explicit true turns it on).
 *
 * @param {object} opts { dataDir, enabled }
 * @returns {object} the persisted state
 */
function setAutoUpdate(opts) {
  const state = readState(opts.dataDir);
  state.autoUpdate = opts.enabled === true;
  writeState(opts.dataDir, state);
  return state;
}

/**
 * The AUTO-REVERT (the ruling's term 3, runtime half): flip the ACTIVE
 * engine back to bundled because the venv engine failed, recording why.
 * The channel INTENT survives - the admin's choice is not silently
 * rewritten - but `installed` is cleared so nothing (boot reconcile
 * included) re-activates the distrusted venv without a fresh install +
 * probe. Already-bundled calls are no-ops (no thrash, no spurious revert
 * records). The venv files are left on disk - the next install --clear's.
 *
 * @param {object} opts { dataDir, reason, deps? }
 * @returns {object} the persisted state
 */
function activateBundled(opts) {
  const { dataDir } = opts;
  const deps = opts.deps || {};
  const state = readState(dataDir);
  if (state.active !== 'venv') return state;
  state.active = 'bundled';
  state.revert = {
    fromVersion: state.installed ? state.installed.version : null,
    reason: boundedText(typeof opts.reason === 'string' ? opts.reason : 'engine failure'),
    at: nowOf(deps),
  };
  state.installed = null;
  writeState(dataDir, state);
  return state;
}

// ---------------------------------------------------------------------------
// T3: the spawn seam + the runtime failure net
// ---------------------------------------------------------------------------

/**
 * Bind the engine module to the app's data directory (and, optionally, an
 * auto-revert callback for the bell plus an install-phase probe for the
 * failure net's suppression window - gate round 1 W4). Idempotent; called
 * from both deps bundles like every other dataDir threading in this family.
 *
 * @param {object} opts { dataDir, onAutoRevert?, isInstallActive? }
 */
function initRuntime(opts = {}) {
  runtime.dataDir = typeof opts.dataDir === 'string' && opts.dataDir !== '' ? opts.dataDir : null;
  runtime.onAutoRevert = typeof opts.onAutoRevert === 'function' ? opts.onAutoRevert : null;
  runtime.isInstallActive = typeof opts.isInstallActive === 'function' ? opts.isInstallActive : null;
}

/**
 * The binary run.js spawns RIGHT NOW. Bundled unless the runtime is bound,
 * the persisted state says the venv engine is active, AND the venv binary
 * actually exists on disk (a wiped/corrupt venv falls back to bundled at
 * the spawn seam itself - the last line of the never-worse-than-bundled
 * guarantee; the boot reconcile and failure net then make it official).
 * Reads state.json per call - spawns are seconds-apart events at most, and
 * a fresh read means a swap can never be half-seen.
 *
 * @returns {string} an absolute venv binary path, or the bare 'yt-dlp'
 */
function activeBinaryPath() {
  if (!runtime.dataDir) return BUNDLED_BINARY;
  const state = readState(runtime.dataDir);
  if (state.active !== 'venv') return BUNDLED_BINARY;
  const bin = resolveVenvBinaryPath(runtime.dataDir);
  return fs.existsSync(bin) ? bin : BUNDLED_BINARY;
}

// What counts as the ENGINE failing, as opposed to a download failing (the
// ruling's term 3, runtime half - and the thrash-loop surface, closed by
// being deliberately NARROW):
//   1. Spawn-level failure (code null + an error): the binary never ran at
//      all - ENOENT/EACCES, a venv python whose interpreter vanished under
//      an image upgrade (the shebang exec fails the spawn itself).
//   2. An IMPORT-time Python crash: a traceback ending in
//      ModuleNotFoundError/ImportError (site-packages no longer match the
//      interpreter) or SyntaxError (gate round 1 W3: a nightly that
//      requires a newer Python than the venv's dies with a raw SyntaxError
//      traceback on EVERY spawn - an engine-startup shape; ordinary
//      download failures print `ERROR:` lines, never raw SyntaxError
//      tracebacks) - the engine cannot start.
// Everything else - 403s, "video unavailable", timeouts, stalls, even a
// mid-extraction AttributeError/TypeError traceback on one weird video -
// is a DOWNLOAD failure and must never revert the channel choice (the
// Attribute/TypeError residue is the DISCLOSED deliberate narrowness:
// those shapes occur mid-extraction on individual videos, so treating
// them as engine death would be the thrash surface reopened).
const ENGINE_CRASH_PATTERN = /Traceback \(most recent call last\)[\s\S]*(?:ModuleNotFoundError|ImportError|SyntaxError)/;

/**
 * Classify a completed run.js result: did the ENGINE fail (vs the
 * download)? See the pattern comment above for the deliberate narrowness.
 *
 * @param {*} result a spawnYtdlp/spawnYtdlpDownload result object
 * @returns {boolean}
 */
function looksLikeEngineCrash(result) {
  if (!result || result.ok) return false;
  if (result.code === null && result.error) return true;
  return typeof result.stderr === 'string' && ENGINE_CRASH_PATTERN.test(result.stderr);
}

/**
 * What is EFFECTIVELY active right now - the same existence check the
 * spawn seam applies, so a status surface can never claim a venv engine
 * whose binary is gone (gate round 1 QA W2: wiped volume + PyPI down left
 * the UI saying "(nightly)" while every spawn ran bundled).
 *
 * @param {string} dataDir
 * @param {object} state a readState() result
 * @returns {'bundled'|'venv'}
 */
function effectiveActive(dataDir, state) {
  if (!state || state.active !== 'venv') return 'bundled';
  return fs.existsSync(resolveVenvBinaryPath(dataDir)) ? 'venv' : 'bundled';
}

/**
 * The tiny channel/active summary the About/Stats surface renders (T8) -
 * null when the runtime is unbound (module disabled or pre-boot), which
 * renders as the pre-wave plain version row. `active` is the EFFECTIVE
 * engine (through the seam's existence check), never a wish.
 *
 * @returns {{channel: string, active: string} | null}
 */
function runtimeStateSummary() {
  if (!runtime.dataDir) return null;
  const state = readState(runtime.dataDir);
  return { channel: state.channel, active: effectiveActive(runtime.dataDir, state) };
}

/**
 * The runtime failure report (run.js calls this fire-and-forget from its
 * settle path). No-ops unless the failing binary IS the currently-active
 * venv engine - a bundled failure never reverts anything, and a report
 * racing an already-completed revert is idempotent. On a real revert the
 * registered onAutoRevert callback fires (the bell + version-cache refresh
 * live there, T4/T6), shielded so it can never break the reporter.
 *
 * @param {object} opts { binaryUsed, reason }
 * @returns {boolean} true when a revert actually happened
 */
function reportEngineFailure(opts = {}) {
  if (!runtime.dataDir) return false;
  if (opts.binaryUsed !== resolveVenvBinaryPath(runtime.dataDir)) return false;
  // Gate round 1 W4 (measured false-revert): while an install job is
  // rewriting the venv in place, an UNGATED spawn (version-cache probe,
  // one-shot channel probe) can fail against the half-written binary and
  // must not be read as engine death. Downloads are all gated, so no
  // LEGITIMATE crash report can originate during the install phase - the
  // suppression is exactly scoped; the install's own health probe decides
  // the engine's fate.
  if (runtime.isInstallActive && runtime.isInstallActive() === true) return false;
  if (readState(runtime.dataDir).active !== 'venv') return false;
  const reason = typeof opts.reason === 'string' && opts.reason !== ''
    ? opts.reason : 'the engine failed at runtime';
  const state = activateBundled({ dataDir: runtime.dataDir, reason });
  if (runtime.onAutoRevert) {
    try {
      runtime.onAutoRevert({
        fromVersion: state.revert ? state.revert.fromVersion : null,
        reason: state.revert ? state.revert.reason : reason,
      });
    } catch (err) {
      console.error('Engine onAutoRevert callback threw (ignored):', err && err.message);
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// T5: bell-event vocabulary. Engine events ride the existing notification
// feed as kind 'engine' rows whose media_id ENCODES the whole (bounded)
// payload - `engine:<event>:<version>` - so no schema bump is needed and
// the feed's replace-on-same-id semantics dedupe repeats for free. The id
// is parsed DEFENSIVELY on the way out (a crafted admin backup bundle can
// plant arbitrary feed rows; a malformed engine id renders nothing, never
// garbage).
// ---------------------------------------------------------------------------

const ENGINE_EVENTS = ['updated', 'update-failed', 'reverted'];

/**
 * Build a feed id for an engine event. Null (record nothing) rather than a
 * malformed id when the version fails the charset gate.
 *
 * @param {string} event one of ENGINE_EVENTS
 * @param {*} version the engine version involved, or null when unknown
 * @returns {string|null}
 */
function buildEngineNotificationId(event, version) {
  if (!ENGINE_EVENTS.includes(event)) return null;
  const v = isSafeVersionString(version) ? version : 'unknown';
  return `engine:${event}:${v}`;
}

/**
 * Parse a feed id back into `{ event, version }` (version null when it was
 * recorded as unknown). Null for anything that is not a well-formed engine
 * id - the read-side defense.
 *
 * @param {*} id the feed row's media_id
 * @returns {{event: string, version: string|null} | null}
 */
function parseEngineNotificationId(id) {
  if (typeof id !== 'string') return null;
  const m = /^engine:([a-z-]+):(.+)$/.exec(id);
  if (!m || !ENGINE_EVENTS.includes(m[1])) return null;
  if (m[2] === 'unknown') return { event: m[1], version: null };
  return isSafeVersionString(m[2]) ? { event: m[1], version: m[2] } : null;
}

/**
 * The human line the bell panel shows for an engine event - plain words,
 * matching the ruling's own phrasing ("updated to X" / "failed health
 * check, reverted to bundled").
 *
 * @param {string} event one of ENGINE_EVENTS
 * @param {*} version version string or null
 * @returns {string}
 */
function describeEngineEvent(event, version) {
  const v = isSafeVersionString(version) ? version : null;
  if (event === 'updated') return `Downloader engine updated to ${v || 'a new version'}`;
  if (event === 'update-failed') {
    return `Downloader engine ${v ? v + ' ' : ''}failed its health check - the bundled engine stays in use`;
  }
  return `Downloader engine ${v ? v + ' ' : ''}stopped working - reverted to the bundled engine`;
}

module.exports = {
  // constants
  BUNDLED_BINARY,
  CHANNELS,
  PYPI_URL,
  PYPI_MAX_RESPONSE_BYTES,
  PYPI_CACHE_TTL_MS,
  // paths
  resolveEngineDir,
  resolveStatePath,
  resolveVenvDir,
  resolveVenvBinaryPath,
  resolveVenvPythonPath,
  resolveVenvPipPath,
  // versions
  isSafeVersionString,
  parseVersionTuple,
  compareVersionStrings,
  versionsEqual,
  isUpdateAvailable,
  pickChannelVersions,
  // state
  defaultState,
  sanitizeState,
  readState,
  writeState,
  // runner (T2)
  runEngineProcess,
  getSupportInfo,
  getBundledVersion,
  fetchChannelLatest,
  peekChannelLatest,
  ensureVenv,
  probeInstalledBinary,
  installEngine,
  setChannelIntent,
  setAutoUpdate,
  activateBundled,
  // spawn seam (T3)
  initRuntime,
  activeBinaryPath,
  effectiveActive,
  runtimeStateSummary,
  looksLikeEngineCrash,
  reportEngineFailure,
  // bell-event vocabulary (T5)
  buildEngineNotificationId,
  parseEngineNotificationId,
  describeEngineEvent,
  _resetForTests,
  _setFetchImplForTests,
};
