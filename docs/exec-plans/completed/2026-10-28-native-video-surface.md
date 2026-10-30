---
plan: native-video-surface
harness: v2 · full
branch: feat/v1.399.0-native-video-surface
anchor: spec
status: Shipped v1.399.0
next: the release PR; Dean's merge word; the tag's Publish run; relay tag + commit to the FileTube Root; device checks (0a)-(0d), (a)-(k)
design: Approved 2026-10-28 (Dean picked "Native picture, web controls" after the v1.398.0 handoff spike failed)
gate: APPROVED r3 @42f1a668 (adversary, qa, security-brief)
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
  "radius >= 0", restored. Bridge tests: 31 pass, 0 fail (video + contract mirror + audio). Frozen sha bf5a26ec, relayed to the
  FileTube Root 2026-10-30 (see W6 below).

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

### W6 - relay (2026-10-30)

- The contract is unchanged since the W1 freeze: schema blob 15647ae3 and host-adapter.js are byte-identical between bf5a26ec and
  the W5 head 7d624835 (`git diff bf5a26ec 7d624835 -- docs/references/native-bridge.v1.schema.json public/js/host-adapter.js` is
  empty; the QA seat re-ran it). Relayed to the FileTube Root with the two native notes (the first video.surface of a load may be
  visible:false; the hole's corners follow `radius`, 0 on the phone layout; set the web view's backgroundColor for the overscroll
  bounce; pinch-zoom is not compensated).

### Gate r1 fix (2026-10-30)

- **CRITICAL (adversary + qa), the transcode-then-claim path.** A video still transcoding at open is a stand-down at load, so the
  web load ran in full (poster, the <track> src, the sidecar settings read, prepare-audio, the armed sidecar); the poll's late claim
  then left all of it. The adversary measured the consequence: a lock-screen pause (native snapshot `paused` while the page is
  hidden) fired the proxy's own `pause`, reached the pause-hidden handoff trigger (which the lifecycle skip does not cover) and PLAYED
  the web sidecar while posting audio.pause back to native - two players, the exact thing S1 forbids. Fix: `applyNativeVideoClaim`
  (player.js) runs at BOTH claim sites - poster off, track src '', bgAudioSettingCached false, the status repoll ended, the sidecar
  src stripped (releaseBackgroundAudioElement), the custom bar, captions re-fed from the proxy time when already on - and the two
  guards W3 removed are back as the adversary prescribed: attemptBackgroundAudioHandoff and armBackgroundAudioSrc refuse under
  nativeActive() for every trigger. The W3 Evidence sentence "never armed for a native video load" was false on this path (the
  lesson: an "unreachable" guard was reachable by a trigger the test never fired - the pause-hidden trigger - and by a load that
  changed owner mid-flight). Bound in the readiness test: poster null, track '', sidecar src null after the claim; captions turned on
  DURING the wait show 'Hello' from the proxy time after it (one fetch); the lock-screen pause plays no sidecar and posts nothing.
  Mutants R3 poster, R4 sidecar src, R5 captions re-feed: red. R1 / R2 (the restored guards): see "Gate r2 fix" below - the r1 claim
  that nothing could reach them was REFUTED by the adversary at r2 (a settings read landing after the late claim).
- **WARNING (adversary + qa), the self-feeding sampler.** holeApply wrote body's class and the hole's style on every sync; a
  same-value write still queues a mutation record, the body-subtree observer heard it (and the player's own per-frame writes: the
  time label's childList), so the controller measured every frame while nothing moved (0 posts, but a layout read + recalc at 60 Hz,
  for a Music track too). Fix: every hole write is idempotent (contains / hasAttribute / last-clip checks), the observers are
  narrowed to the placement signals (body / html class, the wrapper's class, the slot / dock / stage / view-root children, the dock's
  hidden; the wrapper and its container re-pointed at each measure; the document's ResizeObserver and the 1 s backstop cover the
  rest), the sampler schedules only while a surface video is owned, and a track claimed after a surface video closes the surface
  explicitly (the same element is re-claimed, so nothing else fires). Bound: the idle test counts box reads and body / hole attribute
  records over an idle second in the slot, docked and in fullscreen (<= 2 reads: the backstop; 0 records; 0 posts); the video ->
  track test (A5) asserts surfaceOwned false, the closing visible:false, the hole closed, and 0 box reads on a layout event while
  the track plays. Mutants R6 (class add not idempotent), R8 (no surfaceOff on the track claim): red. R7 (clip write not idempotent)
  and R9 (the schedule gate) survive as equivalent: no observer watches the hole's style any more, and surfaceMeasure already
  returns before the read for a non-surface item - both stay as recalc / frame savers.
- **WARNING (adversary A5):** bound by the video -> track test above.
- **SUGGESTIONS:** the misplaced wouldClaimVideo / surfaceOwned comment moved; player-lifecycle-release's prose now says five sites /
  four single-line; the probe removes its three scratch dirs in cleanup; the W6 note above; this frontmatter. A13 (the typeless hold)
  bound in the deferral test (no /api/settings, no prepare-audio for the bare early load); A24 (no live transcode under nativeVideo on
  a wide window) bound by a desktop-realm readiness test; A10 (the post-claim controls mode) bound synchronously after load() in the
  RED FIRST test.
- **INFO disclosed (adversary):** a Listen row in a Music queue re-opened on the watch page under nativeVideo hands back (a Listen
  row, not a surface) and claimVideo re-sends a ONE-item queue (audio.load n=1 at 0, then the carried seek and play): the position
  survives, the Up-next tail is dropped (native reloads the file). No double sound. The pre-v1.399.0 behaviour dropped the queue too
  (native stopped and the web played). A watch page whose full load never arrives leaves the element with no src (a browser would
  have /video/<id>); watch.js shows its fatal error either way.
