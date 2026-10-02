---
plan: pocket-music
harness: v2 · lean
branch: feat/v1.354-pocket-music
anchor: spec
status: Draft
next: Step 0, then W0 (falsifiers and Dean's one capture); read the whole plan first, every section
design: Dean 2026-10-02 - all four items in ONE branch and ONE release, built by Sonnet; the PC's queue on the phone ("We are remotely playing on that PC, after all"); search for the library AND the skins list in one plan ("Both in one plan"); R1-R6 below are architect defaults he did not overrule
gate: FULL (adversary + qa + security-brief; a new field on the remote channel, lib/remote/**)
---

# v1.354: the whole library on the iPod, the PC's queue on the phone, a clean turn, and iPod search

Written 2026-10-02 by an Opus session at v1.353.0 + PR #71 (102fca76). Seams were read on main, not assumed. The ROADMAP
Planned entries dated 2026-10-02 are the WHAT; this plan is the HOW and wins where they differ.

## 1. The outcome (what Dean will do on device)

1. With 23,000 songs, the iPod's Songs menu scrolls (and letter-jumps) all the way to Z; Genres is complete; Shuffle Songs
   can play any song; Liked shows every liked song.
2. While his phone plays on a speaker computer, the center button on Now Playing shows the PC's up-next list (the playing row
   marked); a tap plays that row on the PC. Never a blank Songs page.
3. Turning the phone with a Transparent skin: the board lands in place in one step, and the skin lands in one step coming back
   upright (no jump, no bump).
4. Music > Search on the iPod skins, iPod style: the alphabet strip at the bottom of the LCD, the wheel picks a letter, center
   adds it, MENU deletes one, results narrow live above (songs, albums, artists). The same control searches the Music skins
   list (Settings > Mobile player, Pocket Extras > Skins).

## 0. Step 0 - read, set up, and the stop rules

0.1 Read `AGENTS.md`, then `docs/LESSONS.md` sections **0, 1, 2, 3, 4, 5, 6, 8, 10, 13**, then
`docs/exec-plans/completed/2026-10-01-remote-volume.md` (v1.353: sections 3-7 show the remote channel, the skin engine's
modes, the proof harness and how its gate went) and `docs/exec-plans/completed/2026-10-01-mobile-polish.md` sections 3.5 and
W6 (v1.350's turn-back diagnosis; its fix removed the giant LCD but the recording below shows what is still wrong). Read this
plan fully before editing. Order of work: W0, W1, W2, W3, W4, W5.

0.2 Environment, every shell: `export PATH="$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH"`.
Dual-Node for the final suite: 22.23.1 and 24.20.0 (Node 24 prints `ℹ`, not `#`; an empty grep is not green).

0.3 Worktree: `git -C /home/coder/projects/filetube worktree add .claude/worktrees/pocket-music feat/v1.354-pocket-music`
(the branch exists locally and carries this plan). Rebase onto `origin/main` first if main moved. In the worktree:
`ln -s /home/coder/projects/filetube/node_modules node_modules` before any commit/push, `rm node_modules` after, never stage it.

0.4 Git: stage files BY NAME; `git commit -F <file>` (write the message with a QUOTED heredoc, `<<'EOF'`: an unquoted one
runs backticks as commands); never `--no-verify`, never force-push, never pipe a commit or push; verify with `git log` /
`git ls-remote`. The pre-commit hook runs the unit suite (~5 min): run long commits in the background and wait for them.

0.5 Tests while building: the targeted files each wave names. Full dual-Node `npm test` once after W4, again only if a gate
round changes code, never while a gate seat is running.

0.6 Report every failure verbatim with counts. "Verified" means you ran it and saw it. Mutants only on COMMITTED work, in a
/tmp `git archive <sha>` sandbox with `node --test --test-timeout=20000 <file>`, an exact-once replace, restored in a
`finally`, the sandbox diffed against a pristine copy after; kill anything you start BY PID (v1.353: a hung mutant's test
process spun a CPU for an hour and failed an unrelated suite test). Record each wave's mutants in section 7.

0.7 No em dashes in docs, comments or user-facing text. UI through `ui.js` primitives and tokens; `npm run lint:ui` must not
grow (shrink it with `node scripts/ui-lint.js --shrink` when debt is paid); `node scripts/overlay-containment-lint.js
--enforce` stays 0. A comment, test title or doc your change inverts is a finding (the lying-comment class): grep for it.

0.8 **Stop rules.** Stop and ask Dean (AskUserQuestion) if: (a) a seam in section 4 does not exist or behaves differently and
the fix is not a like-for-like rename; (b) a turn hypothesis is KILLED by the capture (never patch a theory, LESSONS 1);
(c) the search LOOK: before building W4's UI, send Dean the reference photos beside a real-browser shot of the build
(SendUserFile) and ask; (d) any step needs a new npm dependency (none planned); (e) a gate seat asks for a scope change;
(f) the gate passes 2 rounds and a 3rd is needed; (g) the merge. Never widen scope: log extras in ROADMAP.md Planned.

## 2. Rulings and defaults

| # | Question | Ruling |
|---|---|---|
| R1 | One release? | **Yes (Dean, 2026-10-02): one branch, one release v1.354.0**, all four items. |
| R2 | The 10,000 cap | Page the client requests (`offset` + `limit`, the routes already slice by both); never raise the server's MAX_LIMIT (it protects every list route). Architect default. |
| R3 | The PC's queue | **Yes (Dean)**: the PC reports up to 200 ids around the current one (100 before, 100 after; R3 cap is an architect default) plus the current index; the server resolves them through the CALLER's visibility before any title leaves (a hidden id is dropped, the index re-pointed); the phone's list is that. A tap = a `play` command with those ids from that row. |
| R4 | The center button while the PC's queue is unknown | Does nothing (no list), never an empty screen (LESSONS 4). Architect default. |
| R5 | The turn | Instrument + fix in the same release (LESSONS 1 allows "ship an instrument, or both fixes, not a theory-fix"): fix only what the capture confirms; Dean's post-release recording is the judge. Architect default. |
| R6 | Search scope | **Both in one plan and one release (Dean)**: the library (songs, albums, artists via the existing `search=` on `/api/music`, `/albums`, `/artists`) and the Music skins list (client-side, the registry is local). One control, two data sources. |

## 3. The turn, measured (Dean's screen recording, 2026-10-02, 1180x2556 at 58.65 fps, every frame)

Both turns each way were identical: deterministic.
- **To landscape:** the layout lands (LCD top steady from frame #19), then the Transparent board is drawn somewhere else for
  ~5 frames (~85 ms) and snaps to its place at #25 (settled landscape is right: the board's offset against portrait is 0,0).
  Hypothesis (a): the counter-turn rule `@media (orientation: landscape){ html.is-phone[data-ft-rot="90"|"270"] ... }`
  (public/css/style.css ~10425) needs `html[data-ft-rot]`, which pocket-lighting.js (~591) stamps only at load and on
  `orientationchange` / `resize` / `screen.orientation` change; the media query applies at the first landscape layout, earlier.
- **Back upright:** 3 frames (#141-#143, ~50 ms) with the LCD drawn under the status bar (top 0) and the board 58 CSS px high;
  then 2-4 frames (#144-#147, ~67 ms) with the whole skin ~58 CSS px TOO LOW (LCD top 80 frame px vs the final 45); then it
  rises into place (#148). 58 CSS px = this iPhone's top safe-area inset (59). Hypothesis (b): the inset counted twice for a
  few frames (a stale `100dvh` / `--pkl-h` / `env(safe-area-inset-top)` value; `--pkl-h` is CSS at style.css ~10636-10637,
  `calc(100dvh - env(safe-area-inset-top) - ...)`).
- Re-measure method (ffmpeg is not on the box): `pip install --user imageio-ffmpeg` gives a static binary (no drawtext);
  `ffmpeg -i rec.mov -vf scale=236:-1 f%04d.png`; per frame, the LCD's top edge (the first row below the status band where
  >70% of x 40..200 is dark) and a board patch's phase-correlation offset against portrait (a corner the LCD and wheel never
  cover, x 196..236, y 300..470). Contact sheets with PIL.

## 4. The seams (read at 102fca76; line numbers drift, names do not)

- Cap: `public/js/music.js` `menuAllSongs()` (~4323, `limit=10000`; feeds Songs, Genres, the untagged-artist bucket ~4337,
  the cover pool ~4356), `shuffleAllFromMenu()` (~4602, `sort=random&seed=...&limit=10000`), `playlistSource('liked')`
  (~4437, `limit=10000`). Server: `lib/music/routes.js` (~255 `normalizeLimit`, `offset`), `lib/videoQuery.js` MAX_LIMIT.
  The pocket menu's windowed rows and letter jump: `public/js/skin-surface.js` `createPocketMenu` (letter mode ~753-866).
  Related tracker rows: #255 (b), #266 (b), #29.
- PC queue: PC side `public/js/music.js` `queue` (~2994), `currentSkinIndex()` (~2847), the remote hooks it already registers
  (`REMOTE.setMusicPlayHandler`, `setNowPlayingResolver` ~2897-2903); `public/js/remote.js` target (`buildStatePayload`,
  `sendState`, `setNowPlayingResolver` ~382, `trackChanged`); server `lib/remote/routes.js` (`resolvedState`, the
  `resolveTracks(req, ids)` dep ~45/110, the POST `/api/remote/state` validation, `PLAY_MAX_IDS`); phone side
  `public/js/music.js` `remoteSkinCtx()` (`fullList: []`, `upNext: []`), `remotePlayAt`, the mirror signature `sigOf`;
  engine `public/js/skin-surface.js` the `[data-skin-select]` arm (`setListMode(true)`) and `[data-skin-go]` rows;
  `public/js/music-skins.js` `ipScreen` (`goRows(ctx, false, ctx.fullList)`).
- Turn: `public/js/pocket-lighting.js` `stampRotation` (~102) and its listeners (~591-596); style.css ~10421-10428 (the
  board turn) and ~10630-10645 (`--pkl-*`); `public/js/common.js` the `?debugRotate=1` instrument (`rotateSample` ~417,
  `installRotateDebug`); `test/visual/capture.js` `rotation()` (the headless rotation harness, ~512).
- Search: the music routes' `search` param (`lib/music/routes.js` ~212, 265, 284); `public/js/music-skins.js`
  `menuStaticItems` (the Music level), `TYPE_TITLE`, `NON_ITEM_LEVELS`; `skin-surface.js` `createPocketMenu` (the wheel
  cursor, the letter machinery to reuse, `onMenu`/`onSelect`); the skins list: the registry (`SKINS`, `menuSkinItems`,
  `skinFamilies`) and Settings > Mobile player's grid (`public/js/setup.js` ~756 `skin-grid`).
- Proof harness: `tools/listen-control-proof/serve.js` (seeds WAV songs; extend it to seed N songs), `volume-proof.js`
  (two contexts as one user; CDP `Runtime.evaluate {userGesture:false}` for the speaker).

## 5. Waves (one branch, one gate, one release: v1.354.0)

### W0 - Falsifiers and the capture (before editing product code)
1. Cap: seed 10,500+ songs (extend serve.js with a `count` option; tiny WAVs) and show the iPod Songs menu's last row is not
   the last title today; same for Genres and a Shuffle sample's max index. Record numbers in section 7.
2. Turn: ask Dean (AskUserQuestion) NOW, before building anything else, for one capture from production (v1.353 already has
   the instrument): open the music page with `?debugRotate=1`, play in Pocket on a Transparent skin, turn to landscape and back
   upright, tap the green panel to copy the rows, paste them. Those rows carry `sat` (the top inset), `--pkl-h`, `land`, `ang`
   and the LCD rect per frame: enough to confirm or kill hypothesis (b). They cannot test (a) (no `data-ft-rot` column; the
   sampling starts on the same events that stamp it): W3 adds that. Build W1 and W2 while waiting.

### W1 - The whole library on the iPod (the 10,000 cap)
Page every capped menu request (`offset`/`limit` pages of 5,000, sequential, cancelled on teardown; or the letter jump loads
by letter: your call, recorded in section 7). Songs, Genres (and the two other menuAllSongs readers), Liked; Shuffle Songs
plays from a random order over the WHOLE library (the server's `sort=random&seed` is stable across pages: page it, or shuffle
the full id list client-side). Keep the first rows on screen fast (render page 1, append the rest).
Tests (binding, each mutated red): the paging loop (a fake fetch returning `total` 23,000: every page requested, in order,
none twice, a teardown mid-load stops it); the Songs level's last row; Shuffle's set covers ids past 10,000.
Real browser (extend a proof script): with 10,500+ seeded songs, scroll to the last title AND letter-jump to Z; Genres
complete; a Shuffle play's queue includes an id past the first 10,000.

### W2 - The PC's queue on the phone (FULL gate)
Wire: the PC's state gains `queue: {ids, index}` (R3: up to 200 around the current; omitted when unknown). POST
`/api/remote/state` validates it (an array of valid ids, length <= the cap, an integer index in range; otherwise not
carried). `resolvedState` resolves the ids through the CALLER's visibility (`resolveTracks`), drops hidden ones, re-points
the index, and sends `{tracks:[{id,title,artist}], index}`; the idle default carries none. Every carrier: the stream frame,
GET targets, the controller poll, the idle default (the v1.352/v1.353 lesson: `resolvedState`'s field list is explicit).
PC: music.js registers a queue reader with the target (like `setNowPlayingResolver`, cleared on teardown); a queue change
pings `trackChanged`. Phone: `remoteSkinCtx` fills `fullList` from the state's queue (the current row `is-current`); the
center button with no queue does nothing (R4); a row tap sends `play` with that list from that row (`RC.play`, the
PLAY_MAX_IDS slice). The mirror signature repaints when the queue arrives.
Tests (binding, each mutated red): validation table (non-array, a bad id, over the cap, a bad index); a hidden id never
reaches the phone and the index re-points (a member with a restricted folder, the remote-api fixtures); every carrier
carries it; the phone's list renders from a POPULATED state and clears when the speaker is left; the center button with no
queue opens nothing; a row tap sends the right ids and index. Real browser: phone picks the PC, center shows the PC's queue
with the playing row marked; tap row 3: the PC plays it.

### W3 - The turn (instrument + the confirmed fixes)
1. Extend the `?debugRotate=1` instrument: a `rot` column (`html[data-ft-rot]`) and start sampling from a
   `matchMedia('(orientation: landscape)')` change listener (or a free-running rAF for the 1 s after any trigger), so the
   frames BEFORE `orientationchange` are logged. Unit-bind the new columns and the new start.
2. Fix (a) if the code reading holds (it is structural, not device-only): stamp `data-ft-rot` in the SAME frame the
   landscape layout applies (a `matchMedia` change listener runs in the rendering steps before paint), keeping the existing
   listeners as the angle's late correction. If the angle is not yet known in that listener on iOS, the board must not draw
   a wrong turn: hide it (or keep the portrait placement) while `land` and `rot` disagree. Bind it.
3. Fix (b) ONLY as the W0 capture confirms it (stop rule 0.8 b if it does not).
4. Prove headless where possible (`test/visual/capture.js` rotation, angle 90 and 270, per-frame LCD rect and board
   position). The device recording after release is the judge; the device check says so.

### W4 - iPod-style search (the library and the skins list)
FIRST the look (stop rule 0.8 c): reference photos of the real Music > Search (the 6G Classic and the nanos: the alphabet
strip along the bottom of the LCD, the typed letters above it, the results list above that); build it; send Dean the
references beside a real-browser shot (iPhone 13, an iPod skin, the Original too) and ask. Then:
- A Search row in the iPod Music level (`menuStaticItems`), a `search` level: the wheel moves along the strip (letters, space,
  a delete glyph), center adds the letter, MENU deletes one (and on an empty query climbs back), results narrow live above
  (debounced, through `/api/music?search=`, `/albums?search=`, `/artists?search=`, grouped Songs / Albums / Artists, a row tap
  opens or plays as the menu's own rows do).
- The same control on the skins list: Pocket Extras > Skins and Settings > Mobile player filter the registry by name
  (client-side).
Tests (binding, each mutated red): the strip's cursor math (wrap, delete, space), the query building, the debounce and the
stale-response guard (a slow first query never overwrites a newer one, LESSONS 4 TOCTOU), the skins filter. Real browser:
type "PRO" with the wheel on a seeded library, the results show the matching song/album/artist; MENU deletes; the skins list
filters.

### W5 - Docs and release
README (Music: the whole library, the PC's queue, search), DEVICE-CHECKS lines (section 8), ROADMAP Shipped (and close the
four Planned entries), `docs/releases.json` in user language, LESSONS only for a new class. Close this plan with
`node scripts/plan-complete.js ... "Shipped v1.354.0" --apply`. Release per docs/RELEASING.md and the protected-main flow:
release commit on the branch, local `merge --no-ff` into main, annotated tag on that merge, push branch + tag in ONE push with
`GIT_SSH_COMMAND="ssh -o ServerAliveInterval=20 -o ServerAliveCountMax=60"`, `gh pr create`, required CI `ci (22)`,
`ci (24)`, `audit`, `secret-scan` green, ASK DEAN, `gh pr merge --merge`, `git reset --keep origin/main` only after
`git diff <tagged merge> origin/main` is empty, delete branches `-d`.

## 6. The gate: FULL (adversary + qa + security-brief)

Briefs (LESSONS 2, 4, 5, 6, 8, 10): **Adversary**: prove a control inert somewhere real (a skin family, the pop-out, a list
past the cap by scroll AND letter jump, the center button with and without a queue, search on every iPod skin); the paging
loop losing or repeating a page; the queue's index after hidden ids are dropped; the turn's new stamp vs the old listeners;
mutate every binding test. **QA**: regressions in the local iPod menus (cursor, letter mode, quick scroll, Now Playing's
song list in local play), v1.353's volume bar and v1.352/1.348 remote behaviour, the PC's own Music page, every skin family,
lint:ui, the overlay census, comment accuracy. **Security-brief**: the queue field's validation and visibility (another
user's or a hidden track's title never reaches a phone; the cap; type confusion), the search params (no new server surface
expected: confirm), the rate limiters. Brief each seat: page.evaluate grants a gesture; mutants in /tmp sandboxes with
--test-timeout; never run the full suite while seats run.

## 7. Evidence and gate verdicts

### W0 evidence

**Cap falsifier** (`tools/listen-control-proof/cap-v0.js`, 10,503 songs seeded, iPhone 13, iPod skin, base 102fca76 + serve.js `count`):
`{"songsRows":10000,"songsLastRow":"Y Bulk 009996","genres":["Music"],"genresHasZydeco":false,"shuffleFetches":[...,{"n":10000,"total":10503}]}`
- Songs: 10,000 rows (340,000 px / 34 px); the last row is "Y Bulk 009996", the 500 "Z Bulk" songs are missing.
- Genres: only "Music"; "Zydeco" (the genre of the last 500 titles) is missing.
- Shuffle Songs: the random fetch returns 10,000 of 10,503 (the queue is cut at 10,000).
- One 10,000-row request took 317 ms on this box (server side, 10,500 songs).

**Turn capture (Dean, `?debugRotate=1`):** rows analysed at W3 (see W3 notes below once written).

## 8. Device checks Dean would owe (into DEVICE-CHECKS.md at release, one line each)

- [ ] v1.354.0 - iPod Songs: scroll and letter-jump to the last songs (past H, to Z); Genres shows every genre; Shuffle Songs plays songs from the whole library; Liked lists every liked song.
- [ ] v1.354.0 - Controlling the speaker, Now Playing: the center button shows the PC's up-next list with the playing song marked; tap a song: the PC plays it. Before the PC has said its queue, the button does nothing (never a blank page).
- [ ] v1.354.0 - A Transparent skin: turn to landscape and back: the board lands in place in one step, and the skin lands in one step coming back upright (screen-record it with `?debugRotate=1` and send the rows if not).
- [ ] v1.354.0 - Music > Search on the iPod: the wheel picks letters on the strip, center adds, MENU deletes; results narrow live; it looks like the iPod's own search on each iPod skin you use, the Original included.
- [ ] v1.354.0 - Search the skins list (Pocket Extras > Skins, Settings > Mobile player): typing a name narrows it.

## 9. Out of scope (log, do not build)

- Raising the server's 10,000 list cap.
- Search outside Music and the skins list (videos, podcasts, books): ROADMAP Planned after this ships.
- Editing the PC's queue from the phone (reorder, remove): ROADMAP Planned.
