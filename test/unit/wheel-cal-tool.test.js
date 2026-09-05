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

test('setup.js wires the button in init() (the opener is reachable on view mount)', () => {
  const initMatch = /function init\(root\) \{([\s\S]*?)\n\}/.exec(SETUP_JS);
  assert.ok(initMatch, 'init(root) source found');
  // matches the real CALL statement; no comment carries this exact signature
  assert.match(initMatch[1], /wireWheelCalControl\(controller\.signal\);/, 'init() calls wireWheelCalControl');
});

// A dispatcher that carries pointerId on a plain Event - jsdom's MouseEvent
// SILENTLY DROPS pointerId (the v1.271 scar), so never build these from one.
function pointer(win, el, type, id, x, y) {
  const ev = new win.Event(type, { bubbles: true });
  ev.pointerId = id; ev.clientX = x; ev.clientY = y;
  el.dispatchEvent(ev);
  return ev;
}

test('destroy() tears the overlay down and restores body scroll — the nav-away lock cannot strand (bound BEHAVIOURALLY, not by matching a comment)', () => {
  const { dom, doc, signal } = load();
  try {
    setup.openWheelCal(signal);                 // overlay open, body locked
    assert.ok(doc.querySelector('.whcal-overlay'), 'precondition: overlay present');
    assert.strictEqual(doc.body.style.position, 'fixed', 'precondition: body locked');
    setup.destroy();                            // simulate an in-app nav-away
    assert.strictEqual(doc.querySelector('.whcal-overlay'), null, 'destroy() removes the overlay');
    assert.strictEqual(doc.body.style.position, '', 'destroy() restores body scroll (no strand)');
  } finally { setup.closeWheelCal(); unload(dom); }
});

test('a stray second finger neither hijacks nor ends the active gesture (one gesture at a time + owning-pointer end)', () => {
  const { dom, doc, signal } = load();
  try {
    setup.openWheelCal(signal);
    const wheel = doc.querySelector('.whcal-wheel');
    const finger = doc.querySelector('.whcal-finger');
    pointer(dom.window, wheel, 'pointerdown', 1, 5, 5);   // finger 1 starts (non-centre)
    assert.strictEqual(finger.style.opacity, '1', 'gesture active after finger 1 down');
    pointer(dom.window, wheel, 'pointerdown', 2, 6, 6);   // finger 2 must be ignored (no re-arm)
    pointer(dom.window, wheel, 'pointerup', 2, 6, 6);     // finger 2 up must NOT end finger 1
    assert.strictEqual(finger.style.opacity, '1', 'a second finger neither hijacks nor ends the gesture');
    pointer(dom.window, wheel, 'pointerup', 1, 5, 5);     // the owning pointer ends it
    assert.strictEqual(finger.style.opacity, '0', 'the owning pointer ends the gesture');
  } finally { setup.closeWheelCal(); unload(dom); }
});

// Capture is the suspected native-buzz killer (Dean, on-device: earlier grab =
// worse buzz). 'Off' must NEVER grab the pointer - it is the confirmation lever,
// so a regression that quietly re-grabbed in Off would defeat the whole test.
function selectCap(doc, value) {
  const btn = [...doc.querySelectorAll('[data-seg="cap"] button')].find((b) => b.getAttribute('data-cap') === value);
  assert.ok(btn, `a Capture "${value}" button exists`);
  btn.click();
}
test('Capture: Off never grabs the pointer across a full drag (the setPointerCapture that kills the buzz is isolated out)', () => {
  const { dom, doc, signal } = load();
  try {
    setup.openWheelCal(signal);
    const wheel = doc.querySelector('.whcal-wheel');
    let captures = 0;
    wheel.setPointerCapture = () => { captures++; };
    wheel.releasePointerCapture = () => {};
    selectCap(doc, 'off');
    pointer(dom.window, wheel, 'pointerdown', 1, 5, 5);
    pointer(dom.window, wheel, 'pointermove', 1, 40, 40);   // well past the 8px threshold
    pointer(dom.window, wheel, 'pointerup', 1, 40, 40);
    assert.strictEqual(captures, 0, 'Off must never call setPointerCapture');
  } finally { setup.closeWheelCal(); unload(dom); }
});
test('the other capture modes DO grab (After 8px on the 8px threshold, On press immediately) - so Off is a real contrast, not a no-op', () => {
  const { dom, doc, signal } = load();
  try {
    setup.openWheelCal(signal);
    const wheel = doc.querySelector('.whcal-wheel');
    let captures = 0;
    wheel.setPointerCapture = () => { captures++; };
    wheel.releasePointerCapture = () => {};
    // default mode is After 8px: no grab on press, grab once past 8px
    pointer(dom.window, wheel, 'pointerdown', 1, 5, 5);
    assert.strictEqual(captures, 0, 'After 8px does not grab on the initial press');
    pointer(dom.window, wheel, 'pointermove', 1, 40, 40);
    assert.ok(captures >= 1, 'After 8px grabs once the finger passes 8px');
    pointer(dom.window, wheel, 'pointerup', 1, 40, 40);
    // On press: grab on the very down
    captures = 0;
    selectCap(doc, 'press');
    pointer(dom.window, wheel, 'pointerdown', 2, 5, 5);
    assert.ok(captures >= 1, 'On press grabs immediately on pointerdown');
    pointer(dom.window, wheel, 'pointerup', 2, 5, 5);
  } finally { setup.closeWheelCal(); unload(dom); }
});

