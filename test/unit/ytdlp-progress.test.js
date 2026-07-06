'use strict';

// [UNIT] lib/ytdlp/progress.js -- `parseProgressLine` (AC 27). Pure,
// synchronous, no spawn/fs involved. Fixtures below are REAL yt-dlp
// `--newline` output shapes (including the right-justified double-space
// percent formatting yt-dlp actually emits), not idealized ones.

const { test } = require('node:test');
const assert = require('node:assert');
const { parseProgressLine, tidyTitle } = require('../../lib/ytdlp/progress');

// ---- percent extraction, incl. the real double-space formatting ----------

test('parseProgressLine: extracts percent/speed/eta from a real in-progress line', () => {
  const patch = parseProgressLine('[download]  47.2% of  120.5MiB at 3.20MiB/s ETA 00:25');
  assert.ok(patch);
  assert.equal(patch.percent, 47.2);
  assert.equal(patch.speed, '3.20MiB/s');
  assert.equal(patch.eta, '00:25');
  assert.equal(patch.state, 'downloading');
});

test('parseProgressLine: handles yt-dlp\'s "Unknown speed ETA Unknown" variant (speed itself is the two-word placeholder)', () => {
  const patch = parseProgressLine('[download]   0.0% of   10.00MiB at  Unknown speed ETA Unknown');
  assert.ok(patch);
  assert.equal(patch.percent, 0);
  assert.equal(patch.speed, 'Unknown speed');
  assert.equal(patch.eta, 'Unknown');
});

test('parseProgressLine: FIX-4 -- a finished-download summary line ("100% of X in Y at Z", no ETA) still extracts percent 100, but stays "downloading" (item-level, never terminal on its own)', () => {
  const patch = parseProgressLine('[download] 100% of  120.50MiB in 00:00:38 at 3.13MiB/s');
  assert.ok(patch);
  assert.equal(patch.percent, 100);
  // FIX-4 (two-reviewer gate): a per-item 100% must NOT flip the whole
  // subscription/one-shot to a terminal state -- one spawn can target many
  // survivor ids, so item 1 finishing must not make a status poll falsely
  // report the WHOLE download complete. Only the orchestrator (after its
  // `runDownload` await settles for every target) may set 'done'.
  assert.equal(patch.state, 'downloading');
});

test('parseProgressLine: a mid-progress percent (< 100) is state "downloading"', () => {
  const patch = parseProgressLine('[download]  12.0% of  50.00MiB at 1.00MiB/s ETA 00:40');
  assert.equal(patch.state, 'downloading');
});

// ---- Destination line -----------------------------------------------------

test('parseProgressLine: a Destination line yields a downloading patch with a cleaned title', () => {
  const patch = parseProgressLine('[download] Destination: /downloads/SomeChannel/Amazing_Video_Title [dQw4w9WgXcQ].mp4');
  assert.ok(patch);
  assert.equal(patch.state, 'downloading');
  assert.equal(patch.title, 'Amazing Video Title');
});

test('parseProgressLine: FIX-8 -- a Destination line NEVER surfaces the absolute path in the returned patch', () => {
  const patch = parseProgressLine('[download] Destination: /downloads/SomeChannel/Amazing_Video_Title [dQw4w9WgXcQ].mp4');
  assert.equal(patch.destination, undefined, 'the absolute download-dir path must never be present on the patch (leaks into the unauthenticated status snapshot otherwise)');
  assert.ok(!Object.prototype.hasOwnProperty.call(patch, 'destination'));
});

test('parseProgressLine: a Destination line whose basename has no bracketed id keeps the raw title UNCHANGED (mirrors FR-F: no match = no-op)', () => {
  const patch = parseProgressLine('[download] Destination: /downloads/x/My_Home_Movie.mp4');
  assert.equal(patch.title, 'My_Home_Movie');
});

// ---- already-downloaded ----------------------------------------------------

test('parseProgressLine: FIX-4 -- "has already been downloaded" yields a 100% patch with a cleaned title, but stays "downloading" (item-level, never terminal on its own)', () => {
  const patch = parseProgressLine('[download] Amazing_Video_Title [dQw4w9WgXcQ].mp4 has already been downloaded');
  assert.ok(patch);
  // FIX-4 (two-reviewer gate): item 1 of a multi-item subscription download
  // being already-archived must not flip the WHOLE subscription to 'done'.
  assert.equal(patch.state, 'downloading');
  assert.equal(patch.percent, 100);
  assert.equal(patch.title, 'Amazing Video Title');
});

