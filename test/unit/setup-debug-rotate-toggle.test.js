'use strict';

// [UNIT] v1.355 (A): Settings > Troubleshooting > "Show rotate debug log". The home-screen app has no URL
// bar, so the ?debugRotate=1 log (common.js installRotateDebug) gets a switch beside the lifecycle log, and
// it applies AT ONCE both ways: ON stores '1' and installs the log in this window, OFF removes the key and
// uninstallRotateDebug() takes back every listener, the pre-frame rAF ring, the panel and the probe.
// Everything here EXECUTES the real common.js log and the real setup.js switch in jsdom (no source locks
// for behaviour). The rows also carry sy / vvo / vs / ae (did anything move when the keyboard came up).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const common = require('../../public/js/common.js');
const setup = require('../../public/js/setup.js');
const SETUP_HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'setup.html'), 'utf8');

// A window whose rAF is a queue we flush by hand, and whose every event target counts its live listeners.
function rotateWin(url, body) {
  const dom = new JSDOM('<body>' + (body || '') + '</body>', { url, pretendToBeVisual: true });
  const w = dom.window;
  let now = 0; const q = [];
  w.performance.now = () => now;
  w.requestAnimationFrame = (cb) => { q.push(cb); return q.length; };
  const frames = (n, dt) => { for (let i = 0; i < n; i++) { now += dt; q.splice(0).forEach((cb) => cb(now)); } };
  const live = { n: 0 };
  const counted = (target) => {
    const add = target.addEventListener.bind(target);
    const rem = target.removeEventListener.bind(target);
    target.addEventListener = (t, f, o) => { live.n += 1; add(t, f, o); };
    target.removeEventListener = (t, f, o) => { live.n -= 1; rem(t, f, o); };
    return target;
  };
  // jsdom's selector engine registers its own window listeners on the first query: warm it up first
  w.document.querySelector('#warm-up'); w.document.querySelectorAll('.ip-lcd').length;
  counted(w);
  const vv = counted(new w.EventTarget());
  Object.assign(vv, { width: 393, height: 852, offsetLeft: 0, offsetTop: 0, scale: 1 });
  Object.defineProperty(w, 'visualViewport', { value: vv, configurable: true });
  const so = counted(new w.EventTarget());
  so.angle = 0;
  Object.defineProperty(w.screen, 'orientation', { value: so, configurable: true });
  const mq = counted(new w.EventTarget());
  mq.matches = false;
  w.matchMedia = () => mq;
  return { w, frames, q, live, vv, so, mq };
}

function withGlobals(fn) {
  const saved = { k: global.ROTATE_LOG_KEY, i: global.installRotateDebug, u: global.uninstallRotateDebug };
  global.ROTATE_LOG_KEY = common.ROTATE_LOG_KEY;
  global.installRotateDebug = common.installRotateDebug;
  global.uninstallRotateDebug = common.uninstallRotateDebug;
  try { return fn(); } finally {
    global.ROTATE_LOG_KEY = saved.k; global.installRotateDebug = saved.i; global.uninstallRotateDebug = saved.u;
    if (saved.k === undefined) delete global.ROTATE_LOG_KEY;
    if (saved.i === undefined) delete global.installRotateDebug;
    if (saved.u === undefined) delete global.uninstallRotateDebug;
  }
}
const SWITCH = '<input type="checkbox" role="switch" class="ui-switch" id="debug-rotate-check" />';
function flip(w, on) {
  const c = w.document.getElementById('debug-rotate-check');
  c.checked = on;
  c.dispatchEvent(new w.Event('change', { bubbles: true }));
}
const runs = (w) => (w.__ftRotateLog || []).filter((e) => e.why).length;

test('v1.355 A: the switch reflects ft-debug-rotate on load, both ways (only the literal "1" is on)', () => withGlobals(() => {
  const on = rotateWin('http://localhost/settings', SWITCH);
  on.w.localStorage.setItem('ft-debug-rotate', '1');
  setup.loadDebugRotateControl(on.w);
  assert.strictEqual(on.w.document.getElementById('debug-rotate-check').checked, true);
  for (const raw of [null, '0', 'true']) {
    const off = rotateWin('http://localhost/settings', SWITCH);
    off.w.document.getElementById('debug-rotate-check').checked = true; // a stale DOM state the load must overwrite
    if (raw !== null) off.w.localStorage.setItem('ft-debug-rotate', raw);
    setup.loadDebugRotateControl(off.w);
    assert.strictEqual(off.w.document.getElementById('debug-rotate-check').checked, false, 'stored ' + raw + ' reads off');
  }
}));

