'use strict';

// [UNIT] v1.408.0 W2 - Hold on the skin ENGINE itself (plan docs/exec-plans/active/2026-11-15-ipod-hold-switch.md, R3 / R8):
// the pure decisions (what Hold does with each event, what a press on the switch does), and the engine's own seams the view
// suite cannot reach directly - a repaint keeps Hold, a live wheel spin ends when Hold engages, a slide is read in the turned
// player's own frame, the listeners balance. The real view path (music.js + the menus + a real server) is
// test/integration/pocket-hold.test.js.

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const skinsPath = require.resolve('../../public/js/music-skins.js');
const surfacePath = require.resolve('../../public/js/skin-surface.js');
const SS = require(surfacePath);

const HTML = `<body><video id="media-player"></video>
  <button id="pp-btn"></button><button id="track-prev-btn"></button><button id="track-next-btn"></button>
  <input id="seek-bar" type="range" /><div id="panel" class="music-nowplaying-panel" hidden></div></body>`;

function boot(skin) {
  const dom = new JSDOM(HTML, { url: 'http://localhost/music' });
  const saved = { window: global.window, document: global.document, Event: global.Event };
  global.window = dom.window; global.document = dom.window.document; global.Event = dom.window.Event;
  dom.window.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  delete require.cache[skinsPath]; delete require.cache[surfacePath];
  global.module = undefined;
  dom.window.FileTubeMusicSkins = require(skinsPath);
  require(surfacePath);
  const ctx = { track: { title: 'T', artist: 'A' }, upNext: [], fullList: [], playing: true, posSec: 10, durSec: 300, posLabel: '0:10', remLabel: '-4:50' };
  const engine = dom.window.FileTubeSkinSurface.create({ panel: dom.window.document.getElementById('panel'), getSkinId: () => skin || 'ipod', getCtx: () => ctx, win: dom.window });
  engine.paint();
  const panel = dom.window.document.getElementById('panel');
  return { dom, engine, panel, restore: () => { try { engine.destroy(); } catch (_) { /* gone */ } Object.assign(global, saved); } };
}
function ptr(dom, el, type, id, x, y) {
  const e = new dom.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x || 0, clientY: y || 0 });
  Object.defineProperty(e, 'pointerId', { value: id }); el.dispatchEvent(e); return e;
}
const sw = (b) => b.panel.querySelector('[data-skin-hold]');

test('holdEventDecision: the switch\'s own presses, moves, releases, click and keys pass; everything else is blocked, the presses also wake', () => {
  const D = SS.holdEventDecision;
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'touchstart', 'touchmove', 'touchend', 'touchcancel', 'mousedown', 'mouseup', 'click']) {
    assert.strictEqual(D({ type, onSwitch: true }), 'allow', type + ' on the switch');
  }
  // gate r1: the focused switch takes only its activation keys; Tab (the focus would leave it for good) and Escape (it reached
  // the page's own listeners) are swallowed like every other key
  for (const key of [' ', 'Enter', 'Spacebar']) for (const type of ['keydown', 'keypress', 'keyup']) assert.strictEqual(D({ type, key, onSwitch: true }), 'allow', type + ' ' + JSON.stringify(key));
  for (const key of ['Tab', 'Escape', 'ArrowDown', 'a', undefined]) assert.strictEqual(D({ type: 'keydown', key, onSwitch: true }), 'wake', 'keydown ' + key + ' on the switch is swallowed');
  for (const type of ['wheel', 'gesturestart', 'selectstart', 'dragstart', 'dblclick', 'auxclick']) {
    assert.notStrictEqual(D({ type, onSwitch: true }), 'allow', type + ' is never the switch\'s');
  }
  for (const type of ['pointerdown', 'touchstart', 'mousedown', 'keydown', 'wheel']) assert.strictEqual(D({ type, onSwitch: false }), 'wake', type + ' elsewhere wakes');
  for (const type of ['pointermove', 'pointerup', 'touchmove', 'touchend', 'click', 'keyup', 'gesturechange', 'selectstart']) assert.strictEqual(D({ type, onSwitch: false }), 'block', type + ' elsewhere is only blocked');
  // a press that started on the switch: its pointer moves and release pass wherever they land, nothing else of it does
  for (const type of ['pointermove', 'pointerup', 'pointercancel']) assert.strictEqual(D({ type, onSwitch: false, switchGesture: true }), 'allow', type);
  for (const type of ['pointerdown', 'click', 'touchend']) assert.notStrictEqual(D({ type, onSwitch: false, switchGesture: true }), 'allow', type + ' of a switch press, off the switch');
  // the list is every input kind there is, and never the menu event (interaction.js owns it, D6)
  for (const t of ['pointerdown', 'touchstart', 'mousedown', 'click', 'wheel', 'keydown', 'gesturestart', 'selectstart', 'dragstart']) assert.ok(SS.HOLD_EVENTS.includes(t), t);
  assert.ok(!SS.HOLD_EVENTS.includes('contextmenu'));
  assert.strictEqual(new Set(SS.HOLD_EVENTS).size, SS.HOLD_EVENTS.length, 'no event twice');
});

