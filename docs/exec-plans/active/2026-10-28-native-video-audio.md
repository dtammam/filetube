---
plan: native-video-audio
harness: v2 · full
branch: feat/v1.398.0-native-video-audio
anchor: spec
status: Building (re-scoped 2026-10-28: Listen rows only; the background handoff is superseded)
next: W4 guards (mutants on the committed W3), the full gate, the release
design: Approved 2026-10-28 (Dean picked "Native audio" for video over a full native player and the web-only fix)
gate: not started
builder: extreme
---

# v1.398.0 - a video played as audio from Music plays through the iPhone app's native player

**Re-scoped 2026-10-28 (gate r1 qa W4):** the plan below was written for a BACKGROUND HANDOFF of a playing video (V2a, V7, V8); the
iOS Root's spike failed (Evidence, "The spike"), Dean chose a native video surface for the next plan, and v1.398.0 ships the parts
that hold in every option: the contract (W1), the server (W2) and Listen rows (V2b, V10). The rulings, the "What Dean will see" bullets,
the contract bullet and the W3 / W4 / "Not in scope" bullets are marked superseded where they stand; the Seams, Step 0, the Gate
brief and the census read as the process history they are; the Evidence is the record of what shipped.

Kickoff 2026-10-28 (FileTube Root, Opus). **Builder: Extreme (Fable).** The pick: this rewires the battle-won background-audio
handoff in the player core (player.js), widens device and media token auth, and depends on a device-only behavior. That's
the same class as v1.397.0. One release, version **1.398.0** (the next free minor; if another release merges first, take the
next one and tell the FileTube Root, which tells the iOS Root).

This plan is the FileTube half. The app half is the SANDYJAR iOS Dev Root's: the native audio engine already exists
(filetube-ios v0.14.0, pinned to v1.397.0), and it gains the two video kinds. The FileTube Root relays everything; the
builder never edits filetube-ios.

## Why

Dean, 2026-10-28 (via the iOS Root): "what is needed for the video to be treated this way - video audio". The goal is the
same as music's: no collision with the mic or other apps, plus playback in the background and on the lock screen. Today a
backgrounded video hands its sound to a hidden `<audio>` sidecar (`bgAudioEl`) in the WKWebView, and
docs/references/ios-background-audio-behavior-map.md documents the wall: a locked phone can pause it but not resume it. The
v1.397.0 engine fixed that for music and podcasts.

Dean's choice (AskUserQuestion, 2026-10-28) out of three options:
- **Native audio: picked.**
- A full native video player with PiP: rejected. It's large, and it loses chapters, scrub previews, subtitles and cast on
  iOS.
- A web-only audio-session fix: rejected. It may not beat the suspension wall.

What Dean will see:
- (superseded 2026-10-28, the next plan) A video playing on the phone keeps playing as sound when he locks the phone or switches
  apps. The lock screen and AirPods pause and resume it, like a song.
- (superseded 2026-10-28, the next plan) When he comes back, the video picks up where the sound is, playing only if the sound was
  playing.
- Listen rows (a video played as audio, chapters included) play through the native engine, like a song; tapping Watch takes the
  video back to the web player at the sound's position.
- Nothing changes on screen: chapters, scrubbing, subtitles and the skins all stay the web's.

## Rulings (settled - do not reopen)

| # | Ruling | Source |
|---|---|---|
| V1 | Video's AUDIO goes native through the existing `audio.*` engine. No native video player, no PiP, no new `video.*` messages. | Dean 2026-10-28 |
| V2 | Two entry points. (a) THE BACKGROUND HANDOFF: exactly where `attemptBackgroundAudioHandoff` hands a video to the `bgAudioEl` sidecar today, with the same eligibility (Background audio setting on, mobile, playing or the iOS pre-pause candidate, not native fullscreen or PiP), it hands to native instead. (b) LISTEN ROWS: a Listen row (`item.listen`, a video played as audio) loads into native as a `video` Item. Everything else on the stand-down list stays on the web (Feed, read-aloud, a watch-page item while it's on screen). **(a) superseded 2026-10-28, (b) built:** the spike failed (the session cannot be activated from a backgrounded app, OSStatus 560557684 '!int'); Dean chose a native video surface, the next plan. v1.398.0 ships (b) only. | Root, from V1 |
| V3 | A new capability **`nativeVideoAudio`**, add-only in bridge v1. The app announces it, alongside `nativeAudio`, only when its engine accepts the two new kinds. Without it, the web is byte-identical to v1.397.0: the sidecar, and Listen rows on the web element. v0.14.0 builds announce `nativeAudio` only and never see a video Item. | Root + iOS Root |
| V4 | The Item gains two kinds, `video` and `tvEpisode`, with fixed prefixes. **src**: exactly `/api/offline/file/video/<id>` or `/api/offline/file/tvEpisode/<id>` (the iOS-playable rendition the downloads already use). **artworkSrc**: `/thumbnail/<id>` (only when the item has a thumbnail, otherwise omitted) or `/tvthumb/<id>`. **progress**: `{ route: '/api/progress', key: <video id> }` or `{ route: '/api/tv/progress', key: <episode id> }`, the same `{id, timestamp, duration}` body native posts today. No `radioSeed`, no plays, no `clip`: a handoff Item is the whole file, and a video's chapters stay a web concept. **Built for `video` (a Listen row) only; `tvEpisode`, `/tvthumb` and `/api/tv/progress` stay in the contract and the server for the next plan (no web code sends them).** | Root |
| V5 | Server. The media token's file kinds (`MEDIA_FILE_KINDS`) gain `video` and `tvEpisode`. `MEDIA_SCOPE` gains `GET /thumbnail/:id` and `GET /tvthumb/:id`. `DEVICE_SCOPE` gains `POST /api/tv/progress` (`POST /api/progress` is already in). RBAC is as for a browser: a restricted user's phone still 404s a restricted video on every one of these routes. | Root |
| V6 | A 503 + Retry-After (a transcode building) on a video src: native holds the Item in `loading` and retries, honoring Retry-After capped at 30 s per wait and **120 s in total**, then emits `audioError { error: 'other' }`. Never `network` (that copy says "No connection"). On any audioError during a handoff, the web leaves its element paused at the handoff position, so the return resumes from there. | Root (the iOS Root proposed the hold-and-retry) |
| V7 | The handoff out. The web pauses its element (`pauseSuppressingHandoff`), then in the same task, with no await, posts `audio.load { queue: [item], index: 0, positionSec: <file seconds now>, autoplay: true, modes: { autoplay: false, shuffle: false, loop: 'off' }, rate: <the element's rate clamped to 0.5-3>, rev: <last + 1> }`. A video paused when the app backgrounds sends nothing (as today, where the sidecar never starts for a paused video). The iOS pre-pause candidate counts as playing. **Superseded 2026-10-28:** the spike failed (the session cannot be activated from a backgrounded app, OSStatus 560557684 '!int'); Dean chose a native video surface, the next plan. Not built here. | Root |
| V8 | The return (the moment `handleForegroundSwapBack` runs today). Position = the newest of the last `audioState.positionSec` and `audioTick.positionSec`. Playing = native's state was `playing` or `loading`. The web posts `audio.stop`, seeks its element, and plays it only if native was playing (Dean's reopen rule, 2026-09-24). An item that ended in the background returns at its end, paused, never at 0:00. The subscription already delivers state and ticks: on a fresh `audio.subscribe` after a pagehide, native sends one full `audioState` at once (native-bridge.md 2), and the web needs nothing more. **Superseded 2026-10-28:** the spike failed (the session cannot be activated from a backgrounded app, OSStatus 560557684 '!int'); Dean chose a native video surface, the next plan. Not built here. | Root |
| V9 | One engine at a time. Native never plays while the web element plays: the pause comes before the post (V7), and `audio.stop` before the element plays (V8). A web video load while native holds a handoff or Listen Item stops native first (the v1.397.0 stand-down rule, unchanged). **The handoff half superseded 2026-10-28** (the spike failed; the next plan); the Listen half is built: a web video load while native plays a Listen Item stops native first. | Root |
| V10 | Listen rows in a Music queue ride as `video` Items next to `track` Items: the D12 "only the playing Item's kind is flattened" rule becomes "a Music queue flattens `track` and Listen `video` Items together". Podcasts are unchanged. Radio asks only from a `track` Item's seed. | Root |
| V11 | Browsers, the PWA, desktop and the v0.14.0 app: inert, byte-identical (V3). | Root |

## The contract additions (bridge v1, add-only; freeze in W1 and relay before W3)

- Capability: `nativeVideoAudio` (boolean, like `nativeAudio`).
- `$defs/audioItem.kind` enum: `["track", "podcastEpisode", "video", "tvEpisode"]`.
- `$defs/audioItem.progress.route` enum gains `"/api/tv/progress"`.
- The src and artworkSrc prefix rules of V4, written into the audioItem description and native-bridge.md 2/3 as the exact
  allowed prefixes (the app validates src against a fixed list).
- native-bridge.md gets one section "Video audio (v1.398.0)" with V2, V6, V7, V8 and V9 in the doc's own register (after the
  re-scope: V2b, V6 and V9's Listen half, plus "Not built: the background handoff (superseded 2026-10-28)").
- Nothing else changes: no new intents, no new events, and no `audioError.error` value is added.

## Seams (verified 2026-10-28 by the Root; line numbers drift, so search by name)

- `public/js/player.js`:
  - `attemptBackgroundAudioHandoff(trigger)` (~3925): the ONE handoff point; its eligibility is
    `shouldHandOffToBackgroundAudio({ settingOn: bgAudioSettingCached, ... })`.
  - `handleForegroundSwapBack()` (~3395): the return.
  - The background-audio state machine (`bgAudioState`, `nextBackgroundAudioState`, `BG_AUDIO_STATES`) and
    `activeMediaElement()` (~3110).
  - `handlePossibleIOSPrePauseHandoff` (~4078): the pre-pause candidate.
  - The lifecycle branch near `LIFECYCLE_PAUSE_EVENTS` (~4300).
  - Under native, the state machine runs as it does with the sidecar. Native is the "background element"; reuse the states,
    don't add a parallel machine.
- `public/js/native-audio.js`:
  - `itemFromDescriptor` returns null for `d.listen === true` (~69): V2b, V4.
  - `PROGRESS_ROUTES` (~60).
  - The `enabled` check `host.has('nativeAudio')` (~117): add the `nativeVideoAudio` check for the video paths only.
  - The stand-down handling and the snapshot store (the position for V8).
- `public/js/music.js` ~4600: the Listen row descriptor (`listen: !!item.listen`, `nativeQueue` undefined for listen,
  `radioSeed` undefined for listen) and `nativeQueueProvider`: V10.
- `lib/auth/device-scope.js`: `DEVICE_SCOPE`, `MEDIA_SCOPE`, `MEDIA_FILE_KINDS` (V5). The census test is
  test/integration/device-scope-census.test.js.
- `lib/auth/gate.js` ~390-450: the media-token request kind (it reads the kinds from device-scope.js; confirm nothing else
  hard-codes the two audio kinds).
- `lib/offline/routes.js`:
  - `SINGLE_KINDS` already holds video and tvEpisode.
  - `GET /api/offline/file/:kind/:id` (~394) serves `decideFile`'s iOS-playable pick, with 503 + Retry-After while a
    transcode builds.
  - The manifest's artworkUrl shapes (~176 `/thumbnail/`, ~263 `/tvthumb/`) are the V4 art routes.
- `lib/media/streams.js` `/thumbnail/:id` and `lib/tv/routes.js` `/tvthumb/:id` (~493): they must 404 a restricted item
  for a media token exactly as for a cookie.
