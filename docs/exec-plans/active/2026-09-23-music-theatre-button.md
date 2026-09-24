---
plan: music-theatre-button
harness: v2 · lean
branch: fix/music-theatre-button
anchor: spec
status: Building
next: the orchestrator gates this branch (adversary floor + qa per scrutiny.toml); then Dean's device check (desktop /music: play a track, the popcorn button in the control bar flips the album beside the player; resize below 1024px and it is gone; /watch theatre unchanged; a watch -> music -> watch trip toggles the right layout on each page)
design: Approved 2026-09-23 @6ea45237 (Dean's GO on D15, recorded on feat/music-channel-chapters at 10c3be1e)
gate: pending
---

# T1: the music view's theatre button is the player's own

Dean (2026-09-23): "the player has a built-in theatre mode button but it doesn't work.
There's one higher. Idk why we are not using the standard one. It doesn't always show."

Base: main 6ea45237 (v1.316.0). Wave umbrella (register D1-D15, intake record, survey anchors
at v1.314.0): the plan 2026-09-23-music-channel-chapters-wave.md under docs/exec-plans/active on
the branch feat/music-channel-chapters (not on this branch, so no backtick path here: the docs
link census resolves those against this tree). This doc carries T1 only and its bound markers
(one piece, one plan). It also takes one owed one-liner from the v1.316.0 gate (the chip census
ROLES add).

## Decision (D15, Dean's GO)

ONE theatre control in the music view = the in-player standard button (`#theater-btn`, the
era-style popcorn `.pc-btn` before the cog). music.js injects the same button into the
persistent control bar when absent, through ONE shared writer (so watch.js and music.js never
carry two copies of the SVG), and binds it on the music view's own abort signal to the existing
music theatre toggle (`applyTheater` / `THEATER_KEY 'ft-music-theater'` / `.is-theater` on
`#music-stage`, persisted as today). The toolbar duplicate `#music-theater-btn` is removed.
Below the desktop breakpoint the in-player button is hidden (theatre has no meaning there),
never visible-but-inert. The watch page's wiring is unchanged (its own binding via its own
signal; the id-guard means whichever view injects first wins and the other reuses).

## Root cause (re-verified at 6ea45237 by reading, not theorised)

- `public/js/watch.js:2350` `ensureCogControlsInjected()` built `#theater-btn` (class
  `pc-btn theater-btn`, the popcorn SVG) with `cog.insertAdjacentHTML('beforebegin', ...)`
  (:2359-2373) into `#player-controls` - which lives in the shell's
  `<template id="player-host-template">` (music.html:285-353; `#player-controls` at :316),
  cloned ONCE by player.js `ensureHost()` (player.js:2483) on the first `load()` and then
  reparented between `#player-slot` and `#player-dock` for the life of the page. The host is
  parity-locked byte-identical across the shells, so the button cannot be static.
- `watch.js:2405` `setupTheatreToggle()` bound the click with `{ signal }` = the WATCH view's
  AbortController (:2426-2440). The router aborts it on every navigation away.
- Consequences: after any watch visit + a soft-nav into Music, the popcorn button rode along in
  the persistent host but its listener was dead ("doesn't work"); on a cold-load of /music the
  button did not exist at all, and the working control was the toolbar duplicate
  `#music-theater-btn` (music.html:119, `.btn.btn-sm.music-theater-btn`, born `hidden`,
  desktop-only via `@media (max-width: 1023px) { .music-theater-btn { display: none } }`
  style.css:10900, revealed only while a track is expanded by music.js:1497/:1509/:1510) -
  together the "doesn't always show".
- music.js:759 queried `#music-theater-btn`; :774-787 held `THEATER_KEY`, `theaterOn`,
  `applyTheater` and the click binding on the music signal.
