'use strict';

// [UNIT] v1.386.0 speed pass (W3): lib/music/stations.js remembers which styles a FROZEN track (the music routes'
// shared snapshot) matches. Binds: the stations built over frozen tracks equal the ones built over plain copies
// (the memo changes nothing), a second build reuses it and still agrees, and a CHANGED row (a new frozen object, as
// a snapshot rebuild hands out) is matched afresh - the memo can never answer for text it did not see.

const { test } = require('node:test');
const assert = require('node:assert');
const stations = require('../../lib/music/stations');

const WORDS = ['lofi beats', 'Synthwave Drive', 'ambient chill', 'jazz night', 'rock anthem', 'retrowave', 'piano', 'lo fi study'];
function list(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({ id: 't' + i, title: WORDS[i % WORDS.length] + ' ' + i, album: WORDS[(i * 3) % WORDS.length], artist: 'A' + (i % 7),
      genre: ['Electronic', 'Jazz', 'Rock', 'Lofi'][i % 4], folderName: 'F' + (i % 5), addedAt: new Date(1780000000000 + i * 1000).toISOString(), year: 1990 + (i % 30) });
  }
  return out;
}
const deepFreeze = (o) => { Object.freeze(o); for (const k of Object.keys(o)) if (o[k] && typeof o[k] === 'object') deepFreeze(o[k]); return o; };
const strip = (xs) => xs.map((x) => ({ key: x.key, members: x.members.map((t) => t.id) }));
const user = { liked: new Set(), progress: {}, plays: null, custom: [], hidden: new Set() };

test('stations over frozen tracks (memoised) equal stations over plain copies, on every build', () => {
  const plain = list(400);
  const frozen = plain.map((t) => deepFreeze(Object.assign({}, t)));
  const expect = strip(stations.buildStations(plain, user));
  assert.ok(expect.some((s) => s.key.startsWith('s:') && s.members.length), 'style stations were built (non-vacuous)');
  assert.deepStrictEqual(strip(stations.buildStations(frozen, user)), expect, 'first build (fills the memo)');
  assert.deepStrictEqual(strip(stations.buildStations(frozen, user)), expect, 'second build (reads the memo)');
});

test('a changed row is a new object and is matched on its NEW text', () => {
  const frozen = list(200).map((t) => deepFreeze(Object.assign({}, t)));
  stations.buildStations(frozen, user); // memo filled
  const lofiKey = 's:lofi';
  const before = strip(stations.buildStations(frozen, user)).find((s) => s.key === lofiKey);
  assert.ok(before && before.members.includes('t0'), 't0 ("lofi beats 0") is a Lofi member');
  // the row for t0 changes to text no style matches: a snapshot rebuild hands out a NEW frozen object
  const next = frozen.slice();
  next[0] = deepFreeze(Object.assign({}, frozen[0], { title: 'plain words 0', album: 'nothing', genre: 'Classical', folderName: 'Z' }));
  const after = strip(stations.buildStations(next, user)).find((s) => s.key === lofiKey);
  assert.ok(!after.members.includes('t0'), 'the new object is matched afresh');
});

test('topN equals sort-then-slice for a total order (ties on the date broken by id), at every size', () => {
  const COLLATE = new Intl.Collator(undefined).compare;
  const cmp = (a, b) => COLLATE(String(b.addedAt), String(a.addedAt)) || COLLATE(String(a.id), String(b.id));
  const xs = [];
  for (let i = 0; i < 500; i++) xs.push({ id: 'k' + ((i * 7919) % 500), addedAt: '2026-0' + (1 + (i % 9)) + '-01T00:00:00Z' }); // many equal dates
  for (const n of [0, 1, 5, 50, 499, 500, 800]) {
    assert.deepStrictEqual(stations.topN(xs, cmp, n).map((x) => x.id), xs.slice().sort(cmp).slice(0, n).map((x) => x.id), 'n=' + n);
  }
});

test('a PLAIN (unfrozen) track edited in place between builds is matched on its new text (only frozen tracks are memoised)', () => {
  const plain = list(200);
  const lofi = (xs) => strip(stations.buildStations(xs, user)).find((s) => s.key === 's:lofi');
  assert.ok(lofi(plain).members.includes('t0'));
  Object.assign(plain[0], { title: 'plain words 0', album: 'nothing', genre: 'Classical', folderName: 'Z' });
  assert.ok(!lofi(plain).members.includes('t0'), 'the edit is seen');
});

test('the Recently added station: newest first, a tie on the date broken by id ascending (the call site\'s comparator, not just topN)', () => {
  const same = '2026-05-01T00:00:00.000Z';
  const xs = [];
  for (let i = 0; i < 260; i++) xs.push({ id: 'r' + String(259 - i).padStart(3, '0'), title: 'Song ' + i, artist: 'A', album: 'Al', genre: 'Rock', addedAt: i < 5 ? '2026-06-0' + (i + 1) + 'T00:00:00.000Z' : same });
  const recent = stations.buildStations(xs, user).find((s) => s.key === 'recent');
  assert.ok(recent, 'the Recently added station exists');
  // the five dated ones lead, newest first: i = 4 (June 5th, id r255) down to i = 0 (June 1st, id r259)
  assert.deepStrictEqual(recent.members.slice(0, 5).map((t) => t.id), ['r255', 'r256', 'r257', 'r258', 'r259']);
  const tied = recent.members.slice(5).map((t) => t.id);
  assert.deepStrictEqual(tied, tied.slice().sort(), 'the tied rest run by id ascending');
  assert.strictEqual(tied[0], 'r000', 'the smallest id leads the tie (a flipped tiebreak would start at the largest)');
});
