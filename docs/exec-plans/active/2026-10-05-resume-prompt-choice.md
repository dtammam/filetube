---
plan: resume-prompt-choice
harness: v2 · lean
branch: feat/v1.363.0-resume-prompt
anchor: spec
status: Approved @56a714fb
next: the builder (Sonnet) runs section 0, then W1 -> W2 -> W3 in order
design: Dean's rulings R1-R3, 2026-10-05 (kickoff at main 56a714fb, v1.362.4 shipped).
gate: pending
---

# v1.363.0: the "Resume playback?" prompt comes back, as a Settings choice beside today's auto-resume

Kickoff 2026-10-05 by the Architect (Opus) at main 56a714fb. Dean: "I want that back" (the resume prompt with its countdown,
v1.161.0 "configurable resume-countdown length, 0 = instant resume"), after learning that the UI pass (sweep S3, D8.2, commit
aab1c370) replaced the prompt with auto-resume + a "Resumed at 12:34 · Start over" note, and v1.341.0 (c726fe3b) removed its three
then-dead Settings controls. Client only: `public/js/player.js`, the 10 player-hosting shells' `#player-host-template`,
`public/css/style.css`, `public/setup.html` + `public/js/setup.js`, `public/js/common.js` (the shortcut help entries), tests, docs.
No server, no new dependency.

## 1. The outcome (what Dean will see)

A. Settings > Automation & Storage > Playback gets **"When a video has saved progress"**: **Resume automatically** (today's
   behaviour and the default: it resumes, and at or above the threshold the "Resumed at 12:34 · Start over" note shows) or
   **Ask me** (the old "Resume playback?" prompt).
B. With **Ask me**, a video with saved progress at or above the threshold opens PAUSED at 0 with the prompt over the picture:
   "Resume playback?", "You watched this up to 12:34.", **Start from beginning** and **Resume**. Below the threshold it
   resumes quietly (as it always did). The prompt's default button counts down ("Resume · 5", a draining bar) and fires on its
   own; any tap or key on the player cancels the countdown and leaves the prompt waiting. R = Resume, S = Start over while it
   shows.
C. The countdown's controls are back, shown only while **Ask me** is chosen: "Auto-choose after a short countdown" (on by
   default; off = the prompt always waits), "Countdown length (seconds)" 0 to 30, default 5 (**0 = act at once, no prompt**),
   and "Default choice when the countdown fires": Resume from saved position / Start from beginning.
D. In the mini player there is never a prompt: it resumes (the old v1.24.0 D3 rule). If the player is docked while the prompt
   is up, the prompt goes and the video resumes (the old v1.24.5 rule).
E. Nothing changes for music, podcasts, TV episodes, books, chapter tracks, the Listen -> Watch handoff, an `&t=` link, or an
   autoplay advance: they never prompted and still do not.

## 0. Step 0 - read, set up, stop rules

