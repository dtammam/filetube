# Shows — a first-class TV media type (v1.19x candidate)

Status: DRAFT for Dean's sign-off (2026-08-26). No implementation begins
until Dean approves this plan. Big wave → this doc is the reviewers' spec
and survives context compaction.

## Intent (Dean, 2026-08-26, verbatim core)

> I want to start thinking through a new folder type of `Shows` where one can
> have collections of shows that are easy to navigate with a card. Almost like a
> hybrid view of the Podcast and Music view. But really I want to have it as a
> new library source with its own icon (first class media type experience). It
> should assert a given structure for media for easy display kind of like how it
> does on Plex. My personal structure is like this:
> `/Volumes/content-storage/Media/Videos/TV Shows/House MD/Season 2`, or
> `Shows folder\Show name\Season\Episodes`. We should also use a top-level image
> in the Show folder for displaying the icon.
> Additionally my filenames look like so: `House MD S02E22 - Forever.mp4`.

### Decisions locked at intake (Dean: agree ×6, 2026-08-26)

1. **Phasing.** Bug-fix wave (rotation + handoff text) ships first; Shows is its
   own exec-planned big wave. (This doc.)
2. **Structure handling.** Best-effort parse, never hard-reject. Files that don't
   match `SxxEyy` land in a per-show "Specials / unsorted" bucket; a show folder
   with no top-level image gets a generated poster from the first episode's frame.
3. **v1 scope.** Per-episode resume + mark-watched + a "next episode" button + a
   Continue-Watching row on the Shows home. DEFERRED to a follow-up: autoplay of
   the next episode, cross-device sync polish.
4. **Art in v1.** Show-level poster only (from the folder image); episodes get
   FFmpeg thumbnails like the main video library; seasons reuse the show poster
   unless a season image exists.
5. **Internal naming = `tv`.** "shows" is already taken internally (podcast
   grouping `showDirName`/`resolveShowDir`, yt-dlp shows, RBAC `idx.shows`). The
   namespace is `tv` under the hood (`lib/tv`, `db.tv`, `/api/tv`, `data-view="tv"`);
   the UI reads **"Shows" / "TV Shows"**.
6. **Metadata source.** Filename + folder parsing only for v1. No online metadata
   fetch, no `.nfo` sniffing yet — the structure is clean enough not to need it.

## Constraints (contract)

- **Feature-OWNED namespace** — the persist-gate/5-strike discipline. ONLY
  `lib/tv/store.js` writes `db.tv`; its GET routes use a non-mutating `readTv`.
  Register the namespace in `lib/db/sqlite.js` in the SAME commit as the store
  (the `assertNoUnknownKeys` save-guard refuses an unregistered key). This is
  exactly what kept music/books/podcasts clear of the merge bug.
- **Reuse the video streaming + transcode MECHANISM** for episode playback —
  episodes ARE video files (incl. browser-incompatible containers like AVI, and
  browser-native containers carrying incompatible codecs like HEVC/AC3). Reuse
  `sendRangeable`, the shared `TRANSCODE_DIR` cache (eviction/age-sweep, which the
  `tv-<id>.mp4` renditions participate in), and the codec-aware `needsTranscode`.
  **AS-BUILT DEVIATION (v1.195, gate-reconciled):** the episode serve runs a
  small TV-OWNED single-flight transcode queue (`tvTranscodeQueue`/`tvRenditionPath`)
  rather than the main video queue — deliberately, because the video queue records
  readiness in `db.metadata[id].transcodeStatus`, and a TV episode id under the
  video-metadata namespace would violate the feature-owned-namespace discipline
  this wave exists to protect. Readiness is by rendition FILE EXISTENCE alone (no
  db write on the hot path), so the two queues share the cache but not the
  namespace. Only the browse/organization layer + this thin serve glue are new.
- **Route order:** static-segment routes before `/:id` params (the Express scar).
- **Migrations are APPEND-ONLY** — a new `SCHEMA_VERSION` block for the
  `user_tv_*` tables; never edit an executed block.
- **Design tokens only** — every new `.tv-*`/`.show-*` rule consumes tokens
  (census ceiling is ZERO). 2:3 poster aspect mirrors `.book-cover-link`.
