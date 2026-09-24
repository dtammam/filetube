---
plan: music-desktop-ambient
harness: v2 · lean
branch: feat/music-desktop-ambient
anchor: spec
status: Shipped v1.318.0
next: gate CLOSED r3 @61904f6c (adversary + qa; round 3 by Dean's ruling to fix the natural-end blink before release). Release as v1.318.0 (Dean: tag without waiting for his device check). Owed: Dean's device check (desktop /music, dark, ambient on: the glow paints from the album art, holds across a track change and a natural end, clears on off / light / pause / nav away); the adversary's side observation that the music queue still advanced with the music autoplay pref at 0 (unverified, outside M4); X2 / X8 / E11 / N8b are text-lock-only or judged equivalent
design: Approved 2026-09-23 @ef42a6d4 (Dean: "GO." on D13/D14 in the wave umbrella)
gate: APPROVED r3 @61904f6c — adversary, qa
---

# Desktop music ambient (wave item M4)

Dean: "Ambient mode in the music player in desktop." And: "I have ambient mode selected in
this player but I don't see any ambience for the music. Maybe because the album art is a still
image."

Base: main 660d4f5b + `fix/music-theatre-button` (T1) merged in as cf1b4f1e (T1 touches
watch.js and music.js too). The wave umbrella (register D1-D15, intake record, survey anchors
at v1.314.0) lives on the branch feat/music-channel-chapters, in its exec plan
2026-09-23-music-channel-chapters-wave.md (not on this branch); this doc carries only M4
and its bound markers (one piece, one plan).

## The ask

| ID | Decision (Dean's go, 2026-09-23) |
|----|----------|
| D13 | Factor the watch wiring into a shared `createAmbientHost(opts)` in a new `public/js/ambient.js` loaded on EVERY shell (shell-parity census), driving the SAME engine (`createAmbientEngine`) with the album art as the image rung (music's art helper, BASE media id, never `::c`, same-origin only); a toggle row in the desktop music UI; dark mode only; pref key `ft-ambient` shared with watch. |
| D14 | After v1.315.0 (landed); measure with a probe; Dean's device check before the tag. |

Out of scope (the umbrella's list): mobile music ambient (desktop first, Dean), a dedicated
channel page, per-user bells, Pause's reload, podcast chapter likes.

## Re-verified survey (at cf1b4f1e, before any edit)

Every spec anchor was re-read; the code had moved.

| Spec claim | At cf1b4f1e | Verdict |
|---|---|---|
| `createAmbientEngine(opts)` watch.js:219 | watch.js:265 (top level, before the view IIFE) | moved, shape as described |
| `ambientSourceFor` :121-139: sprite only for `type:'video'` + storyboard, else `{kind:'image', url: artUrl or /thumbnail/<id>}` | watch.js:134 | verified; with `mediaId` null and an `artUrl`, the image rung takes the art (the tv shape) - the music shape reuses exactly that |
| `isAmbientEnabled` :58, `ambientShouldRun` :69, `isDarkMode` :73 | watch.js:58 / 69 / 73 | verified |
| wiring `setupAmbientMode` :2373-2465 inside the view IIFE | watch.js:2452, inside the view IIFE (closure over `root`, `mediaData`, `mediaId`, `signal`) | verified: not reusable as-is |
| the globals are implicit + `module.exports` :891-910, not on `window.FileTube` | module.exports at watch.js:970 | verified |
| watch.js loads before the lazy music.js (index.html:356, music.html:365-368, common.js:10516) | music.html:361 watch.js / :364 music.js; common.js:10516 `music: '/js/music.js'` (the lazy view map) | verified |
| "Toggle UI: watch.html `#watch-ambient-check` / `#ambient-toggle-row`" | NOT in watch.html: watch.js `ensureCogControlsInjected` (watch.js:2358) injects the row into the PERSISTENT player host's cog menu (`#settings-menu`), id-guarded | corrected - and this IS Dean's report: the row rides the persistent host into Music after a watch visit, checked and inert (bound only on the watch view's signal) |
| `musicArtUrl` music.js ~210-219 | music.js:221: explicit art wins, else `/albumart/<id>`; projected / listen tracks carry `/thumbnail/<base>` as their own `artUrl` | verified |
| music.html:176-184 `#music-stage` wraps `#player-slot` + the panel | music.html:172-180 | verified |
| `.music-stage` block style.css:10848, flex in theatre :10869-10879 | style.css:10889, theatre block :10909-10920 (`.music-stage.is-theater #player-slot { flex: 2 1 0 }`) | moved; the theatre rule targets the slot, so a wrapper needs its own flex rule |
| glow markup watch.html:155-161; CSS :9054-9133 incl. the fullscreen / audio-expanded drop whose comment says only watch has a stage | watch.html:155-161; `.watch-player-stage` style.css:9057, `.ambient-glow` :9105, the drop comment "Only .watch-player-stage exists" :9170 | verified |
| sidebar bleed style.css:1096 | style.css:1121 | moved |
| existing probe scripts | none committed for ambient (`scripts/action-row-probe.js` is the boot/CDP pattern); the v1.312-v1.315 probes lived in session scratchpads | adapted a scratchpad probe (below) |

Two findings that shaped the build:

1. **The music player host is cloned LAZILY** (player.js `ensureHost`, first `load()`), so on a
   cold `/music` there is no media element and no cog menu at init. The host must bind at the
   mount seam, not at init (the same shape T1 met for `#theater-btn`).
2. **The music view advances WITHOUT a reload** (queue advance, chapter roll): the engine's
   `mediaId` is fixed at creation, so an id-keyed source would freeze on the first track - the
   crown-jewel "re-register at every advance" class. The music source is therefore the art URL,
   re-read from the CURRENT track on every engine clock (`getMediaData`), with `mediaId: null`.

## Design

- **`public/js/ambient.js` (new)**: the helpers + engine MOVED VERBATIM from watch.js (every
  v1.312-v1.314 line and lock unchanged), plus:
  - `createAmbientHost(opts)` - the old `setupAmbientMode` body, parameterised: `glow`,
    `check`, `row`, `getMedia()` (the LIVE media element, re-read and bound at the first
    evaluate that finds it), `getMediaData()`, `mediaId`, `storyboard`, `signal`, and two
    optional hooks the watch view does not pass: `canRun()` (ANDed into the gate) and
    `observe` (an element whose childList change re-evaluates). The engine receives a
    currentTime VIEW of the media (`mediaClock`), never the element. Teardown on the view's
    abort stops the engine, aborts the media binding's own controller, disconnects both
    observers, and a torn host ignores any later `evaluate()`; a host requested for an
    already-aborted view is never built.
  - `ensureAmbientToggleRow(doc)` - the ONE writer of the cog's Ambient row (the v1.186 ids),
    id-guarded: whichever view mounts first writes it, the other reuses it.
  - `ambientSameOriginUrl(url)` - resolved against the page origin; refuses cross-origin,
    protocol-relative, backslash, `data:` and no-origin (fails closed).
  - the engine keeps ONE decoded image (the current source's): the music source walks a new
    URL per track, so a map of every decoded cover would grow with the queue. Failed markers
    are kept (a known-bad URL is never re-requested).
  - published as `window.FileTubeAmbient` (the body-scroll-lock / wheel-config convention) and
    `module.exports`; the declarations stay classic-script globals exactly as they were in
    watch.js.
- **watch.js**: `setupAmbientMode` is a thin call into the host with the same collaborators it
  always used (no `canRun`, no `observe` = the v1.312 behavior); the cog injection writes
  Autoplay + Loop under their OWN id guard and lands them BEFORE an Ambient row a music mount
  already wrote, then calls the shared row writer; the Node exports re-export ambient.js (one
  import path for the suite).
- **music.js**: `syncAmbient()` is the FIRST statement of `updateNowPlayingPanel` (the seam
  every track change, chapter roll, expand, skin-viewport crossing and init lands on): it builds
  the host once per init when the player host (and so the cog menu) exists, else re-evaluates.
  The view's gate `ambientEligible()` (read live): not the phone breakpoint (the real
  `music-skins.js` `isMobileViewport`), a current MUSIC track (the panel's own
  `nowPlaying.id === effectiveCurrentId()` guard), the media element mounted in THIS view's
  `#player-slot` (docked / closed = nothing to glow around), and same-origin art. The art is
  `musicAmbientArtUrl(id, entry.artUrl, activeListenId)`: the cover rule on the BASE id (a `::c`
  chapter shares its file's art; the listen marker keeps its thumbnail route). `observe` is the
  slot, so a dock / expand (no media event fires) re-evaluates.
- **music.html**: `#music-player-stage.music-player-stage` wraps the glow pair (born hidden) and
  `#player-slot` inside `#music-stage` (the watch shape).
- **CSS**: the stage takes `position: relative; z-index: 0` above 768px ONLY (a z-indexed
  ancestor would trap the phone skin's fixed covers - the v1.166 class); the fullscreen /
  audio-expanded drop covers `.music-player-stage`; a phone belt hides the music glow; the cog
  row is hidden on every view that does not wire it and in the phone music view (the T1
  `#theater-btn` rule, same reason); in theatre the stage is the flex item and the player's
  `.player-container` bottom margin moves OUT to the stage (measured below).
- **Shells**: `<script src="/js/ambient.js">` immediately before watch.js in all eleven app
  shells (ten in public/ + lib/ytdlp/views/subscriptions.html).
- **server.js**: exports `publicTrackListItem` so the music test drives the row shape the
  server really emits.

## Acceptance (each names its binding test)

1. **Paint (the real ?play= shape):** dark + ambient ON + playing on a desktop music view, a
   chapter opened through the real `/music?play=<base>::c1` continue path paints the glow from
   `/thumbnail/<base>` (never a `::c` URL) as a PNG data URL on a layer, through the real
   template's cog row. `test/unit/music-ambient.test.js` AC1.
2. **Paint (row tap) + advance + chapter roll:** a native track paints from `/albumart/<id>`; the
   next track's cover is requested and cross-faded on the engine clock; a chapter change inside
   one file requests nothing new. music-ambient AC1b, AC1c; the engine's one-image cache
   `ambient-glow-engine.test.js` "only the CURRENT source's image is kept". Gate r1: AC1c is a
   row TAP; the playhead ROLL (no reload) is bound by music-ambient "a real CHAPTER ROLL", and a
   track change never drops the glow across the player's load gap (music-ambient "a TRACK
   CHANGE through the real row tap", ambient-host "the LOAD-GAP hold"). Gate r2: nor across a
   natural-end queue advance (music-ambient "a NATURAL-END queue advance in its real shape",
   ambient-host "the END hold").
3. **Every OFF axis paints nothing; the CLEAR axis on a populated glow:** pref off, light, paused,
   hidden tab, the view gate false; and pause / toggle off / flip to light / tab hidden / gate
   false each clear a LIT glow. `ambient-host.test.js` (two tests), music-ambient AC2, AC2b, AC2c.
   Gate r2: every hold clears on the same axes, a finished queue clears at the end bound and a
   failed load at its error (ambient-host "a hold never swallows a real clear", music-ambient
   "a FINISHED queue", "a load that FAILS").
4. **Desktop only; mounted here only; music only; same-origin only:** the phone breakpoint, a
   dock (and back), a podcast expanded into the music slot, a cross-origin art URL.
   music-ambient AC3, AC4, AC5, AC6; `ambientSameOriginUrl` table in ambient-host.
5. **Teardown:** soft-nav away clears a lit glow + the root sidebar signal, every signal the
   wiring bound on is aborted, both observers are disconnected, and the dead listeners never act
   again; a late seam of a dead view (a slow `?play=` fetch) never lights the next page, with
   the host never built (a) and built then torn (b). music-ambient AC7, AC8 (a)(b);
   ambient-host teardown + already-aborted tests.
6. **The pref key is shared with watch and the row is ONE control:** the toggle writes / reads
   `ft-ambient`; a cold music mount writes the row and the REAL watch injector (lifted from
   watch.js and executed) adds Autoplay + Loop before it; watch-first then music reuses the
   row. ambient-host "writes the SHARED pref key", music-ambient AC2, AC9.
7. **Watch keeps working exactly as today through the shared host:** the watch shape paints the
   sprite through the host's default loader; every pre-existing ambient test green (the locks
   re-pointed to ambient.js with the same assertions); watch.js keeps no hand-copy.
   ambient-host "watch shape", `ambient-glow-engine.test.js` (WIRING LOCK on the host + the
   "no hand-copy" test), `watch-chrome-ambient.test.js`, `watch-init-behavioral.test.js` (now
   runs the real host).
8. **Every v1.312 lock holds for the music stage:** no filter / transform / mask / etc. in any
   spelling on `.music-player-stage` / `#music-player-stage` / `.music-stage` rules, the stage
   context exists, the fullscreen + audio-expanded drop covers it, no canvas, the glow pair is
   born hidden. `ambient-glow-engine.test.js` CSS LOCK, `watch-chrome-ambient.test.js` drop
   test, music-ambient CSS tests.
9. **Shell parity:** every app shell (derived each run: 11) loads ambient.js exactly once, before
   watch.js / player.js / music.js. `shell-script-global-collisions.test.js` ambient census.

## Known seams (disclosed)

- **The glow reaches past the viewport on a full-width desktop player, like the watch page in
  theatre.** MEASURED at 1600x1000: the non-theatre music player is 1322x784.5, so the glow box
  is x 95.4 w 1639.25 (scrollWidth 1735 > 1600); the watch page in theatre with the same item
  measures the IDENTICAL box and scrollWidth. The root `html { overflow-x: clip }` holds both: a
  real horizontal wheel leaves `scrollX` 0 on both pages. Parity, not a new class; the phone
  landscape half is tracker #234.
- **The glow's lower reach overlaps the top of the up-next panel stacked below the player**
  (non-theatre desktop; read, from paint order): the stage is a positioned context, painted after
  the in-flow panel that follows it, so the glow's bottom band tints what sits in its reach (the
  watch stage has the same order over its title - not separately measured). Sampled at 1600: 25px
  below the player [38,39,53] against the page's [18,18,18].
- **The theatre up-next cap is 16px shorter than before**: music.js caps the panel to the
  measured `#player-slot` height, which in theatre included the player's own 16px bottom margin
  while the slot was the flex item (read from the cascade; the pre-M4 tree was not probed); it now
  measures the player itself (the probe: panel `max-height` 530.625px). The row below keeps its
  16px of air (the margin moved to the stage; measured `#music-stage` 546.6 = 530.6 + 16).
- **Autoplay / Loop cog rows stay visible-but-inert in the music view after a watch visit**
  (pre-existing, not this item): the watch injector writes them into the persistent host and
  binds them on the watch signal; music has its own toolbar Loop / Autoplay. The Ambient row is
  now scoped by CSS to the views that wire it; the same scoping for the other two is a one-rule
  follow-up (Dean's call).
- **The desktop pop-out window carries no glow** (it renders a skin in its own window; not wired,
  not in the ask).
- **The natural-end blink: FIXED at gate r2** (Dean's ruling, 2026-09-24). At r1 a track's
  natural end cleared the glow until the next track's 'playing' (MEASURED then: 5 of 443 samples
  dark, 1281 to 1325 ms). Music now opts into a bounded END hold (`endHoldMs`, 1.5 s) that hands
  over to the load hold when the next load begins. MEASURED in headless Chromium at the r2 fix
  tree: a natural-end advance 0 of 444 samples dark; a FINISHED queue (nothing next) clears
  1517 ms after 'ended' (the 1.5 s bound, armed at the end's 'pause'); a Songs-row tap 0 of 378
  dark. Residual, by design: if the queue fetch takes longer than 1.5 s the glow clears and
  re-lights on 'playing' (bounded, like any finished queue).
- **A failed load clears at its error** (gate r2, adversary S1). At r2 a row tap on a corrupt
  mp3 held the glow around the failed player for the whole 8 s load bound (the adversary measured
  7975-7998 ms). Now a load with `media.error` set is not a load gap, and the host re-evaluates on
  'error'. MEASURED in headless Chromium (a corrupt mp3, `media.error` 4): 'emptied' at 17 ms still
  lit, 'error' at 50 ms dark, the first dark poll sample at 64 ms. A load that STALLS without an
  error (a hung network) still holds for the 8 s bound, then clears.

## Build record

Built 2026-09-24 on `feat/music-desktop-ambient` (off main 660d4f5b; setup merge of T1 at
cf1b4f1e - T1's tracker row, a second `| 235 |`, renumbered to 236 per the chapter-likes gate's
"renumber whichever merges second", with T1's two plan cites updated).

Per file:

- `public/js/ambient.js` (new): watch.js lines 56-429 moved verbatim, plus the host, the row
  writer, the same-origin guard, `forgetOtherImages`, the exports.
- `public/js/watch.js`: the moved block replaced by a pointer comment; `setupAmbientMode` is a
  host call; `ensureCogControlsInjected` writes Autoplay + Loop under their own guard and calls
  the shared row writer; `module.exports` spreads `module.require('./ambient.js')` (the
  player.js / skin-surface.js convention; the browser-env lint has no `require`).
- `public/js/music.js`: `musicAmbientArtUrl` (pure, exported with `musicArtUrl`); the init's
  ambient block (`ambientCurrentArt`, `ambientEligible`, `syncAmbient`); `syncAmbient()` first
  in `updateNowPlayingPanel`.
- `public/music.html`: the stage + glow pair around `#player-slot`.
- Eleven shells: `ambient.js` immediately before `watch.js`.
- `public/css/style.css`: the stage (desktop), the drop, the phone belts, the row scoping, the
  theatre flex item + margin move; comments re-pointed from watch.js to ambient.js.
- `server.js`: `publicTrackListItem` exported.
- Tests: new `test/unit/ambient-host.test.js` (10 tests) and `test/unit/music-ambient.test.js`
  (18); `ambient-glow-engine.test.js` re-pointed to ambient.js (the WIRING LOCK rewritten for
  the host with every old assertion kept, a watch-side "no hand-copy" test, the one-image
  cache test, the CSS / HTML locks extended to the music stage); `watch-chrome-ambient.test.js`
  (the cog lock re-pointed to the shared writer, the v1.188 funnel lock to the host, the drop
  test extended); `watch-init-behavioral.test.js` loads ambient.js into its realm (the watch
  path now runs the real host); `shell-script-global-collisions.test.js` gains the dynamic
  ambient.js census.

Instruments at the staged tree (Node v22.23.1): `npm run lint:css` TOTAL 0;
`node scripts/overlay-containment-lint.js --enforce` clean (0 violations); eslint on every
touched js file: 0 errors, 0 warnings. Targeted suites (ambient*, watch*, music*, the player /
shell / sidebar parity files, docs-*, exec-plans*, tech-debt*, podcast-nowplaying*, theatre*,
prefs-sync*, comment-debt*): see "Targeted suites" below.

### Measurements (headless Chromium, the probe)

The probe (session scratchpad `m4-music-ambient-probe.js`, the `scripts/action-row-probe.js`
boot/CDP shape) boots this tree with ONE library audio item (a real mp3, a two-colour PNG cover:
left half [208,32,144], right half [32,192,208]), opens `/music?play=aud1` dark with
`ft-ambient` = 1, plays it, and reads:

| Reading | Non-theatre 1600x1000 | Theatre 1600x1000 |
|---|---|---|
| lit (is-on, unhidden, `data-ambient-on`) | yes | yes |
| glow computed filter / transform / mask / will-change | none / none / none / auto | same |
| stage position / z-index / contain / isolation | relative / 0 / none / auto | same |
| player (slot) box | 1322 x 784.5 at (254,122) | 870.7 x 530.6 |
| stage box | = the slot | = the slot (546.6 before the margin move) |
| glow box | x 95.4 w 1639.25 h 1129.66 (the slot grown 12% / 22% each side) | x 149.5 w 1079.6 h 764.1 (870.7 x 1.24, 530.6 x 1.44) |
| front layer | `url("data:image/png;base64,iVBOR...` opacity 1 | same |
| cog row | in `#settings-menu`, checked, display flex | same |
| pixel 5 / 25 / 50 px right of the player | [18,65,70] (25 / 50 px are past the viewport) | [18,64,68] / [18,50,53] / [18,34,36] |
| pixel 5 / 25 / 50 / 100 px left | [71,18,52] / [60,18,45] / [48,18,37] / [28,18,25] | [69,18,51] / [53,18,41] / [37,18,30] / [18,18,18] |
| pixel 5 / 25 / 50 px below | [42,44,62] / [38,39,53] / [32,33,44] | [44,41,60] / [36,35,48] / [28,28,35] |
| pixel 5 px above | [43,44,63] | [44,42,61] |
| page far corner (1590,990) | [18,33,34] (inside the glow box) | [18,18,18] |
| scrollWidth / innerWidth; after a real horizontal wheel | 1735 / 1600; scrollX 0 (`html` overflow-x clip) | 1600 / 1600; scrollX 0 |

The left glow is magenta and the right teal: the cover's own halves (the bitmap stretches the
image over the glow box). In theatre, 5px above [44,42,61] and 5px below [44,41,60] are
symmetric; before the margin move the stage was 546.6 tall and 5px below read [47,45,66] (the
vignette's inner rectangle 16px low).

- **OFF axis:** the cog checkbox unchecked -> hidden, not is-on, no `data-ambient-on`,
  `ft-ambient` = "0"; 2.6s later 25px right / below read [18,18,18] (the page).
- **Light:** back ON, then `data-mode` light -> hidden, not is-on, no `data-ambient-on`, the row
  `hidden`.
- **Phone 390x844 (mobile emulation), playing:** glow hidden, display none, not lit, no
  `data-ambient-on`, stage `position: static` / `z-index: auto`, the cog row display none, the
  skin up (`mms-on`), scrollWidth 390, no page errors.
- **Watch baseline (same item, `ft-theater` = 1, 1600x1000):** lit, glow box x 95.375 w 1639.25
  h 1129.66, slot 1322 x 784.5, scrollWidth 1735 / 1600, wheel scrollX 0 - the same geometry as
  the non-theatre music view.

## Mutation results

Sandbox: `git archive` of the staged tree (4a97d560; the M13/M14 re-run at 7d67d216), each
mutant applied to one file, the named binding files run, the file restored; runner in the
session scratchpad (`m4-mutants.js`). "First red" is the first failing test the runner printed.
M3 and M4 build an unowned host by construction, whose engine clock then holds the test process
open after its red test; the runner kills it at the timeout and counts the red line.

| # | Mutant | Result | First red |
|---|---|---|---|
| M1 | host: drop the view gate (`&& !!canRun()`) | KILLED 7 fail | host: every gate axis OFF paints nothing |
| M2 | host: no `observe` (slot) observer | KILLED 4 fail | host teardown (the observer count) |
| M3 | host: build a host for an already-aborted view | KILLED 1 fail (then held open) | host: a host requested for an ALREADY-aborted view |
| M4 | host: a torn host still evaluates | KILLED 1 fail (then held open) | host teardown (a late evaluate re-lights) |
| M5 | host: teardown leaves the media binding | KILLED 2 fail | host teardown (signals aborted) |
| M6 | host: teardown leaves the slot observer connected | KILLED 2 fail | host teardown |
| M7 | host: teardown leaves the theme observer connected | KILLED 2 fail | host teardown |
| M8 | host: re-bind the media on every evaluate | KILLED 2 fail | host teardown |
| M9 | host: bind the media only at creation | KILLED 11 fail | host, watch shape |
| M10 | host: the row is never re-synced | KILLED 2 fail | host: the cog toggle writes the SHARED pref key ... light hides the row |
| M11 | host: default gate false | KILLED 3 fail | host, watch shape |
| M12 | host: the toggle does not persist the shared key | KILLED 2 fail | host: the cog toggle writes the SHARED pref key |
| M13 | engine: keep every decoded image | KILLED 1 fail | engine: only the CURRENT source's image is kept |
| M14 | engine: forget FAILED markers too | run 1 SURVIVED (28 pass / 0 fail): the test returned to the still-PAINTED url, which never reaches the drop; test fixed to integrate a NEW source in between; re-run at 7d67d216 KILLED 1 fail | engine: only the CURRENT source's image is kept |
| M15 | same-origin guard always passes | KILLED 2 fail | ambientSameOriginUrl table |
| M16 | same-origin guard fails open with no origin | KILLED 1 fail | ambientSameOriginUrl table |
| M17 | row writer without its id guard | KILLED 3 fail | ensureAmbientToggleRow: the ONE writer |
| M18 | music: `updateNowPlayingPanel` never reaches `syncAmbient` | KILLED 10 fail | music AC1 |
| M19 | music: no desktop-only gate | KILLED 1 fail | music AC3 |
| M20 | music: no current-MUSIC-track guard | KILLED 1 fail | music AC5 |
| M21 | music: no mounted-here guard | KILLED 1 fail | music AC4 |
| M22 | music: art not checked same-origin | KILLED 1 fail | music AC6 |
| M23 | music: no base-id strip | KILLED 1 fail | music musicAmbientArtUrl |
| M24 | music: no slot observer passed | KILLED 2 fail | music AC4 |
| M25 | music: the host rides no signal | KILLED 14 fail | music AC1 |
| M26 | music: the listen marker ignored | KILLED 1 fail | music musicAmbientArtUrl |
| M27 | watch: Autoplay + Loop always appended | KILLED 1 fail | music AC9 (the menu order) |
| M28 | watch: the row writer never called | KILLED 1 fail | watch-chrome: ensureCogControlsInjected |
| M29 | watch: `setupAmbientMode` passes a null descriptor | KILLED 1 fail | engine: watch.js keeps no hand-copy |
| M30 | CSS: the music stage not dropped in audio-expand | KILLED 2 fail | music CSS: the stage context (the drop line) |
| M31 | CSS: the music stage owns no context | KILLED 2 fail | engine CSS LOCK |
| M32 | CSS: the music stage context unscoped | KILLED 1 fail | music CSS: the stage context |
| M33 | CSS: `-WEBKIT-FILTER` on the theatre stage | KILLED 1 fail | engine CSS LOCK |
| M34 | CSS: `translate` on `#music-player-stage` | KILLED 1 fail | engine CSS LOCK |
| M35 | CSS: the row view-scope rule removed | KILLED 1 fail | music CSS: the row shows only where wired |
| M36 | CSS: the phone music row belt removed | KILLED 1 fail | music CSS: the row shows only where wired |
| M37 | CSS: the theatre margin left on the player | KILLED 1 fail | music CSS: the stage context / margin |
| M38 | CSS: the phone glow belt removed | KILLED 1 fail | engine CSS LOCK |
| M39 | podcasts.html drops ambient.js | KILLED 1 fail | census: public/podcasts.html |
| M40 | subscriptions.html drops ambient.js | KILLED 1 fail | census: lib/ytdlp/views/subscriptions.html |
| M41 | index.html loads ambient.js after watch.js | KILLED 1 fail | census: public/index.html |
| M42 | the music glow pair not born hidden | KILLED 2 fail | engine CSS LOCK (the markup assertion) |
| M43 | watch.js keeps a hand-copy of an engine helper | KILLED 1 fail | engine: watch.js keeps no hand-copy |

43 mutants, 43 killed (M14 after a test fix, re-run recorded). Two guards whose mutants could
not be bound were removed rather than kept: `ambientEligible`'s `getState() === 'full'` check
(the mounted-in-this-slot check subsumes it) and the host's media RE-bind branch (the player
clones one media element per page and never replaces it). A first run also exposed that a red
host test could leave a live engine clock and hang the runner; `restore()` now always aborts
the view first.

### Targeted suites

Node v22.23.1, the staged build tree plus this doc, one run over 13 globs (ambient*, watch*,
music*, player-*parity*, shell-*, sidebar-nav-parity, docs-*, exec-plans*, tech-debt*,
podcast-nowplaying*, theatre*, prefs-sync*, comment-debt*): tests 839, pass 839, fail 0,
cancelled 0, skipped 0. The full unit suite runs in the pre-commit hook; its result is in the
commit record (the hook refuses red).

On the real main: build commit 45815d94 (hook: 7021 tests, 7021 pass, 0 fail); main with T1
merged at 63b22a5f (targeted 841/841; hook 7023/7023); main with M1+M2 (b71fcd32) merged in
the next commit - the same 13 globs plus skin-surface* on the merged tree: tests 967, pass 967,
fail 0; `lint:css` TOTAL 0; overlay-containment clean; eslint 0 on ambient.js / watch.js /
music.js; `syncAmbient()` is still the first statement of `updateNowPlayingPanel`.

## Gate r1 - qa (@c285adcb)

Reviewed `git diff b71fcd32 c285adcb` (23 files), Node v22.23.1. Instruments, verbatim:

- 228 unit files (every test/unit file reading watch.js / music.js / ambient.js / style.css / a
  `.html` shell, plus every `*parity*`, `shell-*`, `docs-*`, `exec-plans*`, `tech-debt*`,
  `ambient*`): `# tests 3449 / # pass 3449 / # fail 0 / # cancelled 0 / # skipped 0`.
- eslint on ambient.js, watch.js, music.js, server.js and the six touched test files: exit 0.
- `npm run lint:css`: `TOTAL 0`. `overlay-containment-lint.js --enforce`: `clean (0 violations)`.
- `check-markers.sh`: `19 issue(s) found`, exit 1. One is this doc (`design: ... @ef42a6d4`, a
  design approval that predates the code by construction); the other 18 are in plan docs this
  diff does not touch.

Verified: ambient.js lines 24-410 are watch.js@b71fcd32 lines 56-429 byte-for-byte plus
`forgetOtherImages` and its one call (diff run). The watch host call passes the same
collaborators; watch behavior (both axes) is unchanged by reading, and the suite is green.
Security: no user-controlled URL reaches a canvas or a CSS `url()`. The layer only ever gets
a `data:image/png` toDataURL result (prefix-checked). Image sources are gated by
`ambientSameOriginUrl` (javascript:, data:, `//host`, `/\host` and foreign origins all resolve
to a different origin and are refused). `/albumart` and `/thumbnail` send files, never
redirects. The `publicTrackListItem` export is a module export, not a route. No auth, secret,
network boundary or dependency change. Spot mutants (a `git archive` sandbox in /tmp): drop
the desktop gate: KILLED (AC3). Drop `check.checked = prefOn`: KILLED (2). Move the
sidebar-signal clear out of stop(): the suite KILLED it (7), but see S2.

**W1 (WARNING) - every music track change blinks the glow off and flashes the sidebar opaque,
then re-lights on the OLD cover.** ambient.js:505-510 + 589. player.js `load()` runs
`teardownMediaState` on every non-adopt load (player.js:8675). That calls
`pauseSuppressingHandoff` (a `pause`) and `removeAttribute('src'); load()` (`emptied`,
readyState HAVE_NOTHING). `currentlyPlaying()` goes false, so `stop()` hides the glow and
removes `data-ambient-on`, which turns the sidebar opaque and brings back its border line.
On `playing`, `start()` unhides the layers still holding the previous track's bitmap. The new
cover cross-fades in only after it loads. The watch page never hit this (a new item is a new
view). Music advances without a reload: the crown-jewel "display advances without a reload"
class. VERIFIED in the jsdom music harness with that event sequence (pause + emptied at
readyState 0, then playing). Mid-gap: `{"glowHidden":true,"isOn":false,"sidebarSignal":false}`.
After playing: `{"lit":true,"frontIsOldTrack":true}`. Not measured in Chromium (the gap
length is the load time). AC1b / AC1c are vacuous for this: their `play()` fires only
`playing`, and the fake media stays unpaused at readyState 4 across the row tap, so the
driver never reaches the real advance state. Fix direction (Architect's call): do not tear
down during the player's own load gap. For example, the host holds its state while
`readyState < 2` after an `emptied` (a bounded timeout still clears), and a user pause at
readyState >= 2 still clears at once. Bind both axes with a test that drives the real
sequence: no drop across an advance, and a real pause still clears.

**S1 (SUGGESTION) - two stale comments.** style.css:9035 ("watch.js draws the storyboard
sprite tile") and style.css:9131 ("watch.js sets the vignetted PNG data URL"). The engine now
lives in ambient.js, and the build record says the comments were re-pointed.

**S2 (SUGGESTION) - a porous span in the v1.188 lock.** watch-chrome-ambient.test.js:208 ends
`stopFn` at `indexOf('var boundMedia')`, a token that does not exist in ambient.js. indexOf
returns -1, so the span runs to the end of the host. Mutant: I moved `removeAttribute(
'data-ambient-on')` from stop() into teardown(). This test stayed green alone
(`# pass 12 / # fail 0`). Other tests killed it, so the guard is still bound. The fix is to
anchor on `function bindMedia` or on `fnBody`.

**S3 (SUGGESTION) - a dead closure can still write the row.** In music.js `syncAmbient`,
`ensureAmbientToggleRow` runs before the aborted-signal refusal in `createAmbientHost`. A late
seam of a dead music closure (slow `?play=` after a soft-nav) still writes the Ambient row
into the persistent host. It is harmless today (CSS hides it off watch/music, and the next
view reuses it). An `if (signal.aborted) return;` at the top of `syncAmbient` closes it.

Tree: unchanged except this section (git status before the append: clean).

Gate: CHANGES r1 @c285adcb — qa

## Gate r1 - adversary (@c285adcb)

Reviewed `git diff b71fcd32 c285adcb` at HEAD c285adcb, Node v22.23.1. All mutation and
browser work ran in scratch sandboxes built with `git archive` (c285adcb, plus b71fcd32 as a
baseline). The worktree was never edited. Instruments, verbatim:

- The six ambient files (ambient-host, music-ambient, ambient-glow-engine, watch-chrome-ambient,
  shell-script-global-collisions, watch-init-behavioral): `# tests 127 / # pass 127 / # fail 0`.
- 62 targeted files (ambient*, watch*, music*, player-*parity*, shell-*, sidebar-nav-parity,
  podcast-nowplaying*, theatre*, prefs-sync*, comment-debt*, skin-surface*) in the sandbox:
  `# tests 955 / # pass 953 / # fail 2`. Both failures are comment-debt-census TIER 1/2
  `EISDIR`. The cause is the sandbox's node_modules symlink, not the tree: the same file run in
  the worktree gives `# tests 5 / # pass 5 / # fail 0`.
- `npm run lint:css`: `TOTAL 0`. `overlay-containment-lint.js --enforce`: `clean (0 violations)`.
  eslint on ambient.js, watch.js, music.js and the five ambient test files: exit 0.
- Builder's mutation table re-run (their 43 mutants in my sandbox): 43/43 KILLED.
- My mutants: X3, X4, X5, X9-X14 KILLED. X1, X15-X18 SURVIVED (findings below). X2 (the
  seam moved after the not-expanded return) and X8 (forget also drops 'loading') SURVIVED,
  but I judge both equivalent in production. X6 SURVIVED (S3).

Headless Chromium (chromium-1234; a real chaptered mp3 with chapters at 0/3/8s, a real webm).
I ran the same probe on c285adcb and b71fcd32:

- **Watch non-regression (VERIFIED).** Checkpoints: SPA nav into /watch.html?v=vid1, play,
  pause, re-play, light, dark, then a cold watch load. Glow hidden/is-on/display,
  `html[data-ambient-on]` and the row display are IDENTICAL on both trees at all 7 checkpoints.
- **Music paint + teardown (VERIFIED).** A cold `/music?play=aud1::c0` lights with a PNG data
  URL. It stays lit through a real chapter roll (t 3.5 / 4.6 / 6.1). A resize to 700px clears
  the glow AND the root signal, and 1600px re-lights it. An SPA nav home clears everything,
  and a later theme flip + pause/play never re-lights it (no leaked listener). An SPA nav from a
  lit watch into /music leaves nothing lit. A cold PODCASTS shell then SPA into
  /music?play=aud1::c0 lights it (shell parity end to end). No page errors.
- The art requests match the base tree's set exactly. The glow sampled `/thumbnail/aud1` and
  never a `::c` URL. The `/albumart/aud1%3A%3Ac<n>` requests also appear at b71fcd32, so they
  come from the row covers and are pre-existing.

**W1 (WARNING) - the chapter-ROLL axis of the music gate is unbound; the plan's AC2 claim is a
divergent fixture.** AC2 says "chapter roll" and cites AC1c, but AC1c drives a row TAP (a
reload through loadTrack), never a playhead roll. Mutant X1: in `ambientEligible`, change
`var curId = effectiveCurrentId();` to `var curId = (window.FileTube.player.currentId);`.
Result: 127/127 green. In Chromium the X1 tree painted, then went dark at the first chapter
boundary: at t=3.5 it was hidden, not is-on, with no root signal. The real tree stays lit there.
This is the crown-jewel "display advances without a reload" class, and the plan's own finding 2
names it. Fix: drive a real roll in the music harness (currentTime across chapterStartSec plus
`timeupdate` on the media, so reflectChapter moves nowPlaying). Assert the glow stays lit and
nothing is re-requested, and show X1 goes red.

**W2 (WARNING) - the v1.312 JS constraint lock lost coverage and was not extended to the new
consumer.** The SOURCE LOCK's style-write scan covers only createAmbientEngine and
createAmbientHost. At b71fcd32 it covered watch's setupAmbientMode: adding
`glow.style.webkitTransform = 'scale(1.2)'` there went RED (`# fail 1`, the SOURCE LOCK). At
c285adcb the same kind of write SURVIVES in these places (127/127 each):
- X16: in watch's setupAmbientMode;
- X15: `ambientGlow.style.filter` in music.js syncAmbient;
- X17: `setProperty('-webkit-mask-image', ...)` on `#music-player-stage` in music.js;
- X18: a filter write in ensureAmbientToggleRow.

The CSS lock was extended to the music stage; the JS half was not. Fix: scan all of stripped
ambient.js, watch's setupAmbientMode body and music.js's ambient block (from `var ambientGlow`
through `syncAmbient`) with the same style-write and unscoped-write assertions.

**W3 (WARNING, concur with qa W1, independently MEASURED in part) - a track advance blinks the
glow off and drops the root signal.** A real Songs-row tap from a lit aud1::c0 to aud2 in
Chromium, polled every 16ms:
- t=17ms: glow hidden, not is-on, `data-ambient-on` gone, media paused at readyState 0;
- t=70ms: re-lit at readyState 4.

Here the gap was 53ms (localhost, a 256KB file). In production it is the media load time. I did
NOT reproduce the "re-lights on the OLD cover" half: at the re-light the front layer already
held a new bitmap, because the cover loaded fast. The fix direction is qa's; bind both axes.

**S1 (SUGGESTION, concur with qa S2) - a dead anchor.** In watch-chrome-ambient.test.js:208,
`indexOf('var boundMedia')` names a token that exists nowhere in the tree (`git grep`), so
`stopFn` runs to the end of the host.

**S2 (SUGGESTION, concur with qa S1) - two stale comments.** style.css:9035 and :9131 still say
watch.js draws the sprite and sets the PNG data URL.

**S3 (SUGGESTION) - an unbound guard.** Mutant X6 deletes `if (!check || !glow) return null;`
in createAmbientHost: 127/127 green. No caller reaches it today, but a watch mount without a
cog menu would throw at `check.checked`.

Tree: I made no change except this section (qa's section was already present, uncommitted).
Scratch sandboxes and probe temp dirs are removed. No untracked or ignored files
(`git status --short --ignored`).

Gate: CHANGES r1 @c285adcb — adversary

## r1 fix record

Fixed on `feat/music-desktop-ambient` from c285adcb. Main 6cb3349c (the v1.317.0 release) was
NOT an ancestor; the first commit attempt's hook caught it (release-ledger census: the v1.317.0
tag had no ledger entry on this branch), so main was merged in as f47a8c86 (the release commit
only: ROADMAP, the ledger, the version bump, three plans closed out, one integration test line;
no overlap with this work), the fix riding the worktree across the merge (backed up first,
byte-compared after). Node v22.23.1.

| Finding | Change | Binding test | Mutant result |
|---|---|---|---|
| qa W1 / adversary W3: every track change blinks the glow and the root signal off | `createAmbientHost` gains an opt-in `loadHoldMs` (music passes `AMBIENT_LOAD_HOLD_MS` = 8000; watch passes none, so its behavior is unchanged): while the glow is LIT, the media is in the player's own load gap (readyState below 2) and every OTHER axis holds (pref, dark, visible, the view gate), `evaluate()` holds instead of `stop()`; the engine keeps its clock, so the next cover cross-fades in. ONE timer, armed at the gap's first event, re-decides at the bound; `start()` / `stop()` (so teardown, light, a hard fail) cancel it; a holding view also re-decides on `loadeddata` (a user who paused during the gap clears when the data lands). A real pause and a natural end happen at readyState 4: not a gap, they clear at once. | music-ambient "a TRACK CHANGE through the real row tap" (the harness `load()` now does what player.js does: pause + emptied queued at readyState 0; `play()` fires loadeddata + playing at readyState 4; a MutationObserver records any hide / is-on / root-signal flicker; the samples prove the real sequence ran: `pause:lit@rs0, emptied:lit@rs0, loadeddata:lit@rs4, playing:lit@rs4`; the next cover replaces the old; a real pause then clears); music-ambient "the load-gap hold is BOUNDED" (300 ms bound: held, then cleared, then a late play re-lights; a natural end clears at once); ambient-host "the LOAD-GAP hold", "the hold never swallows a real clear" (seven clear axes), "WITHOUT loadHoldMs (the watch view)" | H1-H12 all KILLED (table below) |
| qa W1 (the old cover re-lit) | covered by the hold: the layers never hide, and the engine clock paints the new art | the track-change test asserts the front layer changes to a new bitmap | H1, H2 KILLED |
| adversary W1: the chapter-ROLL axis unbound | no code change (the gate was right; the binding was missing) | music-ambient "a real CHAPTER ROLL": `currentTime` 250 + `timeupdate` (chapter 2 starts at 200) with no row tap; the loaded id stays `::c0`, the view rolls to `::c1` (the playing row), nothing flickers, still lit a clock later, nothing re-requested | X1 KILLED |
| adversary W2: the v1.312 JS style-write lock lost coverage | the SOURCE LOCK scans ALL of ambient.js (comment-stripped), the watch view's `setupAmbientMode` body, and music.js's `musicAmbientArtUrl` plus its ambient block (from the glow lookup to the end of `syncAmbient`), each slice anchored on a token that must exist | `ambient-glow-engine.test.js` SOURCE LOCK | X15, X16, X17, X18 KILLED |
| qa S2 / adversary S1: the v1.188 lock's `stopFn` ran to the end of the host | `start()` / `stop()` spans end at their own closing brace, with the anchors asserted | `watch-chrome-ambient.test.js` v1.188 | S1q (the qa mutant: the root-signal removal moved from stop() to teardown()) KILLED in that test alone |
| qa S1 / adversary S2: stale style.css comments | the two comments name ambient.js | (comment) | n/a |
| qa S3: a dead music closure could still write the cog row | `if (signal.aborted) return;` first in `syncAmbient` | music-ambient AC8 (a) now asserts the late load cloned the player host AND no Ambient row was written | S3q KILLED |
| adversary S3: `if (!check \|\| !glow) return null;` unbound | kept (reachable: a watch mount with no cog menu would otherwise throw at `check.checked`) and bound | ambient-host "a view with no glow or no Ambient toggle gets NO host" (both axes: null, no listener, no observer, nothing lit) | X6 KILLED |

Two guards were written and then removed because no real state reaches them (the unbound-guard
rule): `media.ended` in the gap test (a natural end fires at readyState 4, which the readyState
check already refuses) and a `torn` check in the hold timer (teardown's `stop()` cancels the
timer, so it never fires on a torn host).

### Mutation results (r1 fix)

Sandbox: `git archive` of the staged tree 87ae7594 (the seven code / test files), node_modules
symlinked, each mutant applied to one file, the named test files run, the file restored (all
three source files compared byte-identical to the tree afterwards, and the four files re-run
green: 75 / 75). Runner in the session scratchpad (`m4r1-mutants.js`).

| # | Mutant | Result | First red |
|---|---|---|---|
| H1 | music: no load hold passed (the blink returns) | KILLED 2 fail | gate r1 (qa W1): a TRACK CHANGE through the real row tap |
| H2 | host: the hold branch removed | KILLED 4 fail | host: the LOAD-GAP hold |
| H3 | host: the hold swallows a real pause (no readyState check) | KILLED 4 fail | host: the hold never swallows a real clear |
| H4 | host: the hold is never bounded (no timer) | KILLED 3 fail | host: the LOAD-GAP hold |
| H5 | host: the timer re-armed on every gap event | KILLED 2 fail | host: the LOAD-GAP hold |
| H6 | host: no loadeddata re-decision | KILLED 1 fail | host: the hold never swallows a real clear |
| H7 | host: start() does not end the hold | KILLED 1 fail | host: the LOAD-GAP hold |
| H8 | host: stop() does not end the hold | KILLED 1 fail | host: the hold never swallows a real clear |
| H9 | host: the hold ignores the view gate | KILLED 1 fail | host: the hold never swallows a real clear |
| H10 | host: the hold ignores pref / dark / visible | KILLED 1 fail | host: the hold never swallows a real clear |
| H11 | host: an UNLIT glow arms a hold | KILLED 1 fail | host: the LOAD-GAP hold |
| H12 | host: the bound never re-decides | KILLED 2 fail | host: the hold never swallows a real clear |
| X1 | music: ambientEligible reads player.currentId (adversary X1) | KILLED 1 fail | gate r1 (adversary W1): a real CHAPTER ROLL |
| X15 | music syncAmbient: `ambientGlow.style.filter` | KILLED 1 fail | v1.312 SOURCE LOCK |
| X16 | watch setupAmbientMode: `style.webkitTransform` | KILLED 1 fail | v1.312 SOURCE LOCK |
| X17 | music syncAmbient: `setProperty('-webkit-mask-image')` on `#music-player-stage` | KILLED 1 fail | v1.312 SOURCE LOCK |
| X18 | ensureAmbientToggleRow: a filter write | KILLED 1 fail | v1.312 SOURCE LOCK |
| X6 | host: `if (!check \|\| !glow) return null;` deleted | KILLED 1 fail | host (adversary S3): no glow or no Ambient toggle gets NO host |
| S3q | music: syncAmbient without the aborted-signal return | KILLED 1 fail | AC8 (a) the host was never built |
| S1q | host: the root-signal removal moved from stop() to teardown() | KILLED 1 fail | watch-chrome-ambient v1.188 (run alone) |

20 mutants, 20 killed (S3q's first run was a bad anchor, matched twice in music.js; re-run with a
unique anchor, KILLED).

### Probe (headless Chromium chromium-1234, 1600x1000, dark, ambient ON)

The adversary's advance probe, extended (session scratchpad `m4r1-probe-advance.js`): a cold
`/music?play=aud1::c0` (a real chaptered mp3), play, the Songs tab, then a REAL row tap on aud2
polled every 16 ms for 6 s (plus a sample at every media event), then a seek to 1.2 s before
aud2's end and the natural-end advance polled the same way. Run on this tree and on c285adcb:

| Reading | c285adcb | this fix |
|---|---|---|
| row tap: samples / samples with the glow not lit | 377 / 4 (hidden, not is-on, no root signal from 12 ms to 47 ms, readyState 0) | 378 / 0 |
| row tap: the event sequence | emptied (rs 0) dark, loadeddata (rs 4) dark, playing lit | emptied (rs 0) lit, loadeddata (rs 4) lit, playing lit |
| row tap: the new cover | front layer changed at 66 ms (the blink restarted the engine, whose start() checks at once) | front layer changed at 1002 ms: the held engine picks the new art up on its next 1 s clock, the old cover staying lit until then |
| natural-end advance (aud2 to aud1::c1): samples / not lit | 444 / 6 (1301 to 1330 ms) | 443 / 5 (1281 to 1325 ms) - unchanged by design, see Known seams |
| page errors | none | none |

### Instruments

- Targeted suites (67 files: ambient*, watch*, music*, shell-*, theatre*, docs-*, exec-plans*,
  tech-debt*, comment-debt*, player-*parity*, sidebar-nav-parity, podcast-nowplaying*,
  prefs-sync*, skin-surface*) at the fix tree plus this doc: tests 974, pass 974, fail 0,
  cancelled 0, skipped 0. The full unit suite runs in the pre-commit hook (it refuses red).
- `npm run lint:css`: TOTAL 0. `node scripts/overlay-containment-lint.js --enforce`: clean (0
  violations). eslint on ambient.js, music.js and the four touched test files: exit 0.

## Gate r2 - qa (@45284736)

Delta reviewed: `git diff c285adcb 45284736 -- public test` (8 files; watch.js untouched).
Node v22.23.1. Instruments, verbatim:

- 229 unit files (the r1 set plus `ledger-check` and `release-ledger`): `# tests 3463 / # pass
  3463 / # fail 0 / # cancelled 0 / # skipped 0`.
- eslint on ambient.js, watch.js, music.js, the four touched unit tests and
  chapter-likes.test.js: exit 0.
- `npm run lint:css`: `TOTAL 0`. `overlay-containment-lint.js --enforce`: `clean (0 violations)`.
- `check-markers.sh`: `6 issue(s) found`. The one in this doc is again the `design: ...
  @ef42a6d4` line; the other five are in docs outside this delta.

My r1 findings:

- **W1: fixed differently (bounded, opt-in `loadHoldMs`).** I re-ran my r1 sequence verbatim
  in a `git archive 45284736` sandbox: row tap, then `pause` + `emptied` at readyState 0, then
  `playing`.
  - r1 result: `{"glowHidden":true,"isOn":false,"sidebarSignal":false}`.
  - Now, mid-gap: `{"glowHidden":false,"isOn":true,"sidebarSignal":true}`.
  - After `playing` the old cover is still in front. One engine clock later the front layer is
    the new cover (`loads: /albumart/n1, /albumart/n2`).
- **The watch page is unchanged.** I ran the host without `loadHoldMs` on three axes: a pause at
  readyState 4, pause + ended at readyState 4, and pause + emptied at readyState 0. Each one
  cleared synchronously and armed 0 hold timers.
- **Hold checked by reading:** it is bounded (one timer, armed once). start() and stop() cancel
  it, so teardown, light mode and a hard fail do too. It needs a lit glow and every other axis
  (pref, dark, visible, the view gate). A pause during the gap clears on `loadeddata`.
  `close()` detaches the host, so the slot observer clears it.
- **Spot mutants:**
  - `AMBIENT_LOAD_HOLD_MS = 0`: KILLED (the track-change test).
  - My r1 S2 mutant (the signal clear moved from stop() into teardown()): now KILLED by
    watch-chrome-ambient alone (`# pass 11 / # fail 1`).
- **S1: fixed** (style.css:9035 and 9131 now name ambient.js).
- **S2: fixed** (start/stop each end at their own brace, with the anchors asserted).
- **S3: fixed** (`if (signal.aborted) return;` is the first statement of `syncAmbient`, and
  AC8 (a) asserts no row is written).
- **Adversary items:** I read the adversary's items in the delta: the chapter-roll test, the
  SOURCE LOCK widened to every ambient writer with anchors that must exist, and the no-glow /
  no-toggle test. They are sound. I did not mutate them; I rely on the fix record's X1, X6 and
  X15-X18.

**Residual of W1, disclosed, safe to ship (not blocking).** A natural-end advance still
blinks. At the end of a track, `pause` + `ended` arrive at readyState 4. That is correctly not
treated as a load gap, so the glow clears and re-lights on the next `playing`. Re-checking my
own r1 prescription: it had the same hole, so the hole was in the prescription, not the fix.
It is disclosed in Known seams, with the Architect's headless Chromium measurement (about 44 ms
on localhost; I did not re-measure it). In production the gap also includes the /api/queue
fetch. It is safe to ship disclosed for three reasons:

- The fix has a real tradeoff: holding after `ended` also holds the glow on a finished queue.
- Dean's device check (D14) comes before the tag.
- The blink is bounded to one advance gap.

If Dean wants it closed, the shape is a short bounded hold on `ended` in the load-hold views
only (for example 1.5 s), bound on both axes: a queue advance holds, and a finished queue clears
at the bound.

**S4 (SUGGESTION) - one stale test comment.** ambient-glow-engine.test.js:628 still says "(readyState below 2,
not ended)". The `ended` check was removed (fix record), and the assertion message below it
is right.

Tree: unchanged except this section (before the append: clean, no untracked files).

Gate: APPROVED r2 @45284736 — qa

## Gate r2 - adversary (@45284736)

This is a delta review of `git diff c285adcb 45284736 -- public test`, at HEAD 45284736 on Node
v22.23.1. Everything ran in `git archive` sandboxes: 45284736 for the tests and mutants, and
b71fcd32 as the baseline. The worktree was never edited.

**Test and lint runs (verbatim)**

- The six ambient files: `# tests 134 / # pass 134 / # fail 0 / # cancelled 0 / # skipped 0`.

**My r1 findings against the fix**

- **W1 is fixed as prescribed.** The new "real CHAPTER ROLL" test sets currentTime 250 and fires
  `timeupdate` with no row tap. X1 is KILLED (1 fail, that test).
- **W2 is fixed as prescribed.** The SOURCE LOCK now scans all of ambient.js, watch's
  setupAmbientMode and music's ambient block. Each slice is anchored and asserted. X15, X16,
  X17 and X18 are each KILLED by the SOURCE LOCK.
- **W3 / qa W1 is fixed differently: an opt-in bounded hold. I evaluated it.**
  - Watch passes no hold. Every host test for the hold runs on the fake element.
  - Chromium, a Songs-row tap from a lit track: 0 of 152 samples dark (it was 4 of 377).
- **S1 is fixed.** The v1.188 spans end at their own brace. qa's move-to-teardown mutant X3 is
  KILLED (14 fail).
- **S2 is fixed.** The two stale comments now name ambient.js.
- **S3 is fixed.** X6 is KILLED by the new "no glow or no toggle: no host" test.
- Also re-run, all KILLED: X4, X5, X9, X10, X11, X12, X13, X14.
- X2 and X8 SURVIVED again. I judged both equivalent in production at r1, by reasoning, not
  measurement.

**Hunting what the hold introduced (real Chromium)**

To force a long gap I blocked `*/video/*`, so the new source never loads. The glow was lit and
the element was mid-gap (readyState 0, paused) before each action.

| Action mid-gap | 120 ms after the action | Over the next 9.5 s |
|---|---|---|
| Ambient toggled off | cleared (glow and root signal) | 0 of 585 samples lit |
| Flip to light | cleared | 0 of 571 samples lit |
| Dock | cleared | 0 of 583 samples lit |
| Soft-nav home (the nav took 19 ms) | cleared | nothing re-lit, even after a play |

Watch non-regression: the r1 checkpoint probe (soft-nav in, play, pause, play again, light,
dark, a cold load) is IDENTICAL on 45284736 and b71fcd32. The music checkpoints (paint,
chapter roll, the resize crossing, home, the podcasts shell) all hold as they did at r1.

**New mutants on the hold**

- KILLED: N1 (the hold ignores the pref), N2 (ignores dark), N3 (ignores visible), N5 (the
  bound re-lights without re-deciding), N6 (stop() keeps the timer), N8 (it holds at
  readyState 2).
- SURVIVED: N4 and N7. They are S1 and S2 below.

**Findings (all SUGGESTION; none blocks)**

- **S1 - a load ERROR holds the glow for the full bound.** Repro: a lit glow, then a Songs-row
  tap on a corrupt mp3 (`media.error` 4). The glow and `data-ambient-on` stay lit around the
  failed player until 7975-7998 ms, then clear. I measured this in three runs.
  - It is bounded, cosmetic and rare on a local library. It is disclosed only in the ambient.js
    comment, not in the plan's Known seams.
  - Fix: return false from `inLoadGap` when `media.error` is set, and bind 'error' to
    evaluate. Or disclose it in Known seams.
  - Mutant N7 SURVIVED: raising the bound to 80000 turns nothing red, because the value 8000
    itself is not tested.
- **S2 - "watch passes nothing" is not tested.** Mutant N4 SURVIVED: adding `loadHoldMs: 8000`
  to watch's setupAmbientMode call leaves all 134 green. Fix: add
  `assert.doesNotMatch(wiring, /loadHoldMs/)` to the "no hand-copy" test.
- **S3 - one clear axis has no behavioral test.** "Ambient toggled off mid-gap" is not in the
  seven-axis list. N1 is killed only by the WIRING LOCK regex, and Chromium shows the real code
  clears.
- **Natural-end blink (disclosed Known seam).** Measured: aud2 to aud4 was dark for 2 samples,
  about 32 ms, at 1305 ms. This matches the disclosure. It is not a regression, since music had
  no glow at all before M4, and it is cosmetic. I argue it is safe to ship disclosed; Dean
  decides.

Tree: I made no change except this section. qa's r2 section was already present and
uncommitted. My sandboxes are verified pristine (cmp) and removed.

Gate: APPROVED r2 @45284736 — adversary

## r2 fix record

Fixed on `feat/music-desktop-ambient` from 45284736. Both r2 seats APPROVED with suggestions;
Dean ruled (2026-09-24) to fix the natural-end blink before release. Node v22.23.1.

| Finding | Change | Binding test | Mutant result |
|---|---|---|---|
| Dean's ruling (qa r2 residual, adversary r2 "natural-end blink"): a natural end blinks the glow off until the next track plays | `createAmbientHost` gains an opt-in `endHoldMs` (music passes `AMBIENT_END_HOLD_MS` = 1500; watch passes none). A lit glow whose media ENDED is held (every other axis must hold). The hold is LATCHED, because the player's ended cascade rewinds the element to 0 right after 'ended', so `ended` reads false again. It lasts while the element still has its media (readyState 1+). At readyState 0 (the next load's 'emptied') the load hold takes over with its own bound (one timer per hold kind: `hold(kind, ms)`). The end hold is asked BEFORE the load gap, see the probe finding below. A real user pause never sets `ended`, so it still clears at once. | ambient-host "the END hold" (the real shape: pause + ended at readyState 4, the player's rewind first, leaving readyState 1; a view seam during the wait; the emptied handover to the LOAD bound; playing; a MutationObserver sees no flicker); music-ambient "a NATURAL-END queue advance in its real shape" (the harness player now carries the ended cascade: rewind, then the /api/queue wait, then music's registered onNext; samples `pause:lit@rs4, ended:lit@rs1, emptied:lit@rs0, loadeddata:lit@rs4, playing:lit@rs4`; holds armed [1500, 8000]; a real pause then clears); music-ambient "a FINISHED queue" (held, then cleared at the 1.5 s bound in real time, at least 1400 ms after the end); ambient-host clear cases (the END bound, toggle off / light / the view gate during the end hold); watch: a natural end still clears at once | E1, E2, E3, E5, E9, E10, E11, E12, E13, E14 KILLED |
| (found by the r2 probe, not by a seat) the first build asked the load gap first: in Chromium the ended rewind's seek leaves the element at readyState 1 at 'ended', so the LOAD hold (8 s) took over and a finished queue stayed lit for 8 s, not 1.5 s. The unit harness had rewound at readyState 4, a divergent fixture. | the harness rewinds at readyState 1 (then 'seeked' at 4), as MEASURED; with it, three tests went red on the first build; `evaluate()` now asks the end hold first | the same tests (red on the first build in the real shape, green after) | E13 KILLED |
| adversary S1: a failed load holds for the whole 8 s bound | `inLoadGap` returns false when `media.error` is set; a holding view re-evaluates on 'error' | ambient-host clear case "the new src fails to load"; music-ambient "a load that FAILS clears at the error" | E6, E7 KILLED |
| adversary S2 / N4: "watch passes no hold" was untested | the no-hand-copy test asserts watch's `setupAmbientMode` call names no `loadHoldMs` / `endHoldMs` / `*HOLD_MS` | ambient-glow-engine "watch.js keeps no hand-copy" | N4, E4 KILLED |
| adversary S3 / N1: ambient toggled OFF mid-gap had only a text lock | behavioral clear cases: toggle off during the load gap and during the end hold | ambient-host "a hold never swallows a real clear" | N1 KILLED with the engine lock NOT run |
| adversary N7: the bound values were untested (8000 -> 80000 stayed green) | the music harness wraps the global `setTimeout` (pass-through) and records every `holdExpired` delay; the plan's bounds are asserted as values | music-ambient "a TRACK CHANGE" ([8000]), "a NATURAL-END queue advance" ([1500, 8000]), "a FINISHED queue" ([1500] plus the real-time clear) | N7, E8 KILLED |
| qa S4: a stale test comment ("readyState below 2, not ended") | the wiring-lock comment now describes both holds; the lock pins the new `evaluate` order, `inEndHold`, `holdAxes`, `hold()` and the 'error' binding | ambient-glow-engine WIRING LOCK | n/a |

Two guards were written and then removed, because no real state reaches them (the unbound-guard
rule). In `inEndHold` these were `!media.paused` and `media.error`. A playing element at
readyState 2+ already runs through `shouldRun`. An errored load has emptied the element first
(readyState 0), so the end hold refuses it before the error check.

### Mutation results (r2 fix)

Sandbox: `git archive` of the staged tree 10dd886b (the five code and test files), with
node_modules symlinked. Each mutant was applied to one file, the named test files were run, and
the file was restored. Afterwards ambient.js, music.js and watch.js compared byte-identical
(cmp) to the tree. Runner: session scratchpad `m4r2-mutants.js`.

| # | Mutant | Result | First red |
|---|---|---|---|
| E1 | music: no end hold passed (the natural-end blink returns) | KILLED 2 fail | gate r2: a NATURAL-END queue advance in its real shape |
| E2 | host: the end hold swallows a real pause (no ended / latch check) | KILLED 4 fail | host: a hold never swallows a real clear |
| E3 | host: the end hold is never bounded (no timer for the end kind) | KILLED 4 fail | host: a hold never swallows a real clear |
| E4 | watch opts in to the end hold | KILLED 1 fail | engine: watch.js keeps no hand-copy |
| N4 | watch opts in to the load hold (adversary N4) | KILLED 1 fail | engine: watch.js keeps no hand-copy |
| E5 | host: the end hold is not latched (holds only while `ended` reads true) | KILLED 3 fail | host: a hold never swallows a real clear |
| E6 | host: the load hold ignores media.error | KILLED 2 fail | host: a hold never swallows a real clear |
| E7 | host: no 'error' re-evaluation | KILLED 2 fail | host: a hold never swallows a real clear |
| E8 | AMBIENT_END_HOLD_MS 1500 -> 15000 | KILLED 2 fail | gate r2: a NATURAL-END queue advance in its real shape |
| N7 | AMBIENT_LOAD_HOLD_MS 8000 -> 80000 (adversary N7) | KILLED 2 fail | gate r1 (qa W1): a TRACK CHANGE through the real row tap |
| E9 | host: the end -> load handover keeps the end timer (no re-arm) | KILLED 2 fail | host (gate r2): the END hold |
| N1 | host: the hold ignores the pref (behavioral: engine lock NOT run) | KILLED 1 fail | host: a hold never swallows a real clear |
| E10 | host: an UNLIT glow arms an end hold | KILLED 1 fail | host (gate r2): the END hold |
| E11 | host: the end hold ignores the other axes (view gate, light, toggle) | KILLED 1 fail | host: a hold never swallows a real clear |
| E12 | host: the end-hold bound never re-decides | KILLED 3 fail | host: a hold never swallows a real clear |
| E13 | host: the load gap asked BEFORE the end hold (the r2 probe finding) | KILLED 3 fail | host: a hold never swallows a real clear |
| E14 | host: the end hold ignores readyState 0 (no handover to the load bound) | KILLED 2 fail | host (gate r2): the END hold |

17 mutants, 17 killed.

### Probe (headless Chromium chromium-1234, 1600x1000, dark, ambient ON)

The r1 advance probe was extended (session scratchpad `m4r2-probe.js`, run against the 10dd886b
sandbox). It adds two phases. FINISHED queue: seek the playing track to 1.2 s before its end,
clear the registered next (`setTrackNav({})`) and time the clear against 'ended'. FAILED load
(a separate run, `PHASE=err`): a corrupt mp3 in the library, then from a lit glow a real
Songs-row tap on it.

| Reading | r1 fix (45284736) | this fix |
|---|---|---|
| row tap: samples / not lit | 378 / 0 | 378 / 0 (emptied rs 0 lit, loadeddata + playing rs 4 lit) |
| natural-end advance (aud2 to aud1::c2): samples / not lit | 443 / 5 (1281 to 1325 ms) | 444 / 0 (`pause` rs 4 ended lit, `ended` rs 1 lit, `emptied` rs 0 lit, `loadeddata` + `playing` rs 4 lit) |
| finished queue: the clear after 'ended' | not measured (r1 cleared at 'pause', by construction) | 1517 ms (the 1.5 s bound armed at the end's 'pause'; 0 dark samples before the bound) |
| failed load (corrupt mp3, `media.error` 4) | held to 7975-7998 ms (adversary r2) | `emptied` 17 ms lit, `error` 50 ms dark, first dark poll 64 ms |
| page errors (main run) | none | none |

The first build of this fix read differently on the finished queue: the glow was still lit 5 s
after 'ended', with 'ended' at readyState 1. That run is the finding in the table above.

### Instruments

- Targeted suites (58 files: ambient*, watch*, music*, shell-*, theatre*, docs-*, exec-plans*,
  release-ledger*, ledger-check*) at the fix tree plus this doc: tests 800, pass 800, fail 0,
  cancelled 0, skipped 0. The four ambient files alone: 79 / 79. The full unit suite runs in
  the pre-commit hook, which refuses red.
- `npm run lint:css`: TOTAL 0. `node scripts/overlay-containment-lint.js --enforce`: clean (0
  violations). eslint on ambient.js, music.js and the three touched test files: exit 0.

## Gate r3 - qa (@61904f6c)

Delta reviewed: `git diff 45284736 61904f6c -- public test` (ambient.js, music.js and three
unit tests; watch.js and style.css untouched). Node v22.23.1. Instruments, verbatim:

- 229 unit files (the r2 set): `# tests 3467 / # pass 3467 / # fail 0 / # cancelled 0 /
  # skipped 0`.
- eslint on ambient.js, watch.js, music.js and the three touched tests: exit 0.
- `npm run lint:css`: `TOTAL 0`. `overlay-containment-lint.js --enforce`: `clean (0 violations)`.
- `check-markers.sh`: `8 issue(s) found`. Three are in this doc: the design line and the two r2
  approvals at 45284736, which this round supersedes. The other five are outside this delta.

I checked `evaluate()` by reading: run, else the end hold, else the load gap, else stop. The
design:

- One timer per hold kind, armed at that hold's first event.
- The end hold latches across the player's rewind and lasts while readyState is 1 or more. At
  readyState 0 the next load's gap takes over with the 8 s bound.
- A load with `media.error` set is no gap, and 'error' re-evaluates. The 'error' and
  'loadeddata' listeners are bound only when a hold is passed.
- start() and stop() cancel any hold, so a toggle off, light mode, a hidden tab, the view gate,
  teardown and `close()` (which detaches the player host) all clear.

Harness runs (a `git archive 61904f6c` sandbox, the real music.js on the committed harness):

- **My r1 blink sequence, verbatim:** mid-gap
  `{"glowHidden":false,"isOn":true,"sidebarSignal":true}`. The new cover replaces the old one,
  and the holds armed are `[8000]`.
- **A natural-end advance** (pause + ended at readyState 4, the player's rewind to readyState 1,
  a 400 ms queue wait, then the next track's load): lit right after the end, lit mid-load at
  readyState 0, lit after playing. There were 0 attribute changes on the glow or root across the
  whole advance, and the holds armed are `[1500, 8000]`.
- **A finished queue:** held, then cleared 1508 ms after the end (holds `[1500]`).
- **A 2000 ms queue wait:** dark at 1700 ms, lit again on playing. This is the disclosed
  residual, and it matches the Known seams text.
- **The watch shape** (the host with no hold passed and the player's rewind listener registered
  first):
  - A pause at readyState 4 cleared at the 'pause' itself.
  - A natural end cleared at the 'pause' itself.
  - A load gap at readyState 0 cleared at the 'pause' itself.
  - 0 hold timers were armed, and no 'error' or 'loadeddata' listeners were bound.

Spot mutants, both KILLED:

- The `hold()` same-kind guard removed, so every event re-arms: 3 failed.
- A load hold that the end hold can take over at readyState 1 or more: 1 failed.

S4 (the stale test comment) is fixed. The Known seams entries (the natural-end fix and its
residual over 1.5 s; a failed load clears at its error) and the AC2/AC3 gate-r2 lines match the
tree. No new findings.

Tree: unchanged except this section (before the append: clean, no untracked files).

Gate: APPROVED r3 @61904f6c — qa

## Gate r3 - adversary (@61904f6c)

This is a delta review of `git diff 45284736 61904f6c -- public test`, at HEAD 61904f6c on Node
v22.23.1. Everything ran in `git archive` sandboxes: 61904f6c for the tests and mutants, and
b71fcd32 as the watch baseline. The worktree was never edited.

**Test and lint runs (verbatim)**

- The six ambient files: `# tests 138 / # pass 138 / # fail 0 / # cancelled 0 / # skipped 0`.
- `lint:css`: `TOTAL 0`. overlay-containment: `clean (0 violations)`.
- eslint on ambient.js, music.js, watch.js and the three touched test files: exit 0.

**Mutants**

- Every X mutant is re-run and KILLED: X1, X3-X6 and X9-X18. X2 and X8 survive as before;
  at r1 I judged both equivalent, by reasoning, not measurement.
- N-mutants:
  - N7 (bound 10x) is now KILLED behaviorally, by the recorded timer delays.
  - N4 (watch passes a load hold) is now KILLED by the watch "no hold" lock.
  - N1b, N2b, N3b and N9 (the hold ignores pref, dark, visible or the view gate) are KILLED by
    the behavioral clear-axes test, which now includes toggle-off.
  - N5b (the bound re-lights unconditionally) and N6 are KILLED.
  - N8b (a load gap at readyState 2) is KILLED only by the WIRING LOCK regex.
- Mutants on the end hold:
  - KILLED: E1 (no latch), E2 (no handover to the load bound), E3 (load gap asked first), E4
    (no 'error' re-evaluation), E5 (inLoadGap ignores media.error), E6 (end bound 10x), E7 (the
    bound re-arms), E8 (music passes no end hold), E9 (watch passes one), E10 (ignores is-on),
    E12 (a user pause arms the end hold).
  - E11 (holdExpired leaves holdKind) is KILLED only by the lock. It is equivalent anyway:
    holdExpired always calls start() or stop(), and both run clearHold().

**Real Chromium (music at 1600x1000, dark, ambient ON)**

| Scenario | Result |
|---|---|
| Natural-end advance, aud2 to aud4 | 0 of 241 samples dark |
| Row tap | 0 of 152 samples dark |
| Finished queue (the next-track handler cleared) | 'ended' at 1284 ms; lit through 2788 ms; dark from 2804 ms to the end of the trace. It clears about 1.5 s after the end and stays clear. |
| User pause right at the end (paused at 31.854 of 32 s) | Cleared 5 ms after pause(); `ended` false |
| Failed load, from a lit row tap | Dark from the first sample |
| Natural end advancing INTO a corrupt file | 'ended' at 1283 ms; dark from 1312 ms (about 29 ms), stays dark |
| Toggle OFF about 300 ms into an end hold | Held at the moment of the action; cleared within 100 ms; 0 of 183 lit over 3 s |
| Light mode about 300 ms into an end hold | Held at the moment of the action; cleared within 100 ms; 0 of 181 lit over 3 s |
| Soft-nav home about 300 ms into an end hold | Held at the moment of the action; no root signal at home or 2.5 s later |
| Watch page natural end | 'ended' at 1034 ms; dark from 1050 ms; no hold |
| Watch checkpoints (soft-nav in, play, pause, play again, light, dark, into music, a cold load) | IDENTICAL on 61904f6c and b71fcd32 |

No page errors.

**Could a finished queue, a user pause at the end, a seek near the end, or a watch-page end
stay lit?** No:
- A user pause never sets `ended`, and E12 proves that axis is bound.
- A seek near the end while playing is just a natural end.
- A paused glow is already off, so the `is-on` check refuses any end hold.
- The latch is bounded by the 1.5 s timer, and every clear axis still ends it.

**Findings:** none that block, and no new SUGGESTION.

**Probe caveat.** To make a finished queue I had to clear the next-track handler with
`setTrackNav({})`. With `ft-music-autoplay` set to 0, the queue still advanced (aud4 to
aud1::c1), so the finished-queue row exercises the host's end bound, not music's own
"queue exhausted" path.

Tree: I made no change except this section. qa's r3 section was already present and
uncommitted. My sandboxes are verified pristine (cmp) and removed.

Gate: APPROVED r3 @61904f6c — adversary
