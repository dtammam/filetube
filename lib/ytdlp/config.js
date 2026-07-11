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

// v1.29 T3(b): resilience pacing/retry defaults, applied to yt-dlp's own
// `--sleep-requests`/`--sleep-interval`/`--max-sleep-interval`/`--retries`
// flags (see lib/ytdlp/args.js) to reduce bot-checks/429s. Bounds: sleep
// values are seconds in [0, 60] (`0` is a valid "no sleep," mirroring the
// "0 = off" convention used elsewhere in this file -- unlike
// DEFAULT_DOWNLOAD_TIMEOUT_MINUTES's posture, an unbounded/zero sleep is not
// itself a safety hazard, just a pacing choice); retries is an attempt count
// in [0, 20]. These are DELIBERATELY separate constants/bounds from
// DOWNLOAD_TIMEOUT's -- a sleep/retry misconfiguration and a hung-download
// timeout are unrelated failure modes.
const DEFAULT_SLEEP_REQUESTS = 1;
const DEFAULT_SLEEP_INTERVAL = 2;
const DEFAULT_MAX_SLEEP_INTERVAL = 5;
const DEFAULT_RETRIES = 5;
const MIN_SLEEP_SECONDS = 0;
const MAX_SLEEP_SECONDS = 60;
const MIN_RETRIES = 0;
const MAX_RETRIES = 20;

// v1.31 P0 (H0 fix): the LIST pass's timeout base (minutes). Before v1.31
// this was a hardcoded 5-minute constant in lib/ytdlp/run.js -- but v1.29's
// pacing flags (--sleep-requests, --retries) legitimately slow a listing
// down, and under YouTube throttling/tarpitting the fixed budget produced
// Dean's production signature: EVERY channel in a poll run dying with the
// identical bare "timed out and was killed" reason. The base is now
// configurable, and lib/ytdlp/run.js additionally SCALES the effective
// budget with the pacing config (see resolveListTimeoutMs there) so raising
// sleep flags can never silently starve the pass that pays for them.
const DEFAULT_LIST_TIMEOUT_MINUTES = 5;
const MIN_LIST_TIMEOUT_MINUTES = 1;
const MAX_LIST_TIMEOUT_MINUTES = 60;

// v1.31 P0: explicit --socket-timeout (seconds) for every yt-dlp
// invocation. Under bot-detection/tarpitting YouTube HANGS connections
// rather than erroring; yt-dlp's own default socket timeout (20s) times the
// retry count is what silently burned the old fixed list budget. A bounded,
// explicit socket timeout makes a hung request fail fast so --retries can
// do its job within the pass budget. 0 is deliberately NOT valid here
// (unbounded sockets are exactly the hazard this exists to remove).
const DEFAULT_SOCKET_TIMEOUT_SECONDS = 15;
const MIN_SOCKET_TIMEOUT_SECONDS = 5;
const MAX_SOCKET_TIMEOUT_SECONDS = 120;

// v1.31 P3: stall watchdog for the DOWNLOAD pass -- if the child produces NO
// output (stdout or stderr) for this many minutes, it is killed with a
// specific "stalled" reason instead of waiting out the absolute
// downloadTimeoutMinutes ceiling (up to 3h) while holding the serial queue
// hostage. 0 = disabled (ceiling-only, the pre-v1.31 behavior).
const DEFAULT_STALL_MINUTES = 10;
const MIN_STALL_MINUTES = 0;
const MAX_STALL_MINUTES = 120;

// v1.29 T3(b): FILETUBE_YTDLP_PLAYER_CLIENT is an unset-by-default operator
// lever for yt-dlp's `--extractor-args youtube:player_client=<value>`. See
// the exec plan's Design ("T3(b) -- Resilience argv flags") for why this is
// NOT a hardcoded default: yt-dlp's player-client identifiers are
// version-sensitive and pinning the wrong one can itself cause failures.
// When set, `<value>` MUST match this strict charset allowlist (lowercase
// letters, digits, underscore, comma, hyphen -- e.g. "web" or
// "android,web") and stay within MAX_PLAYER_CLIENT_LENGTH -- mirroring the
// decoded video-id charset-allowlist posture in lib/ytdlp/url.js exactly:
// this is operator config, never per-video/per-subscription data, but it is
// still validated as if it were hostile input before ever reaching an argv
// element. A value that fails either check is treated as unset (no flag
// emitted) rather than rejected with an error, matching this file's
// fail-safe-not-fail-loud posture throughout.
const PLAYER_CLIENT_PATTERN = /^[a-z0-9_,-]+$/;
const MAX_PLAYER_CLIENT_LENGTH = 128;

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

