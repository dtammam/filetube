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

## r2 - fixes for the adversary's r1 findings
- **F1** (double-prime on the last chapter): `loadTrack` now excludes the LAST queue entry from
  solo (`i < queue.length - 1`) - the last chapter's "exit after that bit" IS the normal end-of-file
  station-on, so no solo prime, no duplicate append.
- **F2** (unbounded seek fires the exit): `enforceChapterExit` now uses a band + delta cap
  (`lastExitTime`, `EXIT_MAX_STEP`) mirroring `enforceChapterLoop` - a far forward seek (wheel,
  seek-bar `change`, MediaSession `seekto`) is rejected by delta, and reflect + the chapterViewId
  mismatch clear drop the intent. Comment corrected.
- **F3** (presence-not-binding): added behavioral bindings for the songs-list `playTrackInAlbum({solo})`
  callsite and (already) the in-album re-tap + middle-chapter exit; the skin `onSelectIndex` and
  now-playing up-next callsites (only reachable behind the mobile skin / expanded panel the desktop
  harness doesn't enter) are bound by a comment-stripped CLASSIFICATION lock, with their downstream
  exit behavior proven behaviorally.
- **F4** (guard tests): added the seek-cancel, autoplay-OFF-degrade, and last-chapter no-exit tests.
- Mutation-verified each new test reds against the mutant it claims to kill (F1 exclusion, F2 cap,
  M6b solo flag, M6c/M6d classification, F4 autoplay gate). `music-chapter-reflect` now 29/29.

## Gate
- Gate: CHANGES r1 @9ce1a71af3def8e6172fbed5e9db66e3160bb35d — adversary (Fable). Full suite 6831/6831, lint 0 errors, tree byte-identical. Findings:
  1. WARNING - solo-select of the LAST chapter double-primes (maybeExtend arms on last index AND primeSoloExitStation), so the exit appends DUPLICATE station tracks and jumps over the visible up-next. Fix: don't treat the last chapter as solo - the normal last-index/ended station-on already handles it.
  2. WARNING - the "scrub cancels the exit" claim is false for non-wheel seeks (seek-bar `change`, MediaSession `seekto`); `enforceChapterExit` has no upper cap on `t >= b.end-0.25`, so a forward seek INTO a later chapter fires the exit. Fix: band + delta cap mirroring enforceChapterLoop (reject far jumps); the chapterViewId-mismatch clear is the second axis.
  3. WARNING - presence-not-binding: only the in-album re-tap solo surface has a test; playTrackInAlbum({solo}) (songs-list row tap), skin onSelectIndex, and the up-next tap are unbound. Fix: add behavioral bindings (floor: the songs-list surface).
  4. SUGGESTION - add guard tests: forId staleness, signal.aborted in prime, autoplayEnabled gate in prime, the exit scrub guard, keepPosition on the exit load.
- Gate: APPROVED r1 @9ce1a71a — qa. Full suite 6831/6831, lint 0 errors, tree byte-identical. Extraction verified byte-faithful; all TOCTOU guards preserved; solo flag wired only at intended surfaces; no security surface. One SUGGESTION: the SAME last-chapter double-prime the adversary flagged (qa rated it cosmetic queue-clutter, not a correctness bug).