// ---- multi-target "item N of M" -------------------------------------------

test('parseProgressLine: "Downloading item N of M" extracts index/total', () => {
  const patch = parseProgressLine('[download] Downloading item 3 of 12');
  assert.ok(patch);
  assert.equal(patch.index, 3);
  assert.equal(patch.total, 12);
  assert.equal(patch.state, 'downloading');
});

// ---- per-video [youtube] extractor lines ----------------------------------

test('parseProgressLine: a "[youtube] <id>: Downloading ..." line yields a downloading patch with videoId', () => {
  const patch = parseProgressLine('[youtube] dQw4w9WgXcQ: Downloading webpage');
  assert.ok(patch);
  assert.equal(patch.state, 'downloading');
  assert.equal(patch.videoId, 'dQw4w9WgXcQ');
});

test('parseProgressLine: other "[youtube] <id>: Downloading ..." sub-stages (e.g. "ios player API JSON") also match', () => {
  const patch = parseProgressLine('[youtube] dQw4w9WgXcQ: Downloading ios player API JSON');
  assert.ok(patch);
  assert.equal(patch.videoId, 'dQw4w9WgXcQ');
});

// ---- non-progress lines -> null (no signal) --------------------------------

test('parseProgressLine: a non-progress informational line returns null', () => {
  assert.equal(parseProgressLine('[youtube] Extracting URL: https://www.youtube.com/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(parseProgressLine('[info] Writing video metadata as JSON to: /downloads/x/video.info.json'), null);
  assert.equal(parseProgressLine('[Merger] Merging formats into "/downloads/x/video.mp4"'), null);
});

test('parseProgressLine: an empty or whitespace-only line returns null', () => {
  assert.equal(parseProgressLine(''), null);
  assert.equal(parseProgressLine('   '), null);
  assert.equal(parseProgressLine('\n'), null);
});

// ---- garbage / adversarial input -> null, never throws --------------------

test('parseProgressLine: non-string input returns null without throwing', () => {
  assert.doesNotThrow(() => parseProgressLine(null));
  assert.doesNotThrow(() => parseProgressLine(undefined));
  assert.doesNotThrow(() => parseProgressLine(42));
  assert.doesNotThrow(() => parseProgressLine({}));
  assert.doesNotThrow(() => parseProgressLine(['[download] 50%']));
  assert.equal(parseProgressLine(null), null);
  assert.equal(parseProgressLine(undefined), null);
  assert.equal(parseProgressLine(42), null);
  assert.equal(parseProgressLine({}), null);
});

test('parseProgressLine: a deliberately malformed/garbage line never throws and yields null', () => {
  const hostile = '[download] %%%%%%%% of NaNMiB at \0\0\0 ETA ��'.repeat(3);
  assert.doesNotThrow(() => parseProgressLine(hostile));
  const patch = parseProgressLine(hostile);
  // No numeric percent could be extracted -- must be null, not a
  // half-populated patch with NaN/undefined fields.
  assert.equal(patch, null);
});

test('parseProgressLine: an absurdly long line never throws (defensive against a pathological stream)', () => {
  const huge = '[download] '.padEnd(200000, 'x');
  assert.doesNotThrow(() => parseProgressLine(huge));
});

// ---- tidyTitle (exported cosmetic helper) ----------------------------------

test('tidyTitle: strips a trailing bracketed 11-char id and converts underscores to spaces', () => {
  assert.equal(tidyTitle('Some_Title_Here [dQw4w9WgXcQ]'), 'Some Title Here');
});

test('tidyTitle: leaves a name with no matching bracket unchanged (aside from underscore conversion only when matched)', () => {
  assert.equal(tidyTitle('My_Home_Movie'), 'My_Home_Movie');
});

test('tidyTitle: a non-11-char bracket token is left unchanged', () => {
  assert.equal(tidyTitle('Something [notanid]'), 'Something [notanid]');
});

test('tidyTitle: non-string input passes through unchanged rather than throwing', () => {
  assert.equal(tidyTitle(null), null);
  assert.equal(tidyTitle(undefined), undefined);
});
