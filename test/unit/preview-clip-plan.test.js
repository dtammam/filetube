'use strict';

// [UNIT] v1.94 preview clips - the PURE planner/gate/arg-builder
// (lib/previewClip.js). Divergent fixtures (not presence): a wrong-clamp or
// off-by-one implementation must FAIL these, so montage points are asserted to
// EXACT values, not ">= something".
const { test } = require('node:test');
const assert = require('node:assert');
const {
  planPreviewClip,
  previewClipEligible,
  buildPreviewClipArgs,
  PV_MIN_DURATION,
  PV_SNIPPETS,
  PV_WIDTH,
  PV_FPS,
} = require('../../lib/previewClip');

const approx = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} ~= ${b}`);

// ---- planPreviewClip: null cases --------------------------------------------

test('planPreviewClip: too-short / boundary / non-finite -> null', () => {
  assert.strictEqual(planPreviewClip(0), null);
  assert.strictEqual(planPreviewClip(PV_MIN_DURATION - 0.001), null, 'just under MIN -> null');
  assert.strictEqual(planPreviewClip(-10), null);
  assert.strictEqual(planPreviewClip(NaN), null);
  assert.strictEqual(planPreviewClip(Infinity), null);
  assert.strictEqual(planPreviewClip(undefined), null);
  assert.strictEqual(planPreviewClip('nope'), null);
  assert.ok(planPreviewClip(PV_MIN_DURATION), 'exactly MIN is eligible (>=)');
});

// ---- planPreviewClip: exact montage geometry --------------------------------

test('planPreviewClip: typical clip -> 4 snippets across [8%..last] of the duration', () => {
  const p = planPreviewClip(100); // start=8, end=90, dur=1.5, lastStart=88.5, span=80.5
  assert.strictEqual(p.count, PV_SNIPPETS);
  assert.strictEqual(p.count, 4);
  assert.strictEqual(p.width, PV_WIDTH);
  assert.strictEqual(p.fps, PV_FPS);
  assert.strictEqual(p.dur, 1.5);
  assert.strictEqual(p.snippets.length, 4);
  assert.strictEqual(p.snippets[0], 8, 'first snippet at HEAD (8% of 100)');
  approx(p.snippets[1], 34.833);
  approx(p.snippets[2], 61.667);
  assert.strictEqual(p.snippets[3], 88.5, 'last snippet ends by 90% (88.5 + 1.5 = 90)');
  // strictly increasing (a real montage across the video)
  for (let i = 1; i < p.snippets.length; i++) assert.ok(p.snippets[i] > p.snippets[i - 1]);
  // every snippet fits inside the video
  p.snippets.forEach(t => assert.ok(t + p.dur <= 100));
});

test('planPreviewClip: short-but-eligible clip clamps snippet length + never over-runs', () => {
  const p = planPreviewClip(PV_MIN_DURATION); // 5s: start=0.4, end=4.5
  assert.strictEqual(p.count, 4);
  assert.strictEqual(p.snippets[0], 0.4);
  p.snippets.forEach(t => assert.ok(t + p.dur <= 5.0001, `snippet at ${t} (+${p.dur}) fits in 5s`));
  assert.ok(p.dur >= 0.5, 'snippet length has a floor');
});

// ---- previewClipEligible -----------------------------------------------------

test('previewClipEligible: video with a worthwhile duration -> true', () => {
  assert.strictEqual(previewClipEligible({ type: 'video', duration: 100 }), true);
});

test('previewClipEligible: excludes audio, too-short, non-video, junk', () => {
  assert.strictEqual(previewClipEligible({ type: 'audio', duration: 300 }), false, 'audio excluded');
  assert.strictEqual(previewClipEligible({ type: 'video', duration: 2 }), false, 'too short');
  assert.strictEqual(previewClipEligible({ type: 'video' }), false, 'no duration');
  assert.strictEqual(previewClipEligible(null), false);
  assert.strictEqual(previewClipEligible(undefined), false);
});

// ---- buildPreviewClipArgs: exact array + injection safety -------------------

test('buildPreviewClipArgs: exact montage FFmpeg arg array (count 2, legible)', () => {
  const plan = { v: 1, snippets: [1, 3], dur: 1.5, count: 2, width: 320, fps: 24 };
  const args = buildPreviewClipArgs('/in.mp4', '/out.pv.mp4', plan);
  assert.deepStrictEqual(args, [
    '-nostdin', '-loglevel', 'error',
    '-ss', '1', '-i', '/in.mp4',
    '-ss', '3', '-i', '/in.mp4',
    '-filter_complex',
    '[0:v]trim=duration=1.5,setpts=PTS-STARTPTS,scale=320:-2,setsar=1,fps=24[v0];' +
    '[1:v]trim=duration=1.5,setpts=PTS-STARTPTS,scale=320:-2,setsar=1,fps=24[v1];' +
    '[v0][v1]concat=n=2:v=1:a=0[out]',
    '-map', '[out]',
    '-an',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '28',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-y', '/out.pv.mp4',
  ]);
});

test('buildPreviewClipArgs: one INPUT seek per snippet, muted, browser-safe encode', () => {
  const plan = planPreviewClip(100); // 4 snippets
  const args = buildPreviewClipArgs('/in.mp4', '/o.pv.mp4', plan);
  assert.strictEqual(args.filter(a => a === '-ss').length, plan.count, 'one input seek per snippet');
  assert.strictEqual(args.filter(a => a === '-i').length, plan.count, 'one -i per seek');
  assert.ok(args.includes('-an'), 'muted (no audio track)');
  assert.ok(args.includes('yuv420p'), 'browser/iOS-safe pixel format');
  assert.ok(args.includes('+faststart'), 'faststart for instant hover play');
  const fc = args[args.indexOf('-filter_complex') + 1];
  assert.match(fc, new RegExp(`concat=n=${plan.count}:v=1:a=0`), 'concat count == snippet count, no audio');
  assert.match(fc, new RegExp(`scale=${plan.width}:-2`));
});

test('buildPreviewClipArgs: paths are opaque argv elements (no shell interpolation)', () => {
  const evil = '/media/a; rm -rf ~ && echo $(whoami).mp4';
  const out = '/t/`id`.pv.mp4';
  const plan = planPreviewClip(100);
  const args = buildPreviewClipArgs(evil, out, plan);
  assert.ok(args.includes(evil), 'source path passes through verbatim as one element');
  assert.strictEqual(args[args.length - 1], out, 'output is the final arg after -y');
  assert.ok(!args.some(a => a.includes(evil) && a.includes(out)), 'no element glues src+out');
});
