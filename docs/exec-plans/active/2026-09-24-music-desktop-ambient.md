---
plan: music-desktop-ambient
harness: v2 · lean
branch: feat/music-desktop-ambient
anchor: spec
status: Building
next: gate r1 (adversary + qa; security-brief only if the table asks - no auth, secret, network boundary or dependency is touched), then Dean's device check before the wave tag (D14)
design: Approved 2026-09-23 @ef42a6d4 (Dean: "GO." on D13/D14 in the wave umbrella)
gate: pending
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
   `ambient-glow-engine.test.js` "only the CURRENT source's image is kept".
3. **Every OFF axis paints nothing; the CLEAR axis on a populated glow:** pref off, light, paused,
   hidden tab, the view gate false; and pause / toggle off / flip to light / tab hidden / gate
   false each clear a LIT glow. `ambient-host.test.js` (two tests), music-ambient AC2, AC2b, AC2c.
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
