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
  Source/WebCore/dom/DeviceOrientationEvent.cpp requestPermission). CORRECTED at gate r1 (adversary S2,
  re-read at source by the builder): the token IS forwarded across a short `setTimeout`
  (Source/WebCore/page/DOMTimer.cpp:177, :329-335) AND across a `fetch` resolution for a while
  (Source/WebCore/Modules/fetch/WindowOrWorkerGlobalScopeFetch.cpp:66-72,
  `maximumIntervalForUserGestureForwardingForFetch`), but a response BODY read re-forwards it
  `GestureScope::MediaOnly` (Source/WebCore/Modules/fetch/FetchBodyConsumer.cpp:577-581), and
  `processingUserGesture()` requires scope `All` (Source/WebCore/dom/UserGestureIndicator.h:82) while
  `processingUserGestureForMedia()` does not (:83). So after the open's JSON read, `play()` may still start but
  the motion prompt may not - every open path reads a body before it paints.
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
  load/resume path (not the desktop live-transcode restart, `startLiveStream`, which also serves seeks - it
  keeps its swallowed catch; desktop only, disclosed at gate r1 qa S2); it records `autostart:ok` / `autostart:refused` (the error name, whether the page ever
  had a tap: `navigator.userActivation.hasBeenActive`, the visibility) in the lifecycle log, and on a
  `NotAllowedError` raises a per-load refused flag (`player.autoStartRefused()`) + a document event; a
  `play` of the element, a new load and `close()` clear it.
- skin-surface.js (main document only): while the flag is up and the media paused, the skin shows a
  "Tap to play" button (`data-skin-tapplay`); its tap calls `play()` synchronously inside the gesture; it is
  re-injected on every paint while the flag is up and removed on the clear.

### Item 4 - #281 (c), (d)

- (c) Opening the Skin or Extras page focuses its Back; Back focuses the row that opened the page; each
  chip group's `aria-label` becomes `aria-labelledby` on its `.mms-sm-h` (SUPERSEDED in the build: static
  ids, one sticker menu per document - see Deviations).
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
- AC2's "two runs of one tree first" was skipped: the Off delta measured ZERO (340/340 shots, 0 px, 0 styles),
  so no noise floor was needed to separate it (gate r1 qa S1 asked for this to be a Deviation).
- Gate r1 fix round (both seats CHANGES r1 @47d3fb81): the sticker image that loads late now paints the
  LATEST ask (nothing if unlit meanwhile); both Shuffle buttons ask inside their tap; the Extras
  "not available" page keeps focus on Back; the Tap to play cue stacks at z 39, under the sticker wrap (40);
  a redraw reuses the gloss canvas's backing store (qa S4); the WebKit gesture statements corrected at source
  (adversary S2); tests for the late load, Shuffle, the not-available focus, the cue's stacking, the cue's
  hidden / not-full-skin arms, a refusal on a playing element, the dead driver's late answer and a row pick's
  session answer (adversary S1). Disclosed, not fixed: the cue is silent to a screen reader (qa S3).

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

### qa r1

Gate: CHANGES r1 @47d3fb81 - qa

Instruments (run by this seat, Node 22.23.1, a `git archive 47d3fb81` sandbox; outputs verbatim):
- `npm run lint:css`: "TOTAL 0  (the token census; ceiling ZERO since v1.61.0)", exit 0.
- `node scripts/overlay-containment-lint.js --enforce`: "overlay-containment: clean (0 violations)", exit 0.
- eslint on the 10 touched JS files: "✖ 6 problems (0 errors, 6 warnings)", all `no-unused-vars` in common.js (setTheme, homeFeedEnabled, setIconSet, addToQueue, openTranscriptFor, shareExternalUrl) - the same 6 at base 517bff13.
- Touched tests: pocket-lighting 27/27, pocket-lighting-open-ask 10/10, player-tap-to-play 5/5 (with ipod-brick + pocket-design-system: "# tests 79 # pass 79 # fail 0").
- `npm run test:unit`, run 1 (sandbox not a git repo): "# tests 7434 # pass 7426 # fail 8" - all 8 sandbox artifacts (6 source locks: "fatal: not a git repository"; 2 comment-debt census: EISDIR on the node_modules symlink); those 7 files re-run green after `git init` (15/15, 54/54). Run 2: "# tests 7434 # pass 7434 # fail 0", exit 0 (duration_ms 216610). Node 24.20.0 not run by this seat (AC5 owes it at the release commit).
- Own mutants (20, targeted tests, restored byte-identical to a pristine copy): 19 killed by test name, 1 SURVIVED (W2).
- AC7 sibling list re-derived: every public shell loading skin-surface.js loads pocket-lighting.js; lib/ytdlp/views/subscriptions.html loads neither (pre-existing; no skin there, so no ask - consistent).

