'use strict';

// v1.374.0 (d): one cover art for a saved album (plan docs/exec-plans/active/2026-10-08-v1374-music-pass-cover.md,
// rulings R1 and R2, section 3). A playlist saved as an album can name ONE of its videos as the album's cover: every NEW
// track of that job gets that video's thumbnail, cropped to a square, as its embedded cover.
//
// Why a re-embed and not a yt-dlp flag (measured against yt-dlp 2026.08.19): no argv makes every video embed one image.
// So after yt-dlp has finished a track of THIS job, FileTube rewrites the file's cover with ffmpeg:
//   1. the cover is fetched ONCE per job from the FIXED host i.ytimg.com (maxresdefault, then hqdefault; a non-200 is a
//      failure - YouTube answers a missing size with a 404 that still carries a small placeholder JPEG), size-capped and
//      time-bounded, and cropped to a centred square once;
//   2. per track: ffmpeg writes a TEMP file in the SAME directory (so the rename is atomic on one filesystem), stream copy
//      (`-c copy`, the audio is never re-encoded), `-copyts` (without it each mp3 remux moved the chapters 0.023 s);
//   3. ffprobe of the temp must show the audio, the same duration (0.1 s), every tag the original had, the same chapters
//      (0.001 s) and exactly one attached picture - only then is the temp renamed over the file;
//   4. any failure (ffmpeg, ENOSPC, a throw, a file that changed meanwhile) removes the temp and leaves the file as yt-dlp
//      wrote it, with its own art. The download still succeeds.
// The temp name is `.ftcover-<pid>-<hex>.tmp`: not a media extension, so the library scan never indexes it
// (ALL_EXTENSIONS), and a crash between the write and the rename leaves an orphan that the next re-embed in that folder
// removes (`removeOrphanTemps`).
//
// Every child is spawned with execFile (an argv, no shell). The video id is validated by the job's own validator
// (url.isSafeVideoId) and the URL is built here - a URL never comes from the client.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const url = require('./url');

const COVER_HOST = 'https://i.ytimg.com/vi/';
const COVER_SIZES = ['maxresdefault.jpg', 'hqdefault.jpg'];
const COVER_MAX_BYTES = 5 * 1024 * 1024;
const COVER_FETCH_TIMEOUT_MS = 15000;
const FFMPEG_TIMEOUT_MS = 120000;
const PROBE_TIMEOUT_MS = 60000;
const DURATION_TOLERANCE_S = 0.1;
const CHAPTER_TOLERANCE_S = 0.001;
// the tags the verify compares (every one the original had must survive)
const KEPT_TAGS = ['album', 'album_artist', 'track', 'title', 'artist'];
const EMBED_KINDS = { '.mp3': 'mp3', '.m4a': 'm4a' };
const TEMP_NAME_RE = /^\.ftcover-\d+-[0-9a-f]{12}\.tmp$/;

