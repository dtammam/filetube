---
plan: name-marquee
harness: v2 · lean
branch: feat/v1.351-name-marquee
anchor: spec
status: Shipped v1.351.0
next: Step 0 (read this whole plan once, top to bottom, before touching anything)
design: Approved 2026-10-01 (Dean, two rounds of Q&A; every ruling in section 2 is his answer)
gate: adversary + qa (client UI and CSS only; no server, auth or data change)
---

# v1.351: long names scroll (the highlighted iPod row and the "On <device>" label), and an idle speaker lands on the Main menu

Written 2026-10-01 by an Opus session for a **Sonnet** builder in a fresh session. Every scope decision
is made. Build exactly this. If the code you find does not match what this plan says, follow the stop
rules in 0.8; do not improvise a redesign.

Source: Dean's three iPhone screenshots after v1.350 (Custom 5G Transparent Coil):
`/home/coder/.claude/uploads/8e9ee2c4-35e3-41de-bd0c-1b36b902ea20/edd8aa75-image.png` (top bar "ON SURFACE LAPT…"),
`cf010960-image.png` (Speakers menu: highlighted "Surface Laptop Stud…", sub-line "File Select - Super Mar" clipped),
`f3a7ed7a-image.png` (Now Playing title already marquees - the behavior to match). Same folder.

Dean's words: "the names get truncated. Can we have the names scroll on selection like other things do in
iPod view and also in the top where the name is listed next to the bar. Have it max out in the amount of
characters there are now but have it slowly rotate if beyond a certain character limit."

## 1. The outcome (what Dean will do on device)

1. Rename a device in Settings > Account to something long ("Surface Laptop Studio 2 Upstairs").
2. Play on it. The "ON SURFACE LAPTOP..." label in the iPod top bar keeps today's width (no wider), and
   the full name slowly slides into view, pauses, slides back - exactly like the Now Playing title.
   Same on Cider and Nordic.
3. Open Speakers and spin the wheel onto that device: the highlighted row's name scrolls; its
   "now playing" sub-line (e.g. "File Select - Super Mario 64 ...") scrolls too if it is cut off.
4. Spin to any other long row in any iPod menu (Songs, Albums, Artists, Playlists, the song list): the
   highlighted row scrolls; the row it left goes back to its "..." at once.
5. Short names never move. With Reduce Motion on, nothing moves and the "..." stays.
6. In Speakers, pick a device that has NO song loaded (a PC listening but idle). Instead of a blank
   "Nothing playing" screen he has to back out of, the iPod lands on the **Main menu** with **Music**
   highlighted and the speaker still chosen ("On <device>" in the top bar). One center press and he is
   browsing; a song he picks plays on that speaker. A device with a song loaded (playing OR paused)
   still goes to Now Playing, as today.

Dean's words for 6: "When we go to select a speaker without anything playing it shows nothing playing
and you have to tap out and then go pick music. Once one selects a speaker that isn't playing anything
can it remove that friction, basically put them back to the home page of Click skin with the device
selected?"

## 2. Rulings (Dean, 2026-10-01)

| # | Question | Ruling |
|---|----------|--------|
| R1 | Which highlighted rows scroll? | **Every iPod menu**: any highlighted (`is-cursor`) row that overflows, in every pocket menu (`.ipm-row`) and the song list (`.ip-listview .mms-row`). Like a real iPod. |
| R2 | How does it move? | **Same as Now Playing**: the existing `mms-marquee` keyframe and speed (pause, slide to the end, pause, slide back). No second animation. |
| R3 | The "On <device>" label on other skins? | **All skins** (iPod, Cider, Nordic): it is one writer, `remoteBadge()`. |
| R4 | The Speakers sub-line? | **Yes, both lines** scroll when the row is highlighted and each overflows. |
| R6 | Idle speaker: where does it land? | **Main menu, cursor on Music**, speaker stays selected. Only when the chosen device has NO track loaded. |
| R7 | A speaker with a PAUSED song? | **Now Playing** (as today): he can see the song and press play. |
| R8 | "This <device>" with nothing loaded (Opus default, same rule) | Same as R6: Main menu, cursor on Music. |
| R5 | Width | "Max out in the amount of characters there are now": the label keeps `max-width:45%`; rows keep their width. Only the text inside moves. |

