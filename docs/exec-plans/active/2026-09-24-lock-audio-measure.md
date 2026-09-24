---
plan: lock-audio-measure
harness: v2 · lean
branch: feat/lock-audio-measure
anchor: spec
status: Built - awaiting gate
next: gate r1 (adversary + qa). Then Dean's on-device run (the test plan below) decides phase 2.
design: Approved 2026-09-24 (Dean's intake, recorded in memory wave-2026-09-24-intake)
gate: pending
---

# Lock-to-audio handoff, phase 1: measure

Base: main ecb61e1d (= tag v1.318.0). Tech-debt id range for this branch: #251-#254.

## The ask

Dean's banked idea (2026-09-03): "if someone's watching a video and they lock their screen or
switch away, the PWA very quickly transitions them fully to the audio mode ... and if they were
reopened, it resumes the position of audio on the video."

Intake answers (2026-09-24, final):

| ID | Decision |
|----|----------|
| L1 | What still fails with Setup > Experimental "Background audio for video" ON is the **audio GAP at lock** (a blip or silence while it switches over). |
| L2 | iOS pauses the `<video>` BEFORE page code runs, so a lock-time switch can shrink the gap but never remove it. **MEASURE FIRST**: instrument the existing handoff and give Dean an on-device readout; the next build (tune the sidecar, or a full switch into Listen) is chosen from his iPhone numbers. This branch is phase 1 only. |
| L3 | Trigger (later phases) = any hide: lock, app switch, tab switch. |
| L4 | Scope = mobile, any browser (today's eligibility). |
| L5 | Reopen = back to the VIDEO at the audio's position, PLAYING if the audio was playing. |
| L6 | Settings = UPGRADE the existing "Background audio for video" toggle (no new setting for the feature itself); the iOS keep-alive stays a separate opt-in. |
| L7 | REUSE the v1.161 background-audio machinery in public/js/player.js (BG_AUDIO_STATES, the bgAudioEl sidecar, pre-arm, the bgAudioSyncPosition pre-sync, keep-alive). Never rebuild it. |

In scope here: (1) instrumentation of the existing video -> sidecar handoff and its return;
(2) a device-local readout in Setup > Experimental; (3) the reopen check against L5 (fix only if
small and inside the v1.161 machinery); (4) tracker #196 assessment; (5) a test plan for Dean.
Out of scope: any change to WHEN or HOW the handoff happens (phase 2).

## Re-verified survey (every anchor re-read at ecb61e1d, before any edit)

| Claim | At ecb61e1d | Verdict |
|---|---|---|
| The pure state machine `BG_AUDIO_STATES` / `nextBackgroundAudioState` / `shouldHandOffToBackgroundAudio` | player.js:284 / :305 / :343 | verified: INLINE_VIDEO -> HANDING_OFF -> BACKGROUND_AUDIO, FOREGROUND and TEARDOWN back to INLINE_VIDEO |
| The Instant handoff pre-sync (`bgAudioSyncPosition`) | pure gate `shouldPresyncBgAudio` :364, runtime `presyncBackgroundAudioPosition` :3275, cached off the per-load settings fetch :8014 | verified: this is Setup's "Instant background-audio handoff" (setup.html:1088, `#bg-audio-sync-check`) |
| The sidecar | built in `ensureHost` :2659-2664 (`#bg-audio-sidecar`, preload none, hidden) | verified |
| The pre-arm | `armBackgroundAudioSrc` :3233 (the ONE real-URL site; eager buffer only with preExtractAudio) | verified |
| The handoff | `attemptBackgroundAudioHandoff(trigger)` :3298: seek to `currentAbsTime()`, carry the rate, `bgAudioEl.play()` :3344, THEN pause the video (`pauseSuppressingHandoff`) + keepalive save, then the promise continuation | verified: play() is called BEFORE the video pause |
| The three triggers | 'visibility' (inside `handleBackgroundLifecycle` :3643's pause branch), 'candidate' (the v1.27.2 pre-pause bridge, consumed by `visibilitychangeHidden` inside a 1500ms window), 'pause-hidden' (`handlePossibleIOSPrePauseHandoff`, a pause while already hidden) | verified |
| Hide listeners | pagehide / freeze / visibilitychange-hidden :4047-4059, each calls `handleBackgroundLifecycle` | verified |
| Every skip path emits exactly one `bgAudio:skip` line | `attemptBackgroundAudioHandoff` (setting / status / state) + `handleBackgroundLifecycle` (native-presentation, not-video, not-mobile, state-*, not-playing-no-candidate) | verified (the v1.27.2 one-line-per-event invariant) |
| The return | visible listener :2844 calls `handleForegroundSwapBack` :2796: `mediaPlayer.currentTime = bgAudioEl.currentTime`, then `mediaPlayer.play()` UNCONDITIONALLY :2805, then release + re-arm | **deviates from L5** (see Reopen check) |
| A finished-in-background video | `runEndedCompletionCascade(bgAudioEl, {backgrounded})` :5120 rewinds the SIDECAR to 0 (:5153) and defers autoplay-next to the foreground | verified: the swap-back then seeked the video to 0 and PLAYED it |
| Keep-alive | `startBgKeepAlive` :3944 (opt-in `filetube_bg_keepalive`, started on HANDOFF_SUCCEEDED) | verified, untouched |
| The existing debug log | `recordLifecycleEvent` :3804, ring of 30 in `ft-lifecycle-log`, gated on `ft-debug-lifecycle` | verified: a text event log, no structured timings |
| A jsdom player harness exists | `test/unit/player-immersive-lock-grace.test.js` boots the REAL player.js in the watch shell | verified (older test banners still say "no jsdom harness"; that is stale) |
| Adopt flavor (#196) | `isAdoptLoad` :116, `applyAdoptFlavor` :140 (readerHref / resumeMode / channelFolder only), adopt branch in `load` :8622 | verified: `type` and `autoAdvanceViaTrackNav` are NOT refreshed |
| Setup Experimental section | setup.html:1045 (`data-collapse-key="experimental"`); device-local toggles wired in setup.js (e.g. `BG_KEEPALIVE_KEY` :1038 + its wiring) | verified |

## Design

- **Collector (player.js), a passive observer.** One RECORD per hide cycle of a playing (or
  just system-paused) mobile VIDEO: `t` = wall clock at the first hide event, every mark a
  `performance.now()` offset in ms from it (negative = before it). Opened by
  `bgTimingOnHidden`, the first statement of `handleBackgroundLifecycle` after its nothing-loaded
  guard, only when the toggle is on (`filetube_bg_timing_log_enabled` = '1', read LIVE), the
  item is a video, the form factor is mobile, and the video was playing OR paused within the
  last 3s (iOS pauses first; `bgTimingOnVideoPause` stamps it). Marks:
  - lifecycle arrivals (every hide event of the cycle) and every `bgAudio:*` / `msAction:*`
    lifecycle line, via a one-line tap at the top of `recordLifecycleEvent` (a single null
    check while no record is open). The FIRST `bgAudio:skip` is the decision, so every skip
    path is covered with no new call site.
  - the video's pause (`pause`, `pausePos`), our own pause() call (`pauseCall`).
  - the decision (`trigger`, eligible), and the sidecar at that moment (`sidecar.armed` = the
    real track was pre-armed BEFORE the handoff, `buffered` = the seek target already in a
    buffered range, `readyState`, `networkState`, `preload`, its position before the seek,
    `primed`), plus `resumeTime` (the video position handed over).
  - `playCall`, `playResolved` / `playRejected` + `err`, the sidecar's `playing` (+ `startPos`)
    and its first real advance (`advance`, `advancePos`; the handoff's own seek never counts).
  - the return: `ret.visible`, the state, the audio position and paused-ness, the mode
    (`resume` / `stay-paused` / `no-swap`), `videoPlayCall`, `videoPlayResolved` /
    `videoPlayRejected`, `videoPlaying`, `videoAdvance` (the settle timer gives up after 5s).
  - context: settings (bgAudio, Instant, preExtract, keep-alive, sidecar status), PWA vs
    browser, the iOS version, `type` + `resumeMode` (so a #196 Watch -> Listen adopt is
    identifiable).
- **Writes.** A ring of the last 20 records in `filetube_bg_timing_log`. No write before the
  sidecar's play(): the handoff queues its first write as a MICROTASK after play()
  (`bgTimingPersistSoon`); later writes land in later events (play settling, the first
  advance, the return). A record is replaced in place as it gains marks, so an app iOS kills in
  the background keeps its last write. Each write re-reads the toggle: switching off stops
  collection mid-cycle.
- **Derived numbers** (`bgTimingMetrics`, pure, stored as `m` at every write): hide -> audio
  (first advance), hide -> playing, pause -> playing and silence (both from whichever video stop
  came first: iOS's pause or ours), play() -> playing, drift (sidecar position at 'playing'
  minus the handed-over video position), back (visible -> the video moving), outcome.
- **Readout (setup.html + setup.js `wireBgTimingLog`).** A device-local checkbox "Background
  audio timing log" in Experimental (default OFF). While on, a panel shows the records newest
  first as a six-column table (When, Hide to audio ms, Pause to playing ms, Pre-armed, Instant,
  Drift) plus a full-width note line per record (outcome + trigger, silence, the return, PWA vs
  browser tab); Copy puts one human line per record plus the raw JSON on the clipboard (a
  plain-http LAN install has no clipboard API: the text is shown in a box to copy by hand);
  Clear takes two taps.
- **Reopen fix** (see below): `handleForegroundSwapBack` plays the video only if the sidecar was
  playing.

## Reopen check (L5)

**Before (ecb61e1d):** `handleForegroundSwapBack` (:2796) seeked the video to the sidecar's
`currentTime` (correct: the audio's position) and then called `mediaPlayer.play()`
UNCONDITIONALLY. So:
- audio playing at return -> video plays at the audio position (matches L5);
- audio PAUSED at return (a lock-screen / AirPods / Control Center pause) -> the video
  started PLAYING anyway (violates L5);
- a video that FINISHED in the background: the ended cascade rewound the sidecar to 0, so the
  video came back at 0:00 and PLAYED from the start (violates L5, and an odd restart).
- a failed / skipped handoff never reaches the swap-back (state is INLINE_VIDEO): the video
  stays paused where it stopped (matches L5: no audio was playing).

**Fix (small, inside the v1.161 swap-back):** read `audioWasPlaying = !!(bgAudioEl &&
!bgAudioEl.paused)` before the state flip and the release, and call the video's play() only
when it is true. HANDING_OFF counts as playing (play() is in flight; an element leaves
`paused` the moment play() is called). The seek to the audio position is unchanged.
Bound behaviorally (the real player in jsdom): audio playing -> video at the audio position
and playing; audio paused -> at the audio position, paused (toggle on AND off); play() in
flight -> plays; finished in the background -> 0:00, paused. Device-pending.

## Tracker #196 assessment (adopt keeps stale `type` / `autoAdvanceViaTrackNav`)

Does it affect the handoff? Yes, in both directions, but it does not break it:
- **Listen -> Watch (same id adopt):** `type` stays 'audio'. At a hide, `handleBackgroundLifecycle`
  sees `isAudio` and never pauses or hands off: the element keeps playing as audio (Listen's
  continuous path). The setup-time bg-audio arm also never ran (the original load was audio).
  So this video is never handed off, and the timing log never records it (out of scope by the
  `type === 'audio'` guard). Harmless for phase 1; if anything it behaves like the gapless path.
- **Watch -> Listen (same id adopt):** `type` stays 'video'. A lock on the Listen surface takes
  the VIDEO sidecar handoff (with its gap) instead of Listen's continuous play. Records from
  this state are identifiable in the log: `type: 'video'` with `mode: 'music'`.
- **autoAdvanceViaTrackNav:** only affects what happens after an END (the deferred
  autoplay-next on return); not the handoff itself.
- **Phase 2 consequence (the real finding):** a "full switch into Listen" at lock is itself a
  TYPE-CHANGING adopt of the same id. #196's recorded fix (re-run the type-dependent
  presentation arms on a type-changing adopt, or force a genuine reload on a type change) is a
  PREREQUISITE for that phase-2 option. Not fixed here: not small, and phase 1 does not need it.
  Filed as #251 (below) together with the scaffolding note.

## Acceptance criteria (each names its binding test)

All in `test/unit/player-bg-timing-log.test.js` unless noted; the player tests boot the REAL
player.js in jsdom (the watch shell, an iPhone navigator, settings ON, sidecar ready) and
dispatch the real events.

- **AC1 Reachability, ordering A** (hide while playing): the real 'visibility' handoff writes ONE
  record: decision eligible via 'visibility', pre-armed yes, Instant on, marks `playCall <=
  pauseCall`, `playResolved`, `playing`, `advance`, outcome ok, drift 0, the existing `bgAudio:*`
  lines as timed events, no `p0` in storage; the pending record is on disk right after the
  handoff.
- **AC2 Reachability, ordering B** (iOS system-pause first, then hide): the 'candidate' handoff's
  record carries a NEGATIVE pause mark and measures silence from it; PWA detected.
- **AC3 Skip and failure are recorded:** setting off -> `skipped:setting-off` (the tap);
  a NotAllowedError play() -> `failed:NotAllowedError`.
- **AC4 OFF axis:** with the toggle off, no record and not one write, and the handoff + return
  make IDENTICAL media calls to the ON run. A cycle that opened OFF is never recorded even if
  switched on before the audio starts; switching OFF mid-cycle stops further writes.
- **AC5 No write before play():** the first timing write lands after the sidecar play() and
  after the handoff's video pause.
- **AC6 Ring:** 20 newest survive across a real handoff; pure `appendBgTimingRecord` replaces in
  place, appends, caps, drops garbage.
- **AC7 Metrics:** `bgTimingMetrics` anchors and outcome precedence (pure).
- **AC8 Seek guard:** the handoff's own seek (a timeupdate before play() settles) is never the
  first advance; the real one still is.
- **AC9 Scope:** a paused video (no recent pause) and an audio item never open a record.
- **AC10 Reopen (L5):** audio playing -> video at the audio position, playing, the return timed
  (`resume`, back ms); audio paused -> at the audio position, NOT playing (toggle on and off);
  play() in flight -> plays; finished in background -> 0:00 paused; no handoff -> `no-swap`.
  Also the updated source lock in `player-background-audio.test.js`.
- **AC11 Readout:** the toggle lives once, in Experimental, default OFF with the panel hidden;
  records the REAL player wrote render newest first with the right cells and note; switching
  off hides the populated panel and clears the key, on re-reveals (both axes); Copy writes every
  record + the raw JSON; no clipboard -> the text box; Clear needs two taps on a populated log;
  the init path calls `wireBgTimingLog`. Keys match across player.js / setup.js.
- **AC12 Phone:** readable at 390 and 375 wide with no sideways scroll (Measurements).

## Build record

- `public/js/player.js`: pure `bgTimingMetrics`, `appendBgTimingRecord`, the two keys + cap
  (exported); the runtime collector block after `recordDiagnosticPauseEvent`; hooks: the tap in
  `recordLifecycleEvent`, `bgTimingOnHidden` in `handleBackgroundLifecycle`, three marks + the
  post-play microtask write + the promise marks in `attemptBackgroundAudioHandoff`,
  `bgTimingOnVisible` in the visible listener (before the swap-back), the reopen rule +
  `bgTimingNoteReturnPlay` in `handleForegroundSwapBack`, passive listeners (video pause /
  playing / timeupdate; sidecar playing / timeupdate) in `wireHostListeners`.
- `public/js/setup.js`: the two keys, `readBgTimingLog`, `bgTimingRowView`,
  `formatBgTimingCopyText`, `renderBgTimingLog`, `wireBgTimingLog` (+ init call, exports).
- `public/setup.html`: the Experimental form group (checkbox, panel, Copy, Clear, status, table
  host, fallback text box).
- `public/css/style.css`: `.bg-timing-log*` (tokens only; the scroller has no radius).
- `test/unit/player-bg-timing-log.test.js` (new, 25 tests).
- `test/unit/player-background-audio.test.js`: the swap-back source lock now pins the reopen
  rule. `test/unit/player-lifecycle-release.test.js`: the two "first statement is the debug-flag
  bail" locks admit exactly the timing tap line ahead of the bail (the bail stays the first
  LIFECYCLE-log statement).
- `docs/exec-plans/tech-debt-tracker.md`: #251.

Instruments at the build commit: `npm run lint:css -- --enforce` TOTAL 0;
`node scripts/overlay-containment-lint.js --enforce` clean; eslint on the changed files clean
(the repo's 7 warnings are pre-existing, all in common.js); `node --test test/unit/player-*.test.js
test/unit/setup-*.test.js` 831/831 before the four extra guard tests; census files (comment-debt,
css-token-lint, shell-script-global-collisions, shell-singleton-invariant, test-isolation-parity,
tech-debt, exec-plans, docs-status, token-scale-lock, type-scale-tokens) 92/92.

## Measurements

Setup readout, the REAL setup.html (scripts stripped) + the REAL style.css in headless Chromium,
the table drawn by the REAL `renderBgTimingLog` sliced from setup.js, fed worst-case widths
(5-digit ms, a -12.34s drift, a long skip reason). Probe: scratchpad
`lock-audio-measure-probe/probe.js`.

| Viewport | Doc scrollWidth | Table scroller client / scroll | Buttons | Header / cell font |
|---|---|---|---|---|
| 390x844 @3x | 390 (no sideways scroll) | 324 / 324 (fits, no inner scroll) | 2 rows, 240x44 each | 11px (`--fs-xs`), headers wrap to 2 lines (35px) |
| 375x844 @3x | 375 | 309 / 309 | 2 rows, 240x44 | 11px, headers 3 lines (50px) |
| 1280x900 | 1268 | 924 / 924 | 1 row, 240x28 | 11px |

At 390 the first row's cells measure 55 / 64 / 69 / 46 / 42 / 48 px ("05:39:16", "12345",
"10987", "yes", "on", "-12.34s"); the note line wraps to 2 lines (39px). Screenshot checked
(`timing-log-390.png`): legible, nothing clipped.

The GAP itself cannot be measured here: headless Chromium never pauses a backgrounded video.
Those numbers are Dean's (test plan below).

## Mutant table

(filled after the build commit; mutants run in a /tmp sandbox from `git archive` of the
committed sha, never on the live tree)

## Test plan for Dean (iPhone)

Setup, once: Settings > Experimental: "Background audio for video" ON (as today),
"Background audio timing log" ON. Leave "Pre-extract" as you normally run it and note which.
Use a video you have watched before (its background audio already extracted), longer than
10 minutes.

Run each block 3 times (3 locks), then open Settings > Experimental, tap **Copy**, and paste the
text to me. Then tap Clear (twice) before the next block, or just keep going: the log holds
the last 20.

1. **PWA, Instant handoff ON** ("Instant background-audio handoff" checked). Open the video,
   play it for at least 30 seconds (let it run past the first minute), then press the side
   button to LOCK. Listen: note roughly how long the silence felt. Wait 20 seconds, unlock,
   and come back to the app. Does the video continue from where the audio was, and is it
   playing?
2. **PWA, Instant handoff OFF.** Same steps.
3. **PWA, app switch instead of lock:** play, swipe up to the home screen (or switch to another
   app), wait 20 seconds, come back. Once with Instant ON is enough.
4. **Safari tab (not the installed app), Instant ON:** open FileTube in Safari, same lock steps.
5. **The reopen rule:** play, lock, and while locked PAUSE from the lock screen (or AirPods);
   unlock and come back: the video should be at the audio's spot and stay PAUSED. Then again
   without pausing: it should be PLAYING.
6. Optional: one run with the keep-alive experiment ON, if you normally use it.

Numbers to send back: the Copy text (it carries every record). The ones I will read first:
Hide to audio, Pause to playing and silence per record; outcome (ok / pending / failed /
skipped and why); Pre-armed and "buffered" (whether the sidecar already had the spot);
Instant on/off; drift; and the return line (back ms, and whether it resumed or stayed paused).
Plus, in words: how long the gap FELT on each block, and whether any lock gave NO audio at all.

## Disclosed gaps

1. **The gap is measured by page code, which iOS starts late.** Marks are taken when the
   handler RUNS (performance.now), not when the OS locked the phone; any time iOS spends
   before running page code is invisible to it (the platform wall behind L2). The video's
   'pause' mark is the closest thing to "the sound stopped".
2. **First advance is an upper bound.** It is the first `timeupdate` that shows the sidecar
   moving; browsers fire timeupdate every 15-250ms and iOS may throttle more in the background.
   'playing' is the lower bound; both are recorded (hide -> playing, hide -> audio).
3. **A page iOS suspends before the sidecar starts keeps a 'pending' record** (play() never
   settled - the old stuck-HANDING_OFF shape). That IS a result, not a logging failure.
4. **Behavior change in the return path** (the reopen fix): a paused or finished background
   audio no longer auto-plays the video on return. Device-pending. If iOS ever reported the
   sidecar paused on return while it was audibly playing, the video would come back paused;
   the record's `ret.audioPaused` would show it.
5. **Two source locks were relaxed**, not removed: `recordLifecycleEvent`'s "first statement is
   the debug-flag bail" now admits exactly the timing tap line (an in-memory mark gated on an
   open timing record, i.e. on its own opt-in toggle) ahead of the bail.
6. **Cost with the toggle OFF:** one localStorage READ at each hide event and each video pause
   while a mobile video is loaded (the same kind of read `recordLifecycleEvent` already does on
   those events), plus a null check in the new listeners and in the tap. No writes, no awaits;
   the handoff's media calls are bound identical (AC4).
7. **Scope holes by design:** desktop (no handoff exists there), audio items (never handed off),
   and a Listen -> Watch adopted video (#196: still typed 'audio', never handed off) produce no
   record.
8. The readout is device-local and read when Setup opens; it does not live-refresh while the
   page is open (re-open Setup to see new records).

## Tech debt filed

- **#251** Lock-to-audio phase 1 timing log is measurement scaffolding, and #196 gates phase 2's
  "switch into Listen" option (see the tracker row).
