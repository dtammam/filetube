---
plan: pocket-design-system
harness: v2 · lean
branch: feat/pocket-design-system
anchor: spec
status: Shipped v1.332.0
next: the release steps (docs/RELEASING.md + AGENTS.md): plan-complete, release branch, merge --no-ff, tag v1.332.0, PR, CI, merge.
design: "Approved 2026-09-25 (Dean's intake in the v1.331 session: D1-D6 below, every answer his)"
gate: APPROVED r2 @bbb40ab9 (adversary, qa)
---

# The pocket design system: Seattle out, one token system for the Click skins, Click (Red) and six more colorways, and Home from the player

## The ask

Dean, 2026-09-25 (his words): "Let's remove Seattle entirely. I don't use it, don't want the
headaches can we focus on the pocket design system ... We do it and finish the same swing by making
a pocket classic Red skin (like project red)." The design system is the ROADMAP item from
2026-09-24: a long album title wrapped the Click Black status bar to two lines (v1.324, fixed
per incident in v1.325); Dean: "not having a proper token or just design system for the pocket
skin, which at this point is getting pretty advanced and is being pretty heavily relied upon".
Follow-up ask: "What iconic color or version am I missing we can plan it to be w new ones with this
design system" - planned below as future colorways (NOT built this swing).

## Intake (Dean's answers, 2026-09-25; all final)

| ID | Decision | Dean's answer |
|---|---|---|
| D1 | A device with Seattle saved (`ft-music-skin` = `zune-classic`, a SERVER-SYNCED pref, lib/prefs-allowlist.js) | switches to **Click** (`ipod`), not the app default (Cider) |
| D2 | The Red look | **Red body, white wheel** - the (PRODUCT)RED iPod. The real device (reference below) has a RED center button (body color), like White and Black whose centers match their bodies; build to the photo |
| D3 | Design-system depth | **Full system**: every pocket surface reads shared tokens (status bar, rows, type scale, split screen, controls, colors), ONE overflow rule, a colorway is ONE token block, lock tests |
| D4 | Release shape | **One release**, v1.332.0, one gate (adversary + qa) |
| D5 | More iconic colorways | **Silver** (the 2007 iPod classic aluminum), **Black + red wheel** (the U2 Special Edition look - a cheeky name, never the band's), **Mini pastels** (the iPod mini's blue, green, pink, gold). Nano rainbow declined. **D8 (Dean, same day): "I want the other skins built now too not just roadmap" - all of them ship in v1.332.0** |
| D6 | Seattle's pocket-menu pieces | removed entirely with it (pivots, swipe, pad-moves-pivot, Games row, two-line lists, the Metro screen) |
| D8 | The D5 colorways | **Built this swing**: `ipod-silver` "Click (Silver)", `ipod-encore` "Click (Encore)" (black body, red wheel; the cheeky name, never the band's), `ipod-blue` "Click (Blue)", `ipod-green` "Click (Green)", `ipod-pink` "Click (Pink)", `ipod-gold` "Click (Gold)" (ids and labels are the builder's to adjust if a clash appears; keep the Click (X) pattern). Each is ONE role-token block from a real photo (references below) |
| D7 | A fast way from the player to FileTube's home page (Dean: "Right now I must press menu many times then the FileTube icon") | **BOTH: a Home row at the top of the corner sticker's menu** (every skin, two taps from any screen or menu depth) **and press-and-hold MENU** on the Click wheel. Either one docks the player (the song keeps playing in the mini-player) and navigates to the app's home page |

