'use strict';

// lib/music/routes.js - the music library's HTTP surface: the /api/music routes
// (folder config, scan control, the list/album/artist/channel reads, per-user
// liked + resume + progress, the track detail), the /track byte route, the
// /albumart image route, and the /audio background-audio sidecar route. Moved
// VERBATIM out of server.js in Wave 7b, slice S3, of the relational-migration
// arc (docs/exec-plans/completed/2026-09-13-sqlite-relational-migration.md): the
// bodies are byte-identical to the server.js originals and keep their source
// order, with their free identifiers resolving from the `deps` bundle server.js
// hands in at each call site - the lib/ytdlp + lib/podcasts registerRoutes
// pattern. A missing dep is a hard failure (a destructured undefined that is
// later called throws), never a silent fallback.
//
// FOUR registration functions, not one, because the music routes are not one
// contiguous run in server.js and the routing ORDER may not change
// (scripts/route-order-signature.js is the instrument). Each call sits exactly
// where its own block's first route sat:
//   - registerConfigRoutes: /api/music/config (GET+POST), /api/music/scan,
//     /api/music/scan-status - the block ahead of the progress coalescer, whose
//     `const pendingMusicProgress` is still in server.js's temporal dead zone at
//     this point in the file;
//   - registerLibraryRoutes: the read APIs through POST /api/music/resume -
//     the block that ends where slice S1a's userRoutes.registerRoutes call sits;
//   - registerTrackRoutes: POST /api/music/progress through GET /albumart/:id -
//     the block after that call;
//   - registerAudioRoute: GET /audio/:id, ~8,700 lines further down, next to the
//     transcode/stream machinery that stays in server.js for now.
//
// What moved WITH the routes (an espree reference census over server.js -
// scripts/monolith-split-census.js and the same walk over each name - shows the
// moved routes are their only referrers, and server.js exports neither):
// MUSIC_CONTENT_TYPES and musicArtPlaceholderSvg, both read only by the track/
// art block, so both sit at the top of registerTrackRoutes (their declarations
// sat above the config block in server.js; nothing between them and their one
// reader moved, so the closest honest home is the function that holds it).
// What did NOT, and why:
//   - publicTrackListItem and musicListProgressMap are read by BOTH the library
//     block and the track block, which are two register functions with two deps
//     bundles - one shared definition in server.js beats two copies or a
//     threaded one, so they cross as deps;
//   - projectedLibraryTracks and ownTrack have referrers outside music
//     (GET /api/search, GET /api/home, the queue and media-liked routers);
//   - effectiveMusicProgress is already a dep of lib/media/user-routes.js;
//   - armMusicProgressFlushTimerIfNeeded has no other CALLER, but it assigns
//     server.js's `musicProgressFlushTimer` `let`, which
//     currentMusicProgressFlushTimer, flushPendingMusicProgress and
//     replacePersistedState also read and clear - moving it would fork that one
//     timer into two variables (the S2 armBookProgressFlushTimerIfNeeded case);
//   - musicCodecNeedsTranscode still has publicTrackListItem as a referrer and
//     is exported from server.js;
//   - queueMusicTranscode belongs to the music transcode QUEUE cluster
//     (musicTranscodeQueue / musicTranscodeBusy / processMusicTranscodeQueue),
//     which the routes do not own;
//   - musicScanState crosses as the OBJECT: server.js declares it `let` but
//     never reassigns it (every write is a property write), so the scan routes
//     read and mutate exactly the state currentMusicScanState exports;
//   - scanMusic stays in server.js (the media-scan timer, the boot path and the
//     integration tests reach it through this file's exports); only its inner
//     pass moved, to ./scanRunner.
//
// ONE expression in GET /audio/:id is NOT byte-identical, and deliberately so:
// server.js's `ffmpegAvailable` is a MUTABLE `let` that the boot-time
// `exec('ffmpeg -version')` callback flips to true LONG AFTER these routes
// register (registration is synchronous at require time). Destructuring the
// VALUE here would freeze the route's ffmpeg gate at its boot-time false, so
// every /audio request on a machine that HAS ffmpeg would answer
// 503 "ffmpeg unavailable" and never enqueue an extraction - an inert gate, the
// v1.185 bug class and the S1a pushGuardLookup seam exactly. It crosses as the
// live reader `ffmpegIsAvailable()` instead; test/unit/music-audio-seam.test.js
// drives the flip AFTER registration and is what proves it live.

