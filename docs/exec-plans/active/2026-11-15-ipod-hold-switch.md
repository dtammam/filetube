---
plan: ipod-hold-switch
harness: v2 · full
branch: feat/v1.408.0-ipod-hold
anchor: outcome
status: W0-W4 done (W1 539e9232, W2 c04e80e4 + 172d6666, W3 0ddf01cf, W4 on this branch), W5 (gate) next
next: W5 the gate (adversary + qa), then the release
design: Dean, 2026-11-15 (intake, rulings R1-R9 below)
gate: pending (adversary floor + qa per .harness/scrutiny.toml)
builder: smart
---

# iPod skins: cut under the Dynamic Island, a real Hold switch, and a dimmed low-power stage (v1.408.0)

Kickoff 2026-11-15 (FileTube Root). **Builder: Smart (Opus)** - an open design (per-model switch art), shared player and
lifecycle code, and an iOS contract half. If W0's design review shows W1-W4 are mechanical, say so to Dean and he may hand
them to a Sonnet builder; do not hand off yourself.

## The outcome Dean will see (his words, 2026-11-15)

On the phone's Click (iPod) now-playing skins the iPod no longer sits as a full-bleed page under the Dynamic Island: it
**stops right under the island's bottom edge** with a clean line, a solid black strip above it. A **Hold switch** sits on
the top edge exactly as on the real model (position, size, colour, the slide, the orange or red reveal); sliding it on makes
the screen **ignore every touch**, sliding it off gives touch back. While Hold is on the screen stays awake; after ~30 s
without a touch it goes into a **dimmed, frozen, low-power look** (the closest an app can get to the iPhone's always-on
display); and after a longer set time the app lets the phone **lock normally**, where iOS's own always-on lock screen with
Now Playing takes over. Music keeps playing the whole time.

## Rulings (Dean's answers; all final)

