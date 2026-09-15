'use strict';

// lib/notifications/routes.js - the /api/notifications routes (the bell's
// badge, panel, seen/read/dismiss/clear), moved VERBATIM out of server.js in
// Wave 7b, slice S1a, of the relational-migration arc
// (docs/exec-plans/completed/2026-09-13-sqlite-relational-migration.md). The
// bodies are byte-identical to the server.js originals; their free identifiers
// resolve from the `deps` bundle server.js hands in at the call site - the
// lib/ytdlp + lib/podcasts registerRoutes pattern. A missing dep is a hard
// failure (a destructured undefined that is later called throws), never a
// silent fallback.
//
// notificationsFeatureEnabled deliberately STAYED in server.js: the push
// delivery bundle (createPushDelivery's `enabled` reader) calls it too, so it
// is a shared collaborator, not a group-private helper - it crosses as a dep
// here and to lib/push/routes.js, the SAME function object on both sides.

function registerRoutes(app, deps) {
  const {
    getCachedDatabase,
    mediaVisibleTo,
    notificationsFeatureEnabled, // the three-way bell gate - shared with the push routes and the delivery loop
    podcastEpisodeVisibleTo,
    podcastsDb,
    resolveItemChapters,
    trashStore,
    userStore,
    ytdlp,
    ytdlpDb,
  } = deps;

  // The badge count. Doubles as the client's boot probe, so it is the ONE
  // endpoint that must stay cheap: two point queries against the cache.
  app.get('/api/notifications/badge', (req, res) => {
    const db = getCachedDatabase(); // hot poll reader (60s cadence per client)
    if (!notificationsFeatureEnabled(db)) return res.status(404).json({ error: 'notifications disabled' });
    // v1.146: engine rows are admin-only - the badge and the panel must agree
    // (a member badge ticking for a row the panel filters out is a phantom
    // badge that user could never clear by reading).
    res.json({ count: userStore.countUnseenNotifications(req.user.id, { includeEngine: req.user.role === 'admin' }) });
  });

  // The panel list: feed rows joined against the CURRENT library item (title/
  // channel/thumbnail are never denormalized into the feed -- the item is the
  // source of truth and prune-on-delete keeps the join target alive). A row
  // whose item vanished mid-flight (delete committed, scan prune still
  // pending) is filtered here as the defensive net.
  app.get('/api/notifications', (req, res) => {
    const db = getCachedDatabase();
    const ytView = ytdlpDb.holder(['subscriptions', 'channelAvatars']); // Wave 5: the avatar registry + subscriptions, ONE read per request (resolveItemChannelAvatarUrl is read-only)
    if (!notificationsFeatureEnabled(db)) return res.status(404).json({ error: 'notifications disabled' });
    const { items } = userStore.listNotifications(req.user.id);
    const metadata = db.metadata || {};
    const rows = [];
    const phantomMediaIds = [];
    const phantomEpisodeIds = [];
    // v1.73: podcast rows resolve against the episodes map, never db.metadata
    // (the shapedQueue posture) - one ns read for the whole request.
    const podcastNsForFeed = podcastsDb.read();
    const podcastSubNames = new Map(podcastNsForFeed.subscriptions.filter(Boolean).map((sub) => [sub.id, sub.name]));
    for (const row of items) {
      // v1.146 (downloader-engine T5): engine event rows - ADMIN-ONLY (an
      // engine revert is an operator concern; members must see neither the
      // row nor, via the badge/unseenCount above, its existence). The id
      // carries the whole payload; a malformed one (crafted backup bundle)
      // parses to null and renders NOTHING - never garbage.
      if (row.kind === 'engine') {
        if (!req.user || req.user.role !== 'admin') continue;
        const parsed = ytdlp.parseEngineNotificationId(row.mediaId);
        if (!parsed) continue;
        rows.push({
          id: row.id,
          mediaId: row.mediaId,
          createdAt: row.createdAt,
          unread: row.unread,
          kind: 'engine',
          title: ytdlp.describeEngineEvent(parsed.event, parsed.version),
          channelName: 'Downloader engine',
          folderName: '',
          channelAvatarUrl: '',
          hasThumbnail: false,
          type: 'engine',
        });
        continue;
      }
      if (row.kind === 'podcast') {
        const ep = Object.prototype.hasOwnProperty.call(podcastNsForFeed.episodes, row.mediaId) ? podcastNsForFeed.episodes[row.mediaId] : null;
        if (!ep) {
          // The episode record is GONE (purged/unsubscribed with a failed
          // carrier, or a restored feed referencing since-deleted episodes):
          // prune via the episode carrier - the ONE deleter for this id
          // space, idempotent over already-purged per-user rows. NEVER
          // removeMediaState (a media item sharing the md5 id would lose
          // every user's state - the kind-confusion class).
          phantomEpisodeIds.push(row.mediaId);
          continue;
        }
        if (ep.status !== 'downloaded') continue; // trashed/pending - HIDDEN, not phantom (restore brings it back)
        if (!podcastEpisodeVisibleTo(req, ep)) continue; // v1.80 RBAC: no restricted show title in the bell
        const showName = podcastSubNames.has(ep.subId) ? podcastSubNames.get(ep.subId) : '';
        rows.push({
          id: row.id,
          mediaId: row.mediaId,
          createdAt: row.createdAt,
          unread: row.unread,
          kind: 'podcast',
          title: ep.title || '',
          channelName: showName || 'Podcast',
          folderName: showName || '',
          channelAvatarUrl: '',
          hasThumbnail: false,
          artUrl: `/podcastart/${encodeURIComponent(ep.subId)}`,
          type: 'audio',
          durationSec: Number(ep.durationSec) > 0 ? Number(ep.durationSec) : 0, // v1.208: the episode length for the panel badge
        });
        continue;
      }
      // Own-property lookup (gate round 2, adversarial): a feed row whose
      // mediaId is a prototype key ('constructor', ...) -- reachable only via
      // a crafted admin bundle -- must read as ABSENT, not as a truthy
      // inherited junk item that the phantom-prune below would then skip
      // forever (the v1.42 __proto__ row-key lesson).
      const item = Object.prototype.hasOwnProperty.call(metadata, row.mediaId) ? metadata[row.mediaId] : undefined;
      if (!item) {
        // v1.65 gate fix (QA C1): a TRASHED item's feed row re-keyed to the
        // trashId along with the other eight carriers -- it is HIDDEN, not
        // phantom. The prune below calls removeMediaState, which would
        // destroy every user's progress/likes/watched/queue for the trashed
        // item and break restore's full-fidelity promise on the first
        // bell-open (proven by the seat's runnable repro). Filter without
        // pruning; restore re-keys the row home, purge retires it. (The
        // badge counts the hidden row until then -- accepted, disclosed.)
        if (trashStore.has(row.mediaId)) { // Wave 3: the table
          continue;
        }
        // GATE FIX (adversarial W3): a feed row whose item is GONE (a delete
        // whose removeMediaState call failed and was caught-and-continued, or
        // a restored feed referencing since-deleted media) is not just
        // filtered from this response -- it is collected and pruned below, so
        // the badge (which counts feed rows without a metadata join) stops
        // disagreeing with the panel after the first open. removeMediaState
        // is the existing carrier-scrub; reusing it keeps ONE deleter.
        phantomMediaIds.push(row.mediaId);
        continue;
      }
      // v1.80 RBAC (security-gate CRITICAL): the bell is a global feed - a
      // restricted member must not read a restricted item's TITLE here. Hide the
      // row (it stays for other users); do NOT prune (it is visible content for
      // someone). Admin's empty index hides nothing.
      if (!mediaVisibleTo(req, item)) continue;
      let channelAvatarUrl = typeof item.channelAvatarUrl === 'string' ? item.channelAvatarUrl : '';
      if (channelAvatarUrl === '') {
        // v1.85 #3a: resolveItemChannelAvatarUrl is READ-ONLY now (it reads via
        // readYtdlpNamespace, never ensureYtdlp), so the shared getCachedDatabase()
        // object can be handed in directly - no defensive deep-clone.
        channelAvatarUrl = ytdlp.resolveItemChannelAvatarUrl(ytView, item) || '';
      }
      rows.push({
        id: row.id,
        mediaId: row.mediaId,
        createdAt: row.createdAt,
        unread: row.unread,
        kind: 'media', // v1.73: carried on every row
        title: item.title || item.name || '',
        channelName: typeof item.channelName === 'string' ? item.channelName : '',
        folderName: typeof item.folderName === 'string' ? item.folderName : '',
        channelAvatarUrl,
        hasThumbnail: item.hasThumbnail === true,
        type: item.type === 'audio' ? 'audio' : 'video',
        // v1.251: chapterCount for audio (the v1.236 fold, /api/videos parity) so the bell
        // row's audio reroute opens a chaptered download AS ITS ALBUM (::c0), like every
        // other surface. Audio-only - video rows never reroute.
        ...(item.type === 'audio' ? { chapterCount: (resolveItemChapters(item).chapters || []).length } : {}),
        // v1.208 (Dean): the watch length, so the panel can show a small duration
        // badge (triage before deleting). Seconds; 0 when unknown -> no badge.
        durationSec: Number(item.duration) > 0 ? Number(item.duration) : 0,
      });
    }
    if (phantomMediaIds.length > 0) {
      // Wave 1 (deliberate EXEMPTION, both gate seats): the view-count row is
      // NOT pruned here. This prune exists for badge/panel coherency - it scrubs
      // per-user feed state for ids that no longer resolve to metadata. A
      // view-count row feeds no count that can disagree with anything a user
      // sees; its only effect is a resumed count on a same-path re-add (the
      // class accepted at the delete route), and making a GET route a second
      // deleter of media state is not worth that. Later waves: the same call
      // applies - carrier removal belongs to the delete/prune/purge writers.
      try {
        userStore.removeMediaState(phantomMediaIds);
      } catch (err) {
        console.error('Notifications: failed to prune phantom feed rows (continuing):', err && err.message);
      }
    }
    if (phantomEpisodeIds.length > 0) {
      try {
        userStore.removePodcastEpisodeState(phantomEpisodeIds);
      } catch (err) {
        console.error('Notifications: failed to prune phantom podcast feed rows (continuing):', err && err.message);
      }
    }
    // v1.146: same admin-only engine-row inclusion as the badge route above.
    res.json({ items: rows, unseenCount: userStore.countUnseenNotifications(req.user.id, { includeEngine: req.user.role === 'admin' }) });
  });

  // Opening the panel zeroes the NUMBER badge (two-tier semantics, decision 3:
  // per-row dots survive until tapped).
  app.post('/api/notifications/seen', (req, res) => {
    const db = getCachedDatabase();
    if (!notificationsFeatureEnabled(db)) return res.status(404).json({ error: 'notifications disabled' });
    userStore.markNotificationsSeen(req.user.id, Date.now());
    res.json({ success: true });
  });

  // Tapping a row drops its dot. A phantom id (evicted/pruned/fabricated) is a
  // 400, never a silently-banked read.
  app.post('/api/notifications/read', (req, res) => {
    const db = getCachedDatabase();
    if (!notificationsFeatureEnabled(db)) return res.status(404).json({ error: 'notifications disabled' });
    const id = req.body ? req.body.id : undefined;
    if (!Number.isInteger(id) || !userStore.markNotificationRead(req.user.id, id, Date.now())) {
      return res.status(400).json({ error: 'invalid notification id' });
    }
    res.json({ success: true });
  });

  // v1.68 (Dean ruling 3): per-row dismissal - the row leaves THIS user's
  // panel and badge, survives for every other user. Same phantom-id 400
  // discipline as /read (evicted/pruned/fabricated ids are never banked).
  app.post('/api/notifications/dismiss', (req, res) => {
    const db = getCachedDatabase();
    if (!notificationsFeatureEnabled(db)) return res.status(404).json({ error: 'notifications disabled' });
    const id = req.body ? req.body.id : undefined;
    if (!Number.isInteger(id) || !userStore.dismissNotification(req.user.id, id, Date.now())) {
      return res.status(400).json({ error: 'invalid notification id' });
    }
    res.json({ success: true });
  });

  // Clear-all: empties THIS user's panel view and zeroes their badge. The feed
  // rows themselves survive for every other user (per-user watermark, never a
  // global delete).
  app.post('/api/notifications/clear', (req, res) => {
    const db = getCachedDatabase();
    if (!notificationsFeatureEnabled(db)) return res.status(404).json({ error: 'notifications disabled' });
    userStore.clearNotifications(req.user.id, Date.now());
    res.json({ success: true });
  });
}

module.exports = { registerRoutes };