function registerConfigRoutes(app, deps) {
  const {
    DATA_DIR,
    booksDb, // the reciprocal book-root overlap guard
    folderStore, // Wave 4: the media root list is a table
    foldersOverlap,
    fs,
    getCachedDatabase,
    musicDb,
    musicScanState, // the LIVE scan-state object (currentMusicScanState exports the same one)
    musicStore,
    path,
    podcasts, // the reciprocal podcast-root overlap guard
    requireAdmin, // v1.81 write-RBAC: library config is admin-only
    requireModifyLibrary,
    scanMusic, // the overlap/coalescing scan guard - still server.js's
    trackVisibleTo, // v1.80 RBAC: the per-user visibility gate for tracks
    tvDb, // the reciprocal TV-root overlap guard
    updateDatabase,
    visibleConfigRoots,
    ytdlpArgs, // isPathUnder for the media/book/podcast root overlap checks
  } = deps;

  app.get('/api/music/config', (req, res) => {
    const ns = musicDb.read();
    const folders = ns.folders || [];
    // v1.128 Wave B (L3): same as books/config - common.js reads it for the
    // Music nav tab, so filter to roots holding >=1 visible track for a
    // restricted member; admin + unrestricted member byte-identical.
    res.json({ folders: visibleConfigRoots(req, folders, Object.values(ns.tracks || {}), trackVisibleTo) });
  });

  app.post('/api/music/config', async (req, res) => {
    if (!requireAdmin(req, res)) return; // v1.81 write-RBAC (gate CRITICAL): library config is admin-only
    const { folders } = req.body || {};
    if (!Array.isArray(folders) || !folders.every((f) => typeof f === 'string' && f.trim() !== '')) {
      return res.status(400).json({ error: 'folders must be an array of non-empty strings' });
    }
    const resolved = [];
    const seen = new Set();
    for (const raw of folders) {
      const folder = path.resolve(raw.trim());
      if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
        return res.status(400).json({ error: `Folder does not exist: ${folder}` });
      }
      if (seen.has(folder)) continue;
      seen.add(folder);
      resolved.push(folder);
    }
    // HARD INVARIANT (exec plan §4.4): music roots may never overlap media roots
    // OR book roots, in EITHER direction -- a file must have exactly one owner,
    // or the scanners' prune/merge semantics fight over it. Three-way check; the
    // reciprocal clauses in the media/book config routes (T5) close the other
    // direction so ownership is order-independent.
    const cached = getCachedDatabase();
    const mediaFolders = folderStore.list().map((f) => path.resolve(f)); // Wave 4: the root list is a table
    const bookFolders = (booksDb.read().folders || []).map((f) => path.resolve(f));
    for (const musicRoot of resolved) {
      for (const mediaRoot of mediaFolders) {
        if (musicRoot === mediaRoot || ytdlpArgs.isPathUnder(musicRoot, mediaRoot) || ytdlpArgs.isPathUnder(mediaRoot, musicRoot)) {
          return res.status(400).json({ error: `Music folder overlaps a media folder: ${musicRoot} <-> ${mediaRoot}` });
        }
      }
      for (const bookRoot of bookFolders) {
        if (musicRoot === bookRoot || ytdlpArgs.isPathUnder(musicRoot, bookRoot) || ytdlpArgs.isPathUnder(bookRoot, musicRoot)) {
          return res.status(400).json({ error: `Music folder overlaps a book folder: ${musicRoot} <-> ${bookRoot}` });
        }
      }
      // v1.69 podcasts (D8): the four-way clause, same both-directions posture.
      const podcastsRootForMusic = podcasts.resolvePodcastsRoot(cached, { dataDir: DATA_DIR });
      if (musicRoot === podcastsRootForMusic || ytdlpArgs.isPathUnder(musicRoot, podcastsRootForMusic) || ytdlpArgs.isPathUnder(podcastsRootForMusic, musicRoot)) {
        return res.status(400).json({ error: `Music folder overlaps the podcasts folder: ${musicRoot} <-> ${podcastsRootForMusic}` });
      }
      // v1.195 TV Shows: reciprocal of the tv-config net.
      for (const tvRoot of (tvDb.read().folders || []).map((f) => path.resolve(f))) {
        if (foldersOverlap(musicRoot, tvRoot)) {
          return res.status(400).json({ error: `Music folder overlaps a Shows folder: ${musicRoot} <-> ${tvRoot}` });
        }
      }
    }
    try {
      await updateDatabase(() => musicDb.mutate((h) => { musicStore.ensureMusic(h).folders = resolved; return true; })); // Wave 5: the diff rides the commit
    } catch (err) {
      return res.status(500).json({ error: `Could not save music folders: ${err.message}` });
    }
    res.json({ folders: resolved });
    scanMusic().catch(console.error);
  });

  app.post('/api/music/scan', (req, res) => {
    if (!requireModifyLibrary(req, res)) return; // v1.81 write-RBAC (first guard)
    const alreadyInProgress = musicScanState.scanning;
    if (alreadyInProgress) {
      musicScanState.rescanRequested = true;
    } else {
      scanMusic().catch(console.error);
    }
    res.status(202).json({ scanning: true, alreadyInProgress });
  });

  app.get('/api/music/scan-status', (req, res) => {
    res.json(musicScanState);
  });
}

