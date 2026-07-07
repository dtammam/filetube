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
  }];
  for (const input of inputs) {
    assert.doesNotThrow(() => parseYtdlpConfig(input), `should not throw for ${JSON.stringify(input)}`);
  }
});

// ---- FILETUBE_YTDLP_MAX_VIDEOS: bound the per-channel listing (v1.11.1 hotfix) ----
//
// Default 3 (newest videos; lowered from 25 in v1.17.0 -- "25 is just
// aggro"); 0 is a distinct, valid value meaning "unlimited" (consider the
// whole channel); any other invalid/hostile input falls back to the default
// rather than throwing or disabling the module.

test('parseYtdlpConfig: maxVideos defaults to 3 when unset', () => {
  const config = parseYtdlpConfig({});
  assert.equal(config.maxVideos, 3);
});

test('parseYtdlpConfig: maxVideos falls back to the documented default on invalid values', () => {
  // Note: `[]` is deliberately excluded here -- `Number([])` coerces to `0`
  // (a valid, non-default value meaning "unlimited"), same reason
  // parsePollMinutes's own bad-value test above excludes it too.
  for (const bad of [undefined, null, '', 'abc', '-1', '1.5', 'NaN', {}, 'garbage']) {
    const config = parseYtdlpConfig({ FILETUBE_YTDLP_MAX_VIDEOS: bad });
    assert.equal(config.maxVideos, 3, `${JSON.stringify(bad)} should fall back to the default`);
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

test('isEnabled: true only for a config with enabled === true', () => {
  assert.equal(isEnabled({ enabled: true }), true);
  assert.equal(isEnabled({ enabled: false }), false);
  assert.equal(isEnabled({}), false);
  assert.equal(isEnabled(null), false);
  assert.equal(isEnabled(undefined), false);
});
