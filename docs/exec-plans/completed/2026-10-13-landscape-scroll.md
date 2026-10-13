---
plan: landscape-scroll
harness: v2 · full
branch: fix/v1.390.0-landscape-scroll
anchor: spec
status: Shipped v1.390.0
next: release v1.390.0 (gate closed at 64522c73)
design: Dean's screenshot + ask 2026-10-13 ("one can barely scroll as it doesn't work on the video area"), Root's diagnosis the same day; Dean picked options 1 + 2. Base = main 038be5c6 (v1.389.0 + baselines).
builder: standard (a CSS height cap plus one gesture branch inside the existing picture touch handlers; the loupe cancel stays)
gate: adversary + qa APPROVED r3 @64522c73 (r1 and r2 changes fixed)
---

# v1.390.0: a sideways phone can scroll the watch page, on the video too

Norms: no em dashes; stage by name; `git commit -F <file>`; never pipe a commit or push; fnm Node 22.23.1 PATH before any
node/npm/git command; never `--no-verify`; never self-merge. A status report NEVER ends your turn.

Read first: AGENTS.md (CSS / SPA traps, UI ratchet, overlay census); docs/LESSONS.md 0, 1, 2, 4, 5, 6, 8, and specifically
LESSONS.md:198 (the iOS 27 loupe and the touchstart cancel, Dean's accepted cost) and :66 (Playwright grants user activation);
the completed plans docs/exec-plans/completed/2026-10-13-phone-landscape.md (v1.389.0, same surface) and the v1.362 minimize
pull plan (search completed/ for "minimize-to-mini-player").

## Step 0 (builder)
- Work ONLY in `.claude/worktrees/fix-v1.390.0-landscape-scroll` (hard-link node_modules; a clean install is
  `rm -rf node_modules && npm ci` there, never the main checkout).
- Stop and ask Dean (AskUserQuestion) when: the loupe cancel (`pictureTouchCancelDecision` and its non-passive touchstart)
  would have to change or be removed; portrait or desktop behavior would change; the gate reaches round 3.
- Merges: gate closed + required checks green -> SendMessage "FileTube Root" (may be listed as "FileTube Server/Web Root
  Session") the PR number and sha; the Root merges.

## Rulings (Dean, 2026-10-13)
| # | Ruling |
|---|--------|
| 1 | Option 1: on a sideways phone, the inline (not fullscreen) player is shorter, about 70% of the screen height, so there is room to scroll beside it and the title peeks below. |
| 2 | Option 2: a vertical drag that starts on the picture scrolls the page, following the finger, with a short glide after release. The pull-down-to-minimize stays (it only applies at the top of the page). Taps, double-taps, holds and swipe back unchanged. |
| 3 | The loupe guard (v1.362.3) stays exactly as it is. Re-testing whether iOS still needs it is a separate, later device check. |

## 1. Outcome
On a phone held sideways, on the watch page, not fullscreen: Dean can scroll the page with a finger anywhere, including on
the video, and sees the title start below the player without scrolling. Portrait, fullscreen, the docked mini player, Feed
cards and desktop: unchanged.

## 2. Root cause (Root, 2026-10-13, from code)
- public/js/player.js `wireSkipHoldGestures` (~:5845-5900): a SEPARATE non-passive touchstart calls `e.preventDefault()` on
  every one-finger touch on the FULL player's picture / art when `pictureTouchCancelDecision` (~:1429) says so. That cancels
  the browser's own scroll for any gesture starting on the picture (the LESSONS:198 accepted cost). In portrait the video is
  short; sideways it is most of the screen, so only the side strips scroll.
- Minimize pull: `beginMinimizeGesture` / `minimizeTouchMove` (~:5621) / `minimizeDragDecision` (search it: 'claim' / 'guard'
  only for a mostly-downward drag AND `scrollY <= 1`, else 'none') / `finishMinimizeDrag`; the host's ONE non-passive touchmove
  (~:9197) routes hold drags and the minimize pull. Keep it the only non-passive touchmove (its comment says so).
- Inline sizing: public/css/style.css `.player-container` ceilings (`max-height: 45vh` mobile-portrait ~:3865-3890 and ~:4864,
  the watch stage ~:6834). The faux fullscreen (`.css-fullscreen`, ~:5868) overrides with `max-height: none`; keep that.

## 3. Design
- **D1 Shorter sideways player (CSS).** On `html.is-phone` in landscape, on the watch page, not `.css-fullscreen` and not
  docked / Feed: the player's height is capped at about 70% of the dynamic viewport height (`dvh` with a `vh` fallback, a token
  or a commented constant), keeping 16:9 (so it is narrower than the screen and centered), leaving visible page on both sides
  and the title row starting inside the first screen. Measure the result (M1) rather than hand-computing pixels.
- **D2 Drag on the picture scrolls the page (JS, inside the existing handlers).** A one-finger drag that starts on the picture
  (FULL, not fullscreen, not native controls, a phone) and becomes mostly vertical past the same tolerance the tap logic uses
  (`MOVE_TOL`), and is NOT a minimize (`minimizeDragDecision` is 'none': upward, or downward with the page already scrolled),
  and NOT a live hold: the page follows the finger 1:1 with `window.scrollTo` (or the scrolling element the watch page really
  uses: find and name it), clamped to the page's scroll range. On release, a short glide from the release velocity
  (sample the last ~80 ms like `minimizeVelocity`), decaying with rAF, stopped by the next touch. Respect
  `prefers-reduced-motion` (no glide). Route the moves through the host's existing non-passive touchmove (no second one).
  The drag never schedules the single tap (the existing `tapGestureMoved` veto), never starts a hold (clear `holdTimer` as
  today), never pauses, and does not run in portrait if that changes portrait behavior (decide by measurement; ruling 1 scopes
  this to sideways, so default to landscape-only unless portrait gains it for free with no change to existing tests; ask if unsure).
- **D3 Unchanged:** `pictureTouchCancelDecision` and its touchstart (the loupe guard), horizontal swipes (swipe back), double-tap
  skip, hold-to-2x, the minimize pull from the top, the faux fullscreen and the v1.389.0 enter-when-sideways logic.

## 4. Acceptance (instrument in brackets; headless needs touch emulation + screen size for is-phone, see v1.388.0's
scripts/skin-chips-probe.js fix)
- M0 on main and M1 on the branch at 844x390 phone, watch page, inline: player rect, title rect top, side margins
  [probe, numbers in Evidence]. M1: player height <= ~70% of the viewport and the title's top is inside the viewport.
