'use strict';

// v1.41.13 (universal one-offs, Decision D6): a BOUNDED, SSRF-hardened
// server-side redirect resolver for share SHORTLINKS.
//
// WHY: a Facebook/etc. share link (`facebook.com/share/r/<id>/`) is matched by
// NO named yt-dlp extractor -- stock yt-dlp only handles it via the GENERIC
// extractor's redirect-following, which this design deliberately blocks
// (SSRF). The share sheet is the primary mobile flow, so instead of reopening
// generic we follow the redirect OURSELVES, bounded and guarded, then hand the
// RESOLVED url to the normal named-extractor pipeline. Verified against a live
// FB share link: a single HTTP 302 to `/reel/<digits>` (FacebookReelIE),
// no auth/cookies.
//
// SAFETY ENVELOPE (design delta-3, the reviewer's 5 prescriptions):
//  1. Max `maxHops` redirects (default 3), hard per-hop + total timeouts.
//  2. GET with MANUAL redirect handling -- NEVER the http client's own
//     auto-follow (that would bypass the per-hop guard entirely). The response
//     body is destroyed the instant status + Location are read (never consumed).
//  3. No cookies, no auth, minimal headers.
//  4. Every hop's Location is resolved to an ABSOLUTE url against the current
//     hop, then re-guarded: http(s) only, no userinfo, and the host must pass
//     BOTH the synchronous literal-IP guard (isPrivateOrLocalHost) AND a
//     DNS resolve-then-check (getaddrinfo -> refuse if ANY resolved address is
//     private/loopback/link-local). The FIRST hop's host is guarded too.
//  5. Runs UNLOCKED (the caller never holds a download gate across this).
//
// Residual (disclosed): TOCTOU DNS rebinding between the resolve-then-check
// and the connect -- narrowed but not eliminated; revisit at v1.42 multiuser.

const http = require('http');
const https = require('https');
const dns = require('dns');
const { URL } = require('url');
const { isPrivateOrLocalHost } = require('./url');

const DEFAULT_MAX_HOPS = 3;
const DEFAULT_PER_HOP_TIMEOUT_MS = 3000;
const DEFAULT_TOTAL_TIMEOUT_MS = 8000;

// Refuse a hostname whose DNS resolution includes ANY private/loopback/
// link-local address (the literal guard only catches IP-literal hosts; this
// catches a public NAME that resolves internally -- rebinding's static case).
// `lookupImpl` injectable for tests. Resolves true = SAFE, false = refuse.
function hostResolvesPublic(hostname, lookupImpl) {
  const lookup = lookupImpl || dns.lookup;
  return new Promise((resolve) => {
    lookup(hostname, { all: true }, (err, addresses) => {
      if (err || !Array.isArray(addresses) || addresses.length === 0) {
        resolve(false); // cannot resolve -> fail closed
        return;
      }
      for (const a of addresses) {
        const addr = a && a.address;
        // isPrivateOrLocalHost classifies a bare IP literal (v4 any-encoding /
        // v6) exactly as it does a URL host -- reuse it so the two guards agree.
        if (isPrivateOrLocalHost(addr)) { resolve(false); return; }
      }
      resolve(true);
    });
  });
}

// One hop: GET `urlStr` with manual redirect, no body. Resolves
// { location } (an absolute redirect target string) or { done: true } (a
// non-redirect terminal response) or { error }. `httpImpl`/`httpsImpl`
// injectable for tests.
function fetchHead(urlStr, perHopTimeoutMs, deps) {
  return new Promise((resolve) => {
    let parsed;
    try { parsed = new URL(urlStr); } catch { resolve({ error: 'bad url' }); return; }
    const impl = parsed.protocol === 'https:' ? (deps.https || https) : (deps.http || http);
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    let req;
    try {
      req = impl.request(urlStr, {
        method: 'GET',
        headers: { 'user-agent': 'FileTube/redirect-resolver', accept: '*/*' },
        // NEVER delegate redirect following to the client.
      }, (res) => {
        const status = res.statusCode || 0;
        const location = res.headers && res.headers.location;
        // Destroy the response immediately -- we never read the body.
        res.destroy();
        if (status >= 300 && status < 400 && typeof location === 'string' && location !== '') {
          done({ location });
        } else {
          done({ done: true, status });
        }
      });
    } catch { done({ error: 'request threw' }); return; }
    req.setTimeout(perHopTimeoutMs, () => { req.destroy(); done({ error: 'per-hop timeout' }); });
    req.on('error', () => done({ error: 'request error' }));
    req.end();
  });
}

