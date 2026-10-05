---
plan: small-phones-pocket-downloads-vr
harness: v2 · lean
branch: one branch per release (named in section 3)
anchor: spec
status: Approved @fc9fb7c5
next: Release A, W0 housekeeping commit on feat/v1.364.0-small-phones-pocket (the plan is committed there), then W1 + W2 in parallel worktrees
design: Approved 2026-10-05 @fc9fb7c5 (Dean's Q&A in the kickoff; every ruling in section 1 is his answer)
gate: pending
---

# Small phones (iOS 15), the iPod center hold and a way into the iPod, stuck-or-stale downloads, VR / 360

Written 2026-10-05 by the Architect (Opus) for an Opus builder (Dean's call, given the scope), from main `cdd3a07d` (v1.363.2). This plan is the
only context you get. Execute it in the order of section 3. Do not add scope: anything not written here goes to
ROADMAP.md Planned and you move on. Never guess a product decision: the rulings are in section 1; if a case is not
covered, STOP and AskUserQuestion.

## 0. Rules (read before touching anything)

1. Read `AGENTS.md`, then `docs/LESSONS.md` sections 0, 1, 2 and 13, then the section of your wave.
2. **Every shell:** `export PATH="$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH"` before ANY
   npm, node or git command (the hooks run node). Node 24 for the second suite:
   `$HOME/.local/share/fnm/node-versions/v24.20.0/installation/bin`. Node 24's reporter prints `ℹ`, not `#`: an empty
   grep is not green; read the exit code unpiped.
3. **Diagnosis discipline (LESSONS 1).** Every wave starts with its falsifier (named in the wave). Run it before
   editing. A wave whose falsifier contradicts this plan STOPS and asks Dean.
4. **Git:** worktrees in `.claude/worktrees/<name>`; branch from `origin/main`; `git checkout -b` BEFORE the first
   edit; stage files BY NAME (never `git add -A`/`.`/`commit -a`; one missing path aborts the whole add, so check
   `git diff --cached --stat`); commit with `git commit -F <file>` (no backticks in `-m`), run long commits in the
   background and poll, verify with `git log -1`; never `--no-verify`, never force-push, never pipe a commit or a
   push. A worktree has no `node_modules`: `ln -s /home/coder/projects/filetube/node_modules node_modules` before a
   commit, `rm node_modules` after, never stage it. `git branch --show-current` before every commit.
5. **Mutants only on COMMITTED work**, in a `/tmp` `git archive` sandbox with a pristine copy to diff against;
   confirm each mutation LANDED (diff non-empty) and that the named test goes red BY NAME.
6. **Numbers are copied from an instrument** run on the staged tree (LESSONS 1): never typed from memory.
7. **No em dashes** in docs or user-facing text; plain hyphens. User-facing copy is plain words.
8. **Autonomy:** Dean approved build, gate, merge and tag on green. AskUserQuestion ONLY at a STOP rule below or a
   real product fork not covered in section 1. Do not narrate ceremony; one line when a gate round closes.
9. **Gate pacing:** ship on CRITICAL/WARNING closure; after 2 CHANGES rounds on one release, ASK Dean before round 3.
10. **Testing cadence:** targeted tests while building; full `npm test` on both Nodes once per release before the
   gate (and after any route, markup, DOM-id or settings change; LESSONS 2: the unit hook hides a red integration
   suite). Sequential, never two suites at once, never while a seat works the tree. Docs-only commits run no suite.
11. **Measure UI changes** (memory norm): probe before and after in a real browser; rows wrap, buttons never shrink.
   Playwright: `tools/capture/node_modules/playwright`; the seeded fixture via `test/visual/server.js` `seed()` +
   `boot()`; login and phone context as in `test/visual/capture.js`. Headless WebKit: the repo's Playwright wants
   webkit-2336 (not installed); `/home/coder/projects/tasksync/web/node_modules/playwright` drives the installed
   webkit-2248.

## 1. Outcomes and Dean's rulings (2026-10-05)

| # | Outcome in Dean's terms | Rulings (binding) |
|---|---|---|
| 1 | The app works on his small phone (an iPhone SE on **iOS 15.x**, Dean's answer), and every mobile size works: nothing hard-coded for small OR big. | Not reproduced in headless Chromium or WebKit at 7 sizes (section W1 facts). Layout is NOT the lead; iOS 15's engine is. Fix only what an instrument names. |
| 2 | He can tell a "stuck" one-off download from a "stale" screen without restarting the container. | Build the instrument + the staleness UI; no server hang theory-fix. The ROADMAP item stays open. |
| 3 | Look around inside 360 / 180 videos on phone and desktop (drag, tilt), never affecting normal video. | Default OFF; never touches non-VR video; ships in its own release, last; must not block the others. |
| 4 | In the iPod view, hold the center button: the volume bar. | **Speaker only** (Dean's pick): with a speaker on, the hold opens the existing volume bar. With the phone playing itself, the hold shows a short LCD note "Use the side buttons" and does NOT fire the tap. iPhone Safari ignores page volume writes. |
| 5 | Housekeeping: the hold-lock, the watch-page bump and the Pocket turn are confirmed on device. | Mark done; drop matching device checks (W0 lists them exactly). |
| 6 | **New (Dean, mid-kickoff):** open the app on the phone and reach the iPod view in 1-2 taps WITHOUT picking a song, to use the phone as a remote (pick a speaker). | His words: "within 1 to 2 taps get to the click ipod view. i may want to use my phone as a remote and not choose a song to then pause to then go to speaker". Design in W2b. |
| 7 | The music "Add chapters" row sits left like its neighbours. | Match the siblings exactly (W2c). |

Architect intake (where the problem got smaller):
- Item 1: four probes found no layout fault (tiles, `#view-root`, every bottom button hit-tests itself at all 7
  sizes, both engines). On iPhone, Chrome, Safari and the home-screen app share one WebKit, which matches "the same in
  all three". A grep census of the usual post-iOS-15 APIs found every one absent or guarded. So the fix needs the
  phone's actual error text: W1 builds the instrument that captures it, plus a viewport-matrix net that keeps every
  size honest from now on. It does NOT refactor existing breakpoints (no instrument shows them broken).
- Item 2: reading the code found the "stale" producers already (below). They are defects whatever the hang turns out
  to be, so fixing them is not a theory-fix. The server suspicions get a trace, not a fix.
- Item 3: the WIP uploads live video frames to WebGL (`texImage2D(video)`) and, for big frames, `drawImage(video)`
  onto a 2D canvas: the second is exactly the v1.312 shape that blacked out every iPhone video. Cut the drawImage path;
  keep default off; ship last.
- Item 4: the volume bar exists only while a speaker is on, so "speaker only" is the whole feature, not a limitation.
- Item 6: Pocket today shows with no local song only when a speaker is attached; there is no other way in.

## 2. Verified facts the waves rely on (file:line on main cdd3a07d; re-read before editing)

ROADMAP.md: SE bug 123; Pocket turn ~58 px 135; giant LCD 193; watch-page bump 278; one-off stuck 322; hold-lock
idea 447; VR 457-479; "Device checks owed" index 7-62. DEVICE-CHECKS.md: 44 open `- [ ]` lines.

Pocket (W2): center `<button class="ip-center" data-skin-select>` `public/js/music-skins.js:265`. Wheel binding
`skin-surface.js` `bind()` 2580-2595 (`onClick` + `onDown`). `onDown` 3033: returns early on a dead-center press at
3046 (`r.width * DEAD_FRAC`, `DEAD_FRAC` 0.20 in `wheel-config.js:24`), so a center press gets NO gesture state today;
`test/unit/music-skins.test.js:396-408` source-locks that line. Center click order `onClick` 2670-2684 (takeover,
close volume, list mode, pocket menus, Now Playing -> up-next; remote with no rows does nothing). MENU hold:
`HOME_HOLD_MS = 600` at 1739, armed 3105-3117, fires `hapticLetterTick` + `endWheel(st, true)` (swallows the release
click via `wheelSuppressClick` 3018, consumed 2599), cancelled by >8 px move (3152) and every `endWheel` path (3007).
Fast-scan hold 3075-3098. Volume engine 1829-1895: `volumeShowable()` 1848, `openVolume()` 1860, `closeVolume()`
1868, exported 3299-3300; available only when `remoteOn() && !remoteDocked` (`music.js:1702-1706`). Haptic ghost: a
`<input type=checkbox switch>` over the whole wheel incl. the center (`mountWheelGhost` 2809-2828), clicks re-routed
via `realTargetUnder` 2905-2918. Haptics hard rules `docs/exec-plans/active/2026-09-03-wheel-haptics.md:26-32` (no
`touch-action` on the switch's ancestors; never `preventDefault` a touchstart/touchmove meant for the switch).
Shared app long-press: `FTInteraction.LONG_PRESS_MS = 450` (`interaction.js:47`, loads AFTER skin-surface.js; its
engine preventDefaults touchmove, which breaks haptics rule 2). Panel show/hide: `music.js` `updateNowPlayingPanel`
2790 (speaker arm 2797; local arm hides at 2810-2828); `skinIsActive` 1593-1599 needs track meta; `skinActiveFor`
`music-skins.js:560-562` needs a phone. No-track landing exists: `landOnMusic` / `landPlayOn(false)` (skin-surface.js
1417-1433, 1634-1638). MENU on the Main menu docks (2667) -> local `pl.dock()` (`music.js:1662`) assumes a track.
`/music?nowplaying=1` with nothing loaded hides the panel (`music.js:5011`, 5077, 5106-5118). Bottom-bar Music tab
`public/index.html:368`, hidden by default (`common.js:5337` `BOTTOM_NAV_DEFAULT_HIDDEN`), shown by the user's bar
customizer; a tap on the same URL is swallowed (`isSameLocationNav` `common.js:10404`, applied 11437-11443).
Jsdom pointer tests: `test/unit/pocket-home.test.js:79-81`; stub `wheel.getBoundingClientRect` (jsdom rects are 0, so
the dead-center test never trips otherwise; `skin-surface.test.js:1276`) and `document.elementsFromPoint` (1282).

One-off downloads (W3): state is in-memory only, `lib/ytdlp/activity.js:46-49` (`oneShots`), merge-stamped
`updatedAt` (67-74), terminal pruned after 5 min (44, 92-100). Lifecycle: route `lib/ytdlp/index.js:6286`
(queued 6408) -> `launchOneShotJob` 4206 -> `heavyGate.runExclusive` (no timeout, `lib/heavyGate.js:71-104`) ->
`runOneShot` 4432 (downloading 4503) -> `run.runDownload` (`lib/ytdlp/run.js`, settles on `'close'` 1332 or `'error'`
1324, stall SIGKILL 1102-1109, 180-min timeout 1313-1319, subtitle retry spawns a second child 2152-2171) -> post-
process -> done 4856. Cancel 6499-6568. `sweepStuckOneShots` 627-641 runs ONLY inside `GET /api/subscriptions/status`
(7354), never touches `queued` (7351-7353) or an entry with a registered child (631). Durable: pending set
`lib/ytdlp/pending.js:27`, `ytdlp-runs.jsonl` (`runlog.js:45`), `ytdlp-failures.jsonl` (`faillog.js:41`). No server
log buffer exists. Client: the corner chip `injectDownloadStatusChip` `common.js:15805-16124`, poll `pollOnce`
16020-16072 (`.catch` 16068-16070 only backs off: the row freezes with no sign); the health probe at 15813-15836 sets
`dlStatusChipInjectStarted` (14961) BEFORE the fetch and never resets it, so one failed probe kills the chip for the
tab silently (16123); `updatedAt` is never shown. /subscriptions page `lib/ytdlp/client/subscriptions.js`
`pollStatusOnce` 4125-4187, error branch 4176-4184 (console only, last-known-good kept). Log norm:
`docs/references/log-collection-pattern.md`; helper `exportDiagnosticLog` `common.js:14800-14844`; Troubleshooting
`public/setup.html:826-857`, wiring `public/js/setup.js:1688-1826`.

VR (W4): local branch `feat/v1.340-vr-360` = `477d3444` (WIP: `lib/media/projection.js` 140 lines,
`public/js/vr-view.js` 436 lines; nothing references them) + `81f258bf` (ROADMAP only). Merge-base `9979253f`, 498
commits behind main: do NOT rebase; port the two files. Projection fields in the WIP: `projectionOverride` (owner),
`projection` (from the file), plus `width`/`height`; precedence override > metadata > file name.
`vr-view.mount(video, host, projection, opts)` returns null on no WebGL; uploads `texImage2D(..., video)`; shrinks
frames over `MAX_TEXTURE_SIZE` with `drawImage(video)` (the v1.312 iPhone blackout shape). ffprobe args
`server.js:2630-2638` (`stream_side_data=rotation` at 2633), callers `lib/scan/orchestrator.js:174`, `server.js:1439`,
2471 (reheat), 2659 (codec-only); parsed in `parseFfprobeStreams` `orchestrator.js:98-150`. `chaptersManual` pattern:
route `lib/media/routes.js:1919` (`requireModifyLibrary` first 1920, `restrictedVideoMutation` 1921, `ownMediaItem`
1956, clear deletes the key 1971); serve 797-814; scan re-init carry `orchestrator.js:1192-1197`; Phase-2 mirror
1507-1517 (scalar analogue `channelAttributedManually` 1655-1680); classification
`test/integration/route-write-classification.test.js:115` + VISIBILITY 271; proto net
`test/integration/media-write-proto-ids.test.js:51`; tests `test/integration/chapters-editor.test.js:102,138-170`;
`chaptersManual` shipped with NO schema bump (`git log -S chaptersManual -- lib/db/sqlite.js` is empty). Route count
`test/integration/rbac-census.test.js:77` `EXPECTED_ROUTE_COUNT = 263`. Cog rows: `player.js` `syncChaptersEditRow`
8791-8812 (per-item action) or `watch.js` `ensureCogControlsInjected` 2255-2292 (toggle). Ambient never reads the
video (`ambient.js:46-58`). `test/unit/player-overlay-no-filter.test.js` fails any filter/backdrop/mask/blend on a
player-hosted selector.

## 3. Waves, branches and releases

| Release | Version | Branch | Waves | Gate |
|---|---|---|---|---|
| A | v1.364.0 | `feat/v1.364.0-small-phones-pocket` | W0 docs, W1 small phones, W2 iPod hold + way in + chapters row | adversary + qa |
| B | v1.365.0 | `feat/v1.365.0-oneoff-trace` | W3 stuck or stale | FULL: adversary + qa + security-brief |
| C | v1.366.0 | `feat/v1.366.0-vr-360` | W4 VR / 360 | FULL: adversary + qa + security-brief |

Parallelism: W1 and W2 build in two worktrees on sub-branches (`.../w1`, `.../w2`) cut from the release branch after
W0, merged `--no-ff` into the release branch before its gate. W3 and W4 may build in their own worktrees from
`origin/main` at the same time. Releases land in order A, B, C; before B and C gate, merge the new main into the
branch (expected conflict: `public/setup.html` Troubleshooting, touched by W1 and W3). If C stalls on a STOP, A and B
ship regardless.

## W0 - Housekeeping (docs only; first commit of release A; no suite run)

Dean confirmed these on device. In ROADMAP.md:
- 447 "Idea: lock the hold-to-speed-up by dragging down": `- [ ]` -> `- [x]`, append " - SHIPPED v1.358.0, confirmed on
  device 2026-10-05 (Dean)".
- 278 "Bug: after rotating back to portrait the page bumps up and down": `[x]`, "- FIXED v1.341.3, confirmed on device
  2026-10-05 (Dean)".
- 135 "Pocket turn back upright: the skin sits ~58 px low": `[x]`, "- FIXED v1.357.0, confirmed on device 2026-10-05
  (Dean)".
- 193 "Bug: the turn back to portrait flashes a giant LCD": `[x]`, "- confirmed fixed on device 2026-10-05 (Dean)".
- Leave untouched: 145 "Pocket turn (v1.357 gate suggestions)", every Transparent-skin line (index item 26, the
  v1.354.0 DEVICE-CHECKS line), and any line whose wording does not match the above.

In docs/DEVICE-CHECKS.md delete exactly: line 10 (v1.341.3 watch-page turn), line 12 (v1.350.0 THE TURN BACK, with its
continuation lines), line 100 (v1.357.0 iPod skin turn; keep the v1.357.0 speaker-highlight line after it), the whole
"Hold to speed up, lock (v1.358.0)" section (106-116), and line 140 (v1.363.2 theatre, cleared by Dean per the open-
threads memory). In ROADMAP's "Device checks owed" index delete the matching items 1, 2, 33, 35, 36, 37, 44, renumber,
and add them to a "Passed 2026-10-05" line in the existing style. Replace "44 open lines at v1.363.2" with the count
from `grep -c '^- \[ \]' docs/DEVICE-CHECKS.md` run AFTER the edit. This plan is already committed on the release branch (the kickoff's docs-only commit).
Acceptance: the grep count, and `git diff --stat` shows only ROADMAP.md and DEVICE-CHECKS.md.

## W1 - Small phones: capture the iOS 15 failure, fix what it names, a viewport matrix for every size

**Facts (measured 2026-10-05, Architect's probe):** at 320x568, 375x667, 360x640, 390x844, 430x932, 667x375,
568x320 (iOS UA, isMobile, touch, DPR 2), Chromium and WebKit (320x568, 375x667): `#view-root` full size on `/`,
`/music`, watch; tiles visible; every bottom-bar button is the top element at its centre; no fixed layer over 50 % of
the viewport (only `#art-play-glyph` on watch in landscape: opacity 0, pointer-events none); no page errors. Probe
scripts (uncommitted, read them as a starting point):
`/tmp/claude-1000/-home-coder-projects-filetube/98ac25b8-60bf-483e-a233-576f97e24cca/scratchpad/se-probe/se-probe.js`
and `se-tap.js`. A grep census found every post-iOS-15 API in `public/js` absent or guarded (`AbortSignal.timeout`,
`crypto.randomUUID`, `navigator.userActivation`, `screen.orientation`, `setActionHandler`). CSS uses `:has(` (22) and
`dvh`/`@container`/`color-mix`/`@layer` (10), which need iOS 15.4+ or 16+.

**Hypotheses.** H1: a runtime error on iOS 15 (an API or a regex/syntax the grep missed, in a shell's inline script or
a module-served script such as `lib/ytdlp/client/*`) stops the view's init, so the static frame paints and the SPA
router's link handling dies (plain `<a href>` bottom buttons "go nowhere" only if JS intercepts and throws). H2: a CSS
feature below 15.4 (`dvh` without a `vh` fallback, a selector list containing `:has()`, which drops the WHOLE rule on
15.0-15.3) zero-sizes or covers the view. H3: stored state on his phone (a private tab has none).

**Step 1 - falsifiers before any edit.**
a. AskUserQuestion Dean ONCE, all three in one question set: the exact iOS version (15.x minor); does a PRIVATE Safari
   tab of the app show the tiles (falsifies H3); one screenshot of the broken home page.
b. Census in a /tmp sandbox (never committed): install `eslint` + `eslint-plugin-compat` there, browserslist
   `iOS >= <his minor>`, run over `public/js/*.js`, every inline `<script>` in `public/*.html` and
   `lib/ytdlp/views/*.html`, and `lib/ytdlp/client/*.js`; for CSS, list every declaration whose feature needs a newer
   Safari than his minor (`dvh/svh/lvh`, `:has(`, `@container`, `color-mix`, range media queries `(width <`,
   `@layer`, CSS nesting, `inset`-free `aspect-ratio` is fine). Record the table in section 6.
c. If his minor is 15.4 or later, `:has`/`dvh` are supported: H2 is out.

**Step 2 - the instrument (build it whatever step 1 finds; it is how the next small-phone report becomes a fix).**
- A tiny ES5 boot-error recorder as the FIRST inline `<script>` in the `<head>` of every shell (all of `public/*.html`
  that host the app, plus `lib/ytdlp/views/subscriptions.html`; enumerate them with the shell-parity test's own
  discovery, LESSONS 4). It records `error` and `unhandledrejection` (message, filename, line, column, first 600 chars
  of the stack, URL path, ISO time) into capped localStorage `ft-boot-errors` (last 50 entries, under 64 KB), and
  never throws itself (try/catch around storage). Always on: the broken phone may not reach Settings to flip a switch
  (a stated deviation from rule 1 of the log pattern; record it in log-collection-pattern.md's "logs" list).
- Export: Settings > Troubleshooting gets "Export error log" + "Clear error log" through `exportDiagnosticLog` and
  `confirmDestructive`, header per the pattern (app version, UA, standalone or tab, count).
- A standalone `/errors.html` (no common.js, ES5 only, server-served like `diag.html`, behind the normal auth gate):
  one Export button with a self-contained share -> clipboard -> download fallback, because on a broken phone
  common.js may be the thing that fails. Its file header names it. This is the second exception to "one helper";
  say so in log-collection-pattern.md.
- Committed guard: `test/unit/boot-error-recorder.test.js` parses the inline recorder of every shell with acorn at
  `ecmaVersion: 5` (fails on any ES2015+), asserts byte-identical copies across shells and that it is the first head
  script, and runs it in a vm with a throwing `localStorage` (no throw escapes) and with 60 errors (exactly 50 kept,
  newest last).

**Step 3 - the fix (only for what step 1 or the device names).** For each finding on a boot or view-init path:
guard it (feature test + fallback) at the use site, or add a `vh` fallback before a `dvh` declaration, or split a
selector list so `:has()` sits in its own rule. No polyfill library, no new runtime dependency. Add
`test/unit/ios15-floor.test.js`: a denylist built from the census findings (each spelling and its guarded form), so
an unguarded reintroduction fails; mutate each guard away and watch it red BY NAME.

**STOP rules.** STOP and AskUserQuestion if: (1) the census finds nothing on any boot or view path and the private tab
also fails: ship Step 2 + the matrix in release A, keep ROADMAP 123 OPEN with "send /errors.html Export from the phone
after it fails", and do not ship a guess; (2) the private tab WORKS (H3: stored state): ask Dean before building a
storage reset; (3) the fix would need a dependency or a build step (transpiler): that is a product decision.

**Step 4 - viewport matrix net (Dean: "nothing hard-coded for small OR big").**
- Design rule, added to `docs/CONTRIBUTING.md` (the CSS section) in one paragraph: sizes come from tokens, `%`,
  `vw/vh` with a `vh` fallback before any `dvh`, `min()/max()/clamp()`, and flex/grid that wraps; a new media query
  is allowed only where the LAYOUT changes (bottom bar vs sidebar, one column vs two) and is written against the
  content's need, never tuned to one device's width; no fixed pixel widths on containers; touch targets keep 44 px.
  Existing breakpoints are not refactored in this plan.
- A new geometry check `VPM` in `test/geometry/` (collector in `checks.js`, scenes in `scenes.js`, mutants in
  `mutations.js`, wired in `run.js` COLLECT and `--only VPM`): the matrix 320x568, 375x667, 360x640, 390x844,
  430x932, 667x375, 568x320 (iOS UA, isMobile, touch, DPR 2) x surfaces home `/`, `/music` browse, watch, `/music`
  Pocket on the base iPod skin (portrait sizes only; it is phone-portrait full screen), `/setup.html`. Per cell it
  asserts: `#view-root` height > 200 and its first content element inside the viewport; `scrollWidth <= innerWidth`
  (no sideways scroll); every visible `#bottom-nav` button is the `elementFromPoint` at its own centre (portrait); no
  element with `pointer-events` not `none`, opacity > 0.01 and a rect covering > 50 % of the viewport other than the
  allow-listed surfaces (the Pocket panel, an open sheet); on Pocket, `elementFromPoint` at `.ip-center`'s centre is
  the center button or the haptic ghost. Non-vacuity floor: each cell asserts it found `#view-root` and at least one
  bottom-nav button (portrait), else the cell FAILS.
- Mutants (each must red ONLY its intended cells, by name): VPM-M1 `@media (max-width: 340px){ #view-root{height:0;
  overflow:hidden} }` (320 only); VPM-M2 a transparent fixed full-viewport div with pointer-events auto under
  `@media (max-height: 600px)` (320x568, 360x640, the two landscapes); VPM-M3 `body{min-width:400px}` (every width under
  400); VPM-M4 `.ip-center{pointer-events:none}` (Pocket cells). Record the red cells per mutant in section 6.
- Acceptance: base run 0 fail across all cells (copy the summary line); every mutant red in exactly its cells.

Briefing for the gate (W1): LESSONS 1, 2, 3 (a probe must show a difference; census floors), 4 (shell parity), 6,
8, 12 (inert sibling list: every shell). Attack: a shell missing the recorder; the recorder throwing on a locked-down
storage; a check that passes because its selector matches nothing; viewport-specific hard-coding slipped into the fix;
a covering layer the VPM allow-list hides.

## W2 - The iPod: hold the center for volume (W2a); a way in with no song (W2b); the chapters row alignment (W2c)

**W2a falsifier first:** in jsdom (wheel rect stubbed), a pointerdown at the wheel centre followed by 700 ms and a
pointerup: today `onDown` returns at 3046, nothing arms, and the release click runs the center tap (Now Playing ->
up-next). Record that as the red-first test.

**W2a change.** In `onDown`, before the dead-zone return, a center branch: only when the press is inside the dead zone
AND the panel is on Now Playing (not a menu level, not list mode, not search, no takeover, not the volume bar already
open), arm `st.centerTimer` = `setTimeout(fire, HOME_HOLD_MS)`. Reuse `HOME_HOLD_MS` (600): it is the wheel's own hold,
the one a thumb already knows from MENU (architect ruling; `FTInteraction.LONG_PRESS_MS` 450 is the app's card
long-press, loads after skin-surface.js, and its engine preventDefaults touchmove, which breaks haptics rule 2).
Cancel on >8 px movement, `pointerup`, `pointercancel`, a wheel spin start, and every `endWheel` path. On fire:
`hapticLetterTick`; swallow the release click the way MENU hold does (`wheelSuppressClick`); then if
`volumeShowable()` would pass on Now Playing -> `openVolume()`; else show an LCD note "Use the side buttons" for
1500 ms (a new small transient on the LCD, reusing an existing LCD toast/notice if the skin has one; read
`music-skins.js` first), never on desktop pop-out (`inMainDoc` false: do not arm). Never `preventDefault` any touch
event. Everywhere the timer is not armed, the release is a normal click: menus, list mode and search keep their
center tap untouched.
- Update the `music-skins.test.js:396-408` lock IN PLACE with intent preserved (a dead-center press never spins the
  wheel), with the reason in a comment (LESSONS 3: an old lock going red is a finding, never widened).

**W2a tests (`test/unit/pocket-center-hold.test.js`, real pointer sequences, jsdom per LESSONS 2: wheel rect and
`elementsFromPoint` stubbed, fake timers):** (1) speaker on, Now Playing, hold 700 ms + up: volume open, up-next NOT
opened (the release click swallowed), one tick; (2) same with the phone playing (no speaker): note shown, up-next not
opened, volume not open, note gone after 1500 ms; (3) tap (down + up at 100 ms): up-next opens, no volume, no note;
(4) hold then move 12 px before 600 ms: nothing fires, and the release is a normal click; (5) menu level, list mode,
search, Brick takeover: a 700 ms hold behaves exactly as a tap does today (each its own test); (6) MENU hold still goes
home and fast-scan still scans (the neighbours, unchanged); (7) via the haptic ghost: the press lands on the ghost
(stub `elementsFromPoint`) and the hold still fires once; (8) teardown: the panel leaves mms-full mid-hold: the timer
never fires. Mutants (red by name): drop the armed-context check (5 reds); drop the click swallow (1, 2 red); drop the
move cancel (4); drop the endWheel clear (8); replace `HOME_HOLD_MS` with 0 (3 red); arm on desktop pop-out.

**W2b - a way into the iPod with no song (architect design; Dean may overrule in section 7).**
- One seam: `/music?pocket=1`. On a phone where `skinActiveFor` is true, it opens Pocket on the Main menu with the
  cursor on Music via the existing no-track landing (`landPlayOn(false)` / `landOnMusic`), with or without a track.
  Unlike `nowplaying=1` it is NOT stripped before use; strip it after the landing (same `replaceState` idiom).
- `updateNowPlayingPanel` gets a third arm "idle Pocket requested" so the local hide at 2810 does not run while the
  user asked for the iPod; `skinIsActive` must not require track meta in that arm. "Now Playing" stays hidden on the
  Main menu with no track (it already drops, `music-skins.js:648`); Speakers works (it already exists).
- MENU on the Main menu with no track and no speaker: close the iPod back to the `/music` browse view (today it calls
  `pl.dock()`, which assumes a track). With a speaker it keeps today's behaviour (`remoteDocked`).
- Entries: (1) a tap on the bottom-bar Music tab while already on `/music` (today swallowed as a same-URL nav) opens
  `?pocket=1` when the skin is active; (2) an "iPod" button in the /music toolbar (`public/music.html:197-212`), phone
  + skin active only, opening the same seam; `[hidden]` when not applicable (LESSONS 6 `[hidden]` rule). From a cold
  app: Music tab, Music tab = 2 taps (the Music tab is hidden by default; Dean shows it once in Settings > bottom bar;
  say so in his device check). Do not change the default bar.
- Tests: the seam with no track lands on Main/Music with the panel shown; with a track too; the param is stripped;
  MENU with no track returns to browse (panel hidden, no `dock()` call); MENU with a speaker unchanged; the same-URL
  Music tap opens the iPod on a phone with a skin and is a no-op without a skin; the toolbar button's both axes
  (shown/hidden, LESSONS 2). A real-browser row (Playwright, phone 390x844 and 320x568): cold `/`, tap Music, tap
  Music: `.mms-full` visible, Main menu, no song loaded (`player` has no current id).

**W2c - the music "Add chapters" row is centered, its neighbours are left-aligned (Dean, 2026-10-05: "the new Add
chapters button for music view is centered instead of left aligned. why").** Cause (read, Architect): v1.363.1 gave
the new rows `ui-btn ui-btn--plain` to satisfy `lint:ui`'s bespoke-button rule (its build log says so); `.ui-btn`
(`public/css/ui.css:110`) sets `justify-content:center`, a fixed `height:var(--btn-h)` and its own padding, and the
menu's row rule `.mms-sticker-menu .mms-sm-act` (`style.css:8389`) sets `text-align:left` but never resets
`justify-content` or `height`. The siblings (Share, Watch, Go to channel, Add to queue, Play next: `skin-surface.js`
195-215) are bare `mms-sm-act` and lay out from the start. Affected: the Extras row `skin-surface.js:234`
(`ui-btn ui-btn--plain mms-sm-act`); also check the pop-out row 2083 (`ui-btn ui-btn--plain mms-sm-extras`; its rule
sets `justify-content:space-between` and `padding:0`, so it may only differ in height) and the watch cog row
`player.js:8791-8812` against its siblings `#speed-btn` etc.
- Falsifier first (Playwright, phone 390x844 and desktop 1440x900, eras 2021 and 2005, light and dark): open the
  music Extras page with a chapterless song and the pop-out sticker menu; record for the chapters row and the row
  above it: the icon's x, the label's x, the row's height and padding. Expected before: the chapters label x larger
  than its neighbour's (centered). If they already match, STOP and ask Dean for a screenshot (another surface).
- Fix: make the new row the same as its siblings: drop `ui-btn ui-btn--plain` from the affected rows. If `lint:ui`
  then reds, comply the compliant way (LESSONS 3: never widen): change the lint's view of the whole `.mms-sm-act` /
  `.mms-sm-extras` row family ONLY if that is how the siblings already pass; otherwise keep `ui-btn` and reset what it
  adds inside the menu rule (`justify-content:flex-start; height:auto; padding` equal to the siblings') with ONE rule
  placed after the base (LESSONS 6: file order decides; lock the order). Do not touch any other `.ui-btn`.
- Acceptance: after, in every cell, the chapters row's icon x and label x equal its neighbour's to the pixel and its
  height equals the neighbour's; a unit lock on the chosen rule (by value, comments stripped); the mutant (restore
  `justify-content:center` on the row) reds the probe and the lock. Add a DEVICE-CHECKS line for v1.364.0.

**STOP rules (W2).** STOP and AskUserQuestion if: a center hold cannot be armed without a `preventDefault` on a touch
event (haptics rule 2); the haptic ghost swallows the pointerdown so the hold can never see the press on a real iPhone
path you can model; or the idle Pocket needs a player change (a fake track) to render.

Briefing for the gate (W2): LESSONS 2 (pointer events in jsdom; presence is not binding), 4 (one down event; every
handle cancelled at every boundary; reveal and clear), 5 (one control, one meaning), 6, 8 (iOS loupe facts), 12; the
wheel-haptics plan rules. Attack: a hold that ALSO fires the tap; a tap that becomes a hold on a slow thumb; a hold
armed on a menu; the timer outliving the panel; the ghost path; a hard-coded centre size (it must stay relative).

## W3 - One-off downloads: stuck or stale (release B)

**Falsifier (before edits):** stop a fixture server mid-download in an integration test (or stub `fetch` to reject in
jsdom) and show the chip row stays "Downloading 47 %" with no sign (the stale producer); and fail the health probe
once and show no chip ever appears after a later submit. These become the red-first tests.

**Server trace (always on, capped, admin-read).** New `lib/ytdlp/oneshotTrace.js`: an append-only JSONL file
`<dataDir>/ytdlp-oneshot-trace.jsonl`, capped (keep the last 2000 lines; trim the way `runlog.js` caps), written
synchronously-safe like `runlog.js`. Events, each `{t: ISO, jobId, ev, ...}`: `queued` (url host only, never the full
URL query), `gate-wait`, `gate-enter`, `gate-leave`, `spawn` (pid, attempt 1|2), `child-exit` (code, signal, ms),
`child-close` (ms after exit), `state` (from, to), `progress` at most once per 30 s per job (pct, ms since last
output), `cancel-requested`, `kill` (signal, pid), `sweep` (what it flipped), `boot-requeue`. Hook points: every
`activity.setOneShot` state write in `lib/ytdlp/index.js`, the gate wrap in `launchOneShotJob`, `run.js` spawn/exit/
close (exit and close separately: it names the grandchild-holding-pipes suspicion), the sweep, cancel, requeue. A
trace write never throws into the job (try/catch, counted). Do NOT change any timeout, the sweep, the gate or kill
behaviour (instrument, not a theory-fix).
- Route: `GET /api/ytdlp/oneshot-trace.txt` -> `text/plain` with `Content-Disposition: attachment;
  filename="filetube-download-trace-<ISO>.txt"`, header lines (what it is, server time, app version, entry count)
  then one line per event oldest first. `requireAdmin` FIRST, try/catch, no query input. Census: rbac-census 263 ->
  264, `route-read-classification` entry, and confirm the trace is NOT in the backup bundle (it is a log).
- Settings > Troubleshooting (admin only): "Download trace" = a plain `<a href download>` to that route (no fetch
  before a share, so iOS keeps the gesture), plus one line of help: "If a download looks stuck, tap this before
  restarting FileTube and send the file."

**Client: stale is visible.** Corner chip and /subscriptions list:
- Every non-terminal row shows "updated Ns ago" (from the server's `updatedAt`) once that age passes 60 s ("stuck on
  the server" signal; the server still says downloading but nothing moved).
- When polls fail, the chip header (and the /subscriptions status line) shows "Can't reach FileTube, last checked Ns
  ago" until a poll succeeds; rows keep their last state ("stale" signal). Clear it on the first good poll (both
  axes, LESSONS 2/4, tested from a POPULATED state).
- The health probe: reset `dlStatusChipInjectStarted` when the probe fails, so the next submit or poll retries.
- A `render` throw inside `pollOnce` is caught per row and counted, so one bad entry cannot freeze the chip.

**Tests:** trace unit (each event written; cap trims; a throwing fs never breaks a job); integration: a real one-off
with a stub yt-dlp on PATH (the repo's existing stub pattern; LESSONS 9 "stub ffmpeg on PATH") drives queued ->
downloading -> done and the trace holds `gate-enter`, `spawn`, `child-exit`, `child-close`, `state` in order; the route
403s a member and 200s an admin with the attachment header; jsdom chip: age label appears after 60 s (fake timers) and
clears on a fresh update; offline banner appears on a rejected poll and clears on the next good one; health-probe
retry. Mutants: drop `requireAdmin`; drop the exit/close split; drop the offline clear; drop the probe reset; drop the
per-row catch; write the full URL into `queued`.

**STOP rules (W3).** STOP and AskUserQuestion if the trace would need to record full source URLs (privacy), or if a
fix to a server hang looks necessary to make the UI honest (that is a theory-fix; the plan forbids it).
**ROADMAP 322 stays OPEN**, rewritten: "v1.365.0 instruments it: next time a row looks stuck, look at the row (an age
means the server is stuck, 'Can't reach FileTube' means the screen is stale), then Settings > Troubleshooting >
Download trace BEFORE restarting, and send the file."

Briefing for the gate (W3): LESSONS 1, 2, 3 (log collection), 4 (reveal and clear, handles), 10 (enumerate every
read surface; a new GET), 11 (Express async; child processes), 13. Attack: a member reading the trace; the trace
leaking full URLs or tokens; a trace write that can wedge or crash a job; the stale banner never clearing; the chip
still dying silently on another path.

## W4 - VR / 360 (release C; full gate; default off)

**Port, do not rebase:** branch `feat/v1.366.0-vr-360` from `origin/main`; `git checkout 477d3444 --
lib/media/projection.js public/js/vr-view.js`; first commit "port the paused WIP". Keep the WIP's field names
`projection` (from the file) and `projectionOverride` (the owner's pick).

**Falsifier first (V0, before wiring):** make two real fixtures and probe them with the real ffprobe through
`buildFfprobeArgs` extended in a scratch copy: (a) a metadata-tagged spherical MP4 (Google's spatial-media injector
from GitHub in a /tmp venv on an ffmpeg `testsrc` clip; if it cannot be produced, STOP and ask Dean for a small sample
of his files); (b) a name-convention file `clip_360_TB.mp4` with a 1:1 frame. Confirm ffprobe prints `Spherical
Mapping` + `projection` (+ `Stereo 3D`) with the grown `stream_side_data` keys, and that rotation still parses. Commit
the fixtures (each under 300 KB) to `test/fixtures/vr/` with a provenance note.

**Server.**
1. Grow `stream_side_data=rotation` to include `side_data_type,projection,type,bound_left,bound_right` (verify the
   exact key spelling against ffprobe 7 output, LESSONS 11). Every caller shares the args; only the scan WRITES
   `projection`; reheat (2471) and codec-only (2659) must not clobber it.
2. Scan: `parseFfprobeStreams` returns the side-data list; the scan stores `item.projection =
   projectionFromSideData(...)` only when defined (absent stays absent, LESSONS 9 probe contract). Derived-field rule:
   carry `projection` in BOTH scan reuse arms (an unchanged file is never re-probed).
3. Owner's pick `projectionOverride`, the `chaptersManual` pattern exactly: `POST /api/videos/:id/projection` body
   `{projection: <one of OVERRIDES> | null}` (null clears = delete the key); `requireModifyLibrary` FIRST,
   `restrictedVideoMutation`, `ownMediaItem`, `isOverride` validation, NUL/empty-id refusal, try/catch; scan re-init
   carry; Phase-2 mirror incl. clears (copy the scalar `channelAttributedManually` shape); the proto net list;
   route-write CLASSIFICATION `library-write` + VISIBILITY `enforced`; rbac-census +1. No SCHEMA_VERSION bump
   (precedent: chaptersManual).
4. Serve: GET item returns `projection` = `effectiveProjection(item, name)` or omitted, and `projectionOverride` only
   when set.
5. No library-wide backfill (cut, section 7): metadata-only files already in the library show as VR after the owner
   picks, or after the file changes; the file-name rule works at once.

**Client.**
- Cog row "360 view" (a toggle, the `ensureCogControlsInjected` pattern) shown ONLY when the effective projection is
  not flat; per-device `localStorage` `ft-vr-view`, default OFF. Owner row "Video type" (the `syncChaptersEditRow`
  pattern, `playerCanModifyLibrary` gate) on any video, opening a `ui.sheet` list: Auto (from the file), Flat, 360,
  360 top-bottom, 360 side-by-side, 180, 180 side-by-side, 180 top-bottom.
- Mount `VrView.mount(video, host, projection)` ONLY when: effective projection non-flat AND the toggle is on AND the
  player is not docked and not in native fullscreen. Unmount on toggle off, a new load, dock, native fullscreen enter,
  nav (`destroy`), `webglcontextlost` (flat + a toast). On iPhone native fullscreen the picture is flat (Apple's
  player): disclose it; the app's own full-window mode (custom controls on) keeps the sphere.
- DELETE the `drawImage(video)` shrink path: a frame larger than `MAX_TEXTURE_SIZE` refuses the sphere (flat + toast
  "This video is too large for 360 view on this device"). Nothing on the page reads the video into a 2D canvas.
- CSS for `.vr-view-canvas` / `.vr-view-on`: no filter, backdrop, mask or blend (the overlay net test must stay
  green with the new selectors in its net).
- Non-VR video never creates a WebGL context and never loads a canvas: `vr-view.js` mounts nothing unless called.

**Tests.** projection.js and vr-view.js pure functions (each precedence arm; each side-data shape from the real
fixture's ffprobe JSON, not hand-typed; name rule with aspect agree/disagree); route (403 member, 400 bad value, clear
deletes the key, NUL id); scan: the REAL fixtures through the real scan land `projection` (reachability, LESSONS 2),
and reuse keeps it; mid-scan pick and clear survive (the chapters-editor 138-157 shape); cog rows both axes; mount
gating (spy: zero mounts for a flat item with the toggle on; zero for a VR item with it off; one for VR + on; unmount
on each boundary). Real browser (Chromium `--use-angle=swiftshader`): on a flat video page, spy
`HTMLCanvasElement.prototype.getContext` = 0 calls and no `canvas.vr-view-canvas`; on a labelled 360 panorama (ffmpeg
`drawtext` N/E/S/W at known longitudes) with the toggle on, sample the canvas centre at yaw 0 and after a 90-degree
drag: the label read matches the expected side (settles the left/right sense, ROADMAP risk 4). Mutants: drop the
toggle check; drop the flat check; restore the drawImage path; drop `requireModifyLibrary`; drop the Phase-2 mirror;
drop the reuse carry; drop the clear-deletes branch.

**STOP rules (W4).** STOP and AskUserQuestion if: no spherical-metadata fixture can be made (ask for a sample); the
grown ffprobe keys change any existing probe output (rotation, codecs); the left/right sense cannot be measured; or
the gate finds any path where a non-VR video reaches WebGL.
Device check (iPhone FIRST, ROADMAP risk 2): Dean turns 360 view on for one VR file inline; if the picture goes black,
that is a VR-only finding (record it; do NOT mix it into the open black-picture bug) and 360 view gets an iPhone opt-
out in a follow-up.

Briefing for the gate (W4): LESSONS 2 (inert feature, real upstream shape), 5, 6, 7 (nothing drawn from the video;
the v1.312 and v1.361 iPhone lessons), 8, 9 (persist-gate, full gate, brief the Adversary to DESTROY the override),
10, 11 (ffprobe flags verified at source; per-request probes), 12 (inert sibling list; negative kind guards). Attack:
VR touching non-VR video; the override lost across a scan or a mid-scan edit; a member writing it; the sphere outliving
its video; a drawImage of the video anywhere.

## 4. Release mechanics (each release)

1. Build log, gate verdicts, measured numbers go in section 6 (the Build log) of this plan as you go.
2. Full suites on Node 22.23.1 and 24.20.0 sequentially; copy each final summary line verbatim. `npm run lint`,
   `npm run lint:ui` (shrink-only; `--shrink` if you paid debt), `npm run lint:overlay` (ceiling 0),
   `npm run test:geometry` for A (VPM and the existing checks), `bash .harness/lib/check-markers.sh`.
3. Gate per section 3 (seats spawned fresh with branch, base sha, this plan's wave sections, the LESSONS sections and
   attack surfaces named in each wave; mutating seats in their own worktree or sequential; never edit the tree while a
   seat reviews; commit each verdict into this plan). CHANGES -> fix -> delta re-confirm with the SAME seat.
4. Release commit (stage by name): `npm version X.Y.Z --no-git-tag-version` (package.json + package-lock.json);
   ROADMAP.md Shipped entry above v1.363.2 in the existing style (what, measured numbers, suites, gate, disclosed
   gaps), tick or rewrite the Planned entries (123 per W1's outcome; 322 stays open rewritten; 457 ticked in C); add
   the release's device checks to ROADMAP's index; `docs/releases.json` entry in plain user language (the
   release-ledger test checks it); `docs/DEVICE-CHECKS.md` lines tagged with the version; a `docs/LESSONS.md` entry
   (dedupe first, bump strike counts) for any new bug class: A: "a phone that cannot run a script shows the static
   frame: capture boot errors at the top of every shell" (section 8); B: "a poll that fails silently freezes a row
   that looks live: show the age and the offline state" (section 4); C: as found. Plan close-out at the LAST release
   only: `node scripts/plan-complete.js docs/exec-plans/active/2026-10-05-small-phones-pocket-downloads-vr.md "Shipped
   v1.366.0" --apply` (or at B with "Shipped v1.365.0" if C is parked: then copy W4 into a new
   `docs/exec-plans/active/<date>-vr-360.md` with `status: Parked(revisit: <why>)`).
5. Protected main: `git merge --no-ff` the release branch into a local main-tracking branch, tag `vX.Y.Z` on that
   merge, push the RELEASE BRANCH at the tagged merge commit and the tag in ONE push, in the background:
   `GIT_SSH_COMMAND="ssh -o ServerAliveInterval=20 -o ServerAliveCountMax=60" git push origin <branch> vX.Y.Z`
   (a long pre-push can die with exit 141 after "checks passed": verify with `git ls-remote --heads --tags origin`).
   `gh pr create`, wait for `ci (22)`, `ci (24)`, `audit`, `secret-scan` green (visual is a report, never a gate),
   `gh pr merge <n> --merge` (if the auto-mode classifier refuses, AskUserQuestion Dean and run it on his word),
   `git -C /home/coder/projects/filetube pull --ff-only`. Known flakes (critter "v1.176 gate W closure",
   progress-coalescer AC4.1 #238): `gh run rerun <id> --failed`, never `--no-verify`.
6. After: `gh run view` the tag's Docker publish; check `baseline-refresh` went green or its PR merged; delete the
   wave branches remote (`gh api -X DELETE repos/dtammam/filetube/git/refs/heads/<b>`; `git push --delete` silently
   no-ops here) and local (`git branch -d`), then `git ls-remote --heads origin`. In C, remove the `vr360` worktree;
   the old local branch `feat/v1.340-vr-360` is unmerged, so `-d` refuses: ask Dean in the final report before `-D`.

## 5. Gate scrutiny per wave

| Wave | Call | Why |
|---|---|---|
| W0 | slim (adversary, claims vs tree) inside A's gate | docs only |
| W1 | adversary + qa | every shell's `<head>` changes (shell parity), a new page, layout instrument; seats split on UI (LESSONS 1) |
| W2 | adversary + qa | gesture on a shared surface with haptics rules; a hold that fires a tap is the classic split |
| W3 | FULL + security-brief | `lib/**` (core-logic), `lib/ytdlp/client/*` matches the `*client*` force rule, a new admin read route, a file in dataDir |
| W4 | FULL + security-brief | a stored per-item field, the scan, a write route, ffprobe; data surfaces are never slimmed |

## 6. Build log

### Release A (v1.364.0)

**W0** (1ba180b2, docs only): ROADMAP 135/193/278/447 ticked with Dean's 2026-10-05 device confirmation; DEVICE-CHECKS lines
deleted as listed; index items 1, 2, 33, 35, 36, 37, 44 moved to "Passed 2026-10-05". `grep -c '^- \[ \]' docs/DEVICE-CHECKS.md`
after the edit: 37. `git diff --stat`: ROADMAP.md, docs/DEVICE-CHECKS.md only.

**W1 step 1 (falsifiers).** Dean (AskUserQuestion): iOS **15.8.5**; a private Safari tab is still broken (H3 out); 15.4+
means `:has()`/`dvh`/`@layer` work (H2 out). Census at `iOS >= 15.8` (eslint 9 + eslint-plugin-compat, /tmp sandbox, 30
public/js files + 46 inline scripts + lib/ytdlp/client + the worker; every script parses at ES2021):

| Finding | Where | iOS 15.8 | On a boot/view path? |
|---|---|---|---|
| `navigator.connection` | diag-page.js:38 | absent | no (diag page, `|| {}`) |
| `navigator.userAgentData` | player.js:2480 | absent | guarded (`uaData &&`) |
| `document.fullscreenElement` | player.js:2670, 2900-2901 | absent on iPhone | reads only (undefined) |
| `navigator.userActivation` | player.js:5916 | absent | guarded (try + `|| null`) |
| `Notification` | setup.js:4298 | absent in a tab | inside a click's try |
| `overflow-x: clip` | style.css:280, 6783 (5 decl.) | unsupported (16) | no (degrades to visible) |
| `content-visibility`, `text-wrap`, `font-size-adjust`, `scrollbar-*` | style.css | unsupported | no (cosmetic) |
| regex lookbehind, `@container`, `color-mix`, range media queries, `@property`, CSS nesting | - | - | 0 uses |

Census found nothing; STOP rule 1 asked (Dean answered with a screenshot: header, bell 14, "Listening on", bottom bar;
"Recently added" with no chips and no tiles, no tab highlighted; then "Same with Music view"). A Chromium run with every
iOS 16+ API deleted did NOT reproduce (46 tiles). **A real WebKit 15.4 did** (Playwright 1.20.2 webkit-1616, four
Ubuntu 20.04 libs extracted to its lib dir, 320x568, iOS 15.8.5 UA): `ReferenceError: Can't find variable: viewRegistry`
at common.js:11012 from main.js/watch.js/setup.js/music.js registerView, and `Can't find variable: swipeBackWired` at
11584 from bootRouter: cards 0, chips 0 (the new recorder captured all of it on its first run). Minimal repro in the same
engine: a function declared in a block of non-strict top-level script code cannot see that block's const/let (same
script or another: A/B/C/E/H fail); `'use strict'` or an IIFE works (F/G). Census of the shape over every classic script:
21 hits, all in common.js's router block (10891-11839); 0 bare-name references to its 30 functions from outside it.

**W1 step 3 (fix, 20a3cfde).** The block body runs inside `routerRuntime()` (an IIFE, no reindent). WebKit 15.4 after:
home 46 cards + 1 chip row, 0 page errors; /music renders (artists, albums); bottom bar: History navigates (view
history, tab active), Playlists opens its sheet, Home active. `test/unit/ios15-floor.test.js` (5 tests): the shape census
over every classic script (0 hits), a detector non-vacuity row per block kind, an ES2021 parse floor, the routerRuntime lock.

**W1 step 2 (instrument, 20a3cfde).** ES5 recorder as the first head script of all 13 app shells (public/*.html that load
common.js + subscriptions.html), byte-identical; `ft-boot-errors`, last 50, under 64 KB, version-stamped from the
ft-version meta; errors + failed script/link loads (capture) + rejections. Settings > Troubleshooting > Export error log /
Clear error log; standalone `/errors.html` (no app script, ES5, share -> clipboard -> download, behind sign-in).
`test/unit/boot-error-recorder.test.js` 33 pass; auth-flow integration row (302 to login, 200 signed in, served shells
carry the recorder first after the version meta). Commit hook: `ℹ pass 8646` / `ℹ fail 0`.

**W1 step 4 (VPM).** `node test/geometry/run.js --only VPM`: `geometry: 33 checks - 33 ok, 0 FAIL, 0 XFAIL (expected), 0
XPASS`. `--mutants --only VPM`: `4 of 4 killed, 0 survived (216s)`; red cells: M1 5 (every 320 cell), M2 18 (every cell
<= 640 tall), M3 20 (every cell under 400 wide), M4 5 (every iPod cell); control 0 red. Deviation: the iPod cells skip
the bottom-bar and content-centre rows (the full-screen skin covers both by design) and assert the centre button
instead; M2 uses `max-height: 640px` so 360x640 is in its set as the plan intended.

**W1 mutants** (committed 20a3cfde, /tmp git-archive sandbox, each diff non-empty): 11 of 11 killed by name - M1 router
block back to bare block code (`no classic script declares a function in a top-level block...`, `the router runtime runs
inside routerRuntime()`), M2 keep 60 (`60 errors keep EXACTLY the last 50`), M3b no try on the error path (`a throwing
localStorage ... never lets an error escape`), M4 one shell differs (`byte-identical`), M5 `let` (`the recorder is ES5`),
M6 not capture (`CAPTURE`), M7 records images (`a broken image is not`), M8 wire dropped (`the enabling wire`), M9 clear
without asking (`Clear error log asks first`), M10 errors.html without share (`Export shares a .txt File`), M11 recorder
missing from tv.html (`tv.html: ... FIRST head script`). Masked, documented: the inner storage try alone (M3) is masked
by the listener's own try (two guards, one observable property).

**W2** (built on feat/v1.364.0-small-phones-pocket-w2; acb47a25 W2a, 3bb32c20 W2c, 702619df W2b, 4296f00a W2b tests; merged 882d59d0).
W2a falsifier: test/unit/pocket-center-hold.test.js on the unchanged engine 10 pass / 5 fail (a 700 ms centre hold opened no volume
bar, no note); after 16/16. Change: a centre-hold arm in onDown's dead-centre branch (own state, passive document listeners,
HOME_HOLD_MS 600), Now Playing only, main document only; fire = hapticLetterTick + wheelSuppressClick + openVolume() (speaker) or a
1500 ms LCD note "Use the side buttons" (.ip-lcd-note). Cancel: 8 px move, release, pointercancel, a new press, endWheel, destroy,
and a re-check at fire. The music-skins dead-centre lock updated in place (intent kept: a dead-centre press never spins). Real
browser (Chromium, CDP touch hold 900 ms, eras 2021/2005): note shown, the release opened no list, note gone after 1500 ms.
Mutants (/tmp/w2-mut-*, each landed): context check dropped -> 5a-5e + 8 red; click swallow dropped -> 1, 1b, 2, 7; move cancel
dropped -> 4; HOME_HOLD_MS 0 -> 2, 3, 4, 5b, 8; armed in the pop-out -> 9; destroy clear dropped -> 8b; fire re-check dropped ->
8; top-of-onDown clear dropped -> 4b; dead-centre no return -> the music-skins lock + 1, 1b, 2, 7, 8b. Masked (documented): the
endWheel clear alone (a spin cannot start without the top-of-onDown clear).
W2b: the seam /music?pocket=1 (openPocketSeam): a speaker -> its iPod; a music track -> expand; neither -> the idle iPod
(pocketIdle arm in updateNowPlayingPanel), landing via landPlayOn(false) on Main/Music; the param is stripped after. MENU on the
idle Main menu closes to browse with no pl.dock(). Entries: the Music tab tapped again on /music (common.js musicTabPocketUrl)
and the toolbar iPod button (#music-pocket-btn, phone + a skin with menus). pocket-idle-seam 9/9; red before 1 pass / 8 fail
(the pass was vacuous and was removed). Mutants B1-B9, B11, B12 red by name; B10 (no hand-over clear) survives the unit tests and
is killed by the real-browser row (tools/pocket-proof/pocket-idle-row.js: MENU path 5 presses vs 4). Real browser 390x844 +
320x568: 24/24 PASS (cold /, Music, Music -> iPod Main/Music, currentId null, MENU closes, toolbar button reopens, a picked song
plays, 0 page errors; gate r1 correction: the tool prints 26 PASS / `FAILS 0`, 13 rows per size, re-run on the r1 fix tree).
Deviation: the row is a committed proof tool, not wired into CI.
W2c falsifier (Playwright; 390x844 + 1440x900; eras 2021/2005; light/dark): Extras chapters row icon x 89 / label x 115 vs Play
next 13 / 39 (centred), weight 500 (2021) / 700 (2005) vs 400; the pop-out row matched x and height but read 14px/500 vs
13.33px/400. After: 12/12 cells equal the neighbour's icon x, label x, height 44 and font. Lock
test/unit/sticker-menu-chapters-row.test.js 5/5; mutants justify-centre (lock red + probe 8/8 Extras cells red), the rule moved
before the base (the order test), the family restore dropped, the tint restored: all red. Deviation: ui-btn kept on the rows
(dropping it raises the lint's carve-out debt; the siblings pass as counted debt) and three ordered rules reset what it adds.
The watch cog row was measured already left (text x 12, h 29, as its siblings): unchanged. Commit-hook flake on the way:
pocket-skins-menu.test.js:221 'Cider' !== 'Search' once at load ~11 (wall-clock wheel speed); 6/6 alone, retry green.

**Release A suites, round 1 (merged 882d59d0), Node 22.23.1:** `# tests 11107` `# pass 11097` `# fail 1` (`# skipped 9`):
`not ok 1573 - v1.90: the meta is injected exactly once (idempotent) even if re-served` (expected 1, actual 2). Cause: the
recorder's selector text `meta[name="ft-version"]` matched the test's count of `name="ft-version"`; the recorder now reads
`meta[name=ft-version]` (same selector, unquoted). The Node 24 run was stopped for the fix; both re-run below.
Re-run at a041cef1, Node 22.23.1: `# tests 11107` `# pass 11098` `# fail 0` `# cancelled 0` `# skipped 9`; Node 24.20.0:
`ℹ tests 11107` `ℹ pass 11098` `ℹ fail 0` `ℹ cancelled 0` `ℹ skipped 9` (logs: scratchpad A-suite-v22.23.1.log /
A-suite-v24.20.0.log).

Gate: CHANGES r1 @a041cef1 - qa
- WARNING (public/setup.html:837, public/errors.html:113-114, docs/references/log-collection-pattern.md:72-79): the /errors.html fallback cannot reach the home-screen app's log. iOS home-screen apps keep their own storage (pwa-ios-notes.md:161, vpn-slowness-runbook.md:39). Dean's phone fails in the app: the app has no address bar to "go to /errors.html in the address bar", and the same URL in Safari reads Safari's storage and says "No errors recorded on this device" while the app holds 50. Fix the copy (open it in a Safari tab; the home-screen app keeps its own log, reachable only through its Settings), change "on this device" to "in this browser" on errors.html, and record the limit in the pattern doc.
- WARNING (this plan, section 6, "Release A suites, round 1"): it says "both re-run below" and nothing follows. The green numbers at a041cef1 (tests 11107, pass 11098, fail 0, skipped 9 on 22.23.1 and 24.20.0) are not recorded (section 4 step 2 wants them copied word for word).
- SUGGESTION (the recorder in all 13 shells): it keeps the LAST 50 only, so a repeating error (a timer or rAF handler throwing each tick) pushes the boot error that caused it out within 50 ticks, and each record reparses and rewrites up to 64000 chars of storage on the main thread. Fold repeats (same msg+src: a count) or keep the first few plus the last ones. "under 64 KB" is 64000 UTF-16 chars, so up to ~125 KB of storage quota.
- SUGGESTION (docs/CONTRIBUTING.md:287): "seven phone sizes from 320x568 to 430x932 plus two landscapes" says 9 sizes. scenes.js VPM_SIZES holds 7 (5 portrait + 2 landscapes), 33 cells.
- SUGGESTION (public/js/skin-surface.js:1876-1877): "HOME_HOLD_MS, the wheel's one hold" is wrong: the wheel has the 400 ms scan hold and LETTER_HOLD_MS 1000 too (line 1739's own comment names the scan hold).
- SUGGESTION (public/js/music.js, `pocketIdle = false` after "a song is up now"): mutant B10 is killed only by tools/pocket-proof/pocket-idle-row.js, which is not in CI, so dropping that line ships green. Add a jsdom row (idle, then a song picked, then MENU x4 docks).
- NOTE: the brief's base cdd3a07d is behind origin/main fc9fb7c5. All 66 PNGs in `git diff cdd3a07d` are main's PR #93 baseline refresh: this branch changes 0 baselines (`git diff --stat fc9fb7c5..HEAD`: 39 files, no PNG).
- NOTE: check-markers exits 1 with 14 issues: 12 are older ones in completed/; 2 are this plan's design approval @fc9fb7c5, stale by design once code lands.
- NOTE, release readiness (section 4), still to do: package.json/lock still 1.363.2; no docs/releases.json 1.364 entry; no ROADMAP Shipped entry; ROADMAP "Small phones" still open and unchanged; no v1.364.0 DEVICE-CHECKS lines (SE on 15.8.5 shows tiles and the bottom bar works; Export error log from the app; center hold both arms and a center TAP still Selects with one tick on the iPhone (the ghost now moves on every center press); Music, Music opens the iPod; the W2c row) and the index count; no LESSONS entry; frontmatter `gate: pending`.
- Verified by QA at a041cef1: lint 0 errors (6 warnings), lint:ui OK, lint:overlay 0; `--only VPM`: 33 checks - 33 ok, 0 FAIL; 8 target unit files 178/178. The 9 skips are all pre-existing no-ffmpeg rows. No new skips. No em dashes in added lines. /errors.html is behind sign-in (auth-flow row) and renders only via textContent; no CSP; the 30 router functions that lost their Annex-B globals have 0 bare uses outside common.js (public, lib/ytdlp, tests, tools).

Gate: CHANGES r1 @a041cef1 - adversary
- WARNING (test/unit/ios15-floor.test.js blockFunctionHazards): the census misses two shapes iOS 15 also breaks on. Measured in WebKit 15.4 (/tmp/wk15, webkit-1616): `for (let i = 0; i < 1; i++) { function g() { return i; } }` and `try { throw 5 } catch (err) { function g() { return err; } }` both throw "Can't find variable" (i, err), and the detector returns 0 hits for both (it never adds a loop head's let/const or a catch param to the names). The tree has 0 live hits today (an extended census over the same 95 scripts, both controls detected), so this is the guard, not the app. Add both binding kinds to the walker plus two non-vacuity rows, so the test's "fails on any reintroduction" is true.
- WARNING (test/unit/pocket-center-hold.test.js, W2a cancel paths): mutant "drop the pointercancel listener" (skin-surface.js armCenterHold) survives 16/16; the helper's `opts.cancel` is never passed. "Drop the pointerup + pointercancel listeners" is killed only by 5b, by accident. The events are MouseEvent with no pointerId (LESSONS 2), so mutant "drop both pointerId filters" also survives 16/16. Also surviving: "drop wheel.isConnected at the fire" and "drop hideLcdNote in destroy". Add a pointercancel-at-300 ms row (no note and no volume at 700 ms, the next tap a normal click) and give the events a pointerId, with a second pointer's move that must NOT cancel.
- WARNING (public/js/common.js handleDocumentClick, the Music tab tapped again): `navigate('/music?pocket=1')` PUSHES an entry, and stripMusicParam then replaces it with a second `/music`. Measured (Chromium, 390x844, iPhone UA): history.length 4 -> 5; Back with the idle iPod up leaves it up on /music (a dead press); after MENU closes it, Back is dead again. It also rebuilds the view: #view-root is replaced (the toolbar button keeps it). Verified fix: `navigate(pocketUrl, { replace: true })` keeps history.length 4, Back from the iPod lands on Home, pocket-idle-seam stays 9/9. That test does not bind push vs replace either: assert history.length.
- WARNING (public/login.html:102,104, welcome.html:107,109 vs lib/auth/gate.js ALLOW_EXACT): the signed-out shells load /js/glyph-pool.js and /js/prefs-sync.js, which the gate refuses before login (an old gap). The new recorder logs both on every signed-out visit. Measured in WebKit 15.4: right after sign-in the log held 2 entries, "failed to load script ... glyph-pool.js" and "... prefs-sync.js" on /login, before anything else. Dean's export from a broken phone will open with two false leads. Allowlist both (static client code, the same trust as common.js) or drop them from the two shells, and re-measure that the log is empty after a clean sign-in.
- NOTE (style.css 8398, test/unit/sticker-menu-chapters-row.test.js): the order lock passes when a LATER higher-specificity rule (`.mms-sticker-menu button.ui-btn.mms-sm-act{ justify-content:center; }`) re-centres the row (5/5 green). Only the probe sees it (LESSONS 6). Known limit of a source lock, disclosed.
- NOTE (W2b B10): verified the claim. B10 survives the unit rows, and tools/pocket-proof/pocket-idle-row.js kills it at both sizes (MENU path 5 presses vs 4). A jsdom row needs a real pick: `nowPlaying` is set only by playAt, so flipping the player stub's currentId does not reach the normal arm (tried). OK to ship disclosed if no jsdom row lands.
- NOTE (section 6 W2b): "24/24 PASS" - the committed tool prints 26 PASS / FAILS 0 at a041cef1 (13 rows per size).
- SUSPICION (device only, W2a): the center hold has no pointer capture and lands on the haptic switch. If iOS's own long-press recognizer (about 500 ms) sends pointercancel before 600 ms, the hold never fires on the iPhone. The MENU hold working on device argues against it but goes through a different path. Device check: hold the center 1 s on Now Playing, with and without a speaker.
- Verified at a041cef1. WebKit 15.4, iOS 15.8.5 UA, 320x568: base cdd3a07d has 0 cards and the viewRegistry/swipeBackWired ReferenceErrors, and a History tap stays on /; HEAD has 44 watch links on home, a History tap lands on /history, /music renders, 0 page errors. /errors.html 302s to /login when signed out. Hostile messages (`<img onerror>`, `<svg onload>`) render inert on errors.html (window flag 0, 0 images); the Settings export has no DOM sink for the text. meta[name=ft-version] works in a real engine (entries carry v 1.363.2). 13/13 shells carry the recorder. 0 references outside the block to the 30 router functions (AST, common.js; grep, public, lib, test, tools). `--only VPM`: 33 checks - 33 ok, 0 FAIL (57 s). W0: DEVICE-CHECKS 44 -> 37, index 45 -> 38, the four suffixes exact. lint 0 errors / 6 warnings (same on base), lint:ui OK, lint:overlay 0; check-markers 14 issues = base's 12 + this plan's stale design approval @fc9fb7c5 (twice).
- Process NOTE: section 4 puts the release commit (version, releases.json, DEVICE-CHECKS, LESSONS) after the gate, so it moves the sha off any approval bound here. Each seat must re-engage on that delta.

**Gate r1 fixes** (one commit on a041cef1; mutants on the committed tree recorded below it):
- adversary W1: `blockFunctionHazards` adds a loop head's let/const (for, for-in, for-of, destructured) and a catch param
  (plain and destructured) to the names a block function must not read. Non-vacuity rows: 5 new bad shapes, 3 new ok
  shapes (`for (var ...)`, a catch block function that reads nothing, `catch {}`). WebKit 15.4 (/tmp/wk15): all 5 bad
  shapes throw "Can't find variable" (i, k, v, err, message), the `for (var ...)` control returns 1. Census over every
  classic script: 0 hits. Red before: the old walker on the new rows fails `the detector sees the iOS 15 shape`.
- adversary W2: test/unit/pocket-center-hold.test.js pointer events are PointerEvents with `pointerId` 1 (a foreign
  finger is 2); rows 10 (pointercancel at 300 ms, then a tap is the tap), 11 (release with no click), 12 (a foreign
  move), 13 (a foreign pointerup and pointercancel), 14 (the wheel leaves the document mid-hold), 15 (destroy with the
  note up). 22/22.
- adversary W3: common.js the second Music-tab tap is `navigate(pocketUrl, { replace: true })`. pocket-idle-seam row 10
  (the view fetch answers, then: no pushState, the seam URL replaced the entry, history.length unchanged); red with
  the push restored. Real browser (adversary's w2b-hostile.js, Chromium 390x844): history.length 4 -> 4 on the second tap,
  Back with the idle iPod up lands on / (home), Back after MENU closes it lands on /; 0 page errors.
- adversary W4: NOT fixed, STOPPED (the brief's rule). Measured (Chromium, the seeded fixture): signed out, /login GETs
  both scripts 401 and the log holds the two "failed to load script" entries; signed IN, /login is served (the gate
  passes it with a session) and loads both (304), prefs-sync runs (`GET /api/prefs` 200, an era tap POSTs /api/prefs),
  `resolveFolderGlyphClass` is a function. So the two shells DO use them on the signed-in path; dropping them changes
  that path, and allowlisting them touches lib/auth. Dean's call.
- qa W1: setup.html's note says to open /errors.html in a Safari tab and that a Home Screen app keeps its own log,
  reachable only from its own Settings > Export error log; errors.html says "in this browser" and carries the same
  scope line; log-collection-pattern.md records the limit. boot-error-recorder row `the error log copy is honest about
  storage`; the two count pins now bind "in this browser".
- qa W2: the suite re-run lines above; the W2b proof count corrected (26 PASS, `FAILS 0`).
- SUGGESTIONs folded: CONTRIBUTING.md VPM count (seven sizes: five portrait, two landscape; 33 cells); the skin-surface.js
  comment no longer calls HOME_HOLD_MS the wheel's one hold; ROADMAP Planned > Chores "The error log folds repeats".

**Gate r1 fix mutants** (committed f2240b62, /tmp git-archive sandbox with a pristine copy, each diff non-empty, restored
byte-identical): 13 of 13 killed by name. I1 catch param dropped and I2 loop head dropped -> `the detector sees the iOS 15
shape`; C1 armCenterHold's pointercancel listener dropped -> `W2a (10)`; C2 pointerup + pointercancel dropped -> `W2a (5b)`,
`(10)`, `(11)`; C3 both pointerId filters dropped -> `W2a (12)`, `(13)`; C3a the move filter alone -> `(12)`; C3b the end
filter alone -> `(13)`; C4 `wheel.isConnected` dropped at the fire -> `W2a (14)`; C5 `hideLcdNote` dropped from destroy ->
`W2a (15)`; R1 push instead of replace -> `W2b the second Music-tab tap REPLACES the history entry`; E1 errors.html back to
"on this device" -> `the error log copy is honest about storage` + both /errors.html rows; E2 the setup note back to "the
address bar" -> `the error log copy is honest about storage`. Control (no mutant): 71 pass / 0 fail over the four files.
Targeted before the commit: the 16 files touching the change 439/439, auth-flow 8/8, lint 0 errors (6 warnings), lint:ui OK,
`--only VPM` `geometry: 33 checks - 33 ok, 0 FAIL, 0 XFAIL (expected), 0 XPASS`; commit hook `ℹ pass 8687` `ℹ fail 0`.

## 7. Cut or deferred (Dean can overrule each)

- Refactoring existing pixel breakpoints: no instrument shows one broken; the VPM net + the design rule stop new ones.
- A polyfill library or transpiler for iOS 15: a dependency/build step for one phone; guard use sites instead.
- Local volume on Android in the iPod (`volumeIsSettable` true there): Dean's phones are iPhones; the ruling is
  speaker only.
- Showing the Music tab in the bottom bar by default: it is Dean's per-user choice today (2 taps once he shows it).
- A server hang fix for one-off downloads (gate timeout, process-group kill, sweep without a poller): the trace
  decides which, if any, on the next occurrence.
- A library-wide VR metadata backfill: it re-probes every video (LESSONS 9: a re-extract on upgrade is a regression);
  the owner's pick and the file-name rule cover existing files.
- VR headset/WebXR, cubemap/EAC, fisheye, Roku/TV, thumbnails: out of scope per the ROADMAP entry.

## 8. Final report format (to Dean, at the end of each release; no ceremony narration)

```
**This release (vX.Y.Z):** `██████████` 100%. <one clause: what shipped>.
**Overall plan:** `███████░░░` 70%. <releases done of 3, what is left>.
```
10 cells, `█` filled then `░`, one per 10 %, rounded to the nearest cell, from measured counts (waves done of
planned; ceremony steps done of: build, suites x2, gate, release commit, PR merge, tag publish). Then: bullets of the
measured numbers (suites verbatim, mutants killed of run, VPM cells, gate rounds); section 6 of this plan pasted or
linked; the device checks he owes for this release as a numbered list matching DEVICE-CHECKS.md; any STOP still open
as one AskUserQuestion. Plain hyphens, no em dashes.
