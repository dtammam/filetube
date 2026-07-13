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
  // Native-controls lifecycle guard (mobile-native-controls round): a VIDEO
  // actually presenting in the OS's native fullscreen/PiP surface (iOS
  // `webkitDisplayingFullscreen`/`webkitPresentationMode ===
  // 'picture-in-picture'`, or the standard Fullscreen/Picture-in-Picture
  // APIs -- see `inNativeFullscreen()`) is the one reachable path to real
  // iOS background-audio-for-video: never auto-pause it here. This is
  // deliberately checked BEFORE the `isAudio`/`isMobile` verdict below, so it
  // applies uniformly regardless of media type -- in practice `ctx.
  // inNativePresentation` is only ever true for video (audio has no native
  // fullscreen/PiP surface), so this is a no-op widening for audio, not a
  // behavior change. Inline (non-fullscreen) playback is completely
  // unaffected: `ctx.inNativePresentation` is false there, so mobile inline
  // video still pauses+persists exactly as before, and audio still keeps
  // playing via the `isAudio` check below either way.
  if (ctx.inNativePresentation) return false;
  if (ctx.isAudio) return false; // audio/background-music: keep playing in the background
  return !!ctx.isMobile; // video: pause + persist only on mobile/PWA form factors (desktop keeps playing across tabs)
}

// PART A (player-lifecycle round, force-quit background-audio fix): should a
// PWA-lifecycle event RELEASE (stop + tear down the OS media/audio session)
// the currently-loaded media, on top of whatever `shouldPauseForLifecycleEvent`
// above already decides? `shouldPauseForLifecycleEvent` intentionally lets a
// playing AUDIO track (and a native-fullscreen/PiP VIDEO) keep running when
// the app is merely BACKGROUNDED -- that's the whole point of FR-5's "smart"
// behavior and must never regress. But a real hard-kill (force-quit, not a
// bfcache-suspend) has no such exemption: nothing will ever run again to stop
// it, so the audio session should be released rather than left dangling.
//
// The ONE lifecycle signal that reliably distinguishes "genuinely going away"
// from "merely suspended, may resume" is `pagehide`'s own `event.persisted`
// flag: `true` means the page is entering the back/forward cache (it may
// resume exactly where it left off -- releasing here would be wrong, and
// would also fight `pageshow`'s eventual resume); `false` means a true,
// terminal unload (tab/app closed, navigated away for good). `freeze` and a
// `visibilitychange`-to-hidden are both routine backgrounding, not unload
// signals at all, so neither ever qualifies here even though both feed
// `shouldPauseForLifecycleEvent` above -- this is a strictly ADDITIVE check,
// never a replacement for the pause decision.
function shouldReleaseForLifecycleEvent(eventType, ctx) {
  if (eventType !== 'pagehide') return false;
  return !!ctx && ctx.persisted === false;
}

// ---- Background audio for video (v1.27.0, EXPERIMENTAL, default OFF) ------
// On iOS, an inline (non-fullscreen) mobile <video> is suspended the moment
// the app backgrounds -- `shouldPauseForLifecycleEvent` above pauses it
// cleanly (today's behavior, unchanged). When the `backgroundAudioForVideo`
// setting is ON, that exact case instead hands off to a hidden <audio>
// element playing an audio-only extraction of the same item, YouTube-
// Premium-style, then swaps back on foreground. This is a small, explicit
// state machine (mirrors `shouldPauseForLifecycleEvent`'s own "pure
// decision, impure caller" split) so the transition table is directly
// node:test-able with no DOM/browser harness -- see
// `attemptBackgroundAudioHandoff`/`handleForegroundSwapBack` in the
// browser-only runtime below for where it's actually driven.
var BG_AUDIO_STATES = {
  INLINE_VIDEO: 'inline_video',       // the normal, default state -- <video> is the active surface
  HANDING_OFF: 'handing_off',         // a handoff has been triggered; audio.play() is in flight
  BACKGROUND_AUDIO: 'background_audio', // the hidden <audio> element is the active, playing surface
};

// Pure: (state, event, ctx) -> next state. `event` is one of:
//   'BACKGROUND'         -- a background-lifecycle event wants to hand off;
//                            `ctx.eligible` (from `shouldHandOffToBackgroundAudio`,
//                            below) decides whether this actually transitions.
//   'HANDOFF_SUCCEEDED'  -- the hidden audio element's play() promise resolved.
//   'HANDOFF_FAILED'     -- the hidden audio element's play() promise rejected
//                            (e.g. the iOS gesture wall) -- the caller has
//                            already fallen back to today's pause behavior by
//                            this point; this only resets the state machine.
//   'FOREGROUND'          -- the app returned to the foreground (SWAP_BACK).
//   'TEARDOWN'            -- a genuine new load(), close(), or a force-close
//                            release -- always resets to INLINE_VIDEO.
// Any (state, event) pair not explicitly handled below returns `state`
// unchanged (a deliberate no-op, never a thrown error) -- mirrors this
// file's other pure helpers' "unrecognized input never crashes" discipline.
function nextBackgroundAudioState(state, event, ctx) {
  switch (event) {
    case 'BACKGROUND':
      return (state === BG_AUDIO_STATES.INLINE_VIDEO && ctx && ctx.eligible)
        ? BG_AUDIO_STATES.HANDING_OFF : state;
    case 'HANDOFF_SUCCEEDED':
      return state === BG_AUDIO_STATES.HANDING_OFF ? BG_AUDIO_STATES.BACKGROUND_AUDIO : state;
    case 'HANDOFF_FAILED':
      return state === BG_AUDIO_STATES.HANDING_OFF ? BG_AUDIO_STATES.INLINE_VIDEO : state;
    case 'FOREGROUND':
      return (state === BG_AUDIO_STATES.BACKGROUND_AUDIO || state === BG_AUDIO_STATES.HANDING_OFF)
        ? BG_AUDIO_STATES.INLINE_VIDEO : state;
    case 'TEARDOWN':
      return BG_AUDIO_STATES.INLINE_VIDEO;
    default:
      return state;
  }
}

// Pure eligibility gate, DELIBERATELY excluding `isPlaying`/mobile/video/
// native-presentation -- those are each trigger's OWN responsibility to
// check before ever consulting this shared gate (see the two call sites
// below). Originally consulted from EXACTLY one place -- INSIDE
// `handleBackgroundLifecycle`'s `shouldPauseForLifecycleEvent(...)` truthy
// branch, where every one of those preconditions already held by
// construction. F-D (v1.27.1) added a SECOND call site,
// `handlePossibleIOSPrePauseHandoff` (wired on `mediaPlayer`'s own 'pause'
// event, below): investigation found iOS can system-pause an inline video
// BEFORE `visibilitychangeHidden` ever fires, so `ctx.isPlaying` is already
// false by the time `handleBackgroundLifecycle` runs its own gate -- the
// handoff was never even attempted for that specific interleaving. Both call
// sites re-derive their OWN preconditions independently (video-only, mobile
// form factor -- F4, two-reviewer gate, v1.27.1 post-release: explicit in
// BOTH triggers now, never left as an implicit coupling in either -- not
// already native-presenting, not already mid-handoff) and only THEN consult
// this shared setting/status/state-machine gate, so it stays the single
// source of truth for "is background audio itself eligible right now" no
// matter which trigger fired.
function shouldHandOffToBackgroundAudio(ctx) {
  if (!ctx || !ctx.settingOn) return false;
  if (ctx.audioStatus !== 'ready') return false;
  return ctx.bgAudioState === BG_AUDIO_STATES.INLINE_VIDEO;
}

// Pure (v1.27.2, pre-pause candidate bridge): is a previously-armed
// pre-pause candidate still fresh enough for the arriving
// `visibilitychangeHidden` to consume it as "iOS system-paused us on the
// way to background"? `candidateAt` is the arming timestamp (0/absent =
// never armed); `windowMs` defaults to PRE_PAUSE_CANDIDATE_WINDOW_MS at the
// impure call site -- injectable here for deterministic tests. Malformed
// input never throws: non-finite/nonpositive values simply read as "not
// fresh" (fail safe -- no handoff, today's plain pause).
function isFreshPrePauseCandidate(candidateAt, nowMs, windowMs) {
  if (typeof candidateAt !== 'number' || !isFinite(candidateAt) || candidateAt <= 0) return false;
  if (typeof nowMs !== 'number' || !isFinite(nowMs)) return false;
  if (typeof windowMs !== 'number' || !isFinite(windowMs) || windowMs <= 0) return false;
  var age = nowMs - candidateAt;
  return age >= 0 && age <= windowMs;
}

// F3b (two-reviewer follow-up, v1.27.0): a tiny (52-byte), LOCAL, silent
// mono 8-bit/8kHz PCM WAV clip (8 samples of silence), inlined as a `data:`
// URI so `primeBackgroundAudioElement` (below) can "bless" `bgAudioEl` for a
// later gesture-less `.play()` WITHOUT ever touching the network -- no
// request to `/audio/:id`, and therefore no chance of enqueuing a
// server-side FFmpeg extraction, on every mobile video's first gesture. This
// matters even when the `backgroundAudioForVideo` setting is OFF (the
// default): `bgAudioEl` used to be pre-pointed at the REAL `/audio/:id` URL
// unconditionally (see setupForMedia's OLD comment, removed) and priming
// used to play THAT, so a disabled install still paid for real extraction
// jobs + shared-LRU-cache churn on every mobile video watch. iOS's
// autoplay-gesture unlock is scoped to the <audio> ELEMENT itself, not
// whatever `src` it happened to be playing when unlocked -- so blessing the
// element with this inert clip is exactly as effective for a LATER real
// handoff (`attemptBackgroundAudioHandoff`, the ONLY other `bgAudioEl.src`
// assignment site, which swaps in the real `/audio/:id` URL at THAT point,
// already gated on the setting being on) as priming with the real audio
// ever was.
var SILENT_PRIME_SRC = 'data:audio/wav;base64,UklGRiwAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQgAAACAgICAgICAgA==';

// D2 (v1.24.0, T13): the resume-prompt threshold, in seconds, applied by
// `shouldShowResumeOverlay` below. Saved progress AT OR ABOVE this still
// shows the "Resume at..." overlay; progress below it is treated as too
// short to bother asking about (the caller's existing `savedProgress > 5`
// direct-resume fallback in `handleResumePlayback` still resumes it
// silently -- this only suppresses the INTERRUPTING prompt, not the resume
// itself). Configurable via the Setup page's "Playback" section
// (`RESUME_THRESHOLD_STORAGE_KEY` below); this is just the fallback default.
var DEFAULT_RESUME_THRESHOLD_SECONDS = 60;

// D2 (v1.24.0, T13): pure validator for a RAW (string/number/null/undefined)
// resume-threshold value -- either a `localStorage`-read raw string (see
// `getStoredResumeThreshold` below) or a caller-supplied `ctx.threshold` that
// hasn't been pre-validated. Mirrors `clampVolume`'s "garbage/missing ->
// documented fallback, never a silent NaN/negative" contract: anything that
// doesn't parse to a finite, non-negative number (missing, `localStorage`
// disabled, a corrupt/tampered value, a stray negative) falls back to
// `DEFAULT_RESUME_THRESHOLD_SECONDS`; a genuine `0` (a user opting into
// "always prompt, even for 1s of progress") is valid and passed through.
// This is the SINGLE source of truth both `shouldShowResumeOverlay` (when no
// -- or an invalid -- `ctx.threshold` is supplied) and the live
// `localStorage` reader below fall back through, so the two can never
// disagree on what "missing/garbage" resolves to.
function resolveResumeThreshold(raw) {
  var n = typeof raw === 'number' ? raw : parseFloat(raw);
  if (!isFinite(n) || n < 0) return DEFAULT_RESUME_THRESHOLD_SECONDS;
  return n;
}

// Should the resume overlay show for this load (FR-4b, T3; threshold made
// configurable in D2, v1.24.0, T13)? True whenever there's saved progress AT
// OR ABOVE the configurable threshold (`ctx.threshold`, default ~60s, see
// `DEFAULT_RESUME_THRESHOLD_SECONDS`/`resolveResumeThreshold` above) --
// UNLESS this specific load was reached by autoplay advancing to the next
// video (see `handleAutoplayNext`, which sets the one-shot
// `autoplayAdvancePending` flag immediately before navigating; `load()` then
// captures it into a per-load snapshot at load START -- see
// `captureAutoplayAdvanceForLoad` -- which `handleResumePlayback` reads). An
// autoplay-advanced load skips the "Resume at..." prompt entirely and just
// plays on, so the autoplay flow is never interrupted by a manual decision.
// A normal navigation (autoplayAdvance falsy) to a video with saved progress
// is unaffected -- still shows the overlay exactly as before, just against
// the (now-configurable) threshold instead of a fixed 5s. Deliberately NOT
// keyed off the `autoplayNext` SETTING itself: a manual navigation while the
// setting happens to be ON must still show the overlay (see the exec plan's
// "Alternatives considered"). `ctx.threshold` is expected to be READ LIVE
// from `localStorage` by the caller at decision time (see
// `getStoredResumeThreshold` below, called fresh from `handleResumePlayback`
// on every load) -- NEVER cached at module load -- so a change on the Setup
// page takes effect on the very next video open, no page reload required.
function shouldShowResumeOverlay(ctx) {
  var savedProgress = (ctx && ctx.savedProgress) || 0;
  var autoplayAdvance = !!(ctx && ctx.autoplayAdvance);
  var threshold = resolveResumeThreshold(ctx && ctx.threshold);
  // A resume prompt only makes sense against GENUINE saved progress: a
  // never-watched video (savedProgress 0) must never prompt, even when the
  // user has opted the threshold down to 0 ("always prompt") -- without this
  // `> 0` guard, `0 >= 0` would surface a pointless "Resume at 0:00" overlay
  // on every fresh video for anyone who set the threshold to 0 (v1.24.4 gate).
  return savedProgress > 0 && savedProgress >= threshold && !autoplayAdvance;
}

// D3 (v1.24.0, T13): pure decision for what to do with a genuine resume
// decision (one `shouldShowResumeOverlay` above has already said "yes, ask")
// given where the persistent player host currently is. Problem: the docked
// mini-player (`#player-dock`, 280px desktop / 160px mobile -- see
// style.css) is too small to legibly read/tap a "Resume at.../Start over"
// choice. Recommended (Dean's design pick, per the exec plan's D3 -- the
// ONE behavior implemented here, not the rejected "expand-to-FULL"
// alternative): DOCKED suppresses the overlay entirely and resumes silently
// instead, exactly like `handleResumePlayback`'s existing autoplay-advance
// direct-resume fallback already does for a below-threshold-but-real save --
// resuming is overwhelmingly the correct default, and the user can always
// tap the dock to expand + seek elsewhere if it wasn't. FULL shows the
// overlay exactly as before D3 (plenty of room there). CLOSED never actually
// reaches this in practice (`handleResumePlayback`'s `gen !== loadGeneration`
// guard bails out before this runs -- `close()` bumps `loadGeneration`) but
// degrades to `'prompt'` defensively rather than silently dropping a pending
// decision. Returns `'none'` when no resume decision is pending at all (the
// call site only invokes this from inside the `shouldShowResumeOverlay`
// branch, so in practice `resumeDecisionPending` is always `true` there --
// this input/branch exists so the helper is a complete, self-contained
// decision table rather than relying on the caller to only ever call it
// correctly).
//
// NOTE on form factor: the exec plan's stated inputs for this helper include
// a mobile/desktop form-factor signal (reusing `resolveMobileFormFactor`/
// `isMobileFormFactor`, never a second mobile check). The chosen (recommended)
// behavior above does not need to branch on it -- `#player-dock` is small on
// EVERY form factor (280px desktop / 160px mobile, both well under a legible
// two-button dialog's comfortable width), so suppression applies uniformly
// whether DOCKED on a phone or a desktop browser. Only the REJECTED
// alternative (expand-to-FULL) would have needed it, and implementing both
// behaviors is explicitly out of scope (pick ONE, deterministic). Not
// accepted as a parameter for that reason -- see the T13 report for this
// call.
function resolveDockedResumeAction(ctx) {
  var opts = ctx || {};
  if (!opts.resumeDecisionPending) return 'none';
  return opts.dockState === 'docked' ? 'auto-resume' : 'prompt';
}

