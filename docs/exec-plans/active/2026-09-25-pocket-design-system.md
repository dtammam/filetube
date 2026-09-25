---
plan: pocket-design-system
harness: v2 · lean
branch: feat/pocket-design-system
anchor: spec
status: Building
next: build Step 1 (remove Seattle), then Steps 2-5 in order; one gate (adversary + qa) at the end, max two rounds; release v1.332.0.
design: "Approved 2026-09-25 (Dean's intake in the v1.331 session: D1-D6 below, every answer his)"
gate: pending
---

# The pocket design system: Seattle out, one token system for the Click skins, and Click (Red)

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
| D5 | Future colorways (planned, not built) | **Silver** (the 2007 iPod classic aluminum), **Black + red wheel** (the U2 Special Edition look - a cheeky name, never the band's), **Mini pastels** (the iPod mini's blue, green, pink, gold). Nano rainbow declined |
| D6 | Seattle's pocket-menu pieces | removed entirely with it (pivots, swipe, pad-moves-pivot, Games row, two-line lists, the Metro screen) |

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
  Click (Black), Click (Matte), Click (Red).
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
6. **Gate** (adversary + qa, fresh seats, brief below), fix loop max two rounds, then release.

## Gate brief (for the seats)

Attack surfaces: (1) the legacy-pref path - a synced `zune-classic` from another device arriving
AFTER boot, the prefs sync re-writing it, the Settings picker's highlight; (2) rendered-change in
the refactor - re-take the screenshots yourselves, mutate a role token, confirm the pixel diff
catches it; (3) the controller after the pivot removal - every Click menu path, MENU/Select/wheel,
the pop-out, dock/undock, destroy() unbinding every listener it still binds (the v1.271 unbind
class); (4) the overflow census - add a new text element and prove the census fails; (5) the
INERT SIBLING class - find any Click list still hand-kept; (6) Red's reference fidelity (the
side-by-side) and its lighting on both strengths; (7) the token-lint and containment ceilings.

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

## Deviations

(none yet)

## Disclosed gaps

(filled at close)
