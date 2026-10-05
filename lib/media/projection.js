'use strict';

// VR / 360 projection of a video (Dean 2026-09-27: "Can we add support for vr enabled mp4s?"):
// what shape the picture in the file is, so the watch page can wrap it around the viewer instead
// of showing the raw stretched frame. Pure - no I/O - so the scan, the routes and the tests share
// one rule.
//
// The value is one of PROJECTIONS, or absent (= a normal flat video). 'flat' is only ever an
// OVERRIDE: the owner saying "this is not VR" over a wrong guess.
//   '360'      full sphere, one picture          (equirectangular, 2:1)
//   '360-tb'   full sphere, 3D, eyes stacked      (left eye on top, 1:1)
//   '360-sbs'  full sphere, 3D, eyes side by side (4:1, rare)
//   '180'      front half-sphere, one picture     (1:1)
//   '180-sbs'  front half-sphere, 3D side by side (VR180, 2:1)
//   '180-tb'   front half-sphere, 3D stacked      (1:2, rare)
// A 3D file is shown with ONE eye (the left): a phone or desktop screen is one picture.
//
// Where a value comes from, strongest first (effectiveProjection):
//   1. the owner's override (item.projectionOverride), set from the watch page;
//   2. the file's own spherical metadata (item.projection), read by the scan's ffprobe - what a 360
//      camera and Google's spatial-media injector write (sv3d/st3d, or the v1 XML uuid box);
//   3. the file NAME, in the convention VR players (DeoVR, HereSphere, Skybox) read - `_180_LR`,
//      `_360_TB`, `180x180_3dh` - because a download from a website almost never keeps the metadata.
//      A name only counts when the frame's shape agrees with it ("Top 360 plays.mp4" at 16:9 is
//      a flat video), so a name alone never turns a normal video into a sphere.
// Fisheye, cubemap and the other exotic projections are NOT detected: they stay flat (the raw frame,
// as today), and the owner can still pick the nearest shape by hand.

const PROJECTIONS = Object.freeze(['360', '360-tb', '360-sbs', '180', '180-sbs', '180-tb']);
const OVERRIDES = Object.freeze(['flat', ...PROJECTIONS]);

function isProjection(v) { return typeof v === 'string' && PROJECTIONS.includes(v); }
function isOverride(v) { return typeof v === 'string' && OVERRIDES.includes(v); }

// ffprobe prints names with spaces ('Spherical Mapping', 'top and bottom'); compare them squashed
// and lower-cased so a spelling drift between ffmpeg versions ('SphericalMapping') still matches.
function squash(s) { return typeof s === 'string' ? s.toLowerCase().replace(/[^a-z0-9]/g, '') : ''; }

// The frame's own width/height ratio (display dims), or NaN when unknown.
function aspectOf(width, height) {
  const w = Number(width); const h = Number(height);
  return (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) ? w / h : NaN;
}
// The ratio each projection's FULL frame has (per eye 2:1 for 360, 1:1 for 180).
const FRAME_ASPECT = Object.freeze({ '360': 2, '360-tb': 1, '360-sbs': 4, '180': 1, '180-sbs': 2, '180-tb': 0.5 });
const ASPECT_TOLERANCE = 0.1; // 10%: encoders round (3840x1920, 4096x2048, 5760x2880, 2880x1440 all land well inside)
function aspectFits(projection, aspect) {
  const want = FRAME_ASPECT[projection];
  return Number.isFinite(aspect) && Math.abs(aspect / want - 1) <= ASPECT_TOLERANCE;
}

