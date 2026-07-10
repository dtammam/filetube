'use strict';

// [UNIT] lib/ytdlp/args.js -- pure arg builders + path confinement (AC 27,
// 30, and the T2-QA-folded quality/format sanitization). No child process,
// no real fs writes; the only I/O is `fs.existsSync` (cookies presence
// check), which the tests drive with a real temp file so both branches are
// covered.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert');
const args = require('../../lib/ytdlp/args');

function makeConfig(overrides = {}) {
  return {
    downloadDir: fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-test-')),
    cookiesFile: null,
    ...overrides,
  };
}

function baseSub(overrides = {}) {
  return {
    id: 'abc123',
    channelUrl: 'https://www.youtube.com/@somechannel',
    name: 'Some Channel',
    format: 'video',
    quality: 'best',
    ...overrides,
  };
}

// ---- buildYtdlpListArgs: flat array shape, `--` before the URL ------------

test('buildYtdlpListArgs returns a flat string[] with the URL positional after "--"', () => {
  const config = makeConfig();
  const result = args.buildYtdlpListArgs(baseSub(), config);
  assert.ok(Array.isArray(result));
  assert.ok(result.every((el) => typeof el === 'string'));
  const sepIndex = result.indexOf('--');
  assert.ok(sepIndex >= 0, 'expected a "--" separator');
  assert.equal(sepIndex, result.length - 2, '"--" must immediately precede the URL');
  assert.equal(result[result.length - 1], 'https://www.youtube.com/@somechannel');
  assert.ok(result.includes('--download-archive'));
});

test('buildYtdlpListArgs never embeds the URL into an option (it is its own array element, always last)', () => {
  const config = makeConfig();
  const result = args.buildYtdlpListArgs(baseSub({ channelUrl: 'https://youtu.be/dQw4w9WgXcQ' }), config);
  // No element other than the last one contains the URL as a substring.
  for (let i = 0; i < result.length - 1; i++) {
    assert.ok(!result[i].includes('dQw4w9WgXcQ'), `unexpected URL fragment in arg[${i}]: ${result[i]}`);
  }
});

// ---- buildYtdlpListArgs: --playlist-end bounding (v1.11.1 hotfix) ---------
//
// Regression coverage for the production bug: subscribing to a real, large
// channel used to enumerate its ENTIRE back-catalog with no scope limit at
// all. `config.maxVideos` (parsed by lib/ytdlp/config.js, default 25) now
// bounds the LIST pass via `--playlist-end`.

test('buildYtdlpListArgs includes "--playlist-end 25" for the documented default maxVideos', () => {
  const config = makeConfig({ maxVideos: 25 });
  const result = args.buildYtdlpListArgs(baseSub(), config);
  const idx = result.indexOf('--playlist-end');
  assert.ok(idx >= 0, '--playlist-end should be present by default');
  assert.equal(result[idx + 1], '25');
  // Must come before the `--` separator (never after it, where it could be
  // mistaken for a positional argument).
  assert.ok(idx < result.indexOf('--'), '--playlist-end must precede the "--" separator');
});

test('buildYtdlpListArgs includes "--playlist-end <N>" for a configured, non-default maxVideos', () => {
  const config = makeConfig({ maxVideos: 100 });
  const result = args.buildYtdlpListArgs(baseSub(), config);
  const idx = result.indexOf('--playlist-end');
  assert.ok(idx >= 0);
  assert.equal(result[idx + 1], '100');
});

test('buildYtdlpListArgs OMITS --playlist-end entirely when maxVideos is 0 (unlimited)', () => {
  const config = makeConfig({ maxVideos: 0 });
  const result = args.buildYtdlpListArgs(baseSub(), config);
  assert.ok(!result.includes('--playlist-end'), 'maxVideos: 0 must mean no bound at all');
});

test('buildYtdlpListArgs OMITS --playlist-end when maxVideos is missing/malformed (fails safe to no limit)', () => {
  for (const bad of [undefined, null, -1, 1.5, 'abc', NaN]) {
    const config = makeConfig({ maxVideos: bad });
    const result = args.buildYtdlpListArgs(baseSub(), config);
    assert.ok(!result.includes('--playlist-end'), `maxVideos=${JSON.stringify(bad)} should omit --playlist-end`);
  }
});

// ---- FR-C: per-subscription maxVideos override (precedence over global) --

test('buildYtdlpListArgs: a per-sub maxVideos overrides the global config default', () => {
  const config = makeConfig({ maxVideos: 25 });
  const result = args.buildYtdlpListArgs(baseSub({ maxVideos: 10 }), config);
  const idx = result.indexOf('--playlist-end');
  assert.ok(idx >= 0);
  assert.equal(result[idx + 1], '10', 'the per-sub override (10) must win over the global default (25)');
});

test('buildYtdlpListArgs: an UNSET per-sub maxVideos falls back to the global default UNCHANGED (AC19)', () => {
  const config = makeConfig({ maxVideos: 25 });
  const result = args.buildYtdlpListArgs(baseSub(), config); // no sub.maxVideos
  const idx = result.indexOf('--playlist-end');
  assert.ok(idx >= 0);
  assert.equal(result[idx + 1], '25');
});

test('buildYtdlpListArgs: a per-sub maxVideos of 0 means unlimited (omits --playlist-end) even when the global has a bound', () => {
  const config = makeConfig({ maxVideos: 25 });
  const result = args.buildYtdlpListArgs(baseSub({ maxVideos: 0 }), config);
  assert.ok(!result.includes('--playlist-end'), 'sub.maxVideos: 0 must override the global bound with "unlimited"');
});

test('buildYtdlpListArgs: a null per-sub maxVideos (nullish) also falls back to the global default', () => {
  const config = makeConfig({ maxVideos: 25 });
  const result = args.buildYtdlpListArgs(baseSub({ maxVideos: null }), config);
  const idx = result.indexOf('--playlist-end');
  assert.ok(idx >= 0);
  assert.equal(result[idx + 1], '25');
});

test('buildYtdlpListArgs: an invalid per-sub maxVideos (non-integer) is not treated as a bound (playlistEndArgs fails safe to omit)', () => {
  const config = makeConfig({ maxVideos: 25 });
  const result = args.buildYtdlpListArgs(baseSub({ maxVideos: 1.5 }), config);
  // playlistEndArgs only emits the flag for a positive integer -- a
  // malformed per-sub override is NOT silently coerced into a bound.
  assert.ok(!result.includes('--playlist-end'), 'a non-integer maxVideos must not produce a --playlist-end bound');
});

// ---- buildYtdlpDownloadArgs: audio vs video, quality default -------------
//
// C1 (T4 fix round): `buildYtdlpDownloadArgs(sub, config, targetIds)` now
// targets per-survivor `watch?v=<id>` URLs built from `targetIds`, NOT
// `sub.channelUrl` -- see the "C1: per-survivor watch-URL targeting" section
// below for the dedicated structural-binding tests. These tests pass a
// representative `targetIds` array throughout.

test('buildYtdlpDownloadArgs (audio): includes -x/--extract-audio and an audio-format flag', () => {
  const config = makeConfig();
  const result = args.buildYtdlpDownloadArgs(baseSub({ format: 'audio' }), config, ['vid1']);
  assert.ok(result.includes('-x'));
  assert.ok(result.includes('--audio-format'));
});

test('buildYtdlpDownloadArgs (video): includes a -f quality selector, defaulting to best', () => {
  const config = makeConfig();
  const result = args.buildYtdlpDownloadArgs(baseSub({ format: 'video', quality: 'best' }), config, ['vid1']);
  const fIndex = result.indexOf('-f');
  assert.ok(fIndex >= 0);
  assert.match(result[fIndex + 1], /best/);
});

test('buildYtdlpDownloadArgs: the target watch URL is the last, positional argument after "--"', () => {
  const config = makeConfig();
  const result = args.buildYtdlpDownloadArgs(baseSub(), config, ['vid1']);
  assert.equal(result[result.length - 2], '--');
  assert.equal(result[result.length - 1], 'https://www.youtube.com/watch?v=vid1');
});

