'use strict';

// [UNIT] v1.311.2 (Dean ruling 2026-09-22): "critters must never block button
// functionality". Drives the REAL capture-phase listeners (wireCritterListeners)
// with a critter whose VISIBLE box covers a real button, link and plain text:
//   - over a button/link: the element's own click ALWAYS fires, nothing is
//     cancelled, and the critter STILL plays its reaction + sound;
//   - over plain text: unchanged - the critter swallows the click (and the
//     reaction still plays), so the pass-through is not vacuous.

const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const COMMON = require.resolve('../../public/js/common.js');

let dom = null;
function boot() {
  // Require while `document` is undefined so the shell boot never runs.
  delete global.document; delete global.window; delete global.localStorage;
  delete require.cache[COMMON];
  const common = require(COMMON);
  dom = new JSDOM('<!DOCTYPE html><body>' +
    '<div id="critter-layer"><div class="critter-wrap"><div class="critter" id="pose"></div></div></div>' +
    '<button id="btn"><span id="btn-label">Like</span></button>' +
    '<a id="lnk" href="/watch.html?v=1">watch</a>' +
    '<div role="button" id="rb">menu</div>' +
    '<p id="txt">just words</p>' +
    '<div class="btn" id="btnclass">Save</div>' +
    '<div id="rows"><div class="music-song-row" id="row" style="cursor:pointer"><span id="row-title">Song</span></div></div>' +
    '</body>', { url: 'http://localhost/' });
  global.window = dom.window;
  global.document = dom.window.document;
  global.localStorage = dom.window.localStorage;
  const played = [];
  global.Audio = function (url) { this.play = () => { played.push(url); return Promise.resolve(); }; };
  // One critter whose visible box covers the whole test area; its own anchor
  // (the clipped-away region) is far away, so every point below is a HIT.
  common.setCritterPlacementsForTest([{ x: 0, y: 0, w: 2000, h: 2000, anchor: { x: 5000, y: 5000, w: 1, h: 1 }, sound: '/critters/squeak.mp3' }]);
  common.wireCritterListeners();
  return { doc: dom.window.document, win: dom.window, played, common };
}
afterEach(() => {
  if (dom) { dom.window.close(); dom = null; }
  delete global.window; delete global.document; delete global.localStorage; delete global.Audio;
  delete require.cache[COMMON];
});

function tap(win, el) {
  const e = new win.MouseEvent('click', { bubbles: true, cancelable: true, detail: 1, clientX: 40, clientY: 40 });
  el.dispatchEvent(e);
  return e;
}
function reacted(doc) {
  return Array.from(doc.getElementById('pose').classList).some((c) => c.startsWith('critter-') && c !== 'critter');
}

test('over a BUTTON: the button\'s click fires, nothing is cancelled, and the critter still reacts + plays its sound', () => {
  const { doc, win, played } = boot();
  let clicks = 0;
  doc.getElementById('btn').addEventListener('click', () => { clicks += 1; });
  const e = tap(win, doc.getElementById('btn-label')); // the real target is the label INSIDE the button
  assert.strictEqual(clicks, 1, 'the button\'s own handler ran - the critter did not swallow it');
  assert.strictEqual(e.defaultPrevented, false, 'the default is not cancelled');
  assert.ok(reacted(doc), 'the critter still plays a reaction');
  assert.deepStrictEqual(played, ['/critters/squeak.mp3'], 'and its sound');
});

test('over a LINK and an ARIA button: the element gets the click and the link keeps its navigation', () => {
  const { doc, win } = boot();
  let linkClicks = 0; let rbClicks = 0;
  doc.getElementById('lnk').addEventListener('click', (ev) => { linkClicks += 1; ev.preventDefault(); /* jsdom: no real nav */ });
  doc.getElementById('rb').addEventListener('click', () => { rbClicks += 1; });
  let navCancelledByCritter = null;
  doc.addEventListener('click', (ev) => { if (ev.target.id === 'lnk') navCancelledByCritter = ev.defaultPrevented; }, true);
  tap(win, doc.getElementById('lnk'));
  tap(win, doc.getElementById('rb'));
  assert.strictEqual(linkClicks, 1);
  assert.strictEqual(navCancelledByCritter, false, 'the critter never cancels a link\'s navigation');
  assert.strictEqual(rbClicks, 1);
});

