'use strict';

// lib/media/routes.js - the media library's BROWSE and per-item HTTP surface:
// the /api/videos group (the paginated list contract, the item detail, and the
// item mutations - delete, move, view ping, dimensions backfill, chapters,
// manual channel attribution single + bulk + cancel, the audio pre-warm), the
// /api/home feed, /api/search, /api/channels, /api/stats, /api/library-items,
// /api/duplicates(.csv), /api/handoff, /api/attribution-targets,
// /api/subtitles, /api/transcript and the /api/critters manager.
// Moved VERBATIM out of server.js in Wave 7b, slice S10a, of the
// relational-migration arc (docs/exec-plans/active/
// 2026-09-13-sqlite-relational-migration.md): the bodies are byte-identical to
// the server.js originals and keep their source order, with their free
// identifiers resolving from the `deps` bundle server.js hands in at each call
// site - the lib/ytdlp + lib/podcasts registerRoutes pattern. A missing dep is
// a hard failure (a destructured undefined that is later called throws), never
// a silent fallback.
//
// SEVEN registration functions, not one. These groups are not contiguous in
// server.js - the progress and Liked routers (lib/media/user-routes.js), the
// trash routes, /api/storage-summary (lib/config/routes.js since slice S10b),
// the byte-stream routes (/thumbnail, /storyboard, /preview, /video - still in
// server.js) and /audio (lib/music/routes.js since slice S3) are registered
// between them - so
// each register call sits exactly where its own block's first route was and
// the routing order is unchanged, UNSORTED
// (scripts/route-order-signature.js is the instrument):
//   registerBrowseRoutes       - GET /api/search, GET /api/videos, GET /api/home,
//                                GET /api/channels, GET /api/videos/:id
//   registerHandoffAndDeleteRoutes
//                              - GET /api/handoff, DELETE /api/videos/:id
//                                (lib/media/user-routes.js's progress routes
//                                register between these and the five above)
//   registerMoveRoute          - POST /api/videos/:id/move (registered after the
//                                trash routes and the move/trash helpers)
//   registerLibraryItemsRoute  - GET /api/library-items
//   registerCritterListingRoute- GET /api/critters
//   registerLibraryRoutes      - the four critters MANAGEMENT routes,
//                                /api/stats, /api/duplicates(.csv), the
//                                view/dimensions/chapters/attribution item
//                                routes, /api/subtitles, /api/transcript
//   registerPrepareAudioRoute  - POST /api/videos/:id/prepare-audio (registered
//                                after GET /audio/:id's site, now lib/music/routes.js)
//
// Calls 4-6 (library-items, critter listing, the library routes) were ONE contiguous run of routes in server.js and could have
// been one call, but a call site's deps object is evaluated EAGERLY: hoisted
// function declarations are reachable from anywhere, `const`/`let` are not.
// `crittersDir`, CRITTER_IMAGE_EXTS/CRITTER_SOUND_EXTS and the three
// CRITTER_UPLOAD_* tables are declared between these routes, so a single call
// at GET /api/library-items' line would have thrown
// "Cannot access 'CRITTER_IMAGE_EXTS' before initialization" at require time -
// it did, on the first cut. Each call therefore sits at the first line where
// everything it is handed exists; the route ORDER is identical either way
// (nothing else registers a route between them).
//
// What moved WITH the routes - an espree reference census over server.js
// (scope-aware, eslint-scope) shows the moved routes are each one's only
// referrer: the attribution cluster (attributionFeatureOff,
// sanitizeAttributionTarget, applyManualAttribution, proposeAttributionMove,
// confineBulkRoot and the bulk single-flight latch), and, from the critters
// manager, listCritterFiles + the two upload size caps. What did NOT, and why:
//   - `crittersDir` resolves `path.join(__dirname, 'public', 'critters')`, so
//     it is server.js's __dirname or nothing - it crosses as a dep;
//   - every critters helper server.js EXPORTS (buildCritterListing,
//     buildCritterVoicePool, sanitizeCritterUploadName, buildStoreZip) and the
//     constants two of them read (CRITTER_IMAGE_EXTS, CRITTER_SOUND_EXTS,
//     CRITTER_UPLOAD_*_TYPES, CRITTER_UPLOAD_EXT_FOR_MIME) stay and cross as
//     deps;
//   - `resolveModernGridItem`, `resolveHomeItem`, `resolveHandoffTarget`,
//     `withEffectiveViewCounts`, `leafStillEnumerated`, `resolveOnDiskPath`,
//     `isFinishedPresence` all have other referrers (lib/media/user-routes.js,
//     the storage-summary route, server.js's exports) and cross as deps;
//   - the giant movers (trashItem, moveItemToFolder) are slice R3's - a route
//     that calls one receives it as a dep.
//
// A THIRD deliberate non-byte-identical token class, and the one the deps
// census structurally CANNOT see: a relative `require()` SPECIFIER inside a
// moved body resolves against the FILE it now lives in, not against the file
// it came from. POST /api/videos/attribute-channel-bulk lazily requires the
// yt-dlp activity board twice; `require('./lib/ytdlp/activity')` became
// `require('../ytdlp/activity')` - same module, re-rooted. The census reads
// module-scope IDENTIFIERS, and a specifier is a string literal, so nothing
// flagged it; the integration suite did, as MODULE_NOT_FOUND inside the
// bulk mover's async tail. Same hazard family as `crittersDir`'s __dirname.
//
// TWO deliberate non-byte-identical TOKENS, both MUTABLE SEAMS that a
// destructured `const` would freeze at registration time (the slice S1a
// push-guard lesson), each mutation-proven in test/unit/media-routes-live-
// seams.test.js:
//   - `ffmpegAvailable` is a server.js `let` an async `exec('ffmpeg -version')`
//     callback flips to true AFTER boot. POST /api/videos/:id/prepare-audio now
//     reads it as `ffmpegIsAvailable()` (named like the tv and music seams - a
//     future `if (!ffmpegAvailable)` on a function name would be a silent always-false);
//     server.js passes `ffmpegIsAvailable: () => ffmpegAvailable`.
//     Frozen, that route would answer 503 'ffmpeg unavailable' forever.
//   - `ttsEngineVersion` is a server.js `let` the TTS probe's async callback
//     fills in after boot. GET /api/stats now reads it as `ttsEngineVersion()`;
//     server.js passes `() => ttsEngineVersion`. Frozen, the Stats "About"
//     section would report a null TTS version forever.
// The bulk-attribution latch needed no such token: its two `let`s are private
// to this group, so they moved to this module's scope and the routes still
// ASSIGN them directly (server.js's `__setAttributeBulkInProgressForTests`
// export now delegates to the setter exported below, as the SAME function
// object).
//
// The bodies are verbatim, so some of their comments still point at server.js
// neighbours: DELETE /api/videos/:id's "see `trashItem`", GET /api/subtitles's
// "the scan's additive hasSubtitles detection", and POST /api/videos/:id/
// prepare-audio's "see GET /audio/:id's own comment". `trashItem` left for
// lib/media/trash.js in slice S5 and reaches the delete route as a dep; the
// other two mean server.js's, which is where those still live, and so do GET
// /api/subtitles/:id's "exactly like /video/:id and /thumbnail/:id above"
// (both still in server.js) and the dimensions backfill's "see the comment
// above `newMetadata[id].width`" (inside runScanDirectories, in server.js) -
// among others. Named here rather than edited in place - editing them would
// break the byte-identity the slice's verification rests on.

// ---- module state: the bulk-attribution single-flight latch ----------------
// These three moved out of server.js WITH the two bulk routes (their only
// referrers, plus the test seam below). They sit at MODULE scope rather than
// inside registerLibraryRoutes because POST /api/videos/attribute-channel-bulk
// and its cancel sibling ASSIGN them - a destructured dep is a `const` binding
// and could not be assigned at all - and because the test seam server.js still
// exports has to reach the same two variables the routes do.
// Bulk manual attribution. GATE ROUND 1 REBUILD (adversarial C2/C3, the
// data-destruction findings): the selector `root` is now CONFINED to the
// configured library roots (equal-or-under -- the computeMoveTarget
// posture; an unconfined ancestor path swept and FLATTENED the reviewer's
// entire fixture library in one request), the operation runs behind a
// SINGLE-FLIGHT latch with a cancel endpoint (the repull-metadata shape the
// exec plan specified), `preview: true` answers counts WITHOUT writing (the
// v1.41.7 see-before-you-move posture -- the client confirms with real
// numbers), and a re-run RESUMES: items already manually attributed to THIS
// target but not yet living in its folder join the move set, so a crash
// mid-loop is recoverable by pressing the button again (W2).
let attributeBulkInProgress = false;
let attributeBulkCancelled = false;
const ATTRIBUTE_BULK_ONESHOT_KEY = 'attribute-bulk';

// v1.53 gate round 2 (M21), moved with the latch: deterministic single-flight
// testing - the latch is module state, and a real stalled-mover race is
// untestable without it. server.js re-exports THIS function object under the
// same `__setAttributeBulkInProgressForTests` name it always exported.
function __setAttributeBulkInProgressForTests(v) { attributeBulkInProgress = v === true; }

