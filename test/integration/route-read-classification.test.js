'use strict';

// [INTEGRATION] v1.128 Wave B (S5) - the READ-surface completeness net, the
// sibling of route-write-classification. Wave B's census (S1) found 11 read
// routes leaking hidden titles/paths/counts to a restricted member. This net
// makes the census un-rottable: it enumerates EVERY live GET route from the
// Express table and fails if any is unclassified - so a NEW read surface
// cannot ship without a human deciding whether it exposes per-content data.
// It classifies (it does not, and cannot soundly, mechanically verify the
// filtering - the write net's #151 lesson); the behavioral proof that the
// GATED routes actually filter lives in the rbac-*-surfaces / rbac-queue /
// rbac-config / rbac-report suites. The 11 fixed leaks are regression-pinned
// GATED below. ytdlp + podcasts enabled so the full set registers.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-route-read-'));
process.env.FILETUBE_YTDLP_ENABLED = 'true';
process.env.FILETUBE_YTDLP_POLL_MINUTES = '0';
process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-route-read-dl-'));

const { test } = require('node:test');
const assert = require('node:assert');
const { app } = require('../../server');

// Category meaning:
//   GATED     - applies the canonical visibility decision to content output
//               (list filter, single-item 404, or byte-serve 404); a restricted
//               member cannot learn a hidden title/path/count through it. All
//               11 Wave B fixes land here.
//   OWN_STATE - returns ONLY the caller's own per-user rows (progress, liked
//               ids, pins, search history, resume, me); no library content.
//   NO_CONTENT- body carries nothing library-content-derived (config toggles,
//               scan-state booleans, aggregate disk size, static assets/pages,
//               keys, avatar/logo bytes, the shared channel-registry names).
//   ADMIN     - requireAdmin-gated.
//   TRACKED   - a KNOWN, disclosed residual (aggregate count-oracle, general
//               root path, or shared-registry job-log title) deferred with a
//               tracker row; NOT a silent leak.
const READ = {
  '*': 'NO_CONTENT',
  '/albumart/:id': 'GATED',
  '/api/admin/backup': 'ADMIN',
  '/api/attribution-targets': 'GATED',
  '/api/auth/me': 'OWN_STATE',
  '/api/books': 'GATED',
  '/api/books/:id': 'GATED',
  '/api/books/:id/tts/:spineIndex/status': 'NO_CONTENT',
  '/api/books/config': 'GATED',
  '/api/books/folders': 'GATED',
  '/api/books/pins': 'OWN_STATE',
  '/api/books/scan-status': 'NO_CONTENT',
  '/api/books/tts/config': 'NO_CONTENT',
  '/api/cache/size': 'NO_CONTENT',
  '/api/channels': 'GATED',
  '/api/config': 'GATED',
  '/api/duplicates': 'GATED',
  '/api/duplicates.csv': 'GATED',
  '/api/critters': 'NO_CONTENT', // v1.166: decorative critter-folder listing (asset filenames only, no library/user data)
  '/api/critters/archive': 'ADMIN', // v1.171 (QA S1): requireAdmin-gated zip of the decorative asset pool; behavioral member-403 probe in critter-admin-gate.test.js
  '/api/feed-hidden': 'GATED',
  '/api/handoff': 'GATED',
  '/api/history': 'GATED',
  '/api/home': 'GATED',
  '/api/liked': 'GATED',
  '/api/library-items': 'GATED', // v1.159: visibility-scoped A/V list for the Stats table (titles/sizes)
  '/api/music': 'GATED',
  '/api/tv': 'GATED',
  '/api/tv/episode/:id': 'GATED', // v1.196: per-episode detail/status for the shared player; 404 on restricted
  '/api/tv/:showId': 'GATED',
  '/tvposter/:showId': 'GATED',
  '/tvepisode/:id': 'GATED',
  '/api/music/:id': 'GATED',
  '/api/music/albums': 'GATED',
  '/api/music/artists': 'GATED',
  '/api/music/config': 'GATED',
  '/api/tv/config': 'GATED',
  '/api/music/liked': 'GATED',
  '/api/music/progress/:id': 'OWN_STATE',
  '/api/music/resume': 'OWN_STATE',
  '/api/music/scan-status': 'NO_CONTENT',
  '/api/tv/scan-status': 'NO_CONTENT',
  '/api/notifications': 'GATED',
  '/api/notifications/badge': 'OWN_STATE',
  '/api/podcasts/episodes': 'GATED',
  '/api/podcasts/episodes/:id': 'GATED',
  '/api/podcasts/health': 'TRACKED', // #152: total show+episode count-oracle
  '/api/podcasts/liked': 'OWN_STATE',
  '/api/podcasts/pins': 'OWN_STATE',
  '/api/podcasts/progress/:episodeId': 'OWN_STATE',
  '/api/podcasts/settings': 'TRACKED', // #152: the general podcasts root abs path
  '/api/podcasts/shows': 'GATED',
  '/api/podcasts/shows/:id/episodes': 'GATED',
  '/api/podcasts/status': 'TRACKED', // #152: activity map keyed by subId + "N/M" poll count = per-hidden-show count-oracle
  '/api/podcasts/subscriptions': 'GATED',
  '/api/progress/:id': 'OWN_STATE',
  '/api/push/key': 'NO_CONTENT',
  '/api/queue': 'GATED',
  '/api/scan-status': 'GATED',
  '/api/search-history': 'OWN_STATE',
  '/api/settings': 'NO_CONTENT',
  '/api/stats': 'GATED',
  '/api/storage-summary': 'GATED', // v1.158: visibility-scoped total bytes (same scoping as /api/stats)
  '/api/subscriptions': 'NO_CONTENT', // shared channel registry: names/avatars, not per-content
  '/api/subscriptions/failures': 'TRACKED', // #150: registry job-log titles
  '/api/subscriptions/health': 'NO_CONTENT',
  '/api/subscriptions/history': 'TRACKED', // #150: registry job-log titles
  '/api/subscriptions/pins': 'OWN_STATE',
  '/api/subscriptions/settings': 'NO_CONTENT',
  '/api/subscriptions/status': 'TRACKED', // #150: in-flight download title
  '/api/subtitles/:id': 'GATED',
  '/api/trash': 'GATED',
  '/api/users': 'ADMIN',
  '/api/users/:id/avatar': 'NO_CONTENT',
  '/api/users/:id/restrictions': 'ADMIN',
  '/api/videos': 'GATED',
  '/api/videos/:id': 'GATED',
  '/api/ytdlp/engine': 'ADMIN', // v1.146: downloader-engine status; requireAdmin first-line (fail-closed gate in lib/ytdlp/index.js)
  '/audio/:id': 'GATED',
  '/book/:id/file': 'GATED',
  '/book/:id/tts/:spineIndex': 'GATED',
  '/book/:id/tts/:spineIndex/blocks': 'GATED',
  '/bookcover/:id': 'GATED',
  '/books': 'NO_CONTENT',
  '/episode/:id': 'GATED',
  '/js/subscriptions.js': 'NO_CONTENT',
  '/logo': 'NO_CONTENT',
  '/music': 'NO_CONTENT',
  '/tv': 'NO_CONTENT',
  '/podcastart/:subId': 'GATED',
  '/podcasts': 'NO_CONTENT',
  '/preview/:id': 'GATED',
  '/storyboard/:id': 'GATED',
  '/subscriptions': 'NO_CONTENT',
  '/thumbnail/:id': 'GATED',
  '/track/:id': 'GATED',
  '/video/:id': 'GATED',
};

