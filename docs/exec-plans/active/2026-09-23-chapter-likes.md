---
plan: chapter-likes
harness: v2 · lean
branch: feat/chapter-likes
anchor: spec
status: Building
next: built and mutant-tested (two commits); hand to the orchestrator for the FULL gate (adversary + qa + security-brief; D12 - the Adversary briefed to orphan, duplicate and leak likes across delete, move, rekey and restore; see the build record's disclosed limits for the re-chaptering index case and the video-chapter scope)
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
  READS it: `grep 'api/music/liked' public/js` finds only WRITES, the music row heart and, at
  main, the Liked grid's `cardLikeEndpoint` track arm), the shaped track arm of `/api/liked`
  :257. Untouched.

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
| client READERS of `GET /api/liked`: watch.js Prev/Next (~:2170/:2185), player.js autoplay (~:4925), common.js browse ctx (~:2209) | client read | filter to `kind:'media'`; a chapter entry is skipped like existing track entries (gate r1 qa S5, verified inert) |

Follow-up (gate r1 qa S4): `/api/home` (lib/media/routes.js:431 + :587) reads `likedSet.has(item.id)`
(base) and `getMusicLiked` (native), so a liked chapter never surfaces in the home feed's
candidates - inert by construction; a home row for chapter likes would be a new feature, not a gap
in this branch.

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

### Commit 2 (the mutant round and the one driver it falsified)

Mutants ran in a `git archive` sandbox of commit 1 (fe88f067), one mutation at a time, each
against the test files that claim to bind it, the file restored between runs. FIRST RUN VOID:
the sandbox's `node_modules` symlink pointed at the worktree (which has none; resolution walks
up to the main checkout), so every integration/client file died at load (`Cannot find module
'express'` / `'jsdom'`, reported as `tests 1 fail 1`) - a false "kill" for 14 of 17 mutants.
Re-pointed the symlink, re-established the baseline in the sandbox (`tests 15 pass 15 fail 0`
for chapter-likes + music-chapter-likes-client), re-ran. Results (verbatim counts):

| Mutant | Mutation | Result |
|---|---|---|
| M1 | POST accepts ANY parsed chapter id (expansion membership removed) | KILLED 7/6/1 (AC4) |
| M2 | POST audio gate removed (a VIDEO chapter accepted) | KILLED 7/6/1 (AC4) |
| M3 | POST RBAC gate on the raw `::c` id, not the base | KILLED 7/6/1 (AC5) |
| M4 | `delLikedByMedia` exact-id only | KILLED 12/8/4 (AC6 + 3 carrier units) |
| M5 | `rekeyLiked` exact-id only | KILLED 12/7/5 (AC6, AC7 + 3 carrier units) |
| M6 | `trackIsLiked` reads the MUSIC set for every row | KILLED 7/5/2 (AC1/AC3, AC7) |
| M7 | GET chapter arm: shaping gate AND filter arm removed | KILLED 7/6/1 (AC5) |
| M7b | GET chapter arm: filter arm only (shaping gate kept) - TWO different mutants (gate r1 qa W1 corrected this row) | REPLACING the arm with `return true` is GREEN 7/7/0 (RBAC is held by the shaping gate); DELETING the arm is RED 7/2/5 (AC2, AC5/AC12, AC6, AC7, AC8): the entry falls through to `trackVisibleTo(req, ownTrack(...))` = false and every chapter entry vanishes from /api/liked and total. The filter arm is load-bearing for ROUTING past the ownTrack fallthrough; the shaping gate is load-bearing for RBAC. |
| M8 | row heart `r.ok` check removed | KILLED 8/7/1 |
| M9 | `data-like-store` never stamped | KILLED 8/5/3 |
| M10 | Extras chapter overlay removed | KILLED 8/5/3 |
| M11 | DESKTOP Extras writer drops the two hooks | KILLED 8/6/2 |
| M11b | STICKER Extras writer drops the two hooks | KILLED 8/7/1 |
| M12 | Extras target read at TAP time (open-time capture removed) | SURVIVED 8/8/0 on commit 1, then KILLED 8/7/1 with the corrected driver (below) |
| M13 | Liked grid `::c` track arm removed | KILLED 7/6/1 (card-like) |
| M14 | `/api/stats` member filter on the raw id | KILLED 7/6/1 (AC12) |
| M15 | decoder accepts a bare `::c` (index 0) | KILLED 28/27/1 |
| M16 | store prefix arm without the length guard | KILLED 5/4/1 |

