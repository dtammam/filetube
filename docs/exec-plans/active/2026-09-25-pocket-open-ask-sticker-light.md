---
plan: pocket-open-ask-sticker-light
harness: v2 · lean
branch: feat/v1.334-open-ask-sticker-light
anchor: spec
status: Gating
next: ONE gate (adversary + qa, fresh, max two rounds; at round 3 ask Dean), then the release steps (docs/RELEASING.md + AGENTS.md)
design: "Approved 2026-09-25 (Dean's words below are the D-decisions; D9 = his tap-to-play ruling in this session)"
gate: pending
---

# v1.334.0: the motion ask on opening the Click player, the sticker catches the light, the notification tap that won't play, #281 cleanups

## The asks (Dean, 2026-09-25)

1. "if I open up the music player on mobile and I press the sticker, it pops me for the motion prompt.
   Is it possible to just have it pop for that prompt on opening up the media player in that skin in
   general without requiring the sticker button?"
2. "I'd like the sticker in that same skin to be affected by the lighting. Right now, it just looks kind
   of out of place ... It should have like sheen on it ... as if it's literally a sticker, like lightly
   raised. The shadow would hit it. It's a sticker, so there's some gloss. So I don't want us to go crazy
   on the lighting effects, but like it should hit it."
3. "flakiness of me tapping an iOS PWA notification and having it launch the app, go to the music page,
   but not actually launch the song. Unsure why that's happening. If that's a regression or not."
4. Tech-debt #281 (c) and (d): focus after a sticker page switch, the chip groups' names, two unbound halves.

## Decisions