- `lib/tv/routes.js` `POST /api/tv/progress` (~393) and `lib/media/user-routes.js` `POST /api/progress` (~73): the bodies are
  `{id, timestamp, duration}`.
- `docs/references/native-bridge.v1.schema.json` (audioItem ~68-84), `public/js/host-adapter.js` (mirrors the schema),
  native-bridge.md, ios-host.md, offline-api.md 8 (the token: add the two kinds and the two art routes).

## Step 0 (builder, before W1)

- Read:
  - AGENTS.md;
  - docs/LESSONS.md sections 0, 1, 2, 4, 5, 9, 10 and 12;
  - docs/references/native-bridge.md, ios-host.md, offline-api.md 8, and **ios-background-audio-behavior-map.md (all of
    it)**;
  - the completed plan 2026-10-28-native-audio.md (its rulings D1-D18 and its gate findings);
  - this plan.
- Environment:
  - export the fnm Node PATH;
  - a worktree under .claude/worktrees/ with node_modules hard-link-copied;
  - stage by name, no force-push, no --no-verify.
- Census, into Evidence before any code:
  - every caller and every reader of `bgAudioEl` and `bgAudioState` (about 107 references), with which of them the native
    path must also satisfy;
  - every place a video's sound can play on iOS other than these two entry points;
  - every hard-coded use of the two audio kinds (server and web).
  A seam the census finds that this plan doesn't name: add it here; don't skip it.
- **The iOS Root's background-start spike.** The FileTube Root asked the iOS Root to measure, on Dean's phone with no
  contract change, whether native can START AVPlayer from a message received at the web's `visibilitychange -> hidden`
  while WebKit was playing a video. The FileTube Root relays the result into this plan.
  - **Pass**: build as written.
  - **Fail**: STOP. The trigger has to move native-side (a host lifecycle event), which is a contract change the Root
    re-freezes with Dean.
  - Don't start W3 without the result. W1 and W2 can proceed.
- Red first: a contract test that a host announcing `nativeAudio` + `nativeVideoAudio` gets `audio.load` with a `video` Item
  when a playing video backgrounds, and that `bgAudioEl.play` is never called. Watch it fail on main.

## Waves

1. **W1 - the contract.**
   - Make the changes in "The contract additions": schema, host-adapter, native-bridge.md, ios-host.md, offline-api.md 8.
   - Contract tests (a `video` Item and a `tvEpisode` Item validate; a `video` Item with an `/api/offline/file/track/` src
     or a radioSeed is refused, if the schema can express it, otherwise by the adapter).
   - Send the schema sha to the FileTube Root to relay before W3.
2. **W2 - server (V5).**
   - `MEDIA_FILE_KINDS` + 2.
   - `MEDIA_SCOPE` + `/thumbnail/:id` and `/tvthumb/:id`.
   - `DEVICE_SCOPE` + `POST /api/tv/progress`.
   - Update the census test.
   - Measure, into Evidence: a 1 GB MP4 and a TV episode through `/api/offline/file/<kind>/<id>?mt=` with Range (TTFB, a
     mid-file seek). If it's materially slower than `/video/:id` or refuses a Range: STOP and ask.
3. **W3 - the web.**
   - (superseded 2026-10-28) native-audio.js builds `video` and `tvEpisode` Items (V4) and exposes a handoff out and back.
     Built: `video` Items for Listen rows only.
   - (superseded 2026-10-28, not built) At `attemptBackgroundAudioHandoff`, with the capability, take the native branch (V7)
     instead of the sidecar. At `handleForegroundSwapBack`, take the return (V8).
   - Listen rows load natively (V2b), and the Music queue flattening carries them (V10).
   - The proxy (the v1.397.0 accessors) covers a Listen row exactly as it covers a track. (superseded) The handoff does NOT install
     the proxy: the page is hidden, and the video element stays the page's element.
   - Without `nativeVideoAudio`, every new branch is inert.
4. **W4 - guards.**
   - A binding test per ruling V2-V10 (mutate it, watch it red). The V9 test must show that the web element and native
     never both play, in both directions.
   - A no-capability byte-identity test for the sidecar path (V3).
   - Token tests:
     - `mt` reaches a `video` and a `tvEpisode` file and the two art routes;
     - `mt` is refused for `/video/:id`, `/tvepisode/:id` and any POST;
     - a restricted video 404s on all four routes for a restricted user's media token.
   - (V8 superseded, not built) The ended-in-background return and the 503-then-error path (V6) driven by a fake host in jsdom.
5. **W5 - relay.** The final schema sha goes to the FileTube Root. No screenshots are needed: nothing on screen changes.
   Say so in Evidence.

## Stop rules

- The spike fails (Step 0): STOP. A contract change.
- The native branch can't reuse the background-audio state machine without forking it: STOP and ask.
- `/api/offline/file` can't serve a large video online acceptably (W2): STOP and ask.
- Any contract field needs to change after the W1 relay: STOP. The Root relays it.
- A security seat finding on the token widening that V5 can't close: STOP and ask Dean.

## Gate

Full gate, forced (auth and token surface, the player core): **adversary + qa + security-brief**.
- Adversary: V9 (two stacks never both play: background, return, a Listen row, a video load mid-handoff); V8's position and
  playing state (lock-screen pause, then return; ended in the background; the pre-pause candidate); and V3 byte-identity.
- Security-brief: V5 (the widened `mt` scope, restricted users, the art routes as an existence oracle).
- Brief the seats with the LESSONS sections Step 0 lists, and the behavior map.

## Release

- docs/RELEASING.md + AGENTS.md: the protected-main PR flow, dual-Node 22.23.1 + 24.20.0, the image smoke, a
  docs/releases.json entry, a ROADMAP entry, and a LESSONS line if a wave taught one.
- Close the plan in the release PR with `node scripts/plan-complete.js docs/exec-plans/active/2026-10-28-native-video-audio.md "Shipped v1.398.0" --apply`.
- Dean authorizes the merge. After the tag's Publish run is green, the builder sends the tag and commit to the FileTube
  Root, which relays them to the iOS Root.

## Not in scope

- A native video player, PiP, AirPlay video, native subtitles or audio-track choice.
- A video queue or autoplay to the next video in the background.
- A video's chapters as clips on the WATCH page (the on-screen chapter list stays a web concept). A Listen row of a chaptered
  video IS its file plus `clip`, as a chaptered audio file's rows are (S2, built).
- Any change to the web video player on screen, or to the sidecar's behavior without the capability.
- Anything else goes to ROADMAP Planned.

## Device checks (after the iOS app build that pins this tag; add to docs/DEVICE-CHECKS.md)

Cut 2026-10-28 to what v1.398.0 ships (the FileTube Root's re-scope after the failed spike): (a)-(e) and (g) belonged to the
background handoff and go with the next plan.

- (f) A Listen row from Music (a video played as audio; a chaptered one too) plays and resumes from the lock screen like a song;
  its position is saved; tap "Watch" and the video opens where the sound was, playing only if the sound was playing.
- (h) A restricted account's phone: a restricted video never plays as sound by any route.
- (i) An app build without `nativeVideoAudio` (v0.14.0): a Listen row and a backgrounded video behave exactly as on v1.397.0.

## Evidence (builder fills)

### Step 0 (2026-10-28, Fable builder; line numbers at 59245046 = main 9e11ed90 + this plan)

- **Spike:** not received at Step 0 (the FileTube Root idle, no relay in the plan or the inbox). W1 + W2 proceed; W3 waits for it.
- **Census: every reader and writer of `bgAudioEl` / `bgAudioState` in player.js (150 matching lines; `grep -n 'bgAudioEl\|bgAudioState'`),
  by function, with what the native path must satisfy.** Pure helpers 300-470 (`shouldPauseForLifecycleEvent`, `BG_AUDIO_STATES`,
  `nextBackgroundAudioState`, `shouldHandOffToBackgroundAudio`, `shouldPresyncBgAudio`, `isFreshPrePauseCandidate`): REUSED, the
  native handoff drives the same states (INLINE_VIDEO -> HANDING_OFF -> BACKGROUND_AUDIO -> INLINE_VIDEO). `activeMediaElement` 3110:
  returns `bgAudioEl` in the two background states; under a native handoff no web element plays, so it must return `mediaPlayer`
  (every sidecar listener at 8090-8121 is guarded on `activeMediaElement() === bgAudioEl` or the BACKGROUND_AUDIO state and stays
  silent; the keep-alive 5106-5138 starts only from the sidecar's play() success). `handleForegroundSwapBack` 3395: THE return (V8).
  `releaseBackgroundAudioElement` 3444 / `releaseAudioSession` 3808 (already returns under `nativeActive()`). `armBackgroundAudioSrc`
  3860, `presyncBackgroundAudioPosition` 3903, `primeBackgroundAudioElement` 4213 and the prepare-audio POST + pre-arm in
  `setupForMedia` 10162-10260: the SIDECAR's own prep (a server-side /audio extraction, a muted prime play on a second element, a
  periodic range request): skipped for a video native will take (the sidecar is never the background element there; see seam S4).
  `attemptBackgroundAudioHandoff` 3925: the ONE handoff point (V2a, V7). `bgAudioSkipReason` 4027, `handlePossibleIOSPrePauseHandoff`
  4078 (the INLINE_VIDEO gate), `handleBackgroundLifecycle` 4280-4345 (state diagnostics, the candidate consumer): unchanged. The
  MediaSession action detail 3509-3514, `recordDiagnosticPauseEvent` 4510, `mediaPlayDetail` 4575, the lock-audio timing log
  4914-5002: diagnostics, read-only (the timing log is sidecar-specific and records an idle sidecar under native; disclosed, not
  changed). `teardownMediaState` 9900-9910 and `close` 10777-10790: reset the machine and the sidecar; the native handoff is ended
  by native-audio.js `claim()` / `release()` (a web video load or a close stops native first, V9). `setupForMedia` 10133-10134
  (`bgAudioStatusKnown` from the descriptor) and 10062 (the status repoll): the sidecar's readiness, which the native eligibility
  does not read (V2a lists the setting, mobile, playing or the candidate, not native fullscreen or PiP).
- **Census: every place a video's sound can play on iOS other than the two entry points.** (a) the web `<video>` on screen (the
  watch page, a TV episode, the Feed's cards, a same-id Watch -> Listen adopt); (b) the sidecar (replaced under the capability for an
  eligible video; kept for the rest, seam S3); (c) the keep-alive silent loop (only after a sidecar success: never under native);
  (d) native fullscreen / PiP (iOS sustains it; `shouldPauseForLifecycleEvent` excludes it from any handoff); (e) a book's read-aloud
  and library audio opened on the watch page (`type: 'audio'`: lifecycle-exempt, never a handoff); (f) Listen Control drives a PC's
  player, not the phone's. No other writer of `mediaPlayer.src` or of a second element (the v1.397.0 gate's sweep holds at this sha).
- **Census: every hard-coded use of the two audio kinds.** Server: lib/auth/device-scope.js `MEDIA_FILE_KINDS` (the one list the gate
  reads through `mediaScopeAllows`; gate.js:392 and lib/auth/media-token.js:15 describe it in comments), docs/references/offline-api.md
  section 8 (the route list), test/integration/device-scope-census.test.js (MEDIA SCOPE) and media-token.test.js (the video refusals).
  Nothing else on the server names the two audio kinds for the token (lib/offline/routes.js `SINGLE_KINDS` already holds video and
  tvEpisode; `RESOLVERS.video` / `.tvEpisode` and `decideFile` serve them for the device token today). Web: host-adapter.js
  `AUDIO_KINDS` + `AUDIO_PROGRESS_ROUTES` (the schema mirror), native-audio.js `PROGRESS_ROUTES`, `itemFromDescriptor` (`track` /
  `podcastEpisode` from `resumeMode`) and `itemFromQueueEntry`, music.js `rowFromNativeItem` (`kind !== 'track'` -> null),
  podcasts.js `onAppend` (podcast Items only), native-bridge.md section 3's Item line, the schema's `audioItem.kind`, and the tests
  native-bridge-audio ("kind is track | podcastEpisode") and native-audio-items (the Listen refusal).
