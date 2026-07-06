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
// GUIDING INVARIANT (post-v1.15.1-hotfix-2, CRITICAL -- see the incident
// this closes, below): a file WITHOUT yt-dlp's own ` [<id>]` bracket --
// where `<id>` is exactly the 11-character `[A-Za-z0-9_-]` charset yt-dlp/
// YouTube video ids actually use -- is NEVER matched by ANY pattern in this
// module, full stop. Every pattern below is anchored to that bracket. This
// is not an incidental detail: yt-dlp's OUTPUT_TEMPLATE (lib/ytdlp/args.js)
// is `%(title)s [%(id)s].%(ext)s`, so EVERY genuine intermediate this module
// exists to recognize contains that bracket immediately before its
// intermediate infix/suffix -- an ordinary user file never does.
//
// INCIDENT: the original (pre-hotfix-2) patterns matched on suffix shape
// ALONE (e.g. `/\.f\d+\.[a-z0-9]+$/i` for the fragment case, bare `.part`/
// `.ytdl` for the marker case), with no bracket requirement at all. That
// meant an entirely ordinary, non-yt-dlp file that HAPPENED to share the
// suffix shape -- e.g. a user's own "Vacation.f2.mp4", "Draft.temp.mp4",
// "notes.part", or "data.ytdl" -- was wrongly recognized as a yt-dlp
// intermediate: server.js's scan silently SKIPPED it (never indexed), and
// lib/ytdlp/index.js's `cleanupFailedDownloadIntermediates` PERMANENTLY
// DELETED it from disk after any failed download in that same directory.
// Every pattern below now requires the bracket precisely to close that
// data-loss hole; the regression tests in test/integration/scan-
// discovery.test.js and test/unit/ytdlp-cleanup-intermediates.test.js assert
// bracket-less lookalikes survive BOTH the scan and the cleanup untouched.
//
// Patterns are otherwise still deliberately TIGHT beyond just the bracket:
// an ordinary, non-yt-dlp media file with dots in its name, e.g.
// "My.Video.2024.mp4", must never match even if it happened to carry a
// bracket-shaped substring elsewhere in the name.

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

// yt-dlp's own video-id charset/length (lib/ytdlp/url.js's `isSafeVideoId`
// uses the same shape) -- the bracket every pattern below anchors on.
const ID_BRACKET = '\\[[A-Za-z0-9_-]{11}\\]';

// yt-dlp per-format fragment: "<title> [<id>].f399.mp4" / ".f251.webm" --
// the id bracket immediately followed by the numeric format-id infix and
// the final extension.
const FRAGMENT_RE = new RegExp(`${ID_BRACKET}\\.f\\d+\\.[a-z0-9]+$`, 'i');

// yt-dlp partial-download markers -- the id bracket appears somewhere before
// the trailing marker (yt-dlp appends these to the FULL already-templated
// name, e.g. "<title> [<id>].f399.mp4.part" or "<title> [<id>].mp4.ytdl").
const PART_FRAG_RE = new RegExp(`${ID_BRACKET}.*\\.part-frag\\d+$`, 'i');
const PART_RE = new RegExp(`${ID_BRACKET}.*\\.part$`, 'i');
const YTDL_RE = new RegExp(`${ID_BRACKET}.*\\.ytdl$`, 'i');

// yt-dlp merge temp: "<title> [<id>].temp.mp4" -- the id bracket immediately
// followed by the ".temp" infix and a recognized media extension.
const MERGE_TEMP_RE = new RegExp(`${ID_BRACKET}\\.temp$`, 'i');

/**
 * True when `name` (a bare filename, no directory component required) has a
 * shape yt-dlp itself produces for an in-progress/failed/killed download --
 * never for an ordinary library file. Defensive: any non-string/empty input
 * is `false`, never a throw. See the module's GUIDING INVARIANT comment
 * above: every branch here requires yt-dlp's own ` [<11-char id>]` bracket,
 * so a bracket-less file (however suffix-shaped) is never matched.
 * @param {*} name
 * @returns {boolean}
 */
function isYtdlpIntermediate(name) {
  if (typeof name !== 'string' || name === '') return false;

  if (FRAGMENT_RE.test(name)) return true;
  if (PART_FRAG_RE.test(name)) return true;
  if (PART_RE.test(name)) return true;
  if (YTDL_RE.test(name)) return true;

  // yt-dlp merge temp: only counted when the trailing extension is itself a
  // media extension, so an unrelated bracketed file that merely happens to
  // contain the substring "temp" before some other extension is never caught.
  const dot = name.lastIndexOf('.');
  if (dot > 0) {
    const ext = name.slice(dot).toLowerCase();
    if (MEDIA_EXTENSIONS.has(ext) && MERGE_TEMP_RE.test(name.slice(0, dot))) {
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
