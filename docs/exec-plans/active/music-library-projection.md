# Wave G - Virtual projection of library audio into the Music library

**Status:** ACTIVE (design). Branch `feat/music-library-projection`.
**Author:** main session, 2026-08-29. Intake with Dean CONFIRMED (below).
**Gate:** FULL two-reviewer gate (touches RBAC + a new db namespace + the
music query/player). Not slim.

## 1. The ask (Dean)

Dean downloads MP3s from YouTube (yt-dlp) that land in the media library
(`db.metadata`, `type:'audio'`) and show in the feed like any other download.
Many of them are *really music* - e.g. the **NESTALGIA** channel (game-music
remixes), Phantasia Records, RETROSCAPE FM. He wants those to ALSO appear in the
**Music** library so he gets the music-player experience (artist browse,
mini-player, up-next) - WITHOUT duplicating data (a live virtual projection, not
a copy into `db.music`), and while they STILL live in the feed as normal
downloads.

## 2. Framing - what the REAL data forced (this reversed the design)

We inspected the live instance
(`GET /api/videos?format=audio&sort=newest&limit=100`, which spreads each raw
item incl. `tags`). The finding **falsified the album-tag plan**:

- **There are NO album tags.** yt-dlp's embed writes only
  `tags: { title, artist, date, genre, description, comment }`. No `album`, no
  `track`, no `disc`. An "only surface audio with an album tag" gate would match
  ZERO files.
- **`tags.artist` IS the channel, 100% of the sample** (Tonzak, NESTALGIA,
  Koopa Keys, Phantasia Records, PSK Beats, Dance Dance North, RETROSCAPE FM).
  So "group by channel" == "sort by artist" - they are the same operation.
- **The only clean music/not-music line is the CHANNEL.** Sitting side by side:
  NESTALGIA (genre `Gaming`, music) vs Zarchivo/Opie & Anthony (genre `Comedy`,
  talk). `genre` almost works - `Comedy` cleanly flags not-music - but FAILS on
  the headline case: NESTALGIA and Koopa Keys are game-music channels YouTube
  tags `Gaming`. No per-file tag separates music from talk; only the channel
  does.

**Conclusion / confirmed design:** a **per-channel "music" flag**. The channel
is the unit Dean thinks in, it's the only reliable signal, and since
artist==channel it yields exactly the artist-sorted view. Default **seeded from
genre** (`genre === 'Music'` -> on; else off), with a per-channel override so
Dean flips on the `Gaming`-tagged music channels (NESTALGIA) and leaves comedy
off.

Dean's two confirmations:
1. Default seeded by genre (Music auto-on; Gaming/Comedy/etc off, one tap to
   include). NOT fully manual.
2. **No album sub-shelves** - there is no album data. Each music channel shows
   as ONE artist with its mixes as the songs; "next song" = the next mix by that
   channel. Album cover-art shelves are out (accepted). Chapters-as-tracklist is
   a possible later follow-up, not this wave.

## 3. Eligibility predicate (the heart of the wave)

For each `db.metadata` item with `type === 'audio'`:

```
channelKey = item.folderName                     // the app's channel-grouping unit
override   = db.music.channels[channelKey]       // 'on' | 'off' | undefined
eligible   = override === 'on'  ? true
           : override === 'off' ? false
           : (item.tags && item.tags.genre === 'Music')   // genre-seeded default
```

**Why `folderName`, not `channelId`:** the app already groups a "channel" as its
folder (the `?folder=<folderName>` view; `server.js:10652`
`item.folderName === folderFilter`), and the per-channel toggle lives on that
folder page - so keying the mark by `folderName` keeps toggle <-> mark <-> item
joined on ONE field, and works for non-yt-dlp audio too (which has no
`channelId`). `channelId` is more stable across a folder rename but misaligns
with the folder-based UI; deferred (tech-debt) - a folder rename re-keys the
mark, an accepted v1 limitation.

`eligible && mediaVisibleTo(req, item)` -> project into Music. Per-ITEM genre
default (not per-channel aggregation) handles mixed-genre channels for free.

