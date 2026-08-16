# iOS PWA notes - the platform lore FileTube has paid for

Status: LIVING REFERENCE (updated 2026-08-16, iOS 26.6 era). Everything
here is device-tested on Dean's hardware or sourced from cited platform
documentation/bugs - when iOS changes, re-test before trusting a line.
This is the "future tweaks" file: each section ends with its revisit
trigger. Code references were HAND-verified against source on 2026-08-16
(the gate's truth pass) - NOTE: the docs censuses sweep markdown links and
docs/*.md backtick paths only, NOT this file's `public/...` references, so
a future rename can rot them silently; re-verify on read.

## 1. The multi-PWA audio coupling (UNSOLVED - the big one)

Symptom: multiple self-hosted home-screen web apps; closing ONE kills
another's background audio; foregrounding the victim (or ANY coupled
sibling) resumes it.

Evidence timeline (all Dean's device unless noted):
- v1.121 (2026-08-14): killing sibling PWA-B suspends FileTube's audio;
  foregrounding FileTube revives it. Manifest `id`/scope changes: NO
  effect. Control Center attribution picks an arbitrary group member
  (section 5).
- 2026-08-16 E1: closing Squoosh (unrelated, offline-capable PWA) does
  NOT kill FileTube audio; closing any tamm.am sibling kills it for
  audio, podcast, and video alike -> looked registrable-domain-scoped.
- 2026-08-16 E3-free-variant: a FileTube install from the RAW LAN IP
  (`http://10.x.x.x:8082` - an origin with NO registrable domain) coupled
  IDENTICALLY to the tamm.am siblings. **The registrable-domain hypothesis
  is FALSIFIED.** The true grouping criterion is unknown; live suspects:
  offline/cached app (Squoosh has a full service-worker cache) vs
  live-network media apps, or a WebKit process-pool/app-switcher
  dimension invisible to the page.
- Cross-referenced platform state: WebKit routes media through shared
  GPU-process machinery with documented Web/GPU-process AudioSession
  desync bugs; iOS 26.0 shipped a broad PWA audio regression (breaks
  across apps, needs reboot) that 26.1/26.2 substantially improved but
  did not eliminate (MacRumors thread 2466839; webkit.org bugs 261554,
  198277, 203293).

What does NOT fix it (all tested): manifest id/scope; a different
registrable domain (falsified above); `navigator.audioSession.type =
'playback'` (section 2 - actively WORSE).

Current stance: PARKED website-side. Remaining paths: an Apple Feedback
report (the evidence set above is unusually clean; draft on request) and
the native-shell route (section 6).

Revisit trigger: any iOS major release; Apple Feedback response; a
reproducible discovery of the true grouping criterion (e.g. testing a
fully-offline FileTube-like app, or a NON-media self-hosted sibling).

## 2. `navigator.audioSession.type = 'playback'` - handle with care

- v1.35: declared on the VIDEO background-audio arm path (settings-gated).
  Device-passed since v1.35 (2026-07-13). UNCHANGED, still shipped.
- v1.136.0 (2026-08-16): extended unconditionally to plain-audio items.
  **Device result on iOS 26.6: WORSE** - audio stopped the moment the app
  was backgrounded; a foregrounded same-domain sibling RESUMED it (the
  coupling of section 1 operating in both directions). Matches the
  webkit.org/b/261554 class (suspension despite type='playback').
- v1.136.1 (same day): demoted to a device-local experiment toggle,
  Setup -> Playback, DEFAULT OFF (`filetube_audio_session_declare`,
  literal '1' only). The audio path with the toggle off is byte-identical
  to pre-v1.136.
- A/B caveat: the video arm's declaration is ONE-WAY per page session -
  toggle-off music tests need a fresh session that never armed a video.

Evidence instrument for every experiment in sections 1-2: the
?debugLifecycle=1 overlay (Setup -> "Show lifecycle debug log") - since
v1.136 it records ONE `audioSession:declare` line per page load, always
('type=playback' | 'already-playback'), so a repro carries proof of
whether the declaration was live. Screenshot AT the repro moment (the
30-entry ring buffer evicts).

Revisit trigger: an iOS release notes change to the Audio Session API, or
webkit.org/b/261554 closing as fixed - then re-run the toggle experiment.

## 3. Background audio + lock behavior (working as designed)

- AUDIO items (music/podcasts/books): ONE continuous stream plays through
  lock/background (the original file, or its server-side m4a rendition
  for browser-incompatible sources like ALAC) - no lock-time element
  swap, so continuity is perfect by construction.
- VIDEO items: iOS will not play video in a backgrounded PWA. At
  lock/background the player hands off to a hidden audio element playing
  a pre-extracted `.m4a` sidecar (`public/js/player.js`, the v1.27
  machinery; pre-sync tuning v1.121). Two INHERENT artifacts Dean has
  confirmed on-device: a very short gap at handoff (tuned near-zero), and
  a slight quality delta - the sidecar is an AAC RE-EXTRACTION.
  FUTURE TWEAK (cheap, unbuilt): raise the sidecar extraction bitrate, or
  stream-COPY the audio track when the source is already AAC (no
  re-encode, zero quality loss).
- The pre-pause/gesture classification machinery distinguishing USER
  pauses from iOS SYSTEM pauses is battle-won - reuse, never rebuild.

Revisit trigger: the sidecar quality tweak is a one-wave item whenever
Dean wants it.

## 4. Install-origin matrix (what each install type can do)

- HTTPS domain install (the normal case): everything - service worker
  (web push), Media Session (lock-screen controls), full PWA UX.
- RAW-IP / HTTP install (tested 2026-08-16): installs and plays fine;
  NO service worker -> NO web push on that install; Media Session on an
  insecure context is UNVERIFIED (probe if ever needed). Useful as a test
  rig; not a keeper.
- Each home-screen install is its own isolated storage world (login,
  device-local prefs) - server-side state is shared through the API.

Revisit trigger: if push is ever wanted on a test-rig install, probe
Media Session on an insecure context first (unverified above).

## 5. Control Center / Now Playing attribution (UNFIXABLE website-side)

Tapping the Now Playing tile can open the WRONG sibling PWA while
FileTube's audio keeps playing underneath (v1.121, device-confirmed;
survives app delete+re-add; manifest changes don't help). iOS picks an
arbitrary member of the coupled group (section 1). Workaround: the app
switcher. A native shell fixes attribution outright (section 6).

Revisit trigger: any iOS major release ("unfixable website-side" holds
only until Apple changes attribution grouping).

## 6. The native-shell assessment (the known full fix)

- A BARE WKWebView wrapper does NOT fix background audio - HTML5 audio in
  a wrapped web view stops in background even with the Background Modes
  entitlement (webkit.org/b/203293 class).
- The working shape: hybrid (e.g. Capacitor) where the UI stays the
  FileTube web app but PLAYBACK routes through a native AVPlayer layer
  (e.g. @mediagrid/capacitor-native-audio). Buys: true background-audio
  entitlement, NO PWA coupling (section 1), correct Now Playing
  attribution (section 5), lock-screen reliability - and retires the
  sidecar handoff for native users.
- Distribution for personal use: the $99/yr developer license signs
  installs to own devices for a year (or TestFlight internal); no App
  Store review needed. Free-account signing expires every 7 days.
- Cost: an Xcode project + a JS<->native playback seam. The player's
  `activeMediaElement()` abstraction is the natural seam.

Revisit trigger: Dean deciding the coupling (section 1) or attribution
(section 5) pain outweighs the shell's maintenance cost - the pilot is
days, not months.

## 7. Assorted iOS PWA lore (paid for elsewhere, kept for reference)

- iOS pauses any PROGRAMMATIC exit of native video fullscreen -> faux CSS
  fullscreen is the mobile mechanism (v1.118); desktop uses the native
  Fullscreen API - every fullscreen-gated feature must handle BOTH.
- `touchend` preventDefault suppresses the synthetic click - iOS features
  must bind the TOUCH path ("in the source" != "runs on device").
- One physical touch fires BOTH pointerdown AND touchstart - a listener
  registered for both must be idempotent across the pair (v1.134 C1).
- Element fullscreen for video is iPhone-native-only; `pointerdown` not
  `click` for tap-outside; iOS CSS masks decode-lag (inline `<svg>`
  doesn't).
- The service worker is PUSH-ONLY by hard contract
  (`public/filetube-worker.js`): a fetch handler breaks background media
  on WebKit.
- iOS home-screen web apps get isolated per-app storage (cookies copied
  once at install; nothing shared after) - but storage isolation is NOT
  audio/process isolation (section 1).

Revisit trigger (section 7): on any lesson superseded by a device test,
correct it here in the same wave that learns better.
