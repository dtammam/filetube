---
plan: chevron-peek-and-vpn-runbook
harness: v2 · lean
branch: feat/v1.362.1-chevron-runbook
anchor: spec
status: Building
next: W0-W3 + the suite fix committed, dual-Node green at 39ee4a7b; W4 gate (adversary + qa, section 8) running, verdicts in 8c
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

**W0 (builder, Sonnet session on Opus 5.5, 2026-10-04, at 9bd3ffbb).** Failing-first, verbatim, `node --test
test/unit/minimize-player.test.js` with the new tests and no product code: `# tests 51 / # pass 41 / # fail 10`. The 10: the
pure `minimizeChevronShownDecision` (not exported), the six peek drives, the D2 one-writer lock, the two D5 tests. The two D6
tests (the PiP drive and the settle lock) PASS on main: they bind code v1.362.0 already shipped, so their binding is proven by
the W2 mutants (W2-M4..M6), not by a red run. One test bug found while greening: the tap-pauses drive waited 240 ms, inside the
350 ms double-tap window (the single tap is debounced); now 420 ms, as the v1.362.0 tap test does. The peek drives shorten the
window by an exact-once source swap of `var MINIMIZE_PEEK_MS = 3000;` (player.js is strict, so a top-level var is not a jsdom
global); the real 3000 is asserted on the export.

**W1 (builder, 2026-10-04, committed ca5e0ffa).**

- Built: `MINIMIZE_PEEK_MS = 3000` and `minimizeChevronShownDecision` top-level and exported; `peekMinimizeButton` (one timer,
  cleared and re-armed by each peek) and `endMinimizePeek` (called from `resetTransientPlaybackUi`, so dock, close, a new load and
  backgrounding end the window); the surface `touchstart` peeks right after `beginMinimizeGesture`; the chevron's own
  `touchstart` peeks and its `blur` refreshes; ONE `play`/`pause` pair on the video (`play` peeks, `pause` refreshes);
  `refreshMinimizeButton` stays the one writer of `hidden` and reads `paused` from `activeMediaElement()`.
- **Interpretation (disclosed):** a peek opens only while `minimizeAllowed()` (else the window is reset), so a `play` while docked
  or in full screen leaves no window for a later expand (D1 says the window opens on `play`; it now opens on a `play` that can
  show the chevron). No stop rule hit: (b) no opacity, transition or class on the chevron (locked: no `minimizeBtn.style` or
  `.classList` write anywhere); (c) measured below.
- Updated in place, intent kept: the v1.362.0 "shown only where minimize is offered" test and the two r1 chevron tests (coarse
  pointer past 768 px, audio expanded) now pause first (a playing chevron is hidden by design). style.css's chevron comment now
  states the peek rule.
- **Chromium** (`tools/minimize-proof/probe-peek.js`, result JSON beside it; iPhone 13, raw CDP touch, custom controls on):
  paused: shown; play +500 ms shown, +2500 ms shown, **+3500 ms hidden**; a centre touch while playing: shown at touch-down, and
  600 ms after the tap **paused true**, state full; played again, +3600 ms hidden; **a tap exactly on the hidden chevron's spot
  (26, 98): shown at touch-down, 600 ms later paused true, state full, still `/watch.html?v=clip1`** (the picture's touchend
  prevents the synthetic click, so the revealed chevron never receives it: no new gesture); played again, hidden; **a 250 px pull
  with the chevron hidden: docked, playing, on `/`**. 0 page errors.
