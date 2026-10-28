'use strict';

// [INTEGRATION] v1.387.0 offline playback, plan D1 - the device-token SCOPE
// census. lib/auth/device-scope.js is an explicit allowlist (default deny) of
// what a per-device token may reach. This net enumerates EVERY live route from
// the Express table and fails (a) on any live route a device token reaches
// that is not in the allowlist, and (b) on any allowlisted pattern that matches
// no live route (a renamed route would silently un-scope the app). ytdlp +
// podcasts enabled so the full route set registers. The behavioural proof that
// the gate enforces the scope (403) is in device-tokens.test.js.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-device-scope-'));
process.env.FILETUBE_YTDLP_ENABLED = 'true';
process.env.FILETUBE_YTDLP_POLL_MINUTES = '0';
process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-device-scope-dl-'));

const { test } = require('node:test');
const assert = require('node:assert');
const { app } = require('../../server');
const { DEVICE_SCOPE, MEDIA_SCOPE, deviceScopeAllows, mediaScopeAllows } = require('../../lib/auth/device-scope');

// The routes a paired phone is MEANT to reach (plan D1 + D2 + D3 + D4; v1.395.0 Pages;
// v1.397.0 native audio D7 + D8; v1.398.0 native video audio V5). A change here is a product
// decision, reviewed with the security brief.
const EXPECTED_REACHABLE = [
  'GET /api/auth/me',
  'GET /api/host-info',
  'GET /track/:id',
  'GET /episode/:id',
  'GET /video/:id',
  'GET /tvepisode/:id',
  'GET /albumart/:id',
  'GET /thumbnail/:id',
  'GET /tvthumb/:id',
  'GET /tvposter/:showId',
  'GET /podcastart/:subId',
  'GET /api/subtitles/:id',
  'GET /api/offline/manifest',
  'GET /api/offline/file/:kind/:id',
  'POST /api/offline/status',
  'POST /api/offline/progress',
  'POST /api/pages', // v1.395.0 Pages: the app's "Save to Pages" share action (D-AUTH)
  // v1.397.0 native audio: the media-token mint (D7), radio for the native queue and the ONLINE progress /
  // plays routes the native engine posts to with the web's own bodies (D8)
  'POST /api/devices/media-token',
  'GET /api/music/radio',
  'POST /api/music/progress',
  'POST /api/progress',
  'POST /api/podcasts/progress',
  'POST /api/music/plays',
  // v1.398.0 native video audio (V5): a TV episode's own progress route, the body the web sends
  'POST /api/tv/progress',
].sort();

function liveRoutes() {
  const out = [];
  for (const layer of (app._router && app._router.stack) || []) {
    if (!layer.route || typeof layer.route.path !== 'string') continue;
    for (const m of Object.keys(layer.route.methods)) {
      if (m === '_all') continue;
      out.push(`${m.toUpperCase()} ${layer.route.path}`);
    }
  }
  return [...new Set(out)].sort();
}
// Fill each param with a sample id (the shape every real id has).
const sample = (p) => p.replace(/:[A-Za-z0-9_]+/g, 'abc123');

test('COMPLETENESS: the live routes a device token reaches are EXACTLY the expected set (a new route a token can reach fails here until reviewed)', () => {
  const live = liveRoutes();
  assert.ok(live.length > 250, `sanity: the route table is real (${live.length})`);
  const reachable = live.filter((r) => {
    const [m, p] = r.split(' ');
    if (p === '*' || p === '/*') return false;
    return deviceScopeAllows(m, sample(p));
  }).sort();
  assert.deepStrictEqual(reachable, EXPECTED_REACHABLE);
  // The catch-all shell route must never be reachable by a token (a request to '/' is 403).
  assert.strictEqual(deviceScopeAllows('GET', '/'), false);
  assert.strictEqual(deviceScopeAllows('GET', '/setup.html'), false);
});

test('NO DEAD PATTERN: every allowlist entry names a live route, spelled exactly as registered, with its method', () => {
  const live = new Set(liveRoutes());
  const dead = DEVICE_SCOPE.filter((e) => !live.has(e));
  assert.deepStrictEqual(dead, [], `allowlist entries that match no live route (renamed? removed?):\n  ${dead.join('\n  ')}`);
  assert.deepStrictEqual([...DEVICE_SCOPE].sort(), EXPECTED_REACHABLE, 'the allowlist and the expected set are one list');
});

