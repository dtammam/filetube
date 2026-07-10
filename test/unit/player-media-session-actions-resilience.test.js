'use strict';

// [UNIT] MediaSession action handler registration is DEFENSIVE per-action
// (public/js/player.js, v1.25 QoL wave, PWA task A, sibling of
// player-media-session-actions.test.js): per spec, `setActionHandler` throws
// for an action name the current browser doesn't support, and browser
// support varies (e.g. Safari has historically lagged on some actions). If
// one registration threw uncaught, it would abort the whole one-time setup
// block, silently leaving EVERY later action (including play/pause, the
// actions this fix exists for) unregistered -- a single unsupported action
// would re-introduce the exact flaky-lock-screen bug this fix closes. This
// file simulates a `navigator.mediaSession` that rejects one action
// (`seekto`) and asserts every other action still registers, and that
// requiring the module never throws.
//
// A separate file (not a second test in player-media-session-actions.test.js)
// deliberately: `player.js`'s MediaSession wiring runs ONCE, at module-eval
// time, off module-scoped fake globals -- this scenario needs a DIFFERENT
// `navigator.mediaSession.setActionHandler` behavior than the happy-path
// file, and `node:test` runs each test FILE in its own process (see
// test/unit/pinned-sidebar.test.js's own note on this), so a fresh process
// per fixture is the simplest way to get an isolated module-eval run without
// relying on `require.cache` deletion.

const { test } = require('node:test');
const assert = require('node:assert');

const recordedActions = {};

global.window = {
  addEventListener: function () {},
  matchMedia: function () { return { matches: false, media: 'not all' }; },
  FileTube: {},
};
global.document = {
  addEventListener: function () {},
  visibilityState: 'visible',
};
Object.defineProperty(global, 'navigator', {
  configurable: true,
  value: {
    mediaSession: {
      setActionHandler: function (action, handler) {
        if (action === 'seekto') throw new Error('unsupported action: seekto');
        recordedActions[action] = handler;
      },
    },
  },
});

test('requiring player.js never throws even when the browser rejects one MediaSession action', () => {
  assert.doesNotThrow(() => require('../../public/js/player.js'));
});

test('every OTHER action still registers when one (seekto) is rejected by the browser', () => {
  assert.strictEqual(typeof recordedActions.play, 'function');
  assert.strictEqual(typeof recordedActions.pause, 'function');
  assert.strictEqual(typeof recordedActions.seekbackward, 'function');
  assert.strictEqual(typeof recordedActions.seekforward, 'function');
  assert.strictEqual(recordedActions.seekto, undefined);
});
