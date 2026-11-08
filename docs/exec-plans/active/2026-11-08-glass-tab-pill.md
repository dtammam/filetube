---
plan: glass-tab-pill
harness: v2 · full
branch: feat/v1.405.0-glass-tab-pill
anchor: spec
status: Built W1-W4; gate pending
next: the full Node 22 suite, then the gate (adversary, qa, security-brief)
design: Rulings approved by Dean 2026-11-08 (AskUserQuestion): Q1-Q5 below; look A picked from three mockups
gate: pending (adversary + qa + security-brief; a new bridge capability, message and event = a boundary-shaped surface)
builder: smart
---

# v1.405.0 - a floating glass pill replaces the bottom bar on Modern (web and the iPhone app)

Kickoff 2026-11-08 (FileTube Root, Opus). **Builder: Smart (Opus).** Why the tier: a look change across every mobile
shell, plus a new bridge capability where a NATIVE view sits above the web view (the v1.401.0 `layer: 'above'`
precedent), so the web must tell native when to get out of the way. Not Extreme: no data, no migration. The iOS
half is the iOS Root's (Dean's Mac, the relay below).

## Why

Dean, 2026-11-08, with a screenshot of the YouTube iPhone app (a bottom-aligned floating pill holding the tabs):
"We have a really nice bottom bar, and it's extendable and customizable ... I would like to update and have a new,
modern bottom pill for those same things ... It should be visible on every screen on mobile where our bottom bar
currently is. It should be a functional replacement of the bottom bar. In the iOS app, it should really be a true
first-class experience with the liquid glass view. I think we should do it without the text."

Today: `#bottom-nav` (`.bottom-nav`, a full-width fixed strip, style.css ~3710) on all ten shells (index, watch,
history, music, podcasts, books, read, stats, tv, setup). Its items, order and visibility come from ONE resolver,
`resolveBottomNavLayout` + `applyBottomNavCustomization` (common.js ~5488-5700, the `ft-bottomnav` config the
Settings customizer writes). Offsets come from ONE var, `--mobile-bottom-nav-h` (style.css ~3616, the v1.17.0 FR-2
single source), which the content padding and `#player-dock` read.

**Why native in the app:** CSS cannot draw Liquid Glass. WebKit's `backdrop-filter` gives blur and saturation, not
the lensing or refraction; that is `UIGlassEffect` (iOS 26), so the app draws the pill natively.

## Rulings (Dean, 2026-11-08)

- **Q1 - Modern only.** The pill replaces the bar on the Modern look (`data-theme="2021"`, light and dark). Original,
  Classic and Flat keep today's bar, byte-identical (era fidelity).
- **Q2 - native Liquid Glass in the app.** A new capability `nativeTabBar`: the app draws the pill with Apple's glass;
  the web pill is the fallback (PWA, Safari, app builds without the capability).