0.1 Read `AGENTS.md`, then `docs/LESSONS.md` sections **0, 2, 4, 6, 7** (section 7's last class: nothing with a filter, mask,
backdrop or blend on or over a playing iPhone video, and section 4's shell-parity and SPA rules), `docs/LESSONS-rules.md` sections
4 and 7. Then this plan top to bottom. Then the OLD implementation at primary source, which this release restores and adapts:
`git show aab1c370^:public/js/player.js` (the prompt: lines ~586-955 pure helpers, ~5021 `resumeDirectly`, ~5068
`handleResumePlayback` video branch ~5146-5205, ~6334-6420 the stored readers and the countdown, ~6894-6919 the buttons, ~8398-8418
the R/S listener, ~8491 teardown, ~9143 dock, ~9224 close), `git show aab1c370^:public/css/style.css` (~1498-1509 the dock guard,
~1735-1801 the overlay and the countdown drain), `git show c726fe3b^:public/setup.html` (~525-550) and
`git show c726fe3b^:public/js/setup.js` (~1151-1160 keys, ~1393 `clampResumeSeconds`, ~2755-2808 wiring), and the deleted tests
`git show aab1c370^:test/unit/player-resume-countdown.test.js`, `...player-docked-resume.test.js`,
`...player-dock-transition-resume.test.js`. Then `git show aab1c370 -- public/js/player.js` to see how today's toast replaced it.

0.2 Environment, every shell: `export PATH="$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH"`. Dual-Node for
the full suite: 22.23.1 and 24.20.0 (Node 24 prints `ℹ`, not `#`; an empty grep is not green).

0.3 Worktree: `git worktree add .claude/worktrees/v1363 feat/v1.363.0-resume-prompt`, then
`ln -s ../../../node_modules .claude/worktrees/v1363/node_modules` (untracked, never staged; `rm` it before the worktree goes).

0.4 Git: stage files BY NAME; `git commit -F <file>` (message via a quoted heredoc); never `--no-verify`, never force-push, never
pipe a commit or push; verify with `git log`. The pre-commit hook runs lint + the unit suite (~5 min): run commits in the
background and wait. Red tests are committed with the code that greens them; record the failing-first run in section 6. Push only
in the release. Commit trailers: the ones your session's system reminder gives you.

0.5 Tests: the targeted files each wave names; the full dual-Node `npm test` once after W3, again only if a gate round changes
product code, never while a gate seat runs. Mutants only on COMMITTED work, in a `/tmp` `git archive <sha>` sandbox (symlink
node_modules), exact-once replace, restored, sandbox diffed against a pristine copy; record each in section 6. Kill only by PID.

0.6 No em dashes anywhere. `npm run lint:ui` passes with `docs/ui-exceptions.json` UNCHANGED or smaller (the ratchet refuses
growth: use tokens). `node scripts/overlay-containment-lint.js --enforce` stays 0. `test/unit/player-overlay-no-filter.test.js`,
`test/unit/ambient-glow-engine.test.js` and `test/unit/minimize-crossfade.test.js` stay green.

0.7 **Stop rules.** Stop and ask Dean (AskUserQuestion) if: (a) a seam in section 4 is gone or behaves differently and the change
is not a like-for-like rename; (b) the prompt would need a `filter`, `mask`, `backdrop-filter`, blend mode, or any opacity /
animation on an ancestor of the video (LESSONS 7); (c) any of section 1 E's surfaces would start prompting; (d) a lock the plan does
not name has to be loosened (section 4 names the ones that must change); (e) scope grows: ROADMAP.md Planned.

## 2. Rulings

| # | Question | Ruling |
|---|---|---|
| R1 | Shape (**Dean**, "A choice in Settings (Recommended)") | A device-local choice, key `filetube_resume_mode`: absent / anything else = **auto** (today), `'ask'` = the prompt. Default auto: nothing changes for anyone who does not choose. The threshold (`filetube_resume_threshold`, default 60) serves both: auto = when the note shows; ask = when the prompt shows (below it, a quiet resume). |
| R2 | Countdown (**Dean**, "As before (Recommended)") | The v1.161 behaviour and its three keys, byte-identical names and formats: `filetube_resume_countdown` (absent = on; only `'0'` = off), `filetube_resume_countdown_action` (`'beginning'` = Start from beginning, anything else = Resume), `filetube_resume_countdown_seconds` (integer 0-30, absent = 5; `clampResumeSeconds` semantics). Length 0 = act at once: no prompt, the default action runs (Resume -> resume quietly; Start from beginning -> start at 0). Countdown off = the prompt waits. Any pointer or key on the player cancels the countdown (the prompt stays). R / S while the prompt shows; S keeps its job on the auto-mode note. |
| R3 | Mini player (**Dean**, "Resume there (Recommended)") | Restore `resolveDockedResumeAction` (docked -> auto-resume, never a prompt) and `resolveDockTransitionResumeAction` (docked while the prompt is up -> dismiss and auto-resume). The CSS dock guard hides the prompt in `#player-dock` too. |

## 3. Design notes (Architect)

- **One decision function.** Extend today's pure `resolveResumeStart(ctx)` (player.js ~648) with `mode` (and the countdown config)
  so ONE table decides: `{ action: 'resume' | 'start' | 'prompt', toast: bool }` (and for an instant countdown, `'resume'` or
  `'start'` with no prompt). Bind it arm by arm. Restore the old pure helpers (`resolveResumeCountdownConfig`,
  `resolveResumeCountdownSeconds`, `resumeCountdownLabel`, `RESUME_COUNTDOWN_SECONDS_DEFAULT = 5`, `..._MAX = 30`,
  `resolveDockedResumeAction`, `resolveDockTransitionResumeAction`, the `'r'` arm of `resolveResumeShortcutAction`) from
  `aab1c370^`, exported.
- **The prompt markup** returns to EVERY shell's `#player-host-template` (the 10 files listed in section 4; shell parity, LESSONS
  4), beside today's `#resume-toast` (both live; the toast stays for auto mode), built on today's primitives: `ui-btn` classes
  (`ui-btn--secondary` for Start from beginning, `ui-btn--primary` for Resume), `<span class="ui-btn__label">`, `hidden` (not inline
  `style="display:none"`; the global `[hidden]` rule wins), `role="dialog"` + `aria-labelledby`. Keep the old ids
  (`resume-overlay`, `resume-yes-btn`, `resume-no-btn`) unless a current test or id collides; `#resume-time-str` is TODAY's toast
  id: give the prompt its own (`resume-prompt-time`).
