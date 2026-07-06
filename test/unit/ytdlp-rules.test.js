'use strict';

// [UNIT] lib/ytdlp/rules.js -- the pure, table-driven download-loop decision
// helpers (T4). All PURE/synchronous: no real yt-dlp binary, no network, no
// filesystem, no Date.now() read internally (every `now` is passed in).
// Covers AC 18, 20-26.

const { test } = require('node:test');
const assert = require('node:assert');
const {
  parseYtdlpVideoList,
  isArchived,
  shouldDeferPremiere,
  shouldSkip,
  PREMIERE_WINDOW_MS,
} = require('../../lib/ytdlp/rules');

// ---- parseYtdlpVideoList (AC 18 support) -----------------------------------

test('parseYtdlpVideoList parses one JSON object per NDJSON line', () => {
  const stdout = [
    JSON.stringify({ id: 'a1', title: 'Video A' }),
    JSON.stringify({ id: 'b2', title: 'Video B' }),
  ].join('\n');
  const videos = parseYtdlpVideoList(stdout);
  assert.equal(videos.length, 2);
  assert.equal(videos[0].id, 'a1');
  assert.equal(videos[1].id, 'b2');
});

test('parseYtdlpVideoList tolerates blank lines interspersed with valid ones', () => {
  const stdout = `\n${JSON.stringify({ id: 'a1' })}\n\n\n${JSON.stringify({ id: 'b2' })}\n`;
  const videos = parseYtdlpVideoList(stdout);
  assert.deepEqual(videos.map((v) => v.id), ['a1', 'b2']);
});

test('parseYtdlpVideoList skips a garbled/malformed line instead of throwing', () => {
  const stdout = [
    JSON.stringify({ id: 'a1' }),
    'not valid json {{{',
    JSON.stringify({ id: 'b2' }),
  ].join('\n');
  assert.doesNotThrow(() => parseYtdlpVideoList(stdout));
  const videos = parseYtdlpVideoList(stdout);
  assert.deepEqual(videos.map((v) => v.id), ['a1', 'b2']);
});

test('parseYtdlpVideoList returns an empty array for empty/whitespace/non-string stdout, never throws', () => {
  assert.deepEqual(parseYtdlpVideoList(''), []);
  assert.deepEqual(parseYtdlpVideoList('   \n  \n'), []);
  assert.deepEqual(parseYtdlpVideoList(null), []);
  assert.deepEqual(parseYtdlpVideoList(undefined), []);
  assert.deepEqual(parseYtdlpVideoList(42), []);
});

test('parseYtdlpVideoList skips a parsed-but-non-object line (bare number/array/null)', () => {
  const stdout = ['42', '[1,2,3]', 'null', JSON.stringify({ id: 'ok' })].join('\n');
  const videos = parseYtdlpVideoList(stdout);
  assert.deepEqual(videos.map((v) => v.id), ['ok']);
});

// ---- isArchived (dedup pre-check, AC 18) -----------------------------------

test('isArchived: an id recorded in the archive text resolves to true', () => {
  const archiveText = 'youtube abc123\nyoutube def456\n';
  assert.equal(isArchived(archiveText, 'youtube', 'abc123'), true);
  assert.equal(isArchived(archiveText, 'youtube', 'def456'), true);
});

test('isArchived: a new (unrecorded) id resolves to false', () => {
  const archiveText = 'youtube abc123\n';
  assert.equal(isArchived(archiveText, 'youtube', 'never-seen'), false);
});

test('isArchived: defaults the extractor to "youtube" when omitted/blank', () => {
  const archiveText = 'youtube abc123\n';
  assert.equal(isArchived(archiveText, undefined, 'abc123'), true);
  assert.equal(isArchived(archiveText, '', 'abc123'), true);
});

test('isArchived: an empty/missing archive means nothing is archived', () => {
  assert.equal(isArchived('', 'youtube', 'abc123'), false);
  assert.equal(isArchived(undefined, 'youtube', 'abc123'), false);
  assert.equal(isArchived(null, 'youtube', 'abc123'), false);
});

test('isArchived: never throws on a missing/non-string id', () => {
  assert.doesNotThrow(() => isArchived('youtube abc123', 'youtube', undefined));
  assert.equal(isArchived('youtube abc123', 'youtube', undefined), false);
});

// ---- shouldDeferPremiere (poll-and-defer, AC 24-26) ------------------------

test('shouldDeferPremiere: release_timestamp inside the now..now+2h window defers', () => {
  const now = Date.parse('2026-07-06T12:00:00.000Z');
  const releaseTimestamp = now / 1000 - 60 * 60; // released 1h ago -- still inside the 2h window
  assert.equal(shouldDeferPremiere({ release_timestamp: releaseTimestamp }, now), true);
});

