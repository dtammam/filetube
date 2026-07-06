'use strict';

// v1.15.1 hotfix: a pure, dependency-free predicate for yt-dlp's OWN
// intermediate/partial-download artifacts -- the files it leaves behind
// (in the download dir) mid-download, or after a download is killed/fails
// (e.g. the download timeout SIGKILL-ing a multi-gigabyte video). yt-dlp
// downloads video+audio as SEPARATE streams and merges them, so a killed/
// failed download commonly leaves:
//   - a merge temp: "<title> [<id>].temp.mp4" ("temp", two syllables --
//     distinct from FileTube's OWN transcode-cache temp file, which uses
//     "tmp" (one syllable), e.g. "<hash>.tmp.mp4" -- that is a DIFFERENT
//     file living in a DIFFERENT directory (TRANSCODE_DIR) and is
//     intentionally left untouched by this predicate/its callers)
//   - a per-format fragment: "<title> [<id>].f399.mp4" / ".f251.webm"
//   - a partial-download marker: "<title> [<id>].mp4.part" / ".ytdl" /
//     ".part-Frag3"
//
// This is a LEAF module: it requires nothing else in this codebase (no
// server.js, no lib/ytdlp/*), specifically so BOTH server.js's library scan
// (which must never INDEX these as broken library cards) and
// lib/ytdlp/index.js's own best-effort post-failure disk cleanup (defense-
// in-depth on top of the scan-side exclusion) can `require()` it directly
// without any circular-dependency risk (server.js already requires
// lib/ytdlp; lib/ytdlp must never require server.js back).
//
// Patterns are deliberately TIGHT: an ordinary, non-yt-dlp media file --
// including one with dots in its name, e.g. "My.Video.2024.mp4" -- must
// never match. Only the yt-dlp-shaped intermediate suffixes above do.

// Extensions yt-dlp itself can plausibly write as an intermediate OR final
// container for a video/audio download. A superset of server.js's own
// VIDEO_EXTENSIONS/AUDIO_EXTENSIONS (plus 'opus', a yt-dlp default-audio
// container FileTube's library scan doesn't otherwise whitelist) -- used
// ONLY to recognize the ".temp.<ext>" merge-temp shape below, never to
// gate the scan's own extension whitelist (that stays server.js's call).
const MEDIA_EXTENSIONS = new Set([
  '.mp4', '.mkv', '.webm', '.avi', '.mov', '.m4v',
  '.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac', '.opus',
]);

// yt-dlp per-format fragment: "<title> [<id>].f399.mp4" / ".f251.webm" --
// the numeric format-id infix immediately before the final extension.
const FRAGMENT_RE = /\.f\d+\.[a-z0-9]+$/i;

// yt-dlp partial-download markers.
const PART_FRAG_RE = /\.part-frag\d+$/i;
const PART_RE = /\.part$/i;
const YTDL_RE = /\.ytdl$/i;

/**
 * True when `name` (a bare filename, no directory component required) has a
 * shape yt-dlp itself produces for an in-progress/failed/killed download --
 * never for an ordinary library file. Defensive: any non-string/empty input
 * is `false`, never a throw.
 * @param {*} name
 * @returns {boolean}
 */
function isYtdlpIntermediate(name) {
  if (typeof name !== 'string' || name === '') return false;

  if (FRAGMENT_RE.test(name)) return true;
  if (PART_FRAG_RE.test(name)) return true;
  if (PART_RE.test(name)) return true;
  if (YTDL_RE.test(name)) return true;

  // yt-dlp merge temp: "<title> [<id>].temp.mp4" -- only counted when the
  // trailing extension is itself a media extension, so an unrelated file
  // that merely happens to contain the substring "temp" is never caught.
  const dot = name.lastIndexOf('.');
  if (dot > 0) {
    const ext = name.slice(dot).toLowerCase();
    if (MEDIA_EXTENSIONS.has(ext) && /\.temp$/i.test(name.slice(0, dot))) {
      return true;
    }
  }

  return false;
}

module.exports = {
  isYtdlpIntermediate,
  // Exported for tests / callers that want the exact extension set this
  // predicate's ".temp.<ext>" branch recognizes.
  MEDIA_EXTENSIONS,
};
