'use strict';

// [INTEGRATION] v1.43 acceptance criterion (exec plan §v1.43): "Every route
// 401s/redirects without a valid cookie EXCEPT the exact allowlist
// (route-census test: enumerate registered routes at runtime, probe each
// unauthenticated, assert against the allowlist)."
//
// This is the load-bearing invariant of the whole release: the auth gate is
// ONE app.use installed before the shell catch-all + static + ytdlp routes,
// so every route is meant to be gated by default. This test enumerates the
// REAL Express router at runtime (not a hand-typed path list), probes each
// registered route with NO session cookie, and asserts the gate's behavior
// matches lib/auth/gate.js's allowlist for every one -- so a future,
// individually-innocuous commit that registers a new route before the gate,
// or widens the allowlist, or drops the gate, fails HERE instead of silently
// exposing data (the v1.41.6-seam class of regression this project has been
// burned by).
//
// This test found a real CRITICAL when first written: /js/login.js (the
// login/welcome form-submit handler) was NOT allowlisted, so a logged-out
// browser could never sign in. The API-level auth-flow test missed it
// because it never loads the browser JS.
//
// Deliberately NOT authenticated (no authenticateFetch): the whole point is
// the UNauthenticated surface. Requests carry no Accept: text/html, so the
// gate's `deny` returns 401 uniformly (HTML-redirect vs API-401 is a
// separate branch, covered by auth-flow.test.js); this keeps the assertion a
// clean "gated => 401 / allowlisted => not 401".

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-route-census-'));
process.env.FILETUBE_YTDLP_ENABLED = 'true'; // so the ytdlp routes register too
process.env.FILETUBE_YTDLP_POLL_MINUTES = '0';
process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-route-census-dl-'));

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, __mintTestSession } = require('../../server');
const gate = require('../../lib/auth/gate');

let server;
let base;

before(async () => {
  // Mint ONE admin so the gate is in its normal "users exist -> require a
  // session" mode (with zero users EVERY non-allowlisted route funnels to
  // /welcome, which is a different, weaker assertion). We never send its
  // cookie -- the probes are all unauthenticated.
  __mintTestSession();
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  delete process.env.FILETUBE_YTDLP_ENABLED;
  delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
});

// Walk the Express router for every registered {method, path}. Express 4
// stores route layers on app._router.stack; a layer with `.route` is a real
// route (its `.route.methods` are the verbs), everything else is middleware.
function enumerateRoutes() {
  const out = [];
  const stack = app._router && app._router.stack ? app._router.stack : [];
  for (const layer of stack) {
    if (!layer.route || typeof layer.route.path !== 'string') continue;
    const p = layer.route.path;
    if (p === '*' || p === '/*') continue; // the shell catch-all -- probed separately below
    for (const method of Object.keys(layer.route.methods)) {
      if (method === '_all') continue;
      out.push({ method: method.toUpperCase(), path: p });
    }
  }
  return out;
}

// Turn an Express path template into a concrete probe path. The gate runs
// BEFORE any handler and never parses params, so any placeholder works.
function concretePath(template) {
  return template.replace(/:[A-Za-z0-9_]+/g, 'x');
}

// A GATE denial is a 401 whose body carries the gate's own `authRequired`
// flag (lib/auth/gate.js's `deny`). A route that is allowlisted but whose
// HANDLER 401s for its own reason (e.g. POST /api/auth/login on bad
// credentials) is NOT a gate denial -- distinguishing the two is the whole
// trick that makes this census sound.
async function probeGated(method, concrete) {
  const res = await fetch(`${base}${concrete}`, { method, redirect: 'manual' });
  if (res.status !== 401) return false;
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON 401 is not the gate's */ }
  return Boolean(body && body.authRequired === true);
}

test('route census: every registered route is gated unless it is on the exact allowlist', async () => {
  const routes = enumerateRoutes();
  assert.ok(routes.length >= 60, `sanity: expected the full route set to enumerate, saw ${routes.length}`);

  const violations = [];
  for (const { method, path: template } of routes) {
    const concrete = concretePath(template);
    const allowlisted = gate.isAllowlisted(method, concrete);
    const gated = await probeGated(method, concrete);
    if (allowlisted && gated) {
      violations.push(`${method} ${template}: on the allowlist but the gate denied it (login surface broken?)`);
    } else if (!allowlisted && !gated) {
      violations.push(`${method} ${template} (${concrete}): NOT allowlisted but the gate did NOT deny it -- an UNGATED route (data exposure risk)`);
    }
  }
  assert.deepEqual(violations, [], `route-census violations:\n${violations.join('\n')}`);
});

test('route census: the shell catch-all + arbitrary static paths are gated (an unknown page 401s unauthenticated)', async () => {
  for (const p of ['/some-unknown-page', '/index.html', '/js/main.js', '/js/watch.js', '/read.html', '/setup.html']) {
    assert.equal(await probeGated('GET', p), true, `${p} must be gated pre-auth (not served by the catch-all/static before the gate)`);
  }
});

test('route census: the documented allowlist IS reachable pre-auth (positive control)', async () => {
  // None of these are a GATE denial: assets serve, the auth POSTs run their
  // own handler (400/409/429 on an empty body). The point is the gate let
  // each one through.
  assert.equal(await probeGated('GET', '/css/style.css'), false);
  assert.equal(await probeGated('GET', '/js/common.js'), false);
  assert.equal(await probeGated('GET', '/js/login.js'), false, 'login.js must reach the browser pre-auth or sign-in is impossible');
  assert.equal(await probeGated('GET', '/logo'), false);
  assert.equal(await probeGated('POST', '/api/auth/login'), false);
});
