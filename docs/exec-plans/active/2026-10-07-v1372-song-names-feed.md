---
plan: v1372-song-names-feed
harness: v2 · lean
branch: feat/v1.372.0-song-names-feed
anchor: outcome
status: Building
next: W1-W3, then the gate (section 6) and the release as v1.372.0
design: Dean's rulings 2026-10-07 (R1-R6 below), right after v1.371.0 shipped. Base main c2d0d694. The subtitles + 360 + cleanup wave renumbers to v1.373.0 before it builds.
gate: pending
---

# v1.372.0: Edit the song names before an album downloads; keep music out of the home feed

Two asks from Dean on 2026-10-07, shipped as one release (his ruling):

1. "For cases where the name cleanup doesn't solve like the name of the song in the end. Can we make them modifiable in that
   window. Song names etc."
2. "If I download 20 songs and they are Audio from YouTube I have the option to not see them in the main feed. Even the Audio
   feed. We can try Audio never in the feed as an option."

Read first: AGENTS.md, docs/LESSONS.md sections 0, 2, 4 (the sheet activation guard; a surface opened from a sheet), 9 (a new
persisted field: the album's titles ride the pending entry), 10 (a new per-user read on every home surface), 11, 12 (inert
sibling lists: every home surface and every synced-pref list).

## 1. Outcomes

1. With Save as an album on, every pickable row shows the name the song WILL get (cleaned when Clean up titles is on) and
   "Track N". Tapping a song's name opens the app's standard text dialog (`ui.prompt`), prefilled; Save renames it, Cancel or
   an empty name keeps it. What the row shows is exactly what is written to the file.
2. With Save as an album off, tapping a pickable row ticks it (as a Settings row does), so the tap is never dead.
3. Settings has "Show music in the home feed" (per user, synced, on by default = today). Off: audio media items (music) are
   left out of every home surface (the classic home grid, the row feed, the modern grid and its Audio chip). Opening a
   folder, a channel, search and Music still show everything. Podcasts are not music and stay.

## 2. What exists (recon 2026-10-07 on c2d0d694)

- Picker: `openPlaylistPicker` (public/js/common.js) builds rows with `ui.row({ title, meta, media, actions: [box] })`; a row
  given `onClick` with actions renders its title as a `ui-row__link` button stretched over the row (public/css/ui.css 426-459).
  `ui.prompt({ title, label, value, confirmLabel })` (public/js/ui.js) resolves the typed value or null and carries its own
  activation guard.
- Album tags: `lib/ytdlp/album.js` (`albumFrom`, `trackTagsFor`, `albumTagArgs`; `TITLE_NOISE_PATTERN` + the artist-prefix
  rule run inside yt-dlp when `cleanTitles`). Album = `{ title, artist, cleanTitles, tracks: {id: n} }`, persisted in the
  pending entry and the activity row (Retry).
- Home: `GET /api/home` (lib/media/routes.js; the row feed and `?view=grid`), `GET /api/videos` home arm (no search / folder /
  root: the hidden-folders filter). Synced prefs: `lib/prefs-allowlist.js` SYNCED_PREF_KEYS (+ the client twin in
  public/js/prefs-sync.js, a triple-lock test), stored per user in `user_prefs` (`userStore.getPrefs`). Home-row switches:
  setup.html rows + setup.js `wireHomeRowToggle` / `loadHomeRowControl` (`ft-home-continue-listening`).

## 3. Measurements
(builder fills in)

## 4. Rulings (Dean, 2026-10-07)

- R1 Song names are edited by tapping the name: the standard text dialog, prefilled; the row shows the name and its track.
- R2 One release with the feed switch (v1.372.0).
- R3 The feed switch is per user, a Settings option; off = audio never in the home feed, the Audio filter included.
- R4 (builder) What-you-see-is-what-you-get: the picker computes the cleaned names (the noise rule from the server, the
  artist prefix live from the Album artist field) and sends only names that differ from YouTube's; the server writes each
  as a literal `meta_title`. The in-yt-dlp cleanup stays for a pending entry written by v1.371.0 (no titles map).
- R5 (builder) The server decides the feed from the user's SYNCED pref (`ft-home-music`, '0' = off), so every home surface
  (and any future one) honours it with no per-request flag; the Settings switch pushes the pref before it reports done.
- R6 (builder) Music = a media item of `type === 'audio'` (yt-dlp audio and local audio files alike); podcast episodes are not.

## 5. Waves

### W1. Song names (server)
- `run.playlistEntryFrom` adds `titleClean`: the title with the noise groups removed (album.js `cleanTitleNoise`, the SAME
  pattern string the yt-dlp path uses).
- `albumFrom` accepts `titles: {id: string}` (each `cleanText`, ids of the job only, null-proto); `trackTagsFor` returns the
  track's title; `albumTagArgs` writes a literal `meta_title` when there is one (and then no regex cleanup for that track).
- Falsifier: unit tests per guard; the real yt-dlp writes the literal title (ffprobe read-back, hostile names).

### W2. Song names (client)
- Rows built with `onClick` (pickable rows only): album on -> `ui.prompt` rename; album off -> toggle the row's switch.
- Each row's shown title follows the album switch, Clean up titles, the Album artist field and the rename; meta "Track N".
- The POST's `album.titles` = the ticked rows whose final name differs from the original.
- Falsifier: jsdom through the real picker + ui.js (prompt Save / Cancel / empty, the activation guard on the row tap, the
  posted titles); a 390px Chromium shot.

### W3. Show music in the home feed
- `ft-home-music` joins SYNCED_PREF_KEYS (server + client twin), the Settings row (setup.html + setup.js, the home-row
  pattern), and `/api/home` (rows + grid) and the `/api/videos` home arm skip `type === 'audio'` media when it is '0'.
- Falsifier: integration tests per surface with a seeded pref (on, off, absent), the folder/search arms unaffected, the
  triple-lock and settings-shape locks.

## 6. Gate
Seats: adversary (floor) + qa + security-brief (a new per-user read on every home surface; a new persisted field).

## 7. Evidence
(builder fills in)

## 8. Out of scope
- Editing other per-track fields (artist per track, track numbers): only names were asked.
- Hiding podcasts from the feed.