- **W1 mutants** (on ca5e0ffa, `git archive` sandbox in the scratchpad, exact-once replace, restored in a `finally`, sandbox
  identical to its pristine copy after; minimize-player + hold-lock + player-overlay-no-filter, 72 tests): M1 drop the paused
  conjunct KILLED (5 red, incl. `minimizeChevronShownDecision`, `paused shows it`); M2 no peek on a picture touch KILLED (3: `a
  touch on the picture`, `every touch re-arms`, `the cover art`); M3 no timer clear on dock / teardown KILLED (`the timer never
  re-shows it after a dock`); M4 no peek on play KILLED (4); M5 drop focus KILLED (2); M6 no peek on a chevron touch KILLED
  (`every touch re-arms`); M7 no refresh on pause KILLED (`a pause brings it back`); M9 the timer never refreshes KILLED (4); M10
  no blur refresh KILLED (`goes on blur`). **M8 SURVIVED** (a peek opens where minimize is not offered: 72/72) and **M11
  SURVIVED** (paused read from the video, not `activeMediaElement()`: 72/72). Both bound in W2: M8 by a drive (play while docked,
  expand inside the window: hidden); M11 by a source lock in the D2 test (jsdom cannot reach the background-audio state;
  disclosed as a source binding).

**W2 (builder, 2026-10-04, committed fb8633ac).**

- **D5 primary source** (the WHATWG HTML Standard, fetched 2026-10-04, section 7.2.6 and "browsing the web"), quoted:
  "To get session history entries for the navigation API of a navigable navigable given an integer targetStep: Let rawEntries be
  the result of getting session history entries for navigable. ... Let startingOrigin be rawEntries[startingIndex]'s document
  state's origin. Let i be startingIndex - 1. While i > 0: If rawEntries[i]'s document state's origin is not same origin with
  startingOrigin, then break. Prepend rawEntries[i] to entriesForNavigationAPI." and "newSHEs will have originally come from
  getting session history entries for the navigation API, and thus each newSHE will be contiguous same origin with initialSHE.
  Set navigation's current entry index to the result of getting the navigation API entry index of initialSHE within
  navigation." with "To get the navigation API entry index of a session history entry she within a Navigation navigation: Let
  index be 0. For each nhe of navigation's entry list: If nhe's session history entry is equal to she, then return index.
  Increment index by 1." So `currentEntry.index` = the same-origin, contiguous entries the navigable still HAS behind the
  current one: a `history.go(-n)` with n <= index lands on one of them. (The spec's loop reads `i > 0`, which would never prepend
  entry 0, i.e. it can only UNDER-count, the safe side here; Chromium measured below counts it: index 1 at depth 1 over `/`.)
- Built: `resolveMinimizeLanding(depth, browseDepth, historyLength, reachableBack)`: an integer `reachableBack` decides (Home iff
  steps > reachableBack), else the v1.362.0 length rule; `leaveWatchForBrowse` passes `navigation.currentEntry.index` when it is
  an integer. The comment above it states the spec reading.
- **Chromium, the v1.362 gate r2 adversary repro** (`tools/minimize-proof/probe-cap.js`, result JSON beside it; Home > clip1,
  router-shaped watch entries pushed to depth 61, Back 15, then the chevron, then a search and the bottom-nav Home):
  - main 10fe3291 (a `git archive` sandbox, same probe): pushed: history.length 50, navIndex 49; after Back 15: depth 46, length
    50, **navIndex 34**; after the chevron: **state docked, still `/watch.html?v=clip1`** (the go(-46) no-op); after a search,
    the Home tap: **still `/?search=probe`** (Home dead).
  - branch: the same until the chevron; after it: **`/`, docked** (history.length 36, navIndex 35: a fresh Home push; the
    **index branch decided**, 46 steps > 34 reachable); after a search, the Home tap: **`/`** (Home works).
- **W2 mutants** (on fb8633ac, same runner; minimize-player + router-helpers, 124 tests; sandbox identical after): M1 ignore
  `reachableBack` KILLED (2: `D5: resolveMinimizeLanding`, `D5: the real leaveWatchForBrowse`); M2 `>` to `>=` KILLED (2); M3
  leave does not pass the index KILLED (`the real leaveWatchForBrowse`); M4 the PiP listeners removed KILLED (`D6 (b)`); M5 the
  settle rule dropped KILLED (`D6 (c)`); M6 the settle keeps `overflow: hidden` KILLED (`D6 (c)`); **W1-M8 re-run KILLED**
  (`the timer never re-shows it after a dock`); **W1-M11 re-run KILLED** (`D2: ... one writer`).

