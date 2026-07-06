'use strict';

// [UNIT] lib/ytdlp/activity.js -- the ephemeral (non-persisted) in-process
// FR-E activity map: set/merge, getSnapshot, clear, TTL-prune. All timestamps
// are driven via the injected `now` parameter (never real `Date.now()`/real
// timers) so every assertion here is fully deterministic.

const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const activity = require('../../lib/ytdlp/activity');

beforeEach(() => {
  activity.resetForTests();
});

// ---- setSubscription / setOneShot: create + shallow-merge ----------------

test('setSubscription creates a new entry and stamps updatedAt from the injected now', () => {
  const t0 = Date.UTC(2026, 0, 1, 0, 0, 0);
  const entry = activity.setSubscription('sub1', { state: 'queued' }, t0);
  assert.equal(entry.state, 'queued');
  assert.equal(entry.updatedAt, new Date(t0).toISOString());
});

test('setSubscription shallow-merges a subsequent patch, preserving untouched fields', () => {
  const t0 = Date.UTC(2026, 0, 1, 0, 0, 0);
  const t1 = t0 + 1000;
  activity.setSubscription('sub1', { state: 'listing', title: null }, t0);
  const merged = activity.setSubscription('sub1', { state: 'downloading', percent: 12.5 }, t1);
  assert.equal(merged.state, 'downloading');
  assert.equal(merged.percent, 12.5);
  assert.equal(merged.title, null, 'a field not present in the second patch must be preserved');
  assert.equal(merged.updatedAt, new Date(t1).toISOString());
});

test('setOneShot creates and merges independently of the subscriptions namespace', () => {
  const t0 = Date.UTC(2026, 0, 1, 0, 0, 0);
  activity.setOneShot('job1', { state: 'downloading', total: 1, index: 1, label: 'One-Off' }, t0);
  const snap = activity.getSnapshot(t0);
  assert.ok(snap.oneShots.job1);
  assert.equal(snap.oneShots.job1.state, 'downloading');
  assert.equal(Object.keys(snap.subscriptions).length, 0);
});

test('setSubscription/setOneShot return null for a non-string/empty id rather than throwing', () => {
  assert.doesNotThrow(() => activity.setSubscription(null, { state: 'queued' }));
  assert.equal(activity.setSubscription(null, { state: 'queued' }), null);
  assert.equal(activity.setSubscription('', { state: 'queued' }), null);
  assert.equal(activity.setOneShot(undefined, { state: 'queued' }), null);
});

test('setSubscription/setOneShot tolerate a non-object patch (treated as empty) without throwing', () => {
  assert.doesNotThrow(() => activity.setSubscription('sub1', null));
  assert.doesNotThrow(() => activity.setSubscription('sub1', 'not-an-object'));
  const entry = activity.setSubscription('sub1', undefined, 0);
  assert.equal(entry.updatedAt, new Date(0).toISOString());
});

test('setSubscription returns a COPY -- mutating the returned object never affects the live map', () => {
  const t0 = 0;
  const entry = activity.setSubscription('sub1', { state: 'queued' }, t0);
  entry.state = 'tampered';
  const snap = activity.getSnapshot(t0);
  assert.equal(snap.subscriptions.sub1.state, 'queued');
});

// ---- getSnapshot: plain-object copy, independent namespaces ---------------

test('getSnapshot returns independent copies -- mutating the snapshot never affects the live map', () => {
  const t0 = 0;
  activity.setSubscription('sub1', { state: 'downloading', percent: 10 }, t0);
  const snap1 = activity.getSnapshot(t0);
  snap1.subscriptions.sub1.percent = 999;
  const snap2 = activity.getSnapshot(t0);
  assert.equal(snap2.subscriptions.sub1.percent, 10);
});

test('getSnapshot on an empty map returns empty namespaces, never throws/undefined', () => {
  const snap = activity.getSnapshot(0);
  assert.deepEqual(snap, { subscriptions: {}, oneShots: {} });
});

// ---- clearSubscription -----------------------------------------------------

test('clearSubscription removes a subscription entry entirely (subsequent snapshot omits it)', () => {
  const t0 = 0;
  activity.setSubscription('sub1', { state: 'error' }, t0);
  assert.equal(activity.clearSubscription('sub1'), true);
  const snap = activity.getSnapshot(t0);
  assert.equal(snap.subscriptions.sub1, undefined);
});

