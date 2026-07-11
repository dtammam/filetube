'use strict';

// [UNIT] lib/ytdlp/run.js -- `redactArgs` (AC 31 log-hygiene half). Pure,
// synchronous, no spawn involved. The spawn-boundary tests (AC 28, and the
// "never logged" half of AC 31) live in
// test/integration/ytdlp-spawn-security.test.js, where `execFile` is spied.

const { test } = require('node:test');
const assert = require('node:assert');
const {
  redactArgs,
  redactString,
  resolveDownloadTimeoutMs,
  DEFAULT_DOWNLOAD_TIMEOUT_MS,
  parseChannelMetaLine,
  MAX_CAPTURED_META,
  pickStderrReason,
} = require('../../lib/ytdlp/run');

test('redactArgs replaces the value after --cookies with a redaction marker', () => {
  const args = ['--dump-json', '--cookies', '/secret/path/to/cookies.txt', '--', 'https://www.youtube.com/@x'];
  const redacted = redactArgs(args);
  assert.ok(!redacted.includes('/secret/path/to/cookies.txt'), 'the real cookies path must never survive redaction');
  const idx = redacted.indexOf('--cookies');
  assert.ok(idx >= 0);
  assert.equal(redacted[idx + 1], '<redacted>');
});

test('redactArgs leaves an args array with no --cookies flag unchanged', () => {
  const args = ['--dump-json', '--download-archive', '/data/.ytdlp-archive.txt', '--', 'https://www.youtube.com/@x'];
  assert.deepEqual(redactArgs(args), args);
});

test('redactArgs never mutates the original array', () => {
  const args = ['--cookies', '/secret/cookies.txt'];
  const original = [...args];
  redactArgs(args);
  assert.deepEqual(args, original);
});

test('redactArgs handles a --cookies flag with no following value (malformed/truncated array) without throwing', () => {
  const args = ['--dump-json', '--cookies'];
  assert.doesNotThrow(() => redactArgs(args));
  const redacted = redactArgs(args);
  assert.deepEqual(redacted, args);
});

test('redactArgs is a no-op passthrough on non-array input', () => {
  assert.equal(redactArgs(null), null);
  assert.equal(redactArgs(undefined), undefined);
});

test('redactArgs redacts multiple --cookies occurrences if present', () => {
  const args = ['--cookies', '/a/cookies.txt', '--cookies', '/b/cookies.txt'];
  const redacted = redactArgs(args);
  assert.ok(!redacted.includes('/a/cookies.txt'));
  assert.ok(!redacted.includes('/b/cookies.txt'));
});

// ---- redactString (SF1): strips a cookies path out of an ARBITRARY string,
// e.g. Node's own execFile error.message, which is what actually leaked the
// cookies path in the pre-SF-round code (redactArgs alone never protected
// the raw error.message, only a freshly-built args array). -----------------

test('redactString removes every occurrence of the cookies path from a realistic Node execFile error.message', () => {
  const cookiesPath = '/secret/cookies.txt';
  const message = `Command failed: yt-dlp --dump-json --cookies ${cookiesPath} -- https://www.youtube.com/@x\nsome stderr mentioning ${cookiesPath} again`;
  const redacted = redactString(message, cookiesPath);
  assert.ok(!redacted.includes(cookiesPath), `cookies path survived redaction: ${redacted}`);
  assert.ok(redacted.includes('<redacted>'));
});

test('redactString also redacts a "--cookies=<path>" equals-form rendering of the same path', () => {
  const cookiesPath = '/secret/cookies.txt';
  const message = `Command failed: yt-dlp --cookies=${cookiesPath} -- https://www.youtube.com/@x`;
  const redacted = redactString(message, cookiesPath);
  assert.ok(!redacted.includes(cookiesPath));
});

test('redactString returns the string unchanged when cookiesPath is null/empty/undefined', () => {
  const message = 'Command failed: yt-dlp --dump-json -- https://www.youtube.com/@x';
  assert.equal(redactString(message, null), message);
  assert.equal(redactString(message, ''), message);
  assert.equal(redactString(message, undefined), message);
});

test('redactString is a safe passthrough on non-string input', () => {
  assert.equal(redactString(null, '/a/cookies.txt'), null);
  assert.equal(redactString(undefined, '/a/cookies.txt'), undefined);
  assert.equal(redactString('', '/a/cookies.txt'), '');
});

test('redactString never throws regardless of input shape', () => {
  assert.doesNotThrow(() => redactString(42, '/a/cookies.txt'));
  assert.doesNotThrow(() => redactString('text', 42));
});

