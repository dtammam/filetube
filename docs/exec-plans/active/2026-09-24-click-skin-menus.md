---
plan: click-skin-menus
harness: v2 · lean
branch: feat/click-skin-menus
anchor: spec
status: Gate r2 fixed - awaiting gate r3
next: gate r3 (adversary delta on the r2 fix record below; qa APPROVED r2). Owed after merge: Dean's device pass (phone Click + Seattle, the wheel feel on long lists, the pivot swipe, a flat-list chapter hand-on), his rulings on D1 and on K4 (the Architect ruled for him overnight), and the Chapter Snap branch raising notifyLibraryChanged() on its save.
design: "Approved 2026-09-24 (Dean's intake, recorded in memory wave-2026-09-24-intake)"
gate: pending
---

# Pocket menus: full iPod / Zune menus in the Click and Seattle skins

## The ask

Dean, 2026-09-24 (his words): "I'd love classic pocket skin to truly emulate. Show artists,
albums, songs, etc. fully interactive, more than it currently is." "Classic pocket" = the Click
family (`ipod`, `ipod-black`, `ipod-matte`) AND Seattle (`zune-classic`, base `ipod`).

Intake answers (final, memory `idea-click-skin-full-ipod`):

| ID | Decision |
|----|----------|
| A1 | **Tree.** Main Menu = Music, Shuffle Songs, Now Playing. Music = Playlists (incl. Liked), Artists > Albums > Songs, Albums > Songs, Songs, Genres. The WHOLE library (the Music view's own routes), chapters as songs (`<id>::c<n>`). |
| A2 | **Play in context.** A song plays in the list it came from (album, artist, playlist, all songs) and shows Now Playing. Shuffle Songs shuffles the whole library. |
| A3 | **Navigation.** Wheel/pad rotation moves the highlight (the existing rotary engine, the shared sweep math, no hand copy); center = select / drill in; MENU (Click) / Back (Seattle) = up one level; from Now Playing MENU climbs to the menu you came from, then up to the Main Menu. Row taps work too. Long lists stay fast (window the rendering; measure a big fixture). |
| A4 | **Opens on** Now Playing when something is playing; nothing playing opens on the Main Menu. |
| A5 | **Click look:** the 6th/7th-gen split screen - list left, the highlighted item's art easing in right (Artists/Albums/Songs), the blue highlight bar + white text, chevrons on drill rows, status title = the menu name. Colors from the skin's own tokens (match-reference norm). |
| A6 | **Seattle look:** Zune style - big lowercase type, pivot headers moved across by the pad left/right or a swipe, large-type lists. The pad + flanks stay the controls. |
| A7 | **Phone is primary** (390x844), and the desktop pop-out where the skins render. |
| A8 | Cider / Nordic byte-identical unless a shared seam forces a change. |

Choices recorded where Dean left one open:
- **Genres = Genre > Songs** (his "if the data is thin" arm). The projected library's genre is the
  uploader's category (yt-dlp's `genre`), one or two values per shelf, and there is no genre
  route (a new one trips the five route-census siblings, v1.307); the level is derived client-side
  from the whole-library song list. Untagged songs gather under "Unknown Genre", last.
- **Playlists** = Liked Songs (the one real playlist, `filter=liked`, both like stores) + the
  device's smart playlists this library can honestly fill: Recently Added (`sort=newest`, 100) and
  Recently Played (`filter=recent-listening`). No "Top 25 Most Played" (no play counts exist).
- **MENU at the Main Menu docks** (the way out; the real device did nothing there, but the skin
  needs an exit and MENU was it). So from Now Playing it is MENU x2 (via the Main Menu) to dock
  when nothing was chosen from a menu.
- **Select on Now Playing** still opens the v1.231 queue list ("Songs", the up-next) - kept, so
  the whole-queue list Dean asked for at v1.232.5 stays one press away. MENU from it returns to
  Now Playing, as before.
