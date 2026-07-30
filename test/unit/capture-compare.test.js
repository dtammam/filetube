'use strict';
// [UNIT] Tier 3 capture harness - the Stop B compare logic's fixtures
// (dependency-free: tools/capture/png.js + compare.js run on node:zlib
// only, so these live in main CI and survive a capture-driver swap).
const { test } = require('node:test');
const assert = require('node:assert');
const { encode, decode } = require('../../tools/capture/png.js');
const { diffPair } = require('../../tools/capture/compare.js');

function img(w, h, paint) {
  const data = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [r, g, b] = paint(x, y);
    const o = (y * w + x) * 4;
    data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = 255;
  }
  return encode({ width: w, height: h, data });
}

test('png codec round-trips', () => {
  const buf = img(20, 10, (x, y) => [x * 10, y * 20, 128]);
  const d = decode(buf);
  assert.equal(d.width, 20); assert.equal(d.height, 10);
  assert.equal(d.data[(3 * 20 + 5) * 4], 50);
});

test('known-identical pair: zero changed pixels', () => {
  const a = img(40, 40, (x, y) => [x, y, 100]);
  assert.equal(diffPair(a, a, 16).changed, 0);
});

test('known-different pair: detected, magnitude sane, center inside the block', () => {
  const a = img(40, 40, () => [50, 50, 50]);
  const b = img(40, 40, (x, y) => (x >= 10 && x < 20 && y >= 10 && y < 20) ? [250, 50, 50] : [50, 50, 50]);
  const r = diffPair(a, b, 16);
  assert.equal(r.changed, 100);
  assert.ok(r.center.x >= 10 && r.center.x < 20);
});

test('antialiasing tolerance: sub-threshold shifts and ISOLATED single pixels are suppressed', () => {
  const a = img(40, 40, () => [100, 100, 100]);
  const sub = img(40, 40, () => [110, 100, 100]); // delta 10 < 16
  assert.equal(diffPair(a, sub, 16).changed, 0);
  const lone = img(40, 40, (x, y) => (x === 5 && y === 5) ? [255, 0, 0] : [100, 100, 100]);
  assert.equal(diffPair(a, lone, 16).changed, 0, 'a lone hot pixel with no hot neighbor is AA noise');
});

test('size mismatch reports, never throws', () => {
  const r = diffPair(img(10, 10, () => [0, 0, 0]), img(12, 10, () => [0, 0, 0]), 16);
  assert.equal(r.changed, -1);
  assert.match(r.note, /size mismatch/);
});
