'use strict';

// lib/cleanup/routes.js - GET /api/cleanup/suggestions: what FileTube would suggest clearing.
// READ-ONLY. There is deliberately no delete route here: the Clean up page sends explicit ids,
// one at a time, to the existing DELETE /api/videos/:id (Trash), which re-validates each id and
// runs the normal permission checks. A suggestion set is never something the server deletes by.

const { computeSuggestions } = require('./suggest');

function registerRoutes(app, deps) {
  const {
    getCachedDatabase, mediaVisibleTo, pendingProgress, requireModifyLibrary,
    userStore, viewCountStore, ytdlp, ytdlpDb, extractYtdlpVideoId,
  } = deps;

  app.get('/api/cleanup/suggestions', (req, res) => {
    // Same gate as the delete it feeds: a viewer cannot delete, so it gets no shortlist.
    if (!requireModifyLibrary(req, res)) return;
    const db = getCachedDatabase(); // pure read on a request path
    const viewerId = req.user.id;
    const accounts = userStore.listUsers();
    const users = accounts.map((u) => {
      const progress = userStore.getProgress(u.id);
      for (const entry of pendingProgress.values()) {
        if (entry.userId === u.id) progress[entry.mediaId] = entry.value; // read-your-writes
      }
      return { userId: u.id, progress, watched: userStore.getWatchedTimes(u.id), liked: userStore.getLiked(u.id) };
    });
    const ytView = ytdlpDb.holder(['subscriptions']);
    res.json(computeSuggestions({
      metadata: db.metadata,
      days: req.query.days,
      nowMs: Date.now(),
      viewerId,
      users,
      viewCounts: viewCountStore.getAll(),
      isVisible: (item) => mediaVisibleTo(req, item),
      isSubscriptionItem: (item) => !!ytdlp.findSubscriptionForChannel(ytView, item),
      extractVideoId: extractYtdlpVideoId,
    }));
  });
}

module.exports = { registerRoutes };
