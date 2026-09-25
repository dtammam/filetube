---
plan: album-pick-plays-through
harness: v2 · lean
branch: fix/album-pick-plays-through
anchor: tdd
status: Building
next: the gate (adversary + qa) against the build commit, then the release.
design: "Approved 2026-09-25 (Dean's dispatch; the intake questions answered by the dispatch's own recommendations, see Intake)"
gate: pending
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
- **Suites (Node 22.23.1):** music-pocket-menus 14/14, music-pocket-menus-r1 26/26,
  music-chapter-reflect 42/42, music-chapter-playback 8/8, unit music-pocket-menus 29/29.

## Deviations

(none yet)

## Disclosed gaps

(filled at close)