test('holdToggleDecision: a tap flips; a slide toward the CENTRE turns Hold on and toward the end turns it off; a right-hand switch mirrors', () => {
  const T = SS.holdToggleDecision; const s = SS.HOLD_SLIDE_PX;
  assert.strictEqual(T({ on: false, dx: 0, side: 'left' }), true);
  assert.strictEqual(T({ on: true, dx: s - 1, side: 'left' }), false, 'under the slide distance is a tap');
  assert.strictEqual(T({ on: true, dx: -(s - 1), side: 'right' }), false);
  assert.strictEqual(T({ on: false, dx: s, side: 'left' }), true, 'left switch, slid right: on');
  assert.strictEqual(T({ on: true, dx: s, side: 'left' }), true, 'already on: stays on');
  assert.strictEqual(T({ on: true, dx: -s, side: 'left' }), false, 'left switch, slid left: off');
  assert.strictEqual(T({ on: false, dx: -s, side: 'left' }), false, 'already off: stays off');
  assert.strictEqual(T({ on: false, dx: -s, side: 'right' }), true, 'right switch, slid left: on');
  assert.strictEqual(T({ on: true, dx: s, side: 'right' }), false, 'right switch, slid right: off');
  // gate r1 adversary S1: a press that travelled mostly ACROSS the edge (a swipe down from the top) changes nothing
  assert.strictEqual(T({ on: false, dx: 0, dy: 160, side: 'left' }), false, 'a swipe down: unchanged (off)');
  assert.strictEqual(T({ on: true, dx: 3, dy: -40, side: 'left' }), true, 'a swipe up: unchanged (on)');
  assert.strictEqual(T({ on: false, dx: 30, dy: 20, side: 'left' }), true, 'a slide with some drift is still a slide');
  assert.strictEqual(T({ on: false, dx: 2, dy: s - 1, side: 'left' }), true, 'a tap with a little wobble is still a tap');
});

test('a repaint keeps Hold: the class comes back on the rebuilt panel and the switch is drawn checked', () => {
  const b = boot('ipod');
  try {
    assert.strictEqual(b.engine.setHold(true), true);
    assert.ok(b.panel.classList.contains('mms-hold'));
    const before = sw(b);
    b.engine.paint();
    assert.notStrictEqual(sw(b), before, 'precondition: the panel was rebuilt');
    assert.ok(b.panel.classList.contains('mms-hold'), 'the class survives the className rebuild');
    assert.strictEqual(sw(b).getAttribute('aria-checked'), 'true', 'the renderer drew it checked');
    assert.strictEqual(b.engine.isHold(), true);
    // the paint's own class write is not a close
    assert.ok(b.panel.classList.contains('mms-full'));
  } finally { b.restore(); }
});

