'use strict';

// [UNIT] MediaSession ACTION HANDLER wiring (public/js/player.js, v1.25 QoL
// wave, PWA task A): fixes flaky iOS lock-screen/Control-Center Play. With
// NO `navigator.mediaSession.setActionHandler(...)` calls at all (the
// pre-fix state), iOS falls back to unreliable default targeting of "the
// element that last had audio focus" -- flaky for a `<video>` that gets
// programmatically paused + reparented across this app's FULL<->DOCKED
// model. This file locks the REGISTRATION contract (every action the app
// supports gets a handler, exactly once, at module-eval time) and the
// defensive no-op behavior when nothing has been loaded yet (`mediaPlayer`
// is still null). The deeper on-device behavior -- a real lock-screen tap
// actually resuming/pausing/seeking a real `<video>`, iOS's own audio-focus
// handling -- is DOM/OS-integration territory with no jsdom/browser harness
// in this codebase (see CONTRIBUTING.md and the sibling player-*.test.js
// files' own stated posture); Dean's on-device iOS pass is the documented
// arbiter for that.
//
// `player.js` only touches `window`/`document`/`navigator` inside a
// top-level IIFE guarded by `if (typeof window === 'undefined' ...) return`
// (mirrors every other browser-only file in this codebase) -- so this file
// installs minimal fake globals BEFORE the single `require()` below, exactly
// once, the same "require after installing fakes" pattern used by
// test/unit/pinned-sidebar.test.js for common.js. `navigator` is special:
// Node 22+ ships its own non-configurable-setter global `navigator`
// accessor (`Object.getOwnPropertyDescriptor(global, 'navigator').set ===
// undefined`), so a plain `global.navigator = {...}` assignment silently
// no-ops -- `Object.defineProperty` is required to actually replace it.

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
      setActionHandler: function (action, handler) { recordedActions[action] = handler; },
    },
  },
});

require('../../public/js/player.js');

test('registers a MediaSession action handler for play, pause, seekto, seekbackward, and seekforward', () => {
  assert.strictEqual(typeof recordedActions.play, 'function');
  assert.strictEqual(typeof recordedActions.pause, 'function');
  assert.strictEqual(typeof recordedActions.seekto, 'function');
  assert.strictEqual(typeof recordedActions.seekbackward, 'function');
  assert.strictEqual(typeof recordedActions.seekforward, 'function');
});

test('does NOT register previoustrack/nexttrack (Prev/Next only live in watch.js, out of scope for this fix)', () => {
  assert.strictEqual(recordedActions.previoustrack, undefined);
  assert.strictEqual(recordedActions.nexttrack, undefined);
});

test('the play handler never throws when nothing has been loaded yet (mediaPlayer still null)', () => {
  assert.doesNotThrow(() => recordedActions.play());
});

test('the pause handler never throws when nothing has been loaded yet (mediaPlayer still null)', () => {
  assert.doesNotThrow(() => recordedActions.pause());
});

test('the seekto handler never throws when nothing has been loaded yet, including with a missing/undefined details object', () => {
  assert.doesNotThrow(() => recordedActions.seekto({ seekTime: 30 }));
  assert.doesNotThrow(() => recordedActions.seekto({}));
  assert.doesNotThrow(() => recordedActions.seekto(undefined));
});

test('the seekbackward and seekforward handlers never throw when nothing has been loaded yet', () => {
  assert.doesNotThrow(() => recordedActions.seekbackward({ seekOffset: 10 }));
  assert.doesNotThrow(() => recordedActions.seekbackward(undefined));
  assert.doesNotThrow(() => recordedActions.seekforward({ seekOffset: 10 }));
  assert.doesNotThrow(() => recordedActions.seekforward(undefined));
});
