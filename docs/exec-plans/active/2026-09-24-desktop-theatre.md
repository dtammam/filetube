---
plan: desktop-theatre
harness: v2 · lean
branch: feat/desktop-theatre
anchor: spec
status: Gate:CHANGES r1 @13f331d2
next: gate r1 fixes built @4b893ba8 (W1 tv reserve, W2 breakpoint binding, W3 wide items, W4 -> ruling D5 disclosed, S5/S6 + the qa suggestions); Architect re-engages the seats for r2 delta confirmation; device check owed
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
| theatre class flip | watch.js `setupTheatreToggle` (was :2020; :2221 at 4b893ba8) toggles `.theater-mode` on `.watch-container`; init() applies the persisted `ft-theater` class synchronously at ANY width (was :854; :964 at 4b893ba8, followed by `wireTheatreGuide()` :973; only `#theater-btn` is hidden below 1025px, style.css `@media (max-width: 1024px)`) | verified; so a phone/tablet can carry the class, and the old rule reaches it |
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

**Sidebar collapsed** (r0, before D2, with the r0 probe flag `--sidebar-collapsed`: the real
`#menu-toggle` click AFTER theatre is on, no theatre click - the reserve follows through its
ResizeObserver alone; since D2 theatre collapses the bar itself and the flag is `--menu-toggle`,
which REOPENS it):

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
- **D5 - ruled (Architect, gate r1): the reserve stops at the ACTION ROW; the channel row is
  NOT kept on the first screen.** Dean's words were "title + channel + action row"; YouTube's
  channel shares its action row (#owner y 655 h 42 at 1280x720), FileTube's is a separate
  panel (`.uploader-info-panel`: avatar, channel name, Subscribe) below the action bar. Dean's
  emphasis was the controls, and the channel costs picture. MEASURED (the fix tree with the
  reserve run through the panel instead, `sandbox-d5alt`, glow probe, theatre on): 1280x720
  video 846x476 -> 686x386 (reserve 99 -> 189px, the panel 23.8px above the fold); 1920x1080
  1486x836 -> 1326x746. Today the panel sits 66.2px below the fold (the channel name link 42.1px
  below). Alternative for Dean: run the reserve through the channel panel (one line in
  theatreReserveTargetRect), or fold the channel into the action row like YouTube (a layout
  change). A TV episode has no action bar, so its SHOW row (the episode's channel) IS its
  controls row and is kept on screen (gate r1 W1).

## Acceptance criteria

| AC | Criterion | Bound by |
|---|---|---|
| AC1 | Desktop theatre at 1280x720 / 1366x768 / 1440x900 / 1920x1080 / 1920x1200: the title and every action button sit above the fold (bar bottom 24px above it where height-bound, YouTube 23); on a TV episode the show row does. The CHANNEL panel below a video's action bar is NOT included, by ruling D5 | probe (Measurements, r1 fix table); theatre-mode.test.js "the STAGE carries the YouTube-matched width" |
| AC2 | The player is 16:9 at the budget, centred in the column, column-bound when narrower, never under 480px; the stage IS the player box | probe; theatre-mode.test.js stage + wrapper tests |
| AC3 | The reserve follows the column/title: observer + next-frame write, synchronous on the theatre click, torn down with the view, on BOTH ?v= (to the action bar) and ?tv= (to the show row: the bar is display:none there) | watch-init-behavioral.test.js v1.319 reserve tests (the ?tv= one drives the REAL hidden bar, red on 13f331d2); theatreReservePx / theatreReserveTargetRect units; probe `--menu-toggle` (99 -> 173 with no theatre click); the ?tv= Chromium table (r1 fix) |
| AC9 (r1) | An item WIDER than 16:9 keeps its width (the stage takes its aspect, still column-capped); 16:9, 4:3 and portrait keep the 16:9 box | theatre-mode.test.js theatreWidthAspect + stage TERM; watch-init-behavioral "r1 theatre aspect"; the 21:9 table (r1 fix) |
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

### D2 confirmation at the committed sha (fcede744)

- Pre-commit hook (the whole unit suite, Node 22.23.1): tests 7117, pass 7117, fail 0.
  Targeted before the commit (ambient*, watch*, theatre*, music-theater-toggle, music-ambient,
  critter-mode, shell*, *parity*, tech-debt / exec-plans / docs censuses): 485 / 485.
  `lint:css` TOTAL 0; overlay-containment clean; eslint exit 0.
- Real Chromium on an archive sandbox of fcede744 (glow probe + `NAV_AWAY`, dark, ambient on,
  playing, 1280x720, theatre persisted): theatre OFF by the real button -> the sidebar back
  (player 598x377.3 at x 254, the theatre-off geometry), ON again -> collapsed (848.2x518,
  bar at 24,651.2); SPA nav to `/` via `FileTube.navigate` -> `data-view` home, sidebar
  `sidebar`, main `main-content`, margin-left 230px, `data-theatre-guide` gone; `history.back()`
  to the watch page -> collapsed again, owned by the new view ("w2"); no storage key matching
  side / guide / menu / collapse at any step; no page errors.

### D2 guard mutants (fcede744 sandbox, `desktop-theatre-mutants-d2.py`): 14 of 14 killed

| # | Mutant | Killed by |
|---|---|---|
| G1 | theatre OFF never restores | D2 "theatre ON ... theatre OFF restores" + "crossing the desktop breakpoint" |
| G2 | no nav-away restore (abort hook removed) | D2 "leaving the watch view (destroy) restores" |
| G3 | nav-away restore synchronous | same (the watch -> watch hop re-opens the bar) |
| G4 | restore ignores the owner | theatreGuide owner + re-claim units; D2 "leaving the watch view" |
| G5 | collapse takes over a USER-collapsed bar | theatreGuide "USER collapsed ... left alone"; D2 "USER collapsed ... never opened"; D2 "HAND toggle" |
| G6 | a hand toggle does not release | D2 "HAND toggle" |
| G7 | theatre writes `localStorage['ft-sidebar-collapsed']` (a persisted pref) | D2 "theatre ON ..." (the storage-write spy) |
| G8 | collapse skips `mobile-open` (the trio desyncs from the menu toggle) | theatreGuide trio units; D2 tests x4 |
| G9 | no desktop gate | D2 "theatre ON below it never collapses" |
| G10 | no breakpoint-crossing listener | D2 "crossing the desktop breakpoint" |
| G11 | the theatre click does not re-sync | D2 "theatre ON ... OFF restores ... ON again" |
| G12 | init does not collapse (click-only) | D2 "theatre ON (persisted) collapses ... in init() itself" + two more |
| G13 | the #menu-toggle listener not bound on the view signal | D2 "HAND toggle ... the listener dies with the view" |
| G14 | restore drops the marker but leaves the classes | theatreGuide units; D2 tests x3 |

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
- D2: the collapse and the restore animate with the existing sidebar slide (`--dur-fast`, 0.15s);
  on a cold theatre load the bar is collapsed in init(), after the shell's first paint, so a
  slow device may show the bar for a frame before it slides out. The reserve follows the slide
  through the observer (a frame or two at the pre-slide reserve after a click).
- D2: the theatre-scoped marker lives on `<body>` in the persistent shell; if a view teardown
  never ran, the bar would stay collapsed on the next page - still reopenable by hand, never
  persisted (a reload restores it).
- D5 (ruling): the channel panel below a video's action bar stays below the fold (66.2px at
  every height-bound size); keeping it would cost ~90px of picture height (measured above).
- Browser zoom: 125% on a 1280-wide window is a 1024 CSS px viewport, below the 1025px desktop
  breakpoint, so neither the YouTube-matched theatre nor the sidebar collapse applies there (the
  v1.190 rule; adversary measured the bar 209px below the fold at 1024x576). By construction.
- D2: a sidebar the user hand-reopened in theatre is collapsed again by the NEXT watch view (a
  watch -> watch hop, autoplay-next): the hand toggle released theatre's ownership, and the new
  view reads an open bar as "collapse it". YouTube-like; the hand choice lasts for that view.
- Not device-checked: headless Chromium only. Dean's desktop check owed (theatre at his monitor
  size, light and dark, ambient on, a 4:3 TV episode).

