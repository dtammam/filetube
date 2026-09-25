---
plan: pocket-lighting-ambient
harness: v2 · lean
branch: feat/pocket-lighting-ambient
anchor: spec
status: Building
next: build Step 1 (Ambient strength, failing tests first), then Step 2 (sticker menu), then the probes, then the gate.
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
  by the light. Measured cost: the lighting probe's per-frame numbers, Ambient vs Pronounced (Step 3).

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
- AC5 Performance: the lighting probe's per-frame task/style/layout time, Ambient vs Pronounced.
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

## Deviations
- B2 refined: the Lighting chips also hide on a tray BODY (`body.mms-tray`) with no tray hook - the
  plain-window pop-out fallback never reported itself as a tray to the sticker (v1.332 showed all 12
  skins there too, measured), and the tray is never lit.
