---
plan: chapter-likes
harness: v2 · lean
branch: feat/chapter-likes
anchor: spec
status: Building
next: build per the design below, then commit and hand to the orchestrator for the FULL gate (adversary + qa + security-brief; D12 - the Adversary briefed to orphan, duplicate and leak likes across delete, move, rekey and restore)
design: Approved 2026-09-23 @6ea45237 (Dean's GO on D9-D12, recorded on feat/music-channel-chapters at 10c3be1e)
gate: pending
---

# M3: like a chapter as a song

Wave item M3 of the music wave (umbrella: `2026-09-23-music-channel-chapters-wave.md` on
`feat/music-channel-chapters`, decisions D9-D12). Branched from main 6ea45237 (v1.316.0).

## The ask (Dean's words)

"The ability to Like a given chapter as a 'song'."

A chaptered album is ONE media file whose chapters are queue entries with ids
`<mediaId>::c<n>` (n = the chapter's index in the resolved chapter list;
`expandAudioToTracks` lib/music/libraryAudio.js, `buildListenChapterTracks` public/js/music.js).

## Survey (re-verified at 6ea45237, file:line by reading)

Storage and cleanup:
- `user_liked(user_id INTEGER, media_id TEXT NOT NULL, liked_at TEXT, PK(user_id, media_id))`
  lib/db/sqlite.js:469-474. No FK to media, no length constraint on `media_id`: a longer
  `<id>::c<n>` key needs NO DDL and NO `SCHEMA_VERSION` bump.
- `delLikedByMedia` lib/auth/store.js:72 (`WHERE media_id = ?`, exact) and `rekeyLiked` :77
  (`UPDATE OR REPLACE ... WHERE media_id = ?`, exact), run by `removeMediaState` :610-637 and
  `rekeyMediaState` :638-670. Callers of those: delete lib/media/routes.js:1247, trash purge
  lib/media/trash.js:844, scan prune lib/scan/orchestrator.js:1875, notifications phantom prune
  lib/notifications/routes.js:189, and the ONE rekey seam `rekeyInFlightState` server.js:5445-5465
  (move, trash, restore all pass through it).
- Backup: `exportUsersForBackup` lib/auth/store.js:1550 selects `user_liked` rows generically
  (`{mediaId, likedAt}`); the restore at :1677 re-inserts any string `mediaId`. A `::c` key rides
  the bundle with no code change; PROVEN by test below.

Routes:
- `POST /api/liked/:id` lib/media/user-routes.js:174-185: `restrictedVideoMutation(req,res,id)`
  then own-property `db.metadata[id]` else 404. `DELETE` :191 removes without an existence gate.
- `restrictedVideoMutation` server.js:1234-1239 looks up `db.metadata[id]` DIRECTLY: a `::c` id
  finds no item and returns false (no restriction). The chapter arm must gate on the BASE id.
  The gate returns 404 (no restricted-id oracle, bound by rbac-video-enforcement.test.js:146),
  so the umbrella acceptance line's "403" is recorded here as 404 (the repo's ruling since v1.80).
- `GET /api/liked` :341-437: media arm = `Object.values(db.metadata).filter(likedIds.has(item.id)
  && mediaVisibleTo)`; `others` = podcast/track/book arms; RBAC filter :380-385 sends every
  `kind:'track'` through `trackVisibleTo(req, ownTrack(ns.tracks, o.id))`, which DROPS a chapter
  entry (no native row). The chapter arm needs its own visibility arm.
- Music: `publicTrackListItem(track, userId, likedSet, progressMap)` server.js:4027 reads `liked`
  from the MUSIC-store set for every row, projected rows included; callers lib/music/routes.js:229
  (`/api/music`, also the `filter=liked` arm :209), :423 and :438 (`/api/music/:id`, native then
  projected). `POST /api/music/liked/:id` :305 requires `ownTrack` (native only): every projected
  row 404s.