M12's survivor was a VACUOUS DRIVER (the presence-not-binding class): the test poked
`player.currentId` to chapter 0, but `effectiveCurrentId()` prefers the VIEW's chapter pointer
(`chapterViewId`) for a `::c` of the same file, so the tap never saw a roll and both the fix
and the mutant answered c1. Corrected in commit 2: the test drives a REAL roll (the media
element's `currentTime` crossing back into chapter 0 + `timeupdate`, consumed by
`reflectChapter` -> `currentChapterId` over a queue that now carries the chapter siblings) and
PROVES the roll reached the view by re-opening the menu and seeing it fetch chapter 0's flag.
M12 was re-run against commit 1's CODE with the corrected driver copied into the sandbox
(the code under mutation stayed committed): `M12 KILLED: tests 8 pass 7 fail 1`; M10/M11
re-confirmed KILLED (8/5/3, 8/6/2) with the same driver.

Disclosed decisions and known limits:
- Listen-mode chapters of a VIDEO item are out of scope: the server accepts chapter likes for
  audio items only (a video chapter has no playable Liked card - `/api/music/:id` resolves audio
  projections only), and the client keeps today's file-level Like for them (bound by test).
- A like keyed by chapter INDEX survives a re-chaptering of the file (chapters editor) under its
  old index: the read arm DROPS an index no longer in the expansion (no ghost, never a 500 -
  bound by the W1 test in chapter-likes.test.js) but does not delete the row (deleting user
  likes on an edit would itself be data loss); a re-ordered chapter list can re-point index n
  at a different song - inherent to the `::c<n>` id scheme the whole music chapter system uses
  (progress, queue entries) and not new here. Gate r1 adversary W3 measured the FULL consequence
  and it is disclosed as **tech-debt #235**: after a re-chapter that strands `::c4`, a member's
  `/api/stats` inventory.liked stays 1 while `/api/liked` total is 0 (the two readers disagree -
  stats counts by base visibility, the listing by expansion membership), the sidebar Liked entry
  HIDES (`fetchLikedTotal` gates on total > 0), and the stranded row is reachable by no UI - only
  a hand-built `DELETE /api/liked/<id>::c4` removes it (a restoring edit revives it instead); a
  reorder re-points `::c1` from one song to another in the Liked list. Not data loss (the row
  persists), a storage-kind stranding. Candidate fixes (tracker): count `/api/stats` through
  the same expansion membership, or sweep stale-index rows in the chapters editor's own
  post-commit seam.
- The umbrella's "403 for a restricted member" is 404 on this surface (the repo's v1.80 rule:
  no restricted-id oracle; bound by rbac-video-enforcement.test.js:146 and AC5).

## Gate r1 - security-brief (@3f6ce330)

Tool gaps (verbatim, before anything else): this seat has no Bash, so no `git diff 6ea45237`
was run - the review read the touched regions from source, located by the plan's per-file list
and the `M3` comment markers; hunks outside those regions were not enumerated, and a
package.json / lockfile delta against base was NOT diffed (the plan lists neither; that is a
reasoned "no dependency change", not a verified one). Midway the Grep backend died
(`ENOENT: no such file or directory, posix_spawn 'rg'`, twice); the remaining lookups were done
by Read. No test was executed by this seat.

No exploitable weakness found. What was checked, with the exact path traced:

