---
plan: native-video-audio
harness: v2 · full
branch: feat/v1.398.0-native-video-audio
anchor: spec
status: Ready to build
next: Step 0 (census, the iOS Root's background-start spike result, red first)
design: Approved 2026-10-28 (Dean picked "Native audio" for video over a full native player and the web-only fix)
gate: not started
builder: extreme
---

# v1.398.0 - a video's sound moves to the iPhone app's native player when the app goes to the background

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
- A video playing on the phone keeps playing as sound when he locks the phone or switches apps. The lock screen and
  AirPods pause and resume it, like a song.
- When he comes back, the video picks up where the sound is, playing only if the sound was playing.
- Listen rows (a video played as audio) play through the native engine, like a song.
- Nothing changes on screen: chapters, scrubbing, subtitles and the skins all stay the web's.

## Rulings (settled - do not reopen)

| # | Ruling | Source |
|---|---|---|
| V1 | Video's AUDIO goes native through the existing `audio.*` engine. No native video player, no PiP, no new `video.*` messages. | Dean 2026-10-28 |
| V2 | Two entry points. (a) THE BACKGROUND HANDOFF: exactly where `attemptBackgroundAudioHandoff` hands a video to the `bgAudioEl` sidecar today, with the same eligibility (Background audio setting on, mobile, playing or the iOS pre-pause candidate, not native fullscreen or PiP), it hands to native instead. (b) LISTEN ROWS: a Listen row (`item.listen`, a video played as audio) loads into native as a `video` Item. Everything else on the stand-down list stays on the web (Feed, read-aloud, a watch-page item while it's on screen). | Root, from V1 |
| V3 | A new capability **`nativeVideoAudio`**, add-only in bridge v1. The app announces it, alongside `nativeAudio`, only when its engine accepts the two new kinds. Without it, the web is byte-identical to v1.397.0: the sidecar, and Listen rows on the web element. v0.14.0 builds announce `nativeAudio` only and never see a video Item. | Root + iOS Root |
| V4 | The Item gains two kinds, `video` and `tvEpisode`, with fixed prefixes. **src**: exactly `/api/offline/file/video/<id>` or `/api/offline/file/tvEpisode/<id>` (the iOS-playable rendition the downloads already use). **artworkSrc**: `/thumbnail/<id>` (only when the item has a thumbnail, otherwise omitted) or `/tvthumb/<id>`. **progress**: `{ route: '/api/progress', key: <video id> }` or `{ route: '/api/tv/progress', key: <episode id> }`, the same `{id, timestamp, duration}` body native posts today. No `radioSeed`, no plays, no `clip`: a handoff Item is the whole file, and a video's chapters stay a web concept. | Root |
| V5 | Server. The media token's file kinds (`MEDIA_FILE_KINDS`) gain `video` and `tvEpisode`. `MEDIA_SCOPE` gains `GET /thumbnail/:id` and `GET /tvthumb/:id`. `DEVICE_SCOPE` gains `POST /api/tv/progress` (`POST /api/progress` is already in). RBAC is as for a browser: a restricted user's phone still 404s a restricted video on every one of these routes. | Root |
| V6 | A 503 + Retry-After (a transcode building) on a video src: native holds the Item in `loading` and retries, honoring Retry-After capped at 30 s per wait and **120 s in total**, then emits `audioError { kind: 'other' }`. Never `network` (that copy says "No connection"). On any audioError during a handoff, the web leaves its element paused at the handoff position, so the return resumes from there. | Root (the iOS Root proposed the hold-and-retry) |
| V7 | The handoff out. The web pauses its element (`pauseSuppressingHandoff`), then in the same task, with no await, posts `audio.load { queue: [item], index: 0, positionSec: <file seconds now>, autoplay: true, modes: { autoplay: false, shuffle: false, loop: 'off' }, rate: <the element's rate clamped to 0.5-3>, rev: <last + 1> }`. A video paused when the app backgrounds sends nothing (as today, where the sidecar never starts for a paused video). The iOS pre-pause candidate counts as playing. | Root |
| V8 | The return (the moment `handleForegroundSwapBack` runs today). Position = the newest of the last `audioState.positionSec` and `audioTick.positionSec`. Playing = native's state was `playing` or `loading`. The web posts `audio.stop`, seeks its element, and plays it only if native was playing (Dean's reopen rule, 2026-09-24). An item that ended in the background returns at its end, paused, never at 0:00. The subscription already delivers state and ticks: on a fresh `audio.subscribe` after a pagehide, native sends one full `audioState` at once (native-bridge.md 2), and the web needs nothing more. | Root |
| V9 | One engine at a time. Native never plays while the web element plays: the pause comes before the post (V7), and `audio.stop` before the element plays (V8). A web video load while native holds a handoff or Listen Item stops native first (the v1.397.0 stand-down rule, unchanged). | Root |
| V10 | Listen rows in a Music queue ride as `video` Items next to `track` Items: the D12 "only the playing Item's kind is flattened" rule becomes "a Music queue flattens `track` and Listen `video` Items together". Podcasts are unchanged. Radio asks only from a `track` Item's seed. | Root |
| V11 | Browsers, the PWA, desktop and the v0.14.0 app: inert, byte-identical (V3). | Root |

## The contract additions (bridge v1, add-only; freeze in W1 and relay before W3)

- Capability: `nativeVideoAudio` (boolean, like `nativeAudio`).
- `$defs/audioItem.kind` enum: `["track", "podcastEpisode", "video", "tvEpisode"]`.
- `$defs/audioItem.progress.route` enum gains `"/api/tv/progress"`.
- The src and artworkSrc prefix rules of V4, written into the audioItem description and native-bridge.md 2/3 as the exact
  allowed prefixes (the app validates src against a fixed list).
- native-bridge.md gets one section "Video audio (v1.398.0)" with V2, V6, V7, V8 and V9 in the doc's own register.
- Nothing else changes: no new intents, no new events, and no `audioError.kind` value is added.

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
   - native-audio.js builds `video` and `tvEpisode` Items (V4) and exposes a handoff out and back.
   - At `attemptBackgroundAudioHandoff`, with the capability, take the native branch (V7) instead of the sidecar. At
     `handleForegroundSwapBack`, take the return (V8).
   - Listen rows load natively (V2b), and the Music queue flattening carries them (V10).
   - The proxy (the v1.397.0 accessors) covers a Listen row exactly as it covers a track. The handoff does NOT install the
     proxy: the page is hidden, and the video element stays the page's element.
   - Without `nativeVideoAudio`, every new branch is inert.
4. **W4 - guards.**
   - A binding test per ruling V2-V10 (mutate it, watch it red). The V9 test must show that the web element and native
     never both play, in both directions.
   - A no-capability byte-identity test for the sidecar path (V3).
   - Token tests:
     - `mt` reaches a `video` and a `tvEpisode` file and the two art routes;
     - `mt` is refused for `/video/:id`, `/tvepisode/:id` and any POST;
     - a restricted video 404s on all four routes for a restricted user's media token.
   - The ended-in-background return (V8) and the 503-then-error path (V6) driven by a fake host in jsdom.
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
- A video's chapters as clips.
- Any change to the web video player on screen, or to the sidecar's behavior without the capability.
- Anything else goes to ROADMAP Planned.

## Device checks (after the iOS app build that pins this tag; add to docs/DEVICE-CHECKS.md)

- (a) Play a video, lock the phone: the sound continues. Pause and resume from the lock screen and from AirPods.
- (b) Unlock and return: the video is at the sound's position, playing only if the sound was playing.
- (c) Same as (a)-(b) with a TV episode.
- (d) Mid-video in the background, start a voice memo: FileTube yields. Stop it: no other app's audio is left ducked.
- (e) Let a short video end in the background, then return: it's at the end and paused, not at 0:00.
- (f) A Listen row from Music plays and resumes from the lock screen like a song; its position is saved.
- (g) Background audio setting OFF: a video pauses when the app backgrounds, as today.
- (h) A restricted account's phone: a restricted video never plays as sound by any route.
- (i) An app build without `nativeVideoAudio` (v0.14.0): video's sound behaves exactly as on v1.397.0.

## Evidence (builder fills)
