'use strict';

// v1.394.0 (plan 2026-10-23-real-comments-and-links, W4): GET /api/videos/:id/comments - the
// saved top comments of ONE video (lib/media/sourceComments.js), for the watch page.
//
// Its own small route rather than a field on GET /api/videos/:id, so the item body every other
// client reads (the watch page, the iOS host, the remote) is unchanged and a restricted account's
// item response can never carry the comments by accident.
//
// Access, in this order:
//   1. the item must exist (an OWN property of the index - a `__proto__` id is a 404) and be
//      visible to the caller (mediaVisibleTo, the item route's own gate): otherwise the neutral 404;
//   2. R2: a restricted account (a non-admin with at least one user_restrictions row, blocklist or
//      allowlist) gets NO real comments, ever - the same empty answer as a video with no snapshot,
//      so the response does not even say whether one exists. Decided here on the server; the client
//      never just hides them. An admin, the no-auth single-user mode and the shared API token (no
//      req.user) get them.
// Never cached by a shared cache (`private, no-store`): two accounts can share one browser.
// The answer: { state: 'ok'|'disabled'|'none', fetchedAt: ISO|null, comments: [...] }.

function registerCommentRoutes(app, deps) {
  const { getCachedDatabase, mediaVisibleTo, sourceCommentStore, userStore } = deps;

  // R2's one predicate (exported for the tests through the module's own function).
  function isRestrictedAccount(req) {
    const user = req && req.user;
    if (!user || user.role === 'admin') return false;
    const rows = userStore.getRestrictions(user.id);
    return Array.isArray(rows) && rows.length > 0;
  }

  const NONE = Object.freeze({ state: 'none', fetchedAt: null, comments: [] });

  app.get('/api/videos/:id/comments', (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    const db = getCachedDatabase();
    const id = req.params.id;
    const metadata = db && db.metadata;
    const item = metadata && Object.prototype.hasOwnProperty.call(metadata, id) ? metadata[id] : null;
    if (!item || !mediaVisibleTo(req, item)) return res.status(404).json({ error: 'Media file not found' });
    if (isRestrictedAccount(req)) return res.json(NONE);
    let snap = null;
    try {
      snap = sourceCommentStore.get(id);
    } catch (err) {
      console.error('Comments: could not read the saved comments (answering none):', err && err.message);
    }
    return res.json(snap || NONE);
  });

  return { isRestrictedAccount };
}

module.exports = { registerCommentRoutes };
