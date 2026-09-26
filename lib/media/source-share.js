'use strict';

// v1.337 (Dean, 2026-09-25: "a share button that basically just shares the logged URL of whatever it
// is that we captured"). Plan: docs/exec-plans/completed/2026-09-26-share-any-download.md.
// v1.338 (plan first-class-any-site D1/D5) superseded v1.337's "watch page only, nothing new stored":
// the library now SAVES the page link as the item's `sourceUrl` (captured at download, backfilled by the
// scan), and every list serves it as `sourceShareUrl` through `sanitizeSourceShareUrl` below. The file
// probe here is the watch page's FALLBACK for an item with no saved link.
//
// A yt-dlp download from a site other than YouTube (an item carrying `sourceExtractor` and no YouTube
// link) has no `watchUrl`. Every download runs with `--embed-metadata`, and yt-dlp writes the page URL (`webpage_url`)
// into the file's `purl` and `comment` tags (yt_dlp/postprocessor/ffmpeg.py,
// `add(('purl', 'comment'), 'webpage_url')`). Where it lands depends on the container: an MP4 keeps
// only `comment` (the muxer drops `purl` without `+use_metadata_tags`), MKV / WebM / MP3 / M4A keep
// them at the FILE level, and Ogg (an Opus download) keeps them per STREAM - so both levels are read.
// The probe turns that into the watch page's fallback `sourceShareUrl`: validated, cached per file, one probe
// per file at a time, time-limited for the page, and never throwing.

const SOURCE_SHARE_URL_MAX = 2048;
const SOURCE_SHARE_CACHE_MAX = 500;
const SOURCE_SHARE_WAIT_MS = 1500; // how long a watch page load waits for a first read of a file

