# First-class chapters: autoplay-loop fix + solo-chapter exit (v1.311 wave)

Status: IN GATE. Dean intake (2026-09-22, /music): (1) playing a chaptered "album"
(one file, `::c` chapter tracks) through to the end with "Loop chapter" OFF **looped
back onto itself** instead of stationing on to a related album; manually clicking to
the last chapter row DID populate the radio and advance - an asymmetry that pinpointed
the cause. (2) "Chapters need to operate in a super first-class way... if a song which
is a chapter is selected it needs to exit after that bit."

Anchor: outcome. Branch: `feat/first-class-chapters` off `main`.

## Locked decisions (Dean, 2026-09-22)
- **Tap ONE chapter row** (a single-chapter SELECT) -> play only that chapter's segment,
  then EXIT the album and station on to a related new track ("exit after that bit").
- **Album Play button** -> play all chapters straight through, then station on at the
  true file end. (The loop-fix already delivers this.)

## Root cause (the loop bug - tech-debt #230 part i, left open at v1.308)
A chaptered album is ONE file; its `::c` chapters are `queue` entries. As the playhead
rolled across chapters, `reflectChapter` updated the DISPLAY but never re-registered the
Prev/Next closures or the endless-autoplay arm - `registerTrackNav` ran once, at load,
on whichever chapter you STARTED on. So on a natural playthrough: `onNext` stayed frozen
(the whole-file `ended` -> `fallbackToTrackNav` replayed it, back into the same file =
"loops onto itself"), and `maybeExtendQueueForAutoplay` (armed only on the LAST queue
index) never fired. Clicking the last row worked only because that `playAt` re-ran
`registerTrackNav`.

## Fix
1. `reflectChapter` now calls `registerTrackNav(liveChapterIndex)` on every boundary
   cross - so Prev/Next track the playhead and the radio arms when the last chapter is
   reached by natural playback. (music.js)
2. Solo-chapter exit: a chapter selected from a list (`opts.soloChapter`, set only at the
   interactive select surfaces - row tap `playRowAt`/`playTrackInAlbum({solo})`, skin
   `onSelectIndex`, now-playing up-next tap; NOT play-all / shuffle / nav / resume) sets
   `soloChapterExitId` and pre-fetches the station (`primeSoloExitStation`). A new
   `enforceChapterExit` timeupdate handler (bound AFTER `enforceChapterLoop`, BEFORE
   `reflectChapter`) hands off to that station at the chapter's end boundary, appending
   the picks after the album (existing rows' `data-index` unchanged - no wrong-track
   desync) and `playAt`-ing the first.
3. The picker's fetch/pick core is extracted to `fetchAutoplayPicks`, shared by
   `maybeExtendQueueForAutoplay` AND `primeSoloExitStation` (one truth - the hand-copied
   sibling drift class).

## Acceptance / attack surfaces for the gate
- Play-all (drill Play or a continue-listening resume): plays through every chapter, then
  stations on at the FILE end; a mid-album boundary must NOT exit.
- Row tap on a chapter: exits to the station at THAT chapter's end; must not bleed into the
  next chapter nor loop the file.
- **Loop chapter ON outranks the exit** AND the play-all station-on (loop = repeat THIS).
- Scrub past the solo chapter cancels the exit intent (the "just this bit" no longer holds).
- TOCTOU: a superseding play (chapter A then B, or a non-chapter load, or a view teardown)
  must drop stale pre-fetched picks (forId staleness check; last-write-wins).
- No drift between the two picker consumers (mutate `fetchAutoplayPicks`, both must move).
- DISCLOSED degrade: with autoplay OFF (or the picker empty), a solo chapter has no station,
  so it plays straight through (old behavior) - no forced stop in v1.

## Verification (builder, pre-gate)
Node 22 full unit suite 6831/6831. `music-chapter-reflect.test.js` 24/24 (5 new v1.311
behavioral tests: 2 loop-fix axes, 3 solo-exit axes). ESLint 0 errors.

## Gate
(seats write their verdict here, bound to the reviewed sha)
