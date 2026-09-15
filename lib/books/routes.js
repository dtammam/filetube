'use strict';

// lib/books/routes.js - the book library's HTTP surface: the /api/books routes
// (folder config, scan control, the list/detail reads, likes + the manual
// finished latch, the cover backfill, the shelf pins and the reading-position
// ping), the /book file + TTS serving routes, and the /bookcover image route.
// Moved VERBATIM out of server.js in Wave 7b, slice S2, of the
// relational-migration arc (docs/exec-plans/completed/
// 2026-09-13-sqlite-relational-migration.md): the bodies are byte-identical to
// the server.js originals and keep their source order, with their free
// identifiers resolving from the `deps` bundle server.js hands in at each call
// site - the lib/ytdlp + lib/podcasts registerRoutes pattern. A missing dep is
// a hard failure (a destructured undefined that is later called throws), never
// a silent fallback.
//
// TWO registration functions, not one. The three path groups (/api/books,
// /book, /bookcover) are INTERLEAVED in server.js and move as ONE ordered
// block, but POST /api/books/:id/progress was registered AFTER the four
// clean-URL shell routes (/tv, /music, /books, /podcasts), which stay behind.
// Each register call therefore sits exactly where its own block's first route
// was, so the routing order is unchanged (scripts/route-order-signature.js is
// the instrument).
//
// What moved WITH the routes - an espree reference census over server.js shows
// the moved routes are each one's only referrer: BOOK_CONTENT_TYPES,
// BOOK_COVER_TYPES, BOOK_COVER_MAX_BYTES, sortBookList, publicBookListItem.
// What did NOT, and why:
//   - `effectiveBookProgress` and `pendingBookProgress` have other referrers
//     (the account-deletion purge, the flush, lib/media/user-routes.js,
//     server.js's own exports), so they cross as deps;
//   - `armBookProgressFlushTimerIfNeeded` has no other CALLER, but it assigns
//     server.js's `bookProgressFlushTimer` `let`, which flushPendingBookProgress
//     and currentBookProgressFlushTimer also read and clear. Moving it would
//     fork that one timer into two variables, so it stays and crosses as a dep;
//   - the TTS engine helpers (ttsAvailable, ttsConfig, resolveTtsChapter,
//     queueChapterTts, ttsServeKey, ttsM4aPath, ttsBlocksPath) belong to the
//     synthesis queue further up server.js, which calls them itself;
//   - `bookScanState` crosses as the OBJECT: server.js declares it `let` but
//     never reassigns it (every write is a property write), so the scan routes
//     read and mutate exactly the state currentBookScanState exports;
//   - `scanBooks` stays in server.js (the media scan and the boot path call it
//     too, and it is exported); only its inner pass moved, to ./scanRunner.
//
// The books progress-coalescer section (pendingBookProgress through
// effectiveBookProgress) sat BETWEEN GET /api/books/tts/config and the read
// APIs in server.js and stays there - the one seam where the routes this file
// holds were not adjacent in the original.
//
// The census lists `mime` among the cover route's deps; that is a FALSE
// POSITIVE of a scope-unaware census. Every `mime` inside POST
// /api/books/:id/cover reads the route's OWN `const mime` (the request's
// content-type), which shadows server.js's `mime-types` require - so it is
// deliberately not passed.
//
// ONE deliberate exception to the uniform two-space re-indent: the
// /bookcover/:id placeholder's multi-line SVG template literal keeps its
// ORIGINAL leading whitespace, because that whitespace is string CONTENT -
// re-indenting it would change the bytes that route serves.

