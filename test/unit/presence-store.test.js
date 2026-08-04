'use strict';

// [UNIT] v1.78 device handoff - the presence store (lib/presence/store.js).
// This is where the liveness SEMANTICS are proven: the two TTLs (a playing
// entry decays to paused when pings stop; a stopped entry expires out of
// the linger window), self-exclusion, cross-user isolation, the per-user
// device cap, the label sanitizer, and the out-of-order guard that keeps a
// late pause beacon from clobbering a newer play ping.
//
// The clock is INJECTED throughout - every TTL assertion below advances a
// fake `now`, so the suite proves 30-minute behavior without sleeping and
// without a timer that could leak into another test file.

const { test } = require('node:test');
const assert = require('node:assert');
const P = require('../../lib/presence/store.js');

// A store whose clock we drive by hand. `tick(ms)` advances it.
function fakeClock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    tick: (ms) => { t += ms; return t; },
    set: (v) => { t = v; return t; },
  };
}

function mk(opts = {}) {
  const clock = fakeClock();
  const store = P.createPresenceStore({ now: clock.now, ...opts });
  return { store, clock };
}

const ping = (over = {}) => ({
  deviceId: 'dev-a',
  deviceLabel: 'iPhone',
  mediaId: 'media-1',
  kind: 'media',
  position: 754,
  duration: 2706,
  ...over,
});

test('record + readOther: another device\'s playback comes back with state playing (AC1)', () => {
  const { store } = mk();
  assert.equal(store.record(1, ping()), true);

  const seen = store.readOther(1, 'dev-b');
  assert.ok(seen, 'device B must see device A');
  assert.equal(seen.deviceLabel, 'iPhone');
  assert.equal(seen.mediaId, 'media-1');
  assert.equal(seen.kind, 'media');
  assert.equal(seen.position, 754);
  assert.equal(seen.duration, 2706);
  assert.equal(seen.state, 'playing');
  assert.equal(seen.ageSeconds, 0);
});

test('self-exclusion: a device is NEVER offered its own playback (AC7)', () => {
  const { store } = mk();
  store.record(1, ping());
  assert.equal(store.readOther(1, 'dev-a'), null, 'dev-a asking must not see dev-a');
  assert.ok(store.readOther(1, 'dev-b'), 'a different device still sees it');
});

test('self-exclusion: a blank/absent requesting id excludes nothing (it cannot identify itself)', () => {
  const { store } = mk();
  store.record(1, ping());
  assert.ok(store.readOther(1, ''), 'blank id -> no exclusion');
  assert.ok(store.readOther(1, undefined), 'absent id -> no exclusion');
});

test('cross-user isolation: user B never sees user A\'s presence (AC9)', () => {
  const { store } = mk();
  store.record(1, ping());
  assert.equal(store.readOther(2, 'dev-b'), null, 'user 2 must see nothing');
  assert.ok(store.readOther(1, 'dev-b'), 'user 1 still sees its own device');
});

test('most-recent wins when several other devices are active (ruling 7: no device list)', () => {
  const { store, clock } = mk();
  store.record(1, ping({ deviceId: 'dev-a', deviceLabel: 'iPhone', mediaId: 'm-a' }));
  clock.tick(1000);
  store.record(1, ping({ deviceId: 'dev-b', deviceLabel: 'iPad', mediaId: 'm-b' }));

  const seen = store.readOther(1, 'dev-c');
  assert.equal(seen.deviceLabel, 'iPad', 'the most recently seen device is the one surfaced');
  assert.equal(seen.mediaId, 'm-b');
});

test('ACTIVE_TTL: pings stop with NO beacon -> decays to paused, still offered (AC3)', () => {
  const { store, clock } = mk();
  store.record(1, ping());

  clock.tick(P.ACTIVE_TTL_MS); // exactly at the boundary: still playing
  assert.equal(store.readOther(1, 'dev-b').state, 'playing');

  clock.tick(1); // one ms past it
  const decayed = store.readOther(1, 'dev-b');
  assert.equal(decayed.state, 'paused', 'an app killed mid-playback must not read as still playing');
  assert.ok(decayed, 'and it is STILL offered - decay is not expiry');
});

