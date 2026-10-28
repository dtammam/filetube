'use strict';

// lib/auth/device-scope.js - what a per-device token may reach (v1.387.0, plan
// D1). An explicit ALLOWLIST, default deny: the gate (lib/auth/gate.js) answers
// 403 {error:'not available to devices'} for a VALID token on any route that is
// not listed here. Entries are `METHOD <express route path>` spelled EXACTLY as
// the live route is registered, so test/integration/device-scope-census.test.js
// can enumerate app._router.stack and fail on (a) any live route a device token
// reaches that is not listed and (b) any listed pattern that matches no live
// route. GET entries also cover HEAD (Express answers HEAD from a GET route).
//
// The writes a device token may make: the offline progress sync (plan D4, W3), the
// app's "Save to Pages", and since v1.397.0 (native audio, D8) the SAME online
// progress / plays routes the web uses, with the same bodies (restrictions apply
// as for a browser: req.user is the account). Pairing itself (POST /api/devices)
// is deliberately ABSENT: a token never mints a DEVICE token (gate r1 W7). The
// media token (POST /api/devices/media-token) is minted only WITH a device token
// and reaches only MEDIA_SCOPE below.

const DEVICE_SCOPE = Object.freeze([
  // identity + the app's pre-load check
  'GET /api/auth/me',
  'GET /api/host-info',
  // the byte and art routes the download manifest names (plan D2)
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
  // offline playback (plan D2 + D3): the manifest, the file the rule picks, the catalogue re-check
  'GET /api/offline/manifest',
  'GET /api/offline/file/:kind/:id',
  'POST /api/offline/status',
  // offline playback (plan D4): the ONE write a device token may make - its own queued positions
  'POST /api/offline/progress',
  // v1.395.0 Pages: the app's "Save to Pages" share action saves for the phone's user
  'POST /api/pages',
  // v1.397.0 native audio (plan D7 + D8): the media token mint, radio for the native queue, and the ONLINE
  // progress / plays routes the native engine posts to with the web's own bodies
  'POST /api/devices/media-token',
  'GET /api/music/radio',
  'POST /api/music/progress',
  'POST /api/progress',
  'POST /api/podcasts/progress',
  'POST /api/music/plays',
  // v1.398.0 native video audio (plan V5): a TV episode's own progress route, the body the web
  // sends ({ id, timestamp, duration }); POST /api/progress (a video's) is already above
  'POST /api/tv/progress',
]);

// v1.397.0 native audio (plan D7): what a MEDIA token (`?mt=`, lib/auth/media-token.js)
// may reach - GET / HEAD only, the offline file route for the native Item kinds and the
// art routes native resolves Items against. Nothing else, ever: a request carrying
// `mt` to any other route or with any other method is a JSON 401 at the gate.
// v1.398.0 native video audio (plan V5): the file kinds gain `video` and `tvEpisode` (a
// video's SOUND in the app's engine: the iOS-playable rendition the downloads already use,
// never the web's /video or /tvepisode byte routes) and the art routes gain /thumbnail
// and /tvthumb. Each route applies the account's restrictions as for a browser session
// (req.user is set from the token's row): a restricted video is a neutral 404 everywhere.
const MEDIA_SCOPE = Object.freeze([
  'GET /api/offline/file/:kind/:id',
  'GET /albumart/:id',
  'GET /podcastart/:subId',
  'GET /thumbnail/:id',
  'GET /tvthumb/:id',
]);
const MEDIA_FILE_KINDS = Object.freeze(['track', 'podcastEpisode', 'video', 'tvEpisode']);

// v1.395.0 Pages (D-AUTH): a `shortcut` token reaches THIS and nothing else. The gate
// answers 401 (not 403) for any other route with one: the token is not a credential
// there at all.
const SHORTCUT_SCOPE = Object.freeze(['POST /api/pages']);

// `/track/:id` -> /^\/track\/[^/]+$/ : a param is one non-empty path segment,
// everything else is literal. The query string is never part of the match.
function compile(entry) {
  const sp = entry.indexOf(' ');
  const method = entry.slice(0, sp);
  const routePath = entry.slice(sp + 1);
  const source = routePath.split('/').map((seg) => {
    if (seg.startsWith(':')) return '[^/]+';
    return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('/');
  return { method, routePath, re: new RegExp('^' + source + '$') };
}

const COMPILED = DEVICE_SCOPE.map(compile);
const SHORTCUT_COMPILED = SHORTCUT_SCOPE.map(compile);
const MEDIA_COMPILED = MEDIA_SCOPE.map(compile);

// Does the allowlist admit this method + path (req.path, no query)?
function deviceScopeAllows(method, pathname) {
  if (typeof method !== 'string' || typeof pathname !== 'string') return false;
  const m = method.toUpperCase() === 'HEAD' ? 'GET' : method.toUpperCase();
  for (const c of COMPILED) {
    if (c.method === m && c.re.test(pathname)) return true;
  }
  return false;
}

function shortcutScopeAllows(method, pathname) {
  if (typeof method !== 'string' || typeof pathname !== 'string') return false;
  const m = method.toUpperCase();
  return SHORTCUT_COMPILED.some((c) => c.method === m && c.re.test(pathname));
}

// Does the media-token allowlist admit this method + path? GET / HEAD only; the file
// route only for a native Item kind (the web's /video and /tvepisode byte routes, /track
// and /episode are never a media-token read).
function mediaScopeAllows(method, pathname) {
  if (typeof method !== 'string' || typeof pathname !== 'string') return false;
  const m = method.toUpperCase();
  if (m !== 'GET' && m !== 'HEAD') return false;
  if (!MEDIA_COMPILED.some((c) => c.re.test(pathname))) return false;
  const file = /^\/api\/offline\/file\/([^/]+)\/[^/]+$/.exec(pathname);
  if (file && !MEDIA_FILE_KINDS.includes(file[1])) return false;
  return true;
}

module.exports = { DEVICE_SCOPE, SHORTCUT_SCOPE, MEDIA_SCOPE, MEDIA_FILE_KINDS, deviceScopeAllows, shortcutScopeAllows, mediaScopeAllows, compile };