// v1.24.5 (fast-follow): companion to `resolveDockedResumeAction` above for
// the OPPOSITE ordering. `resolveDockedResumeAction` only covers a resume
// decision made WHILE already docked; it does nothing for a decision made
// while FULL (the overlay is legitimately shown there) that the user then
// docks AWAY from mid-prompt. Without this, `dock()` (the DOM call site)
// would strand the full-size "Resume at..." prompt rendering inside the
// tiny 160/280px `#player-dock` mini-player. `dock()` calls this on every
// dock transition; a still-showing overlay is converted to D3's own
// auto-resume intent (dismiss + resume directly) so the outcome matches
// exactly what would have happened had the decision been made AFTER
// docking instead of before.
function resolveDockTransitionResumeAction(ctx) {
  var opts = ctx || {};
  return opts.resumeOverlayVisible ? 'dismiss-and-auto-resume' : 'none';
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

// v1.34 T6 (Dean, drag scrubbing): pure pointer-position -> seek-ratio map
// behind the seek bar's pointer-capture drag handlers (see the seekBar
// wiring below). Clamped to [0,1]; `null` for a degenerate/zero-width rect
// (mid-teardown, display:none) so the caller skips the frame instead of
// dividing by zero.
function scrubRatioFromPointer(clientX, rectLeft, rectWidth) {
  if (!isFinite(clientX) || !isFinite(rectLeft) || !isFinite(rectWidth) || rectWidth <= 0) return null;
  return Math.max(0, Math.min(1, (clientX - rectLeft) / rectWidth));
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

// ---- Feature A (v1.26.1): reserved-aspect pure helpers ---------------------
// Kills the vertical-video (Shorts) player-box jump: given a known/probed
// width+height, returns a valid CSS `aspect-ratio` value string ("W / H")
// -- or `null` on anything not usable (missing/non-finite/non-positive), so
// callers can safely fall back to style.css's own `var(--media-aspect, 16 /
// 9)` default rather than ever writing an invalid custom-property value.
// Pure/DOM-free so it's directly `node:test`-able; the live caller
// (`applyMediaAspect`, below) is a thin DOM wrapper around this.
function computeMediaAspectRatio(width, height) {
  var w = Number(width);
  var h = Number(height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return w + ' / ' + h;
}

// True only for genuinely PORTRAIT (taller-than-wide) dimensions -- drives
// the `.portrait-media` marker class (style.css) that grants a taller
// mobile-portrait height ceiling than the default 16:9-tuned one, so a
// vertical (Shorts-style) item isn't needlessly cropped down to a
// landscape-shaped box. Landscape/square/missing-or-invalid input is
// `false` -- the existing, tighter clamp stays the default everywhere else
// (16:9, 4:3, and any item with no known dims yet).
function isPortraitMediaAspect(width, height) {
  var w = Number(width);
  var h = Number(height);
  return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 && h > w;
}

// F2 (v1.26.1 two-reviewer follow-up): true only when BOTH the stored
// (server-known) and the browser-reported dims are individually valid AND
// their PORTRAIT-vs-LANDSCAPE orientation disagrees. This is the "chose the
// simpler option" self-heal from the two-reviewer gate: a rotation-flagged
// phone video probed BEFORE the server-side rotation fix
// (parseFfprobeStreams, server.js) can have stored dims that are the CODED
// (pre-rotation) dims -- landscape-shaped when the video actually displays
// portrait, or vice versa. The `POST /api/videos/:id/dimensions` endpoint's
// no-clobber stays strict (an item that already carries both `width` and
// `height` is never overwritten by a later POST, no exception here) -- this
// helper instead drives a client-side-ONLY visual correction
// (`applyMediaAspect` re-run from the browser's own, already
// rotation-corrected `videoWidth`/`videoHeight`) so at least the CURRENT
// session's box is right, while new scans get it right from the start via
// `parseFfprobeStreams`' own rotation handling. A merely-equal orientation
// (both landscape, both portrait, or either side missing/invalid) is never
// a "mismatch" -- `computeMediaAspectRatio`'s own validity gate is reused so
// invalid input on either side can never trigger a spurious heal.
function mediaAspectOrientationMismatch(storedWidth, storedHeight, browserWidth, browserHeight) {
  if (!computeMediaAspectRatio(storedWidth, storedHeight)) return false;
  if (!computeMediaAspectRatio(browserWidth, browserHeight)) return false;
  return isPortraitMediaAspect(storedWidth, storedHeight) !== isPortraitMediaAspect(browserWidth, browserHeight);
}

// ---- Feature B (v1.26.1): AUDIO-mode caption overlay pure helpers ---------
// iOS can't paint native <track> cues over the cover-art layer in audio
// mode (see #audio-bg-art, style.css), so that mode renders captions via a
// custom overlay built from `cuechange` instead. Strips simple VTT markup
// (`<v Name>`, `<i>`/`</i>`, `<b>`/`</b>`, `<c.class>`, timestamp tags, etc.
// -- any `<...>` span) out of a single cue's raw `.text`: WebVTT allows that
// markup to style NATIVE rendering, but this overlay renders via
// `textContent` only (never innerHTML, matching this codebase's XSS-
// hardening convention elsewhere), so the tags must be stripped rather than
// interpreted. A plain, conservative `<[^>]*>` strip; anything that doesn't
// look like a tag is left completely alone.
//
// KNOWN LIMITATION (QA, v1.26.1 two-reviewer gate): this regex has no way to
// distinguish real VTT markup from a literal `<...>`-shaped span that
// happens to appear in a caption's actual spoken/subtitled text (e.g. a cue
// reading `The result was <3 seconds` or `Use the <Enter> key`) -- both are
// stripped identically, over-stripping the latter. Accepted trade-off: VTT
// markup stripping is the common case this overlay exists for, and a false
// positive here only ever affects the AUDIO-mode custom overlay's display
// text (never the underlying TextTrack cue data, never native `<track>`
// rendering for video, which is unaffected by this function entirely). Not
// fixed -- a real fix needs a proper (or at least tag-name-allowlisted) VTT
// cue-text parser, which is out of scope for this overlay.
function stripVttCueTags(text) {
  if (typeof text !== 'string') return '';
  return text.replace(/<[^>]*>/g, '');
}

// Joins the SIMULTANEOUSLY active cues' (raw, un-stripped) text into the
// overlay's displayed string, one cue per line -- WebVTT allows more than
// one cue to be active at once (e.g. overlapping speaker lines). Each cue's
// own text is tag-stripped and trimmed first; empty/whitespace-only entries
// are dropped so a stray empty active cue never renders a blank pill.
// Returns `''` (never `null`/`undefined`) when nothing is left to show --
// callers treat `''` as "hide the overlay". Pure/DOM-free: takes an array of
// raw strings (already pulled off `TextTrack.activeCues[i].text` by the
// live caller) rather than real `VTTCue`/`TextTrackCueList` objects, so it's
// directly `node:test`-able with no browser cue objects required.
function buildCaptionOverlayText(rawCueTexts) {
  var list = Array.isArray(rawCueTexts) ? rawCueTexts : [];
  var lines = list
    .map(stripVttCueTags)
    .map(function (s) { return s.trim(); })
    .filter(function (s) { return s.length > 0; });
  return lines.join('\n');
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
    shouldReleaseForLifecycleEvent,
    BG_AUDIO_STATES,
    nextBackgroundAudioState,
    shouldHandOffToBackgroundAudio,
    // v1.27.2 (pre-pause candidate bridge): pure freshness check for the
    // pause->visibilitychange bridge -- see its own comment.
    isFreshPrePauseCandidate,
    shouldShowResumeOverlay,
    resolveResumeThreshold,
    resolveDockedResumeAction,
    resolveDockTransitionResumeAction,
    captureAutoplayAdvanceForLoad,
    clampVolume,
    seekCommitTarget,
    scrubRatioFromPointer,
    classifyTapGesture,
    shouldArtSingleTapAct,
    resolveMobileFormFactor,
    resolveEndedAction,
    nextPlaybackRate,
    shouldDesktopVideoTapToggle,
    resolveFsButtonAction,
    computeMediaAspectRatio,
    isPortraitMediaAspect,
    mediaAspectOrientationMismatch,
    stripVttCueTags,
    buildCaptionOverlayText,
  };
}

(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined') return; // node:test never touches this file

  var STATE_CLOSED = 'closed';
  var STATE_FULL = 'full';
  var STATE_DOCKED = 'docked';

  // v1.30.0 T7 (A5): `GET /api/videos` is now PAGINATED (server-authoritative,
  // default page size 60 -- see server.js's T6, `{ items, total, offset,
  // limit }`). `handleAutoplayNext`'s deriveOrderedIds computation (below)
  // needs the FULL folder set -- the just-ended item's next-in-order
  // neighbor could otherwise sit past a truncated page-1 boundary and
  // autoplay would silently stop advancing. Mirrors watch.js's own
  // FULL_LIST_QUERY_LIMIT constant/rationale exactly (kept as a separate
  // per-file constant -- both files load as classic, same-global-scope
  // `<script>` tags, so a shared top-level identifier name would collide).
  var AUTOPLAY_ADVANCE_FULL_LIST_LIMIT = 1000000;

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

  // A6 (T16, v1.24 UX Round, Wave 5): the ONE approved player-controls
  // exception -- the CC (captions) toggle button + the <track> element it
  // controls. Both live INSIDE the persistent host (ccTrack is a child of
  // #media-player itself), queried/wired once alongside the rest of the
  // custom bar above, so they ride the reparented host across FULL/DOCKED/
  // CLOSED exactly like #pip-btn/#speed-btn.
  var ccBtn, ccTrack;
  // v1.34 T3 (chapters): the picker button + its popup menu (all five shell
  // templates carry both, parity-locked). currentChapters mirrors the
  // RESOLVED list GET /api/videos/:id served for the loaded item
  // (manual > embedded > description -- resolved server-side).
  var chaptersBtn, chaptersMenu;
  var currentChapters = [];
  var chaptersOutsideCloseWired = false;
  // Assigned inside wireHostListeners' closure; no-op stubs until then so a
  // teardown racing first wiring can never throw.
  var applyChaptersForMedia = function () {};
  var resetChaptersUi = function () {};

  // Feature B (v1.26.1): the AUDIO-mode custom caption overlay -- created
  // once in ensureHost() (never touches the shared player-host-template
  // markup, so all 5 shells stay untouched) and appended inside `host`
  // alongside the elements above, so it rides the reparented host exactly
  // like everything else. `audioCaptionsOn` is this controller's own
  // "is the user's CC toggle currently ON, for the CURRENT audio item"
  // flag -- reset on every teardown (see teardownMediaState) and whenever
  // the button itself is clicked off.
  var ccOverlayEl, ccOverlayTextEl;
  var audioCaptionsOn = false;

  // v1.26.4 (frozen audio-CC overlay, on-device iOS bug): the last text this
  // controller actually PAINTED into `ccOverlayTextEl` (or `null` when
  // hidden) -- lets `renderActiveCueOverlay` become idempotent (a no-op
  // repaint when nothing changed) so it's safe to call from MULTIPLE data
  // paths (click handler, dual cuechange binding, AND a `timeupdate`
  // fallback -- see wireHostListeners below) without fighting itself or
  // doing needless DOM writes ~4x/sec. Reset to `null` in
  // `hideCaptionOverlay()` so a subsequent re-toggle-on always repaints even
  // if the very first cue happens to match whatever was on screen before.
  var lastCcOverlayText = null;

  // v1.27.0 (background-audio-for-video, EXPERIMENTAL): the hidden <audio>
  // element (created once in ensureHost(), see below) + the small state
  // machine driving the handoff. `bgAudioSettingCached`/`bgAudioStatusKnown`
  // are per-LOAD snapshots (reset in teardownMediaState/close, populated by
  // setupForMedia) -- the whole point of caching is that
  // `attemptBackgroundAudioHandoff` (below) never needs a network round-trip
  // at the worst possible moment (a real background event). `bgAudioGesturePrimed`
  // is also per-load: guards the one-shot muted play()+pause() prime so it
  // only ever runs once per item (see `primeBackgroundAudioElement`).
  var bgAudioEl = null;
  var bgAudioState = BG_AUDIO_STATES.INLINE_VIDEO;
  var bgAudioSettingCached = false;
  // v1.35 gate fix (adversarial): the EAGER BUFFER half of the pre-arm
  // (preload=auto + load(), a real network fetch of the whole sidecar per
  // watch) is gated on preExtractAudio -- the setting whose copy discloses
  // resource costs. Cached off the same per-load settings fetch.
  var preExtractAudioCached = false;
  // v1.34 T4 (Dean): the "Use custom player controls on mobile" setting --
  // when ON, mobile VIDEO in FULL keeps the CUSTOM control bar instead of
  // flipping to the native iOS strip (applyControlsMode below). Cached per
  // load off the SAME per-mobile-video-load GET /api/settings the
  // background-audio feature already fires (one fetch, two flags); fails
  // SAFE to false = native, today's default behavior.
  var mobileCustomPlayerCached = false;
  var bgAudioStatusKnown = null;
  var bgAudioGesturePrimed = false;
  // F-D (v1.27.1): set (synchronously) around every one of THIS file's own
  // internal `mediaPlayer.pause()` calls that are part of a lifecycle-driven
  // pause/release (never around a real user pause -- see the call sites:
  // `attemptBackgroundAudioHandoff`, `handleBackgroundLifecycle`'s plain-pause
  // fallback, `releaseAudioSession`). Consulted by the SECOND handoff trigger,
  // `handlePossibleIOSPrePauseHandoff` (wired on mediaPlayer's own 'pause'
  // event, below) so it can tell "our own programmatic pause, already being
  // handled by the lifecycle path" apart from a genuine iOS system-pause that
  // preceded `visibilitychangeHidden`. NOT per-load state (deliberately never
  // reset in teardownMediaState/close) -- it is only ever true for the
  // synchronous duration of one of the pause() calls above, so there is
  // nothing to leak across loads.
  var suppressPauseHandoff = false;
  // v1.27.2 (pre-pause candidate bridge): timestamp of the most recent
  // UNSUPPRESSED, otherwise-eligible `mediaPlayer` 'pause' event that could
  // not be classified at pause time. Dean's on-device overlay proved the
  // real iOS lock sequence is: system-pause FIRST (dispatched while
  // `document.visibilityState` is still 'visible'), THEN
  // `visibilitychangeHidden` with `playing=false` -- so NEITHER v1.27.1
  // trigger could ever fire (the 'visibility' trigger saw a paused video;
  // the 'pause-hidden' trigger saw a visible page). This candidate bridges
  // the two signals: the ambiguous pause ARMS it, and a
  // `visibilitychangeHidden` arriving within the window below CONSUMES it
  // as "iOS system-paused us on the way to background" and attempts the
  // handoff then. A deliberate user pause followed by a lock outside the
  // window stays a plain pause. Cleared on consume, on a 'play' event, and
  // in teardownMediaState/close.
  var prePauseCandidateAt = 0;
  // 1500ms: iOS's pause -> visibilitychange gap is typically well under
  // 300ms; this tolerates slow devices. NOTE (two-reviewer gate, v1.27.2):
  // the window alone is NOT the user-intent guard -- a deliberate
  // pause-then-immediate-lock lands inside it. The actual guard is the
  // USER-GESTURE stamp below: an iOS SYSTEM pause has no preceding in-page
  // gesture, while every user pause does (a tap/click/keypress reaches the
  // page even under native iOS controls) -- so a pause following a recent
  // gesture never arms a candidate at all. See
  // handlePossibleIOSPrePauseHandoff.
  var PRE_PAUSE_CANDIDATE_WINDOW_MS = 1500;
  // v1.27.2 (two-reviewer gate fix): timestamp of the most recent in-page
  // user gesture on the player surface (host-level capture-phase
  // touchstart/mousedown/click in wireHostListeners, plus explicit stamps in
  // togglePlayPause for the keyboard path). Consulted ONLY to veto candidate
  // arming: a 'pause' within GESTURE_PAUSE_GRACE_MS of a gesture is a USER
  // pause (custom bar, native-controls tap, art tap, dock, spacebar) and
  // must never arm -- the false positive it prevents (pause -> lock within
  // the window -> audio resumes against an explicit pause) is the exact
  // intent-violation class the v1.27.1 F1 fix closed for the lock screen.
  // Trade-off is deliberately conservative: a REAL system pause that
  // happens to follow a user touch within the grace (tap screen, then lock
  // instantly) is a missed handoff (falls back to today's plain pause) --
  // false negatives cost a feature moment, false positives violate intent.
  var lastUserGestureAt = 0;
  var GESTURE_PAUSE_GRACE_MS = 800;
  // v1.27.0 (F2, two-reviewer gate): a one-shot flag set by
  // `runEndedCompletionCascade` when a video finishes WHILE backgrounded and
  // autoplay-advance would otherwise fire -- deferred rather than attempted
  // mid-background (see that function's own comment for why) and consumed
  // by the very next `handleForegroundSwapBack()`. Per-load, reset alongside
  // every other background-audio flag in teardownMediaState/close.
  var pendingAutoplayNextOnForeground = false;

  var dockCloseBtn = null;
  var dockChromeReady = false;

  // Player-scoped timers (raw handles, not covered by any AbortSignal) --
  // cleared on close() and whenever a genuinely NEW media is loaded.
  var progressInterval = null;
  var skipRevealTimer = null;
  var transcodePollTimer = null;
  // F7 (two-reviewer NIT, v1.27.1 post-release): scheduleAudioStatusRepoll's
  // own setTimeout handle -- captured here for the same reason as the other
  // three timers above (structural consistency), even though its callback is
  // already generation-guarded (see scheduleAudioStatusRepoll's own comment)
  // and therefore safe to let fire as a no-op. Cleared alongside the others
  // in teardownMediaState/close so a still-pending repoll is cancelled
  // outright on a genuinely new load/close, rather than merely left to
  // no-op once it eventually fires.
  var audioStatusRepollTimer = null;

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
  var RESUME_THRESHOLD_STORAGE_KEY = 'filetube_resume_threshold'; // D2 (v1.24.0, T13) -- set from the Setup page's "Playback" section (public/js/setup.js); read LIVE (never cached) at every resume decision, see getStoredResumeThreshold below. Named `filetube_*` (not `ft-*`) to match the existing cross-page-list-pref convention (`filetube_sort`/`filetube_format` in main.js/watch.js/common.js), since this is surfaced/settable from a page OTHER than the watch page, unlike VOLUME/MUTED/LOOP/RATE above.

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

  // FR-1 (T1, v1.22.0 -- RETIRED, v1.22.1 -- PARTIALLY REINSTATED, mobile-
  // native-controls round): the impure applier. v1.22.0 gave mobile video the
  // iOS native `controls` strip; v1.22.1 retired that entirely (see the pure
  // helper section above) because iOS's inline `<video controls playsinline>`
  // strip auto-hides during playback and does not reliably re-reveal under
  // this file's own gesture layer, leaving mobile-video users with NO visible
  // controls at all -- so every case became the custom `#player-controls` bar.
  // That custom bar, however, has no reliable path to iOS's native
  // fullscreen -> orientation-lock -> background-audio chain (only the
  // BROWSER's own native `<video controls>` strip does), so this round
  // reinstates native controls for mobile VIDEO, but ONLY while FULL (never
  // DOCKED -- the ~160px docked miniplayer would be unusable with a native
  // strip and could hijack `#player-dock`'s tap-to-expand, so docked mobile
  // video keeps the trimmed custom bar) and gates the custom gesture layer
  // off whenever native controls are showing (see `inNativeControlsMode()`
  // and its `wireSkipHoldGestures()` call sites below) so the two surfaces
  // never fight each other -- the exact failure mode v1.22.1 fixed. Desktop
  // (any media type) and mobile AUDIO are completely unaffected: `isVideo`
  // and `mobile` both gate the native branch, so neither ever sets `controls`
  // or `.native-controls`. Still toggles `.ff-mobile` on `host`
  // (`#player-wrapper`) from `isMobileFormFactor()` -- still needed by CSS for
  // mobile touch-target sizing and volume-control hiding (T2's `style.css`
  // changes), independent of the native/custom split. Called synchronously
  // from `mountInSlot()`/`dock()` -- the existing reparent/state-transition
  // points, AFTER `state`/`currentData` are assigned for this transition --
  // never from a `matchMedia` change-listener (AC7: capability is stable
  // across orientation/resize, so re-deriving live is unnecessary).
  function applyControlsMode() {
    if (!host || !mediaPlayer) return;
    // v1.34.2: the CSS faux-fullscreen only makes sense in the FULL state --
    // docking/closing while in it must drop the fixed overlay.
    if (state !== STATE_FULL) setCssFullscreen(false);
    var mobile = isMobileFormFactor();
    host.classList.toggle('ff-mobile', mobile);
    var isVideo = !!(currentData && currentData.type !== 'audio');
    // v1.34 T4 (Dean): the system-wide "custom player on mobile" setting
    // vetoes the native strip -- default false keeps the v1.25.2 native
    // behavior byte-identical. The cached flag resolves asynchronously just
    // after load (see the settings fetch in setupForMedia), which re-invokes
    // this function, so the surface settles within the first moments of
    // playback and stays stable for the rest of the load.
    // ACCEPTED tradeoff (v1.34 gate): with the setting ON there is a brief
    // native-controls flash on each mobile video load before the fetch
    // resolves -- deliberately preferred over blocking mount on a settings
    // round-trip (the OFF/default path has no flash at all).
    var native = mobile && isVideo && state === STATE_FULL && !mobileCustomPlayerCached;
    if (native) {
      mediaPlayer.setAttribute('controls', '');
      host.classList.add('native-controls');
    } else {
      mediaPlayer.removeAttribute('controls');
      host.classList.remove('native-controls');
    }
  }

  // v1.36.2 (Dean's PWA report): after an app-switch, iOS can leave a
  // still-`controls`-attributed <video> with a DEAD native control layer --
  // taps on the frame do nothing until the app is force-closed. WebKit only
  // rebuilds the native control overlay's hit-testing when the `controls`
  // attribute actually CYCLES, so a plain applyControlsMode() re-run (a
  // no-op set on an already-set attribute) is not enough. This helper does
  // the off->on cycle, then delegates to applyControlsMode() as the single
  // controls authority (which also re-syncs the `native-controls` /
  // css-fullscreen classes the tap-overlay guards key on). Scoped hard: only
  // the native-mobile-video-FULL shape ever cycles -- the custom-player and
  // desktop paths are byte-unchanged (their applyControlsMode() call is a
  // pure re-sync).
  function rearmNativeControls() {
    if (!host || !mediaPlayer) return;
    var isVideo = !!(currentData && currentData.type !== 'audio');
    var native = isMobileFormFactor() && isVideo && state === STATE_FULL && !mobileCustomPlayerCached;
    if (native && mediaPlayer.hasAttribute('controls')) {
      mediaPlayer.removeAttribute('controls');
    }
    applyControlsMode();
  }

  // v1.34.4: faux-fullscreen state setter -- host class (the fixed overlay
  // treatment) and body class (scroll freeze + header/nav hide) must always
  // move together.
  function setCssFullscreen(on) {
    if (host) host.classList.toggle('css-fullscreen', !!on);
    if (typeof document !== 'undefined' && document.body) {
      document.body.classList.toggle('ft-css-fullscreen', !!on);
    }
  }

  // Native-controls round: true while the native iOS/browser `controls` strip
  // is the active surface (mobile video, FULL only -- see `applyControlsMode`
  // above). Consulted by `wireSkipHoldGestures()`'s handlers below so the
  // custom double-tap-skip/press-hold-2x gesture layer can't fight the native
  // strip's own tap targets -- exactly the coexistence problem v1.22.1's
  // retirement was working around, now solved by simply not running both
  // layers over the same surface at once. Shared by `#media-player` AND
  // `#audio-bg-art` (both call `wireSkipHoldGestures`), but audio never gets
  // `.native-controls` (see `applyControlsMode`), so this is inert for audio.
  function inNativeControlsMode() {
    return !!(host && host.classList.contains('native-controls'));
  }

  // Native-controls round: also treats iOS Picture-in-Picture as a "native
  // presentation" alongside standard/-webkit- fullscreen -- `mediaPlayer.
  // webkitPresentationMode === 'picture-in-picture'` (iOS Safari's own PiP
  // signal) and the standard `document.pictureInPictureElement ===
  // mediaPlayer` (desktop/Android PiP). Shared by every existing caller
  // (the hold-to-2x gesture guard above, the orientation-lock callers below)
  // -- PiP counting as "fullscreen" there too is benign/desirable (e.g. the
  // press-hold-2x gesture shouldn't engage while the video is in a detached
  // PiP window), so this is a single, widened detector rather than a second
  // divergent one.
  //
  // FIX A (player-hardening round): the first condition is an ELEMENT-
  // IDENTITY check (`document.fullscreenElement === host || === mediaPlayer`),
  // not a bare `!!document.fullscreenElement`. This function now also gates
  // `handleBackgroundLifecycle()`'s background pause+save suppression (via
  // `ctx.inNativePresentation`) -- a bare truthiness check would wrongly
  // report "native presentation" (and suppress pause+save) whenever ANY
  // other element on the page is fullscreen while a mobile video keeps
  // playing inline in the background, e.g. an unrelated image/gallery
  // lightbox using the Fullscreen API. Scoping to `host`/`mediaPlayer`
  // specifically means only THIS player's own fullscreen surface (the
  // `#player-wrapper` host or the `<video>` itself) counts.
  function inNativeFullscreen() {
    return !!(document.fullscreenElement === host || document.fullscreenElement === mediaPlayer) ||
      !!(mediaPlayer && mediaPlayer.webkitDisplayingFullscreen) ||
      !!(mediaPlayer && mediaPlayer.webkitPresentationMode === 'picture-in-picture') ||
      !!(document.pictureInPictureElement && document.pictureInPictureElement === mediaPlayer);
  }

  // v1.27.0: the element actually driving playback RIGHT NOW -- `mediaPlayer`
  // for the default INLINE_VIDEO state (and while a handoff is still
  // resolving -- see `nextBackgroundAudioState`'s HANDING_OFF), the hidden
  // `bgAudioEl` once a handoff has actually succeeded (BACKGROUND_AUDIO).
  // Consulted by every position/Media-Session/progress-save call site below
  // so they all keep working through the swap without their own
  // state-machine-aware branching -- `liveMode` (desktop-only) and
  // background-audio (mobile-only) are mutually exclusive by construction,
  // so this is a safe, behavior-preserving generalization for the
  // (overwhelmingly common) INLINE_VIDEO case.
  function activeMediaElement() {
    return (bgAudioState === BG_AUDIO_STATES.HANDING_OFF || bgAudioState === BG_AUDIO_STATES.BACKGROUND_AUDIO)
      ? bgAudioEl : mediaPlayer;
  }

  // Absolute position in the source, accounting for live-stream restart offsets.
  function currentAbsTime() {
    var el = activeMediaElement();
    if (!el) return 0;
    return liveMode ? liveOffset + (el.currentTime || 0) : el.currentTime;
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
    ccBtn = host.querySelector('#cc-btn');
    ccTrack = host.querySelector('#cc-track');
    chaptersBtn = host.querySelector('#chapters-btn');
    chaptersMenu = host.querySelector('#chapters-menu');
    artPlayGlyph = host.querySelector('#art-play-glyph');
    // Feature B (v1.26.1): built in JS (never touches the shared
    // player-host-template markup, so all 5 shells stay byte-identical) --
    // appended once, directly inside `host`, so its CSS (`.cc-overlay`,
    // style.css) can position it purely off the SAME `#player-wrapper`
    // ancestor every other in-host overlay/layer already uses. Starts
    // `hidden` (native attribute -- matches `renderActiveCueOverlay`'s own
    // hide path) with an empty inner text node; VIDEO mode never shows this
    // (see the `#cc-btn` click handler and the `cuechange` listener below,
    // both gated on `currentData.type === 'audio'`).
    ccOverlayEl = document.createElement('div');
    ccOverlayEl.className = 'cc-overlay';
    ccOverlayEl.hidden = true;
    ccOverlayTextEl = document.createElement('div');
    ccOverlayTextEl.className = 'cc-overlay-text';
    ccOverlayEl.appendChild(ccOverlayTextEl);
    host.appendChild(ccOverlayEl);
    // v1.27.0 (background-audio-for-video, EXPERIMENTAL): the hidden <audio>
    // sidecar -- built in JS (never touches the shared player-host-template
    // markup, so all 5 shells stay byte-identical, same posture as
    // `ccOverlayEl` above) and appended once, directly inside `host`, so it
    // rides the reparented host across FULL/DOCKED/CLOSED automatically,
    // exactly like every other in-host element. `preload='none'` -- it never
    // starts fetching anything until a real handoff (or the gesture-prime)
    // calls `.play()` on it. Never shown (`hidden` + `display:none` --
    // belt-and-suspenders; nothing in this file ever unhides it).
    bgAudioEl = document.createElement('audio');
    bgAudioEl.id = 'bg-audio-sidecar';
    bgAudioEl.preload = 'none';
    bgAudioEl.hidden = true;
    bgAudioEl.style.display = 'none';
    host.appendChild(bgAudioEl);
    wireHostListeners();
    return host;
  }

  // ---- Feature A (v1.26.1): reserved-aspect DOM wrapper ----------------------
  // Sets (or clears) the `--media-aspect` custom property + the
  // `.portrait-media` marker class on `host` -- style.css's
  // `#player-wrapper:not(.audio-expanded) #media-player { aspect-ratio:
  // var(--media-aspect, 16 / 9); }` (and the mobile-portrait height clamp)
  // consume it. Called from TWO places: `setupForMedia()` BEFORE `src` is
  // assigned (server-known dims -- the box reserves the right space from the
  // very first paint, no jump at all) and the `loadedmetadata` no-data
  // fallback below (a legacy item with no stored dims yet -- one early
  // settle instead of a late jump). `width`/`height` of `null`/`undefined`
  // (or any invalid value -- `computeMediaAspectRatio` degrades safely)
  // clears back to the CSS default, which is exactly what teardown wants.
  function applyMediaAspect(width, height) {
    if (!host) return;
    var ratio = computeMediaAspectRatio(width, height);
    if (ratio) {
      host.style.setProperty('--media-aspect', ratio);
      host.classList.toggle('portrait-media', isPortraitMediaAspect(width, height));
    } else {
      host.style.removeProperty('--media-aspect');
      host.classList.remove('portrait-media');
    }
  }

  // ---- Feature B (v1.26.1): AUDIO-mode caption overlay DOM wrappers ----------
  // Renders (or hides) the overlay from a TextTrack's CURRENTLY active cues.
  // `track` is `ccTrack.track` (the live TextTrack) -- reads
  // `track.activeCues` fresh on every call (never cached), same discipline
  // as the existing `#cc-btn` click handler's own live `textTracks[0]` read.
  function renderActiveCueOverlay(track) {
    if (!ccOverlayEl || !ccOverlayTextEl) return;
    var rawTexts = [];
    var cues = track && track.activeCues;
    if (cues) {
      for (var i = 0; i < cues.length; i++) {
        if (cues[i] && typeof cues[i].text === 'string') rawTexts.push(cues[i].text);
      }
    }
    var text = buildCaptionOverlayText(rawTexts);
    // v1.26.4 (frozen audio-CC overlay): idempotent-render guard. This
    // function is now called from THREE data paths (the #cc-btn click
    // handler, the dual cuechange binding, and the timeupdate fallback --
    // see wireHostListeners below), so it must be safe/cheap to call
    // repeatedly with an unchanged result -- skip the DOM write entirely
    // when the text hasn't moved since the last successful paint.
    if (text === lastCcOverlayText) return;
    lastCcOverlayText = text;
    if (text) {
      ccOverlayTextEl.textContent = text;
      ccOverlayEl.hidden = false;
    } else {
      ccOverlayTextEl.textContent = '';
      ccOverlayEl.hidden = true;
    }
  }

  // Force-hides the overlay + clears its text -- called whenever captions
  // are toggled OFF and on every teardown, so a previous item's (or a
  // just-disabled) caption text never lingers visible. Also resets
  // `lastCcOverlayText` (v1.26.4) so a later re-toggle-ON always repaints,
  // even if the first cue shown after re-enabling happens to match
  // whatever text was on screen before the toggle-off.
  function hideCaptionOverlay() {
    if (ccOverlayTextEl) ccOverlayTextEl.textContent = '';
    if (ccOverlayEl) ccOverlayEl.hidden = true;
    lastCcOverlayText = null;
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
    var el = activeMediaElement(); // v1.27.0: the audio element while BACKGROUND_AUDIO, mediaPlayer otherwise
    if (!el) return;
    var posState = clampPositionState(el.duration, el.currentTime, el.playbackRate);
    if (!posState) return;
    lastPositionSync = now;
    try { navigator.mediaSession.setPositionState(posState); } catch (_) {}
  }

  function setupMediaSession(id, channelName, title) {
    currentChannelName = channelName || '';
    if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
    try {
      // v1.38.0: prefer an explicit artUrl (a book cover) for the lock-screen
      // artwork -- the resolveAudioArtUrl precedent, retargeted for TTS.
      var art = (currentData && typeof currentData.artUrl === 'string' && currentData.artUrl) ? currentData.artUrl : ('/thumbnail/' + id);
      navigator.mediaSession.metadata = new MediaMetadata({
        title: title || 'FileTube',
        artist: channelName || '',
        album: 'FileTube',
        artwork: [
          { src: art, sizes: '256x256', type: 'image/jpeg' },
          { src: art, sizes: '512x512', type: 'image/jpeg' },
        ],
      });
      var el = activeMediaElement(); // v1.27.0
      setPlaybackState(el && el.paused ? 'paused' : 'playing');
      updatePositionState(true);
    } catch (_) { /* MediaMetadata construction unsupported */ }
  }

  // v1.27.0: SWAP_BACK -- runs BEFORE the Media Session re-assert just below,
  // so that re-assert (and every other activeMediaElement() consumer) sees
  // the ALREADY-swapped-back state (mediaPlayer active again). A no-op
  // whenever the state machine isn't mid-handoff/backgrounded (the
  // overwhelmingly common case -- the setting defaults OFF and this is
  // mobile-only), so returning to the foreground with a normal inline video
  // is completely unaffected.
  // (v1.35 T2: releaseBackgroundAudioElement strips the src on swap-back --
  // the re-arm below restores readiness for the NEXT background transition.)
  function handleForegroundSwapBack() {
    if (bgAudioState !== BG_AUDIO_STATES.BACKGROUND_AUDIO && bgAudioState !== BG_AUDIO_STATES.HANDING_OFF) return;
    var resumeTime = bgAudioEl ? (bgAudioEl.currentTime || 0) : 0;
    bgAudioState = nextBackgroundAudioState(bgAudioState, 'FOREGROUND', {});
    if (mediaPlayer) {
      mediaPlayer.currentTime = resumeTime;
      // Best-effort: if iOS refuses this (rare -- the app is IN THE
      // FOREGROUND at this point, which is normally enough gesture context),
      // leave it paused -- the position is already correct either way, so
      // the user just needs one more tap, never a lost/wrong position.
      mediaPlayer.play().catch(function () {});
    }
    recordLifecycleEvent('bgAudio:swapback', { detail: 'audio=' + resumeTime.toFixed(1) + 's->video=' + (mediaPlayer ? mediaPlayer.currentTime.toFixed(1) : '?') + 's' });
    releaseBackgroundAudioElement();
    // v1.35 T2: the release above stripped the src -- re-arm immediately so
    // the NEXT lock/app-switch is just as deterministic as the first. (The
    // MediaSession re-assert for the swapped-back video already happens in
    // the visibilitychange-visible handler that called us -- see its own
    // comment at the call site.)
    armBackgroundAudioSrc();
    // F2 (two-reviewer gate): consume a deferred autoplay-advance (see
    // `runEndedCompletionCascade`'s own comment) the moment the app is back
    // in the foreground -- from here on this is an entirely ordinary
    // `handleAutoplayNext()` call, no different from any other 'ended'
    // advance.
    if (pendingAutoplayNextOnForeground) {
      pendingAutoplayNextOnForeground = false;
      handleAutoplayNext();
    }
  }

  // Stops + detaches the hidden audio element -- shared by SWAP_BACK
  // (above) and the force-close teardown (releaseAudioSession, below).
  // Clears `src` (not just pause()) to release the decoder/network resource
  // the backgrounded element was holding, mirroring this file's other
  // "nothing left running" release contracts (e.g. close()'s own
  // removeAttribute('src'); load()) -- a later handoff simply re-points
  // `src` fresh (see attemptBackgroundAudioHandoff), so this is never a
  // one-way trip.
  function releaseBackgroundAudioElement() {
    if (!bgAudioEl) return;
    try { bgAudioEl.pause(); } catch (_) {}
    try { bgAudioEl.removeAttribute('src'); bgAudioEl.load(); } catch (_) {}
  }

  // Re-assert Media Session when the PWA returns to the foreground -- wired
  // ONCE, guarded on `currentData` so it's a no-op whenever nothing is loaded.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible' || !currentData || !mediaPlayer) return;
    handleForegroundSwapBack(); // v1.27.0: SWAP_BACK before the re-assert below reads activeMediaElement()
    // v1.36.2 (Dean's PWA report): re-arm the native control layer on EVERY
    // foreground return -- iOS can strand it unresponsive after an
    // app-switch (see rearmNativeControls' doc comment). Runs after the
    // swap-back so the mode is computed against the settled surface.
    rearmNativeControls();
    setupMediaSession(currentId, currentChannelName, currentData.title);
    var el = activeMediaElement();
    setPlaybackState(el && el.paused ? 'paused' : 'playing');
    updatePositionState(true);
  });

  // ---- Media Session ACTION HANDLERS (lock screen / Control Center) ---------
  // Fixes flaky iOS lock-screen/Control-Center Play: with NO action handlers
  // registered, iOS falls back to unreliable default targeting of "the
  // element that last had audio focus", which is flaky for a <video> that
  // gets programmatically paused + reparented across FULL<->DOCKED (exactly
  // this app's model). Registering handlers gives iOS an explicit, reliable
  // target regardless of reparenting.
  //
  // Wired ONCE, at parse time -- NOT inside setupMediaSession() (which reruns
  // on every load()) and NOT inside wireHostListeners() (which only runs
  // once `ensureHost()` has cloned the template). Both are unnecessary here:
  // there is exactly ONE persistent `<video>` for the whole app lifetime
  // (`ensureHost`, above), and `mediaPlayer` is only ever assigned once, by
  // the time any handler below can actually fire (Media Session metadata --
  // the only thing that makes the OS surface Play/Pause/seek controls at all
  // -- is itself only ever set from `setupMediaSession()`, which requires
  // `mediaPlayer` to already exist). So binding these closures over
  // `mediaPlayer` up front is safe and avoids any re-binding churn.
  //
  // `setMediaSessionAction` wraps each registration in its own try/catch:
  // per spec, `setActionHandler` throws for an action name the browser
  // doesn't support, and browsers vary in which actions they implement -- a
  // missing one (e.g. no `seekto` support) must never prevent the rest from
  // registering.
  function setMediaSessionAction(action, handler) {
    if (!('mediaSession' in navigator) || typeof navigator.mediaSession.setActionHandler !== 'function') return;
    try { navigator.mediaSession.setActionHandler(action, handler); } catch (_) { /* action unsupported by this browser */ }
  }

  // v1.27.0: every handler below is retargeted from a hardcoded `mediaPlayer`
  // to `activeMediaElement()` -- INLINE_VIDEO's `mediaPlayer` in the
  // overwhelmingly common (feature-OFF or desktop/audio) case, the hidden
  // `bgAudioEl` once a handoff has succeeded, so a lock-screen/Control-Center
  // Play/Pause/seek while backgrounded acts on whichever element is actually
  // playing right now.
  setMediaSessionAction('play', function () {
    var el = activeMediaElement();
    if (!el) return;
    // The lock-screen tap IS the user gesture iOS needs to resume audio
    // output for a previously-paused/backgrounded element.
    el.play().catch(function () {});
    setPlaybackState('playing');
  });
  setMediaSessionAction('pause', function () {
    var el = activeMediaElement();
    if (!el) return;
    // F1 (two-reviewer gate, v1.27.1 post-release): a lock-screen/Control-
    // Center Pause tap is an EXPLICIT, real user pause -- but it necessarily
    // arrives while `document.visibilityState === 'hidden'` (that's the
    // only time the OS surfaces this control at all), which is exactly the
    // signal `handlePossibleIOSPrePauseHandoff` (the SECOND handoff
    // trigger, wired on `mediaPlayer`'s own 'pause' event, below) uses to
    // decide "this might be iOS's pre-pause-before-backgrounding ordering,
    // try a handoff". A bare `el.pause()` here would let that trigger
    // misread a real lock-screen Pause as the iOS-ordering case and start
    // background audio against the user's own explicit intent (full repro:
    // failed first handoff -> lock-screen Play -> lock-screen Pause ->
    // unwanted un-pause). Routing `mediaPlayer`'s pause through
    // `pauseSuppressingHandoff` sets `suppressPauseHandoff` for the
    // synchronous extent of this call, so that trigger correctly no-ops for
    // this genuine user pause. `bgAudioEl` is never observed by that
    // trigger (wired only on `mediaPlayer`'s own 'pause' event), so its
    // pause stays bare -- no suppression needed or wanted there.
    if (el === mediaPlayer) pauseSuppressingHandoff(mediaPlayer);
    else el.pause();
    setPlaybackState('paused');
  });
  setMediaSessionAction('seekto', function (details) {
    var el = activeMediaElement();
    if (!el || details == null || details.seekTime == null) return;
    if (details.fastSeek && 'fastSeek' in el) {
      el.fastSeek(details.seekTime);
    } else {
      el.currentTime = details.seekTime;
    }
  });
  // Reuse the EXISTING skip() (below) rather than duplicating its
  // liveMode/clamping/progress-save behavior here. skip() itself is
  // activeMediaElement()-aware (v1.27.0), so this needs no extra guard.
  setMediaSessionAction('seekbackward', function (details) {
    if (!mediaPlayer) return;
    skip(-((details && details.seekOffset) || SKIP_SECONDS));
  });
  setMediaSessionAction('seekforward', function (details) {
    if (!mediaPlayer) return;
    skip((details && details.seekOffset) || SKIP_SECONDS);
  });
  // previoustrack/nexttrack deliberately NOT wired: the Prev/Next
  // controls (and the ordered-neighbor lookup they use) live in
  // watch.js as per-visit DOM, not in this persistent player controller --
  // reaching into another file for them is out of scope for this fix.

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
  // PART A (this round, force-quit background-audio fix): the LIGHTEST
  // release that ends the OS media/audio session -- `pause()` + clear Media
  // Session metadata + `setPlaybackState('none')` (see `setPlaybackState`
  // above). Deliberately NOT the CLOSED path's fuller teardown
  // (`removeAttribute('src'); load();`, see `close()` below) -- the page is
  // unloading anyway (this is only ever invoked from a terminal `pagehide`,
  // see `shouldReleaseForLifecycleEvent`), so there is no stale `<video>`
  // left visible to any user-facing surface for the fuller teardown to
  // protect against, and the lighter release is cheaper to run inside the
  // tight time budget a terminal `pagehide` allows before the page is
  // actually torn down. Flagged here (per the exec plan) as the deliberately
  // minimal choice -- add `removeAttribute('src'); load();` too only if
  // Dean's on-device pass shows the lighter release isn't enough.
  // v1.27.0: force-close teardown now stops+releases BOTH elements -- the
  // backgrounded `bgAudioEl` is exactly the kind of leak the v1.25.10
  // force-close-stops-audio fix this function originally shipped for exists
  // to kill, so a terminal pagehide mid-BACKGROUND_AUDIO must never leave it
  // playing. Also resets the state machine to INLINE_VIDEO -- moot for THIS
  // (unloading) page, but keeps the in-memory state consistent defensively.
  // F-D (v1.27.1): wraps a LIFECYCLE-DRIVEN `mediaPlayer.pause()` call so the
  // SECOND handoff trigger (`handlePossibleIOSPrePauseHandoff`, wired on
  // `mediaPlayer`'s own 'pause' event, below) can tell it apart from a
  // genuine user/iOS-initiated pause. HTMLMediaElement's own 'pause' event is
  // dispatched via a QUEUED media-element task, never synchronously inside
  // this call -- so the reset below is deliberately DEFERRED (`setTimeout`,
  // not an immediate try/finally): resetting synchronously would clear the
  // flag before that queued event ever actually fires, making the guard a
  // no-op. F3 (two-reviewer gate hardening, v1.27.1 post-release): this
  // `setTimeout(fn, 0)` reset and the media element's queued 'pause' task run
  // on DIFFERENT task sources (timer vs. DOM manipulation) -- the HTML spec
  // does NOT guarantee which a user agent services first when both are
  // runnable, so nothing here may assume this reset always loses the race
  // against that queued event. `handlePossibleIOSPrePauseHandoff` (below)
  // does not rely on that assumption: it CONSUMES (reads then immediately
  // clears) `suppressPauseHandoff` itself the moment it runs, so this timer
  // is only ever a BACKSTOP -- it exists purely for a `pause()` call that
  // never dispatches a 'pause' event at all (e.g. calling `pause()` on an
  // already-paused element, a spec'd no-op), which would otherwise leave
  // `suppressPauseHandoff` stuck `true` forever. Used by every one of this
  // file's own lifecycle-driven pauses (`releaseAudioSession`,
  // `attemptBackgroundAudioHandoff`, `handleBackgroundLifecycle`'s
  // plain-pause fallback, `teardownMediaState`, `close()`, and the
  // MediaSession 'pause' action handler's mediaPlayer branch -- F1/F5,
  // two-reviewer gate, v1.27.1 post-release) -- NEVER by a real
  // user-initiated pause (`togglePlayPause`, the spacebar shortcut, etc.),
  // which must keep firing `handlePossibleIOSPrePauseHandoff` normally.
  function pauseSuppressingHandoff(el) {
    if (!el) return;
    suppressPauseHandoff = true;
    try { el.pause(); } catch (_) { /* best-effort only */ }
    setTimeout(function () { suppressPauseHandoff = false; }, 0);
  }

  function releaseAudioSession() {
    pauseSuppressingHandoff(mediaPlayer);
    if (bgAudioEl) {
      try { bgAudioEl.pause(); } catch (_) { /* best-effort only -- page is unloading */ }
    }
    if ('mediaSession' in navigator) {
      try { navigator.mediaSession.metadata = null; } catch (_) { /* best-effort only */ }
    }
    setPlaybackState('none');
    bgAudioState = nextBackgroundAudioState(bgAudioState, 'TEARDOWN', {});
  }

  // Thin wrapper so the ONE additional PART A save call site (see below)
  // never adds a second literal `saveProgressToServer(...)` occurrence
  // inside `handleBackgroundLifecycle` itself -- keeps that function's two
  // existing, already-audited save call sites (FIX B, player-hardening
  // round) textually untouched.
  function checkpointProgress() {
    saveProgressToServer(currentAbsTime(), { keepalive: true });
  }

  // v1.27.0 (EXPERIMENTAL): attempts the inline-video -> background-audio
  // handoff. Originally called ONLY from `handleBackgroundLifecycle`'s
  // `shouldPauseForLifecycleEvent(...)` truthy branch (below) -- by
  // construction, every OTHER precondition (mobile, video, playing, not
  // already in native fullscreen/PiP) already held by the time it ran there.
  // F-D (v1.27.1) added a SECOND call site, `handlePossibleIOSPrePauseHandoff`
  // (below), which re-derives those same preconditions independently (see its
  // own comment) before ever calling this -- `trigger` (optional, defaults to
  // `'visibility'`) is ONLY used for the `bgAudio:handoff` diagnostic's
  // detail string, so the overlay can tell which of the two paths actually
  // fired. This only decides/acts on the background-audio-specific pieces via
  // `shouldHandOffToBackgroundAudio` (pure, above). Returns `true` if a
  // handoff was ATTEMPTED (whether or not it ultimately succeeds -- the
  // caller's own pause+save fallback is skipped either way, since this
  // function performs an equivalent pause+save itself as part of the
  // attempt) or `false` if it wasn't eligible at all (caller falls through
  // to today's plain pause+save, completely unchanged).
  // v1.35 T2 (deterministic background audio): THE single site that assigns
  // the real /audio/:id source (evolves F3b: it used to live inline in
  // attemptBackgroundAudioHandoff; both the handoff AND the new pre-arm path
  // route through here, so the invariant "the real URL is assigned in
  // exactly one function" survives). Pre-arming at PLAY TIME -- src +
  // preload=auto on an element the gesture-prime has already blessed --
  // turns the background handoff into a bare .play() on a buffered element,
  // instead of assign-src -> load -> play inside iOS's grudging
  // background-transition window (the flakiness source). Guards: setting ON
  // (the F3b lesson: a disabled install must never touch the real URL),
  // sidecar confirmed ready, video item, and not LIVE-PLAYING background
  // audio (HANDING_OFF is allowed -- the handoff routes through here).
  function armBackgroundAudioSrc() {
    if (!bgAudioEl || !currentId) return false;
    if (!bgAudioSettingCached) return false;
    if (bgAudioStatusKnown !== 'ready') return false;
    if (!currentData || currentData.type === 'audio') return false;
    // QA gate fix: an ENFORCED guard (not just URL idempotency) -- never
    // touch the element while it is LIVE-PLAYING background audio.
    // HANDING_OFF is deliberately allowed: the handoff itself routes
    // through here as the single assignment site.
    if (bgAudioState === BG_AUDIO_STATES.BACKGROUND_AUDIO) return false;
    var audioUrl = '/audio/' + currentId;
    if (bgAudioEl.getAttribute('src') !== audioUrl) {
      bgAudioEl.src = audioUrl;
      // Gate fix (adversarial): the src ASSIGNMENT is free (preload stays
      // 'none' -- no bytes move) and removes the risky assignment step from
      // the lock-time window for every background-audio user. The EAGER
      // BUFFER -- a full sidecar fetch on every watch -- only for installs
      // that opted into preExtractAudio's disclosed resource cost.
      if (preExtractAudioCached) {
        bgAudioEl.preload = 'auto';
        try { bgAudioEl.load(); } catch (_) { /* buffering is best-effort */ }
      }
      recordLifecycleEvent('bgAudio:prearm', { detail: preExtractAudioCached ? 'src set + preloading' : 'src set (lazy buffer)' });
    }
    return true;
  }

  function attemptBackgroundAudioHandoff(trigger) {
    if (!bgAudioEl) return false;
    var eligible = shouldHandOffToBackgroundAudio({
      settingOn: bgAudioSettingCached,
      audioStatus: bgAudioStatusKnown,
      bgAudioState: bgAudioState,
    });
    if (!eligible) {
      // v1.27.1 (diagnostics): mirrors shouldHandOffToBackgroundAudio's own
      // precedence (settingOn, then audioStatus, then bgAudioState) so the
      // recorded reason always names the FIRST gate that actually failed --
      // together with handleBackgroundLifecycle's 'not-video'/
      // 'native-presentation' skips (recorded before this function is even
      // called), every early-out on the background-audio path is now
      // attributable from the ?debugLifecycle=1 overlay.
      recordLifecycleEvent('bgAudio:skip', { detail: bgAudioSkipReason() });
      return false;
    }

    var resumeTime = currentAbsTime();
    bgAudioState = nextBackgroundAudioState(bgAudioState, 'BACKGROUND', { eligible: true });
    // v1.35 T2: with the pre-arm in place this is a no-op (already armed +
    // buffered); armBackgroundAudioSrc remains the SINGLE site that ever
    // assigns the real URL (the F3b invariant, evolved) -- every guard it
    // applies necessarily holds here (the eligibility gate above already
    // required settingOn + status ready).
    armBackgroundAudioSrc();
    bgAudioEl.currentTime = resumeTime;
    // F-D (v1.27.1): `trigger` documents WHICH path fired -- 'visibility'
    // (the original, from handleBackgroundLifecycle) or 'pause-hidden' (the
    // new iOS-pre-pause-ordering trigger, from handlePossibleIOSPrePauseHandoff).
    recordLifecycleEvent('bgAudio:handoff', { detail: 'pos=' + resumeTime.toFixed(1) + 's primed=' + bgAudioGesturePrimed + ' trigger:' + (trigger || 'visibility') });

    var handoffId = currentId; // guards the async .then/.catch below against a load() racing in before play() settles
    var playAttempt;
    try {
      playAttempt = bgAudioEl.play();
    } catch (e) {
      playAttempt = Promise.reject(e);
    }
    // Pause the video + checkpoint the position NOW, regardless of the
    // eventual play() outcome -- worst case (play() rejects, e.g. the iOS
    // gesture wall) this IS today's pause+save behavior, just reached via
    // this branch instead of the caller's own; best case the hidden audio
    // element picks up seamlessly while the video sits paused underneath,
    // ready for SWAP_BACK.
    // F-D: pauseSuppressingHandoff() (not a bare mediaPlayer.pause()) -- this
    // is OUR OWN programmatic pause, part of THIS very handoff; the SECOND
    // trigger (handlePossibleIOSPrePauseHandoff, below) must never react to
    // it (also structurally moot here, since `bgAudioState` was already
    // moved off INLINE_VIDEO just above -- but explicit/consistent with the
    // other two lifecycle-driven pause sites).
    pauseSuppressingHandoff(mediaPlayer);
    saveProgressToServer(resumeTime, { keepalive: true });
    Promise.resolve(playAttempt).then(function () {
      if (currentId !== handoffId || bgAudioState !== BG_AUDIO_STATES.HANDING_OFF) return; // superseded by a newer load/foreground/teardown
      bgAudioState = nextBackgroundAudioState(bgAudioState, 'HANDOFF_SUCCEEDED', {});
      recordLifecycleEvent('bgAudio:ok', { detail: 't=' + (bgAudioEl.currentTime || 0).toFixed(1) + 's' });
      setupMediaSession(currentId, currentChannelName, currentData && currentData.title);
      setPlaybackState('playing');
      updatePositionState(true);
    }, function (err) {
      if (currentId !== handoffId || bgAudioState !== BG_AUDIO_STATES.HANDING_OFF) return;
      bgAudioState = nextBackgroundAudioState(bgAudioState, 'HANDOFF_FAILED', {});
      // Video is already paused+saved above -- today's degrade-gracefully
      // behavior. Nothing further to do; the NEXT background event (if the
      // user foregrounds and re-backgrounds) gets a fresh attempt.
      // NotAllowedError here is the expected shape of the iOS gesture wall
      // rejecting an unprompted play() from the hidden/backgrounded page --
      // the #1 suspect for "it just paused" reports; any OTHER err.name
      // points elsewhere (e.g. a network/decode failure on the sidecar).
      recordLifecycleEvent('bgAudio:fail', { detail: (err && err.name || 'Error') + ':' + String((err && err.message) || '').slice(0, 40) });
    });
    return true;
  }

  // v1.27.1 (diagnostics): pure-ish helper naming WHY attemptBackgroundAudioHandoff's
  // own eligibility gate just failed -- reads the same three signals
  // shouldHandOffToBackgroundAudio does, in the SAME order, so the reason
  // always names the first (and only, by that function's own short-circuit
  // order) gate that actually blocked the handoff.
  function bgAudioSkipReason() {
    if (!bgAudioSettingCached) return 'setting-off';
    if (bgAudioStatusKnown !== 'ready') return 'status-' + (bgAudioStatusKnown || 'none');
    return 'state-' + bgAudioState;
  }

  // F-D (v1.27.1): the SECOND background-audio handoff trigger, wired on
  // `mediaPlayer`'s own 'pause' event (see `wireHostListeners`, below).
  // On-device investigation found iOS can system-pause an inline video
  // BEFORE `visibilitychangeHidden` ever fires -- so by the time
  // `handleBackgroundLifecycle` runs, `ctx.isPlaying` is already `false` and
  // `shouldPauseForLifecycleEvent` never even reaches the branch that
  // attempts a handoff. This is a precise, narrowly-scoped second attempt for
  // exactly that interleaving.
  //
  // Safe by construction, layered defense:
  //   1. `suppressPauseHandoff` -- true for the synchronous extent of every
  //      one of THIS file's own lifecycle-driven pauses (see
  //      `pauseSuppressingHandoff`), so our OWN pause() calls never
  //      re-enter here. F3 (two-reviewer gate hardening, v1.27.1
  //      post-release): CONSUMED (read then immediately cleared) here
  //      rather than merely read -- see this function's own body below for
  //      why.
  //   2. `document.visibilityState === 'hidden'` -- almost every genuine
  //      USER pause (the play/pause button, spacebar, tapping the video)
  //      happens while the app is VISIBLE, so an ordinary pause tap can't
  //      match this. EXCEPTION (F1, two-reviewer gate, v1.27.1
  //      post-release): the lock-screen/Control-Center MediaSession 'pause'
  //      action handler (above) is also a genuine user pause, yet by
  //      definition only ever fires while `hidden` -- it is excluded from
  //      matching here NOT by this visibility check but because it is
  //      itself routed through `pauseSuppressingHandoff`, so guard #1 above
  //      already catches it. This check alone is therefore NOT sufficient
  //      to distinguish every real user pause from a lifecycle-driven one;
  //      it is defense in depth on top of #1, not a standalone guarantee.
  //   3. Every other precondition `shouldPauseForLifecycleEvent` would have
  //      checked (video-only, not native-presenting, not already
  //      mid-handoff) is re-derived independently here, then
  //      `shouldHandOffToBackgroundAudio` (the SAME shared gate the primary
  //      'visibility' trigger uses) makes the final call. F4 (two-reviewer
  //      gate, v1.27.1 post-release): this now ALSO re-derives the mobile
  //      check the shared-gate contract comment (see
  //      `shouldHandOffToBackgroundAudio`'s own comment, above) assigns to
  //      each trigger -- previously omitted here and safe only via the
  //      implicit coupling that `bgAudioSettingCached` is only ever set
  //      truthy on mobile (see `setupForMedia`); now explicit, matching the
  //      primary 'visibility' trigger's own (`handleBackgroundLifecycle`'s
  //      `ctx.isMobile`) check.
  // A failed/ineligible attempt here is a pure no-op -- the video simply
  // stays paused, exactly as it does today.
  function handlePossibleIOSPrePauseHandoff() {
    // F3 (two-reviewer gate hardening, v1.27.1 post-release): consume-once
    // semantics -- read the flag, then clear it immediately, rather than
    // relying solely on `pauseSuppressingHandoff`'s own DEFERRED
    // `setTimeout(fn, 0)` reset. That deferred reset and the media
    // element's queued 'pause' task (which is what invokes this handler)
    // come from different task sources (timer vs. DOM manipulation); the
    // HTML spec does not guarantee which one a user agent runs first when
    // both are runnable, so this function must never assume the flag is
    // still `true` by the time it observes it. Consuming here makes THIS
    // read authoritative regardless of that ordering. The `setTimeout`
    // reset in `pauseSuppressingHandoff` remains as a backstop ONLY for a
    // pause that never actually dispatches a 'pause' event at all (e.g.
    // calling `pause()` on an already-paused element is a spec'd no-op that
    // fires no event) -- without it, `suppressPauseHandoff` would stay
    // stuck `true` forever after such a call.
    var suppressed = suppressPauseHandoff;
    suppressPauseHandoff = false;
    if (suppressed) return; // our own lifecycle-driven pause -- not a real signal
    if (!currentData || currentData.type === 'audio') return; // video-only feature
    if (inNativeFullscreen()) return; // native presentation sustains its own background audio -- never double-trigger
    if (!isMobileFormFactor()) return; // F4 (two-reviewer gate): re-derive the shared-gate contract's mobile precondition explicitly, matching the primary 'visibility' trigger
    if (bgAudioState !== BG_AUDIO_STATES.INLINE_VIDEO) return; // already mid-handoff/backgrounded
    // v1.27.2 (pre-pause candidate bridge): Dean's on-device overlay proved
    // the REAL iOS lock ordering defeats the original hidden-at-pause-time
    // check below -- iOS dispatches the system pause while
    // `document.visibilityState` is STILL 'visible', and only then flips
    // visibility. So a pause arriving while 'visible' is no longer a dead
    // end: it ARMS a short-lived candidate that `handleBackgroundLifecycle`
    // (the 'visibility' side of the bridge) consumes if
    // `visibilitychangeHidden` follows within PRE_PAUSE_CANDIDATE_WINDOW_MS.
    // A genuine user pause with the app staying visible arms a candidate
    // that simply expires unconsumed (or is cleared by the next 'play') --
    // a deliberate pause-then-lock outside the window stays a plain pause.
    if (document.visibilityState !== 'hidden') {
      // v1.27.2 gate fixes (both reviewers): two vetoes before arming --
      // (1) an ENDED video's natural end fires 'pause' first (HTML spec);
      //     an ended item has nothing to hand off, and arming here would
      //     let a lock-right-as-it-finishes restart the audio from 0:00.
      //     (runEndedCompletionCascade also clears the candidate -- this
      //     veto closes the dispatch-order gap between the two events.)
      if (mediaPlayer && mediaPlayer.ended) return;
      // (2) a pause following a recent in-page USER GESTURE is a user pause
      //     (custom bar / native-controls tap / art tap / spacebar / dock)
      //     -- never arm for it, or pause-then-quick-lock resumes audio
      //     against an explicit pause (see lastUserGestureAt's comment).
      //     isFreshPrePauseCandidate doubles as the generic timestamp-
      //     freshness predicate here (same contract, injectable for tests).
      if (isFreshPrePauseCandidate(lastUserGestureAt, Date.now(), GESTURE_PAUSE_GRACE_MS)) {
        recordLifecycleEvent('bgAudio:candidate', { detail: 'vetoed-user-gesture' });
        return;
      }
      prePauseCandidateAt = Date.now();
      recordLifecycleEvent('bgAudio:candidate', {
        detail: 'gates=' + (shouldHandOffToBackgroundAudio({
          settingOn: bgAudioSettingCached,
          audioStatus: bgAudioStatusKnown,
          bgAudioState: bgAudioState,
        }) ? 'pass' : bgAudioSkipReason()),
      });
      return;
    }
    // Already hidden at pause time (the ordering the original F-D trigger
    // was built for -- kept: it may be right on other iOS versions).
    var eligible = shouldHandOffToBackgroundAudio({
      settingOn: bgAudioSettingCached,
      audioStatus: bgAudioStatusKnown,
      bgAudioState: bgAudioState,
    });
    if (!eligible) return; // the 'visibility' trigger's own bgAudio:skip diagnostics already cover WHY, if/when it fires next
    attemptBackgroundAudioHandoff('pause-hidden');
  }

  // v1.27.0 (EXPERIMENTAL): gesture pre-warm. iOS may refuse `bgAudioEl.
  // play()` during a real background handoff unless that ELEMENT has
  // previously been played from inside a genuine, synchronous user gesture
  // (autoplay-unlock is scoped per-element, not per-page) -- and a real
  // background event obviously isn't one. So on the first real gesture that
  // starts THIS video playing (see the `touchstart`/`ppBtn` wiring in
  // wireHostListeners, below), this does a MUTED play()+pause() on
  // `bgAudioEl` synchronously inside that same gesture's call stack --
  // "blessing" the element for a later, gesture-less `.play()` call during
  // an actual handoff. One-shot per load (`bgAudioGesturePrimed`, reset in
  // teardownMediaState/close). Best-effort only: if priming never runs (or
  // fails), `attemptBackgroundAudioHandoff`'s own `.catch` already degrades
  // to today's plain-pause behavior -- this is an optimization, not a
  // correctness dependency.
  //
  // F3 (two-reviewer gate, v1.27.0; REVERSED by F-B below, v1.27.1):
  // originally deliberately did NOT gate on `bgAudioSettingCached`.
  // `setupForMedia`'s `/api/settings` fetch may not have resolved yet by the
  // time the user's FIRST -- and possibly ONLY -- gesture fires (e.g. tap
  // Play, then immediately background the app): `bgAudioGesturePrimed` is a
  // one-shot flag with no second chance, so gating on the cached setting
  // risked skipping priming for the ENTIRE session whenever that race lost.
  // A muted play()+pause() on a hidden, `preload="none"` element is cheap
  // and completely harmless on a load where the setting later resolves OFF
  // (or the video never backgrounds at all) -- see F3b immediately below for
  // why "harmless" is actually true (it wasn't, originally).
  //
  // F-B (v1.27.1 REGRESSION FIX): "harmless" turned out to still be false --
  // see F-A above (`wireHostListeners`'s bgAudioEl play/pause guards). Even
  // with `bgAudioEl.src` never pointed at a real network URL, priming's own
  // MUTED play()+pause() cycle on `bgAudioEl` fired the SAME 'play'/'pause'
  // listeners a real handoff relies on, and raced `setPlaybackState(...)`
  // against the real video's own listeners on EVERY DEFAULT (setting-OFF)
  // install -- the v1.25.2 regression Dean actually hit on-device. F-A closes
  // that hole structurally (every bgAudioEl listener now checks
  // `activeMediaElement() === bgAudioEl`), but priming a hidden element that
  // will NEVER be used this session is still pure waste with zero upside --
  // so this now gates on `bgAudioSettingCached === true`, reinstating the F3
  // race in exchange: a feature-ON user whose FIRST gesture beats the
  // settings fetch back loses ONE priming opportunity (their real handoff
  // attempt still runs `attemptBackgroundAudioHandoff`'s own `.catch`
  // fallback -- degrades to today's plain pause, nothing crashes). That race
  // is strictly cheaper than paying a second media element's play/pause
  // cycle in EVERY session on the overwhelmingly common default-OFF install.
  // Deliberately checked BEFORE `bgAudioGesturePrimed` is ever set (mirrors
  // the `bgAudioState !== INLINE_VIDEO` early-return just below), so a LATER
  // gesture in the same session -- once the settings fetch has resolved --
  // still gets a real, un-consumed chance to prime.
  //
  // F3b (two-reviewer follow-up): primes with the LOCAL `SILENT_PRIME_SRC`
  // data URI (see its own comment above), NEVER the real `/audio/:id` URL --
  // the ORIGINAL version of this fix primed by playing the real network
  // URL, which meant every mobile video's first gesture fired a real
  // request (and could enqueue a real server-side FFmpeg extraction, riding
  // the shared transcode-cache LRU) EVEN ON A DISABLED (default OFF)
  // install. iOS's gesture-unlock is scoped to the ELEMENT, not the src it
  // happened to be playing when unlocked, so priming with an inert clip is
  // exactly as effective for a LATER real handoff. The real `/audio/:id`
  // src is now assigned in exactly ONE place: `armBackgroundAudioSrc` (v1.35)
  // (already gated on the setting being on) -- grep `bgAudioEl.src` to
  // confirm there is no other assignment site.
  function primeBackgroundAudioElement() {
    if (bgAudioGesturePrimed || !bgAudioEl) return;
    if (!currentData || currentData.type === 'audio') return; // video-only feature
    if (!isMobileFormFactor()) return; // desktop is never affected
    // F-B (v1.27.1 REGRESSION FIX, see the long comment above): never prime
    // unless the setting has been FRESHLY confirmed ON. Checked before
    // `bgAudioGesturePrimed` is set, so a later gesture this same session
    // (once `setupForMedia`'s /api/settings fetch resolves) still gets a
    // real, un-consumed chance.
    if (bgAudioSettingCached !== true) return;
    // F3b: never prime while a real handoff is already in flight/active
    // (bgAudioState !== INLINE_VIDEO) -- there's nothing useful to bless
    // (the element is already playing/attempting the REAL audio) and
    // swapping in the silent clip here would clobber it. Deliberately does
    // NOT set `bgAudioGesturePrimed` on this early return, so a LATER
    // gesture (after SWAP_BACK returns to INLINE_VIDEO) still gets a real
    // chance to prime.
    if (bgAudioState !== BG_AUDIO_STATES.INLINE_VIDEO) return;
    bgAudioGesturePrimed = true;
    try {
      // Only ever assigns the SILENT clip -- the real handoff src lives
      // exclusively in attemptBackgroundAudioHandoff, which reassigns `src`
      // itself when it actually runs, so overwriting it here first is safe
      // (and, per the guard just above, this line is unreachable once a
      // real handoff is already active).
      // v1.35 T2: a pre-armed element already carries the real sidecar --
      // bless THAT (the muted play->pause cycle below works on any src, and
      // priming the real sidecar warms its buffer too). Only an un-armed
      // element gets the silent local clip.
      if (!bgAudioEl.getAttribute('src')) {
        bgAudioEl.src = SILENT_PRIME_SRC;
      }
      var wasMuted = bgAudioEl.muted;
      bgAudioEl.muted = true;
      var p = bgAudioEl.play();
      if (p && typeof p.then === 'function') {
        p.then(function () {
          // F3 (two-reviewer gate): a real background handoff can win the
          // race between THIS prime's play() and its own .then() resolving
          // -- `attemptBackgroundAudioHandoff` may already have moved
          // `bgAudioState` past INLINE_VIDEO (HANDING_OFF/BACKGROUND_AUDIO)
          // by the time this continuation runs. The mute-state MUST still be
          // restored unconditionally (a real handoff never touches `.muted`
          // itself, so leaving it muted would silently play the real
          // background audio inaudibly) -- but `pause()` must NEVER run
          // once a real handoff has taken over; this continuation may only
          // ever clean up ITS OWN priming play(), never a later real one.
          bgAudioEl.muted = wasMuted;
          // v1.27.1 (diagnostics): recorded regardless of the race above --
          // whether priming itself succeeded is useful to know even when a
          // real handoff has already taken over (the `return` just below
          // only skips the redundant pause(), never this record).
          recordLifecycleEvent('bgAudio:prime', { detail: 'ok' });
          if (bgAudioState !== BG_AUDIO_STATES.INLINE_VIDEO) return;
          bgAudioEl.pause();
        }, function (err) {
          bgAudioEl.muted = wasMuted;
          // Priming failed -- no-op. The real handoff's own .catch (see
          // attemptBackgroundAudioHandoff) is the actual safety net.
          recordLifecycleEvent('bgAudio:prime', { detail: 'fail:' + (err && err.name || 'Error') });
        });
      } else {
        bgAudioEl.pause();
        bgAudioEl.muted = wasMuted;
      }
    } catch (_) { /* best-effort only */ }
  }

  function handleBackgroundLifecycle(eventType, extraCtx) {
    if (!mediaPlayer || !currentId) return; // nothing loaded -- no-op
    var ctx = {
      isAudio: !!(currentData && currentData.type === 'audio'),
      isPlaying: !mediaPlayer.paused,
      isMobile: isMobileFormFactor(), // FR-8(a) (TG, v1.22.0): reuse FR-1's shared signal (AC78), not a second one
      inNativePresentation: inNativeFullscreen(), // native-controls round: PiP/native-fullscreen video sustains background audio -- never auto-pause it (see shouldPauseForLifecycleEvent)
      persisted: !!(extraCtx && extraCtx.persisted), // PART A: only ever meaningful for a real 'pagehide' -- see shouldReleaseForLifecycleEvent
    };
    // v1.27.1 (diagnostics): record WHY a background-audio handoff never
    // even got a chance to run, for the two guards `shouldPauseForLifecycleEvent`
    // itself short-circuits on BEFORE its truthy branch is ever reached (and
    // therefore before `attemptBackgroundAudioHandoff` is ever called) --
    // mirrors that function's own precedence (native presentation checked
    // before isAudio). Scoped to actual pause-worthy events on currently-
    // playing media only, so a paused item or an untracked event type never
    // adds noise. `attemptBackgroundAudioHandoff`'s own gate failures
    // ('setting-off' / 'status-*' / 'state-*') are recorded separately,
    // inside that function -- together the two cover EVERY early-out.
    if (LIFECYCLE_PAUSE_EVENTS[eventType] && ctx.isPlaying) {
      if (ctx.inNativePresentation) {
        recordLifecycleEvent('bgAudio:skip', { detail: 'native-presentation' });
      } else if (ctx.isAudio) {
        recordLifecycleEvent('bgAudio:skip', { detail: 'not-video' });
      }
    }
    var shouldRelease = shouldReleaseForLifecycleEvent(eventType, ctx);
    if (shouldPauseForLifecycleEvent(eventType, ctx)) {
      // v1.27.0 (EXPERIMENTAL): this is the ONE place a background-audio
      // handoff can ever be triggered -- every precondition
      // `shouldPauseForLifecycleEvent` already checked (mobile, video,
      // playing, not native-fullscreen/PiP) holds here by construction, so
      // the two keep-playing mechanisms (native presentation vs.
      // background-audio) are mutually exclusive without any extra guard.
      if (attemptBackgroundAudioHandoff('visibility')) {
        if (shouldRelease) releaseAudioSession(); // a terminal pagehide still releases even mid-handoff (stops BOTH elements -- see releaseAudioSession)
        return;
      }
      pauseSuppressingHandoff(mediaPlayer); // F-D: lifecycle-driven -- never re-trigger the SECOND (pause-hidden) handoff trigger below
      saveProgressToServer(currentAbsTime(), { keepalive: true });
      if (shouldRelease) releaseAudioSession(); // PART A: a terminal pagehide additionally releases the session (additive -- the pause+save above is unchanged)
      return;
    }
    // v1.27.2 (pre-pause candidate bridge, the consuming side): the branch
    // above never runs when iOS already system-paused the video BEFORE this
    // event (ctx.isPlaying === false -- the ordering Dean's overlay proved).
    // If `handlePossibleIOSPrePauseHandoff` armed a candidate for that pause
    // moments ago, THIS is the completing signal: consume it and attempt the
    // handoff from the already-paused video (attemptBackgroundAudioHandoff
    // works from a paused element -- its own pause() is then a spec'd
    // no-op). Everything else about this block is diagnostics: exactly ONE
    // 'bgAudio:' line per pause-worthy background event on a video load, so
    // the ?debugLifecycle=1 overlay always names what happened -- or the
    // precise reason nothing did. Gated on !shouldRelease: a terminal
    // pagehide is a dying page -- releasing (below) is the only correct
    // move, never a fresh handoff.
    if (LIFECYCLE_PAUSE_EVENTS[eventType] && !ctx.isPlaying && !shouldRelease && currentData && !ctx.isAudio) {
      if (!ctx.isMobile) {
        recordLifecycleEvent('bgAudio:skip', { detail: 'not-mobile' });
      } else if (ctx.inNativePresentation) {
        recordLifecycleEvent('bgAudio:skip', { detail: 'native-presentation' });
      } else if (bgAudioState !== BG_AUDIO_STATES.INLINE_VIDEO) {
        recordLifecycleEvent('bgAudio:skip', { detail: 'state-' + bgAudioState });
      } else {
        // v1.27.2 gate fix (adversarial finding): only visibilitychangeHidden
        // may CONSUME a candidate into a real attempt -- it is the one
        // ordering proven on-device, and a bfcache-bound pagehide
        // (persisted=true, so !shouldRelease) or a 'freeze' must never start
        // audio on a page that is being put away by NAVIGATION rather than
        // by lock/app-switch. The candidate is still zeroed on any of these
        // events (consume-once, fresh or not) so a stale one can't linger.
        var candidateFresh = eventType === 'visibilitychangeHidden'
          && isFreshPrePauseCandidate(prePauseCandidateAt, Date.now(), PRE_PAUSE_CANDIDATE_WINDOW_MS);
        prePauseCandidateAt = 0; // consume-once, fresh or not
        if (candidateFresh) {
          // attemptBackgroundAudioHandoff records its own 'bgAudio:handoff'
          // or 'bgAudio:skip' (setting/status/state reason) line -- the
          // one-line-per-event invariant holds on both outcomes.
          attemptBackgroundAudioHandoff('candidate');
        } else {
          recordLifecycleEvent('bgAudio:skip', { detail: 'not-playing-no-candidate' });
        }
      }
    }
    // FIX B (player-hardening round): decouple SAVE from PAUSE. A video kept
    // playing here specifically because it's in native fullscreen/PiP
    // (`ctx.inNativePresentation` -- see the guard `shouldPauseForLifecycleEvent`
    // consults) still needs its position CHECKPOINTED on backgrounding, not
    // left to the 4s progress-save interval alone -- that interval can be
    // throttled/suspended once the app is actually backgrounded, so a
    // hard-kill mid-background-play would otherwise lose the whole
    // background span. This does NOT call `mediaPlayer.pause()` -- playback
    // keeps going, exactly as intended -- only a checkpoint save. Every other
    // path that reaches this `else if` unpaused is unaffected: audio never
    // sets `inNativePresentation` (no native fullscreen/PiP surface for
    // audio), so it adds no new save here; inline (non-fullscreen) video
    // already took the pause+save branch above.
    if (ctx.inNativePresentation && ctx.isPlaying) {
      saveProgressToServer(currentAbsTime(), { keepalive: true });
      if (shouldRelease) releaseAudioSession(); // PART A: a terminal pagehide releases even a sustained native-presentation session
      return;
    }
    // PART A (this round): everything that reaches here was exempt from BOTH
    // branches above -- a playing AUDIO track (kept exempt by design, see
    // `shouldPauseForLifecycleEvent`'s `ctx.isAudio` guard), or simply
    // nothing currently playing. A genuine terminal pagehide still needs its
    // session released even here (that's exactly the force-quit-leaves-
    // audio-playing bug this fixes) -- checkpoint the position first (so
    // nothing is lost), then release.
    if (shouldRelease) {
      checkpointProgress();
      releaseAudioSession();
    }
  }

  // ---- PART B (this round): gated on-screen lifecycle-event debug log -------
  //
  // The owner has no way to see the JS console on an iOS PWA, and a
  // force-quit may fire NO event at all on some iOS versions -- so lifecycle
  // events are recorded to `localStorage` (survives a hard kill, unlike an
  // in-memory log) as they happen, and rendered on the NEXT open. Purely
  // observational: this never alters any pause/release decision above, and
  // is a complete no-op (zero recording, zero DOM) unless explicitly enabled
  // -- `localStorage['ft-debug-lifecycle'] === '1'`, toggled by visiting
  // `?debugLifecycle=1` (or `=0` to turn back off) once. See
  // `isDebugLifecycleEnabled`/`recordLifecycleEvent`/`renderLifecycleOverlay`.
  var DEBUG_LIFECYCLE_STORAGE_KEY = 'ft-debug-lifecycle';
  var LIFECYCLE_LOG_STORAGE_KEY = 'ft-lifecycle-log';
  // v1.27.1 (background-audio diagnostics): bumped 20 -> 30. The new
  // 'bgAudio:*' events (skip/handoff/ok/fail/prime/arm/swapback) can add
  // several entries per single background/foreground cycle on top of the
  // pre-existing lifecycle events -- 30 keeps a full handoff attempt (arm ..
  // skip-or-handoff .. ok-or-fail .. swapback) visible alongside a little
  // surrounding context without the overlay scrolling out of what fits in
  // its own 35vh max-height (see ensureLifecycleOverlayEl).
  var LIFECYCLE_LOG_CAP = 30;

  function isDebugLifecycleEnabled() {
    try { return localStorage.getItem(DEBUG_LIFECYCLE_STORAGE_KEY) === '1'; } catch (_) { return false; }
  }

  // Wired ONCE, at parse time: lets the owner enable/disable the debug log
  // by visiting `<app>/?debugLifecycle=1` (or `=0`) a single time -- the flag
  // then persists in `localStorage` across every later visit/relaunch.
  function initDebugLifecycleFlag() {
    try {
      var params = new URLSearchParams(window.location.search);
      if (!params.has('debugLifecycle')) return;
      if (params.get('debugLifecycle') === '1') localStorage.setItem(DEBUG_LIFECYCLE_STORAGE_KEY, '1');
      else if (params.get('debugLifecycle') === '0') localStorage.removeItem(DEBUG_LIFECYCLE_STORAGE_KEY);
    } catch (_) { /* localStorage/URLSearchParams unavailable -- no-op */ }
  }

  // Appends one entry to the capped ring buffer. `extraCtx.persisted` is only
  // ever meaningfully set by the `pagehide` listener (mirrors
  // `handleBackgroundLifecycle`'s own ctx -- see above); every other listener
  // passes `{}`, recorded as `persisted: null` (not applicable to that event).
  // `extraCtx.detail` (v1.27.1, background-audio diagnostics) is an OPTIONAL
  // short human-readable string -- e.g. a skip reason or a position/error
  // summary -- attached by the 'bgAudio:*' call sites below; every
  // pre-existing caller omits it, recorded as `detail: null`.
  function recordLifecycleEvent(type, extraCtx) {
    if (!isDebugLifecycleEnabled()) return; // PART B is a complete no-op unless the flag is on
    try {
      var raw = localStorage.getItem(LIFECYCLE_LOG_STORAGE_KEY);
      var log;
      // Corrupt-log self-heal (two-reviewer gate finding F2, v1.27.1
      // post-release): the PARSE alone is wrapped in its OWN try/catch,
      // mirroring `renderLifecycleOverlay`'s own identical guard below --
      // previously a corrupt/non-JSON `raw` value (hand-edited devtools,
      // a partial write from a prior crash, etc.) threw INSIDE the single
      // outer try, which skipped `localStorage.setItem` below entirely and
      // left recording PERMANENTLY dead for the rest of the session (every
      // future call hit the exact same throw on the exact same corrupt
      // value), even though the overlay kept rendering "(no lifecycle
      // events recorded yet)" as if nothing were wrong. Catching JUST the
      // parse and resetting to an empty array lets THIS call's own
      // `localStorage.setItem` (below) overwrite the corruption immediately
      // -- a single self-heal, not a recurring failure.
      try {
        log = raw ? JSON.parse(raw) : [];
      } catch (_) {
        log = [];
      }
      if (!Array.isArray(log)) log = [];
      // F6 (two-reviewer gate, v1.27.0): reads `activeMediaElement()` (the
      // hidden `bgAudioEl` while BACKGROUND_AUDIO, `mediaPlayer` otherwise)
      // rather than a hardcoded `mediaPlayer` -- `mediaPlayer` itself is
      // DELIBERATELY paused during a background-audio handoff (see
      // `attemptBackgroundAudioHandoff`), so a hardcoded read here would
      // always report `playing: false` during BACKGROUND_AUDIO even while
      // audio is genuinely still playing, making the `?debugLifecycle=1`
      // overlay lie during exactly the scenario it exists to verify.
      var activeEl = activeMediaElement();
      log.push({
        type: type,
        detail: extraCtx && 'detail' in extraCtx ? extraCtx.detail : null,
        persisted: extraCtx && 'persisted' in extraCtx ? extraCtx.persisted : null,
        vis: document.visibilityState,
        playing: !!(activeEl && !activeEl.paused),
        t: Date.now(),
      });
      if (log.length > LIFECYCLE_LOG_CAP) log = log.slice(log.length - LIFECYCLE_LOG_CAP);
      localStorage.setItem(LIFECYCLE_LOG_STORAGE_KEY, JSON.stringify(log));
      renderLifecycleOverlay(); // keep an already-visible overlay live-updated
    } catch (_) { /* localStorage unavailable/full -- best-effort only, never throws */ }
  }

  // Small, unobtrusive, fixed-position monospace overlay -- built entirely in
  // JS (never touches any shell's HTML) so every page that loads player.js
  // gets it for free. Only ever created when the debug flag is on.
  function ensureLifecycleOverlayEl() {
    var el = document.getElementById('ft-lifecycle-overlay');
    if (el) return el;
    if (!document.body) return null;
    el = document.createElement('div');
    el.id = 'ft-lifecycle-overlay';
    el.style.cssText = [
      'position:fixed', 'left:0', 'right:0', 'bottom:0', 'z-index:999999',
      'max-height:35vh', 'overflow-y:auto', 'background:rgba(0,0,0,0.75)',
      'color:#0f0', 'font:11px/1.4 monospace', 'padding:4px 6px',
      'pointer-events:auto', 'white-space:pre-wrap',
    ].join(';');
    el.title = 'Tap to clear';
    el.addEventListener('click', function () {
      try { localStorage.removeItem(LIFECYCLE_LOG_STORAGE_KEY); } catch (_) { /* best-effort only */ }
      renderLifecycleOverlay();
    });
    document.body.appendChild(el);
    return el;
  }

  // Renders the ring buffer newest-first. No-op (and never creates the
  // element) unless the debug flag is on -- called both on initial page load
  // (to surface whatever was recorded right before a force-quit) and after
  // every new recorded event, so it stays live while open.
  function renderLifecycleOverlay() {
    if (!isDebugLifecycleEnabled()) return;
    var el = ensureLifecycleOverlayEl();
    if (!el) return;
    var log = [];
    try {
      var raw = localStorage.getItem(LIFECYCLE_LOG_STORAGE_KEY);
      log = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(log)) log = [];
    } catch (_) { log = []; }
    var now = Date.now();
    var lines = log.slice().reverse().map(function (entry) {
      var agoS = Math.max(0, Math.round((now - (entry && entry.t || now)) / 1000));
      // v1.27.1: an optional `detail` string (background-audio diagnostics --
      // e.g. a skip reason, or a position/error summary) rendered right after
      // the type, truncated so one noisy entry (e.g. a long err.message)
      // never blows out the overlay's fixed-height, tap-to-clear layout.
      var detailStr = entry && entry.detail ? ' (' + String(entry.detail).slice(0, 60) + ')' : '';
      return (entry.type || '?') + detailStr + ' · persisted=' + entry.persisted + ' · vis=' + entry.vis +
        ' · playing=' + entry.playing + ' · ' + agoS + 's ago';
    });
    el.textContent = '[tap to clear]\n' + (lines.length ? lines.join('\n') : '(no lifecycle events recorded yet)');
  }

  initDebugLifecycleFlag();
  if (document.body) renderLifecycleOverlay();
  else document.addEventListener('DOMContentLoaded', renderLifecycleOverlay);

  window.addEventListener('pagehide', function (e) {
    var extraCtx = { persisted: !!(e && e.persisted) };
    recordLifecycleEvent('pagehide', extraCtx);
    handleBackgroundLifecycle('pagehide', extraCtx);
  });
  document.addEventListener('freeze', function () {
    recordLifecycleEvent('freeze', {});
    handleBackgroundLifecycle('freeze');
  });
  document.addEventListener('visibilitychange', function () {
    recordLifecycleEvent('visibilitychange', {});
    if (document.visibilityState === 'hidden') handleBackgroundLifecycle('visibilitychangeHidden');
  });
  // `resume`/`pageshow` never drive a pause/release decision (nothing to do
  // on returning to the foreground beyond the existing Media Session
  // re-assert wired separately above) -- recorded for PART B visibility only.
  document.addEventListener('resume', function () { recordLifecycleEvent('resume', {}); });
  window.addEventListener('pageshow', function () { recordLifecycleEvent('pageshow', {}); });

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
    // v1.27.0: retargeted to activeMediaElement() -- identical to `mediaPlayer`
    // in the INLINE_VIDEO case (every desktop/audio/default-OFF path, i.e.
    // byte-identical behavior), but seeks the hidden audio element instead
    // while BACKGROUND_AUDIO (e.g. a lock-screen seekbackward/seekforward
    // action -- see setMediaSessionAction above).
    var el = activeMediaElement();
    var dur = el.duration;
    if (!isFinite(dur) || dur <= 0) return;
    el.currentTime = Math.max(0, Math.min(dur, el.currentTime + delta));
    saveProgressToServer(currentAbsTime());
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

    // Native-controls round: the gesture layer bails out entirely whenever
    // native controls are the active surface (`inNativeControlsMode()`) --
    // mobile video, FULL only -- so it can't fight the native strip's own
    // tap targets (this surface is shared with `#audio-bg-art`, but audio
    // never gets `.native-controls`, so this guard is inert for audio).
    el.addEventListener('dblclick', function (e) {
      if (inNativeControlsMode()) return;
      e.preventDefault();
      var rect = el.getBoundingClientRect();
      var onLeft = (e.clientX - rect.left) < rect.width / 2;
      skip(onLeft ? -SKIP_SECONDS : SKIP_SECONDS);
    });

    el.addEventListener('touchstart', function (e) {
      if (inNativeFullscreen() || inNativeControlsMode() || e.touches.length > 1) {
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
      if (inNativeControlsMode()) return;
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

  // Resume playback at `progress` seconds WITHOUT showing the "Resume at..."
  // overlay -- shared by two call sites in `handleResumePlayback` below: the
  // pre-existing autoplay-advance/below-threshold direct-resume fallback,
  // and D3's (v1.24.0, T13) docked-suppression auto-resume. Handles the
  // desktop live-transcode case exactly like the overlay's own resumeYesBtn
  // handler does (a live-transcode source must be RESTARTED at the target
  // offset, not merely seeked).
  function resumeDirectly(progress) {
    if (liveMode) {
      startLiveStream(progress, true);
    } else {
      mediaPlayer.currentTime = progress;
      mediaPlayer.play().catch(function () {});
    }
  }

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
        // D2 (v1.24.0, T13): read the configurable threshold LIVE, right at
        // this decision point -- see getStoredResumeThreshold's comment.
        var threshold = getStoredResumeThreshold();
        if (shouldShowResumeOverlay({ savedProgress: savedProgress, autoplayAdvance: autoplayAdvance, threshold: threshold })) {
          // D3 (v1.24.0, T13): a genuine resume decision is pending -- decide
          // whether the current dock state can actually surface it legibly.
          var dockedAction = resolveDockedResumeAction({ dockState: state, resumeDecisionPending: true });
          if (dockedAction === 'auto-resume') {
            // DOCKED: the mini-player is too small to read/tap the prompt --
            // suppress it and resume directly instead, same mechanics as the
            // autoplay-advance direct-resume branch just below.
            resumeDirectly(savedProgress);
          } else {
            if (resumeTimeStr) resumeTimeStr.textContent = formatDuration(savedProgress);
            if (resumeOverlay) resumeOverlay.style.display = 'flex';
            mediaPlayer.autoplay = false;
          }
        } else if (savedProgress > 5) {
          // Overlay suppressed (autoplay just advanced here, or savedProgress
          // is real but below the D2 threshold) WITH real saved progress:
          // resume directly instead of prompting, matching the resumeYesBtn
          // handler below -- autoplay-to-next never interrupts with a
          // "resume?" dialog, and short-of-threshold progress is restored
          // quietly rather than discarded.
          resumeDirectly(savedProgress);
        } else if (liveMode) {
          startLiveStream(0, true);
        } else {
          // v1.23.6 (Dean): auto-start on load for MOBILE too, not just
          // desktop -- picking a song/video just plays, no manual tap needed.
          // On iOS the FIRST play of a session may be refused (no user gesture
          // survives the async progress fetch) -> the .catch swallows it and
          // the play button stays exactly as before; once the user has tapped
          // play once, the persistent <video> is unlocked and every later pick
          // auto-plays. The resume-overlay / saved-progress branches above are
          // unchanged (they intentionally do NOT auto-play).
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
      // v1.27.0: checks activeMediaElement() (not a hardcoded mediaPlayer)
      // so progress saves continue against the audio clock while
      // BACKGROUND_AUDIO -- mediaPlayer itself is deliberately paused
      // during a handoff (see attemptBackgroundAudioHandoff), so the old
      // `!mediaPlayer.paused` check would otherwise have stopped saving the
      // instant a handoff succeeded.
      var el = activeMediaElement();
      if (el && !el.paused && currentAbsTime() > 0) {
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

  // v1.34 T2 (Dean, desktop CC sync): keep the caption <track> aligned with
  // the LIVE-transcode timeline. The ffmpeg pipe restarts its clock at 0 on
  // every `?t=` reload while the sidecar's cue times are absolute -- so
  // after any live seek, native cue matching would drift by exactly
  // `liveOffset` seconds. The server shifts cues on demand (`?offset=`,
  // lib/subtitles.js shiftVttCues); this re-points the track at the matching
  // document and re-asserts the user's CC on/off choice across the src swap.
  function syncCcTrackToLiveOffset() {
    if (!ccTrack || !currentId) return;
    if (!(currentData && currentData.hasSubtitles)) return;
    var base = '/api/subtitles/' + currentId;
    var url = liveOffset > 0 ? base + '?offset=' + liveOffset : base;
    if (ccTrack.getAttribute('src') === url) return;
    var prevMode = ccTrack.track ? ccTrack.track.mode : null;
    ccTrack.src = url;
    if (ccTrack.track && prevMode) ccTrack.track.mode = prevMode;
  }

  // (Re)start a desktop live transcode at t seconds into the source.
  function startLiveStream(t, autoplay) {
    liveOffset = Math.max(0, Math.floor(t || 0));
    syncCcTrackToLiveOffset(); // v1.34 T2: see above
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
        // Scope autoplay-advance to the CURRENT ITEM'S FOLDER, identical to the
        // Prev/Next buttons (watch.js) via the SAME parentFolder helper -- so
        // "next" means the same thing whether you tap Next or a video ends
        // (Dean: walk the item's folder, not the whole library).
        var advanceFolder = parentFolder(currentData && currentData.filePath);
        // v1.30.0 T7: same paginated `{ items, ... }` shape + FULL-set
        // requirement as watch.js's Prev/Next (see
        // AUTOPLAY_ADVANCE_FULL_LIST_LIMIT, above) -- deriveOrderedIds needs
        // the ended item's folder-mates in full, or its next-in-order
        // neighbor could sit past a truncated page-1 boundary and autoplay
        // would silently stop advancing.
        var advanceBaseUrl = advanceFolder ? '/api/videos?root=' + encodeURIComponent(advanceFolder) : '/api/videos';
        var advanceSeparator = advanceBaseUrl.indexOf('?') !== -1 ? '&' : '?';
        return fetch(advanceBaseUrl + advanceSeparator + 'limit=' + AUTOPLAY_ADVANCE_FULL_LIST_LIMIT)
          .then(function (res) { return res.json(); })
          .then(function (data) {
            if (currentId !== endedId) return; // controller has moved on -- stale, no-op
            var videos = Array.isArray(data && data.items) ? data.items : [];
            var sortKey = 'newest';
            try { sortKey = localStorage.getItem('filetube_sort') || 'newest'; } catch (_) { /* storage disabled -- fall back to newest */ }
            var orderedIds = deriveOrderedIds(videos, sortKey);
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

  // v1.27.0 (F2, two-reviewer gate): the shared 'ended' completion cascade.
  // Before this, mediaPlayer's completion behavior on 'ended' -- reset-to-0 +
  // one-shot progress-0 save (C2 remediation), `setPlaybackState('none')`,
  // loop-replay (FR-7), and autoplay-next (FR-3) -- was FOUR separate
  // `mediaPlayer`-only listeners with no counterpart on `bgAudioEl`. A video
  // that finished playing WHILE backgrounded (the hidden `<audio>` element is
  // the one actually running to completion, `mediaPlayer` itself sits paused
  // underneath -- see `attemptBackgroundAudioHandoff`) never fired 'ended' on
  // `mediaPlayer` at all, so none of the four behaviors ever ran: progress
  // stayed at ~100% forever (never reset to 0), the Media Session
  // `playbackState` stayed stuck on 'playing', loop silently never replayed,
  // and autoplay-next never advanced.
  //
  // Extracted into ONE function so `mediaPlayer`'s own 'ended' listener
  // (registered in `wireHostListeners`, replacing the four separate ones)
  // and the NEW `bgAudioEl` 'ended' listener (also in `wireHostListeners`,
  // gated on `bgAudioState === BACKGROUND_AUDIO`) share identical semantics
  // instead of two copies drifting apart. `el` is whichever element actually
  // fired 'ended' -- `mediaPlayer` in the ordinary (foreground) case,
  // `bgAudioEl` while backgrounded -- so loop-replay always replays via the
  // element that was ACTUALLY playing (never attempts to foreground the
  // video just to loop it while backgrounded).
  //
  // Registered at the exact same relative position mediaPlayer's four
  // listeners used to occupy (immediately before the still-separate
  // `loadedmetadata`/`updatePlayPauseUI`/`stopFillLoop` 'ended' listeners
  // below), so mediaPlayer's own observable 'ended' behavior -- including
  // its ordering relative to those other listeners -- is byte-for-byte
  // unchanged from before this extraction.
  //
  // Autoplay-next-while-backgrounded (F2 decision): `handleAutoplayNext`
  // itself performs a settings fetch -> a videos fetch -> a full
  // `window.FileTube.navigate()` SPA content swap for the next item -- a
  // multi-step, timer/fetch-dependent sequence that's exactly the kind of
  // work a backgrounded iOS tab is most likely to suspend PARTWAY through
  // (see WebKit's background-tab throttling of timers/fetches), which could
  // leave the SPA half-navigated with no foreground UI visible to notice or
  // recover it. The persistent-host machinery `navigate()` relies on is real
  // and shared with every other prev/next/autoplay path, but "safe when
  // foregrounded" is not the same guarantee as "safe mid-background" -- so
  // rather than risk a broken navigation nobody is looking at, this DEFERS
  // autoplay-advance to the next foreground swap-back via
  // `pendingAutoplayNextOnForeground` (consumed by
  // `handleForegroundSwapBack`, below) whenever `el` is `bgAudioEl`. By the
  // time that flag is consumed the app is back in the foreground and this is
  // an entirely ordinary `handleAutoplayNext()` call, no different from any
  // other 'ended' advance.
  function runEndedCompletionCascade(el, opts) {
    var backgrounded = !!(opts && opts.backgrounded);
    // v1.27.2 gate fix: a natural end fires 'pause' BEFORE 'ended' (HTML
    // spec), and that pause is unsuppressed + visible + INLINE_VIDEO -- so
    // it just ARMED a pre-pause candidate. Left standing, a lock within the
    // candidate window of a video finishing (extremely natural timing)
    // would consume it and hand off from position 0 -- restarting the whole
    // item's audio on the lock screen against clear intent. An ended item
    // has nothing to hand off; kill the candidate here.
    prePauseCandidateAt = 0;
    // C2 remediation (v1.16.0): reset to 0 on 'ended', and do NOT re-save the
    // end position afterward -- clearProgressInterval() (unlike
    // stopProgressSaver()) only stops the ticking saver, so the just-written
    // 0 is the FINAL persisted value.
    saveProgressToServer(0);
    clearProgressInterval();
    if (!liveMode && el) el.currentTime = 0;
    setPlaybackState('none');
    // FR-7 (TF, v1.22.0, AC49): loop takes precedence over autoplay-advance.
    if (isLoopEnabled()) {
      if (liveMode) {
        startLiveStream(0, true);
      } else if (el) {
        el.currentTime = 0;
        el.play().catch(function () {});
      }
      return; // loop wins -- never autoplay-advance (immediately or deferred) while looping
    }
    if (backgrounded) {
      pendingAutoplayNextOnForeground = true;
      return;
    }
    handleAutoplayNext();
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
    // v1.27.2 gate fix (belt-and-braces with the host-level gesture capture
    // in wireHostListeners): an explicit in-app toggle is a user gesture --
    // stamp it so handlePossibleIOSPrePauseHandoff never arms a pre-pause
    // candidate for the pause it causes.
    lastUserGestureAt = Date.now();
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

  // ---- resume-prompt threshold (D2, v1.24.0, T13) ---------------------------
  // Read LIVE from `localStorage['filetube_resume_threshold']` on every call
  // (never cached at module load) -- called fresh from `handleResumePlayback`
  // below on every single resume decision, so a change made on the Setup
  // page's "Playback" section takes effect on the very next video open, no
  // page reload required. Same guarded try/catch idiom as
  // `loadStoredPlaybackRate`/`loadStoredVolume` above (storage disabled/full/
  // garbage all degrade to `DEFAULT_RESUME_THRESHOLD_SECONDS`, never throw);
  // `resolveResumeThreshold` (the pure top-of-file validator) is the single
  // source of truth for what counts as "garbage," reused here rather than
  // duplicated.
  function getStoredResumeThreshold() {
    try { return resolveResumeThreshold(localStorage.getItem(RESUME_THRESHOLD_STORAGE_KEY)); } catch (_) { return DEFAULT_RESUME_THRESHOLD_SECONDS; }
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
    // iOS iPhone: requestFullscreen() is refused on every element, so the ONLY
    // way to fullscreen an inline <video> is its own webkitEnterFullscreen().
    // It requires the video to actually support fullscreen (a loaded video
    // track) -- `webkitSupportsFullscreen` is the readiness gate. Calling
    // webkitEnterFullscreen() while that is false silently no-ops, which on
    // Dean's device reads as "the mobile-video fullscreen button does nothing"
    // (the v1.22.1 regression: the custom #fs-btn replaced the native controls'
    // own fullscreen button, and this readiness case was never handled).
    if (typeof mediaPlayer.webkitEnterFullscreen === 'function') {
      if (mediaPlayer.webkitSupportsFullscreen) {
        try { mediaPlayer.webkitEnterFullscreen(); } catch (_) { /* refused -- ignore */ }
      } else {
        // Tapped before the video track is known (e.g. during load/transcode):
        // enter as soon as it becomes available. `{ once: true }` so it never
        // leaks across items.
        var enterWhenReady = function () {
          try { mediaPlayer.webkitEnterFullscreen(); } catch (_) { /* refused -- ignore */ }
        };
        mediaPlayer.addEventListener('loadedmetadata', enterWhenReady, { once: true });
      }
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
    // F-D (v1.27.1): the SECOND background-audio handoff trigger -- see
    // `handlePossibleIOSPrePauseHandoff`'s own comment for the full
    // rationale (iOS can system-pause an inline video BEFORE
    // `visibilitychangeHidden` fires) and its layered safety guards.
    mediaPlayer.addEventListener('pause', handlePossibleIOSPrePauseHandoff);
    // v1.27.2 (pre-pause candidate bridge): any resumed playback invalidates
    // a pending candidate -- the pause it described is no longer "the last
    // thing that happened" (e.g. user paused, changed their mind, hit play,
    // THEN locked: the lock must consult live state, not the stale pause).
    mediaPlayer.addEventListener('play', function () { prePauseCandidateAt = 0; });
    // v1.27.2 (two-reviewer gate fix): host-level, capture-phase,
    // passive gesture stamps -- the veto signal that distinguishes a USER
    // pause (always preceded by an in-page gesture: a tap on the native
    // iOS controls, the custom bar, the art, the dock) from an iOS SYSTEM
    // pause (never preceded by one). Capture-phase so native-controls taps
    // that never bubble a dedicated JS event of their own are still seen as
    // raw touch/mouse activity on the host; passive so scrolling/gesture
    // layers are unaffected. See lastUserGestureAt's own comment for the
    // full rationale + trade-off.
    ['touchstart', 'mousedown', 'click'].forEach(function (evt) {
      host.addEventListener(evt, function () { lastUserGestureAt = Date.now(); }, { passive: true, capture: true });
    });
    // v1.27.0 (background-audio-for-video, EXPERIMENTAL): the SAME
    // progress-saver + Media-Session play/pause-state wiring, on the hidden
    // audio element. `attemptBackgroundAudioHandoff` pauses `mediaPlayer`
    // (firing its own 'pause' above, which stops the saver) as part of every
    // handoff attempt; once `bgAudioEl.play()` actually resolves, ITS 'play'
    // event is what restarts the saver (now reading `activeMediaElement()`,
    // so it correctly follows whichever element is active) -- without this,
    // progress would silently stop saving for the entire background-audio
    // span. `releaseBackgroundAudioElement`'s own `pause()` (SWAP_BACK) then
    // stops it again, and `mediaPlayer.play()` (also part of SWAP_BACK)
    // restarts it via the listener above -- the saver always follows
    // whichever element is actually playing, with no state-machine-aware
    // branching needed here.
    // F-A (v1.27.1 REGRESSION FIX): every one of these four is gated on
    // `activeMediaElement() === bgAudioEl` -- i.e. a REAL handoff is actually
    // active (bgAudioState is HANDING_OFF/BACKGROUND_AUDIO). Without this
    // guard, `primeBackgroundAudioElement`'s own MUTED play()->pause()
    // "bless" cycle on `bgAudioEl` ALSO fired these listeners: (a) it
    // stopped+restarted the progress saver mid-real-playback for no reason,
    // and worse, (b) it raced `setPlaybackState('playing'/'paused')` against
    // `mediaPlayer`'s OWN listeners just above -- the prime's play() resolves
    // (setting 'playing') then its pause() resolves (setting 'paused')
    // AFTER the real video's own 'play' already asserted 'playing', so the
    // prime's cleanup silently overwrote MediaSession's playbackState back to
    // 'paused' right under a still-playing video. iOS consults exactly that
    // state to decide whether to keep a native-fullscreen video's audio alive
    // in the background -- this was the v1.25.2 regression Dean hit, present
    // even with `backgroundAudioForVideo` OFF (priming always ran
    // unconditionally, per F3). Scoping all four to "only when bgAudioEl is
    // ACTUALLY the active surface" makes the prime's play/pause cycle a
    // complete no-op for every one of them; a real handoff (which flips
    // `bgAudioState`, and therefore `activeMediaElement()`) is unaffected.
    bgAudioEl.addEventListener('play', function () { if (activeMediaElement() !== bgAudioEl) return; startProgressSaver(); });
    bgAudioEl.addEventListener('pause', function () { if (activeMediaElement() !== bgAudioEl) return; stopProgressSaver(); });
    bgAudioEl.addEventListener('play', function () { if (activeMediaElement() !== bgAudioEl) return; setPlaybackState('playing'); updatePositionState(true); });
    bgAudioEl.addEventListener('pause', function () { if (activeMediaElement() !== bgAudioEl) return; setPlaybackState('paused'); updatePositionState(true); });
    // v1.27.0 (F2, two-reviewer gate): bgAudioEl's own 'ended' counterpart to
    // mediaPlayer's completion cascade below -- ONLY acts when this element
    // is the one actually BACKGROUND_AUDIO-playing for the current item
    // (mediaPlayer's own 'ended' never fires while it's the hidden element
    // running to completion, so without this the whole completion cascade
    // -- progress reset, Media Session state, loop, autoplay-next -- was
    // simply unreachable for a video that finished while backgrounded). See
    // `runEndedCompletionCascade`'s own comment (above `handleAutoplayNext`)
    // for the shared semantics and the autoplay-next-while-backgrounded
    // decision.
    bgAudioEl.addEventListener('ended', function () {
      if (bgAudioState !== BG_AUDIO_STATES.BACKGROUND_AUDIO) return;
      runEndedCompletionCascade(bgAudioEl, { backgrounded: true });
    });
    // v1.27.0: gesture-prime coverage for mobile video's NATIVE `controls`
    // strip (FULL, native-controls round) -- that strip's own internal tap
    // handling isn't interceptable from this file, but `touchstart` on the
    // `<video>` itself fires BEFORE it, in the capture phase, so priming from
    // there runs inside the SAME synchronous gesture as whatever the native
    // strip goes on to do (including a native Play tap). Passive + never
    // calls preventDefault/stopPropagation, so it can never interfere with
    // the native strip's own handling -- purely additive.
    mediaPlayer.addEventListener('touchstart', primeBackgroundAudioElement, { passive: true, capture: true });
    // C2 remediation (v1.16.0) / FR-3 (T3) / FR-7 (TF, v1.22.0, AC48/AC51/
    // AC53): reset-to-0 + progress-0 save, `setPlaybackState('none')`,
    // autoplay-next, and loop-replay used to be FOUR separate listeners
    // here. v1.27.0 (F2, two-reviewer gate) consolidated them into the
    // shared `runEndedCompletionCascade` (above `handleAutoplayNext`) so
    // `bgAudioEl`'s own 'ended' counterpart (wired above) can run the exact
    // same semantics instead of a second, drifting copy -- see that
    // function's own comment for the full rationale (including the
    // autoplay-next-while-backgrounded decision). This single listener,
    // registered in the SAME relative position the first of the four used to
    // occupy, reproduces their combined observable behavior byte-for-byte.
    mediaPlayer.addEventListener('ended', function () {
      runEndedCompletionCascade(mediaPlayer);
    });
    mediaPlayer.addEventListener('play', function () { setPlaybackState('playing'); updatePositionState(true); });
    mediaPlayer.addEventListener('pause', function () { setPlaybackState('paused'); updatePositionState(true); });
    // Feature A (v1.26.1, Shorts player-size jump)'s no-data fallback + lazy
    // per-item dimensions backfill, and F2's same-session orientation
    // self-heal, used to be wired ONCE here, reading `currentData`/
    // `currentId` LIVE on every fire. Moved into `setupForMedia` (F4,
    // two-reviewer follow-up) -- see that function's own comment for why:
    // a fast prev/next could let a PREVIOUS item's late 'loadedmetadata'
    // resolve after `currentData`/`currentId` had already moved on to the
    // NEXT item, POSTing the previous item's dimensions under the next
    // item's id.
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

    if (ppBtn) {
      ppBtn.addEventListener('click', function () {
        primeBackgroundAudioElement(); // v1.27.0: synchronous gesture-prime BEFORE the play() below (DOCKED + non-native-controls FULL path)
        togglePlayPause();
      });
    }

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

      // v1.34 T6 (Dean, "proper video scrubbing -- right now it's tap only"):
      // pointer-capture DRAG scrubbing over the same range input. A native
      // <input type=range> drags fine with a mouse, but on iOS a touch-drag
      // is routinely stolen by scroll handling and the native thumb tracking
      // is unreliable -- so this takes over the pointer entirely
      // (setPointerCapture + preventDefault) and drives the SAME
      // input/change pipeline above: 'input' per move (visual fill + time
      // preview, never a currentTime touch -- AC15 semantics preserved) and
      // ONE 'change' on release (the sole commit point, so the
      // live-transcode reload-seek path is byte-identical). Keyboard
      // arrow-key seeking is untouched (native events still fire). The
      // matching CSS half is `.pc-range { touch-action: none; }` (the seek bar
      // carries both classes) -- without it, iOS cancels the pointer stream
      // mid-drag for page scrolling.
      if (typeof seekBar.setPointerCapture === 'function' && typeof PointerEvent !== 'undefined') {
        var seekDragging = false;
        var seekRatioFromPointer = function (e) {
          var rect = seekBar.getBoundingClientRect();
          return scrubRatioFromPointer(e.clientX, rect.left, rect.width);
        };
        var applySeekDragRatio = function (ratio, evtName) {
          if (ratio === null) return;
          seekBar.value = String(ratio);
          seekBar.dispatchEvent(new Event(evtName));
        };
        var endSeekDrag = function (e) {
          if (!seekDragging) return;
          seekDragging = false;
          var ratio = e ? seekRatioFromPointer(e) : null;
          if (ratio !== null) seekBar.value = String(ratio);
          seekBar.dispatchEvent(new Event('change'));
        };
        seekBar.addEventListener('pointerdown', function (e) {
          if (e.pointerType === 'mouse' && e.button !== 0) return;
          seekDragging = true;
          try { seekBar.setPointerCapture(e.pointerId); } catch (_) { /* capture unsupported -- moves still arrive while over the bar */ }
          // Gate fix (adversarial): document-level one-shot backstops -- when
          // capture is unsupported and the release lands OFF the bar,
          // seekBar's own pointerup never fires, which would latch
          // isScrubbing true forever (freezing the fill/time display for the
          // session). With successful capture these fire redundantly after
          // the element's own handler -- endSeekDrag's seekDragging guard
          // makes the second call a no-op.
          document.addEventListener('pointerup', endSeekDrag, { once: true });
          document.addEventListener('pointercancel', endSeekDrag, { once: true });
          applySeekDragRatio(seekRatioFromPointer(e), 'input');
          e.preventDefault(); // we own this gesture: no native-range fallback, no scroll steal
        });
        seekBar.addEventListener('pointermove', function (e) {
          if (!seekDragging) return;
          applySeekDragRatio(seekRatioFromPointer(e), 'input');
        });
        seekBar.addEventListener('pointerup', endSeekDrag);
        seekBar.addEventListener('pointercancel', function () {
          // The system stole the pointer (rare with touch-action:none, but
          // possible) -- commit wherever the thumb currently sits rather
          // than leaving isScrubbing latched true forever.
          endSeekDrag(null);
        });
      }
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
        // v1.34.2 (Dean round 2): CUSTOM-mode mobile video fullscreen. On
        // iPhone, element fullscreen for <video> is ALWAYS the native
        // player (webkitEnterFullscreen -- a platform rule, no custom UI
        // possible inside it), which defeated the whole point of the
        // mobileCustomPlayer trial. In custom mode we use a CSS
        // faux-fullscreen instead: the host goes position:fixed inset:0
        // (see .css-fullscreen, style.css), keeping OUR bar -- chapters,
        // scrubbing, CC -- on top of a full-viewport picture. The same
        // button toggles back out. Native mode and desktop keep the real
        // Fullscreen API path below, byte-identical.
        // v1.34.3: keyed off the ACTIVE surface (not the async cached
        // settings flag, which introduced a click-time race): if the custom
        // bar is what's on screen for a mobile VIDEO, faux fullscreen is the
        // right behavior -- period.
        if (isMobileFormFactor() && !inNativeControlsMode() &&
            currentData && currentData.type !== 'audio' && state === STATE_FULL) {
          setCssFullscreen(!host.classList.contains('css-fullscreen'));
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

    // A6 (T16, v1.24 UX Round, Wave 5): CC (captions) toggle -- the ONE
    // approved exception to this round's "no player-control changes"
    // exclusion. Wired ONCE here, alongside the rest of the custom bar, so
    // it rides the persistent host across FULL/DOCKED/CLOSED exactly like
    // every other control-bar listener above. Visibility is driven entirely
    // by `setupForMedia()` per-load (gated on `data.hasSubtitles` -- track
    // AVAILABILITY is the only gate, never a second mobile-detection signal,
    // see that function below); this listener only toggles the <track>'s
    // `mode` (and the button's own pressed state) once the button is
    // actually visible/clickable. `textTracks[0]` is `ccTrack`'s live
    // TextTrack object -- read fresh on every click (rather than cached
    // once) since `mediaPlayer.load()` (called by `teardownMediaState()` on
    // every genuine new load) can invalidate a previously-held reference.
    //
    // Feature B (v1.26.1): AUDIO gets its OWN branch here -- the existing
    // 'showing'/'hidden' toggle below is VIDEO-only and completely
    // untouched. For audio, native cue rendering never shows on iOS (the
    // <video> is transparent/pointer-events:none over #audio-bg-art in
    // audio mode, see that class's own comment in style.css), so the track
    // is NEVER set to 'showing' -- it toggles between 'disabled' (CC off;
    // matches teardownMediaState()'s reset default, no cuechange events)
    // and 'hidden' (CC on; cuechange fires, but only the CUSTOM overlay --
    // wired once via the 'cuechange' listener just below -- ever renders
    // it). `audioCaptionsOn` is this controller's own on/off flag for the
    // overlay, independent of `track.mode` string.
    if (ccBtn) {
      ccBtn.addEventListener('click', function () {
        if (!mediaPlayer || !mediaPlayer.textTracks || !mediaPlayer.textTracks[0]) return;
        var track = mediaPlayer.textTracks[0];
        var isAudio = !!(currentData && currentData.type === 'audio');
        if (isAudio) {
          audioCaptionsOn = !audioCaptionsOn;
          track.mode = audioCaptionsOn ? 'hidden' : 'disabled';
          ccBtn.classList.toggle('active', audioCaptionsOn);
          ccBtn.setAttribute('aria-pressed', audioCaptionsOn ? 'true' : 'false');
          if (audioCaptionsOn) renderActiveCueOverlay(track);
          else hideCaptionOverlay();
        } else {
          var showing = track.mode === 'showing';
          track.mode = showing ? 'hidden' : 'showing';
          ccBtn.classList.toggle('active', !showing);
          ccBtn.setAttribute('aria-pressed', showing ? 'false' : 'true');
        }
      });
    }

    // Feature B (v1.26.1) / v1.26.4 fix (frozen audio-CC overlay, on-device
    // iOS bug): the overlay's `cuechange` data source. `cuechange` fires for
    // BOTH 'hidden' and 'showing' track modes (per the WebVTT spec), so
    // VIDEO's own 'hidden' <-> 'showing' toggle above would ALSO reach this
    // handler -- the `currentData.type === 'audio'` guard is what keeps
    // VIDEO mode completely untouched (native rendering only, exactly as
    // before this feature).
    //
    // ROOT CAUSE (v1.26.4, high confidence, Dean's iPhone): iOS WebKit does
    // not reliably fire `cuechange` on a TextTrack whose `mode` is 'hidden'
    // during ACTIVE playback (documented: Apple Developer Forums thread
    // 704536; video.js issue #7417) -- exactly the mode this overlay uses
    // for audio (see the click handler's own comment above). The original
    // fix bound `cuechange` ONLY on `ccTrack.track` (the TextTrack object),
    // which is what silently froze the overlay after its first paint: no
    // event, no repaint, forever. Two changes here:
    //
    //  1. DUAL binding: the WebVTT spec fires `cuechange` at BOTH the
    //     `<track>` ELEMENT and its `.track` TextTrack object -- bind the
    //     shared handler on both. The element-level listener also survives
    //     a `.track` object being replaced/recreated by the browser (the
    //     click handler's own comment above already distrusts cached
    //     `.track` references after `mediaPlayer.load()`); binding on
    //     `ccTrack` itself is immune to that. Reading `ccTrack.track`
    //     FRESH inside the handler (never captured) keeps this correct even
    //     if the TextTrack instance underneath has changed. Double delivery
    //     when both fire is harmless: `renderActiveCueOverlay`'s own
    //     idempotent guard (see its own comment) makes the second call a
    //     no-op.
    //  2. This dual binding is still NOT the fix that actually solves the
    //     freeze on iOS -- see the `timeupdate` fallback wired below, which
    //     is the load-bearing path.
    function handleCcCueChange() {
      if (!currentData || currentData.type !== 'audio') return;
      if (ccTrack && ccTrack.track) renderActiveCueOverlay(ccTrack.track);
    }
    if (ccTrack) ccTrack.addEventListener('cuechange', handleCcCueChange);
    if (ccTrack && ccTrack.track) ccTrack.track.addEventListener('cuechange', handleCcCueChange);

    // ---- v1.34 T3 (Dean): chapter picker ------------------------------------
    // The button toggles a popup listing the loaded item's RESOLVED chapters
    // (server-side precedence: manual > embedded > description); picking one
    // seeks -- through startLiveStream for a live transcode (the reload-seek
    // path, which also keeps captions aligned via syncCcTrackToLiveOffset),
    // plain currentTime otherwise. The menu always ends with an
    // "Edit chapters…" entry that opens common.js's textarea editor
    // (showChaptersEditor), so chapters can be ADDED to an item that has
    // none. All textContent, no innerHTML.
    function closeChaptersMenu() {
      if (chaptersMenu) chaptersMenu.hidden = true;
      if (chaptersBtn) chaptersBtn.setAttribute('aria-expanded', 'false');
    }
    function seekToChapter(t) {
      if (!mediaPlayer) return;
      if (liveMode) {
        startLiveStream(t, true);
      } else {
        mediaPlayer.currentTime = t;
        if (mediaPlayer.paused) mediaPlayer.play().catch(function () {});
      }
      saveProgressToServer(t);
      closeChaptersMenu();
    }
    function openChaptersEditorFromMenu() {
      closeChaptersMenu();
      if (typeof window.showChaptersEditor !== 'function' || !currentId) return;
      var lines = currentChapters.map(function (ch) {
        return formatDuration(ch.startTime) + ' ' + (ch.title || '');
      }).join('\n');
      window.showChaptersEditor(currentId, lines, function (resolved) {
        currentChapters = Array.isArray(resolved && resolved.chapters) ? resolved.chapters : [];
        if (currentData) currentData.chapters = currentChapters;
        buildChaptersMenu();
      });
    }
    function buildChaptersMenu() {
      if (!chaptersMenu) return;
      while (chaptersMenu.firstChild) chaptersMenu.removeChild(chaptersMenu.firstChild);
      // v1.34.2 (Dean round 2): an EXPLICIT close affordance -- tap-outside
      // dismissal exists too, but a visible header row with a close button
      // is unambiguous on a phone.
      var header = document.createElement('div');
      header.className = 'chapters-menu-header';
      var headerTitle = document.createElement('span');
      headerTitle.textContent = 'Chapters';
      header.appendChild(headerTitle);
      var closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'chapters-menu-close';
      closeBtn.setAttribute('aria-label', 'Close chapters');
      closeBtn.textContent = '\u00d7';
      closeBtn.addEventListener('click', closeChaptersMenu);
      header.appendChild(closeBtn);
      chaptersMenu.appendChild(header);
      currentChapters.forEach(function (ch) {
        var item = document.createElement('button');
        item.type = 'button';
        item.className = 'chapters-menu-item';
        var time = document.createElement('span');
        time.className = 'chapters-menu-time';
        time.textContent = formatDuration(ch.startTime);
        item.appendChild(time);
        item.appendChild(document.createTextNode(' ' + (ch.title || 'Chapter')));
        item.addEventListener('click', function () { seekToChapter(ch.startTime); });
        chaptersMenu.appendChild(item);
      });
      var edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'chapters-menu-item chapters-menu-edit';
      edit.textContent = currentChapters.length > 0 ? 'Edit chapters…' : 'Add chapters…';
      edit.addEventListener('click', openChaptersEditorFromMenu);
      chaptersMenu.appendChild(edit);
    }
    // Exposed to setupForMedia (which runs outside this wiring closure).
    applyChaptersForMedia = function (data) {
      currentChapters = data && Array.isArray(data.chapters) ? data.chapters : [];
      buildChaptersMenu();
      closeChaptersMenu();
      if (chaptersBtn) chaptersBtn.style.display = '';
      // v1.34.1 (Dean's on-device pass): the mobile custom bar overflowed --
      // CSS hides the Ch button on .ff-mobile when the item has NO chapters
      // (the button was pure clutter there; "Add chapters" stays reachable
      // on desktop and on any mobile item that already HAS chapters).
      if (host) host.classList.toggle('has-chapters', currentChapters.length > 0);
    };
    resetChaptersUi = function () {
      currentChapters = [];
      closeChaptersMenu();
      if (chaptersMenu) while (chaptersMenu.firstChild) chaptersMenu.removeChild(chaptersMenu.firstChild);
      if (chaptersBtn) chaptersBtn.style.display = 'none';
      if (host) host.classList.remove('has-chapters');
    };
    if (chaptersBtn) {
      chaptersBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (!chaptersMenu) return;
        var opening = chaptersMenu.hidden;
        chaptersMenu.hidden = !opening;
        chaptersBtn.setAttribute('aria-expanded', opening ? 'true' : 'false');
      });
    }
    if (!chaptersOutsideCloseWired) {
      chaptersOutsideCloseWired = true;
      // v1.34.1 (Dean's on-device pass): BOTH click and pointerdown. iOS
      // does not synthesize 'click' for taps on the gesture-layer video
      // surface (touch handlers preventDefault) or non-interactive nodes --
      // the click-only close left the menu un-dismissable on mobile.
      // pointerdown fires universally; double delivery on desktop is a
      // harmless second close on an already-hidden menu.
      var closeChaptersMenuOnOutside = function (e) {
        if (!chaptersMenu || chaptersMenu.hidden) return;
        if (chaptersMenu.contains(e.target) || (chaptersBtn && chaptersBtn.contains(e.target))) return;
        closeChaptersMenu();
      };
      document.addEventListener('click', closeChaptersMenuOnOutside);
      document.addEventListener('pointerdown', closeChaptersMenuOnOutside);
      // v1.34.5 (Dean round 5): iOS AUTO-ENTERS the native fullscreen player
      // when a playing inline video rotates to landscape (a Safari behavior,
      // playsinline notwithstanding) -- in CUSTOM mode that hijacks the
      // surface away from our bar. The rotation is still a fullscreen
      // INTENT, so bounce out of the native player and grant FAUX
      // fullscreen instead: rotate-sideways becomes the fullscreen gesture,
      // with FileTube's own controls. Native-controls mode is untouched
      // (rotating into the native player there is the desired behavior).
      if (mediaPlayer) {
        mediaPlayer.addEventListener('webkitbeginfullscreen', function () {
          if (!isMobileFormFactor() || inNativeControlsMode()) return;
          if (!currentData || currentData.type === 'audio') return;
          try { mediaPlayer.webkitExitFullscreen(); } catch (_) { /* not fullscreen anymore -- fine */ }
          setCssFullscreen(true);
        });
      }
      // v1.34.2: iOS belt-and-braces -- touchstart fires even where a
      // WebKit quirk eats pointer/click synthesis, and any play/pause/seek
      // interaction closes the menu regardless of where the tap landed.
      document.addEventListener('touchstart', closeChaptersMenuOnOutside, { passive: true });
      if (mediaPlayer) {
        mediaPlayer.addEventListener('play', closeChaptersMenu);
        mediaPlayer.addEventListener('pause', closeChaptersMenu);
        mediaPlayer.addEventListener('seeking', closeChaptersMenu);
      }
    }

    // v1.26.4 fix (frozen audio-CC overlay, THE load-bearing fix): a
    // `timeupdate`-driven fallback that repaints the overlay from
    // `track.activeCues` on every native `timeupdate` tick (~4x/sec),
    // completely independent of whether `cuechange` fires at all. This is
    // what actually keeps captions advancing on iOS, where 'hidden'-mode
    // `cuechange` is unreliable during playback (see the root-cause comment
    // above) -- `timeupdate` has no such history of flakiness and is
    // already relied on elsewhere in this file (see updatePositionState's
    // own 'timeupdate' listener above). Tightly gated so it's a total no-op
    // whenever captions aren't actually in play: CC must be toggled ON, the
    // current item must be audio, and a track must exist -- video playback,
    // CC-off audio, and items with no captions never pay for this at all.
    // `renderActiveCueOverlay`'s idempotent guard means the ~4x/sec calls
    // only ever touch the DOM on an actual cue change, exactly like the
    // cuechange-driven paths above.
    mediaPlayer.addEventListener('timeupdate', function () {
      if (!audioCaptionsOn || !currentData || currentData.type !== 'audio') return;
      if (ccTrack && ccTrack.track) renderActiveCueOverlay(ccTrack.track);
    });

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
    function onFsChange() {
      if (inNativeFullscreen()) return;
      autoFullscreen = false;
    }
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
          // Deliberately NOT auto-exiting fullscreen here (re-fix, removed
          // the 2026-07-10 exit-then-resume approach): iOS pauses the video
          // as a side effect of a PROGRAMMATIC `webkitExitFullscreen()`/
          // `exitFullscreen()` call, and then rejects a programmatic
          // `play()` re-assert because it isn't tied to a fresh user
          // gesture -- so any auto-exit-then-resume approach stays paused
          // on-device no matter how the resume is scheduled. Instead we
          // simply leave the video in native fullscreen when rotating back
          // to portrait (it keeps playing); the user exits via the native
          // Done/X control, which IS a real gesture, so iOS keeps it
          // playing inline on that exit. Only clear the `autoFullscreen`
          // bookkeeping flag here (this is a no-op otherwise) -- `onFsChange`
          // does the same once the user's own Done/X tap produces a real
          // fullscreen-exit event.
          autoFullscreen = false;
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
          // v1.27.2 gate fix: route through togglePlayPause() (was a
          // duplicated inline toggle) so the user-gesture stamp inside it
          // covers the keyboard pause path too -- see lastUserGestureAt.
          togglePlayPause();
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
    // F7 (two-reviewer NIT): cancel a still-pending audio-status repoll too, mirroring the two timers just above
    if (audioStatusRepollTimer) { clearTimeout(audioStatusRepollTimer); audioStatusRepollTimer = null; }
    resetTransientPlaybackUi();
    awaitingTranscode = false;
    liveMode = false;
    liveOffset = 0;
    savedProgress = 0;
    // v1.27.0 (background-audio-for-video, EXPERIMENTAL): reset the state
    // machine to INLINE_VIDEO and stop+detach the hidden audio element for
    // the OUTGOING media -- covers BOTH a genuinely new load (prev/next/a
    // related-card click) arriving mid-BACKGROUND_AUDIO (this is what makes
    // that case "bail safely, no double-audio": teardownMediaState() always
    // runs at the START of every real load(), before setupForMedia ever
    // assigns a new src to either element) and simple hygiene (per-load
    // flags reset so the next item gets a fresh gesture-prime/settings-cache
    // opportunity).
    bgAudioState = nextBackgroundAudioState(bgAudioState, 'TEARDOWN', {});
    bgAudioGesturePrimed = false;
    bgAudioSettingCached = false;
    bgAudioStatusKnown = null;
    prePauseCandidateAt = 0; // v1.27.2: a candidate never survives into a new load
    pendingAutoplayNextOnForeground = false; // F2: never let a deferred advance survive into a genuinely new load
    if (bgAudioEl) {
      try { bgAudioEl.pause(); bgAudioEl.removeAttribute('src'); bgAudioEl.load(); } catch (_) { /* best-effort only */ }
    }
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
    // A6 (T16, v1.24 UX Round, Wave 5): reset the CC button/track for the
    // OUTGOING media -- hidden by default until setupForMedia() below
    // re-derives visibility from the NEW media's own `hasSubtitles`, and the
    // track's `mode` is reset to 'disabled' so a previous item's captions
    // never keep rendering over the next item before its own track (if any)
    // loads. `ccTrack.src` is intentionally left for setupForMedia() to set
    // fresh, mirroring how `mediaPlayer.src` itself is handled just below.
    if (ccBtn) { ccBtn.style.display = 'none'; ccBtn.classList.remove('active'); ccBtn.setAttribute('aria-pressed', 'false'); }
    if (ccTrack && ccTrack.track) ccTrack.track.mode = 'disabled';
    resetChaptersUi(); // v1.34 T3: menu closed/emptied, button hidden until next load
    setCssFullscreen(false); // v1.34.2: never leak the fixed overlay across loads
    // Feature B (v1.26.1): the outgoing media's caption overlay must never
    // bleed into the next item -- reset the on/off flag and force-hide/clear
    // the overlay itself (mirrors the CC button reset just above).
    audioCaptionsOn = false;
    hideCaptionOverlay();
    // Feature A (v1.26.1, Shorts player-size jump): clear the reserved
    // aspect + portrait marker for the OUTGOING media -- a previous
    // portrait item's `--media-aspect`/`.portrait-media` must never leak
    // into the next load before setupForMedia() (below) re-derives it (or,
    // for a legacy no-data item, before the loadedmetadata fallback settles
    // it). `applyMediaAspect(null, null)` clears back to the CSS default
    // (16:9) via `computeMediaAspectRatio`'s degrade-safe `null` return.
    applyMediaAspect(null, null);
    if (host) host.classList.remove('audio-mode');
    exitAudioExpand(); // FR-1 (T1, v1.22.2, AC5): every genuine new load force-clears any expanded state left over from the previous media
    // FR-1 (T1, v1.22.0): belt-and-suspenders -- `mountInSlot()` (called a
    // few lines below, in `load()`) re-derives the real controls-mode for
    // the NEW media via `applyControlsMode()` microseconds later, but
    // clearing it here too means no native strip can flash on a mobile-
    // video -> mobile-audio load in between (native-controls round: also
    // clears the `.native-controls` marker class itself, not just the
    // attribute, for the same reason).
    if (mediaPlayer) mediaPlayer.removeAttribute('controls');
    if (host) host.classList.remove('native-controls');
    if (audioBgArt) { audioBgArt.style.display = 'none'; audioBgArt.style.backgroundImage = ''; }
    if (audioVisualizer) audioVisualizer.style.display = 'none';
    if (skipControls) skipControls.style.display = 'none';
    if (mediaPlayer) {
      // F5 (two-reviewer gate, structural consistency, v1.27.1
      // post-release): routed through `pauseSuppressingHandoff` (not a bare
      // `mediaPlayer.pause()`) like this file's other lifecycle-driven
      // pauses -- a genuinely new load's teardown is exactly the kind of
      // app-driven pause `handlePossibleIOSPrePauseHandoff` (the SECOND
      // handoff trigger) must never mistake for a real user pause, even
      // though today's execution-order reasoning (this only ever runs while
      // `document.visibilityState === 'visible'`, since a new load is
      // itself always user/foreground-initiated) happens to make it safe
      // either way.
      pauseSuppressingHandoff(mediaPlayer);
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

  // F-C (v1.27.1, first-watch handoff fix): bounded re-poll of POST
  // /api/videos/:id/prepare-audio, called ONLY from `setupForMedia` (below)
  // when the setting is ON but the FIRST prepare-audio response came back
  // non-terminal (pending/processing) -- i.e. the sidecar wasn't already
  // extracted before this watch session started. Without this, `setupForMedia`
  // fired prepare-audio exactly ONCE per load, so `bgAudioStatusKnown` simply
  // stayed non-'ready' for the rest of the session even once the extraction
  // that same request enqueued (see `queueAudioExtract`, server.js) actually
  // finished a few seconds later -- making a background-audio handoff on a
  // video's FIRST watch structurally impossible, regardless of how long the
  // user kept watching before backgrounding.
  //
  // 5s between attempts, capped at `BG_AUDIO_STATUS_REPOLL_MAX_ATTEMPTS` (12,
  // i.e. up to ~60s total -- generous for a single audio-only extraction,
  // which is normally much faster) so a stuck/never-extracting item (no
  // ffmpeg, huge file, etc.) doesn't poll forever. Stops as soon as the
  // status resolves to a TERMINAL 'ready'/'failed', or a NEWER load has
  // superseded this one (`loadGeneration` guard -- same pattern used
  // throughout this file). Idempotent + cheap on the server (prepare-audio's
  // own de-dupe guard never re-enqueues a job already queued/in-flight), so
  // repeated polling costs nothing beyond the network round-trip itself.
  var BG_AUDIO_STATUS_REPOLL_MAX_ATTEMPTS = 12;
  var BG_AUDIO_STATUS_REPOLL_INTERVAL_MS = 5000;
  function scheduleAudioStatusRepoll(id, gen, attemptsLeft) {
    if (attemptsLeft <= 0) return;
    // F7 (two-reviewer NIT, structural consistency, v1.27.1 post-release):
    // capture the handle in the shared `audioStatusRepollTimer` (like this
    // file's other player-scoped timers -- see their shared declaration
    // above) so teardownMediaState/close can cancel a still-pending repoll
    // outright, rather than leaving it to fire and self-no-op via the `gen`
    // check below.
    audioStatusRepollTimer = setTimeout(function () {
      audioStatusRepollTimer = null;
      if (gen !== loadGeneration) return; // a newer load has since started -- stop silently
      fetch('/api/videos/' + encodeURIComponent(id) + '/prepare-audio', { method: 'POST' })
        .then(function (res) { return res.ok ? res.json() : null; })
        .then(function (body) {
          if (gen !== loadGeneration || !body) return;
          var newStatus = body.audioStatus || null;
          var justBecameReady = newStatus === 'ready' && bgAudioStatusKnown !== 'ready';
          bgAudioStatusKnown = newStatus;
          // Recorded only on the transition INTO 'ready' -- avoids spamming
          // the overlay with an identical 'still pending' entry every 5s.
          if (justBecameReady) {
            recordLifecycleEvent('bgAudio:arm', { detail: 'status=ready (repoll)' });
            armBackgroundAudioSrc(); // v1.35 T2: buffer it now, not at lock time
          }
          if (newStatus !== 'ready' && newStatus !== 'failed') {
            scheduleAudioStatusRepoll(id, gen, attemptsLeft - 1);
          }
        })
        .catch(function () { /* best-effort only -- this attempt's failure simply ends the repoll chain, matching the initial prepare-audio fetch's own degrade-gracefully contract */ });
    }, BG_AUDIO_STATUS_REPOLL_INTERVAL_MS);
  }

  function setupForMedia(id, data) {
    var gen = loadGeneration;
    var streamUrl = '/video/' + id;
    // v1.38.0 TTS "Listen from Here": an audio item may carry an explicit
    // stream URL (a book chapter's synthesized /book/:id/tts/:spineIndex)
    // instead of the default /video/:id. Additive + audio-only -- video and
    // ordinary audio are byte-identical to before.
    if (data.type === 'audio' && typeof data.streamSrc === 'string' && data.streamSrc) {
      streamUrl = data.streamSrc;
    }

    // v1.27.0 (background-audio-for-video, EXPERIMENTAL): reset THIS load's
    // cached setting/status, then (video + mobile only) fetch+cache the
    // setting ONCE and pre-warm the audio-extract sidecar -- so
    // `attemptBackgroundAudioHandoff` never needs a network round-trip at
    // the worst possible moment (a real background event). `data.audioStatus`
    // (already on the GET /api/videos/:id payload -- see server.js) seeds the
    // load-time snapshot for the common case where a PRIOR watch of this
    // item already extracted it, but is NEVER trusted on its own past this
    // point (see F1 below) -- it's just what `attemptBackgroundAudioHandoff`
    // falls back on if the prepare-audio round trip below never resolves in
    // time. Desktop and audio-type items never even reach this fetch --
    // completely unaffected, matching the feature's video+mobile-only scope.
    bgAudioSettingCached = false;
    bgAudioStatusKnown = (data && data.audioStatus) || null;
    if (data.type !== 'audio' && isMobileFormFactor() && bgAudioEl) {
      // F3b (two-reviewer follow-up): does NOT pre-set the real `/audio/:id`
      // src here anymore -- that used to mean EVERY mobile video load
      // pointed `bgAudioEl` at the real network URL regardless of the
      // setting, and `primeBackgroundAudioElement`'s gesture-prime played
      // THAT (a real request, possibly enqueuing a real FFmpeg extraction)
      // even on a disabled install. The real src is now assigned in exactly
      // ONE place -- `armBackgroundAudioSrc` (v1.35) -- which is itself
      // gated on the setting being on; priming instead uses a LOCAL silent
      // clip (`SILENT_PRIME_SRC`, see `primeBackgroundAudioElement`'s own
      // comment) with zero network cost.
      // F7 (comment-only, two-reviewer gate): a deliberate tradeoff -- this
      // fires a fresh GET /api/settings on EVERY mobile video load rather
      // than riding the existing GET /api/videos payload (which already
      // carries per-item fields like `audioStatus`). Simplest-correct for an
      // EXPERIMENTAL, off-by-default feature: it fails SAFE (a slow/failed
      // fetch just leaves `bgAudioSettingCached` false, so the feature stays
      // off for that load -- see the `.catch` below), and keeps this whole
      // feature's settings-read isolated from `/api/videos`'s response
      // shape rather than growing it. Revisit (fold `backgroundAudioForVideo`
      // into the `/api/videos` payload instead, saving a round trip per
      // load) if this extra fetch ever shows up as a real cost once the
      // feature graduates out of EXPERIMENTAL.
      fetch('/api/settings')
        .then(function (res) { return res.ok ? res.json() : null; })
        .then(function (settings) {
          if (gen !== loadGeneration) return; // a newer load has since started
          bgAudioSettingCached = !!(settings && settings.backgroundAudioForVideo);
          // v1.34 T4: second flag off the same fetch -- then re-derive the
          // controls surface now that the setting is known (applyControlsMode
          // is idempotent and cheap; a no-change re-run is a no-op).
          mobileCustomPlayerCached = !!(settings && settings.mobileCustomPlayer);
          preExtractAudioCached = !!(settings && settings.preExtractAudio); // v1.35 gate fix: the eager-buffer lever
          applyControlsMode();
          if (!bgAudioSettingCached) {
            // v1.27.2 (diagnostics): the arm line now records on EVERY
            // mobile video load, both ways -- Dean's first overlay reading
            // had NO arm line at all, and we couldn't tell "setting resolved
            // off" from "the debug flag was enabled after this load" from
            // "the fetch never resolved". One unambiguous line settles it.
            recordLifecycleEvent('bgAudio:arm', { detail: 'setting-off' });
            return;
          }
          // F1 (two-reviewer gate): NO LONGER short-circuits when
          // bgAudioStatusKnown's cached value already looks "ready". That
          // cached value can be STALE
          // -- the sidecar it describes may since have been evicted/aged out
          // of the transcode cache (server.js's evictTranscodeCache/
          // sweepAgedTranscodes delete the `.m4a` file independently of
          // whatever this in-memory snapshot still believes) -- and trusting
          // it here meant the FIRST real background handoff after eviction
          // would 503 with nothing to hand off to, silently pausing instead.
          // prepare-audio is an idempotent, cheap disk-existence check (a
          // no-op 200 `{ audioStatus: 'ready' }` when truly still ready --
          // see that route's own comment) that ALSO self-heals the server's
          // persisted status when it finds the sidecar missing -- so it is
          // always fired now, and its FRESH response is the only thing this
          // controller ever trusts as `bgAudioStatusKnown` from this point
          // on (never left at the load-time snapshot on a successful
          // response, even if the response omits the field).
          return fetch('/api/videos/' + encodeURIComponent(id) + '/prepare-audio', { method: 'POST' })
            .then(function (res) { return res.ok ? res.json() : null; })
            .then(function (body) {
              if (gen !== loadGeneration) return;
              // F6 (two-reviewer gate, v1.27.1 post-release): a non-ok
              // response (`body === null`) must NOT leave `bgAudioStatusKnown`
              // standing at the load-time snapshot (`data.audioStatus`,
              // possibly stale -- see F1 above) -- that snapshot can describe
              // a sidecar that's since been evicted, so silently trusting it
              // here would let `shouldHandOffToBackgroundAudio` treat a
              // now-nonexistent 'ready' as still eligible. Explicitly reset
              // to UNKNOWN (`null`) instead, so the shared gate's
              // `audioStatus !== 'ready'` check fails safe. The repoll just
              // below still gets a fresh chance to resolve it on the NEXT
              // poll -- and if THAT fetch also comes back non-ok,
              // `scheduleAudioStatusRepoll`'s own `!body` guard already ends
              // the chain there, so nothing further is needed here.
              bgAudioStatusKnown = body ? (body.audioStatus || null) : null;
              // v1.35 T1: declare a PLAYBACK audio session (Safari 16.4+)
              // the moment the setting resolves ON -- tells iOS this app's
              // media should continue in the background (and play through
              // the silent switch, Dean-approved) -- the closest a web app
              // gets to a native audio app's background entitlement.
              // (Deliberately one-way for the page lifetime: turning the
              // setting OFF mid-session leaves the declaration standing
              // until the next reload -- harmless, and reverting live would
              // risk yanking an active session out from under playback.)
              try {
                if (navigator.audioSession && navigator.audioSession.type !== 'playback') {
                  navigator.audioSession.type = 'playback';
                }
              } catch (_) { /* API absent/locked -- fine */ }
              // v1.35 T2: sidecar already ready -> pre-arm NOW, so the
              // eventual background handoff is a bare play().
              armBackgroundAudioSrc();
              // v1.27.1 (diagnostics): recorded once per load, only when the
              // setting actually resolved ON -- shows on the overlay whether
              // the feature was even ARMED for this item, and what the
              // sidecar's fresh status was at load time (the value
              // `attemptBackgroundAudioHandoff` will actually gate on later).
              recordLifecycleEvent('bgAudio:arm', { detail: 'status=' + (bgAudioStatusKnown || 'none') });
              // F-C (v1.27.1, first-watch handoff fix): a single prepare-audio
              // POST at load time made a NOT-YET-extracted sidecar
              // structurally unable to ever become usable THIS session --
              // nothing ever looked again, even though the extraction this
              // very request just enqueued (see queueAudioExtract, server.js)
              // typically finishes within a few seconds. Kick off a bounded
              // re-poll of the SAME idempotent endpoint so a first-watch
              // handoff isn't permanently impossible.
              if (bgAudioStatusKnown !== 'ready' && bgAudioStatusKnown !== 'failed') {
                scheduleAudioStatusRepoll(id, gen, BG_AUDIO_STATUS_REPOLL_MAX_ATTEMPTS);
              }
            });
        })
        .catch(function () {
          // F6 (two-reviewer gate, v1.27.1 post-release): a fetch-level
          // failure (network error, not merely a non-ok status -- that path
          // is handled above) of the settings or prepare-audio request must
          // not leave a stale bgAudioStatusKnown behind either, for the same
          // "unknown -> fail safe" reasoning as the non-ok branch above.
          // Guarded on `gen` so a failure surfacing after this load has
          // already been superseded can never stomp the CURRENT item's own
          // (possibly already-fresh) status.
          if (gen === loadGeneration) {
            bgAudioStatusKnown = null;
            // v1.27.2 (diagnostics): even an outright fetch failure leaves
            // an arm line, completing the "one line per load, always" rule.
            recordLifecycleEvent('bgAudio:arm', { detail: 'setting-unknown-fetch-failed' });
          }
        });
    }

    // A6 (T16, v1.24 UX Round, Wave 5): CC button + <track> setup. AVAILABILITY
    // (`data.hasSubtitles`, from db.metadata[id] via GET /api/videos/:id) is
    // the ONLY gate -- never a second/divergent mobile-detection signal, per
    // the exec plan's A6 design. `ccTrack.src` is set fresh for every load
    // (never left stale from the previous item, even when hasSubtitles is
    // false -- an inert/never-fetched <track> costs nothing) so a load that
    // starts without a track element listed can still resolve one if the
    // markup itself is present; the actual captions request only ever fires
    // if/when the browser decides to load the track (Cue text is not
    // fetched merely because `src` is set unless the track is in a mode
    // other than 'disabled' or the user later shows it via #cc-btn).
    if (ccTrack) ccTrack.src = '/api/subtitles/' + id;
    // v1.34 T3: the resolved chapter list rides GET /api/videos/:id; the
    // picker rebuilds per load (and hides on teardown).
    applyChaptersForMedia(data);
    if (ccBtn) ccBtn.style.display = data && data.hasSubtitles ? '' : 'none';

    // Feature A (v1.26.1, Shorts player-size jump): reserve the box's REAL
    // aspect-ratio, from server-known `data.width`/`data.height` (GET
    // /api/videos/:id), BEFORE `src` is assigned below -- so the box is
    // sized correctly on the very first paint, rather than jumping ~1s
    // later once the browser decodes the video's own intrinsic dimensions.
    // Audio is deliberately untouched (teardownMediaState() already cleared
    // `--media-aspect` back to the CSS 16:9 default for it, and stays
    // cleared here). A legacy item with no stored dims yet simply clears
    // right back to that same 16:9 default (`applyMediaAspect` degrades
    // safely on missing/invalid input) -- the `loadedmetadata` fallback
    // listener (below) settles it as soon as the real dims are known, and
    // lazily backfills them server-side for next time.
    if (data.type !== 'audio') applyMediaAspect(data.width, data.height);

    // Feature A (v1.26.1)'s no-data fallback + lazy per-item dimensions
    // backfill, PLUS F2's same-session orientation self-heal (both
    // two-reviewer follow-ups). Wired FRESH on every real load (`{ once:
    // true }`), closing over THIS load's own `id`/`data`/`gen` -- was
    // previously wired ONCE in wireHostListeners, reading `currentData`/
    // `currentId` LIVE on every fire. F4: that live read was a race -- a
    // fast prev/next could let THIS item's late 'loadedmetadata' resolve
    // AFTER a newer load() had already reassigned `currentId`/`currentData`
    // to a different item, POSTing (and visually applying) THIS item's
    // dimensions under the NEWER item's id. `gen` is captured here, at
    // listener-arm time, and re-checked live inside the callback -- same
    // loadGeneration pattern `pollTranscodeUntilReady` (above) already uses
    // for its own poll chain: if a newer load has since bumped
    // loadGeneration, this callback belongs to a now-superseded load and
    // bails before touching anything (the POST, and -- just as importantly
    // -- the `applyMediaAspect` call that would otherwise stomp the NEWER
    // item's already-correct aspect box with this stale one's dims).
    if (data.type !== 'audio') {
      mediaPlayer.addEventListener('loadedmetadata', function () {
        if (gen !== loadGeneration) return; // a newer load has since started -- this metadata belongs to a superseded item
        var vw = mediaPlayer.videoWidth;
        var vh = mediaPlayer.videoHeight;
        if (!vw || !vh) return;
        if (data.width && data.height) {
          // F2 (two-reviewer follow-up, "simpler option" -- see
          // mediaAspectOrientationMismatch's own comment for why): stored
          // dims are already present, so the endpoint's strict no-clobber
          // means POSTing here would always no-op -- skip the network call
          // entirely. But a rotation-flagged legacy item (probed before the
          // server-side rotation fix, server.js's parseFfprobeStreams) can
          // have ORIENTATION-WRONG stored dims; when the browser's real,
          // already rotation-corrected videoWidth/videoHeight disagree in
          // portrait-vs-landscape with what's stored, re-apply from the
          // browser's dims so at least THIS session's box is correct.
          if (mediaAspectOrientationMismatch(data.width, data.height, vw, vh)) {
            applyMediaAspect(vw, vh);
          }
          return;
        }
        applyMediaAspect(vw, vh); // one early settle instead of a late jump, for THIS play
        // Fire-and-forget: the SECOND play of this legacy item is jump-free
        // once this lands (setupForMedia will find data.width/height next
        // time via GET /api/videos/:id). Never blocks/affects playback
        // either way -- a failed/rejected POST is silently swallowed.
        fetch('/api/videos/' + encodeURIComponent(id) + '/dimensions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ width: vw, height: vh }),
        }).catch(function () {});
      }, { once: true });
    }

    if (data.type === 'audio') {
      mediaPlayer.style.display = 'block';
      // v1.38.0: a book-TTS item's id has no db.metadata thumbnail; use its
      // explicit artUrl (book cover) as the poster instead of a 404 /thumbnail.
      mediaPlayer.poster = (typeof data.artUrl === 'string' && data.artUrl) ? data.artUrl : ('/thumbnail/' + id);
      mediaPlayer.src = streamUrl;

      if (AUDIO_PLAYER_MODE === 'background') {
        // v1.38.0: an explicit artUrl (a book cover, /bookcover/:id) wins over
        // the media thumbnail-derived art -- else the existing behavior.
        var artUrl = (typeof data.artUrl === 'string' && data.artUrl) ? data.artUrl : resolveAudioArtUrl(data);
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
    applyControlsMode(); // re-toggles .ff-mobile AND re-derives native-vs-custom controls for this FULL transition (mobile video -> native; everything else -> custom -- native-controls round)
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
    // v1.24.5 FIX C: D3 (v1.24.0, T13) only suppresses the resume prompt in
    // favor of auto-resume when the dock state is ALREADY docked at the
    // moment handleResumePlayback's fetch resolves. If the prompt is already
    // showing (state was FULL then) and the user docks from there, it would
    // otherwise keep rendering the full-size prompt inside the tiny
    // 160/280px dock. Bring that case in line with D3's intent: dismiss the
    // showing prompt and resume directly, exactly as if D3 had fired.
    var resumeOverlayVisible = !!(resumeOverlay && resumeOverlay.style.display !== 'none');
    if (resolveDockTransitionResumeAction({ resumeOverlayVisible: resumeOverlayVisible }) === 'dismiss-and-auto-resume') {
      resumeOverlay.style.display = 'none';
      resumeDirectly(savedProgress);
    }
    exitAudioExpand(); // FR-1 (T1, v1.22.2, AC5): never dock a fixed-overlay expanded wrapper
    if (host.parentNode !== dockEl) dockEl.appendChild(host);
    dockEl.hidden = false;
    state = STATE_DOCKED;
    applyControlsMode(); // re-toggles .ff-mobile for this DOCKED transition and reverts to the custom bar (native controls are FULL-only -- native-controls round)
    if (wasPlaying && mediaPlayer.paused) mediaPlayer.play().catch(function () {});
  }

  function close() {
    loadGeneration++; // invalidate any in-flight poll/resume-check
    if (progressInterval) { clearInterval(progressInterval); progressInterval = null; }
    if (transcodePollTimer) { clearTimeout(transcodePollTimer); transcodePollTimer = null; }
    // F7 (two-reviewer NIT): cancel a still-pending audio-status repoll too, mirroring the two timers just above
    if (audioStatusRepollTimer) { clearTimeout(audioStatusRepollTimer); audioStatusRepollTimer = null; }
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
    // FIX D (player-hardening round, hygiene): clear the native-controls
    // marker + attribute here too, mirroring teardownMediaState()'s identical
    // clear above -- benign today (the next load()'s teardownMediaState()
    // already clears both before re-mount, and dock() early-returns from
    // CLOSED) but leaves nothing stale on the detached host.
    if (mediaPlayer) mediaPlayer.removeAttribute('controls');
    if (host) host.classList.remove('native-controls');
    // Feature A/B (v1.26.1) hygiene, mirroring FIX D just above: benign today
    // (the next load()'s teardownMediaState() already clears both before
    // re-mount, since close() always resets `currentId` to null, forcing a
    // genuine non-adopt load next time) but leaves nothing stale on the
    // detached host.
    applyMediaAspect(null, null);
    audioCaptionsOn = false;
    hideCaptionOverlay();
    if (mediaPlayer) {
      try {
        // F5 (two-reviewer gate, structural consistency, v1.27.1
        // post-release): routed through `pauseSuppressingHandoff` (not a
        // bare `mediaPlayer.pause()`) -- see `teardownMediaState`'s
        // identical comment above for why.
        pauseSuppressingHandoff(mediaPlayer);
        mediaPlayer.removeAttribute('src');
        mediaPlayer.load();
      } catch (_) { /* best-effort only */ }
    }
    // v1.27.0 (background-audio-for-video, EXPERIMENTAL): mirrors
    // teardownMediaState()'s identical reset -- reset the state machine and
    // stop+detach the hidden audio element here too, so a CLOSE (the dock's
    // [x]) can never leave it playing.
    bgAudioState = nextBackgroundAudioState(bgAudioState, 'TEARDOWN', {});
    bgAudioGesturePrimed = false;
    bgAudioSettingCached = false;
    bgAudioStatusKnown = null;
    prePauseCandidateAt = 0; // v1.27.2: mirrors teardownMediaState -- no candidate survives a CLOSE
    pendingAutoplayNextOnForeground = false; // F2: never let a deferred advance survive a CLOSE either
    if (bgAudioEl) {
      try { bgAudioEl.pause(); bgAudioEl.removeAttribute('src'); bgAudioEl.load(); } catch (_) { /* best-effort only */ }
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
