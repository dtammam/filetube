---
plan: minimize-crossfade
harness: v2 · lean
branch: feat/v1.362.4-minimize-fade
anchor: spec
status: Building
next: the dual-Node full npm test, then the gate (adversary + qa)
design: Dean's rulings F1-F3, 2026-10-04 (kickoff at main 471c15e7), from his YouTube screen recording.
gate: pending
---

# v1.362.4: the page under the video fades like YouTube's when it minimizes and expands

Kickoff 2026-10-04 by the builder at main 471c15e7 (v1.362.3 shipped, PR #87). Dean: "I'd love to get to have the video
comments/section under fade like YouTube does", with a 9.6 s screen recording of the YouTube app (1180x2556, 60 fps). His other
report that day (the minimize chevron "doesn't disappear") was withdrawn after a test: it shows while paused, by design.

## 1. The reference, measured (ffmpeg signalstats YAVG of the area under the video, y 1300-2000 of 2556, 60 fps)

- Minimize (0.40-0.85 s): the watch content under the video dims from 32 to about 19 within ~150 ms while the picture starts to
  shrink, then the feed behind it brightens to its own level (35) over the next ~300 ms: a crossfade of ~0.4 s through ~60 %.
- Expand (1.97-2.20 s): the feed dims (35 -> 19) and the watch content comes back (32) in ~0.23 s.
- The header and the bottom nav never fade; only the page content does.

## 2. Rulings

| # | Question | Ruling |
|---|---|---|
| F1 | Fade toward (**Dean**, "The page background (Recommended)") | Opacity on the page content, so it fades toward the page's own background: dark in dark mode (as in the recording), light in light mode. Floor 0.4 (the recording's ~60 % dip). |
| F2 | Which moments (**Dean**, "Pull, arrow and expand (Recommended)") | Phone only, where minimize exists (minimizeAllowed's mobile + narrow). The pull: the content under the video follows the finger, opacity 1 - 0.6 x progress. The commit (pull or arrow): it holds at 0.4 while the page leaves; the page you land on fades in from 0.4 (--dur-sheet, ease-enter). The expand (a tap on the mini player for a video): the current page dims to 0.4 (--dur-fade) and the watch page's content fades in from 0.4. A spring-back returns to 1 (--dur-fade). |
| F3 | Off switches (**builder**, the existing pattern) | `prefers-reduced-motion` and `?minimizeAnim=0` turn the fade off with the moving picture (minimizeAnimEnabled, minimizeReducedMotion). |

## 3. The constraint (LESSONS 7, the v1.312 class): nothing fades an ancestor of the video

The persistent host (`#player-wrapper`, the `<video>`) is reparented into `#player-slot` inside `.watch-player-stage` inside
`.watch-main` inside `#view-root`. So opacity is NEVER set on `#view-root[data-view="watch"]`, `.watch-container`, `.watch-main` or
`.watch-player-stage`: on the watch page the fade goes on the SIBLINGS of the stage (`.watch-main > :not(:has(#player-slot))`)
and on `.watch-sidebar`. On another page the whole `#view-root` fades only while it does not contain the player
(`:not(:has(#player-wrapper))`: music, shows and podcasts can mount the host in their own root). While docked the host is in
`#player-dock`, outside `#view-root`. Plain opacity only: no filter, mask, backdrop or blend (player-overlay-no-filter.test.js).

## 4. Waves

- **W1:** style.css (the sibling rules keyed on `--minimize-fade` and the classes `is-minimize-fade-ease` / `is-minimize-leaving`
  / `is-view-leaving`, the arrival keyframes under `html[data-ft-view-fade="arrive"]`), player.js (followMinimizeDrag sets the
  progress; snap and clear restore; minimizeToDock marks the leave and the arrival; the dock click marks the expand; one timer
  clears the mark and restores a page that never left).
- **W2:** jsdom drives through the real pull, the arrow and the mini-player tap; every gate (reduced motion, `?minimizeAnim=0`,
  desktop, a non-video dock return) refuses; CSS locks: the exact selectors, no opacity rule on any ancestor of `#player-slot`,
  tokens for every duration and easing; a Chromium measurement of the same area's brightness through a pull, a commit and an
  expand, against section 1.
- **W3:** DEVICE-CHECKS, ROADMAP (Planned entry closed, Shipped), the ledger, LESSONS if a lesson lands.

## 5. Build log

- W1 deviation from section 2's names: the watch page's leave needs no extra class: the commit holds `--minimize-fade` at 1
  (eased) on the root; `is-minimize-leaving` was dropped. The leave is marked BEFORE `dock()`, whose `clearMinimizeDrag` would
  otherwise flash the page back to full; `clearMinimizeDrag` clears the fade unless a page is leaving. The timer clears
  `is-view-leaving` from the node it marked (the cached home node is re-inserted later and must come back clean).
- Tests (`test/unit/minimize-crossfade.test.js`, 10): `# tests 10 / # pass 10 / # fail 0`; the neighbouring player, minimize,
  watch, overlay, policy, token and style suites `# tests 1348 / # pass 1348 / # fail 0`; `npm run lint:ui` OK (unchanged);
  overlay containment 0; eslint 0 errors.
- Chromium (`tools/minimize-proof/probe-fade.js`, iPhone 13, dark mode, raw CDP touch; result `probe-fade-result.json`): mid-pull
  the title under the video read opacity 0.81 at ~120 px, falling evenly to the 0.4 floor at the commit; a spring-back returned
  it to 1. Commit: held at 0.4, then home arrived 0.60 -> 0.81 -> 0.90 -> 0.96 -> 1.0 in ~300 ms (the recording's ~0.4 s
  crossfade). Expand (the watch page held 500 ms, a slow network): home dimmed 1 -> 0.72 -> 0.49 -> 0.42 -> 0.4 in ~180 ms and
  held; the watch content then rose 0.4 -> 1 in ~300 ms. On a fast local network the swap lands ~20 ms after the tap, before the
  dim shows (the arrival fade still runs). The minimum opacity over every ancestor of `#player-wrapper`, every frame: **1**.
- First commit attempt REFUSED by the hook, verbatim: `✖ v1.312 CSS LOCK: NO rule reaching the glow OR the player stage carries
  a filter / transform / mask / backdrop-filter / will-change (the second iOS suspect)` (ambient-glow-engine.test.js:731: its
  sweep keeps every rule whose selector NAMES `.watch-player-stage` free of `animation`, and mine named it inside `:not()`).
  Complied, lock untouched: the sibling selector excludes the stage by content, `.watch-main > :not(:has(#player-slot))` (the
  same elements). Re-measured in Chromium: identical (mid-pull 0.81, floor 0.4, arrival and expand as above, ancestors 1).
- Second attempt REFUSED, verbatim: `ℹ tests 8559 / ℹ pass 8558 / ℹ fail 1`, `✖ I1.1: the series is cleared on a new load (a
  frozen count never spans two items)` (player-black-picture-log.test.js, v1.362.3, not touched by this change). Standalone: 0/15
  on this branch, 0/15 on main 471c15e7. Mechanism found in that harness: the player's clock ran at 50x real time, so a timer
  firing late under load adds whole wall "seconds" and two short rounds can cross the 3 s threshold. Fixed: a MANUAL clock
  (run() advances exactly 1 s per sample; drives that need time say h.tick(ms)). Under six CPU-burning processes: the new harness
  0/5 failed; the old one also 0/5 (the failure did not reproduce on demand: the fix removes the mechanism, it is not proven
  against a reproduction).

- Commit 34db46a6, hook `ℹ tests 8559 / ℹ pass 8559 / ℹ fail 0`.
- Mutants (16, /tmp `git archive 34db46a6` sandbox, exact-once, restored, diff clean): 14 KILLED first run. SURVIVED: F-M4 (the
  leave marked after `dock()`: a transient flash the end state hides) and F-M13 (the expand's root-holds-the-player belt, behind
  the CSS guard). New drives (a MutationObserver over every style state of the commit; a root that holds the dock) KILL both.
- W3: DEVICE-CHECKS (38 open lines), ROADMAP "Device checks owed" item 16 (VPN results now 39), LESSONS-rules sections 2, 3, 7.

## 6. Device checks

- [ ] v1.362.4 - iPhone, custom controls ON, a video playing inline: pull it down slowly: the title, buttons and comments under it
  dim as you pull; let go early: they come back. Pull past a third (or tap the arrow): the page you came from fades in as the mini
  player lands. Tap the mini player: the page dims and the watch page fades back in under the picture. Same in light mode (it
  fades toward white). The picture itself never dims or goes black.

## 7. Gate record
