---
plan: black-picture-root-cause
harness: v2 · lean
branch: plan/black-picture-root-cause
anchor: outcome
status: Draft
next: the investigator (Fable) reads section 0, then 1-4, and works section 5 in order; nothing is built before the cause is named
design: Dean 2026-10-04: "This has really, really eluded us... Only seems to be happening on pause with a single tap and [mobile]. Why, why, why?" and "prep the handoff for a Fable agent. This has looped enough times."
gate: pending
---

# The iPhone black picture: find the cause, with evidence, before any fix

Written 2026-10-04 by the v1.362.x builder (Opus), after v1.362.3 shipped (PR #87, main 471c15e7). This is an
INVESTIGATION brief, not a build plan. Five releases have shipped against this bug (v1.336 instrument, v1.360 fix FAILED, v1.361
fix FAILED, v1.362.2 instrument, v1.362.3 instrument + A/B switch). The pattern that cost them: a theory from indirect evidence,
a fix, a device failure. The next step must NAME the cause from a discriminating measurement taken on Dean's iPhone, then fix it.

## 0. Step 0 - read, environment, rules

0.1 Read `AGENTS.md`, `docs/LESSONS.md` sections 0, 1, 7, 8 (section 7's last class is this bug's lesson; section 1's diagnosis
discipline is the rule you are here to keep), then this brief, then in order: `docs/exec-plans/completed/2026-09-26-fullscreen-black-and-border.md`
(first report, the v1.336 instrument), `2026-10-03-black-screen-after-pauses.md` (H1-H8, the failed v1.360), `2026-10-03-tap-glyph-filter.md`
(the failed v1.361 diagnosis), `2026-10-04-loupe-black-checks.md` (v1.362.2: the recording analysis, the instrument),
`2026-10-04-loupe-any-hold-and-hold-log.md` (v1.362.3: the first exported log, section 1 and 1b). The ROADMAP Planned > Bugs entry
"after a pause / unpause the picture goes black" carries the running summary.
0.2 Environment: `export PATH="$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH"` before node/npm. Dual-Node
22.23.1 and 24.20.0. Recording analysis: `~/.local/bin/ffmpeg-static/ffmpeg`; the 2026-10-04 recording and frames are in
`~/.claude/projects/-home-coder-projects-filetube/analysis/2026-10-04-recording/`.
0.3 Git, gate and release rules: AGENTS.md and `docs/RELEASING.md` (protected main: local `merge --no-ff`, tag, one push of branch +
tag, `gh pr create`, CI green, `gh pr merge --merge`). Never self-merge; the gate is adversary + qa.
0.4 **Stop rules.** (a) Never ship a fix for a cause that has not been named by an on-device measurement that could have come out
the other way; (b) never re-patch a failed theory (LESSONS 1); (c) any change to how a gesture behaves (tap timing, the double-tap
window, the glyph for everyone) is Dean's ruling: ask; (d) headless Chromium does not reproduce this (iOS 27 WebKit only); do not
"verify" a cause there.
(e) **No toggle workarounds** (Dean, 2026-10-04: "A toggle workaround for a recently introduced non root caused bug is not
tolerable"). The v1.362.3 switch "No glyph on picture taps" exists ONLY to run Run B; the release that fixes the cause removes it.
Never propose a setting, or turning a feature off, as the fix.

## 1. The symptom (Dean's words and the measured facts)

- iPhone, iOS 27 (27.0.1 in the 2026-10-04 log), home-screen app and Safari. "Only seems to be happening on pause with a single
  tap and [on mobile]." Inline, in faux full screen and in the mini player (the same persistent `<video id="media-player">` host).
- The picture goes black; the SOUND plays on; the clock and captions advance; Ambient's glow keeps running. The element reports
  PLAYING (2026-10-04 recording: the v1.362.1 chevron hid on time, which needs `paused === false`).
- The layer's frame count (`getVideoPlaybackQuality().totalVideoFrames`, a ~2 s cached copy relayed from the GPU process) stops.
- Recovery: a far seek does NOT revive it; docking and returning does not; a new `src` (another video and back) DOES; an app restart does.
- Dean's A/B (2026-10-03, iOS 27): 20 pause/play cycles with ONLY the bar's button never went black; picture taps did; Background
  audio for video OFF and Ambient OFF made no difference (the first pause/resume after an app restart froze once).

## 2. What has been tried, and what each result rules out

| Release | Theory | Result on the device | What it rules out |
|---|---|---|---|
| v1.336 | (instrument) per-event video state, a 6 s frame-count check after `playing` | captured frozen counts | - |
| v1.360 | H8: the background-audio prime under a paused video starves the layer; + a seek self-heal | FAILED: froze with the prime working ~10 s; the heal's seek did not revive; froze with Background audio OFF | the prime; an in-place seek as a cure |
| v1.361 | the tap glyph's `filter: drop-shadow` flashed over the playing video | FAILED: recurred on v1.362.1 | the FILTER (not the glyph itself) |
| v1.362.2 | (instrument) `video:frozen`, `via=`/`g=` per play, holds, rate, one-button export; loupe cancel inside the tap window | the loupe still showed (plain hold); first exported log | the "chevron stayed up" lead (falsified from the recording) |
| v1.362.3 | (instrument) the frozen series across pauses, `video:fcount-reset`, hold `f=`; the switch "No glyph on picture taps"; every picture touch cancelled | pending | - |

## 3. The first exported log (Dean, 2026-10-04 17:48, v1.362.2) - the strongest evidence so far

Dean: black "at the very end, one of the last pauses". In order:
- 17:48:14.9 autostart; :18.1 a 2x hold, :19.1 locked; :21.8 a double-tap + chain (skip +15 s); :24.0 the lock released.
- :25 - :36 six pause/play rounds by PICTURE tap; every resume `media:play via=picture-tap g=358..388` (the play from the 350 ms
  single-tap timer, outside the gesture); :30.3 - :31.0 a second 2x hold.
- **The layer's frame count went DOWN after each hold**: the post-autostart check series 10, 28, **0**, 16, 77, 136 (the hold at
  :18.1); 208 at the play at :29.5, **102** at the pause at :32.1 (the hold ended at :31.0). A lower count means a new layer.
- After the second drop the count read **114** at the play :32.9, the pause :34.2, the play :35.4 and the pause :36.2 while the
  clock ran 43.6 -> 46.6. That is where Dean saw black. (Only ~2.1 s of it was playing time; the cache refreshes ~2 s: suggestive.)

## 4. The candidates (what a picture tap does that the bar's button does not, plus the log's lead)

| # | Candidate | Code fact | Falsifier on the device |
|---|---|---|---|
| C1 | The play comes OUTSIDE the gesture | `scheduleArtSingleTap` plays from a `setTimeout(DOUBLE_TAP_MS = 350)` after the lift; the bar's `#pp-btn` plays inside its click | Run C (pause by tap, resume with the BAR) goes black, or Run A never does |
| C2 | A full-size layer animates over the playing video | `flashArtGlyph` -> `.art-play-glyph` (`inset: 0`, z-index 2) runs `art-play-glyph-fade` (opacity + scale, 650 ms) from the moment of the play; the bar never paints over the picture | Run B ("No glyph on picture taps" ON) still goes black |
| C3 | WebKit's touch handling on the `<video>` itself (the loupe is its visible sign) | v1.362.3 cancels every one-finger touchstart on the picture | black still happens on v1.362.3 with taps (C3 alone cannot be it) |
| C4 | A rate change (the 2x hold) rebuilds the video layer, and the new layer sometimes gets no frames | the log's two count drops, each right after a hold | Run A (no holds) goes black; Run D (holds, bar only) never does |
| C5 | An iOS 27 compositor fault independent of input | - | a black with no tap, hold or rate change in the log before it |

## 5. The work, in order

1. **Get the four runs** (DEVICE-CHECKS.md, v1.362.3; lifecycle log ON; no double-taps): (A) twenty pause/play by picture tap, no
   holds; (B) A with "No glyph on picture taps" ON; (C) pause by picture tap, resume with the bar; (D) a few 2x holds, then
   pause/play with the bar only. Plus an exported log for every black. Ask Dean for exactly this; do not build first.
2. **Read the result against section 4's falsifiers** and write the verdict table into this brief. Every claim cites a log line or
   a run. If two candidates survive, design the NEXT zero-build or one-switch A/B that splits them (the switch pattern: v1.362.3 E3).
3. **Only then** propose the fix for the named cause, as a ruling for Dean (C1's fix changes the double-tap timing; C2's removes
   or replaces the glyph for everyone; C4's would avoid a rate change on the video element, e.g. a different 2x mechanism).
4. Build it as a normal release (plan, waves, gate, `docs/RELEASING.md`), with a device check that can FAIL.

## 6. Evidence (the investigator fills this)