## 0. Step 0 - read, set up, and the stop rules

0.1 Read `AGENTS.md`, then `docs/LESSONS.md` sections **0, 2, 4, 6, 7, 12**. Read this plan fully once.

0.2 Environment, every shell: `export PATH="$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH"`.
Dual-Node for the final suite: 22.23.1 and 24.20.0 (Node 24 prints `ℹ`, not `#`). `gh` is `~/.local/bin/gh`.

0.3 Worktree: `git -C /home/coder/projects/filetube worktree add .claude/worktrees/name-marquee feat/v1.351-name-marquee`
(the branch exists locally and carries this plan). Rebase onto `origin/main` first if main moved. In the
worktree: `ln -s /home/coder/projects/filetube/node_modules node_modules` before any commit/push,
`rm node_modules` after, never stage it.

0.4 Git: stage files BY NAME; `git commit -F <file>`; never `--no-verify`, never force-push, never pipe a
commit or push; verify with `git log` / `git ls-remote`. One commit per wave.

0.5 Tests while building: the targeted files named in each wave. The full dual-Node suite once at the end
(W5), and again only if a gate round changes code.

0.6 Report every failure verbatim with counts. "Verified" means you ran it and saw it.

0.7 No em dashes in docs, comments or UI text. UI uses the app's tokens; `npm run lint:ui` must not grow;
`node scripts/overlay-containment-lint.js --enforce` stays 0. No new color tokens, no new keyframes.

0.8 **Stop rules.** Stop and ask Dean (AskUserQuestion) if: (a) a seam in section 3 does not exist or
behaves differently and the fix is not a like-for-like rename; (b) W0's measurement shows the skin or the
menu repaints often enough (more than once per ~4 s while idle or while a remote device plays) that a
marquee would restart before it finishes, and the fix would need more than "do not restart a marquee
whose text and width did not change"; (c) splitting the label and the sub-line (W2) moves any pixel of a
row that does NOT overflow; (d) a step needs a new npm dependency or any server change; (e) a gate seat
asks for a scope change. Never widen scope: log extras in ROADMAP.md Planned.

## 3. The seams (mapped 2026-10-01 at v1.350.0, main d019fa9d; line numbers drift, names do not)

### 3.1 The marquee today (the one mechanism to reuse)
- `public/js/skin-surface.js` `applyMarquee()` (~L1975, inside `create(config)`): for each of
  `.ip-ttl, .ip-artist, .ip-album, .mms-ttl, .mms-sub, .mms-ctx` with `scrollWidth - clientWidth > 2`, wraps
  the text in `span.mms-mq` (textContent, no injection), adds `.mms-mq-on`, sets `--mms-mq-shift` (negative
  overflow px) and `--mms-mq-dur` (`max(4, over / 24)` s). Bails under `prefers-reduced-motion`.
- Called from `paint()` after layout (rAF, ~L2118, gated by `marqueeOn = config.marquee !== false`, ~L1425)
  and from `onShowNowPlaying` (~L1460).
- CSS `public/css/style.css` ~L10602-10604: `:where(html.is-phone, html.mms-popout) .mms-full .mms-mq-on{ text-overflow:clip }`
  and `.mms-mq-on .mms-mq{ display:inline-block; animation:mms-marquee var(--mms-mq-dur) linear infinite alternate }`.
  Keyframe `mms-marquee` ~L10667 + the reduced-motion stop ~L10668.
- Tests: `test/unit/music-skin-integration.test.js` ~L217-266 (wrap, vars, 4 s floor, Apple, reduced motion).
- It has NO unwind: nothing removes `.mms-mq-on` once set. Today that is fine because every target is
  re-rendered on paint. For the song list (3.4) it is not.

