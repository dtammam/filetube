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

### W1 - reproduce (2026-11-08, builder Opus)

Instrument: `test/integration/switch-click.test.js` - the REAL watch view (watch.js, common.js, main.js), player.js,
native-audio.js and host-adapter.js in one jsdom realm (watch.html), a fake host that models today's app (v0.17: an
`audio.load` answers `loading` after 40 ms, `audio.play` answers `playing` after 120 ms then an `audioTick` each second, NO
`pictureReady` field), the two hydration fetches answering after 250 ms, the seeds and detail records SERVER-EMITTED
(`/api/home?view=grid`, `/api/videos`, `/api/videos/:id`). Flow: cold-open A, `player.dock()` + destroy (the router's
leave-watch), stash the card's seed, init watch for B. The same file was run unchanged in a `git archive v1.405.0` sandbox.
Every post to native recorded with its ms since the tap (`item=...` = the Item, identical on both trees: kind video, src
`/api/offline/file/video/vb`, artworkSrc `/thumbnail/vb`, durationSec 600, progress `/api/progress`).

| Switch | v1.405.0 | main (v1.406.0) |
|---|---|---|
| docked A -> Modern card B | `+274ms audio.load rev=2 pos=0 autoplay=false`, `+281ms audio.play`, `+292ms video.surface below visible` | `+18ms audio.load rev=2 pos=0 autoplay=false`, `+20ms audio.play`, `+37ms video.surface below visible` |
| docked A -> Classic card B | `+17ms audio.load rev=2`, `+18ms audio.play`, `+37ms video.surface below` | `+17ms audio.load rev=2`, `+19ms audio.play`, `+36ms video.surface below` |
| docked Music track -> Modern B | `+304ms audio.load rev=2`, `+321ms audio.play`, `+338ms video.surface below` | `+35ms audio.load rev=2`, `+37ms audio.play`, `+65ms video.surface below` |

