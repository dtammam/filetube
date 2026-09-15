'use strict';

// lib/tv/routes.js - the Shows library's HTTP surface: the /api/tv routes
// (folder config, scan control, the shows/season/episode reads, the per-user
// resume + watched latch and Continue Watching, the background-audio pre-warm)
// and the four byte-serving routes /tvthumb, /tvposter, /tvepisode and
// /tvaudio. Moved VERBATIM out of server.js in Wave 7b, slice S4, of the
// relational-migration arc (docs/exec-plans/completed/
// 2026-09-13-sqlite-relational-migration.md): the bodies are byte-identical to
// the server.js originals and keep their source order, with their free
// identifiers resolving from the `deps` bundle server.js hands in at the call
// site - the lib/ytdlp + lib/podcasts registerRoutes pattern. A missing dep is
// a hard failure (a destructured undefined that is later called throws), never
// a silent fallback.
//
// ONE registration function, not two. The five path groups (/api/tv,
// /tvthumb, /tvposter, /tvepisode, /tvaudio) are interleaved with the helpers
// below but NOTHING else registers a route or a middleware layer between the
// first of them (GET /api/tv/config) and the last (GET /tvaudio/:id), so a
// single call at the first route's site leaves every route with exactly the
// layers it had ahead of it and keeps the group's own order
// (scripts/route-order-signature.js is the instrument).
//
// What moved WITH the routes - an espree reference census over server.js shows
// the moved routes (and each other) are the only referrers:
//   - ownEpisode, TV_CONTENT_TYPES, tvPosterPlaceholderSvg;
//   - the whole TV-OWNED transcode lane (tvRenditionPath, tvTranscodeQueue,
//     tvTranscodeBusy, queueTvTranscode, processTvTranscodeQueue) and the
//     TV-OWNED audio-extract lane (tvAudioPath, tvAudioQueue, tvAudioBusy,
//     queueTvAudioExtract, processTvAudioExtractQueue). Their two `let` busy
//     flags move WITH every reader and writer, so no mutable seam crosses the
//     module boundary; the renditions still land in the SHARED TRANSCODE_DIR,
//     whose sweeps find them by filename, never through these helpers.
// What did NOT, and why:
//   - `visibleTvEpisodes` is also read by GET /api/search, so it stays in
//     server.js and crosses as a dep;
//   - `tvThumbPath` is read by the scan pass too (lib/tv/scanRunner.js), so it
//     stays in server.js and crosses to both;
//   - `foldersOverlap` is the shared both-directions root test the media, book
//     and music config routes call as well;
//   - `tvEpisodeVisibleTo` is the single visibility decision, read by
//     visibleTvEpisodes and the search surface too;
//   - `scanTv` owns tvScanState, the deferred re-entry timer and the follow-up
//     budget, and the media scan + the boot path call it;
//   - `tvScanState` crosses as the OBJECT: server.js declares it `let` but
//     never reassigns it (every write is a property write), so the scan routes
//     read and mutate exactly the state currentTvScanState exports.
//
// ONE deliberate exception to byte-identity, in FOUR places (queueTvTranscode,
// queueTvAudioExtract, POST /api/tv/episode/:id/prepare-audio and GET
// /tvaudio/:id): server.js's `ffmpegAvailable` is a MUTABLE `let` that starts
// false and is flipped by an ASYNCHRONOUS boot probe long after these routes
// register, so it crosses as the live reader `ffmpegIsAvailable()` instead of
// a value. Destructuring the value here would freeze it to its boot-time
// false: both queues would silently never start and the two 503 arms would
// answer "ffmpeg unavailable" forever - the v1.185 inert-feature class.
//
// ONE deliberate exception to the uniform two-space re-indent: the
// tvPosterPlaceholderSvg placeholder's multi-line SVG template literal keeps
// its ORIGINAL leading whitespace, because that whitespace is string CONTENT -
// re-indenting it would change the bytes that route serves.

