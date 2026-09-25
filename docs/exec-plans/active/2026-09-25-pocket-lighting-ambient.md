---
plan: pocket-lighting-ambient
harness: v2 · lean
branch: feat/pocket-lighting-ambient
anchor: spec
status: Building
next: the gate (adversary + qa, fresh) at the plan-commit sha; then the release.
design: "Approved 2026-09-25 (Dean in this session: the candidate pick, the menu-fit ruling and the two device answers below)"
gate: pending
---

# Pocket lighting "Ambient", and a sticker menu that fits

## The ask (Dean, 2026-09-25, after testing v1.332 on his iPhone: "It's all fantastic")

**Ambient.** "I want to make a new lighting thing for the iOS called Ambient ... basically a copy of the
pronounced, but I just want us to work on the gradient, the texture ... It just ever so slightly feels
too digital. I don't mind the streak. I don't mind the direction ... I want it to be more realistic.
Not in terms of shadow in a room, not in terms of the mechanics, but just like in the look and the
feel ... Subtle is a little too little. [Pronounced] is appropriate ... the wheel looks awesome ... But
something about the way that it hits the rest of the color just feels like too unrealistic, almost
cartoony. But I like it. And I don't want to spend another bad branch experimenting in something
that's going to be wasteful like I did in [v1.329]." Mid-research, on the first renders: "Very, very,
very obviously digital. Maybe it's the fact that it's like a perfect line. It's a perfect um,
reflection ... Like the shape is good, but maybe the consistency is bad."

**The sticker menu.** "I can't scroll in the extras menu. We have brick there. I don't think we need
it to be there. And I think we could add lighting there as well. So we don't have to go to a menu
and make it scrollable."

## Decisions (D = Dean's words / rulings; B = the builder's, disclosed)

| ID | Decision |
|---|---|
| D1 | Ambient is a 4th strength: Off / Subtle / Pronounced / Ambient; Off stays the default. ADDITIVE ONLY: Off, Subtle and Pronounced byte-identical; a revert = removing one option. |
| D2 | Unchanged: the mechanism (pocket-lighting.js tilt -> --lx/--ly/--lm, the glide, the first-tap ask), the streak's direction and travel, the wheel and its reaction. Ambient changes only how the light meets the BODY color. |
| D3 | Dean picked candidate **4, "Satin sheen"** (2026-09-25, from the side-by-side sheets): the body's reflection tinted by the colorway, uneven along its length (brightest in one area, fading toward the ends, never a ruled line), a softer core, a tinted room light with an eased falloff, and a fine static grain on the body. |
| D4 | The sticker menu's Brick row goes (Brick stays at the pocket menus' Extras > Games > Brick). |
| D5 | Lighting joins the sticker menu as four chips (the active one checked), the SAME driver call as Settings > Lighting (the tap asks iOS for motion access). |
| D6 | Dean (2026-09-25): **Skin moves to its own page** - page 1 carries a "Skin" row naming the active skin that opens the chips (the Extras pattern); the Lighting chips sit on page 1. Home stays the first row. |
| D7 | The "can't scroll" diagnosis, confirmed by Dean's two answers (2026-09-25): the top of the menu is cut off above the screen (yes) and his sticker is 2x. |
| B1 | Glass streak, dome and wheel under Ambient: Pronounced's, unchanged (D2; Dean did not flag them). |
| B2 | The sticker's Lighting chips show on any surface where the driver can light the skin (a Click colorway, the driver loaded), the pop-out included (its Settings > Lighting row already exists there and the pick is device-local), never in the Nano tray (the tray is never lit). |
| B3 | The tray's sticker menu keeps its inline Color chips (its own short menu; unchanged). |

## Research

