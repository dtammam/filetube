---
plan: live-dock-picture
harness: v2 · full
branch: feat/v1.401.0-live-dock-picture
anchor: spec
status: Shipped v1.401.0
next: the release PR and the tag's Publish run on Dean's merge word; the device checks on the app build that announces nativeVideoDock (filetube-ios v0.17.0)
design: Rulings approved by Dean 2026-11-01 (AskUserQuestion): L1-L4 below; the builder's Design must stay inside them
gate: APPROVED r2 @c04a3881 (adversary, qa, security-brief); r3 delta on the release commit (the WARNING-8 fix) per Dean 2026-11-01
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
closed with `node scripts/plan-complete.js docs/exec-plans/completed/2026-11-01-live-dock-picture.md "Shipped v1.401.0" --apply`
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
open through the fly-in as the belt for the switch frames (the two-frame hold drains in the fly-in's first two frames, the live loop keeps
it open after, and it closes on the first measure at rest; R2's invariant, covered by a hole or above, never neither, holds on every frame). The device falsifier stands as written in R2; one more for the pass: a picture trailing the dock's
chrome by a frame during the fly-in (the bridge hop under an above layer) is a native-side latency reading, not a web patch.

- W1 (84cef94f): host-adapter.js CAPABILITIES + nativeVideoDock; video.surface gains `layer: 'below' | 'above'` (optional) gated by the
  FIELD's own capability (fieldCaps: a message carrying layer to a host without it is refused whole, never trimmed to a 'below' it did
  not mean), 'above' only with space 'viewport'; the schema ($defs/surfaceLayer, the capability enum) and native-bridge.md sections 1, 2,
  3 (the Live dock picture block), 5, 6. test/unit/native-bridge-dock.test.js (4); the conformance mirror and native-bridge-video stay
  green (24/24; the three bridge files together 28/28). Mutants (sandbox): M1 the field gate removed -> red by name; M2 the above/viewport pairing removed -> red by name.
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
- Gate prep (93cc8f37): two tests binding the W4 mutants that survived (native-dock-covered 12 -> 14): a sheet left open across
  close() and a new load is seen at the next dock; a cover revealed by a BODY CLASS alone is seen through the sampler's body signal.
  The `!coverScanned` term stays as a belt: every signal since a close dirties the flag and nothing consumes it off the dock, so the
  first docked scan is reachable through the flag alone (an equivalent mutant, documented, not fake-tested).
- W4 (idle census numbers): jsdom, docked above, one idle second: 0 posts, <= 2 box reads (the backstop), 0 hit tests, 0 attribute
  records on body / html / the hole; docked covered (a sheet held open), one idle second: the same. Headless Chromium (the probe, the real
  app, 2 s each): docked above 0 posts, 0 hit tests, 3 box reads (2 = the backstop, 1 = the instrument's own read); docked covered (a
  bottom sheet held open) 0 posts, 0 hit tests, 3 box reads. Real ui.js surfaces over the docked live picture, the controller's verdict
  against an INDEPENDENT measure (every rendered fixed element above z 950 intersecting the picture rect) - agreed in all five: a toast
  (on the phone it meets the bar, not the picture: visible stays true, 0 posts), a confirm dialog (its dim scrim covers: false, then
  true at Escape, 2 posts), a bottom sheet (false / true, 2 posts), a menu anchored at the header and one beside the dock (on a phone
  ui.menu is a bottom sheet with a dim scrim: false / true, 2 posts each). One scan = 5 hit tests. SUMMARY shots=5 checks=53 failed=0.
- Full suite (Node 22), before the gate and on the release commit: before the gate at 93cc8f37 `npm test`: 13171 tests, 13158 pass, 0 fail,
  13 skipped (539 s); on the release commit: see the release bullet.
