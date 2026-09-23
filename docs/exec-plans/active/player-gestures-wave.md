# Player gestures wave (v1.311.2)

Branch `fix/player-gestures`, base `22a313dc` (main, v1.311.1).

status: Approved 2026-09-22 (Dean: "This all makes tons of sense. Please go.") · anchor: outcome · gate: FULL (adversary + qa)
next: commit, mutation-check the new bindings, dual-Node suites, then the gate.

## Intake (Dean, 2026-09-22, iPhone PWA, custom player controls ON)

Priority order. Full trace in memory `followup-player-gestures-wave.md`.

1. CONFIRMED: a rightward scrub of the seek bar fires the document-wide swipe-back
   (`common.js` `wireSwipeBack` / `decideSwipeBack`, v1.160) -> `history.back()`,
   leaving the player and fullscreen.
2. Faux fullscreen (`body.ft-css-fullscreen`) and the expanded audio view
   (`body.ft-audio-expanded`) lock only with `overflow:hidden`, which iOS ignores
   for touch -> the page behind scrolls.
3. Sideways double-tap in faux fullscreen: the first tap makes the hidden bar
   hit-testable at once, the second can land on `#fs-btn` and exit.
4. Remove the +/-15s skip buttons everywhere (desktop too). Keep double-tap seek + ripple.
5. Critters must never block a link/button: the element's click always fires; the
   critter may still react.
6. Bottom nav unsticks after a rotate. NOT fixed here - ship #2, Dean re-checks on device.

## Acceptance

- **A1 swipe-back stands down on gesture owners.** A touch drag never fires
  `history.back()` when it (a) begins inside any of: `#player-wrapper`,
  `.player-container`, `#player-dock`, `#fs-stage`, the skin surfaces (`.mms-full`,
  `[data-skin-seek]`, `.ip-wheel`, `.ipod-brick`), any `input[type=range]`, any
  `[role=slider]`; or (b) begins inside any element whose computed `touch-action`
  is `none` or `pan-y` (the NET - an element that owns horizontal gestures); or
  (c) happens while `body.ft-css-fullscreen`, `body.ft-audio-expanded` or native
  fullscreen is live. A rightward drag on ordinary page content still goes back.
  Bound by a test that drives the REAL wired listeners (jsdom touch events) with
  the seek bar as the start target, plus a census test that enumerates every
  `input[type=range]` / `role="slider"` in `public/**` and asserts each is covered.
- **A2 real iOS body lock, shared.** One shared, owner-keyed body scroll lock
  (`position:fixed; top:-Y`, restores Y on the last release). skin-surface.js's
  wheel-ghost lock and the two player immersive views all route through it; the
  old skin-surface copy is deleted. Two owners overlapping (skin + expanded audio)
  never clobber each other's Y. The faux-fullscreen scroll keeper's "restore only
  while still FULL" rule is preserved (dock/nav exit releases without restoring).
  Bound by unit tests of the helper (nesting, idempotence, restore/no-restore) and
  source locks that each of the three callers uses it.
- **A3 tap-reveal grace.** When a touch on the video/art reveals a HIDDEN bar in an
  immersive view, the bar stays `pointer-events:none` for `DOUBLE_TAP_MS` (350ms),
  then becomes tappable. A reveal of an already-visible bar, and desktop mousemove,
  are unaffected. Bound by a test that the grace class is set only on a
  hidden->shown touch reveal and cleared after the window, and a CSS test that the
  class disables hit-testing on the bar.
- **A4 skip buttons gone.** `#skip-back-btn` / `#skip-fwd-btn` and their JS/CSS are
  removed from every shell (dynamic census over `public/*.html`); the ripples
  (`#skip-ripple-left/right`) and double-tap seek still work. Measured before/after
  with `scripts/action-row-probe.js` (action row unchanged at every width).
- **A5 critters never swallow an interactive click.** In the capture click handler,
  a critter hit whose target is inside `a, button, [role=button], summary, label,
  select, input, [onclick], .btn` plays its reaction + sound but does NOT
  `stopPropagation`/`preventDefault` (and the mousedown selection-suppress stands
  down there too). A hit over non-interactive content is swallowed as today.
  Bound by a jsdom test that a button's own click handler fires under a critter
  hit while the reaction class is still applied.

## Out of scope

- #6 bottom-nav rotate unstick: no viewport re-assert until Dean's device verdict on A2.
- No change to double-tap seek timing, the skip chain, or hold-to-2x.

## Attack surfaces for the gate

- A1: an unenumerated scrubber (inert-sibling-list class); the `touch-action` net
  missing the haptic skin (`.mms-haptic` lifts touch-action - hence the explicit
  `.mms-full` selector).
- A2: two owners sharing the body; the dock/nav exit restoring onto the destination
  view; the ghost MutationObserver heal still releasing; a stranded lock.
- A3: the grace outliving an exit, or blocking a deliberate bar tap after 350ms.
- A4: shell parity (10 shells); dangling refs in player.js/CSS.
- A5: the swallow still happening via the mousedown path; keyboard/programmatic
  clicks unchanged.

