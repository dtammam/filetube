'use strict';

// [UNIT] Pocket Classic wheel test — the overlay lifecycle (setup.js).
//
// The DOM/native-switch shell is device-validated, but its LIFECYCLE is bound
// here because it holds two things that must be released: the overlay DOM
// (appended to <body>, outside the view root) and a body scroll-lock. Both
// axes are tested — the REVEAL (open builds + locks) and the CLEAR (close/
// destroy removes + unlocks) — and the clear axis is driven only after the
// overlay is actually present, so it can never pass vacuously.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const setup = require('../../public/js/setup.js');

const SETUP_HTML = fs.readFileSync(path.join(__dirname, '../../public/setup.html'), 'utf8');
const SETUP_JS = fs.readFileSync(path.join(__dirname, '../../public/js/setup.js'), 'utf8');
const MD_ROOT = SETUP_HTML.match(/<div class="md-root" data-md-page="setup"[\s\S]*?<\/div><!-- \/\.md-root -->/);

function load() {
  assert.ok(MD_ROOT, 'setup.html carries the .md-root wrapper');
  const dom = new JSDOM('<!DOCTYPE html><html data-theme="2021"><body>' + MD_ROOT[0] + '</body></html>',
    { url: 'http://localhost/setup.html', pretendToBeVisual: true });
  global.window = dom.window; global.document = dom.window.document;
  global.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
  global.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
  const controller = new dom.window.AbortController();
  return { dom, doc: dom.window.document, signal: controller.signal };
}
function unload(dom) {
  delete global.window; delete global.document;
  delete global.requestAnimationFrame; delete global.cancelAnimationFrame;
  dom.window.close();
}

// ---- the button exists and is wired into the view lifecycle ----------------

test('setup.html: an "Open Pocket Classic wheel test" button lives in Experimental (#wheel-cal-open)', () => {
  assert.match(SETUP_HTML, /<button type="button" class="btn" id="wheel-cal-open">Open Pocket Classic wheel test<\/button>/);
  const exp = /data-collapse-key="experimental"[\s\S]*?<\/details>/.exec(SETUP_HTML);
  assert.ok(exp && /id="wheel-cal-open"/.test(exp[0]), 'the button sits inside the Experimental section');
});

test('setup.js wires the button in init() and tears the overlay down in destroy() (the lock cannot strand on nav-away)', () => {
  const initMatch = /function init\(root\) \{([\s\S]*?)\n\}/.exec(SETUP_JS);
  assert.ok(initMatch && /wireWheelCalControl\(controller\.signal\)/.test(initMatch[1]), 'init() calls wireWheelCalControl');
  const destroyMatch = /function destroy\(\) \{([\s\S]*?)\n\}/.exec(SETUP_JS);
  assert.ok(destroyMatch && /closeWheelCal\(\)/.test(destroyMatch[1]), 'destroy() calls closeWheelCal');
});

// ---- REVEAL axis -----------------------------------------------------------

test('openWheelCal builds the overlay on <body> and locks body scroll', () => {
  const { dom, doc, signal } = load();
  try {
    assert.strictEqual(doc.querySelector('.whcal-overlay'), null, 'no overlay before open');
    setup.openWheelCal(signal);
    const overlay = doc.querySelector('.whcal-overlay');
    assert.ok(overlay, 'overlay is appended to the document');
    assert.ok(overlay.querySelector('.whcal-wheel'), 'the wheel is built');
    assert.ok(overlay.querySelector('.whcal-bar-outer .whcal-fill'), 'the radius-band bars are built');
    assert.strictEqual(doc.body.style.position, 'fixed', 'body scroll is locked while open');
  } finally { setup.closeWheelCal(); unload(dom); }
});

// ---- CLEAR axis (populate FIRST, then drive the non-showing path) -----------

test('closeWheelCal removes the overlay AND restores body scroll', () => {
  const { dom, doc, signal } = load();
  try {
    setup.openWheelCal(signal);                              // populate first
    assert.ok(doc.querySelector('.whcal-overlay'), 'precondition: overlay present');
    assert.strictEqual(doc.body.style.position, 'fixed', 'precondition: body locked');
    setup.closeWheelCal();                                   // then the clear axis
    assert.strictEqual(doc.querySelector('.whcal-overlay'), null, 'overlay removed on close');
    assert.strictEqual(doc.body.style.position, '', 'body scroll restored on close');
  } finally { setup.closeWheelCal(); unload(dom); }
});

test('the close button, wired through the real overlay, tears it down', () => {
  const { dom, doc, signal } = load();
  try {
    setup.openWheelCal(signal);
    doc.querySelector('.whcal-close-btn').click();
    assert.strictEqual(doc.querySelector('.whcal-overlay'), null, 'Close removes the overlay');
    assert.strictEqual(doc.body.style.position, '', 'Close restores body scroll');
  } finally { setup.closeWheelCal(); unload(dom); }
});

// ---- idempotence + the real button path ------------------------------------

test('openWheelCal is idempotent — a second open never stacks a second overlay', () => {
  const { dom, doc, signal } = load();
  try {
    setup.openWheelCal(signal);
    setup.openWheelCal(signal);
    assert.strictEqual(doc.querySelectorAll('.whcal-overlay').length, 1, 'exactly one overlay');
  } finally { setup.closeWheelCal(); unload(dom); }
});

test('clicking #wheel-cal-open opens the tool through wireWheelCalControl', () => {
  const { dom, doc, signal } = load();
  try {
    setup.wireWheelCalControl(signal);
    doc.getElementById('wheel-cal-open').click();
    assert.ok(doc.querySelector('.whcal-overlay'), 'the button opens the tool');
  } finally { setup.closeWheelCal(); unload(dom); }
});

// ---- native-switch gate (jsdom has no <input switch>) -----------------------

test('with no native switch (jsdom), the tool still opens, mounts no ghost, and shows a visuals-only note', () => {
  const { dom, doc, signal } = load();
  try {
    setup.openWheelCal(signal);
    const note = doc.querySelector('.whcal-note');
    assert.ok(note && !note.hidden, 'the visuals-only note is shown when the switch is unsupported');
    assert.strictEqual(doc.querySelector('.mms-haptic-ghost'), null, 'no ghost element is mounted without native support');
  } finally { setup.closeWheelCal(); unload(dom); }
});
