---
plan: click-colorways-seven
harness: v2 · lean
branch: feat/v1.335-click-colorways
anchor: spec
status: Build
next: the gate (adversary + qa, fresh) on the committed tip.
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

**Step 2 - the Original (D9-D12).** References: Commons "IPod1stWIKIPEDIA.png" (CC BY-SA 4.0, front-on)
and "IPod 1Gen.jpg" (CC BY 4.0, a real lit LCD; the white body the neutral, exposed to 246).
Measured on "IPod 1Gen.jpg": the LCD #c2c5b1 .. #cfd1b9 (a cool grey-green), the selection bar a taupe
with light text (#dde4cf), the ink the photo's darkest (#716c61, a soft camera read of a near-black);
the ring #feffff, the inner wheel #f9f9f5, the center #fefefe.

- **The look axis.** A registry field `look: 'original'` on `{ id: 'ipod-original', label: 'Click (Original)',
  base: 'ipod', look: 'original', menus: 'click', renderFull: renderIpod }`. The engine's ONE className
  writer (`skin-surface.js` paint) adds `mms-look-<look>` when the entry has one - so the phone, the
  desktop pop-out and the Nano tray (the same engine) all carry it. Every structural rule keys on
  `.mms-look-original`; the colors stay ONE `.mms-ipod-original` role block (the census unchanged).
  The markup is renderIpod's, unchanged: the ring, the disc and the gaps are CSS on the existing wheel.
- **The screen.** (Revised in the build - see the status log: the palette tokens are contract-locked to
  ONE value each, token-scale-lock.) Every rule inside the glass now reads SCREEN roles (`--pk-s-*`:
  paper, ink, the selection pair, sub, the status-bar pair, hair, line, groove, art shadow, the battery
  set, the jump backdrop), defined once on the chassis structure block as exactly their palette tokens,
  so every other skin computes identically. Under `.mms-look-original .ip-lcd-in` the ROLES are
  re-pointed to the look's LCD tokens (`--pk-o-*`), so every level - Now Playing, the queue list, every menu, Settings,
  About, the A-Z picker, Brick's own backdrop - turns monochrome with no per-level rule; the token
  scope stops at the LCD, so the sticker, the menus' chrome outside the glass and the body are
  untouched. A few structural rules: no cover art (the cover and the menus' art pane hidden, the list
  full width), the Now Playing text centered, no stars, the scrubber an outlined bar with an ink fill,
  the battery ink.
- **The font.** Jersey 10 (SIL OFL 1.1, (c) 2023 The Soft Type Project Authors), subset to latin, as
  `public/fonts/jersey10.woff2` with an `@font-face` beside Geist / Roboto and a README entry (the Geist
  precedent). Only the Original's LCD names it, so no other skin downloads it (no preload). Its sizes
  stay the chassis type roles; `font-size-adjust` scales the condensed face (x-height .429 em) to .64 so
  its lettering fills the rows as on the photo (tuned on the side-by-side); the overflow rule still holds (every line one line tall; `scripts/skin-status-bar-probe.js`).
- **The ring.** On the Original the wheel's own background (the role gradient, lit as today) is the RING;
  `::before` draws the four gaps (two thin diagonals, fixed); `::after` draws the inner scroll wheel (a
  disc at ~70 %, a thin rim) BELOW the zones and the center button (`isolation:isolate` on the wheel
  only - a small container, LESSONS 6 - and the two pseudo layers at z -1). "menu" is lowercase by
  `text-transform`.
- **The wheel turns.** The spin handler (`st.onMove`) accumulates its signed angle into one engine
  variable and writes `--ip-turn` on the PANEL (so a repaint keeps it) - only for a skin with a look
  (never for the other 24: their style attribute is unchanged). The disc layer rotates by it
  (`transform` only; no filter, blur, mask). The real 1G wheel is smooth plastic, so a turning disc is
  invisible without marks: the disc carries FAINT tick marks near its rim (disclosed; Dean judges).
  Under `prefers-reduced-motion: reduce` the disc does not turn.
- **Everything else derives**: menus, lighting, Brick, the sticker, the tray and pop-out chips (it is a
  Click colorway by `menus`).

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
- **AC6 The Original** (D9-D12):
  - (a) the registry entry has `look: 'original'`; the panel carries `mms-look-original` for it and for no
    other skin (engine test through the real paint; mutant: drop the class write -> RED);
  - (b) the ring, the gaps, the disc and lowercase "menu" render (side by side with the photo);
  - (c) the monochrome LCD on every level (Now Playing, queue, each menu level, Settings, About, the
    A-Z picker, Brick) and in the pop-out and tray: screenshots; no blue selection, no art;
  - (d) the font is bundled (OFL cited), declared once, named only by the look;
  - (e) a rotation writes `--ip-turn` on the panel for the Original (it grows with the turn) and never
    for another skin; the disc's transform reads it; reduced motion drops it (bound; mutants RED);
  - (f) the status-bar / overflow probe: every line one line tall on the Original at 390x844 and 380x700;
  - (g) the census: every rule naming `mms-look-original` is in the look's section; AC4 still green.
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
- 2026-09-25: Step 1 committed dfe24de6 (the pre-commit unit suite 7440/7440; it caught one more list
  pin, seattle-removed-census AC1, updated with the rest).
- 2026-09-25: Step 2 built - the Original: registry `look: 'original'`, the engine's class + `--ip-turn`
  (skin-surface.js), ONE `.mms-ipod-original` role block, the look section (tokens, the glass re-points,
  the ring / gaps / disc, lowercase menu), Jersey 10 (12 380 bytes, OFL) + README, the blurb.
  Font choice: Jersey 10 over Pixelify Sans, Silkscreen and DotGothic16, side by side against the
  "IPod 1Gen.jpg" LCD (closest to its condensed bold lettering). An old lock went red and was complied
  with, not widened: pocket-design-system AC5 "tokens defined ONCE on the chassis" - the look first
  redefined the --pk-fs-* sizes; now it leaves them and sets `font-size-adjust:.53` (Jersey's x-height is
  .429 em, Geist's / Roboto's .53, measured from the fonts), and the lock gains the look family (--pk-o-*,
  one block, never a chassis token; the chassis never a look token). New test file
  pocket-original-look.test.js 8/8. Probe: pocket-render-probe ipod-original, 390x844 + 380x700, Off +
  Pronounced: 66 files, every text line 1 line (30/30), no spills, no page errors; every level
  monochrome incl. Brick, the pop-out and the tray. The turn: the disc at 0 vs 25 deg differs in 38 799
  device px, all inside the wheel box. lint:css 0, overlay 0; related unit 253 + integration 19 green.
- 2026-09-25: the first Step 2 commit attempt was REFUSED by the pre-commit suite (7447/7448):
  token-scale-lock "every new-layer token is defined EXACTLY ONCE with its contract value" - the look
  re-pointed contract palette tokens (--mms-white and 15 more) inside the glass. Complied, not widened:
  a SCREEN-role layer (--pk-s-*, 16 roles on the chassis, each exactly its palette token); 57 reads in 38
  glass rules moved onto the roles by script (comment-masked; Brick's backdrop caught on a second scan
  after a comment with braces hid it); the look re-points the roles, not the tokens; the center rim is a
  look rule (`var(--mms-lit-dome-shadow, var(--pk-o-center-rim))`) instead of a redefined token. Locks
  updated in lockstep with intent kept: music-skins v1.233 cursor bar (reads --pk-s-sel1 AND the chassis
  role is the blue token), pocket-design-system AC5 (the screen-role family: chassis + the glass only,
  each chassis role exactly a palette token), pocket-original-look (b)/(c). NEW census (pocket-design-
  system): no rule inside the glass reads a wrapped palette token, the glass classes DERIVED from the
  renderers. Renders: the Original and Click White Now Playing 0 px vs before the refactor.
- 2026-09-26: tuned on the side-by-side before sending: the screen type read small beside the photo, so
  `--pk-o-xh` .53 -> .64; the screen's buttons (.mms-row, .ipm-row, .ipm-gl) now inherit
  `font-size-adjust` too (a button's UA font shorthand reset it - the menu rows had not scaled). The
  overflow probe after: every line 1 line tall (30/30), no spills. Sheets sent (the Original beside its two
  photos, the ring close up at rest and turned 25 deg; the 12 colorways). **Dean: "Ship it."**
- 2026-09-26: measurements on 9c571d49 (Off identical): pocket-render-probe base (main @bf0b2b8b) vs branch,
  the 10 pre-existing Click skins x 4 LIGHTS: 1240 shots, 1219 identical; 130 element-style diffs, ALL
  the 13 new Color chips in the 10 tray menus (classified by script); 0 px on every Off shot; 11 lit shots
  differ at max channel delta 1-2 with 0 style diffs - the two largest (Pink Subtle 380x700 album-long
  8462 px, lighting 11371 px) reproduce exactly base-vs-base (a second base shoot), so render noise.
  The Original's 34 shots identical before/after the screen-role refactor.
- 2026-09-26: skin-chips-probe base (12 skins) vs branch (25), 41 surfaces: 0 pre-existing chips or cards
  changed size. Rows: the sticker's Skin page 6 -> 12 (it FIT on all 18 phone configs; now it scrolls on 16
  of 18 - fits only at 390x844 with the default / 2x sticker and no insets - its top in reach on all 18);
  Settings picker 6 -> 13 (390x844, 380x700), 12 -> 25 (375x667, one column), 3 -> 7 (1280x800); the tray's
  Color chips 6 -> 12 (content 577 -> 877 px in its 119 px window, scrolls). Page 1 unchanged. Disclosed
  under #280 (a) / #281 (b), no redesign.
- 2026-09-26: mutants on 9c571d49 (a /tmp git-archive sandbox, a pristine copy beside it): 15/15 RED -
  the look class, the turn guard, the turn removal on a switch, the reduced-motion stop, a glass rule
  bypassing the roles, the look redefining a palette token, the roles re-pointed on the panel, the
  registry look field, a colorway-specific structural rule, the font-face, the disc not reading the
  turn, a new colorway losing its block, a missing blurb, a chassis role not its token, Brick's backdrop
  bypassing the roles. The pristine sandbox 136/136; the sandbox left identical to the pristine copy.

Gate: CHANGES r1 @48ef515f - qa
  Instruments (Node 22.23.1, run by qa on 48ef515f): full `npm test` 9635/9635 pass, 0 fail (exit 0); targeted
  unit (pocket-*, music-skins, music-pocket-menus, skin-surface, setup-music-skin-picker, seattle-removed-census,
  token-scale-lock) 316/316; music-skin-integration + integration music-pocket-menus(-r1) 167/167; lint:css TOTAL 0;
  overlay-containment clean (0); eslint on the changed JS/tests exit 0. The 57 reads / 38 rules re-derived from the diff.
  - WARNING W1 (public/js/music.js:3987, mountEarlyCover): a SECOND skin className writer, missed. The ?play= launch
    cover (Continue listening) writes `mms mms-full mms-<id> mms-<base>` with no look class, so on the Original the
    launch frame paints Click White's screen (white paper, uppercase MENU, no ring or disc) until the engine's
    paint lands after the track loads, then snaps to the monochrome ring. The plan's "the engine's ONE className
    writer" is false (LESSONS 12, the forgotten writer). Fix: one shared class builder (registry or engine) used by
    both writers, plus a census that every `mms-full mms-` writer carries the look.
  - WARNING W2 (test/unit/pocket-design-system.test.js, the screen census): the glass ROOT is outside its derived
    set (it collects descendants of .ip-lcd-in only). Sandbox mutant `.mms-ipod .ip-lcd-in{ background:var(--mms-white) }`:
    pocket-design-system + pocket-original-look + music-skins + token-scale-lock 59/59 GREEN, yet the Original's whole
    screen turns white. Add .ip-lcd-in to the census set (or pin that rule's paper read) and watch the mutant red.
  - SUGGESTION S1 (public/js/skin-surface.js:1967): the clear keys on the VALUE (`wheelTurn` truthy), not on whether
    the property was written. Sandbox probe: Original, spin +10 then -10, switch to ipod-red -> the panel keeps
    `--ip-turn: 0.0deg`. Invisible, but it breaks AC6 (e) "never for another skin" and the comment at :1378. Track a
    written flag or clear unconditionally on a look-less paint.
  - SUGGESTION S2 (public/fonts/jersey10.woff2 + README): the subset dropped name IDs 13/14 (only the copyright, ID 0,
    survives; geist.woff2 keeps ID 14), and OFL 1.1 asks that the license accompany each copy. Ship an OFL.txt beside
    it or subset with --name-IDs='*'. README otherwise complete (copyright, license, source, subset note).
  - SUGGESTION S3 (skin-surface.js:2509, suspicion, unmeasured): writing an inherited custom property on the PANEL each
    pointermove restyles the whole panel subtree (a 200-row queue); writing it on .ip-wheel (re-applied in paint) scopes it.
  - SUGGESTION S4 (public/css/style.css:12063): "Every color is the Classic palette this skin already carries" is no
    longer true on the Original; name the screen roles. Also Brick paints a fixed #2b3a4a in system-ui on the Original's LCD.
  Security: no new surface. The font is served by the existing express.static under the /fonts/ prefix (no new route);
  --ip-turn is toFixed(1) of a number via setProperty; the blurbs and look class are static registry strings; no network.
  Labels and blurbs: no brand names, no em dashes (0 in added lines).
Gate: CHANGES r1 @48ef515f - adversary
  Instruments (Node 22.23.1, /tmp git-archive sandbox of 48ef515f): targeted unit 186/186; FULL test:unit on the pristine
  sandbox 7441 pass / 8 fail (all 8 are git-dependent source locks failing because the sandbox is not a repo; the same 8
  on every mutant run); lint:css TOTAL 0; overlay clean. Fresh tip shoot, ipod + ipod-black + ipod-gold x 4 LIGHTS x 2
  viewports + pop-out + tray vs the builder's base set: 372 shots, 0 px on every Off shot, 39 style diffs = the 13 new
  tray chips x 3, 14 px at max delta 1 on 6 lit shots (the noise class). Verified: a real CDP touch drag of 60 deg writes
  --ip-turn 60.0deg and the disc computes matrix(0.5, 0.866, ...); under reduced motion it computes none; a sticker pick
  to Cider then Click clears the style. The Original's computed colors inside the glass, 15 phone levels: only the four
  --pk-o-* values plus rgba(0,0,0,.12) (the picker's top line); every line 1 line tall.
  - WARNING W1 (public/js/music.js:3987, mountEarlyCover; same as qa W1, measured): with ft-music-skin=ipod-original,
    /music?play=nd1 at 300 ms RTT shows the panel for 1.8 s (1247 -> 3081 ms) as `mms-ipod-original mms-ipod` with no
    look: LCD rgb(255,255,255), Geist, no ring, uppercase MENU, green battery, blue-grey scrubber (screenshot taken).
    Fix: one class builder both writers call, bound by a test that drives mountEarlyCover.
  - WARNING W2 (the screen census + pocket-original-look; widens qa W2): FOUR sandbox mutants survive the FULL unit
    suite (7441/8, identical to pristine), each visible on the Original (rendered: white glass, blue selection bar):
    (1) `.mms-ipod .ip-lcd-in` paper back to var(--mms-white) - the census collects descendants only;
    (2) respelling with a fallback, `.ipm-row.is-cursor` reading var(--mms-ipod-blue1, var(--pk-s-sel1)) - the regex
        needs `var(--token)` closed;
    (3) relocation, a new `.mms-full .ipm-row.is-cursor{ background:linear-gradient(var(--mms-ipod-blue1), ...) }` - the
        census skips any selector without mms-ipod / ipod-brick / mms-tray;
    (4) 48ef515f's `font-size-adjust:inherit` dropped from the three button rules - nothing pins it (rows shrink 1.49x).
    The census title ("no rule inside the LCD glass reads a palette token directly") also overclaims: .mms-ipod .ipm-grid
    reads --mms-ipod-jump-line directly; only the 16 wrapped tokens are hunted. Fix: include the glass root, match
    `var(--token` with or without a fallback, scope by the derived glass classes rather than the ancestor class, pin
    the inherit; re-run these four and watch them red.
  - SUGGESTION S1 (style.css, the look's button rule): the same UA font reset hits two more screen buttons - measured
    .ipm-letter and .ipm-badge compute font-size-adjust none (Jersey unscaled while the rows are at .64).
  - SUGGESTION S2 (public/js/ipod-brick.js:213/221): Brick paints #2b3a4a in system-ui on the grey-green glass; the
    status log's "every level monochrome incl. Brick" holds for the backdrop only. Dean judges.
  Not measured by me: the other 7 pre-existing Click skins on the tip (the tip's delta over 9c571d49 is look-scoped
  only); Cider / Nordic (untouched by construction); Node 24.