## Build notes

- **A1** `common.js`: `SWIPE_BACK_OWNER_SELECTORS`, `touchActionOwnsHorizontal`,
  `swipeBackImmersiveLive`, `swipeBackStandDownReason` (one ancestor walk; the v1.160.3
  horizontal-scroller guard folded in). The touch wiring moved out of the router
  closure into top-level `wireSwipeBackGesture(doc, win, onBack)` so the REAL
  listeners are driven in `test/unit/swipe-back-owners.test.js` (the router's
  `wireSwipeBack` just hands it `swipeBackIfPossible`). The release is re-checked
  against immersive state (a rotate into faux fullscreen MID-drag).
- **A2** new `public/js/body-scroll-lock.js` (`window.FileTubeBodyLock`), owner-keyed
  per document. Owners: `faux-fullscreen`, `audio-expanded` (player.js),
  `skin-ghost:<n>` (skin-surface.js), `wheel-cal` (setup.js).
- **A3** `player.js` `armRevealGrace` / `clearRevealGrace` + `.controls-reveal-grace` CSS.
- **A4** buttons + `revealSkipButtons`/`hideSkipButtons`/`skipRevealTimer` + the
  `.skip-btn*` CSS removed; `#skip-controls` stays as the ripple layer.
- **A5** `common.js` `CRITTER_INTERACTIVE_SELECTORS` / `critterOverInteractive`, applied
  in the capture click handler AND the mousedown selection-suppress.

## Deviations (none change an acceptance criterion or user-visible behavior beyond it)

- **A2 grew two seams the plan did not name.** A `position:fixed` body reads
  `scrollY` 0 and clamps `scrollTo`. So the router would record 0 for a page left
  under a lock, and would lose the scroll it places during a swap made under one
  (the v1.130 carried-immersive advance). The lock owns both:
  `scrollYOf` (router `recordScrollForCurrentState`, `replaceViewState`, the home
  cache capture) and a deferred `scrollTo` (router `swapToView` + home-cache restore,
  via `pageScrollY` / `placePageScroll`). The latent form of this bug already
  existed under the v1.256 skin lock.
- **A2 also absorbed the wheel-calibration tool's private lock** (`setup.js`, a
  hand copy of the skin lock). The plan named skin-surface only. A census test now
  fails if any other `public/js` file pins the body.
- **A3 scoped to the VIDEO touch-down reveal.** The cover-art reveal fires at
  single-tap classification (after the 350ms debounce), so a double-tap never
  reaches it. The grace is touch-only (a mouse `pointerType` never arms it).
- **Instrument repairs to `scripts/action-row-probe.js`** (needed for the A4
  measurement): (1) its seed still wrote `folders`/`folderSettings`/`progress`/
  `settings`, which the schema-v33 adapter refuses, so the seed threw; now it seeds
  only `metadata`. (2) Chromium's renderer crashed on this box's 64M `/dev/shm` on
  every run (CDP `Inspector.targetCrashed`), so it now passes `--disable-dev-shm-usage`.
  Both repairs are applied identically to the BEFORE tree (`git archive 22a313dc`)
  and the AFTER tree.

## Found, not fixed (pre-existing, out of scope)

- `lib/ytdlp/views/subscriptions.html` loads `player.js` but NOT `music-skins.js`/
  `skin-surface.js` (every other player shell does). A cold load on /subscriptions
  followed by a soft-nav into music/podcasts has no skin engine. This is the
  v1.250 SHELL PARITY class. Filed for Dean's call.

## Measurement (A4, `scripts/action-row-probe.js`, repaired instrument)

BEFORE = `git archive 22a313dc` (main, v1.311.1); AFTER = this branch. Widths 390,
375, 1280, 1366, 1600, 1920. Every field of every JSON line (all action-row button
x/y/w/h, rows, column width, stars, title, description, docScrollWidth) is
IDENTICAL at all six widths. One BEFORE run (375) failed to launch Chromium
("never exposed its debug endpoint") and was re-run alone - the documented
multi-launch residual, not a measurement.

## Mutation record (builder's own, @825947aa, /tmp sandbox from `git archive`)

22 mutants over the new mechanisms, each run against the 9 targeted test files:
M1 touchstart stand-down removed · M2 range selector dropped · M2b slider selector
dropped · M3 release-time immersive check removed · M4 touch-action net off ·
M4b `.mms-full` dropped · M5 last-owner rule removed · M5b join re-captures ·
M6 faux lock removed · M7 faux release restores · M8 audio lock removed · M9 grace
arm removed · M10 pointerType guard removed · M10b grace not cleared on exit ·
M11 critter always swallows · M12 critter mousedown suppress on buttons · M13 router
swap bypasses the lock · M14 router record bypasses the lock · M15 skin release
dropped · M16 deferred Y ignored · M17 grace CSS dropped: all KILLED.
M18 (the skin's owner key collides with `faux-fullscreen`) SURVIVED the first run.
Bound by a new skin-surface test (a skin teardown leaves player owners pinned), and
both collision variants (`faux-fullscreen`, `audio-expanded`) are now KILLED.
