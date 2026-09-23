---
plan: ambient-glow-rebuild
harness: v2 · lean
branch: fix/ambient-glow-rebuild
anchor: spec
status: Gate:APPROVED r2 @33275a31
next: Dean iPhone check (ambient ON, dark: the picture stays; faux-fullscreen drag) on an edge build, then release v1.312.0 per docs/RELEASING.md
design: Approved 2026-09-23 @bd9c476f
gate: APPROVED r2 @33275a31 — adversary, qa, security-brief
---

# Ambient mode rebuild - the glow must not touch the video layer

## The request (restated)

Ambient mode blacks out EVERY video on Dean's iPhone (picture for ~1s, then black;
audio keeps playing; the glow keeps showing the video's colours, so the video still
decodes and only its on-screen layer drops). Confirmed on device with the trigger held
constant: ambient OFF = picture, ON = black, on `:1.311.1` too - so NOT a v1.311.2
regression. Dean's ruling: REBUILD ambient as a subtler, YouTube-like colour glow that
bleeds from the player's edges, with no interim iOS guard. Hard constraint: the new glow
must not read the live `<video>` element. Also correct the v1.311.3 ROADMAP + ledger
disclosure, which attributes the black video to v1.311.2.

## Diagnosis state (honest)

- **Hypothesis:** one of the two things the current effect does to the video's
  neighbourhood kills iOS's on-screen video layer: (a) `gctx.drawImage(video)` every
  500ms (`public/js/watch.js` `paintFrom`), or (b) the blurred + masked + scaled
  composited `.ambient-glow` layer beside the video (`public/css/style.css` ~9057:
  `filter: blur() saturate()`, `transform: scale()`, `mask-image`).
- **Falsifier:** a rebuilt glow that does NEITHER (no video->canvas copy, no
  filter/transform/mask layer) still blacks the video on Dean's iPhone. If that happens
  the diagnosis was wrong and we re-root-cause from that observation; we do not patch.
- Nothing off-device can confirm: Playwright WebKitGTK paints the picture on every
  build with identical layer stacks. **Dean's iPhone is the only oracle** and his
  confirmation is an acceptance criterion, not a nicety.
- Neither suspect can be separated off-device. The rebuild removes both; a per-suspect
  device bisect (an interim canvas-only or filter-only build) is available if Dean
  wants the cause named, but his ruling was rebuild-first.

## Blind-spot pass (what the work rests on)

1. **Storyboard coverage is not universal.** A sprite exists for a `type:'video'`
   item with duration > 2s (`lib/storyboard.js` `planStoryboard`), generated at scan by
   `lib/scan/orchestrator.js` `extractStoryboard` (ffmpeg required; a failed frame
   drops the sprite) and restored for reused items (`server.js` ~2648). It is served
   by `GET /storyboard/:id` only when the item is eligible AND the file is on disk
   (`lib/media/streams.js:186-204`). The client learns the geometry from
   `mediaData.storyboard` (`storyboardDescriptor`, DERIVED, never persisted). **TV
   episodes have no storyboard at all** (no `storyboardDescriptor` on the tv routes),
   and audio never does. So the colour source needs a fallback ladder: sprite tile at
   the current time -> the item's thumbnail/cover -> nothing (plain dark).
2. **The tv fallback poster is unverified.** `ensureCover` today fetches
   `/thumbnail/<mediaId>` for everything, including tv episodes; whether that route
   serves a tv episode id must be checked in design (the tv path uses
   `/tvposter/<showId>` for the show avatar).
3. **Two suspect surfaces, one rebuild.** The current effect is (a) a canvas fed by
   `drawImage(video)` and (b) a CSS layer with `filter`+`transform`+`mask-image`.
   A rebuild that keeps EITHER may keep the bug. Design must remove both: colours are
   sampled from an IMAGE (sprite tile / thumbnail) on an off-DOM canvas, and the glow
   is painted as plain CSS gradients on an unfiltered, untransformed element.
