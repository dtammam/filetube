'use strict';

// lib/push/routes.js - the /api/push routes (VAPID key, subscribe, unsubscribe),
// moved VERBATIM out of server.js in Wave 7b, slice S1a, of the
// relational-migration arc (docs/exec-plans/active/
// 2026-09-13-sqlite-relational-migration.md). Their free identifiers resolve
// from the `deps` bundle server.js hands in at the call site - the lib/ytdlp +
// lib/podcasts registerRoutes pattern. A missing dep is a hard failure (a
// destructured undefined that is later called throws), never a silent fallback.
//
// PUSH_SUBSCRIPTIONS_PER_USER_CAP moved with the group (the subscribe route was
// its only reader). ONE expression in POST /api/push/subscribe is NOT
// byte-identical, and deliberately so: server.js's `pushGuardLookupOverride` is
// a MUTABLE `let` that __setPushGuardLookupForTests reassigns long after these
// routes register, so it crosses as the live reader `pushGuardLookup()` instead
// of a value. Destructuring the value here would freeze the SSRF guard's test
// seam to its boot-time null - an inert seam, the v1.185 bug class
// (test/integration/push-api.test.js's private-IP refusal is what proves it
// live).

function registerRoutes(app, deps) {
  const {
    PUSH_VAPID,
    getCachedDatabase,
    notificationsFeatureEnabled, // the same three-way bell gate the notification routes use
    pushGuardLookup, // () => the live __setPushGuardLookupForTests override (null in production)
    pushShortlink,
    userStore,
  } = deps;

  // ============ v1.66 web push =================================================
  // Same three-way feature gate as the bell (this is the bell's delivery
  // channel). Subscribe is the ONE route that accepts a client-supplied
  // remote URL, so it carries the full SSRF discipline: https-only, shape-
  // checked keys (decode + length, not regex), guardHop (literal-IP + DNS
  // resolve-all, fail-closed) - and delivery re-checks at send time.

  const PUSH_SUBSCRIPTIONS_PER_USER_CAP = 10;

  app.get('/api/push/key', (req, res) => {
    const db = getCachedDatabase();
    if (!notificationsFeatureEnabled(db)) return res.status(404).json({ error: 'notifications disabled' });
    res.json({ key: PUSH_VAPID.publicKeyB64url });
  });

  // ASYNC HANDLER: Express 4 never observes a rejected async handler, so an
  // uncaught throw here is a SOCKET THAT HANGS FOREVER, not a 500 (the class
  // this repo already documented at the ytdlp async routes). The whole body is
  // try/caught for that reason - the v1.66 QA seat measured the unguarded
  // version hanging on an array-wrapped key that passed String() coercion and
  // then threw in the store.
  app.post('/api/push/subscribe', async (req, res) => {
    try {
      const db = getCachedDatabase();
      if (!notificationsFeatureEnabled(db)) return res.status(404).json({ error: 'notifications disabled' });
      const body = req.body || {};
      const endpoint = body.endpoint;
      const keys = body.keys && typeof body.keys === 'object' ? body.keys : {};
      if (typeof endpoint !== 'string' || endpoint.length === 0 || endpoint.length > 2048) {
        return res.status(400).json({ error: 'invalid endpoint' });
      }
      let parsed;
      try { parsed = new URL(endpoint); } catch { return res.status(400).json({ error: 'invalid endpoint' }); }
      // https only - push services are https, and http would leak the
      // capability URL in cleartext. (guardHop alone would allow http.)
      if (parsed.protocol !== 'https:') return res.status(400).json({ error: 'endpoint must be https' });
      // The browser's keys, decoded and measured - a p256dh that is not an
      // uncompressed P-256 point or an auth that is not 16 bytes could never
      // decrypt anyway; refuse it at the door. TYPE first: String(['a']) is
      // 'a', so a one-element array used to sail through this check and throw
      // deeper in (QA W1).
      let p256dhOk = false;
      let authOk = false;
      if (typeof keys.p256dh === 'string' && typeof keys.auth === 'string') {
        try {
          const p = Buffer.from(keys.p256dh, 'base64url');
          p256dhOk = p.length === 65 && p[0] === 0x04;
          authOk = Buffer.from(keys.auth, 'base64url').length === 16;
        } catch { /* fall through to the 400 */ }
      }
      if (!p256dhOk || !authOk) return res.status(400).json({ error: 'invalid subscription keys' });
      const guard = await pushShortlink.guardHop(endpoint, { lookup: pushGuardLookup() || undefined });
      if (!guard.ok) return res.status(400).json({ error: 'endpoint refused' });
      // Cap NEW endpoints per user (an unbounded roster is a delivery-time
      // amplification primitive); re-registering an existing endpoint is free.
      if (!userStore.getPushSubscription(endpoint)
        && userStore.countPushSubscriptions(req.user.id) >= PUSH_SUBSCRIPTIONS_PER_USER_CAP) {
        return res.status(409).json({ error: 'subscription limit reached for this account' });
      }
      // Cursor starts at the feed head: a fresh device is never back-flooded
      // with history (ruling P1; the bell panel is the history surface).
      userStore.upsertPushSubscription(
        req.user.id,
        { endpoint, p256dh: keys.p256dh, auth: keys.auth },
        userStore.getMaxNotificationId(),
        Date.now()
      );
      return res.json({ success: true });
    } catch (err) {
      console.error('POST /api/push/subscribe failed:', err && err.message);
      return res.status(500).json({ error: 'could not save the subscription' });
    }
  });

  app.post('/api/push/unsubscribe', (req, res) => {
    const db = getCachedDatabase();
    if (!notificationsFeatureEnabled(db)) return res.status(404).json({ error: 'notifications disabled' });
    const endpoint = (req.body || {}).endpoint;
    if (typeof endpoint !== 'string' || endpoint.length === 0 || endpoint.length > 2048) {
      return res.status(400).json({ error: 'invalid endpoint' });
    }
    // Owner-scoped: another user's endpoint is untouchable (removed:false,
    // not a 403 - do not confirm the endpoint exists at all).
    const removed = userStore.removeOwnPushSubscription(req.user.id, endpoint);
    res.json({ removed });
  });
}

module.exports = { registerRoutes };