1. Authorization on POST /api/liked/:id (lib/media/user-routes.js:187-206) - VERIFIED.
   `parseChapterTrackId` runs first; `restrictedVideoMutation(req, res, baseId)` (server.js:1234)
   gates the BASE id, so the raw `::c` id no longer falls through its `db.metadata[id]` miss.
   Restricted base -> 404 `{ error: 'Media file not found' }` (server.js:1237); unknown base ->
   404 with the byte-identical body (user-routes.js:196); visible base with a bad/absent chapter
   or a non-audio base -> the same body (:201). No status/body oracle across the visibility
   boundary. Timing: the chapter expansion (`itemChapterTracks`, incl. description parsing) runs
   ONLY after the base passed the visibility gate, so its cost is never observable to a user who
   cannot see the base (should-be-safe by reasoning; not timed).
2. Read-side leaks - VERIFIED. GET /api/liked shaping arm gates `mediaVisibleTo(req, item)`
   before any title/art/duration is shaped (user-routes.js:373) AND the filter arm re-gates by
   `o.mediaId` (:461-463; `mediaVisibleTo(req, null)` is false); `total` (:485) is computed
   after both. /api/stats member inventory (lib/media/routes.js:1660) filters by
   `has(visibleMetadata, chapterLikeBaseId(id))` - own-property against the RBAC-filtered map,
   the user's OWN rows only, count-only. /api/music?filter=liked (lib/music/routes.js:212-213)
   filters a list already RBAC-filtered at :199-200; /api/music/:id projected arm resolves inside
   `projectedLibraryTracks`, which gates `mediaVisibleTo` at server.js:4133 before expansion.
   Backup bundle: GET /api/admin/backup is `requireAdmin`-gated (lib/admin/backup.js:527) and
   carried every user's like rows before this branch; the `::c` key rides as an opaque string.
   Pre-existing, admin-trusted.
3. Input hygiene - VERIFIED. Both statements (lib/auth/store.js:80, :87) bind numbered
   parameters; `||` concatenates a BOUND value with a literal, no id is interpolated into SQL
   text. `parseChapterTrackId` (lib/music/libraryAudio.js:183-188): `$` without the `m` flag is
   end-of-string in JS; `.` excludes `\n`, so a newline id decodes as null and takes the plain
   path (unknown id -> 404); `x::c1::c1` decodes greedily to base `x::c1` -> no such item -> 404;
   `x::c00001` decodes to index 1 but the stored key requires `t.id === req.params.id` against
   the CONSTRUCTED `x::c1`, so a non-canonical spelling 404s and can never be persisted;
   backtracking is bounded (only positions starting `::c` scan digits; total O(n)), and the URL
   length is capped by Node's header limit - no ReDoS. The stored key is `track.id` from
   `chapterTrackId(item.id, i)` (libraryAudio.js:218; user-routes.js:202), never
   `req.params.id`, so a NUL or any foreign byte cannot reach `user_liked` through this route.
4. Prefix arm boundaries - VERIFIED by reading the SQL. `substr(media_id, 1, length(?1)+3) =
   ?1 || '::c'` with `length(media_id) > length(?1)+3`: base `abc` vs row `abcd::c1` compares
   `abcd::` to `abc::c` (no match); a bare `abc::c` fails the length guard; row `abc::c1`
   matches; the rekey keeps the suffix via `substr(media_id, length(?2)+1)`. Cross-item sweep
   would need a base id that itself contains `::c`; media ids are md5 hex (`getMediaId`,
   server.js:1469-1471) and trash ids are md5 of the trash path (lib/media/trashRecords.js:6),
   so `::` cannot occur in a base id today.
5. Client - VERIFIED. `buildSongRowHtml` (public/js/music.js:169-206) passes every data-derived
   string through `escapeMusicHtml` / `encodeURIComponent`; `data-like-store="media"` is a
   constant literal (:176). The toast text is a constant and `showToast` uses `textContent`
   (public/js/common.js:13289). `extrasLikeRequest` / `extrasFetchItem` / `cardLikeEndpoint`
   URL-encode the id (music.js:1395, :1401, :1416; main.js:3237-3242).
6. No secrets, cookies, session, TLS/network-boundary or dependency changes in any region read.

Advisory (INFO, no action required):
- I1 The prefix arm's correctness is an ASSUMPTION about the id charset (item 4). If a future id
  source ever mints ids containing `::c`, `removeMediaState('x')` would also sweep the chapter
  likes of an item `x::c...`. Worth a one-line note beside the statements; not exploitable.
