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
  'DELETE /api/history': 'personal',
  'DELETE /api/history/:id': 'personal',
  'POST /api/watched/:id': 'personal',
  'DELETE /api/watched/:id': 'personal',
  'POST /api/queue/items': 'personal',
  'DELETE /api/queue/items/:uid': 'personal',
  'DELETE /api/queue': 'personal',
  'POST /api/queue/pointer': 'personal',
  'POST /api/queue/reorder': 'personal',
  'POST /api/me/settings': 'personal',
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
