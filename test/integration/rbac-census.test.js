'use strict';

// [INTEGRATION] v1.80 RBAC T3 - the COMPLETENESS net. Three checks that a
// restricted account cannot reach content THROUGH THE SURFACES EXERCISED HERE,
// plus a tripwire that forces a human to review any NEW route:
//   1. Serve-route SWEEP: a member blocked from ALL FOUR libraries gets 404 on
//      every content-serving route (each consults the gate); admin gets non-404.
//   2. LIST SWEEP: the same member sees NO seeded content in any browse /
//      aggregation surface (videos/music/books/channels/podcast lists + shows,
//      stats counts+mostWatched, the feed, notifications) - the security-gate
//      round added this after finding stats/trash/notifications leaked titles.
//   3. Route-count LOCK: the live count is pinned. A new route changes it and
//      fails here, forcing the author to confirm a new content route enforces
//      visibility. NOTE: this is a TRIPWIRE (forces a human to look), NOT a
//      classification proof - a new LIST route not added to the sweep above
//      could still leak until someone extends this file. (Spec AC4's full
//      classification map is the stronger form; tracked as follow-up.)
// Enables ytdlp + podcasts so the full route set (and their serve routes)
// register. Isolated DATA_DIR.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-rbac-census-'));
process.env.FILETUBE_YTDLP_ENABLED = 'true';
process.env.FILETUBE_YTDLP_POLL_MINUTES = '0';
process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-census-dl-'));
const DATA_DIR = process.env.DATA_DIR;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, saveDatabase, updateDatabase, userStore, __mintTestSession } = require('../../server');
const musicStore = require('../../lib/music/store');
const podcastStore = require('../../lib/podcasts/store');
const booksStore = require('../../lib/books/store');
const { authenticateFetch } = require('../helpers/auth');

// The EXPECTED live route count (ytdlp + podcasts enabled). Bump ONLY together
// with confirming any new content-serving route enforces per-user visibility
// (rbac-*-enforcement.test.js) - that confirmation is the whole point of this
// lock. See docs/exec-plans/completed/2026-08-05-v1.80-rbac.md.
// v1.81: 184 -> 185 for POST /api/users/:id/modify-library-flag - an ADMIN
// management route (requireAdmin), not content-serving, so no visibility check;
// the write-capability enforcement it controls is bound by
// rbac-write-enforcement.test.js.
// v1.82: 185 -> 188 for the per-user avatar routes (POST + DELETE /api/me/avatar,
// GET /api/users/:id/avatar) - self-service profile photo, not content-serving;
// bound by avatar-upload.test.js + route-write-classification.test.js.
// v1.85: 188 -> 192 for the per-user search-history routes (GET + POST +
// DELETE/:term + DELETE /api/search-history) - the member's OWN state, never
// capability-gated (classified 'personal' in route-write-classification.test.js)
// and not content-serving (no per-user visibility check needed); bound by
// search-history-api.test.js.
// v1.92: 192 -> 193 for GET /storyboard/:id (the scrub/card storyboard sprite).
// It is CONTENT-SERVING (reveals frames of the media) so it carries the same
// mediaVisibleTo RBAC guard as /thumbnail and /video - a restricted member 404s
// like a missing item; bound by storyboard-serve.test.js's RBAC assertion.
// v1.94: 193 -> 194 for GET /preview/:id (the hover PREVIEW CLIP, a muted MP4).
// Also CONTENT-SERVING (reveals moments of the media) -> same mediaVisibleTo
// guard; a restricted member 404s like a missing item; bound by
// preview-clip.test.js's RBAC assertion.
// v1.97: 194 -> 197 for the "Hide from feed" routes (POST + DELETE + GET
// /api/feed-hidden) - the member's OWN modern-feed prune, never capability-gated
// (POST/DELETE classified 'personal' in route-write-classification.test.js). The
// mutating pair carries the restricted-id guard (no oracle/persist); GET is
// RBAC-filtered (mediaVisibleTo) so a since-restricted item never leaks. Bound by
// feed-hidden-api.test.js.
const EXPECTED_ROUTE_COUNT = 229; // transcript export: + GET /api/transcript/:id (GATED, mirrors /api/subtitles/:id) // v1.198.1: +1 GET /tvthumb/:id (per-episode art for the Up-next rail; GATED, 404-on-restricted proven in rbac-tv-enforcement.test.js). v1.198: -2 (the v1.196 admin set-poster POST/DELETE routes REMOVED per Dean - posters are folder-image/generated only). v1.197 TV wrap wave: +2 = POST /api/tv/episode/:id/prepare-audio (the bg-audio sidecar pre-warm; personal write + enforced visibility) + GET /tvaudio/:id (GATED; both 404-on-restricted proven in rbac-tv-enforcement.test.js). v1.196 TV player integration: +7 = GET /api/tv/episode/:id (detail/status, GATED) + POST /api/tv/progress + POST /api/tv/played + DELETE /api/tv/played (personal writes) + GET /api/tv/continue (GATED, visibility-filtered) + (the poster POST/DELETE pair, since REMOVED in v1.198). All proven in rbac-tv-enforcement.test.js. v1.195 TV Shows: +9 total = +4 config/scan (Phase 3a) + 4 browse/serve (Phase 3c: GET /api/tv, GET /api/tv/:showId, GET /tvposter/:showId, GET /tvepisode/:id - all GATED, visibility-filtered, proven in rbac-tv-enforcement.test.js) + 1 GET /tv shell (Phase 4, classified NO_CONTENT in route-read-classification.test.js - a static HTML shell, no library/user content). The progress/played/liked routes land in a later wave. v1.171: +4 critter pool management (POST /api/critters/upload + DELETE /api/critters/item + DELETE /api/critters/all - all admin on BOTH axes in route-write-classification.test.js; GET /api/critters/archive - NO_CONTENT in route-read-classification.test.js + requireAdmin in-route; decorative assets under public/critters/ only, no library/user content). v1.166: +1 (GET /api/critters - decorative critter-folder asset listing, NO library/user content; behind the session gate like every /api route, classified NO_CONTENT in route-read-classification.test.js; serves filenames from public/critters/ only). v1.159: +1 (GET /api/library-items - visibility-scoped A/V list for the Stats table, GATED in route-read-classification.test.js + proven in library-items.test.js). v1.158: +2 (POST /api/trash/purge-all - library-write + enforced/visibility-filtered in route-write-classification.test.js + proven in trash-purge-all.test.js; GET /api/storage-summary - GATED in route-read-classification.test.js + proven visibility-scoped in storage-summary.test.js). v1.146: +3 downloader-engine (GET /api/ytdlp/engine + POST /api/ytdlp/engine + POST /api/ytdlp/engine/update; the POSTs classified admin on BOTH axes in route-write-classification.test.js). v1.126 history: +1 folders/display-name.

