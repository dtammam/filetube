'use strict';

// lib/pages/fetch.js - every outbound request Pages makes: the page a bare link
// names, and each image, stylesheet and font a capture stores. ALL of them go
// through the podcasts' fetch guard (lib/podcasts/fetchGuard.js guardedGet, on
// lib/ytdlp/shortlink.js guardHop): http(s) only, no userinfo, private/loopback
// refused by literal AND by DNS resolve-then-check (failing closed), every
// redirect hop re-checked, a hop cap, a per-hop and an absolute wall-clock
// deadline. Here: a byte cap with a mid-stream abort, and nothing is ever
// written to disk by this module (the caller stores the bytes it keeps).
//
// DNS rebinding between that check and the connect is closed: the socket resolves
// through fetchGuard's checkedLookup, which refuses a private answer too (v1.395.0).

const { guardedGet } = require('../podcasts/fetchGuard');

const PAGE_MAX_BYTES = 10 * 1024 * 1024;
const PAGE_TOTAL_TIMEOUT_MS = 30000;
const ASSET_MAX_BYTES = 10 * 1024 * 1024;
const ASSET_TOTAL_TIMEOUT_MS = 20000;
const PER_HOP_TIMEOUT_MS = 10000;
const MAX_HOPS = 5;
// Sites refuse an unknown agent more often than a reader's; this names itself.
const USER_AGENT = 'Mozilla/5.0 (compatible; FileTube-Pages/1.0; +self-hosted reader)';

// Resolves { ok:true, body: Buffer, contentType, finalUrl, status } | { ok:false, error }.
// Never throws. `deps` = { http, https, lookup, now } (tests inject fakes).
async function guardedFetch(url, { maxBytes = ASSET_MAX_BYTES, totalTimeoutMs = ASSET_TOTAL_TIMEOUT_MS, accept = '*/*', deps = {} } = {}) {
  const d = {
    http: deps.http,
    https: deps.https,
    lookup: deps.lookup,
    now: deps.now || (() => Date.now()),
    headers: { 'user-agent': USER_AGENT, accept, 'accept-language': 'en;q=0.9, *;q=0.5' },
  };
  const deadline = d.now() + totalTimeoutMs;
  let got;
  try {
    got = await guardedGet(url, { maxHops: MAX_HOPS, perHopTimeoutMs: Math.min(PER_HOP_TIMEOUT_MS, totalTimeoutMs), deadline, deps: d });
  } catch {
    return { ok: false, error: 'request failed' };
  }
  if (got.error) return { ok: false, error: got.error };
  const { res, status, finalUrl } = got;
  if (status < 200 || status >= 300) {
    res.destroy();
    return { ok: false, error: `HTTP ${status}` };
  }
  const contentType = String((res.headers && res.headers['content-type']) || '').toLowerCase();
  const declared = Number(res.headers && res.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes) {
    res.destroy();
    return { ok: false, error: 'too large' };
  }
  return await new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; clearTimeout(wall); res.destroy(); resolve(v); } };
    const wall = setTimeout(() => done({ ok: false, error: 'timed out' }), Math.max(1, deadline - d.now()));
    if (wall.unref) wall.unref();
    const chunks = [];
    let bytes = 0;
    res.on('data', (c) => {
      bytes += c.length;
      if (bytes > maxBytes) { done({ ok: false, error: 'too large' }); return; }
      chunks.push(c);
    });
    res.on('end', () => done({ ok: true, body: Buffer.concat(chunks), contentType, finalUrl, status }));
    res.on('error', () => done({ ok: false, error: 'read error' }));
  });
}

// The page a bare link names: HTML only.
async function fetchPage(url, opts = {}) {
  const r = await guardedFetch(url, { maxBytes: PAGE_MAX_BYTES, totalTimeoutMs: PAGE_TOTAL_TIMEOUT_MS, accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', deps: opts.deps });
  if (!r.ok) return r;
  if (r.contentType && !/^(text\/html|application\/xhtml\+xml|text\/plain)\b/.test(r.contentType)) {
    return { ok: false, error: `not a web page (${r.contentType.split(';')[0].slice(0, 60)})` };
  }
  return { ok: true, html: decodeHtml(r.body, r.contentType), finalUrl: r.finalUrl, contentType: r.contentType };
}

// Bytes -> text: the header's charset, else a <meta charset> / http-equiv in the
// first 2 KB, else UTF-8. An unknown label falls back to UTF-8 (never throws).
function decodeHtml(buf, contentType = '') {
  let label = /charset\s*=\s*"?([A-Za-z0-9._:-]+)/i.exec(contentType || '');
  label = label ? label[1] : null;
  if (!label) {
    const head = buf.subarray(0, 2048).toString('latin1');
    const m = /<meta[^>]+charset\s*=\s*["']?\s*([A-Za-z0-9._:-]+)/i.exec(head);
    if (m) label = m[1];
  }
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) label = 'utf-8';
  try {
    return new TextDecoder(label || 'utf-8').decode(buf);
  } catch {
    return new TextDecoder('utf-8').decode(buf);
  }
}

module.exports = { guardedFetch, fetchPage, decodeHtml, PAGE_MAX_BYTES, ASSET_MAX_BYTES, USER_AGENT };
