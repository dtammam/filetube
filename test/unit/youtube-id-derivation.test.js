'use strict';

// [UNIT] v1.33 T1/T3 -- the release-date/Share trust chain's pure derivation
// helpers (server.js) plus the captured-title sanitizer (lib/ytdlp/store.js):
//
//   - parseEmbeddedSourceUrl: pull the ORIGINAL source URL out of ffprobe
//     format tags (`purl` first, `comment` fallback) -- the only id source a
//     bracket-less metube-era import has.
//   - youtubeIdFromUrlString: untrusted URL-ish string -> safe 11-char id,
//     through the SAME classifySingleVideo gate the yt-dlp module uses.
//   - deriveScanYoutubeId: scan-time composition (bracket-if-rooted, else
//     embedded URL).
//   - sanitizeCapturedTitle: emoji SURVIVE, control chars don't, length is
//     capped.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const { parseEmbeddedSourceUrl, youtubeIdFromUrlString, deriveScanYoutubeId } = require('../../server');
const { sanitizeCapturedTitle, MAX_CAPTURED_TITLE_LENGTH } = require('../../lib/ytdlp/store');

// ---- parseEmbeddedSourceUrl -------------------------------------------------

function probeJson(tags) {
  return { format: { tags } };
}

test('parseEmbeddedSourceUrl: reads the purl tag first', () => {
  assert.equal(
    parseEmbeddedSourceUrl(probeJson({ purl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', comment: 'something else' })),
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
  );
});

test('parseEmbeddedSourceUrl: falls back to a URL-shaped comment tag when purl is absent', () => {
  assert.equal(
    parseEmbeddedSourceUrl(probeJson({ comment: 'https://youtu.be/dQw4w9WgXcQ' })),
    'https://youtu.be/dQw4w9WgXcQ'
  );
});

test('parseEmbeddedSourceUrl: a free-text (non-URL) comment yields null -- never literal data', () => {
  assert.equal(parseEmbeddedSourceUrl(probeJson({ comment: 'great video, watched twice' })), null);
});

test('parseEmbeddedSourceUrl: tag-name matching is case-insensitive (ffprobe/muxers vary)', () => {
  assert.equal(
    parseEmbeddedSourceUrl(probeJson({ PURL: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })),
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
  );
});

test('parseEmbeddedSourceUrl: accepts the raw stdout string form, degrades to null on malformed input', () => {
  assert.equal(
    parseEmbeddedSourceUrl(JSON.stringify(probeJson({ purl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }))),
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
  );
  assert.equal(parseEmbeddedSourceUrl('{not json'), null);
  assert.equal(parseEmbeddedSourceUrl(null), null);
  assert.equal(parseEmbeddedSourceUrl(probeJson(undefined)), null);
  assert.equal(parseEmbeddedSourceUrl({}), null);
});

// ---- youtubeIdFromUrlString -------------------------------------------------

test('youtubeIdFromUrlString: a canonical watch URL yields its id', () => {
  assert.equal(youtubeIdFromUrlString('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
});

test('youtubeIdFromUrlString: youtu.be and shorts shapes classify too (same classifySingleVideo gate as one-shot downloads)', () => {
  assert.equal(youtubeIdFromUrlString('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(youtubeIdFromUrlString('https://www.youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
});

test('youtubeIdFromUrlString: channel URLs, non-YouTube hosts, and garbage all yield null (fail closed)', () => {
  assert.equal(youtubeIdFromUrlString('https://www.youtube.com/@RickAstley'), null);
  assert.equal(youtubeIdFromUrlString('https://evil.example.com/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(youtubeIdFromUrlString('not a url at all'), null);
  assert.equal(youtubeIdFromUrlString(''), null);
  assert.equal(youtubeIdFromUrlString(null), null);
});

// ---- deriveScanYoutubeId ----------------------------------------------------

const ROOT = path.sep === '/' ? '/media/ytdlp' : 'C:\\media\\ytdlp';

function fileInfo(name) {
  return { name, ext: path.extname(name) };
}

test('deriveScanYoutubeId: a bracketed filename under the yt-dlp root wins', () => {
  const filePath = path.join(ROOT, 'chan', 'Cool Video [dQw4w9WgXcQ].mp4');
  assert.equal(
    deriveScanYoutubeId(filePath, fileInfo('Cool Video [dQw4w9WgXcQ].mp4'), [ROOT], 'https://youtu.be/aaaaaaaaaaa'),
    'dQw4w9WgXcQ',
    'the filename bracket outranks the embedded URL'
  );
});

test('deriveScanYoutubeId: a bracketed filename OUTSIDE the yt-dlp root is never bracket-parsed (coincidental-name guard), but its embedded URL still counts', () => {
  const filePath = path.join('/media/library', 'Vacation [Holiday2024].mp4');
  assert.equal(
    deriveScanYoutubeId(filePath, fileInfo('Vacation [Holiday2024].mp4'), [ROOT], null),
    null
  );
  assert.equal(
    deriveScanYoutubeId(filePath, fileInfo('Vacation [Holiday2024].mp4'), [ROOT], 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
    'dQw4w9WgXcQ',
    'an explicit embedded source URL is downloader-written provenance, trusted from any root'
  );
});

test('deriveScanYoutubeId: bracket-less file under the root falls through to the embedded URL, then null', () => {
  const filePath = path.join(ROOT, 'Metube Import.mp4');
  assert.equal(
    deriveScanYoutubeId(filePath, fileInfo('Metube Import.mp4'), [ROOT], 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
    'dQw4w9WgXcQ'
  );
  assert.equal(deriveScanYoutubeId(filePath, fileInfo('Metube Import.mp4'), [ROOT], null), null);
});

// ---- sanitizeCapturedTitle --------------------------------------------------

test('sanitizeCapturedTitle: emoji and non-ASCII SURVIVE (they are the point of the field)', () => {
  assert.equal(sanitizeCapturedTitle('Never Gonna 🎵 Give You Up 🕺 (Official)'), 'Never Gonna 🎵 Give You Up 🕺 (Official)');
  assert.equal(sanitizeCapturedTitle('日本語タイトル 🌸'), '日本語タイトル 🌸');
});

test('sanitizeCapturedTitle: control characters are stripped, the result trimmed', () => {
  assert.equal(sanitizeCapturedTitle('  Hello\x00 World\x1f\x7f  '), 'Hello World');
});

test('sanitizeCapturedTitle: absent/non-string/empty-after-strip inputs yield null', () => {
  assert.equal(sanitizeCapturedTitle(undefined), null);
  assert.equal(sanitizeCapturedTitle(null), null);
  assert.equal(sanitizeCapturedTitle(42), null);
  assert.equal(sanitizeCapturedTitle('   '), null);
  assert.equal(sanitizeCapturedTitle('\x00\x1f'), null);
});

test('sanitizeCapturedTitle: length is capped at MAX_CAPTURED_TITLE_LENGTH', () => {
  const long = 'x'.repeat(MAX_CAPTURED_TITLE_LENGTH + 50);
  const out = sanitizeCapturedTitle(long);
  assert.equal(out.length, MAX_CAPTURED_TITLE_LENGTH);
});
