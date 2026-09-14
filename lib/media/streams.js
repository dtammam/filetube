'use strict';

// lib/media/streams.js - the byte-stream ROUTES (/thumbnail, /storyboard, /preview,
// /video) and the shared Range-request helper `sendRangeable`, moved VERBATIM out of
// server.js in Wave 7b (slice S8) of the relational-migration arc. Two exports:
//   - `createMediaStreams(deps)` returns { sendRangeable } - server.js builds it once
//     and feeds the same function to the /video route here AND to the lib/tv and
//     lib/music audio routes (they share the exact Range mechanics), and re-exports it.
//   - `registerRoutes(app, deps)` registers the four routes in their original order.
// Every body is byte-identical to the server.js original; free identifiers resolve
// from the `deps` destructure. A missing dep is a hard failure, never a fallback.

function createMediaStreams(deps) {
  const { fs, pipeline, registerMediaStream } = deps;
  // Shared Range-request byte-serving helper (v1.27.0), factored out of
  // GET /video/:id's own Range-parsing/response-header logic so GET /audio/:id
  // (the background-audio sidecar, below) can reuse the EXACT same mechanics
  // rather than a forked copy that could silently drift. This owns ONLY the
  // bytes-on-disk half: the existence check (-> 404 "File does not exist on
  // disk", the same message/shape `/video/:id` already returns) and the
  // Range vs. whole-file response. It does NOT do any id -> filePath
  // resolution, db lookups, or the 404-on-unknown-id/503-in-progress handling
  // -- callers own those (they differ meaningfully between /video/:id's
  // transcode-in-progress branch and /audio/:id's extract-in-progress branch).
  // `onServe(filePath)`, when provided, is invoked once the file is confirmed
  // to exist and BEFORE any header is written -- both call sites use it for
  // the existing markServed/recordServed live-watch protection.
  //
  // `/video/:id` is regression-locked to be byte-identical before/after this
  // refactor (see test/integration/download-media.test.js and
  // test/integration/audio-endpoint.test.js's own /video/:id parity checks).
  function sendRangeable(req, res, filePath, contentType, onServe) {
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File does not exist on disk' });
    }
    if (onServe) onServe(filePath);

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      // F4 (two-reviewer gate): a malformed/reversed Range header (e.g.
      // `bytes=10-3` [end < start], `bytes=potato` [non-numeric -> NaN], or
      // `bytes=-5` [a suffix-range shape this simple parser doesn't support --
      // parses to a NaN start]) used to fall straight through to
      // `fs.createReadStream(filePath, { start, end })` with a NaN or
      // nonsensical range. That either threw synchronously -- an unhandled
      // exception Express's default error handler turns into a 500 whose body
      // includes a stack trace (leaking this server's absolute filesystem
      // paths) to an UNAUTHENTICATED caller -- or produced an undefined
      // stream. This was pre-existing on `/video/:id`; sharing this helper
      // makes it newly reachable on `/audio/:id` too, so it's fixed once, here,
      // for both. Every malformed shape (including the pre-existing
      // out-of-bounds `start >= fileSize` case) is now rejected the SAME way:
      // 416, with a `Content-Range: bytes */<size>` header giving the complete
      // length, per RFC 7233 §4.4 ("MUST send a Content-Range header field
      // with an unsatisfied-range value" alongside a 416) -- one unified,
      // spec-compliant shape rather than two different bodies for two
      // different malformed-input classes.
      if (Number.isNaN(start) || Number.isNaN(end) || start < 0 || end < start || start >= fileSize) {
        res.status(416).set('Content-Range', `bytes */${fileSize}`).send('Requested range not satisfiable');
        return;
      }

      const chunksize = (end - start) + 1;
      const file = fs.createReadStream(filePath, { start, end });
      registerMediaStream(filePath, file);
      const head = {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': contentType,
      };

      res.writeHead(206, head);
      // pipeline, NOT .pipe(): destroys `file` when the response goes away first
      // (every seek aborts the previous Range request) -- see the registry header
      // above. The error argument is deliberately ignored: a premature client
      // close is routine, and a mid-stream read error already destroyed both ends.
      pipeline(file, res, () => {});
    } else {
      const head = {
        'Content-Length': fileSize,
        'Content-Type': contentType,
      };
      res.writeHead(200, head);
      const file = fs.createReadStream(filePath);
      registerMediaStream(filePath, file);
      pipeline(file, res, () => {});
    }
  }
  return { sendRangeable };
}

