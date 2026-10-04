---
plan: loupe-any-hold-and-hold-log
harness: v2 · lean
branch: feat/v1.362.3-loupe-hold-log
anchor: spec
status: Shipped v1.362.3
next: Dean's v1.362.3 device checks (section 5) and the four black-picture runs; the investigation continues in a Fable session (docs/exec-plans/active/2026-10-04-black-picture-root-cause.md on its own branch)
design: Dean's rulings E1-E3, 2026-10-04 (kickoff at main ce799825), after his v1.362.2 device pass and the first exported log.
gate: APPROVED r2 @9d7b27f9 (adversary, qa; security-brief applied as a section by both, no finding)
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

- Commit 5c7e6718 (the mutant bindings), hook `ℹ tests 8546 / ℹ pass 8546 / ℹ fail 0`. Dual-Node full `npm test` on 5c7e6718:
  Node 22.23.1 `# tests 10973 / # pass 10961 / # fail 0 / # skipped 12`; Node 24.20.0 `ℹ tests 10973 / ℹ pass 10961 / ℹ fail 0 /
  ℹ skipped 12`.
- Gate r1 CHANGES @5c7e6718 (qa, adversary; section 6). Fixes: the R2b comment and the v1.362.0 / v1.362.3 checks say a pull on the
  picture while scrolled down now does nothing (adversary measured 120 -> 120 on the branch, 120 -> 0 on main); a source lock that
  `wireStaticControls` wires and `init` prefills the no-glyph switch; the pause delta counts from the RUN's first reading (a mid-run
  waiting -> playing no longer moves it; an expand-started run has one); `player:dock` / `player:expand` lines; an art-tap drive for
  the switch; the stale test header, probe note and LESSONS casing. Logged in ROADMAP Planned > Bugs: the podcasts art scope, the
  cached-count suspicion, the unbound backups.

- Dual-Node full `npm test` on 9d7b27f9 (the approved sha): Node 22.23.1 `# tests 10976 / # pass 10964 / # fail 0 / # skipped 12`;
  Node 24.20.0 `ℹ tests 10976 / ℹ pass 10964 / ℹ fail 0 / ℹ skipped 12`. Fix mutants (7) on 9d7b27f9: all KILLED.
- Gate r2 APPROVED @9d7b27f9 (qa, adversary); their r2 suggestions are in ROADMAP Planned > Bugs (v1.362.3 gate suggestions).
- Dean, 2026-10-04, after the gate: "disabling the glyph (my decision) feels terrible. A toggle workaround for a recently
  introduced non root caused bug is not tolerable." The E3 switch is a TEST for Run B only; the release that fixes the cause
  removes it (recorded in the Fable brief's stop rules and the memory index).

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

Gate: CHANGES r1 @5c7e6718 - qa

1. WARNING (presence, not binding) - public/js/setup.js:3166 `wireNoTapGlyphControl(window, signal);` in wireStaticControls is
   bound by no test. Mutant (deleted that line, /tmp sandbox of 5c7e6718): pocket-kb-search, settings-forms-sweep,
   setup-debug-lifecycle-toggle, setup-debug-rotate-toggle, lifecycle-log-export, player-loupe-cancel `# tests 106 / # pass 106 /
   # fail 0`. The E3 test calls `setup.wireNoTapGlyphControl(w)` by hand. Scenario: the line goes in a refactor; Dean turns the
   switch ON, nothing is stored, Run B is Run A again and the A/B "clears" the glyph. Fix: the kb-search shape (a source lock that
   wireStaticControls wires it) or drive the real wireStaticControls.
2. WARNING (lying text E1 inverts) - (a) public/js/player.js:1149-1151 minimizeDragDecision: "scrolled down, the pull scrolls the
   page as today and only the NEXT pull at the top minimizes (R2b)": the touchstart is now cancelled, so a pull while scrolled
   down does nothing at all (sy > 1 gives 'none', and the page cannot scroll). (b) docs/DEVICE-CHECKS.md v1.362.0 Regressions still
   asks for "scroll down then pull on the picture (the page scrolls to the top first)"; only the wiggle part got a skip note.
   Scenario: Dean runs it, the page does not scroll, he reports a v1.362.0 regression that is the ruled cost. The v1.362.0 Safari
   line ("the pull at the top fights the browser's own overscroll") has a changed premise too. (c)
   test/unit/player-loupe-cancel.test.js:3-8 header: "cancels only the touch the app already classifies as a tap pair or a chain
   tap".
3. SUGGESTION - tools/log-export-proof/probe.js:6-7 and its W1 rows still expect +450 ms not cancelled and a drag 1 s after a tap
   to scroll: re-run as is, it reports a failure (not CI). Mark it v1.362.2-only or update it.
4. SUGGESTION - player.js:4323 sets `frozenRunStartState = s` on every 'playing'; a 'waiting' then 'playing' mid-run moves the
   pause delta's baseline while the frozen run stays (the +f/+t then covers only after the stall). Also unbound (mutants survive
   the five player/settings suites, 175/175): stopFrozenSampler clearing frozenRunStartState (a pause after a hide and return then
   carries a delta across the hidden time), and the `.ld === s.ld` guard (redundant with the loadstart/emptied stop).
