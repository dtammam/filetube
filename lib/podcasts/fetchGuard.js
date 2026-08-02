'use strict';

// v1.69.0 (podcasts): the outbound HTTP surface - feed fetch + enclosure
// download. Built on the lib/ytdlp/shortlink.js safety envelope (guardHop:
// http(s)-only, no userinfo, literal private/loopback-IP reject, DNS
// resolve-then-check that fails CLOSED), applied to the START URL and to
// EVERY redirect hop - enclosure URLs come out of the FEED and are hostile
// even when the feed URL is trusted (exec plan attack surface 2). Redirects
// are followed MANUALLY, never by the client (auto-follow would bypass the
// per-hop guard); Patreon serves a 302 to its CDN on every enclosure, so
// hop-following is a hard requirement, not a nicety.
//
// Known inherited residual (DISCLOSED, tech-debt): TOCTOU DNS rebinding
// between the resolve-check and the connect - same posture as shortlink.js.
//
// Streaming discipline (the 42 GB backfill reality):
//  - The enclosure body streams to `<destDir>/.<final>.ptpart`, fsyncs, and
//    atomically renames onto the final name ONLY on transport-complete
//    success with > 0 bytes and a 2xx. The feed's `length` attr is advisory
//    and never a completion check.
//  - Any failure unlinks the .ptpart (at-most-one-partial invariant).
//  - Hard caps: body byte ceiling with mid-stream abort, an ABSOLUTE
//    wall-clock deadline (an inactivity timeout alone lets a dribbling
//    server hold a connection forever - the shortlink.js lesson), plus an
//    idle timeout.
//  - deps injectable ({http, https, lookup, now, fsImpl}) - the whole module
//    is unit-testable with fake transports, no network.

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const { guardHop } = require('../ytdlp/shortlink');

const FEED_MAX_HOPS = 5;
const FEED_PER_HOP_TIMEOUT_MS = 10_000;
const FEED_TOTAL_TIMEOUT_MS = 30_000;
const FEED_MAX_BODY_BYTES = 25 * 1024 * 1024;

const ENCLOSURE_MAX_HOPS = 5;
const ENCLOSURE_IDLE_TIMEOUT_MS = 30_000;
const ENCLOSURE_TOTAL_TIMEOUT_MS = 60 * 60 * 1000; // one hour per episode
const ENCLOSURE_MAX_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB

// A neutral, honest UA. Patreon's feed endpoints serve podcast clients; no
// browser masquerade is needed (verified live 2026-08-02).
const USER_AGENT = 'FileTube-Podcasts/1.0 (+self-hosted media server)';

function isRedirect(status) {
  return status >= 300 && status < 400;
}

/**
 * One manual GET returning the live response object (caller owns draining/
 * destroying it) or a redirect location, or an error. Never throws.
 */
function requestOnce(urlStr, timeoutMs, deps) {
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
        headers: { 'user-agent': USER_AGENT, accept: '*/*' },
      }, (res) => {
        const status = res.statusCode || 0;
        const location = res.headers && res.headers.location;
        if (isRedirect(status) && typeof location === 'string' && location !== '') {
          res.destroy(); // never read a redirect body
          done({ location });
          return;
        }
        done({ res, status });
      });
    } catch { done({ error: 'request threw' }); return; }
    req.setTimeout(timeoutMs, () => { req.destroy(); done({ error: 'timeout' }); });
    req.on('error', () => done({ error: 'request error' }));
    req.end();
  });
}

/**
 * Resolve redirects with per-hop guarding until a terminal response.
 * Resolves { res, status, finalUrl } | { error }. The caller MUST consume
 * or destroy `res`.
 */
async function guardedGet(startUrl, { maxHops, perHopTimeoutMs, deadline, deps }) {
  const startGuard = await guardHop(startUrl, deps);
  if (!startGuard.ok) return { error: startGuard.error };
  let current = startGuard.url;
  for (let hop = 0; hop < maxHops; hop++) {
    if (deps.now() > deadline) return { error: 'timed out' };
    const r = await requestOnce(current, perHopTimeoutMs, deps);
    if (r.error) return { error: r.error };
    if (r.location !== undefined) {
      let absolute;
      try { absolute = new URL(r.location, current).toString(); } catch { return { error: 'bad redirect location' }; }
      const guard = await guardHop(absolute, deps);
      if (!guard.ok) return { error: guard.error };
      current = guard.url;
      continue;
    }
    return { res: r.res, status: r.status, finalUrl: current };
  }
  return { error: 'too many redirects' };
}

/**
 * Fetch a feed document. `feedUrl` must already have passed validateFeedUrl.
 * Resolves { ok:true, body, finalUrl } | { ok:false, error }. Error strings
 * are transport-shaped ('timeout', 'redirect target is a private/local
 * host', 'HTTP 403', ...) and NEVER contain the URL - the caller composes
 * redacted status lines from known-good pieces only.
 */
