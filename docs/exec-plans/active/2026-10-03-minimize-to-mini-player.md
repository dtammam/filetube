---
plan: minimize-to-mini-player
harness: v2 · lean
branch: feat/v1.362-minimize
anchor: spec
status: Building
next: W1 (the pull-down, the one commit path, the browse-level landing per M7, the ?minimizeAnim switch); W0 measured (section 6), M7 + M8 ruled by Dean 2026-10-03
design: Dean 2026-10-03 - on a phone, shrink the playing video into the mini player without leaving the page by hand - a down-chevron at the picture's top-left and a pull-down on the picture that follows the finger - plus bigger mini player X and play/pause ("a lot of friction now, especially in a mobile viewport"). The end state equals leaving the watch page ("equivalent to pressing the home button"). AskUserQuestion 2026-10-03, every default taken (section 2).
gate: adversary + qa (touch gestures on the shared player core beside v1.358's hold-lock, a reparent during a gesture, the SPA back path, a transform on the playing picture; security-brief applied as a section by both)
---

# v1.362: minimize the phone player into the mini player (chevron + pull-down), bigger mini player targets

Kickoff 2026-10-03 by the Architect (Opus) at main c85a20c7. ROADMAP Planned > Features "Swipe the playing video down to
shrink it into the mini player" is the WHAT; this plan is the HOW. Client only (`public/js/player.js`, `public/js/common.js`,
`public/css/style.css`), no server, no storage, no new dependency, no shell (`*.html`) edit.

## 1. The outcome (what Dean will do on device)

Phone (portrait, width up to 768 px), Settings > Mobile player > "Use custom player controls on touch devices" ON, a video
playing inline on the watch page:

1. A small down-chevron sits on the picture's top-left on a plain dark disc. Tap it: the picture settles into the mini player
   (bottom-right) and the page goes where the Home button would take it (back one level to the feed / channel / search with its
   scroll, or Home if the video was opened directly). Playback never stops.
2. Instead, put a finger on the picture and pull DOWN: the picture follows the finger, shrinking toward the mini player's corner.
   Let go past about a third of the way (or flick down): it settles into the mini player, same end state as 1. Let go early:
   it springs back, playback untouched.
3. The mini player's X and play/pause are easy to hit: each answers a 44 x 44 px touch, and both look a little bigger.
4. Unchanged: a tap pauses, a double-tap skips 15 s, a hold is 2x and a hold-then-drag-down LOCKS 2x (v1.358), swipe right goes
   back, an UPWARD drag on the picture scrolls the page, full screen and landscape behave exactly as today, desktop and iPad as
   today.

## 0. Step 0 - read, set up, and the stop rules

0.1 Read `AGENTS.md`, then `docs/LESSONS.md` sections **0, 1, 2, 4, 5, 6, 7, 8, 12, 13**, then
`docs/exec-plans/completed/2026-10-02-hold-lock.md` sections 3 and 6 (the W0 measurements: which touchmove listener is
cancelable, on which element) and `docs/exec-plans/completed/2026-10-03-tap-glyph-filter.md` (the iOS 27 black picture).
Read this plan fully before editing.

0.2 Environment, every shell: `export PATH="$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH"`.
Dual-Node for the final suite: 22.23.1 and 24.20.0 (Node 24 prints `ℹ`, not `#`; an empty grep is not green).

0.3 Worktree: `.claude/worktrees/v1362` on branch `feat/v1.362-minimize` (it exists and carries this plan). `git rebase main`
first (a no-op unless main moved). `ln -s /home/coder/projects/filetube/node_modules node_modules` before any commit; it stays
untracked, never staged; `rm node_modules` before the worktree is removed.

0.4 Git: stage files BY NAME; `git commit -F <file>` (message via a QUOTED heredoc, `<<'EOF'`); never `--no-verify`, never
force-push, never pipe a commit or push; verify with `git log`. The pre-commit hook runs the unit suite (~3-5 min): run commits
in the background and wait. Push only in the release step. Commit trailers: the ones your session's system reminder gives you.

0.5 Tests while building: the targeted files each wave names. Full dual-Node `npm test` once after W2, again only if a gate
round changes code, never while a gate seat is running.