test('buildYtdlpDownloadArgs: -o output template is present and confined under the download dir', () => {
  const config = makeConfig();
  const result = args.buildYtdlpDownloadArgs(baseSub(), config, ['vid1']);
  const oIndex = result.indexOf('-o');
  assert.ok(oIndex >= 0);
  const template = result[oIndex + 1];
  assert.ok(template.startsWith(path.resolve(config.downloadDir) + path.sep));
});

test('buildYtdlpDownloadArgs: --download-archive path is confined under the download dir', () => {
  const config = makeConfig();
  const result = args.buildYtdlpDownloadArgs(baseSub(), config, ['vid1']);
  const archIndex = result.indexOf('--download-archive');
  assert.ok(archIndex >= 0);
  const archivePath = result[archIndex + 1];
  assert.ok(archivePath.startsWith(path.resolve(config.downloadDir) + path.sep));
});

// ---- FR-H: --embed-metadata + --embed-thumbnail for BOTH audio and video --

test('buildYtdlpDownloadArgs (audio): includes --embed-metadata and --embed-thumbnail (AC48/50)', () => {
  const config = makeConfig();
  const result = args.buildYtdlpDownloadArgs(baseSub({ format: 'audio' }), config, ['vid1']);
  assert.ok(result.includes('--embed-metadata'), 'audio download must embed metadata');
  assert.ok(result.includes('--embed-thumbnail'), 'audio download must embed the thumbnail');
});

test('buildYtdlpDownloadArgs (video): includes --embed-metadata and --embed-thumbnail (AC49/50)', () => {
  const config = makeConfig();
  const result = args.buildYtdlpDownloadArgs(baseSub({ format: 'video' }), config, ['vid1']);
  assert.ok(result.includes('--embed-metadata'), 'video download must embed metadata');
  assert.ok(result.includes('--embed-thumbnail'), 'video download must embed the thumbnail');
});

test('buildYtdlpDownloadArgs: --embed-metadata and --embed-thumbnail are each their own argv element (never concatenated)', () => {
  const config = makeConfig();
  const result = args.buildYtdlpDownloadArgs(baseSub(), config, ['vid1']);
  assert.ok(result.some((el) => el === '--embed-metadata'));
  assert.ok(result.some((el) => el === '--embed-thumbnail'));
  assert.ok(!result.some((el) => el.includes('--embed-metadata--embed-thumbnail')));
});

test('buildYtdlpDownloadArgs: --windows-filenames + "--" discipline still hold alongside the new embed flags', () => {
  const config = makeConfig();
  const result = args.buildYtdlpDownloadArgs(baseSub(), config, ['vid1']);
  assert.ok(result.includes('--windows-filenames'));
  assert.equal(result[result.length - 2], '--', '"--" must still immediately precede the target URL');
});

test('buildYtdlpDownloadArgs: an invalid format throws rather than silently producing bad args', () => {
  const config = makeConfig();
  assert.throws(() => args.buildYtdlpDownloadArgs(baseSub({ format: 'gif' }), config, ['vid1']));
});

// ---- A6 (T16, v1.24 UX Round, Wave 5): fixed-literal subtitle grab -------

test('buildYtdlpDownloadArgs (video): includes the fixed-literal subtitle grab flags', () => {
  const config = makeConfig();
  const result = args.buildYtdlpDownloadArgs(baseSub({ format: 'video' }), config, ['vid1']);
  assert.ok(result.includes('--write-subs'), 'must request manually-authored subs');
  assert.ok(result.includes('--write-auto-subs'), 'must request auto-generated subs');
  const langIdx = result.indexOf('--sub-langs');
  assert.notEqual(langIdx, -1);
  assert.equal(result[langIdx + 1], 'en.*');
  const formatIdx = result.indexOf('--sub-format');
  assert.notEqual(formatIdx, -1);
  assert.equal(result[formatIdx + 1], 'vtt');
  const convertIdx = result.indexOf('--convert-subs');
  assert.notEqual(convertIdx, -1);
  assert.equal(result[convertIdx + 1], 'vtt');
});

test('buildYtdlpDownloadArgs (audio): includes the same fixed-literal subtitle grab flags (applied unconditionally, both formats)', () => {
  const config = makeConfig();
  const result = args.buildYtdlpDownloadArgs(baseSub({ format: 'audio' }), config, ['vid1']);
  assert.ok(result.includes('--write-subs'));
  assert.ok(result.includes('--write-auto-subs'));
  assert.ok(result.includes('--sub-langs'));
  assert.ok(result.includes('--sub-format'));
  assert.ok(result.includes('--convert-subs'));
});

test('buildYtdlpDownloadArgs: the subtitle grab flags are fixed literals, never interpolated with any per-sub/per-video data', () => {
  const config = makeConfig();
  // Deliberately hostile per-video/per-sub values, mirroring this file's
  // other injection-posture tests (e.g. the quality '--exec=whoami' probe
  // below): none of these can reach the subtitle flags because those flags
  // never read `sub`/`config`/`targetIds` at all -- they are pushed as bare
  // string literals, unconditionally.
  const hostileSub = baseSub({ format: 'video', name: '--sub-langs', channelUrl: 'https://www.youtube.com/@x' });
  const result = args.buildYtdlpDownloadArgs(hostileSub, config, ['vid1']);
  // Exactly one '--sub-langs' element, immediately followed by the fixed
  // 'en.*' value -- never a hostile sub.name/channelUrl leaking in as a
  // second/duplicate/mutated occurrence of the flag or its value.
  const subLangsOccurrences = result.filter((el) => el === '--sub-langs').length;
  assert.equal(subLangsOccurrences, 1, 'exactly one --sub-langs flag, never duplicated/influenced by hostile sub fields');
  assert.equal(result[result.indexOf('--sub-langs') + 1], 'en.*');
  assert.equal(args.SHORTS_MATCH_FILTER, 'webpage_url!*=/shorts/', 'sanity: this file\'s established fixed-literal posture is unchanged');
});

// ---- C1: per-survivor watch-URL targeting (structural download scoping) --

test('buildYtdlpDownloadArgs: maps multiple targetIds to their own watch?v= URLs, ONE spawn, N positional URLs', () => {
  const config = makeConfig();
  const result = args.buildYtdlpDownloadArgs(baseSub(), config, ['survivorA', 'survivorB']);
  const sepIndex = result.indexOf('--');
  assert.ok(sepIndex >= 0);
  const targets = result.slice(sepIndex + 1);
  assert.deepEqual(targets, [
    'https://www.youtube.com/watch?v=survivorA',
    'https://www.youtube.com/watch?v=survivorB',
  ]);
});

test('buildYtdlpDownloadArgs: never falls back to sub.channelUrl as a download target', () => {
  const config = makeConfig();
  const result = args.buildYtdlpDownloadArgs(baseSub({ channelUrl: 'https://www.youtube.com/@somechannel' }), config, ['vid1']);
  assert.ok(!result.includes('https://www.youtube.com/@somechannel'), 'the whole-channel URL must never appear as a download target');
});

test('buildYtdlpDownloadArgs: an id that fails isSafeVideoId is dropped from the target set, not passed through', () => {
  const config = makeConfig();
  const result = args.buildYtdlpDownloadArgs(baseSub(), config, ['goodId', '../etc/passwd', 'also-good-id']);
  const sepIndex = result.indexOf('--');
  const targets = result.slice(sepIndex + 1);
  assert.deepEqual(targets, [
    'https://www.youtube.com/watch?v=goodId',
    'https://www.youtube.com/watch?v=also-good-id',
  ]);
});

test('buildYtdlpDownloadArgs: throws when targetIds is empty (never silently builds a channel-wide or empty target)', () => {
  const config = makeConfig();
  assert.throws(() => args.buildYtdlpDownloadArgs(baseSub(), config, []));
});

test('buildYtdlpDownloadArgs: throws when every id in targetIds is unsafe (never falls back to any other target)', () => {
  const config = makeConfig();
  assert.throws(() => args.buildYtdlpDownloadArgs(baseSub(), config, ['../traversal', 'has space', 'semi;colon']));
});

test('buildYtdlpDownloadArgs: throws when targetIds is missing/non-array', () => {
  const config = makeConfig();
  assert.throws(() => args.buildYtdlpDownloadArgs(baseSub(), config, undefined));
  assert.throws(() => args.buildYtdlpDownloadArgs(baseSub(), config, null));
});