## Gate r1 - qa (@13f331d2)

Instruments (run by this seat at 13f331d2, Node 22.23.1):

- Targeted: theatre-mode, watch-init-behavioral, ambient-glow-engine, ambient-host, music-ambient,
  watch-chrome-ambient, css-token-lint, overlay-containment, comment-debt-census, exec-plans-census,
  tech-debt-census: tests 168, pass 168, fail 0.
- `npm run test:unit`: tests 7117, pass 7117, fail 0, skipped 0.
- `npm run lint:css`: TOTAL 0. `node scripts/overlay-containment-lint.js --enforce`: clean (0
  violations), exit 0. eslint on watch.js, the probe and both test files: exit 0. `npm run lint`:
  0 errors, 7 warnings, all in common.js and identical at ecb61e1d (none new).
- Probe on a `git archive 13f331d2` sandbox (session scratchpad, not /tmp): `1280x720 --theatre`
  (via click): player = stage 216,80 848x518, picture 846x476, reserve 99px, sidebar hidden, guide
  "w1", title y 614, buttons y 651, fold gap 37, bar bottom to fold 24, 10 buttons, 1 row.
  `1920x1080 --theatre`: 216,80 1488x878, picture 1486x836, 99px, title 974, buttons 1011, gap 37,
  bar 24, 10 buttons, 1 row. Both match the D2 table exactly. Bare `1280` (no flag): tag `1280`, vh
  900, file `action-bar-1280.png`, theatre false, sidebar open - the old flag/height/name contract
  holds. Tracker #247 re-measured at 2560x1080 default: wrapper 341 w 1703, stage 254 w 1878 -
  confirmed.
