---
plan: pocket-gyro-lighting
harness: v2 · lean
branch: feat/pocket-gyro-lighting
anchor: spec
status: In gate
next: ONE gate (adversary + qa, max 2 rounds) at the sha below, then release v1.327.0
design: this document (Dean's intake G1-G8 is in 2026-09-24-pwa-chrome-and-gyro-sheen.md, Item 2)
gate: pending
---

# Gyro-driven realistic lighting on the pocket skins

Dean (2026-09-24): "I really want to focus on one item one first. That is the biggest thing.
Everything else can wait." Then: "you can almost focus exclusively on the Pocket Classics and skip for
Seattle. I really want to keep this focus for now." So: the three Click skins (Click, Click Black,
Click Matte) only; Seattle keeps today's look byte-for-byte and its Settings level stays [About].
This plan is the whole run. Intake G1-G8 (answered by Dean, not re-asked)
lives in `2026-09-24-pwa-chrome-and-gyro-sheen.md`; this document settles every design point the
intake left to the Architect and is the acceptance record for the one gate.

## What the tree does today (read 2026-09-24 at 71b5e6dd)

- The four pocket skins (Click, Click Black, Click Matte, Seattle) share one render (`renderIpod` /
  `renderZuneClassic` over `ipScreen`) and one engine (`skin-surface.js create()`); the registry entry's
  `menus` field is the "pocket skin" marker (Click x3 = `click`, Seattle = `seattle`; Cider / Nordic none).
- Their look is static CSS: the body is layered gradients on `.mms-ipod` / `.mms-ipod-black` /
  `.mms-ipod-matte` / `.mms-zune-classic`; the wheel's sheen is a `radial-gradient(90% 55% at 50% -8%)`
  over a `circle at 50% 40%` base; the center dome a `circle at 50% 40%`; the Seattle pad / flanks the
  same shapes in chrome; depth is the `--mms-ipod-wheel-shadow` / `--mms-ipod-center-shadow` tokens.
  Nothing reads a tilt. Nothing listens to `deviceorientation`.
- Engine lifecycle (the teardown arms a driver must honour): `paint()` rebuilds `panel.className` and
  `innerHTML` on every repaint; `destroy()` unbinds (skin switch to a flat skin, view swap, pop-out
  close); a DOCK clears the panel (`hidden = true`, `innerHTML = ''`) WITHOUT `destroy()` (the v1.256
  class; the ghost lock heals through a MutationObserver + viewport check for exactly this path); a
  hidden tab reaches the engine through `visibilitychange`; the tray (`body.mms-tray`) is the LCD alone.
- The pocket menu Settings level is `[About]` (`menuStaticItems`, `TYPE_TITLE`, `NON_ITEM_LEVELS`;
  tests in `pocket-quick-scroll.test.js` :75-79 enumerate them).
- Reference (Zune 30 photo, Wikimedia): the chrome pad ring catches the light as a bright ARC on the
  lit side and goes dark opposite; the flank discs and the body brighten toward the light with a soft
  falloff; the screen glass carries a faint diffuse sheen; every shadow falls AWAY from the light.
  That is the model: two numbers (where the light sits relative to the device) move every highlight
  toward the light and every shadow away from it.

## Design

### The light model (G3, G5, G7)

Two numbers, `lx` and `ly` in [-1, 1]: where the room's light sits relative to the device, in the
device's own screen axes (+x = the light is to the right of the device, +y = below). Neutral (0, 0)
is the pose the skin opened in. Tilting the device right (gamma +) moves the light LEFT relative to
the device (lx negative): every highlight slides the opposite way to the tilt.

Pure functions (`public/js/pocket-lighting.js`, dual-exported like `wheel-config.js`):

