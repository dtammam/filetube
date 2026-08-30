# Music redesign - a Spotify-polished experience for a personal library

**Status:** ACTIVE. Branch `feat/music-home-circles` (Slice 1).
**Author:** main session, 2026-08-30. Dean: "Love love love go go go go go."
**Design spec:** the mockup artifact (4 phone screens, built from Dean's real
library): https://claude.ai/code/artifact/5f67be99-1c3a-4f8c-9bc3-25066db3efeb
Direction LOCKED with Dean: "Jump back in" leads the home; circles = CHANNEL
avatars; mock the whole vision. Spotify's POLISH + navigation, NOT its
recommendation brain (this is a finite personal library).

## The reframe (why this is not "clone Spotify")
FileTube's music is a finite personal library (ripped albums + yt-dlp game-OST
remixes/mixes, projected channels-as-artists). So the job is FAST access to what
you own + a gorgeous now-playing, NOT discovery. We take Spotify's LOOK and
NAVIGATION (circles, shelves, big album headers, immersive player) and drop the
recommendation engine.

## Ships in SLICES (each = its own branch -> gate -> release)
The mockup proposed this order; each slice is independently shippable + device-
testable (Dean iterates between them).

- **Slice 1 (THIS branch, v1.212): Home + artist circles.** The biggest felt
  change. Channel-avatar plumbing + round artist tiles + a "Jump back in"
  recently-played row atop the Music view.
- **Slice 2 (v1.213): Album header + chapters-as-tracklist.** The rough spot
  Dean named. A gradient hero (big cover, Play/Shuffle) + the single-file mixes'
  CHAPTERS surfaced as the tracklist (seek within the one file). Native multi-
  track albums keep their real track rows.
- **Slice 3 (v1.214): Artist page.** The big round avatar hero + "N songs in your
  library" + popular + mixes.
- **Slice 4 (v1.215): Now-playing re-skin.** Full-bleed art + up-next over the
  EXISTING player engine (a re-skin, never a rebuild).

## Constraints (from the audit - non-negotiable)
- **Reuse the player engine.** Background audio, MediaSession, lock-screen,
  handoff, smart-resume - all battle-won in player.js. This arc is a re-skin of
  music.js render helpers + CSS + the now-playing panel markup, NEVER a player
  rewrite. `pl.load(id, data, mount)` / `getState` / `expand` / `dock` /
  `setTrackNav` / `getCurrentMeta` stay the contract.
- **SPA router swaps `#view-root`.** All new listeners/observers bind through the
  view's single AbortController (`signal`) and tear down in `destroy()`.
- **Design-token census = 0.** Every new CSS rule uses the token set
  (--space/--fs/--text/--yt-red/--radius/--shadow...); a geometry/choreography
  exception needs a `token-exempt:` comment. The mockup's warmth (a subtle
  gradient header, the circle treatment) is captured with the app's OWN tokens -
  the mockup's raw hexes/fonts do NOT ship. Aesthetic polish (a gold accent, a
  display face) is a possible follow-up once Dean reacts on-device, NOT assumed.
- **Mobile-first.** One-hand reach; keep the bottom-nav; re-measure on rotate
  (the v1.194 lesson: jsdom green != device-correct geometry - Dean's device
  pass is the arbiter, and each slice ships DEVICE-PENDING).
- **The library-audio projection (v1.210/v1.211).** artist == channel; the
  avatar the circles need EXISTS (`resolveItemChannelAvatarUrl` /
  `db.ytdlp.channelAvatars`) but the projection currently DROPS it - Slice 1
  threads it.

## Slice 1 - tasks (v1.212)

**T1 - avatar plumbing (server + lib).** Thread a channel avatar per artist so
circles have a real picture; native-album artists (no channel) fall back.
- `server.js` `projectedLibraryTracks`: set `track.avatarUrl =
  ytdlp.resolveItemChannelAvatarUrl(db, item) || ''` on each projected track
  (the resolver already exists; read-only).
- `lib/music/query.js` `groupArtists`: emit `avatarUrl` per artist = the first
  non-empty `track.avatarUrl` among the artist's tracks (deterministic:
  art-carrying/lowest-id tiebreak like the existing `artId`), else `''`.
- `server.js` GET `/api/music/artists`: the payload already maps groupArtists
  output; `avatarUrl` rides along. Native tracks carry no avatar -> `''`.
- Tests: groupArtists emits the avatar for a channel artist, '' for a native-
  only artist; the projected track carries a resolved avatarUrl (unit + a small
  integration bind on /api/music/artists).

**T2 - artist circles (client + CSS).** `public/js/music.js` `buildArtistCardHtml`:
if `avatarUrl` -> a ROUND avatar tile (`<img>` + a monogram fallback on error);
else the existing 2x2 album-art mosaic; else a monogram. New CSS
`.music-artist-avatar` (round, token-clean) beside the existing
`.music-artist-mosaic`. Bind the render shape (the exported helper is jsdom-
testable).

**T3 - "Jump back in" row (client + CSS).** A horizontal recently-played row at
the TOP of the Music view (above the tabs), rendered from the existing
`filter=recent-listening` fetch, hidden when empty. Tiles tap to resume (the
existing `playTrackFromContinue` deep-link path). RBAC: recent-listening is
already per-user + visibility-gated server-side. Bind: the row renders from
seeded recent items + is absent when none.

**T4 - README/docs + release.** No new capability to document beyond the visual;
ROADMAP + ledger note the redesign's first slice.

## Attack surfaces (for the gate)
1. **RBAC:** an artist/circle appears only when the user has >=1 VISIBLE track by
   them (groupArtists runs on the already-RBAC-filtered list) - confirm the
   avatar addition changes nothing here; the avatar URL is a public channel
   picture, not restricted media. The "Jump back in" row must be per-user
   visibility-gated (reuse the existing recent-listening gating; do not widen).
2. **Avatar fallback:** a broken/absent avatar URL must degrade to the mosaic/
   monogram, never a broken image; an artist with a channel but no resolvable
   avatar renders the fallback.
3. **Determinism:** the artist's chosen avatar must be stable across re-scans
   (same tiebreak discipline as `artId`, or a re-scan flips the picture).
4. **SPA teardown:** the new row's listeners/observers bind via `signal` and die
   on `destroy()` (no leak across nav).
5. **Token census:** 0 - no raw literals in the new CSS.

## Predicted numbers (machine-derived, re-verified each commit)
- Baseline unit (`npm run test:unit`, Node 22.23.1, 2026-08-30): **5921 pass,
  0 fail**. Full `npm test` re-run at release.

## Known gaps / deferrals (disclosed)
- Slices 2-4 (album header/chapters, artist page, now-playing) are separate
  releases - Slice 1 ships the home + circles alone, device-pending.
- The mockup's full aesthetic (gold accent, display face) is NOT assumed; ship
  the STRUCTURE on the app's tokens, let Dean react on-device, refine as polish.
- chapters-as-tracklist (Slice 2) needs a per-chapter seek contract in the
  player - designed then, not now.

## Device probe (Dean, per slice)
Slice 1: the Artists tab shows round channel avatars (Nestalgia, Koopa Keys...)
where a channel avatar exists, the album mosaic otherwise; a "Jump back in" row
sits at the top with what you were last playing, and tapping it resumes.
