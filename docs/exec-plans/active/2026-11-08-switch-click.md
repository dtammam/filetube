---
plan: switch-click
harness: v2 · full
branch: fix/v1.406.1-switch-click
anchor: outcome
status: Approved @34cf1fd8
next: Step 0, then W1 (reproduce by counting the native posts per switch, base v1.405.0 vs v1.406.0)
design: Dean 2026-11-08 device report after v1.406.0 (below); diagnosis open, measure first
gate: pending
builder: smart
---

# v1.406.1 - no click when switching from a docked video to another

Kickoff 2026-11-08 (FileTube Root, Opus). **Builder: Smart (Opus).** Why the tier: a regression on the player core
under native audio with the cause not yet proven; the build must measure and decide between causes.

## Why

Dean, 2026-11-08, on the iPhone app right after v1.406.0 ("generally ... a significant improvement"): "if I'm
listening to a video, I go back to home and I pick another one, there's like a weird audio burp that happens
consistently ... this weird, like abrupt, like audio, like noise that happens when I go from a video to another video
that I did not notice before." Also possibly on "the first audio switch". His answers (AskUserQuestion): it sounds
like **a click or glitch** (not recognizable audio of either item); the first video is **docked as the mini player and
still playing** on Home when he taps the second. Not seen before v1.406.0. Home look: Modern.

## Leading hypothesis (from the diff, NOT proven - prove or refute it by measurement)

Before v1.406.0 a Modern card's seed failed `isFullWatchSeedItem` (common.js ~3879), so a tap with a docked video
took the `reparent` branch in watch.js (~1638): `player.expand()` kept the old item alive and ONE `player.load()` at
hydration swapped to the new one. v1.406.0 A1 (`watchSeedFields`, server.js ~5375) makes Modern seeds full, so now
the `reparent && canSeedPreload` branch (watch.js ~1674) loads the new item from the seed at the tap, and hydration
calls `player.load()` again (~1815) plus `applyLateDetail` (~1824, now also merging missing fields into `currentData`,
player.js). Suspects, in order:
1. The hydration load is not the same-item no-op under native: `native-audio.js` re-sends `audio.load` (rev + 1) or an
   `audio.stop` + load, because the detail record differs from the seed item (e.g. `audioStatus`, `needsTranscode`,
   `transcodeStatus`, stream URL / sidecar choice in `videoItemFromDescriptor`). Two loads in ~100-500 ms = an
   audible cut.
2. The seed path tears the docked item down abruptly (stop then load) where the old path handed over in one load.
3. The A2 cover / `pictureReady` latch or `surfaceSync` posting a `video.surface` flip (visible false -> true) during
   the switch that makes native rebuild its player or layer.
4. Something else the counts show.

## Step 0

Read AGENTS.md; docs/LESSONS.md (0 reveal/clear, 2 reachability, 4 TOCTOU, and "a shipped fix that fails on the device
= re-root-cause"); docs/references/native-bridge.md (audio.load, rev, audio.stop, video.surface); the completed plan
2026-11-08-smoothness.md (A1, A2). Environment per AGENTS.md (fnm PATH). Worktree `.claude/worktrees/fix-v1.406.1-...`;
stage by name, no force-push, no --no-verify. Stop rules (ask Dean): the counts show no extra post and no abrupt stop
(then the cause is native-side: write the iOS Root relay and ask); the fix would give up the instant seed start
(O1 of v1.406.0) on Modern.

## Waves

- **W1 - reproduce.** A jsdom test with the fake native host (the pattern of the native-audio / live-dock tests)
  that plays video A, docks it, navigates Home, taps Modern card B (the REAL seed shape `/api/home?view=grid` now
  returns, from server.js), then lets hydration land. Record every post to native in order (`audio.load` with rev,
  index, positionSec, autoplay; `audio.stop`; `audio.pause`; `video.surface`). Run it on v1.405.0 and on main; report
  both sequences verbatim in Evidence. Also the same for Classic home and for a music -> video switch.
- **W2 - fix the proven cause** so a switch sends exactly what v1.405.0 sent in shape (one handover load, no
  stop-then-load, no second load for the same item), while keeping v1.406.0's instant start and cover. Mutate the
  guard, watch the test go red.
- **W3 - docs + release.** LESSONS (the class, in one line), DEVICE-CHECKS "Switch click (v1.406.1)", releases.json,
  ROADMAP, version bump. If W1 showed native is at fault, the relay to "SANDYJAR iOS Dev Root" instead.

## Gate

Adversary + qa (security-brief as a section). Attack: (1) every switch path (docked -> card, Classic, rows, search,
music -> video, Next / autoplay, deep link) sends one load; (2) the hydration still delivers chapters and late detail
without a reload; (3) a failed hydration still stands the seeded play down; (4) v1.406.0 O1 measures unchanged.
Ship on CRITICAL/WARNING closure; ask Dean at round 3.

## Release

v1.406.1 per docs/RELEASING.md. DEVICE-CHECKS "Switch click (v1.406.1)": (a) a video docked and playing, Home, tap
another: no click; (b) the same from Classic; (c) music playing -> a video: no click; (d) the new video still shows its
thumbnail from the first frame. Close with `node scripts/plan-complete.js` in the same PR. **Do not run `gh pr merge`
until Dean says so.**

## Out of scope

Anything else from the smoothness plan; native changes beyond a relay.

## Evidence
