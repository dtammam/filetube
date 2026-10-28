---
plan: native-video-surface
harness: v2 · full
branch: feat/v1.399.0-native-video-surface
anchor: spec
status: Ready to build (W1 waits on the iOS Root's surface spike)
next: Step 0 (census, red first); W1 freezes only after the spike result is relayed
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
| S3 | ONE new intent, **`video.surface`** `{ rect: {x, y, w, h}, space: 'document' \| 'viewport', visible, fit: 'contain' \| 'cover', radius }`, in CSS px. `document` rects are for the in-page player (on the watch page the document scrolls: `document.scrollingElement` is `<html>`, player.js ~5726), so native follows `webView.scrollView.contentOffset` itself with no message per scroll frame. `viewport` rects are for fixed placements (the `#player-dock` mini player, CSS fullscreen). The web sends it on any layout change of the player box, coalesced to one per animation frame. `visible: false` hides the layer; the sound is unaffected. | Root (the space split is pending the spike) |
| S4 | audioState gains **`videoSize {w, h}`** (additive), the presentation size. The proxy answers `videoWidth` / `videoHeight` from it, and fires `resize` and `loadedmetadata` as an element would. | Root |
| S5 | The web leaves the surface region TRANSPARENT: the player box and every ancestor up to the root paint no background behind the picture while `nativeVideo` owns it. The controls, captions, chapter markers and skins paint on top as today. | Root |
| S6 | What stays on the web element under `nativeVideo` (the stand-down list, extended): a **360 / VR** video (vr-view.js reads the element into WebGL), the **Feed**, hover **previews** (`/preview/:id`), read-aloud, and anything that isn't a library `video` or a `tvEpisode`. A load of any of those stops native first (the v1.397.0 rule). | Root |
| S7 | Captions render from the PROXY's time. Today they come from `TextTrack.activeCues` of a `<track>` on the element (player.js `renderActiveCueOverlay`), and an element with no media never advances its cues. Under `nativeVideo` the overlay is fed by a cue list the web parses from the same `/api/subtitles/:id` VTT and looks up by `currentTime`. It's the same overlay and the same look, and without the capability it's byte-identical. | Root |
| S8 | Fullscreen under `nativeVideo` is the CSS fullscreen (`#player-wrapper.css-fullscreen`), with a `viewport` surface rect. `webkitEnterFullscreen` is never called: there's no media in the element to present. Rotation is the web's layout plus a new rect. | Root |
| S9 | Backgrounding is native's business. Native detaches the player from its layer so the sound continues, and reattaches it on foreground. The web's background-audio path (`attemptBackgroundAudioHandoff`, the sidecar) is INERT for a `nativeVideo` load, and nothing is sent at hidden. | Root, from the v1.398.0 spike |
| S10 | Progress, resume and watched state: native posts `/api/progress` or `/api/tv/progress` (v1.398.0 V4/V5). The web's own progress save for a proxied video is suppressed, so it's never saved twice. A view is counted (`POST /api/videos/:id/view`) by the web at play, as today. | Root |
| S11 | Browsers, the PWA, desktop and app builds without `nativeVideo`: byte-identical. | Root |

## The contract additions (bridge v1, add-only; freeze in W1 AFTER the spike result)

- Capability `nativeVideo`.
- Intent `video.surface` (S3).
- audioState field `videoSize` (S4), present only for a video Item.
- native-bridge.md: a "Native video (v1.399.0)" section with S1-S3, S5, S8 and S9 in the doc's register, and the S6
  stand-down list. ios-host.md: an addendum.

## The iOS Root's surface spike (feasibility; its result decides S3 and is a Step 0 gate for W1)

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

1. **W1 - the contract** (after the spike). Schema, host-adapter, docs, and contract tests. Send the schema sha to the
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

- The spike fails (1) or (3): STOP.
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

- (a) A video plays with its picture in place; the controls, scrub previews, chapters and skins all work on top of it.
- (b) Scroll the watch page mid-video: the picture moves with the page and doesn't lag.
- (c) Lock mid-video: the sound continues at full quality. Pause and resume from the lock screen and AirPods. Unlock: the
  picture is at the right frame.
- (d) A voice memo or call mid-video: FileTube yields. Afterwards no other app is ducked.
- (e) Fullscreen and rotation: no flash, no misplaced picture.
- (f) Captions on: in sync, and they look as before.
- (g) Navigate away (docked player), then back: the picture follows.
- (h) A 360 video, a Feed video and a preview play exactly as before.
- (i) A TV episode resumes where it was left, and its progress is saved once.
- (j) An app build without `nativeVideo`: everything exactly as before.

## Evidence (builder fills)