test('explicit pause beacon flips state immediately, with the final position (AC2)', () => {
  const { store, clock } = mk();
  store.record(1, ping({ position: 100 }));
  clock.tick(500);
  store.record(1, ping({ position: 512, state: 'paused' }));

  const seen = store.readOther(1, 'dev-b');
  assert.equal(seen.state, 'paused', 'no waiting out ACTIVE_TTL when the device says so');
  assert.equal(seen.position, 512, 'the beacon\'s final position is what the card shows');
});

test('LINGER_TTL: a paused entry survives the whole window, then expires (AC2)', () => {
  const { store, clock } = mk();
  store.record(1, ping({ state: 'paused' }));

  clock.tick(P.LINGER_TTL_MS); // at the boundary: still there
  assert.ok(store.readOther(1, 'dev-b'), 'the sit-down-at-the-PC case must still find it');

  clock.tick(1);
  assert.equal(store.readOther(1, 'dev-b'), null, 'past the window it is gone, cleanly (AC8/#9)');
  assert.equal(store.userCount(), 0, 'and the user\'s map is pruned away with it - no leak');
});

test('ageSeconds is server-computed and grows with the clock (the "18 min ago" line)', () => {
  const { store, clock } = mk();
  store.record(1, ping({ state: 'paused' }));
  clock.tick(18 * 60 * 1000);
  assert.equal(store.readOther(1, 'dev-b').ageSeconds, 18 * 60);
});

test('DEVICE CAP: a ninth device evicts the least-recently-seen, map stays bounded (#1)', () => {
  const { store, clock } = mk();
  for (let i = 0; i < P.DEVICE_CAP; i++) {
    clock.tick(1000);
    store.record(1, ping({ deviceId: `dev-${i}`, mediaId: `m-${i}` }));
  }
  assert.equal(store.deviceCount(1), P.DEVICE_CAP);

  clock.tick(1000);
  store.record(1, ping({ deviceId: 'dev-new', mediaId: 'm-new' }));
  assert.equal(store.deviceCount(1), P.DEVICE_CAP, 'still capped');

  // dev-0 had the oldest lastSeenAt, so it is the one that went - proven by
  // forget() finding nothing to forget. Every device NEWER than it survived.
  assert.equal(store.forget(1, 'dev-0'), false, 'the least-recently-seen device was evicted');
  for (let i = 1; i < P.DEVICE_CAP; i++) {
    assert.equal(store.forget(1, `dev-${i}`), true, `dev-${i} must have survived the eviction`);
  }
  assert.equal(store.forget(1, 'dev-new'), true, 'and the new arrival is in');
});

test('DEVICE CAP: a thousand incognito UUIDs cannot grow the map past the cap (#1)', () => {
  const { store, clock } = mk();
  for (let i = 0; i < 1000; i++) {
    clock.tick(10);
    store.record(1, ping({ deviceId: `incognito-${i}` }));
  }
  assert.equal(store.deviceCount(1), P.DEVICE_CAP, 'bounded regardless of how many ids are minted');
  assert.equal(store.userCount(), 1);
});

test('DEVICE CAP: an EXISTING device updating in place never evicts anyone', () => {
  const { store, clock } = mk();
  for (let i = 0; i < P.DEVICE_CAP; i++) {
    clock.tick(1000);
    store.record(1, ping({ deviceId: `dev-${i}` }));
  }
  for (let i = 0; i < 50; i++) {
    clock.tick(1000);
    store.record(1, ping({ deviceId: 'dev-3', position: i }));
  }
  assert.equal(store.deviceCount(1), P.DEVICE_CAP, 'no churn from in-place updates');
  assert.equal(store.readOther(1, 'dev-x').deviceId, 'dev-3');
});

