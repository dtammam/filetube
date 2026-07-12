'use strict';

// Pure/dependency-free subtitle helpers (A6, v1.24 UX Round, Wave 5).
//
// yt-dlp DOWNLOADS already land subtitles as VTT directly
// (`--sub-format vtt --convert-subs vtt`, see lib/ytdlp/args.js's
// `buildYtdlpDownloadArgs`) -- yt-dlp's own bundled ffmpeg does that
// conversion, so nothing in THIS module is ever involved in the download
// path. This module exists ONLY for:
//   1. `srtToVtt` -- converting a user's own LOCAL `.srt` sidecar (dropped
//      next to a library file yt-dlp never touched) to VTT on the fly, at
//      serve time (see `GET /api/subtitles/:id`, server.js). Hand-rolled
//      rather than pulling in a subtitle-parsing library -- this whole
//      subtitle feature is deliberately bound to add NO new runtime
//      dependency.
//   2. `findSubtitleSidecar` -- locating whichever subtitle file (if any)
//      sits beside a given media file, shared by BOTH the scan's additive
//      `hasSubtitles` detection and the serve route, so the two can never
//      disagree on what counts as "this item has captions."
//
// Both are pure with respect to their OWN trust boundary: `filePath` is
// always an already-trusted, already-indexed media path (db.metadata[id]
// .filePath, populated only by the scan walking a configured library
// root) -- neither function accepts or needs any additional untrusted
// input, so neither does its own path-confinement check; they only ever
// look at the SAME directory that trusted file already lives in (mirrors
// `GET /video/:id`'s own trust posture in server.js: confinement happened
// once, at scan time).

const fs = require('fs');
const path = require('path');

// A bare integer line, e.g. "42" -- SRT's per-cue counter. Only stripped
// when immediately followed by a timestamp line (see the look-ahead in
// srtToVtt below) so a genuine numeric-only CAPTION line (a subtitle that
// just reads "42") is never misclassified as a cue counter.
const CUE_NUMBER_LINE = /^\d+\s*$/;

// SRT timestamp line: "HH:MM:SS,mmm --> HH:MM:SS,mmm" (optionally followed
// by VTT/SRT cue-settings text, which is passed through untouched).
const TIMESTAMP_LINE = /^(\d{2}:\d{2}:\d{2}),(\d{3})(\s*-->\s*)(\d{2}:\d{2}:\d{2}),(\d{3})(.*)$/;

/**
 * Convert SRT subtitle text to WebVTT text. Pure (no I/O). Never throws --
 * malformed/empty/garbage input degrades to a bare, cue-less "WEBVTT"
 * document rather than raising, since this is served straight into a
 * `<track>` element (`GET /api/subtitles/:id`, server.js), where an
 * exception would otherwise fail a page that would rather just show no
 * captions.
 * @param {string} text raw `.srt` file contents
 * @returns {string} valid (at minimum, signature-only) WebVTT text
 */
function srtToVtt(text) {
  const raw = typeof text === 'string' ? text : '';
  // Strip a leading UTF-8 BOM (common in .srt files saved by Windows tools)
  // and normalize CRLF/CR line endings to LF before splitting.
  const normalized = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');
  const outLines = ['WEBVTT', ''];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (CUE_NUMBER_LINE.test(line) && TIMESTAMP_LINE.test(lines[i + 1] || '')) continue; // strip the cue-number line only
    const m = TIMESTAMP_LINE.exec(line);
    if (m) {
      outLines.push(`${m[1]}.${m[2]}${m[3]}${m[4]}.${m[5]}${m[6]}`);
    } else {
      outLines.push(line);
    }
  }
  // Collapse 3+ consecutive blank lines (SRT's blank-line cue separator plus
  // a just-removed cue-number line otherwise leaves a double gap) down to a
  // single blank line -- purely cosmetic; VTT tolerates extra blank lines
  // fine either way.
  return outLines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