test('NOTHING ELSE WRITES: the only non-GET routes in scope are the offline status check (a read by POST), the offline progress sync (plan D4), since v1.395.0 the app\'s "Save to Pages" (Pages D-AUTH), since v1.397.0 the media-token mint (writes nothing; D7) and the web\'s own progress / plays routes the native engine posts to (D8), and since v1.398.0 the TV progress route (V5)', () => {
  const writes = DEVICE_SCOPE.filter((e) => !e.startsWith('GET '));
  assert.deepStrictEqual(writes, ['POST /api/offline/status', 'POST /api/offline/progress', 'POST /api/pages', 'POST /api/devices/media-token', 'POST /api/music/progress', 'POST /api/progress', 'POST /api/podcasts/progress', 'POST /api/music/plays', 'POST /api/tv/progress']);
});

// v1.397.0 (plan D7): the MEDIA token's own allowlist - GET routes only, each live, nothing else; no method but GET / HEAD.
// v1.398.0 (plan V5): the file route's kinds gain video and tvEpisode (the iOS-playable rendition, never the web's /video or
// /tvepisode byte routes) and the art routes gain /thumbnail and /tvthumb - five routes.
test('MEDIA SCOPE: the media token reaches exactly the offline file route (track, podcastEpisode, video, tvEpisode) and the four art routes, GET / HEAD only, every entry live', () => {
  const live = new Set(liveRoutes());
  assert.deepStrictEqual([...MEDIA_SCOPE].sort(), ['GET /albumart/:id', 'GET /api/offline/file/:kind/:id', 'GET /podcastart/:subId', 'GET /thumbnail/:id', 'GET /tvthumb/:id']);
  assert.deepStrictEqual(MEDIA_SCOPE.filter((e) => !live.has(e)), [], 'every media-scope entry names a live route');
  // the file route's :kind must be a native Item kind to pass, so the sample fills it with 'track' (the census question is "which
  // live ROUTES", the kind check is bound below)
  const reachable = liveRoutes().filter((r) => { const [m, p] = r.split(' '); return p !== '*' && p !== '/*' && mediaScopeAllows(m, sample(p.replace(':kind', 'track'))); }).sort();
  assert.deepStrictEqual(reachable, ['GET /albumart/:id', 'GET /api/offline/file/:kind/:id', 'GET /podcastart/:subId', 'GET /thumbnail/:id', 'GET /tvthumb/:id']);
  assert.strictEqual(mediaScopeAllows('HEAD', '/albumart/abc'), true);
  assert.strictEqual(mediaScopeAllows('GET', '/api/offline/file/track/abc'), true);
  assert.strictEqual(mediaScopeAllows('GET', '/api/offline/file/podcastEpisode/abc'), true);
  assert.strictEqual(mediaScopeAllows('GET', '/api/offline/file/video/abc'), true, 'v1.398.0: a video as sound');
  assert.strictEqual(mediaScopeAllows('GET', '/api/offline/file/tvEpisode/abc'), true, 'v1.398.0: a TV episode as sound');
  assert.strictEqual(mediaScopeAllows('GET', '/api/offline/file/album/abc'), false, 'a container kind is never a file');
  assert.strictEqual(mediaScopeAllows('GET', '/api/offline/file/tvSeason/abc'), false);
  assert.strictEqual(mediaScopeAllows('GET', '/thumbnail/abc'), true, 'v1.398.0: a video\'s art');
  assert.strictEqual(mediaScopeAllows('GET', '/tvthumb/abc'), true, 'v1.398.0: an episode\'s art');
  assert.strictEqual(mediaScopeAllows('POST', '/albumart/abc'), false, 'GET / HEAD only');
  assert.strictEqual(mediaScopeAllows('POST', '/thumbnail/abc'), false);
  for (const p of ['/track/abc', '/episode/abc', '/video/abc', '/tvepisode/abc', '/tvposter/abc', '/api/auth/me', '/api/offline/manifest', '/api/music/radio', '/api/tv/progress', '/', '/setup.html']) assert.strictEqual(mediaScopeAllows('GET', p), false, p);
});
