'use strict';

// Pure decision + argument-building logic for Roku compatibility renditions
// (v1.46). Roku's hardware demuxer/decoder rejects two classes of file that
// every browser plays fine:
//
//   1. MP4s carrying an embedded cover-art image track (yt-dlp
//      `--embed-thumbnail` writes a `png`/`mjpeg` video stream with
//      `disposition.attached_pic: 1`) -> "malformed data". The real video/
//      audio codecs are typically fully compatible; the fix is a lossless
//      REMUX that drops the image track ('strip').
//   2. Files whose display orientation lives in a rotation side-data matrix
//      (phone recordings). Browsers honor the flag; Roku ignores it and
//      plays the raw pixels sideways. The fix is a re-encode, which lets
//      ffmpeg's default autorotation bake the pixels upright ('rotate').
//
// Everything here is PURE (no fs, no spawn) so the verdict rules are unit-
// testable against canned ffprobe JSON -- the same JSON shape produced by
// server.js's `buildFfprobeArgs` probe (which already requests codec_type,
// disposition=attached_pic and side_data rotation; no new probe surface).
//
// Design contract (docs/exec-plans/completed/2026-07-25-v1.46-roku-compat-renditions.md,
// shipping as v1.46): renditions are ON-REQUEST and CACHE-ONLY. Nothing in
// this module (or its callers) ever mutates a library file. On ANY
// uncertainty -- unparseable probe output, no recognizable video stream --
// the verdict is 'clean' (serve the original bytes): a broken probe must
// never block playback that used to work.

// Signed degrees from the first side-data entry carrying a `rotation` key,
// else 0. Same semantics as server.js's private `firstStreamRotation`
// (duplicated here deliberately: lib modules never reach into server.js).
function streamRotation(stream) {
  const list = stream && Array.isArray(stream.side_data_list) ? stream.side_data_list : [];
  for (const sd of list) {
    if (sd && Object.prototype.hasOwnProperty.call(sd, 'rotation')) {
      const r = Number(sd.rotation);
      if (Number.isFinite(r)) return r;
    }
  }
  return 0;
}

function isAttachedPic(s) {
  return !!(s && s.disposition && s.disposition.attached_pic === 1);
}

// ffprobe JSON (string or object) -> { verdict, rotation, attachedPicCount }.
//
// verdict: 'clean'  -- serve the original file, build nothing.
//          'strip'  -- lossless remux dropping attached-pic image tracks.
//          'rotate' -- re-encode to bake rotation into the pixels (also
//                      implicitly drops image tracks: the rendition maps
//                      only the first REAL video stream).
//
// Rotation is read ONLY from the first real (non-attached-pic) video
// stream: a rotation flag on a cover-art track is display noise, never a
// reason to re-encode. Audio-only files (e.g. MP3s whose ID3 art also shows
// up as an attached-pic "video" stream) have no real video stream and are
// therefore always 'clean' -- Roku plays those fine and an MP4-container
// remux of an MP3 would be actively wrong.
//
// STRIP TRIGGER (v1.46.1, on-device evidence): the FIRST v1.46.0 rule keyed
// only on `disposition.attached_pic === 1`, but Dean's failing yt-dlp file
// carries its embedded thumbnail as a SECOND video stream with
// `attached_pic = 0` (plus a `bin_data` data stream), so it was mis-verdicted
// 'clean' and the original -- which wedges Roku's demuxer -- was served. The
// real invariant is: a Roku-clean file is exactly ONE video stream plus
// audio. ANY extra video stream (flagged or not) or any non-audio/video
// data/timecode stream means the strip remux (`-map 0:V:0 -map 0:a?`, which
// keeps only the first real video + all audio) is needed. Subtitle streams
// do NOT trigger a strip on their own -- Roku handles mov_text, and FileTube
// captions come from sidecars regardless.
function rokuCompatVerdict(input) {
  let j = input;
  if (typeof input === 'string') {
    try { j = JSON.parse(input); } catch (_) { j = null; }
  }
  const streams = j && typeof j === 'object' && Array.isArray(j.streams) ? j.streams : [];
  const videoStreams = streams.filter(s => s && s.codec_type === 'video' && s.codec_name);
  const realVideo = videoStreams.find(s => !isAttachedPic(s));
  const attachedPicCount = videoStreams.filter(isAttachedPic).length;
  if (!realVideo) {
    return { verdict: 'clean', rotation: 0, attachedPicCount };
  }
  const rotation = streamRotation(realVideo);
  // Any net turn (90/180/270, either sign) renders wrong on Roku -- 180 is
  // upside-down, not merely axis-swapped, so `% 360 !== 0` is the test.
  if (Math.abs(rotation) % 360 !== 0) {
    return { verdict: 'rotate', rotation, attachedPicCount };
  }
  const extraVideoCount = videoStreams.length - 1; // beyond the one real video
  const dataStreamCount = streams.filter(s => s && s.codec_type
    && s.codec_type !== 'video' && s.codec_type !== 'audio' && s.codec_type !== 'subtitle').length;
  if (extraVideoCount > 0 || dataStreamCount > 0) {
    return { verdict: 'strip', rotation: 0, attachedPicCount };
  }
  return { verdict: 'clean', rotation: 0, attachedPicCount };
}

