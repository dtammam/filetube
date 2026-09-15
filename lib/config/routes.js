'use strict';

// lib/config/routes.js - the library's configuration + maintenance HTTP
// surface: the media-folder config (GET/POST /api/config) with its four-way
// overlap net, the per-folder display-name and Music-flag routes under
// /api/folders, the on-demand scan trigger (POST /api/scan), the live
// scan/transcode status read (GET /api/scan-status), the instance settings
// (GET/POST /api/settings) with the custom-logo upload/reset
// (/api/settings/logo), the transcode-cache size + clear routes under
// /api/cache, and the account menu's storage total (GET /api/storage-summary).
// Moved VERBATIM out of server.js in Wave 7b, slice S10b, of the
// relational-migration arc (docs/exec-plans/completed/
// 2026-09-13-sqlite-relational-migration.md): the bodies are byte-identical to
// the server.js originals and keep their source order, with their free
// identifiers resolving from the `deps` bundle server.js hands in at each call
// site - the lib/ytdlp + lib/podcasts registerRoutes pattern. A missing dep is
// a hard failure (a destructured undefined that is later called throws), never
// a silent fallback.
//
// SIX registration functions, not one. These groups are NOT contiguous in
// server.js - the shell wildcard, the books/music/tv sections, the avatar
// block, the notification bell and the stats section sit between them - so
// each register call sits exactly where its own block's first route was and
// the routing order is unchanged (scripts/route-order-signature.js is the
// instrument, scripts/verify-split-slice.js the byte check).
//
// What moved WITH the routes - an espree reference census over server.js shows
// the moved routes are each one's only referrer, cross-checked by grep over
// lib/ and test/:
//   - GLYPH_IDS, the folder-glyph allowlist POST /api/config validates
//     against, with its require of the shared glyph registry (the require PATH
//     is the only changed byte, as moving a require always costs);
//   - the transcriptAiPrompts shape rules + validateTranscriptAiPrompts, whose
//     only caller is POST /api/settings;
//   - TRANSCODE_LIST_CAP, the cap on GET /api/scan-status' transcodeNames;
//   - settingsResponse - INSIDE registerSettingsRoutes, because it reads
//     DEFAULT_SETTINGS and effectiveCacheCap, which stay in server.js (both
//     have readers outside this slice), so it resolves them from this group's
//     deps instead of module scope.
// What did NOT, and why:
//   - the four POST /api/settings enum allowlists are ONE declaration cluster
//     in server.js and only two of them are private to this slice:
//     SCAN_INTERVAL_VALID_VALUES derives from SCAN_INTERVAL_MINUTE_OPTIONS
//     (the scan timer's own constant) and TRASH_RETENTION_DAYS_VALID_VALUES
//     has two readers outside it (validateBackupBundle, sweepTrash). All four
//     cross as deps rather than fork a cluster whose comments cross-reference
//     each other ("same allowed set for the trash retention");
//   - transcodeCacheSize, effectiveCacheCap, activeProtectedPaths,
//     clearAudioStatus, isCompletedTranscode and isInFlightTranscode belong to
//     the transcode machinery (slice S8) and are called from all over
//     server.js;
//   - visibleConfigRoots, foldersOverlap and matchRootFolder are shared with
//     the books/music/tv config routes and the scan.
//
// The census lists `mime` among POST /api/settings/logo's deps; that is a
// FALSE POSITIVE of a scope-unaware census. Every `mime` in that route reads
// the route's OWN `const mime` (the request's content-type), which shadows
// server.js's mime-types require - so it is deliberately not passed.
//
// POSITIONAL COMMENTS. The moved bodies keep their bytes, which means the
// "above"/"below" words in them still read as they did in server.js. Most
// still point at the right code (POST /api/config really is below GET
// /api/config here), and the ones that named code elsewhere now mean:
// runScanDirectories, clearAudioStatus, the transcode loop - "in server.js";
// /api/videos and /api/stats - "in lib/media/routes.js" (slice S10a moved them
// in the same release; the R2 gate caught the stale direction). ONE flipped side because this file's
// order is not server.js's: settingsResponse's note that the custom logo is
// "managed exclusively by the dedicated POST/DELETE /api/settings/logo routes
// below" points at registerLogoSettingsRoutes, which sits ABOVE it here. The
// order is forced: scripts/verify-split-slice.js checks the four /api/settings
// statements in their server.js order, and the logo pair came first there.

// v1.77 glyph pool: the SAME dual-mode registry the browser loads as a plain
// script and server.js requires for its own reader; it crosses as a DEP
// (`glyphPool`) rather than a second require - the R2 gate caught the first
// cut duplicating server.js's require, which the split's pattern forbids when
// server.js is a referrer too. GLYPH_IDS (the O(1) membership set the config
// writer checks, derived from the registry, never a hand-typed list) is built
// inside registerRoutes from that dep.

// v1.201: shape rules for `transcriptAiPrompts` (see DEFAULT_SETTINGS).
const TRANSCRIPT_AI_PROMPTS_MAX = 12;
const TRANSCRIPT_AI_PROMPT_NAME_MAX = 60;
const TRANSCRIPT_AI_PROMPT_TEXT_MAX = 4000;
/**
 * Validate + normalize a client-supplied prompt list. Returns
 * `{ ok: true, value }` (ids assigned/preserved, strings trimmed) or
 * `{ ok: false, error }` (a human-readable 400 body). Pure.
 * @param {*} raw the POSTed value
 * @param {Array<{id:string,name:string,text:string}>} [existing] current list, so a
 *   client that omits/keeps an id keeps it stable across edits
 */
function validateTranscriptAiPrompts(raw, existing) {
  if (!Array.isArray(raw)) return { ok: false, error: 'transcriptAiPrompts must be an array' };
  if (raw.length > TRANSCRIPT_AI_PROMPTS_MAX) return { ok: false, error: `transcriptAiPrompts: at most ${TRANSCRIPT_AI_PROMPTS_MAX} prompts` };
  const existingIds = new Set((Array.isArray(existing) ? existing : []).map((e) => e && e.id).filter((x) => typeof x === 'string'));
  const seenNames = new Set();
  const seenIds = new Set();
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (!item || typeof item !== 'object' || Array.isArray(item)) return { ok: false, error: `transcriptAiPrompts[${i}] must be an object` };
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    const text = typeof item.text === 'string' ? item.text.trim() : '';
    if (name === '' || name.length > TRANSCRIPT_AI_PROMPT_NAME_MAX) return { ok: false, error: `transcriptAiPrompts[${i}].name must be 1-${TRANSCRIPT_AI_PROMPT_NAME_MAX} characters` };
    if (text === '' || text.length > TRANSCRIPT_AI_PROMPT_TEXT_MAX) return { ok: false, error: `transcriptAiPrompts[${i}].text must be 1-${TRANSCRIPT_AI_PROMPT_TEXT_MAX} characters` };
    const nameKey = name.toLowerCase();
    if (seenNames.has(nameKey)) return { ok: false, error: `transcriptAiPrompts: duplicate name "${name}"` };
    seenNames.add(nameKey);
    // Keep a known id; otherwise mint one from the name (unique within the list).
    let id = (typeof item.id === 'string' && existingIds.has(item.id) && !seenIds.has(item.id)) ? item.id : '';
    if (id === '') {
      const base = nameKey.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'prompt';
      id = base;
      for (let n = 2; seenIds.has(id) || (existingIds.has(id) && raw.some((r, j) => j !== i && r && r.id === id)); n++) id = `${base}-${n}`;
    }
    seenIds.add(id);
    out.push({ id, name, text });
  }
  return { ok: true, value: out };
}

// FR-3 (v1.18.0): bounds the `transcodeNames` list GET /api/scan-status
// returns below -- codec-based detection (T2/FR-1b) can flag substantially
// more files than the old extension-only set on a large library, so the
// names array is capped rather than unbounded (fork #6 in the exec plan).
const TRANSCODE_LIST_CAP = 10;