Dean's standing run rules apply: ONE plan (this), ONE builder, ONE gate at the end (adversary is
the floor; add qa - this touches the player engine and a synced pref), max two rounds, one
release, warnings ship disclosed in ROADMAP + tracker (next free id #280).

## Research (verified against source at e45906fb)

**Seattle's footprint** (grep `zune-classic|seattle|Seattle|pivot|znc-|zn-`):
- `public/js/music-skins.js`: `IDS` (:33), the registry entry (:254), `renderZuneClassic`, `SEATTLE_PIVOTS`,
  `menuPivots`, `ROOT_TITLE.seattle`, the Games row (:340), every `style === 'seattle'` branch in
  `renderMenuList` / `renderMenuView` (:641-694), comments.
- `public/js/skin-surface.js`: pivots in the menu controller (`makeLevel` pivots, `switchPivot`,
  `isPivotLevel`, `onPivotTap`, the pad-left/right pivot move :1227-1232, the hold-scan skip :2330),
  the panel swipe (`onSwipeDown/Up/Cancel`, `MENU_SWIPE_PX`, bind :1853-1857, unbind :2474-2476,
  `menuSwipe = null` :2488), the `[data-skin-pivot]` tap (:1912), comments (:510, :641, :1322, :1337,
  :2030-2042 the Zune pad scrub note, :2656).
- `public/js/common.js:9952` the `[data-skin-swipe]` swipe-back owner (+ comment :9945).
- `public/js/setup.js:535` the Settings picker blurb.
- `public/js/ipod-brick.js:284`, `public/js/pocket-lighting.js:12`, `public/js/music.js:1210,1257` comments.
- `public/css/style.css`: the `--mms-zn-*` / `--mms-znc-*` tokens (:11553-11558, :11605-11608),
  the whole SEATTLE CLASSIC block (~:12181-12281), the `:not(.mms-zune-classic)` in the 340 px media
  query (:12272).
- Scripts: `scripts/skin-status-bar-probe.js` (default skin list :32, Seattle's drilled-title
  measurement), `scripts/pocket-lighting-probe.js`.
- Tests naming Seattle (16 files): unit music-skins, music-pocket-menus, pocket-quick-scroll,
  pocket-lighting, music-skin-integration, skin-status-bar, token-scale-lock, swipe-back-owners,
  prefs-store, ipod-brick, podcast-nowplaying-view, listen-video-chapters; integration
  music-pocket-menus, music-pocket-menus-r1, pocket-quick-scroll, prefs-api.
- **The fallback trap (D1):** `normalizeSkinId` maps any unknown id to `DEFAULT_ID = 'apple'` (Cider).
  Dropping `zune-classic` from `IDS` alone would move Seattle users to Cider, not Click. A legacy
  map (`zune-classic` -> `ipod`) is required, and the stored value should be rewritten once so the
  server-synced pref converges (the pref sync would otherwise keep re-serving `zune-classic`).

**Hand-kept Click lists (the INERT SIBLING class - Red must reach every one, or derive them):**
`music-skins.js` `IDS`; `setup.js` `MUSIC_SKIN_BLURB`; `ipod-brick.js:284` `WHEEL_SKINS`;
`skin-surface.js:1475` the pop-out tray's chip filter and `:2658` the Nano tray's colorway
getter (both `ipod|ipod-black|ipod-matte` literals); scripts' default skin lists; the tests that
enumerate the trio (music-skin-integration :1876 expects exactly three tray chips). Derive every
runtime list from the registry (`menus === 'click'`), never a literal.

**The pocket stylesheet today** (`public/css/style.css`, one `@layer`-less block ~:11545-12305):
- Colors ARE tokens, but per colorway with ad-hoc names (`--mms-ipod-*` white, `--mms-ipodk-*`
  black, `--mms-ipodm-*` matte, `--mms-litk-*` / `--mms-litm-*` lighting bands), and every
  colorway REPEATS whole rules to swap them: `.mms-ipod-black{background}`, `.ip-wheel`, `.ip-zone`,
  `.ip-center`, and again under `.mms-lit` and `.mms-lit-strong` (6 colorway-specific rule copies
  per colorway). A fourth colorway today = ~10 copied rules.
- Sizes and type are raw or scattered: the menu row pitch `34px` (token-exempt, twice), battery
  22x11, glyph boxes 25 / 14 px, the letter square 96, the 44 px targets, the wheel
  `min(70vw,288px)`, the center `min(26vw,108px)`, the cover 44 %, the split 50 %, the Nano tray's
  88 px art; type uses global `--fs-*` picked per rule.
- Overflow is per incident: ellipsis is hand-copied onto `.ip-np`, `.ip-ttl`, `.ip-artist`,
  `.ip-album`, `.mms-rt`, `.ipm-lbl`, `.ipm-about-name` and again on the tray's `.ip-ttl` /
  `.ip-artist` / `.ip-album`; `.ipm-noterow .ipm-lbl` deliberately wraps.
- Source locks read this CSS (the v1.232 locks regex the FIRST base-scoped lcd/listview rules -
  see the tray comment at :11740); `npm run lint:css` (token census, ceiling ZERO) and
  `node scripts/overlay-containment-lint.js --enforce` govern it.
- Instruments that exist: `scripts/css-equivalence-diff.js` (the zero-delta prover for token
  passes - check how it treats custom properties defined on a CLASS scope, not `:root`, before
  relying on it; pixel screenshots are the backstop), `scripts/skin-status-bar-probe.js`
  (headless Chromium over CDP, reaches every level through the real menus, 120-char names, PNGs),
  `scripts/pocket-lighting-probe.js`, Playwright chromium in `~/.cache/ms-playwright`.

**The Red reference (D2):** Wikimedia Commons "File:Product Red iPod nano.jpg" (a 2G iPod nano
(PRODUCT)RED, front-on, flat-lit on black; CC BY 2.0; do NOT commit the image - cite it). Fetch:
`https://upload.wikimedia.org/wikipedia/commons/thumb/3/3a/Product_Red_iPod_nano.jpg/960px-Product_Red_iPod_nano.jpg`
(send a User-Agent). Pixel samples (960x1687 thumb, medians of 20x10 boxes):
- Body, centre column top -> bottom: `#fa352f` (y150), `#fd3849` (y650), `#fd3b53` (y750),
  `#ea293c` (y1360), `#e11e2e` (y1420), `#d7162b` (y1480), `#c91320` (y1540), `#bc121b` (y1590).
  Across at y650: left edge `#d02221`, mid-left `#d7141a`, mid-right `#fd5063`, right edge
  `#bb1e39` (a satin anodized sheen, brightest right of centre). The photo is bright; the centre
  column is the specular band - build the ramp from the mid/low values and let the sheen tokens
  carry the highlight, then judge SIDE BY SIDE against the photo (the match-reference norm).
- Wheel: near-white `#ffffff` / `#fefefe` top-right, `#ebf1ef` left, `#f3f5f0` upper-left
  (a cool white). Labels (darkest 10 % of the glyphs): MENU `#d2dbda`, prev `#b8c3bf`,
  play `#cbd0d4` - light cool grey, lower contrast than the White Click's `#7c7d80`.
- Centre button: `#ff5061` top, `#fd465c` mid, `#fe3d50` bottom (the body red, domed).
- The screen is the shared white LCD (unchanged, as for every colorway).
- Other Commons photos for a cross-check: "File:Apple iPod nano 3G Product Red-2007-09-08.jpg"
  (CC BY-SA 2.0, an iPod classic-shaped 3G nano, its screen shows the 6G split menu),
  "File:Apple iPod nano 2G Product Red-2007-07-15.jpg" (CC BY 2.0).

**The D8 references** (Wikimedia Commons; cite, never commit the images; fetch the 960 px thumbs
through the API `action=query&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=960` with a User-Agent).
READ THIS FIRST: most of these photos are underexposed and several are under warm light. Neutralize
each photo against its WHEEL (plastic of a known near-neutral light grey) - per-channel gain to
neutral, THEN scale exposure so the wheel reads like the White Click's wheel - and only then take the
body / label values. The numbers below are white-balanced but NOT exposure-normalized (the builder's
first job per colorway), medians of boxes, p15/p50/p85 for bodies:
- **Silver** - "File:IPod Classic 6th Generation 120 GB - front.jpg" (CC BY 3.0; front-on, even light,
  the best of the set). Body p15/p50/p85 `#585759` / `#8c8c92` / `#c3c2c7` (satin aluminum, a strong
  left-bright gradient); wheel `#b8b8b8` (light grey); labels `#6c7276` (dark grey); center `#868989`
  (body aluminum, not wheel). Cross-check: "File:IPod classic 80 GB (A1238, YMV)-9876.jpg" (CC BY-SA 4.0).
- **Encore (black + red wheel)** - "File:IPod U2.jpeg" (CC BY 3.0; 640x420, SMALL and soft - hue only).
  Body `#39393b` (glossy black, like Click (Black)); wheel `#e85a70` raw (a warm red; normalize - it is
  the photo's brightest object); center `#2a1e20` (black); labels near-white. Reuse Click (Black)'s body
  roles and change the wheel, center and labels; say so in the side-by-side notes.
- **Blue (mini 2G)** - "File:IPod mini blue front 2G.jpg" (CC BY-SA 3.0; front-on). Body p15/p50/p85
  `#123140` / `#1e5d6a` / `#37829b` (a teal-blue, underexposed: the top edge reads `#58aabf`); wheel
  `#a9a9a9`; center = wheel color; labels `#4e91a6` (the BODY color - the 2G mini's labels match the body).
- **Green (mini 2G)** - "File:Green ipodmini 2ndgen.jpg" (CC BY-SA 2.0; a close crop, labels green):
  body `#355b30`, labels `#327547`. Cross-check body with "File:Green ipodmini 1stgen.jpg" (public
  domain; 1G, grey labels): body p50 `#6b8336`, p85 `#778c40`. Center = wheel color.
- **Pink (mini 2G)** - "File:Apple iPod 5G-nano 2G-mini 2G.jpg" (CC BY 2.0; the pink mini on the right,
  warm light, strong correction): body p15/p50/p85 `#611e31` / `#89475c` / `#ab6582`; wheel neutralized
  to `#cecece`; labels `#bb9394` (pink); center = wheel color.
- **Gold (mini 1G only)** - NO photo found on Commons (searched: ipod mini gold / champagne / 1G /
  family). Build it LAST: search a CC-licensed source (Flickr CC search) or ASK DEAN for a photo; never
  guess a gold (the match-reference norm). 1G minis carry GREY wheel labels (see "File:Ipod mini 1G.jpg",
  public domain, a silver 1G). If no reference arrives, ship the other five and disclose gold.
- The mini's CENTER button is the wheel's light grey, not the body color (all three 2G photos).
- With 12 skins, re-measure the Settings picker and the sticker menu's skin chips (they wrap, never
  shrink - the button-measurement norm, scripts/action-row-probe.js) and the Nano tray chips.

## Design

**Overview.** Three moves, in an order that keeps every step provable: take Seattle out (a pure
removal), move the Click family onto ONE token system with zero rendered change (proved by
equivalence + pixels), make overflow systematic (the one intended visual delta, measured), then
add Click (Red) as a single token block (the system's acceptance test).

**Token layers** (names are a proposal; keep the `--mms-` prefix family or introduce `--pk-`,
but ONE naming scheme, documented in a comment header at the top of the pocket block):
1. **Structure tokens** (sizes, one place, on the pocket scope `.mms-ipod`): the LCD ratio, the
   status bar padding + battery box, the menu row pitch (today 34 px, and its note-row min),
   the list row padding, the cover width, the split ratio, the wheel and center diameters,
   the zone glyph box, the speaker glyph, the letter square, the 44 px touch target, the jump
   grid row, the skeleton bar, the Nano tray's art box and screen inset.
2. **Type scale** (roles, mapped onto the global `--fs-*` / `--fw-*`): status title, now-playing
   title / artist / album / meta, list row, row number / duration, menu row, chevron, note,
   About name, the jump letter / badge / picker.
3. **Colorway roles** (the only thing a colorway sets): body background stack, body edge,
   wheel ramp (2 stops) + the wheel sheen color + the wheel light origin (40 % / 42 %), wheel
   label color, center ramp (2 stops) + its origin (40 % / 38 %), the lighting band / band2 /
   core for Subtle and Pronounced. `.mms-ipod` carries White's values; `.mms-ipod-black`,
   `.mms-ipod-matte`, `.mms-ipod-red` are each ONE rule of role tokens. Every structural rule
   (`.ip-wheel`, `.ip-center`, `.ip-zone`, the `.mms-lit` / `.mms-lit-strong` variants) reads roles
   and exists ONCE. Watch the var() resolution scope: `--lx` / `--ly` / `--lm` are written on the
   panel (the same element that carries the colorway class), so keep the geometry (calc with
   --lx/--ly) in the rules and put only colors / stops / origins in the role tokens.
4. **The screen palette** (LCD white, the blue selection bar, the Aqua scrubber, greys) stays
   shared and unchanged - no colorway touches the screen.

**Overflow, systematically.** One "text line" rule for every single-line text element of the
pocket screen (`min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis`), one
selector list, placed BEFORE the rules that deliberately wrap (`.ipm-noterow .ipm-lbl`), so
equal specificity keeps the exceptions winning. The Nano tray's copies fold into it. Bind it
with a census: render every pocket level (music-skins.js renderers + renderMenuView, 120-char
names) and assert every leaf text element's class is either in the text-line list or in a named
wrap-exempt list - a new text element fails the test until it is classified.

**Registry-derived lists.** A helper on FileTubeMusicSkins (e.g. `clickColorways()` = registry
entries with `menus === 'click'`) feeds Brick's `WHEEL_SKINS`, the pop-out tray chips, the Nano
tray's colorway getter, and the scripts' default lists. The Settings blurb map stays a map but
a census test fails any registry id without a blurb.

**Seattle removal.** Delete the registry entry, `renderZuneClassic`, the Seattle menu style and
every pivot / swipe path in the controller and engine (the Click paths must stay byte-identical
in behavior), the swipe-back owner, the CSS block and tokens, the scripts' Seattle branches, and
the Seattle tests (a test that bound a SHARED invariant using Seattle as its example - e.g. the
A20/A22 escaping of drilled titles, the swipe unbind on every teardown arm - is rewritten onto
Click, not deleted). `normalizeSkinId` gains a legacy map `{ 'zune-classic': 'ipod' }`, and the
active-skin read rewrites the stored value once when it was legacy (so the synced pref converges).

## Acceptance (spec: each names how it is measured)

- **AC1 Seattle is gone.** No `zune-classic`, `seattle`, `Seattle`, `znc-`, `mms-zn-`, pivot or
  `data-skin-swipe` remains in public/, scripts/ or test/ except the legacy-map entry and its
  test (a grep census test, comment-stripped). The Settings picker lists Cider, Nordic, Click,
  Click (Black), Click (Matte), Click (Red) - and, with D8, Click (Silver), (Encore), (Blue), (Green),
  (Pink) and (Gold): twelve skins.
- **AC2 Seattle users land on Click.** A device with `ft-music-skin = zune-classic` (localStorage
  AND the server-synced pref, driven through the real prefs path) opens on Click with its pocket
  menus, and the stored value becomes `ipod`. Mutant: drop the legacy map -> RED (it would be Cider).
- **AC3 Zero rendered change for White, Black, Matte** across the token refactor (Step 2):
  `scripts/css-equivalence-diff.js` EQUIVALENT for the refactor commit against the Step 1 commit
  (or, where it cannot resolve class-scoped tokens, its listing explained line by line), AND
  pixel-identical screenshots of every pocket level (Now Playing, list, each menu level, Settings >
  Lighting, the jump picker, About, Brick) for all three colorways, lighting Off / Subtle /
  Pronounced at a fixed tilt, at 390x844 and 380x700, plus the desktop pop-out and the Nano tray.
  Report the diff count (expect 0 differing pixels).
- **AC4 One colorway = one token block.** A lock test: every registry entry with `base: 'ipod'`
  (enumerated from the registry, never a literal) has exactly one colorway rule that sets every
  role token, and no OTHER rule in the stylesheet names a colorway class (`.mms-ipod-black`,
  `-matte`, `-red`) - the structural rules exist once. Mutant: add a colorway-specific
  `.mms-ipod-red .ip-wheel{...}` -> RED.
- **AC5 No raw sizes in the pocket rules.** Every governed size / type value in the pocket rules
  reads a structure or type token (the token-exempt annotations that remain are only for values
  that ARE the token definitions). `npm run lint:css` stays at ZERO; overlay containment stays at ZERO.
- **AC6 Overflow is one rule.** The census described above; plus the status-bar probe extended to
  every text line on every level with 120-char artist / album / song / chapter names: every line
  is one line tall, no element's scrollWidth exceeds the LCD, the status bar height is constant.
  Numbers reported per skin x viewport x level.
- **AC7 Click (Red) exists and matches the photo.** Registry entry `{ id: 'ipod-red', label:
  'Click (Red)', base: 'ipod', menus: 'click' }`; its CSS is ONE role-token block; it gets pocket
  menus, Brick, lighting (Subtle + Pronounced), the Nano tray and pop-out chips, and a Settings
  blurb - with no per-feature edits beyond the registry entry, the token block and the blurb (the
  registry-derived lists prove it). A SIDE-BY-SIDE PNG (the photo's crop next to the rendered
  skin's body + wheel + center) is produced for Dean and the gate; the sampled values are cited.
- **AC8 Registry-derived lists.** Brick's wheel skins, the tray chips and the Nano colorway
  getter all derive from the registry; a test adds a fake Click colorway to the registry and
  asserts it appears in all three with no other change. Mutant: restore any literal -> RED.
- **AC9 Everything else unchanged.** Full `npm test` green on Node 22.23.1 and 24.20.0; the pocket
  menu integration suites green on Click (their Seattle cases rewritten or removed as above).

- **AC12 The D8 colorways (Silver, Encore, Blue, Green, Pink, Gold).** Each is a registry entry + ONE
  role-token block + a Settings blurb and nothing else (AC4/AC8 enforce it); each has a side-by-side PNG
  against its reference with the exposure-normalized samples cited; all six get menus, Brick, lighting,
  the tray and pop-out chips. The picker and chips measured before/after (12 cards / chips wrap cleanly).
- **AC10 Home from the sticker (D7).** The sticker menu's FIRST row is Home on every skin that
  draws the sticker (Click family, Red, Cider, Nordic; music and podcasts). Tapping it docks the
  player (playback continues, the mini-player shows) and lands on `/` through the SPA router (no
  full reload), in ONE tap after opening the sticker. Integration-bound through the real sticker
  click; the menu's other rows unchanged. In the desktop pop-out (document picture-in-picture) the
  row must act on the MAIN window (its router) or be left out there - decide, bind it, disclose it.
- **AC11 Hold MENU = Home (D7).** On the Click wheel, a press held past a threshold (propose ~600 ms;
  check it against the existing hold-to-scan timing on the left/right zones and reuse that
  machinery, one down event, not pointerdown + touchstart both) goes home exactly like AC10, and
  the release does NOT also fire MENU's tap (no climb, no dock-twice). A short press is unchanged.
  Moving off the zone, pointercancel, a dock or a destroy mid-hold cancels it, and every listener
  or timer it adds is released on every arm (the v1.271 unbind class). A haptic tick on trigger
  where the wheel already ticks. Bound: short press still climbs; a held press goes home once;
  cancel arms; mutants on the threshold, the click-suppression and each cancel arm go RED.

## Steps (each ends in a commit; a Demo is what can be seen once it lands)

1. **Remove Seattle** (+ the legacy map, AC1/AC2). Demo: Settings shows five skins; a device
   saved on Seattle opens on Click; every Click behavior unchanged (the pocket suites green).
2. **Token refactor, zero delta** (AC3/AC4/AC5 for White/Black/Matte). Take the BEFORE
   screenshots on the Step 1 commit first (`FT_ROOT=<a git worktree at Step 1>` - the probes
   support a BEFORE root), then refactor, then AFTER, then the pixel diff. Demo: nothing visible changes.
3. **Overflow rule + census** (AC6). Demo: 120-char names never wrap or spill on any level.
4. **Registry-derived lists** (AC8). Demo: unchanged behavior; the fake-colorway test.
5. **Click (Red)** (AC7): the registry entry, the one token block from the samples, the blurb,
   the side-by-side PNG (send it to Dean with SendUserFile if available, else list its path).
   Demo: pick Click (Red) in Settings; the menus, wheel, lighting and Brick all work on it.
5b. **The D8 colorways** (AC12): Silver, Encore, Blue, Green, Pink, then Gold last (its reference first).
   Demo: all of them in Settings; one side-by-side sheet for Dean.
6. **Home (D7, AC10/AC11)**: the sticker's Home row, then hold MENU. Demo: from Now Playing or a
   deep menu level, sticker > Home lands on the home page with the song still playing; holding
   MENU does the same.
7. **Gate** (adversary + qa, fresh seats, brief below), fix loop max two rounds, then release.

## Gate brief (for the seats)

Attack surfaces: (1) the legacy-pref path - a synced `zune-classic` from another device arriving
AFTER boot, the prefs sync re-writing it, the Settings picker's highlight; (2) rendered-change in
the refactor - re-take the screenshots yourselves, mutate a role token, confirm the pixel diff
catches it; (3) the controller after the pivot removal - every Click menu path, MENU/Select/wheel,
the pop-out, dock/undock, destroy() unbinding every listener it still binds (the v1.271 unbind
class); (4) the overflow census - add a new text element and prove the census fails; (5) the
INERT SIBLING class - find any Click list still hand-kept; (6) every colorway's reference fidelity (the
side-by-sides) and its lighting on both strengths; (7) the token-lint and containment ceilings;
(8) Home (D7): the hold's release firing MENU too, a hold across a dock / skin switch / destroy,
the pop-out window's Home, and the router landing (same-route and cross-route) with playback intact.

## Release (v1.332.0, docs/RELEASING.md + AGENTS.md)

`npm version 1.332.0 --no-git-tag-version`; ROADMAP "Shipped" entry (move the design-system and
Seattle/Red Planned bullets out; the future colorways stay Planned); `docs/releases.json` in user
language (Seattle is gone and a saved Seattle becomes Click; the new Click (Red); long names never
break the pocket screens); `node scripts/plan-complete.js <this plan> "Shipped v1.332.0" --apply`;
full `npm test` on 22.23.1 then 24.20.0 (`export PATH="$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH"`,
`FILETUBE_TEST_FFMPEG=$HOME/.local/bin/ffmpeg-static/ffmpeg`); release branch, `merge --no-ff`
into main, tag the merge, push the tag + the release branch at the merge commit with
`GIT_SSH_COMMAND="ssh -o ServerAliveInterval=20 -o ServerAliveCountMax=60"`; `gh pr create`;
CI green; `gh pr merge --merge`; `git pull --ff-only`; delete branches with `-d` (GitHub
auto-deletes the merged head).

## Build record (the builder's claims - the seats measure, never trust)

One commit per step, base e45906fb (v1.331.0), branch feat/pocket-design-system:

| Step | Commit | What | Bound by |
|---|---|---|---|
| 1 | 76c6f65b | Seattle removed; legacy map `zune-classic -> ipod` + one-time rewrite | test/unit/seattle-removed-census.test.js (AC1, comment-stripped); music-skins.test.js + integration music-pocket-menus.test.js AC2 (real prefs-sync.js against the real /api/prefs: localStorage AND the server pref converge on `ipod`) |
| 2 | 7c3cc755 | the token system (`--pk-*` structure, `--pk-fs-*` type, `--pk-c-*` colorway roles); White/Black/Matte on one chassis | test/unit/pocket-design-system.test.js AC4/AC5 + the colorway value authority; type-scale-tokens follows the one `--pk-fs-*` hop |
| 3 | da74fdd1 | ONE text-line rule + the census; the render probe's AC6 measurements | pocket-design-system.test.js AC6 (census + no hand re-declaration) |
| 4 | d56f16bb | registry-derived lists (IDS, clickColorways, Brick, tray chips, Nano getter, probes) | music-skin-integration AC8 (a patched registry source with ONE fake entry reaches the tray, its chips and Brick) + the blurb census |
| 5 | 6a00c3db | Click (Red) | the value pin + every registry-derived test |
| 5b | 7f628969 | Silver, Encore, Blue, Green, Pink, Gold; scripts/skin-chips-probe.js | the value pins |
| 6 | 3df9560d, 915a7f3a | Home: the sticker's first row + hold MENU (600 ms); common.js goHomeFromPlayer | test/unit/pocket-home.test.js (written red first), the real music + podcasts views, goHomeFromPlayer run from source |

**Mutants (all on committed trees, /tmp sandboxes from `git archive`, `git diff --stat` non-empty):**
AC2 drop the legacy map -> RED (2 tests); drop the one-time rewrite -> RED (2). AC8 restore the literal
trio in the Nano getter / the chip filter / Brick -> RED each. AC4 add `.mms-ipod-black .ip-wheel{...}` ->
RED; change one role value -> RED. AC6 drop `.ipm-val` from the text line -> RED; hand-add an ellipsis
to `.ipm-lbl` -> RED. AC5 a raw `min(70vw,288px)` back in the wheel -> RED. AC11 (at 915a7f3a): threshold
600 -> 50, the click suppression, the move clear, the end-arm clear, the takeover guard, the
un-rendered-panel guard, the main-document guard, the Home row dropped -> RED each (8/8; the first
round at 3df9560d left the move / end-arm / takeover clears unbound behind the fire-time guards -
915a7f3a binds each arm at the arm).

**AC3 (zero rendered change, Step 1 vs Step 2) - scripts/pocket-render-probe.js**, worktrees at
76c6f65b and 7c3cc755, ONE frozen copy of the probe for both: 282 shots per tree (White / Black / Matte x
390x844 + 380x700 x 15 levels x lighting Off / Subtle / Pronounced at one tilt, + the pop-out and the
Nano tray per colorway). Element styles (every element's full computed style incl. ::before/::after,
hashed): **0 differences on all 282**. Pixels: **281 of 282 shots 0 px**; one (Matte 380x700 artist level,
Subtle) 8,469 px at a max channel delta of 2, where Step 1 vs Step 3 (a superset of Step 2's CSS) is 0 px
on the same shot and a re-run moved a 5 px wobble to a different shot - rasterizer noise, not CSS.
The instrument first measured 9.36 M px between two runs of ONE tree (GPU/multi-thread gradient dither,
fonts not yet loaded, playback resuming, the random server port inside url()s); it now rasterizes on one
CPU thread, waits for fonts, pins play(), and strips the loopback origin - two runs of one tree: 0 px /
0 styles. Sensitivity: a ONE-level change to Click (Black)'s wheel stop (#3d3d3f -> #3d3d40) shows on every
shot (~100 k px) with the `.ip-wheel` style diff. `scripts/css-equivalence-diff.js` was NOT usable: it
resolves only :root / theme-scoped definitions (class-scoped roles read UNRESOLVED) and keys on selectors,
so a refactor that deletes the colorway rules can never read EQUIVALENT - the computed-style hashes in a
real browser are the stronger prover.

**AC6 (overflow) - the same probe:** 120-character artist, album, song and chapter names, every level (Now
Playing long, the long song list, the artist, the album, the chaptered file's chapters, the picker,
Settings, Lighting, About, Brick) x 3 colorways x 2 viewports: **0 text elements on more than one line, 0
spills past the LCD, no page overflow, the status bar 31.2 px on every level** - before Step 3 AND after
(the v1.325 fixes already held these fixtures; Step 3 is the systematic guard and its census). Step 2 vs
Step 3: 0 px beyond the same wobble shot; the style diffs are exactly the newly guarded elements
(`.ip-nof`, `.mms-pos`, `.mms-rem`, `.mms-rd`, `.ipm-val`).

**AC12 measurements - scripts/skin-chips-probe.js** (Step 3 tree, 5 skins, vs 12 skins): no existing chip
or card changed size on any viewport (390x844, 375x667, 380x700, the 310x133 tray); the sticker's Skin
chips go 2 -> 6 rows and the sticker menu now SCROLLS on every phone size (it did not at 390x844 before);
the tray's Color chips go 2 -> 6 rows inside its full-window overlay (scrolls). Settings picker: see the
final run.

**Side-by-sides (sent to Dean 2026-09-25, not committed):** each reference photo beside the rendered skin
with the sampled vs used values, plus a lighting sheet (Off / Subtle / Pronounced, every new colorway).

### Gate r1 fix round (both seats CHANGES @ba10139c)

- **W1 (adversary + qa, both measured - the blocker):** the retired-id rewrite was a synced write with a
  fresh stamp made BEFORE the sync's boot GET, so a stale Seattle device out-stamped another device's newer
  pick and reverted it everywhere. Fix: prefs-sync.js gains `whenBooted(fn)`; on the page's own storage the
  rewrite waits for it and rewrites only a value that is STILL the retired id (one wait at a time; no sync
  agent or a caller's store = at once). Bound red-first by the seats' race through the real prefs sync and
  server (integration music-pocket-menus 'gate r1 W1': local ipod, server ipod before; now both ipod-red),
  plus a unit binding of the wait / leave-newer / converge arms; AC2's convergence still green.
- **W2 (adversary):** the AC4 lock now fails ANY mention of a colorway class (class or attribute spelling)
  outside its one block, and a second bare rule for the block's selector.
- **W3 + S8 (adversary):** a takeover begun mid-hold is bound (the fire-time guard); the threshold is pinned
  at 550 ms (a timer never fires early) and 600-1600 ms.
- **S1 (adversary):** AC5's raw-size lock covers any rule naming a pocket element class, scoped or not.
- **S3 (adversary):** the Encore comment's x0.8 arithmetic corrected (#ba485a, the ramp around it).
- **S5 (adversary):** the status-bar and lighting probes fall back on trees without `clickColorways()`.
- **qa S1:** skin-chips-probe opens Settings > Appearance on a phone (it measured 0x0 there). Measured, Step 3
  tree (5 skins) vs now (12): no sticker or tray chip changed size on any viewport; the Settings picker
  wraps 3 -> 6 rows (390x844, 380x700), 5 -> 12 (375x667, one column), 2 -> 3 (1280x800); Click (Matte)'s
  card grows 71 -> 83 px at 390x844 and 1280x800 - it sat ALONE on the last grid row before and now shares
  a row with Click (Red) (a grid row takes its tallest card's height; every other card was already 83 / 85).
  New blurbs were shortened to the old ones' length (their 1280 cards stay three lines like the old ones).
- **qa S2 / S3 / S4:** stale comments and test names updated (lighting scope, the tray filter, "the three
  wheels", the tray chips, the census title, tracker #257); the ledger no longer calls Gold "the mini's";
  the three unused eslint directives removed. Settings' copy no longer names the real products.

## Deviations

1. **Gold's reference is Dean's own photo** (he attached it with the build directive): a gold classic with a
   white wheel and a GOLD center, not a first-generation mini - so the center is the body gold as on the
   photo (the plan's "mini center = wheel grey" rule does not apply), labels light grey.
2. **White-wheel exposure anchor.** The plan normalizes exposure so the wheel reads like Click (White)'s
   GREY wheel. Red's and Gold's wheels are WHITE plastic, so they anchor on a near-white wheel (Red's
   plan-given values; Gold to #eef1ef) - the grey anchor would have darkened both bodies ~12%.
3. **Pink's labels** use the body's p90 (#9e5a73): under the photo's warm light the glyph cores measure a
   muddy #997e6c, and the second mini prints its labels in the body color.
4. **AC1's `pivot` census is literal**: two test names that used "pivot" in its English sense (Dean's change
   of course in chapter-snap-resume, a comment in music-skin-integration) were reworded.
5. **AC3's instrument** is the render probe's computed-style hashes + pixels, not css-equivalence-diff.js
   (reason above). **Step 3's "one intended visual delta" measured 0 px** at these fixtures.
6. **AC10 in the pop-out: left out** (decided): no Home row and no hold there - its router is the main
   window's and a pop-out Home would move a tab you are not looking at (the Watch row's posture).
7. **AC10's binding**: the router is not bootable in jsdom (menu-returns-to-origin's precedent), so the real
   music and podcasts views are driven through the real sticker click with `goHomeFromPlayer` observed, and
   `goHomeFromPlayer` itself is run from its own source (dock, re-render, navigate('/') in order).
8. **AC11's haptic tick** reuses the wheel's own ghost tick at the press point; whether iOS ticks for a
   finger that is not moving is a device check.

## Disclosed gaps

(shipped disclosed in ROADMAP v1.332.0 and tracker #280)
- The sticker menu scrolls on phones with 12 skin chips (Home leads it, so going home never needs the
  scroll). A compact colorway picker would be a design change for Dean.
- Pink is judged from the weakest photo (warm light); every colorway's final say is Dean's on the device.
- The hold-MENU haptic on a still finger (deviation 8).
- The render probe's wobble on identical trees (adversary S6, measured): over 282 shots, 0 element-style
  differences always, but up to 4 shots per run differ (one of ~8,500 px, three of 1-6 px, max channel
  delta 2); the builder's "two runs of one tree: 0 px" held for a 36-shot run only. A one-level token change
  reddens every shot, so the instrument still separates CSS from noise.
- Click (Red)'s reference carries an embedded colour profile: the plan's samples are the raw decode; a
  browser shows the photo ~7 degrees warmer (adversary S2). Dean's call on the device.
- Wheel-label contrast is low on Red (1.51 / 1.30), Gold (1.54 / 1.34) and Blue (1.91 / 1.64) against
  Click (White)'s 2.75 / 2.36 - faithful to the photos, but they are control labels (adversary S4). Dean's call.
- The 600 ms MENU hold is longer than Android Chrome's ~500 ms long-press: whether that shows a context menu
  or cancels the pointer on a real Android phone is unmeasured (qa S5; headless touch did not cancel).
- Click (Matte)'s Settings card grows 71 -> 83 px by sharing a grid row (measured above).


## Gate

Gate: CHANGES r1 @ba10139c - qa

Instruments (run by the seat at ba10139c, tree clean): `npm run lint:css` TOTAL 0; `overlay-containment-lint --enforce` clean (0 violations); full `npm test` on Node 22.23.1: 9592 tests, 9592 pass, 0 fail; the 43 touched test files + music-sticker-menu on Node 24.20.0: 587 pass, 0 fail (full Node 24 not run by this seat); eslint on the changed files: 0 errors, 9 warnings; `ledger:check` CLEAN. Render spot-check (the frozen pocket-render-probe, Step 1 76c6f65b vs HEAD, White/Black/Matte, 390x844, 3 lights + pop-out + tray, 147 shots): pop-out and Nano tray 0 px on all 12; in-tab 7,383 px total = the About screen's version string (1.331.0 -> 1.332.0, 818 px x 9 shots, cropped and viewed) + wobble shots of 2-8 px at max delta 1; the computed-style diffs are the Step 3 text-line elements (ip-nof, mms-pos, mms-rem, mms-rd, ipm-val) plus the hidden sticker menu's re-keyed paths (Home row inserted first). AC3/AC6 claims hold at this spot-check.

- WARNING W1 (public/js/music-skins.js:269, the D1 one-time rewrite): the legacy rewrite is stamped as fresh user intent, so on a cold boot it can REVERT another device's newer explicit pick - the prefs sync's own last-write-wins rule (its QA CRITICAL-1 "last-BOOT-wins" guard). Scenario, driven through the real prefs-sync.js against the real /api/prefs (a /tmp sandbox of ba10139c, the AC2 harness): the server holds `ipod-red` written 10 s ago by another device; this device's localStorage holds `zune-classic`; cold boot of /music?play=nd1 -> the view's synchronous skin read (mountEarlyCover / activeSkinId) rewrites `ipod` through the patched setItem with a Date.now() stamp BEFORE the boot GET lands, applyServer then skips the older server row, and the flush pushes `ipod`. Measured end state: local=ipod, server=ipod (Red lost on every device). Control, same harness, local `ipod-black` (a live stale id): local=ipod-red, server=ipod-red. Same race on a cold Settings load (renderMusicSkinPicker). Impact is one cosmetic preference, only for devices still holding the retired id. Fix shape: defer the rewrite until the prefs boot GET has settled (e.g. prefs-sync exposes a boot-settled hook; re-read then and rewrite only if still legacy), OR keep the read-side map and drop the write-through (every reader maps; AC2's server-convergence clause then amended). Bind it with the race above (it reds today). I accept either the fix, or the Architect's explicit decision to ship it disclosed (tracker #280 + ROADMAP) given the preference-only impact.
- SUGGESTION S1 (scripts/skin-chips-probe.js:86-90): the Settings picker line is VACUOUS on phones - every card measures 0,0,0,0 because the picker sits in the closed master-detail pane (the Build record's "see the final run" was never filled). The seat measured it (probe variant that taps `.md-row[data-md-target="appearance"]`, base e45906fb vs HEAD, 390x844 / 375x667 / 380x700 / 320x568 / 1280x800): no pre-existing card changed w/h at any width; 12 cards wrap to 6 rows (2-col) or 12 (1-col); at 375x667 the new Silver and Gold cards are 71 px vs 59 (their blurbs take two lines - uneven, not a deformation). The doc-overflow flag toggles on BOTH trees (the md-panes slide captured mid-animation), not this change. Fix the probe so the numbers are real.
- SUGGESTION S2 (stale comments / names): public/js/pocket-lighting.js:11-12 "the Click family only (Click, Click Black, Click Matte)" (now ten colorways); public/js/skin-surface.js:1452-1455 "the silver/black body palettes are the colorways"; test/unit/pocket-lighting.test.js:659 and :697 "the three Click wheels and domes" (one chassis rule now); test/unit/music-skin-integration.test.js:1880-1881 "the Click trio incl. the new Matte colorway" over a registry-derived assert; test/unit/seattle-removed-census.test.js:67 titled "each with a blurb" but asserts no blurb (the binding lives in setup-music-skin-picker.test.js); docs/exec-plans/tech-debt-tracker.md row #257 (OPEN) still says "a Click/Seattle skin"; the plan's own AC1 still lists six skins.
- SUGGESTION S3 (docs/releases.json:3246): "the mini's Blue, Green, Pink and Gold" - by Deviation 1 Gold was built from a gold CLASSIC (white wheel, gold center), not a mini.
- SUGGESTION S4: three new unused `eslint-disable no-new-func` directives (test/unit/menu-returns-to-origin.test.js:114, :120; test/unit/music-skin-integration.test.js:92).
- SUGGESTION S5 (device check, a suspicion not a finding): the 600 ms hold outlasts Android Chrome's long-press (~500 ms); whether that fires a contextmenu / pointercancel on the wheel (touch-action:none, -webkit-touch-callout:none are set) is unmeasured headless. Dean is on iOS; worth one line in the disclosed gaps beside deviation 8.

Verified clean (no finding): the legacy map is prototype-safe and a throwing setItem still maps; the Settings picker highlights Click for a legacy id; every Click list derives from the registry (no ipod/ipod-black/ipod-matte literal left in public/js, lib/, server.js); the pivot/swipe removal leaves every Click path equivalent (onLeftRight/isPivotLevel were false on Click; the swipe listeners were inert off [data-skin-swipe]); destroy() balance is bound on Click; the token-scale and type-scale locks were MOVED not weakened (the type lock follows one --pk-fs hop and still rejects an undefined role or a literal; the palette values moved to pocket-design-system.test.js byte-exact); hold-MENU arms and clears on every end arm and the view teardown on navigate('/') drops any stale click-suppress flag. Security: no new surface - the Home row and the colorway markup are static strings, skin ids reaching className are registry-normalized, the chip ids/labels are escaped, goHomeFromPlayer navigates to a constant '/', and the legacy value path only maps an exact own-property key.

Gate: CHANGES r1 @ba10139c - adversary

Instruments (run by this seat at ba10139c in a /tmp `git archive` sandbox, node_modules symlinked): full `npm test` Node 22.23.1: 9592 tests, 9581 pass, 8 fail, 3 skipped; Node 24.20.0: 9592 tests, 9581 pass, 8 fail, 3 skipped. The same 8 fail on both and are sandbox artifacts (7 files that shell out to `git ls-files` or walk into the symlinked node_modules: app-settings-store, comment-debt-census, dbjson-never-read, media-items-store, media-record-stores, media-trash-store, media-view-counts-store); those 7 files run in the real repo: 69/69 pass on both Nodes. `npm run lint:css` TOTAL 0; `overlay-containment-lint --enforce` 0 violations; eslint on the touched files 0 errors.

- WARNING W1 (corroborates qa W1, reproduced independently; public/js/music-skins.js activeSkinId): the one-time legacy rewrite goes through the patched setItem, so it is mirrored and stamped as fresh user intent. Repro (jsdom, the real prefs-sync.js + music-skins.js from the tree): server `ft-music-skin` = `ipod-red` stamped now-60s (device B's pick); this device holds a stale `zune-classic` with an older meta stamp; the first render reads the skin while the boot GET is still in flight (music.js mountEarlyCover reads it synchronously on a cold /music?play= load) -> `ipod`, mirrored at now; the GET then loses LWW to the new local stamp; after flush the server holds `{"value":"ipod"}`. Device B's Click (Red) is reverted on every device. Prescription: the rewrite must not out-stamp the server (write it raw keeping the legacy value's own stamp, or defer it until the boot GET has settled and the value is still legacy); bind it with this exact cold-boot race.
- WARNING W2 (AC4 lock does not bind its own claim): "no other rule names a colorway class" counts only rules that SET a `--pk-c-*` role. Mutant: add `.mms-ipod-red{ background:#f00; }` (a second, role-free block) -> pocket-design-system + music-skins + pocket-lighting 63/63 green. The spelling `[class~="mms-ipod-red"] .ip-wheel{ background:#f00; }` also survives (63/63). Safe to ship disclosed (the stylesheet is clean today; measured), cheap to fix: require exactly ONE rule whose selector mentions each colorway class in any spelling.
- WARNING W3 (AC11 cancel arm unbound): a takeover that STARTS mid-hold (a second finger taps the Brick row while MENU is held) is cancelled only by the fire-time `|| wheelTakeover` guard in skin-surface.js; setWheelTakeover never clears st.homeTimer. Dropping that guard: pocket-home + music-skin-integration 126/126 green. A scratch test (pocket-home's own harness: down on MENU, setWheelTakeover at 100 ms, wait 700 ms, expect no home) passes on the tree and goes RED on the mutant. The arm-time takeover check is bound; this one is not. Safe to ship disclosed (the code measures correct); one test fixes it. (The rest of that guard line - st.ended / st.moved / wheelSpin !== st - is redundant now that every arm clears the timer: deleting the whole line survives too.)
- SUGGESTION S1 (AC5 scope): the raw-size lock only sees selectors containing `.mms-ipod` (or the tray). An unscoped `.ip-wheel .ip-center{ width:61px; height:61px; }` (equal specificity, later, so it WINS over the chassis) survives AC5 (15/15 green) and lint:css (TOTAL 0). Today only one out-of-scope pocket rule exists and it has no size, so AC5 holds as shipped.
- SUGGESTION S2 (Red reference decode): the Red photo is the only reference with an embedded ICC profile. The plan's and the block's Red samples match the RAW decode (Chromium createImageBitmap colorSpaceConversion none: y650 #fd3848, y1420 #e12130, y1480 #d5192a, y1590 #bb1021, center #fd455e), not the colour-managed decode every browser displays (#ff4345, #e42e2b, #d82724, #be1e1a, #ff4f5d - warmer, G >= B). The CSS ramp (#e02031, #d4192b, #c41424) is therefore crimson-shifted ~7 deg against the photo as a browser shows it. Dean's call on the device; worth knowing when judging the side-by-side.
- SUGGESTION S3 (lying comment): Click (Encore)'s block says the wheel is the photo's #e85a70 "x0.8 -> #c4505f"; x0.8 is #ba485a (#c4505f is about x0.85 / x0.89 / x0.85).
- SUGGESTION S4 (legibility, Dean's call): wheel-label contrast against the two wheel stops: Red 1.51 / 1.30, Gold 1.54 / 1.34, Blue 1.91 / 1.64, against Click (White)'s shipped 2.75 / 2.36. Photo-faithful (the Red photo's MENU is fainter still), but these are the control labels.
- SUGGESTION S5 (probes): scripts/skin-status-bar-probe.js and scripts/pocket-lighting-probe.js default to `require(FT_ROOT/public/js/music-skins.js).clickColorways()`; on any pre-v1.332 BEFORE root (their documented use) that is `TypeError: SK.clickColorways is not a function` (measured on e45906fb). pocket-render-probe.js has the fallback; copy it.
- SUGGESTION S6 (AC3 disclosure wording): my Step 1 vs Step 2 compare (282 shots, one frozen probe copy): 0 differing element styles; 278 shots 0 px; 4 shots of noise (White 380x700 Music Subtle 8,524 px max delta 2; three at 1-6 px max delta 1). Re-shooting Step 1 reproduced that 8,524-px shot against Step 1 ITSELF and matched Step 2 at 0 px on all 45 re-shot frames, so it is rasterizer noise - but "two runs of one tree: 0 px" is not what I measured, and "rare single-shot wobble" undercounts (4 shots in one compare). Sensitivity confirmed: a one-level change to Click (Black)'s wheel-label role reddens every Black shot (2,079-2,110 px, 10 element styles each).
- SUGGESTION S7: corroborating qa S2 (stale "Click, Click Black, Click Matte" in pocket-lighting.js:11-12; skin-surface.js:1454 "silver/black body palettes"), qa S3 (the ledger's "the mini's ... Gold") and qa S4 (three unused eslint-disable directives, eslint reports them). qa S5 stays a device check: in headless Chromium a real 900 ms touch hold (CDP touch events) went home with no cancel and no release click.
- SUGGESTION S8: the hold threshold is bound only inside (400, 700) ms: HOME_HOLD_MS 450 survives.

Verified (ran it): Home end to end in headless Chromium with real CDP touch input at 390x844 - hold MENU 900 ms on Now Playing (Click, Click (Red)), from a drilled menu level (Click (Black)), and the sticker's first row "Home" (Click (Gold)): each lands on / with view=home, no reload (a window marker survives), the same track still playing (currentTime advancing, not paused), the mini docked and visible, mms-on and the full classes cleared, 0 page errors, still on / 1.5 s later; a short MENU still climbs to the Click menu; after Home and reopening the player, a programmatic (assistive) click on MENU climbs and on Select flips the list - no stale click-suppress flag. The post-boot legacy path: a synced zune-classic applied by the visibility refresh is read as ipod and rewritten; a throwing store reads the default. Mutants that went RED as claimed: drop the one-time rewrite; the chip filter and Brick restored to literal trios; closeStickerMenu dropped from goHome; a new `ip-genre` text element in ipScreen (the AC6 census); `.mms-rd` dropped from the text line; nowrap dropped from the text line (3 red). Black/Matte values: every former --mms-ipodk-* / --mms-ipodm-* / litk / litm / lits value matches its role (read against e45906fb; the pixel compare agrees). Lighting renders on Subtle and Pronounced for all seven new colorways (my own sheet). Every hand-kept Click list in public/ now derives from the registry (grep sweep). Tree: restored, see the seat's report.

Gate: APPROVED r2 @bbb40ab9 - qa

Delta re-verification of the qa r1 findings against bbb40ab9 (the seat's own runs; /tmp sandboxes from `git archive bbb40ab9`, tree untouched):
- W1 FIXED as prescribed (the defer-until-boot-settled shape). The seat's r1 race repro re-pointed at bbb40ab9: server `ipod-red` (10 s old), local `zune-classic`, cold boot of /music?play=nd1, flush -> local=ipod-red, server=ipod-red (was ipod/ipod at ba10139c); the same with an older local stamp -> ipod-red/ipod-red; control local `ipod-black` -> ipod-red/ipod-red. AC2 convergence (the server holding the OLDER retired id) still converges on `ipod`. Mutants in a sandbox, each with a non-empty diff: the wait disabled (`if (false && sync ...)`) -> RED 2 (integration "gate r1 W1" + unit "gate r1 W1"); the still-retired re-check dropped (`ls.setItem` unconditional) -> RED 2. Script order puts prefs-sync.js after music-skins.js on every shell but nothing reads the skin at script-eval time, so the waiter is always reachable; a hung boot GET only leaves the value mapped-on-read (safe).
- S1 FIXED: the committed probe now opens Appearance on phones and prints real geometry. Seat run, base e45906fb vs bbb40ab9 at 390x844 / 375x667 / 380x700: no pre-existing card changed w/h; 6 -> 12 cards, 3 -> 6 rows (2-col) and 6 -> 12 (1-col); the shortened blurbs keep every new card at its row's height (59 px at 375x667, where Silver/Gold were 71 at r1).
- S2 FIXED except two leftovers (below); S3 FIXED (Gold no longer "the mini's"); S4 FIXED (eslint on every changed .js: 0 errors, 6 warnings, all pre-existing no-unused-vars); S5 DISCLOSED in the plan's gaps.
- Instruments at bbb40ab9: `npm run lint:css` TOTAL 0; overlay containment clean (0 violations); the fix round's 8 changed test files + prefs-store / prefs-api / prefs-sync-client: Node 22.23.1 250 pass 0 fail, Node 24.20.0 250 pass 0 fail. The full suites at bbb40ab9 are the builder's run (not re-run by this seat).
- New, SUGGESTION only (non-blocking): public/js/prefs-sync.js:214 still says the hooks object is test-only ("production ignores them"), but production now calls `whenBooted` on it; and the plan's AC1 text (:204-205) still lists six skins. Neither changes behavior.

Gate: APPROVED r2 @bbb40ab9 - adversary

Delta re-review of my r1 findings against bbb40ab9 (/tmp sandbox from `git archive bbb40ab9`, node_modules symlinked; every mutant applied to that committed tree, `diff` non-empty before crediting, restored after). Instruments: full `npm test` Node 22.23.1: 9594 tests, 9583 pass, 8 fail, 3 skipped; Node 24.20.0: 9594 tests, 9583 pass, 8 fail, 3 skipped. The 8 are the same sandbox artifacts as r1 (7 files that need a .git / walk the symlinked node_modules); those 7 files in the real repo at bbb40ab9: 69/69 pass on Node 22 and on Node 24. lint:css TOTAL 0; overlay containment 0 violations; eslint on the fix round's changed js/tests exit 0.

- W1 FIXED as prescribed (defer until the boot GET settles, rewrite only a value still retired). My r1 cold-boot race re-driven through the real prefs-sync.js + music-skins.js (jsdom, the boot GET held open while the first render reads): server ipod-red (60 s old) vs a stamped stale local zune-classic -> first read ipod, after boot local ipod-red and server ipod-red after the flush (was: server ipod). The convergence arms hold: server also zune-classic -> both ipod; older non-legacy server + newer local legacy -> ipod; boot fetch failing -> ipod; a zune-classic re-applied later by the visibility refresh is still rewritten. Every shell loads music-skins.js before prefs-sync.js, but nothing reads the skin in between, so the wait always sees the sync agent. Mutants, each RED: the wait disabled (2 red); the still-retired check dropped (2 red - the one that would clobber the server's newer pick after the GET); whenBooted run at once regardless of boot (1 red); the success path settling without draining the waiters (AC2 convergence red); the one-wait flag never reset (1 red).
- W2 FIXED: my two r1 mutants (a role-free `.mms-ipod-red{ background:#f00; }`, `[class~="mms-ipod-red"] .ip-wheel{...}`) and a compound `.mms-lit.mms-ipod-red .ip-center{...}` are each RED. Residual, SUGGESTION only: a substring attribute spelling `[class*="ipod-red"] .ip-wheel{ background:#f00; }` survives (64/64); nothing in the tree uses one.
- W3 FIXED: dropping the fire-time `|| wheelTakeover` guard is RED in pocket-home (the new mid-hold takeover arm).
- S8 FIXED: HOME_HOLD_MS 450 RED; 1800 RED (3). The lower-bound assertion at 550 ms is ordering-safe (both are Node timers, the earlier-due wait resolves and its microtasks run before the later timer's callback).
- S1 FIXED: the unscoped `.ip-wheel .ip-center{ width:61px; height:61px; }` is RED in AC5.
- S3 FIXED (the Encore comment). S5 FIXED: both probes' default-list expression evaluated against e45906fb's registry returns ipod, ipod-black, ipod-matte (was a TypeError). S2 / S4 / S6 disclosed in the plan with my numbers.
- qa S1's probe fix executed by this seat: scripts/skin-chips-probe.js now measures the Settings picker on phones (12 cards; 6 rows at 390x844 and 380x700, 12 at 375x667, 3 at 1280x800), matching the fix round's record.
- Nothing new found in the fix round beyond qa's r2 SUGGESTION (the prefs-sync hooks comment still says production ignores them).
