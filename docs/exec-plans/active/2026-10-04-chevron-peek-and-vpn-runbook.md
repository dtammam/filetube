---
plan: chevron-peek-and-vpn-runbook
harness: v2 · lean
branch: feat/v1.362.1-chevron-runbook
anchor: spec
status: Draft
next: READY TO BUILD (Architect kickoff 2026-10-04 on Opus at main 10fe3291, Dean's rulings below); set `status: Building` in your first commit; order = section 0, then W0, W1, W2, W3, W4; read the whole plan first
design: Dean 2026-10-04, after his v1.362.0 smoke test ("It works great"): the minimize chevron "is always visible when I'm listening or watching something" and feels awkward; he took the Architect's recommendation (show it while paused, for a few seconds after playback starts and after any touch on the picture; hidden while playing, instantly). Bundled by Dean in one branch: the two v1.362 gate r2 leftovers the Architect recommended (the history-cap gap; the untested picture-in-picture refresh and settle clip) and a runbook for diagnosing his slow app over the VPN, built on the tooling that already exists.
gate: adversary + qa (the player's chevron visibility on the shared player core, the SPA router's minimize landing; the runbook's every claim checked against the tree; security-brief applied as a section by both)
---

# v1.362.1: the minimize chevron peeks instead of staying up; the landing's last history gap; a VPN slowness runbook

Kickoff 2026-10-04 by the Architect (Opus) at main 10fe3291 (v1.362.0 shipped, PR #83; the baselines bot merged #84 after it).
v1.362.0's plan (`docs/exec-plans/completed/2026-10-03-minimize-to-mini-player.md`) is the background for parts A and B: read its
sections 2, 4 and 6. Client code only for A and B (`public/js/player.js`, `public/js/common.js`, `public/css/style.css` only if a
lock needs it), no server, no storage, no new dependency, no shell (`*.html`) edit. Part C is a document; it adds NO code.

## 1. The outcome (what Dean will see)

A. **The chevron peeks.** Phone, custom player controls on, a video (or an audio file) on the watch page:
   1. While it is paused (or has not started), the down-chevron shows at the picture's top-left, as in v1.362.0.
   2. When playback starts, it stays for about 3 seconds, then disappears instantly (no fade).
   3. While it plays, any touch on the picture brings it back for about 3 seconds (that touch still does what it does today: a tap
      pauses, a double-tap skips, a hold is 2x, a pull minimizes).
   4. The pull-down works at all times, chevron visible or not. Nothing else about v1.362.0 changes.
B. **The minimize never dead-ends.** After a very long chain of videos and some Back presses, a minimize still lands somewhere real
   (the browse page, or Home) and the Home button still works afterwards. No visible change otherwise.
C. **The VPN runbook.** A document Dean follows on his phone to find out which part of "slow over the VPN" is slow, with a checklist,
   the order to test in, how to read each number, and what each result points to. Sent to him as a file at the end.

## 0. Step 0 - read, set up, and the stop rules

0.1 Read `AGENTS.md`, then `docs/LESSONS.md` sections **0, 1, 2, 3, 4, 6, 7, 12, 13** and `docs/LESSONS-rules.md` sections 4 and 6
(the two v1.362 lines), then v1.362.0's plan (above) sections 2, 4, 6 and 8c. Read this plan fully before editing.

0.2 Environment, every shell: `export PATH="$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH"`. Dual-Node for
the full suite: 22.23.1 and 24.20.0 (Node 24 prints `ℹ`, not `#`; an empty grep is not green).

0.3 Worktree: `.claude/worktrees/v13621` on branch `feat/v1.362.1-chevron-runbook` (it exists, carries this plan, and has the
`node_modules` symlink; it stays untracked, never staged; `rm node_modules` before the worktree is removed). `git merge --ff-only main`
first if main moved.

0.4 Git: stage files BY NAME; `git commit -F <file>` (message via a QUOTED heredoc, `<<'EOF'`); never `--no-verify`, never
force-push, never pipe a commit or push; verify with `git log`. The pre-commit hook runs lint + the unit suite (~3-5 min): run
commits in the background and wait. Red tests cannot be committed alone (the hook refuses them): commit a wave's tests with the
code that greens them, and record the failing-first run verbatim in section 6. Push only in the release step. Commit trailers:
the ones your session's system reminder gives you.

0.5 Tests while building: the targeted files each wave names. The full dual-Node `npm test` once after W3, again only if a gate
round changes code, never while a gate seat is running.

0.6 Report every failure verbatim with counts. "Verified" means you ran it and saw it. Mutants only on COMMITTED work, in a
`git archive <sha>` sandbox under the scratchpad or /tmp (symlink `node_modules`), exact-once replace, restored in a `finally`,
sandbox diffed against a pristine copy after; kill anything you start BY PID (never `pkill -f`). Record every mutant in section 6.

0.7 No em dashes anywhere. `npm run lint:ui` must pass with `docs/ui-exceptions.json` UNCHANGED or smaller
(`test/unit/ui-exceptions-ratchet.test.js` refuses any growth against main, even an approved one: pay for a new annotation in the
same file, as v1.362.0 W3 did). `node scripts/overlay-containment-lint.js --enforce` stays 0. A comment, test title or doc your
change inverts is a finding: grep `refreshMinimizeButton`, "always shown", "never hidden" (the v1.362 plan's R6/M2 wording lives in
a COMPLETED plan: leave completed plans alone), the `R6` comment above `refreshMinimizeButton` in player.js.

0.8 **Stop rules.** Stop and report (never guess) if: (a) a seam in section 4 does not exist or behaves differently and the fix is
not a like-for-like rename; (b) hiding the chevron would need an opacity, transition, animation, filter, mask or blend on or over
the picture (LESSONS 7: the chevron appears and disappears instantly, `hidden` only); (c) any change alters a gesture (tap pauses,
double-tap skips, hold 2x, hold-drag locks, swipe right goes back, the pull minimizes, an upward drag scrolls), measured, not
argued; (d) the runbook would need a NEW instrument, route, setting or code change to be useful (log the gap in ROADMAP Planned;
the runbook is built on what exists); (e) a runbook step names a button, label, setting, scenario, matrix row or number you have not
seen in the tree or on the real page (never invent UI text; LESSONS 1: numbers are copied from an instrument); (f) scope grows:
ROADMAP.md Planned. A stop rule is never satisfied by narrowing a test.

## 2. Rulings

| # | Question | Ruling |
|---|---|---|
| D1 | Chevron visibility (**Dean**, 2026-10-04, took the Architect's recommendation over "remove it" and "paused only") | Shown while `minimizeAllowed()` AND (the media is paused or has not started OR a peek window is open OR the chevron itself has keyboard focus). A peek window of `MINIMIZE_PEEK_MS` (3000, a named top-level constant, tunable after Dean's device pass) opens on the media's `play` event and on every `touchstart` on the picture's gesture surfaces (`#media-player`, `#audio-bg-art`, the same place `beginMinimizeGesture` runs) and on the chevron. When the window closes while playing, the chevron hides at once. |
| D2 | How it hides (**Architect**, LESSONS 7) | The `hidden` attribute only, through `refreshMinimizeButton` (the one writer). No opacity, transition, animation, visibility fade or class that paints over the picture. Stop rule (b). |
| D3 | Pure core (**Architect**) | `minimizeChevronShownDecision({allowed, paused, now, peekUntil, focused})` top-level in player.js, exported, tested branch by branch (each conjunct flipped alone); `refreshMinimizeButton` gathers the flags. The peek timer is ONE `setTimeout` (cleared and re-armed by each peek; cleared, with `peekUntil` reset, by `resetTransientPlaybackUi`, which dock, close, a new load and backgrounding already call) that calls `refreshMinimizeButton` when the window ends. |
| D4 | Paused source (**Architect**) | The element that is playing: `activeMediaElement()` if it exists in player.js at the seam (v1.27.0: it returns `mediaPlayer` or the background-audio sidecar), else `mediaPlayer`. Refresh on that element's `play` and `pause` events (the video's `play`/`pause` listeners at player.js ~6973-7001 are the precedent; add ONE listener pair, never a second writer of `hidden`). |
| D5 | The history gap (**Architect**, v1.362 gate r2 (a)) | `resolveMinimizeLanding(depth, browseDepth, historyLength, reachableBack)`: when `reachableBack` is a finite integer, go Home iff `steps > reachableBack`; else keep v1.362.0's `steps >= historyLength`. `leaveWatchForBrowse` passes `window.navigation.currentEntry.index` when `window.navigation && window.navigation.currentEntry && Number.isInteger(window.navigation.currentEntry.index)`, else undefined. The Navigation API's `currentEntry.index` is the count of same-document-origin entries behind the current one, i.e. exactly how far `history.go(-n)` can reach; verify that claim at primary source (the HTML spec / MDN) and quote it in section 6 before relying on it (LESSONS 2, third-party API interplay). Safari may not ship it: the length fallback stays. |
| D6 | The untested refresh and clip (**Architect**, v1.362 gate r2 (b), (c)) | (b) a jsdom test drives the real picture-in-picture listeners: `document.pictureInPictureElement` set to the video (defineProperty), dispatch `enterpictureinpicture` on the video: chevron hidden; clear it, dispatch `leavepictureinpicture`: shown. (c) a CSS lock (exact selector, by value) on `#player-dock.is-minimize-settle { overflow: visible; box-shadow: none; }`. |
| D7 | The runbook (**Dean**: "given what I have in the system ... a run book ... like a checklist, like a walkthrough on how I can meaningfully test") | ONE document, docs/references/vpn-slowness-runbook.md (a new file; written without backticks here because test/unit/docs-link-census.test.js requires every backticked docs path in a living doc to exist, and this one does not until W3), built ONLY on what exists (section 3 lists it). It is a walkthrough for a non-expert on a phone: what to switch on, which runs to record and in what order, what each number on `/diag` means, a decision table from each result to its likely cause and the next action, and a results template he fills in. Plain language; jargon explained once. Every UI label, scenario name, matrix row and route it names is copied from the tree AND seen on the real page (W3 drives `/diag` in the proof server and quotes what it saw). Sent to Dean with SendUserFile at the end. No code, no new instrument; a gap goes to ROADMAP Planned (stop rule d). |
| D8 | Release | v1.362.1 (a patch: a behaviour polish and fixes; the runbook ships in the same release commit). |

## 3. What already exists for the runbook (mapped 2026-10-04 by an Explore pass; VERIFY each against the tree in W3)

- **Performance diagnostics suite (v1.307.0, plan `docs/exec-plans/completed/2026-09-21-perf-diagnostics.md`, built for exactly
  this complaint; no record that a diagnosis was ever saved).** Settings > Experimental > "Performance diagnostics (experimental)"
  (`public/setup.html` ~899-907, admin only, off by default, live) reveals "Open performance diagnostics" -> `/diag`
  (`public/diag.html`, `public/js/diag-page.js`). Env `FT_DIAG=1` forces it on (`server.js` ~215; not in docs/CONFIGURATION.md).
  - Run labels (diag.html ~87-90): "LAN (home wifi, no VPN)", "5G + VPN", "5G, no VPN", "Home wifi + VPN".
  - Guided scenarios (diag-page.js ~18-27): cold-load-home, nav-home-to-music, nav-cross-section, open-video-ttff, seek-midpoint,
    thumb-scrub, play-60s-stability, warm-reload-home.
  - Active probes (diag-page.js ~95-156): RTT (20 pings; median / min / p95 wall, and "pipe-only" = wall minus server time),
    throughput (1, 5, 20 MB blobs, Mbps), compression delta (none / gzip / brotli wire bytes).
  - Isolation matrix (diag-page.js ~232-248), each row paired with the fix it points to: RTT wall (WireGuard / MTU / VPN endpoint),
    RTT pipe-only, server compute (rules the box in or out), throughput at 20 MB (mobile rendition / home upload cap), compression
    wire size, nav fan-out (API requests per view), time-to-first-frame (faststart), stalls in 60 s (adaptive bitrate), cold vs warm
    Home (caching). A per-scenario table (wall, API requests, total requests, summed TTFB, bytes, TTFF, stalls) and "Compare
    selected (2)" for two runs side by side.
  - Passive collector `public/js/perf-collector.js` (injected while the toggle is on; records only while a run is armed; a red
    "REC" badge shows): resource and navigation timing (DNS, connect, TLS, TTFB, download, sizes, protocol, Server-Timing), media
    events, `window.__ftDiag.mark(label)`. Connection info (effectiveType, downlink, rtt, saveData) snapshotted at arm.
  - `Server-Timing: app;dur=<ms>` on every response while the toggle is on (`lib/diag/timing.js`).
  - Runs saved to `DATA_DIR/.diag/run-<id>.json`, also `GET /api/diag/runs/<id>` (admin).
- **Other instruments:** `scripts/probe-faststart.js` (read-only: which .mp4 files have the moov atom after the media data, the
  classic slow-start cause; ships in the image: `docker exec <c> node scripts/probe-faststart.js --list`). `?debugLifecycle=1` / Settings >
  Troubleshooting > "Show lifecycle debug log": a once-per-second `video:check` line (readyState, networkState, frames) that shows
  stalls on a phone with no console.
- **Facts that shape the readings (put them in the runbook as context, not as fixes):** no compression middleware (API JSON, shells,
  JS and CSS go uncompressed unless a proxy compresses); static files and shells are `Cache-Control: no-cache` (a revalidation round
  trip per asset per load); `/video/:id` has no Cache-Control; no service-worker cache; no adaptive bitrate or quality picker (the
  original file at its own bitrate); background polling (notification badge 60 s, download chip 5 s, device handoff 30 s, remote
  1.5-5 s); Settings > Experimental > "Instant background-audio handoff" costs extra requests (switch it off for a clean test); the
  deployment is Docker on port 3000 with no bundled proxy (`docs/CONFIGURATION.md`: `FILETUBE_TRUST_PROXY=1` behind a proxy).
- **Not present (the runbook says so, and the useful ones go to ROADMAP Planned as candidates, not built):** bandwidth / data-usage
  accounting, access or slow-request logs, always-on Server-Timing, compression, Web Vitals / long tasks, offline cache, adaptive
  bitrate, a quality or data-saver setting, timing in transcode or scan logs, load-test scripts.

## 4. Seams (main 10fe3291; line numbers approximate)

- player.js `minimizeAllowed` ~4964, `beginMinimizeGesture` ~5037 (the surfaces' touchstart hook), `refreshMinimizeButton` ~5144
  (the one writer of `minimizeBtn.hidden`, ~5164), the chevron's click handler, `resetTransientPlaybackUi` (calls
  `clearMinimizeDrag`), the PiP listeners ~8369, the `play`/`pause` listeners ~6973-7112, `activeMediaElement` (grep it), the
  export block (`minimizeAllowedDecision` etc.).
- common.js `resolveMinimizeLanding` ~10308, `leaveWatchForBrowse` ~11604, `browseDepthBehind` ~10292, the export block.
- test/unit/minimize-player.test.js: the jsdom harness (`boot`, `pull`, `fire`, `routerWorld`), the chevron tests (the
  "shown only where minimize is offered" test assumes an always-shown inline chevron: update it to the peek rule, intent kept), the
  router tests.
- style.css `#player-dock.is-minimize-settle` ~1401.

## 5. Waves

**W0 - red tests.** `minimizeChevronShownDecision` (each conjunct alone), the peek drives (shown paused; after `play` shown, then
hidden after `MINIMIZE_PEEK_MS` with fake or real waits; a touchstart on the video while playing shows it again for the window; a
focused chevron stays; dock / faux full screen / native-controls / desktop still hidden regardless of the timer; the timer cannot
re-show it after a dock or close), `resolveMinimizeLanding` with `reachableBack` (incl. the adversary's case: depth 46, browseDepth
0, length 50, reachableBack 34 -> Home), the real `leaveWatchForBrowse` with a stubbed `window.navigation`, the D6 PiP drive and
CSS lock. Record the failing-first run verbatim (the hook refuses red: they commit with W1/W2).

**W1 - the chevron peeks (D1-D4).** The pure decision, the timer, the play/pause refresh, the touchstart and chevron peeks, the
focus rule, the timer cleared on teardown. Targeted: minimize-player, hold-lock, player-overlay-no-filter. A real-Chromium check
(reuse `tools/minimize-proof/`, e.g. extend `probe-targets.js` or a new probe): paused shown; 3 s after play hidden; a touch while
playing shows it, the touch's tap still pauses (measure `paused`); the pull still docks with the chevron hidden. Mutants: drop the
paused conjunct, the timer re-arm on touch, the timer clear on dock; each red by name.

**W2 - the landing's last gap and the two untested wires (D5, D6).** Targeted: minimize-player, router-helpers. Re-run the
adversary's Chromium repro (router-shaped entries pushed to depth 61, history.length 50, back 15 to depth 46, then the chevron):
it must land on a real page and the Home button must work after; in Chromium `navigation.currentEntry.index` exists, so record
which branch decided. Mutants: ignore `reachableBack`; `>` to `>=`; the PiP listeners removed; the settle rule dropped.

**W3 - the runbook (D7).** Write docs/references/vpn-slowness-runbook.md from section 3, verified: boot the proof server
(`tools/minimize-proof/serve.js` or the v1.307 plan's own harness) with `FT_DIAG=1` or the setting on, open `/diag` in headless
Chromium, and confirm every label, scenario, probe, matrix row and button the runbook names, quoting them in section 6 (a
screenshot of `/diag` for Dean is welcome). Shape (adapt, keep plain): 1 what this finds; 2 before you start (setting, which device,
switch off "Instant background-audio handoff", close other apps, note VPN app and server); 3 the runs, in order (home Wi-Fi no VPN
first as the baseline, then Wi-Fi + VPN, 5G + VPN, 5G no VPN), each: label chip, arm, the 8 scenarios, the probes, save; 4 reading
the results with "Compare selected (2)": each matrix row in one line ("what it measures / if VPN is much worse here it points to /
what to do or tell Claude"); 5 extra checks (`probe-faststart.js`, the `video:check` log for stalls, a public speed test with and
without the VPN, the server's home upload speed); 6 what to send back (the run ids or the JSON files under `DATA_DIR/.diag/`); 7 a
results template table; 8 what the app cannot measure today (section 3's list), plainly. Then the full dual-Node `npm test`.

**W4 - gate.** adversary + qa, briefed with section 8. Then section 8b.

## 6. Build log (the builder fills this in: failing-first runs, measurements, the D5 primary-source quote, the /diag verification, deviations, mutants per wave, suites verbatim)

## 7. Device checks (Dean, on the released build; add each to DEVICE-CHECKS.md in the release commit)

1. Phone, custom controls on: pause a video, the chevron shows; play, it disappears after about 3 s with no fade; touch the picture
   while it plays (the tap pauses, as always) and it shows; play again and it goes after about 3 s. Pull down with the chevron hidden:
   it still minimizes. The same with an audio file on the watch page.
2. Is 3 s right? Say if it should be longer or shorter (one constant).
3. The v1.362.0 checks still owed (DEVICE-CHECKS.md), in particular any black picture during a pull.
4. Follow the runbook once; tell Claude where it was unclear.

## 8. Gate brief (attack surfaces)

- **LESSONS 7:** nothing fades, animates or paints over the picture to hide the chevron; `hidden` only, one writer.
- **Reveal and clear are two axes (LESSONS 4):** the timer re-shows a chevron after dock / close / faux full screen / a new item;
  a stale timer from the previous item; the peek on `play` from the background-audio sidecar; focus keeping it up forever.
- **Gesture disjointness (LESSONS 2):** the peek touch must not change what the touch does (a tap still pauses, a hold still 2x, a
  pull still claims); the chevron being hidden must not make a tap at its spot do something new.
- **Third-party API (LESSONS 2, 11):** `navigation.currentEntry.index` semantics read at primary source; Safari without it.
- **The runbook (LESSONS 1, 12):** every label, number and route checked against the tree and the real `/diag` page; nothing
  invented, nothing promised that the app cannot do.

## 8b. Release (v1.362.1)

Exactly `docs/RELEASING.md` and AGENTS.md "Release ceremony": `npm version 1.362.1 --no-git-tag-version`; ROADMAP.md "Shipped"
entry, and in Planned > Bugs mark the "v1.362 gate r2 suggestions" items (a), (b), (c) done (keep (d)); add the runbook's
"not present" candidates Dean may want to ROADMAP Planned (one entry, a list); a `docs/releases.json` ledger entry in pure user
language (the tone test enforces it); section 7 into DEVICE-CHECKS.md; a LESSONS update in the release commit only if the wave
taught one; `node scripts/plan-complete.js <this plan> "Shipped v1.362.1" --apply` in its own docs commit first. Then the
protected-main flow: local `merge --no-ff` into main, tag on that merge, push the branch + tag in ONE push with
`GIT_SSH_COMMAND="ssh -o ServerAliveInterval=20 -o ServerAliveCountMax=60"`, `gh pr create`, wait for CI green (`ci (22)`,
`ci (24)`, `audit`, `secret-scan`; visual is a report), then ASK Dean (AskUserQuestion) before `gh pr merge --merge`. After the
merge, local main will not fast-forward (the tag is on the local merge): confirm `git diff <local merge> origin/main` is empty, then
`git reset --keep origin/main`. GitHub auto-deletes the remote branch (confirm with `git ls-remote --heads origin <branch>`); delete
the local branch with `-d`; `rm` the worktree's `node_modules` link and `git worktree remove` it. Send Dean the runbook (SendUserFile)
with the final report.

## 9. Out of scope (logged, not built)

- Any new performance instrument, compression, caching, adaptive bitrate, a quality or data-saver setting (they are the runbook's
  possible OUTCOMES; Dean picks after he has numbers). The v1.362 gate r1 leftovers (the curl-right swipe-back, a Settings toggle for
  `?minimizeAnim`). Making a tap reveal controls without pausing (it would change the tap gesture).