test('ORDERING: a stale pause beacon must NOT clobber a newer play ping (#6)', () => {
  const { store } = mk();
  // The real race: the ping was SENT first but arrives second, because the
  // beacon took a faster path. The client-supplied `at` is what orders them.
  store.record(1, ping({ at: 5000, position: 100, state: 'paused' })); // beacon, sent later, arrives first
  const applied = store.record(1, ping({ at: 4000, position: 96 })); // the older ping, arriving late

  assert.equal(applied, false, 'the older event is refused');
  const seen = store.readOther(1, 'dev-b');
  assert.equal(seen.state, 'paused', 'state stays where the NEWER event put it');
  assert.equal(seen.position, 100);
});

test('ORDERING: an equal token still lands (coarse client clocks must not deadlock)', () => {
  const { store } = mk();
  store.record(1, ping({ at: 5000, position: 10 }));
  assert.equal(store.record(1, ping({ at: 5000, position: 20 })), true);
  assert.equal(store.readOther(1, 'dev-b').position, 20);
});

test('ORDERING: one device\'s stale token never blocks a DIFFERENT device', () => {
  const { store } = mk();
  store.record(1, ping({ deviceId: 'dev-a', at: 9_000_000 }));
  assert.equal(store.record(1, ping({ deviceId: 'dev-b', at: 1, mediaId: 'm-b' })), true,
    'ordering is per-device; clocks are not comparable across devices');
});

test('LABEL: a script-y label is stored VERBATIM as text (the card renders textContent, never HTML) (#2)', () => {
  const { store } = mk();
  const nasty = '<img src=x onerror=alert(1)>';
  store.record(1, ping({ deviceLabel: nasty }));
  assert.equal(store.readOther(1, 'dev-b').deviceLabel, nasty,
    'the store does not HTML-escape - it is the renderer\'s job, and textContent makes escaping wrong here');
});

test('LABEL: over-length is capped, blank/whitespace/absent falls back (#2)', () => {
  const { store } = mk();
  store.record(1, ping({ deviceId: 'd1', deviceLabel: 'x'.repeat(500) }));
  assert.equal(store.readOther(1, 'zz').deviceLabel.length, P.LABEL_MAX);

  assert.equal(P.normalizeLabel('   '), P.FALLBACK_LABEL);
  assert.equal(P.normalizeLabel(''), P.FALLBACK_LABEL);
  assert.equal(P.normalizeLabel(undefined), P.FALLBACK_LABEL);
  assert.equal(P.normalizeLabel(null), P.FALLBACK_LABEL);
  assert.equal(P.normalizeLabel(12345), P.FALLBACK_LABEL, 'a non-string is not a label');
});

test('LABEL: control, zero-width and bidi-override characters are stripped (#2)', () => {
  // Every one of these is written as an escape, never a raw byte: \u202E is
  // the RTL override (it would visually reorder the text after it in the
  // card), \u200B is invisible padding, \u0000 is a NUL.
  assert.equal(P.normalizeLabel('iPh\u0007one'), 'iPhone');
  assert.equal(P.normalizeLabel('iP\u200Bhone'), 'iPhone');
  assert.equal(P.normalizeLabel('\u202EiPhone'), 'iPhone');
  assert.equal(P.normalizeLabel('iPhone\u0000\u001F'), 'iPhone');
  assert.equal(P.normalizeLabel('\u0000 \u200B'), P.FALLBACK_LABEL, 'nothing left -> fallback');
});
test('VALIDATION: a malformed or missing deviceId is refused outright', () => {
  const { store } = mk();
  assert.equal(store.record(1, ping({ deviceId: '' })), false);
  assert.equal(store.record(1, ping({ deviceId: undefined })), false);
  assert.equal(store.record(1, ping({ deviceId: 42 })), false);
  assert.equal(store.record(1, ping({ deviceId: 'has space' })), false);
  assert.equal(store.record(1, ping({ deviceId: 'has/slash' })), false);
  assert.equal(store.record(1, ping({ deviceId: 'a'.repeat(P.DEVICE_ID_MAX + 1) })), false);
  assert.equal(store.userCount(), 0, 'nothing was stored by any of them');
});

