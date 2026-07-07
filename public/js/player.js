'use strict';

// Persistent player controller (FR-1, T2).
//
// Owns a SINGLE live #player-host (cloned exactly once, ever, from the
// shell's `#player-host-template`) for the entire life of the app shell.
// Implements the FULL <-> DOCKED <-> CLOSED state machine by REPARENTING
// (appendChild) that one host between the current watch view's inline
// `#player-slot` (FULL) and the shell's fixed `#player-dock` (DOCKED) --
// the host and every listener wired to it are created exactly once and
// never re-created by navigation, so every existing player feature (inline
// iOS playback, +-15s skip controls, audio-bg-art, the transcode overlay +
// polling, the resume overlay, Media Session, progress saving, live
// transcode) is preserved automatically across FULL <-> DOCKED "by
// construction" (see the exec plan's "Approach").
//
// This file replaces the player HALF of the old watch.js (T1 left that half
// in place as a per-visit clone; T2 extracts + makes it persistent).
// watch.js (the *view*) now only owns per-visit surrounding DOM (metadata,
// related sidebar, comments, star rating, delete) and calls into the API
// exposed here (`window.FileTube.player`) to get its media mounted/playing.
//
// ---- Public API: window.FileTube.player -----------------------------------
//   load(id, data, { slot })   -- mount `id` in `slot` (the watch view's
//                                  `#player-slot`). If `id` already matches
//                                  the currently-loaded media (e.g. the user
//                                  tapped the dock, or a re-render happens to
//                                  call load() again for the same video),
//                                  this is EQUIVALENT to expand(slot): the
//                                  host is only reparented -- `<video>` src/
//                                  currentTime are never touched, so there is
//                                  no restart. Otherwise this is a genuine
//                                  (re)load: any in-flight timers/overlays for
//                                  the PREVIOUS media are torn down first.
//                                  Returns `true` if the host is mounted,
//                                  `false` if the template/host is missing
//                                  (caller should show its own fatal error).
//   expand(slot)                -- reparent the host into `slot` (FULL),
//                                  without touching src/currentTime. Used
//                                  internally by load()'s adopt path; exposed
//                                  directly too (matches the exec plan's
//                                  named state-machine entry points).
//   dock()                      -- FULL -> DOCKED. No-op if nothing is
//                                  loaded/already CLOSED/already DOCKED (so
//                                  navigating away with nothing playing never
//                                  produces a dock, per the hard constraint).
//   close()                     -- any -> CLOSED: pause, release the media
//                                  resource, hide + detach the dock, and tear
//                                  down every player-scoped timer. No orphaned
//                                  playing <video>.
//   getState()                  -- 'closed' | 'full' | 'docked'.
//   currentId                   -- (getter) id of the loaded media, or null.
//
// ---- The docked-player state machine -------------------------------------
// See docs/exec-plans/active/2026-07-06-v1.16-watch-experience.md, "The
// docked-player state machine (FR-1)". The router's `applyPlayerTransition`
// hook in common.js calls `dock()` whenever the user navigates AWAY from the
// watch view (home/setup/subscriptions/etc.); entering/returning to the watch
// view is instead driven by watch.js's own `init()` calling `load()` (see
// that file) -- by the time `load()` runs, the new view's `#player-slot`
// already exists in the (already-swapped-in) live document.
//
// ---- iOS reparent risk (the design's #1 unknown) ---------------------------
// Moving a playing <video> in the DOM can pause/reset playback on some iOS
// Safari versions. Mitigation implemented below: every reparent
// (`mountInSlot`/`dock`) happens SYNCHRONOUSLY (no `await`/timer in between)
// relative to the navigation that triggered it, and is immediately followed
// by `if (wasPlaying && el.paused) el.play().catch(() => {})` --
// `currentTime` is retained by the browser across a same-document reparent
// regardless of whether playback itself paused, so this resumes seamlessly.
// This is "inside the user gesture" in the sense the SPA-lite router allows
// (the navigate()->fetch->swap chain is a direct consequence of the
// click/tap) ONLY IF the reparent itself runs with no further AWAITED work
// in between -- W1 remediation (v1.16.0): for the DOCKED -> FULL "adopt"
// path specifically (tapping the dock to expand the SAME video), watch.js's
// init() calls `load()` SYNCHRONOUSLY, before its own /api/config and
// /api/videos/:id fetches (which an adopt-load doesn't need at all -- see
// `load()`'s adopt branch below, which ignores `data` entirely) -- this is
// what keeps this reparent's `play()` re-assertion gesture-chained; gating
// it behind two MORE awaited network round-trips (as a prior version of
// this code did) reintroduces exactly the intervening idle time this
// mitigation depends on not having, and iOS may then silently leave the
// expanded player paused. A genuine NEW load (a fresh watch entry, a
// different video) still necessarily awaits its own metadata fetch first
// (it needs `data` to set up transcoding/audio-mode/Media Session), so this
// synchronous guarantee is specific to the adopt path, not every load().
// FALLBACK (documented, NOT wired up): if Dean's on-device pass shows iOS
// still pauses on reparent, replace the two reparent call sites
// (`mountInSlot`/`dock`) with a "measured geometry" approach instead: never
// move `host` out of a single fixed container in the shell; instead give it
// `position: fixed` always, and on every mount/dock, read the target
// element's `getBoundingClientRect()` and set the host's `top/left/width/
// height` (and `z-index`) to match it, updating on resize/scroll. That keeps
// the host permanently attached to the SAME parent (no DOM move at all) while
// still visually appearing "docked" or "in the slot". This is a bigger,
// riskier change (scroll-tracking, resize observers) so it is deliberately
// NOT implemented here -- only sketched -- pending Dean's on-device verdict.

// ---- Pure state-machine helpers (node:test-covered directly) --------------
// Hoisted above the browser-only runtime below (same "pure helpers first"
// split common.js's router uses -- see test/unit/router-helpers.test.js) so
// the actual FULL/DOCKED/CLOSED decisions are verifiable without a DOM/
// browser harness (this codebase has none; see CONTRIBUTING.md).

// Is a `load(id, ...)` call an ADOPT (a pure reparent -- no `<video>` src/
// currentTime touch, no restart) rather than a genuine (re)load? True only
// when the requested id already matches what's currently loaded AND the
// controller isn't CLOSED (a CLOSED controller has released its source, so
// even a matching id always needs a fresh load).
function isAdoptLoad(currentId, requestedId, state) {
  return currentId != null && currentId === requestedId && state !== 'closed';
}

// Should leaving `fromView` for `toView` dock the persistent player? This is
// the pure half of `applyPlayerTransition` (public/js/common.js) -- only
// ever true when actually leaving the watch view for a DIFFERENT known view.
// The caller additionally guards on "is anything loaded" (see `dock()`,
// which no-ops when nothing is loaded/already docked/closed) -- that half is
// state, not a pure function of the two view names, so it stays in `dock()`.
function shouldDockOnTransition(fromView, toView) {
  return fromView === 'watch' && typeof toView === 'string' && toView !== 'watch';
}