test('v1.355 A: ON stores "1" and the log is live in THIS window at once (an orientationchange then samples, no reload)', () => withGlobals(() => {
  const { w, frames } = rotateWin('http://localhost/settings', SWITCH);
  setup.wireDebugRotateControl(w);
  assert.strictEqual(w.__ftRotateLog, undefined, 'nothing installed before the switch');
  flip(w, true);
  assert.strictEqual(w.localStorage.getItem('ft-debug-rotate'), '1');
  assert.ok(Array.isArray(w.__ftRotateLog), 'installed now');
  w.dispatchEvent(new w.Event('orientationchange'));
  frames(10, 20);
  assert.strictEqual(runs(w), 1);
  assert.ok(w.__ftRotateLog.filter((e) => 'iw' in e && !e.pre).length >= 8, 'rows sampled per frame');
  assert.ok(w.document.getElementById('ft-rotate-panel'), 'the panel is up');
}));

test('v1.355 A: OFF removes the key and takes the log down at once: no listener left, the pre-frame ring stops, panel and probe gone', () => withGlobals(() => {
  const { w, frames, q, live } = rotateWin('http://localhost/settings', SWITCH);
  setup.wireDebugRotateControl(w);
  const base = live.n; // the switch's own change listener sits on the input, not on these targets
  flip(w, true);
  assert.ok(live.n - base >= 5, 'installed: window x2, screen.orientation, the media query, visualViewport: ' + (live.n - base));
  w.dispatchEvent(new w.Event('orientationchange'));
  frames(3, 20); // mid-run: the per-event rAF chain and the pre ring are both pending
  assert.ok(q.length >= 2, 'two rAF chains pending before OFF: ' + q.length);
  const kept = w.__ftRotateLog;
  const rowsBefore = kept.length;
  flip(w, false);
  assert.strictEqual(w.localStorage.getItem('ft-debug-rotate'), null, 'the key is removed, not set to 0');
  assert.strictEqual(live.n - base, 0, 'every listener the install added is gone');
  assert.strictEqual(w.__ftRotateLog, undefined, 'the log is cleared');
  assert.strictEqual(w.document.getElementById('ft-rotate-panel'), null, 'the panel is gone');
  assert.strictEqual(w.document.getElementById('ft-rotate-probe'), null, 'the probe is gone');
  frames(1, 20); // the callbacks already queued run once and must not re-arm
  assert.strictEqual(q.length, 0, 'no rAF re-armed after OFF');
  frames(50, 20);
  assert.strictEqual(kept.length, rowsBefore, 'a run in flight logged nothing after OFF');
  w.dispatchEvent(new w.Event('orientationchange'));
  w.dispatchEvent(new w.Event('resize'));
  frames(10, 20);
  assert.strictEqual(q.length, 0, 'an event after OFF samples nothing');
  assert.strictEqual(w.__ftRotateLog, undefined);
  // and ON again works (the uninstall left no stale handle)
  flip(w, true);
  w.dispatchEvent(new w.Event('orientationchange'));
  frames(2, 20);
  assert.strictEqual(runs(w), 1, 'back on, one run');
}));

test('v1.355 A: installRotateDebug is idempotent - a second install while live installs nothing (one run per event)', () => {
  const { w, frames, live } = rotateWin('http://localhost/music?debugRotate=1');
  assert.strictEqual(common.installRotateDebug(w), true);
  const after1 = live.n;
  const log = w.__ftRotateLog;
  assert.strictEqual(common.installRotateDebug(w), true, 'a second call reports on');
  assert.strictEqual(live.n, after1, 'and adds no listener');
  assert.strictEqual(w.__ftRotateLog, log, 'and keeps the same log');
  w.dispatchEvent(new w.Event('orientationchange'));
  frames(5, 20);
  assert.strictEqual(runs(w), 1, 'one run per event, not two');
  assert.strictEqual(common.uninstallRotateDebug(w), true);
  assert.strictEqual(common.uninstallRotateDebug(w), false, 'nothing left to take down');
});

test('v1.355 A: ?debugRotate=1 / =0 keep working beside the switch', () => {
  const a = rotateWin('http://localhost/music?debugRotate=1');
  assert.strictEqual(common.installRotateDebug(a.w), true);
  assert.strictEqual(a.w.localStorage.getItem(common.ROTATE_LOG_KEY), '1');
  const b = rotateWin('http://localhost/music?debugRotate=0');
  b.w.localStorage.setItem(common.ROTATE_LOG_KEY, '1');
  assert.strictEqual(common.installRotateDebug(b.w), false);
  assert.strictEqual(b.w.localStorage.getItem(common.ROTATE_LOG_KEY), null);
  assert.strictEqual(common.ROTATE_LOG_KEY, 'ft-debug-rotate');
});

