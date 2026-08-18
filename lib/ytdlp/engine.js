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
    // What the venv currently holds: { version, channel, installedAt } or
    // null when nothing was ever installed (or the last install failed).
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

module.exports = {
  // constants
  BUNDLED_BINARY,
  CHANNELS,
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
};