// Escapes every regex metacharacter in `str` so it can be embedded literally
// inside a dynamically-built `RegExp` (used below to anchor a media file's
// own `base` name against sibling filenames).
function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---- v1.34 T2 (Dean, desktop CC sync): offset-shifted VTT -------------------
//
// Desktop plays browser-incompatible containers through the LIVE transcode
// pipe (`GET /video/:id?live=1&t=<seconds>`, server.js streamLiveTranscode),
// whose ffmpeg `-ss` input seek RESTARTS the media timeline at 0 -- so after
// any live seek, `video.currentTime` is segment-relative while the sidecar's
// cue times stay absolute. Native <track> cue matching therefore drifts by
// exactly the seek offset. The fix: the client re-points its <track> at
// `GET /api/subtitles/:id?offset=<seconds>` after every live seek, and THIS
// helper produces that shifted document -- every cue time minus the offset,
// cues that end at/before the seek point dropped entirely (their content
// played before the visible window), a cue straddling the seek point clamped
// to start at 0.
//
// Pure, never throws; a non-finite/non-positive offset returns the input
// unchanged. Handles both VTT timestamp shapes (`HH:MM:SS.mmm` and
// `MM:SS.mmm`) and passes headers/NOTE blocks/cue settings through
// untouched. A dropped cue's identifier line (the optional non-blank line
// immediately before its timing line) is dropped with it, so no dangling
// identifiers confuse a strict parser.

// VTT cue-timing line: "[HH:]MM:SS.mmm --> [HH:]MM:SS.mmm[ settings]".
const VTT_CUE_TIMING_LINE = /^\s*((?:\d{1,2}:)?\d{1,2}:\d{2}\.\d{3})\s*-->\s*((?:\d{1,2}:)?\d{1,2}:\d{2}\.\d{3})(.*)$/;