test('Hold arms only while the full player is on the glass, and a skin with no full player never holds', () => {
  const b = boot('ipod');
  try {
    b.panel.classList.remove('mms-full');
    assert.strictEqual(b.engine.setHold(true), false, 'no full player: no Hold');
    assert.ok(!b.panel.classList.contains('mms-hold'));
  } finally { b.restore(); }
});

test('a live wheel spin ends when Hold engages: its next move scrubs nothing', () => {
  const b = boot('ipod');
  try {
    const wheel = b.panel.querySelector('.ip-wheel');
    assert.strictEqual(b.engine.isScrubbing(), false);
    ptr(b.dom, wheel, 'pointerdown', 1, 200, 40);
    ptr(b.dom, wheel, 'pointermove', 1, 210, 60);
    ptr(b.dom, wheel, 'pointermove', 1, 215, 80);
    assert.strictEqual(b.engine.isScrubbing(), true, 'precondition: the drag is a live scrub');
    b.engine.setHold(true);
    assert.strictEqual(b.engine.isScrubbing(), false, 'the spin is over');
    ptr(b.dom, wheel, 'pointermove', 1, 220, 120);
    assert.strictEqual(b.engine.isScrubbing(), false, 'and a later move starts nothing');
  } finally { b.restore(); }
});

test('a slide is read in the player\'s own frame: on the turned Upright player a screen-vertical slide is the switch\'s horizontal', () => {
  const b = boot('ipod');
  try {
    // the Upright player turned -90deg (the phone's top to the left): the box's +x runs up the screen
    b.panel.style.transform = 'matrix(0, -1, 1, 0, 0, 0)';
    assert.strictEqual(b.dom.window.FileTubeMusicSkins.turnOf(b.panel, b.dom.window), 270, 'precondition: the turn reads back');
    ptr(b.dom, sw(b), 'pointerdown', 3, 100, 300);
    ptr(b.dom, b.dom.window.document.body, 'pointerup', 3, 100, 260); // 40 px UP the screen = toward the centre in the box
    assert.strictEqual(b.engine.isHold(), true, 'up the turned screen is toward the centre: on');
    ptr(b.dom, sw(b), 'pointerdown', 4, 100, 260);
    ptr(b.dom, b.dom.window.document.body, 'pointerup', 4, 140, 260); // 40 px RIGHT on screen = ACROSS the turned box's edge
    assert.strictEqual(b.engine.isHold(), true, 'a slide across the turned box is no use of the switch (gate r1 S1): unchanged');
    ptr(b.dom, sw(b), 'pointerdown', 5, 100, 260);
    ptr(b.dom, b.dom.window.document.body, 'pointerup', 5, 100, 300); // 40 px DOWN the turned screen = toward the end in the box
    assert.strictEqual(b.engine.isHold(), false, 'down the turned screen is back toward the end: off');
  } finally { b.restore(); }
});

test('the release listeners live only while a press on the switch is down, and the window blocker only while Hold is on (balanced on every arm)', () => {
  const b = boot('ipod');
  try {
    const W = b.dom.window; const D = W.document;
    const live = { doc: 0, win: 0 };
    const wrap = (o, key) => { const a = o.addEventListener.bind(o), r = o.removeEventListener.bind(o);
      o.addEventListener = (t, fn, op) => { if (key === 'doc' ? (t === 'pointerup' || t === 'pointercancel') : t === 'pointerdown') live[key] += 1; return a(t, fn, op); };
      o.removeEventListener = (t, fn, op) => { if (key === 'doc' ? (t === 'pointerup' || t === 'pointercancel') : t === 'pointerdown') live[key] -= 1; return r(t, fn, op); }; };
    wrap(D, 'doc'); wrap(W, 'win');
    ptr(b.dom, sw(b), 'pointerdown', 1, 10, 0);
    assert.strictEqual(live.doc, 2, 'a press arms its release and its cancel');
    ptr(b.dom, sw(b), 'pointerup', 1, 10, 0);
    assert.strictEqual(live.doc, 0, 'the release removes both');
    assert.strictEqual(live.win, 1, 'Hold on: one window blocker per type');
    ptr(b.dom, sw(b), 'pointerdown', 2, 10, 0); ptr(b.dom, sw(b), 'pointercancel', 2, 10, 0);
    assert.strictEqual(live.doc, 0, 'a cancel removes both'); assert.ok(b.engine.isHold(), 'and changes nothing');
    ptr(b.dom, sw(b), 'pointerdown', 3, 10, 0); ptr(b.dom, sw(b), 'pointerdown', 4, 10, 0);
    assert.strictEqual(live.doc, 2, 'a second press replaces the first, never stacks');
    b.engine.destroy();
    assert.strictEqual(live.doc, 0, 'the surface dying mid-press removes them');
    assert.strictEqual(live.win, 0, 'and the window blocker');
    assert.ok(!b.panel.classList.contains('mms-hold') && !b.engine.isHold(), 'Hold is off');
  } finally { b.restore(); }
});