function registerRoutes(app, deps) {
  const {
    getCachedDatabase,
    mediaVisibleTo,
    trashStore,
    THUMBNAIL_DIR,
    escapeHtml,
    path,
    fs,
    storyboardPath,
    storyboardDescriptor,
    previewClipPath,
    previewClipEligible,
    transcodedPath,
    queueTranscode,
    resolveRokuCompat,
    streamLiveTranscode,
    markServed,
    recordServed,
    mime,
    contentDispositionAttachment,
    sendRangeable,
  } = deps;
  // Serve extracted thumbnail or fallback placeholder
  app.get('/thumbnail/:id', (req, res) => {
    const db = getCachedDatabase(); // v1.30 A3 (AC3.3 headline route): hot GET reader
    // v1.65 gate fix (QA W1): a TRASHED item's thumbnail sidecar re-keyed to
    // the trashId, but this route required a live metadata entry -- so the
    // Trash view's rows always fell to the SVG placeholder. A media_trash
    // record's snapshot is as good an authority for its own id.
    const trashRec = !Object.prototype.hasOwnProperty.call(db.metadata, req.params.id)
      ? (trashStore.get(req.params.id) || null) // Wave 3: the table
      : null;
    const item = db.metadata[req.params.id] || (trashRec && trashRec.item) || undefined;
    // v1.80 RBAC: never serve a restricted item's thumbnail (it reveals the
    // content visually). Resolves via metadata OR the trash snapshot, so the
    // check must run on either source.
    if (item && !mediaVisibleTo(req, item)) {
      return res.status(404).json({ error: 'Media file not found' });
    }
    const thumbPath = path.join(THUMBNAIL_DIR, `${req.params.id}.jpg`);

    if (item && item.hasThumbnail && fs.existsSync(thumbPath)) {
      // v1.46: real thumbnails are content-addressed by media id and only
      // change on a rescan -- let clients (the Roku grid especially) cache
      // them for a day instead of re-fetching on every scroll-back. `private`
      // because everything behind the auth wall is per-instance content.
      res.setHeader('Cache-Control', 'private, max-age=86400');
      return res.sendFile(thumbPath);
    }

    // Fallback: Generate SVG placeholder based on whether it is audio or video
    const isAudio = item ? item.type === 'audio' : false;
    // v1.65 gate round 2 (adversarial W5): a trash record's snapshot may lack
    // a string title (an orphan record, or a sparse bundle record) -- the
    // placeholder path below calls title.length and 500'd on it.
    const title = (item && typeof item.title === 'string' && item.title !== '') ? item.title : 'Media';
    const bgColor = isAudio ? '#2b3e50' : '#4a154b';
    const icon = isAudio ? 
      `<path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" fill="#ffffff"/>` : 
      `<path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" fill="#ffffff"/>`;

    const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 90" width="160" height="90">
      <rect width="160" height="90" fill="${bgColor}"/>
      <g transform="translate(68, 20) scale(1.2)">
        ${icon}
      </g>
      <text x="80" y="70" font-family="Arial, sans-serif" font-size="7" fill="#cccccc" text-anchor="middle" font-weight="bold">
        ${escapeHtml(title.length > 25 ? title.substring(0, 22) + '...' : title)}
      </text>
      <text x="80" y="80" font-family="Arial, sans-serif" font-size="5" fill="#888888" text-anchor="middle">
        ${isAudio ? 'AUDIO' : 'VIDEO'}
      </text>
    </svg>
  `;

    res.setHeader('Content-Type', 'image/svg+xml');
    res.send(svg);
  });
  // v1.92: GET /storyboard/:id - serve the scrub/card storyboard sprite JPEG.
  // Mirrors /thumbnail/:id's RBAC exactly (resolve via metadata OR a trash
  // snapshot; a restricted item 404s like a missing one so the route reveals
  // nothing) but has NO placeholder fallback: a 404 means "no preview" and the
  // client silently degrades to the static poster. Content-addressed by media id
  // (only changes on rescan) -> the same day-long private cache as the thumbnail.
  app.get('/storyboard/:id', (req, res) => {
    const db = getCachedDatabase(); // hot GET reader
    const trashRec = !Object.prototype.hasOwnProperty.call(db.metadata, req.params.id)
      ? (trashStore.get(req.params.id) || null) // Wave 3: the table
      : null;
    const item = db.metadata[req.params.id] || (trashRec && trashRec.item) || undefined;
    if (item && !mediaVisibleTo(req, item)) { // RBAC: restricted -> 404 like missing
      return res.status(404).json({ error: 'Media file not found' });
    }
    const sbPath = storyboardPath(req.params.id);
    // v1.93.2: serve when the item is storyboard-ELIGIBLE (derived, not a
    // persisted flag) and the sprite is on disk. Ineligible items (audio/too
    // short) never have a valid sprite for this id, so the eligibility gate keeps
    // a stale sidecar from serving.
    if (item && storyboardDescriptor(item) && fs.existsSync(sbPath)) {
      res.setHeader('Cache-Control', 'private, max-age=86400');
      return res.sendFile(sbPath);
    }
    return res.status(404).json({ error: 'No storyboard' });
  });
  // v1.94: GET /preview/:id - serve the animated hover PREVIEW CLIP (muted MP4).
  // Same RBAC + disk-keyed model as /storyboard: resolve via metadata OR a trash
  // snapshot; restricted -> 404 like missing; serve only when the item is
  // preview-ELIGIBLE (derived from duration) and the clip is on disk; otherwise
  // 404 and the client stays on the poster (no black box). res.sendFile sets
  // Content-Type: video/mp4 from the .mp4 extension.
  app.get('/preview/:id', (req, res) => {
    const db = getCachedDatabase(); // hot GET reader
    const trashRec = !Object.prototype.hasOwnProperty.call(db.metadata, req.params.id)
      ? (trashStore.get(req.params.id) || null) // Wave 3: the table
      : null;
    const item = db.metadata[req.params.id] || (trashRec && trashRec.item) || undefined;
    if (item && !mediaVisibleTo(req, item)) { // RBAC: restricted -> 404 like missing
      return res.status(404).json({ error: 'Media file not found' });
    }
    const pvPath = previewClipPath(req.params.id);
    if (item && previewClipEligible(item) && fs.existsSync(pvPath)) {
      res.setHeader('Cache-Control', 'private, max-age=86400');
      return res.sendFile(pvPath);
    }
    return res.status(404).json({ error: 'No preview' });
  });
  // Media streaming endpoint supporting Range requests (highly important for HTML5 seeking/skipping)
  // v1.46: async solely for the awaited roku-compat resolve below; every other
  // path through this handler is the same synchronous flow it always was.
  app.get('/video/:id', async (req, res) => {
    try {
    const db = getCachedDatabase(); // v1.30 A3: hot GET reader
    const item = db.metadata[req.params.id];
    if (!item) {
      return res.status(404).json({ error: 'Media file not found' });
    }
    // v1.80 RBAC: the security-critical guard - a restricted user must not stream
    // (or download) restricted bytes by direct URL. 404, never 403 (existence).
    if (!mediaVisibleTo(req, item)) {
      return res.status(404).json({ error: 'Media file not found' });
    }

    // FR-3 (v1.19.0): a download-intent request (`?download=1`) ALWAYS
    // bypasses the needsTranscode/live-transcode branch below and serves the
    // ORIGINAL file (`item.filePath`) -- even when a cached transcode already
    // exists -- because the transcode is a browser-playability sidecar, never
    // the canonical file a "Download" click should hand back. This is the
    // ONLY thing `download=1` changes: the id -> `db.metadata[id]` lookup, the
    // 404s, and the Range-capable send below are otherwise identical to
    // ordinary playback.
    const isDownload = req.query.download === '1';

    let filePath = item.filePath;

    // Browser-incompatible containers (AVI, etc.):
    //  - desktop asks for ?live=1 -> live transcode, plays instantly (not iOS-safe)
    //  - otherwise -> serve the pre-transcoded MP4 (seekable; works on iOS)
    if (item.needsTranscode && !isDownload) {
      if (req.query.live === '1') {
        return streamLiveTranscode(req, res, item);
      }
      const out = transcodedPath(item.id);
      if (fs.existsSync(out)) {
        filePath = out; // ready — stream it with full Range support
      } else {
        // Lazy transcode: kick off the conversion on first mobile request (not on scan),
        // then tell the client to wait/poll. Only AVIs actually watched on mobile get cached.
        if (item.transcodeStatus !== 'failed') {
          queueTranscode(item.id, item.filePath);
        }
        return res.status(503).json({ error: 'transcoding', status: item.transcodeStatus || 'pending' });
      }
    }

    // v1.46 Roku compatibility renditions: `?compat=roku` (sent only by the
    // Roku channel, and only for video items) may swap in a CACHED rendition --
    // a lossless remux dropping embedded cover-art tracks, or a rotation-baking
    // re-encode -- because Roku's hardware rejects both classes while browsers
    // play them fine. Guards: never for downloads (canonical bytes), never for
    // audio items, and only when `filePath` is still the ORIGINAL (a
    // needsTranscode item's cached transcode is already Roku-safe H.264/AAC).
    // 'clean' AND 'failed' both fall through to the original: clean is the
    // common case; failed means the build broke, and the original at least
    // yields the client's honest playback error instead of a 503 loop.
    let servingRokuCompat = false;
    if (!isDownload && req.query.compat === 'roku' && item.type === 'video' && filePath === item.filePath) {
      const compat = await resolveRokuCompat(item);
      if (compat.state === 'ready') {
        filePath = compat.path;
        servingRokuCompat = true;
      } else if (compat.state === 'building') {
        return res.status(503).json({ error: 'transcoding', status: 'processing' });
      }
    }

    // v1.27.0: this existence check (-> 404, byte-identical message) is kept
    // HERE, in the exact same place it always was, rather than folded into
    // `sendRangeable` below -- so this route's observable behavior (including
    // response ORDER relative to `isDownload`'s Content-Disposition header,
    // never set on a 404) is provably unchanged by the Range-serving refactor.
    // `sendRangeable` re-checks existence too (its own contract, shared with
    // GET /audio/:id below) -- a harmless, cheap redundant `fs.existsSync` on
    // this path, not a behavior change.
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File does not exist on disk' });
    }

    // Is the file we're about to send the cached transcoded copy? (Never true
    // for a download request -- `isDownload` skips the branch above that's the
    // only place `filePath` is ever set to `transcodedPath(item.id)`.)
    const servingCachedTranscode = filePath === transcodedPath(item.id);
    const contentType = (servingCachedTranscode || servingRokuCompat) ? 'video/mp4' : (mime.lookup(filePath) || (item.type === 'audio' ? 'audio/mpeg' : 'video/mp4'));

    if (isDownload) {
      res.setHeader('Content-Disposition', contentDispositionAttachment(item.title, item.ext));
    }

    // The actual Range-vs-whole-file response now lives in the shared
    // `sendRangeable` helper (above) -- byte-identical to the inline version
    // this replaced. Serving a cached transcode? Mark it recently-served so
    // eviction leaves it alone while it's being watched, and persist the
    // last-served timestamp (throttled/no-clobber) that the age-retention
    // sweep keys off -- unchanged from before the refactor, just relocated
    // into the shared `onServe` callback.
    sendRangeable(req, res, filePath, contentType, () => {
      // v1.41.6 (gate fix): mark the item's SOURCE path live-watched on EVERY
      // serve, not just when a cached transcode is being served. `recentlyServed`
      // was previously fed only by the cache paths it protects from eviction --
      // there was no signal anywhere for "someone is watching this library file
      // right now". The import-relocation needs exactly that signal: it must not
      // move a file mid-playback (the client would keep using the old, now-dead id
      // for the rest of the session -- see its `recently-watched` clause). Purely
      // additive for the eviction/age-sweep readers of this set: they only ever
      // test membership for files INSIDE the cache directory, and a library path
      // is never one of those.
      markServed(item.filePath);
      if (servingCachedTranscode) {
        markServed(filePath);
        recordServed(item.id);
      }
      // v1.46: a roku-compat rendition being watched is protected from its
      // cache's LRU eviction the same way (activeProtectedPaths reads this
      // map). recordServed is NOT called -- that timestamp feeds the transcode
      // cache's age sweep, which never enumerates ROKU_COMPAT_DIR.
      if (servingRokuCompat) {
        markServed(filePath);
      }
    });
    } catch (err) {
      // v1.46 (gate W2): Express 4 never observes a rejected async handler.
      // Without this catch, any synchronous throw that used to become a 500
      // (e.g. sendRangeable's statSync racing an eviction unlink) would now be
      // a logged unhandledRejection plus a socket that hangs until client
      // timeout -- for EVERY caller, compat or not.
      console.error(`GET /video/${req.params.id} failed:`, err && err.message);
      if (!res.headersSent) res.status(500).json({ error: 'internal error' });
    }
  });
}

module.exports = { createMediaStreams, registerRoutes };