5. SUGGESTION (suspicion, not measured) - the cross-run sum assumes iOS refreshes the cached frame count on a wall clock through
   pauses. If the refresh is driven by play time and restarts at each play, healthy ~1.3 s rounds read flat and `video:frozen`
   fires falsely in Run A. Cheap hedge: put the number of runs the flat stretch spans in the frozen line.
6. SUGGESTION - docs/LESSONS.md section 1: a lowercase "read the user's EXPORTED log" after a full stop. The plan's build log stops
   at df0d1bd7: it does not record 5c7e6718 or the dual-Node numbers. The frontmatter `next:` still says to build.

Verified (5c7e6718): targeted node --test on 5 changed suites 107/107; 15 neighbour/census suites 168/168; lint:ui OK; overlay
containment 0; eslint 0; check-markers 12 issues, all in other plans, the same 12 at ce799825. Correct as specified: the
decision and its listener; I1.1-I1.3; logHold f= only with the flag on; flashArtGlyph has one caller (toggleArtPlayPause);
switch count 32; init order; 37 DEVICE-CHECKS lines = ROADMAP 1-37 in order; no new em dashes. Security: device-local
localStorage '1' compare, static label text, no innerHTML, no network path.

Gate: CHANGES r1 @5c7e6718 - adversary

1. WARNING (lying text, measured) - the scrolled-down pull. Chromium, iPhone 13, raw CDP touch, real server, page scrolled to
   120, a 200 px pull that starts on the picture: base ce799825 scrollY 120 -> 0; 5c7e6718 120 -> 120, state full (no scroll AND
   no minimize: minimizeDragDecision returns 'none' for sy > 1). Control (no touch): 120 -> 120 on both; from BELOW the picture:
   120 -> 0 on both. So docs/DEVICE-CHECKS.md v1.362.0 Regressions "scroll down then pull on the picture (the page scrolls to the
   top first)" and the R2b comment at player.js:1150-1151 ("the pull scrolls the page as today") are false on this tree; Dean's
   device pass would log the ruled cost as a v1.362.0 regression. Fix: reword both, and say in the v1.362.3 Regressions line that
   scrolled down a pull on the picture does nothing (scroll from below it). Same finding as qa 2.
2. WARNING (presence, not binding) - mutant R: delete `wireNoTapGlyphControl(window, signal);` from wireStaticControls
   (setup.js:3166): 15 player/settings suites `# tests 405 / # pass 405 / # fail 0`. The switch is wired today (real browser: a
   touch on the Settings switch stores '1', survives a reload checked), but no test holds it. Fix: the pocket-kb-search.test.js:639
   source lock, or drive the real wireStaticControls. Same finding as qa 1.
3. SUGGESTION - mutant U (the switch suppresses only outside .audio-mode): 405/405 green; the art tap path of E3 is unbound. Real
   browser today: switch ON, video taps 0 flashes, art taps 0 flashes; OFF, 1 flash each at once.
4. SUGGESTION - further survivors, all 405/405: B (noteFrameCount's ld reset), C (no noteFrameCount on an expand / visible-return
   start), D (the pause delta's ld guard), E (stopFrozenSampler not clearing frozenRunStartState), I (loadstart dropped from the
   baseline reset), Q (the run start set only when a new run starts). B, D and I are belts behind emptied/loadstart (equivalent in
   the browser); C costs at most one second. Q shows the comment at player.js:4315 ("since this run's 'playing'") is not what the
   code does: Chromium logs waiting -> playing at every seek and skip (lines :32.518/:32.520 and :34.289/:34.290 of my run), which
   moves the baseline. After an expand or a visible return the run has no start reading, so that pause carries no +f/+t.
