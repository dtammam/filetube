---
plan: pocket-lighting-reflection
harness: v2 · lean
branch: feat/pocket-lighting-reflection
anchor: spec
status: Built, in gate
next: ONE gate round (adversary + qa) at the sha below, release v1.329.0
design: this document; the research is Dean's doc "FileTube Click skins: making the lighting look physically real" (2026-09-24)
gate: pending
---

# Pocket lighting, third swing: a reflection, not a sheen

Dean on v1.328.0: "It's really good. It's just not 'realistic'. What are we missing?" The research doc
(his link, 2026-09-24) answers with physics; Dean's rulings on it (2026-09-25): Click + Black imitate the
5th-gen iPod (one clear glossy front, the reflection runs unbroken across body and screen), Matte the
Classic (anodized: blurred on the metal, sharp on the glass); the light is gravity-referenced (a fixed
key pose, no opening-pose neutral, no 8 s re-centre); build from the researched numbers now, photos later.

## What changes (the research's plan, adapted to this skeleton)

**Inputs (pocket-lighting.js).** The stable roll/pitch from v1.327 (gravity-projected roll, atan2 pitch,
mapped to screen axes) minus a KEY POSE in screen axes: `KEY_X = -10` deg (off-axis reads natural),
`KEY_Y = 58` deg (a typical 50 deg hold puts the window's lower edge across the upper third of the face).
Reflected angles `ex = 2 (x - KEY_X)`, `ey = 2 (y - KEY_Y)` in degrees. `k = panelHeight / 24` px per degree
(the face spans about 24 deg of view at 350 mm). Written each frame (only when moved > 0.25 px / 0.1 deg):

| Property | Value | Read by |
|---|---|---|
| `--fx`, `--fy` | `ex k`, `ey k` (px) | the body's and the glass's map positions |
| `--dx`, `--dy` | `R clamp(e / (2 beta), -1.3, 1.3)`, beta = 15 deg, R = dome radius px | the dome's window image |
| `--dom` | `1 - smoothstep(28, 34, max(abs(ex), abs(ey)))` | the dome image's opacity (clips off the rim, never dims with distance) |
| `--la` | `atan2(ey, ex)` deg | the wheel's lip ring (a conic) |
| `--wt` | `1 - min(1, max(abs(ex), abs(ey)) / 34)` | the matte wheel's tone overlay |
| `--lx`, `--ly` | `clamp(e / 12, -1, 1)` | the moving bezel shadow, the perimeter Fresnel |
| `--lcx`, `--lcy` | the LCD's offset inside the panel (px, measured at sync) | the glass map (panel coordinates) |

Motion: one-pole low-pass tau 60 ms on the sensor, 100 ms on the mouse (above ~120 ms the reflection lags
the hand and reads floaty). No re-centre; if the pitch stays more than 35 deg from the key for over 2 s
(lying in bed) the key glides to the held pose with tau 1.5 s. The mouse maps the pointer to ex, ey =
+-12 deg at the panel's edges. The `.mms-lit` / `.mms-lit-strong` gating, the permission flow and every
teardown arm stay exactly as gated in v1.327/v1.328 (`--lm` is dropped; `--lx/--ly` stay).

**The environment map (CSS, in degrees x k).** Two cool window panes 7.4 deg x 22 deg with a 1.2 deg
mullion spanning -8..+8 deg (`#F4F7FF`, solid gradient stops, `background-size`); a window shoulder
(radial 40 x 50 deg, `rgba(215,228,255,.10)` to 0); a warm lamp at (+34, +4) deg (core `#FFF3E4` to 1 deg,
shoulder `rgba(255,196,140,.35)` at 2 deg to 0 at 7 deg); a room ramp keyed to ey only (ceiling above +20
deg `.06`, wall `.03`, 0 below the horizon; black gloss and glass only). Saturation only in shoulders.

**Per surface.**
- Click (white gloss): a grey veil under the map for headroom (`rgba(0,0,0,.09)`, the base reads ~#E8E8E6);
  panes `.55`, lamp core `.9`; no ramp; a perimeter band `.10`.
- Black gloss: a dark veil (`rgba(0,0,0,.45)`); the full map, panes `.50`, lamp core `.85`, ramp on;
  perimeter Fresnel `inset calc(var(--lx)*-1.5px) ... 3px rgba(255,255,255,.18)`.
- Matte (anodized graphite): NO sharp panes; the window as a soft ellipse 40 x 46 deg at the same position
  tinted `rgba(150,154,162,.30)` (metal specular takes the base colour), the lamp as a 20 deg blob
  `rgba(255,225,190,.12)`; no ramp.
- Screen glass: Click + Black = the SAME sharp map continued across the LCD (panel coordinates via
  `--lcx/--lcy`), panes `.14` over content, ramp on; Matte = the sharp map on the glass over its soft body.
  Bezel on glass: static `inset 0 0 0 1px rgba(0,0,0,.6), inset 0 0 6px rgba(0,0,0,.25)` plus the one moving
  shadow `inset calc(var(--lx)*-2px) calc(var(--ly)*-2px) 3px rgba(0,0,0,.35)`.
- Dome: a window IMAGE 0.53R x 0.73R with 2 px edges at `--dx/--dy`, alpha `.45`, opacity `--dom`; a 3 px
  lamp sparkle `.9`. The static base dome gradient stays.
- Matte wheel: NO moving specular. The wheel background becomes the lip ring conic
  (`from calc(var(--la)*1deg - 40deg)`: `.35` white, transparent 80deg, `.12` black 180deg, transparent
  280deg, `.35` white 360deg) and a `::before` inset 1.5 px carries the flat matte face; a tone overlay
  `rgba(255,255,255, calc(.05 * var(--wt)))`.
- Static occlusion (lit only): the wheel's outer gap (1 px ring `.30` light / `.50` black + a 5 px inner
  radial `.10`), the button gap (1 px `.35` + 3 px `.08` on the wheel).
- Subtle = the same map at 0.6x alpha: every reflection layer carries `opacity: var(--lk)` (`.6` under
  `.mms-lit`, `1` under `.mms-lit-strong`); occlusion is not scaled.

**Perf posture.** The body map is 4 background layers on the body `::before` moved by `background-position`
(a per-frame repaint of one panel-sized element; the research: cost is area x layers, and an OVERSIZED
composited layer at 3x DPR is the memory trap - the pane alone would be 1.3x the panel). The lamp is a
small translated element. No filter / blur / mask / backdrop / blend mode; animated blurs stay <= 3 px.

**Stopped (per the research):** the chrome crescent on the wheel; the same soft sheen on every material;
the independent screen streaks; the `--lm` dimming; pure-white bases under white highlights; the 8 s
re-centre; hand-tuned per-surface rates; face-wide Fresnel.

## Acceptance

- AC1 (geometry): a 6 deg tilt moves the window edge about half the face (`--fx` = 12 k px); the dome
  image moves about 1/15 of that; the wheel tone barely changes; the glass and body pane edges stay
  collinear at every pose (the LCD offset is subtracted).
- AC2 (inputs): the key pose is gravity-referenced (no first-sample neutral); a held tilt stays lit; only a
  pose over 35 deg off for over 2 s glides the key (tau 1.5 s); tau 60 ms sensor / 100 ms mouse.
- AC3 (materials): Click and Black carry the sharp panes on body AND glass; Matte carries the soft ellipse
  on the body and the sharp panes on the glass only; the wheel's background under `.mms-lit` reads `--la`
  and NOT `--fx`/`--lx` (no moving specular); the dome reads `--dx/--dy` and `--dom`, never `--lm`.
- AC4 (gating + teardown): unchanged from v1.328 and re-asserted (the lit classes, Off clears every new
  property, destroy/dock/hidden/tray/reduced-motion, the Seattle census).
- AC5 (CSS lock): no filter / blur / mask / backdrop / blend mode / CSS trig in any lighting rule (the
  whole-rule scan now bans blend modes and trig too); Off byte-identical (no base rule changed).
- AC6 (probe): screenshots per skin at the five poses (key, +-6 deg roll, +-6 deg pitch) for Subtle and
  Pronounced; main-thread cost per frame moving < 2.5 ms on this box; still 0 writes.

## Built (2026-09-25) - the pre-gate evidence

- Tuned from the first screenshots: each pane 4.9 x 16 deg with a sky-to-sill gradient (the research's
  7.4 x 22 deg panes were wider than the face, so only their interior ever showed and read as a grey
  block); the lamp at +22 deg (not +34: it never entered the face at a normal hold); the shoulder 30 x 38
  deg (cost); the dome image a soft ellipse 0.4 R x 0.55 R at .4 (the hard 0.53 x 0.73 R rectangle read as
  a sticker). Everything else is the research's numbers.
- `pocket-lighting.test.js` 16/16 (the geometry: a 6 deg tilt = 12 k px = 421 px on an 844 px panel, the
  dome 17.5x slower, the glide, the seam, every gating and teardown arm re-asserted); touched suites green;
  eslint clean; `lint:css` TOTAL 0; overlay clean.
- Probe (`--strength=pronounced`, 390x844 DPR 2, software GL): the five poses land exactly (+-6 deg = +-421
  px); moving 0.18 ms script + 1.5 ms style per frame, 0 layouts, total main-thread 2.5-2.9 ms/frame
  (was 1.9 at v1.328: the body now repaints its map per frame); still 0 writes / 0 recalcs; listeners
  Off 0 / On 1 / docked 0 / destroyed 0 / Seattle 0.
- Two bugs caught by the tests before the gate: the key glide stopped 35 deg short (it reset once the gap
  fell under the threshold; now a glide runs to the pose), and a pose AT the key wrote nothing (the map
  is written once at every sync).

## Disclosed up front

- The feel and the paint cost on the iPhone are Dean's check (the body repaints its map per frame; Web
  Inspector Timelines is the instrument; on this software-rendered box the main thread sits at 2.5-2.9
  ms/frame while moving). The knobs: `KEY_X/KEY_Y`, the pane/lamp sizes and offsets (CSS), the map alphas
  (tokens), `TAU_MS`.
- At a 6 deg roll the window leaves the face entirely (it is about the face's width); what remains is the
  shoulder, the ramp and the lamp when rolled left. A richer room (more features to reflect) is the
  obvious next step if the face reads empty at normal jitter.
- The perimeter Fresnel band and the anodized "brushed" streaks wait for reference photos (the research:
  believed bead-blasted, verify before adding streaks).
- Seattle stays out (#273). #274/#275 residue unchanged unless touched here.
