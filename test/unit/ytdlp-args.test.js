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

test('buildYtdlpDownloadArgs: an invalid format throws rather than silently producing bad args', () => {
  const config = makeConfig();
  assert.throws(() => args.buildYtdlpDownloadArgs(baseSub({ format: 'gif' }), config, ['vid1']));
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

// ---- SF4: --restrict-filenames + isPathUnder / realpathUnderChannelDir ---

test('buildYtdlpDownloadArgs: includes --restrict-filenames (defense-in-depth against a hostile video title)', () => {
  const config = makeConfig();
  const result = args.buildYtdlpDownloadArgs(baseSub(), config, ['vid1']);
  assert.ok(result.includes('--restrict-filenames'));
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