function registerConfigRoutes(app, deps) {
  const {
    DATA_DIR, // the podcasts-root probe in the media-folder overlap net
    booksDb,
    folderDisplayNameStore,
    folderSettingsStore,
    folderStore,
    foldersOverlap,
    glyphPool, // the shared glyph registry (server.js requires it once; a dep, not a second require - R2 gate W2)
    fs,
    getCachedDatabase,
    inSaveTransaction, // the folder list + the settings map write inside ONE doc commit
    libraryAudio, // the channel-mark predicate the music-flag routes share with the projection
    loadDatabase,
    matchRootFolder,
    mediaVisibleTo, // v1.80 RBAC: the per-user visibility gate for media items
    musicDb,
    path,
    podcasts,
    requesterHasRestrictions,
    requireAdmin,
    requireModifyLibrary,
    scanDirectories,
    scanState, // the LIVE scan-state object (never reassigned, only mutated)
    tvDb,
    updateDatabase,
    ytdlp,
    ytdlpArgs,
  } = deps;
  // Set form for the O(1) membership checks the config writer does. Derived from
  // the registry, never a second hand-typed list.
  const GLYPH_IDS = new Set(glyphPool.GLYPH_POOL.map((g) => g.id));

  // API: Get library folders list
  //
  // FR-G part 2 (v1.12.0, yt-dlp module parity): merges the yt-dlp module's
  // download directory into the RESPONSE as a synthetic, display-only folder
  // entry, WITHOUT ever writing it into `db.folders` -- this is Dean-approved
  // and intentionally SOFTENS the prior locked decision C7(ii) ("`GET
  // /api/config` never lists a folder the operator didn't add"). Reconciliation
  // note: `extraScanRoots()` remains the sole AUTHORITATIVE scan root
  // (`runScanDirectories` above reads it directly, never this response) and
  // keeps the E1 mount-loss OR-gate intact regardless of whether this synthetic
  // entry is present here -- no scan/prune decision anywhere depends on this
  // merge. It self-heals on every request (derived fresh from `extraScanRoots`
  // each time, never a one-time materialization into `db.folders`): if an
  // operator "removes" it from the UI, there is nothing persisted to remove --
  // it reappears on the next GET as long as the module still contributes a
  // root. Disabled (and the download dir was never created) -> `extraScanRoots`
  // returns `[]` -> no synthetic entry, byte-identical to pre-FR-G behavior
  // (AC4/46).
  app.get('/api/config', (req, res) => {
    const db = getCachedDatabase(); // v1.30 A3: hot GET reader
    const folders = folderStore.list(); // Wave 4: the tables (fresh arrays/maps per call)
    const folderSettings = folderSettingsStore.getAll();
    const ytdlpConfig = ytdlp.parseYtdlpConfig();
    const synthRoots = ytdlp.extraScanRoots(ytdlpConfig); // [] when disabled & dir absent
    for (const root of synthRoots) {
      if (!folders.some(f => path.resolve(f) === root)) {
        // Item 3 (v1.13.0, order persistence): a prior reorder (persisted via
        // POST /api/config's synthetic folderSettings[root].order, alongside
        // the existing name rename) sticks -- splice the synthetic root in at
        // its stored display index instead of always appending last. A
        // missing/non-integer order (never reordered, or a stale/cleared
        // value) falls back to `folders.length`, reproducing the prior
        // always-append-last behavior byte-for-byte (backward compatible).
        // `order` is display-only: it is never read by any scan/prune path,
        // and `extraScanRoots()` above remains the sole authoritative root.
        const storedOrder = folderSettings[root] && folderSettings[root].order;
        const idx = Number.isInteger(storedOrder) ? Math.max(0, Math.min(storedOrder, folders.length)) : folders.length;
        folders.splice(idx, 0, root);
      }
      // A prior rename (persisted via POST /api/config's synthetic
      // folderSettings allowance below) sticks; otherwise default to a
      // friendly 'Downloads' label so the sidebar never shows a bare path.
      if (!folderSettings[root] || typeof folderSettings[root].name !== 'string' || !folderSettings[root].name) {
        folderSettings[root] = { ...(folderSettings[root] || {}), name: (folderSettings[root] && folderSettings[root].name) || 'Downloads' };
      }
    }
    // FR-4 (v1.19.0): additive, READ-ONLY, response-only field so the client
    // can robustly identify which `folders` entry is the synthetic download
    // root (e.g. to disable its remove button) without re-deriving/guessing a
    // path match itself. This is exactly `synthRoots` above -- never persisted,
    // never accepted back on POST, and does not change any synthetic-root
    // HANDLING (the splice/rename/order logic above, and the db.folders-
    // exclusion in POST /api/config below, are both untouched).
    // v1.126: the per-channel-folder display map rides the same read-only
    // payload folderSettings does - every folder-label surface (headers, the
    // Playlists sheet, the folder list, resolveChannelName's fallback) reads it
    // client-side from ONE fetch. Response-only here; writes go through
    // POST /api/folders/display-name below.
    let outFolders = folders;
    let outFolderSettings = folderSettings;
    const allDisplayNames = folderDisplayNameStore.getAll(); // Wave 4
    let outDisplayNames = allDisplayNames;
    // v1.128 Wave B (L1): this response drives the MEMBER sidebar nav, so it
    // can't be admin-gated - but for a RESTRICTED member it leaked every root
    // abs path + folderSettings + folder/channel display name, hidden ones
    // included. Filter to what the member can actually see: a root stays if some
    // visible video item lives under it; a display name stays if the member can
    // see an item in that folder. Admin + unrestricted member short-circuit to
    // the byte-identical payload (an empty configured folder must not vanish
    // from their sidebar).
    if (requesterHasRestrictions(req)) {
      const visibleRoots = new Set();
      const visibleFolderNames = new Set();
      for (const item of Object.values(db.metadata || {})) {
        if (!item || typeof item.filePath !== 'string') continue;
        if (!mediaVisibleTo(req, item)) continue;
        const root = matchRootFolder(item.filePath, folders);
        if (root) visibleRoots.add(root);
        if (typeof item.folderName === 'string' && item.folderName !== '') visibleFolderNames.add(item.folderName);
      }
      outFolders = folders.filter((f) => visibleRoots.has(f));
      outFolderSettings = {};
      for (const f of outFolders) if (folderSettings[f] !== undefined) outFolderSettings[f] = folderSettings[f];
      outDisplayNames = {};
      for (const name of Object.keys(allDisplayNames)) {
        if (visibleFolderNames.has(name)) outDisplayNames[name] = allDisplayNames[name];
      }
    }
    res.json({
      folders: outFolders,
      folderSettings: outFolderSettings,
      folderDisplayNames: outDisplayNames,
      // syntheticFolders is a display hint (which folders are the module download
      // root); intersect it with what actually survived the visibility filter.
      syntheticFolders: synthRoots.filter((r) => outFolders.includes(r)),
    });
  });

  // v1.126 (Dean): manual per-folder display name - the ONLY fix possible for
  // the ~70 folders whose items are permanently unhealable (no channelId, no
  // URL), and the override lane for everything else. `folderName` must name a
  // folder that actually exists in the library (derived from live metadata -
  // no junk-key writes); an empty/absent `name` CLEARS the mapping. Gated on
  // BOTH axes: requireModifyLibrary (capability - shared display metadata),
  // and visibility (a member restricted from the folder must not rename it -
  // neutral 404, the v1.123 T3 posture).
  app.post('/api/folders/display-name', async (req, res) => {
    if (!requireModifyLibrary(req, res)) return;
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const folderName = typeof body.folderName === 'string' ? body.folderName.trim() : '';
    if (folderName === '') return res.status(400).json({ error: 'folderName is required' });
    const db = getCachedDatabase();
    // Gate fix (both seats CRITICAL): existence AND visibility in ONE pass through
    // the CANONICAL decision - the folder is renamable iff it has at least one
    // item VISIBLE to this member. The earlier split used a bare
    // `{kind:'media', folderName}` descriptor, which only matches `folder`-kind
    // restrictions; `path`-kind and allowlist-mode restrictions carry no filePath,
    // so they never matched - a member restricted from a root by the path lane
    // could rename (and existence-oracle) a folder they cannot see. mediaVisibleTo
    // builds the FULL descriptor (filePath/folderName/rootFolder), so all four
    // restriction kinds bite. A wholly-hidden folder is indistinguishable from a
    // non-existent one (both -> the same neutral 404). NEVER re-implement the
    // visibility decision with a narrower descriptor (the v1.41.4 scar).
    const visibleExists = Object.values(db.metadata || {}).some((it) => it && it.folderName === folderName && mediaVisibleTo(req, it));
    if (!visibleExists) return res.status(404).json({ error: 'No such folder' });
    const rawName = typeof body.name === 'string' ? body.name.trim() : '';
    const name = rawName.slice(0, 150); // the pin-label bound
    try {
      await updateDatabase(() => {
        // Wave 4: the map is a table; the write rides the doc commit's transaction.
        const current = folderDisplayNameStore.get(folderName);
        if (name === '') {
          if (current === undefined) return false; // nothing to clear - skip the save
          inSaveTransaction(() => folderDisplayNameStore.remove(folderName));
          return true;
        }
        if (current === name) return false; // unchanged - skip the save
        inSaveTransaction(() => folderDisplayNameStore.set(folderName, name));
        return true;
      });
    } catch (err) {
      // Express 4 never observes a rejected async handler: an unguarded failed
      // save HUNG this request (gate pass A fix round, the Wave 3 class) - 500.
      console.error('Error saving folder display name:', err);
      return res.status(500).json({ error: `Could not save display name: ${err.message}` });
    }
    res.json({ success: true, folderName, name: name === '' ? null : name });
  });

  // Read the per-folder "show in Music" state for the folder header toggle.
  // Returns the stored override (or null); v1.242: `auto` is always true (every channel
  // is in Music by default) and `effective` is on-unless-'off' (channelEffectiveOnUniversal)
  // - the SAME predicate the projection uses, so the toggle can never disagree with what
  // actually projects; and whether the folder has any VISIBLE audio (the toggle renders only
  // when it does, so a folder the user cannot see is never revealed). The item-level payloads
  // stay per-user visibility-gated.
  app.get('/api/folders/music-flag', (req, res) => {
    const folderName = typeof req.query.folderName === 'string' ? req.query.folderName.trim() : '';
    if (folderName === '') return res.status(400).json({ error: 'folderName is required' });
    const db = getCachedDatabase();
    const marks = musicDb.readPart('channels'); // Wave 5: the music_channels table (one table, not four)
    // Visibility-scoped: the toggle only renders for a channel the user can see.
    const hasVisibleAudio = Object.values(db.metadata || {}).some(
      (it) => it && it.type === 'audio' && it.folderName === folderName && mediaVisibleTo(req, it));
    if (!hasVisibleAudio) return res.json({ folderName, hasAudio: false, override: null, effective: false, auto: false });
    // v1.242: universal projection - a channel is in Music unless explicitly marked 'off'.
    // `auto` (the default, ignoring an override) is now always true; `effective` is on-unless-off.
    const override = Object.prototype.hasOwnProperty.call(marks, folderName) ? marks[folderName] : null;
    const effective = libraryAudio.channelEffectiveOnUniversal(folderName, marks);
    return res.json({ folderName, hasAudio: true, override, effective, auto: true });
  });

  // Wave G: the per-folder "show in Music library" mark. `music` is 'on'/'off'
  // (an explicit override) or null (clear -> back to the v1.242 default, which is ON:
  // every channel is in Music unless explicitly marked 'off').
  // Same dual-axis gate as the rename route (requireModifyLibrary - shared library
  // metadata - AND visibility), but the existence probe requires a visible AUDIO
  // item: the mark is meaningless on a folder with no library audio, and this
  // blocks junk-key writes for video-only or unseen folders. Writes
  // db.music.channels[folderName]; the projection reads it in /api/music*.
  app.post('/api/folders/music-flag', async (req, res) => {
    if (!requireModifyLibrary(req, res)) return;
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const folderName = typeof body.folderName === 'string' ? body.folderName.trim() : '';
    if (folderName === '') return res.status(400).json({ error: 'folderName is required' });
    const music = body.music;
    if (!(music === 'on' || music === 'off' || music === null)) {
      return res.status(400).json({ error: "music must be 'on', 'off', or null" });
    }
    const db = getCachedDatabase();
    // Existence AND visibility in ONE pass through the canonical decision (the
    // v1.41.4 scar): renamable/markable iff the folder has >=1 AUDIO item visible
    // to this user. A wholly-hidden or non-existent folder -> the same neutral 404.
    const visibleAudioExists = Object.values(db.metadata || {}).some(
      (it) => it && it.type === 'audio' && it.folderName === folderName && mediaVisibleTo(req, it));
    if (!visibleAudioExists) return res.status(404).json({ error: 'No such folder' });
    try {
      await updateDatabase(() => musicDb.mutate((mdb) => { // Wave 5: the mark's diff rides the doc commit
        const current = mdb.music.channels[folderName];
        if (music === null) {
          if (current === undefined) return false; // nothing to clear
          delete mdb.music.channels[folderName];
          return true;
        }
        if (current === music) return false; // unchanged
        mdb.music.channels[folderName] = music;
        return true;
      }));
    } catch (err) {
      // Express 4 never observes a rejected async handler: an unguarded failed
      // save HUNG this request (the Wave 3 class, found by the Wave 5 binding) - 500.
      console.error('Error saving the music mark:', err);
      return res.status(500).json({ error: `Could not save the music mark: ${err.message}` });
    }
    res.json({ success: true, folderName, music });
  });

  // API: Save folder configuration
  app.post('/api/config', async (req, res) => {
    // v1.81 write-RBAC (gate CRITICAL): library-folder configuration is an
    // admin/setup concern (like user-management + backup/restore). It was
    // member-reachable and, with pruneMissing, a member POSTing an empty/edited
    // folder list could WIPE the library index - strictly more destructive than
    // the scan route this wave already gated. GET stays open (the sidebar needs
    // it); only the mutating POST is admin-gated.
    if (!requireAdmin(req, res)) return;
    const { folders, folderSettings } = req.body;
    if (!Array.isArray(folders)) {
      return res.status(400).json({ error: 'folders must be an array of paths' });
    }

    // FR-G part 2: the module's synthetic download-dir root(s) are never
    // written into `db.folders` here, but a `folderSettings` entry keyed by a
    // synthetic root's resolved path IS allowed to persist on its own (e.g. a
    // rename) even though the root itself is absent from `folders` -- this is
    // how a rename sticks across restarts without the folder ever becoming a
    // "real" `db.folders` row (see GET /api/config above). Computed BEFORE the
    // `validFolders` loop below (FIX-2) so that loop can exclude a synthetic
    // root a client round-tripped back from `GET /api/config`'s display-only
    // merge.
    const ytdlpConfig = ytdlp.parseYtdlpConfig();
    const syntheticRoots = new Set(ytdlp.extraScanRoots(ytdlpConfig));

    // Validate that folders exist locally, and DEDUPLICATE a submitted list
    // using a resolved key -- WITHOUT rewriting the persisted spelling itself.
    //
    // FIX-1 (two-reviewer gate, BLOCKER, data-loss regression, same class as
    // the scan-side fix above): this used to `path.resolve()` every surviving
    // entry and persist THAT into `db.folders`. `getMediaId` hashes the
    // absolute `filePath` a file was scanned under, so rewriting an EXISTING
    // operator's stored folder spelling here -- even one that already resolved
    // to itself, but especially a relative/symlink/bind-mount spelling that
    // doesn't -- would change every file's id under that root on the very next
    // scan, and `pruneMissing` (default ON) would reap the old ids' metadata/
    // thumbnails/`db.progress` the same way the scan-side bug did. A save that
    // didn't intend to change anything must leave existing stored strings
    // byte-identical.
    //
    // The fix: `path.resolve` is used ONLY as a comparison key to drop a
    // submitted entry that resolves to one already kept (or to a synthetic
    // root, FIX-2 below) -- the ORIGINAL (trimmed, as-submitted) string is
    // what's pushed into `validFolders` and ultimately persisted.
    const validFolders = [];
    const seenResolved = new Set();
    // The client's `folderSettings` object is keyed by whatever folder string
    // it last received -- remember the resolved form for each submitted
    // original so the settings lookup below still finds it, independent of
    // `validFolders` now holding un-resolved spellings.
    const resolvedFromOriginal = new Map();
    // QW2 (fast-follow, correctness fix): resolved key -> the ORIGINAL
    // (trimmed, as-submitted) spelling that actually survived into
    // `validFolders` for that resolved root. `db.folders` (via FIX-1) stores
    // the original submitted spelling, not the resolved one -- so
    // `db.folderSettings` must be keyed the SAME way, or a non-canonical
    // spelling (trailing separator, relative path, a `.`/`..` segment -- not
    // symlinks, those are a separate FR-G concern) ends up with `db.folders`
    // and `db.folderSettings` keyed by two DIFFERENT strings. The client's
    // rename/hidden lookups (`resolveChannelName` in public/js/common.js,
    // public/js/main.js, and the GET /api/videos hidden-folder filter below)
    // all index `folderSettings` by the RAW as-scanned spelling
    // (`item.rootFolder`, which comes from `db.folders`) -- so a resolved-key
    // mismatch here made the setting silently unreachable, even though it was
    // faithfully persisted.
    const originalByResolved = new Map();
    // Item 3 (v1.13.0, order persistence): resolved synthetic root -> its
    // display index in the SUBMITTED `folders` order (the count of real
    // folders that preceded it), derived purely from client-submitted
    // position -- no new client logic needed, the client already sends the
    // reordered array via the existing up/down Setup-page controls. Never
    // read by any scan/prune path.
    const syntheticOrders = new Map();
    for (const folder of folders) {
      if (typeof folder !== 'string') continue;
      const trimmed = folder.trim();
      if (!trimmed || !fs.existsSync(trimmed)) continue;
      const resolved = path.resolve(trimmed);
      resolvedFromOriginal.set(trimmed, resolved);
      if (seenResolved.has(resolved)) continue;
      seenResolved.add(resolved);
      // FIX-2 (two-reviewer gate, BLOCKER-adjacent, C7 reap-surface reopened):
      // `GET /api/config` merges the module's synthetic download-dir root into
      // its RESPONSE for display purposes only (never into `db.folders`) -- but
      // a normal settings-page save round-trips that same `folders` array back
      // into THIS handler. Without this check, the synthetic entry passed the
      // (typeof-string/trim/existsSync)-only filter above and got persisted
      // into `db.folders` on the very next save, reopening the exact
      // "downloadDir must never be in db.folders" violation C3/C7 exists to
      // prevent (disable-reap risk: a `db.folders`-resident downloadDir can be
      // evicted by a later save, or double-walked alongside `extraScanRoots`).
      // Excluded here, unconditionally -- its `folderSettings` entry (a rename)
      // is untouched by this and still persists via `cleanSettings` below.
      if (syntheticRoots.has(resolved)) {
        // Record its intended display index (== how many real folders
        // preceded it in the submitted order) BEFORE skipping it -- it is
        // still never pushed into `validFolders`/`db.folders`.
        syntheticOrders.set(resolved, validFolders.length);
        continue;
      }
      // v1.37.0 gate fix (adversarial W1): the books design's HARD INVARIANT
      // -- "book roots may never overlap media roots in EITHER direction" --
      // was only enforced on the books side (POST /api/books/config). Enforce
      // the reverse here too: a media folder that equals, contains, or lives
      // inside a configured BOOK root is rejected, or a later media save
      // could silently double-own a subtree the two scanners' prune/merge
      // semantics would then fight over.
      const bookRoots = booksDb.read().folders; // Wave 5: the books roots are a table
      for (const bookRoot of bookRoots) {
        const resolvedBookRoot = path.resolve(bookRoot);
        if (resolved === resolvedBookRoot || ytdlpArgs.isPathUnder(resolved, resolvedBookRoot) || ytdlpArgs.isPathUnder(resolvedBookRoot, resolved)) {
          return res.status(400).json({ error: `Media folder overlaps a book folder: ${trimmed} <-> ${bookRoot}` });
        }
      }
      // v1.44 music: the reciprocal of POST /api/music/config's own three-way
      // guard -- a media folder may not equal/contain/live inside a MUSIC root
      // either, so ownership stays order-independent (whichever config saves
      // second is the one that catches the overlap).
      const musicRoots = musicDb.read().folders;
      for (const musicRoot of musicRoots) {
        const resolvedMusicRoot = path.resolve(musicRoot);
        if (resolved === resolvedMusicRoot || ytdlpArgs.isPathUnder(resolved, resolvedMusicRoot) || ytdlpArgs.isPathUnder(resolvedMusicRoot, resolved)) {
          return res.status(400).json({ error: `Media folder overlaps a music folder: ${trimmed} <-> ${musicRoot}` });
        }
      }
      // v1.195 TV Shows: the reciprocal of POST /api/tv/config's own net - a media
      // folder may not equal/contain/live inside a Shows root either.
      for (const tvRoot of tvDb.read().folders) {
        if (foldersOverlap(resolved, path.resolve(tvRoot))) {
          return res.status(400).json({ error: `Media folder overlaps a Shows folder: ${trimmed} <-> ${tvRoot}` });
        }
      }
      // v1.69 podcasts (D8, the FOUR-way): the podcasts download root is
      // module-owned (env/default, not a configured list), but a media folder
      // that equals/contains/lives inside it would double-own the episodes.
      {
        const podcastsRoot = podcasts.resolvePodcastsRoot(loadDatabase(), { dataDir: DATA_DIR });
        if (resolved === podcastsRoot || ytdlpArgs.isPathUnder(resolved, podcastsRoot) || ytdlpArgs.isPathUnder(podcastsRoot, resolved)) {
          return res.status(400).json({ error: `Media folder overlaps the podcasts folder: ${trimmed} <-> ${podcastsRoot}` });
        }
      }
      validFolders.push(trimmed);
      originalByResolved.set(resolved, trimmed); // QW2
    }

    // Keep per-folder settings (display name / hidden), pruned to folders that
    // still exist OR are a synthetic root.
    const cleanSettings = {};
    if (folderSettings && typeof folderSettings === 'object') {
      for (const [key, s] of Object.entries(folderSettings)) {
        if (!s || typeof s !== 'object') continue;
        const resolvedKey = resolvedFromOriginal.get(key) || path.resolve(key);
        if (!seenResolved.has(resolvedKey) && !syntheticRoots.has(resolvedKey)) continue;
        // QW2: the dedup/synthetic-root MEMBERSHIP CHECK above stays keyed by
        // the resolved path (that part was already correct) -- but the key we
        // actually STORE under matches `db.folders`' spelling for that root: a
        // synthetic root (never in `db.folders`, always already a resolved
        // path from `extraScanRoots`) keeps the resolved key unchanged; a real
        // `db.folders` entry is stored under the SAME original spelling that
        // survived into `validFolders`, so the client's `item.rootFolder`
        // lookups can actually find it.
        const storageKey = syntheticRoots.has(resolvedKey) ? resolvedKey : (originalByResolved.get(resolvedKey) || resolvedKey);
        cleanSettings[storageKey] = {
          name: typeof s.name === 'string' ? s.name.trim() : '',
          hidden: !!s.hidden,
          // v1.14.0 item 3: "Hide from sidebar" -- distinct from `hidden`
          // ("Hide from home"). Independently boolean-coerced (never dropped
          // like the pre-fix whitelist did), so a folder can be hidden from
          // one, both, or neither, in any combination. Backfill for a legacy
          // entry that never set it: `undefined` -> `false` (not hidden).
          hiddenFromSidebar: !!s.hiddenFromSidebar
        };
        // v1.77: the folder's chosen glyph. This whitelist is EXHAUSTIVE - a
        // field not named here is silently dropped on every save, which is why
        // it is widened in the same commit that starts writing the field rather
        // than a later one (the v1.14.0 scar directly above: the pre-fix
        // whitelist dropped hiddenFromSidebar the same way).
        //
        // Validated against the shared registry, never trusted: the value is
        // interpolated into a `class` attribute at four render sites, so an
        // arbitrary string here would be an HTML-injection primitive. Only an
        // exact known id is stored; anything else is dropped entirely, leaving
        // the folder on the default glyph. Absence is the default, so no
        // migration or backfill is needed for existing databases.
        if (typeof s.glyph === 'string' && GLYPH_IDS.has(s.glyph)) {
          cleanSettings[storageKey].glyph = s.glyph;
        }
        // Item 3 (v1.13.0, order persistence): `order` is ONLY ever written
        // for a synthetic root -- real (`db.folders`) folders keep their
        // order purely positional in `db.folders`, exactly as before this
        // change. Prefer the index just derived from the submitted `folders`
        // array (`syntheticOrders`); fall back to a client-submitted `s.order`
        // so a save that doesn't round-trip the synthetic root inside
        // `folders` (but still round-trips its `folderSettings` entry, e.g.
        // a rename-only save) doesn't silently drop a previously-stored
        // order. Only stored when it resolves to an integer.
        if (syntheticRoots.has(resolvedKey)) {
          const order = syntheticOrders.has(resolvedKey) ? syntheticOrders.get(resolvedKey) : (Number.isInteger(s.order) ? s.order : undefined);
          if (Number.isInteger(order)) cleanSettings[storageKey].order = order;
        }
      }
    }

    try {
      await updateDatabase(() => {
        // Wave 4: both maps land inside the doc commit's transaction (a failed
        // save leaves the tables exactly as they were).
        inSaveTransaction(() => {
          folderStore.replaceAll(validFolders);
          folderSettingsStore.replaceAll(cleanSettings);
        });
        return true;
      });
    } catch (err) {
      // Express 4 does not catch a rejected async-handler promise, so a
      // rejection left unguarded here would hang the request instead of
      // returning 500 (mirrors POST /api/scan's pattern above).
      console.error('Error saving folder configuration:', err);
      return res.status(500).json({ error: `Could not save folder configuration: ${err.message}` });
    }

    // Respond with the locally-computed values (not a `db` read back out of the
    // mutator) -- they're already known and identical to what was just saved.
    res.json({ success: true, folders: validFolders, folderSettings: cleanSettings });

    // Sync directories asynchronously in background
    scanDirectories().catch(console.error);
  });

  // API: Scan files on demand.
  // v1.30 A2 (AC2.1, CONTRACT CHANGE from the old synchronous 200/409): the
  // scan itself can now take a while even though it never blocks the event
  // loop (AC1.1), so this handler no longer `await`s it -- it fires
  // `scanDirectories()` fire-and-forget (mirroring `POST /api/config`'s own
  // background-scan trigger just above) and responds immediately. A scan
  // already in flight still flags the coalesced follow-up (unchanged
  // semantics, AC2.5) instead of starting a second concurrent scan; either way
  // the response is `202 { scanning: true, alreadyInProgress }` -- there is no
  // longer a 409/500 branch here: `scanDirectories()`'s own internal try/finally
  // (above) already logs and settles `scanState` on any error, and `.catch`
  // below guards the fire-and-forget call against an unhandled rejection.
  app.post('/api/scan', (req, res) => {
    if (!requireModifyLibrary(req, res)) return; // v1.81 write-RBAC (first guard)
    const alreadyInProgress = scanState.scanning;
    if (alreadyInProgress) {
      scanState.rescanRequested = true;
    } else {
      scanDirectories().catch(console.error);
    }
    res.status(202).json({ scanning: true, alreadyInProgress });
  });
}