**W3 (builder, 2026-10-04).**

- Written: docs/references/vpn-slowness-runbook.md, sections 1-8 as the plan's shape.
- **/diag verified on the real page** (`tools/vpn-runbook-proof/probe-diag.js`, result JSON beside it; FT_DIAG=1 on the proof
  server, Chromium iPhone 13; two runs armed through the chips, scenarios tagged in a second tab, all three probes fired, saved,
  viewed and compared). Read off the pages, verbatim: Settings > **Experimental** > "Performance diagnostics (experimental)", the
  "Open performance diagnostics" button (href `/diag`, hidden while the switch is off); Experimental > "Instant
  background-audio handoff (experimental)"; **Troubleshooting** > "Show lifecycle debug log". `/diag`: title and h1 "FileTube
  Perf Diagnostics", "← Back to Settings", "Idle - no run armed.", sections "1 · Arm a run", "2 · Guided scenarios", "3 · Active
  probes (isolate one variable each)", "4 · Saved runs & isolation matrix"; labels "Network label (what conditions is this
  run?)", "Note (optional - device, signal bars, anything)"; chips LAN / 5G + VPN / 5G no VPN / WiFi + VPN filling "LAN (home
  wifi, no VPN)" / "5G + VPN" / "5G, no VPN" / "Home wifi + VPN"; buttons "Arm run & start recording", "Stop & save", "Open
  FileTube in new tab ↗", "Clear active scenario", "Measure RTT (20×)", "Throughput (1 / 5 / 20 MB)", "Compression delta",
  "Refresh", "Compare selected (2)" (disabled until two ticks), "Tick two runs (e.g. LAN + VPN) to compare."; the eight scenario
  titles and descriptions exactly as diag-page.js (each "Set active", disabled until a run is armed); armed status "● RECORDING
  - LAN (home wifi, no VPN) · scenario: (none) · 0 events captured"; the app tab's badge "REC ● diag · cold-load-home · 59";
  "Saved run 2026-10-04-0310-zxtxn4"; runs list "LAN (home wifi, no VPN)85 ev2 scen... View Delete"; matrix headers "Dimension",
  the run labels, "Lever it points to", and the nine rows with their levers (RTT wall (median) / WireGuard / MTU / VPN endpoint;
  RTT pipe-only (median) / network minus server compute; Server compute (avg) / rules the BOX in or out; Throughput @20MB /
  mobile rendition / home-upload cap; Compression wire size / brotli / gzip; Nav fan-out (worst view) / aggregated bootstrap
  endpoint; Time-to-first-frame / confirms faststart is fine; Stalls (60s play) / adaptive bitrate; Cold vs warm Home /
  service-worker shell/thumb caching); per-scenario headers Scenario, Wall, API reqs, Total reqs, Σ TTFB, Bytes, TTFF, Stalls.
  Files `run-2026-10-04-0310-3yxr23.json` and `run-2026-10-04-0310-zxtxn4.json` under DATA_DIR/.diag; `GET /api/diag/runs/<id>`
  200; `Server-Timing: app;dur=0.4` on a ping. 0 page errors. (The numbers in the probe are localhost, meaningless for a VPN;
  only the labels are used.)
- **Corrections to section 3, found in the tree (the runbook follows the tree):** the lifecycle log has no once-per-second line:
  it logs `video:waiting` / `video:stalled` (and other media events) as they happen, plus ONE `video:check` six seconds after
  each `playing` (player.js `recordVideoState`, `VIDEO_CHECK_SAMPLES` 6 x 1000 ms); the background polling intervals were not
  re-verified one by one, so the runbook names none. Added from the tree: /diag and the app talk through localStorage
  (diag-page.js / perf-collector.js), and a home-screen app has its own storage (docs/references/pwa-ios-notes.md), so the
  runbook says to use Safari tabs; a Stalls cell reads "-" unless its scenario ran (derived in `deriveMetrics`). (Gate r1, both seats: the warm half of Cold vs warm Home prints 0 ms, not "-", when its scenario did not run; the runbook now says so.)