// The Switch-grid EXPERIMENT: iOS 26.5+ closed programmatic re-ticks, so the
// only surviving path is a GENUINE finger crossing a REAL switch. The grid of
// real switches + the genuine-toggle counter are the instrument that answers
// whether any continuous web haptic path survives - so the counter must count.
function selectEngine(doc, value) {
  const btn = [...doc.querySelectorAll('[data-seg="engine"] button')].find((b) => b.getAttribute('data-engine') === value);
  assert.ok(btn, `an Engine "${value}" button exists`);
  btn.click();
}
test('the Switch-grid engine builds a full 12x12 grid of REAL <input switch> tiles', () => {
  const { dom, doc, signal } = load();
  try {
    setup.openWheelCal(signal);
    const grid = doc.querySelector('.whcal-grid');
    assert.ok(grid, 'the grid container exists');
    const switches = grid.querySelectorAll('input[type="checkbox"][switch].whcal-grid-sw');
    assert.strictEqual(switches.length, 144, '12x12 = 144 real switch tiles');
  } finally { setup.closeWheelCal(); unload(dom); }
});
test('Engine: Switch grid reveals the grid, and Ghost hides it again (both axes)', () => {
  const { dom, doc, signal } = load();
  try {
    setup.openWheelCal(signal);
    const grid = doc.querySelector('.whcal-grid');
    assert.ok(grid.hidden, 'grid hidden under the default Ghost engine');
    selectEngine(doc, 'grid');
    assert.ok(!grid.hidden, 'grid shown under Switch-grid');
    selectEngine(doc, 'ghost');
    assert.ok(grid.hidden, 'grid hidden again back on Ghost');
  } finally { setup.closeWheelCal(); unload(dom); }
});
test('in Switch-grid mode the wheel runs NO ghost gesture - the real switches own the touch (a setPointerCapture would steal it)', () => {
  const { dom, doc, signal } = load();
  try {
    setup.openWheelCal(signal);
    const wheel = doc.querySelector('.whcal-wheel');
    const finger = doc.querySelector('.whcal-finger');
    let captures = 0; wheel.setPointerCapture = () => { captures++; };
    selectEngine(doc, 'grid');
    pointer(dom.window, wheel, 'pointerdown', 1, 5, 5);
    pointer(dom.window, wheel, 'pointermove', 1, 40, 40);
    assert.strictEqual(finger.style.opacity, '', 'no ghost gesture started (the finger cursor never shows)');
    assert.strictEqual(captures, 0, 'grid mode never grabs the pointer');
  } finally { setup.closeWheelCal(); unload(dom); }
});
test('a GENUINE toggle of a grid switch increments the "Genuine switch toggles" counter (the instrument counts real crossings)', async () => {
  const { dom, doc, signal } = load();
  try {
    setup.openWheelCal(signal);
    const sw = doc.querySelector('.whcal-grid .whcal-grid-sw');
    assert.ok(sw, 'a grid switch exists');
    assert.strictEqual(doc.querySelector('.whcal-gtoggles').textContent, '0', 'starts at zero');
    sw.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    sw.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await new Promise((r) => dom.window.requestAnimationFrame(() => dom.window.requestAnimationFrame(r)));
    assert.strictEqual(doc.querySelector('.whcal-gtoggles').textContent, '2', 'two genuine toggles counted and shown');
  } finally { setup.closeWheelCal(); unload(dom); }
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