- **Access-control completeness** — every mutating AND every read/list/aggregation
  route gated; `kind:'tv'` added to visibility; the backup bundle includes
  `db.tv`. RBAC census + route-write-classification must stay green.

## The folder contract (asserted best-effort, Plex-shaped)

```
<Shows root>/<Show name>/<Season folder>/<episode file>
```

- **Show name** = the immediate folder under a configured Shows root. Show
  identity = a stable hash of the show folder's path (survives re-scan; mount-loss
  guarded like music).
- **Season folder** = `parseSeasonFolder(name)`:
  - `/^season\s*0*(\d+)$/i` → that number (`Season 2`, `Season 02`, `season2` → 2).
  - `/^specials$/i` or `Season 0` → 0 (the Specials bucket).
  - anything else → `null` → the show's **"Extras / unsorted"** bucket.
  - a show with NO season subfolders (episodes directly in the show folder) →
    one implicit season (number `null`, labelled "Episodes").
- **Episode file** = a video extension (reuse the video-library extension set).
  `parseEpisodeFilename(name)`:
  - season/episode from `/S(\d{1,3})[\s._-]*E(\d{1,3})/i` (`S02E22`, `s2e22`,
    `S02.E22`). The folder's season number wins when both disagree, but the
    filename's episode number is authoritative for ordering.
  - **title** = text after the first ` - ` following the `SxxEyy` token, else the
    filename with the show-name prefix and `SxxEyy` token stripped, else the bare
    basename. (`House MD S02E22 - Forever.mp4` → season 2, ep 22, title "Forever".)
  - a file with no `SxxEyy` → the show's "Extras / unsorted" bucket, ordered by
    name; still fully playable.
