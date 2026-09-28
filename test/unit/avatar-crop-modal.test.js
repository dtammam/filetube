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

// Sweep S9: the cropper is a ui.sheet dialog titled "Crop photo" (Cancel / Save ui-btns in
// its actions row). These helpers find it the way a user sees it.
const cropSheet = () => [...global.document.querySelectorAll('.ui-sheet')].find((s) => !s.classList.contains('is-closing')
  && s.querySelector('.ui-sheet__title') && s.querySelector('.ui-sheet__title').textContent === 'Crop photo');
const cropButton = (label) => [...cropSheet().querySelectorAll('.avatar-crop-actions .ui-btn')].find((b) => b.textContent === label);
const clickEl = (el) => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
// A closing sheet finishes on a fallback timer (no transitionend in jsdom).
const drain = async () => { for (let i = 0; i < 40 && global.document.querySelector('.ui-sheet'); i++) await new Promise((r) => setTimeout(r, 20)); };

test('S3 (stubbed canvas): Save resolves a jpeg Blob and revokes the object URL exactly once (no leak)', async () => {
  const tracker = { created: 0, revoked: 0 };
  const common = freshWithCanvas(tracker);
  try {
    const p = common.cropAvatarFile({ type: 'image/png' });
    await tick(); // Image.onload -> the dialog builds
    const sheet = cropSheet();
    assert.ok(sheet, 'the dialog opened as a ui.sheet titled "Crop photo"');
    assert.ok(sheet.classList.contains('ui-sheet--dialog'), 'a centred dialog');
    assert.ok(sheet.querySelector('.ui-sheet__body .avatar-crop canvas.avatar-crop-canvas'), 'the crop stage is its content');
    assert.strictEqual(global.document.querySelector('.avatar-crop-backdrop'), null, 'no bespoke backdrop');
    clickEl(cropButton('Save'));
    const out = await p;
    assert.ok(out && out.type === 'image/jpeg', 'Save produced a jpeg Blob');
    assert.strictEqual(tracker.created, tracker.revoked, 'object URL created == revoked (no leak)');
    assert.ok(tracker.revoked >= 1, 'the URL was actually revoked');
    await drain();
    assert.strictEqual(global.document.querySelector('.ui-sheet'), null, 'the dialog was removed');
  } finally { afterEachCanvas(); }
});

test('S3 (stubbed canvas): Cancel-then-Save settles ONCE as null (the double-settle guard)', async () => {
  const tracker = { created: 0, revoked: 0 };
  const common = freshWithCanvas(tracker);
  try {
    const p = common.cropAvatarFile({ type: 'image/png' });
    await tick();
    const save = cropButton('Save');
    clickEl(cropButton('Cancel'));
    clickEl(save); // a late Save on the closing dialog
    assert.strictEqual(await p, null, 'the first settle (Cancel) wins; the late Save is eaten');
    // The `settled` guard's REAL job: cleanup runs EXACTLY once (Promise
    // resolve-once alone makes `await p === null` true even without the guard, so
    // that assertion does not bind it - this one does).
    assert.strictEqual(tracker.revoked, 1, 'cleanup ran exactly once (the settled guard)');
    await drain();
  } finally { afterEachCanvas(); }
});

test('S3 (stubbed canvas): a double tap on Save resolves ONE blob and cleans up once', async () => {
  const tracker = { created: 0, revoked: 0 };
  const common = freshWithCanvas(tracker);
  try {
    const p = common.cropAvatarFile({ type: 'image/png' });
    await tick();
    const save = cropButton('Save');
    clickEl(save); clickEl(save);
    const out = await p;
    assert.ok(out && out.type === 'image/jpeg');
    assert.strictEqual(tracker.revoked, 1, 'one cleanup for two taps');
    await drain();
  } finally { afterEachCanvas(); }
});

// Sweep S9: every way out the sheet owns (Esc, the scrim, its Close) is a CANCEL - null,
// settled once, the object URL revoked once, the dialog gone.
for (const how of ['esc', 'scrim', 'close']) {
  test(`S9 (stubbed canvas): ${how} cancels - resolves null once and removes the dialog`, async () => {
    const tracker = { created: 0, revoked: 0 };
    const common = freshWithCanvas(tracker);
    try {
      const p = common.cropAvatarFile({ type: 'image/png' });
      await tick();
      const sheet = cropSheet();
      if (how === 'esc') global.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      else if (how === 'scrim') clickEl(global.document.querySelector('.ui-scrim'));
      else clickEl(sheet.querySelector('.ui-sheet__close'));
      assert.strictEqual(await p, null, how + ' is a cancel');
      assert.strictEqual(tracker.revoked, 1, 'cleaned up once');
      await drain();
      assert.strictEqual(global.document.querySelector('.ui-sheet'), null, 'the dialog is gone');
      // ...and the single-instance claim was released: a new crop opens.
      const again = common.cropAvatarFile({ type: 'image/png' });
      await tick();
      assert.ok(cropSheet(), 'a fresh cropper opens after the cancel');
      clickEl(cropButton('Cancel'));
      assert.strictEqual(await again, null);
      await drain();
    } finally { afterEachCanvas(); }
  });
}

test('S3 (stubbed canvas): a second cropAvatarFile while one is open declines as null (single-instance)', async () => {
  const tracker = { created: 0, revoked: 0 };
  const common = freshWithCanvas(tracker);
  try {
    const first = common.cropAvatarFile({ type: 'image/png' });
    // Sweep S9: the claim is taken at CALL time, so a second call before the first image
    // has even loaded declines too (the old DOM query could not see a dialog not yet built).
    assert.strictEqual(await common.cropAvatarFile({ type: 'image/png' }), null, 'a second call before the image loads declines');
    await tick();
    assert.strictEqual(global.document.querySelectorAll('.ui-sheet').length, 1, 'one dialog open');
    assert.strictEqual(await common.cropAvatarFile({ type: 'image/png' }), null, 'the second call declines');
    assert.strictEqual(global.document.querySelectorAll('.ui-sheet').length, 1, 'still exactly one dialog');
    assert.strictEqual(tracker.created, 1, 'the declined calls never even made an object URL');
    // close the first so the promise settles and nothing leaks.
    clickEl(cropButton('Cancel'));
    assert.strictEqual(await first, null);
    await drain();
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
