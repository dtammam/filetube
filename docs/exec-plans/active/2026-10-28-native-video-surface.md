---
plan: native-video-surface
harness: v2 · full
branch: feat/v1.399.0-native-video-surface
anchor: spec
status: W1 FROZEN 2026-10-30 (the spike gate lifted by Dean); building W2-W6
next: W2 - the load and the proxy; then W3 the surface, W4 captions, W5 guards, W6 relay; gate; release after v1.398.0
design: Approved 2026-10-28 (Dean picked "Native picture, web controls" after the v1.398.0 handoff spike failed)
gate: not started
builder: extreme
---

# v1.399.0 - on the iPhone app, a video plays in the app's own player, picture and sound, under FileTube's controls

Kickoff 2026-10-28 (FileTube Root, Opus). **Builder: Extreme (Fable).** The pick: this changes who owns the video element
in the player core, adds a new bridge surface, and has a device-only feasibility question. One release, **1.399.0**. It
releases AFTER v1.398.0: before its release commit, merge the updated origin/main and re-run the full suites. Both plans
touch public/js/native-audio.js; if v1.398.0's changes there conflict with this plan's seams, stop and ask.

This plan is the FileTube half. The app half is the SANDYJAR iOS Dev Root's (filetube-ios). The FileTube Root relays; the
builder never edits filetube-ios.

## Why

Dean, 2026-10-28: he wants video handled natively "from the start", "an iOS shunt", with no awkward handoff and not
another layer on the bgAudioEl machinery. He hears a degraded, Bluetooth-like sound when a video switches to background
audio in the web path.