function registerLibraryRoutes(app, deps) {
  const {
    folderDisplayNameStore, // Wave 4: the per-channel display names the manager list shows
    getCachedDatabase,
    libraryAudio,
    mediaVisibleTo, // the MEDIA gate (projected library audio is a media item)
    musicDb,
    musicLikedSets, // M3 chapter likes: {music, media} like sets - a projected row reads the MEDIA store
    musicListProgressMap, // v1.215: the media-store merge for projected tracks
    musicQuery,
    ownTrack, // the OWN-property track lookup (never a bare tracks[id])
    projectedLibraryTracks, // Wave G: the library-audio projection
    publicTrackListItem,
    trackIsLiked, // M3: the per-row like predicate (reads the right store by source)
    trackVisibleTo, // v1.80 RBAC: the per-user visibility gate for tracks
    userStore,
    videoQuery, // normalizeLimit/normalizeOffset/createSeededRng for the list reads
  } = deps;

  app.get('/api/music', (req, res) => {
    const ns = musicDb.read();
    let list = Object.values(ns.tracks).filter((t) => trackVisibleTo(req, t)); // v1.80 RBAC
    list = list.concat(projectedLibraryTracks(req, list)); // Wave G projection (v1.242: unconditional - all audio unless channel opted-out)
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const album = typeof req.query.album === 'string' ? req.query.album : '';
    const artist = typeof req.query.artist === 'string' ? req.query.artist : '';
    const root = typeof req.query.root === 'string' ? req.query.root : '';
    if (search) list = list.filter((t) => musicQuery.matchesSearch(t, search));
    if (album) list = list.filter((t) => musicQuery.matchesAlbum(t, album));
    if (artist) list = list.filter((t) => musicQuery.matchesArtist(t, artist));
    if (root) list = list.filter((t) => musicQuery.matchesRoot(t, root));

    // M3 chapter likes: a native row's like is in user_music_liked, a projected
    // library/chapter row's in user_liked (the media store) - one predicate.
    const likedSets = musicLikedSets(req.user.id);
    if (req.query.filter === 'liked') list = list.filter((t) => trackIsLiked(t, likedSets));
    // v1.215: merge the media store for projected library tracks (see the helper).
    const progressMap = musicListProgressMap(req.user.id, list);
    if (req.query.filter === 'recent-listening') {
      // The "Continue listening" surface: tracks with a saved position, most
      // recently updated first.
      list = list.filter((t) => progressMap[t.id] && Number(progressMap[t.id].position) > 0);
      list.sort((a, b) => String((progressMap[b.id] || {}).updatedAt || '').localeCompare(String((progressMap[a.id] || {}).updatedAt || '')));
    } else {
      // Default sort: album/artist context implies album order; otherwise the
      // requested sort (newest default). seed drives a reproducible shuffle.
      const defaultSort = (album || artist) ? 'album-order' : 'newest';
      const sortKey = typeof req.query.sort === 'string' && req.query.sort ? req.query.sort : defaultSort;
      const rng = sortKey === 'random' ? videoQuery.createSeededRng(videoQuery.normalizeSeed(req.query.seed)) : undefined;
      list = musicQuery.sortTracks(list, sortKey, rng);
    }

    const total = list.length;
    const offset = videoQuery.normalizeOffset(req.query.offset);
    const limit = videoQuery.normalizeLimit(req.query.limit);
    const items = list.slice(offset, offset + limit).map((t) => publicTrackListItem(t, req.user.id, likedSets, progressMap));
    res.json({ items, total, offset, limit });
  });

  app.get('/api/music/albums', (req, res) => {
    const ns = musicDb.read();
    let list = Object.values(ns.tracks).filter((t) => trackVisibleTo(req, t)); // v1.80 RBAC
    list = list.concat(projectedLibraryTracks(req, list)); // Wave G projection (v1.242: unconditional - all audio unless channel opted-out)
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    if (search) list = list.filter((t) => musicQuery.matchesSearch(t, search));
    // Gate QA-WARNING/ADV-SUGGESTION: paginate (the design-for-scale target) and
    // DROP the per-row albumArtExists fs.existsSync — the client always requests
    // /albumart/:artId, which serves the real file or an SVG placeholder, so
    // hasArt was an unused N-stat-per-request event-loop tax at scale.
    const sortKey = typeof req.query.sort === 'string' ? req.query.sort : '';
    const albums = musicQuery.groupAlbums(list, sortKey);
    const total = albums.length;
    const offset = videoQuery.normalizeOffset(req.query.offset);
    const limit = videoQuery.normalizeLimit(req.query.limit);
    res.json({ items: albums.slice(offset, offset + limit), total, offset, limit });
  });

  app.get('/api/music/artists', (req, res) => {
    const ns = musicDb.read();
    let list = Object.values(ns.tracks).filter((t) => trackVisibleTo(req, t)); // v1.80 RBAC
    list = list.concat(projectedLibraryTracks(req, list)); // Wave G projection (v1.242: unconditional - all audio unless channel opted-out)
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    if (search) list = list.filter((t) => musicQuery.matchesSearch(t, search));
    const sortKey = typeof req.query.sort === 'string' ? req.query.sort : '';
    const artists = musicQuery.groupArtists(list, sortKey);
    const total = artists.length;
    const offset = videoQuery.normalizeOffset(req.query.offset);
    const limit = videoQuery.normalizeLimit(req.query.limit);
    res.json({ items: artists.slice(offset, offset + limit), total, offset, limit });
  });

  // v1.211: the "Channels in Music" manager list - every audio-bearing channel the
  // user can SEE, with its current state, so Settings has ONE discoverable place to
  // pick channels (the per-page ♪ was only reachable via one nav path). Static
  // segment - declared BEFORE /api/music/:id (Express route order). Visibility-
  // scoped: only channels with >=1 VISIBLE audio item, and the audioCount is the
  // VISIBLE count (never a restricted-item oracle); `auto`/`effective` are the
  // channel-level booleans the projection uses (single source of truth).
  app.get('/api/music/channels', (req, res) => {
    const db = getCachedDatabase();
    const marks = musicDb.readPart('channels'); // Wave 5: the music_channels table (one table, not four)
    const allAudio = Object.values(db.metadata || {}).filter((it) => it && it.type === 'audio');
    const displayNames = folderDisplayNameStore.getAll(); // Wave 4
    const visibleCount = new Map(); // folderName -> visible audio count
    for (const it of allAudio) {
      if (typeof it.folderName !== 'string' || it.folderName === '') continue;
      if (!mediaVisibleTo(req, it)) continue;
      visibleCount.set(it.folderName, (visibleCount.get(it.folderName) || 0) + 1);
    }
    // v1.242: universal projection - every channel is in Music (auto:true) unless explicitly
    // 'off'. The manager is now an OPT-OUT list; `effective` is on-unless-off.
    const channels = [...visibleCount.entries()].map(([folderName, audioCount]) => ({
      folderName,
      displayName: (typeof displayNames[folderName] === 'string' && displayNames[folderName]) || folderName,
      audioCount,
      override: Object.prototype.hasOwnProperty.call(marks, folderName) ? marks[folderName] : null,
      auto: true,
      effective: libraryAudio.channelEffectiveOnUniversal(folderName, marks),
    }));
    channels.sort((a, b) => a.displayName.localeCompare(b.displayName));
    res.json({ channels });
  });

  // Per-user liked songs (static segment -- declared BEFORE /api/music/:id).
  app.get('/api/music/liked', (req, res) => {
    // v1.80 RBAC: a restricted track's id must not leak into the liked set.
    const ns = musicDb.read();
    const trackIds = userStore.getMusicLiked(req.user.id).filter((id) => trackVisibleTo(req, ownTrack(ns.tracks, id)));
    res.json({ trackIds });
  });

  app.post('/api/music/liked/:id', (req, res) => {
    const ns = musicDb.read();
    if (!ownTrack(ns.tracks, req.params.id)) return res.status(404).json({ error: 'no such track' });
    userStore.addMusicLiked(req.user.id, req.params.id, new Date().toISOString());
    res.json({ liked: true });
  });

  app.delete('/api/music/liked/:id', (req, res) => {
    userStore.removeMusicLiked(req.user.id, req.params.id);
    res.json({ liked: false });
  });

  // The per-user resume pointer (Continue-listening / app-relaunch resume).
  app.get('/api/music/resume', (req, res) => {
    res.json(userStore.getMusicState(req.user.id) || { lastTrackId: null, queueCtx: null, position: null });
  });

  app.post('/api/music/resume', (req, res) => {
    const body = req.body || {};
    const lastTrackId = typeof body.lastTrackId === 'string' ? body.lastTrackId : null;
    const position = Number.isFinite(Number(body.position)) ? Number(body.position) : 0;
    const queueCtx = body.queueCtx === undefined ? null : body.queueCtx;
    userStore.setMusicState(req.user.id, { lastTrackId, queueCtx, position, updatedAt: new Date().toISOString() });
    res.json({ ok: true });
  });
}

