'use strict';

// VR / 360 projection of a video (Dean 2026-09-27: "Can we add support for vr enabled mp4s?"):
// what shape the picture in the file is, so the watch page can wrap it around the viewer instead
// of showing the raw stretched frame. Pure - no I/O - so the scan, the routes and the tests share
// one rule.
//
// The value is one of PROJECTIONS, or absent (= a normal flat video). 'flat' is only ever an
// OVERRIDE: the owner saying "this is not VR" over what the file says.
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
//      camera and Google's spatial-media injector write (sv3d/st3d, or the v1 XML uuid box).
// Nothing else. The file NAME is never read (Dean 2026-10-06, gate r1): "Xbox 360 unboxing.mp4" or
// "Tony Hawk 360 flip tutorial.mp4" is a flat video, and a guess that wraps it around a sphere puts a
// normal video on WebGL. A download that lost its metadata (a DeoVR-style `clip_360_TB.mp4`) is flat
// until the owner picks its Video type.
// Fisheye, cubemap and the other exotic projections are NOT detected: they stay flat (the raw frame,
// as today), and the owner can still pick the nearest shape by hand.

const PROJECTIONS = Object.freeze(['360', '360-tb', '360-sbs', '180', '180-sbs', '180-tb']);
const OVERRIDES = Object.freeze(['flat', ...PROJECTIONS]);

function isProjection(v) { return typeof v === 'string' && PROJECTIONS.includes(v); }
function isOverride(v) { return typeof v === 'string' && OVERRIDES.includes(v); }

// ffprobe prints names with spaces ('Spherical Mapping', 'top and bottom'); compare them squashed
// and lower-cased so a spelling drift between ffmpeg versions ('SphericalMapping') still matches.
function squash(s) { return typeof s === 'string' ? s.toLowerCase().replace(/[^a-z0-9]/g, '') : ''; }

const COVER_TOLERANCE = 0.1; // 10%: how close a tiled frame's share of the panorama must be to 1 (360) or 0.5 (180)

// Pure: ffprobe's `side_data_list` of the video stream -> a projection, or undefined. Requested by
// buildFfprobeArgs (server.js) as `stream_side_data=...,side_data_type,projection,type,bound_*`.
// Measured (v1.366.0) against ffprobe 7.0.2 on the real files in test/fixtures/vr (Google's
// spatial-media injector: v1 XML, v2 sv3d, v2 top-bottom, v2 VR180 with bounds; their recorded output
// is test/fixtures/vr/ffprobe-grown.json): an equirect sphere prints {side_data_type:'Spherical
// Mapping', projection:'equirectangular'}; VR180 prints projection 'tiled equirectangular' with
// bound_left/right in PIXELS of the full panorama (a 512-wide VR180 frame: 257 + 255, so the frame
// covers 512 of 1024 = half the sphere); a 3D file adds {side_data_type:'Stereo 3D',
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
    if (Math.abs(cover - 1) <= COVER_TOLERANCE) span = '360';
    else if (Math.abs(cover - 0.5) <= COVER_TOLERANCE) span = '180';
    else return undefined; // a partial pano we would draw wrong: leave it flat
  } else return undefined; // cubemap, fisheye, rectilinear, parametric: not drawn here
  if (stereo === 'sidebyside') return `${span}-sbs`;
  if (stereo === 'topandbottom') return `${span}-tb`;
  // '2D', 'unspecified', absent: one picture. (Checkerboard / line-interleaved 3D is not split;
  // shown as one picture it is still the right sphere, just with both eyes woven together.)
  return span;
}

// Pure: a whole ffprobe JSON (buildFfprobeArgs' output) -> a projection, or undefined. Picks the video stream
// the way parseFfprobeStreams does (the first non-attached-pic video stream with a codec), so a cover-art stream
// never decides, and reads its side data with the stream's CODED width (the bounds are in coded pixels).
function projectionFromProbe(j) {
  const streams = j && typeof j === 'object' && Array.isArray(j.streams) ? j.streams : [];
  const v = streams.find((s) => s && s.codec_type === 'video' && s.codec_name && !(s.disposition && s.disposition.attached_pic === 1));
  if (!v) return undefined;
  return projectionFromSideData(v.side_data_list, v.width, v.height);
}

// Pure: the projection the watch page draws for an item, or undefined for flat.
// Only the owner's pick and the file's own metadata count (the header: never the name).
function effectiveProjection(item) {
  if (!item || typeof item !== 'object') return undefined;
  if (item.projectionOverride === 'flat') return undefined;
  if (isProjection(item.projectionOverride)) return item.projectionOverride;
  if (isProjection(item.projection)) return item.projection;
  return undefined;
}

module.exports = {
  PROJECTIONS,
  OVERRIDES,
  isProjection,
  isOverride,
  projectionFromSideData,
  projectionFromProbe,
  effectiveProjection,
};
