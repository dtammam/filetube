---
plan: chapter-snap-persist
harness: v2 · lean
branch: fix/chapter-snap-persist
anchor: spec
status: Built (diagnosis + one-seam fix); awaiting the full gate
next: gate (FULL - data class: adversary + qa + security-brief)
design: Approved 2026-09-24 (Dean's report, relayed by the Architect; the wave intake is recorded in memory wave-2026-09-24-intake)
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

**A second, related defect - MEASURED, not fixed here (tracker #268).** When the chapter whose
start moved is the one LOADED in the player, tapping its row is a same-id load, which the player
ADOPTS (no seek, by the adopt contract). Measured at base AND on this branch (the list fetched
before playing, so no stale `progress` is involved): after the save, tapping chapter 3 left the
element at t 491.1, paused - the tap did nothing while the display said chapter 3 - until another
chapter was tapped (then chapter 3 -> t 500.4 on both trees). This is not a one-seam change (it
touches the player's adopt contract or the Music tap path) and is pre-existing in kind: a
playthrough that rolled from the loaded chapter into the next leaves the same split between the
loaded id and the heard chapter.

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

Instrument outputs (Node 22.23.1):
- `node --test test/unit/chapter-snap-resume.test.js test/unit/music-chapter-playback.test.js
  test/unit/chapter-snap-client.test.js`: `# tests 26 # pass 26 # fail 0`.
- `npx eslint public/js/music.js test/unit/chapter-snap-resume.test.js`: no output (clean).

## Measurements

See the Diagnosis tables. Probe runs: seeded mode 1440x900; REAL mode 1440x900 (entries 1, 2 and
3) and 390x844 mobile (the H3 table), each against a `git archive 7482e432` sandbox (BEFORE) and
this tree (AFTER).

## Mutant table

(filled after the commit - mutants run in a /tmp sandbox from `git archive` of the committed sha)

## Disclosed gaps

- #267: after a save, the chapter that NOW contains the saved place starts at its head instead of
  resuming there, until the list is fetched again (any album/menu re-open or a reload re-homes it
  on the server). No wrong audio, only a lost resume point.
- #268: the same-id ADOPT swallows a tap on the loaded chapter whose bounds moved away from the
  playhead (measured above). Proposed fix shape: in music.js `loadTrack`, when `item.id` is the
  player's loaded id and the element's `currentTime` is outside the row's current
  `[chapterStartSec, chapterStartSec + durationSec)`, seek the element to `chapterStartSec` after
  the adopt (and play); or have `applySnappedChapterTimes` re-point the loaded identity. Size:
  one seam in music.js plus a real-Chromium binding; risk: the adopt path is shared with the
  watch/listen hand-offs, so the seek must stay music-chapter-only.
- #269 cross-device staleness (not built): a page that was already open when ANOTHER device saved
  keeps its queue, its rows' bounds and its pocket-menu caches until it reloads or re-opens the
  list (nothing pushes a chapter change to other devices). This is the likely shape of Dean's
  first "tried on desktop, then refreshed ... never stuck" sighting only if the desktop page was
  not truly reloaded; every measured reload served the new times. Fix shape if wanted: re-fetch
  the playing file's chapters (`/api/videos/:id` `chaptersVersion`) on `visibilitychange` ->
  visible and on a cold resume, and run `applySnappedChapterTimes` when the version moved.
- Not measured on a real iPhone PWA (headless Chromium only).

## Gate verdicts

(reserved for the Architect's gate rounds)
