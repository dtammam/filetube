# filetube-ios spike 1 (the proof of concept) - brief for the Mac session

For a Claude Code session (Opus) on Dean's Mac with Xcode. The decision behind it: [ios-host.md](ios-host.md). The contract:
[native-bridge.md](native-bridge.md) and [native-bridge.v1.schema.json](native-bridge.v1.schema.json) (copy the schema into the
new repo and pin it as "contract v1 from FileTube <commit>"). The web half is a separate FileTube release
([the native-bridge-web plan](../exec-plans/completed/2026-10-11-native-bridge-web.md)); until it ships, the bridge features are
tested with a bundled test page (step 9).

## Outcome (what Dean feels on his iPhone)
1. The app asks for his server's address once, checks it, and opens his FileTube edge to edge, no Safari chrome.
2. Music started in his own web player keeps playing with the phone locked or the app in the background, with lock-screen
   controls, as well as or better than the home-screen PWA.
3. No motion permission prompt, ever; videos and Feed cards start without an extra tap; picture-in-picture and AirPlay work.
4. Pocket stays upright no matter how the phone turns; the click wheel and Feed swipes give real haptic ticks; Pocket's status
   bar shows the real battery (these three once FileTube's web half ships).
5. If the server cannot be reached: a native "can't reach your server" screen with Retry and Change server, never a blank page.

## Setup
- New private repo `filetube-ios` (GitHub, dtammam). SwiftUI app target, iPhone only, minimum iOS 17, bundle id
  `am.tamm.filetube` (Dean can change it before the first TestFlight). Swift only, no third-party dependencies.
- Signing: Xcode > Signing & Capabilities > Team = Dean's Personal Team (free). On the iPhone: Settings > Privacy & Security >
  Developer Mode on (iOS asks for a restart). Free installs expire after 7 days: re-run from Xcode.
- Capabilities / Info.plist: Background Modes > Audio; `UISupportedInterfaceOrientations` lists portrait AND both landscapes
  (the app locks at runtime); `NSLocalNetworkUsageDescription` ("FileTube connects to your own server on your network.");
  ATS: `NSAllowsLocalNetworking` true (plain-http LAN servers; it may not cover a dotted LAN name such as `http://nas.lan`:
  test on the device and add an `NSExceptionDomains` entry if it fails); no `WKAppBoundDomains` (it would break the bridge).
- Give the repo the same working norms as FileTube in a short AGENTS.md + CLAUDE.md (plans in docs/exec-plans, stage by
  name, no force-push, never self-merge, report failures verbatim), and a README.

## Steps
1. **Shell**: an `AppModel` holding the server URL (UserDefaults); first launch shows the server screen, later launches go
   straight to the web view.
2. **Server screen**: a URL field (accept `host`, `host:port`, `http(s)://...`; default https), a Connect button that calls
   `GET <server>/api/host-info` with URLSession (until FileTube ships that route, fall back to `GET <server>/` returning 200 and
   say so), checks `app == "filetube"` and that `bridge.min...max` includes 1, then saves. This native request is what triggers
   iOS's Local Network prompt for a LAN server: do it here, in the foreground. Clear errors: unreachable, not FileTube, versions
   don't overlap.
3. **Web view** (`WKWebView` in a `UIViewRepresentable`, or a UIKit root controller - pick what makes step 7 simplest). Set
   these on the `WKWebViewConfiguration` BEFORE creating the web view (set afterwards they do nothing):
   `allowsInlineMediaPlayback = true`; `mediaTypesRequiringUserActionForPlayback = []`; `allowsPictureInPictureMediaPlayback =
   true`; `allowsAirPlayForMediaPlayback = true`; `scrollView.contentInsetAdjustmentBehavior = .never` and ignore safe areas
   (edge to edge; FileTube's CSS already uses `env(safe-area-inset-*)`); persistent website data store (the login survives
   relaunch). Navigation policy: same origin stays in the app, any other origin opens in Safari. On
   `webViewWebContentProcessDidTerminate`: reload. Load failures: the "can't reach your server" screen (Retry, Change server).
4. **Background audio**: at launch `AVAudioSession.sharedInstance().setCategory(.playback)` and activate it. The web player's
   own Media Session supplies the lock-screen controls. Measure on the device: start music in FileTube, lock the phone, wait
   through two track changes, use lock-screen play / pause / next and AirPods; compare with the PWA. Write the result down
   (this decides whether a native audio engine is ever needed).
5. **Motion**: implement `WKUIDelegate`'s device orientation and motion permission request and grant it for the configured
   server's origin only. Check Pocket's lighting moves with tilt and no prompt appears.
6. **Bridge**: a `WKUserScript` at `.atDocumentStart`, main frame only, defining `window.FileTubeHost` exactly as
   native-bridge.md section 1 (bridge 1, app name/version/build from the bundle, platform 'ios', capabilities
   `orientation, haptics, battery, serverSettings`); a `WKScriptMessageHandler` named `filetube` that accepts a message ONLY when
   `message.frameInfo.isMainFrame` and its security origin equals the configured server's origin, decodes it with `Codable`
   types written from the schema, and ignores unknown types. Native-to-web events: `evaluateJavaScript` of
   `window.dispatchEvent(new CustomEvent('filetube-host', { detail: <json> }))`.
7. **Orientation**: in a SwiftUI app the root is a `UIHostingController`, which does not ask your views: use a subclassed
   hosting controller (or `UIApplicationDelegate.application(_:supportedInterfaceOrientationsFor:)` reading the lock state). Its
   `supportedInterfaceOrientations` returns `.portrait` while locked, `.all` (minus upside
   down) otherwise; on lock / unlock call `setNeedsUpdateOfSupportedInterfaceOrientations()` and, on lock, `requestGeometryUpdate`
   to portrait so a sideways phone turns back at once.
8. **Haptics**: one `CHHapticEngine` (start on `haptics.prepare` or first tick; restart on its reset / stopped handlers); `tick`
   plays a transient: detent (intensity 0.55, sharpness 0.9), letter (0.7, 0.7), snap (0.4, 0.5); `intensity` in the message
   scales it. If Core Haptics is unavailable, fall back to `UISelectionFeedbackGenerator`. Never block the main thread; drop
   rather than queue.
9. **Battery + test page**: `UIDevice.current.isBatteryMonitoringEnabled = true`; on `battery.subscribe` send one `battery`
   event then one per `batteryLevelDidChange` / `batteryStateDidChange` until `battery.unsubscribe` (level -1 = null).
   `host.openServerSettings` presents the server screen. A hidden debug screen (long-press on the server screen's title) loads a
   bundled `bridge-test.html` that has buttons for every message and logs events, so all of this is testable before FileTube's
   web half ships.
10. **Write-up**: a short results doc in the repo (each outcome above: works / doesn't / notes, the background-audio comparison
    with the PWA), and the device checks Dean ran.

## Out of scope for spike 1
A native audio engine, downloads / offline, push, widgets, share sheet, CarPlay, iPad, App Store / TestFlight setup (needs the
paid program), Android.
