'use strict';

// [UNIT] v1.24.0 A2 (T14, FR-3+FR-7 phase a) -- lib/ytdlp/failures.js's pure
// `parseItemFailureLine`, the never-misattribute per-video download-failure
// parser. This is the security-load-bearing surface of the two-reviewer
// gate on T14: attribution to a real `videoId` must ONLY ever happen when
// the extracted candidate id is a byte-for-byte member of the caller's
// `knownIds` set -- never guessed, never coerced, never dropped.

const { test } = require('node:test');
const assert = require('node:assert');
const { parseItemFailureLine, MAX_REASON_LENGTH } = require('../../lib/ytdlp/failures.js');

// ---- the never-misattribute guarantee --------------------------------------

test('parseItemFailureLine attributes a real per-video ERROR line to the right survivor id, given the known-id set', () => {
  const knownIds = new Set(['dQw4w9WgXcQ', 'otherSurvivor1']);
  const result = parseItemFailureLine('ERROR: [youtube] dQw4w9WgXcQ: Video unavailable', knownIds);
  assert.deepEqual(result, { videoId: 'dQw4w9WgXcQ', reason: 'Video unavailable' });
});

test('parseItemFailureLine also accepts a plain array for knownIds (not just a Set)', () => {
  const result = parseItemFailureLine('ERROR: [youtube] vid1: Sign in to confirm your age', ['vid1', 'vid2']);
  assert.deepEqual(result, { videoId: 'vid1', reason: 'Sign in to confirm your age' });
});

test('parseItemFailureLine: an id NOT in knownIds is surfaced as unattributed -- never dropped, never misattributed to a near-miss id', () => {
  const knownIds = new Set(['realSurvivorId']);
  const result = parseItemFailureLine('ERROR: [youtube] someOtherId: Video unavailable', knownIds);
  assert.deepEqual(result, { videoId: null, reason: 'Video unavailable' });
});

test('parseItemFailureLine: an id that is a near-miss (prefix/suffix) of a known id is STILL unattributed, not fuzzy-matched', () => {
  const knownIds = new Set(['abc123']);
  assert.deepEqual(
    parseItemFailureLine('ERROR: [youtube] abc1234: reason text', knownIds),
    { videoId: null, reason: 'reason text' }
  );
  assert.deepEqual(
    parseItemFailureLine('ERROR: [youtube] abc12: reason text', knownIds),
    { videoId: null, reason: 'reason text' }
  );
});

test('parseItemFailureLine: omitting knownIds entirely treats every candidate as unattributed (never throws, never guesses)', () => {
  assert.deepEqual(
    parseItemFailureLine('ERROR: [youtube] vid1: some reason', undefined),
    { videoId: null, reason: 'some reason' }
  );
});

test('parseItemFailureLine: a hostile/malformed knownIds value (not a Set or array) degrades to "nothing known", never throws', () => {
  assert.doesNotThrow(() => parseItemFailureLine('ERROR: [youtube] vid1: reason', 'not-a-set'));
  assert.deepEqual(parseItemFailureLine('ERROR: [youtube] vid1: reason', 'not-a-set'), { videoId: null, reason: 'reason' });
  assert.deepEqual(parseItemFailureLine('ERROR: [youtube] vid1: reason', {}), { videoId: null, reason: 'reason' });
  assert.deepEqual(parseItemFailureLine('ERROR: [youtube] vid1: reason', null), { videoId: null, reason: 'reason' });
});

// ---- shape recognition -------------------------------------------------------

test('parseItemFailureLine: a non-error line (progress, warning, blank) returns null', () => {
  assert.equal(parseItemFailureLine('[download]  47.2% of  120.5MiB at 3.20MiB/s ETA 00:25', new Set(['x'])), null);
  assert.equal(parseItemFailureLine('[youtube] dQw4w9WgXcQ: Downloading webpage', new Set(['dQw4w9WgXcQ'])), null);
  assert.equal(parseItemFailureLine('WARNING: some non-fatal notice', new Set(['x'])), null);
  assert.equal(parseItemFailureLine('', new Set(['x'])), null);
  assert.equal(parseItemFailureLine('   ', new Set(['x'])), null);
});

test('parseItemFailureLine: an aggregate/non-per-video ERROR line (no bracketed extractor + id shape) returns null', () => {
  assert.equal(parseItemFailureLine('ERROR: unable to download webpage', new Set(['x'])), null);
  assert.equal(parseItemFailureLine('ERROR: Unsupported URL: https://example.com', new Set(['x'])), null);
});

test('parseItemFailureLine: the extractor tag may itself contain a colon (e.g. "youtube:tab") without breaking id extraction', () => {
  const result = parseItemFailureLine('ERROR: [youtube:tab] vid1: Private video', new Set(['vid1']));
  assert.deepEqual(result, { videoId: 'vid1', reason: 'Private video' });
});

