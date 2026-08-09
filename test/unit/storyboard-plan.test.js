'use strict';

// [UNIT] v1.92 storyboard sprites - the PURE server-side planner/gate/arg
// builder (lib/storyboard.js). Divergent fixtures (not presence): a plausible
// off-by-one or wrong-clamp implementation must FAIL these, so every count is
// asserted to an EXACT value at a boundary, not ">= some number".
const { test } = require('node:test');
const assert = require('node:assert');
const {
  planStoryboard,
  shouldGenerateStoryboard,
  buildStoryboardArgs,
  SB_MIN_FRAMES,
  SB_MAX_FRAMES,
  SB_MIN_DURATION,
  SB_TILE_W,
} = require('../../lib/storyboard');

const approx = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ~= ${b}`);

// ---- planStoryboard: null cases ---------------------------------------------

test('planStoryboard: too-short / boundary / non-finite durations -> null', () => {
  assert.strictEqual(planStoryboard(0), null);
  assert.strictEqual(planStoryboard(1), null);
  assert.strictEqual(planStoryboard(SB_MIN_DURATION), null, 'exactly at MIN_DURATION is excluded (<=)');
  assert.strictEqual(planStoryboard(-10), null);
  assert.strictEqual(planStoryboard(NaN), null);
  assert.strictEqual(planStoryboard(Infinity), null);
  assert.strictEqual(planStoryboard(undefined), null);
  assert.strictEqual(planStoryboard('not a number'), null);
});

// ---- planStoryboard: exact geometry at each clamp regime --------------------

test('planStoryboard: typical clip targets exactly 40 frames in a 10x4 grid', () => {
  const p = planStoryboard(79.714104); // a real item duration from the library
  assert.strictEqual(p.count, 40, 'target-frames regime -> exactly 40 (not 39/41)');
  assert.strictEqual(p.cols, 10);
  assert.strictEqual(p.rows, 4);
  assert.strictEqual(p.tileW, SB_TILE_W);
  assert.strictEqual(p.v, 1);
  // frame i sits at i*interval: interval is the EXACT even spacing.
  approx(p.interval * p.count, 79.714104);
  assert.ok(p.cols * p.rows >= p.count, 'grid must cover every frame');
});

test('planStoryboard: very long clip is capped at MAX_FRAMES (100), 10x10', () => {
  const p = planStoryboard(4000); // ~66 min
  assert.strictEqual(p.count, SB_MAX_FRAMES);
  assert.strictEqual(p.count, 100);
  assert.strictEqual(p.cols, 10);
  assert.strictEqual(p.rows, 10);
  approx(p.interval, 4000 / 100); // 40 s apart, exactly even
});

test('planStoryboard: short-but-eligible clip floored at MIN_FRAMES (10)', () => {
  const p = planStoryboard(8);
  assert.strictEqual(p.count, SB_MIN_FRAMES);
  assert.strictEqual(p.count, 10);
  approx(p.interval, 8 / 10);
  assert.strictEqual(p.cols, 10);
  assert.strictEqual(p.rows, 1);
});

test('planStoryboard: mid clip between floor and target (20s -> 11 frames)', () => {
  // interval clamps to MIN_INTERVAL(2): floor(20/2)+1 = 11, above MIN(10).
  const p = planStoryboard(20);
  assert.strictEqual(p.count, 11);
  assert.strictEqual(p.cols, 10);
  assert.strictEqual(p.rows, 2, 'ceil(11/10) = 2');
  approx(p.interval, 20 / 11);
});

// ---- shouldGenerateStoryboard ------------------------------------------------

test('shouldGenerateStoryboard: video with real duration -> true', () => {
  assert.strictEqual(shouldGenerateStoryboard({ type: 'video', duration: 79.7 }), true);
});

test('shouldGenerateStoryboard: excludes audio, too-short, and junk', () => {
  assert.strictEqual(shouldGenerateStoryboard({ type: 'audio', duration: 300 }), false, 'audio-only excluded by type');
  assert.strictEqual(shouldGenerateStoryboard({ type: 'video', duration: 1 }), false, 'too short');
  assert.strictEqual(shouldGenerateStoryboard({ type: 'video', duration: 0 }), false);
  assert.strictEqual(shouldGenerateStoryboard({ type: 'video' }), false, 'no duration');
  assert.strictEqual(shouldGenerateStoryboard(null), false);
  assert.strictEqual(shouldGenerateStoryboard(undefined), false);
});

// ---- buildStoryboardArgs: exact array + injection safety --------------------

test('buildStoryboardArgs: exact seek-based FFmpeg arg array for a known plan', () => {
  // Small hand-checkable plan (count 3, 3x1 grid) so the whole array is legible.
  const plan = { v: 1, interval: 1.5, count: 3, cols: 3, rows: 1, tileW: 160 };
  const args = buildStoryboardArgs('/in.mp4', '/out.sb.jpg', plan);
  assert.deepStrictEqual(args, [
    '-nostdin', '-loglevel', 'error',
    // one INPUT seek per frame, at 0, 1.5, 3.0s
    '-ss', '0', '-i', '/in.mp4',
    '-ss', '1.5', '-i', '/in.mp4',
    '-ss', '3', '-i', '/in.mp4',
    '-filter_complex',
    '[0:v]trim=end_frame=1,setpts=PTS-STARTPTS,scale=160:-2,setsar=1[s0];' +
    '[1:v]trim=end_frame=1,setpts=PTS-STARTPTS,scale=160:-2,setsar=1[s1];' +
    '[2:v]trim=end_frame=1,setpts=PTS-STARTPTS,scale=160:-2,setsar=1[s2];' +
    '[s0][s1][s2]concat=n=3:v=1:a=0[c];' +
    '[c]tile=3x1[o]',
    '-map', '[o]',
    '-frames:v', '1',
    '-an',
    '-q:v', '4',
    '-y', '/out.sb.jpg',
  ]);
});

test('buildStoryboardArgs: SEEK-based, never a full-file decode (the v1.93 fix)', () => {
  // The whole point of v1.93: no `fps=1/interval` filter (which forces ffmpeg
  // to decode the entire file). Reintroducing it must turn this red.
  const plan = planStoryboard(4000); // 100 frames, the MAX regime
  const args = buildStoryboardArgs('/in.mp4', '/o.sb.jpg', plan);
  assert.ok(!args.some(a => /fps\s*=/.test(a)), 'no fps filter anywhere (that = full decode)');
  // Exactly one `-ss` INPUT seek per sampled frame, each paired with its own -i.
  const ssCount = args.filter(a => a === '-ss').length;
  const iCount = args.filter(a => a === '-i').length;
  assert.strictEqual(ssCount, plan.count, 'one input seek per frame');
  assert.strictEqual(iCount, plan.count, 'one -i input per seek');
});

test('buildStoryboardArgs: seek timestamps land at exactly i*interval', () => {
  const plan = planStoryboard(79.714104); // 40 frames
  const args = buildStoryboardArgs('/in.mp4', '/o.sb.jpg', plan);
  // Collect the value following each '-ss'.
  const seeks = [];
  for (let i = 0; i < args.length; i++) if (args[i] === '-ss') seeks.push(Number(args[i + 1]));
  assert.strictEqual(seeks.length, plan.count);
  seeks.forEach((t, i) => {
    assert.ok(Math.abs(t - i * plan.interval) <= 0.0005, `seek ${i} = ${t} ~= ${i * plan.interval}`);
  });
  assert.strictEqual(seeks[0], 0, 'frame 0 seeks to the start');
});

test('buildStoryboardArgs: output geometry matches the descriptor grid', () => {
  // The sprite the client renders MUST be the plan's cols x rows of count
  // frames - otherwise already-generated sprites and new ones disagree.
  const plan = planStoryboard(300); // some mid clip
  const args = buildStoryboardArgs('/in.mp4', '/o.sb.jpg', plan);
  const fc = args[args.indexOf('-filter_complex') + 1];
  assert.match(fc, new RegExp(`concat=n=${plan.count}:v=1:a=0`), 'concat count == plan.count');
  assert.match(fc, new RegExp(`tile=${plan.cols}x${plan.rows}`), 'tile grid == plan cols x rows');
  assert.match(fc, new RegExp(`scale=${plan.tileW}:-2`), 'tiles scaled to plan.tileW');
});

test('buildStoryboardArgs: paths are opaque argv elements (no shell interpolation)', () => {
  // A path with shell metacharacters must survive as ONE array element - the
  // caller uses execFile/spawn with this array, never a shell string.
  const evil = '/media/a; rm -rf ~ && echo $(whoami).mp4';
  const out = '/t/`id`.sb.jpg';
  const plan = planStoryboard(100);
  const args = buildStoryboardArgs(evil, out, plan);
  assert.ok(args.includes(evil), 'source path passes through verbatim as a single element');
  assert.ok(args.includes(out), 'output path passes through verbatim as a single element');
  // no element concatenates the two (would signal a shell string was built)
  assert.ok(!args.some(a => a.includes(evil) && a.includes(out)));
  assert.strictEqual(args[args.length - 1], out, 'output is the final arg after -y');
});