0.6 Report every failure verbatim with counts. "Verified" means you ran it and saw it. Mutants only on COMMITTED work, in a
/tmp `git archive <sha>` sandbox, exact-once replace, restored in a `finally`, sandbox diffed against a pristine copy after;
kill anything you start BY PID (never `pkill -f`). Record every mutant in section 6. Probes run in the sandbox or against a
throwaway server, never by editing the worktree.

0.7 No em dashes anywhere. UI through tokens (`--size-touch`, `--dur-*`, `--scrim-*`, `--on-overlay`); `npm run lint:ui` must
not grow; `node scripts/overlay-containment-lint.js --enforce` stays 0. A comment, test title or doc your change inverts is a
finding: grep for it (the `#player-dock` CSS header comment "the watch page is never docked while it is the active view" at
style.css ~1282 becomes FALSE for the instant between dock() and the route swap: rewrite it; the `.player-dock-close` and
`#player-dock .pc-btn` blocks; `applyPlayerTransition`'s comment in common.js ~11052 if the order changes; `goHomeFromPlayer`'s).

0.8 **Stop rules.** Stop and report (never guess) if: (a) a seam in section 4 does not exist or behaves differently and the fix is
not a like-for-like rename; (b) W0 shows the downward drag on the picture cannot be made cancelable in Chromium inline at
`scrollY` 0 (then the pull would rubber-band or scroll the page under the finger and the design needs Dean); (c) any change
alters a gesture listed in outcome item 4, measured, not argued; (d) the transform has to go on anything but `#player-wrapper`
(the host) or needs a `filter`, `mask`, `backdrop-filter`, `mix-blend-mode`, `opacity` below 1 or `will-change: filter` on or over
the picture (LESSONS 7); (e) a new npm dependency or a shell `*.html` edit; (f) scope grows: log extras in ROADMAP.md Planned.
A stop rule is never satisfied by narrowing a test.

## 2. Rulings

Dean answered M1-M6 on 2026-10-03 (two AskUserQuestion rounds, every default taken). The rest are Architect defaults; tighten
them in the build if the evidence says so, never loosen them.

