# Exec plan: v1.222 - chapter-album polish (art, theatre tracklist, search album, recent recording)

Status: ACTIVE. Owner: main session. Gate: FULL (item 1 touches the RBAC-gated
/albumart thumbnail route; item 4 touches the progress/resume path - data). Dean
(2026-08-31), four asks after v1.221's chapter-albums shipped and delighted him:

1. **Chapter-album art shows the video's picture** (today: grey placeholder).
2. **Desktop Music view: the Theatre button reveals the album / up-next** in the
   dead space where the watch page shows its "Related files" sidebar.
3. **Search results show the Album** (today the byline is Artist only).
4. **Recently-played reflects chapter-album listening + the file resumes** - today
   a chapter play records NOTHING (v1.221 skip), so its artist never reaches the
   home "Recently played" row and there is no resume. Dean chose the full fix.

## Slices (each independently testable, its own tests, green before the next)

### Slice 1 - chapter-album art (item 1)  [bug]
`GET /albumart/:id` (server.js ~8668): when the id is not a native track AND not a
direct audio media id, strip a trailing `::c<idx>` and retry the MEDIA-item
thumbnail fallback with the base id - gated by the SAME `mediaVisibleTo(baseItem)`
+ `hasThumbnail` check (no restricted-thumbnail leak; a chapter of a blocked file
still 404s -> placeholder). PREDICTION (machine-checked in the test): a chapter
id resolves to the base file's `/thumbnail/<baseId>.jpg`; projected singles +
native tracks unchanged. Covers the album tile, the result card, AND the recent-
artist tile art in one place (all route through /albumart/<id>).

### Slice 2 - search result shows the Album (item 3)  [display]
The music/track result already carries `album` (registry.js searchMusic). The card
byline (main.js cardKindPresentation kind 'track' -> `uploaderLabel: item.artist`)
shows artist only. Add the album to the byline as "Artist . Album" (album appended
ONLY when present; native tracks with no album unchanged). Bind: a track result
with an album renders the album in the byline; one without does not.

### Slice 3 - Theatre reveals the album tracklist on desktop (item 2)  [layout]
On the Music view, desktop, the expanded player's Theatre toggle reveals a side
column showing the album / up-next tracklist (the `.mnp-queue` data, which today
only lives in the collapsed now-playing panel). Reuse the watch page's theatre
vocabulary (`.theater-mode`) but scope it to the music host so it never affects the
real watch page. MEASURE the container (no CSS-var height guessing - the norm).
Desktop-only (a width media query); mobile unchanged. Device-validate.

### Slice 4 - record chapter plays -> Recently played + resume (item 4)  [data]
The crux. A chapter track's player `currentTime` is ALREADY the file-absolute
position (we seek to chapterStartSec and play the whole file). So:
- **Record:** `saveProgressToServer` (player.js ~4466), instead of skipping a
  chapter track, saves to the MEDIA store under the BASE FILE id (a real media id
  -> no 404) at position = currentTime (file-absolute). Carry `data.baseMediaId`
  (the file id) on a chapter track's load data (music.js loadTrack) so the save
  has the id without decoding.
- **Surface in Recently played:** `musicListProgressMap` (server.js ~8423) maps a
  chapter track to the base file's media progress. The recent-listening FILTER
  collapses a chaptered file to ONE entry - the chapter whose [start, start+span)
  contains the saved file position (the "chapter you were in") - so the home row
  shows one tile (title = that chapter, artist, album), not N. `recentArtists`
  (music.js renderHome) then shows the artist (dedup already there).
- **Resume:** the collapsed recent entry carries a resume offset; tapping it seeks
  to the saved FILE position, not the chapter head. Tapping a DIFFERENT chapter
  (one with no saved progress) plays from that chapter's start. GATE NOTE (QA
  WARNING 2, shipped disclosed): because /api/music?album= also runs
  musicListProgressMap, the ONE chapter you were last in carries resumeSec in the
  album view too - so tapping THAT chapter in the album resumes mid-chapter rather
  than restarting it (consistent with how a long single already resumes on any
  tap). Device-pending: Dean's call on whether an explicit tap of the last-played
  chapter should restart it instead; the fix would carry resumeSec only down the
  continue/recent path.

RISK / named attack surfaces for the gate:
- RBAC: /albumart base-id strip must re-gate the BASE item (a chapter id must not
  leak a blocked file's thumbnail). Progress: a chapter play must not write/read
  another user's media progress; base-id must belong to a mediaVisibleTo file.
- The persist-gate / stale-snapshot class: base-file progress is the MEDIA store
  (existing), so no new db.metadata field - but verify the recent-listening
  collapse doesn't double-count or drop the entry across the projection merge.
- No player rebuild: the record/resume change sits in the battle-won save/resume
  path - a NON-chapter track must be byte-unchanged (chapterStartSec absent).
- Explicit-chapter-tap vs resume: tapping chapter B must play B's start, never the
  saved offset (only a continue/recent tap resumes).

## Verification
Per-slice unit + integration; full `npm test` before the gate (the unit hook hides
a red integration suite). Full two-reviewer gate (data + RBAC). Dual-Node
(22.23.1 + 24.14.0). Device pass PENDING for slices 3 (layout) + 4 (resume feel).
