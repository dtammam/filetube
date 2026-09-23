# First-class chapters: autoplay-loop fix + solo-chapter exit (v1.311 wave)

status: Shipped v1.311.0 (closed out 2026-09-23 with v1.311.2; it was left in active/ at release)

Dean intake (2026-09-22, /music): (1) playing a chaptered "album"
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

- Gate: APPROVED r3 @312f9993443f2b0871bf73ab5a959b2b38a9bc19 - adversary (Fable). Full suite
  6838/6838, lint 0 errors, tree byte-identical. r2 findings fixed-as-prescribed (F1b both halves,
  F2 both tests now red M7); F5 drain harness proven non-vacuous (N12 reds both reveal tests). 1
  WARNING disclosed non-blocking -> tracker: in an INTERLEAVED shuffle-all queue the existing-station
  exit lands after the LAST same-base chapter (skips rows between), AND that flow is already broken
  pre-diff (currentChapterBounds derives the segment from the QUEUE, not the file's chapter list, so a
  solo tap there already bleeds) - a separate wave: (a) afterIdx = first non-same-base entry > i;
  (b) derive chapter bounds from the file's chapter list. 2 SUGGESTIONs (crossed-arm N2, same-base
  clause N1b/c). GATE CLEARED: adversary APPROVED r3 + qa APPROVED r2 (F5 addressed in r3).

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
- Gate: CHANGES r2 @d7f9807f322c0349500ec7447db61170972d5b09 - adversary (Fable). Full suite 6836/6836,
  lint 0 errors, tree byte-identical. r1 findings all confirmed fixed (F1 simple case, F2, F3, F4).
  Two NEW WARNINGs:
  1. F1's exclusion is "last QUEUE entry" not "last CHAPTER" - with a trailing station already in the
     queue (a prior play-all extend), tapping a chapter still primes and the exit appends MORE picks,
     jumping over the VISIBLE up-next rows (the v1.254 see-and-skip ruling). Fix: classify solo as
     "a later same-base CHAPTER exists after i"; at exit, prefer an already-present non-chapter entry
     over appending.
  2. The "album Play plays straight through" test went VACUOUS under the bounded window (drives past
     c0's band, so the M7 misclassify mutant survives), and there is no continue-resume test. Fix:
     drive the play-all test inside c0's own band; add a `?play=film::c1` resume test. (Test-only.)
  Remaining: M3/M4 singles, M8/M9/M11/M14/M15, crossed-arm (N2/N4) - SUGGESTIONs, harness-limited.
- Gate: APPROVED r2 @d7f9807f - qa (1 WARNING disclosed non-blocking). Full suite 6836/6836, lint 0
  errors. F1 (its r1 SUGGESTION) + adversary F2 confirmed fixed-as-prescribed; maybeExtend refactor +
  TOCTOU guards untouched; no new security surface. WARNING F5: the solo-exit reveal tests flaked once
  in ~35 runs on a fixed-settle budget racing the async prefetch - test-harness artifact, safe to ship
  disclosed; recommends polling. (Addressed in r3 via ctx.drain.)

## r3 - fixes for the adversary's r2 findings (Dean ruled "fix it + final round")
- **F1b** (exclusion was queue-tail-based, jumped visible up-next): solo is now classified by
  `laterSameBaseChapterExists(item, i)` - a LATER chapter of the same file must exist to skip - and
  `enforceChapterExit` prefers an ALREADY-PRESENT entry after the album's chapters (an existing
  station the play-all extend appended, visible in up-next) over appending a fresh one; it appends the
  pre-fetched picks only when the album is genuinely the queue tail.
- **F2** (vacuous play-all test + no resume test): the play-all test now drives chapter one's OWN end
  band (where a misclassified-solo mutant would fire); added a `?play=film::c1` continue-resume test.
- **F5** (test flake): the harness now tracks every fetch body's `json()` promise and `ctx.drain()`
  awaits them (re-looping for the picker's sequential artist-then-library fetches), so a reveal test
  settles the async prefetch DETERMINISTICALLY before the one-shot boundary tick - no fixed settle
  budget. Verified: 5 serial + 6 parallel-under-load runs all 31/31; the flaky tests no longer race.
- Mutation-verified: F1b (exit always-append), M7 (classification drops the opts.soloChapter gate -
  now caught by BOTH the play-all-band and resume tests), and the later-check helper each red their
  test. `music-chapter-reflect` 31/31.

## Gate
- Gate: CHANGES r1 @9ce1a71af3def8e6172fbed5e9db66e3160bb35d — adversary (Fable). Full suite 6831/6831, lint 0 errors, tree byte-identical. Findings:
  1. WARNING - solo-select of the LAST chapter double-primes (maybeExtend arms on last index AND primeSoloExitStation), so the exit appends DUPLICATE station tracks and jumps over the visible up-next. Fix: don't treat the last chapter as solo - the normal last-index/ended station-on already handles it.
  2. WARNING - the "scrub cancels the exit" claim is false for non-wheel seeks (seek-bar `change`, MediaSession `seekto`); `enforceChapterExit` has no upper cap on `t >= b.end-0.25`, so a forward seek INTO a later chapter fires the exit. Fix: band + delta cap mirroring enforceChapterLoop (reject far jumps); the chapterViewId-mismatch clear is the second axis.
  3. WARNING - presence-not-binding: only the in-album re-tap solo surface has a test; playTrackInAlbum({solo}) (songs-list row tap), skin onSelectIndex, and the up-next tap are unbound. Fix: add behavioral bindings (floor: the songs-list surface).
  4. SUGGESTION - add guard tests: forId staleness, signal.aborted in prime, autoplayEnabled gate in prime, the exit scrub guard, keepPosition on the exit load.
- Gate: APPROVED r1 @9ce1a71a — qa. Full suite 6831/6831, lint 0 errors, tree byte-identical. Extraction verified byte-faithful; all TOCTOU guards preserved; solo flag wired only at intended surfaces; no security surface. One SUGGESTION: the SAME last-chapter double-prime the adversary flagged (qa rated it cosmetic queue-clutter, not a correctness bug).
