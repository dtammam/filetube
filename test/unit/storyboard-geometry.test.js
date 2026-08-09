'use strict';

// [UNIT] v1.92 storyboard sprites - the PURE client render geometry from
// public/js/player.js (shared with the grid card preview via
// window.FileTube.storyboard). Divergent fixtures: the sprite background
// percentage uses col/(cols-1), NOT col/cols - a fixture at column 3 of 10
// distinguishes them (33.33% vs 30%). floor-vs-round for frame lookup is
// distinguished by an interval that lands between two frames.
const { test } = require('node:test');
const assert = require('node:assert');
const { storyboardFrameForTime, storyboardTile } = require('../../public/js/player.js');

const approx = (a, b, eps = 1e-4) => assert.ok(Math.abs(a - b) < eps, `${a} ~= ${b}`);

// ---- storyboardFrameForTime -------------------------------------------------

test('frameForTime: floor(t/interval), clamped to [0, count-1]', () => {
  const geom = { interval: 2, count: 10 };
  assert.strictEqual(storyboardFrameForTime(0, geom, 20), 0);
  assert.strictEqual(storyboardFrameForTime(3, geom, 20), 1, 'floor(3/2)=1, NOT round(1.5)=2');
  assert.strictEqual(storyboardFrameForTime(3.99, geom, 20), 1);
  assert.strictEqual(storyboardFrameForTime(4, geom, 20), 2);
  assert.strictEqual(storyboardFrameForTime(19, geom, 20), 9, 'clamped to count-1');
  assert.strictEqual(storyboardFrameForTime(1000, geom, 20), 9);
  assert.strictEqual(storyboardFrameForTime(-5, geom, 20), 0, 'negative clamps to 0');
});

test('frameForTime: falls back to duration/count when interval is absent', () => {
  const geom = { interval: 0, count: 10 };
  assert.strictEqual(storyboardFrameForTime(5, geom, 20), 2, 'interval=20/10=2 -> floor(5/2)=2');
});

test('frameForTime: degenerate geom -> frame 0', () => {
  assert.strictEqual(storyboardFrameForTime(5, { count: 0 }, 20), 0);
  assert.strictEqual(storyboardFrameForTime(5, null, 20), 0);
});

// ---- storyboardTile ----------------------------------------------------------

test('tile: first frame is top-left, full-grid background-size', () => {
  const t = storyboardTile(0, { cols: 10, rows: 4, count: 40 });
  assert.strictEqual(t.col, 0);
  assert.strictEqual(t.row, 0);
  approx(t.posXPct, 0);
  approx(t.posYPct, 0);
  assert.strictEqual(t.sizeXPct, 1000, 'cols*100');
  assert.strictEqual(t.sizeYPct, 400, 'rows*100');
});

test('tile: column/row percentage uses col/(cols-1), not col/cols (divergent)', () => {
  const t = storyboardTile(13, { cols: 10, rows: 4, count: 40 }); // col 3, row 1
  assert.strictEqual(t.col, 3);
  assert.strictEqual(t.row, 1);
  approx(t.posXPct, (3 / 9) * 100); // 33.333..., NOT 30
  approx(t.posYPct, (1 / 3) * 100); // 33.333..., NOT 25
});

test('tile: last frame is bottom-right at 100%/100%', () => {
  const t = storyboardTile(39, { cols: 10, rows: 4, count: 40 });
  assert.strictEqual(t.col, 9);
  assert.strictEqual(t.row, 3);
  approx(t.posXPct, 100);
  approx(t.posYPct, 100);
});

test('tile: out-of-range index clamps to last frame; negative to first', () => {
  const geom = { cols: 10, rows: 4, count: 40 };
  assert.strictEqual(storyboardTile(999, geom).index, 39);
  assert.strictEqual(storyboardTile(-3, geom).index, 0);
});

test('tile: single-column grid -> posX 0 (no divide-by-zero)', () => {
  const t = storyboardTile(2, { cols: 1, rows: 5, count: 5 });
  assert.strictEqual(t.col, 0);
  assert.strictEqual(t.row, 2);
  approx(t.posXPct, 0);
  approx(t.posYPct, (2 / 4) * 100); // 50
  assert.strictEqual(t.sizeXPct, 100);
  assert.strictEqual(t.sizeYPct, 500);
});
