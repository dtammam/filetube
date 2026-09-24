---
plan: click-skin-menus
harness: v2 · lean
branch: feat/click-skin-menus
anchor: spec
status: Built - awaiting the gate
next: gate r1 (adversary + qa). Owed after merge: Dean's device pass (phone Click + Seattle, the wheel feel on long lists, the pivot swipe), and his rulings on the disclosed gaps D1-D4.
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

(filled in after the commit - mutants run in a /tmp sandbox from `git archive` of the commit)

## Disclosed gaps

- **D1 (#257, needs Dean)** - "nothing playing opens on the Main Menu" has no production entry: the skin only mounts over a loaded track. The engine arm is built and unit-bound through the real create()/paint(); a user path to an empty pocket player is a new entry point (Dean's call).
- **D2 (#256)** - the menu position does not survive a dock + return (the view re-inits the engine). Docking through MENU happens AT the Main Menu, so the common path loses nothing.
- **D3 (#255)** - a genre queue has no list-context key (resume / grid-tab rebuild would see the whole library in title order).
- **D4 (#258)** - a thousands-long list is slow to cross by wheel alone (the shared cursor step is reused unchanged by design); touch-scroll is the fast path; no letter-jump overlay.
- **D5 (pre-existing #231)** - a chapter picked from an INTERLEAVED list (Songs, Genres, Liked - chapters of one file scattered by title) takes the v1.311 solo exit, which #231 documents as landing after the last same-base chapter. Album / artist lists keep chapters contiguous and are unaffected.
- **D6** - a grid-tab browse render already in flight when a menu pick lands can still paint its grid over the view behind the skin (its rows do not index the queue, so no wrong-track risk; the queue-indexed Songs/drill loads are guarded by the `loadSongsGen` bump, test-bound).
- **D7** - the headless run is the evidence for layout and speed; the wheel FEEL on a phone (the haptic ticks in menu mode, the 22-degree step on long lists) is Dean's device pass.

## Gate verdicts

(r1 pending)
