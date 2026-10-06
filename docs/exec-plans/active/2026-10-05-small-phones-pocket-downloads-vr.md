---
plan: small-phones-pocket-downloads-vr
harness: v2 · lean
branch: one branch per release (named in section 3)
anchor: spec
status: Approved @fc9fb7c5
next: Release C (W4 on feat/v1.366.0-vr-360 @20dfa7a8): rebase on main after v1.365.0 (route census 264 -> 265), both suites, FULL gate + security-brief
design: Approved 2026-10-05 @fc9fb7c5 (Dean's Q&A in the kickoff; every ruling in section 1 is his answer)
gate: Release A APPROVED r2 @a3402a93; Release B APPROVED r2 @b8b3ca7d (adversary, qa, security-brief); C pending
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
- adversary W4: first STOPPED (the brief's rule): measured (Chromium, the seeded fixture) signed IN, /login is served and
  loads both scripts (304) and prefs-sync runs (`GET /api/prefs` 200, an era tap POSTs /api/prefs), so dropping them from
  the shells changes that path. Dean's ruling: allow them signed out. lib/auth/gate.js ALLOW_EXACT gains
  `/js/glyph-pool.js` and `/js/prefs-sync.js` (exact paths only). Measured signed out, Chromium and WebKit 15.4
  (PLAYWRIGHT_BROWSERS_PATH=/tmp/wk15/browsers, 320x568, iOS 15.8.5 UA), /login (seeded) and /welcome (no users): both
  scripts 200, 0 page errors, `ft-boot-errors` null after load, the form present; prefs-sync's `GET /api/prefs` 401 puts it
  dormant with no log entry (no prefs-sync change needed). Tests: auth-gate `every script, stylesheet and icon a pre-auth
  shell ... loads is allowed signed out` (derived from the two shells' script and link tags, with witnesses) and `are
  allowed signed out, by EXACT path only` (neighbours .map, x suffix, trailing slash, no extension, .json, a subdirectory,
  the root, upper case, an encoded NUL, POST: all refused; a query keeps the asset behaviour); route-census positive
  control probes both (not gated) and /js/main.js (gated).
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

**Gate r1 fix 4 mutants** (committed 6c8fe182, same sandbox method, each landed and restored): 5 of 5 killed by name over
auth-gate + route-census. G1 the glyph-pool entry dropped and G2 the prefs-sync entry dropped -> `route census: the
documented allowlist IS reachable pre-auth`, `every script, stylesheet and icon a pre-auth shell ... loads is allowed signed
out`, `are allowed signed out, by EXACT path only`; G3 widened to a prefix regex, G5 matched case-insensitively -> `by EXACT
path only`; G4 every /js/ allowed -> `the shell catch-all + arbitrary static paths are gated`, the positive control, `the
intended pre-login surface is reachable; everything else is not`, `by EXACT path only`. Control 29 pass / 0 fail. Targeted
before the commit: auth-gate, route-census, auth-flow, shell-smoke, history-nav-gate, login-safe-next, glyph-pool-script-order,
prefs-sync-client 72/72; lint 0 errors (6 warnings); commit hook `ℹ pass 8689` `ℹ fail 0`.

Gate: APPROVED r2 @a3402a93 - qa
- qa W1 fixed as prescribed: setup.html #boot-error-log-note says open /errors.html in a Safari tab and that a Home Screen app keeps its own log, reachable only from its own Settings; errors.html says "in this browser" and #errors-scope says the same; the pattern doc records the limit. The copy is plain words and true (iOS storage split, pwa-ios-notes.md:161). The new row `the error log copy is honest about storage` binds both pages.
- qa W2 fixed: the a041cef1 suite lines are recorded word for word; the W2b proof count is corrected to 26 PASS.
- SUGGESTIONs: CONTRIBUTING now says seven sizes (five portrait, two landscape), 33 cells (matches scenes.js); the skin-surface comment names the 400 ms scan hold and LETTER_HOLD_MS; ROADMAP Chores "The error log folds repeats" is a true summary. B10 (jsdom hand-over row) not added; disclosed with the adversary's reason (nowPlaying is set only by playAt); acceptable.
- Delta checked: `navigate(pocketUrl, { replace: true })` uses navigate's existing replace option (common.js 11493, 11535); ALLOW_EXACT adds two exact static paths, and neighbours stay gated (auth-gate rows); prefs-sync only fetches /api/prefs with credentials and gets a 401 signed out. The deep pass on that change belongs to security-brief. No new finding.
- Verified by QA at a3402a93: 7 files (boot-error-recorder, ios15-floor, pocket-center-hold, pocket-idle-seam, auth-gate, route-census, auth-flow) `# tests 108` `# pass 108` `# fail 0`; lint 0 errors (6 warnings); 0 em or en dashes in added lines. Full suites taken from the Architect's run, not re-run here.

Gate: APPROVED r2 @a3402a93 - security-brief
- Not done (no Bash in this seat): I did not run `git diff`, any test, or a live request. Every finding below comes from reading the files in the working tree (clean at a3402a93 per the session snapshot) and from the r1 seats' measurements quoted in this section.
- INFO (lib/auth/gate.js:129, ALLOW_EXACT): traced, the two new entries cannot be widened. isAllowlisted strips the query, refuses raw and decoded `..`/%2e/%2f/%5c/backslash, decodes once and then needs an exact Set match on GET/HEAD only. Case (`/JS/...`), `//js/...`, a trailing `/`, `;x` or `#x`, an absolute-form request target, `.map`/`.json` neighbours and POST/OPTIONS all fall through to the session check and fail closed. `/js/glyph%2Dpool.js` decodes to the exact path and is admitted, but express.static resolves the same file, so nothing extra is exposed. The shell catch-all (server.js:3486) does not claim `/js/*`, so the bytes are the static file. auth-gate.test.js:64-77 binds the shapes (G1-G5 mutants killed).
- INFO (public/js/glyph-pool.js, public/js/prefs-sync.js): read in full. Neither holds user data, secrets or tokens. glyph-pool is a fixed icon vocabulary. prefs-sync shows the `/api/prefs` path and the 21 synced key names, which are already public in the source repo and only fingerprint a FileTube instance, as common.js and login.js already do.
- INFO (signed-out prefs-sync, traced): the boot `GET /api/prefs` is a fetch (Accept */*), so the gate's deny returns 401 JSON, not a redirect, in both the no-users and signed-out branches (gate.js:270-273, 320, 325). refresh() sets dormant and settles boot (prefs-sync.js:198), and flush() returns while dormant (line 89), so nothing is ever POSTed signed out. Suspicion, not security: a synced key changed on /login or /welcome (now that the seam installs there) gets a local stamp, but its mirror is dropped. After sign-in the next boot keeps the local value and never pushes it. No writer of a synced key on those pages was found besides boot re-appliers, which are suppressed by equality.
- INFO (boot recorder, the 13 shells, and /errors.html): verified local-only. `ft-boot-errors` is not in prefs-sync's SYNCED list, so the patched setItem never mirrors it. setup.js wireBootErrorLogControls and errors.html both hand the text only to share/clipboard/download (common.js exportDiagnosticLog has no network leg). errors.html renders only through textContent, and Settings has no DOM sink, so injection is inert (matches adversary r1's hostile-message measurement). /errors.html is not allowlisted, so it is behind sign-in (QA/adversary r1: a 302 to /login when signed out). What it captures: `path` is the pathname only (no query). `src` keeps the full script/link URL including its query, but only script/link load failures are recorded (no media, img or iframe), and the app's script/link URLs carry no credentials (the iOS API token is a header, never a browser URL). Cross-origin script errors are muted by the browser. Rejection messages and stacks may contain a same-origin API URL with a search term. That stays in this browser's localStorage, readable by the same origin that already holds the user's prefs. On a shared browser profile the next person sees the previous user's error paths: a low-value disclosure on the same device, which is acceptable for a self-hosted single-household deployment.
- INFO (/music?pocket=1, music.js:5151/5164, common.js:10413-10417): no redirect or injection. The param is compared strictly to '1', the URL is a constant, stripMusicParam replaceStates `location.pathname` plus the re-serialized remaining params (same-origin by construction), and openPocketSeam only changes UI state. A cross-site link can at most open the idle iPod view for a signed-in user.
- No CRITICAL/HIGH/MEDIUM/LOW findings.

Gate: APPROVED r2 @a3402a93 - adversary
- r1 W1 (census blind spots) fixed as prescribed: ios15-floor's walker now binds a loop head's let/const and a catch param (5 bad rows, 3 ok rows). Mutants "catch param not collected" and "loop head not collected" each red by name (the non-vacuity test).
- r1 W2 (center-hold cancel paths) fixed: the events are now PointerEvents with a pointerId; rows 10-15. Re-ran my five r1 survivors at a3402a93: pointercancel dropped -> (10); pointerup+cancel dropped -> 5b, (10), (11); pointerId filters dropped -> (12), (13); wheel.isConnected dropped -> (14); hideLcdNote in destroy dropped -> (15). All red by name, 22/22 green unmutated.
- r1 W3 (dead Back) fixed as prescribed: `navigate(pocketUrl, { replace: true })`, the same line I measured in the browser in r1 (history.length 4 -> 4, Back from the iPod lands on Home). The r2 re-run of that browser row was refused by this session's permission check, so the browser half rests on the r1 measurement of this exact line. The new pocket-idle-seam row binds it in CI: replace reverted to push -> red by name.
- r1 W4 (sign-in log noise) fixed per Dean's ruling. Measured in WebKit 15.4 at a3402a93: after a clean sign-in, ft-boot-errors is empty (null), and home has 44 watch links, History navigates, /music renders, 0 page errors. Raw signed-out requests: GET and HEAD of the two exact paths 200, plus `?x=1` and `/js/prefs%2Dsync.js` (the same file after one decode). POST, PUT, `/JS/...`, `/js/Prefs-Sync.js`, a trailing slash, `%00`, `//js/...`, `/js/./...`, `.map`, the extension dropped, `/js/music.js` and `/api/prefs` all 401. prefs-sync on a 401 sets dormant and settles its boot promise, with no throw and no rejection, so the recorder sees nothing. Mutants: entries dropped -> 2 auth-gate rows red; widened to a `/js/` prefix -> 2 red.
- New in the delta: none found. 0 em dashes in added lines; the copy changes match QA's prescription; the docs claims match the tree (VPM 33 cells; ROADMAP gains the fold-repeats item).
- Hygiene: my r2 allowlist probe left one fixture server from my base sandbox running (PID 257604, `.../scratchpad/adv/base/... server.js`, data /tmp/adv-allow-ynvoe1). Stopping it was refused by the permission check. It is not part of the repo tree.

### Release B (v1.365.0)

**W3** (feat/v1.365.0-oneoff-trace, built from fc9fb7c5 as 7040a582 code + 11f7f784 status-shape test; rebased onto
origin/main 4dcdf41f as **78105b7a** code + **3922ea47** test). Falsifiers red first: with the poll failing, the
populated chip still read "Clip - Clip - 47%" with no sign; one failed health probe latched the chip off (health
fetched 1 time, never 2); chip tests 2 pass / 7 fail before the edit.
- Server: lib/ytdlp/oneshotTrace.js (JSONL, last 2000 lines, every write try/caught and counted; `queued` records the
  host only; `state` events from activity.setOneShot's one listener; run.js takes a per-call hook with child-exit and
  child-close recorded separately). GET /api/ytdlp/oneshot-trace.txt (requireAdmin first, attachment). rbac-census
  263 -> 264, route-read-classification ADMIN, not in the backup bundle (lib/admin/backup.js reads only the database
  and the logo files). The status snapshot carries the server clock `now`. No timeout, sweep, gate or kill behaviour
  changed.
- Client: the age label past 60 s on the server clock (`now` minus `updatedAt`), the "Can't reach FileTube, last
  checked Ns ago" line and its clear on the first good poll (chip and /subscriptions), the probe latch released on a
  failed probe (network and 5xx), a per-row render catch. Settings > Troubleshooting > Download trace (admin + the
  downloader on, revealed by the same /api/ytdlp/engine probe as the Downloads box).
- Tests: unit oneoff-chip-stale 9, subs-oneoff-stale 4, ytdlp-oneshot-trace 13, setup-download-trace 2; integration
  ytdlp-oneshot-trace 5.
- Mutants on committed 7040a582 (/tmp git-archive sandbox, each landed in 1 file): 16 of 16 killed by name (M1-M14
  plus M3b and M4b; log: scratchpad w3-mut-r2.log). M1 drop requireAdmin, M2 drop the exit/close split, M3/M3b drop
  the offline clear (chip, /subscriptions), M4/M4b drop the probe reset (network, 5xx), M5 drop the per-row catch, M6
  full URL into `queued`, M7 drop the state listener, M8 age on the phone clock, M9 trace write not try/caught, M10 age
  threshold 0, M11 terminal rows age too, M12 Settings link never revealed, M13 drop the cap trim, M14 status drops
  `now`.
- The 11f7f784 fix: the full Node 22 run on 7040a582 was red on one test, "GET /api/subscriptions/status returns empty
  namespaces when nothing has run yet" (test/integration/ytdlp-status-endpoint.test.js): its exact-shape assertion
  predated `now`. It now binds `now` (an ISO time near the response) and keeps the rest of the shape exact. The unit
  hook could not see it (LESSONS 2). Pre-rebase suites on 11f7f784: Node 22 `# pass 11056` `# fail 0`; Node 24
  `ℹ pass 11056` `ℹ fail 0`.

**Rebase onto origin/main 4dcdf41f (v1.364.0).** No conflicts: git merged public/setup.html, public/js/setup.js,
public/js/common.js and public/css/style.css on its own. `git range-diff fc9fb7c5..11f7f784 origin/main..HEAD`: the
code commit differs only in one context line of setup.js's export list (v1.364.0's boot error log exports sit beside
W3's `loadEngineSection`); the test commit is identical. No code semantics changed. Troubleshooting order: Error log
(Export / Clear error log) first, then the lifecycle log rows, the no-glyph and rotate switches, then Download trace,
then Critter sound check. The route count stays 264 (rbac-census LOCK "the live route count is pinned" passes on the
rebased tree; v1.364.0 added no route, it changed only lib/auth/gate.js ALLOW_EXACT). Unit hook on each rebased
commit (`git rebase --exec "bash hooks/pre-commit"`, shas unchanged): `ℹ tests 8717` `ℹ pass 8717` `ℹ fail 0`, lint 0
errors, ui-lint OK, both times.

Post-rebase at 3922ea47. Targeted (the 5 W3 files plus ytdlp-status-endpoint, rbac-census, route-census,
route-read-classification, auth-gate, boot-error-recorder, lifecycle-log-export, settings-forms-sweep,
setup-advanced-pages, setup-debug-rotate-toggle, ios15-floor, pocket-idle-seam), Node 22.23.1: `# tests 180`
`# pass 180` `# fail 0`. Full suites, sequential:
- Node 22.23.1: `# tests 11150` `# pass 11138` `# fail 0` `# cancelled 0` `# skipped 12`, exit 0
- Node 24.20.0: `ℹ tests 11150` `ℹ pass 11138` `ℹ fail 0` `ℹ cancelled 0` `ℹ skipped 12`, exit 0
- The 12 skips: 9 "no ffmpeg binary (set FILETUBE_TEST_FFMPEG)" (as on main) and 3 "tools/capture playwright not
  installed" (the worktree has no tools/capture/node_modules).
- lint `✖ 6 problems (0 errors, 6 warnings)`, lint:ui `ui-lint: OK - the live debt equals docs/ui-exceptions.json`,
  lint:overlay `overlay-containment: clean (0 violations)`.
- Real browser (Chromium, the seeded fixture, admin, downloader on; /setup.html#troubleshooting at 390x844 and
  1280x900): Export error log, Clear error log and Download trace all visible (240x32 each; Download trace is an
  `<a download href="/api/ytdlp/oneshot-trace.txt">`, its group revealed), the route answers 200 `text/plain;
  charset=utf-8` with `attachment; filename="filetube-download-trace-<ISO>.txt"`, 0 page errors on both sizes.

Gate: APPROVED r1 @fc26275c - security-brief
- Gap (stated first): this seat has no Bash. I could not run `git diff 4dcdf41f`, any test, or `git rev-parse` to confirm the w3 worktree sits at fc26275c. I found the surfaces by grepping the worktree for the W3 markers (oneshotTrace, oneshot-trace, v1.365) and read each one. Every claim below is a code read, not a run.
- (1) Route, verified by reading lib/ytdlp/index.js:6096-6119. It fails closed when requireAdmin is absent (403). `deps.requireAdmin(req, res)` runs before any read, and server.js:3328 refuses anyone who is not `role === 'admin'` (403). The path is not on the auth gate allowlist (lib/auth/gate.js ALLOW_EXACT/ALLOW_PREFIX), so a signed-out request is refused by the gate. It takes no query or param input. The Content-Disposition filename is only `new Date().toISOString()` with `:` and `.` replaced, so no client input can reach it and the header cannot be injected. `Cache-Control: no-store`. A 500 returns generic text. There is no nosniff on this response, but it is text/plain plus an attachment, and the body cannot carry `<` from a host (see 2): INFO.
- (2) The trace file, verified. The path is `path.join(dataDir, fixed name)`, so there is no traversal input. Every field at every record site (index.js 4265/4267/4283/4286/4364/4603/5758/6476/6563/6612/7413; run.js 1070/1073/1133/1345/1355/1369) is a pid, number, signal, internal state name, boolean, lane, or `hostOf(url)`. No stderr, error text, path, title, label, username, cookie or header is recorded. `new URL().host` drops userinfo and the path/query, and WHATWG forbids `<`, `>`, CR/LF and spaces in a host. jobIds are server-made `crypto.randomUUID()`. The cancel route records only when the id is live or in the snapshot. Disk: intake URLs are capped at 2048 chars (lib/ytdlp/url.js:30), so at most about 2200 lines of about 2 KB stay on disk. lib/admin/backup.js never names dataDir or DATA_DIR and never calls readdir, so the trace is not in the bundle.
- (3) `now` in the status snapshot: the server clock, which the HTTP Date header already exposes, behind the session gate. No leak.
- (4) Client, verified. The common.js chip (age at 15811, offline header at 16066) and lib/ytdlp/client/subscriptions.js (age span at 2925, offline banner at 3341) use textContent / createTextNode only. No innerHTML on any new path.
- (5) The Settings reveal (setup.js:4606) is cosmetic. The server enforces requireAdmin either way, and the link performs no fetch.
- INFO (an inherited pattern, not new behaviour): the cancel route's `activity.getSnapshot().oneShots[jobId]` reads a plain `{}`. So `POST /api/ytdlp/download/constructor/cancel` (or `__proto__`) is truthy, and a manage-subscriptions user writes a `cancel-requested` line for a fake id. The comment and the integration row "an unknown id never writes a line" hold only for ids that are not Object.prototype names. Impact: a few trace lines, which the cap bounds, written by a user who can already write lines by downloading. The same lookup already drove the v1.34 no-child cancel branch. Optional fix: an `Object.prototype.hasOwnProperty.call` check.
- INFO: if `renameSync` failed on every write while appends succeeded, each trim would leave one `.tmp` in dataDir. Unrealistic on one volume. A symlink at the trace path would need write access to dataDir already.

Gate: CHANGES r1 @fc26275c - qa
- Measured (my runs on fc26275c, Node 22.23.1, node_modules symlinked then removed): the 11 W3/status/census/one-off files `# tests 121` `# pass 121` `# fail 0` `# skipped 0`; the 3 worktree skips run with the main checkout's tools/capture/node_modules (capture-determinism + capture-guard-browser) `# tests 4` `# pass 4` `# fail 0` `# skipped 0` (capture tooling only, not W3 coverage; green anyway); eslint on the 7 touched code files `0 errors, 6 warnings` (pre-existing). Real server (server.js, ytdlp on, a scratchpad script): GET /api/ytdlp/oneshot-trace.txt signed out 401, member 403 `Admin access required.` with no trace text, admin 200 `text/plain; charset=utf-8` + `attachment; filename="filetube-download-trace-<ISO>.txt"`; a `?x=../../etc/passwd` query is ignored; /api/subscriptions/status keys `subscriptions, oneShots, now, breaker, ytdlpVersion`, signed out 401. Real spawn, 64 s probe: `spawn`, `progress pct 12.5 msSinceOutput 29986` at 30 s, `child-exit` 33 s, `child-close msAfterExit 1`, no event in the 31 s after close (the heartbeat works and is cleared). `bash .harness/lib/check-markers.sh`: 18 issues on the branch, 19 on main 4dcdf41f (pre-existing, none new).
- Status shape consumers: skin-surface.js:407, main.js:2231 and watch.js:3616 read only `oneShots[<id>]`; extension/ and roku/ never call the route; no iOS app is in the repo. `now` is additive; the one exact-shape pin (ytdlp-status-endpoint.test.js) now binds it. No regression found there.
- Security: no new surface beyond what the security-brief entry above lists; I confirmed its route claims by running them (above). The trace holds no URL path, query, title, stderr or user name at any record site I read.
- W1 WARNING (blocks) - test binding: six trace events the plan lists ("each event written") have no test, and no mutant touched them: the 30 s `progress` heartbeat (lib/ytdlp/run.js:1353-1358), `sweep` (index.js:7413), `boot-requeue` (index.js:4364), the cancel `kill` of a live child (index.js:6612), the timeout `kill` (run.js:1345) and `gate-leave ok:false` (index.js:4286). Scenario A: delete the setInterval block; all 121 tests stay green; at the next hang the trace reads `spawn` then nothing, and loses the one datum that tells a live silent child from a dead one. Scenario B: change boot-requeue to `{ url: classification.watchUrl }` (or a universal sourceUrl with a token query); green; every restart-requeued job writes its full URL, breaking the privacy rule that M6 binds only for `queued`. Fix: one test per event (heartbeat via node:test mock.timers or an opts seam for the interval; boot-requeue asserts host-only like the `queued` test), each mutated red.
- W2 WARNING (safe to ship disclosed IF the release commit's wording is fixed; Dean's call for a code change) - the plan's reading "an age means the server is stuck" (W3 end, ROADMAP rewrite) is false for two healthy states. (a) A one-off queued behind a subscription run waits on heavyGate for as long as that run takes (the sweep's own comment: legitimate for hours). `chipItemLifecycle('queued')` is 'active' (common.js:15073), so after 60 s the row reads "Queued" + "updated 40 min ago". (b) A long merge: progress.js:304 emits one `phase: 'merging'` patch, then ffmpeg is silent for minutes on a long 4K file, so a healthy job shows "updated 3 min ago". Dean then restarts a healthy container. The labels themselves are true. Prescription: the ROADMAP 325 rewrite and the DEVICE-CHECKS line say "a Downloading row (not Queued, not Merging) with an age of several minutes, then the trace". Or, if Dean wants it, age only `state === 'downloading' && phase !== 'merging'` rows (a plan change: the plan says every non-terminal row).
- S1 SUGGESTION - lib/ytdlp/client/subscriptions.js:2960: the F7 signature now includes staleNote, whose text changes every second from 60 to 120 s ("61s", "62s"). A downloading row keeps the page on STATUS_POLL_FAST_MS (700 ms), so for that minute the whole one-off list is torn down and rebuilt about once a second (the LESSONS 4 row-rebuild class F7 was written to stop). Scenario: a tap on Dismiss at 75 s puts pointerdown on the old button and pointerup on the rebuilt one, so no click fires. Fix: update the age span in place, or keep it out of the signature (or round it to 10 s).
- S2 SUGGESTION - the offline line conflates faults: a throw in the success path outside render (chip: `refreshLibraryInPlace` -> `window.__filetubeRefreshLibrary`, common.js ~16152; /subscriptions: `applyStatusUpdatesInPlace`, `renderOneShots`, the update* calls in pollStatusOnce) lands in `.catch` and shows "Can't reach FileTube" while the server answered. A 401 (signed out) also reads "Can't reach FileTube". Unlikely, but this instrument exists to tell those cases apart.
- S3 SUGGESTION (copy, Dean's words in the plan) - "last checked Ns ago" counts from the last GOOD poll, but the page checked seconds ago. "last reached" or "last update" would be accurate. Do not change it without Dean.
- S4 SUGGESTION (unmeasured) - the offline header sits in `.dl-status-chip-text` (nowrap + ellipsis). The builder's real-browser pass covered /setup only, never the chip. At 320 px (the iPhone SE this plan is about) "Can't reach FileTube, last checked 3 min ago" may lose its tail. On hover devices the offline chip also rests at opacity 0.55: `.dl-status-chip-offline` is not in the full-opacity list that `has-error` is in. Measure at 320 and 390.
- INFO: the chip ages activity batches (reheat, bulk move; no `kind` filter in reduceDownloadChipState), while /subscriptions skips them (`oneShotStaleNote` returns '' for `kind`). Section 2's "one-off stuck 322" is now ROADMAP.md:325.
- Release readiness (lands in the release commit; missing at fc26275c): package.json + lock still 1.364.0; no 1.365.0 in docs/releases.json; no ROADMAP Shipped v1.365.0 entry, item 325 not rewritten (wording per W2), no Device checks owed index line; no v1.365.0 lines in docs/DEVICE-CHECKS.md (suggest: Download trace tapped in the iPhone HOME-SCREEN app, since a standalone PWA's `<a download>` of a text/plain attachment is unverified on device; airplane mode shows the chip's offline line and the first good poll clears it; a stuck row's age); no LESSONS section 4 entry ("a poll that fails silently freezes a row that looks live"); plan frontmatter `next:`/`gate:` still describe pre-rebase 11f7f784.

Gate: CHANGES r1 @fc26275c - adversary
- Measured (my runs on a /tmp git-archive of fc26275c, Node 22.23.1; the worktree was never touched): the 8 W3/status/census files `# tests 50` `# pass 50` `# fail 0`, exit 0; lint `✖ 6 problems (0 errors, 6 warnings)`, lint:ui OK, lint:overlay clean (all match the build log). Real server (server.js app, minted sessions): GET /api/ytdlp/oneshot-trace.txt signed-out 401, member 403 (no trace text), admin 200 `text/plain; charset=utf-8`, `attachment; filename="filetube-download-trace-<ISO>.txt"`, `Cache-Control: no-store`; a query string is ignored. Backup: lib/admin/backup.js reads only the DB and the logo files; the worker has no fetch handler (no cached /api). The builder's 16 mutants (M1-M14, M3b, M4b) re-run on the COMMITTED tree: 16 of 16 red by name. My 22 extra mutants: 11 killed, 11 survived (below).
- Reachability, VERIFIED with the real upstream shape: a stub yt-dlp on PATH that leaves a grandchild holding stdout/stderr (`spawn('sleep',['3'],{stdio:['ignore','inherit','inherit']})`, then exit 0), through the real route and gate: the trace reads `child-exit ms=40` then `child-close msAfterExit=2999`. The split does name the grandchild-holds-the-pipes case.
- W1 WARNING (blocks) - the exit/close split, the trace's one discriminator, is unbound. Mutant X1: register the `child-exit` record on `'close'` instead of `'exit'` (lib/ytdlp/run.js:1071). Both trace files stay green (18 of 18), because every fixture exits with nothing holding its pipes, so exit and close coincide (divergent fixture, LESSONS 2). Under X1 my grandchild fixture reads `msAfterExit=0`, against 2999 on the real code. Fix: add that fixture to the integration test and assert child-exit `ms` small and child-close `msAfterExit` >= 2000.
- W2 WARNING (blocks) - in a long hang the cap evicts the evidence. After a child exits, the 30 s heartbeat keeps running until 'close' (traceTimer is cleared only in clear()), and the heartbeat line carries no exit state. 2000 lines / 2 a minute = about 16.7 h for ONE hung job (less with other jobs running). After that, queued, gate-enter, spawn, kill and child-exit are trimmed. Dean's case is "stuck until I restart", which can be overnight. Repro (time-compressed in the sandbox: TRACE_PROGRESS_MS=1, grandchild 8 s): `total 2000`, the job's lines = `progress` x1997 + child-close + state + gate-leave, `child-exit` gone, and the order assert fails at the first event. Fix (any one, mutate it): the heartbeat records `exited`/`msSinceExit`; it backs off after N beats (for example every 10 min after the first 10); or the trim keeps each job's first lines.
- W3 WARNING (blocks; a plan defect) - the age says "stuck" on healthy rows, so the ROADMAP rule "an age means the server is stuck" is false in three verified states. (a) The chip, offline: a populated chip after 6 min of failed polls reads `Can't reach FileTube, last checked 6 min ago` AND row `updated 6 min ago`. The rows age on the device clock against a frozen snapshot, which is a stale screen dressed as a stuck server (/subscriptions does not do this: it renders rows only on a good poll, so the two surfaces disagree). (b) Activity batches on the chip: `reduceDownloadChipState` ages `kind` rows (a reheat row 5 min since its last write reads `updated 5 min ago`), while /subscriptions skips them. A batch waits on the same runExclusive gate per item, so a long one-off makes it "stuck". (c) Queued one-offs legitimately wait behind the gate. The sweep's own comment says hours is normal, and the test pins `updated 5 min ago` for `queued`. Fix: hide or freeze row ages while `offline`; skip `kind` rows on the chip (parity); and age only `downloading` rows, or word a queued row differently ("waiting for the download slot"). Fix the ROADMAP 325 wording to match. qa W2 overlaps.
- W4 WARNING (blocks) - unbound protections that the plan or this brief names. Each survivor is its repro (green on the 2 trace files unless noted): X3 `boot-requeue` writes the FULL URL (privacy: the sibling of M6; only `queued` is bound); X9 drop `Cache-Control: no-store` (brief: "no caching"); X7 /subscriptions ages on the phone clock (`nowMs = Date.now()`; subs-oneoff-stale 4 of 4 green, only the chip has a skew test); X10 the `sweep` record; X11 the cancel `kill` record; X12 the `progress` heartbeat; X13 the timeout `kill` record; X14 `gate-leave ok:true` on a rejection; X18 `lastOutputAt` never refreshed (msSinceOutput lies); X19 activity batches traced as downloads (drop the `kind` skip). The plan's "trace unit (each event written)" is unmet (qa W1 overlaps).
- W5 WARNING (blocks; cheap) - a full disk leaves one orphan `.tmp` per event in dataDir. trim() has no cleanup, unlike runlog.js:143, which the plan says to copy. Repro (oneshotTrace.setFsForTests with an fs whose `.tmp` writeFileSync creates the file, writes 4 KB, then throws ENOSPC, as write(2) does): 50 events past TRACE_TRIM_AT -> 50 `.tmp` files, 204800 bytes, errors 50. The main file also grows past the cap while trims keep failing. Fix: unlink the tmp in a catch, as runlog does.
- N1 NOTE - /subscriptions: a throw anywhere in the good-poll `.then` lands in `.catch` and shows `Can't reach FileTube, last checked 0s ago` (fault-injected: a throwing formatDownloadStaleNote on a 200 poll). The chip guards render; this page does not. qa S2 overlaps.
- N2 NOTE - a missing `now` falls back to the device clock (`serverOffsetMs = 0`), so a 10-min-fast phone shows `updated 10 min ago` on a 1 s old row (verified). The reducer's comment "without it no row carries an age" is not what the caller does. Prefer no age when `now` is absent.
- N3 NOTE (mostly pre-existing) - cancel with an id of `toString`, `constructor` or `hasOwnProperty` returns 200 and creates phantom `cancelled` rows that the status snapshot then serves to everyone (verified: oneShots keys `["toString","constructor","hasOwnProperty"]`). This diff adds 2 trace lines per call, which falsifies the integration test's "an unknown id never writes a line". A manage-subscriptions caller can flush the trace with about 1000 requests. Pre-existing root cause (a plain `{}` snapshot, LESSONS 10): own-property lookup; ROADMAP if not fixed here.
- N4 NOTE (suspicion, not measured) - the Download trace is a plain `<a download>`, not `exportDiagnosticLog` (LESSONS 3 log norm). docs/references/log-collection-pattern.md lists neither it nor its deviation. An iOS Home Screen app's handling of an attachment link was measured nowhere (Chromium only). List it as a stated deviation and add a device check: in the Home Screen app, tap Download trace and confirm the file reaches Files or the share sheet.
- N5 NOTE - "the next submit or poll retries" (plan): there is no poll before the chip exists, so a boot-time probe failure leaves the chip absent until a submit IN THIS TAB or a reload (a job started on another device never shows). Not a storm (verified: inject runs only at boot and after a successful submit, and a 404 stays latched, X2 killed). The trace also does not name the gate holder (subscriptions carry no onTrace), and nothing is recorded between child-close and `done` (avatar probe, meta persist), so a gate hang reads only "gate-wait".
- Tree: the worktree was read-only for me apart from this entry (git status before writing: only the other seats' uncommitted appends to this file; no untracked files; no node_modules). Sandboxes /tmp/adv-w3-r1(+-pristine) were removed after use.

**Gate r1 fixes** (467f9bb1 on fc26275c; every WARNING closed, the notes taken):
- A (adv W1): the exit/close split is bound by a real one-off whose stub yt-dlp exits while a grandchild holds its
  stdout/stderr for 1.5 s (integration "gate r1 W1"): child-exit under 1 s, child-close over 1 s after it.
- B (adv W2): the heartbeat keeps beating after the exit until the pipes close and says so (`exited`,
  `msSinceExit`), and backs off after 10 beats to every 5 min. The trim and the reader keep each still-open job's
  lifecycle lines (queued, gate, spawn, child-exit, kill, cancel-requested, sweep, state) however old, up to a
  quarter of the cap; a job is open until its gate-leave, or until it is terminal with every spawned child closed.
- C (adv W3, qa W2; the main session's ruling): one rule set, common.js `formatDownloadRowAge`, on the chip and
  /subscriptions: downloading and not merging/converting = "updated N ago" past 60 s; queued = "waiting N" past
  60 s; merging, converting, `kind` batches and terminal rows = none; offline = none; no `now` = none; both on
  the server clock. Converting is included with merging (the same silent ffmpeg phase).
- D (adv W4, qa W1): heartbeat, msSinceOutput refresh (X18), sweep, boot-requeue host-only (X3), cancel kill,
  timeout kill, gate-leave ok:false (the gate task is now `traceGateTask`, exported), Cache-Control (X9), the kind
  skip (X19): one test each.
- E (adv W5): trim() unlinks its .tmp on any failure; while trims keep failing, appends stop at twice the cap.
- F (qa S1): the age is out of the one-off signature and updated in place; the Dismiss node survives a tick.
- G (adv N1, qa S2/S3): "Can't reach FileTube" only for a failed fetch or a non-OK answer; a 401 = "Signed out -
  reload to sign in"; a throw after a good poll is counted (`downloadChipPollFaultCount`,
  `subsStatusPollFaultCount`), never offline. "last checked" is now "last reached".
- H (adv N3, security INFO): the cancel route's lookup is an own-property one: constructor, toString,
  `__proto__`, hasOwnProperty = 404, no phantom row, no trace line.
- I (adv N4): log-collection-pattern.md lists the download trace with its deviations (always on; a plain admin
  attachment link, not exportDiagnosticLog; no Clear) and the owed Home Screen app device check.
- qa S4, real browser (Chromium, the seeded fixture, the status route stubbed by Playwright; probe
  scratchpad Bfix-chip-probe.js): BEFORE (fc26275c) at 320 and 390 px the pill's text slot is 212 px and "Can't
  reach FileTube, last checked 0s ago" needs 273 px: clipped. AFTER: where the sentence does not fit, the pill
  says "Can't reach FileTube" (133 of 133 px) and the sentence is its tooltip; "Signed out - reload to sign in"
  190 of 190 px; at 1280 the full sentence fits (270 of 270 px, slot 272). 0 page errors at each width. Not
  fixed (out of scope, for Dean): the offline pill on a hover device rests at opacity 0.55 like a healthy one.
- Measured on 467f9bb1, Node 22.23.1: 35 targeted files (the W3 five, chip, subs, ytdlp-run, oneshot
  cancel/stuck/retry/keep-mine/audio-keep, status endpoint, censuses, spawn security, settings sweeps)
  `# tests 869` `# pass 869` `# fail 0`; the commit's unit hook `ℹ tests 8739` `ℹ pass 8739` `ℹ fail 0`; lint
  `✖ 6 problems (0 errors, 6 warnings)`, lint:ui OK, lint:overlay clean. No full suite (the main session runs it).
- Mutants on committed 467f9bb1 (/tmp git-archive sandbox + pristine copy, each diff non-empty, sandbox restored
  identical; log scratchpad Bfix-mut.log): 36 run, 36 killed by name. A1 child-exit on 'close'; B1 beats never
  say exited; B2 msSinceExit null; B3 no back-off; B4 trim pins nothing; B5 every job open; B6 reader slices the
  tail; D1 no heartbeat; D2 lastOutputAt never refreshed; D3 no sweep record; D4 full URL in boot-requeue; D5 no
  cancel kill record; D6 no timeout kill record; D7 gate-leave ok:true on a rejection; D8 no Cache-Control; D9
  no kind skip; E1 no .tmp cleanup; E2 no hard cap; C1/C1s merging ages (chip, /subscriptions); C2/C2s queued
  reads "updated"; C3 batch rows age; C4/C6 ages while offline (chip, /subscriptions); C5/C7 no `now` falls back
  to the device clock; C8 /subscriptions on the phone clock; F1 age back in the signature; F2 no in-place update;
  G1/G3 a page fault reads offline; G2/G4 a 401 reads "Can't reach"; G5 no narrow-pill fallback; H1 inherited
  lookup in cancel. C3 is killed by "gate r1: formatDownloadRowAge, every rule"; in the DOM test it is MASKED, as
  real batches carry state 'running', which the state rule never ages (a redundant guard, LESSONS 2).

Gate: APPROVED r2 @b8b3ca7d - security-brief
- Gap, unchanged: no Bash. I did not run git diff, git rev-parse or any test. Everything below is a code read of the w3 worktree, taken to be at b8b3ca7d.
- r1 INFO 1 (cancel prototype keys): fixed as prescribed, verified. lib/ytdlp/index.js:6573-6576 now uses `Object.prototype.hasOwnProperty.call(cancelSnapshot.oneShots, jobId)` for both the trace record and the no-child cancel branch (`entry = knownEntry`). A prototype name reads as null, so it writes no trace line, sets no latch and makes no phantom row; the route falls through to 404.
- r1 INFO 2 (.tmp orphans): fixed, verified. In lib/ytdlp/oneshotTrace.js:128-134, trim() unlinks its tmp in a catch and rethrows; trimSafe counts the failure. When the count reaches `maxLines * 2` (4000), record() tries one trim and drops the event if that fails, so the file stays bounded while trims keep failing. With URLs capped at 2048 chars, that is about 4000 lines of about 2 KB on disk.
- Pinning (keepMask, 94-109), verified bounded: pinned lines are capped at `floor(max/4)` = 500, chosen newest first, and the total is still capped at `max`. Neither the file nor the export can grow past the cap. A user with download rights who queues hundreds of jobs can push an older hung job's pinned lines out of the 500 slots. That user can already disrupt the queue, and the cost is diagnostic quality, not data or secrets. INFO. A job id that never gets gate-leave (dropped at boot) stays "open" and keeps up to its pinned lines, inside the same 500 bound. INFO, not security.
- Test seams, verified unreachable from a request. setLimitsForTests, setProgressMsForTests and setFsForTests have no caller outside test/ (searched everything except test/; only their definitions and exports in oneshotTrace.js). They take no request input, and no route touches them. traceGateTask (index.js:4298) is called only at 4266 with a server-made jobId. Exporting it gives a request no new surface. progressDelayMs reads only the module constant in production.
- New fields: progress `exited` (boolean) and `msSinceExit` (number or null), run.js:1361-1367. No text from the child.
- The "Signed out - reload to sign in" text is a fixed string, picked when the poll error has `status === 401` (common.js:15362, 16224; subscriptions.js:2893). It goes through the same textContent paths as r1. It reveals nothing beyond the 401 the browser already sees.
- boot-requeue host-only and Cache-Control: the code is unchanged from r1 (verified then). The tests the coordinator says were added are not runs I made.
- Nothing new found.

Gate: APPROVED r2 @b8b3ca7d - qa
- Measured on b8b3ca7d (Node 22.23.1; node_modules symlinked, then removed): the 12 W3, status, census, one-off and progress files gave `# tests 188` `# pass 188` `# fail 0` `# skipped 0`. eslint on the 5 touched code files: `0 errors, 6 warnings` (pre-existing). 0 em dashes in the added lines. I did not re-run the full suites; the numbers above them are the Architect's.
- W1 fixed as prescribed. Each event named in r1 now has its own test: the heartbeat (plus the exited/back-off/latest-output rows), sweep, boot-requeue (asserts `host` and no `http`, video id or token in the raw file), the cancel kill, the timeout kill, and gate-leave ok:false through the exported `traceGateTask`. The builder's mutants D1-D7 were killed by name. I ran the tests but not the mutants.
- W2 fixed differently, per the main session's ruling, through one rule in common.js `formatDownloadRowAge`, used by both surfaces. Only a downloading row that is not merging or converting reads "updated N ago". A queued row reads "waiting N". Batches, terminal rows, an offline screen and a missing `now` show no age. Evaluated: progress.js sets `phase` only to 'merging' (Merger, Fixup) or 'converting' (ExtractAudio, VideoConvertor, VideoRemuxer), so both silent ffmpeg phases are covered, and the phase stays set until a Destination line resets it. The window after the child closes, before `done`, is bounded (a 30 s persist race plus the time-bounded avatar probe), so a healthy single-file job rarely passes 60 s there. The copy is true. The ROADMAP 325 wording still lands in the release commit, and should now name "a Downloading row with an age" and "waiting N".
- S1 fixed as prescribed. The age is out of the signature and `updateOneShotAgesInPlace` rewrites only the span; a test checks that the Dismiss node survives an age tick.
- S2 fixed. A `reached` flag counts a throw after a good poll (`downloadChipPollFaultCount`, `subsStatusPollFaultCount`). A 401 reads "Signed out - reload to sign in", which is true: the session gate answered 401.
- S3 fixed: the copy is now "last reached N ago".
- S4 fixed for width. Where the sentence does not fit, the pill falls back to "Can't reach FileTube" with the sentence in a `title`; the builder measured 212 px slots at 320 and 390. Disclosed for Dean: on a phone a tooltip never shows, so the "last reached" age is not visible there. The opacity point is deferred to Dean, as stated in the fixes entry.
- Test seams: `setProgressMsForTests`, `setLimitsForTests` and `setFsForTests` have no caller outside test/ (grep of lib, server.js and public). `traceGateTask` is called only at index.js:4266 with a server-made jobId. None takes request input. No production path reaches them.
- Delta checked: keepMask caps pinned lines at max/4 and the total at max, keeping file order; the reader applies the same mask. The heartbeat's setTimeout chain is cleared by `clear()` on close and error, and nothing reschedules after a clear. The hard cap of 2x stops appends while trims fail. The cancel own-property lookup also feeds the no-child branch. The /subscriptions offline transition re-renders the rows without ages.
- S5 SUGGESTION (new, comment accuracy): lib/ytdlp/client/subscriptions.js:3369 still says `"Can't reach FileTube, last checked Ns ago"`; the copy is now "last reached". Fold it into the release commit.
- INFO: a job that never gets a gate-leave (process killed, requeue dropped) stays "open" and keeps its pinned lines inside the 500-line bound (security-brief agrees). The cost is diagnostic only.

Gate: APPROVED r2 @b8b3ca7d - adversary
- Measured (my runs on a /tmp git-archive of b8b3ca7d, Node 22.23.1; the worktree untouched apart from this entry): the 8 W3/status/census files `# tests 78` `# pass 78` `# fail 0`, exit 0. Mutants on the committed tree: my r1 survivors X1, X3, X7, X9, X18 and X19 are all now red by name. Of 22 new mutants on the r1 fixes, 21 are red by name and 1 survives (R14, below).
- W1 fixed as prescribed. My r1 stub (a grandchild holds the pipes 3 s), through the real route: `child-exit ms=37`, `child-close msAfterExit=2999`. X1 (exit recorded on 'close') now fails the W1 integration test and both W2 heartbeat tests.
- W2 fixed (back-off + `exited`/`msSinceExit` + pinning). Sped up through the real route (setProgressMsForTests(1), maxLines 200, an 8 s grandchild hang), read MID-HANG: the file holds 200 lines; queued, both state lines, gate-wait, gate-enter, spawn and child-exit are all kept, plus 193 beats (the last one `exited=true msSinceExit=7989`). Once the job closes, its old lines age out normally (by design). Trim abuse, measured with keepMask at the real cap: 600 never-closing jobs x 5 pinned lines plus a live hang plus 3000 newer lines -> 2000 kept, 494 stale pins (quota 500), the hang's 5 lifecycle lines kept, the newest 1500 lines and the last line kept; a flood of 3000 open jobs -> 2000 kept, newest kept, oldest dropped. The tail is never starved below 3/4 of the cap. Back-off: R18 (no back-off) is red.
- W3 fixed per the main-session ruling, on both surfaces. Chip: after 6 min offline the row age is '' under "Can't reach FileTube, last reached 6 min ago"; a reheat batch '', queued `waiting 5 min`, merging '', downloading `updated 5 min ago`. R1-R7 (offline ages, no-now device clock, merging ages, queued says "updated", batch ages; chip and /subscriptions) are all red.
- W4 fixed: X3, X9, X18 and X19 are red, and so are the sweep, cancel-kill, timeout-kill and gate-leave ok:false records (builder D3-D7, my survivors X10-X14).
- W5 fixed. My r1 ENOSPC fs, 2500 events: 0 `.tmp` files, the file stops at 4000 lines (2x cap), errors 2500. After the disk frees, one event trims it to 2001. R20 (no unlink) and R21 (no hard cap) are red.
- N1 fixed (R11/R12 red). N2 fixed (ADV3: no `now` and a phone 10 min fast -> no age). N3 fixed: cancel of toString, constructor, hasOwnProperty, __proto__ and valueOf -> 404, 0 trace lines, status oneShots `[]`; R22 is red.
- 401 path, real server: signed-out GET /api/subscriptions/status and /health both 401 JSON (no redirect), and so is a bogus cookie. So "Signed out - reload to sign in" is reachable; R8/R9 are red.
- Narrow pill, my own real-browser probe (Chromium, real server, admin session, status routed to fail): at 320 and 390 the text is "Can't reach FileTube" (133 of 133 px) with the full sentence as the title, and the 401 text is 190 of 190 px; at 1280 the full sentence is 270 of 270 px; 0 page errors at all six probes. This matches the builder's numbers. R10 is red.
- W6 WARNING (safe to ship disclosed) - R14 survives: the pin quota `Math.floor(max / 4)` -> `max` passes all 21 trace unit tests. So the anti-starvation bound has no test. The behaviour is correct, as measured above. Add one test (more open-job lines than max/4, assert the newest 3/4 kept); list it as a v1.365.0 gate leftover in ROADMAP.
- N6 NOTE (the ruling, for Dean) - a merging or converting row never ages. A wedged ffmpeg merge, the most plausible real hang, reads "Merging..." forever with no stuck signal on screen; only the trace shows it (heartbeats with `exited`). A longer threshold for those phases (for example 10 min) would keep the signal.
- N7 NOTE (reasoned, not measured) - after the child closes, a healthy row can sit `downloading` with phase null through the avatar probe (up to 30 s) and the meta persist (up to 30 s), so it can briefly read "updated 61s ago".
- N8 NOTE - a job whose pending entry is dropped at requeue (invalid) never gets gate-leave or a terminal state in the trace, so its lines stay pinned forever. That is bounded by the quota (measured above).
- N9 NOTE - on a phone the offline pill shows only the bare words; "last reached N ago" sits in a title tooltip that touch cannot open.
- Tree: before writing, git status showed only the other seats' uncommitted appends to this file. I removed all my sandboxes and probe dirs. The other /tmp/filetube-adv-* dirs are not mine and I left them alone.

### Release C (v1.366.0)

**W4** (feat/v1.366.0-vr-360, built from fc9fb7c5 as d3d9e256 port + b4344963 feature + 4433a729 test + 20dfa7a8
native full-screen note; rebased onto the v1.365.0 release commit 398e7873 as **252887ee** port + **8918f050** feature
+ **2ee6170a** test + **34341199** note). The builder was killed by the host reboot at about 19:12 UTC and resumed;
nothing was lost (all four commits were on disk).

- V0 falsifier (before wiring; ffmpeg and ffprobe 7.0.2-static, grown keys
  `rotation,side_data_type,projection,type,bound_left,bound_right`, spelled as ffprobe 7 prints them). Fixtures made
  with ffmpeg `lavfi color` + `drawbox` (this static build has no `drawtext`, so the panorama's sides are colour bands:
  front red, right green, back blue, left yellow) and Google's spatial-media injector (github master, python 3.12 in a
  /tmp venv). Results: vr-360-v1 (v1 XML box) and vr-360-v2 (v2 sv3d) print `Spherical Mapping`, `equirectangular`;
  vr-360-tb-v2 prints `Stereo 3D` `top and bottom` plus equirectangular; vr-180-sbs-v2 prints `Stereo 3D` `side by
  side` plus `tiled equirectangular`, bound_left 257, bound_right 255; clip_360_TB.mp4 (1:1 stacked frame, no metadata)
  has no side data. STOP check: rot90.mp4 gives `[{"rotation":90}]` with the old args and
  `[{"side_data_type":"Display Matrix","rotation":90}]` with the grown args; the rotation readers look for the
  `rotation` key, so rotation still parses. Codecs and dimensions unchanged on every file. No STOP rule hit. The
  fixtures (2-3 KB each) and the recorded real ffprobe output `ffprobe-grown.json` are in test/fixtures/vr/ with a
  provenance README.
- Server: the probe args grow; only the scan writes `projection` (only when the side data says so; absent stays
  absent), both reuse arms carry it with no re-probe; `projectionOverride` follows chaptersManual
  (POST /api/videos/:id/projection: requireModifyLibrary first, restrictedVideoMutation, ownMediaItem, NUL or empty id
  refused, null deletes the key; the re-init carry and the Phase-2 mirror; library-write + enforced; the proto-id
  net). GET serves the effective projection (owner pick > file metadata > file name). No SCHEMA_VERSION bump.
- Client: cog "360 view" (per device, `ft-vr-view`, default off, shown only for a sphere) and owner "Video type" (Auto,
  Flat, 360, 360 top-bottom, 360 side-by-side, 180, 180 side-by-side, 180 top-bottom; `ui.menu`, built on `ui.sheet`).
  The sphere mounts only for a sphere with the switch on, the player full with this item and the browser not
  presenting the video itself; one reconciler unmounts on every boundary. vr-view.js loads on the first mount only.
  The drawImage shrink path is deleted; a frame over the GPU texture limit is refused with a note. New user copy for
  the gate and Dean: "Full screen on this device shows the flat picture; 360 view returns here" (once per page view,
  on the way back from the browser's own full screen, only when a sphere was up).
- Tests: unit video-projection 9 (8 pass + 1 skip without an ffprobe binary; with
  `FILETUBE_TEST_FFMPEG=~/.local/bin/ffmpeg-static/ffmpeg` the LIVE row passes too, 9 of 9, on 34341199), unit
  vr-view-client 10, integration video-projection 6. Edited locks: music-ambient AC9, player-overlay-no-filter (the net
  covers vr-view.js), rbac-census, route-write-classification, media-write-proto-ids.
- Left/right sense, measured (tools/vr-proof/probe.js, Chromium with SwiftShader WebGL, the real server, re-run on the
  rebased 34341199, `pageErrors []`): 501 px of drag per 90 degrees; yaw 0 reads red (front, rgb 254,0,0); a 90 degree
  drag LEFT reads green (the RIGHT band, rgb 1,128,1); back to front reads red; a 90 degree drag RIGHT reads yellow (the
  LEFT band, rgb 255,255,0). The picture follows the finger and is not mirrored (ROADMAP risk 4 settled).

| Row | getContext calls | Canvases | vr-view.js loaded | 360 row hidden | Video type hidden |
|---|---|---|---|---|---|
| flat (switch stored on) | none | 0 | no | yes | no |
| vrOff | none | 0 | no | no | no |
| vrOn | webgl | 1 | yes | no | no |
| off (switch tapped off) | webgl | 0 | yes | no | no |
| pickFlat: before | webgl x2 | 1 | yes | no | no |
| pickFlat: after Flat | webgl x2 | 0 | yes | yes | no |
| pickFlat: after Auto | webgl x3 | 1 | yes | no | no |
| nav (in-app home) | webgl x3 | 0 | yes | no | no |

  The pickFlat row stored `{projection: "360"}` (the name rule). The rows match the pre-rebase runs on 4433a729 (twice)
  and 20dfa7a8 exactly.
- Mutants on the committed, rebased 34341199 (/tmp git-archive sandbox with a pristine copy, each mutation landed in 1
  file, Node 22.23.1; driver scratchpad w4-mut.py, log C-mut.log): 18 of 19 killed by name.
  - M1 drop the switch check, M2 drop the flat check, M13 native presentation ignored, M14 docked still mounts:
    "vrMountDecision: each condition alone stops the mount".
  - M3 restore the drawImage shrink: "source rules: nothing reads the video into a 2D canvas...".
  - M4 drop requireModifyLibrary, M7 drop the clear-deletes branch, M11 the route accepts any value: "route: a pick
    wins at GET, flat hides a sphere, null DELETES the key; validation and RBAC".
  - M5 drop the Phase-2 mirror: "Phase-2 mirror: a pick and a clear landing MID-SCAN survive the final merge".
  - M6 drop the plain reuse-arm carry, M10 store projection for a flat file too: "REACHABILITY: the real fixtures
    through the real scan land `projection`...". M6b drop the legacy codec-arm carry: "the OTHER reuse arm...".
  - M9 drop the ffprobe args growth: REACHABILITY and "re-init carry: a CHANGED file keeps the owner pick...".
  - M12 the file metadata beats the owner pick: "effectiveProjection: owner pick > file metadata > file name...".
  - M15 the note never shows, M16 shows every time, M17 fires with no sphere: "vrNativeNotice: a sphere that gives
    way to the browser's own full screen is disclosed ONCE...".
  - M8 drop the re-init carry: SURVIVED, equivalent. The Phase-2 mirror copies `projectionOverride` from the fresh
    database whenever the item exists there, so it masks this carry (the same belt and braces as chaptersManual).
    M8x drops both and is KILLED by "re-init carry..." and "Phase-2 mirror...", which proves the mask.
- First-run lesson (for LESSONS 2 at release): M6 first survived because an unchanged-only rescan saves nothing, so a
  dropped derived field never reached disk. The rescan test now indexes one new file first so the scan saves.

**Rebase onto 398e7873 (v1.365.0).** `git rebase --exec "bash hooks/pre-commit"` (no force-push; the branch was never
pushed). One conflict: test/integration/rbac-census.test.js, where v1.365.0 and W4 had each bumped
`EXPECTED_ROUTE_COUNT` 263 -> 264. Resolved by keeping v1.365.0's line and its comment, adding W4's v1.366.0 comment
in front, and taking the number from the instrument: with 264 the census LOCK failed with "route count changed (265
vs 264)", so the line reads 265 and the census passes. The feature commit's message now says "Route count 264 -> 265".
public/css/style.css merged on its own; `git range-diff fc9fb7c5..20dfa7a8 398e7873..34341199` shows the port, test
and note commits identical and the feature commit different only in the census line and that message line. No
ROADMAP, plan or other docs edits in W4. Hook on each rebased commit (it sources ~/.profile, so its unit run is Node 24.14.0, hence the `ℹ` lines), all `Pre-commit checks passed.`, lint
`✖ 6 problems (0 errors, 6 warnings)`, ui-lint OK: 252887ee `ℹ tests 8739` `ℹ pass 8739` `ℹ fail 0`; 8918f050
`ℹ tests 8757` `ℹ pass 8756` `ℹ fail 0`; 2ee6170a `ℹ tests 8757` `ℹ pass 8756` `ℹ fail 0`; 34341199 `ℹ tests 8758`
`ℹ pass 8757` `ℹ fail 0` (the 1 not passed is the LIVE ffprobe skip). The first hook run on 252887ee failed only
because the worktree had no node_modules symlink (ui-lint's canary copies a rule to /tmp and cannot resolve
css-tree); with the symlink it passed.

Post-rebase at 34341199. Targeted (the 3 W4 files plus rbac-census, route-census, route-write-classification,
route-read-classification, media-write-proto-ids, music-ambient, player-overlay-no-filter, overlay-containment,
ui-lint, shell-script-global-collisions, oneoff-chip-stale, subs-oneoff-stale, ytdlp-oneshot-trace (integration),
player-chapters-cog-row, watch-init-behavioral, ffprobe-codecs), Node 22.23.1: `# tests 286` `# pass 285` `# fail 0`
`# skipped 1`, exit 0. Full suites, sequential:
- Node 22.23.1: `# tests 11203` `# pass 11190` `# fail 0` `# cancelled 0` `# skipped 13`, exit 0 (29 min; the main
  checkout was running its own tests part of the time)
- Node 24.20.0: `ℹ tests 11203` `ℹ pass 11190` `ℹ fail 0` `ℹ cancelled 0` `ℹ skipped 13`, exit 0
- The 13 skips: 9 "no ffmpeg binary (set FILETUBE_TEST_FFMPEG)" (as on main), 3 "tools/capture playwright not
  installed" (the worktree has no tools/capture/node_modules) and 1 W4 LIVE ffprobe row (passes with the binary, above).
- lint `✖ 6 problems (0 errors, 6 warnings)`, lint:ui `ui-lint: OK - the live debt equals docs/ui-exceptions.json`,
  lint:overlay `overlay-containment: clean (0 violations)`. check-markers: 23 issues, all in older plan approval
  markers (stale or unknown-commit approvals in 2026-09-29-next-waves.md and this plan, plus "approved work @b8b3ca7d
  is already in 'main' but plan not Shipped", which the release close-out clears); none from W4.

**Security-brief r1 @950c2aca.** Gap first: this seat has no shell, so `git diff 398e7873` was NOT run; the
change was traced by searching the w4 tree (projection, vr-view, vrMountDecision, effectiveProjection, /projection)
and reading each hit. No tests run. 0 CRITICAL, 0 HIGH, 0 MEDIUM, 0 LOW, 5 INFO.
- Verified: POST /api/videos/:id/projection runs requireModifyLibrary first (admin or canModifyLibrary, else 403),
  then restrictedVideoMutation (own-property lookup, 404 when not visible), refuses an empty or NUL id, accepts only
  `null` or a string in OVERRIDES (`typeof` + `includes`, so arrays, objects and `__proto__` values are 400), and
  writes or deletes exactly one key, `projectionOverride`, on the item found by ownMediaItem (hasOwnProperty, so
  `__proto__`/`constructor` are 404; the proto-id net covers the route). The pick is library-wide item data, the
  same as chaptersManual; there is no per-user data on this path. CSRF posture equals the other write routes
  (SameSite=Lax session cookie; JSON body).
- Verified: the ffprobe change is one longer constant `-show_entries` string; execFile with an args array, no shell;
  the file path stays the last positional arg as before. The parsed JSON only flows through projectionFromProbe,
  which reads fields and returns one of six fixed strings; the scan stores `projection` only if isProjection
  passes. No ffprobe key or value is copied into the db, so no prototype pollution path.
- Verified: the name rule's regexes are linear (one character-class split, an anchored `^.*[\\/]`, a 2-4 char
  extension tail, an anchored per-token FISHEYE). No ReDoS.
- Verified: vr-view.js is fetched from a constant same-origin `/js/vr-view.js` only on the first sphere mount; the
  shader sources are static literals; the new cog rows are a constant insertAdjacentHTML string with no item data;
  the Video type menu labels are constants rendered by ui.menu (textContent, no innerHTML in ui.js).
- Verified: fixtures and tools/vr-proof hold no secrets; probe-result.json has no paths or tokens.
- INFO 1 (not security, for adversary/qa): `enableMotion` has NO caller anywhere in public/, so tilt (plan outcome 3:
  "drag, tilt") is unreachable and the comment "iOS asks permission on the tap that enables it" (vr-view.js:354)
  describes a path no UI reaches. On security this means no motion prompt can ever be raised unprompted.
- INFO 2: tools/vr-proof/probe.js:22 has the absolute `/home/coder/projects/filetube/tools/capture` fallback; 30
  other tools/ files share this convention. A username, not a secret.
- INFO 3 (existing, not new): the scan's ffprobe execFile has no `timeout` (maxBuffer only); the longer args do not
  change that.
- INFO 4 (existing pattern): the 500 reply echoes `err.message`, as the chapters route does.
- INFO 5 (existing pattern): restrictedVideoMutation checks visibility on the cached db, the write uses the fresh
  one; the chapters route has the same gap. Only a modify-library user reaches it.

Gate: APPROVED r1 @950c2aca - security-brief

**QA r1 @950c2aca.** Ran on the w4 tree (node_modules symlinked, then removed): targeted Node 22.23.1 with
`FILETUBE_TEST_FFMPEG=~/.local/bin/ffmpeg-static/ffmpeg` (unit video-projection + vr-view-client, integration
video-projection, rbac-census, route-write-classification, media-write-proto-ids, music-ambient,
player-overlay-no-filter): `# tests 66` `# pass 66` `# fail 0` `# skipped 0`, exit 0. The LIVE ffprobe row passed
(`ok 56`). lint `✖ 6 problems (0 errors, 6 warnings)`, lint:overlay `clean (0 violations)`, lint:ui `OK`. Full
suites NOT re-run (per brief); read from the logs: Node 22 `# tests 11203` `# pass 11190` `# fail 0` `# skipped 13`,
Node 24 `ℹ tests 11203` `ℹ pass 11190` `ℹ fail 0` `ℹ skipped 13`, both exit 0 on 34341199. 34341199..950c2aca is
the plan doc only. Verified: the GET serve puts `projection` after the `...item` spread (a Flat pick really hides a
stored sphere); the route's guard order and 400/403/404 arms; both reuse arms keep `existing` whole; the Phase-2
mirror sits inside `if (freshItem)`; the move route carries the whole item (media/move.js:489); no other ffprobe
consumer reads side data by position (rokuCompat and firstStreamRotation look for the `rotation` key); no em dash
in any added line; the post-rebase probe run (scratchpad C-probe.json) equals the committed probe-result.json
except `runAt`. Security: covered by the security-brief seat; I agree (one whitelisted key, execFile args array,
constant HTML, no new data exposure).
0 CRITICAL, 4 WARNING, 6 SUGGESTION.
- **W1 (WARNING) tilt is unreachable.** Outcome 3 and Dean's scope say "drag, tilt". `enableMotion` has no caller
  anywhere in public/ (grep), so the motion path never runs; vr-view.js:16 ("Motion (phone) - the phone's orientation
  drives the view") and :354 ("iOS asks permission on the tap that enables it") describe a tap that does not exist.
  Scenario: Dean turns 360 view on, tilts the phone, nothing moves. The plan's client list never named a motion row,
  so the plan is wrong here too. Fix: either wire a "Motion" control (requestPermission inside its tap) with a test,
  or record the cut in section 7, say "drag only" in ROADMAP/releases.json, and reword the two comments. That is a
  product call: ask Dean.
- **W2 (WARNING) a lost WebGL context does not stay flat, and three boundaries are not bound.** watch.js:2428
  `onFail` unmounts and toasts "showing the flat picture" but does not set `vrRefusedKey` (onTooLarge does). The host
  MutationObserver runs `syncVr` on every class change (controls-autohidden at player.js:2713, a tap, a pause), so
  within seconds `want` is true, `vrHandle` is null and the key is not refused, so it mounts a NEW context. Scenario:
  an iPhone loses the context (back from background, memory pressure): the toast says flat, the sphere returns at
  once, and a GPU that keeps losing it gets a remount and a toast each cycle. Fix: `vrRefusedKey = key` in onFail
  (cleared by the switch or a pick, as now). Also the plan's "unmount on each boundary" test is met only for the pure
  decision: no test fails if the `fullscreenchange` / `webkitbeginfullscreen` listeners, the dock path or the
  contextlost path are removed (the M13/M14 mutants changed the decision, not the wiring). Add a jsdom test that
  drives syncVr through a stub VrView.mount for native full screen enter, dock and contextlost.
- **W3 (WARNING) stale, dead cog rows on a TV episode.** initTvWatch runs `ensureCogControlsInjected()` (watch.js:4480)
  but not `setupVrView`, and the rows live in the persistent host (player.js ensureHost runs once). Scenario: watch a
  360 file (the "360 view" and, for an owner, "Video type" rows shown), then open a TV episode in the app: both rows
  are still shown, and both are dead (their listeners were aborted with the old view's signal). Fix: hide both rows
  in the TV path (or in ensureCogControlsInjected before each view wires them).
- **W4 (WARNING, a W4 STOP rule) a flat video can reach WebGL through the name rule.** Measured with
  projectionFromName: "Xbox 360 unboxing [dQw4w9WgXcQ].mp4" at 1080x1080 -> `360-tb`; "Day 180 of learning
  piano.mp4" at 1080x1080 -> `180`; "Tony Hawk 360 flip tutorial.mp4" at 2532x1170 (an iPhone screen recording)
  -> `360`. With the per-device switch on, each of these flat videos mounts the sphere (WebGL on a non-VR video,
  the iPhone risk). Plan W4 STOP: "the gate finds any path where a non-VR video reaches WebGL" -> AskUserQuestion.
  Safe to ship disclosed only on Dean's word (default off, the owner's Flat pick, the row turns it off); the other
  option is to narrow the name rule (only `_`/`-` delimited tokens, or a 360/180 token must come with an eye token or
  a `vr` form).
- S1: style.css:6930 comment, wrong mechanism: the glyph, resume and transcode overlays come BEFORE the video in the
  host template (index.html:272-294) and paint above the canvas by their own z-index (2, 10), not by being later.
- S2: tools/vr-proof/probe-result.json `runAt` 2026-10-05T19:18:53Z is the pre-rebase run; the build log says the
  probe was re-run on 34341199 (true: scratchpad C-probe.json, 23:57:44Z, identical but for runAt). Say which run is
  committed.
- S3: with the sphere up, the picture's gestures (double-tap skip, hold-2x, tap-to-reveal, pull to the mini player)
  give way to tap = play/pause, and a desktop double-click toggles twice. Disclose in the device checks.
- S4: production ffprobe is Alpine's apk ffmpeg (Dockerfile:17, node:22-alpine), not the 7.0.2 the LIVE row ran. The
  key names are stable in ffprobe's source (should work, not verified here). Device check: scan one VR file in the
  container and see the 360 view row.
- S5: the Video type row reads `canModifyLibrary` when setupVrView runs; nothing re-syncs when fetchCurrentUser
  settles (the next host class change heals it).
- S6: a library item with no stored width/height (pre-v1.26.1) gets no name-rule sphere until the dims backfill,
  and mediaData is not re-read after it: the first play shows no 360 view row. Disclose.
Release readiness at 950c2aca (these land in the release commit): package.json and package-lock.json still 1.365.0;
ROADMAP Shipped entry missing, the VR Planned entry (now ROADMAP.md 482-503, not 457-479) unticked with risks 1-4
unresolved in prose (4 is settled: say so; 1-3 with the device check); no Device checks index entry; no
docs/releases.json v1.366.0 entry (must not claim tilt unless W1 wires it); no DEVICE-CHECKS.md v1.366.0 lines (iPhone
FIRST inline 360 black-picture check, the native full screen note, the left/right sense, a VR scan on the container);
no LESSONS line (candidate: an unchanged-only rescan saves nothing, so a dropped derived field never reaches disk;
dedupe against sections 2 and 9); `scripts/plan-complete.js ... "Shipped v1.366.0" --apply` not run; frontmatter
`next:`/`gate:` still say C pending.

Gate: CHANGES r1 @950c2aca - qa

**Adversary r1 @950c2aca.** Mutated only in a /tmp `git archive` sandbox (pristine copy diffed clean after every
mutant; node_modules symlinked there, not in w4). Targeted Node 22.23.1 with `FILETUBE_TEST_FFMPEG`: the 3 W4 files
`# tests 25` `# pass 25` `# fail 0` `# skipped 0`. lint `✖ 6 problems (0 errors, 6 warnings)`, eslint on the 10
W4-touched files alone: 0 problems; lint:ui OK; lint:overlay `clean (0 violations)`. Full suites not re-run (brief).
0 CRITICAL, 6 WARNING, 6 NOTE.
Verified holds: (a) old vs grown ffprobe args on 14 shapes (the 7 fixtures + generated rot90/180/270, mkv, mp3,
cover-art mp3): parseFfprobeStreams, rokuCompatVerdict (rotation, verdict, attached pics), format and chapters
identical on every one. (b) The shipped probe re-run on pristine 950c2aca reproduces the build-log table exactly
(flat with the switch on: 0 getContext, no script, no canvas; sense red/green/red/yellow at 501 px per 90 deg).
(c) My own Chromium rows: dock() with the view alive removes the canvas (host class observer); the video element's
own full screen unmounts and the exit remounts; in-app nav sphere -> flat makes no new context. (d) A backup ->
wipe -> restore round trip keeps `projection` and `projectionOverride` (scratch test, removed). (e) No drawImage or
2D context reads the video anywhere in public/js (grep). (f) Re-ran M4, M8, M9: as claimed (M8 survives,
equivalent through the Phase-2 mirror's `if (freshItem)`).
- **W1 (WARNING) tilt is inert** (same as qa W1, confirmed): `enableMotion` has no caller (grep public/js); no
  DeviceOrientation permission is ever asked; the build log does not disclose it. Outcome 3 says "drag, tilt"; the
  plan's client list dropped it (the plan is wrong). Wire a motion control (requestPermission inside its tap) with a
  test, or Dean cuts it and section 7 / releases.json say "drag only".
- **W2 (WARNING) the reconciler's boundaries are not bound by any test** (the brief's question 2: no, the pure
  vrMountDecision is not real binding). Survived ALL 1019 tests in the 61 unit files that load watch.js: drop the
  abort unmount (A1: the shipped probe then shows `nav` canvases 1, the sphere outlives the view); drop the
  key-change unmount (A2: switch off / Flat / a new item keep the sphere); show the 360 row for flat (A5); show Video
  type to members (A6). Survived the 25 W4 tests: drop the post-await re-check (A3), the video event listeners (A4),
  the host observer (A6b). Survived the W4 tests in vr-view.js: the too-large refusal never called (C1), the sphere mirrored
  (C2), contextlost not listened (C3), destroy leaves the canvas over the video (C4), the sphere upside down (C6).
  The probe catches A1/A2/A5/C2/C4 but is not a gate. Fix: a jsdom test of setupVrView with a stub window.VrView
  (mount spy returning a destroy spy) driving the switch, a pick, loadedmetadata for another id, fullscreenchange
  with fullscreenElement = video, webkitbeginfullscreen, the host class going docked, and abort; rows per projection
  and canModifyLibrary; and a fake-gl mount test for C1/C3/C4.
- **W3 (WARNING) a lost WebGL context remounts at once** (qa W2, now MEASURED): Chromium SwiftShader, sphere up,
  `WEBGL_lose_context.loseContext()`: 1.5 s later the toast "360 view stopped; showing the flat picture" was shown
  AND a new canvas with a new webgl context was up (canvases 1, same canvas false). destroy() removes `vr-view-on`
  from the host, the class observer runs syncVr, onFail never set vrRefusedKey. Plan: "flat + a toast". Fix:
  `vrRefusedKey = key` in onFail.
- **W4 (WARNING) the new copy is false where it is likely to show.** (a) VERIFIED: PiP counts as a native
  presentation, so leaving PiP with a sphere up shows "Full screen on this device shows the flat picture; 360 view
  returns here" (vrNativeNotice + nativeVideoPresentation with webkitPresentationMode 'picture-in-picture').
  (b) REASONED, not device-measured: on iPhone in custom mode, player.js 8871-8890 bounces every
  webkitbeginfullscreen (rotate to landscape while playing) into the faux full screen, which keeps the sphere; the
  watch listener on the same event unmounts and latches, webkitendfullscreen remounts and toasts the note while the
  user is in full screen WITH the sphere (and a context is torn down and rebuilt per rotate). So the plan's premise
  "iPhone native full screen = flat" holds only when the bounce no-ops. Fix: PiP gets its own copy or none; the
  note and the unmount wait until native presentation has held (e.g. 500 ms) so the bounce never triggers them.
- **W5 (WARNING) dead rows on a TV episode** (qa W3, now MEASURED): sphere page, then in-app nav to
  /watch.html?tv=ep1 (data-view "watch"): "360 view" and "Video type" both shown; tapping the switch unticks it while
  localStorage stays "1" (no listener). Fix as qa says.
- **W6 (WARNING) the restricted-item guard is present, not bound.** Dropping `restrictedVideoMutation` from the
  route survives video-projection, route-write-classification (a table), media-write-proto-ids and the unit file.
  Repro (scratch test, the chapter-snap.test.js 305-333 shape): a member with canModifyLibrary and a folder
  restriction on the item's folder POSTs `{projection:"flat"}`: pristine 404 (the guard holds today), mutant
  `200 {"success":true,"projection":null,"projectionOverride":"flat"}` written onto a hidden item. Add that test.
- Name rule (qa W4, a STOP rule): agreed and reproduced: "Frontside 180.mp4" 1080x1080 -> 180, "Best 360
  dunk.mp4" 1920x960 -> 360, "... S01E01 180.mp4" 1920x960 -> 180-sbs. Dean decides; ship disclosed only on his word.
- N1: the vertical sense is unmeasured: C6 (v = 0.5 + lat/pi, upside down) survives the suite AND the probe (its
  bands are horizontal only). Reasoned correct (texImage2D without UNPACK_FLIP_Y puts the top row at v 0). Add a
  top/bottom band and a pitch-drag row. The 180 and stereo eye mapping are likewise reasoned, not drawn.
- N2: dead guards: `l < 0 || r < 0` (ffprobe prints size_t; mutant B10 survives) and `!isAudio` on the probe and the
  store (B6, B7 survive: an audio file has no non-cover video stream). Equivalent, harmless.
- N3: a transient ffprobe failure on a new or changed VR file stores no `projection` and is never retried (the
  probed-once convention, as chapters and width); the owner pick and the name rule remain. Disclose.
- N4: in native-controls mode the 360 row is shown for a sphere but the switch can never mount (nativeControls
  blocks): a silent no-op switch. Hide the row there or say why.
- N5: production ffprobe is Alpine's apk ffmpeg; the key and value spellings were measured on 7.0.2 only (qa S4).
- N6: frontmatter `next:` still says "W4 ... @20dfa7a8: rebase on main after v1.365.0" (done): a stale marker.
Mutants: 28 distinct (7 client wiring, 4 of them also on the 61-file net; 12 server; 6 vr-view; 3 re-runs of the
builder's), plus B1 against the scratch test and A1 against the shipped probe;
killed by the shipped tests: B2, B3, B4, B5, B8, B9, B11, B12, C5, M4, M9; survived: A1-A6b, B1, B6, B7, B10, C1-C4,
C6, M8 (equivalent).

Gate: CHANGES r1 @950c2aca - adversary

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