// The URL is DATA read from a file on disk (or a site's own page URL), so it is re-checked before it
// reaches a page or a share sheet: an absolute http(s) URL with a non-empty authority and NO userinfo
// (no `@` there at all), no whitespace, no control or invisible format characters (C0, C1, bidi
// overrides and isolates, zero-width), no backslash (parsers disagree on it), and a sane length.
// Returns the PARSED form (`URL.href`, so a non-ASCII host becomes its punycode) or null. Pure.
function sanitizeSourceShareUrl(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (s === '' || s.length > SOURCE_SHARE_URL_MAX) return null;
  if (/[\p{Cc}\p{Cf}\s\\]/u.test(s)) return null;
  const authority = /^https?:\/\/([^/?#]*)/i.exec(s);
  if (!authority || authority[1] === '' || authority[1].includes('@')) return null;
  let u;
  try { u = new URL(s); } catch (_) { return null; }
  return u.href.length > SOURCE_SHARE_URL_MAX ? null : u.href;
}

// The page URL in an ffprobe `-show_entries format_tags:stream_tags` JSON: the file-level `purl`, then
// `comment`, then each stream's `purl` / `comment` (Ogg). Tag names compared case-insensitively (MKV
// writes them upper-case). The first http(s) candidate wins; it is sanitized by the caller. Pure.
function sourceUrlFromProbeJson(j) {
  if (!j || typeof j !== 'object') return null;
  const lower = (tags) => {
    const out = {};
    if (!tags || typeof tags !== 'object') return out;
    for (const k of Object.keys(tags)) {
      const v = tags[k];
      if (typeof v === 'string' && v.trim()) out[k.toLowerCase()] = v.trim();
    }
    return out;
  };
  const levels = [lower(j.format && j.format.tags)];
  if (Array.isArray(j.streams)) for (const st of j.streams) levels.push(lower(st && st.tags));
  for (const t of levels) {
    for (const c of [t.purl, t.comment]) {
      if (typeof c === 'string' && /^https?:\/\//i.test(c)) return c;
    }
  }
  return null;
}

// Whether the watch route should look for a source link at all: an item the scan gave a
// `sourceExtractor` (yt-dlp's `[Extractor=id]` downloads - a proxy-host YouTube one too, but that one
// also gets a `youtubeId`, so its YouTube link wins here) with a file and no YouTube link. Pure.
function wantsSourceShareUrl(item, watchUrl) {
  if (!item || typeof item !== 'object') return false;
  if (typeof watchUrl === 'string' && watchUrl !== '') return false;
  if (typeof item.sourceExtractor !== 'string' || item.sourceExtractor === '') return false;
  return typeof item.filePath === 'string' && item.filePath !== '';
}

// v1.338 (Dean: "anything that can and is grabbed should be kind of treated and formed the same way";
// plan 2026-09-26-first-class-any-site D5): the SAVED page link a list serves as `sourceShareUrl` - the
// item's `sourceUrl`, re-checked at every serve (a backup restore can plant any string), for exactly
// the items the watch route would look up (a non-YouTube download with no YouTube link). undefined
// otherwise, so a caller spreads it only when present. Pure.
function savedSourceShareUrl(item, watchUrl) {
  if (!wantsSourceShareUrl(item, watchUrl)) return undefined;
  return sanitizeSourceShareUrl(item.sourceUrl) || undefined;
}

// deps: { probe(filePath) -> Promise<{ sourceUrl } | null> (server.js probeSourceShareUrl: ONE
//           ffprobe, hard-killed at its own cap; null = the probe failed),
//         stat(filePath) -> Promise<{ size, mtimeMs }> (fs.promises.stat),
//         waitMs?, cacheMax? }
// resolve(item) -> Promise<string | null>; never rejects, and answers within about waitMs for the
// stat plus waitMs for the probe. A file is statted and probed at most ONCE at a time: a second load
// of the same file joins the one in flight, and a probe that outlives the wait still fills the cache
// when it finishes (so slow storage shows Share on a later load instead of never). A file whose size or
// mtime changed is read again; a FAILED probe (null) is not cached, so a transient hiccup does not stick.
function createSourceShareResolver(deps) {
  const probe = deps && deps.probe;
  const stat = deps && deps.stat;
  const waitMs = (deps && Number.isFinite(deps.waitMs)) ? deps.waitMs : SOURCE_SHARE_WAIT_MS;
  const cacheMax = (deps && Number.isFinite(deps.cacheMax)) ? deps.cacheMax : SOURCE_SHARE_CACHE_MAX;
  const cache = new Map(); // filePath -> { size, mtimeMs, url }
  const statsInFlight = new Map(); // filePath -> Promise<stat | null>
  const probesInFlight = new Map(); // filePath -> Promise<string | null | undefined> (undefined = not cached)
  const TIMED_OUT = Symbol('timed out');

  function within(p) {
    let timer = null;
    const limit = new Promise((res) => { timer = setTimeout(() => res(TIMED_OUT), waitMs); });
    return Promise.race([p, limit]).finally(() => clearTimeout(timer));
  }

  function statOnce(filePath) {
    if (statsInFlight.has(filePath)) return statsInFlight.get(filePath);
    const p = Promise.resolve().then(() => stat(filePath)).catch(() => null)
      .finally(() => statsInFlight.delete(filePath));
    statsInFlight.set(filePath, p);
    return p;
  }

  function probeOnce(filePath, key) {
    if (probesInFlight.has(filePath)) return probesInFlight.get(filePath);
    const p = Promise.resolve().then(() => probe(filePath)).catch(() => null).then((tags) => {
      if (tags === null || tags === undefined) return undefined; // the probe failed: not an answer
      const url = sanitizeSourceShareUrl(tags && tags.sourceUrl);
      cache.delete(filePath);
      cache.set(filePath, { size: key.size, mtimeMs: key.mtimeMs, url });
      while (cache.size > cacheMax) cache.delete(cache.keys().next().value);
      return url;
    }).finally(() => probesInFlight.delete(filePath));
    probesInFlight.set(filePath, p);
    return p;
  }

  async function resolve(item) {
    if (typeof probe !== 'function' || typeof stat !== 'function') return null;
    const filePath = item && item.filePath;
    if (typeof filePath !== 'string' || filePath === '') return null;
    const st = await within(statOnce(filePath));
    if (!st || st === TIMED_OUT) return null;
    const hit = cache.get(filePath);
    if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs) {
      cache.delete(filePath); cache.set(filePath, hit); // most recently used last
      return hit.url;
    }
    const url = await within(probeOnce(filePath, { size: st.size, mtimeMs: st.mtimeMs }));
    if (url === TIMED_OUT || url === undefined) return null;
    return url;
  }

  return {
    wants: wantsSourceShareUrl,
    saved: savedSourceShareUrl,
    resolve,
    _cacheSize: () => cache.size,
    _inFlight: () => probesInFlight.size,
  };
}

module.exports = {
  sanitizeSourceShareUrl,
  sourceUrlFromProbeJson,
  wantsSourceShareUrl,
  savedSourceShareUrl,
  createSourceShareResolver,
  SOURCE_SHARE_URL_MAX,
  SOURCE_SHARE_CACHE_MAX,
  SOURCE_SHARE_WAIT_MS,
};