// Pure: ffprobe's `side_data_list` of the video stream -> a projection, or undefined. Requested by
// buildFfprobeArgs (server.js) as `stream_side_data=...,side_data_type,projection,type,bound_*`.
// Measured against ffprobe 7.0.2 on files from Google's spatial-media injector (v1 XML, v2 sv3d,
// v2 VR180 with bounds): an equirect sphere prints {side_data_type:'Spherical Mapping',
// projection:'equirectangular'}; VR180 prints projection 'tiled equirectangular' with
// bound_left/right in PIXELS of the full panorama (a 1024-wide VR180 frame: 513 + 511, so the frame
// covers 1024 of 2048 = half the sphere); a 3D file adds {side_data_type:'Stereo 3D',
// type:'top and bottom' | 'side by side'}. ffmpeg >= 7.1 also names 'half equirectangular' (180).
function projectionFromSideData(list, width, height) {
  if (!Array.isArray(list)) return undefined;
  let sphere = null;
  let stereo = '';
  for (const sd of list) {
    if (!sd || typeof sd !== 'object') continue;
    const kind = squash(sd.side_data_type);
    if (kind === 'sphericalmapping' && !sphere) sphere = sd;
    else if (kind === 'stereo3d' && !stereo) stereo = squash(sd.type);
  }
  if (!sphere) return undefined; // a 3D flat movie (Stereo 3D alone) is not a sphere
  const proj = squash(sphere.projection);
  let span;
  if (proj === 'equirectangular') span = '360';
  else if (proj === 'halfequirectangular') span = '180';
  else if (proj === 'tiledequirectangular') {
    // How much of the full panorama's width this frame covers: ~1 = 360, ~0.5 = 180.
    const w = Number(width);
    const l = Number(sphere.bound_left) || 0;
    const r = Number(sphere.bound_right) || 0;
    if (!(w > 0) || l < 0 || r < 0) return undefined;
    const cover = w / (w + l + r);
    if (Math.abs(cover - 1) <= ASPECT_TOLERANCE) span = '360';
    else if (Math.abs(cover - 0.5) <= ASPECT_TOLERANCE) span = '180';
    else return undefined; // a partial pano we would draw wrong: leave it flat
  } else return undefined; // cubemap, fisheye, rectilinear, parametric: not drawn here
  if (stereo === 'sidebyside') return `${span}-sbs`;
  if (stereo === 'topandbottom') return `${span}-tb`;
  // '2D', 'unspecified', absent: one picture. (Checkerboard / line-interleaved 3D is not split;
  // shown as one picture it is still the right sphere, just with both eyes woven together.)
  return span;
}

// Pure: a file name -> a projection, or undefined. Tokens are whole words between separators
// (start/end, _ - . space brackets), case-insensitive, so "Top360" or "1800" never match.
const TOKEN_SPLIT = /[\s_\-.,()[\]{}+]+/;
const SBS_TOKENS = new Set(['lr', 'sbs', '3dh', 'rl']);
const TB_TOKENS = new Set(['tb', 'ou', 'bt', 'ud', '3dv', 'overunder']);
const FISHEYE = /^(fisheye\d*|mkx\d+|rf\d+|vrca\d+)$/; // these are not equirect: never guess them
function projectionFromName(name, width, height) {
  if (typeof name !== 'string' || !name) return undefined;
  const base = name.replace(/^.*[\\/]/, '').replace(/\.[a-z0-9]{2,4}$/i, '');
  const tokens = base.toLowerCase().split(TOKEN_SPLIT).filter(Boolean);
  let span = '';
  let stereo = '';
  for (const t of tokens) {
    if (FISHEYE.test(t)) return undefined;
    if (t === '360' || t === 'vr360' || t === '360vr' || t === '360x180') span = span || '360';
    else if (t === '180' || t === 'vr180' || t === '180vr' || t === '180x180') span = span || '180';
    else if (SBS_TOKENS.has(t)) stereo = stereo || 'sbs';
    else if (TB_TOKENS.has(t)) stereo = stereo || 'tb';
  }
  if (!span) return undefined; // a bare `_LR` / `_TB` is a 3D FLAT movie as often as a sphere
  const aspect = aspectOf(width, height);
  if (!Number.isFinite(aspect)) return undefined; // no frame shape to agree with: no guess
  const candidates = stereo
    ? [`${span}-${stereo}`]
    // No eye token: the frame's shape decides (360 at 2:1 is one picture, at 1:1 stacked 3D;
    // 180 at 2:1 is side-by-side 3D - the VR180 norm - at 1:1 one picture).
    : (span === '360' ? ['360', '360-tb'] : ['180-sbs', '180']);
  return candidates.find((p) => aspectFits(p, aspect));
}

// Pure: the projection the watch page draws for an item, or undefined for flat.
function effectiveProjection(item, name) {
  if (!item || typeof item !== 'object') return undefined;
  if (item.projectionOverride === 'flat') return undefined;
  if (isProjection(item.projectionOverride)) return item.projectionOverride;
  if (isProjection(item.projection)) return item.projection;
  return projectionFromName(name, item.width, item.height);
}

module.exports = {
  PROJECTIONS,
  OVERRIDES,
  isProjection,
  isOverride,
  projectionFromSideData,
  projectionFromName,
  effectiveProjection,
};
