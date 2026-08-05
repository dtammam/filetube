'use strict';

// [UNIT] v1.83 T1 - the pure avatar-crop geometry (common.js). The cover
// minimum, the offset clamp (no gap inside the circle), and the source rectangle
// drawImage copies. DOM-free; requires common.js with no document so boot is
// skipped (the v1.78.1 hang lesson).

const { test } = require('node:test');
const assert = require('node:assert');

delete global.document; delete global.window;
const { avatarMinScale, clampAvatarOffset, avatarSourceRect } = require('../../public/js/common.js');

// A 200x200 viewport with a 160px circle (the shape the modal uses at 1x).
const W = 200, H = 200, D = 160;

test('avatarMinScale: cover = D / min(dimension), for landscape / portrait / square', () => {
  assert.strictEqual(avatarMinScale(400, 300, D), D / 300, 'landscape: bound by the shorter (height)');
  assert.strictEqual(avatarMinScale(300, 400, D), D / 300, 'portrait: bound by the shorter (width)');
  assert.strictEqual(avatarMinScale(500, 500, D), D / 500, 'square');
  // A source SMALLER than the circle must be scaled UP past 1 to cover.
  assert.ok(avatarMinScale(80, 80, D) > 1, 'a tiny source scales up to cover (min > 1)');
});

test('clampAvatarOffset: at cover scale the image is pinned centred (only one legal offset)', () => {
  // Square source at exactly cover scale: imgW*s == imgH*s == D, so the only
  // offset that covers the DxD box is the centred one.
  const imgW = 500, imgH = 500;
  const s = avatarMinScale(imgW, imgH, D); // D/500
  const centred = { ox: (W - imgW * s) / 2, oy: (H - imgH * s) / 2 };
  for (const trial of [{ ox: 0, oy: 0 }, { ox: 999, oy: -999 }, centred]) {
    const c = clampAvatarOffset(trial.ox, trial.oy, s, imgW, imgH, W, H, D);
    assert.ok(Math.abs(c.ox - centred.ox) < 1e-9 && Math.abs(c.oy - centred.oy) < 1e-9,
      `every offset clamps to the single centred one at cover scale (trial ${JSON.stringify(trial)})`);
  }
});

test('clampAvatarOffset: zoomed in, pan is bounded so no gap ever shows inside the circle', () => {
  const imgW = 500, imgH = 500;
  const s = avatarMinScale(imgW, imgH, D) * 2; // zoomed 2x past cover -> room to pan
  // The legal offset window per axis is [ (W+D)/2 - imgW*s , (W-D)/2 ].
  const oxMax = (W - D) / 2;               // 20
  const oxMin = (W + D) / 2 - imgW * s;    // negative
  // Push far past each edge; the clamp must land exactly on the boundary, and the
  // boundary must keep the circle covered (image edge at/over the circle edge).
  const pushed = clampAvatarOffset(1e6, 1e6, s, imgW, imgH, W, H, D);
  assert.ok(Math.abs(pushed.ox - oxMax) < 1e-9, 'over-pan right pins the left edge to circle-left');
  const pushedNeg = clampAvatarOffset(-1e6, -1e6, s, imgW, imgH, W, H, D);
  assert.ok(Math.abs(pushedNeg.ox - oxMin) < 1e-9, 'over-pan left pins the right edge to circle-right');
  // Invariant at the boundary: image still covers the circle box on both sides.
  assert.ok(pushed.ox <= oxMax + 1e-9 && pushed.ox + imgW * s >= (W + D) / 2 - 1e-9, 'covered at the right-pinned boundary');
  assert.ok(pushedNeg.ox <= oxMax + 1e-9 && pushedNeg.ox + imgW * s >= (W + D) / 2 - 1e-9, 'covered at the left-pinned boundary');
});

test('avatarSourceRect: centred cover scale reads the centred DxD-worth of source, square', () => {
  const imgW = 500, imgH = 500;
  const s = avatarMinScale(imgW, imgH, D); // D/500
  const centred = clampAvatarOffset(0, 0, s, imgW, imgH, W, H, D);
  const r = avatarSourceRect(s, centred.ox, centred.oy, W, H, D);
  // sSize = D/s = D/(D/500) = 500 -> the whole (square) image is under the circle box.
  assert.ok(Math.abs(r.sSize - 500) < 1e-9, 'source square = full image at cover');
  assert.ok(Math.abs(r.sx - 0) < 1e-9 && Math.abs(r.sy - 0) < 1e-9, 'reads from the image origin');
});

test('avatarSourceRect: a clamped pan never reads outside the image [0..imgW]x[0..imgH]', () => {
  const imgW = 800, imgH = 600;
  const s = avatarMinScale(imgW, imgH, D) * 1.5;
  for (const trial of [{ ox: 1e6, oy: 1e6 }, { ox: -1e6, oy: -1e6 }, { ox: 0, oy: 0 }]) {
    const c = clampAvatarOffset(trial.ox, trial.oy, s, imgW, imgH, W, H, D);
    const r = avatarSourceRect(s, c.ox, c.oy, W, H, D);
    assert.ok(r.sx >= -1e-6 && r.sy >= -1e-6, `source rect origin in-bounds (${JSON.stringify(trial)})`);
    assert.ok(r.sx + r.sSize <= imgW + 1e-6, 'source rect right edge in-bounds');
    assert.ok(r.sy + r.sSize <= imgH + 1e-6, 'source rect bottom edge in-bounds');
  }
});
