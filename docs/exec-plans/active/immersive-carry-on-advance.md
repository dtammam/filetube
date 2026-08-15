# Immersive carry-on-advance (v1.130.0)

Dean's report (2026-08-15): iOS, landscape, faux fullscreen, video advances
(autoplay `ended` or manual skip) -> the load teardown drops fullscreen and he
lands on the raw landscape page view he "never really gets to otherwise".
Ask: maintain fullscreen across playback continuations.

## Intake rulings (Dean, 2026-08-15)

1. ALL continuation paths carry: autoplay-ended, queue advance, manual
   Next AND Prev (track-nav buttons, lock-screen/MediaSession, Shift+N/P).
2. Cross-kind advances map to the NEW item's own immersive surface:
   video faux fullscreen <-> audio expanded now-playing (both are the
   custom player's own overlays).
3. Key on the IMMERSIVE STATE at advance time, never orientation.

## Root cause (read from code, not theorized)

- The persistent host's load teardown unconditionally runs
  `setCssFullscreen(false)` (v1.34.2 "never leak the fixed overlay across
  loads") and `exitAudioExpand()` (v1.22.2 AC5). Right for a fresh browse
  pick; wrong for a continuation.
- Nothing re-enters afterward: the v1.118 rotate machinery fires only on
  orientation CHANGE events, and an advance changes no orientation.

## Design

One-shot arm -> per-load capture -> teardown preserve -> post-setup reconcile.

- `immersiveCarryPending` (module bool): armed immediately before every
  continuation navigation/handler call inside player.js
  (`advanceIntoQueueEntry`, the context-advance navigate, `manualTrackStep`'s
  handler fallback, `handleAutoplayNext`'s trackNav fallback, the
  MediaSession prev/next wrappers, the Shift+N/P shortcuts). Page-level
  watch Prev/Next buttons sit UNDER the fixed overlays and are unreachable
  while immersive - deliberately not armed.
- `captureImmersiveCarryForLoad(pending, liveKind)` (PURE, exported):
  mirrors `captureAutoplayAdvanceForLoad`'s leak-proof one-shot pattern.
  Returns `{ value, nextPending: false }` where value = the live immersive
  kind ('video' | 'audio') only when both the arm AND a live immersive
  class are present at load start. A stale arm after a manual fullscreen
  exit is inert; an un-armed load with a (leaked) immersive class still
  drops it - the v1.34.2 belt survives.
- `currentImmersiveKind()` (impure, host classes): 'video' (.css-fullscreen)
  | 'audio' (.audio-expanded) | null. Desktop NATIVE fullscreen is classless
  and out of scope (reparenting the host into the next view's slot exits
  native fullscreen at the browser level; re-entry needs a user gesture).
- `teardownMediaState({ preserveImmersive })`: when set, skip the
  `setCssFullscreen(false)` + `exitAudioExpand()` drops so the overlay
  never flashes off mid-transition. Every other caller (close/dock paths)
  passes nothing -> behavior byte-identical. `cssFsSavedScrollY = null`
  stays unconditional (the next page's scroll is a fresh world).
- `resolveImmersiveCarryTarget(carriedKind, newType)` (PURE, exported):
  null without a carry; 'audio-expanded' when the new item is audio;
  'video-fs' otherwise. Reconcile runs in `load()` AFTER `setupForMedia`
  (new type known), only when `!options.dock` (a dock destination must
  drop immersive as today - guard at the teardown call too).
  Re-calling the setter for an already-on class is a harmless toggle
  no-op whose `revealControlsAndReArm()` re-arms the v1.119 auto-hide
  cycle for the new item.

## Test plan (test/unit/player-immersive-carry.test.js)

- Pure: capture one-shot semantics (armed+live -> kind; stale arm -> null;
  un-armed -> null; nextPending always false), resolve mapping table
  (video/audio x carried kinds + null).
- Source locks (house pattern - no jsdom player harness; scoped regexes):
  load() captures before teardown and passes the preserve flag; teardown's
  drops are gated on it; each arm site contains the arm statement.
- The v1.34.2 lock is regression-bound: un-armed capture returns null
  (pure) + teardown's ungated default path still present (source).

## Out of scope (disclosed)

- Desktop NATIVE fullscreen across advances (gesture-gated by browsers).
- Auto-entering fullscreen when a FRESH pick starts while landscape
  (Dean did not ask; behavior change beyond the report).

## Gate

Slim gate (adversarial seat) - no data-loss surface. Named attack surfaces:
the v1.34.2 leak class (can a carried/stale flag put a NON-continuation
load into fullscreen?), the dock-destination advance (stuck overlay?),
cross-kind class pairing (.audio-expanded without .audio-mode), auto-hide
re-arm, close()/dock() unchanged-ness, source-lock divergent spellings.