| # | Ruling |
|---|---|
| R1 | Applies to ALL the Click skins (every `renderIpod` skin in `public/js/music-skins.js` SKINS). Original (`ipod-original`, `look: 'original'`) is its own look of the real first-gen iPod; every other skin shares one design, varied by real model (mirror reality: colour, position, size, the slide, the indicator). Not a toggle: it is just there. |
| R2 | The iPod body ends flush under the Dynamic Island's bottom edge (a clean line, no border); the island no longer floats mid-iPod. Black above it. Must work on the iPhone 15 Pro and other modern phone sizes (island and notch phones, SE, small and Max). |
| R3 | Hold ON: ignore ALL input on the screen (wheel, zones, scrub, menu, collapse, swipes, the LCD) EXCEPT the Hold switch. A touch on the switch unlocks. A touch anywhere else only WAKES the screen to full brightness (and restarts the idle timer) and does nothing else. Hold stays on until the switch is slid off. |
| R4 | Hold keeps the screen awake. Stages (Dean picked C): (1) Hold on, full brightness, awake; (2) after ~30 s with no touch: dim + freeze + once-a-second refresh ("always-on look"; Dean wants the REAL iOS always-on level where it exists, so see R5/R6); (3) after a longer set time the app stops keeping the phone awake and lets it lock; iOS's own lock screen always-on takes over. Default for stage 3: 5 min after Hold went on with no touch (the Root's default, Dean may overrule; one named constant). |
| R5 | A web page / WKWebView cannot select the OS always-on mode or a 1 Hz refresh for an unlocked screen (Root's understanding; the iOS Root confirms). The web half builds the dim/freeze stage so it works in the PWA and Safari with NO host. The iOS half (optional host capability) adds: idle timer off while Hold is on, real brightness dim in stage 2, the lowest frame rate iOS allows (a `CADisplayLink` preferred range or equivalent), and restore on wake / unlock / leaving the player. |
| R6 | Lock-screen and Control Center media controls (Media Session) and the hardware volume buttons keep working with Hold on. Nothing in this wave touches them; a test proves it. |
| R7 | Visually distinctive and accurate: W0 collects reference photos per model and Dean approves the look BEFORE the gate. |
| R8 | Hold is per player session, NOT persisted across a reload (it can never trap Dean in a locked page), and releases (with the wake lock / host keep-awake) when the full player closes or the page hides for good. |
| R9 | No user-facing setting for any of this beyond the switch itself. No Settings toggle (Dean's "no toggle workarounds" norm). |

## Step 0 (read before anything)

- `AGENTS.md`, then `docs/LESSONS.md` sections 3, 4, 6, 11 (CSS/SPA traps, overlay containment, presence-not-binding, inert
  feature: PROVE REACHABILITY with the real upstream shape) and `docs/CONTRIBUTING.md`. `docs/references/native-bridge.md`
  and `docs/references/native-bridge.v1.schema.json` (add-only within v1; schema wins) and `docs/references/ios-host.md`
  if present. The completed plan `docs/exec-plans/completed/2026-09-25-pocket-design-system.md` (the Pocket's tokens and
  geometry) and `2026-09-24-pocket-gyro-lighting.md` (the sheen you must freeze).
- Environment, git and push rules exactly as in AGENTS.md and memory (fnm Node 22.23.1 and 24.20.0 PATH; stage by name;
  commits with `-F <file>`; no `--no-verify`; never self-merge; main is protected: PR flow, ask Dean before `gh pr merge`).
  Work in a worktree if the Root is editing the main checkout.
- Stop rules: (a) W0's look is not approved by Dean -> do not build the switch art; (b) a skin line with NO real Hold switch
  (iPod touch, shuffle-like, clip-like if present in SKINS) -> list them and ask Dean (AskUserQuestion) what they show
  (mirror reality = nothing); (c) the island cut needs a layout change outside the Pocket (`.mms-full` and its siblings) ->
  stop and report the measured blast radius; (d) any measurement says touch blocking can swallow the switch itself, the
  Media Session, or the hardware volume path -> stop and report.

## Seams (verified in the tree at 24e96d88; re-verify before editing)

- Skin registry: `public/js/music-skins.js:305` `SKINS` (ids, `line`: classic / mini / nano / ..., `look: 'original'` on
  `ipod-original` at ~436); the Click renderer `renderIpod` at ~283 returns the LCD (`ipScreen`) + the `.ip-wheel` zones.
  The Hold switch is rendered by the SAME writer for every Click skin (one writer, the inert-sibling guard) and carries a
  stable hook in the `data-skin-*` family (`data-skin-hold`); `music.js` proxies skin hooks, so wire it there.
- Layout: `public/css/style.css` ~9257 `.mms-full` (fixed, `inset:0`, z `--z-player-max`, `touch-action:none`), ~9362 / 9385 /
  9499 the portrait paddings reading `var(--mms-up-top, var(--pk-top-inset, env(safe-area-inset-top,0px)))`; ~9520 `.ip-lcd`;
  ~11497 the Original look. `public/js/pocket-lighting.js:118` `--pk-top-inset` and `installTurnInset` (the stale
  `env(safe-area-inset-top)` for ~200 ms after a turn, ROADMAP 2026-10-02: the island cut MUST use the same effective inset
  or it will jump on a turn). Gyro sheen to freeze: `pocket-lighting.js` and the `.mms-lit` rules ~11559.
- Pocket engine: `public/js/skin-surface.js` `createPocketMenu` (~796) and the skin object returned ~4226 (it has
  `setWheelTakeover`; Hold must sit ABOVE it, not inside the wheel logic).
- Host: `public/js/host-adapter.js` (`CAPABILITIES` line 14; message table ~188 with `cap` and `fieldCaps`). New capability
  `idleDisplay` (name is yours to confirm in W0) with messages `display.hold { on }` (idle timer off + stage) and
  `display.dim { on }`; both fire-and-forget, released by the host on navigation commit like every capability
  (native-bridge.md rules; `pageshow` persisted re-posts). Add the schema entry and the contract test
  (`test/unit/native-bridge-contract.test.js`).
- Wake lock on the web: `navigator.wakeLock.request('screen')` where it exists (iOS 16.4+ PWA), re-requested on
  `visibilitychange`; absent = silent no-op. There is none in `public/js` today (grep'd).

## Waves

**W0 - research and a LOOK for Dean (no product code).** Gather reference photos per model Dean's skins mirror (Classic 1/2/3,
Mini 1/2, Slim 2/3/4+ and the first-gen Original): hold switch edge, side from the front, size, travel, track colour, the
orange reveal (U2 editions: red). Do not trust memory or one search snippet (a snippet already conflicted on the nano 2G):
open the photos, note source URLs. Build ONE static HTML mock (Original + one shared-design skin, off / on, the island cut at
393x852 and one small phone) in the scratchpad and SendUserFile it; Dean answers fast. Also report: which lines in SKINS have
no real Hold switch (stop rule b). Dean's approval of the look is the exit of W0.

**W1 - the island cut.** The Click now-playing body starts at the island's bottom edge using the effective top inset
(turn-safe), black above; every phone size; no change to non-Click skins (Cider, Nordic). Measure with the probes pattern in
`scripts/native-video-surface-probe.js` at 393x852 (15 Pro), 430x932, 375x812, 320x568: the island's bottom y vs the body's
top y. Geometry VPM checks (`test/geometry`) must stay green.

**W2 - the Hold switch (touch blocking).** The switch per W0, one writer for all Click skins, `data-skin-hold`, an `aria`
role=switch with `aria-checked`, a real slide animation (reduced-motion: no animation, same state). A capture-phase blocker on
the player: with Hold on, swallow touch / pointer / click / wheel / key events not targeting the switch. Prove reachability
through the REAL Pocket wheel and menu path (not a unit stub), including multi-touch, a drag that STARTS on the switch and
ends elsewhere, and the iOS text loupe. The Media Session actions and the volume path are untouched (R6): a test asserts
`navigator.mediaSession` handlers still fire. R8 lifecycle: releases on close.

**W3 - stages.** Hold on -> awake (Wake Lock + host `display.hold`); ~30 s idle -> stage 2 (dark dim layer, gyro sheen and
CSS animations frozen, clock and progress ticking once a second from the engine's own state, nothing that repaints per frame;
a touch wakes without acting; the switch still unlocks); then the R4 stage-3 constant -> release the keep-awake. Constants named
and tested with fake timers; wake / dim / release each have a mutant that goes red.

**W4 - the host contract (iOS half).** Add `idleDisplay` to `docs/references/native-bridge.md`, the schema, `host-adapter.js`
and tests (add-only; both sides ignore the unknown). Write the relay for the iOS Root (idle timer, brightness dim and restore,
lowest frame rate, restore on wake / unlock / leaving the player, the stage clock stays web-owned) into this plan's Evidence;
Dean pastes it or the Root sends it (the builder asks via `ListAgents`/`SendMessage` only with Dean's word).

**W5 - gate, release.** Gate: adversary (floor) + qa, brief them with LESSONS 3, 4, 6, 11 and these attack surfaces: a touch
that gets past the blocker (the switch, a drag, a long-press, a scroll, an iOS gesture), a Hold that cannot be released, a
wake lock leaked after close, the stale-inset jump on a turn, the frozen layer leaving the media element repainting. Not a
data-loss change. Release v1.408.0 per `docs/RELEASING.md`: ROADMAP, `docs/releases.json` entry, a LESSONS entry in the
release commit, DEVICE-CHECKS lines below, no per-release memory file. Visual baselines will legitimately change: refresh them
ONCE at the end (the screenshot-shuffle anti-pattern is banned). Close the plan with `node scripts/plan-complete.js`.

## Device checks Dean will owe (write them into docs/DEVICE-CHECKS.md)

(a) iPhone 15 Pro: the iPod sits under the island on every Click skin, no jump on a turn; (b) the switch looks and slides like
the model on at least Original, Classic, Mini, Slim; (c) Hold on: nothing responds, the wheel is dead, a touch elsewhere only
wakes, a touch on the switch unlocks; (d) lock-screen controls and the volume buttons work with Hold on; (e) ~30 s later the dim
stage; a touch wakes it; (f) the long timeout lets the phone lock and iOS shows its own lock screen; (g) with the app half: real
dimming and idle timer.

## Out of scope

Cider and Nordic skins; a Settings option; persisting Hold; the real OS always-on (not reachable by an app); any iOS source
(the iOS Root builds its half from the relay).

## Evidence (the builder fills this)

### W0 - research and the look (2026-11-15)

Reference research (photos opened, sources: Apple support.apple.com/103823 and user guides ma629, ma1194, ma1195, ma1551,
ma1624; iFixit guides 364, 371, 388, 407, 430, 562, 592, 604, 745, 1157, 171848, 236876; Wikimedia Commons
File:Ipod_g2_top.jpg, File:IPod_classic_80_GB_(A1238,_YMV)-9877.jpg, File:IPod-nano-5G-end-views-1.png; ipodwiki Hold_switch):
- On every model Hold ON slides the knob TOWARD THE CENTRE of the edge (Apple: "Slide the switch toward the center (so you can
  see the orange stripe)"); the screen shows a lock icon in place of the title.
- Top RIGHT: Original 1G/2G (centre ~77%, slot ~24% of the width, a big white block with a ridge) and the 4G (Classic 1, ~79%,
  ~21%, satin pill). Top LEFT: everything else (5G, 6G, mini, nano 1G/2G ~17-22%; nano 4G ~12% / nano 5G ~17%, a short slot
  with a small round knob). Nano 3G: BOTTOM edge. No Hold switch at all: nano 6G/7G, every shuffle, every touch
  (stop rule b). The U2 red indicator is a one-source claim for the 5.5G only: not used.

Dean's rulings (AskUserQuestion, 2026-11-15):
- R10 Lines with no real switch (Slim 6, Slim 7, Clip 1-4, Touch 1-4) get the SHARED switch anyway (top left).
- R11 Slim 3 draws its switch on TOP like the rest (not the real bottom edge).
- R12 The cut line is the effective top safe-area inset (59 pt on the 15 Pro), not a guessed island bottom.
- R13 The look (v1 "looked cheap / forced"; v2 approved): a STRAIGHT-ON FRONT VIEW - the body's top EDGE shows as a thin
  band (chrome on the Original and Classics, the end cap on Mini / Slim) and the Hold knob is a thin raised sliver above it
  in the black strip; ON slides it toward the centre; no orange visible from the front; the LCD shows the lock in place of
  the title. Dean on v2: "Generally good, just make the thing slide appropriately and also make it have a generous touch
  area" (a real slide animation; a hit area well beyond the drawn sliver).
- W1-W4 are not mechanical (a capture-phase input blocker over the shared Pocket engine, a lifecycle, a host contract): they
  stay with this Smart builder.

Mock: scratchpad ipod-hold-look-v2.html (rendered from the real app CSS by a scratch CDP shooter, the island and status bar
drawn in; not committed).

### W1 - the island cut (539e9232)

- The cut is the effective top inset (R12), the SAME chain the chassis padding reads (Upright turn, turn window, env()), never
  under --pk-hold-strip-min (8 px: a Safari tab has no inset); the Sideways layout cuts by env() like its D7 block. Phone only
  (its own section after the takeover block; the pop-out keeps the full-bleed body). Non-Click skins: no strip.
- Measured (scripts/pocket-top-edge-probe.js, headless Chromium, the inset set through the turn property since headless has no
  safe area): `TOTAL: 35 rows, 0 failed` - body top 59 / 59 / 50 / 20 at 393x852, 430x932, 375x812, 320x568, 8 with no
  inset; LCD top unchanged from main (75 at 393x852). `SIDEWAYS=1` 852x393 with the turn property at 59: body top 8 (env),
  `TOTAL: 4 rows, 0 failed`. The island's own bottom is not readable by a web page (R12), so it is not a column.
- Geometry suite (before the CSS moved to its own section): `geometry: 476 checks - 476 ok, 0 FAIL`.
- Seam re-verified: `data-skin-*` hooks are routed by the ENGINE (skin-surface.js onClick), not music.js; Hold lives in the engine,
  so music, podcasts and the pop-out share one writer.

### W2 - the Hold switch and touch blocking

- The switch is the app's `ui-switch` primitive (role="switch", aria-checked), repainted by the skin (every property the
  primitive paints is reset); the knob is drawn on the strip after it (its place is a fraction of the body's width), the button
  under it is the hit area: 16 px past the slot each side, 34 px up into the strip, 18 px down over the body, clamped to the glass
  (found by the probe at 320 px: the Slim 4 area started at x = -3.19).
- One capture listener per input type on the WINDOW, only while Hold is on (`HOLD_EVENTS`; contextmenu stays in
  interaction.js, D6: every long press starts from a swallowed press). A press that starts on the switch is the switch's until it
  lifts; a tap flips, a slide toward the centre is on, back is off, read in the player's own frame (Upright turn undone). Engaging
  Hold ends a live wheel spin and blurs a focused control in the player (the keyboard-search input), never the switch.
- R8: released when the full player hides or loses mms-full (an observer: a view can clear it with no engine call), on pagehide
  not persisted, and on destroy; nothing stored (a localStorage spy).
- R6: Hold registers and clears no Media Session handler; a handler called the way the OS calls it runs with Hold on.
- Tests: test/unit/pocket-hold.test.js (10), test/integration/pocket-hold.test.js (7, the real music.js view + engine + menus +
  a real server, each "Hold blocks X" with its Hold-off control). 21 mutants, each red by name (blocker inert, no
  preventDefault, no stopImmediatePropagation, the switch gesture refused, no close / pagehide / destroy release, persisted
  ignored, no click dedup, the right side ignored, paint drops the class, the renderer ignores Hold, disarm leaks, a spin
  survives, no unturn, arms with no player, a cancel toggles, the switch allows all, a press stacks listeners, no blur, blurs
  the switch).
- Real touches in Chromium (CDP Input.dispatchTouchEvent, `HOLD=1`): a tap at the hit area's corner turns Hold on, MENU then
  opens nothing, the opposite corner turns it off, MENU opens again; the knob's place and length checked against tokens.css
  (read by the probe, not from the element): `TOTAL: 35 rows, 0 failed`; a mutant moving the slot: `TOTAL: 1 rows, 1 failed`.
- Old locks updated in place with their intent: skin-status-bar (the bar now opens with the lock mark; the title keeps its box,
  `visibility:hidden`, never a display change), pocket-kb-search R9 (Hold's blocker classified).

### W3 - stages

- Constants (skin-surface.js, exported): `HOLD_DIM_MS = 30000`, `HOLD_SLEEP_MS = 300000` (R4's default, Dean may move it),
  `HOLD_TICK_MS = 1000`; `holdStageWait(stage)`: each timer moves ONE stage (stage 1 lasts 30 s, stage 2 the rest of 5 min,
  stage 3 waits for a touch), and every wake (a swallowed touch, a key, a press on the switch, the page coming back) starts
  stage 1 again and re-asserts the keep-awake.
- Keep-awake (web): the Screen Wake Lock, asked only on a visible page, held in stages 1-2, let go at 3 and on Hold off; a grant
  that lands after the let-go is released at once (the request is a promise). Found by the stage tests: a touch while the page
  was hidden reached stage 1 without its wake lock, and the return never asked again (the phone would lock under Hold) - a wake
  now always re-asserts.
- The dimmed stage: `.ip-dim` (the renderer's last element, local z 41 from tokens.css - over the sticker at 40, which is injected
  after it; a census derives every numeric z of the player's rules) fades in by opacity; every animation and transition under it
  pauses; the light's loop is frozen (pocket-lighting.js `frozen`: no frame is scheduled; the tilt sensor is not an input Hold
  swallows, so this is what stops it); the cover drift stops (`slidesWanted`); the screen is written by the engine's own 1 s tick
  and the view's faster reflects write nothing; a wake catches up at once.
- Tests: test/unit/pocket-hold-stages.test.js (10, the real engine + lighting + Pocket menus on a fake clock, a spec-shaped wake
  lock stub), the drift through the real music view (pocket-idle-art.test.js, +1). Mutants (22): wake not re-asserted, the clock not
  restarted, a blocked touch not waking, stage 3 keeping awake, the dim releasing early, no dim at 2, both constants, a late grant
  kept, no wake on return, asking while hidden, no 1 s throttle, a tick that writes nothing, no catch-up, the light not frozen, the
  lighting arm ignoring it, the drift not frozen, no drift re-sync, timers surviving Hold off, the dim z at 40 - each red. Two
  redundant guards REMOVED rather than kept unbound (destroy's extra keep-awake release; the lighting tick's own freeze check:
  the frame reschedules through arm()).
- Chromium, the real 30 s (`DIM=1`, 393x852 and 320x568, three skins): the dim covers the player at opacity 1, the wake lock was
  asked once, the progress bar's style was written 5 times in 5 s under the dim vs 19 awake (the control), a touch woke it with
  Hold still on: `TOTAL: 6 rows, 0 failed`. The sticker under the dim: pixel (193,33,34) at z 40 -> (54,9,9) at 41.

### W4 - the host contract (idleDisplay)

- Capability `idleDisplay` (name confirmed), messages `display.hold { on }` and `display.dim { on }`: the schema (authority), the
  adapter's tables (`test/unit/native-bridge-contract.test.js` conformance green), native-bridge.md sections 1, 2, 5 and 6. Add-only.
- The engine's half is a registry beside the status bar's (module-level owners, posts only on a change, the 1 s self-heal poll,
  released on pagehide, re-sent on a persisted pageshow); the stage clock stays the web's.
- Tests: test/unit/native-bridge-idle-display.test.js (6, the real engine + the real adapter + a fake host). Mutants (9), each red:
  no host wiring, stage 3 keeping the host awake, stage 3 undimming, a post on every apply, pagehide keeping the host, no pageshow
  re-send, no self-heal, an owner that ignores its panel, the adapter's capability gate removed.

#### The relay for the iOS Root (Dean pastes it, or the Root sends it on Dean's word)

**Relay for the iOS Root (filetube-ios) - FileTube v1.408.0, capability `idleDisplay` (bridge v1, add-only)**

What the web does (shipped in v1.408.0, works with no host): the Click (iPod) full player has a real Hold switch. With Hold on,
the screen ignores every touch except the switch, and the web runs a stage clock it owns: (1) awake; (2) after 30 s with no touch,
a dimmed, frozen look (the web stops every animation, the gyro light and the cover drift, and writes the clock and progress once
a second); (3) after 5 min with no touch, it stops keeping the phone awake so iOS locks it and the lock screen's always-on Now
Playing takes over. A touch anywhere wakes back to (1). Music never stops; the lock screen and the volume buttons are untouched.
The web keeps the phone awake itself with the Screen Wake Lock, which WKWebView may not honour - that is what this capability is for.

Announce `idleDisplay` in `window.FileTubeHost.capabilities` once the build implements the two messages below. Both are fire and
forget, sent only on a change, both `{ v: 1, type, on: boolean }`:

| type | sent | what native does |
|---|---|---|
| `display.hold` | `on: true` when Hold goes on and on every wake (stages 1-2); `on: false` at stage 3, at Hold off and when the full player closes | `true`: `UIApplication.shared.isIdleTimerDisabled = true`. `false`: back to `false` (the phone may auto-lock again) |
| `display.dim` | `on: true` entering stage 2 (it stays true in stage 3); `on: false` on a wake, at Hold off and when the full player closes | `true`: remember `UIScreen.main.brightness`, ramp it down (suggested: to max(0.05, saved x 0.3) over ~1 s, matching the web's 1.2 s fade) and ask for the lowest frame rate the app can (any `CADisplayLink` the app owns: `preferredFrameRateRange` at its minimum; ProMotion idles the web view's compositor by itself once nothing on the page moves, which the web guarantees in stage 2). `false`: restore the remembered brightness |

Native must also:
- Restore the brightness and re-enable the idle timer on `willResignActive` / `didEnterBackground` (never leave the system dimmed
  or awake behind the app), on every main-frame navigation commit, and when the web view goes away - like every other held
  capability (native-bridge.md section 6). A page restored from the back-forward cache re-posts what it still wants on `pageshow`.
- RE-APPLY the last `display.hold` / `display.dim` it was sent on `didBecomeActive` (Control Center and a notification pull resign
  the app without hiding the page, so the web gets no event then); after a real hide the web also re-sends both values when the page
  shows again (they agree: it is the same state).
- Never time anything: the stage clock is the web's. On return to the foreground the web wakes (stage 1) and posts
  `display.dim { on: false }` / `display.hold { on: true }` itself.
- Not select an always-on or 1 Hz mode for the unlocked app (iOS gives apps no API for it); stage 3 is exactly "let iOS lock and
  show its own always-on lock screen".

Schema: docs/references/native-bridge.v1.schema.json (the two webToNative branches, the capability in host.capabilities).
Device check for the app build (DEVICE-CHECKS "Hold switch (v1.408.0)" (g)): with Hold on, the phone does not auto-lock in the
first 5 min; at ~30 s the screen really dims (not only the web's layer); a touch brings the brightness back; after 5 min the phone
locks by itself and the lock screen shows Now Playing; leaving the player or the app restores brightness.

## Gate

(pending)

Gate: CHANGES r1 @a27fa97d - qa

Measured at a27fa97d (Node 22.23.1): `npm run lint` 0 errors, 6 warnings (exit 0); `npm run lint:ui` OK (live debt equals
docs/ui-exceptions.json); `overlay-containment-lint --enforce` clean (0 violations); the 12 touched/new test files
(`node --test`) tests 178, pass 178, fail 0; `npm run test:geometry` 476 checks - 476 ok, 0 FAIL (224 scenes). Full `npm test` not re-run.
Probes ran in a /tmp `git archive a27fa97d` sandbox, never in this tree.

- WARNING W1 - public/js/skin-surface.js:3665-3666 (paint): `panel.className = SKINS.panelClass(id)` wipes `mms-hold-dim`, and
  only `mms-hold` is put back. The engine stays at stage 2 (the light frozen, the drift stopped, reflect cut to 1 s, host
  `display.dim` still on), but the web's dim layer is gone and the CSS freeze (`.mms-hold-dim :not(.ip-dim)`) no longer applies,
  so the marquee runs again, until the stage-3 timer happens to add the class back up to 4.5 min later. In the real view a track
  change repaints (updateNowPlayingPanel -> renderNowPlayingSkin -> paint), and so does an autoplay append or a chapter cross.
  With 3-4 min songs, the PWA / Safari stage 2 is lost at almost every track boundary. Evidence: sandbox unit probe (the stage-test
  harness): Hold on, 30 s -> stage 2 dimmed; `engine.paint()` -> "stage 2 mms-hold-dim false"; +60 s -> still false (test red).
  Sandbox integration probe (the real music.js view, pocket-menu-harness): Hold on, class `mms-hold-dim` set, `nav.onNext()` ->
  "repainted true dimclass false ... hold true". pocket-hold.test.js "a repaint keeps Hold" binds only `mms-hold`. Fix: put
  `mms-hold-dim` back in paint when `hold.stage >= 2` (beside the `mms-hold` line), plus a test that repaints under the dim.
- SUGGESTION S1 - public/js/host-adapter.js:192: the `// v1.405.0 nativeTabBar: ...` comment is now above the new display.*
  block, and `'nav.bar'` sits under the idleDisplay comment. That is a misplaced (lying) comment: move the new entries above it or
  below `nav.bar`.
- SUGGESTION S2 - public/css/style.css:11779: "one class more than .ui-switch[aria-checked="true"]" is wrong. The rule is (0,4,0)
  and the primitive is (0,2,0), so it is two classes more. It still wins in both states; fix the number.
- SUGGESTION S3 - public/css/tokens.css (--pk-hold-dim-z: 41) / style.css:11802: CONTRIBUTING's z rule keeps local stacking in
  the 0-40 band, and tokens.css says "new raw numbers above the local 0-40 band are never added". 41 sits outside that band, and
  ui-lint does not see it because it reads a var on an absolute (not fixed) element. It works (it is local to the panel's
  stacking context; --reader-z-top is a precedent for a local token), but the band rule should be amended to allow it, or the
  dim should sit at 40 and come after the sticker in the DOM.
- SUGGESTION S4 - public/js/skin-surface.js:1990-1991 (HOLD_SWITCH_OK keydown): keyboard users. A hardware-keyboard user turns
  Hold on with Space, then presses Tab. Tab is aimed at the switch, so it passes, and focus moves off the switch. From then on
  every key is blocked (its target is not the switch), so no key can reach the switch again, and only a touch can release Hold.
  Keys aimed at the switch other than Space and Enter (Escape, the arrows) also reach the document listeners. Rare on a phone.
  Suggest: let only Space and Enter pass on the switch, and on a blocked Tab keep focus on the switch. Safe to ship disclosed.
- SUGGESTION S5 - test/unit/pocket-turn-inset.test.js:193: `const sideCut = uses.length && css.split(...)` - the `uses.length &&`
  guard does nothing (an empty `uses` already fails above). Drop it.
- SUGGESTION S6 - style.css:11755 (the Sideways --ip-cut): on a landscape iPhone env(top) is 0, so the Sideways layout now shows an
  8 px black strip with the knob, and its row is 8 px shorter. Dean's R13 look was approved on portrait mocks only. Add a
  DEVICE-CHECKS line (or ask him) for Sideways.

Verified with no finding: the Hold block's arm and disarm balance (capture flags match), the pagehide (not persisted) and
destroy release, and the observer release; the click dedup; the wake-lock late-grant release; that the stage timer moves one
stage per timer; the reflect throttle sits after the structural heals; the pocket menus' `frozen` drift gate; pocket-lighting's
`arm()` predicate (write() runs only from tick); renderFull's new second argument (renderApple and renderSpotify take one
parameter); the pop-out (`inMainDoc` refuses Hold; html.mms-popout gets no --ip-cut, so its padding falls back to the unchanged
chain); the tray (pop-out only); Cider and Nordic draw no strip; the shared .mms-ipod padding is unchanged where --ip-cut is
unset. Old tests (Matte, skin-status-bar, pocket-upright, pocket-turn-inset, kb-search R9) were updated with their intent kept.
Media Session handlers call the players directly, never a synthetic click, so R6 holds. No em dashes in the diff. Accessibility:
role="switch", aria-checked kept in step by holdSync and on repaint, aria-label "Hold", the ui.css focus ring kept, no knob or dim
transition under reduced motion.
Security: idleDisplay is web-to-native only (two fire-and-forget booleans; the adapter's `is: 'boolean', req: true` and the
capability gate, contract test green). No native input flows into the DOM. holdSpec writes constant strings into attributes
(no injection). The probe script spawns Chromium with an argument array (no shell) and uses mkdtemp. No new secret, network,
auth or storage surface (Hold is never stored, R8).

Gate: CHANGES r1 @a27fa97d - adversary

Measured at a27fa97d (Node 22.23.1), mutants and probes in a `git archive a27fa97d` sandbox outside this tree: the 12 touched/new
test files 178 tests, 178 pass, 0 fail; `eslint .` 0 errors, 6 warnings (all in common.js, untouched); overlay-containment clean
(0 violations); ui-lint OK. Geometry suite not re-run by this seat. 22 own mutants: 21 red, 1 survived (S4). Real CDP touches
(headless Chromium): the switch's hit area resolves to the switch at 100% of a 4 px grid, Hold on and off and under the dim
(ipod, Original, Transparent, Nano 4, 2004; 393x852, 320x568, Sideways 852x393, Upright rot 90); a tap on the switch in the dimmed
stage turns Hold off; FileTube.navigate and history.back with Hold on release it (page input works after, wake lock released);
long touch, right click, mouse wheel, MENU and a second finger do nothing under Hold.

- WARNING W1 - idleDisplay contract cannot keep the phone awake after a background (skin-surface.js:742-775 the display registry;
  the relay in this plan "Native must also"; native-bridge.md section 6). The relay tells native to turn the idle timer back on at
  willResignActive / didEnterBackground and says the web "posts display.dim false / display.hold true itself" on return. It does
  not: the registry posts only on a change and has no visibilitychange path, so its cache still says hold=true. Measured (the real
  engine + adapter + fake host, Hold on, visibilitychange hidden then visible): stage 1 posts after return `[]`; stage 2 posts
  `["display.dim:false"]` only. An app built to the relay re-enables auto-lock on any lock/unlock, app switch or Control Center
  pull (the R6 volume path; resign-active gives the web no event at all) and Hold never keeps the phone awake again - the very case
  the capability exists for (WKWebView may not honour the Wake Lock). Fix: forget the host's state on visibilitychange hidden
  (as pagehide does) and re-apply on visible, and tell native in the relay to re-apply its last received state on didBecomeActive
  (resign-active without a background is invisible to the web); a test that hides and shows the page with a host.
- WARNING W2 - stage 2 is not frame-idle, contrary to W3 ("nothing that repaints per frame") and the relay ("ProMotion idles ... once
  nothing on the page moves, which the web guarantees in stage 2"). Measured (Chromium, real music view, Hold on, the real 30 s,
  requestAnimationFrame calls per 2 s): 95 awake -> 60 dimmed, every one from player.js:7711 fillTick (the hidden player's seek-bar
  loop, which runs every frame while media plays - always, under Hold; its seek bar is 0x0, checkVisibility false). With Brick
  running (Extras > Games > Brick): 240 awake -> 240 dimmed: the canvas repaints every frame under the dim, and the game keeps
  playing with the wheel dead (the ball is lost unattended). Fix: stop or pause Brick when Hold engages (or at stage 2), stop
  fillTick while its seek bar is not rendered or under the dim, and re-measure; or correct the relay and the plan's claim.
- Concur with qa W1 (paint() at skin-surface.js:3665-3666 drops mms-hold-dim; only mms-hold is put back): read, not re-measured.
- SUGGESTION S1 - a vertical swipe flips Hold (skin-surface.js holdToggleDecision reads only dx; its comment says "under
  HOLD_SLIDE_PX of travel"). Measured: a 160 px straight-down drag starting on the hit area turned Hold on (ipod, Original,
  Transparent; portrait and Sideways). The hit area reaches 18 px over the body. Fix: a press with |dy| over the slide distance
  and |dx| under it changes nothing.
- SUGGESTION S2 - holdBlock does not check e.isTrusted, so a script's own .click() is swallowed under Hold. Measured: `#pp-btn`.click()
  pauses with Hold off (control) and does nothing with Hold on. Known consumer: the Resume countdown's auto-fire (player.js:8087
  `fireBtn.click()`); a podcast loaded under Hold in "ask" resume mode would then never start - suspicion, not built end to end.
  Fix: return early for untrusted events.
- SUGGESTION S3 - keys aimed at the focused switch reach document listeners (HOLD_SWITCH_OK allows keydown and nothing stops its
  propagation). Measured: Brick running, Hold on, switch focused, Escape -> Brick closed with Hold still on. Tab from the switch
  moves focus to the sticker (measured), after which no key can return to the switch. Hardware keyboard only. Fix: let only
  Space / Enter through on the switch, or stop propagation of the switch's keys.
- SUGGESTION S4 - presence-not-binding: integration "the switch itself: ... a press there never reaches the wheel": removing
  `e.stopPropagation()` from onHoldDown leaves 178/178 green; the press does reach onDown, whose clearCenterHold() runs before its
  wheel check. Bind it (a pending center hold survives a press on the switch) or drop the claim.

### Fix round 1 (the builder, after r1)

- qa W1 (a repaint dropped the dimmed stage): paint() re-adds `mms-hold-dim` with `mms-hold`; test "a repaint under the dim keeps
  the dim" (mutant R1 red).
- adversary W1 (the host was never re-told after a hide): the registry forgets what the host holds on a hide (null = unknown, so
  the return tells it BOTH values - the first fix forgot to `false` and was caught by its own test: the return posted no
  `display.dim:false`, which an app re-applying its last state would have dimmed again); the relay now also tells native to
  re-apply the last state on didBecomeActive (Control Center hides nothing). Test: hide + show at stage 1 and 2 (mutants R2, R3).
- adversary W2 (stage 2 not idle per frame): Hold engaging ends a wheel takeover (Brick) as MENU would (R4); the dim dispatches
  `filetube:hold-dim` and player.js's position loop (fillTick) ticks once a second under it, back to every frame on the wake (R5;
  player.js has no jsdom harness: a source lock R10, and the real count): Chromium `DIM=1`, page rAF calls in 5 s: 298 awake,
  **0** dimmed (`TOTAL: 2 rows, 0 failed`).
- adversary S1 (a vertical swipe flipped Hold): a press that travels mostly across the edge changes nothing (R8, the turned-box
  test updated: a slide across the turned box is now "unchanged", down the turned screen is "off").
- adversary S3 / qa S4 (keys on the focused switch): only Space / Enter reach it; Tab can no longer move the focus off it, Escape
  no longer reaches the page (R7).
- adversary S4 (an unbound claim): a bubble listener proves a switch press never reaches the engine's own press handling (R9).
- qa S1 (the nav.bar comment), S2 ("two classes more"), S3 (the dim back to z 40, the top of the local band: the sticker, also 40,
  is inserted BEFORE the dim; R6 and a census that only the sticker shares the dim's z), S5 (the dead guard) - done.
- Not taken, in ROADMAP Planned: adversary S2 (untrusted script clicks under Hold), qa S6 (Sideways: a DEVICE-CHECKS line).