test('parseItemFailureLine: a reason containing its own colon(s) is captured in full, not truncated at the first one', () => {
  const result = parseItemFailureLine(
    'ERROR: [generic] vid1: Unable to download webpage: HTTP Error 404: Not Found',
    new Set(['vid1'])
  );
  assert.deepEqual(result, { videoId: 'vid1', reason: 'Unable to download webpage: HTTP Error 404: Not Found' });
});

test('parseItemFailureLine: leading/trailing whitespace around the whole line is tolerated', () => {
  const result = parseItemFailureLine('   ERROR: [youtube] vid1: Video unavailable   ', new Set(['vid1']));
  assert.deepEqual(result, { videoId: 'vid1', reason: 'Video unavailable' });
});

// ---- reason sanitization: control-char strip + length cap -------------------

test('parseItemFailureLine strips ASCII control characters (incl. terminal-escape-ish bytes) out of the reason', () => {
  const hostileReason = 'Video\x1b[31m unavailable\x00\x07';
  const result = parseItemFailureLine(`ERROR: [youtube] vid1: ${hostileReason}`, new Set(['vid1']));
  assert.equal(result.videoId, 'vid1');
  // eslint-disable-next-line no-control-regex
  assert.ok(!/[\x00-\x1f\x7f]/.test(result.reason), `control characters survived sanitization: ${JSON.stringify(result.reason)}`);
  assert.equal(result.reason, 'Video[31m unavailable');
});

test('parseItemFailureLine caps an oversized reason at MAX_REASON_LENGTH', () => {
  const hugeReason = 'x'.repeat(MAX_REASON_LENGTH + 500);
  const result = parseItemFailureLine(`ERROR: [youtube] vid1: ${hugeReason}`, new Set(['vid1']));
  assert.equal(result.reason.length, MAX_REASON_LENGTH);
});

test('parseItemFailureLine: a reason that sanitizes down to nothing (only control chars/whitespace) returns null', () => {
  const result = parseItemFailureLine('ERROR: [youtube] vid1: \x00\x01\x02   ', new Set(['vid1']));
  assert.equal(result, null);
});

test('MAX_REASON_LENGTH is a sane positive bound', () => {
  assert.ok(Number.isInteger(MAX_REASON_LENGTH) && MAX_REASON_LENGTH > 0);
});

// ---- hostile input never throws ---------------------------------------------

test('parseItemFailureLine never throws on hostile/wrong-type input', () => {
  const knownIds = new Set(['vid1']);
  assert.doesNotThrow(() => parseItemFailureLine(null, knownIds));
  assert.doesNotThrow(() => parseItemFailureLine(undefined, knownIds));
  assert.doesNotThrow(() => parseItemFailureLine(42, knownIds));
  assert.doesNotThrow(() => parseItemFailureLine({}, knownIds));
  assert.doesNotThrow(() => parseItemFailureLine([], knownIds));
  assert.doesNotThrow(() => parseItemFailureLine('ERROR: ['.repeat(10000), knownIds));
  assert.equal(parseItemFailureLine(null, knownIds), null);
  assert.equal(parseItemFailureLine(undefined, knownIds), null);
  assert.equal(parseItemFailureLine(42, knownIds), null);
});

test('parseItemFailureLine: an embedded fake "known" id inside the reason text of an unattributed line is never promoted to videoId', () => {
  // Adversarial: the REASON text itself contains what looks like a second
  // "ERROR: [...] <knownId>: ..." shape -- only the FIRST match position
  // (the actual id slot) is ever consulted; embedding a known id inside the
  // reason string must never cause a match.
  const knownIds = new Set(['realVideoId']);
  const result = parseItemFailureLine(
    'ERROR: [youtube] forgedId: fake reason mentioning ERROR: [youtube] realVideoId: nested',
    knownIds
  );
  assert.equal(result.videoId, null, 'the id SLOT (forgedId) is what is checked, never text appearing later in the reason');
});

// ---- v1.36.2 (Dean): subtitle failures are non-blocking ----------------------
//
// A transcript that can't be fetched/converted must never turn a completed
// media download into a failed history row. Two shapes: the per-video
// `ERROR: [youtube] <id>: ... subtitles ...` line (tagged subtitleOnly,
// attribution kept for diagnostics) and the global
// `ERROR: Postprocessing: ...vtt...` line (previously parsed as NOTHING, so
// a subs-only exit-1 read as a channel-level failure).

test('v1.36.2: a per-video subtitle ERROR is tagged subtitleOnly (attribution kept)', () => {
  const known = new Set(['vidsubs0001']);
  const result = parseItemFailureLine("ERROR: [youtube] vidsubs0001: Unable to download video subtitles for 'en': HTTP Error 429", known);
  assert.equal(result.videoId, 'vidsubs0001');
  assert.equal(result.subtitleOnly, true);
});