test('buildYtdlpDownloadArgs: never places --abort-on-error (per-video failure isolation relies on yt-dlp\'s default continue-on-error)', () => {
  const config = makeConfig();
  const result = args.buildYtdlpDownloadArgs(baseSub(), config, ['vid1', 'vid2']);
  assert.ok(!result.includes('--abort-on-error'));
});

// ---- --cookies: conditional on BOTH configured AND present on disk -------

test('buildYtdlpListArgs: --cookies is present when the cookies file is configured and exists', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-cookies-'));
  const cookiesFile = path.join(dir, 'cookies.txt');
  fs.writeFileSync(cookiesFile, 'this-is-the-real-cookie-file-contents');
  const config = makeConfig({ cookiesFile });
  const result = args.buildYtdlpListArgs(baseSub(), config);
  const idx = result.indexOf('--cookies');
  assert.ok(idx >= 0);
  assert.equal(result[idx + 1], cookiesFile);
});

test('buildYtdlpListArgs: --cookies is ABSENT when cookiesFile is configured but does not exist on disk', () => {
  const config = makeConfig({ cookiesFile: '/nonexistent/path/cookies.txt' });
  const result = args.buildYtdlpListArgs(baseSub(), config);
  assert.ok(!result.includes('--cookies'));
});

test('buildYtdlpListArgs: --cookies is ABSENT when cookiesFile is unset', () => {
  const config = makeConfig({ cookiesFile: null });
  const result = args.buildYtdlpListArgs(baseSub(), config);
  assert.ok(!result.includes('--cookies'));
});

test('buildYtdlpDownloadArgs: --cookies present/absent branches mirror buildYtdlpListArgs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-cookies-'));
  const cookiesFile = path.join(dir, 'cookies.txt');
  fs.writeFileSync(cookiesFile, 'secret-cookie-data');
  const present = args.buildYtdlpDownloadArgs(baseSub(), makeConfig({ cookiesFile }), ['vid1']);
  assert.ok(present.includes('--cookies'));
  const absent = args.buildYtdlpDownloadArgs(baseSub(), makeConfig({ cookiesFile: '/nope/cookies.txt' }), ['vid1']);
  assert.ok(!absent.includes('--cookies'));
});

// ---- C4: cookiesUsable -- the single shared "cookies actually usable" ----
// ---- predicate (fs.existsSync), used by BOTH cookiesArgs and index.js's ---
// ---- cookiesConfigured gate ------------------------------------------------

test('cookiesUsable: true only when cookiesFile is set AND exists on disk', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-cookies-'));
  const cookiesFile = path.join(dir, 'cookies.txt');
  fs.writeFileSync(cookiesFile, 'secret-cookie-data');
  assert.equal(args.cookiesUsable({ cookiesFile }), true);
});

test('cookiesUsable: false when cookiesFile is set but does not exist on disk (a set-but-unmounted path fails safe)', () => {
  assert.equal(args.cookiesUsable({ cookiesFile: '/nonexistent/path/cookies.txt' }), false);
});

test('cookiesUsable: false when cookiesFile is unset/null/empty or config is missing', () => {
  assert.equal(args.cookiesUsable({ cookiesFile: null }), false);
  assert.equal(args.cookiesUsable({ cookiesFile: '' }), false);
  assert.equal(args.cookiesUsable({}), false);
  assert.equal(args.cookiesUsable(null), false);
  assert.equal(args.cookiesUsable(undefined), false);
});

// ---- v1.15.0 item 4: skip-shorts --match-filter (defense-in-depth) --------

test('buildYtdlpListArgs: emits the fixed --match-filter Shorts-exclusion argument when sub.skipShorts is strictly true', () => {
  const config = makeConfig();
  const result = args.buildYtdlpListArgs(baseSub({ skipShorts: true }), config);
  const idx = result.indexOf('--match-filter');
  assert.ok(idx >= 0, '--match-filter must be present when skipShorts is true');
  assert.equal(result[idx + 1], args.SHORTS_MATCH_FILTER);
  assert.equal(args.SHORTS_MATCH_FILTER, 'webpage_url!*=/shorts/', 'the filter must be the exact fixed constant');
  assert.ok(idx < result.indexOf('--'), '--match-filter must precede the "--" separator');
});

test('buildYtdlpListArgs: omits --match-filter when skipShorts is false/absent/undefined', () => {
  const config = makeConfig();
  assert.ok(!args.buildYtdlpListArgs(baseSub({ skipShorts: false }), config).includes('--match-filter'));
  assert.ok(!args.buildYtdlpListArgs(baseSub(), config).includes('--match-filter'));
  assert.ok(!args.buildYtdlpListArgs(baseSub({ skipShorts: undefined }), config).includes('--match-filter'));
});

test('buildYtdlpListArgs: a hostile/malformed skipShorts value (object, metacharacter-laden string, 1, null) NEVER produces --match-filter or a stray argv token (strict === true re-assert)', () => {
  const config = makeConfig();
  const hostileValues = [{ evil: true }, 'true; rm -rf /', 1, 'true', null, [true]];
  for (const hostile of hostileValues) {
    const result = args.buildYtdlpListArgs(baseSub({ skipShorts: hostile }), config);
    assert.ok(!result.includes('--match-filter'), `skipShorts=${JSON.stringify(hostile)} must not emit --match-filter`);
    for (const el of result) {
      assert.ok(!el.includes('rm -rf'), 'a hostile skipShorts value must never leak into any argv element');
    }
  }
});

test('buildYtdlpListArgs: --match-filter never influences buildYtdlpDownloadArgs (download pass targets explicit ids only)', () => {
  const config = makeConfig();
  const result = args.buildYtdlpDownloadArgs(baseSub({ skipShorts: true }), config, ['vid1']);
  assert.ok(!result.includes('--match-filter'), 'the download pass must never carry the Shorts match-filter -- it is a LIST-pass-only, defense-in-depth flag');
});

// ---- v1.22.0 FR-6: max-duration download gate, --match-filter AND-join ----
//
// CRITICAL, verified: yt-dlp OR's multiple --match-filter flags together, so
// combining "skip Shorts" with "under the max duration" MUST be a single
// --match-filter with clauses joined by " & " (yt-dlp's own AND operator),
// never two separate --match-filter args.

test('buildMatchFilterArg: neither clause active -> []', () => {
  assert.deepEqual(args.buildMatchFilterArg({ skipShorts: false, maxDurationSeconds: undefined }), []);
  assert.deepEqual(args.buildMatchFilterArg({ skipShorts: false, maxDurationSeconds: 0 }), []);
  assert.deepEqual(args.buildMatchFilterArg(), []);
});

test('buildMatchFilterArg: skipShorts alone -> a single --match-filter with only the Shorts clause', () => {
  assert.deepEqual(
    args.buildMatchFilterArg({ skipShorts: true, maxDurationSeconds: undefined }),
    ['--match-filter', 'webpage_url!*=/shorts/']
  );
});

test('buildMatchFilterArg: maxDurationSeconds alone -> a single --match-filter with only the duration clause', () => {
  assert.deepEqual(
    args.buildMatchFilterArg({ skipShorts: false, maxDurationSeconds: 7200 }),
    ['--match-filter', 'duration < 7200']
  );
});

test('buildMatchFilterArg: BOTH active -> ONE --match-filter, clauses AND-joined with " & " (never two separate --match-filter args)', () => {
  const result = args.buildMatchFilterArg({ skipShorts: true, maxDurationSeconds: 7200 });
  assert.deepEqual(result, ['--match-filter', 'webpage_url!*=/shorts/ & duration < 7200']);
  // Exactly one --match-filter flag in the result (not two).
  assert.equal(result.filter((el) => el === '--match-filter').length, 1);
});

test('buildMatchFilterArg: a non-integer/negative/zero maxDurationSeconds never contributes a duration clause (fails safe to omit)', () => {
  for (const bad of [0, -1, 1.5, 'abc', NaN, undefined, null]) {
    const result = args.buildMatchFilterArg({ skipShorts: false, maxDurationSeconds: bad });
    assert.deepEqual(result, [], `maxDurationSeconds=${JSON.stringify(bad)} should contribute no clause`);
  }
});