| # | Question | Ruling |
|---|---|---|
| M1 | Is it worth building, given swipe-right already goes back and leaving docks (**Dean**) | Yes: the pull-down is the natural, discoverable motion; the chevron makes it visible. Swipe right is untouched. |
| M2 | Chevron (**Dean**) | Inline: always shown on the picture's top-left while M4 holds, a `expand_more` glyph (already in the sprite, `tools/icons/names.js`) on a plain dark disc, never hidden (the inline bar never hides either). Dean's "full screen fades" half is moot: M4 keeps full screen out, so no chevron there. |
| M3 | Drag feel (**Dean**) | Follows the finger: the host translates and scales toward the dock's rect as the finger moves; release commits or springs back (R2, R3). A runtime switch (R7) falls back to a plain threshold flick with NO moving picture if the device check shows the iOS black picture. |
| M4 | Surfaces (**Dean**) | Phone inline only. One predicate `minimizeAllowed()` (R1). Full screen, `.audio-expanded`, landscape-full-screen, the dock itself, native fullscreen/PiP, native-controls mode, iPad and desktop: unchanged. |
| M5 | Mini player targets (**Dean**) | On phones (max-width 768 px): X and play/pause each answer a 44 x 44 hit box (`--size-touch`), visible X about 32 px, visible play/pause glyph about 28 px. Mini player width (160 px) unchanged. Desktop dock unchanged. |
| M6 | Landing (**Dean**) | Like the Home button: `goHomeControl()` in common.js (~11504): back one in-app level (the router restores that view and its scroll) when `history.state.depth > 0`, else `navigate('/')`. |
| R1 | `minimizeAllowed()` | `state === STATE_FULL` AND the host's parent is a `#player-slot` AND not `.css-fullscreen`, not `.audio-expanded`, not `inNativeFullscreen()`, not `inNativeControlsMode()` AND `isMobileFormFactor()` AND `matchMedia('(max-width: 768px)')`. A phone in landscape is wider than 768 px on most models, so it falls out by width; where it does not, an inline landscape slot is allowed (full screen is excluded by the class checks above). Pure core `minimizeAllowedDecision({...flags})` exported and tested branch by branch; the DOM wrapper only gathers flags. W0 enumerates every view that mounts a `#player-slot` (watch, TV episode, podcasts, anything else) and the plan's section 6 lists them; all of them are in scope since the landing is generic. |
| R2 | The claim | Pure `minimizeDragDecision({dx, dy, scrollY, holdActive})` returns `'claim'` iff `!holdActive` AND `scrollY <= 1` AND `dy >= MIN_CLAIM_PX` (12, beside `MOVE_TOL`) AND `dy > Math.abs(dx) * 1.5` (the swipe-back dominance factor mirrored, so a claim and `swipeBackShouldClaim` are disjoint by construction; bind it pure-by-pure, as v1.358 bound `holdDragDecision`). Upward or sideways: never. A claim happens at most once per gesture and ends the tap: `tapGestureMoved = true`, `clearTimeout(holdTimer)`, no single-tap toggle, no double-tap pairing (`lastTapTime = 0`). |
| R2b | Page scrolled (`scrollY > 1`) | Scroll first, then minimize: a pull-down on the picture while the page is scrolled down scrolls the page as today; the NEXT pull at the top minimizes (the iOS sheet convention). Keeps today's scroll behaviour byte-identical below the top. Architect default; Dean can flip it to "always minimize" after the device pass. |
| R3 | Release | Pure `minimizeReleaseDecision({dy, travel, velocityPxPerMs})` returns `'dock'` iff `dy >= travel * 0.35` OR (`velocityPxPerMs >= 0.5` AND `dy >= MIN_CLAIM_PX * 2`), else `'snap'`. `travel` = the vertical distance from the host's top to the dock's top at the claim. Velocity from the last ~80 ms of moves. A `touchcancel` mid-claim is always `'snap'`. Named constants `MINIMIZE_COMMIT_FRAC`, `MINIMIZE_FLICK_V`. |
| R4 | The commit sequence (one path for chevron and drag) | `minimizeToDock(fromRect)`: (1) `recordLifecycleEvent('minimize', {detail: 'button'|'drag'})`; (2) `dock()` (it already resets transient UI, closes menus, reparents into `#player-dock`, keeps playing; `goHomeFromPlayer` common.js ~10896 is the precedent for dock-then-navigate); (3) FLIP: read the docked host rect, set the inverse transform from `fromRect` (no transition), force a style flush, then transition `transform` to none over `--dur-sheet` ease-out; (4) `goHomeControl()` (expose it on `window.FileTube` beside `returnToPlayerOrigin`). The router's own `applyPlayerTransition` dock() on the swap is then a no-op (state already DOCKED). A second chevron tap or a drag during the settle is ignored (`homeBackPending` already coalesces the back). Reduced motion (`prefers-reduced-motion: reduce`): steps 1, 2, 4 only. |
| R5 | During the drag | Inline `transform` on the host only: `translate(x, y) scale(s)` with `transform-origin: 0 0`, interpolated from the slot rect toward the dock's resting rect (computed from the dock's CSS: right 8 px + scroll-lock gap, bottom `--mobile-bottom-nav-h` + 8 px, width 160 px, 16:9 plus the 26 px bar or its M5 replacement) by `p = clamp(dy / travel, 0, 1)`, top edge under the finger. The rest of the page does not move or fade (no opacity anywhere, stop rule d). Snap: transition `transform` to none over `--dur-fade`. The inline transform is cleared on EVERY end path (snap end, commit end, close(), a new load, pagehide) - one remover, `clearMinimizeDrag()`, called from `resetTransientPlaybackUi()`. |
| R6 | Chevron mechanics | Built at runtime in player.js (like `dockCloseBtn`), appended to the host, so no shell edit and the no-filter census covers it automatically (it enumerates classes player.js builds). `<button type="button" class="player-minimize-btn" aria-label="Minimize player">` with the sprite `<svg class="ui-icon"><use href="#i-expand_more"/></svg>`. Shown only while `minimizeAllowed()`, re-evaluated wherever `applyControlsMode()` runs and on resize/orientationchange. Visible disc about 36 px, hit box 44 x 44, top-left inset `--space-2` plus the safe-area left inset, z above the video and the tap glyph, below the resume toast and transcode overlay. Its `click` calls `stopPropagation` (the dock-close precedent) and `minimizeToDock(host rect)`; its touchstart must not reach the picture's gesture layer (it is a sibling of the video, so it does not; prove it with a test). Background: plain paint only (`--scrim-legacy` or `--scrim-heavy`), never a filter or blur. |
| R7 | The device A/B switch (M3's fallback, zero rebuild) | `?minimizeAnim=0` on the URL (read once at boot like `?debugLifecycle=1`, then remembered for the tab in `sessionStorage`; `?minimizeAnim=1` clears it) turns R5's live transform and R4's FLIP off: the drag claims and commits exactly the same, but the picture does not move until it docks. Dean A/Bs the iOS black picture on the SAME build. Default on. |
| M7 | Landing when the level behind is another video (**Dean**, 2026-10-03, W0 stop rule (a)) | W0 measured that "back one level" from video B opened over video A lands on A's watch page, which loads A FULL and stops B. Ruling: land on the **last browse page** - walk back past every watch entry to the nearest non-watch entry (feed, channel, search, with its scroll), or a fresh Home when there is none (a deep link). Supersedes M6's mechanism: `goHomeControl` is left as it is; common.js gains the browse-level landing (each history entry records the depth of the nearest browse entry at or behind it). |
| M8 | Surfaces, after the census (**Dean**, 2026-10-03) | **Watch page only** (videos, TV episodes, audio files on `/watch.html`). Music and Podcasts answer Back in place (their `onPopState` collapses now-playing) and the reader would leave the book, so they keep their own controls, unchanged. R1 gains `body[data-view="watch"]`. |
| R8 | M5 mechanics | Measured, not assumed: the dock has `overflow: hidden`, so a hit box drawn past its edge is clipped from hit testing. Both boxes must lie INSIDE the dock. Phone only (`@media (max-width: 768px)`): the docked bar may grow from 26 px (the two `26px` reserve literals, style.css ~4093 and ~4365/4368, change together as one value, plus `#player-dock .pc-btn`); the X may grow its box into the picture's top-right corner. Desktop dock byte-identical. Lock each rule by value and order (LESSONS 6: a rule that exists is not a rule that wins). |

## 3. Research to do first (W0 measures; nothing here is assumed)

1. **Hit boxes before.** In Chromium, iPhone 13 emulation, a docked video: `getBoundingClientRect()` of `.player-dock-close`
   and `#player-dock #pp-btn`, and `elementFromPoint` at a grid of points 2 px apart over a 60 x 60 area around each, counting
   the points that land on the button. The Architect's CSS reading (24 x 24 and 22 x 22) is NOT a measurement: record the
   instrument's numbers in section 6 and use them.
2. **Cancelable pull.** Inline, `scrollY` 0: a downward 150 px drag from the picture's centre. Does the existing non-passive
   host `touchmove` (player.js ~8050) see every move as `cancelable: true` from the first move? If the first moves (under 12 px)
   are not prevented, does the page start an overscroll / rubber-band that makes later moves non-cancelable? Record per move.
   If needed, the claim may `preventDefault` a vertical-dominant DOWNWARD move from its first pixel while `scrollY <= 1` (it
   cannot be a scroll at the top: there is nothing above), provided R2's disjointness with swipe-back still holds. Measure
   `scrollY > 1` too: R2b says the page scrolls exactly as today (same `scrollY` deltas as baseline main).
3. **The transform and its ancestors.** Does any ancestor of the host in the watch view clip it (`overflow`, `contain`) so a
   scaled host vanishes mid-drag? Does `transform` on the host change the containing block of anything `position: fixed` inside
   it (LESSONS 6: the speed sheet, menus, the resume toast)? Enumerate with a DOM sweep, list them in section 6.
4. **The `#player-slot` census** (R1): every view that mounts the host into a `#player-slot`.
5. **Reparent during a gesture.** The commit reparents the host on `touchend`. Confirm in Chromium that the video keeps
   playing (`paused === false`, `currentTime` advancing over 2 s after) and that no synthetic `click` from the same touch lands on
   the dock (it would expand the player straight back: the dock's own click handler navigates to the watch page). If one does,
   `preventDefault()` the claiming `touchend`.
6. **Leaving the watch view while already docked.** R4 docks BEFORE the route swap (the `goHomeFromPlayer` order). Read what the
   watch view's (and the TV / podcast slot views') un-render does with the player when it is left, and prove by a jsdom drive and
   the probe that it neither closes, re-expands nor pauses an already-docked host, for both the `history.back()` and the
   `navigate('/')` landings.

## 4. Seams (main c85a20c7; line numbers approximate)

- player.js `holdDragDecision` ~1089, `classifyTapGesture` ~1108 (top-level pure, exported for node:test).
- player.js `MOVE_TOL`, `LOCK_DRAG_PX` ~4815, `lockHold` ~4835, `engageHold` ~4851, `wireSkipHoldGestures` ~4933 (touchstart sets
  `startX/startY` and the hold timer; touchmove past `MOVE_TOL` sets `tapGestureMoved`; touchend classifies).
- player.js wiring ~8045-8053: `wireSkipHoldGestures(mediaPlayer, ...)`, `(audioBgArt, ...)`, the v1.358 host non-passive
  `touchmove` claim. The minimize claim joins THAT host listener (it is the one measured cancelable); it must not add a second
  non-passive listener anywhere else, never on `document` (LESSONS 4).
- player.js `applyControlsMode` ~2310-2340 (`native-controls` is added when mobile + video + FULL + custom controls off: the
  DEFAULT for a new device, so outcome 1-2 need the custom-controls setting, as v1.358's hold does; disclose in the release
  notes), `inImmersiveMode` ~2440, `isMobileFormFactor` ~2263, `inNativeControlsMode` ~2652.
- player.js `expand`/`mountInDock`/`ensureDockChrome`/`dock` ~9071-9190 (`dockCloseBtn` ~9101; the dock's click-to-expand
  ~9111); `resetTransientPlaybackUi` (called by dock, close, teardown, background).
- common.js `goHomeControl` ~11504 (and `homeBackPending`), `goHomeFromPlayer` ~10896, `applyPlayerTransition` ~11078,
  `swipeBackShouldClaim` ~10426, the exports block ~11724.
- style.css `#player-dock` ~1292, `.player-dock-close` ~1346, the phone `#player-dock` block ~1370, `#player-dock .player-controls`
  / `.pc-btn` ~4093-4111, `#player-dock #player-wrapper` reserve ~4365-4369.
- `test/unit/player-overlay-no-filter.test.js` (the LESSONS 7 census; the chevron must be inside its net, prove it by a mutant
  that adds `filter: drop-shadow(...)` to `.player-minimize-btn` and goes red).

## 5. Waves

**W0 - measure (section 3), write the falsifiers.** Probe under `tools/minimize-proof/` (the hold-lock-proof pattern). Red unit
tests for R1, R2, R3 pure decisions, and the disjointness binds: for every input R2 claims, `swipeBackShouldClaim` is false and
`holdDragDecision` is irrelevant because `holdActive` is false; for every input with `holdActive`, R2 never claims. Record all
of section 3 in section 6.

**W1 - the pull-down and the commit path.** `minimizeAllowedDecision`, `minimizeDragDecision`, `minimizeReleaseDecision`
(top-level pure, exported); the claim inside the host's touchmove; release in the surface touchend (before the tap classifier,
returning early like the hold branch); `minimizeToDock` (R4) + `clearMinimizeDrag` (R5) + the R7 switch; `goHomeControl` on
`window.FileTube`; lifecycle events. Tests: jsdom drives of the real wiring (touchstart/move/end on the real `#media-player`
and `#audio-bg-art` inside a real host in a `#player-slot`), asserting: a pull at the top past the threshold calls dock then
goHomeControl once, in that order; a short pull snaps back with no dock and no play/pause; a hold then drag still LOCKS 2x and
never minimizes; a tap still toggles; a double-tap still skips; `scrollY > 1` never claims; full screen, audio-expanded,
native-controls and a desktop form factor never claim; the inline transform is gone after snap, commit, close and a new load.
Mutants: drop `!holdActive`, drop the `scrollY` guard, flip the dominance factor, drop the `clearMinimizeDrag` call in
`resetTransientPlaybackUi`, swap dock/goHome order; each red by name.