### 3.2 The "On <device>" label (R3)
- `public/js/music-skins.js` `remoteBadge(ctx)` (~L161): `<span class="mms-remote" role="button" ... data-skin-playon aria-label="Playing on X. Choose a device">on X</span>`.
  Used by `renderApple` (~L170), `renderSpotify` (~L181), and the iPod `ipScreen` status bar (~L204).
- CSS ~L12267: `.mms-remote{ flex:none; max-width:45%; ... overflow:hidden; text-overflow:ellipsis; white-space:nowrap; text-transform:uppercase }`;
  ~L12268 the iPod padding. Keep `max-width:45%` (R5).
- The click arm is `[data-skin-playon]` on the span itself, so wrapping its text in a child span keeps the tap.

### 3.3 Pocket menu rows (R1, R4) - the Speakers screen is one of these
- `public/js/music-skins.js` `renderMenuList(v)` (~L951): a selectable row is
  `<button class="ipm-row[ is-cursor]..." data-skin-mi>` containing
  `<span class="ipm-lbl">LABEL<span class="ipm-detail">DETAIL</span></span>` + optional check / now / chevron.
  **The detail is INSIDE the label span**, so `applyMarquee` on `.ipm-lbl` would scroll both lines as one
  box (wrong) and its textContent rewrite would flatten the detail (a bug). W2 splits them.
- CSS: `.ipm-lbl` ellipsis ~L8494, `flex:1` ~L8603; `.ipm-detail{ display:block; font-size:var(--pk-fs-note); opacity:.7 }` ~L12269.
- The controller: `public/js/skin-surface.js` `createPocketMenu(o)` (~L566), created in `create()` ~L1451
  with an options object. `renderList()` (~L877) rewrites the rows' innerHTML on every cursor step and
  list scroll; `render()` (~L904) redraws the menu screen (also via `afterPaint`, ~L1287). So a rendered
  cursor row is always fresh: run the marquee after BOTH `renderList()` and `render()`.
- `createPocketMenu` cannot see `applyMarquee` (different closure). Pass a hook in the options at ~L1452
  (e.g. `marquee: marqueeOn ? function (root) { ... } : null`), so `marquee:false` still turns it off.

### 3.4 The song list rows (R1)
- `public/js/music-skins.js` ~L132-144: `.mms-row` with `.mms-rt` (title) and `.mms-ra` (artist).
- `public/js/skin-surface.js` `setWheelCursor(pos)` (~L1996) only TOGGLES `is-cursor` (no re-render), and
  ~L2023 removes it. So the row the cursor LEAVES must be un-marqueed explicitly (R1 outcome 4).

### 3.5 Picking a speaker (R6-R8)
- `public/js/skin-surface.js` `activate(i)` (~L1166) in `createPocketMenu`: `if (it.action === 'playon') { cfg.onPlayOn(it.target || null); showNowPlaying(); return; }` (~L1178).
  `showNowPlaying()` ~L1158. The Main level: `resetStack()` ~L630 (`stack = [makeLevel({ type: 'main' })]`),
  `makeLevel` ~L627; `openPlayOn` (~L1335) shows how to rebuild the stack and `render()` the menu screen.
- `public/js/music.js` `playOnItems()` (~L1453): each remote row's `target` is the device from
  `RC.fetchTargets()`; its loaded track is `t.state && t.state.track` (the same field the row's detail
  line reads). "This <device>" is `target: null`.
- `public/js/music.js` `remoteChoose(t)` (~L1464) is `onPlayOn` (wired ~L1597): it pauses local play,
  `RC.select(t)` or `RC.leave()`, then `updateNowPlayingPanel()`. Local "has a track" is the menu's
  existing `cfg.hasCurrent()` (skin-surface ~L592; find its music.js source and confirm what it reads).
- Main menu rows: `music-skins.js` `menuStaticItems` (~L611): Music is row 0 today. Find the Music row by
  its node type (`music`), not by index.

## 4. Waves (one branch, a commit per wave, one gate, one release)