// '-map 0:V:0' is the load-bearing selector in both arg builders: uppercase
// `V` means "video streams EXCLUDING attached pictures" (lowercase `v`
// includes them), so it selects the FIRST video-by-file-index that isn't a
// flagged attached picture, and every other track is dropped. This equals
// the content video because muxers place the primary video at the lowest
// index and append embedded thumbnails after it (Dean's file: h264=0,
// png=2) -- and it is the SAME stream `rokuCompatVerdict` reasons about
// (`videoStreams.find(!isAttachedPic)` is also first-by-index), so verdict
// and remux can never diverge. It does NOT re-order by "which is really the
// content" -- an unflagged image muxed at a lower index than the real video
// would be wrongly kept, but no known yt-dlp/mov path produces that.
// '0:a?' keeps ALL audio tracks, `?` making the selector optional so a
// (theoretical) silent video doesn't fail the whole build. Embedded
// subtitle/data tracks are deliberately NOT mapped -- FileTube's captions
// come from sidecar files via /api/subtitles/:id, and mp4 data tracks (tmcd
// timecode etc.) are a known `-c copy` failure source.

// Lossless remux: stream-copy, drop image tracks, faststart for streaming.
function buildStripArgs(srcPath, tmpPath) {
  return [
    '-i', srcPath,
    '-map', '0:V:0',
    '-map', '0:a?',
    '-c', 'copy',
    '-movflags', '+faststart',
    '-y', tmpPath,
  ];
}

// Rotation bake: same encode profile as the existing browser-compat
// transcode pipeline (server.js processTranscodeQueue) so the output class
// is identical -- H.264/AAC MP4, ffmpeg autorotation on by default.
function buildRotateArgs(srcPath, tmpPath, crf) {
  return [
    '-i', srcPath,
    '-map', '0:V:0',
    '-map', '0:a?',
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-crf', String(crf),
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '160k',
    '-ac', '2',
    '-movflags', '+faststart',
    '-y', tmpPath,
  ];
}

// Source signature for cache invalidation. The main transcode cache keys by
// id alone and goes stale when a file is replaced in place with the same
// path; compat renditions close that gap by recording the source's
// size+mtime at verdict time and re-probing whenever either moves.
function sourceSignature(stat) {
  return { size: Number(stat.size), mtimeMs: Number(stat.mtimeMs) };
}

function signatureMatches(sig, stat) {
  return !!sig
    && Number(sig.size) === Number(stat.size)
    && Number(sig.mtimeMs) === Number(stat.mtimeMs);
}

// True when `candidate` IS one of `roots` or lives anywhere under one.
// Boot-time guard: the rendition cache directory must never sit inside a
// scanned library root, or the scan would discover renditions as media
// (the v1.41.6 seam class). Pure prefix check over resolved paths; the
// caller passes `path` so tests can exercise both separators.
function isInsideAnyRoot(candidate, roots, pathModule) {
  const p = pathModule;
  const resolved = p.resolve(candidate);
  return (Array.isArray(roots) ? roots : []).some((root) => {
    if (typeof root !== 'string' || root === '') return false;
    const r = p.resolve(root);
    return resolved === r || resolved.startsWith(r + p.sep);
  });
}

// Bump whenever rokuCompatVerdict's RULES change, so cached sidecars written
// by an older rule set are re-probed instead of trusted. v1 (v1.46.0) keyed
// on attached_pic only; v2 (v1.46.1) adds the extra-video / data-stream
// triggers -- without this bump, a file already cached 'clean' under v1
// (its source size+mtime unchanged) would keep serving the original forever.
const VERDICT_VERSION = 2;

module.exports = {
  VERDICT_VERSION,
  rokuCompatVerdict,
  buildStripArgs,
  buildRotateArgs,
  sourceSignature,
  signatureMatches,
  isInsideAnyRoot,
};
