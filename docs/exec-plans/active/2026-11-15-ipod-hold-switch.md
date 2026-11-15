---
plan: ipod-hold-switch
harness: v2 · full
branch: feat/v1.408.0-ipod-hold
anchor: outcome
status: Kickoff done, W0 (design) not started
next: the builder reads Step 0, then W0 (research + a side-by-side look for Dean BEFORE any code)
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

(empty)

## Gate

(pending)