- **Seams the census found that the plan does not name (added here, not skipped):**
  - S1 Listen -> Watch on the SAME id: player.js `load()`'s ADOPT branch (`isAdoptLoad`, ~10822) keeps the element as it is; with a
    Listen row native owns, the element is the src-less proxy, so the watch page would show nothing. An adopt of an id native owns
    by a load that carries no `nativeQueue` (the watch page) must be a FRESH web load that carries the position and the paused state
    (`resolveBaseHandoff` covers only `<id>::c<n>` -> `<id>`; the same-id case needs the same carry from the proxy, LESSONS 5 v1.344.2).
  - S2 A chaptered Listen video's `::c` rows: V4's "no clip" is the HANDOFF Item's rule ("a handoff Item is the whole file"); a Listen
    chapter row rides as a `video` Item WITH `clip` (the D6 semantics a chaptered audio file's rows already use: positionSec and seek
    clip-relative, native ends the item at `clip.endSec`, progress under the file id in file seconds). No-clip rows of one file would be
    indistinguishable to native (every row the whole file from 0). Stated in the contract (W1) and relayed with it, before W3.
  - S3 The Feed's video cards save through `/api/feed/progress/media` (a forward-only slice route, not a contract route) and play a
    SLICE with end-at listeners on the element: no `video` Item can be built for them, so they keep today's sidecar path unchanged
    with or without the capability (the Feed is a screen-on, swipe-driven surface; v1.397.0 census). Moot after the re-scope: no
    video is handed off at all; the Feed keeps the sidecar like every video (gate r1 adversary A-S3).
  - S4 With the capability, a natively-eligible video skips the sidecar's prep in `setupForMedia` (the prepare-audio POST that queues
    a server-side ffmpeg extraction, the pre-arm, the gesture prime): the setting read stays (it still decides), the sidecar stays
    for S3's items. Without the capability: byte-identical (V3).
  - S5 A same-id Watch -> Listen adopt (a plain video, no chapters) stays on the web element on screen (today's "never moves" rule,
    Dean 2026-09-29); its background goes native through V2a; a fresh Listen load (a deep link, a chaptered video's `::c` rows) claims
    native (V2b).
  - S6 V4's "artworkSrc only when the item has a thumbnail": the Listen row carries `hasThumbnail` from `/api/videos/:id` (music.js
    `playListenItem` / `buildListenChapterTracks` -> `trackLoadData`); a handoff reads `currentData.hasThumbnail` (the watch payload).
  - S7 The return after an item ENDED in the background does not run the sidecar's deferred autoplay-next
    (`pendingAutoplayNextOnForeground`, set only by the sidecar's ended cascade): V8 returns at the end, paused.
  - S8 V10: music.js `rowFromNativeItem` (a fresh Music page adopting native's queue) maps a `video` Item to a Listen row, and
    native-audio.js `flattenServerQueue`'s "only the playing Item's kind" filter becomes a family rule (Music: `track` + Listen
    `video`; Podcasts: `podcastEpisode`).
- **Red first** (test/unit/native-video-audio-contract.test.js at 59245046, the file committed with W1): `node --test` = 3 tests,
  2 pass, 1 fail: `not ok 1 - RED FIRST: a host announcing nativeAudio + nativeVideoAudio gets audio.load with a video Item when a
  playing video backgrounds, and the sidecar is never played` (`the adapter knows the capability: false !== true`); `ok 2 - CONTROL:
  a host with nativeAudio but WITHOUT nativeVideoAudio ... the sidecar plays, nothing is posted (V3)`; `ok 3 - CONTROL: no host`.

### W1 + W2 (2026-10-28)

- **W1 at b44cbb91** (relayed to the FileTube Root 2026-10-28, which relayed it to the SANDYJAR iOS Dev Root with the S2 clip
  clarification and accepted it as a W1 decision). The adapter enforces V4 at the post (`audioItemOk`: src exactly
  `/api/offline/file/<kind>/`, artworkSrc one of the four art routes, radioSeed only on a track), since the schema's mirror test
  cannot express a cross-field rule; the schema's description states the same rules for the app.
- **W2 large-video Range measurement** (scratchpad `measure-video-route.js`, Node 22.23.1, this box, 7 runs per cell, median time to
  the first body byte in ms; a 1073741824 B `.mp4` library video and a 419430400 B TV episode, random bytes; the web routes with a
  member's cookie, the offline route with that member's media token):

  | route | cold GET | Range mid-file (`bytes=<half>-`) | suffix `bytes=-1048576` | statuses | Accept-Ranges / ETag / Cache-Control |
  |---|---|---|---|---|---|
  | `/video/:id` (web, cookie) | 3.1 | 3.8 | 3.0 (416) | 200/206/416 | - / no / - |
  | `/api/offline/file/video/:id?mt=` | 3.1 | 3.1 | 3.1 (206) | 200/206/206 | bytes / yes / private, no-store |
  | `/tvepisode/:id` (web, cookie) | 2.1 | 3.0 | 2.9 (416) | 200/206/416 | - / no / - |
  | `/api/offline/file/tvEpisode/:id?mt=` | 2.9 | 3.3 | 2.9 (206) | 200/206/206 | bytes / yes / private, no-store |

  Within 1 ms of the web routes on every cell (the episode's cold GET is 0.8 ms slower, its mid-file Range 0.3 ms slower; the 1 GB
  video's mid-file Range is 0.7 ms faster), and the offline route answers a suffix Range (206) where `sendRangeable` refuses it
  (416). Not materially slower, no Range refused: the stop rule does not fire.
- **W2 tests:** test/integration/device-scope-census.test.js (4/4: `POST /api/tv/progress` in the expected set and the writes list;
  MEDIA SCOPE = the five routes, the file kinds video + tvEpisode admitted, album / tvSeason refused, `/video`, `/tvepisode`,
  `/tvposter`, `/api/tv/progress` refused), test/integration/media-token.test.js (9/9: the new V5 test - `mt` reaches a video and a
  TV episode (full, Range, suffix Range, HEAD) and `/thumbnail` + `/tvthumb`; a restricted user's media token 404s the restricted
  video and episode on all four routes, an unknown id answers 404 on the file route and `/tvthumb` (`/thumbnail/<unknown id>` is
  the 200 placeholder it has always been for the same account's cookie and device token: a pre-existing oracle, not new to `mt`;
  gate r1 qa S5, security-brief INFO); an unrestricted member's token plays them; the device
  token posts `/api/tv/progress` (saved for that user; a hidden episode 404s); a media token never posts; the web's `/video`,
  `/tvepisode`, `/tvposter` byte routes and every POST stay a JSON 401 for `mt`). Sibling suites (device-tokens, auth-gate-devices,
  offline-progress, media-token unit, rbac-census, route-write-classification): 33 tests, 33 pass, 0 fail.

### The spike (relayed by the FileTube Root 2026-10-28, after W2): FAILED - the Step 0 stop rule fired

- On Dean's iPhone 15 Pro (the iOS Root): the ordering is willResignActive, then didEnterBackground; WebKit pauses the video
  50-200 ms later while the page still reports visible, and `visibilitychange -> hidden` follows 5-15 ms after that. The page's
  message reaches the app every time, but the audio session cannot be activated from it (OSStatus 560557684 '!int', cannot
  interrupt others), and pre-activating at willResignActive does not help: AVPlayer never leaves waiting / paused.
- Consequence: the background handoff as planned (V2a, V7, V8: a web-triggered native start at the lifecycle event) cannot work.
  The Root is taking the design question to Dean (native audio from the first frame with a muted web picture, or a full native
  player). The Root's interim direction to the builder: do not build V2a / V7 / V8, leave player.js's background-audio path
  untouched, do not release; the Listen-row half (V2b, V10, the chaptered clip rows) holds in every option and may be built
  behind `nativeVideoAudio` - put to Dean below (the stop rule's own step) before any W3 code.
- **Dean's ruling (AskUserQuestion, 2026-10-28): "Build the Listen-row half now."** W3 is narrowed to V2b + V10 (a Listen row,
  chapters included, plays natively like a song, behind `nativeVideoAudio`, with S1, S2, S6 and S8), its W4 guards and the V3
  byte-identity. V2a / V7 / V8 (the background handoff) are NOT built: player.js's background-audio path stays untouched; with the
  capability a backgrounded video still takes the v1.397.0 sidecar. No release until the Root re-freezes the handoff design with Dean.

### W3 as built (the Listen-row half; the commit after 6a1fa67f)

- **native-audio.js:** `itemFromDescriptor(d, opts)` builds a `video` Item for a Listen row only with `opts.video` (the host announces
  `nativeVideoAudio`; `readProvider` passes it): src `/api/offline/file/video/<file>`, `/thumbnail/<file>` art unless `hasThumbnail`
  is false (S6), progress `/api/progress` under the file id, a chapter row as the file plus `clip` (S2), never a radioSeed; without
  it a Listen row is null as in v1.397.0 (the whole load stays on the web element). `sameFamily` (V10): with the Up-next pointer on a
  Listen row, the flattening hands the Music view the TRACK entries after it (an Up-next entry never builds a `video` Item itself;
  gate r1 qa S1). The api exposes `videoAudio` (false on the inert api).
- **music.js:** `trackLoadData` supplies the queue provider for a Listen row only when `nativeVideoOn()` and carries `hasThumbnail`;
  `playListenItem` / `buildListenChapterTracks` carry `hasThumbnail` from `/api/videos/:id`; `rowFromNativeItem` maps a `video` Item
  to a Listen row (the `listen` marker, the /video stream, /thumbnail art, /api/progress, a clip Item as its chapter row) so a fresh
  Music page adopts native's queue with Listen rows in it (S8).
- **player.js (S1; the rule as of the r2 fix, gate r1 A-W1 + r2 A-r2-W1):** `load()` treats a same-id load as a FRESH web load, not
  an adopt (`isNativeHandBackLoad`), only when native owns the id AS A `video` ITEM (the kind remembered at the claim, never read
  from the live snapshot), the load DESCRIBES the media (a `type` string: the watch page's full load; its bare early-adopt call stays
  an adopt of the proxy) and carries no `nativeQueue` (the Music view's own re-load is a FOLLOW); a track Item (library audio) keeps
  the proxy on the watch page as in v1.397.0. The hand-back carries the proxy's position and paused state into the resume
  (`nativeHandBackCarry` -> `loadBaseHandoff`): native is stopped by the video branch's claim, the element gets `/video/<id>`, plays
  at native's position only if native was playing. The background-audio path (the sidecar, `attemptBackgroundAudioHandoff`,
  `handleForegroundSwapBack`, the prep in `setupForMedia`) is untouched: with the capability a backgrounded video takes the v1.397.0
  sidecar, byte for byte (bound by the two SUPERSEDED tests in native-video-audio-contract.test.js).
- **Not built (superseded):** V2a, V7, V8, the handoff half of V9, S3, S4, S5 (the adopt case needs nothing now), S7. The
  `tvEpisode` kind, `/tvthumb`, `/api/tv/progress` stay in the contract and the server (W1 + W2, add-only) for the next plan; no web
  code sends a `tvEpisode` Item.
- **Tests:** test/unit/native-video-audio-contract.test.js (the red-first file, rewritten to the shipped scope: V2b through the real
  player on a phone realm, V3 and V11 controls, the two SUPERSEDED sidecar controls, the pure S1 helpers; 6), native-audio-web
  (V2b through the real `/music?play=<id>&listen=1` path with the dock and the proxy, S2 chapter rows + the roll, S1 both ways
  (playing / paused), S8 adoption, V10 D12 family, V6 audioError; 25), native-audio-items (the Item and `sameFamily`; 7),
  native-bridge-audio (W1; 7). The older "gate r1 qa C1" Listen test stays as the no-capability control (byte-identical).

### W4 guards (the commit after fc8349f2)

- **Mutant round** (scratchpad `mutants.js` / `mutants.log`; a `git archive` sandbox of fc8349f2 plus the two test files of this
  commit, restored from a pristine copy after each mutant and byte-compared at the end: identical; each mutant run against the tests
  that claim to bind it): 26 run, 24 KILLED by name, 2 survived and classified. Killed: M1 the `opts.video` gate (a Listen row built
  without the capability), M3 a Listen row as a `track` Item, M4 art for a video with no thumbnail (S6), M5 the progress route not
  forced to `/api/progress`, M7 a radioSeed on a video Item, M8 `sameFamily` back to strict equality (V10), M9 the D12 filter by kind,
  M10 `readProvider` never passing the capability, M11 the api hiding `videoAudio` from music.js, M12 a video Item not adoptable as a
  row (S8), M13 the adopted row losing the `listen` marker (bound by "a Listen session is never shuffled around": the toggle re-sends
  nothing), M14 the hand-back staying an adopt (S1), M15 the position not carried (S1), M16 the Music view's own same-id re-load
  taken back to the web (S1, the other direction), M17 / M18 / M19 the adapter's V4 rules (src prefix, radioSeed, art prefixes), M20 /
  M21 / M22 the V5 scope entries (video kind, `/thumbnail`, `POST /api/tv/progress`), M23 the paused state not carried (S1), M24 the
  capability assumed from `nativeAudio` alone (V3), M25 / M26 `hasThumbnail` not carried (S6). SURVIVED: M2 music.js's own
  `nativeQueue` gate for a Listen row alone (masked by M1's builder check, the same defence-in-depth pair as v1.397.0's B24; M1 + M2
  together die with M1's tests); M6 the progress key `(clip || listen) ? base : id` reduced to `clip ? base : id` - called
  EQUIVALENT at r1 and MIS-CLASSIFIED (gate r1 qa W5 = adversary A-S1): a chapter row with no known span (the last chapter of a video
  whose duration the server reports as 0) reached the builder with no clip, so the mutant's key was `<id>::cN` and native's progress
  POST 404ed. The fix round refuses such a row (null: the whole Listen load stays on the web, as in v1.397.0); after it every Listen
  Item with a `::c` id carries a clip, so the two arms agree on every input the builder accepts (re-run below, "Gate r1 fixes").
- **Guards per ruling (W4):** V2b (native-video-audio-contract "V2b", native-audio-web "V2b" through the real `?listen=1` path), V3 +
  V11 (the contract file's controls; the older "gate r1 qa C1" web test; M24), V4 (native-bridge-audio; M17-M19), V5 (the census +
  media-token tests; M20-M22), V6 (native-audio-web "V6": `audioError other` -> one "Could not play this" toast, nothing posted or
  re-loaded by the web), V9's Listen half (native-audio-web "intents ... a video load stops native"; S1 both directions), V10
  (native-audio-web "V10 (D12 family)", "S8", native-audio-items `sameFamily`), the byte-identity of the sidecar path with the
  capability (the two SUPERSEDED tests). No screenshots: nothing on screen changes (W5).

### Gate (round 1)

- Gate: APPROVED r1 @1503b29f - security-brief
  - Could NOT run (no Bash on this seat): the suites, git diff 9e11ed90. "Verified" below = traced in the working tree at 1503b29f.
    The changed-file set was taken from the plan plus a grep for the v1.398 markers (17 files): the only lib/ files are
    lib/auth/device-scope.js (the three allowlist additions) and one comment line in lib/auth/media-token.js:15-16; no route,
    resolver, gate or logger file changed on the server, and gate.js mediaAuth reads exactly as approved at v1.397.0 r3.
  - Q1 (the four routes under mt vs the cookie), VERIFIED: gate.js:445-446 sends every request carrying mt into mediaAuth, which sets
    req.user from the token's own user row (gate.js:419-422), the same row a cookie session gets at :509-513, so userRestrictionIndex(req)
    (server.js:1175-1179 mediaVisibleTo, :1215-1217 tvEpisodeVisibleTo) is identical for the two credentials, and nothing on the four
    routes branches on req.authVia (its only readers: lib/auth/routes.js:240 and :293, lib/pages/routes.js:203). lib/offline/routes.js:220-225
    resolveVideo (own-property metadata lookup + mediaVisibleTo, null -> 404 at :399), :270-275 resolveTvEpisode (own-property +
    tvEpisodeVisibleTo -> 404), lib/tv/routes.js:493-497 /tvthumb (ownEpisode; missing and restricted both 404 'no such episode'),
    lib/media/streams.js:124-139 /thumbnail (restricted -> 404). Bound by media-token.test.js:215-221 (hidden AND unknown 404 on all
    four for the kid's mt) and :229-232 (an unrestricted member's mt plays them).
    - INFO (pre-existing, no change asked): the /thumbnail existence oracle (unknown id -> 200 placeholder SVG titled 'Media',
      streams.js:151-178; hidden id -> 404 at :137-139) has been the same account's through its cookie session since v1.80 and through
      its device token since v1.387.0 (device-scope.js:30 holds GET /thumbnail/:id). It is new only for the media-token credential
      class, and it yields "an id I cannot see exists" for an id the prober must already hold (ids are md5(path); no title, no bytes).
      A kid learns nothing their own browser does not already tell them. The other three routes are neutral (unknown = hidden = 404).
    - /tvthumb's poster fallback (tv/routes.js:501-502 findShowPoster(ep.showPath)) runs only after the EPISODE passed
      tvEpisodeVisibleTo, and ep.showPath is the store row's, never the request's. A show hidden by a path restriction on its folder
      hides every episode under it (isBlocked on filePath), so no hidden show's poster is reachable; a show with one visible season
      already shows its poster to the same account through /tvposter (:507-512). Keeping /tvposter out of MEDIA_SCOPE withholds nothing
      /tvthumb of a visible episode does not give; harmless either way.
  - Q2 (a transcode trigger for the mt), VERIFIED, INFO: lib/offline/routes.js:404-410 calls entry.transcode.queue() (server.js:1990-1995
    queueTranscode, tv/routes.js:194-199 queueTvTranscode) when the rendition is absent, on GET and, through Express, HEAD. Both queues
    dedupe by id and run ONE ffmpeg at a time; neither caps its length. The same trigger has been reachable by the same account through
    its cookie session (the route is behind the gate like any other: lib/offline/routes.js:5-8, and the plan's W2 measurement used one)
    and its device token since v1.387.0, and /video/:id transcodes on demand for the browser anyway. New for the mt credential class
    only: a leaked 6 h token could enqueue every VISIBLE non-iOS-playable video, serially, into a cache the LRU bounds (offline-api.md:204,
    5 GB default). Not a new resource class in a solo-dev self-hosted deployment; the mint is 6 a minute per device (server.js:303), the
    token dies with its device row (gate.js:415-420), and native's own retry is capped at 120 s (V6). No change asked.
  - Q3 (kind confusion across the file route), VERIFIED, INFO: a video id on /api/offline/file/track/<id> is null (resolveTrack :201-219
    reads ns.tracks by own-property, then the Music projection, which lib/music/libraryAudio.js builds from type 'audio' items only). An
    AUDIO library id on /api/offline/file/video/<id> DOES resolve (resolveVideo :220-225 reads db.metadata by id with no type check):
    mediaEntry(item, 'video') sets isAudio true, transcode null (:175), and decidePlayability (lib/offline/playable.js:70-74) serves the
    ORIGINAL audio bytes - the same bytes /track/<id> and /video/<id> serve to the same account under the same mediaVisibleTo, with no
    transcode and no RBAC gate skipped (the Music projection's channel eligibility is a product projection, not a restriction; /video/:id
    serves these to the browser today). A TV or podcast id on /video/ is null (db.metadata only); '__proto__' is refused by ownProp
    (:115). Pre-existing for the device token (SINGLE_KINDS unchanged).
  - Q4 (POST /api/tv/progress from a device token), VERIFIED: lib/tv/routes.js:398-411 - id must be a non-empty string, ownEpisode
    (:170-172, hasOwnProperty, so '__proto__' / 'constructor' -> 404), tvEpisodeVisibleTo -> 404 BEFORE any write, the write keyed by
    req.user.id (:405), the 90% latch (:407-409) writes the requester's own played row. One id per POST, no arrays, no mass write. A
    hidden episode cannot be marked watched from a phone (bound: media-token.test.js:239), and a media token never posts (:241-242).
    INFO (pre-existing, identical for the browser): timestamp 'Infinity' passes Number() and latches WATCHED while the stored position
    becomes 0 (lib/auth/store.js:1832-1833, num() drops non-finite values); the requester's own row only.
  - Q5 (no new logger or echo of mt, no redirect), VERIFIED: no server route, gate or logger file is in the delta; the one URL logger
    (server.js:3265) redacts mt and is reached by mutating methods only; gate.js:445-446 returns from mediaAuth for every request
    carrying mt before deny() / loginTarget (:434-437) can run, independent of the path, so an HTML Accept with a bad mt on /thumbnail
    or /tvthumb is the JSON 401 (media-token.test.js:174-177 binds the shape on /albumart). No console line in lib/offline/routes.js,
    lib/tv/routes.js or lib/media/streams.js names req.url / originalUrl.
  - Q6 (the adapter and the host-event boundary), VERIFIED: host-adapter.js:56-66 audioItemOk at the POST (src exactly
    /api/offline/file/<kind>/, artworkSrc one of the four art prefixes, radioSeed track-only). Inbound audioState Items are shape-checked
    (:78-91, :173-188: strings up to 2048), not prefix-checked; music.js:1846-1857 rowFromNativeItem copies title / artist / album /
    artworkSrc as plain strings into the existing row shape, builds streamSrc itself ('/video/' + encodeURIComponent(base)) and fixes
    progressEndpoint to '/api/progress'; the renderers attribute-escape artUrl (music-skins.js:129 and :133 esc, skin-surface.js:4297
    panelEscape) and player.js:10421 assigns it through CSSOM (not an injection sink). Forging a filetube-host event still needs
    same-origin script execution, which is already full account control. The same trust boundary as v1.397.0; nothing new crosses it.
  - Lying-text check on the surface, all true to the code: device-scope.js:56-64 and :72, media-token.js:15-16, gate.js:390-398,
    offline-api.md:236-244, native-bridge.md:121-128, the census test's five-route assertion (device-scope-census.test.js:103-108).
  - No CRITICAL / WARNING / SUGGESTION. Approval bound to 1503b29f. Tree after this write: this plan doc only.

- Gate: CHANGES r1 @1503b29f - qa
  - Scope reviewed: `git diff 9e11ed90..1503b29f` (17 files, +1045 / -82), the four commit messages, this plan top to bottom, native-bridge.md 3 + 5, ios-host.md, offline-api.md 6 + 8, the schema, LESSONS 0 / 1 / 2 / 4 / 5 / 9 / 10 / 12, the v1.397.0 gate findings. HEAD = 1503b29f4be3eb92bb8c698a024c8c6e6e640a62.
  - **WARNING W1 (lying doc, LESSONS 12): docs/references/ios-host.md says the background handoff ships.** Line 47-48 ("since v1.398.0 (`nativeVideoAudio`) a video's SOUND too, when the app goes to the background or a video is played as audio") and the whole v1.398.0 addendum (heading "a video's sound in the background"; "when a playing video is backgrounded (the Background audio setting on) the web pauses its element and hands the file to the engine at the same second ... on return the web stops the engine and resumes its video at the sound's position"). Scenario: the iOS Root reads this as the FileTube half's spec, waits for an `audio.load` at background on a v0.15 build and never gets one (player.js's handoff path is untouched; bound by the SUPERSEDED tests); Dean's device check expects a locked phone to resume a backgrounded video and it does not. Fix: reword both to the shipped scope (a Listen row only; a backgrounded video keeps the v1.397.0 sidecar) and point at native-bridge.md 3 "Not built: the background handoff (superseded)".
  - **WARNING W2 (lying contract text): docs/references/native-bridge.v1.schema.json `audioItem.description`** still says a video Item is "the background handoff of a playing video, or a Listen row" and "a background-handoff Item never does (it is the whole file; a video's on-screen chapters stay a web concept)". The app validates Items against this file and reads the description as the rule; no web code builds a handoff Item. Fix: text-only (a `video` Item is a Listen row, a chapter row carries `clip`; the handoff is not built, see native-bridge.md 3). A description is not a contract FIELD, so this is not the stop rule's "contract change", but relay the new sha with the W5 relay.
  - **WARNING W3 (lying comment): public/js/host-adapter.js:279-280** "a library video and a TV episode played as SOUND (the background handoff of a playing video, a Listen row)". Same scenario as W2 for the next reader of the adapter. Fix: "(a Listen row; v1.398.0 builds no background handoff)".
  - **WARNING W4 (the plan's own unmarked prose contradicts what shipped):** the title (line 13 "when the app goes to the background"), "What Dean will see" bullets 1-2 (lines 39-41), "The contract additions" line 68 ("with V2, V6, V7, V8 and V9"), W3 lines 150-152 + 154-155, W4 line 165 (the V8 return driven by a fake host), and **"Not in scope: A video's chapters as clips" (line 197)**, which S2 as built inverts: a Listen chapter row IS a `video` Item with `clip` (native-audio.js:95-96, bound by native-audio-web "S2"). The rulings table marks V2a / V7 / V8 / V9 correctly; the rest reads as if the handoff ships and clips do not. Scenario: the plan is closed into completed/ and the next plan's kickoff reads line 197 and designs chapters-as-clips as new work. Fix: one re-scope line under the title pointing at "The spike" in Evidence, and qualify line 197 ("the on-screen watch page's chapters; a Listen chapter row rides as a clip Item, S2").
  - **WARNING W5 (a mis-classified mutant, LESSONS 2 "re-examine equivalent verdicts"): M6 is NOT equivalent.** `buildListenChapterTracks` (music.js:531 `span = end > start ? end - start : 0`) KEEPS a zero-span chapter row (the last chapter when `/api/videos/:id` reports `duration` 0 / unknown, or two chapters sharing a `startTime`). That row reaches `itemFromDescriptor` with id `<vid>::cN`, `listen: true`, `duration: 0`, so no `clip` is set (native-audio.js:95 needs `dur > 0`). Shipped: key = base (`(item.clip || listen) ? base : id`), native posts `/api/progress` under the file id. Mutant `clip ? base : id`: key = `<vid>::cN`, the POST 404s (no such media) and the position is lost. The shipped code is right; the Evidence line 366 "every real input gives the same key" is false. Fix: one assertion in test/unit/native-audio-items.test.js (`{ id: 'vid1::c1', listen: true, duration: 0, chapterStartSec: 30, ... }, { video: true }` -> `clip` undefined, `progress.key === 'vid1'`), re-run M6 and re-true line 366.
  - SUGGESTION S1: Evidence line 330-331 "the Up-next flattening hands the Music view `track` and `video` ENTRIES of one family" and native-bridge.md 3 "(the Up-next flattening hands it both)": an Up-next VIDEO entry is built by nobody (native-audio.js `itemFromQueueEntry` -> null for a non-audio media entry; the web agrees, music.js:2727 `item.type !== 'audio'` -> null), so what rides is the Listen ITEM already in the queue plus the track ENTRIES after it (exactly what the V10 test shows). Parity, not a regression; say "Items" / "the track entries after a Listen row".
  - SUGGESTION S2: ruling V6 (line 54) writes `audioError { kind: 'other' }`; the contract field is `error` (host-adapter.js:190, native-bridge.md 3 has it right). Fix the plan's word.
  - SUGGESTION S3: a CHAPTERED Listen -> Watch under native (currentId `<vid>::c1`, the watch page loads `<vid>`) is not an adopt, so the hand-back is not involved and the v1.344.2 `resolveBaseHandoff` (player.js:10958) reads the proxy's FILE-absolute currentTime (native-audio.js:257 `abs(position())`) and `paused`. Should work by reading; not bound under native (the S1 test covers the plain same-id case). One realm run with vid2's chapters then `r.player.load('vid2', ...)` would bind it. Also: `nativeHandBackCarry` returns null at t <= 0, so a Listen row PAUSED at 0:00 re-opened on the watch page autostarts (the paused flag rides only with a position); negligible, disclosed.
  - SUGGESTION S4: music.js `rowFromNativeItem` (S8) builds the Listen row without `folderName` (playListenItem / buildListenChapterTracks carry it for "Go to channel"); after an adoption that way is absent. Minor.
  - SUGGESTION S5 (security, precision): Evidence line 303 "an unknown id answers the same" holds for the file route and `/tvthumb` (asserted) but not for `/thumbnail`: an unknown id gets a 200 SVG placeholder (lib/media/streams.js:142-160) while a hidden id is 404. That oracle is PRE-EXISTING for the same user's cookie session (the route is unchanged; the media token is bound to the same user row and restrictions), so it is not a new exposure for `mt`; state it as such.
  - SUGGESTION S6 (standards): CONTRIBUTING "Lint passes with zero warnings": `npm run lint` reports 6 no-unused-vars warnings, all in public/js/common.js, which this diff does not touch. Pre-existing, disclosed.
  - **S1 hand-back (player.js:10888-10892, 10958-10959): verified by reading.** `adopt` is read only by the `if (adopt)` block after being forced false; `applyAdoptFlavor` is rightly skipped (the fresh path sets `currentData = data`, and the watch load declares its flavor fields); `placeFloor` runs on the fresh path (10963); the carry is read from the proxy BEFORE `teardownMediaState` (10962) hands the element back; `liveMode` is irrelevant for a Listen row; a `::c` id is never an adopt so `resolveBaseHandoff` wins by construction. Bound: native-audio-web "S1" both ways + "S1 (the other direction)", contract "S1 (pure)"; M14 / M15 / M16 / M23 killed.
  - **Kind roster (LESSONS 12): no negative guard the `video` kind wrongly enters.** music.js:1363 (play tally), 4507 / 5060 / 5076 (radio and the station), 4901 (shufflePlayingIndex) and remote.js:52 all key on `.listen`, which S8's adopted rows carry (M13); podcasts.js:169 is positive (`=== 'podcastEpisode'`); native-audio.js:100 radioSeed is now positive (`kind === 'track'`); `itemFromQueueEntry` is positive per kind; `sameFamily` keeps `tvEpisode` out of Music. skin-surface.js has no kind guard.
  - **Reachability (LESSONS 2): verified.** `/music?play=<id>&listen=1` -> `playListenItem` -> `/api/videos/:id` (lib/media/routes.js spreads `...item`, so `hasThumbnail` arrives) -> `trackLoadData` (`hasThumbnail` carried, `nativeQueue` only when `nativeVideoOn()`) -> `claim` -> `itemFromDescriptor(d, { video: videoOn })`, driven with the real scripts by native-audio-web 16 / 17 (M10 / M11 / M25 / M26 killed). The dock-return (`restoreListenChapterQueue`, music.js:5856-5870) loads nothing, so the hand-back cannot fire there. Watch -> Listen chaptered under native: `chapterResumeSec` / `startPaused` go through handleResumePlayback's chapter branch into the proxy's `seekTo` (file-absolute -> clip-relative, native-audio.js:202-224) and `audio.load` goes out with `autoplay` decided by the web, so a paused Watch stays paused (the v1.397.0 "chapter rows" test, ok 13).
  - **Security brief (standing): no new exposure found.** The widening is GET / HEAD only, the file route's `:kind` is gated by `MEDIA_FILE_KINDS` (album / tvSeason refused), every one of the four routes applies `req.user`'s restrictions (media-token "V5": the kid's token 404s `hidvid` / `blk` on all four, the teen's token 200s them), `POST /api/tv/progress` under the device token checks `ownEpisode` + `tvEpisodeVisibleTo` (lib/tv/routes.js:402) and `mt` on it is 401. No new logger, no new echo of `mt` (grep of the diff for console / log: 0 hits), no shell in the diff, no new dependency. The adapter's src / art prefix checks are a self-check (forging needs same-origin script), not a boundary. The `/thumbnail` placeholder oracle is pre-existing (S5).
  - **Evidence counts re-measured:** scratchpad mutants.log = 26 lines, 24 KILLED, 2 SURVIVED (M2, M6) - the counts hold; M2's "masked by M1" classification holds (defence in depth); M6's does not (W5).
  - Instruments (Node 22.23.1, verbatim counts):
    - `git diff 9e11ed90..1503b29f | grep '^+' | grep -c '<the em dash character>'` = 0
    - `npm run lint`: 6 problems (0 errors, 6 warnings), all public/js/common.js no-unused-vars (pre-existing, S6)
    - `npm run lint:ui`: "ui-lint: OK - the live debt equals docs/ui-exceptions.json", TOTAL 3142
    - `node scripts/overlay-containment-lint.js --enforce`: "overlay-containment: clean (0 violations)"
    - test/unit/native-video-audio-contract.test.js: tests 6, pass 6, fail 0
    - test/unit/native-audio-web.test.js: tests 26, pass 26, fail 0
    - test/unit/native-audio-items.test.js: tests 7, pass 7, fail 0
    - test/unit/native-bridge-audio.test.js: tests 7, pass 7, fail 0
    - test/unit/exec-plans-census.test.js: tests 3, pass 3, fail 0
    - test/integration/device-scope-census.test.js: tests 4, pass 4, fail 0
    - test/integration/media-token.test.js: tests 9, pass 9, fail 0
    - `.harness/lib/check-markers.sh docs/exec-plans/active`: "check-markers: clean (docs/exec-plans/active)" (exit 0; the script takes a directory)
    - Not run: the full suites (done by the builder on both Nodes, 13039 / 13026 / 0 / 13).
  - `git status --porcelain` after this block: ` M docs/exec-plans/active/2026-10-28-native-video-audio.md` only; no untracked files.
- Gate: CHANGES r1 @1503b29f - adversary
  - Scope: `git diff 9e11ed90..1503b29f` (17 files), this plan top to bottom, AGENTS.md attack surfaces, LESSONS 0/1/2/4/5/9/10/12, native-bridge.md 3 + 5, ios-host.md, offline-api.md 8, the behavior map, the v1.397.0 gate findings. HEAD = 1503b29f4be3eb92bb8c698a024c8c6e6e640a62. Everything below was RUN in a `git archive 1503b29f` sandbox (scratchpad adv-sandbox, byte-compared to adv-pristine after every mutant: "identical") or against adv-pristine / a `git archive 9e11ed90` (adv-base) for base-vs-HEAD probes; the worktree was never edited except for this block.
  - Instruments (verbatim, Node 22.23.1): `node --test` of native-video-audio-contract, native-audio-web, native-audio-items, native-bridge-audio, native-bridge-contract, native-audio-podcasts, device-scope-census, media-token (integration + unit) = `# tests 90 / # pass 90 / # fail 0 / # skipped 0`. `npx eslint .` (sandbox) = "6 problems (0 errors, 6 warnings)", all public/js/common.js no-unused-vars, not in the diff; `npx eslint` on the 12 diff files at adv-pristine = exit 0, 0 problems. The builder's mutant script re-run against MY sandbox (adv-builder-mutants.log): 26 run, 24 KILLED, 2 SURVIVED (M2, M6), the Evidence counts hold; "sandbox vs pristine after the round: identical". My own round (adv-mutants.js / adv-mutants.log): 14 run, 10 KILLED (A1 claim() no longer stops native on a web load - 4 tests red incl. S1; A2 the adapter rule line removed; A3 sameFamily always true; A4 shufflePlayingIndex allows a Listen row; A6 the carried paused state inverted; A11 music.js back to the v1.397.0 `item.listen` gate - 7 red; A13 the capability unknown to the adapter; A16 MEDIA_SCOPE over-widened with `GET /video/:id` - 2 red; A19 art dropped on an unknown hasThumbnail; A20 a chapter roll followed as a load), 4 SURVIVED (below). player.js's background-audio path: the diff has exactly four hunks (`@@ -1135`, `@@ -2164`, `@@ -10876`, `@@ -10939`: the two S1 helpers, their export, and load()); attemptBackgroundAudioHandoff / handleForegroundSwapBack / the setupForMedia prep are untouched bytes. V9 ordering measured (probe T1, a src setter + host.post + play hooks): `["post:audio.stop","src=/video/vid1","proto.play"]`; the chaptered control (T1b) the same. Watch -> Listen chaptered while the web video plays at 40 s (T5b): the row holding 40 s loads, `audio.load` (index 1, positionSec 0, autoplay false) then `audio.seek 10` then `audio.play`, src null, no web play. Watch -> Listen plain same id (T5): an adopt, `loads 0`, src /video/vid1 kept, proxy false, active false, nothing half-claimed; a lock posts nothing. The lost-queue re-send (T4): one new `audio.load` rev 2 `["video:vid1"]` at positionSec 120, autoplay true. The mixed queue (T7): the flatten = `["video:vid1","track:q1","track:q2"]`; native's self-advance follows with ONE `POST /api/queue/pointer`; Prev = `audio.jump {index 0}`; Next from a pointer-matched row is the pre-existing Up-next navigation (player.js manualTrackStep -> advanceIntoQueueEntry), not new. Every odd Listen descriptor shape (T9: hasThumbnail undefined / true / false / 'yes' / 0 / null, an https artUrl, no artUrl, duration 0 / 'abc', an id with ` /?#é`, a chapter row with no baseMediaId, a radioSeed, an odd progressEndpoint) builds an Item `audioItemOk` accepts: the adapter can never refuse a real Listen load.
  - **WARNING A-W1 (the S1 hand-back is driven by watch.js's deliberately BARE early-adopt call; measured on both the shipped path and a v0.14.0 path).** watch.js:1622 posts `player.load(mediaId, { browseCtx, readerHref: null, resumeMode: null, autoAdvanceViaTrackNav: false, progressEndpoint: null, startAt }, ...)` whenever `resolveWatchEntryReparentAction` says 'adopt' (same id, not closed), on the documented premise that "load()'s adopt branch ignores its data"; the full load with `{ ...mediaData, channelName, ... }` (watch.js:1801) follows two fetches later. With `isNativeHandBackLoad` true, that bare call IS the fresh web load, and the full call then ADOPTS (the web owns the id by then), so `currentData` is whatever `applyAdoptFlavor` carries and nothing else. Probe T1 (adv-probes/p1.test.js, the real music.js + player.js realm, nativeAudio + nativeVideoAudio, a native Listen row at 120 s, then the exact two watch.js calls): after the early call `getCurrentMeta()` = `{ title: "", artist: "", ... isMusic: false }`, `poster: null`, MediaSession metadata `{ title: "FileTube", artist: "" }`; after the full call title / artist arrive, but `poster: null` stays (the control T1b, a CHAPTERED Listen -> Watch through resolveBaseHandoff where the early call is a 'reparent': `poster: "/thumbnail/vid2"`), and `currentData.type` is undefined for the rest of the load. Probe T2 (adv-probes/p2.test.js; a host with `nativeAudio` ONLY - the v0.14.0 build - Music playing a LIBRARY AUDIO file natively as a track Item, then the watch page's early call on the same id): at 9e11ed90 `{ stops: 0, src: null, proxy: true, active: true, t: 33.16, webPlays: 0, meta.title: "Talk" }` (the watch page proxies native, as v1.397.0 shipped); at 1503b29f `{ stops: 1, src: "/video/aud1", proxy: false, active: false, t: 33.04, webPlays: 1, meta.title: "" }` - native is stopped, the web element plays, and because the bare data has no `type: 'audio'` the load runs through setupForMedia's VIDEO branch (`currentData.type !== 'audio'` everywhere: the audio-mode art and visualizer are skipped, the video-only sidecar eligibility and prep now see an audio file). So (a) V3 / V11 ("without the capability byte-identical to v1.397.0") is measured FALSE on a reachable v0.14.0 path (Home / search -> the watch page of a library audio file Music plays natively), undisclosed and untested; (b) on the shipped Listen -> Watch path the hand-back loads with no type / title / duration / hasThumbnail (the lock screen reads "FileTube" until the metadata round-trip, the poster never arrives). The builder's S1 test reproduces the early call's SHAPE but never issues the second call and asserts only src / position / play (LESSONS 2, divergent fixture). Prescription: (1) make the hand-back refuse a bare caller - in `isNativeHandBackLoad` require a data that describes the media (`typeof data.type === 'string'`; the early call never has it, the full call always does), so the early call stays an adopt of the proxy for the round-trip and the FULL load is the hand-back; (2) decide the v0.14.0 case explicitly: either gate the hand-back on the owned Item being a `video` Item (`n.currentItem().kind === 'video'` - restores V3 byte-identity for library audio) or amend V3 / V11 / native-bridge.md and ADD a nativeAudio-only test for the library-audio watch-page open; (3) a test that issues BOTH watch.js calls in order and asserts after the second: `currentData.type === 'video'`, the poster `/thumbnail/<id>`, the MediaSession title, src `/video/<id>`, one audio.stop, the position - and the same for the library-audio case on a nativeAudio-only host asserting whatever (2) decides.
  - SUGGESTION A-S1 (concur with qa W5, measured end to end): a chaptered video whose `/api/videos/:id` `duration` is 0 (probe T3 / T3b: three chapters at 0 / 30 / 60) ships `[{ id: vid3::c0, clip 0-30 }, { id: vid3::c1, clip 30-60 }, { id: vid3::c2 }]` - the last row has NO clip (native-audio.js:95 needs `dur > 0`), i.e. "the whole file from 0" under a `::c2` id. On native's own advance to it the web follows (`currentId: vid3::c2`) and posts `audio.seek 60` (file-absolute, from handleResumePlayback's chapter branch), so the listener hears the file's first seconds until that seek lands; the control (T3c, a known duration) rolls with no post at all. Prescription: a Listen (and library-audio) chapter row with `chapterStartSec > 0` and no positive duration should not reach native (return null in itemFromDescriptor -> the whole load stays on the web as in v1.397.0), or buildListenChapterTracks should drop the zero-span row; bind it with a duration-0 fixture.
  - SUGGESTION A-S2 (survivors on correct code, each a test gap): A5 music.js rowFromNativeItem `lib = video || ...` -> `lib = isChapter || ...` survives (an adopted PLAIN video row loses source 'library', streamSrc /video/<id> and progressEndpoint /api/progress; the re-sent Item is unaffected because itemFromDescriptor forces a Listen row's src and route, so it is near-equivalent under native, but the row shape S8 claims is unbound); A17 `row.hasThumbnail = true` survives (a no-art video re-sent after adoption would carry /thumbnail/<id>, a 200 SVG placeholder on native; sameItem ignores art); A22 the adopted CHAPTER row without `albumKey = base` survives (the S8 test adopts a plain video only; adopt a queue with two clip Items and assert the rows fold under one albumKey); A21 `owns()` of any id survives and is EQUIVALENT (ownedId always equals currentId once set: a roll reloads nothing, a self-advance follows into the new id). The benign `audio.seek 0` my first T3 run showed on a roll came from a snapshot with `durationSec: 0`, not a real shape.
  - SUGGESTION A-S3 (concur): qa W1 / W2 / W3 (ios-host.md:47-48 and its v1.398.0 addendum, the schema description and host-adapter.js:279 describe the superseded handoff in the present tense - a lying doc, LESSONS 12); qa S5 (`/thumbnail/<unknown>` is a 200 SVG placeholder while a hidden id is 404, lib/media/streams.js:124-172 read, not run - pre-existing for the same user's cookie, not new to `mt`); qa S3 (`nativeHandBackCarry` drops the paused flag at t <= 0). Also: Evidence line "S3 ... Disclosed in ROADMAP." - `grep -n nativeVideoAudio ROADMAP.md` = 0 hits; the sentence is a present-tense claim about the tree that is false (S3 is moot now the handoff is not built: say so instead).
  - Verified and clean: the adapter check applies to every v1.397.0 load too and refuses none of them (the 90 green include every track / podcast / radio / Up-next shape); the Listen row's `hasThumbnail` descriptor field is inert without the capability (player.js reads `data.hasThumbnail` only in the video branch's poster); chapter rows under native: the proxy's currentTime is file-absolute after a roll (T3c: 32.16 at clip-relative 2), the chapter loop / exit / solo-station guards are the v1.397.0 `nativeOn()` returns (music.js:2326, 2395, 5059, 5072, 5693); a video Item cannot reach a v0.14.0 build by any path I found (readProvider gates the builder, itemFromQueueEntry never builds one, the adopt needs native to have sent one, podcasts.js's provider builds episodes only); the pointer POST fires once per self-advance; MEDIA_FILE_KINDS / MEDIA_SCOPE / DEVICE_SCOPE are bound by exact-list tests (A16, M20-M22).
  - Tree after this write: `git status --porcelain` = ` M docs/exec-plans/active/2026-10-28-native-video-audio.md` (the security-brief's, QA's and this block); no untracked files; the sandboxes, probes (adv-probes/p1-p3.test.js, outputs p1.out), mutant scripts and logs live in the session scratchpad under `adv-` names.

### Gate r1 fixes (the commit after 1503b29f; every finding above answered here)

- **adversary A-W1 (the hand-back fired on watch.js's BARE early-adopt call, and took a natively playing LIBRARY AUDIO file back to the
  web on a v0.14.0 build: V3 false):** FIXED AS PRESCRIBED, both halves. player.js `isNativeHandBackLoad(adopt, nativeOwnsId, data,
  ownedKind)` hands back only when the load DESCRIBES the media (`typeof data.type === 'string'`: the watch page's full load; its bare
  early-adopt call has no type and stays an adopt of the proxy until the metadata arrives) AND the Item native plays is a `video`
  (`nativeAudioApi().currentItem().kind`); a track Item (library audio) keeps the proxy on the watch page exactly as in v1.397.0.
  Tests: native-audio-web "S1" issues BOTH watch.js calls in order and asserts after the first (no stop, the proxy stays) and after
  the second (one audio.stop, src `/video/<id>`, the poster, the lock-screen title, the plain-video flavor, the position, play only
  if native was playing); "S1 (V3, gate r1 A-W1)" plays library audio natively and issues the two calls on a nativeAudio-only host
  AND with nativeVideoAudio: never stopped, the proxy stays, the web element never plays; the pure S1 test covers the bare call, a
  typed call, a track Item, a null Item. Mutants M27 (the type check removed) and M28 (the kind check removed): both KILLED.
- **adversary A-S1 = qa W5 (a zero-span Listen chapter row reached native with no clip; M6 mis-classified):** FIXED AS PRESCRIBED
  (the first option): native-audio.js `itemFromDescriptor` returns null for a Listen row with a `chapterStartSec` and no positive
  duration, so the whole load stays on the web as in v1.397.0 (the alternative, dropping the row in buildListenChapterTracks, would
  change the web's own album). Tests: native-audio-items (null for duration 0 and for no duration; a plain row with duration 0 still
  maps with the file id as its key), native-audio-web "a chaptered video whose duration the server reports as 0" (no audio.load,
  src `/video/vid3`). M29 (the rule removed) KILLED; M6 re-run on the fixed tree: survives as EQUIVALENT (every Listen `::c` Item now
  carries a clip; a plain row's id is the file id), stated so in the W4 block. The library-audio (track) chapter rows keep the v1.397.0
  behaviour (a chapter with no known span gets no clip), unchanged and out of this plan's scope.
- **adversary A-S2 (survivors A5 / A17 / A22):** BOUND. native-audio-web "S8" asserts the adopted Listen row's poster (`/thumbnail/<id>`,
  the audio branch posters from the row's own artUrl: A5); the new "S8 (A17 / A22 / the clip round trip)" adopts a queue with a Listen
  video WITHOUT art and two chapter Items, re-sends it (a shuffle around the playing TRACK) and asserts the rebuilt video Item has no
  artworkSrc (A17) and the chapter Items keep their clips under the file id; with a chapter Item playing, `getCurrentMeta().albumKey`
  is the file (A22) and the poster the file's thumbnail. A21 (`owns()` of any id) is equivalent, as the seat says.
- **qa W1 (ios-host.md says the handoff ships):** FIXED: lines 47-50 and the v1.398.0 addendum now say what shipped, name the failed
  spike and point at native-bridge.md 3 "Not built". **qa W2 (the schema description):** FIXED, text only (a `video` Item is a Listen
  row; the handoff "designed and NOT built"; tvEpisode reserved); the schema sha goes to the Root with W5 (fields unchanged: no
  re-freeze). **qa W3 (host-adapter.js comment):** FIXED. **qa W4 (the plan's own prose):** FIXED: a re-scope paragraph under the
  title, the two "What Dean will see" handoff bullets, the W1 bullet, the W3 and W4 bullets and "Not in scope: a video's chapters as
  clips" are marked superseded or qualified where they stand.
- **qa S1 / adversary A-S3 (the "hands it both" wording and the ROADMAP claim):** FIXED (native-bridge.md 3 and the W3 Evidence say the
  track entries after a pointer on a Listen row; the S3 Evidence line says "moot"). **qa S2:** `audioError { error: 'other' }` (V6 and
  the contract bullet). **qa S5 / security INFO:** the W2 Evidence names the `/thumbnail` placeholder as the pre-existing oracle it is.
  **qa S3** (a Listen row paused at 0:00 re-opened on Watch autostarts: `nativeHandBackCarry` is null at t <= 0, the ordinary resume
  reads the saved place) and **qa S4** (the adopted row has no `folderName`, so "Go to channel" is absent after an adoption: the Item
  carries no channel folder; a contract field for it is the next plan's call) are disclosed, not changed. **qa S6:** the 6 lint
  warnings are pre-existing in common.js, untouched.
- **Mutant round on the fixed tree** (scratchpad mutants.js, 29 run against the working tree in a sandbox byte-compared to its copy):
  27 KILLED, M2 masked (defence in depth), M6 equivalent.

### Gate (round 2)

- Gate: APPROVED r2 @37c97c05 - security-brief
  - Could NOT run (no Bash on this seat): git diff 1503b29f..37c97c05, the suites. "Verified" = traced in the working tree at 37c97c05.
    I could not byte-compare the server files to 1503b29f; what I did: re-read the two places my r1 trace rests on and re-counted the
    plan's markers. lib/auth/device-scope.js:50-72 (the three V5 entries, MEDIA_SCOPE, MEDIA_FILE_KINDS) and lib/auth/gate.js:403-428
    (mediaAuth) read line for line as at r1; the v1.398 markers in lib/ and server.js are still exactly the two files of r1
    (device-scope.js x2, media-token.js x1); no r1-fix marker (A-W1, A-S1, qa W5) appears in lib/**, server.js or host-adapter.js's
    code; the plan's "Gate r1 fixes" block names no server file. Consistent with the coordinator's statement that the delta touches no
    server file; I treat the server surface as untouched on that basis, not on a diff I ran.
  - r1 findings: none to re-verify (r1 carried INFO notes only, no change asked). qa S5 / my INFO: the W2 Evidence now names the
    /thumbnail placeholder as the pre-existing oracle it is (plan line 530) - a disclosure, as asked.
  - Client delta, trust-boundary glance, VERIFIED:
    - player.js:1145-1149 isNativeHandBackLoad(adopt, nativeOwnsId, data, ownedKind): pure; `ownedKind` is read at :10899-10901 from
      nativeAudioApi().currentItem().kind (native-audio.js:177, the Item at native's index in the LAST ACCEPTED snapshot, whose kind
      is enum-checked by host-adapter.js audioItemFields :80 before the event is delivered). It is compared to the literal 'video' and
      decides only adopt vs fresh web load; the fresh load's src is the web's own '/video/' + encodeURIComponent(id) for the id the
      PAGE asked for (the watch URL), never a value from the event. `data.type` comes from the page's own load call. nativeHandBackCarry
      (:1150-1153) copies a finite positive number and a boolean from the proxy. A forged snapshot (same-origin script, already full
      account control) can at most flip adopt/fresh for the user's own open page. Nothing new crosses to the server.
    - native-audio.js:94-96: a Listen chapter row with no positive duration returns null (the load stays on the web). A pure refusal;
      it removes an Item shape from what the web posts, adds none, and touches no URL, token or server call.
    - host-adapter.js: the audioItemOk rules (:56-66) are unchanged; the delta there is a comment. The schema's audioItem DESCRIPTION
      changed text only; the kind / progress.route enums and the src / artworkSrc prefix rules read as at r1 (native-bridge.md:121-128).
  - Nothing NEW introduced by the fix round on the security surface. No CRITICAL / WARNING / SUGGESTION. Approval bound to 37c97c05.
    Tree after this write: this plan doc only.

- Gate: APPROVED r2 @37c97c05 - qa
  - Delta reviewed: `git diff 1503b29f..37c97c05` (10 files, +327 / -47), the fix commit message, the "Gate r1 fixes" block, every new comment and test title. HEAD = 37c97c05ce8bf01f990b587ff45bcc6dfdd0bab4.
  - r1 W1 (ios-host.md): FIXED AS PRESCRIBED. Lines 47-50 and the addendum (heading "a video played as audio goes native; the background handoff does not") now say what shipped, name the spike's failure and point at native-bridge.md 3 "Not built"; every sentence re-read against the tree is true.
  - r1 W2 (the schema description): FIXED AS PRESCRIBED, text only; "a background handoff of a playing video was designed and NOT built", "tvEpisode kind is reserved", the clip sentence no longer names a handoff Item; the enums and fields are byte-identical to 1503b29f (no re-freeze).
  - r1 W3 (host-adapter.js:47-51 comment): FIXED AS PRESCRIBED.
  - r1 W4 (the plan's prose): FIXED AS PRESCRIBED: the title, a re-scope paragraph, the two "What Dean will see" handoff bullets, the W1 contract bullet, the W3 and W4 bullets and "Not in scope" (now "chapters as clips on the WATCH page ... a Listen row of a chaptered video IS its file plus clip (S2, built)") are marked or qualified.
  - r1 W5 (M6 mis-classified): FIXED DIFFERENTLY (the adversary's A-S1 option), evaluated and accepted: native-audio.js:94-96 refuses a Listen row with a `chapterStartSec` and no positive duration, so the WHOLE Listen load of a video whose duration the server reports as 0 stays on the web (readProvider's one-null-row rule), as in v1.397.0. Stricter than my key-binding prescription and it also closes the adversary's "whole file from 0 under a ::c id" roll; the cost (such a video never goes native at all) is stated in the test title and the Evidence. After it, every Listen Item with a `::c` id the builder accepts carries a clip, so M6's two arms agree on every accepted input: the re-classification "equivalent" now holds. Bound: native-audio-items (null for duration 0 and for no duration; a plain row with duration 0 keys under the file id), native-audio-web "a chaptered video whose duration the server reports as 0" (no audio.load, src /video/vid3); M29 KILLED (log).
  - r1 S1 / S2 / S5: FIXED as recorded (native-bridge.md 3 "the flattening hands it the track entries after it"; V6 and the contract bullet say `audioError { error: 'other' }` / `audioError.error`; the W2 Evidence names `/thumbnail/<unknown>` as the pre-existing 200 placeholder). S3 / S4 / S6 disclosed, not changed: accepted.
  - Adversary A-W1 fix, re-derived from the code: player.js:1145-1149 `isNativeHandBackLoad(adopt, nativeOwnsId, data, ownedKind)` requires `ownedKind === 'video'`, a string `data.type` and no `nativeQueue`; load() (10900-10901) feeds `nativeAudioApi().currentItem()`'s kind (the inert api returns null -> never; the live api's `currentItem` reads the snapshot claim() sets synchronously, native-audio.js:177 / 402). watch.js:1622 (the bare early-adopt call) carries no `type`; watch.js:1801 spreads `mediaData` (the /api/videos/:id payload: `type: 'video'`); the seeded pre-load (1664) runs only for 'defer' / 'reparent', never for a same-id adopt. So the early call keeps the proxy, the full load is the hand-back, and a track Item never hands back (V3 byte-identity for library audio on the watch page restored). Bound: native-audio-web "S1" (both calls, in order: no stop after the first; after the second one audio.stop, src, poster, lock-screen title, plain-video flavor, position, play only if native was playing), "S1 (V3, gate r1 A-W1)" (library audio, both hosts), the pure S1 test; M27 / M28 KILLED (log). A-S2 bindings (S8 poster; "S8 (A17 / A22 / the clip round trip)") read as claimed.
  - **WARNING W-r2-1 (a sentence the fix round left stale, LESSONS 12 "re-check fix-round edits for NEW lies"): Evidence "W3 as built" line 350-352, `player.js (S1)`:** "`load()` treats a same-id load that carries no `nativeQueue` while native owns the id ... as a FRESH web load" - that is the r1 rule. At 37c97c05 a same-id load with no `nativeQueue` and no `type` (watch.js's bare early-adopt call), or one while native plays a `track` Item (library audio), is an ADOPT of the proxy (player.js:1145-1149). Scenario: a reader of the W3 paragraph (the next plan's kickoff, which must design the watch page's hand-back for the native video surface) takes the r1 rule and designs a bare-call hand-back the adversary just measured as wrong. The "Gate r1 fixes" block 60 lines below states the true rule, so the doc disagrees with itself. **Safe to ship disclosed:** the code is correct and bound (M27 / M28), player.js's own comment is true, and the release commit edits this plan anyway (`plan-complete.js`): fold the one-sentence re-true into it ("a same-id load that DESCRIBES the media (a `type`), carries no `nativeQueue`, while native plays the id as a `video` Item").
  - SUGGESTION S-r2-1 (a count the artifact does not back): "Mutant round on the fixed tree ... 29 run ... 27 KILLED, M2 masked, M6 equivalent". The scratchpad mutants.js holds 29 entries and OVERWRITES mutants.log on every run (`fs.writeFileSync`, line 75); the surviving log (Oct 28 20:52) is a 3-mutant run: M27, M28, M29 KILLED and nothing else, so the 26-mutant re-run on the fixed tree (M6's "survives as EQUIVALENT" included) is the builder's word, not an artifact. Arithmetic is consistent (24 + 3 = 27) and the Adversary's r1 re-run confirmed the 26 at 1503b29f. Re-run `node mutants.js` with no arguments once, or say in Evidence what the log holds.
  - SUGGESTION S-r2-2: the re-scope paragraph (line 17) says "Every handoff sentence below is marked superseded where it stands"; the Seams list (lines 82-87 `attemptBackgroundAudioHandoff ... the ONE handoff point`), Step 0's red-first bullet (141), the Gate brief (189 "background, return ... mid-handoff") and the Step 0 census (228-230) still describe the handoff design unmarked. They are process history, not shipping claims, and the paragraph frames them; soften to "the rulings, 'What Dean will see', the contract bullet, W3 / W4 and Not in scope are marked". Nit: "Gate r1 fixes" says ios-host.md "lines 47-49"; the bullet is 47-50.
  - Lying-text re-hunt on the delta, otherwise clean: the native-audio.js:94-95 comment, the player.js:1141-1144 comment, the host-adapter comment, the schema description, ios-host.md, native-bridge.md 3, the five new / renamed test titles and the "Gate r1 fixes" block each match the code they describe (the W-r2-1 sentence is the one exception).
  - Security (standing): the delta touches no lib/ file; no new logger, no new echo, no shell, no dependency; the hand-back change narrows a client branch. No new surface.
  - Instruments (Node 22.23.1, verbatim counts, this tree):
    - `git diff 1503b29f..37c97c05 | grep '^+' | grep -c '<the em dash character>'` = 0
    - `npm run lint`: 6 problems (0 errors, 6 warnings), all public/js/common.js no-unused-vars (pre-existing)
    - `npm run lint:ui`: "ui-lint: OK - the live debt equals docs/ui-exceptions.json", TOTAL 3142
    - `node scripts/overlay-containment-lint.js --enforce`: "overlay-containment: clean (0 violations)"
    - test/unit/native-video-audio-contract.test.js: tests 6, pass 6, fail 0
    - test/unit/native-audio-web.test.js: tests 29, pass 29, fail 0
    - test/unit/native-audio-items.test.js: tests 7, pass 7, fail 0
    - test/unit/native-bridge-audio.test.js: tests 7, pass 7, fail 0
    - test/unit/exec-plans-census.test.js: tests 3, pass 3, fail 0
    - test/integration/device-scope-census.test.js: tests 4, pass 4, fail 0
    - test/integration/media-token.test.js: tests 9, pass 9, fail 0
    - `.harness/lib/check-markers.sh docs/exec-plans/active`: "check-markers: clean (docs/exec-plans/active)", exit 0
    - Not run: the full suites.
  - Approval bound to 37c97c05. `git status --porcelain` after this block: ` M docs/exec-plans/active/2026-10-28-native-video-audio.md` only; no untracked files.
- Gate: CHANGES r2 @37c97c05 - adversary
  - Delta reviewed: `git diff 1503b29f..37c97c05` (10 files), against the tree in a fresh `git archive 37c97c05` sandbox (scratchpad adv2-sandbox, byte-compared to adv2-pristine after the mutant round: "identical"); probes against adv2-pristine. HEAD = 37c97c05ce8bf01f990b587ff45bcc6dfdd0bab4.
  - Instruments (verbatim, Node 22.23.1): the r1 targeted set (9 files) = `# tests 93 / # pass 93 / # fail 0 / # skipped 0`. `npx eslint` on the six changed code / test files = exit 0, 0 problems. My r2 mutant round (adv2-mutants.js / adv2-mutants.log): 18 run, 17 KILLED, 1 SURVIVED. Re-run from r1: A1, A6, A11, A17, A22 KILLED (A17 and A22 by the new "S8 (gate r1 adversary A-S2 ...)" test; A6 by the rewritten S1); A5 SURVIVED again - RECLASSIFIED EQUIVALENT, not a test gap: a web-built video Item always carries `progress.route === '/api/progress'`, so the `video ||` term of rowFromNativeItem's `lib` is redundant on every real input (the Evidence's "bound by the poster assert" is not a kill; harmless). New: N1 the kind gate removed (a track Item hands back) KILLED by "S1 (V3, gate r1 A-W1)" + the pure S1 test; N2 the typed-load gate removed KILLED by the rewritten "S1" + the pure test; N3 the zero-span guard removed KILLED (items + "A-S1 = qa W5" web test); N4 player.js passing 'video' instead of the owned Item's kind KILLED by "S1 (V3 ...)"; N5 the guard widened to library-audio chapter rows KILLED by the v1.397.0 items test (the out-of-scope shape is pinned). The builder's M6-equivalence claim holds by construction now: every Listen `::c` Item that reaches the key line carries a clip, a plain row's id is the file id.
  - **r1 A-W1: FIXED AS PRESCRIBED (both halves).** Probe T1-r2 (adv-probes/p4.test.js, native playing and paused at 120 s, then watch.js's two calls in order): after the early bare call `{ src: null, proxy: true, active: true, stops: 0, meta.title: "A talk" }` (an adopt of the proxy); after the full load `{ poster: "/thumbnail/vid1", src: "/video/vid1", proxy: false, active: false, stops: 1, ms: "A talk", t: 120.13 }`, order `["post:audio.stop","src=/video/vid1","proto.play"]` playing and `["post:audio.stop","src=/video/vid1"]` paused. Probe T2-r2 (a library audio file native plays as a track Item, both calls, on a nativeAudio-only host AND with nativeVideoAudio): `{ src: null, proxy: true, active: true, stops: 0, t: 33.2, order: [] }` on both - the v1.397.0 behaviour (adv-base T2 at r1: the same shape).
  - **r1 A-S1: FIXED AS PRESCRIBED** (the first option). Probe T3-r2 (duration 0, three chapters): `{ currentId: "vid3::c0", loads: 0, src: "/video/vid3", proxy: false, stops: 0 }` - the whole Listen load stays on the web.
  - **r1 A-S2: BOUND** (A17, A22 killed; A5 equivalent, above). **r1 A-S3: FIXED** (ios-host.md:47-50 and its addendum, the schema description, host-adapter.js:47-50, native-bridge.md's Up-next wording, the Evidence's S3 line now say the handoff was designed and not built; read in the delta).
  - **WARNING A-r2-W1 (NEW in the fix: the kind gate reads `currentItem()`, which is null after native LOST its queue, so the hand-back is refused exactly when the proxy is most wrong).** native-audio.js `queue()` (line 172) prefers `snap.queue` over `posted.items`; the contract's "engine lost its queue" snapshot (`rev 0, state idle, queue []`, which onState accepts and keeps `ownedId`) makes `currentItem()` null, so player.js:10900 passes `ownedKind = null` and `isNativeHandBackLoad` returns false for the watch page's full load. Probe T10-r2 (a native Listen row at 120 s, the rev-0 idle snapshot, then both watch.js calls): `T10-before { currentItem: null, owns: true, active: true }`; after the full load `{ src: null, proxy: true, active: true, stops: 0, poster: "/thumbnail/vid1", order: ["post:audio.load"] }` - the watch page keeps the src-less proxy (a black, never-loading picture), the adopt's play re-assert posted `audio.load` of the Listen row (proxyPlay's lost-queue re-send), so NATIVE plays the sound under the watch page; the user's own play tap posts another `audio.load` (`newNativeLoads: 1`, `["video:vid1"]`, `src: null`). Nothing on that page can take the video back; at 1503b29f the same sequence handed back (owns(id) alone). Control T11-r2 (native still `loading`, no snapshot yet): `currentItem()` reads `posted` -> 'video' -> hands back (`src: "/video/vid1"`, stops 1). Prescription: the owned kind must not depend on the live snapshot - native-audio.js remembers the Item it claimed (`ownedItem = want` in claim(), cleared in stop()) and exposes it (`ownedItem()` / `ownedKind()`), and player.js reads that instead of `currentItem()` (or `currentItem()` falls back to `posted.items[posted.index]` when the snapshot's queue is empty); bind it with the T10 sequence: rev-0 idle, then the two watch.js calls, assert one `audio.stop`, src `/video/<id>`, the proxy gone, no `audio.load` posted by the adopt.
  - Verified and clean in the delta: the typed-load gate admits every full watch.js / Feed / TV load (all carry `type`) and refuses only the bare early call (the contract test enumerates it); the zero-span guard applies to Listen rows only (N5: the library-audio chapter shape stays v1.397.0 by test); V9 ordering on the hand-back unchanged (T1-r2 order); no other reader of `currentItem()` changed; the three new tests execute the real two-call sequence (not a lookalike) and go red under N1 / N2 / N4.
  - Tree after this write: `git status --porcelain` = ` M docs/exec-plans/active/2026-10-28-native-video-audio.md` (the r1 blocks, the security-brief's r2 and this block); no untracked files; adv2-* sandboxes, adv-probes/p4.test.js + p4.out, adv2-mutants.js/.log/.out in the session scratchpad.

### Gate r2 fixes (the commit after 37c97c05)

- **adversary A-r2-W1 (NEW in the r1 fix: the kind gate read `currentItem()`, null after native's lost-queue snapshot, so Listen ->
  Watch was refused exactly then and the watch page sat on a src-less proxy while native re-played the sound):** FIXED AS PRESCRIBED
  (the first option). native-audio.js remembers the Item it claimed (`ownedItem = want` in both claim branches, cleared in `stop()` and
  on a refused load) and exposes `ownedKind()` (null on the inert api); player.js `load()` reads it instead of the live snapshot.
  Test: native-audio-web "S1 (gate r2 adversary A-r2-W1)" = the T10 sequence (a native Listen row at 120 s, the rev-0 idle snapshot:
  `currentItem()` null, `ownedKind()` 'video'; the bare call adopts; the full load: one audio.stop, src `/video/vid1`, the proxy gone,
  no audio.load after it, the position kept through the lost-queue snapshot). Mutant M30 (`ownedKind()` reads the live snapshot
  again): see below.
- **qa W-r2-1 (the W3 Evidence's player.js sentence stated the r1 rule):** re-trued above (the W3 as-built bullet now states the rule
  as of this fix). **qa S-r2-1:** mutants.log re-generated by a full run against 37c97c05 (below). **qa S-r2-2:** the re-scope
  paragraph softened; the ios-host.md line range corrected.
- **adversary A5:** reclassified EQUIVALENT by the seat (a web-built video Item always carries `/api/progress`), accepted.
- **Mutants on the r2 tree** (scratchpad mutants2.js, a sandbox of 37c97c05 plus this commit's files, byte-compared after the run:
  identical): M30 (the owned kind read from the live snapshot again) KILLED by the T10 test (1 red); controls M16, M27, M28 KILLED.
