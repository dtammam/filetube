# Exec plan: chapter follow-along (segmented seek bar + menu highlight + title chip)

Status: ACTIVE. Owner: main session. Target: ~v1.109.0. Gate: FULL two-reviewer.

## Goal (Dean, verbatim intent)

"If we have content with chapters, colour the section of the chapter actively
being played (the same red as the loop-∞ state) so you can follow along and see
what portion you're in." On clarification Dean chose the **full YouTube feel**:
do it the way YouTube does - both a **segmented progress bar** AND a **chapters
list highlight**, plus the **hover chapter-name tooltip** and a **persistent
current-chapter title chip**.

This is a client-only wave (player.js + style.css + tests). No server/schema/
route changes. Chapters already exist end-to-end (`currentChapters`, the Ch
menu, `resolveChapterLoopBounds`); this wave is purely how the CURRENT chapter is
surfaced.

## How YouTube does it (the spec we're matching)

1. Scrubber split into one segment per chapter with a small gap at each boundary;
   played portion red, the chapter you're in fills red as you play, upcoming grey.
2. Hovering the bar thickens it and shows a tooltip with that position's chapter
   name (+ the thumbnail preview).
3. The chapters list highlights the current chapter.
4. A small current-chapter title shows near the bar.

## Where the custom bar (our target surface) is actually shown

MACHINE-DERIVED (player.js:1579 `native = isMobileFormFactor() && isVideo &&
state===STATE_FULL && !mobileCustomPlayerCached`):