test('buildYtdlpListArgs: emits the combined AND-joined --match-filter when both skipShorts and an effective maxDurationSeconds are active', () => {
  const config = makeConfig({ maxDurationSeconds: 7200 });
  const result = args.buildYtdlpListArgs(baseSub({ skipShorts: true }), config);
  const idx = result.indexOf('--match-filter');
  assert.ok(idx >= 0);
  assert.equal(result[idx + 1], 'webpage_url!*=/shorts/ & duration < 7200');
  // Exactly one --match-filter arg -- never two separate ones (which yt-dlp
  // would OR together instead of AND).
  assert.equal(result.filter((el) => el === '--match-filter').length, 1);
  assert.ok(idx < result.indexOf('--'), '--match-filter must precede the "--" separator');
});

test('buildYtdlpListArgs: emits --match-filter for maxDurationSeconds alone (skipShorts off)', () => {
  const config = makeConfig({ maxDurationSeconds: 3600 });
  const result = args.buildYtdlpListArgs(baseSub({ skipShorts: false }), config);
  const idx = result.indexOf('--match-filter');
  assert.ok(idx >= 0);
  assert.equal(result[idx + 1], 'duration < 3600');
});

test('buildYtdlpListArgs: OMITS --match-filter entirely when maxDurationSeconds is 0 (unbounded) and skipShorts is off', () => {
  const config = makeConfig({ maxDurationSeconds: 0 });
  const result = args.buildYtdlpListArgs(baseSub({ skipShorts: false }), config);
  assert.ok(!result.includes('--match-filter'));
});

test('buildYtdlpListArgs: a per-sub maxDurationSeconds overrides the global config default (effectiveMaxDurationSeconds resolution)', () => {
  const config = makeConfig({ maxDurationSeconds: 7200 });
  const result = args.buildYtdlpListArgs(baseSub({ maxDurationSeconds: 1800 }), config);
  const idx = result.indexOf('--match-filter');
  assert.ok(idx >= 0);
  assert.equal(result[idx + 1], 'duration < 1800', 'the per-sub override (1800) must win over the global default (7200)');
});

test('buildYtdlpListArgs: an UNSET per-sub maxDurationSeconds falls back to the global default UNCHANGED', () => {
  const config = makeConfig({ maxDurationSeconds: 7200 });
  const result = args.buildYtdlpListArgs(baseSub(), config); // no sub.maxDurationSeconds
  const idx = result.indexOf('--match-filter');
  assert.ok(idx >= 0);
  assert.equal(result[idx + 1], 'duration < 7200');
});

test('buildYtdlpListArgs: a per-sub maxDurationSeconds of 0 means unbounded (omits the duration clause) even when the global has a bound', () => {
  const config = makeConfig({ maxDurationSeconds: 7200 });
  const result = args.buildYtdlpListArgs(baseSub({ maxDurationSeconds: 0 }), config);
  assert.ok(!result.includes('--match-filter'), 'sub.maxDurationSeconds: 0 must override the global bound with "unbounded"');
});

test('buildYtdlpListArgs: --match-filter (duration clause) never influences buildYtdlpDownloadArgs (download pass targets explicit ids only)', () => {
  const config = makeConfig({ maxDurationSeconds: 3600 });
  const result = args.buildYtdlpDownloadArgs(baseSub(), config, ['vid1']);
  assert.ok(!result.includes('--match-filter'), 'the download pass must never carry the duration match-filter -- it is a LIST-pass-only flag');
});

test('buildYtdlpListArgs: <n> in the duration clause is always the exact bounded integer, never a hostile string (security posture)', () => {
  // maxDurationSeconds only ever reaches buildYtdlpListArgs as an already
  // config/store-validated bounded integer -- this asserts the emitted
  // clause is a FIXED "duration < <n>" shape with `n` interpolated as a
  // plain number, never anything that could carry shell/argv metacharacters.
  const config = makeConfig({ maxDurationSeconds: 12345 });
  const result = args.buildYtdlpListArgs(baseSub(), config);
  const idx = result.indexOf('--match-filter');
  assert.equal(result[idx + 1], 'duration < 12345');
  assert.match(result[idx + 1], /^duration < \d+$/);
});

// ---- v1.15.0 item 6: one-off archive bypass (oneOff opt) ------------------

test('buildYtdlpDownloadArgs: a one-off build (opts.oneOff: true) includes --no-download-archive + --force-overwrites, and OMITS --download-archive', () => {
  const config = makeConfig();
  const result = args.buildYtdlpDownloadArgs(baseSub(), config, ['vid1'], { oneOff: true });
  assert.ok(result.includes('--no-download-archive'));
  assert.ok(result.includes('--force-overwrites'));
  assert.ok(!result.includes('--download-archive'), 'a one-off must never carry the shared --download-archive flag');
});

test('buildYtdlpDownloadArgs: a subscription-cycle build (no opts / oneOff falsy) keeps --download-archive UNCHANGED and carries neither one-off flag (regression)', () => {
  const config = makeConfig();
  const noOpts = args.buildYtdlpDownloadArgs(baseSub(), config, ['vid1']);
  assert.ok(noOpts.includes('--download-archive'));
  assert.ok(!noOpts.includes('--no-download-archive'));
  assert.ok(!noOpts.includes('--force-overwrites'));

  const explicitlyFalse = args.buildYtdlpDownloadArgs(baseSub(), config, ['vid1'], { oneOff: false });
  assert.ok(explicitlyFalse.includes('--download-archive'));
  assert.ok(!explicitlyFalse.includes('--no-download-archive'));
  assert.ok(!explicitlyFalse.includes('--force-overwrites'));
});

test('buildYtdlpDownloadArgs: the one-off and subscription code paths diverge ONLY in the archive-related flags -- everything else (embed/format/confinement/"--"discipline) is identical', () => {
  const config = makeConfig();
  const subscriptionArgs = args.buildYtdlpDownloadArgs(baseSub(), config, ['vid1']);
  const oneOffArgs = args.buildYtdlpDownloadArgs(baseSub(), config, ['vid1'], { oneOff: true });

  const archiveRelated = new Set(['--download-archive', '--no-download-archive', '--force-overwrites']);
  // Strip the archive path value (which immediately follows --download-archive
  // in the subscription array) before comparing, alongside the flag tokens.
  const stripArchiveRelated = (arr) => {
    const out = [];
    for (let i = 0; i < arr.length; i++) {
      if (archiveRelated.has(arr[i])) {
        if (arr[i] === '--download-archive') i += 1; // also skip its path value
        continue;
      }
      out.push(arr[i]);
    }
    return out;
  };
  assert.deepEqual(stripArchiveRelated(subscriptionArgs), stripArchiveRelated(oneOffArgs));
});

// ---- quality/format sanitization (T2-QA-folded; security-adjacent) -------

test('normalizeQuality: passes through an allowlisted value unchanged', () => {
  assert.equal(args.normalizeQuality('best'), 'best');
  assert.equal(args.normalizeQuality('1080p'), '1080p');
});

test('normalizeQuality: a hostile "--exec" value is neutralized to the safe default, never emitted verbatim', () => {
  assert.equal(args.normalizeQuality('--exec'), 'best');
});

test('normalizeQuality: an option-like "-f evil" value is neutralized to the safe default', () => {
  assert.equal(args.normalizeQuality('-f evil'), 'best');
});

test('normalizeQuality: a value with shell metacharacters is neutralized to the safe default', () => {
  assert.equal(args.normalizeQuality('best; rm -rf /'), 'best');
});

test('normalizeQuality: a ~10KB string is neutralized to the safe default (never truncated-and-passed-through)', () => {
  const huge = '1080p'.padEnd(10 * 1024, 'x');
  assert.equal(args.normalizeQuality(huge), 'best');
});

test('normalizeQuality: non-string input is neutralized to the safe default', () => {
  assert.equal(args.normalizeQuality(undefined), 'best');
  assert.equal(args.normalizeQuality(null), 'best');
  assert.equal(args.normalizeQuality(1080), 'best');
});

test('a hostile quality value never becomes its own arg-array token in the download args', () => {
  const config = makeConfig();
  const result = args.buildYtdlpDownloadArgs(baseSub({ format: 'video', quality: '--exec=whoami' }), config, ['vid1']);
  assert.ok(!result.includes('--exec=whoami'));
  for (const el of result) {
    assert.ok(!el.includes('whoami'), `hostile quality leaked into arg: ${el}`);
  }
});