function registerScanStatusRoute(app, deps) {
  const {
    folderStore,
    getCachedDatabase,
    mediaVisibleTo, // v1.80 RBAC: the per-user visibility gate for media items
    requesterHasRestrictions,
    scanState, // the LIVE scan-state object (never reassigned, only mutated)
    visibleConfigRoots,
    visibleMetadataFor,
  } = deps;

  // API: Live scan/transcode status for progress feedback in the UI
  app.get('/api/scan-status', (req, res) => {
    const db = getCachedDatabase(); // v1.30 A3: hot GET reader (was the one T2 left on loadDatabase)
    // v1.128 Wave B (L5): the content-derived fields (fileCount, folderCount,
    // transcodeNames) leaked full-library counts + pending-transcode item TITLES
    // to a restricted member. Scope the item set to what the requester may see;
    // admin + unrestricted member get the byte-identical full view. The
    // operational fields (scanning/processed/total/phase) are not content.
    const visibleMap = visibleMetadataFor(req, db.metadata);
    const items = Object.values(visibleMap);
    const folderCount = requesterHasRestrictions(req)
      ? visibleConfigRoots(req, folderStore.list(), items, mediaVisibleTo).length
      : folderStore.size(); // Wave 4
    // Same filter that has always produced the `transcoding` count -- this is
    // T2's generalized, codec-aware `needsTranscode`/`transcodeStatus` (a
    // codec-flagged HEVC .mp4 rides this exact filter, not a divergent one).
    const pending = items.filter(i =>
      i.needsTranscode && i.transcodeStatus && i.transcodeStatus !== 'ready' && i.transcodeStatus !== 'failed'
    );
    const transcodeNames = pending.slice(0, TRANSCODE_LIST_CAP).map(i => i.title || i.name);
    const transcodeOverflow = Math.max(0, pending.length - transcodeNames.length);
    res.json({
      scanning: scanState.scanning,
      lastScan: scanState.lastScan,
      // v1.30 A2 (AC2.2): cooperative-scan progress -- see `scanState`'s own
      // doc comment for the monotonic-within-a-pass contract. The db read
      // above now goes through `getCachedDatabase()` (v1.30 A3, T4).
      processed: scanState.processed,
      total: scanState.total,
      phase: scanState.phase,
      fileCount: items.length,
      folderCount,
      transcoding: pending.length,
      transcodeNames,
      transcodeOverflow
    });
  });
}


