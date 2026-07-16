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
// A hard cap on the terminal-page body we read to extract a canonical URL
// (Facebook et al serve a JS interstitial with the real /reel/ URL embedded,
// NOT an HTTP redirect). Bounded so a huge/slow body can't DoS the resolver.
const MAX_BODY_BYTES = 512 * 1024;

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

// A share page that HTTP-redirects gives us a Location; one that serves a JS
// interstitial (Facebook) embeds the real content URL in its HTML. Pull the
// canonical URL out of a bounded body: prefer og:url, else a same-host video
// path (/reel/<id>, /watch?v=<id>, /videos/<id>, /v/<id>) built into a
// canonical URL. Returns an absolute URL string or null. Pure, no I/O.
function extractCanonicalUrl(body, currentUrl) {
  if (typeof body !== 'string' || body === '') return null;
  let base;
  try { base = new URL(currentUrl); } catch { return null; }
  // og:url / canonical -- FB's share page points these at the real content.
  const og = /<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i.exec(body)
    || /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:url["']/i.exec(body)
    || /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i.exec(body);
  if (og) {
    try {
      const u = new URL(og[1], base);
      // Only trust an og:url that is a SAME-HOST content path, not a login wall
      // or an off-site link (never follow og:url to an arbitrary host).
      if (u.hostname.toLowerCase() === base.hostname.toLowerCase() && !/\/login|\/consent|\/checkpoint/i.test(u.pathname)) {
        return u.toString();
      }
    } catch { /* fall through to the path heuristic */ }
  }
  // Same-host video path heuristic (FB embeds /reel/<digits> in the page).
  const m = /\/(reel|videos?|v|watch)\/(\d{6,20})/i.exec(body) || /\/watch\/?\?v=(\d{6,20})/i.exec(body);
  if (m) {
    const id = m[2] || m[1];
    const kind = m[2] ? m[1].toLowerCase() : 'watch';
    const pathPart = kind === 'watch' ? `/watch/?v=${id}` : `/${kind}/${id}`;
    return `${base.protocol}//${base.host}${pathPart}`;
  }
  return null;
}

// One hop: GET `urlStr` with manual redirect. Resolves { location } (an
// absolute redirect target) OR { done, status, body } (a terminal response,
// with up to MAX_BODY_BYTES of body ONLY when it looks like HTML) OR { error }.
// `httpImpl`/`httpsImpl` injectable for tests.
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
        // A browser-like UA: some sites (Reddit) 403 an unusual agent and never
        // send the redirect at all -- Dean's reddit.com/.../s/<id> share link
        // 301s to the real /comments/ URL ONLY for a browser UA.
        headers: {
          'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-language': 'en-US,en;q=0.9',
        },
        // NEVER delegate redirect following to the client.
      }, (res) => {
        const status = res.statusCode || 0;
        const location = res.headers && res.headers.location;
        if (status >= 300 && status < 400 && typeof location === 'string' && location !== '') {
          res.destroy(); // a redirect -- never read the body
          done({ location });
          return;
        }
        // A terminal response: read a BOUNDED body ONLY for an html-ish type,
        // to extract an embedded canonical URL (FB's JS interstitial). Abort
        // the moment we exceed the cap. Non-html terminals read nothing.
        const ctype = String((res.headers && res.headers['content-type']) || '').toLowerCase();
        if (!ctype.includes('html')) { res.destroy(); done({ done: true, status }); return; }
        let bytes = 0;
        const chunks = [];
        // Security-check WARNING: the per-hop req.setTimeout is an INACTIVITY
        // timer, so a server dribbling bytes below it could hold the body read
        // open indefinitely. An ABSOLUTE wall-clock deadline on the body read
        // (perHopTimeoutMs) bounds the connection lifetime regardless of drip.
        const finishBody = () => { clearTimeout(bodyDeadline); res.destroy(); done({ done: true, status, body: Buffer.concat(chunks).toString('utf8') }); };
        const bodyDeadline = setTimeout(finishBody, perHopTimeoutMs);
        if (bodyDeadline.unref) bodyDeadline.unref();
        res.on('data', (c) => {
          bytes += c.length;
          if (bytes > MAX_BODY_BYTES) { finishBody(); return; }
          chunks.push(c);
        });
        res.on('end', finishBody);
        res.on('error', finishBody);
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
  let extractedOnce = false;
  for (let hop = 0; hop < maxHops; hop++) {
    if (deps.now() - started > totalTimeoutMs) return { ok: false, error: 'redirect resolution timed out' };
    const res = await fetchHead(current, perHopTimeoutMs, deps);
    if (res.error) return { ok: false, error: res.error };
    if (res.done) {
      // Terminal response. If it's an HTML interstitial (Facebook) with an
      // embedded canonical URL DIFFERENT from the current one, take that as the
      // resolved URL (re-guarded). Only extract ONCE (the extracted URL is a
      // real content page, not another interstitial) so this can't loop.
      if (res.body && !extractedOnce) {
        const canonical = extractCanonicalUrl(res.body, current);
        if (canonical && canonical !== current) {
          const g = await guardHop(canonical, deps);
          if (!g.ok) return { ok: false, error: g.error };
          extractedOnce = true;
          current = g.url;
          continue;
        }
      }
      return { ok: true, url: current };
    }
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
  // Reddit share links: reddit.com/r/<sub>/s/<id> (and /user/<u>/s/<id>) --
  // a `/s/<id>` segment that 301s to the real /comments/ URL RedditIE handles.
  if (/\/s\/[A-Za-z0-9]+\/?$/.test(u.pathname) && /(^|\.)reddit\.com$/.test(host)) return true;
  // Deliberately NOT a generic "short single path segment" heuristic -- that
  // matches canonical id URLs (vimeo.com/76979871) and would needlessly
  // redirect-resolve them into login walls (gate W1). A generic unknown
  // shortener just gets handed to yt-dlp as-is (rare; user can paste the
  // resolved URL). Known shorteners are the SHORTENER_HOSTS allowlist above.
  return false;
}

module.exports = { resolveShortlink, hostResolvesPublic, guardHop, isLikelyShortlink, extractCanonicalUrl };