test('the renderer: every Click colorway draws ONE role="switch" (the ui-switch primitive) in its top edge, checked only when the engine says so, the knob after it on the strip', () => {
  const SK = require(skinsPath);
  const ctx = { track: { title: 'T' } };
  for (const id of SK.clickColorways()) {
    const off = SK.renderFull(id, ctx); const on = SK.renderFull(id, Object.assign({ hold: true }, ctx));
    const m = /<div class="ip-top"[^>]*>([\s\S]*)<\/div><span class="ip-dim" aria-hidden="true"><\/span>$/.exec(off);
    assert.ok(m, id + ': the top edge, then the dim layer, close the markup');
    assert.strictEqual((off.match(/data-skin-hold/g) || []).length, 1, id);
    assert.match(m[1], /^<span class="ip-edge" aria-hidden="true"><\/span><button type="button" class="ip-hold ui-switch" data-skin-hold role="switch" aria-checked="false" aria-label="Hold"><\/button><span class="ip-hold-slot" aria-hidden="true"><span class="ip-hold-knob"><\/span><\/span>$/, id);
    assert.ok(on.includes('aria-checked="true"') && !on.includes('aria-checked="false"'), id + ' drawn checked under Hold');
    assert.strictEqual(on.replace('aria-checked="true"', 'aria-checked="false"'), off, id + ': Hold changes nothing else in the markup');
    assert.strictEqual((off.match(/<span class="ip-lock" aria-hidden="true">/g) || []).length, 1, id + ': the status bar carries the lock mark');
  }
  assert.ok(!/data-skin-hold/.test(SK.renderFull('apple', ctx)) && !/data-skin-hold/.test(SK.renderFull('spotify', ctx)));
});