// The FULL/DOCKED/CLOSED transition a NAVIGATION (not a direct dock [x]/tap
// gesture) should produce, given the state immediately before it. Mirrors
// the exec plan's state table; a thin summary of the same rules `dock()`/
// `load()` apply for real via DOM side effects. `hasMedia` is whether a
// media id is currently loaded (`currentId != null`). CLOSE is deliberately
// never a return value here -- closing is only ever a direct user action on
// the dock's `[x]`, never a side effect of navigating.
function nextPlayerState(fromView, toView, currentState, hasMedia) {
  if (!hasMedia || currentState === 'closed') return 'closed'; // nothing loaded -- navigation never produces a dock
  if (shouldDockOnTransition(fromView, toView)) return 'docked';
  if (toView === 'watch') return 'full'; // entering/returning to watch always ends up FULL (load()'s adopt path reparents in place)
  return currentState; // watch -> watch (different media) or an unrecognized transition: unchanged by this hook
}

// Should this PWA-lifecycle event pause + persist the currently-loaded media
// (FR-5, T4)? Dean's locked "smart" behavior (2026-07-06): backgrounding the
// whole app pauses+persists a playing VIDEO (so it doesn't keep going
// invisibly), but lets playing AUDIO/background-music keep going (lock-
// screen/screen-off background audio is a core use case, not a bug). A true
// close/unload ends the audio session anyway once the page is torn down --
// there is nothing further for this decision to do in that case beyond not
// fighting it. `eventType` is one of 'pagehide' | 'freeze' |
// 'visibilitychangeHidden' (an unrecognized type is always false -- this
// helper is only ever consulted from those three listeners, so an unknown
// value indicates a caller bug, not a real lifecycle transition). `ctx.isAudio`
// is whether the CURRENTLY LOADED media is audio (not video); `ctx.isPlaying`
// is whether it is currently playing (a paused/never-started player has
// nothing to pause or persist -- a deliberate no-op).
var LIFECYCLE_PAUSE_EVENTS = { pagehide: true, freeze: true, visibilitychangeHidden: true };
function shouldPauseForLifecycleEvent(eventType, ctx) {
  if (!LIFECYCLE_PAUSE_EVENTS[eventType]) return false;
  if (!ctx || !ctx.isPlaying) return false; // nothing playing -- no-op
  if (ctx.isAudio) return false; // audio/background-music: keep playing in the background
  return true; // video: pause + persist so it doesn't keep going invisibly
}

// Should the resume overlay show for this load (FR-4b, T3)? True whenever
// there's meaningful saved progress (>5s) -- UNLESS this specific load was
// reached by autoplay advancing to the next video (see `handleAutoplayNext`,
// which sets the one-shot `autoplayAdvancePending` flag immediately before
// navigating; `load()` then captures it into a per-load snapshot at load
// START -- see `captureAutoplayAdvanceForLoad` -- which `handleResumePlayback`
// reads). An autoplay-advanced load skips the "Resume at..." prompt entirely and just
// plays on, so the autoplay flow is never interrupted by a manual decision.
// A normal navigation (autoplayAdvance falsy) to a video with saved progress
// is unaffected -- still shows the overlay exactly as before. Deliberately
// NOT keyed off the `autoplayNext` SETTING itself: a manual navigation while
// the setting happens to be ON must still show the overlay (see the exec
// plan's "Alternatives considered").
function shouldShowResumeOverlay(ctx) {
  var savedProgress = (ctx && ctx.savedProgress) || 0;
  var autoplayAdvance = !!(ctx && ctx.autoplayAdvance);
  return savedProgress > 5 && !autoplayAdvance;
}

// Bug-fix (v1.17.0 two-reviewer gate, FR-4b leak): pure helper for the
// "capture-then-reset" step every NEW (non-adopt) load must perform on the
// one-shot `autoplayAdvancePending` flag, at load START -- not deferred to
// whenever `handleResumePlayback` happens to run for that load (which may be
// well after load start if a transcode is pending). Given the flag's CURRENT
// value at the moment a new load begins, returns the per-load snapshot to use
// for THIS load's resume decision (`value`) and what the module-level flag
// must be reset to right away (`nextPending`, always `false`). The call site
// (see `load()`) does:
//   var captured = captureAutoplayAdvanceForLoad(autoplayAdvancePending);
//   loadAutoplayAdvance = captured.value;
//   autoplayAdvancePending = captured.nextPending;
// Doing this unconditionally at load start -- rather than reading/consuming
// the global lazily inside `handleResumePlayback` -- is what prevents the
// flag from leaking into a LATER, unrelated load: if an autoplay-advanced
// load needs a transcode that then fails (or the user navigates away before
// the transcode finishes), `handleResumePlayback` never runs again for that
// load, but the global has ALREADY been cleared by this load's own capture
// step, so a subsequent manual load can never observe a stale `true`.
function captureAutoplayAdvanceForLoad(pending) {
  return { value: !!pending, nextPending: false };
}

// Guarded so requiring this file in Node (for unit tests) never touches
// `window`/`document` -- mirrors common.js's own `if (typeof window ...)`
// runtime guard immediately below.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    isAdoptLoad,
    shouldDockOnTransition,
    nextPlayerState,
    shouldPauseForLifecycleEvent,
    shouldShowResumeOverlay,
    captureAutoplayAdvanceForLoad,
  };
}