- Every switch, both trees: ONE `audio.load`, ONE `audio.play`, ONE `video.surface`, ZERO `audio.stop`, ZERO second load at
  hydration (the hydration `player.load` is an adopt; `claimVideo`'s same-item follow backs it). Suspects 1 and 2 REFUTED.
- Web media elements during the switch (every `play()` and `src` set on any `<video>`/`<audio>`): `[]` on both trees.
  Negative control (same realm, no native host): `+13ms src= video#media-player /video/vb`, `+14ms play() video#media-player`
  - the instrument sees a web play when there is one.
- Suspect 3: with a host that sends `pictureReady: true` main posted `video.surface` between load and play (v1.405.0 after
  play); with today's app model (no field) the order is identical on both trees - an artifact of the fake, not a web change.
- The ONLY web-side change at a switch: Modern's one load now goes out at the tap (+18 ms) instead of after hydration
  (+274 ms) - the intended O1, and exactly what Classic already did on v1.405.0.
- Stop rule hit (no extra post, no abrupt stop). New lead outside the native-post axis (not in the plan's suspects): v1.406.0
  P made Modern card previews (a muted web `<video>`, `play()` 1.5 s after a card is >= 60% in view) play again after Back -
  before it, no preview ever played on a cached Home. `PreviewCards` has no stand-down while the player plays, and a tap
  detaches the cached Home, which pauses (HTML spec) any rolling preview at the same moment native swaps to B. Dean's flow
  (watch -> back to Home -> tap another) is exactly the newly enabled case; a fresh, uncached Home ran previews on v1.405.0
  too ("possibly the first audio switch"). Unproven on the device: LESSONS 5 records that any play on a second element, even
  muted, disturbs iOS's audio session.
- Binding (mutants in a `git archive HEAD` sandbox, the tree untouched): M1 `audio.stop` before `claimVideo`'s sendLoad ->
  `# pass 0 # fail 3`; M2 hydration re-sends (player.load adopt off AND claimVideo's same-item follow off) -> `# pass 0
  # fail 3`; M3 adopt off alone -> `# pass 3 # fail 0` (MASKED: the claimVideo follow sends nothing for the same item, two
  redundant guards, LESSONS 2); restored -> `# pass 3 # fail 0`.
- Dean's device discriminator (AskUserQuestion, 2026-11-08), a video docked and playing: (1) open another from Search (no
  previews) - CLICK; (2) on Home, tap a card within 1 s, before any preview starts - CLICK; (3) on Home, tap while a card's
  silent preview is rolling - NO click. Previews REFUTED as the cause (the click comes without them, and not with one).
- H3 (the axis the answer points at: (1) and (2) start the new video inside the tap with no web media active, (3) has a muted
  preview already active): a web media-element operation in the tap's user gesture. Falsifier: no element operation in the
  tap's task. Probe (the same realm, REAL `load()`, `pause()`, `removeAttribute('src'|'poster')`, poster/muted sets, marked when
  they run synchronously inside the tap's `init`), docked A -> Modern B, verbatim:
  - main: `[TAP-TASK] pause() audio#bg-audio-sidecar`, `[TAP-TASK] removeAttribute(src) audio#bg-audio-sidecar`, `[TAP-TASK]
    load() audio#bg-audio-sidecar`, `[TAP-TASK] removeAttribute(poster) video#media-player`, `[TAP-TASK] removeAttribute(src)
    video#media-player`, `[TAP-TASK] load() video#media-player`, `[TAP-TASK] removeAttribute(poster) video#media-player` x2,
    `[TAP-TASK] pause() audio#bg-audio-sidecar`, `[TAP-TASK] removeAttribute(src) audio#bg-audio-sidecar`, `[TAP-TASK] load()
    audio#bg-audio-sidecar` - all 11 inside the tap.
  - v1.405.0: the same 11 operations, NONE in the tap's task (they ran at hydration, ~2.4 s later on the phone).
  H3 holds on the web side: the only change at a switch is that these resets of src-less elements moved into the gesture.

### W2 - fix (2026-11-08)

- `mediaElementHoldsMedia(el)` (player.js, exported): a `src` attribute, a `currentSrc`, a `srcObject`, or a `networkState`
  other than NETWORK_EMPTY. Every reset of the shared element and the sidecar on the switch and close paths skips an element
  that holds nothing: teardownMediaState (the element, the sidecar), releaseBackgroundAudioElement, close() (the element incl.
  its pause - a `pause()` on a NETWORK_EMPTY element runs the resource selection algorithm - and the sidecar). A browser's
  element holds the previous video, so it resets exactly as before. The seed start at the tap (O1) is untouched.
- Not changed: `pauseSuppressingHandoff` (other callers reach native's proxied pause through it on an empty element) and the
  keep-alive stop (the keep-alive never starts under native; a guard there survived its mutant K8, so it was reverted rather
  than shipped unbound).
- Tests (`test/integration/switch-click.test.js`): the three switches now also assert NO real `load()`, `pause()`, `src` set or
  src removal on any media element; a browser (host without native audio) still drops A, `load()`s, then sets B's src; the
  dock's [x] under native touches no element and posts one `audio.stop`; the helper's four axes.
- Mutants (sandbox): K1 teardown element guard off, K2' teardown sidecar guard off, K3 releaseBackgroundAudioElement guard off,
  K4 helper always true -> each `# fail 3` (the three native switches); K5 helper always false -> `# fail 1` (the browser
  reset); K6 close element guard off, K7' close sidecar guard off -> `# fail 1` (the [x] test); restored `# pass 6 # fail 0`.
- Full suite, Node v22.23.1, `npm test` before the lock fix: `# tests 13438 # pass 13424 # fail 1 # skipped 13` - the one
  failure `v1.161.3 (gate WARNING): stopBgKeepAlive is mirrored at ALL FOUR bgAudioEl-teardown sites` (a source lock pinning
  `if (bgAudioEl) {` after the keep-alive stop): the guard moved INSIDE that block, the lock unchanged; then
  `node --test test/unit/player-background-audio.test.js test/integration/switch-click.test.js`: `# tests 125 # pass 125 # fail 0`.
Gate: CHANGES r1 @0968d274 - qa - code correct in browsers and native and lints/targeted tests green, but WARNING: "eleven resets" in player.js:118, ROADMAP:997 and the test comment at switch-click.test.js:189 claim every measured tap-task op is gone while 3 removeAttribute(poster) still run at the tap (measured); WARNING: the unverified cause is written as fact (LESSONS-rules section 8 "Platform facts" line, switch-click.test.js:84/:190, player.js:11205); SUGGESTION: the isAdoptLoad doc comment is now orphaned above mediaElementHoldsMedia (player.js:111-116); SUGGESTION: the browser direction of the teardown/close sidecar guards and the close element guard is unbound (mutants Q1/Q2/Q4 survive).
Gate: CHANGES r1 @0968d274 - adversary - code binds (6/6 green, mutants red, browser reset bound twice, O1 kept) but the record is wrong: WARNING W1 the Search case Dean heard is NOT in the tap (measured: docked -> /api/search seed loads and resets at hydration, op-for-op identical on v1.405.0 and v1.406.0), so Evidence/ROADMAP/LESSONS 8 "platform fact"/player.js comment overstate H3; WARNING W2 the MediaSession clear (metadata, playbackState, 8 handlers) also moved into the tap and now runs twice per switch, uninstrumented and unrecorded as a suspect; SUGGESTIONS: teardown pause() still real when the proxy is detached (close-then-open in the tap, cold deep link), isAdoptLoad doc comment now heads the new helper, keep-alive guard left unbound.

### Gate r1 fix round (2026-11-08)

- Both seats CHANGES r1 @0968d274, the code bound, the RECORD wrong. Adversary W1 (measured): a Search result's seed (`/api/search`, partial)
  loads and resets at hydration, op for op identical on v1.405.0 and v1.406.0 - no `[TAP]` op - yet Dean heard the click there, so H3 cannot
  explain case (1); the falsifier named above came true for it. The only unmeasured difference on that path is hydration timing (v1.406.0 H
  deferred two list fetches). Adversary W2 (measured): `clearMediaSessionForNative` (metadata null, playbackState none, 8 action handlers null)
  also moved into the tap on v1.406.0 and runs twice per switch (`[TAP] +24` and `+278`); v1.405.0 ran it once at hydration. QA W1: three
  `removeAttribute(poster)` remain at the tap ("eleven" overclaimed; the fix removes eight). QA W2: the cause was written as fact.
- Dean's ruling (AskUserQuestion 2026-11-08, after the lock-screen discriminator was offered): "Skip test, ship + relay" - ship the web change
  as a hypothesis with an honest record AND relay the app's item swap to the iOS Root; the device checks decide.
- Changes: the record (player.js comments, the test's comments, ROADMAP, the ledger entry, DEVICE-CHECKS (d) naming (b)-Search as the
  discriminating check and the MediaSession double clear as the next web suspect); the LESSONS line moved out of section 8 "Platform facts" into
  section 1 as a diagnosis rule; the helper moved above `isAdoptLoad`'s doc comment (both seats' S); adversary S1: teardown's pause skips an
  element that holds nothing (after the dock's [x] it reached the real empty element; a native-owned element's proxy pause is a no-op there
  because nativeAudioBeginLoad set the transition - the proxy arm was tried and its mutant S1b survived, so it was dropped); QA S2: a browser
  test where the sidecar holds audio binds the sidecar and close() resets.
- Mutants (sandbox): Q1 teardown sidecar guard false, Q2 close sidecar false, Q4 close element false -> each `# pass 7 # fail 1` (the
  browser sidecar test); S1 teardown pause guard off -> `# pass 7 # fail 1` (close then open); S1b proxy arm dropped -> `# pass 8 # fail 0`
  (dropped from the code); restored `# pass 8 # fail 0`. Neighbours: `node --test test/integration/switch-click.test.js
  test/unit/player-background-audio.test.js test/unit/r1-player-races.test.js test/unit/native-audio-web.test.js test/unit/player-controls.test.js`
  -> `# tests 210 # pass 210 # fail 0`.
- Not taken (ROADMAP Planned): an idempotent MediaSession clear (W2's optional fix: no binding test yet, and Dean ruled ship + relay);
  the keep-alive fixture (adversary S3); a music.js-built track in the realm (adversary S4).

### iOS Root relay (sent 2026-11-08 to "FileTube iOS Builder v0.13.0")

> FileTube v1.406.1 (web). Dean hears a short click in the app when switching from a docked, playing video to another (since v1.406.0). The
> web sends the same bridge messages as v1.405.0 on every switch (one `audio.load` replacing the queue while the previous item plays, autoplay
> false, then `audio.play`; no `audio.stop`). Dean's A/B: a click opening from Search and from a quick Home tap; NO click while a muted card
> preview <video> was playing in the web view. Please check the native side: (1) does `audio.load` while playing replace the AVPlayer item
> abruptly (no volume ramp)? A ~30-50 ms fade out before the replace and in after would remove a waveform cut; (2) does a WKWebView
> `navigator.mediaSession` write (metadata null, playbackState none, action handlers null - the web does these at every switch, now inside the
> tap) or a media-element `load()` in the web view change the app's AVAudioSession category/activation while native plays? The "no click with a
> preview playing" result suggests WebKit's own media session state matters. A 30-second check: lock-screen Next in a Music queue (pure native,
> no web work) - a click there is the item swap.
Gate: APPROVED r2 @cc6dd9d8 - qa - r1 W1/W2/S1/S2 all fixed as prescribed (eight resets + poster stays, hypothesis wording, LESSONS moved to section 1, helper above isAdoptLoad doc, Q1/Q2/Q4 now red on test 7), new teardown pause guard correct in browsers and bound native-side (always-pause mutant red on test 8), 137/137 targeted + lint 0 errors; SUGGESTIONS (non-blocking): the browser direction of the teardown pause guard is unbound (never-pause mutant survives, load() pauses anyway), ROADMAP "since v1.406.0 a seeded switch (Modern, Classic, rows)" while W1 shows Classic already loaded at the tap on v1.405.0, and the ledger line "the app's next update addresses the other" promises an unbuilt app fix on a relay with no reply yet.
Gate: APPROVED r2 @cc6dd9d8 - adversary - W1 and W2 closed (the record now ships H3 as a hypothesis, Search measured at hydration, the MediaSession double clear named as the next suspect, LESSONS moved to section 1); S1 fixed and bound (teardown pause guard: mutant off -> test 8 red, cold deep link now web=[]), S2 fixed; mutants re-run 8/8 green, 294/294 neighbours, eslint 0; SUGGESTIONS (non-blocking): DEVICE-CHECKS (d) says Search web work equals v1.405.0 but on v1.406.1 its resets are gone too (measured web=[]), the teardown pause now skips an empty element left paused=false by a play() during "Preparing this video" (spec-reasoned, unmeasured in jsdom; arm: || !mediaPlayer.paused), releases.json promises the app update addresses the other cause before the iOS Root has answered.

### Gate r2 fix round (2026-11-08)

- Both seats APPROVED r2 @cc6dd9d8 with SUGGESTIONS. Taken (a code change, so a delta re-check at the new sha): adversary S2 - the r1 teardown
  pause guard skipped an element that is empty but NOT paused (play pressed while "Preparing this video": a play() on a NETWORK_EMPTY element
  leaves paused false, and the load algorithm resets paused only when networkState is not EMPTY), so the next src could start on its own; the
  guard is now `mediaElementHoldsMedia(mediaPlayer) || !mediaPlayer.paused` (under native the proxy pause is a no-op in the transition; a
  released element after the [x] is paused). Test 9 binds it; mutants R2a (drop the arm) -> `not ok 9 # pass 8 # fail 1`, R2b (always pause)
  -> `not ok 8 # pass 8 # fail 1`, restored `# pass 9 # fail 0`. Wording: DEVICE-CHECKS (d) (v1.406.1 removes the Search resets too; adversary
  S1), ROADMAP (only Modern and rows moved into the tap, Classic already loaded there on v1.405.0; qa S2), the ledger no longer promises an app
  update (qa S3, adversary S3). Not taken: qa S1 (the browser direction of the pause guard is bound outside this file - the F-D/F1/F5 lock and
  player-black-picture-log, measured by the adversary in r2).