test('shouldDeferPremiere: release_timestamp at/after the window has elapsed proceeds', () => {
  const now = Date.parse('2026-07-06T12:00:00.000Z');
  const releaseTimestamp = now / 1000 - 3 * 60 * 60; // released 3h ago -- window elapsed
  assert.equal(shouldDeferPremiere({ release_timestamp: releaseTimestamp }, now), false);
});

test('shouldDeferPremiere: live_status is_upcoming/is_live always defers regardless of release_timestamp', () => {
  const now = Date.parse('2026-07-06T12:00:00.000Z');
  assert.equal(shouldDeferPremiere({ live_status: 'is_upcoming' }, now), true);
  assert.equal(shouldDeferPremiere({ live_status: 'is_live' }, now), true);
});

test('shouldDeferPremiere: an ordinary already-published video (no live_status/release_timestamp) proceeds', () => {
  const now = Date.parse('2026-07-06T12:00:00.000Z');
  assert.equal(shouldDeferPremiere({ id: 'abc', title: 'Ordinary video' }, now), false);
});

test('shouldDeferPremiere: handles missing/odd fields without throwing', () => {
  const now = Date.now();
  assert.doesNotThrow(() => shouldDeferPremiere(null, now));
  assert.doesNotThrow(() => shouldDeferPremiere(undefined, now));
  assert.equal(shouldDeferPremiere(null, now), false);
  assert.equal(shouldDeferPremiere({ release_timestamp: 'not-a-number' }, now), false);
  assert.equal(shouldDeferPremiere({ release_timestamp: NaN }, now), false);
});

test('shouldDeferPremiere is pure over (meta, now): the same inputs always yield the same decision (restart-safety, AC 26)', () => {
  const now = Date.parse('2026-07-06T12:00:00.000Z');
  const meta = { release_timestamp: now / 1000 - 30 * 60 };
  const first = shouldDeferPremiere(meta, now);
  const second = shouldDeferPremiere(meta, now); // simulates a fresh poll after a "restart" -- no persisted state
  assert.equal(first, second);
  assert.equal(first, true);
});

test('shouldDeferPremiere: the exported window constant is exactly 2 hours', () => {
  assert.equal(PREMIERE_WINDOW_MS, 2 * 60 * 60 * 1000);
});

// ---- shouldSkip (members-only/availability gating, AC 20-23) ---------------

test('shouldSkip: public/unlisted/absent availability proceeds', () => {
  assert.equal(shouldSkip({ availability: 'public' }, {}).skip, false);
  assert.equal(shouldSkip({ availability: 'unlisted' }, {}).skip, false);
  assert.equal(shouldSkip({ id: 'no-availability-field' }, {}).skip, false);
  assert.equal(shouldSkip({ availability: null }, {}).skip, false);
});

test('shouldSkip: members-only content is skipped by default (toggle default skip, AC 23)', () => {
  const result = shouldSkip({ availability: 'subscriber_only' }, {});
  assert.equal(result.skip, true);
  assert.ok(result.reason);
});

test('shouldSkip: members-only content is skipped when the toggle is off even with cookies configured', () => {
  const result = shouldSkip({ availability: 'premium_only' }, { allowMembersOnly: false, cookiesConfigured: true });
  assert.equal(result.skip, true);
});

test('shouldSkip: members-only content is skipped when cookies are missing even with the toggle on (AC 22)', () => {
  const result = shouldSkip({ availability: 'needs_subscription' }, { allowMembersOnly: true, cookiesConfigured: false });
  assert.equal(result.skip, true);
});

test('shouldSkip: members-only content proceeds ONLY when the toggle AND cookies are both present (AC 22)', () => {
  const result = shouldSkip({ availability: 'subscriber_only' }, { allowMembersOnly: true, cookiesConfigured: true });
  assert.equal(result.skip, false);
});

test('shouldSkip: restricted content (needs_auth/private) is always skipped', () => {
  assert.equal(shouldSkip({ availability: 'needs_auth' }, { allowMembersOnly: true, cookiesConfigured: true }).skip, true);
  assert.equal(shouldSkip({ availability: 'private' }, { allowMembersOnly: true, cookiesConfigured: true }).skip, true);
});

test('shouldSkip: an unrecognized/ambiguous availability value fails safe to skip (AC 21)', () => {
  const result = shouldSkip({ availability: 'some_future_youtube_wording_change' }, { allowMembersOnly: true, cookiesConfigured: true });
  assert.equal(result.skip, true, 'an unrecognized availability token must never resolve to proceed');
  assert.ok(result.reason.includes('unrecognized'));
});

test('shouldSkip: never throws regardless of input shape', () => {
  assert.doesNotThrow(() => shouldSkip(null, null));
  assert.doesNotThrow(() => shouldSkip(undefined, undefined));
  assert.equal(shouldSkip(null, undefined).skip, false); // no availability field -- treated as public
});