function registerRoutes(app, deps) {
  const {
    BOOKCOVER_DIR,
    DATA_DIR,
    bookScanState, // the LIVE scan-state object (currentBookScanState exports the same one)
    bookVisibleTo, // v1.80 RBAC: the per-user visibility gate for book items
    booksDb,
    booksStore,
    contentDispositionAttachment,
    effectiveBookProgress, // pending-first reading position, per user
    escapeHtml,
    express, // only for express.raw on the cover upload
    folderStore,
    foldersOverlap,
    fs,
    getCachedDatabase,
    getMediaId,
    markServed, // protects an actively-streaming TTS chapter from a cache sweep
    musicDb,
    path,
    podcasts,
    queueChapterTts,
    requireAdmin,
    requireModifyLibrary,
    resolveTtsChapter,
    scanBooks, // the overlap/coalescing scan guard - still server.js's
    ttsAvailable,
    ttsBlocksPath,
    ttsConfig,
    ttsM4aPath,
    ttsServeKey,
    tvDb,
    updateDatabase,
    userStore,
    visibleConfigRoots,
    ytdlpArgs,
  } = deps;

  app.get('/api/books/config', (req, res) => {
    const ns = booksDb.read();
    const folders = ns.folders || [];
    // v1.128 Wave B (L2): common.js reads this on every page to decide whether
    // to show the Books nav tab, so members reach it - but it leaked every book
    // ROOT abs path. For a restricted member, return only roots holding >=1
    // visible book; admin + unrestricted member get the byte-identical list.
    res.json({ folders: visibleConfigRoots(req, folders, Object.values(ns.items || {}), bookVisibleTo) });
  });

  app.post('/api/books/config', async (req, res) => {
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
    // HARD INVARIANT (exec plan §2): book roots may never overlap media roots
    // in EITHER direction -- a file must have exactly one owner, or the two
    // scanners' prune/merge semantics fight over it.
    const cachedForBooks = getCachedDatabase();
    const mediaFolders = folderStore.list().map((f) => path.resolve(f)); // Wave 4: the root list is a table
    for (const bookRoot of resolved) {
      for (const mediaRoot of mediaFolders) {
        if (bookRoot === mediaRoot || ytdlpArgs.isPathUnder(bookRoot, mediaRoot) || ytdlpArgs.isPathUnder(mediaRoot, bookRoot)) {
          return res.status(400).json({ error: `Book folder overlaps a media folder: ${bookRoot} <-> ${mediaRoot}` });
        }
      }
    }
    // v1.44 music: reciprocal of the music-config guard -- a book root may not
    // overlap a MUSIC root either (both directions), so the three collections
    // stay mutually disjoint regardless of save order.
    const musicFoldersForBooks = (musicDb.read().folders || []).map((f) => path.resolve(f));
    for (const bookRoot of resolved) {
      for (const musicRoot of musicFoldersForBooks) {
        if (bookRoot === musicRoot || ytdlpArgs.isPathUnder(bookRoot, musicRoot) || ytdlpArgs.isPathUnder(musicRoot, bookRoot)) {
          return res.status(400).json({ error: `Book folder overlaps a music folder: ${bookRoot} <-> ${musicRoot}` });
        }
      }
    }
    // v1.195 TV Shows: reciprocal of the tv-config net - a book root may not overlap
    // a Shows root either (both directions).
    const tvFoldersForBooks = (tvDb.read().folders || []).map((f) => path.resolve(f));
    for (const bookRoot of resolved) {
      for (const tvRoot of tvFoldersForBooks) {
        if (foldersOverlap(bookRoot, tvRoot)) {
          return res.status(400).json({ error: `Book folder overlaps a Shows folder: ${bookRoot} <-> ${tvRoot}` });
        }
      }
    }
    // v1.69 podcasts (D8): the four-way clause, same both-directions posture.
    {
      const podcastsRootForBooks = podcasts.resolvePodcastsRoot(cachedForBooks, { dataDir: DATA_DIR });
      for (const bookRoot of resolved) {
        if (bookRoot === podcastsRootForBooks || ytdlpArgs.isPathUnder(bookRoot, podcastsRootForBooks) || ytdlpArgs.isPathUnder(podcastsRootForBooks, bookRoot)) {
          return res.status(400).json({ error: `Book folder overlaps the podcasts folder: ${bookRoot} <-> ${podcastsRootForBooks}` });
        }
      }
    }
    try {
      await updateDatabase(() => booksDb.mutate((h) => { booksStore.ensureBooks(h).folders = resolved; return true; })); // Wave 5: the diff rides the commit
    } catch (err) {
      return res.status(500).json({ error: `Could not save book folders: ${err.message}` });
    }
    res.json({ folders: resolved });
    scanBooks().catch(console.error);
  });

  app.post('/api/books/scan', (req, res) => {
    if (!requireModifyLibrary(req, res)) return; // v1.81 write-RBAC (first guard)
    const alreadyInProgress = bookScanState.scanning;
    if (alreadyInProgress) {
      bookScanState.rescanRequested = true;
    } else {
      scanBooks().catch(console.error);
    }
    res.status(202).json({ scanning: true, alreadyInProgress });
  });

  app.get('/api/books/scan-status', (req, res) => {
    res.json(bookScanState);
  });

  // v1.38.0 TTS: the reader calls this to decide whether to light the "Listen
  // from Here" control. `available` is the SAME gate every synthesis route
  // enforces (engine binary + Piper model + ffmpeg). Static-segment route,
  // declared before the `/api/books/:id/...` params (route-order lesson).
  app.get('/api/books/tts/config', (req, res) => {
    res.json({ available: ttsAvailable(), engine: ttsConfig.engine });
  });

  // ---- Books: read APIs + file/cover serving (T5) ------------------------------

  // Sort comparators -- the /api/videos sort-key posture (unknown keys fall
  // back to the default) with book-native keys.
  function sortBookList(list, sortKey) {
    const byTitle = (a, b) => String(a.title || '').localeCompare(String(b.title || ''), undefined, { sensitivity: 'base' });
    switch (sortKey) {
      case 'title-asc': return list.sort(byTitle);
      case 'title-desc': return list.sort((a, b) => byTitle(b, a));
      case 'author': return list.sort((a, b) => String(a.author || '').localeCompare(String(b.author || ''), undefined, { sensitivity: 'base' }) || byTitle(a, b));
      case 'recent-progress': return list.sort((a, b) => String((b.progress && b.progress.updatedAt) || '').localeCompare(String((a.progress && a.progress.updatedAt) || '')));
      case 'recent':
      default: return list.sort((a, b) => String(b.addedAt || '').localeCompare(String(a.addedAt || '')));
    }
  }

  // The public item shape: everything the cards/reader need, progress overlaid
  // (effective = pending-first, per-user), spine included only on the detail
  // route (the list stays light for hundreds of books).
  function publicBookListItem(item, userId, likedSet, finishedMap) {
    const progress = effectiveBookProgress(userId, item.id);
    // v1.72: per-user liked + finished flags ride the shape (the
    // publicTrackListItem posture: the caller passes the pre-fetched sets so
    // a list render costs two queries, not two per item).
    const liked = likedSet ? likedSet.has(item.id) : userStore.getBookLiked(userId).some((l) => l.bookId === item.id);
    const finished = finishedMap
      ? Object.prototype.hasOwnProperty.call(finishedMap, item.id)
      : Object.prototype.hasOwnProperty.call(userStore.getBookFinished(userId), item.id);
    return {
      id: item.id,
      title: item.title,
      author: item.author,
      format: item.format,
      folderName: item.folderName,
      rootFolder: item.rootFolder,
      size: item.size,
      addedAt: item.addedAt,
      hasCover: item.hasCover === true,
      pageCount: item.pageCount,
      progress: progress ? { percent: progress.percent, updatedAt: progress.updatedAt } : null,
      liked,
      finished,
    };
  }

  app.get('/api/books', (req, res) => {
    const ns = booksDb.read();
    let list = Object.values(ns.items).filter((i) => bookVisibleTo(req, i)); // v1.80 RBAC
    const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';
    if (search !== '') {
      list = list.filter((i) => [i.title, i.author, i.folderName]
        .some((field) => typeof field === 'string' && field.toLowerCase().includes(search)));
    }
    const root = typeof req.query.root === 'string' ? req.query.root : '';
    if (root !== '') {
      // The home grid's `underFolder` idiom: the folder itself or anything
      // beneath it (path-prefix on the item's file path).
      list = list.filter((i) => typeof i.filePath === 'string' && (i.filePath === root || i.filePath.startsWith(root.endsWith(path.sep) ? root : root + path.sep)));
    }
    // Explicit lambda (NOT `list.map(publicBookListItem)`): map would pass the
    // array INDEX as the second argument, which is now the userId parameter.
    const likedSet = new Set(userStore.getBookLiked(req.user.id).map((l) => l.bookId));
    const finishedMap = userStore.getBookFinished(req.user.id);
    let shaped = list.map((item) => publicBookListItem(item, req.user.id, likedSet, finishedMap));
    if (req.query.filter === 'reading') {
      shaped = shaped.filter((i) => i.progress && i.progress.percent > 0 && i.progress.percent < 98);
      shaped.sort((a, b) => String((b.progress && b.progress.updatedAt) || '').localeCompare(String((a.progress && a.progress.updatedAt) || '')));
    } else {
      sortBookList(shaped, typeof req.query.sort === 'string' ? req.query.sort : 'recent');
    }
    const total = shaped.length;
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const rawLimit = parseInt(req.query.limit, 10);
    const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 10000) : 100;
    res.json({ items: shaped.slice(offset, offset + limit), total, offset, limit });
  });

  // ROUTE ORDER: the static-segment GETs (/folders, /pins) MUST register
  // before the /:id param route or Express matches :id="folders".
  // Shelf aggregation for the books page's chips: unique parent directories
  // with counts, joined against the shelf pins so the chip renders its pin
  // state (T10's pin gesture). Exposing shelf DIR paths to the operator's own
  // UI is the same trust level as /api/config exposing db.folders.
  app.get('/api/books/folders', (req, res) => {
    const ns = booksDb.read();
    const byDir = new Map();
    for (const item of Object.values(ns.items)) {
      if (typeof item.filePath !== 'string') continue;
      // v1.128 Wave B (L4): filter BEFORE aggregating (the music/albums pattern)
      // - this route emitted abs dir + folderName + count for EVERY book folder
      // with no visibility check, so a books-restricted member saw hidden shelves.
      if (!bookVisibleTo(req, item)) continue;
      const dir = path.dirname(item.filePath);
      const existing = byDir.get(dir);
      if (existing) existing.count += 1;
      else byDir.set(dir, { name: item.folderName || path.basename(dir), dir, count: 1 });
    }
    // v1.43: pin state is the signed-in user's own shelf pins.
    const pinByDir = new Map(userStore.getBookPins(req.user.id).map((p) => [p.dir, p]));
    const folders = [...byDir.values()].map((f) => {
      const pin = pinByDir.get(f.dir);
      return { ...f, pinned: Boolean(pin), pinId: pin ? pin.id : null };
    });
    res.json({ folders });
  });

  app.get('/api/books/pins', (req, res) => {
    // Pre-shaped for the shared pinned-sidebar renderer: `channelDir` is the
    // field name the renderer already keys on; `href` overrides its default
    // `/?root=` link to the books page (the ONLY shared-renderer widening).
    // v1.43: the signed-in user's own shelf pins (the store reads them
    // pin_order-sorted, matching listShelfPins' order contract).
    const pins = userStore.getBookPins(req.user.id);
    res.json(pins.map((p) => ({ id: p.id, channelDir: p.dir, label: p.label, href: `/books?root=${encodeURIComponent(p.dir)}` })));
  });

  // ---- v1.72 books first-class: likes + the manual finished latch -------------
  // Per-user book likes (static segment -- declared BEFORE /api/books/:id,
  // the /api/music/liked route-order discipline). The POST is existence-gated
  // (the id persists into user_book_liked); the DELETE is idempotent like
  // every other unlike.
  app.post('/api/books/liked/:id', (req, res) => {
    const ns = booksDb.read();
    if (!Object.prototype.hasOwnProperty.call(ns.items, req.params.id)) {
      return res.status(404).json({ error: 'Book not found' });
    }
    userStore.addBookLiked(req.user.id, req.params.id, new Date().toISOString());
    res.json({ liked: true });
  });
  app.delete('/api/books/liked/:id', (req, res) => {
    userStore.removeBookLiked(req.user.id, req.params.id);
    res.json({ liked: false });
  });

  // The manual mark-finished latch (the podcast played-toggle contract:
  // {finished:false} clears, anything else sets). No auto threshold - a text
  // position's "end" is format-dependent (exec plan, morning question M1).
  app.post('/api/books/:id/finished', (req, res) => {
    const ns = booksDb.read();
    if (!Object.prototype.hasOwnProperty.call(ns.items, req.params.id)) {
      return res.status(404).json({ error: 'Book not found' });
    }
    const wantFinished = !(req.body && req.body.finished === false);
    if (wantFinished) userStore.setBookFinished(req.user.id, req.params.id, new Date().toISOString());
    else userStore.clearBookFinished(req.user.id, req.params.id);
    res.json({ ok: true, finished: wantFinished });
  });

  app.get('/api/books/:id', (req, res) => {
    const ns = booksDb.read();
    const item = ns.items[req.params.id];
    if (!item) return res.status(404).json({ error: 'Book not found' });
    if (!bookVisibleTo(req, item)) return res.status(404).json({ error: 'Book not found' }); // v1.80 RBAC
    res.json({
      ...publicBookListItem(item, req.user.id),
      filePath: item.filePath,
      spine: Array.isArray(item.spine) ? item.spine : [],
      locator: (effectiveBookProgress(req.user.id, item.id) || {}).locator || null,
    });
  });

  const BOOK_CONTENT_TYPES = { epub: 'application/epub+zip', pdf: 'application/pdf' };

  // SECURITY INVARIANT (gate, adversarial S2): this route serves
  // item.filePath UNCHECKED because db.books.items rows are written
  // EXCLUSIVELY by the book scanner (paths confined to configured book
  // roots) and the cover-backfill route (which never touches filePath). Any
  // future writer of items[*].filePath MUST re-establish confinement here or
  // this becomes an arbitrary-file-read.
  app.get('/book/:id/file', (req, res) => {
    const ns = booksDb.read();
    const item = ns.items[req.params.id];
    if (!item) return res.status(404).json({ error: 'Book not found' });
    if (!bookVisibleTo(req, item)) return res.status(404).json({ error: 'Book not found' }); // v1.80 RBAC: private library
    if (!fs.existsSync(item.filePath)) return res.status(404).json({ error: 'Book file missing on disk' });
    res.setHeader('Content-Type', BOOK_CONTENT_TYPES[item.format] || 'application/octet-stream');
    if (req.query.download === '1') {
      // v1.72 (cap 7): the shared injection-safe helper replaces the old
      // hand-rolled header - encodeURIComponent in a bare filename= produced
      // percent-encoded garbage names for any non-ASCII title, and the
      // helper's filename* form is exactly the fix it exists to provide.
      res.setHeader('Content-Disposition', contentDispositionAttachment(item.title || 'book', `.${item.format}`));
    }
    // sendFile provides Accept-Ranges/206 natively -- what pdf.js range
    // loading wants; harmless for the whole-file EPUB fetch.
    res.sendFile(item.filePath);
  });

  // ---- v1.38.0 TTS "Listen from Here" routes ----------------------------------
  //
  // All file paths derive from the deterministic cache key over a
  // scanner-validated (bookId, spineIndex) -- never from a client path fragment,
  // so there is no arbitrary-file-read surface (mirrors /book/:id/file's own
  // membership check). The static `tts` segment sits under the already-matched
  // `:id`, so there is no route-order ambiguity with /book/:id/file.

  // Enqueue synthesis (idempotent). 503 if the engine/model/ffmpeg aren't
  // configured; 404 for an unknown/non-epub book or out-of-range chapter.
  app.post('/book/:id/tts/:spineIndex/ensure', (req, res) => {
    const rbacBook = booksDb.parts.items.get(req.params.id); /* Wave 5 gate pass B: a point query */ // v1.80 RBAC
    if (rbacBook && !bookVisibleTo(req, rbacBook)) return res.status(404).json({ error: 'No such book chapter for text-to-speech' });
    if (!ttsAvailable()) return res.status(503).json({ error: 'Text-to-speech is not configured on this server' });
    const chapter = resolveTtsChapter(req.params.id, req.params.spineIndex);
    if (!chapter) return res.status(404).json({ error: 'No such book chapter for text-to-speech' });
    // Use the NORMALIZED integer index everywhere (not the raw route param) so
    // '02'/'2e0'/' 2 ' all address the SAME cache key/status row that ensure
    // synthesizes under (gate finding: raw-vs-normalized key mismatch).
    const result = queueChapterTts(req.params.id, chapter.spineIndex);
    res.json(result);
  });

  // Honest per-chapter status for the reader's poll.
  app.get('/api/books/:id/tts/:spineIndex/status', (req, res) => {
    const idx = Number(req.params.spineIndex);
    if (!Number.isInteger(idx) || idx < 0) return res.json({ status: 'none', durationSec: null });
    const audio = booksDb.parts.audio.get(req.params.id); // Wave 5 (gate pass B): a point query
    const entry = audio && audio[String(idx)];
    if (!entry) return res.json({ status: 'none', durationSec: null });
    res.json({ status: entry.status, durationSec: typeof entry.durationSec === 'number' ? entry.durationSec : null });
  });

  // Serve the synthesized chapter audio (sendFile => Accept-Ranges/206 native).
  app.get('/book/:id/tts/:spineIndex', (req, res) => {
    const rbacBook = booksDb.parts.items.get(req.params.id); /* Wave 5 gate pass B: a point query */ // v1.80 RBAC
    if (rbacBook && !bookVisibleTo(req, rbacBook)) return res.status(404).json({ error: 'No such book chapter' });
    const chapter = resolveTtsChapter(req.params.id, req.params.spineIndex);
    if (!chapter) return res.status(404).json({ error: 'No such book chapter' });
    const key = ttsServeKey(req.params.id, chapter.spineIndex);
    const m4a = ttsM4aPath(key);
    if (!fs.existsSync(m4a)) return res.status(404).json({ error: 'Audio not ready' });
    // Protect an actively-streaming chapter from a concurrent "Clear cache now"
    // (the RECENT_STREAM_MS set the transcode serve path already uses).
    markServed(m4a);
    res.setHeader('Content-Type', 'audio/mp4');
    res.sendFile(m4a);
  });

  // The blockIndex -> startSec map the reader uses to seek to the right paragraph.
  app.get('/book/:id/tts/:spineIndex/blocks', (req, res) => {
    const rbacBook = booksDb.parts.items.get(req.params.id); /* Wave 5 gate pass B: a point query */ // v1.80 RBAC: private book TEXT
    if (rbacBook && !bookVisibleTo(req, rbacBook)) return res.status(404).json({ error: 'No such book chapter' });
    const chapter = resolveTtsChapter(req.params.id, req.params.spineIndex);
    if (!chapter) return res.status(404).json({ error: 'No such book chapter' });
    const key = ttsServeKey(req.params.id, chapter.spineIndex);
    const blocksPath = ttsBlocksPath(key);
    if (!fs.existsSync(blocksPath)) return res.status(404).json({ error: 'Audio not ready' });
    res.setHeader('Content-Type', 'application/json');
    res.sendFile(blocksPath);
  });

  app.get('/bookcover/:id', (req, res) => {
    const ns = booksDb.read();
    const item = ns.items[req.params.id];
    if (!item) return res.status(404).json({ error: 'Book not found' });
    if (!bookVisibleTo(req, item)) return res.status(404).json({ error: 'Book not found' }); // v1.80 RBAC
    if (item.hasCover === true && item.coverExt) {
      const coverPath = path.join(BOOKCOVER_DIR, `${item.id}${item.coverExt}`);
      if (fs.existsSync(coverPath)) {
        res.setHeader('Content-Type', item.coverExt === '.png' ? 'image/png' : 'image/jpeg');
        // Covers are immutable per id (a changed file gets a new path-hash id
        // only if the path changes; a re-extracted cover overwrites in place,
        // so cap the cache at a day rather than immutable).
        // v1.123 T4 (security): `private`, not `public` - this route 404s per-user
        // via bookVisibleTo, so a SHARED cache keyed on the URL alone could serve
        // one user's (or a restricted book's) cover to another. Matches the
        // /thumbnail posture. The user's OWN browser still caches it.
        res.setHeader('Cache-Control', 'private, max-age=86400');
        return res.sendFile(coverPath);
      }
    }
    // Book-styled SVG placeholder -- title/author text, escaped exactly like
    // the /thumbnail fallback (a hostile title must never become markup).
    const title = String(item.title || 'Book');
    const author = String(item.author || '');
    const svg = `
    <svg width="160" height="240" viewBox="0 0 160 240" xmlns="http://www.w3.org/2000/svg">
      <rect width="160" height="240" fill="#3a3f58"/>
      <rect x="8" y="8" width="144" height="224" fill="none" stroke="#8890b5" stroke-width="2"/>
      <text x="80" y="110" font-family="Georgia, serif" font-size="13" fill="#e8e8f0" text-anchor="middle" font-weight="bold">
        ${escapeHtml(title.length > 20 ? `${title.substring(0, 18)}...` : title)}
      </text>
      <text x="80" y="132" font-family="Georgia, serif" font-size="9" fill="#aab" text-anchor="middle">
        ${escapeHtml(author.length > 26 ? `${author.substring(0, 24)}...` : author)}
      </text>
      <text x="80" y="220" font-family="Arial, sans-serif" font-size="8" fill="#778" text-anchor="middle">${item.format === 'pdf' ? 'PDF' : 'EPUB'}</text>
    </svg>
  `;
    res.setHeader('Content-Type', 'image/svg+xml');
    res.send(svg);
  });

  // PDF cover backfill (T5/§2): the reader has page 1 decoded anyway; it POSTs
  // a one-shot JPEG/PNG snapshot. Magic-byte sniffed, bounded, NO-CLOBBER
  // (the dimensions-backfill contract), atomic tmp+rename.
  // (Own sniffer literals rather than referencing CUSTOM_LOGO_TYPES: that
  // const is declared LATER in this file -- a module-load-time reference here
  // would be a temporal-dead-zone boot crash. Same magic bytes.)
  const BOOK_COVER_TYPES = {
    'image/jpeg': (buf) => buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff,
    'image/png': (buf) => buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47,
  };
  const BOOK_COVER_MAX_BYTES = 512 * 1024;

  app.post(
    '/api/books/:id/cover',
    express.raw({ type: Object.keys(BOOK_COVER_TYPES), limit: BOOK_COVER_MAX_BYTES }),
    async (req, res) => {
      const ns = booksDb.read();
      const item = ns.items[req.params.id];
      if (!item) return res.status(404).json({ error: 'Book not found' });
      // v1.123 T3 (security): visibility axis - this writes a SHARED cover for the
      // book, so a member restricted from it must not set it. Symmetric with the
      // GET cover route's bookVisibleTo 404. Neutral (same 404 as a missing id).
      if (!bookVisibleTo(req, item)) return res.status(404).json({ error: 'Book not found' });
      if (item.hasCover === true) return res.status(200).json({ applied: false, reason: 'already has a cover' });
      const mime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      const sniff = BOOK_COVER_TYPES[mime];
      const bytes = req.body;
      if (!sniff || !Buffer.isBuffer(bytes) || bytes.length === 0 || !sniff(bytes)) {
        return res.status(400).json({ error: 'body must be a real JPEG or PNG image' });
      }
      const ext = mime === 'image/png' ? '.png' : '.jpg';
      const finalPath = path.join(BOOKCOVER_DIR, `${item.id}${ext}`);
      const tmpPath = `${finalPath}.tmp`;
      try {
        fs.mkdirSync(BOOKCOVER_DIR, { recursive: true });
        fs.writeFileSync(tmpPath, bytes);
        fs.renameSync(tmpPath, finalPath);
      } catch (err) {
        try { fs.unlinkSync(tmpPath); } catch (_) { /* best-effort */ }
        return res.status(500).json({ error: `Could not store cover: ${err.message}` });
      }
      // Optional pageCount rides along (?pages=), validated as a plausible
      // positive integer -- the isValidMediaDimension posture.
      const rawPages = parseInt(req.query.pages, 10);
      const pageCount = Number.isInteger(rawPages) && rawPages > 0 && rawPages < 100000 ? rawPages : undefined;
      try {
        await updateDatabase(() => booksDb.mutate((db) => {
          const freshNs = booksStore.ensureBooks(db);
          const fresh = freshNs.items[item.id];
          if (!fresh) return false; // pruned between read and write: drop
          if (fresh.hasCover !== true) {
            fresh.hasCover = true;
            fresh.coverExt = ext;
          }
          if (pageCount !== undefined && fresh.pageCount === undefined) fresh.pageCount = pageCount;
          return true;
        }));
      } catch (err) {
        return res.status(500).json({ error: `Cover stored but the record update failed: ${err.message}` });
      }
      res.json({ applied: true });
    },
  );

  // ---- Books: shelf pins (T10 server half -- the ytdlp pins route shapes) ----

  // v1.43 (chunk 4b): shelf pins are per-user. The routes keep booksStore's
  // PURE reducers as the single source of pin semantics (idempotent re-pin,
  // max(order)+1 tail append, FIFO cap, stable reorder partition) and persist
  // the reducer output to the user's user_book_pins rows -- the validation
  // (root confinement) is unchanged.
  app.post('/api/books/pins', (req, res) => {
    const ns = booksDb.read();
    const validation = booksStore.validateShelfPinInput(req.body, ns.folders);
    if (!validation.ok) return res.status(400).json({ error: validation.error });
    try {
      const { dir, label } = validation.value;
      const result = booksStore.reduceAddShelfPin(userStore.getBookPins(req.user.id), {
        id: getMediaId(dir), dir, label, pinnedAt: new Date().toISOString(),
      });
      if (result.changed) userStore.setBookPins(req.user.id, result.pins);
      res.json(result.record);
    } catch (err) {
      res.status(500).json({ error: `Could not pin shelf: ${err.message}` });
    }
  });

  app.delete('/api/books/pins/:id', (req, res) => {
    try {
      const result = booksStore.reduceRemoveShelfPin(userStore.getBookPins(req.user.id), req.params.id);
      if (!result.changed) return res.status(404).json({ error: 'Pin not found' });
      userStore.setBookPins(req.user.id, result.pins);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: `Could not unpin shelf: ${err.message}` });
    }
  });

  app.post('/api/books/pins/reorder', (req, res) => {
    const { orderedIds } = req.body || {};
    if (!Array.isArray(orderedIds) || !orderedIds.every((id) => typeof id === 'string' && id !== '')) {
      return res.status(400).json({ error: 'orderedIds must be an array of non-empty strings' });
    }
    try {
      const reordered = booksStore.reduceReorderShelfPins(userStore.getBookPins(req.user.id), orderedIds);
      userStore.setBookPins(req.user.id, reordered);
      res.json(userStore.getBookPins(req.user.id));
    } catch (err) {
      res.status(500).json({ error: `Could not reorder shelf pins: ${err.message}` });
    }
  });
}