// The seams a test replaces (the network and the two tools). Production: Node's fetch, execFile.
const seams = {
  fetch: (...a) => globalThis.fetch(...a),
  run: (cmd, argv, timeoutMs) => new Promise((resolve) => {
    execFile(cmd, argv, { timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ ok: !err, code: err ? (err.code !== undefined ? err.code : err.signal) : 0, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  }),
};

// The cover id an album may carry: a video id by the job's own rule (the same validator as the job's ids). It need not be
// one of the job's ids - any loaded row can be the cover, ticked or not - because the image host is fixed.
function isValidCoverId(id) {
  return typeof id === 'string' && url.isSafeVideoId(id);
}

// The image URLs for a cover id, best first (null for an invalid id: nothing is ever fetched for it).
function coverImageUrls(id) {
  if (!isValidCoverId(id)) return null;
  return COVER_SIZES.map((name) => COVER_HOST + id + '/' + name);
}

// Reads a response body up to `maxBytes`; null when it is larger (the read is cancelled).
async function readCapped(res, maxBytes) {
  const declared = Number(res.headers && typeof res.headers.get === 'function' ? res.headers.get('content-length') : NaN);
  if (Number.isFinite(declared) && declared > maxBytes) {
    try { if (res.body && typeof res.body.cancel === 'function') await res.body.cancel(); } catch (_) { /* best-effort */ }
    return null;
  }
  if (!res.body || typeof res.body.getReader !== 'function') {
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > maxBytes ? null : buf;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      try { await reader.cancel(); } catch (_) { /* best-effort */ }
      return null;
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

// Fetches the cover image: maxresdefault, else hqdefault. -> { ok: true, bytes, url } | { ok: false, reason }.
// A non-200 (a 404 carries a placeholder JPEG), a redirect, an oversize body, an empty body or a timeout is a failure of
// that size; both failing is the job's failure.
async function fetchCoverImage(id, opts = {}) {
  const urls = coverImageUrls(id);
  if (!urls) return { ok: false, reason: 'invalid cover id' };
  const fetchImpl = opts.fetch || seams.fetch;
  const maxBytes = Number.isFinite(opts.maxBytes) ? opts.maxBytes : COVER_MAX_BYTES;
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : COVER_FETCH_TIMEOUT_MS;
  const reasons = [];
  for (const u of urls) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetchImpl(u, { redirect: 'manual', signal: ac.signal });
      if (!res || res.status !== 200) {
        reasons.push(`${path.basename(u)}: HTTP ${res ? res.status : 'none'}`);
        try { if (res && res.body && typeof res.body.cancel === 'function') await res.body.cancel(); } catch (_) { /* best-effort */ }
        continue;
      }
      const bytes = await readCapped(res, maxBytes);
      if (!bytes) { reasons.push(`${path.basename(u)}: larger than ${maxBytes} bytes`); continue; }
      if (bytes.length === 0) { reasons.push(`${path.basename(u)}: empty`); continue; }
      return { ok: true, bytes, url: u };
    } catch (err) {
      reasons.push(`${path.basename(u)}: ${ac.signal.aborted ? 'timed out' : ((err && (err.code || err.name)) || 'error')}`);
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, reason: reasons.join('; ') };
}

// The ffmpeg argv that crops the fetched image to a centred square JPEG (the largest square that fits).
function cropSquareArgs(input, output) {
  return ['-nostdin', '-v', 'error', '-n', '-i', input, '-vf', "crop='min(iw,ih)':'min(iw,ih)'", '-frames:v', '1', '-q:v', '2', '-f', 'image2', '-c:v', 'mjpeg', output];
}

// Fetches and crops the job's cover into a private temp folder. -> { ok: true, path, dir } | { ok: false, reason }.
// The caller removes `dir` when the job ends (`releaseAlbumCover`).
async function prepareAlbumCover(id, opts = {}) {
  const fetched = await fetchCoverImage(id, opts);
  if (!fetched.ok) return fetched;
  let dir = null;
  try {
    dir = fs.mkdtempSync(path.join(opts.tmpRoot || os.tmpdir(), 'filetube-cover-'));
    const raw = path.join(dir, 'raw.jpg');
    const out = path.join(dir, 'cover.jpg');
    fs.writeFileSync(raw, fetched.bytes, { mode: 0o600 });
    const r = await (opts.run || seams.run)('ffmpeg', cropSquareArgs(raw, out), FFMPEG_TIMEOUT_MS);
    let head = null;
    try { head = fs.readFileSync(out).subarray(0, 2); } catch (_) { head = null; }
    if (!r.ok || !head || head.length < 2 || head[0] !== 0xff || head[1] !== 0xd8) {
      releaseAlbumCover({ dir });
      return { ok: false, reason: `the cover could not be cropped (ffmpeg ${r.ok ? 'wrote no JPEG' : 'exit ' + r.code})` };
    }
    try { fs.unlinkSync(raw); } catch (_) { /* the folder goes at the end anyway */ }
    return { ok: true, path: out, dir };
  } catch (err) {
    if (dir) releaseAlbumCover({ dir });
    return { ok: false, reason: `the cover could not be prepared (${(err && err.code) || 'error'})` };
  }
}

function releaseAlbumCover(cover) {
  if (!cover || typeof cover.dir !== 'string' || !path.basename(cover.dir).startsWith('filetube-cover-')) return;
  try { fs.rmSync(cover.dir, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
}

// The exact ffmpeg argv that writes `input` with `cover` as its only picture into `output` (a temp, so the muxer is
// named: `-f mp3` / `-f ipod`, which is what ffmpeg picks for .mp3 / .m4a). `-n`: never overwrite an existing path.
// `kind` = 'mp3' | 'm4a'; anything else -> null.
function embedCoverArgs(input, cover, output, kind) {
  if (kind !== 'mp3' && kind !== 'm4a') return null;
  const out = ['-nostdin', '-v', 'error', '-n', '-copyts', '-i', input, '-i', cover,
    '-map', '0:a', '-map', '1:0', '-map_metadata', '0', '-map_chapters', '0', '-c', 'copy'];
  if (kind === 'mp3') out.push('-id3v2_version', '3', '-write_id3v1', '1');
  out.push('-metadata:s:v', 'title=Album cover', '-metadata:s:v', 'comment=Cover (front)', '-disposition:v:0', 'attached_pic');
  out.push('-f', kind === 'mp3' ? 'mp3' : 'ipod', output);
  return out;
}

function probeArgs(file) {
  return ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', '-show_chapters', file];
}

// ffprobe JSON -> the facts the verify compares, or null when it is not a probe of a media file.
function parseProbe(stdout) {
  let j;
  try { j = JSON.parse(stdout); } catch (_) { return null; }
  if (!j || typeof j !== 'object' || !j.format || typeof j.format !== 'object') return null;
  const streams = Array.isArray(j.streams) ? j.streams : [];
  const audio = streams.filter((s) => s && s.codec_type === 'audio');
  const pics = streams.filter((s) => s && s.disposition && s.disposition.attached_pic === 1);
  const tags = Object.create(null);
  const rawTags = j.format.tags && typeof j.format.tags === 'object' ? j.format.tags : {};
  for (const k of Object.keys(rawTags)) tags[k.toLowerCase()] = String(rawTags[k]);
  const duration = Number(j.format.duration);
  const chapters = (Array.isArray(j.chapters) ? j.chapters : []).map((c) => Number(c && c.start_time));
  return {
    audioStreams: audio.length,
    audioCodec: audio.length ? String(audio[0].codec_name || '') : '',
    attachedPics: pics.length,
    duration: Number.isFinite(duration) ? duration : null,
    tags,
    chapters,
  };
}

// The rename decision (pure): may the temp replace the file? -> { ok: true } | { ok: false, reason }.
function verifyReembed(before, after) {
  if (!before || !after) return { ok: false, reason: 'unreadable probe' };
  if (before.audioStreams !== 1) return { ok: false, reason: 'the original has no single audio stream' };
  if (after.audioStreams !== 1) return { ok: false, reason: 'no audio stream' };
  if (after.audioCodec !== before.audioCodec) return { ok: false, reason: 'the audio codec changed' };
  if (before.duration === null || after.duration === null || Math.abs(after.duration - before.duration) > DURATION_TOLERANCE_S) {
    return { ok: false, reason: 'the duration changed' };
  }
  for (const k of KEPT_TAGS) {
    if (Object.prototype.hasOwnProperty.call(before.tags, k) && after.tags[k] !== before.tags[k]) return { ok: false, reason: `the ${k} tag changed` };
  }
  if (after.chapters.length !== before.chapters.length) return { ok: false, reason: 'the chapter count changed' };
  for (let i = 0; i < before.chapters.length; i += 1) {
    if (!Number.isFinite(before.chapters[i]) || !Number.isFinite(after.chapters[i]) || Math.abs(after.chapters[i] - before.chapters[i]) > CHAPTER_TOLERANCE_S) {
      return { ok: false, reason: 'a chapter moved' };
    }
  }
  if (after.attachedPics !== 1) return { ok: false, reason: 'not exactly one cover' };
  return { ok: true };
}

// The in-process claims: a file being re-embedded now, and the temps in flight (the orphan sweep never takes one).
const filesInFlight = new Set();
const tempsInFlight = new Set();

// Removes the temps a crash left in `dir` (our exact name shape, regular files only, none in flight). Never throws.
function removeOrphanTemps(dir) {
  let removed = 0;
  let names;
  try { names = fs.readdirSync(dir); } catch (_) { return 0; }
  for (const name of names) {
    if (!TEMP_NAME_RE.test(name)) continue;
    const p = path.join(dir, name);
    if (tempsInFlight.has(p)) continue;
    try {
      if (!fs.lstatSync(p).isFile()) continue;
      fs.unlinkSync(p);
      removed += 1;
    } catch (_) { /* best-effort */ }
  }
  return removed;
}

const sameFile = (a, b) => !!a && !!b && a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs;

// Re-embeds `coverPath` into `file` (an absolute path to a .mp3 / .m4a). -> { ok: true } | { ok: false, reason }.
// Never throws; on every failure the temp is removed and `file` is untouched.
async function reembedCover(file, coverPath, opts = {}) {
  const runTool = opts.run || seams.run;
  if (typeof file !== 'string' || !path.isAbsolute(file) || typeof coverPath !== 'string' || !path.isAbsolute(coverPath)) {
    return { ok: false, reason: 'bad path' };
  }
  const kind = EMBED_KINDS[path.extname(file).toLowerCase()];
  if (!kind) return { ok: false, reason: 'not an mp3 or m4a file' };
  if (filesInFlight.has(file)) return { ok: false, reason: 'already being re-embedded' };
  filesInFlight.add(file);
  const dir = path.dirname(file);
  const temp = path.join(dir, `.ftcover-${process.pid}-${crypto.randomBytes(6).toString('hex')}.tmp`);
  tempsInFlight.add(temp);
  let renamed = false;
  try {
    const st0 = fs.lstatSync(file);
    if (!st0.isFile()) return { ok: false, reason: 'not a regular file' };
    const p0 = await runTool('ffprobe', probeArgs(file), PROBE_TIMEOUT_MS);
    const before = p0.ok ? parseProbe(p0.stdout) : null;
    if (!before) return { ok: false, reason: 'the original could not be probed' };
    const w = await runTool('ffmpeg', embedCoverArgs(file, coverPath, temp, kind), FFMPEG_TIMEOUT_MS);
    if (!w.ok) return { ok: false, reason: `ffmpeg failed (${w.code})` };
    const tst = fs.lstatSync(temp);
    if (!tst.isFile() || tst.size === 0) return { ok: false, reason: 'ffmpeg wrote no file' };
    const p1 = await runTool('ffprobe', probeArgs(temp), PROBE_TIMEOUT_MS);
    const verdict = verifyReembed(before, p1.ok ? parseProbe(p1.stdout) : null);
    if (!verdict.ok) return verdict;
    // the file keeps its permissions and its times (the scan's mtime-based date and tombstone checks read them)
    fs.chmodSync(temp, st0.mode & 0o7777);
    fs.utimesSync(temp, st0.atimeMs / 1000, st0.mtimeMs / 1000); // to the microsecond (utimes takes seconds)
    // the original must still be the very file that was probed (nothing replaced, removed or wrote it meanwhile)
    let st1 = null;
    try { st1 = fs.lstatSync(file); } catch (_) { st1 = null; }
    if (!sameFile(st0, st1)) return { ok: false, reason: 'the file changed while the cover was written' };
    fs.renameSync(temp, file);
    renamed = true;
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: (err && err.code) || 'error' };
  } finally {
    if (!renamed) { try { fs.unlinkSync(temp); } catch (_) { /* never written, or already gone */ } }
    tempsInFlight.delete(temp);
    filesInFlight.delete(file);
  }
}

module.exports = {
  COVER_MAX_BYTES,
  COVER_FETCH_TIMEOUT_MS,
  KEPT_TAGS,
  TEMP_NAME_RE,
  seams,
  isValidCoverId,
  coverImageUrls,
  fetchCoverImage,
  cropSquareArgs,
  prepareAlbumCover,
  releaseAlbumCover,
  embedCoverArgs,
  probeArgs,
  parseProbe,
  verifyReembed,
  removeOrphanTemps,
  reembedCover,
};
