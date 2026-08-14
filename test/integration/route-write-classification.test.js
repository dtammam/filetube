'use strict';

// [INTEGRATION] v1.81 write-RBAC - the COMPLETENESS forcing net (gate WARNING-1).
//
// The rbac-census route-COUNT lock catches a NEW route but is blind to a
// PRE-EXISTING mutating route that was never gated - exactly how the bulk
// attribute + config holes slipped the initial enumeration. This test closes
// that blind spot structurally: it enumerates EVERY mutating route from the live
// Express table and (1) fails if any is unclassified - so a new mutating route
// cannot ship without a human deciding its category - and (2) for every route
// classified as needing a capability (library-write / manage-subs / admin),
// asserts a member holding NONE of those capabilities is refused with 403.
//
// This is the "derive the sweep from the route table, not a maintained literal"
// fix the gate asked for. Enables ytdlp + podcasts so the full set registers.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-route-class-'));
process.env.FILETUBE_YTDLP_ENABLED = 'true';
process.env.FILETUBE_YTDLP_POLL_MINUTES = '0';
process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-route-class-dl-'));
const DATA_DIR = process.env.DATA_DIR;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, userStore, __mintTestSession } = require('../../server');

// Every mutating route -> its category. Categories that require a capability
// (library-write | manage-subs | admin) are behaviourally probed below; a
// route classified `personal` (the member's own state) or `public` (pre-auth /
// session) is deliberately NOT capability-gated. To ADD a route: classify it
// here. To CHANGE a gate: move it between categories AND update its handler.
const CLASSIFICATION = {
  // --- public: pre-auth / session ---
  'POST /api/auth/login': 'public',
  'POST /api/auth/setup': 'public',
  'POST /api/auth/logout': 'personal',

  // --- personal: the member's OWN state (never capability-gated, AC2) ---
  'POST /api/progress': 'personal',
  'POST /api/videos/:id/view': 'personal',
  'POST /api/videos/:id/dimensions': 'personal',
  'POST /api/videos/:id/prepare-audio': 'personal',
  'POST /api/liked/:id': 'personal',
  'DELETE /api/liked/:id': 'personal',
  // v1.97 "Hide from feed" - the member's OWN modern-feed prune (never gated).
  'POST /api/feed-hidden/:id': 'personal',
  'DELETE /api/feed-hidden/:id': 'personal',
  'DELETE /api/history': 'personal',
  'DELETE /api/history/:id': 'personal',
  // v1.85 #1: per-user search history - the member's OWN state, never gated.
  'POST /api/search-history': 'personal',
  'DELETE /api/search-history/:term': 'personal',
  'DELETE /api/search-history': 'personal',
  'POST /api/watched/:id': 'personal',
  'DELETE /api/watched/:id': 'personal',
  'POST /api/queue/items': 'personal',
  'DELETE /api/queue/items/:uid': 'personal',
  'DELETE /api/queue': 'personal',
  'POST /api/queue/pointer': 'personal',
  'POST /api/queue/reorder': 'personal',
  'POST /api/me/settings': 'personal',
  'POST /api/me/avatar': 'personal', // v1.82: self-service profile photo (own state)
  'DELETE /api/me/avatar': 'personal',
  'POST /api/notifications/clear': 'personal',
  'POST /api/notifications/dismiss': 'personal',
  'POST /api/notifications/read': 'personal',
  'POST /api/notifications/seen': 'personal',
  'POST /api/push/subscribe': 'personal',
  'POST /api/push/unsubscribe': 'personal',
  'POST /api/music/progress': 'personal',
  'POST /api/music/resume': 'personal',
  'POST /api/music/liked/:id': 'personal',
  'DELETE /api/music/liked/:id': 'personal',
  'POST /api/books/liked/:id': 'personal',
  'DELETE /api/books/liked/:id': 'personal',
  'POST /api/books/:id/finished': 'personal',
  'POST /api/books/:id/progress': 'personal',
  'POST /api/books/pins': 'personal',
  'POST /api/books/pins/reorder': 'personal',
  'DELETE /api/books/pins/:id': 'personal',
  'POST /api/books/:id/cover': 'personal',
  'POST /book/:id/tts/:spineIndex/ensure': 'personal',
  'POST /api/podcasts/progress': 'personal',
  'POST /api/podcasts/episodes/:id/liked': 'personal',
  'DELETE /api/podcasts/episodes/:id/liked': 'personal',
  'POST /api/podcasts/episodes/:id/played': 'personal',
  'POST /api/podcasts/pins': 'personal',
  'POST /api/podcasts/pins/reorder': 'personal',
  'DELETE /api/podcasts/pins/:id': 'personal',
  'POST /api/subscriptions/pins': 'personal',
  'POST /api/subscriptions/pins/reorder': 'personal',
  'DELETE /api/subscriptions/pins/:id': 'personal',

  // --- library-write: content mutation (requires canModifyLibrary) ---
  'DELETE /api/videos/:id': 'library-write',
  'POST /api/videos/:id/move': 'library-write',
  'POST /api/videos/:id/chapters': 'library-write',
  'POST /api/videos/:id/attribute-channel': 'library-write',
  'POST /api/videos/attribute-channel-bulk': 'library-write',
  'POST /api/videos/attribute-channel-bulk/cancel': 'library-write',
  'POST /api/scan': 'library-write',
  'POST /api/books/scan': 'library-write',
  'POST /api/music/scan': 'library-write',
  'POST /api/cache/clear': 'library-write',
  'POST /api/trash/:id/restore': 'library-write',
  'DELETE /api/trash/:id': 'library-write',
  'DELETE /api/podcasts/episodes/:id': 'library-write',
  'POST /api/podcasts/episodes/:id/restore': 'library-write',

  // --- manage-subs: channel/podcast registry (requires canManageSubscriptions) ---
  'POST /api/subscriptions': 'manage-subs',
  'DELETE /api/subscriptions/:id': 'manage-subs',
  'PATCH /api/subscriptions/:id': 'manage-subs',
  'POST /api/subscriptions/:id/cancel': 'manage-subs',
  'POST /api/subscriptions/:id/repull': 'manage-subs',
  'POST /api/subscriptions/:id/skip': 'manage-subs',
  'POST /api/subscriptions/downloads/cancel': 'manage-subs',
  'POST /api/subscriptions/reorder': 'manage-subs',
  'POST /api/subscriptions/repull': 'manage-subs',
  'POST /api/subscriptions/settings': 'manage-subs',
  'DELETE /api/subscriptions/failures/:id': 'manage-subs',
  'DELETE /api/subscriptions/failures/all': 'manage-subs',
  'POST /api/ytdlp/download': 'manage-subs',
  'POST /api/ytdlp/download/:jobId/cancel': 'manage-subs',
  'POST /api/ytdlp/refresh-avatars': 'manage-subs',
  'POST /api/ytdlp/refresh-avatars/cancel': 'manage-subs',
  'POST /api/ytdlp/reheat-sub-counts': 'manage-subs',
  'POST /api/ytdlp/reheat-sub-counts/cancel': 'manage-subs',
  'POST /api/ytdlp/backfill-channel-names': 'manage-subs', // v1.115 A1: writes db.metadata channel names (+ pins), RBAC-gated + readonly-media-guarded
  'POST /api/ytdlp/backfill-channel-names/cancel': 'manage-subs',
  'POST /api/ytdlp/repull-metadata': 'manage-subs',
  'POST /api/ytdlp/repull-metadata/cancel': 'manage-subs',
  'POST /api/ytdlp/repull-metadata/preview': 'manage-subs',
  'POST /api/ytdlp/repull-metadata/item/:mediaId': 'manage-subs',
  'POST /api/ytdlp/repull-metadata/item/:mediaId/relocate': 'manage-subs',
  'POST /api/podcasts/check': 'manage-subs',
  'POST /api/podcasts/subscriptions': 'manage-subs',
  'DELETE /api/podcasts/subscriptions/:id': 'manage-subs',
  'PATCH /api/podcasts/subscriptions/:id': 'manage-subs',
  'POST /api/podcasts/subscriptions/:id/check': 'manage-subs',
  'POST /api/podcasts/subscriptions/:id/feed-url': 'manage-subs',
  'POST /api/podcasts/settings': 'manage-subs',

  // --- admin: instance config + user management (requires requireAdmin) ---
  'POST /api/config': 'admin',
  'POST /api/books/config': 'admin',
  'POST /api/music/config': 'admin',
  'POST /api/settings': 'admin',
  'POST /api/settings/logo': 'admin',
  'DELETE /api/settings/logo': 'admin',
  'POST /api/admin/restore': 'admin',
  'POST /api/users': 'admin',
  'DELETE /api/users/:id': 'admin',
  'POST /api/users/:id/disabled': 'admin',
  'POST /api/users/:id/password': 'admin',
  'POST /api/users/:id/role': 'admin',
  'POST /api/users/:id/subscriptions-flag': 'admin',
  'POST /api/users/:id/modify-library-flag': 'admin',
  'PUT /api/users/:id/restrictions': 'admin',
};