- I2 POST /api/admin/restore re-inserts any string `mediaId` from the bundle (pre-existing);
  an admin-crafted bundle is the one path by which a non-canonical `::c` key or NUL could enter
  `user_liked`. Admin-trusted by design; the read arm drops what the expansion does not mint.

Gate: APPROVED r1 @3f6ce330 — security-brief

## Gate r1 - qa (@3f6ce330)

Reviewed `git diff main...HEAD` (16 files) at 3f6ce330 in the branch worktree; Node v22.23.1;
all suites and mutants ran in a `git archive HEAD` sandbox (`/tmp/qa-m3-v8Ax`) with
`node_modules` symlinked from the main checkout; the sandbox was diffed back to HEAD (0 lines
in all four mutated files) after the round. Never the full `npm test` (Dean's cadence).

Instruments (verbatim):
- `npm run lint`: `✖ 7 problems (0 errors, 7 warnings)` - the 7 pre-existing `no-unused-vars`
  in `public/js/common.js` (untouched).
- `npm run lint:css`: `TOTAL 0  (the token census; ceiling ZERO since v1.61.0)`.
- `bash .harness/lib/check-markers.sh`: `✗ docs/exec-plans/active/2026-09-23-chapter-likes.md:
  stale approval @6ea45237 - reviewed code changed since; re-gate` / `check-markers: 1 issue(s)
  found` (the `design:` line; the tolerated Building-phase shape, re-binds at the gate sha).
- Unit group (chapter-like-carriers, music-chapter-likes-client, music-library-audio, card-like,
  music-liked-tab-retired, auth-store, music-chapter-playback, music-sticker-extras,
  music-actions-desktop, skin-surface): `# tests 184 / # pass 184 / # fail 0`.
- Integration group (chapter-likes, backup-restore, rbac-video-enforcement, liked,
  liked-mixed-kind, music-api, rbac-music-enforcement, rbac-write-enforcement,
  watch-like-button, watch-liked-sidebar, media-liked-carriers, move-files,
  music-library-projection, feed-hidden-api, rbac-census, route-read-classification,
  route-write-classification): `# tests 154 / # pass 154 / # fail 0`.
- Mutants re-run (one at a time, replacement asserted non-empty, file restored):
  M4 `tests 12 pass 8 fail 4` KILLED; M5 `tests 12 pass 7 fail 5` KILLED; M6 `tests 7 pass 5
  fail 2` KILLED; M9 `tests 8 pass 5 fail 3` KILLED; M12 `tests 8 pass 7 fail 1` KILLED (the
  open-time capture test is the one red - the corrected driver binds); **M7b `tests 7 pass 2
  fail 5` KILLED** (AC2, AC5/AC12, AC6, AC7, AC8 red) - see finding 1.
- SQL probe (node:sqlite, the two statements verbatim): base `abc` vs `abcd::c1` -> `abcd`,
  `abcd::c1`, `abc::c`, `abc::x` survive a delete of `abc`; rekey `abc->zzz` carries `abc::c1`
  to `zzz::c1` for both users and leaves `abcd::c1`; rekey `old->new` with `new`, `new::c1`
  already present collapses to one row each (OR REPLACE on the (user_id, media_id) PK, no
  throw); NUL-bearing, unicode and empty bases are inert. Note: the arm matches
  `<id>::c<anything>` (it also deleted `abc::cx`), broader than the `::c<digits>` decoder -
  harmless since only constructed ids reach the table, and the comment says "PREFIX".

Correctness, verified against the code:
- `publicTrackListItem(track, userId, likedSets, progressMap)`: the ONLY callers are
  lib/music/routes.js:233, :428, :443 and all three pass `musicLikedSets(...)` (grep across
  lib/, server.js, public/, test/). `itemChapterTracks` is the one `expandAudioToTracks` caller
  outside its module (server.js:4116). `removeMediaState`/`rekeyMediaState` callers are
  unchanged and route through the two rewritten statements.
- The Liked grid renders a `kind:'track'` entry via main.js:632-645 (`/music?play=<id>`,
  `/albumart/<id>`, `/track/<id>?download=1`); `playTrackFromContinue` resolves a `::c` id via
  `GET /api/music/:id` (the projection arm) -> `playTrackInAlbum` (pre-existing chapter path);
  `/albumart/:id` strips `::c` (lib/music/routes.js:500-510). `sortItems` reads
  `addedAt/title/size` (lib/videoQuery.js:82), `filterByFormat` reads `type`, the watch filter
  reads `watchState` - the shaped entry carries all of them (AC2 binds title/span/album/art).
- The mixed `/api/liked` client readers not in the surface table all filter to `kind:'media'`
  (watch.js:2170/2185 Prev/Next, player.js:4925 autoplay), so a chapter entry is skipped there
  like the existing track entries.
- Comments: every new comment matches the code it describes; "NUL cannot reach the table by
  construction" holds (stored key = `track.id` from `chapterTrackId(item.id, i)`, AC4 drives
  NUL-bearing ids to 404 + empty table); the 404-not-403 citation
  rbac-video-enforcement.test.js:146 is exactly `post('/api/liked/blocked') -> 404`.
