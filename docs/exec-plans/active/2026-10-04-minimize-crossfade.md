---
plan: minimize-crossfade
harness: v2 · lean
branch: feat/v1.362.4-minimize-fade
anchor: spec
status: Building
next: dual-Node on b83b2822, then gate r2 (the same seats)
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

- Dual-Node full `npm test` on 79e3cc56: Node 22.23.1 `# tests 10988 / # pass 10976 / # fail 0 / # skipped 12`; Node 24.20.0
  `ℹ tests 10988 / ℹ pass 10976 / ℹ fail 0 / ℹ skipped 12`.
- Gate r1 CHANGES @79e3cc56 (qa, adversary; section 7). Round 1 fixes (b83b2822, hook `ℹ tests 8567 / ℹ pass 8567 / ℹ fail 0`):
  clearMinimizeDrag clears unless THIS page is leaving; the page an expand leaves is cleaned when it is swapped out (a
  MutationObserver on #view-root's parent) and on a back; the expand marks first, then dims; the CSS census now runs
  `element.matches()` for every opacity / animation rule on the real watch markup with the real host mounted, under four fade
  states, with a positive control; drives for reduced motion mid-pull, a wide coarse tablet, a narrow fine window, the full
  arrival selector; the seek-then-wait drive in player-black-picture-log ticks its clock again. Fix mutants (14, sandbox of
  b83b2822, clean): all KILLED, including the adversary's census survivors A-M1/A-M2/A-M3/A-M6 and A-M4/A-M5/A-M7/A-M8/A-M16.
- Disclosed (adversary r1 S7): the 4 s arrival mark also fades a page reached by another navigation inside the window; a TV
  episode (a readerHref return) fades on minimize but not on expand; WebKit was not available to either seat (Playwright's
  webkit build is not installed), so the iPhone check stands.

## 6. Device checks

- [ ] v1.362.4 - iPhone, custom controls ON, a video playing inline: pull it down slowly: the title, buttons and comments under it
  dim as you pull; let go early: they come back. Pull past a third (or tap the arrow): the page you came from fades in as the mini
  player lands. Tap the mini player: the page dims and the watch page fades back in under the picture. Same in light mode (it
  fades toward white). The picture itself never dims or goes black.

## 7. Gate record

Gate: CHANGES r1 @79e3cc56 - qa

1. WARNING - test/unit/player-black-picture-log.test.js:184 ("a skip that waits on the network ... never logs video:frozen"): the
   manual clock made this drive vacuous. Its six flat samples no longer advance the wall clock, so wallMs stays 0 and no freeze can
   ever be logged, whatever the decision does. Mutant `if (dt > 0 && dt <= dw * FROZEN_MAX_RATE)` -> `if (dt > 0)` (/tmp archive
   sandbox): base 471c15e7 `not ok` (killed); 79e3cc56 `# pass 1 / # fail 0` (survives; only the pure frozenPictureDecision test
   kills it, so the wiring bind through the real waiting path is gone). Fix, verified in the sandbox: `for (...) { h.tick(1000);
   await wait(SAMPLE_MS); }` -> mutant `# fail 1`, pristine `# pass 1`. Other drives checked: the series-cleared-on-load test
   still kills a no-clear mutant (`frozenSamples = []` removed: `# fail 1`).
2. WARNING - player.js dock click + endViewFade: expand, then back within the 4 s hold. The tap gives the home node
   `is-view-leaving`; the router caches it (swapToView) and restoreHomeFromCache re-inserts the SAME node; nothing removes the
   class before the timer, so home shows at opacity 0.4 for the rest of the 4 s (and its arrival animation is suppressed by
   `:not(.is-view-leaving)`). jsdom drive (router swap simulated, real dock tap + p.expand): `QA-A home is-view-leaving after
   back: true html mark: arrive`. Scenario: a mistaken tap on the mini player, iOS edge-swipe back at once. The build log's
   "the cached home node is re-inserted later" assumes later than 4 s. Suggested fix (sandbox-verified, all 12 crossfade tests
   green): in expand(), `if (viewFadeMarked && !viewFadeMarked.isConnected) viewFadeMarked.classList.remove('is-view-leaving')`
   (a back before the watch page's expand stays dimmed until the timer: say so or cover it).
3. WARNING - player.js clearMinimizeDrag `if (!viewFadeMarked) clearMinimizeFade()`: the guard means "any mark is live", not "THIS
   page is leaving". Within 4 s of an expand (viewFadeMarked = the cached home node), a pull on the watch page that ends through
   clearMinimizeDrag without a snap (orientationchange/resize while claimed, a new load, close) leaves the watch content dimmed
   at 1 - 0.6p permanently (the timer cleans only the home node). Drive: `QA-B after rotate: fade= "0.1777..." fading class true
   host transform ""`, unchanged after the hold. Same false premise in the snapMinimizeDrag comment ("clearMinimizeDrag ...
   removes the fade"). Fix (sandbox-verified, F-M4 drive still green): `if (viewFadeMarked !== watchViewRoot()) clearMinimizeFade()`.
4. SUGGESTION - minimize-crossfade.test.js census: the subject check catches only named ancestors; a universal or type subject
   (`.watch-main > * { opacity: .5 }`, `.watch-main > div`) fades the stage and passes. Add a negative for `*`/type subjects under
   `.watch-main` / `.watch-player-stage`'s parents, or a jsdom-free check that every crossfade subject carries `:not(:has(#player-slot))`.
5. SUGGESTION - comments: markViewArrival "(`root` already dimmed by the caller)" is false on the minimize path (the arrow's root
   is at full when marked; setMinimizeFade(1) runs after dock()); the block header "restores whatever never left" also restores
   a node that left (the expand's home). Plan frontmatter `next:` still says the full npm test is pending.

Verified clean: crossfade 12/12, black-picture + overlay-no-filter + ambient-glow 85/85, lint:ui OK (unchanged), containment 0,
eslint 0, check-markers 12 issues = the same 12 at base (none in this plan), no em dashes added, DEVICE-CHECKS 38 lines match
ROADMAP 1-38 in order (+39 VPN). Security: no new surface (class/custom-property toggles on existing nodes, no input parsed,
the probe tool is local-only like its siblings).

Gate: CHANGES r1 @79e3cc56 - adversary

Sandbox: `git archive 79e3cc56` in /tmp/adv-v13624 (pristine copy beside it), every mutant exact-once, restored, `diff -rq`
against pristine clean except my three probe scripts (sandbox only). Chromium probes = the builder's serve.js shape, iPhone 13.

1. WARNING (independent of qa 3, measured in real Chromium) - for up to 4 s after an expand, a pull on the watch page that ends
   through clearMinimizeDrag (a resize/rotate while claimed, a new load, a backgrounding) leaves the watch content dimmed FOR
   GOOD. `adv-probe.js`: expand, pull 120 px, `resize` mid-pull: `B_midPull title 0.809524` -> 6 s later `B_6sLater title
   0.809524, cls "is-minimize-fading", mark null`, root style `--minimize-fade: 0.31746...`. jsdom: `ADV-1 mid=0.222
   after="0.222" cls=is-minimize-fading mark=null`. Cause: `if (!viewFadeMarked)` reads "any mark", not "this page is
   leaving". qa's `viewFadeMarked !== watchViewRoot()` is right by reading; bind it with this drive.
2. WARNING (independent of qa 2, measured in real Chromium) - expand, then back at +900 ms: the cached home node comes back
   at 0.4 and sits there 3.1 s. Series `[8106,"home","is-view-leaving",0.4,"docked"]` -> `[11207,"home","",1]`. Clear the
   class from the marked node once it is no longer the live #view-root (qa's expand() hook is one place; bind with a drive).
3. WARNING (confirms qa 1) - player-black-picture-log.test.js:184 is vacuous under the manual clock. Mutant `if (dt > 0 && dt
   <= dw * FROZEN_MAX_RATE)` -> `if (dt > 0)`: base 471c15e7 `not ok 3` + `not ok 7` (the drive); 79e3cc56 only `not ok 3`
   (pure). My other harness mutants all KILL at 79e3cc56 (runs ignored, MIN_WALL 2500 and 3600, pause takes no reading, stop
   keeps the series, MAX_RATE 1000, wall constant 0, MIN_MEDIA 2.7); 4 concurrent runs `# pass 42 # fail 0` each.
4. WARNING (qa rated this SUGGESTION; I block on it) - the LESSONS 7 guard does not bind the shipped ARRIVAL rule. A-M6: the
   arrive selector's `.watch-main > :not(:has(#player-slot))` -> `.watch-main > *` animates `.watch-player-stage`, the video's
   ancestor, from 0.4: crossfade + ambient-glow-engine `pass=40 fail=0` SURVIVED (the census's subject is `*`, the literal
   lock covers only the first two rule blocks). Added rules also survive crossfade + ambient + overlay-no-filter (43/43): A-M1
   `...is-minimize-fading .watch-main > div { opacity: .5 }`, A-M2 `html[...arrive] .watch-container > * { animation }`, A-M3
   `html[...arrive] #main-content { animation }`. The LESSONS-rules section 7 line ("a CSS census ... fails on the host or any
   ancestor") states a guard that is not there. Fix: lock the arrive block literally, and make the census structural (any
   opacity/animation rule under `.watch-main >`/`.watch-container >` must carry `:not(:has(#player-slot))`; a `*` or type
   subject there fails; `#main-content`, `main`, `.app-container`, `body`, `html` join the ancestor list).
5. SUGGESTION - a second tap on the mini player while the first navigation is pending (Dean's slow VPN) UN-dims the page:
   add, then markViewArrival -> endViewFade strips the class it just added. jsdom: `ADV-2 navs=2 first=true
   afterSecond=false`. Mark first, then add the class.
6. SUGGESTION - survivors against the plan's "every gate refuses" (W2): A-M16 the pull ignores minimizeFadeEnabled (reduced
   motion still dims mid-pull; the test checks only after the commit); A-M7 / A-M8 the expand's isMobileFormFactor and
   narrow checks each removable (the desktop case negates both at once; a mobile-wide tablet case is missing); A-M4 / A-M5 the
   arrive selectors' `:not(.is-view-leaving)` / `:not(.is-minimize-fading)` removable (12/12); A-M9 the dock-failure
   endViewFade removable; A-M10, A-M13, A-M17 removable (belts behind the CSS). A-M12 (no clamp) is a dead guard (the
   transform already clamps p). KILLED: A-M11, A-M14, A-M15, F-M4, F-M13, the clearMinimizeDrag guard dropped, never-clears.
7. SUGGESTION - the 4 s arrival mark applies to ANY navigation in the window (a related video tapped within 4 s fades in
   from 0.4 too); a TV episode (readerHref /watch.html?tv=) fades on minimize but not on expand. Disclose or end the mark at
   the first arrival. Concur with qa 5 on the comments (markViewArrival "already dimmed", snapMinimizeDrag's "removes the fade").

Verified clean: crossfade 12/12; ambient-glow + overlay-no-filter + black-picture `# tests 73 # pass 73 # fail 0`; lint:ui OK
(unchanged); overlay-containment 0; eslint exit 0 on the four changed js files. LESSONS 7 in Chromium: every ancestor of
#player-wrapper min opacity 1 over 1308 frames (commit, expand, back, pull, resize); the `:has()` guard binds per style recalc
(non-watch root holding the host under the arrive mark: opacity 1, animation none; host moved out: 0.69 `ft-view-arrive`;
host adopted back in the same task: 1, none, ancestors 1 for 20 frames; is-view-leaving with the host: 1); stage 1 /
title 0.4 / sidebar 0.4 at `--minimize-fade: 1`; mid-pull the moving host is ABOVE the faded title and meta
(elementsFromPoint hostIdx 0 vs 3 and 2). INSTRUMENT GAP: Playwright WebKit is not installed (`Executable doesn't exist at
.../webkit-2336`), so nothing here is WebKit-verified; the device check stands. DEVICE-CHECKS 38 open lines == ROADMAP 1-38
in order, +39 VPN. Security: no new surface (class and custom-property toggles on existing nodes, no input parsed; probes local).
