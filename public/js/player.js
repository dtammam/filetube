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
//   isLoopEnabled()/setLoop(on) -- FR-7 (TF, v1.22.0): read/write the
//                                  watch-page-local loop/repeat preference
//                                  (`localStorage['ft-loop']`), acted on by
//                                  the persistent 'ended' listener below;
//                                  watch.js's setupLoopToggle drives these
//                                  rather than duplicating the storage key.
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
//
// FR-8(a) (TG, v1.22.0, AC55-AC57): `ctx.isMobile` scopes the VIDEO branch to
// mobile/PWA form factors only -- reusing the SAME `isMobileFormFactor()`
// signal FR-1 introduces (AC78, never a second/divergent "is this mobile"
// implementation; see the call site, `handleBackgroundLifecycle` below). On
// DESKTOP, backgrounding the tab (switching tabs, a second monitor, minimizing)
// no longer pauses a playing video -- Dean's cross-tab-playback ask -- while
// the existing MOBILE "smart" behavior (pause+persist a backgrounded video,
// keep audio going) is completely unchanged (AC57). Audio stays exempt either
// way via the `ctx.isAudio` check above, untouched.
var LIFECYCLE_PAUSE_EVENTS = { pagehide: true, freeze: true, visibilitychangeHidden: true };
function shouldPauseForLifecycleEvent(eventType, ctx) {
  if (!LIFECYCLE_PAUSE_EVENTS[eventType]) return false;
  if (!ctx || !ctx.isPlaying) return false; // nothing playing -- no-op
  if (ctx.isAudio) return false; // audio/background-music: keep playing in the background
  return !!ctx.isMobile; // video: pause + persist only on mobile/PWA form factors (desktop keeps playing across tabs)
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

// ---- FR-2 (T2, v1.21.0): custom control-bar pure helpers -------------------
// Both hoisted above the browser-only runtime below, same "pure helpers
// first" split every other state-machine decision in this file already uses
// (see the module comment above `isAdoptLoad`) -- this is what makes them
// directly `node:test`-able with no DOM/browser harness.

// Clamp a raw (string or number) volume value into [0, 1]. Returns `null`
// for anything that doesn't parse to a finite number at all (garbage, NaN,
// an empty string, `null`/`undefined` -- e.g. a corrupt/tampered
// `localStorage['ft-volume']` entry, or no stored value yet); the caller
// treats `null` as "no usable stored preference" and leaves the element's
// current/default volume alone rather than silently coercing garbage to 0.
// An out-of-range but otherwise-numeric value (e.g. `1.5`, `-0.2`, a stale
// value from a future version with a wider range) is clamped to the nearest
// bound instead of being rejected -- only genuinely unparseable input
// produces `null` (AC10, unit-tested against both cases).
function clampVolume(raw) {
  var n = typeof raw === 'number' ? raw : parseFloat(raw);
  if (!isFinite(n)) return null;
  return Math.max(0, Math.min(1, n));
}

// Pure reducer for the seek bar's `change` (commit) handler (AC15/AC16):
// given the slider's [0,1] ratio and the source's duration, returns the
// absolute target time in seconds to seek (or, for a live-transcode source,
// restart the stream) to. `liveMode`/`liveTotal` mirror the existing skip()
// live-transcode handling above -- for a desktop live-transcode source,
// `duration` (typically `mediaPlayer.duration`) reflects only the SHORT,
// currently-live-restarted stream, not the full original source, so the
// ratio must instead be applied against `liveTotal` (the full source
// duration, e.g. `currentData.duration`). `ratio` is clamped to [0,1] and
// the result is clamped to [0, total] so an out-of-range ratio, or a total
// that hasn't resolved yet (0/NaN/Infinity), can never produce a negative or
// NaN seek target -- it degrades to `0` instead.
//
// v1.21 FIX 5 (post-gate hardening, optional): in live mode, an absent/
// unresolved `liveTotal` NO LONGER falls back to `duration` -- `duration`
// (the short live-restarted stream's own length, e.g. a few buffered
// seconds) is a completely different quantity than the full source length a
// ratio must be resolved against here, so silently substituting it could
// compute a wildly WRONG absolute seek target (e.g. a "seek to the middle"
// tap landing seconds from the very start of a long video, because the
// ratio was applied against the short buffered window instead of the real
// total). Treating an unresolved `liveTotal` the SAME as an unresolved
// `duration` in the non-live branch below -- degrade to `0` -- is honest
// about not yet knowing the real total, rather than confidently returning a
// plausible-looking but incorrect number.
function seekCommitTarget(ctx) {
  var opts = ctx || {};
  var liveMode = !!opts.liveMode;
  var total = liveMode ? opts.liveTotal : opts.duration;
  if (!isFinite(total) || total <= 0) return 0;
  var ratio = opts.ratio;
  if (!isFinite(ratio)) ratio = 0;
  ratio = Math.max(0, Math.min(1, ratio));
  return Math.max(0, Math.min(total, ratio * total));
}

// v1.21 post-gate hardening (FIX 1): pure single-vs-double-tap decision
// table behind the touchend handling in `wireSkipHoldGestures` below (see
// that function -- attached to BOTH the video surface, `#media-player`, and
// the audio cover-art surface, `#audio-bg-art`, so +-15s double-tap-skip
// works for both media types, per AC12). Given the gap since the previous
// tap and whether both taps landed on the same half of the interaction
// surface, returns whether THIS tap completes a double-tap (`'skip-back'`/
// `'skip-fwd'`) or is -- so far -- only a single-tap candidate
// (`'single-tap'`). Deliberately does NOT decide press-and-hold-2x: a hold
// is a function of ELAPSED HOLD TIME (armed by a `setTimeout` at
// `touchstart`, see `engageHold`), not of touchend classification, so
// folding it into this table would be artificial -- `wireSkipHoldGestures`
// still runs its own, untouched `if (holdActive)` short-circuit first,
// exactly as the video surface always has.
function classifyTapGesture(ctx) {
  var opts = ctx || {};
  var gap = opts.now - opts.lastTapTime;
  if (opts.lastTapTime > 0 && gap > 0 && gap < opts.doubleTapMs && opts.onLeft === opts.lastTapLeft) {
    return opts.onLeft ? 'skip-back' : 'skip-fwd';
  }
  return 'single-tap';
}

// v1.21 FIX A (post-post-gate correction -- docked-audio tap-to-expand
// regression introduced by FIX 1): pure gate behind the touchend
// single-tap branch in `wireSkipHoldGestures` below. `onSingleTap` (the
// audio cover-art play/pause toggle) is only ever meaningful while FULL --
// mirrors the mouse `#audio-bg-art` 'click' listener's existing
// `state !== STATE_FULL` guard, which the touch path had been missing.
// When this returns false (no `onSingleTap` at all -- i.e. the video
// surface -- or audio but DOCKED/CLOSED), the caller must NOT
// preventDefault/arm the toggle, so the tap's synthetic 'click' is left
// free to bubble to `#player-dock`'s tap-to-expand handler exactly as it
// did before FIX 1.
function shouldArtSingleTapAct(state, onSingleTap) {
  return !!onSingleTap && state === 'full';
}

// ---- FR-1 (T1, v1.22.0 -- retired v1.22.1): mobile-form-factor pure helper -
// See the exec plan's "## Design (FR-1)" (docs/exec-plans/active/
// 2026-07-07-v1.22.1-mobile-player-fixes.md). Hoisted here, same "pure
// helpers first" split as every other decision above, so it's directly
// `node:test`-able with no DOM/browser harness.
//
// v1.22.1 FR-1: the sibling helper that used to live here,
// `resolveControlsMode(mediaType, isMobile)`, is REMOVED. It decided
// `'native'` (the iOS `controls` attribute) vs. `'custom'` (this file's own
// control bar) -- but the `'native'` case (mobile video) is exactly the
// v1.22.0 regression this round fixes: iOS's inline `<video controls
// playsinline>` strip auto-hides during playback and never reliably
// re-reveals under FileTube's own gesture layer, leaving mobile-video users
// with NO visible controls at all. The fix retires the native-controls path
// entirely -- mobile video now routes through the SAME custom
// `#player-controls` bar already used by desktop video/audio and mobile
// audio, so every case is `'custom'` and the lookup is vestigial. See
// `applyControlsMode()` below, which now only toggles `.ff-mobile` (CSS
// touch-sizing/volume-hiding) and always removes the `controls` attribute.
function resolveMobileFormFactor(signals) {
  var opts = signals || {};
  if (opts.coarsePointer === undefined || opts.noHover === undefined) {
    return !!opts.narrowViewport; // unsupported media query -- fall back to width
  }
  return !!(opts.coarsePointer && opts.noHover);
}

// ---- FR-7 (TF, v1.22.0): loop/repeat pure decision helper ------------------
// Given the loop toggle's state, the persisted `autoplayNext` setting, and
// whether a next item exists in the derived playlist order, decides what the
// 'ended' handler should do: `'repeat'` (replay this item), `'advance'`
// (autoplay to the next item), or `'stop'` (today's default -- leave it
// reset at 0). `loop: true` ALWAYS yields `'repeat'`, regardless of
// `autoplayNext`'s value or whether a next item even exists -- loop takes
// precedence over autoplay-advance, per Dean's reconciliation instruction
// (loop = repeat THIS; autoplay = next), AC49's regression lock. This is a
// pure lookup table over explicit booleans (no DOM/storage read) so it's
// directly `node:test`-able; the live 'ended'-cluster wiring below (the new
// loop listener + `handleAutoplayNext`'s early-return) is a hand-written
// mirror of this exact precedence against LIVE state read at 'ended' time.
function resolveEndedAction(ctx) {
  var opts = ctx || {};
  if (opts.loop) return 'repeat';
  if (opts.autoplayNext && opts.hasNext) return 'advance';
  return 'stop';
}

// ---- FR-4 (T1, v1.22.1): persistent playback-speed pure helper ------------
// The fixed cycle of rates `#speed-btn` steps through on every click/tap:
// 1x -> 1.25x -> 1.5x -> 1.75x -> 2x -> 1x (wraps). Kept as a MODULE-LEVEL
// constant (not a function-local literal) so the live click handler below
// and this pure helper always agree on the exact same list.
var PLAYBACK_RATES = [1, 1.25, 1.5, 1.75, 2];

// Given the CURRENTLY active rate, returns the NEXT rate in the cycle above.
// An unrecognized `current` (e.g. the element's default `1` read before any
// `#speed-btn` interaction has ever happened, or a stale/foreign value) is
// treated the same as "start of the cycle" -- returns the FIRST rate, never
// throws or produces `NaN`/`undefined`. Deliberately a pure lookup (no DOM),
// per the "pure helpers first" split every other decision in this file uses
// -- the live handler (`wireHostListeners`, below) is a thin mirror that
// calls this then sets `mediaPlayer.playbackRate` + the button's label.
function nextPlaybackRate(current) {
  var idx = PLAYBACK_RATES.indexOf(current);
  if (idx === -1) return PLAYBACK_RATES[0];
  return PLAYBACK_RATES[(idx + 1) % PLAYBACK_RATES.length];
}

// ---- FR-5 (T1, v1.22.1): desktop click-video-to-toggle-play/pause guard ---
// Pure gate behind the new desktop-only `#media-player` 'click' listener
// (`wireHostListeners`, below), mirroring `shouldArtSingleTapAct`'s role for
// the audio cover-art surface. Acts ONLY while FULL (matches every other
// FULL-only gesture/shortcut guard in this file) AND only on a non-mobile
// form factor (AC29 -- desktop-only; reuses the SAME `isMobileFormFactor()`
// signal the caller passes in, never a second/divergent "is this mobile"
// check). Mobile video's existing gesture layer and FR-1's custom-bar fix
// are completely untouched by this -- on mobile, taps are owned by `#pp-btn`
// and `wireSkipHoldGestures`, not this listener.
function shouldDesktopVideoTapToggle(playerState, isMobile) {
  return playerState === 'full' && !isMobile;
}

// ---- FR-1 (T1, v1.22.2): #fs-btn audio-vs-video branch decision -----------
// iPhone Safari refuses `requestFullscreen()`/`webkitEnterFullscreen()` on a
// non-video element, so `#fs-btn`'s native-Fullscreen-API path (see
// `enterFullscreen()` below) is a dead no-op for audio -- exactly why
// v1.22.1 hid the button for mobile audio in the first place. This round
// re-shows it (style.css, T2) and gives the SAME button a second, CSS-only
// destination for audio: a full-viewport `.audio-expanded` class toggle on
// `host` (`#player-wrapper`), never the Fullscreen API. This pure lookup is
// the exact seam the live `#fs-btn` click handler branches on (below) --
// kept here, `node:test`-able with no DOM, so the audio/video split is
// locked independently of the live handler's own wiring.
function resolveFsButtonAction(ctx) {
  var opts = ctx || {};
  return opts.audioMode ? 'audio-expand' : 'native-fullscreen';
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
    clampVolume,
    seekCommitTarget,
    classifyTapGesture,
    shouldArtSingleTapAct,
    resolveMobileFormFactor,
    resolveEndedAction,
    nextPlaybackRate,
    shouldDesktopVideoTapToggle,
    resolveFsButtonAction,
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

  // FR-2 (T2, v1.21.0): the custom control bar + cover-art play/pause glyph.
  var playerControls, ppBtn, timeCur, seekBar, timeDur, muteBtn, volBar, fsBtn, artPlayGlyph;

  // FR-8(b) (TG, v1.22.0): native Picture-in-Picture button, queried/wired
  // once alongside the rest of the custom bar above.
  var pipBtn;

  // FR-4 (T1, v1.22.1): persistent playback-speed cycle button, queried/
  // wired once alongside the rest of the custom bar above.
  var speedBtn;

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

  // FR-2 (T2, v1.21.0): seek-bar scrub/fill-loop + volume-persistence state.
  var isScrubbing = false;      // seek-bar drag in progress -- visual only, no currentTime commit until 'change'
  var seekFillRafId = null;     // requestAnimationFrame handle for the seek-bar fill loop; null when not running
  var artGlyphTimer = null;     // fade-out timer for the cover-art play/pause overlay glyph
  var volumeSettable = true;    // iOS Safari feature-detect result (see volumeIsSettable); assumed true until probed
  var VOLUME_STORAGE_KEY = 'ft-volume';
  var MUTED_STORAGE_KEY = 'ft-muted';
  var LOOP_STORAGE_KEY = 'ft-loop'; // FR-7 (TF, v1.22.0) -- watch-page-local preference, NOT a server db.settings setting (mirrors the v1.21 FR-9 ft-theater pattern)
  var RATE_STORAGE_KEY = 'ft-rate'; // FR-4 (T1, v1.22.1) -- watch-page-local preference, same pattern as VOLUME/LOOP above

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

  // FR-1 (T1, v1.22.0): browser wrapper around `resolveMobileFormFactor`
  // (pure, above) -- reads the actual `window.matchMedia` results and
  // delegates the decision to the pure helper. Detects an unsupported media
  // query the same way every browser does: an unrecognized/invalid query
  // string normalizes to `mql.media === 'not all'`, which is reported as
  // `undefined` so the pure helper falls back to width. This is the SAME
  // named helper FR-8(a) reuses for its pause-on-hidden scoping (AC78) --
  // never a second, divergent "is this mobile" implementation.
  function matchMediaBool(query) {
    if (typeof window.matchMedia !== 'function') return undefined;
    var mql = window.matchMedia(query);
    if (mql.media === 'not all') return undefined; // query unsupported by this engine
    return mql.matches;
  }

  function isMobileFormFactor() {
    return resolveMobileFormFactor({
      coarsePointer: matchMediaBool('(pointer: coarse)'),
      noHover: matchMediaBool('(hover: none)'),
      narrowViewport: window.matchMedia('(max-width: 768px)').matches,
    });
  }

  // FR-1 (T1, v1.22.0 -- RETIRED, v1.22.1): the impure applier. v1.22.0 used
  // this to decide native-vs-custom control surface for the CURRENTLY loaded
  // media; v1.22.1 retires the native `controls` path entirely (see the pure
  // helper section above) -- iOS's inline `<video controls playsinline>`
  // strip auto-hides during playback and does not reliably re-reveal under
  // this file's own gesture layer, leaving mobile-video users with NO
  // visible controls at all (v1.22.1 FR-1, the CRITICAL regression this
  // fixes). Mobile video now routes through the SAME always-rendered custom
  // `#player-controls` bar desktop video/audio and mobile audio already use,
  // so there is no more per-media-type/per-form-factor branch here: this
  // function ALWAYS removes the `controls` attribute, and its only remaining
  // job is toggling `.ff-mobile` on `host` (`#player-wrapper`) from
  // `isMobileFormFactor()` -- still needed by CSS for mobile touch-target
  // sizing and volume-control hiding (T2's `style.css` changes). Called
  // synchronously from `mountInSlot()`/`dock()` -- the existing
  // reparent/state-transition points -- never from a `matchMedia`
  // change-listener (AC7: capability is stable across orientation/resize, so
  // re-deriving live is unnecessary).
  function applyControlsMode() {
    if (!host || !mediaPlayer) return;
    var mobile = isMobileFormFactor();
    host.classList.toggle('ff-mobile', mobile);
    mediaPlayer.removeAttribute('controls');
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
    playerControls = host.querySelector('#player-controls');
    ppBtn = host.querySelector('#pp-btn');
    timeCur = host.querySelector('#time-cur');
    seekBar = host.querySelector('#seek-bar');
    timeDur = host.querySelector('#time-dur');
    muteBtn = host.querySelector('#mute-btn');
    volBar = host.querySelector('#vol-bar');
    fsBtn = host.querySelector('#fs-btn');
    pipBtn = host.querySelector('#pip-btn');
    speedBtn = host.querySelector('#speed-btn');
    artPlayGlyph = host.querySelector('#art-play-glyph');
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
      isMobile: isMobileFormFactor(), // FR-8(a) (TG, v1.22.0): reuse FR-1's shared signal (AC78), not a second one
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
  // v1.22.1 FR-2 (bug-fix): raised from `10` -- the hold-cancel tolerance
  // used ONLY by the `touchmove` listener below to abort an armed
  // `holdTimer` (press-and-hold-2x). At `10`px, ordinary thumb jitter during
  // a genuine stationary-ish press-and-hold on mobile (most reproducible on
  // `#audio-bg-art`, the cover-art surface, but shared by `#media-player`
  // too) easily exceeded the tolerance before `HOLD_MS` elapsed, so
  // `engageHold` never fired and 2x never engaged. This does NOT affect
  // tap/double-tap classification (`classifyTapGesture`, above) -- that
  // table is driven purely by tap POSITION and timing, never by movement.
  var MOVE_TOL = 16;
  // v1.21 FIX 1 (post-gate hardening): the double-tap/double-click window,
  // named+shared so `wireSkipHoldGestures`'s touchend classification and the
  // audio cover-art's `scheduleArtSingleTap` debounce (below) always agree
  // on how long a "was this the first half of a double-tap?" pause lasts --
  // was a bare `350` literal inline in the (now-factored) touchend handler.
  var DOUBLE_TAP_MS = 350;
  // Pending single-tap/single-click play-pause action on the audio cover-art
  // surface (`#audio-bg-art`), armed by `scheduleArtSingleTap` and cancelled
  // by `cancelPendingArtTap` -- see both, below.
  var pendingArtTapTimer = null;

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

  // v1.21 FIX 1 (post-gate hardening, both reviewers -- FR-2 regression,
  // AC12): schedules `action` (the audio cover-art's single-tap/single-click
  // play-pause toggle) to run after `DOUBLE_TAP_MS`, UNLESS
  // `cancelPendingArtTap` is called first -- by `wireSkipHoldGestures`'s own
  // touchend double-tap branch (touch path) or by the `#audio-bg-art` click
  // listener itself on a second click within the window (mouse path, see
  // `wireHostListeners`). Without this, a double-tap/double-click-to-skip
  // would ALSO fire the single-tap play-pause toggle from its first
  // tap/click before the skip landed -- the "double-toggle flicker" both the
  // QA and adversarial gate flagged.
  function scheduleArtSingleTap(action) {
    cancelPendingArtTap();
    pendingArtTapTimer = setTimeout(function () {
      pendingArtTapTimer = null;
      action();
    }, DOUBLE_TAP_MS);
  }

  function cancelPendingArtTap() {
    if (pendingArtTapTimer) {
      clearTimeout(pendingArtTapTimer);
      pendingArtTapTimer = null;
    }
  }

  // v1.21 FIX 1 (post-gate hardening, both reviewers -- FR-2 regression,
  // AC12): the dblclick + touchstart/touchmove/touchcancel/touchend
  // ±15s-skip/press-hold-2x gesture wiring, factored out of
  // `wireHostListeners` so it can be attached to WHICHEVER surface is the
  // active interaction target for the current media -- `#media-player`
  // (video; every item that isn't `.audio-mode`) or `#audio-bg-art` (audio;
  // FR-2 made `#media-player` `pointer-events: none` in `.audio-mode`, see
  // style.css, so the cover-art layer is what actually receives taps there).
  // Root cause this fixes: before this factor-out, these gestures were
  // wired ONLY on `#media-player`, so once FR-2 shipped they went dead for
  // every audio item (AC12 requires ±15s skip -- buttons/double-tap/
  // hold-2x/keyboard -- for BOTH audio and video).
  //
  // `onSingleTap`, when provided, is invoked once a touchend has been
  // classified as a (so far) lone tap AND `DOUBLE_TAP_MS` has since elapsed
  // with no follow-up double-tap -- i.e. only ever passed for
  // `#audio-bg-art` (the FR-2 cover-art click-to-play/pause toggle,
  // debounced via `scheduleArtSingleTap`/`cancelPendingArtTap` above).
  // Called with no second argument for `#media-player`, every statement
  // below is IDENTICAL to the pre-fix inline wiring that used to live in
  // `wireHostListeners` -- video's dblclick/touch skip and press-hold-2x
  // behavior is byte-for-byte unchanged by this refactor.
  function wireSkipHoldGestures(el, onSingleTap) {
    if (!el) return;

    el.addEventListener('dblclick', function (e) {
      e.preventDefault();
      var rect = el.getBoundingClientRect();
      var onLeft = (e.clientX - rect.left) < rect.width / 2;
      skip(onLeft ? -SKIP_SECONDS : SKIP_SECONDS);
    });

    el.addEventListener('touchstart', function (e) {
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

    el.addEventListener('touchmove', function (e) {
      var t = e.touches[0];
      if (!t || holdActive) return;
      if (Math.abs(t.clientX - startX) > MOVE_TOL || Math.abs(t.clientY - startY) > MOVE_TOL) {
        clearTimeout(holdTimer);
      }
    }, { passive: true });

    el.addEventListener('touchcancel', function () {
      clearTimeout(holdTimer);
      releaseHold();
    }, { passive: true });

    el.addEventListener('touchend', function (e) {
      clearTimeout(holdTimer);
      if (holdActive) {
        e.preventDefault();
        releaseHold();
        lastTapTime = 0;
        return;
      }
      var touch = e.changedTouches[0];
      var rect = el.getBoundingClientRect();
      var onLeft = (touch.clientX - rect.left) < rect.width / 2;
      var now = Date.now();
      var gesture = classifyTapGesture({
        now: now,
        lastTapTime: lastTapTime,
        lastTapLeft: lastTapLeft,
        onLeft: onLeft,
        doubleTapMs: DOUBLE_TAP_MS,
      });
      if (gesture === 'skip-back' || gesture === 'skip-fwd') {
        e.preventDefault();
        if (onSingleTap) cancelPendingArtTap(); // the pending single-tap toggle from this double-tap's FIRST half must never fire
        skip(gesture === 'skip-back' ? -SKIP_SECONDS : SKIP_SECONDS);
        lastTapTime = 0;
      } else {
        lastTapTime = now;
        lastTapLeft = onLeft;
        revealSkipButtons();
        if (shouldArtSingleTapAct(state, onSingleTap)) {
          // Suppress the synthetic 'click' the browser would otherwise
          // dispatch after this touchend -- the tap is handled entirely by
          // the debounced timer below, so a stray synthetic click could
          // otherwise double-fire the toggle. `#media-player` (no
          // `onSingleTap`) never reaches this branch, so video's touchend
          // keeps its original never-preventDefault-on-a-single-tap
          // behavior exactly as before.
          //
          // v1.21 FIX A (post-post-gate correction): gated to
          // `state === STATE_FULL` via `shouldArtSingleTapAct` -- while
          // DOCKED, this branch must NOT preventDefault/arm the toggle, so
          // the tap's synthetic 'click' is left to bubble to
          // `#player-dock`'s tap-to-expand handler, restoring docked-audio
          // tap-to-expand on touch (a regression FIX 1 introduced by running
          // this branch unconditionally). Video (`#media-player`, no
          // `onSingleTap`) is unaffected either way.
          e.preventDefault();
          scheduleArtSingleTap(onSingleTap);
        }
      }
    }, { passive: false });
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
    // FR-7 (TF, v1.22.0, AC49): loop takes precedence over autoplay-advance
    // -- when loop is ON, the new loop listener below (registered alongside
    // this one in wireHostListeners) replays THIS item instead, so this
    // entire autoplay-advance path must short-circuit BEFORE doing any of
    // its own settings/videos fetches. Mirrors `resolveEndedAction`'s
    // `loop: true` -> `'repeat'` precedence exactly.
    if (isLoopEnabled()) return;
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

  // ---- FR-2 (T2, v1.21.0): custom blocky control bar -------------------------
  //
  // Replaces the native <audio>/<video controls> bar (unstyleable -- the
  // pure-white-in-dark-mode + rounded/derpy look) with app-owned markup
  // themed entirely off the era CSS variables (see style.css's "v1.21 FR-2"
  // section). Every listener that drives it is wired exactly once, from
  // wireHostListeners() below, so the bar rides the persistent host across
  // FULL/DOCKED/CLOSED "by construction" -- same guarantee every other
  // listener in this file already has.

  // ---- play/pause ----------------------------------------------------------

  function updatePlayPauseUI() {
    if (!ppBtn || !mediaPlayer) return;
    var playing = !mediaPlayer.paused && !mediaPlayer.ended;
    ppBtn.classList.toggle('is-playing', playing);
    ppBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    ppBtn.setAttribute('aria-pressed', playing ? 'true' : 'false');
  }

  function togglePlayPause() {
    if (!mediaPlayer) return;
    if (mediaPlayer.paused) mediaPlayer.play().catch(function () {});
    else mediaPlayer.pause();
  }

  // v1.21 FIX 1 (post-gate hardening): the audio cover-art surface's actual
  // single-tap/single-click play-pause action -- factored so both the
  // `#audio-bg-art` 'click' listener (mouse path) and
  // `wireSkipHoldGestures`'s `onSingleTap` callback (touch path) invoke the
  // IDENTICAL toggle-then-flash-glyph behavior via `scheduleArtSingleTap`,
  // rather than two independently-written copies drifting apart.
  function toggleArtPlayPause() {
    if (!mediaPlayer) return;
    var willPlay = mediaPlayer.paused;
    togglePlayPause();
    flashArtGlyph(willPlay);
  }

  // Cover-art click-to-play overlay glyph (AC9): flashes via the same
  // remove/reflow/add idiom `flashRipple` (above) already uses for the
  // skip-ripple feedback, so a rapid repeat click always re-triggers the fade.
  function flashArtGlyph(playing) {
    if (!artPlayGlyph) return;
    artPlayGlyph.classList.toggle('art-play-glyph-playing', playing);
    artPlayGlyph.classList.remove('art-play-glyph-flash');
    void artPlayGlyph.offsetWidth; // force reflow so rapid repeats re-trigger the animation
    artPlayGlyph.classList.add('art-play-glyph-flash');
    if (artGlyphTimer) clearTimeout(artGlyphTimer);
    artGlyphTimer = setTimeout(function () {
      if (artPlayGlyph) artPlayGlyph.classList.remove('art-play-glyph-flash');
      artGlyphTimer = null;
    }, 650);
  }

  // ---- seek: visual scrub (rAF fill loop) vs. committed change -------------

  // The duration to measure the seek ratio against -- for a live-transcode
  // source this is the FULL original source length (currentData.duration),
  // not `mediaPlayer.duration` (which only reflects the short, currently
  // live-restarted stream). Mirrors `seekCommitTarget`'s own liveMode branch.
  //
  // v1.21 FIX C (post-post-gate correction, cosmetic): an absent/unresolved
  // `currentData.duration` in live mode no longer falls back to
  // `mediaPlayer.duration` (the short live-restarted stream's own length) --
  // degrades to `0` instead, exactly like `seekCommitTarget`'s FIX 5 does for
  // the committed seek target, so the visual fill bar/time and the actual
  // commit always agree on the absent-liveTotal case rather than the fill
  // bar showing a plausible-looking but wrong total.
  function seekTotalDuration() {
    if (liveMode) return (currentData && currentData.duration) || 0;
    return (mediaPlayer && mediaPlayer.duration) || 0;
  }

  function updateSeekVisual() {
    if (!mediaPlayer) return;
    var total = seekTotalDuration();
    var cur = currentAbsTime();
    var ratio = total > 0 ? Math.max(0, Math.min(1, cur / total)) : 0;
    if (seekBar) {
      seekBar.value = String(ratio);
      seekBar.style.setProperty('--seek-fill', (ratio * 100) + '%');
    }
    if (timeCur) timeCur.textContent = formatDuration(cur);
    if (timeDur) timeDur.textContent = formatDuration(total);
  }

  // Runs only while playing (self-terminating below) -- NOT driven by the
  // ~4Hz 'timeupdate' event (the existing Media Session `updatePositionState`
  // 'timeupdate' wiring is completely untouched by this). Skips the actual
  // DOM update while the user is mid-scrub (`isScrubbing`) so a live seek
  // 'input' visual is never fought by a stale playback position, but keeps
  // the rAF chain itself alive so the loop resumes updating immediately once
  // the scrub ends, with no extra start/stop bookkeeping needed there.
  function fillTick() {
    if (!isScrubbing) updateSeekVisual();
    if (mediaPlayer && !mediaPlayer.paused) {
      seekFillRafId = requestAnimationFrame(fillTick);
    } else {
      seekFillRafId = null;
    }
  }

  function startFillLoop() {
    if (seekFillRafId != null) return;
    seekFillRafId = requestAnimationFrame(fillTick);
  }

  // docs/RELIABILITY.md: the rAF loop must be cancelled on pause/close --
  // `fillTick` already self-terminates once `mediaPlayer.paused`, and this is
  // additionally called explicitly from the 'pause'/'ended' listeners and
  // from teardownMediaState()/close() below, for defense-in-depth (e.g. a
  // direct `mediaPlayer.load()` with no intervening 'pause' event).
  function stopFillLoop() {
    if (seekFillRafId != null) {
      cancelAnimationFrame(seekFillRafId);
      seekFillRafId = null;
    }
  }

  // Called from teardownMediaState() at the start of every genuine (non-adopt)
  // load, so the PREVIOUS media's fill/time never lingers on the bar while
  // the next media's own 'loadedmetadata'/'seeked' listeners haven't fired yet.
  function resetSeekVisual() {
    isScrubbing = false;
    if (seekBar) { seekBar.value = '0'; seekBar.style.setProperty('--seek-fill', '0%'); }
    if (timeCur) timeCur.textContent = '0:00';
    if (timeDur) timeDur.textContent = '0:00';
  }

  // ---- volume: clamp/persist + iOS feature-detect --------------------------

  function loadStoredVolume() {
    try { return clampVolume(localStorage.getItem(VOLUME_STORAGE_KEY)); } catch (_) { return null; }
  }

  function loadStoredMuted() {
    try { return localStorage.getItem(MUTED_STORAGE_KEY) === '1'; } catch (_) { return false; }
  }

  function persistVolume(vol, muted) {
    try {
      localStorage.setItem(VOLUME_STORAGE_KEY, String(vol));
      localStorage.setItem(MUTED_STORAGE_KEY, muted ? '1' : '0');
    } catch (_) { /* storage disabled/full -- persistence is best-effort only */ }
  }

  // ---- loop/repeat (FR-7, TF, v1.22.0) --------------------------------------
  // Guarded try/catch exactly like `loadStoredVolume`/`loadStoredMuted` above
  // (storage disabled/unavailable degrades to "loop off," never throws).
  // Exposed on the public API (below) so watch.js's `setupLoopToggle` reads/
  // writes the SAME `localStorage['ft-loop']` key through these two
  // functions rather than duplicating the key/guard logic in a second file --
  // this controller is the one place that actually ACTS on the setting (the
  // 'ended' listener below), so it owns the read/write too.
  function isLoopEnabled() {
    try { return localStorage.getItem(LOOP_STORAGE_KEY) === '1'; } catch (_) { return false; }
  }

  function setLoop(on) {
    try { localStorage.setItem(LOOP_STORAGE_KEY, on ? '1' : '0'); } catch (_) { /* storage disabled/full -- best-effort only */ }
  }

  // Browser-only feature-detect (not `node:test`-covered -- see the inbox/
  // exec-plan note: DOM-heavy iOS behavior is Dean's on-device arbiter).
  // iOS Safari silently ignores script writes to HTMLMediaElement.volume
  // (hardware-buttons-only, fixed at 1.0). Probes by writing a value distinct
  // from the element's CURRENT volume and reading it back; restores the
  // original value either way, so the probe itself never has a visible side
  // effect regardless of the outcome.
  function volumeIsSettable(el) {
    if (!el) return false;
    try {
      var original = el.volume;
      var probe = original > 0.5 ? 0.1 : 0.9;
      el.volume = probe;
      var settable = Math.abs(el.volume - probe) < 0.01;
      el.volume = original;
      return settable;
    } catch (_) {
      return false;
    }
  }

  function updateVolumeUI() {
    if (!mediaPlayer) return;
    var vol = mediaPlayer.volume;
    var muted = mediaPlayer.muted;
    if (muteBtn) {
      muteBtn.classList.toggle('is-muted', muted || vol === 0);
      muteBtn.setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
      muteBtn.setAttribute('aria-pressed', muted ? 'true' : 'false');
    }
    if (volBar) {
      volBar.value = String(vol);
      volBar.style.setProperty('--vol-fill', (vol * 100) + '%');
    }
  }

  // Runs exactly once, from wireHostListeners(): probes iOS settability and
  // HIDES the volume controls when unsettable (AC11 -- degrade silently,
  // never an error) instead of applying a stored preference that could never
  // actually take effect there; otherwise applies the stored preference
  // BEFORE any playback starts (AC10).
  function initVolume() {
    if (!mediaPlayer) return;
    volumeSettable = volumeIsSettable(mediaPlayer);
    if (!volumeSettable) {
      if (volBar) volBar.style.display = 'none';
      if (muteBtn) muteBtn.style.display = 'none';
      return; // skip applying the stored preference -- script can't set it anyway
    }
    var storedVolume = loadStoredVolume();
    if (storedVolume !== null) mediaPlayer.volume = storedVolume;
    mediaPlayer.muted = loadStoredMuted();
    updateVolumeUI();
  }

  // ---- playback speed (FR-4, T1, v1.22.1; FIX 1, v1.22.1 gate round) ---------
  // The ONE persistent, clickable speed control -- `#speed-btn`, a `.pc-btn`
  // cycle button on `#player-controls` -- covers every case now that FR-1
  // routes mobile video through this same custom bar: desktop audio/video,
  // mobile audio, mobile video. Deliberately separate from `speedBadge`
  // (`#speed-badge`), the transient `pointer-events: none` "2x ▶▶" overlay
  // shown only for the duration of a press-and-hold gesture -- the two never
  // conflict: `engageHold`/`releaseHold` (above) save/restore the LIVE
  // `mediaPlayer.playbackRate` around a hold, so whatever base rate
  // `#speed-btn` most recently set is exactly what a hold restores to
  // afterward.
  //
  // Both persistent-rate paths (this init path and the `#speed-btn` click
  // handler below) set `mediaPlayer.defaultPlaybackRate` ALONGSIDE
  // `playbackRate` -- never JUST `playbackRate`. Per the HTML media load
  // algorithm, `mediaPlayer.load()` (called by `teardownMediaState()` on
  // every genuine new load and by `startLiveStream()` on every desktop
  // live-transcode skip/seek) resets `playbackRate` back to
  // `defaultPlaybackRate`. Without also setting `defaultPlaybackRate`, the
  // user's chosen rate silently reverted to 1x on every subsequent item while
  // `#speed-btn`'s label kept showing the stale rate. Setting
  // `defaultPlaybackRate` makes the browser preserve the chosen rate across
  // every future load/skip automatically -- no reapply listener needed. The
  // transient hold-2x path (`engageHold`/`releaseHold`, above) deliberately
  // touches ONLY `playbackRate`, never `defaultPlaybackRate` -- otherwise the
  // transient 2x would leak into becoming the new persistent base rate.
  //
  // Persisted to `localStorage['ft-rate']`, mirroring `VOLUME_STORAGE_KEY`/
  // `LOOP_STORAGE_KEY` above -- same guarded try/catch idiom (storage
  // disabled/full degrades to "no stored preference," never throws).
  function loadStoredPlaybackRate() {
    try {
      var raw = parseFloat(localStorage.getItem(RATE_STORAGE_KEY));
      return PLAYBACK_RATES.indexOf(raw) !== -1 ? raw : null; // only a value from the known cycle is trusted -- garbage/foreign values are ignored, not coerced
    } catch (_) {
      return null;
    }
  }

  function persistPlaybackRate(rate) {
    try { localStorage.setItem(RATE_STORAGE_KEY, String(rate)); } catch (_) { /* storage disabled/full -- best-effort only */ }
  }

  function updateSpeedBtnUI(rate) {
    if (!speedBtn) return;
    speedBtn.textContent = rate + '×'; // e.g. "1.5×" -- textContent only, never innerHTML
  }

  // Runs exactly once, from wireHostListeners(): applies the stored
  // preference (if any) BEFORE any playback starts, mirroring `initVolume`'s
  // own "apply before playback" ordering -- so speed survives navigation
  // (AC-FR4, the persistent single `<video>` element's own `playbackRate`
  // would otherwise just default back to `1` on a fresh page load). Also sets
  // `defaultPlaybackRate` (see the block comment above) so every SUBSEQUENT
  // `load()` -- one per navigated-to item, this function itself only ever
  // runs once -- preserves the rate too, without a per-load reapply listener.
  function initPlaybackRate() {
    if (!mediaPlayer) return;
    var stored = loadStoredPlaybackRate();
    var rate = stored !== null ? stored : (mediaPlayer.playbackRate || 1);
    mediaPlayer.playbackRate = rate;
    mediaPlayer.defaultPlaybackRate = rate;
    updateSpeedBtnUI(rate);
  }

  // ---- fullscreen retarget (AC14, load-bearing) -----------------------------
  //
  // Desktop: retargets from the <video> element to `host` (`.player-container`)
  // so the custom control bar -- a SIBLING of the video, not a descendant --
  // stays visible while fullscreen (removing native `controls` would
  // otherwise strip fullscreen controls entirely once the video itself goes
  // fullscreen). iOS keeps `webkitEnterFullscreen()`, which shows iOS's own
  // native fullscreen chrome (not this bar) exactly as before this change --
  // completely unaffected. Returns the `requestFullscreen()` promise (or
  // `null`) so every call site can `.catch()` it exactly as the pre-existing
  // call sites already did.
  function enterFullscreen() {
    if (!mediaPlayer) return null;
    if (mediaPlayer.webkitEnterFullscreen) {
      try { mediaPlayer.webkitEnterFullscreen(); } catch (_) { /* unsupported/refused -- ignore */ }
      return null;
    }
    var target = (host && host.requestFullscreen) ? host : mediaPlayer;
    if (target && target.requestFullscreen) {
      try { return target.requestFullscreen(); } catch (_) { return null; }
    }
    return null;
  }

  // ---- FR-1 (T1, v1.22.2): audio "fullscreen" -- CSS full-viewport expand ---
  // NOT the Fullscreen API (see `resolveFsButtonAction` above) -- a plain
  // class toggle on `host` (`#player-wrapper`), styled by T2 as
  // `position: fixed; inset: 0` only when BOTH `.audio-mode` and
  // `.audio-expanded` are present. FULL-only, matching every other
  // fullscreen/gesture guard in this file (`state !== STATE_FULL` checks
  // throughout) -- a docked mini-player audio item has no expand affordance.
  function toggleAudioExpand() {
    if (!host || state !== STATE_FULL) return;
    var expanded = host.classList.toggle('audio-expanded');
    // Cheap a11y (gate round, v1.22.2): reflect the toggle state on the
    // reused `#fs-btn` so assistive tech announces it as a real toggle
    // button, not a stateless one.
    if (fsBtn) fsBtn.setAttribute('aria-pressed', expanded ? 'true' : 'false');
  }

  // Force-clears the expanded class. Called from every FULL-exit path
  // (`teardownMediaState()`, `dock()`, `close()` below) so the expanded view
  // can NEVER survive a dock/close/navigate-away and start the next FULL
  // session already expanded (AC5). Also the target of the secondary desktop
  // Escape exit affordance (see the dedicated keydown listener in
  // `wireHostListeners` below). Safe to call unconditionally (no-ops if the
  // class isn't present or `host` doesn't exist yet).
  function exitAudioExpand() {
    if (host) host.classList.remove('audio-expanded');
    if (fsBtn) fsBtn.setAttribute('aria-pressed', 'false');
  }

  // ---- one-time element-scoped listener wiring (never re-run) ----------------
  // Every listener here is attached to the HOST or an element inside it, so it
  // travels with the host wherever it's reparented -- no add/remove churn
  // across FULL<->DOCKED is needed for these. Only the FULL-only DOCUMENT
  // shortcuts (keydown, orientation) are additionally guarded by `state`.
  function wireHostListeners() {
    initVolume(); // FR-2 (T2, v1.21.0): apply/hide the persisted volume BEFORE any playback below
    initPlaybackRate(); // FR-4 (T1, v1.22.1): apply the persisted speed BEFORE any playback below

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
    // FR-7 (TF, v1.22.0, AC48/AC51/AC53): loop/repeat -- a FOURTH, separate
    // 'ended' listener, reconciling with the three above rather than
    // replacing any of them (the reset-to-0 listener above already put this
    // element at 0; `handleAutoplayNext`'s own early-return, above, is what
    // actually enforces "loop wins over autoplay" -- this listener is just
    // the replay action itself). Mirrors `resumeNoBtn`'s own restart logic
    // exactly: a live-transcode source is re-`src`'d via `startLiveStream`,
    // never seeked. State-independent of FULL/DOCKED -- only reads `liveMode`
    // /`mediaPlayer` (this controller's own state), same as
    // `handleAutoplayNext` above.
    mediaPlayer.addEventListener('ended', function () {
      if (!isLoopEnabled()) return;
      if (liveMode) {
        startLiveStream(0, true);
      } else {
        mediaPlayer.currentTime = 0;
        mediaPlayer.play().catch(function () {});
      }
    });
    mediaPlayer.addEventListener('loadedmetadata', function () { updatePositionState(true); });
    mediaPlayer.addEventListener('durationchange', function () { updatePositionState(true); });
    mediaPlayer.addEventListener('seeked', function () { updatePositionState(true); });
    mediaPlayer.addEventListener('ratechange', function () { updatePositionState(true); });
    mediaPlayer.addEventListener('timeupdate', function () { updatePositionState(false); });

    // FR-2 (T2, v1.21.0): the custom control bar's own reactions to native
    // media events -- additional listeners alongside every one above, none of
    // which they replace or interfere with.
    mediaPlayer.addEventListener('play', updatePlayPauseUI);
    mediaPlayer.addEventListener('pause', updatePlayPauseUI);
    mediaPlayer.addEventListener('ended', updatePlayPauseUI);
    mediaPlayer.addEventListener('play', startFillLoop);
    mediaPlayer.addEventListener('pause', stopFillLoop);
    mediaPlayer.addEventListener('ended', function () { stopFillLoop(); updateSeekVisual(); });
    mediaPlayer.addEventListener('loadedmetadata', function () { if (!isScrubbing) updateSeekVisual(); });
    mediaPlayer.addEventListener('durationchange', function () { if (!isScrubbing) updateSeekVisual(); });
    mediaPlayer.addEventListener('seeked', function () { if (!isScrubbing) updateSeekVisual(); });
    mediaPlayer.addEventListener('volumechange', function () {
      updateVolumeUI();
      if (volumeSettable) persistVolume(mediaPlayer.volume, mediaPlayer.muted);
    });

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

    // ---- FR-2 (T2, v1.21.0): the custom control bar's own listeners --------

    if (playerControls) {
      // A single delegated stopPropagation (mirrors dockCloseBtn's own
      // e.stopPropagation() in ensureDockChrome() below): every control-bar
      // click -- a button OR a plain click-not-drag on a range track -- must
      // never bubble to `#player-dock`'s tap-to-expand listener, or tapping
      // play/pause (or the seek/volume track) while DOCKED would BOTH act on
      // the control AND navigate to the watch page.
      playerControls.addEventListener('click', function (e) { e.stopPropagation(); });
    }

    if (ppBtn) ppBtn.addEventListener('click', togglePlayPause);

    if (seekBar) {
      // Visual scrub only (AC15): updates the fill/current-time display but
      // NEVER touches `currentTime` -- only 'change' below commits.
      seekBar.addEventListener('input', function () {
        isScrubbing = true;
        var ratio = Math.max(0, Math.min(1, Number(seekBar.value) || 0));
        var total = seekTotalDuration();
        seekBar.style.setProperty('--seek-fill', (ratio * 100) + '%');
        if (timeCur) timeCur.textContent = formatDuration(ratio * total);
      });
      // The ONLY place a scrub is committed -- pure `seekCommitTarget`
      // resolves the absolute target for both a normal source and a
      // live-transcode one (AC16), and a committed live-mode seek restarts
      // the stream exactly as the existing skip() does above.
      seekBar.addEventListener('change', function () {
        isScrubbing = false;
        if (!mediaPlayer) return;
        var ratio = Number(seekBar.value);
        var target = seekCommitTarget({
          duration: mediaPlayer.duration,
          ratio: ratio,
          liveMode: liveMode,
          liveTotal: currentData && currentData.duration,
        });
        if (liveMode) {
          startLiveStream(target, true);
        } else {
          mediaPlayer.currentTime = target;
        }
        saveProgressToServer(target);
        if (!mediaPlayer.paused) startFillLoop();
      });
    }

    if (muteBtn) {
      muteBtn.addEventListener('click', function () {
        if (mediaPlayer) mediaPlayer.muted = !mediaPlayer.muted;
      });
    }

    if (volBar) {
      volBar.addEventListener('input', function () {
        if (!mediaPlayer) return;
        var v = clampVolume(volBar.value);
        if (v === null) return;
        mediaPlayer.volume = v;
        if (v > 0 && mediaPlayer.muted) mediaPlayer.muted = false; // raising volume off 0 implies un-muting, matching native <audio controls> behavior
      });
    }

    // FR-4 (T1, v1.22.1): the persistent speed cycle button -- placed
    // immediately before `#fs-btn` in the markup (see the four shells'
    // `#player-host-template`), wired here alongside the rest of the custom
    // bar. Pure `nextPlaybackRate` decides the next rate; this is a thin
    // mirror that applies it + updates the label + persists it. Also sets
    // `defaultPlaybackRate` (FIX 1, v1.22.1 gate round -- see the block
    // comment above `loadStoredPlaybackRate`) so the chosen rate survives
    // every subsequent `load()`, not just the current item.
    if (speedBtn) {
      speedBtn.addEventListener('click', function () {
        if (!mediaPlayer) return;
        var rate = nextPlaybackRate(mediaPlayer.playbackRate);
        mediaPlayer.playbackRate = rate;
        mediaPlayer.defaultPlaybackRate = rate;
        updateSpeedBtnUI(rate);
        persistPlaybackRate(rate);
      });
    }

    if (fsBtn) {
      fsBtn.addEventListener('click', function () {
        var action = resolveFsButtonAction({ audioMode: host.classList.contains('audio-mode') });
        if (action === 'audio-expand') {
          toggleAudioExpand();
          return;
        }
        // 'native-fullscreen' -- EXISTING video path, byte-identical to
        // before this FR (AC4): never touched for `.audio-mode`.
        if (inNativeFullscreen()) {
          if (document.exitFullscreen) {
            var pe = document.exitFullscreen();
            if (pe && pe.catch) pe.catch(function () {});
          } else if (mediaPlayer.webkitExitFullscreen) {
            mediaPlayer.webkitExitFullscreen();
          }
        } else {
          var pf = enterFullscreen();
          if (pf && pf.catch) pf.catch(function () {});
        }
      });
    }

    // FR-8(b) (TG, v1.22.0, AC58-AC60): native Picture-in-Picture -- wired
    // ONCE here, alongside the rest of the custom bar, so it rides the
    // persistent host across FULL/DOCKED/CLOSED exactly like every other
    // control-bar listener above. Feature-detected via
    // `document.pictureInPictureEnabled`: browsers/contexts without support
    // (or where it's been disabled) never show a dead/inert button (AC58).
    // Hidden in `.audio-mode` via CSS (no PiP concept for an audio-only
    // element) -- independent of `.ff-mobile`, since PiP only ever matters
    // where the custom bar itself is the active control surface. Toggling
    // PiP is completely independent of the in-app dock (AC60): the two are
    // separate, additive affordances that never fight over `mediaPlayer`.
    if (pipBtn) {
      if (!document.pictureInPictureEnabled) {
        pipBtn.style.display = 'none';
      } else {
        pipBtn.addEventListener('click', function () {
          if (!mediaPlayer) return;
          if (document.pictureInPictureElement) {
            var px = document.exitPictureInPicture();
            if (px && px.catch) px.catch(function () {});
          } else {
            var pr = mediaPlayer.requestPictureInPicture();
            if (pr && pr.catch) pr.catch(function () {});
          }
        });
      }
    }

    // Click/tap-the-cover-art-to-play/pause (AC9): acts ONLY while FULL --
    // stopPropagation there so the toggle never also reaches anything behind
    // the art layer. While DOCKED the click is deliberately left un-stopped
    // so it bubbles to `#player-dock`'s existing tap-to-expand handler
    // completely unchanged -- the art surface never fights the dock, exactly
    // like the existing hold-to-2x/keyboard-shortcut `state !== STATE_FULL`
    // guards above.
    //
    // v1.21 FIX 1 (post-gate hardening): debounced via
    // scheduleArtSingleTap/cancelPendingArtTap (see above) rather than
    // toggling immediately -- a MOUSE double-click fires TWO native 'click'
    // events before 'dblclick', and without this debounce each would
    // immediately toggle play/pause (play, then pause) before the
    // 'dblclick' handler (wired below via wireSkipHoldGestures) got a
    // chance to skip -- the "double-toggle flicker" both reviewers flagged.
    // On the SECOND click within the window, cancel the pending toggle
    // (rather than rescheduling it) and let 'dblclick' handle the skip
    // instead; the equivalent touch case is handled inside
    // wireSkipHoldGestures's own touchend classification.
    if (audioBgArt) {
      audioBgArt.addEventListener('click', function (e) {
        if (state !== STATE_FULL) return;
        e.stopPropagation();
        if (!mediaPlayer) return;
        if (pendingArtTapTimer) {
          cancelPendingArtTap();
          return;
        }
        scheduleArtSingleTap(toggleArtPlayPause);
      });
    }

    // FR-5 (T1, v1.22.1): desktop-only click-video-to-toggle-play/pause on
    // `#media-player` -- mirrors the `#audio-bg-art` click handler directly
    // above, reusing the SAME `scheduleArtSingleTap`/`cancelPendingArtTap`
    // debounce (not a second mechanism) so a mouse double-click's first
    // 'click' never also toggles play/pause before 'dblclick' skips (the
    // existing ±15s skip, wired below via `wireSkipHoldGestures`). Uses the
    // plain `togglePlayPause()` (NOT `toggleArtPlayPause`, whose cover-art
    // glyph flash is audio-only). Desktop-only (AC29): gated by the pure
    // `shouldDesktopVideoTapToggle` guard (FULL-only + `!isMobileFormFactor()`
    // -- the SAME shared mobile signal every other form-factor check in this
    // file uses, never a second/divergent one) -- mobile video's existing
    // gesture layer (`#pp-btn` + `wireSkipHoldGestures`, below) is completely
    // untouched, since on mobile this guard is always false. No
    // `stopPropagation` needed: `#player-controls` is a SIBLING of
    // `#media-player` (not a descendant) in every shell's
    // `#player-host-template`, so a control-bar button click never bubbles
    // here in the first place.
    if (mediaPlayer) {
      mediaPlayer.addEventListener('click', function () {
        if (!shouldDesktopVideoTapToggle(state, isMobileFormFactor())) return;
        if (pendingArtTapTimer) {
          cancelPendingArtTap();
          return;
        }
        scheduleArtSingleTap(togglePlayPause);
      });
    }

    // v1.21 FIX 1 (post-gate hardening, both reviewers -- FR-2 regression,
    // AC12): wire the SAME ±15s double-tap-skip/press-hold-2x gesture model
    // onto BOTH interaction surfaces -- `#media-player` for video (called
    // with no `onSingleTap`, so its wiring/behavior is byte-identical to
    // before this fix), and `#audio-bg-art` for audio (with `onSingleTap`
    // wired to the same click-to-play/pause toggle the 'click' listener
    // above uses, debounced identically). Only one of the two surfaces is
    // ever actually interactive at a time -- style.css makes `#media-player`
    // `pointer-events: none` in `.audio-mode` (so taps reach the art layer
    // instead) and `#audio-bg-art` is `display: none` outside `.audio-mode`
    // -- so attaching both here is safe: whichever surface a tap/click/hold
    // actually lands on is the only one that ever fires.
    wireSkipHoldGestures(mediaPlayer);
    wireSkipHoldGestures(audioBgArt, toggleArtPlayPause);

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
          // FR-2 (T2, v1.21.0): retargeted through enterFullscreen() --
          // still iOS-native on iOS (webkitEnterFullscreen, no promise),
          // still desktop .player-container-fullscreen elsewhere, so the
          // custom bar shows if this ever runs on a desktop browser that
          // reports a landscape orientationchange.
          var p = enterFullscreen();
          if (p && p.catch) p.catch(function () { autoFullscreen = false; });
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
          // FR-4 (gate round, v1.22.2): route through the SAME
          // `resolveFsButtonAction` branch `#fs-btn`'s click handler uses
          // above, so the desktop `f`/`F` shortcut and clicking `#fs-btn`
          // are never two diverging "fullscreen audio" affordances. Audio
          // takes the CSS expand toggle; the video path below is otherwise
          // completely untouched (AC4).
          var fsAction = resolveFsButtonAction({ audioMode: host.classList.contains('audio-mode') });
          if (fsAction === 'audio-expand') {
            toggleAudioExpand();
            break;
          }
          // 'native-fullscreen' -- EXISTING video path, byte-identical to
          // before this fix: never touched for `.audio-mode`.
          if (document.fullscreenElement) {
            document.exitFullscreen();
          } else {
            // FR-2 (T2, v1.21.0): retargeted through enterFullscreen() --
            // desktop now goes fullscreen on .player-container (host), not
            // the bare <video>, so the custom bar is visible while fullscreen.
            var p3 = enterFullscreen();
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

    // ---- FR-1 (T1, v1.22.2): desktop Escape exit for the audio expand -----
    // Deliberately a SEPARATE listener from the FULL-only shortcut switch
    // above, not a new `case 'Escape':` folded into it -- that switch
    // early-returns on a focused `BUTTON` (exactly `#fs-btn`, the control the
    // user just tapped to enter the expanded view), and this keeps the
    // video-only tail of the `f`/`F` case (the `document.fullscreenElement`
    // branch) byte-identical to before this FR (AC4). Fires ONLY while FULL
    // + expanded, so it can never interfere with video fullscreen's own
    // Escape handling (the browser's native Fullscreen API already owns
    // Escape for that case) or with DOCKED/CLOSED audio.
    document.addEventListener('keydown', function (e) {
      if (state !== STATE_FULL) return;
      if (!host || !host.classList.contains('audio-expanded')) return;
      if (e.key === 'Escape' || e.key === 'Esc') exitAudioExpand();
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
    // FR-2 (T2, v1.21.0): stop the rAF fill loop (docs/RELIABILITY.md: must
    // be cancelled on pause/close -- `mediaPlayer.pause()` below already
    // triggers this via the 'pause' listener, this is defense-in-depth) and
    // reset the seek bar / art-glyph timer so the PREVIOUS media's fill/time
    // never lingers on the bar while the next media's own listeners haven't
    // fired yet.
    stopFillLoop();
    resetSeekVisual();
    if (artGlyphTimer) { clearTimeout(artGlyphTimer); artGlyphTimer = null; }
    // v1.21 FIX B (post-post-gate correction): cancel any pending debounced
    // art single-tap toggle (see scheduleArtSingleTap/cancelPendingArtTap
    // above) -- without this, a single art tap followed by a teardown/new
    // load within the DOUBLE_TAP_MS window would fire a stray
    // toggleArtPlayPause() on the persistent element afterward.
    cancelPendingArtTap();
    if (artPlayGlyph) artPlayGlyph.classList.remove('art-play-glyph-flash', 'art-play-glyph-playing');
    if (resumeOverlay) resumeOverlay.style.display = 'none';
    if (transcodeOverlay) transcodeOverlay.style.display = 'none';
    if (transcodeSpinner) transcodeSpinner.classList.remove('failed');
    if (host) host.classList.remove('audio-mode');
    exitAudioExpand(); // FR-1 (T1, v1.22.2, AC5): every genuine new load force-clears any expanded state left over from the previous media
    // FR-1 (T1, v1.22.0): belt-and-suspenders -- `mountInSlot()` (called a
    // few lines below, in `load()`) re-derives the real controls-mode for
    // the NEW media via `applyControlsMode()` microseconds later, but
    // clearing it here too means no native strip can flash on a mobile-
    // video -> mobile-audio load in between.
    if (mediaPlayer) mediaPlayer.removeAttribute('controls');
    if (audioBgArt) { audioBgArt.style.display = 'none'; audioBgArt.style.backgroundImage = ''; }
    if (audioVisualizer) audioVisualizer.style.display = 'none';
    if (skipControls) skipControls.style.display = 'none';
    if (mediaPlayer) {
      mediaPlayer.pause();
      // FR-2 (v1.18.0): reset the visible poster/last-decoded frame to
      // neutral BEFORE setupForMedia assigns the new source, so the
      // OUTGOING item's image never lingers/flashes during the transition
      // (stale poster + FOUC on Next). `removeAttribute('poster')` clears
      // the audio branch's `/thumbnail/<prevId>` poster (setupForMedia only
      // ever sets `.poster` for audio); `removeAttribute('src')` + `load()`
      // drops the previous video's last-decoded frame, resetting the
      // element to the media-empty state, which paints nothing -- revealing
      // the existing `#000` `.player-container` background beneath (the
      // CSS-only neutral placeholder; no new asset/CSS). `removeAttribute`
      // (not `src = ''`) avoids the "empty string resolves to the page URL"
      // reload quirk. This is a media-ELEMENT `load()`, not a page reload,
      // and only ever runs here -- on a genuine (non-`adopt`) load; the
      // `adopt` dock<->full path returns before `teardownMediaState()` is
      // ever called (see `load()`), so playback continuity there is
      // untouched.
      mediaPlayer.removeAttribute('poster');
      mediaPlayer.removeAttribute('src');
      mediaPlayer.load();
    }
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
    applyControlsMode(); // re-toggles .ff-mobile for this FULL transition and clears the native `controls` attribute (always removed, never set -- v1.22.1 FR-1)
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
    exitAudioExpand(); // FR-1 (T1, v1.22.2, AC5): never dock a fixed-overlay expanded wrapper
    if (host.parentNode !== dockEl) dockEl.appendChild(host);
    dockEl.hidden = false;
    state = STATE_DOCKED;
    applyControlsMode(); // re-toggles .ff-mobile for this DOCKED transition and clears the native `controls` attribute (always removed, never set -- v1.22.1 FR-1)
    if (wasPlaying && mediaPlayer.paused) mediaPlayer.play().catch(function () {});
  }

  function close() {
    loadGeneration++; // invalidate any in-flight poll/resume-check
    if (progressInterval) { clearInterval(progressInterval); progressInterval = null; }
    if (transcodePollTimer) { clearTimeout(transcodePollTimer); transcodePollTimer = null; }
    resetTransientPlaybackUi();
    // FR-2 (T2, v1.21.0): explicitly cancel the rAF fill loop + art-glyph
    // timer here too (docs/RELIABILITY.md) -- defense-in-depth alongside the
    // 'pause' listener's own stopFillLoop() call, which mediaPlayer.pause()
    // below already triggers.
    stopFillLoop();
    if (artGlyphTimer) { clearTimeout(artGlyphTimer); artGlyphTimer = null; }
    // v1.21 FIX B (post-post-gate correction): see the identical call/
    // comment in teardownMediaState() above -- cancel any pending debounced
    // art single-tap toggle so it can never fire on the (about to be
    // detached) persistent element after close().
    cancelPendingArtTap();
    exitAudioExpand(); // FR-1 (T1, v1.22.2, AC5): never leave a closed player's host expanded for a future re-open
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
    isLoopEnabled: isLoopEnabled, // FR-7 (TF, v1.22.0) -- watch.js's setupLoopToggle reads/writes through these
    setLoop: setLoop,
  };
  Object.defineProperty(api, 'currentId', {
    enumerable: true,
    get: function () { return currentId; },
  });

  window.FileTube = window.FileTube || {};
  window.FileTube.player = api;
})();
