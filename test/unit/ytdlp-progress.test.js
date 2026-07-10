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

// ---- v1.15.1 hotfix: a Destination line for a yt-dlp per-format fragment/
// merge-temp file is cleaned of BOTH the [id] bracket AND the fragment/
// merge-temp infix, instead of leaking the raw ".f399"/".temp" shape into
// the live status. ------------------------------------------------------

test('parseProgressLine: a Destination line for a per-format fragment (".f399.mp4") is tidied to just the title -- no [id], no .f399', () => {
  const patch = parseProgressLine('[download] Destination: /downloads/x/TRUMP FIXED THE WORLD CUP [wSx0Or20MZE].f399.mp4');
  assert.equal(patch.title, 'TRUMP FIXED THE WORLD CUP');
});

test('parseProgressLine: a Destination line for an audio-only fragment (".f251.webm") is tidied the same way', () => {
  const patch = parseProgressLine('[download] Destination: /downloads/x/Some_Video [wSx0Or20MZE].f251.webm');
  assert.equal(patch.title, 'Some Video');
});

test('parseProgressLine: a Destination line for a merge temp (".temp.mp4") is tidied to just the title', () => {
  const patch = parseProgressLine('[download] Destination: /downloads/x/Some_Video [wSx0Or20MZE].temp.mp4');
  assert.equal(patch.title, 'Some Video');
});

test('parseProgressLine: a normal Destination line ("<Title> [<id>].mp4", no fragment infix) still tidies to just the title', () => {
  const patch = parseProgressLine('[download] Destination: /downloads/x/Some_Video [wSx0Or20MZE].mp4');
  assert.equal(patch.title, 'Some Video');
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
});

// ---- v1.26 "real progress" phase patches -----------------------------------
// The ffmpeg-backed postprocess lines below print NO percent -- previously
// they matched nothing at all (see the pre-fix assertion this test file used
// to make, that a `[Merger]` line returns `null`), leaving the live entry's
// `percent` stuck at whatever the last real transfer percent was for the
// entire mux/convert step. They now emit a `{state:'downloading', phase}`
// patch instead, so the client can render an honest "Merging…"/"Converting…"
// label (and an indeterminate progress bar) rather than a stale/frozen
// percent.

test('parseProgressLine: a "[Merger] Merging formats into ..." line yields phase "merging"', () => {
  const patch = parseProgressLine('[Merger] Merging formats into "/downloads/x/video.mp4"');
  assert.ok(patch);
  assert.equal(patch.state, 'downloading');
  assert.equal(patch.phase, 'merging');
});

test('parseProgressLine: a "[Fixup*]" line (any Fixup sub-postprocessor) yields phase "merging"', () => {
  assert.equal(parseProgressLine('[FixupM3u8] Fixing MPEG-TS in MP4 container').phase, 'merging');
  assert.equal(parseProgressLine('[FixupM4a] Correcting container of "/downloads/x/audio.m4a"').phase, 'merging');
  assert.equal(parseProgressLine('[FixupStretched] Fixing video aspect ratio').phase, 'merging');
});

test('parseProgressLine: an "[ExtractAudio]" line yields phase "converting"', () => {
  const patch = parseProgressLine('[ExtractAudio] Destination: /downloads/x/audio.mp3');
  assert.ok(patch);
  assert.equal(patch.state, 'downloading');
  assert.equal(patch.phase, 'converting');
});

test('parseProgressLine: "[VideoConvertor]"/"[VideoRemuxer]" lines yield phase "converting"', () => {
  assert.equal(parseProgressLine('[VideoConvertor] Converting video from webm to mp4').phase, 'converting');
  assert.equal(parseProgressLine('[VideoRemuxer] Remuxing video from webm to mp4; Destination: /downloads/x/video.mp4').phase, 'converting');
});

test('parseProgressLine: a Destination line resets percent to 0 and clears a stale phase (sticky-100 fix)', () => {
  const patch = parseProgressLine('[download] Destination: /downloads/x/Some_Video [wSx0Or20MZE].f251.webm');
  assert.ok(patch);
  assert.equal(patch.percent, 0);
  assert.equal(patch.phase, null);
  assert.ok(Object.prototype.hasOwnProperty.call(patch, 'phase'), 'phase must be an explicit null key, not omitted -- mergeEntry only clears a sticky value for a key that is actually present on the patch');
});

test('parseProgressLine: a real percent line clears a stale phase (explicit null, not omitted)', () => {
  const patch = parseProgressLine('[download]  12.0% of  50.00MiB at 1.00MiB/s ETA 00:40');
  assert.ok(patch);
  assert.equal(patch.phase, null);
  assert.ok(Object.prototype.hasOwnProperty.call(patch, 'phase'));
});

// ---- v1.26 code-review fix (F3): every non-percent, non-Destination branch --
// that reaches a natural "new item" boundary also clears a stale phase -----