- Standards: `user_liked.media_id TEXT NOT NULL` (lib/db/sqlite.js:469-474), no length/FK
  constraint; docs/RELEASING.md rule 1 bumps `SCHEMA_VERSION` for a NEW/RENAMED persisted
  namespace - a longer key in an existing column is neither, so no DDL / no bump is correct.
  0 em dashes in the diff's added lines. No innerHTML with data (`data-like-store="media"` is a
  constant literal; ids go through `escapeMusicHtml`). No CSS touched.
- Tests: the client file's settle loops are fixed counts over synchronously-resolving stubs (no
  timed wait can pass green); chapter-likes runs the real server with an admin and a member
  under a `{kind:'folder'}` restriction (the media-only kind); backup round trip is a real
  `/api/admin/backup` -> reset -> `/api/admin/restore` and lists the `::c` entry again.

Security surface (standing section): LOW, covered. POST gates RBAC on the BASE id via
`restrictedVideoMutation` (404, no oracle; AC5 + builder M3) and stores only a constructed id;
GET re-gates on `mediaVisibleTo` twice (shaping + filter; M7b shows the filter arm is
load-bearing, not redundant); `/api/stats` counts by base visibility (AC5: 0 for the
restricted member); the backup bundle is `requireAdmin` (lib/admin/backup.js:527); the SQL is
parameterized with numbered params, no string assembly; no new route, no unauthenticated
surface, no secrets/logging, no shell.

Findings:

1. **WARNING** (plan doc accuracy, `docs/exec-plans/active/2026-09-23-chapter-likes.md` mutant
   table row M7b, and the "belt and suspenders" characterization): the record says the filter
   arm's removal is GREEN 7/7/0 because "the shaping gate alone holds". Reproduced: KILLED
   `tests 7 pass 2 fail 5`. Mechanism: without the `library-chapter` arm the entry falls to
   `if (o.kind === 'track') return trackVisibleTo(req, ownTrack(...))`; `ownTrack` of a `::c` id
   is null and `trackVisibleTo(req, null)` is `false` (server.js:1147), so EVERY chapter entry
   is dropped from the listing and the count. Scenario: a later refactor deletes the arm as
   "redundant" on the strength of this record -> every chapter like silently vanishes from
   `/?liked=1` and the sidebar count while the rows persist. The code is correct and the arm is
   bound by five tests; the RECORD is wrong. Fix: rewrite the M7b row to `KILLED 7/2/5 - the
   filter arm is load-bearing (the ownTrack arm eats an unrouted chapter entry)`. Safe to ship
   once corrected; this is a one-line doc fix, so the verdict is CHANGES for r2 delta only.
