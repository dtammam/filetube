---
plan: settings-debug-keyboard-search
harness: v2 · lean
branch: feat/v1.355-settings-keyboard-search
anchor: spec
status: Building
next: built (W0-W3, section 7); the gate (adversary + qa), then the Architect's release
design: Dean 2026-10-02 - A + B in ONE release v1.355.0; B experimental and OFF by default; hard constraint for B: the keyboard just appears, nothing resizes, moves, shifts or zooms, nothing else changes; R2-R9 are architect defaults he did not overrule
gate: adversary + qa (escalated from the table's floor: UI/layout and a new input path, LESSONS 1 "seats split"); security-brief applied as a section by both
---

# v1.355: a Settings switch for the rotate debug log, and keyboard search on the iPod (experimental)

Written 2026-10-02 by the Opus Architect at main 534f4a70 (v1.354.0 + the baselines PR). Seams were read on main, not
assumed. C (speaker resume after close) is NOT in this release: it has its own plan (slug speaker-resume, v1.356.0, on its own
branch) and shares no code with A or B.

## 1. The outcome (what Dean will do on device)

1. **A.** In the home-screen app: Settings > Troubleshooting > "Show rotate debug log" on. Go to Music, play in Pocket, turn
   the phone: the green log panel is there (no URL bar, no reload, no Safari needed). Off: it is gone at once.
2. **B.** Settings > Mobile player > "Keyboard search (experimental)" on. In Pocket on an iPod skin, Music > Search: the
   phone's own keyboard comes up; typing narrows the songs, albums and artists live above. Nothing on screen moves, shrinks,
   shifts or zooms when the keyboard comes up or goes down. Off (the default): Search is exactly v1.354's wheel letter strip.
3. With A on while trying B, the log records whether anything moved when the keyboard came up (the instrument for B).

## 0. Step 0 - read, set up, and the stop rules

0.1 Read `AGENTS.md`, then `docs/LESSONS.md` sections **0, 1, 2, 3, 4, 6, 8, 12, 13**, then
`docs/exec-plans/completed/2026-10-02-pocket-music.md` section W4 (v1.354's search: the strip, the debounce/token seam, how its
gate went). Read this plan fully before editing. Order of work: W0, W1, W2, W3.

0.2 Environment, every shell: `export PATH="$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH"`.
Dual-Node for the final suite: 22.23.1 and 24.20.0 (Node 24 prints `ℹ`, not `#`; an empty grep is not green).

0.3 Worktree: `.claude/worktrees/v1355` on branch `feat/v1.355-settings-keyboard-search` (the Architect creates it; it carries
this plan). In the worktree: `ln -s /home/coder/projects/filetube/node_modules node_modules` before any commit/push,
`rm node_modules` after, never stage it.

0.4 Git: stage files BY NAME; `git commit -F <file>` (write the message with a QUOTED heredoc, `<<'EOF'`); never
`--no-verify`, never force-push, never pipe a commit or push; verify with `git log`. The pre-commit hook runs the unit suite
(~5 min): run long commits in the background and wait for them. Do NOT push; the Architect pushes after the gate.

0.5 Tests while building: the targeted files each wave names. Full dual-Node `npm test` once after W2, again only if a gate
round changes code, never while a gate seat is running.

0.6 Report every failure verbatim with counts. "Verified" means you ran it and saw it. Mutants only on COMMITTED work, in a
/tmp `git archive <sha>` sandbox with `node --test --test-timeout=20000 <file>`, an exact-once replace, restored in a
`finally`, the sandbox diffed against a pristine copy after; kill anything you start BY PID. Record each wave's mutants in
section 7.

0.7 No em dashes in docs, comments or user-facing text. UI through `ui.js` primitives and tokens; `npm run lint:ui` must not
grow (shrink with `node scripts/ui-lint.js --shrink` when debt is paid); `node scripts/overlay-containment-lint.js --enforce`
stays 0. A comment, test title or doc your change inverts is a finding (the lying-comment class): grep for it.

0.8 **Stop rules.** Stop and report to the Architect (do not guess) if: (a) a seam in section 4 does not exist or behaves
differently and the fix is not a like-for-like rename; (b) W0's census finds no container that keeps a focused input alive
across every repaint (B's design then changes: the Architect asks Dean); (c) any step needs a new npm dependency (none
planned); (d) the real-browser proof shows ANY movement (scroll, visual viewport offset, scale, LCD rect) on focus or typing
that the design cannot remove; (e) scope grows: log extras in ROADMAP.md Planned instead.

## 2. Rulings and defaults

| # | Question | Ruling |
|---|---|---|
| R1 | One release? | **Yes (Dean, 2026-10-02): A + B in v1.355.0.** C is v1.356.0, its own plan. |
| R2 | Where A lives | Beside "Show lifecycle debug log" (Settings > Troubleshooting, setup.html ~797), as Dean's ask names. Only B goes in Settings > Mobile player. Architect default. |
| R3 | A applies when | **At once, both ways**, not after a reload (in the home-screen app a reload is a kill and relaunch). ON installs the log in this window now (install made idempotent); OFF removes it now (listeners, the free-running pre-frame ring, the panel and the probe). The `?debugRotate=1/0` link keeps working. Architect default. |
| R4 | B's flag | localStorage `ft-pocket-keyboard-search` = `'1'` (on) / absent (off). Device-local like every Mobile player choice, never a server setting. Read LIVE at the moment Search opens (a getter the view passes the engine), so it needs no reload. Architect default. |
| R5 | B's scope | **Music > Search only.** The skins search (Pocket Extras > Skins search) stays on the strip. Architect default ("nothing else changes"); a ROADMAP Planned line offers the skins search later. |
| R6 | B's controls | Keyboard up on entering Search (inside the center press or row tap that opens it). Typing = the query, live (the existing 250 ms debounce). The keyboard's Search/Return key and Done (or a tap outside) = keyboard down, and the wheel then walks the results (the strip's GO behaviour). With the keyboard down: the wheel walks results; the center on a result plays/drills as today; the center with no result to act on (empty query, no matches) brings the keyboard back up; a tap on the query bar brings it back up. MENU leaves Search (one level up); the keyboard's own backspace is the delete. The strip is not drawn in keyboard mode. Architect default. |
| R7 | The typed text | One pure function `searchFromTyped(raw)` in music-skins.js: at most `SEARCH_MAX` (40) characters, control characters dropped, shown as typed; `searchUrls` already trims and encodes. IME composition: apply on `compositionend`, skip `input` events with `isComposing`. Architect default. |
| R8 | The input element | ONE persistent `<input>` per pocket controller, created only when keyboard mode enters Search, in the innermost container W0 proves survives every repaint, laid exactly over the `.ipm-q` bar; computed `font-size` >= 16px (iOS zooms below 16); fully invisible (opacity 0, transparent text and caret, no border/outline/appearance); `autocomplete`/`autocorrect`/`autocapitalize` off, `spellcheck=false`, `enterkeyhint="search"`, an `aria-label`; `focus({ preventScroll: true })` called synchronously inside the opening click. Blurred and removed when Search is left, on Now Playing, a skin change, dock, destroy and nav away. Never created with the flag off. Architect default. |
| R9 | Keyboard shortcuts | Every `keydown` listener reachable on a page that hosts the pocket player must leave keys whose target is this input alone (no play/pause on Space, no seek on J/L or arrows, no DDR handler). W0 enumerates them; W2 binds each. Architect default. |

## 3. Research (what headless can and cannot prove)

- iOS raises the keyboard for `focus()` only inside a user gesture; the center press is a real `click` on the panel
  (`public/js/skin-surface.js` `bind()` registers `panel.addEventListener('click', onClick)`, and `[data-skin-select]` reaches
  `pocket.onSelect()` -> `activate()` -> `stack.push(makeLevel(node)); render()` synchronously). So the focus call goes at the
  end of that synchronous chain, never in a timer or a promise.
- The keyboard shrinks the VISUAL viewport, not the layout viewport (iOS; Chrome Android since 108 defaults to
  `interactive-widget=resizes-visual`; no shell sets `interactive-widget`, checked with `grep -rn interactive-widget public/*.html`).
  So `--pkl-h` (CSS `100dvh` based) and the LCD do not key on it, and nothing in the pocket listens to `visualViewport` except the
  rotate log. iOS scrolls to keep a focused field above the keyboard only when the field would be covered: the input sits in the
  LCD (top half), already in view. `preventScroll` stops the focus scroll itself.
- Headless Chromium CANNOT show: the real keyboard appearing, iOS's keyboard-avoidance scroll, the iOS form accessory bar,
  the visual viewport shrinking under a keyboard, or iOS focus-zoom. It CAN measure: that focus landed inside the click
  (`document.activeElement`), `scrollY`, `visualViewport.offsetTop/scale`, the LCD and panel rects before/after, the input's
  computed font-size and rect, and that typing reaches `/api/music?search=`. Everything headless cannot prove goes to
  DEVICE-CHECKS.md, and the A instrument (R3 plus W1.3's new fields) is how Dean's phone answers it.

## 4. The seams (read at 534f4a70; line numbers drift, names do not)

- A: `public/js/common.js` `ROTATE_LOG_KEY` / `rotateSample` / `installRotateDebug` (~405-525), called once at load (~16694),
  exported (~17104). `public/setup.html` Troubleshooting (~791-799, the `debug-lifecycle-check` row and its `.setup-note`).
  `public/js/setup.js` `DEBUG_LIFECYCLE_STORAGE_KEY` (~1295), `loadDebugLifecycleControl()` (~1527), the change listener in
  `wireStaticControls()` (~2950). Tests to copy the shape of: `test/unit/setup-debug-lifecycle-toggle.test.js`; existing rotate
  tests `test/unit/pocket-phone-scope.test.js` (~191-260, `rotateWin`). Censuses a new switch trips:
  `test/unit/setup-automation-reveal.test.js` (the id list ~38), `test/unit/setup-advanced-pages.test.js` (~54, ~64).
- B: `public/js/skin-surface.js` `createPocketMenu`: `isSearch` (~631), `ensureLoaded`'s search arm (~713, `pane.s`),
  `listModel`/`searchModel`/`applyStrip`/`scheduleSearch`/`setQuery`/`searchPress`/`searchWheel` (~880-990), `render()`
  (~1019; the Click style patches `.ipm-lpane` in place, other styles REPLACE the whole `.ip-menuview`), `activate()` (~1295),
  `onMenu`/`onSelect`/`onWheel`/`onItemTap`/`onPanelClick` (~1430-1510), `bind()` / `onClick` (~2399). `public/js/music-skins.js`
  `SEARCH_MAX` (~701), `searchEdit`, `searchUrls` (~739), `renderSearchBar` (~1122), `renderMenuView`. `public/js/music.js`
  the pocket `menu:` cfg (~1713, `search: menuSearch`) and `menuSearch` (~4484). Settings > Mobile player:
  `public/setup.html` ~266-286; `public/js/setup.js` its prefill/wiring. CSS: `public/css/style.css` `.ipm-q` (~8631).
  Existing tests: `test/unit/pocket-search.test.js`. Proof harness: `tools/listen-control-proof/serve.js` (seeded songs) and the
  v1.354 proofs beside it (CDP touch emulation: `Emulation.setTouchEmulationEnabled` + `Emulation.setDeviceMetricsOverride`
  with `mobile:true`).
- Keydown listeners to census (W0): at least `public/js/music.js` ~2234, `public/js/player.js` ~8179, ~8327, ~8338,
  `public/js/common.js` ~3064, ~6800, ~6963, ~10068 (`ddrKeyHandler`, CAPTURE phase); grep for more (`keydown`, `keypress`,
  `keyup`) in every script the music shells load.

## 5. Waves (one branch, one gate, one release: v1.355.0)

### W0 - Falsifiers and the census (before editing product code; record results in section 7)
1. **Container survival.** In a real browser (the proof harness, touch-emulated iPhone 393x852), open Pocket on a Click skin and
   an Original/non-Click iPod skin, go to Music > Search, and for each candidate container (the `.ip-menuview`, the LCD host
   `lcd()`, the skin panel, `document.body`) append a test input, focus it, then drive: typing a query (results render), a
   track change, the Now Playing time tick, a menu `render()`, a `renderList()`, a skin repaint (`updateNowPlayingPanel`), a
   resize. Record which keep `document.activeElement` on the input. Pick the innermost container that survives all. None ->
   stop rule (b).
2. **Keydown census.** Every keydown/keypress/keyup listener a music shell can have live (all shells that host the pocket
   player), with: does it ignore a target that is an `<input>`? Record file:line and the answer. Any that does not is a W2 fix.
3. **The pre-change baseline** for AC-B0: the exact HTML `renderSearchBar` returns for 3 fixed models on main (empty, a query,
   list focus), frozen as literals for the flag-off test.

### W1 - A: "Show rotate debug log" in Settings (R2, R3)
1. setup.html: a switch row `#debug-rotate-check` "Show rotate debug log" directly after the lifecycle row, in the same
   `ui-list`, plus a `.setup-note` line saying what it is for (the turn log; tap the panel to copy; device-local; takes effect
   at once). Same markup shape as the lifecycle row (ui-row, `role="switch" class="ui-switch"`).
2. setup.js: `DEBUG_ROTATE_STORAGE_KEY = 'ft-debug-rotate'` (MUST equal common.js `ROTATE_LOG_KEY`; better, read
   `FileTube.ROTATE_LOG_KEY` if setup.js can reach the export, one source of truth), prefill (`=== '1'`), change listener: ON ->
   set `'1'` then `FileTube.installRotateDebug(window)`; OFF -> remove the key then `FileTube.uninstallRotateDebug(window)`.
   Fix the lifecycle row's neighbour comments if they now lie.
3. common.js: make `installRotateDebug` idempotent (a second call while installed installs nothing and returns true) and add
   `uninstallRotateDebug(win)` that removes every listener it added (orientationchange, resize, screen.orientation change, the
   orientation media query, visualViewport resize), stops the pre-frame rAF ring and any running run, removes the panel and the
   probe, and clears `__ftRotateLog`. Add three fields to `rotateSample`: `sy` (scrollY), `vvo` ([visualViewport offsetLeft,
   offsetTop], rounded) and `vs` (visualViewport scale), plus `ae` (the focused element's tag and id, `''` for body), so a
   keyboard-search session on the device shows whether anything moved. Update the comment block above (~405) to say it can be
   switched in Settings and logs the keyboard too.
4. Tests (jsdom, EXECUTING the real functions; each mutated red, recorded in section 7): prefill both ways; ON writes '1' and
   installs (an orientationchange then samples); OFF removes the key and uninstalls (an orientationchange after OFF samples
   nothing; panel and probe gone; the pre-ring rAF stops); install twice = one run per event; `?debugRotate=1/0` unchanged;
   the new fields present; the censuses updated (not widened).

### W2 - B: keyboard search (R4-R9)
1. Settings > Mobile player: a switch row `#pocket-kb-search-check` "Keyboard search (experimental)" with a `.setup-note`: on an
   iPod skin, Music > Search uses the phone's keyboard instead of the wheel's letters; off by default; this device only. Prefill
   and immediate-apply exactly like W1's switch (localStorage `ft-pocket-keyboard-search`, '1' / removed).
2. music.js: the pocket `menu:` cfg gains `keyboardSearch: function () { ... }` reading that key live (try/catch -> false).
3. skin-surface.js, `createPocketMenu`: when `activate()` pushes a `search` node and `cfg.keyboardSearch()` is true, mark the
   pane `s.kb = true`, create the input (R8) in the W0 container, position it over `.ipm-q` after `render()`, and focus it with
   `preventScroll` in the same synchronous turn. `input` (not composing) and `compositionend` -> `setQuery(pane,
   SK.searchFromTyped(value))`, the existing seam (no second fetch path, no second debounce). Return key (`keydown` Enter on the
   input) and `blur` -> keyboard down and focus `list` when a result row exists (R6). Wheel/center/MENU/tap per R6. Re-position
   the input after every `render()` while it exists (the bar can move on a re-layout). Every exit path in R8 blurs and removes
   it; exactly one input ever exists.
4. music-skins.js: `searchFromTyped` (R7) exported; `renderSearchBar(s)` draws the query bar WITHOUT the strip when `s.kb`
   (a class on the bar, e.g. `is-kb`), and is byte-identical to v1.354 for any model without `kb` (W0.3 literals).
   `searchModel` passes `kb` through.
5. CSS: the input's rule (scoped to the pocket iPod, phone and pop-out like `.ipm-q`); the `is-kb` bar if it needs any.
   Tokens or counted `token-exempt` per the UI ratchet; the 16px floor must hold at every skin's LCD scale (measure the computed
   value, the LCD may be transformed: if a transform scales the input below 16 effective px, iOS still zooms; W2.6 measures).
6. Keydown fixes from W0.2, each bound by a test that dispatches the key with the input as target and asserts the handler did
   nothing (and a mutant restoring the old guard reds it).
7. Tests (each mutated red, recorded): flag off -> no input in the document after open/type/close, `renderSearchBar` equals the
   W0.3 literals, the strip path unchanged (existing `pocket-search.test.js` green, untouched); flag on -> open creates exactly one
   input and focuses it inside the same call stack as `onSelect`; typing calls `cfg.search` once per settled query with the typed
   text (fake timers); Return and blur -> list focus when results exist; center with no results -> focus again; MENU -> input
   removed and the level popped; Now Playing / destroy / skin change -> removed; re-entry -> one input; `searchFromTyped` caps and
   strips control characters (build them programmatically, LESSONS 1: never type raw control bytes); the skins search never
   creates an input with the flag on (R5).
8. **Real-browser proof** (`tools/listen-control-proof/kb-search-proof.js`, output JSON committed beside it): seeded songs,
   touch-emulated iPhone 393x852 AND 375x667, Click skin AND a non-Click iPod skin, flag ON: a real CDP click on the center opens
   Search; `document.activeElement` is the input right after the click; type via `Input.insertText` -> a request to
   `/api/music?search=<text>` is seen and result rows render; before vs after focus and after typing: `scrollY`,
   `visualViewport.offsetTop`, `visualViewport.scale`, the LCD rect and the panel rect are identical; the input's computed
   font-size >= 16 and its effective on-screen height >= 16 * (its own font box) (no transform shrink); the input's rect lies inside
   the `.ipm-q` rect; the LCD's bottom edge y is recorded (to compare with the iPhone keyboard's top on device). Flag OFF: same
   open, no input exists, the strip is drawn, the wheel types. Report every number from the JSON, never from memory.

### W3 - Docs and release prep (the Architect does the release itself)
- `docs/DEVICE-CHECKS.md`: add the v1.355.0 lines (section 8 below). Mark the two rotate checks (v1.350 turn back, v1.354
  Transparent turn) as now doable in the home-screen app via the switch.
- ROADMAP.md Planned: "Keyboard search for the skins list" (R5), and anything else found.
- Do not bump the version, write the ledger, or close the plan: the Architect does the release.

## 6. Acceptance (each line measurable; the gate measures against these)

- **AC-A1** Settings > Troubleshooting shows "Show rotate debug log"; it reflects `ft-debug-rotate` on load; ON sets '1' and the
  log is live in this window with no reload; OFF removes the key and the log stops and its panel is gone with no reload.
- **AC-A2** `installRotateDebug` is idempotent; `uninstallRotateDebug` leaves no listener or rAF running (bound by counting).
- **AC-A3** `rotateSample` carries `sy`, `vvo`, `vs`, `ae`.
- **AC-B0** Flag off (the default): no input element is ever created; the search bar HTML is byte-identical to v1.354 for the
  frozen models; every v1.354 search test passes unchanged.
- **AC-B1** Flag on, real browser, iPhone metrics: the opening center click focuses the input (same click); typing reaches
  `/api/music?search=` and results render; `scrollY`, `visualViewport.offsetTop`, `visualViewport.scale`, the LCD rect and the
  panel rect do not change on focus or typing; the input's font-size is >= 16px effective.
- **AC-B2** No keydown handler acts on a key typed into the input (W0.2's list, each bound).
- **AC-B3** Exactly one input while Search is open in keyboard mode; none after any exit path in R8.
- **AC-B4** R6's controls, each bound by a test.

## 7. Build log (the builder fills this in: W0 numbers, deviations, mutants per wave, suite results verbatim)

### W0 evidence (at 777a1ec9, before any product edit)

**W0.1 container survival.** Probe: the real server (`tools/listen-control-proof/serve.js`, 3 seeded songs), headless
Chromium, 393x852 at DPR 3, `isMobile`, `hasTouch`, an iPhone UA, `--autoplay-policy=no-user-gesture-required`. Path: `/music?play=song1`
-> MENU -> Music -> Songs -> Proof Song 1 (a queue of 3) -> MENU -> MENU -> Music > Search. For each candidate a fresh page,
a 16px test input appended to the candidate and focused (`preventScroll`), then the drivers in order, each followed by "is
`document.activeElement` still the input, and is it connected": a typed letter through the strip (`render()`), the
debounced results (5 rows rendered), a list scroll (`renderList()` on the next frame), 1.5 s of play (the time tick /
`reflect`), a track change through the wheel's next zone (`paint()` -> `afterPaint` -> `render()`, i.e.
`updateNowPlayingPanel`), a resize (393x852 -> 393x800 -> back). Driven by synthetic `click` events (a real click would
move focus itself). Results, identical on `ipod-charcoal` (Classic 6G) and `ipod-original` (the Original look):

| candidate | type: render | results | renderList | time tick | track change (paint) | resize |
|---|---|---|---|---|---|---|
| `.ip-menuview` | lost | lost | lost | lost | lost | lost |
| `.ip-lcd-in` (`lcd()`) | kept | kept | kept | kept | **lost** | lost |
| `#music-nowplaying-panel` | kept | kept | kept | kept | **lost** | lost |
| `document.body` | kept | kept | kept | kept | kept | kept |

The Click render patches `.ip-menuview` in place but removes every child except the split and the two jump layers, so a
child input dies on the first render; `paint()` rebuilds the panel with `panel.innerHTML = ...`, so anything inside the
panel (the LCD included) dies on every track change. **Chosen: `document.body`** of the panel's own document (the only one
that survives all), `position:fixed`, laid over the `.ipm-q` rect after every render. Not stop rule (b). Side benefit: no
ancestor transform scales it, so its 16px font is 16 effective px.

**W0.2 keydown census** (every keydown/keypress/keyup listener a shell that hosts the pocket can have live; lines at
534f4a70). Element-scoped listeners (common.js 3008 sortable handle, 16809 header search input; ui.js 657, 891, 947;
podcasts.js 1192; setup.js 2368, 2493, 2615, 2727, 3190; music.js 3095) listen on their own element and never see a key
typed into another input. The document/window ones:

| listener | phase | acts on | ignores an `<input>` target? |
|---|---|---|---|
| music.js:2234 | bubble | Escape hides the desktop actions menu | **no** |
| player.js:8179 | bubble | the desktop shortcuts | yes (activeElement INPUT/TEXTAREA/BUTTON/SELECT/A) |
| player.js:8327 | bubble | Escape leaves the expanded audio view | **no** |
| player.js:8338 | bubble | R/S on the resume toast | yes (`isTypingContext`) |
| player.js:2603 | window capture, passive | any key ends the rotation scroll-snap window | no, but takes no key action |
| common.js:3064 | bubble | Escape abandons a sortable-row drag (only during a press) | **no** |
| common.js:6800 | bubble | Tab trap of the avatar crop sheet (only while it is open) | **no** |
| common.js:6963 | bubble | Escape closes the header search | **no** |
| common.js:10068 | capture | the DDR arrows, only while the shortcuts dialog is open (it takes focus) | **no** |
| common.js:10116 | capture | Escape closes the shortcuts dialog when open; D and ? on desktop | yes for D and ? (INPUT tag); Escape only with the dialog open |
| ui.js:557/582 | bubble | Escape dismisses the top sheet (only while a sheet is open; a sheet takes focus on open) | **no** |
| ipod-brick.js:356 | capture | Escape stops Brick (only while the game runs) | **no** |
| read.js:1071 | bubble | arrows flip the book (reader view only, signal-scoped) | yes (INPUT/TEXTAREA/SELECT) |
| remote.js:260 | capture | marks user activation on a speaker (observes only) | no, but takes no key action |

W2 fix (one seam, a deviation from "a guard per handler", see Deviations): the keyboard-search input stops the propagation of
keydown/keypress/keyup at itself, so NO bubble listener on document or window ever sees a key typed into it (music.js:2234,
player.js:8327, common.js:3064/6800/6963, ui.js's sheet keys, and every future bubble listener). The capture listeners run
before the target: common.js:10068 and ui.js need a dialog/sheet that takes the focus away first, ipod-brick.js:356 needs the
game, which starts only from Extras (leaving Search removes the input), common.js:10116 already ignores inputs for D and ?,
and player.js:2603 / remote.js:260 take no key action. W2's census test fails on any NEW capture-phase key listener until it
is classified.

**W0.3 the flag-off baseline** (`renderSearchBar` on 534f4a70 for three fixed models, frozen as literals in
`test/unit/pocket-kb-search.test.js`): `{q:'', sc:0, focus:'strip'}`, `{q:'NIG', sc:13, focus:'strip'}`,
`{q:'PRO', sc:38, focus:'list'}`.

### W1 evidence

Built (9a218b67): the `#debug-rotate-check` row right after the lifecycle row in the same list, its own `.setup-note`;
setup.js `loadDebugRotateControl` / `wireDebugRotateControl` read `ROTATE_LOG_KEY`, `installRotateDebug` and
`uninstallRotateDebug` from common.js at call time (no second copy of the key); common.js `installRotateDebug` keeps a
per-window handle (a second call while live returns true and installs nothing), `uninstallRotateDebug` takes back every
recorded listener (window orientationchange + resize, screen.orientation, the orientation media query, visualViewport),
cancels and stops the pre-frame ring and any run in flight, removes the panel and the probe and deletes `__ftRotateLog`;
`rotateSample` adds `sy`, `vvo`, `vs`, `ae`. Tests: `test/unit/setup-debug-rotate-toggle.test.js` (9, jsdom, the real
log and the real switch; listeners counted on every target; the rAF queue counted). Censuses carried the new row:
setup-automation-reveal FOREIGN, setup-advanced-pages Troubleshooting, settings-forms-sweep switch count 28 -> 29 (the
first W1 commit attempt was REFUSED by the pre-commit hook on exactly that census, `Settings (F09): every checkbox is a
ui-switch with role=switch; there are 28`, 1 fail; fixed, re-committed), setup-debug-lifecycle-toggle's hint regex
(the rotate row now sits between the lifecycle row and the list's end).

W1 mutants (sandbox `git archive`, `node --test --test-timeout=20000`, exact-once, restored, sandbox diff identical):

| id | mutation | red (by name) |
|---|---|---|
| A1 | install not idempotent | installRotateDebug is idempotent - a second install while live installs nothing |
| A2 | dispose leaves the listeners | OFF removes the key and takes the log down at once |
| A3 | the pre-frame ring ignores OFF | OFF removes the key ... |
| A4 | a run in flight ignores OFF | OFF removes the key ... |
| A5 | panel left up | OFF removes the key ... |
| A6 | probe left | OFF removes the key ... |
| A7 | `__ftRotateLog` kept | OFF removes the key ... |
| A8 | Settings ON does not install | ON stores "1" and the log is live ... ; OFF removes the key ... |
| A9 | Settings OFF does not uninstall | OFF removes the key ... |
| A10 | OFF stores '0' | OFF removes the key ... |
| A11 | prefill: any stored value is on | the switch reflects ft-debug-rotate on load, both ways |
| A12 | init no longer prefills | at 9a218b67 SURVIVED; at 2f75b2f9 red: init() prefills the switch (loadDebugRotateControl) |
| A13 | wireStaticControls no longer wires | at 9a218b67 SURVIVED; at 2f75b2f9 red: the real setup.html switch, wired by the real wireStaticControls() |
| A14 | `sy` dropped | each row carries sy, vvo, vs and ae |
| A15 | `vvo` reads offsetLeft twice | each row carries ... |
| A16 | `vs` fixed at 1 | each row carries ... |
| A17 | `ae` reports body | each row carries ... |
| A18 | the vv-resize listener not recorded | OFF removes the key ... |

### W2 evidence

Built (2f75b2f9, tests and proof 51c86fb5): see the W2 commit message. The input is `input#ipm-kb.ui-field__input.ipm-kb`
(the field primitive's 16px font; style.css `.ipm-kb`: fixed, `z-index: calc(var(--z-player-max) + 1)`, opacity 0,
transparent text and caret), in `doc.body`, created by `kbSync()` at the end of every `render()` while a keyboard-mode
Search level is on screen, removed otherwise (and by a MutationObserver on the panel when the view empties it without a
render, i.e. a dock, and by `destroy()`). R6 as specified; two refinements: the blur's hand-over to the results runs one
turn later (a tap on a result row blurs first and clicks second; re-drawing the rows inside the blur would swap them out
from under the click), and turning the wheel while the keyboard is up with results puts it down and walks them.

Tests: `test/unit/pocket-kb-search.test.js` (23): searchFromTyped (control characters built with String.fromCharCode,
the 40 cap counted in whole characters), renderSearchBar against the W0.3 literals, keyboardSearchOn, flag off end to
end (no input ever, the strip types), flag on: opening by center press and by row tap (focused in the same call stack,
`focus({preventScroll:true})` exactly once), typing through the debounce (one read, the text as typed), IME, Enter, blur,
late results, the wheel's top row, the wheel with the keyboard up, the center with nothing to act on, MENU, a drill and
back, Now Playing, a skin change to Cider, a repaint, a dock, destroy, re-entry (one input), the placement (rect, render,
resize), the key stop (16 keys x keydown/keypress/keyup, nothing reaches body/document/window bubble listeners; the
control reaches all three), the skins search (no input, the flag not even read), music.js's live reader, the Settings
switch, and the R9 census (every key listener in public/js and lib/ytdlp/client classified; it reds on any new one).

W2 mutants (2f75b2f9, then 51c86fb5 for the re-runs; sandbox diff identical each time):

| id | mutation | red (by name) |
|---|---|---|
| B1 | the input no longer stops key propagation | no page key handler sees a key typed into the input |
| B2 | no focus inside the opening press | center press opens Search ...; row tap ...; typing ...; the Search key ... (4) |
| B3 | keyboard mode ignores the flag | flag OFF ...; row tap ... (live read) |
| B4 | the skins search gets keyboard mode | the skins search stays on the strip (R5) |
| B5 | kbRemove leaves the node | Search key ...; MENU ...; Now Playing/skin/dock/destroy ...; drill ...; Now Playing from the menu (5) |
| B6 | MENU in keyboard mode deletes a letter | MENU leaves Search at once |
| B7 | center with nothing to act on presses the strip | the center with nothing to act on brings the keyboard back up |
| B8 | Enter does not blur | the Search key (Enter) puts the keyboard down |
| B9 | blur does not hand the wheel to the results | the Search key (Enter) ... |
| B10 | composing input events applied | an IME composition applies on compositionend |
| B11 | compositionend not listened | an IME composition ... |
| B12 | control characters kept | searchFromTyped ...; typing feeds ... |
| B13 | no cap | searchFromTyped ... |
| B14 | a dock leaves the input | Now Playing, a skin with no menus, a dock ... |
| B15 | destroy leaves the input | Now Playing, a skin with no menus, a dock ... |
| B16 | no kb bar | renderSearchBar ...; center press ...; drill ... |
| B17 | input in the panel | center press ... (in the body); Now Playing/.../a repaint keeps it |
| B18 | late results not walked | a blur (Done, a tap outside) ... late results |
| B19 | up past the first result goes to the strip | at 2f75b2f9 SURVIVED; at 51c86fb5 red: one wheel detent up on the first result stays on it |
| B20 | no keyboard-mode wheel branch | at 2f75b2f9 SURVIVED; at 51c86fb5 red: turning the wheel while the keyboard is up with results |
| B21 | no write-back of the cleaned text | typing feeds the existing debounced read |
| B22 | music.js never turns it on | music.js hands the engine a LIVE keyboardSearch reader (a source lock: the cfg closure is not reachable from a unit test) |
| B23 | Settings OFF stores '0' | Settings > Mobile player ... |
| B24 | Settings prefill: any value on | Settings > Mobile player ... |
| B25 | keyboardSearchOn: any value on | keyboardSearchOn: only the stored literal "1" is on |
| B26 | a new unclassified capture key listener (music.js) | R9 census |
| B27 | placement never runs | at 2f75b2f9 SURVIVED; at 51c86fb5 red: the input lies exactly over the query bar |
| B28 | kbWanted always true | flag OFF ...; row tap ... |
| B29 | no resize re-placement | the input lies exactly over the query bar ... |

`preventScroll` is bound by the focus-arguments assertion added in W3 (headless shows no difference either way: the
input is fixed and in view).

**Real-browser proof** (`node tools/listen-control-proof/kb-search-proof.js`, exit 0, `kb-search-proof-out.json`,
copied from the file): flag ON, all four rows (393x852 and 375x667 x ipod-charcoal and ipod-original): `title` "Search",
`activeAfterTap` "input#ipm-kb" (right after the real CDP touch tap on the center), `inputs` 1, `strip` false,
`input.parent` "body", `fontSizePx` 16, `onScreenScale` 1, `effectiveFontPx` 16, `inside` true (input rect = .ipm-q rect:
[26,239,167,34] charcoal 393, [26,239,341,34] original 393, [26,225,158,34] charcoal 375, [26,225,323,34] original 375),
`searchRequests` ["/api/music?search=Proof&sort=title-asc&limit=30"], `resultRows` Songs / Proof Song 1-3 / Albums /
Proof Album / Artists / Proof Band, `activeAfterType` "input#ipm-kb", `unmoved` {focus: true, typing: true}: at 393x852
before = after focus = after typing = {sy 0, vvTop 0, vvScale 1, lcd [20,16,353,264.75], panel [0,0,393,852]};
`lcdBottomY` 280.75 at 393x852 and 267.25 at 375x667. Flag OFF (393x852, both skins): `inputs` 0, `strip` true, the
center typed `query` "A", `inputsAfterType` 0, `activeAfterTap` "button" (Chromium focuses the tapped center, as v1.354).
The first run's two flag-off rows read ok:false on a check of mine (focus unchanged by the tap); the check was wrong (the
center button takes focus on a tap in Chromium on v1.354 too), corrected to "focus is not an input", re-run: 6/6 ok.

**Headless cannot prove** (device checks, section 8): the iOS keyboard itself, iOS's keyboard-avoidance scroll, the form
accessory bar, the visual viewport shrinking under the keyboard, iOS focus-zoom, and whether iOS raises the keyboard for a
focus() inside a click re-dispatched from the haptic ghost (the wheel's invisible switch covers the center on capable
iPhones: `onClick` re-dispatches `under.click()` synchronously inside the same click, so the gesture should hold, but
only the phone can say). The rotate log (W1, now with sy/vvo/vs/ae) is the instrument for all of these.

**Full dual-Node suite** at 51c86fb5, sequential (`npm test`): Node 22.23.1 `# tests 10746`, `# pass 10734`,
`# fail 0`, `# skipped 12`, exit 0; Node 24.20.0 `ℹ tests 10746`, `ℹ pass 10734`, `ℹ fail 0`, `ℹ skipped 12`, exit 0.
`npm run lint:ui`: "ui-lint: OK - the live debt equals docs/ui-exceptions.json" (TOTAL 3181, unchanged);
`node scripts/overlay-containment-lint.js --enforce`: "overlay-containment: clean (0 violations)".

### Deviations

1. **R9 / W2.6 mechanism:** one seam instead of a guard per handler. The input stops keydown/keypress/keyup at itself,
   so no bubble listener (music.js:2234, player.js:8327, common.js:3064/6800/6963, ui.js's sheet keys, and any future one)
   can see a typed key; the capture listeners are classified with reasons in the R9 census test, which fails on any new
   key listener. Bound by one dispatch test (B1) plus the census (B26), not one mutant per handler.
2. **R8 container:** `document.body` (W0.1: the only container that survives `paint()`), so the input is `position:fixed`
   over the bar rather than inside the LCD; it sits above the skin (`z-index: calc(var(--z-player-max) + 1)`) so a tap
   on the bar reaches it natively. The 16px comes from the `ui-field__input` primitive (its `--fs-input-min`), since a
   new `--fs-*` use is UI-ratchet debt and no `--t-*` role is 16px.
3. **Settings placement:** the Keyboard search group sits ABOVE the Music skin group in Mobile player, because
   setup-sticker-picker.test.js locks the skin grid as the section's last block (v1.350); not changed.
4. **A skin change** between two Click skins keeps the Search level (and its input): the stack survives a same-style
   repaint; a change to a skin with no menus (Cider, Nordic) removes it. R8's "skin change" is read as the latter.
5. W2.7 "fake timers": the debounce tests use real waits, as `pocket-search.test.js` does (the engine's timers are the
   jsdom window's).


## 8. Device checks owed (to DEVICE-CHECKS.md at release)

- v1.355.0 - In the HOME-SCREEN app: Settings > Troubleshooting > Show rotate debug log ON, go to Music, turn the phone: the green
  log appears. OFF: it is gone at once.
- v1.355.0 - Keyboard search OFF (the default): Music > Search on the iPod is the wheel letter strip, unchanged.
- v1.355.0 - Keyboard search ON (Settings > Mobile player): Music > Search brings up the phone's keyboard; typing narrows the
  results; NOTHING on screen moves, shrinks or zooms as the keyboard comes up or goes down (screen-record it with the rotate log
  ON and send the rows if anything does); Search key / Done puts the keyboard away and the wheel walks the results; MENU leaves
  Search.

## 9. Gate record

(seats write their verdict lines here, bound to the sha they reviewed)