- Reviewed and refuted: the cascade (the desktop wrapper rule (2,5,0) beats the all-views cap
  (2,4,0) and follows the equal-specificity v1.190 rule; the picture cap (3,5,0) never reaches
  staged fullscreen because the host is reparented into `#fs-stage`, outside `#player-slot`); the
  budget arithmetic (bar bottom = 100vh - 23px, the probe's 24 is the ceil); the vh-then-dvh order;
  the router's destroy -> swap -> init being one synchronous pass (common.js swapToView :10536),
  so the microtask restore is sound; `#menu-toggle` being the only sidebar-class writer.
- Security: no security surface. No server, route, auth, storage or network change; the body
  attribute value is a generated `w<n>`; no innerHTML; the probe's new env inputs
  (`PROBE_MEDIA_WH`, `PROBE_SETTLE_MS`) are regex-/Number-parsed dev-tooling knobs.

Findings:

1. **WARNING - the ?tv= reserve is inert in production, and its test binds a shape the tv path
   never produces** (public/js/watch.js:4011-4013 + :2147-2151; test/unit/watch-init-behavioral.test.js
   "v1.319 theatre reserve (?tv=)"). initTvWatch calls `hideTvVideoChrome()` FIRST, which sets
   `.watch-action-bar` `style.display = 'none'`, so every later `bar.getBoundingClientRect()` is all
   zeros, `theatreReservePx` gets `bb - sb < 0` and returns null, and nothing is ever written: a tv
   episode in theatre always runs on the CSS 98px fallback. Verified in real Chromium (sandbox copy
   of the probe, 1280x720 theatre, bar hidden the tv way): bar rect [0, 0], the real synchronous
   measure wrote nothing (`--watch-theatre-reserve` stayed unset); the title bottom sat 41px under
   the stage on this video fixture, so the fallback over-reserves by up to ~57px there, less the tv back link (a smaller tv picture than the design
   intends, the show row peeking). The test's fake `getBoundingClientRect` ignores the inline
   `display: none` and asserts a 173px write, so it passes on an unreachable shape - the v1.312
   named-blind-spot scar (its own name says "driven, not assumed"). AC3's "on BOTH ?v= and ?tv="
   is therefore not true. Fix: measure to the lowest RENDERED element of the pair (the title when
   the bar has no box), and make the tv test's bar rect honour the inline display (zeros when
   hidden), asserting the title-based write; or descope ?tv= from AC3 and disclose it.