The v1.398.0 spike (Dean's iPhone 15 Pro) showed why a handoff can't work. WebKit pauses the video before the page hears
`visibilitychange`, and iOS refuses to activate the app's audio session from the background (OSStatus 560557684 '!int').
So the native player has to own the video from the first frame.

Dean chose (AskUserQuestion, 2026-10-28):
- **Native picture, web controls: picked.** One native AVPlayer plays sound and picture, drawn where the video sits on the
  page, and FileTube's own controls stay on top.
- Apple's full-screen player: rejected. It loses chapters, scrub previews and subtitle styling.
- A muted web picture chasing native sound: rejected. It drifts, and it downloads every video twice.

What Dean will see on the iPhone app:
- A video looks the same on the page, with the same controls, chapters, scrub previews, captions and skins.
- Locking the phone or switching apps: the sound just continues, with no handoff, no quality drop, and lock screen and
  AirPods controls like music.
- Coming back: the picture is there at the right frame.

## Rulings (settled - do not reopen)

| # | Ruling | Source |
|---|---|---|
| S1 | One native AVPlayer owns a video's sound AND picture on hosts that announce **`nativeVideo`** (a new capability, add-only in bridge v1). The web's `#media-player` loads NOTHING and becomes the v1.397.0 proxy (own-property accessors + dispatched events) for the video. | Dean 2026-10-28 |
| S2 | Transport reuses `audio.*`: `audio.load` with a `video` / `tvEpisode` Item (the kinds frozen in v1.398.0 W1, no clip, no radioSeed), plus play, pause, seek, setRate, stop, and the subscription's audioState and audioTick. No `video.*` transport messages. | Root |
| S3 | ONE new intent, **`video.surface`** `{ rect: {x, y, w, h}, space: 'document' \| 'viewport', visible, fit: 'contain' \| 'cover', radius }`, in CSS px. `document` rects are for the in-page player (on the watch page the document scrolls: `document.scrollingElement` is `<html>`, player.js ~5726), so native follows `webView.scrollView.contentOffset` itself with no message per scroll frame. `viewport` rects are for fixed placements (the `#player-dock` mini player, CSS fullscreen). The web sends it on any layout change of the player box, coalesced to one per animation frame. `visible: false` hides the layer; the sound is unaffected. | Root; frozen 2026-10-30 with `space: 'document'` and native following `contentOffset` (the spike gate lifted by Dean; device check (0b)) |
| S3a | **The dock shows no picture** (ruled 2026-10-28 by the FileTube Root on the builder's placement finding; Dean may overrule): a layer below the web view shows only where nothing in the web view paints, and the page keeps scrolling UNDER the fixed mini player. While docked the web sends `visible: false`, the sound continues, and the dock shows the video's thumbnail; the picture returns in the slot and in CSS fullscreen. `space: 'viewport'` is for CSS fullscreen only. A layer ABOVE the web view with touch passthrough for the mini player is ROADMAP Planned ("picture in the mini player (iOS app)"). Native notes for W1: the web clips its own hole to the box's rounded top corners, so `radius` is a hint and a square layer is correct; native never rounds the bottom corners. | FileTube Root 2026-10-28 |
| S4 | audioState gains **`videoSize {w, h}`** (additive), the presentation size. The proxy answers `videoWidth` / `videoHeight` from it, and fires `resize` and `loadedmetadata` as an element would. | Root |
| S5 | The web leaves the surface region TRANSPARENT: the player box and every ancestor up to the root paint no background behind the picture while `nativeVideo` owns it. The controls, captions, chapter markers and skins paint on top as today. | Root |
| S6 | What stays on the web element under `nativeVideo` (the stand-down list, extended): a **360 / VR** video (vr-view.js reads the element into WebGL), the **Feed**, hover **previews** (`/preview/:id`), read-aloud, and anything that isn't a library `video` or a `tvEpisode`. A load of any of those stops native first (the v1.397.0 rule). | Root |
| S7 | Captions render from the PROXY's time. Today they come from `TextTrack.activeCues` of a `<track>` on the element (player.js `renderActiveCueOverlay`), and an element with no media never advances its cues. Under `nativeVideo` the overlay is fed by a cue list the web parses from the same `/api/subtitles/:id` VTT and looks up by `currentTime`. It's the same overlay and the same look, and without the capability it's byte-identical. | Root |
| S8 | Fullscreen under `nativeVideo` is the CSS fullscreen (`#player-wrapper.css-fullscreen`), with a `viewport` surface rect. `webkitEnterFullscreen` is never called: there's no media in the element to present. Rotation is the web's layout plus a new rect. | Root |
| S9 | Backgrounding is native's business. Native detaches the player from its layer so the sound continues, and reattaches it on foreground. The web's background-audio path (`attemptBackgroundAudioHandoff`, the sidecar) is INERT for a `nativeVideo` load, and nothing is sent at hidden. | Root, from the v1.398.0 spike |
| S10 | Progress, resume and watched state: native posts `/api/progress` or `/api/tv/progress` (v1.398.0 V4/V5). The web's own progress save for a proxied video is suppressed, so it's never saved twice. A view is counted (`POST /api/videos/:id/view`) by the web at play, as today. | Root |
| S11 | Browsers, the PWA, desktop and app builds without `nativeVideo`: byte-identical. | Root |

## The contract additions (bridge v1, add-only; frozen in W1 2026-10-30)

- Capability `nativeVideo`.
- Intent `video.surface` (S3).
- audioState field `videoSize` (S4), present only for a video Item.
- native-bridge.md: a "Native video (v1.399.0)" section with S1-S3, S5, S8 and S9 in the doc's register, and the S6
  stand-down list. ios-host.md: an addendum.

## The iOS Root's surface spike (feasibility; it never ran - the gate was lifted by Dean 2026-10-30, see Evidence)

Asked 2026-10-28, run on Dean's phone with a throwaway build:
1. Can the picture show through a transparent region of a non-opaque WKWebView from an AVPlayerLayer below it, with
   touches still reaching the web view?
2. While scrolling: following `scrollView.contentOffset` natively vs a rect per message. What is the measured lag of each
   during a fling?
3. Locked with the layer detached: does the sound continue, and do lock screen and AirPods pause and resume? On
   foreground, does the picture return at the right frame?
4. Rotation and fullscreen: any flash or misplacement while the rect churns?

Outcomes:
- (1) or (3) fails: STOP. Dean's choice is infeasible as specified, and the Root takes it back to him.
- (2) shows that only message-driven tracking works: S3 drops `space: 'document'` and the web posts per scroll frame. The
  Root re-freezes this before W1.
- (4) problems: an S8 detail; the Root rules on it.

**Lifted 2026-10-30 (Dean, via the FileTube Root): "The spike never ran, go ahead and build on that assumption."** (1) the
hole, (2) scroll following, (3) lock with the layer detached and (4) rotation are UNVERIFIED and become the first device checks,
(0a)-(0d) below. If one of them fails on the device after the app build, that is a re-root-cause, not a re-patch.

## Seams (verified 2026-10-28 by the Root; line numbers drift, so search by name)

- `public/js/native-audio.js`:
  - `PROXY_PROPS` (~26) gains `videoWidth`, `videoHeight` (S4);
  - `itemFromDescriptor` (~65) builds video and tvEpisode Items for a `nativeVideo` load;
  - the proxy install/remove (~266), and the stand-down handling (S6).
- `public/js/player.js`:
  - `window.FileTube.player.load` (~10815) -> `setupForMedia`: the choke point;
  - `renderActiveCueOverlay` (~3290) and the cc overlay build (~3180): S7;
  - CSS fullscreen (`css-fullscreen`, `cssFsSavedScrollY` ~2954) and `webkitEnterFullscreen` (~7854): S8;
  - `attemptBackgroundAudioHandoff` / `handleForegroundSwapBack` / `handlePossibleIOSPrePauseHandoff`: S9;
  - `saveProgressToServer`: S10;
  - the FULL `#player-slot` vs DOCKED `#player-dock` mounting (header ~9-66): the S3 `document` vs `viewport` placement;
  - the rotation top-snap (~3006).
- `public/js/vr-view.js`: S6 (stays web).
- `lib/media/streams.js` `/preview/:id`: S6 (stays web).
- `docs/references/native-bridge.v1.schema.json`, `public/js/host-adapter.js`, native-bridge.md, ios-host.md.
- The census will find more (every direct `mediaPlayer` read on the video path). Add each to this list.

## Step 0 (builder)

- Read:
  - AGENTS.md;
  - docs/LESSONS.md sections 0, 1, 2, 4, 5, 9, 10 and 12;
  - native-bridge.md, ios-host.md, ios-background-audio-behavior-map.md;
  - the completed plans 2026-10-28-native-audio.md and 2026-10-28-native-video-audio.md (once completed; until then on
    its branch);
  - this plan.
- Environment: export the fnm Node PATH; a worktree under .claude/worktrees/ with node_modules hard-link-copied; stage by
  name, no force-push, no --no-verify.
- Census, into Evidence before any code:
  - every read of the video element on the video path (props, methods, events, `textTracks`, `videoWidth`,
    `getBoundingClientRect` of the media element, `webkit*`), each with how the proxy satisfies it or why it doesn't
    apply;
  - every place the player box or its ancestors paint a background (S5);
  - every layout change that moves the player box (slot <-> dock, fullscreen, rotation, the watch layout's own resizes,
    skins).
- Red first: a host announcing `nativeVideo` gets `audio.load` with a `video` Item for a watch-page video and the element
  gets NO src. Watch it fail on main.
- **Wait for the spike result** (the FileTube Root relays it) before W1. The census and the red test don't need it.

## Waves

1. **W1 - the contract** (frozen 2026-10-30; the spike gate lifted). Schema, host-adapter, docs, and contract tests. Send the schema sha to the
   FileTube Root to relay before W3.
2. **W2 - the load and the proxy.**
   - At the choke point, a library `video` / `tvEpisode` load under `nativeVideo` is claimed: `audio.load`, no element
     src, and the proxy with `videoWidth`/`videoHeight`.
   - The S6 stand-downs.
   - S10: native posts progress, and the web's progress save for a proxied video is suppressed.
3. **W3 - the surface.**
   - `video.surface`: the rect from the player box, its `space`, `visible`, `fit`, `radius`; coalesced; sent on every
     census layout change.
   - S5 transparency.
   - S8 fullscreen.
   - S9: the background path is inert for a native load.
4. **W4 - captions (S7).** Parse the VTT into a cue list (no deps; reuse any existing parser in the repo before writing
   one) and feed `renderActiveCueOverlay`'s rendering from the proxy time.
5. **W5 - guards.**
   - A binding test per ruling (mutate it, watch it red).
   - A no-capability byte-identity test for the video path (S11).
   - A fake host in jsdom that plays snapshots and asserts the rect messages across slot -> dock -> fullscreen ->
     rotation.
   - The caption timing against a fixture VTT.
   - Screenshots of the watch page with a fake host (transparent region outlined) in light and dark, for Dean.
6. **W6 - relay.** The final schema sha goes to the FileTube Root.

## Stop rules

- The spike fails (1) or (3): STOP. (Lifted 2026-10-30: the spike never ran; (1)-(4) are device checks (0a)-(0d).)
- The proxy can't carry a video consumer the census finds without forking the player core: STOP and ask.
- S5 transparency would change any non-native rendering: STOP.
- Any contract field changes after the W1 relay: STOP. The Root relays it.

## Gate

Full gate (the player core, a new bridge surface): **adversary + qa + security-brief**.
- Adversary: two players never both sound (a stand-down load mid-native, slot <-> dock, fullscreen); S11 byte-identity;
  caption timing; progress never double-saved; and the rect in every placement.
- Security-brief: the new intent's inputs (a rect from the page reaching native; a hostile page can't place a layer over
  native UI). Brief it with what native clamps, from the iOS Root.

## Release

- docs/RELEASING.md + AGENTS.md: the protected-main PR flow, dual-Node 22.23.1 + 24.20.0, the image smoke, a
  docs/releases.json entry, a ROADMAP entry, and a LESSONS line if a wave taught one.
- Close the plan in the release PR with `node scripts/plan-complete.js docs/exec-plans/active/2026-10-28-native-video-surface.md "Shipped v1.399.0" --apply`.
- Dean authorizes the merge. After the tag's Publish run is green, send the tag and commit to the FileTube Root to relay.

## Not in scope

- PiP, AirPlay video, Chromecast from the app.
- Native subtitle or audio-track choice.
- 360 video native.
- A background video queue or autoplay to the next video.
- Downloads playback (it stays the existing native path).
- Anything else goes to ROADMAP Planned.

## Device checks (after the iOS app build that pins this tag; add to docs/DEVICE-CHECKS.md)

- (0a) The HOLE (spike 1, unverified): the picture shows through the page's transparent region from the layer below the
  web view, and a tap on it reaches the web's controls, not the layer.
- (0b) SCROLL FOLLOWING (spike 2, unverified): with native following `contentOffset` and no message per scroll frame, a
  fling keeps the picture locked to the player box with no visible lag. Lag = a re-root-cause of S3, not a patch.
- (0c) LOCK WITH THE LAYER DETACHED (spike 3, unverified): the sound continues, lock screen and AirPods pause and resume,
  and on foreground the picture returns at the right frame.
- (0d) ROTATION (spike 4, unverified): no flash or misplaced picture while the rect churns.
- (a) A video plays with its picture in place; the controls, scrub previews, chapters and skins all work on top of it.
- (b) Scroll the watch page mid-video: the picture moves with the page and doesn't lag.
- (c) Lock mid-video: the sound continues at full quality. Pause and resume from the lock screen and AirPods. Unlock: the
  picture is at the right frame.
- (d) A voice memo or call mid-video: FileTube yields. Afterwards no other app is ducked.
- (e) Fullscreen and rotation: no flash, no misplaced picture.
- (f) Captions on: in sync, and they look as before.
- (g) Navigate away (docked player): the dock shows the thumbnail and the sound continues; tap it to expand: the picture is
  back at the right frame (S3a).
- (h) A 360 video, a Feed video and a preview play exactly as before.
- (i) A TV episode resumes where it was left, and its progress is saved once.
- (j) An app build without `nativeVideo`: everything exactly as before.

## Evidence (builder fills)

### Step 0 (2026-10-28, Fable builder; line numbers at d6d6ecc8 = main 9e11ed90 + this plan)

- **Spike:** not received at Step 0 (the inbox empty, no relay in the plan). Census + red first done; W1 waits. The FileTube
  Root was asked for the result and for one placement ruling the census raised (below).
- **Base:** S2 builds on the `video` / `tvEpisode` Item kinds frozen in v1.398.0 W1 (b44cbb91), which are not on main yet: the
  v1.398.0 branch (fc8349f2 W1-W3 + 1503b29f W4) is merged into this branch (1103e828). The release still waits for v1.398.0
  and re-merges origin/main first.
- **Red first** (test/unit/native-video-surface-contract.test.js, the REAL player.js on a phone realm): `node --test` at
  d6d6ecc8 = 3 tests, 2 pass, 1 fail: `not ok 1 - RED FIRST (S1, S2, S4): a host announcing nativeAudio + nativeVideo takes a
  WATCH-PAGE video into native ...` (`the adapter knows the capability: expected true, actual false`); `ok 2 - CONTROL (S11):
  a host ... WITHOUT nativeVideo keeps the watch-page video on the web element`; `ok 3 - CONTROL (S11): no host`.

**Census A - every read of the video element on the video path** (player.js unless named; how the proxy satisfies it):

- Already proxied since v1.397.0 (`PROXY_PROPS`): `currentTime` (currentAbsTime 3123, updateSeekVisual / fillTick / the dock
  fill loop, the seek commit 8384, saveProgressToServer 6565, getRemoteSnapshot, the resume ladder 6332-6470), `duration`
  (seekTotalDuration, the seek commit, the save body 6587), `paused` (togglePlayPause, updatePlayPauseUI, mountInSlot 10484 +
  dock 10656 `wasPlaying`, handleBackgroundLifecycle 4285 `isPlaying`, ambient.js 532), `ended`, `playbackRate` /
  `defaultPlaybackRate` (initPlaybackRate 7838 -> audio.setRate, applyPlaybackRate, hold-to-2x), `readyState` (ambient.js
  532 / 556 / 577), `buffered`, `seeking`, `play()` / `pause()` (autoStart 6314, resumeDirectly 6282, the slot / dock re-play,
  pauseSuppressingHandoff). Unchanged under `nativeVideo`.
- New for video (S4): `videoWidth` / `videoHeight` 10344-10345 (the `loadedmetadata` aspect fallback + the legacy
  `/api/videos/:id/dimensions` backfill: the proxy answers from `audioState.videoSize` and fires `loadedmetadata` / `resize`,
  so the box settles and the backfill still runs); readVideoState 4558 (the `?debugLifecycle=1` instrument: readyState,
  networkState, videoWidth / Height, `getVideoPlaybackQuality`, `webkitDecodedFrameCount`, `webkitPresentationMode`: read-only;
  the frame counters read null under native - disclosed, an instrument); vr-view.js 231 `uploadFrame` (S6: a sphere never goes
  native).
- Fullscreen (S8): `webkitEnterFullscreen` 7878-7886 + `webkitSupportsFullscreen` 7879 (gated on `!audioItem`: MUST NOT run
  under native - no media in the element; the fs button 8647 takes CSS fullscreen when the controls are CUSTOM
  (`!inNativeControlsMode()`)); the NATIVE controls mode (applyControlsMode 2736: `mobile && isVideo && FULL &&
  !mobileCustomPlayerCached`, the default OFF setting) sets the `controls` attribute 2738 so iOS draws its own strip over the
  element: under native there is no media for iOS's strip, so the controls mode must be CUSTOM for a claimed video (W3);
  `webkitDisplayingFullscreen` / `webkitPresentationMode` 3095 (inNativeFullscreen: false on an empty element, correct);
  `webkitExitFullscreen` 8658 / 9313, the webkit begin / end fullscreen listeners 9291 / 9466 / 9495 (never fire);
  `requestPictureInPicture` 8689 (the PiP row: not in scope; it must hide for a claimed video - an empty element's PiP
  request rejects; W3).
- Element writes: `src` 10402 / 10448 / 10457 (setupForMedia: the video branch skips every src when claimed, the transcode
  branch too - native holds a 503 itself, v1.398.0 V6), 6252 (the transcode poll's `readySrc`: never entered), 6671 (desktop
  live transcode: never mobile); `poster` 10431 / 10436 (MUST NOT be set for a claimed video: a poster paints an opaque image
  in the region, S5); `style.display` 10421 (`block`, kept: the element box carries the aspect); `controls` 2738 (above);
  `load()` / `removeAttribute('src')` 10010-10012 / 10769 (teardown: harmless on an empty element); `volume` / `muted`
  7502-7588 / 8478-8488 / 11000 (the mute button is hidden on phones, `#player-wrapper.ff-mobile #mute-btn` style.css 4588;
  a write on the proxy changes nothing in native - iOS volume is hardware; disclosed); `textTracks` / `ccTrack` 8723-8783 /
  9356 / 10304 / 6656 (S7, Census D).
- Events the proxy must dispatch (the listeners 8017-8420, 9340-9360, music/remote unchanged): play, pause, playing,
  timeupdate, durationchange, loadedmetadata, seeked, ratechange, emptied; `resize` (new, S4, with videoSize); never ended
  (native ends items; the web's cascade stands down as in v1.397.0, 7051), waiting / stalled / error (an `audioError` toasts),
  volumechange.
- Other consumers: watch.js vrElements 2511 (S6); setupAmbientMode 2876 (ambient.js samples the storyboard tile / poster
  OFF-DOM, never the element: it reads only the proxy's paused / ended / readyState and runs as for a web video. Its glow
  `.ambient-glow` style.css 7045 sits at z-index -1 BEHIND the stage and reaches 12% / 22% past it: with a transparent box
  the glow would paint over the native picture - W3 clips the stage's own box out of the glow with a static evenodd
  polygon: the glow was never visible there (an opaque black box covered it)); feed.js 1328 / 2381 (S6: the Feed binds its own
  ended / error / timeupdate on the element and saves to `/api/feed/progress/media` 274: stays web; its descriptor is told
  apart by `progressEndpoint`); main.js 1068 (`/preview/:id` muted clips: separate card `<video>`s, never `#media-player`);
  read.js 282 (type audio, never video); remote.js (the Listen Control target reads the proxy as for audio).
- Progress (S10): saveProgressToServer 6567 already returns under `nativeActive()`: holds for a claimed video since
  `ownedId` is set (the outgoing save at close / navigation / hidden too); `POST /api/videos/:id/view` (watch.js ~1680) stays
  the web's at open; the `/api/videos/:id/dimensions` backfill 10361 runs from the proxy's videoSize for a legacy item
  (harmless, kept). Native posts `/api/progress` or `/api/tv/progress` (v1.398.0 V4 / V5, already on the server).
- Background (S9): handleBackgroundLifecycle 4280 reads `!mediaPlayer.paused` - under native the proxy says playing, so
  `shouldPauseForLifecycleEvent` (mobile video) -> attemptBackgroundAudioHandoff 3925 -> with the setting on and the status
  ready the SIDECAR would play `/audio/:id` over native's sound. W3 makes the lifecycle branch inert for a claimed load (no
  pause, no handoff, no save, nothing posted at hidden), and stands down handlePossibleIOSPrePauseHandoff 4078, the presync
  3903, armBackgroundAudioSrc 3860, the prepare-audio POST + pre-arm + repoll in setupForMedia 10162-10260 (a server-side
  ffmpeg extraction queued for nothing) and the gesture prime 4213; handleForegroundSwapBack 3395 is a no-op (the state stays
  INLINE_VIDEO); releaseAudioSession 3808 already returns under `nativeActive()`.
- Resume: the video ladder (handleResumePlayback 6450-6470: `/api/progress/:id`, then resolveResumeStart -> resumeDirectly /
  autoStart / the prompt) drives `audio.seek` / `audio.play` through the proxy exactly as v1.397.0 drives audio; a TV episode
  resumes from its descriptor (6441). `awaitingTranscode` stays false for a claimed video (the ladder runs).

**Census B - every background paint behind the picture (S5)**, style.css: `.player-container` 1269
`background-color: #000` (the letterbox black; the dock keeps it through 1318), `#player-wrapper.css-fullscreen` 4753
`background: #000`, `body.ft-css-fullscreen` 4868 `background: #000`, `#fs-stage:fullscreen` 4461 (desktop only), `body` 296
`background-color: var(--surface-0)` (the canvas; `.main-content` 748 paints NO background by the v1.166.1 ground contract,
`html` paints none, `#view-root` / `.watch-player-stage` / `#player-slot` / `#media-player` / `.player-container video` paint
none), the `poster` (Census A), `#ambient-glow` 7045 (a sibling behind the box, Census A). The `#player-wrapper { color-scheme }`
3999 and `.player-controls` (the bar BELOW the picture inline, OVER its bottom band in CSS fullscreen) paint nothing behind it.
The design for W3: the hole is the web's own. `html.ft-native-video` makes `body` transparent and paints the canvas on a
document-space `body::before` layer (z-index -1, `var(--surface-0)`, the body's own transition) with an evenodd polygon hole at
the `#media-player` box (the top corners rounded like the container's `--r-md`, the bottom corners square: the bar sits below),
and the box's own black goes transparent; outside the hole the page is pixel-identical. Native's layer never shows outside
the hole, so `radius` is a hint: native may round its layer to match, a square layer is equally correct.

**Census C - every layout change that moves the player box** (the `video.surface` sender's triggers):
(1) slot <-> dock: mountInSlot 10473 (into `#player-slot`, or `#fs-stage` while staged), dock 10642 (`#player-dock`,
`position: fixed` -> `viewport` space), expand 10525, close 10696 (-> `visible: false`, then audio.stop), the dock's own
ResizeObserver 10626; (2) CSS fullscreen: setCssFullscreen 2790 (fixed inset 0 -> `viewport`), trySidewaysFullscreen (the
landscape auto-enter), applyCarriedImmersive, the fs button 8647; (3) rotation: resize / orientationchange 9167-9173
(`--player-cap-h`), snapRotationDeadZone 3002 (scrollTo 0: a `document` rect is unmoved), visualViewport resize 3037; (4) the
watch layout's own: applyMediaAspect 3276 (`--media-aspect`, `.portrait-media`), the portrait clamps 3946 / 3973 (45vh / 78vh),
refreshPlayerHeightCap, theatre / split, the desktop sidebar, the header, the minimize drag (`is-minimize-drag` / `-snap` /
`-settle` 1396-1405: a TRANSFORM per frame that no observer reports), the view fade, fonts and images settling above the
box; (5) skins / eras: `--r-md` (the radius). Design for W3: one requestAnimationFrame sampler while a video is claimed and the
document is visible (`getBoundingClientRect` of `#media-player` + the computed radius; a clean layout makes the read cheap)
that posts `video.surface` only when the rect, space, visibility, fit or radius changed - every trigger above is covered by
construction, one message per frame at most, none while nothing moves.

**Census D - captions (S7):** the `<track id="cc-track">` src `/api/subtitles/:id` (10304; `?offset=` only in desktop
liveMode 6656), `track.mode` hidden / disabled (8735), `activeCues` read in renderActiveCueOverlay 3293 from `cuechange`
(8782-8783) and the `timeupdate` fallback 9356 (the load-bearing iOS path), `data.hasSubtitles` gates the CC row 10306. An
element with no media never advances its cues. Existing parsers: lib/transcript.js `parseVttCues` (server, cue-block aware)
and lib/subtitles.js `parseVttTimeMs`; the web has only `stripVttCueTags` / `buildCaptionOverlayText` (player.js 1908 / 1923).
W4 ports `parseVttCues` to the client (no deps) with the server parser as the oracle in its test, fetches the same VTT, and
feeds `renderActiveCueOverlay` a `{ activeCues }` looked up by the proxy's time from the same two paths.

**The placement finding (raised with the FileTube Root before W1).** A layer BELOW the web view shows only where NOTHING in
the web view paints. Inline (the slot) that is the hole above. In CSS fullscreen the page content under the fixed overlay would
paint over the picture: W3 hides everything but the player subtree there (`visibility: hidden` on `.app-container`,
`visible` on `#player-wrapper`; the header and bottom nav are hidden already), so a `viewport` rect works. In the DOCK the page
content keeps scrolling UNDER the fixed mini player, so a below-the-web-view layer cannot show there without cutting the dock's
rect out of the whole page per scroll frame. Options put to the Root: (a) the dock shows no picture (`visible: false`; the
sound continues; the dock shows the thumbnail; the picture returns on expand), or (b) a contract field for `viewport`
placements that puts the layer ABOVE the web view with touches passed through (the dock's bar sits below the picture, only the
close button would be covered). W1 freezes after the ruling.

### The spike and W1 (2026-10-28)

- **Spike, first relay (partial, Dean by eye):** (1) the picture showed through the hole and a tap square worked as a page element;
  (2) "locked to page" with native following contentOffset; (3) and (4) not tested (the app stuck on the spike build). The FileTube
  Root ruled: start W1, then W2; hold W3 until (3) passes.
- **Retracted 2026-10-28: the spike page never ran.** The iOS Root's device log holds no message from the test page, so Dean's
  "locked to page" cannot be counted; (1), (2), (3) and (4) are all UNKNOWN. The Root's ruling: W1 stays on the branch as a DRAFT
  (not frozen, not relayed), W2 and W3 do not start, `space: 'document'` stays pending in S3. The iOS Root redoes the spike with
  Dean's OK and confirms page messages in its log before claiming anything.
- **W1 draft (this commit):** schema (`nativeVideo` capability, `video.surface` with `$defs/surfaceRect`, `audioState.videoSize` via
  `$defs/videoSize`), host-adapter.js mirror (`video.surface` under `nativeVideo`, `videoSize` an optional audioState field),
  native-bridge.md (the row, the owners row, section 6, a "Native video (v1.399.0)" block marked DRAFT with S1-S3, S3a, S5, S8, S9,
  the S6 stand-down list, the two native notes and the iOS Root's clamp rules), ios-host.md (the decision bullet and a v1.399.0
  addendum). test/unit/native-bridge-contract.test.js (the schema <-> adapter mirror) passes 10/10 on the draft. The W1 contract
  tests of their own and the red test land when W1 freezes.
- **The spike gate was lifted by Dean 2026-10-30** (relayed by the FileTube Root: "The spike never ran, go ahead and build on that
  assumption"); no result ever came from the iOS Root. (1) the hole, (2) scroll following, (3) lock with the layer detached and
  (4) rotation are UNVERIFIED and become the first device checks (0a)-(0d). If any fails on the device after the app build, that
  is a re-root-cause, not a re-patch.
- **W1 FROZEN 2026-10-30** as drafted: `space: 'document'` stays with native following `contentOffset`; the S3a dock ruling, the
  iOS Root's clamp rule and the two native notes (radius a hint / square layer correct; never round the bottom corners) are in
  native-bridge.md's block, now headed as the frozen contract. New test/unit/native-bridge-video.test.js binds the contract at the
  adapter (the capability gates the ONE video message; every video.surface field required and bounded, 15 malformed shapes
  refused; videoSize delivered / dropped / absent); mutant: the radius lower bound removed from host-adapter.js -> red on
  "radius >= 0", restored. Bridge tests: 31 pass, 0 fail (video + contract mirror + audio). The frozen sha is in the W6 relay
  note below.

### W2 - the load and the proxy (2026-10-30)

- **The claim** (native-audio.js `claim` -> `claimVideo`, player.js setupForMedia's video branch): under `nativeVideo` (always
  beside `nativeAudio` + `nativeVideoAudio`) a `type: 'video'` load whose descriptor passes `videoItemFromDescriptor` (exported,
  pure) is native's: ONE whole-file Item (`video` at /api/offline/file/video/<id> with /thumbnail art and /api/progress, or
  `tvEpisode` at /api/offline/file/tvEpisode/<id> with /tvthumb and /api/tv/progress; never a clip, never a radioSeed), sent as
  `audio.load` with a one-item queue (no Up-next flattening: autoplay-next is out of scope, ROADMAP Planned). The element gets
  no src and no poster (a poster would paint over the hole for good) and is the v1.397.0 proxy plus `videoWidth` / `videoHeight`
  from `audioState.videoSize` (S4: `loadedmetadata` again when the size becomes known after the item's first snapshot, `resize`
  on a change). `ownedSurface` / `surfaceOwned()` tell a surface video from a Listen row.
- **The watch page's bare early load is deferred.** watch.js initWatch's first `player.load` carries no type, title, projection
  or transcode state (the /api/videos/:id payload comes later as an adopt). Under nativeVideo setupForMedia sets NO src and claims
  nothing for it (`nativeVideoDeferredId`); load() turns that id's full-data adopt into a real load, which claims. Without the
  capability the early load sets `/video/<id>` as before (S11).
- **A same-id re-open** (the watch page again, the dock expanding) is an adopt of the proxy: `isNativeHandBackLoad` gains a 5th
  argument and never hands a SURFACE video back (the v1.398.0 Listen -> Watch hand-back is for a Listen row only). A FRESH page
  while native plays the video (a navigation) follows it in `claimVideo` (`lastClaimFollowed() === 'adopt'`: no progress read,
  no seek, no autostart, nothing re-sent).
- **S6 stand-downs** (null from `videoItemFromDescriptor`, so the web element plays and native stops first as in v1.397.0): a
  360 / VR `projection`, the Feed's cards (`/api/feed/progress/*`, `readerHref: '/feed'`), any explicit non-TV `streamSrc` (a
  preview, a book), a non-video type, and **a rendition still transcoding** (`needsTranscode` and not ready: the file route
  answers 503 until the rendition exists, and native's V6 hold gives up after 120 s) - that one takes the web's "Preparing this
  video" overlay + poll as today, and `pollTranscodeUntilReady` claims it for native when the status says ready (no src then).
  The desktop live transcode is never used under nativeVideo (a wide app window takes the poll path).
- **S10:** `saveProgressToServer` already returns under `nativeActive()` (v1.397.0 D8); bound by the W2 test (no POST
  /api/progress across timeupdate + visibilitychange while native owns the video). The view count stays watch.js's own POST.
- **Tests:** test/unit/native-video-surface-contract.test.js (the un-parked red test, green now: 11 tests - the red-first, two
  S11 controls, the deferral, the re-open adopt, the fresh-page follow, the stand-downs with audio.stop, the tvEpisode Item, the
  transcode-then-claim, S10 + S4 events, the pure builder with 11 nulls). Native + bridge families: 143 pass, 0 fail (before the
  two added tests). **Mutants (10, each restored from a backup copy):** M1 hand-back guard, M2 deferral, M3 poster under claim,
  M4 readiness rule, M5 the poll's claim, M6 size events, M7 ownedSurface, M8 the 360 stand-down, M9 the same-item follow, M10
  the deferred adopt -> load: all red. M1 and M9 masked each other at first (a re-open never reaches the claim while the guard
  holds): bound separately by `lastClaimFollowed() === false` after a re-open and by the fresh-page follow test (LESSONS: mutants
  that mask each other need one assertion each).

### W3 - the surface (2026-10-30)

- **`video.surface`** (native-audio.js `surfaceMeasure` / `surfaceSync`): the `#media-player` box from getBoundingClientRect in
  CSS px, `document` space (+ scrollX / scrollY) for the in-page player, `viewport` space in the web's CSS fullscreen (and a
  `:fullscreen` stage); `visible` false while docked or the box is empty; `fit` from the element's object-fit; `radius` the
  wrapper's border-top-left-radius (0 in fullscreen). Measured once per animation frame when something may have moved
  (ResizeObserver on the element and the document, a MutationObserver on body for reparents / class changes, window resize and
  orientationchange, visualViewport resize, fullscreenchange, a 1 s backstop) and posted only when it differs from the last one;
  the player calls `syncSurface()` at the slot, dock and CSS-fullscreen transitions for a frame-exact move. A persisted
  `pageshow` re-sends (the host hid the layer at the navigation commit). Ownership ending (a stop, a stand-down load, close)
  posts one last `visible: false` when the layer was showing.
- **S5, the hole:** `body.ft-native-video` (style.css) makes body / html, the player box and the CSS-fullscreen wrapper + body
  belt transparent and hides the ambient glow; `#ft-video-hole` (created on first use, first child of body, z-index -1 via the
  ladder) paints `var(--surface-0)` over the whole document and is clipped with ONE even-odd `clip-path: path()` - the page
  minus the player box, the box's top corners rounded by `radius`, the bottom ones square (the bar sits below the picture). The
  layer scrolls with the document, so the hole needs no per-scroll work (native follows contentOffset). In CSS fullscreen the
  whole viewport is the box: no clip, the wrapper paints nothing. (A mask-image + mask-composite version was dropped: the inline
  SVG string tripped the icon lint, and the path needs no SVG.)
- **S3a:** docked = `visible: false` + the video's thumbnail as the element's `poster` (removed on expand: a poster would paint
  over the hole for good); the sound is untouched (no transport posted by a dock / expand).
- **S1 / S8:** `applyControlsMode` never gives a proxied video the native strip (the claim re-applies it: the mount runs first);
  the bar's fullscreen button and the `f` key take `setCssFullscreen` on every form factor (`enterFullscreen` guards too);
  `webkitEnterFullscreen` is never reached.
- **S9:** `handleBackgroundLifecycle` skips the pause branch under `nativeActive()` (no `audio.pause` at hidden; a terminal
  pagehide still runs the web's release, itself inert under native); the sidecar is never armed for a native video load because
  setupForMedia answers the settings read as "off" for it (`wouldClaimVideo`, asked BEFORE the claim - the block runs earlier
  than the branch; a bare early load holds too), so no prepare-audio POST and no second player; two extra guards inside the
  handoff and the arm were REMOVED as unreachable behind that hold (their mutants survived; LESSONS: a guard no test can reach).
- **Tests:** test/unit/native-video-surface-rect.test.js (8: the slot rect + hole + no native controls, coalescing / nothing
  while nothing moves, dock / expand with the thumbnail, the CSS fullscreen round trip, S9 hidden + pagehide, the closing
  visible:false on a stand-down, a wide-window fullscreen via button and key, the S11 control). Native + bridge families: 162
  pass, 0 fail. **Mutants (12, backups restored):** N1 scroll offset, N2 dedupe, N3 dock visible, N4 fullscreen space, N5 body
  class, N6 dock thumbnail, N7 closing message, N8 native strip, N9 lifecycle skip, N10 settings hold, N13 button form factor,
  N14 enterFullscreen guard - all red (N13 / N14 masked each other on the phone realm; the wide-window test binds each).
- **For the iOS Root (not contract):** the first `video.surface` of a load may be `visible: false` (a zero-size box before
  layout, or a docked mount) - draw nothing until a visible rect arrives; the hole's rounded top corners match `radius`; the
  web view's own `backgroundColor` shows in the overscroll bounce (the hole layer covers the document only) - set it to the
  app's neutral; pinch-zoom (visual viewport) is not compensated in document rects.

### W4 - captions from the proxy time (2026-10-30)

- **The parser:** player.js `parseVttCues` / `cleanVttCueLine` / `vttCuesActiveAt` (pure, exported) - a port of lib/transcript.js
  parseVttCues + cleanCueLine and lib/subtitles.js parseVttTimeMs / VTT_CUE_TIMING_LINE, kept identical (no client module can
  require the server's; the port is BOUND equal to the server parser on a fixture with a BOM, CRLF, header fields, a NOTE block
  holding a timing line, a cue identifier, tags and entities, a rolling cue's whitespace-only first line, a timing-looking payload
  line, a malformed timing block and a STYLE block). No new file: the parser rides player.js next to the overlay it feeds.
- **The feed:** `renderActiveCueOverlay` reads `vttCuesActiveAt(list, mediaPlayer.currentTime)` under `nativeSurfaceOwned()`
  (start inclusive, end exclusive, as TextTrack.activeCues) and the TextTrack otherwise; the same `buildCaptionOverlayText` and
  the same overlay element. `ensureNativeCueList` fetches `/api/subtitles/:id` ONCE per item at the first CC-on (never for a TV
  episode: no route; a failed fetch retries at the next CC-on; a superseded load's list is dropped by generation); the `<track>`
  src is left empty under nativeVideo so the browser never fetches the document a second time. Repaints: the proxy's `timeupdate`
  (a native tick about once a second, a seek) plus a 250 ms loop while captions are on (the proxy's extrapolated position crosses
  cue boundaries between ticks); CC-off and the teardown stop the loop and the teardown drops the list.
- **Tests:** test/unit/native-video-surface-captions.test.js (5: the port equals the server parser, the lookup's boundaries, the
  overlay following ticks / snapshots / a proxy seek / the loop past a cue end with CC-off and a cached CC-on, a new item and a
  TV episode, the S11 control: the track carries /api/subtitles/:id and the page fetches nothing). tv-player-source A2's pinned
  track-src line updated (the TV claim still holds). **Mutants (9):** C1 overlay reads the track, C2 end inclusive, C3 refetch per
  CC-on, C4 track src under native, C5 loop without repaint, C8 TV fetch, C9 NOTE not skipped (bound after the fixture gained a
  NOTE block with a timing line) - red; C6 (loop not stopped at CC-off) and C7 (list kept across items) survive as EQUIVALENT:
  the loop's own guard ends it on the next beat and the id check refetches for a new item; both lines stay as hygiene.

### W5 - guards and screenshots (2026-10-30)

- **A binding test per ruling** (each mutant below went red in its wave's round):

  | Ruling | Test (test/unit/) | The mutant that proved it |
  |---|---|---|
  | S1 one native player, element = proxy | native-video-surface-contract (RED FIRST, deferral, re-open, fresh page) | M2 deferral, M7 ownedSurface, M9 follow, M10 deferred adopt |
  | S2 audio.* transport, no video.* | native-bridge-video (ONE video message) + contract (one audio.load) | mirror test (schema <-> adapter) |
  | S3 video.surface rect / space / coalesced | native-video-surface-rect (slot, coalescing), -guards (the sequence) | N1 scroll offset, N2 dedupe, N4 space |
  | S3a dock: no picture, thumbnail | native-video-surface-rect (dock / expand) | N3 dock visible, N6 thumbnail |
  | S4 videoSize -> videoWidth, events | native-video-surface-contract (S10 + S4), native-bridge-video | M6 size events |
  | S5 transparent hole | native-video-surface-rect (body class, clip path), the probe (paint measured) | N5 body class |
  | S6 stand-downs | native-video-surface-contract (360 / Feed / preview, transcode), pure builder | M4 readiness, M8 360 |
  | S7 captions from the proxy time | native-video-surface-captions | C1, C2, C3, C4, C5, C8, C9 |
  | S8 CSS fullscreen, never webkitEnterFullscreen | native-video-surface-rect (button, wide window + f key), -guards (rotation) | N13, N14 |
  | S9 hidden is native's | native-video-surface-rect (hidden + pagehide), contract (no prepare-audio) | N9 lifecycle, N10 settings hold |
  | S10 no double progress | native-video-surface-contract (no POST /api/progress) | v1.397.0 D8 guard (pinned by test) |
  | S11 byte-identical without the capability | the CONTROL in every file; -guards (state deepStrictEqual across three realms) | the controls themselves |
- **The fake-host sequence** (native-video-surface-guards): slot -> dock -> expand -> a sideways rotation (the orientation media
  query's change listener, the REAL v1.389.0 path) into the CSS fullscreen -> upright -> a 360 load: exactly six messages, one per
  placement, the sideways one a viewport rect with radius 0; nothing between (a snapshot mid-fullscreen posts nothing).
- **S11 identity:** after the same user sequence (early + full load, dock, expand, CC on, the fullscreen button, a rotation and
  back) the page state (src, poster, controls, proxy accessors, host and body classes, the hole, the track src, the dock, the
  player state, every fetch) is deepStrictEqual across no host, a nativeAudio + nativeVideoAudio host and a host with no media
  capability; the hosts posted nothing but the page-start audio.subscribe (v1.397.0).
- **Screenshots (scripts/native-video-surface-probe.js, headless Chromium, the REAL app with a clip, a fake host injected at
  document start exactly as the app's script is):** watch page 390x844, light and dark, three placements each - the in-page
  player, the docked mini player, the CSS fullscreen; the transparent region outlined in dashed red. Measured per shot: the last
  video.surface (slot: document {0, 72, 390, 219.38} visible; dock: visible false; fullscreen: viewport {0, 0, 390, 844}), the
  hole's even-odd path, and that body / html / wrapper / element all compute transparent while the picture shows. `radius` is 0
  on the phone: the phone layout squares the player box (html.is-phone rules), so the hole is square there too.
  **The probe found an S5 gap the jsdom tests could not:** in the CSS fullscreen the wrapper went transparent but the PAGE behind
  it (the view's content) and the hole layer (the page colour) painted on, and the custom logo image (its own visibility: visible
  inside the hidden header) sat over the picture. Fixed in style.css: under body.ft-native-video.ft-css-fullscreen the hole layer
  is display none, #view-root is visibility hidden with the player wrapper re-shown, and header .logo-img is hidden; the probe
  measures all three (`paintsBehindTheBox`) and exits 1 on any. Headless Chromium paints its own canvas colour in the hole (white
  in light, near-black in dark via the wrapper's color-scheme) - a WKWebView with isOpaque off has none. The six PNGs went to Dean.
  Run: `node scripts/native-video-surface-probe.js <out-dir>` -> `SUMMARY shots=6 claims=1 surfaces=4 ok`.