- **Paint.** The old `.resume-overlay` CSS still exists for `#transcode-overlay` (style.css ~1643-1668): reuse it; plain paint only
  (`--scrim-heavy` background, no filter / backdrop / mask / blend). The countdown drain (`::after`, `scaleX` keyframes,
  `--resume-countdown-duration`) runs only while the prompt is up, which is only while the video is PAUSED at 0; reduced motion
  turns the drain off (the old carve-out). Durations and easings through tokens (`npm run lint:ui`); `--resume-countdown-duration`
  is set from JS (token-scale-lock's `jsSet` gets it back).
- **The video waits.** As before: the prompt shows with the video paused at 0 (`mediaPlayer.autoplay = false`); Resume seeks to the
  saved place and plays (live: `startLiveStream(savedProgress)`); Start from beginning plays from 0 and `saveProgressToServer(0)`.
  Both run the existing seek path, never a new one.
- **Every hide seam cancels the countdown** (the old "EVERY prompt-hide seam cancels" lock): the two buttons, `teardownMediaState`
  (every new load), `dock()` (via R3), `close()`, the tick's own `gen !== loadGeneration` / hidden guard. The countdown's capture
  listeners (pointerdown on the host, keydown on document) are removed on every cancel (LESSONS 4: unbind balance).
- **Settings markup** on today's primitives (the c726fe3b^ block was already on them: `ui-list` / `ui-row` / `ui-switch`, `ui-field`,
  `ui-select`): the mode as a `ui-select` (`resume-mode-select`, options `auto` "Resume automatically" and `ask` "Ask me"), then the
  three countdown controls in a group shown ONLY while Ask is chosen (both axes: reveal on Ask, hide on Auto, reflect on load).
  The threshold's label and help are reworded to cover both modes (never describe the retired behaviour falsely; LESSONS 0, lying
  comment).

## 4. Seams (main 56a714fb; line numbers approximate, verify)

- player.js today: `DEFAULT_RESUME_THRESHOLD_SECONDS` ~564, `resolveResumeThreshold` ~579, `shouldShowResumeOverlay` ~607 (now
  "announce"), `resolveResumeStart` ~648, `resolveResumeShortcutAction` ~663 (S only), `captureAutoplayAdvanceForLoad` ~756,
  exports ~1951; refs `resumeToast, resumeTimeStr, resumeRestartBtn` ~2071 / bound ~2878; `RESUME_THRESHOLD_STORAGE_KEY` ~2317;
  `resumeDirectly` ~5810; `handleResumePlayback` ~5858 (order: suppressProgress, chapterStartSec, loadBaseHandoff, loadStartAt,
  resumeMode music/podcast/tv, then the plain-video branch ~5966-5995 which calls `resolveResumeStart` -> `resumeDirectly` ->
  `showResumeToast`); `getStoredResumeThreshold` ~7135; the toast block ~7138-7178; `resumeRestartBtn` click ~7633; the S listener
  ~9146-9167; `teardownMediaState` ~9178 (hide ~9238); `mountInDock` ~9810 (never prompts); `dock()` ~9879 (hide ~9895);
  `close()` ~9928 (hide ~9968); `autoplayAdvancePending` set ~6244 / ~6435.