2. **WARNING - Dean's "channel" is below the fold, and the plan narrows the ask without saying so**
   (plan "The ask" vs AC1 / Design / Disclosed gaps). The ask quotes "title + channel + action row";
   the reserve stops at the action bar's bottom, and FileTube's channel row is a separate
   `.uploader-info-panel` AFTER the bar. Measured on the 13f331d2 sandbox, theatre on: 1280x720
   panel y 712 h 74, avatar y 725-773 (fold 720); 1920x1080 panel y 1072, avatar y 1085-1133 (fold
   1080) - the channel is entirely off the first screen at both sizes. AC1 silently says "the title
   and every action button" and no disclosed gap names it. Safe to ship DISCLOSED (a docs-only
   edit: a D5 decision for Dean with the cost - reserving the panel shrinks the 1280x720 picture by
   ~90px), or extend the reserve to the panel's bottom.
3. **SUGGESTION - stale geometry prose** (public/js/watch.js:61, public/css/style.css:8998): "one
   line at 1920, three at 1280". Since D2 the 1280 theatre bar is ONE line (measured 99px); three
   lines only with the sidebar hand-reopened. Say so, or drop the per-width numbers.
4. **SUGGESTION - probe residue** (scripts/action-row-probe.js:52, :291, the header): the usage
   error still reads `[width ...]` (the header documents `WxH`, `--menu-toggle`,
   `--viewport-shot`); `--menu-toggle` is silently a no-op without `--theatre` (it lives inside
   `if (THEATRE)`), undocumented; the screenshot-failure line logs `${w}` where every other line
   now logs the `WxH` tag.
5. **SUGGESTION - stale plan anchors** (this plan, survey row 1 and "Sidebar collapsed"): "now
   :2084" / "now :878" are pre-D2 (setupTheatreToggle is :2176, the persisted-class apply :931-944
   at 13f331d2), and the r0 table names the `--sidebar-collapsed` flag the probe no longer has.
6. **SUGGESTION - disclose the hop re-collapse**: a sidebar the user hand-reopened in theatre is
   collapsed again by the next watch view (watch -> watch hop, autoplay-next): released ownership
   plus an open bar reads as "collapse". Arguably YouTube-like, but AC8's "a hand toggle is the
   user's" reads as if it persists; one line in Disclosed gaps.

Warnings 1 and 2 block this round (2 clears with the disclosure alone).

Gate: CHANGES r1 @13f331d2 — qa

## Gate r1 - adversary (@13f331d2)

Instruments: `git archive 13f331d2` and `git archive ecb61e1d` sandboxes in /tmp (node_modules
symlinked from main, same lockfile), Node 22.23.1, headless Chromium 1234 over raw CDP (own
harness: a real playing VP9 webm, a seeded TV show, `FileTube.navigate` / history for SPA hops,
a counting ResizeObserver shim, `DOMDebugger.getEventListeners`). Targeted units at 13f331d2:
36 files, tests 495, pass 495, fail 0. `lint:css` TOTAL 0; eslint on the 4 touched js files
exit 0; overlay-containment clean. Mutants: one fresh sandbox copy per mutant, credited only
with a non-empty diff.

Verified (ran it, saw it):
- Geometry at 1280x720 / 1366x768 / 1440x900 / 1920x1080 / 1920x1200: my numbers equal the
  plan's D2 table (e.g. 1280x720 player 215.9,80 848.2x518, video 846.2x476, bar bottom 23.8
  above the fold, centre x 640). Odd sizes: 1025x768 (3-line bar, reserve 173, bar 23.4 above
  the fold, centred), 1280x585, 1536x864, 2560x1080, 3440x1440 (all 23.8), 1280x500 (480 floor,
  10.9), 1280x400 (row below the fold, the disclosed D4). 125% zoom emulated (1536x864 @1.25):
  23.6. 4:3 and portrait items: 846.2x476 picture, 23.8.
- YouTube re-measured independently (my probe, a different 4:3 video, dark, `wide=1`): band
  `100vh - 169` at 1280x720 (551) and 1440x900 (731), title y 619 / 799, owner + actions y 655 /
  835 h 42 (23px above the fold). The builder's reference numbers hold.
- Reserve follows every change I drove with no ResizeObserver-loop error: resize 1920 -> 1280
  -> 1025 -> 1440, title 1 -> 4 lines (99 -> 149 -> 99), a wrapped views line (178), theatre
  off/on. Native fullscreen from theatre: `#fs-stage` fullscreen, picture 1278x718 (max-height
  none), geometry identical after exit.
