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
  for (const id of ['btn', 'btn-label', 'lnk', 'rb']) assert.strictEqual(common.critterOverInteractive(doc.getElementById(id)), true, id);
  assert.strictEqual(common.critterOverInteractive(doc.getElementById('txt')), false);
  assert.strictEqual(common.critterOverInteractive(null), false);
  const bare = doc.createElement('a'); doc.body.appendChild(bare); // an <a> with no href is not a link
  assert.strictEqual(common.critterOverInteractive(bare), false);
});
