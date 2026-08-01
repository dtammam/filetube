'use strict';

// [UNIT] v1.63 - the playback queue chrome's pure client decisions
// (public/js/common.js): button-existence predicate, badge formatter, and
// the entry -> row-model mappers incl. the played/playing ordered pass
// (ruling 6: rows before the pointer dim as played, the pointer row
// highlights, rows after are neither). The DOM injector is the usual
// untested-by-necessity thin shell; integration + Dean's device probes
// cover it. Fixture spellings divergent per v1.41.9.

const { test } = require('node:test');
const assert = require('node:assert');
const {
  shouldShowQueueButton,
  formatQueueBadge,
  buildQueueRowModel,
  buildQueueRowModels,
} = require('../../public/js/common.js');

const entry = (uid, over = {}) => ({
  uid, mediaId: `mëdia-${uid}`,
  item: { title: `Tïtle ${uid}`, channelName: `Chän ${uid}`, folderName: 'Föld', hasThumbnail: true, ...over },
});

test('shouldShowQueueButton: exists ONLY while entries do (ruling 4)', () => {
  assert.equal(shouldShowQueueButton({ entries: [entry('a')] }), true);
  assert.equal(shouldShowQueueButton({ entries: [] }), false);
  assert.equal(shouldShowQueueButton({}), false);
  assert.equal(shouldShowQueueButton(null), false);
  assert.equal(shouldShowQueueButton({ entries: 'nope' }), false);
});

test('formatQueueBadge: empty at zero/garbage, 20+ cap (the bell convention)', () => {
  assert.equal(formatQueueBadge(0), '');
  assert.equal(formatQueueBadge(3), '3');
  assert.equal(formatQueueBadge(20), '20');
  assert.equal(formatQueueBadge(21), '20+');
  assert.equal(formatQueueBadge('4'), '');
  assert.equal(formatQueueBadge(-1), '');
});

test('buildQueueRowModel: field ladder (channelName > folderName > Library), thumb only when hasThumbnail, null on malformed', () => {
  const m = buildQueueRowModel(entry('ä1'), null);
  assert.equal(m.href, '/watch.html?v=mëdia-ä1');
  assert.equal(m.channelLabel, 'Chän ä1');
  assert.equal(m.thumbnailUrl, '/thumbnail/mëdia-ä1');
  const folded = buildQueueRowModel(entry('b2', { channelName: '  ' }), null);
  assert.equal(folded.channelLabel, 'Föld', 'whitespace channelName falls to folderName');
  const bare = buildQueueRowModel(entry('c3', { channelName: '', folderName: '', hasThumbnail: false }), null);
  assert.equal(bare.channelLabel, 'Library');
  assert.equal(bare.thumbnailUrl, null);
  assert.equal(buildQueueRowModel({ uid: 'x' }, null), null, 'item-less entries drop');
  assert.equal(buildQueueRowModel({ uid: '', item: {} }, null), null);
  assert.equal(buildQueueRowModel(null, null), null);
});

test('buildQueueRowModels: the ordered played/playing pass (ruling 6)', () => {
  const q = { entries: [entry('p1'), entry('p2'), entry('p3')], pointerUid: 'p2' };
  const [a, b, c] = buildQueueRowModels(q);
  assert.deepEqual([a.played, a.playing], [true, false], 'before the pointer: played');
  assert.deepEqual([b.played, b.playing], [false, true], 'the pointer row: playing');
  assert.deepEqual([c.played, c.playing], [false, false], 'after: neither');
});

test('buildQueueRowModels: no pointer = not-started (nothing played, nothing playing)', () => {
  const models = buildQueueRowModels({ entries: [entry('n1'), entry('n2')], pointerUid: null });
  assert.ok(models.every((m) => !m.played && !m.playing));
});

test('buildQueueRowModels: a DROPPED pointer row (item-less) still ends the played span', () => {
  const q = { entries: [entry('d1'), { uid: 'd2', mediaId: 'gone' }, entry('d3')], pointerUid: 'd2' };
  const models = buildQueueRowModels(q);
  assert.equal(models.length, 2, 'the item-less row itself drops');
  assert.deepEqual(models.map((m) => m.played), [true, false], 'd1 played, d3 after the (dropped) pointer');
});