**W2 - the chevron and the mini player targets.** R6 and R8. Tests: the button exists only while `minimizeAllowed()` (and
leaves on full screen, dock, close, a resize past 768 px); its click runs the SAME `minimizeToDock` (spy on the one function);
the no-filter census sees it (mutant above); CSS locks for M5 by value and order; the probe re-measures section 3 item 1 AFTER
and reports both tables: each box at least 44 x 44 by `elementFromPoint` count, inside the dock, and the dock's tap-to-expand
still answers at the picture's centre. `npm run lint:ui` no growth; containment lint 0. Then the full dual-Node `npm test`.

**W3 - look, then gate.** Headless iPhone-13 screenshots of: inline with the chevron (light and dark, every era skin the watch
page renders), mid-drag at p 0.3 and 0.7, the docked result, the mini player before/after with the hit boxes outlined (an
overlay drawn only in the screenshot script). Send them to Dean side by side (SendUserFile) before the gate (memory norm: a
LOOK is shown, not described). Then the gate: adversary + qa, briefed with section 8.

## 6. Build log (the builder fills this in: W0 measurements, deviations, mutants per wave, suite results verbatim)

**W0 measurements (builder, Sonnet session on Opus 5.5, 2026-10-03, `tools/minimize-proof/probe-w0.js` on main's product code
at 25e277e0: the real server on a throwaway DATA_DIR, Chromium with iPhone 13 emulation (390 x 664) + touch, raw CDP touch, the
custom-controls setting forced on; proof JSON `tools/minimize-proof/probe-w0-result.json`).** Chromium only; WebKit is Dean's device
check.