// The browse contract, registered where GET /api/search sat in server.js:
// universal search, the paginated /api/videos list, the home feed, the channel
// list and the single-item detail read.
function registerBrowseRoutes(app, deps) {
  const {
    audioExtractProgress, // the live per-id extract progress Map - the OBJECT, never a copy
    bookVisibleTo,
    booksDb,
    buildWatchUrl, // lib/ytdlp/url - the search results' canonical watch links
    effectiveProgress, // the stored position with any un-flushed ping overlaid
    folderDisplayNameStore,
    folderSettingsStore,
    getCachedDatabase,
    homeFeed, // lib/home/feed - the pure home-row assembler
    mediaVisibleTo,
    musicDb,
    ownTrack,
    path,
    pendingProgress, // the progress coalescer's staging Map - the LIVE object, never a copy
    podcastEpisodeVisibleTo,
    podcastsDb,
    previewClipEligible,
    projectedLibraryTracks,
    resolveHomeItem,
    resolveItemChapters,
    resolveModernGridItem,
    searchRegistry, // lib/search/registry - the universal-search provider list
    storyboardDescriptor,
    trackVisibleTo,
    transcodeProgress,
    userStore,
    videoQuery, // lib/videoQuery - the shared sort/filter/pagination primitives
    visibleTvEpisodes,
    ytdlp,
    ytdlpDb,
  } = deps;

  // API: universal search across every browsable media type (v1.205 Wave B).
  //
  // The header search box drives THIS, not /api/videos (which stays the library
  // grid's own list route). Blends videos + audio + music + podcasts (shows AND
  // episodes) + TV (shows AND episodes) + books into ONE ranked flat stream, a
  // resultType per item for the client's type badge. Providers live in
  // lib/search/registry.js; each owns its match predicate and its EXISTING
  // per-kind visibility gate, wired here via `deps` - so RBAC is the SAME single
  // decision as every list/serve route (never a divergent second gate; the
  // leaks-titles/counts class). Ranking (lib/search/rank.js): relevance tier ->
  // type priority -> recency. Pagination mirrors /api/videos: total = the full
  // ranked length, page = slice(offset, offset+limit). STATIC segment, declared
  // before /api/videos - no /:id sibling shadows it (the route-order scar).
  // Behind the same session gate as every /api route; req.user drives RBAC.
  app.get('/api/search', (req, res) => {
    const db = getCachedDatabase();
    const query = typeof req.query.q === 'string' ? req.query.q : '';
    const chip = searchRegistry.normalizeChip(req.query.type);
    const limit = videoQuery.normalizeLimit(req.query.limit);
    const offset = videoQuery.normalizeOffset(req.query.offset);
    const deps = {
      db,
      gates: {
        mediaVisibleTo,
        trackVisibleTo,
        podcastVisibleTo: podcastEpisodeVisibleTo, // accepts a bare {subId} for a show
        tvVisibleEpisodes: visibleTvEpisodes,      // already RBAC-filtered
        bookVisibleTo,
      },
      // buildWatchUrl re-validates the id (null on anything unsafe); the key is
      // absent when there is nothing safe to share (C4, the /api/videos posture).
      buildWatchUrl: (item) => (typeof item.youtubeId === 'string' ? (buildWatchUrl(item.youtubeId) || undefined) : undefined),
      // v1.221: the projected library-audio tracks (downloaded audio, chaptered files
      // expanded into per-chapter tracks) so searchMusic can surface them as MUSIC
      // results - a downloaded track (and each CHAPTER TITLE) is findable + plays via
      // the music player. Lazy (only the music arm calls it); v1.242: the same
      // unconditional eligibility + RBAC as /api/music (no opt-in).
      musicTracks: () => musicDb.read().tracks, // Wave 5: the native music tracks, from their table
      booksItems: () => booksDb.read().items, // Wave 5: the book items, from their table
      podcastsNs: (() => { let memo = null; return () => (memo || (memo = podcastsDb.read())); })(), // Wave 5: the podcasts namespace (shows + episodes), from its tables - ONE read per query (shows + episodes both ask)
      musicLibraryTracks: () => {
        const ns = musicDb.read();
        const native = Object.values(ns.tracks).filter((t) => trackVisibleTo(req, t));
        return projectedLibraryTracks(req, native);
      },
    };
    const ranked = searchRegistry.runSearch(query, chip, req, deps);
    const total = ranked.length;
    const page = ranked.slice(offset, offset + limit);
    res.json({ items: page, total, offset, limit, query, type: chip });
  });

  // API: Get list of videos/audio
  //
  // v1.30 A5 (T6, API CHANGE): paginated + server-authoritative sort/filter.
  // Response shape changed from a bare array to `{ items, total, offset,
  // limit }` -- see docs/exec-plans/completed/2026-07-11-v1.30-scale-perf-and-
  // polish.md ("### A5 -- pagination contract") and ARCHITECTURE.md. Pipeline:
  // getCachedDatabase() -> hidden-folder filter (home only, unchanged) ->
  // search -> root/folder filter -> format filter -> sort the FULL filtered
  // list (lib/videoQuery.js, seeded when `sort=random`) -> slice
  // [offset, offset+limit) -> overlay pending progress on the SLICED page only
  // -> respond with `total` = the full filtered length (before slicing).
  app.get('/api/videos', (req, res) => {
    const db = getCachedDatabase(); // v1.30 A3: hot GET reader
    const ytView = ytdlpDb.holder(['subscriptions', 'channelAvatars']); // Wave 5: the avatar registry + subscriptions, ONE read per request (resolveItemChannelAvatarUrl is read-only)
    const search = (req.query.search || '').toLowerCase().trim();
    const folderFilter = req.query.folder || '';
    const rootFilter = req.query.root || ''; // a configured folder path — matches everything under it (recursive)
    const sort = typeof req.query.sort === 'string' ? req.query.sort : 'newest';
    const format = req.query.format; // videoQuery.filterByFormat already treats anything but 'video'/'audio' as 'both'
    const watch = videoQuery.normalizeWatchFilter(req.query.watch); // v1.50: all|new|watching|watched
    const limit = videoQuery.normalizeLimit(req.query.limit);
    const offset = videoQuery.normalizeOffset(req.query.offset);
    const seed = videoQuery.normalizeSeed(req.query.seed);

    let list = Object.values(db.metadata);

    // v1.80 RBAC: drop restricted items FIRST, so total/sort/pagination and every
    // downstream filter operate on only what this user may see. Admin's index is
    // empty (keeps everything).
    list = list.filter((item) => mediaVisibleTo(req, item));

    // Is a file located under a given folder path? (that folder or any descendant)
    const underFolder = (filePath, folder) =>
      filePath === folder || filePath.startsWith(folder + '/') || filePath.startsWith(folder + '\\');

    // On the default (home/recent) view — no explicit filter — hide files from folders
    // the user marked hidden (their whole subtree). Opening a folder still shows everything.
    if (!search && !folderFilter && !rootFilter) {
      const settings = folderSettingsStore.getAll(); // Wave 4
      const hiddenFolders = Object.keys(settings).filter(f => settings[f] && settings[f].hidden);
      if (hiddenFolders.length > 0) {
        list = list.filter(item => !hiddenFolders.some(hf => underFolder(item.filePath, hf)));
      }
    }

    // Search filter. v1.149: `searchIn` scopes the match (all|title|channel;
    // anything else normalizes to 'all', which is a strict SUPERSET of the
    // pre-v1.149 title+folder behavior - it adds the healed channelName and
    // the v1.126 folder DISPLAY name, so searching a channel by the name a
    // human knows finds its items even when the on-disk folder differs).
    if (search) {
      const searchScope = videoQuery.normalizeSearchScope(req.query.searchIn);
      const searchDisplayNames = folderDisplayNameStore.getAll(); // Wave 4
      list = list.filter(item => videoQuery.matchesSearch(item, search, {
        scope: searchScope,
        displayName: searchDisplayNames[item.folderName],
      }));
    }

    // Mapped-folder filter: recursive — everything under the configured folder (incl. subfolders).
    if (rootFilter) {
      list = list.filter(item => underFolder(item.filePath, rootFilter));
    }

    // Folder uploader (channel) filter: files whose immediate parent matches.
    if (folderFilter) {
      list = list.filter(item => item.folderName === folderFilter);
    }

    // v1.79.1: the subscription-SCOPED browse (?subs=1) - the "New from your
    // subscriptions" feed row's See-all target. Filter to items under a
    // subscription folder via essentially the same name-based join GET /api/home
    // uses (folderName OR channelName in the subscription-name set; /api/home
    // additionally gates on folderKey presence, inert for real media items).
    // Subscriptions are
    // global until the v1.44 RBAC tranche (tech-debt #122); this shares that
    // limitation by construction. Read the names straight off the namespace.
    if (req.query.subs === '1') {
      const subsList = ytdlpDb.readPart('subscriptions'); // Wave 5: from its table
      const subNames = new Set(subsList.map((s) => s && s.name).filter(Boolean));
      list = list.filter((item) => item && ((item.folderName && subNames.has(item.folderName)) || (item.channelName && subNames.has(item.channelName))));
    }

    // Media-type (format) filter — new in v1.30 A5; server-authoritative
    // replacement for the client's local filterByMediaType.
    list = videoQuery.filterByFormat(list, format);

    // v1.50: per-user watched-state filter. Must run BEFORE total/sort/slice
    // (a page-local filter would break pagination), and must see the same
    // read-your-writes view `effectiveProgress` gives single-item readers --
    // so the user's committed progress rows (ONE query, not per-item) get any
    // not-yet-flushed pendingProgress entries overlaid before filtering.
    // `watchedSet` is fetched once and reused by the page overlay below.
    const watchedSet = new Set(userStore.getWatchedIds(req.user.id));
    if (watch !== 'all') {
      const progressMap = userStore.getProgress(req.user.id);
      for (const entry of pendingProgress.values()) {
        if (entry.userId === req.user.id) progressMap[entry.mediaId] = entry.value;
      }
      list = videoQuery.filterByWatchState(list, watch, progressMap, watchedSet);
    }

    // v1.72 (cap 5): the "Continue watching" selection - the music/podcasts
    // recent-listening contract ported to media: items with a saved position,
    // most recently updated first (read-your-writes: the pendingProgress
    // overlay rides on top of the committed rows, its value carrying its own
    // updatedAt), MINUS finished items - videos have a watched latch (music
    // does not), and a completed video is not "in progress". The selection
    // carries its own order, so the sort pipeline below is bypassed exactly
    // like /api/music's recent-listening arm bypasses sortTracks.
    const recentWatching = req.query.filter === 'recent-watching';
    if (recentWatching) {
      const progressMap = userStore.getProgress(req.user.id);
      for (const entry of pendingProgress.values()) {
        if (entry.userId === req.user.id) progressMap[entry.mediaId] = entry.value;
      }
      list = list.filter((item) => {
        const p = Object.prototype.hasOwnProperty.call(progressMap, item.id) ? progressMap[item.id] : null;
        if (!p || !(Number(p.timestamp) > 0)) return false;
        const pct = Number(p.duration) > 0 ? (Number(p.timestamp) / Number(p.duration)) * 100 : 0;
        return videoQuery.deriveWatchState(pct, watchedSet.has(item.id)) !== 'watched';
      });
      list.sort((a, b) => String((progressMap[b.id] || {}).updatedAt || '').localeCompare(String((progressMap[a.id] || {}).updatedAt || '')));
    }

    // `total` is the full filtered length, BEFORE slicing to a page — this is
    // what makes AC3.2's "page(sort,filter) == sort(filter(full)).slice(...)"
    // property hold, and what lets the client know when it has reached the end.
    const total = list.length;

    // Sort the FULL filtered list, then slice — never sort only the current
    // page (that would break cross-window ordering at page boundaries).
    // `random` is seeded from the client's `seed` query param so sequential
    // page fetches sharing a seed observe one stable shuffle; an absent/
    // invalid seed falls back to one-shot (non-reproducible) randomness.
    const rng = sort === 'random' && seed !== undefined ? videoQuery.createSeededRng(seed) : undefined;
    const sorted = recentWatching ? list : videoQuery.sortItems(list, sort, rng);
    const page = sorted.slice(offset, offset + limit);

    // Overlay progress only on the sliced page — v1.30 A4: `effectiveProgress`
    // overlays any not-yet-flushed `pendingProgress` entry over the cache
    // (read-your-writes). Doing this AFTER slicing (not over the full filtered
    // list) keeps the per-request cost bounded to the page size.
    // v1.43: the liked flag derives from the USER's membership set -- ONE
    // user_liked read per request, shared across the page's items.
    const likedSet = new Set(userStore.getLiked(req.user.id));
    const items = page.map(item => {
      const progress = effectiveProgress(req.user.id, item.id) || { timestamp: 0, duration: 0 };
      const progressPercent = progress.duration > 0 ? (progress.timestamp / progress.duration) * 100 : 0;
      // v1.67: the ORIGINAL YouTube watch URL, derived exactly like the
      // single-item route (buildWatchUrl re-validates the id, null on
      // anything unsafe) so the card share corner never re-approximates a
      // server-resolved field from the spread's raw youtubeId (v1.52 lesson).
      // Key absent when there is nothing safe to share (C4).
      const watchUrl = typeof item.youtubeId === 'string' ? buildWatchUrl(item.youtubeId) : null;
      return {
        ...item,
        // v1.113 (Fix A): resolve the channel avatar EXACTLY like /api/home,
        // /api/notifications and the watch route -- resolveItemChannelAvatarUrl
        // checks the baked item.channelAvatarUrl FIRST (re-sanitizing it) then the
        // registry/subscription join. The CARD read surfaces still spreading the
        // raw item -- search (here), /api/liked and /api/history -- all get the
        // same one-liner (gate WARNING: "the ONE read surface" was false; the
        // shared buildCardHtml->modernCardAvatar path reads item.channelAvatarUrl
        // on all three). READ-ONLY (store.js): no cached-db mutation, no clone;
        // bounded to the page `limit`.
        channelAvatarUrl: ytdlp.resolveItemChannelAvatarUrl(ytView, item) || '',
        ...(watchUrl ? { watchUrl } : {}),
        // v1.93.2: DERIVED storyboard descriptor (eligible videos only), so the
        // list projection carries the same geometry as the grid/watch payloads
        // without a persisted flag.
        storyboard: storyboardDescriptor(item) || undefined,
        hasPreview: previewClipEligible(item) || undefined, // v1.94: card hover clip eligibility
        progress: progress.timestamp,
        progressPercent,
        // v1.40.0: per-item liked flag so the grid can render each card's Like
        // control in its correct initial state (same derivation as the single
        // GET /api/videos/:id route and the by-construction flag on /api/liked).
        liked: likedSet.has(item.id),
        // v1.50: server-derived so the client never re-implements the
        // thresholds (one authority for what "watched" means).
        watchState: videoQuery.deriveWatchState(progressPercent, watchedSet.has(item.id))
      };
    });

    res.json({ items, total, offset, limit });
  });

  app.get('/api/home', (req, res) => {
    const db = getCachedDatabase(); // v1.30 A3: hot GET reader
    const ytView = ytdlpDb.holder(['subscriptions', 'channelAvatars']); // Wave 5: the avatar registry + subscriptions, ONE read per request (resolveItemChannelAvatarUrl is read-only)
    const userId = req.user.id;

    // ---- per-user reads (ONE query each, shared across the candidate build) ----
    const watchedSet = new Set(userStore.getWatchedIds(userId));
    const watchedTimes = userStore.getWatchedTimes(userId); // media_id -> completed_at
    const likedSet = new Set(userStore.getLiked(userId));
    // v1.97 "Hide from feed": the user's MANUAL modern-feed prune. Read once here;
    // it is applied ONLY inside the grid short-circuit below (the modern feed) -
    // NOT the row feed, /api/videos, or any library/search/channel surface. It is
    // NOT a visibility/RBAC control (that is mediaVisibleTo / hiddenFolders) - a
    // feed-hidden item stays fully findable everywhere else.
    const feedHiddenSet = new Set(userStore.getFeedHidden(userId));
    const progressMap = userStore.getProgress(userId);
    for (const entry of pendingProgress.values()) {
      if (entry.userId === userId) progressMap[entry.mediaId] = entry.value; // read-your-writes
    }

    // Home view hides files under folders the user marked hidden (mirrors
    // /api/videos' home arm). Opening a folder still shows everything.
    const folderSettings = folderSettingsStore.getAll(); // Wave 4
    const hiddenFolders = Object.keys(folderSettings).filter((f) => folderSettings[f] && folderSettings[f].hidden);
    const underFolder = (filePath, folder) => filePath === folder || (typeof filePath === 'string' && (filePath.startsWith(folder + '/') || filePath.startsWith(folder + '\\')));

    // Subscription folder-name set (name-based join; subscriptions are GLOBAL/
    // shared until the v1.44 RBAC tranche - disclosed in the exec plan). Read the
    // names straight off the namespace - the feed needs the channel NAMES only,
    // not the full enriched records the poll path builds.
    const subsList = ytdlpDb.readPart('subscriptions'); // Wave 5: from its table
    const subNames = new Set(subsList.map((s) => s && s.name).filter(Boolean));

    // ---- v1.84 Modern Mode: the FLAT grid view (short-circuits the rows) ------
    // A dedicated gather over the media library (video+audio) + downloaded
    // podcasts, filtered by the chip, SORTED by the requested key (v1.86.0), and
    // PAGINATED (v1.86.2 - {items,total,offset,limit}, the modern feed lazy-loads).
    // It reuses the EXACT per-user reads + RBAC visibility (mediaVisibleTo/
    // podcastEpisodeVisibleTo) + hidden-folder guards above, so it can never surface
    // a restricted or hidden item the row path would hide. Music keeps its own place.
    if (req.query.view === 'grid') {
      const filter = homeFeed.resolveGridFilter(req.query.filter);
      const cand = [];
      // media (video + audio) - always gathered; the predicate decides membership
      for (const id of Object.keys(db.metadata || {})) {
        const item = db.metadata[id];
        if (!item || typeof item !== 'object') continue;
        if (!mediaVisibleTo(req, item)) continue; // v1.80 RBAC
        if (hiddenFolders.length && hiddenFolders.some((hf) => underFolder(item.filePath, hf))) continue;
        if (feedHiddenSet.has(id)) continue; // v1.97: the user pruned this from THEIR modern feed (this surface ONLY)
        const p = Object.prototype.hasOwnProperty.call(progressMap, id) ? progressMap[id] : null;
        const ts = p ? Number(p.timestamp) : 0;
        const dur = p ? Number(p.duration) : 0;
        const pct = dur > 0 ? (ts / dur) * 100 : 0;
        const watched = watchedSet.has(id);
        const finished = videoQuery.deriveWatchState(pct, watched) === 'watched';
        const rec = {
          id, kind: 'media', type: item.type === 'audio' ? 'audio' : 'video',
          inProgress: ts > 0 && !finished, watched, finished,
          addedAt: typeof item.addedAt === 'number' ? item.addedAt : 0,
          progressPercent: pct, liked: likedSet.has(id),
          // v1.86.0: sort keys for videoQuery.sortItems. title/size for
          // title-*/size-* ; releaseDate only when present (resolveReleaseDateSortValue
          // falls back to addedAt otherwise, so we do NOT default it to 0).
          title: item.title || item.name || '',
          size: typeof item.size === 'number' ? item.size : 0,
          releaseDate: typeof item.releaseDate === 'number' ? item.releaseDate : undefined,
        };
        if (homeFeed.matchesGridFilter(rec, filter)) cand.push(rec);
      }
      // podcasts (downloaded) - only for the chips that can contain them
      if (filter === 'all' || filter === 'podcasts' || filter === 'continue') {
        const podNs = podcastsDb.read();
        const podProgress = userStore.getPodcastProgress(userId);
        const podLiked = new Set(userStore.getPodcastLiked(userId).map((l) => l.episodeId));
        for (const id of Object.keys(podNs.episodes || {})) {
          const ep = podNs.episodes[id];
          if (!ep || ep.status !== 'downloaded') continue;
          if (!podcastEpisodeVisibleTo(req, ep)) continue; // v1.80 RBAC
          const pp = Object.prototype.hasOwnProperty.call(podProgress, id) ? podProgress[id] : null;
          const pos = pp ? Number(pp.position) : 0;
          const dur = pp ? Number(pp.duration) : 0;
          const rec = {
            id, kind: 'podcast', type: 'audio',
            inProgress: pos > 0, watched: false,
            addedAt: typeof ep.addedAt === 'number' ? ep.addedAt : 0,
            progressPercent: dur > 0 ? (pos / dur) * 100 : 0, liked: podLiked.has(id),
            // v1.86.0: same sort keys. Podcasts carry no reliable byte size ->
            // 0 (they sort together under size-*); releaseDate omitted -> addedAt
            // fallback, mirroring the media path.
            title: ep.title || 'Episode',
            size: typeof ep.size === 'number' ? ep.size : 0,
            releaseDate: typeof ep.releaseDate === 'number' ? ep.releaseDate : undefined,
          };
          if (homeFeed.matchesGridFilter(rec, filter)) cand.push(rec);
        }
      }
      // v1.86.0 (Dean): sort the FULL candidate set by the requested key BEFORE the
      // page slice, so "oldest"/"largest"/"feeling lucky" span the whole library.
      // Reuses videoQuery.sortItems - the exact comparator set the classic
      // /api/videos grid uses - so the two grids stay behaviourally identical.
      // v1.86.2 (Dean): the modern grid now LAZY-LOADS - it PAGINATES exactly like
      // /api/videos ({ items, total, offset, limit }) instead of a hard 60-cap.
      // `random` is seeded (videoQuery.createSeededRng(seed)) so one scroll session
      // observes ONE stable shuffle across pages rather than re-shuffling (and
      // re-showing duplicates) on every appended page - the same seed contract the
      // classic grid uses. Default 'newest' preserves the prior order.
      const sort = homeFeed.resolveGridSort(req.query.sort);
      const rng = sort === 'random' ? videoQuery.createSeededRng(videoQuery.normalizeSeed(req.query.seed)) : undefined;
      const sortedCand = videoQuery.sortItems(cand, sort, rng);
      const total = sortedCand.length;
      const offset = videoQuery.normalizeOffset(req.query.offset);
      const limit = videoQuery.normalizeLimit(req.query.limit);
      const items = sortedCand.slice(offset, offset + limit).map((rec) => resolveModernGridItem(db, rec, ytView)).filter(Boolean);
      return res.json({ items, filter, sort, total, offset, limit });
    }

    const records = [];
    const kindById = new Map();
    const pctById = new Map();
    const folderTitles = new Map();
    const folderHrefs = new Map();

    // ---- MEDIA candidates (db.metadata) ----
    for (const id of Object.keys(db.metadata || {})) {
      const item = db.metadata[id];
      if (!item || typeof item !== 'object') continue;
      if (!mediaVisibleTo(req, item)) continue; // v1.80 RBAC: the feed never surfaces a restricted item
      if (hiddenFolders.length && hiddenFolders.some((hf) => underFolder(item.filePath, hf))) continue;
      const p = Object.prototype.hasOwnProperty.call(progressMap, id) ? progressMap[id] : null;
      const ts = p ? Number(p.timestamp) : 0;
      const dur = p ? Number(p.duration) : 0;
      const pct = dur > 0 ? (ts / dur) * 100 : 0;
      const watched = watchedSet.has(id);
      const finished = videoQuery.deriveWatchState(pct, watched) === 'watched';
      // inProgress matches /api/videos' recent-watching selection exactly: a
      // saved position and not finished (no divergent floor - consistency with
      // the already-shipped Continue-watching row).
      const inProgress = ts > 0 && !finished;
      const folderKey = item.folderName || null;
      if (folderKey && !folderTitles.has(folderKey)) {
        folderTitles.set(folderKey, (typeof item.channelName === 'string' && item.channelName) ? item.channelName : folderKey);
        folderHrefs.set(folderKey, `/?folder=${encodeURIComponent(folderKey)}`);
      }
      kindById.set(id, 'media');
      pctById.set(id, pct);
      records.push({
        id,
        kind: 'media',
        inProgress,
        finished,
        watched,
        liked: likedSet.has(id),
        progressAt: finished ? (watchedTimes[id] || (p && p.updatedAt) || '') : ((p && p.updatedAt) || ''),
        addedAt: typeof item.addedAt === 'number' ? item.addedAt : 0,
        folderKey,
        isSub: !!folderKey && (subNames.has(folderKey) || subNames.has(item.channelName)),
      });
    }

    // ---- TRACK candidates (only the ones the mixed rows can use: in-progress
    // OR liked). Tracks have no watched latch and no channel/sub identity. ----
    const musicNs = musicDb.read();
    const musicProgress = userStore.getMusicProgress(userId);
    const musicLiked = new Set(userStore.getMusicLiked(userId));
    for (const id of Object.keys(musicNs.tracks || {})) {
      const liked = musicLiked.has(id);
      const mp = Object.prototype.hasOwnProperty.call(musicProgress, id) ? musicProgress[id] : null;
      const pos = mp ? Number(mp.position) : 0;
      const inProgress = pos > 0;
      if (!liked && !inProgress) continue;
      const track = ownTrack(musicNs.tracks, id);
      if (!track) continue;
      if (!trackVisibleTo(req, track)) continue; // v1.80 RBAC: no restricted track in the feed
      const dur = mp ? Number(mp.duration) : 0;
      kindById.set(id, 'track');
      pctById.set(id, dur > 0 ? (pos / dur) * 100 : 0);
      records.push({ id, kind: 'track', inProgress, finished: false, watched: false, liked, progressAt: (mp && mp.updatedAt) || '', addedAt: typeof track.addedAt === 'number' ? track.addedAt : 0, folderKey: null, isSub: false });
    }

    // ---- PODCAST candidates (downloaded, in-progress OR liked) ----
    const podNs = podcastsDb.read();
    const podProgress = userStore.getPodcastProgress(userId);
    const podLiked = new Set(userStore.getPodcastLiked(userId).map((l) => l.episodeId));
    for (const id of Object.keys(podNs.episodes || {})) {
      const ep = podNs.episodes[id];
      if (!ep || ep.status !== 'downloaded') continue;
      if (!podcastEpisodeVisibleTo(req, ep)) continue; // v1.80 RBAC: no restricted show in the feed
      const liked = podLiked.has(id);
      const pp = Object.prototype.hasOwnProperty.call(podProgress, id) ? podProgress[id] : null;
      const pos = pp ? Number(pp.position) : 0;
      const inProgress = pos > 0;
      if (!liked && !inProgress) continue;
      const dur = pp ? Number(pp.duration) : 0;
      kindById.set(id, 'podcast');
      pctById.set(id, dur > 0 ? (pos / dur) * 100 : 0);
      records.push({ id, kind: 'podcast', inProgress, finished: false, watched: false, liked, progressAt: (pp && pp.updatedAt) || '', addedAt: typeof ep.addedAt === 'number' ? ep.addedAt : 0, folderKey: null, isSub: false });
    }

    const { rows } = homeFeed.assembleHomeRows({ records, folderTitles, folderHrefs });

    // Resolve each selected id to render fields; drop dead links; drop a row that
    // resolves empty (all its items vanished).
    const outRows = [];
    for (const row of rows) {
      const items = [];
      for (const id of row.itemIds) {
        const resolved = resolveHomeItem(db, id, kindById.get(id) || 'media', pctById.get(id) || 0);
        if (resolved) items.push(resolved);
      }
      if (items.length > 0) outRows.push({ id: row.id, title: row.title, seeAllHref: row.seeAllHref, items });
    }

    res.json({ rows: outRows });
  });

  // v1.47 (Roku playback wave): the channel list the TV's Channels view needs.
  // A "channel" is an item's immediate parent folder (`folderName` -- the same
  // identity `GET /api/videos?folder=` filters by); display name and avatar
  // come from the scan's channelName/channelAvatarUrl when present. Optional
  // `?root=<path>` scopes RECURSIVELY by filePath prefix (gate W5: matching
  // item.rootFolder exactly diverges from /api/videos under nested configured
  // roots -- matchRootFolder assigns the LONGEST containing root, so an
  // inner-root channel would vanish from the outer root's channel list while
  // its videos still showed). Gate W4: with no explicit ?root=, channels
  // under HIDDEN roots are skipped -- an operator hides a library precisely
  // to keep it off browse surfaces (the Roku picker already hides those
  // roots; asking for one explicitly still works). Pure read over the hot
  // cache; no new persistence, no writes.
  app.get('/api/channels', (req, res) => {
    const db = getCachedDatabase(); // v1.30 A3: hot GET reader
    const ytView = ytdlpDb.holder(['subscriptions', 'channelAvatars']); // Wave 5: the avatar registry + subscriptions, ONE read per request (resolveItemChannelAvatarUrl is read-only)
    const rootFilter = typeof req.query.root === 'string' && req.query.root !== '' ? req.query.root : null;
    const settingsByRoot = folderSettingsStore.getAll(); // Wave 4
    const hiddenRoots = new Set(Object.keys(settingsByRoot).filter(p => settingsByRoot[p] && settingsByRoot[p].hidden === true));
    const underRoot = (fp) => fp === rootFilter || (typeof fp === 'string' && fp.startsWith(rootFilter + path.sep));
    // v1.84: name-based subscription set (same join as /api/home) so consumers can
    // pick the subscribed channels - the Modern-mode mobile avatar bar shows the
    // recently-active SUBSCRIPTIONS.
    const subsList = ytdlpDb.readPart('subscriptions'); // Wave 5: from its table
    const subNames = new Set(subsList.map((s) => s && s.name).filter(Boolean));
    const groups = new Map(); // folderName -> { folder, name, avatarUrl, count, latestAddedAt, isSub }
    for (const id of Object.keys(db.metadata || {})) {
      const item = db.metadata[id];
      if (!item || !item.folderName) continue;
      if (!mediaVisibleTo(req, item)) continue; // v1.80 RBAC: no restricted channels in the list
      if (rootFilter) {
        if (!underRoot(item.filePath)) continue;
      } else if (item.rootFolder && hiddenRoots.has(item.rootFolder)) {
        continue;
      }
      let g = groups.get(item.folderName);
      if (!g) {
        g = { folder: item.folderName, name: item.folderName, avatarUrl: null, count: 0, latestAddedAt: 0, isSub: false };
        groups.set(item.folderName, g);
      }
      g.count++;
      // First non-empty wins for name/avatar: every item of a channel folder
      // carries the same scan-captured values, so "first" is not a lottery.
      // v1.114 A2: prefer the captured channelName, stripping a leading "@" so a
      // handle-stored-as-the-name ("@Apple") shows the name ("Apple") on the
      // channel/avatar bar too (mirrors common.js displayChannelName, read-layer).
      if (g.name === g.folder && typeof item.channelName === 'string' && item.channelName !== '') {
        g.name = item.channelName.charAt(0) === '@' ? item.channelName.slice(1) : item.channelName;
      }
      if (!g.isSub && (subNames.has(item.folderName) || subNames.has(item.channelName))) g.isSub = true;
      // v1.85 (#3a): resolve through the channelId-keyed registry (the SAME chain
      // the Subscriptions menu + per-card avatar use), not just the baked
      // item.channelAvatarUrl. A subscribed channel whose videos never baked the
      // URL still gets its real photo in the avatar bar (Dean: "Subs shows the
      // avatar but the bar doesn't").
      if (!g.avatarUrl) {
        // resolveItemChannelAvatarUrl checks the baked item.channelAvatarUrl FIRST
        // (step 1), then the channelId/URL registry - so this one call subsumes
        // the old baked-field-only assignment.
        const resolvedAvatar = ytdlp.resolveItemChannelAvatarUrl(ytView, item);
        if (resolvedAvatar) g.avatarUrl = resolvedAvatar;
      }
      if (typeof item.addedAt === 'number' && item.addedAt > g.latestAddedAt) g.latestAddedAt = item.addedAt;
    }
    // v1.126: a group whose name never resolved past the raw folderName (no item
    // ever captured a channelName - the permanently-unhealable folders) takes the
    // per-folder display map, mirroring resolveChannelName's fallback order
    // client-side (channelName wins, then the map, then the raw folder).
    const displayNames = folderDisplayNameStore.getAll(); // Wave 4
    for (const g of groups.values()) {
      if (g.name === g.folder && typeof displayNames[g.folder] === 'string' && displayNames[g.folder].trim() !== '') {
        g.name = displayNames[g.folder].trim();
      }
    }
    // localeCompare: a consistent comparator (gate S4 -- the previous one
    // never returned 0, undefined order for equal lowercased names).
    const channels = [...groups.values()].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    res.json({ channels });
  });

  // API: Get details for single video/audio
  app.get('/api/videos/:id', (req, res) => {
    const db = getCachedDatabase(); // v1.30 A3: hot GET reader
    const ytView = ytdlpDb.holder(['subscriptions', 'channelAvatars']); // Wave 5: the avatar registry + subscriptions, ONE read per request (resolveItemChannelAvatarUrl is read-only)
    const item = db.metadata[req.params.id];
    if (!item) {
      return res.status(404).json({ error: 'Media file not found' });
    }
    if (!mediaVisibleTo(req, item)) { // v1.80 RBAC: restricted -> 404 like missing
      return res.status(404).json({ error: 'Media file not found' });
    }

    // v1.30 A4: overlay any not-yet-flushed `pendingProgress` entry (read-your-writes).
    // v1.43: scoped to the signed-in user.
    const progress = effectiveProgress(req.user.id, item.id) || { timestamp: 0 };
    // v1.25 QoL bugfix: serve-time fallback for the watch page's uploader
    // avatar. `item.channelAvatarUrl` (a persisted, item-level capture) stays
    // authoritative when present; only when it is EMPTY does this look up the
    // yt-dlp subscription whose channelUrl/channelId matches this item's own
    // captured identity and use THAT subscription's already-validated avatar
    // (`ytdlp.resolveItemChannelAvatarUrl`, lib/ytdlp/store.js -- read-only,
    // re-validates before returning, never persisted here). This covers any
    // subscribed channel's item, including a MeTube-imported video the scan
    // never routed through the yt-dlp download tree at all. A no-match (or the
    // module disabled -- `db.ytdlp.subscriptions` is simply absent/empty then)
    // leaves `channelAvatarUrl` empty, and the client's own resolveAvatarSource
    // (public/js/common.js) already falls back to a first-letter avatar.
    let channelAvatarUrl = item.channelAvatarUrl;
    if ((typeof channelAvatarUrl !== 'string' || channelAvatarUrl === '') && ytdlp.isEnabled(ytdlp.parseYtdlpConfig())) {
      // v1.85 #3a: resolveItemChannelAvatarUrl is now READ-ONLY - it reads the
      // ytdlp namespace via readYtdlpNamespace and NEVER calls ensureYtdlp, so it
      // no longer mutates anything. That means the shared getCachedDatabase()
      // object is safe to hand in directly. (Before #3a it backfilled db.ytdlp in
      // place, so this route deep-cloned the namespace to protect the read-cache
      // coherency invariant; both the mutation and the clone are gone, and the
      // v1.85 /api/channels + modern-grid callers pass the raw cached db too.)
      channelAvatarUrl = ytdlp.resolveItemChannelAvatarUrl(ytView, item);
    }
    // v1.33 T2 (Share button): the ORIGINAL YouTube watch URL, derived at
    // serve time from the persisted `youtubeId` through the same buildWatchUrl
    // gate the re-pull path uses (it re-validates the id and returns null on
    // anything unsafe -- the spread's own raw `youtubeId` is informational;
    // THIS field is the one the client shares).
    const watchUrl = typeof item.youtubeId === 'string' ? buildWatchUrl(item.youtubeId) : null;
    // v1.34 T3: the resolved chapter list (manual > embedded > description --
    // see resolveItemChapters) plus its provenance for the editor UI. The
    // spread's own raw `chapters`/`chaptersManual` are superseded by the
    // resolved keys below (object-literal order).
    const resolvedChapters = resolveItemChapters(item);
    res.json({
      ...item,
      ...(channelAvatarUrl ? { channelAvatarUrl } : {}),
      ...(watchUrl ? { watchUrl } : {}),
      // v1.93.2: DERIVED storyboard descriptor for the seek-bar scrub preview
      // (eligible videos only). Overrides any legacy persisted `storyboard` from
      // the `...item` spread so the client always gets the geometry that matches
      // the on-disk sprite; the player preloads the sprite and shows the scrub
      // preview only once it loads (ungenerated -> no preview, never an empty box).
      storyboard: storyboardDescriptor(item) || undefined,
      hasPreview: previewClipEligible(item) || undefined, // v1.94: hover clip eligibility
      chapters: resolvedChapters.chapters,
      chaptersSource: resolvedChapters.chaptersSource,
      progress: progress.timestamp,
      transcodeProgress: transcodeProgress[item.id] || 0,
      // v1.27.0 (EXPERIMENTAL): `audioStatus` itself already rides the `...item`
      // spread (db.metadata[id].audioStatus, set by setAudioStatus -- mirrors
      // transcodeStatus's own spread-through); only the live in-memory percent
      // needs adding explicitly, mirroring transcodeProgress just above.
      audioProgress: audioExtractProgress[item.id] || 0,
      // v1.30 C2: `liked` is DERIVED from membership at request time -- never
      // persisted on the item itself. Membership IS the like state (see
      // POST/DELETE /api/liked/:id below); this is purely a read-time
      // convenience so the watch page's initial paint doesn't need a second
      // `GET /api/liked` round-trip just to know this one item's state.
      // v1.43: the signed-in user's user_liked rows, not the frozen db.liked.
      liked: userStore.getLiked(req.user.id).includes(item.id),
      // v1.72 (cap 6): the manual watched toggle's read side - same
      // derived-at-request-time posture as `liked`, and the SAME derivation
      // authority every list surface uses (latch OR >=90% live position).
      watchState: videoQuery.deriveWatchState(
        (progress.duration || item.duration || 0) > 0 ? (progress.timestamp / (progress.duration || item.duration)) * 100 : 0,
        userStore.getWatchedIds(req.user.id).includes(item.id)
      )
    });
  });
}

