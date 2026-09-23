'use strict';

// [UNIT] v1.311.2 (Dean, device-CONFIRMED): a rightward SCRUB of the seek bar fired
// the document-wide swipe-back (v1.160) on release - history.back() left the watch
// page and dropped fullscreen. These tests drive the REAL wired listeners
// (wireSwipeBackGesture, the same function bootRouter's wireSwipeBack calls) with
// touch events on the REAL shell markup, so they prove the stand-down is reachable
// from the seek bar itself - not just that a predicate returns true in isolation.
// The control case (a drag on ordinary page content still goes back) keeps every
// "no back" assertion from being vacuous.

const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const PUBLIC = path.join(__dirname, '../../public');
const COMMON = require.resolve('../../public/js/common.js');
const skins = require('../../public/js/music-skins.js');

// Require with no document so the shell boot never runs (the v1.78.1 lesson).
delete global.document; delete global.window;
delete require.cache[COMMON];
const {
  wireSwipeBackGesture, swipeBackStandDownReason, touchActionOwnsHorizontal,
  SWIPE_BACK_OWNER_SELECTORS,
} = require(COMMON);

let dom = null;
afterEach(() => { if (dom) { dom.window.close(); dom = null; } });

function shellBody(file) {
  const html = fs.readFileSync(path.join(PUBLIC, file), 'utf8');
  return html.slice(html.indexOf('<body'), html.lastIndexOf('</body>') + 7).replace(/<script[\s\S]*?<\/script>/g, '');
}

// Boot a jsdom page holding `bodyHtml`, wire the real gesture, count backs.
function boot(bodyHtml) {
  dom = new JSDOM('<!DOCTYPE html><html><head></head>' + bodyHtml + '</html>', { url: 'http://localhost/watch.html?v=x' });
  const doc = dom.window.document;
  const backs = { n: 0 };
  wireSwipeBackGesture(doc, dom.window, () => { backs.n += 1; });
  // Every shell ships the player as <template id="player-host-template">; player.js
  // stamps it into the page at runtime - do the same so the live markup is tested.
  const tpl = doc.getElementById('player-host-template');
  if (tpl) doc.body.appendChild(tpl.content.cloneNode(true));
  return { doc, win: dom.window, backs };
}
function touchEvt(win, type, target, x, y) {
  const e = new win.Event(type, { bubbles: true, cancelable: true });
  const list = type === 'touchend' || type === 'touchcancel' ? [] : [{ clientX: x, clientY: y, target }];
  Object.defineProperty(e, 'touches', { value: list });
  target.dispatchEvent(e);
}
// A clearly horizontal, rightward drag well past the 90px threshold.
function dragRight(win, target, opts) {
  const o = opts || {};
  touchEvt(win, 'touchstart', target, 20, 300);
  touchEvt(win, 'touchmove', target, 60, 302);
  if (o.mid) o.mid();
  touchEvt(win, 'touchmove', target, 200, 305);
  touchEvt(win, 'touchend', target, 200, 305);
}

test('CONTROL: a rightward drag on ordinary page content still goes back (the gesture is live)', () => {
  const { doc, win, backs } = boot('<body><main id="content"><p id="p">text</p></main></body>');
  dragRight(win, doc.getElementById('p'));
  assert.strictEqual(backs.n, 1, 'the swipe-back fires on plain content - every "no back" below is a real stand-down');
});

test('Dean\'s repro: a rightward scrub of the watch page #seek-bar never goes back', () => {
  const { doc, win, backs } = boot(shellBody('watch.html'));
  const seek = doc.getElementById('seek-bar');
  assert.ok(seek, 'the real watch shell has the seek bar');
  dragRight(win, seek);
  assert.strictEqual(backs.n, 0, 'scrubbing right is a seek, never a back');
  dragRight(win, doc.getElementById('vol-bar'));
  assert.strictEqual(backs.n, 0, 'the volume slider too');
  // and a plain page element on the SAME shell still goes back (not vacuous)
  const plain = doc.createElement('p'); (doc.querySelector('main') || doc.body).appendChild(plain);
  dragRight(win, plain);
  assert.strictEqual(backs.n, 1, 'content outside the player still goes back');
});

test('every shell: every range/slider stands down, and so does the whole player host', () => {
  const shells = fs.readdirSync(PUBLIC).filter((f) => f.endsWith('.html'));
  let ranges = 0;
  for (const file of shells) {
    const { doc, win } = boot(shellBody(file));
    doc.querySelectorAll('input[type="range"], [role="slider"]').forEach((el) => {
      ranges += 1;
      assert.ok(swipeBackStandDownReason(el, doc, win), `${file}: #${el.id || el.className} must stand the swipe-back down`);
    });
    const host = doc.getElementById('player-wrapper');
    if (host) assert.strictEqual(swipeBackStandDownReason(host, doc, win), 'owner', `${file}: the player host itself`);
    dom.window.close(); dom = null;
  }
  assert.ok(ranges >= 18, `the census actually walked the shells' sliders (saw ${ranges})`);
});

