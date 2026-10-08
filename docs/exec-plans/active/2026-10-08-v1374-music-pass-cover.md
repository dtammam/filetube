---
plan: v1374-music-pass-cover
harness: v2 · lean
branch: feat/v1.374.0-music-pass-cover
anchor: outcome
status: Gate:CHANGES r1 @0bf5a150
next: (d) fix round r1 on feat/v1.374.0-cover (qa W1 + adversary S1-S5 + security INFO), then gate r2 delta re-confirmation; merge it here after APPROVED
design: Dean's intake 2026-10-08 (rulings R1-R4 below). Base main fa4e01aa.
gate: CHANGES r1 @0bf5a150 - qa (adversary + security-brief APPROVED r1)
---

# v1.374.0: Music device-pass fixes + one cover art for a saved album

Dean's v1.373.0 device pass (2026-10-07): (a) "I don't see a way to sort in the desktop Music"; (b) a downloaded album is
"not showing up in the track list order" on desktop; (c) on iPhone, "I do not see the artist or album under Recent Artists
or Recent Albums, which I would expect"; (d) ROADMAP "One cover art for a saved album": "we need to pick a base art. One
base art. If I download an album/playlist some songs have their own art. I want to be able to pick one from the media
and have it download as that for the rest."

Read first: AGENTS.md, docs/LESSONS.md 0, 1, 2, 4, 6 (a), 9 + 11 (d), 10 (d: a route takes a new id).

## 1. Measurements (before any edit)

Instruments (scratchpad, not committed): `sort-probe.js` (the real app over raw CDP, a seeded library with a native album
whose title and added order OPPOSE track order and a "Save as an album" download in the scan's persisted tag shape;
desktop 1440x900 and 390x844 with an iPhone UA) and `recent-probe.js` (Playwright, the visual seed on a WRITABLE server,
a listening history, the iPod opened from the toolbar, Music > Recent Albums / Recent Artists / Albums).

- **(a) falsifier: "the sort is hidden in an album opened from Home" (vs a CSS/skin hide).** BEFORE, both widths alike:
  Home landing hidden (correct); Home -> album card: `visibility:hidden`, and the select still held the Songs-tab options
  (`newest,title-asc,...`); Albums tab -> the same album: visible, drill options, `album-order`. Cause: `rebuildSortMenu`
  reserved the slot on `tab === 'home'`, and a drill opened from a Home shelf keeps `tab = 'home'` (openDrill never changes
  the tab). Not desktop-specific: on the phone Dean reaches albums through the Albums tab or the iPod, which hides it.
- **(b)** Default album sort (`drill-album` = album-order): the download opened in track order (Green Greens, Float
  Islands, Gourmet Race, Butter Building = tracks 1-4) from Home and from Albums, both widths. With a remembered
  `drill-album: newest` it opened out of order AND (from Home) with no control to change it. Only the sort select writes
  `filetube_music_sort`, so a non-default drill sort was picked on that desktop once. Album order also needs track tags:
  album downloads from v1.371.0 on carry them; older downloads sort by album artist + album only.
  Falsifier for Dean's device: open the album; the sort now shows. If it already reads "Album order" and the songs are
  still out of order, this diagnosis is wrong (then the tracks lack track tags or another path opens them).
- **(c)** BEFORE at 390: Recent Albums, Recent Artists and Albums rows drew the name only (`detail: null`, 34px rows).
  Cause: the builders set `sub`, which no renderer reads; the iPod row draws `detail` (`.ipm-detail`, added for Play on
  in v1.348, two lines inside the fixed `--pk-row-h`). The Songs rows' `sub` is dead the same way (left alone: Dean ruled
  song lists stay one line).

AFTER (this branch): Home -> album: sort visible, drill options, the remembered value (`album-order`, or `newest` when
remembered); Home landing still reserved. iPod rows: Recent Albums "Sodium Lamps / Halden Arcs", Recent Artists
"Halden Arcs / Sodium Lamps", Albums "Glass Orchard / Oriel Vance", all 34px (screenshot reviewed).

## 2. Rulings (Dean, 2026-10-08, AskUserQuestion)

- R1 (d) cover home: **embed at download.** Pick in the playlist picker; every NEW track of the album embeds it. Albums
  already saved keep mixed art; no file already in the library is rewritten.
- R2 (d) picker: **a Cover row with the existing menu** in the Save as an album group: "Cover: Each song's own art" by
  default; tapping opens the existing ui menu listing the playlist's songs (thumbnail + name); one pick.
  As built (builder, disclosed): the menu lists the song NAMES only - ui.menu's media slot takes an icon, not a
  thumbnail, and no new component was invented; the picker rows above it show the pictures. Device check in section 4.
- R3 (c) under a Recent Artists row: **the album of that artist's most recent play.** Recent Albums: the album artist.
- R4 (c) the full **Albums** list shows the artist too. Song lists stay one line.

## 3. (d) design

yt-dlp at source (2026.08.19, measured by a research agent, scratchpad `ytdlp-cover/`): no pure argv makes every video
embed one image (`thumbnail` is read before `pre_process`; `thumbnails` cannot be set from a string; a pre-placed cover
file is deleted under `--no-force-overwrites` or must match the top thumbnail's extension). Two mechanisms measured
byte-exact: a yt-dlp plugin at `before_dl`, or an ffmpeg re-embed after the track. Chosen: **the ffmpeg re-embed of the
files THIS job produced**, because a failure keeps the track's own art and the download still succeeds (a plugin that
fails to load fails the download, and the engine updates itself), and it adds no code inside yt-dlp.

- Request: the album gains `coverId` (a YouTube video id from the listed playlist; validated as an id, never a URL).
  Persisted with the album in the pending entry (LESSONS 9).