function registerTrackRoutes(app, deps) {
  const {
    ALBUMART_DIR,
    THUMBNAIL_DIR, // the projected library track's fallback thumbnail
    armMusicProgressFlushTimerIfNeeded, // assigns server.js's musicProgressFlushTimer `let`
    audioPath,
    contentDispositionAttachment,
    effectiveMusicProgress, // pending-first per-user position
    escapeHtml, // the album-art placeholder's escaping
    fs,
    getCachedDatabase,
    mediaVisibleTo, // the MEDIA gate (projected library audio is a media item)
    musicCodecNeedsTranscode, // still publicTrackListItem's too, and exported
    musicDb,
    musicLikedSets, // M3 chapter likes: {music, media} like sets - a projected row reads the MEDIA store
    musicListProgressMap, // v1.215: the media-store merge for projected tracks
    ownTrack, // the OWN-property track lookup (never a bare tracks[id])
    path,
    pendingMusicProgress, // the music coalescer's staging Map
    pendingProgressKey,
    projectedLibraryTracks, // Wave G: the library-audio projection
    publicTrackListItem,
    queueMusicTranscode, // the music-owned ALAC transcode queue
    recordPresenceFromPing, // v1.78 presence
    sendRangeable,
    trackVisibleTo, // v1.80 RBAC: the per-user visibility gate for tracks
    userStore,
  } = deps;

  // Content types for the /track/:id stream. FLAC/WAV play natively in modern
  // browsers (verify on-device); ALAC (usually in .m4a) rides the T7 transcode.
  const MUSIC_CONTENT_TYPES = {
    '.mp3': 'audio/mpeg',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.flac': 'audio/flac',
    '.wav': 'audio/wav',
  };

  // Square album-art placeholder (album/artist text, escaped exactly like the
  // bookcover placeholder -- a hostile tag must never become markup). Glyph-free
  // (no emoji): a simple record-styled square.
  function musicArtPlaceholderSvg(track) {
    const album = String((track && track.album) || 'Music');
    const artist = String((track && track.artist) || '');
    const clip = (s, n) => (s.length > n ? `${s.substring(0, n - 2)}...` : s);
    return `
    <svg width="240" height="240" viewBox="0 0 240 240" xmlns="http://www.w3.org/2000/svg">
      <rect width="240" height="240" fill="#3a3f58"/>
      <circle cx="120" cy="108" r="52" fill="none" stroke="#8890b5" stroke-width="2"/>
      <circle cx="120" cy="108" r="10" fill="#8890b5"/>
      <text x="120" y="196" font-family="Arial, sans-serif" font-size="15" fill="#e8e8f0" text-anchor="middle" font-weight="bold">${escapeHtml(clip(album, 22))}</text>
      <text x="120" y="216" font-family="Arial, sans-serif" font-size="11" fill="#aab" text-anchor="middle">${escapeHtml(clip(artist, 26))}</text>
    </svg>
  `;
  }

  // Per-track progress ping -> staged into the music coalescer (no disk I/O on
  // the request path). Static 'progress' segment declared BEFORE /api/music/:id.
  app.post('/api/music/progress', (req, res) => {
    const body = req.body || {};
    const id = typeof body.id === 'string' ? body.id : '';
    if (!id) return res.status(400).json({ error: 'id required' });
    // Accept `position` (music-native) OR `timestamp` (the shared player's wire
    // shape, so player.js needs only an endpoint override, not a body change).
    const raw = body.position !== undefined ? body.position : body.timestamp;
    const position = Number.isFinite(Number(raw)) ? Number(raw) : 0;
    const duration = Number.isFinite(Number(body.duration)) ? Number(body.duration) : 0;
    pendingMusicProgress.set(pendingProgressKey(req.user.id, id), {
      userId: req.user.id,
      trackId: id,
      value: { position, duration, updatedAt: new Date().toISOString() },
    });
    armMusicProgressFlushTimerIfNeeded();
    recordPresenceFromPing(req, 'track', id, position, duration); // v1.78 presence
    res.json({ ok: true });
  });

  app.get('/api/music/progress/:id', (req, res) => {
    const p = effectiveMusicProgress(req.user.id, req.params.id) || { position: 0, duration: 0, updatedAt: null };
    // Surface BOTH keys: `position` (music-native) and `timestamp` (the alias the
    // shared player reads) so either consumer works.
    res.json({ position: p.position || 0, timestamp: p.position || 0, duration: p.duration || 0, updatedAt: p.updatedAt || null });
  });

  app.get('/api/music/:id', (req, res) => {
    const ns = musicDb.read();
    const track = ownTrack(ns.tracks, req.params.id);
    if (track) {
      if (!trackVisibleTo(req, track)) return res.status(404).json({ error: 'no such track' }); // v1.80 RBAC
      const likedSets = musicLikedSets(req.user.id);
      const progressMap = userStore.getMusicProgress(req.user.id);
      return res.json(publicTrackListItem(track, req.user.id, likedSets, progressMap));
    }
    // v1.221: a PROJECTED library/chapter id has no native record. Resolve it from
    // the SAME projection the list + search build (RBAC via mediaVisibleTo and the
    // v1.242 unconditional eligibility both live INSIDE projectedLibraryTracks) and match
    // by full id - so a search-tap / deep-link (?play=<id>) of a downloaded track or
    // a chapter plays instead of 404ing. Reusing the projection (not a bespoke id
    // decode) keeps "resolvable" == "appears in the list/search": no second gate to
    // drift out of sync (the two-reader-seam class). A restricted file, or the
    // toggle off, yields no match -> 404, exactly as it is absent from the list.
    const native = Object.values(ns.tracks).filter((t) => trackVisibleTo(req, t));
    const projected = projectedLibraryTracks(req, native).find((t) => t.id === req.params.id);
    if (!projected) return res.status(404).json({ error: 'no such track' });
    const likedSets = musicLikedSets(req.user.id); // M3: a projected row's like is in the MEDIA store
    const progressMap = musicListProgressMap(req.user.id, [projected]); // media-store merge (v1.215)
    res.json(publicTrackListItem(projected, req.user.id, likedSets, progressMap));
  });

  // Range-streamed audio. Native containers stream directly; a probed-ALAC
  // track is served from its cached AAC rendition, transcoding on demand (the
  // AVI->MP4 precedent, audio flavor) and answering 503 until the rendition is
  // ready (the client retries).
  app.get('/track/:id', (req, res) => {
    const ns = musicDb.read();
    const track = ownTrack(ns.tracks, req.params.id);
    if (!track || typeof track.filePath !== 'string') return res.status(404).json({ error: 'no such track' });
    if (!trackVisibleTo(req, track)) return res.status(404).json({ error: 'no such track' }); // v1.80 RBAC: restricted -> 404
    if (!fs.existsSync(track.filePath)) return res.status(404).json({ error: 'file missing' });
    // v1.72 (cap 7): ?download=1 = the app-wide save-to-device affordance
    // (the /video/:id?download=1 / /episode/:id?download=1 pattern). Serves
    // the ORIGINAL bytes with an attachment disposition through the shared
    // injection-safe helper - deliberately BEFORE the transcode branch, so a
    // save always gets the source file (an ALAC master downloads as-is; the
    // browser-compat rendition is a streaming concern, not an archive).
    if (req.query.download === '1') {
      res.setHeader('Content-Disposition', contentDispositionAttachment(track.title || 'track', track.ext));
      const contentType = MUSIC_CONTENT_TYPES[track.ext] || 'application/octet-stream';
      return sendRangeable(req, res, track.filePath, contentType);
    }
    if (musicCodecNeedsTranscode(track.codec)) {
      const rendition = audioPath(track.id);
      if (fs.existsSync(rendition)) {
        sendRangeable(req, res, rendition, 'audio/mp4');
        return;
      }
      queueMusicTranscode(track.id, track.filePath);
      return res.status(503).json({ error: 'transcoding', codec: track.codec });
    }
    const contentType = MUSIC_CONTENT_TYPES[track.ext] || 'application/octet-stream';
    sendRangeable(req, res, track.filePath, contentType);
  });

  // Album art by TRACK id -> its album's art file, else an escaped SVG
  // placeholder (mirrors /bookcover/:id).
  app.get('/albumart/:id', (req, res) => {
    const db = getCachedDatabase();
    const ns = musicDb.read();
    const track = ownTrack(ns.tracks, req.params.id);
    if (track && !trackVisibleTo(req, track)) return res.status(404).json({ error: 'no such track' }); // v1.80 RBAC
    const key = track && typeof track.albumArtKey === 'string' ? track.albumArtKey : null;
    if (key) {
      for (const ext of ['.jpg', '.png']) {
        const p = path.join(ALBUMART_DIR, `${key}${ext}`);
        if (fs.existsSync(p)) {
          // v1.123 T4 (security): `private` - albumart 404s per-user via
          // trackVisibleTo, so a shared cache must not store/replay it cross-user.
          res.set('Cache-Control', 'private, max-age=86400');
          return res.sendFile(p);
        }
      }
    }
    // Wave G: a PROJECTED library-audio track's album/artist tile carries the
    // MEDIA id as its artId (it has no album-art file), so fall back to that
    // item's YouTube thumbnail - real imagery instead of the placeholder. Only a
    // VISIBLE audio item, and only when there is no native track (never overrides
    // a real track's own art resolved above). Mirrors /thumbnail's own gate.
    // v1.222: a virtual chapter-track's id is `<mediaId>::c<idx>` (v1.221) with no
    // file of its own - strip the chapter suffix so its tile/card/recent-tile
    // resolves to the ONE shared file's thumbnail (was the grey placeholder). A
    // plain library-single id has no suffix, so the strip is a no-op. RBAC re-gates
    // the BASE item, so a chapter of a blocked file still 404s to the placeholder.
    if (!track) {
      const baseId = req.params.id.replace(/::c\d+$/, '');
      const item = db.metadata && Object.prototype.hasOwnProperty.call(db.metadata, baseId) ? db.metadata[baseId] : null;
      if (item && item.type === 'audio' && mediaVisibleTo(req, item) && item.hasThumbnail) {
        const thumbPath = path.join(THUMBNAIL_DIR, `${baseId}.jpg`);
        if (fs.existsSync(thumbPath)) {
          res.set('Cache-Control', 'private, max-age=86400');
          return res.sendFile(thumbPath);
        }
      }
    }
    res.set('Content-Type', 'image/svg+xml');
    res.set('Cache-Control', 'private, max-age=3600'); // v1.123 T4: keep the axis uniform behind the auth wall
    res.send(musicArtPlaceholderSvg(track));
  });
}

