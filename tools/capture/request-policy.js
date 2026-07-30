'use strict';
/*
 * Capture-harness request policy (2026-07-30 hardening, P0).
 *
 * Captures are READ-ONLY against the instance BY ENFORCED INVARIANT, not
 * convention: on 2026-07-30 a capture scene two-tapped the home delete
 * control and permanently deleted 8 real library files - the browser
 * happily issued DELETE /api/videos/:id. This policy is installed as a
 * Playwright route interceptor on EVERY capture context (including the
 * login context), so no scene - present or future - can mutate the
 * instance no matter what it clicks.
 *
 * Allowed: all safe methods, plus exactly two POSTs the harness needs -
 * the login POST (authentication) and the relocation dry-run preview
 * (read-only by server contract). Everything else mutating is aborted
 * and recorded loudly in the run record.
 */

const ALLOWED_POST_PATHS = new Set([
  '/api/auth/login',
  '/api/ytdlp/repull-metadata/preview',
]);

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function requestVerdict(method, url) {
  const m = String(method || '').toUpperCase();
  if (SAFE_METHODS.has(m)) return { allow: true };
  let pathname;
  try {
    pathname = new URL(url).pathname;
  } catch {
    // Unparseable URL on a mutating method: never let it through.
    return { allow: false, reason: `unparseable url for ${m}` };
  }
  if (m === 'POST' && ALLOWED_POST_PATHS.has(pathname)) return { allow: true };
  return { allow: false, reason: `${m} ${pathname} is not in the read-only capture contract` };
}

// Installs the guard on a Playwright BrowserContext. `onBlocked` receives
// { method, url, reason } for the run record; blocking is always loud.
async function guardContext(ctx, onBlocked) {
  await ctx.route('**/*', (route) => {
    const req = route.request();
    const verdict = requestVerdict(req.method(), req.url());
    if (verdict.allow) return route.continue();
    const info = { method: req.method(), url: req.url(), reason: verdict.reason };
    try { onBlocked(info); } catch { /* recording must never unblock the abort */ }
    console.error(`  BLOCKED mutating request: ${info.method} ${info.url}`);
    return route.abort('blockedbyclient');
  });
}

module.exports = { requestVerdict, guardContext, ALLOWED_POST_PATHS };
