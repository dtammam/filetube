---
plan: sticker-sheet
harness: v2 · full
branch: feat/v1.388.0-sticker-sheet
anchor: spec
status: Planned
next: builder - Step 0, then measure today's menu (M0) before any edit
design: Dean's phone friction report + the Sonnet design review + two mockup rounds, 2026-10-12 (FileTube Root). Dean picked direction A, revised, and accepted all seven Root recommendations. Base = main 35bbccdf (v1.387.3).
builder: standard (one builder file, skin-surface.js, plus its CSS and tests; no data, no server)
gate: -
---

# v1.388.0: the sticker menu becomes a FileTube sheet, daily controls first

Norms: no em dashes; stage by name; `git commit -F <file>`; never pipe a commit or push; fnm Node 22.23.1 PATH before any
node/npm/git command; never `--no-verify`; never self-merge. A status report NEVER ends your turn.

Read first: AGENTS.md (the CSS / SPA traps, the UI ratchet, the overlay containment census); docs/LESSONS.md 0, 2, 3, 4, 6, 8;
the memory norm "measure UI changes: probe before / after; rows wrap, buttons never shrink"; the mockup Dean approved
(`docs/references/sticker-sheet-mockup.html`, open it in a browser at 390 wide: the "A, revised" column is the target, "Today"
is the before). The mockup predates R1-R7 (it still shows Home / Go to channel as rows): where it and section 3 disagree,
section 3 wins.

Seams (verified by the Root 2026-10-12; line numbers drift, search the names):
- public/js/skin-surface.js: `buildStickerMenuHtml` (~:2399-2540, page 1), `stickerToggleRow` / `stickerLinkRow` (~:2388-2398),
  `skinChipsHtml` (~:2541), `openStickerSkins` (~:2567, the Skin page), the menu mount (~:2586 `.mms-sticker-menu
  [data-skin-sticker-menu]`), the flag list (~:2606), `handleStickerClick` (~:2706), `buildExtrasHtml` (~:190-246, the Extras page;
  ALSO used by the desktop /music actions menu through cfg, which must stay as it is), `extrasEligible`, `homeAvailable`,
  `lightingHere`, `liveRate` / `liveLoop`, `MMS_SPEED_RATES`.
- public/js/music.js: the sticker cfg (isChapterTrack, watchBack, channel, radio, autoplay, shuffle, tray, chapters), the Like
  handler that targets the playing chapter (~:2643), the offline menu entry use (~:4431).
- public/js/music-skins.js: the registry (`line`, `gen`, `year`, `color`, `label`, ~:306-433), `SKIN_LINES` (~:447),
  `LIGHTING_STRENGTHS`, `shuffleGlyph`.
- public/js/offline.js: `menuEntry(kind, id)` / `runMenuAction` / `onChange` / `enabled` (in the iOS app only).
- public/css/style.css: `.mms-sticker-menu` and every `.mms-sm-*` rule (~:8568-8620, the height cap ~:8767).
- public/css/ui.css + public/js/ui.js: `ui.sheet` (bottom sheet + grab bar + `.ui-sheet__header`, ~:745-839), `.ui-list` /
  `.ui-row` / `--grouped` (~:292-420), `.ui-switch` (~:970), `ui.segmented` (ui.js ~:962, ui.css ~:1011), `.ui-chip--filter`
  (~:642). Reuse these classes and tokens; do not hand-roll look-alikes.
- tests: test/unit/music-sticker-menu.test.js (it pins today's markup and CSS strings; it will be rewritten, not deleted),
  pocket-lighting-open-ask, pocket-phone-scope, music-chapter-reflect, native-bridge-wheel, token-scale-lock; scripts/skin-chips-probe.js.

## Step 0 (builder)
- Work ONLY in `.claude/worktrees/feat-v1.388.0-sticker-sheet` (its node_modules is a hard-link copy; for a clean install
  `rm -rf node_modules && npm ci` there, never anything that touches the main checkout).
- Stop and ask Dean (AskUserQuestion) when: a tile or row in section 3 cannot be built as described; something would change
  outside the sticker menu (the desktop /music actions menu, Settings, the Click menus); the gate reaches round 3.
- Merges: when the gate is closed and the PR's required checks are green, SendMessage "FileTube Root" (it may be listed as
  "FileTube Server/Web Root Session") the PR number and sha; the Root merges.

