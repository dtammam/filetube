# iOS background-audio + MediaSession behavior map (video)

Reference for the "background audio for video" feature and its lock-screen /
AirPods control behavior. Written 2026-08-21 (v1.161.3) from a three-agent code
review after Dean's on-device reports. Keep this next to `player.js` when touching
the background-audio machinery - it is battle-won; reuse it, do not rebuild it.

## The one structural fact

**The code cannot tell "phone locked" from "app backgrounded, phone unlocked".**
iOS fires no lock event to a web page. The only backgrounding signals player.js
observes are `pagehide`, `freeze`, and `visibilitychange -> hidden`
(`LIFECYCLE_PAUSE_EVENTS`). Lock and app-switch arrive as the identical event
sequence. So any lock-vs-background difference lives entirely in how *iOS* permits
those identical events - most sharply, whether the sidecar's `bgAudioEl.play()`
resolves or is rejected at the gesture wall.

## The machinery (feature ON, mobile, video, not native-fullscreen)

- A video backgrounds -> playback HANDS OFF from the persistent `<video>`
  (`mediaPlayer`) to a hidden `<audio>` sidecar (`bgAudioEl`) so audio continues.
- `bgAudioState` in {INLINE_VIDEO, HANDING_OFF, BACKGROUND_AUDIO}. `activeMediaElement()`
  returns `bgAudioEl` in HANDING_OFF/BACKGROUND_AUDIO, else `mediaPlayer`.
- MediaSession action handlers (lock screen / AirPods) act on `activeMediaElement()`.
- `navigator.mediaSession.playbackState` is PURE METADATA: it sets the lock-screen
  glyph and decides which command an ambiguous toggle sends (playing -> a squeeze
  sends `pause`; paused -> sends `play`). It does NOT control audio or process life.

## The three-state map

| State | Active element | Expected AirPods play/pause | Actual | Why |
| --- | --- | --- | --- | --- |
| App open / in focus | `<video>` | toggles reliably | works | foregrounded, fully alive; acts on the real video |
| Backgrounded, UNLOCKED | `bgAudioEl` sidecar | pause then resume | pause works; resume usually works | process more likely kept alive when only app-switched |
| Phone LOCKED | `bgAudioEl` sidecar | pause then resume | pause works (first-press since v1.161.2); resume FAILS | once the pause stops audio, iOS suspends the audio-less locked process; the resume handler never runs |

The last two rows run byte-identical code; only iOS's willingness to keep the
process alive differs.

## Root cause of "pauses but won't resume when locked"

A backgrounded WebKit/PWA process is kept alive essentially only while it is
actively producing audio. A lock-screen PAUSE arrives while audio is still playing
(process alive) and succeeds. With audio then stopped and the screen locked, iOS
suspends the process; the next PLAY has no live JS to run the handler. Pause is the
last act of the alive process; resume needs the already-suspended one. **Aggravated
by our own correct v1.161.2 pause fix**: by making pause genuinely stop the audio,
it removed the very thing that had been keeping the page awake.

Confirming observation (if ever needed): with the lifecycle log on, does an
`msAction:play` line appear on the resume squeeze? Absent -> process suspended
(this cause). Present but silent -> the handler ran and `play()` was rejected.

## Fixable website-side vs the iOS wall

- Website-side (done / doable): honest `playbackState` on failed resume
  (v1.161.3 - no lying glyph); the position pre-sync at lock (v1.121); a handoff
  timeout + retry; an `interruptionend` re-assert. None defeat suspension of a
  *paused* backgrounded page.
- The keep-alive experiment (v1.161.3, opt-in, default OFF): plays an inaudible
  loop (`SILENT_PRIME_SRC`) alongside the sidecar and keeps it running THROUGH a
  pause, so the process stays awake and the resume handler survives. Real battery
  cost (the process never sleeps while backgrounded), and whether iOS counts a
  silent-content loop as keep-alive is device-dependent - hence a device-tested
  prototype behind a Settings checkbox.
- iOS-level (not fixable website-side): suspension of an audio-less backgrounded
  page (the resume root); sibling-PWA audio-session coupling + the Control-Center
  now-playing misroute; true background inline video with picture. A bare WKWebView
  wrapper does NOT help (HTML5 audio still stops backgrounded even with Background
  Modes - webkit.org/b/203293).
- **The real fix is native**: a thin Capacitor/AVPlayer shell so audio plays
  through iOS's native player (like Spotify) - reliable locked control, no
  suspend-on-pause, and it also fixes the CC misroute + PWA coupling. Parked
  ("okay for now") - the "when we leave PWA" move.

## Related memory

`pwa-audio-coupling-research.md`, `bg-play-investigation.md`,
`v1-118-121-fullscreen-arc.md`, `v1-161-0-shipped.md` (the .2 playbackState fix +
this .3 arc).
