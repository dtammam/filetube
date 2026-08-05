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
  delete global.window; delete global.document; delete global.URL; delete global.Image;
  delete require.cache[COMMON];
});
const tick = () => new Promise((r) => setTimeout(r, 0));

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

// ---- canvas-stubbed harness: binds the modal lifecycle jsdom can't run --------
function freshWithCanvas(tracker) {
  const common = fresh(); // jsdom document set, boot skipped
  const win = dom.window;
  win.HTMLCanvasElement.prototype.getContext = function () { return { clearRect() {}, drawImage() {} }; };
  win.HTMLCanvasElement.prototype.toBlob = function (cb, type) { cb({ type: type || 'image/jpeg', size: 1234 }); };
  global.URL = { createObjectURL: () => { tracker.created += 1; return 'blob:stub'; }, revokeObjectURL: () => { tracker.revoked += 1; } };
  global.Image = class {
    set src(_v) { this.naturalWidth = 100; this.naturalHeight = 100; if (this.onload) setTimeout(() => this.onload(), 0); }
  };
  return common;
}
const afterEachCanvas = () => { delete global.URL; delete global.Image; };

test('S3 (stubbed canvas): Save resolves a jpeg Blob and revokes the object URL exactly once (no leak)', async () => {
  const tracker = { created: 0, revoked: 0 };
  const common = freshWithCanvas(tracker);
  try {
    const p = common.cropAvatarFile({ type: 'image/png' });
    await tick(); // Image.onload -> modal builds
    const backdrop = global.document.querySelector('.avatar-crop-backdrop');
    assert.ok(backdrop, 'the modal opened');
    backdrop.querySelector('.btn-primary').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    const out = await p;
    assert.ok(out && out.type === 'image/jpeg', 'Save produced a jpeg Blob');
    assert.strictEqual(tracker.created, tracker.revoked, 'object URL created == revoked (no leak)');
    assert.ok(tracker.revoked >= 1, 'the URL was actually revoked');
    assert.strictEqual(global.document.querySelector('.avatar-crop-backdrop'), null, 'the modal was removed');
  } finally { afterEachCanvas(); }
});

test('S3 (stubbed canvas): Cancel-then-Save settles ONCE as null (the double-settle guard)', async () => {
  const tracker = { created: 0, revoked: 0 };
  const common = freshWithCanvas(tracker);
  try {
    const p = common.cropAvatarFile({ type: 'image/png' });
    await tick();
    const backdrop = global.document.querySelector('.avatar-crop-backdrop');
    backdrop.querySelectorAll('.btn')[0].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); // Cancel
    backdrop.querySelector('.btn-primary').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); // late Save
    assert.strictEqual(await p, null, 'the first settle (Cancel) wins; the late Save is eaten');
    // The `settled` guard's REAL job: cleanup runs EXACTLY once (Promise
    // resolve-once alone makes `await p === null` true even without the guard, so
    // that assertion does not bind it - this one does).
    assert.strictEqual(tracker.revoked, 1, 'cleanup ran exactly once (the settled guard)');
  } finally { afterEachCanvas(); }
});

test('S3 (stubbed canvas): a second cropAvatarFile while one is open declines as null (single-instance)', async () => {
  const tracker = { created: 0, revoked: 0 };
  const common = freshWithCanvas(tracker);
  try {
    const first = common.cropAvatarFile({ type: 'image/png' });
    await tick();
    assert.strictEqual(global.document.querySelectorAll('.avatar-crop-backdrop').length, 1, 'one modal open');
    assert.strictEqual(await common.cropAvatarFile({ type: 'image/png' }), null, 'the second call declines');
    assert.strictEqual(global.document.querySelectorAll('.avatar-crop-backdrop').length, 1, 'still exactly one modal');
    // close the first so the promise settles and nothing leaks.
    global.document.querySelector('.avatar-crop-backdrop').querySelectorAll('.btn')[0]
      .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    assert.strictEqual(await first, null);
  } finally { afterEachCanvas(); }
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
