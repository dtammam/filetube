'use strict';
/*
 * Capture-harness request policy (2026-07-30 hardening, P0; rebuilt in the
 * gate fix round).
 *
 * Captures are READ-ONLY against the instance BY ENFORCED INVARIANT, not
 * convention: on 2026-07-30 a capture scene two-tapped the home delete
 * control and permanently deleted 8 real library files. Every capture
 * browser context is created THROUGH this module (newGuardedContext is the
 * only context factory - a source test bans bare browser.newContext in
 * capture.js, closing the gate's CRITICAL-1: the guard used to be
 * deletable with a green suite).
 *
 * Blocked mutations are FULFILLED with an empty 200, not aborted: an abort
 * fires the page's error paths and can corrupt the very pixels being
 * baselined (the notif panel wipes its rendered rows when its seen-POST
 * rejects - gate CRITICAL-3). Fulfillment keeps the page on its success
 * path while nothing ever reaches the server.
 *
 * Blocked attempts are classified: EXPECTED fire-and-forget telemetry the
 * app emits on ordinary page views (view counts, progress, notification
 * seen-marks) is recorded but does not fail the run; anything else -
 * every DELETE/PUT/PATCH and any unexpected POST - is an ALARM that fails
 * the run loudly (gate WARNING-4: an alarm that fires on every healthy
 * run is no alarm).
 *
 * The POST allowlist is hop-1 AND final-hop: a redirected request never
 * qualifies (gate WARNING-5: route.continue() follows redirects without
 * re-invoking the handler, so an allowlisted POST answered with a 307 to
 * a mutating path would otherwise sail through).
 *
 * The server-side twin of this contract is FILETUBE_READONLY=1 in
 * server.js (READONLY_ALLOWED_POSTS) - a test asserts this allowlist stays
 * a subset of that one.
 */

const ALLOWED_POST_PATHS = new Set([
  '/api/auth/login',
  '/api/ytdlp/repull-metadata/preview',
]);

// Fire-and-forget writes the app itself makes on ordinary page views.
// Still BLOCKED (they never reach the server) - just not run-failing.
const EXPECTED_BLOCK_PATTERNS = [
  /^\/api\/videos\/[^/]+\/view$/,
  /^\/api\/progress$/,
  /^\/api\/notifications\/seen$/,
];

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// -> { allow: true } | { allow: false, expected: bool, reason }
function requestVerdict(method, url, redirected = false) {
  const m = String(method || '').toUpperCase();
  if (SAFE_METHODS.has(m)) return { allow: true };
  let pathname;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return { allow: false, expected: false, reason: `unparseable url for ${m}` };
  }
  if (m === 'POST' && !redirected && ALLOWED_POST_PATHS.has(pathname)) return { allow: true };
  if (m === 'POST' && redirected && ALLOWED_POST_PATHS.has(pathname)) {
    return { allow: false, expected: false, reason: `redirected request landed on allowlisted ${pathname} - hop-1-only contract` };
  }
  const expected = m === 'POST' && EXPECTED_BLOCK_PATTERNS.some((p) => p.test(pathname));
  return { allow: false, expected, reason: `${m} ${pathname} is not in the read-only capture contract` };
}

// Installs the guard on a Playwright BrowserContext. `onBlocked` receives
// { method, url, reason, expected }; blocking is always recorded.
async function guardContext(ctx, onBlocked) {
  await ctx.route('**/*', async (route) => {
    const req = route.request();
    const method = req.method().toUpperCase();
    const redirected = Boolean(req.redirectedFrom && req.redirectedFrom());
    const verdict = requestVerdict(req.method(), req.url(), redirected);
    if (verdict.allow) {
      if (method !== 'POST') return route.continue();
      // Allowlisted POST: perform the fetch OURSELVES with redirects
      // disabled. route.continue() lets the network stack follow redirects
      // internally WITHOUT re-invoking this handler (gate DELTA-A, proven
      // live: a 307 out of /api/auth/login landed a POST on a mutating
      // path unrecorded) - so the only sound enforcement is to never let
      // the stack follow a redirect on our behalf.
      const resp = await route.fetch({ maxRedirects: 0 });
      if (resp.status() >= 300 && resp.status() < 400) {
        const info = {
          method, url: req.url(), expected: false,
          reason: `redirect out of allowlisted POST -> ${resp.headers()['location'] || '(no location)'}`,
        };
        try { onBlocked(info); } catch { /* recording must never unblock the guard */ }
        console.error(`  BLOCKED redirect: ${info.reason}`);
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      }
      return route.fulfill({ response: resp });
    }
    const info = { method: req.method(), url: req.url(), reason: verdict.reason, expected: Boolean(verdict.expected) };
    try { onBlocked(info); } catch { /* recording must never unblock the guard */ }
    if (!info.expected) console.error(`  BLOCKED mutating request: ${info.method} ${info.url}`);
    // Fulfill, never abort: nothing reaches the server, and the page's
    // success path runs so the screenshot is not perturbed. TRADE (gate
    // DELTA-D): the client is told the mutation SUCCEEDED, so a scene that
    // actuates a destructive control can screenshot optimistic UI (card
    // removed, success toast) that lies about server state - the run's
    // exit-1 alarm on any unexpected block is what surfaces that frame as
    // untrustworthy.
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

// The ONLY way capture code obtains a browser context. `tag` labels the
// run-record entries (scene id or 'login'); `record` must carry
// blockedRequests[] and blockedExpected[].
async function newGuardedContext(browser, opts, record, tag) {
  // serviceWorkers:'block' is LOAD-BEARING, not insurance: per
  // playwright-core's own docs (types.d.ts, the route() entries), requests
  // intercepted by a service worker are structurally INVISIBLE to
  // context.route - blocking SWs is the only way this guard covers them.
  // As of v1.66 FileTube DOES register a service worker (the push-only
  // /push-sw.js, via common.js registerPushWorker), so this block is now
  // load-bearing in the present tense, not just against a future: without
  // it, any request that worker intercepted would be invisible to the
  // route guard. Do not relax it. (Originally a QA-gate finding when no SW
  // existed; corrected by the v1.66 QA seat once one did.)
  // bypassCSP: a SCREENSHOT harness must not die on any page's CSP -
  // field gate 4's "v1.57 CSP" was Express finalhandler's stock 404 page
  // (default-src 'none') served because ytdlp-off unregistered the
  // route; FileTube itself sets no CSP (grepped). Bypassing is safe here
  // BECAUSE the route guard blocks every mutation regardless - page CSP
  // is not this harness's security boundary.
  const ctx = await browser.newContext({ ...opts, serviceWorkers: 'block', bypassCSP: true });
  await guardContext(ctx, (b) => {
    (b.expected ? record.blockedExpected : record.blockedRequests).push({ ...tag, ...b });
  });
  return ctx;
}

module.exports = { requestVerdict, guardContext, newGuardedContext, ALLOWED_POST_PATHS, EXPECTED_BLOCK_PATTERNS };