test('CONTROL: over plain text the critter still swallows the click (the pass-through is scoped, not global)', () => {
  const { doc, win, played } = boot();
  let clicks = 0;
  doc.getElementById('txt').addEventListener('click', () => { clicks += 1; });
  const e = tap(win, doc.getElementById('txt'));
  assert.strictEqual(clicks, 0, 'plain furniture behind a critter never sees the tap');
  assert.strictEqual(e.defaultPrevented, true);
  assert.ok(reacted(doc));
  assert.strictEqual(played.length, 1);
});

test('mousedown: a button keeps its own press (no selection-suppress), plain text is still suppressed', () => {
  const { doc, win } = boot();
  const md = (el) => { const e = new win.MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 40, clientY: 40 }); el.dispatchEvent(e); return e; };
  assert.strictEqual(md(doc.getElementById('btn')).defaultPrevented, false, 'the button\'s mousedown is untouched');
  assert.strictEqual(md(doc.getElementById('txt')).defaultPrevented, true, 'text under a critter still cannot be spam-selected');
});

test('critterOverInteractive: the enumerated interactive kinds, and not plain content', () => {
  const { doc, common } = boot();
  for (const id of ['btn', 'btn-label', 'lnk', 'rb', 'btnclass', 'row', 'row-title']) assert.strictEqual(common.critterOverInteractive(doc.getElementById(id)), true, id);
  assert.strictEqual(common.critterOverInteractive(doc.getElementById('txt')), false);
  assert.strictEqual(common.critterOverInteractive(null), false);
  const bare = doc.createElement('a'); doc.body.appendChild(bare); // an <a> with no href is not a link
  assert.strictEqual(common.critterOverInteractive(bare), false);
});

test('gate W4 (adversary): a clickable ROW that is not a button (delegated click, cursor:pointer) gets its click', () => {
  const { doc, win, played } = boot();
  let plays = 0;
  // the real music list shape: ONE delegated listener on the list, rows are divs
  doc.getElementById('rows').addEventListener('click', (ev) => { if (ev.target.closest('.music-song-row')) plays += 1; });
  const e = tap(win, doc.getElementById('row-title'));
  assert.strictEqual(plays, 1, 'the song row played - the critter did not swallow it');
  assert.strictEqual(e.defaultPrevented, false);
  assert.ok(reacted(doc), 'the critter still reacts');
  assert.strictEqual(played.length, 1);
});

// v1.311.2 gate r1 (adversary S2): critter geometry reads the page's REAL scroll
// through the shared body lock - under a pinned body window.scrollY is 0.
test('critterPageScrollY: the lock\'s saved Y while pinned, plain window scroll otherwise; every geometry read uses it', () => {
  const { win, common } = boot();
  const BL = require('../../public/js/body-scroll-lock.js');
  let sy = 640;
  Object.defineProperty(win, 'pageYOffset', { get: () => (win.document.body.style.position === 'fixed' ? 0 : sy), configurable: true });
  Object.defineProperty(win, 'scrollY', { get: () => (win.document.body.style.position === 'fixed' ? 0 : sy), configurable: true });
  win.scrollTo = (_x, y) => { sy = y; };
  win.FileTubeBodyLock = BL;
  assert.strictEqual(common.critterPageScrollY(), 640, 'unlocked: the window scroll');
  BL.lock(win.document, win, 'faux-fullscreen');
  assert.strictEqual(win.scrollY, 0, 'precondition: a pinned body reads 0');
  assert.strictEqual(common.critterPageScrollY(), 640, 'locked: the real page scroll, not the pinned 0');
  BL.release(win.document, win, 'faux-fullscreen');
  const src = require('node:fs').readFileSync(COMMON, 'utf8');
  assert.strictEqual((src.match(/r\.top \+ window\.scrollY/g) || []).length, 0, 'no critter geometry reads raw window.scrollY');
  assert.strictEqual((src.match(/r\.top \+ critterPageScrollY\(\)/g) || []).length, 3, 'all three geometry reads route through the lock');
});