- No stop rule (d) or (e): nothing new was needed; every name the runbook uses is in the list above.

**Full suite after W3 (148c5e53), verbatim:** Node 22.23.1 `# tests 10889 / # pass 10877 / # fail 0 / # cancelled 0 / # skipped
12`, exit 0; Node 24.20.0 `ℹ tests 10889 / ℹ pass 10876 / ℹ fail 1 / ℹ cancelled 0 / ℹ skipped 12`, exit 1. The one failure:
`D1: paused shows it; play shows it for the window, then it hides at once; a pause brings it back` - "the window closed while
playing: hidden / false !== true" (the chevron still shown after the window). **Root cause (a real defect, not a flake):** the
peek timer's callback re-asked the decision `Date.now() < peekUntil`; a timer may fire a hair before the clock reaches its edge,
and then the chevron stayed up with no timer left (on a phone: until the next touch, pause or resize). **Fix (39ee4a7b):** the
timer ends the window (`minimizePeekUntil = 0`) before it refreshes; bound by a drive whose clock lags the timer (`D3: the
window ends when its timer fires, even when the clock reads a hair early`). Mutant F1-M1 (the pre-fix callback) KILLED by that
name on Node 24 (`ℹ tests 52 / ℹ pass 51 / ℹ fail 1`), sandbox identical after; minimize-player.test.js 10 runs in a row on Node
24: 0 failed. (The mutant runner's name parser read only Node 22's `not ok` lines; it now reads Node 24's `✖` too. The W1/W2
mutant runs were on Node 22, so their names stand.) probe-peek.js re-run on 39ee4a7b: identical rows (paused shown; +3500 ms
hidden; a centre tap and a tap on the hidden chevron's spot both pause, state full, same page; the pull docks), 0 errors.

**Full suite at 39ee4a7b, verbatim:** Node 22.23.1 `# tests 10890 / # pass 10878 / # fail 0 / # cancelled 0 / # skipped 12`,
exit 0; Node 24.20.0 `ℹ tests 10890 / ℹ pass 10878 / ℹ fail 0 / ℹ cancelled 0 / ℹ skipped 12`, exit 0. `npm run lint:ui` OK
(docs/ui-exceptions.json unchanged), `node scripts/overlay-containment-lint.js --enforce` clean (0).

## 7. Device checks (Dean, on the released build; add each to DEVICE-CHECKS.md in the release commit)

1. Phone, custom controls on: pause a video, the chevron shows; play, it disappears after about 3 s with no fade; touch the picture
   while it plays (the tap pauses, as always) and it shows; play again and it goes after about 3 s. Pull down with the chevron hidden:
   it still minimizes. The same with an audio file on the watch page.
2. Is 3 s right? Say if it should be longer or shorter (one constant).
3. The v1.362.0 checks still owed (DEVICE-CHECKS.md), in particular any black picture during a pull.
4. Follow the runbook once; tell Claude where it was unclear.
5. VoiceOver (gate r1, QA suspicion, unmeasured): with VoiceOver on and a video playing, move the VoiceOver cursor to the
   chevron; does it stay while the cursor rests on it, or vanish after about 3 s?

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

## 8c. Gate record

(seats write their verdict lines here, bound to the sha they reviewed)

Gate: CHANGES r1 @3a066404 - qa

Instruments (verified, sandbox `git archive 3a066404` under /tmp, identical to its pristine copy after): `npm run lint:ui` "ui-lint: OK - the live debt equals docs/ui-exceptions.json" (TOTAL 3179; `git diff 10fe3291 3a066404 -- docs/ui-exceptions.json` empty); `node scripts/overlay-containment-lint.js --enforce` "clean (0 violations)"; eslint on the 6 changed .js files "0 errors, 6 warnings" (all 6 in common.js, the same 6 on main 10fe3291); targeted 6 files: Node 22.23.1 `# tests 155 / # pass 154 / # fail 0 / # skipped 1`, Node 24.20.0 `ℹ tests 155 / ℹ pass 154 / ℹ fail 0 / ℹ skipped 1` (the skip is ui-exceptions-ratchet's merge-base case, which has no .git in a sandbox; that file run read-only in the worktree: 3/3 pass, 0 skipped, both Nodes). Chevron (D1-D4) and landing (D5) re-derived from the code: no defect found; every v1.362.0 hide surface still hides (minimizeAllowed is the first conjunct; the peek opens only where it is allowed; the 4 resetTransientPlaybackUi callers end the window); the foreground swap-back re-runs applyControlsMode, so the sidecar has no stale chevron; the tap at the hidden chevron's spot stays a pause because the picture's touchend preventDefaults the single tap (player.js:5397), not because of timing. No security surface in the code (no route, no input, no storage); the runbook findings below include its security reading.

- WARNING docs/references/vpn-slowness-runbook.md:121-122 (and the plan's build log, line 267): the runbook says a row shows "-" when its scenario was not done, "the warm half of the last row needs Warm reload -> Home". That is wrong for that row: diag-page.js:199/247 builds coldWarm when EITHER half exists and prints `Math.round(warm || 0)`, so a run with no warm reload reads "N ms cold / 0 ms warm". The builder's own proof shows it: tools/vpn-runbook-proof/probe-diag-result.json:232 "80 ms cold / 0 ms warm". Scenario: Dean skips or mis-tags Warm reload on the VPN run, sees "2400 ms cold / 0 ms warm", and reads it as "a reload is instant, caching is fine". Fix: say a missing half reads "0 ms" (not "-"), so 0 ms warm means "not run".
- WARNING docs/DEVICE-CHECKS.md:23 (the v1.362.0 chevron check, open, unchanged by this diff, and not on 8b's list): "Tap the down-chevron at the picture's top-left: same end state ... still playing". After v1.362.1 a playing video's chevron is hidden. If Dean taps where it was, the tap pauses the video (probe-peek-result.json "chevron-spot tap +600 ms": paused true, state full), and he fails a check that is now working as designed, or minimizes a paused video. Fix (now or in the release commit): "while it shows (paused, or within about 3 s of pressing play)".
- SUGGESTION vpn-slowness-runbook.md:67-76 (stale app tabs): perf-collector.js reads the armed run ONCE per document (line 38) and writes its WHOLE in-memory buffer back to `ft_diag_events` on every event (lines 43, 69). It never notices a stop or a new arm. Step 4 opens a new app tab on every run, so run 1's tab is still open during run 2. Scenario: during run 2, Dean switches to the old tab (tabs look identical) or it wakes and fires a poll. Its flush overwrites run 2's events with run 1's buffer plus the new event, which silently corrupts the comparison. One line fixes it: "close the FileTube tabs from the previous run before you arm the next".
- SUGGESTION vpn-slowness-runbook.md:77-78, 119: a scenario's Wall is first-to-last event while it is active (diag-page.js:185), and the app polls (common.js HANDOFF_POLL_MS 30000, NOTIF_BADGE_POLL_MS 60000). Lingering in the app tab after a scenario stretches Wall, "Cold vs warm Home" and the fan-out's ms, and adds poll requests to API reqs. Scenario: Dean reads a news card for 40 s after Home loads, and cold Home reads 40 000 ms. Say "switch back to /diag as soon as the step is done".
- SUGGESTION vpn-slowness-runbook.md:34-37 with 151-153: lib/diag/routes.js gates `/diag` AND `/api/diag/runs/<id>` on the switch (404 while off). The runbook says to switch it off "when you are done" and offers the API URL as a way to send runs. Once the switch is off, both 404 (the files stay on disk). Add "while the switch is on" to line 152.
- SUGGESTION (security reading of the runbook) vpn-slowness-runbook.md:148-153: switching the suite off afterwards is correctly advised. But a run file carries the phone's user agent and the server's host:port (diag-page.js:40-41 `ua`, `host`), the free-text note (the VPN server), and every request path WITH its query string (perf-collector.js:88: search terms, item ids). Say so in one line so Dean shares the files only with Claude, never in a public issue.
- SUGGESTION test/unit/minimize-player.test.js:880: the title claims "the timer never re-shows it after a dock, a close or a new item", but the test never closes. Close is covered only by the reset call (player.js close() -> resetTransientPlaybackUi), and a detached host is not allowed anyway, so this is not observable. Drop "a close" from the title, or add the close drive (LESSONS 12: a test title is a claim).
- SUGGESTION player.js:5383-5389 (PRE-EXISTING, not this diff): the comment says "`#media-player` (no `onSingleTap`) never reaches this branch". That has been false since v1.134 (player.js:8404 wires `videoSingleTapOrReveal`), and that very branch's preventDefault is why a tap that reveals the chevron can never click it (the W1 claim). Worth correcting while the claim is load-bearing.
- Suspicion only (device): VoiceOver. The focus conjunct reads `document.activeElement`, and the VoiceOver cursor need not move it. So a VoiceOver user parked on the chevron while playing may lose it when the 3 s window ends. Only Dean's device can confirm. I could not build a jsdom scenario for it.

Gate: CHANGES r1 @3a066404 - adversary

Instruments (verified; `git archive 3a066404` sandbox /tmp/adv-v13621-sb plus a base 10fe3291 archive, both identical to pristine after, `diff -r` clean). Targeted 5 files (minimize-player, router-helpers, hold-lock, player-overlay-no-filter, oneoff-minimize-chip-refresh), Node 22.23.1: `# tests 166 / # pass 166 / # fail 0`. minimize-player.test.js 8 copies in parallel on 6 cores, Node 24.20.0: 8 x `ℹ tests 52 / ℹ pass 52 / ℹ fail 0` (the real-time peek drives did not flake under load). `npm run lint`: 0 errors, 6 warnings, the same as base. lint:ui: OK. overlay-containment: clean (0). Re-ran probe-cap.js on the sandbox: the same rows as the build log (navIndex 34 at depth 46, so the index branch decides; then `/` docked; Home works after it).

- WARNING (gesture disjointness, stop rule (c), the brief's surface 3): a double-tap to skip back at the hidden chevron's spot now minimizes the player AND pauses it. Repro, real Chromium (iPhone 13, raw CDP touch, custom controls, the probe-peek.js harness): clip1 playing at 33.6 s, 3.6 s after play, so the chevron is hidden. Tap (26, 98), wait 120 ms, tap (26, 98) again. Branch: +100 ms `state docked, path /`; +800 ms `paused: true`. Base 10fe3291, the same taps (the chevron is visible there): docked, `paused: false`. Control, the same double-tap at the left middle (40, 182): skipped back to 19.65 s and stayed full, on both trees. Mechanism: the first tap's touchstart unhides the chevron under the finger, so the second touch's target is the chevron and its click runs minimizeToDock. Then the first tap's debounced single-tap (scheduleArtSingleTap, 350 ms) fires on the DOCKED player and pauses it. dock() -> resetTransientPlaybackUi does not cancelPendingArtTap. The user sees no chevron, double-taps the top-left corner of the left half to skip back, and gets a minimize plus a pause. Neither is a double-tap. The same holds for the skip chain (each chain tap lands on the now-visible chevron). Fix options for the Architect: swallow a chevron click whose chevron was revealed by a picture touch less than DOUBLE_TAP_MS ago, or treat it as the double-tap's second half. Separately, cancel the pending single tap in resetTransientPlaybackUi (or dock). Bind it with a drive: playing, window closed, two touches at the chevron's spot 120 ms apart -> still full, no leave, no pause. Holds at the same spot are fine (branch: 2x while held, 1x after, still full).
- WARNING (runbook, LESSONS 1/12; I agree with qa's first WARNING and measured it independently): docs/references/vpn-slowness-runbook.md says a missing warm reload reads "-". The real page prints "0 ms warm". My Chromium run (FT_DIAG=1, cold-load-home only) showed `Cold vs warm Home | 60008 ms cold / 0 ms warm`, and the builder's own probe-diag-result.json:232 shows "80 ms cold / 0 ms warm". The same run also measured the span problem qa raised: with the app tab left open on Home and cold-load-home active for 65 s, the 30 s /api/handoff poll (at 30112 ms and 60110 ms) was tagged into the scenario. Wall, "Nav fan-out" and cold all read 60008 ms, and fan-out read 32 API reqs instead of the 28 to 29 of an immediate switch. In headless Chromium both tabs stay visible. On an iPhone the poll is visible-tab only (common.js init), so this happens only if Dean lingers 30 s or more in the app tab. That part is reasoned, not device-measured. Fix: as qa prescribes (a missing half reads 0 ms; switch back as soon as the step is done; or tap "Clear active scenario").
- SUGGESTION (enumeration of the wire, a surviving mutant): A14 `nav.currentEntry.index + 1` in leaveWatchForBrowse SURVIVED (166/166). An over-counting wire would re-open the exact v1.362 silent no-op (go(-n) one past the reachable entries). The pure function's boundary is bound (`r(46,0,50,45)` home), but the leave-level test only uses index 34 and 46 at depth 46. Add index 45 at depth 46 -> Home to the real leaveWatchForBrowse drive.
- SUGGESTION (the build log's D4 claim is SOURCE-locked only; could not be reached in Chromium here): the background-audio sidecar needs an extracted audio rendition, and FFmpeg is absent on this box. Reasoned, not run: activeMediaElement() returns the sidecar only in HANDING_OFF / BACKGROUND_AUDIO. Those are entered only from the background lifecycle (hidden page, or the iOS pre-pause candidate consumed by visibilitychangeHidden). handleForegroundSwapBack resets the state BEFORE mediaPlayer.play(), and rearmNativeControls -> applyControlsMode refreshes after. So a visible page never reads the sidecar, and the sidecar's own play/pause having no listener is unobservable. "Should work", not verified.
- Third-party API (surface 4), read, not re-fetched (no network tool in this seat): the build log's quote has the shape of the WHATWG text. Its reading holds against the measurement: Chromium navIndex 1 at depth 1 (history.length 3, the about:blank entry excluded), 49 at the cap, 34 after 15 backs. The app builds no iframes (grep: none in public/), so joint-history steps equal top-level entries, and go(-n) with n <= index lands. Safari without `navigation` keeps the length rule (bound by the test's `navigation: undefined` and `currentEntry: null` worlds).
- LESSONS 7 / one writer (surface 1): verified in the diff. The only chevron write is `minimizeBtn.hidden =` in refreshMinimizeButton, and the CSS change is a comment only. Reveal/clear (surface 2), Chromium: after tapping the visible chevron, `document.activeElement` is BODY, and after expanding and playing, hidden at +3.7 s, so focus does not latch. No sibling of the 39ee4a7b clock re-read: the only clock read left is the decision's `now < until`, and every path that ends a window zeroes peekUntil.
- Mutants (Node 22, 5 files): A1 peek body no-op KILLED (6), A2 no clear of the old timer on re-peek KILLED (`every touch re-arms`), A3 endMinimizePeek keeps peekUntil KILLED (`the timer never re-shows it after a dock`), A4 endMinimizePeek keeps the timer SURVIVED (equivalent: the stale id stays in minimizePeekTimer, so the next peek clears it, and its firing only zeroes an already-zero peekUntil), A5 `<` to `<=` KILLED, A6 timer x10 KILLED (5), A7 the pre-fix clock re-read (F1-M1) KILLED (`D3: the window ends when its timer fires`), A8 peek where not allowed (W1-M8) KILLED, A9 no pause refresh KILLED, A10 play refreshes instead of peeking KILLED (3), A11 leavepictureinpicture dropped KILLED (`D6 (b)`), A12 no blur refresh KILLED, A13 peek moved after the hold timer SURVIVED (equivalent: order only), A14 index+1 SURVIVED (above), A15 index-1 KILLED (`D5: the real leaveWatchForBrowse`), A16 focused always false KILLED, A17 no element counts as playing KILLED (D2 source lock), A18 no endMinimizePeek in resetTransientPlaybackUi KILLED.
- Security brief: no new route, input, storage or dependency. The router only reads `navigation.currentEntry.index`. The runbook's `/api/diag/runs/<id>` is behind requireAdmin plus the switch (lib/diag/routes.js gate). I agree with qa's privacy note about the run files (UA, host, query strings).

Round 1 fixes (builder, 2026-10-04):
- Adversary WARNING (double-tap at the hidden chevron's spot minimized and then paused): while the picture can still pair a tap
  (from each picture touchstart and each single-tap lift, DOUBLE_TAP_MS 350; through a skip chain, SKIP_CHAIN_MS 800) the chevron
  carries `inert` (an attribute written by refreshMinimizeButton, the one writer; not paint), so the next tap at its spot reaches
  the picture; the guard's timer ends the guard (never re-reads the clock). And `resetTransientPlaybackUi` now cancels a pending
  single tap, so a tap followed by a dock inside 350 ms never pauses the docked player. Chromium (probe-peek.js, re-run): the
  chevron is inert 120 ms after the first tap; the double-tap at (26, 98) skips back 23.6 -> 8.9 s, state full, playing; a chain
  tap there skips again (to 0.9 s), full, playing; a deliberate tap on the SHOWN chevron (paused, no guard) still minimizes to
  `/`. jsdom: the guard's reveal and its clear, the chain extension, the pending tap dying with a dock.
- Both seats' runbook WARNING (the warm half prints 0 ms, not "-"): the runbook says so plainly; the build log line corrected.
- QA WARNING (DEVICE-CHECKS.md v1.362.0 chevron line): reworded to say when the chevron shows.
- QA suggestions: the runbook now says to close the previous run's FileTube tab before arming and to close this run's tab
  before Stop & save (an open tab can write its old buffer over a run, perf-collector.js flush), to switch back to /diag at
  once (background checks stretch a scenario's span), that the API route needs the switch on (the files stay), and to keep the
  run files private (user agent, server address, note, every request path). The D1/D3 test title no longer claims a close.
  The stale player.js comment ("`#media-player` (no `onSingleTap`) never reaches this branch", false since v1.134) now states
  the real reason a video tap synthesizes no click. VoiceOver suspicion: added to section 7 as device check 5 (unmeasured).
- Adversary suggestion A14 (an index over-counted by one survived): a drive at depth 46 with 45 reachable -> Home.
- Round 1 fix mutants (on 7a035bd2, sandbox identical after; minimize-player + router-helpers + hold-lock +
  player-overlay-no-filter, 154 tests, Node 22): R1-M1 no guard at the picture touchstart KILLED (`while the picture can still
  pair a tap`); R1-M3 no guard through the chain KILLED (`keeps the chevron inert for the whole skip chain`); R1-M4 inert never
  written KILLED (3); R1-M5 the guard timer never ends the guard KILLED (2); R1-M6 no pending-tap cancel KILLED (`a single tap
  still waiting out the double-tap window never pauses the player after a dock`); R1-M7 the A14 over-count KILLED (`an index that
  over-counts by one`); R1-M8 inert always false KILLED (2). **R1-M2 (no guard from the single-tap lift) SURVIVED** (154/154:
  the touchstart guard masked it in an instant tap); bound by `the pairing window runs from the LIFT` (a 300 ms press), then
  KILLED by that name (`# tests 57 / # pass 56 / # fail 1`; the committed product code with the new test file copied into the
  sandbox and its pristine twin).

## 9. Out of scope (logged, not built)

- Any new performance instrument, compression, caching, adaptive bitrate, a quality or data-saver setting (they are the runbook's
  possible OUTCOMES; Dean picks after he has numbers). The v1.362 gate r1 leftovers (the curl-right swipe-back, a Settings toggle for
  `?minimizeAnim`). Making a tap reveal controls without pausing (it would change the tap gesture).
