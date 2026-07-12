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
  isShort,
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

// ---- C2 (T4 fix round): the extractor compare is case-INSENSITIVE, the id --
// ---- stays an EXACT match. yt-dlp writes archive lines with a lowercased --
// ---- extractor (`youtube <id>`), but `--dump-json`'s `extractor_key` is ---
// ---- TitleCase (`Youtube`) -- a case-sensitive compare never matched a ----
// ---- real YouTube video against its own archive line. ---------------------

test('isArchived: matches a lowercase archive line against a TitleCase extractor_key (C2)', () => {
  const archiveText = 'youtube abc123\n';
  assert.equal(isArchived(archiveText, 'Youtube', 'abc123'), true);
});

test('isArchived: matches regardless of which side is cased (archive vs extractor)', () => {
  assert.equal(isArchived('Youtube abc123\n', 'youtube', 'abc123'), true);
  assert.equal(isArchived('YOUTUBE abc123\n', 'YouTube', 'abc123'), true);
});

test('isArchived: the id itself stays an EXACT (case-sensitive) match even though the extractor is not', () => {
  const archiveText = 'youtube AbC123\n';
  assert.equal(isArchived(archiveText, 'Youtube', 'AbC123'), true);
  assert.equal(isArchived(archiveText, 'Youtube', 'abc123'), false, 'a differently-cased id must NOT match -- only the extractor is case-insensitive');
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

// ---- isShort (v1.15.0 item 4: per-subscription Shorts exclusion) ----------

test('isShort: true when webpage_url contains "/shorts/"', () => {
  assert.equal(isShort({ webpage_url: 'https://www.youtube.com/shorts/abc123defgh' }), true);
});

test('isShort: true when only original_url or url (not webpage_url) contains "/shorts/"', () => {
  assert.equal(isShort({ original_url: 'https://www.youtube.com/shorts/abc123defgh' }), true);
  assert.equal(isShort({ url: 'https://www.youtube.com/shorts/abc123defgh' }), true);
});

test('isShort: false for a normal /watch URL', () => {
  assert.equal(isShort({ webpage_url: 'https://www.youtube.com/watch?v=abc123defgh' }), false);
});

test('isShort: false when missing/odd fields (never throws) -- fails open toward "not a short"', () => {
  assert.doesNotThrow(() => isShort(null));
  assert.doesNotThrow(() => isShort(undefined));
  assert.equal(isShort(null), false);
  assert.equal(isShort(undefined), false);
  assert.equal(isShort({}), false);
  assert.equal(isShort({ webpage_url: 42 }), false);
  assert.equal(isShort({ webpage_url: null }), false);
  assert.equal(isShort('not-an-object'), false);
});

test('isShort: false when the fields are present but do not contain "/shorts/"', () => {
  assert.equal(isShort({ webpage_url: 'https://www.youtube.com/@somechannel' }), false);
});

// ---- v1.36 F1 fix round: isBeforeCutoff (the authoritative JS date gate) ---
//
// Replaces the retired `--dateafter` argv flag (which masked the break-early
// filter -- see lib/ytdlp/args.js breakEarlyArgs). Must reproduce yt-dlp's
// daterange semantics EXACTLY, including the keep-when-dateless behavior.

const t36 = require('node:test').test;

t36('v1.36 isBeforeCutoff: strictly-older upload_date -> true (skip); same-day or newer -> false (keep, --dateafter is >=)', () => {
  const rules36 = require('../../lib/ytdlp/rules');
  assert.equal(rules36.isBeforeCutoff({ upload_date: '20260701' }, '20260709'), true);
  assert.equal(rules36.isBeforeCutoff({ upload_date: '20260709' }, '20260709'), false, 'same-day must be KEPT (>= semantics)');
  assert.equal(rules36.isBeforeCutoff({ upload_date: '20260710' }, '20260709'), false);
  // Year boundary: lexicographic YYYYMMDD compare == calendar compare.
  assert.equal(rules36.isBeforeCutoff({ upload_date: '20251231' }, '20260101'), true);
});

t36('v1.36 isBeforeCutoff: a missing/malformed upload_date is KEPT (premiere/live placeholders flowed through --dateafter too)', () => {
  const rules36 = require('../../lib/ytdlp/rules');
  for (const meta of [{}, null, undefined, { upload_date: null }, { upload_date: '' }, { upload_date: '2026-07-09' }, { upload_date: 20260709 }]) {
    assert.equal(rules36.isBeforeCutoff(meta, '20260709'), false, `meta=${JSON.stringify(meta)} must be kept`);
  }
});

t36('v1.36 isBeforeCutoff: a missing/malformed cutoffDate keeps everything (mirrors dateAfterArgs fail-safe-to-no-bound)', () => {
  const rules36 = require('../../lib/ytdlp/rules');
  for (const bad of [undefined, null, '', '2026070', 'abcd0709', 20260709]) {
    assert.equal(rules36.isBeforeCutoff({ upload_date: '19990101' }, bad), false, `cutoff=${JSON.stringify(bad)}`);
  }
});
