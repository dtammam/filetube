---
plan: lock-audio-measure
harness: v2 · lean
branch: feat/lock-audio-measure
anchor: spec
status: Gate closed
next: release
design: Approved 2026-09-24 (Dean's intake, recorded in memory wave-2026-09-24-intake)
gate: APPROVED r2 @3e3b898e — adversary, qa
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
    These are PER ATTEMPT (gate r1 W2): a retry inside one record resets them and counts
    `attempts` (keeping `firstErr`); a play() our own return/teardown supersedes is kept as
    `superseded` and never stamps `err`, so a stuck handoff stays 'pending'.
  - the return: `ret.visible`, the state, the audio position and paused-ness, the mode
    (`resume` / `stay-paused` / `no-swap`), `videoPlayCall`, `videoPlayResolved` /
    `videoPlayRejected`, `videoPlaying`, `videoAdvance` (the settle timer gives up after 5s).
  - context: settings (bgAudio, Instant, preExtract, keep-alive, sidecar status), PWA vs
    browser, the iOS version, `type` + `resumeMode` (so a #196 Watch -> Listen adopt is
    identifiable).
- **Writes.** A ring of the last 20 records in `filetube_bg_timing_log`. No write before the
  sidecar's play(): nothing on the hide handler's synchronous path writes. The handoff queues
  its first write as a MICROTASK after play() (`bgTimingPersistSoon`, one queue PER RECORD), and
  a re-hide that closes a returned record queues that close the same way (gate r1 W1); later
  writes land in later events (play settling, the first advance, the return). A record is replaced in place as it gains marks, so an app iOS kills in
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
  after the handoff's video pause; on a re-lock inside the return settle window, the hide
  handler writes NOTHING (the old record's close is queued) and a new record opens (r1 W1).
- **AC13 (r1) Per-attempt truth:** a retry inside one record reports the final attempt
  (`attempts` 2, `firstErr`, outcome ok); a handoff still pending at the return stays
  'pending' (`superseded.by` AbortError), never `failed`.
- **AC14 (r1) Storage failure:** blocked (SecurityError) and full (QuotaExceededError)
  storage leave the handoff's media calls identical to a clean run, with nothing thrown into
  the page, log on and off.
- **AC15 (r1) Scope + readout:** desktop never records nor reads the toggle; a no-swap return
  records whether the video kept playing; Copy calls writeText inside the tap and a rejected
  write shows the text box; an armed Clear disarms after 4s; the text box computes 16px on
  mobile (census in mobile-input-zoom-fontsize.test.js).
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
tech-debt, exec-plans, docs-status, token-scale-lock, type-scale-tokens) 92/92. Build commit
77a3f5bc: the pre-commit hook's unit suite 7126 pass / 0 fail (Node v22.23.1). The full
`npm test` (integration included) was NOT run by the builder (the Architect runs it per release).

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

Run at the build commit 77a3f5bc: each mutant in its own /tmp sandbox built from `git archive
77a3f5bc` (never the live tree), the diff confirmed non-empty (`diff -r -q` names the mutated
file) before crediting, then `node --test` on player-bg-timing-log + player-background-audio +
player-lifecycle-release (183 tests). Runner: scratchpad `lock-audio-measure-mutants.py`.
**20 of 21 killed.**

| # | Mutant | Result (pass/fail of 183) | Red tests |
|---|---|---|---|
| M1 | record unconditionally: drop BOTH toggle gates (the brief's named mutant) | KILLED 180/3 | toggle OFF (no record + identical media calls); cycle begun OFF; switched OFF mid-cycle |
| M1a | drop only the open gate (`bgTimingOnHidden`) | KILLED 182/1 | a cycle begun OFF is never recorded |
| M1b | drop only the write gate (`bgTimingPersist`) | KILLED 182/1 | switched OFF mid-cycle |
| M2 | a sync storage write BEFORE the sidecar play() | KILLED 182/1 | no write before play() |
| M3 | reopen: play the video unconditionally (the pre-fix code) | KILLED 179/4 | swap-back source lock; audio PAUSED (toggle on, off); finished in the background |
| M4 | reopen: inverted `audioWasPlaying` | KILLED 177/6 | swap-back lock; audio PLAYING; audio PAUSED x2; and more |
| M5 | drop the seek guard in the first-advance mark | KILLED 182/1 | the handoff's own seek is never the first advance |
| M6 | pause lookback 3000 -> 0 | KILLED 179/4 | ordering B; the three Setup tests fed by ordering-B records |
| M7 | drop the nothing-playing guard | KILLED 182/1 | a paused video / an audio item open no record |
| M8 | drop the audio-item exclusion at open | KILLED 182/1 | same |
| M9 | leak `p0` into storage | KILLED 182/1 | ordering A |
| M10 | the tap never records a skip decision | KILLED 182/1 | skipped handoff recorded |
| M11 | drop the sidecar 'playing' listener | KILLED 181/2 | ordering A; Setup table |
| M12 | read the return state AFTER the swap-back | KILLED 180/3 | reopen PLAYING; reopen PAUSED; Setup table |
| M13 | drop the post-play microtask write | KILLED 178/5 | ordering A (pending on disk); no write before play(); ring; switched OFF mid-cycle |
| M14 | the tap moved after the debug-flag bail | KILLED 181/2 | ordering A (events); skipped handoff |
| M15 | Setup: panel always shown | KILLED 181/2 | default OFF hides the panel; switching off hides it |
| M16 | Setup: Clear on one tap | KILLED 182/1 | Clear takes two taps |
| M17 | Setup: Copy drops the raw JSON | KILLED 182/1 | Copy |
| M18 | drop the `activeMediaElement() === bgAudioEl` guard in `bgTimingSidecarRec` | **SURVIVED** 183/0 | none. Defense in depth: `playCall` is set only inside the handoff (state HANDING_OFF), and the return sets `ret` (excluded) before the state goes back to INLINE_VIDEO, so the only reach is a gesture-prime 'playing' on the sidecar after a FAILED handoff while still hidden (the prime needs an in-page gesture, so not while hidden). Kept as a cheap belt; disclosed. |
| M19 | drop the video return-advance listener | KILLED 181/2 | reopen PLAYING (back ms); Setup table |

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
6. **Cost with the toggle OFF** (corrected at r1, qa S5 / adversary S5): on a MOBILE form
   factor, one localStorage READ of the toggle at each hide event and each video pause while a
   video is loaded (the same kind of read `recordLifecycleEvent` already does on those events);
   on desktop, the form-factor check (matchMedia) and no storage read at all (bound). Plus a
   null check in the new listeners and in the tap. No writes, no awaits; the handoff's media
   calls are bound identical (AC4, AC14).
7. **Scope holes by design:** desktop (no handoff exists there), audio items (never handed off),
   and a Listen -> Watch adopted video (#196: still typed 'audio', never handed off) produce no
   record.
8. The readout is device-local and read when Setup opens; it does not live-refresh while the
   page is open (re-open Setup to see new records).
9. **Mutants M18 and R7 survive** (the sidecar-active guard in `bgTimingSidecarRec`; the
   attempt-number check in `bgTimingOnPlaySettled`): both judged defense in depth, each with a
   comment in the code; see the mutant tables. The tap's `!rec.ret` (adversary Mm) likewise.
10. **Tracker #252** (r1): the zoom census found the pre-existing Music / Books sort
   `<select class="btn btn-sm">` at 12px on mobile; allowlisted by name, not fixed here.
11. **Surviving by design, accepted at gate r2:** R7 (the settle's attempt-number check), M18 (the
   sidecar-active guard) and Mm (the tap's `!rec.ret`) are unreachable belts. Both r2 seats tried
   to reach R7; the only route (a terminal-pagehide release with attempt 1 pending) cannot start a
   second attempt before the rejection lands. Each carries a defense-in-depth comment.
12. **An attempt-2 record keeps the FIRST anchors** (accepted at gate r2): after a failed first
   handoff and a retry in the same hide cycle, the spans still run from the first hide and the
   first iOS pause, so they include the user's own reaction time (e.g. pressing lock-screen Play).
   The readout prints "attempt N, first failed: X" beside them so such a record is never read as
   a plain gap.
13. **r2 suggestions filed, not fixed** (Dean's overnight gate rule): tracker #253 (the collector /
   readout / test residue: a stale "reads only" comment, a cut-short return reading "video did not
   move", a 5.2 s real-time test, the untested synchronous `writeText` throw, and `wq` able to reach
   storage) and #254 (the zoom census allowlist keyed by class, not file + id).

## Tech debt filed

- **#251** Lock-to-audio phase 1 timing log is measurement scaffolding, and #196 gates phase 2's
  "switch into Listen" option (see the tracker row).
- **#252** (r1) The Music / Books sort select.btn computes 12px on mobile (pre-existing; found by
  the new zoom census).
- **#253** (r2) Timing-log residue: qa S-a, S-b, S-d; adversary 2 (Mh2, N7).
- **#254** (r2) The zoom census allowlist exempts the class `btn` everywhere: qa S-c = adversary 1
  (N17).

## Gate r1 - qa (@8fd3b99a)

Reviewed `git diff ecb61e1d..8fd3b99a` (9 files, +1535/-4), every changed file. Instruments, run by
this seat at 8fd3b99a (Node v22.23.1), verbatim:
- `node --test` player-bg-timing-log + player-lifecycle-release + player-background-audio: `# tests 183 # pass 183 # fail 0`.
- `node --test` setup-*.test.js + css-token-lint + overlay-containment + comment-debt / tech-debt / exec-plans / docs-status census: `# tests 114 # pass 114 # fail 0`.
- `npm run test:unit`: `# tests 7126 # pass 7126 # fail 0 # skipped 0` (exit 0).
- `npm run lint:css`: `TOTAL 0`; `node scripts/css-token-lint.js --enforce`: `TOTAL 0`; `node scripts/overlay-containment-lint.js --enforce`: `overlay-containment: clean (0 violations)`; eslint on the 5 changed js files: no output, exit 0.
- Layout re-measured (the builder's CDP probe, pointed at a `git archive 8fd3b99a` sandbox): 390 wide doc scrollWidth 390, scroller 324/324; 375 wide 375, 309/309. Matches the Measurements table.
- Mutant M3 (unconditional reopen play) re-run in the sandbox: 179/4, the same four red tests the table names. Verified.
- Probes (sandbox copies of the real jsdom harness, never the tree) back W1, W3 and S3 below.

Verified correct: the handoff with the log OFF makes only the new null checks plus one toggle read (the
AC4 identical-media-call test binds it); the reopen rule matches L5 (audio playing / play() in flight ->
video at the audio position, playing; audio paused / finished -> at the audio position, paused; the
finished case now matches the foreground end, which also rests at 0:00 paused); every localStorage
access in player.js and setup.js is inside a try; the readout builds DOM with textContent only.
**Security surface: none of note.** No network call is added: the record lives only in this device's
localStorage and leaves only through a user's Copy tap to the clipboard. It holds a media id, positions,
timings, the iOS version and PWA-or-tab, and lifecycle detail strings; no titles, paths or credentials.
No markup is injected, no shell, no server route.

1. **WARNING - a storage write CAN land before the sidecar play(), and two comments say it cannot**
   (player.js:4066 in `bgTimingOnHidden`; the claims at player.js:3749 "reads only" and :3987 "No storage
   WRITE ever happens before the sidecar's play() call"; plan AC5 wording). Scenario, VERIFIED by probe:
   lock and hand off, come back (the record goes to `ret.mode 'resume'` and waits up to 5s for the video
   to move), the video is still rebuffering at the audio's new position, and the user locks again before
   it moves. `bgTimingOnHidden` finalizes the old record SYNCHRONOUSLY: the trace is
   `setItem(filetube_bg_timing_log)`, then `seek`, then `play(bg-audio-sidecar)`. A full-ring
   JSON.stringify + setItem sits on the exact path the tool measures, and the old record is closed as
   "did not move" when it was only cut short. Fix: in the finalize-on-new-hide arm, defer the write to a
   microtask. Do NOT reuse `bgTimingPersistSoon` as it stands: its one global `bgTimingWriteQueued`
   flag would then swallow the NEW record's first queued write in the same tick. Use a per-record flag
   or a dedicated microtask. Bind it with a re-lock-inside-the-settle-window test on the write/play order.
2. **WARNING - the fallback text box defeats the iOS focus-zoom floor** (style.css:3555,
   `.bg-timing-log-text { font-size: var(--fs-2xs) }`). The v1.26.2 systemic rule (style.css ~5315,
   mobile `textarea { font-size: var(--fs-input-min) }`) loses to this class selector on specificity,
   which is the exact case that rule's own comment warns about. VERIFIED in headless Chromium at 390:
   the timing textarea computes **10px**, a plain textarea in the same panel computes **16px**. Scenario:
   on an iPhone where the clipboard write is unavailable or rejected, Copy reveals the box and calls
   `select()`, and focusing it (or tapping to select) makes iOS Safari zoom the Setup page in. Fix: drop
   the font-size, or add `.bg-timing-log-text` to the mobile floor list beside `.comment-input-box,
   .folder-name-input`. Then extend `mobile-input-zoom-fontsize.test.js`: it did not catch this.
3. **WARNING - a retried handoff in the same cycle produces a self-contradictory record**
   (player.js:4136-4150 `bgTimingBeforeHandoff`, :436 outcome precedence). Scenario, VERIFIED by probe:
   the first handoff's play() rejects NotAllowedError. The user presses lock-screen Play (the video
   resumes, still hidden) and iOS system-pauses it again. The 'pause-hidden' trigger then hands off
   successfully INSIDE THE SAME record. That is the documented recovery path in the F1 comment. The
   stored record reads `decision.trigger 'pause-hidden'`, `err 'NotAllowedError'`, `playing` and
   `advance` present, `m.outcome 'failed:NotAllowedError'`. So the readout reports a FAILURE while audio
   played, and "Hide to audio" spans the user's own reaction time from the first hide. This tool's whole
   output is these numbers. Fix: a second eligible handoff in an open record either finalizes it and
   opens a fresh one, or resets the per-attempt marks (`err`, `playRejected`, `playResolved`, `playing`,
   `startPos`, `advance`, `pauseCall`) and counts `attempts`. Bind it with this sequence.
4. **SUGGESTION - the 'no-swap' note can be false** (setup.js:1092 "back: no swap (video was left
   paused)"). Scenario, reasoned (should-happen, not driven): a native-fullscreen or PiP video is
   playing at lock. The record opens, the skip is 'native-presentation', and the video KEEPS playing
   through the lock (the v1.25.2 path). On return the note says the video "was left paused". The same
   holds after a failed handoff plus a lock-screen Play. Record `ret.videoPaused` in `bgTimingOnVisible`
   and word the note from it.
5. **SUGGESTION - the plan's cost claim is narrower than the code** (plan Disclosed gap 6: "each video
   pause while a mobile video is loaded"). `bgTimingOnVideoPause` has no form-factor check, and
   `bgTimingOnHidden` reads the toggle BEFORE `isMobileFormFactor()`. A probe with a Win32 navigator
   counted 1 toggle read per pause and 1 per hide. The cost is negligible; the prose is wrong. Say "any
   loaded video", or move the mobile check first.
6. **SUGGESTION - a stale test title** (player-background-audio.test.js:346, "runs the
   video.currentTime = audio.currentTime; video.play() sequence"). The body now pins a CONDITIONAL
   play. Retitle it.
7. **SUGGESTION - `.bg-timing-log-row` has no CSS rule** (setup.js:1164). CONTRIBUTING's "a className
   with no CSS rule binding it is a DEFECT - flag it". It is not a bare element (its cells are styled by
   `.bg-timing-log-table td`), so it is a test hook. Add it to the td/th selector group or note it as a
   hook.
8. **SUGGESTION - Copy throws on an invalid `t`** (setup.js:1120 `new Date(r.t || 0).toISOString()`).
   A record whose `t` is a non-numeric string (a hand-edited or foreign value under the key) throws
   RangeError out of the click handler: nothing is copied and the fallback does not run. The table path
   already guards with `bgTimingClockLabel`. Reuse that guard. Suspicion-grade (player.js always writes
   a number).
9. **SUGGESTION (note, not blocking) - the new form-group copies the section's inline
   `style="...gap:8px...margin-top:4px..."`** (setup.html, the 23rd copy of that label style). The
   linter does not scope HTML style attributes and this matches the siblings verbatim, so it is
   pre-existing debt, not introduced by this change. Also, suspicion only: `clip.writeText` runs inside
   `Promise.resolve().then(...)` (setup.js:1230) rather than synchronously in the tap. If WebKit does not
   carry user activation into that microtask, iOS rejects and always falls back (see W2). A synchronous
   call inside a try would avoid the question.

Mutant table: agreed with the M18 survival reasoning. M3 re-verified. The tree was left clean apart
from this section (checked with `git status`).

Gate: CHANGES r1 @8fd3b99a — qa

## Gate r1 - adversary (@8fd3b99a)

Reviewed `git diff ecb61e1d..8fd3b99a`, HEAD = 8fd3b99a876f6a6c2b1912a6b6a8fc789bf4912d. Every
measurement below was taken in a /tmp sandbox built from `git archive 8fd3b99a` (Node v22.23.1),
never in the worktree. Instruments, verbatim:
- `node --test` player-bg-timing-log + player-background-audio + player-lifecycle-release: `# tests 183 # pass 183 # fail 0`.
- `node --test test/unit/player-*.test.js test/unit/setup-*.test.js`: `# tests 835 # pass 835 # fail 0`.
- The ten census files: in the sandbox, `# tests 92 # pass 90 # fail 2`. Both failures are
  comment-debt-census TIER 1/2 with `EISDIR: illegal operation on a directory` from MY sandbox's
  symlinked node_modules (an instrument artifact). Re-run in the worktree (read-only):
  `comment-debt-census.test.js # tests 5 # pass 5 # fail 0`.
- `npm run lint:css -- --enforce`: `TOTAL 0`. `node scripts/overlay-containment-lint.js --enforce`:
  `overlay-containment: clean (0 violations)`. eslint on player.js, setup.js and the new test: exit 0,
  no output. Em dashes in the diff's added lines: 0.
- The builder's CDP layout probe, re-run against the sandbox: 390 doc scrollWidth 390, scroller 324/324;
  375: 375, 309/309; 1280: 1268, 924/924. Screenshot at 390 read: legible, nothing clipped. Matches
  the Measurements table.
- The full `npm test` was NOT run (brief: targeted only).

Verified correct (ran it): the reopen rule on every arm I could drive. Audio playing, and play() in flight
(HANDING_OFF): the video lands at the audio position and plays. Audio paused (toggle on and off) and
finished in the background: at the audio position, paused. The `audioWasPlaying` read is synchronous
with the seek (no await, so no TOCTOU); moving it after the release reds 4 tests, making HANDING_OFF read
as not-playing reds 2, and a `resume`-only return classification reds 1. Reasoned (should-work, not
driven): a chapter-loop or whole-item loop end in the background re-plays the sidecar, so the video
resumes. A bfcache restore finds the sidecar paused, so the video stays paused. A failed or skipped
handoff never reaches the swap-back. The real browser event order ('playing' fires BEFORE the play()
promise resolves; the harness does the reverse) still yields `ok` (probe ADV-5). Key parity: the
setup.js and player.js keys are bound equal by the keys test. Storage disabled (getItem throws
SecurityError) and storage full (setItem throws QuotaExceededError on the re-lock write) both leave the
handoff intact at 8fd3b99a (probes ADV-2 and ADV-3 pass). Builder mutants re-run: M3 179/4 and M2 182/1
KILLED as tabled; M18 SURVIVED, 183/0, as tabled.

1. **WARNING - a SYNC storage write lands before the sidecar play() on a re-lock inside the return
   settle window** (player.js `bgTimingOnHidden`, first line: `bgTimingFinalize(rec)` then
   `bgTimingPersist`). This violates Design "No write before the sidecar's play()", AC5 and brief
   surface 1. I found it independently; it is the same defect as qa W1. Repro (probe ADV-1, the real
   harness): lock and hand off, then the sidecar starts. Return with the audio playing (`ret.mode
   'resume'`, which waits up to 5s for the video to move). Hide again before the video's first advance.
   The trace is `[setItem filetube_bg_timing_log, seek bg-audio-sidecar 250, play bg-audio-sidecar,
   pause media-player]`: write@0, play@2. Two of my mutants survive because this whole arm is unbound:
   dropping `rec.ret` from the finalize condition (183/0; the re-lock then appends its events to the OLD
   record and no new cycle is recorded) and deleting the 5s settle timer (183/0). The same sync
   finalize also runs when `rec.media !== currentId` (for example a close() while hidden). Prescription:
   finalize-and-open without writing in that arm, and queue the old record's write as a microtask. Use a
   per-record queue: the shared `bgTimingWriteQueued` flag would DROP the new record's first write
   queued in the same tick. Bind it with the re-lock test above, asserting write order and that a NEW
   record opens.
2. **WARNING - our OWN release relabels a still-pending handoff as `failed:AbortError`** (player.js
   `attemptBackgroundAudioHandoff` reject arm: the `timing.err` mark runs BEFORE the
   `currentId !== handoffId || bgAudioState !== HANDING_OFF` supersede check). Disclosed gap 3 promises
   that a page iOS suspends before the sidecar starts "keeps a 'pending' record ... That IS a result".
   It does not survive the return. Repro (probe ADV-4): the sidecar play() stays pending, and pause()
   rejects pending play promises with AbortError, per the HTML spec's internal pause steps. The record
   reads `pending` before the return. After `visibilitychange` visible it reads `ret.mode resume,
   err AbortError, playing undefined, m.outcome failed:AbortError`. Dean would read that as a sidecar
   error when the truth is "the audio never started before you came back", the exact
   stuck-HANDING_OFF shape phase 2 has to size. Prescription: take the timing marks in both promise arms
   only for a non-superseded attempt (after the supersede check), or record a superseded rejection
   separately (for example `ret.pendingAtReturn`). qa W3 (a retried handoff inside one record keeps the
   first attempt's `err`) shares this seam. I RE-DROVE it (probe ADV-6): one record, `trigger
   pause-hidden`, `err NotAllowedError`, `playing` 30.2, `advance` 30.4, `outcome
   failed:NotAllowedError`. Confirmed. Fix both together: reset the per-attempt marks in
   `bgTimingBeforeHandoff` and guard the promise-arm marks on the attempt being current.
3. **WARNING - the storage-failure guards on the handoff path are present but UNBOUND** (brief surface
   1 names storage disabled / quota / private mode). Mutant Ma drops the try in `isBgTimingEnabled`:
   183/0 SURVIVED. Mutant Mb drops the catch in `bgTimingPersist`: 183/0 SURVIVED. The destruction is
   real. With both mutants applied, probe ADV-2 (toggle OFF, getItem throws SecurityError at a lock)
   records ZERO media calls: no sidecar play, no video pause, no save. The throw at the top of
   `handleBackgroundLifecycle` kills the handoff for EVERY user whose storage is blocked, toggle off
   included. Probe ADV-3 (the W1 re-lock write throws QuotaExceededError) likewise kills the second
   handoff. The shipped code is correct: both probes pass at 8fd3b99a. No test holds it there.
   Prescription: add ADV-2 and ADV-3 as tests (assert the IDENTICAL media calls to a clean run).
4. **SUGGESTION - the relaxed recordLifecycleEvent locks admit arbitrary code on the tap line**
   (player-lifecycle-release.test.js, both locks: `bgTimingTap\(type, extraCtx\);[^\n]*\n`). Mutant Mc
   appends `try { localStorage.setItem('ft-adv', String(Date.now())); } catch (_) {}` to that line: a
   sync write on EVERY lifecycle event, ahead of the debug bail. 183/0 SURVIVED. Both locks and the
   AC4 OFF test (it filters non-log setItem calls out of the trace) stay green. Tighten `[^\n]*` to
   `[ \t]*(?:\/\/[^\n]*)?`.
5. **SUGGESTION - the desktop scope claim is unbound** (Disclosed gap 7: "desktop ... produce[s] no
   record"). Mutant Md drops `!isMobileFormFactor()` from the open gate: 183/0 SURVIVED. Every test
   boots an iPhone. Add one desktop-navigator boot asserting no record. qa S5 separately notes that the
   OFF-cost prose ("while a mobile video is loaded") is wrong for the same reason. I concur by reading:
   the toggle read comes before the mobile check, and `bgTimingOnVideoPause` has no form-factor check.
6. **SUGGESTION - Copy's rejection arm and Clear's 4s disarm are unbound.** Mutant Mh swallows a
   `writeText` rejection (`, () => {}` for `, fallback`): 183/0 SURVIVED. The test drives only the
   no-clipboard arm, yet the rejection arm is the one iOS reaches if user activation is lost across the
   `Promise.resolve().then(...)` deferral. That deferral is a suspicion, not driven; qa raised it too.
   The repo's own "iOS clipboard rule" comment (common.js ~12189) says every pick must be ready inside
   the tap. Mutant Mn deletes the disarm timer, so an armed Clear stays armed forever and a tap minutes
   later clears with ONE tap: 183/0 SURVIVED. Bind both (a rejecting `writeText` shows the text box; an
   armed Clear resets after the timeout).
7. **SUGGESTION (concur, no action needed) - M18 and a sibling dead belt.** M18 re-run: 183/0, as the
   table says. I tried to reach the guard's false arm. The only open-record sidecar event I could build
   in INLINE_VIDEO state is the release's `removeAttribute('src')` + `load()` timeupdate. It rewinds to
   0, so `now <= base` rejects it anyway. The guard is unobservable, and I accept it as disclosed. The
   same holds for `!rec.ret` in the tap's skip-decision arm (mutant Mm 183/0): a skip only comes from a
   hide, and a hide finalizes a `ret` record first.

Summary: 3 WARNINGs (W1 shared with qa W1; W2 new, absorbing qa W3 which I re-drove), 4 SUGGESTIONs.
The reopen behavior change is sound and well bound. The collector's measurement truth and its
no-write/no-throw contract are not yet. Adversary mutants: 14 of mine (4 KILLED, 10 SURVIVED) plus
2 builder spot-checks (M2, M3: both KILLED). Every survivor is itemised above. Scratch probes and sandboxes lived only under
the session scratchpad. The worktree is untouched apart from this section.

Gate: CHANGES r1 @8fd3b99a — adversary

## r1 fix record

Verdicts committed as-is at bab2107c. Fixes as NEW commits (nothing amended):
**d802d7f7** (the fixes; pre-commit unit suite 7136 pass / 0 fail) and **a2c53340** (the Mv
binding + the R7 comment; 7137 pass / 0 fail). A first attempt at d802d7f7 was refused by the
hook: `v1262-mobile-input-zoom.test.js` pins the exact `.comment-input-box, .folder-name-input`
floor rule, and adding the text box to that selector list broke it. The text box now has its
OWN rule in the same mobile block; that lock is untouched.

| Finding | Fix | Binding test (player-bg-timing-log.test.js unless named) | Mutants (red / survives) |
|---|---|---|---|
| W1 = adv W1 = qa W1: a sync write ahead of play() on a re-lock inside the return settle window | `bgTimingOnHidden` closes a returned (or other-media) record with `bgTimingFinalize(rec, true)`: the write is QUEUED; `bgTimingPersistSoon` keeps ONE queue PER RECORD (`rec.wq`, never stored). The collector comments (the block header, the `handleBackgroundLifecycle` hook's "reads only") now say what the code does. | "W1: a re-lock inside the return settle window writes NOTHING before the new sidecar play()..." (the trace INSIDE the hide handler has no setItem; the writes land after play(); the old record closes as cut short; a NEW record opens with its first write intact). "W1: a return whose video never moves closes after the 5 s settle". | R1 sync close: red. R2 one shared flag: red. R3 re-hide without closing the returned record (adv survivor): red. R4 no 5 s settle timer (adv survivor): red. |
| W2 = adv W2 + qa W3: our own release relabelled a pending handoff `failed:AbortError`; a retry kept the first attempt's `err` | `bgTimingBeforeHandoff` counts `attempts` and, from the second, resets the per-attempt marks (keeping `firstErr`). Both promise arms go through `bgTimingOnPlaySettled(rec, attempt, err, live)`: marks only for the current attempt of an open record while it is still the live handoff; otherwise `superseded: {at, by}` and the outcome stays 'pending'. The readout says "attempt 2, first failed: X" and "the audio had not started when you came back". | "W2: a retry inside one record (NotAllowedError, then the pause-hidden recovery) reports the FINAL attempt". "W2: a handoff still PENDING when you come back stays pending...". Setup note test. | R5 no reset: red. R6 no live check: red. R8 no firstErr: red. **R7 no attempt-number check: SURVIVES**. Unreachable behind the live check: a second attempt needs INLINE_VIDEO, which the first reaches only by settling, by a return (no further attempts in that record), or by a teardown whose pause rejects it first. Kept with a comment saying so. |
| W3 = adv W3: the storage-failure guards were unbound | No code change (the code was correct). | "W3: blocked storage (SecurityError on every access) and full storage (QuotaExceededError) leave the handoff intact, log on AND off": the richest cycle (lock, audio, return, re-lock, audio, return) makes IDENTICAL media calls to a clean run, with nothing thrown into the page. The harness now collects jsdom-reported listener errors and unhandled rejections. | Ma (no try in `isBgTimingEnabled`): red. Mb (no catch in `bgTimingPersist`): red. |
| qa W2: the fallback text box computed 10px on mobile (iOS zooms on focus) | Its own `font-size: var(--fs-input-min)` rule in the v1.26.2 mobile block (desktop keeps 10px). Why the zoom test missed it: it is a hand-picked list of surfaces, so a new class never enters it. New census in `mobile-input-zoom-fontsize.test.js`: every classed input / select / textarea in public/*.html that an unconditional class rule sizes under 16px must be lifted to >=16px inside the max-width: 768px block. | The census. Measured at 390 / 375: the text box computes 16px (a plain textarea also 16px); 1280: 10px. The layout is unchanged (390: doc 390, scroller 324/324). | Mz (drop the floor): red (census). The census found the pre-existing Music / Books sort `<select class="btn btn-sm">` at 12px: allowlisted by name, **tracker #252**. |
| adv S4: the relaxed locks admitted arbitrary code on the tap line | Both locks now allow only `[ \t]*(?:\/\/[^\n]*)?` after the tap statement. | player-lifecycle-release.test.js (both locks). | Mc (a setItem appended to the tap line): red (both locks + W1). |
| adv S5 + qa S5: desktop scope unbound; the cost prose was wrong | The mobile check now runs BEFORE the toggle read in both hooks (desktop never reads storage). Disclosed gap 6 corrected. | "scope: desktop never records, and never even reads the toggle at a hide or a pause". | Md (no mobile check): red. Md2 (toggle read first): red. |
| adv S6: Copy's rejection arm and Clear's disarm unbound; writeText behind a microtask | `writeText` is called SYNCHRONOUSLY in the tap (in a try); a rejection shows the text box. | "Setup: Copy calls writeText SYNCHRONOUSLY inside the tap...; a REJECTED write shows the text box". "Setup: an armed Clear disarms after 4 s..." (mock timers). | Mh (rejection swallowed): red. Ms (writeText in a microtask): red. Mn (no disarm): red. |
| qa S4: the no-swap note could be false | `bgTimingOnVisible` records `ret.videoPaused`; the note reads "video kept playing" / "video was paused". | The setting-off no-swap test asserts `videoPaused` true; new "a no-swap return records a video that KEPT playing (native fullscreen...)" asserts false; Setup note test. | Mv: survived at d802d7f7, **red at a2c53340** (2 tests). |
| qa S6: stale test title | Retitled (player-background-audio.test.js). | n/a | n/a |
| qa S7: `.bg-timing-log-row` had no CSS rule | `.bg-timing-log-row td { white-space: nowrap; }` (a value never breaks mid-number; 390 re-measured, no overflow). | n/a (layout measured) | n/a |
| qa S8: Copy threw on a non-numeric `t` | `bgTimingIsoLabel` guards it ('?'). | Setup note test (`t: 'not-a-time'`). | Mt: red. |
| adv S7 / M18: dead belts | Kept, each with a defense-in-depth comment (`bgTimingSidecarRec`'s active-element check, the tap's `!rec.ret`). | n/a | M18: survives (as tabled). |
| qa S9 (note) | Pre-existing inline label style, left as the section's convention. | n/a | n/a |

**r1 mutant table** (runner: scratchpad `lock-audio-measure-mutants-r1.py`; one /tmp sandbox per
mutant from `git archive d802d7f7`, the mutated file confirmed by `diff -r -q`; 205 tests across
player-bg-timing-log, player-background-audio, player-lifecycle-release,
mobile-input-zoom-fontsize, v1262-mobile-input-zoom). **42 mutants: 39 killed, 3 survived
(M18, R7, Mv).** Mv was then bound, and re-run at a2c53340 (206 tests): **Mv red (204/2)**;
M18 206/0 and R7 206/0 survive as disclosed defense in depth. Every r0 mutant (M1-M19) was
re-run on the new code and every one except M18 is still red (M2 now also reds the W1 test;
M4 now reds 8). Full per-mutant output: scratchpad `lock-audio-measure-mutants-r1.out`.

Instruments at a2c53340: eslint on the changed js files clean; `npm run lint:css -- --enforce`
TOTAL 0; overlay-containment clean; `node --test` player-* + setup-* + mobile-input-zoom-fontsize
+ tech-debt / css-token-lint / comment-debt census 879/879 (before the Mv tests); the
pre-commit unit suite 7137 / 0. Full `npm test` was not run by the builder.

## Gate r2 - qa (@3e3b898e)

Delta reviewed: `git diff 8fd3b99a..3e3b898e` (d802d7f7 fixes, a2c53340 Mv binding, 3e3b898e fix
record), every changed file. Instruments at 3e3b898e (Node v22.23.1), verbatim:
- `node --test` player-bg-timing-log + player-lifecycle-release + player-background-audio +
  mobile-input-zoom-fontsize + v1262-mobile-input-zoom: `# tests 206 # pass 206 # fail 0 # skipped 0`.
- setup-*.test.js + css-token-lint + overlay-containment + comment-debt / tech-debt / exec-plans /
  docs-status census: `# tests 114 # pass 114 # fail 0`.
- `npm run test:unit`: `# tests 7137 # pass 7137 # fail 0 # skipped 0` (exit 0).
- `npm run lint:css` TOTAL 0; `css-token-lint.js --enforce` TOTAL 0; overlay-containment
  `clean (0 violations)`; eslint on the 6 changed js files: no output, exit 0.
- Probes re-run in a `git archive 3e3b898e` sandbox (deleted after).

My r1 findings, one by one:
1. **W1 (write before play()) - fixed as prescribed.** It uses a per-record `wq` flag, not the shared
   one. Re-ran the trace probe: the calls INSIDE the re-lock hide handler are `seek, play(sidecar),
   pause(video)` with no setItem. Both writes (the old record's close, then the new record's first
   write) land after play(). Both records are on disk: the old one `ok/resume, done`, the new one
   `pending`, so the new first write was not swallowed. `wq` never reaches storage: the JSON replacer drops
   it, and the probe found no `wq` key on either stored record.
   The new block-header comment is accurate. One residue, S-a below.
2. **W2 (textarea under the zoom floor) - fixed differently, correctly.** The class got its own rule
   in the mobile block rather than joining the pinned `.comment-input-box` list (which
   `v1262-mobile-input-zoom` locks). Re-measured in headless Chromium: the timing textarea computes
   **16px** at 390 and 375 wide (a plain textarea 16px), and 10px at 1280 wide (desktop, as intended).
   Layout unchanged: 390 wide gives doc 390 and scroller 324/324, 375 wide gives 375 and 309/309.
   The new census binds it: dropping the floor rule reds it with
   `.bg-timing-log-text (textarea in setup.html) computes 10px on mobile`, and emptying
   `ZOOM_CENSUS_KNOWN` reds it with `.btn (select in books.html) computes 12px on mobile`.
   Tracker #252 checks out: `#music-sort-select` measures 12px at 390 in Chromium.
3. **W3 (retry misreported) - fixed differently, acceptably.** Attempts are counted and the per-attempt
   marks reset. Re-ran the retry probe: `attempts 2, firstErr NotAllowedError, err absent, outcome ok`,
   and the note reads `ok via pause-hidden (attempt 2, first failed: NotAllowedError)`. The spans
   still run from the first hide, but the readout now states the attempt count beside them, and the
   block comment says so. That is a fair disclosure, not a contradiction. `bgTimingOnPlaySettled`'s
   live check also closes the adversary's AbortError-after-return case.
4. **S4 (no-swap note) - fixed.** Probe: a setting-off skip followed by a Play while hidden stores
   `ret.videoPaused false`, and the note reads `back: no swap (video kept playing)`.
5. **S5 (cost prose) - fixed.** The mobile check now runs before the toggle read in both hooks, and
   Disclosed gap 6 is corrected. Both are bound by the new desktop-scope test.
6. **S6 (stale title) - fixed.**
7. **S7 (row class) - fixed.** `.bg-timing-log-row td { white-space: nowrap }`, layout re-measured as
   above.
8. **S8 (Copy on a bad `t`) - fixed.** `bgTimingIsoLabel`, bound by the Setup note test.
9. **S9 note - writeText is now synchronous in the tap (in a try), rejection shows the box; bound.**
   The inline-style convention was left as is, as I allowed.

New items (none blocking):
- **S-a, SUGGESTION - one comment the fix record says was corrected was not** (player.js:3746, the
  `handleBackgroundLifecycle` hook still ends "reads only"). The fix record's W1 row says the hook's
  "reads only" now says what the code does. The code is now write-free on the synchronous path, but
  the hook also mutates the in-memory record and queues a microtask write. Suggested wording: "no
  synchronous storage write". Harmless either way; the adjacent block header is precise.
- **S-b, SUGGESTION - a cut-short return reads "did not move".** A re-lock inside the settle window
  closes the old record, which the W1 test calls "cut short". The readout note still says `back:
  video did not move`, because the record carries no marker for the cut-short case. A `ret.cut` flag
  set in the re-hide close would let the note say "cut short by a re-lock".
- **S-c, SUGGESTION - `ZOOM_CENSUS_KNOWN` allowlists the CLASS `btn` everywhere.** Today that is only
  the two #252 selects. But any future `<select class="btn ...">` on any page would pass silently.
  Key the allowlist on file + id (`music.html#music-sort-select`, `books.html#books-sort-select`) so
  #252 cannot absorb a new offender.
- **S-d, SUGGESTION - the settle test waits 5.2 s of real time** ("W1: a return whose video never
  moves"). The ordering is deterministic (the settle timer is armed first), so it is not a flake, only
  suite time. The Clear test already uses mock timers, and this one could too.

No regressions found in the delta. No new security surface: the delta adds no network call and no
markup injection, and storage stays device-local.

Gate: APPROVED r2 @3e3b898e — qa

## Gate r2 - adversary (@3e3b898e)

Delta reviewed: `git diff 8fd3b99a..3e3b898e` (fixes d802d7f7 + a2c53340; HEAD =
3e3b898e4681ee668c99cf521af995ac7c1cf83f). Everything was measured in a /tmp sandbox built from
`git archive 3e3b898e` (Node v22.23.1). Instruments, verbatim:
- The five targeted files (player-bg-timing-log, player-background-audio, player-lifecycle-release,
  mobile-input-zoom-fontsize, v1262-mobile-input-zoom): `# tests 206 # pass 206 # fail 0`.
- `player-*` + `setup-*` + the two zoom files: `# tests 858 # pass 858 # fail 0 # skipped 0`.
- The ten census files, run read-only in the worktree: `# tests 92 # pass 92 # fail 0`.
- `npm run lint:css -- --enforce`: `TOTAL 0`. overlay-containment: `clean (0 violations)`. eslint on
  the changed js files: exit 0.
- Layout probe re-run at 3e3b898e, with the new `nowrap` cells: 390 doc 390, scroller 324/324; 375: 375,
  309/309. Unchanged.
- The full `npm test` was not run.

My r1 repros, re-driven on the r2 harness (not taken from the builder's tests):
- ADV-1: the re-lock trace INSIDE the hide handler is `[seek, play bg-audio-sidecar, pause
  media-player]`, with no setItem. The two writes (the old record's close, then the new record's first)
  land after it. 2 records.
- ADV-4: the pending handoff stays `pending` after the return and the 5 s settle, with `superseded
  {by: AbortError}` and no `err`.
- ADV-6 (qa W3): `attempts 2, firstErr NotAllowedError, outcome ok, trigger pause-hidden`.

Findings against r1:
- **W1 (sync write before play on a re-lock): FIXED as prescribed.** It uses a per-record queue
  (`rec.wq`), as I asked. My r1 survivors on this arm are now red at 205/1 each: Mg (a re-hide that
  keeps the returned record) and Mk (no 5 s settle timer). New mutants: N1 (sync close) 205/1 and
  N2 (one shared flag again) 205/1. I swept for other synchronous writes inside the hide task. The
  tap's skip, the decision and the finalize-on-re-hide all queue a microtask. The remaining
  synchronous `bgTimingPersist` calls (the sidecar's first advance, the video's return advance, the
  settle timer, the finalize on visible) run in their own events or timers, never in the hide task.
- **W2 (our own release relabels a pending handoff; qa W3 retry): FIXED, differently from my
  prescription, and I accept the deviation.** `bgTimingOnPlaySettled` computes `live` at settle
  time, the correct moment. The per-attempt reset keeps `firstErr`. Kills: N3 (always live) 205/1,
  N4 (no reset) 205/1, N10 (superseded not recorded) 205/1, N11 (superseded recorded as err) 205/1,
  N12 (no firstErr) 205/1, N13 (no "had not started" wording) 205/1. R7 (no attempt-number check)
  survives, 206/0. I tried to reach it. The only way into INLINE_VIDEO with attempt 1 still pending
  and no return is a terminal-pagehide `releaseAudioSession`. There the following `freeze` cannot
  consume a candidate (only visibilitychangeHidden may), and our own pause is suppressed, so no
  second attempt starts before the rejection task lands. It is unreachable, and I accept it as
  disclosed. Residual, disclosed by the builder: an attempt-2 record keeps the FIRST iOS pause and the
  first hide as its anchors, so its spans include the user's reaction time. The readout says "attempt
  2" beside them. Acceptable for a measurement log.
- **W3 (storage guards unbound): FIXED.** Ma 205/1 and Mb 205/1 are red on the new W3 test (blocked
  and full storage, log on and off, identical media calls, no page error).
- **S4 (lock hole): FIXED.** Mc (a setItem on the tap line) 203/3. Mc2 (a harmless `void 0;` on the
  tap line) 204/2, so the lock now rejects ANY extra code.
- **S5 (desktop scope): FIXED.** Md (hide gate without the mobile check) 205/1, and Md3 (pause stamp
  without the mobile check) 205/1. Moving the mobile check ahead of the toggle read adds one
  `isMobileFormFactor()` (three matchMedia reads) per video pause on every form factor. It was
  already called on every hide. Negligible.
- **S6 (Copy rejection / Clear disarm / microtask writeText): FIXED.** Mh (rejection swallowed)
  205/1, N8 (writeText back behind a microtask) 205/1, Mn (no disarm) 205/1.
- **S7 (dead belts): as disclosed.** M18 206/0 and Mm 206/0 still survive, as argued in r1, and are
  now commented as defense in depth.

New in the fix (suggestions only; I found no CRITICAL or WARNING):
1. **SUGGESTION - the #252 allowlist is keyed by CLASS, so it exempts any future `btn`-classed text
   control.** Mutant N17 adds `<input type="text" class="btn" id="adv-x">` to setup.html. It computes
   12px on mobile (`.btn` = `--fs-sm` = 12px), a zoom-on-focus control, and the census stays green
   (206/0, SURVIVED). Key `ZOOM_CENSUS_KNOWN` by file + id (`music.html#music-sort-select`,
   `books.html#books-sort-select`) so it exempts exactly the two known offenders. For the record, the
   census does bind its own case: N6 (drop the floor) 205/1, N16 (floor at 15px) 205/1, and N15 (empty
   allowlist) 205/1 surfaces the #252 selects, which confirms that tracker row.
2. **SUGGESTION - two small arms are unbound.** Mh2: a SYNCHRONOUS `writeText` throw that skips the
   fallback survives 206/0; only the rejection arm is tested. N7: dropping `wq` from the JSON replacer
   survives 206/0, so a stored record can carry `wq: true` (when a direct advance write lands while a
   queued write is pending), against the comment "never stored". It is cosmetic. Add `!('wq' in r)`
   beside the existing `p0` assert.

Tally: 30 adversary mutants at 3e3b898e, 24 KILLED, 6 SURVIVED. The survivors are M18, Mm and R7
(dead belts, accepted) and N17, Mh2 and N7 (the suggestions above, for the tracker per Dean's
overnight rule). I spot-checked the builder's kill claims for Ma, Mb, Mc, Md, Mg, Mh, Mk, Mn, R1
(=N1), R2 (=N2), R5 (=N4), R6 (=N3), R8 (=N12), Mz (=N6), Mt (=N14), Mv (=N9) and Ms (=N8). All
reproduce red. R7 and M18 survive as tabled. The worktree is untouched apart from this section. The
qa r2 section above it was already in the file, uncommitted, when I appended.

Gate: APPROVED r2 @3e3b898e — adversary