### What reads "digital" in Pronounced (public/css/style.css, `.mms-ipod.mms-lit-strong::before`)
1. **Pure white on every body.** The band, core and room light are `rgba(255,255,255,a)` whatever the
   colorway, so on a colored body they DESATURATE it (a milky wash) more than they brighten it.
   Measured on the reference photo (below): a real highlight on red anodized aluminum keeps its hue
   and mostly raises value. White at .30 over Click (Red)'s `#c41424` gives `#d65a66` (S .58, V .84);
   the photo's brightest body is `#fe5164` (S .68, V 1.0).
2. **A perfect line.** One linear-gradient: the same intensity and width along its whole length, with
   straight edges, running off both ends of the body. Dean's own read after the first renders.
3. **Straight-line falloff with kinks** (40 / 46.5 / 48.5 / 49.5 / 51 / 60 %): Mach bands at the stops
   and a hard 1 %-wide core plateau.
4. **Zero micro-texture.** A perfectly smooth fill is a CG tell and bands in 8 bits on the dark bodies.

### The references (Wikimedia Commons; cited, not committed)
- "File:Product Red iPod nano.jpg" (CC BY 2.0), 960 px thumb, 20 px x 12 px medians across the body.
  At y650, left to right: `#ce1017` (hue 358, S .92, V .81) ... `#fc2e38` (S .82, V .99) ... `#fe5967`
  (S .65, V 1.0). At y1400: `#92030f` (S .98, V .57) ... `#fe5164` (S .68, V 1.0). The hue holds at
  353-358 across the whole ramp; the channel that clips (R) clips first, then G/B rise: **a highlight
  on anodized color follows the body's hue and only whitens near its peak.**
- "File:IPod mini blue front 2G.jpg" (CC BY-SA 3.0): the body from `#163b46` (S .69, V .27) to
  `#5eafc4` (S .52, V .77), hue 190-196 throughout - the same rule.
- Micro-texture (the RMS of luminance after a 9 px box blur is subtracted): the anodized body
  2.35 levels (blue mini) and 1.2-3.2 (the red nanos) against 0.67 on the blue mini's plastic wheel.
  **Anodized metal carries a fine grain of about 2 levels; the plastic does not.**
- Why the photos show no line at all: satin (bead-blasted) anodizing scatters a highlight into a soft,
  uneven glow; a ruled line is what a mirror does. Dean wants the streak kept, so Ambient keeps a
  streak with the photo's consistency: soft, uneven, fading along its length.