## Rulings (Dean, 2026-10-12)
| # | Ruling |
|---|--------|
| 1 | Direction A: a FileTube bottom sheet ("Oh, that's much, much, much better"). |
| 2 | The top area holds Loop, Shuffle, Speed, Like (chapter), Chapters, Share or Download (both kept, as two tiles, plus More). |
| 3 | "Pronounced" is relabeled "Bold" (one-line segmented control). |
| 4 | "You can move lighting to the extras menu honestly" / "Same with autoplay" / "And radio": all three live in More. |
| 5 | Watch also moved to More (Root's call, told to Dean, not objected). |
| 6 | R1-R7 accepted as a set ("I actually love all of this"). R7's progress ring exists only in the iOS app (offline.js); the plain web keeps a browser download. |
| 7 | Not built: long-press on Like to like the whole track (undiscoverable; track like stays reachable elsewhere). |

## 1. Outcome (Dean, 2026-10-12, phone)
"The goal really is to get this design language in this sticker menu to match well with the rest of FileTube and also reduce
a lot of my daily friction with it."
1. Opening the sticker shows everything without scrolling, on a notched iPhone, with the 2x sticker, on a chaptered track.
2. Liking the playing chapter is ONE tap after opening the sticker (today it is the last row, under Extras, below the fold).
3. The menu looks and behaves like a FileTube sheet: grab bar, header, close button, FileTube rows, switches and controls.
4. The Skin picker is a short, grouped, searchable list where every name fits on one line (today: 131 chips, about 9 screens).
5. Lighting, Autoplay and Start radio stop taking room on the first screen (Dean: "move lighting to the extras menu", "same
   with autoplay", "and radio").

## 2. Measured today (the Sonnet review, 390x844, 2026-10-12)
Page 1 is 701px of content (about 790px with Watch + Chapters); with iPhone insets (47 / 34) the cap is 685px, so the last
rows (Extras) clip; with the 2x sticker the cap is 633px. Speed and Lighting are 117px each (two chip rows). The Skin page is
6595px. Probe caveat: the stock scripts/skin-chips-probe.js no longer reaches the pocket (html.is-phone needs `pointer:coarse`
and a short screen side <= 500): add `Emulation.setTouchEmulationEnabled` + `screenWidth/Height` (and make its wait-for timeout
fail loudly instead of a null error). Fixing the probe is in scope: it is the instrument for M0 / M1.

## 3. Design (direction A, revised, plus Dean-accepted recommendations R1-R7)

**D1 Container.** The sticker menu opens as a `ui.sheet`-style bottom sheet on a phone: grab bar, `--r-lg` top corners, a
scrim, `--surface-overlay`, dismiss by close button, scrim tap, Escape and drag-down (match whatever ui.sheet already supports;
do not invent a new gesture if ui.sheet has none, say so in the report). Header (`.ui-sheet__header` geometry): the playing
item's art (small, rounded), title (one line, ellipsis; the chapter name when a chapter plays) and a meta line, then on the right
**R4** two small icon buttons, Home and Go to channel (each only when today's row would render: `homeAvailable()`,
`stickerCfg.channel.visible()`), then the close button. Pages (Skin, More) keep the same sheet with a Back button in the header.
Keep the existing focus return on Back (#281).

**D2 Tile grid, 4 x 2, fixed order:** Like, Chapters, Loop, Shuffle / Speed, Share, Download, More. Tiles are `ui-btn`
tonal-style squares (icon, label, a one-line state caption), `--ctl` touch size or larger, buttons never shrink.
- **R1 fixed positions:** a tile that does not apply renders DISABLED in place (dimmed, `aria-disabled`), never removed or
  replaced: Chapters on a chapterless track, Like / Share / Download where today's Extras would not offer them (podcasts' caps,
  `extrasEligible()` false), Shuffle where the view supplies no hook.
- **Like (R2):** caption says what it will like: "chapter" when a chapter plays, else "track"; liked = filled heart in the
  accent and caption "Liked". Same handler as today's Extras Like (the playing chapter at open time).
- **Chapters:** opens today's chapter list (the existing Chapters row behavior); caption "N of M" when known.
- **Loop / Shuffle:** toggles (today's `data-skin-loop` / `data-skin-shufflemode` machinery and aria); caption On / Off; Loop's
  label stays "Loop" on the tile and the caption reads "Chapter" when `isChapterTrack()` and on, so the chapter-loop meaning
  (v1.279) is still said.
- **Speed:** shows the current rate as the tile's big glyph ("1×", "1.5×"); tap opens an inline strip directly under the grid
  with all 8 rates as `.ui-chip--filter` pills in one horizontally scrolling row, the current one selected; tapping a rate sets
  it and closes the strip; tapping the tile again closes it.
- **R3 off-default highlight:** Speed != 1, Loop on, Shuffle on render the tile in its selected state (`--fill-selected` +
  accent glyph/caption) so a leftover 1.5x is visible at a glance.
- **Share:** today's Extras Share action.
- **Download (R7):** in the iOS app (`FileTube.offline.enabled`), the tile is the offline save for the item (its parent id for a
  chapter row, as offline.js already does) driven by `menuEntry` / `runMenuAction`: caption "Save", then a progress ring and
  percent while downloading, "Saved" when done (tap removes, as the menus do today), the error copy on failure; it re-renders on
  `onChange` while the sheet is open. On the plain web it stays today's browser download link (caption blank). Say in the report
  which path ran in each measurement.
- **More:** opens the More page (D4).

**D3 Below the grid:** one grouped row, **Skin**, with **R5** a small swatch of the active skin (its body color from the
registry or the skin's CSS token; if no per-skin color is reachable without rendering, ask Dean before inventing one), the
active label (one line, ellipsis) and a chevron. That is all: Home and Channel are in the header, Autoplay / Lighting / Radio in
More. Target height: about 340px of sheet, 390px with the Speed strip open.

**D4 More page** (today's Extras, regrouped as `.ui-list--grouped` rows, not outlined buttons):
- group 1: Autoplay (`.ui-switch`), Start radio, Watch (when today's row would render).
- group 2: Lighting as ONE `ui.segmented` control, Off / Subtle / **Bold** / Ambient ("Pronounced" is relabeled "Bold" here
  AND in `LIGHTING_STRENGTHS` wherever the label is shown, Settings included; the stored value does not change), with today's note
  line under it; only when `lightingHere()` and not the tray.
- group 3: Add to queue, Play next, Mark watched (its configurable label), Transcript, Reheat.
- group 4: Fix chapter times, Add / Edit chapters, Move to folder.
- group 5: Delete, as a `--danger` row.
Every row keeps today's render gate (caps, canModify, hasSubtitles, hasWatchUrl, chapterSnapIndex). Pop-out-only rows (Tray,
pop-out Add/Edit chapters) go in group 1 / group 4 there.

**D5 Skin page:** search field on top (filters by label as you type); a "Recent" row of up to 4 skins as `.ui-chip--filter`
pills (the last skins picked on this device, localStorage in try/catch, the active one first); then groups by `SKIN_LINES`, each
a grouped list whose rows drop the line name (the group header says it): "5G White · 2005", "5G Transparent Coil · 2005"; the
active skin has a check. The tray keeps its inline Color chips exactly as today.

**D6 Skin tint (R6):** the sheet uses FileTube geometry, type and surfaces, but selected / active states (tile selected state,
switches on, segmented selection, the check, the liked heart) take the active skin's accent where the skin defines one, else
`--accent`. Through one custom property set on the sheet (e.g. `--sticker-accent`), not per-rule colors.

**D7 Surfaces:** one builder, both places the sticker opens: the phone pocket (html.is-phone, main document) and the desktop
pop-out (html.mms-popout). The pop-out has no Home / Channel / Extras today: its header omits those icons, its More page holds
only the rows it can run (Autoplay, Radio, Tray, Lighting, chapters). The desktop /music actions menu (buildExtrasHtml via cfg)
is NOT the sticker and must render exactly as today: prove it.

**D8 Retire the old idiom:** remove the `.mms-sm-opt` / `.mms-sm-chip` / outlined `.mms-sm-act` / small-caps `.mms-sm-h` /
On-Off text rules and the `revert` hacks that the new markup no longer uses. Every removed selector must have no remaining user
(grep). `npm run lint:ui` must not grow `docs/ui-exceptions.json`; the overlay containment census stays at zero (the sheet
scrolls: split clip from scroll).

## 4. Acceptance (each with the instrument that proves it)
- **M0 (before any edit):** the fixed probe on main at 390x844, insets 47/34, sticker 1x and 2x, on (a) a plain song, (b) a
  chaptered track with Watch + Chapters: record sheet height, scrollHeight, what is above the fold. **M1** the same on the branch:
  scrollHeight <= clientHeight (no scroll) in all four, Like tile visible without scrolling.
- Skin page: one line per row at 390 (measure each row's height = single-line height), total scroll height reported.
- Tile grid: all 8 tiles same size, none narrower than its 1x width at 320 wide (rows never squash a button).
- Behavior: every action still dispatches through its existing handler (a test per tile and per More row, driving a click and
  asserting the handler ran / the state flipped, mutated red once: break the dispatch, watch the test fail).
- R1: chapterless track renders 8 tiles with Chapters disabled (test). R2 caption chapter vs track (test). R3 selected state at
  1.5x / loop on (test). R7: with a stubbed offline API, Save -> progress -> Saved -> Save after remove (test); plain web keeps
  the `<a download>` (test).
- Lighting relabel: "Bold" everywhere it is shown, stored value unchanged (test reads a stored "pronounced" and selects Bold).
- Desktop /music actions menu output byte-identical to main (test or snapshot diff).
- Light and dark theme screenshots of the sheet, More and Skin pages at 390, sent to Dean with the PR (one comment with crops; no
  baseline shuffle, see AGENTS.md Ceremony).

## Waves (in order; targeted tests per wave, the full Node 22 suite once before the gate and once before the release commit)
- **W0 Instrument:** fix scripts/skin-chips-probe.js (touch emulation, screen size, loud timeout); M0 numbers on main into Evidence.
- **W1 Sheet + grid:** D1 container and header (R4), D2 tile grid (R1, R2, R3, Speed strip), D6 tint; tests per tile.
- **W2 More page:** D4 regroup with every render gate kept, Autoplay / Radio / Watch / Lighting moved, the Bold relabel; the
  desktop /music actions menu proven unchanged.
- **W3 Skin page:** D5 search, Recent, groups, one-line rows, R5 swatch on the Skin row; tray untouched.
- **W4 Download tile:** R7 with offline.js (app) and the `<a download>` (web).
- **W5 Pop-out + cleanup:** D7 pop-out path, D8 dead CSS removal, lint:ui / containment census, M1 measurements, light/dark crops.

## Out of scope (to ROADMAP Planned if wanted)
The Click (iPod screen) menus; the desktop /music actions menu; Settings beyond the Bold label; any new gesture ui.sheet lacks;
long-press Like; changing what any action does.

## 5. Gate
Adversary + QA per scrutiny.toml (UI, no data, no auth). Brief them with LESSONS 2, 3, 4, 6 and these attack surfaces: a tile
that renders but dispatches nothing (inert feature); a render gate lost in the regroup (Delete shown to a viewer who cannot
modify, Transcript without subtitles); the pop-out path; the desktop /music menu; the Like target after a chapter roll; the
offline tile's parent-id mapping; `[hidden]` vs author `display`; corner-clip on the scrolling sheet.

## 6. Release
v1.388.0 per docs/RELEASING.md. Ledger line (user language): the pocket player's sticker menu is now a sheet with your daily
controls up top: like the chapter, chapters, loop, shuffle, speed, share and download in one tap; the skin picker is grouped and
searchable; autoplay, lighting and radio moved to More. DEVICE-CHECKS: a new "Sticker sheet" block (phone: no scroll on a
chaptered track, one-tap chapter like, Speed strip, skin search; app: Download tile progress; desktop pop-out opens and works).
LESSONS: add a line only if the build finds a new bug class.

## Evidence (builder fills)
- M0 (main): 
- M1 (branch): 
- Skin page rows / scroll height: 
- Desktop /music menu identical: 
- Mutations (dispatch broken -> red): 
- Full suite runs (counts, verbatim): 
- Gate verdicts: 
- Device checks Dean owes: 
