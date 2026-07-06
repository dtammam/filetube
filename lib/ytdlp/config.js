'use strict';

// Defensive ENV parsing for the optional yt-dlp subscription module. Mirrors
// server.js's `parseCacheCap` pattern (server.js:199): an invalid or unset
// value falls back to a documented default, and nothing here ever throws at
// startup. This file only DEFINES functions -- requiring it has no side
// effects (no fs, no timers, no route registration), which is what lets
// `require('./lib/ytdlp')` stay safe to import even when the module is
// disabled.
//
// locked_decisions D1 originally scoped this to exactly five ENV vars. This
// file now parses a SIXTH, `FILETUBE_YTDLP_MAX_VIDEOS` (see
// `parseMaxVideos`/`DEFAULT_MAX_VIDEOS` below), added as part of the v1.11.1
// hotfix for a production bug: an unbounded channel listing could exceed the
// (execFile-era) `maxBuffer` and abort every poll for that channel, and a
// fresh subscribe had no scope limit at all (it would enumerate/attempt the
// entire back-catalog). `FILETUBE_YTDLP_MAX_VIDEOS` bounds the LIST pass to
// the newest N videos (`0` = unlimited/everything, matching this file's other
// "0 = off/unbounded" conventions) -- see lib/ytdlp/args.js's
// `buildYtdlpListArgs` (`--playlist-end`) and lib/ytdlp/run.js's `spawnYtdlp`
// (execFile+maxBuffer -> spawn+streaming) for the rest of the fix. Flagged
// here as a deliberate, reviewed deviation from D1's original "exactly five"
// wording, not an oversight.

const path = require('path');

// Background poll interval default (minutes) when FILETUBE_YTDLP_POLL_MINUTES
// is unset/invalid. `0` is a distinct, valid value meaning "manual re-pull
// only, no scheduled poll" -- it mirrors scanIntervalMinutes's "0 = Off"
// convention (server.js) and is NOT treated as invalid.
const DEFAULT_POLL_MINUTES = 60;

// Default cap (newest N videos) applied to every channel LIST pass when
// FILETUBE_YTDLP_MAX_VIDEOS is unset/invalid. `0` is a distinct, valid value
// meaning "unlimited -- consider the whole channel," mirroring
// `DEFAULT_POLL_MINUTES`'s "0 = manual-only" convention above. 25 was chosen
// as a sane default scope for a fresh subscribe (recent uploads only) rather
// than silently attempting a channel's entire back-catalog.
const DEFAULT_MAX_VIDEOS = 25;

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

// Non-negative integer; falls back to DEFAULT_MAX_VIDEOS on anything invalid
// (unset, empty, non-numeric, negative, non-integer). Never throws. `0` is a
// distinct, valid value meaning "unlimited" -- see `DEFAULT_MAX_VIDEOS`'s
// comment above.
function parseMaxVideos(raw) {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_MAX_VIDEOS;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return DEFAULT_MAX_VIDEOS;
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
 * Parse the module's ENV vars (D1's original five, plus the v1.11.1 hotfix's
 * sixth, `FILETUBE_YTDLP_MAX_VIDEOS`) into a plain config object. Pure and
 * defensive: given any input shape (including a missing/malformed `env`),
 * this never throws.
 * @param {NodeJS.ProcessEnv} [env] defaults to `process.env`
 * @returns {{enabled: boolean, cookiesFile: (string|null), pollMinutes: number,
 *   downloadDir: string, version: (string|null), maxVideos: number}}
 */
function parseYtdlpConfig(env = process.env) {
  const source = env && typeof env === 'object' ? env : {};
  return {
    enabled: parseEnabled(source.FILETUBE_YTDLP_ENABLED),
    cookiesFile: parseOptionalString(source.FILETUBE_YTDLP_COOKIES_FILE),
    pollMinutes: parsePollMinutes(source.FILETUBE_YTDLP_POLL_MINUTES),
    downloadDir: parseOptionalString(source.FILETUBE_YTDLP_DOWNLOAD_DIR) || defaultDownloadDir(source),
    version: parseOptionalString(source.FILETUBE_YTDLP_VERSION),
    // 0 = unlimited (consider the whole channel); see DEFAULT_MAX_VIDEOS.
    maxVideos: parseMaxVideos(source.FILETUBE_YTDLP_MAX_VIDEOS),
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
  DEFAULT_MAX_VIDEOS,
};
