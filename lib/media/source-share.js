'use strict';

// v1.337 (Dean, 2026-09-25: "a share button that basically just shares the logged URL of whatever it
// is that we captured"; his 2026-09-26 ruling: the WATCH PAGE only, read from the file itself, nothing
// new stored). Plan: docs/exec-plans/active/2026-09-26-share-any-download.md.
//
// A yt-dlp download from a site other than YouTube (an item carrying `sourceExtractor`) has no
// `youtubeId`, so the watch route derives no `watchUrl` and the page showed no Share. The library does
// not store its page URL, but every download runs with `--embed-metadata`, and yt-dlp writes the page
// URL (`webpage_url`) into the file's `purl` and `comment` tags (yt_dlp/postprocessor/ffmpeg.py,
// `add(('purl', 'comment'), 'webpage_url')`). server.js's probeEmbeddedTags already reads it
// (parseEmbeddedSourceUrl: purl, then comment). This module turns that into the watch page's
// `sourceShareUrl`: validated, cached per file, time-limited, and never throwing.

const SOURCE_SHARE_URL_MAX = 2048;
const SOURCE_SHARE_CACHE_MAX = 500;
const SOURCE_SHARE_PROBE_TIMEOUT_MS = 1500;

// The URL is DATA read from a file on disk, so it is re-checked before it reaches a page: an absolute
// http(s) URL that parses, with no credentials, no whitespace or control characters, and a sane length.
// Returns the URL string or null. Pure.
function sanitizeSourceShareUrl(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (s === '' || s.length > SOURCE_SHARE_URL_MAX) return null;
  if (/\s/.test(s)) return null;
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return null; // control characters
  }
  if (!/^https?:\/\//i.test(s)) return null;
  let u;
  try { u = new URL(s); } catch (_) { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  if (!u.hostname) return null;
  return s;
}

// Whether the watch route should look for a source link at all: a yt-dlp download from another site
// (the scan writes `sourceExtractor` only for those) that has no YouTube link of its own. Pure.
function wantsSourceShareUrl(item, watchUrl) {
  if (!item || typeof item !== 'object') return false;
  if (typeof watchUrl === 'string' && watchUrl !== '') return false;
  if (typeof item.sourceExtractor !== 'string' || item.sourceExtractor === '') return false;
  return typeof item.filePath === 'string' && item.filePath !== '';
}

// deps: { probe(filePath) -> Promise<{ sourceUrl } | null> (server.js probeEmbeddedTags),
//         stat(filePath) -> Promise<{ size, mtimeMs }> (fs.promises.stat),
//         timeoutMs?, cacheMax? }
// resolve(item) -> Promise<string | null>; never rejects. A file whose size or mtime changed is read
// again; a FAILED probe (null) is not cached, so a transient ffprobe hiccup does not stick.
function createSourceShareResolver(deps) {
  const probe = deps && deps.probe;
  const stat = deps && deps.stat;
  const timeoutMs = (deps && Number.isFinite(deps.timeoutMs)) ? deps.timeoutMs : SOURCE_SHARE_PROBE_TIMEOUT_MS;
  const cacheMax = (deps && Number.isFinite(deps.cacheMax)) ? deps.cacheMax : SOURCE_SHARE_CACHE_MAX;
  const cache = new Map(); // filePath -> { size, mtimeMs, url }

  function withTimeout(p) {
    let timer = null;
    const limit = new Promise((resolve) => { timer = setTimeout(() => resolve(undefined), timeoutMs); });
    return Promise.race([Promise.resolve(p), limit]).finally(() => clearTimeout(timer));
  }

  async function resolve(item) {
    if (typeof probe !== 'function' || typeof stat !== 'function') return null;
    const filePath = item && item.filePath;
    if (typeof filePath !== 'string' || filePath === '') return null;
    let st;
    try { st = await stat(filePath); } catch (_) { return null; }
    if (!st) return null;
    const hit = cache.get(filePath);
    if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs) {
      cache.delete(filePath); cache.set(filePath, hit); // most recently used last
      return hit.url;
    }
    let tags;
    try { tags = await withTimeout(probe(filePath)); } catch (_) { return null; }
    if (tags === undefined || tags === null) return null; // timed out or the probe failed: retry next time
    const url = sanitizeSourceShareUrl(tags && tags.sourceUrl);
    cache.delete(filePath);
    cache.set(filePath, { size: st.size, mtimeMs: st.mtimeMs, url });
    while (cache.size > cacheMax) cache.delete(cache.keys().next().value);
    return url;
  }

  return { wants: wantsSourceShareUrl, resolve, _cacheSize: () => cache.size };
}

module.exports = {
  sanitizeSourceShareUrl,
  wantsSourceShareUrl,
  createSourceShareResolver,
  SOURCE_SHARE_URL_MAX,
  SOURCE_SHARE_CACHE_MAX,
  SOURCE_SHARE_PROBE_TIMEOUT_MS,
};