// The device-handoff probe and the item DELETE, registered where
// GET /api/handoff sat in server.js. They are split from the browse bundle
// above because lib/media/user-routes.js's progress routes register BETWEEN
// them (server.js line 10201 at the base commit) - folding all seven into one
// call would have moved these two ahead of /api/progress in the stack.
function registerHandoffAndDeleteRoutes(app, deps) {
  const {
    THUMBNAIL_DIR, // the hard-delete sweep's thumbnail/storyboard/preview roots
    audioPath,
    clearPersistedServedAt, // the delete path's served-at reset
    destroyMediaStreams, // kills in-flight range streams before a file is unlinked
    extractMediaRef,
    extractYtdlpVideoId,
    fs,
    getCachedDatabase,
    getMediaId,
    inSaveTransaction, // the delete path batches every store write into one commit
    isFinishedPresence, // the handoff's "already watched to the end" predicate
    isSafeVideoId,
    leafStillEnumerated,
    loadDatabase,
    matchRootFolder,
    mediaVisibleTo,
    musicDb,
    path,
    podcastEpisodeVisibleTo,
    podcastsDb,
    presence, // lib/presence/store - the device-handoff liveness reducer
    previewClipPath,
    progressStore,
    refuseIfReadOnlyMedia,
    requireModifyLibrary,
    resolveHandoffTarget,
    resolveOnDiskPath,
    restrictedVideoMutation,
    storyboardPath,
    tombstoneStore,
    trackVisibleTo,
    transcodedPath,
    trashItem, // the soft-delete mover - lib/media/trash.js since slice S5 (server.js hands in a lazy wrapper; see its call site)
    updateDatabase,
    userStore,
    viewCountStore,
    ytdlp,
  } = deps;

  app.get('/api/handoff', (req, res) => {
    const deviceId = typeof req.query.deviceId === 'string' ? req.query.deviceId : '';
    const seen = presence.readOther(req.user.id, deviceId);
    if (!seen) return res.json({ presence: null });
    if (isFinishedPresence(seen)) return res.json({ presence: null });

    const handoffDb = getCachedDatabase();
    const target = resolveHandoffTarget(handoffDb, seen);
    if (!target) return res.json({ presence: null });
    // v1.80 RBAC: never offer a restricted item across devices (e.g. a restriction
    // added after playback began elsewhere). Podcast lands with its library.
    if (seen.kind === 'media' && !mediaVisibleTo(req, handoffDb.metadata && handoffDb.metadata[seen.mediaId])) {
      return res.json({ presence: null });
    }
    if (seen.kind === 'track' && !trackVisibleTo(req, musicDb.parts.tracks.get(seen.mediaId))) { // Wave 5 (gate pass B): a point query
      return res.json({ presence: null });
    }
    if (seen.kind === 'podcast') {
      if (!podcastEpisodeVisibleTo(req, podcastsDb.parts.episodes.get(seen.mediaId))) return res.json({ presence: null }); // Wave 5 (gate pass B): a point query
    }

    res.json({
      presence: {
        deviceId: seen.deviceId,
        deviceLabel: seen.deviceLabel,
        kind: seen.kind,
        mediaId: seen.mediaId,
        state: seen.state,
        position: seen.position,
        ageSeconds: seen.ageSeconds,
        ...target,
      },
    });
  });

  // API: Delete video/audio file
  app.delete('/api/videos/:id', async (req, res) => {
    if (!requireModifyLibrary(req, res)) return; // v1.81 write-RBAC (first guard)
    if (restrictedVideoMutation(req, res, req.params.id)) return; // v1.80 RBAC
    if (refuseIfReadOnlyMedia(res)) return; // v1.42 safe-mode lever (AC8)
    // v1.30 A3: a PURE read to look up `item` -- never mutated here, and the
    // actual persisted mutation below goes through its own `updateDatabase`
    // call (which loads a fresh copy inside the lock), so this is safe on the
    // cache: it is not a direct load->mutate->save site.
    const db = getCachedDatabase();
    const item = db.metadata[req.params.id];
    if (!item) {
      return res.status(404).json({ error: 'Media file not found' });
    }

    const filePath = item.filePath;
    // Opt-in "remove from library anyway" -- only meaningful once the client has
    // already seen the read-only/permission-denied error below and asked us to
    // proceed. See docs/exec-plans/completed/2026-07-06-v1.13-polish.md item 5.
    const removeAnyway = req.query.removeAnyway === 'true' || req.query.removeAnyway === '1';
    let fileRemainsOnDisk = false;
    // v1.65 note on the v1.41.3 verified/unverified distinction: the happy
    // path is now a TRASH move (trashItem below), which mints no tombstone --
    // the scan never walks the trash dir, so there is nothing to defer. Every
    // shape that still reaches the LEGACY cleanup mutator (resolver `gone`,
    // vanished-mid-delete, removeAnyway) is an unverified conclusion by
    // construction -- the file may in fact survive -- so that mutator now
    // ALWAYS mints the deletion tombstone (the old `unlinkVerified` flag,
    // true only after a watched in-route unlink, has no true case left).

    // v1.37.5: resolve the stored path to the REAL on-disk entry (handles an
    // NFC/NFD-variant name that `existsSync(item.filePath)` would miss) BEFORE
    // touching the db -- see `resolveOnDiskPath`'s doc comment for the bug this
    // closes.
    const resolved = resolveOnDiskPath(filePath);
    if (resolved.realPath === null && resolved.unreadable) {
      // We could not even ENUMERATE the parent dir (EACCES/EPERM/ENOTDIR), so we
      // cannot confirm the file is gone. Dropping the library entry here is
      // exactly the "disappears from the list but the file survives -> rescan
      // resurrects it" bug -- so leave the db COMPLETELY untouched and surface a
      // recoverable 409 (same opt-in `removeAnyway` follow-up as a read-only
      // volume). Only once the caller explicitly accepts does the entry go.
      if (!removeAnyway) {
        const code = resolved.unreadable.code;
        console.error(`Cannot delete ${filePath}: parent directory un-enumerable (${code || 'unknown'}); library entry left intact.`);
        return res.status(409).json({
          error: `Could not delete the file: its folder could not be read (${code || 'unknown'}), so removal can't be confirmed. The file was not removed.`,
          code,
          readOnly: true,
        });
      }
      fileRemainsOnDisk = true; // removeAnyway: caller accepts it may reappear on the next scan.
    }
    // The concrete path we unlink + hang sidecar cleanup off of. Null only when
    // the file is genuinely absent (`gone`) or unconfirmable-but-removeAnyway.
    const mediaPathOnDisk = resolved.realPath;

    // v1.41.10: close OUR OWN live streaming handles on everything this delete
    // is about to unlink, and wait (bounded) for the fds to actually close
    // BEFORE the unlink. An open read handle turns an SMB/CIFS delete into
    // server-side DELETE_PENDING -- the dirent stays enumerable until the last
    // holder closes while every retry reports ENOENT -- and this process was
    // itself the holder in the incident this fixes (seek-abandoned Range
    // streams; see activeMediaStreams' header). Registry keys are the exact
    // strings handed to createReadStream: the stored path, the resolved
    // on-disk variant, and the two id-keyed sidecars a player may be pulling.
    const releasePaths = new Set([filePath, transcodedPath(item.id), audioPath(item.id)]);
    // Defensive: today no route streams the RESOLVED variant when it differs
    // from item.filePath (players receive item.filePath verbatim), so this Set
    // member is a no-op lookup -- it exists so a future caller that streams the
    // resolved spelling is covered without anyone having to remember this line.
    if (mediaPathOnDisk) releasePaths.add(mediaPathOnDisk);
    // Parallel: the bounded waits overlap, so even the pathological all-wedged
    // case delays the DELETE by one 3s cap, not one per path.
    const releasedStreams = (await Promise.all([...releasePaths].map((p) => destroyMediaStreams(p))))
      .reduce((a, b) => a + b, 0);
    if (releasedStreams > 0) {
      console.log(`Delete: destroyed ${releasedStreams} live read stream(s) on ${filePath} before the trash move.`);
    }

    // v1.65 (ruling 3, closes tech-debt #64): EVERY delete routes through
    // TRASH. The resolvable-file case is an atomic rename into the root's
    // trash dir -- trashItem() owns the whole identity carry (the media_trash
    // record, doc-table carries, all nine per-user carriers, id-keyed sidecar
    // renames) and its own rollback, so NONE of the legacy cleanup below runs
    // for it. The legacy path survives only for the shapes with no file to
    // move: resolver `gone`, a vanished-mid-delete ENOENT, and the
    // removeAnyway escape (file deliberately left on a failing mount). Every
    // legacy shape is an UNVERIFIED conclusion by construction (nothing here
    // watches an unlink succeed anymore), so the legacy mutator below always
    // mints the v1.41.3 tombstone.
    let trashed = false;
    let trashedId = null;
    let trashedDeletePending = false;
    if (mediaPathOnDisk && !fileRemainsOnDisk) {
      const tr = await trashItem(
        { loadDatabase, updateDatabase, getMediaId },
        item.id,
        { sourcePath: resolved.realPathRaw || mediaPathOnDisk }
      );
      if (tr.ok) {
        trashed = true;
        trashedId = tr.trashId;
        // A leftover source dirent (the post-commit unlink failed or the
        // v1.41.10 delete-pending probe fired inside trashItem) is honestly a
        // file remaining on disk; trashItem already minted its deferred-
        // cleanup tombstone, and the scan's retry now trashes it too.
        fileRemainsOnDisk = tr.sourceUnlinkFailed === true;
        trashedDeletePending = tr.sourceDeletePending === true;
        console.log(`Moved to trash: ${mediaPathOnDisk} -> ${tr.trashPath}`);
      } else if (tr.status === 409 && tr.code && !removeAnyway) {
        // The same actionable 409 + opt-in removeAnyway follow-up contract the
        // unlink path has surfaced since v1.36.2 (a read-only mount can no
        // more rename than unlink).
        console.error(`Cannot trash file ${filePath} (${tr.code}):`, tr.error);
        return res.status(409).json({
          error: `Could not delete the file: this location is read-only, permission-denied, or the file is busy (${tr.code}). The file was not removed.`,
          code: tr.code,
          readOnly: true,
        });
      } else if (tr.status === 409 && tr.code && removeAnyway) {
        // Opt-in: the entry leaves the library, the file stays on disk; the
        // unverified tombstone below hands it to the scan's deferred retry.
        fileRemainsOnDisk = true;
      } else if (tr.status === 404) {
        // Vanished between resolution and the link (TOCTOU): the desired end
        // state ("not on disk") holds -- fall through to the legacy
        // already-gone cleanup.
        console.warn(`Delete: file already gone (${filePath}) -- removing the library entry anyway.`);
      } else {
        // trashItem rolled itself back; db and file are untouched.
        console.error(`Error trashing file ${filePath}:`, tr.error);
        return res.status(500).json({ error: `Could not delete file: ${tr.error}` });
      }
    } else if (!fileRemainsOnDisk) {
      // resolved.gone: genuinely absent (parent dir readable with no matching
      // entry, or the dir itself is gone). The desired end state already holds
      // -> SUCCESS; fall through to remove the orphaned library entry.
      console.warn(`File not on disk when deleting (already gone): ${filePath}`);
    }

    if (!trashed) {
      // Legacy sidecar hygiene for the no-file shapes -- these ids never
      // re-key, so their id-keyed sidecars die here. Best-effort throughout.
      const thumbPath = path.join(THUMBNAIL_DIR, `${item.id}.jpg`);
      try { if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath); } catch (_) { /* best-effort */ }
      try { if (fs.existsSync(storyboardPath(item.id))) fs.unlinkSync(storyboardPath(item.id)); } catch (_) { /* best-effort */ } // v1.92 sprite
      try { if (fs.existsSync(previewClipPath(item.id))) fs.unlinkSync(previewClipPath(item.id)); } catch (_) { /* best-effort */ } // v1.94 preview clip
      try { if (fs.existsSync(transcodedPath(item.id))) fs.unlinkSync(transcodedPath(item.id)); } catch (_) { /* best-effort */ }
      if (!fileRemainsOnDisk) {
        // The greedy .vtt sweep (v1.36.2), only when the media file itself is
        // genuinely gone -- a removeAnyway file keeps its subtitles.
        try {
          const mediaPath = mediaPathOnDisk || filePath;
          const dir = path.dirname(mediaPath);
          const base = path.basename(mediaPath, path.extname(mediaPath));
          for (const name of fs.readdirSync(dir)) {
            if (name.startsWith(`${base}.`) && name.endsWith('.vtt')) {
              try { fs.unlinkSync(path.join(dir, name)); } catch (_) { /* best-effort */ }
            }
          }
        } catch (_) { /* best-effort -- e.g. the dir itself is gone */ }
      }
    }

    // v1.41.10: post-verify against the parent directory. The legacy
    // "already gone" conclusions can lie when the server holds the file in
    // DELETE_PENDING (an open handle this process failed to release, or one on
    // another machine entirely): the dirent stays enumerable and the next scan
    // would re-index it. If the exact leaf bytes are still listed AND the leaf
    // is unopenable, the file is NOT gone: say so (fileRemainsOnDisk +
    // deletePending below); the legacy mutator's tombstone covers the retry --
    // by the tombstone contract (v1.41.3) a conclusion contradicted by the
    // directory itself is the definition of unverified. (v1.65: a successful
    // trash move never enters this probe -- trashItem watches its own source
    // unlink and tombstones any leftover itself.)
    //
    // Adversarial-gate CRITICAL (C1, this release): "still enumerated" ALONE
    // must never downgrade a VERIFIED unlink. An external writer can land a
    // brand-new file at the same leaf inside the unlink->readdir window (an
    // in-flight yt-dlp re-download completing -- the archive append below only
    // gates FUTURE download starts -- or a sync-client restore), and tombstoning
    // THAT file schedules the scan to reap content the user never deleted:
    // yt-dlp's default --mtime backdating defeats the scan's mtime<=deletedAt
    // gate, and the fresh-db guards can't help (the tombstone is fresh; the
    // metadata entry was just removed). Proven with a runnable repro against
    // this branch; main kept the file. So discriminate undead-vs-recreated by
    // OPENABILITY -- the incident's own signature: a DELETE_PENDING dirent is
    // enumerable while every NEW open is refused (Linux cifs maps
    // STATUS_DELETE_PENDING to ENOENT), whereas a recreated file opens fine.
    // Deliberately an open, NOT existsSync: with actimeo=1 a stat can be
    // answered from the client attribute cache for up to a second after the
    // unlink and would misclassify a genuinely-pending file as recreated; an
    // open is a real server round-trip. (An enumerated survivor that opens
    // EACCES is misread as pending -- accepted: the worst case is one tombstone
    // whose scan-side reap still re-checks mtime and the fresh-db guards.)
    //
    // Known residual (QA W1, disclosed): the OPPOSITE miss -- a stale
    // client-side directory cache omitting a genuinely-pinned survivor -- makes
    // this check pass, no tombstone is minted, and the next scan re-indexes the
    // survivor once. Self-healing: deleting the re-indexed card again lands in
    // the ENOENT shape above, which readdir (by then long past any cache TTL)
    // catches and tombstones. One extra user delete, never data loss.
    let deletePending = trashedDeletePending;
    // v1.65: the probe below only concerns the LEGACY shapes -- a trash move
    // runs the same v1.41.10 post-verify inside trashItem and reported its
    // verdict via sourceDeletePending above.
    if (!trashed && !fileRemainsOnDisk) {
      const checkPath = resolved.realPathRaw || mediaPathOnDisk || filePath;
      if (leafStillEnumerated(checkPath)) {
        let openable = false;
        try {
          fs.closeSync(fs.openSync(checkPath, 'r'));
          openable = true;
        } catch (_) { /* unopenable: the delete-pending signature */ }
        if (!openable) {
          deletePending = true;
          fileRemainsOnDisk = true;
          console.warn(`Delete: ${filePath} is STILL enumerated by its parent directory and refuses opens (server-side delete-pending: an open handle somewhere is pinning it) -- reporting honestly and minting a tombstone.`);
        }
        // (Enumerated + openable: the legacy mutator below mints its
        // unverified tombstone either way; the scan's mtime and fresh-db
        // checks decide what the surviving bytes are -- the v1.41.3 contract.)
      }
    }

    // v1.36.2 (Dean: "sticky post-deletion" -- the "comes back" half): make
    // DELETION authoritative for staying gone. "Delete stays gone" previously
    // relied entirely on the id already being in the shared download archive
    // from the ORIGINAL download -- but one-offs download with
    // --no-download-archive (their post-hoc append is best-effort and can
    // fail), and an archive file lost to an ephemeral volume has no entry, so
    // such a video was re-downloaded by the next subscription poll inside its
    // window. Appending here (idempotent, never-throws --
    // recordOneShotInArchive) closes that class for every yt-dlp-managed item
    // regardless of how it was originally downloaded. Scoped exactly like the
    // repull enumeration: rooted under a download dir AND carrying a
    // recoverable youtube id (filename [id] bracket, else the persisted
    // youtubeId re-checked through isSafeVideoId).
    try {
      const ytdlpConfig = ytdlp.parseYtdlpConfig();
      if (ytdlp.isEnabled(ytdlpConfig) && matchRootFolder(filePath, ytdlp.extraScanRoots(ytdlpConfig))) {
        const baseName = path.basename(filePath, path.extname(filePath));
        // v1.41.13: archive by the item's real SOURCE. A legacy YouTube item
        // keeps `youtube <id>` (from the [id] bracket or the persisted
        // youtubeId). A universal item records `<extractor> <sourceId>` -- the
        // RAW sourceId from metadata (authoritative, matches make_archive_id),
        // never the sanitized on-disk bracket (design D5). extractMediaRef also
        // recovers the source for a legacy-less item that carries the new bracket.
        const youtubeId = extractYtdlpVideoId(baseName) || (isSafeVideoId(item.youtubeId) ? item.youtubeId : null);
        if (youtubeId) {
          ytdlp.recordOneShotInArchive(ytdlpConfig, youtubeId, 'youtube');
        } else if (typeof item.sourceExtractor === 'string' && item.sourceExtractor !== '' && typeof item.sourceId === 'string' && item.sourceId !== '') {
          ytdlp.recordOneShotInArchive(ytdlpConfig, item.sourceId, item.sourceExtractor);
        }
      }
    } catch (err) {
      // Best-effort by contract -- a failed archive append must never block
      // the delete (the worst case is the pre-v1.36.2 behavior).
      console.error(`Delete: failed to record ${item.id} in the yt-dlp archive (continuing):`, err && err.message);
    }

    // LEGACY db cleanup -- only for the shapes trashItem did not handle
    // (resolver `gone`, vanished-mid-delete, removeAnyway): remove the entry
    // and mint the unverified tombstone. A successful trash move already did
    // all of this (and more) inside its own mutator. Idempotent under a
    // concurrent duplicate delete.
    if (!trashed) {
    try {
      await updateDatabase(freshDb => {
        delete freshDb.metadata[item.id];
        // Wave 2: the frozen pre-auth position goes with the item, inside this
        // save transaction (it was `delete freshDb.progress[item.id]`).
        inSaveTransaction(() => progressStore.remove(item.id));
        // (v1.42 gate W3: the view counter went with its item here as a doc
        // carry. Wave 1: relational - removed post-commit below with the
        // per-user rows; same reasons: unbounded growth under churn AND a stale
        // count resurrecting onto a same-path re-add = same md5 id.)
        // v1.41.3: mint the deletion tombstone in the SAME mutator that removes
        // the entry. Every shape that reaches this legacy mutator is an
        // UNVERIFIED conclusion by construction (v1.65: the verified case is
        // now a trash move, which never reaches here and never tombstones --
        // preserving the old contract's "a verified conclusion mints nothing"
        // rule at its new home). The scan's deferred-retry contract
        // (pruneDeleteTombstones' header) finishes these deletes -- and since
        // v1.65 the retry TRASHES the survivor rather than unlinking it.
        {
          // (Wave 2: the tombstone is a row in media_delete_tombstones, minted
          // INSIDE this mutator's save transaction - see the inSaveTransaction
          // call at the end of this block - so the "same mutator" atomicity of
          // v1.41.3 holds across the two tables.)
          // SEAM 2 (defense-in-depth): the tombstone is keyed by md5(storedPath),
          // but the scanner can only recompute md5(realDiskPath) -- and in this
          // whole bug class those two DIVERGE, so the scanner's direct key lookup
          // never matches and the tombstone sits dead for 90 days while the
          // survivor is re-indexed. Record the yt-dlp id too (the stable
          // invariant on BOTH the stored and the on-disk name) so the scan can
          // recover the match by id when SEAM 1 could not unlink at delete time
          // (a truly-unreadable parent -> removeAnyway, or an unforeseen
          // divergence). Same two-source trust order as the archive append above:
          // the stored basename's `[id]` bracket, else the persisted youtubeId
          // re-checked through isSafeVideoId. null for a non-yt-dlp file (its
          // secondary match never fires -- see the scan's SEAM 2 block).
          const tombstoneYoutubeId = extractYtdlpVideoId(path.basename(filePath, path.extname(filePath)))
            || (isSafeVideoId(item.youtubeId) ? item.youtubeId : null);
          // v1.41.13 (design D4): a non-YouTube item records its source ref too,
          // so the scan's SEAM-2 secondary match can bind a divergent-spelling
          // survivor by identity (same folder + ext, exactly like the YouTube
          // id match). The bracket observed at delete time is stored alongside
          // the raw ref -- SEAM-2 matches on the bracket pair (both sides read
          // dirents -> both sanitized), never raw-vs-bracket (design D5).
          const deleteBracket = extractMediaRef(path.basename(filePath, path.extname(filePath)));
          // gate CRITICAL C1: the bracketId is ALWAYS the delete-time bracket id
          // when a sourceRef is built. The old `!tombstoneYoutubeId` guard
          // conflated "has a youtubeId" with "on-disk bracket is legacy 11-char"
          // -- FALSE for a D1a proxy-host item (yewtu.be), whose youtubeId IS set
          // but whose on-disk bracket is the universal `[Youtube=id]` shape,
          // matchable ONLY by SEAM-2's universal (bracket) branch. Suppressing
          // bracketId there disabled BOTH match paths -> the deleted proxy-host
          // video RESURRECTED. A pure-YouTube item never builds a sourceRef
          // (no sourceExtractor/sourceId), so this is a no-op on the YouTube path.
          const tombstoneSourceRef = (item.sourceExtractor && item.sourceId)
            ? { extractor: item.sourceExtractor, id: item.sourceId, bracketId: deleteBracket ? deleteBracket.id : undefined }
            : null;
          const tombstone = {
            filePath, deletedAt: Date.now(), youtubeId: tombstoneYoutubeId,
            ...(tombstoneSourceRef ? { sourceRef: tombstoneSourceRef } : {}),
          };
          const tombstoneId = item.id;
          inSaveTransaction(() => {
            tombstoneStore.set(tombstoneId, tombstone);
            tombstoneStore.prune();
          });
        }
        // tech-debt #5 (v1.30-era): mirror the scan-prune path so a
        // manually-deleted recently-served video doesn't strand a
        // persistedServedAt Map entry until id-reuse/restart.
        clearPersistedServedAt(item.id);
        return true;
      });
    } catch (err) {
      // Express 4 does not catch a rejected async-handler promise, so a
      // rejection left unguarded here would hang the request instead of
      // returning 500. The file (and its thumbnail/transcode sidecar) is
      // already gone from disk at this point -- only the db-metadata cleanup
      // failed to persist.
      console.error(`Error updating database after deleting ${filePath}:`, err);
      return res.status(500).json({ error: `File deleted from disk but failed to update database: ${err.message}` });
    }

    // v1.43: the per-user rows (user_progress/user_liked) are id-keyed carriers
    // exactly like the frozen progress row and the view-count row above, and go with the item for
    // the same two reasons (unbounded growth under churn; stale state
    // resurrecting onto a future re-add of the same path = same md5 id).
    // AFTER the doc-table commit (the rekeyInFlightState posture): a rolled-
    // back delete must never have already destroyed users' positions. A crash
    // in this tiny window leaves orphan rows whose only effect is that a
    // re-add of the exact same path resumes where users left off -- benign,
    // and the flush guard never writes new rows for a metadata-less id.
    try {
      userStore.removeMediaState(item.id);
    } catch (err) {
      console.error(`Delete: failed to remove per-user progress/liked for ${item.id} (continuing):`, err.message);
    }
    // Wave 1: the relational view counter goes with its item (post-commit,
    // same posture as the per-user rows above).
    try {
      viewCountStore.remove(item.id);
    } catch (err) {
      console.error(`Delete: failed to remove the view count for ${item.id} (continuing):`, err.message);
    }
    } // end !trashed (a trash move re-keyed the carriers instead of removing them)

    if (fileRemainsOnDisk) {
      return res.json({
        success: true,
        fileRemainsOnDisk: true,
        ...(trashed ? { trashed: true, trashId: trashedId } : {}),
        ...(deletePending ? { deletePending: true } : {}),
        message: deletePending
          ? 'Removed from your library, but the storage side reports the file is still held open (by another program or device), so it stays on disk until that handle closes. Library scans will keep it hidden and keep retrying the deletion.'
          : trashed
            ? 'Moved to Trash, but the original location still shows the file -- the next library scan will finish the cleanup.'
            : 'Removed from your library. Note: the file itself could not be deleted -- the next library scan will retry the deletion once; if it still cannot be deleted, it will reappear.',
      });
    }

    if (trashed) {
      return res.json({ success: true, trashed: true, trashId: trashedId, message: 'Moved to Trash' });
    }
    res.json({ success: true, message: 'File deleted successfully' });
  });
}