4. **Things that must keep working (regression surface):** the `ft-ambient` key and its
   prefs-sync membership (`ft-ambient-intensity` was later REMOVED - D5 superseded)
   (`public/js/prefs-sync.js:26`, bound by `test/unit/prefs-sync-client.test.js`);
   the dark-only toggle row + the "amount" row gated on the effect being on
   (`syncRowVisibility`); the `ambientShouldRun` predicate (off when paused, hidden,
   light, or off - the v1.187.2 battery floor); the root `data-ambient-on` signal the
   sidebar bleed reads (`style.css:1096`); the stage stacking-context rules
   (`.watch-player-stage` z-index 0, dropped in faux fullscreen / audio expanded -
   the v1.166 "isolation traps in-view fixed overlays" class); the mobile
   `overflow-x: clip` (v1.194.3) which only exists because the glow was scaled - a
   gradient glow that stays inside the stage box can drop the scale and the clip;
   the tv watch path's five-call cog sequence (`watch-init-behavioral.test.js` W1).
5. **Existing test binding to rewrite:** `test/unit/watch-chrome-ambient.test.js`
   (20 tests) locks the CURRENT implementation - the 32x18 backing store, the mask
   stop x scale reach invariant, the ladder numbers. Those locks are obsolete by
   design and get replaced, not "kept green".
6. **Mobile viewport width:** `isMobile` = `(max-width: 768px)` chooses the sampling
   interval; a rotate crosses 768px on some phones. Sampling from the sprite is cheap
   enough that one interval may do; design decides.
7. **Design tokens census** (`npm run lint:css` ceiling ZERO) and the overlay
   containment lint (`node scripts/overlay-containment-lint.js --enforce`) both run on
   the new CSS; every raw literal in a governed property is tokenised or
   `token-exempt`-annotated.
8. **The disclosure fix** touches `ROADMAP.md` (the v1.311.3 "Not fixed, disclosed"
   paragraph) and `docs/releases.json` (the 1.311.3 entry has no black-video line;
   the correction is a line in THIS wave's ledger entry, in user language).
9. **Not in this wave (still open, still Dean's device):** R2 (page behind faux
   fullscreen stays moved after a drag - re-ask with ambient OFF, may share a cause);
   #6 bottom nav after a rotate; the v1.311.3 device check list
   ([[v1-311-3-shipped]]); desktop theatre sizing (Priority 2, own branch).

## Research

- **YouTube's technique** (Smashing Magazine, "Recreating YouTube's Ambient Mode Glow
  Effect", 2023-07,
  https://www.smashingmagazine.com/2023/07/recreating-youtube-ambient-mode-glow-effect/):
  one canvas behind the player, `drawImage(video)` into a 10x6 backing store, a 1px
  canvas blur, opacity 0.4, an inset box-shadow to soften edges, updated on
  `requestAnimationFrame`. NB the article as fetched describes ONE canvas; the
  hand-off's "two cross-fading canvases" is not in it. Its method is exactly the
  video->canvas path we must avoid, so it is a reference for the LOOK (a very
  low-resolution colour field, low opacity, soft edges), not the mechanism.
- **iOS video/canvas breakage history:** WebKit bug 237424 (Safari 15.3 regression:
  `drawImage(video)` yields a black CANVAS with GPU-process canvas rendering, fixed
  2022-03); Apple forums thread 708348 (iOS 16 beta 1: `drawImage(video)` captures
  black with "GPU Process: DOM Rendering", fixed beta 2); thread 698169 (iOS 15:
  `<video>` black in fullscreen while audio plays, no workaround, "file feedback").
  Pattern: the video/canvas/GPU-process interplay on iOS breaks repeatedly across
  releases, and the fix is always an OS update. Dean's symptom (black VIDEO, live
  canvas) matches none of them exactly, which is consistent with a new iOS build. It
  is a reason to depend on none of that path.
