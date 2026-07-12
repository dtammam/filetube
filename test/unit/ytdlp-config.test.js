'use strict';

// [UNIT] Pure-logic coverage for lib/ytdlp/config.js's defensive ENV parser.
// No DATA_DIR isolation needed here (no fs/server import) -- this file only
// exercises parseYtdlpConfig/isEnabled directly, mirroring test/unit/
// transcode-cache.test.js's style for parseCacheCap.

const { test } = require('node:test');
const assert = require('node:assert');
const { parseYtdlpConfig, isEnabled } = require('../../lib/ytdlp/config');

// ---- FILETUBE_YTDLP_ENABLED: off-by-default, truthy-only (AC 7) ----

test('parseYtdlpConfig: disabled by default when FILETUBE_YTDLP_ENABLED is unset', () => {
  const config = parseYtdlpConfig({});
  assert.equal(config.enabled, false);
  assert.equal(isEnabled(config), false);
});

test('parseYtdlpConfig: enables only for an affirmative string value', () => {
  for (const on of ['true', '1', 'yes', 'TRUE', 'Yes', ' true ']) {
    const config = parseYtdlpConfig({ FILETUBE_YTDLP_ENABLED: on });
    assert.equal(config.enabled, true, `${JSON.stringify(on)} should enable`);
    assert.equal(isEnabled(config), true);
  }
});

test('parseYtdlpConfig: any non-affirmative value fails safe to disabled', () => {
  for (const off of ['false', '', '0', 'no', 'garbage', undefined, null, 'TRUE1', 1, true]) {
    const config = parseYtdlpConfig({ FILETUBE_YTDLP_ENABLED: off });
    assert.equal(config.enabled, false, `${JSON.stringify(off)} should disable`);
    assert.equal(isEnabled(config), false);
  }
});

// ---- FILETUBE_YTDLP_POLL_MINUTES: invalid -> default; 0 = manual-only (AC 9) ----

test('parseYtdlpConfig: pollMinutes falls back to the documented default on invalid/unset values', () => {
  for (const bad of [undefined, null, '', 'abc', '-1', '1.5', 'NaN', {}]) {
    const config = parseYtdlpConfig({ FILETUBE_YTDLP_POLL_MINUTES: bad });
    assert.equal(config.pollMinutes, 60, `${JSON.stringify(bad)} should fall back to the default`);
  }
});

test('parseYtdlpConfig: pollMinutes accepts a valid non-negative integer', () => {
  assert.equal(parseYtdlpConfig({ FILETUBE_YTDLP_POLL_MINUTES: '15' }).pollMinutes, 15);
  assert.equal(parseYtdlpConfig({ FILETUBE_YTDLP_POLL_MINUTES: '120' }).pollMinutes, 120);
});

test('parseYtdlpConfig: pollMinutes of 0 is valid and means manual-only (not invalid)', () => {
  assert.equal(parseYtdlpConfig({ FILETUBE_YTDLP_POLL_MINUTES: '0' }).pollMinutes, 0);
});

// ---- FILETUBE_YTDLP_COOKIES_FILE / FILETUBE_YTDLP_VERSION: string passthrough (AC 9) ----

test('parseYtdlpConfig: cookiesFile and version default to null when unset', () => {
  const config = parseYtdlpConfig({});
  assert.equal(config.cookiesFile, null);
  assert.equal(config.version, null);
});

test('parseYtdlpConfig: cookiesFile and version pass through a configured string unchanged', () => {
  const config = parseYtdlpConfig({
    FILETUBE_YTDLP_COOKIES_FILE: '/mnt/cookies.txt',
    FILETUBE_YTDLP_VERSION: '2025.06.09',
  });
  assert.equal(config.cookiesFile, '/mnt/cookies.txt');
  assert.equal(config.version, '2025.06.09');
});

test('parseYtdlpConfig: an empty/whitespace cookiesFile is treated as unset', () => {
  assert.equal(parseYtdlpConfig({ FILETUBE_YTDLP_COOKIES_FILE: '' }).cookiesFile, null);
  assert.equal(parseYtdlpConfig({ FILETUBE_YTDLP_COOKIES_FILE: '   ' }).cookiesFile, null);
});

// ---- FILETUBE_YTDLP_DOWNLOAD_DIR: passthrough + sane default (AC 9) ----

test('parseYtdlpConfig: downloadDir passes through a configured path unchanged', () => {
  const config = parseYtdlpConfig({ FILETUBE_YTDLP_DOWNLOAD_DIR: '/media/subs' });
  assert.equal(config.downloadDir, '/media/subs');
});

