---
plan: minimize-native-follow
harness: v2 · full
branch: fix/v1.400.1-minimize-native-follow
anchor: spec
status: Planned
next: builder Step 0, then W1
design: Rulings approved by Dean 2026-11-01 (AskUserQuestion): plan A only (no live picture in the dock; that is plan B, ROADMAP Planned)
gate: pending
builder: standard
---

# v1.400.1 - on the iPhone app, the picture follows your finger when you pull the player down

Kickoff 2026-11-01 (FileTube Root, Opus). **Builder: Standard (Sonnet).** Why the tier: the root cause is measured
and certain (below), the fix lives in two web files (`public/js/native-audio.js`, a few lines of `public/js/player.js`
/ `style.css`), the bridge contract is unchanged, and the iOS app needs no new build. The risk is on the device, so
the device pass is the arbiter and a failed device check escalates (stop rules). One release, **1.400.1**.

## Step 0 (before any code)

- Read AGENTS.md, docs/LESSONS.md (sections 1, 2, 3, 4, 6, 7, 8 at least), docs/CONTRIBUTING.md, docs/RELEASING.md,
  docs/references/native-bridge.md section 3 ("Native video (v1.399.0)"), then this plan once. The v1.399.0 plan
  `docs/exec-plans/completed/2026-10-28-native-video-surface.md` (Census B item (4) and the gate r1 WARNING about the
  self-feeding sampler) is the background.
- Environment: `export PATH="$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH"` before every
  npm/node/git command. Local suites on Node 22 only; Node 24 runs in PR CI.
- Git: work on `fix/v1.400.1-minimize-native-follow` (this plan is committed there). Stage by name, never `git add .`/`-A`,
  never force-push, never `--no-verify`, never pipe a commit or push; verify with `git log` / `git ls-remote`. Commit
  with `-F <file>`. Push with `GIT_SSH_COMMAND="ssh -o ServerAliveInterval=20 -o ServerAliveCountMax=60"`.
- Tests: targeted tests per wave; the full Node 22 suite once before the gate and once on the release commit.
- **Stop rules (ask Dean with AskUserQuestion):** the fix needs an iOS change or a contract change (that is plan B
  territory: stop, do not widen); a requirement below turns out unbuildable as written; gate round 3 (gate-pacing norm).
  **A device check of R1-R4 failing after release is a re-root-cause at the Extreme tier (Fable), never a re-patch.**

## Why

Dean, 2026-11-01, with a screen recording from the iPhone app (native video surface on): "a really, really, really smooth
mobile pull down of the mini player... it's like laggy and I can kind of force that interface to glitch, and it takes a
couple of milliseconds to seconds for it to catch up on the size. It should be a perfectly scaling, smooth pull down where
the size of the image box is always relative to the position of it being scrolled. That's how YouTube and other apps
handle this."

## Root cause (measured, not hypothesized)

