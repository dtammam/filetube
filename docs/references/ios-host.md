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
- **If a native audio engine comes, native owns playback while hosted.** The custom web controls stay exactly as they are (as
  in YouTube's app: custom UI, native engine underneath). The web sends intents (play this queue from this index, seek, next);
  native holds the queue, fetches the next radio pick itself (iOS suspends a web view's JavaScript in the background) and sends
  back full state snapshots; the web's own media element is silenced so two audio stacks never fight over the lock screen.
- **Offline is native-only.** Service workers are effectively unavailable in a `WKWebView` whose server address the user types
  (Apple allows them only for at most 10 domains fixed at build time). Offline becomes a native Downloads page and the native
  player, never "the web UI, offline".
- **Native media requests use a media token**, not the web view's cookies (AVPlayer snapshots cookies once), when they come.
- **For Dean first, public-ready later.** Distribution starts as free Xcode installs, then internal TestFlight (no App Review).
  An App Store build is its own decision later and would need: capability flags that hide the YouTube downloader and tone
  down Pocket's click-wheel look in that build (App Review 5.2.3, 5.2), a demo server for reviewers (2.1), and a push relay
  for other people's servers (they will not hold Dean's APNs key).

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