- D2: synthetic touch drags on the picture: up 200px scrolls the page by ~200px; down with the page scrolled scrolls back;
  down at the top still minimizes; a short drag under tolerance is still a tap; a hold still reaches 2x; a horizontal swipe is
  not hijacked [tests driving the real listeners via the real route, not a direct helper call; each mutated red once].
- Glide: release velocity produces a decaying scroll, cancelled by a new touch; none under reduced motion [tests].
- Portrait 390x844, desktop 1280x800: identical player size and gesture behavior to main [tests / probe].
- The loupe guard still calls preventDefault on the same touches as main [test].
- lint:ui does not grow docs/ui-exceptions.json; overlay census zero.

## 5. Gate
Adversary + QA. Brief with LESSONS 1, 2, 4, 5, 6, 8, LESSONS:198 and: a scroll that only works in the test harness (prove the
touchmove is cancelable and routed in the real path); a tap or hold broken by the new branch (pausing on a scroll lift);
the minimize pull double-claiming a downward drag; the glide outliving navigation (SPA view swap) or fighting a new touch;
portrait / desktop regressions; the dvh cap fighting `.css-fullscreen`'s `max-height: none`.

## 6. Release
v1.390.0 per docs/RELEASING.md. Ledger (user language): on a phone held sideways the video on the watch page is a little
shorter so the title shows below it, and you can scroll the page by dragging on the video itself. DEVICE-CHECKS block "Sideways
scrolling": drag up and down on the video (Safari and the app); the glide feels natural; pull down at the top still shrinks to
the mini player; tap, double-tap and hold still work; portrait unchanged.

## Out of scope
Removing or retesting the loupe guard; portrait player height; the fullscreen layout; tablets.