**W1 (WARNING) - the "Tap to play" cue paints over the open sticker menu and eats its taps.** public/css/style.css `.mms-tapplay{ ... z-index:41; /* token-exempt: local stacking - over the skin chrome, beside the sticker (40) */`; skin-surface.js syncTapPlay appends the cue to the panel as a SIBLING of `.mms-sticker-wrap` (z-index:40), so it stacks above the wrap and its menu. Measured (headless Chromium, the real style.css + engine, the music view's real sticker rows Home / Speed / Loop / Autoplay / Skin / Lighting / Extras, refused + paused, menu open): 390x844 Click: cue [124,229,142,48], menu [12,233,320,541], `elementFromPoint` at the Home row's centre = the cue; 375x667 Click: the 1.75x and 2x chips' centres = the cue; 375x667 Cider: Home. Scenario: a notification opens the song, iOS refuses, the cue shows; the user opens the sticker and taps Home -> the song plays instead and the menu stays up. It also breaks CONTRIBUTING's "Local in-component stacking (0-40 band)" (41 is outside it), and the comment's "beside the sticker" / "never ... the sticker" is untrue while the menu is open. Verified prescription: z-index:39 (the skin chrome tops out at z 5) - lint:css stays 0 and the same probe finds 0 covered menu buttons at all 6 skin x viewport cells; bind it (cue z < wrap z) and fix the comment.

**W2 (WARNING) - a sticker image that loads late paints its canvases onto an UNLIT panel; the branch is unbound.** public/js/pocket-lighting.js paintSticker: `img.addEventListener('load', function () { var d = STK_DRAWN && STK_DRAWN.get(btn); paintSticker(btn, (d && d.want) || light, o); }, { once: true });` - a clear (`paintSticker(btn, null)`) deletes the STK_DRAWN entry, so the listener falls back to the STALE captured `light` and draws. Measured through the real engine + driver (jsdom, the builder's stickerRig with `complete` false until the load): paint lit -> the sticker's Lighting "Off" chip -> the image's `load` -> parts `{"shade":true,"gloss":true}` on a panel whose classes are `music-nowplaying-panel mms mms-full mms-ipod` (no mms-lit). Unlit, `.mms-sticker-shade` / `.mms-sticker-gloss` have no CSS rule (all are under `.mms-ipod.mms-lit`), so they render as bare canvases (CSS size = the backing size, e.g. 156 px for a 52 px sticker at DPR 3) until the next repaint - contradicts B3 ("removed on every clear"), AC2 and the D5 Off rule. Unbound: my mutant deleting the whole load listener SURVIVED pocket-lighting.test.js (the rig forces `complete` true; no test drives the wait path, which the brief names: "an image that loads late"). Verified prescription: `if (!d || !d.want) return; paintSticker(btn, d.want, o);` - pocket-lighting.test.js 29/29 with two new tests (a late load after Off draws nothing: red at 47d3fb81, green fixed; a late load while lit draws: kills the deleted-listener mutant).

**W3 (WARNING) - #281 (c): the Extras page's "not available" arm drops focus to BODY.** public/js/skin-surface.js extrasMenu open(): `if (!item || item.id !== baseId) { menu.innerHTML = buildExtrasNoteHtml('Extras aren’t available for this track.'); return; }` runs BEFORE the hadBack capture and never calls cfg.onRendered, yet buildExtrasNoteHtml replaces the focused loading-page Back with a new Back. Measured (jsdom, the real engine): focus Extras, open, `fetchItem` resolves null -> the note "Extras aren’t available for this track." shows, the loading Back is detached, `document.activeElement` = BODY. D7 / AC4 claim "focus lands on Back when a page opens (Skin, Extras)"; the brief names this arm. Verified prescription: capture hadBack before the not-available branch and call `cfg.onRendered(hadBack)` after its innerHTML (pocket-lighting + tap-to-play + open-ask 43/43 with a new test for the arm).

**S1 (SUGGESTION) - plan lines the build reversed (LESSONS 12).** Design item 4 still says "(unique ids per engine)" (Deviations: static ids); AC2 says "two runs of one tree measured first", the Build record says the second run "was not needed and was skipped" - mark the Design line superseded and move the AC2 skip into Deviations. (The render probe ran on ec8459b5; `git diff --stat ec8459b5 47d3fb81` = the plan doc only, so its numbers carry to this sha.)

**S2 (SUGGESTION) - the desktop live-transcode arm still swallows its auto-start.** player.js `startLiveStream(t, autoplay)`: `if (autoplay) mediaPlayer.play().catch(function () {});`, reached from handleResumePlayback's `if (liveMode) startLiveStream(0, true)` and resumeDirectly - the plan's "ONE auto-start helper replaces the swallowed play().catch sites of the load/resume path" is not literally true. Desktop only (no skin, no cue), so the lifecycle log misses it at most; reword or route it through autoStart.

**S3 (SUGGESTION) - the cue is silent to a screen reader.** It is a real `<button>` (keyboard and Enter work: the click reaches #pp-btn), but it appears with no announcement and sits last in DOM order; a polite live region or an aria-describedby on the paused state would tell a VoiceOver user why nothing plays.

**S4 (SUGGESTION) - stkDrawGloss re-assigns `cv.width` / `cv.height` on every redraw** (a backing-store reallocation per 0.02 light step, up to 468x468 at a 3x sticker on DPR 3); clearRect when the size is unchanged. Bounded by STK_GLOSS_STEP, so cost only.

Device-pass notes (suspicions, not findings; headless cannot show them): (a) the opening tap now presents the motion prompt AND starts the load - check that the first song of a launch still starts (the prompt must not cost the media gesture), else the new cue appears right after the prompt; (b) on a notification's cold launch with a strength stored, tapping "Tap to play" is also the painted player's first tap, so it raises the motion prompt as it plays.

Security (standing section): no findings. The canvases draw same-origin images only (/favicon.svg, the user's own /api/me/sticker upload) and never read pixels back (no getImageData / toDataURL / toBlob), so no taint or exfil path; the `filetube:autostart` listener ignores the event's detail and re-reads player.autoStartRefused(), so a spoofed event only re-syncs; the cue's innerHTML and the heading ids are static literals; menuFocusSel builds selectors from internal chip values with quotes and backslashes stripped (no HTML sink); the lifecycle log records an error name, userActivation flags and the page age (no PII) and only under ?debugLifecycle=1; scripts/sticker-light-probe.js is a dev tool on 127.0.0.1 with a normalised, public/-confined path. No route, auth, secret or dependency change.

Checked and clean: AC1 (every named open path asks inside the tap; one ask per gesture incl. a fast reject; non-opening seams - Prev/Next, auto-advance, the lock screen - reach askForOpen with no live activation, or reject and re-arm with no prompt), AC3 reveal + every clear (play, a new load, close) from a populated state, AC4 Skin page / Back / chip rebuild / late re-draw, the D5 lock (the chip's backdrop-filter stays on its base rule; the Click skin is audio-only, so the video-blackout class has no video to black out), the masked destroy-stays-registered claim (only askSession iterates the list and answer()/rearm() check `destroyed`).

### adversary r1

Gate: CHANGES r1 @47d3fb81 - adversary

Instruments (this seat, Node 22.23.1, a `git archive 47d3fb81` sandbox + pristine copy at /tmp/v1334-adversary-*, restored byte-identical after every mutant, verbatim):
- Touched tests: "# tests 42 # pass 42 # fail 0" (pocket-lighting-open-ask + pocket-lighting + player-tap-to-play).
- `npm run test:unit` in the sandbox: "# tests 7434 # pass 7426 # fail 8". All 8 are git-dependent (app-settings-store, comment-debt-census x2, dbjson-never-read, media-items-store, media-record-stores, media-trash-store, media-view-counts-store: "fatal: not a git repository" / EISDIR); those 7 files in a `git clone` checked out at 47d3fb81: "# tests 69 # pass 69 # fail 0". Node 24.20.0 not run.
- lint:css "TOTAL 0"; lint:overlay "clean (0 violations)"; eslint on the 10 touched JS files "0 errors, 6 warnings" = the same 6 at 517bff13.
- Own mutants: 24 run, 11 killed, 13 survived (S1). Builder mutants re-run (13): 12 killed as recorded, destroy-stays-registered survives as disclosed.
- WebKit main at primary source (raw.githubusercontent.com/WebKit/WebKit/main): dom/DeviceOrientationEvent.cpp:141-142, dom/DeviceOrientationAndMotionAccessController.cpp (shouldAllowAccess), dom/UserGestureIndicator.h/.cpp, Modules/fetch/WindowOrWorkerGlobalScopeFetch.cpp, Modules/fetch/FetchBodyConsumer.cpp, html/HTMLMediaElement.cpp:4576-4588.

**W1 (WARNING, concurs with qa W2, measured independently in a real browser) - a late sticker-image load paints the lit canvases on an Off panel.** pocket-lighting.js:292 `paintSticker(btn, (d && d.want) || light, o)`: a clear deletes the STK_DRAWN entry, so the listener falls back to the stale captured `light`. (a) jsdom, the real engine + driver, `complete` false: lit=true parts {shade:false,gloss:false} -> the sticker's Lighting Off chip -> lit=false -> the img's `load` -> lit=false, parts {shade:true,gloss:true}, 2 canvases. (b) Headless Chromium, the sticker-light-probe fixture (real style.css, engine, driver, real deviceorientation), DPR 3, /favicon.svg served 2.5 s late: after the load with ft-pocket-lighting "off": `.mms-sticker-shade` 193x193 and `.mms-sticker-gloss` 156x156, display:block, position:static, inside the 52 px button; the screenshot shows the logo gone from the corner and a dark blurred blob in its place (control, no delay: 0 canvases, logo in place). A D5 (HARD: Off byte-identical) and B3 violation until the next repaint. The render probe cannot see it (it sets the lit classes by hand, no driver). Prescription = qa's (`if (!d || !d.want) return; paintSticker(btn, d.want, o);`) plus a test that drives the wait path (S1: the whole arm is unbound).

**W2 (WARNING) - the Music toolbar Shuffle and the drill Shuffle open the Click player but still ask on the NEXT tap (Dean's original complaint, on an unlisted open path).** music.js:2506 `shuffleBtn` and music.js:2968 `.music-drill-shuffle` call `loadSongs(...).then(... playAt(0))`, so askLightingForOpen runs after a fetch + `res.json()`. Measured (the builder's open-ask probe shape: the real music.js + music-skins + skin-surface + pocket-lighting, coarse pointer, Pronounced, Click): Songs-row tap -> asks DURING the tap 1; `#music-shuffle-btn` tap -> asks DURING the tap 0, after settle 1 (stack askSession < askForOpen < askLightingForOpen < playAt). On WebKit that late ask cannot prompt: fetch forwards the tap's token (WindowOrWorkerGlobalScopeFetch.cpp:66-73), but the body read re-scopes it to MediaOnly (FetchBodyConsumer.cpp:578-582) and processingUserGesture() requires scope All (UserGestureIndicator.h:81), so requestPermission rejects NotAllowedError (DeviceOrientationEvent.cpp:141-142), askSession re-arms, and the first tap on the painted panel (the sticker) asks. The drill Shuffle is the same code shape (reasoned, not run). AC1's list omitted both. Prescription: askLightingForOpen() synchronously at the top of both click handlers, before loadSongs; a test through the real Shuffle button (asks inside the tap; the sticker afterwards asks nothing). shuffleAllFromMenu is inside the painted panel (the first-tap ask covers it).

**W3 (WARNING, concurs with qa W3, measured independently) - the Extras "not available" arm drops focus to BODY.** jsdom, the real engine: focus Extras -> loading Back focused true -> fetchItem resolves null -> the note page (with a new Back) shows, `activeElement` BODY. AC4 names Extras. qa's prescription holds.

**W4 (WARNING, concurs with qa W1; reasoned here, qa measured it)** - the cue's z-index 41 stacks above `.mms-sticker-wrap` (z 40, a stacking context) and its menu.

**S1 (SUGGESTION) - unbound guards (my mutants survived, each with the three touched test files green).** A1 delete the late-load listener: 42/42 (the "image that loads late" arm has no test); A2 feed the stale `light`: green (the W1 line). The r1-S2 class "a late answer after destroy re-binds nothing" on the session path: removing the splice in destroy() AND answer()'s `if (destroyed)` AND rearm()'s `if (!destroyed)` together: 37/37 green - each guard masks the others and no test destroys a driver while an askSession is pending, then answers. Also unbound: tapPlayWanted's `panel.hidden` and `mms-full` arms (A10, A10b), autoStart's `mediaPlayer.paused` (A12), choose()'s two `sess.permission` writes (A21 the answer, A22 the reset: a driver born after a row-pick deny starts without the note), `hadBack` forced true (A25: a late Extras load would pull focus back into the menu from wherever the user moved it). A5 / A26 / A27 were equivalent or dead guards (not findings).

**S2 (SUGGESTION) - lying research and comments about WebKit's gesture token (LESSONS 12).** Plan Research ("The token is forwarded only through a short setTimeout ... never across a fetch") and pocket-lighting.js:175 ("never survives a fetch"): WebKit DOES forward a tap's token across fetch() for 10 s (UserGestureIndicator.cpp:111, WindowOrWorkerGlobalScopeFetch.cpp:66-73); what defeats the motion ask is the JSON body read's MediaOnly scope. player.js:5061-5062, re-edited by this diff: "no user gesture survives the async progress fetch" is false for media - MediaOnly still satisfies processingUserGestureForMedia (UserGestureIndicator.h:82), which is why a tapped pick auto-plays after its fetches. Correct the three texts; for item 3 note that a tapped pick whose fetches exceed 10 s is refused too (the cue covers it, and the log will show "tap had").

Suspicion (device only, concurs with qa's note b): the cue's tap is often the painted panel's FIRST tap of a launch, so the armed capture listener asks in touchend; whether iOS still delivers the click (the play) under the motion alert is unmeasured - "one tap plays" may take two on that launch.

Verified clean: the dock (readerHref /music?nowplaying=1), cards / queue (/music?play=, /podcasts?play=) and Listen (/music?play=&listen=1) all reach navigate() -> isPlayerOpenUrl; the dock hides Prev/Next (style.css #player-dock rules), so no docked tap reaches playAt; auto-advance and lock-screen seams carry no gesture; every shell loading common.js with a view loads pocket-lighting.js + music-skins.js; WebKit's play() rejects NotAllowedError synchronously with no 'play' event, so the flag's paused check holds; the cue cannot pause a playing track (tapToPlay and togglePlayPause both branch on paused; the builder's two mutants re-killed). Off: the builder's delta re-classified by me (not re-shot): 340 Off shots, 0 px, 0 styles.