2. SUGGESTION (plan survey, lines 68-69): "no client reads it: grep 'api/music/liked' public/js
   finds only the row heart's writes" - at main, `main.js:3239` (`cardLikeEndpoint`) also writes
   there (the plan's own line 83 documents it). Reword to "no client READS it".
3. SUGGESTION (lib/auth/store.js:78 comment): the substr-not-LIKE justification cites "`_` ... a
   legal yt-dlp id character"; media ids are md5 hex (`getMediaId`, server.js:1469) and trash
   ids md5 of the trash path, so no `_` can occur today. The choice is still right (ids are
   opaque; never LIKE on an id) - say that instead of the yt-dlp claim.
4. SUGGESTION (`/api/home`, lib/media/routes.js:431 + :587): the home feed's liked signal reads
   `likedSet.has(item.id)` (base) and `getMusicLiked` (native) - a liked chapter never surfaces
   in home's candidates. Inert by construction (as the table says); note it as a follow-up if
   home is expected to reflect chapter likes.
5. SUGGESTION (surface table): add the client READERS of `GET /api/liked` (watch.js Prev/Next,
   player.js autoplay, common.js browse ctx) - all verified inert to a chapter entry.

Tree proof: `git status --short` shows only `M docs/exec-plans/active/2026-09-23-chapter-likes.md`
(this section and the security-brief's); no untracked files; HEAD 3f6ce330.

Gate: CHANGES r1 @3f6ce330 — qa (see findings)

## Gate r1 - adversary (@3f6ce330)

Reviewed `git rev-parse HEAD` = 3f6ce330 in the worktree `.claude/worktrees/agent-a73e66f851b541859`
(branch feat/chapter-likes, base main 6ea45237). Every measurement ran in a `git archive HEAD`
sandbox (`/tmp/adv-m3-54mE`, `node_modules` symlinked from the main checkout; sandbox baseline
re-established FIRST: chapter-likes + chapter-like-carriers + music-chapter-likes-client +
music-library-audio + card-like `tests 48 pass 48 fail 0`, Node 22.23.1). Every mutant was applied to
the committed tree, its `diff` vs HEAD shown non-empty before crediting, the file restored from
`git show HEAD:<file>` and `cmp`-proven identical after each run.

### Instruments (verbatim)

- Touched-surface census in the sandbox (19 files: liked, liked-mixed-kind, rbac-census,
  rbac-video/music-enforcement, media-liked-carriers, backup-restore, music-api,
  music-library-projection, move-files, watch-liked-sidebar, route-read/write-classification,
  auth-store, music-sticker-extras, music-actions-desktop, skin-surface, music-liked-tab-retired,
  listen-video-chapters): `tests 270 pass 270 fail 0 cancelled 0 skipped 0`.
- `npx eslint` over the 11 files the diff touches: no output (0 problems).
- Two attack drivers of my own (9 + 1 tests through the REAL app, since deleted from the sandbox):
  `tests 9 pass 9`, `tests 1 pass 1` - their measured dumps are the evidence quoted below.

### Destruction drives (measured, all HELD)

1. ORPHAN, every path to `removeMediaState`: (a) scan prune of a vanished file
   (`fs.unlink` + `scanDirectories()`, pruneMissing) - admin `[]`, member keeps only the sibling
   file like; (b) the NON-trash delete arm (file unlinked BEFORE `DELETE /api/videos/:id` ->
   `if (!trashed)` legacy cleanup at lib/media/routes.js:1247) - rows `[]`; (c) notifications
   phantom prune (`GET /api/notifications` with the item's metadata record dropped) - rows `[]`;
   (d) trash -> restore -> purge and (e) HTTP move (the SAME `moveItemToFolder` ->
   `rekeyInFlightState` seam lib/media/move.js:723 that lib/ytdlp/relocation.js:82 uses) are bound
   by AC6/AC7 and re-driven below. No `::c` row survived its base on any path.
2. LEAK across users: B likes `mix::c1`; A holds a pre-existing `mix::c1` and is restricted by
   `{kind:'folder'}` AND (second pass) `{kind:'path'}`. For A on BOTH kinds: `/api/liked` items
   `[]` total 0; `/api/stats` inventory.liked 0; `/api/music?filter=liked` `[]`; the mix rows absent
   from `/api/music`; `GET /api/music/<c1>` 404; `POST /api/liked/<c3>` 404 (no oracle); B's row
   and B's listing untouched. KIND binding: a mutant that gates the chapter arm (shaping AND filter)
   through `trackVisibleTo` on the base item's descriptor instead of `mediaVisibleTo` ->
   chapter-likes `7 pass 6 fail 1` (AC5 red): the `{kind:'folder'}` fixture DOES discriminate the
   media gate from the track gate (lib/auth/visibility.js:66-68).
3. DUPLICATE / COLLISION: HTTP move of `mix` to `Other/` with a stale `<newId>::c2` already
   present for the admin (liked_at 2020) AND for another user: admin ends with exactly one
   `<newId>::c2` (the MOVED row wins; the stale duplicate's liked_at is dropped - acceptable: the
   base-id carrier has had the same OR REPLACE posture since v1.43, and the destination row can only
   pre-exist through a re-key that ran ahead of us), the other user's row untouched, listing shows
   one entry "Third Song"; move back to `Chan/` -> both users hold exactly `[mix::c2]`. Backup taken
   BEFORE a purge, restored AFTER: the like AND the base metadata come back together (the bundle is
   one transaction), `/api/liked` lists it; the file is gone on disk so the next scan prunes the
   base and sheds the resurrected row - consistent with the base-id carrier.
4. ID HYGIENE (all 404, no row): `::c01`, `::c99999`, `::c1::c1`, `::c+1`, `::c1 ` (trailing
   space), `::C1`, a fullwidth digit, `<zero-chapter audio>::c0`, plus AC4's own table (NUL before
   and after the suffix, bare `::c`, video chapter, skipped-invalid index). Accepted and listed:
   a unicode base `ünï-cödé_x::c2`, the last index `::c4`.
5. Backup access: a member's `GET /api/admin/backup` -> 403 (other users' chapter likes ride
   only the admin bundle). No route was added by the diff (`grep app\.(get|post|...)` on the diff:
   none) - no new unauthenticated surface.
6. Read-arm shaping: progress 150s/300s on the file -> `::c0` watched 100%, `::c2` watching 50%,
   `::c4` new 0%; `watch=new|watching|watched` each list exactly that one; a file latch marks all
   three `watched` and `watch=new` lists none. Decision: acceptable ("one file, one latch" - a
   finished album's songs are finished); disclosed here, no change asked.

### Mutants (verbatim counts; the builder's table re-derived, not trusted)

Builder's: M1 7/6/1, M2 7/6/1, M3 7/6/1, M4 12/8/4, M5 12/7/5, M6 7/5/2, M7 7/6/1, M7b (filter arm
only) 7/7/0 as claimed, M8 8/7/1, M10 8/5/3, M12 (tap-time target, against the corrected driver)
8/7/1, M13 7/6/1, M14 7/6/1, M15 28/27/1, M16 12/11/1 - all KILLED as claimed. Mine, KILLED:
S7 `delLikedByMedia` via `LIKE ?1 || '::c%'` (the `_` wildcard eats `aXb::c1`) 12/11/1; S8 drop
`OR REPLACE` on the rekey 12/11/1; S9 rekey drops the `::c` suffix (`SET media_id = ?1`) 12/7/5;
S19 chapter arm removed from `others` 7/2/5; KIND (above) 7/6/1; C4 Extras chapter-id without the
audio gate 8/6/2; C5 row-heart lane always media 8/7/1; C6 `data-like-store` on chapter rows only
8/7/1; C7 overlay inverted 8/5/3; C8 toast dropped 8/7/1.

SURVIVED (each is a finding or a suspicion below): S13b, C10, C9, S14, S15.

### Findings

1. **WARNING** (presence-not-binding; lib/media/user-routes.js:375, the chapter arm's
   `if (!track) continue;`). Deleting that guard keeps chapter-likes `7 pass 7 fail 0`; with it
   deleted, my driver (like `mix::c4`, then `POST /api/videos/:id/chapters` with a 3-line manual
   list) makes `GET /api/liked` answer **500** for that user - the whole Liked page. The plan's
   disclosed rule "the read arm DROPS an index no longer in the expansion (no ghost)" therefore has
   NO binding test; HEAD's behaviour is correct (measured: items `[]`, total 0, row still present),
   but nothing holds it. Prescription: an AC test that likes `::c4`, re-chapters to 3 through the
   real editor route, and asserts 200 + `[]` + total 0 + the row still in `getLiked` (both halves of
   the disclosure: dropped from the read, NOT deleted from storage).
2. **WARNING** (comment-porous source lock, AC11; test/unit/card-like.test.js). The grid heart's
   `::c` arm (public/js/main.js:3242) is bound only by `mainSrc.includes(<the line>)`; commenting the
   line out (`// if (kind === 'track' && ...`) keeps card-like `7 pass 7 fail 0` (C10) - the class
   memory calls comment-porous (v1.50/v1.77/v1.133). No behavioural driver of a chapter UNLIKE from
   the Liked grid exists anywhere under test/ (`grep -rl cardLikeEndpoint test` = that lock only),
   so the very strand-the-row bug this arm fixes has no repro. Prescription: strip comments before
   the lock (the existing pattern) AND drive the grid heart on a `kind:'track'` `::c` card in jsdom
   asserting `DELETE /api/liked/<id>::c2` (never `/api/music/liked/`).
3. **WARNING, safe to ship DISCLOSED** (index-keyed likes after a re-chapter; the brief's item 4).
   Measured with a member: like `::c4` -> stats.inventory.liked 1 / `/api/liked` total 1; after the
   editor writes 3 chapters: stats.inventory.liked **1** while `/api/liked` total **0**, the home
   sidebar's Liked entry HIDES (`fetchLikedTotal` gates on total > 0), and the row is reachable by
   no UI - only a hand-built `DELETE /api/liked/<id>::c4` removes it (measured 200). A reorder
   re-points `::c1` from "Second Song" to "Opening" in the Liked list (measured). Not data LOSS
   (the row persists; a later edit restoring the index revives it) but a storage-kind stranding the
   plan's disclosure covers only half of: it names the re-point, not the stats/total disagreement
   nor "no UI can remove it". Ask: extend the disclosed-limits entry with both facts and open a
   tracker issue (candidate fix later: count `/api/stats` through the same expansion membership, or
   sweep stale-index rows in the chapters editor's own post-commit seam). Not blocking on its own.
4. **SUGGESTION** (unbound failure arm; public/js/music.js extrasFetchItem). The comment "a failed
   overlay reads as not liked: the tap is then an idempotent ADD, never a silent unlike" has no
   test: mutant C9 (`item.liked = track ? track.liked === true : true`, i.e. a failed overlay reads
   as LIKED so the tap DELETEs) survives `8 pass 8 fail 0`. Drive: answer `GET /api/music/<c1>` with
   404 and assert the row shows "Like" and the tap is a POST.
5. **SUGGESTION / suspicion, closed** (unreachable): the shaping arm's `item.type !== 'audio'` gate
   is unbound (S14 survives 7/7) because POST never stores a video chapter; only a type flip of an
   existing base on rescan could reach it. And a media id that itself ends in `::c<digits>` would be
   unlikeable as a whole (`ab::c1` -> 404 since the parser strips it) and `removeMediaState('ab')`
   would eat `ab::c1::c0` - unreachable because `getMediaId` is md5 hex (server.js:1469). No action;
   recorded so the next reader does not re-derive it. S15 (shaping visibility gate dropped, filter
   arm kept) survives by design - the belt-and-suspenders pair the builder's M7b documents.

### Tree proof

Sandbox files restored and `cmp`-identical to `git show HEAD:` after every mutant (user-routes,
store, server.js, media/routes, libraryAudio, main.js, music.js each printed "restored"); my two
driver files and the S13 repro deleted from the sandbox. Worktree `git status --short` before this
append: only `M docs/exec-plans/active/2026-09-23-chapter-likes.md` (the qa and security-brief
sections); no untracked files; HEAD 3f6ce330. This section is my only write.

Gate: CHANGES r1 @3f6ce330 — adversary (see findings)
