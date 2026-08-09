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

test('buildStoryboardArgs: exact FFmpeg arg array for a known plan', () => {
  const plan = { v: 1, interval: 1.99, count: 40, cols: 10, rows: 4, tileW: 160 };
  const args = buildStoryboardArgs('/in.mp4', '/out.sb.jpg', plan);
  assert.deepStrictEqual(args, [
    '-nostdin', '-loglevel', 'error',
    '-i', '/in.mp4',
    '-vf', 'fps=1/1.99,scale=160:-2,tile=10x4',
    '-frames:v', '1',
    '-an',
    '-q:v', '4',
    '-y', '/out.sb.jpg',
  ]);
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
