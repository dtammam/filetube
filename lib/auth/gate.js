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
const deviceScope = require('./device-scope'); // v1.387.0: what a per-device token may reach
const mediaToken = require('./media-token'); // v1.397.0: the short-lived `?mt=` token the native audio engine fetches with

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
    // v1.43.1 gate fix (adversarial seat, WARNING-2): decodeURIComponent
    // THROWS a URIError on any malformed %-sequence (e.g. `other=%zz`), and
    // this parser runs unguarded inside the auth gate on EVERY request — the
    // global 4-arg error middleware is registered before the gate, so by the
    // forward-only error-stack rule it can never catch the throw: one corrupt
    // cookie value (any cookie, not just ours) turned the whole app into a
    // raw 500 instead of the fail-closed 401/redirect this module contracts
    // for. A value that doesn't decode is kept RAW rather than dropped: a
    // non-decodable session cookie then simply fails HMAC verification
    // downstream (deny), and other cookies on the header are unaffected.
    const raw = part.slice(eq + 1).trim();
    try {
      out[k] = decodeURIComponent(raw);
    } catch {
      out[k] = raw;
    }
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
  '/favicon.svg', '/favicon.ico', '/css/tokens.css', '/css/ui.css', '/css/style.css', '/js/common.js',
  // /js/login.js carries the login + welcome FORM-SUBMIT handlers (the
  // fetch() to /api/auth/login and /api/auth/setup). login.html and
  // welcome.html load it as <script src>, so a logged-OUT browser must be
  // able to fetch it or the sign-in/create-admin forms never wire up and
  // login is impossible from the browser. Static client code, no data — same
  // trust level as common.js. (Found by the route-census test; it was 401'd
  // through chunk 4, undetected because the API-level auth-flow test never
  // exercised the browser JS. The gate-covers-everything invariant holds; the
  // allowlist was simply missing a file the login SHELL depends on.)
  '/js/login.js',
  // UI professionalism pass: the primitives' builders and gesture helpers load on
  // login/welcome too (their forms move onto ui-field in S8). Static client code, no
  // data - same trust level as common.js.
  '/js/ui.js', '/js/interaction.js',
  // v1.364.0 gate r1 (Dean's ruling): login.html and welcome.html load these two as well (the glyph
  // registry common.js reads, and the prefs agent, which goes quiet on its own 401 without a session).
  // Refused signed out, every sign-in seeded the error log with two "failed to load script" entries.
  // Static client code, no data - same trust level as common.js. Exact paths only.
  '/js/glyph-pool.js', '/js/prefs-sync.js',
  // v1.384.0: the native-host adapter loads on every shell, login.html and welcome.html included (a
  // blocked script seeds the error log, the v1.364.0 shape above). Static client code, no data. And the
  // iOS app's pre-load server check, GET /api/host-info (app name, version, bridge range; nothing else),
  // answers before any session: the app cannot sign in until it knows the address is a FileTube server.
  '/js/host-adapter.js', '/api/host-info',
  // v1.66: the push-only service worker. The browser fetches this script
  // itself (register + periodic update checks), and a 401 HTML body landing
  // in the SW slot is the /js/login.js failure shape one layer down: the
  // update check would install garbage or kill the worker. Static client
  // code, no data - same trust level as common.js. NOT '/sw.js' (the
  // removed v1.26.4 offline worker's path, unclaimed forever) and NOT
  // '/push-sw.js' (v1.67.3: that name matches ad-blocker filter lists -
  // content blockers refused to load it on iOS, measured).
  '/filetube-worker.js',
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
  // Match on the pathname only (strip query), decoded ONCE to the form
  // express.static will resolve. v1.352 (Dean's ruling): the traversal check
  // reads the PATH only, never the query - a static file is resolved from the
  // path alone, and the query of /login?next=%2Fmusic carries an encoded
  // slash by design (the gate's login return), which used to un-allowlist
  // /login itself and loop the redirect.
  let p = rawPath.split('?')[0];
  if (TRAVERSAL.test(p)) return false;
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