function registerLogoSettingsRoutes(app, deps) {
  const {
    CUSTOM_LOGO_MAX_BYTES,
    CUSTOM_LOGO_TYPES,
    customLogoMimeKey,
    customLogoPath,
    express, // only for express.raw on the logo upload
    fs,
    inSaveTransaction,
    requireAdmin,
    resolveLogoVariant,
    settingsStore,
    updateDatabase,
  } = deps;

  // Upload: raw image body (route-scoped express.raw -- this app deliberately
  // has no multipart dependency), validated by allowlisted Content-Type AND
  // magic bytes, capped at 1 MB.
  app.post(
    '/api/settings/logo',
    express.raw({ type: Object.keys(CUSTOM_LOGO_TYPES), limit: CUSTOM_LOGO_MAX_BYTES }),
    async (req, res) => {
      // v1.81 write-RBAC (forcing-net find): the instance logo is global/admin
      // config - the upload sibling of the now-admin-gated DELETE.
      if (!requireAdmin(req, res)) return;
      const mime = (req.headers['content-type'] || '').split(';')[0].trim();
      if (!Object.prototype.hasOwnProperty.call(CUSTOM_LOGO_TYPES, mime)) {
        return res.status(400).json({ error: 'Logo must be image/png, image/jpeg, or image/webp' });
      }
      const bytes = req.body;
      if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
        return res.status(400).json({ error: 'Empty upload' });
      }
      if (!CUSTOM_LOGO_TYPES[mime](bytes)) {
        return res.status(400).json({ error: 'File content does not match its image type' });
      }
      // Atomic write, same tmp+rename discipline as saveDatabase/runlog.
      // v1.32 gate fix (adversarial): the file write happens INSIDE the
      // updateDatabase mutator -- the single-writer FIFO then guarantees
      // bytes-on-disk and customLogoMime always land together, closing the
      // two-concurrent-uploads window where /logo could briefly serve one
      // upload's bytes under the other's Content-Type.
      // v1.33.1: variant-scoped -- ?variant=dark lands in its own file + its
      // own settings key, never touching the light variant (and vice versa).
      const variant = resolveLogoVariant(req.query.variant);
      const target = customLogoPath(variant);
      const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
      try {
        await updateDatabase(db => {
          fs.writeFileSync(tmp, bytes);
          fs.renameSync(tmp, target);
          inSaveTransaction(() => settingsStore.set(customLogoMimeKey(variant), mime)); // Wave 4: rides the doc commit
          return true;
        });
      } catch (err) {
        try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch { /* best-effort */ }
        console.error('Error saving custom logo:', err);
        return res.status(500).json({ error: `Could not save logo: ${err.message}` });
      }
      return res.json({ ok: true });
    },
    // Route-scoped error handler: an oversized body raised by express.raw's
    // limit becomes a clean JSON 413, mirroring the body-parser mapping the
    // one-shot download route uses.
    (err, req, res, next) => {
      if (err && (err.type === 'entity.too.large' || err.status === 413)) {
        return res.status(413).json({ error: 'Logo too large (max 1 MB)' });
      }
      return next(err);
    }
  );

  // Reset to the default text logo.
  app.delete('/api/settings/logo', async (req, res) => {
    if (!requireAdmin(req, res)) return; // v1.81 write-RBAC (gate CRITICAL): the instance logo is global/admin config
    // v1.33.1: variant-scoped -- DELETE ?variant=dark removes only the dark
    // variant; the plain DELETE keeps its v1.32 meaning (the light/default one).
    const variant = resolveLogoVariant(req.query.variant);
    const mimeKey = customLogoMimeKey(variant);
    try {
      await updateDatabase(db => {
        // Wave 4: the mime key is a settings row; its removal rides the commit.
        if (settingsStore.has(mimeKey)) inSaveTransaction(() => settingsStore.remove(mimeKey));
        return true;
      });
      try { fs.unlinkSync(customLogoPath(variant)); } catch { /* already gone -- fine */ }
    } catch (err) {
      console.error('Error removing custom logo:', err);
      return res.status(500).json({ error: `Could not remove logo: ${err.message}` });
    }
    return res.json({ ok: true });
  });
}


