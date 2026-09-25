---
plan: pocket-lighting-reflection
harness: v2 · lean
branch: feat/pocket-lighting-reflection
anchor: spec
status: Shipped v1.329.0, REVERTED in v1.330.0 (Dean's device check: "a white dot with two rectangles that float around aggressively")
next: release v1.329.0
design: this document; the research is Dean's doc "FileTube Click skins: making the lighting look physically real" (2026-09-24)
gate: APPROVED r2 @2869d88b (adversary + qa); r1 CHANGES (the glass's one pane) fixed in 2869d88b; the r2 suggestions filed as #276
---

# Pocket lighting, third swing: a reflection, not a sheen

Dean on v1.328.0: "It's really good. It's just not 'realistic'. What are we missing?" The research doc
(his link, 2026-09-24) answers with physics; Dean's rulings on it (2026-09-25): Click + Black imitate the
5th-gen iPod (one clear glossy front, the reflection runs unbroken across body and screen), Matte the
Classic (anodized: blurred on the metal, sharp on the glass); the light is gravity-referenced (a fixed
key pose, no opening-pose neutral, no 8 s re-centre); build from the researched numbers now, photos later.

## What changes (the research's plan, adapted to this skeleton)

**Inputs (pocket-lighting.js).** The stable roll/pitch from v1.327 (gravity-projected roll, atan2 pitch,
mapped to screen axes) minus a KEY POSE in screen axes: `KEY_X = -3` deg (a touch off-axis; the research's -10 put the window 700 px off a 390 px face at a
straight hold - gate r1 qa W2),
`KEY_Y = 58` deg (a typical 50 deg hold puts the window's lower edge across the upper third of the face).
Reflected angles `ex = 2 (x - KEY_X)`, `ey = 2 (y - KEY_Y)` in degrees. `k = panelHeight / 24` px per degree
(the face spans about 24 deg of view at 350 mm). Written each frame (only when moved > 0.02 deg, 0.7 px at
k = 35), once at every sync, and once on the FIRST sample of a start (a snap, no sweep):

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

**Perf posture.** The body map is 4 background layers (5 on black) on the body `::after` moved by
`background-position` - the lamp is one of those layers, not a separate element (a per-frame repaint of one
panel-sized element; the research: cost is area x layers, and an OVERSIZED composited layer at 3x DPR is
the memory trap - the pane alone would be 1.3x the panel). No filter / blur / mask / backdrop / blend mode;
animated blurs stay <= 3 px. As shipped: the glass carries the panes + lamp but NOT the ramp; the black lamp
core is the same .9 as Click's; the geometry is re-measured on a window resize.

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
  Pronounced; main-thread cost per frame moving < 2.5 ms on this box (MISSED: 2.4-2.9 measured; disclosed,
  the phone is the arbiter); still 0 writes.

## Built (2026-09-25) - the pre-gate evidence

- Tuned from the first screenshots: each pane 4.9 x 16 deg with a sky-to-sill gradient (the research's
  7.4 x 22 deg panes were wider than the face, so only their interior ever showed and read as a grey
  block); the lamp at +22 deg (not +34: it never entered the face at a normal hold); the shoulder 30 x 38
  deg (cost); the dome image a soft ellipse 0.4 R x 0.55 R at .4 (the hard 0.53 x 0.73 R rectangle read as
  a sticker). Everything else is the research's numbers.
- `pocket-lighting.test.js` 16/16 (the geometry: a 6 deg tilt = 12 k px = 421 px on an 844 px panel, the
  dome 19.5x slower (2 beta k / R at R 54), the glide, the seam, every gating and teardown arm re-asserted); touched suites green;
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

## Gate r1 - qa

Gate: CHANGES r1 @c57bc769 — qa

Instruments (live tree, verbatim): `node --test test/unit/pocket-lighting.test.js` = `# tests 16 # pass 16 # fail 0`; `npm run lint:css` = `TOTAL 0` (exit 0); `node scripts/overlay-containment-lint.js --enforce` = `overlay-containment: clean (0 violations)` (exit 0); `npx eslint public/js/pocket-lighting.js` = no output, exit 0. Probe (sandbox copy, port 9347, +2 poses): moving `taskMsPerFrame 2.382` (script .173, style 1.41, 0 layouts, 240 writes), still 0 writes / 0 recalcs; listeners off 0 / on 1 / docked 0 / destroyed 0 / seattle 0 (lit false, writes 0). Added lines: 0 em dashes; filter/blur/mask/backdrop/blend/trig/rgba-calc appear only in comments.

CRITICAL
- C1 style.css:12161-12166 - the glass drops the RIGHT pane and paints a fake mullion in the left one (fails AC1 collinear + AC3 "panes on body AND glass"). It has 2 images but 3 background-size / 3 background-position entries; the excess ones are dropped (CSS Backgrounds: excess values are not used), so the one 90deg pane image (4.9k wide, gap 46.25-53.75%) sits at -3.05k only. Screenshots `ipod{,-black,-matte}-pronounced-key.png`: body panes at x 4-348 and 432-740 (image px); glass shows 45-348 split at 163-190, nothing at 432-735. Fix: two 180deg pane layers like the body. The CSS lock (test:600) only checks that the `- 3.05` string is present, so it stays green.

WARNING (C1 already blocks; each could ship disclosed on its own)
- W1 pocket-lighting.js:229 measure() only runs at sync (a paint). onViewportChange (skin-surface.js:2107) never repaints or syncs, so the comment "a paint or a resize can change it" is wrong. Probe: resize 390x844 -> 390x600 with the sensor live: `--k 35.17px` (real 25), `--lcy 274.8px` (real 152.75). The glass map sits 122 px off the body map (qa-resize-600.png), and a 6 deg tilt moves 421 px on a 600 px face. Fix: measure()+write() on resize (or a ResizeObserver).
- W2 KEY_X -10: the STRAIGHT hold (roll 0) is 10 deg from the key = 20 deg reflected = `--fx 702.9px` on a 390 px face. Probe poses hold-0-50 / hold-0-58: `fx 703.0px fy -562.2px` / `703.3px -0.7px`. The Black body is flat black (no pane, no lamp, only the dome image), and --lx/--ly clamp at +1/-1 there, so the bezel/perimeter/base-dome stop moving under small jitter. All five probe poses are relative to the key, so the natural hold was never screenshot. Dean should rule on KEY_X before ship.
- W3 the light-up sweep: every start() resets st to ex=ey=0 and sync writes the key-centred map, so the first sample slides it the whole gap. Probe (Black, boot then a hold-0-50 sample): at boot `fx 0.0px lit true`, then per frame `0, 164.6, 601.6, ... 703.1px`. The window flashes across the face at every unlock, return or pick. Fix: snap st to the first sample's target.

SUGGESTION
- S1 lock survivors (sandbox `git archive HEAD`, each `git diff --shortstat` 1 line, `# fail 0`): Black ::after pane sign flip `50% - var(--fx)`; dome sparkle `50% - var(--dx)`; Matte blob fy -> `50%`; a moving `--lx` specular in `.ip-wheel::before` (the no-specular lock covers only the wheel rule). Killed (spot-check, risk 5): PROPS without `--lcy` (fail 1), wanted() without trayUp (fail 1), stop() without clearProps (fail 3).
- S2 plan/comment drift that a reader will trip on: the dome comment at style.css:12182 still says 0.53R x 0.73R (shipped `40% 55%` of 2R). Plan says write eps 0.1 deg / 0.25 px, code has 0.02 deg. Perf posture says the map is on ::before with a "translated" lamp; shipped is ::after, with the lamp as a background layer. The glass "ramp on" is not built; the Black lamp is .9, not .85. AC6 says < 2.5 ms but Built reports 2.5-2.9 with no note of the miss. The dome ratio is quoted as "~15x" (DOME_BETA comment, which also conflates beta with the ratio 2 beta k / R), "17.5x" (Built), 19.5x (the test's R 54) and 20.8x in the probe (R 50.7). The base .ip-center gradients still read --lx at the flat rate, so the dome is not "static base + --dx" under lit. Subtle does not scale the lip ring or the Fresnel.
- Verified sound: the 2x mirror rule; k = h/24 (147 mm at 350 mm = 23.7 deg); a dome cap's R e/(2 beta); 5G gloss / Classic anodized; the stacking comments; measure() with no layout keeps k 844/24, R 54, lc 0 (the `> 0` guards; tests pass on them; Seattle probe geom = defaults). Off: no base rule is in the diff (hunks only in the token block and the lit block), so this is should-work; I ran no pixel diff (risk 1).
- Security: no route, server, network or dependency change. The client writes only numeric toFixed values via setProperty. The strength comes from localStorage through the STRENGTHS whitelist. No innerHTML or secrets in the diff. No security surface.

## Gate r1 - adversary

Gate: CHANGES r1 @c57bc769 — adversary

Instruments (sandbox `git archive c57bc769` + `git archive dd5470a1`, my copy of the probe fixture on ports 9444/9445): `node --test test/unit/pocket-lighting.test.js` = 16 pass / 0 fail; `npm run lint:css` TOTAL 0; overlay-containment clean (0 violations); eslint exit 0.

CRITICAL
- C1 The glass does not carry the body's map (fails AC1 collinearity and AC3 "sharp panes on body AND glass" at every pose, on all three Click skins). `.mms-ipod.mms-lit .ip-lcd-in::after` lists 3 sizes and 3 positions but only 2 images (the lamp, plus ONE `linear-gradient(90deg ...)` with a transparent band at 46.25-53.75%). The third size and position are dropped. Measured with getComputedStyle: glass `gradient(` count = 2, `background-size: 492.38px 492.38px, 172.333px 562.72px`; body = 5. So the glass shows only the LEFT pane (with a false mullion down its middle), and the right pane stops dead at the LCD edge. Normal render, Black pronounced, key pose, diffed against the glass ::after removed, LCD rows only: the glass paints only at css x [22-24], [30-81], [94-173]. There is a hole at 82-93, which is the false mullion, and nothing at 174-368. The body's panes run at 2-174 and 216-388. The left-pane edge is collinear at x=174 (the lcx/lcy math is right). Diagnostic screenshot at opacity 1: out-geo/geo-key.png. Fix: two pane images (the body's 180deg sky-to-sill pair, or two flat ones) to match the three sizes/positions. Bind it: assert the glass layer count, or add a probe assert.

WARNING
- W1 The seam is unbound in the unit suite; the collinearity claim rests only on screenshots. These mutants all survive 16/16: lcx sign flip in measure(); `--lcx/--lcy` never written; `k = pr.width / 24`; `--dr` never written; the glass LAMP position without `+ var(--lcx)`; dropping the glass's third position. (jsdom rects are 0, so geom keeps its defaults.) C2 is the shipped proof that the string lock (test line 601) cannot see a missing layer.
- W2 At a natural LEVEL hold (roll 0, pitch 50), measured on ipod and ipod-matte: `--fx 700px / --fy -560px`, so the window is off the face on BOTH axes. `--lx 1.000 / --ly -1.000` are saturated. And the BASE dome gradient under lit is pinned at `circle at 66% 24%` (Off/key: `50% 40%`), and only moves on one axis for +3 deg (`66% 26.7%`). KEY_X -10 as a POSE means the reflection only appears with the phone rolled about 10 deg left. And the plan's "the static base dome gradient stays" is false under lit: style.css:12076/12092/12105 still read --lx/--ly, which now clamp at a 6 deg tilt. This is a feel issue, not a broken flow: ship it disclosed, with Dean's device check deciding KEY_X and the clamps.
- W3 Glide guards partly unbound. These survive 16/16: `GLIDE_TAU_MS 1500 -> 150`; dropping the `offSince = -1` reset when near the key (makes the 2 s count cumulative, so a second brief excursion glides early); the gliding branch returning false. These are killed: stop at 35 deg (2 fail), no glide (2), no 2 s wait (1), tau 3000 (2). End to end in Chromium, streaming at 16 ms: a held 20 deg keeps key.y 58.00 for 5 s. A 50 deg-off pose glides after 2 s (2.5 s 48.04, 4 s 22.86, 6 s 11.93, 12 s 8.45 vs pose 8), and returning glides back after 2 s (12 s 57.55 vs 58). So it runs to the pose, within the 0.5 deg stop.

SUGGESTION
- S1 The glide stops 0.45 deg short, so the key leaves a permanent offset of ey 0.9 deg (~32 px of --fy); measured ey -0.90 / +0.91. A 0.05 stop or a snap would fix it.
- S2 Stale text: base rules still read `var(--mms-lit-wheel-shadow, …)` / `var(--mms-lit-dome-shadow, …)`, which this diff deleted (dead fallbacks). The dome comment says 0.53R x 0.73R (the code is 40% 55%). The glass comment says "the SAME sharp map" (C1). The plan says the glass has "ramp on", but no ramp is built. The dome ratio measured at 390x844 is 421.7/20.26 = 20.8x (plan: 17.5x).
- Risk 1 (Off = today), VERIFIED: I compared PNG sha1 on main vs HEAD, Off, 390x844@2. ipod 967c1691, ipod-black 2b1f3aa4, ipod-matte 168a7d39: identical, and stable on a second run. zune-classic is noisy on BOTH trees from run to run (main itself 6df426d3 -> 24f20288; max channel delta 2); HEAD matched main's 6df426d3 in run 1.
- Risk 4 perf (TaskDuration/frame, 240 moving frames, rep 2, box load ~8): HEAD ipod 2.28 (style 1.32, script 0.14), black 2.37; main v1.328 1.80 (style 0.99). All are under 3.5, and under AC6's 2.5 here. Ablation (content:none per layer): body map 2.26, glass 2.24, dome 2.09, wheel 2.26, all lighting pseudos 2.20-2.37. So NO layer dominates the main thread: the delta is style recalc from the 14 inherited custom properties. Trace: Paint 0.5-0.9, Raster 0.23-0.31 ms/frame, and the ablation differences are within noise. iPhone raster remains Dean's check.
- Risk 5/6/7, killed: PROPS without --lcx; wanted() without hidden; wanted() without trayUp; clearProps keeping -strong. The whole-rule lock also killed: mix-blend-mode, -webkit-mask-image, -webkit-backdrop-filter, sin(), wheel reads --fx, and the dome/glass/body without --lk.
- Tree: the live tree is unchanged apart from this append (the plan doc also carries the other seat's uncommitted section); no untracked files. The scratch is in the session scratchpad.

## Fix round 1 (the Architect, after both r1 verdicts)

- C1 (both seats: the glass showed ONE pane with a false mullion - the tuning pass replaced the body's
  pane line but not the glass's, which ended in `;` not `,`): the glass now carries the two 180deg pane
  layers like the body; the lock counts every rule's images against its sizes and positions (a
  paren-aware top-level count), asserts both glass panes and bans a `90deg` pane there.
- qa W2 / adversary W2 (at a straight hold the window sat 700 px off a 390 px face): `KEY_X` -10 -> -3;
  a test asserts the window's near pane overlaps the face at roll 0. The base dome gradient under lit is
  now STATIC per skin (its v1.327 `--lx` calc saturated at 6 deg); only the window image moves.
- qa W3 (every light-up swept the window across the face): the FIRST sample of a start snaps the
  reflection into place and writes before the lit class lands; tested (no easing on the first frame).
- qa W1 (the geometry was measured only at a paint): `measure()` + `write()` on every window `resize`
  (bound in start, unbound in stop); tested with stubbed rects, including the seam's sign (`--lcy` =
  panel centre minus LCD centre) and `--dr`.
- adversary S1 (the glide stopped 0.45 deg short): the last half degree snaps onto the pose.
- adversary W3 (glide guards unbound): tests for the per-excursion 2 s count and the 1.5 s time constant.
- qa S1 / adversary W1 (lock gaps): the black panes' and the sparkle's signs, the matte blob's axes, no
  light property on the wheel's pseudo-elements, the glass layer count, `--lcx/--lcy/--dr` written.
- S2 (stale text): the dead `--mms-lit-*-shadow` fallbacks are gone from the base rules (Off unchanged: the
  static token was the fallback); the dome comment says 0.4 R x 0.55 R; the plan's perf posture, write
  epsilon, glass ramp (not built) and AC6 miss are corrected in place.
- Not changed, disclosed: Subtle does not scale the lip ring or the Fresnel edge (qa S2); the dome ratio
  reads 17-21x depending on R (the physics: R / (2 beta) against k).

## Gate r2 - adversary

Gate: APPROVED r2 @2869d88b — adversary

Sandbox `git archive 2869d88b`: unit file 17 pass / 0 fail; lint:css TOTAL 0; overlay clean (0 violations); eslint exit 0.
- C1 fixed as prescribed (verified). Diagnostic render (every reflection layer at opacity 1, LCD black), Black pronounced, the row 14 css px inside the LCD bottom vs 12 px below it. At the key pose: glass [22-173.5] [216-367.5], body [2-173.5] [216-387.5]; both pane edges are collinear (the LCD clips at 22/368). At roll+3: 212 vs 212. At roll-3: 177 vs 176.5. On c57bc769 the same probe gave glass [22-81] [94-173.5] (the false mullion, no right pane). Mutant: one glass pane layer -> red (the image-vs-size count lock).
- W1 fixed (verified). These now go red: lcy sign, k by width, `--dr` unwritten, `--lcx/--lcy` unwritten, resize not measuring, resize listener not removed. An lcx sign flip survives, but it is equivalent here (measured `--lcx 0.0px`: the LCD is centred horizontally).
- W2 fixed (verified). The lit dome base is static per skin; a mutant re-adding `--lx` to it goes red. KEY_X is -3.
- W3 fixed, with one caveat. A mutant dropping the near-key `offSince` reset now goes red, and so does the glide without its end snap (S1 fixed). But `GLIDE_TAU_MS 1500 -> 150` still passes 17/17: the new tau test loops `GLIDE_TAU_MS / 16` ticks, so it is self-referential and binds the curve's shape, not the 1.5 s value. The value itself I measured end to end in r1.
- S2 fixed; Off is byte-identical (verified). The wheel and dome box-shadow and dome background resolve to identical computed strings on main and the fix sha, for ipod / black / matte / zune. PNG sha1 matches main for each skin: ipod 967c1691, matte 168a7d39, zune 6df426d3, black 2b1f3aa4 (two runs).
  - The box ran at load 11-14, which is unrelated to this diff. The renderer is noisy on BOTH trees: main-vs-main Black differs by 75522 px at max delta 2; one Black fix-vs-main pair differs by 3 px at max delta 5. Two ipod captures were torn (tiled) frames, an instrument failure, and a re-shot with a settle wait matched.
- qa W3 snap, end to end in Chromium (Black pronounced):
  - The first sample 5 deg off the key writes `--fy 351.7px` at once (writes 1 -> 2), and the loop is parked at 1 s and 2 s with no further writes.
  - Hidden clears (fy '', not lit, off). On return, the next first sample snaps to -351.7px and parks within 1 s.
  - Mutants: no snap -> red; snap without applyLit -> red (the relaunch/permission test); snap on every sample -> red. applyLit on every sample survives (equivalent: idempotent).

Remaining (none block; ship disclosed):
- WARNING (a lock gap; the shipped code is correct): the glass LAMP's `+ var(--lcx) / + var(--lcy)` is unbound. Removing both passes 17/17, and the glass lamp would then sit 275 px off the body's. I named this in r1 W1; the image count lock does not reach positions.
- SUGGESTION: make the tau test literal (`GLIDE_TAU_MS === 1500`, or a fixed 94-tick loop).
- SUGGESTION (reasoned, not run): `start()` re-creates the filter, so a key glided to a lying-down pose resets to 58 on every unlock, return or pick, and re-glides after 2 s + tau.
- Perf was not re-measured this round (the fix adds one small glass layer; r1 measured 2.28-2.37 ms/frame).
Tree: the live tree is clean apart from this append; no untracked files.

## Gate r2 - qa

Gate: APPROVED r2 @2869d88b — qa

Instruments (live tree at 2869d88b, verbatim): `# tests 17 # pass 17 # fail 0`; lint:css `TOTAL 0`; `overlay-containment: clean (0 violations)` exit 0; eslint exit 0, no output. Probe (sandbox `git archive 2869d88b`, port 9348, load avg 11): moving `taskMsPerFrame 2.615` (script .206, style 1.478, 0 layouts); listeners off 0 / on 1 / docked 0 / destroyed 0 / seattle 0 (lit false); errors [].

My r1 findings against 2869d88b:
- C1 FIXED as prescribed. Key-pose glass row y460 (R channel; pane 253, clear 255) at x 100/176/300/390/500/700: r1 `253,255,253,255,255,255` (fake mullion at 176, no right pane), r2 `253,253,253,255,253,253` (left pane, mullion at 390, right pane). Same on ipod, black and matte; the body row is unchanged. Mutant "glass back to one pane layer": fail 1 (the layer-count lock kills it).
- W1 FIXED. Resize probe 390x844 -> 600: `--k 25.00px` (real 25), `--lcy 152.8px` (real 152.75). Mutants all fail 1: onResize never bound, stop() keeps the resize listener, onResize without write().
- W2 FIXED. Straight hold with KEY_X -3: hold-0-50 `fx 210.9px`, hold-0-58 `211.0px`. The near pane shows on the body (x 426-770) and continues on the glass. Mutant "lit dome back to --lx": fail 1.
- W3 FIXED. Boot, then one hold-0-50 sample: `fx` per frame `211.0px` x14, no sweep. Mutant "no first-sample snap": fail 1. Residual: where the panel lights at sync (Android/desktop), the key-centred map shows until the first sample, then jumps 211 px once (atBoot `fx 0.0px lit true`). A jump, not a sweep; fine.
- S1 FIXED. The four r1 survivors are now asserted.
- S2 PARTLY FIXED; see S-a below.
- New surfaces: the resize listener is bound and unbound on the driver's own `win` (the pop-out's window for the pop-out), and destroy() releases it (test count 0). The snap is sensor-only: sessionSamples counts only non-null sensor samples, so the mouse still eases, up to 12 deg, driven by the user. Removing the dead `--mms-lit-*-shadow` fallbacks from the base rules is Off-neutral: grep finds no definition anywhere.

SUGGESTION (non-blocking):
- S-a The new DOME_BETA comment (pocket-lighting.js:41-42) says "about 17x slower on an 844 px panel with a 54 px dome". The arithmetic gives 2*15*(844/24)/54 = 19.54x (20.81x at the probe's R 50.7). The "~15x" wording remains at pocket-lighting.js:153, style.css:12109 and test names 50/260/276, and Built (plan:112) still says 17.5x.
- S-b scripts/pocket-lighting-probe.js:108 still has `const KX = -10` (not in the fix diff). The stock probe's "key" pose is now 7 deg off the key: ex -14, fx about -492 px. My r2 run patched KX to -3. Read L.KEY_X instead.
- S-c Lock survivor on the C1 surface: dropping `+ var(--lcy,0px)` from the glass RIGHT pane's position passes 17/17. The lock binds only the left pane's position string.
- Security: unchanged from r1. One window `resize` listener added, bound and unbound symmetrically; no route, network or dependency change.


## Outcome: REVERTED in v1.330.0 (Dean, 2026-09-25, on the iPhone)

"Something about 1.329 is just not good. It is literally just like a white dot with two rectangles
that float around aggressively ... let's just go back to 1.328's look basically exactly as we had it."
v1.330.0 restores the four lighting files byte-for-byte from v1.328.0 (`git checkout dd5470a1 --
public/js/pocket-lighting.js public/css/style.css test/unit/pocket-lighting.test.js
scripts/pocket-lighting-probe.js`; the diff against dd5470a1 is empty) and folds in the first-tap
motion ask on top of that driver.

### What the research got right, and where it went wrong on the device
- The physics is sound and stays useful: a mirror turns a reflection by twice the tilt; a phone face
  spans ~24 deg of view; k = height / 24 px per degree; a dome moves R / (2 beta) per degree; the
  materials (5G gloss vs the Classic's anodized metal; a matte wheel with no specular); static
  occlusion; a gravity-referenced light that never fades; 60 ms smoothing. All of it measured correct in
  headless Chromium (the five poses landed at +-421 px; Off byte-identical; ~2.3 ms/frame).
- What it produced on a phone: a window drawn as two flat gradient rectangles that sweep HALF THE FACE per
  6 degrees of tilt, plus a 3 px "lamp sparkle" on the dome - physically correct amounts of motion that
  read as two rectangles and a white dot flying around. The research's own verification step (photograph
  a real glossy object at the same poses and compare) was skipped on Dean's call to build from the numbers
  first; the headless screenshots showed exactly what Dean saw and the Architect judged them "physically
  consistent" instead of "does this look like anything".

### Learnings (the reusable ones)
1. **Physically correct is not the same as convincing.** A real reflection is recognisable because it is a
   rich, detailed image (a whole room) moving fast; two soft rectangles moving fast are just two
   rectangles moving fast. Either reflect something detailed (a real environment image, which our
   gradient-only constraint forbids) or keep the motion small and the shapes vague (v1.328's approach).
   The middle ground is the worst of both.
2. **Motion amplitude sells or kills the effect.** v1.328 moved highlights ~30 percent of a surface across
   the whole tilt range; v1.329 moved them half the face per 6 degrees. On a hand-held phone the hand's
   jitter alone (1-2 deg) swept the window 70-140 px every moment - "aggressively".
3. **The Architect's screenshot review must ask "does it look like the thing", not "is it consistent with
   the model".** The shots were reviewed three times and each review tuned sizes; none asked the only
   question that mattered.
4. **Verify against a photograph before the gate, not after the release** - the research put that step
   in its plan and it was dropped for speed.
5. **A revert must be byte-identical to a gated state** (here v1.328's files at dd5470a1), so it needs no
   design re-gate; only the folded-in change (the first-tap ask) is new code.

The research doc stays valuable for a future attempt with a real environment image if the gradient-only
constraint is ever relaxed; the plan's numbers and the two tests of the geometry (the pure functions)
are the record.
