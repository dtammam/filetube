# Exec plan: Music now-playing view (metadata + up-next queue)

**Status:** ACTIVE
**Target:** v1.104.0
**Branch:** `feature/music-nowplaying`
**Schema:** no bump (pure client UI over existing music state)

## Problem (Dean, on-device after v1.103.0)

"If I tap a song there's no detail about song name/album/etc. Under the player I
see `Playing from album`. If I press next track it goes straight to miniplayer
and starts next song." Two pre-existing gaps in the EXPANDED now-playing view
(`#player-slot`), surfaced by the v1.103 overhaul:

- **A (no metadata):** in iOS `AUDIO_PLAYER_MODE='background'` the expanded audio
  view renders ONLY `#audio-bg-art` (full-bleed album art) - there is no code
  path drawing the track title/artist/album. (player.js:6175-6188: the
  title/folder are set only in the non-background `visualizer` branch.)
- **B (next collapses):** every music track change calls `player.load(id, data,
  { dock:true })` (music.js loadTrack), which docks - so next/prev from the
  expanded view collapses to the mini-bar.

NOT regressions from v1.103 (both predate it). Dean chose (AskUserQuestion): the
FULL now-playing view - art + title/artist/album + **up-next queue**.

## Design (Dean-approved)

A music-owned `#music-nowplaying-panel` rendered directly under `#player-slot`,
visible ONLY while the player is expanded (`player.getState()==='full'`) with a
music track playing. Contents:
- `.mnp-meta`: track title (large), `artist · album` line.
- `.mnp-queue`: "Up next" heading + the remaining queue items (tappable to jump).

The shared player.js host stays the art+controls surface (untouched except the
dock-vs-slot decision below); the panel is pure music-view DOM populated from
music.js's own `queue` + a richer `nowPlaying` record. The existing thin
`#music-nowplaying` "Playing from <album>" line stays as the browse-list context
(a different surface).

## Tasks

1. **T1 keep-player-position (fix B).** loadTrack: if `player.getState()==='full'`,
   load into `#player-slot` (`{ slot }`) instead of `{ dock:true }`, so a track
   change while expanded STAYS expanded; docked/closed still dock (browse-while-
   playing unchanged). jsdom test: expanded + next -> still full; docked + tap ->
   still docked.
2. **T2 now-playing panel (A + queue).** Enrich `nowPlaying` to carry
   title/artist. Render/refresh the panel on track change + expand; hide on
   dock/close/non-music. Up-next = queue items after the playing index; tapping
   one calls `playAt`. jsdom test: panel shows title/artist/album + up-next when
   expanded, hidden when docked, tap-to-jump plays the right track, reveal-once
   (no stranded state on close).
3. **T3 CSS/polish.** Panel styling (tokens only, census 0), mobile pass, the
   `[hidden]` enforcement pattern if any control carries `.btn`.

## Gate

Full gate (touches the shared player host's dock/slot decision + the battle-won
background-audio path). Attack surfaces: does the keep-expanded change ever leave
the player mounted in a detached/absent slot (navigation away, close)? Does the
panel strand when the player closes (`emptied`)? Up-next correctness at album
edges / after shuffle / after a drill re-queue. Reveal-once (panel never shows
stale metadata for a closed/other-kind item).

## Out of scope

Re-architecting into a separate now-playing ROUTE; the deferred v1.103 D3
URL-backed browse.