// v1.31 P0: LIST-pass timeout base (minutes) -- same posture as
// parseDownloadTimeoutMinutes (a 0/negative value would be "unbounded",
// which SF2 forbids, so the minimum is 1).
function parseListTimeoutMinutes(raw) {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_LIST_TIMEOUT_MINUTES;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < MIN_LIST_TIMEOUT_MINUTES || n > MAX_LIST_TIMEOUT_MINUTES) {
    return DEFAULT_LIST_TIMEOUT_MINUTES;
  }
  return n;
}

// v1.31 P0: --socket-timeout seconds. 0 is NOT valid (see the constant's
// comment) -- the minimum is a real positive bound.
function parseSocketTimeoutSeconds(raw) {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_SOCKET_TIMEOUT_SECONDS;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < MIN_SOCKET_TIMEOUT_SECONDS || n > MAX_SOCKET_TIMEOUT_SECONDS) {
    return DEFAULT_SOCKET_TIMEOUT_SECONDS;
  }
  return n;
}

// v1.31 P3: stall-watchdog idle window (minutes). 0 IS valid here ("watchdog
// off, absolute ceiling only" -- the pre-v1.31 behavior), mirroring the
// "0 = off" convention of maxVideos/maxDurationSeconds.
function parseStallMinutes(raw) {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_STALL_MINUTES;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < MIN_STALL_MINUTES || n > MAX_STALL_MINUTES) {
    return DEFAULT_STALL_MINUTES;
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

// v1.29 T3(b): non-negative integer within [MIN_SLEEP_SECONDS,
// MAX_SLEEP_SECONDS]; falls back to the caller-supplied `defaultValue` on
// anything invalid (unset, empty, non-numeric, non-integer, negative, or
// out of bounds). Never throws. Mirrors `parseDownloadTimeoutMinutes`'s
// posture EXACTLY, except (a) `0` IS a valid, distinct value here ("no
// sleep" is a legitimate pacing choice, unlike an unbounded download
// timeout) and (b) the default is parameterized so this single function
// backs all three sleep-related fields (`sleepRequests`/`sleepInterval`/
// `maxSleepInterval`), each with its own documented default.
function parseSleepSeconds(raw, defaultValue) {
  if (raw === undefined || raw === null || raw === '') return defaultValue;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < MIN_SLEEP_SECONDS || n > MAX_SLEEP_SECONDS) {
    return defaultValue;
  }
  return n;
}

// v1.29 T3(b): non-negative integer within [MIN_RETRIES, MAX_RETRIES]; falls
// back to DEFAULT_RETRIES on anything invalid (unset, empty, non-numeric,
// non-integer, negative, or out of bounds). Never throws. `0` is a valid,
// distinct value meaning "no retries" -- an operator's explicit choice, not
// itself a hazard the way a `0`-minute download timeout would be.
function parseRetries(raw) {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_RETRIES;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < MIN_RETRIES || n > MAX_RETRIES) return DEFAULT_RETRIES;
  return n;
}

// v1.29 T3(b): parses FILETUBE_YTDLP_PLAYER_CLIENT into a validated string or
// `null` (unset/rejected). Reuses `parseOptionalString` to normalize
// unset/empty to `null`, THEN applies the strict charset/length allowlist
// (`PLAYER_CLIENT_PATTERN`/`MAX_PLAYER_CLIENT_LENGTH`) -- a value that fails
// either check is treated exactly like "unset" (never throws, never partially
// sanitizes/truncates a rejected value into something that still reaches the
// argv builder).
function parsePlayerClient(raw) {
  const value = parseOptionalString(raw);
  if (value === null) return null;
  if (value.length > MAX_PLAYER_CLIENT_LENGTH) return null;
  if (!PLAYER_CLIENT_PATTERN.test(value)) return null;
  return value;
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
 *   downloadTimeoutMinutes: number, maxDurationSeconds: number,
 *   sleepRequests: number, sleepInterval: number, maxSleepInterval: number,
 *   retries: number, playerClient: (string|null),
 *   listTimeoutMinutes: number, socketTimeoutSeconds: number,
 *   stallMinutes: number}}
 */
