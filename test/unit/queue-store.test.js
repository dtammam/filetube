'use strict';

// [UNIT] v1.63 playback queue - the pure reducers (lib/queue/store.js).
// These are the single source of queue semantics (Dean's rulings 2/3/4/6):
// pointer = now-playing, next = the entry AFTER it, "Play next" jumps the
// line, remove-now-playing steps the pointer BACK (never forward - forward
// would silently skip an unplayed item), reorder is a strict uid bijection.

const { test } = require('node:test');
const assert = require('node:assert');
const q = require('../../lib/queue/store.js');

const st = (entries, pointerUid = null) => ({ entries, pointerUid });
const uids = (s) => s.entries.map((e) => e.uid);

function seed(n, pointerAt = null) {
  const entries = [];
  for (let i = 0; i < n; i++) entries.push({ uid: `u${i}`, mediaId: `m${i}` });
  return st(entries, pointerAt === null ? null : `u${pointerAt}`);
}

test('normalize: drops malformed entries and DANGLING pointers (the media-delete carrier can orphan one)', () => {
  const s = q.normalize({ entries: [{ uid: 'a', mediaId: 'x' }, { uid: '', mediaId: 'y' }, null, { uid: 'b' }], pointerUid: 'gone' });
  assert.deepEqual(uids(s), ['a']);
  assert.equal(s.pointerUid, null, 'dangling pointer -> not-started semantics');
});

test('reduceAdd end: appends; same media twice is LEGAL (uid identity)', () => {
  let r = q.reduceAdd(seed(0), 'm-dup');
  r = q.reduceAdd(r.state, 'm-dup');
  assert.equal(r.state.entries.length, 2);
  assert.notEqual(r.state.entries[0].uid, r.state.entries[1].uid);
  assert.equal(r.state.entries[0].mediaId, r.state.entries[1].mediaId);
});

test('reduceAdd next: inserts after the now-playing entry; at the FRONT when not started', () => {
  const started = q.reduceAdd(seed(3, 1), 'mX', 'next');
  assert.equal(started.state.entries[2].mediaId, 'mX', 'directly after the pointer (index 1)');
  const notStarted = q.reduceAdd(seed(3, null), 'mY', 'next');
  assert.equal(notStarted.state.entries[0].mediaId, 'mY', 'front of a not-started queue');
});

test('reduceAdd: refuses past the cap, loudly', () => {
  const full = seed(q.QUEUE_CAP);
  const r = q.reduceAdd(full, 'overflow');
  assert.equal(r.changed, false);
  assert.equal(r.error, 'queue-full');
  assert.equal(r.state.entries.length, q.QUEUE_CAP);
});

test('reduceRemove: non-pointer entry leaves the pointer alone', () => {
  const r = q.reduceRemove(seed(3, 1), 'u2');
  assert.deepEqual(uids(r.state), ['u0', 'u1']);
  assert.equal(r.state.pointerUid, 'u1');
});

test('reduceRemove: removing NOW-PLAYING steps the pointer BACK so next still lands on the successor', () => {
  const r = q.reduceRemove(seed(3, 1), 'u1');
  assert.equal(r.state.pointerUid, 'u0');
  assert.equal(q.nextEntry(r.state).uid, 'u2', 'the removed entry\'s successor is still up next');
  const atFront = q.reduceRemove(seed(3, 0), 'u0');
  assert.equal(atFront.state.pointerUid, null, 'removing the playing head -> not-started; u1 is next');
  assert.equal(q.nextEntry(atFront.state).uid, 'u1');
});

test('reduceRemove: unknown uid is a no-op, not an error mutation', () => {
  const r = q.reduceRemove(seed(2, null), 'nope');
  assert.equal(r.changed, false);
  assert.equal(r.state.entries.length, 2);
});

test('reduceReorder: strict uid bijection - drops and inventions are REFUSED', () => {
  const ok = q.reduceReorder(seed(3, 1), ['u2', 'u0', 'u1']);
  assert.equal(ok.changed, true);
  assert.deepEqual(uids(ok.state), ['u2', 'u0', 'u1']);
  assert.equal(ok.state.pointerUid, 'u1', 'pointer follows its entry, not its index');
  for (const bad of [['u0', 'u1'], ['u0', 'u1', 'u2', 'u3'], ['u0', 'u1', 'ghost']]) {
    const r = q.reduceReorder(seed(3, 1), bad);
    assert.equal(r.changed, false, 'refused: ' + JSON.stringify(bad));
    assert.equal(r.error, 'order-mismatch');
    assert.deepEqual(uids(r.state), ['u0', 'u1', 'u2'], 'state untouched');
  }
});

test('reduceSetPointer: entry-bound; null restarts; unknown uid refused', () => {
  assert.equal(q.reduceSetPointer(seed(3), 'u2').state.pointerUid, 'u2');
  assert.equal(q.reduceSetPointer(seed(3, 2), null).state.pointerUid, null);
  const r = q.reduceSetPointer(seed(3), 'ghost');
  assert.equal(r.changed, false);
  assert.equal(r.error, 'no-such-entry');
});

test('nextEntry/prevEntry: the advancement contract (Dean ruling 2)', () => {
  const s = seed(3, 1);
  assert.equal(q.nextEntry(s).uid, 'u2');
  assert.equal(q.prevEntry(s).uid, 'u0');
  assert.equal(q.nextEntry(seed(3, 2)), null, 'exhausted queue -> null (normal autoplay resumes)');
  assert.equal(q.nextEntry(seed(3, null)).uid, 'u0', 'not-started -> the head');
  assert.equal(q.prevEntry(seed(3, 0)), null);
  assert.equal(q.nextEntry(seed(0)), null, 'empty queue');
});

test('reduceClear: everything gone, pointer gone', () => {
  const r = q.reduceClear();
  assert.deepEqual(r.state, { entries: [], pointerUid: null });
});