// Categories whose routes MUST refuse a member holding none of the capabilities.
const CAPABILITY_CATEGORIES = new Set(['library-write', 'manage-subs', 'admin']);

// v1.123 T3: the VISIBILITY axis. The classification above binds "a flag-less
// member gets 403". This binds the ORTHOGONAL question the podcast delete/restore
// bypass exposed (and, in the same audit, trash restore/purge, book covers and
// the two ytdlp per-item routes): a member WITH the capability but RESTRICTED
// from the resource must not mutate it.
//
// GATE FIX (both seats, round 1): the first cut used an ALLOWLIST predicate
// (`isContentAddressed` matched today's `/api/videos/` etc. prefixes) so a NEW
// media namespace - e.g. a future `DELETE /api/music/tracks/:id` - escaped the
// net silently, re-shipping the exact class this wave closes. The adversarial
// seat proved it end-to-end. This is now a DENYLIST exactly like CLASSIFICATION:
// EVERY live mutating route must be explicitly bucketed here, there is NO
// default, and the completeness test below fails until a new route is classified.
//
//   enforced - content-addressed AND the handler checks visibility
//              (mediaVisibleTo / episodeVisibleTo / bookVisibleTo /
//              trashRecordVisibleTo) and 404s a restricted member. Behavioral
//              proof lives in the rbac-{video,books,podcast}-enforcement +
//              ytdlp-repull-item-endpoint suites.
//   personal - writes ONLY the caller's own per-user state (liked / watched /
//              progress / finished / played / queue / prefs). A restricted
//              member can at worst write or clear a useless row for an item they
//              cannot see - an existence oracle at worst, non-blocking. Note the
//              POST video routes (view/liked/watched/feed-hidden) ADDITIONALLY
//              enforce (they run restrictedVideoMutation) so they are `enforced`;
//              their DELETE siblings do NOT (un-liking a since-restricted item is
//              legitimate cleanup) so they are `personal` - the asymmetry is
//              deliberate, not an oversight (gate round 1, QA W2).
//   n/a      - not per-content: session/auth, instance config, the channel/
//              podcast REGISTRY (subscriptions/shows/pins/users), and
//              LIBRARY-WIDE operations (scan/cache/bulk/reheat/backfill/
//              repull-library/check/downloads). Capability-gated, not
//              visibility-gated.
const VISIBILITY = {
  // --- session / auth ---
  'POST /api/auth/login': 'n/a',
  'POST /api/auth/setup': 'n/a',
  'POST /api/auth/logout': 'n/a',

  // --- content-addressed, visibility ENFORCED ---
  'POST /api/videos/:id/view': 'enforced',
  'POST /api/videos/:id/dimensions': 'enforced',
  'POST /api/videos/:id/prepare-audio': 'enforced',
  'POST /api/liked/:id': 'enforced',
  'POST /api/watched/:id': 'enforced',
  'POST /api/feed-hidden/:id': 'enforced',
  'DELETE /api/videos/:id': 'enforced',
  'POST /api/videos/:id/move': 'enforced',
  'POST /api/videos/:id/chapters': 'enforced',
  'POST /api/videos/:id/attribute-channel': 'enforced',
  'POST /api/trash/:id/restore': 'enforced',
  'DELETE /api/trash/:id': 'enforced',
  'DELETE /api/podcasts/episodes/:id': 'enforced',
  'POST /api/podcasts/episodes/:id/restore': 'enforced',
  'POST /api/books/:id/cover': 'enforced',
  'POST /book/:id/tts/:spineIndex/ensure': 'enforced',
  'POST /api/ytdlp/repull-metadata/item/:mediaId': 'enforced',
  'POST /api/ytdlp/repull-metadata/item/:mediaId/relocate': 'enforced',

  // --- the caller's OWN per-user state (oracle at worst, non-blocking) ---
  'POST /api/progress': 'personal',
  'DELETE /api/liked/:id': 'personal',
  'DELETE /api/watched/:id': 'personal',
  'DELETE /api/feed-hidden/:id': 'personal',
  'DELETE /api/history': 'personal',
  'DELETE /api/history/:id': 'personal',
  'POST /api/search-history': 'personal',
  'DELETE /api/search-history/:term': 'personal',
  'DELETE /api/search-history': 'personal',
  'POST /api/queue/items': 'personal',
  'DELETE /api/queue/items/:uid': 'personal',
  'DELETE /api/queue': 'personal',
  'POST /api/queue/pointer': 'personal',
  'POST /api/queue/reorder': 'personal',
  'POST /api/me/settings': 'personal',
  'POST /api/me/avatar': 'personal',
  'DELETE /api/me/avatar': 'personal',
  'POST /api/notifications/clear': 'personal',
  'POST /api/notifications/dismiss': 'personal',
  'POST /api/notifications/read': 'personal',
  'POST /api/notifications/seen': 'personal',
  'POST /api/push/subscribe': 'personal',
  'POST /api/push/unsubscribe': 'personal',
  'POST /api/music/progress': 'personal',
  'POST /api/music/resume': 'personal',
  'POST /api/music/liked/:id': 'personal',
  'DELETE /api/music/liked/:id': 'personal',
  'POST /api/books/liked/:id': 'personal',
  'DELETE /api/books/liked/:id': 'personal',
  'POST /api/books/:id/finished': 'personal',
  'POST /api/books/:id/progress': 'personal',
  'POST /api/books/pins': 'personal',
  'POST /api/books/pins/reorder': 'personal',
  'DELETE /api/books/pins/:id': 'personal',
  'POST /api/podcasts/progress': 'personal',
  'POST /api/podcasts/episodes/:id/liked': 'personal',
  'DELETE /api/podcasts/episodes/:id/liked': 'personal',
  'POST /api/podcasts/episodes/:id/played': 'personal',
  'POST /api/podcasts/pins': 'personal',
  'POST /api/podcasts/pins/reorder': 'personal',
  'DELETE /api/podcasts/pins/:id': 'personal',
  'POST /api/subscriptions/pins': 'personal',
  'POST /api/subscriptions/pins/reorder': 'personal',
  'DELETE /api/subscriptions/pins/:id': 'personal',

  // --- not per-content: registry / config / library-wide (n/a) ---
  'POST /api/videos/attribute-channel-bulk': 'n/a',
  'POST /api/videos/attribute-channel-bulk/cancel': 'n/a',
  'POST /api/scan': 'n/a',
  'POST /api/books/scan': 'n/a',
  'POST /api/music/scan': 'n/a',
  'POST /api/cache/clear': 'n/a',
  'POST /api/subscriptions': 'n/a',
  'DELETE /api/subscriptions/:id': 'n/a',
  'PATCH /api/subscriptions/:id': 'n/a',
  'POST /api/subscriptions/:id/cancel': 'n/a',
  'POST /api/subscriptions/:id/repull': 'n/a',
  'POST /api/subscriptions/:id/skip': 'n/a',
  'POST /api/subscriptions/downloads/cancel': 'n/a',
  'POST /api/subscriptions/reorder': 'n/a',
  'POST /api/subscriptions/repull': 'n/a',
  'POST /api/subscriptions/settings': 'n/a',
  'DELETE /api/subscriptions/failures/:id': 'n/a',
  'DELETE /api/subscriptions/failures/all': 'n/a',
  'POST /api/ytdlp/download': 'n/a',
  'POST /api/ytdlp/download/:jobId/cancel': 'n/a',
  'POST /api/ytdlp/refresh-avatars': 'n/a',
  'POST /api/ytdlp/refresh-avatars/cancel': 'n/a',
  'POST /api/ytdlp/reheat-sub-counts': 'n/a',
  'POST /api/ytdlp/reheat-sub-counts/cancel': 'n/a',
  'POST /api/ytdlp/backfill-channel-names': 'n/a',
  'POST /api/ytdlp/backfill-channel-names/cancel': 'n/a',
  'POST /api/ytdlp/repull-metadata': 'n/a',
  'POST /api/ytdlp/repull-metadata/cancel': 'n/a',
  'POST /api/ytdlp/repull-metadata/preview': 'n/a',
  'POST /api/podcasts/check': 'n/a',
  'POST /api/podcasts/subscriptions': 'n/a',
  'DELETE /api/podcasts/subscriptions/:id': 'n/a',
  'PATCH /api/podcasts/subscriptions/:id': 'n/a',
  'POST /api/podcasts/subscriptions/:id/check': 'n/a',
  'POST /api/podcasts/subscriptions/:id/feed-url': 'n/a',
  'POST /api/podcasts/settings': 'n/a',
  'POST /api/config': 'n/a',
  'POST /api/books/config': 'n/a',
  'POST /api/music/config': 'n/a',
  'POST /api/settings': 'n/a',
  'POST /api/settings/logo': 'n/a',
  'DELETE /api/settings/logo': 'n/a',
  'POST /api/admin/restore': 'n/a',
  'POST /api/users': 'n/a',
  'DELETE /api/users/:id': 'n/a',
  'POST /api/users/:id/disabled': 'n/a',
  'POST /api/users/:id/password': 'n/a',
  'POST /api/users/:id/role': 'n/a',
  'POST /api/users/:id/subscriptions-flag': 'n/a',
  'POST /api/users/:id/modify-library-flag': 'n/a',
  'PUT /api/users/:id/restrictions': 'n/a',
};

