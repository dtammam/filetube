'use strict';

// [UNIT] The pure PWA-lifecycle pause-vs-keep-playing decision extracted from
// the persistent player controller (public/js/player.js, FR-5, T4). Dean's
// locked "smart" behavior: backgrounding the whole PWA (pagehide/freeze/
// visibilitychange-hidden) pauses+persists a playing VIDEO, but leaves a
// playing AUDIO track running (lock-screen/background music is a core use
// case, not a bug). The DOM-heavy wiring (actual pause() + saveProgressToServer
// calls, iOS's real background-audio lifecycle) is intentionally NOT covered
// here (no jsdom/browser harness in this codebase -- see CONTRIBUTING.md);
// Dean's on-device iOS-PWA pass is the documented arbiter for that.
const { test } = require('node:test');
const assert = require('node:assert');
const { shouldPauseForLifecycleEvent } = require('../../public/js/player.js');

const EVENT_TYPES = ['pagehide', 'freeze', 'visibilitychangeHidden'];

for (const eventType of EVENT_TYPES) {
  test(`shouldPauseForLifecycleEvent(${eventType}): a playing VIDEO is paused+persisted`, () => {
    assert.strictEqual(shouldPauseForLifecycleEvent(eventType, { isAudio: false, isPlaying: true }), true);
  });

  test(`shouldPauseForLifecycleEvent(${eventType}): a playing AUDIO track keeps playing (background/lock-screen audio)`, () => {
    assert.strictEqual(shouldPauseForLifecycleEvent(eventType, { isAudio: true, isPlaying: true }), false);
  });

  test(`shouldPauseForLifecycleEvent(${eventType}): a PAUSED video is a no-op regardless of media type`, () => {
    assert.strictEqual(shouldPauseForLifecycleEvent(eventType, { isAudio: false, isPlaying: false }), false);
  });

  test(`shouldPauseForLifecycleEvent(${eventType}): a PAUSED audio track is a no-op`, () => {
    assert.strictEqual(shouldPauseForLifecycleEvent(eventType, { isAudio: true, isPlaying: false }), false);
  });
}

test('shouldPauseForLifecycleEvent: an unrecognized event type never pauses, even if playing video', () => {
  assert.strictEqual(shouldPauseForLifecycleEvent('click', { isAudio: false, isPlaying: true }), false);
  assert.strictEqual(shouldPauseForLifecycleEvent('visibilitychange', { isAudio: false, isPlaying: true }), false);
  assert.strictEqual(shouldPauseForLifecycleEvent(undefined, { isAudio: false, isPlaying: true }), false);
});

test('shouldPauseForLifecycleEvent: a missing/undefined ctx is a no-op (never throws)', () => {
  assert.strictEqual(shouldPauseForLifecycleEvent('pagehide', undefined), false);
  assert.strictEqual(shouldPauseForLifecycleEvent('pagehide', {}), false);
});
