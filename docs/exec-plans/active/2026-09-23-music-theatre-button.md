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
  `hidden`, and the writer reuses it. ("music -> watch" test.) The watch page's own post-mount
  re-query + `{ signal }` binding stay locked in `watch-chrome-ambient.test.js` and executed
  in `watch-init-behavioral.test.js`.
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
  `check-markers.sh` clean.
- Mutation results: see the section appended after the WIP commit (mutants run on a
  `git archive` sandbox of the committed tree, never on uncommitted edits).
