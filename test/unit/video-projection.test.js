'use strict';

// [UNIT] v1.366.0 W4 (VR / 360): lib/media/projection.js on the REAL ffprobe output of the real fixtures
// (test/fixtures/vr/ffprobe-grown.json, recorded from ffprobe 7.0.2; never hand-typed side data), every arm
// of the precedence, the file-name rule with the frame shape agreeing and disagreeing, and the probe args.
// With a real ffprobe on this box (FILETUBE_TEST_FFMPEG or PATH), the recording is re-proven live through
// server.js's own buildFfprobeArgs; without one that test SKIPS and says so.

require('../helpers/isolate-data-dir'); // #202: buildFfprobeArgs lives in server.js, which opens a db
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const P = require('../../lib/media/projection');

const FIX = path.join(__dirname, '..', 'fixtures', 'vr');
const REC = JSON.parse(fs.readFileSync(path.join(FIX, 'ffprobe-grown.json'), 'utf8'));
const video = (name) => REC[name].streams.find((s) => s.codec_type === 'video');

test('the recording covers every fixture file, and only real ones', () => {
  const files = fs.readdirSync(FIX).filter((f) => /\.(mp4|webm)$/.test(f)).sort();
  assert.deepStrictEqual(Object.keys(REC).filter((k) => k !== '_comment').sort(), files);
  assert.ok(files.length >= 7);
  for (const f of files) assert.ok(fs.statSync(path.join(FIX, f)).size < 300 * 1024, f + ' is under 300 KB');
});

test('projectionFromProbe: each real side-data shape maps to its projection', () => {
  const want = {
    'vr-360-v1.mp4': '360', // v1 XML uuid box
    'vr-360-v2.mp4': '360', // v2 sv3d
    'vr-360-tb-v2.mp4': '360-tb', // Stereo 3D top and bottom
    'vr-180-sbs-v2.mp4': '180-sbs', // tiled equirectangular, bounds 257 + 255 on a 512 frame
    'clip_360_TB.mp4': undefined, // no metadata: the NAME decides, at serve time
    'pano_360.mp4': undefined,
    'rot90.mp4': undefined, // a Display Matrix is not a sphere
  };
  for (const [f, p] of Object.entries(want)) assert.strictEqual(P.projectionFromProbe(REC[f]), p, f);
});

test('projectionFromProbe: a cover-art stream never decides; junk never throws', () => {
  const sphere = video('vr-360-v2.mp4');
  const coverFirst = { streams: [{ codec_type: 'video', codec_name: 'png', disposition: { attached_pic: 1 }, side_data_list: sphere.side_data_list, width: 512, height: 256 }] };
  assert.strictEqual(P.projectionFromProbe(coverFirst), undefined);
  for (const j of [null, undefined, 42, 'x', {}, { streams: 'no' }, { streams: [null] }]) assert.strictEqual(P.projectionFromProbe(j), undefined);
});

test('projectionFromSideData: the tiled bounds decide 360 vs 180, and a partial pano stays flat', () => {
  const sbs = video('vr-180-sbs-v2.mp4').side_data_list;
  assert.strictEqual(P.projectionFromSideData(sbs, 512, 256), '180-sbs');
  const tiled = sbs.find((s) => s.side_data_type === 'Spherical Mapping');
  const stereo = sbs.find((s) => s.side_data_type === 'Stereo 3D');
  assert.strictEqual(P.projectionFromSideData([stereo, { ...tiled, bound_left: 0, bound_right: 0 }], 512, 256), '360-sbs');
  assert.strictEqual(P.projectionFromSideData([{ ...tiled, bound_left: 512, bound_right: 512 }], 512, 256), undefined, 'a third of the sphere: flat');
  assert.strictEqual(P.projectionFromSideData([stereo], 512, 256), undefined, 'a 3D flat movie is not a sphere');
});

