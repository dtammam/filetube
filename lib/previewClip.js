'use strict';

// v1.94 Animated hover PREVIEW CLIP - PURE planning/gating/arg-building.
//
// A short muted MP4 "reel" per video: a montage of `count` short snippets
// sampled across the interior of the clip (skipping intro/outro), stitched into
// one loopable ~`count*dur`s H.264 clip scaled to `width`. Plays on card hover /
// in-view (the YouTube hover feel) - distinct from the storyboard SPRITE, which
// stays for the seek-bar scrub (random-access stills). No descriptor is ever
// persisted: the on-disk clip is the state, eligibility is derived from
// duration (previewClipEligible), like the v1.93.2 storyboard model.
//
// Standalone (no server boot, no fs) so scripts + unit tests require it directly.

const PV_MIN_DURATION = 5;   // s; below this a montage is pointless -> no clip
const PV_SNIPPETS = 4;       // montage snippet count on a normal-length video
const PV_SNIP_DUR = 1.5;     // s per snippet (~6s total montage)
const PV_WIDTH = 320;        // px, preview width (matches the sharpened tile width)
const PV_FPS = 24;           // normalised fps (smooth + small; concat needs it consistent)
const PV_HEAD = 0.08;        // skip the first 8% (intros/titles/black)
const PV_TAIL = 0.90;        // stop by 90% (skip credits/outros)

// Round to the millisecond so the ffmpeg argv is deterministic (no float noise).
function pvTime(t) {
  return Number(t.toFixed(3));
}

// duration (s) -> montage plan, or null when a preview clip is not worthwhile
// (non-finite / too short). `snippets` are the START seconds of each snippet;
// each runs `dur` seconds. Deterministic: points span [HEAD..TAIL-dur] evenly.
function planPreviewClip(duration) {
  const d = Number(duration);
  if (!Number.isFinite(d) || d < PV_MIN_DURATION) return null;
  const start = d * PV_HEAD;
  const end = d * PV_TAIL;
  // Each snippet must fit before `end`; the last one starts at end-dur. Clamp the
  // snippet length so it never runs past the usable window on a short clip.
  const dur = pvTime(Math.max(0.5, Math.min(PV_SNIP_DUR, end - start)));
  const lastStart = Math.max(start, end - dur);
  const span = lastStart - start; // >= 0
  const count = PV_SNIPPETS;
  const snippets = [];
  for (let i = 0; i < count; i++) {
    // i/(count-1) spans 0..1 across [start .. lastStart]; overlapping is fine on
    // a short clip (a montage of nearby moments still shows motion).
    snippets.push(pvTime(start + (span * i) / (count - 1)));
  }
  return { v: 1, snippets, dur, count, width: PV_WIDTH, fps: PV_FPS };
}

// Should this scanned item get a preview clip? A video with a worthwhile
// duration (audio-only excluded by type). Mirrors the storyboard eligibility
// shape so the two derived signals stay parallel.
function previewClipEligible(item) {
  return !!item && item.type === 'video' && planPreviewClip(item.duration) !== null;
}

// The exact FFmpeg argument ARRAY (never a shell string) that builds the montage
// in ONE process: `count` fast INPUT seeks (`-ss t -i src`, one short decode
// each - bounded memory, NOT the 100-input storyboard trap), each trimmed to
// `dur`, scaled + fps-normalised, then `concat`ed and H.264/yuv420p encoded with
// `+faststart` (instant hover play) and NO audio (`-an`, muted). srcPath is a
// standalone argv element every time (execFile, no shell).
function buildPreviewClipArgs(srcPath, outPath, plan) {
  const args = ['-nostdin', '-loglevel', 'error'];
  const chains = [];
  const labels = [];
  for (let i = 0; i < plan.count; i++) {
    args.push('-ss', String(plan.snippets[i]), '-i', srcPath);
    // trim to `dur`, reset PTS, scale to width (even height), square SAR, fps -
    // all four are what concat requires to be consistent across segments.
    chains.push(`[${i}:v]trim=duration=${plan.dur},setpts=PTS-STARTPTS,scale=${plan.width}:-2,setsar=1,fps=${plan.fps}[v${i}]`);
    labels.push(`[v${i}]`);
  }
  const filter =
    chains.join(';') + ';' +
    `${labels.join('')}concat=n=${plan.count}:v=1:a=0[out]`;
  args.push(
    '-filter_complex', filter,
    '-map', '[out]',
    '-an',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '28',
    '-pix_fmt', 'yuv420p',   // browser/iOS-safe (rejects yuv444/10-bit)
    '-movflags', '+faststart',
    '-y', outPath,
  );
  return args;
}

module.exports = {
  planPreviewClip,
  previewClipEligible,
  buildPreviewClipArgs,
  // constants exported so tests can pin the knobs Dean approved.
  PV_MIN_DURATION, PV_SNIPPETS, PV_SNIP_DUR, PV_WIDTH, PV_FPS, PV_HEAD, PV_TAIL,
};