// ---- resolveDownloadTimeoutMs (v1.15.1 hotfix): threads
// config.downloadTimeoutMinutes into the download spawn timeout ----

test('resolveDownloadTimeoutMs converts a valid config.downloadTimeoutMinutes to milliseconds', () => {
  assert.equal(resolveDownloadTimeoutMs({ downloadTimeoutMinutes: 180 }), 180 * 60 * 1000);
  assert.equal(resolveDownloadTimeoutMs({ downloadTimeoutMinutes: 1 }), 60 * 1000);
  assert.equal(resolveDownloadTimeoutMs({ downloadTimeoutMinutes: 1440 }), 1440 * 60 * 1000);
});

test('resolveDownloadTimeoutMs falls back to DEFAULT_DOWNLOAD_TIMEOUT_MS when config lacks a valid downloadTimeoutMinutes', () => {
  for (const config of [
    {},
    { downloadTimeoutMinutes: 0 },
    { downloadTimeoutMinutes: -5 },
    { downloadTimeoutMinutes: 1.5 },
    { downloadTimeoutMinutes: 'garbage' },
    { downloadTimeoutMinutes: null },
    { downloadTimeoutMinutes: undefined },
    null,
    undefined,
  ]) {
    assert.equal(resolveDownloadTimeoutMs(config), DEFAULT_DOWNLOAD_TIMEOUT_MS, `${JSON.stringify(config)} should fall back to the default`);
  }
});

test('DEFAULT_DOWNLOAD_TIMEOUT_MS is 180 minutes (raised from the previous 60-minute ceiling)', () => {
  assert.equal(DEFAULT_DOWNLOAD_TIMEOUT_MS, 180 * 60 * 1000);
});

// ---- v1.20.0 FR-2: parseChannelMetaLine -- pure FTCHMETA line parser ------
//
// Recognizes ONLY the sentinel-prefixed line lib/ytdlp/args.js's
// CHANNEL_META_PRINT_TEMPLATE produces; everything else (progress lines,
// warnings, blank output) must fall through untouched (returns null) so
// spawnYtdlpDownload's existing parseProgressLine path is unaffected.
//
// (two-reviewer-gate fix, post-release): the payload is now a single JSON
// object (see CHANNEL_META_PRINT_TEMPLATE's `.{...}j` selector) instead of a
// tab-delimited string -- these tests exercise the NEW format, including the
// injection-proofing an embedded newline in a free-text field now gets from
// JSON-escaping.

test('parseChannelMetaLine: parses a well-formed FTCHMETA JSON line into its 7 fields', () => {
  const line = `FTCHMETA ${JSON.stringify({
    id: 'dQw4w9WgXcQ',
    channel_url: 'https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw',
    channel_id: 'UCuAXFkgsw1L7xaCfnd5JJOw',
    uploader_url: 'https://www.youtube.com/@RickAstley',
    channel: 'Rick Astley',
    upload_date: '20091025',
    release_date: '20091026',
  })}`;
  const result = parseChannelMetaLine(line);
  assert.deepEqual(result, {
    videoId: 'dQw4w9WgXcQ',
    channelUrl: 'https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw',
    channelId: 'UCuAXFkgsw1L7xaCfnd5JJOw',
    uploaderUrl: 'https://www.youtube.com/@RickAstley',
    channelName: 'Rick Astley',
    uploadDate: '20091025',
    releaseDate: '20091026',
  });
});

// v1.25 QoL bugfix regression lock: a real per-video info dict never carries
// a `channel_thumbnail` field (verified live against yt-dlp 2026.07.04) --
// even when a video's FTCHMETA payload includes one anyway (e.g. a stale
// caller, or a future extractor quirk), the parser must never surface it.
test('parseChannelMetaLine: a channel_thumbnail key present on the payload is ignored -- never surfaced as channelThumbnail (the dead field is fully removed)', () => {
  const line = `FTCHMETA ${JSON.stringify({
    id: 'dQw4w9WgXcQ',
    channel_url: 'https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw',
    channel_id: 'UCuAXFkgsw1L7xaCfnd5JJOw',
    uploader_url: 'https://www.youtube.com/@RickAstley',
    channel: 'Rick Astley',
    channel_thumbnail: 'https://yt3.ggpht.com/avatar.jpg',
  })}`;
  const result = parseChannelMetaLine(line);
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'channelThumbnail'), false, 'channelThumbnail must not exist on the returned object at all');
});

