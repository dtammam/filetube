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
// `DEFAULT_POLL_MINUTES`'s "0 = manual-only" convention above. Lowered from
// the original 25 to 3 in v1.18.0 ("25 is just aggro" -- Dean), then from 3
// to 2 in v1.20.0 (Dean: 3 rarely gets hit either -- 2 is a sane default
// scope for a fresh subscribe (recent uploads only) rather than silently
// attempting a channel's entire back-catalog; a user can still raise it
// per-subscription (see lib/ytdlp/store.js's `validateMaxVideos`) or
// globally via FILETUBE_YTDLP_MAX_VIDEOS. This is a default for NEW
// subscriptions only -- it has no effect on already-persisted
// subscriptions, which keep whatever `maxVideos` they were saved with (see
// lib/ytdlp/args.js's `subMaxVideos ?? config.maxVideos` resolution).
const DEFAULT_MAX_VIDEOS = 2;

// v1.22.0 FR-6: default maximum item LENGTH (seconds) applied to every
// channel LIST pass when FILETUBE_YTDLP_MAX_DURATION_SECONDS is unset/
// invalid, bounding download size + transcode time by skipping very long
// items (e.g. 11-20h live streams) before they are ever considered a
// download target. `0` is a distinct, valid value meaning "unbounded --
// consider items of any length," mirroring `DEFAULT_MAX_VIDEOS`'s "0 =
// unlimited" convention EXACTLY (no new sentinel invented -- see
// `parseMaxDurationSeconds` below). 7200 seconds (2 hours) is the documented
// sane default (Dean, v1.22.0 FR-6 fork resolution). This is a default for
// NEW subscriptions only -- it has no effect on already-persisted
// subscriptions, which keep whatever `maxDurationSeconds` they were saved
// with (see lib/ytdlp/args.js's `subMaxDurationSeconds ?? config.maxDurationSeconds`
// resolution).
const DEFAULT_MAX_DURATION_SECONDS = 7200;

// v1.15.1 hotfix: default download-timeout ceiling (minutes) applied to a
// real DOWNLOAD spawn when FILETUBE_YTDLP_DOWNLOAD_TIMEOUT_MINUTES is unset/
// invalid. Raised from the previous hardcoded 60-minute ceiling
// (lib/ytdlp/run.js's old DEFAULT_DOWNLOAD_TIMEOUT_MS): a multi-gigabyte
// video (yt-dlp downloads video+audio as separate streams, then merges them)
// can legitimately take well over an hour on a modest home connection, and
// hitting the old 60-minute ceiling SIGKILLed the child mid-download, always
// leaving partial/intermediate files behind (see lib/ytdlpIntermediates.js).
// 180 minutes (3 hours) is a more realistic ceiling while still being
// FINITE (a hung/wedged/slowloris child is still always eventually
// reclaimed -- SF2 is unaffected, only the duration changed).
const DEFAULT_DOWNLOAD_TIMEOUT_MINUTES = 180;

// Sane bounds for FILETUBE_YTDLP_DOWNLOAD_TIMEOUT_MINUTES: at least 1 minute
// (a `0`/negative timeout would be indistinguishable from "unbounded", which
// SF2 explicitly forbids for a download spawn) and at most 1440 (24 hours) --
// generous for even a very large video/slow connection while still keeping a
// wedged child reclaimable within a day.
const MIN_DOWNLOAD_TIMEOUT_MINUTES = 1;
const MAX_DOWNLOAD_TIMEOUT_MINUTES = 1440;

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

// v1.22.0 FR-6: non-negative integer; falls back to
// DEFAULT_MAX_DURATION_SECONDS on anything invalid (unset, empty,
// non-numeric, negative, non-integer). Never throws. `0` is a distinct,
// valid value meaning "unbounded" -- see `DEFAULT_MAX_DURATION_SECONDS`'s
// comment above. Mirrors `parseMaxVideos` exactly (same shape, same
// semantics, different default/env var).
function parseMaxDurationSeconds(raw) {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_MAX_DURATION_SECONDS;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return DEFAULT_MAX_DURATION_SECONDS;
  return n;
}

// v1.15.1 hotfix: positive integer within [MIN_DOWNLOAD_TIMEOUT_MINUTES,
// MAX_DOWNLOAD_TIMEOUT_MINUTES]; falls back to
// DEFAULT_DOWNLOAD_TIMEOUT_MINUTES on anything invalid (unset, empty,
// non-numeric, non-integer, `0`, negative, or out of bounds). Never throws.
// Unlike `parsePollMinutes`/`parseMaxVideos`, `0` is NOT a distinct valid
// value here -- an unbounded download timeout is exactly what SF2 forbids,
// so a hostile/typo'd `0` falls back to the default rather than being
// treated as "unlimited."
function parseDownloadTimeoutMinutes(raw) {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_DOWNLOAD_TIMEOUT_MINUTES;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < MIN_DOWNLOAD_TIMEOUT_MINUTES || n > MAX_DOWNLOAD_TIMEOUT_MINUTES) {
    return DEFAULT_DOWNLOAD_TIMEOUT_MINUTES;
  }
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
 *   downloadDir: string, version: (string|null), maxVideos: number,
 *   downloadTimeoutMinutes: number, maxDurationSeconds: number}}
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
    // v1.15.1 hotfix: the ceiling (minutes) applied to a real DOWNLOAD
    // spawn's timeout -- see DEFAULT_DOWNLOAD_TIMEOUT_MINUTES's comment above.
    downloadTimeoutMinutes: parseDownloadTimeoutMinutes(source.FILETUBE_YTDLP_DOWNLOAD_TIMEOUT_MINUTES),
    // v1.22.0 FR-6: 0 = unbounded (consider items of any length); see
    // DEFAULT_MAX_DURATION_SECONDS.
    maxDurationSeconds: parseMaxDurationSeconds(source.FILETUBE_YTDLP_MAX_DURATION_SECONDS),
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
  DEFAULT_DOWNLOAD_TIMEOUT_MINUTES,
  MIN_DOWNLOAD_TIMEOUT_MINUTES,
  MAX_DOWNLOAD_TIMEOUT_MINUTES,
  // v1.22.0 FR-6: configurable max-duration download gate.
  DEFAULT_MAX_DURATION_SECONDS,
  parseMaxDurationSeconds,
};