- **Seattle pivots** lead with artists (the Zune's own order): artists, albums, songs, playlists,
  genres; they wrap. The Music level is the pivot screen; drilled levels are plain big-type lists
  under a dim title. Selection = lit white vs dim grey (the Zune marked selection by light, not a
  bar); the playing row is pink.
- **Click |<< >>| in a menu still skip tracks** (the device's behaviour); on Seattle only a
  PIVOT level turns the pad's left/right into pivot moves.
- **A menu pick is a SELECT** (v1.311): a chapter chosen from a list exits after its own segment;
  Shuffle Songs plays through.
- Main Menu title = the skin's cheeky name ("Click" / "Seattle"), never the product's (Dean's
  naming rule for these skins).

## Re-verified survey (every anchor re-read at ecb61e1d before editing)

| Anchor | At ecb61e1d | Verdict |
|---|---|---|
| Registry `SKINS` / `IDS` | music-skins.js:33 (IDS), :234-251 (SKINS) | the Click trio + Seattle share `ipScreen` (:170) and the `.ip-wheel` engine hooks |
| The LCD screen | `ipScreen(ctx)` music-skins.js:170-197: status bar `.ip-np`, `.ip-npview`, `.ip-listview` (the v1.231 queue list) | the menu view is a third LCD view beside these |
| Seattle control | `renderZuneClassic` :217-228: `.ip-wheel.znc-pad` with `ip-z-left/right` = `data-skin-prev/next`, center Select, Back flank = `data-skin-menu` | the pad left/right are track skips today |
| The engine | skin-surface.js `create()` :500; `paint()` :949 (rebuilds the panel on every track change, chapter roll, autoplay append); `onClick` :1006; MENU :1035; Select :1045; `onDown` :1364 (mode = list ? cursor : scrub, :1381); cursor loop :1474 (`WHEEL_STEP_DEG` 22, speed multiplier) | the menu rides the SAME cursor branch; paint() re-draws the menu from engine state |
| The shared sweep | wheel-config.js (`FileTubeWheelConfig`, `sweepOffset`), read per gesture by `readWheelCfg` / `hapticPlaceSweep` skin-surface.js :1110/:1295 | untouched - the haptic path runs in cursor mode already ("ticks in BOTH modes") |
| The view's skin config | music.js `skinEngineConfig` :1111-1164, `onSelectIndex` -> `playAt(i, {soloChapter:true})` | the menu is one more config block |
| The queue + play seam | music.js `queue`/`queueCtx` :2052-2054; `loadSongs` :2214 (the `loadSongsGen` stale guard); `playAt` :3014; `playTrackInAlbum` :3028 (`playSelectGen`); `playTrackFromContinue` :3194 (the crumb + `renderSongList` precedent for a queue no tab owns) | browse rows' `data-index` point INTO `queue` - a replaced queue must re-draw the browse view |
| The advance seams | `reflectChapter` :1254 (re-registers nav + `updateNowPlayingPanel` at each chapter roll, no reload); `registerTrackNav` :2788 | both reach `paint()` - the per-advance seam for the menu |
| Library routes | lib/music/routes.js `/api/music` :197 (album/artist/filter/sort/limit, MAX 10000), `/albums` :237, `/artists` :255; items carry `genre`, `albumKey`, `artUrl`, chapter rows | no genre or playlist route |
| Swipe-back owners | common.js `SWIPE_BACK_OWNER_SELECTORS` :9949 ("scrubbers only", v1.311.3) | a sideways pivot swipe needs to own its drag |
| Where the skins render | in-tab: `renderNowPlayingSkin` music.js:1706 (mobile only); desktop: the pop-out `createPopoutShell` skin-surface.js:1634 (380x700 window so the <=768px CSS engages) | covered both; the tray (Nano) hides the menu view |

## Acceptance criteria

- **AC1** Every level is reachable by the wheel/pad AND by tap; center selects / drills in; MENU/Back climbs one level from every level; MENU from Now Playing climbs to the menu the song came from (or the Main Menu); MENU at the Main Menu docks.
- **AC2** A song chosen from a menu plays in that list's context (the list becomes the queue; the browse view behind mirrors it, index-true) and shows Now Playing; MENU returns to the list on that song.
- **AC3** The playing list follows the queue at EVERY advance, including a chaptered album rolling chapters with no reload (the v1.311 re-register rule); a repaint never throws the user out of a menu.
- **AC4** Real data: every level renders the real `/api/music*` payloads (chapters as `::c` songs, genres, liked); every id played is one the server returned.
- **AC5** Long lists stay fast: only a window of rows exists in the DOM; measured on a 3,006-song fixture.
- **AC6** Click = the 6G split screen in the skin's own palette; Seattle = Zune big type + pivots (pad + swipe). Legible at 390x844 and in the pop-out.
- **AC7** Views without a menu source (podcasts) and skins without an LCD (Cider, Nordic) are unchanged.
- **AC8** Census tools stay green (lint:css 0, overlay-containment 0, eslint 0 errors); no new global script (no shell-parity change); the registry field reaches its one list.

## Build record

Files:
- `public/js/music-skins.js` - `menus: 'click' | 'seattle'` ON the four registry entries (the one list; no second id list); the pure half: `menuStyle`, `menuPivots`, `menuTitle`, `menuStaticItems`, the payload builders (`menuArtistItems`, `menuAlbumItems`, `menuSongItems`, `menuArtistAlbumItems`, `menuGenreItems`, `tracksOfGenre`, `tracksOfAlbum` - each takes the VIEW's art rule, so no copy of `musicArtUrl`), `menuWindow` (the list window), `renderMenuList` / `renderMenuView` (Click split screen, Seattle pivots/title/root).
- `public/js/skin-surface.js` - `createPocketMenu` (module scope): the stack of levels (a pivot level = several panes), per-pane load with a skeleton seed, a post-await token + `destroyed` guard, empty/error states (Select retries), the cursor (`moveCursor`, reached from the engine's EXISTING cursor branch in `onMove`), the per-advance follow (`followCurrent`, keyed on the id), the list window re-render on scroll, the `dataVersion` re-load of open levels, the split screen's art (debounced 140 ms, eased in on decode, dropped on error), MENU/Select/left-right hooks. Wired into `create()`: built only when the view passes `config.menu`; `paint()` calls `afterPaint(ctx)`; MENU -> `onMenu()` before the dock arm; Select -> `onSelect()` before the queue-list arm; `onDown` mode = `(listMode || menuMode) ? 'cursor' : 'scrub'`; row/pivot taps and Seattle's pad left/right in `onClick`; the pivot swipe on the panel's own pointer stream (bound once in `bind()`, both end arms, removed in `destroy()`); `menuState()` on the api.
- `public/js/music.js` - the `menu:` config block; `menuLoad` (every level from the same routes the browse view reads, song lists in the browse view's own drill sorts), `playFromMenu` (the list becomes the queue; bumps `playSelectGen` + `loadSongsGen` so an in-flight select/load cannot land over it; re-draws the browse view FROM the queue - `renderDrillView` for album/artist, `renderSongList` + the crumb otherwise; `playAt(i, {soloChapter: true})`), `shuffleAllFromMenu` (whole library, `sort=random`, play-through, post-await gen check); ONE `invalidateMenuData()` for a delete/move (afterExtrasMutation) and a rescan, which drops the caches and bumps `dataVersion` so the engine re-loads every library level already on its stack at the next paint (a MENU climb back never shows a removed track).
- `public/css/style.css` - the menu view inside the existing `max-width:768px` skin block: Click split screen from the skin's own tokens (the v1.233 cursor gradient, the screen white, the status greys, `--mms-ipod-groove` / `--mms-ipod-art-shadow` on the art pane), Seattle Metro type from its own tokens (`--fs-5xl`/`--fs-6xl`, `--fw-light`, `--mms-zn-dim`, `--mms-zn-pink`); the tray hides the menu view; reduced motion drops the art ease.
- `public/js/common.js` - `[data-skin-swipe]` joins `SWIPE_BACK_OWNER_SELECTORS` (the pivot list is a sideways-drag control, Dean's "scrubbers only" rule's own category).
- Tests: `test/unit/music-pocket-menus.test.js` (19, new), `test/integration/music-pocket-menus.test.js` (12, new, real server + real music.js); `swipe-back-owners.test.js` (+1); updated locks: `menu-returns-to-origin.test.js` (the MENU lock re-anchored on the handler's own block instead of a 480-char window - the "widening is the trap" class), `music-skins.test.js` (the two-arm mode line now reads `(listMode || menuMode)`), `music-skin-integration.test.js` (the v1.231 MENU walk now passes through the Main Menu - the intended behaviour change).
- `docs/exec-plans/tech-debt-tracker.md` - #255-#258 (see Disclosed gaps).

Reference used (match-reference norm): the iPod classic 6th/7th-gen menu screen - a 320x240
LCD with a grey gradient title bar (menu name, play state, battery), a left-half list with a
blue gradient selection bar and white text, a `>` on drill rows and a speaker mark on the
playing song, and a right half showing album art with a slow pan. No new color was sampled or
invented: every color is a token this skin already carries (the bar gradient `--mms-ipod-bar1/2`,
the selection `--mms-ipod-blue1/2`, the screen `--mms-white`, the sub text `--mms-ipod-scr-sub`).
Seattle reuses its v1.262 Metro tokens. Side-by-side: the Now Playing and the menu screens in the
same skin, same session (PNGs below).

## Measurements

Probe: `click-skin-menus-probe.js` (session scratchpad) - boots this tree's server on a scratch
DATA_DIR seeded with 3,006 projected songs (150 artists x 4 albums x 5 + a 3-chapter mix + two
real albums), real WAV audio for the played items and PNG art, drives headless Chromium over
CDP. Every row below is what the probe PRINTED.

Run: all four skins at 390x844 (mobile emulation, DPR 2) and 380x700 (the pop-out's window
size), then the REAL desktop pop-out (1280x800 page, a CDP mouse click on `#music-popout-btn` =
a user gesture; Document PiP hidden so the plain-window fallback opens - headless cannot grant
PiP). Log: `click-skin-menus-probe.log`; 132 PNGs in `click-skin-menus-shots/` (session
scratchpad): per skin and size `-00-now-playing` ... `-14-back-to-list`, plus
`{ipod,zune-classic}-popout-00..04`. Every level reported `ok:true` (0 `ok:false`); every page
state line carried `errs:[]` (110 of 110 state lines).

| What | Printed |
|---|---|
| Click legibility, 390x844 | row 34 px, 14 px bold; list pane 173 px wide x 227 px tall (6.7 rows); art pane 173 px; `docW` 390 (no sideways overflow) |
| Click, 380x700 | row 34 px, 14 px bold; list 168 x 220; `docW` 380 |
| Seattle, 390x844 | Main Menu rows 60 px / 44 px light; lists 48 px / 22 px light; list 316 x 555 (pivot level); `docW` 390 |
| Seattle, 380x700 | lists 48 px / 22 px; list 306 x 411; `docW` 380 |
| Real pop-out window (plain fallback) | Click: menu 34 px rows, list 168 wide, `docW` 380; Seattle: 48 px rows, 306 wide. Headless reports `innerHeight` 509 for the 700-high window (window chrome), so the wheel is cut at the bottom of those PNGs - the pop-out's pre-existing geometry, not this change |
| Big list (3,006 songs), Click 390x844 | Songs level open (fetch + JSON + build + first paint, incl. the probe's 450 ms art settle) 1,224 ms; DOM rows 15 on open, 23 after a spin; scroll height 102,272 px = 3,008 x 34 |
| Wheel spin, 40 detents (200 pointermoves) | handler time 154 / 51 / 43 ms (Click / Black / Matte, 390x844), 136 ms Seattle; cursor 0 -> 180 (the shared speed multiplier) |
| Touch-scroll to the middle | the window followed within two frames: first rendered row 1,496, 23 rows in the DOM (scrollTop 51,136) |
| Other levels (Click 390x844) | Artists 552 ms (150 artists, scroll height 5,168), Albums 729 ms (600, 20,502), Genres 499 ms (8), chaptered album 3 rows (`Intro / Track A / Track B`) |
| Play a chapter from its album | `currentId` = `djmix1::c1`; Now Playing shown; MENU -> "Full Album Mix" with the cursor on Track A (index 1), on all 8 skin x size runs |

Headless timings run on software GL (swiftshader) and include network to a local server; they
are upper bounds, not device numbers.

## Mutant table

Runner: `click-skin-menus-mutants.js` (session scratchpad). Each mutant is applied to a sandbox
extracted from `git archive 85e0d562` (never the live tree), its replaced text is asserted to
occur exactly once and the file is compared before/after (every row: diff non-empty), the named
test files run, the file is restored. Log: `click-skin-menus-mutants2.log`. Fails = failing
tests across the named files.

| # | Mutant | Result |
|---|---|---|
| M1 | `paint()` never calls `pocket.afterPaint` | RED (8) |
| M2 | wheel mode line drops `menuMode` (a menu spin scrubs) | RED (5) |
| M3 | the cursor branch never calls `pocket.moveCursor` | RED (5) |
| M4 | `followCurrent` finds the id but never moves the cursor | RED (2) - unit follow + the integration chapter-roll/queue-next test |
| M5 | MENU's `pocket.onMenu()` arm dropped (MENU from Now Playing docks) | RED (21) |
| M6 | the Main Menu pops too (`> 1` -> `> 0`) | RED (2) |
| M7 | Select never reaches `pocket.onSelect()` | RED (18) |
| M8 | pad left/right move pivots on every level | RED (2) |
| M9 | the load callback's `destroyed` guard dropped | survived - EQUIVALENT: `render()` carries its own `destroyed` guard; M9c drops both -> RED (1) |
| M9c | both `destroyed` guards dropped | RED (1) |
| M10 | the load callback's `isVisible(pane)` guard dropped | survived - EQUIVALENT: levels hold per-pane state objects (a late payload can only write into its own pane), so an unconditional `render()` re-draws the shown level from ITS state - an extra repaint, never wrong rows. Kept as an avoided repaint |
| M11 | a failed art image is kept | RED (1) |
| M12 | a decoded art image never eases in | RED (1) |
| M13 | the swipe does not swallow its lift-off click | survived at 85e0d562 AND 07d2d928 (the test clicked a row of the DETACHED pre-swipe list, which never reaches the panel - a vacuous driver); af0cc56a clicks the song row of the NEW pivot under the pointer -> RED (1), re-run on the af0cc56a test (M8 / M14 re-run there too: RED) |
| M14 | the swipe never arms | RED (1) |
| M15 | no list window (every row rendered) | RED (1) |
| M16 | the no-layout window drops the cursor-centred span | RED (2) |
| M17 | `menus` dropped from the Matte registry entry | RED (2) - the census + the real-data Liked test on Matte |
| M18 | menu labels unescaped | RED (1) |
| M19 | the Unknown Genre bucket dropped | RED (2) |
| M20 | All Songs never offered | RED (2) |
| M21 | the album/artist play does not re-draw the drill behind the skin | RED (1) |
| M22 | the songs-list play does not re-draw the list behind the skin | RED (2) - incl. "a tapped browse row plays its own track" |
| M23 | `loadSongsGen` bump dropped (an in-flight browse load lands over the pick) | RED (1) |
| M24 | a menu pick plays through (not a v1.311 select) | RED (1) - the solo-exit station prime is absent |
| M25 | Shuffle Songs never plays | RED (1) |
| M26 | `[data-skin-swipe]` not a swipe-back owner | RED (1) |
| M27 | the MENU handler's final `else { onDock(); }` deleted | RED (4) - the re-anchored source lock + behaviour |
| M28 | the Main Menu keeps Now Playing with nothing loaded | RED (2) |
| M29 | opens on Now Playing with nothing loaded | RED (2) |
| M30 | the delete/move invalidation dropped | RED (1) - the real Extras delete drive |
| M31 | the rescan invalidation dropped | RED (1) - the real Scan button drive |
| M32 | the engine ignores a `dataVersion` bump | RED (2) |

Survivors: M9 and M10 only (equivalent, reasoned above). 31 RED.

## Disclosed gaps

- **D1 (#257, needs Dean)** - "nothing playing opens on the Main Menu" has no production entry: the skin only mounts over a loaded track. The engine arm is built and unit-bound through the real create()/paint(); a user path to an empty pocket player is a new entry point (Dean's call).
- **D2 (#256)** - the menu position does not survive a dock + return (the view re-inits the engine). Docking through MENU happens AT the Main Menu, so the common path loses nothing.
- **D3 (#255, widened at r1 per qa S7)** - a menu queue's list context is not fully reproducible: a genre queue has no list-context key, and the Songs level (10000) / the Liked and Recently Played filters are not honoured by the grid-tab rebuild (`rebuildPlayingQueue`: limit 1000, no `filter`).
- **D4 (#258)** - a thousands-long list is slow to cross by wheel alone (the shared cursor step is reused unchanged by design); touch-scroll is the fast path; no letter-jump overlay.
- ~~**D5**~~ **CLOSED at r1 (K4, the Architect's ruling)** - a chapter picked from a FLAT list (Songs, Genres, the playlists, an artist's All Songs) now plays its own segment and the LIST moves on; album / artist-album picks keep the v1.311 rule. Residual (reasoned, not driven): a deliberate SEEK into a chapter that is NOT in the flat list (a Liked list holding only one of a file's chapters) is displayed as the nearest listed chapter until the next load - the #231 (b) "bounds from the file's full chapter list" shape.
- ~~**D6**~~ **CLOSED at r1 (adversary S7)** - a browse render (any arm) superseded by a menu pick no longer paints (`menuPickGen`), test-bound for the drill arm.
- **D7** - the headless run is the evidence for layout and speed; the wheel FEEL on a phone (the haptic ticks in menu mode, the 22-degree step on long lists) is Dean's device pass.

## Gate verdicts

(r1 pending)

## Gate r1 - qa (@25929acd)

Instruments (run by this seat, output verbatim):
- New + touched tests (music-pocket-menus unit + integration, menu-returns-to-origin, music-skins, music-skin-integration, swipe-back-owners): `# tests 205 # pass 205 # fail 0`.
- Census set (css-token-lint, overlay-containment, comment-debt-census, comment-count, exec-plans-census, tech-debt-census, skin-surface, era-player-skins, setup-music-skin-picker, skin-scrollbar-hidden, token-scale-lock, type-scale-tokens, touch-eating-overlay-audit, docs-status-census, docs-link-census): `# tests 155 # pass 155 # fail 0`. Shell parity (shell-script-global-collisions, shell-singleton-invariant): `# tests 48 # pass 48 # fail 0`.
- `npm run test:unit`: `# tests 7121 # pass 7121 # fail 0 # skipped 0`.
- `npm run lint:css`: `TOTAL 0`. `node scripts/overlay-containment-lint.js --enforce`: `overlay-containment: clean (0 violations)`. eslint on the 10 changed JS/test files: `0 errors, 7 warnings`, all 7 in common.js (lines 204/413/690/4292/12240/12776/13168: setTheme, homeFeedEnabled, ...), the same functions on the same lines at ecb61e1d - pre-existing, none on the diff's one added line.
- Probe: a `git archive 25929acd` sandbox, the builder's probe plus QA additions, 390x844, ipod + zune-classic, POPOUT=0. Every level `ok:true`, every state `errs:[]`. Click: rows 34 px / 14 px / 700, list 173x227, art pane 173, docW 390. Seattle: root 60 px / 44 px, lists 48 px / 22 px, list 316x555. Songs spin: cursor 0 -> 180. A REAL CDP touch swipe (Input.dispatchTouchEvent) across Seattle's pivot list moved `Artists -> Albums` with the url still `/music`, and a touch tap on a row right after it drilled in (the swallow flag did not eat it). The legacy v1.231 queue row measured 34 px on both skins.

Findings:

1. **WARNING - a chapters-editor save leaves the pocket menus stale, and a stale chapter id then plays.** public/js/music.js:2565 (the `showChaptersEditor` onSaved callback: `loadSongs` + `renderDrillView` + `reflectEngines`, no `invalidateMenuData`) against music.js:3099-3106, whose comment claims "ONE invalidation for every seam that changes the library under the menus". Verified by a driven run: a sandbox integration test on this suite's own harness (the real music.js + engine + server) with the admin `.music-drill-chapters` button and a stubbed editor that saves the file down to two chapters, then calls the view's real onSaved. Printed: `server now returns: ["djmix1::c0","djmix1::c1"]`; `browse drill rows behind: ["djmix1::c0","djmix1::c1"]`; `album level after edit: Full Album Mix ["Intro","Track A","Track B"]`; `Songs after edit has Track B: true`; `played after edit: djmix1::c2 server has it: false`. Scenario: desktop pop-out on Click. The user opens Songs in the pop-out, then edits the album's chapters in the main window and drops the last chapter. The pop-out still lists "Track B" at the album level and in the cached Songs. Picking it queues and loads `djmix1::c2`, an id the server no longer returns, which breaks AC4 and writes progress under a dead chapter id (the #235 stranding class). The same thing happens on mobile after a collapse-handle dock within /music (the engine and its stack survive). Second part: `dataVersion` is read only in `afterPaint`. A seam that does not repaint (this save only calls `reflect()`; the Scan button in the main window while the pop-out is open) leaves the OPEN levels stale until the next track change, even once the caches are dropped. Prescription: (a) call `invalidateMenuData()` in the chapters onSaved callback; (b) check `cfg.dataVersion()` in the controller's `render()` (before `ensureLoaded`), not only in `afterPaint`, so a MENU climb re-loads a stale level with no repaint; (c) bind both with a test that drives the real `.music-drill-chapters` click (the shape above) and then climbs back into the open album level WITHOUT a paint.

2. **WARNING - a pick from a big menu list blocks the main thread for over a second (AC5 measured only open and spin, not the pick).** music.js `playFromMenu` runs `renderSongList()` over the WHOLE list, synchronously inside the row tap, before `showNowPlaying`. Measured on the 3,006-song fixture (headless, this box, 390x844): pick from Songs `syncMs 1304`, a `1393 ms` long task, `innerHTML` alone `394 ms`, `3008` rows behind. Pick from a 2-track album: `syncMs 21`. For comparison, the pre-existing browse Songs tab (limit 1000): `innerHTML 89 ms`, long tasks `158 / 85`. Shuffle Songs: `1923 ms` from tap to the new currentId (including the fetch), again `3008` rows. This is new with the diff: the browse caps its lists at 1000, while the menus queue and render up to 10000. Scenario: on a phone with a 3k library, the user taps a song in Songs (or a big genre, or Shuffle Songs). The screen freezes for more than a second (a phone CPU is slower than this box) before Now Playing shows and the audio starts. Prescription: keep the queue whole but do not build 3,000+ browse rows inside the tap. For example, clear `#music-content` synchronously (so no stale row can index the new queue) and render the rows in a follow-up task guarded by a generation counter, or window the browse song list. Re-measure the pick's long task.

3. **WARNING - Seattle lists visually attach each artist/sub line to the NEXT row (legibility at 390x844, AC6).** public/css/style.css:11684-11686 (`.mms-zune-classic .ipm-row` grid, `align-content:center` in 48 px, 22 px label + `--fs-sm` sub). Measured ink bands in CSS px on the albums pivot PNG: label 107-123, its own sub 137-148, the next label 155-171. That is a 14 px gap to its own title and 7 px to the next one. Scenario: on every Seattle Albums and Songs level, "blues pixel 104" reads as the artist of the album BELOW it. Only the lit cursor row is unambiguous. Prescription: tighten the label's line box (e.g. `line-height:var(--mms-lh-ttl)` on `.ipm-lbl`) and/or `align-content:start` with the leftover space placed BELOW the sub, so the gap inside a row is smaller than the gap between rows. Re-measure with the same ink-band scan.

4. SUGGESTION - Seattle pad HOLD on a pivot level fast-scans the track. skin-surface.js `onDown` arms `fastScan` from the pressed `data-skin-prev/next` zone whatever the screen is, while a TAP there moves the pivot. Holding right for 400 ms scrubs the playing song, and the pivot does not move. Reasoned, not driven. Consider skipping the scan arm when `pocket.isMenuMode()` and the level has pivots.

5. SUGGESTION - skin-surface.js:512 (the createPocketMenu cfg contract comment) lists load/onPlay/onShuffleAll/hasCurrent/currentId but not `dataVersion()`, which `afterPaint` reads. The contract comment is incomplete.

6. SUGGESTION - in the tray, `render()` writes the menu title into `.ip-np` while `body.mms-tray ... .mms-menumode .ip-npview{display:flex}` shows Now Playing. A pop-out shrunk to the tray mid-menu shows e.g. "Songs" over the Now Playing view. Reasoned, not driven.

7. SUGGESTION - widen #255. The Songs level (limit 10000) and the Liked / Recently Played playlists have the same list-context gap as genre. `rebuildPlayingQueue` (music.js:2959) reloads with `loadSongs` (limit 1000) and does not pass `ctx.filter`. So after a dock-return re-init on a grid tab, a pick past Songs row 1000 gets `ci -1` and its nav is cleared. Reasoned, not driven.

8. SUGGESTION - a like/unlike through the sticker does not bump `dataVersion`, so a Liked Songs level already on the stack keeps the old row until it is re-entered. Cosmetic.

Not findings (stated so the surface is covered):
- **Click row tap targets (34 px):** the same pitch as this skin's own v1.231 queue rows (measured 34 px on both skins) and the device's density. Rows are 173 px wide, and the wheel is the primary input. No minimum is codified in CONTRIBUTING/AGENTS. Not a finding. Dean's device pass owns the feel.
- **Security:** no server or route change. Every library string rendered into the menus goes through `esc()`: label, sub, pivot labels, title, the listbox `aria-label`, emptyText and the art `src`. Attributes are double-quoted and indices are numeric (M18 binds the escaping). Fetch params use `encodeURIComponent`, and the crumb is set via `textContent`. The data comes from the same `trackVisibleTo`-gated `/api/music*` routes the browse reads, and genre is derived client-side from rows the user can already see. Nothing new is logged or exposed.
- **CSS:** tokens only (lint 0), raw px annotated `token-exempt`, and no radius on the scroller (the overlay split holds). No `position:sticky` and no `[hidden]` use were added. The tray override restores the SAME display (`flex`) as `.mms-ipod .ip-npview` (no gap-dropping `block`).
- **AC7:** podcasts pass no `menu` (grep: `menu:` appears only in music.js), and on Cider/Nordic every hook declines (style '').
- **Registry:** `menus` sits on the entries, and the census binds it.
- **Tracker:** #255-#258 are unique across the local branches (main 251-254, chapter-snap 239-241, desktop-theatre 247, music-followups 243).
- **Hygiene:** no em dashes and no TODO/FIXME in the added lines.
- **Visual:** Click is the 6G split screen (blue bar, white text, chevrons, the speaker on the playing row, art on the right). Seattle has lowercase pivots trailing off the edge and big light type.
- **Plan claims vs the tree:** they hold except the "every seam" invalidation claim (finding 1) and AC5 as it applies to the pick path (finding 2). The mutant table arithmetic checks out: 33 rows, 31 RED, M9/M10 survived as equivalents.
- **Merge note:** main has moved past ecb61e1d (style.css +45, tracker +4), so re-run lint:css, overlay and the tracker census after the merge.

Tree: this seat wrote only this section. `git status` was clean before it; the QA probe and the driven chapter test ran in a scratchpad `git archive` sandbox, never in this worktree.

Gate: CHANGES r1 @25929acd — qa

## Gate r1 - adversary (@25929acd)

Instruments (this seat, verbatim; every mutation and probe ran in `/tmp/adv-csm` from `git archive 25929acd` / `ecb61e1d`, never in this worktree):
- The six new/touched test files: `# tests 205 # pass 205 # fail 0`. `npx eslint .` (my scratch probes excluded): head `0 errors, 7 warnings`, base `0 errors, 7 warnings`. `lint:css` `TOTAL 0`; overlay `clean (0 violations)`.
- 24 mutants of my own (runner `/tmp/adv-csm/mutants.js`, each anchor asserted unique, each diff non-empty, the same six files): **5 RED, 19 SURVIVED** - listed under finding 5.
- Headless Chromium (`/tmp/adv-csm/probe/adv-probe.js`, the builder's 3,006-song fixture, 390x844 mobile, CDP touch): pick timing at CPU x1 and x4, a real touch swipe and a diagonal scroll on Seattle's pivots.
- jsdom: listener balance over 20 create/paint(4 skins)/menu/swipe/spin/destroy cycles: panel `0`, document `0` net listeners after; window `9`, which are jsdom's own one-per-type capture listeners, the same 9 on base. Base-vs-head parity of the engine (paint + next/prev/play/select x3/menu x3, DOM snapshot after every press + the host-control log) for podcasts-shaped Click and Seattle (no `menu` cfg), music Cider/Nordic and podcasts Cider/Nordic: **IDENTICAL** on all six.

Findings:

1. **WARNING - the playing list's cursor is yanked while you browse it; Select then plays the wrong song.** skin-surface.js `followCurrent` moves `p.cursor` of every `playing` pane at every advance, including the pane on screen. Verified (sandbox integration test on this suite's harness): Songs, pick row 0 (Cartridge Blues), MENU back to Songs, four detents down to `Overpass`, then the queue advances (`nav.onNext`). Printed: `after advance: cursor on Intro`, then `Select played djmix1::c0 (user wanted Overpass)`. Scenario: a phone user returns to the list they are playing from, spins to a song and reaches for the center just as the current track ends. The highlight jumps to the now-playing row and the press replays that instead (the v1.104 wrong-track class, timed by track length). The real device never moves a highlight you are looking at. The builder's unit test `a song pick hands the view ... MENU returns to it` asserts this yank (`b.state.current = 'a'; b.engine.paint()` with the menu visible, expect cursor 0), so the behaviour is designed in, not accidental. Prescription: follow only a pane that is NOT visible; for the visible pane move only the `is-current` speaker mark, and keep a pending follow that applies at the next MENU-from-Now-Playing. Verified partly: guarding with `if (!p.playing || isVisible(p)) return;` kept the cursor on Overpass (`Select played nd2`) and reddened exactly that one unit assertion (`pass 186 fail 1`), which must be rewritten to the new rule. The pending-follow part is untested.

2. **WARNING - the chapter-editor save is a library seam the ONE invalidation missed (the INERT SIBLING class).** This is QA's finding 1, reproduced independently with a different mutation: I re-timed the chapters instead of dropping one. The editor saved `Renamed A @600, Track B @1200, Track C @1500` and the browse drill behind showed all four chapters. The open album level still read `["Intro","Track A","Track B"]`, and so did the cached Songs level. Picking the stale row printed `loaded djmix1::c1 title Track A chapterStartSec 300`, so the WRONG segment plays, from the old offset. The solo exit also bounds on the stale queue. `playFromMenu` then re-draws the fresh browse drill FROM the stale queue, so the fix the editor just painted is overwritten. QA's prescription (a)+(b)+(c) covers it. Add the re-time case to the binding test (the offset, not only the id).

3. **WARNING - a pick from a big list freezes the page.** This is QA's finding 2, reproduced independently at phone-class CPU. Pick from the middle of Songs (row 1506 of 3,008): CPU x1 `syncMs 1491`, long task `1753`. CPU x4 `syncMs 5590`, long task `6339`. `3008` rows and `3008` imgs were built behind the skin. The same seam from a 3-song album: `syncMs 99` / `36`. Shuffle Songs at x1: long task `1043`. Prescription as QA's. Re-measure the pick at CPU x4, not only x1.

4. **WARNING (disclosed D5, measured wider than stated) - a chapter picked from an interleaved list.** Base never reaches this in normal use: a browse Songs-tab tap drills into the album first (`playRowAt` -> `playTrackInAlbum`). The menus make an interleaved chapter pick the default for Songs, Genres, Liked, Recently Added and Recently Played. Measured (fixture Songs order `Cartridge Blues | Intro | Loose Single | Neon Arrival | Overpass | Pixel Rain | Tail Lights | Track A | Track B`), picking `Intro`:
   - At the segment end nothing exits. `fetchAutoplayPicks` excludes every queued id and the queue is the whole library, so `soloExitPicks` is null and the solo exit degrades to a straight-through listen. The whole mix plays.
   - After the roll to `Track B`, Next loaded nothing: playback ends and the 5 songs in between never play.
   - In the general case (a last sibling mid-list) the exit lands after the last same-base chapter, as disclosed. In a 3k title-ordered library that can skip thousands of songs.
   Safe to ship only on Dean's explicit ruling. Otherwise: for a menu list with no `drill` (not album/artist-scoped), exit a picked chapter to list index `i + 1`, the #231 fix scoped to menu picks.

5. **WARNING - guards the plan names are present but unbound (presence-not-binding); each mutant below leaves all 205 tests green.**
   - **A20:** drop `esc()` on Seattle's drilled-level `.ipm-title`, the artist/album/genre name. My runtime probe (a crafted `<img onerror>` in title, artist, album and genre, visiting every level on both skins) then counted 1 injected element at `pivot0>1` and `pivot1>1`, yet the suite stayed green. Unmutated, the same probe counts 0 injected elements at every level. QA's "M18 binds the escaping" holds for the row labels only.
   - **A22:** drop `esc()` on Seattle's `.ipm-sub` (the artist).
   - **A9:** drop the Shuffle Songs post-await `gen !== playSelectGen` check. With a delayed shuffle fetch and a menu pick meanwhile: unmutated `after late shuffle lands: rm2`; mutated `nd1`, so the late shuffle plays over the pick. That is the TOCTOU class, and no committed test drives it.
   - **A15:** drop the artist-cache reset in `invalidateMenuData`, so a deleted track lingers under Artists > X.
   - **A14:** drop the load success-path token check, so a pre-invalidation payload can land after the re-load.
   - **A5:** leave the swipe's pointerup bound at `destroy()`. My balance probe shows it is removed today; nothing binds it.
   - **A4:** make the swipe's pointercancel arm a no-op ("both end arms clear it").
   - **A6:** drop the axis guard, so a vertical mouse drag of 40 px or more on the pop-out flips the pivot.
   - **A3:** drop the pointerId match.
   - **A10:** drop the `playSelectGen` bump in `playFromMenu`.
   - **A23:** point Recently Played at `sort=newest`. No test opens Recently Played or Recently Added, so AC4 is unbound for 2 of the 3 playlists.
   - **A24:** return the whole library for the untagged-artist bucket. The fixture has no untagged artist, so the case the code comment names is never driven.
   - **A1:** a follow never re-centers the list. No layout exists in jsdom, so the list can land with the highlight off-screen.
   - Equivalent or near-equivalent (reasoned): A2 (drop the `lastCurrent` reset), A7 (the swipe zone exists only in menu mode), A8, A11, A12, A13, A21 (the pivot labels are static strings).
   Prescription: bind A20/A22 (a crafted name through `renderMenuView('seattle', {title, items:[{sub}]})` plus the aria-label), A9 (the delayed-shuffle shape above), A15/A14 (delete or invalidate while a level loads), A5/A4 (a listener-balance test, my `zz-adv-leak` shape) and A23/A24 (real data). Re-run these mutants.

6. SUGGESTION - skin-surface.js, the comment above the MENU handler still says "menu-returns-to-origin.test.js matches data-skin-menu -> onDock within 220 chars". This diff re-anchored that lock on the handler's block, so the comment is now false. The v1.270 window was already 480.

7. SUGGESTION (suspicion, reasoned, not driven) - a browse DRILL render already in flight when a Songs-type menu pick lands: `render()` entered its `if (drill)` arm before the await. After `loadSongs` returns early (the `loadSongsGen` bump), it still runs `renderDrillView()` with `drill` now null. The result is a generic "Artist" drill header over the menu's Songs rows. The rows stay index-true (built from `queue`), so it is cosmetic. It is D6's sibling, but on the drill arm, which D6 does not name.

Verified clean (the named surfaces):
- Stale level TOCTOU and destroy mid-load: the builder's tests pass.
- The ended rewind to 0 after the last chapter leaves the menu on `Track B` (driven: cursor and speaker mark both `Track B`).
- A real CDP touch swipe moves `Artists -> Albums` with `pointercancel 0`. A diagonal-vertical touch scroll (dx -48, dy -160) fires `pointercancel 1`, leaves the pivot unchanged and scrolls the list (`scrollTop 146`).
- The wheel routes only through the existing `onMove` cursor branch. A sweep of the added lines finds no copy of `WHEEL_STEP_DEG`, `sweepOffset`, `detentDeg` or `atan2`, and no new touch listener (only pointer listeners and one capture scroll listener, so no passive-ness question).
- No `public/*.html` change, so shell parity is untouched.
- Podcasts pass no `menu`. The three re-anchored locks still bind: builder M2/M27 plus my read of the block regex, and an `else if (!pocket) { onDock(); }` mutant cannot match `else \{ onDock`.
- Data exposure: the same `trackVisibleTo`-gated routes the browse view reads.

Verdict: the three blocking WARNINGs are 1, 2 and 3. Finding 5 blocks as a bundle: the escape and TOCTOU guards must be bound before approval. Finding 4 needs Dean's ruling or the scoped fix.

Tree: this seat wrote only this section. Before it, `git status` showed only QA's uncommitted section in this file. No pre-existing untracked files.

Gate: CHANGES r1 @25929acd — adversary

## Gate r1 fix record (builder, after @25929acd)

Commits: 894ba505 (both r1 sections, as-is) -> b7309935 (merge main v1.319.0 - done BEFORE the
fix commit, not after: the hook's release-ledger test fails on any branch that lacks the new
tag's ledger entry, so no fix could commit until main was in; the fixes sat in a uniquely-tagged
stash across the merge, applied by SHA, dropped by tag) -> 2bcfe9d5 (K1-K6 + the suggestions) ->
cbe5ce7b (K3 + adversary S7 bindings) -> 96087c1b (merge main v1.320.0, one conflict: the
autoplay append - main's markAutoplayPicks kept beside the flat carry) -> 8bab3d9a (two holes the
builder's r1 mutant pass found, + v1.320 interplay) -> 994d28d7 (merge main v1.321.0, clean) ->
this commit (N20 binding + this record).
The integration harness moved to `test/helpers/pocket-menu-harness.js`; the r1 bindings live in
`test/integration/music-pocket-menus-r1.test.js` (its own server + fixture: a native untagged
track, crafted-markup names, thirty fillers).

| Finding | Fix | Test (binding) | Mutant -> result |
|---|---|---|---|
| **K1** adversary W1 (the yank) | `followCurrent` skips the list ON SCREEN (its speaker mark still moves - render reads currentId); an off-screen list follows and is re-centred. A pending-follow was prototyped and REMOVED: the playing list is a leaf level, so it is off screen only while Now Playing is up - a pending follow is unreachable (an inert branch) | unit "gate r1 K1" (the old jump-assertion rewritten to the rule: park, advance, the highlight stays, the mark moves, Select plays the parked row, then an off-screen advance follows); r1 integration K1 = the adversary's repro on the real view | N1 (yank back in) RED 2; M4 (off-screen never follows) RED 3 |
| A1 | (the follow's `center` flag, unchanged) | unit "A1" with a jsdom layout (rows 34 px, list 102 px): cursor 40 -> scrollTop 1326, the row rendered | M4 RED (incl. this test) |
| **K2** qa W1 = adversary W2 (chapter save) | ONE seam: common.js `notifyLibraryChanged()` / the `filetube:library-changed` document event, raised by `showChaptersEditor` on every successful save (any surface); the music view listens (and its drill onSaved invalidates directly); the engine reads `dataVersion` in EVERY `render()` and before every user action (`checkData`), so an open level re-loads with no skin repaint - the pop-out included | r1 "K2 ... RE-TIMES and DROPS" (the real drill button; re-time: the open level shows `Renamed A` and plays `chapterStartSec 600`; drop: the Songs level equals the server's list); r1 "the ONE seam" (the real common.js function re-loads an open level on the next wheel step); unit "the chapters editor raises the ONE event (not on a failed save)" | N2 RED 1, N3 RED 7, N4 RED 1, N5 RED 1, N6 RED 1 |
| qa S8 (liked) | `likedVersion` bumped by the browse heart and the Extras like; only an open Liked Songs level re-loads | r1 "an unlike re-loads an OPEN Liked level"; unit "likedVersion ... ONLY" | N7 RED 1, N7b RED 2 |
| **K3** qa W2 = adversary W3 (freeze) | a flat pick clears the browse list and re-builds it in 20-row chunks, ONE PER FRAME, each its own `.music-song-chunk` block (`content-visibility:auto`) - the list is a flex column, and rows appended straight into it re-laid out every row each frame (profiled: native rendering, not JS); the build stops only when superseded | r1 "K3 ... clears at once, chunks after, index-true, a newer pick abandons the older build"; r1 "an autoplay append mid-build never strands the list" | N8 RED 1; N9 (the old `list !== queue` stop) RED 1 - it stranded a half-built list when an autoplay append re-assigned `queue` mid-build, found by this pass |
| **K4** adversary W4 (the Architect's ruling) | `flatQueue`: a pick from a FLAT list (no drill, or `play.flat` - an artist's All Songs) plays its own segment (start + its span), then `playAt(i + 1)`; a next row that IS the file's next segment rolls on untouched (no reload); the file's last chapter leaves it to the ended advance; the loop outranks it; a scrub is ignored; drill picks keep v1.311 (solo exit); the flat mode rides an autoplay append and a v1.320 retract; the seam asks v1.320's `autoplayHoldsAt` (Autoplay off ends the list at the segment) | r1 "K4 ... FLAT list" (the real interleaved Songs: Intro hands on to the list's next row; Track A rolls on into Track B with no reload); r1 "artist's All Songs"; r1 "a flat list's LAST row ... station appended"; r1 "Autoplay OFF after the station" (hold) and "through the real toggle RETRACTS" | N10 RED 3, N11 RED 2, N12 RED 1, N14 RED 3, N19 RED 1, N20 RED 1 (after its test); N13 (the last-chapter guard) SURVIVED here and was WRONGLY called equivalent - refuted at gate r2 (adversary S2: without it a flat list ending at the file's LAST chapter pauses 0.2 s short and the file never ends); bound at r2, RED |
| **K5** qa W3 (Seattle rows) | a Seattle list with sub-lines is a TWO-LINE list (`.ipm-2l`: 60 px pitch - uniform, the window math needs one - title + sub packed at the top) | unit "A20/A22 + K5" (the class, and none on a one-line list); probe bands below | N15 RED 1 |
| **K6** adversary W5 bindings | (tests only, plus the fixes above) | A3/A4/A6 unit (one pointer, pointercancel, the axis - with a clean-swipe control); A5 unit (panel listener balance net 0 after destroy + a dead swipe); A14 unit (a pre-invalidation load lands last and stands down); A9/A10/A15/A23/A24 r1 integration; A20/A22 unit + a runtime probe across every level of both skins with crafted markup in a title, artist, album and genre | A3, A4, A5, A6, A9, A10, A14, A15, A20, A22, A23, A24 all RED |
| qa S4 | no hold-to-scan on a pivot level (the pad moves the pivot) | unit "qa S4" (+ the Now Playing control scans) | N16 RED 1 |
| qa S5 | the contract comment names `dataVersion` / `likedVersion` | - | - |
| qa S6 | no menu (nor its title) in the Nano tray | unit "qa S6" | N17 RED 1 |
| adversary 6 | the stale "within 220 chars" comment rewritten | - | - |
| adversary 7 (and D6) | a browse render superseded by a menu pick does not paint (`menuPickGen`; at r1 the drill, songs, albums and artists arms - NOT yet Home or the catch arm, which gate r2 found and r2 fixed) | r1 "a drill render in flight ... never paints its header" | N18 RED 1 |

**Mutant table at 8bab3d9a** (runner `click-skin-menus-mutants-r1.js` in the session scratchpad,
sandbox extracted from 8bab3d9a, each anchor asserted unique, each diff non-empty; log
`click-skin-menus-mutants-r1b.log`): **57 of 59 RED**; N20 survived there and is RED against the
test added in this commit; **N13 survived** - the "reasoned equivalent" written here was wrong (refuted at r2, now bound and RED). The re-run r0 mutants (M1-M31)
are all RED on the new tree (M9/M10 stay equivalent as recorded above).

**Measurements (final tree, headless Chromium, 3,008-song fixture, 390x844):**

| | before (@25929acd) | after |
|---|---|---|
| pick Songs row 1506, CPU x1 | tap 1,408 ms; long tasks [1801, 206, 120] | tap 14 ms; long tasks none |
| pick Songs row 1506, CPU x4 | tap 5,686 ms; long tasks [288, 6466, 493] | tap 68 ms; long tasks [78] in the probe's 1.5 s window only - over the WHOLE fill qa measured 33 long tasks of 50-184 ms (about 10 s behind Now Playing; corrected at gate r2) |
| Shuffle Songs, CPU x1 | long tasks [966, 146, 118] | none |
| pick from a 3-song album, x1 / x4 | 108 / 43 ms | 30 / 32 ms |

(The intermediate runs are in the log trail: a first chunked build with timer-paced chunks still
showed a 1,471 ms layout task at x1, which the CPU profile traced to native rendering of a flex
column re-laid out per append - hence the per-frame, per-block chunks. The adversary's probe's
x4 Shuffle step does not start a second shuffle - it reports the x1 one - so only x1 Shuffle is
measured. Timings are headless swiftshader upper bounds.) The browse list still fills in the
background (about 20 rows per frame).

K5 bands (Range boxes of the text lines, albums pivot, 390x844): before - 2 px to its own title,
2 px to the next (qa's pixel ink scan: 14 vs 7); after - 60 px rows, 5 px to its own title,
11 px to the next, on every row measured.

Re-probe 390x844 (all four skins, POPOUT=0, `click-skin-menus-probe-r1.log`, 61 PNGs in
`click-skin-menus-shots-r1/`): 46 level lines `ok:true`, 0 `ok:false`, 55 of 55 state lines
`errs:[]`; the Songs spin still 0 -> 180, the mid-list scroll re-windows (first row 1,496, 23 in
the DOM); a chapter played from its album and MENU returns on Track A on all four skins.

Censuses after both merges: `npm run lint:css` TOTAL 0; overlay-containment clean (0); eslint 0
errors (the pre-existing common.js warnings: 6); tech-debt census, exec-plans census and
check-markers clean; the hook's full unit suite 7187 / 7187 at 8bab3d9a and 7206 / 7206 at the
v1.321.0 merge (994d28d7), where lint:css (0) and overlay (0) were re-run too.

## Gate r2 - qa (@e76bc766)

Delta review: the fixes 2bcfe9d5 / cbe5ce7b / 8bab3d9a / e76bc766, the three merges of main (b7309935, 96087c1b, 994d28d7), and the branch against main (`git diff main HEAD`, where main = 580e5f7f = the merge base: 15 files).

Instruments (run by this seat, output verbatim):
- Touched tests: pocket-menus unit + both integration files, menu-returns-to-origin, music-skins, music-skin-integration, swipe-back-owners, ambient-glow-engine, music-ambient, music-chapter-reflect, chapter-likes. Result: `# tests 339 # pass 339 # fail 0 # skipped 0`.
- Census set (the same 15 files as r1): `# tests 155 # pass 155 # fail 0`. Shell parity: `# tests 48 # pass 48 # fail 0`.
- `npm run test:unit`: `# tests 7206 # pass 7206 # fail 0 # cancelled 0 # skipped 0`.
- `npm run lint:css`: `TOTAL 0`. Overlay lint `--enforce`: `clean (0 violations)`. eslint on the changed JS, tests and harness: `0 errors, 6 warnings`, all in common.js and all pre-existing. `.harness/lib/check-markers.sh`: `clean (docs/exec-plans)`.
- Probes: a scratchpad `git archive e76bc766` sandbox and headless Chromium at 390x844 (details under each finding below).
  - The full r1 level walk on Click + Seattle: 22 level lines `ok:true`, 0 `ok:false`, 31 of 31 state lines `errs:[]`.
  - The Songs spin still goes 0 -> 180, and the mid-list scroll re-windows (first row 1496, 23 rows in the DOM).
  - A chapter played from its album, then MENU, lands on Track A on both skins.
  - A real CDP touch swipe moves Artists -> Albums, and a tap right after it drills in.

r1 findings:
1. **W1 - FIXED as prescribed, verified two ways.**
   - (a) My r1 driver test, re-run on the r2 tree with the real drill `.music-drill-chapters` save dropping Track B: `album level after edit: Full Album Mix []` (the level is re-loading) and `Songs after edit has Track B: false`. The pick now plays `djmix1::c0`, which the server has. At r1 it played the dead `djmix1::c2`.
   - (b) New, in a real browser: the POP-OUT (the plain-window fallback) sits open on the Full Album Mix level while the REAL `showChaptersEditor` in the MAIN window saves `0:00 Intro / 0:20 Track A`. Printed: `saved: onSaved`; the server returns `["djmix1::c0=Intro","djmix1::c1=Track A"]`. Tapping the stale "Track B" row in the pop-out re-loaded the level to `["Intro","Track A"]`, the menu stayed up, and nothing played (`currentId` stayed `nd1`).
   - The seam is complete: common.js:12853 is the ONE chapter writer on this tree. The sibling feat/chapter-snap also writes only through that same editor fetch.
   - Residual (SUGGESTION 1 below): until the user acts, the open level still SHOWS the dropped row.
2. **W2 - FIXED.** Picking Songs row 1506 of 3008:
   - CPU x1: tap `19 ms`, long tasks none, 620 rows after 3 s, final `3008` rows in 151 chunks, `badIndex 0`, and the playing row is index 1506.
   - CPU x4: tap `178 ms`, final 3008 rows, `badIndex 0`.
   - Shuffle Songs at x1: tap `1 ms`, `111 ms` to the new track, long tasks none.
   - r1 was a tap of `1304 ms` and a `1393 ms` long task.
   - Measurement disagreement (SUGGESTION 2): at x4 I see 33 long tasks of 50-184 ms across the whole fill, where the fix record says `[78]`.
3. **W3 - FIXED.** Range boxes on the Seattle albums AND songs pivots: `own 5 / next 11` px on every row measured. The artists pivot has no sub-line and stays at 48 px (`list2l:false`). The PNG shows every artist line clearly under its own title.

r1 suggestions:
- **S4 - fixed, verified in a real browser** with the player paused. Holding pad-right for 1.2 s on the pivot level: `dt 0`, and the pivot moved to Albums. Control, the same hold on Now Playing: `dt 2` (it scanned).
- **S5 - fixed.** The contract comment names `dataVersion` and `likedVersion`.
- **S6 - fixed** (with `body.mms-tray` forced in the main page): `menuView:false`, `np:"Now Playing"`.
- **S7 - fixed.** #255 is widened, and the tracker diff against main is exactly +255..258 (no row deleted, no duplicate ids).
- **S8 - fixed, verified in a real browser.** Liked Songs was open with `["Overpass"]` and the browse heart was clicked. One wheel step later the level showed `["Songs you like show up here."]`, and the server's liked list is `[]`.

Asked-for checks:
- **content-visibility:auto** (style.css `.music-song-chunk`): these are the chunk blocks inside `#music-content`, a different element from the ambient stage. The v1.312 lock scans only the glow/stage rules, and it passes (ambient-glow-engine is in the 339 above). A chunk holds only song rows, which have no fixed or sticky descendants (grep in CSS and markup), and nothing scrolls a row into view. `contain-intrinsic-size` is lint-clean. No overlay violation.
- **Merge resolution in music.js:** the append keeps main's `markAutoplayPicks(picks)` and puts the flat carry around the concat. v1.320's retract carries a flat queue (`flatQueue = kept`). The other `queue` writers either replace the whole queue (the flat mode ends correctly) or are the solo-exit station append, which a flat queue never reaches (`enforceFlatSegmentEnd` runs first).
- **Comments:** the touched comments are accurate, except 3 and 4 below.

New in the delta (all SUGGESTIONs, none blocking):
1. The pop-out, or an in-tab level with no repaint, keeps SHOWING the dropped chapter row until the next wheel step, tap or Select. It can no longer play it: the action re-loads the level instead. Scenario: a chapter is saved in the main window while the pop-out sits on the album level; "Track B" stays visible until touched. Option: re-render the shown level when `dataVersion` moves (e.g. the view's event handler calling the engines' `reflect()`).
2. The fix record's x4 row ("long tasks [78]") does not match my measurement over the whole fill: 33 long tasks of 50-184 ms, at roughly one chunk per frame, for about 10 s behind Now Playing. There is no freeze and the tap takes 178 ms, so it is shippable. But at phone-class CPU each 20-row chunk still costs more than 50 ms. Correct the record, or size the chunks by time (e.g. stop a chunk after about 8 ms).
3. music-skins.js:445: the `has-sub` row class is INERT. No CSS reads it, because the packing is `.ipm-list.ipm-2l`. Yet its comment says it "packs its sub-line UNDER its own title", and unit music-pocket-menus.test.js:594 asserts its PRESENCE with that message (presence, not binding; N15 binds the real `.ipm-2l`). Drop the class and its assertion, or fix the comment.
4. music.js:3334: "the first chunk waits for the next task". `later()` actually waits for the next animation frame, then a task.
5. Merge note: feat/chapter-snap edits `showChaptersEditor` near the same lines as the new `notifyLibraryChanged` call (common.js ~12853-12865). Whichever lands second must keep the notify call in the success arm.

Tree: this section is my only write. Before it, `git status` was clean at e76bc766. All probes and the driven tests ran in scratchpad sandboxes.

Gate: APPROVED r2 @e76bc766 — qa

## Gate r2 - adversary (@e76bc766)

Instruments (this seat, verbatim; all runs in `/tmp/adv-csm2` from `git archive e76bc766`, never in this worktree):
- The seven pocket-menu test files (the r0 suites, the locks, `music-pocket-menus-r1`): `# tests 235 # pass 235 # fail 0`.
- `npx eslint .` (my scratch probes excluded): `0 errors, 6 warnings`. lint:css `TOTAL 0`. Overlay `clean (0 violations)`. tech-debt + exec-plans census `pass 4 fail 0`.
- 26 mutants of my own (runner `/tmp/adv-csm2/mutants.js`, each anchor unique, each diff non-empty, the seven files): **24 RED, 2 SURVIVED** (R7 = the builder's N13, R12).
- Headless Chromium, the 3,008-song fixture, 390x844.

**r1 findings against the fix:**
1. W1 (the yank): **fixed as prescribed.** My r1 repro now prints `after advance: cursor on Overpass` and `Select played nd2` (nd2 = Overpass). Mutant R1 (the yank restored) goes RED 2. The builder dropped my pending-follow half. The reason given is that the playing list is a leaf level, so it is off screen only while Now Playing is up. I accept that: MENU pops the leaf, so there is no path back to a list that followed while hidden.
2. W2 (chapter save): **fixed, differently and better.** The fix is one common.js seam plus a `checkData` read before every render and every action. On my r1 re-time repro the open album level re-seeds a skeleton, the cached Songs level reads `["Intro","Renamed A","Track B","Track C"]`, and the stale row is gone. Mutants R2 (the editor never notifies), R3 (the view ignores the event) and R4 (`render` never checks) go RED 1 / 1 / 7. The listener is `{signal}`-scoped and dies with the view's `controller.abort()`. `player.js`'s own chapters editor goes through `showChaptersEditor`, so it fires the event too.
   - Carry-forward for Chapter Snap: if its save does NOT go through `showChaptersEditor`, it must call `notifyLibraryChanged()`, or its saves bypass this seam.
3. W3 (freeze): **fixed.** Pick row 1506 of 3,008:
   - CPU x1: tap `16 ms`, long tasks `[53]`.
   - CPU x4: tap `79 ms`, long tasks `[92]`.
   - The build completes: `3008` rows in `151` chunks, `data-index` true for every row, JS heap `9 MB`.
   - Shuffle Songs x1: no long task, `2460` rows filled 4 s after the tap.
   - A 3-song album: `23` / `25 ms`.
   - Mutant R5 (back to the full render) goes RED.
   - In jsdom, an advance mid-build plus a tap on an already-built row played the tapped row (`nd1`).
4. W4 (D5): **fixed per the Architect's ruling K4.** My r1 repro on the interleaved Songs list: the picked chapter handed on to the list's next row (`Loose Single`), then Next went to `nd1`. That is no longer the rest of the file, and no longer a jump past the list.
   - Mutants R6 (never flat), R9 (a retract drops flat), R10 (an append drops flat) and R11 (the flat end ignores Autoplay off) all go RED.
5. W5 (unbound guards): **all 13 now RED** (A1, A3, A4, A5, A6, A9, A10, A14, A15, A20, A22, A23, A24).
   - A10 reddens its own test and A9's.
   - A20/A22 are killed by both the unit test and the runtime probe.
   - My r1 runtime escaping probe still counts 0 injected elements at every level on both skins.
   - Listener balance after 20 cycles is still panel 0, document 0.
6-7. **Fixed.** The stale "220 chars" comment is rewritten, and S7 is bound (R8 RED). Also fixed per QA: no hold-to-scan on a pivot level (R13 RED).

**New findings in the fix:**

1. **WARNING - a flat list's end-of-list pause re-fires on every resume for about a second.** music.js `enforceFlatSegmentEnd`, the `mp.pause()` arm, has no one-shot.
   - The band `t >= end - 0.25 && t < end + 1` stays true after the pause, so each timeupdate after the user presses Play pauses again.
   - Verified (sandbox integration test on the builder's r1 fixture): Autoplay OFF, Liked Songs = `Track A` (`djmix1::c1`, mid-file), picked. At `899.9` it pauses once (correct). Then the user presses Play and ticks run `900.1 ... 901.35`: `pauses 5`. Four re-pauses in the first second of playback.
   - Scenario: Autoplay off (v1.320's setting), a flat list (Liked, a genre, Recently Played) whose last row is a chapter mid-file. The list ends; the user taps Play to keep listening. Each tap gives about 250 ms of audio and then pauses, up to four times. The same arm fires with Autoplay ON when the station comes back empty; the whole-library Songs queue excludes every candidate.
   - This is new with K4. Base's solo exit degrades to a straight-through listen and never pauses.
   - Prescription (verified): the list is done at that pause, so drop the flat mode before pausing:
     ```js
     flatQueue = null;
     try { mp.pause(); } ...
     ```
     With that line P1 prints `pauses 1` at the boundary and `1` after the resume ticks. The two pocket-menu integration suites stay `pass 30 fail 0`, including all three K4 x v1.320 Autoplay-off tests. Bind it with the P1 shape: after the pause, resume ticks inside the band must not pause again.

2. **SUGGESTION - the builder's N13 "reasoned equivalent" is refuted; the guard is correct but unbound.** R7 (drop the last-chapter guard `if (dur > 0 && end >= dur - 0.5) return true;`) leaves all 235 tests green, but it is not equivalent. With Liked = `Track B` (the file's LAST chapter), Autoplay OFF, and ticks `1500, 1799.5, 1799.8, 1799.95`: unmutated `pauses 0` (the file reaches its natural `ended`, so the ended cascade and completion save run). Mutated `pauses 2`: paused 0.2 s short of the end, so the file never ends. The builder's reasoning covers only the case where a next row exists. Bind it with that shape.

3. SUGGESTION - R12 survives: dropping `if (checkData()) { render(); return true; }` in `onSelect` leaves every test green. This is W2's pop-out shape reached through the center button instead of a wheel step. The pop-out's Songs level is open, the main window saves chapters (no pop-out render), and the user presses Select, so `activate` runs on the stale rows. The guard is correct; only the wheel path (`moveCursor`) is bound. Add a Select-path variant of the "ONE seam" test.

4. SUGGESTION - the `menuPickGen` stand-down is not on "every arm" as the fix record says. Both repros are cosmetic: the queue is never touched and no wrong track plays.
   - (a) `renderHome` is unguarded. With a Home render in flight when a flat pick lands, the pick's `41` rows behind the skin are replaced by the Home shelves once Home lands (`rows 41 -> 0, home shelves 1`), while the Songs tab stays highlighted.
   - (b) The `catch` arm (`content.innerHTML = ''`, empty note shown) is unguarded. A superseded Songs render whose fetch fails after a pick wipes the pick's list (`41 -> 0`, empty note visible) while `rm1` plays.
   - Fix: guard `renderHome`'s write and the catch's clear with `stillMine()`.

**Verified clean (the named surfaces):**
- The chunked build is index-true, abandons on a newer pick, survives an autoplay append (N9) and completes.
- The new document listener is signal-scoped.
- The flat end asks `autoplayHoldsAt`, and a v1.320 retract keeps the queue flat.
- `content-visibility:auto` chunks stay in the DOM (queryable).

Verdict: CHANGES for new finding 1 only, a one-line fix verified above. Findings 2-4 are safe to ship as suggestions. A delta r3 needs only finding 1 plus its binding.

Tree: this section is my only write. Before it, `git status` showed only QA's uncommitted r2 section in this file. No untracked files.

Gate: CHANGES r2 @e76bc766 — adversary

## Gate r2 fix record (builder, after @e76bc766)

Commits: 0258d407 (both r2 sections, as-is) -> a088cbb4 (the fixes and their tests) -> this commit
(this record). No merge of main (the Architect holds it for Chapter Snap).

| Finding | Fix | Test (binding) | Mutant -> result (sandbox from a088cbb4) |
|---|---|---|---|
| **F1** adversary W1 (the end-of-list re-pause) | `flatQueue = null;` just before the pause in `enforceFlatSegmentEnd` (the adversary's verified one-liner): the list is done there, so a resume plays on as a plain listen | r1 "r2 F1": Autoplay off, Liked = `Track A` (mid-file), one pause at the segment end, then resume ticks 900.1 ... 901.35 through the old band: still one pause, no reload | F1 (the line dropped) RED 1 |
| adversary S2 (N13 is NOT equivalent) | the guard was right; the r1 record's "equivalent" claim is corrected in place | r1 "r2 S2": Autoplay off, Liked = `Track B` (the file's LAST chapter), ticks 1500 / 1799.5 / 1799.8 / 1799.95: 0 pauses (the file reaches its own ended) | N13 RED 1 |
| adversary S3 (R12) | (the guard existed) | r1 "r2 S3": the Songs level open, a library-changed event from another window, Select: the level re-loads (a second fetch), nothing plays, still on Songs | R12 RED 1 |
| adversary S4 (Home, the catch) | `renderHome(stillMine)` returns before its write, and the catch arm clears only `if (stillMine())` - the stand-down is now on EVERY arm | r1 "r2 S4a" (a Home render in flight, then a flat pick: no Home shelves, the pick's list stays); r1 "r2 S4b" (a browse Songs fetch that FAILS after the pick: the list stays, no empty note) | S4a RED 1, S4b RED 1 |
| qa S2 (the x4 record) | the r1 table row is corrected in place (33 long tasks of 50-184 ms over the whole fill, qa's measure). Chunks were NOT sized by a time budget: the per-chunk cost is the browser's layout of the new rows after the script returns, which a script-side clock cannot see, so a time budget would not bound it. Disclosed below | - | - |
| qa S3 (inert `has-sub`) | the class and its presence assertion are gone; the packing is `.ipm-list.ipm-2l`, which N15 binds (the Click-list assertion now checks for no `ipm-2l`) | unit "A20/A22 + K5" | N15 RED 1 |
| qa S4 (comment) | "the first chunk waits for the next animation frame (then a task)" | - | - |
| qa S1 | disclosed (below) | - | - |

Re-run around the touched seam, same sandbox: N18 RED 1, N10 RED 5, N11 RED 2, N14 RED 3,
N19 RED 1, N20 RED 1. **12 of 12 RED**, every diff non-empty (log `click-skin-menus-mutants-r2.log`,
runner `click-skin-menus-mutants-r2.js`, session scratchpad). The hook's full unit suite at
a088cbb4: 7206 / 7206. The pocket-menu suites (both integration files + the unit file): 64 / 64.

Disclosed (r2):
- **qa S1** - after a library change the OPEN level (the pop-out, or an in-tab level with no
  repaint) keeps SHOWING a dropped chapter row until the next wheel step, tap or Select. It can
  no longer PLAY it: every action re-loads the level first (R12 and N4 bind that). Fix shape, if
  wanted: re-render the shown level when `dataVersion` moves (the view's event handler poking the
  engines).
- **qa S2 residual** - the background browse build at phone-class CPU costs 50-184 ms per 20-row
  chunk (layout), for about 10 s behind Now Playing; the tap itself is small (68-178 ms at x4) and
  nothing freezes. Fix shape, if a device shows jank: window the browse song list instead of
  building every row.