(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined') return; // node:test never touches this file

  var STATE_CLOSED = 'closed';
  var STATE_FULL = 'full';
  var STATE_DOCKED = 'docked';

  var state = STATE_CLOSED;
  var currentId = null;
  var currentData = null;
  var loadGeneration = 0; // invalidated on every real (non-adopt) load/close so a stale poll/timer can never act on the wrong media

  // The single, ever-cloned host + the elements inside it (queried once).
  var host = null;
  var mediaPlayer = null;
  var audioBgArt, audioVisualizer, audioVisualTitle, audioVisualFolder;
  var skipControls, skipBackBtn, skipFwdBtn, skipRippleLeft, skipRippleRight, speedBadge;
  var transcodeOverlay, transcodeSpinner, transcodeTitle, transcodeMessage;
  var resumeOverlay, resumeTimeStr, resumeYesBtn, resumeNoBtn;

  var dockCloseBtn = null;
  var dockChromeReady = false;

  // Player-scoped timers (raw handles, not covered by any AbortSignal) --
  // cleared on close() and whenever a genuinely NEW media is loaded.
  var progressInterval = null;
  var skipRevealTimer = null;
  var transcodePollTimer = null;

  var awaitingTranscode = false;
  var liveMode = false;   // desktop AVI: live transcode (seek = restart stream)
  var liveOffset = 0;     // seconds into the source that the current live stream started at
  var savedProgress = 0;

  // One-shot flag (FR-4b, T3): set true in handleAutoplayNext immediately
  // before navigate(). Bug-fix (v1.17.0 two-reviewer gate): this global is
  // captured into `loadAutoplayAdvance` (a PER-LOAD snapshot, below) and
  // unconditionally reset to false at the very START of the next NEW
  // (non-adopt) load -- see `load()` and `captureAutoplayAdvanceForLoad`
  // above -- rather than being read/consumed lazily inside
  // `handleResumePlayback`. Consuming it lazily there leaked: when the
  // autoplay-advanced load needed a transcode, `handleResumePlayback` would
  // return early (still `awaitingTranscode`) WITHOUT consuming the flag, and
  // if that transcode then failed (or the user navigated away first),
  // `handleResumePlayback` never ran again for that load -- leaving the
  // global `true` for a LATER, unrelated manual load to wrongly consume,
  // silently skipping its resume overlay. Capturing+resetting at load START
  // instead means the global is cleared the instant the NEXT load begins,
  // regardless of how (or whether) that load's own resume decision resolves.
  var autoplayAdvancePending = false;

  // Per-load snapshot of `autoplayAdvancePending`, captured exactly once at
  // the start of every genuine (non-adopt) load -- see `load()`. This is what
  // `handleResumePlayback` actually reads (via `shouldShowResumeOverlay`),
  // so a load reached by autoplay-advancing still suppresses its resume
  // overlay correctly even if `handleResumePlayback` runs much later (e.g.
  // after a transcode finishes) -- the guard `gen !== loadGeneration` at the
  // top of `handleResumePlayback`/`pollTranscodeUntilReady` already ensures a
  // STALE gen's poll chain can never read a since-overwritten value here.
  var loadAutoplayAdvance = false;

  var currentChannelName = '';
  var lastPositionSync = 0;
  var POSITION_SYNC_MS = 5000;

  var AUDIO_PLAYER_MODE = 'background'; // 'background' (default) | 'visualizer' (fallback) -- see watch.js's original comment for the feasibility finding this preserves

  var SKIP_SECONDS = 15;

  // ---- small shared helpers -------------------------------------------------

  function isMobileViewport() {
    return window.matchMedia('(max-width: 768px)').matches;
  }

  function inNativeFullscreen() {
    return !!document.fullscreenElement || !!(mediaPlayer && mediaPlayer.webkitDisplayingFullscreen);
  }

  // Absolute position in the source, accounting for live-stream restart offsets.
  function currentAbsTime() {
    if (!mediaPlayer) return 0;
    return liveMode ? liveOffset + (mediaPlayer.currentTime || 0) : mediaPlayer.currentTime;
  }

  // ---- one-time host creation + listener wiring ------------------------------
  // Runs exactly ONCE (guarded by `host` already being set) no matter how many
  // times load() is subsequently called -- this is what makes every listener
  // below survive FULL<->DOCKED without ever being re-created.
  function ensureHost() {
    if (host) return host;
    var template = document.getElementById('player-host-template');
    if (!template || !template.content) return null;
    var clone = template.content.cloneNode(true);
    var candidate = clone.querySelector('#player-wrapper');
    if (!candidate) return null;
    host = candidate;
    mediaPlayer = host.querySelector('#media-player');
    audioBgArt = host.querySelector('#audio-bg-art');
    audioVisualizer = host.querySelector('#audio-visualizer');
    audioVisualTitle = host.querySelector('#audio-visual-title');
    audioVisualFolder = host.querySelector('#audio-visual-folder');
    skipControls = host.querySelector('#skip-controls');
    skipBackBtn = host.querySelector('#skip-back-btn');
    skipFwdBtn = host.querySelector('#skip-fwd-btn');
    skipRippleLeft = host.querySelector('#skip-ripple-left');
    skipRippleRight = host.querySelector('#skip-ripple-right');
    speedBadge = host.querySelector('#speed-badge');
    transcodeOverlay = host.querySelector('#transcode-overlay');
    transcodeSpinner = host.querySelector('#transcode-spinner');
    transcodeTitle = host.querySelector('#transcode-title');
    transcodeMessage = host.querySelector('#transcode-message');
    resumeOverlay = host.querySelector('#resume-overlay');
    resumeTimeStr = host.querySelector('#resume-time-str');
    resumeYesBtn = host.querySelector('#resume-yes-btn');
    resumeNoBtn = host.querySelector('#resume-no-btn');
    wireHostListeners();
    return host;
  }

  // ---- Media Session ("Now Playing" control surface) -------------------------
  // Hardens the CONTROL SURFACE (accurate metadata, play/pause state, scrubber
  // position on the lock screen / Control Center). Does NOT enable true
  // background playback -- see the original watch.js comment this preserves.
  // Deliberately un-gated by FULL/DOCKED (a docked player playing in the
  // background should still keep the lock-screen surface accurate).
  function setPlaybackState(playbackState) {
    if (!('mediaSession' in navigator)) return;
    try { navigator.mediaSession.playbackState = playbackState; } catch (_) {}
  }

  function updatePositionState(force) {
    if (liveMode) return; // relative-to-restart position would mislead the scrubber
    if (!('mediaSession' in navigator) || !('setPositionState' in navigator.mediaSession)) return;
    var now = Date.now();
    if (!force && now - lastPositionSync < POSITION_SYNC_MS) return;
    var posState = clampPositionState(mediaPlayer.duration, mediaPlayer.currentTime, mediaPlayer.playbackRate);
    if (!posState) return;
    lastPositionSync = now;
    try { navigator.mediaSession.setPositionState(posState); } catch (_) {}
  }

  function setupMediaSession(id, channelName, title) {
    currentChannelName = channelName || '';
    if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: title || 'FileTube',
        artist: channelName || '',
        album: 'FileTube',
        artwork: [
          { src: '/thumbnail/' + id, sizes: '256x256', type: 'image/jpeg' },
          { src: '/thumbnail/' + id, sizes: '512x512', type: 'image/jpeg' },
        ],
      });
      setPlaybackState(mediaPlayer.paused ? 'paused' : 'playing');
      updatePositionState(true);
    } catch (_) { /* MediaMetadata construction unsupported */ }
  }

  // Re-assert Media Session when the PWA returns to the foreground -- wired
  // ONCE, guarded on `currentData` so it's a no-op whenever nothing is loaded.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible' || !currentData || !mediaPlayer) return;
    setupMediaSession(currentId, currentChannelName, currentData.title);
    setPlaybackState(mediaPlayer.paused ? 'paused' : 'playing');
    updatePositionState(true);
  });

  // ---- FR-5 (T4): background/force-close lifecycle pause+persist ------------
  //
  // Wired ONCE, alongside (not instead of) the foreground re-assert above,
  // which stays completely intact -- these are additional listeners, not a
  // replacement, and never fight each other (one only acts on `hidden`/
  // pagehide/freeze, the other only on returning to `visible`).
  //
  // Hooked events -- deliberately events that fire ONLY when the whole
  // app/tab is actually backgrounding or closing, never on an in-app SPA
  // view swap or the FULL<->DOCKED reparent (`common.js`'s router does a
  // same-document `innerHTML`/reparent swap, which fires none of these):
  //   - `pagehide` on `window` -- fires on the page being unloaded/closed or
  //     entering the back/forward cache; the most reliable "this page is
  //     going away" signal across browsers.
  //   - `freeze` on `document` -- Page Lifecycle API; fires when a
  //     backgrounded tab/PWA is frozen (supported on Chrome/Android; a
  //     harmless no-op listener on browsers that never fire it, e.g. current
  //     iOS Safari -- which is exactly why `visibilitychange` below is also
  //     hooked, since it IS reliable on iOS).
  //   - `visibilitychange` with `document.hidden === true` -- fires reliably
  //     on iOS Safari/PWA the moment the app is backgrounded (Home button,
  //     app-switcher, screen lock). This is the one that actually covers iOS.
  //
  // `shouldPauseForLifecycleEvent` (pure, unit-tested above) makes the actual
  // pause-vs-keep-playing call: VIDEO playing -> pause + persist; AUDIO
  // playing -> no-op (left running so lock-screen/background music keeps
  // going, per Dean's locked decision); nothing playing -> no-op. On a real
  // pause, `saveProgressToServer` (the SAME function every other
  // progress-save path already uses -- no duplicate persistence logic) is
  // called directly rather than relying solely on the async 'pause' event's
  // own `stopProgressSaver()`, since `pagehide`/`freeze` may not leave enough
  // time for a queued task to run before the page is torn down.
  //
  // Bug-fix (v1.17.0 two-reviewer gate, FR-5 persistence): this is the ONE
  // persist call site passed `{ keepalive: true }` (see `saveProgressToServer`
  // below). A real `pagehide` (tab/app force-closed, not just backgrounded) can
  // have the browser tear down the page's document/task queue before an
  // ordinary, non-keepalive `fetch` finishes -- some browsers cancel any
  // in-flight non-keepalive request on unload, silently dropping this exact
  // save and defeating FR-5's "clean resume on reopen after force-close"
  // promise. `keepalive: true` (small-body, still a normal `fetch`, no new
  // request/response shape) tells the browser to let the request complete
  // even after the document is gone. Every OTHER progress-save call site
  // (the 4s interval, pause, skip, ended, resumeNoBtn) stays exactly as
  // before -- those all run mid-session with the page fully alive, so there
  // is nothing for keepalive to protect against there, and always setting it
  // would be an unnecessary behavior change to a working path.
  function handleBackgroundLifecycle(eventType) {
    if (!mediaPlayer || !currentId) return; // nothing loaded -- no-op
    var ctx = {
      isAudio: !!(currentData && currentData.type === 'audio'),
      isPlaying: !mediaPlayer.paused,
    };
    if (!shouldPauseForLifecycleEvent(eventType, ctx)) return;
    mediaPlayer.pause();
    saveProgressToServer(currentAbsTime(), { keepalive: true });
  }

  window.addEventListener('pagehide', function () { handleBackgroundLifecycle('pagehide'); });
  document.addEventListener('freeze', function () { handleBackgroundLifecycle('freeze'); });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') handleBackgroundLifecycle('visibilitychangeHidden');
  });

  // ---- skip (+-15s), ripple, hold-to-2x, dbl-tap ------------------------------

  function skip(delta) {
    flashRipple(delta < 0 ? skipRippleLeft : skipRippleRight);
    if (liveMode) {
      var total = (currentData && currentData.duration) || Infinity;
      var target = Math.max(0, Math.min(total, currentAbsTime() + delta));
      startLiveStream(target, true);
      saveProgressToServer(target);
      return;
    }
    var dur = mediaPlayer.duration;
    if (!isFinite(dur) || dur <= 0) return;
    mediaPlayer.currentTime = Math.max(0, Math.min(dur, mediaPlayer.currentTime + delta));
    saveProgressToServer(mediaPlayer.currentTime);
  }

  function flashRipple(el) {
    if (!el) return;
    el.classList.remove('active');
    void el.offsetWidth; // force reflow so rapid repeats re-trigger the animation
    el.classList.add('active');
  }

  function revealSkipButtons() {
    if (!skipControls) return;
    skipControls.classList.add('skip-visible');
    if (skipRevealTimer) clearTimeout(skipRevealTimer);
    skipRevealTimer = setTimeout(function () { skipControls.classList.remove('skip-visible'); }, 2500);
  }

  function hideSkipButtons() {
    if (!skipControls) return;
    if (skipRevealTimer) { clearTimeout(skipRevealTimer); skipRevealTimer = null; }
    skipControls.classList.remove('skip-visible');
  }

  // Mutable hold-to-2x state, module-scope so dock()/close() can force-release
  // it (previously per-view closures; now must survive/reset across the
  // persistent host's whole lifetime).
  var holdTimer = null;
  var holdActive = false;
  var prevRate = 1;
  var lastTapTime = 0;
  var lastTapLeft = false;
  var startX = 0, startY = 0;
  var HOLD_MS = 500;
  var MOVE_TOL = 10;

  function engageHold() {
    if (holdActive || !mediaPlayer || mediaPlayer.paused || inNativeFullscreen() || state !== STATE_FULL) return;
    holdActive = true;
    prevRate = mediaPlayer.playbackRate || 1;
    mediaPlayer.playbackRate = 2;
    if (speedBadge) speedBadge.style.display = 'block';
  }

  function releaseHold() {
    if (!holdActive) return;
    holdActive = false;
    if (mediaPlayer) mediaPlayer.playbackRate = prevRate || 1;
    if (speedBadge) speedBadge.style.display = 'none';
  }

  // Called on dock()/close() so no gesture-in-progress can strand the player
  // at 2x speed or a stale reveal timer once it's no longer the FULL view.
  function resetTransientPlaybackUi() {
    clearTimeout(holdTimer);
    releaseHold();
    hideSkipButtons();
  }

  // ---- transcode ("Preparing video") overlay ---------------------------------

  function showTranscodeOverlay() {
    if (transcodeOverlay) transcodeOverlay.style.display = 'flex';
  }
  function hideTranscodeOverlay() {
    if (transcodeOverlay) transcodeOverlay.style.display = 'none';
  }
  function showTranscodeFailed() {
    if (transcodeSpinner) transcodeSpinner.classList.add('failed');
    if (transcodeTitle) transcodeTitle.textContent = 'Could not prepare this video';
    if (transcodeMessage) transcodeMessage.textContent = 'FileTube was unable to convert this file to a playable format. The original may be corrupt or use an unsupported codec.';
  }

  // Poll the server until the MP4 transcode is ready, then load and play it.
  // `gen` pins this poll chain to the load() call that started it -- if a
  // newer load()/close() has since run, `gen !== loadGeneration` and the poll
  // silently stops, so a stale poll for a PREVIOUS media can never touch the
  // (by-then-different) live host.
  function pollTranscodeUntilReady(gen, id) {
    if (gen !== loadGeneration || state === STATE_CLOSED) return;
    fetch('/api/videos/' + id)
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (gen !== loadGeneration || state === STATE_CLOSED) return;
        if (data.transcodeStatus === 'ready') {
          awaitingTranscode = false;
          hideTranscodeOverlay();
          mediaPlayer.style.display = 'block';
          mediaPlayer.src = '/video/' + id;
          handleResumePlayback(gen, id);
          return;
        }
        if (data.transcodeStatus === 'failed') {
          showTranscodeFailed();
          return;
        }
        var pct = Math.round(data.transcodeProgress || 0);
        if (transcodeTitle) {
          transcodeTitle.textContent = pct > 0 ? 'Preparing this video… ' + pct + '%' : 'Preparing this video…';
        }
        transcodePollTimer = setTimeout(function () { pollTranscodeUntilReady(gen, id); }, 2000);
      })
      .catch(function (e) {
        console.error('Error polling transcode status:', e);
        if (gen === loadGeneration && state !== STATE_CLOSED) {
          transcodePollTimer = setTimeout(function () { pollTranscodeUntilReady(gen, id); }, 5000);
        }
      });
  }

  // ---- resume overlay + progress saving ---------------------------------------

  function handleResumePlayback(gen, id) {
    if (gen !== loadGeneration || awaitingTranscode) return;
    // Bug-fix (v1.17.0 two-reviewer gate, FR-4b leak): read the PER-LOAD
    // snapshot captured at load START (`loadAutoplayAdvance`), NOT the
    // module-level `autoplayAdvancePending` global -- the global is already
    // consumed/reset by `load()` itself the instant this load began (see the
    // comment above `autoplayAdvancePending`'s declaration), so it would be
    // long gone (or worse, belong to a DIFFERENT, since-started load) by the
    // time this runs, if this is the post-transcode re-entry into
    // `handleResumePlayback` from `pollTranscodeUntilReady`. The
    // `gen !== loadGeneration` guard just above ensures this only ever reads
    // `loadAutoplayAdvance` while it still reflects THIS load.
    var autoplayAdvance = loadAutoplayAdvance;
    fetch('/api/progress/' + id)
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (gen !== loadGeneration) return;
        savedProgress = data.timestamp || 0;
        if (shouldShowResumeOverlay({ savedProgress: savedProgress, autoplayAdvance: autoplayAdvance })) {
          if (resumeTimeStr) resumeTimeStr.textContent = formatDuration(savedProgress);
          if (resumeOverlay) resumeOverlay.style.display = 'flex';
          mediaPlayer.autoplay = false;
        } else if (savedProgress > 5) {
          // Overlay suppressed (autoplay just advanced here) WITH real saved
          // progress: resume directly instead of prompting, matching the
          // resumeYesBtn handler below -- autoplay-to-next never interrupts
          // with a "resume?" dialog.
          if (liveMode) {
            startLiveStream(savedProgress, true);
          } else {
            mediaPlayer.currentTime = savedProgress;
            mediaPlayer.play().catch(function () {});
          }
        } else if (liveMode) {
          startLiveStream(0, true);
        } else if (!isMobileViewport()) {
          mediaPlayer.play().catch(function () {});
        }
      })
      .catch(function (e) {
        console.error('Error fetching progress:', e);
      });
  }

  function startProgressSaver() {
    if (progressInterval) clearInterval(progressInterval);
    progressInterval = setInterval(function () {
      if (!mediaPlayer.paused && currentAbsTime() > 0) {
        saveProgressToServer(currentAbsTime());
      }
    }, 4000);
  }

  // Clears the interval only -- no save. Split out from `stopProgressSaver`
  // (below) so the 'ended' handler can stop the ticking saver WITHOUT
  // re-saving the just-ended position (see C2 remediation comment on the
  // 'ended' listener in wireHostListeners).
  function clearProgressInterval() {
    if (progressInterval) {
      clearInterval(progressInterval);
      progressInterval = null;
    }
  }

  // Used by the 'pause' listener: stop the ticking saver AND persist the
  // current position one last time, so a mid-playback pause never loses up
  // to 4s of progress to the interval's own cadence.
  function stopProgressSaver() {
    clearProgressInterval();
    if (mediaPlayer && currentAbsTime() > 0) {
      saveProgressToServer(currentAbsTime());
    }
  }

  // `opts.keepalive` (bug-fix, v1.17.0 two-reviewer gate, FR-5): when true,
  // adds `keepalive: true` to the fetch so the request survives the page
  // being torn down mid-flight (see `handleBackgroundLifecycle` above, the
  // ONLY call site that passes it). Every other call site is unaffected --
  // omitting `opts` (or `opts.keepalive`) reproduces the exact prior
  // request shape/behavior.
  function saveProgressToServer(time, opts) {
    if (!currentId) return;
    var fetchOpts = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: currentId,
        timestamp: time,
        duration: (mediaPlayer && isFinite(mediaPlayer.duration) ? mediaPlayer.duration : 0) || (currentData && currentData.duration) || 0,
      }),
    };
    if (opts && opts.keepalive) fetchOpts.keepalive = true;
    fetch('/api/progress', fetchOpts).catch(function (e) {
      console.error('Error auto-saving progress:', e);
    });
  }

  // (Re)start a desktop live transcode at t seconds into the source.
  function startLiveStream(t, autoplay) {
    liveOffset = Math.max(0, Math.floor(t || 0));
    mediaPlayer.style.display = 'block';
    mediaPlayer.src = '/video/' + currentId + '?live=1&t=' + liveOffset;
    mediaPlayer.load();
    if (autoplay) mediaPlayer.play().catch(function () {});
  }

  // ---- autoplay-next (FR-3, T3) -----------------------------------------------
  //
  // Fires from the SAME 'ended' event T2 already wired (see wireHostListeners
  // below -- this is registered as its OWN listener alongside the existing
  // two, so the existing progress-save-0 / setPlaybackState('none') behavior
  // is completely unchanged whether this is on or off). Reads the persisted
  // server setting fresh on every 'ended' (cheap; 'ended' is a rare event) so
  // a change made on the Settings page while a video is playing elsewhere
  // takes effect on the very next 'ended', with no page reload required.
  //
  // Re-derives the SAME ordered "playlist" + neighbor the watch view's own
  // Prev/Next controls use (deriveOrderedIds/computeNeighbors, common.js,
  // FR-2) from the full library + the persisted `filetube_sort` -- using the
  // identical two pure functions (not a re-implementation) is what guarantees
  // this can never disagree with what Prev/Next show, and it works whether
  // the player is FULL (on the watch page) or DOCKED (browsing elsewhere)
  // when the video ends, since it only reads `currentId` (this controller's
  // own state), never anything from the watch view's DOM.
  //
  // At the end of the order (no nextId) this is a deliberate no-op -- no
  // wrap-around, matching FR-2's Next-disabled behavior exactly.
  //
  // iOS caveat: navigating on 'ended' rides the user-gesture chain that
  // started this playback, so the resulting load is generally allowed to
  // autoplay same as any other in-app watch-page load -- but the existing
  // desktop-only autoplay gate in handleResumePlayback() above still applies
  // to the NEXT video's fresh-start (savedProgress <= 5) case exactly as it
  // would for any other navigation (a related-card click, Prev/Next, a fresh
  // watch load): this deliberately does NOT special-case mobile to re-enable
  // autoplay THERE (that would regress the "no general mobile initial-load
  // autoplay" hard constraint). FR-4b (T3) is a narrower exception: when the
  // NEXT video has real saved progress (>5s), `autoplayAdvancePending` (set
  // just below) suppresses the resume-overlay prompt and resumes directly on
  // EVERY platform -- this is a deliberate, already-in-motion autoplay
  // action continuing itself, not a general initial-load autoplay, so it
  // isn't the case the mobile gate exists to prevent. Whichever play() call
  // the next media's own load ends up attempting is already wrapped in
  // `.catch(() => {})` (mountInSlot/handleResumePlayback/startLiveStream
  // above) -- if iOS treats the gesture chain as lapsed by the time
  // navigate()'s fetch+swap completes and rejects the play(), that rejection
  // is swallowed exactly like every other best-effort play() in this file:
  // the next video ends up loaded and paused, never an error.
  //
  // C6 remediation (v1.16.0): the id whose neighbor we want is CAPTURED here,
  // at 'ended' time (the video that just finished) -- not re-read off the
  // live `currentId` once the two awaited fetches (settings, videos) finally
  // resolve. A fast user nav in between (e.g. tapping a related card or
  // Prev/Next before this resolves) would otherwise change `currentId` out
  // from under this computation, jumping autoplay to the WRONG neighbor. If
  // `currentId` no longer matches the captured id by resolution time, the
  // controller has since moved on to different media -- this is a no-op
  // rather than acting on stale data.
  function handleAutoplayNext() {
    var endedId = currentId;
    if (!endedId) return;
    fetch('/api/settings')
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (settings) {
        if (!settings || !settings.autoplayNext) return; // OFF (default) -- 'ended' behavior stays exactly as today
        return fetch('/api/videos')
          .then(function (res) { return res.json(); })
          .then(function (videos) {
            if (currentId !== endedId) return; // controller has moved on -- stale, no-op
            var sortKey = 'newest';
            try { sortKey = localStorage.getItem('filetube_sort') || 'newest'; } catch (_) { /* storage disabled -- fall back to newest */ }
            var orderedIds = deriveOrderedIds(Array.isArray(videos) ? videos : [], sortKey);
            var neighbors = computeNeighbors(orderedIds, endedId);
            if (!neighbors.nextId) return; // end of the order -- no wrap, no-op
            if (window.FileTube && typeof window.FileTube.navigate === 'function') {
              // FR-4b (T3): arm the one-shot flag IMMEDIATELY before
              // navigating -- consumed by the next video's own
              // handleResumePlayback (via shouldShowResumeOverlay) to skip
              // the resume-overlay prompt for THIS specific advance only.
              autoplayAdvancePending = true;
              window.FileTube.navigate('/watch.html?v=' + encodeURIComponent(neighbors.nextId));
            }
          });
      })
      .catch(function (e) {
        console.error('Autoplay-next check failed:', e);
      });
  }

  // ---- one-time element-scoped listener wiring (never re-run) ----------------
  // Every listener here is attached to the HOST or an element inside it, so it
  // travels with the host wherever it's reparented -- no add/remove churn
  // across FULL<->DOCKED is needed for these. Only the FULL-only DOCUMENT
  // shortcuts (keydown, orientation) are additionally guarded by `state`.
  function wireHostListeners() {
    mediaPlayer.addEventListener('play', startProgressSaver);
    mediaPlayer.addEventListener('pause', stopProgressSaver);
    // C2 remediation (v1.16.0): reset to 0 on 'ended', and do NOT re-save the
    // end position afterward -- `clearProgressInterval()` (unlike
    // `stopProgressSaver()`) only stops the ticking saver, so the
    // just-written 0 is the FINAL persisted value (watched-to-completion
    // starts fresh next time, matching the pre-existing intent of this
    // listener). Using `stopProgressSaver()` here would immediately
    // overwrite the 0 with `currentAbsTime()` (~duration at 'ended'),
    // wrongly popping the "Resume at…" overlay right at the very end and
    // showing ~100% watched on the home card.
    mediaPlayer.addEventListener('ended', function () {
      saveProgressToServer(0);
      clearProgressInterval();
      // FR-4c (T3): also reset the LIVE element position (not just the
      // just-persisted server value above) so replaying is a single tap with
      // a clean poster frame at 0 -- applies to EVERY completed video,
      // independent of the autoplay setting (whether or not the separate
      // handleAutoplayNext listener below goes on to navigate to a next
      // video makes no difference here: a genuine autoplay-advance replaces
      // `mediaPlayer.src` via setupForMedia() moments later anyway, so
      // resetting this element's position first is harmless). Guarded off
      // `liveMode`: a live desktop-transcode source is re-`src`'d (via
      // startLiveStream), never seeked, so touching currentTime here would
      // be meaningless/unsafe.
      if (!liveMode && mediaPlayer) mediaPlayer.currentTime = 0;
    });
    mediaPlayer.addEventListener('play', function () { setPlaybackState('playing'); updatePositionState(true); });
    mediaPlayer.addEventListener('pause', function () { setPlaybackState('paused'); updatePositionState(true); });
    mediaPlayer.addEventListener('ended', function () { setPlaybackState('none'); });
    mediaPlayer.addEventListener('ended', handleAutoplayNext); // FR-3, T3 -- a THIRD, separate 'ended' listener; the two above are untouched
    mediaPlayer.addEventListener('loadedmetadata', function () { updatePositionState(true); });
    mediaPlayer.addEventListener('durationchange', function () { updatePositionState(true); });
    mediaPlayer.addEventListener('seeked', function () { updatePositionState(true); });
    mediaPlayer.addEventListener('ratechange', function () { updatePositionState(true); });
    mediaPlayer.addEventListener('timeupdate', function () { updatePositionState(false); });

    if (resumeYesBtn) {
      resumeYesBtn.addEventListener('click', function () {
        if (resumeOverlay) resumeOverlay.style.display = 'none';
        if (liveMode) {
          startLiveStream(savedProgress, true);
        } else {
          mediaPlayer.currentTime = savedProgress;
          mediaPlayer.play().catch(function () {});
        }
      });
    }
    if (resumeNoBtn) {
      resumeNoBtn.addEventListener('click', function () {
        if (resumeOverlay) resumeOverlay.style.display = 'none';
        if (liveMode) {
          startLiveStream(0, true);
        } else {
          mediaPlayer.currentTime = 0;
          mediaPlayer.play().catch(function () {});
        }
        saveProgressToServer(0);
      });
    }

    if (skipBackBtn) skipBackBtn.addEventListener('click', function () { skip(-SKIP_SECONDS); revealSkipButtons(); });
    if (skipFwdBtn) skipFwdBtn.addEventListener('click', function () { skip(SKIP_SECONDS); revealSkipButtons(); });
    host.addEventListener('mousemove', revealSkipButtons);
    host.addEventListener('mouseleave', hideSkipButtons);

    mediaPlayer.addEventListener('dblclick', function (e) {
      e.preventDefault();
      var rect = mediaPlayer.getBoundingClientRect();
      var onLeft = (e.clientX - rect.left) < rect.width / 2;
      skip(onLeft ? -SKIP_SECONDS : SKIP_SECONDS);
    });

    mediaPlayer.addEventListener('touchstart', function (e) {
      if (inNativeFullscreen() || e.touches.length > 1) {
        clearTimeout(holdTimer);
        releaseHold();
        return;
      }
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      clearTimeout(holdTimer);
      holdTimer = setTimeout(engageHold, HOLD_MS);
    }, { passive: true });

    mediaPlayer.addEventListener('touchmove', function (e) {
      var t = e.touches[0];
      if (!t || holdActive) return;
      if (Math.abs(t.clientX - startX) > MOVE_TOL || Math.abs(t.clientY - startY) > MOVE_TOL) {
        clearTimeout(holdTimer);
      }
    }, { passive: true });

    mediaPlayer.addEventListener('touchcancel', function () {
      clearTimeout(holdTimer);
      releaseHold();
    }, { passive: true });

    mediaPlayer.addEventListener('touchend', function (e) {
      clearTimeout(holdTimer);
      if (holdActive) {
        e.preventDefault();
        releaseHold();
        lastTapTime = 0;
        return;
      }
      var touch = e.changedTouches[0];
      var rect = mediaPlayer.getBoundingClientRect();
      var onLeft = (touch.clientX - rect.left) < rect.width / 2;
      var now = Date.now();
      var gap = now - lastTapTime;
      if (gap > 0 && gap < 350 && onLeft === lastTapLeft) {
        e.preventDefault();
        skip(onLeft ? -SKIP_SECONDS : SKIP_SECONDS);
        lastTapTime = 0;
      } else {
        lastTapTime = now;
        lastTapLeft = onLeft;
        revealSkipButtons();
      }
    }, { passive: false });

    function onEnterFullscreen() { clearTimeout(holdTimer); releaseHold(); }
    document.addEventListener('fullscreenchange', function () { if (document.fullscreenElement) onEnterFullscreen(); });
    mediaPlayer.addEventListener('webkitbeginfullscreen', onEnterFullscreen);

    // Rotate-to-fullscreen (best-effort, FULL-only -- see the top-of-file
    // comment: guarded by `state !== STATE_FULL` so rotating a phone while
    // browsing home/setup with a DOCKED mini-player never yanks it fullscreen).
    var autoFullscreen = false;
    function onFsChange() { if (!inNativeFullscreen()) autoFullscreen = false; }
    document.addEventListener('fullscreenchange', onFsChange);
    mediaPlayer.addEventListener('webkitendfullscreen', onFsChange);

    var mql = window.matchMedia('(orientation: landscape)');
    function onOrientationChange() {
      if (state !== STATE_FULL) return; // FULL-only shortcut/gesture surface
      var landscape = mql.matches;
      try {
        if (landscape && !inNativeFullscreen()) {
          autoFullscreen = true;
          if (mediaPlayer.webkitEnterFullscreen) {
            mediaPlayer.webkitEnterFullscreen();
          } else if (mediaPlayer.requestFullscreen) {
            var p = mediaPlayer.requestFullscreen();
            if (p && p.catch) p.catch(function () { autoFullscreen = false; });
          }
        } else if (!landscape && autoFullscreen && inNativeFullscreen()) {
          autoFullscreen = false;
          if (mediaPlayer.webkitExitFullscreen) {
            mediaPlayer.webkitExitFullscreen();
          } else if (document.exitFullscreen) {
            var p2 = document.exitFullscreen();
            if (p2 && p2.catch) p2.catch(function () {});
          }
        }
      } catch (_) { /* fullscreen refused/unsupported -- ignore */ }
    }
    if (mql.addEventListener) mql.addEventListener('change', onOrientationChange);
    else window.addEventListener('orientationchange', onOrientationChange);

    // Desktop keyboard shortcuts -- FULL-only (see top-of-file comment): a
    // docked mini-player playing while the user types in the home search box
    // must never hijack arrow/space/f/m.
    document.addEventListener('keydown', function (e) {
      if (state !== STATE_FULL) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      var el = document.activeElement;
      var tag = (el && el.tagName) || '';
      if (['INPUT', 'TEXTAREA', 'BUTTON', 'SELECT', 'A'].indexOf(tag) !== -1 || (el && el.isContentEditable)) return;
      if (awaitingTranscode) return;
      switch (e.key) {
        case 'ArrowLeft': e.preventDefault(); skip(-SKIP_SECONDS); break;
        case 'ArrowRight': e.preventDefault(); skip(SKIP_SECONDS); break;
        case ' ':
        case 'Spacebar':
          e.preventDefault();
          if (mediaPlayer.paused) mediaPlayer.play().catch(function () {}); else mediaPlayer.pause();
          break;
        case 'f':
        case 'F': {
          e.preventDefault();
          if (document.fullscreenElement) {
            document.exitFullscreen();
          } else if (mediaPlayer.requestFullscreen) {
            var p3 = mediaPlayer.requestFullscreen();
            if (p3 && p3.catch) p3.catch(function () {});
          }
          break;
        }
        case 'm':
        case 'M':
          e.preventDefault();
          mediaPlayer.muted = !mediaPlayer.muted;
          break;
      }
    });
  }

  // ---- per-media setup (runs on every genuine, non-adopt load()) -------------

  function teardownMediaState() {
    loadGeneration++; // invalidate any in-flight poll/resume-check tied to the previous media
    if (progressInterval) { clearInterval(progressInterval); progressInterval = null; }
    if (transcodePollTimer) { clearTimeout(transcodePollTimer); transcodePollTimer = null; }
    resetTransientPlaybackUi();
    awaitingTranscode = false;
    liveMode = false;
    liveOffset = 0;
    savedProgress = 0;
    if (resumeOverlay) resumeOverlay.style.display = 'none';
    if (transcodeOverlay) transcodeOverlay.style.display = 'none';
    if (transcodeSpinner) transcodeSpinner.classList.remove('failed');
    if (host) host.classList.remove('audio-mode');
    if (audioBgArt) { audioBgArt.style.display = 'none'; audioBgArt.style.backgroundImage = ''; }
    if (audioVisualizer) audioVisualizer.style.display = 'none';
    if (skipControls) skipControls.style.display = 'none';
    if (mediaPlayer) mediaPlayer.pause();
  }

  function setupForMedia(id, data) {
    var gen = loadGeneration;
    var streamUrl = '/video/' + id;

    if (data.type === 'audio') {
      mediaPlayer.style.display = 'block';
      mediaPlayer.poster = '/thumbnail/' + id;
      mediaPlayer.src = streamUrl;

      if (AUDIO_PLAYER_MODE === 'background') {
        var artUrl = resolveAudioArtUrl(data);
        if (artUrl) {
          audioBgArt.style.backgroundImage = 'url("' + artUrl + '")';
          audioBgArt.style.display = 'block';
          host.classList.add('audio-mode');
        }
      } else {
        audioVisualizer.style.display = 'flex';
        if (audioVisualTitle) audioVisualTitle.textContent = data.title || '';
        if (audioVisualFolder) audioVisualFolder.textContent = data.folderName || '';
      }
    } else {
      mediaPlayer.style.display = 'block';
      if (skipControls) skipControls.style.display = 'block';

      if (data.needsTranscode) {
        if (!isMobileViewport()) {
          liveMode = true;
        } else if (data.transcodeStatus === 'ready') {
          mediaPlayer.src = streamUrl;
        } else {
          awaitingTranscode = true;
          mediaPlayer.style.display = 'none';
          showTranscodeOverlay();
          fetch(streamUrl).catch(function () {}); // trigger the on-demand transcode
          pollTranscodeUntilReady(gen, id);
        }
      } else {
        mediaPlayer.src = streamUrl;
      }
    }

    setupMediaSession(id, data.channelName, data.title);

    // `handleResumePlayback` itself branches on `liveMode` (only starting the
    // live stream at 0 when there's no meaningful saved position) -- it must
    // run for EVERY load, live or not, so a live-transcode item with real
    // saved progress still shows the resume overlay instead of always
    // restarting at 0 (a live stream's resume/skip-from choices are wired
    // through liveMode in the resume button handlers above).
    handleResumePlayback(gen, id);
  }

  // ---- mount / dock / close ----------------------------------------------------

  function mountInSlot(slotEl) {
    if (!host || !slotEl) return;
    var wasPlaying = mediaPlayer && !mediaPlayer.paused;
    if (host.parentNode !== slotEl) {
      slotEl.appendChild(host);
    }
    state = STATE_FULL;
    hideDock();
    if (wasPlaying && mediaPlayer.paused) mediaPlayer.play().catch(function () {});
  }

  function expand(slotEl) {
    mountInSlot(slotEl);
  }

  function ensureDockChrome(dockEl) {
    if (dockChromeReady) return;
    if (!dockEl) return;
    dockCloseBtn = document.createElement('button');
    dockCloseBtn.type = 'button';
    dockCloseBtn.className = 'player-dock-close';
    dockCloseBtn.setAttribute('aria-label', 'Close mini player');
    dockCloseBtn.textContent = '×';
    dockCloseBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      close();
    });
    dockEl.appendChild(dockCloseBtn);
    dockEl.addEventListener('click', function () {
      if (state !== STATE_DOCKED || !currentId) return;
      var url = '/watch.html?v=' + encodeURIComponent(currentId);
      if (window.FileTube && typeof window.FileTube.navigate === 'function') window.FileTube.navigate(url);
      else window.location.href = url;
    });
    dockChromeReady = true;
  }

  function hideDock() {
    var dockEl = document.getElementById('player-dock');
    if (dockEl) dockEl.hidden = true;
  }

  function dock() {
    if (!host || !mediaPlayer || !currentId || state === STATE_CLOSED || state === STATE_DOCKED) return;
    var dockEl = document.getElementById('player-dock');
    if (!dockEl) return;
    ensureDockChrome(dockEl);
    var wasPlaying = !mediaPlayer.paused;
    resetTransientPlaybackUi();
    if (host.parentNode !== dockEl) dockEl.appendChild(host);
    dockEl.hidden = false;
    state = STATE_DOCKED;
    if (wasPlaying && mediaPlayer.paused) mediaPlayer.play().catch(function () {});
  }

  function close() {
    loadGeneration++; // invalidate any in-flight poll/resume-check
    if (progressInterval) { clearInterval(progressInterval); progressInterval = null; }
    if (transcodePollTimer) { clearTimeout(transcodePollTimer); transcodePollTimer = null; }
    resetTransientPlaybackUi();
    if (mediaPlayer) {
      try {
        mediaPlayer.pause();
        mediaPlayer.removeAttribute('src');
        mediaPlayer.load();
      } catch (_) { /* best-effort only */ }
    }
    setPlaybackState('none');
    hideDock();
    if (host && host.parentNode) host.parentNode.removeChild(host); // fully detach -- not merely hidden
    state = STATE_CLOSED;
    currentId = null;
    currentData = null;
    awaitingTranscode = false;
    liveMode = false;
  }

  // The main entry point watch.js calls on every view init(). See the
  // top-of-file API doc for the adopt/no-restart contract.
  function load(id, data, opts) {
    var options = opts || {};
    if (!ensureHost()) return false;
    var adopt = isAdoptLoad(currentId, id, state);
    if (adopt) {
      expand(options.slot);
      return true;
    }
    // Bug-fix (v1.17.0 two-reviewer gate, FR-4b leak): capture+reset the
    // autoplay-advance flag HERE, at the earliest point of every genuine
    // NEW load -- before teardownMediaState()/setupForMedia() do anything
    // else -- so the global can never survive past the start of the very
    // next load, no matter what happens (transcode pending/failed, the user
    // navigating away) during THIS load's own resume decision.
    var capturedAutoplayAdvance = captureAutoplayAdvanceForLoad(autoplayAdvancePending);
    loadAutoplayAdvance = capturedAutoplayAdvance.value;
    autoplayAdvancePending = capturedAutoplayAdvance.nextPending;
    teardownMediaState();
    currentId = id;
    currentData = data || {};
    mountInSlot(options.slot);
    setupForMedia(id, currentData);
    return true;
  }

  var api = {
    load: load,
    expand: expand,
    dock: dock,
    close: close,
    getState: function () { return state; },
  };
  Object.defineProperty(api, 'currentId', {
    enumerable: true,
    get: function () { return currentId; },
  });

  window.FileTube = window.FileTube || {};
  window.FileTube.player = api;
})();