test('assertFormat: accepts "audio"/"video", rejects anything else', () => {
  assert.equal(args.assertFormat('audio'), 'audio');
  assert.equal(args.assertFormat('video'), 'video');
  assert.throws(() => args.assertFormat('gif'));
  assert.throws(() => args.assertFormat(undefined));
  assert.throws(() => args.assertFormat('--exec'));
});

// ---- sanitizeChannelName / resolveChannelDir: path-traversal confinement -

test('sanitizeChannelName: strips path separators', () => {
  assert.equal(args.sanitizeChannelName('a/b\\c'), 'a-b-c');
});

test('sanitizeChannelName: neutralizes ".." traversal sequences and falls back when nothing safe remains', () => {
  assert.equal(args.sanitizeChannelName('..'), 'channel');
  assert.equal(args.sanitizeChannelName('../../etc'), 'etc');
});

test('sanitizeChannelName: neutralizes an absolute path', () => {
  const result = args.sanitizeChannelName('/etc/passwd');
  assert.ok(!result.startsWith('/'));
});

test('sanitizeChannelName: strips control characters and unicode dot-lookalikes', () => {
  assert.ok(!args.sanitizeChannelName('a\x01b').includes('\x01'));
  const result = args.sanitizeChannelName('a．．b'); // fullwidth dots
  assert.ok(!result.includes('．'));
});

test('sanitizeChannelName: bounds length and never returns an empty string', () => {
  assert.equal(args.sanitizeChannelName(''), 'channel');
  assert.equal(args.sanitizeChannelName('   '), 'channel');
  assert.equal(args.sanitizeChannelName(null), 'channel');
  const long = args.sanitizeChannelName('a'.repeat(500));
  assert.ok(long.length <= 150);
});

test('resolveChannelDir: confines a normal channel name under the download root', () => {
  const config = makeConfig();
  const dir = args.resolveChannelDir(config, baseSub({ name: 'Some Channel' }));
  const root = path.resolve(config.downloadDir);
  assert.ok(dir === root || dir.startsWith(root + path.sep));
});

test('resolveChannelDir: a "../" traversal attempt in the channel name stays confined under the root', () => {
  const config = makeConfig();
  const dir = args.resolveChannelDir(config, baseSub({ name: '../../../etc' }));
  const root = path.resolve(config.downloadDir);
  assert.ok(dir === root || dir.startsWith(root + path.sep), `escaped root: ${dir}`);
});

test('resolveChannelDir: an absolute-path channel name stays confined under the root', () => {
  const config = makeConfig();
  const dir = args.resolveChannelDir(config, baseSub({ name: '/etc/passwd' }));
  const root = path.resolve(config.downloadDir);
  assert.ok(dir === root || dir.startsWith(root + path.sep), `escaped root: ${dir}`);
});

test('resolveChannelDir: embedded separator tricks stay confined under the root', () => {
  const config = makeConfig();
  const dir = args.resolveChannelDir(config, baseSub({ name: 'a/../../../b' }));
  const root = path.resolve(config.downloadDir);
  assert.ok(dir === root || dir.startsWith(root + path.sep), `escaped root: ${dir}`);
});

test('resolveArchivePath: resolves to a dotfile under the download root', () => {
  const config = makeConfig();
  const archivePath = args.resolveArchivePath(config);
  const root = path.resolve(config.downloadDir);
  assert.ok(archivePath.startsWith(root + path.sep));
  assert.ok(path.basename(archivePath).startsWith('.'));
});

// ---- SF4: --windows-filenames + isPathUnder / realpathUnderChannelDir ----

test('buildYtdlpDownloadArgs: includes --windows-filenames (defense-in-depth against a hostile video title), NOT --restrict-filenames', () => {
  const config = makeConfig();
  const result = args.buildYtdlpDownloadArgs(baseSub(), config, ['vid1']);
  assert.ok(result.includes('--windows-filenames'));
  assert.ok(!result.includes('--restrict-filenames'), 'the old flag must be fully replaced, not merely supplemented');
});

test('isPathUnder: accepts the root itself and a nested descendant', () => {
  assert.ok(args.isPathUnder('/data/downloads', '/data/downloads'));
  assert.ok(args.isPathUnder('/data/downloads/channel/video.mp4', '/data/downloads'));
});

test('isPathUnder: rejects an escaping path (../ traversal out of the root)', () => {
  assert.ok(!args.isPathUnder('/data/downloads/../etc/passwd', '/data/downloads'));
  assert.ok(!args.isPathUnder('/etc/passwd', '/data/downloads'));
});

test('isPathUnder: rejects a sibling directory whose name merely starts with the root\'s name', () => {
  // A naive `startsWith(root)` (no separator) would wrongly accept this.
  assert.ok(!args.isPathUnder('/data/downloads-evil/file.mp4', '/data/downloads'));
});

test('isPathUnder: rejects non-string input rather than throwing', () => {
  assert.equal(args.isPathUnder(null, '/data/downloads'), false);
  assert.equal(args.isPathUnder('/data/downloads', undefined), false);
  assert.equal(args.isPathUnder('', ''), false);
});

test('realpathUnderChannelDir: accepts a real file that resolves under the channel dir', () => {
  const config = makeConfig();
  const channelDir = args.resolveChannelDir(config, baseSub());
  fs.mkdirSync(channelDir, { recursive: true });
  const filePath = path.join(channelDir, 'video.mp4');
  fs.writeFileSync(filePath, 'x');
  assert.equal(args.realpathUnderChannelDir(filePath, channelDir), true);
});

test('realpathUnderChannelDir: fails closed (false, never throws) when the file does not exist', () => {
  const config = makeConfig();
  const channelDir = args.resolveChannelDir(config, baseSub());
  fs.mkdirSync(channelDir, { recursive: true });
  const missing = path.join(channelDir, 'does-not-exist.mp4');
  assert.doesNotThrow(() => args.realpathUnderChannelDir(missing, channelDir));
  assert.equal(args.realpathUnderChannelDir(missing, channelDir), false);
});

test('realpathUnderChannelDir: rejects a symlink planted inside the channel dir that points outside it', () => {
  const config = makeConfig();
  const channelDir = args.resolveChannelDir(config, baseSub());
  fs.mkdirSync(channelDir, { recursive: true });
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-outside-'));
  const outsideFile = path.join(outsideDir, 'secret.txt');
  fs.writeFileSync(outsideFile, 'secret');
  const linkPath = path.join(channelDir, 'video.mp4');
  fs.symlinkSync(outsideFile, linkPath);
  assert.equal(args.realpathUnderChannelDir(linkPath, channelDir), false);
});

// ---- v1.15.0 item 5 MANDATED SECURITY REGRESSION: --windows-filenames -----
// ---- must not weaken the SF4 confinement guard -----------------------------
//
// The flag swap (--restrict-filenames -> --windows-filenames) only changes
// which characters yt-dlp's OWN filename sanitizer permits; it is NEVER the
// authoritative guard. These tests prove the guard itself -- resolveChannelDir
// + realpathUnderChannelDir -- still rejects/contains a hostile, traversal-
// and-control-char-laden title/name, independent of which sanitizer flag was
// used to produce the on-disk name.

test('SECURITY REGRESSION (item 5): a hostile title containing "../", both path separators, and control characters cannot escape the channel dir via resolveChannelDir -- confinement holds regardless of the filename flag', () => {
  const config = makeConfig();
  // sanitizeChannelName/resolveChannelDir operate on the CHANNEL name (the
  // directory the -o template is rooted at); a hostile "title" attack is
  // structurally the same shape here -- both are attacker-controlled yt-dlp
  // metadata strings that must never let the confined dir escape.
  const hostileName = '../../../etc/passwd\\..\\..\\evil\x00\x01\x1f';
  const dir = args.resolveChannelDir(config, baseSub({ name: hostileName }));
  const root = path.resolve(config.downloadDir);
  assert.ok(dir === root || dir.startsWith(root + path.sep), `hostile name escaped the confined root: ${dir}`);
});