test('v1.36.2: a global postprocessing subtitle ERROR (no [extractor] prefix) is now a subtitleOnly marker instead of parsing as nothing', () => {
  const result = parseItemFailureLine('ERROR: Postprocessing: Error opening output files: Invalid argument (some-video.en.vtt)', new Set());
  assert.ok(result, 'must parse');
  assert.equal(result.videoId, null);
  assert.equal(result.subtitleOnly, true);
});

test('v1.36.2: a NON-subtitle global ERROR still parses as nothing (channel-level failure posture unchanged)', () => {
  assert.equal(parseItemFailureLine('ERROR: Unable to extract player version', new Set()), null);
});

test('v1.36.2: a non-subtitle per-video ERROR carries NO subtitleOnly tag (blocking classification unchanged)', () => {
  const known = new Set(['vidreal0001']);
  const result = parseItemFailureLine('ERROR: [youtube] vidreal0001: Video unavailable', known);
  assert.equal(result.videoId, 'vidreal0001');
  assert.ok(!('subtitleOnly' in result), 'no tag on real failures');
});

const { computeDownloadOutcome } = require('../../lib/ytdlp/failures');

test('v1.36.2: computeDownloadOutcome -- a subs-only non-zero exit with CORROBORATED completions is an honest SUCCESS (all targets credited)', () => {
  const result = computeDownloadOutcome({
    ok: false,
    itemFailures: [
      { videoId: 'vidsubs0001', reason: "Unable to download video subtitles for 'en': HTTP Error 429", subtitleOnly: true },
      { videoId: null, reason: 'Postprocessing: Error opening output files (x.en.vtt)', subtitleOnly: true },
    ],
    targetIds: ['vidsubs0001', 'vidother002'],
    completedCount: 2, // one FTCHMETA per completed download -- positive evidence
  });
  assert.deepEqual(result, { outcome: 'success', succeeded: 2, failed: 0 });
});

// v1.36.2 gate hardening (adversarial WARNING): the subs-only grant is
// corroborated, never taken on faith -- an UNPARSED real fatal alongside a
// subtitle line must not read as full success and advance the cutoff.
test('v1.36.2 hardening: subs-only failures with PARTIAL completion evidence credit exactly what completed', () => {
  const result = computeDownloadOutcome({
    ok: false,
    itemFailures: [{ videoId: null, reason: 'convert x.en.vtt failed', subtitleOnly: true }],
    targetIds: ['a1', 'b2', 'c3'],
    completedCount: 1, // e.g. an unparsed global fatal killed the rest
  });
  assert.deepEqual(result, { outcome: 'partial', succeeded: 1, failed: 2 });
});

test('v1.36.2 hardening: subs-only failures with ZERO completion evidence stay a channel-level error (nothing credited, safe retry)', () => {
  for (const completedCount of [0, undefined, null, -1, 'junk']) {
    const result = computeDownloadOutcome({
      ok: false,
      itemFailures: [{ videoId: null, reason: 'convert x.en.vtt failed', subtitleOnly: true }],
      targetIds: ['a1', 'b2'],
      completedCount,
    });
    assert.deepEqual(result, { outcome: 'error', succeeded: 0, failed: 2 }, 'completedCount=' + String(completedCount));
  }
});

test('v1.36.2 hardening: a GLOBAL error line matches only on flag/extension tokens -- a creator title containing the word subtitles never qualifies', () => {
  assert.equal(
    parseItemFailureLine('ERROR: Postprocessing: could not merge "How To Add Subtitles To Your Videos.mp4"', new Set()),
    null,
    'bare nouns are NOT enough on id-less lines (creator-controlled text)',
  );
  const real = parseItemFailureLine('ERROR: Postprocessing: Error opening output files: Invalid argument (clip.en.vtt)', new Set());
  assert.equal(real && real.subtitleOnly, true, 'the .vtt artifact token still qualifies');
});

test('v1.36.2: computeDownloadOutcome -- subtitle errors MIXED with a real failure still count only the real one (partial, not error)', () => {
  const result = computeDownloadOutcome({
    ok: false,
    itemFailures: [
      { videoId: 'vidsubs0001', reason: 'subtitles unavailable', subtitleOnly: true },
      { videoId: 'vidreal0002', reason: 'Video unavailable' },
    ],
    targetIds: ['vidsubs0001', 'vidreal0002', 'vidfine0003'],
    completedCount: 2,
  });
  assert.equal(result.outcome, 'partial');
  assert.equal(result.failed, 1, 'only the REAL failure counts');
  assert.equal(result.succeeded, 2);
});

test('v1.36.2: computeDownloadOutcome -- ok:false with zero failures of ANY kind stays a channel-level error (Direction A unchanged)', () => {
  assert.deepEqual(
    computeDownloadOutcome({ ok: false, itemFailures: [], targetIds: ['a1', 'b2'] }),
    { outcome: 'error', succeeded: 0, failed: 2 },
  );
});
