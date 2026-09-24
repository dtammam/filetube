---
plan: chapter-snap
harness: v2 · lean
branch: feat/chapter-snap
anchor: spec
status: Building
next: pre-r3 merge of main v1.321.0 @00faee52 (no conflicts), head re-verified (2065/2065, 18/18 targeted mutants RED, theatre on/off probe); ready for gate r3 (adversary + qa + security-brief S-5 re-engage; data class)
design: Approved 2026-09-24 @ecb61e1d (Dean's intake, recorded in memory wave-2026-09-24-intake)
gate: pending
---

# Chapter Snap: fix when chapters start

Wave item 1 of the 2026-09-24 wave. Base: main ecb61e1d (= v1.318.0). Tech-debt ids #239-#242
reserved (#239-#241 used).

## The ask (Dean's decisions, 2026-09-24)

Dean (2026-09-23): "chapter albums starting in a lot of blank space or starting at the end of a
previous song. I would love a mechanism to 'correct' this. Maybe a 'snap-to'. [...] And then mark
a specific way so a reheat won't replace. Or make that an explicit choice."

| ID | Decision |
|----|----------|
| S1 | **Auto-snap to silence**: ONE ffmpeg `silencedetect` pass over the file, CACHED. Snapped start = end of the silence before the first sound, minus the **lead-in** (default 0.25 s). Chapter 1 always stays put. No gap near a boundary (a gapless album) -> say "no gap found", offer only the nudge. |
| S2 | **Per-boundary nudge** -1 s / -0.1 s / +0.1 s / +1 s; **play-from-here** (audition); **Snap all** (then review before saving). |
| S3 | **TIMES ONLY**: never add, remove or reorder. `<mediaId>::c<n>` likes/progress stay put; the server refuses a save that changes count or order, and times that break ordering (each start strictly after the previous, before the duration). |
| S4 | **Persistence** in the existing `chaptersManual` (wins over embedded/description, survives scan/reheat, GET reports `chaptersSource: 'manual'`) - VERIFIED below. |
| S5 | **"Edited" badge** where chapters show when the source is manual via snap. **"Revert to source chapters"** behind an IN-PAGE confirm, seeded from STORAGE. The editor itself seeds from the persisted record. |
| S6 | **Who edits**: `requireModifyLibrary` + `restrictedVideoMutation` on every new route; entry points hidden for non-modifiers. |
| S7 | **Lead-in**: SERVER-WIDE Setup setting, default 0.25 s, 0-2 s. |
| S8 | **Silence cache**: FEATURE-OWNED, keyed by media id, carried across rescans, INVALIDATED when size/mtime change; NUL ids refused; ffmpeg bounded (timeout, one per item, argv not shell). |
| S9 | **Four entry points, ONE editor**: Music album drill, now playing "This chapter starts wrong", watch chapters list, the setup/library item (the text chapters editor). |
| S10 | **PHONE IS A PRIMARY VIEWPORT**: >= 44 px targets, no drag-only control, nothing clipped or sideways at 390x844; measured in headless Chromium. |
| S11 | Mockup https://claude.ai/artifact/4fxAkqL1adz4oS352MY5sK - READ with the Artifact tool; built as its list editor (see Disclosed gaps for the waveform). |

## Re-verified survey (read at ecb61e1d before any edit)

Persistence claims (S4), each checked against the tree:
- Serve-time precedence: `resolveItemChapters` server.js:2386-2399 - `chaptersManual` (non-empty
  array) wins, source `'manual'`; GET /api/videos/:id returns `chapters` + `chaptersSource` from it
  (lib/media/routes.js:767-781). **Holds.**
- Scan re-init carry-forward (a CHANGED file): lib/scan/orchestrator.js:1122-1124 copies
  `existing.chaptersManual` verbatim (array, elements untouched). **Holds**; bound by
  chapter-snap.test.js "a RESCAN keeps the snap edit ... CHANGED file" (provenance keys survive).
- Phase-2 merge guard: orchestrator.js:1432-1436 mirrors `freshItem.chaptersManual` (present OR
  absent) unconditionally. **Holds** (field-level; the existing chapters-editor.test.js HEADLINE
  binds the mid-scan edit; this branch writes the SAME field).
- Persist-gate OR-chain / final-merge gap-fill: apply to a NEW per-item field only. This branch
  adds NO per-item field - the provenance rides INSIDE each `chaptersManual` element
  (`snapFrom`, `snapBase`), so every carrier of the field carries it. **Not applicable by design.**
- Reheat: lib/ytdlp/relocation.js:1305-1320 re-pulls `item.chapters` only; `chaptersManual` "stays
  the editor's alone". **Holds**; bound (the REAL `recordRepulledItemMeta` path) by "revert seeds
  from STORAGE after a REHEAT".
- Backup bundle: lib/admin/backup.js:447-453 carries `metadata` items verbatim (id + object
  shape checks only). **Holds**; bound by "the BACKUP bundle carries the snap edit".
- Trash snapshot: the item rides the trash record verbatim (media-trash-store.test.js:100-107
  already binds a `chaptersManual` snapshot).

Gates and routes:
- The text editor route POST /api/videos/:id/chapters lib/media/routes.js:1841-1880:
  `requireModifyLibrary` (server.js:3308, 403) then `restrictedVideoMutation` (server.js:1234-1239,
  404 for a restricted item, looks up the cached db).
- `updateDatabase` server.js:778-797: a fresh `loadDatabase()` INSIDE the write chain, a
  SYNCHRONOUS mutator - every check inside it is atomic against every other writer.
- Chapter likes/progress: `<id>::c<n>` = the index in the RESOLVED list (lib/music/libraryAudio.js
  `chapterTrackId`, `expandAudioToTracks` :205-235); music progress for a chapter records to the
  BASE file position (music.js:2689-2711, v1.222) - a time change moves no progress.
- Settings: DEFAULT_SETTINGS server.js:449-537, KNOWN_KEYS + validation lib/config/routes.js:852-940,
  `settingsResponse` :798-830; a backup restore writes settings keys generically (backup.js:364-368).

Client:
- The existing text editor `showChaptersEditor` common.js:12775 - one textarea, POSTs raw text.
  Callers: player.js:6857 (watch chapters menu "Edit chapters...", inside `if
  (playerCanModifyLibrary)` :6979) and music.js:2514 (drill "Edit chapters", gated by
  `canEditChapters`, seeded from `/api/videos/:id`, the v1.273 data-loss fix).
- Extras: skin-surface.js `createExtrasMenu` :116 (`buildExtrasHtml` :158, `handleAction` :470);
  TWO writers of the cfg in music.js (sticker :1143, desktop actions :1560) + the sticker
  forwarder skin-surface.js:760-777 (a THIRD list: it forwards named cfg fields only).
- The chapter watcher reads chapter starts from the live `queue` (music.js currentChapterId
  :1216, currentChapterBounds :1235, reflectChapter :1254 which re-registers nav on a cross).
- `common.js` ships on every player shell (music, watch, index, history, podcasts, tv, books,
  read, setup, stats) - no new global script, so no shell-parity add.

## Design

Server:
- `lib/media/chapterSnap.js` (pure): lead-in clamp/validator, `isSnapEdited`, `chaptersVersion`
  (sha256 of the stored manual list + the resolved list and source), `suggestSnaps` (window 8 s
  before / 12 s after a boundary; nearest silence; `max(silence.start, silence.end - leadIn)`;
  statuses first/suggest/fine/no-gap; reasons silence/tail/late), `snapAllStarts` (ordering-safe),
  `validateSnapStarts` (count, strictly increasing, chapter 1 unchanged, before the end / a week),
  `buildSnappedManual` (stored titles + provenance; a re-edit keeps the FIRST base),
  `planRevert` (base manual -> restore the typed times; else drop the manual list), `editorRows`.
- `lib/media/chapterSilence.js`: `buildSilenceDetectArgs` (argv, `-nostdin -vn -sn -dn`, `-af
  silencedetect=noise=-45dB:d=0.5`), a streaming stderr parser (bounded), `runSilenceDetect`
  (SIGKILL timeout 2-30 min, safe messages), the cache (`DATA_DIR/.chapter-silence/<sha256(id)>.json`,
  atomic write, NUL/empty ids refused) and the service (state per item, one run per item - a second
  start JOINS - one run server-wide, queue cap 8 -> busy; the file is RE-STATTED after the await and
  a changed file is not cached).
  Why a file store, not a table: it is a derivable CACHE (not user data) - a table would bump
  SCHEMA_VERSION (a new rollback floor) and enter the backup bundle for no benefit. Feature-owned,
  keyed by media id, and a rescan cannot touch it.
- `lib/media/chapterSnapRoutes.js`: GET `/api/videos/:id/chapter-snap`, POST `.../scan`, POST
  `.../chapter-snap` (save), POST `.../revert`. Each: requireModifyLibrary -> restrictedVideoMutation
  -> NUL/own-property/visibility 404; writes re-fetch the item INSIDE the write tick, re-check
  `mediaVisibleTo`, compare the `version`, then validate. Revert refuses a count change unless
  `allowCountChange: true` (409 + `countChange`).
- `server.js`: the lead-in default (`chapterSnapLeadInSec: 0.25`), the routes' registration, the
  `chaptersEdited` flag on GET /api/videos/:id and on projected chapter tracks (`itemChapterTracks`
  -> `publicTrackListItem`).
- `lib/config/routes.js`: the setting (KNOWN_KEYS, 0-2 validation, response clamp).

Client (ONE editor, four doors):
- `common.js` `showChapterSnapEditor(mediaId, {focusIndex, onSaved})` - seeds from GET, starts the
  scan when none/stale, polls while running; rows with chip + Snap-to + four nudges + Play from
  here; header Snap all / Undo / Revert; in-page confirm for revert, discard and a count-change
  revert; Save sends `{version, starts}`; a stale version disables Save and says why.
  Audition: an editor-owned `<audio>` on `/video/<id>`, seeks to the boundary, plays 8 s, pauses
  any other playing media first.
- Entry points: music drill "Fix times" (music.js `.music-drill-snap`); now playing "This chapter
  starts wrong" (skin-surface `data-skin-x="chapter-snap"`, cfg `onChapterSnap` on BOTH music.js
  writers AND the sticker forwarder, index captured at Extras OPEN); watch chapters menu "Fix
  chapter times..." (player.js, inside the `playerCanModifyLibrary` arm); the text editor's "Fix
  times..." (common.js, refused while its textarea holds unsaved typing).
- The re-register seam (music): `applySnappedChapterTimes` patches every queue entry of the file IN
  PLACE (start + span), then `reflectChapter()` (re-derives the playing chapter and re-registers
  nav), `reflectEngines()`, and repaints the drill. The watch player rebuilds its menu and drops an
  armed chapter loop.
- Setup: "Chapter snap lead-in" select (0 / 0.1 / 0.25 / 0.5 / 0.75 / 1 / 1.5 / 2 s).
- "Edited" badges: watch chapters menu header, music drill header, the editor header.

## Acceptance criteria (each names its binding test)

- AC1 GET seeds from storage: one row per stored chapter, version, source; suggestions only once the
  silence is cached for THIS file. (chapter-snap.test.js "seed from STORAGE")
- AC2 TIMES ONLY: a like on `::c3` (admin) and `::c1` (member) name the same songs after save and
  after revert; `/api/music` ids unchanged, new `chapterStartSec`; titles are the stored ones.
  (chapter-snap.test.js HEADLINE)
- AC3 Refusals store nothing: count +/-, reorder, equal starts, chapter-1 move, past the end,
  non-number, bad/missing version; a titles smuggle is ignored. (chapter-snap.test.js "refusals";
  chapter-snap-core.test.js validateSnapStarts)
- AC4 Stale seed: a text-editor save after the snap editor opened wins; the snap save 409s.
  (chapter-snap.test.js "stale seed"; chapter-snap-editor-ui.test.js "STALE seed")
- AC5 TOCTOU: two saves from the same seed fired together -> exactly one 200, one 409, the winner
  stored, provenance = the original source. (chapter-snap.test.js "racing saves")
- AC6 Revert from STORAGE after a real reheat moved a source time; a source count change 409s until
  `allowCountChange`. A typed list that was snapped reverts to the typed times.
  (chapter-snap.test.js "revert seeds from STORAGE", "revert of a TYPED list")
- AC7 Rescan keeps the edit + provenance and the cached silence; a changed file makes the cache
  stale (no suggestions) while the edit is carried forward. (chapter-snap.test.js "a RESCAN")
- AC8 RBAC: 403 without modify on all four routes; 404 for a folder-restricted member on all four
  and no scan started; lifted -> 200; NUL id 404. (chapter-snap.test.js "RBAC"; the route
  censuses route-write/read-classification + rbac-census 246 -> 250)
- AC9 Silence scan: REAL ffmpeg over a generated tone/silence/tone file -> 2 gaps, suggestions
  'silence' and 'tail' at ~7.75 / ~15.75, save lands in `/api/music`, a second scan answers from the
  cache. (chapter-snap.test.js REACHABILITY; skips when no ffmpeg - run with FILETUBE_TEST_FFMPEG)
- AC10 Cache/runner: sha256 filenames, NUL/empty refused, joined runs, busy cap, size OR mtime
  change -> stale, changed-during-scan not cached, timeout SIGKILL, ENOENT/exit messages without the
  path. (chapter-snap-core.test.js)
- AC11 Backup: the edit + provenance ride the bundle and restore revertible.
  (chapter-snap.test.js "the BACKUP bundle")
- AC12 Lead-in: admin-only, 0-2, moves the suggestions. (chapter-snap.test.js "the scan route")
- AC13 Editor UI against the real server: rows/focus/no nudges on chapter 1/Snap all -> Save;
  nudge clamps; stale refused; revert via the in-page confirm (both axes, window.confirm never);
  dirty cancel asks; entry 4 opens the SAME editor and refuses over unsaved typing.
  (chapter-snap-editor-ui.test.js)
- AC14 Music entry points through REAL music.js: both Extras writers offer "This chapter starts
  wrong" at the playing chapter, hidden for a non-modifier and a plain file; the drill "Fix times"
  opens on the FILE, hidden for a non-modifier / non-chapter album; a save patches the queue so the
  display follows the NEW boundary; badge reveal AND clear. (chapter-snap-client.test.js)
- AC15 Watch entry inside the write-RBAC arm; a save rebuilds the menu and drops the loop.
  (chapter-snap-client.test.js "watch (3)"; reachability in real Chromium by the probe)
- AC16 Phone: 390x844 every editor button >= 44x44, no sideways scroll, nothing past the
  viewport. (scripts/chapter-snap-probe.js, numbers below)

## Build record

### Commit 1 (the build)

Files:
- NEW `lib/media/chapterSnap.js`, `lib/media/chapterSilence.js`, `lib/media/chapterSnapRoutes.js`.
- `server.js`: lead-in default; routes registration + `chapterSilenceService` export;
  `chaptersSnapEdited` dep to the browse routes; `itemChapterTracks` marks `chaptersEdited`;
  `publicTrackListItem` passes it; `chapterSnap` dep to the settings routes.
- `lib/media/routes.js`: `chaptersEdited` on GET /api/videos/:id.
- `lib/config/routes.js`: the `chapterSnapLeadInSec` setting.
- `public/js/common.js`: `showChapterSnapEditor` + `formatSnapTime` / `clampSnapNudge` /
  `snapChipText`; the text editor's "Fix times..." (entry 4); exports.
- `public/js/player.js`: "Fix chapter times..." + the "Edited" badge (entry 3); the text editor
  callback carries `chaptersEdited`.
- `public/js/music.js`: drill "Fix times" + badge (entry 1); Extras `onChapterSnap` on both writers
  (entry 2); `applySnappedChapterTimes` (the re-register seam).
- `public/js/skin-surface.js`: the Extras row + dispatch; the sticker forwarder carries the hook.
- `public/setup.html`, `public/js/setup.js`: the lead-in select.
- `public/css/style.css`: `.chapter-snap-*` (phone sheet, 44 px targets, split clip/scroll),
  `.chapters-menu-edited`, `.music-drill-edited`.
- `scripts/chapter-snap-probe.js`: the measurement instrument.
- Tests: NEW test/unit/chapter-snap-core.test.js (15), test/unit/chapter-snap-client.test.js (8),
  test/integration/chapter-snap.test.js (12), test/integration/chapter-snap-editor-ui.test.js (6);
  census updates: route-write-classification (+3 library-write/enforced), route-read-classification
  (+1 GATED), rbac-census 246 -> 250, database.test.js + settings-cache-api.test.js (the new key),
  player-chapters-parity.test.js (the v1.109 lock now bounded by the SEMANTIC unit - it was a
  7600-character window the builder outgrew).
- docs/exec-plans/tech-debt-tracker.md #239-#241.

Commits: **4346aa13** (the build; pre-commit hook: `tests 7124 pass 7124 fail 0`), **8dadd459**
(test/unit/chapter-snap-routes.test.js - the post-await re-checks with injected deps; hook `tests
7126 pass 7126 fail 0`), **c1a3be59** (mutant round 1 fixes, below; hook `tests 7126 pass 7126 fail
0`).

Instrument outputs (verbatim, Node 22.23.1, at c1a3be59):
- `npm run lint`: `✖ 6 problems (0 errors, 6 warnings)` - all pre-existing `no-unused-vars`
  warnings in public/js/common.js (setTheme, homeFeedEnabled, setIconSet, addToQueue,
  openTranscriptFor, shareExternalUrl), none in code this branch wrote.
- `npm run lint:css`: `TOTAL 0  (the token census; ceiling ZERO since v1.61.0)`.
- `node scripts/overlay-containment-lint.js --enforce`: `overlay-containment: clean (0 violations)`.
- `bash .harness/lib/check-markers.sh`: `✗ ...2026-09-24-chapter-snap.md: stale approval @ecb61e1d
  - reviewed code changed since; re-gate` / `check-markers: 1 issue(s) found` - expected while
  Building (the design line binds Dean's intake to the base sha; the gate re-binds at the reviewed
  sha - the chapter-likes plan carried the same flag).
- Targeted suites (never the full `npm test`, per the wave cadence):
  - new files: chapter-snap-core 15/15, chapter-snap-client 8/8, chapter-snap-routes 2/2,
    chapter-snap (integration) 12/12 WITH `FILETUBE_TEST_FFMPEG=<static ffmpeg 7.0.2>` and
    `pass 11, skipped 1` without (the REAL-ffmpeg test skips by name), chapter-snap-editor-ui 6/6.
  - the touched-surface unit batch (music*, skin*, player*, modal*, setup*, chapter*, listen*,
    card-like, overlay*, css*, route*, common*, database, exec-plans-census, docs*,
    tech-debt-census, comment-debt-census, shell*, *parity*): `tests 1740 pass 1740 fail 0`.
  - the related integration batch (chapter*, rbac*, route*, settings*, backup*, music*, liked*,
    api): `tests 262 pass 261 fail 0 skipped 1` (the skip = the REAL-ffmpeg test without ffmpeg).

## Measurements

`FT_PROBE_AUDIO=<a 300 s real mp3> node scripts/chapter-snap-probe.js <out>` (headless Chromium
chromium-1234 over CDP, the action-row-probe pattern), 8 chapters with long titles, a seeded silence
cache, the editor REACHED through the real UI each time (watch: chapters menu -> "Fix chapter
times..."; music: album card -> drill "Fix times"). Verbatim numbers:

| Surface @ viewport | modal | doc scrollWidth | list scroller (sW / cW) | buttons | min button | < 44 px | past viewport | time font |
|---|---|---|---|---|---|---|---|---|
| watch 390x844 (DPR 2, mobile) | 0,0 390x844 (full sheet) | 390 | 370 / 370 (scrollH 1635 in 640) | 47 | 88x44 | 0 | 0 | 16 px |
| watch 390 after Snap all | same | 390 | 370 / 370 | 40 | 88x44 | 0 | 0 | 16 px |
| music drill editor 390x844 | 0,0 390x844 | 390 | 370 / 370 | 47 | 88x44 | 0 | 0 | 16 px |
| watch 1440x900 | 340,16 760x868 | 1440 | 726 / 726 (scrollH 832 in 668) | 47 | 52x36 | 47 (desktop: 36 px mouse targets, by design) | 0 | 14 px |
| music drill editor 1440x900 | 340,16 760x868 | 1440 | 726 / 726 | 47 | 52x36 | 47 (desktop) | 0 | 14 px |

- Entry reachability in the real browser: `watch 390: {"entry":"reached"}`, `watch 1440:
  {"entry":"reached"}` (the menu entry exists and opens the editor); the drill's `.music-drill-snap`
  present at both widths.
- Audition (Play from here, chapter 2, boundary 241.5 s) with a REAL mp3:
  `music-audition 390: {"audio":true,"paused":false,"currentTime":243.8,"rowPlaying":true,"boundary":241.5}`
  and `music-audition 1440: {... "currentTime":243.9 ...}` - the editor's own element seeked to the
  boundary and was playing 2.5 s later.
- Drill action row BEFORE (ecb61e1d sandbox, `FT_ROOT=`) vs AFTER - pre-existing buttons
  byte-identical, the new one never deforms them:
  - 390 before: play 16,617 70x44 | shuffle 94,617 86x44 | chapters 188,617 123x44
  - 390 after: play 16,617 70x44 | shuffle 94,617 86x44 | chapters 188,617 123x44 | **snap 16,669 80x44** (wraps to a second row)
  - 1440 before: play 450,367 70x28 | shuffle 528,367 86x28 | chapters 622,367 123x28
  - 1440 after: the same three + **snap 752,367 80x28** (same row)
- Screenshots (session scratchpad, not committed):
  `/tmp/claude-1000/-home-coder-projects-filetube/4f1ee65c-e69b-47c1-b17f-32437e44eb7b/scratchpad/chapter-snap-shots/`
  `chapter-snap-watch-390.png`, `chapter-snap-watch-390-snapped.png`, `chapter-snap-drill-390.png`,
  `chapter-snap-music-390.png`, and the same four at 1440; the BEFORE drill at
  `.../scratchpad/chapter-snap-shots-base/chapter-snap-drill-{390,1440}.png`.

## Mutant table

Runner: a scratchpad script that edits ONE file in a sandbox built from an archive of the
committed sha (+ a node_modules symlink), asserts the anchor matched exactly once and the bytes
changed, runs the named binding tests, and restores. RED = a failing or cancelled test (`not ok`).

**Round 1 @8dadd459** - 33 RED, 5 survivors, each closed at c1a3be59:
- M8 / M8b (either pre-await visibility check removed) SURVIVED: the gate checked visibility twice
  on the same cached record. Fixed by keeping ONE (the text editor's `restrictedVideoMutation`);
  the in-tick re-check stays (M6).
- M13 (cache ignores mtime) and M13b (ignores size) SURVIVED: every test changed both. The service
  test now moves each axis ALONE with the other held equal to the record.
- M17 (parser trusts any stderr line) SURVIVED: the trap line was overwritten by a later real
  start. A mid-stream non-detector line after the last gap now binds it.
- M38 (the text editor callback forgets `chaptersEdited`) SURVIVED: now asserted by the watch
  source lock.
- M18 (timeout never kills) was reported green by a runner miscount (the test is CANCELLED - its
  promise never settles - not passed); the runner now counts any `not ok`.

**Round 2 @c1a3be59 - 38 of 38 RED** (the runner's bytes before -> after proved each edit landed):

| # | Mutant | File | Binding test that reds |
|---|---|---|---|
| M1 | count check removed | chapterSnap.js | chapter-snap.test.js refusals |
| M2 | strictly increasing -> non-decreasing | chapterSnap.js | core validateSnapStarts |
| M3 | chapter-1 check removed | chapterSnap.js | refusals |
| M4 | end-of-file check removed | chapterSnap.js | refusals |
| M5 | version compare removed | chapterSnapRoutes.js | refusals, stale seed, racing saves, routes TOCTOU (4 fail) |
| M6 | in-tick visibility re-check removed | chapterSnapRoutes.js | routes "a restriction that lands between the gate and the write tick" |
| M7 | requireModifyLibrary removed | chapterSnapRoutes.js | RBAC 403 |
| M8 | restrictedVideoMutation removed | chapterSnapRoutes.js | RBAC 404 |
| M9 | re-edit uses the current times as the base | chapterSnap.js | core buildSnappedManual |
| M10 | typed-base revert drops the list | chapterSnapRoutes.js | "revert of a TYPED list" |
| M11 | revert count-change guard removed | chapterSnapRoutes.js | "revert seeds from STORAGE after a REHEAT" |
| M12 | no re-stat after the ffmpeg await | chapterSilence.js | core "changes WHILE ffmpeg reads it" |
| M13 | cache ignores mtime | chapterSilence.js | core service (mtime alone) |
| M13b | cache ignores size | chapterSilence.js | core service (size alone) |
| M14 | no join of an in-flight run | chapterSilence.js | core service "ONE run" |
| M15 | queue cap removed | chapterSilence.js | core service busy |
| M16 | cache NUL refusal removed | chapterSilence.js | core cache |
| M17 | parser trusts any line | chapterSilence.js | core parser edges |
| M18 | timeout never kills | chapterSilence.js | core runSilenceDetect (cancelled) |
| M19 | Extras row ignores canModify | skin-surface.js | client "hidden for a viewer who may not modify" (both writers) |
| M20 | sticker forwarder drops the hook | skin-surface.js | client sticker "opens the ONE editor" |
| M21 | desktop writer drops the hook | music.js | client desktop (2 fail) |
| M22 | the seam skips reflectChapter | music.js | client RE-REGISTER |
| M23 | the seam does not patch the queue | music.js | client RE-REGISTER |
| M24 | drill Fix times ungated | music.js | client drill non-modifier |
| M25 | watch entry outside the RBAC arm | player.js | client watch (3) |
| M26 | revert skips the in-page confirm | common.js | editor-ui revert |
| M27 | text-editor dirty guard removed | common.js | editor-ui entry point 4 |
| M28 | stale seed keeps Save enabled | common.js | editor-ui STALE seed |
| M29 | nudge lower clamp removed | common.js | editor-ui nudge |
| M30 | dirty Cancel closes without asking | common.js | editor-ui dirty Cancel |
| M31 | settings accepts any lead-in | lib/config/routes.js | "the scan route ... lead-in" |
| M32 | GET detail never Edited | lib/media/routes.js | HEADLINE |
| M33 | music rows never Edited | server.js | HEADLINE |
| M34 | scan route runs for a one-chapter item | chapterSnapRoutes.js | "the scan route" |
| M35 | snap-all ordering guard removed | chapterSnap.js | core snapAllStarts |
| M36 | lead-in not subtracted | chapterSnap.js | core + integration (7 fail) |
| M37 | save skips validation | chapterSnapRoutes.js | refusals |
| M38 | text-editor callback forgets chaptersEdited | player.js | client watch (3) |

Reachability mutant (REAL ffmpeg, run by hand in the c1a3be59 sandbox with
`FILETUBE_TEST_FFMPEG`): the `silence_end:` regex broken -> `not ok 1 - REACHABILITY ...` (`pass 0
fail 1`); the unmutated control `ok 1 - REACHABILITY` (`pass 1 fail 0`). The real detector output
reaches the suggestions; a parser that cannot read it reds.

## Disclosed gaps

- #239 the silence cache is never pruned (orphans on delete/move; tiny, never misread).
- #240 the mockup's waveform overview + tap-to-place close-up are not built (the list editor with
  buttons covers every action; phone-first).
- #241 the "Edited" badge is on the watch menu, the drill header and the editor, not in the music
  skins' chapter lists or Up next.
- A text-editor save of a snapped item KEEPS the provenance when it changes titles only (the
  same count, and every start within 0.5 ms of the stored one), so "Edited" and Revert survive a
  rename. Any time or count change makes a plain typed list with no provenance, and the badge and
  Revert go away. A text save of a snap edit must carry the version (gate r2 R5). Revert keeps
  the stored titles while the count is unchanged (gate r2 R2). (Corrected at gate r2, qa W1: this
  line used to say every text save dropped the provenance.)
- Revert of a `description`/`embedded` base lands on the source AS STORED NOW; when the source's
  count changed since, it needs an explicit yes (the confirm says liked chapters can move).
- The silence scan needs ffmpeg on the server (the Docker image has it); without it the editor says
  so and still offers the nudges. CI runs the REAL-ffmpeg test only where ffmpeg exists (else it
  SKIPS by name); this box has none installed - it was run with the Playwright-cache static ffmpeg
  7.0.2 via FILETUBE_TEST_FFMPEG.
- "Chapter 1 always stays at 0:00" is enforced as "chapter 1 keeps its stored start" (a source
  whose first chapter starts later is left alone, never moved to 0).

## Gate verdicts

(reserved for the Architect's gate rounds)

## Gate r1 - security-brief (@7aa10540)

**Gaps, stated first:** this seat has no Bash, so I could NOT run `git diff ecb61e1d..7aa10540`,
any test, or ffmpeg. The reviewed sha is verified only by reading the ref file
(`.git/refs/heads/feat/chapter-snap` = 7aa10540b40a..., worktree HEAD -> that ref). I could not
check for uncommitted changes in the worktree. I reviewed by reading the new files whole
(`lib/media/chapterSnap.js`, `chapterSilence.js`, `chapterSnapRoutes.js`), the server.js /
lib/config/routes.js / lib/media/routes.js touch points, the client editor (common.js
12901-13459) and the new music/player/skin-surface/setup call sites. The ffmpeg stderr claims
in S-1 are reasoned from ffmpeg's metadata dump (libavformat dump.c), not run.

Verified by tracing the code:
- **Route gates.** All four routes go through `gate()`: `requireModifyLibrary` (403) FIRST, then
  `restrictedVideoMutation` (404, `mediaVisibleTo` on the cached record), then NUL/empty id and an
  own-property lookup (404). Same predicates, same order, same gate KIND as POST
  `/api/videos/:id/chapters` (routes.js:1847-1849). Save and revert re-fetch the item INSIDE the
  synchronous `updateDatabase` mutator and re-run `mediaVisibleTo` + the version compare there, so
  a restriction or edit that lands during the await is honored. The RBAC test binds the kind with
  `{kind:'folder'}` (media-only) and asserts no scan starts for a restricted member. Routes are
  registered after the global `authGate`, the audit middleware and the READONLY verb guard; no
  `/api/videos/:id/:param` catch-all shadows them.
- **Leaks.** The GET returns titles/times/silence counts only for an item that passed both gates;
  suggestions expose silence bounds only for that item. The cache is unreachable from any route
  except through the gated GET. No list/aggregation surface was added; the `chaptersEdited` flag
  rides the already-RBAC-filtered `/api/videos/:id` and music projections.
- **Body validation.** `starts` must be an array of at most 300; each element `typeof number`,
  finite, >= 0 (JSON `1e999` -> Infinity is refused); version must be a string equal to the fresh
  hash; `allowCountChange === true` strictly. Titles come from storage, never the body. Nothing
  from the body is merged into an object, so `__proto__` keys are inert. The global JSON parser's
  100 kb cap applies.
- **Lead-in setting.** POST /api/settings is `requireAdmin`; the key is in KNOWN_KEYS, validated
  number in [0, 2], rounded; the response and the snap reader both clamp (`clampLeadIn` falls back
  to 0.25 for a non-number), so a generic backup-restore write cannot inject a bad value. The
  test binds 403 for a canModifyLibrary member.
- **ffmpeg spawn.** argv array, no shell; the input path is `item.filePath` from the stored record
  only (never the request); `path.isAbsolute` + NUL refusal mean it cannot start with `-` or a
  `proto:` prefix; stdin ignored and `-nostdin`; SIGKILL at 2-30 min; one run server-wide, queue
  cap 8 (-> 429), one run per item (joins). `statOf` requires a regular file. Partial line bounded
  at 64 KiB, tail at 1 KiB, events capped. The stderr tail goes to the server log only.
- **Cache file.** Name is `sha256(id).json` inside a fixed dir: no id byte reaches the path, so
  traversal is impossible. Atomic tmp+rename (rename replaces a symlink rather than following it).
  A tampered/garbage record fails `JSON.parse` or the `mediaId` / `Array.isArray` / params+size+
  mtime checks and reads as null/stale. Only an actor who already owns DATA_DIR can tamper.
- **Client.** Every server string (chapter titles, item title, error messages) is written with
  `textContent`; the music drill / Extras / watch-menu additions are static HTML with no
  interpolated data. No XSS path found from an uploader-controlled chapter title.
- **Backup.** The silence cache is correctly OUT of the bundle (derivable). `snapFrom`/`snapBase`
  ride inside `chaptersManual` verbatim; a hand-tampered bundle (admin-only restore) can at worst
  produce a list that `isSnapEdited` rejects (no Revert offered), a `damaged` revert (409), or a
  save that `validateSnapStarts` refuses. No crash path found for a well-formed record;
  `editorRows` indexes `chaptersManual[i]` only when resolved === chaptersManual (same array), so
  the indices align.

Findings:

- **S-1 LOW (fix or accept with rationale): the silence parser trusts uploader-controlled
  metadata, and its comment says it does not.** `parseSilenceLine` (chapterSilence.js:62-72)
  accepts any stderr line that merely CONTAINS `[silencedetect`; the comment claims "any other line
  naming the words (a file title in the banner, say) is ignored". At `-v info` ffmpeg prints the
  input's metadata (title, description, chapter titles) to stderr before any filter output, and
  continuation lines of a multi-line value are printed on their own lines. FileTube's yt-dlp
  downloads run with `--embed-metadata --embed-chapters` (lib/ytdlp/args.js:1219), so a YouTube
  uploader controls those strings. Scenario: an uploader puts
  `[silencedetect @ 0x1] silence_start: 118` / `[silencedetect @ 0x1] silence_end: 125` lines in a
  description; Dean downloads it, opens Fix times; the fake gaps become "Snap to" suggestions and
  feed Snap all. Outcome: chapter boundaries steered by a third party IF the user accepts and saves;
  times only, bounded by the neighbours, revertible, never count/order. Hence LOW, not higher. The
  comment is a stale security-relevant claim. Prescription: anchor the match at line start, e.g.
  `^\[silencedetect @ [^\]]*\] silence_(start|end):\s*NUM` (metadata lines are indented, and
  ffmpeg prefixes every continuation line of a value), correct the comment, and bind it with a unit
  line shaped like ffmpeg's metadata dump (`    title           : [silencedetect @ 0x1]
  silence_start: 5`) plus the REAL-ffmpeg reachability test to prove the anchor still reads real
  output.
- **S-2 INFO: a cache-write fs error reaches the client with the DATA_DIR path.** The service's
  catch (chapterSilence.js:272-273) stores `err.message` from ANY throw, including `cache.write`
  (e.g. `EACCES: permission denied, open '/data/.chapter-silence/<hash>.json.<pid>.<ms>.tmp'`), and
  GET returns it as `silence.error`. Only a canModifyLibrary user sees it, and it is the server's
  own data path, so this is advisory. The runner's "no path" comment is accurate for the runner
  itself. If touched: map a non-runner error to a fixed message and log the detail.
- **S-3 INFO: cache read has no size cap and does not shape-check each silence.** A hand-edited
  cache file with a non-object element makes `suggestSnaps` throw (GET 500). Requires write access
  to DATA_DIR (already total control), so advisory only.
- **S-4 INFO: scan cost is bounded but not small.** A modifier can queue 8 scans at up to 30 min
  each, run one at a time. Appropriate for a solo self-hosted box; noted, no change asked.

No CRITICAL or HIGH. S-1 is the only item I would ask to be fixed (cheap, and it corrects a
lying comment); accepting it with a written rationale is also within the rules for LOW.

Gate: APPROVED r1 @7aa10540 — security-brief

## Gate r1 - adversary (@7aa10540)

Instruments, verbatim (Node 22.23.1, FILETUBE_TEST_FFMPEG = the static ffmpeg 7.0.2):
- The 5 chapter-snap files at 7aa10540: `# tests 43 # pass 43 # fail 0 # skipped 0`.
- The census/related batch (rbac-census, route-read/write-classification, settings-cache-api,
  database, player-chapters-parity, chapters-editor): `# tests 106 # pass 106 # fail 0`.
- I re-ran 6 of the claimed mutants in a /tmp sandbox built from `git archive 7aa10540` (the
  version compare, the in-tick visibility check, the revert count guard, the seam's
  reflectChapter, the re-stat after await, mtime ignored). All 6 went RED on the named test.
- 11 mutants the plan does NOT claim: **7 SURVIVED** (MA, MB, MC, MD, ME, MG, MH below), 4 RED
  (suggestSnaps crossing guard, isSnapEdited mixed base, cache mediaId check, the runner's
  absolute-path guard).
- Held, by measurement: a like on `::c3` and the file's progress (190 s) through a snap save, a
  REAL rescan, a REAL `recordRepulledItemMeta` reheat and a revert. GET /api/liked still says
  "Fourth Song" at 184.75 and then 180, and progress stays 190. A `::c3` progress POST returns 404,
  so no per-chapter progress row can exist. Validation refuses null, negative, bool, object,
  1e308, 301 elements, sub-millisecond ties (60.0001/60.0004), and a non-string version. The ids
  `__proto__`, `constructor`, `toString`, `hasOwnProperty`, `<id>::c3` and NUL return 404 on all
  four routes. A truncated cache, another detector's params, non-array silences and an
  mtime-only change read as none/stale/none/stale, and a restart re-scans.

Findings:

1. **WARNING: the text editor is a LOSSY projection of the new sub-second chapter data, so a
   title-only fix silently rewrites the snap edit. In one reachable case it DROPS a chapter and
   re-points a like.** Both text-editor seeds FLOOR to whole seconds: player.js
   `formatDuration` and music.js `chapterStamp`. The grammar (`CHAPTER_LINE`) cannot express a
   fraction, and `finalizeChapters` dedups equal starts. Measured through the real routes:
   - A1: snap all to [0, 61.75, 120, 184.75, 240], then open the editor with the player.js seed
     and rename "Closer". Stored becomes [0, 61, 120, 184, 240]. The provenance is gone:
     `edited:false, revert:null`.
   - A1b: the nudges allow a 0.1 s gap (`clampSnapNudge` GAP), so save [0, 120.2, 120.9, 180,
     240]. The seed shows "2:00 Second Song / 2:00 Third Song". After an unchanged text save the
     stored list has **4 chapters, and the like on `::c3` now names "Closer" (it was
     "Fourth Song")**.

   The plan's disclosed gap only mentions dropping the provenance. It does not mention flooring
   the times or losing a chapter. This is the v1.273 class ("seed a destructive editor from
   storage, not a lossy projection"). Prescription: make the seed lossless (`m:ss.mmm` when a
   start has a fraction) and let `CHAPTER_LINE` accept an optional `.d{1,3}`. Bind it with A1 and
   A1b as integration tests, and add a mutant that floors the seed.
2. **WARNING: the revert consent is not bound to what it consents to. The version token ignores
   the revert TARGET, and the route comment claiming "a reheat is refused with 409" is false for
   revert.** `chaptersVersion` hashes the manual list and the resolved list, and under a snap
   edit the resolved list IS the manual list, so `item.chapters` (the revert target) is not
   hashed. The client pre-sends `allowCountChange: true` from the GET-time count
   (`doRevert(state.revert.count !== rows.length)`). Measured (A2):
   - Snap the 5-chapter item.
   - The source becomes 6 chapters, and GET revert reports `{count:6}` (this is what the confirm
     names).
   - The source becomes 2 new songs. The version is unchanged (`same? true`).
   - POST revert with the old version and `allowCountChange:true` returns **200 and lands on
     [X, Y]**. The like on `::c3` is no longer listed.

   Prescription: fold the revert plan's target into `chaptersVersion` (e.g. hash
   `planRevert(...).chapters`), or send and compare the expected `to` count. Also fix the comment
   at chapterSnapRoutes.js:17-20. Bind it with A2.
3. **WARNING (a surviving mutant on a data-class guard): the revert count guard is bound on ONE
   axis.** MA `plan.count !== from` -> `plan.count < from` SURVIVED 43/43. Only the decrease
   (5 -> 4) is tested, so a reheat that ADDS chapters is unbound. Add the increase axis.
4. **WARNING: a snap save on the WATCH page leaves the seek-bar chapter notches at the OLD
   boundaries.** Measured in headless Chromium (chromium-1234, a real 60 s mp3, chapters 0/20/40,
   chapter 2 nudged +5 s through the real menu entry and Save): notches before
   `["33.3333%","66.6667%"]`, stored `[0,25,40]`, notches after **`["33.3333%","66.6667%"]`**
   (41.67% expected). The onSaved rebuilds only the menu. `applyChaptersForMedia` is the
   seam that also runs `buildSeekChapters()`, resets `currentChapterIdx` and runs
   `refreshCurrentChapter()`. This is the "a display that moves without a reload must
   re-register" class. The pre-existing text-editor callback (player.js:6861) has the same gap.
   Prescription: route both callbacks through `applyChaptersForMedia(currentData)` (keeping the
   Edited flag). The watch "Edited" badge showed the right value both times I measured (after
   save `true`, after revert `false`).
5. **WARNING: a count-changing revert from Music patches the queue IN PLACE, so ghost and
   mis-titled rows survive.** Measured through the real music.js harness: a drill with
   c0/c1/c2 gets the consented 3 -> 2 revert body. The rows are still `f1::c1 | Second Song
   1:30`, which the server now calls "Closer", and `f1::c2 | Closer 1:00`, a chapter that no
   longer exists. A Like tapped on the "Second Song" row stores `f1::c1` = Closer.
   `applySnappedChapterTimes` patches only start and span, never the title or the count. The
   text-editor path re-fetches for exactly this reason (music.js 2627ff). Prescription: re-fetch
   (loadSongs) on any revert, or whenever `body.chapters.length` differs from the file's queued
   chapter count, then run reflectChapter.
6. **WARNING (concurring with security-brief S-1, now MEASURED): uploader metadata forges
   silences.** I made a 30 s CONTINUOUS tone (no silence) with the title
   `[silencedetect @ 0x1] silence_start: 5` and a multi-line comment carrying start 10 / end 12,
   then ran the REAL `runSilenceDetect` over it. It returned
   **`[{"start":10,"end":12},{"start":10,"end":12}]`**. ffmpeg echoes the metadata to stderr
   (`                    : [silencedetect @ 0x1] silence_start: 10`), and the parser's "a file
   title in the banner is ignored" comment is false. M17 "parser trusts any line" is killed only
   for a non-`[silencedetect` line. Prescription: anchor the match at the line start
   (`^\[silencedetect @ [^\]]*\] silence_(start|end):`), bind it with the metadata-dump line
   shape, and re-run REACHABILITY.
7. SUGGESTION (surviving mutants, each one is its own repro):
   - MB: dropping the seam's `m[1] !== String(baseId)` means a save for file A rewrites file B's
     queued chapter starts. It survives because the fixture queues only one chaptered file.
   - MC: removing the revert `plan.damaged` guard survives.
   - MD: replacing the one-week cap with Infinity for an unknown duration survives. The plan
     names this cap as an invariant.
   - ME: removing `clampSnapNudge`'s upper clamp survives.
   - MG: removing the poll's stale-version check survives.
   - MH: dropping the Extras item-id guard in `extrasChapterSnapIndexFor` survives.
8. SUGGESTION (enumeration sibling, pre-existing): POST /api/videos/:id/chapters carries no
   version token. A text editor opened before a snap save still overwrites that snap wholesale
   when saved later. The snap routes are the only writers of `chaptersManual` with optimistic
   concurrency.

Writers of `chaptersManual`:
- the text route (routes.js:1872-1874);
- the two snap routes;
- the scan re-init (orchestrator.js:1122-1124) and Phase-2 mirror (:1432-1436), both verbatim;
- move.js:489, which re-keys the whole item;
- backup restore and trash, both verbatim.

Readers: `resolveItemChapters`, `isSnapEdited` and the watch.js strip. Only the text route (as a
writer) and the text editor seed (as a reader) strip or corrupt the provenance and the times;
that is finding 1.

Tree: the review sandbox and my probe temp dirs are removed. Apart from this appended section
(and the qa/security-brief sections other seats append), `git status` is clean. The pre-existing
untracked `node_modules` symlink was left untouched.

Gate: CHANGES r1 @7aa10540 — adversary

## Gate r1 - qa (@7aa10540)

Reviewed `git diff ecb61e1d` at 7aa10540 (27 files), all of it. Instruments, run by this seat
(Node 22.23.1, `FILETUBE_TEST_FFMPEG` = the scratchpad static ffmpeg 7.0.2):
- new + touched files (chapter-snap-core, -client, -routes, chapter-snap, chapter-snap-editor-ui,
  player-chapters-parity, database, settings-cache-api): `tests 135 pass 135 fail 0 skipped 0`
  (the REAL-ffmpeg REACHABILITY test ran: `ok 17 - REACHABILITY ...`).
- censuses (rbac-census, route-read/write-classification, comment-debt, css-token-lint,
  exec-plans, overlay-containment, tech-debt): `tests 52 pass 52 fail 0`.
- `npm run test:unit`: `tests 7126 pass 7126 fail 0 cancelled 0 skipped 0`.
- `npm run lint:css`: `TOTAL 0`; `overlay-containment-lint --enforce`: `clean (0 violations)`;
  eslint on the changed .js: `6 problems (0 errors, 6 warnings)`, all pre-existing no-unused-vars
  in common.js (none in new code).
- `scripts/chapter-snap-probe.js` in a `git archive 7aa10540` sandbox (/tmp) with a real 300 s mp3:
  the plan's table REPRODUCES - 390x844 watch + music editor: 390x844 sheet, doc scrollWidth 390,
  scroller 370/370, 47 buttons, min 88x44, 0 below 44, 0 past viewport, 16 px times; 1440:
  52x36 min (desktop by design), 0 past viewport; entry `reached`; audition
  `{"paused":false,"currentTime":242.4,"rowPlaying":true,"boundary":241.5}`. Extra widths: 320x844
  settles at 0 below 44 / 0 past viewport (its FIRST reading caught the open animation: 310x819,
  43 px - the probe's 500 ms settle is not always enough).

Findings:

1. **WARNING - "Snap all" silently throws away the user's own nudges and counts them as "starts
   that look off".** public/js/common.js:13067 `pendingSnaps` and :13342 the Snap all handler
   compare/overwrite EVERY row with `state.snapAll`, which the server computed from the STORED
   starts, so a deliberate nudge on a no-gap row (or a fine-tune after a Snap to) reads as
   "pending" and is reset. VERIFIED in the sandbox (jsdom against the real server, the editor-ui
   fixture: silences at 58-62 and 183-185, five chapters): before `Snap all (2)`; nudge chapter 3
   (no gap) +1 s -> `Snap all (3)`, status `3 starts look off`; tap Snap all -> times
   `0:00.0 1:01.8 2:00.0 3:04.8 4:00.0` (chapter 3 back to 2:00.0), status `Snapped 3 starts`;
   Save stores `[0,61.75,120,184.75,240]` - the correction the user made after auditioning is
   lost while the UI says it snapped it. Fix: Snap all applies only rows whose suggestion is
   `suggest` and whose time is still untouched (== savedStart), ordering-checked against the
   CURRENT neighbour times; `pendingSnaps` counts the same set. Bind: nudge a no-gap row, Snap
   all, assert the nudge survives and the count excludes it.

2. **WARNING - a watch-page save leaves the seek bar's chapter notches on the OLD boundaries and
   the current-chapter label/highlight stale while paused; the comment claims otherwise and the
   seam is bound only by a source regex.** public/js/player.js:6899 `openChapterSnapFromMenu`
   onSaved rebuilds the menu and drops the loop but never calls `buildSeekChapters()` nor resets
   `currentChapterIdx` + `refreshCurrentChapter()` - the set `applyChaptersForMedia` (:7059) runs
   for every chapter-set change ("the seat that forgot to CALL the shared helper"). VERIFIED in
   headless Chromium (sandbox, the probe's audio item on /watch.html, paused at 241.8 s, Snap all
   -> Save; stored `[0,242.25,...]`): notch before `80.5%`, after `80.5%` (should be 80.75%);
   label + menu still `Sodium Lamps...` (chapter 2) though 241.8 < the new 242.25. Paused is the
   NORMAL state here: the audition pauses the player (`pauseOtherMedia`). The comment at
   player.js:6898 ("the menu, the loop and the current-chapter highlight re-derive from the new
   list") is false for the highlight. The text-editor callback (openChaptersEditorFromMenu) has
   the same pre-existing gap and entry 4 now routes a snap save through it. AC15's binding
   (chapter-snap-client.test.js "watch (3)") is a regex over UNSTRIPPED player.js - a commented
   out `// chapterLoop = null;` still matches - and the probe never saves on the watch page. Fix:
   route both callbacks through `applyChaptersForMedia(currentData)` (or call the same helpers),
   and bind the save seam behaviorally (notch position + label after a save while paused).

3. **WARNING - the silencedetect parser trusts any line CONTAINING `[silencedetect`, and its
   comment says the opposite.** lib/media/chapterSilence.js:62-66 claims "any other line naming
   the words (a file title in the banner, say) is ignored", but the test is an unanchored
   `indexOf`. VERIFIED with the real ffmpeg 7.0.2: a tone|silence|tone mp3 re-tagged
   `title="[silencedetect @ 0x1] silence_start: 1"`, `artist="[silencedetect @ 0x1] silence_end:
   3.5"` -> `runSilenceDetect` resolves `[{"start":1,"end":3.5},{"start":5,"end":7}]` - a gap that
   does not exist, which can win the nearest-silence pick and drive a Snap to / Snap all
   suggestion (and is cached). M17 binds a different shape (a line WITHOUT the marker). Fix:
   anchor at line start, e.g. `/^\[silencedetect @ [^\]]*\] /`, and add the banner-tag line to
   the parser-edge test. (Not a security issue - suggestions only, reviewed before save.)

4. SUGGESTION - landscape phone gets the desktop sizing. The touch sizing is `max-width: 600px`
   only (style.css:7476). Measured (probe variant, 844x390, mobile emulation, DPR 2): 47 buttons
   at 36 px (47 below 44), the chapter list viewport 158 px tall (about one row). Portrait
   390x844 (Dean's stated measure) is correct; consider `(max-width: 600px), (max-height: 500px)`
   for the 44 px targets and the full sheet.

5. SUGGESTION - the poll can stall with no way out. common.js:13205 re-polls only while
   `running`, and `describeSilence` (:13154) prints "Finding the silence..." for `none`/`stale`
   too. A server restart mid-scan (inflight map lost, nothing cached) -> the next poll reads
   `none` -> polling stops, the text says it is still finding, no Try again. Re-start the scan
   (or show Try again) when a poll reads `none`/`stale`.

6. SUGGESTION - audition Stop before metadata still plays. common.js:13294-13300: tap Play from
   here, then Stop before `loadedmetadata` (a slow link) - the once-listener still fires
   `seekAndPlay`, which plays with no 8 s timer and the row shows not-playing until the modal
   closes. Guard `seekAndPlay` with `if (closed || auditionIndex !== i) return;`.

7. SUGGESTION - hand-copies of shared numbers. `clampSnapNudge`'s `const GAP = 0.1`
   (common.js:12933) duplicates `MIN_CHAPTER_GAP_SEC`, which nothing imports although its comment
   says "(client clamp...)"; `MAX_SNAP_CHAPTERS = 300 // server.js MAX_CHAPTERS` is a hand-copy
   of the server constant (pass it through deps).

8. SUGGESTION - the Setup lead-in select is unbound. No test references
   `chapter-snap-leadin-select`; a dropped load or change listener stays green. It WORKS
   (verified in Chromium: loads `0.25`, change to 1.5 -> `/api/settings` 1.5 -> reload shows
   1.5); bind it like its neighbours.

9. SUGGESTION - suggestSnaps considers only the NEAREST silence (lib/media/chapterSnap.js:117-126):
   when that one would cross a neighbour the boundary reads `no-gap` even if another in-window
   silence gives a valid start. Rare (needs a chapter shorter than the 8 s window); consider
   trying the next-nearest before giving up.

10. SUGGESTION - the Music drill's text editor -> "Fix times..." path (entry 4 from Music) lands
    in the drill's text-editor callback (loadSongs + renderDrillView + reflectEngines), not in
    `applySnappedChapterTimes`, so `reflectChapter()` is not called: the playing chapter's
    identity refreshes only on the next timeupdate (never while paused). Hand it the seam.

Security standing section: no finding. ffmpeg is spawned with an argv array (no shell), stdin
ignored; the path must be absolute and NUL-free, so it can never be read as an option and, starting
with `/`, never as an ffmpeg protocol URL. The cache names files by sha256(id) (no traversal) and
refuses empty/NUL ids; the temp-then-rename write lives in DATA_DIR (not a shared tmp). All four
routes: requireModifyLibrary first (403), then restrictedVideoMutation (404, no oracle), writes
re-check `mediaVisibleTo` on the fresh record inside the write tick; a restricted scan never
spawns (bound). Client-facing errors carry no path (the stderr tail goes to the server log only).
The lead-in is admin-only (`requireAdmin`, 403 bound) and clamped at read, so a restored bundle
cannot inject a bad value. Titles render via textContent everywhere. DoS: the scan is modify-only,
one at a time, queue capped at 8, SIGKILL timeout. Data exposure: `snapFrom`/`snapBase` ride
GET /api/videos/:id chapters to viewers who can already see the item - the original times only.

Plan vs tree: the counts, the probe table and the mutant claims I re-ran hold; S4 persistence
claims hold as surveyed. AC15's "reachability in real Chromium by the probe" is only the OPEN, not
the save (finding 2). The backup round-trip of the lead-in is generic (settings rows) and correct
by reading; not separately bound.

Tree: nothing written but this section (the security-brief and adversary sections above were
already in the working tree when this seat ran). Scratch: /tmp/qa-chapter-snap-7aa10540 (the
archive sandbox, with three scratch probe variants and one scratch test) and the session
scratchpad.

Gate: CHANGES r1 @7aa10540 — qa

## r1 fix record (builder, after gate r1 @7aa10540)

Commits (all through the pre-commit hook, never --no-verify):
- b8e005af: the three r1 verdicts committed as the seats left them.
- **567784d6**: the fixes C1-C7 and the suggestions taken. Hook `tests 7137 pass 7137 fail 0`.
- **5ed10a46**: merge of main 598f25f7 (v1.319.0) into this branch, **authorized by the Architect**.
  v1.319.0 was tagged after this branch was cut, so `release-ledger.test.js` ("tags with no ledger
  entry: 1.319.0") refused every commit here. One conflict:
  `docs/exec-plans/tech-debt-tracker.md`. Resolved by keeping every row, in id order: main's #238
  and #251-#254, and this branch's #239-#241. My three rows dropped their "(v1.319)" label: this
  feature now ships after v1.319.0. ROADMAP.md, docs/releases.json and package.json were taken
  exactly as main has them, with no conflict. player.js, style.css, setup.js and setup.html merged
  automatically. Hook `tests 7173 pass 7173 fail 0`.
- **23db164c**: three bindings the fix round added and its first tests did not isolate (N12, N21,
  and the synchronous queue patch). Hook `tests 7175 pass 7175 fail 0`.

### Finding -> fix -> test -> mutant

| Finding | Fix (commit 567784d6 unless noted) | Binding test | Mutant (RED) |
|---|---|---|---|
| **C1** adv W1: the text editor floored snapped starts. A title-only save rewrote every snapped time, and starts 0.7 s apart merged into ONE chapter, re-pointing the like on `::c3`. | Both seeds are now lossless: `common.js formatChapterStamp` and `music.js chapterStamp` write `1:01.75`, and a test checks they match. The editor route reads an optional `.mmm` via `server.js parseManualChapterText`; descriptions keep the whole-second grammar, and `3:00.1999 remix` reads as before. Two chapters on one start are **refused with a message**, never deduplicated. **The rule:** a text save that keeps the count and every start (to within 0.5 ms) keeps `snapFrom`/`snapBase` (`chapterSnap.carrySnapProvenance`), so "Edited" and Revert survive a rename. Any change of time or count turns it into a plain typed list. | chapter-snap.test.js "A1" and "A1b" (real routes and the real seed; the like on ::c3 still names "Fourth Song"; a typed duplicate gets 400 and nothing is stored); "the TWO text-editor seed stamps agree"; chapter-snap-watch.test.js (the watch seed is `0:25.75 Two`); chapter-snap-client.test.js "entry 4 from the drill" (`1:00.5`) | N1, N1b, N1c, N2, N3, N4 |
| adv S8: the text save had no version | GET /api/videos/:id now returns `chaptersVersion`. Both text-editor callers send it (`showChaptersEditor(..., opts.version)`). A mismatch is refused (409 `stale`) inside the write tick. A non-string version gets 400. A save with no version still takes the legacy path (disclosed). | chapter-snap.test.js "S8"; the watch test (the version from the last save rides the text editor) | N5 |
| **C2** adv W2: the revert consent was not bound to its target | `chaptersVersion(item, resolveItemChapters)` now also hashes the **revert target** (`planRevert` chapters and source) for a snap edit. A reheat after the confirm therefore changes the token and gets a 409. The editor then **re-plans**: it reloads from storage, says nothing was reverted, and the next confirm names the new count. The routes comment now describes what the token covers. | chapter-snap.test.js "A2" (5 -> 6 -> 2 songs: the old version gets 409 even with `allowCountChange`; the like still names its song; the re-planned revert lands); chapter-snap-core.test.js (the target is part of the token, and absent without a snap edit); chapter-snap-editor-ui.test.js "Revert RE-PLANS" | N6, N7 |
| **C3** adv W3: the count guard was only bound one way | (test only) | chapter-snap.test.js "C3": the source grows 5 -> 6, and the answer is 409 `countChange {from:5,to:6}` | M11b (= adv MA `!==` -> `<`) |
| **C4** adv W4 = qa W2: a watch-page save left the notches and the label stale | Every save on the watch page goes through `applySavedChapters` -> `applyChaptersForMedia`: the time editor's save and revert, and the text editor. That path re-segments the seek bar, resets and re-derives the current chapter (also while PAUSED), rebuilds the menu and drops the loop. The late-detail path now carries `chaptersEdited` and `chaptersVersion` into the loaded item. The false comment is gone. | NEW chapter-snap-watch.test.js: the REAL player.js in jsdom, with **behavioral** asserts (notch `left` % 33.33 -> 42.92, label `Two` -> `One` while paused, the badge revealed and then cleared, a late save for a left item ignored, the late-detail companions carried). The probe in real Chromium: the notch after Save equals the stored boundary at all three viewports. | N8, M38, N21, M25 |
| **C5** adv W5 (+ qa S10): a count-changing revert in Music left ghost and mis-titled rows | `applySnappedChapterTimes` patches the start, span AND title of every queued `<id>::c<n>`, and **drops** rows past the new count synchronously. On a count change it re-lists from the server (`render()`), for a drill or the Songs list. The drill's text-editor path runs the same seam first, then re-derives the playing chapter after its reload. | chapter-snap-client.test.js: "a COUNT-changing save ... RE-FETCHES the rows" (no ghost `::c2`; the `::c1` row reads "Closer"; its heart POSTs `f1::c1`); "a count change from NOW PLAYING" (synchronous ghost drop and re-title, then the re-list); "entry 4 from the drill" (the playing row re-derives while paused); "the seam touches ONLY the saved file" | N9, N9b, N10, N10b, MB |
| **C6** sec S-1 = adv W6 = qa W3: uploader metadata could forge silences | The parser is anchored: `^\[silencedetect @ [^\]]*\] silence_(start|end):`, and the comment is corrected. The cache format was bumped to **v2**, so no v1 record (possibly poisoned) is reused. | chapter-snap-core.test.js (the metadata-dump shapes: title, comment, and a continuation line); chapter-snap.test.js "C6": REAL ffmpeg 7.0.2 over a continuous tone tagged with forged lines returns `[]`; REACHABILITY re-run and passing with the anchor; the core test "a record written by the UNANCHORED v1 parser is never reused" (23db164c) | N11, N11r (real ffmpeg), N12 |
| sec S-2: an fs error could reach the client with the DATA_DIR path | The runner's safe message is kept. A cache-write failure is logged on the server, and the client gets the fixed sentence "The silence was found but could not be saved on the server." | core "a cache WRITE failure reports a fixed sentence" | N13 |
| sec S-3: cache reads had no size cap or shape check | Reads are capped at 1 MB, at most `MAX_SILENCES` entries, and every element must be `{start,end}` with finite numbers, `0 <= start < end`. Anything else reads as no record. | core "the cache" (5 bad shapes plus an over-size record) | N14 |
| **C7** qa W1: Snap all overwrote the user's nudges | `snapAllPlan()` is one plan: it covers only rows that have a `suggest` and are still at their saved time, and each snapped start is checked in order against the CURRENT neighbours. The button count and the status text count that same plan. | editor-ui "Snap all touches ONLY untouched rows": chapter 3 nudged to 2:01.0 and chapter 2 tuned to 1:00.1 both survive, `Snap all (1)`, "Snapped 1 start", stored `[0, 60.1, 121, 184.75, 240]` | N15 |
| qa S4: a landscape phone got desktop sizing | `@media (max-width: 600px), (max-height: 500px)` gives the touch sheet. In landscape the WHOLE sheet scrolls and Save/Cancel are pinned at the bottom (sticky, z-index 1, its own inset). | the probe at 844x390 (below) | - |
| qa S5: a lost scan left "Finding..." showing forever | A poll that reads `none`/`stale` becomes `failed: The scan stopped before it finished.` and **Try again** is shown. | editor-ui "a poll that finds the scan GONE" | N18 |
| qa S6: Stop before the metadata arrived still started playback | `seekAndPlay` returns when the editor is closed or the audition was cancelled. | editor-ui "Stop before the audio metadata arrives" (a real jsdom `<audio>`, readyState 0) | N19 |
| qa S7: shared numbers were hand-copied | The nudge gap comes from the server state (`minGapSec` = `MIN_CHAPTER_GAP_SEC`). The save's chapter cap is server.js `MAX_CHAPTERS` via deps (`MAX_SNAP_CHAPTERS` removed). | - | *equivalent*: the client fallback 0.1 equals the server value, so a mutant that drops `state.minGapSec` cannot change behavior |
| qa S8: the Setup lead-in select was unbound | The change wiring is extracted to `wireChapterSnapLeadIn` (exported). | NEW setup-chapter-snap-leadin.test.js: it loads (and shows an off-list value) and a change POSTs the number | N20, N20b |
| qa S9: only the nearest silence was tried | `suggestSnaps` tries the in-window silences nearest-first and takes the first one that stays between the neighbours. | core "when the NEAREST silence would cross a neighbour" | N16 |
| adv S7: 6 mutants survived | MB, MC, MD, ME and MG are now bound (above; MC by "MC", MD by the one-week-ceiling asserts, ME by "the nudge clamps at the NEXT chapter and at the end of the file", MG by "the poll refuses a STALE seed"). **MH** (the Extras item-id guard in `extrasChapterSnapIndexFor`) is argued *equivalent*: `createExtrasMenu.open()` already refuses any fetched item whose `id !== baseId` ("Extras aren't available for this track"), and checks the base id again after the await. So a mismatched item never reaches `buildExtrasHtml`, and the guard is defense in depth. | - | MB, MC, MD, ME, MG RED |
| qa AC15 lock was porous (regex over unstripped source) | The watch source lock strips comments once at read, and its EFFECT is now bound behaviorally (chapter-snap-watch.test.js). Two v1.109/v1.112 distance locks in player-chapters-parity.test.js that the applier outgrew are now bounded by the semantic unit (to the `resetChaptersUi` assignment), not a character window. | player-chapters-parity.test.js 40/40 | - |

### Mutant round @23db164c: 71 of 71 RED

The sandbox was archived from 23db164c. The runner matched each anchor exactly once and confirmed
the bytes changed before crediting a mutant (the full listing is in the session scratchpad,
`chapter-snap-mutants-r1fix.out`). Results:
- All 38 round-1 mutants are still RED, with their anchors re-verified at the new sha.
- 33 new mutants are RED: M11b, M38 on its new seam, N1-N21, and MB/MC/MD/ME/MG.
- N11r ran against the REAL ffmpeg.

Survivors: none. Equivalent (not run, argued above): MH, and the `minGapSec` fallback.

### Instruments at 23db164c (Node 22.23.1, verbatim)
- `npm run lint`: `✖ 6 problems (0 errors, 6 warnings)`. All are pre-existing no-unused-vars in
  common.js.
- `npm run lint:css`: `TOTAL 0`.
- `overlay-containment-lint --enforce`: `clean (0 violations)`.
- Targeted set with `FILETUBE_TEST_FFMPEG=<static ffmpeg 7.0.2>`: `tests 204 pass 204 fail 0
  skipped 0`. It covers the chapter-snap unit files (core, client, routes, watch), the Setup
  lead-in, chapter-snap and editor-ui integration, chapters-editor, chapter-likes, rbac-census,
  route read/write classification, settings-cache-api, database, player-chapters-parity,
  music-chapter-rename, and the tech-debt, exec-plans and release-ledger censuses.
- Broad unit batch at 567784d6 (music, skin, player, modal, setup, chapter, listen, card-like,
  overlay, css, route, common, database, the censuses, shell, parity): `tests 1753 pass 1753 fail
  0`.
- Related integration batch at 567784d6 (chapter, rbac, route, settings, backup, music, liked,
  api, watch), with ffmpeg: `tests 336 pass 336 fail 0 skipped 0`.

### Probe @23db164c (`FT_PROBE_AUDIO=<a real 2000 s mp3>`, viewports 390x844, 844x390, 1440x900)

The probe was changed for this round:
- Every viewport is re-seeded, so each one starts from the source chapters.
- Measurement waits for the open scale-in to FINISH (a readiness condition, not a sleep).
- The watch pass now SAVES and reads the seek-bar notches back.

| Viewport | editor (watch / music) | buttons | min button | < 44 px | past viewport | doc scrollWidth | notch after Save vs stored boundary | audition at 241.5 s |
|---|---|---|---|---|---|---|---|---|
| 390x844 | 0,0 390x844 sheet | 47 | 88x44 | 0 | 0 | 390 | 12.1125% vs 12.113% (source 12.075%) | playing, 243.8 s |
| **844x390** (landscape) | 0,0 844x390 sheet, whole sheet scrolls, Save/Cancel pinned | 47 | 201x44 | **0** (qa measured 47 at 36 px before) | 0 | 844 | 12.1125% vs 12.113% | playing, 243.9 s |
| 1440x900 | 340,16 760x868 | 47 | 52x36 (desktop, by design) | 47 | 0 | 1440 | 12.1125% vs 12.113% | playing, 243.9 s |

- The editor was reached through the real UI at every viewport: watch `{"entry":"reached"}`, and
  the drill's `.music-drill-snap` was present.
- Drill buttons are byte-identical to the round-1 table at 390 and 1440. At 844x390 the new button
  wraps to its own row (450,404) and the existing buttons keep their size.
- Screenshots: `.../scratchpad/chapter-snap-shots-r1/`
  (`chapter-snap-watch-{390x844,844x390,1440x900}[-snapped].png`, `chapter-snap-drill-*.png`,
  `chapter-snap-music-*.png`).

### Disclosed (r1 round)
- **The text save's version token is OPTIONAL.** A POST without `version` still saves, which is the
  pre-existing contract for any other caller. Both of the app's text-editor callers send it.
- **A re-planned revert reloads the editor from storage,** so unsaved local nudges are dropped. A
  revert discards corrections anyway, and the status line says what happened.
- **A count change on the Home or Albums tab** patches the queue in place (ghost dropped,
  survivors re-titled) without a re-list, because no rows on screen index that queue. A NEW
  chapter from a count increase appears after the next list load.
- **The editor grammar now reads `1:05.5 Title` as 65.5 s "Title".** It used to read it as 65 s
  "5 Title". This applies to the manual editor only; description parsing is unchanged.
- **Comments in the new code still say "v1.319".** v1.319.0 is now the lock-audio release, so this
  feature will ship under a later version number. The comments are labels only; the release sets
  the number.

## Gate r2 - security-brief (@330aaa8b)

**Gaps, stated first:** still no Bash. I could NOT run `git diff 7aa10540..330aaa8b`, any test,
the mutant runner or ffmpeg. The sha is verified only from the ref file
(`.git/refs/heads/feat/chapter-snap` = 330aaa8b9eb1...). I could not check for uncommitted
changes. The builder's "REACHABILITY re-run and passing with the anchor" and "C6 forged tags ->
`[]`" (real ffmpeg 7.0.2) are the builder's records; I did not reproduce them. I did not review
the v1.319.0 merge content beyond the files below.

### My r1 findings against 330aaa8b

- **S-1: fixed as prescribed (verified by reading).** `LINE_RE` in
  `lib/media/chapterSilence.js` is now `^\[silencedetect @ [^\]]*\] silence_(start|end):\s*NUM`,
  anchored at the start of the line. ffmpeg indents every echoed metadata line, continuation lines
  included, so an uploader's title, description or chapter title can no longer open a line with the
  detector prefix. The comment is corrected. `SILENCE_PARAMS_KEY` is bumped to `...v2`, and
  `recordMatches` requires an exact params match, so every v1 record, possibly poisoned, reads
  stale and is rescanned. One residual, a **suspicion, not a finding**: ffmpeg prints the input
  PATH raw on the `Input #0 ... from '<path>'` line, so a filename containing a newline followed by
  the prefix could still open a line. I did not check whether yt-dlp's `--windows-filenames`
  sanitizing removes newlines. A local file's name is the owner's choice, and the impact is
  suggestions only, so INFO.
- **S-2: fixed (verified).** A runner failure keeps the runner's own path-free messages. The
  ENOENT and exit messages are fixed text, and NUL and relative paths are refused before `spawn`,
  so its argument-validation throw cannot echo the path. The re-stat and `cache.write` now sit in a
  separate try. On any fs error, the detail goes to the server log and the client gets the fixed
  sentence "The silence was found but could not be saved on the server."
- **S-3: fixed (verified).** A read is refused above 1 MiB (checked by stat before the read). It
  holds at most `MAX_SILENCES` entries, and every element must be an object with finite
  `0 <= start < end`. Anything else reads as no record, and all of it sits inside the try, so the
  GET cannot throw on a hand-edited file. The stat-then-read gap only matters to someone who
  already owns DATA_DIR.
- S-4 (INFO, scan cost): unchanged, no action asked.

### New surface

- **The `chaptersVersion` token on GET /api/videos/:id (verified).** It is computed only after
  that route's `mediaVisibleTo` 404 gate. It is 16 hex characters of a sha256 over the stored
  manual list, the resolved list and source, and (for a snap edit) the revert target. The revert
  target comes from `item.chapters` or `item.tags.description`, and the same response already
  spreads `...item` (so `chaptersManual`, `chapters` and `tags` are already sent). The token is a
  deterministic digest of data the viewer already receives, with no key and no secret, so it leaks
  nothing new. On the snap routes it is computed only behind `gate()`.
- **The text route POST /api/videos/:id/chapters, RBAC order (verified): unchanged.**
  `requireModifyLibrary`, then `restrictedVideoMutation`, then body checks, then the write tick.
  I compared this with the main checkout's copy of the route. The version check is added inside
  the tick, and a non-string `version` gets 400 before the tick. There is still no in-tick
  `mediaVisibleTo` re-check. That gap predates this branch; the snap routes have the re-check.
- **The typed-start grammar (verified).** `CHAPTER_LINE_FRACTION` accepts at most 3 + 2 + 2
  integer digits and a fraction of 1-3 digits followed by a non-digit. It has no minus sign, no
  exponent and no `Infinity`, so NaN, negative and huge values are impossible by construction (the
  ceiling is 999:99:99.999). `chapterTimestampToSeconds` and `normalizeChapter` re-check that the
  value is finite and >= 0, and the result is rounded to the millisecond. Duplicate starts are
  refused (400) instead of deduped, and more than `MAX_CHAPTERS` is refused. The duplicate error
  quotes the user's own normalized titles (control characters stripped, 200-character cap), and the
  client writes errors with `textContent`, so there is no injection even of your own text. The text
  stays capped at 20000 characters before parsing. `carrySnapProvenance` copies only stored
  `startTime`/`snapFrom`/`snapBase` plus the parsed title, and only when the count matches and
  every start is within 0.5 ms. Body keys are read by name and never merged, so `__proto__` in
  the BODY is inert.

### Finding

- **S-5 MEDIUM, a pre-existing bug on the route this branch rewrote: a `__proto__` MEDIA ID
  pollutes `Object.prototype`, and the next scan can PERSIST it onto every item.** In
  `lib/media/routes.js:1886` the write tick looks up `db.metadata[req.params.id]` with no
  own-property check (it was the same at base: the main checkout's copy of the route has the
  identical line). `db.metadata` is a plain `{}` (`lib/media/items.js getAll`, and the
  `loadDatabase` backfill).

  Traced path, not run:
  1. A user with canModifyLibrary sends `POST /api/videos/__proto__/chapters` with
     `{"text":"0:00 A\n1:00 B"}`.
  2. `restrictedVideoMutation` does an own-property lookup, finds nothing, and lets the request
     through.
  3. In the tick, `item` is `Object.prototype`, which is truthy. With `version` omitted,
     `item.chaptersManual = carrySnapProvenance(Object.prototype, parsed)` sets an ENUMERABLE
     `chaptersManual` on `Object.prototype` for the whole process. The save's `Object.keys` diff
     skips it, and the route answers 200.
  4. Every item now inherits the attacker's list. `resolveItemChapters` serves it for every item
     without its own manual list.
  5. The scan's Phase-2 merge (`lib/scan/orchestrator.js:1432`,
     `Array.isArray(freshItem.chaptersManual)`) then copies the inherited value onto items as an
     OWN property, which the diff-save persists. The change survives a restart and re-points
     `::c<n>` likes library-wide.

  Why MEDIUM, not a blocker: only a user who can already delete and move media can do it, it
  cannot happen by accident, the pre-merge state can be recovered (embedded `chapters` and the
  descriptions are untouched), and this branch did not introduce it.

  Prescription: in this route's tick, use the same own-property lookup the snap routes use
  (`Object.prototype.hasOwnProperty.call(db.metadata, id) ? db.metadata[id] : null`). Bind it with
  a test that `POST /api/videos/__proto__/chapters` returns 404 and leaves
  `({}).chaptersManual === undefined`, and delete the guard to watch it go red. The same unguarded
  lookup appears in other routes (routes.js:1813, 2078/2090, 725/906/2296/2352/2418,
  lib/music/routes.js:545, lib/media/streams.js). I did not trace which of those write. File that
  class as a tech-debt row, not work for this branch.
  If this is fixed, re-engage this seat at the new sha. If it is accepted instead, write the
  rationale here.

No CRITICAL or HIGH. S-1, S-2 and S-3 are closed. S-5 is MEDIUM (fix or accept in writing).

Gate: APPROVED r2 @330aaa8b — security-brief

## Gate r2 - qa (@330aaa8b)

Delta reviewed: 567784d6 (the fixes), 5ed10a46 (the merge of main 598f25f7 = v1.319.0), 23db164c
(bindings) and 330aaa8b (plan record), against my r1 findings. Instruments, run by this seat (Node
22.23.1, `FILETUBE_TEST_FFMPEG` = the scratchpad static ffmpeg 7.0.2):
- every test file touched by the branch since ecb61e1d (17) plus chapter-parse:
  `tests 381 pass 381 fail 0 cancelled 0 skipped 0` (REACHABILITY and the C6 forged-tag test both
  ran against real ffmpeg: `ok 23 - REACHABILITY ...`, `ok 31 - C6 ... finds NO gap`).
- censuses (rbac-census, route-read/write-classification, comment-debt, css-token-lint, exec-plans,
  overlay-containment, tech-debt): `tests 52 pass 52 fail 0`.
- `npm run test:unit`: `tests 7175 pass 7175 fail 0 cancelled 0 skipped 0` (= the builder's hook).
- `npm run lint:css`: `TOTAL 0`; `overlay-containment-lint --enforce`: `clean (0 violations)`;
  eslint on the changed .js: `6 problems (0 errors, 6 warnings)`, all pre-existing no-unused-vars
  in common.js.
- `check-markers`: `2 issue(s)`: `stale approval @ecb61e1d` (the design line, expected) and
  `stale approval @7aa10540` (security-brief r1; it has since re-signed r2 @330aaa8b below).
- probe, `git archive 330aaa8b` sandbox in /tmp, a real 2000 s mp3, `390x844 844x390 1440x900`:
  the builder's table REPRODUCES. 390x844: 47 buttons, min 88x44, 0 below 44, 0 past viewport.
  844x390: 0,0 844x390 sheet, 47 buttons, min 201x44, **0 below 44**, 0 past viewport, Save/Cancel
  pinned (screenshot checked). 1440x900: 52x36 (desktop, by design). After Save at every viewport:
  notches `[12.1125,24.1125,36.1125]` vs stored `[12.113,24.113,36.113]`. Audition playing at
  243.9 s for the 241.5 s boundary.

### My r1 findings at 330aaa8b
- **W1 (Snap all vs nudges): fixed as prescribed, VERIFIED.** My r1 jsdom drive re-run against the
  real server in the r2 sandbox: nudge chapter 3 (no gap) +1 s -> the button stays `Snap all (2)`;
  Snap to chapter 2, then -0.1 -> `Snap all (1)`; Snap all -> `0:00.0 1:01.7 2:01.0 3:04.8 4:00.0`,
  status `Snapped 1 start`; stored `[0,61.65,121,184.75,240]` - both hand edits survive.
- **W2 (watch notches/label after a save, incl. the text editor): fixed, VERIFIED in Chromium.**
  My r1 drive (paused at 241.8 s, Snap all -> Save): notch `80.5%` -> `80.75%` (= 242.25/300), label
  and menu `Sodium Lamps...` -> `Night Transit`. Then the TEXT editor from the same page: seeded
  losslessly (`4:02.25 Sodium Lamps...`), renamed chapter 1 only -> saved (the version refreshed by
  the snap save was ACCEPTED, no 409), label `Night Transit (renamed)`, notch still `80.75%`,
  Edited badge still shown, stored starts unchanged. The comment-porous lock now strips comments
  (chapter-snap-client.test.js:347-350) and the effect is bound behaviorally (chapter-snap-watch).
- **W3 (unanchored parser): fixed as prescribed, VERIFIED.** My r1 forged-tag file through the r2
  `runSilenceDetect` + real ffmpeg -> `[{"start":5,"end":7}]` (the forged `{1,3.5}` is gone); a
  leading-space line reads `null`; the cache key is `n-45d0.5v2`, so no v1 record is reused.
- S4 landscape: fixed (numbers above). S5 lost scan: fixed (a `none`/`stale` poll becomes `failed`
  + Try again). S6 Stop before metadata: fixed (`if (closed || auditionIndex !== i) return;`).
  S7: fixed (`minGapSec` from the state, `maxChapters` from deps, `MAX_SNAP_CHAPTERS` removed; the
  `MIN_CHAPTER_GAP_SEC` comment is now true). S8: fixed (setup-chapter-snap-leadin.test.js). S9:
  fixed (nearest-first candidates). S10: fixed (the drill's text path runs the queue seam, then
  `reflectChapter()`).

### Merge, disclosures, comments
- Tracker (docs/exec-plans/tech-debt-tracker.md): every row id from BOTH parents is present (the
  set difference is empty), no duplicate ids, only #239-#241 added vs main, in id order between
  #238 and #251; the tech-debt census is green. Well-formed.
- Disclosed, judged acceptable: the optional text-save `version` (both app callers send it); a
  re-planned revert drops unsaved nudges; Home/Albums count change patches without a re-list;
  `1:05.5 Title` -> 65.5 s "Title" (measured: `3:00.1999 remix` still reads 180 s "1999 remix",
  `1:05. 5 Songs` reads 65 s "5 Songs"; a typed duplicate start is refused with a message).
- The "v1.319" labels: see finding 3.

### New findings

1. **WARNING - the module's persistence-contract comment now states the opposite of the code
   beside it, and the plan repeats it.** lib/media/chapterSnap.js:21-23 says "the text editor's
   save (a full manual replace) drops it [the provenance], which is correct: a typed list is plain
   manual chapters again". Since 567784d6 the SAME file's `carrySnapProvenance` (:97) KEEPS the
   provenance for a title-only text save (VERIFIED above: rename -> still Edited). The plan's
   "Disclosed gaps" (lines 341-342: "A text-editor save of a snapped item replaces the manual
   list and drops the provenance (the badge and Revert go away) - by design") contradicts the r1
   fix record's rule. Scenario: a maintainer reads the contract header of this data-class module,
   takes "a text save always clears Edited" as the invariant, and removes the carry or builds on
   the wrong rule. Fix: restate both as the shipped rule (same count and every start within 0.5 ms
   keeps the provenance; any time or count change is a plain typed list).

2. SUGGESTION - `saveAutomationSetting`'s doc comment is now attached to the wrong function.
   public/js/setup.js:699-706: `wireChapterSnapLeadIn` was inserted between the "POSTs a single
   changed key to /api/settings. Returns the parsed response body..." comment and
   `saveAutomationSetting`, so that doc now reads as the lead-in wiring's. Move the function
   above the comment.

3. SUGGESTION - the "v1.319" labels. 76 added lines outside docs say `v1.319` (lib 15, server.js
   12, public 30, tests/scripts the rest); `v1.319.0` is the lock-audio tag, and main carries no
   `v1.319` code labels of its own, so every hit names a release this feature is not in. Labels
   only (no behavior), disclosed, and the number is not known until release (the wave merges in
   readiness order), so safe to ship ONLY if the release relabels them: one `sed` over this
   branch's added lines to the real version at release, added to the release checklist for this
   branch. Otherwise `git grep v1.319` (the first move when bisecting a v1.319 regression) returns
   76 unrelated Chapter Snap hits.

4. SUGGESTION - a FILENAME can still forge a gap (the security-brief's suspicion, now measured).
   ffmpeg echoes the input path raw on `Input #0, ... from '<path>':`. VERIFIED: a copy of my test
   mp3 named `nl<LF>[silencedetect @ 0x1] silence_start: 1<LF>[silencedetect @ 0x1] silence_end:
   3.5<LF>.mp3` -> r2 `runSilenceDetect` resolves `[{"start":1,"end":3.5},{"start":5,"end":7}]`.
   The owner chooses local names and yt-dlp's filename sanitizing very likely removes newlines, and
   the effect is a reviewed suggestion, so low. Cheap closure: refuse to scan a path containing
   `\r`/`\n` (the runner already refuses NUL), or count events only after ffmpeg's `Output #0`
   line.

5. SUGGESTION - a count change leaves a ghost in the listen-mode stash. music.js
   `applySnappedChapterTimes` now REASSIGNS `queue = queue.filter(...)`; for a chaptered LISTEN
   video `queue` was the same array as `activeListenChapters` (music.js:3222/3257), which keeps the
   dropped `::cN` object. Scenario: listen to a chaptered video, "This chapter starts wrong" ->
   Revert onto a source with fewer chapters (consented) -> dock, then return: `restoreListenChapterQueue`
   sets `queue = activeListenChapters` and the ghost row is back. Filter the stash too (or
   re-assign it when it aliased the queue). A time-only save is unaffected (objects patched in place).

Note, not a finding: at 844x390 the Music drill's action row (pre-existing siblings, 28 px tall at
widths over 600) carries "Fix times" at 80x28; the button matches its siblings, and the editor
itself is 44 px there.

Security standing section: no new exposure. The anchored parser holds against metadata (verified);
finding 4 is the residual filename path (low). The text route's duplicate-start error echoes two
user-typed titles back to the same modify-rights user, rendered with textContent. The new
`CHAPTER_LINE_FRACTION` has the same quadratic backtracking as the pre-existing `CHAPTER_LINE`
(measured on a 20,000-character line of spaces: 478 ms vs 586 ms for the old grammar; the route
caps text at 20,000 characters and requires modify), so no new ReDoS surface. The GET
/api/videos/:id `chaptersVersion` is a 16-hex hash of chapter data the viewer already receives.
The routes' 403/404/in-tick re-check are unchanged; `maxChapters` now comes from server.js.

Plan vs tree: the r1 fix record's counts (7175), probe table and finding->fix mapping hold where I
re-ran them; the "Disclosed gaps" line on text saves is stale (finding 1).

Tree: nothing written but this section (the security-brief r2 section above was already in the
working tree). Scratch: /tmp/qa-chapter-snap-330aaa8b (the archive sandbox, with one scratch test
and one scratch probe variant) and the session scratchpad.

Gate: CHANGES r2 @330aaa8b — qa

## Gate r2 - adversary (@330aaa8b)

Instruments, verbatim (Node 22.23.1, FILETUBE_TEST_FFMPEG = the static ffmpeg 7.0.2):
- The 7 chapter-snap files at 330aaa8b: `# tests 70 # pass 70 # fail 0 # cancelled 0 # skipped 0`.
- All mutants ran in a /tmp sandbox built from `git archive 330aaa8b`. Its tracked content was
  diff-clean against the commit before each batch.

The r1 findings, re-measured at 330aaa8b:
1. **W1 (text editor rounding / dedup): FIXED as prescribed.**
   - A title-only rename with the real seed keeps the stored list at `[61.75, "Second Song", 60,
     "embedded"] ... [240, "The Closer", ...]`, with the times, the provenance and Edited intact.
   - With starts 0.7 s apart, an unchanged text save keeps the count at 5 and the like on `::c3`
     still reads "Fourth Song".
   - A typed duplicate gets 400: "Two chapters start at 2:00 ...".
   - Real Chromium: renaming through the watch text editor stores `[25, "B", snapFrom 20]`.
2. **W2 (revert consent): FIXED as prescribed.** In the 5 -> 6 -> 2 run the version changes
   (`true`). The old-version revert with `allowCountChange` gets 409 `stale`, and all 5 manual
   chapters are kept.
3. **W3 (count guard, one axis): FIXED.** Behavior: 4 chapters gives `409 {"from":5,"to":4}`
   and 6 gives `409 {"from":5,"to":6}`. Both mutants go RED: `<` reds the new C3 test and `>`
   reds the reheat test.
4. **W4 (watch notches): FIXED.** Real Chromium, chapter 2 moved 20 -> 25 s: the notches go from
   `["33.3333%","66.6667%"]` to `["41.6667%","66.6667%"]`, and a later text save keeps them.
5. **W5 (Music ghost rows): FIXED** for rows and titles, bound by the builder's tests. Its NEW
   drop path has a nav gap: see finding 2 below.
6. **W6 (forged silences): FIXED.** Real `runSilenceDetect` over the same forged continuous tone
   returns `[]`. A real 2 s gap in a file whose title carries a forged line returns exactly
   `[{"start":4,"end":6}]`.
7. **My r1 survivors:**
   - MB, MC, MD, ME and MG are all RED, each on the test the fix record names.
   - MH still SURVIVES (70/70). I accept the equivalence argument: skin-surface.js:242 refuses
     any fetched item whose `id !== baseId` before the menu renders. I verified that by reading
     the code; I did not run it.
8. **Spot check of the 71-mutant claim:** 9 of 9 of my own mutants went RED. They cover:
   - the carry turned off, and the carry ignoring times (A1 plus the core carry test);
   - the text-save version ignored (S8);
   - the revert target dropped from the token (A2, the re-plan UI test, the core token test);
   - duplicate starts allowed (A1b);
   - the silence regex un-anchored (C6 real ffmpeg, plus parser edges);
   - the seam dropping no rows (the NOW PLAYING count change);
   - no re-plan after a stale revert (the re-plan UI test);
   - the fraction grammar removed (A1, A1b, seed parity).

Findings (what the fix introduced):

1. **WARNING (NEW, introduced by the carry rule): a title rename made in the text editor now
   survives as a snap edit, and a later Revert silently ERASES the typed titles.** Measured
   through the real routes:
   1. Snap save.
   2. A text rename of "Second Song" -> "Heartbeats (José González)" and "Fourth Song" ->
      "Crosses". The response is 200, `edited:true`, `revert {"source":"embedded","count":5}`,
      and the titles are the renamed ones.
   3. Revert returns 200. The titles are back to `["Opening","Second Song","Third Song","Fourth
      Song","Closer"]`.

   The confirm says only "Go back to the chapter times from the file? Your corrected times are
   removed." Before this fix, a rename dropped the provenance, so the typed titles could not be
   lost this way. Chapter Snap is TIMES ONLY (S3), so its revert should revert times.
   Prescription: on an embedded/description base, when the stored titles differ from the
   target's titles (same count), write the source TIMES with the stored TITLES as a plain manual
   list. Drop the manual list only when the titles already match. Alternatively, at minimum, the
   confirm must name the title loss. Bind it with this repro.
2. **WARNING (NEW, introduced by the count-change drop): the seam changes queue indices but
   re-registers nav only when the playing chapter's ID changes.** Measured through the REAL
   music.js harness:
   - Setup: an in-order album c0/c1/c2 playing `f1::c1` at 62 s. A consented revert changes 3 to
     2 chapters (the server re-lists 2 rows).
   - `setTrackNav` registrations stay at **1** (before and after). The last registration still
     has `onNext`, which is the stale `playAt(2)`. Calling it leaves the player on `f1::c1` (a
     no-op, because the queue now has length 2).
   - The only fetch is the album re-list; there is no autoplay fetch, so the radio never arms on
     what is now the last chapter.
   - `reflectChapter()` returns early because `currentChapterId()` is still `f1::c1`, and
     `render()`'s follow-up reflects the same way. When a dropped row comes BEFORE the playing
     one (a shuffled drill, or the Songs tab sorted by title), onPrev/onNext point one slot off.

   Verified: nav is not re-registered and onNext is a no-op. Reasoned, not driven: at the
   whole-file end the ended-advance falls back to that onNext, so playback stops instead of
   stationing on. This is the v1.311 class. Prescription: after the filter (and again after the
   re-list), look up the playing id's index in the NEW queue and call `registerTrackNav(ti)`
   unconditionally. Bind it by asserting a fresh registration with no `onNext` (or radio armed)
   when the playing chapter becomes the last.
3. **SUGGESTION: the text-save `version` is optional, and a client that omits it still silently
   replaces a snap edit.**
   - Measured: seed, snap save to [0, 61.75, 120, 184.75, 240], then a POST /chapters with NO
     version returns **200**. The store holds `[0,60,120,180,240]` and `edited:false`. The same
     text WITH the stale version gets 409.
   - Every v1.319 caller sends the version (both `showChaptersEditor` callers pass it; I grepped
     every `/chapters'` POST in public/js). So only a tab or PWA still running pre-upgrade JS
     reaches the legacy path. The builder disclosed it.
   - Cheap hardening: when the STORED list `isSnapEdited`, require the version (409 "reload"),
     which protects exactly the sub-second data.
4. **SUGGESTION: the grammar change is stable for stored data, and changes the meaning of only a
   few NEWLY typed forms.**
   - Measured old -> new readings: `3:00.199 remix` 180 "199 remix" -> 180.199 "remix";
     `2:30.5` 150 "5" -> 150.5 ""; `[1:05.25] Bracketed` 65 "25] Bracketed" -> 65.25
     "Bracketed". Unchanged: `1:05. 99 Luftballons`, `3:00.1999 remix`, `4:00 - .5 Nights`.
     Descriptions keep the old parser.
   - A stored list always round-trips, because the seed emits a space after the stamp. The one
     exception is pre-existing: a stored title beginning `.5` becomes `5` on any save; with the
     carry, that now happens without dropping Edited.
5. **Suspicion, not a finding:** a snap made from Music now-playing does not refresh the watch
   player's `currentData.chaptersVersion`. A text editor opened later on the same loaded item
   would get 409 and need a reload. The failure is in the safe direction; I did not drive it.

The v2 cache bump: a v1 record reads `stale` and the editor re-scans (the builder binds this in
the core test). I found no hole.

Tree: the sandbox, the probe temp dirs and Chromium are gone. Apart from this appended section
(and the other seats' sections), `git status` is clean. The pre-existing untracked
`node_modules` symlink was left untouched.

Gate: CHANGES r2 @330aaa8b — adversary

## r2 fix record (builder, after gate r2 @330aaa8b)

Commits (all through the pre-commit hook, never --no-verify):
- a5eeb850: the three r2 verdicts committed as the seats left them.
- **a86c94b1**: merge of main 57c8ab84 (v1.320.0 = fix/music-followups), pre-authorized for a
  release-ledger trip. The fix commit tripped `release-ledger.test.js` ("tags with no ledger
  entry"). I saved the staged fixes as a patch, returned the tree to HEAD, merged, and re-applied
  the patch with a 3-way merge. One conflict each time, both in `docs/exec-plans/tech-debt-tracker.md`,
  both resolved by keeping every row in id order: this branch's #239-#242, and main's #243-#246
  and #248. lib/media/routes.js, style.css, music.js, player.js and server.js merged automatically.
  Hook `tests 7195 pass 7195 fail 0`.
- **d24eb564**: the fixes R1-R5 and qa S2/S3/S4. Hook `tests 7198 pass 7198 fail 0`.
- **45e97624**: binds R3b, the one survivor of the round below. Hook `tests 7199 pass 7199 fail 0`.

### Finding -> fix -> test -> mutant

| Finding | Fix (d24eb564) | Binding test | Mutant (RED) |
|---|---|---|---|
| **R1** security S-5 MEDIUM (pre-existing): `__proto__` media id polluted Object.prototype through the text chapters route | New module helper `ownMediaItem(db, id)` in lib/media/routes.js (an own-property lookup). **Every WRITE route** in the module uses it: DELETE /api/videos/:id, POST /dimensions, /chapters, /attribute-channel, and /prepare-audio. Grepped 2026-09-24, the remaining plain lookups are all READ routes and are filed as tracker **#242**: GET /api/videos/:id, /api/subtitles/:id, /api/transcript/:id, music /audio/:id, and the streams /thumbnail, /storyboard, /preview and /video. | NEW test/integration/media-write-proto-ids.test.js. For each of `__proto__`, `constructor`, `toString`, `hasOwnProperty` and `valueOf`, all five write routes return 404. Afterwards Object.prototype, Object and toString carry no `chaptersManual`, `width`, `height`, `channelAttributedManually`, `channelUrl` or `channelName`. The same routes still reach a real item (discrimination). | R1a (chapters), R1b (dimensions), R1c (attribute), R1d (delete), R1e (prepare-audio), R1f (the helper trusting any key) |
| **R2** adversary W1, **Architect ruling**: Revert erased titles typed in the text editor | `planRevert`: when the chapter count is unchanged, revert writes the source TIMES with the STORED titles as a plain manual list. When the titles already match the source, it just drops the manual list, as before. A count-changing revert (which needs `allowCountChange`) takes the source list whole, titles included. Both confirm texts say which case applies ("Your chapter titles are kept." / "...the chapter list AND its titles come from the source..."), and so does the server's `countChange` 409 message. | chapter-snap.test.js "R2 ... KEEPS the typed titles": the adversary's repro. Snap, then rename two chapters in the text editor, then revert: the titles are `Heartbeats (José González)` and `Crosses`, the times are `[0,60,120,180,240]`, there is no provenance, and the item is no longer Edited. "R2: a count-changing revert of an EMBEDDED-based snap takes the source titles": the 409 says so, and with the yes the list is N1-N6. The core planRevert test covers both branches. The editor-ui confirm tests pass with the new text. | R2 (same count drops titles), R2b (keeps titles even on a count change) |
| **R3** adversary W2: nav was not re-registered after a count change; **qa S5**: the Listen stash kept dropped chapters | `applySnappedChapterTimes` now calls `renavPlaying()` (registerTrackNav at the playing id's NEW index; the last index arms the autoplay radio) right after the filter, and again after the re-list. The drill text path does the same after its reload. The Listen stash `activeListenChapters` is filtered with the same predicate (or re-pointed when it aliased the queue). | chapter-snap-client.test.js: "3 -> 2 revert while PLAYING f1::c1": nav re-registers synchronously with no stale Next, still none after the re-list, the radio's artist fetch fires, and Prev goes to f1::c0. "a dropped row BEFORE the playing one (a shuffled list)": Prev is ::c0, where the stale closure was playAt(1), which is ::c1 itself. "Listen mode ... does NOT come back after a dock-return": a real `?listen=1` play, then destroy and re-init with `?nowplaying=1`, and the restored queue has no ghost. | R3a (after the filter), R3b (after the re-list), R3c (stash) |
| **R4** qa W1: the persistence contract was stale | lib/media/chapterSnap.js header now states the shipped rules. A title-only text save (same count, every start within 0.5 ms) keeps the provenance; any time or count change makes a plain typed list. Revert keeps the stored titles at an unchanged count. This plan's "Disclosed gaps" line is corrected below. | (a comment) | - |
| **R5** adversary S3: a text save without a version could replace a snap edit | The text route refuses a save with no `version` when the STORED list is a snap edit: 409 `stale`, "Reload the page and open the editor again". A plain typed list keeps the optional contract. | chapter-snap.test.js "R5": a snap edit with no version gets 409 and its sub-second times survive; plain over plain with no version gets 200 twice. | R5 |
| qa S2: a doc comment sat on the wrong function | `wireChapterSnapLeadIn` moved above `saveAutomationSetting`'s doc comment. | (the Setup tests still pass) | - |
| qa S3: stale "v1.319" labels | Every "v1.319" label this branch added in code, tests and scripts (75 occurrences) now reads "chapter snap (2026-09-24)" or "Chapter Snap (2026-09-24)". `grep -rn v1.319 lib public server.js scripts test` finds only main's own. | - | - |
| qa S4: a file name could forge a gap | `runSilenceDetect` refuses a path containing `\r` or `\n` before spawning: "This file name contains a line break, so its silence cannot be read safely. Rename the file and try again." | core "runSilenceDetect: ... a line break": a LF name shaped like a detector line and a CR name both reject without spawning. | S4 |
| adversary S5 (suspicion): the watch player's version token after a Music-side snap save | **Not taken; it fails safe.** A text editor opened later on the watch page with the old token is refused (409 with the reload message) and never overwrites. Refreshing it needs a cross-surface signal (the Music view and the watch player keep separate copies of the item) that is not cheap. | - | - |

### Mutant round @d24eb564

The same runner as round r1 (`chapter-snap-mutants-r1fix.js`), with its anchors re-verified at the
new sha. Five anchors changed and were updated: M20/M21/M25 (their comments were relabelled), M22
(renavPlaying now follows it), and M5/M11 (the message text). 13 r2 mutants were added: R1a-R1f,
R2, R2b, R3a-R3c, R5 and S4.

- **@d24eb564: 83 of 84 RED.** All 71 r1-fix mutants are still RED. Of the 13 new ones, 12 are RED.
  - R1d (DELETE with the plain lookup) is RED by a HANG. `resolveOnDiskPath(undefined)` throws
    inside the async handler, so the request never answers, and the file is cancelled at the
    runner's timeout. That is a real bug the guard removes.
  - **Survivor: R3b** (no nav re-register after the re-list). Every fixture re-listed the rows in
    the filtered queue's order.
- **@45e97624: R3b bound** by chapter-snap-client.test.js "the RE-LIST re-registers nav too". The
  server re-lists `::c1` first, so there must be no Prev, and Next must be `::c0`. The 15
  client-side mutants were re-run at 45e97624: M19-M25, N9, N9b, N10, N10b, R3a, R3b, R3c and MB.
  **15 of 15 RED.**
- **Total: 84 of 84 RED. No survivors.** MH is still argued equivalent, as in r1.

### Instruments at d24eb564 (Node 22.23.1)
- `npm run lint`: `✖ 6 problems (0 errors, 6 warnings)`. These are the 6 existing warnings in
  common.js.
- `npm run lint:css`: `TOTAL 0`.
- `overlay-containment-lint --enforce`: `clean (0 violations)`.
- Broad affected set on the merged tree with the r2 fixes, `FILETUBE_TEST_FFMPEG` set: `tests
  1800 pass 1800 fail 0 skipped 0`. It covered chapter-snap-*, setup*, music*, player*, skin*,
  chapter* integration, media-write-proto-ids, rbac*, route*, settings-cache-api, music*/liked*
  integration, database, and the tech-debt, exec-plans, release-ledger and comment-debt censuses.
- Hook unit suite: 7198/7198 (d24eb564) and 7199/7199 (45e97624).

### Probe @d24eb564
`FT_PROBE_AUDIO=<a real 2000 s mp3> node scripts/chapter-snap-probe.js <out>` (390x844, 844x390,
1440x900). The numbers are unchanged from r1-fix:

| Viewport | buttons | min | < 44 | past viewport | doc scrollWidth | notch after Save vs stored | audition |
|---|---|---|---|---|---|---|---|
| 390x844 | 47 | 88x44 | 0 | 0 | 390 | 12.1125% vs 12.113% | playing 243.9 s (boundary 241.5) |
| 844x390 | 47 | 201x44 | 0 | 0 | 844 | 12.1125% vs 12.113% | playing 243.9 s |
| 1440x900 | 47 | 52x36 (desktop) | 47 | 0 | 1440 | 12.1125% vs 12.113% | playing 243.9 s |

The editor was reached through the real UI at every viewport. The drill buttons are unchanged.
Screenshots: `.../scratchpad/chapter-snap-shots-r2/`.

### Disclosed (corrected by R4, replaces the stale line in "Disclosed gaps" above)
- **Text saves of a snapped item.** A title-only edit (same count, every start within 0.5 ms)
  KEEPS the snap provenance, so "Edited" and Revert remain. Any time or count change makes it a
  plain typed list with no provenance. A text save of a snap edit must carry the version (R5).
- **Revert** restores the source TIMES and keeps the stored titles while the count is unchanged.
  A count-changing revert takes the source's list and titles, and needs the explicit yes.
- **Read routes** with the plain metadata lookup are tracker #242: read-only, no pollution
  possible.
- **The watch page's version token after a Music-side save** is not refreshed. The next text
  save there is refused with a reload message, so it fails safe.

## Pre-r3: main v1.321.0 merged (Architect's request)

- **00faee52**: merge of main 580e5f7f (v1.321.0 = feat/desktop-theatre). **No conflicts.** The
  tracker merged automatically with every row, in id order: this branch's #239-#242 and main's
  #243-#249, including main's #247 and #249. ROADMAP.md, docs/releases.json and package.json are
  byte-identical to main (`git diff --stat main -- ...` is empty). Hook `tests 7218 pass 7218
  fail 0`.
- **Checks on 00faee52:**
  - `lint:css`: TOTAL 0.
  - overlay-containment: clean.
  - check-markers: 3 issues, all `stale approval` markers (@ecb61e1d the design line, @7aa10540
    and @330aaa8b the earlier seat approvals). These are expected until the gate re-binds at the
    reviewed sha.
  - Broad affected set with real ffmpeg: `tests 2065 pass 2065 fail 0 skipped 0`. It covers the
    earlier set plus theatre*, theater*, watch* (unit and integration), css* and overlay*.
- **Mutants re-run on 00faee52 (a /tmp sandbox archived from it): 18 of 18 RED.**
  - The watch page mutants: C4 N8, M38, N21, N1c, and entry point 3 (M25).
  - R1a-R1f, R2, R2b, R3a-R3c, R5 and S4. R1d is RED by the known hang.
- **Probe at 1440x900 on the watch page, theatre OFF and ON.** ON uses the new `--theatre` flag
  (commit below), which clicks the real `#theater-btn`: `theatre:"click", theatreOn:true`.
  - In both modes the chapters menu offers "Fix chapter times…" (`entry: reached`).
  - The editor opens at 340,16 760x868 with 47 buttons and 0 past the viewport.
  - After Save, the notches are `[12.1125,24.1125,36.1125]` against stored
    `[12.113,24.113,36.113]`, so they follow the new boundary with theatre on and off.
  - Screenshots: `.../scratchpad/chapter-snap-shots-r3pre/` (`chapter-snap-watch-1440x900[-theatre][-snapped].png`).