test('v1.355 A: each row carries sy (page scroll), vvo (visual viewport offset), vs (its scale) and ae (the focused element)', () => {
  const { w, vv } = rotateWin('http://localhost/music', '<input id="ipm-kb" />');
  Object.defineProperty(w, 'scrollY', { value: 37.4, configurable: true });
  vv.offsetLeft = 0.4; vv.offsetTop = 120.6; vv.scale = 1.25;
  let s = common.rotateSample(w, 1);
  assert.strictEqual(s.sy, 37);
  assert.deepStrictEqual(s.vvo, [0, 121]);
  assert.strictEqual(s.vs, 1.25);
  assert.strictEqual(s.ae, '', 'nothing focused reads empty');
  w.document.getElementById('ipm-kb').focus();
  s = common.rotateSample(w, 2);
  assert.strictEqual(s.ae, 'input#ipm-kb');
  delete w.visualViewport;
  Object.defineProperty(w, 'visualViewport', { value: undefined, configurable: true });
  s = common.rotateSample(w, 3);
  assert.strictEqual(s.vvo, null);
  assert.strictEqual(s.vs, null);
});

test('v1.355 A: setup.html has the "Show rotate debug log" switch beside the lifecycle log (same Troubleshooting group, its own list since v1.362.2), with its note', () => {
  const doc = new JSDOM(SETUP_HTML).window.document;
  const life = doc.getElementById('debug-lifecycle-check');
  const rot = doc.getElementById('debug-rotate-check');
  assert.ok(rot, 'the switch exists');
  assert.strictEqual(rot.getAttribute('role'), 'switch');
  assert.ok(rot.classList.contains('ui-switch'));
  // v1.362.2 (D6): the lifecycle log's switches, Export and Clear and note come first; the rotate row follows in its own list.
  assert.strictEqual(life.closest('.setup-group'), rot.closest('.setup-group'), 'the same Troubleshooting group as the lifecycle log');
  assert.ok(life.compareDocumentPosition(rot) & 4, 'after the lifecycle log');
  assert.strictEqual(doc.querySelector('label[for="debug-rotate-check"]').textContent, 'Show rotate debug log');
  const group = rot.closest('.setup-group');
  const notes = Array.from(group.querySelectorAll('.setup-note')).map((n) => n.textContent);
  const note = notes.find((t) => /rotate debug log/.test(t));
  assert.ok(note, 'a note says what it is for');
  assert.match(note, /Tap the panel to copy/);
  assert.match(note, /at once/);
  assert.match(note, /device-local/);
  assert.ok(rot.closest('details[data-collapse-key="troubleshooting"]'), 'in Troubleshooting');
});

// ---- the wiring on the REAL Settings page: wireStaticControls() binds the switch, init() prefills it ----
test('v1.355 A: the real setup.html switch, wired by the real wireStaticControls(), installs and uninstalls the log', () => {
  const shell = Object.assign({}, require('../../public/js/glyph-pool.js'), common, {
    homeFeedEnabled: () => false, modernModeEnabled: () => false, applyHomeFeedPref() {}, applyModernModePref() {},
    initDebugLifecycleFlag() {}, setPerPageSortEnabled() {}, isPerPageSortEnabled: () => false,
    setActionStatus() {}, showToast() {}, setButtonBusy() {}, applyCustomLogoIfSet() {}, wireReorderable() {},
  });
  const dom = new JSDOM(SETUP_HTML, { url: 'http://localhost/setup.html', pretendToBeVisual: true });
  const w = dom.window;
  w.requestAnimationFrame = () => 1;
  const saved = { window: global.window, document: global.document, localStorage: global.localStorage, fetch: global.fetch };
  const borrowed = Object.keys(shell).filter((k) => !(k in global));
  for (const k of borrowed) global[k] = shell[k];
  Object.assign(global, { window: w, document: w.document, localStorage: w.localStorage, fetch: () => new Promise(() => {}) });
  const ac = new w.AbortController();
  setup.__setFolderStateForTests({ controller: ac, folders: [], settings: {} });
  try {
    setup.wireStaticControls(ac.signal);
    flip(w, true);
    assert.strictEqual(w.localStorage.getItem('ft-debug-rotate'), '1');
    assert.ok(Array.isArray(w.__ftRotateLog), 'live in this window, no reload');
    flip(w, false);
    assert.strictEqual(w.localStorage.getItem('ft-debug-rotate'), null);
    assert.strictEqual(w.__ftRotateLog, undefined, 'down at once');
  } finally {
    ac.abort();
    setup.__setFolderStateForTests({ controller: null });
    common.uninstallRotateDebug(w);
    Object.assign(global, saved);
    for (const k of borrowed) delete global[k];
    w.close();
  }
});

test('v1.355 A: init() prefills the switch (loadDebugRotateControl) beside the lifecycle one', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'setup.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const init = /\nfunction init\(root\) \{([\s\S]*?)\n\}/.exec(src);
  assert.ok(init, 'init(root) found');
  assert.match(init[1], /\n\s*loadDebugLifecycleControl\(\);\s*\n\s*loadDebugLifecycleOverlayControl\(window\);\s*\n\s*loadDebugRotateControl\(window\);/);
});