- Desktop: custom bar ALWAYS. -> feature applies.
- Mobile AUDIO: custom bar (no native audio fullscreen). -> applies.
- Mobile INLINE video (not FULL): custom bar. -> applies.
- Mobile FULL video with "custom player" setting on: custom bar. -> applies.
- Mobile FULL video default: **native iOS controls** - iOS renders its OWN
  scrubber + chapters (Dean already loves this). Our overlay is N/A (our bar
  isn't visible). Do NOT fight it.
- DOCKED mini-player: `#player-dock #chapters-btn, #player-dock .chapters-menu {
  display:none }`. The seek overlay + chip MUST hide when docked too.

So the feature lives entirely on the CUSTOM control bar and is inert wherever the
native strip or the dock takes over. Prediction the gate re-verifies: **0 HTML
shell edits** (every new element is JS-built, mirroring `seekPreviewEl`), and the
`#seek-bar` native fill path is BYTE-UNCHANGED when an item has no chapters.

## Architecture: ONE shared "current chapter index", two+ renderers

Add a pure resolver (unit-tested, exported like `resolveChapterLoopBounds`):

```
currentChapterIndex(chapters, t) -> integer index of the chapter whose
  [startTime, nextStartTime) window contains t; -1 if no chapters / before the
  first start. Last chapter runs to +inf. Guards non-finite t, non-array, and
  non-monotonic/duplicate starts (returns the last start <= t).
```

Drive it from the EXISTING rAF `fillTick`/`updateSeekVisual` (player.js:4144) -
the loop already runs each frame while playing and computes `cur`/`ratio`; it
computes the index once there and calls the renderers only when the index
CHANGES (cheap; no per-frame DOM writes). Also recompute on scrub `input`, on
`seeked`, on menu open, and on chapter-set change. Live mode uses
`currentAbsTime()`/`seekTotalDuration()` exactly as the fill loop already does.

Renderers (each a small function, each independently testable):
- R1 seek-bar segments overlay
- R2 chapters-menu current row
- R3 current-chapter title chip
- R4 hover tooltip chapter name (pointer-driven, not index-driven)

## T1 - resolver + wiring (no visual change yet)

- `currentChapterIndex` pure fn + export; unit tests (interior, first/last,
  before-first, empty, non-finite, non-monotonic).
- Track `currentChapterIdx` state; a `setCurrentChapter(idx)` dispatcher that
  no-ops when unchanged and otherwise calls R1-R3. Wire into `updateSeekVisual`,
  scrub `input`, `seeked`, `applyChaptersForMedia`, menu open. Reset on
  teardown/close/resetSeekVisual.
- Commit is green with NO visible change (renderers are stubs writing a class).

## T2 - R2 chapters-menu current row highlight (live) + keep-open-on-play

- In `buildChaptersMenu`, tag each `.chapters-menu-item` with its index; a
  renderer toggles `.chapters-menu-item-current` (aria-current="true") on the
  row matching `currentChapterIdx`. Red treatment (`color: var(--yt-red)` on the
  item, subtle left-accent) - distinct element from the loop button's own red so
  "playing" and "loop-armed" can co-exist on one row.
- The menu currently closes on `play` (player.js:5410). Remove the `play` close
  so you can open the menu and watch the highlight walk down as you play (KEEP
  the `seeking` close - a manual scrub is a different intent; re-evaluate `pause`
  during build). This is the change that makes "follow along" real in the list.
- The highlight updates live even when re-rendered (arm/disarm rebuilds the menu):
  after any `buildChaptersMenu`, re-apply the current-row class.
- Tests: row N current for a t inside chapter N; moves on index change; CLEAR
  axis (a born-highlighted row is vacuous - populate then drive to another
  chapter and assert the old row cleared); menu no longer closes on `play`.

## T3 - R1 segmented seek bar overlay (the risk item - seek bar is scar-prone)

Approach (lowest-risk that still gives the full look): **JS-built overlay that
draws the segmented track when-and-only-when the item has chapters**, leaving the
native input for interaction + the visible thumb.

- At host init, wrap `#seek-bar` in a JS-created `.pc-seek-wrap`
  (position:relative, flex:1 1 auto, min-width:0, display:flex, align-items:
  center) and append a `.seek-chapters` overlay (position:absolute, inset over
  the 6px track band, pointer-events:none, below the thumb). No HTML shell edits.
- When chapters exist, add `has-chapters` on the wrapper and NEUTRALISE the
  native track PAINT with ONE override set gated on that class, placed AFTER the
  4 theme rules (equal specificity -> source order wins):
  `.pc-seek-wrap.has-chapters #seek-bar::-webkit-slider-runnable-track {
  background:transparent }`, `::-moz-range-track{background:transparent}`,
  `::-moz-range-progress{background:transparent}`. Thumb untouched/visible.
- The overlay renders: per-chapter segment divs (flex-basis = chapter duration /
  total), a boundary GAP between them (~3px), each segment grey (unplayed) with a
  red played-fill child sized to intra-chapter progress; fully-played segments
  fully red, current segment partially red, upcoming grey. Driven by the resolver
  index + the same ratio the fill loop computes. Engine-agnostic (plain divs).
- Hover thicken (YouTube lift): `.pc-seek-wrap:hover .seek-chapters` grows the
  segment/track height (CSS transform/height on the overlay - trivial because the
  overlay, not a native pseudo, owns the paint now). RISKIEST sub-item; if the
  thicken can't be made clean the tooltip (T4) is the guaranteed hover deliverable
  and the thicken degrades to none - disclose if so.
- NO-CHAPTERS path is byte-identical to today (native fill, no wrapper class, no
  overlay content). Source-lock the 4 theme fill rules are untouched.
- MEASURE, don't guess (scar #7): the overlay must sit exactly over the 6px track
  band inside the 16px input across desktop 40px / mobile two-row 80px / the era
  themes. Verify against `getBoundingClientRect`, not arithmetic.
- Tests: N chapters -> N segments + N-1 gaps; segment widths proportional to
  durations; played/current/upcoming fill classes track the index+ratio; no
  chapters -> no overlay + native rules intact (source-lock); docked -> hidden.

## T4 - R4 hover tooltip chapter name

- Extend `updateSeekPreview` (player.js:4109): compute the chapter at the hovered
  ratio via the resolver and render its title into the preview (a
  `.seek-preview-chapter` line above the timestamp). Inert when no chapters (the
  preview already no-ops without a storyboard - the chapter line is additive and
  independently guarded so an item with chapters but no storyboard STILL shows the
  chapter name; verify that branch).
- Tests: hovered ratio in chapter N -> preview shows N's title; no chapters -> no
  chapter line; chapters-but-no-storyboard -> chapter line still shows.

## T5 - R3 persistent current-chapter title chip

- A JS-built `.chapter-now` chip (e.g. "› The main bit") near the bar, updated by
  the resolver dispatcher, shown only while the item has chapters and the bar is
  the live surface (hidden when docked / native / no chapters). Placement:
  reuse the control-strip area without disturbing the two-row mobile geometry -
  candidate is above the strip like `.seek-preview`, or a truncating chip in the
  bar; DECIDE by measuring the two-row bar (scar #7 / memory: CSS-var height
  arithmetic broke both form factors). Must ellipsize; must not push the bar.
- Tests: chip text = current chapter title, updates on index change, hidden when
  no chapters / docked, ellipsizes.

## Cross-cutting / invariants

- Census: colours via `--yt-red`, spacing/radius via tokens -> `lint:css` TOTAL 0.
  `width`/`min-width`/`max-height` are census-exempt (geometry). Keep ledger CLEAN.
- Reveal/clear TWO axes (recurring class): every "current" indicator has a CLEAR
  path (index -> -1 on teardown/close/no-chapters/docked). Test the CLEAR by
  populating first, then driving to the non-showing state.
- Reset on every load (`resetSeekVisual`/teardown): no previous item's chapter
  highlight/segments/chip linger.
- Docked: R1/R3/R4 all hidden (mirror the existing chapters-hidden-when-docked
  rule); R2's menu is already hidden when docked.
- Comment accuracy; no stale comments; every test lock mutation-verified (delete
  the target -> red).

## Task order & commits

T1 resolver+wiring -> T2 menu highlight -> T3 seek segments (big) -> T4 tooltip
name -> T5 title chip. Each its own green task commit. Then FULL two-reviewer
gate (adversarial briefed on: the seek-bar scar, the native-fill no-chapters
byte-identity, the docked/native/mobile-two-row state matrix, the reveal/clear
CLEAR axis, and the resolver's non-monotonic/live-mode edges), fix round(s),
dual-Node (v22.23.1 + v24.14.0), release, device pass pending.

## As-built notes (deviations from the plan above)

- **T3 approach changed to lowest-risk.** The plan considered neutralising the
  native track and drawing everything in the overlay. As built, the overlay draws
  ONLY the boundary gap notches; the native red `--seek-fill` is UNTOUCHED and
  still shows the current-chapter fill. And the overlay is an ABSOLUTE, out-of-flow
  child of `.player-controls` (NOT a wrapper around `#seek-bar`) -- wrapping would
  have moved `#seek-bar` out of the flex row and broken the mobile two-row `order`
  layout (the documented trap). A `ResizeObserver` keeps the overlay box aligned.
- **Hover-thicken DEFERRED + disclosed.** The YouTube bar-grows-on-hover fights the
  native range track across 4 era themes; it's the least-essential piece. The
  hover chapter-name tooltip (T4) is the hover deliverable. Revisit on-device.
- **T2 close-on-play:** only the `play` listener was repointed (to `closeSpeedMenu`)
  so the chapters menu survives play; `pause`/`seeking` still close it.
- **Segments + chip gate on >1 chapter** (a single "chapter" has no interior
  boundary and no portion to distinguish); the menu highlight + hover tooltip
  work for any chapter count.
- **Chip anchored `bottom: 100%`** (height-agnostic) instead of the measured
  offset the plan floated.
- Testing followed the repo convention (CONTRIBUTING.md: no player-boot jsdom
  harness): PURE helpers unit-tested (currentChapterIndex, markCurrentChapterItem
  incl. the CLEAR axis, chapterBoundaryPercents), DOM wiring source-locked.

## Dean's device-pass probes (final arbiter)

Desktop + mobile, a video WITH chapters: (1) seek bar shows segments with gaps,
the current chapter red, filling as you play; (2) hover shows the chapter name;
(3) open the chapters menu and watch the current row stay red and walk down as it
plays (menu no longer snaps shut on play); (4) the title chip near the bar names
your current chapter; (5) an item with NO chapters looks exactly as before; (6)
docked mini-player unchanged; (7) native iOS fullscreen video unaffected.
