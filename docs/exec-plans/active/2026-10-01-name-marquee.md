---
plan: name-marquee
harness: v2 · lean
branch: feat/v1.351-name-marquee
anchor: spec
status: Planned
next: Step 0 (read this whole plan once, top to bottom, before touching anything)
design: Approved 2026-10-01 (Dean, one round of Q&A; every ruling in section 2 is his answer)
gate: adversary + qa (client UI and CSS only; no server, auth or data change)
---

# v1.351: long names scroll - the highlighted iPod row and the "On <device>" label

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

## 2. Rulings (Dean, 2026-10-01)

| # | Question | Ruling |
|---|----------|--------|
| R1 | Which highlighted rows scroll? | **Every iPod menu**: any highlighted (`is-cursor`) row that overflows, in every pocket menu (`.ipm-row`) and the song list (`.ip-listview .mms-row`). Like a real iPod. |
| R2 | How does it move? | **Same as Now Playing**: the existing `mms-marquee` keyframe and speed (pause, slide to the end, pause, slide back). No second animation. |
| R3 | The "On <device>" label on other skins? | **All skins** (iPod, Cider, Nordic): it is one writer, `remoteBadge()`. |
| R4 | The Speakers sub-line? | **Yes, both lines** scroll when the row is highlighted and each overflows. |
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
(W4), and again only if a gate round changes code.

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

### W4 - Proof, then release
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
- Lying comments (LESSONS 12): the v1.232 comments that list the marquee targets.

## 6. Release (docs/RELEASING.md is the authority)

v1.351.0 via the protected-main PR flow. ROADMAP.md Shipped entry; a `docs/releases.json` entry in plain
user language (e.g. "Long names now scroll instead of being cut off: the highlighted row in every iPod
menu, and the 'On <device>' label at the top of the player."). LESSONS.md: add or update a lesson only if
the build names a new class (e.g. a marquee needs an unwind when its row is toggled, not re-rendered).
Move this plan to `completed/` in the release commit. Device checks for Dean go in DEVICE-CHECKS.md
(outcome 1-5 above, one line each).

## 7. Out of scope (log, do not build)

- A cap on device-name length in Settings > Account.
- A continuous-loop (ticker) marquee, or a different speed (R2).
- Marquee on non-highlighted rows, on the desktop music page, or on the Watch side.
- Any change to the Speakers list contents or order.

## 8. Evidence and gate verdicts

### Builder evidence (fill in)
- W0:
- W1:
- W2:
- W3:
- W4:

### Gate verdicts (seats write here, bound to the sha reviewed)
