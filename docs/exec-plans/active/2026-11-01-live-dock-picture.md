---
plan: live-dock-picture
harness: v2 · full
branch: feat/v1.401.0-live-dock-picture
anchor: spec
status: Planned
next: builder Step 0, then W1 (the contract freeze is in this plan; the iOS Root relay goes to Dean)
design: Rulings approved by Dean 2026-11-01 (AskUserQuestion): L1-L4 below; the builder's Design must stay inside them
gate: pending
builder: extreme
---

# v1.401.0 - on the iPhone app, the mini player keeps playing the video, not just its thumbnail

Kickoff 2026-11-01 (FileTube Root, Opus). This is "plan B" from v1.400.1 (`2026-11-01-minimize-native-follow`).
**Builder: Extreme (Fable).** Why the tier: it changes how the picture is layered across two apps (the web and the iOS
host), adds a bridge capability and field, and its correctness is about frame-ordering between two compositors that no
unit test can see. The web ships FIRST and stays inert until an app build announces the new capability (the v1.399.0
pattern), so web and iOS release independently. One web release, **1.401.0**; the iOS half is filetube-ios v0.17.0
(the iOS Root, Dean's Mac).

## Step 0 (before any code)

- Read AGENTS.md, docs/LESSONS.md (sections 1, 2, 3, 4, 6, 7, 8, 12 at least), docs/CONTRIBUTING.md, docs/RELEASING.md,
  docs/references/native-bridge.md (sections 3, 5, 6) and native-bridge.v1.schema.json, docs/references/z-ladder-coopen-enumeration.md,
  the v1.399.0 plan `docs/exec-plans/completed/2026-10-28-native-video-surface.md` and the v1.400.1 plan
  `docs/exec-plans/completed/2026-11-01-minimize-native-follow.md` (its evidence: how the live loop and the hole ordering
  were built), then this plan once.
- Environment: `export PATH="$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH"` before every
  npm/node/git command. Local suites on Node 22 only; Node 24 runs in PR CI.
- Git: work on `feat/v1.401.0-live-dock-picture` (this plan is committed there). Stage by name, never `git add .`/`-A`,
  never force-push, never `--no-verify`, never pipe a commit or push; verify with `git log` / `git ls-remote`. Commit
  with `-F <file>`. Push with `GIT_SSH_COMMAND="ssh -o ServerAliveInterval=20 -o ServerAliveCountMax=60"`.
- Tests: targeted tests per wave; the full Node 22 suite once before the gate and once on the release commit.
- **Stop rules (ask Dean with AskUserQuestion):** the iOS Root (via Dean) rejects or changes the contract in "Contract"
  below; a ruling L1-L4 turns out unbuildable; the covered-dock detection (R4) cannot reach zero idle cost; gate round 3.
  A device check failing after the app build is a re-root-cause, never a re-patch.

## Why

Dean, 2026-11-01, after v1.400.1 shipped ("worked - the only regression is the MiniPlayer not showing video when docked
in the bottom corner. However it is working when dragging beautifully"), then "Kick off plan B now". It is not a
regression: since v1.399.0 the app's dock shows the thumbnail by the 2026-10-28 ruling. YouTube keeps the video playing in
its mini player, and that is the goal.

## Why the dock shows a thumbnail today (the constraint this plan removes)

Native's picture layer is a sibling BELOW the non-opaque web view; the web paints a transparent hole where the picture
goes. A hole removes backgrounds only: any page content painting in that region draws OVER the picture (v1.400.1 measured
it mid-drag: the title printed across the video, and fixed it for the watch page with per-frame clips). The docked mini
player is `position: fixed` (`#player-dock`, style.css ~1393, `--z-dock` 950) over a page that SCROLLS under it; clipping
the whole scrolling page out of a fixed rect would need a write per scroll frame, and iOS scrolls on its own thread
(the scroll event arrives late), so the page's text would flicker across the video. So: **while docked, native draws the
picture ABOVE the web view**, at the dock's picture rect, and lets touches pass through to the web.

## Rulings (Dean, 2026-11-01)

- **L1 - live picture in the app's dock.** In an app build that announces the new capability, the docked mini player
  shows the live video (sound unchanged). Safari, the PWA, desktop and app builds without it: byte-identical to v1.400.1.
- **L2 - the X moves into the bar.** With the live dock picture, the mini player's bar holds play/pause on the left and
  the X on the right, both full thumb size (`--size-touch`). Only there; Safari keeps today's corner X.
- **L3 - captions in a strip under the picture.** (Dean first ruled "none in the dock", then 2026-11-01: "Actually I don't
  mind the transcripts being in the MiniPlayer", and picked the strip.) With the live dock picture and captions ON, the web
  draws a fixed two-line caption strip between the picture and the bar (outside the picture rect, so the native layer never
  covers it); a fixed height while captions are on, so the dock never jumps per cue; no strip while captions are off.
- **L4 - covered = thumbnail.** While a sheet, menu, dialog, popover or toast overlaps the dock's picture, the live picture
  gives way to the thumbnail (the sound never stops) and comes back the moment the dock is clear.

## Contract (add-only; frozen by this plan, confirmed by the iOS Root through Dean before the web merges)

- New capability **`nativeVideoDock`**, announced only beside `nativeVideo`. CAPABILITIES lists in host-adapter.js,
  native-bridge.md and the schema gain it (add-only).
- `video.surface` gains one optional field **`layer: 'below' | 'above'`** (absent = `'below'`, today's meaning). The web
  sends it ONLY when `nativeVideoDock` is announced (host-adapter's field spec gates it by capability, so a v0.16 app
  never receives an unknown field). `'above'` is valid only with `space: 'viewport'` (native rejects `'above'` with
  `'document'`).
- Native with `layer: 'above'`: the picture view moves ABOVE the web view at the rect (viewport space, CSS px), its view
  has `isUserInteractionEnabled = false` (every touch reaches the web: tap to expand, play/pause, the X), corners rounded
  by `radius` on all four corners in `'above'` (the dock clips its whole box), frame and layer changes applied with
  implicit animations disabled (`CATransaction.setDisableActions(true)`; the v1.400.1 recording showed a one-frame
  clipped strip on each snap). Switching `'below'` <-> `'above'` keeps the player and never re-buffers.
- The host still hides the layer on every main-frame navigation commit (section 6); `visible: false` still hides it.

## Requirements (spec anchor)

- **R1 - the docked measure.** `surfaceMeasure()` (native-audio.js ~386) today returns `visible: false` when the element is
  inside `#player-dock`. With `nativeVideoDock`: docked = `visible: true`, `space: 'viewport'`, `layer: 'above'`, the rect
  of the dock's picture (the `#media-player` box; the bar is the wrapper's padding below it), `radius` = the dock's own
  corner radius (`#player-dock` has `border-radius: var(--r-md)`; the wrapper in the dock has none - read the dock).
  Without it: exactly today's `visible: false` and thumbnail.
- **R2 - transitions keep the picture covered by a hole or above, never neither.** The web cannot know the frame native
  applies a layer switch. Ordering rule: going to `'above'` (the fly-in settles), keep the hole open (harmless under an
  above layer) until at least two animation frames after the `'above'` post, then close the hole and drop the body's
  transparency; going to `'below'` (expand from the dock), open the hole FIRST, post
  `'below'` on the next frame. During the fly-in (`is-minimize-settle`) the layer stays `'below'` and follows per frame
  (v1.400.1's live loop and clips), and switches to `'above'` at the settle end. Falsifier for the device pass: a black or
  page-coloured flash in the dock box at the end of the fly-in or the start of an expand means native applies the switch
  later than two frames - a re-root-cause (stop rules), never a longer timer patched in.
- **R3 - the dock's look with a live picture (L2, L3).** One class on `<html>` while the docked picture is live above
  (e.g. `ft-native-dock`): the corner X (`.player-dock-close`, built at player.js ~10767) moves into the bar at the right,
  `--size-touch` square, play/pause stays left; the dock's `.cc-overlay` leaves the picture and renders as the fixed two-line strip between the picture and the bar while
  captions are on (L3; the dock grows by the strip's height once when captions turn on, never per cue, and the picture rect R1
  measures stays the picture alone). The pull's target, `dockRestingRect()` (player.js, `h = w * 9 / 16 + --size-touch`),
  must include the strip while it shows, or the v1.400.1 pull aims short. Removed on expand, close, a covered
  fallback (R4: the thumbnail dock keeps the bar layout so nothing jumps while covered) - the builder decides and states
  which, keeping the X position stable across covered/uncovered.
- **R4 - covered = thumbnail (L4).** While docked-above, detect any rendered element outside `#player-dock` that sits
  above `--z-dock` and intersects the dock's picture rect (sheets, modals, menus, popovers, toasts, the selection bar: the
  z-ladder enumeration is the census; add a test that every family above 950 there is detected). Covered -> post
  `visible: false` (the thumbnail poster shows, dockArt S3a); clear -> `visible: true` again. Note `elementFromPoint`
  skips `pointer-events: none` elements (toasts), so a hit-test alone is not the census - measure, do not assume. The
  detection must be event-driven with zero cost while idle (the v1.399.0 gate r1 WARNING: a sampler that feeds itself;
  prove zero extra posts and zero extra reads per idle second, docked and covered, as v1.399.0 and v1.400.1 measured).
- **R5 - everything else stays.** Tap the dock to expand, play/pause, the X, the dock's own ResizeObserver, rotation while
  docked (the viewport rect re-measures on resize / visualViewport), the keyboard, the Continue here card beside the dock,
  music / audio items in the dock (never a picture: only an owned surface video), the v1.400.1 pull. An app build without
  `nativeVideoDock`, Safari, the PWA, desktop: byte-identical (prove it with the same fixtures run with the cap off).

## Waves

- **W1 - contract**: host-adapter.js (CAPABILITIES, the `layer` field gated by `nativeVideoDock`, the `'above'` +
  `'viewport'` pairing), native-bridge.md (sections 3, 5 and the table), the schema; tests that a host without the cap never
  receives `layer`.
- **W2 - R1 + R2**: the docked measure and the ordering rule in native-audio.js; jsdom tests driving the REAL dock() /
  expand() / playMinimizeSettle path (reachability, LESSONS 2/11): the post sequence at the settle end and at expand, hole
  open across each switch, cap off = today's posts byte-for-byte.
- **W3 - R3**: the bar layout and the caption strip under the class (captions on and off, a long cue clamps to two lines); headless before/after crops of the dock with the class
  on and off (LESSONS 3, measure UI changes); `npm run lint:ui` and the overlay containment census stay green.
- **W4 - R4**: the covered detection and its census test; the idle measurement.
- **W5 - docs + release**: LESSONS (the bug class: "a see-through hole cannot hide content above it - a fixed overlay over
  a scrolling page needs the picture above the page"), DEVICE-CHECKS "Live mini player (v1.401.0; after the app build that
  announces nativeVideoDock)", ROADMAP Shipped, releases.json in user language, the version bump. Also delete the
  confirmed "Minimize follow (v1.400.1)" section (a)-(g) from DEVICE-CHECKS (Dean confirmed 2026-11-01).

## iOS Root relay (Dean pastes this into the iOS Root; the Root sent it with this plan)

> FileTube web v1.401.0 adds the capability `nativeVideoDock` (announce it beside `nativeVideo`) and one optional field on
> `video.surface`: `layer: 'below' | 'above'` (absent = below; the web sends it only when you announce the cap; `'above'`
> only with `space: 'viewport'`, reject it with `'document'`). With `'above'`: move the picture view ABOVE the WKWebView at
> the rect (viewport CSS px, same clamps), `isUserInteractionEnabled = false` so every touch reaches the web, round all four
> corners by `radius`, and apply every frame/layer change inside `CATransaction.setDisableActions(true)`. A switch
> below <-> above must keep the AVPlayer and never re-buffer. Everything else in section 3/6 is unchanged (hide on every
> main-frame navigation commit; `visible: false` hides). The web keeps its hole open for two frames across a switch; tell me
> if your switch can land later than that. Please confirm or push back before the web merges; app version v0.17.0 stacked
> on v0.16.0. Device checks run on that build: the web's DEVICE-CHECKS "Live mini player (v1.401.0)".

## Device checks (Dean, on the app build that announces nativeVideoDock)

- (a) Pull a playing video down into the dock: the picture keeps playing in the mini player, no black or page-coloured
  flash at the end of the fly-in.
- (b) Scroll Home and the Feed under the mini player: no text or thumbnail ever shows on top of the video.
- (c) The bar: play/pause on the left, X on the right; ten thumb taps each without a mis-tap into expand. Captions
  on: they show in a strip under the picture, never on it, and the dock does not jump as the lines change.
- (d) Open the sticker sheet, a card menu and a dialog over the dock, and trigger a toast: the dock shows the thumbnail
  while covered, the live picture right after; the sound never stops.
- (e) Tap the mini player: it expands with the picture in place, no flash; pull it down again: still smooth (v1.400.1).
- (f) Rotate the phone while docked; lock and unlock while docked: the picture is in the dock at the right frame.
- (g) Music or a podcast in the dock: unchanged (no picture). Safari, and the app before v0.17.0: the mini player exactly
  as in v1.400.1.

## Gate

Full gate: adversary (floor), qa, security-brief (the version bump touches `package*.json`, and a bridge field is a
network-boundary-shaped surface). Brief them with LESSONS 2, 3, 4, 6, 7, 8, 12 and these attack surfaces: (1) the
cap-off path is byte-identical (every post, every class); (2) the R2 ordering at every switch, including a close or a new
load mid-settle and an expand while covered; (3) the R4 census against the z-ladder and the idle cost; (4) a stale
`ft-native-dock` class or open hole after any end path; (5) host-adapter never sends `layer` without the cap. Ship on
CRITICAL/WARNING closure; ask Dean at round 3.

## Release

`docs/RELEASING.md` + AGENTS.md: `npm version 1.401.0 --no-git-tag-version`, ROADMAP Shipped, `docs/releases.json` in
pure user language (say plainly that the live mini player needs the next iPhone app update), DEVICE-CHECKS (W5), the plan
closed with `node scripts/plan-complete.js docs/exec-plans/active/2026-11-01-live-dock-picture.md "Shipped v1.401.0" --apply`
in the release PR, the protected-main PR flow. **Do not run `gh pr merge` until Dean says so** (he confirms the iOS Root
accepted the contract). Ask with AskUserQuestion when CI is green; then merge, `git pull --ff-only`, delete the branch
(remote via `gh api -X DELETE`, local `-d`), confirm the tag's Publish Docker Image run is green.

## Evidence (the builder fills this)

### Step 0 (2026-11-01, Fable builder, worktree feat-v1.401.0-live-dock-picture at 08d8a967 = main 958f86f2 + this plan)

Read as listed. Seams verified by name: host-adapter.js CAPABILITIES + MESSAGES['video.surface'] + post(); native-audio.js
surfaceMeasure / surfaceSync / holeApply / dockArt / surfaceOff / surfaceWire; player.js dock() / expand() / mountInSlot() /
minimizeToDock() / playMinimizeSettle() / dockRestingRect() / ensureDockChrome() (the X) / the cc overlay build + setCaptionsOn;
style.css #player-dock, .player-dock-close, the M5 phone block, #player-dock .cc-overlay(-text); the z ladder (tokens.css --z-dock 950,
--z-sheet 1500, --z-panel 1600, --z-modal 2000, --z-top 2200, --z-player-max 1100, --z-header 1000). The covering families above 950
were enumerated from the stylesheets (every position: fixed rule with a z above the dock): header, .ui-scrim / .ui-sheet (every ui.js
sheet, dialog, menu, popover, confirm), .ui-toast-host (+ .ui-toast), .speed-sheet-backdrop, .whcal-overlay, .mms-full, and the player's
own css-fullscreen / audio-expanded wrapper (which the dock never holds).

**One stated deviation from R2's sentence** ('below' during the fly-in, 'above' at its end): the v1.400.1 recording shows Home
arriving 6 frames after the release (n = 446 -> 452) while the fly-in runs ~17 frames (--dur-sheet 280 ms); a below layer during the
fly-in would be painted over by Home's cards for the rest of it (a hole removes backgrounds only, and the v1.400.1 clips cover the WATCH
page's siblings alone). So the web posts 'above' on the fly-in's FIRST frame (the FLIP start pose) and follows per frame; the hole stays
open through the fly-in as the belt for the switch frames and closes two frames after rest (R2's invariant, covered by a hole or above,
never neither, holds on every frame). The device falsifier stands as written in R2; one more for the pass: a picture trailing the dock's
chrome by a frame during the fly-in (the bridge hop under an above layer) is a native-side latency reading, not a web patch.

- W1 (84cef94f): host-adapter.js CAPABILITIES + nativeVideoDock; video.surface gains `layer: 'below' | 'above'` (optional) gated by the
  FIELD's own capability (fieldCaps: a message carrying layer to a host without it is refused whole, never trimmed to a 'below' it did
  not mean), 'above' only with space 'viewport'; the schema ($defs/surfaceLayer, the capability enum) and native-bridge.md sections 1, 2,
  3 (the Live dock picture block), 5, 6. test/unit/native-bridge-dock.test.js (4); the conformance mirror and native-bridge-video stay
  green (28/28). Mutants (sandbox): M1 the field gate removed -> red by name; M2 the above/viewport pairing removed -> red by name.
- W2 (34594c9c): native-audio.js surfaceMeasure (R1: docked under the cap = visible, viewport, layer above, the #media-player box, the
  dock's own radius; explicit 'below' elsewhere; no layer key without the cap), surfaceSync (R2: aboveHold = two FRAMES of open hole
  after a below -> above post, counted in rAF syncs only; belowPending = the hole opens first on above -> below and the post waits a
  frame, the poster off before it), holeApply (a fixed box converted to the document-space layer; fullscreen keyed on fs), dockArt (the
  live picture flies, the poster waits for the rest under the layer), dockLive(). player.js: nativeSurfaceSync is held while
  minimizeToDock commits (dock() AND the setCssFullscreen(false) inside its applyControlsMode both synced before - measured by a stack
  trace in jsdom: two syncs in the commit tick, the first posting the dock's REST rect before the FLIP start); minimizeToDock runs the
  one sync once the pose is set. test/unit/native-dock-live.test.js (8 at W2): the docked measure with a scrolled page (the hole in
  document space, the post in viewport space), the v1.400.1 byte-for-byte CONTROL, expand's hole-first ordering, the fly-in's first
  post at the FLIP start pose and the per-frame follow, reduced motion, rotation, close(), a track taking the dock, the idle census.
  Mutants (sandbox, 9): aboveHold never set, no hole-first, dockLive never, layer dropped, the sync not held while committing, the dock
  radius not read, the poster during the fly-in, the hole not converted to document space, the hold ignoring frames: all red by name.
  Families (v1.400.1 follow, surface x5, bridge, audio, lifecycle, dock): 323 pass, 0 fail.
- W3 (54f55946): html.ft-native-dock (dockClassApply, idempotent, from the fly-in's first frame, kept while covered, off on expand /
  close / stand-down); style.css under the class: the X in the bar's right end (--size-touch square, over the bar via the ladder idiom
  calc(var(--z-sticky) - 21) = 9), the bar --size-touch tall with the X's seat reserved, the caption strip (32 px = --size-control-sm,
  between the picture and the bar, #player-wrapper.is-cc-on grows the reserve once); player.js setCaptionsOn (the ONE writer of the flag
  and the mark), dockRestingRect + the strip under the cap with captions on. lint:ui TOTAL 3142 = docs/ui-exceptions.json (no new
  debt); overlay-containment 0. Tests (+5 in native-dock-live): the class lifecycle, the captions writer, the pull's target through the
  real touch pull (the scale at dy 100 against minimizeDragTransform with and without the strip / the cap), the CSS source lock; the old
  locks in player-audio-cc-overlay-freeze-fix updated in place (the pre-commit hook caught them red). Mutants (sandbox, 8): the class
  never added / never removed / ignoring the cap, the mark not written, the strip ignored / taken without the cap, the X at the top
  (CSS), the strip height off #player-dock (CSS): all red by name. **Headless crops** (scripts/live-dock-probe.js, Chromium 1234, the
  real app, a fake host with and without nativeVideoDock, a clip with a VTT sidecar): dock-on-cc0 / dock-on-cc1 / dock-off-cc0 /
  dock-off-cc1 (the scratchpad, sent with the report) and 41 measured checks ok - cap on: the X 44x44 at (338, 720) = the bar's right
  end below the picture, play/pause at the left, the seek bar ending before the X, the surface above / viewport at the #media-player
  box (radius 12 = the dock's --r-md), the hole closed, the dock 134 -> 166 with captions (the strip 32 tall between the picture and the
  bar, the picture box unchanged at 160x90, --player-dock-h 166), the posted rect the picture alone, every hit test inside the picture
  landing on the picture; cap off: the v1.400.1 dock byte for byte (visible false, no layer key, the X at the picture's top-right,
  captions over the picture).
