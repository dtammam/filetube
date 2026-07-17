'use strict';

// ---- v1.43 auth gate (session secret, cookies, rate limiter, middleware) ----
//
// Wires lib/auth/crypto.js (math) + lib/auth/store.js (accounts) into Express
// as ONE app.use gate installed before the shell catch-all, covering every
// route + static + streams (design + drift #1). Zero new deps: cookies are
// parsed/serialized by hand (no cookie-parser). server.js owns the routes and
// calls into this.
//
// Every security contract here is the design-delta reviewed spec:
//  - the allowlist normalizes + rejects traversal BEFORE matching (WARNING-3)
//  - the login/setup rate limiter is in-memory, fail-open (CRITICAL-1 D-i-D)
//  - per-request tv re-check reads the warm store, not a snapshot (SUGGESTION-6)
//  - Secure cookie behind the proxy is honest + logged (SUGGESTION-8)

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const authCrypto = require('./crypto');

// ---- session secret ---------------------------------------------------------
// Precedence: FILETUBE_SESSION_SECRET env → DATA_DIR/session-secret file →
// mint a fresh 32-byte secret to that file (0600). Fail-closed validation
// (short/placeholder → throw at boot; better a loud refusal than forgeable
// cookies). Returns the usable secret string.
function resolveSessionSecret(dataDir, env = process.env, log = console.log) {
  const fromEnv = env.FILETUBE_SESSION_SECRET;
  if (typeof fromEnv === 'string' && fromEnv.length > 0) {
    authCrypto.assertUsableSecret(fromEnv); // throws → boot fails loudly
    log('[auth] session secret: using FILETUBE_SESSION_SECRET (env).');
    return fromEnv;
  }
  const secretPath = path.join(dataDir, 'session-secret');
  if (fs.existsSync(secretPath)) {
    const fromFile = fs.readFileSync(secretPath, 'utf8').trim();
    authCrypto.assertUsableSecret(fromFile);
    return fromFile;
  }
  const minted = authCrypto.generateSecret();
  // Write 0600 (owner read/write only) — a session secret is a credential.
  fs.writeFileSync(secretPath, minted, { mode: 0o600 });
  try { fs.chmodSync(secretPath, 0o600); } catch { /* best-effort on odd FS */ }
  log(`[auth] session secret: minted a new one at ${secretPath} (0600). Set FILETUBE_SESSION_SECRET to pin it across DATA_DIR moves.`);
  return minted;
}

// Per-instance cookie NAME (design): cookies are host-scoped, not
// port-scoped, and prod+beta run on one host — a shared name with different
// secrets would log the two instances out of each other. Name is derived
// from DATA_DIR so each instance owns its own cookie slot.
function cookieNameFor(dataDir) {
  const h = crypto.createHash('sha256').update(String(dataDir)).digest('hex').slice(0, 10);
  return `ft_session_${h}`;
}

