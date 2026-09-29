'use strict';

// [UNIT] v1.342 Clean up: the suggestion rules (lib/cleanup/suggest.js). The module is a
// SHORTLIST: the tests below pin what it must never nominate as much as what it must.

const { test } = require('node:test');
const assert = require('node:assert');
const { computeSuggestions, normalizeDays, LARGEST_LIMIT } = require('../../lib/cleanup/suggest');

const DAY = 86400000;
const NOW = Date.UTC(2026, 8, 29);
const ago = (d) => NOW - d * DAY;
const isoAgo = (d) => new Date(ago(d)).toISOString();

function item(id, over) {
  return Object.assign({ id, title: `T ${id}`, filePath: `/lib/${id}.mp4`, size: 100, duration: 100, addedAt: ago(90), type: 'video' }, over || {});
}
function lib(...items) { const m = {}; for (const i of items) m[i.id] = i; return m; }
function user(over) { return Object.assign({ userId: 'u1', progress: {}, watched: {}, liked: [] }, over || {}); }
function run(metadata, users, extra) {
  return computeSuggestions(Object.assign({ metadata, users: users || [user()], viewerId: 'u1', nowMs: NOW, days: 30 }, extra || {}));
}
const ids = (list) => list.map((x) => x.id);

test('days: default 30, clamped, junk falls back', () => {
  assert.strictEqual(normalizeDays(undefined), 30);
  assert.strictEqual(normalizeDays('abc'), 30);
  assert.strictEqual(normalizeDays('0'), 1);
  assert.strictEqual(normalizeDays('99999'), 3650);
  assert.strictEqual(normalizeDays('45'), 45);
});

test('(a) watched: finished at least N days ago is listed; recent or unstamped is not', () => {
  const m = lib(item('old'), item('recent'), item('nostamp'), item('half'));
  const u = user({
    watched: { old: isoAgo(40), recent: isoAgo(3), nostamp: null },
    progress: { half: { timestamp: 50, duration: 100, updatedAt: isoAgo(60) } },
  });
  assert.deepStrictEqual(ids(run(m, [u]).watched), ['old']);
});

test('(a) a live position at 90 percent counts as finished, like History', () => {
  const m = lib(item('near'));
  const u = user({ progress: { near: { timestamp: 91, duration: 100, updatedAt: isoAgo(50) } } });
  assert.deepStrictEqual(ids(run(m, [u]).watched), ['near']);
});

test('(a) another account finished it, the viewer did not: not the viewer\'s watched', () => {
  const m = lib(item('x'));
  const other = user({ userId: 'u2', watched: { x: isoAgo(50) } });
  assert.deepStrictEqual(run(m, [user(), other]).watched, []);
});

test('protected: a like by ANYONE, or a part-watched position by ANYONE, keeps it out of every group', () => {
  const m = lib(item('liked'), item('partial'), item('ok'));
  const viewer = user({ watched: { liked: isoAgo(50), partial: isoAgo(50), ok: isoAgo(50) } });
  const other = user({ userId: 'u2', liked: ['liked'], progress: { partial: { timestamp: 30, duration: 100, updatedAt: isoAgo(1) } } });
  const r = run(m, [viewer, other]);
  assert.deepStrictEqual(ids(r.watched), ['ok']);
  for (const g of [r.watched, r.stale_subscriptions, r.largest, r.duplicates]) {
    assert.ok(!ids(g).includes('liked') && !ids(g).includes('partial'));
  }
});

test('protected: a size-less item is never listed', () => {
  const m = lib(item('nosize', { size: 0 }));
  assert.deepStrictEqual(run(m, [user({ watched: { nosize: isoAgo(50) } })]).watched, []);
});

test('(b) stale subscription: old, never opened, from a subscription; opened or new or non-subscription is not', () => {
  const m = lib(item('stale'), item('opened'), item('fresh', { addedAt: ago(5) }), item('manual'), item('viewed'));
  const r = run(m, [user({ progress: { opened: { timestamp: 1, duration: 100, updatedAt: isoAgo(70) } } })], {
    isSubscriptionItem: (i) => i.id !== 'manual',
    viewCounts: { viewed: 2 },
  });
  assert.deepStrictEqual(ids(r.stale_subscriptions), ['stale']);
});

test('(b) another account opening it makes it not never-opened', () => {
  const m = lib(item('s'));
  const other = user({ userId: 'u2', progress: { s: { timestamp: 2, duration: 100, updatedAt: isoAgo(70) } } });
  assert.deepStrictEqual(run(m, [user(), other], { isSubscriptionItem: () => true }).stale_subscriptions, []);
});