test('SECURITY REGRESSION (item 5): --windows-filenames replaces --restrict-filenames, but a symlink escape produced under a hostile-shaped filename is STILL rejected by realpathUnderChannelDir/quarantine (the guard, not the flag, is authoritative)', () => {
  const config = makeConfig();
  const channelDir = args.resolveChannelDir(config, baseSub());
  fs.mkdirSync(channelDir, { recursive: true });

  // A single flat filename that LOOKS like a hostile, traversal-laden title
  // (".." segments, embedded control-char remnants collapsed to safe chars,
  // an [id]-shaped suffix) but, because it can only ever be ONE filesystem
  // path segment (no real OS separator can live inside a filename), is not
  // itself an escape -- it must be accepted as living under the channel dir
  // regardless of which sanitizer flag produced it.
  const hostileLookingButContainedName = '.._.._.._etc_passwd [aBcDeFgHiJk].mp4';
  const containedPath = path.join(channelDir, hostileLookingButContainedName);
  fs.writeFileSync(containedPath, 'x');
  assert.equal(
    args.realpathUnderChannelDir(containedPath, channelDir),
    true,
    'a merely suspicious-looking, non-escaping filename must resolve under the channel dir'
  );

  // The actual attack vector this guard exists for: a SYMLINK planted inside
  // the channel dir (its own name irrelevant) that points OUTSIDE the
  // confined root -- this must be rejected identically whether the filename
  // sanitizer in effect is --restrict-filenames or --windows-filenames,
  // because the check runs on the file's REAL resolved path, never on the
  // flag that produced its name.
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-outside-'));
  const outsideFile = path.join(outsideDir, 'passwd');
  fs.writeFileSync(outsideFile, 'root:x:0:0:root:/root:/bin/bash');
  const escapingLinkPath = path.join(channelDir, '.._.._.._escaped [zYxWvUtSrQp].mp4');
  fs.symlinkSync(outsideFile, escapingLinkPath);
  assert.equal(
    args.realpathUnderChannelDir(escapingLinkPath, channelDir),
    false,
    'confinement must reject an escaping symlink regardless of the filename-sanitizer flag'
  );
});

test('SECURITY REGRESSION (item 5): OUTPUT_TEMPLATE still carries %(id)s, preserving id-based uniqueness for --download-archive dedup under the new filename flag', () => {
  assert.ok(args.OUTPUT_TEMPLATE.includes('%(id)s'), 'the id token must remain in the output template so two same-titled videos never collide on disk');
});

// ---- v1.13.0 item 4: normalizeFiletype (spawn-args-flagged allowlist) -----

test('normalizeFiletype: passes through a valid per-format value unchanged', () => {
  assert.equal(args.normalizeFiletype('video', 'mp4'), 'mp4');
  assert.equal(args.normalizeFiletype('video', 'mkv'), 'mkv');
  assert.equal(args.normalizeFiletype('video', 'webm'), 'webm');
  assert.equal(args.normalizeFiletype('video', 'default'), 'default');
  assert.equal(args.normalizeFiletype('audio', 'mp3'), 'mp3');
  assert.equal(args.normalizeFiletype('audio', 'm4a'), 'm4a');
  assert.equal(args.normalizeFiletype('audio', 'opus'), 'opus');
  assert.equal(args.normalizeFiletype('audio', 'default'), 'default');
});

test('normalizeFiletype: an unset/missing value normalizes to "default"', () => {
  assert.equal(args.normalizeFiletype('video', undefined), 'default');
  assert.equal(args.normalizeFiletype('audio', undefined), 'default');
  assert.equal(args.normalizeFiletype('video', null), 'default');
});

test('normalizeFiletype: a hostile/injection-shaped value is neutralized to "default", never thrown', () => {
  assert.equal(args.normalizeFiletype('video', 'mp4; rm -rf /'), 'default');
  assert.equal(args.normalizeFiletype('video', '../x'), 'default');
  assert.equal(args.normalizeFiletype('video', '--exec=whoami'), 'default');
  assert.equal(args.normalizeFiletype('audio', '-f evil'), 'default');
});

test('normalizeFiletype: a value that is only valid for the OTHER format degrades to "default"', () => {
  // A video extension supplied alongside format:'audio' (and vice versa)
  // must never leak through -- the allowlist is format-PARTITIONED.
  assert.equal(args.normalizeFiletype('audio', 'mp4'), 'default');
  assert.equal(args.normalizeFiletype('audio', 'mkv'), 'default');
  assert.equal(args.normalizeFiletype('audio', 'webm'), 'default');
  assert.equal(args.normalizeFiletype('video', 'mp3'), 'default');
  assert.equal(args.normalizeFiletype('video', 'm4a'), 'default');
  assert.equal(args.normalizeFiletype('video', 'opus'), 'default');
});

test('normalizeFiletype: a non-string value (object, number, array) never throws and normalizes to "default"', () => {
  assert.doesNotThrow(() => args.normalizeFiletype('video', { evil: true }));
  assert.equal(args.normalizeFiletype('video', { evil: true }), 'default');
  assert.equal(args.normalizeFiletype('video', 42), 'default');
  assert.equal(args.normalizeFiletype('video', ['mp4']), 'default');
});

test('normalizeFiletype: an unknown/invalid format also normalizes to "default" rather than throwing', () => {
  assert.doesNotThrow(() => args.normalizeFiletype('gif', 'mp4'));
  assert.equal(args.normalizeFiletype('gif', 'mp4'), 'default');
  assert.equal(args.normalizeFiletype(undefined, 'mp4'), 'default');
});

// ---- v1.13.0 item 4: buildYtdlpDownloadArgs filetype mapping --------------

test('buildYtdlpDownloadArgs (video, filetype mp4): emits --merge-output-format mp4 as its own argv element, before "--"', () => {
  const config = makeConfig();
  const result = args.buildYtdlpDownloadArgs(baseSub({ format: 'video', filetype: 'mp4' }), config, ['vid1']);
  const idx = result.indexOf('--merge-output-format');
  assert.ok(idx >= 0, '--merge-output-format must be present for a non-default video filetype');
  assert.equal(result[idx + 1], 'mp4');
  assert.ok(idx < result.indexOf('--'), '--merge-output-format must precede the "--" separator');
  // Never --recode-video (lossless remux only, per the design).
  assert.ok(!result.includes('--recode-video'));
});

test('buildYtdlpDownloadArgs (video, filetype mkv/webm): emits --merge-output-format with the chosen container', () => {
  const config = makeConfig();
  const mkvResult = args.buildYtdlpDownloadArgs(baseSub({ format: 'video', filetype: 'mkv' }), config, ['vid1']);
  assert.equal(mkvResult[mkvResult.indexOf('--merge-output-format') + 1], 'mkv');
  const webmResult = args.buildYtdlpDownloadArgs(baseSub({ format: 'video', filetype: 'webm' }), config, ['vid1']);
  assert.equal(webmResult[webmResult.indexOf('--merge-output-format') + 1], 'webm');
});

test('buildYtdlpDownloadArgs (video, filetype "default" or unset): omits --merge-output-format entirely (today\'s behavior)', () => {
  const config = makeConfig();
  const explicitDefault = args.buildYtdlpDownloadArgs(baseSub({ format: 'video', filetype: 'default' }), config, ['vid1']);
  assert.ok(!explicitDefault.includes('--merge-output-format'));
  const unset = args.buildYtdlpDownloadArgs(baseSub({ format: 'video', filetype: undefined }), config, ['vid1']);
  assert.ok(!unset.includes('--merge-output-format'));
});

test('buildYtdlpDownloadArgs (audio, filetype m4a/opus): --audio-format reflects the chosen filetype', () => {
  const config = makeConfig();
  const m4a = args.buildYtdlpDownloadArgs(baseSub({ format: 'audio', filetype: 'm4a' }), config, ['vid1']);
  const m4aIdx = m4a.indexOf('--audio-format');
  assert.ok(m4aIdx >= 0);
  assert.equal(m4a[m4aIdx + 1], 'm4a');

  const opus = args.buildYtdlpDownloadArgs(baseSub({ format: 'audio', filetype: 'opus' }), config, ['vid1']);
  assert.equal(opus[opus.indexOf('--audio-format') + 1], 'opus');
});

