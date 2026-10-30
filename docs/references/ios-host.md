# FileTube on iOS: the host model (decision record)

Decided 2026-10-11 by Dean, after an Opus Root kickoff and two independent reviews (an architecture skeptic and an iOS
fact-check against Apple's documentation). This is the long-term shape of the iOS app. Change it only with a new dated
section below, never by editing the decision in place.

## The decision

**FileTube on iOS is a host, not a second app.** The server and its web UI stay the one product; every feature is built
once, in the web UI, for every device. The iOS app (`filetube-ios`, its own repo, built on Dean's Mac with Xcode) is a thin
Swift shell that:

1. asks for the server's address (a native screen) and checks it answers as a FileTube server;
2. shows that server's live web UI in a `WKWebView` (the web code is never copied into the app; a web release reaches the app
   the moment the server updates);
3. offers a small set of **capabilities** through a versioned JavaScript bridge, only for what the web cannot do on iOS.

The closest working examples are the Home Assistant iOS app (a self-hosted server's web UI in a web view, the user types the
server address, a native bridge adds what the web cannot) and Basecamp's Hotwire Native "bridge components".

## The rules that keep it boring

- **If the web can do it, it goes in the web.** Native code exists only for a capability the web lacks on iOS.
- **Capabilities, never OS sniffing.** The app announces what it can do (`window.FileTubeHost`, see
  [native-bridge.md](native-bridge.md)); the web uses a capability only when it is announced. Safari, the home-screen PWA and
  every other browser never see one and behave exactly as before.
- **One door in the web code.** Every host-specific call goes through `public/js/host-adapter.js`; no scattered
  `if (inApp)` checks.
- **Native replaces behaviours, not displays.** The web draws everything (Pocket included); native plays a haptic, locks the
  rotation, reports the battery. Native knows nothing about Pocket; the web says "lock portrait" when Pocket opens.
- **The contract is a schema.** [native-bridge.v1.schema.json](native-bridge.v1.schema.json) in this repo is the authority;
  both sides test against it; changes are add-only (never rename or remove inside a major version).
- **Versions both ways.** The app reads the server's `/api/host-info` (app name, version, the bridge versions it speaks)
  before loading the UI and shows a native "server too old / too new" screen instead of a broken page.
- **The bridge is locked to the server.** Native accepts messages only from the main frame of the configured server's
  origin.

## Decisions already made for later steps

- **Spin one keeps the web player.** The app turns on background audio for the existing web player (iOS keeps a web view
  alive while it plays media). A native audio engine is a later, separate step, taken only if the in-app web player still
  has gaps that matter.
- **The native audio engine (built in v1.397.0, the `nativeAudio` capability): native owns playback while hosted.** The custom web
  controls stay exactly as they are (custom UI, native engine underneath, as the big video apps do it). The web sends intents (play
  this queue from this index, seek, next); native holds the queue, fetches the next radio pick itself (iOS suspends a web view's
  JavaScript in the background) and sends back full state snapshots; the web's own media element is silenced so two audio stacks
  never fight over the lock screen. Music and podcasts (Dean, 2026-10-28); since v1.398.0 (`nativeVideoAudio`) a video played as
  AUDIO from Music (a Listen row) too - its picture stays the web player's. A video that is watched and then backgrounded keeps the
  web player's sidecar: the engine cannot be started from the background (the v1.398.0 spike), so the next step is a native video
  surface; since v1.399.0 (`nativeVideo`) a watch-page video's PICTURE too: one native player for sound and picture, drawn in a
  layer below the web view where the page leaves a transparent hole, FileTube's controls on top.
- **Offline is native-only.** Service workers are effectively unavailable in a `WKWebView` whose server address the user types
  (Apple allows them only for at most 10 domains fixed at build time). Offline becomes a native Downloads page and the native
  player, never "the web UI, offline".
- **Native media requests use a media token**, not the web view's cookies (AVPlayer snapshots cookies once): built in v1.397.0 as a
  short-lived `?mt=` query token minted from the device token, accepted only on the audio byte and art routes
  ([offline-api.md](offline-api.md) section 8).
- **For Dean first, public-ready later.** Distribution starts as free Xcode installs, then internal TestFlight (no App Review).
  An App Store build is its own decision later and would need: the `mediaFetch` capability gate (v1.391.0: the web shows its
  server-side downloader UI only when there is no host or the host announces `mediaFetch`, so the store build leaves it out;
  App Review 5.2.3), plain names for Pocket's skins (done in v1.391.0, 5.2), a demo server for reviewers (2.1, see
  [app-review-demo-server.md](app-review-demo-server.md)), and a push relay for other people's servers (they will not hold
  Dean's APNs key).

  The v0.12.0 share actions POST any shared URL to /api/ytdlp/download; the App Store build excludes them.

