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
  buildStoryboardFrameArgs,
  buildStoryboardAssembleArgs,
  storyboardSeekTime,
  storyboardSeekTimes,
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

// ---- storyboardSeekTimes: one seek per frame, at i*interval -----------------

test('storyboardSeekTimes: exactly plan.count times, frame i at i*interval', () => {
  const plan = planStoryboard(79.714104); // 40 frames
  const times = storyboardSeekTimes(plan);
  assert.strictEqual(times.length, plan.count, 'one seek time per frame');
  assert.strictEqual(times[0], '0', 'frame 0 seeks to the start');
  times.forEach((t, i) => {
    assert.ok(Math.abs(Number(t) - i * plan.interval) <= 0.0005, `seek ${i} = ${t} ~= ${i * plan.interval}`);
    assert.strictEqual(t, storyboardSeekTime(i, plan.interval), 'matches the single-frame helper');
  });
  // Last seek is strictly before EOF: (count-1)*interval = duration - interval.
  assert.ok(Number(times[times.length - 1]) < 79.714104, 'last seek never over-runs EOF');
});

// ---- buildStoryboardFrameArgs: SINGLE-input grab (the bounded-memory fix) ----

test('buildStoryboardFrameArgs: exact single-input grab arg array (lossless PNG, no -q:v)', () => {
  const args = buildStoryboardFrameArgs('/in.mp4', '/tmp/.sbtmp-abc/f007.png', '18.375', 160);
  assert.deepStrictEqual(args, [
    '-nostdin', '-loglevel', 'error',
    '-ss', '18.375',
    '-i', '/in.mp4',
    '-frames:v', '1',
    '-an',
    '-vf', 'scale=160:-2',
    '-y', '/tmp/.sbtmp-abc/f007.png',
  ]);
  // No -q:v: a PNG intermediate is lossless, so the only lossy re-encode is the
  // single assembly pass (no double JPEG recompression vs v1.92).
  assert.ok(!args.includes('-q:v'), 'grab carries no -q:v (lossless intermediate)');
});

test('buildStoryboardFrameArgs: EXACTLY ONE -i input (never the v1.93.0 N-input blowup)', () => {
  // The whole v1.93.1 fix: memory is bounded because each grab holds ONE source
  // context. A regression that fed multiple `-i src` here would re-open the
  // 9.3 GB door - this asserts a single input and no concat/tile in the grab.
  const args = buildStoryboardFrameArgs('/in.mp4', '/t/f000.png', '0', 160);
  assert.strictEqual(args.filter(a => a === '-i').length, 1, 'exactly one input');
  assert.strictEqual(args.filter(a => a === '-ss').length, 1, 'exactly one seek');
  assert.ok(!args.some(a => /concat|tile=|filter_complex/.test(a)), 'no multi-input assembly in a grab');
  assert.ok(!args.some(a => /fps\s*=/.test(a)), 'no full-file-decode fps filter');
  assert.strictEqual(args[args.length - 1], '/t/f000.png', 'frame output is the final arg');
});

// ---- buildStoryboardAssembleArgs: image2 sequence -> tile grid ---------------

test('buildStoryboardAssembleArgs: exact tile-assembly arg array', () => {
  const args = buildStoryboardAssembleArgs('/tmp/.sbtmp-abc/f%03d.png', '/out.sb.jpg', 10, 4);
  assert.deepStrictEqual(args, [
    '-nostdin', '-loglevel', 'error',
    '-start_number', '0',
    '-i', '/tmp/.sbtmp-abc/f%03d.png',
    '-frames:v', '1',
    '-vf', 'tile=10x4',
    '-q:v', '4',
    '-y', '/out.sb.jpg',
  ]);
});

test('buildStoryboardAssembleArgs: reads a sequence, tiles to the descriptor grid, decodes no source', () => {
  const plan = planStoryboard(300);
  const args = buildStoryboardAssembleArgs('/t/f%03d.png', '/o.sb.jpg', plan.cols, plan.rows);
  // The tile grid MUST equal the descriptor so old and new sprites agree.
  assert.ok(args.includes(`tile=${plan.cols}x${plan.rows}`), 'tile grid == plan cols x rows');
  // Exactly one input, and it is the numbered SEQUENCE pattern, not the source.
  assert.strictEqual(args.filter(a => a === '-i').length, 1, 'one image2 sequence input');
  assert.ok(args.includes('/t/f%03d.png'), 'input is the frame-sequence pattern');
  assert.ok(args.includes('-start_number') && args[args.indexOf('-start_number') + 1] === '0', 'sequence starts at 0');
});

test('storyboard arg builders: paths are opaque argv elements (no shell interpolation)', () => {
  // execFile/spawn with these arrays, never a shell string.
  const evil = '/media/a; rm -rf ~ && echo $(whoami).mp4';
  const out = '/t/`id`.jpg';
  const g = buildStoryboardFrameArgs(evil, out, '0', 160);
  assert.ok(g.includes(evil), 'src passes through verbatim as one element');
  assert.strictEqual(g[g.length - 1], out, 'output is the final arg after -y');
  assert.ok(!g.some(a => a.includes(evil) && a.includes(out)), 'no element glues src+out (no shell string)');
  const a = buildStoryboardAssembleArgs(evil, out, 10, 4);
  assert.ok(a.includes(evil) && a[a.length - 1] === out, 'assemble args pass paths through verbatim');
});
