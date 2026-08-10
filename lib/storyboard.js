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

// The seek time (s, as a clean argv string) of storyboard frame `i`: frame i
// sits at exactly i*interval, matching planStoryboard's contract and the
// client's floor(t/interval) tile mapping. Rounded to the millisecond so the
// argv is deterministic (no float noise) - the sub-ms offset is invisible to a
// preview whose tile index is floor(t/interval).
function storyboardSeekTime(i, interval) {
  return String(Number((i * interval).toFixed(3)));
}

// The exact FFmpeg argument ARRAY (never a shell string) that builds the
// `plan.count`-frame sprite as a cols x rows JPEG.
//
// v1.93 SEEK-BASED sampling (was v1.92's `fps=1/interval` single-input filter):
// the fps filter forces ffmpeg to DECODE THE ENTIRE FILE to keep one frame per
// interval - O(filesize), so a multi-GB clip took minutes (measured p99 193s,
// max ~10min, worse past the 600s cap). Here EACH sample point gets its own
// `-ss <t>` INPUT seek: ffmpeg seeks to the prior keyframe and decodes only
// forward to t, so cost is O(framecount) - a few dozen fast seeks, independent
// of file size. Each input contributes its first frame (`trim=end_frame=1`),
// the frames are `concat`ed in order and `tile`d into the SAME grid. Output
// geometry is byte-identical to v1.92 (same cols x rows, same SB_TILE_W tiles),
// so sprites already on disk stay valid and never need regenerating.
function buildStoryboardArgs(srcPath, outPath, plan) {
  const args = ['-nostdin', '-loglevel', 'error'];
  const chains = [];   // per-input: first frame -> normalised -> scaled tile
  const labels = [];   // the [sN] labels, in order, fed to concat
  for (let i = 0; i < plan.count; i++) {
    // Input seek to this frame's timestamp (fast: keyframe + short forward
    // decode). srcPath is a standalone argv element every time - never a shell
    // string - so path metacharacters can never be interpreted.
    args.push('-ss', storyboardSeekTime(i, plan.interval), '-i', srcPath);
    // Keep ONLY the first frame at the seek point, reset its PTS, scale to the
    // tile width (even height for the encoder). setsar=1 is required by concat,
    // which rejects a SAR mismatch across segments.
    chains.push(`[${i}:v]trim=end_frame=1,setpts=PTS-STARTPTS,scale=${plan.tileW}:-2,setsar=1[s${i}]`);
    labels.push(`[s${i}]`);
  }
  const filter =
    chains.join(';') + ';' +
    `${labels.join('')}concat=n=${plan.count}:v=1:a=0[c];` +
    `[c]tile=${plan.cols}x${plan.rows}[o]`;
  args.push(
    '-filter_complex', filter,
    '-map', '[o]',
    '-frames:v', '1',
    '-an',
    '-q:v', '4',
    '-y', outPath
  );
  return args;
}

module.exports = {
  planStoryboard,
  shouldGenerateStoryboard,
  buildStoryboardArgs,
  storyboardSeekTime,
  // constants exported so tests can pin the knobs Dean approved.
  SB_TILE_W, SB_TARGET_FRAMES, SB_MIN_FRAMES, SB_MAX_FRAMES,
  SB_MIN_INTERVAL, SB_MAX_INTERVAL, SB_MAX_COLS, SB_MIN_DURATION,
};