| Function | Contract |
|----------|----------|
| `mapTilt(beta, gamma, angle)` | device (beta = front/back, gamma = left/right) to screen axes by `screen.orientation.angle`: 0 -> (gamma, beta); 90 -> (beta, -gamma); 180 -> (-gamma, -beta); 270 -> (-beta, gamma). null/NaN -> null (no sensor sample). |
| `stepFilter(st, tx, ty, dt)` | the neutral pose + smoothing. `st.bx/by` = the baseline (seeded from the FIRST sample); baseline drifts toward the sample with `RECENTER_TAU_MS = 8000` (G5: settle into a new pose and the light re-centres); the light `st.x/y` eases toward `-(sample - baseline) / TILT_RANGE_DEG` (28 deg = full deflection), clamped to [-1, 1], with `SMOOTH_TAU_MS = 90`. Returns whether `x/y` moved more than `WRITE_EPS = 0.003`. |
| `pointerLight(x, y, rect)` | desktop (G7): the pointer's position over the panel, `((x - cx) / (w / 2), (y - cy) / (h / 2))` clamped. |
| `normalizeStrength(v)` | `'off' | 'subtle' | 'pronounced'`, anything else -> `'off'`. `GAIN = { off: 0, subtle: 0.5, pronounced: 1 }` scales `lx/ly` before they reach CSS. |
| `readStrength(store)` / `setStrength(v, store)` | `localStorage['ft-pocket-lighting']`, device-local (G2). Default `'off'` (G4: turned on from Settings). |

### The driver (`create({ panel, win, doc, isPocket, getStrength })`)

