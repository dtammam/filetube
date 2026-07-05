'use strict';

// Defensive ENV parsing for the optional yt-dlp subscription module. Mirrors
// server.js's `parseCacheCap` pattern (server.js:199): an invalid or unset
// value falls back to a documented default, and nothing here ever throws at
// startup. This file only DEFINES functions -- requiring it has no side
// effects (no fs, no timers, no route registration), which is what lets
// `require('./lib/ytdlp')` stay safe to import even when the module is
// disabled (locked_decisions D1: exactly these five ENV vars, no more).

const path = require('path');

// Background poll interval default (minutes) when FILETUBE_YTDLP_POLL_MINUTES
// is unset/invalid. `0` is a distinct, valid value meaning "manual re-pull
// only, no scheduled poll" -- it mirrors scanIntervalMinutes's "0 = Off"
// convention (server.js) and is NOT treated as invalid.
const DEFAULT_POLL_MINUTES = 60;

// Subfolder name used to build the default download root when
// FILETUBE_YTDLP_DOWNLOAD_DIR is unset (see `defaultDownloadDir`, below).
const DEFAULT_DOWNLOAD_SUBDIR = 'ytdlp-downloads';

// Only these exact (case-insensitive) strings enable the module -- anything
// else, including unset/empty/'false'/garbage, fails safe to disabled. This
// is deliberately narrower than a generic "truthy" check: an operator typo
// (e.g. FILETUBE_YTDLP_ENABLED=1yes) must never silently enable a feature
// that spawns child processes and writes to the filesystem.
const TRUTHY_VALUES = new Set(['true', '1', 'yes']);

function parseEnabled(raw) {
  if (typeof raw !== 'string') return false;
  return TRUTHY_VALUES.has(raw.trim().toLowerCase());
}

// Non-negative integer; falls back to DEFAULT_POLL_MINUTES on anything
// invalid (unset, empty, non-numeric, negative, non-integer). Never throws.
function parsePollMinutes(raw) {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_POLL_MINUTES;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return DEFAULT_POLL_MINUTES;
  return n;
}

// Trims a string ENV value and treats '' as "not configured" (null) rather
// than an empty string, so callers can use a plain truthiness check. Any
// non-string input (unset env vars are `undefined`) also yields null.
function parseOptionalString(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

// Default download root when FILETUBE_YTDLP_DOWNLOAD_DIR is unset: a
// subfolder alongside the rest of FileTube's persisted state. Mirrors
// server.js's own DATA_DIR resolution (env.DATA_DIR, else the current
// working directory) so downloads default to living next to db.json/
// .thumbnails/transcoded rather than an arbitrary path. This is a STRING
// default only -- no directory is created here (T3/T4 own the real
// presence-check/mkdir, gated behind `isEnabled`).
function defaultDownloadDir(env) {
  const base = (env && typeof env.DATA_DIR === 'string' && env.DATA_DIR.trim() !== '')
    ? env.DATA_DIR
    : process.cwd();
  return path.join(base, DEFAULT_DOWNLOAD_SUBDIR);
}

/**
 * Parse the module's exactly-five locked ENV vars (D1) into a plain config
 * object. Pure and defensive: given any input shape (including a missing/
 * malformed `env`), this never throws.
 * @param {NodeJS.ProcessEnv} [env] defaults to `process.env`
 * @returns {{enabled: boolean, cookiesFile: (string|null), pollMinutes: number,
 *   downloadDir: string, version: (string|null)}}
 */
function parseYtdlpConfig(env = process.env) {
  const source = env && typeof env === 'object' ? env : {};
  return {
    enabled: parseEnabled(source.FILETUBE_YTDLP_ENABLED),
    cookiesFile: parseOptionalString(source.FILETUBE_YTDLP_COOKIES_FILE),
    pollMinutes: parsePollMinutes(source.FILETUBE_YTDLP_POLL_MINUTES),
    downloadDir: parseOptionalString(source.FILETUBE_YTDLP_DOWNLOAD_DIR) || defaultDownloadDir(source),
    version: parseOptionalString(source.FILETUBE_YTDLP_VERSION),
  };
}

// Pure gate: true only when the parsed config's master flag is on. Kept as
// its own function (rather than inlining `config.enabled` everywhere) so the
// "what counts as enabled" decision lives in exactly one place.
function isEnabled(config) {
  return Boolean(config && config.enabled === true);
}

module.exports = {
  parseYtdlpConfig,
  isEnabled,
  DEFAULT_POLL_MINUTES,
};
