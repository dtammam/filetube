# Exec plan: chaptered downloads as Music albums (chapters = virtual tracks)

Status: ACTIVE. Owner: main session. Gate: FULL (touches the projection, search,
the music view, AND the battle-won player). Dean (2026-08-31, hyped): a downloaded
"full album" audio file with YouTube chapter markers should show in Music as an
ALBUM, each CHAPTER a tapable track, searchable, tap-to-seek. Auto-detect (2+
chapters), virtual tracks (no re-encode). Data CONFIRMED real (chapters render in
the video view; scan captures them, download embeds them).

## The data (verified)
- `--embed-chapters` is passed on every yt-dlp download (lib/ytdlp/args.js:1191),
  incl. audio (`-x --audio-format`); the scan runs `-show_chapters` on every file
  (buildFfprobeArgs, server.js:3521); `parseFfprobeChapters` (server.js:3205)
  yields `[{ startTime(sec), title }, ...]`; `resolveItemChapters(item)` (server.js
  ~3266) returns embedded|manual|description chapters, [] when none. Dean confirmed
  the majority of NESTALGIA downloads carry readable chapters.
- A chapter = `{ startTime: seconds(float), title: string }`, ascending.

## The model: VIRTUAL chapter-tracks
A single audio file with >=2 resolved chapters expands into N virtual tracks (one
per chapter); a file with 0-1 chapters stays ONE track (the plain "downloaded
audio in music" case). A virtual chapter-track:
- `id`: `<itemId>::c<index>` (a NEW id scheme; RBAC + routing decode the `<itemId>`
  prefix, so a chapter-track is gated by the SAME `mediaVisibleTo(item)` as the
  file, and streams from the file). MUST round-trip: id -> {itemId, chapterIndex}.
- `title`: the chapter title (falls back to "Track N" when the chapter has none).
- `album`: the file's title (THE album); `albumKey`: a stable key for the FILE
  (so all its chapter-tracks group into one album via groupAlbums).
- `artist` / `albumArtist`: the channel (as today's projectAudioItem).
- `durationSec`: chapter span = next.startTime - this.startTime (last = file
  duration - startTime).
- `source`: `'library-chapter'`; `streamSrc`: `/video/<itemId>` (the ONE file);
  `chapterStartSec`: this chapter's startTime; `artUrl`: `/thumbnail/<itemId>`;
  `progressEndpoint`: `/api/progress` (media store, per the v1.215 seam - BUT keyed
  per chapter: see Playback/resume risk).

## Where they're derived (server)
A pure `expandAudioToTracks(item, resolveChaptersFn)` in lib/music/libraryAudio.js:
returns `[projectAudioItem(item)]` when <2 chapters, else N chapter-track records.
Consumers:
1. `projectedLibraryTracks` (server.js): map each eligible audio item through it
   (flatMap) instead of one projectAudioItem.
2. `searchMusic` (lib/search/registry.js): emit each chapter-track as a
   `resultType:'music', kind:'track'` result with the library+chapter markers, so
   a chapter TITLE is searchable as a song (Dean: "chapters as song names in
   search"). Needs the projection deps (the master toggle + resolveItemChapters)
   threaded into the registry, mirroring the v1.220-planned searchMusic change.
3. `groupAlbums`/`groupArtists` (lib/music/query.js): unchanged - the chapter-tracks'
   shared albumKey makes them one album automatically.

## Client (music.js) - the album view
A chaptered download drilled into (`/api/music?album=<albumKey>`) already returns
its chapter-tracks in order (albumKey filter + album-order sort by trackNo/
chapterIndex). renderDrillView shows the album header (the file title) + the
chapter tracklist. Mostly FREE - it is just an album whose tracks happen to be
chapters. Tap a row -> playRowAt (existing) -> plays that chapter-track.

## Playback (THE risk - reuse the battle-won player, never rebuild)
A chapter-track streams `/video/<itemId>` and must START at `chapterStartSec`; the
queue is the file's chapters, so Next/Prev walk chapters WITHIN one file.
- `player.load(id, data, opts)`: `data` gains `chapterStartSec`. On load, after
  the src is ready, seek `currentTime = chapterStartSec` (the player already sets
  currentTime for resume + has chapter-loop machinery at ~1082 to reuse).
- SAME-FILE optimization: if the next chapter-track's `<itemId>` equals the loaded
  file's, DON'T reload - just seek (avoids a re-buffer per chapter). music.js's
  play path checks this.
- AUTO-ADVANCE at a chapter's END: today the player advances the QUEUE on `ended`
  (whole file). For chapters, "end of chapter" = next.startTime, not file end. Two
  options (decide in slice 4): (a) a timeupdate watch that advances the queue when
  currentTime reaches the next chapter's start (reuses the chapter-loop end math),
  or (b) let the file play through and only the tracklist/now-playing label tracks
  the current chapter. Start with (a) for true per-track behavior; fall back to (b)
  if the player integration is too invasive.
- RESUME: progress is per chapter-track id (the media store keys on id; a chapter
  id is distinct), OR per file + offset. Simplest correct: save per chapter-track
  id via /api/progress (the v1.215 merge already surfaces media-store progress for
  library tracks) - but the position is RELATIVE to the chapter (currentTime -
  chapterStartSec) so resume seeks back correctly. Bind this explicitly.

## Slices (each its own commits + green; gate the whole wave)
1. SERVER: `expandAudioToTracks` + id scheme (encode/decode) + projection flatMap +
   RBAC (a chapter id gates on its itemId) + the byte route accepts the chapter id
   (or the client always uses `/video/<itemId>`). Tests: a 3-chapter item -> 3
   tracks with right titles/spans/albumKey; a 0-1 chapter item -> 1 track; RBAC.
2. SEARCH: searchMusic emits chapter-tracks (toggle-gated); a chapter title is
   found; RBAC; a non-chaptered download is one result.
3. CLIENT album view: the chaptered download renders as an album + tracklist
   (mostly the existing drill; bind the chapter rows + album header).
4. PLAYBACK: play a chapter -> load `/video/<itemId>` + seek chapterStartSec;
   Next/Prev walk chapters (same-file seek); auto-advance at chapter end; resume.
   The riskiest - smallest safe increment, reuse the seek/chapter-loop code.

## Named attack surfaces (for the gate)
- RBAC: a chapter id must gate EXACTLY as its file (mediaVisibleTo); no id that
  smuggles access to a hidden file. The `::c<idx>` decode must reject junk.
- The id scheme collision with a native track id or a real media id (`::` is not
  in yt-dlp ids; bind it).
- Playback: no reparent/rebuild of the player; background-audio unaffected; a
  same-file seek does not re-fire progress/handoff wrongly.
- resolveItemChapters source precedence (manual > embedded > description) - a
  chaptered file whose chapters come from the DESCRIPTION still works.
- A 1-chapter or malformed-chapter file never becomes a bogus album.
- Search: chapter results carry the seek info so a search-tap plays the chapter.

## Out of scope
Splitting files into real per-track files (Dean chose virtual); editing chapters
from Music (the video view's chapter editor stays the owner); non-audio (video)
chapter-albums.