test('parseYtdlpConfig: downloadDir has a non-empty, documented default when unset', () => {
  const config = parseYtdlpConfig({});
  assert.equal(typeof config.downloadDir, 'string');
  assert.ok(config.downloadDir.length > 0);
  assert.ok(config.downloadDir.includes('ytdlp-downloads'));
});

// ---- Never throws (AC 7, 9) ----

test('parseYtdlpConfig: never throws regardless of input shape', () => {
  const inputs = [undefined, null, {}, [], 'a string', 42, () => {}, {
    FILETUBE_YTDLP_ENABLED: {},
    FILETUBE_YTDLP_POLL_MINUTES: [],
    FILETUBE_YTDLP_COOKIES_FILE: 123,
    FILETUBE_YTDLP_DOWNLOAD_DIR: false,
    FILETUBE_YTDLP_VERSION: NaN,
    FILETUBE_YTDLP_MAX_VIDEOS: {},
    FILETUBE_YTDLP_MAX_DURATION_SECONDS: {},
  }];
  for (const input of inputs) {
    assert.doesNotThrow(() => parseYtdlpConfig(input), `should not throw for ${JSON.stringify(input)}`);
  }
});

// ---- FILETUBE_YTDLP_MAX_VIDEOS: bound the per-channel listing (v1.11.1 hotfix) ----
//
// Default 2 (newest videos; lowered from 25 to 3 in v1.18.0 -- "25 is just
// aggro" -- then from 3 to 2 in v1.20.0, FR-5 -- "even 3 rarely gets hit");
// 0 is a distinct, valid value meaning "unlimited" (consider the whole
// channel); any other invalid/hostile input falls back to the default
// rather than throwing or disabling the module. This default only applies
// to NEW subscriptions -- an already-persisted subscription's stored
// `maxVideos` is untouched (see lib/ytdlp/args.js's
// `subMaxVideos ?? config.maxVideos` resolution, exercised in
// test/unit/ytdlp-args.test.js).

test('parseYtdlpConfig: maxVideos defaults to 2 when unset', () => {
  const config = parseYtdlpConfig({});
  assert.equal(config.maxVideos, 2);
});

test('parseYtdlpConfig: maxVideos falls back to the documented default on invalid values', () => {
  // Note: `[]` is deliberately excluded here -- `Number([])` coerces to `0`
  // (a valid, non-default value meaning "unlimited"), same reason
  // parsePollMinutes's own bad-value test above excludes it too.
  for (const bad of [undefined, null, '', 'abc', '-1', '1.5', 'NaN', {}, 'garbage']) {
    const config = parseYtdlpConfig({ FILETUBE_YTDLP_MAX_VIDEOS: bad });
    assert.equal(config.maxVideos, 2, `${JSON.stringify(bad)} should fall back to the default`);
  }
});

test('parseYtdlpConfig: maxVideos accepts a valid non-negative integer', () => {
  assert.equal(parseYtdlpConfig({ FILETUBE_YTDLP_MAX_VIDEOS: '10' }).maxVideos, 10);
  assert.equal(parseYtdlpConfig({ FILETUBE_YTDLP_MAX_VIDEOS: '500' }).maxVideos, 500);
});

test('parseYtdlpConfig: maxVideos of 0 is valid and means unlimited (not invalid)', () => {
  assert.equal(parseYtdlpConfig({ FILETUBE_YTDLP_MAX_VIDEOS: '0' }).maxVideos, 0);
});

// ---- FILETUBE_YTDLP_DOWNLOAD_TIMEOUT_MINUTES: v1.15.1 hotfix ----
//
// Default 180 (3 hours, raised from the previous hardcoded 60-minute
// ceiling); any invalid/hostile input (including 0 -- unlike maxVideos/
// pollMinutes, 0 does NOT mean "unlimited" here, since an unbounded download
// timeout is exactly what SF2 forbids) falls back to the default; a valid
// value must land within [1, 1440].

test('parseYtdlpConfig: downloadTimeoutMinutes defaults to 180 when unset', () => {
  const config = parseYtdlpConfig({});
  assert.equal(config.downloadTimeoutMinutes, 180);
});