- Also found while reading: `podcasts.html:120` carries its own `#podcast-theater-btn` with the
  same class and the same inline SVG, wired by podcasts.js (`is-theater` on the podcast stage,
  podcasts.js:131). OUT OF SCOPE (the podcast theatre is not Dean's ask); the shared
  `.music-theater-btn` CSS stays for it.

## Design (what shipped)

- **player.js** (ships on every shell that carries the control bar): a top-level
  `ensureTheaterButton(doc)` = the ONE writer of the markup. Id-guarded (returns the existing
  `#theater-btn`), anchors on `#player-controls` + `#settings-btn`, returns `null` while the host
  is still inside the template. Exported for tests and exposed as
  `window.FileTube.player.ensureTheaterButton()`.
- **watch.js** `ensureCogControlsInjected`: calls the shared writer instead of carrying the SVG.
  `setupTheatreToggle` and everything else on the watch page: unchanged.
- **music.js**: `theaterBtn` starts null; `bindTheaterControl()` (idempotent per init) calls the
  writer, and when a button exists stamps `aria-pressed` from `ft-music-theater` and binds the
  click on the music signal. Called at BOTH seams the host can appear at: init (a host already
  exists - docked from another view, or a re-init) and `updateNowPlayingPanel`'s expanded
  branch (the first play of a cold load, which mounts the host). `applyTheater(theaterOn())`
  still runs synchronously at init so the stage class never widen-flashes. The three
  `theaterBtn.hidden` writes are gone: the shared button is never `hidden` by music (watch
  never clears it); visibility is CSS.
- **music.html**: the toolbar `#music-theater-btn` (and its comment) removed.
- **style.css**: `body:not([data-view="watch"]):not([data-view="music"]) #theater-btn
  { display: none; }` so the injected button never shows as an inert control on a view that
  does not wire it (podcasts / shows / the reader all mount the host inline). The existing
  `@media (max-width: 1024px)` hide and `#player-dock #theater-btn` hide are byte-identical.
- **Gating in the music view**: the button simply follows the player - hidden while docked,
  hidden below 1024px, visible while a track is expanded on desktop. The old "only while a
  track is expanded" gate is implied (an expanded player IS a track).
- **The owed one-liner**: `test/unit/sub-row-chip-btn-family.test.js` ROLES gains
  `sub-row-pin-active` and `sub-row-bell-active`.

## Acceptance (each names its binding test; all in test/unit/music-theater-toggle.test.js unless noted)

- AC1 ONE writer: the popcorn glyph exists in exactly one JS file (player.js), written once; watch.js
  and music.js inject through `ensureTheaterButton`; no shell bakes `#theater-btn` in; the id
  `music-theater-btn` is gone from every shell and every script. ("ONE writer" census test;
  `watch-chrome-ambient.test.js` "ensureCogControlsInjected" test now locks the call + no copy.)
- AC2 Writer shape: injected just before the cog as `button#theater-btn.pc-btn.theater-btn`,
  `aria-pressed="false"`, evenodd tub + `matrix(1.2 0 0 1.2 -98 54)`; a second call returns the
  same node; `null` and no injection while the bar is inside the template or lacks a cog.
  ("writer" test, executed on a real DOM.)
- AC3 Reachability: the REAL player api booted in jsdom exposes `ensureTheaterButton` and it
  writes into the live document. ("reachability" test.)
- AC4 Cold-load /music: no button at init; a real row play mounts the host; the button appears
  in `#player-slot`'s control bar and each click flips `.is-theater`, `aria-pressed` and
  `ft-music-theater`; exactly one theatre control in the DOM; a second play does not
  double-inject or double-bind. ("cold-load" test.)
- AC5 Persisted ON restores `.is-theater` synchronously at init with no host, and the button
  binds with `aria-pressed="true"`. ("persisted" test.)
- AC6 watch -> music: the watch-injected button is reused (count 1), music binds exactly ONE
  click listener on a live signal, `aria-pressed` is re-stamped from the music key, the watch
  listener (aborted signal) never fires; destroy aborts the music listener (a click is inert);
  re-init binds exactly one more (no accumulation) and one click = one flip. ("watch -> music"
  test, listener registrations counted on the shared node.)
- AC7 music -> watch: music's init/destroy leaves the same node, in place before the cog, with no
  `hidden`, and the writer reuses it. ("music -> watch" test.) On the watch side (gate r1,
  adversary W1): the CALL to the one writer is bound by execution in
  `watch-init-behavioral.test.js` (a spy on the harness's player api; the hydrated video path
  and the `?tv=` path each call it exactly once, post-mount); the post-mount re-query and the
  `{ signal }` click binding in `setupTheatreToggle` stay SOURCE-locked in
  `watch-chrome-ambient.test.js` (that vm harness has no button to bind, so the click itself is
  not executed there).
- AC12 (gate r1, adversary S2) The watch init re-stamps `#theater-btn`'s `aria-pressed` from
  `ft-theater` in the same synchronous pass as the `.theater-mode` class apply, so a host
  arriving with music's aria never disagrees with the class for the hydration RTT. ("gate S2"
  test in `watch-init-behavioral.test.js`: three stored values, the write recorded
  synchronously before any await.)
