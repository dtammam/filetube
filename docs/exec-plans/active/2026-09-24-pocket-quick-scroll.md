---
plan: pocket-quick-scroll
harness: v2 · lean
branch: feat/pocket-quick-scroll
anchor: spec
status: Built - awaiting gate r1
next: gate r1 (adversary + qa) on the head sha named in the hand-off; then Dean's device pass (the letter-mode threshold and tick, #263)
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
| A1 | **"Fast" = the engine's own x2 speed band** (`cursorStepMult(speed) >= 2`, speed > 0.8 deg/ms, about 2.2 turns a second), and letter mode arms only after **two such detents in a row** (`LETTER_FAST_MULT = 2`, `LETTER_ENGAGE_STEPS = 2`). | The v1.233 ladder was extracted into ONE named function (`cursorStepMult`) that both the row accelerator and the letter mode read - no second velocity estimator. 0.8 deg/ms is the line where the wheel already stops moving one row per detent. Two detents because one pointermove's speed is noisy (dt is clamped to 1 ms). Device tuning owed: #263. |
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
- **AC6 (B)** Recent Artists from real plays: recency order, duplicates collapsed, at most 25, drills identical to Artists > artist, restricted items never listed, empty = "No recent artists".
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

- **G1 (#263, device)** - the letter-mode threshold (the x2 band, two detents) and the per-letter tick are measured
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

(r1 pending)