test('parseYtdlpConfig: downloadTimeoutMinutes accepts a valid override', () => {
  assert.equal(parseYtdlpConfig({ FILETUBE_YTDLP_DOWNLOAD_TIMEOUT_MINUTES: '240' }).downloadTimeoutMinutes, 240);
  assert.equal(parseYtdlpConfig({ FILETUBE_YTDLP_DOWNLOAD_TIMEOUT_MINUTES: '1' }).downloadTimeoutMinutes, 1);
  assert.equal(parseYtdlpConfig({ FILETUBE_YTDLP_DOWNLOAD_TIMEOUT_MINUTES: '1440' }).downloadTimeoutMinutes, 1440);
});

test('parseYtdlpConfig: downloadTimeoutMinutes falls back to 180 on hostile/invalid values, including 0', () => {
  for (const bad of [undefined, null, '', 'abc', '-1', '1.5', 'NaN', {}, 'garbage', '0', '1441', '-100']) {
    const config = parseYtdlpConfig({ FILETUBE_YTDLP_DOWNLOAD_TIMEOUT_MINUTES: bad });
    assert.equal(config.downloadTimeoutMinutes, 180, `${JSON.stringify(bad)} should fall back to the default`);
  }
});

// ---- FILETUBE_YTDLP_MAX_DURATION_SECONDS: v1.22.0 FR-6 max-duration gate ----
//
// Default 7200 (2h); 0 is a distinct, valid value meaning "unbounded"
// (consider items of any length); any other invalid/hostile input falls back
// to the default rather than throwing or disabling the module. Mirrors
// FILETUBE_YTDLP_MAX_VIDEOS's semantics exactly (same shape, different
// default/env var) -- see lib/ytdlp/args.js's
// `subMaxDurationSeconds ?? config.maxDurationSeconds` resolution, exercised
// in test/unit/ytdlp-args.test.js.

test('parseYtdlpConfig: maxDurationSeconds defaults to 7200 (2h) when unset', () => {
  const config = parseYtdlpConfig({});
  assert.equal(config.maxDurationSeconds, 7200);
});

test('parseYtdlpConfig: maxDurationSeconds falls back to the documented default on invalid values', () => {
  for (const bad of [undefined, null, '', 'abc', '-1', '1.5', 'NaN', {}, 'garbage']) {
    const config = parseYtdlpConfig({ FILETUBE_YTDLP_MAX_DURATION_SECONDS: bad });
    assert.equal(config.maxDurationSeconds, 7200, `${JSON.stringify(bad)} should fall back to the default`);
  }
});

test('parseYtdlpConfig: maxDurationSeconds accepts a valid non-negative integer override', () => {
  assert.equal(parseYtdlpConfig({ FILETUBE_YTDLP_MAX_DURATION_SECONDS: '3600' }).maxDurationSeconds, 3600);
  assert.equal(parseYtdlpConfig({ FILETUBE_YTDLP_MAX_DURATION_SECONDS: '36000' }).maxDurationSeconds, 36000);
});

test('parseYtdlpConfig: maxDurationSeconds of 0 is valid and means unbounded (not invalid)', () => {
  assert.equal(parseYtdlpConfig({ FILETUBE_YTDLP_MAX_DURATION_SECONDS: '0' }).maxDurationSeconds, 0);
});

// ---- v1.29 T3(b): resilience pacing/retry flags (AC6.2) -------------------
//
// FILETUBE_YTDLP_SLEEP_REQUESTS/SLEEP_INTERVAL/MAX_SLEEP_INTERVAL: sleep
// seconds in [0, 60]; `0` is a valid, distinct value ("no sleep" -- unlike
// downloadTimeoutMinutes, an unbounded/zero sleep is not itself a safety
// hazard). FILETUBE_YTDLP_RETRIES: attempt count in [0, 20], `0` also valid
// ("no retries"). Any invalid/hostile input on any of the four falls back to
// its own documented default -- never a NaN/negative/non-finite value
// reaching yt-dlp.

test('parseYtdlpConfig: sleepRequests/sleepInterval/maxSleepInterval/retries default to 1/2/5/5 when unset', () => {
  const config = parseYtdlpConfig({});
  assert.equal(config.sleepRequests, 1);
  assert.equal(config.sleepInterval, 2);
  assert.equal(config.maxSleepInterval, 5);
  assert.equal(config.retries, 5);
});