One instance per engine (the in-tab engine and the pop-out's engine each own one; the pop-out is a
scriptless window, so the driver runs in the opener and listens on the pop-out's `win`/`doc`).

- `sync()` (called by the engine after every `paint()`, on `visibilitychange`, and by `choose()`):
  WANTED = strength != off AND `isPocket()` (the registry's `menus` field, G8) AND the panel is painted
  (`!panel.hidden && panel.firstChild`) AND `!doc.hidden` AND not the tray (`body.mms-tray`) AND
  `prefers-reduced-motion` is not `reduce` on `win`. WANTED -> `start()`, else `stop()`.
  `start()` adds the `.mms-lit` class (paint() rebuilds `className`, so sync re-adds it), seeds the
  filter from scratch (a fresh open = a fresh neutral pose, G5), and binds: `deviceorientation` on
  `win`, `pointermove` + `pointerleave` on `panel` (pointerType `mouse` only, so a finger never moves
  the light), `visibilitychange` on `doc`. `stop()` removes all three, cancels the rAF, clears
  `--lx/--ly` and `.mms-lit` (the look returns to today's byte-for-byte: with the properties unset the
  CSS calcs resolve to the old constants).
- The frame loop: an orientation / pointer event only STORES the latest target; a rAF tick runs the
  filter and writes `panel.style.setProperty('--lx' / '--ly')` ONLY when a value moved past
  `WRITE_EPS`. The loop parks (no rAF) when the light has settled and no sample arrived for 300 ms; the
  next sample re-arms it. Every tick re-checks liveness (`panel.hidden || !panel.firstChild ||
  doc.hidden`) and calls `stop()` itself, so a DOCK (innerHTML cleared with no destroy) ends the
  listener within one frame. Timing uses `win.performance.now()`.
- Sensor precedence: while orientation samples arrive (a sample in the last 1500 ms) the pointer is
  ignored; with no sensor (desktop, iOS not yet granted) the pointer drives; `pointerleave` eases the
  light back to (0, 0) (`SMOOTH_TAU_MS` x 4).
- iOS permission (G4): `choose(v)` runs INSIDE the row's click handler (the pocket menu's `activate`
  is synchronous in the delegated click, so the user activation is live). If `v != off` and
  `win.DeviceOrientationEvent.requestPermission` exists it is called; `granted` -> `sync()`;
  `denied` / a throw -> the note `Motion access was denied. The look stays as today.` (the strength is
  kept, so the desktop pointer still works and a later grant needs no re-pick). Where no sensor and no
  fine pointer exist the note reads `No motion sensor here.` Under reduced motion the note reads
  `Reduce Motion is on. Lighting stays still.` and nothing binds. iOS remembers a grant per site, so a
  later open just listens (no prompt outside a tap); a deny is remembered by iOS too (the note says so).
- `state()` (test seam, like `pocket.state()`): `{ on, listening, raf, samples, lx, ly, strength, note }`.
- `destroy()` = `stop()`.

### CSS (the Click surfaces, G1 + G6; Seattle untouched per Dean)

Everything keys on `--lx` / `--ly` (unset = 0 = today's look). Only gradient POSITIONS, `transform`
and `opacity` change per frame, on small elements; NO filter / blur / mask / backdrop anywhere in the
lighting rules (the iPhone black-video lesson; a lock test enforces vendor + case spellings).

1. **Click wheel** (the three Click `.ip-wheel` rules; Seattle's pad rule is not touched): sheen `at calc(50% + var(--lx,0)
   * 30%) calc(-8% + var(--ly,0) * 26%)`; base `circle at calc(50% + var(--lx,0) * 10%) calc(40% +
   var(--ly,0) * 10%)`. Rim + recess (G6): the wheel shadow becomes directional at the consumer rule
   (NOT inside the `:root` token, whose `var()` would substitute at `:root`):
   `inset calc(var(--lx,0)*2px) calc(1px + var(--ly,0)*2px) 1px <rim>, inset calc(var(--lx,0)*-2px)
   calc(-2px + var(--ly,0)*-2px) 4px <recess>, calc(var(--lx,0)*-4px) calc(1px + var(--ly,0)*-4px) 3px <drop>`.
2. **Center dome** (`.ip-center` on the three Click skins): `circle at calc(50% + var(--lx,0)*16%) calc(40% +
   var(--ly,0)*16%)`; its shadow directional the same way.
3. **Body / front face**: `.mms-ipod.mms-lit::before` - a reflection band, `position:absolute;
   inset:-40%; z-index:-1; pointer-events:none` (the panel is `position:fixed` with a z-index, so the
   band paints over the body gradient and under every child); `background: linear-gradient(112deg,
   transparent 40%, var(--mms-lit-band) 47%, var(--mms-lit-band2) 50%, transparent 60%)`;
   `transform: translate3d(calc(var(--lx,0)*12%), calc(var(--ly,0)*10%), 0)`; `will-change:transform`.
   Per skin: Click `--mms-lit-band: rgba(255,255,255,.34)`; Black `.16`; Matte `.09` (softer, G1).
   Exists only while `.mms-lit` is on (Off = no layer at all).
4. **Screen glass**: `.mms-ipod.mms-lit .ip-lcd-in::after` - `position:absolute; inset:0 -50%;
   z-index:5; pointer-events:none` (over the menu's letter layers at 3/4, never a tap target);
   `linear-gradient(100deg, transparent 44%, var(--mms-lit-glass) 50%, transparent 56%)`;
   `transform: translate3d(calc(var(--lx,0)*22%), 0, 0)`. `--mms-lit-glass: rgba(205,218,236,.16)`
   (a cool tint on the white LCD, contrast stays > 7:1 for black text).
5. **Seattle**: nothing. `isPocket()` is `menuStyle(id) === 'click'`, so the driver never binds on
   Seattle and its Settings level shows no Lighting row (Dean's focus ruling). The Seattle rules keep
   their literal positions (AC9's byte-identical check covers them as unchanged text).

Tokens: `--mms-lit-band`, `--mms-lit-band2` (= band at 55%), `--mms-lit-glass` declared on each skin
root rule (`.mms-ipod`, `.mms-ipod-black`, ...). Governed-property census stays at zero (alphas live
in tokens).

### Settings > Lighting (G4)

- `menuStaticItems({type:'settings'}, { hasLighting })` -> `[Lighting, About]` (Lighting only where a
  driver exists; the engine passes `hasLighting: !!lighting`). `TYPE_TITLE.lighting = 'Lighting'`,
  `NON_ITEM_LEVELS` += `'lighting'` (Click's right pane keeps the cover drift there). Seattle's engine
  gets no driver, so `hasLighting` is false there and the row never renders.
- `menuLightingItems(state)` -> `[{label:'Off', action:'lighting', value:'off', check}, Subtle,
  Pronounced]` + an info row for a `note`. The pocket controller re-derives this level on every draw
  (like Main) from `lighting.state()`. `activate` on `action:'lighting'` -> `lighting.choose(value)`
  then re-render (the level stays up, the check moves; a note appears once the permission promise
  settles). `renderMenuList` draws `<span class="ipm-check">` on `check` rows (Click: the iPod's
  check at the row's right; Seattle: the same glyph in pink, big type).

### Files

| File | Change |
|------|--------|
| `public/js/pocket-lighting.js` | NEW: the pure functions + `create()` driver (dual export). |
| `public/*.html` (10 shells that load skin-surface.js) | `<script src="/js/pocket-lighting.js">` after skin-surface.js. |
| `public/js/skin-surface.js` | `create()`: instantiate the driver (optional, like SKINS); `paint()` -> `lighting.sync()`; `destroy()` -> `lighting.destroy()`; `createPocketMenu({ lighting })`: the `lighting` level + the `action:'lighting'` arm; engine API `lightingState()`. |
| `public/js/music-skins.js` | `menuStaticItems` Settings row, `menuLightingItems`, `TYPE_TITLE`, `NON_ITEM_LEVELS`, the `check` span. |
| `public/css/style.css` | the calc positions on the wheel / center / pad / flanks, the directional shadows, the band + glass pseudo-elements, the lit tokens, `.ipm-check`. |
| `test/unit/pocket-lighting.test.js` | NEW (below). |
| `test/unit/pocket-quick-scroll.test.js` :75-79 | the Settings census gains Lighting. |
| `scripts/pocket-lighting-probe.js` | NEW: headless Chromium evidence (below). |
| `docs/exec-plans/tech-debt-tracker.md`, `ROADMAP.md`, `docs/releases.json` | release ceremony. |

## Acceptance (the gate measures these; the builder runs them first)

- AC1 (reachability, the real shape): through the REAL engine (`create()` + `paint()`), a real
  `deviceorientation` event on `win` with `{beta, gamma}` moves `--lx/--ly` on the panel; a
  `pointermove` with `pointerType:'mouse'` moves them when no sensor sample is live; a touch
  `pointermove` never does.
- AC2 (both axes, populated): with the panel PAINTED and lit (`--lx` non-zero, `.mms-lit` on), choosing
  Off clears both properties, drops the class, removes every listener and cancels the rAF. Choosing
  Subtle then Pronounced from Off binds exactly one `deviceorientation` listener (never two).
- AC3 (every teardown arm unbinds): after each of: `destroy()`; a dock (`hidden = true` + `innerHTML =
  ''` with no destroy); `doc.hidden` = true; a repaint as Cider; the tray body class; reduced motion on
  the window - the listener count on `win` / `panel` / `doc` returns to the pre-start count and no rAF
  is pending (measured over N mounts, counts asserted, not "should").
- AC4 (permission): choosing a strength calls `requestPermission` exactly once from the tap; `denied`
  keeps the strength, sets the note, binds nothing; `granted` binds; no `requestPermission` -> binds
  directly (Android / desktop).
- AC5 (mapping): `mapTilt` at 0/90/180/270; tilt right -> `lx` < 0 (opposite); a held tilt re-centres
  to 0 within ~5 x `RECENTER_TAU_MS`; strength gains 0 / .5 / 1.
- AC6 (CSS lock): every Click `.ip-wheel` / `.ip-center` background reads `var(--lx` and `var(--ly`
  (and no Seattle rule does); the band and glass pseudo-elements exist only under `.mms-lit`; no `filter` /
  `-webkit-filter` / `backdrop-filter` / `mask` / `-webkit-mask` in any lighting rule (case-insensitive,
  vendor spellings).
- AC7 (shells + census): every `public/*.html` that loads skin-surface.js loads pocket-lighting.js
  (dynamic enumeration, never a list); the Settings census reads `[Lighting, About]`; `lighting` is a
  non-item level with a title.
- AC8 (headless, `scripts/pocket-lighting-probe.js`): per skin, screenshots at the light at (0,0),
  (-.8,-.5), (.8,.5) (the visual evidence Dean gets in the report); `Performance.getMetrics` script +
  style + layout time per frame while the light moves (target < 1.5 ms/frame of main-thread work on
  this box) and while still (zero writes); `DOMDebugger.getEventListeners` on `window` reports 0
  `deviceorientation` listeners when Off, 1 when on, 0 after a dock.
- AC9 (byte-identical when Off): with the property unset, every calc resolves to the pre-change
  constant (a unit test resolves the four wheel rules with `--lx/--ly` = 0 and compares to the old
  literal positions).

## Built (2026-09-24) - the pre-gate evidence

- Unit: `test/unit/pocket-lighting.test.js` 14/14 (the pure half; AC1-AC7 through the REAL engine
  create()/paint()/click path with real event shapes; the CSS lock; the dynamic shell parity).
  Touched suites green: music-skins, pocket-quick-scroll, music-pocket-menus, skin-surface,
  token-scale-lock, css-token-lint, shell-script-global-collisions. `npm run lint:css` TOTAL 0;
  overlay-containment clean.
- Headless (`scripts/pocket-lighting-probe.js`, Playwright Chromium, 390x844 DPR 2, software GL):
  - listeners on `window` (`deviceorientation`): Off 0, On 1, docked 0, destroyed 0, Seattle 0.
  - CPU, 240 frames of a MOVING light: script 0.16 ms + style recalc 1.12 ms + layout 0 per frame
    (219 writes, 219 style recalcs, 0 layouts); 240 frames STILL: 0 writes, 0 recalcs, script 0.03 ms.
    Software-rendered, so an upper bound for the phone.
  - screenshots per Click skin at neutral / upper-left / lower-right (`--lx` -0.76..0.79): the wheel
    sheen and rim sit on the lit side, the drop shadows fall away, the body band slides; Black reads
    strongest, Matte softest (by design).
- The probe found (and the fix closed) a gap the jsdom drive missed: a dock while the frame loop was
  PARKED (no sample in flight) left the sensor listener bound until the next sample. The release is
  now STRUCTURAL - a MutationObserver on the panel (childList + the `hidden` attribute), the ghost
  lock's own pattern - and a unit test drives the parked dock.
- Parking rule refined: in tilt mode the loop parks only once the neutral pose has drifted onto a
  held tilt (else it froze the light off-centre); pointer mode parks at the goal.

## Mutants (sandbox from `git archive 31670637`, never the live tree; each guard DELETED, its test red)

  - M1 paint() never calls lighting.sync() -> # pass 8 # fail 6
  - M2 destroy() never calls lighting.destroy() -> # pass 12 # fail 2
  - M3 no MutationObserver (the parked dock) -> # pass 13 # fail 1
  - M4 a finger moves the light (mouse filter gone) -> # pass 13 # fail 1
  - M5 every skin is lit (isPocket ignored) -> # pass 13 # fail 1
  - M6 reduced motion ignored -> # pass 13 # fail 1
  - M7 the tray is lit -> # pass 13 # fail 1
  - M8 stop() keeps --lx/--ly and the class -> # pass 12 # fail 2
  - M9 TILT_SIGN flipped (the light follows the tilt) -> # pass 7 # fail 7
  - M10 requestPermission never called -> # pass 13 # fail 1
  - M11 a deny drops the note -> # pass 13 # fail 1
  - M12 the Click wheel keeps a literal sheen position (CSS lock) -> # pass 13 # fail 1
  - M13 a blur() sneaks into the band -> # pass 13 # fail 1
  - M14 one shell drops pocket-lighting.js -> # pass 13 # fail 1
  - M15 Settings shows Lighting even with no driver -> # pass 12 # fail 2
  - M16 the Lighting row tap does nothing (choose never called) -> # pass 11 # fail 3
  - M17 the dome shadow token stays static (lit shadows never directional) -> # pass 13 # fail 1
  - M18 Seattle gets lit (the CSS lock's Seattle axis) -> # pass 13 # fail 1

## Disclosed up front

- Headless Chromium proves the plumbing and the cost; the FEEL (sign, amplitude, the re-centre rate)
  is Dean's iPhone: three constants (`TILT_RANGE_DEG`, `RECENTER_TAU_MS`, `GAIN.subtle`) are the knobs
  if it reads wrong. The sign follows the intake ("slides the opposite way"); if Dean sees the light
  following the tilt, flip one constant (`TILT_SIGN`).
- iOS asks once and REMEMBERS a deny; the note names it, and only clearing the site's data (or
  re-installing the app) re-asks. Nothing we ship can re-prompt.
- Under reduced motion the lighting is Off outright (no static offset), by design.
- Seattle is out of this run (Dean's ruling), its look and Settings unchanged; the pad / flanks / glass
  are a follow-up if wanted.
- The podcasts view's Click skins get the lighting too (same skins, device-local setting)
  but carry no Settings menu (podcasts have no pocket menus), so the strength is set from Music.
- The landscape mapping is tested purely; on a phone the skin un-renders in landscape (the 768px
  gate), so it matters on tablets only.