test('(c) largest: top 20 by size of the old never-opened, biggest first, none in an earlier group', () => {
  const list = [];
  for (let n = 1; n <= 25; n += 1) list.push(item(`f${String(n).padStart(2, '0')}`, { size: n * 10, filePath: `/lib/f${n}/f${n}.mp4` }));
  const r = run(lib(...list));
  assert.strictEqual(r.largest.length, LARGEST_LIMIT);
  assert.strictEqual(r.largest[0].id, 'f25');
  assert.strictEqual(r.largest[19].id, 'f06');
  const sub = run(lib(...list), [user()], { isSubscriptionItem: (i) => i.id === 'f25' });
  assert.ok(!ids(sub.largest).includes('f25'), 'an item lists once: in (b), not again in (c)');
  assert.deepStrictEqual(ids(sub.stale_subscriptions), ['f25']);
});

test('(c) a fresh download is not a big-file suggestion', () => {
  assert.deepStrictEqual(run(lib(item('new', { addedAt: ago(2) }))).largest, []);
});

test('(d) duplicates: same source id keeps the OLDEST, suggests the newer ones', () => {
  const m = lib(
    item('a', { youtubeId: 'AAAAAAAAAAA', addedAt: ago(200), filePath: '/lib/a/x.mp4' }),
    item('b', { youtubeId: 'AAAAAAAAAAA', addedAt: ago(100), filePath: '/lib/b/x.mp4' }),
    item('c', { youtubeId: 'AAAAAAAAAAA', addedAt: ago(50), filePath: '/lib/c/x.mp4' }),
    item('solo', { youtubeId: 'BBBBBBBBBBB' }),
  );
  const d = run(m, [user()], { viewCounts: { a: 1, b: 1, c: 1 } }).duplicates;
  assert.deepStrictEqual(ids(d).sort(), ['b', 'c']);
  assert.ok(d.every((x) => x.keepId === 'a'));
});

test('(d) never the only copy: a lone item and a group of one list nothing', () => {
  assert.deepStrictEqual(run(lib(item('only', { youtubeId: 'CCCCCCCCCCC' }))).duplicates, []);
});

test('(d) the kept oldest copy is never listed even when it is hidden from the viewer', () => {
  const m = lib(
    item('old', { youtubeId: 'DDDDDDDDDDD', addedAt: ago(300) }),
    item('new', { youtubeId: 'DDDDDDDDDDD', addedAt: ago(100) }),
  );
  const r = run(m, [user()], { isVisible: (i) => i.id !== 'old' });
  assert.deepStrictEqual(ids(r.duplicates), ['new']);
  assert.ok(!ids(r.duplicates).includes('old'));
});

test('(d) with no source id: same size AND duration within one second; a two-second gap is not a duplicate', () => {
  const m = lib(
    item('p', { size: 555, duration: 100, addedAt: ago(90) }),
    item('q', { size: 555, duration: 100.9, addedAt: ago(80) }),
    item('r', { size: 555, duration: 103, addedAt: ago(70) }),
    item('s', { size: 556, duration: 100, addedAt: ago(60) }),
  );
  assert.deepStrictEqual(ids(run(m).duplicates), ['q']);
});

test('(d) a liked newer copy is protected: it is not suggested', () => {
  const m = lib(
    item('old', { youtubeId: 'EEEEEEEEEEE', addedAt: ago(300) }),
    item('new', { youtubeId: 'EEEEEEEEEEE', addedAt: ago(100) }),
  );
  assert.deepStrictEqual(run(m, [user({ liked: ['new'] })]).duplicates, []);
});

test('visibility: a restricted item is in no group', () => {
  const m = lib(item('hid'), item('shown'));
  const r = run(m, [user({ watched: { hid: isoAgo(50), shown: isoAgo(50) } })], { isVisible: (i) => i.id !== 'hid' });
  assert.deepStrictEqual(ids(r.watched), ['shown']);
  assert.ok(!ids(r.largest).includes('hid'));
});

test('items carry no file path; reasons are plain language', () => {
  const r = run(lib(item('a')), [user({ watched: { a: isoAgo(50) } })]);
  assert.strictEqual(r.watched[0].filePath, undefined);
  assert.strictEqual(r.watched[0].reason, 'Watched to the end');
  assert.strictEqual(typeof r.watched[0].size, 'number');
});
