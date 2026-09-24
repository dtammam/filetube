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
   calc(-2px + var(--ly,0)*-2px) 4px <recess>, calc(var(--lx,0)*-4px) calc(1px + var(--ly,0)*-4px) 2px <drop>`.
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
  settles). `renderMenuList` draws `<span class="ipm-check">` on `check` rows (the iPod's check at
  the row's right; Seattle never shows the level).

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

## Gate r1 - adversary

Gate: CHANGES r1 @50f6158e — adversary

Instruments (live tree, read-only): pocket-lighting + pocket-quick-scroll + music-skins `# tests 111 # pass 111 # fail 0`; `npm run lint:css` TOTAL 0; overlay-containment clean (0). Every mutant and repro below ran in a `git archive HEAD` sandbox in the scratchpad (`zz-adv.test.js` = the builder's own boot() harness, the REAL engine).

Verified GREEN (measured, not read): risk 4 Off = today - headless Chromium 390x844, `git archive 71b5e6dd` vs HEAD with strength Off: the screenshot PNGs are BYTE-EQUAL for ipod / ipod-black / ipod-matte / zune-classic (0 px changed). Lit at --lx/--ly unset with the two pseudo layers hidden: 0 px changed, so the directional shadow tokens resolve to the static ones. Risk 2 z-order: lit at neutral changes ~115k body px (band maxd 106-117) but inside the wheel circle only maxd 3 (compositing noise). So the band paints over the body ramp and under the wheel/LCD. Panel computed `position:fixed; z-index:1100; overflow:hidden`. Seattle lit = 0 px changed. Risk 3: activate() is synchronous from the delegated click; requestPermission is called before any await.

WARNING W1 - hide then return kills the light until the next paint (named risk 1, the reverse axis). stop() unbinds the driver's own visibilitychange listener, so nothing re-syncs on the return. Nothing in production repaints on visible: music.js's visibilitychange only runs recheckChaptersOnReturn, and the engine's onDocVisibility only drives the cover drift. So on an iPhone, lock then unlock (or any app switch) = lighting dead until the next track. AC3(b)'s test hides the gap by calling `b.engine.paint()` before it re-asserts. Repro (ADV-A): paint, then hidden + visibilitychange, then visible + visibilitychange:
  `ADV-A before {"orient":1,"move":1,"leave":1} after return {"orient":0,"move":0,"leave":0} lit false` / `after a real tilt: --lx = ""`
  Fix: keep the visibility listener bound from create() until destroy(), or call lighting.sync() from the engine's onDocVisibility. Bind it with a hide-then-return test that has NO paint.
WARNING W2 - Seattle's Settings now shows Lighting. This breaks Dean's Seattle-unchanged ruling and the plan's "its Settings level shows no Lighting row". The engine creates the driver for EVERY skin, so `hasLighting: !!lighting` is true on Seattle. menuStaticItems ignores the `style` it is passed. Repro (ADV-F, skin zune-classic):
  `ADV-F seattle settings rows ["Lighting","About"]` / `after picking Pronounced ON SEATTLE: stored pronounced lit false`
  On iOS that tap asks for motion permission for a feature Seattle never shows. Gate the row on style === 'click' and add a Seattle census assert.
WARNING W3 - after an iOS deny, the note says "The look stays as today" but the panel is LIT and BOUND. AC4 says "denied ... binds nothing". Repro (ADV-B):
  `ADV-B note shown true mms-lit true listening {"orient":1,"move":1,"leave":1}`
  mms-lit on = the band + glass streak paint. Measured lit-neutral vs Off: 143,209 px changed, maxd 106. So the look is NOT today's. The AC4 test asserts only `lx ~ 0`, never `lit`/`listening` (a vacuous floor on the deny axis). Either drop .mms-lit while permission is denied and no mouse is driving, or change the note text and AC4.