// POST /api/videos/:id/move, registered where it sat in server.js - AFTER the
// trash routes and after the site where `moveItemToFolder` was declared, which
// since slice S5 is server.js's `createMoveOps` call (lib/media/move.js). Its
// collaborators - `configuredLibraryRoots`, `hashFileStreaming`,
// `rekeyInFlightState` - stay in server.js and cross into that factory.
function registerMoveRoute(app, deps) {
  const {
    getMediaId,
    loadDatabase,
    moveItemToFolder, // lib/media/move.js's collision-safe file mover (slice S5)
    refuseIfReadOnlyMedia,
    requireModifyLibrary,
    restrictedVideoMutation,
    updateDatabase,
  } = deps;

  // API: Move a video/audio file into another configured library folder (C1).
  // Body: `{ targetFolder }`. See `moveItemToFolder`'s own comment for the full
  // confinement + id re-key design -- this route is a thin HTTP wrapper around
  // it. T19 (Wave 7, B2 Phase 2) calls `moveItemToFolder` directly for its own
  // physical-reconcile move, without going through this route.
  app.post('/api/videos/:id/move', async (req, res) => {
    if (!requireModifyLibrary(req, res)) return; // v1.81 write-RBAC (first guard)
    if (restrictedVideoMutation(req, res, req.params.id)) return; // v1.80 RBAC
    if (refuseIfReadOnlyMedia(res)) return; // v1.42 safe-mode lever (AC8)
    const targetFolder = req.body && req.body.targetFolder;
    let result;
    try {
      result = await moveItemToFolder({ loadDatabase, updateDatabase, getMediaId }, req.params.id, targetFolder);
    } catch (err) {
      console.error(`Error moving file ${req.params.id}:`, err);
      return res.status(500).json({ error: `Could not move file: ${err.message}` });
    }
    if (!result.ok) {
      return res.status(result.status || 500).json({ error: result.error });
    }
    res.json({ success: true, id: result.newId, filePath: result.newPath });
  });
}