test('buildYtdlpDownloadArgs (audio, filetype "default" or unset): --audio-format stays mp3 (unchanged historical behavior)', () => {
  const config = makeConfig();
  const explicitDefault = args.buildYtdlpDownloadArgs(baseSub({ format: 'audio', filetype: 'default' }), config, ['vid1']);
  assert.equal(explicitDefault[explicitDefault.indexOf('--audio-format') + 1], 'mp3');
  const unset = args.buildYtdlpDownloadArgs(baseSub({ format: 'audio', filetype: undefined }), config, ['vid1']);
  assert.equal(unset[unset.indexOf('--audio-format') + 1], 'mp3');
});

test('buildYtdlpDownloadArgs: a hostile filetype never reaches argv verbatim (normalized to "default"/mp3 first)', () => {
  const config = makeConfig();
  const videoResult = args.buildYtdlpDownloadArgs(baseSub({ format: 'video', filetype: 'mp4; rm -rf /' }), config, ['vid1']);
  assert.ok(!videoResult.includes('--merge-output-format'), 'a hostile video filetype must normalize to "default" (flag omitted)');
  for (const el of videoResult) {
    assert.ok(!el.includes('rm -rf'), `hostile filetype leaked into arg: ${el}`);
  }

  const audioResult = args.buildYtdlpDownloadArgs(baseSub({ format: 'audio', filetype: '--exec=whoami' }), config, ['vid1']);
  assert.equal(audioResult[audioResult.indexOf('--audio-format') + 1], 'mp3', 'a hostile audio filetype must normalize to the safe default (mp3)');
  for (const el of audioResult) {
    assert.ok(!el.includes('whoami'), `hostile filetype leaked into arg: ${el}`);
  }
});

test('buildYtdlpDownloadArgs: a video filetype value degrades safely for a mismatched audio format', () => {
  const config = makeConfig();
  const result = args.buildYtdlpDownloadArgs(baseSub({ format: 'audio', filetype: 'mp4' }), config, ['vid1']);
  assert.equal(result[result.indexOf('--audio-format') + 1], 'mp3', 'a video-only filetype on an audio sub must degrade to the audio default, not leak through');
});

test('buildYtdlpDownloadArgs: --windows-filenames/"--"/arg-array discipline intact alongside the filetype mapping', () => {
  const config = makeConfig();
  const result = args.buildYtdlpDownloadArgs(baseSub({ format: 'video', filetype: 'mkv' }), config, ['vid1']);
  assert.ok(Array.isArray(result));
  assert.ok(result.every((el) => typeof el === 'string'));
  assert.ok(result.includes('--windows-filenames'));
  assert.equal(result[result.length - 2], '--', '"--" must still immediately precede the target URL');
  assert.equal(result[result.length - 1], 'https://www.youtube.com/watch?v=vid1');
});

// ---- v1.18.0 FR-1a: iOS-compatible H.264/AAC format sort (soft -S) --------

test('VIDEO_FORMAT_SORT is the exact fixed literal expected by the design', () => {
  assert.equal(args.VIDEO_FORMAT_SORT, 'vcodec:h264,acodec:aac');
});

test('buildYtdlpDownloadArgs (video): "-S VIDEO_FORMAT_SORT" is present, immediately after "-f <selector>", for every QUALITY_SELECTORS tier', () => {
  const config = makeConfig();
  const tiers = ['best', '2160p', '1440p', '1080p', '720p', '480p', '360p', 'default' /* -> normalizes to 'best' */];
  for (const quality of tiers) {
    const result = args.buildYtdlpDownloadArgs(baseSub({ format: 'video', quality }), config, ['vid1']);
    const fIndex = result.indexOf('-f');
    assert.ok(fIndex >= 0, `-f missing for quality=${quality}`);
    assert.equal(result[fIndex + 2], '-S', `-S must immediately follow "-f <selector>" for quality=${quality}`);
    assert.equal(result[fIndex + 3], args.VIDEO_FORMAT_SORT, `-S value must be VIDEO_FORMAT_SORT for quality=${quality}`);
    // -S must land before --merge-output-format and well before "--"/positional targets.
    const sIndex = fIndex + 2;
    assert.ok(sIndex < result.indexOf('--'), '-S must precede the "--" separator');
    const mergeIdx = result.indexOf('--merge-output-format');
    if (mergeIdx >= 0) {
      assert.ok(sIndex < mergeIdx, '-S must precede --merge-output-format when present');
    }
  }
});

test('buildYtdlpDownloadArgs (video, filetype "default"/"mkv"/"webm"): -S is still present regardless of container selection (fork #2 resolved scope)', () => {
  const config = makeConfig();
  for (const filetype of ['default', 'mkv', 'webm', 'mp4', undefined]) {
    const result = args.buildYtdlpDownloadArgs(baseSub({ format: 'video', filetype }), config, ['vid1']);
    const sIndex = result.indexOf('-S');
    assert.ok(sIndex >= 0, `-S missing for filetype=${filetype}`);
    assert.equal(result[sIndex + 1], args.VIDEO_FORMAT_SORT);
  }
});

test('buildYtdlpDownloadArgs (audio): NEVER includes -S / VIDEO_FORMAT_SORT (no video-codec preference leaks into audio extraction)', () => {
  const config = makeConfig();
  for (const filetype of ['default', 'mp3', 'm4a', 'opus', undefined]) {
    const result = args.buildYtdlpDownloadArgs(baseSub({ format: 'audio', filetype }), config, ['vid1']);
    assert.ok(!result.includes('-S'), `audio download must never carry -S (filetype=${filetype})`);
    assert.ok(!result.includes(args.VIDEO_FORMAT_SORT), `audio download must never carry VIDEO_FORMAT_SORT (filetype=${filetype})`);
  }
});

test('buildYtdlpDownloadArgs (video, filetype mp4): --merge-output-format mp4 still fires exactly as before, alongside the new -S', () => {
  const config = makeConfig();
  const result = args.buildYtdlpDownloadArgs(baseSub({ format: 'video', filetype: 'mp4' }), config, ['vid1']);
  const mergeIdx = result.indexOf('--merge-output-format');
  assert.ok(mergeIdx >= 0, '--merge-output-format must still be emitted for filetype mp4');
  assert.equal(result[mergeIdx + 1], 'mp4');
  assert.ok(result.includes('-S'), '-S must also be present for filetype mp4');
});

test('buildYtdlpDownloadArgs (video, filetype "default"/"mkv"/"webm"): --merge-output-format trigger condition is UNCHANGED by the new -S (still omitted for default, still emitted for mkv/webm)', () => {
  const config = makeConfig();
  const defaultResult = args.buildYtdlpDownloadArgs(baseSub({ format: 'video', filetype: 'default' }), config, ['vid1']);
  assert.ok(!defaultResult.includes('--merge-output-format'), '--merge-output-format must stay omitted for filetype "default"');
  const unsetResult = args.buildYtdlpDownloadArgs(baseSub({ format: 'video', filetype: undefined }), config, ['vid1']);
  assert.ok(!unsetResult.includes('--merge-output-format'), '--merge-output-format must stay omitted when filetype is unset');
  const mkvResult = args.buildYtdlpDownloadArgs(baseSub({ format: 'video', filetype: 'mkv' }), config, ['vid1']);
  assert.equal(mkvResult[mkvResult.indexOf('--merge-output-format') + 1], 'mkv');
  const webmResult = args.buildYtdlpDownloadArgs(baseSub({ format: 'video', filetype: 'webm' }), config, ['vid1']);
  assert.equal(webmResult[webmResult.indexOf('--merge-output-format') + 1], 'webm');
});

test('buildYtdlpDownloadArgs (video): "--" separator and positional target discipline still hold with -S present', () => {
  const config = makeConfig();
  const result = args.buildYtdlpDownloadArgs(baseSub({ format: 'video' }), config, ['vid1', 'vid2']);
  const sepIndex = result.indexOf('--');
  assert.ok(sepIndex >= 0);
  assert.deepEqual(result.slice(sepIndex + 1), [
    'https://www.youtube.com/watch?v=vid1',
    'https://www.youtube.com/watch?v=vid2',
  ]);
  assert.ok(result.indexOf('-S') < sepIndex, '-S must precede the "--" separator');
});

