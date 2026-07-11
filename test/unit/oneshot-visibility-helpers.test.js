'use strict';

// [UNIT] v1.30.0 T8 (v1.30 Scale Performance + Polish Wave, B1/B7) -- the
// pure/persistence helpers backing "never silently drop a one-shot's
// done-edge, on any of the app's 3 surfaces" (public/js/common.js):
//
//   - `markHomeGridDirty`/`isHomeGridDirty`/`clearHomeGridDirty` -- a
//     persistent (localStorage `filetube_home_dirty`) flag `pollOnce` sets
//     when a one-shot completes with NO live home refresh target
//     (`refreshLibraryInPlace()` returned `false`), and `restoreHomeFromCache`
//     (public/js/common.js's SPA router) consumes the next time the user
//     actually returns to home (AC5.2b) -- covered end-to-end, including the
//     router's own reconcile, by
//     test/integration/oneshot-visibility-three-surfaces.test.js; THIS file
//     covers the flag's own persistence contract in isolation.
//   - `getPendingOneShotJobIds`/`setPendingOneShotJobIds` -- a persistent
//     (localStorage `filetube_pending_oneshots`) record of which jobIds were
//     `queued`/`downloading` as of the last-seen snapshot, backing the
//     backgrounded-PWA-resume reconcile (AC5.3).
//   - `computeActiveOneShotJobIds` -- pure: which jobIds in a snapshot are
//     currently `queued`/`downloading`.
//   - `detectCompletedPendingOneShots` -- pure: of a previously-pending list,
//     which are now absent-or-`done` in a fresh snapshot (the core AC5.3
//     decision -- a job dropped entirely from the snapshot while the tab was
//     hidden still counts as completed, not just one still present at
//     `state: 'done'`).
//
// No DOM/timers needed for any of these -- mirrors this file's neighbors
// (test/unit/oneoff-minimize-chip-refresh.test.js's `detectNewlyDoneOneShots`/
// `refreshLibraryInPlace` section) in both scope and style. localStorage is
// stubbed with a minimal in-memory Map-backed fake (this repo's convention --
// see CONTRIBUTING.md -- is no jsdom/browser harness for pure-logic unit
// tests; bare Node has no `localStorage` global at all, so every helper under
// test already wraps its own access in try/catch for exactly this
// environment, same as `getStoredFormatFilter`/`setStoredFormatFilter`).

const { test } = require('node:test');
const assert = require('node:assert');
const {
  markHomeGridDirty, isHomeGridDirty, clearHomeGridDirty,
  getPendingOneShotJobIds, setPendingOneShotJobIds,
  computeActiveOneShotJobIds, detectCompletedPendingOneShots,
} = require('../../public/js/common.js');

function makeFakeLocalStorage() {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)); },
    removeItem: (key) => { store.delete(key); },
    _store: store,
  };
}

function withFakeLocalStorage(run) {
  const original = global.localStorage;
  global.localStorage = makeFakeLocalStorage();
  try {
    return run(global.localStorage);
  } finally {
    global.localStorage = original;
  }
}

// ---- markHomeGridDirty / isHomeGridDirty / clearHomeGridDirty -------------

test('isHomeGridDirty: false before anything ever marks it dirty', () => {
  withFakeLocalStorage(() => {
    assert.strictEqual(isHomeGridDirty(), false);
  });
});

test('markHomeGridDirty -> isHomeGridDirty round-trips true, clearHomeGridDirty resets it to false', () => {
  withFakeLocalStorage(() => {
    markHomeGridDirty();
    assert.strictEqual(isHomeGridDirty(), true);
    clearHomeGridDirty();
    assert.strictEqual(isHomeGridDirty(), false);
  });
});

test('markHomeGridDirty is idempotent -- calling it twice is still just "dirty"', () => {
  withFakeLocalStorage(() => {
    markHomeGridDirty();
    markHomeGridDirty();
    assert.strictEqual(isHomeGridDirty(), true);
  });
});

test('clearHomeGridDirty on an already-clean flag is a safe no-op', () => {
  withFakeLocalStorage(() => {
    assert.doesNotThrow(() => clearHomeGridDirty());
    assert.strictEqual(isHomeGridDirty(), false);
  });
});