// The client ip for rate buckets: behind FILETUBE_TRUST_PROXY the first
// X-Forwarded-For hop (the fronting proxy MUST sanitize inbound XFF), else the
// socket. Without TRUST_PROXY every phone behind one proxy shares its ip,
// which is why the device limiter below never blocks a VALID token.
function clientIp(req, trustProxy) {
  const xff = req.headers && req.headers['x-forwarded-for'];
  if (trustProxy && typeof xff === 'string' && xff.length > 0) return xff.split(',')[0].trim() || 'unknown';
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

// ---- device-token unknown-hash limiter (v1.387.0, gate r1 W6) -----------------
// Counts UNKNOWN `ftd_` hashes per ip: after `max` in `windowMs`, further
// unknown hashes from that ip get 429 for `blockMs`. A known-but-revoked token
// (an epoch-stale row) and a RECENTLY revoked or expired one (its row deleted,
// remembered by lib/auth/devices.js wasRevokedRecently) are NOT counted (a revoked
// phone's queued background tasks must not trip it) and a valid token is always
// let through (the gate looks the token up BEFORE consulting this). Fail-OPEN on
// any internal error, like the login bucket above.
function createUnknownTokenLimiter({ max = 30, windowMs = 10 * 60_000, blockMs = 10 * 60_000, nowMs = () => Date.now() } = {}) {
  const byIp = new Map(); // ip -> { count, windowStart, blockedUntil }
  function sweep(now) {
    if (byIp.size < 4096) return;
    for (const [k, e] of byIp) {
      if (now - e.windowStart > windowMs && e.blockedUntil <= now) byIp.delete(k);
    }
  }
  return {
    // -> { blocked: boolean, retryAfterSec: number }
    check(ip) {
      try {
        const e = byIp.get(ip);
        if (!e) return { blocked: false, retryAfterSec: 0 };
        const now = nowMs();
        if (e.blockedUntil > now) return { blocked: true, retryAfterSec: Math.ceil((e.blockedUntil - now) / 1000) };
        return { blocked: false, retryAfterSec: 0 };
      } catch {
        return { blocked: false, retryAfterSec: 0 }; // fail OPEN
      }
    },
    // One unknown hash from ip -> { blocked, retryAfterSec }: the request that
    // takes the count past `max` is itself the first 429.
    recordUnknown(ip) {
      try {
        const now = nowMs();
        sweep(now);
        let e = byIp.get(ip);
        if (!e || (now - e.windowStart > windowMs && e.blockedUntil <= now)) {
          e = { count: 0, windowStart: now, blockedUntil: 0 };
          byIp.set(ip, e);
        }
        e.count += 1;
        if (e.count > max && e.blockedUntil <= now) e.blockedUntil = now + blockMs;
        if (e.blockedUntil > now) return { blocked: true, retryAfterSec: Math.ceil((e.blockedUntil - now) / 1000) };
        return { blocked: false, retryAfterSec: 0 };
      } catch {
        return { blocked: false, retryAfterSec: 0 }; // fail OPEN
      }
    },
    _size() { return byIp.size; },
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
// v1.352 W1: a page bounced to /login carries the page it asked for, so signing in returns there (a
// speaker bookmark /music?remote=on survives a logged-out open). login.js accepts it only when it
// resolves to this origin (safeNextFrom). An over-long URL is dropped rather than truncated.
const NEXT_MAX = 2048;
function loginTarget(originalUrl) {
  if (typeof originalUrl !== 'string' || originalUrl.charAt(0) !== '/' || originalUrl === '/') return '/login';
  const next = encodeURIComponent(originalUrl);
  if (next.length > NEXT_MAX) return '/login';
  return '/login?next=' + next;
}

// v1.352 W1 (Dean's R5): sliding renewal. A valid session at least half its life old is re-issued
// (same uid, same tv, a fresh life) on the request that proves it is still in use, so a device opened
// at least once a fortnight stays signed in. Revocation is unchanged: disable, delete and a tv bump are
// checked BEFORE this on every request. Gate r1 (adversary W2 = security S1, Dean's ruling): renewal
// stops SESSION_MAX_AGE_SECONDS after the password was last typed (oat, carried through every
// renewal), so a copied cookie cannot be kept alive for ever. A pre-v1.352 token has no oat: its iat
// stands in (the latest moment the password can have been typed for it).
const SESSION_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;
function sessionAuthTime(payload) {
  return Number.isInteger(payload.oat) ? payload.oat : payload.iat;
}
function sessionWantsRenewal(payload, nowSec, ttlSec) {
  if (!payload || !Number.isInteger(payload.iat)) return false;
  if (nowSec - sessionAuthTime(payload) >= SESSION_MAX_AGE_SECONDS) return false;
  return nowSec - payload.iat >= Math.floor(ttlSec / 2);
}

function createAuthGate({ store, secret, cookieName, trustProxy = false, nowSeconds, apiToken = null, devices = null, scopeAllows = deviceScope.deviceScopeAllows, unknownTokenLimiter = null }) {
  const clock = typeof nowSeconds === 'function' ? nowSeconds : () => Math.floor(Date.now() / 1000);
  const clockMs = typeof nowSeconds === 'function' ? () => nowSeconds() * 1000 : () => Date.now();
  const ttlSec = authCrypto.SESSION_SECONDS_DEFAULT;
  const unknownLimiter = unknownTokenLimiter || createUnknownTokenLimiter({ nowMs: clockMs });
  const lastUsedStamp = new Map(); // device id -> ms of the last last_used_at write (at most one per 10 min)

  // v1.387.0 (plan D1): the per-device token branch. The ONE place req.user is set
  // from a token: look the hash up, then re-read the user row exactly like the
  // cookie path (missing / disabled / epoch mismatch / 180 days unused = revoked
  // NOW), then the explicit scope allowlist, then req.user. A claimed `ftd_`
  // value that is not a live token NEVER falls through to cookie auth.
  function deviceRevoked(res) {
    return res.status(401).json({ error: 'device token revoked', deviceRevoked: true });
  }
  function deviceAuth(req, res, next, token) {
    let row = null;
    try { row = devices.lookup(token); } catch { row = null; } // a store error fails CLOSED (401), never through
    if (!row) {
      // A token whose row was DELETED (removed, Remove all, expired, pruned) is known to the store's recent memory: it is
      // revoked, not unknown, and is not counted (gate r1 security-brief W1: a removed phone's queued range requests must
      // not 429 a second phone behind the same proxy ip). An epoch-stale row is a known row and never reaches here.
      let revokedRecently = false;
      try { revokedRecently = typeof devices.wasRevokedRecently === 'function' && devices.wasRevokedRecently(token); } catch { revokedRecently = false; }
      if (revokedRecently) return deviceRevoked(res);
      const state = unknownLimiter.recordUnknown(clientIp(req, trustProxy));
      if (state.blocked) {
        res.setHeader('Retry-After', String(state.retryAfterSec));
        return res.status(429).json({ error: 'too many attempts', retryAfterSec: state.retryAfterSec });
      }
      return deviceRevoked(res);
    }
    const user = store.getById(row.userId);
    if (!user || user.disabled || user.deviceEpoch !== row.epoch) return deviceRevoked(res);
    const nowMs = clockMs();
    if (devices.isExpired(row, nowMs)) {
      try { devices.prune(row.id); } catch { /* the 401 stands either way */ }
      return deviceRevoked(res);
    }
    if (row.platform === 'shortcut') {
      // v1.395.0 Pages (D-AUTH): a Shortcut's token saves to Pages and is not a credential anywhere else.
      if (!deviceScope.shortcutScopeAllows(req.method, req.path)) return res.status(401).json({ error: 'This token can only save to Pages.', message: 'This token can only save to Pages.', shortcutOnly: true });
    } else if (!scopeAllows(req.method, req.path)) {
      return res.status(403).json({ error: 'not available to devices' });
    }
    req.user = user;
    req.authVia = 'device';
    req.deviceId = row.id;
    req.devicePlatform = row.platform;
    const last = lastUsedStamp.get(row.id) || 0;
    if (nowMs - last >= devices.LAST_USED_WRITE_INTERVAL_MS) {
      if (lastUsedStamp.size > 10000) lastUsedStamp.clear();
      lastUsedStamp.set(row.id, nowMs);
      try { devices.touch(row.id, new Date(nowMs).toISOString()); } catch { /* a stamp, never a refusal */ }
    }
    devices.track(row.id, user.id, res); // live revocation: a revoke mid-stream ends this response
    return next();
  }

  // v1.397.0 (plan D7): the MEDIA TOKEN branch (`?mt=ftm_...`, lib/auth/media-token.js). Judged
  // BEFORE every other credential and never falling through: a request that carries `mt` is this
  // request kind, whatever else it carries. GET / HEAD on MEDIA_SCOPE only (anything else is a JSON
  // 401 even with a valid token: the token must not be a credential anywhere a cookie is), then the
  // signature, then the same liveness re-reads as the device token (the user row, the device row,
  // the device epoch), then expiry. It never redirects (a Location would echo the token), never sets
  // a cookie (we return before the renewal branch), and an invalid signature counts against the
  // per-ip unknown limiter like an unknown ftd_ hash. A valid one sets req.user from the row, so every
  // restriction applies, and registers the response for live revocation.
  // The two answers native keys on (the iOS Root's ruling via the FileTube Root, 2026-10-28, plan D14):
  // `mediaTokenExpired` = re-mint (an expired token AND a token that never existed answer the same, so a
  // forged token learns nothing a bad ftd_ hash would not); `deviceRevoked` = the token's device is gone,
  // epoch-stale, disabled or deleted (surfaced as 'revoked'; mid-stream the open response simply ends).
  function mediaAuth(req, res, next, token) {
    const refuse = (status, body) => res.status(status).json(body);
    if (!deviceScope.mediaScopeAllows(req.method, req.path)) return refuse(401, { error: 'media token not accepted here', mediaTokenScope: true });
    const parsed = mediaToken.parseMediaToken(token, secret);
    if (!parsed) {
      const state = unknownLimiter.recordUnknown(clientIp(req, trustProxy));
      if (state.blocked) {
        res.setHeader('Retry-After', String(state.retryAfterSec));
        return refuse(429, { error: 'too many attempts', retryAfterSec: state.retryAfterSec });
      }
      return refuse(401, { error: 'media token expired', mediaTokenExpired: true }); // never existed = expired (no oracle)
    }
    if (!devices) return deviceRevoked(res);
    let row = null;
    try { row = devices.byId(parsed.did); } catch { row = null; } // a store error fails CLOSED
    if (!row || row.userId !== parsed.uid || row.epoch !== parsed.de || row.platform === 'shortcut') return deviceRevoked(res);
    const user = store.getById(parsed.uid);
    if (!user || user.disabled || user.deviceEpoch !== parsed.de) return deviceRevoked(res);
    if (parsed.exp <= clock()) return refuse(401, { error: 'media token expired', mediaTokenExpired: true });
    req.user = user;
    req.authVia = 'media';
    req.deviceId = row.id;
    req.devicePlatform = row.platform;
    devices.track(row.id, user.id, res); // live revocation: a revoke mid-stream ends this response
    return next();
  }

  function wantsHtml(req) {
    return (req.method === 'GET' || req.method === 'HEAD') &&
      typeof req.headers.accept === 'string' && req.headers.accept.includes('text/html');
  }
  function deny(req, res, to) {
    if (wantsHtml(req)) return res.redirect(302, to === '/login' ? loginTarget(req.originalUrl || req.url) : to);
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
        if (authCrypto.tokensEqual(provided, apiToken)) {
          // Attribution marker for the audit log (2026-07-30 hardening):
          // this is the one privileged non-cookie caller, and without a
          // marker its mutations logged as 'unauthenticated'. Deliberately
          // NOT req.user - routes must keep treating token calls as
          // session-less.
          req.auditActor = 'api-token';
          return next();
        }
        return res.status(401).json({ error: 'invalid API token' });
      }
      // no token header -> fall through to cookie auth below
    }

    // v1.397.0: a media token in the query (`?mt=ftm_...`) is judged first and never falls through.
    const mt = req.query && typeof req.query.mt === 'string' ? req.query.mt : (req.query && req.query.mt !== undefined ? '' : null);
    if (mt !== null) return mediaAuth(req, res, next, mt);

    // v1.387.0: a per-device token (`Authorization: Bearer ftd_...`). Claimed ONLY
    // when the Bearer value starts `ftd_`; any other Authorization header falls
    // through untouched (an auth proxy's own Bearer keeps working, gate r1 W4).
    if (devices) {
      const authz = req.headers.authorization;
      if (typeof authz === 'string') {
        const m = /^\s*Bearer\s+(\S+)\s*$/i.exec(authz);
        if (m && devices.isDeviceToken(m[1])) return deviceAuth(req, res, next, m[1]);
      }
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
    const now = clock();
    if (sessionWantsRenewal(payload, now, ttlSec)) {
      // the same cookie login sets (server.js issueSessionCookie): name, flags and Max-Age; the route
      // that runs next may still replace it (logout clears it, a password change re-issues it)
      const fresh = authCrypto.signSession({ uid: user.id, tv: user.tokenVersion, oat: Math.min(sessionAuthTime(payload), now) }, secret, { nowSeconds: now, ttlSeconds: ttlSec });
      res.setHeader('Set-Cookie', serializeCookie(cookieName, fresh, { maxAgeSeconds: ttlSec, secure: requestIsHttps(req, trustProxy) }));
    }
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
  createUnknownTokenLimiter,
  clientIp,
  createAuthGate,
  loginTarget,
  sessionWantsRenewal,
  SESSION_MAX_AGE_SECONDS,
  NEXT_MAX,
};
