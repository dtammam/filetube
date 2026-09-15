'use strict';

// lib/queue/routes.js - the /api/queue routes (and their private shapedQueue
// projector), moved VERBATIM out of server.js in Wave 7b, slice S1a, of the
// relational-migration arc (docs/exec-plans/completed/
// 2026-09-13-sqlite-relational-migration.md). The bodies are byte-identical to
// the server.js originals; their free identifiers now resolve from the `deps`
// bundle server.js hands in at the call site - the lib/ytdlp + lib/podcasts
// registerRoutes pattern. A missing dep is a hard failure (a destructured
// undefined that is later called throws), never a silent fallback.
//
// shapedQueue moved with the group because the group was its ONLY caller
// (every other mention in the tree is prose); it lives inside registerRoutes
// so it closes over the same deps the routes do.

function registerRoutes(app, deps) {
  const {
    getCachedDatabase,
    mediaVisibleTo,
    musicDb,
    ownTrack, // the OWN-property track lookup (shared with the music routes) - shapedQueue's prototype-pollution defense
    podcastEpisodeVisibleTo,
    podcastsDb,
    queueStore, // lib/queue/store.js's pure reducers - the queue's whole semantics
    trackVisibleTo,
    userStore,
  } = deps;

  // ============ v1.63 playback queue ("think YouTube" - Dean) ==================
  // One per-user queue; ALL semantics live in lib/queue/store.js's pure
  // reducers - these routes run reducer -> persist (userStore.setQueue,
  // whole-set transaction) -> respond with the shaped queue (the pin-routes
  // posture). Dead media ids are filtered at READ - belt to the
  // removeMediaState carrier's suspenders (a restore from another library,
  // or a delete racing a stale client, must never 500 the panel).

  // v1.128 Wave B (L9): shapedQueue now takes `req` (was userId) so it can drop
  // entries the requester cannot see. A hidden entry is SILENT-DROPPED exactly
  // like a dead/phantom id already is - hidden and dead are indistinguishable to
  // the client, which is the oracle-free posture the plan wants (a restricted
  // member with a hidden item queued before the restriction, or via a restored
  // bundle, simply never sees it echoed back with its title/path).
  function shapedQueue(db, req) {
    const userId = req.user.id;
    const raw = userStore.getQueue(userId);
    const live = queueStore.normalize(raw);
    const podcastNs = podcastsDb.read();
    const musicNs = musicDb.read();
    const entries = [];
    for (const e of live.entries) {
      if (e.kind === 'podcast') {
        // v1.71: podcast entries resolve against the episodes map, never
        // db.metadata. The SILENT-DROP is deliberately preserved for this id
        // space too - a trashed/tombstoned/phantom episode disappears from
        // the panel, belt to the delQueueByEpisode carrier's suspenders.
        const ep = Object.prototype.hasOwnProperty.call(podcastNs.episodes, e.mediaId) ? podcastNs.episodes[e.mediaId] : null;
        if (ep && ep.status === 'downloaded' && podcastEpisodeVisibleTo(req, ep)) {
          const sub = podcastNs.subscriptions.find((s) => s && s.id === ep.subId);
          entries.push({
            uid: e.uid,
            mediaId: e.mediaId,
            kind: 'podcast',
            // The media-item projection the queue consumers expect, from
            // podcast fields: show name as the channel label, show cover as
            // artUrl (buildQueueRowModel's podcast thumb source).
            item: {
              title: ep.title,
              name: ep.title,
              channelName: sub ? sub.name : null,
              folderName: sub ? sub.name : null,
              artUrl: `/podcastart/${encodeURIComponent(ep.subId)}`,
              durationSec: Number.isFinite(ep.durationSec) ? ep.durationSec : null,
              hasThumbnail: false,
            },
          });
        }
        continue;
      }
      if (e.kind === 'track') {
        // v1.72: track entries resolve against ns.tracks, never db.metadata.
        // The silent-drop is preserved for this id space too - a pruned/
        // phantom track disappears from the panel, belt to the
        // delQueueByTrack carrier's suspenders. (adversarial S3: the ns is
        // hoisted like the podcast one, not re-read per entry.)
        const track = ownTrack(musicNs.tracks, e.mediaId);
        if (track && trackVisibleTo(req, track)) {
          entries.push({
            uid: e.uid,
            mediaId: e.mediaId,
            kind: 'track',
            item: {
              title: track.title,
              name: track.title,
              channelName: track.artist || null,
              folderName: track.album || null,
              artUrl: `/albumart/${encodeURIComponent(track.id)}`,
              durationSec: Number.isFinite(track.durationSec) ? track.durationSec : null,
              hasThumbnail: false,
            },
          });
        }
        continue;
      }
      // hasOwnProperty (gate S9): a restored bundle can carry prototype-chain
      // keys as mediaIds; they must silent-drop like any dead id, never serve
      // a garbage item from the prototype.
      const item = Object.prototype.hasOwnProperty.call(db.metadata, e.mediaId) ? db.metadata[e.mediaId] : null;
      if (item && mediaVisibleTo(req, item)) entries.push({ uid: e.uid, mediaId: e.mediaId, kind: 'media', item });
    }
    // Dead-id filtering can orphan the pointer; normalize AGAIN on the
    // filtered view so the client never sees a pointer to a missing row.
    const view = queueStore.normalize({ entries, pointerUid: live.pointerUid });
    return { entries: view.entries, pointerUid: view.pointerUid, updatedAt: raw.updatedAt || 0 };
  }

  app.get('/api/queue', (req, res) => {
    res.json(shapedQueue(getCachedDatabase(), req));
  });

  app.post('/api/queue/items', (req, res) => {
    const db = getCachedDatabase();
    const body = req.body || {};
    const mediaId = typeof body.mediaId === 'string' ? body.mediaId : '';
    // v1.71: the entry's kind is CARRIED, never inferred (episode ids are
    // md5 hex exactly like media ids). Each kind existence-checks its own
    // id space; a podcast add requires a playable (downloaded) episode.
    // v1.72: 'track' joins (music in the one queue) - the row must still
    // exist in ns.tracks (the own-property ownTrack rule).
    const kind = (body.kind === 'podcast' || body.kind === 'track') ? body.kind : 'media';
    // v1.128 Wave B (L9): each kind visibility-checks after the existence check,
    // returning the SAME 404 as a missing id so a restricted member cannot use
    // the insert as an existence oracle for a hidden item (and never gets it
    // echoed back through the shaped queue).
    if (kind === 'podcast') {
      const podcastNs = podcastsDb.read();
      const ep = Object.prototype.hasOwnProperty.call(podcastNs.episodes, mediaId) ? podcastNs.episodes[mediaId] : null;
      if (!ep || ep.status !== 'downloaded' || !podcastEpisodeVisibleTo(req, ep)) return res.status(404).json({ error: 'Episode not found' });
    } else if (kind === 'track') {
      const track = musicDb.parts.tracks.get(mediaId); // Wave 5 (gate pass B): a point query
      if (!track || !trackVisibleTo(req, track)) return res.status(404).json({ error: 'no such track' });
    } else if (!Object.prototype.hasOwnProperty.call(db.metadata, mediaId) || !mediaVisibleTo(req, db.metadata[mediaId])) {
      // hasOwnProperty (gate S5): a prototype-chain key ('__proto__',
      // 'constructor', 'toString') must 404 like any phantom, never queue an
      // item-less entry the shaped view then serves as garbage. Wave B: a hidden
      // item 404s here too, indistinguishable from a missing one.
      return res.status(404).json({ error: 'Media file not found' });
    }
    const position = body.position === 'next' ? 'next' : 'end';
    const result = queueStore.reduceAdd(userStore.getQueue(req.user.id), mediaId, position, kind);
    if (!result.changed) {
      return res.status(400).json({ error: result.error === 'queue-full' ? `Queue is full (${queueStore.QUEUE_CAP} items)` : 'Could not add to queue' });
    }
    userStore.setQueue(req.user.id, result.state.entries, result.state.pointerUid, Date.now());
    res.json({ added: result.added, queue: shapedQueue(db, req) });
  });

  app.delete('/api/queue/items/:uid', (req, res) => {
    const result = queueStore.reduceRemove(userStore.getQueue(req.user.id), req.params.uid);
    if (!result.changed) return res.status(404).json({ error: 'Queue entry not found' });
    userStore.setQueue(req.user.id, result.state.entries, result.state.pointerUid, Date.now());
    res.json({ queue: shapedQueue(getCachedDatabase(), req) });
  });

  // Strict uid bijection (the reducer refuses drops/inventions): a stale
  // client gets a 409 telling it to refresh, never a "helpful" merge.
  app.post('/api/queue/reorder', (req, res) => {
    const orderedUids = req.body ? req.body.orderedUids : undefined;
    if (!Array.isArray(orderedUids) || !orderedUids.every((u) => typeof u === 'string' && u !== '')) {
      return res.status(400).json({ error: 'orderedUids must be an array of non-empty strings' });
    }
    // v1.65 (QA W1): lift the client's order over the VISIBLE entries back to
    // the full raw multiset -- a trashed item's entry is hidden from the
    // client but still lives in the raw queue (that is what buys restore
    // fidelity), and without this every reorder after a trash 409s forever.
    const rawQueue = userStore.getQueue(req.user.id);
    const visibleUids = shapedQueue(getCachedDatabase(), req).entries.map((e) => e.uid);
    const fullOrder = queueStore.expandVisibleOrder(rawQueue, visibleUids, orderedUids);
    const result = queueStore.reduceReorder(rawQueue, fullOrder);
    if (!result.changed) return res.status(409).json({ error: 'Queue changed - refresh and retry' });
    userStore.setQueue(req.user.id, result.state.entries, result.state.pointerUid, Date.now());
    res.json({ queue: shapedQueue(getCachedDatabase(), req) });
  });

  // The now-playing pointer. body.uid = an entry uid, or null to restart
  // (not-started semantics: the head is up next).
  app.post('/api/queue/pointer', (req, res) => {
    const uid = req.body ? req.body.uid : undefined;
    if (uid !== null && (typeof uid !== 'string' || uid === '')) {
      return res.status(400).json({ error: 'uid must be an entry uid or null' });
    }
    const result = queueStore.reduceSetPointer(userStore.getQueue(req.user.id), uid);
    if (!result.changed) return res.status(404).json({ error: 'Queue entry not found' });
    userStore.setQueue(req.user.id, result.state.entries, result.state.pointerUid, Date.now());
    res.json({ queue: shapedQueue(getCachedDatabase(), req) });
  });

  // Clear = the whole queue dies (icon disappears). Ephemeral by design -
  // one confirm toast client-side, no modal ceremony (Dean ruling 4).
  app.delete('/api/queue', (req, res) => {
    const result = queueStore.reduceClear();
    userStore.setQueue(req.user.id, result.state.entries, result.state.pointerUid, Date.now());
    res.json({ queue: { entries: [], pointerUid: null, updatedAt: Date.now() } });
  });
}

module.exports = { registerRoutes };