- W4 (this commit): native-audio.js coverScan (the browser's elementsFromPoint at the picture's centre and four inset corners; anything
  above the dock in the stack that is not see-through covers it; a childless transparent element - ui.js's clear scrim - hides nothing),
  event-driven only: coverWake on body's direct childList + each body child's class / hidden / style / childList (never the dock, never
  the hole), #view-root's childList + its subtree's hidden attribute (the Pocket cover), the body / html / wrapper / container signals
  the surface sampler already hears, transitionend / animationend (capture), resize / orientation / visualViewport; the first docked
  measure always scans (dock() is a signal); never the 1 s backstop. covered -> visible: false (the poster under the layer shows; the
  html class stays so the bar never jumps), clear -> visible: true; a cover mid-fly-in puts the thumbnail on the flying box.
  test/unit/native-dock-covered.test.js (12): the CSS-derived census (every fixed rule above --z-dock in style.css + ui.css must be a
  classified family: covers / self / static; a new one fails), one reveal + clear test per covering family (.ui-sheet + scrim,
  .speed-sheet-backdrop, .whcal-overlay, .ui-toast-host + .ui-toast with the host pointer-events none, .mms-full toggled by hidden deep
  in #view-root), the see-through clear scrim, a static body child over the dock at dock time, the idle census, covered mid-fly-in,
  rotation while covered + expand while covered, the cap-off control (no post, no hit test). jsdom has no hit test: the tests install a
  geometry stack over fixture overlays; the REAL hit test is measured by the probe.
- W4 (idle census numbers): jsdom, docked above, one idle second: 0 posts, <= 2 box reads (the backstop), 0 hit tests, 0 attribute
  records on body / html / the hole; docked covered (a sheet held open), one idle second: the same. Headless Chromium (the probe, the real
  app, 2 s each): docked above 0 posts, 0 hit tests, 3 box reads (2 = the backstop, 1 = the instrument's own read); docked covered (a
  bottom sheet held open) 0 posts, 0 hit tests, 3 box reads. Real ui.js surfaces over the docked live picture, the controller's verdict
  against an INDEPENDENT measure (every rendered fixed element above z 950 intersecting the picture rect) - agreed in all five: a toast
  (on the phone it meets the bar, not the picture: visible stays true, 0 posts), a confirm dialog (its dim scrim covers: false, then
  true at Escape, 2 posts), a bottom sheet (false / true, 2 posts), a menu anchored at the header and one beside the dock (on a phone
  ui.menu is a bottom sheet with a dim scrim: false / true, 2 posts each). One scan = 5 hit tests. SUMMARY shots=5 checks=53 failed=0.
- Full suite (Node 22), before the gate and on the release commit: 
- Gate verdicts (bound to sha): 
- Release: tag, PR, Publish run: 

## Out of scope

Native-drawn captions (L3 put them in a web strip instead); swipe-to-dismiss; a live picture anywhere but the dock and the watch slot
(Feed, previews, 360 stay on the web element); the iOS implementation itself (the iOS Root's).