- Gate verdicts (bound to sha): r1 @93cc8f37 security-brief APPROVED, qa CHANGES (W1), adversary CHANGES (C1, C2, W3, W4); r2
  @c04a3881 all three APPROVED (one WARNING disclosed by the adversary (8) and qa (W2): the fly-in's scan read the dock's whole box,
  so a toast on the bar made the thumbnail fly); r3 on the release commit (Dean's call, 2026-11-01: fix it and run r3): the scan
  judges the PICTURE's rest rect (dockPictureRest: the dock box at 16:9 of its width) during the fly-in, bound by a band over the bar
  alone (never covers, in flight or at rest) and one over the picture (covers). The verdict blocks are under Gate r1 below.
- Full suite on the release commit (aa478f1d, Node 22.23.1, `npm test`, run while the three r3 seats mutated on the same box, load
  8.7-11.9 on 6 cores): 13174 tests, 13160 pass, 1 fail, 13 skipped (647 s). The one fail, verbatim: `not ok 6621 - R2 (the fly-in):
  minimizeToDock posts layer above with the FLIP pose on its first frame (not the rest rect), follows the settle per frame with the
  hole open and no poster, and at rest the poster is set and the hole closes` (test/unit/native-dock-live.test.js) - the load flake
  qa named at r3 (S5: a 40 ms wait racing the jsdom settle's ~50 ms clearMinimizeDrag); standalone on the quiet box 5 of 5 runs
  14 pass, 0 fail; recorded in the known-flake list. The suite is re-run on the clean tree after this close-out commit and its
  counts go into the PR body and the next docs line.
- Full suite on the release tree, re-run on the quiet box after the close-out (dfc0d00c = aa478f1d + the plan doc; Node 22.23.1,
  `npm test`): 13174 tests, 13161 pass, 0 fail, 13 skipped (583 s). Green.
- Close-out binding (RELEASING.md step 1, Dean's ruling 2026-10-12): every seat APPROVED r3 at aa478f1d; this commit changes the
  plan doc only (`git diff --name-only aa478f1d..HEAD` = docs/exec-plans/completed/2026-11-01-live-dock-picture.md): the three r3
  verdict blocks and these two bullets. No seat re-check.
- Release: tag, PR, Publish run: 

### Gate r1 fix (2026-11-01)

- **CRITICAL 1 (adversary, R4 x R2) FIXED:** the cover scan judged the FLYING box (the FLIP start pose is where the slot was, under the
  header on a scrolled page), so the live picture hid for the first third of a fly-in. surfaceMeasure now scans the dock's own
  (untransformed) box while the wrapper is live - the picture's destination - and the element box at rest. Bound: a static band over the
  slot never hides the flying picture; a band over the dock's rest box hides it from the first fly-in frame (the thumbnail flies).
- **CRITICAL 2 (adversary, R3 x R2) FIXED:** html.ft-native-dock landed in surfaceSync, after playMinimizeSettle read the FLIP `to` and
  after the first docked measure, so the caption strip's 32 px arrived a frame late (one post 32 px low, then the correction; the FLIP
  start 32 px off). player.js dock() now marks the class at the reparent (native-audio markDocked, a no-op without the capability or a
  surface video) before any box is read, mountInSlot unmarks before its sync; surfaceSync keeps it true after. Bound: every read of the
  wrapper's box inside the dock during the chevron commit, and the first docked post, see the class on.
- **WARNING 3 (adversary, R5) FIXED:** the commit-tick sync hold applied without the capability too, so a v0.16 app's chevron path
  posted one message fewer than main (the rest rect, hidden). The hold and its replacement sync run only under nativeDockLive() with a
  surface video; the CONTROL test now drives the chevron and asserts main's shape (the rest rect, hidden, no layer, on the commit tick,
  the thumbnail from the first frame). Also (INFO 6, qa S1): the cover wiring and the observer swap are gated on the capability, and the
  is-cc-on mark is written only where it has a consumer (the live dock), so a browser and a v0.16 app carry v1.400.1's sampler and DOM.
- **WARNING 4 (adversary, R2 bindings) FIXED:** the reduced-motion test asserts the hole open on frames 0, 1 and 2 after the above post
  and closed on frame 3 (kills aboveHold = 1 and the decrement on explicit syncs); the expand test runs a second dock / expand round
  (kills belowPending never reset).
- **SUGGESTION 5 (adversary):** the census parser now lists every fixed rule whose z-index cannot be resolved, classified in UNRESOLVED
  (two rules with no z at all: z auto paints under the dock); the M16 test retitled to what it binds. M19 / M38 (fewer points), M21
  (seeThrough's text / children guard), M22 (transitionend / animationend: jsdom cannot bind, the probe runs reduced motion), M25, M37,
  M12, M40 (the pre-existing pageshow re-send) stay disclosed as unbound belts.
- **WARNING W1 (qa) FIXED:** native-bridge.md section 3's "The docked mini player shows no picture" and the owners table's nativeVideo
  row are qualified "without nativeVideoDock" and point at the Live dock picture block / the next row.
- **qa S2 / S3:** the hold sentence corrected above; the gate-prep bullet and the bridge test counts added.
- **INFO (adversary 7, disclosed):** a lost native queue or a 'failed' snapshot while docked leaves the above layer visible at the dock
  (the pre-existing v1.399.0 class: the layer shows native's last frame until the next load or close).

### Gate r1

Gate: APPROVED r1 @93cc8f37 - security-brief
  - No CRITICAL / HIGH / MEDIUM / LOW findings. Surfaces reviewed: the new bridge field, the page's hit test, the html class and the custom property, the probe, the schema, the added prose.
  - Verified: `layer` is shaped by code alone (native-audio.js surfaceMeasure: `dockLive ? 'above' : 'below'`, set only under `dockOn`); host-adapter.js enum-checks it, refuses the WHOLE message when the field rides without `nativeVideoDock` (fieldCaps), enforces 'above' + 'viewport', and pick() copies only tabled fields. rect / radius / fit come from getBoundingClientRect / getComputedStyle through num() and round() and the adapter's finite-number checks: no descriptor or page string reaches the wire.
  - Verified: coverScan reduces elementsFromPoint at five points inside the picture rect to ONE boolean (`covered` -> `visible`); seeThrough reads computed style only; nothing from the stack crosses the bridge. `ft-native-dock` is written by dockClassApply from `m.docked && dockOn` only; `--ft-dock-cc-h` is a CSS constant on #player-dock read with parseFloat + isFinite; the added style.css block carries no attr() / url() / content-driven value.
  - Verified: the probe binds the server to 127.0.0.1 port 0 on a fresh mkdtemp DATA_DIR that OVERRIDES any ambient DATA_DIR (a real library is never read or removed), sets the minted cookie only in the scratch Chromium profile, runs ffmpeg via execFileSync with array args, removes its three scratch dirs on exit and only writes to the caller's out-dir. __mintTestSession is a pre-existing export (seven sibling probes use it).
  - Verified: the schema is add-only (the capability enum gains one value; `layer` is an optional $ref, not in required). No em dash in the plan doc, native-bridge.md, the schema, the probe, the realm helper, the three tests, or the added style.css block (the file's 16 are pre-existing lines far from it). package.json and package-lock.json both still read 1.400.1 with the same three runtime deps.
  - Gap (no shell): `git diff 958f86f2..93cc8f37 -- package.json package-lock.json` could not be run; the lockfile BODY is unverified against base beyond its version field. The release-commit re-engagement should cover the bump.
  - INFO (accepted pattern, dev-only): the probe hooks only process 'exit', so a SIGINT / SIGTERM leaves the scratch DATA_DIR (the test admin row) and the Chromium profile (the minted cookie) in os.tmpdir(); worthless once the loopback server is gone. `--no-sandbox` and the CDP port (Chromium binds remote debugging to loopback by default: reasoned, not read in Chromium's source) are reachable by any same-user local process during the run. Same as the seven existing probes.

Gate: CHANGES r1 @93cc8f37 - qa
  - Instruments at 93cc8f37 (Node 22): lint 0 errors (6 pre-existing no-unused-vars warnings in common.js, not in the diff); lint:ui TOTAL 3142 = docs/ui-exceptions.json; overlay-containment 0 violations; check-markers clean; the targeted families 182 tests, 182 pass, 0 fail; native-bridge-contract + native-bridge-video alone 24/24; live-dock-probe SUMMARY shots=5 checks=53 failed=0 ok; em-dash grep on added lines: none.
  - Crops: dock-on-cc0 = play/pause left, X right in the bar, both 44 (L2); dock-on-cc1 = a 32 px two-line strip on the dock's black between the picture and the bar, the picture box unchanged (L3); dock-off-cc0/cc1 = the v1.400.1 corner X and captions over the picture; dock-on-covered = the bottom sheet's body over the whole dock. They match the rulings.
  - WARNING W1 (stale contract prose, docs/references/native-bridge.md:193 and :248): section 3 still states unconditionally "The docked mini player shows no picture: ... the web sends visible: false while docked" and the owners table's nativeVideo row "the docked mini player sends visible: false (v1.399.0)"; the Live dock picture block 16 lines later says the opposite under nativeVideoDock. Scenario: the iOS Root implements v0.17.0 from section 3 top-down and meets a bold rule the same section contradicts. Fix: one clause in each ("without nativeVideoDock, ..." / "... ; with nativeVideoDock the dock is live, next row"). It can ride the W5 docs commit (the tree moves for W5 anyway; I re-verify the delta at that sha).
  - SUGGESTION S1 (native-audio.js surfaceWire): coverWire and the coverWake swap run under surfaceOn without dockOn, so the v0.16 app's sampler now measures once per document-wide transitionend / animationend / body-child mutation. Measured in jsdom (cap OFF, docked): 1 box read and 0 posts per signal, the idle second unchanged (1 read); posts, classes, poster and CSS are byte-identical (CONTROL tests, the probe's off runs). Gating coverWire on dockOn keeps v1.400.1's sampler exactly for the v0.16 app.
  - SUGGESTION S2 (plan Evidence, the deviation paragraph): "closes two frames after rest" is inaccurate. aboveHold (2) drains in the fly-in's first two rAF syncs; at rest the hole closes on the first non-live sync. The invariant holds (the above post is ~17 frames old by then); fix the sentence. The code comment at native-audio.js ~152 is accurate.
  - SUGGESTION S3 (Evidence bookkeeping): no bullet for 93cc8f37 (native-dock-covered 12 -> 14 tests); "28/28" is bridge-dock 4 + contract/video 24 (I measured 24 for the two named files) - say so.
  - INFO: the R2 deviation (above posted on the fly-in's first frame) meets R2's invariant and L1: every frame is covered by a hole (live follow + the hold) or above; cap-off byte-identical as measured. A dim scrim far from its sheet reading as covered is acceptable under L4: a full-viewport dim overlaps the picture by construction, and an un-dimmed live picture above a dimmed modal page would be wrong.
  - INFO (R4 census): the parser handles nested @media, one-line rules and position:fixed without a space; my independent parse of every z-index rule resolving above 950 in style.css + ui.css agrees (9 fixed families, none with fixed and z split across blocks; no inline fixed in the shells). Outside the stylesheet census: three JS-written fixed diagnostics (#ft-rotate-panel, #ft-lifecycle-overlay at z 999999 bottom-anchored, the perf badge), all body-appended with pointer-events auto, so the body childList signal + the hit test sees them (reasoned). A cover overlapping only a < 14 px edge band of the picture is missed by the five points (acceptable).
  - INFO (R4 cost): one scan = 5 elementsFromPoint, once per signal (jsdom: 10 transitionend -> 50 hits, 10 body-child class writes -> 50 hits, idle second 0 hits); the probe's idle census ran under reduced motion, so I checked the dock for a periodic transition: the seek fill is a --seek-fill custom-property gradient with no transition and the only .player-controls opacity transitions are fullscreen / audio-expanded (the dock never holds them). No per-second scan expected on the device.
  - INFO (R2 hold): verified on every path - dock() under minimizeCommitting skips its own sync and applyControlsMode -> setCssFullscreen(false)'s (player.js 2822/2937); try/finally resets the flag; the refused dock syncs explicitly; an exception propagates as before the diff with the flag reset.
  - INFO (R3): the X is a #player-dock child, so bottom: 0 / right: 0 holds with and without the strip (probe: 338,720 both); specificity (1,2,1) / (2,1,1) beats every #player-dock rule and the block follows them in file order. A > 768 px dock under the class gets bar 44 / reserve 44 / X 44 (one value) but play/pause keeps the 22 px .pc-btn face (the M5 32 + 44 ring is <= 768 only): L2's "both full thumb" holds at phone widths; reachable only if the app ever runs at > 768 CSS px. #player-dock { --ft-dock-cc-h } changes nothing cap-off (read only by html.ft-native-dock rules and dockRestingRect behind nativeDockLive()). dockRestingRect's var()-substituted read of --ft-dock-cc-h in a real browser is spec behaviour, reasoned not measured (the probe checks --player-dock-h).
  - INFO: ROADMAP Planned plan B (446-449, 943), DEVICE-CHECKS, LESSONS, releases.json and the version bump are W5, untouched at this sha; this approval binds to 93cc8f37 and the W5 sha needs re-engagement.
  - Security: no new surface - the only new wire field is `layer` from a fixed enum shaped by code and validated by the adapter (fieldCaps keys are hard-coded, warn() strings come from table keys); no eval, shell, route, dependency or package change; the probe is a dev script on loopback (mkdtemp dirs, execFileSync array args, the pre-existing __mintTestSession); the census test reads repo files only.
Gate: CHANGES r1 @93cc8f37 - adversary
  - Instruments (run by this seat): targeted families 171 pass / 0 fail; lint:ui TOTAL 3142 = docs/ui-exceptions.json; overlay-containment 0; em dash in added lines 0; the committed probe from a git-archive sandbox: SUMMARY shots=5 checks=53 failed=0; 40 mutants in the sandbox: 28 killed, 12 survived (listed below).
  - CRITICAL 1 (R4 x R2, the fly-in): the cover scan runs against the FLYING box, and the header (z 1000, 'static' in the census = "never meets the dock", true at rest only) covers the FLIP start pose whenever the slot's top is within the scan inset (14 px) of the header's bottom. Measured (Chromium, real app, cap on, reduced motion off, captions OFF, window.scrollTo(0, 45) so the slot top is 27, chevron): the fly-in's first post is {0,27,390,219} visible:false, dockCovered() true for frames 1-4, visible:true only from frame 5 (box at y 601) when a later signal rescans - the live picture is missing for the first third of the fly-in (device check (a)). With captions ON it happens unscrolled (see 2). Direction: never scan the live box (scan the dock's rest rect, or scan only when !m.live and keep the verdict across the fly-in); the census's 'static' disposition must be re-stated.
  - CRITICAL 2 (R3 x R2, captions on): html.ft-native-dock is applied in surfaceSync AFTER playMinimizeSettle read the FLIP `to` and AFTER surfaceMeasure's box read, so the strip's 32 px land after both. Measured: dock() with captions on posts {222,630} then {222,598} one frame later (the picture one frame 32 px low over the strip and bar; the plan's "no second post" holds in jsdom only, which has no stylesheet); the chevron's FLIP start pose lands at y 40 while the slot is at 72 and the first post says 72 (a 32 px jump), then frame 1 is under the header and hides (finding 1). Direction: apply the class before the FLIP pose is read and before the measure (dock() under the hold, or compute dockLive from the DOM, apply, then measure).
  - WARNING 3 (R5 / surface 1): the cap-off chevron path is NOT byte-identical to base 958f86f2. Same sequence (load, dock, expand, chevron, cc on, dock, close) on base vs head with VIDEO_CAPS, measured post for post: base posts the dock rest rect {225,640} visible:false on the commit tick and the FLIP rect next frame (8 posts); head skips the rest-rect post and posts the FLIP rect on the commit tick (7 posts). All visible:false so nothing shows on a v0.16 app, but the plan's R5 and the CONTROL test's "byte for byte" claim are false for this path (the test covers dock()/expand() only). Fix: hold the sync only under nativeDockLive(), or amend R5 and the test's claim and cover the chevron.
  - WARNING 4 (R2 bindings): the two-frame hold boundary is unbound - mutants aboveHold = 2 -> 1 (M4) and "decrement on explicit syncs too" (M6) survive all 147 tests; measured binding shape on correct code: hole open on frames 0, 1, 2 after the above post, closed on 3. belowPending never reset (M39) survives: a SECOND expand would lose hole-first; no test expands twice with the ordering asserted. Add a frame-counting test and a second-expand test.
  - SUGGESTION 5 (survivors and census): M19 centre point only, M38 inset 0, M21 seeThrough ignoring text/children, M22 transitionend/animationend dropped (jsdom cannot bind it; the probe runs reduced motion so never exercises it either; my no-reduced-motion traces flipped on childList/class with one frame of lag), M25 resize alone, M37 watching the dock too, M12 the refused-dock sync (a belt), M40 the pageshow re-send (pre-existing). M16 (`!coverScanned` dropped) is EQUIVALENT: coverDirty is set by every signal at any time and never consumed off the dock, so the gate-prep test passes through the load's own signals - its "with no new signal" name is a lying claim. The census parser silently drops fixed rules whose z-index is absent or unresolvable (body.mms-tray .music-nowplaying-panel, .ipm-kb): list and classify them too.
  - INFO 6: the cap-off path now writes #player-wrapper.is-cc-on on every CC toggle (no CSS consumer outside html.ft-native-dock; one extra measure, 0 posts on a nativeVideo host) and #player-dock carries --ft-dock-cc-h unconditionally: inert, disclosed.
  - INFO 7 (verified clean): new load mid-settle, close() mid-settle, expand then dock() in one tick, pageshow persisted (re-send above, hole 2 frames), surfaceOff during the hold, dock() refused, a sheet open/close traced per frame (one frame of lag, agreed otherwise), the X 44x44 at (338,720) hit-tests as .player-dock-close and pp as pp-btn, the strip 32 tall across cue / gap / cue with the dock at 166 and 0 posts, a toast at y 707 never meets the picture, in-app navigation to Home while docked stays consistent, the fieldCaps fence binds (M3: 15 tests red). Lost queue (rev 0 idle) and 'failed' while docked leave the above layer visible at the dock (pre-existing v1.399.0 class). The stated deviation ('above' from the FLIP start) is judged sound; the trailing picture is device-only.

Gate: APPROVED r2 @c04a3881 - security-brief
  - Delta re-check (2196dced + c04a3881) traced by Read/Grep; no shell. Nothing new reaches native, a URL, a style value or a shell. No CRITICAL / HIGH / MEDIUM / LOW findings; my r1 findings were none, so nothing to re-verify as fixed.
  - Verified: the cover scan's new input (native-audio.js:510 `live ? dockEl.getBoundingClientRect() : r`) is a DOMRect from the dock element itself, consumed by coverScan through num() into five hit-test points and reduced to the same ONE boolean; the wire shape is unchanged (host-adapter.js untouched, `layer` still from `dockLive ? 'above' : 'below'` at :519).
  - Verified: `markDocked(on)` (native-audio.js:1019) is `dockClassApply(!!(on && dockOn && ownedSurface && ownedId))`, a fixed class name driven by booleans; player.js calls it with literals (dock() :10924 true, mountInSlot :10721 false). `is-cc-on` (player.js:2528) is toggled from `audioCaptionsOn && nativeDockLive()`, booleans only. The observer swap (`wake = dockOn ? coverWake : surfaceSchedule`, :379) and `if (dockOn) coverWire(doc)` (:403) only narrow when the cover wiring runs; the commit-tick hold (player.js:6062) is a sequencing flag. No new DOM sink, no new URL, no eval, no shell, no route, no dependency.
  - Verified: no em dash in native-audio.js, host-adapter.js, native-bridge.md, the probe, the realm helper, the three tests or this plan doc; player.js's 13 em dashes sit at lines 1561-2774 and 9321 / 9368, none in the delta lines (1145-1148, 2524-2528, 5782, 6062, 10721, 10924). native-bridge.md:193 and the owners table row now read "without `nativeVideoDock`": accurate against the code.
  - package.json still 1.400.1 at this sha. Gap carried from r1: the lockfile body is unverified against base without a shell; the close-out bump rides Dean's bookkeeping rule.

Gate: APPROVED r2 @c04a3881 - qa
  - Instruments at c04a3881 (Node 22): lint 0 errors (the same 6 pre-existing common.js warnings); lint:ui TOTAL 3142 = docs/ui-exceptions.json; overlay-containment 0 violations; check-markers clean; em dash in added lines 0; the targeted families 184 tests, 184 pass, 0 fail (182 at r1 + the C1 and C2 tests); live-dock-probe SUMMARY shots=5 checks=53 failed=0 ok, the five crops pixel-for-pixel the r1 look (X 44x44 at 338,720 in the bar, the 32 px strip, the cap-off corner X and over-picture captions, the sheet over the covered dock).
  - W1 fixed as prescribed: native-bridge.md:193-195 "shows no picture without `nativeVideoDock`" and points at the Live dock picture block; the owners table row :249 "without `nativeVideoDock` (v1.399.0; with it the dock is live, next row)".
  - S1 fixed as prescribed (native-audio.js :379 `wake = dockOn ? coverWake : surfaceSchedule`, :403 `if (dockOn) coverWire(doc)`), re-measured with my cadence script: cap OFF docked = 0 box reads on a body-child append, on ten transitionend, on ten body-child class writes; the idle second 1 read (the backstop); 0 posts; `is-cc-on` false after a CC click; the chevron commit tick posts the rest rect {225,640} document visible:false with no layer key (main's shape, the adversary's W3), then the fly-in poses. Cap ON unchanged: 5 hit tests per signal, 0 idle, the FLIP pose on the commit tick with the class on.
  - S2 fixed: the deviation paragraph now reads "the two-frame hold drains in the fly-in's first two frames, the live loop keeps it open after, and it closes on the first measure at rest" - matches the code. S3 fixed: the 93cc8f37 bullet and "24/24; the three bridge files together 28/28".
  - The adversary's fixes, verified from the code and the new bindings: C2 markDocked is `dockClassApply(!!(on && dockOn && ownedSurface && ownedId))`, a no-op DOM-wise without the capability (dockClassApply checks contains before any write); dock() marks before applyControlsMode and its sync, mountInSlot unmarks before its sync; the html class signal it raises is cancelled by the same tick's explicit sync (the probe still shows 2 posts for slot -> dock). W3 the hold is `nativeDockLive() && nativeSurfaceOwned()` and both the hold and the replacement sync are gated on it. W4 frames 0, 1, 2 open and 3 closed are bound; the second expand round is bound. The census lists the two no-z fixed rules in UNRESOLVED.
  - WARNING W2 (new, from the C1 fix; native-audio.js surfaceMeasure, the `live ? dockEl.getBoundingClientRect() : r` scan box) - safe to ship disclosed, fix in the W5 commit: during the fly-in the scan box is the dock's WHOLE box (picture + strip + bar), so its bottom inset points (14 px up from the bar's bottom) sit on the bar, and a toast that meets only the bar reads as covering while the picture flies. Measured in jsdom with the realm's geometry hit test: a toast over the bar alone -> dock() at rest visible true / covered false (correct); the chevron commit -> the first fly-in post visible false, covered true, the thumbnail flies; at rest visible true again (the settle-end class removal on the wrapper is a surfaceMo signal, so the rescan is guaranteed without transitionend); 5 posts for the round instead of 3. Scenario on the device: Dean taps Add to queue (a bottom toast) and pulls the video down within its 3 s - the thumbnail flies and the live picture arrives at rest instead of flying live. Why disclosed is acceptable: the window is a toast overlapping a 280 ms fly-in, the fallback is the thumbnail (never black), the rest state corrects itself in the same tick the settle ends, and device check (d) covers toasts. One-line tightening: scan the picture's rest rect, the dock box with `height = width * 9 / 16` (the dock's own aspect rule), so the fly-in is judged where the PICTURE lands; then the R4 block's "the picture's centre and four inset corners" sentence (:434) is exact again. I re-verify it as a delta on the W5 sha.
  - SUGGESTION S4 (comment accuracy, native-audio.js :434): the R4 block still says the hit test runs "at the picture's centre and four inset corners"; since C1 that is the dock's box during the fly-in - fold the C1 note in (or let W2's fix make the sentence true). The player.js nativeSurfaceSync / minimizeCommitting comments (:5795, :10266) describe the hold without naming its capability gate; not false (the hold is an R2 mechanism and R2 is cap-only), the minimizeToDock line names it.
  - INFO: no new security surface in the delta - markDocked and the hold are boolean-driven sequencing, the observer swap narrows wiring, the doc edits are prose. ROADMAP Planned, DEVICE-CHECKS, LESSONS, releases.json and the version bump remain W5; this approval binds to c04a3881 and the W5 sha needs re-engagement (W2's tightening rides it).
Gate: APPROVED r2 @c04a3881 - adversary
  - Instruments (this seat, fresh git-archive sandboxes of c04a3881): targeted families 173 pass / 0 fail; lint:ui TOTAL 3142 = docs/ui-exceptions.json; overlay-containment 0; em dash in added lines 0; the committed probe SUMMARY shots=5 checks=53 failed=0; my two probe traces and the base-vs-head differ re-run; 15 mutants: 7 killed, 8 survived (all belts or equivalents, below).
  - CRITICAL 1 FIXED as prescribed (the live scan reads the dock's untransformed box): the scrolled captions-off fly-in (scrollTo 45, slot top 27, chevron) is visible:true on every frame while the independent measure lists the header over the FLIP start; mutant F1 (scan the element box while live) is red by the new C1 test.
  - CRITICAL 2 FIXED as prescribed (markDocked at the reparent): captions-on dock() posts ONCE at y 598 with the class already on; the chevron's FLIP start is the slot box (y 72) and the first post matches it; the strip stays 32 across cue / gap / cue, dock 166, 0 posts; the X and pp hit-test as themselves. Mutant F2 (dock() not marking) red. A refused dock() never marks (every early return precedes the mark); a track taking the dock, expand in the same tick and close() all drop the class (my hard cases, 9/9).
  - WARNING 3 FIXED: the cap-off sequence (load, dock, expand, chevron, cc on, dock, close) is byte-identical between base 958f86f2 and c04a3881 (my differ: posts, classes, poster, hole, states); mutant F3 (hold without the capability) red by the CONTROL test's chevron leg. is-cc-on no longer appears without the capability (F5 red, 2 tests).
  - WARNING 4 FIXED: M4 (aboveHold = 1), M6 (decrement on explicit syncs) and M39 (belowPending never reset) are each red by exactly the new assertions; my own frame count on correct code is still [open, open, open, closed].
  - WARNING 8 (NEW, introduced by the C1 fix; argued SAFE TO SHIP DISCLOSED): while the wrapper flies the scan reads the dock's WHOLE box (picture + bar + strip), not the picture's destination. Measured (Chromium, cap on, a one-line toast at y 720-764 = over the bar only, the picture ends at 720, then the chevron): covered true and the THUMBNAIL flies for the whole fly-in (poster on, visible:false, 15 posts), the live picture appears only at rest (the final measure scans the picture box). L4's letter ("overlaps the dock's picture") is bent for ~280 ms under a narrow trigger (a toast or any bar-only cover up at minimize time); R2's invariant holds every frame (hole open under the flying box + the poster), the picture returns at rest, nothing flashes. Mutant F1b (always scan the dock box, at rest too) survives all 149 tests: the picture-vs-bar distinction is unbound. Fix for the W5 / release commit (I re-engage there anyway): scan the dock box minus the wrapper's padding-bottom (or dock width x 9/16 from the dock's top), plus one test with a band over the bar only (live in flight, live at rest; F1b must go red).
  - Judgement asked: a cover that meets the FLIGHT path but not the destination is now ignored by design - right under L4. The picture in motion passing over a toast for a few frames is the natural look; flickering to the thumbnail mid-flight would be worse; a sheet or dialog covers the destination too (its scrim is full-viewport).
  - Survivors, all belts or equivalents (INFO): M16 (`!coverScanned`: equivalent, now titled to what it binds), F2b (mountInSlot's unmark: the same tick's sync unmarks), F2c (markDocked ignoring ownedSurface: a track's dock reaches surfaceOff through the sync), F2d (markDocked ignoring the cap: the same tick's sync removes it; one extra measure on a v0.16 app), F3b (hold ignoring ownership: an unowned video has no surface to post), F4b (wake not gated: coverDirty set but never read off a live dock). F4 (coverWire unconditional) is red by the c04a3881 test.
  - Carried INFO: lost queue / 'failed' while docked (pre-existing v1.399.0 class, disclosed in the fix section); the sheet open/close traces still agree with the independent measure but for one frame of lag; in-app navigation to Home while docked stays consistent.
  - This approval binds to c04a3881. W5 (version bump, LESSONS, DEVICE-CHECKS, ROADMAP, releases.json) is not in this tree: re-engage at the release sha; the WARNING 8 fix should ride it.

Gate: APPROVED r3 @aa478f1d - security-brief
  - Release-commit re-check (the version bump I named at r1), traced by Read/Grep; no shell. Nothing new reaches native, a URL, a style value or a shell. No CRITICAL / HIGH / MEDIUM / LOW findings.
  - Verified: `dockPictureRest(dockEl)` (native-audio.js:471-474) returns the dock element's own DOMRect through num() with height = min(height, width * 9 / 16); it feeds coverScan (:517) while the wrapper is live and reduces to the same ONE boolean. host-adapter.js is untouched; the wire shape is unchanged.
  - Verified by eye: package.json differs from the file I read at r1 by its `"version"` line only (1.400.1 -> 1.401.0); the dependency and devDependency blocks are identical (dotenv, express, mime-types; the seven dev packages). package-lock.json: `"version"` at lines 3 and 9 read 1.401.0 and the root package block's dependencies, devDependencies and engines match package.json. Gap (no shell): the lockfile's resolved/integrity body below line 28 was not diffed against base; a dependency change would also have to appear in the root block, which it does not.
  - Verified: no em dash in the added prose - the DEVICE-CHECKS section (lines 8-20), the releases.json 1.401.0 entry (3789-3793; the file's one em dash is at 3084, pre-existing), LESSONS.md:109 (the file has none), the ROADMAP v1.401.0 block (923-938; the file's em dashes are at 829-919 and 15266+, pre-existing). The releases.json / ROADMAP / DEVICE-CHECKS prose carries no URL, only repo paths. The plan-path comment line swaps (active/ -> completed/) are comment strings only.
  - This approval binds to aa478f1d.
Gate: APPROVED r3 @aa478f1d - adversary
  - Instruments (this seat, fresh git-archive sandboxes of aa478f1d): targeted families 174 pass / 0 fail in four runs; one earlier run of the same families showed 173 pass / 1 fail whose name my grep did not capture and which never recurred (disclosed as an unnamed 1-in-5 observation, not a finding); lint:ui TOTAL 3142 = docs/ui-exceptions.json; overlay-containment 0; em dash in added lines 0 (c04a3881..HEAD and base..HEAD); the committed probe SUMMARY shots=5 checks=53 failed=0.
  - WARNING 8 FIXED as prescribed (dockPictureRest = the dock's untransformed box at min(height, width x 9/16); style.css 4777/4829 state the mini player always stays 16:9 regardless of --media-aspect, so the assumption is the stylesheet's). Measured (Chromium, cap on, a one-line toast at y 720-764 over the bar only, then the chevron): visible:true and covered false on every fly-in frame, the live picture flies, the poster lands only at rest (c04a3881 had 15 posts visible:false here). The scrolled captions-off fly-in stays visible:true on all 26 frames with the header over the FLIP start.
  - Mutants: F1b (always the picture rest rect, at rest too), F1c (always the full dock box), F1d (the r2 code: full dock box while live), F1e (the r1 code: element box while live) and F1f (rest rect at the dock's full height) are each red by name - the new WARNING-8 test and the C1 test bind the picture-vs-bar and destination-vs-flight distinctions. M16 (`!coverScanned`) still survives: equivalent, disclosed since r1.
  - Bookkeeping verified against the tree: package.json and package-lock.json differ from c04a3881 in version lines only (2 + 4 lines, 1.400.1 -> 1.401.0); the non-comment code delta under public/ scripts/ test/ is exactly dockPictureRest, the one coverScan call and the new test (the plan-path edits active/ -> completed/ are comment-only; no active/ reference to this plan remains anywhere); docs/releases.json parses with the 1.401.0 entry; DEVICE-CHECKS carries "Live mini player (v1.401.0)" (a)-(g) and the "Minimize follow (v1.400.1)" section is gone; ROADMAP has the Shipped entry; LESSONS has the section 4 entry; the plan is at the completed path with status Shipped v1.401.0.
  - Carried, disclosed: lost queue / 'failed' while docked (pre-existing v1.399.0 class); the belts M12 / M22 / M25 / M37 / M40 / F2b / F2c / F2d / F3b / F4b unbound. Device checks (a)-(g) remain the arbiter on the v0.17.0 app build; headless cannot prove the iOS-side layer switch timing (LESSONS 8).
  - This approval binds to aa478f1d. The tree is byte-identical apart from the seats' verdict lines in this file.

Gate: APPROVED r3 @aa478f1d - qa
  - Instruments at aa478f1d (Node 22, the builder's full suite running in parallel, load average 8.7-11.9 on 6 cores): lint 0 errors (the same 6 pre-existing common.js warnings); lint:ui TOTAL 3142 = docs/ui-exceptions.json; overlay-containment 0 violations; check-markers 8 issue(s), all pre-existing frontmatter-vs-verdict contradictions in older completed plans (2026-09-29 .. 2026-10-11), none in this plan; em dash in added lines 0; the targeted families + exec-plans-census + release-ledger + release-date: 250 tests, 249 pass, 1 fail - the fail is native-dock-live "R1: dock() under nativeVideoDock ..." (a timing assert). Re-runs of that file alone: 12 of 13 green at HEAD (one run red on "R2 (the fly-in)"), and the SAME file from a git-archive sandbox of c04a3881: 5 of 6 green, the red one the same "R2 (the fly-in)" assert "followed within a frame, still above" (actual = the rest rect: the jsdom settle's ~50 ms end beat the test's 40 ms wait). A pre-existing load flake of the test file, not the r3 delta (which touches only the scan rect). live-dock-probe SUMMARY shots=5 checks=53 failed=0 ok; the five crops unchanged from r1 / r2 (looked at).
  - W2 fixed as prescribed (native-audio.js dockPictureRest: the dock's untransformed box at min(its height, width * 9 / 16), used as the scan rect while the wrapper is live; the element box at rest). My bar-toast script now reads: a toast over the bar alone -> dock() at rest visible true; the chevron commit -> the first fly-in post visible TRUE, covered false, poster null (the live picture flies); at rest visible true. Bound by the new native-dock-covered test (a bar band never covers in flight or at rest; a band over the picture's rest rect covers; the host's childList is the signal). Correction to my r2 bullet: the post count was 5 before and after (slot, dock, expand, FLIP, rest); what the defect changed was the FLIP post's visibility and the poster, not the count.
  - S4 fixed: the R4 block (native-audio.js ~:434) now says "the centre and four inset corners of the picture's box - its rest rect while the fly-in runs", and the scan line's comment names the picture's rest rect; both exact against dockPictureRest.
  - Bookkeeping verified against the tree: package.json + package-lock.json differ from c04a3881 in the four version lines only (1.400.1 -> 1.401.0). ROADMAP: the two Planned bullets for plan B / the mini-player picture removed; the Shipped entry's claims match the code (the contract, the hole-two-frames / hole-first ordering, 'above' from the fly-in's first frame, the X in the bar, the strip, covered = thumbnail by hit test on a signal; "2 box reads per 2 s" is the app's own count - the probe's 3 includes its instrument read, as the plan says). DEVICE-CHECKS: the confirmed v1.400.1 section deleted, the v1.401.0 section = the plan's (a)-(g) plus the R2 falsifier named first. LESSONS: one entry under "## 4. SPA shell, client lifecycle and async UI state", its mechanism claims match surfaceSync. releases.json: user language, says plainly it needs the next iPhone app update; release-ledger + release-date tests green. native-bridge.md, style.css, host-adapter.js, player.js, the probe, the realm and the three tests: plan-path lines only (active/ -> completed/), nothing else changed. The plan: moved by plan-complete.js, frontmatter status "Shipped v1.401.0", gate line names r2 @c04a3881 and the r3 delta on this commit (accurate: a commit cannot name its own sha; check-markers clean for it), the Evidence gate bullet matches the three rounds. Still blank by design: the full-suite number on the release commit and the Release line (tag, PR, Publish run) - to be filled from the builder's parallel run and after the merge.
  - SUGGESTION S5 (test timing, not blocking): native-dock-live's "R2 (the fly-in)" and "R1: dock()" asserts race the jsdom settle under load (settle(40) vs the ~50 ms clearMinimizeDrag); seen 2 of 25 runs here under the full-suite load and once at c04a3881. Add it to the known-flake list in memory / the plan, or sample the fly-in post synchronously after the transform write (one rAF) instead of a 40 ms sleep.
  - Security: no new surface in the delta - a rect helper on the dock element, version strings, prose. This approval binds to aa478f1d.

## Out of scope

Native-drawn captions (L3 put them in a web strip instead); swipe-to-dismiss; a live picture anywhere but the dock and the watch slot
(Feed, previews, 360 stay on the web element); the iOS implementation itself (the iOS Root's).
