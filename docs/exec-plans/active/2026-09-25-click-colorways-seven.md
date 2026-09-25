---
plan: click-colorways-seven
harness: v2 · lean
branch: feat/v1.335-click-colorways
anchor: spec
status: Build
next: Step 2 - read the engine (renderIpod, screen, menus, Brick, lighting, sticker, tray, pop-out), complete the Original's design + AC6, then build it.
design: "Approved 2026-09-25 (Dean's picks in this session: D2, D9-D12 are his answers)"
gate: none yet
---

# v1.335.0: twelve more Click colorways and the Original

## The ask

Dean, 2026-09-25 (his words): "Can we do 7 more click skins. Additional iconic ones." Then, on the
candidate sheet: all 13 picked, confirmed "All 13". Mid-build: "One last thing. Anyway to make one
special Original skin which includes the entire vibe of the first?"

## Decisions

| ID | Decision |
|---|---|
| D1 | Dean's words above: more iconic Click colorways. |
| D2 | Dean picked ALL 13 candidates from the side-by-side sheet (research below), then confirmed "All 13 (Recommended)" over narrowing to 7: 25 skins total. |
| D3 (standing, v1.332 AC4/AC8/AC12) | A colorway is one registry entry in `public/js/music-skins.js`, ONE `.mms-ipod-<colorway>{ --pk-c-* }` role block in `public/css/style.css` setting every role (including `--pk-c-lita-glow` / `--pk-c-lita-core`), and a Settings blurb. Every other list derives from the registry; no sibling list is hand-edited. |
| D4 (v1.332 D5, RE-DECIDED) | v1.332: "Nano rainbow declined." Research this session (the invalidation rule): outside the Nano only four candidates are clearly new looks (the 1st-gen minis and the mini silver, body dE 16-27 against the nearest built skin); the rest measure dE 2.6-4.6 from White / Matte. Asked with that finding, Dean picked all six Nano colors (Purple, Yellow, Lime, Blue, Hot Pink, Raspberry). Each is the Nano's body color on the Click chassis (a white wheel, the center in the body color); the Nano's proportions (a larger wheel, a larger center hole) are structure and are NOT copied. |
| D5 (standing) | No brand or trademark names in labels (Encore is the pattern). No brand editions. Labels are the builder's (below). |
| D6 (standing) | Each look is built from a real photo (Wikimedia Commons, cited, never committed), balanced on the wheel (or the white body where the wheel is the variable), values cited per role; the screen palette is shared by every colorway. Dean judges "does it look like the thing" (LESSONS 7). |
| D7 | One plan, one gate (adversary + qa, fresh), at most two rounds; release v1.335.0. |
| D8 | Orange (4th-gen nano) is left out: the only photo clips and its orange reads as the same yellow. No gold mini exists on Commons or Flickr CC (searched again; disclosed). |
| D9 (Dean) | A special **Original** skin with "the entire vibe of the first" iPod (2001): ALL of (a) the separate button ring around the wheel in four arcs (lowercase "menu" top, back / forward on the sides, play/pause at the bottom), (b) the grey-green monochrome LCD - black text, no album art, the black inverted bar on the selected row, the outlined progress bar, the small battery - on every level (Now Playing, menus, Settings, About), (c) an open-licensed pixel font (Apple's own cannot ship; the license cited; without it the app font in bold), (d) the wheel turns: its grip marks rotate under the thumb while scrolling. |
| D10 (Dean) | The Original REPLACES candidate 5 (the plain 2001 recolor): 12 colorways + the Original = 25 skins. |
| D11 (Dean) | Same release, built LAST: the 12 colorways first (built and measured), then the Original; one gate covers both. |
| D12 | The Original is structure, so it is NOT a colorway block: it gets a separate LOOK axis (a registry field, e.g. `look: 'original'`, that the engine turns into ONE class on the panel), and every structural rule keys on that look class, never on a colorway class. The AC4 census stays: colorway classes carry only their one role block; the look class is a documented, separately censused axis. Its colors are still ONE role block (`.mms-ipod-original`), plus the look's screen tokens. |

### Labels (the builder's; the Click (X) pattern, no product names)

| # | Candidate | id | Label |
|---|---|---|---|
| 1 | mini, silver | `ipod-frost` | Click (Frost) |
| 2 | mini 1st gen, blue | `ipod-sky` | Click (Sky) |
| 3 | mini 1st gen, green | `ipod-olive` | Click (Olive) |
| 4 | mini 1st gen, pink | `ipod-blush` | Click (Blush) |
| 5 | the 2001 original (D9-D10) | `ipod-original` | Click (Original) |
| 6 | fourth gen, 2004 | `ipod-2004` | Click (2004) |
| 7 | classic black, 2007 | `ipod-charcoal` | Click (Charcoal) |
| 8 | nano 4th gen, purple | `ipod-violet` | Click (Violet) |
| 9 | nano 4th gen, yellow | `ipod-yellow` | Click (Yellow) |
| 10 | nano 2nd gen, green | `ipod-lime` | Click (Lime) |
| 11 | nano 2nd gen, blue | `ipod-cobalt` | Click (Cobalt) |
| 12 | nano 2nd gen, pink | `ipod-magenta` | Click (Magenta) |
| 13 | nano 3rd gen, pink | `ipod-raspberry` | Click (Raspberry) |

## Research

**Method.** Wikimedia Commons (and a Flickr CC pass for gold), fetched through the API with a
User-Agent, 960 px thumbs, never committed. Each photo is neutralized on its wheel (per-channel gain
to neutral) and exposed so the wheel reads as Click (White)'s grey wheel (203) or a white wheel (238);
for the white iPods the white BODY is the neutral (246), since the wheel is the variable. Bodies are
p15/p50/p85 (or p05/p95) luminance bands of boxes drawn on the photo and checked by overlay. The
sheet (each photo beside the candidate rendered by the real engine and the nearest built skin) was
sent to Dean 2026-09-25. Distances are CIE76 dE on RENDERED pixels, candidate vs nearest built skin.

| # | Reference (Commons) | License | Sampled (balanced) | dE vs nearest built |
|---|---|---|---|---|
| 1 | "Ipodminicroppedpng.png" (Drago124); cross-check "Ipod mini 1G.jpg" | CC BY-SA 4.0 | body p95 #c7c8cc .. p05 #828387, wheel #cbcbcb, labels #9b9ba2, center #cecece (the wheel grey) | Silver: body 17.1, center 19.0 |
| 2 | "Apple iPod mini blue-2005-03-07.jpg" (angled, the body clips: white-balanced only, the weakest reference) | CC BY 2.0 | body p90 #9fd5e5 .. p10 #80b3c2, labels #82888a | Blue: body 27.3 |
| 3 | "Green ipodmini 1stgen.jpg"; cross-checks "Ipod-Pong.jpg", Flickr 5359785 | public domain | body p95 #879c46, p50 #798b39, p05 #424e0a, labels #8b938d | Green: body 16.1 |
| 4 | "Don't steal music. - Flickr - Trinity.jpg" (in box, film on); cross-check "Lightmatter ipodvsmini.jpg" | CC BY-SA 2.0 | body p85 #cb99a3, p50 #a5737e, p15 #9e6d7b, labels #969493 | Pink: body 21.1 |
| 5 | "IPod1stWIKIPEDIA.png"; cross-check "IPod 1Gen.jpg" | CC BY-SA 4.0 | body #f7f7f7 .. #cdcdcd, wheel #e0e0e0, labels #adadad, center #e6e6e6 | White: body 3.5, wheel 8.9 |
| 6 | "Japanese Apple iPod 4G 20GB.jpg"; cross-check "Ipod photo.jpg" (PD) | CC BY-SA 3.0 | body #fefeff, wheel #c5c6cc, labels #c0c1c2, center #fafafa | White: body 2.6, wheel 4.0 |
| 7 | "IPod Classic 6th Generation Black.jpg" | CC BY-SA 3.0 | body p95 #666668 .. p05 #2e2e2f, wheel #2c2c2c, center #49494b, labels white | Matte: body 4.6, center 11.4 |
| 8 | "Ipod rainbow (3178103957).jpg" (an Apple Store wall); "Ipod Nano 4G 20080911.JPG" reads bluer (#4453c2) | CC BY 2.0 / CC BY-SA 3.0 | body p50 #765edc (p90 #a879fb, p10 #5237a2), labels #babebf | new hue |
| 9 | the same wall photo (the top clips) | CC BY 2.0 | body p50 #ebe434 | new hue |
| 10 | "The nano free from its cardboard bonds (466409731).jpg" | CC BY 2.0 | body p95 #c0e473, p50 #bbde6f, center #a9ca61, labels #a9b2b8 | new hue |
| 11 | "IPod Nano (2259010671).jpg" (light tent) | CC BY 2.0 | body p95 #0097fb, p50 #015eb1, center #004fa5, labels #929797 | Blue: vivid vs teal |
| 12 | "Ipod-nano-2g-rosa.jpg" (flash) | CC BY 2.5 | body p85 #cd1e8c, p50 #c51682, center #bc157f, labels #b6b896 | Pink: far hotter |
| 13 | "Ipod nano red.JPG" (the uploader says RED; reads raspberry beside a 2007 RED) | CC BY-SA 3.0 | body p85 #e3437b, p50 #b82a52, center #d23870 | Red: pinker, darker |

No usable photo: a gold mini (Commons and Flickr CC, ~300 results screened), a front-on 1st-gen blue
mini (only the angled one), a front-on 2008-09 black classic, a front-on 4th-gen nano in orange.

## Design

**Step 1 - the 12 colorways.** Each is D3's three edits. Mini and Nano bodies use the v1.332 mini
stack (a top highlight line, darker sides, a vertical ramp from the sampled bands); the 2004 and
Charcoal use the White / Matte stacks. Wheel roles: the mini grey (#d3d3d2 / #c4c4c2) for the minis,
a white wheel for the Nanos (#f3f4f3 / #e3e5e4), the sampled values for 2004 and Charcoal. Centers:
the wheel grey (minis), the body color (Nanos, 2004's white, Charcoal's grey). The lighting roles
(`lit`, `lits`, `lita`) follow each body's lightness, as in v1.332. Labels are tuned side by side
against the photo during the build (the first renders were paler than the photos).

**Step 2 - the Original (D9-D12).** Designed after reading the engine (renderIpod, the screen, the
menus, Brick, lighting, the sticker, the tray); the design section is completed before Step 2's code.

## Acceptance

- **AC1 Twelve colorways, two places each.** 12 registry entries, 12 role blocks (every role set),
  12 blurbs; nothing else names a new colorway (the AC4 census, AC8's derived lists). Menus, Brick,
  lighting (Subtle, Pronounced, Ambient), the tray and pop-out chips reach each one with no other edit.
- **AC2 Matches the photos.** A side-by-side per colorway (photo, render, values cited) for Dean and
  the gate; Dean judges the look.
- **AC3 Off byte-identical for the 12 existing skins.** `scripts/pocket-render-probe.js` with four
  LIGHTS, base (main @bf0b2b8b, frozen) then branch; every element-style diff classified by script;
  the pixel delta reported against two runs of one tree unless it is 0/0.
- **AC4 Pickers measured.** `scripts/skin-chips-probe.js` before (base, 12 skins) and after (25):
  no pre-existing chip or card changes size (rows wrap, buttons never shrink); the growth in rows and
  scroll reported per surface and viewport (disclosed under #280 (a) / #281 (b), no redesign).
- **AC5 The hard-coded list tests** (`music-skins.test.js` IDS x2 + labels, `pocket-design-system.test.js`
  COLORWAYS, `music-pocket-menus.test.js` IDS -> menuStyle, `seattle-removed-census.test.js` AC1 labels) updated with intent preserved, never widened.
- **AC6 The Original** (D9-D12): its criteria are written with Step 2's design.
- **AC7** `npm run lint:css` 0, overlay containment 0, full `npm test` green on Node 22.23.1 and 24.20.0.

## Status log

- 2026-09-25: plan created on `feat/v1.335-click-colorways` from main @bf0b2b8b (v1.334.0).
- 2026-09-25: research done (61 references screened by a helper, 13 candidates sampled and rendered);
  the sheet sent; Dean picked all 13, confirmed all 13, then asked for the special Original (D9-D12).
- 2026-09-25: baselines on the frozen base tree (.claude/worktrees/v1335-base @bf0b2b8b): pocket-render-probe
  with LIGHTS=off,subtle,pronounced,ambient (1242 files, exit 0); skin-chips-probe (81 lines, exit 0).
- 2026-09-25: Step 1 built - 12 registry entries, 12 role blocks, 12 blurbs; the list pins updated with
  intent preserved (music-skins IDS x2 + labels, music-pocket-menus IDS -> menuStyle, pocket-design-system
  COLORWAYS, and seattle-removed-census AC1's live-labels pin, which the pre-commit suite caught: 7439/7440).
  Rendered from the real classes: 11 pixel-identical to the candidates Dean picked, ipod-2004
  2443 px (max 47) = its labels re-measured light (#efeeee; the first pass took the darkest tenth, which on
  a label LIGHTER than its wheel is the wheel). All 12 lit under Pronounced. lint:css 0, overlay 0;
  targeted unit 210/210 + music-skins 40/40, integration music-skin-integration + music-pocket-menus 19/19.