test('clearSubscription on an unknown/never-set id returns false, never throws', () => {
  assert.equal(activity.clearSubscription('never-existed'), false);
  assert.doesNotThrow(() => activity.clearSubscription(null));
  assert.equal(activity.clearSubscription(null), false);
});

// ---- TTL-prune: terminal one-shots older than ONESHOT_TTL_MS are dropped --

test('getSnapshot prunes a terminal (done) one-shot entry once it is older than ONESHOT_TTL_MS', () => {
  const t0 = 0;
  activity.setOneShot('job1', { state: 'done', percent: 100 }, t0);
  const justUnderTtl = activity.getSnapshot(t0 + activity.ONESHOT_TTL_MS - 1);
  assert.ok(justUnderTtl.oneShots.job1, 'must still be present just under the TTL');

  const pastTtl = activity.getSnapshot(t0 + activity.ONESHOT_TTL_MS + 1);
  assert.equal(pastTtl.oneShots.job1, undefined, 'must be pruned once past the TTL');
});

test('getSnapshot prunes a terminal (error) one-shot entry the same way as done', () => {
  const t0 = 0;
  activity.setOneShot('job-err', { state: 'error' }, t0);
  const pastTtl = activity.getSnapshot(t0 + activity.ONESHOT_TTL_MS + 1);
  assert.equal(pastTtl.oneShots['job-err'], undefined);
});

test('getSnapshot NEVER prunes a still-active (non-terminal) one-shot entry, no matter how old', () => {
  const t0 = 0;
  activity.setOneShot('job-active', { state: 'downloading', percent: 40 }, t0);
  const snap = activity.getSnapshot(t0 + activity.ONESHOT_TTL_MS * 10);
  assert.ok(snap.oneShots['job-active'], 'an in-flight one-shot must never be pruned regardless of age');
});

test('getSnapshot never prunes subscription entries regardless of terminal state or age', () => {
  const t0 = 0;
  activity.setSubscription('sub-done', { state: 'done', percent: 100 }, t0);
  const snap = activity.getSnapshot(t0 + activity.ONESHOT_TTL_MS * 10);
  assert.ok(snap.subscriptions['sub-done'], 'subscription entries are never TTL-pruned, only one-shots are');
});

test('a pruned one-shot is removed from the underlying live map, not just hidden from one snapshot', () => {
  const t0 = 0;
  activity.setOneShot('job1', { state: 'done' }, t0);
  activity.getSnapshot(t0 + activity.ONESHOT_TTL_MS + 1); // triggers the prune
  // Re-querying at the ORIGINAL timestamp must not resurrect it -- proves the
  // prune actually deleted it from `state.oneShots`, not just filtered it out
  // of that one snapshot's response.
  const snap = activity.getSnapshot(t0);
  assert.equal(snap.oneShots.job1, undefined);
});

// ---- resetForTests ----------------------------------------------------------

test('resetForTests clears both namespaces entirely', () => {
  activity.setSubscription('sub1', { state: 'downloading' }, 0);
  activity.setOneShot('job1', { state: 'downloading' }, 0);
  activity.resetForTests();
  const snap = activity.getSnapshot(0);
  assert.deepEqual(snap, { subscriptions: {}, oneShots: {} });
});

// ---- deterministic via injected now (function form) ------------------------

test('a now() function is accepted in addition to a raw ms timestamp', () => {
  let fakeNow = 5000;
  const entry = activity.setSubscription('sub1', { state: 'queued' }, () => fakeNow);
  assert.equal(entry.updatedAt, new Date(5000).toISOString());
  fakeNow = 6000;
  const merged = activity.setSubscription('sub1', { state: 'listing' }, () => fakeNow);
  assert.equal(merged.updatedAt, new Date(6000).toISOString());
});

test('omitting now falls back to the real clock without throwing', () => {
  assert.doesNotThrow(() => activity.setSubscription('sub1', { state: 'queued' }));
  const entry = activity.setSubscription('sub1', { state: 'queued' });
  assert.ok(typeof entry.updatedAt === 'string' && entry.updatedAt.length > 0);
});
