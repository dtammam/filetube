'use strict';

// [UNIT] The pure PWA-lifecycle pause-vs-keep-playing decision extracted from
// the persistent player controller (public/js/player.js, FR-5, T4; scoped to
// mobile/PWA only by FR-8(a), TG, v1.22.0, AC55-AC57). Dean's locked "smart"
// behavior: backgrounding the whole PWA (pagehide/freeze/visibilitychange-
// hidden) pauses+persists a playing VIDEO on MOBILE form factors, but leaves a
// playing AUDIO track running on ANY form factor (lock-screen/background
// music is a core use case, not a bug), and leaves a playing VIDEO running on
// DESKTOP (switching tabs/minimizing shouldn't pause a video the user is
// intentionally background-playing -- Dean's cross-tab-playback ask). The
// DOM-heavy wiring (actual pause() + saveProgressToServer calls, iOS's real
// background-audio lifecycle, the live `isMobileFormFactor()` signal) is
// intentionally NOT covered here (no jsdom/browser harness in this codebase --
// see CONTRIBUTING.md); Dean's on-device iOS + desktop-browser pass is the
// documented arbiter for that.
const { test } = require('node:test');
const assert = require('node:assert');
const { shouldPauseForLifecycleEvent } = require('../../public/js/player.js');

const EVENT_TYPES = ['pagehide', 'freeze', 'visibilitychangeHidden'];

for (const eventType of EVENT_TYPES) {
  test(`shouldPauseForLifecycleEvent(${eventType}): a playing MOBILE video is paused+persisted`, () => {
    assert.strictEqual(shouldPauseForLifecycleEvent(eventType, { isAudio: false, isPlaying: true, isMobile: true }), true);
  });

  test(`shouldPauseForLifecycleEvent(${eventType}): a playing DESKTOP video keeps playing across tab switches (AC56)`, () => {
    assert.strictEqual(shouldPauseForLifecycleEvent(eventType, { isAudio: false, isPlaying: true, isMobile: false }), false);
  });

  test(`shouldPauseForLifecycleEvent(${eventType}): a playing AUDIO track keeps playing regardless of form factor (background/lock-screen audio)`, () => {
    assert.strictEqual(shouldPauseForLifecycleEvent(eventType, { isAudio: true, isPlaying: true, isMobile: true }), false);
    assert.strictEqual(shouldPauseForLifecycleEvent(eventType, { isAudio: true, isPlaying: true, isMobile: false }), false);
  });

  test(`shouldPauseForLifecycleEvent(${eventType}): a PAUSED video is a no-op regardless of media type or form factor`, () => {
    assert.strictEqual(shouldPauseForLifecycleEvent(eventType, { isAudio: false, isPlaying: false, isMobile: true }), false);
    assert.strictEqual(shouldPauseForLifecycleEvent(eventType, { isAudio: false, isPlaying: false, isMobile: false }), false);
  });

  test(`shouldPauseForLifecycleEvent(${eventType}): a PAUSED audio track is a no-op`, () => {
    assert.strictEqual(shouldPauseForLifecycleEvent(eventType, { isAudio: true, isPlaying: false, isMobile: true }), false);
  });
}

test('shouldPauseForLifecycleEvent: an unrecognized event type never pauses, even if playing mobile video', () => {
  assert.strictEqual(shouldPauseForLifecycleEvent('click', { isAudio: false, isPlaying: true, isMobile: true }), false);
  assert.strictEqual(shouldPauseForLifecycleEvent('visibilitychange', { isAudio: false, isPlaying: true, isMobile: true }), false);
  assert.strictEqual(shouldPauseForLifecycleEvent(undefined, { isAudio: false, isPlaying: true, isMobile: true }), false);
});

test('shouldPauseForLifecycleEvent: a missing/undefined ctx is a no-op (never throws)', () => {
  assert.strictEqual(shouldPauseForLifecycleEvent('pagehide', undefined), false);
  assert.strictEqual(shouldPauseForLifecycleEvent('pagehide', {}), false);
});

test('shouldPauseForLifecycleEvent: an omitted isMobile field on an otherwise-playing video defaults to false (desktop-safe default, not a silent pause)', () => {
  assert.strictEqual(shouldPauseForLifecycleEvent('pagehide', { isAudio: false, isPlaying: true }), false);
});

// ---- inNativePresentation (native-controls round): PiP/native-fullscreen --
// video is the one reachable path to real iOS background-audio-for-video --
// never auto-pause it. Checked BEFORE the isAudio/isMobile verdict, so it
// applies uniformly; inline (non-fullscreen) behavior for every existing row
// above is completely unaffected (all of it was exercised with the field
// omitted, i.e. falsy, which is the existing/inline case).
for (const eventType of EVENT_TYPES) {
  test(`shouldPauseForLifecycleEvent(${eventType}): a playing MOBILE video in native fullscreen/PiP is NEVER paused (background-audio path)`, () => {
    assert.strictEqual(shouldPauseForLifecycleEvent(eventType, { isAudio: false, isPlaying: true, isMobile: true, inNativePresentation: true }), false);
  });

  test(`shouldPauseForLifecycleEvent(${eventType}): a playing DESKTOP video in native fullscreen/PiP is also never paused (same guard, desktop already keeps playing anyway)`, () => {
    assert.strictEqual(shouldPauseForLifecycleEvent(eventType, { isAudio: false, isPlaying: true, isMobile: false, inNativePresentation: true }), false);
  });

  test(`shouldPauseForLifecycleEvent(${eventType}): inline (non-fullscreen) mobile video still pauses+persists exactly as before (inNativePresentation: false preserves the existing verdict)`, () => {
    assert.strictEqual(shouldPauseForLifecycleEvent(eventType, { isAudio: false, isPlaying: true, isMobile: true, inNativePresentation: false }), true);
  });

  test(`shouldPauseForLifecycleEvent(${eventType}): audio keeps playing in native fullscreen/PiP too (no behavior change -- audio was already exempt)`, () => {
    assert.strictEqual(shouldPauseForLifecycleEvent(eventType, { isAudio: true, isPlaying: true, isMobile: true, inNativePresentation: true }), false);
  });
}