- Probe after the fix: `SUMMARY shots=6 claims=1 surfaces=4 ok` (the fullscreen measures hold).

### Gate r2 fix (2026-10-30; the adversary's disclosed WARNING, all seats had APPROVED r2 @17fd493d)

- **The slow-settings race.** A video still transcoding at open is a web load; its `/api/settings` read may land AFTER the transcode
  poll claimed the video for native (a slow read, a fast transcode). The callback then set bgAudioSettingCached true again, POSTed
  prepare-audio (a server-side audio extraction for a video native owns) and called armBackgroundAudioSrc - at 17fd493d the two
  restored guards held the line (sidecar null, the lock-screen pause played nothing), so the runtime was correct, but my r1-fix
  sentence "no test can reach them" was false and the guards were load-bearing and unbound. Fix: the settings callback returns under
  `nativeActive()` before the arm line (bgAudioSettingCached false, `bgAudio:arm native` recorded) - no prepare-audio, nothing armed;
  and `surfaceWatchContainer` keeps the dock's `hidden` watched when the dock is the container (a second observe() replaces a
  node's options; the adversary's INFO). Bound by the new race test (a held settings promise released after the poll's claim: no
  prepare-audio, sidecar src null, the hidden paused snapshot plays nothing and posts nothing). Mutants: R10 (the callback's native
  check removed) red; R1 + R2 + R10 removed together (the adversary's scenario) red; R1 or R2 alone still survive - the race is now
  closed upstream of them by a bound check, so they are belt-and-braces behind it, and this time the sentence is measured: the
  combined mutant shows the test catches the failure class whichever line holds it.

### Gate r1

- Gate: APPROVED r1 @7d624835 - security-brief
  - No CRITICAL, no WARNING. Could NOT run `git diff` (no shell): the 21-file list and "package.json untouched" rest on the brief plus package.json as read (version 1.398.0, the same three runtime deps); everything else below is traced in the tree.
  - Verified: `video.surface` is validated at host-adapter.js:109/151/211 (finite numbers, w/h/radius >= 0, enums, boolean; `pick` copies only named fields); the rect comes from the element's own geometry (native-audio.js:389-408), never from content, so a title / comment / Pages article cannot shape it; the clip-path at native-audio.js:447-456 is built from numbers only (`num(parseFloat(...))`, `getBoundingClientRect`).
  - Verified: the Item src is `/api/offline/file/<kind>/` + `encodeURIComponent(String(id))` (native-audio.js:134), art is one of two fixed prefixes (:137-138), title capped at 1024; `audioItemOk` (host-adapter.js:58-69) refuses any other src / art shape before posting. The file route resolves with the token's user (lib/offline/routes.js:223 `mediaVisibleTo`, :273 `tvEpisodeVisibleTo`); MEDIA_SCOPE (lib/auth/device-scope.js:65-72) already covers the route and both art routes since v1.398.0.
  - Verified: captions fetch `/api/subtitles/` + `encodeURIComponent(id)` (player.js:3441), parse without DOM (player.js:1979-2013), render via `textContent` only (player.js:3407); the `<track>` src is '' under the hold (player.js:10459), so one cookie request, not two. The S9 hold skips `/api/settings` and prepare-audio for a held load (player.js:10254, 10340). The dock poster reads `ownedItem.artworkSrc` (the web-built Item), never the snapshot's.
  - Verified: scripts/ is not served (server.js:3587 serves `public` only); `__mintTestSession` is a module export (server.js:3349, 7734), not a route, already used by 9 sibling probes; the probe's DATA_DIR, library and Chromium profile are `mkdtempSync` under os.tmpdir() and the server binds 127.0.0.1. No em dash in any added prose (the 13 / 16 hits in player.js / style.css are older comments).
  - INFO (labeled suspicion, pre-existing since v1.397.0): any script with page execution (an XSS) can call `window.FileTubeHost.post` directly and dispatch `filetube-host` events, bypassing the adapter; the adapter is hygiene, native's clamp (native-bridge.md:197-200) is the real boundary and lives in filetube-ios, which this seat could not read. Ask the iOS Root to confirm the clamp and the below-the-web-view layer are in the app code, not only in the doc.
  - INFO: a spoofed `audioState.videoSize` (needs the same XSS) reaches `POST /api/videos/:id/dimensions` via the proxy (player.js:10499-10531) for a legacy item without stored dims; such a script can POST that directly anyway. No action.
  - INFO: the probe starts Chromium with `--no-sandbox` and leaves its three temp dirs behind; dev-only, loopback-only. No action.

- Gate: CHANGES r1 @7d624835 - qa
  - Instruments (verified, run here): `npm run -s lint` 0 errors, 6 warnings (all pre-existing in public/js/common.js, untouched); `npm run -s lint:ui -- --enforce` OK (TOTAL 3142 = docs/ui-exceptions.json); `npm run -s lint:overlay` clean (0 violations); `bash .harness/lib/check-markers.sh docs/exec-plans/active` clean; `node --test test/unit/native-video-surface-*.test.js test/unit/native-bridge-video.test.js test/unit/native-bridge-contract.test.js` 50 pass, 0 fail; `npm run -s test:unit` on 22.23.1: 10255 tests, 10253 pass, 1 fail, 1 skipped - the fail is test/unit/ytdlp-oneshot-trace.test.js "gate r1 X18 ... msSinceOutput" (`msSinceOutput 295 at 420 ms`, a timing assertion in a file this diff does not touch, run while my Chromium probe shared the box); alone 3/3 runs 21 pass, 0 fail. Node 24 and the integration suite: NOT run by this seat (the builder's dual-Node claim stands unverified here). Contract freeze: `git diff bf5a26ec 7d624835 -- docs/references/native-bridge.v1.schema.json public/js/host-adapter.js` is empty; docs/references/ unchanged since bf5a26ec too.
  - CRITICAL (W2 transcode-then-claim, player.js pollTranscodeUntilReady ~6387 + setupForMedia ~10596): a video whose rendition is transcoding at open is a stand-down at load, so setupForMedia sets `poster=/thumbnail/<id>` (the `!nativeClaimed` branch); when the poll finds it ready `nativeAudioClaim` takes it for native but the poster is never removed. Measured in jsdom (the real player.js + native-audio.js, a nativeVideo host, `/api/videos/t1` pending then ready): after the claim and the first playing snapshot `poster = /thumbnail/t1`, `body.ft-native-video = true`, the last video.surface `visible: true` - the thumbnail paints over the hole for the whole playback (the plan's own words: "a poster would paint over the hole for good"): native sound, a frozen thumbnail, no picture, until the page is re-opened. The same path leaves every per-load native setup undone: the hold was false at load, so `GET /api/settings` + `POST .../prepare-audio` ran and `armBackgroundAudioSrc` primed the sidecar (W2's "the sidecar is never armed for a native video load" is false here; the lifecycle skip still keeps it silent), `ccTrack.src` stays `/api/subtitles/t1`, and CC turned on DURING the wait never shows a caption after the claim (cc active, 0 subtitle fetches, overlay null after ticks: `ensureNativeCueList` / `startNativeCcLoop` only run at CC-on). The W2 test "the readiness rule ... claimed when ready" asserts `src === null` and the proxy but never the poster or the captions (presence, not binding). Fix: at the poll's claim remove the poster, blank the track src, and (if captions are on) run ensureNativeCueList + startNativeCcLoop; bind each in that test.
  - WARNING (native-audio.js holeApply ~430-456 + surfaceWire's MutationObserver ~372): a self-sustaining 60 Hz loop. `holeApply` writes `body.classList.add('ft-native-video')` (visible) or `.remove(...)` (docked, audio, not owned) on EVERY surfaceSync; a no-op token write on an element that has a class attribute still queues an attribute mutation record (spec; jsdom, Blink and WebKit), the observer on body `attributeFilter: ['class', 'hidden']` catches it and schedules the next frame. Measured on the REAL app in headless Chromium (a scratch copy of the probe, 2 s idle, nothing moving): slot visible 119 body-class records, 238 rAF calls, 119 getBoundingClientRect reads, 0 posts; docked 120 / 240 / 120 / 0. In jsdom the same at ~62/s, and ALSO for an AUDIO Item under a nativeVideo host (a Music track, body `mms-on`: 120 rAF, 60 records per second) - every Music session in the new app build spins a layout read + style recalc + attribute write per frame for as long as the proxy is attached. The messages ARE deduped (0 posts), so the contract text holds; but the code comment ("measured once per animation frame when something may have moved ... nothing while nothing moves"), Census C's design ("none while nothing moves") and W3's Evidence ("a 1 s backstop") describe a sampler that does not exist: the backstop is moot and the measure is continuous. Fix: make holeApply idempotent (write the class only when `classList.contains` disagrees, set the clip-path only when the string changed, skip `removeAttribute('style')` when no style is set) and never call surfaceOff/holeApply from surfaceSync for a non-surface item; bind with a test that counts rAF scheduling (or body class records) over an idle second in the slot, docked, and for a track.
  - SUGGESTION (native-audio.js ~754): the trailing comment `} // v1.399.0: native plays the web's video WITH its picture (the watch page's same-id re-open is an adopt, never a hand-back)` sits on wouldClaimVideo's closing brace but describes surfaceOwned two lines above; move it.
  - SUGGESTION (test/unit/player-lifecycle-release.test.js:118-124): the asserts were raised to 5 / 4 but the prose between them still reads "Three of the four sites ... accounts for all 4" (a stale comment next to a changed number).
  - SUGGESTION (scripts/native-video-surface-probe.js): every run leaves three mkdtemp dirs in os.tmpdir() (ft-nvs-probe-*, -lib-*, -chrome-*; ten from the builder's runs are in /tmp now, the Chromium profiles the largest); rm them in cleanup(). `--no-sandbox` + loopback only: acceptable for a dev instrument.
  - INFO: the frontmatter still says `gate: not started` / `status: ... building W2-W6` while r1 verdicts sit in Evidence; update at the fix commit. Also the W5 evidence's probe exit rule and the six PNGs are not re-run by this seat.
  - Security surface (standing section): the only new input reaching native is video.surface, built from the element's own geometry (numbers through num/Math.round, validated by the adapter, clamped by native per the frozen doc); the clip-path string is numbers only; `/api/subtitles/<id>` is fetched same-origin with encodeURIComponent and rendered via textContent; no eval, no HTML from the VTT, no new routes, no dependency change (package.json untouched); the fake host exists only in the probe. No further exposure found beyond the security-brief's labeled INFOs.
  - Verified and sound (no finding): the schema/adapter freeze; the five widened pinned tests still bind their original claims (each regex gained the new conjunct or a line anchor, none loosened to a wildcard); `isNativeHandBackLoad`'s 5th argument; the deferred early load and its adopt-to-load flip; the controls-mode 5th term; `enterFullscreen` returns null to callers that all test `p && p.catch`; the lifecycle skip precedes the handoff branch and the pre-pause candidate is consumed inside it; `#ft-video-hole` z-index `calc(var(--z-sticky) - 31)` = -1 (tokens.css --z-sticky: 30); the even-odd path geometry (arc sweep flags, rad 0 degrades to lines); the VTT port is bound equal to lib/transcript.js on the fixture; no em dash in any added line (0); no TODO/FIXME added.

- Gate: CHANGES r1 @7d624835 - adversary
  - Instruments (all run by this seat; mutants in a /tmp `git archive 7d624835` sandbox with a pristine copy, the worktree untouched): targeted families (`native-video-surface-*`, `native-bridge-video`, `native-bridge-contract`, `native-video-audio-contract`, `native-audio-*`) 103 pass, 0 fail on 22.23.1. Full suite (`node --require ./test/helpers/tmp-cleanup.js --test test/*/*.test.js`, 22.23.1, the sandbox copy): 13072 tests, 13050 pass, 8 fail, 14 skipped, 538 s; ALL 8 fails are `git ls-files` source locks that cannot run without a `.git` (app-settings-store, comment-debt-census, dbjson-never-read, media-items-store, media-record-stores, media-trash-store, media-view-counts-store), re-run in the worktree: 69 pass, 0 fail. Node 24 not run by this seat. (`npm test` itself is refused here by the docs-only pre-tool hook; reported verbatim.)
  - CRITICAL (the same path qa found, with a WORSE consequence than qa's "the lifecycle skip still keeps it silent"): transcode-then-claim (setupForMedia ~10596, pollTranscodeUntilReady ~6387). A video pending transcode is a stand-down at load, so the hold is false: `GET /api/settings` + `POST /api/videos/t1/prepare-audio` run, `armBackgroundAudioSrc` sets `bg-audio-sidecar src=/audio/t1`, `poster=/thumbnail/t1`, `cc-track src=/api/subtitles/t1`. The poll's claim leaves all four in place. Measured (real player.js + native-audio.js, nativeVideo host, settings backgroundAudioForVideo on, prepare-audio ready, `/api/videos/t1` pending then ready): after the claim `poster=/thumbnail/t1` (paints over the hole for the whole session), sidecar `src=/audio/t1`; then the LOCK-SCREEN PAUSE (document hidden, native's snapshot `state: 'paused'`, NO visibilitychange dispatched): `plays=["bg-audio-sidecar"]`, posted `["audio.pause"]`, sidecar `currentTime=30`. The proxy's `pause` reaches `handlePossibleIOSPrePauseHandoff` (player.js:8163) -> `attemptBackgroundAudioHandoff('pause-hidden')` -> the web PLAYS the sidecar at native's position and posts `audio.pause` back to native: the user pressed pause and a second player starts. The S9 skip in handleBackgroundLifecycle does not cover this trigger, and the two guards W3 REMOVED from attemptBackgroundAudioHandoff / armBackgroundAudioSrc as "unreachable behind the hold" are exactly what this path needed. The setupForMedia comment ("This ONE hold is the gate ... every sidecar path ... reads setting off") and W3's Evidence ("the sidecar is never armed for a native video load") are false on this path. The normal (ready) path is clean (measured: no settings read, no prepare-audio, sidecar src null, lock-screen pause -> plays [] posted []). Fix: at the poll's claim run the same per-load native setup (poster off, track src '', bgAudioSettingCached false, sidecar src cleared, captions re-fed), AND put `if (nativeActive()) return false;` back into attemptBackgroundAudioHandoff and armBackgroundAudioSrc (my repro is the mutant that kills it); bind the poster, the sidecar src and the lock-screen pause in the readiness test.
  - WARNING (qa's loop, confirmed independently with my own instrument): `holeApply` writes `body.classList.add/remove('ft-native-video')` on every surfaceSync; a same-value token write still queues an attribute mutation record (Chromium measured: 2 records for a no-op add + remove of an absent token; jsdom 2), the body observer (`attributeFilter: ['class','hidden']`) schedules the next frame. Real page, headless Chromium, 2 s idle in the slot, nothing moving: 120 getBoundingClientRect, 120 body-class records, 0 posts (light); 117 / 117 / 0 (dark). jsdom: 62 measures + 62 class writes per idle second. The 1 s backstop and "nothing while nothing moves" (Census C, the code comment) describe a sampler that does not exist; the messages are deduped so the contract holds. WebKit: per spec the same (should, not measured here: no Playwright library on the box). Fix as qa prescribes (idempotent class / clip-path writes); bind by counting body class records over an idle second.
  - WARNING (binding gap, mutant A5 SURVIVED the committed suite: 35 pass, 0 fail): deleting `ownedSurface = false;` in claim()'s audio branch (native-audio.js ~652) leaves `surfaceOwned()` true after a surface video is followed by a MUSIC track on the same page; measured under the mutant: `surfaceOwned=true`, `body.ft-native-video=true`, the last video.surface `visible: true` for a TRACK (the hole stays open over the Now-playing art, the controls-mode and fullscreen guards treat the track as a surface video). The committed code is correct (pristine: posts `audio.load, audio.play, video.surface{visible:false}`, surfaceOwned false, body class off). No test covers video -> track; add one (LESSONS 2: a survivor on correct code is a WARNING).
  - SUGGESTION (surviving mutants, each a missing binding, the code correct): A13 `wouldClaimVideo` typeless -> false (the "bare early load holds too" claim of W3 has no test: the guards test runs EARLY + VIDEO with the setting OFF); A24 `!nativeVideoOn()` on the liveMode gate (no wide-window + needsTranscode test); A10 `if (nativeClaimed) applyControlsMode()` (the settings `.then` re-runs it a tick later; a one-frame native-strip flash is the only difference). Equivalent-by-construction survivors, no action: A14 the readerHref feed guard (feed.js always sets a feed progressEndpoint), A17 the post-claim surfaceSchedule (the observers fire anyway), A19 the teardown's nativeCueList reset (builder's C7).
  - SUGGESTION (plan doc, claims vs tree): W1 Evidence says "The frozen sha is in the W6 relay note below" and there is no W6 note in the Evidence (grep: W6 appears only in the frontmatter, the Waves list and that sentence); frontmatter `gate: not started` while three r1 verdicts sit here. Also the misplaced closing-brace comment on wouldClaimVideo (qa) and the stale "Three of the four sites" prose in player-lifecycle-release.test.js (qa).
  - INFO (measured, disclose): a Listen row native plays in a queue of 3 (video, track, track) re-opened on the watch page under nativeVideo is a hand-back -> claimVideo, which re-sends a ONE-item queue: posted `audio.load{n:1, pos:0, autoplay:false}`, `audio.seek 250.06`, `audio.play`; the position survives, the Up-next tail (the two tracks) is dropped and native reloads the file. No double sound; autoplay-next is out of scope per the plan, but the Music queue silently ends there.
  - INFO (deferred early load, attack surface 6): deferred -> dock -> full load: `state=docked src=null poster=null`, then the full load claims (1 audio.load, state full). A deferred id never leaks to another id (setupForMedia resets it; the adopt override checks `=== id`). If the full /api/videos/:id load never arrives, the element has no src under nativeVideo (a browser would still have /video/<id>); watch.js shows its fatal error either way. Acceptable.
  - Verified (positive evidence, measured): S5 pixel transparency with a transparent canvas (`Emulation.setDefaultBackgroundColorOverride a=0`, the WKWebView isOpaque=false analogue) on the real watch page 390x844: slot centre and corner rgba(0,0,0,0) in light and dark, just outside the box opaque page colour; CSS fullscreen (0,0..844) alpha 0 at the top, centre and corner, the control bar's band rgba(0,0,0,204) over the bottom; no ancestor of #media-player paints a background in either placement. Mutants killed by name (18): hand-back guard, deferred adopt override, deferred src, S9 skip, S10 save guard, cue end exclusive, closing visible:false, scroll offset (the rect test's scrollY path is NOT vacuous), fullscreen clip clear, dock poster removal, dedupe, claimVideo follow, track src empty, hole class removal, enterFullscreen guard, fs-button arm, NOTE/STYLE skip, videoSize floor. Security standing section: the adapter rejects non-finite numbers (host-adapter.js:211) and the web builds the rect from `num()`-guarded geometry only; nothing new beyond the security-brief's labeled INFOs.

### Gate r2

- Gate: APPROVED r2 @17fd493d - security-brief
  - Delta re-check (no shell; traced in the tree at 17fd493d). No CRITICAL, no WARNING. Nothing new reaches native or a URL: the only posts remain `audio.*` and `video.surface` through the same adapter table (surfaceOff's closing `visible: false`, native-audio.js:395, is the same validated path).
  - Verified `applyNativeVideoClaim` (player.js:10244-10253): element-only writes (poster removed, `ccTrack.src = ''`), the settings cache set false, the repoll timer cleared, `releaseBackgroundAudioElement()`, `applyControlsMode()`, and the caption re-feed through the same `ensureNativeCueList` (`/api/subtitles/` + `encodeURIComponent(id)`, `textContent` render). It closes the one cookie-side gap I had marked verified only for the ready path: a late (transcode-poll) claim no longer leaves `/thumbnail/<id>` as poster, `/api/subtitles/<id>` on the track, or an armed `/audio/<id>` sidecar, so no second media request and no second player.
  - Verified the restored guards: `attemptBackgroundAudioHandoff` (player.js:4059) and `armBackgroundAudioSrc` (player.js:3990) refuse under `nativeActive()`; a lock-screen pause can no longer start the web sidecar beside native (the adversary's repro).
  - Verified DOM-only: the `holeClip` memo (native-audio.js:204, :462, :471, :485) is a string compare of the numbers-only path; the observer targets (native-audio.js:376-381, :432-433) are class / childList / `hidden` on fixed ids and the wrapper's container; `surfaceSchedule` gated on `ownedSurface && ownedId` (:355); the audio claim's `surfaceOff` (:682) only hides a layer that was showing. No new string from a descriptor reaches a style, a URL or the bridge.
  - Verified the probe: cleanup now `rmSync`s exactly the three `mkdtempSync` dirs it created (scripts/native-video-surface-probe.js:120; my r1 INFO 3 closed). Still dev-only (scripts/ not served), loopback-only.
  - No em dash in the delta's prose (0 hits across the plan doc, probe, native-audio.js and the four surface tests). package.json: not re-read; the brief lists no change to it.
  - r1 INFO 1 (the adapter is hygiene, native's clamp is the boundary, in filetube-ios) and INFO 2 (a spoofed `videoSize` needs page-script execution) stand unchanged as labeled suspicions; no action on this branch.
- Gate: APPROVED r2 @17fd493d - qa
  - Instruments (verified, run here at 17fd493d): `npm run -s lint` 0 errors, 6 warnings (the same pre-existing common.js six); `npm run -s lint:ui -- --enforce` OK (TOTAL 3142 = docs/ui-exceptions.json); `npm run -s lint:overlay` clean (0 violations); `bash .harness/lib/check-markers.sh docs/exec-plans/active` clean; the targeted set (`native-video-surface-*`, `native-bridge-video`, `native-bridge-contract`, `player-lifecycle-release`) 92 pass, 0 fail; `node --test test/unit/player-*.test.js test/unit/native-*.test.js test/unit/tv-player-source.test.js test/unit/watch-chrome-ambient.test.js` 1084 pass, 0 fail, 0 skipped. The full unit suite and Node 24: not re-run at r2 (r1's one fail was an untouched timing test, 3/3 green alone). No em or en dash in the fix's added lines (0).
  - CRITICAL (transcode-then-claim): FIXED, differently and better than prescribed. `applyNativeVideoClaim` (player.js ~10244) runs at both claim sites and also disarms the sidecar (`bgAudioSettingCached = false`, the repoll cleared, `releaseBackgroundAudioElement`), and `attemptBackgroundAudioHandoff` / `armBackgroundAudioSrc` refuse under `nativeActive()`: the adversary's repro (the proxy's own pause at a lock-screen pause reaching the pause-hidden trigger) showed my r1 sentence "the lifecycle skip still keeps it silent" was wrong, and the restored guards close the path I had misjudged. Re-measured with my own r1 probes against 17fd493d: after the poll's claim `poster = null`, track src '', controls off, body.ft-native-video on, the last surface visible; CC turned on DURING the wait shows 'Hello' after the claim with ONE subtitle fetch (r1: 0 fetches, null); CC turned on after the claim: 1 fetch, 'Hello'. The readiness test now binds poster / track / sidecar src / the captions re-feed / the hidden paused snapshot (no sidecar play, nothing posted). The `nativeActive()` guards change nothing for a Listen row or a track (the handoff was already video-only) nor for a stand-down video (nativeActive false). In a browser `applyNativeVideoClaim` is unreachable (only after a true claim); the S11 identity test still passes.
  - WARNING (the self-feeding sampler): FIXED as prescribed plus the narrowed observers. Re-measured on the REAL app in headless Chromium (my scratch idle probe regenerated from the fixed script, 2 s idle each): slot 0 body-class records, 2 getBoundingClientRect reads (the 1 s backstop), 0 posts; docked 0 / 2 / 0; CSS fullscreen 0 / 2 / 0 (r1: 119-120 records and reads per 2 s). The 122 rAF calls per 2 s that remain are the player's own fill loop, not the controller (the box is read twice). jsdom: slot and dock 1 read per idle second, 0 records; an AUDIO Item under a nativeVideo host (Music, body `mms-on`) 0 records (r1: 60/s). The code comment and the W3 "backstop" sentence are true now. Narrowed observers, every census placement change traced to a signal: slot <-> dock <-> stage = the containers' childList (slot / dock / stage at wire time, the current container re-pointed per measure) plus the player's explicit `nativeSurfaceSync()` at mount / dock / setCssFullscreen; CSS fullscreen = the wrapper's class + the explicit sync; rotation and the keyboard = resize / orientationchange / visualViewport; aspect, portrait clamps, cap height, sidebar / theatre = the element's own ResizeObserver (the box changes size); content growing above the box = the document's ResizeObserver, and anything that only translates the box without resizing anything (the minimize transform was never observable before either) = the 1 s backstop. Observing an already-observed node again is a spec no-op; stale (rebuilt) slot nodes are harmless. No regression found.
  - SUGGESTIONS: all three fixed as prescribed (the surfaceOwned comment is on its own line, wouldClaimVideo's brace is bare; the lifecycle test prose reads "Four of the five ... all 5"; the probe's cleanup `rmSync`s DATA_DIR, the library and the profile - verified: my r2 probe run left 0 new dirs in /tmp, the 15 present predate it). INFO: the frontmatter now carries the gate state.
  - New in the fix, checked: `surfaceOff` cancels a pending frame; `surfaceSchedule` is gated on `ownedSurface && ownedId` (claimVideo sets both before `attach`, so the first measure still runs); the audio claim after a surface calls `surfaceOff` on the same element (bound by the new video -> track test, 0 box reads on a layout event); `holeClip` memo compares the numbers-only string. Security surface unchanged: no new input reaches native, a URL or a style; the restored guards only refuse.
- Gate: APPROVED r2 @17fd493d - adversary
  - Instruments (run by this seat at 17fd493d; mutants in a fresh /tmp `git archive 17fd493d` sandbox, pristine-diffed and removed; the worktree untouched): targeted families + player-lifecycle-release / player-offline-local-src / tv-player-source / player-form-factor: 184 pass, 0 fail (22.23.1). Full suite in the sandbox copy: 13075 tests, 13053 pass, 8 fail, 14 skipped; the 8 are the same `git ls-files` source locks that cannot run without a `.git` (app-settings-store, comment-debt-census x2, dbjson-never-read, media-items-store, media-record-stores, media-trash-store, media-view-counts-store), re-run in the worktree: 69 pass, 0 fail. Node 24 not run by this seat.
  - CRITICAL r1 (transcode-then-claim): FIXED, differently and better than prescribed (applyNativeVideoClaim at both claim sites + the two restored guards). My T1 repro re-run on the real player.js: after the late claim poster null, track src '', sidecar src null, controls absent; the lock-screen pause (document hidden, native snapshot paused, no lifecycle event): plays [], posted [], sidecar still null.
  - WARNING r1 (the 60 Hz loop): FIXED as prescribed plus narrowed observers. Re-measured on the REAL page in headless Chromium (my own idle probe, 2 s idle each, light and dark): slot 2 getBoundingClientRect / 0 body-class records / 0 posts, DOCKED 2 / 0 / 0 (last surface visible:false at the dock's rect), CSS fullscreen 2 / 0 / 0 (the 2 are the 1 s backstop; r1 was 120 / 120 / 0). The hole still measures alpha 0 at the box centre and corner in the slot and across the fullscreen viewport, no painting ancestor.
  - WARNING r1 (A5 binding gap): FIXED. Mutant A5 re-applied to 17fd493d (the `ownedSurface = false ... surfaceOff` line removed): the new video -> track test goes red (28 pass, 1 fail by name).
  - WARNING (new, safe to ship DISCLOSED - argued below): the fix's Evidence says of the restored guards "R1 / R2 survive: with the cleanup in place the setting cache is false for every native load, so no test can reach them - they are belt-and-braces". REFUTED by measurement: a `/api/settings` response that lands AFTER the poll's late claim (a slow settings read, a fast transcode: the hold was false at load, so the read was fired; the claim then runs applyNativeVideoClaim; the response arrives next) sets `bgAudioSettingCached = true` again, POSTs prepare-audio and calls armBackgroundAudioSrc. On the committed code the guards hold: sidecar src null, lock-screen pause -> plays [], posted [] (verified). With R1 + R2 removed (the mutant): sidecar `src=/audio/t1`, lock-screen pause -> plays ["bg-audio-sidecar"], posted ["audio.pause"] - the r1 CRITICAL again. So the two guards are LOAD-BEARING on a real race, not belt-and-braces, and no committed test binds them (the same reasoning - "unreachable behind the hold" - is how W3 deleted them the first time). Why safe to ship disclosed: the runtime at 17fd493d is correct under every scenario I constructed including this race; what is wrong is one Evidence sentence and a missing binding. Required before the next deletion-by-reasoning can happen: add the late-settings race as a test (settings deferred until after the poll's claim, then the lock-screen pause; it kills R1 + R2 by name) and correct the Evidence sentence - a test + doc change that can ride the release commit.
  - INFO (same race, committed code): the late settings response still fires one `POST /api/videos/t1/prepare-audio` for a video native already owns (a server-side ffmpeg extraction queued for nothing). A `nativeActive()` check before that POST in setupForMedia's settings `.then` would close it; disclose or fold into the test above.
  - INFO (introduced by the fix, reasoning only, no runtime effect found): `surfaceWatchContainer` re-observes the wrapper's container with `{ childList: true }` at each measure; when docked that container is `#player-dock`, which surfaceWire observed with `{ attributes: ['hidden'], childList }` - a second observe() on the same target REPLACES the options (DOM spec), so after the first docked measure the dock's `hidden` flips are no longer observed. The player calls syncSurface explicitly at dock / expand, so every real transition is still frame-exact (the placement-sequence test passes); a later expand-by-attribute without that call would wait for the 1 s backstop. Merge the dock's two option sets if the container is the dock.
  - Verified, nothing else new: surfaceOff cancels the pending frame; the schedule gate (claimVideo sets ownedSurface before attach, so the first measure runs; the persisted pageshow re-send still runs while owned); the narrowed observers plus the document ResizeObserver, the explicit syncs and the backstop cover slot / dock / stage / fullscreen / rotation (the W5 sequence test is green); the A10 / A13 / A24 bindings are real (each regex or assert checks the behaviour, not presence); the W6 note exists now and the frontmatter reads r1 CHANGES fixed; the probe removes its three scratch dirs; the misplaced comment and the lifecycle prose are fixed as prescribed.

### Gate r3

- Gate: APPROVED r3 @42f1a668 - security-brief
  - Delta re-check (no shell; traced in the tree at 42f1a668). No CRITICAL, no WARNING, no new INFO. No URL, style or bridge message changed.
  - Verified player.js:10378: in the `/api/settings` callback, `if (nativeActive()) { bgAudioSettingCached = false; recordLifecycleEvent('bgAudio:arm', { detail: 'native' }); return; }` sits after `trySidewaysFullscreen()` and BEFORE the `bgAudioSettingCached` branch, so a settings response landing after the transcode poll's claim neither POSTs `/api/videos/<id>/prepare-audio` (closing the adversary's r2 INFO: no server-side extraction queued for a video native owns) nor arms the `/audio/<id>` sidecar. The r2 guards at :3990 and :4059 remain the second line.
  - Verified native-audio.js:434: `surfaceMo.observe(container, ...)` picks `{ childList, attributes, attributeFilter: ['hidden'] }` only when `container.id === 'player-dock'`; observer options only, DOM-only, nothing reaches native or a style.
  - No em dash in the delta (0 hits across the plan doc, native-audio.js and native-video-surface-contract.test.js). The new race test is a test file only.
  - r1 INFO 1 (native's clamp is the boundary, in filetube-ios) and INFO 2 (a spoofed `videoSize` needs page-script execution) stand as labeled suspicions; no action on this branch.
- Gate: APPROVED r3 @42f1a668 - qa
  - Instruments (verified, run here at 42f1a668): `npm run -s lint` 0 errors, 6 warnings (the same pre-existing common.js six); `npm run -s lint:ui -- --enforce` OK (the live debt equals docs/ui-exceptions.json); `npm run -s lint:overlay` clean (0 violations); `bash .harness/lib/check-markers.sh docs/exec-plans/active` clean; the targeted set (`native-video-surface-*`, `native-bridge-video`, `native-bridge-contract`, `player-lifecycle-release`, `player-offline-local-src`, `player-form-factor`, `tv-player-source`) 132 pass, 0 fail. 0 em or en dashes in the delta's added lines.
  - Delta verified against the brief (`git diff 17fd493d..42f1a668`: 4 files, +85 / -8): player.js adds ONE line in the settings callback (~10378) - `if (nativeActive()) { bgAudioSettingCached = false; recordLifecycleEvent(...); return; }` placed AFTER `bgAudioSettingCached` / `mobileCustomPlayerCached` / `preExtractAudioCached` / `bgAudioSyncPositionCached`, `applyControlsMode()` and `trySidewaysFullscreen()` and BEFORE the `!bgAudioSettingCached` arm line, so the early return skips only the prepare-audio POST, `declarePlaybackAudioSession`, `armBackgroundAudioSrc` and the repoll; the cache flags above it are unchanged. The block it sits in is gated `data.type !== 'audio' && (!data.statusUrl || data.prepareAudioUrl) && isMobileFormFactor() && bgAudioEl`, so no audio load (a track, a Listen row) ever reaches it, and for a non-native mobile video `nativeActive()` is false (the claim stopped native): no behaviour change outside the slow-settings race. native-audio.js (~434) changes only the dock's observer options to `{ childList, attributes, attributeFilter: ['hidden'] }` when the dock is the container, so the per-measure re-point no longer replaces the wire-time hidden watch (observe() on a node replaces its options). The new race test holds the `/api/settings` promise until after the poll's claim and binds: no prepare-audio, sidecar src null, the hidden paused snapshot plays nothing and posts nothing. The plan's "Gate r2 fix" section matches the tree (R10 red; R1 / R2 alone survive behind the now-bound upstream check, disclosed).
  - Nothing new introduced: my r1 jsdom probes and the idle Chromium measure are untouched by this delta (no observer target or hole write changed except the dock's option set, which fires once per dock / expand). INFO: the frontmatter's `next:` still says "gate r2 with the same seats" (status and gate lines are current); update at close-out.
- Gate: APPROVED r3 @42f1a668 - adversary
  - Instruments (run by this seat at 42f1a668; mutants in a fresh /tmp `git archive 42f1a668` sandbox, pristine-diffed and removed; the worktree untouched): targeted families + the four pinned player tests: 185 pass, 0 fail (22.23.1). Full suite in the sandbox copy: 13076 tests, 13054 pass, 8 fail, 14 skipped; the 8 are the same `git ls-files` source locks that need a `.git` (7 files), re-run in the worktree: 69 pass, 0 fail. Node 24 not run by this seat.
  - My r2 WARNING (the slow-settings race) FIXED as prescribed and bound. My own race repro (a held /api/settings released after the poll's claim, then the hidden paused snapshot) on the committed code: prepare-audio POST 0, sidecar src null, plays [], posted [] (r2 had 1 wasted POST). T1 (transcode-then-claim + lock-screen pause) still clean: poster null, track '', sidecar null, plays [], posted [].
  - The builder's mutant claims re-measured and all TRUE: R1 + R2 removed alone -> everything green (the race is now closed upstream by the callback check, so the corrected Evidence sentence is accurate this time); R10 (the callback check) removed alone -> the committed race test red (prepare-audio 1) and my repro red; R1 + R2 + R10 removed -> sidecar `src=/audio/t1`, plays ["bg-audio-sidecar"], posts audio.pause, caught by the committed race test. The guards' doc now matches measurement.
  - My r2 INFO (the dock's `hidden` observation replaced by the container re-observe): fixed (the dock keeps `{ childList, attributes: ['hidden'] }` when it is the container).
  - S11 on the new line (player.js:10378, reasoning): the settings fetch is issued at :10363 while the synchronous claim / stop runs later in the same setupForMedia call (:10582 / :10610), so on a browser or a pre-nativeVideo build `nativeActive()` is false by the time the callback runs for a web video - the new return is unreachable there, and `applyControlsMode()` / `trySidewaysFullscreen()` still run before it as before. Nothing else new in the 3 source lines.

### The release suites and the close-out binding (RELEASING.md step 1)

- **Suites before the gate (7d624835):** Node 22.23.1 `npm test`: 13072 tests, 13059 pass, 0 fail, 13 skipped; Node 24.20.0 `npm test`:
  13072 tests, 13059 pass, 0 fail, 13 skipped.
- **The gate closed at 42f1a668:** adversary, qa and security-brief all APPROVED r3 at that sha (r1 CHANGES: the transcode-then-claim
  CRITICAL and the 60 Hz sampler WARNING; r2 APPROVED with the adversary's disclosed slow-settings race; r3 APPROVED).
- **The close-out (this commit) is release bookkeeping only:** the version fields of package.json / package-lock.json (1.398.0 ->
  1.399.0), docs/releases.json, ROADMAP.md (the Planned bullet becomes the Shipped entry), docs/DEVICE-CHECKS.md ((0a)-(0d),
  (a)-(k)), docs/LESSONS.md (a section 2 line and a section 4 line), this plan's move to completed/ and its frontmatter, and the
  plan-path comment line (active/ -> completed/) in docs/references/ios-host.md, public/css/style.css, public/js/host-adapter.js,
  public/js/native-audio.js, public/js/player.js, scripts/native-video-surface-probe.js and the five native-video-surface /
  native-bridge-video test headers. No seat re-check (Dean's ruling, 2026-10-12); bound in the next docs commit with
  `git diff --name-only 42f1a668..HEAD`, `git diff 42f1a668..HEAD -- package.json package-lock.json` (version lines only), the
  comment-only check on the code / test files, and the release suites on the bookkeeping tree.

### Device checks Dean owes (docs/DEVICE-CHECKS.md "Native video surface (v1.399.0)", after the iOS app build that pins this tag)

- (0a) the hole, (0b) scroll following, (0c) lock with the layer detached, (0d) rotation - the spike that never ran; a failure is a
  re-root-cause, not a re-patch.
- (a) picture in place + controls on top, (b) scroll, (c) lock, (d) a call ducks and releases, (e) fullscreen and rotation with the
  page never showing through, (f) captions in sync (turned on early too), (g) the dock shows the thumbnail and expand returns the
  picture, (h) 360 / Feed / preview on the web element, (i) a TV episode resumes and saves once, (j) a video still converting plays
  natively afterwards with no thumbnail stuck over it, (k) an app build without nativeVideo unchanged.