### Compositing and cost (the no-filter constraint, checked)
- No filter / blur / mask / backdrop-filter / mix-blend-mode / animation anywhere in Ambient.
- The streak is a set of elliptical radial gradients on the ::before layer, which is ROTATED 22 deg
  (the band's own 112 deg direction) inside the same `translate3d` Pronounced uses - `transform`
  only. Its gradients do not read --lx/--ly, so on iOS the layer is rasterised once and only moved
  by the compositor; Pronounced repaints its ::before every frame (its room light's position is a
  calc of --lx). The room light moves to the panel's free ::after, keeping Pronounced's exact
  geometry (so it still repaints per frame, as today).
- The grain is a 64 x 64 luminance-neutral PNG (3,661 bytes, a data URI in one token), tiled at
  32 px as the top layer of the panel's own background: decoded once, static, never re-rasterised
  by the light. (Its per-frame cost was not measured: Dean skipped AC5.)

## Design

### Ambient (Step 1)
- `pocket-lighting.js`: `STRENGTHS` + `'ambient'`, `GAIN.ambient = 1` (Pronounced's travel); `applyLit`
  adds `mms-lit-strong` for pronounced OR ambient and `mms-lit-ambient` for ambient only (gated like
  `.mms-lit`); `clearProps` removes it. No other driver change.
- `music-skins.js`: `LIGHTING_STRENGTHS` + `{ value: 'ambient', label: 'Ambient' }` (Settings > Lighting).
- CSS: three rules keyed `.mms-ipod.mms-lit-ambient` - the panel background (grain + the colorway
  body), `::before` (the rotated satin streak) and `::after` (the room light). Two new colorway ROLES in
  every block (ten): `--pk-c-lita-glow` and `--pk-c-lita-core`, each an `r, g, b` triple read as
  `rgba(var(--pk-c-lita-glow), a)`. The glow is the body's hue at the photo's highlight value; the core
  is the lighter tint the peak whitens toward. The alpha curve is shared (the chassis); a colorway's
  strength lives in its tint (a dark body's reflection is a dimmer tint).

### The sticker menu (Step 2)
- Remove the sticker's Brick row and its click branch (skin-surface.js); the `brick` sticker hook
  stays - it is what feeds the pocket menus' Games entry.
- Lighting chips on page 1 (D5, B2): `data-skin-lighting="<value>"`, `role="menuitemradio"`,
  `aria-checked`; the tap calls the engine's `lighting.choose(v)` synchronously inside the click, then
  re-renders page 1 (and again when the answer is in, if the menu is still on page 1). A denied /
  reduced-motion note shows under the chips.
- Skin on its own page (D6): page 1 row `data-skin-skins` ("Skin" + the active skin's label + ›)
  opens `data-sm-page="skins"`: Back + the chips (unchanged markup and handler). The tray keeps
  inline Color chips (B3).
- The cut-off top (D7): the menu's max-height becomes the space actually above the sticker:
  `min(86vh, 100dvh - both safe-area insets - the sticker's bottom offset - its size - the gap)`, with
  the size class carried on the wrap so the menu reads the sticker's size.

## Acceptance (each binds to a test or a probe number)

- AC1 Driver: `ambient` is a stored strength; it lights with `mms-lit` + `mms-lit-strong` +
  `mms-lit-ambient`; Pronounced never carries `mms-lit-ambient`; Off / a stop / destroy / a dock /
  a hidden document / a skin switch / the tray clear all three (the v1.271 unbind class).
- AC2 Settings > Lighting lists four strengths in order with the check on the active one; the two
  modules' lists stay one census.
- AC3 CSS: the Ambient rules exist, read the two new roles, and carry no filter / blur / mask /
  backdrop / blend / animation (the AC6 lock covers them); every colorway block sets both roles
  (the ROLES lock + value pins).
- AC4 Off / Subtle / Pronounced unchanged: `scripts/pocket-render-probe.js` 0 element-style
  differences and pixels within the probe's measured wobble (two runs of ONE tree first); Ambient
  renders on every colorway (the lighting probe's `--strength=ambient` sheet).
- AC5 Performance: ~~the lighting probe's per-frame task/style/layout time, Ambient vs Pronounced~~ -
  SKIPPED by Dean (2026-09-25: "Skip"); disclosed as unmeasured, his iPhone is the judge. The design
  argument stands unmeasured: Ambient's streak layer reads no --lx/--ly (rasterised once, moved by the
  compositor), where Pronounced's ::before repaints per frame.
- AC6 Sticker: no Brick row; Brick still reachable at Extras > Games > Brick; the Lighting chips
  render only where the driver can light the skin, check the stored strength, and a tap calls
  `choose` with that value inside the click (the motion ask); Skin opens its own page and a chip
  there still switches skins; Back returns to page 1.
- AC7 Fit: `scripts/skin-chips-probe.js` measures page 1 before/after at 390x844, 375x667, 380x700
  (and the standalone 390x797) with each sticker size: page 1 fits without scrolling where it can,
  the menu's top never sits above the top safe-area inset, and a finger pan still scrolls a menu
  taller than its cap; chips never shrink (the button norm).

## Steps
1. Ambient: failing tests (driver classes, the strengths census, Settings rows, the roles lock),
   then the driver, the registry, the CSS, the ten role pairs.
2. Sticker: failing tests (no Brick row, the Lighting chips and their driver call, the Skin page,
   the cap), then skin-surface.js + CSS; update the v1.270 locks and comments.
3. Probes: render-probe identity (Off/Subtle/Pronounced), the lighting probe (Ambient sheet + CPU),
   the chips probe (fit + cap), a real-touch pan.
4. Gate (adversary + qa, fresh, max two rounds), then release v1.333.0.

## Progress
- Step 1 built: driver + registry + CSS + the ten role pairs; tests red on bc889907 (6 failing across
  pocket-lighting / pocket-design-system), green on the branch.
- Step 2 built: no sticker Brick row; Lighting chips; the Skin page; the cap. Five chip tests now open
  the Skin page first (the chips moved, D6); the two v1.270 Brick locks now bind "no sticker row" and the
  Games gate.
- AC7 measured (scripts/skin-chips-probe.js, extended; 390x844 / 375x667 / 380x700 / 390x797 x sticker
  default / 2x / 3x x insets 0/0 and 47/34):
  BEFORE (bc889907): page 1 scrollH 793 everywhere; at 390x844 + a 2x sticker the menu's top sits at
  -3.8 px (no insets) / -37.8 px (47/34 insets): the top rows out of reach - Dean's report reproduced.
  AFTER: page 1 scrollH 593; the top is in reach in all 24 cases (>= the top inset + 6 px); page 1
  fits with no scroll at 390x844 in 5 of 6 (all but 3x + insets: 12 px over), at 390x797 in 4 of 6,
  at 380x700 1 of 6, at 375x667 0 of 6; every case that scrolls pans to its max with a real finger
  pan (Input.dispatchTouchEvent). The Skin page (395 px) fits everywhere. Chips: 12 skin chips keep
  6 rows on the Skin page; page 1 = 8 Speed + 4 Lighting chips.

- AC4 measured (scripts/pocket-render-probe.js, the v1.332 copy frozen for both sides; 940 shots per
  tree: 10 colorways x 2 phones x the levels x Off / Subtle / Pronounced + the pop-out and tray):
  NOISE FLOOR, two runs of bc889907: 10 shots differ, 11,405 px, max channel delta 2 (one shot,
  ipod-green-380x700-07b-chapters-long--subtle, 11,373 px; the rest 1-15 px), 0 element-style diffs.
  BRANCH a4fc6061 vs run A: 30,080 element-style diffs, ALL classified by script: 29,840 inside the
  sticker wrap subtree (the menu is in every shot's DOM, hidden: Job 2's rows, the wrap's size class,
  the cap) and 240 in the Settings > Lighting list (ipm-row / ipm-lbl / ipm-pad: the Ambient row) on
  the 09-lighting level; 0 anywhere else. Pixels: the 09-lighting shots differ by 1,274 px (the new
  row, expected); outside that level 13 shots differ, 1-8 px at max delta 1, plus the same
  green-07b-chapters shot at 11,373 px / delta 2 that wobbles on one tree. Off / Subtle / Pronounced
  are unchanged.
- Full suites on ad375ce3: Node 22.23.1 9,596 / 9,596, Node 24.20.0 9,596 / 9,596 (0 fail, 0 skipped).

## Deviations
- B2 refined: the Lighting chips also hide on a tray BODY (`body.mms-tray`) with no tray hook - the
  plain-window pop-out fallback never reported itself as a tray to the sticker (v1.332 showed all 12
  skins there too, measured), and the tray is never lit.

### Gate r1 - qa

Reviewed `git diff bc889907..7bcfdc23` (16 files), every changed file read. Instruments, run by this seat
on 7bcfdc23 (Node 22.23.1):
- `npm run lint:css`: `TOTAL 0`. `node scripts/overlay-containment-lint.js --enforce`: `clean (0 violations)`.
  `npx eslint` on the 13 changed js files: exit 0, no output.
- Targeted: the six named test files 262 / 262 pass; the other twelve files that touch the sticker / pocket
  menus (music-pocket-menus, -r1, sticker-extras, pocket-home, pocket-quick-scroll, actions-desktop, chapter
  snap/likes/reflect, podcast view, token-scale-lock) 295 / 295 pass.
- Full `npm test` in a /tmp `git archive 7bcfdc23` sandbox: 9,596 tests, 9,582 pass, 8 fail, 6 skipped. All 8
  are the sandbox, not the diff (`fatal: not a git repository` from `git ls-files`, and one EISDIR); their
  seven files re-run in the real repo: 69 / 69 pass. (The builder's own logs for ad375ce3, whose public/ and
  test/ are byte-identical to HEAD: 9,596 / 9,596 on Node 22 and 24, read, not re-run.)
- AC4 checked against the saved runs (rp-baseA / rp-baseB / rp-head1 styles.json): my own classifier finds
  30,080 style diffs, 0 outside the sticker-wrap subtree and the Settings > Lighting rows; the pixel list
  outside 09-lighting is the 13 shots at 1-8 px (delta 1) plus the green-07b shot that wobbles on one tree,
  as the plan says. AC7 checked against chips-before/after.jsonl: every number in the Progress section matches.
- The grain token decoded: a 3,661-byte 64 x 64 grey+alpha PNG, white and black specks at alpha 1-4 only.

Mutants (sandbox, each diff confirmed non-empty, each restored): dropping `mms-lit-ambient` from clearProps
-> AC1 red (bound). Dropping the page-1 guard of the chip's async re-render -> 299 / 299 green (W2). Dropping
`!trayActive &&` from the chip gate -> 138 / 138 green (redundant with lightingHere's body.mms-tray check;
disclosed, not a finding).

**W1 (WARNING) - a sticker Lighting pick leaves the LCD's Settings > Lighting check on the OLD strength.**
public/js/skin-surface.js:1710-1720 (the chip handler) calls `lighting.choose` and re-renders only the sticker
menu; the pocket menu, which draws the same state, is never told. Measured (jsdom experiment, the real engine):
LCD on Settings > Lighting with Off checked, open the sticker, tap Ambient, close the menu -> the panel carries
mms-lit + mms-lit-strong + mms-lit-ambient while the LCD still says "Off" checked, and it STAYS "Off" after a
wheel detent (the cursor moved 0 -> 1, the check did not). The same holds for the note row after a deny. Fix:
after the chip's choose (and again in its `.then`), re-render the pocket menu when its current pane is the
lighting level (the Settings path's own `p2.node.type === 'lighting' && screen === 'menu'` test); bind it with
that exact sequence (LCD on Lighting, sticker pick, assert the LCD check moved) and watch the test go red
without the fix. The v1.41.4 class: two writers of one rendered state, one of them never calls the redraw.

**W2 (WARNING) - the chip's async re-render guard is unbound.** skin-surface.js:1718
`if (lm && !lm.hidden && !lm.getAttribute('data-sm-page')) refreshStickerMenu();` is correct today (verified:
no permission API + coarse pointer, tap Ambient, open the Skin page before the 2 s no-sensor answer, advance the
clock -> the Skin page and its 12 chips survive). Mutated to `if (lm) refreshStickerMenu();` all 299 tests in
the 7 sticker / lighting files stay green, so a later edit that drops it would silently yank a user off the
Skin or Extras page 2 s after a pick (on Extras it also cancels the in-flight fetch). Add that sequence as a
test (Skin page and Extras page) and confirm the mutant goes red.

**S1 (SUGGESTION) - the new `.mms-sm-note` rule is dead.** style.css:11652
`.mms-sticker-menu .mms-sm-note{ font-size:var(--fs-sm); opacity:.7; }` is overridden by the pre-existing
same-specificity rule at style.css:11673 (`font-size:var(--fs-md)`), later in the same top-level scope, so the
Lighting note renders at fs-md (as the Extras notes do) and the comment names an effect that never happens.
Delete the line, or move the size into the later rule if fs-sm is wanted.

**S2 (SUGGESTION) - stale comments.** music-skins.js:374 "the three strengths" (four now, the list is on
line 377). pocket-lighting.js:13 "chosen from the pocket menu's Settings > Lighting; the strength tap is what
asks" (the sticker's Lighting chips choose and ask too). scripts/pocket-lighting-probe.js:23 "the profile to
screenshot" (ad375ce3 made the CPU run use it too), and :21's usage string still says `[--frames N]` while
the parser and the edited header say `--frames=N`.

**S3 (SUGGESTION) - accessibility of the page switch.** Verified: after the Skin row, after Back, and after a
Lighting chip, `document.activeElement` is BODY (innerHTML replaces the focused button). Pre-existing on
Extras and the Speed chips, but D6 now routes every keyboard / VoiceOver skin change through it: focus the Back
button in openStickerSkins and the Skin row on the way back. Also, Speed and Lighting are both
`menuitemradio` sets in one `role="menu"` with no `role="group"`, so assistive tech sees one radio set with two
checked items (the same shape Speed + Skin had on page 1 before; wrap each set in `role="group"` with an
`aria-label`).

**Security.** No new network surface: no fetch, no route, no dependency. Every new interpolation is escaped
(`escapeHtml` on the strength value and label, the driver note, the active skin label; the skin ids as before)
and every source is a module constant or the registry. The data URI is a static PNG in a CSS custom property
(no script context). The probes pass argv values into page script only through `JSON.stringify` (developer-run,
local). Nothing to escalate.

**Checked and clean.** Off / Subtle / Pronounced classes untouched (applyLit toggles strong for pronounced or
ambient, ambient only for ambient; AC1 binds Pronounced never carrying it). Every teardown arm clears the new
class (clearProps is the single remover; mutant red). The `::after` is free on the panel (no other panel-level
`::after` rule). The cap: the tray's `body.mms-tray .mms-sticker-menu{max-height:none}` (0,2,1) outranks
`.mms-sticker-wrap > .mms-sticker-menu` (0,2,0); the desktop /music actions menu sits in `.music-actions-wrap`,
so the cap cannot reach it; a browser without `dvh` drops the declaration and keeps the old 86vh. The wrap's
size class only re-states `--mms-sticker-px` and the emoji size its own button already carries. Brick stays
reachable (menuGames, main document only; the ipod-brick locks bind it). Shell parity: all 10 shells that load
skin-surface.js load pocket-lighting.js and music-skins.js. No other copy of the strength list or the sticker
rows exists in public/, scripts/ or test/ (the render probe's `__light` mirror was updated). No em dashes in
the diff.

Tree: `git status` clean before this section; this section is the only change.

Gate: CHANGES r1 @7bcfdc23 - qa

### Gate r1 - adversary

Reviewed `git diff bc889907..7bcfdc23` at HEAD 7bcfdc23. Every number below was produced by this seat.
Instruments:
- Full `npm test` in a scratch `git clone` checked out at 7bcfdc23 (a real git repo, so the git-dependent
  tests run): Node 22.23.1 9,596 tests, 9,590 pass, 0 fail, 6 skipped; Node 24.20.0 9,596 tests, 9,590 pass,
  0 fail, 6 skipped. The 6 skips are environmental (3 "tools/capture playwright not installed", 3 "no ffmpeg
  binary"), not the diff; the plan's "0 skipped" is the builder's machine. `npm run lint`: 0 errors, 6
  warnings, the same 6 as on bc889907. css-token-lint `TOTAL 0`; overlay-containment `clean (0 violations)`.
- AC4 re-derived from the saved runs with my own classifier and my own PNG decoder: styles baseA vs baseB 0
  diffs; baseA vs head1 30,080 diffs = 29,840 inside the sticker-wrap subtree + 240 in the 09-lighting rows,
  0 elsewhere; every level's Off / Subtle / Pronounced styles differ from each other (300 / 300 levels, so the
  lit shots are not vacuous). Pixels: noise floor (A vs B) 11 shots / 11,409 px / max delta 2; A vs head1: the
  60 09-lighting shots, plus 13 shots outside it at max delta 2 (the green-07b wobble 11,373 px, the rest 1-8
  px at delta 1). public/ is byte-identical between a4fc6061 (the shot tree) and 7bcfdc23. The probe's
  `__light` copy matches applyLit's lit-state class sets for all four strengths.
- Ambient in the REAL app (my own CDP script, real server, the REAL driver lighting the panel from
  `ft-pocket-lighting`, 390x844): all 10 Click colorways get mms-lit + mms-lit-strong + mms-lit-ambient; the
  grain is in the computed background-image on all 10; the panel's `::after` is `content:none` under Off and
  Pronounced (free); the panel is `position:fixed; z-index:1100; overflow:hidden` (its own stacking context,
  so the `z-index:-1` layers sit over the body). Ambient vs Pronounced at neutral differs by 158k-176k px on
  every colorway (none is a no-op). Shots at --lx/--ly = (+-1, +-1) on all 10 show no layer edge; by geometry
  the `::after` edge stays >= 1% of the panel outside it with its gradient already at 0 there, and every
  `::before` ellipse reaches alpha 0 inside its layer, so the rotation cannot expose an edge.
- AC7 re-run (`scripts/skin-chips-probe.js` on 7bcfdc23, 390x844 / 375x667 / 380x700 / 390x797): all 24
  page-1 cases have the top in reach (top = inset + 6 px wherever capped); the fit counts match the plan
  (5/6, 4/6, 1/6, 0/6); every scrolling case pans to its max with a real finger pan (one 188 / 189). The tray
  menu keeps `max-height:none` (xywh 6,6,298,121 in a 310x133 window).
- One tap, one ask (jsdom, the real engine, iPhone shape, the first-tap ask armed at paint): the tap that
  opens the sticker consumes the first-tap ask (1 ask); the Ambient chip tap then asks once (1). The Settings
  > Lighting row has the same click ordering, so the chips are no worse.
- Brick: the saved head1 run mounted `.ipod-brick` from Extras > Games > Brick in 20 / 20 shots; no live
  reference to `data-skin-brick` / `brickRow` remains outside comments.

Mutants (sandbox from `git archive 7bcfdc23`, each diff confirmed non-empty against a pristine copy, each
restored). Red (bound): clearProps without mms-lit-ambient; strong for pronounced only; ambient class always
false; ambient class on pronounced; a filter / `-webkit-backdrop-filter` / `MIX-BLEND-MODE` /
`-webkit-animation` on a lit rule; the streak reading --lx; the grain dropped; a role dropped from Click
(Red) or Click (White); a role value changed by 1; lightingHere without the tray-body check or the Click
check; choose() deferred out of the click; the Skin page without its data-sm-page; no re-render after the
answer; the wrap without its size class. Green (survivors): listed in the findings.

**W1 (WARNING, blocking) - the lit gate on the new class is unbound.** pocket-lighting.js applyLit:
`panel.classList.toggle('mms-lit-ambient', lit && s === 'ambient')`. Mutant: drop `lit &&` -> pocket-lighting
+ pocket-design-system 26 / 26 green, and no other test file names an mms-lit class. The consequence is the
gate r2 qa W4 class on Dean's own device: on an iPhone (permission API, no fine pointer) the panel must stay
unlit until the first sample of the session; under the mutant it carries `mms-lit-ambient` ALONE (measured,
jsdom: className `... mms-ipod mms-lit-ambient`, `lit:false`), and because `.mms-ipod.mms-lit-ambient::after`
sets its own `content` and `.mms-ipod.mms-lit-ambient` sets the grain, neither needs `.mms-lit`: a still,
lit-looking room light + grain after a relaunch whose grant iOS forgot. Today's code is correct (the same
check is green on HEAD). Fix: bind it (boot `{ strength: 'ambient', finePointer: false, permission }`, paint,
assert no mms-lit-ambient before the first sample; it goes red under the mutant, verified); optionally key
the three Ambient rules on `.mms-lit.mms-lit-ambient` so the CSS cannot light without the base class.

**W2 (WARNING, blocking; independently confirms qa W1) - a sticker Lighting pick leaves the LCD's Settings >
Lighting check on the old strength.** Measured (jsdom, real engine): LCD on Settings > Lighting with Off
checked, sticker, tap Ambient -> stored `ambient`, panel carries all three classes, the LCD check still
reads `Off`. qa's prescription (re-render the pocket menu when its pane is the lighting level, bound by that
sequence) stands.

**W3 (WARNING; resolvable by disclosure) - B3 "the tray's sticker menu keeps its inline Color chips
(unchanged)" is false for the plain-window pop-out tray.** Measured with the skin-chips-probe tray line:
bc889907 `n 12, rows 6` (all 12 skins inline); 7bcfdc23 `n 0, rows 0` (a Skin row that opens the page). That
fallback has no tray hook, so `trayActive` is false and it takes the phone path, although `lightingHere`
already treats `body.mms-tray` as the tray. The probe printed it; the plan's AC7 does not report it. Either
make `skinSec` treat `body.mms-tray` as the tray too, or record the change under Deviations (Dean's call).

**S1 (SUGGESTION; confirms qa W2) - the async re-render's page guard is unbound.** Mutant
`if (lm) refreshStickerMenu();` -> 254 / 254 green over the five sticker files; with it, a pick on a
no-permission-API touch device, then the Skin row, yanks the menu back to page 1 when the 2 s answer lands
(measured: `before "skins"`, `after null`). Low reach (not iOS), cheap to bind.

**S2 (SUGGESTION; confirms qa S1) - the new `.mms-sm-note{ font-size:var(--fs-sm) }` is dead.** Measured in
Chromium: the note computes 14px (= --fs-md; --fs-sm = 12px); the pre-existing rule at style.css:11673 wins.

**S3 (SUGGESTION) - the no-filter lock still misses mask siblings.** The AC6 regex
`(?:-webkit-)?(?:filter|backdrop-filter|mask(?:-image)?)\s*:` lets `-webkit-mask-box-image:url(m.png) 10`
and `mask-border:url(m.png) 10` through on the Ambient `::before` or `::after` (26 / 26 green each), and
`-webkit-box-reflect` too. Pre-existing (v1.327) and nothing ships one, but this round extended the regex
(blend / animation) without closing the sibling spellings (the v1.313 lesson). Widen to `mask(?:-[\w-]+)?`
and add `box-reflect`.

**S4 (SUGGESTION) - redundant guards, disclosed.** Survivors with no reachable consequence: `!trayActive &&`
on the chip row (lightingHere's body check already hides it), `if (lightingHere())` in the chip click (the
chips only render where it is true, and the menu closes on any skin pick), `extrasMenu.cancelPending()` in
openStickerSkins (page 1 is never showing while an Extras fetch is in flight: every road back to page 1
passes refreshStickerMenu, which cancels; and stillOnPage checks `extras`). Keep or drop; not findings.

**Suspicions (unmeasured, labeled as such; AC5 stays skipped).** (a) Ambient holds TWO composited layers of
1.7 x 1.7 the panel (`::before` inherits will-change from `.mms-lit::before`; `::after` sets its own), about
34 MB each at 390x844 @3x, where Pronounced holds one; the per-frame repaint area is the same as Pronounced's
(the room light moved, it did not multiply). (b) The rotated `::before` is a 2D transform on an
already-composited layer with no filter / mask / blend, so it should not be the black-video class, but no
WebKit or iOS run backs that here.

Tree: `/home/coder/projects/filetube` untouched by this seat apart from this section (appended after qa's,
which was already present and uncommitted); all mutation and scratch work ran in the scratchpad.

Gate: CHANGES r1 @7bcfdc23 - adversary