WARNING W4 - the hard-constraint CSS lock is line-scoped. It only scans LINES matching `--l[xy]|mms-lit`, so a filter on its own line INSIDE the band rule slips through. Mutant MX1: `-webkit-backdrop-filter:blur(8px); backdrop-filter:blur(8px);` inserted as a new line in `.mms-ipod.mms-lit::before` -> `# pass 14 # fail 0`. Scope the lock by RULE BLOCK (any rule whose selector has mms-lit, plus every declaration that reads --lx/--ly).
SUGGESTION S1 - JS mutants that survive the 14 tests (each `# pass 14 # fail 0`): J1 stop() never disconnects the observer (one leaked MutationObserver per start/stop cycle). J2 disarm never calls cancelAnimationFrame. J3 tick drops the `!on` guard (J2 and J3 cover for each other, and each survives alone). J4 `if (moved)` removed, so every tick writes; the "writes only when moved" claim is bound only by the probe. J5 painted() ignores isConnected. J7 pointerleave eases home in tilt mode. J8 pointerLight unclamped (a captured wheel drag outside the panel can then write |--lx| > 1). J9 start() keeps the old neutral pose (G5 "a fresh open = a fresh neutral pose"). J11 orientationAngle ignores screen.orientation. J12 the no-sensor note also fires on a fine pointer. J15 a stale note survives a re-pick. Bind J1, J8, J9 and J15 at least.
SUGGESTION S2 (TOCTOU, low reachability on iOS since the prompt is modal) - choose()'s post-await sync() has no destroyed guard. A late grant re-binds a DESTROYED engine's driver, and it writes. Repro (ADV-C):
  `after destroy {"orient":0,...} lit false` -> `after the late grant {"orient":1,"move":1,"leave":1} lit true` -> `--lx = "-0.913"`
SUGGESTION S3 (suspicion, not measured on a device) - the band layer is `inset:-40%` + will-change. That is 1.8W x 1.8H = 3.24x the panel area: 702x1519 CSS px, about 9.6 Mpx at DPR 3. The translate only needs ~22% (x) / 18% (y) of overhang. The panel's overflow:hidden may or may not shrink WebKit's backing store. Shrinking the inset (and checking the gradient still reads) is cheap insurance under the ambient-mode lesson.
SUGGESTION S4 (suspicion) - the plan's "iOS remembers a grant/deny per site" is unverified at primary source. If WebKit keeps the decision per session only, a relaunched PWA binds with no stream and no prompt: a static band, no motion, no note. Worth a device check.
Tree: no live-tree mutation; the sandbox lives only in the scratchpad.

## Gate r1 - qa

Gate: CHANGES r1 @50f6158e — qa