test('the dirty-flag helpers never throw when localStorage is unavailable (private-mode/sandboxed browser, or a bare Node require() with no global at all)', () => {
  const original = global.localStorage;
  delete global.localStorage;
  try {
    assert.doesNotThrow(() => markHomeGridDirty());
    assert.strictEqual(isHomeGridDirty(), false, 'fails safe to "not dirty" when storage cannot be read');
    assert.doesNotThrow(() => clearHomeGridDirty());
  } finally {
    global.localStorage = original;
  }
});

test('isHomeGridDirty is false when localStorage.getItem throws (e.g. a sandboxed/quota-restricted implementation)', () => {
  const original = global.localStorage;
  global.localStorage = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); }, removeItem: () => { throw new Error('denied'); } };
  try {
    assert.doesNotThrow(() => markHomeGridDirty());
    assert.strictEqual(isHomeGridDirty(), false);
  } finally {
    global.localStorage = original;
  }
});

// ---- getPendingOneShotJobIds / setPendingOneShotJobIds --------------------

test('getPendingOneShotJobIds: [] before anything is ever recorded', () => {
  withFakeLocalStorage(() => {
    assert.deepStrictEqual(getPendingOneShotJobIds(), []);
  });
});

test('setPendingOneShotJobIds -> getPendingOneShotJobIds round-trips the exact array', () => {
  withFakeLocalStorage(() => {
    setPendingOneShotJobIds(['jobA', 'jobB']);
    assert.deepStrictEqual(getPendingOneShotJobIds(), ['jobA', 'jobB']);
  });
});

test('setPendingOneShotJobIds([]) clears a previously-recorded list', () => {
  withFakeLocalStorage(() => {
    setPendingOneShotJobIds(['jobA']);
    setPendingOneShotJobIds([]);
    assert.deepStrictEqual(getPendingOneShotJobIds(), []);
  });
});

test('setPendingOneShotJobIds: a non-array input is normalized to []', () => {
  withFakeLocalStorage(() => {
    setPendingOneShotJobIds('not-an-array');
    assert.deepStrictEqual(getPendingOneShotJobIds(), []);
    setPendingOneShotJobIds(null);
    assert.deepStrictEqual(getPendingOneShotJobIds(), []);
  });
});

test('setPendingOneShotJobIds: filters out non-string entries before persisting', () => {
  withFakeLocalStorage(() => {
    setPendingOneShotJobIds(['jobA', 42, null, {}, 'jobB']);
    assert.deepStrictEqual(getPendingOneShotJobIds(), ['jobA', 'jobB']);
  });
});

test('getPendingOneShotJobIds: corrupt/non-JSON storage contents fail safe to []', () => {
  withFakeLocalStorage((storage) => {
    storage.setItem('filetube_pending_oneshots', '{not valid json');
    assert.deepStrictEqual(getPendingOneShotJobIds(), []);
  });
});

test('getPendingOneShotJobIds: valid JSON that is not an array fails safe to []', () => {
  withFakeLocalStorage((storage) => {
    storage.setItem('filetube_pending_oneshots', JSON.stringify({ jobA: true }));
    assert.deepStrictEqual(getPendingOneShotJobIds(), []);
  });
});

test('getPendingOneShotJobIds: a JSON array containing non-string entries filters them out on read too', () => {
  withFakeLocalStorage((storage) => {
    storage.setItem('filetube_pending_oneshots', JSON.stringify(['jobA', 7, 'jobB']));
    assert.deepStrictEqual(getPendingOneShotJobIds(), ['jobA', 'jobB']);
  });
});

test('the pending-jobIds helpers never throw when localStorage is unavailable', () => {
  const original = global.localStorage;
  delete global.localStorage;
  try {
    assert.doesNotThrow(() => setPendingOneShotJobIds(['jobA']));
    assert.deepStrictEqual(getPendingOneShotJobIds(), []);
  } finally {
    global.localStorage = original;
  }
});

// ---- computeActiveOneShotJobIds (pure) -------------------------------------

test('computeActiveOneShotJobIds: includes "queued" and "downloading" jobs', () => {
  const snapshot = { oneShots: { jobA: { state: 'queued' }, jobB: { state: 'downloading' } } };
  assert.deepStrictEqual(computeActiveOneShotJobIds(snapshot).sort(), ['jobA', 'jobB']);
});

test('computeActiveOneShotJobIds: excludes "done"/"error"/"cancelled" jobs', () => {
  const snapshot = {
    oneShots: {
      jobDone: { state: 'done' },
      jobError: { state: 'error' },
      jobCancelled: { state: 'cancelled' },
    },
  };
  assert.deepStrictEqual(computeActiveOneShotJobIds(snapshot), []);
});