test('parseYtdlpConfig: sleepRequests/sleepInterval/maxSleepInterval accept a valid override, including 0 ("no sleep")', () => {
  assert.equal(parseYtdlpConfig({ FILETUBE_YTDLP_SLEEP_REQUESTS: '3' }).sleepRequests, 3);
  assert.equal(parseYtdlpConfig({ FILETUBE_YTDLP_SLEEP_REQUESTS: '0' }).sleepRequests, 0);
  assert.equal(parseYtdlpConfig({ FILETUBE_YTDLP_SLEEP_INTERVAL: '10' }).sleepInterval, 10);
  assert.equal(parseYtdlpConfig({ FILETUBE_YTDLP_SLEEP_INTERVAL: '0' }).sleepInterval, 0);
  assert.equal(parseYtdlpConfig({ FILETUBE_YTDLP_MAX_SLEEP_INTERVAL: '60' }).maxSleepInterval, 60);
  // maxSleepInterval=0 alone would be clamped UP to the (unset, default-2)
  // sleepInterval by the coherence invariant tested separately below -- to
  // observe an unclamped 0 here, sleepInterval must ALSO be 0.
  assert.equal(parseYtdlpConfig({ FILETUBE_YTDLP_SLEEP_INTERVAL: '0', FILETUBE_YTDLP_MAX_SLEEP_INTERVAL: '0' }).maxSleepInterval, 0);
});

test('parseYtdlpConfig: retries accepts a valid override, including 0 ("no retries")', () => {
  assert.equal(parseYtdlpConfig({ FILETUBE_YTDLP_RETRIES: '12' }).retries, 12);
  assert.equal(parseYtdlpConfig({ FILETUBE_YTDLP_RETRIES: '0' }).retries, 0);
  assert.equal(parseYtdlpConfig({ FILETUBE_YTDLP_RETRIES: '20' }).retries, 20);
});

test('parseYtdlpConfig: sleepRequests/sleepInterval/maxSleepInterval fall back to their own default on invalid/out-of-range values (AC6.2)', () => {
  for (const bad of [undefined, null, '', 'abc', '-1', '1.5', 'NaN', {}, 'garbage', '61', '-100']) {
    const config = parseYtdlpConfig({
      FILETUBE_YTDLP_SLEEP_REQUESTS: bad,
      FILETUBE_YTDLP_SLEEP_INTERVAL: bad,
      FILETUBE_YTDLP_MAX_SLEEP_INTERVAL: bad,
    });
    assert.equal(config.sleepRequests, 1, `sleepRequests: ${JSON.stringify(bad)} should fall back to 1`);
    assert.equal(config.sleepInterval, 2, `sleepInterval: ${JSON.stringify(bad)} should fall back to 2`);
    assert.equal(config.maxSleepInterval, 5, `maxSleepInterval: ${JSON.stringify(bad)} should fall back to 5`);
  }
});

test('parseYtdlpConfig: retries falls back to 5 on invalid/out-of-range values (AC6.2), including a value above MAX_RETRIES', () => {
  for (const bad of [undefined, null, '', 'abc', '-1', '1.5', 'NaN', {}, 'garbage', '21', '-100']) {
    const config = parseYtdlpConfig({ FILETUBE_YTDLP_RETRIES: bad });
    assert.equal(config.retries, 5, `${JSON.stringify(bad)} should fall back to the default`);
  }
});

test('parseYtdlpConfig: never produces a negative/non-finite/NaN value for any of the four pacing/retry fields, regardless of input shape (AC6.2)', () => {
  const config = parseYtdlpConfig({
    FILETUBE_YTDLP_SLEEP_REQUESTS: {},
    FILETUBE_YTDLP_SLEEP_INTERVAL: [],
    FILETUBE_YTDLP_MAX_SLEEP_INTERVAL: NaN,
    FILETUBE_YTDLP_RETRIES: -Infinity,
  });
  for (const field of ['sleepRequests', 'sleepInterval', 'maxSleepInterval', 'retries']) {
    assert.ok(Number.isFinite(config[field]), `${field} must be finite`);
    assert.ok(config[field] >= 0, `${field} must be non-negative`);
  }
});

test('parseYtdlpConfig: maxSleepInterval is clamped UP to sleepInterval when a configured combination would otherwise invert them', () => {
  const config = parseYtdlpConfig({
    FILETUBE_YTDLP_SLEEP_INTERVAL: '30',
    FILETUBE_YTDLP_MAX_SLEEP_INTERVAL: '5',
  });
  assert.equal(config.sleepInterval, 30);
  assert.equal(config.maxSleepInterval, 30, 'maxSleepInterval must never be less than sleepInterval');
});