test('parseChannelMetaLine: yt-dlp\'s JSON `null` (unavailable field), an empty string, and `NA` all normalize to null (absent), never literal data', () => {
  const line = `FTCHMETA ${JSON.stringify({
    id: 'vid123',
    channel_url: null,
    channel_id: '',
    uploader_url: null,
    channel: '',
    upload_date: 'NA',
    release_date: null,
  })}`;
  const result = parseChannelMetaLine(line);
  assert.deepEqual(result, {
    videoId: 'vid123',
    channelUrl: null,
    channelId: null,
    uploaderUrl: null,
    channelName: null,
    uploadDate: null,
    releaseDate: null,
  });
});

test('parseChannelMetaLine: an FTCHMETA line with upload_date/release_date absent entirely (older/undefined extractor fields) still returns null for those two', () => {
  const line = `FTCHMETA ${JSON.stringify({
    id: 'vid456',
    channel_url: 'https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw',
    channel_id: 'UCuAXFkgsw1L7xaCfnd5JJOw',
    uploader_url: 'https://www.youtube.com/@x',
    channel: 'X',
  })}`;
  const result = parseChannelMetaLine(line);
  assert.equal(result.uploadDate, null);
  assert.equal(result.releaseDate, null);
});

test('parseChannelMetaLine: a channel name containing literal tab/newline characters still round-trips intact (JSON-escaped, never truncated/misaligned)', () => {
  const line = `FTCHMETA ${JSON.stringify({
    id: 'vid123',
    channel_url: 'https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw',
    channel_id: 'UCuAXFkgsw1L7xaCfnd5JJOw',
    uploader_url: 'https://www.youtube.com/@x',
    channel: 'Channel\tWith\nTabs and\nNewlines',
  })}`;
  const result = parseChannelMetaLine(line);
  assert.equal(result.channelName, 'Channel\tWith\nTabs and\nNewlines');
});

test('parseChannelMetaLine: SECURITY -- a channel name containing a forged "\\nFTCHMETA <json>" sequence cannot produce a second/rogue capture line', () => {
  // The forged text is JSON-escaped (as real yt-dlp output always is for this
  // template) -- the "\n" here is the literal two-character escape sequence
  // INSIDE the JSON string, never a raw newline byte, so the whole print
  // output is structurally a single line. `parseChannelMetaLine` only ever
  // sees ONE call for this one line (the line-splitter boundary is proven
  // separately in the integration spawn tests); this test proves that even
  // when handed the full string, the parser extracts it as ONE benign field
  // value, never as a nested/rogue capture.
  const forgedName = 'Innocent\nFTCHMETA ' + JSON.stringify({
    id: 'attacker-controlled-id',
    channel_url: 'https://www.youtube.com/@attacker',
    channel_id: null,
    uploader_url: null,
    channel: 'Attacker Channel',
  });
  const line = `FTCHMETA ${JSON.stringify({
    id: 'realVideoId',
    channel_url: 'https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw',
    channel_id: 'UCuAXFkgsw1L7xaCfnd5JJOw',
    uploader_url: 'https://www.youtube.com/@real',
    channel: forgedName,
  })}`;
  // Exactly one embedded raw newline character would have appeared in a
  // tab-delimited rendering of this payload; in the JSON-encoded line it is
  // escaped, so the line itself contains no raw "\n" byte at all.
  assert.ok(!line.includes('\n'), 'the whole JSON-encoded print line must contain no raw newline byte');
  const result = parseChannelMetaLine(line);
  assert.equal(result.videoId, 'realVideoId', 'the real video id from THIS line must be the one returned');
  assert.equal(result.channelUrl, 'https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw');
  assert.equal(result.channelName, forgedName, 'the forged text is captured as an inert display-name STRING, never as a second parseable record');
});