test('projectionFromName: whole tokens, and the frame shape must agree', () => {
  assert.strictEqual(P.projectionFromName('clip_360_TB.mp4', 512, 512), '360-tb');
  assert.strictEqual(P.projectionFromName('clip_360_TB.mp4', 1920, 1080), undefined, 'a 16:9 frame disagrees');
  assert.strictEqual(P.projectionFromName('pano_360.mp4', 512, 256), '360');
  assert.strictEqual(P.projectionFromName('pano_360.mp4', 512, 512), '360-tb', 'no eye token: 1:1 is stacked 3D');
  assert.strictEqual(P.projectionFromName('Top360 plays.mp4', 512, 256), undefined, 'not a whole token');
  assert.strictEqual(P.projectionFromName('trip_180_LR.mp4', 512, 256), '180-sbs');
  assert.strictEqual(P.projectionFromName('trip_180.mp4', 512, 512), '180');
  assert.strictEqual(P.projectionFromName('trip_180_fisheye.mp4', 512, 256), undefined, 'fisheye is never guessed');
  assert.strictEqual(P.projectionFromName('pano_360.mp4'), undefined, 'no dims: no guess');
  assert.strictEqual(P.projectionFromName('movie_LR.mp4', 512, 256), undefined, 'an eye token alone is a 3D flat movie');
});

test('effectiveProjection: owner pick > file metadata > file name; flat beats everything', () => {
  const base = { width: 512, height: 256 };
  assert.strictEqual(P.effectiveProjection({ ...base }, 'plain.mp4'), undefined);
  assert.strictEqual(P.effectiveProjection({ ...base }, 'pano_360.mp4'), '360', 'name');
  assert.strictEqual(P.effectiveProjection({ ...base, projection: '180-sbs' }, 'pano_360.mp4'), '180-sbs', 'metadata beats the name');
  assert.strictEqual(P.effectiveProjection({ ...base, projection: '180-sbs', projectionOverride: '360-tb' }, 'pano_360.mp4'), '360-tb', 'the pick beats metadata');
  assert.strictEqual(P.effectiveProjection({ ...base, projection: '360', projectionOverride: 'flat' }, 'pano_360.mp4'), undefined, 'flat beats both');
  assert.strictEqual(P.effectiveProjection({ ...base, projection: 'bogus', projectionOverride: 'nope' }, 'plain.mp4'), undefined, 'junk values are ignored');
  assert.strictEqual(P.effectiveProjection(null, 'pano_360.mp4'), undefined);
});

test('the override list is flat plus every projection, and only those', () => {
  assert.deepStrictEqual([...P.OVERRIDES], ['flat', '360', '360-tb', '360-sbs', '180', '180-sbs', '180-tb']);
  for (const v of P.OVERRIDES) assert.ok(P.isOverride(v));
  for (const v of ['', 'FLAT', '360 ', null, undefined, 360, '__proto__']) assert.ok(!P.isOverride(v), String(v));
  assert.ok(!P.isProjection('flat'));
});

test('buildFfprobeArgs asks for the spherical side-data keys and still for rotation', () => {
  const { buildFfprobeArgs } = require('../../server');
  const args = buildFfprobeArgs('/x.mp4');
  const entries = args[args.indexOf('-show_entries') + 1];
  const sd = /stream_side_data=([^:]+)/.exec(entries)[1].split(',');
  for (const k of ['rotation', 'side_data_type', 'projection', 'type', 'bound_left', 'bound_right']) assert.ok(sd.includes(k), k);
});

function findFfprobe() {
  const explicit = process.env.FILETUBE_TEST_FFMPEG;
  const dirs = (explicit ? [path.dirname(explicit)] : []).concat(String(process.env.PATH || '').split(path.delimiter));
  for (const dir of dirs) {
    const p = path.join(dir, 'ffprobe');
    try { fs.accessSync(p, fs.constants.X_OK); return p; } catch (_) { /* next */ }
  }
  return null;
}
const FFPROBE = findFfprobe();

test('LIVE: the real ffprobe, through server.js buildFfprobeArgs, prints exactly the recorded side data', { skip: FFPROBE ? false : 'no ffprobe binary (set FILETUBE_TEST_FFMPEG to an ffmpeg next to an ffprobe)' }, () => {
  const { buildFfprobeArgs } = require('../../server');
  for (const f of Object.keys(REC).filter((k) => k !== '_comment')) {
    const live = JSON.parse(execFileSync(FFPROBE, buildFfprobeArgs(path.join(FIX, f))).toString());
    assert.deepStrictEqual(live.streams.map((s) => s.side_data_list || null), REC[f].streams.map((s) => s.side_data_list || null), f);
    assert.strictEqual(P.projectionFromProbe(live), P.projectionFromProbe(REC[f]), f);
  }
});
