---
plan: landscape-scroll
harness: v2 · full
branch: fix/v1.390.0-landscape-scroll
anchor: spec
status: Planned
next: builder - Step 0, then M0 (measure the sideways watch page on main) before any edit
design: Dean's screenshot + ask 2026-10-13 ("one can barely scroll as it doesn't work on the video area"), Root's diagnosis the same day; Dean picked options 1 + 2. Base = main 038be5c6 (v1.389.0 + baselines).
builder: standard (a CSS height cap plus one gesture branch inside the existing picture touch handlers; the loupe cancel stays)
gate: -
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
- M0: 
- M1: 
- Scrolling element used: 
- Gesture cases: 
- Mutations: 
- Full suite runs (counts, verbatim): 
- Gate verdicts: 
- Device checks Dean owes: 

Gate: APPROVED r1 @6ed7ae123a9c5e916ab52ca787d841ffa45e8c88 — qa
Gate: CHANGES r1 @6ed7ae123a9c5e916ab52ca787d841ffa45e8c88 — adversary (W1 tap that stops a glide pauses; W2 iPad landscape gets the drag; W3 four unbound guards; see report)
