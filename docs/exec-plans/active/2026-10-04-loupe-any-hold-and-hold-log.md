---
plan: loupe-any-hold-and-hold-log
harness: v2 · lean
branch: feat/v1.362.3-loupe-hold-log
anchor: spec
status: Building
next: build L1 (cancel every picture touch) and I1 (the instrument across pauses), test, gate (adversary + qa)
design: Dean's rulings E1-E3, 2026-10-04 (kickoff at main ce799825), after his v1.362.2 device pass and the first exported log.
gate: pending
---

# v1.362.3: no loupe on any hold; the black-picture log sees short pause/play rounds and the hold's layer reset

Kickoff 2026-10-04 by the builder at main ce799825 (v1.362.2 shipped, PR #86), from Dean's first exported lifecycle log
(iOS 27.0.1, standalone app, 73 entries, 17:47:57-17:48:41) and his words: "At the very end one of the last pauses. Also I still
see the loupe".

## 1. What the device and the log showed

- **The loupe still shows (v1.362.2's D1 failed on the device; the diagnosis was incomplete, LESSONS 1).** D1 cancels only a touch
  inside the 0.35 s tap window. In the log neither hold was in it: the hold at 17:48:18.1 had no tap before it, and the one at
  :30.3 began about 650 ms after the tap that played at :29.5 (`g=388`). So the loupe comes on a PLAIN hold, with body
  `user-select:none` and `-webkit-touch-callout:none` already applied (ui.css). That is the case v1.362.2 section 9 set aside.
- **The black picture came "at the very end, one of the last pauses".** The log: the second 2x hold ended at :31.0; the layer's
  frame count went DOWN from 208 (play at :29.5) to 102 (pause at :32.1), i.e. the layer restarted; then it read 114 at the play
  at :32.9, the pause at :34.2, the play at :35.4 and the pause at :36.2 while the clock ran 43.6 -> 46.6. The first hold (:18.1)
  also restarted the count (the `video:check` series 10, 28, 0, 16, 77, 136) and it recovered. **Lead H4:** a playback-rate
  change (the 2x hold) makes iOS 27 rebuild the video layer, and sometimes the new layer gets no frames. H1 (the picture tap's
  late play, every play there had `via=picture-tap g~360`) is not ruled out. Weak evidence by itself: only ~2.1 s of that flat
  stretch was playing, and the iPhone refreshes the count about every 2 s.
- **`video:frozen` never fired, by construction:** it needs 3 s of unbroken playing and every pause cleared its series; Dean's
  rounds were ~1.3 s. The instrument is blind in exactly the A/B protocol.

## 1b. What a picture tap does that the bar's button does not (the "why" Dean asked, from the code and the log)

1. The play comes from a 350 ms timer after the lift (`scheduleArtSingleTap`), outside the gesture; the log shows `g=358-388`
   on every resume. The bar's button plays inside its click. (H1)
2. A full-size glyph layer (`.art-play-glyph`, `inset: 0`, z-index 2) animates opacity and scale over the playing video for
   650 ms (`art-play-glyph-fade`), starting with the play. v1.361 removed only its `filter`; the glyph itself was never tested.
   The bar never draws over the picture. (E3's switch)
3. The finger is on the `<video>` element (WebKit's own touch handling; the loupe is its visible sign). (H2; E1 cancels it)
4. From the log: a 2x hold restarts the layer (the count goes down) and the black came after the second one. (H4)
On a desktop a click on the picture toggles inside the click with no glyph, so 1 and 2 exist only on the phone, matching Dean's
"I meant mobile".

## 2. Rulings

| # | Question | Ruling |
|---|---|---|
| E1 | The loupe (**Dean**, 2026-10-04, took the recommendation "Cancel every touch") | Every one-finger touchstart that starts on the picture (`#media-player`) or the art (`#audio-bg-art`) is cancelled (`preventDefault`) while the player is FULL, not native full screen, not native-controls mode: the same separate non-passive listener registered after the passive tracker, its decision `pictureTouchCancelDecision` (D1's tap window is dropped from it; `inTapRunDecision` stays for the reveal grace). Accepted cost, stated by Dean's choice: a finger that starts on the picture no longer scrolls the page. Taps, double-taps, chains, hold 2x, the lock, pull-down minimize and swipe back keep working (the app drives them). Docked and closed: no cancel (the docked tap must still synthesize the expanding click). |
| E3 | A switch for the glyph (**Dean**, 2026-10-04, "Yes, add it"; after "Only seems to be happening on pause with a single tap and local... Why?", "local" = "I meant mobile") | Settings > Troubleshooting > "No glyph on picture taps" (`ft-debug-no-tap-glyph`, device-local, default off, read at every tap): `flashArtGlyph` draws nothing while it is on; the tap still pauses and plays. The A/B for difference 2 in section 1b. |
| E2 | The black picture (**Dean**, "Both together") | v1.362.3 builds the instrument fix (I1); Dean runs the no-build holds A/B on v1.362.2 meanwhile (Run A: twenty pause/play rounds by picture tap, no holds; Run B: a few 2x holds, then pause/play with the bar's button only). Nothing is fixed for the black picture. |

## 3. I1 - the instrument (reads only; nothing runs with the log off)

1. The frozen series survives a pause within the same load: a pause stops the timer but keeps the samples; each sample carries
   the play run it belongs to; a sample is taken at `playing` (the run's start) and at `pause` (its end) as well as once a second.
   `frozenPictureDecision` counts wall time and played time only on steps INSIDE one run (a step across a pause adds neither), so
   several short rounds add up and a long pause cannot fake a freeze. The series is cleared on a new load, `emptied`, `ended`, a
   dock or close, a hide and the flag going off. Still at most one timer.
2. `video:pause` carries `+f` / `+t` since the run's `playing` reading (how far the frame count moved while it played).
3. `video:fcount-reset` when a reading's frame count is LOWER than the previous one in the same load (the layer restarted), with
   both counts; and the `hold:*` lines carry the frame count (`f=`), so a reset can be placed against the hold.

## 4. Build log

- L1 (E1): `pictureTouchCancelDecision` replaces `tapPairCancelDecision`; `inTapRunDecision` stays for the reveal grace and
  now only decides whether a cancelled touch is logged as `gesture:tap-pair`. I1.1-I1.3 as section 3. E3: the switch.
- Failing first against main ce799825: `player-loupe-cancel.test.js` `# tests 17 / # pass 12 / # fail 5`;
  `player-black-picture-log.test.js` `# tests 40 / # pass 34 / # fail 6` (the I1 tests and the startFrozenSampler(s) lock).
- Old locks updated on intended changes: the window-based loupe drives rewritten to "every touch" (the guards' drives kept:
  two fingers, docked, native controls, native full screen); the `startFrozenSampler(s)` signature; the Settings switch count
  31 -> 32; the init order (`loadNoTapGlyphControl`). One drive fixed in the build: the I1.3 new-load drive now fires `emptied`
  as a browser does, and the code resets the count's baseline on `emptied` / `loadstart` (an emptied reading of 0 is not a drop).
- Targeted: the neighbouring suites `# tests 1337 / # pass 1337 / # fail 0` before E3; after E3 the loupe, export, setup,
  settings and shell files `# pass 285 / # fail 0`. `npm run lint:ui` OK (unchanged), overlay containment 0, eslint 0 errors.
- Commit df0d1bd7, hook `ℹ tests 8545 / ℹ pass 8545 / ℹ fail 0`.
- Mutants (18, /tmp `git archive df0d1bd7` sandbox, exact-once, restored, sandbox diff clean): 16 KILLED first run (each guard
  of the cancel, its passivity, the tap-pair log gate, cross-run steps, pause clearing, the run-start reading, the pause delta,
  the reset line and its emptied baseline, the hold `f=`, the glyph switch read, default and Settings write). SURVIVED: B3-M9
  (the pause takes no reading) and B3-M11 (the run id never moves): the drive's rounds held a tick and no drive had a long pause.
  A new drive (five 0.8 s rounds add up; two 1 s rounds around a 4 s pause do not) KILLS both.

## 5. Device checks (Dean, on the released build; in DEVICE-CHECKS.md in the release commit)

- [ ] v1.362.3 - iPhone, custom controls ON: press and hold the playing picture with no tap before it, inline, in full screen and
  on an audio file's art; and a double-tap then a hold: 2x every time, NO grey magnifier.
- [ ] v1.362.3 - Regressions: tap pauses, double-tap skips, chains skip, hold 2x, hold-drag down locks, the lock pill, pull down
  minimizes, swipe right goes back, the docked mini player's tap expands. Expected change: a finger that starts on the picture no
  longer scrolls the page (scroll from below it).
- [ ] v1.362.3 - The black picture, four runs (lifecycle log ON; no double-taps): (A) twenty pause/play rounds by PICTURE tap, no
  holds; (B) the same with "No glyph on picture taps" ON; (C) pause by PICTURE tap, resume with the BAR, twenty times; (D) a few 2x
  holds, then pause/play with the BAR only. Say which runs went black; after any black, Export log and send it.

## 6. Gate record