| ID | Decision |
|---|---|
| D1 | The iOS prompt stays (iOS forgets a home-screen app's motion grant at every launch and asks only inside a user gesture); what moves is WHICH tap asks: the tap that opens the Click player. |
| D2 | Ask from the open-the-player gesture only when a strength is stored, the target skin is a Click colorway on this viewport, the device has the permission API and no fine pointer, reduced motion is off, and no grant or ask exists this session. Once per session; the answer flows exactly like a Settings > Lighting pick (a deny = the note, a grant lights on the first sample). |
| D3 | Every existing arm stays bound: the deny note, reduced motion, destroy, no second ask in one gesture; the pop-out and a non-Click skin never ask. |
| D4 | The corner sticker on a LIT Click panel only (`.mms-lit`): a small drop shadow falling away from the light and a soft gloss that moves with `--lx`/`--ly`, on a tilted, image or emoji sticker, at 1x/2x/3x. Not crazy (Dean judges the side-by-side). |
| D5 | HARD, unchanged: no filter / blur / mask / backdrop-filter / blend mode / animation on anything lit; Off byte-identical. |
| D6 | Item 3 is diagnosed first (regression? cold vs warm? WebKit's autoplay policy at source). |
| D7 | #281 (c): focus Back when a sticker page opens and the originating row on return (Extras too); aria-labelledby on each chip group's heading. (d): bind the second refreshLighting() in the answer's .then; widen the no-filter lock to the mask longhands. (a) and (b) stay open. |
| D8 | One plan, one gate (adversary + qa), max two rounds; release v1.334.0. |
| D9 | Dean (this session, on the item-3 finding): **"Tap-to-play cue + log"** - when iOS refuses the start, the song stays loaded at its spot and the player shows a clear "Tap to play" cue; one tap plays it; the refusal's reason is recorded in the `?debugLifecycle=1` log so his iPhone can say why it sometimes works. When iOS allows the start, nothing changes. |

Builder decisions (B, disclosed):

| ID | Decision |
|---|---|
| B1 | Subtle gets the sticker's shadow and gloss too, at its own lower travel (the gain is 0.8) and a fainter gloss; Pronounced and Ambient share one sticker look (Ambient changes only the BODY's reflection, D2 of v1.333). |
| B2 | Image stickers (the logo is a die-cut rounded triangle; custom uploads are any PNG/JPEG/WebP) need a SHAPE-TRUE shadow and gloss. A CSS box or circle overlay would paint over the transparent parts, and the shape-true CSS tools (drop-shadow, mask) are banned by D5. So the sticker's own alpha is baked on a canvas: the shadow once per image (a static soft silhouette the CSS moves by transform), the gloss redrawn only when the light moves a visible step. A canvas is neither a filter nor a mask. The emoji chip is a true circle but TRANSLUCENT (a shade drawn under it would show through): its shadow is a CSS outer box-shadow on `::before` (never painted inside its box) and its gloss is the same canvas path with a circle for a silhouette - one gloss geometry, in JS only. |
| B3 | The lit sticker parts exist only while the panel is lit (created on the first lit write, removed on every clear), so Off never has them. |

## Research

### Item 1 - hypothesis, falsifier, measurement

- Hypothesis (the brief's lead): `armFirstTapAsk` binds its capture `click`/`touchend` listener only in
  `sync()`, after the Click panel is painted, so the tap that OPENS the player has already passed the
  document's capture phase (or finished) when the listener lands; the next tap (often the sticker) asks.
- Falsifier: an ask (a `requestPermission()` call) DURING the opening tap on the real open path.
- Measured (scratch probe, the REAL music.js + music-skins.js + skin-surface.js + pocket-lighting.js in
  jsdom, a coarse-pointer mobile window with `DeviceOrientationEvent.requestPermission` counted, a
  stateful player stub): a Songs-row tap (touchend + click) -> asks during the tap **0**, after the async
  open **0**, Click panel painted, driver `askArmed:true`; the NEXT tap (the sticker) -> asks **1**
  (stack: `Document.askFromGesture`). Same on the album-drill path (`playRowAt -> playTrackInAlbum ->
  await render() -> playAt`). Not falsified.
- Why it cannot be fixed inside the driver: every open path paints after an await (the album fetch, the
  router's view fetch, the progress fetch), and WebKit's prompt needs a live gesture token:
  `DeviceOrientationAndMotionAccessController::shouldAllowAccess` passes
  `mayPrompt = UserGestureIndicator::processingUserGesture(&document)`, and `DeviceOrientationEvent::
  requestPermission` REJECTS with `NotAllowedError` ("requires a user gesture to prompt") when the state
  is still Prompt (WebKit main: Source/WebCore/dom/DeviceOrientationAndMotionAccessController.cpp:90,
  Source/WebCore/dom/DeviceOrientationEvent.cpp requestPermission). The token is forwarded only through
  a short `setTimeout` (Source/WebCore/page/DOMTimer.cpp:177, :329-335), never across a fetch.
- So the ask must run synchronously INSIDE the opening tap, at the seams every open passes through
  synchronously: the SPA router's `navigate()` for a player-open URL (the dock tap -> `/music?nowplaying=1`,
  a home or search card -> `/music?play=` / `/podcasts?play=`), and the views' play seams (music.js
  `playAt` / `playTrackInAlbum` / `playTrackFromContinue`, podcasts.js `playAt`).
- A rejected ask (no gesture) is not a deny: it leaves the session un-asked and the first-tap ask re-arms
  (the v1.330 adversary's S suggestion, now reachable because the open seams also run without a gesture,
  e.g. a notification's cold `?play=`).

### Item 3 - the notification tap (research agent, read-only; full report in the session)

- Path: lib/push/deliver.js builds `/music?play=<id>&ao=1` (podcasts `/podcasts?play=`); the worker
  (public/filetube-worker.js `notificationclick`) focuses + `navigate()`s an existing window (warm) or
  `openWindow()`s (cold). BOTH arms load a fresh document (WebKit `Document::navigateFromServiceWorker`
  schedules a location change), never the SPA router. `?play=` survives both.
- music.js boot -> `playTrackFromContinue` -> fetches -> `playAt` -> `pl.load()`; player.js
  `handleResumePlayback` -> fetch progress -> `mediaPlayer.play().catch(function () {})`.
- WebKit: MediaElementSession.cpp `playbackStateChangePermitted` denies audible playback under
  `RequireUserGestureForAudioRateChange` without `processingUserGestureForMedia()`; on iOS
  `RequiresUserGestureForAudioPlayback` is on. The notification click grants a gesture only inside the
  worker (ServiceWorkerThread.cpp `recordUserGesture` for openWindow/focus), nothing to the page.
- Verdict: NOT a regression (the swallowed catch dates from v1.44; the notification URL moved to
  `/music?play=` in v1.246 but the watch page hits the same wall). player.js already says so in a
  comment ("On iOS the FIRST play of a session may be refused"). The intermittency is NOT explained by
  source (the home-screen app's host is closed source) - hence D9's log.

## Design

### Item 1 - the open-the-player ask (pocket-lighting.js + callers)

- A per-window SESSION (one per document; a WeakMap keyed by the window): `asked`, `permission`, the live
  drivers. Every driver in that window reads it: `armFirstTapAsk` skips when the session asked or holds a
  grant; `askFromGesture` / `choose()` write it; an answer from ANY ask flows to every live driver
  (permission, the deny note, `sync()`), so a driver created after the open-ask adopts its answer.
- `FileTubePocketLighting.askForOpen(win)`: the D2 conditions (strength, a Click colorway active for this
  viewport via `FileTubeMusicSkins.skinActiveFor` + `menuStyle(activeSkinId()) === 'click'`, never the
  tray, the permission API, no fine pointer, no reduced motion, no ask or grant this session, and
  `navigator.userActivation.isActive` when the browser exposes it) -> `requestPermission()` synchronously.
  A resolve = the answer (flows as above); a REJECT = not asked (session un-asked, drivers re-arm).
- Callers: common.js `navigate()` (after the same-URL no-op) when the target is `/music` or `/podcasts`
  with `play=` or `nowplaying=1`; music.js `playAt`, `playTrackInAlbum`, `playTrackFromContinue`;
  podcasts.js `playAt`. Each is one guarded call; the pop-out engine never calls it.

### Item 2 - the sticker catches the light

- Emoji chip (a circle): `.mms-ipod.mms-lit .mms-sticker:not(.mms-sticker--img)::before` = the drop shadow
  (inset 0, radius inherit, an outer box-shadow offset AWAY from the light, the offset counter-rotated by
  the tilt so it falls away in SCREEN space); the gloss = the canvas path below with the circle as its
  silhouette. The chip's own static shadow is replaced by the directional one while lit. The chip's
  existing `backdrop-filter` stays on the BASE rule and never reads the light.
- Image sticker: two canvases added while lit: `.mms-sticker-shade` (the alpha silhouette, soft, dark, baked
  once per image; CSS moves it by a transform reading `--lx`/`--ly`) and `.mms-sticker-gloss` (the silhouette
  filled with a soft highlight centred toward the light, redrawn only when the light moves a visible step).
  The driver tells the engine each written light and each clear (`onLight`); the engine hands the sticker, the
  light and the strength to `pocket-lighting.js paintSticker` (the painter lives in the driver module - see
  Deviations: the engine must never draw). The emoji chip's gloss is the same canvas with a circle.
- Subtle (B1): the same parts, fainter gloss.

### Item 3 - tap to play

- player.js: ONE auto-start helper replaces the swallowed `play().catch(function () {})` sites of the
  load/resume path; it records `autostart:ok` / `autostart:refused` (the error name, whether the page ever
  had a tap: `navigator.userActivation.hasBeenActive`, the visibility) in the lifecycle log, and on a
  `NotAllowedError` raises a per-load refused flag (`player.autoStartRefused()`) + a document event; a
  `play` of the element, a new load and `close()` clear it.
- skin-surface.js (main document only): while the flag is up and the media paused, the skin shows a
  "Tap to play" button (`data-skin-tapplay`); its tap calls `play()` synchronously inside the gesture; it is
  re-injected on every paint while the flag is up and removed on the clear.

### Item 4 - #281 (c), (d)

- (c) Opening the Skin or Extras page focuses its Back; Back focuses the row that opened the page; each
  chip group's `aria-label` becomes `aria-labelledby` on its `.mms-sm-h` (unique ids per engine).
- (d) A test that removes the second `refreshLighting()` in the answer's `.then` goes red; the no-filter
  lock takes the adversary's `(?:-webkit-)?(?:mask(?:-[\w-]+)?|box-reflect)\s*:`.

## Acceptance

- AC1 (item 1): through the real open paths in jsdom (a Songs row, an album row, a Jump-back tile, the dock
  / card navigation via the router, a podcasts episode), with a Click skin + a strength + the permission
  API + a coarse pointer: exactly ONE ask, inside the opening tap; none on a non-Click skin, with a fine
  pointer, with reduced motion, with Off, after a grant or an ask this session; a deny flows as the note;
  a grant lights on the first sample; a reject leaves the first-tap ask armed; one gesture never asks twice
  (the painted panel's capture listener and a view seam in the same tap = one ask).
- AC2 (item 2): the lit sticker rules exist only under `.mms-lit`, read `--lx`/`--ly`, carry no
  filter/blur/mask/backdrop/blend/animation (the widened lock); Off byte-identical by the render probe
  (two runs of one tree measured first, every element-style difference classified); the engine adds the
  image canvases only while lit and removes them on every clear; the side-by-side (unlit vs lit, two
  tilts, White/Red/Black, image and emoji, 1x/2x/3x) goes to Dean before the gate.
- AC3 (item 3): a refused auto-start (`NotAllowedError`) shows the cue on the painted skin, its tap calls
  `play()` in the same turn, a `play` / new load / close clears it (bound from a POPULATED state); a
  successful auto-start never shows it; both outcomes land in the lifecycle log.
- AC4 (item 4): focus lands on Back when a page opens and on the originating row on Back (Skin, Extras);
  each chip group is named by its heading; the two #281 (d) bindings go red when mutated.
- AC5: lint:css 0, overlay-containment 0, eslint clean, the full suite on Node 22.23.1 and 24.20.0 at the
  release commit.

## Deviations

- The sticker painter moved from skin-surface.js to pocket-lighting.js (`paintSticker`, state per sticker in a
  WeakMap). The pre-commit hook's unit run went red on the first commit attempt: `ipod-brick.test.js` locks
  the engine to know nothing about drawing (no `canvas` in skin-surface.js, so the wheel takeover stays
  generic). Complied rather than widened; the lighting CSS lock now also asserts the engine never draws.
- The shade's blur margin is two pocket structure tokens (`--pk-stk-shade-inset`, `--pk-stk-shade-size` on
  `.mms-ipod`): the same hook run's `pocket-design-system.test.js` AC5 refuses raw sizes in pocket rules.
- The sticker menu's heading ids are static (`mms-sm-speed` / `-light` / `-skin`): a per-engine counter was
  dead defence (one sticker menu per document) and its mutant survived.
- A rejected motion ask (no gesture) is no longer a deny (research, item 1): it re-arms the first-tap ask.

## Build record

- Item 1 measured before the fix (scratch probe, the real music.js + engine + driver): the opening tap asked
  0, the next tap (the sticker) 1. After: 1 inside the opening tap, 0 on the sticker (both open paths).
- Failing test first: `pocket-lighting-open-ask.test.js` on the base tree (a `git archive` of 517bff13 +
  the new file): 9/9 not ok.
- The sticker side-by-sides (scripts/sticker-light-probe.js; Pronounced on White/Red/Black and Subtle on Red,
  logo + emoji, both tilts, 1x/2x/3x; 108 + 36 shots, every lit shot glossed, every lit logo shaded, 0 Off
  shots with a canvas, 0 page errors) went to Dean before the gate.
- Commits: ee17dad5 (the build; hook `npm run test:unit` 7432/7432), ec8459b5 (mutant round 1; 7434/7434).
- Mutants r1 on ee17dad5 (82, a `git archive` sandbox + a pristine copy, restored byte-identical): 74 killed,
  8 survived. Bound in ec8459b5: gesture-ignores-session, stk-no-counterrotate, stk-no-forget, stk-lit-gate,
  stk-no-layout-guard (was masked by the unloaded image), ttp-generic-swallowed (+ podcast / TV / book /
  resume branch mutants); aria-id-collide removed with the dead counter. Masked, disclosed:
  destroy-stays-registered (answer() / rearm() check `destroyed`; a dead driver stays in the window's list
  until the page ends - memory only). Five router-path kills were by TIMEOUT (the router test hung when red);
  the test now closes its windows in a finally, re-run in r2.
- Mutants r2 on ec8459b5 (86: r1's set with the removed counter's mutant replaced by a shared-id one, plus the
  podcast / TV / book / resume auto-start branches): 85 killed, every one by test name (no timeout), 1
  survived (destroy-stays-registered, masked as above). The sandbox restored byte-identical.
- Dean on the sticker side-by-sides (2026-09-25): "Seems good. Please go through to release."
- Off byte-identical (scripts/pocket-render-probe.js, a frozen copy; LIGHTS=off,subtle,pronounced,ambient;
  base = a `git archive` of 517bff13, branch = a `git archive` of ec8459b5; each shoot ~1765 s): `compare
  base1 branch` -> "TOTAL: 1240 shots, 57 differing pixels, 900 differing element styles, 0 missing" (exit 1).
  Classified by script: Off 340 shots, 0 px, 0 styles. Subtle 296 / Pronounced 294 / Ambient 294 shots, each
  with exactly ONE differing element style, always `button.mms-sticker.mms-sticker--img` (it takes
  `position:relative` while lit; the probe sets the lit classes by hand, so no driver and no canvas run there).
  The 57 px are in 16 lit shots, max channel delta 1 each. Because the Off delta is zero, the second run of
  one tree (the noise floor) was not needed and was skipped.

## Gate

(pending)