async function fetchFeed(feedUrl, opts = {}) {
  const deps = { http: opts.http, https: opts.https, lookup: opts.lookup, now: opts.now || (() => Date.now()) };
  const totalMs = Number.isInteger(opts.totalTimeoutMs) ? opts.totalTimeoutMs : FEED_TOTAL_TIMEOUT_MS;
  const perHopMs = Number.isInteger(opts.perHopTimeoutMs) ? opts.perHopTimeoutMs : FEED_PER_HOP_TIMEOUT_MS;
  const maxBytes = Number.isInteger(opts.maxBodyBytes) ? opts.maxBodyBytes : FEED_MAX_BODY_BYTES;
  const deadline = deps.now() + totalMs;

  const got = await guardedGet(feedUrl, { maxHops: FEED_MAX_HOPS, perHopTimeoutMs: perHopMs, deadline, deps });
  if (got.error) return { ok: false, error: got.error };
  const { res, status, finalUrl } = got;
  if (status < 200 || status >= 300) {
    res.destroy();
    return { ok: false, error: `HTTP ${status}` };
  }
  return await new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; clearTimeout(wall); res.destroy(); resolve(v); } };
    // Absolute wall-clock deadline for the whole body read - a dribbling
    // server cannot hold this open past `deadline`.
    const wall = setTimeout(() => done({ ok: false, error: 'timed out' }), Math.max(1, deadline - deps.now()));
    if (wall.unref) wall.unref();
    const chunks = [];
    let bytes = 0;
    res.on('data', (c) => {
      bytes += c.length;
      if (bytes > maxBytes) { done({ ok: false, error: 'feed too large' }); return; }
      chunks.push(c);
    });
    res.on('end', () => done({ ok: true, body: Buffer.concat(chunks).toString('utf8'), finalUrl }));
    res.on('error', () => done({ ok: false, error: 'read error' }));
  });
}

/**
 * Download an enclosure to `<destDir>/<finalName>`, streaming through the
 * dot-prefixed .ptpart temp. Structural confinement re-asserted here: both
 * paths must resolve inside destDir (paths.js already guarantees the name
 * is safe; this is the second, structural line).
 * Resolves { ok:true, filePath, bytes } | { ok:false, error }.
 */
async function downloadEnclosure(enclosureUrl, destDir, finalName, opts = {}) {
  const deps = { http: opts.http, https: opts.https, lookup: opts.lookup, now: opts.now || (() => Date.now()) };
  const fsImpl = opts.fsImpl || fs;
  const idleMs = Number.isInteger(opts.idleTimeoutMs) ? opts.idleTimeoutMs : ENCLOSURE_IDLE_TIMEOUT_MS;
  const totalMs = Number.isInteger(opts.totalTimeoutMs) ? opts.totalTimeoutMs : ENCLOSURE_TOTAL_TIMEOUT_MS;
  const maxBytes = Number.isInteger(opts.maxBytes) ? opts.maxBytes : ENCLOSURE_MAX_BYTES;
  const deadline = deps.now() + totalMs;

  const root = path.resolve(destDir);
  const finalPath = path.resolve(root, finalName);
  const partPath = path.resolve(root, `.${finalName}.ptpart`);
  if (!finalPath.startsWith(root + path.sep) || !partPath.startsWith(root + path.sep)) {
    return { ok: false, error: 'refusing a destination outside the show directory' };
  }

  const got = await guardedGet(enclosureUrl, { maxHops: ENCLOSURE_MAX_HOPS, perHopTimeoutMs: idleMs, deadline, deps });
  if (got.error) return { ok: false, error: got.error };
  const { res, status } = got;
  if (status < 200 || status >= 300) {
    res.destroy();
    return { ok: false, error: `HTTP ${status}` };
  }

  return await new Promise((resolve) => {
    let settled = false;
    let bytes = 0;
    let out;
    const cleanupFail = (error) => {
      if (settled) return;
      settled = true;
      clearInterval(ticker);
      res.destroy();
      const finish = () => {
        try { fsImpl.unlinkSync(partPath); } catch { /* best-effort */ }
        resolve({ ok: false, error });
      };
      if (out) out.close(finish); else finish();
    };
    const succeed = () => {
      if (settled) return;
      settled = true;
      clearInterval(ticker);
      // fsync-then-rename: the finished bytes are durable BEFORE the name
      // flips; a crash leaves either a .ptpart (swept later) or the
      // complete final file - never a truncated final file.
      out.close((closeErr) => {
        if (closeErr) {
          try { fsImpl.unlinkSync(partPath); } catch { /* best-effort */ }
          resolve({ ok: false, error: 'write error' });
          return;
        }
        try {
          const fd = fsImpl.openSync(partPath, 'r');
          try { fsImpl.fsyncSync(fd); } finally { fsImpl.closeSync(fd); }
          fsImpl.renameSync(partPath, finalPath);
          resolve({ ok: true, filePath: finalPath, bytes });
        } catch {
          try { fsImpl.unlinkSync(partPath); } catch { /* best-effort */ }
          resolve({ ok: false, error: 'finalize error' });
        }
      });
    };

    try {
      out = fsImpl.createWriteStream(partPath, { flags: 'w' });
    } catch {
      res.destroy();
      resolve({ ok: false, error: 'cannot open temp file' });
      return;
    }
    out.on('error', () => cleanupFail('write error'));

    let lastData = deps.now();
    // One ticker enforces BOTH the idle timeout and the absolute deadline.
    const ticker = setInterval(() => {
      if (deps.now() > deadline) { cleanupFail('timed out'); return; }
      if (deps.now() - lastData > idleMs) cleanupFail('stalled');
    }, 1000);
    if (ticker.unref) ticker.unref();

    res.on('data', (c) => {
      lastData = deps.now();
      bytes += c.length;
      if (bytes > maxBytes) { cleanupFail('enclosure exceeds the size cap'); return; }
      out.write(c);
    });
    res.on('end', () => {
      if (bytes === 0) { cleanupFail('empty response'); return; }
      out.end(() => succeed());
    });
    res.on('error', () => cleanupFail('read error'));
  });
}

module.exports = {
  fetchFeed,
  downloadEnclosure,
  guardedGet,
  FEED_MAX_HOPS,
  FEED_MAX_BODY_BYTES,
  ENCLOSURE_MAX_BYTES,
  ENCLOSURE_IDLE_TIMEOUT_MS,
  ENCLOSURE_TOTAL_TIMEOUT_MS,
  USER_AGENT,
};
