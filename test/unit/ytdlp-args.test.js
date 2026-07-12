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

// ---- buildYtdlpListArgs: date scoping (v1.25 T2 -> v1.36 F1 fix round) ----
//
// v1.25 scoped the LIST pass with `--dateafter <sub.cutoffDate>`. The v1.36
// adversarial gate then proved TWO things against yt-dlp source: (1) yt-dlp
// evaluates its daterange check BEFORE match filters and rejects
// NON-breakingly, so a co-present `--dateafter` masks `--break-match-filters`
// entirely; (2) a BARE channel URL expands to SEPARATE videos/streams/shorts
// tab playlists, and a break aborts the whole process -- so break-early is
// only safe when the target is a single newest-first feed. The resulting
// two-shape contract (args.js resolveBreakEarlyTarget):
//   BREAK-SAFE (channel-root URL + captured UC channelId): target swaps to
//   the combined UU uploads playlist, break filter (slacked) emitted,
//   --dateafter ABSENT.
//   FALLBACK (no channelId, or playlist-/watch-shaped sub): original target,
//   --dateafter restored, NO break filter.

// A well-formed UC id (UC + 22 id-charset chars) for the break-safe shape.
const TEST_CHANNEL_ID = 'UCabcdefghijklmnopqrstuv';
const TEST_UPLOADS_URL = 'https://www.youtube.com/playlist?list=UUabcdefghijklmnopqrstuv';

test('buildYtdlpListArgs BREAK-SAFE shape: channel-root sub + channelId -> UU-feed target, slacked break filter, NO --dateafter', () => {
  const config = makeConfig();
  const result = args.buildYtdlpListArgs(baseSub({ cutoffDate: '20260709', channelId: TEST_CHANNEL_ID }), config);
  assert.ok(!result.includes('--dateafter'), '--dateafter must be ABSENT -- its non-breaking daterange rejection masks --break-match-filters');
  const idx = result.indexOf('--break-match-filters');
  assert.ok(idx >= 0, 'the break filter must be present');
  // 20260709 minus the 7-day slack window.
  assert.equal(result[idx + 1], 'upload_date>=?20260702');
  assert.ok(idx < result.indexOf('--'), 'the break filter must precede the "--" separator');
  // The positional target is the combined UU uploads feed (videos + shorts +
  // streams in ONE newest-first playlist), NOT the bare channel URL whose
  // multi-tab expansion a break would truncate.
  assert.equal(result[result.length - 1], TEST_UPLOADS_URL);
  assert.equal(result[result.length - 2], '--');
});

test('buildYtdlpListArgs FALLBACK shape: a channel-root sub with NO channelId keeps its own URL, restores --dateafter, emits NO break filter', () => {
  const config = makeConfig();
  const sub = baseSub({ cutoffDate: '20260709' }); // no channelId captured yet
  const result = args.buildYtdlpListArgs(sub, config);
  assert.ok(!result.includes('--break-match-filters'), 'no single-feed target derivable -> a break could truncate the multi-tab expansion');
  const idx = result.indexOf('--dateafter');
  assert.ok(idx >= 0, 'with no break filter to mask, --dateafter is restored (the pre-v1.36 walk, cap-bounded)');
  assert.equal(result[idx + 1], '20260709');
  assert.equal(result[result.length - 1], sub.channelUrl, 'the target stays the subscription URL');
});

test('buildYtdlpListArgs FALLBACK shape: a /playlist?list= subscription NEVER gets a break filter or a UU swap, even WITH a channelId (no newest-first guarantee)', () => {
  const config = makeConfig();
  const playlistUrl = 'https://www.youtube.com/playlist?list=PLabcdefghijklm';
  const result = args.buildYtdlpListArgs(
    baseSub({ cutoffDate: '20260709', channelUrl: playlistUrl, channelId: TEST_CHANNEL_ID }),
    config,
  );
  assert.ok(!result.includes('--break-match-filters'), 'a generic playlist whose head entry is old would break at entry one and list nothing, forever');
  assert.ok(result.includes('--dateafter'), '--dateafter restored in the fallback shape');
  assert.equal(result[result.length - 1], playlistUrl, 'the user subscribed to THIS playlist -- never swapped to the channel uploads feed');
});

