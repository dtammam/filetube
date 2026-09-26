'use strict';

// lib/media/user-routes.js - the PRE-AUTH-era per-user media state routes:
// watch progress (/api/progress - the write coalescer's ingress and its
// read-your-writes read) and the Liked playlist (/api/liked - the two
// membership writes plus the MIXED-KIND read). Moved VERBATIM out of server.js
// in Wave 7b, slice S1b, of the relational-migration arc
// (docs/exec-plans/completed/2026-09-13-sqlite-relational-migration.md): the
// bodies are byte-identical to the server.js originals and keep their source
// order, group by group, with their free identifiers resolving from the
// `deps` bundle server.js hands in at each call site - the lib/ytdlp +
// lib/podcasts registerRoutes pattern. A missing dep is a hard failure (a
// destructured undefined that is later called throws), never a silent
// fallback.
//
// TWO registration functions, not one, because /api/progress and /api/liked
// were not adjacent in server.js: other routes are registered between them,
// and each registerRoutes call sits exactly where its own group's first route
// was (scripts/route-order-signature.js is the instrument).
//
// The three shapedLiked*Items projections moved with GET /api/liked - an
// espree reference census across server.js shows that route was their only
// reader. They live INSIDE registerLikedRoutes because they close over
// `deps` (userStore and the feature stores). `pendingProgress` crosses as
// the Map ITSELF, not a snapshot: it is a live `const` the coalescer mutates
// on every ping, and both groups read it for read-your-writes.
//
// The bodies are verbatim, so two of their comments still point at server.js
// neighbours rather than at anything in this file: GET /api/progress/:id's
// "see `effectiveProgress` above" means server.js's effectiveProgress (it
// crosses in through `deps`), and POST /api/liked/:id's "the other single-id
// routes above" means DELETE /api/videos/:id and its siblings, which stayed
// there. Named here rather than edited in place - editing them would break
// the byte-identity the slice's verification rests on.