function registerAudioRoute(app, deps) {
  const {
    audioPath,
    ffmpegIsAvailable, // () => server.js's live `ffmpegAvailable` (see the header)
    fs,
    getCachedDatabase,
    healStaleAudioReady, // F1: heals a stale audioStatus:'ready' (stays in server.js)
    markServed,
    mediaVisibleTo, // v1.80 RBAC: the background-audio byte route's gate
    queueAudioExtract,
    recordServed,
    sendRangeable,
  } = deps;

  // The full 404/503 contract of this route - and the F1 healing it drives -
  // is documented in server.js, in the comment block above healStaleAudioReady
  // (the function this route calls), immediately above the register call.
  app.get('/audio/:id', (req, res) => {
    const db = getCachedDatabase();
    const item = db.metadata[req.params.id];
    if (!item) {
      return res.status(404).json({ error: 'Media file not found' });
    }
    // v1.80 RBAC: the background-audio byte route (easy to miss - separate from
    // /video/:id). Restricted item -> 404.
    if (!mediaVisibleTo(req, item)) {
      return res.status(404).json({ error: 'Media file not found' });
    }
    if (item.type === 'audio') {
      return res.status(404).json({ error: 'Media file not found' });
    }
    const out = audioPath(item.id);
    if (fs.existsSync(out)) {
      return sendRangeable(req, res, out, 'audio/mp4', () => {
        markServed(out);
        // v1.41.6 (gate fix): the SOURCE path too -- a background-audio handoff is
        // an active viewing session, and the import-relocation must not re-key an
        // item out from under the client that is mid-playback. See the same mark
        // in `GET /video/:id` for the full reasoning.
        markServed(item.filePath);
        recordServed(item.id);
      });
    }
    // F1: sidecar confirmed missing -- heal any stale 'ready' NOW. Use the
    // returned (healed) status below, never `item.audioStatus` again -- see
    // healStaleAudioReady's own comment for why `item` must not be mutated.
    const healedAudioStatus = healStaleAudioReady(item);
    if (!ffmpegIsAvailable()) {
      return res.status(503).json({ error: 'ffmpeg unavailable' });
    }
    if (healedAudioStatus !== 'failed') {
      queueAudioExtract(item.id, item.filePath);
    }
    return res.status(503).json({ error: 'extracting', status: healedAudioStatus || 'pending' });
  });
}

module.exports = { registerConfigRoutes, registerLibraryRoutes, registerTrackRoutes, registerAudioRoute };
