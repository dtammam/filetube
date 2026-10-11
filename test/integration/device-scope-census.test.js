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
const { DEVICE_SCOPE, deviceScopeAllows } = require('../../lib/auth/device-scope');

// The routes a paired phone is MEANT to reach (plan D1 + D2 + D3 + D4). A change
// here is a product decision, reviewed with the security brief.
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

test('NOTHING THAT WRITES: the only non-GET routes in scope are the offline status check (a read by POST) and, from W3, the offline progress sync (plan D4)', () => {
  const writes = DEVICE_SCOPE.filter((e) => !e.startsWith('GET '));
  assert.deepStrictEqual(writes, ['POST /api/offline/status']);
});