function registerSettingsRoutes(app, deps) {
  const {
    CACHE_MAX_AGE_DAYS_VALID_VALUES,
    DEFAULT_SETTINGS, // settingsResponse's transcriptAiPrompts fallback
    SCAN_INTERVAL_VALID_VALUES,
    TRASH_RETENTION_DAYS_VALID_VALUES,
    VALID_DEFAULT_SORTS,
    armScanTimer, // re-arms the periodic scan when the interval changes
    effectiveCacheCap, // settingsResponse's read-only effectiveCacheMaxBytes
    inSaveTransaction,
    requireAdmin,
    settingsStore,
    updateDatabase,
  } = deps;

  // Shape returned by both GET and POST /api/settings — the five persisted keys
  // plus a read-only `effectiveCacheMaxBytes` (UI prefill for the "no override"
  // case, since cacheMaxBytes:null defers to the env var / 5 GB default).
  function settingsResponse(settings) {
    return {
      scanIntervalMinutes: settings.scanIntervalMinutes,
      pruneMissing: settings.pruneMissing,
      cacheMaxBytes: settings.cacheMaxBytes,
      cacheMaxAgeDays: settings.cacheMaxAgeDays,
      // v1.65: trash retention (see DEFAULT_SETTINGS).
      trashRetentionDays: settings.trashRetentionDays,
      defaultView: settings.defaultView,
      autoplayNext: settings.autoplayNext,
      backgroundAudioForVideo: settings.backgroundAudioForVideo,
      // v1.34: the default home sort (see DEFAULT_SETTINGS).
      defaultSort: settings.defaultSort,
      // v1.34 T4: custom-vs-native mobile video controls (see DEFAULT_SETTINGS).
      mobileCustomPlayer: settings.mobileCustomPlayer,
      // v1.35: deterministic background audio (see DEFAULT_SETTINGS).
      preExtractAudio: settings.preExtractAudio,
      // v1.121: background-audio position pre-sync (see DEFAULT_SETTINGS).
      bgAudioSyncPosition: settings.bgAudioSyncPosition,
      // v1.41.6: relocate hydrated imports into their channel folder (see
      // DEFAULT_SETTINGS) -- ON by default.
      relocateHydratedImports: settings.relocateHydratedImports,
      // v1.51: the notification bell's instance-wide toggle (see DEFAULT_SETTINGS).
      notificationsEnabled: settings.notificationsEnabled,
      // v1.201: the "Share with AI" prompt list (see DEFAULT_SETTINGS). Always
      // an array - a pre-v1.201 db without the key falls back to the default.
      transcriptAiPrompts: Array.isArray(settings.transcriptAiPrompts) ? settings.transcriptAiPrompts : DEFAULT_SETTINGS.transcriptAiPrompts,
      // v1.202: the manual-attribution opt-in (see DEFAULT_SETTINGS).
      attributeControlEnabled: settings.attributeControlEnabled === true,
      effectiveCacheMaxBytes: effectiveCacheCap(settings),
      // v1.32 (custom logo): READ-ONLY here -- managed exclusively by the
      // dedicated POST/DELETE /api/settings/logo routes below (never via the
      // generic POST /api/settings merge; the key is deliberately absent from
      // KNOWN_KEYS so a stray write 400s).
      customLogo: typeof settings.customLogoMime === 'string' && settings.customLogoMime !== '',
      // v1.33.1: the DARK-mode variant's own read-only flag (same managed-by-
      // dedicated-routes posture; `customLogoDarkMime` is likewise absent from
      // KNOWN_KEYS so a stray generic-settings write 400s).
      customLogoDark: typeof settings.customLogoDarkMime === 'string' && settings.customLogoDarkMime !== ''
    };
  }

  // API: Read the Automation & Storage settings for Settings-page prefill.
  app.get('/api/settings', (req, res) => {
    res.json(settingsResponse(settingsStore.get())); // Wave 4: the table (defaults merged)
  });

  // API: Update the Automation & Storage settings. Body may be a PARTIAL object
  // (only the keys the user changed). Validates every provided key against its
  // allowed range before touching anything — on any invalid field the whole
  // request is rejected with 400 and nothing is persisted. Only the four known
  // keys are accepted; an unrecognized key is rejected too, keeping db.settings
  // free of arbitrary/typo'd keys.
  app.post('/api/settings', async (req, res) => {
    if (!requireAdmin(req, res)) return; // v1.81 write-RBAC (gate CRITICAL): global instance settings are admin-only (per-user prefs go via /api/me/settings)
    const body = req.body || {};
    // v1.41.6 DELIBERATE key-set change (this list is locked by
    // test/unit/database.test.js's DEFAULT_SETTINGS deep-equal and
    // test/integration/settings-cache-api.test.js's full-shape assertion, both
    // updated in the same commit): `relocateHydratedImports` joins the set --
    // the reheat's "move a hydrated import into its channel folder" lever.
    const KNOWN_KEYS = ['scanIntervalMinutes', 'pruneMissing', 'cacheMaxBytes', 'cacheMaxAgeDays', 'trashRetentionDays', 'defaultView', 'autoplayNext', 'backgroundAudioForVideo', 'defaultSort', 'mobileCustomPlayer', 'preExtractAudio', 'bgAudioSyncPosition', 'relocateHydratedImports', 'notificationsEnabled', 'transcriptAiPrompts', 'attributeControlEnabled'];
    for (const key of Object.keys(body)) {
      if (!KNOWN_KEYS.includes(key)) {
        return res.status(400).json({ error: `unknown settings key: ${key}` });
      }
    }
    if ('scanIntervalMinutes' in body && !SCAN_INTERVAL_VALID_VALUES.has(body.scanIntervalMinutes)) {
      return res.status(400).json({ error: 'scanIntervalMinutes must be one of 0, 30, 60, 360, 720, 1440' });
    }
    if ('pruneMissing' in body && typeof body.pruneMissing !== 'boolean') {
      return res.status(400).json({ error: 'pruneMissing must be a boolean' });
    }
    if ('cacheMaxBytes' in body) {
      const v = body.cacheMaxBytes;
      if (v !== null && !(Number.isInteger(v) && v > 0)) {
        return res.status(400).json({ error: 'cacheMaxBytes must be null or a positive integer' });
      }
    }
    if ('cacheMaxAgeDays' in body && !CACHE_MAX_AGE_DAYS_VALID_VALUES.has(body.cacheMaxAgeDays)) {
      return res.status(400).json({ error: 'cacheMaxAgeDays must be one of 0, 7, 14, 30, 90' });
    }
    if ('trashRetentionDays' in body && !TRASH_RETENTION_DAYS_VALID_VALUES.has(body.trashRetentionDays)) {
      return res.status(400).json({ error: 'trashRetentionDays must be one of 0, 7, 14, 30, 90' });
    }
    // v1.14.0 item 4: defaultView is a free-form folder path/key (the same
    // identity as a folderSettings key / ?root= param) or '' for "Most
    // Recent" -- only a string type check here (never validated against the
    // currently configured folders): a folder can be temporarily unmounted/
    // renamed/removed without 400ing a save, and the CLIENT falls back to
    // Most Recent at render time when the stored folder no longer exists
    // (resolveDefaultView in public/js/common.js), so this route never needs
    // to reject a since-removed folder path.
    if ('defaultView' in body && typeof body.defaultView !== 'string') {
      return res.status(400).json({ error: 'defaultView must be a string (folder path, or empty for Most recent)' });
    }
    // v1.34: the default home sort -- allowlisted to exactly the sort keys the
    // library dropdown offers (public/index.html #sort-select / videoQuery's
    // sortItems cases), so a stray/garbage value can never persist.
    if ('defaultSort' in body && !VALID_DEFAULT_SORTS.has(body.defaultSort)) {
      return res.status(400).json({ error: 'defaultSort must be one of: ' + [...VALID_DEFAULT_SORTS].join(', ') });
    }
    if ('mobileCustomPlayer' in body && typeof body.mobileCustomPlayer !== 'boolean') {
      return res.status(400).json({ error: 'mobileCustomPlayer must be a boolean' });
    }
    if ('preExtractAudio' in body && typeof body.preExtractAudio !== 'boolean') {
      return res.status(400).json({ error: 'preExtractAudio must be a boolean' });
    }
    // v1.121: bgAudioSyncPosition -- boolean, mirrors preExtractAudio exactly.
    if ('bgAudioSyncPosition' in body && typeof body.bgAudioSyncPosition !== 'boolean') {
      return res.status(400).json({ error: 'bgAudioSyncPosition must be a boolean' });
    }
    // v1.41.6: relocateHydratedImports -- boolean, mirrors preExtractAudio's own
    // validation exactly. A non-boolean here would decide whether user FILES get
    // moved, so it 400s like every other typed key rather than being coerced.
    if ('relocateHydratedImports' in body && typeof body.relocateHydratedImports !== 'boolean') {
      return res.status(400).json({ error: 'relocateHydratedImports must be a boolean' });
    }
    // v1.16.0 FR-3 (T3): autoplayNext -- boolean, mirrors pruneMissing's own
    // validation exactly.
    if ('autoplayNext' in body && typeof body.autoplayNext !== 'boolean') {
      return res.status(400).json({ error: 'autoplayNext must be a boolean' });
    }
    // v1.27.0 (EXPERIMENTAL): backgroundAudioForVideo -- boolean, mirrors
    // autoplayNext's own validation exactly.
    if ('backgroundAudioForVideo' in body && typeof body.backgroundAudioForVideo !== 'boolean') {
      return res.status(400).json({ error: 'backgroundAudioForVideo must be a boolean' });
    }
    // v1.51: notificationsEnabled -- boolean, mirrors pruneMissing exactly.
    if ('notificationsEnabled' in body && typeof body.notificationsEnabled !== 'boolean') {
      return res.status(400).json({ error: 'notificationsEnabled must be a boolean' });
    }
    // v1.202: attributeControlEnabled -- boolean, mirrors pruneMissing exactly.
    if ('attributeControlEnabled' in body && typeof body.attributeControlEnabled !== 'boolean') {
      return res.status(400).json({ error: 'attributeControlEnabled must be a boolean' });
    }
    // v1.201: transcriptAiPrompts -- validated + NORMALIZED (trimmed, ids
    // assigned) before the merge, so what persists is always the canonical
    // shape; a bad list rejects the WHOLE request (nothing partially persists).
    if ('transcriptAiPrompts' in body) {
      const checked = validateTranscriptAiPrompts(body.transcriptAiPrompts, settingsStore.getKey('transcriptAiPrompts')); // Wave 4
      if (!checked.ok) return res.status(400).json({ error: checked.error });
      body.transcriptAiPrompts = checked.value;
    }

    // All provided keys validated -- safe to merge and persist. `prevInterval`
    // and the merged `saved` settings are captured via closure from INSIDE the
    // mutator (the fresh-inside-the-lock db), not from a separate outer read.
    let prevInterval;
    let saved;
    try {
      await updateDatabase(() => {
        const before = settingsStore.get(); // Wave 4: the table, on the chained tick
        prevInterval = before.scanIntervalMinutes; // captured BEFORE the merge
        saved = { ...before, ...body };
        // Only the touched keys are written, inside the doc commit's transaction
        // (a failed save leaves the table exactly as it was).
        inSaveTransaction(() => settingsStore.update(body));
        return true;
      });
    } catch (err) {
      // Express 4 does not catch a rejected async-handler promise, so a
      // rejection left unguarded here would hang the request instead of
      // returning 500 (mirrors POST /api/scan's pattern above).
      console.error('Error saving settings:', err);
      return res.status(500).json({ error: `Could not save settings: ${err.message}` });
    }
    // Re-arm the periodic scan timer live ONLY when scanIntervalMinutes actually
    // changed, so an interval change takes effect immediately with no restart.
    // armScanTimer() does clearInterval + setInterval, which RESETS the
    // countdown -- re-arming unconditionally on every save (even for an
    // unrelated setting, or the same interval value) would defer the periodic
    // scan indefinitely if settings are saved more often than the interval.
    if (saved.scanIntervalMinutes !== prevInterval) armScanTimer();
    res.json(settingsResponse(saved));
  });
}