// The 11 census leaks Wave B fixed - pinned GATED so a regression that drops a
// filter (and re-classifies the route) fails loudly here as well as in the
// behavioral suite.
const WAVE_B_FIXED = [
  '/api/config', '/api/books/config', '/api/music/config', '/api/books/folders',
  '/api/scan-status', '/api/duplicates', '/api/duplicates.csv',
  '/api/attribution-targets', '/api/queue', '/api/podcasts/shows',
  '/api/podcasts/shows/:id/episodes',
];

function liveGetRoutes() {
  const out = [];
  for (const layer of (app._router && app._router.stack) || []) {
    if (!layer.route) continue;
    if (layer.route.methods && layer.route.methods.get) out.push(layer.route.path);
  }
  return out.sort();
}

test('COMPLETENESS: every live GET route is classified (a new read surface fails until categorized)', () => {
  const live = liveGetRoutes();
  const unclassified = live.filter((r) => !(r in READ));
  assert.deepStrictEqual(unclassified, [],
    `unclassified GET route(s) - classify each in READ: GATED (applies visibility) |\n`
    + `OWN_STATE (own per-user rows) | NO_CONTENT (no library content in body) | ADMIN |\n`
    + `TRACKED (a disclosed residual + a tracker row):\n  ${unclassified.join('\n  ')}`);
  const liveSet = new Set(live);
  const stale = Object.keys(READ).filter((r) => !liveSet.has(r));
  assert.deepStrictEqual(stale, [], `stale READ entrie(s) - route no longer exists:\n  ${stale.join('\n  ')}`);
  const VALID = new Set(['GATED', 'OWN_STATE', 'NO_CONTENT', 'ADMIN', 'TRACKED']);
  const bad = Object.entries(READ).filter(([, v]) => !VALID.has(v)).map(([r, v]) => `${r} -> ${v}`);
  assert.deepStrictEqual(bad, [], `READ value must be GATED|OWN_STATE|NO_CONTENT|ADMIN|TRACKED:\n  ${bad.join('\n  ')}`);
});

test('REGRESSION PIN: the 11 Wave B census leaks stay GATED', () => {
  for (const r of WAVE_B_FIXED) {
    assert.strictEqual(READ[r], 'GATED', `${r} must stay GATED (Wave B census leak fix)`);
  }
});
