'use strict';

// [UNIT] v1.83 T2/T3 - cropAvatarFile's contract + the wiring. The crop MODAL is
// canvas/browser-only (jsdom has no 2d context), so here we bind the graceful
// FALLBACK (no real canvas -> resolve the raw file, AC6) + the null/no-file
// paths, and a source lock that BOTH upload entry points route through
// cropAvatarFile before POSTing (AC3/S4). The pixel geometry is bound in
// avatar-crop-geometry.test.js.

const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const COMMON = require.resolve('../../public/js/common.js');
let dom;

function fresh() {
  delete global.document; delete global.window;
  delete require.cache[COMMON];
  const common = require(COMMON); // boot skipped (no document at require)
  dom = new JSDOM('<!DOCTYPE html><body></body>', { url: 'http://localhost/' });
  global.window = dom.window;
  global.document = dom.window.document;
  return common;
}
afterEach(() => {
  if (dom) { dom.window.close(); dom = null; }
  delete global.window; delete global.document;
  delete require.cache[COMMON];
});

test('cropAvatarFile: no canvas 2d (jsdom) -> resolves the RAW file (graceful fallback, AC6)', async () => {
  const { cropAvatarFile } = fresh();
  // jsdom's canvas has no 2d context, so the feature-detect fails and we upload
  // the source file unchanged (the server cap then applies, exactly as pre-v1.83).
  const file = { type: 'image/png', name: 'x.png' };
  const out = await cropAvatarFile(file);
  assert.strictEqual(out, file, 'the original file is returned when the cropper cannot run');
});

test('cropAvatarFile: a missing file resolves null (nothing to upload)', async () => {
  const { cropAvatarFile } = fresh();
  assert.strictEqual(await cropAvatarFile(null), null);
  assert.strictEqual(await cropAvatarFile(undefined), null);
});

test('AC3/S4: BOTH upload entry points crop before POSTing - never a raw file on the happy path', () => {
  const fs = require('node:fs');
  const strip = (p) => fs.readFileSync(require.resolve(p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  for (const [label, rel] of [['menu', '../../public/js/common.js'], ['settings', '../../public/js/setup.js']]) {
    const src = strip(rel);
    // The avatar POST body is the CROPPED result, and a cropAvatarFile call
    // precedes it. A `body: file` on the avatar POST would be the raw-upload bug.
    assert.match(src, /const cropped = await cropAvatarFile\(file\)/, `${label}: crops the picked file first`);
    assert.match(src, /\/api\/me\/avatar'[\s\S]{0,120}body: cropped/, `${label}: uploads the cropped Blob, not the raw file`);
  }
});