- `projectedLibraryTracks` server.js:4091-4118 expands each visible audio item via
  `libraryAudio.expandAudioToTracks(item, (it) => resolveItemChapters(it).chapters)`.
  `expandAudioToTracks` :182-212 SKIPS a chapter whose `startTime` is not finite/>=0 but keeps
  the ORIGINAL index in the surviving ids, and degrades to the single base track when fewer than
  two survive: "valid chapter index" therefore means "`<id>::c<n>` is in the real expansion",
  never `n < chapters.length`.
- Other readers of `userStore.getLiked` (all `likedSet.has(<base item id>)`, inert to a `::c`
  row by construction): `/api/videos` list lib/media/routes.js:380, `/api/home` :431,
  `/api/videos/:id` :794, `/api/feed-hidden` lib/user/routes.js:153, `/api/history` :197. The
  `/api/stats` member inventory :1659 filters likes to `has(visibleMetadata, id)`: a chapter like
  would be dropped from the member's own count unless the filter looks at the base id.
- Music-store readers (`getMusicLiked`): `/api/music/liked` :298 (native ids only; no client
  reads it: `grep 'api/music/liked' public/js` finds only the row heart's writes), the shaped
  track arm of `/api/liked` :257. Untouched.

Clients:
- Row heart: `buildSongRowHtml` public/js/music.js:169-200 (`data-like-id=item.id`);
  `toggleLike` :2304-2322 POSTs/DELETEs `/api/music/liked/<id>` and flips WITHOUT `r.ok`.
- Extras "Like": `createExtrasMenu` public/js/skin-surface.js:104, `buildExtrasHtml` :158
  (`item.liked`), `defaultLikeRequest` :266 -> `/api/liked/<item.id>`, `extrasToggleFlag` :270
  (flips only on 2xx; cfg `likeRequest`/`fetchItem` overrides :275/:150). The sticker forwards
  `extrasCfg.fetchItem`/`likeRequest` :741/:749. music.js supplies `getBaseId: extrasBaseId`
  (:1358, strips `::c`) at TWO writers: the sticker cfg :955 and the desktop actions menu :1296.
- Liked page: `/?liked=1` (main.js ~1968, common.js ~3009); count `fetchLikedTotal` common.js:12985
  (`/api/liked?limit=1` -> `total`); a `kind:'track'` card links `/music?play=<id>` and arts from
  `/albumart/<id>` (main.js:632-645; `/albumart/:id` lib/music/routes.js:477-510 already strips
  `::c` for a visible audio base item); the card heart `cardLikeEndpoint` main.js:3236-3242 sends
  EVERY `kind:'track'` to `/api/music/liked/` (a chapter unlike from the grid would strand the
  media row). Source-locked by test/unit/card-like.test.js:100.
- Watch page Like (watch.js) and the grid heart on media cards act on the base file: unchanged.

## Design (D9-D12 as approved)

Id shape: `parseChapterTrackId(id)` in lib/music/libraryAudio.js (ONE writer of the `::c` rule
beside `chapterTrackId`) -> `{ baseId, index }` or null (`/^(.+)::c(\d+)$/`). A chapter like is
accepted, stored, listed and cleaned ONLY through that shape.

Server:
1. `server.js`: `itemChapterTracks(item)` = the one writer of the expansion
   (`expandAudioToTracks` + `resolveItemChapters`); `projectedLibraryTracks` consumes it; it is
   handed to `registerLikedRoutes` with `parseChapterTrackId`.
2. `POST /api/liked/:id` (user-routes.js): parse; gate `restrictedVideoMutation` on the BASE id;
   own-property base item else 404; for a chapter: `item.type === 'audio'` AND
   `itemChapterTracks(item).some(t => t.id === req.params.id)` else 404. The stored key is the
   expansion's own `track.id` (constructed from `item.id` + a validated integer): a NUL or any
   other byte can never reach the table because the request id must EQUAL a constructed id.
   Decision: listen-mode chapters of a VIDEO item are out of scope (the Liked card for a
   `kind:'track'` links `/music?play=<id>` and `/api/music/:id` resolves audio projections only,
   so a video chapter like would produce a dead card); a video `::c` id 404s and the Extras Like
   on a listen-video chapter keeps today's behaviour (likes the whole video).
3. `GET /api/liked`: a chapter arm `shapedLikedChapterItems` expands each `::c` like whose base
   item exists, is audio and is `mediaVisibleTo`, into a track-shaped entry: `kind:'track'`,
   `source:'library-chapter'`, `mediaId`, `id`, `title` = chapter title, `type:'audio'`,
   `duration` = the chapter span, `chapterStartSec`, `artist`, `album` = the file title,
   `hasArt` = the base item's thumbnail, `addedAt`, `liked:true`, progress derived from the FILE
   position relative to the chapter, `watchState` via the one authority. A like whose base is
   gone / no longer chaptered / index gone is DROPPED from the read (the per-kind drop rule);
   the durable cleaner stays `removeMediaState`. The RBAC filter re-gates chapter entries on the
   base item's `mediaVisibleTo` (never `ownTrack`). `total` includes them, so the sidebar count
   does too.
4. `lib/auth/store.js`: `delLikedByMedia` and `rekeyLiked` gain a `::c` prefix arm using SQL
   `substr(media_id, 1, length(?1) + 3) = ?1 || '::c'` (no LIKE wildcards: `_` in a yt-dlp id
   is safe); the rekey rewrites the prefix and keeps the suffix, `OR REPLACE` on collision.
5. `publicTrackListItem(track, userId, likedSets, progressMap)`: `likedSets = { music, media }`
   (built by `musicLikedSets(userId)`); a projected row (`library`/`library-chapter`) reads the
   MEDIA set, a native row the MUSIC set (`trackIsLiked`). `/api/music?filter=liked` uses the
   same predicate.
6. `/api/stats` member inventory: filter chapter likes by their BASE id's visibility
   (`chapterLikeBaseId` dep).

Client:
7. `buildSongRowHtml`: `data-like-store="media"` on projected rows; `toggleLike` routes by it
   (`/api/liked/<id>` for media-store rows, `/api/music/liked/<id>` for native), flips ONLY on
   `r.ok`, toasts "Could not update Like." otherwise.
8. Extras (BOTH writers: sticker cfg and desktop actions menu): `fetchItem` fetches
   `/api/videos/<base>` and, when the current id is a `::c` chapter of that AUDIO item, overlays
   `liked` from `/api/music/<chapterId>` and stamps `likeTargetId` = the chapter id (captured at
   OPEN time, so a chapter roll while the menu is open cannot retarget the tap); `likeRequest`
   posts to `/api/liked/<likeTargetId || item.id>`.
9. `cardLikeEndpoint` (main.js): a `kind:'track'` id carrying `::c` goes to `/api/liked/`.

## Enumerated like surfaces (writer / reader / cleanup) and what this branch does

| Surface | Kind | Action |
|---|---|---|
| `POST /api/liked/:id` | write | chapter arm (base RBAC, existence, expansion membership) |
| `DELETE /api/liked/:id` | write | unchanged (no gate; removing an absent row is the end state) |
| `POST/DELETE /api/music/liked/:id` | write | unchanged (native only); the clients stop sending projected ids to it |
| `GET /api/liked` + `total` | read | chapter arm + its own RBAC arm |
| `/api/videos`, `/api/home`, `/api/videos/:id`, `/api/feed-hidden`, `/api/history` | read | unaffected by construction (`has(baseId)`); `/api/videos/:id` bound by test (base NOT liked) |
| `/api/music`, `/api/music/:id` (`liked` flag), `filter=liked` | read | media set for projected rows |
| `/api/music/liked` | read | unchanged (native ids; no client reader) |
| `/api/stats` member inventory | read | counts a chapter like by its base's visibility |
| `removeMediaState` (delete, purge, scan prune, phantom prune) | cleanup | `id` OR `id::c%` |
| `rekeyMediaState` (move, trash, restore via `rekeyInFlightState`) | cleanup | carries `id::c<n>` -> `new::c<n>` |
| backup export / restore | carrier | generic rows; PROVEN by test |
| row heart (music.js) | client write | media store for projected rows, `r.ok` bound |
| Extras Like (sticker + desktop) | client write/read | chapter target + chapter flag |
| Liked grid heart (main.js) | client write | `::c` track -> media store |
| watch page Like, media card heart | client write | base file, unchanged |

## Acceptance (each names its binding test)

- AC1 like chapter 2 of a 5-chapter audio file -> `user_liked` holds `<id>::c2`; the base file is
  NOT liked (`/api/videos/:id` liked:false; `/api/videos` flag false). (chapter-likes.test.js)
- AC2 `GET /api/liked` lists it as a track-shaped entry (kind, id, title = chapter title,
  duration = span, chapterStartSec, album = file title, hasArt) and `total` counts it; the
  format filter treats it as audio. (chapter-likes.test.js)
- AC3 the music row and `/api/music/:id` show `liked:true` for `::c2` only (not `::c1`, not the
  base) - the flag reads the media store. (chapter-likes.test.js)
- AC4 index out of range (`::c5`), a skipped-invalid index, a chapter of a non-chaptered audio
  file, a chapter of a video item, a malformed suffix -> 404 and NO row. (chapter-likes.test.js)
- AC5 a member restricted with `{kind:'folder'}` (the MEDIA-only kind) -> POST 404 and their
  own pre-existing chapter like is omitted from `GET /api/liked`; the admin's stays.
  (chapter-likes.test.js)
- AC6 delete (trash) the file -> the like follows to `<trashId>::c2` and leaves the listing;
  restore -> it returns; purge -> it is gone. Direct `removeMediaState` deletes `id` and
  `id::c<n>` and leaves `id::x`, `<other>::c1`, `<id>x::c1`. (chapter-likes.test.js,
  chapter-like-carriers.test.js)
- AC7 move -> the like follows to `<newId>::c2`, for TWO users, no orphan under the old id;
  a collision at the destination does not throw. (chapter-likes.test.js, chapter-like-carriers)
- AC8 backup -> wipe -> restore -> the chapter like survives and is listed again.
  (chapter-likes.test.js, backup-restore.test.js)
- AC9 the row heart POSTs `/api/liked/<id>::c1` for a chapter row and `/api/liked/<id>` for a
  plain projected row, `/api/music/liked/<id>` for a native row; flips on 200; a 404 flips
  NOTHING and toasts. (music-chapter-likes-client.test.js)
- AC10 Extras Like on a chapter (sticker AND desktop menu) reads the chapter's flag and POSTs
  `/api/liked/<chapterId>`; on a plain library track it POSTs the base id. (music-chapter-likes-client.test.js)
- AC11 the Liked grid heart sends a `::c` track to `/api/liked/`. (card-like.test.js)
- AC12 the member inventory counts a chapter like on a visible file. (chapter-likes.test.js)

## Build record

### Commit 1 (the build)

Per-file:
- `lib/music/libraryAudio.js`: `parseChapterTrackId` (the inverse of `chapterTrackId`, the ONE
  decoder) + `chapterLikeBaseId`; exported.
- `lib/auth/store.js`: `delLikedByMedia` and `rekeyLiked` gain the `::c` prefix arm
  (substr-based, `length > len+3` so a bare `id::c` is a plain unknown id; numbered params).
- `server.js`: `itemChapterTracks(item)` = the one writer of the music expansion
  (`projectedLibraryTracks` consumes it); `musicLikedSets(userId)` + `trackIsLiked(track, sets)`;
  `publicTrackListItem(track, userId, likedSets, progressMap)` reads the MEDIA set for a
  projected row; deps handed to the liked routes (`itemChapterTracks`, `parseChapterTrackId`),
  both music route groups (`musicLikedSets`, `trackIsLiked`) and the media library routes
  (`chapterLikeBaseId`).
- `lib/media/user-routes.js`: POST chapter arm (base-id RBAC, own-property base, audio only,
  expansion membership, stores the expansion's own id); `shapedLikedChapterItems`; the GET
  merge + the chapter entries' own RBAC arm (mediaVisibleTo on the base); `watchedSet` hoisted.
- `lib/music/routes.js`: the three `publicTrackListItem` callers pass the set pair;
  `filter=liked` uses `trackIsLiked`.
- `lib/media/routes.js`: `/api/stats` member inventory counts a like by its base id.
- `public/js/music.js`: `buildSongRowHtml` stamps `data-like-store="media"` on projected rows;
  `toggleLike` routes by it, flips only on `r.ok`, toasts on failure, re-primes the Liked count;
  `extrasFetchItem` / `extrasLikeRequest` / `extrasChapterIdFor` wired into BOTH Extras cfg
  writers (sticker + desktop actions menu).
- `public/js/main.js`: `cardLikeEndpoint` routes a `::c` track to `/api/liked/`.
- Tests: NEW `test/integration/chapter-likes.test.js` (7, AC1-AC8 + AC12), NEW
  `test/unit/chapter-like-carriers.test.js` (5, the store carriers), NEW
  `test/unit/music-chapter-likes-client.test.js` (8, the row heart + both Extras writers through
  real music.js); extended `music-library-audio.test.js` (+2, the decoder against the real
  expansion), `backup-restore.test.js` (the `vid1::c1` key rides the bundle), `card-like.test.js`
  (the chapter arm precedes the native arm), `music-liked-tab-retired.test.js` (the source lock
  follows the one-fetch shape).

Instrument outputs (verbatim, Node 22.23.1):
- `npm run lint`: `✖ 7 problems (0 errors, 7 warnings)` - all 7 pre-existing `no-unused-vars`
  warnings in `public/js/common.js` (untouched by this branch).
- `npm run lint:css`: `TOTAL 0  (the token census; ceiling ZERO since v1.61.0)`.
- `bash .harness/lib/check-markers.sh`: `✗ docs/exec-plans/active/2026-09-23-chapter-likes.md:
  stale approval @6ea45237 - reviewed code changed since; re-gate` / `check-markers: 1 issue(s)
  found` (the checker's own dash normalized to a hyphen here). Expected while Building: the `design:` line binds Dean's GO to main 6ea45237 and the
  rule flags ANY approval sha the code moved past; the gate re-binds at the reviewed sha (the
  sub-bell-polish plan carried the same flag through its build).
- Targeted suites (never the full `npm test`, per Dean's cadence): new files
  `chapter-likes` 7/7, `chapter-like-carriers` 5/5, `music-chapter-likes-client` 8/8;
  extended `music-library-audio` + `backup-restore` 46/46; the touched-surface census
  (12 unit files: music-library-audio, auth-store, music-sticker-extras, music-actions-desktop,
  music-view, card-like, skin-surface, media-routes-live-seams, route-surface,
  music-liked-tab-retired, listen-video-chapters, music-sticker-menu) `tests 230 pass 229 fail 1`
  before the lock update -> 7/7 on the re-run of the updated file; 17 integration files (liked,
  liked-mixed-kind, rbac-video/music/write-enforcement, rbac-census, move-files,
  media-liked-carriers, backup-restore, music-api, music-library-projection, watch-like-button,
  feed-hidden-api, route-read/write-classification, api, watch-liked-sidebar)
  `tests 173 pass 173 fail 0`.

Disclosed decisions and known limits:
- Listen-mode chapters of a VIDEO item are out of scope: the server accepts chapter likes for
  audio items only (a video chapter has no playable Liked card - `/api/music/:id` resolves audio
  projections only), and the client keeps today's file-level Like for them (bound by test).
- A like keyed by chapter INDEX survives a re-chaptering of the file (chapters editor) under its
  old index: the read arm DROPS an index no longer in the expansion (no ghost) but does not
  delete the row (deleting user likes on an edit would itself be data loss); a re-ordered
  chapter list can re-point index n at a different song - inherent to the `::c<n>` id scheme
  the whole music chapter system uses (progress, queue entries) and not new here.
- The umbrella's "403 for a restricted member" is 404 on this surface (the repo's v1.80 rule:
  no restricted-id oracle; bound by rbac-video-enforcement.test.js:146 and AC5).
