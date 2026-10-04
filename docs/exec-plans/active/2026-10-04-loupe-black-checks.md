---
plan: loupe-black-checks
harness: v2 · lean
branch: feat/v1.362.2-loupe-black-checks
anchor: spec
status: Approved @140f73e4
next: the builder (Sonnet) runs section 0, then W1 -> W2 -> W3 in order
design: Approved 2026-10-04 @140f73e4 (Dean's rulings D1-D4). Dean 2026-10-04, after his v1.362.1 device pass (checks 1-3 passed, the rest untested). Four asks in one branch: (1) the first ROADMAP item gathers every open device check and his VPN runbook results; (2) the iOS text loupe during a long press on the playing video; (3) the black picture RECURRED on v1.362.1, so this release builds the INSTRUMENT, not a fix; (4, mid-kickoff) logs are recorded in the background and exported with one button, and that is documented as the pattern for all log collection. Rulings D1-D4 (section 2) are Dean's, asked 2026-10-04.
gate: pending
---

# v1.362.2: one list of every open device check; no text loupe on the picture; a log that catches the black picture

Kickoff 2026-10-04 by the Architect (Opus) at main 140f73e4 (v1.362.1 shipped, PR #85). Client code only (`public/js/player.js`,
`public/js/setup.js` / `public/setup.html` for the log's note text only), docs (`ROADMAP.md`, `docs/DEVICE-CHECKS.md`), tests. No
server, no storage schema, no new dependency, no shell edit except `public/setup.html`'s Troubleshooting rows (the Settings page; run the shell-parity and setup tests after), no CSS paint over the picture.

## 1. The outcome (what Dean will see)

A. **One list.** The first entry under ROADMAP.md Planned is a numbered, one-line-per-check list of EVERY open device check (from
   `docs/DEVICE-CHECKS.md`) plus the VPN runbook results, so Dean can reply "1-5 pass, 9 fails". v1.362.1 checks 1-3 show as passed
   (2026-10-04) and are deleted from DEVICE-CHECKS.md (its own rule: a confirmed line is deleted).
B. **No loupe.** On the iPhone, pressing and holding the playing picture for 2x (including the hold that follows a tap, and the
   hold-drag lock) never brings up the grey magnifier capsule. Every gesture works as before; the one accepted cost (D1): a page
   scroll that STARTS on the picture within 0.35 s of a tap on the picture does not scroll.
C. **The black picture gets caught.** With Settings > Troubleshooting > "Show lifecycle debug log" on, the log now records the moment
   the picture stops getting frames while the clock runs (`video:frozen`), where each play came from (a picture tap, the bar
   button, the lock screen...), every speed change and hold, and the loupe-gesture cancels. It keeps far more lines, with times to
   the millisecond. **Record, live, export (D6):** Dean switches it on in Settings > Troubleshooting, goes and uses the app (it
   records in the background, across reloads and app restarts, with NOTHING on screen unless he also turns on "Show the log on
   screen"), then comes back to Settings > Troubleshooting and presses **Export log**: the iPhone share sheet opens with a `.txt`
   file (save to Files, AirDrop, Messages, Mail); where file sharing is missing it copies the text, and failing that it downloads
   the file. A separate **Clear log** button asks first. Nothing is fixed for the black picture in this release: the next
   occurrence's exported log names the cause.
D. **The pattern is the house rule.** docs/references/log-collection-pattern.md (written in W3) states it (record in the background behind a
   Settings switch; export everything with one button; share sheet file, then clipboard, then download; clear asks first; nothing
   on screen by default) and the one shared helper that implements the export; LESSONS section 3 points at it. Existing logs (the
   rotate log) are NOT migrated now (Dean: "not to say we have to go reinvent anything right now"); ROADMAP Planned logs it.

## 0. Step 0 - read, set up, and the stop rules

0.1 Read `AGENTS.md`, then `docs/LESSONS.md` sections **0, 1, 2, 4, 6, 7, 8** (section 4's "per-move preventDefault" and "GLOBAL
non-passive touch listener" classes and section 7's last class matter most) and `docs/LESSONS-rules.md` sections 4 and 7. Then
the v1.362.1 plan `docs/exec-plans/completed/2026-10-04-chevron-peek-and-vpn-runbook.md` sections 2 and 4, and the v1.361 plan
`docs/exec-plans/completed/2026-10-03-tap-glyph-filter.md` (the black picture's history). Read this plan fully before editing.

0.2 Environment, every shell: `export PATH="$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH"`. Dual-Node for
the full suite: 22.23.1 and 24.20.0 (Node 24 prints `ℹ`, not `#`; an empty grep is not green).

0.3 Worktree: `git worktree add .claude/worktrees/v13622 feat/v1.362.2-loupe-black-checks` (the branch exists and carries this
plan), then `ln -s ../../../node_modules .claude/worktrees/v13622/node_modules` (untracked, never staged; `rm` it before the
worktree is removed). `git merge --ff-only main` first if main moved.

0.4 Git: stage files BY NAME; `git commit -F <file>` (message via a QUOTED heredoc, `<<'EOF'`); never `--no-verify`, never
force-push, never pipe a commit or push; verify with `git log`. The pre-commit hook runs lint + the unit suite (~3-5 min): run
commits in the background and wait. Red tests cannot be committed alone: commit a wave's tests with the code that greens them and
record the failing-first run verbatim in section 6. Push only in the release step. Commit trailers: the ones your session's system
reminder gives you.

0.5 Tests while building: the targeted files each wave names. The full dual-Node `npm test` once after W3, again only if a gate
round changes code, never while a gate seat is running.

0.6 Report every failure verbatim with counts. "Verified" means you ran it and saw it. Mutants only on COMMITTED work, in a
`git archive <sha>` sandbox under the scratchpad or /tmp (symlink `node_modules`), exact-once replace, restored in a `finally`,
sandbox diffed against a pristine copy after; kill anything you start BY PID (never `pkill -f`). Record every mutant in section 6.

0.7 No em dashes anywhere. `npm run lint:ui` passes with `docs/ui-exceptions.json` UNCHANGED or smaller (the ratchet refuses
growth). `node scripts/overlay-containment-lint.js --enforce` stays 0. `test/unit/player-overlay-no-filter.test.js` stays green
(nothing with filter / mask / backdrop / blend / opacity fade joins the player). A comment, test title or doc your change inverts
is a finding: grep `tap to clear`, `Tap to clear`, `Tap the overlay to clear it`, `LIFECYCLE_LOG_CAP`, `passive: true` near the
picture's touchstart, and "60-character cut".

0.8 **Stop rules.** Stop and report (never guess) if: (a) a seam in section 4 does not exist or behaves differently and the fix is
not a like-for-like rename; (b) the loupe cancel would need a `preventDefault` on ANY touchstart other than the one D1 defines, or
a document/window-level non-passive touch listener; (c) any change alters a gesture outside D1's stated cost (tap pauses/plays,
double-tap skips, hold 2x, hold-drag locks, the lock pill, swipe right goes back, the pull minimizes, an upward drag from the
picture scrolls when NOT within 0.35 s of a tap), measured, not argued; (d) the instrument would change playback (no `play()`,
`pause()`, `currentTime`, `playbackRate`, `load()` or `src` write in any instrument code; reads only) or run when the flag is off;
(e) a ROADMAP or DEVICE-CHECKS line would name a check, setting or label you have not read in the tree (copy, never invent); (f)
scope grows: ROADMAP.md Planned. A stop rule is never satisfied by narrowing a test.

## 2. Rulings

| # | Question | Ruling |
|---|---|---|
| D1 | The loupe fix (**Dean**, 2026-10-04, took the recommendation "Narrow cancel") | A NEW, separate `touchstart` listener `{ passive: false }` on the same surfaces as `wireSkipHoldGestures` (`#media-player`, `#audio-bg-art`), registered AFTER the existing passive one (LESSONS 4: the passive tracker registers first). It calls `e.preventDefault()` iff the pure `tapPairCancelDecision({now, lastTapTime, skipChainUntil, touches, nativeFs, nativeControls, state})` returns true: one finger, not native full screen, not native-controls mode, state FULL (same guards as the existing handler and `shouldArtSingleTapAct`), AND (`lastTapTime > 0 && now - lastTapTime < DOUBLE_TAP_MS` OR `now < skipChainUntil`). That is exactly the touch the app already classifies as a double-tap's second tap or a skip-chain tap (player.js ~7281 `inTapRun` is the same predicate; reuse it or share one function, never a second copy of the window). Nothing else in the existing handlers changes. Accepted cost: a scroll started on the picture inside that window does not scroll. |
| D2 | The black picture (**Dean**, "Log + zero-build test") | This release builds the instrument (W2) and fixes nothing. Dean runs the zero-build A/B in section 7b on v1.362.1 or v1.362.2 meanwhile. |
| D3 | The ROADMAP list (**Dean**, "Short checklist") | One ROADMAP Planned entry, FIRST under `## Planned` (above `### Bugs`, its own `### Device checks owed` heading, or as the first Bugs item if the census tests require it: check `test/unit/*roadmap*`), numbered lines `N. vX.Y.Z - <a few words>` that point at DEVICE-CHECKS.md for the steps; the full text stays ONLY in DEVICE-CHECKS.md. |
| D4 | Dean's "taps alone went black" (**Dean**: does not remember whether double-taps or holds were in that session) | So H2 (section 3) is NOT ruled out; the instrument's `gesture:tap-pair` and `hold:*` lines decide it. |
| D5 | Instrument shape (**Architect**) | Section 5 W2. Reads only. Off = byte-identical behaviour and zero timers. |
| D6 | Log collection (**Dean**, 2026-10-04: "a debug log that allowed me to export everything with like a button press... you enable it in settings you go out you live you do your thing it's recording... at the end I go back and press like export or copy and it puts it on the clipboard or puts it into a file... copy pasting on mobile is really annoying"; "we should document that pattern and use that for anything where we have to do any kind of log collection") | Record in the background (localStorage, survives reloads and kills); export from Settings with ONE button; one shared helper `exportDiagnosticLog({ filename, text, title })` in common.js: build a `File` (text/plain) SYNCHRONOUSLY inside the click from data already in memory/localStorage (no fetch before the share: iOS drops the user activation), `navigator.canShare({files})` -> `navigator.share({files})` ('shared'; a dismissed sheet is not an error, the `shareMediaFile` rule), else `copyTextToClipboard` ('copied'), else a Blob `a[download]` ('downloaded'); a toast for copied/downloaded/failed. The on-screen overlay becomes opt-in (a second switch, default off), since a 35vh panel over the app while "living" is in the way (**Architect**; Dean may overrule). Documented as the pattern (outcome D). |

## 3. The black picture: what is measured, the hypotheses, and what falsifies each

Measured (Architect, 2026-10-04, `~/.local/bin/ffmpeg-static/ffmpeg` on Dean's 4.04 s recording, 56.36 fps, 1180x2556;
`~/.claude/projects/-home-coder-projects-filetube/analysis/2026-10-04-recording/`):
- The picture region is digital black every frame; the clock runs 39:02 -> 39:08 at 2x; captions advance.
- The chevron box (crop 90x90 at 25,420, YMAX per frame) is lit every frame EXCEPT 2.368-2.502 s. Under v1.362.1's rule that is a
  3 s touch peek ending (a touch at about -0.63 s) and a new touch at about 2.52 s. **The kickoff lead "the chevron stayed shown past
  its window" is FALSIFIED**: the chevron hid on time, so at 2.37 s `activeMediaElement().paused` was FALSE. The element reported
  playing while black: the element runs, the picture layer does not paint. (Agrees with v1.361's facts: the layer's frame count
  froze, a far seek did not revive it, a new src did.)
- The loupe box (crop 420x330 at 700,300) is up 0.23-1.50 s and from 3.45 s: about 0.86 s and 0.93 s after each inferred touch,
  later than a plain long press's loupe and the app's 500 ms `HOLD_MS`, which fits a tap followed by a hold (D1's gesture).
- Not measured: what started the black (the clip begins black).

Code facts (Explore pass, 2026-10-04; verify): the clock (`updateSeekVisual` via `currentAbsTime()`, rAF loop only while
`!mediaPlayer.paused`) and captions (`mediaPlayer` `timeupdate`) are driven by the `<video>`, so the sound is not a sidecar here
(the sidecar is only active between a hide and the swap-back). A picture tap's play/pause runs from `scheduleArtSingleTap`, a
`setTimeout(DOUBLE_TAP_MS = 350)` AFTER the touchend, i.e. outside the user gesture; the bar's button calls `togglePlayPause()`
inside its click.

| H | Hypothesis | Predicts in the new log | Falsified by |
|---|---|---|---|
| H1 | A `play()` issued outside the gesture (the picture tap's 350 ms timer) resumes the sound but not the iOS 27 video layer. Fits the v1.361 asymmetry exactly: bar-button pause/play never went black, picture taps did. | `media:play via=picture-tap` within a few seconds before `video:frozen`. | `video:frozen` after a `via=bar-button` play, or with no play before it; or section 7b: black after a bar-button RESUME. |
| H2 | The iOS text interaction (the loupe, a system overlay that magnifies the playing layer) breaks the layer. | `gesture:tap-pair` / `hold:engage` just before `video:frozen`. | Black in a session with no hold and no double-tap (Dean does not remember, D4); or black recurring after D1 removes the loupe (confounded with H1 if both vanish: disclose). |
| H3 | An iOS 27 pipeline fault independent of input. | `video:frozen` with no user event before it. | Any reliable input correlation above. |

No fix for any H ships in this release (D2). If 7b or the log confirms H1, the fix candidate is a picture tap that plays inside the
touch itself (a product ruling: it changes the double-tap-while-paused behaviour).

## 4. Seams (main 140f73e4; line numbers approximate, verify)

- `wireSkipHoldGestures(el, onSingleTap)` player.js ~5288; its `touchstart` ~5309-5326 (`{ passive: true }`: leave it passive and
  unchanged); `touchend` ~5340-5425 (`lastTapTime = now` on a lone tap ~5399, `skipChainUntil` ~5395); `inTapRun` ~7281.
  `DOUBLE_TAP_MS = 350` ~4882, `HOLD_MS = 500` ~4857. `shouldArtSingleTapAct`, `scheduleArtSingleTap` ~5259.
- `engageHold` ~4929, `releaseHold` ~4939, `lockHold` ~4913, `dropHold` ~4920; `ratechange` listener ~7196.
- `togglePlayPause` ~6294 (callers: grep every one, incl. the bar's play button, keyboard, mediaSession `msAction:play`, the
  picture's single tap via `videoSingleTapOrReveal`, the art toggle `toggleArtPlayPause`).
- Lifecycle log: `LIFECYCLE_LOG_CAP = 30` ~4068, `recordLifecycleEvent` ~4096-4136, `readVideoState` ~4172-4200 (format ~839-865),
  the `video:check` window ~4209-4233, `media:play` records ~7061 (`el=video`) and ~7125 (`el=bgAudio`), video events ~7064-7066,
  the overlay `ensureLifecycleOverlayEl` ~4663 (tap clears today) and `renderLifecycleOverlay` ~4690 (60-char cut, 400 for `video:`).
  Settings switch `#debug-lifecycle-check` setup.html ~804, note ~807 ("Tap the overlay to clear it."), setup.js ~3019.
- Export helpers to reuse: common.js `copyTextToClipboard` ~14698, `shareMediaFile` ~14733 (its File + `canShare` + dismissal
  rule), `shareTextContent` ~14685. The rotate log (common.js ~509-519) copies on a panel tap: leave it as is (D6, migration logged).
- Settings > Troubleshooting: setup.html ~800 (`<summary>Troubleshooting</summary>`), the switch rows ~804-805.
- Tests to extend: `test/unit/setup-debug-lifecycle-toggle.test.js`, `test/unit/player-lifecycle-release.test.js`, the gesture
  tests (grep `wireSkipHoldGestures`, `DOUBLE_TAP_MS`, `skipChainUntil` under `test/`), `test/unit/interaction-policy-css.test.js`
  (must stay green; D1 is JS, no policy property changes).

## 5. Waves

**W1 - the loupe cancel (D1).** Export `tapPairCancelDecision` top-level (decision vs use, LESSONS 2). Add the second listener in
`wireSkipHoldGestures`. Log `gesture:tap-pair` through the lifecycle recorder when it cancels (a no-op when the flag is off).
Tests: the decision branch by branch, each conjunct flipped ALONE (one finger, nativeFs, nativeControls, state, the two windows at
their edges: `now - lastTapTime` = 349 true / 350 false, `skipChainUntil` boundary); a jsdom drive through the REAL
`wireSkipHoldGestures` (a lone tap's touchstart+touchend, then a second touchstart at +200 ms: `defaultPrevented` true; at +400 ms:
false; a first touch: false; two fingers: false) proving the listener is registered `{passive:false}` and AFTER the passive one;
the existing double-tap skip, hold, lock and tap-pause tests stay green unchanged. Mutants: drop the listener; make it passive;
widen/narrow the window by one; drop each conjunct.

**W2 - the instrument (D2, D5).** All behind `isDebugLifecycleEnabled()`; with the flag off nothing below runs and no timer exists.
1. `video:frozen` / `video:thawed`: while the flag is on, the document visible, `activeMediaElement() === mediaPlayer`, video (not
   audio-mode) and `!mediaPlayer.paused`, sample once a second `{wall, t: currentTime, f: totalVideoFrames}` (the
   `getVideoPlaybackQuality` read `readVideoState` already uses). The pure `frozenPictureDecision(samples)` (exported) is frozen
   when, across samples spanning at least 3 s of wall time, `f` did not change while `t` advanced at least 2 s (iOS relays the frame
   count as a ~2 s cached copy, LESSONS 1: a series, never one reading). Log `video:frozen` ONCE at onset with the `readVideoState`
   detail plus the last 6 `f` values (`fser=`), and `video:thawed` when `f` moves again. Sampler starts on `playing`, stops on
   `pause`, `ended`, `emptied`, hide, load, dock/close (`resetTransientPlaybackUi`), and when the flag goes off; one timer at most
   (bind unbind-balance, LESSONS 4).
2. `media:play` detail gains `via=<source>` and `g=<ms since the last touchend/click on the player>`: `togglePlayPause(via)` records
   `{via, at}`; the `play` event logger reads it if it is under 1500 ms old, else `via=other`. Sources: `picture-tap`, `art-tap`,
   `bar-button`, `keyboard`, `media-session`, `autostart`, `swapback`, `other`. Same `via` on `media:pause`.
3. `media:rate` on `ratechange` (`rate=`, `def=`); `hold:engage`, `hold:release`, `hold:lock`, `hold:drop`.
4. Storage and the overlay: `LIFECYCLE_LOG_CAP` 30 -> 1000 (measure the stored bytes at the cap with the longest real line and
   record it in section 6; stay under 1 MB, else lower the cap and say so); every entry keeps its wall `t` and the export prints it
   as ISO time to the millisecond. The on-screen overlay is OPT-IN (D6): a second switch "Show the log on screen" (default off,
   its own localStorage key, read the same way as the first); when shown, its 400-char cut extends to `media:`, `hold:` and
   `gesture:` lines and a plain tap on it NO LONGER CLEARS (header `[export from Settings]`).
5. Export (D6): `exportDiagnosticLog({ filename, text, title })` in common.js (exported for tests; pure strategy fn
   `chooseLogExportStrategy({ canShareFiles, hasClipboard })` -> 'file' | 'copy' | 'download'), reusing `copyTextToClipboard` and
   the `shareMediaFile` dismissal rule; the File is built synchronously in the click. Settings > Troubleshooting gets, under the
   lifecycle switch, an **Export log** button (`ft-lifecycle-<yyyymmdd-hhmmss>.txt`: a header with app version, user agent,
   standalone or tab, entry count, then one line per entry oldest first: ISO time, type, detail in FULL, persisted, vis, playing)
   and a **Clear log** button that asks first through the app's standard confirm (LESSONS 6 last class). Both work with the
   switch off too (the log survives the switch). The export reads `localStorage['ft-lifecycle-log']` through ONE formatter
   `formatLifecycleLogForExport(entries, meta)` (exported, pure). Toast the outcome. Update the Settings note (setup.html ~807).
   Plain paint only; the buttons use the existing Settings row/button classes (lint:ui ratchet, no new literals).
Tests: `frozenPictureDecision` with a cached-count series (f constant 2 s then jumping: NOT frozen), a true freeze (f constant 4 s,
t +4: frozen), paused/t-flat (not frozen); the sampler's start/stop on every listed boundary with fake timers, and ZERO timers with
the flag off; `via` per caller (each caller mutated to the wrong `via` goes red by name); `chooseLogExportStrategy` per arm;
`exportDiagnosticLog` with stubbed `navigator.canShare/share` (file path: `share` called with one File named as specified, called
synchronously in the click turn: no await before it), clipboard-only, neither (download anchor); the formatter (full details, no
cut, oldest first, header fields); Clear asks and only clears on OK; the overlay absent by default with the log switch on, present
with both; a plain overlay tap no longer clears; the cap. Prove reachability in a real browser once (Playwright): flag on, play a
fixture video, go to Settings, press Export with `navigator.share` absent, read the clipboard (or the download) and see
`media:play` with `via=bar-button` and a `media:rate` line.

**W3 - docs (D3).** In this order: (1) DEVICE-CHECKS.md: delete v1.362.1 checks 1-3 (lines "Phone: pause a video, the chevron
shows...", "Is 3 s right?...", "A video playing, the chevron hidden: double-tap...") and append the section 7 checks of this
release; (2) ROADMAP.md: the first Planned entry per D3, numbered over EVERY open line in DEVICE-CHECKS.md after step 1 (count them
with `grep -c '^- \[ \]'` and copy the number into the entry; v1.362.1's three passed lines listed as `[x] passed 2026-10-04`), plus
a final item "VPN runbook: send the run ids and the section 7 results table (docs/references/vpn-slowness-runbook.md)"; the
entry closes when every line is resolved; (3) the ROADMAP black-picture bug entry: replace "Close when the v1.361 device check
passes..." with the v1.362.1 recurrence (section 3's measured facts, the falsified chevron lead, H1-H3) and "awaiting the log of the
next occurrence + the 7b A/B"; (4) LESSONS.md section 7's last class: strike count and a sentence that the v1.361 glyph diagnosis
failed on device (v1.362.1 recurrence) and that a chevron's absence is a free `paused` reading (a UI rule is an instrument); section
8: the WebKit loupe fact (D1's gesture bypasses `user-select:none`; WebKit bug 296492; only a touchstart `preventDefault` stops it).
(5) docs/references/log-collection-pattern.md (new, D6): the rule in Dean's words (quote D6), the shape (a Settings switch
records in the background; one Export button; share sheet file -> clipboard -> download; Clear asks first; nothing on screen by
default; a header with version, user agent, standalone/tab; full details, never cut; the File built inside the click), the helper
`exportDiagnosticLog` and how a new log adopts it, and the logs that do NOT follow it yet (the rotate log's panel tap-to-copy, any
other you find by grepping `clipboard.writeText` and `ft-*-log`): list them, do not migrate. LESSONS.md section 3 gets one Class
line pointing at it ("A diagnostic log is recorded in the background and EXPORTED with one button, never copied from an on-screen
panel"; Guard: the pattern doc + `exportDiagnosticLog`); ROADMAP Planned > Chores gets "Move the rotate log (and any other) to the
log-collection pattern".

## 6. Build log (the builder fills this in: failing-first runs, the real-browser reachability run, mutants per wave, suites verbatim, deviations)

## 7. Device checks (Dean, on the released build; add each to DEVICE-CHECKS.md in the release commit)

7a. The loupe (custom player controls ON):
- [ ] v1.362.2 - iPhone, a video playing inline: tap the picture once and, at once, press and hold: 2x, NO grey magnifier. Hold
  without tapping first: 2x, no magnifier. Hold-drag down: locks, no magnifier. Same in full screen and on an audio file's art.
- [ ] v1.362.2 - Regressions: tap pauses, double-tap skips, triple-tap chains skip, hold 2x, lock pill, pull down minimizes, swipe
  right goes back, scroll the page with a finger that starts on the picture (wait a second after any tap first).

7b. The black picture A/B (zero-build; runs on v1.362.1 or v1.362.2; lifecycle log ON in Settings > Troubleshooting, reload):
- [ ] v1.362.2 - Twenty cycles of: pause with a PICTURE tap, resume with the BAR's play button. Then twenty of: pause with the BAR,
  resume with a PICTURE tap. No holds, no double-taps. Say which run went black (if any). On v1.362.2, if it goes black at any point:
  Settings > Troubleshooting > Export log, and send the file with what you had just done (v1.362.1 has no export: just say which run).
- [ ] v1.362.2 - Whenever it goes black in normal use: Settings > Troubleshooting > Export log and send the file with a word on the last few things you did.

7c. The instrument:
- [ ] v1.362.2 - Settings > Troubleshooting: lifecycle log ON (nothing appears on screen), use the app for a while (play, pause,
  hold, close and reopen the app), come back to Settings, press Export log: the share sheet offers a .txt file; save it to Files and
  open it: one line per event with times. Send one to Claude. Clear log asks first.

## 8. Gate brief (attack surfaces)

Seats: adversary (floor) + qa; security-brief applied as a section by both (no auth, secret, network or dependency surface).
- D1's cancel: the exact window (shared with `inTapRun`, never a copy); passive-first order; no other touchstart cancels; every
  gesture in stop rule (c) measured in a real browser touch emulation where it can be (a scroll from the picture 1 s after a tap
  still scrolls; inside 0.35 s it does not, by design); the docked state (`shouldArtSingleTapAct` gate: a docked tap must still
  synthesize the click that expands); audio art; the native-controls and native-fullscreen bails.
- The instrument: reads only (grep every new line for writes to media state); flag-off = no timers and no listeners added beyond
  today's; sampler unbind-balance on every boundary; the frozen decision against the ~2 s cached count (no false `video:frozen` on a
  healthy iPhone stream: argue from the decision's thresholds and a fixture series); the copy path on iOS (`clipboard.writeText`
  inside the click); the cap's localStorage size (150 entries at up to ~600 bytes).
- The export (D6): the File is built and `navigator.share` called in the SAME click turn (no await, no fetch before it: iOS
  drops the activation); a dismissed sheet is not an error; the fallbacks really run (clipboard, then download); the export
  contains every entry with its full detail (no cut); Clear never fires without the confirm's OK; the overlay is off by default and
  a plain tap on it no longer clears; the log is private data (titles via ids, user agent): it leaves the phone only by Dean's
  share, never by a network call (security section).
- Docs: every ROADMAP list line maps to exactly one DEVICE-CHECKS line (count both); nothing invented.
- The pattern doc: every claim about an existing log checked against the tree.
- LESSONS 0: presence-not-binding, lying comment (the Settings note, `[tap to clear]`), inert feature (the real `wireSkipHoldGestures`).

## 8b. Release (v1.362.2)

`docs/RELEASING.md` + AGENTS.md: `npm version 1.362.2 --no-git-tag-version`; ROADMAP Shipped entry; `docs/releases.json` user-language
ledger (no process words); `node scripts/plan-complete.js docs/exec-plans/active/2026-10-04-loupe-black-checks.md "Shipped v1.362.2" --apply`;
the protected-main PR flow (local `merge --no-ff`, tag, ONE push of the release branch + tag with the ServerAlive `GIT_SSH_COMMAND`,
`gh pr create`, CI green, `gh pr merge --merge` on Dean's word if the classifier refuses, `git pull --ff-only`); delete branches.

## 8c. Gate record

## 9. Out of scope (logged, not built)

- Any fix for the black picture (D2), including "a picture tap plays inside the touch" (H1's candidate, a ruling for after the log).
- The plain-long-press loupe, if 7a shows it still appears without a preceding tap (then it is an iOS 27 change: a WebKit report
  and a new ruling).
- The v1.362 gate r1/r2 and v1.361 r3 suggestions already in ROADMAP Planned > Bugs.
- Migrating the rotate log (or any other) to the export pattern (D6: documented now, migrated later; ROADMAP Chores).