- **Q3 - icons only.** No visible labels. Every item keeps its accessible name (`aria-label`); a long press shows the
  name (web: a small tooltip above the pill; native: Apple's own behaviour).
- **Q4 - stays put.** No shrink or hide on scroll.
- **Q5 - look A, "Capsule"** (mockup: Dean picked A of A/B/C): full width minus the 16px gutters, floating above the
  home indicator, the active item in a soft inner capsule, the other items --ink-2, the active one --ink-1 with its
  FILLED glyph (the existing `setBottomNavItemFilled` rule; never red). Blur + saturation + a light inner rim and a
  soft drop shadow, tokens for light and dark. Mockup source: the kickoff session's scratchpad `pill/mock.html`
  (the builder re-derives numbers from the real tokens, not the mockup).
- **Functional replacement:** same items, same order, same customizer, same icon sets, same opt-in defaults, same
  floor (`flooredToDefault`), same active-item logic, same injected items (Download, Subscriptions). Nothing about
  WHAT is in the bar changes.

## Step 0 (before any code)

- Read AGENTS.md; docs/LESSONS.md sections 1, 2, 3, 4, 6, 11 (CSS / SPA traps, the overlay census, the UI ratchet,
  reachability); docs/references/native-bridge.md (all), native-bridge.v1.schema.json, ios-host.md,
  z-ladder-coopen-enumeration.md; the plans `docs/exec-plans/completed/2026-11-01-live-dock-picture.md` (a native view
  ABOVE the web view) and `2026-11-05-ios-pip.md` (the contract + relay pattern); then this plan once.
- Read the code: common.js `bottomNavItemEl` (~132), `setBottomNavItemFilled` (~142), the bottom-nav roster and
  resolver (~5488-5700), the active-item writer (~3477-3560, ~776), the async injectors (Download / Subscriptions,
  ~5391); style.css `.bottom-nav` (~3569, ~3710-3760, ~3939, ~5046 faux fullscreen), every consumer of
  `--mobile-bottom-nav-h` (`grep -n mobile-bottom-nav-h public/css/*.css public/js/*.js`), `#player-dock` (~1391,
  ~1467), the chip at ~8000; host-adapter.js (`CAPABILITIES`, `MESSAGES`, `EVENTS`, the capability-gated field specs).
- Environment: `export PATH="$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH"` before every
  npm/node/git command. Local suites on Node 22; Node 24 runs in PR CI.
- Git: work in the worktree on `feat/v1.405.0-glass-tab-pill` (this plan is committed there). Stage by name, never
  `git add .`/`-A`, never force-push, never `--no-verify`, never pipe a commit or push; verify with `git log` /
  `git ls-remote`. Commit with `-F <file>`. Push with
  `GIT_SSH_COMMAND="ssh -o ServerAliveInterval=20 -o ServerAliveCountMax=60"`.
- **Release order:** this branch starts from main f835967e (v1.404.0 shipped). If origin/main moves before your
  release commit, merge it in and re-run the full suite.
- **Stop rules (ask Dean with AskUserQuestion):** the iOS Root (via Dean) rejects or changes the Contract; a retro
  look's bar would have to change; the pill cannot hold the maximum opted-in item count without a design decision
  (see R4); gate round 3. A device check failing after release is a re-root-cause, never a re-patch.

## Web requirements

- **R1 - the pill (Modern, phone breakpoint).** Restyle `.bottom-nav` under `[data-theme="2021"]` inside the existing
  `@media (max-width: 768px)` block: a fixed, inset, fully rounded pill (left/right `--space-4`, bottom = the safe-area
  inset + a gap), the glass treatment of Q5, icon-only (the `.bottom-nav-label` visually hidden, the label text moved
  to / kept as the item's accessible name; never `display:none` on the only name). Same DOM, same element, same ids:
  the resolver, customizer and injectors are untouched. New raw values go through tokens (the UI ratchet,
  `npm run lint:ui` must not grow `docs/ui-exceptions.json`); the overlay census stays at ZERO (a rounded fixed
  element with `overflow:hidden` and no inner scroller - say so in a `corner-clip-safe` note only if the lint asks).
  Provide a solid fallback for no `backdrop-filter` support (`@supports not`).
- **R2 - one offset, re-derived.** `--mobile-bottom-nav-h` stays the ONE source; on Modern it becomes the pill's
  height + its bottom gap + the safe-area inset, so the content's last row and `#player-dock` clear the pill. Content
  scrolls UNDER the pill (that is what the glass is for); the reserved padding only guarantees the last item can be
  scrolled clear. Prove every consumer reads the var (the grep in Step 0, listed in Evidence) - no consumer with its
  own copy of the number.
- **R3 - long press shows the name** (web pill only): a ~500 ms press on an item shows a small tooltip with its label
  above the pill; releasing without moving does NOT navigate after a long press; a normal tap is unchanged. No
  context-menu / text-selection callout (`-webkit-touch-callout: none` on the items).
- **R4 - item count.** Measure the pill at 375 px and 320 px wide with the MOST items a user can opt into (the whole
  `BOTTOM_NAV_OPTIONAL` roster present). Each item keeps a 44 px minimum hit target. If it does not fit, STOP and ask
  Dean with a measured screenshot (options to offer: horizontal scroll inside the pill, a cap with an overflow item,
  or a customizer limit) - do not pick silently.
- **R5 - every other look and desktop is byte-identical.** Original / Classic / Flat on a phone, and every look above
  768 px: computed styles of `.bottom-nav` and its items, `--mobile-bottom-nav-h` and `#player-dock`'s `bottom`
  unchanged (a probe compares base vs branch).
- **R6 - nothing else moves.** Faux fullscreen (`body.ft-css-fullscreen .bottom-nav`), the chip (~8000), sheets at
  `--z-sheet`, toasts, the swipe-to-Trash rows (v1.403.0), the Feed (v1.379.0), the reader (read.html) and the page
  turn (v1.402.0), Music skins' `mms-popout`: each still clears or covers the bar exactly as before. List each in
  Evidence with how it was checked.

## Contract (add-only; frozen by this plan, confirmed by the iOS Root through Dean before the web merges)

- New capability **`nativeTabBar`**. CAPABILITIES in host-adapter.js, native-bridge.md and the schema gain it
  (add-only).
- New message **`nav.bar`** (web to native), sent only under the capability:
  `{ items: [{ id, label, active }], visible: boolean }`. `id` is a `BOTTOM_NAV_OPTIONAL` roster id (plus any injected
  id the resolver returns), in the resolver's visible ORDER; `label` is the accessible name. Native maps each `id` to an
  SF Symbol pair (outline / `.fill` for the active item) from a table it owns; an unknown id shows a generic symbol,
  never nothing. The `you`/avatar case: if the account item is ever in the bar, the web adds `imageUrl` (same-origin
  only, the host-adapter field check refuses anything else). Sent ONCE, coalesced, after: the capability announce,
  every `applyBottomNavCustomization`, every active-item change (SPA nav), every visibility change. Identical
  consecutive payloads are not re-sent.
- **`visible` is ONE web predicate** (`nativeTabBarVisible()`): true only when the Modern look is on, the phone
  breakpoint applies, AND nothing that today COVERS the bottom bar is open - every sheet / modal / menu at or above
  `--z-sheet` (enumerate them from docs/references/z-ladder-coopen-enumeration.md and the CSS, list them in Evidence),
  faux and native fullscreen, the on-screen keyboard (a focused text field), and the Music skins pop-out. On a retro
  look `visible: false` and the web's own bar shows as today.
- New event **`navTap`** `{ id }` (native to web): the web runs exactly what a tap on that item's web element does
  (`.click()` on the live `[data-nav=id]` element, so links go through the SPA router and buttons such as Playlists
  open their sheet). An id with no live element is ignored.
- New event **`navBarMetrics`** `{ height }` (native to web, CSS px, the pill's height + its gap above the safe area,
  safe area excluded): sent once after the announce and on every change (rotation, Dynamic Type). The web sets
  `--mobile-bottom-nav-h` from it (+ the safe-area inset) while native draws the pill, so R2's clearance holds with
  either renderer.
- While `nativeTabBar` is announced and `visible` is true, the web pill is hidden (`[hidden]`, with the
  `[hidden]{display:none!important}` rule) but stays in the DOM: it is the source of the items and the `navTap`
  target.
- Native: the pill is a native view above the web view, touches outside it pass through to the web. It hides on
  `visible: false` immediately (no animation lag over a sheet), on a main-frame navigation commit (section 6 of
  native-bridge.md, the held-capability release), and until the first `nav.bar` after a load.

## Waves

- **W1 - R1 + R2 + R4 + R5 (the web pill).** CSS on Modern, the offset, the accessible names. A probe
  (`scripts/glass-pill-probe.js`, the CDP pattern of scripts/live-dock-probe.js) that renders Modern light/dark and the
  three retro looks at 390/375/320 px, base vs branch, and reports R4 and R5 by measurement. Send Dean the light/dark
  Modern crops (SendUserFile) before W2; his answer may adjust the look.
- **W2 - R3 + R6.** The long press, then the R6 sweep with the probe extended to each surface.
- **W3 - contract.** host-adapter.js (`nativeTabBar`, `nav.bar` and its field checks, `navTap`, `navBarMetrics`),
  `nativeTabBarVisible()` as the ONE predicate, the coalesced sender, native-bridge.md and the schema. jsdom tests
  driving the REAL common.js paths with a fake host (reachability, LESSONS 2): cap off = no `nav.bar` ever and the
  web pill shows; cap on = the payload matches the resolver's visible order on every trigger; each covering surface
  flips `visible`; `navTap` lands on the element; `navBarMetrics` drives the var. Mutate each guard, watch it go red.
- **W4 - docs + release.** LESSONS (the class: "a native view above the web view must be told about EVERY web
  surface that covered the bar - one predicate, enumerated, tested per surface"), DEVICE-CHECKS, ROADMAP Shipped,
  releases.json in user language (the app gets the glass with its next update; the web pill is live now), the version
  bump.

## iOS Root relay (Dean pastes this into the iOS Root)

> FileTube web v1.405.0 replaces the bottom bar on the Modern look with a floating pill, and the app should draw it
> natively with Liquid Glass. New capability `nativeTabBar` (announce it to opt in). The web sends `nav.bar
> { items: [{ id, label, active, imageUrl? }], visible }` - coalesced, only on change - after your announce, after
> every customization, every navigation and every visibility change. Draw an icon-only glass tab pill
> (`UIGlassEffect`, iOS 26; a `UIVisualEffectView` material on older iOS) floating above the home indicator with the
> items in the order given, the `active` one selected; map each `id` to an SF Symbol (outline, and `.fill` when active)
> from a table you own - ids: home, liked, feed, playlists, history, podcasts, music, books, pages, downloads, theme,
> oneoff-download, subscriptions, settings; unknown id = a generic symbol. Use `label` as the accessibility label and
> for the long-press name. On a tap send `navTap { id }` and nothing else (the web navigates; do not move the selection
> until the next `nav.bar` says so). Send `navBarMetrics { height }` (CSS px: pill height + gap above the safe area, the
> safe area excluded) once after the announce and on every change. `visible: false` must hide the pill at once - the web
> sends it whenever a sheet, menu, the keyboard, fullscreen, or a non-Modern look is up, because your view sits above
> the web view and would otherwise cover them. Hide it on a main-frame navigation commit and until the first `nav.bar`
> after a load. Touches outside the pill pass through to the web view. Order with the docked mini player (v1.401.0
> `layer: 'above'`): the pill sits below the dock's picture layer in z, and the web already places the dock above the
> pill using `navBarMetrics`. Please confirm or push back before the web merges; device checks run on that build:
> DEVICE-CHECKS "Glass tab pill (v1.405.0)".

## Gate

Full gate: adversary (floor), qa, security-brief. Attack surfaces: (1) retro looks and desktop byte-identical (R5,
measured); (2) a covering surface that `nativeTabBarVisible()` misses = the native pill over a sheet - enumerate,
then try to open one the enumeration forgot; (3) cap off = no `nav.bar` and the web pill (PWA, Safari, today's app);
(4) the order / active / visibility the native pill gets always equals what the web bar shows, across the injector
races the v1.75 W1 comment describes; (5) `navTap` with a hostile or stale id; `imageUrl` same-origin only;
(6) `--mobile-bottom-nav-h` has one writer per renderer and every consumer reads it. Ship on CRITICAL/WARNING
closure; ask Dean at round 3.

## Release

`docs/RELEASING.md` + AGENTS.md: version 1.405.0, ROADMAP Shipped, `docs/releases.json`, DEVICE-CHECKS
"Glass tab pill (v1.405.0)": now (PWA / Safari, Modern) - (a) the pill on every page that had the bar, light and dark,
content visible through it while scrolling; (b) the last row of a long list and the mini player both clear it;
(c) a long press shows the name and does not navigate; (d) the customizer: hide, reorder, opt in - the pill follows;
(e) Original / Classic / Flat: the old bar, unchanged; (f) a sheet, the keyboard, fullscreen: covered or hidden as
before. On the app build that announces nativeTabBar - (g) the glass pill, with the same items, order and selection
as Settings says; (h) a tap navigates, Playlists opens its sheet; (i) the pill hides under every sheet, menu, the
keyboard and fullscreen, and returns after; (j) the mini player sits above the pill; (k) switching to a retro look
shows the old web bar, no glass. Close the plan with `node scripts/plan-complete.js` in the same PR. **Do not run
`gh pr merge` until Dean says so** (he confirms the iOS Root accepted the contract).

## Out of scope

Shrink-on-scroll (Q4); labels (Q3); the pill on retro looks (Q1); a separate search button or split item (look C was
not picked); changing what the bar can hold or its defaults; desktop; the iOS implementation itself (the iOS Root's).

## Evidence

Builder: FileTube Builder (Opus), 2026-11-08. Branch from main f835967e (origin/main unmoved at the W4 commit). Commits: W1 ab1e38dd, W2 a77aaea5,
W3 03e284c8, W4 (docs + 1.405.0) on top.

**Step 0 notes.** `--space-4` is 8px, not the 16px of Q5's gutters, so the pill reads a new `--pill-gutter: 16px` (Dean's ruling wins over the R1
wording). The callout and selection are already off app-wide (ui.css `body`: `-webkit-touch-callout: none`), and ui-lint rule 6 forbids a second
one, so R3 adds none.

**Rulings taken during the build (Dean, AskUserQuestion, 2026-11-08, after the W1 crops):** R4 stop rule -> "Scroll inside the pill"; the look ->
"Looks right" (light + dark crops at 390px sent before W2).

**R1 / lints.** `npm run lint:ui`: "ui-lint: OK - the live debt equals docs/ui-exceptions.json", TOTAL 3141 before and after (no new debt; every
new value is a token in tokens.css: `--pill-ground/-solid/-rim/-edge/-shadow/-glass` per Modern mode, `--pill-pad/-h/-gap/-gutter`).
`npm run lint:overlay`: "overlay-containment: clean (0 violations)". The lint DID ask once R4 made the pill scroll (overflow-x:auto + a radius on one
rule, and the DOM cannot split them: applyBottomNavCustomization appends items straight into #bottom-nav), so the rule carries a reviewed
`corner-clip-safe` note (items are plain links/buttons, no transform / video / will-change); mutant without the note -> "1 violation(s)".

**R2 - every consumer reads the ONE var** (`grep -n 'var(--mobile-bottom-nav-h' public/css/*.css`): ui.css:908 `.ui-toast-host`; style.css
1049/1052 `.select-bar` (+dock), 1475 `#player-dock`, 3023/3040 `#handoff-card`, 3142/3148 `#remote-pill`, 3584/3597 `.bottom-nav-tip` (new),
3606 `.bottom-nav-reserve-probe` (new), 3723 `.main-content` padding, 4202/4204 `#player-wrapper.portrait-media` max-height, 7132
`#dl-status-chip`, 13384 the Feed's `.feed-stack`. JS: read.js sizeReader read `bottomNav.offsetHeight` (its own copy, under-reserving the
floating pill by its gap + the safe area) and now reads `FileTube.bottomNavReservePx()` (the strip height on retro looks, unchanged; the resolved
var on the pill; the var while native draws). Definitions: `:root` (72px strip), `:root[data-theme="2021"]` (pill + gap + inset),
`:root[data-theme="2021"][data-native-tab-bar]` (navBarMetrics + inset) - one per renderer (glass-tab-pill.test.js R2).

**R4 (scripts/glass-pill-probe.js, Modern light).** Default bar: 6 items [home, feed, playlists, history, oneoff-download, you]; narrowest 57.7px
(390), 55.2px (375), 46px (320); pill 358/343/288 x 56; offset 64px (+ inset); no scroll. Full roster (FT_PILL_FULL=1): 14 items, before the ruling
24.7 / 23.6 / 19.7px (base's flat bar: 27.8 / 26.8 / 22.8px); after: 44px each, row 628px scrolling in 358/343/288px.

**R5 (base f835967e vs branch, the same probe).** `--compare`: "SUMMARY compared=26 differ=0 ok" for the default config AND the full-roster config
(Original/Classic/Flat x light/dark x 390/375/320, plus all four looks x two modes at 1024px: the bar's box and 25 computed properties, every item's
box + 10 properties, the labels, the resolved offset, `.main-content` padding, `#player-dock` bottom). Re-run after W2: 26/0.

**R6 sweep (FT_PILL_SWEEP=1, Modern and Original at 390x844): "SUMMARY checks=22 failed=0 ok".** reader-reserve 64=64 (Original 52=52); last row
746.7 <= bar top 780; toast 772 <= 780; chip 772 <= 780; dock bottom 72px >= 64px; Playlists sheet covers the bar (hit test lands on the sheet);
faux fullscreen visibility hidden; R3 real touch: tip "History", path still "/" after the release; tip above a showing dock (674 <= 682); a tap
navigates to /history; landscape: display none, reserve 0. Feed: n/a (no feed items in the probe library; its height is CSS reading the var).
By CSS analysis: sheets at --z-sheet and the music skin (fixed inset 0, z 1100) cover it as before; the reader's now-playing bar (fixed, bottom 0,
z 940) covers it as before; page turn lives inside the reader chassis (sized by the reserve above). Not measured in a browser: the reader with a
real book, page turn, the music skin (no media in the probe library) - device check (f).

**R3.** jsdom on the real binder + engine: hold 500ms shows the accessible name (an aria-label wins), the click after is swallowed (default
prevented), a tap is unchanged, every retro look and desktop never arm. Tip z = --z-dock - 1 (test/unit/native-dock-covered.test.js's census:
nothing new above the dock), lifted above the dock while it shows.

**W3 contract.** Covering surfaces (derived census, test/unit/native-tab-bar.test.js): covers = `.ui-scrim`/`.ui-sheet` is-open (every ui.js
sheet, dialog, menu, popover), faux fullscreen (`body.ft-css-fullscreen`, `#player-wrapper.css-fullscreen`), `#player-wrapper.audio-expanded`,
`.speed-sheet-backdrop`, `.whcal-overlay`, `.reader-nowplaying`, `.mms-full`; plus native fullscreen and the keyboard (a focused text field,
select or editable). clear = header, `.select-bar`, `#player-dock`, `#handoff-card`, `#remote-pill`, `#dl-status-chip`, `.ui-toast-host`,
`.bottom-nav-tip`. under (no z-index) = the mms tray panel, `.ipm-kb`. jsdom (real index.html bar, ui.js, interaction.js, host-adapter.js behind
a fake host, common.js): 30 tests. Real browser with a fake host (FT_PILL_NATIVE=1): "SUMMARY native-checks=11 failed=0 ok" - first payload
equals the DOM's visible order with the lit item; web pill [hidden] + display none; navBarMetrics 62 -> offset 62; navTap playlists opens the
sheet and sends visible:false; Escape -> visible:true; navTap history navigates and selects history; keyboard up/down flips visible; a retro look
-> visible:false; cap off: 0 nav.bar, web pill shown. That probe caught a real defect jsdom missed: the router `replaceWith`s `#view-root`, so the
first draft's once-bound observer went stale after a navigation (fixed: re-found at every flush; a jsdom test now replaces the root).

**Mutation (LESSONS 2), each restored from a backup copy.** W1: 5 mutants, 4 red; the survivor (an overflow guard) was redundant and removed. W2
R3: 7 red / 7. W2 reserve: 3 red / 3. W3: 34 mutants, 32 red; the two survivors were a redundant `el.hidden` fast path (removed) and the empty-
label fallback (test added, then red); the view-root rewire: 3 mutants, 1 red; the two survivors were two redundant rewire points (one kept, bound).
Two explicit re-send hooks (in applyBottomNavCustomization / applyNavHighlight) were removed as duplicates of the bar's own MutationObserver.

**Changes to existing tests (growth, not weakening):** native-bridge-pip.test.js pinned `nativeVideoPip` as the LAST capability; it now checks it
is announced (the add-only list grew). glass-tab-pill.test.js R2 counts three definitions (one per renderer).

**Suites (Node 22.23.1).** Pre-commit hook (the unit suite): W1 10468 tests, 10467 pass, 0 fail; W2 10475 / 10474 / 0; W3 10505 / 10504 / 0
(1 skipped each). Full `npm test` before the gate: see below.
