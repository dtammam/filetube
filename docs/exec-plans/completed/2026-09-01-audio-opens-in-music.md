# Exec plan: Downloaded audio opens in the Music player (flag, client-only)

Status: SHIPPED v1.236.0 (2026-09-01). Branch `feat/audio-opens-in-music` off main (post v1.235.0).
Owner: main session (lean mode). Target: v1.236.0.

## Intent (Dean)

"In my home feed I tap a thing that is music (chapters, etc.) - I'd love it to open in
the MUSIC player natively" instead of the video `/watch` page. Plus: a chaptered item
should open in its ALBUM so the iPod MENU/list browses the chapter tracks.

## Decisions (locked with Dean at intake)

1. **What reroutes:** AUDIO-ONLY downloads (`item.type === 'audio'`) + CHAPTERED audio.
   A genuine music VIDEO (has a video track) and regular videos stay on `/watch`.
2. **Flag:** a new toggle "Open downloaded music in the music player", **default ON**;
   turning it off restores today's `/watch` behavior.
3. **Where:** EVERYWHERE a music item is tapped - home feed, search, channel pages,
   continue-watching (also fixes the v1.224 "Continue watching opens /watch for music" bug).
4. **Bound to the Music library, NO SERVER CHANGE** (Dean's pick over "extend the player"):
   the reroute only *routes*; the music player can only PLAY ids that `/api/music/:id`
   resolves = native tracks + the opt-in `projectedLibraryTracks` set (`musicIncludesLibrary
   === 'on'` + eligible channel + RBAC). A non-resolvable id must fall back to `/watch`, not
   dead-end (see the graceful fallback).

## The load-bearing constraints (from the feasibility map - VERIFIED, not theory)

- `item.type === 'audio'` is the authoritative audio signal (scanner: server.js:4248/4672).
- `/api/music/:id` resolves ONLY native + projected tracks; a NON-projected audio download
  404s there (server.js:8627-8646). So routing it to `/music?play=` would 404. Client can't
  compute projection eligibility -> we need the GRACEFUL FALLBACK below, not a precise gate.
- **Chaptered:** a chaptered file expands into `<id>::c<idx>` tracks; the BASE id is NOT a
  track (libraryAudio.js:151/159-189). So a chaptered item must route to `/music?play=<id>::c0`
  (a `::c` track carries an albumKey -> `playTrackFromContinue` -> `playTrackInAlbum` -> the
  album view with all chapter tracks -> the iPod MENU/list browses them = Dean's ask). The
  embedded `item.chapters` array (used to detect "chaptered" + count >= 2) rides ONLY the
  `/api/videos` spread (grid / channel / continue-watching); the modern-grid/search/home-row
  payloads do NOT carry it (feasibility map §1/§4).
- Surfaces that carry `item.type` client-side: classic+modern grid, channel, continue-watching,
  search-registry results. The `/api/home` ROW feed does NOT carry `type` (server.js:11095) -
  BUT it already routes `kind:'track'` items to `/music?play=` server-side (server.js:11080),
  so a PROJECTED track in the row feed already opens in music; only video-side `kind:'media'`
  audio there can't be rerouted client-side (documented limitation - no server change).

## Design

### The one routing helper (client)
`audioOpensInMusic()` = the flag read (default-ON localStorage `ft-open-audio-in-music`, the
`homeRowEnabled` idiom, main.js:813). A single helper `musicHrefForItem(item)` returns the
music destination for an audio item, or null if it shouldn't reroute:
- not enabled, or `item.type !== 'audio'` -> null (caller uses its normal `/watch` href).
- chaptered (`Array.isArray(item.chapters) && item.chapters.length >= 2`) -> `/music?play=<id>::c0`.
- else -> `/music?play=<id>`.
Applied at every href builder that today emits `/watch` for a tile the user taps (feasibility
map §4): `cardKindPresentation`/`buildCardHtml` (main.js:610/2480), `buildVideoRowCardHtml`
(main.js:253, continue-watching), `queueEntryHref` (common.js:4109, up-next/autoplay - keyed
by the entry item's type), and the search results path. Each already has `item.type` (except
the home ROW feed, per the limitation above).

### The graceful fallback (client, the anti-dead-end)
`playTrackFromContinue` (music.js:2105) currently, on a `/api/music/:id` 404, falls through to
`render()` (shows the browse view - a dead end for a rerouted tap). CHANGE: on a miss (track
not in recent list AND `/api/music/:id` 404/!id), redirect to `/watch.html?v=<baseId>` (strip a
`::c\d+$` suffix). So a non-projected audio item that got rerouted still lands where it plays -
just via the music view briefly. For Dean's opted-in library this path is rarely hit (his audio
IS projected -> resolves 200 -> plays, no bounce).

### Optional flash-avoidance
If `me.settings.musicIncludesLibrary` is readable client-side and is NOT 'on', the projection is
empty so EVERY reroute would bounce - in that case `musicHrefForItem` returns null (no reroute,
no flash). If not readable, rely on the graceful fallback. (Belt-and-suspenders; resolve in T1.)

### The flag UI
A Settings/Appearance (or Playback) checkbox mirroring `loadHomeRowControl`/`wireHomeRowToggle`
(setup.js:949/956), key `ft-open-audio-in-music`, default-ON, on EVERY shell that renders it.

## What does NOT change
- The server (Dean's pick) - no `/api/music/:id` extension, no new payload fields.
- player.js, the music engine, RBAC - the reroute only sends ids the existing (RBAC-gated)
  music API already serves; a miss bounces to `/watch` (itself RBAC-gated).
- Non-audio tiles, and audio when the flag is OFF - identical to today.

## Tasks (small green commits)
- **T1** - the flag (localStorage default-ON read helper + Settings toggle + shell coverage)
  and `musicHrefForItem` helper; unit tests for the helper's 4 branches + the flag default.
- **T2** - wire `musicHrefForItem` into every href builder (grid/card, continue-watching row,
  queueEntryHref, search); tests per surface that an audio item -> /music?play= (chaptered ->
  `::c0`), a video item -> /watch, and flag-off -> /watch everywhere.
- **T3** - the graceful `/watch` fallback in `playTrackFromContinue` on a resolve miss; test the
  404 path redirects to `/watch.html?v=<baseId>` (::c suffix stripped), and a resolvable id still
  plays (no redirect).
- **T4** - chaptered end-to-end: a `::c0` reroute opens the album so the iPod MENU/list shows the
  chapter tracks (Dean's requirement); bind it.
- **T5** - docs/release: ROADMAP + releases.json ledger + close the v1.224 open item + this plan
  -> completed/.

## Test strategy
- Helper unit tests (pure): 4 branches x flag on/off.
- Per-surface href tests: drive each builder with an audio item (+/- chapters) and a video item;
  assert the emitted href. Bind flag-off = /watch everywhere (both axes).
- jsdom for the music-view fallback: stub fetch so `/api/music/:id` 404s -> assert a redirect to
  `/watch.html?v=<baseId>`; and a 200 -> plays, no redirect.
- Anti-INERT: assert the reroute is REACHABLE from the real item shape each surface renders (not
  a hand-made shape) - the feasibility map's per-surface `type`/`chapters` availability is the
  fixture contract.

## Risks / disclosed limitations (brief the gate)
- **Non-projected audio bounces to /watch** (a brief music-view flash). Inherent to
  "bound-to-library, no server change"; the fallback makes it correct, not dead-ended.
- **Chaptered detection is client-only** via embedded `item.chapters` - present on /api/videos
  surfaces (grid/channel/continue), ABSENT on modern-grid/search/home-row, where a chaptered item
  routes `<id>` -> 404 -> /watch (no in-album). Disclosed; acceptable per no-server-change.
- **Home ROW feed** video-side `kind:'media'` audio can't reroute client-side (no `type`); its
  projected `kind:'track'` items already open in music. Disclosed.
- Not a data/RBAC surface (routing only; every target is an existing RBAC-gated route). Full gate
  anyway for the cross-surface net + the v1.224 fix; brief the adversarial to find a surface that
  reroutes a NON-audio item, or a video item, or ignores the flag, or dead-ends a miss.

## Gate
FULL two-reviewer gate (cross-surface routing net - the access-control-completeness lesson's
sibling: enumerate EVERY tap surface). Dual-Node before release. Device-pending: Dean confirms
his home-feed music taps open in the player and chaptered opens the album.

## Gate fix-round + server-fold (v1.236, both seats + Dean)

Both gate seats reviewed the client-only commit; applied:
- **C1 (QA CRITICAL):** `musicHrefForItem` now gates on `kind` too (`kind && kind !== 'media' -> null`). `type:'audio'` is not unique to downloads - a downloaded PODCAST is `kind:'podcast', type:'audio'` in the modern grid and was being hijacked to /music -> 404 -> bounce. Fixed + bound (podcast/book/tv -> null; media/kind-absent -> music).
- **W1 (QA WARNING):** the /watch bounce regressed the LEGACY continue-listening card path for native music-store ids (which /watch 404s). Introduced a reroute-ORIGIN marker `&ao=1` on `musicHrefForItem`'s href; `playTrackFromContinue(trackId, bounceOnMiss)` bounces ONLY when the marker is present (a bare ?play= continue card keeps the old `render()` on a miss). Comment corrected.
- **M10 (adversarial WARNING):** added the missing "resolvable-but-not-recently-played -> plays, no bounce" behavioral test (the common reroute case; mutation-verified: dropping the success-branch `return` reds it).
- **Server-fold (Dean, reversing decision 4's "no server change"):** the home ROW feed (`resolveHomeItem`) + modern grid (`resolveModernGridItem`) now carry `type` + (for audio) `chapterCount` - additive, read-only. The client `buildFeedCardHtml` reroutes via `musicHrefForItem`, so Dean's PRIMARY case (a chaptered audio download tapped from the home feed on mobile) now opens the music player + its album everywhere, not just the /api/videos surfaces. Still device-flag-gated + library-bound (a miss bounces to /watch). This is a payload ENRICHMENT, NOT the player/API extension Dean declined.

### W2 - deliberately-out-of-scope surfaces (disclosed, not wired)
`queueEntryHref` (common.js, up-next/autoplay), the History list, and the notification-bell rows render audio items but are OUTSIDE the locked scope (home feed / search / channel / continue-watching). `queueEntryHref` already routes `kind:'track'` -> /music and governs a video-context autoplay continuation (rerouting mid-session is undesirable); it lacks per-item `type` anyway. Left as-is by design; recorded here so the code and the spec agree.
