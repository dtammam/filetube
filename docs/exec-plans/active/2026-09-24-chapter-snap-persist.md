---
plan: chapter-snap-persist
harness: v2 · lean
branch: fix/chapter-snap-persist
anchor: spec
status: Gate r1 fixed @c49a3d73 (P1-P4 + W4 + suggestions; main merged at v1.325.0); awaiting gate r2
next: gate r2 (FULL - data class: adversary + qa + security-brief)
design: Approved 2026-09-24 @7482e432 (Dean's report, relayed by the Architect; the wave intake is recorded in memory wave-2026-09-24-intake)
gate: pending
---

# Chapter Snap: "doesn't survive a page refresh" (diagnosis) and the chapter tap that plays the previous song (fix)

Base: local main 7482e432 (= v1.323.0 + three docs commits). Tech-debt ids #267-#270 reserved
(#267-#269 used). Siblings in flight: fix/snap-offset-and-status-bar, feat/pocket-quick-scroll.

## The ask

Dean (2026-09-24), first report: "Last minor correction to song time correction - it works on
desktop and mobile but doesn't survive a page refresh. I would expect this would modify the real
track info?"

Dean, refined (relayed by the Architect after questions): "at first I had it working on mobile,
thought we were set ... Tried on desktop, then refreshed page... and it was as if the changes
never stuck. I think it is now sticking (I saw :58 as the time for example in one, edited, saw go
to 1:18, saved, closed PWA, it stuck). However it's almost as if the time doesn't 'stick' meaning
I had it set properly with an offset then when I go out/come back it's as if it's completely off
time of the track like the relative offset underneath is off?" He saved and checked in the
POCKET SKIN (Click/Seattle menus), in the installed PWA, on mobile and desktop.

Architect's priority ruling (2026-09-24): secondary to the gyro work. Finish the diagnosis; build
only if the fix is one obvious seam with a clear red -> green test and no new persistence shape;
otherwise stop after the diagnosis.

Dean's decision after the diagnosis (relayed 2026-09-24): widen THIS branch to also fix #268 (a
re-tap of the moved, loaded chapter does nothing) and #269 (another device keeps the old bounds
until it reloads) before ONE full gate; fix #267 too only if it falls out of #269's re-fetch
(it does not: the return re-check reads GET /api/videos/:id, which carries no per-row resume
tags, so #267 stays filed).

## Re-verified survey (read at 7482e432)

- The save: `lib/media/chapterSnapRoutes.js` POST `/api/videos/:id/chapter-snap` writes
  `chaptersManual` inside `updateDatabase` (server.js:783-801: fresh `loadDatabase()` inside the
  lock, synchronous mutator, `saveDatabase` -> `dbAdapter.save`, a one-transaction per-row diff in
  lib/media/items.js `planDiff`/`applyPlan`; the row is the item's whole JSON).
- The resolver: `resolveItemChapters` server.js:2430 (manual > embedded > description), the ONE
  place every chapter reader meets: GET /api/videos/:id (lib/media/routes.js:791), the music
  projection `itemChapterTracks` server.js:4165 -> `projectedLibraryTracks` :4186 (every
  /api/music list, /api/music/:id, search, liked chapter rows), the snap GET, the notification and
  stats chapter counts. No server reader of raw `item.chapters` bypasses it (grep of `\.chapters\b`
  over server.js + lib: the only other hits are writers - the scan's probe, the reheat - and the
  scan's own carry logic).
- Carriers: scan re-init carry-forward orchestrator.js:1122, Phase-2 mirror :1432, reheat
  relocation.js:1305-1320 (re-pulls `chapters` only), backup (verbatim). No whole-item rebuild of
  `db.metadata[id]` from a stale snapshot exists (grep: trash.js:635 and move.js:489 build from the
  FRESH item).
- HTTP/client caches: `public/filetube-worker.js` has NO fetch handler (lines 25-31); the /api/*
  JSON routes send only a weak ETag (measured below); no localStorage/sessionStorage/IndexedDB
  store holds chapter times (grep of every `localStorage.setItem` in public/js).
- The chapter tap: music.js `loadTrack` :2903 passes `chapterResumeSec: chapterResumeSecFor(item)`;
  player.js :4921 seeks there (else to `chapterStartSec`). `item.progress.resumeSec` is attached
  by the SERVER per list response, `musicListProgressMap` server.js:4227, only to the chapter whose
  `[start, start + span)` contains the saved file position (:4251).
- The save seam on the client: music.js `applySnappedChapterTimes` :1720 patches every queued
  `<baseId>::c<n>` row's `chapterStartSec`, `durationSec`, `title`, `chaptersEdited` IN PLACE; it
  does not touch the row's `progress`.
- `chapterResumeSecFor` (music.js :684 at base) checked only the upper side (the v1.311.3 tail);
  it had no lower bound.
- The player's same-id adopt (player.js :156 `ADOPT_FLAVOR_STRING_FIELDS` and its comment): a load
  of the id already loaded keeps the media untouched, "never a field that drives the loaded media
  (... chapter offsets)".

## Diagnosis (every candidate, with its evidence)

Instrument: a scratch probe (session scratchpad `chapter-snap-persist/probe.js`, not committed):
the REAL server in-process on a scratch DATA_DIR, headless Chromium chromium-1234 over CDP, the
editor opened through the real UI, `Page.reload` for the refresh, and the SQLite row read back by
a SEPARATE node process (`node:sqlite`, read-only) so disk is separated from server memory. Two
fixture modes: (a) seeded items + a seeded silence cache (Snap all); (b) `PROBE_REAL=1`: a static
ffmpeg/ffprobe 7.0.2 on PATH ("FFmpeg is available in system PATH"), a real m4a album and a real
mp4 with 8 EMBEDDED chapters, the items created by a REAL `scanDirectories()`, the real silence
scan started by the editor, and the times moved with the +1 s nudges (Dean's "minor correction").

1. **The write never reaches SQLite - FALSIFIED.** After a drill save: API `source=manual
   edited=true starts=[0,242.5,478,...]` and DISK (the separate process) the same list; after
   `Page.reload`, both unchanged. Same for the watch-page save (`video=[0,242.5,478,...]`).
2. **A read path ignores `chaptersManual` or serves a stale projection - FALSIFIED.** After the
   reload: the drill rows' spans, the watch chapters menu (`["0:00","4:02","7:58",...]`, the
   "Edited" badge, the seek notches `[12.125,23.9,...]`), GET /api/videos/:id, and the `/api/music`
   chapter tracks (`chapterStartSec` `[0,242.5,478,...]`, `chaptersEdited: true`) all show the saved
   times. Cache headers on every chapter-bearing GET (`/api/videos/:id`, `/api/music?...` x5,
   `/api/music/albums`, `/api/music/<id>::c1`, `/api/videos/:id/chapter-snap`): only
   `etag: W/"..."` - no Cache-Control, no Expires, no Last-Modified, so no heuristic freshness and
   a changed body changes the validator; the service worker has no fetch handler.
3. **The client re-seeds from a stale local store after a reload - FALSIFIED.** No local store
   holds chapter times; the reload's /api calls (logged over CDP) re-fetch every list; a cold
   `?play=` / resume pointer / dock-return rebuild re-fetches too (`playTrackFromContinue`,
   `rebuildPlayingQueue`).
4. **Something re-writes the old chapters after load - FALSIFIED** for the refresh (the reload's
   writes are `POST /api/prefs`, `/view`, `/progress` - none touches `chaptersManual`), and the
   scan/reheat carriers are bound by the shipped chapter-snap.test.js ("a RESCAN keeps the snap
   edit", "revert seeds from STORAGE after a REHEAT").
5. **The "Edited" badge and Revert after a reload**: survive (`edited:true` on the drill and the
   watch menu after `Page.reload`).

So the STORED chapters survive every refresh measured, which matches Dean's own later
observation ("closed PWA, it stuck"). The first "never stuck" sighting on desktop is not
reproduced by any server or cache path above; see Disclosed gaps (a desktop page that was
already open with the old list keeps its old queue until it reloads).

**The "relative offset underneath is off" - MEASURED, the cause (H3 of the Architect's list).**
A chapter tap resumes at the saved file position when the SERVER attached one to that row
(v1.222). The row's `progress` was computed against the chapter bounds of the moment the list was
fetched. A snap save moves the row's start in place but keeps that `progress`, and
`chapterResumeSecFor` only checked the tail, never the start. So after moving a chapter's start
LATER past where you had been listening, tapping that chapter seeked BEFORE its new start: the
audio played the previous song's tail and the chapter watcher re-labelled the now playing as the
PREVIOUS song. Dean's own edit (:58 -> 1:18) moved a start later.

Real Chromium, 390x844 mobile, REAL mode, the album re-listed after listening (so its rows carry
the saved place), chapter 3 moved 478 -> 498 past the saved place 491.1:

| Step | BEFORE (7482e432) | AFTER (this branch) |
|---|---|---|
| saved place (GET /api/progress) | 491.117744 | 491.135703 |
| tap chapter 3 after the save | t 493.5, playing row = `::c1` (chapter 2, "Sodium Lamps") | t 500.3, playing row = `::c2` (chapter 3) |
| tap chapter 1, then chapter 3 | t 493.6, playing row `::c1` | t 500.4, playing row `::c2` |
| after `Page.reload`, tap chapter 3 | t 500.3 `::c2` | t 502.7 `::c2` |

(t is read 2.5 s after the tap; 498 + ~2.4 s = the new head. The reload row is already right at
base because the server re-homes the saved place against the new bounds.)

**A second, related defect - MEASURED, FIXED in the widened scope (tracker #268).** When the chapter whose
start moved is the one LOADED in the player, tapping its row is a same-id load, which the player
ADOPTS (no seek, by the adopt contract). Measured at base AND on this branch (the list fetched
before playing, so no stale `progress` is involved): after the save, tapping chapter 3 left the
element at t 491.1, paused - the tap did nothing while the display said chapter 3 - until another
chapter was tapped (then chapter 3 -> t 500.4 on both trees). It is pre-existing in kind: a
playthrough that rolled from the loaded chapter into the next leaves the same split between the
loaded id and the heard chapter. Playing (not paused), 390x844: after the save the playhead sat at
493.4 in chapter 2; the re-tap of chapter 3 left it there (t 495.9, playing row `::c1`) at
67a31ca3.

**#269 - MEASURED, FIXED.** Two pages in one headless Chromium (B = a second tab over its own
CDP socket, standing in for the other device). B opened the album and played chapter 1; A was
activated (B `document.visibilityState` -> `hidden`, measured), A saved chapter 3 from 498 to 518
through the real editor, then B was activated again (`visible`). At 67a31ca3: B made 0
`/api/videos/:id` requests on return, its rows kept the old spans (chapter 2 "4:15", chapter 3
"3:44") and a tap on chapter 3 played the OLD start (t 500.4 = 498 + 2.4 s).

## Acceptance criteria

- AC1 A chapter tap never seeks before the tapped chapter's CURRENT start: a saved place earlier
  than `chapterStartSec` is the chapter head. (chapter-snap-resume.test.js "chapterResumeSecFor:
  ... the lower bound")
- AC2 Dean's shape through REAL music.js: the drill's rows carry a saved place inside chapter 2;
  the control tap resumes there (70 s, the fixture reaches the resume state); a "Fix times" save
  through the real seam moves chapter 2 to 75 s; the next tap loads `chapterStartSec: 75` with NO
  `chapterResumeSec`. (chapter-snap-resume.test.js "Dean's shape")
- AC3 Every existing resume behavior holds: a place inside the chapter resumes, the v1.311.3 tail
  rule, the missing-input shapes. (music-chapter-playback.test.js, unchanged, green)
- AC4 The save contract is untouched: no server file changed; times only, count invariant,
  version token and provenance are the shipped ones.
- AC5 (#268) A tap on the LOADED chapter whose current bounds do not contain the playhead seeks to
  its new start (or its saved place when that lies inside) and plays; while the playhead is INSIDE,
  the adopt stands (no seek, no forced play - both axes on the same populated fixture). A
  playthrough that rolled past the loaded chapter is the same shape. The player's shared adopt
  path (player.js) is NOT changed. (chapter-snap-resume.test.js "#268: re-tapping ...", "#268: a
  playthrough ...", "#268 chapterAdoptSeekFor")
- AC6 (#269) visibilitychange -> visible, and a bfcache `pageshow` (`persisted`), ask the server
  ONCE for the chapters of the file the view is about (the playing chapter's file, else the
  chapter album on screen); a change is applied through the SAME `applySnappedChapterTimes` seam
  a local save uses (rows, spans, Edited badge reveal AND clear, the next tap's start); an
  unchanged answer applies nothing; hidden and a non-bfcache pageshow ask nothing.
  (chapter-snap-resume.test.js "#269: back to visible ...")
- AC7 (#269) A local save that lands while the return re-check is in flight wins (the older
  answer is dropped); one re-check at a time. ("#269: a local save that lands ...")
- AC8 (#269) The listeners ride the view signal: every visibilitychange/pageshow registration
  carries a live signal, `destroy()` aborts each one (REMOVED, not merely inert behind the
  re-check's own aborted test), and after it neither event asks anything. ("#269: the return
  listeners go with the view")
- AC9 (#269) The change test: a moved start, a title, a span to the next chapter (a chapter added
  after the last row), a dropped chapter; not a subset of rows, not another file, not
  sub-millisecond noise. ("#269 queuedChaptersDiffer")
- AC10 (#268) A CLOSED player whose `currentId` still names the tapped chapter is a genuine load
  (player.js `isAdoptLoad`), and music never seeks over the player's own resume there (the element
  reads 0 mid-load). ("#268: a CLOSED player ...")
- AC11 (#269) The re-check targets the PLAYING chapter's file even when the list on screen mixes
  files (no single chapter album). ("#269: the re-check follows the PLAYING chapter's file ...")
- AC12 (CORRECTED at gate r1 - the original claim was FALSE, adversary 1 = qa 1) player.js is
  untouched (`git diff 7482e432..HEAD -- public/js/player.js server.js lib` is empty), but that did
  NOT keep every adopt arm's behavior: at 4ceb1945 music's own post-adopt seek also ran on the
  `?play=` continue arm (history BACK re-mounting `/music?play=<loaded chapter>`), rewinding
  playback and overwriting the stored resume position. Since the r1 fix the seek runs ONLY for an
  explicit pick/nav (`opts.pick`: a row tap, the up-next row, the skin's select, a pocket-menu
  pick, Prev/Next); a continue / re-mount / Listen / dock-return load never passes it, so those
  adopt arms keep their pre-branch behavior. (AC13 below binds it.)

## Build record

Files:
- `public/js/music.js`: `chapterResumeSecFor` gains the lower bound (`if (p.resumeSec < start)
  return undefined;`) and its comment says why. The ONE consumer of `progress.resumeSec` on the
  client (grep `resumeSec` over public/js: music.js only, this function) and the ONE producer of
  `chapterResumeSec` for `player.load` (grep: music.js `loadTrack` only; player.js reads it at
  :4921). Every queue kind goes through it: the drill, the flat pocket-menu lists (Songs, Genres,
  Liked, Recently Played, an artist's All Songs), the album pocket levels, recent-listening, the
  `?play=` path (all `playAt` -> `loadTrack`). A Listen video's chapter rows carry no `progress`.
- NEW `test/unit/chapter-snap-resume.test.js` (2 tests; red at base: `actual: 70` and
  `actual: 7.99`; green with the fix).

Why the guard, not a client re-home of `progress` inside `applySnappedChapterTimes`: the server's
`musicListProgressMap` is the one rule for which chapter owns a saved place; a client copy of that
math is the hand-copy the INERT SIBLING lesson warns about. The guard only REFUSES a resume
outside the row's current bounds, so it can never disagree with the server; the cost is that the
chapter that NOW contains the saved place starts at its head (not its resume point) until the
list is next fetched (disclosed).

Round 2 (the widened scope, Dean):
- `public/js/music.js`:
  - #268: pure `chapterAdoptSeekFor(item, t)` (exported) - undefined while `t` is inside the
    row's `[chapterStartSec - 0.25, chapterStartSec + durationSec)` (the chapter watcher's
    tolerance), else the in-bounds saved place (`chapterResumeSecFor`) or the head. `loadTrack`
    computes `adoptingChapter` (a chapter row whose id is the player's loaded id and the player is
    not closed - player.js `isAdoptLoad`'s own predicate) BEFORE `pl.load`, and after the load
    calls `seekAdoptedChapter(item)`: sets the element's `currentTime`, resets the two exit step
    trackers (`lastExitTime`, `lastFlatTime`), `reflectChapter()`, `play()`. (CORRECTED at gate r1:
    this record used to say every existing adopt arm keeps its behavior because player.js is
    byte-unchanged. That was FALSE - the seek also ran on the `?play=` continue arm; see AC12 and
    the Gate r1 fix section. The resets and `reflectChapter()` were dead and are gone.)
  - #269: pure `queuedChaptersDiffer(rows, baseId, chapters)` (exported); in the view,
    `chapterRecheckBaseId()`, `recheckChaptersOnReturn()` (one in flight at a time, drops its
    answer when `chapterApplyGen` moved - `applySnappedChapterTimes` bumps it - or the view was
    torn down), and the two listeners (`document` visibilitychange -> visible, `window` pageshow
    persisted) registered with `{ signal }` (the view's AbortController, aborted by `destroy()`).
- `test/unit/chapter-snap-resume.test.js`: the harness now models the element (a settable
  playhead, a play counter), the player's same-id ADOPT, the server's current chapters for
  `/api/videos/f1` (with a parked answer for the race) and `document.visibilityState`; +7 tests.
  Run against the committed music.js of 67a31ca3 (the pre-widening head) they are RED: `# pass 2
  # fail 7` (`actual: 70`, `actual: 130`, `actual: 0` x3, and the two pure helpers missing).

Instrument outputs (Node 22.23.1):
- Round 1: `node --test test/unit/chapter-snap-resume.test.js test/unit/music-chapter-playback.test.js
  test/unit/chapter-snap-client.test.js`: `# tests 26 # pass 26 # fail 0`.
- Round 2: `node --test test/unit/chapter-snap-resume.test.js`: `# tests 9 # pass 9 # fail 0`
  (11/11 after the mutant-round test additions at b3640e11 and 4ceb1945);
  `node --test test/unit/music*.test.js test/unit/chapter*.test.js test/unit/skin*.test.js
  test/unit/listen*.test.js test/unit/pocket*.test.js`: `# tests 738 # pass 738 # fail 0`.
- `npx eslint public/js/music.js test/unit/chapter-snap-resume.test.js`: no output (clean).

## Measurements

See the Diagnosis tables. Probe runs: seeded mode 1440x900; REAL mode 1440x900 (entries 1, 2 and
3) and 390x844 mobile (the H3 table), each against a `git archive 7482e432` sandbox (BEFORE) and
this tree (AFTER).

Round 2, real Chromium (REAL mode, 390x844 mobile), BEFORE = a sandbox of 67a31ca3, AFTER = the
working tree of 90b494fb (music.js is byte-identical at the head 4ceb1945; only tests changed since):

| Measurement | BEFORE (67a31ca3) | AFTER (this branch) |
|---|---|---|
| #268 playing chapter 3, saved 478 -> 498 while the playhead was ~492: playhead after the save | t 493.4, playing row `::c1` | t 493.4, playing row `::c1` |
| #268 re-tap chapter 3 (the loaded id) | t 495.9, paused false, row `::c1` (the tap did nothing) | t 500.5, paused false, row `::c2` (the new start + 2.5 s) |
| #269 B's `visibilityState` when A is activated / B again | hidden / visible | hidden / visible |
| #269 B's `/api/videos/:id` requests on return (Resource Timing) | 0 | 1 |
| #269 B's chapter 2 / chapter 3 spans after return (A moved 498 -> 518) | 4:15 / 3:44 (old) | 4:35 / 3:24 (new) |
| #269 B taps chapter 3 | t 500.4 (the OLD start 498) | t 520.4 (the NEW start 518), row `::c2` |

## Mutant table

Runner: session scratchpad `chapter-snap-persist/mutants.sh` - a fresh sandbox from `git archive
57fe4fe4` per mutant (+ a node_modules symlink), ONE anchor that must match exactly once, the file's
sha1 before -> after printed, then `node --test test/unit/chapter-snap-resume.test.js
test/unit/music-chapter-playback.test.js`. Commit 57fe4fe4 went through the pre-commit hook:
`tests 7250 pass 7250 fail 0`.

| # | Mutant (music.js) | bytes | Result | Binding test(s) that red |
|---|---|---|---|---|
| CONTROL | the guard replaced by itself | 3e8f46b40ee3 -> 3e8f46b40ee3 | `# fail 0` | - |
| M1 | the lower bound removed | 3e8f46b40ee3 -> 8fc6ca97c364 | RED, `# fail 2` | "Dean's shape", "chapterResumeSecFor: ... the lower bound" |
| M2 | the lower bound made inclusive (`<=`) | 3e8f46b40ee3 -> ab28bb5a036f | RED, `# fail 1` | "chapterResumeSecFor: ... AT the start it is" |
| M3 | `loadTrack` passes the raw `progress.resumeSec` (the helper bypassed) | 3e8f46b40ee3 -> 55749c9ad9b9 | RED, `# fail 2` | "Dean's shape", v1.311.3 row-click tail test |
| M4 | the bound compared to 0, not the chapter start | 3e8f46b40ee3 -> d7a23efeace4 | RED, `# fail 2` | "Dean's shape", "chapterResumeSecFor: ... the lower bound" |

**Round 2 @4ceb1945** (the widened scope; runner `chapter-snap-persist/mutants2.sh`, the same
rules, anchors counted by exact occurrence; binding tests chapter-snap-resume, music-chapter-playback,
chapter-snap-client). The first run @90b494fb had two SURVIVORS, both closed by test commits
(b3640e11, 4ceb1945) before this table: N6 (a closed player read as an adopt - the harness never
modelled `closed` nor a genuine load's mid-load 0) and N12 (the pageshow listener registered
without the signal - inert only because the re-check also tests `signal.aborted`; the harness now
records every registration and binds that destroy aborts its signal). Commits b3640e11 and
4ceb1945 went through the hook: `tests 7258 / 7259 pass, fail 0`.

| # | Mutant (music.js) | bytes | Result | Binding test(s) that red |
|---|---|---|---|---|
| CONTROL | a guard replaced by itself | 83e9fabb6133 -> 83e9fabb6133 | `# fail 0` | - |
| N1 | the adopt never detected | -> 333c33d67873 | RED (2) | #268 re-tap, #268 playthrough |
| N2 | seek even inside the bounds | -> 5aaf909ec38d | RED (2) | #268 re-tap (control axis), chapterAdoptSeekFor |
| N3 | no play() after the seek | -> 0b803712b004 | RED (1) | #268 re-tap "and it plays" |
| N4 | the adopt seek ignores the in-bounds saved place | -> 34ad6e784c12 | RED (2) | #268 playthrough, chapterAdoptSeekFor |
| N5 | the 0.25 s tolerance removed | -> e27271b126ba | RED (1) | chapterAdoptSeekFor |
| N6 | a closed player counts as an adopt | -> 777691dcbb89 | RED (1) | #268 CLOSED player |
| N7 | the in-flight answer's generation check removed | -> 3ee55bb979f9 | RED (1) | #269 local save wins |
| N8 | applySnappedChapterTimes does not bump the generation | -> 538f85bba937 | RED (1) | #269 local save wins |
| N9 | the one-in-flight guard removed | -> 7643e9ce1bb4 | RED (1) | #269 local save wins ("one re-check at a time") |
| N10 | visibilitychange fires the re-check while hidden | -> 47f0f6bfde3f | RED (1) | #269 back to visible |
| N11 | any pageshow (not only bfcache) re-checks | -> adad937cc96e | RED (1) | #269 back to visible |
| N12 | the pageshow listener without the view signal | -> 176bd9c91ae9 | RED (1) | #269 listeners go with the view |
| N13 | the visibilitychange listener without the view signal | -> 16b2fa106da5 | RED (1) | #269 listeners go with the view |
| N14 | apply without the change test | -> 8f75539bdd5e | RED (1) | #269 back to visible ("not re-rendered") |
| N15 | the change test ignores the span to the next chapter | -> ccc45a84248d | RED (1) | queuedChaptersDiffer |
| N16 | the change test ignores the title | -> 8d2d914067b6 | RED (1) | queuedChaptersDiffer |
| N17 | no playing-file arm (album on screen only) | -> f0975d3df22c | RED (1) | #269 playing file on a mixed list |
| N18 | the re-check drops `chaptersEdited` | -> ab0b06fddeb8 | RED (1) | #269 back to visible (the badge) |
| N19 | the in-flight flag never cleared on success | -> 5044ce3e10d2 | RED (1) | #269 back to visible (the second return) |

Reachability: the real-Chromium H3 table above is the end-to-end run of the same guard (BEFORE
t 493.5 on chapter 2, AFTER t 500.3 on chapter 3), through the drill's real rows, the real
`/api/music` progress attach, the real snap save and the real player seek.

## Disclosed gaps

- #267: after a save, the chapter that NOW contains the saved place starts at its head instead of
  resuming there, until the list is fetched again (any album/menu re-open or a reload re-homes it
  on the server). No wrong audio, only a lost resume point.
- #268 CLOSED here. Residual by design: a re-tap while the playhead is INSIDE the loaded chapter
  still adopts (no restart), as before.
- #269 CLOSED here for the MUSIC view (the queue, the drill, the pocket menus via
  `invalidateMenuData`, the resume guard's spans). Residuals: (a) the WATCH page's chapters menu
  and seek notches on a page left open elsewhere are not re-checked on return (player.js has no
  such listener; outside the Music scope Dean reported); (b) CORRECTED at gate r1 (qa W3): this
  used to say other queued chaptered files "are refreshed when they are played". They were NOT -
  `loadTrack` read the queued row, so the first pick of another file played its OLD start. Since the
  r1 fix every other chaptered file queued at a return is UNVERIFIED and its first pick asks the
  server once, applies a change, then plays the corrected start (AC16); (c) a page that stays
  visible the whole time (two desktop windows side by side) is not re-checked until it is hidden
  and shown again - no polling, by the brief. (a), (c) and the r1 residuals are OPEN as #270.
- Not measured on a real iPhone PWA (headless Chromium only).

## Gate r1 fix (Dean's decision relayed by the Architect: fix P1-P4 as new commits)

Commits: 12e16523 (the r1 verdicts, committed as the seats wrote them), 58753b65 (merge main
ec606e2f = v1.324.0; tracker conflict resolved keeping every row), aba8633e (P1-P4 + tests),
ade79b21 (merge main 2be1ebb2 = v1.325.0, forced by the release-ledger hook; no conflicts),
7fe73cdf (the mutant-survivor bindings), c49a3d73 (a partial drill repaints its rows), and this
docs commit. Every code commit went through the pre-commit hook (`tests 7354 pass 7354 fail 0` at
c49a3d73).

- **P1 (CRITICAL, adversary 1 = qa 1) FIXED.** `loadTrack` re-seeks an adopted chapter only for
  `opts.pick`, passed by the pick/nav callers: the in-album row tap and `playRowAt` ->
  `playTrackInAlbum` (threaded as `pick`), the now-playing up-next row, the skin's `onSelectIndex`,
  `playFromMenu` (every pocket-menu pick) and Prev/Next (`registerTrackNav`). Never passed by
  `playTrackFromContinue` (`?play=` incl. history BACK, "Jump back in", a Home Continue card),
  `playListenItem`, the dock-return rebuild, the album/drill Play and Shuffle buttons, the station
  continuations or the flat segment-end advance. The adopt test is player.js's own `isAdoptLoad`
  page global (qa S5; an inline fallback only where player.js is absent, i.e. a unit harness).
  The dead `reflectChapter()` / step-tracker resets in `seekAdoptedChapter` are removed (adv S5).
- **P2 (W, adversary 2 = qa 2) FIXED.** `applySnappedChapterTimes` judges a count change ONLY on
  the album drill of the file (`ownsDrill` - the one queue holding the file's COMPLETE list): there
  a server count unlike the queued count re-lists (a new chapter needs its row). Every other queue
  (flat pocket-menu lists, Up next, a mixed or partial drill, a search) is patched in place and
  loses only rows whose chapter no longer exists (`droppedAny`). A flat list is redrawn from ITSELF
  (`renderSongListProgressive`, or the drill view for an artist's All Songs), never re-listed; a
  mixed/partial drill repaints its patched rows. The toast concern: `render()` catches a failed
  list fetch and never rejects, so the "Chapters saved, but the list could not be refreshed" toast
  is not reached by a failed re-list at all (measured on the passive path: no toast); no guard was
  added for an unreachable arm. What a failed re-list DOES do (it empties the drill) is filed in
  #270 (d).
- **P3 (qa W3, the Architect's ruling) FIXED.** `recheckChaptersOnReturn` marks every OTHER
  chaptered file in the queue unverified (`markOtherChapterFilesUnverified`); `playAt` hands a pick
  of an unverified file to `verifyChapterFileThenPlay`: one GET /api/videos/:id, a change applied
  through `applySnappedChapterTimes`, then `playAt` of the SAME row object (patched in place). A
  newer pick while it is in flight wins (`playGen`); a failed verify plays the row as queued and
  keeps the file unverified; a failed RETURN re-check leaves the checked file unverified too.
  Verified files never ask again until the next return.
- **P4 (adversary 3) BOUND:** the on-screen album fallback, the failure path's in-flight reset
  (offline return, then an online return asks again and applies), and the post-await liveness
  check (park the answer, destroy, release: no nav re-registered).
- **W4 (qa)** the design line carries `@7482e432`.
- **S4** a +0.5 s shift on a subset `[c1]` and on the last row is detected (pure test). **S5** done
  (P1). **S6** recorded below. **S7** filed as #270 (OPEN). **S8** the probe flags are recorded
  with every measurement below.

S6 (qa) - a diagnosis candidate the first pass did not list: **two media items with independent
chapter lists.** The probe's fixture shows it: the audio item's save left the VIDEO item
`source=embedded` untouched, and the watch-page save left the audio item alone. A Listen of a
video and the audio album look alike in the pocket skin, so "edited in one, checked the other"
would also read as "never stuck". Recorded as a plausible reading of Dean's first desktop
sighting, NOT tested on his data. Should a snap on one copy reach the other? Not built: the two
items can legitimately differ (a video's chapters include intro/outro the audio rip lacks), and
chapter likes/progress are keyed per item. A "same release" link between items does not exist
today; noted for Dean.

New acceptance criteria (each names its binding test in chapter-snap-resume.test.js unless noted):
- AC13 (P1) A re-mount of `/music?play=<the loaded chapter>` with the file rolled on keeps the
  playhead (130 stays 130), no seek, no play ("r1 P1: a re-mount ..."); Prev and Next onto the
  loaded chapter, a pocket-menu pick and a Songs-row album select ARE picks ("r1 P1: Prev/Next",
  "r1 P1: Next onto", "r1 P1: a pocket-menu pick", "r1 P1: a Songs-list row tap"); the adopt test is
  the player's global when present ("r1 P1 (qa S5)"); the two select callsites carry `pick: true`
  (music-chapter-reflect.test.js classification lock, extended).
- AC14 (P2) A flat list `[f1::c1, g9::c0]` after a remote move: no `/api/music` re-list, the same
  rows, its crumb, the new span in place, Next = the list's next row; a dropped chapter leaves only
  its row; a partial album drill with a moved chapter AND a remote add repaints and does not
  re-list; the complete drill still re-lists on a count change and shows no "saved" toast when that
  re-list fails. Integration (REAL server + REAL engine, the adversary's repro):
  test/integration/chapter-snap-return-flat.test.js - Liked Songs holding one chapter, Autoplay
  off, a later chapter moved OR the liked chapter itself moved: no Songs re-list, and the flat
  segment end still pauses at the new boundary.
- AC15 (P4) the fallback, the failure-then-success return, the post-await liveness check.
- AC16 (P3) After a return, the first pick of ANOTHER queued file's moved chapter asks once and
  plays the NEW start; the second pick does not ask; without a return nothing asks; a newer pick
  during the verification wins; a failed return re-check makes the playing file's next pick ask.

Red at the pre-fix head: the unit file run against `git archive 12e16523` gave `# pass 18 # fail 5`
(the P1 re-mount, the S5 global, both P2 flat cases and the P3 case red; the P4 arms and S4 bind
code that was already right, so they pass there by design); the integration file at 12e16523:
`# pass 0 # fail 2`. At the head: unit 29/29, integration 2/2.

### Mutants (gate r1 fix)

Runners (session scratchpad `chapter-snap-persist/`): `mutants3.sh` (the new code),
`mutants2.sh` (round 2 re-run on the moved code, re-anchored), `mutants4.sh` (the round-2 mutants
whose anchors moved). Binding set: chapter-snap-resume, music-chapter-playback, chapter-snap-client,
music-chapter-reflect (unit) + chapter-snap-return-flat (integration). Sandbox per mutant from
`git archive c49a3d73`, exact-occurrence anchors, sha1 before -> after printed. CONTROL: `# fail 0`.
The first run (@aba8633e) left R3, R5, R6, R10, R16, R17 and R18 green: R3/R5/R6/R16/R17 got binding
tests (7fe73cdf); R10 survived again because the partial-drill test moved nothing the queued rows
showed - made non-vacuous, which exposed that a mixed/partial drill never repainted its patched
rows (fixed, c49a3d73); R18 (the verify path's apply-generation check) was unreachable (no save of
a file can land while its pre-play verification runs - it is not playing yet) and was removed.

| # | Mutant @c49a3d73 | Result | Binding test(s) |
|---|---|---|---|
| R1 | the pick flag ignored | RED (1) | r1 P1 re-mount |
| R2 | Prev without pick | RED (1) | r1 P1 Prev |
| R3 | Next without pick | RED (1) | r1 P1 Next onto |
| R4 | in-album row tap without pick | RED (3) | #268 re-tap, #268 playthrough, r1 S5 |
| R5 | playTrackInAlbum does not thread pick | RED (1) | r1 P1 Songs-list row |
| R6 | pocket-menu pick without pick | RED (1) | r1 P1 pocket-menu pick |
| R7 / R8 | skin select / up-next row without pick | RED (1) each | the v1.311 classification lock |
| R9 | the player's isAdoptLoad global ignored | RED (1) | r1 S5 |
| N6b | the inline fallback counts a CLOSED player as an adopt | RED (1) | #268 CLOSED player |
| R10 | count judged by the highest queued index | RED (1) | r1 P2 partial drill |
| R11 | a dropped chapter never counts | RED (1) | chapter-snap-client Listen-mode count change |
| R12 | no flat redraw | RED (2) | both r1 P2 flat cases |
| R19 | only the complete drill repaints | RED (1) | r1 P2 partial drill |
| R13 | other files never marked unverified | RED (2) | r1 P3 first pick, r1 P3 newer pick |
| R14 | no verify gate in playAt | RED (3) | r1 P3 x3 |
| R15 | verified file never cleared | RED (the file does not complete: verify -> playAt -> verify loops) | chapter-snap-resume.test.js |
| R16 | verify ignores a newer pick | RED (1) | r1 P3 newer pick |
| R17 | a failed return re-check does not re-mark | RED (1) | r1 P3 failed re-check |
| N20 | the verify never applies | RED (2) | r1 P3 first pick, r1 P3 failed re-check |
| N18a | the return re-check drops `chaptersEdited` | RED (1) | #269 back to visible |

Round 2 re-run @c49a3d73 (the code moved): N2 RED (2), N3 RED (1), N4 RED (6), N5 RED (1), N7
RED (1), N8 RED (1), N9 (re-anchored to the new in-flight guard) RED (1), N10 RED (1), N11 RED (1),
N12 RED (1), N13 RED (1), N14 RED (1), N15 RED (3, now incl. the integration file), N16 RED (1),
N17 RED (5), N19 RED (1). (N1 / N6 hit code the r1 fix replaced - R1 and N6b above.) Round 1 (M1-M4,
`chapterResumeSecFor`) touched code is unchanged since 57fe4fe4.

### Measurements (gate r1 fix; real Chromium chromium-1234, 390x844 mobile, REAL mode)

Probe `chapter-snap-persist/probe.js` (flags per run, qa S8), the adversary's probe copied as
`chapter-snap-persist/adv-probe.js` (MODE=268), runner `drives.sh`. BEFORE = a sandbox of 12e16523
(= the r1-reviewed code + the merge), AFTER = this tree at c49a3d73.

| Drive (flags) | BEFORE 12e16523 | AFTER c49a3d73 |
|---|---|---|
| adv MODE=268: `?play=<id>::c0` -> seek 500 -> Home -> history.back(): playhead after BACK (+3.5 s) | t 3.4, row `c0` | t 507.9, row `c2` |
| the same: stored GET /api/progress 6 s later | 9.38 | 513.94 |
| PROBE_REAL=1 PROBE_FLAT=1: Liked Songs `[c1]`, Autoplay off, another client moves chapter 3 478 -> 498, the page returns: requests | `/api/videos/<id>`, `/api/music?sort=newest&limit=1000` | `/api/videos/<id>` |
| the same: the list after the return | crumb "", rows c0..c7 (the whole library) | crumb "Liked Songs", rows `[c1]` |
| the same: 2 s before the new segment end 498, 4.5 s later | t 500.4, playing on into chapter 3 | t 497.8, paused (K4) |
| PROBE_REAL=1 PROBE_STALE=1 PROBE_RELIST=1 (H3): tap chapter 3 after 478 -> 498 | (67a31ca3: t 493.5 on `c1`) | t 500.4 on `c2` |
| PROBE_REAL=1 PROBE_268=1: re-tap the loaded chapter 3 after the move (row tap = pick) | (67a31ca3: t 495.9 on `c1`) | t 500.5, playing, `c2` |
| PROBE_REAL=1 PROBE_269=1: B's requests on return / B taps chapter 3 | (67a31ca3: 0 / t 480.4 on the old 478) | 1 / t 500.4 on the new 498 |

(qa S8: the earlier "498 -> 518" #269 row came from a COMBINED run, `PROBE_REAL=1 PROBE_268=1
PROBE_269=1`, where the #268 section had already moved chapter 3 to 498; `PROBE_269=1` alone gives
478 -> 498, as above.)

## Gate verdicts

(reserved for the Architect's gate rounds)

## Gate r1 - security-brief (@5d1e9ada)

**Could NOT complete (no Bash in this seat):** no `git diff`, no test run, no check that the
worktree is clean. So I did NOT verify the "client-only" claim (`git diff 7482e432..5d1e9ada --
server.js lib public/js/player.js` empty); I only read the files as they are on disk. What I did
confirm: the worktree HEAD is `refs/heads/fix/chapter-snap-persist` = `5d1e9ada30d9...` (read from
`.git/worktrees/.../HEAD` and the ref file). The main checkout is NOT the before-state for
music.js: it has v1.324 pocket-quick-scroll code (`menuTotal`, `MENU_RECENT_URL`, `letters:`) that
this branch's base does not. I compared carefully and allowed for that.

Scope: `public/js/music.js` at 5d1e9ada. I read `chapterResumeSecFor`, `chapterAdoptSeekFor`,
`queuedChaptersDiffer` (:684-737), `applySnappedChapterTimes` + `chapterApplyGen` (:1764-1833),
`chapterRecheckBaseId` / `recheckChaptersOnReturn` / the two listeners (:1844-1884), the `loadTrack`
adopt arm + `seekAdoptedChapter` (:3038-3081), `fetchJson` (:860), `init`'s `signal` (:868) and
`destroy()` (:4000-4002). I also read the server handler `lib/media/routes.js:732` GET
/api/videos/:id, and the title sinks `buildSongRowHtml` (:219), `buildNowPlayingPanelHtml` ->
`skin-surface.js buildPanelHtml` (:2035-2069) and `renderSongListProgressive` (:3625).

What I verified (traced in the code):
- **Same route, same authentication and authorization.** The re-check calls
  `fetchJson('/api/videos/' + encodeURIComponent(baseId))`. That is a same-origin relative URL, so
  it sends the session cookie. It is the same route `extrasFetchItem` (:1886) and the listen path
  (:2798, :3744) already use. The handler returns 404 for both a missing item and one where
  `!mediaVisibleTo(req, item)` (v1.80 RBAC). The chapters it sends back belong to an item the
  caller may see. No new request target: in a grep for write/network calls in music.js, the only
  line this branch adds is :1871.
- **Restricted or deleted item: no throw, no stale data applied.** A 404 makes `fetchJson` throw
  (`!res.ok`). `.catch` clears `chapterRecheckInFlight` and does nothing else. A null or non-object
  body stops at `!v`. A missing or non-array `chapters` stops at `!chapters`. A malformed entry
  (null, or a non-numeric `startTime`) is a "differ", and the `keepPatched` seam drops that row
  (`!ch || !isFinite(...)`). Nothing in the path indexes `chapters` with a key that is not a
  number (`\d+` from the regex), so there is no prototype-key read. Any throw inside the `.then`
  lands in the same `.catch`.
- **No polling, and a visibility flap does not multiply requests.** A request is sent only on a
  `visibilitychange` whose state is `visible`, or on a `pageshow` with `persisted`. There is no
  timer and no retry. `chapterRecheckInFlight` allows one request at a time, so the two events of
  a bfcache restore collapse into one GET. Rapid flapping gives at most one cheap
  `getCachedDatabase()` read per return, and only for the one file.
- **The listeners are removed on teardown.** Both registrations pass `{ signal: signal }`, the
  view's AbortController signal (:868), and `destroy()` calls `controller.abort()` (:4002). An
  answer that arrives after teardown is dropped by `signal.aborted`, checked before the request
  and after the await (so it is not a TOCTOU gap).
- **Response strings are rendered safely.** Only chapter `title` (a string) and numbers reach the
  queue rows, through the existing `applySnappedChapterTimes` seam. A local snap save and the
  `/api/music` lists already feed that seam the same server data. The HTML sinks I traced escape
  the title: `escapeMusicHtml` in the song row, and `panelEscape` for the title and every Up-next
  row. Numbers pass through `Number()`/`isFinite`.
- **The resume guard and the adopt-aware seek are pure client logic.** `chapterResumeSecFor` and
  `chapterAdoptSeekFor` are pure. `seekAdoptedChapter` sets `mp.currentTime`, resets two
  in-memory trackers, calls `reflectChapter()` and `play()`. None of them writes to
  localStorage, sessionStorage or IndexedDB, and none sends a request. The grep comparison with
  main shows no new `setItem` and no new POST/DELETE. Moving the playhead is later saved by the
  player's EXISTING `/api/progress` pipeline, and `loadTrack` makes its EXISTING
  `/api/music/resume` POST as before. Neither is new.

Findings:
- **INFO-1 (suspicion, not a finding): a non-converging diff re-applies on every return.** If the
  server's chapters are not strictly increasing (next `startTime` <= this `startTime`),
  `queuedChaptersDiffer` reports a span change, but `keepPatched` never writes `durationSec`
  (`end > start` is false). Every later return then re-applies: `invalidateMenuData` +
  `renderDrillView`, or one `render()` list fetch after a count change. Each return still makes
  at most one GET. The user's own tab switching is the only trigger, so no attacker can use this.
  Only performance is affected, not security. I did not check whether any resolver can produce non-monotonic
  chapters.
- **INFO-2: the in-flight flag has no timeout.** A GET that hangs forever (no `fetch` timeout)
  leaves `chapterRecheckInFlight` true, which turns off the re-check until the view is torn down.
  It fails closed (nothing is applied) and only affects this one view.
- **INFO-3: a revoked item stays in the queue.** After a restriction or a delete, the re-check's
  404 applies nothing, so the queued rows keep the titles the user could already see. Nothing new
  leaks. It is simply not a revocation sweep, and it never claimed to be.

No CRITICAL / HIGH / MEDIUM / LOW. The comments I read that make security-relevant claims ("the
listeners ride the view signal (removed on every teardown)", "No polling; one request per
return") match the code.

Gate: APPROVED r1 @5d1e9ada — security-brief

## Gate r1 - adversary (@5d1e9ada)

Instruments (Node 22.23.1, all in /tmp sandboxes from `git archive`; the worktree was never edited
beyond this section): `node --test` chapter-snap-resume + music-chapter-playback +
chapter-snap-client: `# tests 35 # pass 35 # fail 0`; `test/unit/music*.test.js chapter* skin*
listen* pocket*`: `# tests 740 # pass 740 # fail 0`; `test/integration/music-pocket-menus*.test.js
chapter-snap*.test.js`: `# tests 73 # pass 73 # fail 0`; `npx eslint public/js/music.js
test/unit/chapter-snap-resume.test.js`: exit 0, no output. `git diff 7482e432..5d1e9ada --
server.js lib public/js/player.js | wc -l`: 0. Builder mutants re-run in my own runner: N1, N2, N6,
N7, N9, N12, N14, N17 and M1 all RED, with the builder's exact after-hashes.

1. **CRITICAL - #268's adopt seek fires on the `?play=` continue arm, a genuine same-id hand-off
   that must not seek, and it overwrites the stored resume position.** `?play=` is never stripped
   from the URL, so BACK to a `/music?play=<chapter>` history entry re-inits the view and
   `playTrackFromContinue` -> `playTrackInAlbum` -> `playAt` -> `loadTrack` loads the SAME id the
   player still holds. With the file rolled on past that chapter, `adoptingChapter` is true and
   `seekAdoptedChapter` pulls the playhead back to the chapter's head and plays it. Real Chromium
   (the real router and player, a 2000 s mp3 with 8 chapters, 1440x900; the flow: Home ->
   `navigate('/music?play=<id>::c0')` -> seek to 500 (chapter 3 plays) -> `navigate('/')` ->
   `history.back()`):
   | | BEFORE 7482e432 | AFTER 5d1e9ada |
   |---|---|---|
   | after BACK (+3.5 s) | t 507.9, row `c2` | t 3.4, row `c0` |
   | stored GET /api/progress 6 s later | timestamp 513.98 | timestamp 9.34 |
   The builder's own harness reproduces it (boot at `?play=f1::c0`, `media.t = 130`, `destroy()` +
   `init()`): AFTER playhead 0, seeks +1 `[0]`, plays +1; BEFORE playhead 130, seeks +0. The same
   arm runs for a "Jump back in" tile (the strip is filled ONCE at init, so it names the chapter
   loaded then) and a Home Continue card naming the loaded chapter. The Build record's "every
   existing adopt arm (watch<->music same-id hand-offs, dock-return, `?play=`) keeps its
   behavior" and AC12's framing are therefore false: player.js is unchanged, but music's own
   post-adopt seek now runs on the `?play=` arm. Prescription: seek only for a pick or a nav (a row
   tap, the skin's select, a pocket-menu pick, Prev/Next), never from `playTrackFromContinue`
   (continue means keep playing); bind it with the re-entry repro above (red today).

2. **WARNING - #269 re-lists the whole Songs library over a FLAT pocket-menu queue.** The re-check
   applies through `applySnappedChapterTimes`, whose `countChanged` compares the highest queued
   index + 1 with the server's count. A queue holding only SOME of a file's chapters (a Liked
   Songs or Recently Played list) reads as a count change, and with `tab === 'songs'` (every flat
   pick sets it) `render()` -> `loadSongs({})` replaces the playing queue. Measured through the
   REAL view + skin engine against a REAL server (the pocket-menu harness, the r1 fixture's
   `djmix1` chapters 0 / 300 / 900, `djmix1::c1` liked, Autoplay off, Track A played from
   Playlists > Liked Songs, then another writer moves Track B 900 -> 905, same count):
   - control, no return, end at 900: pause +1, onNext not armed (the list ends, K4);
   - control, return with the server unchanged: requests `["/api/videos/djmix1"]`, then the same;
   - the finding: requests `["/api/videos/djmix1","/api/music?sort=newest&limit=1000"]`; at the
     new segment end (905) loads +0 and pauses +0, so the file plays on into Track B (K4 says
     never), and onNext is armed to the library list.
   With Autoplay on it is masked only when a station pick happens to be a later chapter of the
   same file (my first run: queuedCount 3). The seam is pre-existing for a LOCAL save made while a
   flat subset list plays (by code reading, not measured at base); #269 makes it fire passively on
   any return after a remote edit. Prescription: a count change is a queued row whose index is
   >= `chapters.length`, or a queue that holds the file's complete set (the drill); bind with the
   repro above.

3. **WARNING - three #269 arms are unbound (each mutant survives with 35/35 green).**
   - `chapterRecheckBaseId` fallback to the chapter album on screen replaced by `return null`
     (hash 83e9fabb6133 -> 26a2056c0d80). AC6 claims this arm. In real Chromium it works: page B
     with the album drill open and nothing played made 1 request per return over 4 flips.
   - the `.catch` no longer clears `chapterRecheckInFlight` (-> 8e9bcc1b8c3d). A failure (offline,
     404 deleted, 404 restricted) would then disable #269 for the life of the view. The code is
     right today, measured in real Chromium: an OFFLINE return made 1 failed attempt, and the next
     online return made 1 request and applied the server's move (rows 4:20 / 3:40).
   - the post-await `signal.aborted` check removed (-> b0f774532ecd), the TOCTOU guard. Reasoned,
     not measured: an answer landing after `destroy()` would run `applySnappedChapterTimes` in the
     dead closure (`renavPlaying` -> `player.setTrackNav` with a dead view's `playAt`).
   Each needs a test that goes red on its mutant (for the last one: park the answer, destroy,
   release).

4. **SUGGESTION - `queuedChaptersDiffer`'s start precision is unbound where the span test cannot
   see a move.** Mutant `> 0.0005` -> `> 1` survives. On the pure function, a Shift-all of +0.5 s
   (chapters 2..N, the sibling branch's control) on a subset queue `[c1]` or on the last row:
   real `true / true`, mutant `false / false`. Add a Shift-all case.

5. **SUGGESTION - dead code in `seekAdoptedChapter`.** Deleting `reflectChapter()` (-> 644719f63b20)
   or the `lastExitTime/lastFlatTime` resets (-> 94ceb619a35a) leaves every test green. By reading,
   neither does anything: `loadTrack` already set `chapterViewId = item.id` and `lastExitTime =
   -1`, the target lies inside the item, and the flat step test needs `t >= end`. `isFinite(now)` is
   an equivalent mutant (NaN comparisons already fall through to the seek). Drop them, or make the
   "(the exits' step tests)" comment true.

Verified clean (measured): the listener census in real Chromium over 6 SPA music mounts is
`visibilitychange 7 / pageshow 3` while mounted (base 6 / 2) and back to 6 / 2 on Home, so there is
no leak and teardown removes them; 1 request per return over 4 flips; a fast double tap inside a
genuine load does not fight the player's resume (the 2nd tap read 480, which the player had
already set; AFTER t 482.2 vs BEFORE 482.8); the service worker has no fetch handler (its
listeners: install, activate, push, notificationclick, pushsubscriptionchange). Diagnosis: I found
no other cause. Stored data is untouched by the diff (0 lines above), and the stale-tag mechanism
matches the H3 table, but I did not re-run the REAL-mode H3 probe myself (reasoned from its
recorded output and the code, not measured). Other mutants tried: currentId != null dropped,
isChapter dropped and a non-array `chapters` all survive as redundant or equivalent; the
non-chapter guard in `chapterAdoptSeekFor` is RED (1); `chapterAdoptSeekFor` reading the raw
`progress` is RED (2).

Scratch, outside the worktree: /tmp/adv-csp (probe.js, mut.js + m1.js/m2.js, sandbox tests
sb/test/unit/zz-adv-268.test.js and sb/test/integration/zz-adv-flat.test.js), kept for the r2
re-run.

Gate: CHANGES r1 @5d1e9ada — adversary

## Gate r1 - qa (@5d1e9ada)

Instruments (Node 22.23.1, FILETUBE_TEST_FFMPEG set; run in this worktree read-only, probes and
scratch tests in /tmp sandboxes from `git archive`):
- `node --test test/unit/chapter-snap-resume.test.js`: `# tests 11 # pass 11 # fail 0`.
- `node --test test/unit/chapter-snap*.test.js test/unit/music*.test.js test/unit/player-adopt*.test.js
  test/unit/*census*.test.js`: `# tests 672 # pass 672 # fail 0 # skipped 0`.
- `npm run test:unit`: `# tests 7259 # pass 7258 # fail 1`. The one failure is `release-ledger.test.js`
  "ledger: complete against the tag history": `tags with no ledger entry: 1.324.0`. The tag v1.324.0
  was cut on main (57ed7393) after this branch's base, and tags are repo-global, so this is branch
  staleness, not the diff. It clears when main is merged in. (Reasoned: I did not run base.)
- `npm run lint:css`: `TOTAL 0`. `npm run lint:overlay`: `overlay-containment: clean (0 violations)`.
  `npx eslint .`: `6 problems (0 errors, 6 warnings)`, all in common.js, which this diff does not
  touch. `npx eslint public/js/music.js test/unit/chapter-snap-resume.test.js`: exit 0, no output.
- `.harness/lib/check-markers.sh`: exit 1, `docs/exec-plans/active/2026-09-24-chapter-snap-persist.md:
  approval marker has no @<sha>` (finding 4).
- `git diff 7482e432 5d1e9ada -- public/js/player.js server.js lib | wc -l`: `0`. The diff touches
  only music.js, the new test, the plan and the tracker.
- NOT run: `npm test`, the integration half. Disclosed.
- The builder's probe (`chapter-snap-persist/probe.js`, byte-identical copy, sha1 190956c8), REAL
  mode, 390x844, one run per mode, on `git archive 5d1e9ada` (AFTER) and `git archive 7482e432`
  (BEFORE):

  | Probe step | BEFORE 7482e432 | AFTER 5d1e9ada |
  |---|---|---|
  | moved chapter (478 -> 498, saved place 491.1): tap chapter 1, then chapter 3 | t 493.5, row `::c1` | t 500.4, row `::c2` |
  | the same, after `Page.reload` | t 500.3 `::c2` | t 502.6 `::c2` |
  | #268 re-tap the loaded chapter 3 after the save (playhead 493.5 in `::c1`) | t 496.1, row `::c1` (the tap did nothing) | t 500.4, row `::c2` |
  | #269 B's `/api/videos/:id` requests on return | 0 | 1 |
  | #269 B's chapter 2 / 3 spans after return | 3:55 / 4:04 (old) | 4:15 / 3:44 (new) |
  | #269 B taps chapter 3 | t 480.4 (old start 478) | t 500.4 (new start 498) |

  Every diagnosis entry my runs reached matches the plan. Disk (the separate-process SQLite read)
  and every API read show the saved list before and after `Page.reload`, the Edited badge survives
  the reload, and the watch menu shows the saved times after a reload. I did NOT re-run
  `headers.js` (the cache-header claim is the builder's measurement). My #269 absolute numbers differ
  from the plan's 498 -> 518 because I ran PROBE_269 on its own (see S8). The shape is the same.

Findings:

1. **CRITICAL - #268's adopt seek also runs on the `?play=` re-entry, a same-id load that must not
   move the playhead. It rewinds playback and overwrites the stored resume position.** (I agree
   with adversary finding 1 and re-verified it myself.) `loadTrack` (music.js:3041-3044) seeks
   whenever the loaded chapter id is re-loaded and the playhead is outside that chapter. But
   `playTrackFromContinue` also reaches `loadTrack`, through `playTrackInAlbum` -> `playAt`, and
   `?play=` is never removed from the URL (music.js strips only `nowplaying`, :3991). So re-mounting
   `/music?play=<id>::c0` while the player still holds `<id>::c0` and the file has played on into
   chapter 3 seeks back to chapter 1.
   Driven through the builder's own harness (boot `?play=f1::c0`, `media.t = 130`, then `destroy()`
   and `init()`): AFTER `t=0 newSeeks=[0] newPlays=1`; BEFORE (the same test on `git archive
   7482e432`) `t=130 newSeeks=[] newPlays=0`. The adversary measured the same thing in real
   Chromium through BACK navigation: t 507.9 -> t 3.4, and the stored `/api/progress` went 513.98
   -> 9.34, so the user's place is lost.
   The same code path runs for a "Jump back in" tile or a Home Continue card that names the loaded
   chapter, and for `playListenItem` (`?play=&listen=1` -> `playAt(0)`) when the listen session's
   `::c0` is still loaded. So the Build record's "every existing adopt arm (... `?play=`) keeps its
   behavior" and AC12's claim are false: player.js is unchanged, but music's post-adopt seek now
   covers those arms.
   Prescription: seek only when the load comes from a pick or a nav (a row tap, the skin select, a
   pocket-menu pick, Prev/Next). Carry that as an explicit `opts` flag set by those callers, never
   by `playTrackFromContinue` or `playListenItem`. Bind it with the re-init repro above, which is
   red today, and keep the #268 tests green.

2. **WARNING - after any return that follows a remote edit, #269 swaps a flat pocket-menu queue
   for the whole Songs library.** (I agree with adversary finding 2 and reproduced it myself
   through a different path.) `applySnappedChapterTimes` sets `countChanged` from the highest queued
   `::c` index + 1 (music.js:1778-1785). So a queue that holds only SOME of a file's chapters looks
   like a count change. Every flat `playFromMenu` pick sets `tab = 'songs'` (:3589), so the apply
   calls `render()` -> `loadSongs({})`, which replaces `queue`.
   Driven through the real engine seam (`engineConfigFor(...).menu.onPlay`, i.e. `playFromMenu`) on
   `git archive 5d1e9ada`. A "Recently Played" flat list `[f1::c1, g9::c0]` plays `f1::c1`. Control:
   `onNext` loads `g9::c0`. Then the server moves chapter 2 to 75 s (the count is unchanged) and the
   page comes back. Result: fetches `["/api/videos/f1","/api/music?sort=newest&limit=1000"]`; rows
   `["f1::c0","f1::c1","f1::c2","g9::c0"]`; the "Recently Played" crumb is gone; `onNext` now loads
   `f1::c2`. `flatQueue` also detaches, so the flat segment-end (K4) stops, as the adversary measured
   against a real server.
   If that re-list fails, the passive path also shows the toast "Chapters saved, but the list could
   not be refreshed." on a device that saved nothing.
   The same seam was already wrong for a LOCAL Extras save made while a flat subset list plays (by
   code reading). #269 makes it fire with no user action on this device. Dean's own setup (pocket
   skin, PWA on two devices) is exactly where this happens.
   Prescription: count a change only when a queued row's index is >= `chapters.length`, or when the
   queue holds the file's complete contiguous set (the drill). Bind it with a flat-subset return
   (queue and `onNext` unchanged, no `/api/music` re-list) plus the existing drill count-change
   control.

3. **WARNING - the text for disclosed gap (b) is wrong.** The plan (Disclosed gaps, #269 (b)) says
   that other chaptered files in the queue "are refreshed when they are played or re-listed". They
   are not refreshed when played. `loadTrack` builds `chapterStartSec` and `chapterResumeSec` from
   the queued row itself (:2987-2989), and the return re-check covers only the playing file. So after
   a remote edit to file G, the first tap on a queued G row plays G's OLD start. If that start moved
   later, you get Dean's original "previous song" symptom. G is refreshed only at the NEXT hide/show
   after it becomes the playing file, or by a re-list. (Reasoned from the code. I did not drive it.)
   This is not a code blocker on its own, since it needs a multi-file queue plus an edit elsewhere.
   But the gate contract misstates when the symptom can come back. Fix the wording here and in the
   #269 tracker row's residual.

4. **WARNING - `check-markers.sh` fails on this plan:** `approval marker has no @<sha>` for
   `design: Approved 2026-09-24 (Dean's report, ...)` (frontmatter line 8). `.harness/flow.md` says
   to run check-markers before push. Every sibling plan binds its design approval to a sha. Bind this
   one to the sha the intake was recorded against, e.g. `@7482e432`.

5. **SUGGESTION - `adoptingChapter` hand-copies player.js `isAdoptLoad`.** This is the crown-jewel
   "hand-copy defeats the shared source" class. `isAdoptLoad` sits at the top level of player.js
   (:116, outside the IIFE that starts at :1863), so in the browser it is a global. music.js can call
   it (behind a `typeof` guard), and a later change to the adopt rule then reaches music. Today the
   copy matches, and AC10 binds the closed arm.

6. **SUGGESTION - the diagnosis never lists one candidate its own fixture shows: two media items
   with independent chapter lists.** The probe output shows the audio save leaving the video item
   `source=embedded` unchanged, and the watch save leaving the audio item's list alone. In the pocket
   skin, a Listen of a video and the audio album look the same. So "edited in one, checked the other"
   would also read as "never stuck" on a desktop. Add it as an untested candidate, or ask Dean which
   surface he checked on the desktop. It does not change the fix.

7. **SUGGESTION - file the #269 residuals as an OPEN tracker row.** (a) the watch page is not
   re-checked, (b) one file per return, (c) no re-check while the page stays visible. Today they live
   only in the text of the CLOSED #269 row and in this plan, which moves to completed/. How I judge
   the gaps: none blocks. (a) is outside Dean's Music report, and a stale watch page cannot overwrite
   the file, because the snap editor seeds from storage behind a version token. (c) is the brief (no
   polling). (b) is acceptable once its wording is fixed (finding 3). #267 stays OPEN correctly.

8. **SUGGESTION - record the probe invocation.** The #269 row's 498 -> 518 comes from a combined
   run whose env flags are not written down. `PROBE_REAL=1 PROBE_269=1` alone gives 478 -> 498 (my
   run).

On adversary finding 3 (three unbound #269 arms) and finding 5 (dead code in `seekAdoptedChapter`):
I did not re-mutate; mutation is the adversary's seat. By reading, I agree with 5. `reflectChapter()`
is a no-op there, because `chapterViewId` was already set to `item.id` and the target lies inside
the item. `lastExitTime` was already reset to -1 by `loadTrack`.

Security (standing section): the only new network call is one same-origin GET
`/api/videos/<encodeURIComponent(baseId)>`. `baseId` comes from server-minted queue ids through a
regex. The route is an existing read that is RBAC-gated (`mediaVisibleTo` -> 404, lib/media/routes.js:739)
and has no side effects. The response reaches the DOM only through the existing
`applySnappedChapterTimes` seam, whose sinks already escape titles. There are no new storage
writes, no logging and no new routes. So there is no new exposure. Finding 1 is a data-correctness
loss (the stored resume position is overwritten), not a security issue.

Merge note for the Architect: `git merge-tree` against main (57ed7393, v1.324.0) conflicts only in
tech-debt-tracker.md, an append-only table with different ids. music.js auto-merges, but v1.324.0
changed it by 43 lines. This verdict binds to 5d1e9ada, so the merged tree needs the suites re-run.

Scratch (outside the worktree): `/tmp/claude-1000/.../scratchpad/qa-csp/` (probe.out, probe-base.out,
sb2/test/unit/qa-scratch-flat.test.js with the two repros).

Gate: CHANGES r1 @5d1e9ada — qa

## Gate r2 - security-brief (@20f94dea)

**Could NOT complete (no Bash):** I could not run `git diff` or `git log` and could not check the
tree is clean, so I could not separate the branch's own commits (aba8633e, 7fe73cdf, c49a3d73)
from the two main merges (58753b65, ade79b21) line by line. So I did NOT verify "player.js / server
/ lib untouched by the branch's own commits". I read the files as they are at the head. I confirmed
the branch ref = `20f94dea2ecc...` (the ref file). Out of scope, as briefed: the merged-in v1.324 /
v1.325 main code (`menuTotal`, `MENU_RECENT_URL`, `letters:`).

Re-verified at 20f94dea (public/js/music.js; I traced each path in the code):
- **Still one authenticated read route; no new request target.** music.js now has four
  `fetchJson('/api/videos/' + encodeURIComponent(...))` calls: the return re-check (:1905), the new
  lazy verify (:1924) and the two existing ones (:2864, :3854). The new one is the same
  same-origin route. `lib/media/routes.js:732/739` still 404s a missing item and one that fails
  `mediaVisibleTo` alike. I compared the storage and network calls (`setItem`, `method:`,
  `fetch(`, `sendBeacon`, `caches.`, `document.cookie`) with my r1 list. The branch adds no new
  storage write, no new POST/DELETE and no new endpoint.
- **No polling, and the lazy check cannot loop.** `verifyChapterFileThenPlay` (:1919) runs only
  from `playAt` (:3467), which only a user pick or a queue advance reaches. Nothing re-arms it
  with a timer.
  - Success arm: `delete unverifiedChapterFiles[baseId]` runs BEFORE `playAt(idx, opts)` (:1926
    then :1933). So the nested `playAt` -> `verifyChapterFileThenPlay` returns false at :1922 and
    loads the row. Your own mutant R15 (the clear removed) shows the loop this delete prevents.
  - Failure arm: it deletes the flag, calls `playAt` synchronously (the nested verify again returns
    false), and only THEN re-sets the flag (:1938-1941). So a failure costs one GET plus one
    play, and the retry waits for the next `playAt`. A superseded pick (`gen !== playGen`) or a
    dropped row (`idx < 0`) returns without calling `playAt`.
  - Upper bound: markings come only from `markOtherChapterFilesUnverified`, which runs once per
    return over the queue at that moment. On success the check fires at most once per file per
    return. Only when the requests keep failing (offline, or a file that now 404s) does it fire
    once per `playAt` of that file's rows, never on its own.
- **404 (restricted or deleted) applies nothing and does not block playback.** `fetchJson` throws
  on `!res.ok`. The catch arm applies nothing and plays the row as queued (the player's own
  `/track` request then gets the server's answer). A successful but empty or malformed body gives
  `chapters = null`: nothing is applied and the row plays. The return re-check's catch (:1911)
  clears the in-flight flag and re-marks the file, with no apply.
- **The listeners and liveness are unchanged from r1.** Both still register with `{ signal }`,
  and `signal.aborted` is checked after each await (:1907, :1925, :1935).
- **Strings are still escaped.** The new repaint paths (`renderSongListProgressive`, and
  `renderDrillView` for flat or partial drills) render rows only through `buildSongRowHtml`
  (`escapeMusicHtml`, :219). The drill header and sticky bar also escape (`escapeMusicHtml`,
  :455-461, :500). Numbers pass through `Number`/`isFinite`.
- **`opts.pick` gating (P1) is pure client logic.** It adds a condition in front of
  `seekAdoptedChapter` (:3112), which now only sets `currentTime` and calls `play()`.
  `isAdoptingLoad` only reads the player's `isAdoptLoad` global. None of this adds a write.

Findings:
- **INFO-4 (new): a verify that never resolves swallows that one pick.** `fetchJson` has no
  timeout. If the GET hangs, the pick waits forever. The user's next pick bumps `playGen` and asks
  again (the file is still marked), so there is no deadlock and no loop. It only affects the local
  user's availability.
- INFO-1 / INFO-2 / INFO-3 from r1 still stand as written. INFO-1 does not apply to the verify
  path, which plays after one apply and never re-checks.

No CRITICAL / HIGH / MEDIUM / LOW.

Gate: APPROVED r2 @20f94dea — security-brief

## Gate r2 - adversary (@20f94dea)

Delta review of the r1 fix (aba8633e, 7fe73cdf, c49a3d73), in /tmp sandboxes from `git archive
20f94dea` (AFTER) and `git archive 12e16523` (BEFORE = the r1 code + the v1.324 merge). Node
22.23.1.

Instruments:
- Tests: the binding set (chapter-snap-resume, music-chapter-playback, chapter-snap-client,
  music-chapter-reflect, integration chapter-snap-return-flat) gave `# tests 97 # pass 97 # fail
  0`. `test/unit/music*.test.js chapter* skin* listen* pocket*` gave `# tests 835 # pass 835 #
  fail 0`. `test/integration/music-pocket-menus*.test.js chapter-snap*.test.js` gave `# tests 94
  # pass 94 # fail 0`.
- eslint on music.js and the three touched test files: exit 0.
- No change to player.js, server.js or lib from the branch's own commits: every commit
  12e16523..20f94dea shows an empty `--stat` for those paths, and `git diff 2be1ebb2 20f94dea --
  public/js/player.js server.js lib` (main v1.325.0 against the head) is empty. The 25 lines in
  `7482e432..20f94dea` all came in with the two main merges.

r1 findings, re-measured:
1. **CRITICAL 1: FIXED as prescribed.** I re-ran my real-Chromium probe (a 2000 s mp3 with 8
   chapters, 1440x900). In every row the playhead was at ~500 (chapter 3) before the step.

   | Path | BEFORE 12e16523 | AFTER 20f94dea |
   |---|---|---|
   | history BACK to `?play=<id>::c0` | t 3.4, row `c0`, stored 9.38 | t 507.9, row `c2`, stored 513.93 |
   | Home Continue card (a fresh navigate to `?play=` for the loaded chapter) | t 3.4, stored 8.39 | t 507.5, stored 512.50 |
   | "Jump back in" tile naming the loaded chapter (tiles `["c0"]`) | t 15.7, stored 20.72 | t 505.4, stored 510.44 |
   | Listen re-mount (BACK to `?play=<video>&listen=1`) | t 3.4 | t 507.5 |
   | dock-return (`?nowplaying=1`) | t 507.4 | t 507.5 |

   The builder's harness re-mount test is RED on the mutant where the continue arm passes `pick`
   (B1).
2. **WARNING 2: FIXED.** I re-ran my real-server integration repro (Liked Songs `[Track A]`,
   Autoplay off, Track B moved 900 -> 905 elsewhere, then the page comes back).

   | | BEFORE | AFTER |
   |---|---|---|
   | requests on return | `/api/videos/djmix1`, `/api/music?sort=newest&limit=1000` | `/api/videos/djmix1` only |
   | at the new segment end (905) | pauses +0 (plays on) | pauses +1 |
   | onNext | armed | not armed |

3. **WARNING 3: FIXED.** Each of my r1 mutants is now RED against the binding set: A15 (the album
   fallback), A1 (the catch path's in-flight reset) and A2 (the post-await liveness check), 1 each.
4. **SUGGESTION 4: FIXED.** A11 (a 1 s start tolerance) is RED (r1 S4).
5. **SUGGESTION 5: done.** The dead code is removed.

Threading of `pick` (a whole-file grep of every `playAt` / `playTrackInAlbum` / `loadTrack` /
`playRowAt` caller):
- Passing `pick`: `onSelectIndex`, the up-next row, `playRowAt` (both arms, with
  `playTrackInAlbum` threading it), `playFromMenu` (also used by Shuffle Songs), and Prev/Next.
  The verify path forwards the caller's own `opts`.
- Not passing `pick`: `playTrackFromContinue` (both arms), `playListenItem`, the drill Play and
  Shuffle buttons, the toolbar shuffle, the station continuations and the flat segment-end
  advance.
- No pick path forgets it, and no continue path passes it. The flat `playTrackFromContinue` arm
  (B2) can never carry a chapter, because projected tracks always have an `albumKey`
  (`albumKeyFor`).

New findings:

6. **WARNING - four arms the fix claims are unbound; each mutant stays green on the full binding
   set (97/97).** The code is right today (measured below). But each arm guards the CRITICAL's
   class or a claimed P3 behavior, so a regression would ship green:
   - **B3:** `playListenItem` passing `pick: true`. This re-opens the CRITICAL on the Listen path
     (r1 code: t 3.4 above). AC13 names "a Listen play" but binds only the `?play=` album arm.
   - **B6:** the verify path's `.catch` no longer plays the row. The plan says "a failed verify
     plays the row as queued"; with the mutant, an offline pick of an unverified file is swallowed.
   - **B8:** the `.catch` ignores `playGen`. A failure arriving late then starts the OLDER pick
     over a newer one (the v1.104 wrong-track class). R16 binds only the `.then` arm.
   - **B5:** the verify path's post-await `signal.aborted` check removed. A late answer would
     load a row from a dead view.

   Prescription, ready-made: /tmp/adv-csp/sb2/test/unit/zz-adv-r2.test.js holds four tests in the
   builder's own harness (a `failFiles` hook added to its fetch stub). They pass at 20f94dea (the
   code behaves: a failed verify plays `g9::c1`; a late failure leaves `f1::c2` with 0 `g9` loads;
   0 loads after destroy; the Listen re-mount keeps t 130, 0 seeks, 0 plays). They go RED on B6,
   B8, B5 and B3 respectively (control `# fail 0`). Folding them in is a test-only change.

7. **SUGGESTION - bookkeeping and redraw mutants that survive.**
   - B7: a failed verify no longer re-marks the file unverified.
   - B11: the return no longer deletes the checked file from the unverified set, which costs one
     redundant GET.
   - B12: the flat redraw always uses `renderDrillView`, even with `drill == null`. The rows
     still pass, but nothing asserts that no drill header is drawn over a flat list.

8. **SUGGESTION (reasoned, not measured) - a SEARCHED album drill is a partial single-file
   drill.** `loadSongs` folds `search` into the drill query, so `chapterAlbumBaseId(queue)` still
   names the file and `ownsDrill` is true. A time-only remote move then reads as a count change
   when the highest match index + 1 differs from the count, and it costs one re-list of the same
   searched drill. That is harmless, but the "complete list" premise in the P2 comment is not
   always true. A related case: c49a3d73 repaints any `drill` holding the file's rows, including
   `playTrackInAlbum`'s miss path, where `drill` stays set over a flat one-row list.

9. **SUGGESTION (reasoned) - the verify GET has no timeout.** The first pick of an unverified file
   after a return waits one round trip before the stream request starts. On a hung socket it
   waits until the fetch settles. This is the same property security-brief noted as INFO-2 for
   the return re-check.

Not a finding: removing the apply-generation check from the verify path (R18). An apply to the
same file inside the verify window needs a local save of a file that is not playing, landing
within one GET. I could not build it without a hung request.

Tree state: only this section was appended (after security-brief's r2 section). Scratch is in
/tmp/adv-csp (probe2.js, mut2.js with m3/m4/m5, sandboxes r2, r1b and sb2).

Gate: CHANGES r2 @20f94dea — adversary

## Gate r2 - qa (@20f94dea)

Delta re-confirmation of my r1 findings, plus a review of the r1-fix code (aba8633e, 7fe73cdf,
c49a3d73). The branch's own change against main is `git diff 2be1ebb2 20f94dea`: music.js, two
test files, the plan and the tracker. `-- public/js/player.js server.js lib` is 0 lines. Node
22.23.1, FILETUBE_TEST_FFMPEG set. Every run below finished before 1a0b1a10 landed (18:34:53 UTC;
my full unit run ended 18:26), so each one ran against 20f94dea content.

Instruments:
- `node --test test/unit/chapter-snap-resume.test.js`: `# tests 29 # pass 29 # fail 0`.
- `test/integration/chapter-snap-return-flat.test.js`: `# tests 2 # pass 2 # fail 0`.
- `test/unit/chapter-snap*.test.js music*.test.js *pocket*.test.js player-adopt*.test.js
  *census*.test.js test/integration/chapter-snap*.test.js *pocket*.test.js`: `# tests 862 # pass
  862 # fail 0 # skipped 0`.
- `npm run test:unit`: `# tests 7354 # pass 7354 # fail 0`. The r1 release-ledger failure is gone
  now that main is merged.
- `lint:css`: `TOTAL 0`. `lint:overlay`: `clean (0 violations)`. `eslint .`: `6 problems (0 errors,
  6 warnings)`, the same 6 in common.js. eslint on the four touched source/test files: exit 0.
- `check-markers.sh`: exit 1, with 2 findings: `stale approval @7482e432` (the design line) and
  `stale approval @5d1e9ada` (security-brief r1). Both are the rule that an active plan's approval
  goes stale once code moves on. In a scratch clone of 20f94dea I moved the plan to completed/ with
  a Shipped status, and check-markers then printed `clean (docs/exec-plans)`, exit 0. So these two
  clear at close-out and do not block. See W4 below.
- Real Chromium (chromium-1234; `git archive 20f94dea` sandbox; the builder's `probe.js` and the
  adversary's `adv-probe.js`, byte-identical copies). Flags are listed per run.

  | Drive | AFTER 20f94dea |
  |---|---|
  | `PROBE_REAL=1 PROBE_STALE=1 PROBE_RELIST=1` (390x844): tap chapter 1, then chapter 3 after 478 -> 498 | t 500.4, row `::c2` |
  | the same after `Page.reload` | t 502.7 `::c2` |
  | `PROBE_REAL=1 PROBE_268=1`: re-tap the loaded chapter 3 (playhead 493.4 in `::c1`) | t 500.4, playing, `::c2` |
  | `PROBE_REAL=1 PROBE_269=1`: B's requests on return / spans / B taps chapter 3 | 1 / 4:15, 3:44 (new) / t 500.3 `::c2` |
  | `PROBE_REAL=1 PROBE_FLAT=1`: Liked Songs `[c1]`, remote move 478 -> 498, then the page returns | requests `["/api/videos/<id>"]` only; crumb "Liked Songs", rows `[c1]`; at the new end t 497.8, paused (K4) |
  | adversary `MODE=268` (1440x900): `?play=<id>::c0`, roll to 500, Home, then `history.back()` | t 508, row `c2`; stored progress 513.98 |

My r1 findings, re-verified with my own repros. Each ran in the builder's harness, in
`sbr2/test/unit/qa-r2-scratch.test.js` on the 20f94dea sandbox:

1. **CRITICAL (`?play=` re-mount seek): FIXED as prescribed.**
   - My r1 re-init repro now prints `t=130 newSeeks=[] newPlays=0`. At r1 it printed `t=0
     newSeeks=[0] newPlays=1`.
   - The "Jump back in" tile naming the loaded chapter keeps t 130 with no seek. So does the drill
     Play button.
   - Control: a row tap on the loaded chapter is a pick and still seeks, `newSeeks=[0]`.
   - The real-Chromium BACK drive keeps t 508 and stored progress 513.98.
   - By grep, `pick` is passed only by the pick/nav callers. The adversary's r2 table covers the
     Home Continue, Listen and dock-return arms as well.
   - The adopt test now calls player.js's own `isAdoptLoad`, which is a page global:
     `<script src="/js/player.js">` loads it as a classic script in all 10 shells, and the function
     is top-level (:116). So S5 is done.
2. **W2 (flat queue re-listed): FIXED as prescribed.** `[f1::c1, g9::c0]` from the real engine's
   `menu.onPlay` after a remote move and a return:
   - fetches: `["GET /api/videos/f1"]` only;
   - rows: `["f1::c1","g9::c0"]`;
   - crumb: "Recently Played", still visible;
   - toasts: `[]`;
   - the f1::c1 row is patched in place (0:45);
   - `onNext` loads `g9::c0`.

   The real-Chromium FLAT drive agrees. The builder's point about the toast also checks out:
   `render()` catches its own failures and never rejects, so that toast arm cannot be reached from
   a failed re-list. My r1 toast scenario was wrong.
3. **W3 (other queued files): FIXED differently, and the change is sound.** The lazy check runs on
   the first pick. The queue was `[f1::c0, g9::c0..c2]` with g9 moved elsewhere to 40:
   - the return asks only `/api/videos/f1`;
   - the tap on g9::c1 asks `/api/videos/g9` once and loads `chapterStartSec 40` (t=40);
   - a second pick of g9 asks nothing.

   The corrected gap (b) text matches the code. But the lazy check covers only files that were in
   the QUEUE at the return, not the pocket-menu caches (new finding N1).
4. **W4 (unbound design line): FIXED as prescribed** (`@7482e432`). My own prescription was
   incomplete: check-markers rule 2 flags a design sha as stale once code moves past it, so this
   line trips check-markers while the plan is active, whatever sha it names. It is clean after the
   move to completed/ (measured above), which is the only point where flow.md requires a clean run
   (before push). Not a finding.
5. **Suggestions S5-S8:** all done as written. S6 is recorded honestly as an untested reading
   rather than a claim.

New findings in the r1-fix code:

N1. **WARNING - after a return, a pick from the cached pocket Songs, Genres or artist menus of a
   chaptered file that was not in the queue at that return plays the file's OLD start.** It makes
   no request, so the lazy verify never runs.
   - `menuSongsPromise` and `menuArtistCache` are cached once per view. `invalidateMenuData()`
     runs only when an apply lands, i.e. only when the PLAYING file changed.
     `markOtherChapterFilesUnverified` marks only files in `queue`.
   - My repro in the builder's harness: load the pocket Songs level (g9::c1 at 30). Pick an f1-only
     list, so g9 leaves the queue. Move g9::c1 to 40 elsewhere, then return. The return asks
     `/api/videos/f1` only, and the Songs level is not re-fetched (it still says 30). Picking g9::c1
     from that level gives `gets=[]` and `load start=30`.
   - With the same pick while g9 WAS queued at the return, it asks and loads 40, so the verify
     path works where it is reached.
   - This is pre-existing, not a regression. But it is Dean's own setup (a pocket skin in a PWA
     left open), and it is the headline symptom (a start moved later -> the previous song's tail).
     #269's CLOSED text says it covers "the pocket menus via `invalidateMenuData`", which is true
     only for the playing file, and #270 does not list this case.
   - Prescription, either of two:
     - (a) The small code change: flip the set to "verified since the last return". Every return
       clears it (after the one re-check), and `verifyChapterFileThenPlay` asks for any chapter file
       not verified since then. That covers cached menu rows and every other entry at once, and
       `markOtherChapterFilesUnverified` goes away. Bind it with the repro above: red today, then
       one GET and start 40.
     - (b) Docs only: correct #269's closing text and add the case to #270 as (e).

     Either one closes this for me.
N2. **SUGGESTION - #270 (c) says a first pick into an unverified file costs "a latency, never a
   wrong start". On the flat segment-end advance, that latency is audible bleed plus repeated
   requests.** My repro, in the builder's harness:
   - Setup: a flat list `[f1::c0, g9::c1]`, then a return, which marks g9. g9's GET is held while
     timeupdates run 59.5 -> 61.4 across f1::c0's end (60).
   - Result: 5 GETs of `/api/videos/g9` (one per in-band tick, because every tick in the 1.25 s
     band re-calls `playAt`, which bumps `playGen` and starts a new verify), 0 loads, 0 pauses. f1
     plays on into its own next chapter until the answer lands. Then exactly one load, `g9::c1`, so
     the sequence converges with no double load.
   - Control without a return: it advances on the first in-band tick.
   - On a LAN the round trip is under one tick, so this is usually invisible. Fix the #270 (c)
     wording (the K4 "own segment only" promise lapses for one round trip). Optionally skip starting
     a second verify for a file whose verify is already in flight.
N3. **SUGGESTION - tracker #268's CLOSED text is stale.** It still describes the r2 mechanism ("...
   seeks ... ONLY when the playhead is outside the row's current bounds") without the r1 limit that
   only a pick or nav (`opts.pick`) re-seeks. #269's row was updated; #268's needs the same line.
N4. **SUGGESTION - the P2 comment in `applySnappedChapterTimes` is slightly off.** It says "Only
   the album drill holds the file's COMPLETE chapter list ... Any other queue (... a search) ... is
   patched IN PLACE". A search inside an album drill is still `ownsDrill`, so it is re-listed (the
   same searched drill comes back, which is harmless). I agree with adversary r2 finding 8. Also,
   the unit test named "an album drill holding only SOME of the file's chapters" drives a MIXED drill
   (f1 + g9), not a partial single-file drill. The name overstates what it binds.

On the adversary's r2 finding 6 (four unbound verify/Listen arms): HEAD has since moved to
1a0b1a10, a test-only commit (+105 lines in chapter-snap-resume.test.js) that says it binds those
arms. It is outside this verdict's sha and I have not reviewed it.

Comment accuracy: I checked every comment the r1 fix touched: `loadTrack`'s pick/adopt block,
`seekAdoptedChapter`, `isAdoptingLoad`, the P2 block, the flat-redraw and drill-repaint comments,
the verify/unverified block, the `playTrackInAlbum` pick line and the reflect-test lock. Each
matches the code, except N4. The corrected claims in the plan (AC12, the Build record correction,
gap (b)) match the code and my repros. #267 is unchanged and correctly OPEN. #270 is OPEN and
well-formed (six columns; tech-debt-census green), and its (a) through (d) are accurate apart from
the wording in N2.

Security (standing section): the only new request is one more same-origin GET to the same
RBAC-gated read (`/api/videos/<encodeURIComponent(baseId)>`, baseId taken from server-minted queue
ids), on a pick. There is no new write, route, storage or logging. On failure the pick plays the
queued row and applies nothing. No new exposure.

Tree state: only this section was appended, after the r2 sections of security-brief and adversary.
HEAD is 1a0b1a10, which the Architect added during this review, and this verdict binds to 20f94dea
as briefed. Scratch is in `/tmp/claude-1000/.../scratchpad/qa-csp/`: `probe-r2.out`, and
`sbr2/test/unit/qa-r2-scratch.test.js` with QA-A to QA-F.

Gate: CHANGES r2 @20f94dea — qa