test('buildYtdlpDownloadArgs (video, one-off vs subscription): both paths receive the SAME -S args (shared builder, no divergent one-off logic for FR-1a)', () => {
  const config = makeConfig();
  const subscriptionArgs = args.buildYtdlpDownloadArgs(baseSub({ format: 'video' }), config, ['vid1']);
  const oneOffArgs = args.buildYtdlpDownloadArgs(baseSub({ format: 'video' }), config, ['vid1'], { oneOff: true });
  const sIdxSub = subscriptionArgs.indexOf('-S');
  const sIdxOneOff = oneOffArgs.indexOf('-S');
  assert.ok(sIdxSub >= 0 && sIdxOneOff >= 0);
  assert.equal(subscriptionArgs[sIdxSub + 1], args.VIDEO_FORMAT_SORT);
  assert.equal(oneOffArgs[sIdxOneOff + 1], args.VIDEO_FORMAT_SORT);
});

// ---- v1.20.0 FR-2: --print after_move:FTCHMETA capture template -----------
//
// SECURITY-CRITICAL / two-reviewer gate: this is a FIXED literal (sentinel +
// %(field)s placeholders only) added unconditionally to the download-pass
// argv -- these tests prove the exact literal, its position (before the
// `--`/positional targets), that it is present for BOTH format branches and
// BOTH the subscription and one-off calling conventions (one shared
// builder), and -- most importantly -- that the `after_move:` WHEN-prefix
// is present so this remains a REAL download, never `--simulate`.

test('buildYtdlpDownloadArgs: includes the fixed "--print after_move:FTCHMETA..." literal, unmodified by any sub/config field', () => {
  const config = makeConfig();
  const result = args.buildYtdlpDownloadArgs(baseSub(), config, ['vid1']);
  const idx = result.indexOf('--print');
  assert.ok(idx >= 0, 'expected a --print flag in the download args');
  assert.equal(result[idx + 1], args.CHANNEL_META_PRINT_TEMPLATE);
  assert.equal(
    result[idx + 1],
    // v1.24.0 C5-ytdlp/C6 (T11): field-selector grew upload_date/release_date/
    // channel_thumbnail -- still a fixed literal, still JSON-escaped/one-line-safe.
    'after_move:FTCHMETA %(.{id,channel_url,channel_id,uploader_url,channel,upload_date,release_date,channel_thumbnail})j',
  );
});

test('buildYtdlpDownloadArgs: the --print template starts with "after_move:" (load-bearing -- a bare --print implies --simulate and would skip the download)', () => {
  const config = makeConfig();
  const result = args.buildYtdlpDownloadArgs(baseSub(), config, ['vid1']);
  const idx = result.indexOf('--print');
  assert.ok(result[idx + 1].startsWith('after_move:'), 'the after_move: WHEN-prefix must be present');
});

test('buildYtdlpDownloadArgs: the --print flag precedes the "-o"/"--"/positional targets', () => {
  const config = makeConfig();
  const result = args.buildYtdlpDownloadArgs(baseSub(), config, ['vid1']);
  const printIdx = result.indexOf('--print');
  const sepIdx = result.indexOf('--');
  const oIdx = result.indexOf('-o');
  assert.ok(printIdx >= 0 && sepIdx >= 0 && oIdx >= 0);
  assert.ok(printIdx < sepIdx, '--print must precede the "--" separator');
  assert.ok(printIdx < oIdx || oIdx < printIdx, 'sanity: -o is also present'); // position relative to -o is not itself security-relevant
});

test('buildYtdlpDownloadArgs (audio): the --print capture template is ALSO present (applies to both format branches)', () => {
  const config = makeConfig();
  const result = args.buildYtdlpDownloadArgs(baseSub({ format: 'audio' }), config, ['vid1']);
  const idx = result.indexOf('--print');
  assert.ok(idx >= 0);
  assert.equal(result[idx + 1], args.CHANNEL_META_PRINT_TEMPLATE);
});

test('buildYtdlpDownloadArgs (one-off vs subscription): both calling conventions get the IDENTICAL --print template (one shared builder, no divergent one-off logic)', () => {
  const config = makeConfig();
  const subscriptionArgs = args.buildYtdlpDownloadArgs(baseSub(), config, ['vid1']);
  const oneOffArgs = args.buildYtdlpDownloadArgs(baseSub(), config, ['vid1'], { oneOff: true });
  assert.equal(subscriptionArgs[subscriptionArgs.indexOf('--print') + 1], args.CHANNEL_META_PRINT_TEMPLATE);
  assert.equal(oneOffArgs[oneOffArgs.indexOf('--print') + 1], args.CHANNEL_META_PRINT_TEMPLATE);
});

test('buildYtdlpDownloadArgs: the --print template never changes shape regardless of sub/config content (fixed literal, never interpolated)', () => {
  const config = makeConfig();
  const hostileSub = baseSub({
    name: 'Evil"; rm -rf /; #',
    channelUrl: 'https://www.youtube.com/@somechannel',
  });
  const result = args.buildYtdlpDownloadArgs(hostileSub, config, ['vid1']);
  const idx = result.indexOf('--print');
  assert.equal(result[idx + 1], args.CHANNEL_META_PRINT_TEMPLATE, 'the --print literal must be byte-identical regardless of sub content');
});

test('buildYtdlpDownloadArgs: only ONE --print flag is ever emitted per build (no duplication)', () => {
  const config = makeConfig();
  const result = args.buildYtdlpDownloadArgs(baseSub(), config, ['vid1', 'vid2']);
  const count = result.filter((el) => el === '--print').length;
  assert.equal(count, 1);
});

test('CHANNEL_META_PRINT_TEMPLATE / CHANNEL_META_SENTINEL are exported for reuse by lib/ytdlp/run.js\'s parser', () => {
  assert.equal(args.CHANNEL_META_SENTINEL, 'FTCHMETA');
  assert.ok(args.CHANNEL_META_PRINT_TEMPLATE.includes(args.CHANNEL_META_SENTINEL));
  assert.ok(args.CHANNEL_META_PRINT_TEMPLATE.startsWith('after_move:'));
});

// ---- v1.24.0 C5-ytdlp/C6 (T11): upload_date/release_date/channel_thumbnail -
//
// The print-template field-selector grew three keys for release-date (C5)
// and channel-avatar (C6) capture. These tests prove the addition stayed
// inside the SAME fixed-literal, JSON-escaped `.{...}j` selector -- no new
// `%(field)s`-style interpolation was introduced, and the ONLY `%(` in the
// whole literal is the single, fixed field-selector construct itself.

test('CHANNEL_META_PRINT_TEMPLATE: the field-selector includes upload_date, release_date, and channel_thumbnail', () => {
  assert.ok(args.CHANNEL_META_PRINT_TEMPLATE.includes('upload_date'));
  assert.ok(args.CHANNEL_META_PRINT_TEMPLATE.includes('release_date'));
  assert.ok(args.CHANNEL_META_PRINT_TEMPLATE.includes('channel_thumbnail'));
});

test('CHANNEL_META_PRINT_TEMPLATE: the new fields live INSIDE the single .{...}j selector, not as separate %(field)s interpolations', () => {
  // Exactly one `%(` in the whole literal -- the fixed `.{...}j` selector --
  // proves no field was added as its own standalone %(field)s placeholder
  // (which would reopen the pre-fix tab-delimited-newline-forgery class of
  // bug this template's SECURITY comment documents above).
  const percentOpenCount = (args.CHANNEL_META_PRINT_TEMPLATE.match(/%\(/g) || []).length;
  assert.equal(percentOpenCount, 1, 'expected exactly one %( -- everything selected must ride the single JSON-escaped .{...}j conversion');
  assert.ok(args.CHANNEL_META_PRINT_TEMPLATE.includes('.{id,channel_url,channel_id,uploader_url,channel,upload_date,release_date,channel_thumbnail})j'));
});

test('CHANNEL_META_PRINT_TEMPLATE: still a fixed literal -- byte-identical regardless of sub/config content (new fields did not reopen per-sub interpolation)', () => {
  const config = makeConfig();
  const hostileSub = baseSub({ name: '"; rm -rf /; #', channelUrl: 'https://www.youtube.com/@x' });
  const result = args.buildYtdlpDownloadArgs(hostileSub, config, ['vid1']);
  const idx = result.indexOf('--print');
  assert.equal(result[idx + 1], args.CHANNEL_META_PRINT_TEMPLATE);
});