5. SUGGESTION - stale text: player-loupe-cancel.test.js:3-8 header; tools/log-export-proof/probe.js:6-7 W1 (re-run on this tree
   it fails, the drag 1 s after a tap no longer scrolls); LESSONS 1 lowercase "read" after a full stop.
6. SUGGESTION (scope, not measured) - E1 cancels on #audio-bg-art in every FULL slot. Phone music (style.css:8349) and the reader
   bar (7417) hide the art, so they are untouched. The podcasts now-playing art in #player-slot is not hidden: a finger on it would no
   longer scroll the episode list. Audio never gets native controls, so the art cancel also applies with custom controls OFF. Say so
   in the check or the ROADMAP entry.
7. SUGGESTION (suspicion) - if iOS restarts the layer on the dock/expand reparent, a video:fcount-reset appears with no hold near
   it, and the expand writes no log line (Chromium: nothing between `minimize` and the next item). Log the expand. Measured in
   Chromium: no fcount-reset across eight 1.3 s picture-tap rounds, a seek back, a double-tap skip, a 1.5 s hold, a pull to dock, a
   docked-tap expand or a new source (ld 1 -> 2, emptied f=0). No false video:frozen. Pause +f=13 +t=1.4 per 1.4 s round. The hold
   lines carry f=.

Measured E1 in a real browser (base vs branch, identical unless noted): tap pauses/plays; double-tap +15.6 s; chain +15.8 s;
hold 2x and release 1x; hold-drag lock, then the pill unlocks; pull at the top docks; docked tap expands (touchstart not
prevented while docked); swipe right goes back; chevron tap docks, paused and in its touch peek; bar play/pause; faux full screen
reveal-first then pause, hold 2x; art inline and expanded: tap, double, hold, swipe; a focused field keeps focus as on base.
Changed: a drag up from the picture scrolls 135 px on base and 0 on the branch (the ruled cost); finding 1. Own mutants: 20 run,
12 killed (pause guard, tick note, cross-run wall x2, old rule, baseline reset, docked state, tap-pair log gate, glyph read once,
hold f=, art cancel, video cancel), 8 survived (R, U, B, C, D, E, I, Q above). Targeted on 5c7e6718: Node 22.23.1 `# tests 107 / # pass
107 / # fail 0`, Node 24.20.0 `ℹ tests 107 / ℹ pass 107 / ℹ fail 0`; eslint on the changed files exit 0; lint:ui OK; overlay 0.
DEVICE-CHECKS 37 open = ROADMAP 1-37 in order. The bug entry's log facts match section 1 and 1b. LESSONS 8 is accurate. Security:
no surface. Client only; no network, server or auth path; one device-local localStorage key compared to '1'; numeric log detail; no
innerHTML; static Settings markup.

Gate: APPROVED r2 @9d7b27f9 - qa

Delta re-confirmation of the qa r1 findings against 9d7b27f9 (`git diff 5c7e6718..9d7b27f9`):
1. Fixed as prescribed. A source lock in lifecycle-log-export.test.js checks both `init` (loadNoTapGlyphControl) and
   `wireStaticControls` (wireNoTapGlyphControl). Mutants in a /tmp sandbox of 9d7b27f9, run on the 5 changed suites: wire call
   deleted `# pass 109 # fail 1`, KILLED; init prefill deleted `# pass 108 # fail 2`, KILLED.
2. (a) Fixed: the R2b comment at player.js:1151-1152 now says a pull there neither scrolls nor minimizes. (b) Fixed: the v1.362.0
   Regressions line drops both stale steps and says why; the Safari line names the changed premise; the v1.362.3 Regressions line
   adds the scrolled-down pull. (c) Fixed: the test header describes E1.
3. Fixed: probe.js marks W1 as v1.362.2-only, with the expected readings on this tree.
4. Fixed differently, and better: the run start moved into startFrozenSampler (`frozenRunStartState = r`), so a mid-run
   waiting -> playing no longer moves it, and an expand or return run has a baseline. Bound by a new drive. Mutants: the line
   removed `# pass 108 # fail 2`, KILLED; the old per-playing set restored `# pass 109 # fail 1`, KILLED. The unbound backups
   (ld guard, ld reset, the stop clear) are disclosed in ROADMAP Bugs (c). Accepted as belts.