- Glow at 1366x768 dark, playing: player = stage 933.5x566, glow .12/.22/1.24/1.44, every
  sample equal to the plan's row; toggle OFF 684x425.6 / glow 848.2, ON again identical.
- Sidebar ownership, real Chromium, every arm: cold theatre load collapses; hand reopen
  releases; theatre off keeps the user's choice; user-closed never reopened; nav to / music
  podcasts tv books history stats setup restores (margin-left 230px, marker gone); watch ->
  watch hop: ZERO class mutations on #sidebar (MutationObserver), owner re-claimed; back /
  forward both ways; resize 1280 -> 1000 -> 1025 -> 1024 -> 700 -> 1280 restores / collapses at
  each crossing (700: drawer closed). After 12 watch hops + 6 home<->watch: #menu-toggle click
  listeners 2 (common.js + the live view), live ResizeObservers 2 on watch / 1 elsewhere,
  0 page errors. No storage key added by any D2 step (localStorage key list diffed per step).
- Unchanged surfaces, base vs head, every box identical (stage, player, video, glow, title,
  bar, buttons, column, sidebar classes, scrollWidth): theatre OFF at 1024x768, 900x700,
  800x1000, 1280x720, 1920x1080, 2560x1080; theatre ON (persisted) at 390x844, 768x1024,
  800x1000, 900x700, 1024x768. Music: no rule or markup reaches it (music.html names the stage
  only in a comment).
- Builder mutants re-run by me: J5, G9, G13, J10 all killed. Mine killed: re-claim keeps the old
  owner, null reading written, drop isFinite(bar), restore via setTimeout (not a microtask),
  collapse ignores the user-collapsed check, restore drops the marker only, observe the stage
  only, measure the title not the bar, click skips syncTheatreGuide, release bound on document,
  a doubled abort restore, wireTheatreGuide skipped, the stage rule unscoped from theater-mode,
  `-WEBKIT-BACKDROP-FILTER` on the stage, the breakpoint 1025 -> 1024.

Findings:

