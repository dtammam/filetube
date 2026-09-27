'use strict';

// lib/music/artRendition.js - SIZED album-art renditions for the /albumart route
// (v1.339 L1, plan docs/exec-plans/active/2026-09-26-fouc-toctou-audit.md, M2 / D4).
//
// The stored album art is the file extractAlbumArt wrote at native size (a 1200px
// cover is common), and every Music tile - 44px song thumbs, 108px cards - used to
// download and decode all of it. `/albumart/:id?s=<px>` serves a rendition instead:
// the source scaled so its SHORT side is <px> (never upscaled), cached on disk and
// generated lazily on the first request for that source + size.
//
// Contract:
//   - Only the ALLOWLISTED sizes (ART_RENDITION_SIZES) exist; anything else is not a
//     rendition request (the route serves the original), so a client cannot mint an
//     unbounded set of cache files.
//   - Cache file = <dir>/<cacheKey>-<size>.jpg, where cacheKey is a safe token (the
//     album's albumArtKey md5, or `t-<media id>` for a library-audio thumbnail). A
//     cache file OLDER than its source is stale (the art was re-extracted) and is
//     regenerated.
//   - Written tmp + rename, so a reader never sees a half-written file.
//   - SINGLE-FLIGHT per key + size: concurrent requests join one ffmpeg (LESSONS 11,
//     "a per-REQUEST child process needs single-flight, a hard kill and the late
//     answer kept"); execFile `timeout` + `killSignal: 'SIGKILL'` so a wedged ffmpeg
//     never outlives its budget; a job that outlives a caller's patience still
//     fills the cache (the caller simply is not waiting).
//   - Every failure (ffmpeg absent, a non-zero exit, a timeout, an empty output, a
//     stat/rename error) FALLS BACK to the original file, never an error response.
//     A failed key + size is remembered for FAILURE_RETRY_MS so a missing or broken
//     ffmpeg is not re-spawned on every tile request.

const ART_RENDITION_SIZES = Object.freeze([128, 256, 512]);
// A rendition job's hard budget. A cover scale is ~50ms of ffmpeg; 15s only bounds
// a wedged process (slow storage, a pathological file) before SIGKILL.
const RENDITION_TIMEOUT_MS = 15000;
// After a failed job, serve the original for this long before trying ffmpeg again.
const FAILURE_RETRY_MS = 10 * 60 * 1000;
const SAFE_KEY = /^[A-Za-z0-9_-]{1,128}$/;

// The requested size, or null when `raw` is not EXACTLY one allowlisted size
// (a query string arrives as a string; `?s=256abc`, `?s=0256`, arrays, 300 = null).
function parseArtSize(raw) {
  if (typeof raw !== 'string' || !/^[1-9][0-9]{0,3}$/.test(raw)) return null;
  const n = Number(raw);
  return ART_RENDITION_SIZES.includes(n) ? n : null;
}

// The rendition cache directory for an album-art directory (a sub-directory, so the
// `<key>.jpg` / `<key>.png` originals and their orphan prune never see a rendition).
function renditionDirFor(albumArtDir, path) {
  return path.join(albumArtDir, 'sized');
}

function renditionPath(dir, cacheKey, size, path) {
  return path.join(dir, `${cacheKey}-${size}.jpg`);
}

// Every rendition path a cache key can have (the scan's orphan prune unlinks them).
function renditionPathsFor(dir, cacheKey, path) {
  return ART_RENDITION_SIZES.map((s) => renditionPath(dir, cacheKey, s, path));
}

// ffmpeg arguments: scale the SHORT side to `size`, never upscale, even dimensions.
// width = min(iw, max(size, size*iw/ih)): a landscape source gets its height to
// `size`, a portrait/square one its width; `h=-2` keeps the aspect. Commas inside
// the expression are filtergraph-escaped (execFile passes argv verbatim, no shell).
function buildRenditionArgs(src, out, size) {
  const w = `min(iw\\,max(${size}\\,${size}*iw/ih))`;
  return ['-v', 'error', '-i', src, '-frames:v', '1', '-vf', `scale=w=${w}:h=-2`, '-q:v', '4', '-y', out];
}

function createArtRenditions(deps) {
  const { dir, fs, path, execFile, ffmpegIsAvailable, now = () => Date.now() } = deps;
  const inFlight = new Map(); // `${cacheKey}-${size}` -> Promise<boolean>
  const failedAt = new Map(); // `${cacheKey}-${size}` -> ms of the last failure
  let spawnCount = 0;

  function statOrNull(p) {
    try { return fs.statSync(p); } catch (_) { return null; }
  }

  function runJob(src, out, size) {
    return new Promise((resolve) => {
      try { fs.mkdirSync(dir, { recursive: true }); } catch (_) { /* surfaces as a failed write below */ }
      const tmp = `${out}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp.jpg`;
      const cleanup = () => { try { fs.unlinkSync(tmp); } catch (_) { /* absent */ } };
      spawnCount += 1;
      // A spawn failure (ENOENT: no ffmpeg) arrives through the callback as `err`.
      try {
        execFile('ffmpeg', buildRenditionArgs(src, tmp, size),
          { timeout: RENDITION_TIMEOUT_MS, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 },
          (err) => {
            if (err) { cleanup(); resolve(false); return; }
            const st = statOrNull(tmp);
            if (!st || st.size === 0) { cleanup(); resolve(false); return; }
            try { fs.renameSync(tmp, out); resolve(true); } catch (_) { cleanup(); resolve(false); }
          });
      } catch (_) { cleanup(); resolve(false); }
    });
  }

  // Resolve the file to serve for `src` at `size`: the (possibly freshly generated)
  // rendition, or `src` itself on any failure. Never rejects.
  async function resolve(src, cacheKey, size) {
    if (!ART_RENDITION_SIZES.includes(size) || typeof cacheKey !== 'string' || !SAFE_KEY.test(cacheKey)) return src;
    const srcStat = statOrNull(src);
    if (!srcStat) return src;
    const out = renditionPath(dir, cacheKey, size, path);
    const outStat = statOrNull(out);
    if (outStat && outStat.size > 0 && outStat.mtimeMs >= srcStat.mtimeMs) return out;
    if (typeof ffmpegIsAvailable === 'function' && !ffmpegIsAvailable()) return src;
    const jobKey = `${cacheKey}-${size}`;
    const lastFail = failedAt.get(jobKey);
    if (lastFail !== undefined && now() - lastFail < FAILURE_RETRY_MS) return src;
    let job = inFlight.get(jobKey);
    if (!job) {
      job = runJob(src, out, size).then((ok) => {
        inFlight.delete(jobKey);
        if (ok) failedAt.delete(jobKey); else failedAt.set(jobKey, now());
        return ok;
      });
      inFlight.set(jobKey, job);
    }
    const ok = await job;
    return ok ? out : src;
  }

  return {
    resolve,
    // Test/diagnostic seams: how many ffmpeg jobs this instance started, and how many
    // are running now.
    spawnCount: () => spawnCount,
    inFlightCount: () => inFlight.size,
  };
}

module.exports = {
  ART_RENDITION_SIZES,
  RENDITION_TIMEOUT_MS,
  FAILURE_RETRY_MS,
  parseArtSize,
  renditionDirFor,
  renditionPath,
  renditionPathsFor,
  buildRenditionArgs,
  createArtRenditions,
};
