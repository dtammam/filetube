---
plan: pocket-quick-scroll
harness: v2 · lean
branch: feat/pocket-quick-scroll
anchor: spec
status: Gate r1 fixes built - awaiting gate r2
next: gate r2 (adversary + qa + security-brief: the recent-listening opt-in is a server change) on the head sha named in the hand-off; then Dean's device pass (#263)
design: "Approved 2026-09-24 (Dean's intake, recorded in memory wave-2026-09-24-intake)"
gate: pending
---

# Pocket menus: quick scroll, Recent Artists, Extras / Settings / About, the cover drift

Base: main @7402621c (= tag v1.323.0). Tech-debt ids: #263-#266 (and #258 closed).

## The ask

Dean, 2026-09-24 (his words): "I really like the brick view a lot in general, but you were right,
there's a lot of scrolling ... I don't want to go crazy. I like the feel." He chose BOTH of the
Architect's options (A and B). Two addenda arrived during the build (C+D together, then E).

- **A. Letter quick-scroll** (device-true: the iPod classic 5G+ and the Zune did this). A FAST
  wheel/pad spin on a long alphabetical list switches into letter mode: a big letter overlay
  (Click = the iPod's translucent dark square with a big white letter; Seattle = a big lowercase
  Zune letter), each detent jumps to the first row of the next/previous letter PRESENT ('#' first),
  a slow spin keeps moving one row, letter mode ends ~1 s after the spin stops, the highlight stays,
  one haptic tick per letter. Detect "fast" with the rotary engine's EXISTING speed signal. Touch:
  tapping the overlay (or a letter badge at the list's edge while scrolling by touch) opens an A-Z
  strip; a tap jumps; it closes on pick, MENU/Back or an outside tap; every target >= 44 px. The
  letter follows the list's own sort. It must work with the windowed 3,000+ song lists.
- **B. Recent Artists** - a new first entry in the Music menu, derived client-side from the Recently
  Played source (`filter=recent-listening`), unique by artist in recency order, up to 25; selecting
  one drills in exactly like Artists > artist; empty history = "No recent artists".
- **C. Extras > Games > Brick** (addendum, Dean: "maybe we add an about or a settings ... but also an
  option for the brick game while we're here"). Click: an "Extras" row between Music and Settings;
  Seattle: a Zune-style "games" entry. Launch the EXISTING game through its existing launch and
  teardown path (never a second launcher), keep its availability rule (main document only, only
  where the view supplies the hook; hidden - not inert - elsewhere). MENU/Back from the game returns
  to the Extras branch; the game's own exits keep working.
- **D. Settings > About** - the device's About screen with FileTube's facts: the skin's cheeky name
  as the title, Songs / Albums / Artists counts (per-user, visibility-gated), Version (the account
  menu's source), "FileTube" as the software line. Read-only. Settings = About only.
- **E. The cover drift** (addendum, Dean: "on that right pane in the Pocket Classic view where you
  see the album art, I think on real iPods the art gently moves from right to left ... we could
  emulate that with the photos ... in some of the views, like the main views that are not the album
  that you picked"). Click only: on the NON-item menu levels the right pane runs a slow slideshow of
  random library covers, each panning gently then crossfading; item levels keep the highlighted
  item's static art. Only the pane's own img layers animate, only transform + opacity; paused when
  it cannot be seen; reduced motion = a still cover; no art = today's pane.

## Decisions recorded (where the ask left one open)

| # | Decision | Why |
|---|---|---|
| A1 | **"Fast" = the engine's own x2 speed band** (`cursorStepMult(speed) >= 2`, speed > 0.8 deg/ms, about 2.2 turns a second), and letter mode arms only after **three such POINTERMOVES in a row inside one gesture** (`LETTER_FAST_MULT = 2`, `LETTER_ENGAGE_MOVES = 3`; the count resets at every pointerdown and on a slow move; at most one letter per move). The speed's time base is the LONGER of the handler gap and the events' own `timeStamp` gap (the event clock counted only on the performance.now origin). *(Amended at gate r1: the first build counted DETENTS - one big move armed it - and the count latched across gestures; a late handler made a medium turn read as a flick at CPU x4.)* | The v1.233 ladder was extracted into ONE named function (`cursorStepMult`) that both the row accelerator and the letter mode read - no second velocity estimator. 0.8 deg/ms is the line where the wheel already stops moving one row per detent. Device tuning owed: #263. |
| A2 | In letter mode **every** detent jumps a letter until the wheel has been still for 1 s. | The literal ask ("ends ~1 s after the spin stops"). A "slow detent exits" rule was rejected: a flick's decelerating tail would add a row past the letter's first row. |
| A3 | The letter is the row's **label** (= the value the level is sorted by), classified to follow the server's `cmpStr` (trimmed `localeCompare` at base sensitivity): digits/symbols '#', accents fold, the collation's non-decomposing Latin letters (Æ Ø Ł ß Œ Đ) fold to their base letter; **no "The " rule** (the server has none). The jump table is the list's own RUNS of one letter in list order. | "The same comparison the list already sorts by". Measured: the unit test sorts a crafted list with the real `cmpStr` and asserts the letters never step backwards. Non-Latin scripts sort after Z and show as a trailing '#' run (#264). |
| A4 | A level qualifies when the VIEW marks it alphabetical (`letters: true` on its payload) and it has **20+ rows** (`MENU_LETTER_MIN`). Marked: Artists, Albums, Songs, Genres, Genre > songs, Liked Songs (all `title-asc`), an artist's All Songs / an artist's album only when the user's artist sort is Title A-Z or Z-A (`menuSortIsAlpha`). Never: Recently Added / Recently Played (recency order), an album (album order), the static levels, Now Playing. | The view knows the sort it asked the server for; the controller never guesses. An artist's All Songs is release-date order by default - a letter overlay there would jump "M" then "C". |
| A5 | The touch **A-Z strip is a 7-column grid** (Seattle: 5 columns of big type) over the menu screen, 44 px rows. | 27 targets at 44 px in one column is 1,188 px - it cannot fit a 227 px LCD. The grid fits with no scroll at both measured sizes (cells 49x44 at 390x844, 48x44 at 380x700 - see Measurements). |
| A6 | The haptic: one tick per letter; **at most one per pointermove** (two letters inside one move tick once). Sweep engine: the switch's phase moves to the middle of the next half-period of the SHARED `sweepOffset` sine. | WebKit reads one midline crossing per touchmove; a second flip in the same move would cancel the first. No hand copy of the sweep math (the v1.303 scar). |
| B1 | Click: **"Recent Artists" is the first Music row**. Seattle: its own pivot, **"recent", placed LAST** so the pivots still lead with artists and "recent" sits one pad-press left of artists (they wrap). | The Zune's pivots were single lowercase words and led with artists; a drill row inside the artists pivot would break that list's letter runs and index math. |
| B2 | The artist key is the Artists level's own grouping rule (`albumArtist \|\| artist`, server `groupArtists`); the row is `{node: {type: 'artist', key, label}}` - byte-identical to an Artists row. | "Drills into that artist exactly like Artists > artist" (bound by comparing both drills on real data). |
| C1 | Click Main Menu = **Music, Extras, Settings, Shuffle Songs, Now Playing** (the iPod classic order); Extras > **Games** > **Brick**. Seattle = Music, **Games** > Brick, Settings, ... | Device order. |
| C2 | The entry exists only when **Brick's own `visible()`** says yes AND the engine handed the hook over (**main document only**). So Seattle's Games entry is **hidden today** (Brick's rule is the Click wheel trio, #207). | "Keep its existing availability rule" - the rule includes WHEEL_SKINS. Lifting Brick to Seattle is Dean's call (#265). |
| C3 | MENU from the game lands on the **Games** list (the level Brick was chosen from). | The iPod rule "MENU backs out one level"; the menu stack underneath the game never moved. |
| D1 | About: status bar "About"; a heading with the cheeky name ("Click" / "Seattle"); rows Songs, Albums, Artists (the `total` of `limit=1` reads of the SAME visibility-gated routes the levels read), Version (`appVersionString()`, the account menu's source - the server-stamped meta), Software = FileTube. **Settings holds About only** - Shuffle/Repeat/Autoplay stay where they live. | No new route; per-user counts by construction. |
| E1 | Non-item levels: **Main, Music, Playlists, Genres, Extras, Games, Settings, About** (`menuIsItemLevel`, one list in the pure half). Covers: one per album from the whole-library song rows the server marks `hasArt`, through the view's one art rule, **same-origin paths only**. | "Reuse the art URLs the menus already use"; `/albumart/:id` / `/thumbnail/:id` are the app's only art size (the grid's own). |
| E2 | 9 s per cover (CSS drift 11 s, so it never stops moving while shown), a 1.2 s crossfade; the NEXT cover is appended to the pane invisible right after the fade and swaps only once loaded (a slow network keeps the current one). Stopped (timers + layers dropped) on: an item level, Now Playing, the tray, a hidden document (`visibilitychange`), a panel that is no longer the skin (checked at each tick - the dock path), destroy. **Reduced motion: one still cover, no timer.** | Dean's "cheap and safe" rule; the ambient-mode lesson. |

## Re-verified survey (every anchor re-read at 7402621c before editing)

| Anchor | At 7402621c | Verdict |
|---|---|---|
| The rotary cursor branch + speed ladder | skin-surface.js:1906 `var mult = speed > 2.4 ? 4 : ...` inside `onDown`'s `st.onMove`; `WHEEL_STEP_DEG = 22` :914 | the ONE speed signal; extracted to `cursorStepMult` (both consumers read it) |
| The menu's cursor entry | skin-surface.js:860 `moveCursor: function (delta)` | gains `(delta, fast)` and returns letters crossed |
| The haptic path | `hapticOnMove` :1738, `hapticPlaceSweep` :1727 (routes through `FileTubeWheelConfig.sweepOffset`) | a `lettered` arm rides without per-detent ticks; `hapticLetterTick` ticks per letter via the same sweep function |
| The pocket controller | `createPocketMenu` :525; `applyArt` :724; `followCurrent` (K1) :802; `onScroll` :816 | extended in place (letters, picker, badge, About, Brick row, drift) |
| Brick's launch + teardown | the sticker row :1074 (`inMainDoc && stickerCfg.brick && ... visible`), the tap :1222-1224 (`stickerCfg.brick.onTap()`); `releaseWheelTakeover` :1316; `setWheelTakeover` :2003; music.js `brick: {visible, onTap}` :1185, `brickWiring` :1199 (`FileTubeBrick.wire({getEngine})`); ipod-brick.js `WHEEL_SKINS` :284 | the menu row calls the SAME `stickerCfg.brick.onTap` under the SAME `inMainDoc` gate - no second launcher |
| The menu tree | music-skins.js `MUSIC_MENU` :299, `SEATTLE_PIVOTS` :303, `ROOT_TITLE` :315, `menuStaticItems` :324, `menuArtistItems` :340, `renderMenuView` :461 | the one list each (no copies) |
| The view's data | music.js `menuLoad` :3390; `menuAllSongs` :3362 (`sort=title-asc&limit=10000`); Recently Played `filter=recent-listening&limit=200` :3434; `invalidateMenuData` :3355; `dataVersion` :1146 | Recent Artists reads the SAME recent-listening route; About the same list routes |
| The server's sort / gate | lib/music/query.js `cmpStr` :14 (trim + `localeCompare(base)`, empty last, no "The " rule); routes.js `/api/music` `trackVisibleTo` + projection `mediaVisibleTo`, recent-listening sorted by progress `updatedAt` | the letter rule mirrors cmpStr; Recent Artists inherits the gate |
| The version source | common.js `appVersionString` :6083 (reads `<meta name="ft-version">`, stamped by server.js) | reused |
| Shell parity | no new script; `ipod-brick.js` already rides every shell that loads the engine (ipod-brick.test.js SHELL PARITY) | no shell change |

## Acceptance criteria

- **AC1 (A, reachability)** A fast flick of the REAL wheel engine (real pointer events, the engine's own speed band) on a long alphabetical list engages letter mode; a slow turn never does and moves one row per detent; a single fast detent alone never does.
- **AC2 (A, landing)** Each letter-mode detent lands on the FIRST row of the next/previous letter present (absent letters skipped), re-windowed and re-centred on 3,000+ rows; Select plays that row's real id.
- **AC3 (A, clear axes)** Letter mode (on a populated overlay) clears 1 s after the wheel stops (the highlight stays), on MENU, Select, a level change; a queue advance in letter mode never moves the parked highlight (K1).
- **AC4 (A, touch)** A finger scroll shows the edge badge (and it fades); a controller-written scroll does not; the badge or the overlay opens the A-Z picker; a letter jumps and closes it; MENU / Select / an outside tap / a wheel turn close it; every picker target >= 44 px at 390x844 and 380x700; no leaked listener over 20 cycles; no new global non-passive touch listener.
- **AC5 (A, haptics)** Letter mode ticks once per letter crossed (ghost and sweep engines), never per 3.75 degrees.
- **AC6 (B)** Recent Artists from real plays (including songs played to their END - gate r1 Q6): recency order, duplicates collapsed, at most 25, drills identical to Artists > artist, restricted items never listed, empty = "No recent artists".
- **AC7 (C)** Extras > Games > Brick launches the existing game through the view's hook; MENU lands on Games; every teardown arm (MENU, repaint, skin switch, dock + return, view destroy, engine destroy) ends it; hidden in the pop-out, without the hook, and where Brick's rule says no.
- **AC8 (D)** About shows the cheeky name, the per-user totals, the running version, "FileTube"; read-only.
- **AC9 (E)** The drift runs on non-item levels with a populated pane and never on item levels; preloads before its fade; at most two layers; stops on hidden / Now Playing / dock / item level / every teardown arm with zero timers left; reduced motion = still; the CSS animates only transform + opacity.
- **AC10** Census tools green (lint:css 0, overlay-containment 0, eslint 0 errors); no shell change; every new menu id reaches every sibling list (the static items, `TYPE_TITLE`, `NON_ITEM_LEVELS`, `emptyTextFor`, `menuLoad`, the stale sweep).

## Build record

Files:
- `public/js/music-skins.js` (the pure half): `MUSIC_MENU` leads with `recentArtists`; `SEATTLE_PIVOTS` ends with it
  ("Recent"); `TYPE_TITLE` names the five new levels; `menuStaticItems` builds the device Main Menu (`opts.hasGames`,
  `opts.style`), `extras` / `games` / `settings`; `NON_ITEM_LEVELS` + `menuIsItemLevel` (E); builders
  `menuRecentArtistItems` (B), `menuAboutItems` (D), `menuCoverPool` (E); the letter half `menuLetterOf`,
  `menuLetterRuns`, `menuLetterAt`, `menuLetterJump`, `menuLetterTargets`, `menuLetterable` (20+ rows, view-marked),
  `menuSortIsAlpha`; `renderMenuList` draws read-only INFO rows (no option, no bar, a value); `renderMenuView`
  wraps Click's list in `.ipm-lpane` (the About heading sits above it) and appends the jump layers
  (`renderMenuJump`: the overlay + badge buttons with `data-skin-letters`, the picker grid with
  `data-skin-letter="<row>"`, absent letters `disabled`).
- `public/js/skin-surface.js` (the controller + engine): `cursorStepMult` (the v1.233 ladder, now named) +
  `LETTER_FAST_MULT`; the cursor branch passes `fast` into `pocket.moveCursor(delta, fast)`, which returns the
  letters crossed; `hapticOnMove(..., lettered)` rides without per-detent ticks in letter mode and
  `hapticLetterTick` ticks once per move that crossed a letter (ghost: one flip under the 8 ms floor; sweep: the
  shared `sweepOffset` phase moved half a period). `createPocketMenu`: letter mode (`lm`, the 1 s hold), the badge
  (a finger scroll = a scroll offset the controller did not write, `expectTop`), the picker (`openGrid` /
  `closeGrid` / `pickLetter`), `clearJump` on every arm that leaves the list (MENU, Select, a tap, a level change,
  a pivot, Now Playing, a stale reload, a style reset, destroy), `applyJump` re-draws only the layers;
  `onPanelClick` (picker taps; MENU/Select with the picker open only close it); About's heading; the `brick`
  action through the engine-handed `games` hook (`menuGames = inMainDoc && stickerCfg.brick`); the cover drift
  (`slide` state, `syncSlides` / `startSlides` / `preloadNext` / `swapSlide` / `stopSlides`, a `visibilitychange`
  listener bound in `bind()` and removed in `destroy()`); Click's `render()` patches the screen IN PLACE around its
  art pane (the drift's layers survive a re-render); the off-menu arm cancels a pending art timer.
- `public/js/music.js`: `menu.coverPool` (E) = `SKINS.menuCoverPool(menuAllSongs())`; `menuSongLevel` sets
  `letters` from the level's own sort; Artists / Albums / Genres payloads carry `letters: true`;
  `menuLoad('recentArtists')` reads `filter=recent-listening&limit=200` (the Recently Played route);
  `menuLoad('about')` = three `limit=1` totals + `window.appVersionString()`.
- `public/css/style.css`: `--fs-jump` / `--fs-jump-xl` type tokens and the `--mms-*-jump-*` palette defs; the
  overlay / badge / picker / About rules for Click and Seattle (inside the `max-width:768px` skin block); the drift
  layers (`.ipm-slide`, `.is-on`, `.is-drift`: transform + opacity only) and their reduced-motion arm.
- `docs/exec-plans/tech-debt-tracker.md`: #258 CLOSED; #263-#266 filed (Disclosed gaps).
- Tests: NEW `test/unit/pocket-quick-scroll.test.js` (33 - 28 at 13026e47, +5 at 9b78af13 for the mutant survivors: the pure half, the controller through the REAL engine on
  a fake surface clock, haptics ghost + sweep, listener balance, 3,008 songs, Brick through the real
  `ipod-brick.js` wiring, About, the drift incl. a comment-stripped CSS lock); NEW
  `test/integration/pocket-quick-scroll.test.js` (6 - +1 at 9b78af13, the drift's real pool in the real view: real server + real music.js - Recent Artists from real
  progress saves, a restricted member, letter mode on the real Songs level, About with the real totals and the
  server-stamped version, Brick in the real view). Updated for the intended menu change:
  `music-pocket-menus.test.js` (row taps by LABEL, not index - a row added above never shifts a label),
  `music-pocket-menus.test.js` / `-r1.test.js` (integration: the Main Menu and pivot lists), `music-skins.test.js`
  (the v1.233 accel lock binds BOTH ends of the extracted ladder - `var mult = cursorStepMult(speed)` in the
  handler AND the ladder's literal in `cursorStepMult` - not a widened pattern).

## Measurements

Probe: `pocket-quick-scroll-probe.js` (session scratchpad) - boots this tree's server on a scratch DATA_DIR with a
3,008-song projected library (150 artists x 4 albums x 5 songs over 24 letters - no Q, no X - plus 8 digit-titled
songs, a real PNG cover per item, four real progress saves for Recently Played), drives headless Chromium over
CDP (mobile emulation, DPR 2). Log `pocket-quick-scroll-probe.log`, 98 PNGs in `pocket-quick-scroll-shots/`
(session scratchpad). Every state line printed `errs:[]` (0 page errors). CPU x1, swiftshader: upper bounds.

| What | Printed (390x844 / 380x700) |
|---|---|
| Main Menu, Click (5 rows incl. Extras + Settings) | rows 34 px, list 173x227 / 168x220, `fits:true` (scrollHeight = clientHeight: no scroll), `docW` 390 / 380 |
| Main Menu, Seattle (4 rows: Games hidden by Brick's rule) | rows 60 px, list 316x602, `fits:true` |
| Letter mode by a REAL paced flick (6 detents, 11.5 deg every 8 ms) | on every skin and size: overlay on, letter `E` (detent 1 = the x2 row step inside '#', detents 2-6 = A..E), cursor on row 508 = the first E row, 23 rows in the DOM, long tasks `[]`, flick 101-112 ms |
| The A-Z picker | Click: 7x4 grid 346x227 / 336x220, smallest cell **49x44 / 48x44**, `gridFits:true`; Seattle: 5 columns 340x606 / 330x462, smallest cell **68x56 / 66x56**; the badge 44x44 |
| Picker jumps A -> M -> Z (tap to 2nd frame) | A 46-107 ms (the first jump), M 21-33 ms, Z 21-32 ms; landed rows 8 / 1508 / 2883 = the first row of each letter; 20-27 rows in the DOM; **long tasks `[]` on every jump, every skin, both sizes** |
| Touch badge | after a finger scroll: `badgeOn:true`, the top row's letter |
| Recent Artists (4 plays, 3 artists) | Click: `Umbra Coast 20, Amber Arrival 1, Bloom Lights 2` (recency order, duplicate collapsed); Seattle's "recent" pivot one pad-press left of artists: the same rows |
| Extras > Games > Brick (Click trio) | `Extras -> [Games] -> [Brick]`, Select mounts the game (`game:true`), MENU ends it and lands on `Games` (`game:false`) |
| About | Click / Seattle: heading `Click` / `Seattle`; `Songs 3,008 · Albums 601 · Artists 151 · Version 1.323.0 · Software FileTube` |
| Cover drift, 3 frames 3 s apart (Click trio) | e.g. ipod 390x844: the showing layer's transform `matrix(1.0856,...,5.64,0)` -> `(1.1065,...,0.82,0)` -> a new cover crossfading (opacity 0.47); ipod-matte 380x700: tx 4.34 -> 0.20 -> -3.97 px, scale 1.091 -> 1.109 -> 1.128 (right to left, slowly zooming); **2 layers max**; the art pane stayed 173x227 / 168x220 and the list box never moved (`listBox` identical in every frame) |
| Desktop pop-out (plain window, 380x509 inner) | Click: Main Menu `Music, Settings, Shuffle Songs, Now Playing` - **no Extras** (main-document gate), the drift running (2 layers); Settings > About renders; Seattle: no drift (no pane) |

## Mutant table

Runner: `pocket-quick-scroll-mutants.js` (session scratchpad). Each mutant runs in a sandbox extracted from
`git archive <sha>` (never the live tree; `node_modules` symlinked), its anchor is asserted to occur EXACTLY once,
the file is compared before/after (every row: a non-empty diff), the named test files run, the file is restored.
Pass 1 at **13026e47** (Q1-Q42, log `pocket-quick-scroll-mutants.log`): 36 RED, 6 SURVIVED. Each survivor got a
test that drives the case its guard exists for (9b78af13); pass 2 at **9b78af13** (the six + three re-runs of the
pocket menus' own guards through the changed seams, log `pocket-quick-scroll-mutants-r2.log`): 9 of 9 RED.
**Final: 45 of 45 RED.** Fails = failing tests across the named files.

| # | Mutant | Result |
|---|---|---|
| Q1 | letter mode never engages | RED (8) |
| Q2 | one fast detent engages it | RED (2) |
| Q3 | any speed counts as fast (a slow turn engages) | RED (2) |
| Q4 | the fast band raised to x3 (the flick never engages) | RED (8) |
| Q5 | letter steps ignore direction | RED (1) |
| Q6 | a letter step moves one ROW (not the next letter) | RED (5) |
| Q7 | the 1 s hold never ends letter mode | RED (1) |
| Q8 | MENU keeps letter mode | RED (1) |
| Q9 | a drill-in (activate) keeps letter mode | survived at 13026e47; **RED (1) at 9b78af13** against its new test |
| Q10 | the letter flag ignored (any long list) | RED (2) |
| Q11 | no length floor | RED (2) |
| Q12 | the badge shows on the controller's own scroll | RED (1) |
| Q13 | the badge never fades | RED (1) |
| Q14 | MENU with the picker open climbs (both guards dropped) | RED (2) |
| Q15 | an outside tap never closes the picker | RED (1) |
| Q16 | a picked letter never moves the highlight | RED (2) |
| Q17 | letter mode keeps the per-3.75-degree ticks | RED (2) |
| Q18 | no tick per letter | RED (2) |
| Q19 | the sweep letter tick is a plain +detent (no half-period snap) | survived at 13026e47; **RED (1) at 9b78af13** against its new test |
| Q20 | the Brick row ignores the main-document gate | RED (1) |
| Q21 | the Brick row ignores Brick's own visible() | RED (1) |
| Q22 | Brick is never launched | RED (3) |
| Q23 | About rows render as tappable options | RED (3) |
| Q24 | About heading = the product name | RED (2) |
| Q25 | About never gets the version | RED (1) |
| Q26 | Recent Artists keeps duplicates | RED (2) |
| Q27 | Recent Artists reads Recently Added | RED (1) |
| Q28 | Recent Artists keys on the track artist | RED (1) |
| Q29 | Recent Artists uncapped | RED (1) |
| Q30 | the drift runs on item levels too | RED (2) |
| Q31 | the drift swaps before the next cover loaded | RED (1) |
| Q32 | visibilitychange never bound | RED (2) |
| Q33 | visibilitychange never unbound | RED (1) |
| Q34 | a hidden document keeps drifting | survived at 13026e47; **RED (1) at 9b78af13** against its new test |
| Q35 | reduced motion still drifts | RED (1) |
| Q36 | stopSlides leaves its timers | RED (3) |
| Q37 | the pool is not origin-filtered | RED (1) |
| Q38 | a repaint drops the letter overlay | RED (3) |
| Q39 | a pending art timer survives the menu leaving the screen | RED (1) |
| Q40 | the Click screen is re-created on every render (no in-place patch) | survived at 13026e47; **RED (1) at 9b78af13** against its new test |
| Q41 | the pool fetch is never made | survived at 13026e47; **RED (1) at 9b78af13** against its new test |
| Q42 | a stale reload keeps letter mode | survived at 13026e47; **RED (1) at 9b78af13** against its new test |
| Q43 | re-run of the menus' M3: the cursor branch never reaches the menu | RED (18) |
| Q44 | re-run of the menus' N1: the K1 yank restored | RED (3) |
| Q45 | the v1.233 accel ladder bypassed in the cursor branch (x1 always) | RED (12) |

## Disclosed gaps

- **G1 (#263, device)** - the letter-mode threshold (the x2 band, three fast moves) and the per-letter tick are measured
  headless; a real thumb flick is Dean's device pass. The tick is one per pointermove at most (WebKit reads one
  midline crossing per move).
- **G2 (#264)** - titles in non-Latin scripts sort after Z and show as a trailing '#' run; the picker's '#' goes to
  the leading run.
- **G3 (#265, for Dean)** - Seattle's Games entry is built but hidden: it routes through Brick's own rule (Click
  trio only, #207). Lifting Brick to Seattle is a product call.
- **G4 (#266)** - About's `limit=1` totals still build each list server-side; the Click drift's first Main Menu
  open pays the whole-library song fetch in the background on a big library; the drift restarts with a fresh cover
  after it was stopped (no mid-pan resume).
- **G5** - letter mode stays in letter mode for 1 s after the wheel stops even if the user then turns slowly (the
  literal ask; decision A2). A "slow detent exits" rule is a one-line change if Dean's device pass wants it.
- **G7** - a `paint()` (a track change, a chapter roll, an autoplay append) rebuilds the whole panel, so the cover
  drift restarts with a fresh cover there; between paints, moving across the menu levels keeps the same drifting
  layer (the Click screen is patched in place - Q40 binds it).
- **G6** - the A-Z picker's "outside tap" is any tap on the skin panel outside the picker (the panel is the whole
  full-screen skin; no document listener was added - listener balance bound).

## Instruments at the hand-off (builder, verbatim counts)

- The hook's full unit suite: 7276 / 7276 at 13026e47, 7281 / 7281 at 9b78af13 (`ℹ fail 0`).
- Targeted: the two new files + music-pocket-menus unit/integration/-r1 + music-skins + skin-surface + ipod-brick +
  music-skin-integration + type-scale-tokens + tech-debt/exec-plans census: `# pass 248 # fail 0` before the
  bindings; the two new files after them: `# pass 39 # fail 0`.
- Census: `npm run lint:css` TOTAL 0; `overlay-containment-lint --enforce` clean (0); eslint 0 errors (the 6
  pre-existing common.js warnings); the census set (comment-count, comment-debt, css-token-lint, docs-link,
  docs-status, era-player-skins, exec-plans, mobile-input-zoom x2, overlay-containment, setup-music-skin-picker,
  shell-script-global-collisions, shell-singleton, skin-scrollbar-hidden, tech-debt, token-scale-lock,
  touch-eating-overlay-audit, type-scale-tokens) `# pass 146 # fail 0` after the two `--fs-jump*` tokens;
  `.harness/lib/check-markers.sh` clean. No `public/*.html` change (no shell-parity change).

## Gate verdicts

(r1: CHANGES from both seats, below; the fix record follows them)

## Gate r1 - qa (@bd90e80e)

Instruments (run by qa on a `git archive bd90e80e` sandbox, node 22.23.1, verbatim):
- New + updated targeted files (pocket-quick-scroll unit + integration, music-pocket-menus unit + integration + -r1, music-skins): `# tests 147 # pass 147 # fail 0`.
- Census set (comment-count, comment-debt, css-token-lint, docs-link, docs-status, exec-plans, overlay-containment, shell-script-global-collisions, shell-singleton, tech-debt, token-scale-lock, touch-eating-overlay-audit, type-scale-tokens, ipod-brick, skin-surface): `# tests 213 # pass 211 # fail 2` in the sandbox - both fails are comment-debt `EISDIR` from the sandbox's node_modules symlink; re-run in the git-backed worktree: `# tests 5 # pass 5 # fail 0`. Skin set (era-player-skins, era-scrollbar-css, mobile-input-zoom x2, setup-music-skin-picker, skin-scrollbar-hidden, music-skin-integration): `# tests 163 # pass 163 # fail 0`.
- `npm run test:unit`: `# tests 7281 # pass 7273 # fail 8`. All 8 are sandbox artifacts (6 x `git ls-files ... fatal: not a git repository`, 2 x the EISDIR above); the 7 owning files re-run in the worktree: `# tests 69 # pass 69 # fail 0`. Net: 7281 / 7281, matching the builder.
- `npm run lint:css`: `TOTAL 0`. `overlay-containment-lint --enforce`: `clean (0 violations)`. eslint on the 9 changed js files: 0 errors, 0 warnings. `.harness/lib/check-markers.sh`: `clean`.
- Re-probe (headless Chromium, the builder's probe re-run on the sandbox + two qa probes): every builder measurement at 390x844 reproduced (Main Menu rows, Extras > Games > Brick mount + MENU lands on Games, About `3,008 / 601 / 151 / 1.323.0 / FileTube` with `Click` / `Seattle` headings, Recent Artists order, letter mode `E` on row 508, picker 49x44 / 68x56, jumps A/M/Z to rows 8/1508/2883 with long tasks `[]`, drift 2 layers with a crossfade, pop-out with no Extras). A SLOW wheel turn never shows the badge (Chromium, 4 sizes x 2 skins, `seen:false`); a finger scroll does. Reduced motion: one still cover, no `is-drift`, the same src over 10 s. The cursorStepMult extraction is the v1.233 ladder verbatim (`speed > 2.4 ? 4 : (speed > 1.5 ? 3 : (speed > 0.8 ? 2 : 1))`), same call site, same `setWheelCursor(... sign * mult)` - no change to row acceleration.

Findings:

1. **WARNING - one pointermove can arm letter mode; the "two detents" guard counts DETENTS, not moves** (public/js/skin-surface.js:1145, the claim at :1241 "(one noisy pointermove cannot)", plan A1 "Two detents because one pointermove's speed is noisy"). The engine's while-loop calls `moveCursor(sign*mult, fast)` once per 22 degrees with the SAME per-move `fast`, so a single move of 44+ degrees at > 0.8 deg/ms is two fast detents. Verified (qa scratch test on the real engine, 3,008-row Songs): ONE pointermove of 50 degrees after 16 ms -> `letterMode:true`, cursor 0 -> 121 (letter A); ONE move of 90 degrees (a finger crossing near the hub - there is no centre dead zone) -> two letters, cursor 0 -> 363 (C), and a deliberate SLOW detent inside the 1 s hold then jumps a whole letter (363 -> 484) where 7402621c moved 16 rows total for that move. Fix: count fast MOVES (e.g. the engine passes a per-move serial, or the controller only increments `fastRun` once per move) and bind it with a single large move; correct the comment and A1.

2. **WARNING - Recent Artists omits every artist whose song played to the END** (public/js/music.js:3424 reads `filter=recent-listening`; lib/music/routes.js:219 keeps only `position > 0`; public/js/player.js:5585 `saveProgressToServer(0)` on `ended`). A completed play is written as position 0, so it leaves the source. Verified on the real server: a track saved at 190 s then ended (0) is absent from `recent-listening` (`has800:false`) while four mid-song saves are present. Scenario: play a whole album by X to the end, then 20 s of a Y song -> Recent Artists lists Y only; a user who only finishes songs sees one artist (the one in progress) or "No recent artists". The integration test (test/integration/pocket-quick-scroll.test.js:81) models every play as a mid-song save (`timestamp: 30`), so AC6 "from real plays" is bound on a shape the real player rarely leaves. Pre-existing in the v1.323 Recently Played playlist (same source), newly inherited. Close by EITHER a source that remembers completed plays (a server change - Dean's call) OR disclosure: a tracker row + a G entry + AC6 reworded ("artists of songs with a saved position"), and a test that drives the ended-then-0 shape.

3. **WARNING - the letter overlay and the badge never FADE; they vanish in one frame** (public/js/skin-surface.js:689 `applyJump` removes and re-creates the layers on every change; comments at skin-surface.js:660 "the overlay fades", music-skins.js:614 "faded by a class", style.css:11960; AC4 "(and it fades)"). A class flip on a freshly parsed node has no before-change style, so the `opacity var(--dur-slow)` + delayed-visibility transition is dead CSS. Measured in Chromium at 40 ms sampling, both skins, reduced motion on AND off: overlay opacity `975:1 -> 1015:0`, badge `977:1 -> 1020:0` - no intermediate value. Device fidelity: the iPod's letter square fades out. Fix: keep the overlay/badge nodes and toggle `is-on` + the text in place (re-create only the grid), then bind a fade (an intermediate opacity, or the node identity surviving the hold's end).

4. **WARNING - the A-Z picker loses its TOP rows, unreachably, when the LCD is shorter than the grid** (public/css/style.css:11970 `align-content:center; overflow-y:auto`, inherited by Seattle's 5-column 56 px grid). Centered overflow puts the first rows above the scroll origin, where no scroll reaches. Measured: Seattle at 667x375 (iPhone SE landscape) grid 617x137, content 236, first row at -100 px - `#`, A-D cannot be tapped and E-I are clipped; same at 640x360 (-107 px). Click would do the same on any LCD under 176 px. Fix: `align-content: safe center` (both skins), bound by a short-LCD probe/test.

5. **SUGGESTION - picker cells are 39 px wide at 320x568 (Click)** (7 columns in a 276 px grid; the last row also overflows by 1 px). AC4 claims 44 px only at 390x844 / 380x700, so this is outside the claim - disclose the floor width (or drop to 6 columns under ~310 px).

6. **SUGGESTION - the drift freezes after a library change while it runs** (public/js/skin-surface.js:605 nulls `slide.pool` without stopping the drift; :986 returns early while `slide.on`). After the next swap `pickCover()` finds an empty pool, `swapSlide` sets `due` and re-arms nothing, and syncSlides never re-fetches because the drift is "already on" - one cover sits still until the level/screen changes. Reasoned from the code, not driven. Fix: stop (or bump `poolReq` and restart) when the pool is invalidated under a running drift.

7. **SUGGESTION - stale assertion message** test/integration/music-pocket-menus.test.js:89 still says "moved the highlight two rows" after the edit made it three detents.

8. **SUGGESTION - a Recent Artists pane is not refreshed by new plays while its level stays on the stack** (plays do not bump `dataVersion`): Seattle's "recent" pivot, once loaded, stays stale across songs played from the other pivots until the Music level is left. Same as the existing Recently Played level; worth one line in the disclosed gaps.

Security (standing section): no new route, no server change, no shell/eval/temp-file surface. Every new rendered string is escaped (`esc` on Recent Artists labels through renderMenuList, About labels/values, the About heading, the jump letter; `data-skin-letter` is `Number()`; letters come from a fixed set). About's counts are the `total` of the existing routes computed AFTER `trackVisibleTo` + the gated projection, per user - no new count exposure; the version is the account menu's existing source. Recent Artists reads the per-user progress map through the same gate (restricted-member test present, `{kind:'folder'}`). Cover pool: same-origin paths only; the URLs are server-built (`/thumbnail/<id>`, `/albumart/<id>`), so the `'/\host'` spelling that passes the prefix check is not attacker-reachable (hardening only).

Tracker: #258 closed with a pointer to this plan and #263; #263-#266 well-formed (the 259-262 gap is the parallel fix/snap-offset-and-status-bar branch's allocation - no collision). Standards: every new className has a rule; no em dashes in added lines; the loading levels reuse the skeleton path.

Verdict: CHANGES - four WARNINGs. 1, 3, 4 are small code fixes; 2 needs Dean's call or an honest disclosure (and a test on the ended shape).

Gate: CHANGES r1 @bd90e80e — qa

## Gate r1 - adversary (@bd90e80e)

Instruments (adversary, `git archive bd90e80e` / `git archive 7402621c` sandboxes in /tmp, node 22.23.1, verbatim):
- Targeted (both new files, music-pocket-menus unit + integration + -r1, music-skins, skin-surface, ipod-brick): `# tests 246 # pass 246 # fail 0`. Neighbours (27 files: era-player-skins, menu-returns-to-origin, music-skin-integration, music-sticker-*, type-scale-tokens, wheel-config, every podcasts file): `# tests 397 # pass 397 # fail 0`.
- `lint:css` TOTAL 0; `lint:overlay` clean (0); `eslint .` 0 errors, 6 warnings (the pre-existing common.js six). Docs census set in the sandbox: `# tests 37 # pass 35 # fail 2` (both comment-debt EISDIR, the sandbox's node_modules symlink); comment-debt re-run in the worktree: `# tests 5 # pass 5 # fail 0`.
- The cursorStepMult extraction: one seeded 240-move, 12-gesture wheel stream on a 3,008-row NON-letter list, base vs head: cursor traces byte-identical (verified).
- About as a RESTRICTED member (folder restriction, real server): `Songs=40 Albums=2 Artists=2` vs admin `60/3/3` (verified). A real MENU-dock from the drifting Main Menu (Chromium): panel emptied, 0 slide layers, 0 cover requests in 25 s (verified). A track skip on the drifting Main Menu: 2-4 blank art frames at head vs 1-3 at base (pre-existing, not a finding).
- Trusted CDP mouse events on the real wheel (finger angle from wall time, Songs 3,008 rows), CPU x1: 0.1 / 0.3 / 0.6 deg/ms never engage (0 of 10 at 0.6); 1.0 / 1.5 engage and land on first rows (M 1508, Z 2883, reverse Z -> D 383).
- Mutants (my own, 32, sandbox copy, one anchor each, diff non-empty, restored): RED X9 X14 X16 X17 X18 X20 X29 X33; SURVIVED listed in finding 5 and S-list.

Findings:

1. **WARNING - the "fast" signal is inflated by main-thread jitter: at CPU x4 a MEDIUM turn engages letter mode** (skin-surface.js `var now = nowMs(); var dt = Math.max(1, now - st.lastT)` - dt is HANDLER time, not the event's). Measured (trusted CDP events, 0.6 deg/ms, below the 0.8 band): CPU x4 **6 of 10 gestures engaged** (rows 0 -> 883, 0 -> 633), CPU x1 0 of 10. The trace shows why: one move of 13.8 deg had handler dt 14.8 ms but event dt 22 ms (0.93 vs the true 0.63 deg/ms). Pre-existing estimator (v1.233), but its consequence grew from "2 rows instead of 1" to "jump hundreds of rows". Prescription VERIFIED in a sandbox: dt from `ev.timeStamp` (plus finding 2's reset) -> 0 of 10 at x4 at 0.6, while 1.2 / 1.5 deg/ms flicks still engage; the gesture reset ALONE still engaged 6 of 10 (not sufficient). Note the unit harness fakes `performance.now`, so the tests must drive `timeStamp`. Same guard as qa #1 (one move = two detents): fix both together.

2. **WARNING - `fastRun` latches ACROSS gestures and time** (skin-surface.js moveCursor: nothing resets `lm.fastRun` at a gesture's start or end; the crown-jewel "never latch"). Repro (real engine, jsdom): one fast detent (cursor 0 -> 2), lift, 60 s later one fast detent -> `letterMode:true`, cursor 2 -> 121 (A). AC1 "a single fast detent alone never does" fails for two isolated ones. Prescription VERIFIED: reset `fastRun` at pointerdown when not in letter mode -> the same stream ends at cursor 4, no letter mode.

3. **WARNING - the cover drift keeps running BEHIND a menu-launched Brick** (slidesWanted() knows nothing of the wheel takeover; Games is a non-item level; the game's canvas only covers the LCD). jsdom: after Select on Brick, `slides:true`, 2 timers, and a swap (c3 on) 9 s later with the game running. Chromium: `.ip-menuview` stays `display:flex` under the canvas; the cover swapped (s1224 -> s1824) and its transform was mid-drift during the game; 1 cover request in 20 s. Plan E "paused when it cannot be seen" / E2's stop arms miss this one. Fix: slidesWanted() false while a takeover is live, syncSlides() on its release; bind it.

4. **WARNING - the FIRST cover often snaps in with no fade and no drift** (swapSlide: a cached cover's `load` lands between frames, and the single rAF adds `is-on` / `is-drift` before the node's first style resolution, so neither transition runs). Chromium, fresh Main Menu opens: **3 of 12** had the first cover at the END state on first sample (`opacity 1`, `matrix(1.14,0,0,1.14,-6.92,0)`) and still there 700 ms later. The builder's own log shows it too: ipod-black 390x844 drift frames 0/1/2 identical. Prescription tested: `void incoming.offsetWidth` before the class flip -> 0 of 6 snapped (trial 0 sat at the START state, a warm-up frame). Same class as qa #3 (a class flip on a fresh node never transitions). jsdom cannot see this - bind it with a Chromium probe or a style-flush source lock.

5. **WARNING - claimed behaviours with no binding (mutants that SURVIVE all six named files, 147 tests):** X5 / X6 / X7 delete `letters: true` from Artists / Albums / Genres (the INERT SIBLING class: only the Songs level is bound in the real view); X8 `letters: SKINS.menuSortIsAlpha(sort)` -> `letters: true` (album order, Recently Added and Recently Played become letter-jumpable - decision A4's "Never" axis is unbound); X1 a slow detent no longer resets `fastRun`; X27 a Seattle pivot switch no longer clears letter mode (artists -> albums would carry the overlay onto a list you did not flick - the pivot sibling of the Q9 drill-in binding); X36 the fast band 0.8 -> 0.5 deg/ms (A1's threshold value is unbound; tests only use 0.09 and 1.44). Each needs a test that drives the real case.

Suggestions (non-blocking):
- S1 letter classification: a sweep of U+00A1-U+024F, U+1E00-1EFF, fullwidth, circled and Roman-numeral letters against the real `cmpStr` found **261** code points filed '#' where the server sorts them inside a letter - fullwidth `Ａ-Ｚ ａ-ｚ` (real in Japanese releases: "ＡＫＩＲＡ" opens a '#' run mid-A), `Ǽ Ǿ ẞ Ð ð Ħ Ŧ Ŋ Ĳ Ǆ`, `Ⓐ`, `Ⅻ`. Not covered by G2 (non-Latin scripts). Fix: NFKD, then fold (Ǽ -> Æ -> A), and add the missing non-decomposing letters. X35 (the lowercase æ ø ł œ đ fold) is also unbound.
- S2 with the picker open, a tap on Play or `>>|` closes it AND plays/pauses or skips (pp 1, nx 1); MENU/Select only close it. Pick one rule and bind it (X13 survived either way).
- S3 the cover pool's "same-origin only" filter passes `'/\evil.example/a.jpg'`, which resolves to `https://evil.example/a.jpg` (verified with `new URL`). Suspicion only: today's art URLs are server-built from ids. Compare `new URL(u, location.origin).origin` instead.
- S4 when EVERY cover errors, the pane stays blank (`slide.on` blocks applyArt) on Main and Music until a repaint (jsdom: `html:""`, `slides:true`); after a repaint with a cached pool, one dead cover blanks it for 30 s+. Fall back to today's pane when the pool empties.
- S5 the pool is the first 60 albums in TITLE order, not a random sample: every cover the builder's probe showed was an s-id divisible by 24 (the "Amber" titles). Shuffle or stride before the cap. Recent Artists reads a 200-track window (199 plays of one artist + 1 = 2 artists), on top of qa #2.
- S6 unbound or dead guards: X25 (skin-switch clearJump), X26 (showNowPlaying clearJump - render's off-menu arm already clears), X2 (the non-letter `fastRun = 0`, never non-zero there), X11 / X12 (Brick re-check, the info guard), X10 (pool kept after a library change), X19 (a letter step that did not move still ticks), X31 (picker re-centre), X3 / X4 / X15 (badge), X22 / X23 / X34 (the dock guards: the fixture stops via `isConnected`; the real dock was measured fine). Bind or delete. Stale message: music-pocket-menus integration "moved the highlight two rows" after three detents.

Verdict: CHANGES - five WARNINGs. 1 + 2 share one fix (event-time dt, a per-gesture reset, plus qa #1's per-move count); 3 and 4 are small; 5 is tests.

Gate: CHANGES r1 @bd90e80e — adversary

## Gate r1 fix record (builder, after @bd90e80e)

Commits: c4eeb34e (both r1 sections, as-is) -> 8ee1405a (merge main 8be20941: ROADMAP only, clean) ->
**bc236430** (the fixes and their tests) -> **881bd16d** (a builder-found flake in the new clock: the event
clock now counts only on the performance.now origin; the picker CSS lock) -> this commit (the R11 binding + this
record).

**SERVER CHANGE (for the security-brief seat):** `GET /api/music?filter=recent-listening` takes an opt-in
`include=finished` (lib/music/routes.js). Without it the output is byte-for-byte today's (bound: the default route
still omits a finished song - R14 RED). With it, a progress row at position 0 with an `updatedAt` also stays. The
filter runs on the list AFTER `trackVisibleTo` + the gated projection, unchanged (bound: a folder-restricted member
never gets the finished song under the opt-in). No new route, no new write, no new field.

| Finding | Fix (commit) | Test (binding) | Mutant -> result |
|---|---|---|---|
| **Q1** qa W1 + adversary W1 + W2 (one guard) | letter mode counts fast POINTERMOVES (`noteMove`, three in a row, reset at every pointerdown and on a slow move), one letter per move (`moveJumped`), speed from the longer of the handler / event-timestamp gaps (bc236430); the event clock only on the performance.now origin (881bd16d) | unit r1 Q1: one 50-deg / 16 ms move does not engage; one 90-deg move jumps one letter; a 0.6 deg/ms turn with halved handler gaps does not engage (control: the true 1.2 does); two fast moves / lift / 60 s / two more does not engage | R1, R2, R3, R4 RED |
| **Q2** qa W3 + adversary W4 | the overlay and the badge are persistent nodes toggled in place (born OFF, style read once); `void incoming.offsetWidth` before a cover's classes turn on (bc236430) | unit r1 Q2 (node identity across letter steps and the hold's end, badge likewise); a source lock on the one swap | R8, R9 RED |
| **Q3** qa W4 + S5 | `align-content: safe center` (Seattle inherits); six Click columns under 340 px (bc236430) | unit CSS lock (881bd16d) + the probe below | R16, R17 RED |
| **Q4** adversary W3 | `slidesWanted()` is false while a wheel takeover is live; `setWheelTakeover` and the engine's release both re-sync the drift (bc236430) | unit r1 Q4 (Brick from Extras: 0 layers / 0 timers for 20 s, resumes after MENU); unit "a GENERIC takeover" (this commit) | R10, R12 RED; R11 see below |
| **Q5** adversary W5 | (tests) | integration r1 Q5: Artists / Albums / Genres letter-jumpable on the REAL payloads (24 more fixture artists); the never rule on the REAL payloads (a 20-song album, Recently Added, 22-row Recently Played); unit X1 (slow move resets), X36 (0.65 deg/ms never engages, one row per detent), X27 (a Seattle pivot switch ends letter mode) | R5, R6, R7, R26, R27, R28, R29 RED |
| **Q6** qa W2 (the Architect's ruling) | **Outcome: the signal EXISTS.** Every progress row keeps `{position, duration, updatedAt}`; the player's `ended` arm writes position 0 to that same row (player.js `saveProgressToServer(0)`, the C2 reset), so a finished play is a position-0 row with a fresh `updatedAt`. The existing route gains the opt-in `include=finished`; the pocket menus' ONE recent source (`MENU_RECENT_URL`) - Recent Artists AND the Recently Played playlist - uses it (bc236430). AC6 keeps its claim | integration r1 Q6 (the ended shape 60 -> 190 -> 0 on the real route: the default omits it, the opt-in leads with it, Recent Artists and Recently Played lead with it in the real view, the gate holds; the player's ended arm + writer body pinned by source) + the probe's REAL 3 s WAV played to its end in Chromium | R13, R14, R15 RED |
| adversary S1 | NFKD first, then a fold table GENERATED by sweeping U+00A1-024F, U+1E00-1EFF, fullwidth, circled and Roman forms through `cmpStr` | unit: 0 mismatches over 803 code points (was 261 filed '#', plus 53 misfiled by my first fold) | R24, R25 RED |
| adversary S2 | ANY tap while the picker is open only closes it | unit (Play / Next do nothing; control after) | R18 RED |
| adversary S3 | a cover path = one '/' then neither '/' nor '\\' | unit | R19 RED |
| adversary S4 | every cover failing -> today's pane | unit | R20 RED |
| adversary S5 | the pool is a random sample (partial Fisher-Yates) across the whole album list | unit (a seeded draw reaches beyond the first 60) | R21 RED |
| qa S6 | the pool carries the library version it was fetched for; a swap re-fetches a stale pool (the drift keeps going) - the freeze's cause (`slide.pool = null` under a running drift) removed | unit | R22 RED |
| qa S7 | the stale "two rows" message | - | - |
| qa S8 | a "recent" list OFF screen is marked stale at each new current track (re-loads when shown); the one on screen keeps its rows | unit (Seattle's recent pivot) | R23 RED |
| adversary S6 (unbound or dead guards) | not all taken: X2 (the non-letter reset) is now the `noteMove` early reset, bound by R4/R5 indirectly; X25/X26/X10/X11/X12/X19/X31/X3/X4/X15/X22/X23/X34 unchanged - disclosed as unbound or dead below (G8) | - | - |

**Mutant table at 881bd16d** (runner `pocket-quick-scroll-mutants.js`, sandbox from `git archive 881bd16d`,
anchors unique, diffs non-empty; log `pocket-quick-scroll-mutants-r1fix.log`): the 29 r1 guards plus 8 first-pass
guards re-run through the changed seams. **36 of 37 RED at 881bd16d; R11 RED against this commit's test.**

| # | Mutant | Result |
|---|---|---|
| R1 | Q1: two letters in one move (the per-move cap dropped) | RED (1) |
| R2 | Q1: the fast count latches across gestures (no reset at pointerdown) | RED (1) |
| R3 | Q1: the event clock ignored (handler time only) | RED (1) |
| R4 | Q1: one fast move engages | RED (5) |
| R5 | Q5/X1: a slow move no longer resets the count | RED (1) |
| R6 | Q5/X36: the fast band at 0.5 deg/ms | RED (2) |
| R7 | Q5/X27: a pivot switch keeps letter mode | RED (1) |
| R8 | Q2: the layers re-created on every change (no persistence) | RED (1) |
| R9 | Q2: no style read before the first cover turns on | RED (1) |
| R10 | Q4: the drift ignores a live takeover | RED (1) |
| R11 | Q4: the release never resumes the drift | survived at 881bd16d (the MENU path also resumes through the Brick wiring's own `setWheelTakeover(null)`); **RED at the plan commit** against its new test (a GENERIC takeover) - see below |
| R12 | Q4: setting a takeover never pauses the drift | RED (1) |
| R13 | Q6: the server ignores include=finished | RED (1) |
| R14 | Q6: the DEFAULT route returns finished plays too | RED (1) |
| R15 | Q6: the menus read the plain route | RED (1) |
| R16 | Q3: the picker centres unsafely | RED (1) |
| R17 | Q3/S5: seven Click columns at 320 px | RED (1) |
| R18 | S2: the closing tap also acts on Play/Next | RED (1) |
| R19 | S3: a backslash path passes the cover filter | RED (1) |
| R20 | S4: every cover failing leaves a blank pane | RED (1) |
| R21 | S5: the pool = the first 60 (no shuffle) | RED (1) |
| R22 | S6: a library change never re-fetches the covers | RED (1) |
| R23 | S8: a recent list off screen never re-loads after a new listen | RED (1) |
| R24 | S1: the cmpStr fold table dropped | RED (2) |
| R25 | S1: no NFKD (compatibility forms) | RED (2) |
| R26 | Q5/X5: Artists not marked alphabetical | RED (1) |
| R27 | Q5/X6: Albums not marked alphabetical | RED (1) |
| R28 | Q5/X7: Genres not marked alphabetical | RED (1) |
| R29 | Q5/X8: every song level marked alphabetical (album order, Recently Added, Recently Played) | RED (1) |
| Q1r | letter mode never engages | RED (17) |
| Q3r | any speed counts as fast | RED (7) |
| Q7r | the 1 s hold never ends letter mode | RED (2) |
| Q13r | the badge never fades | RED (2) |
| Q18r | no tick per letter | RED (3) |
| Q31r | the drift swaps before the next cover loaded | RED (1) |
| Q34r | a hidden document keeps drifting | RED (1) |
| Q42r | a stale reload keeps letter mode | RED (1) |

**Re-probe** (`pocket-quick-scroll-probe-r1.js`, logs `pocket-quick-scroll-probe-r1-first.log`,
`pocket-quick-scroll-probe-r1.log`, `pocket-quick-scroll-probe-r1-medium.log`; PNGs `pocket-quick-scroll-shots-r1/`;
TRUSTED CDP mouse input on the real wheel, the achieved rate measured from the page's own pointermove timeStamps):

| What | Printed |
|---|---|
| Medium turn, CPU x1 | 0.58-0.60 deg/ms: engaged **0 of 5**, cursor 10 (one row per detent); 0.71-0.72: 0 of 5, cursor 13 |
| Medium turn, CPU x4 | 0.60-0.65 deg/ms: engaged **0 of 5** (the adversary measured 6 of 10 at bd90e80e); 0.74-0.78: 0 of 5 |
| Real flick | CPU x1 1.39-1.42 deg/ms: **3 of 3** (letters L / L / J); CPU x4 1.06-1.13: **3 of 3** (N / L / N) |
| The overlay's fade (30 ms samples after the wheel stops) | Click: 8 intermediate opacities (was 0), Seattle: 7 |
| The first cover, 6 fresh opens, two samples 600 ms apart | 6 of 6 moved (e.g. `translateX 6.92 -> 6.17`, opacity `0 -> 0.80`); none at the end state |
| The drift under Brick | before 2 layers; during the game 0 (and 0 ten seconds in); after MENU 2 layers, title `Games` |
| The picker | 390x844 Click 49x44 cells, Seattle 68x56; **667x375** Seattle grid 617x137, content 336, first row at the scroll origin (0), last reachable (was -100 px); **640x360** Seattle first row 0, last reachable; Click at both 85-89 x 44, fits; **320x568** Click 46x44 (6 columns, was 39 px), Seattle 54x56; `docW` = the viewport everywhere |
| A REAL 3 s WAV played to its end (Click) | the route with `include=finished`: `Finisher:0`; the plain route: `[]`; Recent Artists `[Finisher]`; Recently Played `[Played To The End]` |

Instruments: the hook's full unit suite at bc236430 **7297 / 7297** and at 881bd16d **7298 / 7298**; the touched
suites (both new files, music-pocket-menus unit/integration/-r1, music-skins, skin-surface, ipod-brick,
music-skin-integration, music-library-projection, rbac-music-enforcement, menu-returns-to-origin) `pass 298
fail 0` before the last edits; lint:css TOTAL 0; overlay-containment clean; eslint 0 errors (6 pre-existing).

Disclosed (r1):
- **G8** - adversary S6's remaining unbound or dead guards (X25 skin-switch clearJump, X26 showNowPlaying clearJump,
  X10, X11/X12 Brick re-check and info guard, X19 a no-move letter step still ticks, X31 picker re-centre, X3/X4/X15
  badge details, X22/X23/X34 dock guards) are left as they are: each is either redundant with a bound arm or
  cosmetic; not re-mutated this round.
- **G9** - a finished CHAPTERED file (a chapter album played to its end) is listed by its FIRST chapter in the
  Recently Played playlist (the position-0 row maps to the chapter containing 0); its artist in Recent Artists is
  right.
- **G10** - the new wheel clock rule changes the v1.233 row acceleration only where the handler ran late (the
  longer gap wins): at CPU x1 the trusted-input traces read the same band.