Frame-by-frame analysis of the recording (507 frames, 60 fps; ffmpeg, 2026-11-01; the frames and contact sheets live in
the Root session's scratchpad, not the repo):

1. **The picture moves only once a second.** It holds one rectangle, then snaps to a new one in a single frame at
   n = 74, 127, 187, 248, 308, 369, 429 - gaps of 53, 60, 60, 61, 60, 61, 60 frames = **1.00 s**. The web's controls
   (seek bar, transport row) follow the finger smoothly the whole time; at each snap the picture lands exactly where the
   controls already are. Lag from the controls reaching a spot to the picture catching up: 167-567 ms; the worst gap is
   710 px (a fast swipe back up: the controls at the top, the picture still a 53% thumbnail at the bottom).
2. **The code says why.** Under `nativeVideo`, `native-audio.js` posts `video.surface` (and redraws the `#ft-video-hole`
   clip) only when its observers fire: the element's ResizeObserver, the document's ResizeObserver, class mutations on
   body / html / the wrapper, the containers' childList, resize / rotate, plus a **1 s backstop interval**. The pull moves
   `#player-wrapper` with `style.transform` (`followMinimizeDrag`), and the snap-back / fly-in are CSS transitions of that
   transform (`is-minimize-snap`, `is-minimize-settle`). A transform changes no layout size, no class after the claim, no
   child list: **no observer fires, so only the 1 s backstop moves the picture.** The v1.399.0 plan wrote this down
   itself (Census B (4): "the minimize drag ... a TRANSFORM per frame that no observer reports"; gate r1 note: "anything
   that only translates the box ... = the 1 s backstop") and nobody connected it to the pull. Note `getBoundingClientRect`
   already includes transforms, so `surfaceMeasure()` measures the right box - it is simply never asked.
3. **Secondary glitches seen in the same recording**, each to be closed:
   - G2 (n = 127, 187, 248, 308): on each snap, one frame shows the picture at its new top but clipped short (visible
     heights 502 / 394 / 272 / 32 px vs 612 / 552 / 474 / 352). Most likely the web's hole and native's layer landing on
     different frames.
   - G3 (n = 368, 428): one frame with no picture at all (black where the box is) right before a snap.
   - G4/G5 (n = 248-445): the watch page's title, action row and Subscribe pill paint **over** the picture once the box
     overlaps them. Native's picture is below the web view; the page's text is above it, and the hole only removes
     backgrounds. In the web-only player this cannot happen (the opaque video paints in the stage, which rises to
     z-index 1 during the pull).
   - Release (n = 446-447): two black frames as the box docks (native goes `visible: false` at `dock()`, the thumbnail
     poster is not painted yet), then n = 448 the watch page content jumps up ~240 px, then n = 452 the cut to Home.

Web-only browsers (Safari, the PWA, desktop) never had the 1 s problem: the opaque `<video>` moves with the transform.

## Rulings (Dean, 2026-11-01)

- **M1 - plan A only.** The picture follows the finger every frame during the pull, the snap-back and the fly-in; no
  page text over it; no black frames. The docked mini player keeps the THUMBNAIL (the 2026-10-28 ruling stands).
- **M2 - plan B later, not here:** a live picture in the dock needs native to draw the picture ABOVE the web view while
  docked (a contract addition + an iOS build). ROADMAP Planned holds it. Nothing in this plan may depend on it.

## Requirements (spec anchor)

- **R1 - per-frame follow.** While the wrapper carries `is-minimize-drag`, `is-minimize-snap` or `is-minimize-settle`
  (and only then), the surface is measured and posted **every animation frame**, through the existing `surfaceSync()`
  (it already skips a repeat). The loop starts from the wrapper class mutation the observer already hears, so no new
  player-to-native-audio call is required (a pure `surfaceLiveDecision(classes)` holds the rule; reuse it from tests).
  It ends with one final measure when the last of those classes leaves. While none is present the idle cost is exactly
  today's (the v1.399.0 gate r1 WARNING: a sampler that feeds itself at 60 Hz while nothing moves is a regression - prove
  zero extra posts and zero extra reads per idle second, as that gate measured).
- **R2 - no black edge, no torn frame.** The web's hole and native's layer can land on different frames (the bridge hop).
  During live motion the hole must never be open where native's picture is not. Design suggestion, to be measured in
  jsdom and stated as a hypothesis for the device: while R1's loop runs, open the hole on the INTERSECTION of this frame's
  rect and the previously posted rect (where the picture is under either a zero- or one-frame lag), and open the exact
  rect on the final measure. Falsifier for the device pass: black slivers on the leading edge during a fast pull mean
  native lags more than a frame - a re-root-cause (stop rules), never a bigger margin patched in.
- **R3 - nothing paints over the picture.** While the pull, snap or fly-in runs under a native surface, the watch page's
  content around the stage (the same set the v1.362.4 fade dims: `.watch-main > :not(:has(#player-slot))`,
  `.watch-sidebar`) must not paint inside the picture's box. Suggested shape: each frame of R1's loop, clip each faded
  element that intersects the box with an even-odd path excluding the box (in that element's own coordinates), and remove
  every clip with the drag (`clearMinimizeDrag` is the one remover, R5 of v1.362 - keep it the one remover). Never a
  filter, opacity or clip on an ancestor of the video (LESSONS 7). Web-only player: byte-identical.
- **R4 - a clean release.** From the release frame to rest, the box shows either the live picture or the thumbnail on
  every frame - never black, never empty: (a) snap-back: the picture follows the spring (R1 covers it); (b) dock: the
  thumbnail is on screen from the first frame of the fly-in (suggested: preload the artwork with `new Image()` at the
  claim, set the poster at the commit decision just before `visible: false`; a poster set during the pull would cover
  the live picture, so not earlier); (c) the watch page does not reflow between the release and the swap to the browse
  page (the ~240 px jump at n = 448): measure whether this also happens in the web-only player; if it does, fix it for
  both by keeping the slot's height until the swap, if only under native, fix the native path.
- **R5 - contract unchanged.** `video.surface` keeps its fields and meaning; only its cadence during these three
  states changes (still at most one per frame, still none while nothing moves). Update native-bridge.md section 3's
  sentence on the cadence to say so, and the v1.399.0 claim that a transform is covered only by the backstop.

## Waves

- **W1 - R1 + R2** in `native-audio.js`: the live loop, its pure decision, the lag-matched hole; jsdom tests that a
  transform-only move posts the moved rect within one frame (mutate: remove the loop start, watch it red), that posts
  stop when the classes clear, the idle census unchanged, and the intersection rule.
- **W2 - R3**: the occlusion clips, applied and removed; a test that every clip is gone after snap end, dock end, close,
  a new load and backgrounding (the end paths `clearMinimizeDrag` already serves).
- **W3 - R4**: the poster timing and the reflow (headless probe first, base vs branch, LESSONS 3: measure UI changes).
- **W4 - docs + release**: native-bridge.md (R5), LESSONS (the bug class: "a placement observer census that names a
  gap is a bug report, not a footnote"), DEVICE-CHECKS "Minimize follow (v1.400.1)", ROADMAP Shipped, releases.json in
  user language, the version bump.

## Reachability (LESSONS 2, 11)

The jsdom fixture must use the REAL upstream shape: `claimMinimizeDrag` adding `is-minimize-drag` to the real wrapper,
`followMinimizeDrag` writing `style.transform`, and `getBoundingClientRect` reflecting that transform (stub it from the
transform, never return a pre-moved rect directly). A test where the rect moves without the class flip proves nothing.

## Device checks (Dean, after the server pull; the app needs no new build)

On the iPhone app with the native picture on, a video playing on the watch page:
- (a) Pull down slowly: the picture shrinks and follows the finger continuously, top edge under the finger, no steps.
- (b) Pull halfway, then swipe back up fast, then down again: the picture never trails the controls, no black frame,
  no clipped strip.
- (c) During the pull, the title / Like row / Subscribe never show on top of the picture.
- (d) Let go early (snap back): the picture springs back with the controls.
- (e) Let go past the commit point: the picture flies into the dock with no black flash, the thumbnail shows in the dock,
  the watch page does not jump before Home appears, the sound plays on.
- (f) Tap the mini player: the picture returns in the slot (unchanged from v1.399.0).
- (g) Safari (no app): the pull looks exactly as before.

## Gate

Per `.harness/scrutiny.toml`: the version bump touches `package*.json`, so the full gate - adversary (floor), qa,
security-brief. Brief them with LESSONS 2, 3, 4, 6, 7, 8 and these attack surfaces: (1) the live loop never outlives the
drag (every end path, a rotate mid-pull, a second finger, backgrounding, a new load during the spring); (2) the idle census
(zero extra posts and reads per idle second, measured as the v1.399.0 gate did); (3) a stale clip or hole left on the watch
page after any end path; (4) reachability (the fixture moves the rect only through the real transform); (5) Safari / the PWA /
an app build without `nativeVideo` byte-identical. Ship on CRITICAL/WARNING closure; ask Dean at round 3.

## Release

`docs/RELEASING.md` + AGENTS.md: `npm version 1.400.1 --no-git-tag-version`, ROADMAP Shipped entry, `docs/releases.json`
in pure user language, DEVICE-CHECKS section "Minimize follow (v1.400.1)" with (a)-(g) above, the plan closed with
`node scripts/plan-complete.js docs/exec-plans/active/2026-11-01-minimize-native-follow.md "Shipped v1.400.1" --apply` in the
release PR, the protected-main PR flow (tag the local no-ff merge, push branch + tag in one push, `gh pr create`, CI green).
**Do not run `gh pr merge` until Dean says so** (Dean, 2026-11-01: the Root asks him the outstanding device-check questions
before this merges). Ask with AskUserQuestion when CI is green; then merge, `git pull --ff-only`, delete the branch
(remote via `gh api -X DELETE`, local `-d`), and confirm the tag's Publish Docker Image run is green.

## Evidence (the builder fills this)

- W1: 
- W2: 
- W3: 
- Full suite (Node 22), before the gate and on the release commit: 
- Gate verdicts (bound to sha): 
- Release: tag, PR, Publish run: 

## Out of scope

Live picture in the dock (plan B); the chevron (it commits through the same `minimizeToDock`, so R4 covers its fly-in for
free); scroll following (`space: 'document'`, native-owned); any iOS change.