function registerCacheRoutes(app, deps) {
  const {
    ROKU_COMPAT_DIR,
    TRANSCODE_DIR,
    TTS_CACHE_DIR,
    activeProtectedPaths, // the recently-served set a clear must never yank a file out of
    booksDb,
    booksStore,
    clearAudioStatus,
    effectiveCacheCap,
    fs,
    isCompletedTranscode,
    isInFlightTranscode,
    path,
    requireModifyLibrary,
    settingsStore,
    transcodeCacheSize,
    updateDatabase,
  } = deps;

  // API: Current transcode-cache size on disk, for the Settings-page display.
  app.get('/api/cache/size', (req, res) => {
    res.json({
      // v1.46 (gate W2): honest accounting includes the roku-compat rendition
      // cache -- "Clear cache now" (below) sweeps it too.
      bytes: transcodeCacheSize(TRANSCODE_DIR) + transcodeCacheSize(ROKU_COMPAT_DIR),
      effectiveCacheMaxBytes: effectiveCacheCap(settingsStore.get()) // Wave 4
    });
  });

  // API: "Clear cache now" -- delete cached transcodes (video *.mp4 AND
  // background-audio *.m4a, v1.27.0 -- one coherent cache, see
  // isCompletedTranscode) on demand. Excludes any in-flight write (*.tmp.mp4/
  // *.tmp.m4a — deleting it would corrupt the write in progress) and anything
  // currently protected by
  // activeProtectedPaths (the same recentlyServed-within-RECENT_STREAM_MS set
  // evictTranscodeCache/sweepAgedTranscodes use) so a clear can never yank a
  // file out from under an actively-watched stream. Does NOT touch
  // db.metadata[id].lastServedAt -- a future re-transcode naturally re-records
  // it on next watch. Per-file
  // try/catch so a single failed unlink never fails the whole clear.
  // F1 (two-reviewer gate, v1.27.0): DOES clear a cleared item's stale
  // `audioStatus` (mirrors evictTranscodeCache/sweepAgedTranscodes's own
  // clearAudioStatus call, above) -- a manual "Clear cache now" is exactly as
  // capable of invalidating a `'ready'` background-audio sidecar as automatic
  // eviction/aging is.
  app.post('/api/cache/clear', (req, res) => {
    if (!requireModifyLibrary(req, res)) return; // v1.81 write-RBAC (first guard)
    let entries;
    try { entries = fs.readdirSync(TRANSCODE_DIR); } catch (_) { entries = []; }
    const now = Date.now();
    const protectedPaths = activeProtectedPaths(now);
    let removed = 0;
    let freedBytes = 0;
    for (const name of entries) {
      if (!isCompletedTranscode(name)) continue;
      const p = path.join(TRANSCODE_DIR, name);
      if (protectedPaths.has(p)) continue;
      try {
        const size = fs.statSync(p).size;
        fs.unlinkSync(p);
        removed++;
        freedBytes += size;
        if (name.endsWith('.m4a')) clearAudioStatus(path.basename(name, '.m4a'));
      } catch (e) {
        console.error(`Failed to clear cached transcode ${p}:`, e.message);
      }
    }
    // v1.46 (gate W2): also purge roku-compat renditions + verdict sidecars --
    // the size endpoint above counts this dir, so a clear must sweep it or the
    // UI would claim to have freed bytes it didn't. Same protections as the
    // transcode loop: skip in-flight tmp writes and actively-watched files
    // (an actively-watched rendition keeps its sidecar so the pair stays
    // coherent; everything rebuilds on demand).
    let rokuFiles;
    try { rokuFiles = fs.readdirSync(ROKU_COMPAT_DIR); } catch (_) { rokuFiles = []; }
    for (const name of rokuFiles) {
      if (isInFlightTranscode(name)) continue;
      const p = path.join(ROKU_COMPAT_DIR, name);
      if (name.endsWith('.mp4') && protectedPaths.has(p)) continue;
      if (name.endsWith('.json') && protectedPaths.has(path.join(ROKU_COMPAT_DIR, `${name.slice(0, -'.json'.length)}.mp4`))) continue;
      try {
        const st = fs.statSync(p);
        if (st.isDirectory()) continue;
        fs.unlinkSync(p);
        removed++;
        freedBytes += st.size;
      } catch (e) {
        console.error(`Failed to clear roku-compat rendition ${p}:`, e.message);
      }
    }
    // v1.38.0: also purge the TTS audio cache (nuke-all, like the transcode side
    // above). Skip in-flight work dirs/temps -- the worker cleans those itself.
    let ttsFiles;
    try { ttsFiles = fs.readdirSync(TTS_CACHE_DIR); } catch (_) { ttsFiles = []; }
    const sparedTtsKeys = new Set(); // keys whose audio survived (actively streaming)
    for (const name of ttsFiles) {
      if (name.startsWith('.tmp-') || name.endsWith('.tmp.m4a') || name.endsWith('.blocks.json.tmp')) continue;
      const p = path.join(TTS_CACHE_DIR, name);
      // Never yank a chapter audio out from under an ACTIVE listen session -- the
      // same recentlyServed protection the transcode loop above uses. The .m4a is
      // protected via markServed on serve; also spare its sibling .blocks.json.
      if (name.endsWith('.m4a') && protectedPaths.has(p)) { sparedTtsKeys.add(name.slice(0, -'.m4a'.length)); continue; }
      if (name.endsWith('.blocks.json') && protectedPaths.has(path.join(TTS_CACHE_DIR, `${name.slice(0, -'.blocks.json'.length)}.m4a`))) continue;
      try {
        const st = fs.statSync(p);
        if (st.isDirectory()) continue;
        fs.unlinkSync(p);
        removed++;
        freedBytes += st.size;
      } catch (e) {
        console.error(`Failed to clear cached TTS audio ${p}:`, e.message);
      }
    }
    // Drop the status rows whose files we deleted, but KEEP a spared (actively
    // streaming) chapter's row so its /status stays truthful while it plays on.
    updateDatabase(() => booksDb.mutate((db) => {
      const ns = booksStore.ensureBooks(db);
      for (const bookId of Object.keys(ns.audio)) {
        const chapters = ns.audio[bookId];
        for (const idx of Object.keys(chapters)) {
          const entry = chapters[idx];
          if (!entry || !entry.key || !sparedTtsKeys.has(entry.key)) delete chapters[idx];
        }
        if (Object.keys(chapters).length === 0) delete ns.audio[bookId];
      }
      return true;
    })).catch((err) => console.error('Failed to reset book audio status on cache clear:', err && err.message));
    res.json({ success: true, removed, freedBytes });
  });
}