function liveMutatingRoutes() {
  const out = [];
  for (const layer of (app._router && app._router.stack) || []) {
    if (!layer.route) continue;
    for (const m of Object.keys(layer.route.methods)) {
      if (['post', 'put', 'patch', 'delete'].includes(m)) out.push(`${m.toUpperCase()} ${layer.route.path}`);
    }
  }
  return out.sort();
}

let server, base, flagless;

before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  __mintTestSession(); // seed an admin so the gate is in normal mode
  // A member holding NEITHER capability: canModifyLibrary defaults false; clear
  // the mint's canManageSubscriptions so this one member probes all three
  // capability categories at once.
  flagless = __mintTestSession({ username: 'nocaps', role: 'member' });
  userStore.setCanManageSubscriptions(flagless.user.id, false);
  assert.strictEqual(userStore.getById(flagless.user.id).canModifyLibrary, false);
  assert.strictEqual(userStore.getById(flagless.user.id).canManageSubscriptions, false);
});
after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

const fillParams = (p) => p
  .replace(/:jobId/g, 'job1').replace(/:mediaId/g, 'm1').replace(/:spineIndex/g, '0')
  .replace(/:uid/g, 'u1').replace(/:id/g, 'x');

test('COMPLETENESS: every live mutating route is classified (a new one fails here until categorized)', () => {
  const live = liveMutatingRoutes();
  const unclassified = live.filter((r) => !(r in CLASSIFICATION));
  assert.deepStrictEqual(unclassified, [],
    `unclassified mutating route(s) - add each to CLASSIFICATION in this file and gate it:\n  ${unclassified.join('\n  ')}`);
  // And the reverse: no stale entries for routes that no longer exist.
  const liveSet = new Set(live);
  const stale = Object.keys(CLASSIFICATION).filter((r) => !liveSet.has(r));
  assert.deepStrictEqual(stale, [], `stale CLASSIFICATION entrie(s) - route no longer exists:\n  ${stale.join('\n  ')}`);
});