### W0 - Measure the repaint rate (no code change)
Headless (the existing integration harness or a CDP probe), count how often each of these runs over 30 s:
`paint()`, pocket `render()`, pocket `renderList()`, with (a) a local track playing on Now Playing,
(b) the Speakers menu open and idle, (c) a remote device playing (ctx.remote set, remote.js status updates
flowing). Record the numbers in section 8. If any is more often than once per ~4 s, the marquee there would
restart before finishing: apply the minimal guard (skip re-wrapping when the element's text and
`clientWidth` match the last applied marquee - keep the running span) or hit stop rule 0.8(b).

### W1 - The engine: one marquee function with an unwind, and the label (R2, R3, R5)
1. Refactor `applyMarquee` into `marqueeEl(el)` (the existing per-element body) + `unmarqueeEl(el)` (removes
   the span, restores textContent, drops `.mms-mq-on` and both vars) + the existing caller. Behavior of the
   Now Playing lines is unchanged (existing tests stay green unmodified).
2. Add `.mms-remote` to the target list. Make the CSS marquee rules reach it on all three skins (check the
   `.mms-full` scope covers the badge's parent on Cider, Nordic and iPod; widen the selector only as far as
   needed).
3. Tests (extend `music-skin-integration.test.js`): a long remote label on iPod, Cider and Nordic marquees,
   its width stays at the 45% cap (measure, before = after), a short one does not, reduced motion stops it,
   and a tap on the label still opens Speakers. Mutate (drop `.mms-remote` from the list) and watch red.

### W2 - Pocket menu rows (R1, R4)
1. `renderMenuList`: give the label text its own element (e.g. `<span class="ipm-name">`), and keep
   `.ipm-detail` its sibling inside `.ipm-lbl`. Each becomes its own clipped one-line box (nowrap,
   overflow hidden, ellipsis). Rows that do not overflow must render pixel-identical to v1.350 (stop
   rule 0.8(c)); prove it with a before/after screenshot of a Main menu and the Speakers menu
   (LESSONS: measure UI changes).
2. Through the `createPocketMenu` options hook: after `renderList()` and `render()`, marquee
   `.ipm-row.is-cursor .ipm-name` and `.ipm-row.is-cursor .ipm-detail`. Info/note rows never.
3. Selected-row text is white on blue; the marquee span must inherit that colour (check the `is-cursor`
   colour rules ~L8608-8610 and ~L10592 still apply through the new span).
4. Tests (`test/unit/music-pocket-menus.test.js` or the integration file): a long cursor row marquees both
   lines independently; moving the cursor moves the marquee (the old row has no `.mms-mq-on`); a short
   row does not; `marquee:false` and reduced motion turn it off; textContent of label + detail survive.
   Mutants: drop the hook call after `renderList()` (red on a cursor step), merge the spans back (red).

### W3 - The song list rows (R1)
1. In `setWheelCursor` and the ~L2023 removal: unmarquee the row that loses `is-cursor`, marquee
   `.mms-rt` / `.mms-ra` of the row that gains it (after layout, rAF, as `paint()` does).
2. Tests: spin from a long row to a short row and back; the left row is restored to plain text with its
   ellipsis; mutate the unwind out and watch red.

### W4 - An idle speaker lands on the Main menu (R6-R8)
1. Decide "has a track" where the target's shape is known: `onPlayOn` (music.js `remoteChoose`) returns
   `true` when the chosen device has a track loaded (remote: `t.state.track` present; this device: the
   local current track, read BEFORE the switch changes it), else `false`. Paused counts as loaded (R7).