- **Item 1, hit boxes BEFORE** (docked on `/` after leaving the watch page; 31 x 31 points 2 px apart, 961 per button): dock rect
  x 222 y 468 w 160 h 116. `.player-dock-close` rect 24 x 24, **121 of 961** points hit it, hit span 24 x 24. `#player-dock #pp-btn`
  rect 22 x 22, **105 of 961** points, hit span 22 x 22. The dock's tap-to-expand at the picture's centre hits `media-player`.
  The Architect's reading (24 and 22) matches the instrument.
- **Item 2, the pull is cancelable** (15 moves of 10 px down from the picture's centre; Chromium eats the first as touch slop, so
  14 arrive; per move `cancelable,defaultPrevented,clientY,scrollY` read by a window bubble listener):
  - scrollY 0, no claim (today): **1 of 14 cancelable**, 0 prevented, scrollY 0 -> 0. Only the first move is cancelable: an
    unclaimed first move commits the gesture to the browser, so the claim must prevent from the FIRST delivered move.
  - scrollY 0, a host listener preventing a downward vertical-dominant move once dy >= 12: **14 of 14 cancelable, 14 prevented**.
  - scrollY 0, preventing from the first pixel: **14 of 14 cancelable, 14 prevented** (identical here, because Chromium's first
    delivered move is already past the slop at dy 20; iOS delivers finer moves, so W1 prevents from the first downward-dominant
    pixel at the top: the `'guard'` arm of `minimizeDragDecision`).
  - scrollY 40, no claim: 1 of 12 cancelable, scrollY 40 -> 0 (the page scrolls). scrollY 40 with the from-first-pixel claim
    gated on scrollY <= 1: identical (1 of 12, 40 -> 0): R2b keeps the scroll byte-identical. **Found:** mid-drag the page
    reaches scrollY 0 (move 4), so a claim keyed on the LIVE scrollY would minimize on the same pull. R2b ("the NEXT pull at the
    top") needs the scrollY read at TOUCHSTART; W1 passes that.
  - Stop rule (b) is not triggered.
- **Item 3, the transform and its ancestors** (watch view, inline): `#player-wrapper` overflow hidden, position relative;
  `#player-slot` nothing; `.watch-player-stage` overflow-x **clip**, position relative, **z-index 0** (a stacking context);
  `.watch-main`, `.watch-container`, `#view-root`, `main`, `.app-container`, `body` nothing; `html` overflow-x clip. Nothing
  clips vertically, and the dock's rect (x 222..382) lies inside the 390 px stage, so a scaled host does not vanish mid-drag.
  The stage's z 0 context means a later POSITIONED sibling below the player could paint over the moving picture: W3's mid-drag
  screenshots check it. Fixed descendants of the host inline: **none** (the speed sheet is body-level), so the drag transform
  changes no fixed element's containing block.
- **Item 4, the `#player-slot` census:** `watch.html` (videos, TV episodes via `?tv=`, audio files; view `watch`), `music.html`
  (now-playing), `podcasts.html` (now-playing), `read.html` (book narration). Music and Podcasts register `onPopState` (in-view
  pops). In scope after M8: watch only.
- **Item 5, reparent during the gesture** (a window touchend listener calls `player.dock()`): a 150 px drag: docked, playing,
  currentTime 3.5 -> 5.5 over 2 s, **0 clicks**. A 3-move flick (14 px steps, 10 ms): docked, playing, 2.6 -> 4.6, 0 clicks. A
  plain tap (control): the tap's own pause ran, 0 clicks. No synthetic click reaches the dock after a moved touch, so the
  claiming touchend needs no extra click guard (W1 still `preventDefault`s it, as the hold branch does).
- **Item 6, leaving the watch view while already docked:** Home -> watch(clip1), `dock()` then `history.back()`: on `/`, docked,
  playing (3.5 -> 5.5). Deep link `watch.html?v=clip1` (depth 0), `dock()` then `navigate('/')`: on `/`, docked, playing (4.1 ->
  6.2). **Home -> watch(clip2) -> watch(clip1), `dock()` then `history.back()`: lands on `/watch.html?v=clip2`, state `full`, src
  clip2, clip1 GONE.** Stop rule (a) triggered (the seam behaves differently from the outcome): asked Dean, ruled M7 (last
  browse page) and M8 (watch page only), section 2.
- **Failing-first (verbatim, `node --test test/unit/minimize-player.test.js` before any product code):** `# tests 20 / # pass 5 /
  # fail 15`. The 5 passes are the regression guards that hold on main too (a touchcancel, hold-then-drag locks, upward/sideways
  never claimed, scrolled never claimed, the excluded surfaces); the 15 fails are every pure decision (not exported) and every
  pull/commit/flag drive. Two of the 15 were TEST bugs found while greening (the double-tap pair needed a real `Date.now` gap and
  a `duration`, as hold-lock's does); fixed in the test, not the code.

**W1 (builder, 2026-10-03).**

- Built: `minimizeAllowedDecision` / `minimizeDragDecision` / `minimizeReleaseDecision` / `minimizeDragTransform` (top-level pure,
  exported); the claim in the v1.358 host `touchmove` (the same listener, now `hold arm, return; else minimizeTouchMove`); the
  release in the surface `touchend` before the hold branch; `minimizeToDock(source)` (lifecycle `minimize`, `dock()`, FLIP,
  `FileTube.leaveWatchForBrowse()`); `clearMinimizeDrag()` as the one remover, called from `resetTransientPlaybackUi()` and on a
  resize/orientationchange mid-pull; `?minimizeAnim=0|1` (sessionStorage `ft-minimize-anim`). common.js: `browseDepth` on every
  history entry (`buildHistoryState`, carried by `parseHistoryState`, the scroll rewrite, `pushViewState`, `replaceViewState` and
  navigate's fetch-path push), `browseDepthBehind`, `resolveMinimizeLanding`, `leaveWatchForBrowse` on `window.FileTube`.
- **Deviations / interpretations (disclosed):** (1) R2's `holdActive` is passed as `holdActive && holdGestureLive`: a hold engaged
  by THIS finger owns the drag, while a 2x LOCK left by an earlier gesture does not stop a later pull (v1.358 keys every hold
  branch on the engaging finger; a lock is meant to outlive it). A docked lock ends via `dock()`'s reset, as before. (2) R2b's
  `scrollY` is read at TOUCHSTART (W0 item 2). (3) A gesture that goes past 12 px up or sideways before any claim is dead for
  the rest of that touch (so a swipe-back that curls down never also minimizes). (4) M6's mechanism is replaced by M7's
  `leaveWatchForBrowse`; `goHomeControl` is untouched. (5) The FLIP needs `#player-dock.is-minimize-settle { overflow: visible;
  box-shadow: none }` for the settle (the dock clips its content): a class on the dock, no transform on it (stop rule d holds).
  (6) The dock's resting rect is read from the hidden dock's computed `right` / `bottom` / `width` plus `--size-touch` for the
  phone bar (measured in Chromium: `160px`, `8px`, `80px`, `44px`).
- Locks updated in place, intent kept (LESSONS 3): `hold-lock.test.js` "the drag claim is registered on the player wrapper"
  (the hold arm now returns before the minimize hand-off); `router-helpers.test.js` shape tests gain `browseDepth`, the
  push/replace/scroll-rewrite locks gain the sixth argument, the navigate builds regex accepts `desiredDepth,`.
- **Chromium end to end** (`tools/minimize-proof/probe-pull.js`, result JSON beside it, the branch's product code): home > clip1,
  pull 250: 24 of 24 moves cancelable and prevented, the picture moved on all 24 (mid-drag `translate(146.825px, 250px)
  scale(0.609958)`), lands on `/` docked, playing 3.1 -> 6.6 s. home > clip2 > clip1, pull 250: lands on `/` (depth 2 -> 0,
  past clip2), clip1 docked and playing. Deep link, pull 250: fresh Home, docked, playing. Pull 60 slow: springs back, still
  full on the watch page, playing, transform cleared. Scrolled 40, pull 250: 1 of 22 cancelable, 0 prevented, the page scrolls
  40 -> 0, no minimize (R2b).

## 7. Device checks (Dean, on the released build; add each to DEVICE-CHECKS.md in the release commit)

1. iPhone, custom controls on, inline video playing: pull down slowly and let go early (springs back, still playing); pull past a
   third (docks bottom-right, still playing, the page is where Home would take it). **Watch the picture during and after the
   drag: if it goes black or freezes while sound runs on, open the same page with `?minimizeAnim=0` and repeat. Black with the
   animation and fine without = the transform is the trigger (R7 is the shipped fallback; tell the Architect).**
2. Tap the chevron: same end state. Then tap the mini player: back to the watch page, same position, still playing.
3. The mini player X and play/pause: hit them with a thumb, ten times each, without mis-taps into "expand".
4. Regressions: tap pauses, double-tap skips, hold 2x, hold-drag-down locks 2x, swipe right goes back, scroll the page from below
   the picture, scroll down then pull on the picture (scrolls to top first, R2b), full screen untouched.
5. Home-screen app AND Safari tab (the pull at the top of a Safari tab fights the browser's own overscroll; report which wins).

## 8. Gate brief (attack surfaces)

- **Gesture disjointness** (LESSONS 2): try to minimize while holding, to lock 2x while minimizing, to fire swipe-back and a
  minimize from one diagonal drag, to pause the video with the drag's lift (a phantom single-tap), to expand the dock straight
  back with the commit's synthetic click.
- **Inert feature** (LESSONS 0): prove the claim fires through the REAL listeners in the real host (not a hand-called pure
  function), and that `preventDefault` actually stops the page moving (the v1.358 W0 trap: a non-passive listener on the
  `<video>` is inert, on the host it is not).
- **Strand / leak** (LESSONS 4, reveal and clear are two axes): a transform left on the host after any end path (snap, commit,
  touchcancel, close mid-drag, a new item mid-drag, the app backgrounded mid-drag, a rotate mid-drag) - the docked or next
  full player would render shrunk or offset.
- **Blast radius** (LESSONS 6): a transform on the host makes it a containing block for every fixed descendant; the M5 rules
  must not reach the desktop dock or the full-player `.pc-btn`; the "watch page is never docked" comment.
- **iOS 27** (LESSONS 7): nothing with a filter, mask, backdrop, blend or opacity on or over the picture; the census covers
  the new button.
- **History** (LESSONS 4): a minimize from a deep link (depth 0) goes Home, never exits the app to the referrer; two fast commits
  never pop two levels.

## 8b. Release (v1.362.0)

Exactly `docs/RELEASING.md` and AGENTS.md "Release ceremony": `npm version 1.362.0 --no-git-tag-version`; ROADMAP.md "Shipped"
entry (and tick the Planned entry); a `docs/releases.json` ledger entry in pure user language (the tone test enforces it; mention
that the pull-down and the chevron need Settings > Mobile player > custom controls on); section 7's checks into
DEVICE-CHECKS.md; the LESSONS update in the release commit if the wave taught one; `node scripts/plan-complete.js <this plan>
"Shipped v1.362.0" --apply`. Then the protected-main flow: local `merge --no-ff` into main, tag on that merge, push the branch +
tag in ONE push with `GIT_SSH_COMMAND="ssh -o ServerAliveInterval=20 -o ServerAliveCountMax=60"`, `gh pr create`, wait for CI
green (`ci (22)`, `ci (24)`, `audit`, `secret-scan`), then ASK Dean (AskUserQuestion) before `gh pr merge --merge`; `git pull
--ff-only`; delete the branch remote (`gh api -X DELETE repos/dtammam/filetube/git/refs/heads/feat/v1.362-minimize`, verify with
`git ls-remote`) and local (`-d`), and remove the worktree.

## 9. Out of scope (logged, not built)

- Full screen / landscape pull-down (YouTube exits full screen on a pull), the iPad and desktop chevron, swipe the mini player
  up to expand or sideways to dismiss, dragging the mini player around, fading the page behind the drag. Add any Dean asks for
  after the device pass to ROADMAP Planned.
