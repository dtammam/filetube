---
plan: album-pick-plays-through
harness: v2 · lean
branch: fix/album-pick-plays-through
anchor: tdd
status: Shipped v1.331.0
next: release v1.331.0. Owed after the release: Dean's device pass (Recent Artists > artist > album > a chapter plays on through the album on the iPhone PWA) and his rulings on #279 (the browse Play button under a non-file-order sort) and on the browse chapter rows (the v1.311 solo rule kept, see Deviations).
design: "Approved 2026-09-25 (Dean's dispatch; the intake questions answered by the dispatch's own recommendations, see Intake)"
gate: APPROVED r2 @d9355437 — adversary, qa
---

# Pocket menus: a song picked inside an album plays through that album

## The ask

Dean (ROADMAP Planned, 2026-09-24): "when I go to a recent artist and I pick the artist and I go
into the album and I pick something in an album, it just plays that song and then goes to a
completely other song from the artist, almost like a shuffle when I didn't expect or intend it. I
would imagine it would play through the rest of that album. Maybe there's a way to set that."

## Diagnosis (verified against source, 2026-09-25)

- The path: Recent Artists (`menuRecentArtistItems`, a row is node type `artist`) > the artist
  (`menuArtistAlbumItems`, each album a node type `artistAlbum`) > the album (`menuLoad`
  `artistAlbum`: `menuSongLevel(..., { drill: { type: 'album', ... } })`, no `flat`) > a song.
- `playFromMenu` computes `flat = !play.drill || play.flat === true`, so an album or artist-album
  pick is NOT flat and calls `playAt(i, { soloChapter: !flat && !playThrough, pick: true })` =
  `soloChapter: true`.
- `loadTrack` arms `soloChapterExitId` only when `laterSameBaseChapterExists` (a later chapter of
  the same file sits after the pick), and `primeSoloExitStation` pre-fetches a station from
  `/api/music?artist=<artist>&sort=random`. At the chapter's end `enforceChapterExit` appends
  those picks and plays one. That is the "shuffle": a random song by the same artist.
- A non-chaptered album is unaffected (`laterSameBaseChapterExists` is false for a non-chapter
  track), so the bug is specific to chaptered albums (one long file whose `::c<n>` chapters are
  the songs), which is most of Dean's projected library.
- The solo rule was Dean's v1.311 ask for the browse view's chapter ROWS (`playRowAt`,
  `playTrackInAlbum` solo, the up-next row tap, the skin track-list tap `onSelectIndex`). The
  pocket menus inherited it for drill lists at v1.323 (K4, the Architect's overnight ruling, which
  Dean was owed a confirmation on). This is Dean's answer: an album level plays the album.

## Intake (one round; answered by the dispatch's recommendations)

The session ran autonomously, so the three intake questions were settled on the dispatch's own
recommended answers, disclosed here for Dean to overturn:

- **I1 (recommended, taken):** an album-level pick (Albums > album, and an artist's album from
  Artists or Recent Artists) plays through the album, chapters included: `soloChapter: false` on
  the pocket-menu path. The browse view's chapter rows keep the v1.311 solo rule.
- **I2 (recommended, taken):** no setting. Album levels play the album; flat lists (Songs,
  Genres, the playlists, an artist's All Songs) keep the v1.323 K4 flat rule unchanged.
- **I3 (recommended, taken):** the desktop up-next rows and the skin's track-list taps
  (`onSelectIndex`) are left alone this run (they keep the solo rule).

## Acceptance (tdd: each names its binding test)

- **AC1** A chapter picked from an ARTIST's album reached through Recent Artists (Dean's exact
  path, a real recent-listening row seeds it) plays on into the album's next chapter at the
  segment boundary: no reload, no station fetch, the menu's playing mark and the registered nav
  follow the chapter advance. Bound by integration "v1.331 (Dean): Recent Artists > artist >
  album > a chapter plays ON through the album" (music-pocket-menus.test.js).
- **AC2** The same for Albums > album. Bound by the flipped v1.323 test "a CHAPTER chosen from a
  menu plays in its album" (it now asserts NO station is primed) plus "v1.331 (Dean): Albums > album > a chapter plays ON
  through the album" (the boundary drive).
