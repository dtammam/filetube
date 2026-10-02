---
plan: turn-speaker-highlight
harness: v2 · lean
branch: feat/v1.357-turn-speaker-highlight
anchor: spec
status: Draft
next: UNBLOCKED (v1.356.0 shipped 2026-10-02; branch rebased onto main 01e56dee); Step 0, then W0, W1, W2, W3; read the whole plan first, every section
design: Dean 2026-10-02 - both items in ONE branch and ONE release v1.357.0, built by Sonnet; (1) the Pocket turn back upright, from his on-device rotate log; (2) "when I am listening to a song with a speaker selected and go back to see the album I picked from, the playing song isn't highlighted"; R1-R6 are architect defaults
gate: adversary + qa (UI/layout on the device's hardest path, and the remote mirror); security-brief applied as a section by both
---

# v1.357: the turn back upright lands in one step, and the speaker's song is highlighted in the iPod lists

Written 2026-10-02 by the Opus Architect at main d6abd4e3 (v1.355.0); rebased onto main 01e56dee (v1.356.0, shipped) and the
seams re-read there (names unchanged; `effectiveCurrentId` ~1807 still reads the phone's own player).

## 1. The outcome (what Dean will do on device)

1. Pocket on an iPod skin in the home-screen app, turn to landscape and back upright: the skin lands in place in ONE step.
   There is no frame with a giant LCD, no ~200 ms with the skin 59 px low, and no flash under the status bar.
2. Phone playing on a speaker (Play on... > the PC), pick a song from an album, then MENU back to that album's list: the
   song the speaker is playing has the playing mark, exactly as it does when the phone plays locally. The mark moves when
   the speaker moves to the next song.

## 0. Step 0 - read, set up, and the stop rules

0.1 Read `AGENTS.md`, then `docs/LESSONS.md` sections **0, 1, 2, 3, 4, 6, 8, 12, 13** (section 1's diagnosis discipline is
this plan's spine), then `docs/exec-plans/completed/2026-10-02-pocket-music.md` section 3 (the turn as measured from Dean's
recording, hypotheses (a) and (b)) and `docs/exec-plans/completed/2026-10-01-mobile-polish.md` W6 (v1.350's turn-back work).
Read this plan fully before editing. Order of work: W0, W1, W2, W3.

0.2 Environment, every shell: `export PATH="$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH"`.
Dual-Node for the final suite: 22.23.1 and 24.20.0 (Node 24 prints `ℹ`, not `#`; an empty grep is not green).

0.3 Worktree: `.claude/worktrees/v1357` on branch `feat/v1.357-turn-speaker-highlight` (it exists and carries this plan).
First: `git rebase main` (v1.356.0 is already on main; the branch was rebased at 01e56dee, so this is a no-op unless main moved). In the worktree:
`ln -s /home/coder/projects/filetube/node_modules node_modules` before any commit, `rm node_modules` after, never stage it.

0.4 Git: stage files BY NAME; `git commit -F <file>` (message via a QUOTED heredoc, `<<'EOF'`); never `--no-verify`, never
force-push, never pipe a commit or push; verify with `git log`. The pre-commit hook runs the unit suite (~3-5 min): run
commits in the background and wait. Push only in the release step (section 5, Gate and release).

0.5 Tests while building: the targeted files each wave names. Full dual-Node `npm test` once after W2, again only if a gate
round changes code, never while a gate seat is running.

0.6 Report every failure verbatim with counts. "Verified" means you ran it and saw it. Mutants only on COMMITTED work, in a
/tmp `git archive <sha>` sandbox with `node --test --test-timeout=20000 <file>`, an exact-once replace, restored in a
`finally`, the sandbox diffed against a pristine copy after; kill anything you start BY PID (never `pkill -f`). Record every
mutant in section 6.

0.7 No em dashes anywhere. UI through tokens; `npm run lint:ui` must not grow; `node scripts/overlay-containment-lint.js
--enforce` stays 0. A comment, test title or doc your change inverts is a finding: grep for it.

0.8 **Stop rules.** Stop and report (never guess) if: (a) a seam in section 4 does not exist or behaves differently and the fix
is not a like-for-like rename; (b) W0.1's replay shows NO rule that is right on every captured row AND on every steady state
in W0.2's matrix (then the turn ships the instrument only, R3); (c) W0.3's falsifier does NOT show the highlight missing in a
real browser (then the cause is elsewhere: report what you measured); (d) any change would alter the top spacing of a STEADY
screen (any view, either orientation, Safari tab or home-screen app); (e) a new npm dependency; (f) scope grows: log extras in
ROADMAP.md Planned.

## 2. Rulings and defaults

| # | Question | Ruling |
|---|---|---|
| R1 | One release? | **Yes (Dean, 2026-10-02): both items, one branch, v1.357.0, built by Sonnet.** |
| R2 | The turn: what to fix | Only what Dean's capture (section 3) MEASURED: the stale top inset during the turn (phase "low"), and the giant LCD (phase "giant") only if W0.2 finds its cause in the code; the one-frame scroll ("scrolled") is left to the existing keeper unless the inset fix removes it. Architect default. |
| R3 | The turn: if no safe rule exists | Ship the instrument additions (W1.1) and NO behaviour change for that phase; record it in ROADMAP Planned with the numbers. LESSONS 1: an instrument, never a theory-fix. Architect default. |
| R4 | The turn: scope of the change | Pocket (the `.mms-full` skins) only, and only while a turn is in flight (from the first landscape/portrait flip to the settling `resize`, bounded at 1 s). Steady layouts keep `env(safe-area-inset-top)` exactly as today. Architect default. |
| R5 | The highlight: which id | While the phone controls a speaker, the iPod lists mark the SPEAKER's track (the id the speaker reports, chapter ids included), never the phone's own idle player. Local play is unchanged. Architect default. |
| R6 | The highlight: where | Every pocket list that marks the current song today (album, artist, playlist, Songs, Liked, search results), and the "open on the playing row" behaviour (`pane.playing` / `followCurrent`) follows the same id. Architect default. |

## 3. Research: Dean's on-device capture (2026-10-02, home-screen app, iPhone 393x852, `?debugRotate` log via the v1.355 switch)

The key rows are committed as `test/fixtures/rotate-capture-2026-10-02.jsonl` (one row per phase; the full paste is in the
Architect's session). Read them; the numbers below are copied from them.

| Phase | Time | Rows say | On screen |
|---|---|---|---|
| landscape-steady | before | iw 852, ih 393, sat 0px, lcd [79,39,392,294] | correct |
| giant | ~60 ms from 173203 (mq-change run, t 2 and 64) | iw 393, **ih 852**, sat 59px, land false, lcd **[20,75,812,609]** | the LCD laid out ~2.3x too big: 812 = 852 - 2*20, as if the WIDTH were still 852 while innerWidth already says 393 |
| low | ~200 ms, 173293 to 173494 (vv-resize, orientationchange and so-change runs) | iw 393, **ih 793**, **sat 59px**, lcd [20,**75**,353,265] | the right size but 59 px low: the app's area already excludes the status bar (793 = 852 - 59) but the top inset still reads 59, so the 59 is counted twice |
| scrolled | 1 frame at 173497 (resize run, t 3) | sat 0px, **sy 59**, **vvo [0,59]**, lcd [20,**-43**,353,265] | 59 px too high, under the status bar: iOS turned the dropped inset into scroll |
| portrait-settled | from 173517 (resize run, t 23) | iw 393, ih 793, sat 0px, sy 0, lcd [20,16,353,265] | correct |

What this establishes (LESSONS 1: a discriminating measurement taken ON the device):
- Hypothesis (b) of the v1.354 plan ("the inset counted twice for a few frames") is **CONFIRMED** for the "low" phase. The
  stale value is `env(safe-area-inset-top)`; it corrects only at the window `resize` event, 36 ms after `orientationchange`.
- The arithmetic that is right on EVERY captured portrait row: `effectiveTop = max(0, sat - (screen.height - innerHeight))`
  gives 59 - (852 - 852) = 59 in "giant" (the app still spans the status bar), 59 - (852 - 793) = 0 in "low", and 0 settled.
  This is a CANDIDATE, not a ruling: it has NOT been checked in a Safari tab (toolbars make `screen.height - innerHeight`
  large while the inset may be real) or in landscape. W0.1/W0.2 decide.
- The "giant" frame's cause is NOT in the capture: the rows do not say which declaration sized the LCD at 812. W0.2 finds the
  LCD's sizing chain; W1.1 adds the probe fields that would show it on the next capture (CSS `100vw` / `100dvh` read through a
  probe element, next to `innerWidth`/`innerHeight`).
- Headless Chromium cannot reproduce any of these phases (the v1.354 harness never painted them). The device is the judge:
  Dean records the turn again with the log on after the release.

## 4. The seams (read at d6abd4e3; line numbers drift, names do not)

- The turn: the Pocket portrait top padding `calc(env(safe-area-inset-top,0px) + var(--space-8))` on the skins' content rows
  (`public/css/style.css` ~8360 `.mms-apple .mms-z`, ~8383, ~8497; find every `.mms-full`-scoped `safe-area-inset-top` use, there
  are 19 in the file and most are NOT the Pocket); the landscape layout `--pkl-h` / `--pkl-*` (~10655-10690). The rotation stamp
  `public/js/pocket-lighting.js` `stampRotation` (~102) and its listeners (~591); the rotate log `public/js/common.js`
  `rotateSample` / `installRotateDebug` (~405-560, v1.355 added `sy`, `vvo`, `vs`, `ae`); the rotation scroll keeper
  `public/js/player.js` (~2603, the window capture listener that ends the rotation scroll-snap window; LESSONS 8: scroll offset
  survives rotation in raw px). Tests: `test/unit/pocket-phone-scope.test.js` (the rotate log and the turn locks), the headless
  rotation harness `test/visual/capture.js` `rotation()`.
- The highlight: `public/js/music.js` `effectiveCurrentId()` (~1807: reads `window.FileTube.player.currentId`, the PHONE's
  player; the likely root cause, to be CONFIRMED by W0.3), the pocket `menu:` cfg `currentId: effectiveCurrentId` (~1720),
  `remoteOn()` (~1468), `RC.state()` (the speaker's report: `state.track.id`), the mirror's repaint `RC.onChange` / `sigOf`
  (~2933). Engine: `public/js/skin-surface.js` `currentId()` (~594), `listModel` (`currentId: currentId()`), `followCurrent` and
  `pane.playing` (~738, ~1392, ~1516). Render: `public/js/music-skins.js` `renderMenuList` (`is-current`, the `ipm-now` glyph,
  ~1114). Proof harness: `tools/listen-control-proof/speaker-proof.js` / `queue-proof.js` (two contexts as one user, a speaker PC
  and a phone).

## 5. Waves (one branch, one gate, one release: v1.357.0)

### W0 - Falsifiers (before editing product code; record every number in section 6)
1. **Replay the capture.** Write a pure function `pocketTopInset({ sat, screenH, screenW, innerH, innerW, land })` (px numbers in,
   px out) and a unit test that feeds it EVERY row of `test/fixtures/rotate-capture-2026-10-02.jsonl` (screen 393x852) and
   asserts the inset that puts the LCD where the settled row has it (portrait: LCD top 16 means inset 0 once the app area
   excludes the status bar; "giant" rows keep 59). Then the steady-state matrix, from MEASURED values, not assumptions: a Safari
   tab portrait and landscape (toolbars shown and collapsed) and the home-screen app portrait and landscape. For the Safari values
   you cannot measure on the box, use the known iPhone 15-class numbers only if you can cite them from a primary source in the
   plan; otherwise mark the row "device-only" and make the rule IDENTITY there (R4: no change outside a turn). A rule that is wrong
   on any measured steady row is stop rule (b).
2. **The giant LCD's sizing chain.** In the code, trace what sets the Pocket LCD's width in portrait on an iPod skin (every
   declaration and inline style from `.mms-full` down to `.ip-lcd`): which unit or JS value would produce 812 when innerWidth is
   393 and innerHeight is 852 (candidates: a `100vw` / `vh` / `dvh` unit read stale, a JS-written px from the previous
   orientation, a `--pkl-*` landscape variable still applied because `data-ft-rot` was still "90" while `land` was false: note the
   rows show `rot "90"` with `land false` in the giant phase). Record the chain with file:line. If one declaration explains 812
   from the captured values, it is a fix candidate (W1.3); if not, the giant phase ships the instrument only (R3).
3. **The highlight, falsified.** Real browser (the proof harness, two contexts as one user): the PC plays an album; the phone
   picks Play on... > the PC, opens Music > Albums > that album, picks song 2, then MENU back to the album's list. Record: which row
   has `.is-current`, `effectiveCurrentId()`'s value, the phone player's `currentId`, and `RC.state().track.id`. Expected (the
   bug): no row or the wrong row is marked while `RC.state().track.id` is song 2. If song 2 IS marked, stop rule (c).

### W1 - The turn back upright (R2, R3, R4)
1. Instrument (always ships): `rotateSample` gains `sh` ([screen.width, screen.height]), `cvw` (a probe element's computed
   `100vw` width in px) and `cvh` (its `100dvh` height in px), and `pti` (the effective inset W1.2 applied, '' when none). Keep
   the sample read-only (one read pass, the existing hidden probe; never a forced layout write).
2. If W0.1 found a safe rule: apply it ONLY to the Pocket, ONLY during a turn (R4): from the first orientation flip seen
   (`(orientation: landscape)` media query change, `orientationchange`, `screen.orientation` change, whichever comes first) until
   the next window `resize` plus one frame, capped at 1 s; write the effective inset to one CSS custom property on the Pocket
   panel (e.g. `--pk-top-inset`) and make the Pocket's top padding read `var(--pk-top-inset, env(safe-area-inset-top,0px))`, so
   outside a turn the property is absent and the CSS is exactly today's. Clear it at the end of the window and on teardown.
3. If W0.2 found the giant LCD's declaration: the narrowest fix for that declaration (same "during a turn only" rule if it can
   only be fixed that way). Otherwise instrument only.
4. Tests (each mutated red, recorded): the replay test (every fixture row); the window opens on each first-flip event and closes
   on resize+frame and at 1 s; outside a window the property is absent (a sweep over the steady fixtures); teardown clears it; the
   new rotate-log fields present. Visual: the headless rotation harness (`test/visual/capture.js` `rotation()`) still passes
   unchanged (a steady screen must not move by a pixel: run it on base and branch and diff, LESSONS 3 "a probe must be able to
   show a difference").

### W2 - The speaker's song highlighted (R5, R6)
1. Fix at the ONE seam W0.3 confirms (expected: `effectiveCurrentId()` returns the speaker's reported track id while
   `remoteOn()`, chapter ids included, and falls back to today's code otherwise). Grep every other reader of the local player's
   `currentId` that feeds a pocket list mark or `followCurrent`, and route it through the same seam (LESSONS 12: the seat that
   forgot to call the shared helper).
2. The mark must MOVE when the speaker advances: confirm the mirror's repaint (`sigOf` includes the track id) reaches the open
   menu level's rows (not only Now Playing); if it does not, repaint the menu rows on a track-id change.
3. Tests (each mutated red): with `remoteOn()` the list's `currentId` is the speaker's id (fixture where the phone's own player
   has a DIFFERENT current id, LESSONS 2 divergent fixtures); a chapter id; the speaker advancing moves the mark; leaving the
   speaker (This device) returns to the local id; local play unchanged.
4. Real browser: re-run W0.3 on the branch: song 2 marked; the PC goes to the next song: song 3 marked within one mirror update;
   JSON output committed beside the proof script.

### W3 - Docs
- `docs/DEVICE-CHECKS.md`: a "Turn and speaker highlight (v1.357.0)" group with section 7's lines; update the open v1.350 and
  v1.354 turn checks to point at it.
- ROADMAP.md Planned > Bugs "Pocket turn back upright": add the capture's numbers and what v1.357 changed (or, under R3, what it
  instrumented and why).
- Chore (ROADMAP Planned, from the v1.356 gate): in `public/js/common.js` move `bindHandoffToRemote` (and its v1.356 comment)
  ABOVE the JSDoc block "The one show/hide decision..." so that JSDoc sits directly on `shouldShowHandoffCard` again. Comment and
  placement only, no behaviour change; mark that ROADMAP Planned line done.

### Gate and release
- **Gate:** commit first, then spawn the harness seats `adversary` and `qa` (`.claude/agents/`) in parallel on HEAD, each in its
  own /tmp `git archive` sandbox, with a brief: branch, base sha, this plan, LESSONS sections 1, 2, 4, 6, 8, 12, and the attack
  surfaces (a steady screen moving by a pixel; the turn window never closing or leaking a listener; the replay test's binding;
  the highlight under local play vs a speaker, chapter ids, the mark moving, leaving the speaker). Each writes `Gate: <verdict>
  r<n> @<sha> - <seat>` into section 8. Fix CRITICAL/WARNING findings in a new commit, re-engage the SAME seats for a delta
  round. After 2 rounds, ask Dean before a 3rd (AskUserQuestion).
- **Release** (`docs/RELEASING.md` + AGENTS.md "Release ceremony"): `npm version 1.357.0 --no-git-tag-version`; ROADMAP.md
  Shipped entry (numbers copied from instruments); `docs/releases.json` entry in plain user language (the ledger test enforces
  it); a LESSONS update if the wave taught one; `node scripts/plan-complete.js <this plan> "Shipped v1.357.0" --apply`; one
  release commit. Then main is PROTECTED: from the primary checkout on an up-to-date main, `git merge --no-ff -F <file>` the
  branch, tag `v1.357.0` on that local merge, push the release branch AND the tag in ONE push (with
  `GIT_SSH_COMMAND="ssh -o ServerAliveInterval=20 -o ServerAliveCountMax=60"`, never piped), `~/.local/bin/gh pr create`,
  wait for `ci (22)`, `ci (24)`, `audit`, `secret-scan` green, then **ASK DEAN before `gh pr merge --merge`** (never
  self-merge). After the merge: `git reset --keep origin/main` on main (the tag keeps the local merge), check the tag's Docker
  publish and the baseline refresh, delete the branch locally with `-d` (GitHub deletes the remote), remove the worktree.

### Out of scope
The small-phone (iPhone SE) bug, keyboard search for the skins list, the speaker posting its state with no phone attached
(v1.356 R9), VR/360, and anything else: ROADMAP.md Planned only.

## 6. Build log (the builder fills this in: W0 numbers, deviations, mutants per wave, suite results verbatim)

### W0 numbers (Dean's capture, 393x852, test/fixtures/rotate-capture-2026-10-02.jsonl, 9 rows)

- Model: every portrait row has LCD top = safe-area inset + --space-8 (16) - scrollY (giant 59+16, low 59+16, scrolled 0+16-59, settled 0+16).
- Rule (`pocketTopInset`): inset = max(0, sat - max(0, screen long side - innerHeight)) in portrait (short side in landscape).
  Giant (ih 852): 59, unchanged. Low (ih 793, sat 59 stale): 0, LCD y 16 = settled. Scrolled and settled: 0. Landscape-steady and portrait-settled: identity.
- Giant LCD (W0.2): no declaration explains it (a fixed box against a stale layout viewport), so INSTRUMENT ONLY (R3): rows gain sh, cvw, cvh, pti.
- W0.3 (highlight falsifier): reproduced. Phone on Music > Albums > Proof Album while the PC plays song 2: 0 rows marked, phone player id null, speaker track id song2. Stop rule (c) did not apply. Output: tools/listen-control-proof/highlight-proof-base.json.
- Branch proof (highlight-proof-out.json): song 2 marked after pick and on MENU back; song 3 marked 2 ms after the PC advanced; after leaving the speaker nothing marked (the phone's own player is idle); no page errors.

### Deviations (disclosed)

1. W1 product code was written before the W0 replay test existed (plan order broken); the replay test now exists and is mutated red (M01-M03).
2. The window opens only in the home-screen phone app (is-phone and standalone): a Safari tab's toolbars make screen - innerHeight large while the inset may be real, and that was never measured (R4 narrowing).
3. The property is written on <html> (not on .mms-full) so the three portrait paddings and the log read one place; outside a window it is absent and the CSS is today's env().
4. The orientation media query keeps ONE listener: the rotation stamp's, which calls turn.flip() (a second listener broke the v1.354 "one listener" test; M11/M12 bind both halves).
5. Highlight: a separate `menuCurrentId()` (speaker's track id while remoteOn(), else effectiveCurrentId()) feeds only cfg.menu.currentId, instead of changing effectiveCurrentId (about 25 callers; blast radius).
6. Landscape (--pkl-*) and the other safe-area-inset-top uses are untouched: no landscape capture of this turn exists.
7. Mutant M09 survived the first time: jsdom drops padding-top:env() from the probe's style attribute, so the test's probes() selector (on that text) matched nothing and every probe assertion was vacuous. Fixed (240e4263: the probe is the aria-hidden div in <body>, and two assertions prove it exists while open); M09 re-run killed.

### Mutants (committed code, /tmp-style git archive sandbox, `node --test` on the owning file, exact-once replace restored in finally)

On 0752927a: 24 mutants, 23 KILLED first run.
M01 rule off KILLED (2 fail). M02 full side swapped KILLED (2). M03 drop the >=0 clamp KILLED (2). M04 cap 1000 -> 100000 KILLED (2). M05 resize never closes KILLED (1). M06 standalone gate off KILLED (1). M07 phone gate off KILLED (1). M08 close keeps the property KILLED (4). M09 close keeps the probe SURVIVED (0), then KILLED on 240e4263 (2 fail: the captured-turn test and destroy test). M10 second flip does not restart the cap KILLED (1). M11 shared-mq flag ignored KILLED (1). M12 page wiring skips turn.flip KILLED (1). M13 orientationchange not heard KILLED (2). M14 screen.orientation not heard KILLED (1). M15 destroy leaves listeners KILLED (1). M16 resize not heard KILLED (1). M17 css first portrait padding back to env() KILLED (1). M18 log pti dropped KILLED (1). M19 log cvw dropped KILLED (1). M20 log probe not removed on off KILLED (1). M21 speaker branch off KILLED (4). M22 idle speaker falls back to the phone KILLED (1). M23 menu cfg not wired to menuCurrentId KILLED (4). M24 local branch broken KILLED (2).
Not mutated (equivalent): the `v !== lastWritten` write guard (same visible result) and `!open || closing` in resized (a resize with no flip opens nothing either way).

### Tests and instruments

- New: test/unit/pocket-turn-inset.test.js (11 tests: model, replay of every row, steady identity, window on each flip event, captured sequence, 1 s cap, steady sweep and gating, destroy, CSS census, rotate-log fields, real-load reachability). music-skin-integration.test.js: 5 tests (speaker id vs divergent phone id, chapter id, idle speaker, speaker advancing then leaving, local play).
- `npm run lint:ui`: "ui-lint: OK - the live debt equals docs/ui-exceptions.json" (TOTAL 3181, unchanged). `node scripts/overlay-containment-lint.js --enforce`: "overlay-containment: clean (0 violations)".
- W1.4 steady diff (fork, base 01e56dee vs branch 240e4263, ipod skin, phone, 3x DPR, one seeded data dir): base vs base 0/0/0 changed pixels (noise floor), base vs branch 0/0/0 on portrait, landscape and portrait-after. Control with navigator.standalone forced: the property was seen during the turn on the branch (0px in 61 of 109 samples; with a 47 px top inset 47px and 0px in 60 of 110) and ABSENT after it settled; steady frames 0/0/0. The probe can show a difference: base with inset 0 vs base with inset 47 = 582,723 / 1,055,108 / 582,723 changed pixels. The harness `capture.js --only rotation` itself was not run (a purpose-built driver on capture.js's helpers was).
- Full suites, `npm test`, run once after W2 + W3 (240e4263): Node v22.23.1: tests 10807, pass 10795, fail 0, cancelled 0, skipped 12, EXIT 0. Node v24.20.0 (reporter prints the info marker, not #): tests 10807, pass 10795, fail 0, cancelled 0, skipped 12, EXIT 0.

### Not done / open

The 2 giant frames and the 1 scrolled frame are NOT fixed (instrument only, ROADMAP Planned > Bugs). Whether iOS fires an early `resize` that closes the window early is a device question (the per-frame recompute and the 1 s cap bound it).

## 7. Device checks owed (to DEVICE-CHECKS.md at release)

- v1.357.0 - Home-screen app, Pocket on an iPod skin, rotate log ON: turn to landscape and back upright while screen-recording;
  the skin lands in one step both ways (no giant LCD, no drop, no flash under the status bar). Copy the log rows and send them
  with the recording either way.
- v1.357.0 - Play on a speaker PC, pick a song from an album, MENU back to the album: the speaker's song is marked; when the PC
  moves to the next song, the mark moves too.

## 8. Gate record

(seats write their verdict lines here, bound to the sha they reviewed)