// GET /api/progress/:id + POST /api/progress (the coalescer ingress).
function registerProgressRoutes(app, deps) {
  const {
    armProgressFlushTimerIfNeeded,
    effectiveProgress, // the stored position with any un-flushed ping overlaid
    getCachedDatabase,
    pendingProgress, // the progress coalescer's staging Map - the LIVE object, never a copy
    pendingProgressKey,
    recordPresenceFromPing, // v1.78 device handoff, last - after every other effect
    userStore,
    videoQuery, // WATCHED_PCT - the watched latch's threshold
  } = deps;

  // API: Get watch progress -- v1.30 A4: overlay any not-yet-flushed
  // `pendingProgress` entry (read-your-writes); see `effectiveProgress` above.
  // v1.43: scoped to the signed-in user (`req.user` is set by the auth gate on
  // every non-allowlisted route).
  app.get('/api/progress/:id', (req, res) => {
    const progress = effectiveProgress(req.user.id, req.params.id) || { timestamp: 0 };
    res.json(progress);
  });

  // API: Save watch progress
  // v1.30 A4 (AC4.1/AC4.2/AC4.3): rewritten from a per-ping `updateDatabase`
  // call (one atomic write+fsync every ~4s while a video plays) into the
  // progress-write coalescer -- validate, compute the value, stage it in
  // `pendingProgress`, arm the shared debounce timer if needed, and respond
  // immediately. No disk I/O happens on this request at all; the batched
  // write happens later, on `flushPendingProgress` (the timer, or a shutdown
  // handler). The 400 (bad input) / 404 (unknown id) semantics and the stored
  // value's shape (`{timestamp, duration, updatedAt}`, same duration-fallback
  // precedence) are BYTE-IDENTICAL to the pre-A4 per-ping behavior -- only the
  // persistence timing changed. Synchronous now (no `await`): there is nothing
  // left in this handler that can reject.
  app.post('/api/progress', (req, res) => {
    const { id, timestamp, duration } = req.body;
    if (!id || typeof timestamp !== 'number') {
      return res.status(400).json({ error: 'id and numeric timestamp are required' });
    }
    const db = getCachedDatabase(); // v1.30 A3: hot GET reader (existence check only)
    // OWN-property check (v1.42 __proto__ row-key lesson): a plain truthiness
    // probe lets id='__proto__'/'constructor' pass via Object.prototype
    // inheritance, and v1.43 persists this client-supplied id into
    // user_progress -- a stored junk-key row minted by any signed-in user.
    const item = Object.prototype.hasOwnProperty.call(db.metadata, id) ? db.metadata[id] : undefined;
    if (!item) {
      return res.status(404).json({ error: 'Media not found' });
    }
    // v1.50 gate (adversarial WARNING): normalize `duration` ONCE, up front,
    // with the same finite-number-or-fallback posture the flush's num() has
    // always applied. Before this, a crafted string duration ("100") was
    // truthy enough to ride the staging fallback and coerce through the latch
    // division, while filterByWatchState's strict number check excluded the
    // same un-flushed entry from its bucket -- three readers, two answers.
    // Now every reader (latch, watch buckets, flush, progress overlay) sees
    // one numeric value. For every POSITIVE-FINITE numeric-duration caller
    // (the real client sends video.duration) this is byte-identical to the
    // old `duration || item.duration || 0`; a negative/Infinity/NaN numeric
    // duration now falls back to the item's real duration instead of staging
    // garbage (gate delta precision -- an improvement, not a preservation).
    const effDuration = (typeof duration === 'number' && Number.isFinite(duration) && duration > 0)
      ? duration
      : (item.duration || 0);
    pendingProgress.set(pendingProgressKey(req.user.id, id), {
      userId: req.user.id,
      mediaId: id,
      value: {
        timestamp,
        duration: effDuration,
        updatedAt: new Date().toISOString()
      }
    });
    armProgressFlushTimerIfNeeded();
    // v1.50 watched latch: the first ping that crosses WATCHED_PCT marks the
    // item watched for this user, STICKY (a later loop-restart/rewatch ping
    // near 0 never clears it -- that's what keeps a looping video from
    // un-watching itself). Checked on the ping, NOT the coalesced flush: the
    // flush only keeps the LAST value of the window, so a cross-then-restart
    // inside one window would otherwise lose the crossing entirely. This is
    // the one durable-write exception to this handler's "no disk I/O" rule,
    // and it is bounded: one indexed point SELECT per ping while past the
    // threshold, one tiny INSERT ever (markWatched is check-then-insert).
    if (effDuration > 0 && (timestamp / effDuration) * 100 >= videoQuery.WATCHED_PCT) {
      userStore.markWatched(req.user.id, id, new Date().toISOString());
    }
    // v1.78: presence, LAST - after every existing effect, and after the 400/404
    // gates above, so a rejected ping mints no presence for an id this user was
    // never allowed to write. Cannot change this response (see the helper).
    recordPresenceFromPing(req, 'media', id, timestamp, effDuration);
    res.json({ success: true });
  });
}