test('every music/podcast skin: its seek, wheel and sliders stand down even outside .mms-full', () => {
  const CTX = { track: { title: 'T', artist: 'A' }, upNext: [], fullList: [], posLabel: '0:00', remLabel: '-1:00', playing: true };
  let owners = 0;
  for (const id of skins.IDS) {
    const { doc, win, backs } = boot('<body><div id="panel"></div></body>');
    const panel = doc.getElementById('panel'); // deliberately NOT .mms-full - bind the inner selectors
    panel.innerHTML = skins.renderFull(id, CTX);
    panel.querySelectorAll('[data-skin-seek], [role="slider"], .ip-wheel, input[type="range"]').forEach((el) => {
      owners += 1;
      assert.strictEqual(swipeBackStandDownReason(el, doc, win), 'owner', `skin ${id}: ${el.className}`);
      dragRight(win, el);
    });
    assert.strictEqual(backs.n, 0, `skin ${id}: no scrub or spin goes back`);
    dom.window.close(); dom = null;
  }
  assert.ok(owners >= skins.IDS.length, `every skin drew at least one scrubber (saw ${owners})`);
});

test('a range/slider OUTSIDE any player (the wheel-calibration slider, a settings slider) stands down on its own selector', () => {
  const { doc, win, backs } = boot('<body><section><input type="range" id="r"><div role="slider" id="s" tabindex="0"></div></section></body>');
  assert.strictEqual(swipeBackStandDownReason(doc.getElementById('r'), doc, win), 'owner');
  assert.strictEqual(swipeBackStandDownReason(doc.getElementById('s'), doc, win), 'owner');
  dragRight(win, doc.getElementById('r'));
  dragRight(win, doc.getElementById('s'));
  assert.strictEqual(backs.n, 0, 'dragging a bare slider right is a slide, never a back');
});

test('the full-screen skin panel and the Brick are owners', () => {
  const { doc, win } = boot('<body><div class="music-nowplaying-panel mms mms-full mms-haptic"><p id="in">x</p></div><div class="ipod-brick"><canvas id="c"></canvas></div></body>');
  assert.strictEqual(swipeBackStandDownReason(doc.getElementById('in'), doc, win), 'owner', 'haptic skins LIFT touch-action, so .mms-full must be named');
  assert.strictEqual(swipeBackStandDownReason(doc.getElementById('c'), doc, win), 'owner');
});

test('immersive views own every drag: faux fullscreen, expanded audio, native fullscreen, and one entered MID-drag', () => {
  for (const cls of ['ft-css-fullscreen', 'ft-audio-expanded']) {
    const { doc, win, backs } = boot('<body><p id="p">x</p></body>');
    doc.body.classList.add(cls);
    dragRight(win, doc.getElementById('p'));
    assert.strictEqual(backs.n, 0, `${cls}: no back`);
    doc.body.classList.remove(cls);
    dragRight(win, doc.getElementById('p'));
    assert.strictEqual(backs.n, 1, `${cls} off again: back works (the stand-down is not sticky)`);
    dom.window.close(); dom = null;
  }
  {
    const { doc, win, backs } = boot('<body><p id="p">x</p></body>');
    Object.defineProperty(doc, 'fullscreenElement', { value: doc.body, configurable: true });
    dragRight(win, doc.getElementById('p'));
    assert.strictEqual(backs.n, 0, 'native fullscreen: no back');
  }
  dom.window.close(); dom = null;
  {
    const { doc, win, backs } = boot('<body><p id="p">x</p></body>');
    dragRight(win, doc.getElementById('p'), { mid: () => doc.body.classList.add('ft-css-fullscreen') });
    assert.strictEqual(backs.n, 0, 'a rotate into faux fullscreen mid-drag owns the release');
  }
});

test('the touch-action NET: an unlisted element that took horizontal panning stands down', () => {
  const { doc, win, backs } = boot('<body><div id="none" style="touch-action:none"><span id="a">x</span></div><div id="py" style="touch-action:pan-y"><span id="b">x</span></div><div id="both" style="touch-action:pan-x pan-y"><span id="c">x</span></div></body>');
  dragRight(win, doc.getElementById('a'));
  dragRight(win, doc.getElementById('b'));
  assert.strictEqual(backs.n, 0, 'touch-action none / pan-y own the sideways drag');
  dragRight(win, doc.getElementById('c'));
  assert.strictEqual(backs.n, 1, 'pan-x pan-y leaves horizontal to the browser - still a back');
  assert.strictEqual(touchActionOwnsHorizontal('none'), true);
  assert.strictEqual(touchActionOwnsHorizontal('pan-y pinch-zoom'), true);
  assert.strictEqual(touchActionOwnsHorizontal('pan-x'), false);
  assert.strictEqual(touchActionOwnsHorizontal('manipulation'), false);
  assert.strictEqual(touchActionOwnsHorizontal('auto'), false);
  assert.strictEqual(touchActionOwnsHorizontal(''), false);
});

test('census: every JS-built slider in public/js is a range input or role=slider (so the generic owners cover it)', () => {
  const dir = path.join(PUBLIC, 'js');
  const hits = [];
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    const re = /type\s*=\s*["']range["']|\.type\s*=\s*'range'|role\s*=\s*\\?["']slider/g;
    while (re.exec(src)) hits.push(f);
  }
  assert.ok(hits.includes('common.js') && hits.includes('setup.js') && hits.includes('music-skins.js'), `the known JS sliders were found (${hits.join(', ')})`);
  assert.ok(SWIPE_BACK_OWNER_SELECTORS.includes('input[type="range"]') && SWIPE_BACK_OWNER_SELECTORS.includes('[role="slider"]'),
    'the owner list covers every range input and ARIA slider generically');
});