let server, base, auth, member;
const vidFile = path.join(DATA_DIR, 'v.mp4');
const trkFile = path.join(DATA_DIR, 't.mp3');
const bookFile = path.join(DATA_DIR, 'b.epub');
const subId = 'c'.repeat(32);
let epId;

before(async () => {
  fs.writeFileSync(vidFile, 'V'); fs.writeFileSync(trkFile, 'T'); fs.writeFileSync(bookFile, 'B');
  const showDir = path.join(DATA_DIR, 'podcasts', 'Show'); fs.mkdirSync(showDir, { recursive: true });
  const epFile = path.join(showDir, 'ep.mp3'); fs.writeFileSync(epFile, 'E');
  epId = podcastStore.episodeIdFor(subId, 'g1');

  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  auth = authenticateFetch(server, base);
  saveDatabase({
    // v1.81 (#127a): seed GLOBAL watch + inventory namespaces so the stats
    // scoping is provable - without scoping a blocked member's inventory would
    // count these (viewCounts/scanFolders/tombstones/users all > 0).
    folders: [DATA_DIR], folderSettings: {}, progress: {},
    metadata: { vid: { id: 'vid', title: 'V', filePath: vidFile, folderName: 'F', rootFolder: DATA_DIR, type: 'video', ext: '.mp4', duration: 1, size: 1, addedAt: 1 } },
    viewCounts: { vid: 42 },
    deleteTombstones: { gone: { originalId: 'gone', item: { id: 'gone', title: 'Gone', filePath: path.join(DATA_DIR, 'gone.mp4'), folderName: 'F', rootFolder: DATA_DIR, type: 'video', ext: '.mp4' } } },
    liked: [], settings: { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30 },
  });
  await updateDatabase((db) => {
    musicStore.ensureMusic(db).tracks = { trk: { id: 'trk', title: 'T', artist: 'A', album: 'Al', filePath: trkFile, rootFolder: DATA_DIR, folderName: 'F', ext: '.mp3', codec: 'mp3', durationSec: 1, albumArtKey: null, addedAt: '2026-01-01T00:00:00Z' } };
    const p = podcastStore.ensurePodcasts(db); p.subscriptions = []; p.episodes = {};
    podcastStore.reduceAddSubscription(p, { id: subId, name: 'Show', feedUrl: 'https://e.com/f.xml' });
    podcastStore.reduceUpsertEpisodes(p, subId, [{ guid: 'g1', title: 'Ep', pubDateMs: 1, durationSec: 1 }], 'pending', 5000);
    podcastStore.reduceEpisodeDownloaded(p, epId, { fileName: 'ep.mp3', filePath: path.join(DATA_DIR, 'podcasts', 'Show', 'ep.mp3'), bytes: 1, nowMs: 6000 });
    booksStore.ensureBooks(db).items = { bk: { id: 'bk', title: 'B', author: 'A', filePath: bookFile, folderName: 'F', format: 'epub', addedAt: 1 } };
    // A ytdlp subscription enables the notifications feature (subs>=1).
    if (!db.ytdlp || typeof db.ytdlp !== 'object') db.ytdlp = { allowMembersOnly: false, subscriptions: [] };
    db.ytdlp.subscriptions = [{ name: 'Chan', order: 0 }];
    return true;
  });
  // Seed a notification for the restricted media item (the bell CRITICAL).
  userStore.seedNotifications([{ mediaId: 'vid', createdAt: 1000 }], 2000);
  member = __mintTestSession({ username: 'lockeddown', role: 'member' });
  // Block ALL FOUR libraries - this member may reach NO content anywhere.
  userStore.setRestrictions(member.user.id, [
    { kind: 'library', value: 'video' }, { kind: 'library', value: 'music' },
    { kind: 'library', value: 'podcasts' }, { kind: 'library', value: 'books' },
  ]);
  // v1.81 (#127a): even the member's OWN watch data on a now-restricted item
  // must drop out of their inventory counts (visible-scoped).
  userStore.addLiked(member.user.id, 'vid', '2026-08-05T00:00:00Z');
  userStore.setProgress(member.user.id, 'vid', { timestamp: 1, duration: 2, updatedAt: '2026-08-05T00:00:00Z' });
});
after(async () => {
  auth.restore();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

const asMember = (p) => fetch(`${base}${p}`, { headers: { Cookie: member.cookie } });
const asAdmin = (p) => fetch(`${base}${p}`);

test('SWEEP: a member blocked from all libraries gets 404 on EVERY serve route; admin does not', async () => {
  const routes = [
    '/video/vid', '/video/vid?download=1', '/audio/vid', '/thumbnail/vid', '/api/subtitles/vid', '/api/transcript/vid', '/api/videos/vid',
    '/track/trk', '/track/trk?download=1', '/albumart/trk', '/api/music/trk',
    `/episode/${epId}`, `/podcastart/${subId}`, `/api/podcasts/episodes/${epId}`, `/api/podcasts/shows/${subId}/episodes`,
    '/book/bk/file', '/book/bk/file?download=1', '/bookcover/bk', '/api/books/bk', '/book/bk/tts/0', '/book/bk/tts/0/blocks',
  ];
  for (const r of routes) {
    assert.strictEqual((await asMember(r)).status, 404, `member blocked from all libraries must 404 on ${r}`);
  }
  // admin reaches them (non-404 proves the gate discriminates, not blanket-denies)
  for (const r of ['/video/vid', '/track/trk', `/episode/${epId}`, '/book/bk/file', '/api/videos/vid', '/api/books/bk']) {
    assert.notStrictEqual((await asAdmin(r)).status, 404, `admin must reach ${r}`);
  }
});

test('LIST SWEEP: a member blocked from all libraries sees NO seeded content in any list', async () => {
  // The gap the security gate found: serve routes 404'd but LIST routes leaked
  // titles/counts. This asserts every browse/aggregation surface omits the
  // blocked content (the member is restricted from all four libraries).
  const json = (p) => asMember(p).then((r) => r.json());
  const ids = (arr) => (arr || []).map((x) => x.id);

  assert.ok(!ids((await json('/api/videos?limit=50')).items).includes('vid'), '/api/videos');
  assert.ok(!ids((await json('/api/music?limit=50')).items).includes('trk'), '/api/music');
  assert.ok(!ids((await json('/api/books?limit=50')).items).includes('bk'), '/api/books');
  assert.ok(!((await json('/api/channels')).channels || []).some((c) => c.folder === 'F'), '/api/channels');
  assert.ok(!((await json('/api/podcasts/subscriptions')).subscriptions || []).some((s) => s.id === subId), '/api/podcasts/subscriptions');
  assert.ok(!((await json('/api/podcasts/shows')).shows || []).some((s) => s.id === subId), '/api/podcasts/shows');

  // /api/stats: the content counts + mostWatched reflect only what the member sees (nothing).
  const stats = await json('/api/stats');
  assert.strictEqual(stats.inventory.videos, 0, '/api/stats inventory.videos');
  assert.ok(!(stats.mostWatched || []).some((m) => m.id === 'vid'), '/api/stats mostWatched');

  // v1.81 (#127a): the inventory watch-aggregate + folder sub-counts are ALSO
  // scoped - a blocked member sees zero of everything and NO account roster,
  // even though the global namespaces are non-empty (proven against admin below).
  assert.strictEqual(stats.inventory.viewCounts, 0, 'inventory.viewCounts scoped');
  assert.strictEqual(stats.inventory.scanFolders, 0, 'inventory.scanFolders scoped (raw list had 1 root)');
  assert.strictEqual(stats.inventory.deleteTombstones, 0, 'inventory.deleteTombstones scoped (raw had 1)');
  assert.strictEqual(stats.inventory.watchProgress, 0, 'inventory.watchProgress scoped (own progress on a restricted item excluded)');
  assert.strictEqual(stats.inventory.liked, 0, 'inventory.liked scoped (own like on a restricted item excluded)');
  assert.strictEqual(stats.inventory.music.folders, 0, 'inventory.music.folders scoped');
  assert.strictEqual(stats.inventory.users, null, 'inventory.users omitted for a non-admin (system-only)');

  // The ADMIN still sees the real global numbers - proving the scoping
  // DISCRIMINATES, not blanket-zeros.
  const astats = await (await asAdmin('/api/stats')).json();
  assert.strictEqual(astats.inventory.videos, 1, 'admin inventory.videos');
  assert.strictEqual(astats.inventory.viewCounts, 1, 'admin sees the global view counter');
  assert.strictEqual(astats.inventory.scanFolders, 1, 'admin sees the configured root');
  assert.strictEqual(astats.inventory.deleteTombstones, 1, 'admin sees the tombstone');
  assert.ok(astats.inventory.users >= 2, 'admin sees the account roster');

  // /api/home: no feed row surfaces any blocked item.
  const rows = (await json('/api/home')).rows || [];
  for (const row of rows) {
    assert.ok(!row.items.some((i) => ['vid', 'trk', epId].includes(i.id)), `/api/home row ${row.id}`);
  }

  // /api/notifications: the bell must not carry a restricted item's title.
  const notifs = (await json('/api/notifications')).items || [];
  assert.ok(!notifs.some((n) => n.mediaId === 'vid'), '/api/notifications omits the restricted item');
  const adminNotifs = ((await (await asAdmin('/api/notifications')).json()).items) || [];
  assert.ok(adminNotifs.some((n) => n.mediaId === 'vid'), 'admin bell shows the item');

  // admin still sees the content in lists (proves it discriminates).
  const adminVids = ((await (await asAdmin('/api/videos?limit=50')).json()).items || []).map((x) => x.id);
  assert.ok(adminVids.includes('vid'), 'admin /api/videos includes the item');
});

test('LOCK: the live route count is pinned (a new route forces an RBAC review)', () => {
  const stack = (app._router && app._router.stack) || [];
  let count = 0;
  for (const layer of stack) {
    if (!layer.route || typeof layer.route.path !== 'string') continue;
    if (layer.route.path === '*' || layer.route.path === '/*') continue;
    for (const m of Object.keys(layer.route.methods)) { if (m !== '_all') count++; }
  }
  assert.strictEqual(count, EXPECTED_ROUTE_COUNT,
    `route count changed (${count} vs ${EXPECTED_ROUTE_COUNT}). If you ADDED a content-serving route, add a `
    + `visibility check + an rbac-*-enforcement assertion, THEN bump EXPECTED_ROUTE_COUNT.`);
});