- The 10 shells (`#player-host-template`, today's toast block): `public/watch.html`, `index.html`, `history.html`, `music.html`,
  `podcasts.html`, `read.html`, `setup.html`, `stats.html`, `tv.html`, `lib/ytdlp/views/subscriptions.html`.
- style.css: dock guard ~1340-1346 (`.resume-overlay` still listed), `.resume-overlay` ~1643-1668 (now only the transcode overlay),
  `.player-resumed` ~1674-1697.
- common.js shortcut help ~8164-8167 (`S` only today): R and S entries for the prompt, S for the note.
- setup.html: "Automation & Storage" ~467, `<h3>Playback</h3>` ~496, the threshold ~540-546 (`resume-threshold-input`). setup.js:
  `RESUME_THRESHOLD_KEY` ~1008, `loadResumeThresholdControl` ~1278 (called ~4972), wiring ~3103-3112.
- **Locks that MUST change (Dean's ruling R1-R3 retires them; update in place, intent noted, never widened):**
  `test/unit/player-resume-toast.test.js` ~66 ("nothing left behind": it FORBIDS the prompt's ids, keys and helpers and
  `Resume playback?` in setup.html; rewrite it to forbid only what stays retired, and to require the restored prompt in every
  shell beside the toast); `test/unit/player-resume-overlay.test.js` ~181 (r/R -> 'none' becomes 'resume' while the prompt shows)
  and ~217 (close/dock also cancel the prompt); `test/unit/keyboard-shortcuts.test.js` (R back in `accountedFor` ~184, the drift
  lock ~198-204, the stale comment ~47-53); `test/unit/settings-forms-sweep.test.js` ~355-362 (the switch count 32 -> 33: one
  restored switch; a select is not counted, verify); `test/unit/token-scale-lock.test.js` ~184-187 (`--resume-countdown-duration`
  back in `jsSet`). Others that must stay green unchanged: `test/unit/watch-start-time.test.js` (an `&t=` link never prompts),
  `test/unit/setup-advanced-pages.test.js`, every shell-parity / global-collision test.

## 5. Waves

**W1 - the player.** The pure helpers and the extended `resolveResumeStart` (section 3), exported; the stored readers for the mode
and the three countdown keys (read LIVE at the decision, as v1.161 did); the prompt markup in all 10 shells; the CSS; the prompt's
show / hide, the countdown (start, tick, fire = the button's own `click()`, cancel on pointer / key, every hide seam), the
buttons, R / S, the dock and close rules (R3). Tests (`test/unit/player-resume-prompt.test.js`, new; restore the spirit of the
three deleted files at their primary source): the decision table arm by arm (auto x ask x docked x below / at the threshold x
autoplay advance x countdown off / on / length 0 with each default action); a jsdom drive on the REAL watch.html + player.js
(the shape of today's player-resume-toast drives): Ask -> the prompt shows, the video waits at 0, Resume seeks and plays, Start
from beginning starts at 0 and saves 0, the countdown fires the default button, a tap cancels it and the prompt stays, R / S,
dock while up -> resumes, close and a new load hide it and leave no timer and no listener; Auto -> today's toast path unchanged;
the section 1 E surfaces never prompt. The shell census: every shell has the prompt AND the toast. Failing first against main;
mutants (drop each hide seam's cancel, the countdown's listener removal, the docked rule, the R arm, the instant arm, the mode
default).

**W2 - Settings.** The mode select and the three countdown controls (section 3), revealed only on Ask (both axes, reflect on
load), the threshold copy for both modes, `clampResumeSeconds` restored and exported, the keys byte-identical between setup.js and
player.js (a lock), none of them in server.js (a lock, as before). Tests: jsdom on the real setup.html + setup.js (the
`wireLifecycleLogControls` shape in `test/unit/lifecycle-log-export.test.js`): each control writes exactly its key and format,
reflects it on load, the countdown group hides on Auto and shows on Ask; and `wireStaticControls` / `init` wire and prefill them
(a source lock in the shape of `test/unit/pocket-kb-search.test.js` ~639).

**W3 - proof and docs.** A real-browser run (Playwright, iPhone 13 emulation; `tools/minimize-proof/serve.js` + its server
harness, a seeded progress row at e.g. 120 s): Ask -> the prompt shows over the paused picture, the countdown fires Resume after
its length and playback is at ~120 s; a tap cancels the countdown and the prompt waits; Auto -> the note path; save the result
JSON beside the probe. Docs: DEVICE-CHECKS (section 7), the ROADMAP "Device checks owed" list (renumber, keep the order, count both
lists), ROADMAP Shipped + `docs/releases.json` at release, LESSONS-rules if a lesson lands. The full dual-Node `npm test`.

## 6. Build log (the builder fills this in: failing-first runs, mutants, suites verbatim, the real-browser run, deviations)

## 7. Device checks (Dean, on the released build; add to DEVICE-CHECKS.md in the release commit)

- [ ] v1.363.0 - Settings > Automation & Storage > "When a video has saved progress": Ask me. Open a video you watched past a
  minute: it opens paused with "Resume playback?" over the picture; Resume counts down (5 s) and resumes on its own; open another,
  tap the player during the countdown: it stops counting and waits; R and S on a keyboard work. Set the length to 0: it resumes at
  once with no prompt; set the default choice to Start from beginning: it starts over. Turn the countdown off: the prompt waits.
- [ ] v1.363.0 - Ask me, a video with saved progress opened in the mini player (play from a list while browsing): no prompt, it
  resumes. A prompt up, then minimize: it resumes in the mini player. Back to "Resume automatically": the "Resumed at" note as
  before. Music, podcasts, a TV episode and an autoplay next never ask.

## 8. Gate brief

Seats: adversary (floor) + qa; security-brief applied as a section by both (no auth, network or dependency surface).
- The decision table: every arm, the threshold in both modes, the instant countdown, the docked rule, autoplay advance, and the
  surfaces that must never prompt (music, podcasts, TV, books, chapters, the Listen handoff, `&t=`).
- The countdown: unbind balance on every hide seam (LESSONS 4), the TOCTOU belt (`gen !== loadGeneration`), a fire after the
  prompt was hidden, a dock / close / load mid-countdown, reduced motion.
- Paint: nothing filtered / masked / blended over the video; nothing animated on an ancestor of the video (the census in
  `test/unit/minimize-crossfade.test.js` and the v1.312 sweep in `ambient-glow-engine.test.js` must stay green); the drain only
  while paused.
- Shell parity: the prompt in all 10 shells, byte-identical blocks.
- Settings: both axes of the reveal, the keys' formats byte-identical with v1.161, the copy tells the truth for both modes.
- The rewritten locks: intent preserved, never widened beyond R1-R3.

## 8b. Release (v1.363.0)

`docs/RELEASING.md` + AGENTS.md: `npm version 1.363.0 --no-git-tag-version`; ROADMAP Shipped entry; `docs/releases.json` user-language
ledger (no process words); `node scripts/plan-complete.js docs/exec-plans/active/2026-10-05-resume-prompt-choice.md "Shipped v1.363.0" --apply`;
the protected-main PR flow (local `merge --no-ff` onto origin/main, tag the merge, point the release branch at it, ONE push of
branch + tag with `GIT_SSH_COMMAND="ssh -o ServerAliveInterval=20 -o ServerAliveCountMax=60"`, `gh pr create`, the required checks
green (`ci (22)`, `ci (24)`, `audit`, `secret-scan`), `gh pr merge --merge` (ask Dean if the classifier refuses), `git pull --ff-only`);
delete the branches (`-d`; GitHub deletes the remote one).

## 8c. Gate record

## 9. Out of scope (logged, not built)

- A prompt for music, podcasts, TV episodes or books (they never had one).
- Syncing the choice across devices (device-local like every playback preference here).