- **AC3** The v1.311 solo rule still holds on its other callers: a browse chapter-row tap
  (`playRowAt`) still primes and exits to the station. Bound by the existing
  `test/unit/music-chapter-reflect.test.js` solo tests (unchanged, must stay green).
- **AC4** Flat lists are unchanged (K4): the r1 K4 tests stay green unchanged.
- **AC5** (Dean, mid-build: "Make sure that you're accounting for regular album play as well,
  not just recent albums.") Every album entry point in the pocket menus plays on: Albums >
  album, Artists > artist > album (the non-recent artist path) and Seattle's Albums pivot, each
  driven through the chapter boundary. Bound by the v1.331 tests "Artists > artist > album" and
  "Seattle's Albums pivot" beside AC1/AC2.
- **Mutant M1:** restore `soloChapter: !flat && ...` on the pocket path; AC1 and AC2 go red.

## Build notes

- **Red first (base code, measured):** both v1.331 tests failed at the pick with the station
  prime in the log (`/api/music?artist=NESTALGIA&sort=random&seed=...&limit=30`). With that
  assertion neutralized, the boundary assertion failed on its own: at Track A's end the base
  loaded `rm1` (Recent Artists path) and `rm2` (Albums path), a random NESTALGIA song. That is
  Dean's "shuffle", reproduced on his exact path with a real recent-listening row.
- **Fix:** `playFromMenu` calls `playAt(i, { soloChapter: false, pick: true })`. The
  `opts.playThrough` argument (Shuffle Songs' only use) is dead once no menu pick is solo, so it
  and its one caller's argument were removed. The comment block states the new rule and names
  where the solo rule still lives.
- **Flipped:** the v1.323 test "a CHAPTER chosen from a menu plays in its album" asserted the solo
  station prime; it now asserts no prime. The r1 K4 All Songs test title pointed at that binding
  and was re-worded.
- **Cursor follow:** skin-surface's follow of the playing row across a chapter roll is asserted
  in the new tests (the playing mark and the cursor land on Track B; Previous then loads Track A,
  so nav re-registered at the roll).
- **Mutants (a `git archive 88d58926` sandbox in /tmp, `git diff` checked non-empty before
  crediting):** M1 `soloChapter: !flat` (the v1.323 rule) RED 5 (the flipped v1.323 test + all
  four v1.331 tests); M2 `soloChapter: true` RED 3 at 88d58926 (before AC5's two tests existed).
  Unmutated: 16/16.
- **AC5 (Dean's mid-build message):** all album levels share the one `playFromMenu` call, so the
  fix already covered them; the two added tests prove it for the plain Artists path and Seattle.
- **Suites (Node 22.23.1):** music-pocket-menus 16/16 (after AC5), music-pocket-menus-r1 26/26,
  music-chapter-reflect 42/42, music-chapter-playback 8/8, unit music-pocket-menus 29/29.

## Deviations

- **Browse view chapter rows keep the solo rule (surfaced, not changed).** Dean's AC5 message
  could also be read as the BROWSE view's album (Albums tab > album > tap a chapter row), which
  still plays that chapter and stations on. That is Dean's own LOCKED v1.311 decision (2026-09-22,
  via AskUserQuestion: "Tap ONE chapter row = play only that chapter's segment, then EXIT the
  album"; the album Play button plays all). Reversing it is a user-visible change to an approved
  decision, so it is surfaced for Dean's ruling instead of changed here. The browse album's Play
  button already plays through (unit "the album PLAY button plays straight through").

## Disclosed gaps

- **Intake answered on the recommendations** (I1-I3): the session ran autonomously; Dean can overturn any of them.
- **Browse chapter rows keep the v1.311 solo rule** (Deviations): a chapter row tapped in the browse view's album still plays just that chapter, then the station. Dean's ruling is owed.
- **#279 (pre-existing, Medium): the browse album's Play button loops a chaptered album under a non-file-order sort.** The same class has three narrow reaches on the menu path, all measured by the gate r2 adversary:
  - W-r2: a chapter-count change on the playing file mid-play (an admin edit) under a non-file-order sort drops list mode and re-lists in file order, so the loop returns until the next pick (base stationed here; b7e68622 looped too).
  - A5: after a Title Z-A menu pick, a browse tap on the last-listed chapter loops (identical at fa462238).
  - A1: with Autoplay off, a Title Z-A album ends at Intro and pauses; resuming then loops (base looped at once).
- **#278 (pre-existing, Low):** the skin-list and up-next solo callers are bound only by a source lock.
- **Unbound, correct today (gate r2 suggestions):** nothing binds "a re-time keeps list mode" (S-r2-1) or `play.flat !== true` for an artist's All Songs (S-r2-2). List mode ends the album's last chapter at its projected end, so a chapter added past it while the station is already appended is not played (S-r2-3a), and a media duration more than 0.5 s past the projection stations at the projection (S-r2-3b, as K4 flat lists since v1.323).
- **Stale comment (qa r2 S5):** the comment above `enforceFlatSegmentEnd` still says "the queue a flat menu pick built" and that a flat pick never arms the solo exit; every menu pick now builds the list-mode queue, and a solo select inside a flat list does arm it (the flat segment end then runs first). Left as is to keep the gated sha; fold into the next touch of that function.


## Gate r1 - qa

Reviewed `git diff fa462238..b7e68622` (4 files). Instruments run at b7e68622, Node 22.23.1:
music-pocket-menus 16/16, music-pocket-menus-r1 26/26, music-chapter-reflect 42/42,
music-chapter-playback 8/8, unit music-pocket-menus 29/29, chapter-snap-resume 47/47; eslint on
the three changed js files exit 0; `check-markers.sh` clean; no em dashes in the added text.
Mutant M1 (`soloChapter: !flat` restored) re-run in a /tmp `git archive` sandbox: RED 5 (the
flipped v1.323 test + all four v1.331 tests), as the Build notes claim.

Verified: default-order album pick rolls Track A into Track B with no reload and no station
fetch; nav re-registers at the roll; at the file end the ended advance (nav.onNext) stations on
with Autoplay ON (loaded za1) and registers no onNext with Autoplay OFF (nothing loads); Loop on
seeks 899.9 back to 300 (no load). The solo callers (playRowAt, playTrackInAlbum solo, the up-next
row tap, onSelectIndex) are untouched by the diff and still bound (chapter-reflect v1.311 tests +
the classification lock). The flat K4 path is unchanged (r1 26/26). Shuffle Songs is unchanged:
it has no drill, so it was already flat and `!flat && ...` was false before the edit.

- **WARNING W1 - an album pick now LOOPS forever when the album level is not in file order**
  (public/js/music.js:3759, with menuLoad `album` / `artistAlbum` at music.js:3684-3696 sorting by
  the persisted browse drill sort). The drill sorts include Title A-Z / Z-A (MUSIC_SORTS.drill),
  persisted per device in `filetube_music_sort` and read by both menu album levels. Play-through
  follows the FILE, but nav follows the QUEUE index. Measured (sandbox probe, drill-album =
  title-desc, list Track B | Track A | Intro): pick Track A, it rolls into Track B (queue index 0),
  nav re-arms at 0, the file ends, onNext loads Track A again: `djmix1::c1` on three consecutive
  ended advances. Intro never plays and the station never comes. The same probe on the base
  fa462238 stationed off (rm2, rm1, za1): Dean's bug, but not a loop. The same loop already exists
  on the browse album Play button (probe P4: identical on base and head, `playAt(0)` then c1
  forever), so this is a pre-existing class that the diff newly routes every pocket-menu album
  pick into. The new comment's "the station comes only where the album ends" is only true when
  the list is in file order. Options for the Architect (not verified end to end): order a chaptered
  file's chapters in file order on the menu album levels (the device's album level is track
  order), or run album-level picks through the flat segment end (list order, bound by K4). A
  sandbox try of `flatQueue = queue` kept all five suites green but would also leave flat mode on
  for a later browse row tap in the same drill (playRowAt reuses the queue), which suppresses that
  row's solo exit, so it needs a clear on `opts.soloChapter`. Either fix wants a title-sort test.
- **SUGGESTION S1 - the album end on the menu path is unbound.** The v1.331 tests stop at 903 s.
  Nothing on this path drives the file end (station with Autoplay on, a stop with it off). Both
  work (probe P2), but a test calling `h.spy.nav.onNext()` after Track B would bind the comment's
  claim.
- **SUGGESTION S2 - test comment accuracy**
  (test/integration/music-pocket-menus.test.js:449): "the solo band [899.75, 901) and the sparse
  cross". The ticks 899.9 and 900.4 are band ticks, and 900.4 to 903 does not cross 900, so the
  sparse-cross branch is never reached on its own. It does not weaken the binding (M1 goes red
  through the band).
- **SUGGESTION S3 - Build notes rationale:** `opts.playThrough` was already dead at base, not
  "dead once no menu pick is solo". The removal changes no behavior.

Security: no security surface. The change is client-side queue logic only. It adds no route,
fetch, HTML sink, storage key, or user-input path, and it removes one parameter. The new tests
post one progress row to an isolated DATA_DIR.

Gate: CHANGES r1 @b7e68622 — qa

## Gate r1 - adversary

Reviewed b7e68622 against fa462238. Every mutant and scratch drive ran in a `git archive b7e68622` sandbox in /tmp (and a `git archive fa462238` sandbox for base comparisons). `git diff --stat` was checked non-empty before each mutant was credited. Node 22.23.1.

Unmutated (sandbox): music-pocket-menus 16/16, music-pocket-menus-r1 26/26, unit music-chapter-reflect 42/42, unit music-chapter-playback 8/8, unit music-pocket-menus 29/29. eslint on the three changed code/test files: exit 0.

**W1 (WARNING, blocks unless fixed or disclosed with Dean's ruling): an album pick under a non-file-order drill sort loops the file's later chapters forever. It never plays the rest of the list and never reaches the station.**
- Repro (measured, seek-honoring driver: each load seeks to its chapterStartSec, the file end calls nav.onNext the way the real player's ended advance does): set `filetube_music_sort` = `{"drill-album":"title-desc"}`, open Albums > Full Album Mix (rows `Track B, Track A, Intro`), pick Track A. The run went `picked djmix1::c1@300 | ENDED | LOAD djmix1::c1@300 | ENDED | LOAD djmix1::c1@300 | ...` and was still looping at 6 cycles. Track A and Track B repeat forever. Intro never plays and there are 0 station fetches. The same loop happens on Dean's own path (Recent Artists or Artists > artist > album), because that level uses the drill-ARTIST sort (music.js:3692). `{"drill-artist":"title-desc"}` and `{"drill-artist":"duration-desc"}` both reproduce it (3 of 3 cycles looped). An artist page sorted "Title A-Z" or "Longest" is an ordinary choice. With real chapter names, title order is effectively arbitrary.
- Mechanism: with play-through, the FILE rolls in file order, so reflectChapter re-registers nav around the queue index of each live chapter. At the file's last chapter (queue index 0 under title-desc), onNext = playAt(1), which is the picked chapter again. maybeExtendQueueForAutoplay arms only on the last queue index, and the roll never lands there.
- New relative to base? New on THIS path: base stationed out after Track A in all 5 sort/path combos (measured). Under the same sort, the class already exists at base on the browse album's Play button (measured at fa462238: `play -> djmix1::c2 | ended -> djmix1::c1 | ended -> djmix1::c1 | ...`). The v1.311.3 "a playthrough LOOPED instead of stationing" class comes back on every menu album pick.
- Divergent fixture: every v1.331 test uses the default sorts, and the fixture's chapter titles (`Intro < Track A < Track B`) are alphabetical in file order. That means a title-asc run is a lookalike too. No test can see this.
- A candidate fix, verified to fix this repro but not a mandate: make every menu list flat (`flatQueue = queue` in playFromMenu), so enforceFlatSegmentEnd walks the LIST, and a contiguous next row of the same file still rolls on with no reload. Under title-desc: `picked c1@300 | LOAD c0@0 | LOAD rm1 (left the file)`, which is Track A, then Intro, then the station. album-order is unchanged. With that change, targeted suites 16/16, 26/26, 42/42, 29/29, 8/8 all stayed green. That also shows no existing test notices the drill/flat split in playFromMenu any more (mutant R3 below). Whatever the fix, it needs a test at a non-file-order sort with non-alphabetical chapter titles.

**S1 (SUGGESTION, disclose): two chaptered files with the same title and artist fold into ONE album, and a pick plays only the picked file.** Measured at HEAD with a second 2-chapter file `djmix2` titled "Full Album Mix": rows `Intro, Second Intro, Track A, Second Outro, Track B` (album-order interleaves by chapter trackNo). Picking Intro plays djmix1 through and then stations (`ended -> rm2`), and djmix2's chapters never play. Base stationed after Intro, so HEAD is strictly better. The same class already exists on the browse Play button. This is an edge case. Disclose it and do not block on it.

**S2 (SUGGESTION, existed before this diff, not introduced by it): the onSelectIndex and up-next solo callers are held only by a source lock.** Mutants S1 (onSelectIndex `soloChapter: false`) and S2 (up-next tap `soloChapter: false`) each turn exactly one test red: music-chapter-reflect #17 "the skin-select and up-next callsites pass soloChapter (classification lock)". No behavioral test catches either one.

**Verified (measured):**
- Surface 4 (tests bind): M1 `soloChapter: !flat` turns 5 tests red (the flipped v1.323 test plus all four v1.331 tests). M2 `soloChapter: true` turns 5 red, plus r1 K4 #5. R1 (drop reflectChapter's `registerTrackNav(ti)`) turns all four v1.331 tests red (the Previous check). F1 (no-op skin-surface `followCurrent`) turns 5 red. Seeding the recent row with `nd1` instead of `rm1` turns the Recent Artists test red, so the real recent-listening row drives that test. Survivors: R2 (drop reflectChapter's applyPlayingHighlight + updateNowPlayingPanel) stays 16/16, because the menu's mark and cursor come from afterPaint/followCurrent, which other paints drive. R3/P1 (drill counted as flat) stays 16/16 green (see W1).
- Surface 2 (other solo callers): S3 playRowAt in-album `false` turns reflect #12, #19, #40, #41 red. S4 playRowAt's playTrackInAlbum `solo:false` turns #16 red. S5 `var solo = false` turns #16 red. S6 loadTrack never solo turns 5 red. All four of these callers are bound.
- Surface 3 (stale state): a browse chapter-row tap (solo) primes the station. With that fetch HELD in flight, a menu pick of Albums > album > Track A followed by releasing the fetch and crossing 900 s gives: loads delta 0, still `djmix1::c1`. The late picks are dropped (the `soloChapterExitId !== forId` guard). Flat to album and album to flat: `flatQueue` is reassigned on every pick against a fresh `tracks.slice()` queue. That is reasoned (should work), not driven.
- Surface 1 (index-true, default sorts): after a menu pick of Track A rolls into Track B, the browse rows behind the skin read `0:c0, 1:c1, 2:c2*` (the playing mark moved). Tapping each row loaded exactly that row's id. At album-order, the file end goes to the station only after the whole file (`ENDED | LOAD rm1`).
- Surface 5 (Shuffle Songs): at base, `opts.playThrough` was already dead, because Shuffle's play has no drill, so `flat` is true and `!flat` is false. Measured: stripping `&& !(opts && opts.playThrough)` at fa462238 left pocket-menus 12/12 and r1 26/26 green. Removing it is zero-delta. The "Shuffle Songs shuffles the WHOLE library and plays through from the top" test is green at HEAD.

Gate: CHANGES r1 @b7e68622 — adversary

## Gate r1 fixes (builder)

Both seats found the same WARNING (W1) independently. Fixed as follows, one commit on top of b7e68622.

| Finding | Fix | Binding (test) |
|---|---|---|
| **W1** (adversary + qa): a non-file-order album level (title or duration sort) looped the later chapters forever | EVERY menu list plays in LIST order: `playFromMenu` sets `flatQueue = queue` for album levels too, so `enforceFlatSegmentEnd` walks the list (a contiguous same-file next row still rolls on with no reload; the file's last chapter leaves it to the ended advance). The adversary's candidate fix, verified by both seats. | "v1.331 gate r1 W1: Albums > album sorted Title Z-A" and "... Artists > artist > album sorted Longest first" (Track A, then Intro, then the station; the fixture's list order is the reverse of file order) |
| **QA caveat on the W1 fix**: list mode would suppress a later v1.311 single-chapter select in the same album | `flatAlbum` marks an album-level list; `playAt` drops the list mode for any `opts.soloChapter` select while that album list is the queue (browse chapter row, up-next row, skin track list). A flat Songs/Genres/playlist list keeps K4 exactly as before. | "v1.331 gate r1 (qa caveat): after a menu album pick, tapping ONE chapter row ..." (the prime fetch, then the station at Track A's end) |
| **Builder-found sibling of the W1 fix** (the INERT SIBLING class): the chapter-save seam (`applySnappedChapterTimes`) treats a list-mode queue as SOME of a file's chapters and never re-lists it, so a chapter ADDED while an album level plays would get no row | an album-level list whose chapter COUNT changed drops list mode and re-lists like the browse album drill (pre-v1.331 behavior); a re-time keeps list mode (patched in place) | r1 file: "v1.331 gate r1: a chapter ADDED while a menu-picked album level plays re-lists the album" |
| **qa S1**: no test drove the album's end on the menu path | the shared v1.331 helper now calls the ended advance (`nav.onNext`) at the album's last row and asserts the station, then Previous = Track A | the four v1.331 path tests |
| **qa S2**: the helper's comment claimed a sparse-cross tick it never drives | comment corrected to the end-band ticks it does drive | n/a |
| **qa S3 / adversary Surface 5**: `playThrough` was already dead at base | Build notes wording corrected below (zero-delta removal) | n/a |
| **adversary S1** (two same-titled chaptered files fold into one album) | not changed; with list mode the album now plays in list order across both files (reasoned, not driven). Disclosed. | n/a |
| **adversary S2** (onSelectIndex and up-next solo callers held only by a source lock; pre-existing) | not changed; tracked as #278 | n/a |

Builder mutants on the r1 fix (a `git archive 13ca027c` sandbox; `diff` non-empty before each):

| Mutant | Result |
|---|---|
| N1 album levels not in list mode (the r1 shape) | RED 2 (both non-file-order sort tests) |
| N2 no solo clear in `playAt` | RED 1 (the qa-caveat test) |
| N3 `flatAlbum` never set | RED 2 (the qa-caveat test, the chapter-added test) |
| N4 no count-change re-list | RED 1 (the chapter-added test) |
| N5 `flatAlbum` true for every list | SURVIVED at 13ca027c; bound by the r1 test "(the other axis): a single-chapter select inside a FLAT list keeps K4" (an up-next tap in the flat Songs list), RED 1 |

Correction to Build notes: `opts.playThrough` was already dead at base (Shuffle Songs has no drill, so it was always flat); its removal is zero-delta, as the adversary measured at fa462238.

Also disclosed (pre-existing, measured by both seats at fa462238, not introduced here): the BROWSE album's Play button loops the same way under a non-file-order drill sort (`c2 -> c1 -> c1 -> ...`). The browse view is outside this run's scope (I3 and Dean's locked v1.311 decision); tracked as #279 for Dean.

## Gate r2 - qa

This round checks only what changed from b7e68622 to d9355437 (commits 13ca027c and d9355437).
Instruments ran at d9355437 on Node 22.23.1:
- **Suites:** music-pocket-menus 19/19, music-pocket-menus-r1 28/28, music-chapter-reflect 42/42,
  music-chapter-playback 8/8, unit music-pocket-menus 29/29, chapter-snap-resume 47/47,
  tech-debt-census 1/1.
- **Checks:** eslint on the three changed js files exits 0. `check-markers.sh` is clean. No em
  dashes in the added text.

My r1 findings:
- **W1: fixed as prescribed, and verified.** I re-ran my probe in a `git archive d9355437` sandbox.
  This time the driver seeks to each load's chapterStartSec and steps the clock in 0.6 s ticks.
  - Title Z-A, pick Track B, Autoplay ON: loads `djmix1::c2, djmix1::c1, djmix1::c0, za1`. That is
    the list order, then the station.
  - Same, Autoplay OFF: the same three chapters, then one pause at Intro's end.
  - Album order and Title A-Z, pick Track A: `djmix1::c1` rolls through the file with no reload.
    At the file end it goes to `za1` with Autoplay ON; with Autoplay OFF there is no onNext.
  - No loop in any case.
- **My prescription's caveat: handled.** `flatAlbum` plus the `soloChapter` clear at the top of
  `playAt` cover it. The clear runs before `verifyChapterFileThenPlay` and prewarm, and it is
  idempotent on their re-entry.
- **S1: fixed.** The helper now drives the album end and asserts the station.
- **S2: fixed.** The comment now names only the band ticks.
- **S3: fixed.** A correction note was added to the Build notes.

Mutants, run in the sandbox, with `diff` non-empty before each:
- (a) drop the `playAt` solo clear: RED 1 (the qa-caveat test).
- (b) `flatAlbum = true` for every list: RED 1 (the other-axis test).
- (c) drop the count-change line in `applySnappedChapterTimes`: RED 1 (the chapter-added test).
- (d) put back the r1 flat rule `(!play.drill || play.flat === true) ? queue : null`: RED 2 (both
  non-file-order sort tests).

Every new guard goes red when it is removed. The test names match what the tests assert.

Server side: chapter `durationSec` is exact (`nextStart - start`, libraryAudio.js
expandAudioToTracks). So the flat end's "the next row is this file's next segment" check
(within 0.5 s) holds on real data, not only in the fixture.

Tracker: rows #278 and #279 use the same column shape as #275-#277, with the source in the fifth
column and the status in the sixth. tech-debt-census is green.

New findings:
- **SUGGESTION S4: the count-change re-list brings back the #279 loop class** (music.js:1847).
  This is reasoned from the code; I did not drive it. When an album level's chapter count changes
  mid-play, list mode is dropped and the album is re-listed through `render()`. The re-listed queue
  is the browse drill, in the drill sort, playing in file order. Under a title or duration sort,
  that is the browse Play button's loop from #279. Reaching it needs an admin chapter edit that
  changes the count while the album plays under a non-file-order sort. Two ways to handle it: add
  this edge to #279's text, or re-set `flatQueue = queue` in the re-list's `.then` when the list
  was an album level. It does not block.
- **SUGGESTION S5: a stale comment** (music.js:3823). It still says "The queue a flat menu pick
  built plays through that list" and "the v1.311 solo exit, which a flat pick never arms". Every
  menu pick now builds the list-mode queue. A solo select inside a FLAT list (an up-next tap) does
  arm the solo exit, and the flat end then preempts it. That preemption existed before this change
  and is now bound by the other-axis test.

Security: the delta has no security surface. It is client-side queue state (two module variables
and one clear in `playAt`). It adds no route, fetch, sink or input path. The tracker rows are
prose only.

Gate: APPROVED r2 @d9355437 — qa

## Gate r2 - adversary

Delta re-review of `git diff b7e68622..d9355437`. Mutants and drives ran in a `git archive d9355437` sandbox in /tmp, plus a `git archive fa462238` sandbox for base comparisons. `git diff --stat` was checked non-empty before each mutant was credited. Node 22.23.1.

Unmutated (sandbox): music-pocket-menus 19/19, music-pocket-menus-r1 28/28, unit music-chapter-reflect 42/42, music-chapter-playback 8/8, unit music-pocket-menus 29/29, chapter-snap-resume 47/47, music-skin-integration 117/117. eslint on the changed js files: exit 0.

**r1 W1: fixed as prescribed (verified).** I re-ran the seek-honoring driver (each load seeks to its chapterStartSec, and the file end calls nav.onNext) on all five r1 combos:
- album-order (Albums): `c1@300 | ENDED | station`. The file rolls Track A into Track B with no reload.
- title-desc (Albums): `c1@300 | c0@0 | station@300`.
- release-newest (Artists): `c1@300 | ENDED | station`.
- title-desc (Artists): `c1@300 | c0@0 | station@300`.
- duration-desc (Artists): `c1@300 | c0@0 | station@300`.

No combo loops. r1 mutants re-run at d9355437:
- Making the menu pick a solo select (`soloChapter: flatAlbum`): RED 7.
- Dropping reflectChapter's `registerTrackNav(ti)`: RED 6.
- Disabling the contiguous-row roll in enforceFlatSegmentEnd: RED 4 + r1 RED 2. The no-reload roll of a file-order album is bound.

Builder mutants reproduced:
- Album levels not in list mode: RED 2 (both sort tests).
- No solo clear in playAt: RED 1.
- `flatAlbum` never set: RED 2.
- No count-change drop: RED 1.
- `flatAlbum` true for every list (N5): RED 1, the other-axis test.

**New, measured:**
- Loop chapter still wins: 899.9 seeks back to 300 with 0 loads, under both album-order and title-desc.
- The builder's disclosed S1 claim holds when driven: a two-file album plays in list order across both files, then stations.
- Race (render held in flight): a chapter-count save starts the re-list render(). I held its album fetch, made a newer menu pick (Track B), then released the fetch. The stale render stood down, and the pick's list kept list mode: `c2 | c1 | c0 | station`.
- A solo select through verify or prewarm: every soloChapter writer goes through playAt (enumerated: onSelectIndex, up-next, playRowAt, playTrackInAlbum). The clear runs before the verify and prewarm branches. Library chapters never carry `needsTranscode` (the projection does not emit it), so prewarm is unreachable for a chapter. Reasoned from source, not driven.

**W-r2 (WARNING, argued safe to ship disclosed): a chapter COUNT change on a non-file-order album level brings the loop back.** Measured with drill-album = title-desc: pick Track A, then add Track C through the snap editor's save. The count-change path drops list mode and re-lists `c3,c2,c1,c0`. Playback then runs `c1@300 | ENDED | c2@900 | ENDED | c2@900 | ...` forever. Base stationed here and b7e68622 looped too. This is the browse drill's #279 class: after the re-list the queue is a browse album drill. Why it is safe to ship disclosed:
- It needs a non-default drill sort AND a chapter add or remove on the playing file during playback.
- It is identical to the pre-existing browse behavior.
- The next pick restores list mode.

Fix candidate (NOT verified): in the count-change `render().then`, restore `flatQueue = queue` when the list was a flatAlbum and no newer pick landed. Two more measured members of the same class belong in #279's text:
- A5: after a title-desc menu pick, a browse tap on the LAST-listed chapter (Intro) is not solo (no later row), so it plays the file on and loops `c1, c1, ...`. This is identical at fa462238, so it existed before.
- A1: with Autoplay off at title-desc, the list ends at Intro and pauses (K4). A user resume then plays the file on and loops. Base looped at once with no resume needed, so this is strictly better than base.

**S-r2-1 (SUGGESTION): "a re-time keeps list mode" is unbound.** Mutant Nf (`wasFlat && flatAlbum`, so any save drops list mode) stays green across pocket-menus 19, r1 28, chapter-snap 21, chapter-snap-shift 18, chapter-snap-return-flat 2, chapter-snap-resume 47, chapter-snap-client 16 and chapter-reflect 42. The behavior is correct today (measured: a title-desc album re-timed mid-play still goes `c1@310 | c0@0 | station@310`). Mutant Ne (drop `flatAlbum &&`) is bound by chapter-snap-resume #16.

**S-r2-2 (SUGGESTION): `play.flat !== true` is unbound.** Mutant Ng (`flatAlbum = !!play.drill`, which counts an artist's All Songs as an album level) stays green. The other-axis test drives Songs, which has no drill.

**S-r2-3 (SUGGESTION): list mode ends the album's last chapter at its PROJECTED end, not the file's.**
- (a) Measured: a chapter added while the album's last row plays (station already appended, so it is not ownsDrill and there is no re-list) shrinks Track B's span, and the station loads at 1500. Track C gets no row and never plays. At b7e68622 the file played on to its end (reasoned).
- (b) Measured with a synthetic 1810 s media duration against a 1800 s projection: the station loads at 1800, and with Autoplay off it pauses at 1800. Durations come from ffprobe `format.duration`, so a mismatch over 0.5 s is a suspicion, not a finding. K4 flat lists have had the same mechanism since v1.323.

Approval note: this approval binds to d9355437. The close commit's disclosure (W-r2 and A1/A5 into #279 and the plan's Disclosed gaps) is docs-only. Re-engage me if anything beyond docs moves.

Gate: APPROVED r2 @d9355437 — adversary