// ---- cookie parse/serialize (no dep) ---------------------------------------
function parseCookies(header) {
  const out = {};
  if (typeof header !== 'string' || header.length === 0) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    if (!k) continue;
    out[k] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

function serializeCookie(name, value, { maxAgeSeconds, secure, expired = false } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (expired) parts.push('Max-Age=0');
  else if (typeof maxAgeSeconds === 'number') parts.push(`Max-Age=${maxAgeSeconds}`);
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

// Does the request arrive over https? Behind a TLS-terminating proxy the
// container sees plain http and learns https only from X-Forwarded-Proto,
// which is trustworthy ONLY when FILETUBE_TRUST_PROXY is set (SUGGESTION-8).
function requestIsHttps(req, trustProxy) {
  if (req.socket && req.socket.encrypted) return true;
  if (trustProxy) {
    const xfp = req.headers['x-forwarded-proto'];
    if (typeof xfp === 'string' && xfp.split(',')[0].trim().toLowerCase() === 'https') return true;
  }
  return false;
}

// ---- allowlist (the whole ballgame; WARNING-3 normalization contract) ------
// Reachable BEFORE login. Everything else requires a valid session.
const ALLOW_EXACT = new Set([
  '/login', '/welcome', '/logo', '/manifest.webmanifest',
  '/favicon.svg', '/favicon.ico', '/css/style.css', '/js/common.js',
]);
// Method-specific exact (the auth POSTs themselves).
const ALLOW_POST = new Set(['/api/auth/login', '/api/auth/setup']);
// Prefixes whose remainder must be a single plain filename (no slashes, no
// dot-segments) — static asset trees only.
const ALLOW_PREFIX = ['/fonts/', '/icons/', '/assets/icons/'];
const PLAIN_FILENAME = /^[A-Za-z0-9._-]+$/;
// A path is refused OUTRIGHT (never even considered for allowlisting) if it
// carries any traversal marker — raw or percent-encoded. Fail closed to
// auth-required; never let express.static's accidental containment be the
// only guard behind the proxy's rewrites.
const TRAVERSAL = /(\.\.|%2e|%2f|%5c|\\)/i;

function isAllowlisted(method, rawPath) {
  if (typeof rawPath !== 'string' || rawPath.length === 0) return false;
  if (TRAVERSAL.test(rawPath)) return false;
  // Match on the pathname only (strip query), decoded ONCE to the form
  // express.static will resolve.
  let p = rawPath.split('?')[0];
  try { p = decodeURIComponent(p); } catch { return false; }
  if (TRAVERSAL.test(p)) return false; // re-check post-decode
  if (method === 'GET' || method === 'HEAD') {
    if (ALLOW_EXACT.has(p)) return true;
    for (const prefix of ALLOW_PREFIX) {
      if (p.startsWith(prefix)) {
        // The remainder is one or more nested plain segments (the icon
        // system nests: /assets/icons/<set>/<name>.svg). EVERY segment must
        // be a plain filename AND not a dot-segment ('.'/'..' both match the
        // filename charset since '.' is allowed — reject them explicitly,
        // behind the raw+decoded TRAVERSAL pre-checks above). Depth capped.
        const segs = p.slice(prefix.length).split('/');
        if (segs.length === 0 || segs.length > 4) return false;
        return segs.every((s) => s !== '.' && s !== '..' && PLAIN_FILENAME.test(s));
      }
    }
    return false;
  }
  if (method === 'POST') return ALLOW_POST.has(p);
  return false;
}

// ---- login/setup rate limiter (in-memory token bucket; CRITICAL-1 D-i-D) ---
// Per key (ip+username), REFILL tokens/sec up to CAP. Fail-OPEN on any
// internal error — a limiter bug must never lock the real owner out.
function createRateLimiter({ capacity = 8, refillPerSec = 0.2, nowMs = () => Date.now() } = {}) {
  const buckets = new Map();
  // Opportunistic sweep so an internet-facing box doesn't grow the map
  // without bound under a spray of distinct source ips.
  function sweep(now) {
    if (buckets.size < 4096) return;
    for (const [k, b] of buckets) {
      if (now - b.ts > 3600_000) buckets.delete(k);
    }
  }
  return {
    // -> { allowed: boolean, retryAfterSec: number }
    take(key) {
      try {
        const now = nowMs();
        sweep(now);
        let b = buckets.get(key);
        if (!b) { b = { tokens: capacity, ts: now }; buckets.set(key, b); }
        b.tokens = Math.min(capacity, b.tokens + ((now - b.ts) / 1000) * refillPerSec);
        b.ts = now;
        if (b.tokens >= 1) { b.tokens -= 1; return { allowed: true, retryAfterSec: 0 }; }
        return { allowed: false, retryAfterSec: Math.ceil((1 - b.tokens) / refillPerSec) };
      } catch {
        return { allowed: true, retryAfterSec: 0 }; // fail OPEN
      }
    },
    // A successful login refunds the attempt (don't punish real users).
    refund(key) {
      const b = buckets.get(key);
      if (b) b.tokens = Math.min(capacity, b.tokens + 1);
    },
    _size() { return buckets.size; },
  };
}

// ---- the gate middleware ----------------------------------------------------
// Returns an Express middleware. `deps`:
//   store        - the user store (getById for the per-request tv re-check)
//   secret       - the session secret
//   trustProxy   - boolean (FILETUBE_TRUST_PROXY)
//   nowSeconds() - injectable clock (tests)
// It attaches req.user (the row) + req.authCookieName, or fails:
//   - allowlisted path        → next() (no user)
//   - zero users exist        → redirect pages to /welcome, 401 APIs
//     (the create-admin state; only the allowlist + /welcome are reachable)
//   - valid session           → req.user set, next()
//   - missing/invalid session → redirect GET-html to /login, else 401 JSON
function createAuthGate({ store, secret, cookieName, trustProxy = false, nowSeconds, apiToken = null }) {
  const clock = typeof nowSeconds === 'function' ? nowSeconds : () => Math.floor(Date.now() / 1000);

  function wantsHtml(req) {
    return (req.method === 'GET' || req.method === 'HEAD') &&
      typeof req.headers.accept === 'string' && req.headers.accept.includes('text/html');
  }
  function deny(req, res, to) {
    if (wantsHtml(req)) return res.redirect(302, to);
    return res.status(401).json({ error: 'authentication required', authRequired: true });
  }

  return function authGate(req, res, next) {
    req.authCookieName = cookieName;
    const p = req.path;

    // API token (intake #1): the iOS Shortcut can't cookie-login, so when
    // FILETUBE_API_TOKEN is set, POST /api/ytdlp/download accepts it via the
    // X-FileTube-Token header as an ALTERNATIVE to the session cookie. Only
    // when a token header is actually PRESENT do we validate it strictly (a
    // wrong token 401s); ABSENT falls through to normal cookie auth so a
    // browser session still uses the endpoint (design-delta SUGGESTION-5).
    // The read-only-media guard still applies AFTER this, in the handler.
    if (apiToken && req.method === 'POST' && p === '/api/ytdlp/download') {
      const provided = req.headers['x-filetube-token'];
      if (typeof provided === 'string' && provided.length > 0) {
        if (authCrypto.tokensEqual(provided, apiToken)) return next();
        return res.status(401).json({ error: 'invalid API token' });
      }
      // no token header -> fall through to cookie auth below
    }

    // Allowlist first — but /welcome and the setup POST are only valid while
    // ZERO users exist; once set up, they must not be an open surface.
    const noUsers = store.countUsers() === 0;

    if (isAllowlisted(req.method, req.originalUrl || req.url)) {
      // /login and /welcome cross-guard each other by user-count so a
      // logged-out-but-set-up instance can't land on /welcome, and a
      // not-yet-set-up instance sends everyone to /welcome.
      if (p === '/welcome' && !noUsers) return res.redirect(302, '/login');
      if (p === '/login' && noUsers) return res.redirect(302, '/welcome');
      if ((p === '/api/auth/setup') && !noUsers) return res.status(409).json({ error: 'setup already complete' });
      if ((p === '/api/auth/login') && noUsers) return res.status(409).json({ error: 'no users yet — create the admin at /welcome', needsSetup: true });
      return next();
    }

    // Not allowlisted. If the instance has no users at all, everything funnels
    // to first-run setup.
    if (noUsers) return deny(req, res, '/welcome');

    // Require a valid session.
    const token = parseCookies(req.headers.cookie)[cookieName];
    const payload = token ? authCrypto.verifySession(token, secret, { nowSeconds: clock() }) : null;
    if (!payload) return deny(req, res, '/login');

    // Per-request row re-check (SUGGESTION-6: warm point-query). tv mismatch,
    // disabled, or deleted → the cookie is dead NOW (instant revocation).
    const user = store.getById(payload.uid);
    if (!user || user.disabled || user.tokenVersion !== payload.tv) {
      return deny(req, res, '/login');
    }
    req.user = user;
    return next();
  };
}

module.exports = {
  resolveSessionSecret,
  cookieNameFor,
  parseCookies,
  serializeCookie,
  requestIsHttps,
  isAllowlisted,
  createRateLimiter,
  createAuthGate,
};