Worked expectation against the sample:
- Tonzak, Phantasia, PSK, Dance Dance North, bbb., RETROSCAPE FM (genre Music,
  unset) -> **auto-in**.
- Zarchivo [Opie & Anthony] (genre Comedy, unset) -> **out**.
- NESTALGIA, Koopa Keys (genre Gaming, unset) -> out by default; Dean sets
  `musicChannels[<NESTALGIA channelId>]='on'` -> **in**.

## 4. Data model - `db.music.channels` (feature-OWNED sub-namespace)

`db.music.channels = { [folderName]: 'on' | 'off' }`. Global marks (per-item
RBAC still gates visibility). Tri-state: an absent key means "genre default".

**Chosen a music-OWNED sub-namespace, NOT a top-level `db.musicChannels`** -
this is the "feature-owned namespace avoids the persist-gate class" lesson (#1).
Because `BACKUP_NAMESPACE_KEYS` (`server.js:9437`) already lists the whole
`'music'` container, `db.music.channels` **rides the backup export AND restore
for free** - no edit to that list, so the "restore erases an unregistered
namespace" scar (v1.198 `db.tv`) is structurally avoided. Registration sites
(Task T1) - a `doc_single` (SINGLETON) namespace `music.channels` (same
singleton shape + folderName keying as `folderDisplayNames`):
- `lib/db/sqlite.js` `SINGLETON_NAMES` (+ `KNOWN_SUBKEYS` derives from it so
  `save()` does NOT throw on the new sub-key; the unknown-subkey guard is
  `sqlite.js:1027`).
- `server.js` `loadDatabase()` (~530): backfill `db.music = db.music||{}`,
  `db.music.channels = db.music.channels||{}` (there is NO music container
  backfill loop today - only books/ytdlp - so add one).
- Backup: rides `'music'` automatically - but T1 STILL adds a backup round-trip
  test that PROVES a mark survives export -> restore (never assume; bind it).

## 5. Projection - the merge points + track shape

**Merge points** (concat behind the predicate, then let the existing pipeline
group/sort): `server.js` GET `/api/music` (~8271), `/api/music/albums` (~8307),
`/api/music/artists` (~8324). Native tracks keep `trackVisibleTo`; projected
items filtered by `mediaVisibleTo` - TWO passes, never one.

**Projected track shape** (reuse `musicTags.buildTrackMetadata({ tags, filePath,
rootFolder })` - the SAME resolver the music scan uses, zero re-probe):
- `id` (= item.id), `title` (tags.title || item.title),
  `artist` (buildTrackMetadata -> tags.artist || channel),
  `albumArtist` (= artist), `album` `''` (-> `albumKeyFor` groups one untitled
  album per artist), `durationSec` (= item.duration), `addedAt`, `trackNo`/
  `discNo` absent, `year` (from tags.date if numeric),
  `hasEmbeddedArt` (= item.hasThumbnail),
  `source: 'library'` discriminator,
  per-item routes: `streamSrc: '/video/' + id` (CONFIRMED - `/video/:id`
  serves audio bytes Range-able as `audio/mpeg`, `server.js:17551`; `/audio/:id`
  is the video-sidecar route and 404s audio items, do NOT use it),
  `artUrl: '/thumbnail/' + id` (`server.js:17197`),
  `progressEndpoint: '/api/progress'` (`server.js:11301`, unifies resume with
  the feed side).
- **Dedup:** skip a projected item whose `id` already exists among native
  `db.music` tracks (both ids derive from `getMediaId(filePath)`, so a file in
  both a media root and a music root collides - prefer the native track).

## 6. Client - the one hard change

`public/js/music.js` `loadTrack` (~909) builds `data` with HARDCODED
`streamSrc:'/track/'+id`, `artUrl:'/albumart/'+id`,
`progressEndpoint:'/api/music/progress'`, then `pl.load(id, data, mount)`. The
player (`player.js`) already reads `data.streamSrc/artUrl/progressEndpoint`
generically (podcasts.js sets per-item overrides via the SAME `pl.load`
contract - the precedent). Change: `loadTrack` PREFERS item-provided
`streamSrc/artUrl/progressEndpoint` (+ `resumeMode`) when the track carries
`source:'library'`, else the music defaults. A
projected library track thus streams from the media audio route, arts from
`/thumbnail`, and **saves progress to the media store** (`/api/progress`) - so a
half-played NESTALGIA mix shows the SAME progress in Music and in the feed
(unified watch-state, a bonus).

Grid art: `groupAlbums`/`groupArtists` emit `artId` -> client builds
`/albumart/<artId>`. Projected tracks have no `/albumart`; resolve their grid art
to the library thumbnail (either a `source`-aware art URL in the grouped output,
or `/albumart/:id` falls back to the media thumbnail). Decide in Task 4.

## 7. The master toggle - OPT-IN, default OFF (Dean, confirmed)

The ENTIRE feature is optional and opt-in. Per-user `musicIncludesLibrary` in
`MIRRORED_SETTING_KEYS` (`server.js` ~6053), **default `'off'`**. Off (the
default for everyone) -> ZERO projection: the Music library is exactly what it
is today, no library audio conflated in - the clean state a user who just wants
a pure music library keeps. On (Dean enables it on his instance) -> the
genre-seeded per-channel projection applies. `'off'` -> zero concat in all three
handlers + search; this is also the fully-inert state the gate binds.

Documented in the README as an optional capability (Task T8). If an instance
later wants it on by default, that is a one-line change to
`NEW_USER_DEFAULT_SETTINGS` - not this wave.

## 8. The per-channel override surface (UI)

A "Show in Music library" toggle on the **`?folder=<folderName>` view header**,
shown only when that folder has >=1 audio item, gated on
`cardCornerCaps.canModifyLibrary === true` (the library-write capability).
Attaches beside the existing folder-rename pencil
(`public/js/main.js:2000-2029`, `insertAdjacentElement('afterend', ...)` - the
exact sibling precedent). Writes via a NEW narrow route
**`POST /api/folders/music-flag`** `{ folderName, music: 'on'|'off'|null }`
(parallel to `POST /api/folders/display-name`, `server.js:6599`) ->
`db.music.channels[folderName]` (null deletes the key = back to genre default).
Same write-RBAC as display-name. A dedicated Settings "Channels in Music"
manager is a LATER convenience (tech-debt), not this wave.

## 9. RBAC (the leak surface the adversarial seat gets)

- Projected items go through **`mediaVisibleTo`** (kind `media`), NEVER
  `trackVisibleTo` (kind `track`) - distinct restriction kinds. A merged list
  needs two filter passes.
- Every Music READ surface that lists tracks must apply the projection with the
  right gate: `/api/music`, `/albums`, `/artists`, AND search
  (`lib/search/registry.js` searchMusic) if the projection is to appear in
  universal search. Enumerate ALL of them (the access-control completeness net).
- The per-channel write route needs a write-RBAC check (who may mark a channel).

## 10. Attack surfaces (brief for the adversarial seat)

1. **RBAC bypass:** a projected item leaking a title/track to a user restricted
   from that media folder (wrong gate, or a merge pass that skips the gate).
2. **Persist-gate / backup:** `db.musicChannels` erased on restore, or
   `undefined` on a fresh/upgraded db (crash or default-flip). Mutate the backup
   bundle - does a round-trip preserve the marks?
3. **Predicate mutation:** flip each arm of the eligibility ternary - does a test
   catch `override==='off'` still projecting, or the genre default inverting?
   Bind BOTH the on and off axes behaviourally (the presence-not-binding scar).
4. **Dedup:** a file in both roots - does it double-list, or does the native
   track win?
5. **Player routes:** does a projected track actually stream/art/save-progress
   via its OWN routes, or fall through to `/track/:id` (404) - is the
   `loadTrack` override bound, and does mutating it back to hardcoded go red?
6. **Inert-feature:** is the projection REACHABLE in production - a test driving
   the REAL `db.metadata` audio shape end-to-end through `/api/music`, not just
   the isolated predicate (the v1.184 dead-code scar).
7. **Master toggle:** `musicIncludesLibrary:'off'` -> prove ZERO projection on
   all three endpoints + search.

## 11. Task breakdown (small, independently-testable commits)

- **T1 - db.musicChannels namespace + backup:** defaults/init, backup export,
  restore merge, scan carry-forward. Tests: round-trip through the backup
  bundle; fresh-db default `{}`.
- **T2 - eligibility predicate (pure lib):** `lib/music/libraryAudio.js`
  `isChannelMusic(item, marks)` + `projectAudioItem(item)` -> track shape (reuse
  buildTrackMetadata). Unit tests: all three ternary arms, genre default, the
  worked sample rows (Tonzak in, Zarchivo out, NESTALGIA in-when-marked).
- **T3 - server merge:** the three `/api/music*` handlers concat projected
  (mediaVisibleTo) behind master toggle + predicate; dedup by id. Integration
  tests: RBAC (restricted user sees none), dedup, reachability end-to-end.
- **T4 - client loadTrack override + grid art:** per-item routes; projected
  track plays from the media route; grid art -> thumbnail. jsdom/player tests.
- **T5 - per-channel toggle UI + write route:** channel-page toggle, write RBAC,
  mark persists. Tests: write gate, persist, reflect.
- **T6 - master toggle in Settings:** mirrored key `musicIncludesLibrary`
  **default `'off'`** + Settings reflect + the fully-inert test (off -> zero
  projection on all three endpoints + search). Land this EARLY-ish so every
  later merge is guarded by it.
- **T7 - universal-search projection: DEFERRED (disclosed).** Library audio is
  ALREADY searchable in universal search via the `audio` provider
  (lib/search/registry.js searchMetadata for type 'audio'). Also projecting it
  into the `music` provider would surface the SAME item twice (an "Audio" result
  AND a "Music" result) - a worse experience, not a better one. So search is left
  as-is; a downloaded MP3 is found as Audio and plays. (If we later want the
  music-player affordance FROM search for eligible items, the right fix is to
  RE-KIND the audio result when eligible, not to add a duplicate - a follow-up.)
- **T8 - README:** DONE - documented the optional, default-off "downloaded music
  channels in the Music library" capability under Features > Listen & read.

Each commit: green pre-commit unit hook, MEASURED counts in the message.

## 12. Predicted numbers (machine-derived - re-verified each commit)

- Baseline unit suite BEFORE (`npm run test:unit`, Node 22.23.1, measured
  2026-08-29): **5900 pass, 0 fail**. (Full `npm test` incl. integration re-run
  at release.)
- New test files: T1..T6 each add >=1 file. Predicted net new tests: ~TBD after
  T2 (state as a prediction the runner re-checks).
- `npm run lint`, `npm run lint:css` (design-token census ceiling 0),
  `npm run ledger:check` all green at release.

## 13. Known gaps / tech-debt (ship DISCLOSED)

- No album sub-shelves (no album data) - each channel = one untitled album.
  Accepted by Dean.
- Per-channel override is a channel-page toggle; no bulk "Channels in Music"
  manager (tech-debt).
- `tags.date` is often the UPLOAD year (mostly `2026`), not a music year -
  `year` may be noisy; do not sort on it.
- Chapters-as-in-player-tracklist for single-file mixes: deferred follow-up.
- Universal-search projection: DEFERRED (library audio is already searchable via
  the audio provider; a music-provider projection would duplicate the result).
- The per-folder mark is keyed by folderName, so a folder RENAME re-keys the mark
  (accepted v1 limitation; channelId-keying is the follow-up).

## 14. Device probe list (Dean, after release)

- Music library shows NESTALGIA (once marked) + the genre=Music channels as
  artists; their mixes play in the music mini-player with correct art + resume.
- The SAME files still appear in the feed/downloads unchanged.
- Opie & Anthony (comedy) does NOT appear in Music.
- Toggling a channel off removes it from Music; the master off-switch clears all
  library audio from Music.
- Progress on a mix is shared between Music and the feed.
