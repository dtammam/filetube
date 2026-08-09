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

const SB_TILE_W = 160;          // px, tile width; height derived from source aspect
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

// The exact FFmpeg argument ARRAY (never a shell string) that samples
// `plan.count` frames evenly (fps = 1/interval), scales each to SB_TILE_W wide
// (even height for the encoder) and tiles them into one cols x rows JPEG.
function buildStoryboardArgs(srcPath, outPath, plan) {
  const vf = `fps=1/${plan.interval},scale=${plan.tileW}:-2,tile=${plan.cols}x${plan.rows}`;
  return [
    '-nostdin', '-loglevel', 'error',
    '-i', srcPath,
    '-vf', vf,
    '-frames:v', '1',
    '-an',
    '-q:v', '4',
    '-y', outPath
  ];
}

module.exports = {
  planStoryboard,
  shouldGenerateStoryboard,
  buildStoryboardArgs,
  // constants exported so tests can pin the knobs Dean approved.
  SB_TILE_W, SB_TARGET_FRAMES, SB_MIN_FRAMES, SB_MAX_FRAMES,
  SB_MIN_INTERVAL, SB_MAX_INTERVAL, SB_MAX_COLS, SB_MIN_DURATION,
};