test('VALIDATION: a missing or over-long mediaId is refused', () => {
  const { store } = mk();
  assert.equal(store.record(1, ping({ mediaId: '' })), false);
  assert.equal(store.record(1, ping({ mediaId: null })), false);
  assert.equal(store.record(1, ping({ mediaId: 'm'.repeat(P.MEDIA_ID_MAX + 1) })), false);
  assert.equal(store.userCount(), 0);
});

test('VALIDATION: a missing user id is refused (no null-keyed bucket)', () => {
  const { store } = mk();
  assert.equal(store.record(undefined, ping()), false);
  assert.equal(store.record(null, ping()), false);
  assert.equal(store.userCount(), 0);
});

test('VALIDATION: an unknown kind falls back to media; the three real kinds pass through', () => {
  const { store } = mk();
  store.record(1, ping({ deviceId: 'd1', kind: 'book' }));
  assert.equal(store.readOther(1, 'zz').kind, 'media', 'books are out of scope, not a new kind');
  for (const k of ['media', 'podcast', 'track']) {
    store.record(1, ping({ deviceId: 'd1', kind: k }));
    assert.equal(store.readOther(1, 'zz').kind, k);
  }
});

test('VALIDATION: junk positions/durations normalize to 0, never NaN into the card', () => {
  const { store } = mk();
  store.record(1, ping({ position: 'abc', duration: -5 }));
  const seen = store.readOther(1, 'zz');
  assert.equal(seen.position, 0);
  assert.equal(seen.duration, 0);

  store.record(1, ping({ position: Infinity, duration: NaN }));
  const seen2 = store.readOther(1, 'zz');
  assert.equal(seen2.position, 0);
  assert.equal(seen2.duration, 0);
});

test('__proto__/constructor as deviceId or mediaId are ordinary Map keys, not pollution (#4)', () => {
  const { store } = mk();
  assert.equal(store.record(1, ping({ deviceId: '__proto__', mediaId: '__proto__' })), true);
  assert.equal(store.record(1, ping({ deviceId: 'constructor', mediaId: 'constructor' })), true);

  assert.equal({}.polluted, undefined);
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(typeof {}.deviceLabel, 'undefined', 'no entry field leaked onto Object.prototype');

  const seen = store.readOther(1, 'dev-b');
  assert.ok(seen.deviceId === '__proto__' || seen.deviceId === 'constructor');
  assert.equal(store.deviceCount(1), 2, 'both are real, distinct keys');
});

test('a user with no presence reads clean null - the restart-amnesia path (AC8/#10)', () => {
  const { store } = mk();
  assert.equal(store.readOther(99, 'dev-a'), null);
  assert.equal(store.deviceCount(99), 0);
  assert.equal(store.userCount(), 0, 'merely READING must not mint a bucket');
});

test('forget: drops one device and prunes the user map when it was the last', () => {
  const { store } = mk();
  store.record(1, ping({ deviceId: 'dev-a' }));
  store.record(1, ping({ deviceId: 'dev-b' }));
  assert.equal(store.forget(1, 'dev-a'), true);
  assert.equal(store.deviceCount(1), 1);
  assert.equal(store.forget(1, 'dev-b'), true);
  assert.equal(store.userCount(), 0);
  assert.equal(store.forget(1, 'dev-a'), false, 'forgetting nothing is a silent no-op');
  assert.equal(store.forget(404, 'dev-a'), false);
});

test('expired entries are pruned by ordinary WRITES too, not only reads (no unbounded growth)', () => {
  const { store, clock } = mk();
  store.record(1, ping({ deviceId: 'dev-old' }));
  clock.tick(P.LINGER_TTL_MS + 1);
  store.record(1, ping({ deviceId: 'dev-new' }));
  assert.equal(store.deviceCount(1), 1, 'the stale device went out with the write');
  assert.equal(store.readOther(1, 'zz').deviceId, 'dev-new');
});
