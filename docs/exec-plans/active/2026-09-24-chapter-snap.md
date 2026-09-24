---
plan: chapter-snap
harness: v2 · lean
branch: feat/chapter-snap
anchor: spec
status: Building
next: built @c1a3be59, mutants 38/38 RED; hand-off to the Architect for the FULL gate (adversary + qa + security-brief; data class - brief the adversary to destroy the chapter data)
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
- A text-editor save of a snapped item replaces the manual list and drops the provenance (the
  badge and Revert go away) - by design: typed chapters are plain manual chapters.
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
