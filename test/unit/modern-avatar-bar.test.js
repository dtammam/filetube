'use strict';

// [UNIT] v1.84 T4 - selectRecentUploaderChannels (common.js), the pure selection
// behind the Modern-mode mobile avatar bar: the SUBSCRIBED channels that most
// recently uploaded, newest-first, capped. Binds every axis (sub-only, recency
// floor, order, cap, no-mutate, non-array) so a one-sided assertion can't hide a
// surviving mutant (the v1.83 symmetry lesson).

const { test } = require('node:test');
const assert = require('node:assert');
const { selectRecentUploaderChannels } = require('../../public/js/common.js');

const ch = (over) => Object.assign({ folder: 'f', name: 'n', avatarUrl: null, latestAddedAt: 1, isSub: true }, over);

test('keeps only subscribed channels', () => {
  const out = selectRecentUploaderChannels([
    ch({ folder: 'sub', isSub: true }),
    ch({ folder: 'nonsub', isSub: false }),
  ], 12);
  assert.deepStrictEqual(out.map((c) => c.folder), ['sub'], 'a non-subscription is never in the bar');
});

test('drops channels with no real recency (latestAddedAt <= 0 or non-number)', () => {
  const out = selectRecentUploaderChannels([
    ch({ folder: 'ok', latestAddedAt: 5 }),
    ch({ folder: 'zero', latestAddedAt: 0 }),
    ch({ folder: 'nan', latestAddedAt: null }),
  ], 12);
  assert.deepStrictEqual(out.map((c) => c.folder), ['ok']);
});

test('orders newest-first by latestAddedAt', () => {
  const out = selectRecentUploaderChannels([
    ch({ folder: 'old', latestAddedAt: 100 }),
    ch({ folder: 'new', latestAddedAt: 300 }),
    ch({ folder: 'mid', latestAddedAt: 200 }),
  ], 12);
  assert.deepStrictEqual(out.map((c) => c.folder), ['new', 'mid', 'old']);
});

test('caps to N and does NOT mutate the input array', () => {
  const input = [];
  for (let i = 0; i < 20; i++) input.push(ch({ folder: `c${i}`, latestAddedAt: i + 1 }));
  const snapshot = input.map((c) => c.folder);
  const out = selectRecentUploaderChannels(input, 5);
  assert.strictEqual(out.length, 5, 'capped at 5');
  assert.deepStrictEqual(out.map((c) => c.folder), ['c19', 'c18', 'c17', 'c16', 'c15'], 'the 5 newest');
  assert.deepStrictEqual(input.map((c) => c.folder), snapshot, 'the input order is untouched (no in-place sort)');
});

test('defaults + robustness: cap absent -> 12; a non-array -> []', () => {
  assert.strictEqual(selectRecentUploaderChannels(null).length, 0);
  assert.strictEqual(selectRecentUploaderChannels(undefined).length, 0);
  const many = [];
  for (let i = 0; i < 30; i++) many.push(ch({ folder: `c${i}`, latestAddedAt: i + 1 }));
  assert.strictEqual(selectRecentUploaderChannels(many).length, 12, 'default cap 12');
});
