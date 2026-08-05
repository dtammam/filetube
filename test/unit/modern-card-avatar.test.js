'use strict';

// [UNIT] v1.84 T5 - the per-card channel-avatar DECISION (common.js
// modernCardAvatar). Classic is byte-unchanged (kind:'none'); modern shows the
// real photo when the channel has one (the subscription/channel-avatar registry
// field), else the deterministic monogram with a colour for the caller's inline
// custom property. Determinism is bound so the same channel is stable across
// renders.

const { test } = require('node:test');
const assert = require('node:assert');
const { modernCardAvatar } = require('../../public/js/common.js');

test('classic (modernOn false): always {kind:"none"} - the classic card is unchanged', () => {
  assert.deepStrictEqual(modernCardAvatar('Chan', 'https://cdn/a.jpg', false), { kind: 'none' });
  assert.deepStrictEqual(modernCardAvatar('Chan', '', false), { kind: 'none' });
});

test('modern + a real avatar url -> {kind:"img", url}', () => {
  const d = modernCardAvatar('Chan', 'https://cdn/a.jpg', true);
  assert.strictEqual(d.kind, 'img');
  assert.strictEqual(d.url, 'https://cdn/a.jpg');
});

test('modern + no url -> deterministic {kind:"mono", glyph, color}', () => {
  const d1 = modernCardAvatar('Rick Astley', '', true);
  assert.strictEqual(d1.kind, 'mono');
  assert.ok(typeof d1.glyph === 'string' && d1.glyph.length >= 1);
  assert.ok(typeof d1.color === 'string' && d1.color.length > 0);
  // deterministic: same name -> same monogram (no per-render lottery)
  const d2 = modernCardAvatar('Rick Astley', null, true);
  assert.deepStrictEqual(d2, d1);
});

test('modern + empty/whitespace url falls back to the monogram (not a broken img)', () => {
  const d = modernCardAvatar('Chan', '   ', true);
  assert.strictEqual(d.kind, 'mono', 'a blank url is not a photo');
});