test('computeActiveOneShotJobIds: defensive against a missing/malformed snapshot -- never throws, returns []', () => {
  assert.deepStrictEqual(computeActiveOneShotJobIds(null), []);
  assert.deepStrictEqual(computeActiveOneShotJobIds(undefined), []);
  assert.deepStrictEqual(computeActiveOneShotJobIds({}), []);
  assert.deepStrictEqual(computeActiveOneShotJobIds({ oneShots: 'not-an-object' }), []);
  assert.deepStrictEqual(computeActiveOneShotJobIds({ oneShots: { jobA: null, jobB: 'not-an-object' } }), []);
});

test('computeActiveOneShotJobIds: never mutates its input', () => {
  const snapshot = { oneShots: { jobA: { state: 'downloading' } } };
  computeActiveOneShotJobIds(snapshot);
  assert.deepStrictEqual(snapshot, { oneShots: { jobA: { state: 'downloading' } } });
});

// ---- detectCompletedPendingOneShots (pure, AC5.3 core logic) --------------

test('detectCompletedPendingOneShots: a pending job now at state "done" in the fresh snapshot is completed', () => {
  const pending = ['jobA'];
  const snapshot = { oneShots: { jobA: { state: 'done' } } };
  assert.deepStrictEqual(detectCompletedPendingOneShots(pending, snapshot), ['jobA']);
});

test('detectCompletedPendingOneShots: a pending job entirely ABSENT from the fresh snapshot is also completed (AC5.3 headline case -- the server already dropped it while the tab was hidden)', () => {
  const pending = ['jobA'];
  const snapshot = { oneShots: {} };
  assert.deepStrictEqual(detectCompletedPendingOneShots(pending, snapshot), ['jobA']);
});

test('detectCompletedPendingOneShots: a pending job still "queued"/"downloading" in the fresh snapshot is NOT completed', () => {
  const pending = ['jobA', 'jobB'];
  const snapshot = { oneShots: { jobA: { state: 'queued' }, jobB: { state: 'downloading' } } };
  assert.deepStrictEqual(detectCompletedPendingOneShots(pending, snapshot), []);
});

test('detectCompletedPendingOneShots: "error"/"cancelled" are terminal but NOT "done" -- not reported as completed (mirrors detectNewlyDoneOneShots\' done-only posture)', () => {
  const pending = ['jobA', 'jobB'];
  const snapshot = { oneShots: { jobA: { state: 'error' }, jobB: { state: 'cancelled' } } };
  assert.deepStrictEqual(detectCompletedPendingOneShots(pending, snapshot), []);
});

test('detectCompletedPendingOneShots: a mix of completed and still-active pending jobs returns only the completed ones', () => {
  const pending = ['jobA', 'jobB', 'jobC'];
  const snapshot = { oneShots: { jobA: { state: 'done' }, jobB: { state: 'downloading' } } }; // jobC absent
  assert.deepStrictEqual(detectCompletedPendingOneShots(pending, snapshot).sort(), ['jobA', 'jobC']);
});

test('detectCompletedPendingOneShots: an empty pending list returns []', () => {
  assert.deepStrictEqual(detectCompletedPendingOneShots([], { oneShots: { jobA: { state: 'done' } } }), []);
});

test('detectCompletedPendingOneShots: defensive against malformed pendingJobIds/snapshot -- never throws', () => {
  assert.deepStrictEqual(detectCompletedPendingOneShots(null, { oneShots: {} }), []);
  assert.deepStrictEqual(detectCompletedPendingOneShots(undefined, { oneShots: {} }), []);
  assert.deepStrictEqual(detectCompletedPendingOneShots(['jobA'], null), ['jobA']);
  assert.deepStrictEqual(detectCompletedPendingOneShots(['jobA'], { oneShots: 'not-an-object' }), ['jobA']);
});

test('detectCompletedPendingOneShots: never mutates its inputs (pure)', () => {
  const pending = ['jobA'];
  const snapshot = { oneShots: { jobA: { state: 'done' } } };
  detectCompletedPendingOneShots(pending, snapshot);
  assert.deepStrictEqual(pending, ['jobA']);
  assert.deepStrictEqual(snapshot, { oneShots: { jobA: { state: 'done' } } });
});