function parseYtdlpConfig(env = process.env) {
  const source = env && typeof env === 'object' ? env : {};
  const sleepInterval = parseSleepSeconds(source.FILETUBE_YTDLP_SLEEP_INTERVAL, DEFAULT_SLEEP_INTERVAL);
  let maxSleepInterval = parseSleepSeconds(source.FILETUBE_YTDLP_MAX_SLEEP_INTERVAL, DEFAULT_MAX_SLEEP_INTERVAL);
  // v1.29 T3(b): keep the pair coherent -- yt-dlp expects
  // --max-sleep-interval >= --sleep-interval. Rather than falling back to
  // the default (which could ALSO invert the pair, e.g. a raised
  // sleepInterval default one day), clamp UP to sleepInterval so this
  // invariant holds for any valid combination of overrides.
  if (maxSleepInterval < sleepInterval) maxSleepInterval = sleepInterval;
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
    // v1.29 T3(b): resilience pacing/retry flags -- see the constants'
    // doc comments above. 0 IS a valid "no sleep"/"no retries" value for
    // all four of these (unlike downloadTimeoutMinutes).
    sleepRequests: parseSleepSeconds(source.FILETUBE_YTDLP_SLEEP_REQUESTS, DEFAULT_SLEEP_REQUESTS),
    sleepInterval,
    maxSleepInterval,
    retries: parseRetries(source.FILETUBE_YTDLP_RETRIES),
    // Unset by default (null) -> lib/ytdlp/args.js omits the
    // --extractor-args flag entirely; only a charset/length-validated string
    // reaches here. See PLAYER_CLIENT_PATTERN's comment above.
    playerClient: parsePlayerClient(source.FILETUBE_YTDLP_PLAYER_CLIENT),
    // v1.31 P0/P3: list-pass budget base, explicit socket timeout, and the
    // download stall-watchdog window -- see the constants' comments above.
    listTimeoutMinutes: parseListTimeoutMinutes(source.FILETUBE_YTDLP_LIST_TIMEOUT_MINUTES),
    socketTimeoutSeconds: parseSocketTimeoutSeconds(source.FILETUBE_YTDLP_SOCKET_TIMEOUT_SECONDS),
    stallMinutes: parseStallMinutes(source.FILETUBE_YTDLP_STALL_MINUTES),
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
  // v1.29 T3(b): resilience pacing/retry flags + the player_client lever --
  // exported so lib/ytdlp/args.js can defensively re-bound a bare/partial
  // config (mirroring this file's other DEFAULT_/parse* exports) and so unit
  // tests can exercise the parse functions/bounds directly.
  DEFAULT_SLEEP_REQUESTS,
  DEFAULT_SLEEP_INTERVAL,
  DEFAULT_MAX_SLEEP_INTERVAL,
  DEFAULT_RETRIES,
  MIN_SLEEP_SECONDS,
  MAX_SLEEP_SECONDS,
  MIN_RETRIES,
  MAX_RETRIES,
  parseSleepSeconds,
  parseRetries,
  parsePlayerClient,
  // v1.31 P0/P3: list budget, socket timeout, stall watchdog -- exported for
  // lib/ytdlp/run.js's budget scaling, lib/ytdlp/args.js's defensive
  // re-bounding, and direct unit-test coverage of the bounds.
  DEFAULT_LIST_TIMEOUT_MINUTES,
  MIN_LIST_TIMEOUT_MINUTES,
  MAX_LIST_TIMEOUT_MINUTES,
  DEFAULT_SOCKET_TIMEOUT_SECONDS,
  MIN_SOCKET_TIMEOUT_SECONDS,
  MAX_SOCKET_TIMEOUT_SECONDS,
  DEFAULT_STALL_MINUTES,
  MIN_STALL_MINUTES,
  MAX_STALL_MINUTES,
  parseListTimeoutMinutes,
  parseSocketTimeoutSeconds,
  parseStallMinutes,
  // v1.31 P0: run.js's resolveListTimeoutMs re-validates maxVideos at its
  // boundary (the budget scales with it) -- exported like the other parse*.
  parseMaxVideos,
};