- AC8 CSS: hidden below 1024px, in the dock, and on every view but watch/music; the pressed look
  keys off `aria-pressed`; the podcast toolbar button keeps its mobile hide. ("CSS" test.)
- AC9 SHELL PARITY (dynamic roster over public/*.html + lib/ytdlp/views/*.html, floors 12/11/10):
  every shell loading watch.js or music.js loads player.js; every shell with a player template
  carries `#player-controls` + `#settings-btn` inside it and loads player.js. ("SHELL PARITY"
  test.)
- AC10 Existing music theatre behaviour on a wide re-render still drives the desktop panel:
  `music-skin-integration.test.js` v1.311.3 now clicks the in-player `#theater-btn`.
- AC11 The chip census covers the `-active` modifiers: `sub-row-chip-btn-family.test.js`
  ROLES (5 entries) stays green.

## Known seams (disclosed, not fixed here)

- Breakpoint parity is off by one pixel: the watch rule hides `#theater-btn` at
  `max-width: 1024px` (watch's column layout starts there) while music's two-column stage
  starts at `min-width: 1024px`. At EXACTLY 1024px a persisted music theatre lays out with no
  visible toggle. The old toolbar button hid at 1023px. Left as is to keep the watch rule
  byte-identical (D15: "watch's wiring unchanged"); a follow-up could move music's stage
  breakpoint to 1025px alongside the all-views player cap (`@media (min-width: 1025px)`).
  Gate r1: confirmed by both seats (qa: "the disclosure is exact"; adversary S3: reachable only
  by resizing from >=1025 with ON persisted, the key is not in the synced-prefs set).
- books.html (pre-existing, out of scope; gate r1 adversary NOTE 4): it ships neither
  `#player-host-template` nor `#player-dock` yet loads watch.js + player.js, so the writer
  returns null there and the parity census's consumer arm passes it; a soft-nav
  /books -> /watch.html would hit `ensureHost()` null. Tracked as tech-debt #236 in
  `docs/exec-plans/tech-debt-tracker.md`.
- The one-RTT aria seam on watch (gate r1 adversary S2) is FIXED in the r1 fix commit: init()
  re-stamps the button's aria beside the synchronous class apply (AC12).
- The podcast view keeps its own toolbar theatre button (`#podcast-theater-btn`) with its own
  copy of the SVG in podcasts.html - the same shape Dean disliked, out of scope by intake.
- The action-row probe (`scripts/action-row-probe.js`) measures the WATCH action row only; the
  removed control was a `hidden`-by-default toolbar button in the music view, so no before/after
  geometry was taken (the music toolbar is on the unaudited list, tech-debt #184).

## Build record

- Root cause re-verified at 6ea45237 (file:line above), including that `#player-controls` is
  inside the lazily-cloned template - which is why music.js binds at the mount seam, not only at
  init.
- Targeted runs (Node 22.23.1): `node --test` over music-theater-toggle, music-skin-integration,
  watch-chrome-ambient, watch-init-behavioral, theatre-mode, sub-row-chip-btn-family,
  music-nowplaying-view, podcast-nowplaying-view, critter-mode = 285 pass / 0 fail; the
  music.html readers + player parity + player/skin/body-lock/prefs-sync/overlay suites
  (24 files) = 429 pass / 0 fail. `npm run lint` 0 errors (7 pre-existing warnings in
  common.js; eslint over the changed files is clean). `npm run lint:css` TOTAL 0.
  `check-markers.sh`: 1 issue (the stale design approval @6ea45237, the tolerated Building
  shape - verbatim in the next bullet; gate r1 qa W1 corrected an earlier "clean" here).
- `bash .harness/lib/check-markers.sh` mid-build (before the WIP commit): `✗
  docs/exec-plans/active/2026-09-23-music-theatre-button.md: stale approval @6ea45237 - reviewed
  code changed since; re-gate` / `check-markers: 1 issue(s) found` (exit 1). The expected
  Building shape: the design approval is bound to the base sha and the checker's rule 2 greps
  every `Approved ... @sha` line; the v1.316.0 plan recorded the identical output mid-build.
- First WIP commit attempt refused by the pre-commit hook: `docs-link-census` red on ONE
  backtick path in this doc (the wave doc lives only on feat/music-channel-chapters); the
  reference was reworded without backticks, the census re-run green (2/2), then committed.
- WIP commit bc488b95 (tree 56993b9f) landed through the pre-commit hook (full unit suite,
  0 failures; lint 0 errors / 7 pre-existing warnings). The final commit adds only this build
  record.
- Mutation round (16 mutants + baseline; sandbox = `git archive` of the staged tree
  56993b9f = the tree commit bc488b95 carries (verified by `git rev-parse HEAD^{tree}`), never
  the live working tree; each mutant
  asserts its pattern was found, so no mutant is a silent no-op; the baseline over the four
  touched test files = 116 pass / 0 fail). Every mutant died; the killing test is named:

  | # | Mutant (one edit) | Killed by |
  |---|-------------------|-----------|
  | M1 | writer without the id-guard (double inject) | writer test + watch -> music (count 1) |
  | M2 | `api.ensureTheaterButton` not exposed on the player api | reachability test |
  | M3 | music mount seam (`updateNowPlayingPanel`) never binds | cold-load, persisted, music -> watch |
  | M4 | music init seam never binds | watch -> music |
  | M5 | music click bound WITHOUT the view signal | watch -> music (destroy leaves a live listener) |
  | M6 | idempotence guard removed (re-bind per mount seam) | cold-load (2 listeners = no flip), watch -> music |
  | M7 | aria-pressed not re-stamped from the music key at bind | persisted, watch -> music |
  | M8 | music sets `hidden` on the shared button | cold-load, music -> watch |
  | M9 | watch.js carries a second copy of the glyph | ONE-writer census + watch-chrome-ambient |
  | M10 | watch.js never calls the writer | watch-chrome-ambient |
  | M11 | `#music-theater-btn` restored in music.html | ONE-writer census |
  | M12 | CSS view-scope rule dropped | CSS test |
  | M13 | CSS `#player-dock #theater-btn` hide dropped | CSS test |
  | M14 | music.html stops loading player.js | SHELL PARITY |
  | M15 | stats.html's template loses `#settings-btn` | SHELL PARITY |
  | M16 | `.sub-row-bell-active { background: red }` | sub-row-chip-btn-family AC4 (the owed census add) |

## Gate r1 - qa (@7c31035f)

Reviewed `git diff main...HEAD` (10 files) at 7c31035f (code bc488b95 + docs) from the worktree.
Every root-cause file:line claim was re-read at 6ea45237 (watch.js :2350/:2359-2373/:2405/
:2426-2440, music.html :119/:285/:316/:353, player.js :2483 ensureHost, style.css :10900,
music.js :759/:774-787/:1497/:1509/:1510, podcasts.html :120, podcasts.js :131) - all match.
Comments verified against code: ensureHost clones ONCE (`if (host) return host;`); watch.js
never touches `.hidden` on the button; `applyZoomPolicy` stamps `data-view` at boot
(common.js:15472) and on every swap (:10470) with `deriveRouteView` returning exactly
`watch`/`music` for those routes; the mobile skin gates at `(max-width: 768px)` so the
"mobile-only, CSS hides it anyway" comment holds (button hides at 1024px); the pop-out
(skin-surface createPopoutShell) never moves the host; the podcasts view is byte-unchanged and
keeps `#podcast-theater-btn` + `.music-theater-btn` CSS. The 1024px seam disclosure is exact
(`max-width: 1024px` hide vs `min-width: 1024px` stage). "No track expanded" moment: the host is
in `#player-dock` (hidden) or still in the template (absent), so no visible-but-inert state.
watch.js's new dependence on `window.FileTube.player` at init is safe: player.js assigns the api
at IIFE top level during parse, bootRouter runs at DOMContentLoaded.

Instruments (verbatim, Node v22.23.1):
- `node --test` music-theater-toggle, music-skin-integration, watch-chrome-ambient,
  watch-init-behavioral, theatre-mode, sub-row-chip-btn-family, music-nowplaying-view,
  podcast-nowplaying-view, critter-mode: `# tests 285 / # pass 285 / # fail 0`.
- Four touched test files alone: `# pass 116 / # fail 0` (matches the build record).
- `npm run lint`: `7 problems (0 errors, 7 warnings)` - all pre-existing in common.js.
- `npm run lint:css`: `TOTAL 0`. `overlay-containment: clean (0 violations)`.
- `bash .harness/lib/check-markers.sh`: `✗ docs/exec-plans/active/2026-09-23-music-theatre-button.md:
  stale approval @6ea45237 — reviewed code changed since; re-gate` / `check-markers: 1 issue(s)
  found` (exit 1) - the tolerated Building shape (design bound to the base sha), see W1.
- Mutants re-run in `/tmp/qa-t1-bJgA` (`git archive HEAD`, node_modules symlinked from the main
  checkout; baseline 9/9): M3 (`bindTheaterControl();` at music.js:1537 deleted) -> `pass 6 /
  fail 3` (cold-load, persisted, music -> watch); M6 (`if (theaterBtn) return;` :800 deleted) ->
  `pass 7 / fail 2` (cold-load, watch -> music); M14 (music.html:363 player.js tag deleted) ->
  `pass 8 / fail 1` (SHELL PARITY). All three die exactly as the table names.
- Em-dash scan of every added diff line: none. Test file carries the `[UNIT]` header, node:test.
- SHELL PARITY roster is dynamic: 14 shells found (floor 12), 11 consumers (floor 11), 10 hosts
  (floor 10); the listener census asserts `strictEqual(musicRegs.length, 1)` so it cannot pass
  vacuously; the writer/reachability/cold-load tests boot the real player.js / music.js in jsdom.

Findings:

1. WARNING (plan doc, Build record bullet 2): the sentence "`check-markers.sh` clean." is false
   at the reviewed sha - the checker reports 1 issue (verbatim above), and the very next bullet
   records that same non-clean output as the expected mid-build shape. Scenario: a reader trusts
   bullet 2, skips the checker, and misses a genuinely stale `Gate:` marker later. Safe to ship
   disclosed: the true output sits in the adjacent bullet and here. Prescription: drop or reword
   that clause in the docs commit that records the gate.
2. WARNING (plan doc, AC7): "executed in `watch-init-behavioral.test.js`" overstates. That
   harness's player is a Proxy returning `() => undefined` for `ensureTheaterButton` and its
   document shim carries no `#theater-btn`, so `setupTheatreToggle` exits at
   `if (!watchContainer || !theaterBtn) return;` - the watch re-query + `{ signal }` binding is
   source-locked (watch-chrome-ambient) but never executed against a button anywhere in the
   suite (theatre-mode.test.js's own header says the DOM half is uncovered). Scenario: a future
   edit runs setupTheatreToggle before ensureCogControlsInjected; the watch page never binds;
   watch-init-behavioral stays green. Not a regression of this diff (the watch change is a call
   replacement whose reachability is proven by the reachability + writer tests). Safe to ship
   disclosed; reword "executed" to "run through (the button is absent in that harness)".
3. SUGGESTION (test/unit/music-theater-toggle.test.js SHELL PARITY): `html.indexOf('</template>')`
   takes the FIRST closing tag in the file; a shell that gains a `<template>` before the player
   host would slice to '' and go red spuriously (loud, not vacuous). Anchor the end on the first
   `</template>` after the start index.
4. SUGGESTION (DoD "lint passes with zero warnings"): 7 pre-existing common.js warnings, none in
   the changed files; disclosed in the build record, unchanged by this diff.

Security-brief (standing): no security surface. The only DOM write is `insertAdjacentHTML` of a
compile-time string constant with no interpolation; the api wrapper hardcodes `document` (the
`doc` parameter is reachable only from tests); no new network call, no new storage key, no
untrusted input reaches a command or the DOM; the diff removes markup rather than adding
data-driven markup.

Tree: `git status --short` empty and `git diff --stat` empty before this section; the worktree
is byte-identical except this appended section.

Gate: APPROVED r1 @7c31035f — qa

## Gate r1 - adversary (@7c31035f)

Reviewed HEAD 7c31035f (code bc488b95 + the build-record commit) against main 6ea45237 from the
worktree. Nothing below restates a builder number: every count was produced here.

Instruments (Node 22.23.1, targeted): the four touched files = 116 pass / 0 fail; theatre-mode +
watch-init-behavioral + critter-mode = 131 pass / 0 fail; eslint over the 7 changed js files exit
0; `scripts/css-token-lint.js` TOTAL 0; `check-markers.sh` = the disclosed 1 issue (stale design
approval @6ea45237, the Building shape). Mutation round in a `git archive HEAD` sandbox
(/tmp/adv-t1-JCRB, baseline 116/0): the 16 claimed mutants all died as tabled (M1 2 fails, M2 1,
M3 3, M4 1, M5 1, M6 2, M7 2, M8 2, M9 2, M10 2, M11 1, M12 1, M13 1, M14 1, M15 1, M16 1 - the
`.sub-row-bell-active { background: gold }` arm of surface 9 is red on AC4). 12 unclaimed mutants:
11 died (aria write dropped; theaterBtn never captured -> 72 fails; writer injects after the cog;
writer anchors on #player-controls only; click always persists ON; view-scope rule widened to hide
on watch; tv.html template loses #player-controls; the 1024px hide dropped; `.theater-btn` class
dropped; no-op click body; subscriptions.html template loses #settings-btn) and ONE SURVIVED
(finding 1).

Real-shape drive (the INERT FEATURE lesson): ONE jsdom, the REAL player.js IIFE + the REAL watch.js
init + the REAL music.js init, the router's swap simulated (dock on leaving watch/music via
common.js's own `shouldDockOnTransition`, destroy, #view-root replaced from the real shells,
`data-view` stamped, init), a click-registration census on the node. Measured:
- (a) cold /music: no button at init; a real row play mounts the host into #player-slot, ONE
  button before the cog, click flips `.is-theater` + aria + `ft-music-theater`; a second play
  leaves regs=1; one click = one flip.
- (b) watch -> music: watch's button REUSED (count 1, same node identity across all 6 swaps), music
  registered exactly ONE listener on a live signal, the watch registration is aborted, aria
  re-stamped from the music key, click toggles the MUSIC stage only.
- (c) music -> watch: same node, in the slot before the cog, `hidden` never set, watch's own click
  toggles `.theater-mode` + `ft-theater`; the cog rows (#watch-autoplay-check / -loop- / -ambient-)
  stay at exactly 1 each through every swap.
- (d) watch -> music -> watch -> music (three round trips): registrations 1,2,3,4,5,6 with live
  listeners = 1 at every step; one click = one flip on each page.
- dock return (/music?nowplaying=1 re-init after leaving for home): bound at the init seam, aria
  re-stamped, one flip per click.
- Every host-mount path enumerated: `load({slot})` (the row play, mount seam), `load({dock:true})`
  (nav-keepPosition while docked -> the next re-init binds), `expand(npSlot)` at init's tail (host
  already in the document -> the init seam; the 3033 `updateNowPlayingPanel` re-runs the mount
  seam), `seedNowPlayingFromPlayer` (no mount; a non-music meta leaves nowPlaying null but every
  non-music arrival is DOCKED by the router, so no expanded-inert window exists), listen mode
  (playAt -> the same load), the pop-out (a separate window; no #player-controls in music-skins /
  skin-surface). `body[data-view]` is stamped at cold boot (common.js:15472) and every swap
  (:10470); all 11 shell views enumerated - only watch/music show the button; `/watch.html` is the
  only watch pathname the app emits, and deriveRouteView maps it.

### Findings

1. WARNING (test binding; public/js/watch.js:2358 + test/unit/watch-chrome-ambient.test.js:97,
   test/unit/watch-init-behavioral.test.js): the WATCH side of "each view calls the ONE writer" is
   locked by a source regex on the call string only - nothing executes watch.js's
   `ensureCogControlsInjected` against a writer. Surviving mutant (the repro): change the guard
   to `typeof window.FileTube.player.ensureTheatreButton === 'function'` (one letter) - the guard
   is always false, the writer is never called, the theatre button VANISHES from every watch page,
   and all 116 tests stay green (the regex still matches the untouched call line). M10 died only
   on the same regexes. AC7's "executed in watch-init-behavioral.test.js" is not true as written:
   that harness's Proxy player answers every unknown property with `() => undefined`, so the
   writer is neither present nor asserted there. Prescription: in watch-init-behavioral, give the
   Proxy player an `ensureTheaterButton` spy and, with a resolving `fetchImpl`, assert it is called
   exactly once by initWatch (and once by the `?tv=` episode path); re-run the guard-typo mutant
   and M10 and record both as killed by that test. Reword AC7.
2. SUGGESTION (public/js/watch.js:1239 vs :2391): the one-RTT aria seam on watch. Measured
   (transient2 drive): music theatre ON, then a soft-nav to /watch.html?v=<the docked video> - the
   early adopt (:1505) mounts the host into the slot synchronously, `.theater-mode` is applied
   from `ft-theater` (OFF), but the button still wears music's `aria-pressed="true"` (the red
   pressed look) with NO live listener until step 9 re-stamps it after the config/media fetches
   settle. Before this diff the aria was whatever the last watch visit set, so it agreed with the
   class. Self-correcting, cosmetic; if wanted, re-stamp `#theater-btn` aria beside the :1239
   synchronous class apply. Safe to ship disclosed.
3. SUGGESTION (disclosed seam, confirmed): style.css:9012 `@media (max-width: 1024px)` hides the
   button while :10909 `@media (min-width: 1024px)` lays out `.music-stage.is-theater` - both true
   at exactly 1024px, so a persisted ON has no toggle there. Reachable only by resizing from
   >=1025 with ON persisted (the key is not in the synced-prefs set; the skin takes over only
   <=768). Disclosure, not a finding.
4. NOTE (pre-existing, out of scope): public/books.html carries neither `#player-host-template`
   nor `#player-dock` (identical on main), so the writer returns null there and the SHELL PARITY
   test's consumer arm passes it. Suspicion, not driven: a soft-nav /books -> watch would hit
   `ensureHost()` null -> `showFatalViewError`. Not this diff's.

Tree: `git status --porcelain` shows only this plan doc (the qa section above and this one, both
uncommitted); no untracked files; the sandbox lives in /tmp/adv-t1-JCRB, outside the tree.

Gate: CHANGES r1 @7c31035f — adversary (see findings)

## r1 fix record

Fix commit 09340f30 on top of ea98921e (code + tests + this doc + the tracker row); a second
fix commit (the harness Proxy, below) after the first mutant run showed the guard-typo mutant
STILL SURVIVED the spy; then a docs commit recording the mutant results. Every mutant ran in a
`git archive` sandbox of a committed sha, never on the live tree.

| Finding | What changed | Binding test / evidence |
|---------|--------------|-------------------------|
| adversary W1 (the guard-typo survivor; M10 killed only by regexes) | `test/unit/watch-init-behavioral.test.js`: the harness's Proxy player gains an `ensureTheaterButton` SPY (`theaterCalls`), so the property is present and counted instead of falling through to the Proxy's `() => undefined`. Two tests drive the REAL watch.js with resolving fetches: the hydrated video path (config + `/api/videos/vid1` + settings resolve; step 4 load, step 9 cog injection) asserts 0 calls synchronously in init() and exactly 1 after hydration (with 2 `load` calls as the reachability precondition); the `?tv=` episode path asserts exactly 1 (with 1 `load`). The DOM shim gained permissive no-ops the hydrated path reaches. SECOND fix (the spy alone let the guard typo survive, measured at 09340f30: 48 pass / 0 fail): the Proxy's fallback answered EVERY unknown property with `() => undefined`, so `typeof player.ensureTheatreButton === 'function'` was TRUE in the harness while it is false in production, and the untouched call line still hit the spy. The fallback now answers a no-op only for names on the REAL player api (`REAL_PLAYER_API`, read from player.js's `var api = {...}` literal + `api.X =` + `defineProperty(api, ...)`), and `undefined` for anything else, as the browser does; a harness test binds the extracted set as non-vacuous and without the misspelling. | "v1.317 gate W1" x2 + "harness: REAL_PLAYER_API". Guard-typo mutant and M10: see Mutant results. |
| qa W2 + adversary W1 (AC7 "executed" overstated) | AC7 reworded: the CALL is bound by execution (the spy); the post-mount re-query and `{ signal }` click binding in `setupTheatreToggle` stay SOURCE-locked in `test/unit/watch-chrome-ambient.test.js` (that harness has no button to click). | Doc only. |
| qa W1 (false "check-markers clean") | Build record bullet 2 reworded to the true 1-issue output (the tolerated Building shape). | Doc only. |
| adversary S2 (one-RTT aria seam on watch) | `public/js/watch.js` init(): `#theater-btn` `aria-pressed` is re-stamped from `ft-theater` in the same synchronous try block as the `.theater-mode` class apply (a no-op when no button exists yet). New AC12. | "v1.317 gate S2" (stored `1` / `0` / absent -> exactly one synchronous write of `true` / `false` / `false`). Mutant S2-drop below. |
| qa S3 (SHELL PARITY slice) | `test/unit/music-theater-toggle.test.js`: the template slice ends at the first `</template>` AFTER the start index. | Fix check below (an earlier empty `<template>` in a shell). |
| adversary NOTE 4 (books.html has no player template/dock) | Tracker row #236 (Low, OPEN, revisit trigger = drive cold /books -> soft-nav /watch.html in the shell-smoke test) + a Known seams bullet. | Tracker. |
| adversary S3 / qa (1024px seam) | Known seams bullet now records both seats' confirmation; behaviour unchanged by intent (watch rule byte-identical). | Disclosure. |
| qa S4 (7 lint warnings) | None: pre-existing in common.js, none in the changed files. | Disclosure. |

Targeted runs (Node 22.23.1, before the first fix commit): `node --test
test/unit/watch-init-behavioral.test.js` = 18 pass / 0 fail (19 / 0 after the Proxy fix); `node --test
test/unit/music-theater-toggle.test.js` = 9 pass / 0 fail; every unit file that reads watch.js
plus the two touched files (44 files) = 517 pass / 0 fail.

### Mutant results

Sandbox: `git archive` of a committed sha, node_modules symlinked from the main checkout; each
mutant asserts its pattern occurs exactly once (no silent no-op); files run: watch-init-behavioral,
watch-chrome-ambient, music-theater-toggle, theatre-mode (Node 22.23.1).

Run 1 @09340f30 (the spy alone), baseline 48 pass / 0 fail:

| Mutant | Result |
|--------|--------|
| guard typo (`ensureTheatreButton` in the `typeof` guard) | SURVIVED: 48 pass / 0 fail (the Proxy fallback made the misspelled guard true; fixed in 2be106bc) |
| M10 (watch.js never calls the writer) | killed, 44 pass / 4 fail: ONE writer, v1.186 ensureCogControlsInjected, both gate W1 tests |
| S2 re-stamp line dropped | killed, 47 / 1: gate S2 |
| S2 re-stamp inverted | killed, 47 / 1: gate S2 |
| writer called twice | killed, 46 / 2: both gate W1 tests |

Run 2 @2be106bc (tree 1d61a39f), baseline 49 pass / 0 fail:

| Mutant | Result |
|--------|--------|
| guard typo (`ensureTheatreButton` in the `typeof` guard) | killed, 47 pass / 2 fail: gate W1 video path + gate W1 `?tv=` path |
| M10 (watch.js never calls the writer) | killed, 45 / 4: ONE writer, v1.186 ensureCogControlsInjected, both gate W1 tests |
| S2 re-stamp line dropped | killed, 48 / 1: gate S2 |
| S2 re-stamp inverted | killed, 48 / 1: gate S2 |
| writer called twice | killed, 47 / 2: both gate W1 tests |
| initTvWatch drops `ensureCogControlsInjected()` | killed, 47 / 2: v1.197 W1 + gate W1 `?tv=` path |
| initWatch step 9 drops `ensureCogControlsInjected()` | killed, 48 / 1: gate W1 video path |
| qa S3 fix check: an empty `<template>` added before the player template in music.html | GREEN 49 / 0 with the new slice; with the OLD first-in-file slice restored, music-theater-toggle 8 / 1 (SHELL PARITY red) |

`bash .harness/lib/check-markers.sh` after the fix commits: 2 issues, both stale approvals
(`@6ea45237` the design, and `@7c31035f` qa r1 - code changed since, so r2 re-gates); the
expected shape before gate r2.
