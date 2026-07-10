'use strict';

// [UNIT] v1.24.0 A2 (T14) -- lib/ytdlp/index.js's `mapItemFailuresForActivity`
// (maps run.js's raw `itemFailures` onto the activity LiveEntry's
// `{videoId, title?, reason}` shape, enriching with a video title from the
// SAME cycle's own already-fetched --dump-json list) and `sanitizeFailureTitle`
// (the title-side defensive posture mirroring failures.js's reason
// sanitizer). Both are pure, no I/O.

const { test } = require('node:test');
const assert = require('node:assert');
const { mapItemFailuresForActivity, sanitizeFailureTitle } = require('../../lib/ytdlp');

// ---- mapItemFailuresForActivity ---------------------------------------------

test('mapItemFailuresForActivity enriches an attributed failure with the matching video title from the list', () => {
  const itemFailures = [{ videoId: 'vid1', reason: 'Video unavailable' }];
  const videos = [{ id: 'vid1', title: 'Some Cool Video' }, { id: 'vid2', title: 'Other Video' }];
  assert.deepEqual(mapItemFailuresForActivity(itemFailures, videos), [
    { videoId: 'vid1', title: 'Some Cool Video', reason: 'Video unavailable' },
  ]);
});

test('mapItemFailuresForActivity: an unattributed failure (videoId: null) has no title to look up and is passed through unchanged, never dropped', () => {
  const itemFailures = [{ videoId: null, reason: 'Sign in to confirm your age' }];
  const videos = [{ id: 'vid1', title: 'Some Cool Video' }];
  assert.deepEqual(mapItemFailuresForActivity(itemFailures, videos), [
    { videoId: null, reason: 'Sign in to confirm your age' },
  ]);
});

test('mapItemFailuresForActivity: an attributed failure whose video has no title in the list omits the title field entirely (never an empty string)', () => {
  const itemFailures = [{ videoId: 'vid1', reason: 'Video unavailable' }];
  assert.deepEqual(mapItemFailuresForActivity(itemFailures, []), [
    { videoId: 'vid1', reason: 'Video unavailable' },
  ]);
  assert.deepEqual(mapItemFailuresForActivity(itemFailures, [{ id: 'vid1', title: '' }]), [
    { videoId: 'vid1', reason: 'Video unavailable' },
  ]);
});

test('mapItemFailuresForActivity: multiple failures across different videos are each mapped independently, preserving order', () => {
  const itemFailures = [
    { videoId: 'vid2', reason: 'Members-only content' },
    { videoId: null, reason: 'Unattributed reason' },
    { videoId: 'vid1', reason: 'Video unavailable' },
  ];
  const videos = [{ id: 'vid1', title: 'First' }, { id: 'vid2', title: 'Second' }];
  assert.deepEqual(mapItemFailuresForActivity(itemFailures, videos), [
    { videoId: 'vid2', title: 'Second', reason: 'Members-only content' },
    { videoId: null, reason: 'Unattributed reason' },
    { videoId: 'vid1', title: 'First', reason: 'Video unavailable' },
  ]);
});

test('mapItemFailuresForActivity returns [] (never throws) for an empty/absent/malformed itemFailures array', () => {
  assert.deepEqual(mapItemFailuresForActivity([], []), []);
  assert.deepEqual(mapItemFailuresForActivity(undefined, []), []);
  assert.deepEqual(mapItemFailuresForActivity(null, []), []);
  assert.deepEqual(mapItemFailuresForActivity('not-an-array', []), []);
});

test('mapItemFailuresForActivity: malformed entries inside itemFailures are skipped, not thrown on', () => {
  const itemFailures = [null, 42, 'garbage', { videoId: 'vid1', reason: 'ok reason' }];
  assert.deepEqual(mapItemFailuresForActivity(itemFailures, []), [
    { videoId: 'vid1', reason: 'ok reason' },
  ]);
});

test('mapItemFailuresForActivity: a malformed/non-array videos list degrades to no title enrichment, never throws', () => {
  const itemFailures = [{ videoId: 'vid1', reason: 'Video unavailable' }];
  assert.doesNotThrow(() => mapItemFailuresForActivity(itemFailures, 'not-an-array'));
  assert.deepEqual(mapItemFailuresForActivity(itemFailures, 'not-an-array'), [
    { videoId: 'vid1', reason: 'Video unavailable' },
  ]);
  assert.deepEqual(mapItemFailuresForActivity(itemFailures, undefined), [
    { videoId: 'vid1', reason: 'Video unavailable' },
  ]);
});

// ---- sanitizeFailureTitle -----------------------------------------------------

test('sanitizeFailureTitle trims a normal title', () => {
  assert.equal(sanitizeFailureTitle('  My Video Title  '), 'My Video Title');
});

test('sanitizeFailureTitle strips control characters', () => {
  assert.equal(sanitizeFailureTitle('Title\x00 with\x1b control\x07 chars'), 'Title with control chars');
});

test('sanitizeFailureTitle caps an oversized title', () => {
  const huge = 'x'.repeat(500);
  const result = sanitizeFailureTitle(huge);
  assert.equal(result.length, 200);
});

test('sanitizeFailureTitle returns undefined (never null/empty-string) for anything unusable', () => {
  assert.equal(sanitizeFailureTitle(''), undefined);
  assert.equal(sanitizeFailureTitle('   '), undefined);
  assert.equal(sanitizeFailureTitle(null), undefined);
  assert.equal(sanitizeFailureTitle(undefined), undefined);
  assert.equal(sanitizeFailureTitle(42), undefined);
  assert.equal(sanitizeFailureTitle({}), undefined);
});