test('parseProgressLine: F3 -- a postprocess phase is cleared by a subsequent "already downloaded" line (multi-item spawn boundary)', () => {
  const mergePatch = parseProgressLine('[Merger] Merging formats into "/downloads/x/video.mp4"');
  assert.equal(mergePatch.phase, 'merging');

  const nextItemPatch = parseProgressLine('[download] Other_Video_Title [dQw4w9WgXcQ].mp4 has already been downloaded');
  assert.ok(nextItemPatch);
  assert.equal(nextItemPatch.percent, 100);
  assert.equal(nextItemPatch.phase, null, 'F3: item 2\'s "already downloaded" line must clear item 1\'s stale postprocess phase');
  assert.ok(Object.prototype.hasOwnProperty.call(nextItemPatch, 'phase'), 'phase must be an explicit null key, not omitted');
});

test('parseProgressLine: F3 -- a postprocess phase is cleared by "Downloading item 2 of 2" (the natural new-item boundary)', () => {
  const mergePatch = parseProgressLine('[ExtractAudio] Destination: /downloads/x/audio.mp3');
  assert.equal(mergePatch.phase, 'converting');

  const nextItemPatch = parseProgressLine('[download] Downloading item 2 of 2');
  assert.ok(nextItemPatch);
  assert.equal(nextItemPatch.index, 2);
  assert.equal(nextItemPatch.total, 2);
  assert.equal(nextItemPatch.phase, null, 'F3: the "Downloading item N of M" boundary must clear a prior item\'s stale postprocess phase');
  assert.ok(Object.prototype.hasOwnProperty.call(nextItemPatch, 'phase'), 'phase must be an explicit null key, not omitted');
});

test('parseProgressLine: F3 -- a postprocess phase is cleared by a "[youtube] <id>: Downloading ..." line, for consistency', () => {
  const mergePatch = parseProgressLine('[Merger] Merging formats into "/downloads/x/video.mp4"');
  assert.equal(mergePatch.phase, 'merging');

  const nextItemPatch = parseProgressLine('[youtube] dQw4w9WgXcQ: Downloading webpage');
  assert.ok(nextItemPatch);
  assert.equal(nextItemPatch.videoId, 'dQw4w9WgXcQ');
  assert.equal(nextItemPatch.phase, null);
  assert.ok(Object.prototype.hasOwnProperty.call(nextItemPatch, 'phase'));
});

// ---- v1.26 code-review fix (F6): DESTINATION_RE anchored to line start ----

test('parseProgressLine: F6 -- a hostile title containing "[download] Destination:" mid-line no longer spuriously matches the Destination branch', () => {
  // Pre-fix (unanchored DESTINATION_RE), this line's EMBEDDED
  // "[download] Destination:" substring would have won the match, resetting
  // percent to 0 with a garbage title -- even though the line is actually a
  // real, whole-line "already downloaded" print. Anchoring to the start of
  // the (already-trimmed) line closes this off: the line does not literally
  // START with "[download] Destination:", so it now correctly falls through
  // to the ALREADY_DOWNLOADED_RE branch instead.
  const hostile = '[download] Weird [download] Destination: /tmp/x.mp4 has already been downloaded';
  const patch = parseProgressLine(hostile);
  assert.ok(patch);
  assert.equal(patch.state, 'downloading');
  assert.equal(patch.percent, 100, 'F6: must take the already-downloaded branch (percent 100), not the spurious Destination branch (percent 0)');
});

test('parseProgressLine: a real Destination line (starts the line, as yt-dlp always prints it) still matches normally', () => {
  const patch = parseProgressLine('[download] Destination: /downloads/x/Real_Video [dQw4w9WgXcQ].mp4');
  assert.ok(patch);
  assert.equal(patch.percent, 0);
  assert.equal(patch.title, 'Real Video');
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

// v1.15.1 hotfix: tidyTitle now also strips a trailing ".f<digits>"
// (per-format fragment) or ".temp" (merge temp) infix that can follow the
// [id] bracket once `basenameNoExt` has already stripped the file's FINAL
// extension (e.g. "<Title> [<id>].f399.mp4" arrives here as
// "<Title> [<id>].f399") -- see the module comment above tidyTitle.

test('tidyTitle: a Destination-derived name with "[<id>].f399" (fragment infix) tidies to just the title -- no [id], no .f399', () => {
  assert.equal(tidyTitle('TRUMP FIXED THE WORLD CUP [wSx0Or20MZE].f399'), 'TRUMP FIXED THE WORLD CUP');
});

test('tidyTitle: a Destination-derived name with "[<id>].temp" (merge-temp infix) tidies to just the title', () => {
  assert.equal(tidyTitle('Some_Title [wSx0Or20MZE].temp'), 'Some Title');
});

test('tidyTitle: a normal "<Title> [<id>]" (no fragment/temp infix) still tidies exactly as before', () => {
  assert.equal(tidyTitle('Some_Title [wSx0Or20MZE]'), 'Some Title');
});

test('tidyTitle: a non-yt-dlp-shaped name is left unchanged', () => {
  assert.equal(tidyTitle('just a plain filename stem'), 'just a plain filename stem');
  assert.equal(tidyTitle('report.f399'), 'report.f399');
});