- Image: fetched ONCE per job from the fixed host `https://i.ytimg.com/vi/<id>/maxresdefault.jpg`, then `hqdefault.jpg`;
  a non-200 is a failure (404 returns a 1097-byte placeholder image); cropped to a centred square once.
- Per track, after yt-dlp has finished it and before the library scan reads it: mp3 `ffmpeg -copyts -i in -i cover
  -map 0:a -map 1:0 -map_metadata 0 -map_chapters 0 -c copy -id3v2_version 3 -write_id3v1 1 -metadata:s:v "title=Album
  cover" -metadata:s:v "comment=Cover (front)" -disposition:v:0 attached_pic tmp` (m4a without the id3 flags), verified
  by ffprobe (one audio stream of the same codec; the duration within 0.1 s; every tag the library scan reads that the
  original had, with the same value - server.js EMBEDDED_TAG_WHITELIST as parseFfprobeTags folds its aliases, plus
  `purl`; the chapters within 0.001 s; exactly one attached picture), then renamed over the file. Any failure: the temp is removed, the file is
  untouched. `-copyts` is required (without it each mp3 remux moves chapters back 0.023 s).
- Data-loss surface (full gate): the rename over a just-downloaded file, ENOSPC mid-write, a crash between write and
  rename, a concurrent scan, a file that is not this job's.

**Built (branch feat/v1.374.0-cover).** `lib/ytdlp/cover.js` (new), `album.js` (coverId), `index.js` (runPlaylistJob,
runOneShot, albumCoverTargets), the picker's Cover row in `public/js/common.js`.
- Ordering vs the scan: the re-embed runs inside runOneShot, awaited, inside the shared download gate, BEFORE the job's own
  fire-and-forget `scanDirectories()` trigger, so the scan that indexes the track reads the new cover (bound by a test whose
  scan stub reads the file at the trigger; moving the re-embed after the trigger turns it red). Residual window: a periodic
  or manual scan that runs between yt-dlp's final move and the rename indexes the song's own art; the job's own scan then
  sees a different size (`unchanged` = same path AND size, lib/scan/orchestrator.js) and takes the "new or updated file"
  arm, which extracts the thumbnail again. An identical byte size would keep the old thumbnail (not seen; not tested).
- Which files: only `albumCoverTargets` - a clean exit's FTCHDST final, `alreadyDownloaded` false, a FTCHSRC source with
  `__real_download` true and the final's stem, and the `isFreshJobFile` fence (regular file, created during the job, under
  the root and the job's folder). R1 rides the album tags: no tags (a video any library has) = no cover, and a job where
  no track gets tags fetches nothing.
- Temp naming: `.ftcover-<pid>-<12 hex>.tmp` in the file's own folder (atomic rename, one filesystem). `.tmp` is not in
  AUDIO_EXTENSIONS / VIDEO_EXTENSIONS, so the scan never indexes it; ffmpeg is told the muxer (`-f mp3` / `-f ipod`) and
  `-n` (never overwrite). A crash between write and rename leaves an orphan, removed by `removeOrphanTemps` before the next
  re-embed in that folder (disclosed: ONLY a later cover job into the same folder sweeps it; there is no boot sweep, so an
  orphan in a folder no cover job reaches again stays; it is never indexed). The sweep takes our exact name shape, regular
  files only, never a temp in flight.
- Concurrency: every re-embed runs inside runExclusive, so no other download (subscription, one-off, reheat re-pull)
  writes meanwhile; an in-process claim refuses a second re-embed of the same file; just before the rename the file must
  still be the one probed (dev, ino, size, mtime), else the temp is dropped (a delete or another writer wins, the file is
  never resurrected). The rename keeps the file's mode and mtime (the scan's date and tombstone checks read mtime).
- The menu: `ui.menu` has an icon slot only, no thumbnail, so it lists the song names (the rows above show the pictures).

**Fix round r1 (builder, @0bf5a150 -> this commit).** qa W1 / adversary S2: the verify compared 5 tags; it now compares
every tag the scan reads (`scanTagsOf` mirrors parseFfprobeTags, locked by test/unit/ytdlp-cover-tag-parity.test.js) plus
`purl`; an ID3v2.4 date "20240101" that comes back "2024" is refused (measured with the real ffmpeg: the file is kept).
yt-dlp's own mp3 is already ID3v2.3 (date "2026", measured), so its tracks still pass (real e2e re-run: both covers).
S1: the orphan sweep is bound by an integration test. S3: hqdefault takes its centred 16:9 band (4 rows short of the
measured band edge) before the square. Security INFO: the fetched image is decoded with `-f jpeg_pipe`. S5: a killed
tool logs its signal. S4: the picker's "is the sheet open" check in the Cover pick was removed (a pick on a closed
picker sets a value nothing can post).

## 4. Acceptance

1. Desktop and phone: an album opened from Home shows the sort, with the album's remembered sort selected.
2. iPhone iPod: Recent Albums shows the artist under each album, Recent Artists the last album played, Albums the artist.
3. A playlist saved as an album with a Cover picked: every downloaded track's embedded cover is that image, the album card,
   the song rows and the iPod show it (desktop and phone); with "Each song's own art" nothing changes. A failed cover
   fetch leaves each track's own art and the download succeeds.
   Device check for Dean: the Cover menu lists the songs by NAME only (no thumbnails: ui.menu has no thumbnail slot) - say
   whether that is enough to pick by, or whether the menu needs pictures (a new menu media slot, its own change). A
   video with no maxresdefault image gets its hqdefault, cropped from the 16:9 band (smaller: 266 px square).

## 5. Gate

(pending)