test('parseChannelMetaLine: a non-FTCHMETA line (a normal progress/warning line) returns null', () => {
  assert.equal(parseChannelMetaLine('[download]  47.2% of  120.5MiB at 3.20MiB/s ETA 00:25'), null);
  assert.equal(parseChannelMetaLine('[youtube] Extracting URL: https://www.youtube.com/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(parseChannelMetaLine(''), null);
});

test('parseChannelMetaLine: a line merely CONTAINING the sentinel (not starting with it) is not mistaken for a match', () => {
  assert.equal(parseChannelMetaLine('some prefix FTCHMETA {"id":"vid"}'), null);
});

test('parseChannelMetaLine: malformed JSON returns null rather than throwing or guessing', () => {
  assert.equal(parseChannelMetaLine('FTCHMETA {not valid json'), null);
  assert.equal(parseChannelMetaLine('FTCHMETA '), null);
  assert.equal(parseChannelMetaLine('FTCHMETA'), null);
  // Valid JSON, but not an object (e.g. an array or a bare scalar) -- also
  // rejected rather than guessing at field access on a non-object shape.
  assert.equal(parseChannelMetaLine('FTCHMETA [1,2,3]'), null);
  assert.equal(parseChannelMetaLine('FTCHMETA "just a string"'), null);
  assert.equal(parseChannelMetaLine('FTCHMETA null'), null);
});

test('parseChannelMetaLine: non-string input never throws, returns null', () => {
  assert.equal(parseChannelMetaLine(null), null);
  assert.equal(parseChannelMetaLine(undefined), null);
  assert.equal(parseChannelMetaLine(42), null);
  assert.equal(parseChannelMetaLine({}), null);
});

test('MAX_CAPTURED_META is a sane positive bound', () => {
  assert.ok(Number.isInteger(MAX_CAPTURED_META) && MAX_CAPTURED_META > 0);
});

// ---- v1.29.0 T1 (R0.1/R0.2/R0.8): pickStderrReason -- selects the real
// failure reason out of an already-bounded/redacted stderr tail instead of
// the generic "yt-dlp exited with code <n>" string. Pure, synchronous, no
// spawn involved -- the composed-`error`-field behavior at the actual close
// handler is exercised end-to-end in
// test/integration/ytdlp-spawn-security.test.js. -----------------------

test('pickStderrReason: an ERROR: line wins over a later non-error line', () => {
  const tail = [
    'ERROR: [youtube] dQw4w9WgXcQ: Video unavailable',
    '[download] Destination: some/file.mp4',
  ].join('\n');
  assert.equal(pickStderrReason(tail), 'ERROR: [youtube] dQw4w9WgXcQ: Video unavailable');
});

test('pickStderrReason: the LAST ERROR: line wins when there are several (e.g. a retry sequence)', () => {
  const tail = [
    'ERROR: [youtube] first: Video unavailable',
    '[download] retrying...',
    'ERROR: [youtube] second: Sign in to confirm your age',
  ].join('\n');
  assert.equal(pickStderrReason(tail), 'ERROR: [youtube] second: Sign in to confirm your age');
});

test('pickStderrReason: ERROR: matching is case-insensitive', () => {
  const tail = 'error: [youtube] x: lowercase error prefix';
  assert.equal(pickStderrReason(tail), 'error: [youtube] x: lowercase error prefix');
});

test('pickStderrReason: falls back to the last non-empty line when no ERROR: line is present', () => {
  const tail = [
    '',
    '[download] Destination: some/file.mp4',
    '[download]  12.3% of  50.0MiB at 1.20MiB/s ETA 00:40',
    '',
  ].join('\n');
  assert.equal(pickStderrReason(tail), '[download]  12.3% of  50.0MiB at 1.20MiB/s ETA 00:40');
});

test('pickStderrReason: an empty or whitespace-only tail returns an empty string', () => {
  assert.equal(pickStderrReason(''), '');
  assert.equal(pickStderrReason('   \n  \n '), '');
});

test('pickStderrReason: non-string input returns an empty string, never throws', () => {
  assert.doesNotThrow(() => pickStderrReason(null));
  assert.equal(pickStderrReason(null), '');
  assert.equal(pickStderrReason(undefined), '');
  assert.equal(pickStderrReason(42), '');
});

test('pickStderrReason: a pathological long / control-char-laden ERROR line yields a bounded, control-char-free result', () => {
  const longSuffix = 'x'.repeat(5000);
  const controlLaden = `ERROR: [youtube] id: bad\x00\x01\x1b[31mreason\x7f${longSuffix}`;
  const picked = pickStderrReason(controlLaden);
  // No control chars (C0 range or DEL) survive.
  // eslint-disable-next-line no-control-regex
  assert.ok(!/[\x00-\x1f\x7f]/.test(picked), 'control characters must be stripped');
  // Bounded by the caller's own STDERR_TAIL_LIMIT upstream (this function
  // never grows the input) -- the picked line here is a substring of the
  // 5000+-char input, confirming pickStderrReason introduces no NEW
  // unbounded growth of its own.
  assert.ok(picked.length <= controlLaden.length);
  assert.ok(picked.startsWith('ERROR: [youtube] id: bad'));
});

test('pickStderrReason: trims surrounding whitespace off the selected line', () => {
  assert.equal(pickStderrReason('   ERROR: [youtube] x: padded   \n'), 'ERROR: [youtube] x: padded');
});