// GET /api/library-items, registered where it sat in server.js - between
// GET /api/storage-summary and the critters pool, both of which stay.
function registerLibraryItemsRoute(app, deps) {
  const {
    getCachedDatabase,
    mediaVisibleTo,
    withEffectiveViewCounts, // overlays the per-user view-count store onto db.metadata
  } = deps;

  // v1.159 (Dean): the flat, VISIBILITY-SCOPED A/V item list backing the Stats
  // "Videos & audio" sortable table - a restricted member never sees a hidden
  // item's title/size (scoped exactly like /api/stats: withEffectiveViewCounts +
  // mediaVisibleTo). A lean payload (id/title/type/duration/size only, no
  // filePath) sorted client-side; GATED in the read census.
  app.get('/api/library-items', (req, res) => {
    const db = getCachedDatabase();
    const withVc = withEffectiveViewCounts(db);
    const items = [];
    for (const id of Object.keys(withVc)) {
      const it = withVc[id];
      if (!mediaVisibleTo(req, it)) continue;
      items.push({
        id,
        title: (it.title || it.name || '').toString(),
        type: it.type === 'audio' ? 'audio' : 'video',
        durationSeconds: Number(it.duration) || 0,
        sizeBytes: Number(it.size) || 0,
      });
    }
    res.json({ items, total: items.length });
  });
}

// GET /api/critters (the pool listing the client's critter engine reads),
// registered where it sat in server.js: after `crittersDir` and the two pool
// projections it is handed, and BEFORE the upload vocabulary the management
// routes need - which is why it registers separately from them (see the TDZ
// note in the header).
function registerCritterListingRoute(app, deps) {
  const {
    buildCritterListing, // the pool projection the client engine consumes
    buildCritterVoicePool, // the FLAT sorted sound-URL pool (the random-tap picker's source)
    crittersDir, // resolves against server.js's __dirname, so it cannot move here
    fs,
  } = deps;

  app.get('/api/critters', (req, res) => {
    const dir = crittersDir();
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name);
    } catch (_) {
      // Missing/unreadable folder is a NORMAL state (fresh install) - empty list,
      // the client falls back to its built-in figurines.
      return res.json({ critters: [], voicePool: [] });
    }
    res.json({ critters: buildCritterListing(entries), voicePool: buildCritterVoicePool(entries) });
  });
}

