---
plan: mobile-polish
harness: v2 · lean
branch: feat/v1.350-mobile-polish
anchor: spec
status: Approved @b5805bda
next: Step 0 (read this whole plan once, top to bottom, before touching anything)
design: Approved 2026-10-01 (Dean, two rounds of Q&A; every ruling in section 2 is his answer)
gate: adversary + qa (client UI, CSS, one CI workflow; no server, auth or data change)
---

# v1.350: skins last, Speakers, Recent Albums, a clear board that stays put, a clean turn back, the baselines bot unstuck

Written 2026-10-01 by an Opus session for a **Sonnet** builder in a fresh session. Every scope decision
is made. Build exactly this. If the code you find does not match what this plan says, follow the stop
rules in 0.8; do not improvise a redesign.

Source: Dean's device recording after v1.349 (`/home/coder/.claude/uploads/6317481f-853a-4e44-a97d-93699201944d/fa0bcb11-ScreenRecording_10-01-2026_00-55-54_1.mp4`,
5.57 s, 1180x2556 HEVC, 59 fps, Custom 5G Transparent Coil on Now Playing, turned to landscape and back).

## 1. The outcome (what Dean will do on device)

1. Settings > **Mobile player**: **Player sticker** is first; the **Music skin** grid (Original, every
   iPod line, Cider, Nordic, in today's order) is at the bottom of the page.
2. In the iPod Main menu the row that said **Play on...** reads **Speakers**; its screen title reads
   **Speakers**; Settings > Account's device-name note says "Shown in Speakers ...".
3. Music > **Recent Albums** sits right under **Recent Artists**: the albums he played last, newest
   first, each opening exactly like Albums > that album.
4. On a Transparent skin (all three) he turns the phone sideways: the circuit board photo stays exactly
   where it was on the glass, same size, same crop, turned with the phone like a real clear iPod. Only
   the screen and the wheel rearrange. Turning back is the same.
5. Turning back to portrait is as smooth as turning to landscape: no giant cover filling the phone
   during the turn, no small drop when the status bar comes back.
6. After the merge, a `chore(visual): refresh baselines` PR opens and merges itself (for v1.349's and
   v1.350's look changes together). The stranded `chore/baselines-b5805bd` branch is gone.

## 2. Rulings (Dean, 2026-10-01)

| # | Item | Ruling |
|---|---|---|
| R1 | 1. Skins on the Mobile player page | **Whole skin grid last**: move the Music skin `.setup-group` as one block, in its current order, below Player sticker. Do not reorder families (Cider/Nordic stay at the grid's end). |
| R2 | 2. Transparent board on rotate | **Pinned to the phone**: the board keeps its portrait size and position relative to the PHYSICAL glass and turns with the phone (chips read sideways in landscape). Only the screen and wheel move. Needs the rotation angle (90 vs 270) from JS. All three Transparent skins. |
| R3 | 3. The turn back | **Both artifacts gone, measured**: the giant-LCD snapshot AND the ~20px status-bar drop. Prove headless where possible; Dean's device recording is the final check. |
| R4 | 4. "No successful rebase line" | Root-caused (section 3.6): the post-merge `baseline-refresh` job died with exit 141. **Bundle the fix into this wave**; delete the stranded branch. |
| R5 | 5. Recent albums | **iPod Music menu only**: `Recent Albums` right under `Recent Artists`, same Recently Played source, unique albums in recency order, at most 25, a row drills in like Albums > album. Not on the regular Music page. |
| R6 | 6. Rename "Play on..." | **Speakers** everywhere the user sees it (row, screen title, the Account note). Past ledger/ROADMAP entries are history: do not rewrite them. |

Consequences Dean accepted (do not "fix" them):
- R2: in landscape the board's chips and labels read sideways. That is the point.
- R1: Cider and Nordic stay at the end of a ~150-tile grid.
- R5: the regular Music page gets nothing new.

## 0. Step 0 - read, set up, and the stop rules

0.1 Read `AGENTS.md`, then `docs/LESSONS.md` sections **0, 1, 3, 4, 6, 11, 12** (and any section a
wave's diff touches). Read this plan fully once. Memory rule that applies here: "a shipped fix that
fails on device = the diagnosis was WRONG: re-root-cause, never re-patch" (W6).

0.2 Environment, every shell: `export PATH="$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH"`.
Dual-Node for the final suite: 22.23.1 and 24.20.0 (Node 24 prints `ℹ`, not `#`). `gh` is
`~/.local/bin/gh`. There is NO system ffmpeg; a static one is at
`/home/coder/.local/lib/python3.12/site-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2`
(installed 2026-10-01 via `pip install --user imageio-ffmpeg`; it has no `drawtext`).

0.3 Worktree: `git -C /home/coder/projects/filetube worktree add .claude/worktrees/mobile-polish feat/v1.350-mobile-polish`
(the branch exists locally and carries this plan). Rebase onto `origin/main` first if main moved. In the
worktree: `ln -s /home/coder/projects/filetube/node_modules node_modules` before any commit/push,
`rm node_modules` after, never stage it.

0.4 Git: stage files BY NAME; `git commit -F <file>`; never `--no-verify`, never force-push, never pipe a
commit or push; verify with `git log` / `git ls-remote`. One commit per wave.

0.5 Tests while building: the targeted files named in each wave. The full dual-Node suite once at the end
(W7), and again only if a gate round changes code.

0.6 Report every failure verbatim with counts. "Verified" means you ran it and saw it.

0.7 No em dashes in docs, comments or UI text. UI uses the app's tokens; `npm run lint:ui` must not grow;
`node scripts/overlay-containment-lint.js --enforce` stays 0. No new color tokens.

0.8 **Stop rules.** Stop and ask Dean (AskUserQuestion) if: (a) a seam in section 3 does not exist or
behaves differently and the fix is not a like-for-like rename; (b) W5 cannot keep portrait
pixel-identical for the Transparent skins; (c) W6's measurement does not reproduce either artifact
headless AND the debug log (W6 step 2) gives no cause - do not guess-patch, ask; (d) a step needs a new
npm dependency or any server change; (e) a gate seat asks for a scope change. Never widen scope: log
extras in ROADMAP.md Planned.

## 3. The seams (mapped 2026-10-01 at v1.349.0, main b5805bda; line numbers drift, names do not)

### 3.1 Settings > Mobile player (R1)
- `public/setup.html`: `<details class="setup-box setup-sec sub-collapsible" data-collapse-key="mobile-player" data-md-icon="phone" open>`.
  Inside, in order: `.setup-intro`, the **Music skin** `.setup-group` (comment "v1.230", `#music-skin-picker`),
  the **Player sticker** `.setup-group` (comment "v1.238", `#sticker-picker` + `#sticker-file-input`).
- `public/js/setup.js` wires both BY ID (`renderMusicSkinPicker`, `renderStickerPicker`), never by order.
- Order is not pinned by name today; check `test/unit/setup-music-skin-picker.test.js`,
  `test/unit/setup-sticker-picker.test.js`, `test/unit/master-detail.test.js`,
  `test/unit/seattle-removed-census.test.js`, `test/unit/retire-r3-surfaces.test.js` and update only
  what the move invalidates.

### 3.2 "Play on..." (R6)
User-visible strings (all of them as of b5805bda; re-grep `Play on` in `public/` to confirm):
- `public/js/music-skins.js` `TYPE_TITLE.playon: 'Play on...'` and `menuStaticItems` main row
  `{ label: 'Play on...', node: { type: 'playon' } }`.
- `public/setup.html` `#device-name-note` text, and `public/js/setup.js` (~line 3166) which rewrites the
  same note at runtime ("Only this browser. Shown in Play on... and when this device controls another...").
- Comments that name it (update, LESSONS 12 lying comments): `public/js/remote.js` ("CONTROLLER side
  (the phone): Play on..."), `music-skins.js` (~159), `skin-surface.js` (~1334), `common.js` (~10525),
  `setup.js` (~3156), `style.css` (~12249).
- Keep the node type `playon`, `hasPlayOn`, `[data-skin-playon]` and every id: rename the WORDS only.
- Tests that pin the string: grep `test/unit` for `Play on` (at least `device-name.test.js`,
  `music-remote-controller-wiring.test.js`, `pocket-skins-menu.test.js`).
- Do NOT edit past entries in `docs/releases.json`, `ROADMAP.md` Shipped, or completed plans.

### 3.3 Recent Albums (R5)
- `public/js/music-skins.js`: `MUSIC_MENU` (~582, "Quick scroll (Dean 2026-09-24): Recent Artists leads
  it") = `recentArtists, playlists, artists, albums, songs, genres`. `TYPE_TITLE` has `recentArtists:
  'Recent Artists'`. `menuRecentArtistItems(tracks, artFor)` (~765): unique by `albumArtist || artist`,
  recency order, `RECENT_ARTISTS_MAX = 25`, exported on the module object (~1006).
- `menuAlbumItems(albums, artFor)` (~701) builds an Albums row: `{ label: album, sub: artist, node: {
  type: 'album', key: albumKey, label }, art: artVia(artFor, artId) }`. A Recent Albums row must be the
  SAME shape so it drills in through the existing `n.type === 'album'` branch in `music.js` `menuLoad`
  (~4302). Key = the track's `albumKey` (`tracksOfAlbum` filters on `t.albumKey`); skip tracks without
  one (a single with no album must not become an "Unknown Album" row that opens nothing - verify what
  `n.type === 'album'` does with an empty key and match Albums' behavior).
- `public/js/music.js` `menuLoad` (~4260): `MENU_RECENT_URL = '/api/music?filter=recent-listening&include=finished&limit=200'`;
  `recentArtists` -> `fetchJson(MENU_RECENT_URL).then(d => ({ items: SKINS.menuRecentArtistItems(menuItemsOf(d), musicArtUrl) }))`.
- `public/js/skin-surface.js`: empty text (~742 `'No recent artists'`) and staleness (~1249
  `markStale(... p.node.type === 'recentArtists' || ...)`): Recent Albums needs both (`'No recent albums'`,
  and stale on the same trigger).
- Tests: `test/unit/pocket-quick-scroll.test.js`, `test/unit/pocket-skins-menu.test.js` (menu rows).

### 3.4 The Transparent board (R2)
- `public/css/style.css` (~10305-10400): `.mms-ipod-custom5-transparent`, `-black`, `-coil`. Each sets
  `--pk-c-body` to a stack whose board layer is
  `url(../assets/skins/transparent-board.webp) 50% 100% / 121% auto no-repeat, #2c4238` (last two layers).
  `121% auto` is relative to the BODY's width, so a landscape body (the long side) scales the board ~2.2x
  and re-crops. That is item 2.
- The body paints it: `:where(html.is-phone, html.mms-popout) .mms-ipod{ background:var(--pk-c-body) }`
  (~8482) and the Ambient light variant `.mms-ipod.mms-lit.mms-lit-ambient{ background:var(--mms-lita-grain) ..., var(--pk-c-body) }`
  (~10545). Both must get the fix.
- Landscape layout: `@media (orientation: landscape)` "UI pass D7: POCKET IN LANDSCAPE" (~10596), phone
  only (`html.is-phone`); `.mms-full.mms-ipod` becomes a grid (LCD left, wheel right). The pop-out
  (`html.mms-popout`) is portrait by design: leave it alone.
- The angle: `public/js/pocket-lighting.js` `orientationAngle(win)` (~95: `screen.orientation.angle`, else
  `window.orientation`, -90 = 270). CSS cannot tell landscape-left from landscape-right, so JS must expose
  it (W5).
- Existing listeners: `public/js/common.js` ~372-401 (`orientationchange` + width-changing `resize` put
  `html.no-motion` on for a hold), `skin-surface.js` ~2138 `onViewportChange`.

### 3.5 The turn back (R3) - the frame evidence (ffmpeg, 2026-10-01)
Recording timeline: control center 0.0-0.8 s; portrait to landscape turn ~2.0-2.4 s; landscape to
portrait turn ~3.5-4.1 s. Every frame from 3.45 s to 4.05 s (0.6 s at native rate), in order:
- iOS's rotation animation (the rotating snapshot) for ~11 frames: clean, landscape layout.
- **Then ~5 frames where the rotating snapshot is the PORTRAIT shape but the LCD is giant**: the album
  cover fills the phone's whole width and most of its height, under a "Now Playing" header. That is the
  snapshot iOS took of the FIRST portrait-sized layout. Reading: for that layout the
  `@media (orientation: landscape)` LCD rule (height-fitted, `height:min(100%, ...)`) or a stale
  `--pkl-*`/`dvh` value was still in force at the new portrait size.
- Then the normal portrait iPod, Now Playing header ~35 px (scaled) from the top, for ~5 frames.
- **Then ~3 frames with everything ~20-25 px LOWER** (and the board re-cropped), then it snaps back up
  as the status bar reappears. Reading: a transient `safe-area-inset-top` / `100dvh` value during the
  status-bar return.
- The forward turn (portrait to landscape, ~1.9-2.5 s) shows no giant LCD; its only oddity is the board
  zoom (item 2).
Regenerate any sheet with (no drawtext in this build):
`$FF -v error -ss 3.45 -t 0.6 -i <video> -vf "scale=160:-1,tile=12x3" out%02d.png`.
These readings are HYPOTHESES from pixels. W6 must confirm the cause by measurement before fixing.

Headless instrument that already exists: `test/visual/capture.js` `rotation(browser, o, skin, variant)`
(~512): opens Pocket on a phone viewport (DPR 3), rotates with `page.setViewportSize` +
`Emulation.setDeviceMetricsOverride` (screenOrientation `landscapePrimary` angle 90 only), and records a
CDP screencast (every painted frame, ~1 s) per step, plus `pocketState(page)` (~565). It is not diffed by
`run.js` (`--no-rotation`). Extend it for W5/W6 (an angle-270 step; a per-frame LCD rect); do not build a
second harness.

### 3.6 The baselines bot (R4) - root cause, verified
- Run 36814361844 (push to main, "Merge pull request #64"): `refresh-source` ok, `baseline-refresh`
  FAILED at "Open a PR if the baselines changed", `##[error]Process completed with exit code 141.`,
  immediately after `git push` created `chore/baselines-b5805bd`.
- `.github/workflows/visual.yml` that step runs `set -euo pipefail` (~365) and builds `body.md` with
  `git diff --stat=200 HEAD~1 HEAD -- test/visual/baselines | head -n 100` (~386). v1.349 changed 300+
  baselines (the compare API caps at 300: 276 modified + 24 added), so `head` closed the pipe at line 100,
  `git diff` took SIGPIPE (141), and `pipefail` killed the step before `gh pr create`. PR #63 (after #62)
  worked because its stat was under 100 lines. The branch `chore/baselines-b5805bd` exists on origin with
  no PR.
- Test: `test/unit/visual-workflow.test.js` already parses `visual.yml`.

## 4. Waves (one branch, a commit per wave, one gate, one release)

### W1 - The baselines bot (item 4)
1. In `visual.yml` replace the `git diff ... | head -n 100` pipe with a form that cannot SIGPIPE under
   pipefail (write the stat to a file, then `head -n 100` the FILE; or `sed -n 1,100p` on a file). Scan
   the WHOLE workflow for every other `| head` / `| grep -q` under `pipefail` (a `grep -q` that matches
   early SIGPIPEs its writer too) and fix each the same way; list them in the evidence.
2. Unit test in `visual-workflow.test.js`: no step that sets `pipefail` pipes into `head` or `grep -q`.
   Mutate it (put the pipe back) and watch it go red; paste both.
3. Prove the fixed step body locally: extract it to a scratch script, run it with bash `-euo pipefail`
   against a fake repo whose diff stat is 300+ lines, with `gh` stubbed on PATH; it must reach the
   `gh pr create` stub. Paste the run.
4. Delete the stranded branch: `gh api -X DELETE repos/dtammam/filetube/git/refs/heads/chore/baselines-b5805bd`,
   then confirm with `git ls-remote origin chore/baselines-b5805bd` (empty). (Memory: `git push origin
   --delete` silently no-ops on this box.)
5. One line in `docs/RELEASING.md` "The visual job and baselines": after a merge, check that
   `baseline-refresh` went green or a `chore/baselines-*` PR merged; a red one is a real failure to fix.

### W2 - Skin grid last (item 1, R1)
Move the Music skin `.setup-group` block below the Player sticker block in `public/setup.html`, ids and
comments intact. Update the `.setup-intro` only if it names the order. Targeted tests: the five in 3.1.
Probe: in a phone viewport, `#sticker-picker` top < `#music-skin-picker` top; pick a skin and a sticker
still work.

### W3 - Speakers (item 6, R6)
Rename every user-visible "Play on..." in 3.2 to "Speakers" (row label, `TYPE_TITLE.playon`, both copies of
the Account note: "Only this browser. Shown in Speakers and when this device controls another. Leave
blank to use ..."). Update the comments. Update the tests that pin the string. Re-grep `public/` for
`Play on` and paste the result (expect zero user-visible hits; `'Only music can play on ' + label` in
music.js is a different sentence, leave it).

### W4 - Recent Albums (item 5, R5)
1. `music-skins.js`: `MUSIC_MENU` gets `{ type: 'recentAlbums', label: 'Recent Albums' }` right after
   `recentArtists`; `TYPE_TITLE.recentAlbums = 'Recent Albums'`; `menuRecentAlbumItems(tracks, artFor)`:
   unique by `albumKey` in recency order, at most `RECENT_ALBUMS_MAX = 25`, rows shaped exactly like
   `menuAlbumItems` rows (label album, sub artist, node `{ type: 'album', key, label }`, art via `artId`
   or the track's art like Recent Artists does). Export it.
2. `music.js` `menuLoad`: `recentAlbums` -> `fetchJson(MENU_RECENT_URL)` -> `menuRecentAlbumItems`.
3. `skin-surface.js`: empty text `'No recent albums'`; stale on the same trigger as `recentArtists`.
4. Unit tests: dedupe, order, cap, no-albumKey skip, row shape equals an Albums row for the same album,
   menu order. Mutate the dedupe and the cap; watch red.
5. Probe (headless phone, fixture): Music > Recent Albums lists the played albums; Select on one opens the
   same song list as Albums > that album.

### W5 - The board stays put (item 2, R2)
Design constraints (the how is yours; keep it small):
- **Portrait unchanged**: for all three Transparent skins (and Ambient light on), the portrait Now Playing
  must be pixel-identical to base. Prove with a before/after headless shot diff (0 changed pixels).
  If it cannot be, stop rule 0.8(b).
- **Landscape**: the board layer is drawn at the PORTRAIT body's size (the viewport's short side x long
  side), with the portrait rule `50% 100% / 121% auto`, then rotated by `-angle` about the viewport
  center so each board pixel lands on the same physical glass pixel it had in portrait. Angle 90 and 270
  both. The clear frame, sheen and edge gradients keep today's landscape behavior (only the photo moves).
  A natural shape: split the board layers out of `--pk-c-body` into their own var (e.g. `--pk-c-board`)
  painted by a pseudo-element under the content, so portrait paints the same layers in the same order.
- **The angle**: a tiny shared helper sets `html[data-ft-rot="0|90|180|270"]` from
  `screen.orientation.angle` (fallback `window.orientation`, -90 -> 270) on load, `orientationchange`
  and `screen.orientation` `change`; reuse `pocket-lighting.js`'s `orientationAngle` logic rather than a
  second copy (move it somewhere both can read, or export it). Phone only.
- Watch the overlay-containment census and the `html.no-motion` rotate hold: the board must not animate
  between orientations.
- Prove it: extend the `rotation` case in `capture.js` with an angle-270 step, then for 90 and 270
  compute where 3 board landmarks land in the portrait shot vs the landscape shot rotated back by the
  angle: same physical position within 2 CSS px. Paste the numbers and the four shots (portrait, 90,
  270, back to portrait).

### W6 - The turn back (item 3, R3) - diagnose, then fix
1. Reproduce headless with the `rotation` screencast on `ipod-custom5-transparent-coil`, landscape to
   portrait. Add to `pocketState`/a per-frame probe: the LCD's rect, `matchMedia('(orientation:
   landscape)').matches`, `innerWidth/innerHeight`, `visualViewport` size, the computed `--pkl-h`, and
   `env(safe-area-inset-top)` (read via a probe element). Log per animation frame for 1 s.
2. Add a `?debugRotate=1` ring buffer on the phone (same idea as `?debugLifecycle=1`): the same fields per
   rAF from `orientationchange` for 1 s, shown or copyable, so Dean's device can confirm what headless
   cannot (iOS snapshot timing does not exist in Chromium).
3. Name the cause with the numbers (which rule or value was stale in which frame). Fix the CAUSE (e.g.
   key the landscape layout off one measured source that flips atomically, or stop the LCD from ever
   being larger than the viewport's portrait box), not a timeout.
4. Prove: per-frame LCD rect never exceeds the portrait LCD box during the turn back (headless), and the
   Now Playing header's top is monotonic (no 20 px dip). If headless shows neither artifact, rely on the
   W6.2 log and stop rule 0.8(c) applies.
5. Device check for Dean: a screen recording of the same turn back with `?debugRotate=1`.

### W7 - Proof, then release
1. `npm run lint`, `npm run lint:ui`, `node scripts/overlay-containment-lint.js --enforce`, the full suite
   on Node 22.23.1 and 24.20.0. Paste the tallies.
2. Expect the PR's visual comment to show: Settings Mobile player (sticker first), the Pocket menu
   (Speakers, Recent Albums), landscape Transparent shots if any scene covers them. Correct, no action.
3. After merge: confirm the push run's `baseline-refresh` is green and a `chore/baselines-*` PR merged
   (W1's fix, live). If it is red again, that is a failure to report and fix, not to note.

## 5. The gate

Adversary (floor) + QA, spawned fresh on the committed branch with: this plan, the base sha, and the
attack surfaces below. Ship on CRITICAL/WARNING closure; after 2 rounds, ask Dean at round 3.

- W1: the test can fail (mutate it); no other pipefail SIGPIPE shape remains in `visual.yml`; the
  local step proof really ran the step body, not a paraphrase.
- W2: both pickers still work on phone and desktop; the deep link `#mobile-player` still opens the page.
- W3: no user-visible "Play on" left; ids/types unchanged; past history untouched.
- W4: Recent Albums rows really drill in (prove REACHABILITY with the real `/api/music?filter=recent-listening`
  shape, LESSONS: inert feature); a hidden-visibility album never shows (the route gates it; confirm no
  second source); empty state.
- W5: portrait 0-pixel diff for all three Transparent skins with and without Ambient; 90 AND 270 both
  land within 2 px; the pop-out untouched; no animation between orientations; non-Transparent skins
  unchanged in landscape.
- W6: the cause is named with numbers; the fix addresses it (mutate the fix back, watch the probe go red);
  no timeout/debounce masking.
- Lying comments (LESSONS 12): every comment that says "Play on...", and any comment that says the board
  is sized to the body.

## 6. Release (docs/RELEASING.md is the authority)

v1.350.0 via the protected-main PR flow. ROADMAP.md Shipped entry; a `docs/releases.json` entry in pure
user language (e.g. "Phone player settings show the sticker first and the skins last. Play on... is now
called Speakers. The iPod menu has Recent Albums. On the clear iPods the circuit board stays put when you
turn the phone, and turning back to upright is smooth."). LESSONS.md: add the pipefail+head SIGPIPE
class (a pipe that exits early under `pipefail` kills the step) and, if W6 names a new class, that too.
Move this plan to `completed/` in the release commit. Device checks for Dean go in DEVICE-CHECKS.md.

## 7. Out of scope (log, do not build)

- Recent Albums on the regular Music page (R5).
- Reordering skin families inside the grid, or a line > gen > color drill-down in Settings (R1).
- Pinning any other skin's body to the phone; rotating the sticker or the critters.
- A landscape layout for the pop-out.
- Renaming the `playon` node type or `hasPlayOn` (R6 is words only).

## 8. Evidence and gate verdicts

### Builder evidence (fill in)
- W1:
- W2:
- W3:
- W4:
- W5:
- W6:
- W7:

### Gate verdicts (seats write here, bound to the sha reviewed)