// Guard a candidate absolute url: http(s) only, no userinfo, literal-IP guard,
// then DNS resolve-then-check. Resolves { ok, url } or { ok:false, error }.
async function guardHop(urlStr, deps) {
  let parsed;
  try { parsed = new URL(urlStr); } catch { return { ok: false, error: 'unparseable redirect target' }; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { ok: false, error: 'non-http(s) redirect' };
  if (parsed.username !== '' || parsed.password !== '') return { ok: false, error: 'redirect target carries userinfo' };
  if (isPrivateOrLocalHost(parsed.hostname)) return { ok: false, error: 'redirect target is a private/local host' };
  const publicHost = await hostResolvesPublic(parsed.hostname, deps.lookup);
  if (!publicHost) return { ok: false, error: 'redirect target resolves to a private address' };
  return { ok: true, url: parsed.toString() };
}

/**
 * Resolve share-shortlink redirects, bounded + SSRF-guarded. `startUrl` MUST
 * already have passed isPlausibleMediaUrl (a validated http(s) public URL).
 * Returns { ok:true, url } with the final (possibly unchanged) URL, or
 * { ok:false, error } on any refusal/timeout/hop-cap. Never throws.
 * @param {string} startUrl
 * @param {object} [opts] { maxHops, perHopTimeoutMs, totalTimeoutMs, http, https, lookup }
 */
async function resolveShortlink(startUrl, opts = {}) {
  const maxHops = Number.isInteger(opts.maxHops) ? opts.maxHops : DEFAULT_MAX_HOPS;
  const perHopTimeoutMs = Number.isInteger(opts.perHopTimeoutMs) ? opts.perHopTimeoutMs : DEFAULT_PER_HOP_TIMEOUT_MS;
  const totalTimeoutMs = Number.isInteger(opts.totalTimeoutMs) ? opts.totalTimeoutMs : DEFAULT_TOTAL_TIMEOUT_MS;
  const deps = { http: opts.http, https: opts.https, lookup: opts.lookup, now: opts.now || (() => Date.now()) };

  // Guard the STARTING host too (it passed the synchronous literal guard at
  // intake, but not the DNS resolve-then-check).
  const startGuard = await guardHop(startUrl, deps);
  if (!startGuard.ok) return { ok: false, error: startGuard.error };
  let current = startGuard.url;

  const started = deps.now();
  for (let hop = 0; hop < maxHops; hop++) {
    if (deps.now() - started > totalTimeoutMs) return { ok: false, error: 'redirect resolution timed out' };
    const res = await fetchHead(current, perHopTimeoutMs, deps);
    if (res.error) return { ok: false, error: res.error };
    if (res.done) return { ok: true, url: current }; // terminal (2xx/other) -- this is the resolved URL
    // A redirect: resolve Location to absolute against the current hop, re-guard.
    let absolute;
    try { absolute = new URL(res.location, current).toString(); } catch { return { ok: false, error: 'bad redirect location' }; }
    const guard = await guardHop(absolute, deps);
    if (!guard.ok) return { ok: false, error: guard.error };
    current = guard.url;
  }
  return { ok: false, error: 'too many redirects' };
}

// gate W1: only URLs that LOOK like a share shortlink should be redirect-
// resolved -- resolving every universal paste needlessly redirects a canonical
// URL (instagram.com/reel/<id>) into a cookieless login/consent interstitial
// that yt-dlp (with its own cookies-file/API path) would have handled from the
// original. Heuristic, conservative: a `/share/` path segment (Facebook et al),
// or a known URL-shortener host, or a single very-short path segment with no
// query (bit.ly/abc shape). A false negative just means we hand yt-dlp the
// original URL (correct for a direct URL); a false positive is bounded + safe
// (the resolver is SSRF-guarded and falls back to the original on any failure).
const SHORTENER_HOSTS = new Set([
  'fb.me', 't.co', 'bit.ly', 'tinyurl.com', 'ow.ly', 'buff.ly', 'goo.gl',
  'dlvr.it', 'youtu.be', 'vt.tiktok.com', 'redd.it', 'trib.al',
]);
function isLikelyShortlink(urlStr) {
  let u;
  try { u = new URL(urlStr); } catch { return false; }
  const host = u.hostname.toLowerCase();
  if (SHORTENER_HOSTS.has(host)) return true;
  if (/(^|\/)share(\/|$)/i.test(u.pathname)) return true; // facebook.com/share/r/<id>
  // Deliberately NOT a generic "short single path segment" heuristic -- that
  // matches canonical id URLs (vimeo.com/76979871) and would needlessly
  // redirect-resolve them into login walls (gate W1). A generic unknown
  // shortener just gets handed to yt-dlp as-is (rare; user can paste the
  // resolved URL). Known shorteners are the SHORTENER_HOSTS allowlist above.
  return false;
}

module.exports = { resolveShortlink, hostResolvesPublic, guardHop, isLikelyShortlink };