// The critters MANAGEMENT routes, the aggregate reads and the per-item
// mutations, registered where POST /api/critters/upload sat in server.js -
// the first position at which every constant this bundle is handed has been
// initialized. The routes between here and GET /api/transcript/:id were
// already contiguous in server.js, so one call covers them all: the upload /
// delete-item / delete-all / archive management routes, Stats, the duplicates
// report and its CSV, the view / dimensions / chapters mutations, the manual
// channel-attribution cluster (its private helpers moved with it), and the
// subtitles + transcript sidecar reads.
function registerLibraryRoutes(app, deps) {
  const {
    APP_VERSION,
    CRITTER_IMAGE_EXTS,
    CRITTER_SOUND_EXTS,
    CRITTER_UPLOAD_EXT_FOR_MIME,
    CRITTER_UPLOAD_IMAGE_TYPES,
    CRITTER_UPLOAD_SOUND_TYPES,
    MAX_MEDIA_DIMENSION,
    REPO_URL,
    bookVisibleTo,
    booksDb,
    buildStoreZip,
    configuredLibraryRoots, // the bulk selector's root confinement
    crittersDir, // resolves against server.js's __dirname, so it cannot move here
    express, // the critters upload's route-scoped express.raw parser
    extractYtdlpVideoId,
    folderStore,
    fs,
    getCachedDatabase,
    getMediaId,
    isPrimitiveNumericInput,
    isValidMediaDimension,
    likedStore,
    loadDatabase,
    matchRootFolder,
    mediaVisiblePredicate, // the restriction-aware predicate the bulk selector filters on
    mediaVisibleTo,
    moveItemToFolder, // lib/media/move.js's collision-safe file mover (slice S5)
    musicDb,
    parseChapterLines,
    path,
    progressStore,
    refuseIfReadOnlyMedia,
    requireAdmin,
    requireModifyLibrary,
    resolveItemChapters,
    restrictedVideoMutation,
    sanitizeCritterUploadName,
    settingsStore,
    stats, // lib/stats - the pure aggregation helpers behind GET /api/stats
    subtitles, // lib/subtitles - srtToVtt + findSubtitleSidecar
    tombstoneStore,
    trackVisibleTo,
    transcript, // lib/transcript - the sidecar as plain text
    ttsAvailable,
    ttsConfig,
    ttsEngineVersion, // LIVE reader: a server.js `let` an async probe fills in after boot
    updateDatabase,
    userStore,
    validateChannelUrl, // lib/ytdlp/url - the one channel-URL gate the capture path uses
    viewCountStore,
    visibleMetadataFor, // the duplicates report's restriction-scoped metadata view
    withEffectiveViewCounts, // overlays the per-user view-count store onto db.metadata
    ytdlp,
    ytdlpDb,
  } = deps;

  const CRITTER_UPLOAD_MAX_BYTES = 25 * 1024 * 1024; // the express.raw ceiling (images)
  const CRITTER_SOUND_MAX_BYTES = 10 * 1024 * 1024; // sounds are tap chirps - tighter

  // Directory entries the manager owns: REGULAR files with a critter image or
  // sound extension. README.md, subfolders, symlinks, and stray files are never
  // touched by delete-all/archive, and delete-item can never match them.
  function listCritterFiles() {
    return fs.readdirSync(crittersDir(), { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name)
      .filter((n) => {
        const ext = path.extname(n).toLowerCase();
        return CRITTER_IMAGE_EXTS.has(ext) || CRITTER_SOUND_EXTS.has(ext);
      });
  }

  app.post(
    '/api/critters/upload',
    // NOTE (QA S6, disclosed): express.raw buffers up to 25 MB BEFORE the admin
    // check answers - an authenticated member can cost that buffering per
    // request. Faithful mirror of the logo route's posture (1 MB there);
    // authenticated-only, accepted.
    express.raw({
      type: Object.keys(CRITTER_UPLOAD_EXT_FOR_MIME),
      limit: CRITTER_UPLOAD_MAX_BYTES,
    }),
    (req, res) => {
      if (!requireAdmin(req, res)) return;
      const mime = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      const validator = CRITTER_UPLOAD_IMAGE_TYPES[mime] || CRITTER_UPLOAD_SOUND_TYPES[mime];
      if (!validator) {
        return res.status(400).json({ error: 'Unsupported type. Images: PNG, JPEG, WebP, GIF. Sounds: MP3, WAV, M4A, OGG.' });
      }
      const name = sanitizeCritterUploadName(req.query.name, mime);
      if (!name) {
        return res.status(400).json({ error: 'Bad file name (plain names only, extension matching the file type).' });
      }
      const bytes = req.body;
      if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
        return res.status(400).json({ error: 'Empty upload' });
      }
      if (CRITTER_UPLOAD_SOUND_TYPES[mime] && bytes.length > CRITTER_SOUND_MAX_BYTES) {
        return res.status(413).json({ error: 'Sound too large (max 10 MB).' });
      }
      if (!validator(bytes)) {
        return res.status(400).json({ error: 'File content does not match its declared type' });
      }
      const dir = crittersDir();
      const target = path.join(dir, name);
      if (path.dirname(target) !== dir) {
        // Unreachable after sanitize; belt per the logo route's posture.
        return res.status(400).json({ error: 'Bad file name' });
      }
      // tmp+rename (atomic; a mid-upload scatter never sees a half-written file -
      // the .tmp suffix is outside both extension sets, invisible to the listing).
      const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
      try {
        fs.mkdirSync(dir, { recursive: true }); // fresh install: the folder may not exist yet
        fs.writeFileSync(tmp, bytes);
        fs.renameSync(tmp, target);
      } catch (err) {
        try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch { /* best-effort */ }
        console.error('Error saving critter upload:', err);
        return res.status(500).json({ error: `Could not save file: ${err.message}` });
      }
      return res.json({ ok: true, name });
    },
    (err, req, res, next) => {
      if (err && (err.type === 'entity.too.large' || err.status === 413)) {
        return res.status(413).json({ error: 'File too large (images max 25 MB, sounds max 10 MB).' });
      }
      return next(err);
    },
  );

  app.delete('/api/critters/item', (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = typeof req.query.id === 'string' ? req.query.id : '';
    if (!id) return res.status(400).json({ error: 'Missing id' });
    let names = [];
    try { names = listCritterFiles(); } catch (_) {
      return res.status(404).json({ error: 'No critters folder' });
    }
    // Resolve against ACTUAL directory entries with the listing's own basename
    // rule (raw extname strip) - the caller's string is never joined into a
    // path; only matched real entries are. The image and its paired sound go
    // together (they are one critter).
    const matches = names.filter((n) => path.basename(n, path.extname(n)) === id);
    if (!matches.length) return res.status(404).json({ error: 'No such critter' });
    const deleted = [];
    for (const n of matches) {
      try {
        fs.unlinkSync(path.join(crittersDir(), n));
        deleted.push(n);
      } catch (err) {
        console.error('Error deleting critter file:', err);
        return res.status(500).json({ error: `Could not delete ${n}: ${err.message}`, deleted });
      }
    }
    return res.json({ ok: true, deleted });
  });

  app.delete('/api/critters/all', (req, res) => {
    if (!requireAdmin(req, res)) return;
    let names = [];
    try { names = listCritterFiles(); } catch (_) {
      return res.json({ ok: true, deleted: 0 }); // no folder = nothing to delete
    }
    let deleted = 0;
    for (const n of names) {
      try {
        fs.unlinkSync(path.join(crittersDir(), n));
        deleted += 1;
      } catch (err) {
        console.error('Error deleting critter file:', err);
        return res.status(500).json({ error: `Could not delete ${n}: ${err.message}`, deleted });
      }
    }
    return res.json({ ok: true, deleted });
  });

  app.get('/api/critters/archive', (req, res) => {
    if (!requireAdmin(req, res)) return;
    let names = [];
    try { names = listCritterFiles(); } catch (_) { names = []; }
    const entries = [];
    for (const n of names.sort()) {
      try { entries.push({ name: n, data: fs.readFileSync(path.join(crittersDir(), n)) }); }
      catch (err) { console.error('Error reading critter file for archive:', err); }
    }
    // The pool is a handful of figurine images - whole-buffer assembly is fine
    // (a 16-critter obscene pool of 5 MB PNGs is ~80 MB worst case, one-shot,
    // admin-only; not a streaming surface).
    const zip = buildStoreZip(entries);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="critters.zip"');
    return res.send(zip);
  });

  app.get('/api/stats', (req, res) => {
    const db = getCachedDatabase(); // v1.30 A3: pure read on a request/serve path
    const books = booksDb.read();
    // v1.41.0 (Dean): the Stats page is now the whole-library + About hub --
    // fold in book inventory and the version/links "system" block. yt-dlp version
    // moved here from the Subscriptions page; rows the client hides when a thing
    // isn't installed (ytdlp not enabled -> null; TTS not available).
    const ytdlpEnabled = ytdlp.isEnabled(ytdlp.parseYtdlpConfig());
    const music = musicDb.read();
    // v1.80 RBAC (security-gate finding): stats leaked restricted-item TITLES
    // (mostWatched) and COUNTS to a restricted member. Filter the CONTENT
    // namespaces to what req.user may see before computing; admin's empty index
    // filters nothing (byte-unchanged). Other namespaces (progress/liked/folders/
    // users) are user-state/config counts, not content titles.
    // withEffectiveViewCounts returns the metadata MAP itself (id -> item), and
    // computeLibraryStats/computeInventory take that map directly.
    const withVc = withEffectiveViewCounts(db);
    const visibleMetadata = {};
    for (const id of Object.keys(withVc)) {
      if (mediaVisibleTo(req, withVc[id])) visibleMetadata[id] = withVc[id];
    }
    const visibleTracks = {};
    for (const id of Object.keys(music.tracks || {})) {
      if (trackVisibleTo(req, music.tracks[id])) visibleTracks[id] = music.tracks[id];
    }
    const visibleBookItems = {};
    for (const id of Object.keys(books.items || {})) {
      if (bookVisibleTo(req, books.items[id])) visibleBookItems[id] = books.items[id];
    }
    // v1.81 (#127a): the inventory's watch-aggregate + folder sub-counts shipped
    // RAW - v1.80 scoped the content TITLES/counts but left progress/viewCounts/
    // liked/folders/tombstones/users global, so a restricted member could infer
    // hidden content by VOLUME and see other users' watch totals. For a non-admin,
    // every count is scoped to their VISIBLE library and their OWN watch data;
    // the account roster (system-only) goes null and the stats client omits its
    // row. Admin path stays BYTE-IDENTICAL (empty index visibleMetadata == all).
    const isAdmin = !!(req.user && req.user.role === 'admin');
    const has = (map, id) => Object.prototype.hasOwnProperty.call(map, id);
    const pickVisible = (obj, visMap) => {
      const out = {};
      for (const id of Object.keys(obj || {})) if (has(visMap, id)) out[id] = obj[id];
      return out;
    };
    const distinctRoots = (visMap) => {
      const roots = new Set();
      for (const id of Object.keys(visMap)) { const rf = visMap[id].rootFolder; if (rf) roots.add(rf); }
      return Array.from(roots);
    };
    let inventoryInput;
    if (isAdmin) {
      inventoryInput = {
        metadata: visibleMetadata, progress: progressStore.getAll(), viewCounts: viewCountStore.getAll(), // Waves 1-2: the tables
        liked: likedStore.list(), deleteTombstones: tombstoneStore.getAll(), folders: folderStore.list(), // Wave 4
        books: { items: visibleBookItems, progress: books.progress, audio: books.audio },
        music: { tracks: visibleTracks, folders: music.folders },
        users: userStore.countUsers(),
      };
    } else {
      const uid = req.user.id;
      // Tombstones only for items the member could have seen (v1.65 trash shape
      // carries `.item`; a legacy tombstone is flat).
      const scopedTombstones = {};
      const allTombstones = tombstoneStore.getAll(); // Wave 2: the table
      for (const id of Object.keys(allTombstones)) {
        const t = allTombstones[id];
        const probe = t && t.item ? t.item : t;
        if (probe && mediaVisibleTo(req, probe)) scopedTombstones[id] = t;
      }
      inventoryInput = {
        metadata: visibleMetadata,
        progress: pickVisible(userStore.getProgress(uid), visibleMetadata), // THEIR own positions, visible only
        viewCounts: pickVisible(viewCountStore.getAll(), visibleMetadata), // global counters (the table), visible items only
        liked: userStore.getLiked(uid).filter((id) => has(visibleMetadata, id)),
        deleteTombstones: scopedTombstones,
        folders: distinctRoots(visibleMetadata),                           // never the raw configured-root list
        books: { items: visibleBookItems, progress: pickVisible(userStore.getBookProgress(uid), visibleBookItems), audio: pickVisible(books.audio, visibleBookItems) },
        music: { tracks: visibleTracks, folders: distinctRoots(visibleTracks) },
        users: null, // system-only: omitted from a non-admin's inventory
      };
    }
    const inventory = stats.computeInventory(inventoryInput);
    if (!isAdmin) inventory.users = null; // computeInventory coerces null->0; restore the "omit" signal for the client
    res.json({
      ...stats.computeLibraryStats(visibleMetadata),
      books: stats.computeBookStats(visibleBookItems, books.audio),
      // v1.44.3 (Dean): the "what's in my database" inventory — a plain count of
      // each persisted namespace (mirrors what the backup bundle carries).
      inventory,
      system: {
        version: APP_VERSION,
        repoUrl: REPO_URL,
        // v1.146: `engine` names WHICH engine the version belongs to - the
        // version cache probes the ACTIVE binary (the ruling: About/Stats
        // reports the active engine, never just the image ENV).
        ytdlp: { enabled: ytdlpEnabled, version: ytdlpEnabled ? ytdlp.getCachedYtdlpVersion() : null, engine: ytdlpEnabled ? ytdlp.getEngineSummary() : null },
        tts: { available: ttsAvailable(), engine: ttsConfig.engine, version: ttsEngineVersion() }, // S10a live seam: a destructured value would freeze at null
      },
    });
  });

  // v1.41.11 (Dean: "see files that are truly duplicates so I can clean them
  // up -- wasted storage"): the duplicates report. Same posture as /api/stats
  // directly above -- a pure O(n) transform over db.metadata per request (see
  // computeDuplicateReport's header in lib/stats.js for the two sections and
  // the injected-extractor contract). READ-ONLY by design: no delete actions
  // anywhere on this surface (Dean's no-data-loss norm); he cleans up by hand.
  app.get('/api/duplicates', (req, res) => {
    const db = getCachedDatabase(); // pure read on a request path (v1.30 A3)
    // v1.128 Wave B (L6): this report is rendered on the member-reachable stats
    // page, so it can't be admin-gated - but it emitted abs filePaths + counts
    // over RAW db.metadata. Scope to the requester's visible items (the /api/stats
    // posture); admin + unrestricted member see the byte-identical full report.
    res.json(stats.computeDuplicateReport(visibleMetadataFor(req, db.metadata), { extractVideoId: extractYtdlpVideoId }));
  });

  // The same report as a downloadable CSV (Dean: "exportable output"). Static
  // ASCII filename -- contentDispositionAttachment is for media titles; nothing
  // here needs RFC 5987. One row per file, section-tagged; see
  // duplicateReportToCsv for the quoting + formula-defusal contract.
  // Synchronous O(n) on the request thread, same posture as /api/stats above --
  // the v1.41.11 gate probed a pathological 100k-item library at ~390ms report
  // + ~230ms CSV, acceptable at home-server scale; revisit only if libraries
  // grow an order of magnitude past that.
  app.get('/api/duplicates.csv', (req, res) => {
    const db = getCachedDatabase();
    // v1.128 Wave B (L7): same visibility scope as /api/duplicates above - the
    // CSV file_path column emitted abs paths of hidden items.
    const csv = stats.duplicateReportToCsv(stats.computeDuplicateReport(visibleMetadataFor(req, db.metadata), { extractVideoId: extractYtdlpVideoId }));
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename="filetube-duplicates.csv"');
    res.send(csv);
  });

  app.post('/api/videos/:id/view', async (req, res) => {
    if (restrictedVideoMutation(req, res, req.params.id)) return; // v1.80 RBAC
    // Wave 1: the counter is a relational row, so a view no longer rides the
    // doc-model write chain (no load-mutate-save of the whole library for one
    // integer). Existence is checked on the read cache (hasOwnProperty - the
    // #220 guard shape, so `__proto__` is "not found", never a prototype
    // walk); the increment is ONE atomic upsert that honors the legacy embedded
    // floor the first time an id is counted. No in-process race with a delete:
    // saveDatabase swaps the read cache synchronously inside the chain tick and
    // the carrier remove() runs in its await continuation before any new request
    // macrotask, so a view that lands after the delete 404s (measured: 30 views
    // racing a DELETE, all 404, no orphan). The only orphan window is a CRASH
    // between the doc commit and remove() - the per-user carriers' documented
    // class - and it resumes a same-path re-add's count, disclosed with #224.
    const db = getCachedDatabase();
    const id = req.params.id;
    const item = db.metadata && Object.prototype.hasOwnProperty.call(db.metadata, id) ? db.metadata[id] : undefined;
    if (!item) return res.status(404).json({ error: 'Media file not found' });
    let viewCount = 0;
    try {
      viewCount = viewCountStore.increment(id, { floor: item.viewCount });
    } catch (err) {
      console.error(`Error recording view for ${id}:`, err);
      return res.status(500).json({ error: `Could not record view: ${err.message}` });
    }
    // v1.68 (Dean rulings 1-2): a play retires the player's own notification -
    // the view ping is THE play-start signal (once per watch load, every web
    // surface), so the bell row for this media leaves THIS user's panel and
    // badge here, server-side. Deliberately NOT behind the bell's feature
    // gate: the gate governs the panel surface, and a play while the bell is
    // off must still dismiss so re-enabling it later cannot resurrect rows
    // for already-watched videos. Best-effort: hygiene must never fail the
    // ping (its suite locks the response contract).
    try {
      userStore.dismissNotificationByMedia(req.user.id, req.params.id, Date.now());
    } catch (err) {
      console.error(`Notification dismiss-on-play failed for ${req.params.id}:`, err && err.message);
    }
    res.json({ success: true, viewCount });
  });

  // API: lazy per-item dimensions backfill (Feature A, v1.26.1, Shorts
  // player-size jump). The scan only ever captures `width`/`height` on a
  // video's initial (new/updated-file) probe -- see the comment above
  // `newMetadata[id].width = meta.width` -- so any item indexed before this
  // release, or whose original probe failed to yield usable dims, has none.
  // Rather than a library-wide re-probe sweep on upgrade (the exact class of
  // regression the thumbnail-backfill lesson warns against), the PLAYER
  // itself calls this once it has genuinely observed the real dimensions
  // (`<video>`'s own `videoWidth`/`videoHeight` at `loadedmetadata`,
  // player.js) -- so the FIRST play of a legacy item settles late (same as
  // today) but the SECOND play is jump-free. Fire-and-forget from the client:
  // this endpoint's own success/failure never affects playback.
  //
  // Validates: a positive-integer, sane-bounded (`isValidMediaDimension`,
  // shared with the ffprobe-side parse above) width/height; the item exists;
  // the item is a VIDEO (never audio -- mirrors the scan's own `!isAudio`
  // guard). No-clobber: an item that already carries BOTH `width` and
  // `height` is left completely untouched -- this endpoint only ever fills a
  // gap, exactly like the release-date/hasSubtitles backfills elsewhere in
  // this file. A malformed/late-arriving/duplicate POST (e.g. a stray second
  // `loadedmetadata` firing for the same load) is therefore always safe to
  // retry: it either fills the gap once or silently no-ops.
  app.post('/api/videos/:id/dimensions', async (req, res) => {
    if (restrictedVideoMutation(req, res, req.params.id)) return; // v1.80 RBAC
    const body = req.body || {};
    // F3: reject a non-primitive-numeric body BEFORE Number() ever runs -- see
    // isPrimitiveNumericInput's own comment for exactly which shapes this
    // guards against ([1920], true, '0x10', etc.).
    if (!isPrimitiveNumericInput(body.width) || !isPrimitiveNumericInput(body.height)) {
      return res.status(400).json({ error: `width and height must be positive integers <= ${MAX_MEDIA_DIMENSION}` });
    }
    const width = Number(body.width);
    const height = Number(body.height);
    if (!isValidMediaDimension(width) || !isValidMediaDimension(height)) {
      return res.status(400).json({ error: `width and height must be positive integers <= ${MAX_MEDIA_DIMENSION}` });
    }
    let notFound = false;
    let wrongType = false;
    let applied = false;
    try {
      await updateDatabase(db => {
        const item = db.metadata[req.params.id];
        if (!item) {
          notFound = true;
          return false;
        }
        if (item.type !== 'video') {
          wrongType = true;
          return false;
        }
        if (item.width && item.height) {
          return false; // no-clobber: dims already known -- nothing to do
        }
        item.width = width;
        item.height = height;
        applied = true;
        return true;
      });
    } catch (err) {
      // Express 4 does not catch a rejected async-handler promise, so a
      // rejection left unguarded here would hang the request instead of
      // returning 500 (mirrors POST /api/videos/:id/view's own pattern above).
      console.error(`Error recording dimensions for ${req.params.id}:`, err);
      return res.status(500).json({ error: `Could not record dimensions: ${err.message}` });
    }
    if (notFound) return res.status(404).json({ error: 'Media file not found' });
    if (wrongType) return res.status(400).json({ error: 'Dimensions only apply to video items' });
    res.json({ success: true, applied });
  });

  // v1.34 T3 (Dean): the per-video CHAPTERS EDITOR endpoint. The client posts
  // the editor textarea's RAW TEXT (one "0:00 Title" line per chapter -- the
  // same grammar description parsing uses; parseChapterLines is the single
  // grammar owner) and the parsed result is stored as `chaptersManual` --
  // MANUAL ALWAYS WINS at serve time (resolveItemChapters). Empty/whitespace
  // text CLEARS the manual list (falling back to embedded/description).
  // Mirrors the dimensions route's exact updateDatabase + async-rejection
  // pattern above. The scan never writes chaptersManual, and the Phase-2
  // final-merge guard mirrors it from the fresh db unconditionally, so an
  // edit landing mid-scan can never be reverted.
  app.post('/api/videos/:id/chapters', async (req, res) => {
    if (!requireModifyLibrary(req, res)) return; // v1.81 write-RBAC (first guard)
    if (restrictedVideoMutation(req, res, req.params.id)) return; // v1.80 RBAC
    const body = req.body || {};
    if (typeof body.text !== 'string') {
      return res.status(400).json({ error: 'text must be a string (one "0:00 Title" line per chapter; empty to clear)' });
    }
    if (body.text.length > 20000) {
      return res.status(400).json({ error: 'Chapter text too large (max 20000 characters)' });
    }
    const clearing = body.text.trim() === '';
    const parsed = clearing ? [] : parseChapterLines(body.text);
    if (!clearing && parsed.length === 0) {
      return res.status(400).json({ error: 'No valid chapter lines found — use one "0:00 Title" line per chapter' });
    }
    let notFound = false;
    let resolved = null;
    try {
      await updateDatabase(db => {
        const item = db.metadata[req.params.id];
        if (!item) {
          notFound = true;
          return false;
        }
        if (clearing) {
          if ('chaptersManual' in item) delete item.chaptersManual;
        } else {
          item.chaptersManual = parsed;
        }
        resolved = resolveItemChapters(item);
        return true;
      });
    } catch (err) {
      console.error(`Error saving chapters for ${req.params.id}:`, err);
      return res.status(500).json({ error: `Could not save chapters: ${err.message}` });
    }
    if (notFound) return res.status(404).json({ error: 'Media file not found' });
    res.json({ success: true, ...resolved });
  });

  // ---- v1.53: manual channel attribution -------------------------------------
  //
  // Dean's escape hatch for the class the reheat machinery structurally cannot
  // solve: a renamed/dead channel means no network re-pull will ever attribute
  // a MeTube-era import. The identity is written as a UNIT with the STICKY
  // `channelAttributedManually` flag (manual wins forever, decision 3 -- every
  // automatic identity writer now checks it), and the endpoint returns a
  // relocation PROPOSAL only; the physical move is the client's explicit
  // confirm through the EXISTING move endpoint (never a silent file move).

  // The picker's data: subscriptions + distinct identity groups already in the
  // library (covers dead channels whose earlier downloads were attributed at
  // capture time). Deduped by channelId when both sides know one, else by
  // channelUrl. Read-only over the cache.
  // v1.202: the attribution routes (three of the four; cancel is exempt, below) are OFF unless
  // settings.attributeControlEnabled (the Experimental opt-in). On the two
  // MUTATING routes the check sits AFTER the RBAC guard so a member still gets
  // the 403 the nets expect and an admin with the flag off gets a plain 404 -
  // "off" is real, not a hidden button. The target-list GET never had an admin
  // guard (a restriction-filtered read): everyone gets 404 while off. The bulk CANCEL route is deliberately NOT gated: a
  // job started while the flag was on must stay abortable after it is
  // turned off.
  function attributionFeatureOff(res) {
    if (settingsStore.getKey('attributeControlEnabled') === true) return false; // Wave 4
    res.status(404).json({ error: 'Not found' });
    return true;
  }

  app.get('/api/attribution-targets', (req, res) => {
    if (attributionFeatureOff(res)) return; // v1.202 (a read-only target list, but part of the same opt-in surface)
    const db = getCachedDatabase();
    const byUrl = new Map();
    const seenChannelIds = new Set();
    const addTarget = (t) => {
      if (byUrl.has(t.channelUrl)) {
        const existing = byUrl.get(t.channelUrl);
        if (!existing.channelAvatarUrl && t.channelAvatarUrl) existing.channelAvatarUrl = t.channelAvatarUrl;
        return;
      }
      if (t.channelId && seenChannelIds.has(t.channelId)) return; // same channel, other URL form
      byUrl.set(t.channelUrl, t);
      if (t.channelId) seenChannelIds.add(t.channelId);
    };
    const subs = ytdlpDb.readPart('subscriptions'); // Wave 5: from its table
    for (const sub of subs) {
      if (!sub || typeof sub.channelUrl !== 'string' || sub.channelUrl === '') continue;
      addTarget({
        channelUrl: sub.channelUrl,
        channelName: (typeof sub.name === 'string' && sub.name !== '') ? sub.name : sub.channelUrl,
        ...(typeof sub.channelId === 'string' && sub.channelId !== '' ? { channelId: sub.channelId } : {}),
        ...(typeof sub.channelHandleUrl === 'string' && sub.channelHandleUrl !== '' ? { channelHandleUrl: sub.channelHandleUrl } : {}),
        ...(typeof sub.channelAvatarUrl === 'string' && sub.channelAvatarUrl !== '' ? { channelAvatarUrl: sub.channelAvatarUrl } : {}),
        source: 'subscription',
      });
    }
    for (const item of Object.values(db.metadata || {})) {
      if (!item || typeof item.channelUrl !== 'string' || item.channelUrl === '') continue;
      // v1.128 Wave B (L8): the library-sourced arm emitted channelName /
      // folderName for EVERY item, so a restricted member (the attribute-channel
      // dialog is a library-edit feature) learned the channel/folder names of
      // content hidden from them. Skip items they cannot see; the
      // subscription-sourced arm above is the shared channel REGISTRY (by design,
      // the tech-debt #150 class) and is left as-is.
      if (!mediaVisibleTo(req, item)) continue;
      addTarget({
        channelUrl: item.channelUrl,
        channelName: (typeof item.channelName === 'string' && item.channelName !== '') ? item.channelName : (item.folderName || item.channelUrl),
        ...(typeof item.channelId === 'string' && item.channelId !== '' ? { channelId: item.channelId } : {}),
        ...(typeof item.channelHandleUrl === 'string' && item.channelHandleUrl !== '' ? { channelHandleUrl: item.channelHandleUrl } : {}),
        ...(typeof item.channelAvatarUrl === 'string' && item.channelAvatarUrl !== '' ? { channelAvatarUrl: item.channelAvatarUrl } : {}),
        source: 'library',
      });
    }
    const targets = [...byUrl.values()].sort((a, b) => a.channelName.toLowerCase().localeCompare(b.channelName.toLowerCase()));
    res.json({ targets });
  });

  // Validate an attribution target's identity at the write boundary through
  // the SAME single gates the capture path uses. Returns {ok, identity|error}.
  function sanitizeAttributionTarget(t) {
    if (!t || typeof t !== 'object' || Array.isArray(t)) return { ok: false, error: 'target must be an object (or pass clear: true)' };
    const check = validateChannelUrl(t.channelUrl);
    if (!check.ok) return { ok: false, error: 'target.channelUrl is not a valid channel URL' };
    // eslint-disable-next-line no-control-regex
    const name = typeof t.channelName === 'string' ? t.channelName.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 200) : '';
    if (name === '') return { ok: false, error: 'target.channelName is required' };
    const identity = { channelUrl: check.url, channelName: name };
    if (typeof t.channelId === 'string' && ytdlp.CHANNEL_ID_PATTERN.test(t.channelId)) identity.channelId = t.channelId;
    if (typeof t.channelHandleUrl === 'string') {
      const handle = validateChannelUrl(t.channelHandleUrl);
      if (handle.ok && handle.url !== identity.channelUrl) identity.channelHandleUrl = handle.url;
    }
    const avatar = ytdlp.sanitizeChannelAvatarUrl(t.channelAvatarUrl);
    if (avatar) identity.channelAvatarUrl = avatar;
    return { ok: true, identity };
  }

  // Applies one manual attribution (or clear) to an item INSIDE a running
  // mutator. Shared by the single and bulk endpoints -- the v1.41.4 one-helper
  // discipline. Returns 'attributed' | 'cleared' | 'not-manual' | 'missing'.
  function applyManualAttribution(item, identity, clearing) {
    if (!item) return 'missing';
    if (clearing) {
      // Only a MANUAL attribution may be cleared -- clearing capture-derived
      // identity would destroy real data behind one keystroke.
      if (item.channelAttributedManually !== true) return 'not-manual';
      delete item.channelAttributedManually;
      delete item.channelUrl;
      delete item.channelHandleUrl;
      delete item.channelId;
      delete item.channelName;
      delete item.channelAvatarUrl;
      return 'cleared';
    }
    item.channelUrl = identity.channelUrl;
    item.channelName = identity.channelName;
    if (identity.channelId) item.channelId = identity.channelId; else delete item.channelId;
    if (identity.channelHandleUrl) item.channelHandleUrl = identity.channelHandleUrl; else delete item.channelHandleUrl;
    if (identity.channelAvatarUrl) item.channelAvatarUrl = identity.channelAvatarUrl; else delete item.channelAvatarUrl;
    item.channelAttributedManually = true;
    return 'attributed';
  }

  // The relocation PROPOSAL for a manual attribution: destination dir only,
  // no file touched. Deliberately NOT planImportRelocation (which hard-
  // requires a youtubeId these items lack and skips files already under the
  // download root -- Dean's exact case); the move itself is the existing
  // POST /api/videos/:id/move, which is collision-409-safe and re-keys all
  // per-user state.
  function proposeAttributionMove(db, item, identity) {
    const config = ytdlp.parseYtdlpConfig();
    if (!ytdlp.isEnabled(config)) return { available: false, reason: 'module-disabled' };
    try {
      // Wave 5: the subscriptions come from their table as a fresh snapshot
      // holder - resolveChannelDirForChannel -> ensureYtdlp normalises THAT, never
      // the shared getCachedDatabase() object (the cache-coherency rule holds).
      const destinationDir = ytdlp.resolveChannelDirForChannel(ytdlpDb.holder(['subscriptions']), config, identity);
      if (!destinationDir) return { available: false, reason: 'channel-dir-unresolvable' };
      if (path.dirname(item.filePath) === destinationDir) return { available: false, reason: 'already-there' };
      return { available: true, destinationDir };
    } catch (err) {
      console.error('Attribution: channel dir unresolvable:', err && err.message);
      return { available: false, reason: 'channel-dir-unresolvable' };
    }
  }

  app.post('/api/videos/:id/attribute-channel', async (req, res) => {
    if (!requireModifyLibrary(req, res)) return; // v1.81 write-RBAC (first guard)
    if (attributionFeatureOff(res)) return; // v1.202 opt-in (after the RBAC guard)
    if (restrictedVideoMutation(req, res, req.params.id)) return; // v1.80 RBAC
    const body = req.body || {};
    const clearing = body.clear === true;
    let identity = null;
    if (!clearing) {
      const check = sanitizeAttributionTarget(body.target);
      if (!check.ok) return res.status(400).json({ error: check.error });
      identity = check.identity;
    }
    let result = null;
    try {
      await updateDatabase(db => {
        result = applyManualAttribution(db.metadata[req.params.id], identity, clearing);
        return result === 'attributed' || result === 'cleared';
      });
    } catch (err) {
      console.error(`Error attributing ${req.params.id}:`, err);
      return res.status(500).json({ error: `Could not attribute: ${err.message}` });
    }
    if (result === 'missing') return res.status(404).json({ error: 'Media file not found' });
    if (result === 'not-manual') return res.status(400).json({ error: 'Only a manual attribution can be cleared.' });
    let relocation = { available: false, reason: 'cleared' };
    if (result === 'attributed') {
      const db = getCachedDatabase();
      const item = db.metadata[req.params.id];
      relocation = item ? proposeAttributionMove(db, item, identity) : { available: false, reason: 'item-gone' };
    }
    res.json({ success: true, result, relocation });
  });

  // `root` must sit at-or-under a CONFIGURED library root. Same resolve+sep
  // discipline as computeMoveTarget; trailing separators normalized first
  // (gate S3: a trailing slash silently matched nothing).
  function confineBulkRoot(db, rawRoot) {
    if (typeof rawRoot !== 'string' || rawRoot === '') return null;
    let root = path.resolve(rawRoot);
    const allowed = configuredLibraryRoots(db).map((r) => path.resolve(r));
    const ok = allowed.some((r) => root === r || root.startsWith(r + path.sep));
    return ok ? root : null;
  }

  app.post('/api/videos/attribute-channel-bulk', async (req, res) => {
    // v1.81 write-RBAC (gate CRITICAL): the BULK sibling of the single-item
    // attribute-channel is a content mutation too - it rewrites channel identity
    // across a whole root and, with relocate:true, MOVES files on disk. It was
    // missed by the initial enumeration (the every-writer scar: gating one route
    // is not enough). First guard, incl. the preview dry-run (no reason to preview
    // a bulk op you cannot perform).
    if (!requireModifyLibrary(req, res)) return;
    if (attributionFeatureOff(res)) return; // v1.202 opt-in (after the RBAC guard)
    const body = req.body || {};
    const preview = body.preview === true;
    const relocate = body.relocate === true;
    // Read-only media refuses FILE MOVES only (gate S2/QA-S1: a metadata-only
    // bulk attribute is the same kind of write the single endpoint allows).
    if (relocate && !preview && refuseIfReadOnlyMedia(res)) return;
    const db0 = getCachedDatabase();
    // v1.127 Wave A (external review round 2, HIGH): this selector used to sweep
    // EVERY item under root - hidden ones included - letting a
    // capable-but-restricted member preview counts for, rewrite, and physically
    // RELOCATE media they cannot see. The requester's visibility is captured
    // req-free here so the shared selector AND the post-202 move loop below can
    // both apply it.
    const bulkItemVisible = mediaVisiblePredicate(req);
    const root = confineBulkRoot(db0, body.root);
    if (!root) return res.status(400).json({ error: 'root must be a configured library folder (or a folder inside one)' });
    const check = sanitizeAttributionTarget(body.target);
    if (!check.ok) return res.status(400).json({ error: check.error });
    const identity = check.identity;

    const proposal = proposeAttributionMove(db0, { filePath: path.join(root, '_probe_') }, identity);
    const destinationDir = proposal.available ? proposal.destinationDir : null;

    // The selector, shared by preview and execute: unattributed items under
    // root (to attribute+move), plus -- resume, W2 -- items ALREADY manually
    // attributed to THIS target that are not yet in its folder.
    const selectWork = (db) => {
      const toAttribute = [];
      const toResume = [];
      for (const item of Object.values(db.metadata || {})) {
        if (!item || typeof item.filePath !== 'string') continue;
        if (!matchRootFolder(item.filePath, [root])) continue;
        if (!bulkItemVisible(item)) continue; // v1.127: hidden items never enter the worklist
        const unattributed = !(typeof item.channelUrl === 'string' && item.channelUrl !== '');
        if (unattributed) { toAttribute.push(item.id); continue; }
        if (item.channelAttributedManually === true && item.channelUrl === identity.channelUrl
          && destinationDir && path.dirname(item.filePath) !== destinationDir) {
          toResume.push(item.id);
        }
      }
      return { toAttribute, toResume };
    };

    if (preview) {
      const { toAttribute, toResume } = selectWork(db0);
      return res.json({
        preview: true,
        matched: toAttribute.length,
        resuming: toResume.length,
        destinationDir,
        relocatable: Boolean(destinationDir),
        ...(destinationDir ? {} : { relocateSkipped: proposal.reason }),
      });
    }

    if (attributeBulkInProgress) {
      return res.status(409).json({ error: 'A bulk attribution is already running.', alreadyRunning: true });
    }
    attributeBulkInProgress = true;
    attributeBulkCancelled = false;

    const matchedIds = [];
    let resumeIds = [];
    try {
      await updateDatabase(db => {
        const { toAttribute, toResume } = selectWork(db);
        resumeIds = toResume;
        for (const id of toAttribute) {
          if (applyManualAttribution(db.metadata[id], identity, false) === 'attributed') matchedIds.push(id);
        }
        return matchedIds.length > 0;
      });
    } catch (err) {
      attributeBulkInProgress = false;
      console.error('Bulk attribution failed:', err);
      return res.status(500).json({ error: `Bulk attribution failed: ${err.message}` });
    }

    const moveIds = relocate && destinationDir ? [...matchedIds, ...resumeIds] : [];
    if (moveIds.length === 0) {
      attributeBulkInProgress = false;
      return res.json({
        success: true, attributed: matchedIds.length, resuming: resumeIds.length, relocating: false,
        ...(relocate && !destinationDir ? { relocateSkipped: proposal.reason } : {}),
      });
    }

    const ytdlpActivity = require('../ytdlp/activity'); // S10a re-rooted: a relative specifier follows the FILE, not the caller
    ytdlpActivity.setOneShot(ATTRIBUTE_BULK_ONESHOT_KEY, {
      kind: 'attribute-bulk', state: 'running', total: moveIds.length,
      done: 0, moved: 0, collisions: 0, alreadyThere: 0, failed: 0, cancelled: false, current: null,
    });
    res.status(202).json({ success: true, attributed: matchedIds.length, resuming: resumeIds.length, relocating: true, total: moveIds.length });
    (async () => {
      let moved = 0; let collisions = 0; let failed = 0; let alreadyThere = 0; let done = 0;
      for (const id of moveIds) {
        if (attributeBulkCancelled) break; // cooperative cancel (gate C3)
        try {
          // Gate S4: an item already in the destination is a resumed no-op,
          // never a phantom failure.
          const current = loadDatabase().metadata[id];
          if (!current) { done++; continue; }
          // v1.127 Wave A: the LOAD-BEARING visibility guard is the selector
          // filter (bulkItemVisible in selectWork) - it, not this line, is what
          // both gate seats mutation-bound. This per-item re-check is pure
          // belt-and-suspenders and is in fact UNREACHABLE: the restriction
          // index is frozen at request time, and the only way an item could turn
          // hidden mid-loop is a filePath/folderName change, which re-keys its
          // md5(filePath) id so the fresh `loadDatabase().metadata[id]` read
          // above already returns undefined and hits `!current`. Kept as a cheap
          // fail-safe only (e.g. against a future non-path-derived id scheme); do
          // NOT treat it as the guard. The T2 reheat batch deliberately omits
          // the analogous re-check for the same reason - its enumeration filter
          // is the load-bearing guard (plan wave-a T2, disclosed).
          if (!bulkItemVisible(current)) { done++; continue; }
          if (path.dirname(current.filePath) === destinationDir) {
            alreadyThere++; done++;
            ytdlpActivity.setOneShot(ATTRIBUTE_BULK_ONESHOT_KEY, { done, moved, collisions, alreadyThere, failed });
            continue;
          }
          const result = await moveItemToFolder({ loadDatabase, updateDatabase, getMediaId }, id, destinationDir, {});
          if (result && result.ok) moved++;
          else if (result && result.status === 409) collisions++;
          else { failed++; console.error(`Bulk attribution move failed for ${id}:`, result && result.error); }
        } catch (err) {
          failed++;
          console.error(`Bulk attribution move threw for ${id}:`, err && err.message);
        }
        done++;
        ytdlpActivity.setOneShot(ATTRIBUTE_BULK_ONESHOT_KEY, { done, moved, collisions, alreadyThere, failed });
      }
      ytdlpActivity.setOneShot(ATTRIBUTE_BULK_ONESHOT_KEY, {
        state: 'done', current: null, cancelled: attributeBulkCancelled === true,
      });
      attributeBulkInProgress = false;
    })().catch((err) => {
      console.error('Bulk attribution mover crashed:', err);
      const ytdlpActivity2 = require('../ytdlp/activity'); // S10a re-rooted (see above)
      ytdlpActivity2.setOneShot(ATTRIBUTE_BULK_ONESHOT_KEY, { state: 'error' });
      attributeBulkInProgress = false;
    });
  });

  // Cooperative cancel (gate C3) -- the running loop checks the latch between
  // items; already-moved files stay moved (honest: a cancel is "stop", never
  // "undo"), and the resume selector makes a later re-run finish the rest.
  app.post('/api/videos/attribute-channel-bulk/cancel', (req, res) => {
    // v1.81 write-RBAC (gate WARNING): a capability-less member must not be able
    // to abort an admin's in-flight bulk-attribution job (cross-user interference).
    if (!requireModifyLibrary(req, res)) return;
    if (!attributeBulkInProgress) return res.json({ cancelled: false, running: false });
    attributeBulkCancelled = true;
    res.json({ cancelled: true, running: true });
  });

  // API: Serve a subtitle track for a media item (A6, v1.24 UX Round, Wave 5).
  // Deliberately lives HERE, not in the yt-dlp module -- subtitle GRAB is
  // yt-dlp-module-adjacent (lib/ytdlp/args.js's buildYtdlpDownloadArgs), but
  // subtitle SERVE is a general library feature, exactly like /video/:id and
  // /thumbnail/:id above, and must work for LOCAL files with the yt-dlp module
  // completely disabled (FILETUBE_YTDLP_ENABLED unset). This route touches
  // nothing in lib/ytdlp -- only db.metadata/fs/lib/subtitles -- so it is
  // reachable regardless of module enablement, same as those two routes.
  //
  // Trust boundary: `item.filePath` is an already-trusted, already-indexed
  // path (the scan only ever writes db.metadata entries for files it walked
  // under a configured library root) -- `findSubtitleSidecar` only ever reads
  // the SAME directory that trusted path already lives in (see its own
  // comment, lib/subtitles.js), so there is no separate confinement check to
  // perform here: the confinement already happened once, at scan time,
  // mirroring GET /video/:id's own trust posture. The only untrusted input is
  // `:id` itself, and a hostile/unknown id simply misses the db.metadata
  // lookup and 404s, same as every other /api/<kind>/:id route in this file.
  //
  // A `.srt` sidecar is converted to VTT ON THE FLY via srtToVtt (no cached
  // copy ever written to disk -- cheap, pure, string-only work); a `.vtt`
  // sidecar is served as-is. 404s when the id is unknown, the sidecar read
  // fails, or no sidecar exists at all.
  app.get('/api/subtitles/:id', (req, res) => {
    const db = getCachedDatabase(); // v1.30 A3: hot GET reader
    const item = db.metadata[req.params.id];
    if (!item) {
      return res.status(404).json({ error: 'Media file not found' });
    }
    // v1.80 RBAC: a restricted item is indistinguishable from a missing one.
    if (!mediaVisibleTo(req, item)) {
      return res.status(404).json({ error: 'Media file not found' });
    }
    const sidecar = subtitles.findSubtitleSidecar(item.filePath);
    if (!sidecar) {
      return res.status(404).json({ error: 'No subtitle track available for this item' });
    }
    let vttText;
    try {
      const raw = fs.readFileSync(sidecar.path, 'utf8');
      vttText = sidecar.format === 'srt' ? subtitles.srtToVtt(raw) : raw;
    } catch (err) {
      console.error(`Error reading subtitle sidecar for ${req.params.id}:`, err);
      return res.status(404).json({ error: 'Subtitle file could not be read' });
    }
    // v1.34 T2 (desktop CC sync): `?offset=<seconds>` serves the document with
    // every cue shifted earlier by that amount -- the client's live-transcode
    // playback re-points its <track> here after a live seek, because the
    // ffmpeg pipe's timeline restarts at 0 while cue times are absolute (see
    // shiftVttCues' own comment, lib/subtitles.js). Bounded parse: absent/
    // garbage/negative/absurd values serve the unshifted document, never a 400
    // (a broken offset should degrade to v1.33 behavior, not kill captions).
    const rawOffset = req.query.offset;
    const offset = typeof rawOffset === 'string' ? Number(rawOffset) : NaN;
    if (Number.isFinite(offset) && offset > 0 && offset <= 60 * 60 * 24) {
      vttText = subtitles.shiftVttCues(vttText, offset);
    }
    // v1.41.1 (Dean): normalize every cue to bottom-center (last, so it keeps
    // whatever times the optional shift produced). CSS can't reposition native
    // cues, so we fix it at the source for both SRT-derived and .vtt captions.
    vttText = subtitles.centerVttCues(vttText);
    res.setHeader('Content-Type', 'text/vtt');
    // FIX-7 (two-reviewer gate, cheap hardening): defense-in-depth alongside
    // the explicit `text/vtt` Content-Type above -- a browser that ignores (or
    // sniffs past) that header for any reason can never reinterpret this
    // response as something else (e.g. HTML) purely from its bytes.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(vttText);
  });

  // API: the item's captions as a plain-text TRANSCRIPT (Dean: "allow me to see
  // and then copy/paste the full transcript from the video"). Header = title /
  // Published|Added <date> / channel, blank line, then one spoken line per row
  // (rolling auto-captions de-duplicated -- lib/transcript.js). `?timestamps=1`
  // prefixes each row with `[m:ss]`. Trust posture, RBAC 404 shape, and sidecar
  // resolution are IDENTICAL to `GET /api/subtitles/:id` above (a restricted or
  // unknown item is indistinguishable from one with no captions). Served as
  // text/plain so it is directly useful outside the app (curl, a script, an
  // analysis tool) -- the watch page's Transcript button fetches this same text.
  app.get('/api/transcript/:id', (req, res) => {
    const db = getCachedDatabase();
    const item = db.metadata[req.params.id];
    if (!item || !mediaVisibleTo(req, item)) {
      return res.status(404).json({ error: 'Media file not found' });
    }
    const sidecar = subtitles.findSubtitleSidecar(item.filePath);
    if (!sidecar) {
      return res.status(404).json({ error: 'No subtitle track available for this item' });
    }
    let vttText;
    try {
      const raw = fs.readFileSync(sidecar.path, 'utf8');
      vttText = sidecar.format === 'srt' ? subtitles.srtToVtt(raw) : raw;
    } catch (err) {
      console.error(`Error reading subtitle sidecar for transcript ${req.params.id}:`, err);
      return res.status(404).json({ error: 'Subtitle file could not be read' });
    }
    const timestamps = req.query.timestamps === '1' || req.query.timestamps === 'true';
    // Channel line: the item's captured channelName, else its folder -- the same
    // rule the attribute-channel target list uses for an item's display name.
    const channelName = (typeof item.channelName === 'string' && item.channelName !== '') ? item.channelName : (item.folderName || '');
    const doc = transcript.vttToTranscriptDocument(vttText, {
      title: item.title, releaseDate: item.releaseDate, addedAt: item.addedAt, channelName,
    }, { timestamps });
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(doc);
  });
}

