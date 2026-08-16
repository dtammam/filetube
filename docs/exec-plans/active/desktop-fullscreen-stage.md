# Desktop fullscreen stage (v1.138.0)

Dean (2026-08-16): on desktop (Chromium-class), a fullscreen video's
advance (autoplay or Next) lands the next video NOT fullscreen - "I want
that to also still be in full screen... just like it behaves in iOS."
This is v1.130's disclosed desktop gap, now remediated for real.

## Root cause (read from code)

Desktop fullscreen is the NATIVE Fullscreen API on the HOST
(`enterFullscreen()`, player.js ~5285: `target = host; requestFullscreen`).
Every navigation reparents the host (`applyPlayerTransition` -> `dock()`
on leaving watch/read/music; then the new view's `load()` ->
`mountInSlot`). Moving a fullscreen element in the DOM force-exits
fullscreen, and programmatic re-entry needs a user gesture autoplay
advances don't have.

## Design: fullscreen an element that NEVER moves

- **`#fs-stage`**: one empty fixed shell-level container per shell,
  sibling of `#player-dock`, OUTSIDE `#view-root` (machine-derived: 8
  shells carry `#player-dock` today; each gains the stage).
- **Enter (desktop only)**: `enterFullscreen()`'s Fullscreen-API branch
  reparents the host INTO the stage (children of a fullscreen element may
  move freely - the stage itself never does), then
  `stage.requestFullscreen()`. Mobile webkitEnterFullscreen branch
  untouched.
- **While staged**: `stagedFullscreen` flag. (a) `dock()` no-ops (the
  router's `applyPlayerTransition` dock on view change must not yank the
  host - `shouldDockOnTransition` stays PURE, the stateful guard joins
  dock()'s existing stateful guards); (b) `load()`'s mount target becomes
  the stage (`resolveFullscreenMountTarget(staged, dockOpt, slot)`, pure)
  - state stays FULL, setup/teardown/carry machinery byte-unchanged.
- **Exit** (`fullscreenchange` with empty fullscreenElement while
  staged): clear the flag, place the host via
  `resolveStageExitPlacement(currentViewHasSlot)` (pure) - the CURRENT
  view's `#player-slot` if it exists (watch/read/music), else `dock()`.
  The v1.68 scroll keeper's native-exit path runs as today.
- **Predicate fix**: `inImmersiveMode()`'s native check is
  `host.contains(fullscreenElement)` - with the stage fullscreen the
  element is the host's PARENT and the predicate goes blind (killing the
  v1.124 auto-hide in staged fullscreen). Becomes
  `host.contains(el) || el.contains(host)`.
- **CSS**: `#fs-stage` is display:none when not in use; `:fullscreen`
  rules that key on the host being the fullscreen element are respelled
  to cover the staged shape (grep `:fullscreen` in style.css; census
  stays 0).
- **Rider (v1.137 gate S4)**: the stale "domain coupling" phrase in the
  v1.136.1 player.js comment is corrected in this wave.

## Explicitly unchanged

Mobile faux fullscreen + the v1.118 intercept; the v1.130 immersive carry
(classless native never armed it - staged fullscreen persists by
construction, no carry needed); audio-expanded; the dock's own chrome;
adopt loads.

## Predictions (tool-verified at every commit)

- 8 shells gain `#fs-stage` (one line each).
- `requestFullscreen(` call sites in player.js: 1 before and after (the
  enterFullscreen branch; the count is the one-writer lock).
- No new `:fullscreen` census violations (lint:css TOTAL 0).

## Test plan

- Pure: `resolveFullscreenMountTarget` table (staged x dock x slot);
  `resolveStageExitPlacement` table.
- Source locks: stage reparent BEFORE requestFullscreen (order matters -
  reparenting after would exit what we just entered); dock()'s staged
  no-op guard; the load() mount-target seam; the exit handler's
  place-then-clear ordering; the widened inImmersiveMode predicate; every
  shell carries `#fs-stage` (the every-shell census pattern).
- Respells expected: locks binding `requestFullscreen()` on host and the
  v1.124 fullscreenElement predicate (player-audio-expand,
  player-fullscreen-autohide).

## Gate

FULL two-seat gate (QA + adversarial) - this reaches the battle-won
FULL/DOCKED/CLOSED reparenting machinery. Named attack surfaces: the
stage-exit placement on slot-less views (home) incl. CLOSED state; a
staged load()'s teardown interplay (does anything in teardown assume the
host is in a view slot?); double-enter (fs-btn while staged); Esc during
a mid-advance load; the keeper scroll on exit-after-navigation (the saved
scroll belongs to a DEPARTED page); docked->staged transitions; the
webkitbeginfullscreen intercept on iPads (desktop-class + touch);
:fullscreen CSS respell blast radius across eras; state-machine
consistency (getState() while staged).

Status: IN PROGRESS