- **YouTube's real glow, MEASURED (match-reference norm), 2026-09-23.** Headless
  Chromium (the Playwright build, raw CDP; scripts + JSON + PNGs in the session
  scratchpad `yt-ambient-probe.js`, `yt-glow-profile.js`, `yt-glow-isolated.png`),
  youtube.com dark theme (`PREF=f6=400`), 1600x1000, video `aqz-KE-bpKQ` at 30s
  (bright green meadow), the masthead/sidebar/text and the `<video>` element hidden so
  only `#cinematics` painted:
  - DOM: `#cinematics` = the player's box (1112x625) > a flex wrapper > a `position:
    relative` box with `transform: scale(1.5, 2)` > TWO `<canvas width=110 height=75>`
    at `position:absolute; width:100%; height:100%`. Computed `filter: none`,
    `mask: none`, `transition-duration: 0s` on the canvases. So YouTube reaches 25% of
    the player width to each side and 50% of its height above/below, with NO CSS
    filter - the softness is inside the canvas bitmap.
  - Intensity profile (RGB over the page's [15,15,15]) from the right edge at mid
    height: 0px [31,40,28] · 25px [30,36,26] · 50px [27,31,23] · 75px [23,27,20] ·
    100px [19,22,18] · 150px [15,15,14] (= page). Below the bottom edge: 0px
    [31,35,22] · 50px [27,29,20] · 100px [22,23,18] · 150px [16,17,16]. Corner at
    +100/+100: [18,18,15]. So the PEAK is only ~+25/255 in the dominant channel (the
    source frame is a bright saturated green) and it is gone by ~120px sideways
    (~11% of the width) and ~130-150px below (~20-24% of the height) - far dimmer
    and tighter than FileTube's current `normal` rung.
  - Cadence: the second canvas's opacity ramps 0.36 -> 0.99 in 0.0133 steps every
    ~50ms (JS-driven, ~3.5s per full ramp), snaps to 0, ramps again: a continuous
    cross-fade between two freshly drawn frames, one swap every ~3.5s.
  - Not measurable here: the exact in-canvas darkening/blur YouTube applies before
    upscaling (the canvas is cross-origin-tainted). The profile above already
    includes it, which is what matters for matching.

## Decision register (spec anchor) - ordered by blast radius

| ID | Decision | Recommendation | Why |
|----|----------|----------------|-----|
| D1 | Colour source | Sprite tile at `currentTime` via `storyboardFrameForTime`/`storyboardTile` (`player.js`, exported on `window.FileTube.storyboard`), falling back to the item's thumbnail/cover image; never the video element | Time-varying colours like YouTube; every source is a same-origin IMAGE, so no video->canvas path exists to break; sprites are already generated for every eligible video |
| D2 | Render shape | A plain `div` (or two, for a cross-fade) inside `.watch-player-stage`, painted with `radial-gradient`/`linear-gradient` from 4-6 sampled edge colours set as CSS custom properties; NO `filter`, NO `transform: scale`, NO `mask-image`; softness comes from gradient stops; the element is larger than the player via negative insets, not a scale | Removes the second suspect (the blurred composited layer) and reads as "light bleeding from the edges" rather than a blurred copy (Dean's ask) |
| D3 | Sampling | Off-DOM canvas (`document.createElement('canvas')`, never attached) draws the sprite tile / thumbnail once per tile change, reads a handful of edge regions with `getImageData`, averages; recomputed only when the sprite frame index changes (every `interval` seconds, 2-10s) or on the fallback image load - no 500ms loop | Cheaper than today (the v1.187.2 battery floor stays), and a tile change is the natural cadence of the source |
| D4 | Transition | Colours change through a CSS `transition` on opacity of two alternating layers (cross-fade over ~1s), so a tile change never pops | Custom-property gradients do not animate; two layers is the smallest thing that does |
| D5 | Intensity ladder | ~~Keep the ladder~~ **SUPERSEDED by Dean 2026-09-23 after the Step 4 measurement: NO ladder - one YouTube-matched look (opacity 0.3). The `Ambient amount` cog row, `resolveAmbientLevel`/`AMBIENT_LEVELS`, the CSS rungs and the `ft-ambient-intensity` sync key (client + server allowlists, the sync plan) are removed.** | Dean: "No need for ladder really. We can just do YouTube style" |
| D6 | Fallback with no image | Audio with no cover, tv with no served thumbnail, a sprite that 404s: the glow stays off (no default hue) | A wrong colour reads as a bug; the effect is decorative |

## Acceptance (measurable)

1. **On Dean's iPhone, ambient ON, dark mode: the video keeps its picture** for a full
   playthrough of at least one video, inline and in faux fullscreen, on the installed
   PWA. Dean confirms before release. (Off-device: no `drawImage(` whose source is a
   media element exists in `watch.js`; a source-lock test binds it.)
2. The glow reads as a soft edge gradient: the `.ambient-glow*` rules declare no
   `filter`, `transform`, `mask-image`/`-webkit-mask-image`; bound by a test that
   extracts the rule bodies (comment-stripped).
3. The colours come from the sprite tile at the current time: a jsdom/unit test drives
   `currentTime` across a tile boundary and asserts the sampled tile index advances
   (`storyboardFrameForTime` binding) and the CSS custom properties change; with no
   `mediaData.storyboard` the thumbnail path runs; with neither, nothing paints.
4. `ft-ambient` keeps its storage value and prefs-sync membership; `ft-ambient-intensity`
   is REMOVED from all three allowlists (the triple-lock test re-pinned at 20 keys) and
   the amount row is gone (Dean, 2026-09-23); the toggle row stays dark-only;
   `ambientShouldRun` gating (paused / hidden / light / off tears the glow down) is
   bound as today.
5. Desktop still works: a headless Chromium run (dark, ambient on, a real mp4) shows
   the glow element painted with non-transparent gradient colours outside the player
   box, and the sidebar bleed (`data-ambient-on`) is set while running.
6. `npm run lint:css` and the overlay-containment lint stay at ZERO; dual-Node full
   suites green.
7. ROADMAP.md v1.311.3 paragraph and this wave's ledger entry state the black video was
   ambient mode on iOS on every build, not a v1.311.2 regression.

## Design

### Overview
Ambient becomes a **colour-only edge glow**: colours are sampled from a same-origin
IMAGE (the storyboard sprite tile at the current time, else the item's poster) on an
off-DOM canvas, and painted as CSS gradients on two plain `div`s behind the player that
cross-fade. Nothing reads the `<video>` element's pixels and nothing beside the video
carries a `filter`, `transform` or `mask`. The look targets the measured YouTube
profile: peak ~+25/255 at the edge, gone within ~11% of the width / ~20% of the height.

### Requirements
- R1 No `drawImage` from a media element anywhere in the ambient code (source-locked).
- R2 `.ambient-glow*` rules declare no `filter`, `transform`, `mask-image`,
  `-webkit-mask-image`, `backdrop-filter`, `will-change` (rule-body-locked).
- R3 Colour source ladder: `mediaData.storyboard` + `/storyboard/<id>` tile at
  `currentTime` -> `mediaData.artUrl` (tv poster) or `/thumbnail/<id>` -> off.
- R4 The v1.187.2 gating floor is unchanged: `ambientShouldRun` (pref + dark + playing
  + visible) starts/stops it; teardown on the view signal; `data-ambient-on` on the
  root while running (the sidebar bleed).
- R5 The `ft-ambient` key, its cog row and visibility rule are unchanged. (Superseded
  D5: the intensity ladder + `ft-ambient-intensity` are removed - see D5.)
- R6 Cost floor: one 16x9 off-DOM sample per tile change (2-10s) or per poster load;
  a 1s `setTimeout` clock (not rAF) only while running; no per-frame work.

### Architecture (watch.js `setupAmbientMode`, rewritten in place)
```
clock (1s, only while running)
  -> t = video.currentTime
  -> src = ambientSourceFor(mediaData, mediaId, t)      // pure
       { kind:'sprite', url, index, tile:{col,row}, cols, rows } | { kind:'image', url } | null
  -> if src.index/url differs from the last painted one:
       img = ensureImage(src.url)                       // cached per url, same-origin
       draw the tile (or whole image) into the 16x9 off-DOM canvas
       colors = ambientEdgeColors(ctx.getImageData(...))// pure: 8 swatches
       vars   = ambientGlowVars(colors)                 // pure: the custom properties
       paint(vars) -> set them on the INACTIVE layer, then swap the `is-front` class
                      (CSS transitions opacity over --ambient-fade)
```
Pure, exported, unit-tested: `ambientSourceFor`, `ambientEdgeColors`, `ambientGlowVars`,
plus the existing `isAmbientEnabled`/`ambientStorageValue`/`ambientShouldRun`
(~~`resolveAmbientLevel`/`AMBIENT_LEVELS`~~ removed with the ladder, D5 superseded).

### Components & interfaces
- **watch.html**: the `<canvas id="ambient-glow">` becomes
  `<div id="ambient-glow" class="ambient-glow" aria-hidden="true" hidden>` holding two
  children `<div class="ambient-glow-layer"></div>` x2. Same id, same `hidden`/`is-on`
  contract, same position in `.watch-player-stage` (before `#player-slot`).
- **ambientSourceFor(mediaData, mediaId, t)**: sprite when `mediaData.type === 'video'`
  and `mediaData.storyboard` is a geometry; index via `storyboardFrameForTime`, tile
  via `storyboardTile` (from `window.FileTube.storyboard`, with a guarded fallback of
  `null` -> the image rung if the player module is absent). Image url =
  `mediaData.artUrl` when a non-empty string (tv episodes, books) else
  `/thumbnail/<mediaId>`. `null` when there is no mediaId.
- **ambientEdgeColors(data, w, h)**: averages of the top row, bottom row, left column,
  right column and the four corner cells of the 16x9 sample -> 8 `[r,g,b]`.
- **ambientGlowVars(colors)**: `{ '--ag-t': 'rgb(..)', '--ag-b', '--ag-l', '--ag-r',
  '--ag-tl', '--ag-tr', '--ag-bl', '--ag-br' }`. Colours are passed through a mild
  lift: HSL saturation x1.15 (cap 1), lightness clamped to [0.30, 0.62] so a dark
  scene still reads as tinted light and a white scene does not wash out (YouTube's
  peak brightness is the ceiling; the ladder's alpha scales it).
- **CSS (style.css, replacing the ~9047-9160 block)**:
  `#ambient-glow` = `position:absolute; inset: calc(-1 * var(--ambient-reach-y)) calc(-1 *
  var(--ambient-reach-x)); z-index:-1; pointer-events:none; opacity:0` ->
  `.is-on { opacity: var(--ambient-opacity) }`. Each layer is `position:absolute; inset:0;
  opacity:0; transition: opacity var(--ambient-fade) linear` and
  `.is-front { opacity:1 }`; its `background` stacks eight gradients: four
  `linear-gradient` bands from each edge outward (`to top` from the player's top edge
  etc., colour -> transparent across the reach) and four corner `radial-gradient`s
  (`ellipse at 0 0`, colour -> transparent 70%). The player's own box (the inner
  rectangle) is covered by `#player-slot`, so only the reach band shows - the same
  reach invariant as v1.187.1, now trivially true (reach > 0 by construction).
  ~~Ladder (data-ambient on `#ambient-glow`): subtle 0.35 · normal 0.55 · intense 0.75 ·
  extreme 1.0; extreme reach 18%/30%~~ SUPERSEDED (D5, Dean): ONE look - `--ambient-opacity:
  0.3`, reach-x 12% / reach-y 22% of the player box (the measured YouTube extent). `--ambient-fade: 1.2s` (YouTube's
  continuous 3.5s ramp reads as a slow drift; a 1.2s fade on a 2-10s cadence keeps
  the "gently shifting" feel without a permanent animation). Reduced motion:
  `transition: none`. The dark-only belt (`:root:not([data-mode="dark"]) .ambient-glow
  { opacity:0 !important }`), the stage stacking rules, the faux-fullscreen/audio
  expanded z-index drop and the mobile `overflow-x: clip` stay as they are (the
  negative inset overflows the stage exactly as the old scale did).
- **Sidebar bleed**: unchanged (`:root[data-ambient-on] .sidebar`), set/cleared at the
  same start/stop funnel.

### Data models
None persisted. The only stored state is the two existing localStorage keys.

### Error handling
- Sprite/poster `onerror` -> fall to the next rung (`sprite` -> `image` -> off) for
  this view; a later tile change on an errored sprite does not retry the sprite.
- `getImageData` throwing (a tainted or zero-size image) -> `hardFailed` for this view,
  glow off, no re-arm (the v1.187.2 shape).
- `window.FileTube.storyboard` missing -> the image rung.

### Testing strategy
- Unit (pure): `ambientSourceFor` ladder incl. tv `artUrl`, the tile index advancing
  with `t`; `ambientEdgeColors` on a synthetic 16x9 buffer; `ambientGlowVars` lift and
  clamps.
- jsdom behavioural (the existing watch harness's canvas/Image stubs): dark + pref on
  + playing -> `#ambient-glow.is-on` + root `data-ambient-on`; drive `currentTime`
  across a tile boundary -> the front layer flips and its custom properties change;
  paused/hidden/light -> torn down; teardown on abort. Mutation: delete the tile-index
  comparison and the swap -> red.
- Source locks (comment-stripped, bounded to the function body): no
  `drawImage(` whose first argument is `video`/a media element in
  `setupAmbientMode`; the `.ambient-glow` rule bodies carry none of R2's properties;
  watch.html's `#ambient-glow` is a `div` with two `.ambient-glow-layer` children.
- Prefs/gating: the existing `prefs-sync-client` and `ambientShouldRun` tests stay.
- Instruments: `npm run lint:css`, `node scripts/overlay-containment-lint.js --enforce`,
  dual-Node full suites.
- Desktop end-to-end: a headless Chromium run (dark, ambient on, a real mp4 with a
  generated sprite) samples pixels at +10/+50/+100px outside the player edge and
  asserts a non-grey tint that falls off, plus a screenshot for Dean. Recorded here.
- Device (Dean): the acceptance's bullet 1, before release.

### Steps
- Step 1: pure helpers + unit tests (`ambientSourceFor`, `ambientEdgeColors`,
  `ambientGlowVars`). Demo: `npm run test:unit` green with the new tests.
- Step 2: watch.html + style.css rebuild (the div pair, the gradient rules, the ladder).
  Demo: lint:css + overlay lint at zero; the R2 rule-body lock green.
- Step 3: `setupAmbientMode` rewrite on the new pipeline; the jsdom behavioural tests;
  retire the obsolete locks in `watch-chrome-ambient.test.js`. Demo: full suite green
  on both Nodes; the R1 source lock green; mutants red.
- Step 4: headless Chromium desktop run + screenshot; numbers into this doc. Demo: a
  falling-off tint outside the player.
- Step 5: ROADMAP + ledger correction text drafted (lands with the release entry -
  DISCLOSED: not in the gated diff; drafted in the session scratchpad `release-texts.md`,
  committed in the release commit per docs/RELEASING.md, acceptance bullet 7).
- Step 6: gate (full: adversary + qa), then Dean's iPhone check, then release.

## Follow-ups noted (not this wave)
- Dean, 2026-09-23 device check of v1.311.3: everything passes; "the skin resides
  oddly for a second before settling" after a rotate - most likely the desktop-panel
  paint before `watchSkinViewport`'s re-render on the 768px crossing. Own item.
- R2 (page behind faux fullscreen stays moved after a drag) does NOT happen with
  ambient OFF (Dean, 2026-09-23) - it shares the ambient cause and is re-checked on
  device with the new glow; if it persists with ambient ON, measure
  `document.body.style.position` in faux fullscreen.

## Build record

- **Commit fc254315** (Steps 1-3): `watch.js` gains the pure helpers (`ambientSourceFor`,
  `ambientEdgeColors`, `ambientLift`, `ambientGlowVars`) + `createAmbientEngine` at module
  level (exported, fake-driven) and `setupAmbientMode` becomes the wiring; `watch.html`
  swaps the canvas for the div pair; `style.css` replaces the blur/mask/scale block with the
  gradient geometry + an opacity ladder. New `test/unit/ambient-glow-engine.test.js` (16);
  six canvas-era locks retired from `watch-chrome-ambient.test.js`. Unit suite 6913/6913
  (Node 22); `lint:css` 0; overlay lint 0.
- **Mutation round @fc254315** (git-archive sandbox, the two ambient files, baseline 30/0):
  16 mutants, **15 killed** - same-tile repaints, sprite failure never falls, the VIDEO as
  the draw source, front never swaps, wiring never starts the engine, eager mediaData,
  audio on the sprite rung, artUrl ignored, CSS blur / transform / mask returning, band-x
  drifting from reach, a corner gradient dropped, a non-increasing ladder, the canvas
  markup returning. **1 survived - EQUIVALENT:** dropping `hardFailed ||` from `start()`'s
  first guard changes nothing observable because `start()` re-checks `hardFailed` right
  after `check()` (the S1 guard). Not a test gap; recorded honestly.
- **Step 4 desktop end-to-end @fc254315** (headless Chromium 1600x1000, the in-process
  server, a 30s VP9 `testsrc2` clip with a drifting hue + a sprite built with
  `lib/storyboard`'s own ffmpeg args; script `ambient-desktop-probe.js` + JSON + PNG in the
  session scratchpad; the Playwright Chromium has no H.264 and its ffmpeg is a minimal
  build, so a static ffmpeg 7.0.2 was pulled into the scratchpad):
  - dark, `ft-ambient=1`, playing: `#ambient-glow` `hidden:false`, `is-on`, root
    `data-ambient-on` set; computed `filter: none`, `transform: none`, `mask: none`,
    `will-change: auto`; the glow box is 1138x802 around a 918x557 player = **12% / 22%
    reach exactly**; the front layer carries eight `rgb()` vars (green left edge, pink
    right edge - the tile's colours); zero page errors.
  - ~10s later the front layer had swapped (index 1 -> 0) with a different `--ag-t`:
    the tile-change cross-fade works against the real sprite route.
  - toggling the cog switch off: `hidden`, no `is-on`, root attribute cleared,
    `ft-ambient` stored `0`.
  - pixel profile at `normal` (RGB over the page's [18,18,18]), right of the player at mid
    height: 5px [110,65,78] · 25px [89,54,65] · 50px [67,43,51] · 75px [46,33,38] ·
    100px [27,22,24] · 130px [18,18,18]. Below: 5px [61,60,65] · 50px [48,48,49] · 100px
    [28,28,28] · 200px [18,18,18]. Falls off smoothly to the page within the reach, no
    hard edge.
  - **Finding (brightness):** the edge PEAK at `normal` is ~+92/+47/+60 - about 3x
    YouTube's measured ~+16/+25/+13. The reach matches YouTube; the intensity does not.
    The ladder numbers Dean approved (0.35/0.55/0.75/1.0) were set before this
    measurement, so this returns to Dean: keep them (a stronger glow than YouTube) or
    rescale to YouTube's peak (~0.18/0.30/0.50/0.80). Awaiting the call.
  - Honest note on the synthetic clip: its hue drifts 36 deg/s, so a tile sampled up to
    2.7s from the live frame shows a visibly different hue than the picture; real footage
    changes far slower and the sprite tile tracks it.
- **Dean's call on brightness (2026-09-23): "1. Yes, 2. No need for ladder really. We can
  just do YouTube style."** -> one opacity, no picker. Second commit: `--ambient-opacity:
  0.3` on the base rule, `is-on` reads it; the four rungs, the `Ambient amount` cog row,
  `resolveAmbientLevel`/`AMBIENT_LEVELS` (+ exports), the `#ambient-level-row` CSS, the dead
  `.settings-menu-select` rule and the `ft-ambient-intensity` key (client list, server
  `lib/prefs-allowlist.js`, the test authority, the sync plan; `lib/user/routes.js`
  comments 21 -> 20) are removed. Tests: the two v1.187 ladder tests retired; the engine
  file now binds the ladder's ABSENCE (wiring, watch.js, both allowlists, CSS) and the
  single opacity in [0.25, 0.35].
- **Step 4 rerun at 0.3** (same clip, same script): `is-on`, computed opacity 0.3,
  `filter/transform/mask: none`, front swapped by ~13s, off tears down, zero errors.
  Profile right of the player: 5px [68,44,51] · 25px [57,38,44] · 50px [45,32,36] · 75px
  [34,26,29] · 100px [23,20,21] · 130px [18,18,18] (page). Below: 5px [42,42,44] · 50px
  [34,34,35] · 100px [23,24,24] · 200px page. Peak ~+50 on the dominant channel vs
  YouTube's ~+25: halved from the first cut; the remaining gap is mostly the synthetic
  clip's saturated primaries (YouTube was measured on a meadow). The screenshot reads
  as a faint halo. Dean's phone judges; the one knob is `--ambient-opacity`.
- **Mutation round 2 @d2ac8876** (sandbox, the three ambient/prefs files, baseline 45/0):
  6 mutants, **6 killed** - opacity back to 0.55, a `data-ambient` rung rule returning, the
  dead key re-added to the CLIENT list (triple lock + engine lock), re-added to the SERVER
  list, the wiring writing the dead key, the cog amount row returning.
- **Dual-Node full suites @d2ac8876:** `npm test` on Node **22.23.1: 8962 tests, 8962 pass,
  0 fail (exit 0)**; Node **24.20.0: 8962 / 8962 / 0 (exit 0)**. Sequential, idle box.

## Gate

Seats per `.harness/scrutiny.toml` against `git diff --name-only bd9c476f`: `lib/**`
(prefs-allowlist, user/routes) -> core-logic FULL (adversary + qa); the forced
`**/*client*` row matches `test/unit/prefs-sync-client.test.js` -> security-brief unions
in. Three seats, r1.

Gate: APPROVED r1 @97d6f542 — security-brief

Gate: CHANGES r1 @97d6f542 — qa

Gate: CHANGES r1 @97d6f542 — adversary

### Gate r1 findings and the r2 fix (@97d6f542 -> the fix commit)
- security-brief: APPROVED. INFO-1 stale "21-key" prose (fixed: prefs-sync.js comment,
  cross-device-sync.md); INFO-2 pre-existing `ft-ambient-intensity` rows stay in
  `user_prefs` for existing users - served by GET /api/prefs, ignored by the client,
  rejected on POST, dropped on restore: harmless, DISCLOSED, no cleanup shipped.
- adversary F1 CRITICAL (own goal - the INERT FEATURE class I named in blind-spot 2 and
  then drove with a divergent fixture): the `?tv=` path has no `mediaId`
  (resolveWatchMediaId reads ?v=/?id= only) and every rung was id-gated, so tv episodes
  lit the DOM with nothing painted. FIX: `ambientSourceFor` takes the poster rung on a
  non-empty `artUrl` with no id (the tv descriptor always carries one; `lib/tv/routes.js`
  source-locked); only sprite/thumbnail need the id. Bound by driving the REAL shape
  (mediaId null + the tv descriptor) through both the pure ladder and the engine, and a
  wiring lock that `mediaId: mediaId,` reaches the engine.
- adversary F2 = QA W1: an ASYNC sample failure stopped the engine's clock but the wiring's
  `is-on` / `hidden=false` / root `data-ambient-on` stayed set until the next off-signal.
  FIX: the engine takes `onHardFail`; `fail()` calls it once; the wiring routes it to its
  own `stop()`. Bound: the callback fires exactly once after the load, never on a refused
  re-start; wiring regexes for `onHardFail: function () { stop(); }` and the
  `engine.hardFailed()` guard in `start()` (M17).
- adversary F3: the CSS constraint lock swept only selectors containing `.ambient-glow`;
  `#ambient-glow {...}`, `.watch-player-stage > div:first-child` and a `transform` on
  `.watch-player-stage` shipped green. FIX: the sweep now covers every rule whose
  selector mentions `ambient-glow` OR `watch-player-stage` in any form (9+ rules,
  the stage base rule asserted present).
- adversary F4 (M13/M14/M16): tests added - a sync sample throw on the clock never re-arms;
  a zero-size image is a failed source and falls to the poster; a slow sprite is
  requested once across many clocks and paints the CURRENT tile when it lands.
- QA W2: the stale "ladder" sentence in `ambientLift` rewritten. QA S1 / adversary F5:
  plan frontmatter sha, the Design's ladder text and blind-spot 4 struck/annotated;
  Step 5 disclosed as landing in the release commit. QA S2: the prefs test title and
  the tv-harness comment reworded. QA S3: the Ambient row's light belt + `[hidden]
  !important` override re-locked. QA S4 DISCLOSED: the old per-tick `shouldRun` belt
  is gone - a buffering stall (no pause event) keeps the glow lit at one no-paint
  check per second; the battery floor holds (no paint on the same tile), and every
  real off-signal still tears down.
- adversary suspicion M1b (`var v = video; v.captureStream()` slips the source lock):
  inherent to source locks; the fake-driven constraint test binds drawImage's source,
  not captureStream. Accepted, not chased.

Gate: APPROVED r2 @33275a31 — security-brief

Gate: APPROVED r2 @33275a31 — qa

Gate: APPROVED r2 @33275a31 — adversary

Gate r2 close: all three seats APPROVED @33275a31. Dual-Node full suites at that sha:
Node 22.23.1 8967/8967/0 (exit 0), Node 24.20.0 8967/8967/0 (exit 0). Remaining before
release: acceptance bullet 1 - Dean's iPhone confirms the picture stays with ambient ON.
