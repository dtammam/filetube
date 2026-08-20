// v1.155 (Subscriptions redesign): unit coverage for the A-Z sectioning +
// live-search helpers that replaced manual drag-to-reorder. These are the pure
// functions behind the scale-ready channel list (Dean's "how do we deal with
// 200+ subscriptions"): grouping into iOS-Contacts-style A-Z sections and
// filtering by name/handle. Bound by EXECUTION, not the census's presence
// check -- the old reorder decision was this file's cautionary tale.

const { test } = require('node:test');
const assert = require('node:assert');

// subscriptions.js self-registers a view on require in a browser, but its
// `module.exports` block is inert under Node (no `window`), exactly as the
// sibling ytdlp-subscriptions-client.test.js relies on.
const {
  subscriptionSortKey,
  subscriptionSectionLetter,
  groupSubscriptionsByLetter,
  filterSubscriptions,
} = require('../../lib/ytdlp/client/subscriptions.js');

// ---- subscriptionSortKey --------------------------------------------------

test('subscriptionSortKey: the trimmed display name; missing/blank name -> empty string', () => {
  assert.strictEqual(subscriptionSortKey({ name: '  Kurzgesagt  ' }), 'Kurzgesagt');
  assert.strictEqual(subscriptionSortKey({ name: '' }), '');
  assert.strictEqual(subscriptionSortKey({}), '');
  assert.strictEqual(subscriptionSortKey(null), '');
  assert.strictEqual(subscriptionSortKey(undefined), '');
});

// ---- subscriptionSectionLetter --------------------------------------------

test('subscriptionSectionLetter: leading Latin letter (case-folded) buckets A-Z', () => {
  assert.strictEqual(subscriptionSectionLetter({ name: 'apple' }), 'A');
  assert.strictEqual(subscriptionSectionLetter({ name: 'Zebra' }), 'Z');
  assert.strictEqual(subscriptionSectionLetter({ name: '  mgmt' }), 'M', 'leading whitespace is trimmed first');
});

test('subscriptionSectionLetter: digits, punctuation, non-Latin and blank all bucket under #', () => {
  assert.strictEqual(subscriptionSectionLetter({ name: '3Blue1Brown' }), '#');
  assert.strictEqual(subscriptionSectionLetter({ name: '@handle' }), '#');
  assert.strictEqual(subscriptionSectionLetter({ name: 'Проект' }), '#');
  assert.strictEqual(subscriptionSectionLetter({ name: '' }), '#');
  assert.strictEqual(subscriptionSectionLetter({}), '#');
});

// ---- groupSubscriptionsByLetter -------------------------------------------

test('groupSubscriptionsByLetter: A..Z sections in order, then a trailing # bucket', () => {
  const subs = [
    { id: '1', name: 'Zeta' },
    { id: '2', name: '3Blue1Brown' },
    { id: '3', name: 'Alpha' },
    { id: '4', name: 'Mango' },
  ];
  const sections = groupSubscriptionsByLetter(subs);
  assert.deepStrictEqual(sections.map((s) => s.letter), ['A', 'M', 'Z', '#'], '# always sorts last');
});

test('groupSubscriptionsByLetter: within a section, rows are sorted case-insensitively by name', () => {
  const subs = [
    { id: '1', name: 'apple' },
    { id: '2', name: 'Acorn' },
    { id: '3', name: 'ANvil' },
  ];
  const sections = groupSubscriptionsByLetter(subs);
  assert.strictEqual(sections.length, 1);
  assert.deepStrictEqual(sections[0].subs.map((s) => s.name), ['Acorn', 'ANvil', 'apple']);
});

test('groupSubscriptionsByLetter: never mutates the caller\'s array', () => {
  const subs = [{ id: '1', name: 'Zeta' }, { id: '2', name: 'Alpha' }];
  const snapshot = subs.slice();
  groupSubscriptionsByLetter(subs);
  assert.deepStrictEqual(subs, snapshot, 'input order is untouched');
});

test('groupSubscriptionsByLetter: empty / non-array input -> no sections (never throws)', () => {
  assert.deepStrictEqual(groupSubscriptionsByLetter([]), []);
  assert.deepStrictEqual(groupSubscriptionsByLetter(null), []);
  assert.deepStrictEqual(groupSubscriptionsByLetter(undefined), []);
});

// ---- filterSubscriptions --------------------------------------------------

test('filterSubscriptions: empty query returns EVERY sub, as a fresh copy (not the same ref)', () => {
  const subs = [{ id: '1', name: 'A' }, { id: '2', name: 'B' }];
  const out = filterSubscriptions(subs, '');
  assert.deepStrictEqual(out, subs);
  assert.notStrictEqual(out, subs, 'a shallow copy, so callers can sort it freely');
  assert.deepStrictEqual(filterSubscriptions(subs, '   '), subs, 'a whitespace-only query is empty');
});

test('filterSubscriptions: case-insensitive substring over the channel NAME', () => {
  const subs = [
    { id: '1', name: 'Veritasium' },
    { id: '2', name: 'Kurzgesagt' },
  ];
  assert.deepStrictEqual(filterSubscriptions(subs, 'RITA').map((s) => s.id), ['1']);
  assert.deepStrictEqual(filterSubscriptions(subs, 'z').map((s) => s.id), ['2'], 'Kurzgesagt matches on z');
});

test('filterSubscriptions: also matches the handle/URL (channelUrl), so @-handle search works', () => {
  const subs = [
    { id: '1', name: 'Some Channel', channelUrl: 'https://www.youtube.com/@veritasium' },
    { id: '2', name: 'Other', channelUrl: 'https://www.youtube.com/@kurzgesagt' },
  ];
  assert.deepStrictEqual(filterSubscriptions(subs, '@verita').map((s) => s.id), ['1']);
  // A query that matches neither name nor url yields nothing.
  assert.deepStrictEqual(filterSubscriptions(subs, 'zzz-nope').map((s) => s.id), []);
});

test('filterSubscriptions: tolerates missing fields and non-array input', () => {
  assert.deepStrictEqual(filterSubscriptions([{ id: '1' }], 'x'), [], 'no name/url never throws, just no match');
  assert.deepStrictEqual(filterSubscriptions(null, 'x'), []);
  assert.deepStrictEqual(filterSubscriptions(undefined, ''), []);
});