5. Logged in ROADMAP Bugs (b), with `fser` / `+f` named as the reader's check. Accepted.
6. Fixed: LESSONS 1 casing; the build log records 5c7e6718, its dual-Node numbers and the r1 fixes; frontmatter `next:` is current.
New in the fix: the `player:dock` / `player:expand` lines go through recordLifecycleEvent. That call is a no-op with the flag off;
bgTimingTap ignores non-bgAudio/msAction types, so the bg timing record is untouched. A mutant dropping the expand line: `# pass 109
# fail 1`, KILLED. Two non-blocking nits. The dock line is written before the `#player-dock` null return, so a shell with no dock
would log a dock that does not happen. A pause with no new run start (a 'pause' before any 'playing') reuses the last run's
baseline, as on 5c7e6718. Instruments on 9d7b27f9 (Node 22.23.1):
5 changed suites `# tests 110 / # pass 110 / # fail 0`; 13 neighbour/census suites `# tests 168 / # pass 168 / # fail 0`; lint:ui
`TOTAL 3179` / `ui-lint: OK - the live debt equals docs/ui-exceptions.json`; `overlay-containment: clean (0 violations)`; eslint
exit 0; `check-markers: 12 issue(s) found`, none in this plan (the same 12 as base). DEVICE-CHECKS 37 open; no new em dashes.
Security: unchanged, no surface (two flag-gated log lines with no detail).

Gate: APPROVED r2 @9d7b27f9 - adversary

r1 findings against 9d7b27f9:
1. Fixed as prescribed. The R2b comment (player.js:1151-1152), the v1.362.0 Regressions and Safari lines, and the v1.362.3
   Regressions line now say that, scrolled down, a pull on the picture does nothing. A grep for the old phrases ("pull scrolls the page
   as today", "page scrolls to the top first", "tap pair or a chain") over public, test and DEVICE-CHECKS finds nothing.
2. Fixed. Mutant R (the wireStaticControls line dropped) is KILLED by the new source lock, `# tests 437 / # pass 436 / # fail 1`.
   R2 (the init prefill dropped) is KILLED too, 435/437.
3. Fixed. Mutant U (the switch spares the art) is KILLED by the art-tap drive, 436/437.
4. Fixed differently, and better: the run start is recorded in startFrozenSampler. Q2 (every playing moves the baseline) and Q3 (the
   start is not recorded) are KILLED. Real browser (i1.js on 9d7b27f9): there is no longer a playing line at the mid-run seek, each
   1.4 s round's pause reads +f=13/14 +t=1.4, and there is no fcount-reset and no frozen line. B, C, D, E and I are logged in ROADMAP
   (c).
5. Fixed: the test header, the probe note and the LESSONS casing.
6. Logged in ROADMAP Bugs (a). 7: player:dock and player:expand are added. X and Y (each line dropped) are KILLED. They write nothing
   with the flag off: recordLifecycleEvent returns before writing, and bgTimingTap ignores types that are not bgAudio:/msAction:.

New, from the fix (non-blocking):
8. SUGGESTION - player:expand logs on every expand() call, not on a move from the mini player. Real browser, one dock-tap expand:
   `11.769 player:expand` and `11.787 player:expand` (the second is a no-op adopt into the same slot). A new item opened on a FULL
   watch page gives `15.272 player:expand` (the view's eager reparent). Mutant Z (log only when DOCKED) survives, 437/437. A reader can
   match a layer restart to an expand that never left the full player. Cheap fix: log in mountInSlot with `moved=` and the state it
   came from. Also, dock() writes player:dock before its `!dockEl` return.
9. SUGGESTION - the run start is now recorded only when the sampler is eligible. Pauses of an audio item lose the +t they carried at
   5c7e6718. There are no frames there anyway.

Targeted on 9d7b27f9 (Node 22.23.1), the five changed suites: `# tests 110 / # pass 110 / # fail 0`. eslint on the changed js: exit 0.
Mutants: 8 run in a /tmp archive of 9d7b27f9, 7 KILLED, 1 SURVIVED (Z); the sandbox diff is clean afterwards. Security: no change
in surface. The two new log lines carry no detail and are flag-gated.