// POST /api/videos/:id/prepare-audio, registered where it sat in server.js -
// after GET /audio/:id, whose comment it refers to and which stays behind.
function registerPrepareAudioRoute(app, deps) {
  const {
    audioPath,
    ffmpegIsAvailable, // LIVE reader: a server.js `let` the async ffmpeg probe flips after boot
    fs,
    healStaleAudioReady, // re-derives audioStatus when the sidecar is gone
    loadDatabase,
    mediaVisibleTo,
    queueAudioExtract,
  } = deps;

  // POST /api/videos/:id/prepare-audio (v1.27.0, EXPERIMENTAL): the pre-warm
  // hook for the background-audio handoff. The client fires this the moment a
  // mobile playback session starts for a VIDEO with the `backgroundAudioForVideo`
  // setting ON, so the audio-extract sidecar is USUALLY ready before the first
  // real background event needs it (there's no time to extract mid-handoff --
  // see GET /audio/:id's own comment). Deliberately a cheap POST that never
  // serves bytes -- not a GET /audio/:id HEAD-style kick: a HEAD request would
  // need the exact same 503-vs-200 branching as a real GET (Express's HEAD
  // handling for a GET route already strips the body, but the 503 JSON error
  // body callers actually want to read is exactly what HEAD throws away), and
  // a bare `fetch(..., { method: 'HEAD' })` against a Range-serving route is
  // easy to confuse with an accidental real playback request on a slow
  // connection. This route only enqueues (or reports "already ready") and
  // returns a tiny JSON status -- no Range/streaming machinery at all.
  // Idempotent and bounded by queueAudioExtract's own de-dupe guard (mirrors
  // queueTranscode's) -- never enqueues a second job for an id already
  // queued/in-flight, and never re-enqueues once a sidecar already exists on
  // disk.
  app.post('/api/videos/:id/prepare-audio', (req, res) => {
    // v1.30 A3: intentionally left on `loadDatabase()`, not switched to the
    // cache -- outside T4's explicit hot-GET-reader scope (a POST pre-warm
    // hook, not a GET route), and staying on a fresh per-request throwaway
    // object here costs nothing meaningful (this route never streams bytes).
    const db = loadDatabase();
    const item = db.metadata[req.params.id];
    if (!item) {
      return res.status(404).json({ error: 'Media file not found' });
    }
    // v1.80 RBAC: don't let a restricted item be an existence oracle / CPU sink.
    if (!mediaVisibleTo(req, item)) {
      return res.status(404).json({ error: 'Media file not found' });
    }
    if (item.type === 'audio') {
      return res.status(400).json({ error: 'prepare-audio only applies to video items' });
    }
    if (fs.existsSync(audioPath(item.id))) {
      return res.json({ audioStatus: 'ready' });
    }
    // F1: sidecar confirmed missing -- heal any stale 'ready' NOW. Use the
    // returned (healed) status below, never `item.audioStatus` again -- see
    // healStaleAudioReady's own comment (above GET /audio/:id) for why `item`
    // is never mutated in place.
    const healedAudioStatus = healStaleAudioReady(item);
    if (!ffmpegIsAvailable()) { // S10a live seam: a destructured boolean would freeze at `false`
      return res.status(503).json({ error: 'ffmpeg unavailable' });
    }
    if (healedAudioStatus !== 'failed') {
      queueAudioExtract(item.id, item.filePath);
    }
    res.json({ audioStatus: healedAudioStatus || 'pending' });
  });
}

module.exports = {
  registerBrowseRoutes,
  registerHandoffAndDeleteRoutes,
  registerMoveRoute,
  registerLibraryItemsRoute,
  registerCritterListingRoute,
  registerLibraryRoutes,
  registerPrepareAudioRoute,
  __setAttributeBulkInProgressForTests,
};
