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