## Evidence (builder fills)
- M0: main 038be5c6, 844x390 inline (after leaving the v1.389.0 sideways fullscreen): host 796x488.6 = 1.253 of the viewport height, side margins 24, title top y=584.6 (below the fold), scroll range 913; the 844x390 drag probe on main: a 200 px drag on the video scrolls 0 px (a drag with the page at 100 stays 100). tools/landscape-scroll-proof/probe-geometry.js, probe-drag.js.
- M1: branch, same probe: host 412.7x273 = 0.700 of vh, side margins 215.7, title top y=369 (inside the viewport), scroll range 698; 667x375 0.695 (322.9x260.5), 932x430 0.700, 568x320 0.694 (QA). Bar overflow: none (411 and 323 wide). Portrait 390x844 (host 0,72,390x299.4, title 387.4, range 310) and desktop 1280x800 (host 254,80,598x377.3, title 473.3, range 189) identical to main.
- Scrolling element used: the document (`document.scrollingElement` = <html>), `window.scrollTo` via FileTubeBodyLock.scrollTo, clamped to scrollHeight - innerHeight; the watch page has no inner scroller.
- Gesture cases (real Chromium, raw CDP touch with explicit event clocks, probe-drag.js, 844x390 unless noted): up 200 slow: page 0 -> 180, 20/20 moves cancelable, 19 prevented (the first, inside the tolerance, is not), not paused; up 200 flick (20 px per 10 ms): 180 at the lift then a glide to 698 (the end of the page); scrolled 100, down 100: 20; 667x375 down 200 at the top: state docked, page 0 (minimize unchanged); portrait and desktop up 200: page 0, 0 prevented, same as main. jsdom, real listeners (landscape-scroll-drag.test.js): up/down/clamps, minimize vs scroll on a narrow phone, tap under the tolerance, double-tap skip, hold 2x and hold-lock, sideways swipe, tap then drag (no pause), glide decay / rested finger / reduced motion / end of page / new touch / rotate, dock, view swap, fullscreen, scroll lock, second finger, touchcancel, caught-glide touch (tap, hold release, touch elsewhere), the loupe guard on the same touches as main.
- Mutations: player.js, 24 mutants in the first round (all killed but M21, `tapGestureMoved`/`holdTimer` in claimScrollDrag: truly masked, the surface touchmove does both at the same MOVE_TOL first), 8 more after gate r1 and 1 after r2 (all killed); CSS 6 mutants killed; the loupe guard 2 mutants killed; the seats ran their own (adversary: 4 survivors turned into tests; qa: 2 survivors in the redundant flag clear, not blocking).
- Full suite runs (counts, verbatim): `npm test` Node 22.23.1 on 6ed7ae12: # tests 12505, # pass 12492, # fail 0, # cancelled 0, # skipped 13 (exit 0). Final run on the close-out tree (version 1.390.0, docs, ledger): `npm test` Node 22.23.1: # tests 12513, # pass 12500, # fail 0, # cancelled 0, # skipped 13 (exit 0).
- Gate verdicts: qa APPROVED r1 @6ed7ae12; adversary CHANGES r1 (W1 caught-touch pause, W2 iPad, W3 four unbound guards) -> fixed d42ee8a0; both CHANGES r2 (W4 stuck 2x on a hold that lands on a glide) -> fixed 64522c73 (Dean ruled to run a third round); APPROVED r3 @64522c73 adversary and qa.
- Device checks Dean owes: docs/DEVICE-CHECKS.md "Sideways scrolling (v1.390.0)": shorter player with the title below; drag and flick on the video in Safari and the app, a finger on a gliding page stops it without pausing; pull-down at the top still minimizes; tap, double-tap, hold 2x and swipe back; upright and iPad unchanged; the loupe still absent on a sideways hold. Unconfirmed on iOS: touchmove stays cancelable after the unprevented first move, rubber-band at the page ends, URL bar collapse mid-glide.

Close-out binding (no seat re-check, docs/RELEASING.md): approval at 64522c73; `git diff --name-only 64522c73..HEAD` of the close-out is ROADMAP.md, docs/DEVICE-CHECKS.md, docs/LESSONS.md, docs/exec-plans/completed/2026-10-13-landscape-scroll.md, docs/releases.json, package-lock.json, package.json; `git diff 64522c73..HEAD -- package.json package-lock.json` changes only the three `"version"` lines, 1.389.0 -> 1.390.0.