test('CSS: the knob slides by transform only (none under reduced motion), follows the button\'s aria-checked, and the button resets every paint of the ui-switch it repaints', () => {
  const { readStyleCss, cssRules } = require('../helpers/stylesheets.js');
  const rules = cssRules(readStyleCss());
  const P = ':where(html.is-phone) .mms-full.mms-ipod ';
  const one = (sel) => { const r = rules.filter((x) => x.sel.trim() === P + sel && !x.at); assert.strictEqual(r.length, 1, sel); return r[0].body; };
  const knob = one('.ip-hold-knob');
  assert.match(knob, /transform:translateX\(var\(--hs-off\)\)/); assert.match(knob, /transition:transform var\(--dur-slow\) var\(--ease-ui\)/);
  assert.match(one('.ip-hold.ui-switch[aria-checked="true"] + .ip-hold-slot .ip-hold-knob'), /transform:translateX\(var\(--hs-on\)\)/);
  const rm = rules.filter((x) => /prefers-reduced-motion: reduce/.test(x.at) && x.sel.split(',').map((q) => q.trim()).includes(P + '.ip-hold-knob'));
  assert.strictEqual(rm.length, 1); assert.match(rm[0].body, /transition:none/);
  const btn = one('.ip-hold.ui-switch');
  for (const p of ['margin:0', 'padding:0', 'border:0', 'border-radius:0', 'background-color:transparent', 'height:auto', 'pointer-events:auto', 'position:absolute']) assert.ok(btn.includes(p), p);
  assert.match(one('.ip-hold.ui-switch::before'), /content:none/);
  // the sides: a right-hand switch rests at the far end and slides left
  const side = one('.ip-top[data-hs-side="right"]');
  assert.match(side, /--hs-off:calc\(\(1 \/ var\(--hs-k\) - 1\) \* 100%\)/); assert.match(side, /--hs-on:0%/);
  // the slot is placed on the strip in the BODY's width (the photos' fractions), never in the hit box
  assert.match(one('.ip-hold-slot'), /left:calc\(var\(--hs-c\) - var\(--hs-w\) \/ 2\); width:var\(--hs-w\); bottom:0;/);
  // the lock replaces the title only under Hold
  const held = (sel) => { const r = rules.filter((x) => x.sel.trim() === ':where(html.is-phone) .mms-full.mms-ipod.mms-hold ' + sel); assert.strictEqual(r.length, 1, sel); return r[0].body; };
  assert.match(held('.ip-lock'), /display:inline-flex; position:absolute; left:var\(--space-4\)/);
  assert.match(held('.ip-np'), /^\s*visibility:hidden;\s*$/, 'the title keeps its box and its one line (no display change: test/unit/skin-status-bar.test.js)');
  assert.ok(rules.some((x) => x.sel.trim() === '.mms-ipod .ip-lock' && /display:none/.test(x.body)), 'hidden everywhere else');
});

test('engaging Hold lets go of a focused control in the player (the keyboard-search input, its keyboard up); the switch keeps its focus', () => {
  const b = boot('ipod');
  try {
    const D = b.dom.window.document;
    const input = D.createElement('input'); input.className = 'ipm-kb-input';
    b.panel.querySelector('.ip-lcd-in').appendChild(input);
    input.focus();
    assert.strictEqual(D.activeElement, input, 'precondition: the input has the focus');
    b.engine.setHold(true);
    assert.notStrictEqual(D.activeElement, input, 'Hold blurred it');
    b.engine.setHold(false);
    sw(b).focus();
    assert.strictEqual(D.activeElement, sw(b), 'precondition: the switch has the focus');
    b.engine.setHold(true);
    assert.strictEqual(D.activeElement, sw(b), 'the switch keeps it (Space / Enter must still reach it)');
  } finally { b.restore(); }
});

test('a game holding the wheel (Brick) ends when Hold engages, as MENU would end it (gate r1 adversary W2)', () => {
  const b = boot('ipod');
  try {
    let exits = 0;
    b.engine.setWheelTakeover({ onRotate() {}, onExit() { exits += 1; } });
    b.engine.setHold(true);
    assert.strictEqual(exits, 1, 'the takeover was released');
    b.engine.setHold(false); b.engine.setHold(true);
    assert.strictEqual(exits, 1, 'and only once');
  } finally { b.restore(); }
});

test('a press on the switch never reaches the engine\'s own press handling (it stops at the panel, before the wheel or anything under it)', () => {
  const b = boot('ipod');
  try {
    let seen = 0;
    b.panel.addEventListener('pointerdown', () => { seen += 1; }); // the bubble phase, where the engine's own onDown listens
    ptr(b.dom, sw(b), 'pointerdown', 1, 10, 0);
    assert.strictEqual(seen, 0, 'the switch press never bubbles');
    ptr(b.dom, sw(b), 'pointerup', 1, 10, 0);
    ptr(b.dom, b.panel.querySelector('.ip-wheel'), 'pointerdown', 2, 10, 0);
    assert.strictEqual(seen, 0, 'Hold on: a wheel press stops at the window');
    b.engine.setHold(false);
    ptr(b.dom, b.panel.querySelector('.ip-wheel'), 'pointerdown', 3, 10, 0);
    assert.strictEqual(seen, 1, 'control: a wheel press with Hold off does bubble');
  } finally { b.restore(); }
});