1. WARNING - the ?tv= reserve is INERT and its test is a divergent fixture (AC3 "on BOTH ?v=
   and ?tv=" is false). initTvWatch runs `hideTvVideoChrome()` first, which sets
   `.watch-action-bar` to `display:none`, so its rect is 0x0 and `theatreReservePx` returns null
   on every measure: `--watch-theatre-reserve` is never written on an episode. Real Chromium,
   `/watch.html?tv=ep1`, theatre persisted: 1280x720 reserve unset (CSS fallback 98px), bar
   display none rect 0,0,0,0, the show row (the episode's channel) at 676.4-750.4 with the show
   link at 708.3-726.3 (cut by the 720 fold); 1920x1080 show row 1036.4-1110.4, link
   1068.3-1086.3 (cut). The ?tv= test passes only because it hand-types a bar rect (bottom
   736.4) the real path can never produce: feeding it the real shape (`{top:0,bottom:0,height:0}`)
   turns it red (1 fail: expected the 173px write, got none). The test's own comment promises
   "driven with the REAL path, never a hand-typed shape". Fix: on tv measure to the last visible
   block under the stage (title or the show row), and drive the tv test with the hidden bar.

2. WARNING - surviving mutant on a claimed binding (G9 "desktop gate"): the QUERY that decides
   the collapse is unbound. The test's matchMedia fake returns one shared object whatever the
   query, and `mq.query` records only the LAST call (wireTheatreGuide's). Mutant in
   syncTheatreGuide `'(min-width: 1025px)'` -> `'(max-width: 1024px)'`: 3 target files 74/74
   green. In real Chromium (that mutant, theatre persisted): 700x900 gets `sidebar hidden
   mobile-open` (the mobile drawer opens over the watch page on every visit), 1280x720 never
   collapses. Fix: make the fake evaluate min-/max-width against a simulated width, or assert
   the query of every matchMedia call.

3. WARNING - wider-than-16:9 items REGRESS (the aspect enumeration handled only the taller
   side). The stage width is always the budget height x 16/9, so a 21:9 item (seeded 2560x1080,
   player.js sets the real `--media-aspect`) shrinks. 1280x720: BASE picture 1000x421.9 with the
   buttons already 16.5px above the fold; HEAD 846.2x357 with 155.8px of empty room below.
   1920x1080: BASE 1640x691.9, HEAD 1486.2x627. Should-work reasoning, not measured with a 21:9
   video: YouTube's fixed 1280x551 band would letterbox it at about 1280x549. Fix: width from
   the budget height x max(16/9, the item's aspect), still capped at the column.

4. WARNING - the plan narrowed Dean's ask. His words: "title + channel + action row"; AC1 keeps
   only the title and the action bar. FileTube's channel row (`.uploader-info-panel`: avatar,
   channel name, Subscribe) is below the fold at every size: 1280x720 panel 712.2-786.2 (name
   744.1), 1920x1080 1072.2-1146.2. YouTube's channel IS its action row (#owner y 655 h 42 at
   1280x720, re-measured). Either extend the reserve through the channel row or put the trade
   to Dean as a named decision (D5) - it is not in D1-D4.

5. SUGGESTION - dead guard: `!Number.isFinite(sb)` in theatreReservePx. NaN is already
   rejected by `px >= 0`; only a +/-Infinity stage edge reaches the guard, and no test drives
   one. Mutant (guard dropped): 74/74 green. Drop it or add the case.

6. SUGGESTION (pre-existing, not introduced here; AC5 leans on it) - the v1.312 CSS lock's
   FORBIDDEN_PROP misses `content-visibility`. `content-visibility: auto` added to the new stage
   rule: 74/74 green, and in Chromium it makes the element a containing block for fixed
   descendants (a fixed inset:0 child measured 100,100,200,100 instead of 0,0,1280,720), the
   v1.166 trap the lock exists for. `container-type` measured harmless (0,0,1280,720).

7. SUGGESTION (disclosure) - browser zoom 125% on a 1280-wide window is a 1024px CSS viewport,
   where none of this applies (the v1.190 rule; bar 209px below the fold at 1024x576). Out of
   scope by construction; worth one line in Disclosed gaps.

Findings 1-4 block this round. 5-7 do not.

Tree: only this section appended (qa's r1 section above is theirs); every mutation ran in /tmp.

Gate: CHANGES r1 @13f331d2 — adversary

## r1 fix record (gate r1 @13f331d2 -> fix commit 4b893ba8)

Verdicts committed as found (37fb436b). Fix as one new commit, 4b893ba8; pre-commit hook (the
whole unit suite, Node 22.23.1): tests 7120, pass 7120, fail 0. Targeted before it (ambient*,
watch*, theatre*, music-theater-toggle, music-ambient, critter-mode, shell*, *parity*, the
tech-debt / exec-plans / docs / comment-debt censuses): 493 / 493. `lint:css` TOTAL 0;
overlay-containment clean; eslint on the five touched js files exit 0.

| Finding | Fix (4b893ba8) | Bound by | Mutants (killed) |
|---|---|---|---|
| W1 (qa W1 = adversary W1): the ?tv= reserve inert (bar display:none, 0x0), its test a hand-typed shape | watch.js `theatreReserveTargetRect`: the lowest RENDERED controls row - the bar when it has a box, else the show row (`.uploader-info-panel`), else the title; the observer also watches the show row and `.watch-main` (the tv back link moves the row without resizing it) | theatre-mode "r1 theatreReserveTargetRect" (incl. the hidden-bar null); watch-init-behavioral "?tv=": the rects honour an inline `display:none` like a browser, precondition the tv path hid the bar, asserts 262px = show row bottom - stage bottom. The new test file run against 13f331d2's watch.js: 2 fail (the ?tv= test and the aspect test), 28 pass | R1 skip the show row, R2 always the bar (r0), R3 a 0x0 rect counts, R4 show row not observed, R5 column not observed |
| W2 (adversary): the breakpoint QUERY unbound | test-only: the matchMedia fake evaluates `(min|max)-width: Npx` against a simulated width, throws on any other query, records every call; `setWidth()` fires the change listeners; every query asserted `(min-width: 1025px)`; no-op at 1024 / 900 / 700 / 390 cold, collapse at 1025, restore at 1024 and 700 on a crossing | watch-init-behavioral "D2: crossing the desktop breakpoint", "D2: theatre ON (persisted, desktop)" | R11 `(max-width: 1024px)` (4 fail), R12 `(min-width: 1024px)` |
| W3 (adversary): a wider-than-16:9 item shrank | style.css stage width = budget height `* var(--watch-theatre-aspect, 16 / 9)` (vh + dvh); watch.js `theatreWidthAspect` (the item's `--media-aspect` when > 16:9, else 16:9) written by the same measure, removed for 16:9 / 4:3 / portrait / unknown | theatre-mode "r1 theatreWidthAspect" + the stage TERM (now names the aspect var); watch-init-behavioral "r1 theatre aspect (?v=)" (21:9 writes 2.3704, 16:9 / 4:3 / none remove it) | R6 dvh ignores the var, R7 vh ignores it, R8 a narrower item narrows, R9 never written, R10 never cleared |
| W4 (qa W2 = adversary W4): the channel row narrowed silently | ARCHITECT RULING: the reserve stays at the action row -> decision D5 (Decisions) with the measured cost; AC1 now says the channel panel is not included; Disclosed gaps line | docs | - |
| S5 (adversary): dead `isFinite(sb)` guard | one guard on the result: `Number.isFinite(px) && px >= 0` | theatre-mode units: -Infinity stage edge, a non-numeric bar edge | R13 guard dropped |
| S6 (adversary): `content-visibility` missing from the v1.312 lock | FORBIDDEN_PROP + `content-visibility`, plus a self-test of the lock's reach (catches `content-visibility: auto`, `CONTENT-VISIBILITY:hidden`, `-webkit-content-visibility`, `contain: paint/layout/strict/content`, `Isolation`, `-webkit-transform`; leaves `container-type`, `contain-intrinsic-size` alone); the stage comment names it | ambient-glow-engine "v1.312 CSS LOCK" | R14 `content-visibility: auto` on the stage, R15 `Contain: paint` |
| S7 (adversary) + qa S6: 125% zoom; the hop re-collapse | Disclosed gaps lines | docs | - |
| qa S3: stale "three lines at 1280" prose | watch.js theatreReservePx comment, style.css stage comment: one line in the collapsed-sidebar column, three at 1280 only with the bar hand-reopened | - | - |
| qa S4: probe residue | usage text lists `WxH`, `--theatre`, `--menu-toggle`, `--viewport-shot`; `--menu-toggle` without `--theatre` warns; the `WxH` tag is computed at the top of the viewport loop and used on every log line (reload, WARNING, page state, theatre via, ready, screenshot skipped, clip) | - | - |
| qa S5: stale plan anchors | survey row 1 re-anchored at 4b893ba8; the r0 "Sidebar collapsed" note names the renamed flag | - | - |

### Mutant table, re-run in full at 4b893ba8 (`desktop-theatre-mutants-r1.py`): 50 of 50 killed

Fresh copy of the `git archive 4b893ba8` sandbox per mutant, credited only with a non-empty diff
and a red test. R1-R15 (the r1 guards above), then every earlier guard re-anchored on the r1
text: C1-C4 and C6-C11 (CSS; C5 retired with the r0 scope test unchanged), J1-J12 (reserve JS),
G1-G11, G13, G14 (D2; G12 needs the two-part edit of the D2 script and was not re-run: its test
is unchanged). Every line: `desktop-theatre/mutants-r1-4b893ba8.txt`.

### Measurements at 4b893ba8 (headless Chromium, glow probe: real playing VP9 webm, dark, ambient on, theatre persisted)

?v= (the action bar), all five sizes - unchanged from D2:

| Viewport | video | bar bottom to fold | channel panel bottom to fold | glow vs player | L5 / R5 |
|---|---|---|---|---|---|
| 1280x720 | 846.2x476 | 23.8 | -66.2 | .12 .22 1.24 1.44 | [70,18,51] / [18,64,69] |
| 1366x768 | 931.5x524 | 23.8 | -66.2 | same | [70,18,51] / [18,64,69] |
| 1440x900 | 1166.2x656 | 23.8 | -66.2 | same | [71,18,52] / [18,65,70] |
| 1920x1080 | 1486.2x836 | 23.8 | -66.2 | same | [71,18,52] / [18,66,70] |
| 1920x1200 | 1699.5x956 | 23.8 | -66.2 | same | [71,18,52] / [18,66,71] |

Action-row probe (FT_ROOT = the fix sandbox, `--theatre`, one Chromium per viewport): identical
boxes to the D2 table; vs the ecb61e1d BEFORE: 10 buttons each, 0 deformed, rows 1 -> 1 (the
buttons now share the stars' line at 1280 / 1366 / 1440, where the r0 bar wrapped them below:
the intended un-wrap in the wider collapsed-sidebar column).

?tv= (a seeded Shows episode, the same webm, `/watch.html?tv=ep1`; the bar is `display: none`
on every run):

| Viewport | 13f331d2: reserve / video / show row bottom to fold / show link bottom to fold | 4b893ba8: reserve / video / show row to fold / link to fold |
|---|---|---|
| 1280x720 | unset (CSS 98px) / 848x477 / -30.4 / -6.3 | 152px / 752x423 / 23.6 / 47.7 |
| 1366x768 | unset / 933.3x525 / -30.4 / -6.3 | 152px / 837.3x471 / 23.6 / 47.7 |
| 1440x900 | unset / 1168x657 / -30.4 / -6.3 | 152px / 1072x603 / 23.6 / 47.7 |
| 1920x1080 | unset / 1488x837 / -30.4 / -6.3 | 152px / 1392x783 / 23.6 / 47.7 |
| 1920x1200 | unset / 1701.3x957 / -30.4 / -6.3 | 152px / 1605.3x903 / 23.6 / 47.7 |

(base ecb61e1d: the show row 115.9px below the fold at 1280x720 and 1920x1080.) The glow on
?tv=: lit, player = stage, .12 / .22 / 1.24 / 1.44 at all five; no page errors.

21:9 (`MEDIA_WH=2560x1080`, player.js sets `--media-aspect: 2560 / 1080`):

| Viewport | base ecb61e1d video / bar to fold | 13f331d2 video / bar to fold | 4b893ba8 video / bar to fold (aspect var) | YouTube 2.39:1 (PfSHUU7na-M) video |
|---|---|---|---|---|
| 1280x720 | 1000x421.9 / 43.5 | 846.2x357 / 142.8 | 1128.3x476 / 23.8 (2.3704) | 1280x536 (band = the video) |
| 1920x1080 | 1640x691.9 / 167.9 | 1486.2x627 / 232.8 | 1870x788.9 / 70.9 (column-bound) | 1920x804 |

YouTube with a scope video (found by search, `desktop-theatre-yt-find-wide.js`; 854x358 source,
"Official Trailer (2.39:1)", no ad on the measured runs): the band shrinks to the video
(0,56 1280x536 and 0,56 1920x804, full width), title y 604 / 872, action row y 640 / 908 h 42 -
so YouTube keeps the width and gives the height back. FileTube now does the same up to the
column (the height budget stays the cap at 1280x720; at 1920x1080 the 1872px column binds).
4:3 (`MEDIA_WH=640x480`): player 848.2x518 and 1488.2x878, picture box 846.2x476 / 1486.2x836
(the 4:3 picture pillarboxed), bar 23.8 above the fold, no aspect var written.

D5 cost (the channel panel reserved instead, `sandbox-d5alt`): 1280x720 reserve 189px, video
686.2x386, panel 23.8 above the fold, bar 113.8 above; 1920x1080 video 1326.2x746.

Screenshots (`desktop-theatre/sbs/`): YouTube | BEFORE | AFTER (4b893ba8)
`desktop-theatre-sbs-<WxH>.png` x5; ?tv= 13f331d2 | 4b893ba8 `desktop-theatre-tv-sbs-<WxH>.png`
x5; YouTube | glow AFTER `desktop-theatre-glow-sbs-<WxH>.png` x5; 21:9 YouTube | base | AFTER
`desktop-theatre-219-sbs-{1280x720,1920x1080}.png`; 16:9 | 4:3 `desktop-theatre-43-sbs-*`;
action row | channel reserved (D5) `desktop-theatre-d5alt-sbs-*`.