// The Liked playlist: the two membership writes, the three per-kind read
// projections, and the mixed-kind listing.
function registerLikedRoutes(app, deps) {
  const {
    albumArtExists, // the liked-track arm's cover-art presence probe
    bookVisibleTo,
    booksDb,
    buildWatchUrl, // v1.338: lib/ytdlp/url - the Liked cards' Share corner (YouTube)
    effectiveBookProgress,
    effectiveMusicProgress,
    effectiveProgress,
    getCachedDatabase,
    chapterLikeTrack, // #235: a `<id>::c<n>` like's chapter from the ONE music expansion, or null (server.js)
    mediaVisibleTo, // v1.80 RBAC: the per-user visibility gate for media items
    musicDb,
    ownTrack, // the music store's own-track lookup (a track row by id)
    parseChapterTrackId, // M3: `<id>::c<n>` -> {baseId, index} | null (lib/music/libraryAudio.js)
    pendingProgress, // the coalescer's staging Map - the LIVE object (read-your-writes in the watch filter)
    podcastEpisodeVisibleTo,
    podcastsDb,
    previewClipEligible,
    restrictedVideoMutation, // v1.80 RBAC (S-b): no restricted-id oracle, no persist
    sourceShare, // v1.338: lib/media/source-share resolver - the Liked cards' Share corner (other sites)
    storyboardDescriptor,
    trackVisibleTo,
    userStore,
    videoQuery,
    ytdlp, // resolveItemChannelAvatarUrl for the Liked cards
    ytdlpDb,
  } = deps;

  // ---- v1.30 C2 (Visual polish cluster): Like -> "Liked" playlist --------
  //
  // Like state IS membership -- there is no separate boolean flag anywhere
  // (not on `db.metadata[id]`, not in settings) to ever drift out of sync
  // with it. v1.43 (chunk 4b): membership lives in the relational
  // `user_liked` table keyed by (user_id, media_id) -- a Like belongs to a
  // USER. The frozen pre-auth `liked` record (media_liked since Wave 4, was the
  // doc-table array) is retained untouched, adopted into the first admin at
  // /welcome; no reader
  // falls back to it (the total-cutover contract, design finding #6). The
  // mutations below are direct synchronous upserts/deletes on the warm
  // SQLite handle -- still exactly one durable write per invocation
  // (AC4.2's unbatched 1:1 posture), just against the user table instead of
  // a whole doc-table save.

  // API: Like an item (idempotent add). 404s exactly like the other single-id
  // routes above if the id isn't a real library item -- mirrors
  // `DELETE /api/videos/:id`'s own existence-check-then-mutate shape.
  // M3 chapter likes (v1.317, D9/D10): a like may target ONE CHAPTER of a
  // chaptered audio file, keyed `<mediaId>::c<n>` - the id the music
  // projection already mints for that chapter's row (expandAudioToTracks). The
  // RBAC gate and the existence check run on the BASE id (restrictedVideoMutation
  // looks up db.metadata[id] directly, so a raw `::c` id would slip past it);
  // the chapter is accepted ONLY when the base item is audio AND the requested
  // id is in the item's REAL expansion (a skipped invalid chapter keeps its index
  // out of the expansion; a 0-1 chapter file expands to its base track only).
  // The stored key is the expansion's own track.id - never req.params.id - so
  // nothing but a constructed `<own id>::c<validated integer>` can reach the
  // table (the NUL-id rule holds by construction).
  app.post('/api/liked/:id', (req, res) => {
    const chapter = parseChapterTrackId(req.params.id);
    const baseId = chapter ? chapter.baseId : req.params.id;
    if (restrictedVideoMutation(req, res, baseId)) return; // v1.80 RBAC (S-b): no restricted-id oracle/persist
    const db = getCachedDatabase(); // v1.30 A3: hot GET reader (existence check only)
    // OWN-property check (v1.42 __proto__ lesson): this id persists into
    // user_liked -- see POST /api/progress's identical guard.
    const item = Object.prototype.hasOwnProperty.call(db.metadata, baseId) ? db.metadata[baseId] : undefined;
    if (!item) {
      return res.status(404).json({ error: 'Media file not found' });
    }
    let likeId = item.id;
    if (chapter) {
      const track = chapterLikeTrack(item, req.params.id); // audio only, and in the item's REAL expansion
      if (!track) return res.status(404).json({ error: 'Media file not found' });
      likeId = track.id;
    }
    userStore.addLiked(req.user.id, likeId, new Date().toISOString()); // ON CONFLICT DO NOTHING -> idempotent re-add
    res.json({ success: true, liked: true });
  });

  // API: Unlike an item (idempotent remove). No existence-in-metadata gate --
  // removing membership for an id that's already absent (or was since deleted
  // from the library entirely) is itself the desired end state, nothing to
  // 404 on.
  app.delete('/api/liked/:id', (req, res) => {
    userStore.removeLiked(req.user.id, req.params.id);
    res.json({ success: true, liked: false });
  });

  // ---- v1.72 (#94): the Liked playlist is MIXED-KIND -------------------------
  //
  // Hearting content in ANY kind surfaces it in THE Liked playlist (/?liked=1,
  // the count-gated sidebar entry, and v1.75's opt-in bottom-bar entry). v1.75
  // (Dean's ruling): this is the ONE read surface - the kind-scoped lanes that
  // used to complement it (the podcasts place's Liked card, the music place's
  // Liked tab) are REMOVED, and docs/CONTRIBUTING.md's capability 4 now records
  // a new kind-scoped Liked lane as a defect to add, not a complement. The
  // per-kind HEARTS remain the write surfaces. Each arm below is a read-time projection
  // of that kind's OWN liked carrier into the card item shape the Liked grid
  // renders; `kind` is CARRIED on every item (podcast/track/book ids are md5
  // hex exactly like media ids - kind is never inferred from id shape), and
  // each id space keeps its own lane's exact silent-drop rule. Like/unlike
  // writes stay on the per-kind routes; these arms never mutate membership.

  // The podcast arm - the /api/podcasts/episodes?filter=liked drop rule
  // EXACTLY: the episode row must exist and be status 'downloaded' (a trashed/
  // tombstoned/pending episode keeps its user_podcast_liked row - v1.65's law:
  // trash keeps per-user state - but never renders in the playlist).
  function shapedLikedPodcastItems(db, userId) {
    const ns = podcastsDb.read();
    const likedRows = userStore.getPodcastLiked(userId);
    if (!likedRows.length) return [];
    const progress = userStore.getPodcastProgress(userId);
    const played = userStore.getPodcastPlayed(userId);
    const subNameById = new Map(ns.subscriptions.filter(Boolean).map((s) => [s.id, s.name]));
    const items = [];
    for (const row of likedRows) {
      const id = row.episodeId;
      const ep = Object.prototype.hasOwnProperty.call(ns.episodes, id) ? ns.episodes[id] : null;
      if (!ep || ep.status !== 'downloaded') continue;
      const prog = Object.prototype.hasOwnProperty.call(progress, id) ? progress[id] : null;
      const pct = prog && Number(prog.duration) > 0 ? (Number(prog.position) / Number(prog.duration)) * 100 : 0;
      items.push({
        kind: 'podcast',
        id: ep.id,
        title: ep.title,
        type: 'audio',
        // The library-entry moment, like a video's addedAt (file birthtime):
        // when the enclosure finished downloading; pubDateMs is the fallback
        // for legacy rows that predate the downloadedAt stamp.
        addedAt: Number.isFinite(ep.downloadedAt) ? ep.downloadedAt : (Number.isFinite(ep.pubDateMs) ? ep.pubDateMs : 0),
        duration: Number.isFinite(ep.durationSec) ? ep.durationSec : 0,
        size: Number.isFinite(ep.bytes) ? ep.bytes : 0,
        subId: ep.subId,
        showName: subNameById.has(ep.subId) ? subNameById.get(ep.subId) : null,
        liked: true,
        progress: prog ? Number(prog.position) : 0,
        progressPercent: pct,
        // The played latch IS this kind's watched latch - one derivation
        // authority (videoQuery) for every kind.
        watchState: videoQuery.deriveWatchState(pct, Object.prototype.hasOwnProperty.call(played, id))
      });
    }
    return items;
  }

  // The music arm - the /api/music?filter=liked drop rule EXACTLY: the track
  // row must still exist (own-property; a pruned track sheds its liked row via
  // removeMusicState, but a race between prune and read must never render a
  // ghost).
  function shapedLikedTrackItems(db, userId) {
    const likedIds = userStore.getMusicLiked(userId);
    if (!likedIds.length) return [];
    const ns = musicDb.read();
    const items = [];
    for (const id of likedIds) {
      const track = ownTrack(ns.tracks, id);
      if (!track) continue;
      // QA gate S3: read-your-writes like the media arm - the coalescer
      // overlay beats the committed row (liked sets are small; per-id reads
      // are fine here).
      const prog = effectiveMusicProgress(userId, id);
      const pct = prog && Number(prog.duration) > 0 ? (Number(prog.position) / Number(prog.duration)) * 100 : 0;
      items.push({
        kind: 'track',
        id: track.id,
        title: track.title,
        type: 'audio',
        // music scan stamps addedAt as an ISO string; the card/sort contract
        // (sortItems, formatRelativeTime) is numeric ms like media addedAt.
        addedAt: Date.parse(track.addedAt) || 0,
        duration: Number.isFinite(track.durationSec) ? track.durationSec : 0,
        size: 0,
        artist: track.artist,
        album: track.album,
        hasArt: !!(track.albumArtKey && albumArtExists(track.albumArtKey)),
        liked: true,
        progress: prog ? Number(prog.position) : 0,
        progressPercent: pct,
        // Music has no played latch (morning question M2) - the live position
        // is the only signal, same derivation authority.
        watchState: videoQuery.deriveWatchState(pct, false)
      });
    }
    return items;
  }

  // The books arm - drop rule mirrors music's: the item row must still exist
  // (the scan prune retires membership via removeBookState; a race between
  // prune and read must never render a ghost). Books carry NO `type`: the
  // format filter's documented ambiguous-inclusion rule applies (a book is
  // neither video nor audio and fails safe toward visible).
  function shapedLikedBookItems(db, userId) {
    const likedRows = userStore.getBookLiked(userId);
    if (!likedRows.length) return [];
    const ns = booksDb.read();
    const finishedMap = userStore.getBookFinished(userId);
    const items = [];
    for (const row of likedRows) {
      const id = row.bookId;
      const item = Object.prototype.hasOwnProperty.call(ns.items, id) ? ns.items[id] : null;
      if (!item) continue;
      // QA gate S3: read-your-writes like the media arm (coalescer overlay
      // first) - the track arm's exact posture.
      const prog = effectiveBookProgress(userId, id);
      const pct = prog && typeof prog.percent === 'number' ? Math.min(100, Math.max(0, prog.percent)) : 0;
      items.push({
        kind: 'book',
        id: item.id,
        title: item.title,
        author: item.author,
        // The scanner stamps addedAt as an ISO string; the sort contract is
        // numeric ms (the track-arm conversion).
        addedAt: typeof item.addedAt === 'number' ? item.addedAt : (Date.parse(item.addedAt) || 0),
        duration: 0,
        size: Number.isFinite(item.size) ? item.size : 0,
        liked: true,
        progress: 0,
        progressPercent: pct,
        // Reading percent + the manual finished latch through the ONE
        // derivation authority (the latch strictly widens 'watched').
        watchState: videoQuery.deriveWatchState(pct, Object.prototype.hasOwnProperty.call(finishedMap, id))
      });
    }
    return items;
  }

  // M3 chapter likes (v1.317, D11): the CHAPTER arm. A `<mediaId>::c<n>` like
  // expands its base item's chapter n (through the SAME expansion the music
  // list/search/resolve build - itemChapterTracks) into a track-shaped entry the
  // Liked grid already renders for kind:'track': it links /music?play=<id>
  // (resolved by GET /api/music/:id from that same projection) and arts from
  // /albumart/<id> (which strips `::c` to the base thumbnail). Drop rule, like
  // the other arms: the base must still exist (own-property), be audio, be
  // visible to THIS user (mediaVisibleTo - the media gate, never trackVisibleTo:
  // a projected chapter is a media item), and the chapter must still be in the
  // expansion (a re-chaptered file drops a stale index at read time, and since
  // #235 the member's /api/stats count drops it by the same chapterLikeTrack rule;
  // the row itself is kept, so an edit restoring the index revives it; the
  // durable cleaner is removeMediaState on delete/purge/prune). `mediaId` is
  // carried so the RBAC filter below can re-gate the entry by its base item.
  function shapedLikedChapterItems(db, req, likedIds, watchedSet) {
    const items = [];
    for (const likeId of likedIds) {
      const chapter = parseChapterTrackId(likeId);
      if (!chapter) continue;
      const item = Object.prototype.hasOwnProperty.call(db.metadata, chapter.baseId) ? db.metadata[chapter.baseId] : null;
      if (!item || item.type !== 'audio' || !mediaVisibleTo(req, item)) continue;
      const track = chapterLikeTrack(item, likeId); // #235: the SAME rule the member's Stats count uses
      if (!track) continue;
      // Progress is the FILE's position (a chapter has no row of its own),
      // read through the coalescer overlay like the media arm, then placed
      // within the chapter's span: before it 0, past it 100.
      const prog = effectiveProgress(req.user.id, item.id) || { timestamp: 0, duration: 0 };
      const start = Number(track.chapterStartSec) || 0;
      const span = Number(track.durationSec) || 0;
      const inChapter = span > 0 ? Math.min(span, Math.max(0, Number(prog.timestamp || 0) - start)) : 0;
      const pct = span > 0 ? (inChapter / span) * 100 : 0;
      items.push({
        kind: 'track',
        source: 'library-chapter',
        mediaId: item.id,
        id: track.id,
        title: track.title,
        type: 'audio',
        addedAt: typeof item.addedAt === 'number' ? item.addedAt : (Date.parse(item.addedAt) || 0),
        duration: span,
        chapterStartSec: start,
        size: 0,
        artist: track.artist,
        album: track.album,
        hasArt: !!item.hasThumbnail,
        liked: true,
        progress: inChapter,
        progressPercent: pct,
        // The file's watched latch applies to every chapter of it (one file, one latch).
        watchState: videoQuery.deriveWatchState(pct, watchedSet.has(item.id))
      });
    }
    return items;
  }

  // API: List liked items -- reuses the SAME `{items,total,offset,limit}`
  // shaping / sort+pagination pipeline `GET /api/videos` (T6, A5) established,
  // scoped down to the signed-in user's liked membership. Read-only; never
  // mutates membership. v1.72 (#94): the response is MIXED-KIND - liked
  // podcast episodes, music tracks and books ride the same list, sort,
  // filters and pagination as liked videos; media items carry kind:'media'
  // explicitly.
  // v1.338 (plan first-class-any-site D5): the Liked card's Share links, derived exactly like
  // GET /api/videos (buildWatchUrl re-validates the id; the saved link is re-checked). Keys absent when
  // there is nothing safe to share.
  function likedShareLinks(item) {
    const watchUrl = typeof item.youtubeId === 'string' && typeof buildWatchUrl === 'function' ? buildWatchUrl(item.youtubeId) : null;
    const sourceShareUrl = sourceShare ? sourceShare.saved(item, watchUrl) : undefined;
    return { ...(watchUrl ? { watchUrl } : {}), ...(sourceShareUrl ? { sourceShareUrl } : {}) };
  }

  app.get('/api/liked', (req, res) => {
    const db = getCachedDatabase(); // v1.30 A3: hot GET reader
    const ytView = ytdlpDb.holder(['subscriptions', 'channelAvatars']); // Wave 5: the avatar registry + subscriptions, ONE read per request (resolveItemChannelAvatarUrl is read-only)
    // v1.43: membership is the signed-in user's user_liked rows (a warm
    // prepared-statement read), never the frozen db.liked record.
    const likedIds = new Set(userStore.getLiked(req.user.id));
    const sort = typeof req.query.sort === 'string' ? req.query.sort : 'newest';
    const limit = videoQuery.normalizeLimit(req.query.limit);
    const offset = videoQuery.normalizeOffset(req.query.offset);
    const seed = videoQuery.normalizeSeed(req.query.seed);

    let list = Object.values(db.metadata).filter(item => likedIds.has(item.id) && mediaVisibleTo(req, item)); // v1.80 RBAC
    // v1.32: the Liked view is now a real library scope (main.js's ?liked=1)
    // -- honor the same format toggle the home grid forwards, so
    // videos/audio/both filtering behaves identically in both views.
    if (typeof req.query.format === 'string') {
      list = videoQuery.filterByFormat(list, req.query.format);
    }

    // v1.50: honor the watched-state toggle too, for exactly the v1.32 reason
    // above -- the home toolbar (which now carries the watch group) fronts
    // BOTH endpoints, and a visible control that silently no-ops in one of
    // the two views is the worse behavior. Same derivation as /api/videos.
    // v1.72 (#94): the non-media arms. Shaped up-front (liked sets are small);
    // the format/watch filters below apply to them through the SAME predicates
    // (filterByFormat reads item.type; a shaped item's watchState was derived
    // by the same videoQuery authority the media path uses at page-shaping
    // time, so filtering on it is the identical decision).
    // (hoisted for the M3 chapter arm, which derives a chapter's watchState from
    // its FILE's latch; the watch filter below reads the same set.)
    const watchedSet = new Set(userStore.getWatchedIds(req.user.id));
    let others = [
      ...shapedLikedPodcastItems(db, req.user.id),
      ...shapedLikedTrackItems(db, req.user.id),
      ...shapedLikedBookItems(db, req.user.id),
      ...shapedLikedChapterItems(db, req, likedIds, watchedSet) // M3: `<id>::c<n>` likes from the MEDIA store
    ];
    // v1.80 RBAC: a restricted track must not ride the Liked view. (Podcast/book
    // liked filtering lands with their libraries, T6/T7.)
    // shaped liked items carry `id`, not `mediaId` (see shapedLiked*Items).
    // M3: a chapter entry has NO native row - it re-gates on its base MEDIA item
    // (the media gate, `{kind:'folder'}` and friends), never on ownTrack.
    const likedMusicNs = musicDb.read();
    const likedPodNs = podcastsDb.read();
    const likedBooksNs = booksDb.read();
    others = others.filter((o) => {
      if (o.kind === 'track' && o.source === 'library-chapter') {
        return mediaVisibleTo(req, Object.prototype.hasOwnProperty.call(db.metadata, o.mediaId) ? db.metadata[o.mediaId] : null);
      }
      if (o.kind === 'track') return trackVisibleTo(req, ownTrack(likedMusicNs.tracks, o.id));
      if (o.kind === 'podcast') return podcastEpisodeVisibleTo(req, likedPodNs.episodes && likedPodNs.episodes[o.id]);
      if (o.kind === 'book') return bookVisibleTo(req, likedBooksNs.items && likedBooksNs.items[o.id]);
      return true;
    });
    if (typeof req.query.format === 'string') {
      others = videoQuery.filterByFormat(others, req.query.format);
    }

    const watch = videoQuery.normalizeWatchFilter(req.query.watch);
    if (watch !== 'all') {
      const progressMap = userStore.getProgress(req.user.id);
      for (const entry of pendingProgress.values()) {
        if (entry.userId === req.user.id) progressMap[entry.mediaId] = entry.value;
      }
      list = videoQuery.filterByWatchState(list, watch, progressMap, watchedSet);
      others = others.filter((o) => o.watchState === watch);
    }

    // `total` is the full liked-set length (after format/watch filtering),
    // BEFORE slicing to a page -- same contract as GET /api/videos's `total`.
    const total = list.length + others.length;

    const rng = sort === 'random' && seed !== undefined ? videoQuery.createSeededRng(seed) : undefined;
    // One merged sort: shaped items carry the same addedAt/title/size fields
    // the media records do, so every toolbar sort (and the seeded shuffle's
    // stable paging) treats the kinds uniformly.
    const sorted = videoQuery.sortItems([...list, ...others], sort, rng);
    const page = sorted.slice(offset, offset + limit);

    const items = page.map(item => {
      if (item.kind) return item; // a shaped non-media item - already complete
      const progress = effectiveProgress(req.user.id, item.id) || { timestamp: 0, duration: 0 };
      const progressPercent = progress.duration > 0 ? (progress.timestamp / progress.duration) * 100 : 0;
      return {
        ...item,
        sourceUrl: undefined, // v1.338 D1: the raw saved link never rides the spread; only the re-checked sourceShareUrl is served
        // v1.113 (Fix A sweep): the Liked grid feeds the SAME buildCardHtml ->
        // modernCardAvatar path as /api/videos, so resolve the avatar identically
        // (read-only) or a registry-resolvable channel shows a monogram here.
        channelAvatarUrl: ytdlp.resolveItemChannelAvatarUrl(ytView, item) || '',
        // v1.338 (plan first-class-any-site D5): the Share corner's links. The Liked list never
        // derived `watchUrl`, so a Share corner on a Liked card was blank even for YouTube (found by
        // the D5 research); now it carries the YouTube link, or a non-YouTube download's saved one.
        ...likedShareLinks(item),
        kind: 'media', // v1.72: kind is CARRIED on every item, never inferred
        liked: true, // every item in this listing is, by construction, a liked member
        // v1.93.2: DERIVED storyboard descriptor - the Liked view feeds
        // buildCardHtml, which renders the hover/in-view preview. Parity with
        // /api/videos and the modern grid; without this, Liked cards lost their
        // preview once the persisted field was removed.
        storyboard: storyboardDescriptor(item) || undefined,
        hasPreview: previewClipEligible(item) || undefined, // v1.94: hover clip eligibility
        progress: progress.timestamp,
        progressPercent,
        // v1.50: same server-derived state as /api/videos (one authority).
        watchState: videoQuery.deriveWatchState(progressPercent, watchedSet.has(item.id))
      };
    });

    res.json({ items, total, offset, limit });
  });
}

module.exports = { registerProgressRoutes, registerLikedRoutes };