function registerRoutes(app, deps) {
  const {
    DATA_DIR,
    TRANSCODE_CRF,
    TRANSCODE_DIR, // the SHARED transcode cache the tv renditions + sidecars live in
    booksDb,
    buildAudioExtractArgs, // reused unchanged by the tv audio lane
    contentDispositionAttachment,
    escapeHtml,
    ffmpegIsAvailable, // () => the LIVE ffmpegAvailable let (an async boot probe flips it)
    folderStore,
    foldersOverlap, // the shared both-directions root-overlap test
    fs,
    getCachedDatabase,
    markServed, // protects an actively-streaming rendition/sidecar from a cache sweep
    musicDb,
    needsTranscode,
    path,
    podcasts,
    requireAdmin,
    requireModifyLibrary,
    scanTv, // the overlap/coalescing scan guard - still server.js's
    sendRangeable,
    spawn,
    tvDb,
    tvEpisodeVisibleTo, // v1.195 RBAC: the single visibility decision for an episode
    tvParse,
    tvScan,
    tvScanState, // the LIVE scan-state object (currentTvScanState exports the same one)
    tvStore,
    tvThumbPath, // shared with the scan pass (lib/tv/scanRunner.js)
    updateDatabase,
    userStore,
    videoQuery,
    visibleConfigRoots,
    visibleTvEpisodes, // shared with GET /api/search
  } = deps;

  app.get('/api/tv/config', (req, res) => {
    // GATED (route-read-classification): the nav gate reads this, so a restricted
    // member sees only roots holding >=1 visible episode; admin + unrestricted member
    // get the list byte-identical (visibleConfigRoots short-circuits when no restriction).
    const ns = tvDb.read();
    res.json({ folders: visibleConfigRoots(req, ns.folders || [], Object.values(ns.episodes || {}), tvEpisodeVisibleTo) });
  });

  app.post('/api/tv/config', async (req, res) => {
    if (!requireAdmin(req, res)) return; // library config is admin-only (write-RBAC)
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
    // HARD INVARIANT: a Shows root may never overlap a media/book/music/podcast root,
    // in EITHER direction (one owner per file). This is the TV-side of the net; the
    // reciprocal clauses in the media/book/music/podcast config routes close the
    // other direction (adding one of THOSE under a Shows root).
    const cached = getCachedDatabase();
    const mediaFolders = folderStore.list().map((f) => path.resolve(f)); // Wave 4: the root list is a table
    const bookFolders = (booksDb.read().folders || []).map((f) => path.resolve(f));
    const musicFolders = (musicDb.read().folders || []).map((f) => path.resolve(f));
    const podcastsRoot = podcasts.resolvePodcastsRoot(cached, { dataDir: DATA_DIR });
    for (const tvRoot of resolved) {
      for (const mediaRoot of mediaFolders) {
        if (foldersOverlap(tvRoot, mediaRoot)) return res.status(400).json({ error: `Shows folder overlaps a media folder: ${tvRoot} <-> ${mediaRoot}` });
      }
      for (const bookRoot of bookFolders) {
        if (foldersOverlap(tvRoot, bookRoot)) return res.status(400).json({ error: `Shows folder overlaps a book folder: ${tvRoot} <-> ${bookRoot}` });
      }
      for (const musicRoot of musicFolders) {
        if (foldersOverlap(tvRoot, musicRoot)) return res.status(400).json({ error: `Shows folder overlaps a music folder: ${tvRoot} <-> ${musicRoot}` });
      }
      if (foldersOverlap(tvRoot, podcastsRoot)) return res.status(400).json({ error: `Shows folder overlaps the podcasts folder: ${tvRoot} <-> ${podcastsRoot}` });
    }
    try {
      await updateDatabase(() => tvDb.mutate((h) => { tvStore.ensureTv(h).folders = resolved; return true; })); // Wave 5: the diff rides the commit
    } catch (err) {
      return res.status(500).json({ error: `Could not save Shows folders: ${err.message}` });
    }
    res.json({ folders: resolved });
    scanTv().catch(console.error);
  });

  app.post('/api/tv/scan', (req, res) => {
    if (!requireModifyLibrary(req, res)) return; // write-RBAC (first guard)
    const alreadyInProgress = tvScanState.scanning;
    if (alreadyInProgress) tvScanState.rescanRequested = true;
    else scanTv().catch(console.error);
    res.status(202).json({ scanning: true, alreadyInProgress });
  });

  app.get('/api/tv/scan-status', (req, res) => { res.json(tvScanState); });

  // ---- TV Shows: read/browse APIs + poster/episode serving (Phase 3c) ----------

  // OWN-property episode lookup (prototype-pollution defense, the ownTrack posture):
  // a crafted id like '__proto__' must never resolve to an inherited object.
  function ownEpisode(episodes, id) {
    return (episodes && Object.prototype.hasOwnProperty.call(episodes, id)) ? episodes[id] : null;
  }

  const TV_CONTENT_TYPES = {
    '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm',
    '.mkv': 'video/x-matroska', '.mov': 'video/quicktime', '.avi': 'video/x-msvideo',
    '.flv': 'video/x-flv', '.wmv': 'video/x-ms-wmv', '.mpg': 'video/mpeg', '.mpeg': 'video/mpeg',
  };

  // A TV-OWNED transcode queue (never the video queue, which writes
  // db.metadata[id].transcodeStatus - a tv id would pollute the video namespace).
  // The music-transcode posture verbatim: renditions land at tvRenditionPath(id) in
  // TRANSCODE_DIR (shared cache management for free), readiness by FILE EXISTENCE
  // alone (no db write on the hot path), the video H.264+AAC+faststart args.
  function tvRenditionPath(id) { return path.join(TRANSCODE_DIR, `tv-${id}.mp4`); }
  const tvTranscodeQueue = [];
  let tvTranscodeBusy = false;
  function queueTvTranscode(id, srcPath) {
    if (!ffmpegIsAvailable()) return;
    if (tvTranscodeQueue.some((job) => job.id === id)) return;
    tvTranscodeQueue.push({ id, srcPath });
    processTvTranscodeQueue();
  }
  function processTvTranscodeQueue() {
    if (tvTranscodeBusy || tvTranscodeQueue.length === 0) return;
    const { id, srcPath } = tvTranscodeQueue.shift();
    if (!fs.existsSync(srcPath)) { processTvTranscodeQueue(); return; }
    const outPath = tvRenditionPath(id);
    if (fs.existsSync(outPath)) { processTvTranscodeQueue(); return; }
    tvTranscodeBusy = true;
    const tmpPath = `${outPath}.tmp.mp4`;
    let proc;
    try {
      proc = spawn('ffmpeg', ['-i', srcPath, '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', String(TRANSCODE_CRF), '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-ac', '2', '-movflags', '+faststart', '-y', tmpPath]);
    } catch (e) {
      console.error(`tv: failed to start transcode for ${srcPath}:`, e.message);
      tvTranscodeBusy = false; processTvTranscodeQueue(); return;
    }
    proc.stderr.on('data', () => { /* drain */ });
    proc.on('error', (e) => {
      console.error(`tv: transcode process error for ${srcPath}:`, e.message);
      try { fs.unlinkSync(tmpPath); } catch (_) { /* best-effort */ }
      tvTranscodeBusy = false; processTvTranscodeQueue();
    });
    proc.on('close', (code) => {
      tvTranscodeBusy = false;
      if (code === 0) {
        try { fs.renameSync(tmpPath, outPath); } catch (e) { try { fs.unlinkSync(tmpPath); } catch (_) { /* best-effort */ } }
      } else {
        console.error(`tv: transcode failed (exit ${code}) for ${srcPath}`);
        try { fs.unlinkSync(tmpPath); } catch (_) { /* best-effort */ }
      }
      processTvTranscodeQueue();
    });
  }

  // v1.197 (W3): the TV episode AUDIO-EXTRACTION sidecar - the background-audio
  // handoff's `/tvaudio/:id` bytes. Mirrors the music ALAC queue verbatim (its own
  // single-flight lane; an episode's sidecar must not queue behind a long video
  // transcode), REUSING buildAudioExtractArgs unchanged (pure (srcPath, tmpPath) -
  // the same reuse the music queue already proved). Readiness is FILE EXISTENCE
  // only - never db.metadata's audioStatus machinery (setAudioStatus/
  // healStaleAudioReady are metadata-bound; skipping them eliminates the
  // stale-'ready' class by construction, the tv/music queue posture). The
  // `tv-<id>.m4a` name rides the shared TRANSCODE_DIR cache: isCompletedTranscode/
  // isInFlightTranscode pick it up for free (LRU eviction, age sweep, orphan
  // cleanup, markServed protection); the eviction paths' clearAudioStatus no-ops
  // on a tv key (not in db.metadata) and the preExtractAudio pin correctly skips
  // it (metadata-membership test) - both the music posture.
  function tvAudioPath(id) { return path.join(TRANSCODE_DIR, `tv-${id}.m4a`); }
  const tvAudioQueue = [];
  let tvAudioBusy = false;
  function queueTvAudioExtract(id, srcPath) {
    if (!ffmpegIsAvailable()) return;
    if (tvAudioQueue.some((job) => job.id === id)) return; // already queued
    tvAudioQueue.push({ id, srcPath });
    processTvAudioExtractQueue();
  }
  function processTvAudioExtractQueue() {
    if (tvAudioBusy || tvAudioQueue.length === 0) return;
    const { id, srcPath } = tvAudioQueue.shift();
    if (!fs.existsSync(srcPath)) { processTvAudioExtractQueue(); return; }
    const outPath = tvAudioPath(id);
    if (fs.existsSync(outPath)) { processTvAudioExtractQueue(); return; }
    tvAudioBusy = true;
    const tmpPath = `${outPath}.tmp.m4a`;
    let proc;
    try {
      proc = spawn('ffmpeg', buildAudioExtractArgs(srcPath, tmpPath));
    } catch (e) {
      console.error(`tv: failed to start audio extract for ${srcPath}:`, e.message);
      tvAudioBusy = false;
      processTvAudioExtractQueue();
      return;
    }
    proc.stderr.on('data', () => { /* drain */ });
    proc.on('error', (e) => {
      console.error(`tv: audio extract process error for ${srcPath}:`, e.message);
      try { fs.unlinkSync(tmpPath); } catch (_) { /* best-effort */ }
      tvAudioBusy = false;
      processTvAudioExtractQueue();
    });
    proc.on('close', (code) => {
      tvAudioBusy = false;
      if (code === 0) {
        try { fs.renameSync(tmpPath, outPath); } catch (e) {
          console.error(`tv: could not finalize audio sidecar for ${srcPath}:`, e.message);
          try { fs.unlinkSync(tmpPath); } catch (_) { /* best-effort */ }
        }
      } else {
        console.error(`tv: audio extract failed (exit ${code}) for ${srcPath}`);
        try { fs.unlinkSync(tmpPath); } catch (_) { /* best-effort */ }
      }
      processTvAudioExtractQueue();
    });
  }

  function tvPosterPlaceholderSvg(name) {
    const title = String(name || 'Show');
    const clip = (s, n) => (s.length > n ? `${s.substring(0, n - 2)}...` : s);
    return `
    <svg width="300" height="450" viewBox="0 0 300 450" xmlns="http://www.w3.org/2000/svg">
      <rect width="300" height="450" fill="#2b3049"/>
      <rect x="110" y="150" width="80" height="110" rx="6" fill="none" stroke="#8890b5" stroke-width="3"/>
      <text x="150" y="330" font-family="Arial, sans-serif" font-size="18" fill="#e8e8f0" text-anchor="middle" font-weight="bold">${escapeHtml(clip(title, 22))}</text>
    </svg>`;
  }

  app.get('/api/tv', (req, res) => {
    // GATED: the shows grid, over ONLY the episodes this requester may see.
    res.json({ shows: tvParse.groupShows(visibleTvEpisodes(req)) });
  });

  // v1.196 (player integration): the per-episode DETAIL + transcode-STATUS endpoint.
  // Shaped like GET /api/videos/:id so the shared player (public/js/player.js) can
  // drive an episode through the SAME load/poll/overlay path a video uses: `type`,
  // `needsTranscode` (the codec-aware form), `transcodeStatus` (live from rendition
  // existence so the player's poll flips to 'ready'), `duration`, plus the tv-source
  // descriptor fields (`streamSrc`/`statusUrl`/`artUrl`) that keep the player OFF the
  // /api/videos + /video routes (that id is not in db.metadata). GATED: a restricted
  // or absent episode is 404 (no title/existence oracle), same as /tvepisode/:id.
  // Static segment 'episode' registered BEFORE /api/tv/:showId (route-order scar).
  app.get('/api/tv/episode/:id', (req, res) => {
    const ns = tvDb.read();
    const ep = ownEpisode(ns.episodes, req.params.id);
    if (!ep || typeof ep.filePath !== 'string') return res.status(404).json({ error: 'no such episode' });
    if (!tvEpisodeVisibleTo(req, ep)) return res.status(404).json({ error: 'no such episode' }); // RBAC: restricted -> 404
    const transcodes = needsTranscode(ep.ext, ep.codec, ep.audioCodec);
    res.json({
      id: ep.id,
      type: 'video',
      title: ep.title || (ep.episodeNum != null ? `Episode ${ep.episodeNum}` : (ep.showName || 'Episode')),
      showId: ep.showId,
      showName: ep.showName || '',
      seasonNum: ep.seasonNum,
      episodeNum: ep.episodeNum,
      duration: ep.durationSec || 0,
      durationSec: ep.durationSec || 0,
      needsTranscode: transcodes,
      // Live readiness so pollTranscodeUntilReady sees 'ready' the moment the
      // TV-owned rendition lands (only meaningful when needsTranscode is true).
      transcodeStatus: transcodes ? (fs.existsSync(tvRenditionPath(ep.id)) ? 'ready' : 'pending') : 'ready',
      // The tv source descriptor: the player streams + polls THESE, never /video or
      // /api/videos. streamSrc serves the raw file or the rendition (transcode-503
      // handled by /tvepisode itself); statusUrl re-hits THIS route for the poll.
      streamSrc: `/tvepisode/${encodeURIComponent(ep.id)}`,
      statusUrl: `/api/tv/episode/${encodeURIComponent(ep.id)}`,
      artUrl: `/tvposter/${encodeURIComponent(ep.showId)}`,
      // v1.197 (W3): the background-audio descriptor trio. audioStatus is LIVE
      // sidecar file-existence (the transcodeStatus trick above); the player's
      // handoff machinery reads audioSrc/prepareAudioUrl instead of the video
      // routes (/audio/:id + /api/videos/:id/prepare-audio).
      audioStatus: fs.existsSync(tvAudioPath(ep.id)) ? 'ready' : 'pending',
      audioSrc: `/tvaudio/${encodeURIComponent(ep.id)}`,
      prepareAudioUrl: `/api/tv/episode/${encodeURIComponent(ep.id)}/prepare-audio`,
      // v1.197 (W2): the watch-page description panel's display fields. fileName is
      // the BASENAME only - the full filesystem path is never sent (tighter than
      // the video payload); addedAtMs normalized to epoch ms for the shared
      // formatRelativeTime formatter (records persist addedAt as an ISO string).
      sizeBytes: typeof ep.size === 'number' ? ep.size : 0,
      addedAtMs: typeof ep.addedAt === 'number' ? ep.addedAt : (Date.parse(ep.addedAt) || 0),
      fileName: path.basename(ep.filePath),
      ext: ep.ext, // the Type field (both gate seats: it was consumed internally but never sent - Type always painted the fallback)
      // v1.196 (Phase B): the signed-in user's resume position + watched latch, so
      // the player's resume overlay + the row's watched tick reflect real state.
      progress: (userStore.getOneTvProgress(req.user.id, ep.id) || {}).position || 0,
      watched: Object.prototype.hasOwnProperty.call(userStore.getTvPlayed(req.user.id), ep.id),
    });
  });

  // v1.197 (W3): the background-audio pre-warm - the /api/videos/:id/prepare-audio
  // posture verbatim: GATED (a restricted episode must not be an existence oracle
  // or a CPU sink), never serves bytes, idempotent (sidecar on disk -> 'ready';
  // else enqueue -> 'pending'; ffmpeg absent -> the queue no-ops and the client's
  // repoll simply never resolves to ready - fail-safe, feature stays off).
  // Registered BEFORE /api/tv/:showId (the route-order scar).
  app.post('/api/tv/episode/:id/prepare-audio', (req, res) => {
    const ns = tvDb.read();
    const ep = ownEpisode(ns.episodes, req.params.id);
    if (!ep || typeof ep.filePath !== 'string') return res.status(404).json({ error: 'no such episode' });
    if (!tvEpisodeVisibleTo(req, ep)) return res.status(404).json({ error: 'no such episode' }); // RBAC: restricted -> 404
    if (fs.existsSync(tvAudioPath(ep.id))) return res.json({ audioStatus: 'ready' });
    // ffmpeg-less install: 503 like the video pair (a 200 'pending' would send the
    // client's bounded repoll on a futile ~60s chain; a non-ok ends it immediately).
    if (!ffmpegIsAvailable()) return res.status(503).json({ error: 'ffmpeg unavailable' });
    queueTvAudioExtract(ep.id, ep.filePath);
    res.json({ audioStatus: 'pending' });
  });

  // v1.196 (Phase B): per-user resume + watched latch + Continue-Watching. Personal
  // writes, each gated to episodes the requester may see (no cross-user oracle, no
  // writing progress for a hidden episode). Static segments, before /api/tv/:showId.
  app.post('/api/tv/progress', (req, res) => {
    // Body shape matches the shared player's saveProgressToServer ({id, timestamp,
    // duration}) exactly, like /api/music/progress + /api/podcasts/progress - the
    // player is the one write site (its `progressEndpoint` descriptor field points
    // here for a tv source).
    const { id, timestamp, duration } = req.body || {};
    if (typeof id !== 'string' || id === '') return res.status(400).json({ error: 'id required' });
    const ns = tvDb.read();
    const ep = ownEpisode(ns.episodes, id);
    if (!ep || !tvEpisodeVisibleTo(req, ep)) return res.status(404).json({ error: 'no such episode' });
    const pos = Number(timestamp) || 0;
    const dur = Number(duration) || ep.durationSec || 0;
    userStore.setTvProgress(req.user.id, id, { position: pos, duration: dur, updatedAt: new Date().toISOString() });
    // O2: auto-mark watched once the position crosses the shared threshold (90%).
    if (dur > 0 && (pos / dur) * 100 >= videoQuery.WATCHED_PCT) {
      userStore.setTvPlayed(req.user.id, id, new Date().toISOString());
    }
    res.json({ success: true });
  });

  app.post('/api/tv/played', (req, res) => {
    const { episodeId } = req.body || {};
    if (typeof episodeId !== 'string' || episodeId === '') return res.status(400).json({ error: 'episodeId required' });
    const ns = tvDb.read();
    const ep = ownEpisode(ns.episodes, episodeId);
    if (!ep || !tvEpisodeVisibleTo(req, ep)) return res.status(404).json({ error: 'no such episode' });
    userStore.setTvPlayed(req.user.id, episodeId, new Date().toISOString());
    res.json({ success: true, watched: true });
  });

  app.delete('/api/tv/played', (req, res) => {
    const { episodeId } = req.body || {};
    if (typeof episodeId !== 'string' || episodeId === '') return res.status(400).json({ error: 'episodeId required' });
    // Un-watch deletes ONLY the requester's own row (a hidden episode simply has
    // none), so no visibility oracle is exposed by skipping the existence gate.
    userStore.clearTvPlayed(req.user.id, episodeId);
    res.json({ success: true, watched: false });
  });

  app.get('/api/tv/continue', (req, res) => {
    // GATED: the requester's in-progress episodes (a resume position, not finished,
    // not watched), over ONLY episodes they may see, most-recent activity first,
    // joined with the episode's display fields. Powers the Shows-home Continue row.
    const ns = tvDb.read();
    const progress = userStore.getTvProgress(req.user.id);
    const played = userStore.getTvPlayed(req.user.id);
    const rows = [];
    for (const id of Object.keys(progress)) {
      const ep = ownEpisode(ns.episodes, id);
      if (!ep || !tvEpisodeVisibleTo(req, ep)) continue;
      if (Object.prototype.hasOwnProperty.call(played, id)) continue; // finished
      const p = progress[id];
      const pos = Number(p.position) || 0;
      const dur = Number(p.duration) || ep.durationSec || 0;
      if (pos <= 0) continue; // never really started
      if (dur > 0 && (pos / dur) * 100 >= videoQuery.WATCHED_PCT) continue; // effectively done
      rows.push({
        id: ep.id, showId: ep.showId, showName: ep.showName, seasonNum: ep.seasonNum,
        episodeNum: ep.episodeNum, title: ep.title, durationSec: dur, position: pos,
        updatedAt: p.updatedAt || '',
      });
    }
    rows.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    res.json({ episodes: rows });
  });

  app.get('/api/tv/:showId', (req, res) => {
    const eps = visibleTvEpisodes(req);
    const seasons = tvParse.groupSeasons(eps, req.params.showId);
    if (seasons.length === 0) return res.status(404).json({ error: 'no such show' });
    const first = eps.find((e) => e.showId === req.params.showId);
    res.json({
      id: req.params.showId,
      name: (first && first.showName) || '',
      seasons: seasons.map((s) => ({
        seasonNum: s.seasonNum,
        label: s.label,
        episodes: s.episodes.map((e) => ({
          id: e.id, seasonNum: e.seasonNum, episodeNum: e.episodeNum, title: e.title,
          durationSec: e.durationSec || 0,
          // v1.199 (Roku): the channel builds its playback queue from THIS payload,
          // so each row carries what startPlaybackFlow needs - the codec-aware
          // transcode flag (rendition -> mp4 demuxer), the extension (mkv streams
          // as mkv), and the REQUESTER's own resume position (same per-user read
          // as /api/tv/episode/:id - no cross-user leak).
          ext: e.ext,
          // Codec strings (absent when never probed) so the channel's playback-
          // error line can name them instead of claiming "codecs unrecorded".
          codec: e.codec, audioCodec: e.audioCodec,
          needsTranscode: needsTranscode(e.ext, e.codec, e.audioCodec),
          progress: (userStore.getOneTvProgress(req.user.id, e.id) || {}).position || 0,
        })),
      })),
    });
  });

  // v1.198.1 (Dean: the episode "Up next" rail): per-EPISODE art. The generated
  // ffmpeg frame when it exists, else the show's folder poster, else the SVG
  // placeholder - never a broken img. Gated exactly like /tvepisode (restricted or
  // absent -> 404, no oracle); private-cached like /tvposter.
  app.get('/tvthumb/:id', (req, res) => {
    const ns = tvDb.read();
    const ep = ownEpisode(ns.episodes, req.params.id);
    if (!ep || typeof ep.filePath !== 'string') return res.status(404).json({ error: 'no such episode' });
    if (!tvEpisodeVisibleTo(req, ep)) return res.status(404).json({ error: 'no such episode' }); // RBAC: restricted -> 404
    res.set('Cache-Control', 'private, max-age=3600');
    const t = tvThumbPath(ep.id);
    if (fs.existsSync(t)) return res.sendFile(t);
    const poster = tvScan.findShowPoster(ep.showPath);
    if (poster && fs.existsSync(poster)) return res.sendFile(poster);
    res.set('Content-Type', 'image/svg+xml');
    res.send(tvPosterPlaceholderSvg(ep.showName));
  });

  app.get('/tvposter/:showId', (req, res) => {
    const eps = visibleTvEpisodes(req).filter((e) => e.showId === req.params.showId);
    res.set('Cache-Control', 'private, max-age=3600'); // RBAC: keep behind the auth wall
    if (eps.length > 0) {
      const poster = tvScan.findShowPoster(eps[0].showPath);
      if (poster && fs.existsSync(poster)) return res.sendFile(poster);
      // Fallback: the earliest episode's generated thumbnail. Order via groupSeasons'
      // null-safe season/episode keys (a raw `a.seasonNum - b.seasonNum` coerces an
      // Extras episode's null seasonNum to NaN -> a nondeterministic representative).
      const ordered = tvParse.groupSeasons(eps, req.params.showId);
      const rep = ordered[0] && ordered[0].episodes[0];
      if (rep) { const t = tvThumbPath(rep.id); if (fs.existsSync(t)) return res.sendFile(t); }
    }
    res.set('Content-Type', 'image/svg+xml');
    res.send(tvPosterPlaceholderSvg(eps[0] && eps[0].showName));
  });

  app.get('/tvepisode/:id', (req, res) => {
    const ns = tvDb.read();
    const ep = ownEpisode(ns.episodes, req.params.id);
    if (!ep || typeof ep.filePath !== 'string') return res.status(404).json({ error: 'no such episode' });
    if (!tvEpisodeVisibleTo(req, ep)) return res.status(404).json({ error: 'no such episode' }); // RBAC: restricted -> 404
    if (!fs.existsSync(ep.filePath)) return res.status(404).json({ error: 'file missing' });
    const contentType = TV_CONTENT_TYPES[ep.ext] || 'video/mp4';
    // ?download=1: the app-wide save-to-device affordance -> ORIGINAL bytes.
    if (req.query.download === '1') {
      res.setHeader('Content-Disposition', contentDispositionAttachment(ep.title || ep.showName || 'episode', ep.ext));
      return sendRangeable(req, res, ep.filePath, contentType, () => markServed(ep.filePath));
    }
    // Browser-incompatible CONTAINER *or* CODEC -> the TV-owned MP4 rendition
    // (transcode on demand). Codec-aware, mirroring the main video serve path: an
    // HEVC-video or AC3/DTS-audio episode in a native container (.mp4/.mov/.m4v) is
    // the single most common TV-rip shape and would otherwise be served raw and
    // never decode (the client would retry forever). ep.codec is the VIDEO codec.
    if (needsTranscode(ep.ext, ep.codec, ep.audioCodec)) {
      const rendition = tvRenditionPath(ep.id);
      // Serving the cached rendition? Mark it live-watched so the SHARED transcode
      // cache's LRU/age eviction (evictTranscodeCache/sweepAgedTranscodes, which
      // count tv-<id>.mp4 as a completed rendition) never unlinks it mid-stream -
      // the recentlyServed race guard the main video path relies on.
      if (fs.existsSync(rendition)) return sendRangeable(req, res, rendition, 'video/mp4', () => markServed(rendition));
      queueTvTranscode(ep.id, ep.filePath);
      return res.status(503).json({ error: 'transcoding', ext: ep.ext });
    }
    sendRangeable(req, res, ep.filePath, contentType, () => markServed(ep.filePath));
  });

  // v1.197 (W3): the episode's extracted-audio sidecar bytes - the /audio/:id
  // posture with tv-owned mechanics: same gate as /tvepisode (restricted -> 404),
  // range-served with mid-stream eviction protection (markServed on the sidecar
  // AND the source, the video route's exact shape); absent -> enqueue the extract
  // and 503 {error:'extracting'} (the client's repoll converges on 'ready').
  app.get('/tvaudio/:id', (req, res) => {
    const ns = tvDb.read();
    const ep = ownEpisode(ns.episodes, req.params.id);
    if (!ep || typeof ep.filePath !== 'string') return res.status(404).json({ error: 'no such episode' });
    if (!tvEpisodeVisibleTo(req, ep)) return res.status(404).json({ error: 'no such episode' }); // RBAC: restricted -> 404
    const sidecar = tvAudioPath(ep.id);
    if (fs.existsSync(sidecar)) {
      return sendRangeable(req, res, sidecar, 'audio/mp4', () => { markServed(sidecar); markServed(ep.filePath); });
    }
    if (!fs.existsSync(ep.filePath)) return res.status(404).json({ error: 'file missing' });
    if (!ffmpegIsAvailable()) return res.status(503).json({ error: 'ffmpeg unavailable' });
    queueTvAudioExtract(ep.id, ep.filePath);
    res.status(503).json({ error: 'extracting' });
  });
}

module.exports = { registerRoutes };