function registerStorageSummaryRoute(app, deps) {
  const {
    getCachedDatabase,
    mediaVisibleTo, // v1.80 RBAC: the per-user visibility gate for media items
    stats,
    withEffectiveViewCounts,
  } = deps;

  // v1.158 (Dean): the library's total bytes on disk, visibility-scoped - the
  // SAME figure the Stats "Total size on disk" tile shows (computeLibraryStats
  // over the requester's VISIBLE metadata, built exactly as /api/stats builds it
  // below), surfaced in the account ("You") menu so the core self-hosted number
  // is not a tap away in Stats. Tiny payload; the menu fetches it lazily on open.
  app.get('/api/storage-summary', (req, res) => {
    const db = getCachedDatabase();
    const withVc = withEffectiveViewCounts(db);
    const visibleMetadata = {};
    for (const id of Object.keys(withVc)) {
      if (mediaVisibleTo(req, withVc[id])) visibleMetadata[id] = withVc[id];
    }
    res.json({ totalSizeBytes: stats.computeLibraryStats(visibleMetadata).totalSizeBytes });
  });
}


module.exports = {
  registerConfigRoutes,
  registerScanStatusRoute,
  registerLogoSettingsRoutes,
  registerSettingsRoutes,
  registerCacheRoutes,
  registerStorageSummaryRoute,
};