test('parseYtdlpConfig: maxSleepInterval is left unchanged when it is already >= sleepInterval', () => {
  const config = parseYtdlpConfig({
    FILETUBE_YTDLP_SLEEP_INTERVAL: '3',
    FILETUBE_YTDLP_MAX_SLEEP_INTERVAL: '10',
  });
  assert.equal(config.sleepInterval, 3);
  assert.equal(config.maxSleepInterval, 10);
});

// ---- v1.29 T3(b): FILETUBE_YTDLP_PLAYER_CLIENT -----------------------------
//
// Unset by default (null); when set, must match the strict charset
// allowlist /^[a-z0-9_,-]+$/ and stay within the length bound -- a rejected
// value is treated exactly like unset (null), never partially sanitized.

test('parseYtdlpConfig: playerClient defaults to null when unset', () => {
  assert.equal(parseYtdlpConfig({}).playerClient, null);
});

test('parseYtdlpConfig: playerClient accepts a valid charset value', () => {
  assert.equal(parseYtdlpConfig({ FILETUBE_YTDLP_PLAYER_CLIENT: 'web' }).playerClient, 'web');
  assert.equal(parseYtdlpConfig({ FILETUBE_YTDLP_PLAYER_CLIENT: 'android,web' }).playerClient, 'android,web');
  assert.equal(parseYtdlpConfig({ FILETUBE_YTDLP_PLAYER_CLIENT: 'tv_embedded' }).playerClient, 'tv_embedded');
  assert.equal(parseYtdlpConfig({ FILETUBE_YTDLP_PLAYER_CLIENT: 'ios-web_1,2' }).playerClient, 'ios-web_1,2');
});

test('parseYtdlpConfig: playerClient rejects (-> null) a value outside the charset allowlist', () => {
  for (const bad of ['web client', 'web;rm -rf /', 'web&&id', 'WEB', 'we\nb', 'web/../etc', '../../etc/passwd', '"web"', 'web$(id)']) {
    const config = parseYtdlpConfig({ FILETUBE_YTDLP_PLAYER_CLIENT: bad });
    assert.equal(config.playerClient, null, `${JSON.stringify(bad)} should be rejected to null`);
  }
});

test('parseYtdlpConfig: playerClient rejects (-> null) an over-length value', () => {
  const tooLong = 'a'.repeat(129);
  assert.equal(parseYtdlpConfig({ FILETUBE_YTDLP_PLAYER_CLIENT: tooLong }).playerClient, null);
  const atLimit = 'a'.repeat(128);
  assert.equal(parseYtdlpConfig({ FILETUBE_YTDLP_PLAYER_CLIENT: atLimit }).playerClient, atLimit);
});

test('parseYtdlpConfig: playerClient treats unset/empty/whitespace-only as null (not an error)', () => {
  assert.equal(parseYtdlpConfig({}).playerClient, null);
  assert.equal(parseYtdlpConfig({ FILETUBE_YTDLP_PLAYER_CLIENT: '' }).playerClient, null);
  assert.equal(parseYtdlpConfig({ FILETUBE_YTDLP_PLAYER_CLIENT: '   ' }).playerClient, null);
});

test('parseYtdlpConfig: never throws for hostile FILETUBE_YTDLP_SLEEP_*/RETRIES/PLAYER_CLIENT input shapes', () => {
  const inputs = [{
    FILETUBE_YTDLP_SLEEP_REQUESTS: {},
    FILETUBE_YTDLP_SLEEP_INTERVAL: [],
    FILETUBE_YTDLP_MAX_SLEEP_INTERVAL: () => {},
    FILETUBE_YTDLP_RETRIES: false,
    FILETUBE_YTDLP_PLAYER_CLIENT: 12345,
  }];
  for (const input of inputs) {
    assert.doesNotThrow(() => parseYtdlpConfig(input));
  }
});

test('isEnabled: true only for a config with enabled === true', () => {
  assert.equal(isEnabled({ enabled: true }), true);
  assert.equal(isEnabled({ enabled: false }), false);
  assert.equal(isEnabled({}), false);
  assert.equal(isEnabled(null), false);
  assert.equal(isEnabled(undefined), false);
});

// ---- v1.31 P0/P3: list-timeout, socket-timeout, stall-minutes knobs --------

const { test: t31 } = require('node:test');
const config = require('../../lib/ytdlp/config');