Instruments (live tree, verbatim): `node --test test/unit/pocket-lighting.test.js` -> `# tests 14 # pass 14 # fail 0`; `npm run lint:css` -> `TOTAL 0  (the token census; ceiling ZERO since v1.61.0)`; `node scripts/overlay-containment-lint.js --enforce` -> `overlay-containment: clean (0 violations)`, exit 0; `npx eslint public/js/pocket-lighting.js public/js/skin-surface.js public/js/music-skins.js` -> no output, exit 0. Repros ran in a `git archive HEAD` sandbox (`qa-probe.test.js` = the builder's boot() harness, the REAL engine) and a headless-Chromium probe (a copy of pocket-lighting-probe.js on port 9347). Base = a `git archive 71b5e6dd` sandbox.

Verified GREEN: risk 3. activate() is reached synchronously from the delegated click (the ghost path re-dispatches `under.click()` inside the real click). choose() calls requestPermission before any await (asks=1 synchronously in AC4). Risk 4 Off = today: base vs HEAD, strength Off, each skin booted in isolation -> `IDENTICAL ipod-black-np / ipod-matte-np`. ipod-np and zune-classic-np were also IDENTICAL in the full-sequence run. The sequence run showed sparse dither noise on black/matte (maxDelta 13), and base-vs-base itself differs on Seattle, so that is raster noise, not CSS. Risk 5: the script is on all 10 shells that load skin-surface.js (grep -l on both = the same 10 files). TYPE_TITLE, NON_ITEM_LEVELS and the census carry `lighting`; lib/media-capabilities is not a lighting surface. Risk 6: the mouse path reads from source (mouseOnly, the SENSOR_FRESH_MS gate, pointerLight returns null at 0 size). The UX: the note row wraps inside Click's 173px pane (probe: `["Motion access was denied. The ", top 151, h 42, w 173]`, list 227/227, no overflow). The check glyph renders on the picked row (lighting-denied.png). MENU pops the level. The post-answer render is guarded to the lighting level.

WARNING W1 - Seattle gets the Lighting row, and on iOS the tap asks for motion permission. This breaks Dean's ruling and the plan's "Seattle's engine gets no driver". skin-surface.js:1333 creates the driver for every skin, :641 passes `hasLighting: !!lighting`, and music-skins.js:353 ignores `style`. Repro (QA1, skin zune-classic):
  `seattle settings rows: Lighting|About` / `asks after Seattle pick: 1 stored: pronounced lit: false`
  Headless: base `zune-classic Settings = About`, HEAD `Lighting|About` (the settings PNG DIFFERs). Fix: gate the row on `style === 'click'` and add a Seattle census assert.
WARNING W2 - hide then return leaves the light dead until the next paint (the resume axis of risk 1). stop() removes the driver's own visibilitychange listener. The engine's onDocVisibility (skin-surface.js:1866) only drives pocket.onVisibility, and music.js:1994 only re-checks chapters. So the plan's "sync() is called ... on visibilitychange" is false, and an iPhone lock/unlock kills the feature until the next track. AC3(b) hides this by calling `b.engine.paint()` before it re-asserts. Repro (QA4, no paint):
  `before: {"orient":1,...} lit true` -> `visible again, no paint: {"orient":0,"move":0,"leave":0} lit false --lx "" state.on false`
WARNING W3 - after an iOS deny the note says "The look stays as today", but the panel is lit and bound. AC4 says "denied ... binds nothing", and its test title quietly softened that to "binds nothing that streams". Its `lx ~ 0` assert passes whatever the deny does, because the first sample is always neutral. Repro (QA2):
  `denied: mms-lit class on panel = true ; listening = {"orient":1,"move":1,"leave":1}`
  Headless, Off vs lit-with-no-sample: `{"px":1316640,"differing":479631,"maxDelta":107}`. lit-nosample.png shows the static glass streak on the LCD and the body band. The same static look applies to any lit state with no stream.
(W1-W3 were also found independently by the adversary seat. I reproduced each one myself; I did not copy them.)
SUGGESTION S1 (comment accuracy):
  - music-skins.js:350-352 says hasLighting means "the Click skins with pocket-lighting.js loaded". It is true on Seattle (W1).
  - pocket-lighting.js:16-18 says the CSS animates "a transform and an opacity on small layers". No opacity is animated. The probe's LayerTree shows the band as a 702x1520 composited layer, 3.24x the 390x844 panel. That is the brief's "large animated layer" question; the adversary's S3 shrink applies.
  - The plan's wheel drop shadow reads `3px`; the code and the static token use `2px`, and the code is right.
  - The plan says Seattle's check is pink; there is no Seattle .ipm-check rule.
SUGGESTION S2 (reasoned, not driven) - on the denied level, setCursor (skin-surface.js:1077) clamps to items.length-1, so the wheel can park the cursor on the note row. renderMenuList never gives an info row `is-cursor`, so the highlight disappears and Select no-ops there. Clamp the cursor to the last non-info row.
SUGGESTION S3 (suspicion, device) - mapTilt uses raw beta/gamma. Near beta 90 (a phone held upright) gamma is unstable, so the light can swing edge to edge. Check on Dean's iPhone.
Security: no security surface of substance. There is no server route, network call or new dependency. The sensor values only ever become two CSS custom properties on the panel; nothing is sent or logged. The stored strength is whitelisted (normalizeStrength) before setItem and on read. The note text goes through esc(). The probe is a 127.0.0.1 dev script with a normalized, startsWith-checked static path.
Standards: no em dashes in the added diff (`grep -c` on the added lines = 0; the Gate line keeps the harness grammar). The tokens hold: lint TOTAL 0, and the z-index:-1/5 and 34px values carry token-exempt notes.
Tree: live tree untouched apart from this append. The adversary's r1 section was already uncommitted in this file when I started.

## Fix round 1 (the Architect, after both r1 verdicts)

Both seats found the same three warnings; every one is fixed, plus the hardening they suggested:

- adversary W1 / qa W2 (the light stays dead after a hide-and-return): the driver's `visibilitychange`
  listener now lives from `create()` to `destroy()`, not from `start()` to `stop()`, so the RETURN
  re-syncs by itself with no paint. AC3's hidden arm now asserts the return WITHOUT a paint and drives
  a tilt after it; `destroy()` is terminal (a visibility flip after it re-binds nothing).
- adversary W2 / qa W1 (Seattle's Settings showed Lighting): the controller passes `hasLighting` only
  when `style() === 'click'`; the census test and the AC3 Seattle arm assert `[About]` on Seattle.
- adversary W3 / qa W3 (a deny left the panel lit + listening): `wanted()` is false after a remembered
  deny on a device with no fine pointer; AC4 asserts not lit, nothing bound, `--lx` never written, and
  a re-pick clears the stale note (J15).
- adversary W4 (the CSS lock scanned lines): the lock now scans WHOLE RULES (every rule whose selector
  names `mms-lit` or whose body reads `--lx/--ly`).
- adversary S1 hardening tests: J1 (observers balance over 4 cycles), J2/J3 (Off cancels a live rAF),
  J4 (a still device at its neutral pose writes nothing over 60 sampled frames), J7 (a pointerleave
  never eases a sensor-driven light), J8 (pointerLight clamps a far-outside pointer), J9 (a fresh open
  is a fresh neutral pose), J11 (`screen.orientation.angle` 90 maps the tilt onto `--ly`), J12 (no
  no-sensor note on a fine pointer). Not covered by a test (disclosed): J5 (`isConnected` in
  `painted()`).
- adversary S2 (a late permission answer re-binding a destroyed driver): a `destroyed` flag; tested.
- adversary S3 / qa S1 (the band layer's size): `inset:-40%` -> `-25%` (2.25x the panel, not 3.24x;
  the largest translate is 12% of that box, so no overhang is ever exposed); the lock reads the new value.
- qa S3 (raw gamma is unstable upright): the left/right axis is now the GRAVITY-PROJECTED roll,
  `asin(cos(beta) * sin(gamma))` - flat it is gamma, upright it shrinks smoothly to 0 and keeps its
  sign past vertical (unit-tested at beta 40 / 80 / 90 / 100). Amplitude on a phone held at ~45 deg
  reads ~0.7x the flat range; `TILT_RANGE_DEG` is the knob if Dean wants more.
- qa S2 (the wheel could park on the note row): `setCursor` clamps to the last selectable row.
- qa S1 comment/plan slips fixed (no opacity animates; the drop blur is 2px; no Seattle check).
- Not changed, disclosed: adversary S4 / the plan's "iOS remembers a grant per site" is a device check.

Re-run on the fixed tree: `pocket-lighting.test.js` 15/15; the touched suites 272/272; eslint clean;
`lint:css` TOTAL 0; overlay clean. Probe: listeners Off 0 / On 1 / docked 0 / destroyed 0 / Seattle 0;
moving 0.17 ms script + 1.12 ms style per frame, 0 layouts; still 0 writes, 0 recalcs.

## Gate r2 - qa

Gate: CHANGES r2 @f7f7af9d — qa

Instruments (live tree, verbatim): `node --test test/unit/pocket-lighting.test.js` -> `# tests 15 # pass 15 # fail 0`; `npm run lint:css` -> `TOTAL 0  (the token census; ceiling ZERO since v1.61.0)`; `node scripts/overlay-containment-lint.js --enforce` -> `overlay-containment: clean (0 violations)`, exit 0; eslint on the three files -> no output, exit 0. The added lines carry no em dashes other than the two Gate lines. Repros ran in a fresh `git archive f7f7af9d` sandbox (`qa-r2.test.js`, the builder's boot() harness).

My r1 findings against f7f7af9d:
- W1 Seattle row: FIXED as prescribed. QA1 -> `seattle settings rows: About`.
- W2 hide/return: FIXED (the listener now lives from create() to destroy()). QA4, no paint -> `visible again, no paint: {"orient":1,"move":1,"leave":1} lit true --lx "-0.685"`.
- W3 deny: FIXED IN-SESSION. QA2b (coarse pointer, the iPhone shape) -> `lit false ; listening {"orient":0,...}`, and still `lit false` after a hide/return.
- S1 comments: fixed. I checked the new CSS arithmetic: 12% of a 1.5W box is 0.18W and 10% is 0.15H, both inside the 0.25 overhang, and 1.5^2 = 2.25x.
- S2 cursor clamp: fixed. On an all-info level (About) the clamp parks at 0. About's 4-5 rows fit the 227px list, so nothing becomes unreachable.
- S3 roll: fixed. asin(cos(beta)*sin(gamma)) is the device x-axis elevation derived from the rotation matrix, so it is independent of representation and continuous through vertical. The neutral-pose drift works on that continuous value, so the drift is unaffected.
- New surfaces: the standing visibility listener balances on both surfaces (QA6: `otherDoc false/true vis created 1 painted 2 destroyed 0`, and a hide/return after destroy leaves `{"orient":0,...} lit false`). The pop-out teardown -> pipEngine.destroy() path is unchanged.

WARNING W4 - after an iOS deny, the NEXT launch is lit again, with no note. `permission` lives only in memory, so a cold start forgets the deny. `wanted()` is then true, and the panel shows the static band + glass streak with a listener that iOS will never feed. That is the same look the r1 W3 note ("The look stays as today") promised away. It happens on every launch until the user picks Off. The outcome is deterministic whatever iOS persists: a remembered deny streams nothing, and a per-session policy streams nothing without a tap. Repro (QA5, strength pronounced, coarse pointer, a deny behind requestPermission, a fresh boot):
  `relaunch after deny: lit true listening {"orient":1,"move":1,"leave":1}`
  Fix (cheap): on a device where `requestPermission` exists and there is no fine pointer, add `.mms-lit` only once the first sample arrives (lit-on-first-sample). That also closes the adversary's S4 grant-not-persisted case with no device knowledge. The alternative is to persist the deny next to the strength and clear it on a re-pick.
WARNING W5 (new, in r1 code I missed) - the "lying down" pose (G5) slams the light edge to edge. `y` is raw beta, and beta wraps at +-180. Holding the phone overhead screen-down (lying on your back) jitters across that wrap. Measured through the pure functions (mapTilt -> recentre, gamma 2):
  `beta 179.5 -> y goal -0.018` / `beta -179.8 -> y goal 1.000` / `beta 179.6 -> y goal -0.047` / `beta -179.5 -> y goal 1.000`
  The baseline drift then averages +179 and -179 toward 0, a nonsense neutral pose. Fix: take the wrap-aware difference (((t - b + 540) % 360) - 180) in recentre, and a unit test across the seam.
SUGGESTION - the pocket-lighting.js header now says the CSS "translates two thin gradient layers". The layers are 2.25x the panel and 2x the LCD; the thin part is the stripe painted on them. Say "two gradient layers".
Security: unchanged from r1 - no route, network, dependency or logging. The `destroyed` guard now also stops a late permission answer from re-binding.
Tree: live tree untouched apart from this append (plus the uncommitted r2 sections of other seats, if any); the sandboxes are in the scratchpad.

## Gate r2 - adversary

Gate: CHANGES r2 @f7f7af9d — adversary

Every check below re-ran in a fresh `git archive f7f7af9d` sandbox, with my ADV repros moved onto the new boot() harness. Baseline in the sandbox: `pocket-lighting.test.js # pass 15 # fail 0`.

My r1 findings against f7f7af9d:
- W1 hide/return: FIXED. ADV-A, no paint -> `after return {"orient":1,"move":1,"leave":1} lit true` / `after a real tilt: --lx = "-0.685"`. Reverting the fix (R1) -> `# pass 8 # fail 7`.
  - The new standing listener balances on both surfaces (ADV-G). In-tab and pop-out, Off and Pronounced, all read `vis created 1 painted 2 ... after destroy vis 0`, and a visibilitychange after destroy leaves `{"orient":0,...} lit false`. R6 (destroy never unbinds it) -> `# fail 3`.
- W2 Seattle row: FIXED. ADV-F -> `seattle settings rows ["About"]`. R7 revert -> `# fail 1`.
- W3 deny: FIXED FOR THE SESSION ONLY. ADV-B2 (coarse pointer) -> `mms-lit false listening {"orient":0,...}`. The re-create arm still lights: `cold relaunch, stored pronounced ...: lit true {"orient":1,"move":1,"leave":1}`. That is the same finding as qa's r2 W4, and I endorse qa's lit-on-first-sample fix. A music view swap re-creates the engine too, so it reaches in-session as well as on relaunch.
- W4 CSS lock: FIXED. Five mutants now go red (each `# fail 1`): MX1 (backdrop blur on its own line in the band), MX3 (`FILTER:` caps in the glass), MX4 (mask in the lit root), MX5 (a blur in a sibling lit rule), MX7 (inset back to -40%).
- S2 late grant: FIXED. ADV-C -> `after the late grant {"orient":0,...} lit false`, `--lx = ""`. R3 and R4 each survive alone (two guards covering each other). Together they give `# fail 1`, so it is bound.
- S3 inset -25%: headless Chromium, base 71b5e6dd vs f7f7af9d with lighting Off. The PNGs are still BYTE-EQUAL for ipod / black / matte / zune-classic (0 px). Lit at neutral with the pseudo layers hidden: 0 px. The band still sits under the wheel (maxd 3 inside the wheel circle) and over the body (~126k px changed). Seattle lit: 0 px.
- S1 surviving mutants, now `# pass 14 # fail 1` each: J1, J4, J8, J9, J11, J12, J15. J5 is disclosed as untested.

WARNING W5 (new, in the fix's own claim "an upright phone never flips") - the y axis still flips at vertical. x is now the projected roll and is continuous, but y is still raw beta. When a slightly rolled upright phone crosses vertical, the W3C decomposition swaps (beta b, gamma g) for (180-b, -g). So the y goal jumps by about 2x the roll. I checked this through the real `mapTilt`, feeding it W3C Euler angles derived from a physical up-vector (roll 8 deg, the pitch crossing vertical):
  `pitch -0.2: beta 82.0 gamma 88.6 -> x 8.00 y 82.0` / `pitch 0.2: beta 98.0 gamma -88.6 -> x 8.00 y 98.0`
  - With roll 20 the jump is 70.0 -> 110.0. That is 40 deg against a TILT_RANGE of 28, which is qa's "edge to edge" symptom, now on y.
  - Fix: y = atan2(sin b, cos b * cos g). It is continuous through vertical (`roll 20: 89.8 -> 90.2`) and equals beta when flat (`atan2 at b=30,g=0 -> 30.0`).
  - It still wraps at +-180, so qa's r2 W5 wrap-aware difference is needed too. Add a unit test that sweeps a physical pose through vertical.
  - Verified against the W3C formula, not on a device.
SUGGESTION S5 - three "hardening" claims are still unbound (vacuous):
  - J2 (no cancelAnimationFrame) and J3 (tick drops `!on`) each give `# pass 15 # fail 0`. The Off test asserts `S(b).raf === false`, which reads the driver's own bookkeeping, and disarm nulls that whether or not the frame is cancelled. Assert `b.clock.live() === 0` instead.
  - J7 (a pointerleave eases a sensor-driven light) gives `# pass 15 # fail 0`. The test dispatches the leave and then a tilt at once, and that tilt resets `leaving` before any frame runs. Advance the clock between the leave and the next sample.
  - qa's S2 cursor clamp (R8) is unbound across pocket-lighting, pocket-quick-scroll, music-pocket-menus and skin-surface: `# pass 155 # fail 0` with the clamp deleted.
Tree: the only change to the live tree is this append. The file also holds the uncommitted r1/r2 sections from both seats; I did not touch them.

## Fix round 2 (the Architect, after both r2 verdicts; Dean's ruling: "Fix now + short round 3")

- qa W4 / adversary W3-relaunch (a re-created engine after a deny, or a forgotten grant, showed a
  lit-but-still panel): where the sensor sits behind a permission API AND no fine pointer exists,
  `.mms-lit` waits for the FIRST sample of this start (`litGated` / `applyLit`); a desktop or Android
  is lit at once. Tested: bound but not lit until a sample; a stop/start re-gates; the two non-gated
  shapes lit at once. This also closes the adversary's r1 S4 without device knowledge.
- qa W5 (beta wraps at +-180 lying on your back): every angle difference is `wrapDiff` (the short way
  round) and the baseline stays folded; tested across the seam (pure) and the held pose settles the
  short way.
- adversary W5 (raw beta jumped by twice the roll when a rolled upright phone crossed vertical): the
  pitch is `atan2(sin b, cos b * cos g)` - continuous through vertical, beta when flat; tested with a
  physical pose (roll 20 deg) swept through vertical via W3C Euler angles: y moves < 1.5 deg per step.
- adversary S5: J2 bound by the clock (a hide while the loop is live leaves no frame pending); J7's
  test advances between the leave and the next sample; the cursor clamp (qa r1 S2) is now driven by
  the REAL wheel gesture on the denied Lighting level (4 detents down parks on Pronounced, not the
  note; 1 up lands on Subtle). J3 alone is still covered by J2 (disclosed).
- The header comment: "two gradient layers (each painting one thin stripe)".

Re-run: `pocket-lighting.test.js` 15/15; the touched suites 257/257; eslint clean; `lint:css` TOTAL 0;
overlay clean. Probe: listeners Off 0 / On 1 / docked 0 / destroyed 0 / Seattle 0; moving 0.17 ms
script + 1.02 ms style per frame, 0 layouts; still 0 writes, 0 recalcs.
