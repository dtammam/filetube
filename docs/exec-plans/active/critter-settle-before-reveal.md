# Critters: settle-before-reveal (v1.182.0)

## Problem (Dean, 2026-08-24, desktop + mobile screenshots)

Critters "load, sit in odd spots, then reconcile behind elements." The three
mobile screenshots catch the transient wrong state: a critter floating
mid-thumbnail, critters sitting on title text - all *before* they settle.

## Root cause (confirmed, not a theory)

The engine is **place-early, then correct**, and every correction is visible:

1. A view swaps in -> `init(root)` kicks off the async feed fetch -> immediately
   `scheduleCritterScatter()` (common.js router hooks).
2. +200ms: `scatterCritters()` measures the layout **as it is right then** -
   loading skeletons / partial feed - places critters against those anchors and
   **fades them in** (`.critter-arrive`).
3. Real content lands: skeleton cards (2-line title reservation) are replaced by
   real cards (often 1-line titles), so cards below shift up (the v1.173
   comment names this exact reflow). The already-visible critters keep their
   document coords and float off their anchors.
4. The settle ladder (+1.5s/+4s) and the content-nudge observer then re-glue or
   re-scatter to the corrected spots - the visible "reconcile".

You cannot make a *visible* correction invisible. The only cure is to **not
paint a critter until its position is final.**

Verified facts that make the fix safe:
- `.thumbnail-container` has `aspect-ratio:16/9` (style.css) -> card box geometry
  is reserved before the image decodes; image load does NOT reflow.
- `buildSkeletonGrid` (main.js) renders `.skeleton-card`s whose replacement by
  real cards IS a `childList` mutation on the feed grid -> catchable.

## Fix (Dean's choices: "wait, then place once"; ~2.5s cap)

Change **only the entry gate** (`scheduleCritterScatter`); leave the entire
gate-won placement/settle/re-glue/nudge pipeline (`scatterCritters` and below)
byte-identical so its tests and invariants all stand.

New wait phase (mode ON, per navigation):
- Pre-warm the manifest + image decode during the wait (`fetchCritterManifest`).
- A dedicated, self-contained `MutationObserver` (SEPARATE from the post-reveal
  nudge observer - they never coexist): each content mutation (re)arms a quiet
  debounce (`CRITTER_QUIET_MS = 300`).
- A leading quiet timer so a static, NON-loading view (Settings) reveals
  promptly instead of waiting the cap.
- The quiet timer reveals only when `critterPageLoading()` is false (no
  `.skeleton-card` present) - a reveal against skeletons would re-drift when the
  real cards land. If skeletons persist, the cap is the backstop.
- A hard cap (`CRITTER_REVEAL_CAP_MS = 2500`) reveals no matter what (a page
  that never quiets, or a fully static one that never mutates).
- Reveal = `disconnectCritterWait()` (observer + both timers, atomically) then
  the unchanged `scatterCritters()` -> the ONE placement + the ONE arrival fade,
  against the settled layout. It wires its own nudge observer + settle ladder as
  the rare post-reveal safety net (e.g. the "Playing on PC" banner landing late).

Mode OFF path unchanged (the 200ms teardown debounce). `applyCritterMode`
unchanged (Settings has no skeletons -> the leading quiet reveals ~300ms after a
toggle - good feedback).

## Handle discipline (the unstashed-handle class, struck repeatedly)

`scheduleCritterScatter` cancels EVERY pending handle on each navigation: the
settle retry, the nudge debounce, the OFF-teardown debounce, AND the new wait
(observer + quiet + cap) via `disconnectCritterWait()`. `scatterCritters` also
calls `disconnectCritterWait()` at entry so any direct scatter supersedes a
pending wait. The wait observer stands down on a swapped/torn-down document
(the jsdom class): guarded by `critterWaitObsDoc`.

## Predictions the tests re-verify

- A scheduled scatter (mode ON) places NOTHING at +200ms; it places once after
  the content lands and the page goes quiet (or the cap).
- With a `.skeleton-card` present, the quiet timer does NOT reveal; removing the
  skeleton + quiet -> reveal.
- The cap reveals even if skeletons never leave.
- A static view (no skeletons, no mutations) reveals at the leading quiet, well
  under the cap.
- New navigation cancels the wait (observer disconnected, timers cleared) - no
  leaked handles across views.
- Unchanged: the arrival fade, the settle ladder, re-glue, the nudge, the tap
  path, every placement/clip invariant.

## Named attack surfaces for the adversarial seat

- Double-reveal / double-scatter races (observer callback vs cap vs quiet vs a
  fresh navigation firing mid-wait).
- A leaked wait observer taxing users after navigation (the v1.160 global-listener
  class) or after mode-off.
- The skeleton selector coupling: a view with persistent shimmer that is NOT a
  feed skeleton must still reveal (at the cap, not never).
- TOCTOU: toggling OFF mid-wait must render nothing and leak no handle.
- The reveal firing against a torn-down/swapped jsdom document.