t31('v1.31: parseListTimeoutMinutes -- default 5, bounds [1,60], invalid falls back (AC-CFG)', () => {
  assert.equal(config.parseListTimeoutMinutes(undefined), 5);
  assert.equal(config.parseListTimeoutMinutes(''), 5);
  assert.equal(config.parseListTimeoutMinutes('10'), 10);
  assert.equal(config.parseListTimeoutMinutes(1), 1);
  assert.equal(config.parseListTimeoutMinutes(60), 60);
  for (const bad of [0, -1, 61, 1.5, 'ten', NaN, {}]) {
    assert.equal(config.parseListTimeoutMinutes(bad), 5, `bad=${String(bad)}`);
  }
});

t31('v1.31: parseSocketTimeoutSeconds -- default 15, bounds [5,120], 0 is NOT valid (unbounded sockets are the hazard) (AC-CFG)', () => {
  assert.equal(config.parseSocketTimeoutSeconds(undefined), 15);
  assert.equal(config.parseSocketTimeoutSeconds('30'), 30);
  assert.equal(config.parseSocketTimeoutSeconds(5), 5);
  assert.equal(config.parseSocketTimeoutSeconds(120), 120);
  for (const bad of [0, 4, 121, -5, 2.5, 'x', NaN]) {
    assert.equal(config.parseSocketTimeoutSeconds(bad), 15, `bad=${String(bad)}`);
  }
});

t31('v1.31: parseStallMinutes -- default 10, bounds [0,120], 0 IS valid ("watchdog off") (AC-CFG)', () => {
  assert.equal(config.parseStallMinutes(undefined), 10);
  assert.equal(config.parseStallMinutes('0'), 0);
  assert.equal(config.parseStallMinutes(0), 0);
  assert.equal(config.parseStallMinutes(120), 120);
  for (const bad of [-1, 121, 1.5, 'x', NaN]) {
    assert.equal(config.parseStallMinutes(bad), 10, `bad=${String(bad)}`);
  }
});

t31('v1.31: parseYtdlpConfig threads the three new env knobs (and defaults them when unset)', () => {
  const parsed = config.parseYtdlpConfig({
    FILETUBE_YTDLP_LIST_TIMEOUT_MINUTES: '12',
    FILETUBE_YTDLP_SOCKET_TIMEOUT_SECONDS: '45',
    FILETUBE_YTDLP_STALL_MINUTES: '20',
  });
  assert.equal(parsed.listTimeoutMinutes, 12);
  assert.equal(parsed.socketTimeoutSeconds, 45);
  assert.equal(parsed.stallMinutes, 20);

  const defaults = config.parseYtdlpConfig({});
  assert.equal(defaults.listTimeoutMinutes, 5);
  assert.equal(defaults.socketTimeoutSeconds, 15);
  assert.equal(defaults.stallMinutes, 10);
});

// ---- v1.36 F1: parseListScanCap (the list-pass enumeration backstop) -------

t31('v1.36: parseListScanCap defaults to 200, accepts 0 ("cap off") and bounded integers, rejects garbage back to the default', () => {
  assert.equal(config.DEFAULT_LIST_SCAN_CAP, 200);
  assert.equal(config.parseListScanCap(undefined), 200);
  assert.equal(config.parseListScanCap(''), 200);
  assert.equal(config.parseListScanCap(null), 200);
  assert.equal(config.parseListScanCap('0'), 0, '0 is a valid, distinct "cap off" value');
  assert.equal(config.parseListScanCap(0), 0);
  assert.equal(config.parseListScanCap('50'), 50);
  assert.equal(config.parseListScanCap(10000), 10000, 'MAX_LIST_SCAN_CAP is inclusive');
  // (No `[]` case: `Number([])` coerces to 0, a valid "cap off" -- env
  // values are always strings, and every sibling parser here shares the
  // same Number() coercion latitude for non-string junk.)
  for (const bad of [-1, 10001, 1.5, 'abc', NaN, {}]) {
    assert.equal(config.parseListScanCap(bad), 200, `bad=${String(bad)} must fall back to the default`);
  }
});

t31('v1.36: parseYtdlpConfig threads FILETUBE_YTDLP_LIST_SCAN_CAP (and defaults it when unset)', () => {
  assert.equal(config.parseYtdlpConfig({ FILETUBE_YTDLP_LIST_SCAN_CAP: '75' }).listScanCap, 75);
  assert.equal(config.parseYtdlpConfig({ FILETUBE_YTDLP_LIST_SCAN_CAP: '0' }).listScanCap, 0);
  assert.equal(config.parseYtdlpConfig({}).listScanCap, 200);
  assert.equal(config.parseYtdlpConfig({ FILETUBE_YTDLP_LIST_SCAN_CAP: 'garbage' }).listScanCap, 200);
});
