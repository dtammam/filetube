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
  await ctx.route('**/*', (route) => {
    const req = route.request();
    const redirected = Boolean(req.redirectedFrom && req.redirectedFrom());
    const verdict = requestVerdict(req.method(), req.url(), redirected);
    if (verdict.allow) return route.continue();
    const info = { method: req.method(), url: req.url(), reason: verdict.reason, expected: Boolean(verdict.expected) };
    try { onBlocked(info); } catch { /* recording must never unblock the guard */ }
    if (!info.expected) console.error(`  BLOCKED mutating request: ${info.method} ${info.url}`);
    // Fulfill, never abort: nothing reaches the server, and the page's
    // success path runs so the screenshot is not perturbed.
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

// The ONLY way capture code obtains a browser context. `tag` labels the
// run-record entries (scene id or 'login'); `record` must carry
// blockedRequests[] and blockedExpected[].
async function newGuardedContext(browser, opts, record, tag) {
  // serviceWorkers:'block' is version insurance - Playwright 1.49 routes SW
  // requests through context.route (verified), but a regression there must
  // not reopen the hole.
  const ctx = await browser.newContext({ ...opts, serviceWorkers: 'block' });
  await guardContext(ctx, (b) => {
    (b.expected ? record.blockedExpected : record.blockedRequests).push({ ...tag, ...b });
  });
  return ctx;
}

module.exports = { requestVerdict, guardContext, newGuardedContext, ALLOWED_POST_PATHS, EXPECTED_BLOCK_PATTERNS };
