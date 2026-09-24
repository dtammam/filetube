---
plan: desktop-theatre
harness: v2 · lean
branch: feat/desktop-theatre
anchor: spec
status: Building
next: D2 round built (sidebar collapses in desktop theatre, Architect ruling); Architect runs the gate (adversary + qa, attack surfaces: CSS / SPA client traps incl. the persistent-shell sidebar across routes, the glow constraint, the reserve + guide observer lifecycles); device check owed
design: Approved 2026-09-24 (Dean's intake, recorded in memory wave-2026-09-24-intake)
gate: pending
---

# Desktop theatre sized like YouTube (wave item 3)

Base: main ecb61e1d (= tag v1.318.0). One piece, one plan.

## The ask

Dean, 2026-09-23 (with four desktop screenshots, memory followup-desktop-theatre-ambient-wave
item 1): "YouTube's theatre view sizes the video so the title + channel + action row
(like/share/save/...) still shows at the bottom of the first screen. FileTube's theatre video
fills the viewport height, which pushes the title and action buttons below the fold", so "many
controls" go missing. On desktop FileTube must keep exposing them, and "the video's size and
centering should also match YouTube's theatre swap".

Wave intake (2026-09-24): watch page, desktop widths, theatre on; re-check the ambient glow at
the new size (the glow is sized from the player box) in dark mode; YouTube loads in this box's
headless Chromium, so sample it rather than ask for screenshots. Norms applied:
match-reference-component (measure the reference, side by side, never guess) and
button-layout-measurement (the action row is measured before/after; buttons never shrink).

Out of scope (brief): the default (non-theatre) layout, mobile layouts, the music view's theatre
(`.music-stage.is-theater`).

## Re-verified survey (at ecb61e1d, before any edit)

| Anchor | At ecb61e1d | Verdict |
|---|---|---|
| theatre class flip | watch.js `setupTheatreToggle` (was :2020; now :2084) toggles `.theater-mode` on `.watch-container`; init() applies the persisted `ft-theater` class synchronously at ANY width (was :854, now :878; only `#theater-btn` is hidden below 1025px, style.css `@media (max-width: 1024px)`) | verified; so a phone/tablet can carry the class, and the old rule reaches it |
| theatre layout | style.css `.watch-container.theater-mode` column stack + `.watch-sidebar` 100% (:8948, :8952) | verified, unchanged |
| theatre height cap | style.css v1.190 rule (now :8981): `#player-wrapper` width `min(100%, (100vh - header - space-16 - space-8 - 40px - 2px) * 16/9)`, not media-scoped | verified: at every measured size the column is narrower than that budget, so the player filled the column and the video filled the height |
| all-views cap | style.css `@media (min-width: 1025px) #player-slot:not(.reader-player-slot) #player-wrapper...` reading player.js's measured `--player-cap-h` (player.js `refreshPlayerHeightCap` :8313) | verified; lower specificity than the theatre rule on watch; untouched |
| wrapper box | `#player-wrapper:not(.audio-expanded)` `aspect-ratio: auto; padding-bottom: 40px` (:6745) + 1px border each side; `#media-player` `aspect-ratio: var(--media-aspect, 16 / 9)` (:6749); portrait pinned 16:9 (v1.34) | verified; a landscape 4:3 item is TALLER than 16:9 at the same width |
| glow geometry | `.watch-player-stage` relative / z-index 0 (:9095); `.ambient-glow` negative % insets of the STAGE (:9143) | verified; the glow is sized from the stage, which equalled the player only because the player filled the column |
| glow constraint lock | test/unit/ambient-glow-engine.test.js `stageAndGlowRules` sweeps EVERY rule whose selector names `watch-player-stage` (vendor spellings, case, sibling properties) | verified: any new stage rule is swept automatically |
| probe | scripts/action-row-probe.js: `--theatre` did a bare class flip, heights fixed at 844/900, no player box in the JSON | extended (below) |
| watch header / padding | `--header-h: 56px`, `.main-content` padding `--space-12` (24px), left sidebar 230px on desktop | verified by the probe: player top y 80 |

## Measurements

### YouTube theatre (the reference)

Method: session scratchpad `desktop-theatre-yt-probe.js` (the yt-cdp.js starter, extended):
Playwright chromium-1234 headless over raw CDP, DPR 1, logged out, cookies `PREF=f6=400` (dark)
and `wide=1` (theatre; `ytd-watch-flexy[theater][full-bleed-player]` confirmed on every run),
`/watch?v=dQw4w9WgXcQ`, 12s load, then the `<video>` played muted 6s and read. Rects are
`getBoundingClientRect` (x, y, w x h). Raw lines: `desktop-theatre/yt-theatre.jsonl`.

| Viewport | Masthead | Player band (`#full-bleed-container` = `#movie_player`) | Video (playing) | Title | Owner + action row | Row bottom to fold | Description top |
|---|---|---|---|---|---|---|---|
| 1280x720 | 0,0 1280x56 | 0,56 1280x551 | 150,56 980x551 | y 619 h 28 | y 655 h 42 | 23 | 709 |
| 1366x768 | 56 | 0,56 1366x599 | 151,56 1065x599 (an ad was showing; same rule) | 667 | 703 | 23 | 757 |
| 1440x900 | 56 | 0,56 1440x731 | 70,56 1300x731 | 799 | 835 | 23 | 889 |
| 1920x1080 | 56 | 0,56 1920x911 | 150,56 1620x911 | 979 | 1015 | 23 | 1069 |
| 1920x1200 | 56 | 0,56 1920x1031 | 44,56 1833x1031 | 1099 | 1135 | 23 | 1189 |

- Band height = `100vh - 169px` at every size (computed `height` = `max-height` = 551 / 599 /
  731 / 911 / 1031px), `min-height: 480px`, background `rgb(0, 0, 0)`, full viewport width.
  169 = the 56px masthead + 113px kept for the title (band + 12) and the owner/action row
  (band + 48, 42 tall), whose bottom sits 23px above the fold; the description peeks 11px.
- The video is 16:9 at the band height and centred on the VIEWPORT: x = (vw - w) / 2.
- Below the band: `#primary` from x 16, `#secondary` (related) BESIDE it (x 1028 w 412 at 1440),
  its top at band + 24. The guide sidebar is not shown on the watch page.
- Action buttons (1440): like 146x40, share 98x40, save 92x40, more 40x48.

### FileTube BEFORE (ecb61e1d) and AFTER, theatre on

Method: `scripts/action-row-probe.js <out> <WxH> --theatre --viewport-shot`, one Chromium per
viewport (session scratchpad `desktop-theatre-ft-run.sh`), the probe's seeded captioned item,
light theme, sidebar shown. BEFORE = this worktree before any app edit (only the probe itself
extended; the theatre flip was then the bare class add) for the five desktop viewports, and
FT_ROOT on a `git archive ecb61e1d` sandbox for the 390 / 1024 and 4:3 runs. "Fold gap" = viewport height
minus the bottom of the lowest action button; the bar's own bottom edge (its divider) is 12px
lower.

| Viewport | BEFORE player (x,y w x h) | BEFORE title y / buttons y / fold gap | AFTER player | AFTER reserve | AFTER title y / buttons y / fold gap | AFTER bar bottom to fold |
|---|---|---|---|---|---|---|
| 1280x720 | 254,80 1002x605 | 701 / 812 / **-124** | 397,80 717x444 | 173px (3-line bar) | 540 / 652 / 36 | 24 |
| 1366x768 | 254,80 1088x653 | 749 / 860 / **-124** | 397,80 802x492 | 173px | 588 / 700 / 36 | 24 |
| 1440x900 | 254,80 1162x695 | 791 / 862 / 6 (the bar divider 7px under the fold) | 281,80 1108x664 | 133px (2 lines) | 760 / 832 / 36 | 24 |
| 1920x1080 | 254,80 1642x965 | 1061 / 1098 / **-50** | 331,80 1488x878 | 99px (1 line) | 974 / 1011 / 37 | 24 |
| 1920x1200 | 254,80 1642x965 | 1061 / 1098 / 70 | 254,80 1642x965 (column-bound, unchanged) | 99px | 1061 / 1098 / 70 | 57 |

Video box (player minus the 40px bar and 2px border) vs YouTube: 1280x720 715x402 vs 980x551;
1366x768 800x450 vs 1065x599; 1440x900 1106x622 vs 1300x731; 1920x1080 1486x836 vs 1620x911.
FileTube's is smaller at every size because of FileTube's own chrome: the 24px content padding,
the 42px control strip under the picture (YouTube overlays its controls), the 16px gap, and at
1280/1366 the views-count and star lines (the bar wraps to three lines in the 1002/1088px
column). See D2 for the lever that recovers most of it.

**Sidebar collapsed** (`--sidebar-collapsed`: the real `#menu-toggle` click AFTER theatre is on,
no theatre click - the reserve follows through its ResizeObserver alone):

| Viewport | reserve | player | centre x | buttons y / fold gap |
|---|---|---|---|---|
| 1280x720 | 173 -> 99px | 216,80 848x518 | 640 = viewport centre | 651 / 37 |
| 1366x768 | 99px | 216,80 934x566 | 683 = viewport centre | 699 / 37 |
| 1440x900 | 99px | 136,80 1168x698 | 720 | 831 / 37 |
| 1920x1080 | 99px | 216,80 1488x878 | 960 | 1011 / 37 |

**4:3 item** (`PROBE_MEDIA_WH=640x480`, player.js sets the real `--media-aspect`):

| Viewport | BEFORE player / picture / fold gap | AFTER player / picture / fold gap |
|---|---|---|
| 1280x720 | 1002x792 / 1000x750 / **-312** | 717x444 / 715x402 (pillarboxed) / 36 |
| 1920x1080 | 1642x1272 / 1640x1230 / **-357** | 1488x878 / 1486x836 / 37 |

**Unchanged surfaces** (BEFORE vs AFTER, every box identical to the pixel; the only difference
is the unused `--watch-theatre-reserve` value written on the container):
theatre OFF at 1280x720, 1366x768, 1440x900, 1920x1080, 1920x1200; phone 390x844 and tablet
1024x768 with theatre ON (the persisted class) and OFF. The music view has no edited rule.

**Action row (button norm):** `desktop-theatre-btndiff.js` over the probe JSON, BEFORE vs AFTER
theatre at all five viewports: 10 visible buttons each, 0 deformed (every w/h identical: listen
81x32, like 69x32, share 78x32, transcript 104x32, queue 86x32, next 75x32, download 103x32,
delete 81x32, move 75x32, watched 126x32), 0 wraps (relative y within 1px rounding), rows 1 -> 1.
Theatre OFF and 390/1024: 0 deformed, 0 wraps.

### Ambient glow at the new size (dark, ambient ON, a real playing VP9 webm)

Method: session scratchpad `desktop-theatre-glow-probe.js`: this tree / the ecb61e1d sandbox,
`ft-mode` dark, `ft-ambient` 1, `ft-theater` 1 persisted (the cold-load path), a two-colour
poster (left magenta [208,32,144], right teal [32,192,208]), the video played muted 5s, then the
rects and screenshot pixels (x at the player's 40% height). Page colour [18,18,18].

| | 1280x720 BEFORE | 1280x720 AFTER | 1920x1080 BEFORE | 1920x1080 AFTER |
|---|---|---|---|---|
| lit / opacity / filter / transform | yes / 0.3 / none / none | same | same | same |
| player = stage | 1002x604.5 = yes | 787.8x484 = yes | 1642x964.5 = yes | 1488.2x878 = yes |
| glow vs player (dx, dy, w, h) | .12 .22 1.24 1.44 | .12 .22 1.24 1.44 | same | same |
| 5 / 25 / 50 / 100 px LEFT | [70,18,51] [56,18,42] [41,18,33] [20,18,19] | [69,18,51] [51,18,39] [34,18,28] [18,18,18] | [71,18,52] [63,18,47] [52,18,40] [35,18,29] | [71,18,52] [62,18,46] [51,18,39] [32,18,27] |
| 5 / 25 / 50 / 100 px RIGHT | [18,65,69] / off-screen | [18,63,68] [18,48,51] [18,32,33] [18,18,18] | [18,66,71] / off-screen | [18,66,70] [18,57,61] [18,47,50] [18,30,31] |
| 5px above / below | [43,43,62] / [42,43,61] | [42,43,61] / [42,43,60] | [44,43,62] / [44,43,62] | [43,44,62] / [43,44,62] |

The glow tracks the new box exactly (the stage now carries the width, so the stage IS the
player) and, the player no longer touching the viewport's right edge, the right side is now
visible. At 1280x720 (the fixture item has no Transcript button: a 2-line bar, reserve 133px)
the bar bottom sits 23.4px above the fold with the glow on. A short window (1280x400, the 480px
floor binds): player = stage = 480 wide, glow .12/.22/1.24/1.44, lit. No page errors on any run.

Pre-existing, NOT theatre (tracker #247): the default view at 2560x1080 sizes the glow from a
stage wider than the capped player (dx .1837, w 1.3673).

### Screenshots (session scratchpad `desktop-theatre/`)

- Side by side YouTube | FileTube BEFORE | FileTube AFTER, theatre: `sbs/desktop-theatre-sbs-1280x720.png`,
  `-1366x768`, `-1440x900`, `-1920x1080`, `-1920x1200`.
- Raw: `desktop-theatre-yt-<WxH>.png`, `ft-before-theatre/viewport-<WxH>-theatre.png`,
  `ft-after2-theatre/viewport-<WxH>-theatre.png`; theatre off `ft-{before,after}-default/`.
- Glow BEFORE | AFTER (dark): `sbs/desktop-theatre-glow-sbs-1280x720.png`, `-1920x1080.png`.
- 4:3 BEFORE | AFTER: `sbs/desktop-theatre-4x3-sbs-1280x720.png`.
- (The r0 AFTER shots above were taken with the sidebar shown; the D2 round below re-shot every
  side by side with the D2 build: `ft-d2-theatre/` is the AFTER column now.)

## Design

FileTube's equivalent of YouTube's `100vh - 169px`: on desktop (1025px+) with theatre on, the
video's height budget is

    100dvh - header (56) - content top padding (24) - control strip + border (42)
           - the MEASURED room the title + whole action bar take below the player
           - 23px (YouTube's measured fold margin)

and the player is that height at 16:9, centred in the column, never wider than the column,
never narrower than 480px.

- **The width lives on the STAGE** (`.watch-container.theater-mode .watch-player-stage`), with
  the wrapper at `width: 100%`: the stage box IS the player box, so the glow (sized from the
  stage) stays on the player. Putting it on the wrapper would leave the stage at column width
  and the glow's bright inner edge at the column's edge.
- **The reserve is measured, not fixed** (`--watch-theatre-reserve`, fallback 98px = the
  one-line room): FileTube's bar wraps with the column (99px at 1920, 133px at 1440, 173px at
  1280/1366) and a title can take two lines. watch.js `theatreReservePx` (pure: bar bottom minus
  stage bottom, rounded up; null for an empty stage) and `setupTheatreReserve` (a ResizeObserver
  on the stage, the bar and the title; the write deferred to the next frame so it is never a
  same-frame observer loop; the theatre click re-measures synchronously so the first theatre
  frame already fits; disconnected on the view's signal). The reserve does not depend on the
  player's height, so writing it back cannot loop.
- **The picture is capped at the same budget** (`#media-player` `max-height`): a 4:3 item
  pillarboxes instead of growing past it (YouTube's fixed-height box, letterboxed picture).
- **Below 1025px nothing changes**: the old v1.190 rule stays byte-identical for a phone or a
  tablet carrying the persisted class.

### Decisions (Architect ruling 2026-09-24 on Dean's "match YouTube's theatre geometry"; Dean asleep)

- **D1 - NOT adopted: no black full-bleed band.** YouTube's theatre paints a black band edge to
  edge. FileTube keeps the page colour beside a bordered player (the v1.190 choice): a band would
  hide the ambient glow's sides and fight the era skins. Adoptable later as a paint-only change.
- **D2 - ADOPTED: the left sidebar collapses while theatre is on (desktop).** YouTube's watch
  page shows no guide in theatre. Built in the D2 round below.
- **D3 - out of scope: the related list stays stacked BELOW** (YouTube puts it beside the title,
  below the band). A structural change to `.watch-container`; not attempted.
- **D4 - kept: a 480px WIDTH floor, not YouTube's 480px HEIGHT floor.** YouTube's floor would put
  the row back under the fold at 1280x720 and 1366x768 once FileTube's taller bar wraps (the
  sidebar reopened by hand: 3-line bar, 173px reserve); the width floor only binds on very
  short windows (1280x400 measured: 480 wide, row below the fold there).

## Acceptance criteria

| AC | Criterion | Bound by |
|---|---|---|
| AC1 | Desktop theatre at 1280x720 / 1366x768 / 1440x900 / 1920x1080 / 1920x1200: the title and every action button sit above the fold (bar bottom 24px above it where height-bound, YouTube 23) | probe (Measurements); theatre-mode.test.js "the STAGE carries the YouTube-matched width" |
| AC2 | The player is 16:9 at the budget, centred in the column, column-bound when narrower, never under 480px; the stage IS the player box | probe; theatre-mode.test.js stage + wrapper tests |
| AC3 | The reserve follows the column/title: observer + next-frame write, synchronous on the theatre click, torn down with the view, on BOTH ?v= and ?tv= | watch-init-behavioral.test.js three v1.319 reserve tests; theatreReservePx units; probe `--menu-toggle` (99 -> 173 with no theatre click) |
| AC4 | A taller-than-16:9 landscape item is capped at the SAME budget | 4:3 probe table; theatre-mode.test.js "the PICTURE is capped at the SAME budgeted height" (term-for-term equality) |
| AC5 | The ambient glow paints around the new box in dark mode, with no filter / transform / mask / will-change / contain / isolation on any stage rule | glow probe table; the existing ambient-glow-engine sweep (covers the new stage rule, every vendor spelling) |
| AC6 | Unchanged: theatre off (5 viewports), phone 390x844 and tablet 1024x768 (theatre on and off), music theatre; no action button deforms or wraps | probe diff (Measurements); theatre-mode.test.js "ONLY inside the 1025px+ block" |
| AC7 | The probe measures theatre at real monitor shapes: `WxH`, `--viewport-shot`, `--menu-toggle`, `PROBE_MEDIA_WH`, the real `#theater-btn` click, the reserve, the sidebar state and player/picture/stage/glow boxes, a settle poll that waits out the sidebar slide | the Measurements were taken with it |
| AC8 (D2) | Desktop theatre ON collapses an OPEN sidebar (init() itself on a cold theatre load, and the theatre click); theatre OFF, leaving the watch view, and narrowing below 1025px restore it; a watch -> watch hop keeps it; a hand toggle is the user's; a sidebar the user closed is never opened; no storage key is written | watch-init-behavioral.test.js five "v1.319 D2" tests (real init, live jsdom shell elements); theatre-mode.test.js three theatreGuide tests; probe D2 tables |

## Build record

- `public/css/style.css`: the desktop theatre block after the v1.190 rule (stage width, wrapper
  fill, picture cap), the v1.190 comment corrected (the class does reach sub-1025px widths).
- `public/js/watch.js`: `theatreReservePx` (module scope, exported), `setupTheatreReserve` and
  its call from `setupTheatreToggle`, the synchronous re-measure in the theatre click.
- `scripts/action-row-probe.js`: the AC7 instrument upgrades (backward compatible: bare widths
  keep their old heights, file names and JSON keys).
- `test/unit/theatre-mode.test.js`: 5 new tests (the pure reserve x2, stage width, wrapper,
  picture cap). `test/unit/watch-init-behavioral.test.js`: 3 new tests (executed init, ?v= and
  ?tv=).
- `docs/exec-plans/tech-debt-tracker.md`: #247.
- D2 round: watch.js `THEATRE_GUIDE_ATTR` + `theatreGuideCollapse` / `theatreGuideRestore` /
  `theatreGuideRelease` (module scope, exported) and `wireTheatreGuide` / `syncTheatreGuide` in
  init (called after the sync theatre-class apply and from `applyTheatreState`); the probe's
  `--sidebar-collapsed` became `--menu-toggle` (theatre now collapses the bar, so the flag
  reopens it by hand), plus `sidebarHidden` / `theatreGuide` / `#sidebar` in the JSON and the
  animation-aware settle; tests: theatre-mode.test.js +3 (jsdom), watch-init-behavioral.test.js
  +5 (the realm now also returns its `win` / `doc` shims).

Findings on the way: the first cut measured only from the observer; under the probe's software
GL the class flip painted at the non-theatre reserve (133px) for more than 300ms, which led to the
synchronous re-measure in the click (and the probe now clicks the real button and polls for the
settled reserve). A first scheduling shape (`raf = requestAnimationFrame(measure)` with measure
resetting it) stuck under a synchronous rAF; replaced by a `queued` flag.

## D2 round (Architect ruling: collapse the sidebar in desktop theatre)

### Mechanism (re-verified before the edit)

- The sidebar's ONLY writer is common.js's header `#menu-toggle` click (common.js:15385-15400):
  it flips `.sidebar.hidden` + `.sidebar.mobile-open` + `.main-content.expanded` together. No
  storage key holds the sidebar state anywhere (grep: no `localStorage` / `sessionStorage` use
  for it; the only other `expanded` writer is the description box). The sidebar and
  `#main-content` live in the persistent shell, outside `#view-root`.
- **Existing mechanism picked: the menu toggle's class trio.** Collapsing flips the same three
  classes; a hand toggle while in theatre therefore reopens the bar exactly as it always does:
  it PUSHES the content (`.main-content` margin-left back to `--sidebar-w`), it never overlays.
  The theatre stage then re-centres in the narrower column and the reserve re-measures (3-line
  bar at 1280: 173px, the r0 geometry).
- **Theatre-scoped state only:** `body[data-theatre-guide="<owner>"]` means "theatre collapsed
  it, for this watch view". Module helpers `theatreGuideCollapse` / `theatreGuideRestore` /
  `theatreGuideRelease` (watch.js, exported, pure over a document). Rules: an open bar collapses
  and is owned; an already-owned bar is re-claimed (watch -> watch); a bar the USER had
  collapsed is left alone and owned by nobody (theatre off never opens it); restore acts only
  for the owner and only while owned; a hand `#menu-toggle` click releases ownership (the user's
  choice stands at theatre off).
- **Wiring (`wireTheatreGuide` / `syncTheatreGuide` in init):** synchronously right after init()
  applies the persisted theatre class (a cold theatre load never shows the bar sliding in then
  out), on every theatre click (`applyTheatreState`), and on a `(min-width: 1025px)` crossing
  (both ways). The desktop gate is the theatre button's own breakpoint. On the view's abort the
  restore is deferred one microtask: the router runs `destroy()` -> swap -> the next `init()` in
  one synchronous pass (common.js swapToView), so a watch -> watch hop re-claims before the
  check, and any other route restores. The menu-toggle and media-query listeners are bound on
  the view signal.

### Measurements (D2 build, live tree; `ft-d2-*`, `glow-d2`)

Theatre on, sidebar collapsed by theatre (every run: `sidebarHidden` true, `data-theatre-guide`
"w1"), same method as above:

| Viewport | Player (x,y w x h) | Video | YouTube video | Video vs YouTube (w) | reserve | title y / buttons y / fold gap | bar bottom to fold (YouTube 23) |
|---|---|---|---|---|---|---|---|
| 1280x720 | 216,80 848x518 | 846x476 | 980x551 | 86% | 99px (1 line) | 614 / 651 / 37 | 24 |
| 1366x768 | 216,80 934x566 | 932x524 | 1065x599 | 88% | 99px | 662 / 699 / 37 | 24 |
| 1440x900 | 136,80 1168x698 | 1166x656 | 1300x731 | 90% | 99px | 794 / 831 / 37 | 24 |
| 1920x1080 | 216,80 1488x878 | 1486x836 | 1620x911 | 92% | 99px | 974 / 1011 / 37 | 24 |
| 1920x1200 | 109,80 1702x998 | 1700x956 | 1833x1031 | 93% | 99px | 1094 / 1131 / 37 | 24 |

- Centring: player centre x = 640 / 683 / 720 / 960 / 960 = the viewport centre at every size
  (YouTube's video is centred on the viewport too). r0 (sidebar shown) centred in the column,
  115px right of the viewport centre.
- The remaining gap to YouTube is FileTube's chrome: the 42px control strip under the picture
  (YouTube overlays its controls), the 24px content padding and FileTube's taller bar (views line
  + 32px buttons + divider: 99px vs YouTube's 90px incl. title).
- 1920x1200 is now height-bound too (the column grew to 1872 > the budget width): fold gap 70 ->
  37 like every other size.
- Action row vs BEFORE: 10 buttons at each viewport, 0 deformed, 0 wraps, rows 1 -> 1.
- Hand reopen in theatre (`--menu-toggle`): the bar pushes the content back (main x 230), the
  reserve follows with no theatre click (99 -> 173 at 1280x720), player 717x444 / 1488x878 = the
  r0 geometry exactly, fold gap 36 / 37, `data-theatre-guide` released (null), bar open.
- 4:3 item (`PROBE_MEDIA_WH=640x480`): 1280x720 player 848x518, picture 846x476 (pillarboxed),
  fold gap 37; 1920x1080 1488x878 / 1486x836, 37.
- Unchanged vs BEFORE: theatre off at the five desktop viewports, 390x844 and 1024x768 with
  theatre on (the persisted class, below the breakpoint: no collapse) and off - every player,
  stage, title, bar and button box identical, 0 deformed, 0 wraps. (The only differing numbers
  are the related rail's height, a fetch-timing difference below the fold.)
- Instrument finding: under software GL the sidebar slide / margin-left transition sometimes
  started a second late and the r0 settle poll (reserve consistent with the CURRENT layout)
  exited mid-transition, reading a 3-line bar (1 run in 4, the 4:3 1280 case). Proven a timing
  artefact (the same run read 99px / 45px bar after a 4s wait, 4 of 4); the probe's settle now
  also waits for no running animation on `#sidebar` / `#main-content` (4 of 4 then read 99px).

Ambient glow, dark, ambient on, real playing webm, theatre persisted (the cold-load collapse):

| Viewport | lit / opacity / filter / transform | player = stage | glow vs player | 5 / 25 / 50 / 100 px LEFT | RIGHT | 5px above / below | errors |
|---|---|---|---|---|---|---|---|
| 1280x720 | yes / 0.3 / none / none | 848.2x518 yes | .12 .22 1.24 1.44 | [70,18,51] [53,18,41] [36,18,30] [18,18,18] | [18,64,69] [18,49,53] [18,34,36] [18,18,18] | [43,43,61] / [42,43,61] | 0 |
| 1366x768 | same | 933.5x566 yes | .12 .22 1.24 1.44 | [70,18,51] [55,18,42] [39,18,31] [19,18,19] | [18,64,69] [18,51,54] [18,36,38] [18,19,19] | [43,43,62] / [42,43,61] | 0 |
| 1440x900 | same | 1168.2x698 yes | .12 .22 1.24 1.44 | [71,18,52] [58,18,44] [45,18,35] [24,18,22] | [18,65,70] [18,54,58] [18,42,44] [18,23,24] | [44,43,62] / [43,43,61] | 0 |
| 1920x1080 | same | 1488.2x878 yes | .12 .22 1.24 1.44 | [71,18,52] [62,18,46] [51,18,39] [32,18,27] | [18,66,70] [18,57,61] [18,47,50] [18,30,31] | [43,44,62] / [43,44,62] | 0 |
| 1920x1200 | same | 1701.5x998 yes | .12 .22 1.24 1.44 | [71,18,52] [63,18,47] [53,18,40] [36,18,30] | [18,66,71] [18,58,62] [18,50,53] [18,34,36] | [44,43,62] / [44,43,62] | 0 |

Left and right are symmetric at every size (the player is centred on the viewport now, and the
sidebar that used to sit under the left bloom is gone). `scrollWidth` exceeds the viewport at
1440 (1444) and 1920x1200 (2015) while the glow runs: the glow box overflowing past the viewport,
clipped by the root `overflow-x: clip` (no horizontal scroll; the base had 1376 at 1280 and 2093
at 1920x1080, the v1.318 plan measured scrollX 0 under a real wheel).

Screenshots (session scratchpad `desktop-theatre/sbs/`): YouTube | BEFORE | AFTER (D2)
`desktop-theatre-sbs-<WxH>.png` for all five; glow BEFORE | AFTER (D2)
`desktop-theatre-glow-sbs-1280x720.png` / `-1920x1080.png`; 4:3 BEFORE | AFTER
`desktop-theatre-4x3-sbs-1280x720.png`; theatre | theatre + hand reopen
`desktop-theatre-menutoggle-sbs-1280x720.png`.

## Confirmation at the committed sha (894b25bd)

- Theatre probe re-run with FT_ROOT on a `git archive 894b25bd` sandbox (session scratchpad
  `desktop-theatre/ft-final-894b25bd-theatre/`): every box identical to the AFTER table above
  (1280x720 player 717x444, picture 715x402, reserve 173px, buttons y 652, fold gap 36; ...
  1920x1200 column-bound 1642x965). Button diff vs BEFORE: 10 buttons at each of the five
  viewports, 0 deformed, 0 wraps, rows 1 -> 1.
- Toggle axes on a POPULATED theatre (dark, ambient on, playing, 1280x720, the real
  `#theater-btn` clicked off then on): ON player = stage 787.8x484, glow .12/.22/1.24/1.44 lit;
  OFF `theater-mode` gone, aria-pressed false, `ft-theater` "0", player = stage 598x377.3 (the
  theatre-off geometry to the pixel), glow 741.5 wide (= 598 x 1.24), bar at 510.4; ON AGAIN
  identical to ON (787.8x484, bar 617.2). No page errors (no ResizeObserver loop error).
- Unchanged surfaces re-run at 894b25bd (`ft-final-894b25bd-{default,small-theatre,small-default}`
  vs the BEFORE runs): theatre off at the five desktop viewports, and 390x844 / 1024x768 with
  theatre on and off - every player, stage, title, bar, star and button box identical; button
  diff 0 deformed, 0 wraps everywhere. The only differing numbers: the BEFORE probe had no
  `#media-player` box yet, and at 390 theatre-off the related rail (below the fold) had loaded
  in the later run (`.watch-sidebar` 497 vs 50 tall), a fetch-timing difference, not layout.
- Pre-commit hook (the whole unit suite, Node 22.23.1): tests 7109, pass 7109, fail 0.

## Mutant table

Unit mutants: session scratchpad `desktop-theatre-mutants.py` on a fresh copy of the
`git archive 894b25bd` sandbox per mutant; a mutant is credited only with a non-empty diff and a
red test. 23 of 23 killed.

| # | Mutant | Killed by |
|---|---|---|
| C1 | dvh width drops the 23px fold margin | theatre-mode "STAGE carries the YouTube-matched width" + "PICTURE is capped at the SAME budget" |
| C2 | the dvh width line deleted (vh only) | same two |
| C3 | the vh width drops the measured reserve | same two |
| C4 | the reserve fallback 98px -> 60px | same two |
| C5 | a stage rule outside the 1025px block | "ONLY inside the 1025px+ block" |
| C6 | the wrapper fill rule removed | "the wrapper FILLS the stage" (and probe P2 below) |
| C7 | the picture cap's budget drifts (dvh loses the 23px) | "PICTURE is capped at the SAME budget" |
| C8 | the picture cap removed | same |
| C9 | no `margin-inline: auto` on the stage | "STAGE carries..." |
| C10 | `-webkit-transform: translateZ(0)` on the new stage rule | ambient-glow-engine "v1.312 CSS LOCK" (the existing sweep reaches the new rule) |
| C11 | `Isolation: isolate` (mixed case) on the new stage rule | same |
| J1 | `Math.round` for `Math.ceil` | "theatreReservePx: ... rounded UP" |
| J2 | an empty stage accepted | "no reading (null) ... EMPTY stage" + behavioral "?v= observes ... writes one frame later" |
| J3 | a negative reading returned | "no reading (null) ..." |
| J4 | `setupTheatreReserve` never called | all three behavioral tests (?v= x2, ?tv=) |
| J5 | the click does not re-measure | behavioral "the theatre CLICK re-measures synchronously" |
| J6 | the observer writes inside its own callback | behavioral "?v= observes..." + "CLICK..." |
| J7 | no coalescing | behavioral "?v= observes..." (two notifications -> ONE frame) |
| J8 | the title not observed | behavioral "?v= observes..." |
| J9 | the bar not observed | behavioral "?v= observes..." |
| J10 | no disconnect on abort | behavioral "CLICK ... destroy() disconnects" |
| J11 | a frame queued before abort still writes | same |
| J12 | the wrong custom property written | all three behavioral tests |

Probe mutants (behavioural evidence for the glow claim; session scratchpad
`desktop-theatre-probe-mutants.sh`, glow probe, dark, ambient on, playing):

| # | Mutant | Committed | Mutant |
|---|---|---|---|
| P1 | the width on the WRAPPER, the stage left at column width (1920x1080) | player = stage 1488.2, glow dx .12 w 1.24 | stage 1642 vs player 1488.2, glow dx .184 w 1.368: the glow's inner edge off the player |
| P2 | the wrapper fill rule removed (1280x400, the floor binds) | player = stage 480, glow .12 / 1.24 | player 451.5 inside a 480 stage (the v1.190 budget wins), glow dx .159 w 1.318 |

### Instruments

- Targeted suites while building (ambient*, watch*, theatre*, music-theater-toggle,
  music-ambient, critter-mode, shell*, *parity*): tests 464, pass 464, fail 0 (before the
  picture cap and its test; theatre-mode 14/14 and watch-init-behavioral 24/24 after).
- `npm run lint:css`: TOTAL 0. `node scripts/overlay-containment-lint.js --enforce`: clean (0
  violations). eslint on watch.js, the probe and both test files: exit 0.
- No new script, no new shell markup (shell parity untouched), no registry entry.

## Disclosed gaps

- FileTube's theatre video is smaller than YouTube's at every size (the chrome listed under
  Measurements); D2 recovers most of it and is Dean's call.
- The observer path (a resize, a sidebar toggle) paints one frame at the previous reserve before
  the deferred write; only the theatre click is synchronous.
- On a window under ~480px of usable height the 480px floor wins and the row goes below the fold
  (D4).
- Tracker #247 (default view, very wide monitor, glow sized from the stage): pre-existing, out of
  scope.
- Not device-checked: headless Chromium only. Dean's desktop check owed (theatre at his monitor
  size, light and dark, ambient on, a 4:3 TV episode).
