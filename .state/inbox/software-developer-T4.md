# Software Developer inbox — T4 (FR-5 PWA lifecycle) — ⛔ HELD / DO NOT START

Feature: **v1.17.0 "Polish"** (feature_id `v1.17-polish`). This is **Task T4**.

## ⛔ THIS TASK IS BLOCKED — DO NOT BEGIN IMPLEMENTATION

T4 is **held pending a Dean product decision** on the FR-5 background-audio-vs-
pause-on-lock tradeoff. The coordinator is asking Dean in parallel; this inbox is
a placeholder so the track is visible, NOT a go-signal. If you were launched
against this file, **stop and report that T4 is blocked** — do not write code.

**The open decision (from `## Design → ### FR-5` in
`docs/exec-plans/active/2026-07-06-v1.17-polish.md`):** pausing on
`visibilitychange:hidden` also stops screen-off / lock-screen background audio.
There is no clean iOS PWA event that isolates a true force-close from ordinary
backgrounding. Two options:

- **(recommended) all-three-event version** — pause + persist on `pagehide`,
  `freeze`, and `visibilitychange` going `hidden`. Most reliable force-close
  coverage; the cost is no screen-off background audio.
- **fallback** — `pagehide` + `freeze` only, keeping lock-screen background audio
  but with less-reliable force-close coverage.

Recommendation on record: ship the all-three-event version and let Dean's
on-device iOS-PWA pass arbitrate. **Do not implement until the coordinator
updates this inbox with Dean's pick.**

Review tier when unblocked: **TWO-REVIEWER GATE** (lifecycle events). Dean's
on-device iOS-PWA force-close-during-playback pass is the documented **ARBITER**.

## When unblocked — planned scope (for reference only; do NOT start yet)

Add lifecycle listeners in `public/js/player.js` **alongside** the existing
foreground `visibilitychange` re-assert (~280-285, which stays intact). On the
chosen events, if media is loaded and playing: `mediaPlayer.pause()` and persist
progress (`saveProgressToServer(currentAbsTime())`). Extract a pure, unit-tested
guard `shouldPauseForLifecycleEvent(type, { hasMedia })`. On reopen (a fresh page
load) the standard `handleResumePlayback` overlay is the clean re-entry (progress
was persisted `>5`). Must NOT regress the existing foreground Media-Session
re-assert for ordinary backgrounding.

Note: T3 (FR-4) also edits `player.js` and is in flight — when T4 is unblocked,
rebase/coordinate against T3's `player.js` changes via the coordinator.

## Git — DO NOT commit (and DO NOT code)

The coordinator owns ALL git. For now: do nothing but confirm the hold.
