'use strict';

// v1.92 Storyboard sprites - PURE planning/gating for scrub + card previews.
//
// One sprite sheet per video, generated at scan time: N frames sampled evenly
// across the clip, scaled to a fixed tile width and tiled into a single JPEG.
// The same asset drives BOTH the seek-bar scrub preview and the card preview
// (desktop hover / mobile in-view autoplay).
//
// This module is intentionally standalone (no server boot, no fs) so scripts
// and unit tests can require it directly. The on-disk sprite PATH lives in
// server.js (it needs THUMBNAIL_DIR); the client-side render geometry
// (frame-for-time, tile CSS) lives in public/js/player.js.

const SB_TILE_W = 320;          // px, tile width (v1.93.3: 160->320 for crisper
                                // hover/scrub tiles; regenerate sprites to apply).
                                // height derived from source aspect
const SB_TARGET_FRAMES = 40;    // aim for ~this many frames on a typical clip
const SB_MIN_FRAMES = 10;       // floor so even short clips scrub usefully
const SB_MAX_FRAMES = 100;      // ceiling so long clips stay a small sprite
const SB_MIN_INTERVAL = 2;      // s, densest sampling (short clips)
const SB_MAX_INTERVAL = 10;     // s, coarsest sampling (long clips)
const SB_MAX_COLS = 10;         // grid width; rows = ceil(count/cols)
const SB_MIN_DURATION = 2;      // s; below this the single poster suffices

// duration (s) -> storyboard geometry descriptor, or null when a storyboard is
// not worthwhile (too short / non-finite). Deterministic: frame i sits at
// exactly i*interval seconds, so the client maps a scrub time t to
// floor(t/interval).
function planStoryboard(duration) {
  const d = Number(duration);
  if (!Number.isFinite(d) || d <= SB_MIN_DURATION) return null;
  // Target ~SB_TARGET_FRAMES frames, but keep the sampling interval sane.
  let interval = d / SB_TARGET_FRAMES;
  if (interval < SB_MIN_INTERVAL) interval = SB_MIN_INTERVAL;
  if (interval > SB_MAX_INTERVAL) interval = SB_MAX_INTERVAL;
  // Frame count from that interval, clamped to [MIN, MAX].
  let count = Math.floor(d / interval) + 1;
  if (count < SB_MIN_FRAMES) count = SB_MIN_FRAMES;
  if (count > SB_MAX_FRAMES) count = SB_MAX_FRAMES;
  // Re-derive the exact even interval so frame i lands at i*interval.
  interval = d / count;
  const cols = Math.min(SB_MAX_COLS, count);
  const rows = Math.ceil(count / cols);
  return { v: 1, interval, count, cols, rows, tileW: SB_TILE_W };
}

// Should this scanned item get a storyboard? Video with a real stream and a
// worthwhile duration. Audio-only (type 'audio') is excluded by type.
function shouldGenerateStoryboard(item) {
  return !!item && item.type === 'video' && planStoryboard(item.duration) !== null;
}

// The seek time (s, as a clean argv string) of storyboard frame `i`: frame i
// sits at exactly i*interval, matching planStoryboard's contract and the
// client's floor(t/interval) tile mapping. Rounded to the millisecond so the
// argv is deterministic (no float noise) - the sub-ms offset is invisible to a
// preview whose tile index is floor(t/interval).
function storyboardSeekTime(i, interval) {
  return String(Number((i * interval).toFixed(3)));
}

// The ordered seek-time argv strings for every storyboard frame of a plan:
// frame i sits at exactly i*interval (see storyboardSeekTime).
function storyboardSeekTimes(plan) {
  const out = [];
  for (let i = 0; i < plan.count; i++) out.push(storyboardSeekTime(i, plan.interval));
  return out;
}

// GENERATION MODEL (v1.93.1 - bounded memory). The sprite is built in TWO
// stages, each a separate `ffmpeg` process, so the source file is never held
// open more than once at a time:
//
//   1. Per-frame GRAB (buildStoryboardFrameArgs): one single-input ffmpeg per
//      sampled frame - `-ss <t> -i src` fast-seeks to the prior keyframe and
//      decodes only forward to t, writing that one frame scaled to the tile
//      width as a LOSSLESS PNG. ONE decoder context resident, so RSS is ~a
//      single-frame grab (v1.92-equivalent) no matter the file size.
//   2. ASSEMBLE (buildStoryboardAssembleArgs): one ffmpeg reads the grabbed PNG
//      frames as an image2 numbered sequence and tiles them into the cols x
//      rows sprite JPEG - it only ever decodes the small tiles, never the
//      source, and this is the SINGLE lossy JPEG encode (the PNG intermediates
//      keep the grab lossless, so a new sprite is no lossier than v1.92's).
//
// WHY: v1.93.0 put all `plan.count` (up to 100) frames into ONE ffmpeg as N
// `-ss <t> -i src` inputs + concat+tile. That is O(framecount) in TIME (the win
// we keep) but O(framecount) in MEMORY too - ffmpeg opens all N demuxer/decoder
// contexts up front, which measured **9.3 GB RSS on a large 4K source** and
// would OOM a memory-tight host (prod: 11 GB, co-tenant vaultwarden). Splitting
// the grabs into separate sequential processes keeps the seek-based time win
// while capping resident memory at one decoder. The grid GEOMETRY is unchanged
// (same cols x rows, same SB_TILE_W tiles, same descriptor - not the same JPEG
// bytes), so sprites already on disk stay valid and never need regenerating.

// One single-input ffmpeg that grabs the frame at `seekTime` and writes it,
// scaled to `tileW` wide (even height for the encoder), to `outFramePath`. No
// `-q:v`: the caller writes a LOSSLESS PNG intermediate, so the only lossy
// re-encode is the single assembly pass (no double JPEG recompression).
// srcPath is a standalone argv element (execFile, no shell) - path
// metacharacters can never be interpreted.
function buildStoryboardFrameArgs(srcPath, outFramePath, seekTime, tileW) {
  return [
    '-nostdin', '-loglevel', 'error',
    '-ss', seekTime,       // INPUT seek (before -i): keyframe + short forward decode
    '-i', srcPath,
    '-frames:v', '1',
    '-an',
    '-vf', `scale=${tileW}:-2`,
    '-y', outFramePath,
  ];
}

// One ffmpeg that reads the grabbed frames as an image2 numbered sequence
// (`inputPattern` = e.g. `.../f%03d.png`, starting at 0) and tiles them into a
// single cols x rows sprite JPEG. On EOF with fewer than cols*rows frames (a
// partial last row) `tile` pads the remainder - identical to v1.92/v1.93.0, and
// the client's `floor(t/interval)` never indexes a padded cell.
function buildStoryboardAssembleArgs(inputPattern, outPath, cols, rows) {
  return [
    '-nostdin', '-loglevel', 'error',
    '-start_number', '0',
    '-i', inputPattern,
    '-frames:v', '1',
    '-vf', `tile=${cols}x${rows}`,
    '-q:v', '4',
    '-y', outPath,
  ];
}

module.exports = {
  planStoryboard,
  shouldGenerateStoryboard,
  buildStoryboardFrameArgs,
  buildStoryboardAssembleArgs,
  storyboardSeekTime,
  storyboardSeekTimes,
  // constants exported so tests can pin the knobs Dean approved.
  SB_TILE_W, SB_TARGET_FRAMES, SB_MIN_FRAMES, SB_MAX_FRAMES,
  SB_MIN_INTERVAL, SB_MAX_INTERVAL, SB_MAX_COLS, SB_MIN_DURATION,
};
