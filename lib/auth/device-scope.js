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
// Nothing here writes anything except the offline progress sync (plan D4, W3).
// Pairing itself (POST /api/devices) is deliberately ABSENT: a token never
// mints a token (gate r1 W7).

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
]);

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

// Does the allowlist admit this method + path (req.path, no query)?
function deviceScopeAllows(method, pathname) {
  if (typeof method !== 'string' || typeof pathname !== 'string') return false;
  const m = method.toUpperCase() === 'HEAD' ? 'GET' : method.toUpperCase();
  for (const c of COMPILED) {
    if (c.method === m && c.re.test(pathname)) return true;
  }
  return false;
}

module.exports = { DEVICE_SCOPE, deviceScopeAllows, compile };