- **Poster** = first of `poster|folder|cover|show` × `.jpg|.jpeg|.png|.webp` at
  the SHOW-folder root (mirrors the podcast `resolveShowDir` cover probe). Absent →
  a generated FFmpeg thumbnail from the first episode (Dean's decision 4).

Shows and seasons are **derived by grouping the persisted episode rows** (the way
albums group tracks) — not separately persisted — which keeps the namespace small
and feature-owned. Only episodes are rows in `tv.episodes`.

## Data model — `db.tv` (feature-owned)

- `tv.folders` (SINGLETON) — configured Shows roots `[]`.
- `tv.settings` (SINGLETON) — feature settings `{}`.
- `tv.episodes` (DOC_KV, one row per episode) —
  `{ id, path, size, mtime, showId, showName, seasonNum, episodeNum, title,
     durationSec, codec, container, thumb, addedAt }`.
  `id` = md5 of the file path (media/music convention → re-key applies on
  path change).
- New per-user tables (fresh `SCHEMA_VERSION` block):
  `user_tv_progress` (resume position + watched-through), `user_tv_played`
  (mark-watched), `user_tv_liked` (optional). Accessors + a `removeTvState`
  delete carrier in `lib/auth/store.js`. Continue-Watching derives from
  `user_tv_progress`.

## Server (mirrors music's pure-core + impure-wiring split)

- `lib/tv/store.js` — `ensureTv(db)` / `readTv(db)` / `selectPrunableEpisodeIds`
  (mount-loss + errored-subtree guards). HARD INVARIANT header comment.
- `lib/tv/parse.js` — PURE: `parseEpisodeFilename`, `parseSeasonFolder`,
  `groupShows(episodes)` (→ show cards: id, name, poster ref, season count,
  episode count, latest addedAt), `groupSeasons(showId, episodes)` (→ ordered
  seasons → ordered episodes). Node-testable, no fs/db.
- `lib/tv/scan.js` — PURE fs reads only (ffprobe injected as `deps.probe`):
  `walkShowsRoot`, `findShowPoster`, `collectEpisodes(previous, deps)`
  (reuse-by path+size, `setImmediate` yield), `selectThumbJobs`.
- `server.js` wiring:
  - `probeTvEpisode` (injected ffprobe), `extractTvThumb` (ffmpeg first-frame →
    a tv-thumb dir, atomic tmp+rename), `runTvScan` (the ONE `updateDatabase`
    mutator; prune + per-user state prune + thumb/poster GC), `scanTv`
    (coalescing guard — the `scanBooks`/`scanMusic` discipline), boot trigger.
  - Routes (static-before-`:id`): `GET/POST /api/tv/config`, `POST /api/tv/scan`,
    `GET /api/tv/scan-status`, `GET /api/tv` (shows grid), `GET /api/tv/continue`
    (continue-watching), `GET /api/tv/:showId` (seasons+episodes), progress
    ping + `/api/tv/progress/:id`, `/api/tv/played`, `/api/tv/liked`,
    `GET /tvposter/:showId` (poster, escaped-SVG fallback, `Cache-Control: private`),
    `GET /tvepisode/:id` (range stream via `sendRangeable`, `?download=1`
    attachment, transcode-503 branch reusing the EXISTING video transcode queue).
    `ownEpisode` OWN-property guard on every route (prototype-pollution defense).
  - `POST /api/tv/config` overlap: reject a Shows root overlapping media/book/
    music/podcast roots; add the reciprocal clause in EACH of those 4 config
    routes (the 5-way net). Machine-check: `grep -c isPathUnder` in each config
    route must rise by one.
- `lib/auth/visibility.js` — `kind:'tv'` handling; `tvVisibleTo` helper near the
  media/music siblings; `db.tv` added to the backup bundle + `CONTAINER_KEYS`.

## Client (a shell + a registered view, sharing common.js/player.js)

- `public/tv.html` — shell, `<div id="view-root" data-view="tv">`, bottom-nav
  inline SVG item `data-nav="tv"`; served at `/tv` and `/tv.html`;
  `FOUC_SHELL_FILES` + shell-map entries.
- `public/js/tv.js` — `registerView('tv', { init, destroy })`; node-testable pure
  builders: `buildShowCardHtml` (2:3 poster + title + "N seasons · M episodes"),
  `buildSeasonSection`, `buildEpisodeRowHtml` (thumb, `S02E22`, title, duration,
  resume bar, watched check). Layout = **poster grid at top level** (Music-like) →
  drill into a show = **hero poster + season sections, each a podcast-style episode
  list** (the hybrid) → episode opens playback. **Continue-Watching row** pinned
  above the grid. `module.exports` for tests.
- `public/js/common.js` — `VIEW_SCRIPT_SRC.tv`, path→view resolver (both copies),
  `injectTvNavLinkIfEnabled` + `shouldInjectTvNav` (probes `/api/tv/config`),
  `MD_ICON_PATHS.tv` (a TV/monitor glyph), `BOTTOM_NAV_OPTIONAL` +
  `BOTTOM_NAV_DEFAULT_HIDDEN`, sidebar injection.
- **Playback** reuses `player.js` + the watch surface. "Next episode" = the next
  by (seasonNum, episodeNum) within the show; button in the player chrome.
  (Autoplay-next is deferred — decision 3.)
- `public/setup.html` + `public/js/setup.js` — a `tv-folders` builder box mirroring
  the music-folders box (`#tv-folders-builder-list`, add/save/scan, `data-md-group="Library"`).
- `public/css/style.css` — `.show-card` (2:3 poster, mirrors `.book-cover-link`),
  `.tv-season`, `.tv-episode-row`, `.tv-continue-row`; tokens only; the
  `art-shimmer` reveal contract.

## Test plan (machine-verified at every commit)

Mirror the music/podcast/book suites, one focused file per layer:
- `tv-parse.test.js` — the `SxxEyy` + season-folder + title parser, exhaustively
  (incl. `House MD S02E22 - Forever.mp4`, `Specials`, `Season 02`, no-`SxxEyy`
  fallback, folder-vs-filename season disagreement, ordering).
- `tv-store.test.js`, `tv-scan.test.js` (probe injected), `tv-api.test.js`
  (route-order + ownEpisode + config overlap 5-way), `tv-user-store.test.js`,
  `rbac-tv-enforcement.test.js` (every mutating + read/list route + backup bundle),
  `tv-view.test.js` (pure card builders + reveal/clear both axes), `tv-nav.test.js`
  (content-gated injection).
- Reachability (the v1.184 inert-code lesson): the view tests drive the REAL
  server response shape, asserting the browse/episode-list branches are REACHABLE,
  not just that isolated helpers work.

## Numbers (machine-derived, re-verified each commit — predictions)

- New `lib/tv/*` modules: **4** (`store.js`, `parse.js`, `scan.js`, + optional
  `index.js` if routes are module-registered rather than inlined).
- `lib/db/sqlite.js` edits: `DOC_KV_NAMESPACES` +1 (`tv.episodes`),
  `SINGLETON_NAMES` +2 (`tv.folders`,`tv.settings`), `CONTAINER_KEYS` +1,
  `SCHEMA_VERSION` +1 with one new migration block.
- Config-overlap reciprocal clauses added to the existing config routes: **4**
  (media, book, music, podcast) — verify each gains one `isPathUnder` net.
- New client files: **2** (`public/tv.html`, `public/js/tv.js`).
- New test files: **8** (listed above). Suite delta re-counted at each commit.

## Phasing (small, independently-green task commits)

1. **Namespace + pure core.** `sqlite.js` namespace lock + `SCHEMA_VERSION`/
   `user_tv_*` migration + `lib/tv/store.js` + `lib/tv/parse.js` + `tv-parse`/
   `tv-store` tests. (No routes yet — the namespace and parser land first.)
2. **Scan pipeline.** `lib/tv/scan.js` + server `probeTvEpisode`/`extractTvThumb`/
   `runTvScan`/`scanTv` + poster/thumb discovery + `tv-scan` tests.
3. **API + RBAC.** All `/api/tv` routes + `/tvposter`/`/tvepisode` + `ownEpisode`
   + config 5-way overlap + `visibility.js` `kind:'tv'` + backup bundle +
   `tv-api`/`tv-user-store`/`rbac-tv-enforcement` tests.
4. **Client browse.** `public/tv.html` shell + `public/js/tv.js` (grid → show
   detail → episode list) + nav icon/injection + `style.css` + `tv-view`/`tv-nav`
   tests.
5. **Playback + Continue-Watching.** Watch-surface reuse, "next episode",
   Continue-Watching row + progress wiring.
6. **Setup UI.** `tv-folders` builder in setup + wiring.
7. **Home-row integration + polish + release ceremony.**

This is a genuinely large feature — it may span more than one tagged release.
Each phase is a merge-worthy increment behind the two-reviewer gate; the nav icon
only appears once a Shows folder is configured, so partial phases are shippable
without exposing an unfinished surface.

## Gate brief (FULL — a new persisted namespace + a new stream/download surface)

- Adversarial: attack the namespace isolation (can a media/music/podcast scan
  clobber `db.tv`, or vice versa?), the path parser (traversal via crafted
  filenames, `SxxEyy` ReDoS, NUL-truncation), `ownEpisode` prototype pollution,
  the config-overlap net (a Shows root nested under a media root and the reverse),
  RBAC on every read/list/aggregation + the backup bundle, and the `/tvepisode`
  range/transcode branch. Demand runnable repros.
- QA: route order, persist-gate coverage for every new episode field, migration
  append-only, comment accuracy, token census, reachability of the browse branches.

## Open questions for Dean (non-blocking — defaults chosen)

- **O1.** Show ordering on the grid — alphabetical, or most-recently-added first?
  Default: **alphabetical**, with the Continue-Watching row carrying recency.
- **O2.** "Watched" auto-mark threshold — mark an episode watched at what % ?
  Default: **90%** (the common convention), tunable later.
- **O3.** Should a show with a single flat season show season headers at all?
  Default: **hide the "Episodes" header** when there's exactly one implicit season.

## Ceremony

Standard: `npm version` → ROADMAP "Shipped" → `docs/releases.json` ledger row (pure
user language: "TV Shows are now a first-class library — browse by poster, pick a
season, resume where you left off") → move this plan to `completed/` when its Stop
closes → `release/vX.Y.Z` → `merge --no-ff` → tag → push → branch hygiene → Dean's
device probe list.