2. `activate()`: on `true` (or a non-boolean return, so an older caller keeps today's behavior) ->
   `showNowPlaying()`. On `false` -> reset to the Main level, put its cursor on the Music row, `screen = 'menu'`,
   `render()`. The speaker selection itself is untouched (RC still targets it; the top bar shows the label).
3. Prove REACHABILITY with the REAL target shape (LESSONS: inert feature): a test that drives `playOnItems()`
   output (built from a `fetchTargets` fixture copied from the real server response for remote targets)
   through `activate()`, for: idle remote -> Main/Music; remote playing -> Now Playing; remote paused with a
   track -> Now Playing; This device with nothing -> Main/Music; This device with a track -> Now Playing.
   Mutants: always return true (red); check `t.state.playing` instead of the track (red on paused).
4. Then pick a song from Music on the idle speaker in the test: it goes to RC (plays there), not locally.

### W5 - Proof, then release
1. `npm run lint`, `npm run lint:ui`, `node scripts/overlay-containment-lint.js --enforce`, the full suite
   on Node 22.23.1 and 24.20.0. Paste the tallies.
2. A headless phone screenshot pair (base vs branch) of: the iPod top bar with a long remote name, the
   Speakers menu with a long highlighted device, Now Playing. Only the intended text differs.

## 5. The gate

Adversary (floor) + QA, spawned fresh on the committed branch with: this plan, the base sha, and the
attack surfaces below. Ship on CRITICAL/WARNING closure; after 2 rounds, ask Dean at round 3.

- Restarts: a marquee that a repaint restarts before it finishes is the bug Dean would see as "jitters
  then snaps back". Use W0's numbers; test the remote-playing case for the label.
- The unwind (W3): a row that left the cursor keeps scrolling or loses its text.
- Injection: every new text write is textContent (device names are user-typed in Settings > Account).
- Width: the label is no wider than v1.350 at any name length (R5); a row's check/now/chevron glyphs
  never get pushed off.
- Inert feature (LESSONS): prove the Speakers rows really marquee with the REAL Speakers item shape
  (label + detail from the playon loader), not a hand-made fixture only.
- Reduced motion, `marquee:false`, and the pop-out (`html.mms-popout`) all behave.
- W4: the idle check uses the REAL target shape; a stale list (the device started playing after the
  Speakers list loaded) degrades to today's behavior at worst, never a wrong local play; the selection
  survives the jump to Main; the badge-opened Speakers path behaves the same.
- Lying comments (LESSONS 12): the v1.232 comments that list the marquee targets.

## 6. Release (docs/RELEASING.md is the authority)

v1.351.0 via the protected-main PR flow. ROADMAP.md Shipped entry; a `docs/releases.json` entry in plain
user language (e.g. "Long names now scroll instead of being cut off: the highlighted row in every iPod
menu, and the 'On <device>' label at the top of the player. Choosing a speaker that isn't playing
anything takes you to the Main menu so you can pick music right away."). LESSONS.md: add or update a lesson only if
the build names a new class (e.g. a marquee needs an unwind when its row is toggled, not re-rendered).
Move this plan to `completed/` in the release commit. Device checks for Dean go in DEVICE-CHECKS.md
(outcome 1-6 above, one line each).

## 7. Out of scope (log, do not build)

- A cap on device-name length in Settings > Account.
- A continuous-loop (ticker) marquee, or a different speed (R2).
- Marquee on non-highlighted rows, on the desktop music page, or on the Watch side.
- Any change to the Speakers list contents or order.

## 8. Evidence and gate verdicts

### Builder evidence (fill in)
- W0: measured 30 s per scenario (jsdom, real remote.js controller, PC reporting every 5 s): local Now Playing, Speakers open and idle, remote playing with 6 same-track state events, remote playing + Speakers open. paint() = 0 and .ipm-list rewrites = 0 in all four; the 500 ms reflect tick touches only .mms-pos/.mms-rem (13 each in 6 s), never .ip-ttl or .mms-remote. Repaints are event-driven (track/device/state change), the Speakers list loads once, nothing polls. A marquee is not restarted, so stop rule 0.8(b) is not triggered and no guard is added.
- W1: skin-surface.js applyMarquee split into marqueeEl/unmarqueeEl + .mms-remote in the target list (all skins); the lying CSS comment rewritten. 6 new tests in music-skin-integration.test.js (long label marquees on ipod/apple/spotify with the REAL remote.js controller and the real /api/remote/targets shape; short label never moves; Reduce Motion; a tap on the moving text still reaches the badge arm; 45% cap and no width in marquee rules). File: 127 pass, 0 fail (was 121). Mutant (drop .mms-remote from the list): 4 red, restored.
- W2: renderMenuList now draws `.ipm-lbl > .ipm-name` + `.ipm-detail` (each display:block, nowrap, overflow hidden, ellipsis); createPocketMenu takes a `marquee` option, called after renderList() and render(), which marquees only `.ipm-row.is-cursor .ipm-name/.ipm-detail` (the row the cursor leaves is re-rendered plain, so it needs no unwind). Stop rule 0.8(c) NOT triggered: headless Chromium 390x844 @2x, ipod-2004, base d019fa9d vs branch, Main / Music / Albums menus: 3 of 3 screenshots byte-identical (cmp) and every row + label rect identical (6 + 7 + 3 rows; the Albums list holds two overflowing non-cursor rows). 5 new tests in music-pocket-menus.test.js (file: 33 pass, 0 fail, was 28), mutants: drop the renderList hook = 1 red, merge the spans back = 3 red, both restored.
- W3: song-list rows are toggled in place, so setWheelCursor unwinds the row that loses is-cursor (unwindRow) and marquees the one that gains it in a rAF (marqueeRow, .mms-rt/.mms-ra/.mms-rd); the setListMode(false) removal unwinds too. 3 new tests in music-skin-integration.test.js (file: 130 pass, 0 fail, was 127): long row scrolls, spin off restores text and ellipsis, spin back scrolls again; short row and Reduce Motion never wrap; MENU out of the list restores. Mutants: drop the spin unwind = 1 red, drop the close unwind = 1 red, both restored.
- W4: remoteChoose now returns whether the chosen speaker has a track loaded (remote: t.state.track from the REAL /api/remote/targets shape, which is null for an idle speaker and set for a paused one; this device: hasCurrentMusicTrack()); activate() sends false to landOnMusic() (resetStack, screen=menu, cursor on the music-type row, render) and anything else to Now Playing. The selection survives (RC.select/leave run before the return). A song picked on the idle speaker goes through the one play seam, playAt -> remotePlayAt (music.js:4114), unchanged. Source-lock regexes in music-remote-controller-wiring.test.js still match unchanged. Tests: 3 reachability tests in music-skin-integration.test.js with the real controller + real target shape (idle remote, playing + paused remote, This device with a track and with nothing; with nothing loaded the pocket skin itself steps aside, so that case asserts never Now Playing) + 1 engine test in music-pocket-menus.test.js (false / true / undefined). Totals: music-pocket-menus 34 pass, music-skin-integration 133 pass, remote-controller-wiring all pass. Mutants: always-true = 1 red, playing-instead-of-track = 1 red, drop the false branch = 2 red, all restored.
- W5: npm run lint 0 errors / 6 warnings (all existing); lint:ui OK (debt equals docs/ui-exceptions.json); overlay-containment 0 violations. Full suite Node 22.23.1: 10537 tests, 10525 pass, 0 fail, 12 skipped, 0 cancelled. Node 24.20.0: 10537 tests, 10525 pass, 0 fail, 12 skipped. Pixels: the W2 base-vs-branch screenshots (Main, Music, Albums menus) are byte-identical. scripts/skin-status-bar-probe.js did NOT give a usable pair (base run did not reach the menus, branch run was cut short, PNGs all differ by noise), so it is not evidence; the long-remote-name top bar and a highlighted long Speakers row in a real browser need a second device and are owed as device checks. The label width cap (max-width:45%) is locked by a CSS test.

### Gate verdicts (seats write here, bound to the sha reviewed)

Gate: APPROVED r1 @a0d0ce86382f884db2307e780a591622f2f9557e — adversary
Gate: APPROVED r1 @a0d0ce86382f884db2307e780a591622f2f9557e — qa (no CRITICAL/WARNING; NOTEs: re-render restarts a scroll, nothing repaints idle; real-browser long-name shots owed as device checks; W4 'This device, nothing loaded' asserts never-Now-Playing only). Adversary NOTEs shipped disclosed: marqueeEl's idempotence guard and landOnMusic's Music cursor assignment have no binding test (two attempts to bind the guard did not turn red; Music is already row 0).