test('ENFORCEMENT: every capability-gated route 403s a member holding NO capabilities', async () => {
  const live = liveMutatingRoutes();
  const failures = [];
  for (const route of live) {
    const cat = CLASSIFICATION[route];
    if (!CAPABILITY_CATEGORIES.has(cat)) continue;
    const [method, rawPath] = route.split(' ');
    const url = `${base}${fillParams(rawPath)}`;
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', Cookie: flagless.cookie },
      body: method === 'GET' ? undefined : JSON.stringify({}),
    });
    // The capability guard is the FIRST line of each such handler, so it wins
    // before any 400/404/existence branch: a flag-less member must see 403.
    if (res.status !== 403) failures.push(`${route} [${cat}] -> ${res.status} (expected 403)`);
  }
  assert.deepStrictEqual(failures, [], `capability-gated routes NOT refusing a flag-less member:\n  ${failures.join('\n  ')}`);
});

test('VISIBILITY COMPLETENESS (denylist): EVERY live mutating route has a visibility bucket - a new one fails here', () => {
  const live = liveMutatingRoutes();
  const VALID = new Set(['enforced', 'personal', 'n/a']);
  // (1) every live mutating route must be explicitly bucketed - NO default. This
  // is what makes a brand-new media namespace (e.g. DELETE /api/music/tracks/:id)
  // FAIL until someone decides its visibility, instead of escaping silently.
  const unclassified = live.filter((r) => !(r in VISIBILITY));
  assert.deepStrictEqual(unclassified, [],
    `mutating route(s) with NO visibility bucket - add each to VISIBILITY as\n`
    + `'enforced' (handler must 404 a restricted member) | 'personal' (own-state only)\n`
    + `| 'n/a' (registry/config/library-wide, not per-content):\n  ${unclassified.join('\n  ')}`);
  // (2) no stale entries, and every value is a legal bucket.
  const liveSet = new Set(live);
  const stale = Object.keys(VISIBILITY).filter((r) => !liveSet.has(r));
  assert.deepStrictEqual(stale, [], `stale VISIBILITY entrie(s) - route no longer exists:\n  ${stale.join('\n  ')}`);
  const badValue = Object.entries(VISIBILITY).filter(([, v]) => !VALID.has(v)).map(([r, v]) => `${r} -> ${v}`);
  assert.deepStrictEqual(badValue, [], `VISIBILITY value must be enforced|personal|n/a:\n  ${badValue.join('\n  ')}`);
  // (3) the two axes cover the SAME routes (both are denylists over the live
  // table), so neither can drift out from under the other.
  const capOnly = Object.keys(CLASSIFICATION).filter((r) => !(r in VISIBILITY));
  const visOnly = Object.keys(VISIBILITY).filter((r) => !(r in CLASSIFICATION));
  assert.deepStrictEqual([capOnly, visOnly], [[], []],
    `CLASSIFICATION and VISIBILITY must classify the same route set;\n  cap-only: ${capOnly.join(', ')}\n  vis-only: ${visOnly.join(', ')}`);
});

test('VISIBILITY REGRESSION GUARD: the routes this wave fixed stay pinned `enforced`', () => {
  for (const r of [
    'DELETE /api/podcasts/episodes/:id',
    'POST /api/podcasts/episodes/:id/restore',
    'POST /api/trash/:id/restore',
    'DELETE /api/trash/:id',
    'POST /api/books/:id/cover',
    'POST /api/ytdlp/repull-metadata/item/:mediaId',
    'POST /api/ytdlp/repull-metadata/item/:mediaId/relocate',
  ]) {
    assert.strictEqual(VISIBILITY[r], 'enforced', `${r} must stay visibility-enforced (v1.123 T3)`);
  }
});