## Spin one (the proof of concept)

Server address screen and a "can't reach your server" screen; background audio for the existing web player; motion
permission granted silently (no prompt); autoplay without a tap; picture-in-picture and AirPlay allowed; edge to edge; and
four bridge capabilities: Pocket locked upright, the haptic wheel (and Feed swipes), the real battery level in Pocket's status
bar, and a Settings entry that opens the app's server address screen. The web half: [the native-bridge-web plan](../exec-plans/completed/2026-10-11-native-bridge-web.md); the Mac half:
[ios-spike-1.md](ios-spike-1.md).

## Facts this rests on (checked 2026-10-11; recheck before relying on them)

- Free signing installs on Dean's own iPhone from Xcode: 7-day expiry, Developer Mode on, a few apps, no push. TestFlight needs
  the paid program ($99/yr); internal testers (up to 100) need no review; builds expire after 90 days; uploads need Xcode 26 or newer (Dean's Mac runs Xcode 27).
- `WKWebView` traffic never triggers the Local Network prompt; native requests to a LAN address do (even through an HTTPS name
  that resolves to a home IP), so the app triggers it in the foreground during server setup.
- Raw gyro / accelerometer need no permission natively, and the app can grant the web page's own motion permission silently
  (`WKUIDelegate` device-orientation-and-motion permission).
- Core Haptics transient events suit a fast wheel; a bridge `postMessage` is a one-way hop of a few milliseconds.
- iOS builds need macOS and Xcode; cloud macOS runners can build and upload later.

## Addendum 2026-10-11 (v1.385.0): the immersive Pocket, six capabilities

Contract v1 (add-only) grows from four capabilities to six: `statusBar` (the web asks the app to hide and restore iOS's own
status bar; Pocket hides it while the full player is up) and `network` (the app reports the connection type, which Pocket's
status bar shows beside the time and the battery, so there are never two batteries). Signal bars are not possible: iOS gives
apps no public signal-strength API. Details and owners: [native-bridge.md](native-bridge.md) sections 2, 3 and 5.

## Addendum 2026-10-12 (v1.387.0): offline playback, seven capabilities

Contract v1 (add-only) grows from six capabilities to seven: `downloads`. The web asks (`downloads.add` / `downloads.remove` /
`downloads.show`) and displays (`downloads.subscribe` answered by one `downloadsSnapshot`, then `download` deltas); native owns the
files, the catalogue and every download's state, fetches the manifest itself with the per-device token
([offline-api.md](offline-api.md)) and serves a finished copy back to the web player through `localSrc` (its own URL scheme). An
album or season add reports its members with `parentKind` + `parentId`. The server half is [the offline-server
plan](../exec-plans/completed/2026-10-11-offline-server.md); the design is [ios-offline.md](ios-offline.md). Details and owners:
[native-bridge.md](native-bridge.md) sections 2, 3, 5 and 6.

## Addendum 2026-10-28 (v1.399.0): the native video surface, eleven capabilities

Contract v1 (add-only) grows from ten capabilities to eleven: `nativeVideo`. The v1.398.0 background handoff failed its spike on Dean's
iPhone 15 Pro (iOS refuses to activate the audio session from an app already in the background, OSStatus 560557684 '!int'), so the
native player has to own a video from the first frame. Dean chose "native picture, web controls" over Apple's full-screen player
(which loses chapters, scrub previews and subtitle styling) and over a muted web picture chasing native sound (which drifts and
downloads every video twice). On the watch page one native AVPlayer plays a library video's or a TV episode's sound and picture; the
picture is a layer BELOW the non-opaque web view, shown through a transparent hole the page paints exactly where the player box is,
and FileTube's controls, captions, chapters and skins paint on top as before. The web sends the whole-file Item through `audio.load`
(no new transport) and tells native where the picture goes with one new intent, `video.surface` (a rect in CSS px, document space for
the in-page player so native follows the scroll itself, viewport space for the web's own full screen); the docked mini player shows the
thumbnail while the sound continues. Locking the phone or switching apps: native detaches the picture and the sound just continues.
Captions render from the native position. The FileTube half is [the native-video-surface
plan](../exec-plans/active/2026-10-28-native-video-surface.md); details and owners: [native-bridge.md](native-bridge.md) sections 1, 2, 3,
5 and 6 ("Native video (v1.399.0)").

## Addendum 2026-10-28 (v1.398.0): a video played as audio goes native; the background handoff does not, ten capabilities

Contract v1 (add-only) grows from nine capabilities to ten: `nativeVideoAudio`. Dean (2026-10-28, via the iOS Root): "what is needed
for the video to be treated this way - video audio"; he picked the native engine over a full native video player and over a web-only
audio-session fix. The first design handed a PLAYING video's sound to the engine when the app went to the background. The iOS Root's
spike on Dean's iPhone 15 Pro showed iOS refuses it: the page's message reaches the app, but the audio session cannot be activated
from an app already in the background (OSStatus 560557684 '!int'), and pre-activating at willResignActive does not help; so that
handoff was NOT built ([native-bridge.md](native-bridge.md) section 3, "Not built: the background handoff"), and Dean chose a native
video SURFACE (one native player for sound and picture, drawn where the video sits, the web's controls on top) as the next plan.
What v1.398.0 ships: the engine of v1.397.0 accepts two more Item kinds, `video` and `tvEpisode` (the latter reserved for the next
plan); a Listen row (a video played as audio from Music, chapters included) plays natively like a song and tapping Watch takes the
video back to the web player at the sound's position; the media token reaches the two video file routes and the two art routes; the
device token posts TV progress. A video that is watched and then backgrounded keeps the v1.397.0 sidecar. The FileTube half is [the
native-video-audio plan](../exec-plans/completed/2026-10-28-native-video-audio.md); details: [native-bridge.md](native-bridge.md)
sections 1, 3 and 5.

## Addendum 2026-10-28 (v1.397.0): the native audio engine, nine capabilities

Contract v1 (add-only) grows from eight capabilities to nine: `nativeAudio`. Dean (2026-10-28): "Native av player please. IOS only."
Music (native tracks, library audio, chapter rows as clip Items) and podcasts play through the app's own AVPlayer engine, which owns the
audio session and the lock screen; video stays on the web player. The web sends the whole queue up front (`audio.load`) and intents after
it (play, pause, seek, skip, jump, modes, rate, a sleep timer, stop), subscribes for full `audioState` snapshots plus `audioTick`
deltas, and drives its own silenced media element as a proxy of native's state so the dock, the now-playing panels and every skin render
unchanged. Native fetches its media with a short-lived media token in the query (`?mt=`, `POST /api/devices/media-token`), fetches
radio itself and posts progress and plays to the same online routes the web uses. The FileTube half is [the native-audio
plan](../exec-plans/completed/2026-10-28-native-audio.md); details and owners: [native-bridge.md](native-bridge.md) sections 2, 3, 5 and 6;
the token: [offline-api.md](offline-api.md) section 8.