// "[HH:]MM:SS.mmm" -> milliseconds. Returns NaN on anything malformed.
function parseVttTimeMs(str) {
  const m = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\.(\d{3})$/.exec(String(str).trim());
  if (!m) return NaN;
  const hours = m[1] !== undefined ? Number(m[1]) : 0;
  return ((hours * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + Number(m[4]);
}

// milliseconds -> "HH:MM:SS.mmm" (always the long form -- valid VTT and
// unambiguous).
function formatVttTimeMs(ms) {
  const clamped = Math.max(0, Math.round(ms));
  const h = Math.floor(clamped / 3600000);
  const m = Math.floor((clamped % 3600000) / 60000);
  const s = Math.floor((clamped % 60000) / 1000);
  const frac = clamped % 1000;
  const pad = (n, w) => String(n).padStart(w, '0');
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}.${pad(frac, 3)}`;
}

/**
 * Shift every cue in a WebVTT document earlier by `offsetSeconds`.
 * @param {string} text WebVTT document text
 * @param {*} offsetSeconds seconds to subtract from every cue time
 * @returns {string} the shifted document (or the input untouched when the
 *   offset is absent/invalid/non-positive)
 */
function shiftVttCues(text, offsetSeconds) {
  const raw = typeof text === 'string' ? text : '';
  const off = Number(offsetSeconds);
  if (!Number.isFinite(off) || off <= 0) return raw;
  const offMs = Math.round(off * 1000);

  const lines = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const out = [];
  let droppingCue = false;
  for (const line of lines) {
    const m = VTT_CUE_TIMING_LINE.exec(line);
    if (m) {
      const startMs = parseVttTimeMs(m[1]);
      const endMs = parseVttTimeMs(m[2]);
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
        // Malformed timing -- pass through untouched rather than guessing.
        droppingCue = false;
        out.push(line);
        continue;
      }
      const shiftedEnd = endMs - offMs;
      if (shiftedEnd <= 0) {
        // Whole cue precedes the seek point: drop it, including an
        // identifier line we may have just emitted for it.
        const prev = out.length > 0 ? out[out.length - 1] : '';
        if (prev !== '' && !VTT_CUE_TIMING_LINE.test(prev) && prev.trim() !== 'WEBVTT' && !/^NOTE\b/.test(prev.trim())) {
          out.pop();
        }
        droppingCue = true;
        continue;
      }
      droppingCue = false;
      out.push(`${formatVttTimeMs(Math.max(0, startMs - offMs))} --> ${formatVttTimeMs(shiftedEnd)}${m[3]}`);
      continue;
    }
    if (droppingCue) {
      if (line.trim() === '') {
        droppingCue = false; // blank line terminates the dropped cue block
        out.push(line);
      }
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}

/**
 * Locate a subtitle sidecar file next to a media file, in the fixed,
 * DETERMINISTIC priority order the exec plan (A6) specifies:
 *   1. an exact bare `<base>.vtt`.
 *   2. an explicit-language VTT, `<base>.<lang>.vtt` -- the exact shape
 *      yt-dlp's own downloads land in per `OUTPUT_TEMPLATE`, e.g.
 *      "My Video [dQw4w9WgXcQ].en.vtt" -- preferring `<base>.en.vtt` when
 *      present, then any other single lang-tagged match in a stable
 *      (alphabetically sorted by filename) order, so a directory with
 *      multiple language sidecars always resolves the SAME winner across
 *      calls/environments rather than depending on `readdirSync`'s
 *      unspecified ordering.
 *   3. a bare `<base>.srt`.
 *
 * FIX-2 (two-reviewer gate, post-release): the lang-tagged match is now
 * STRICTLY ANCHORED -- the segment immediately after `<base>.` must itself
 * be a language tag (`[A-Za-z]{2,3}` optionally followed by a `-<subtag>`),
 * not just "starts with `<base>.` and ends with `.vtt`". Pre-fix, a media
 * file `video.mp4` (base `video`) would match a SIBLING's own sidecar
 * `video.2.en.vtt` (belonging to `video.2.mp4`), since that filename does
 * start with `"video."` and does end with `".vtt"`. That bound the wrong
 * captions to `video.mp4` and, via `moveItemToFolder` (server.js), could
 * rename the sibling's real sidecar out from under it, orphaning it. The
 * anchored regex below requires an EXACT match of
 * `^<base>\.<lang>\.vtt$` (case-insensitive), so `video.2.en.vtt` can never
 * bind to base `video` (the segment right after `video.` is `2`, not a
 * language tag) -- it only ever matches its own base, `video.2`.
 *
 * Returns `null` when none exist (including when the containing directory
 * itself is unreadable/gone -- fails closed, never throws).
 *
 * `dirCache` (v1.30, A1 / AC1.3): an OPTIONAL `Map<dir, string[]>` a caller
 * (the scan) can pass so a directory is only ever `readdirSync`'d ONCE per
 * cache lifetime, no matter how many sibling files in that same directory
 * ask this function for their sidecar -- this is what kills the scan's
 * O(N^2) (N files x N-entry-directory `readdirSync`+regex-scan) behavior.
 * When provided, the bare `.vtt`/`.srt` exact-match probes are also answered
 * from the SAME cached listing (membership check) instead of two additional
 * per-file `existsSync` calls, but the priority order, the anchored
 * `langVttRe` matching, the deterministic `en`-then-alphabetical winner, and
 * the fail-closed-on-unreadable-directory semantics are all byte-for-byte
 * identical to the no-cache path below -- only the SOURCE of the entry list
 * changes. When `dirCache` is omitted (every caller before v1.30, and the
 * single-file callers that still don't pass one), behavior is completely
 * unchanged from before this parameter existed.
 * @param {string} filePath the media item's own on-disk path
 * @param {{existsSync: Function, readdirSync: Function}} [fsImpl] injectable for tests; defaults to the real `fs` module
 * @param {Map<string, string[]>} [dirCache] optional per-scan directory-listing cache; when present, avoids redundant `readdirSync`/`existsSync` calls for files sharing a directory
 * @returns {{ path: string, format: 'vtt'|'srt' } | null}
 */
function findSubtitleSidecar(filePath, fsImpl, dirCache) {
  const impl = fsImpl || fs;
  if (typeof filePath !== 'string' || filePath === '') return null;
  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);

  // `{2,3}` covers BOTH 2-letter (ISO-639-1: `en`, `es`) and 3-letter
  // (ISO-639-2: `eng`, `spa`) language codes a local sidecar might use, plus an
  // optional `-<region>` subtag. Still LETTERS-only, so a numeric/multi-segment
  // sibling (`video.2.en.vtt`, `clip.1080p.en.vtt`) can never match this base
  // (the FIX-2 anti-collision anchoring is preserved).
  const langVttRe = new RegExp(`^${escapeRegExp(base)}\\.([A-Za-z]{2,3}(?:-[A-Za-z0-9]+)?)\\.vtt$`, 'i');

  if (dirCache instanceof Map) {
    // Cached path: resolve the directory listing once per unique `dir` for
    // the lifetime of this Map (populated on miss below), then answer ALL
    // three probes (bare .vtt, lang .vtt, bare .srt) from that single
    // listing -- zero additional `readdirSync`/`existsSync` calls per file.
    let entries = dirCache.get(dir);
    if (entries === undefined) {
      try {
        entries = impl.readdirSync(dir);
      } catch (_) {
        entries = []; // unreadable/vanished directory -- fail closed, exactly as the no-cache path
      }
      dirCache.set(dir, entries);
    }

    // 1. exact bare `<base>.vtt` -- highest priority.
    const bareVttName = base + '.vtt';
    if (entries.includes(bareVttName)) {
      return { path: path.join(dir, bareVttName), format: 'vtt' };
    }

    // 2. explicit-language VTT(s) -- same anchored regex, same winner rule.
    const langMatches = [];
    for (const name of entries) {
      const m = langVttRe.exec(name);
      if (m) langMatches.push({ name, lang: m[1].toLowerCase() });
    }
    if (langMatches.length > 0) {
      const preferred = langMatches.find((m) => m.lang === 'en')
        || langMatches.slice().sort((a, b) => a.name.localeCompare(b.name))[0];
      return { path: path.join(dir, preferred.name), format: 'vtt' };
    }

    // 3. bare `<base>.srt`.
    const bareSrtName = base + '.srt';
    if (entries.includes(bareSrtName)) {
      return { path: path.join(dir, bareSrtName), format: 'srt' };
    }

    return null;
  }

  // No-cache path (every pre-v1.30 caller): byte-identical to the original
  // implementation -- two `existsSync` probes plus a fresh `readdirSync` per
  // call, never memoized.

  // 1. exact bare `<base>.vtt` -- highest priority, checked before any
  // directory listing is even needed.
  const bareVtt = path.join(dir, base + '.vtt');
  if (impl.existsSync(bareVtt)) return { path: bareVtt, format: 'vtt' };

  // 2. explicit-language VTT(s) -- anchored so only a TRUE sibling of THIS
  // base can ever match (see the FIX-2 doc comment above).
  let entries = [];
  try {
    entries = impl.readdirSync(dir);
  } catch (_) {
    entries = []; // unreadable/vanished directory -- fail closed, fall through to the bare-srt check below
  }
  const langMatches = [];
  for (const name of entries) {
    const m = langVttRe.exec(name);
    if (m) langMatches.push({ name, lang: m[1].toLowerCase() });
  }
  if (langMatches.length > 0) {
    // Deterministic preference: an `en`-tagged sidecar wins if present;
    // otherwise the first match in a stable, alphabetically-sorted-by-
    // filename order -- never whatever order `readdirSync` happened to
    // return.
    const preferred = langMatches.find((m) => m.lang === 'en')
      || langMatches.slice().sort((a, b) => a.name.localeCompare(b.name))[0];
    return { path: path.join(dir, preferred.name), format: 'vtt' };
  }

  // 3. bare `<base>.srt`.
  const bareSrt = path.join(dir, base + '.srt');
  if (impl.existsSync(bareSrt)) return { path: bareSrt, format: 'srt' };

  return null;
}

module.exports = { srtToVtt, findSubtitleSidecar, shiftVttCues, parseVttTimeMs, formatVttTimeMs };