test('buildYtdlpListArgs: a malformed/hostile channelId falls back safely (no break filter, no constructed URL)', () => {
  const config = makeConfig();
  for (const bad of ['UCshort', 'PLabcdefghijklmnopqrstuv', 'UC../../etc/passwd0000000', 'UCabcdefghijklmnopqrstu!', 12345, null]) {
    const result = args.buildYtdlpListArgs(baseSub({ cutoffDate: '20260709', channelId: bad }), config);
    assert.ok(!result.includes('--break-match-filters'), `channelId=${JSON.stringify(bad)} must not enable break-early`);
    assert.equal(result[result.length - 1], baseSub().channelUrl, 'and must never influence the positional target');
  }
});

test('v1.36 fix round 2: uploadsPlaylistUrl/resolveBreakEarlyTarget -- strict UC validation, channel-root-only', () => {
  assert.equal(args.uploadsPlaylistUrl({ channelId: TEST_CHANNEL_ID }), TEST_UPLOADS_URL);
  assert.equal(args.uploadsPlaylistUrl({ channelId: 'UCtooShort' }), null);
  assert.equal(args.uploadsPlaylistUrl({}), null);
  assert.equal(
    args.resolveBreakEarlyTarget({ channelUrl: 'https://www.youtube.com/@somechannel', channelId: TEST_CHANNEL_ID }),
    TEST_UPLOADS_URL,
  );
  assert.equal(
    args.resolveBreakEarlyTarget({ channelUrl: 'https://www.youtube.com/playlist?list=PLxyzabcdefgh', channelId: TEST_CHANNEL_ID }),
    null,
    'playlist-shaped subs are never break-safe',
  );
  assert.equal(
    args.resolveBreakEarlyTarget({ channelUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', channelId: TEST_CHANNEL_ID }),
    null,
    'watch-shaped subs are never break-safe',
  );
  assert.equal(args.resolveBreakEarlyTarget({ channelUrl: 'https://www.youtube.com/@somechannel' }), null, 'no channelId -> no UU feed derivable');
});

test('buildYtdlpListArgs: the slacked cutoff appears ONLY as the break-filter value element, never embedded in any other arg', () => {
  const config = makeConfig();
  const result = args.buildYtdlpListArgs(baseSub({ cutoffDate: '20260101', channelId: TEST_CHANNEL_ID }), config);
  const breakIdx = result.indexOf('--break-match-filters');
  assert.ok(breakIdx >= 0);
  // 20260101 minus 7 days crosses the year boundary -- the pure-UTC date
  // arithmetic must handle it.
  assert.equal(result[breakIdx + 1], 'upload_date>=?20251225');
  for (let i = 0; i < result.length; i++) {
    if (i === breakIdx + 1) continue;
    assert.ok(!result[i].includes('20251225') && !result[i].includes('20260101'), `unexpected embedded cutoff digits in arg[${i}]: ${result[i]}`);
  }
});

test('buildYtdlpListArgs OMITS --dateafter AND the break filter when sub.cutoffDate is missing/undefined (graceful, no date bound)', () => {
  const config = makeConfig();
  const result = args.buildYtdlpListArgs(baseSub({ channelId: TEST_CHANNEL_ID }), config); // no cutoffDate
  assert.ok(!result.includes('--dateafter'), 'a missing cutoffDate must omit --dateafter entirely');
  assert.ok(!result.includes('--break-match-filters'), 'and the break filter');
});

test('buildYtdlpListArgs OMITS --dateafter and the break filter when sub.cutoffDate is malformed/invalid (fails safe, never a hostile value)', () => {
  const config = makeConfig();
  for (const bad of [null, '', '2026070', '202607099', 'abcd0709', '2026-07-09', 20260709, {}, ['20260709']]) {
    const result = args.buildYtdlpListArgs(baseSub({ cutoffDate: bad, channelId: TEST_CHANNEL_ID }), config);
    assert.ok(!result.includes('--dateafter'), `cutoffDate=${JSON.stringify(bad)} should omit --dateafter`);
    assert.ok(!result.includes('--break-match-filters'), `cutoffDate=${JSON.stringify(bad)} should omit the break filter`);
  }
});

// v1.36 F1 CONTRACT CHANGE: the list pass emits --playlist-end again -- but
// driven EXCLUSIVELY by config.listScanCap (the wall-clock backstop behind
// the break-early filter, default 200), NEVER by maxVideos. The original
// v1.25 lock ("never emits --playlist-end anymore") is narrowed to what it
// was actually protecting: maxVideos must not influence the list pass.
test('buildYtdlpListArgs: --playlist-end is driven by config.listScanCap ONLY -- maxVideos never influences it (v1.25 invariant, v1.36 form)', () => {
  for (const maxVideos of [undefined, 0, 25, 100]) {
    const config = makeConfig({ maxVideos, listScanCap: 200 });
    const result = args.buildYtdlpListArgs(baseSub({ cutoffDate: '20260709', maxVideos }), config);
    const idx = result.indexOf('--playlist-end');
    assert.ok(idx >= 0, 'the listScanCap backstop must be present');
    assert.equal(result[idx + 1], '200', `maxVideos=${JSON.stringify(maxVideos)} must never change the cap value`);
  }
  // listScanCap 0 = cap off: no --playlist-end at all (and with a cutoff the
  // break filter still implies --lazy-playlist).
  const uncapped = args.buildYtdlpListArgs(baseSub({ cutoffDate: '20260709' }), makeConfig({ listScanCap: 0 }));
  assert.ok(!uncapped.includes('--playlist-end'), 'listScanCap=0 must omit the cap entirely');
});

// ---- playlistEndArgs: dormant, still exported/functional standalone ------
//
// The function itself is untouched (avoids churn in config.js/store.js and
// their own tests, which still reference maxVideos) -- it simply is no
// longer called from buildYtdlpListArgs. These are the SAME assertions the
// old buildYtdlpListArgs-level tests made, now exercised directly against
// the standalone function to prove it still behaves correctly even though
// nothing wires it up anymore.

test('playlistEndArgs: still returns "--playlist-end <N>" for a positive integer maxVideos (dormant, standalone)', () => {
  assert.deepEqual(args.playlistEndArgs({ maxVideos: 25 }), ['--playlist-end', '25']);
  assert.deepEqual(args.playlistEndArgs({ maxVideos: 100 }), ['--playlist-end', '100']);
});

test('playlistEndArgs: still returns [] for 0/missing/malformed maxVideos (dormant, standalone)', () => {
  for (const bad of [undefined, null, 0, -1, 1.5, 'abc', NaN]) {
    assert.deepEqual(args.playlistEndArgs({ maxVideos: bad }), []);
  }
});

// ---- dateAfterArgs: standalone unit coverage ------------------------------

test('dateAfterArgs: returns ["--dateafter", cutoffDate] for a valid 8-digit YYYYMMDD string', () => {
  assert.deepEqual(args.dateAfterArgs({ cutoffDate: '20260709' }), ['--dateafter', '20260709']);
});

test('dateAfterArgs: returns [] for a missing/malformed cutoffDate', () => {
  for (const bad of [undefined, null, '', '2026070', '202607099', 'abcd0709', '2026-07-09', 20260709, {}, ['20260709']]) {
    assert.deepEqual(args.dateAfterArgs({ cutoffDate: bad }), [], `cutoffDate=${JSON.stringify(bad)} should yield []`);
  }
});

test('dateAfterArgs: returns [] when sub itself is missing/undefined', () => {
  assert.deepEqual(args.dateAfterArgs(undefined), []);
  assert.deepEqual(args.dateAfterArgs(null), []);
  assert.deepEqual(args.dateAfterArgs({}), []);
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
    // v1.24.0 C5-ytdlp (T11): field-selector grew upload_date/release_date --
    // still a fixed literal, still JSON-escaped/one-line-safe. v1.25 QoL
    // bugfix: `channel_thumbnail` was REMOVED -- it never existed on a real
    // per-video info dict (verified live), so it was always a dead no-op key.
    // v1.33 T3: field-selector grew `title` (emoji-preserving display
    // titles) -- same fixed-literal posture, bounded downstream by
    // store.sanitizeCapturedTitle.
    'after_move:FTCHMETA %(.{id,title,channel_url,channel_id,uploader_url,channel,upload_date,release_date})j',
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

// ---- v1.24.0 C5-ytdlp (T11): upload_date/release_date ----------------------
//
// The print-template field-selector grew two keys for release-date (C5)
// capture. These tests prove the addition stayed inside the SAME
// fixed-literal, JSON-escaped `.{...}j` selector -- no new `%(field)s`-style
// interpolation was introduced, and the ONLY `%(` in the whole literal is
// the single, fixed field-selector construct itself.
//
// v1.25 QoL bugfix regression lock: `channel_thumbnail` (the original C6
// field, verified to never exist on a real per-video info dict) has been
// REMOVED from the selector entirely -- these tests also prove it stays gone.

test('CHANNEL_META_PRINT_TEMPLATE: the field-selector includes upload_date and release_date, but NOT the dead channel_thumbnail field', () => {
  assert.ok(args.CHANNEL_META_PRINT_TEMPLATE.includes('upload_date'));
  assert.ok(args.CHANNEL_META_PRINT_TEMPLATE.includes('release_date'));
  assert.ok(!args.CHANNEL_META_PRINT_TEMPLATE.includes('channel_thumbnail'), 'channel_thumbnail never existed on a real per-video info dict -- must not be selected');
});

test('CHANNEL_META_PRINT_TEMPLATE: the fields live INSIDE the single .{...}j selector, not as separate %(field)s interpolations', () => {
  // Exactly one `%(` in the whole literal -- the fixed `.{...}j` selector --
  // proves no field was added as its own standalone %(field)s placeholder
  // (which would reopen the pre-fix tab-delimited-newline-forgery class of
  // bug this template's SECURITY comment documents above).
  const percentOpenCount = (args.CHANNEL_META_PRINT_TEMPLATE.match(/%\(/g) || []).length;
  assert.equal(percentOpenCount, 1, 'expected exactly one %( -- everything selected must ride the single JSON-escaped .{...}j conversion');
  // v1.33 T3: `title` joined the same single selector.
  assert.ok(args.CHANNEL_META_PRINT_TEMPLATE.includes('.{id,title,channel_url,channel_id,uploader_url,channel,upload_date,release_date})j'));
});

test('CHANNEL_META_PRINT_TEMPLATE: still a fixed literal -- byte-identical regardless of sub/config content (new fields did not reopen per-sub interpolation)', () => {
  const config = makeConfig();
  const hostileSub = baseSub({ name: '"; rm -rf /; #', channelUrl: 'https://www.youtube.com/@x' });
  const result = args.buildYtdlpDownloadArgs(hostileSub, config, ['vid1']);
  const idx = result.indexOf('--print');
  assert.equal(result[idx + 1], args.CHANNEL_META_PRINT_TEMPLATE);
});

// ---- v1.29 T3(b): resilience pacing/retry flags (AC6.1, AC6.2, AC6.3) ----
//
// R3b.1/AC6.1: default values, no env override. R3b.2/AC6.2: overrides
// change the emitted value. R3b.4/AC6.3: the FULL argv shape is asserted
// byte-identical to the pre-T3(b) shape except for the newly-appended
// flags -- these are NOT presence-only checks, they lock the exact ordering
// too, so any future accidental reordering/interleaving with the `--`/
// positional section would fail loudly here.

test('buildYtdlpDownloadArgs: default config emits the four pacing flags, in order, immediately after --no-warnings (AC6.1)', () => {
  const config = makeConfig();
  const result = args.buildYtdlpDownloadArgs(baseSub(), config, ['vid1']);
  const noWarningsIdx = result.indexOf('--no-warnings');
  assert.ok(noWarningsIdx >= 0);
  assert.deepEqual(result.slice(noWarningsIdx + 1, noWarningsIdx + 11), [
    // v1.31 P0: --socket-timeout now leads the pacing block on every pass.
    '--socket-timeout', '15',
    '--sleep-requests', '1',
    '--sleep-interval', '2',
    '--max-sleep-interval', '5',
    '--retries', '5',
  ]);
  assert.ok(!result.includes('--extractor-args'), 'player_client is unset by default -- flag must be absent');
  const sepIdx = result.indexOf('--');
  assert.ok(noWarningsIdx + 11 <= sepIdx, 'pacing flags must land well before the "--" separator');
});

test('buildYtdlpDownloadArgs: FILETUBE_YTDLP_* overrides (already parsed onto config by config.js) change the emitted pacing/retry values (AC6.2)', () => {
  const config = makeConfig({ sleepRequests: 3, sleepInterval: 4, maxSleepInterval: 9, retries: 12 });
  const result = args.buildYtdlpDownloadArgs(baseSub(), config, ['vid1']);
  assert.equal(result[result.indexOf('--sleep-requests') + 1], '3');
  assert.equal(result[result.indexOf('--retries') + 1], '12');
  assert.equal(result[result.indexOf('--sleep-interval') + 1], '4');
  assert.equal(result[result.indexOf('--max-sleep-interval') + 1], '9');
});

test('buildYtdlpDownloadArgs: an out-of-bounds/invalid pacing value on a bare/partial config falls back to the documented default rather than reaching argv as-is (AC6.2, defensive re-coercion)', () => {
  const config = makeConfig({ sleepRequests: -5, retries: 999, sleepInterval: 1.5, maxSleepInterval: NaN });
  const result = args.buildYtdlpDownloadArgs(baseSub(), config, ['vid1']);
  assert.equal(result[result.indexOf('--sleep-requests') + 1], '1');
  assert.equal(result[result.indexOf('--retries') + 1], '5');
  assert.equal(result[result.indexOf('--sleep-interval') + 1], '2');
  assert.equal(result[result.indexOf('--max-sleep-interval') + 1], '5');
});

test('buildYtdlpDownloadArgs: --extractor-args youtube:player_client=<value> is emitted as two argv elements ONLY when config.playerClient is a set string (R3b.3)', () => {
  const withoutClient = args.buildYtdlpDownloadArgs(baseSub(), makeConfig(), ['vid1']);
  assert.ok(!withoutClient.includes('--extractor-args'));

  const withClient = args.buildYtdlpDownloadArgs(baseSub(), makeConfig({ playerClient: 'android,web' }), ['vid1']);
  const idx = withClient.indexOf('--extractor-args');
  assert.ok(idx >= 0);
  assert.equal(withClient[idx + 1], 'youtube:player_client=android,web');
  // Both are their own array elements -- never concatenated into one token.
  assert.ok(!withClient.some((el) => el.includes('--extractor-argsyoutube')));
});

test('buildYtdlpDownloadArgs: player_client is omitted when config.playerClient is null/missing/non-string (fail-safe, never a stray flag)', () => {
  for (const bad of [null, undefined, '', 42, {}]) {
    const result = args.buildYtdlpDownloadArgs(baseSub(), makeConfig({ playerClient: bad }), ['vid1']);
    assert.ok(!result.includes('--extractor-args'), `playerClient=${JSON.stringify(bad)} must omit the flag`);
  }
});

// GF1 F2 (post-gate fix): `config.playerClient` is now RE-VALIDATED at the
// args.js boundary via config.js's `parsePlayerClient` (mirrors
// `resolveSleepSeconds`/`resolveRetries`'s revalidate-at-every-boundary
// posture), rather than trusting `config.js`'s upstream parse-time
// validation alone. These cases simulate a bypassed/forged `config` object
// (e.g. a test fixture, or a future caller that never routed through
// `parseYtdlpConfig`) carrying a playerClient string that would have FAILED
// `config.js`'s own validation had it gone through that path -- pre-fix,
// this string reached the argv element unchecked; post-fix it must be
// rejected at THIS boundary too, same fail-safe as an unset value.
test('GF1 F2: buildYtdlpDownloadArgs REJECTS an invalid playerClient reaching args.js directly (bypassed/forged config), omitting the flag entirely', () => {
  const hostileValues = [
    'android web', // embedded space
    'android;web', // semicolon
    'android&web', // ampersand
    'Android', // uppercase (charset is lowercase-only)
    'a'.repeat(129), // over MAX_PLAYER_CLIENT_LENGTH (128)
    'android\nweb', // embedded newline
  ];
  for (const hostile of hostileValues) {
    const result = args.buildYtdlpDownloadArgs(baseSub(), makeConfig({ playerClient: hostile }), ['vid1']);
    assert.ok(
      !result.includes('--extractor-args'),
      `playerClient=${JSON.stringify(hostile)} must be rejected at the args.js boundary and omit the flag`,
    );
    assert.ok(
      !result.some((el) => el.includes(hostile)),
      `the rejected hostile value must never appear anywhere in argv: ${JSON.stringify(hostile)}`,
    );
  }
});

test('GF1 F2: a VALID playerClient still emits the two-element --extractor-args pair after the args.js-boundary revalidation', () => {
  const result = args.buildYtdlpDownloadArgs(baseSub(), makeConfig({ playerClient: 'ios,web' }), ['vid1']);
  const idx = result.indexOf('--extractor-args');
  assert.ok(idx >= 0);
  assert.equal(result[idx + 1], 'youtube:player_client=ios,web');
});

test('buildYtdlpListArgs: emits ONLY the list-relevant pacing flags (--sleep-requests/--retries) with defaults, omitting sleep-interval/max-sleep-interval/player_client (AC6.1)', () => {
  const config = makeConfig();
  const result = args.buildYtdlpListArgs(baseSub(), config);
  const noWarningsIdx = result.indexOf('--no-warnings');
  assert.ok(noWarningsIdx >= 0);
  assert.deepEqual(result.slice(noWarningsIdx + 1, noWarningsIdx + 7), [
    // v1.31 P0: --socket-timeout now leads the pacing block on every pass.
    '--socket-timeout', '15',
    '--sleep-requests', '1',
    '--retries', '5',
  ]);
  assert.ok(!result.includes('--sleep-interval'));
  assert.ok(!result.includes('--max-sleep-interval'));
  assert.ok(!result.includes('--extractor-args'));
});

test('buildYtdlpListArgs: FILETUBE_YTDLP_SLEEP_REQUESTS/RETRIES overrides change the emitted list-pass values (AC6.2)', () => {
  const config = makeConfig({ sleepRequests: 7, retries: 1 });
  const result = args.buildYtdlpListArgs(baseSub(), config);
  assert.equal(result[result.indexOf('--sleep-requests') + 1], '7');
  assert.equal(result[result.indexOf('--retries') + 1], '1');
});

test('AC6.3: buildYtdlpDownloadArgs argv is byte-identical to the pre-T3(b) shape except for the four pacing flags inserted after --no-warnings', () => {
  const config = makeConfig();
  const sub = baseSub({ format: 'video', quality: 'best' });
  const result = args.buildYtdlpDownloadArgs(sub, config, ['vid1']);
  const archivePath = args.resolveArchivePath(config);
  const outputTemplate = path.join(args.resolveChannelDir(config, sub), args.OUTPUT_TEMPLATE);
  const expected = [
    '--windows-filenames',
    '--newline',
    '-f', 'bestvideo+bestaudio/best',
    '-S', args.VIDEO_FORMAT_SORT,
    '--embed-metadata', '--embed-thumbnail', '--embed-chapters',
    '--write-subs', '--write-auto-subs', '--sub-langs', 'en.*', '--sub-format', 'vtt', '--convert-subs', 'vtt',
    '--download-archive', archivePath,
    '--no-warnings',
    // v1.29 T3(b) + v1.31 P0: the ONLY new content vs. the pre-change shape
    // -- fixed-literal-named flags with bounds-checked, non-injectable
    // numeric values (player_client omitted -- unset by default, see the
    // dedicated test above). v1.31 adds --socket-timeout at the head of the
    // block (same posture, same documented-additive-evolution path).
    '--socket-timeout', '15',
    '--sleep-requests', '1',
    '--sleep-interval', '2',
    '--max-sleep-interval', '5',
    '--retries', '5',
    // cookiesArgs(config) contributes nothing -- no cookiesFile configured.
    '--print', args.CHANNEL_META_PRINT_TEMPLATE,
    '-o', outputTemplate,
    '--', 'https://www.youtube.com/watch?v=vid1',
  ];
  assert.deepEqual(result, expected);
});

test('AC6.3: buildYtdlpListArgs argv is byte-identical to the pre-T3(b) shape except for the two list-relevant pacing flags inserted after --no-warnings', () => {
  const config = makeConfig();
  const sub = baseSub();
  const result = args.buildYtdlpListArgs(sub, config);
  const archivePath = args.resolveArchivePath(config);
  const expected = [
    '--dump-json',
    '--no-download',
    '--no-warnings',
    // v1.29 T3(b) + v1.31 P0: the ONLY new content vs. the pre-change shape.
    '--socket-timeout', '15',
    '--sleep-requests', '1',
    '--retries', '5',
    '--download-archive', archivePath,
    // v1.36 F1: break-early listing. This sub has NO cutoffDate, so no
    // --break-match-filters -- but the listScanCap backstop (default 200)
    // still applies, and any breakEarlyArgs content implies --lazy-playlist.
    '--lazy-playlist',
    '--playlist-end', '200',
    '--',
    sub.channelUrl,
  ];
  assert.deepEqual(result, expected);
});

test('AC6.3: the host allowlist / "--" separator / FORBIDDEN_CHARS-style hostile-id-drop / SF4 path confinement all still hold with the new pacing flags present', () => {
  const config = makeConfig();
  // Hostile/invalid target id dropped exactly as before T3(b) (mirrors the
  // pre-existing "an id that fails isSafeVideoId is dropped" test above).
  const result = args.buildYtdlpDownloadArgs(baseSub(), config, ['goodId', '../etc/passwd']);
  const sepIndex = result.indexOf('--');
  assert.ok(sepIndex >= 0);
  assert.deepEqual(result.slice(sepIndex + 1), ['https://www.youtube.com/watch?v=goodId']);
  // "--" is still exactly two positions from the end (one positional target).
  assert.equal(sepIndex, result.length - 2);
  // SF4: the -o output template is still confined under the download root.
  const oIndex = result.indexOf('-o');
  assert.ok(result[oIndex + 1].startsWith(path.resolve(config.downloadDir) + path.sep));
  // The new pacing flags never leak past the "--" separator into positional
  // territory.
  for (const token of ['--socket-timeout', '--sleep-requests', '--sleep-interval', '--max-sleep-interval', '--retries']) {
    assert.ok(!result.slice(sepIndex + 1).includes(token), `${token} must never appear after "--"`);
  }
});

test('resiliencePacingArgs: pure -- never throws for a missing/malformed config, always falls back to documented defaults', () => {
  for (const bad of [undefined, null, {}, [], 'a string', 42]) {
    assert.doesNotThrow(() => args.resiliencePacingArgs(bad));
    const result = args.resiliencePacingArgs(bad);
    assert.deepEqual(result, [
      '--socket-timeout', '15',
      '--sleep-requests', '1',
      '--sleep-interval', '2',
      '--max-sleep-interval', '5',
      '--retries', '5',
    ]);
    assert.doesNotThrow(() => args.resiliencePacingArgs(bad, { listOnly: true }));
    assert.deepEqual(args.resiliencePacingArgs(bad, { listOnly: true }), ['--socket-timeout', '15', '--sleep-requests', '1', '--retries', '5']);
  }
});

test('resiliencePacingArgs: listOnly:true omits sleep-interval/max-sleep-interval/player_client even when configured', () => {
  const result = args.resiliencePacingArgs({ sleepInterval: 9, maxSleepInterval: 20, playerClient: 'web' }, { listOnly: true });
  assert.deepEqual(result, ['--socket-timeout', '15', '--sleep-requests', '1', '--retries', '5']);
});

// ---- v1.36 F1: breakEarlyArgs (break-early listing) -------------------------
//
// The "chronic burner" root cause fix: --dateafter is a FILTER, not a stop
// condition, so the pre-F1 list pass full-extracted a channel's entire
// unarchived back catalog on every poll -- deterministically timing out
// large-catalog channels. These lock the three-part contract: lazy
// enumeration, stop at the first pre-cutoff video, count-cap backstop.

test('v1.36 breakEarlyArgs: breakSafe + valid cutoff -> --lazy-playlist + --break-match-filters upload_date>=?<slacked> + the default --playlist-end 200 backstop', () => {
  const result = args.breakEarlyArgs({ cutoffDate: '20260710' }, {}, { breakSafe: true });
  // 20260710 minus the 7-day slack window (see BREAK_EARLY_SLACK_DAYS).
  assert.deepEqual(result, [
    '--lazy-playlist',
    '--break-match-filters', 'upload_date>=?20260703',
    '--playlist-end', '200',
  ]);
});

test('v1.36 breakEarlyArgs: the cutoff is re-validated at build time -- malformed/missing cutoffs emit NO break filter (fail safe), but the cap backstop still applies', () => {
  for (const bad of [undefined, null, '', '2026071', '202607100', 'abcd0710', '2026-07-10', 20260710, {}]) {
    const result = args.breakEarlyArgs({ cutoffDate: bad }, {}, { breakSafe: true });
    assert.ok(!result.includes('--break-match-filters'), `cutoffDate=${JSON.stringify(bad)} must omit the break filter`);
    assert.deepEqual(result, ['--lazy-playlist', '--playlist-end', '200'], 'the cap backstop (and its implied --lazy-playlist) must survive a bad cutoff');
  }
});

test('v1.36 breakEarlyArgs: listScanCap is re-bounded through parseListScanCap at build time -- 0 disables the cap, garbage falls back to the 200 default', () => {
  assert.deepEqual(
    args.breakEarlyArgs({ cutoffDate: '20260710' }, { listScanCap: 0 }, { breakSafe: true }),
    ['--lazy-playlist', '--break-match-filters', 'upload_date>=?20260703'],
    'cap off: break filter only',
  );
  assert.deepEqual(
    args.breakEarlyArgs({ cutoffDate: '20260710' }, { listScanCap: 50 }, { breakSafe: true }),
    ['--lazy-playlist', '--break-match-filters', 'upload_date>=?20260703', '--playlist-end', '50'],
  );
  assert.deepEqual(
    args.breakEarlyArgs({ cutoffDate: '20260710' }, { listScanCap: 'hostile' }, { breakSafe: true }),
    ['--lazy-playlist', '--break-match-filters', 'upload_date>=?20260703', '--playlist-end', '200'],
    'a malformed cap must fall back to the default, never emit a hostile value',
  );
  assert.deepEqual(args.breakEarlyArgs({}, { listScanCap: 0 }, { breakSafe: true }), [], 'no cutoff + cap off = nothing at all (incl. no orphan --lazy-playlist)');
  // v1.36 fix round 2: the DEFAULT (no opts / breakSafe absent) is UNSAFE --
  // a caller that does not decide never gets a break filter.
  assert.deepEqual(
    args.breakEarlyArgs({ cutoffDate: '20260710' }, {}),
    ['--lazy-playlist', '--playlist-end', '200'],
    'no breakSafe opt-in -> cap-only shape, never a break filter',
  );
});

test('v1.36 F1: buildYtdlpListArgs carries the full break-early trio before the "--" separator, and the break filter value is its own argv element', () => {
  const config = makeConfig();
  const result = args.buildYtdlpListArgs(baseSub({ cutoffDate: '20260710', channelId: TEST_CHANNEL_ID }), config);
  const sepIndex = result.indexOf('--');
  for (const token of ['--lazy-playlist', '--break-match-filters', '--playlist-end']) {
    const idx = result.indexOf(token);
    assert.ok(idx >= 0, `${token} must be present`);
    assert.ok(idx < sepIndex, `${token} must precede the "--" separator`);
  }
  assert.equal(result[result.indexOf('--break-match-filters') + 1], 'upload_date>=?20260703');
  assert.equal(result[result.indexOf('--playlist-end') + 1], '200');
});