// POST /api/books/:id/progress - the reading-position ping. Registered AFTER
// the /tv, /music, /books and /podcasts clean-URL routes in server.js, which is
// why it has its own register call rather than joining the block above.
function registerProgressRoute(app, deps) {
  const {
    armBookProgressFlushTimerIfNeeded, // arms server.js's shared book-progress flush timer
    booksDb,
    pendingBookProgress, // the coalescer's staging Map - the LIVE object, never a copy
    pendingProgressKey,
  } = deps;

  app.post('/api/books/:id/progress', (req, res) => {
    const ns = booksDb.read();
    // OWN-property check (v1.42 __proto__ lesson): this id persists into
    // user_book_progress -- see POST /api/progress's identical guard.
    const item = Object.prototype.hasOwnProperty.call(ns.items, req.params.id) ? ns.items[req.params.id] : undefined;
    if (!item) return res.status(404).json({ error: 'Book not found' });
    const { locator, percent } = req.body || {};
    if (!locator || typeof locator !== 'object' || locator.kind !== item.format) {
      return res.status(400).json({ error: `locator.kind must be '${item.format}' for this book` });
    }
    if (item.format === 'epub' && typeof locator.cfi !== 'string') {
      return res.status(400).json({ error: 'locator.cfi must be a string for an epub' });
    }
    if (item.format === 'pdf' && !(Number.isInteger(locator.page) && locator.page > 0)) {
      return res.status(400).json({ error: 'locator.page must be a positive integer for a pdf' });
    }
    if (typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0 || percent > 100) {
      return res.status(400).json({ error: 'percent must be a number in [0, 100]' });
    }
    // Bound the stored locator to the known fields (a hostile ping must not
    // grow the record with arbitrary keys), spineIndex/blockIndex validated as
    // non-negative integers when present (the wave-2 listen-from-here keys).
    const clean = { kind: locator.kind };
    if (item.format === 'epub') {
      clean.cfi = String(locator.cfi).slice(0, 2000);
      if (Number.isInteger(locator.spineIndex) && locator.spineIndex >= 0) clean.spineIndex = locator.spineIndex;
      if (Number.isInteger(locator.blockIndex) && locator.blockIndex >= 0) clean.blockIndex = locator.blockIndex;
    } else {
      clean.page = locator.page;
    }
    pendingBookProgress.set(pendingProgressKey(req.user.id, item.id), {
      userId: req.user.id,
      bookId: item.id,
      value: { locator: clean, percent, updatedAt: new Date().toISOString() },
    });
    armBookProgressFlushTimerIfNeeded();
    res.json({ success: true });
  });
}

module.exports = { registerRoutes, registerProgressRoute };
