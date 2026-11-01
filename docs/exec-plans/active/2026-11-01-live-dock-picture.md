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

- W1: 
- W2: 
- W3: 
- W4 (idle census numbers): 
- Full suite (Node 22), before the gate and on the release commit: 
- Gate verdicts (bound to sha): 
- Release: tag, PR, Publish run: 

## Out of scope

Native-drawn captions (L3 put them in a web strip instead); swipe-to-dismiss; a live picture anywhere but the dock and the watch slot
(Feed, previews, 360 stay on the web element); the iOS implementation itself (the iOS Root's).
