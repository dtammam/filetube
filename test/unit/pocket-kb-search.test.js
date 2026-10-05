// [UNIT] v1.355 (B): keyboard search on the iPod (experimental, Settings > Mobile player, OFF by default).
// Flag off: Music > Search is exactly v1.354's wheel letter strip (no input ever exists; the search bar's markup is
// byte-identical to v1.354's, frozen below from 534f4a70). Flag on: the press that opens Search creates ONE invisible
// input in the document body and focuses it in the same call stack; typing feeds the existing debounced read; the
// Search key / a blur puts the keyboard down and the wheel walks the results; the center with nothing to act on brings
// the keyboard back; MENU leaves; every exit removes the input; no page key handler sees a key typed into it.
// Driven through the REAL engine (skin-surface.js) and the real pure half (music-skins.js), as pocket-search.test.js.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const skinsPath = require.resolve('../../public/js/music-skins.js');
const surfacePath = require.resolve('../../public/js/skin-surface.js');
const skins = require(skinsPath);
const ROOT = path.join(__dirname, '..', '..');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const DEBOUNCE = 320;

// ---------------------------------------------------------------- the pure half
test('searchFromTyped: shown as typed (case, punctuation, spaces), control characters dropped, at most 40 characters as a reader counts them', () => {
  assert.strictEqual(skins.searchFromTyped('Pro Song, vol. 2!'), 'Pro Song, vol. 2!');
  assert.strictEqual(skins.searchFromTyped(null), '');
  assert.strictEqual(skins.searchFromTyped(undefined), '');
  assert.strictEqual(skins.searchFromTyped(42), '42');
  // control characters built programmatically (LESSONS 1: never type raw control bytes)
  const ctl = [0, 1, 9, 10, 13, 27, 31, 127, 0x80, 0x85, 0x9f].map((c) => String.fromCharCode(c)).join('');
  assert.strictEqual(skins.searchFromTyped('A' + ctl + 'B'), 'AB', 'C0, DEL and C1 are dropped');
  assert.strictEqual(skins.searchFromTyped('A' + String.fromCharCode(32) + String.fromCharCode(160) + 'B'), 'A ' + String.fromCharCode(160) + 'B', 'space and NBSP are not control characters');
  assert.strictEqual(skins.searchFromTyped('x'.repeat(41)), 'x'.repeat(40), 'the cap is SEARCH_MAX (40)');
  assert.strictEqual(skins.searchFromTyped('x'.repeat(40)), 'x'.repeat(40), 'exactly 40 stays');
  const smile = String.fromCodePoint(0x1F600);
  const capped = skins.searchFromTyped('x'.repeat(39) + smile + 'y');
  assert.strictEqual(capped, 'x'.repeat(39) + smile, 'an emoji counts as one character and is never cut in half');
  // gate r1 (adversary A5): multi-code-point emoji are one character too (grapheme clusters, Intl.Segmenter)
  const flag = String.fromCodePoint(0x1F1FA, 0x1F1F8);
  assert.strictEqual(skins.searchFromTyped('x'.repeat(39) + flag + 'y'), 'x'.repeat(39) + flag, 'a flag (two regional indicators) is kept whole');
  const family = [0x1F468, 0x200D, 0x1F469, 0x200D, 0x1F467].map((c) => String.fromCodePoint(c)).join('');
  assert.strictEqual(skins.searchFromTyped('x'.repeat(38) + family + 'yz'), 'x'.repeat(38) + family + 'y', 'a ZWJ family is one character, kept whole');
  // without Intl.Segmenter: code points, so never a lone surrogate
  const seg = Intl.Segmenter;
  try {
    delete Intl.Segmenter;
    const cut = skins.searchFromTyped('x'.repeat(39) + smile + 'y');
    assert.strictEqual(cut, 'x'.repeat(39) + smile, 'the fallback keeps the whole code point');
    assert.strictEqual(skins.searchFromTyped('x'.repeat(39) + flag), 'x'.repeat(39) + String.fromCodePoint(0x1F1FA), 'the fallback counts code points (no lone surrogate)');
  } finally { Intl.Segmenter = seg; }
  assert.strictEqual(skins.searchFromTyped(ctl.repeat(10) + 'Q'), 'Q', 'dropped before the cap is counted');
});

// The v1.354 markup, frozen from 534f4a70 (W0.3): flag off never changes a byte of it.
const FROZEN = [
  [{ q: '', sc: 0, focus: 'strip' }, '<div class="ipm-searchbar" data-skin-searchbar><div class="ipm-q is-empty" role="status">Search</div><div class="ipm-strip" role="group" aria-label="Letters"><span role="button" class="ipm-sc is-word" data-skin-strip="37" aria-label="delete">DEL</span><span role="button" class="ipm-sc is-word" data-skin-strip="38" aria-label="results">GO</span><span role="button" class="ipm-sc is-on" data-skin-strip="0" aria-label="A">A</span><span role="button" class="ipm-sc" data-skin-strip="1" aria-label="B">B</span><span role="button" class="ipm-sc" data-skin-strip="2" aria-label="C">C</span></div></div>'],
  [{ q: 'NIG', sc: 13, focus: 'strip' }, '<div class="ipm-searchbar" data-skin-searchbar><div class="ipm-q" role="status">NIG</div><div class="ipm-strip" role="group" aria-label="Letters"><span role="button" class="ipm-sc" data-skin-strip="11" aria-label="L">L</span><span role="button" class="ipm-sc" data-skin-strip="12" aria-label="M">M</span><span role="button" class="ipm-sc is-on" data-skin-strip="13" aria-label="N">N</span><span role="button" class="ipm-sc" data-skin-strip="14" aria-label="O">O</span><span role="button" class="ipm-sc" data-skin-strip="15" aria-label="P">P</span></div></div>'],
  [{ q: 'PRO', sc: 38, focus: 'list' }, '<div class="ipm-searchbar is-listfocus" data-skin-searchbar><div class="ipm-q" role="status">PRO</div><div class="ipm-strip" role="group" aria-label="Letters"><span role="button" class="ipm-sc is-word" data-skin-strip="36" aria-label="space">SPC</span><span role="button" class="ipm-sc is-word" data-skin-strip="37" aria-label="delete">DEL</span><span role="button" class="ipm-sc is-on is-word" data-skin-strip="38" aria-label="results">GO</span><span role="button" class="ipm-sc" data-skin-strip="0" aria-label="A">A</span><span role="button" class="ipm-sc" data-skin-strip="1" aria-label="B">B</span></div></div>'],
];

test('renderSearchBar: byte-identical to v1.354 for every model without kb (the W0.3 literals); kb draws the query alone', () => {
  for (const [m, html] of FROZEN) {
    assert.strictEqual(skins.renderSearchBar(m), html, JSON.stringify(m));
    assert.strictEqual(skins.renderSearchBar(Object.assign({ kb: false }, m)), html, 'kb:false is no kb');
  }
  const kb = skins.renderSearchBar({ q: 'R&B', sc: 5, focus: 'strip', kb: true });
  assert.strictEqual(kb, '<div class="ipm-searchbar is-kb" data-skin-searchbar><div class="ipm-q" role="status">R&amp;B</div></div>');
  assert.strictEqual(skins.renderSearchBar({ q: '', sc: 0, focus: 'list', kb: true }),
    '<div class="ipm-searchbar is-kb is-listfocus" data-skin-searchbar><div class="ipm-q is-empty" role="status">Search</div></div>');
});

test('keyboardSearchOn: only the stored literal "1" is on (absent, "0", "true" and a throwing storage are off)', () => {
  const saved = global.localStorage;
  try {
    const store = new Map();
    global.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null) };
    assert.strictEqual(skins.KB_SEARCH_KEY, 'ft-pocket-keyboard-search');
    assert.strictEqual(skins.keyboardSearchOn(), false, 'absent');
    for (const v of ['0', 'true', '']) { store.set(skins.KB_SEARCH_KEY, v); assert.strictEqual(skins.keyboardSearchOn(), false, v); }
    store.set(skins.KB_SEARCH_KEY, '1');
    assert.strictEqual(skins.keyboardSearchOn(), true);
    global.localStorage = { getItem: () => { throw new Error('denied'); } };
    assert.strictEqual(skins.keyboardSearchOn(), false);
  } finally { global.localStorage = saved; }
});

// ---------------------------------------------------------------- the controller (REAL engine)
function boot({ kb = true, search = null, hasCurrent = false } = {}) {
  const dom = new JSDOM('<body><video id="media-player"></video><button id="pp-btn"></button><button id="track-prev-btn"></button><button id="track-next-btn"></button><input id="seek-bar" type="range" /><div id="panel" class="music-nowplaying-panel" hidden></div></body>', { url: 'http://localhost/music', pretendToBeVisual: true });
  const saved = { window: global.window, document: global.document, Event: global.Event, localStorage: global.localStorage };
  Object.assign(global, { window: dom.window, document: dom.window.document, Event: dom.window.Event, localStorage: dom.window.localStorage });
  dom.window.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  delete require.cache[skinsPath]; delete require.cache[surfacePath];
  global.module = undefined;
  dom.window.FileTubeMusicSkins = require(skinsPath);
  require(surfacePath);
  const S = dom.window.FileTubeMusicSkins;
  S.setActiveSkin('ipod-black');
  const flag = { on: kb, reads: 0 };
  const plays = [];
  const cfg = {
    getSkinId: () => S.activeSkinId(),
    panel: dom.window.document.getElementById('panel'),
    getCtx: () => ({ track: { title: 'T', artist: 'A', artUrl: '/albumart/now' }, upNext: [], fullList: [], playing: true }),
    hostCtl: (id) => dom.window.document.getElementById(id), onSelectIndex: () => {}, onDock: () => {}, win: dom.window,
    menu: { dataVersion: () => 1, likedVersion: () => 1, load: () => Promise.resolve({ items: [] }), onPlay(r) { plays.push(r); }, search, onShuffleAll() {},
      hasCurrent: () => hasCurrent, currentId: () => null, keyboardSearch: () => { flag.reads += 1; return flag.on; } },
    sticker: { onSkinChange: () => { engine.paint(); } },
  };
  const engine = dom.window.FileTubeSkinSurface.create(cfg);
  engine.paint();
  return { dom, w: dom.window, d: dom.window.document, engine, S, plays, flag, restore: () => { try { engine.destroy(); } catch (_) { /* */ } Object.assign(global, saved); dom.window.close(); } };
}
const P = (b) => b.d.getElementById('panel');
const tap = (b, el) => { for (const t of ['pointerdown', 'pointerup', 'click']) el.dispatchEvent(new b.w.MouseEvent(t, { bubbles: true })); };
const rowsOf = (b) => [...P(b).querySelectorAll('.ipm-row:not(.ipm-skel)')];
const labelsOf = (b) => rowsOf(b).map((r) => r.querySelector('.ipm-lbl').textContent);
const tapLabel = (b, label) => { const r = rowsOf(b).find((x) => x.querySelector('.ipm-lbl').textContent === label); if (!r) throw new Error('no row ' + label + ' in ' + labelsOf(b)); tap(b, r); };
const cursorLabel = (b) => { const r = P(b).querySelector('.ipm-row.is-cursor .ipm-lbl'); return r && r.textContent; };
const pressMenu = (b) => tap(b, P(b).querySelector('[data-skin-menu]'));
const select = (b) => tap(b, P(b).querySelector('[data-skin-select]'));
const inputs = (b) => [...b.d.querySelectorAll('input.ipm-kb')];
const kbInput = (b) => b.d.getElementById('ipm-kb');
const query = (b) => { const e = P(b).querySelector('.ipm-q'); return e && (e.classList.contains('is-empty') ? '' : e.textContent); };
const wheelBy = (b, degs) => {
  const w = P(b).querySelector('.ip-wheel');
  const at = (d) => ({ clientX: 100 * Math.cos(d * Math.PI / 180), clientY: 100 * Math.sin(d * Math.PI / 180) });
  w.dispatchEvent(new b.w.MouseEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 0 }));
  const sgn = degs < 0 ? -1 : 1;
  for (let d = 8; d <= Math.abs(degs); d += 8) w.dispatchEvent(new b.w.MouseEvent('pointermove', Object.assign({ bubbles: true }, at(sgn * d))));
  w.dispatchEvent(new b.w.MouseEvent('pointerup', { bubbles: true }));
};
// Music, then the wheel onto the Search row (the last one), then the CENTER press opens it.
const centerIntoSearch = (b) => {
  tapLabel(b, 'Music');
  for (let k = 0; k < 20 && cursorLabel(b) !== 'Search'; k++) wheelBy(b, 24);
  assert.strictEqual(cursorLabel(b), 'Search', 'the wheel reached the Search row');
  select(b);
};
const type = (b, text) => { const i = kbInput(b); i.value = text; i.dispatchEvent(new b.w.Event('input', { bubbles: true })); };
const built = (labels) => ({ items: [{ label: 'Songs', info: true, heading: true, value: '' }].concat(labels.map((l, i) => ({ label: l, song: true, id: 's' + i, trackIndex: i }))),
  tracks: labels.map((l, i) => ({ id: 's' + i, title: l })), play: { ctx: { src: 'music', search: 'x', sort: 'title-asc' }, label: 'Search' } });

test('flag OFF (the default): Search is the v1.354 strip - no input is ever created (open, type, results, MENU out); the flag is still read live', async () => {
  const seen = [];
  const b = boot({ kb: false, search: (q) => { seen.push(q); return Promise.resolve(built(['Pro One'])); } });
  try {
    centerIntoSearch(b);
    assert.strictEqual(b.engine.menuState().title, 'Search');
    assert.strictEqual(b.flag.reads, 1, 'the open read the flag');
    assert.deepStrictEqual([...b.d.querySelectorAll('input')].map((i) => i.id), ['seek-bar'], 'no input but the fixture\'s own seek bar');
    assert.strictEqual(inputs(b).length, 0);
    assert.ok(P(b).querySelector('.ipm-strip'), 'the strip is drawn');
    assert.strictEqual(P(b).querySelector('.ipm-searchbar.is-kb'), null);
    select(b); // center adds the letter under the marker (A)
    assert.strictEqual(query(b), 'A', 'the wheel types, as v1.354');
    await wait(DEBOUNCE);
    assert.deepStrictEqual(seen, ['A']);
    assert.strictEqual(inputs(b).length, 0, 'results: still none');
    pressMenu(b); pressMenu(b);
    assert.strictEqual(b.engine.menuState().title, 'Music');
    assert.strictEqual(inputs(b).length, 0);
    assert.strictEqual(b.d.activeElement, b.d.body, 'focus never moved');
  } finally { b.restore(); }
});

test('flag ON: the center press that opens Search creates ONE input in the body (not the panel) and focuses it in the same call stack', () => {
  const b = boot({ search: () => Promise.resolve({ items: [] }) });
  const focusArgs = [];
  const realFocus = b.w.HTMLElement.prototype.focus;
  b.w.HTMLElement.prototype.focus = function (opts) { if (this.id === 'ipm-kb') focusArgs.push(opts); return realFocus.call(this, opts); };
  try {
    centerIntoSearch(b);
    // no await between the dispatched press and this read: the focus happened inside the press
    const i = kbInput(b);
    assert.deepStrictEqual(focusArgs, [{ preventScroll: true }], 'focused once, with preventScroll (no focus scroll)');
    assert.ok(i, 'the input exists');
    assert.strictEqual(b.d.activeElement, i, 'focused inside the opening press');
    assert.strictEqual(inputs(b).length, 1, 'exactly one');
    assert.strictEqual(i.parentNode, b.d.body, 'in the body (W0: the panel is rebuilt on every paint)');
    assert.strictEqual(P(b).contains(i), false);
    assert.strictEqual(i.getAttribute('enterkeyhint'), 'search');
    for (const [a, v] of [['autocomplete', 'off'], ['autocorrect', 'off'], ['autocapitalize', 'off'], ['spellcheck', 'false']]) assert.strictEqual(i.getAttribute(a), v, a);
    assert.ok(i.getAttribute('aria-label'), 'named');
    assert.ok(i.classList.contains('ui-field__input'), 'the field primitive (its 16px font)');
    assert.ok(P(b).querySelector('.ipm-searchbar.is-kb'), 'the bar is the query alone');
    assert.strictEqual(P(b).querySelector('.ipm-strip'), null, 'no strip in keyboard mode');
    assert.strictEqual(b.engine.menuState().title, 'Search');
  } finally { b.restore(); }
});

test('flag ON: a row tap on Search opens it the same way (focused in the tap); the flag is read live at each open', () => {
  const b = boot({ kb: false, search: () => Promise.resolve({ items: [] }) });
  try {
    tapLabel(b, 'Music'); tapLabel(b, 'Search');
    assert.strictEqual(inputs(b).length, 0, 'off: none');
    pressMenu(b);
    b.flag.on = true; // Settings flipped while the page stays up: no reload
    tapLabel(b, 'Search');
    assert.strictEqual(inputs(b).length, 1);
    assert.strictEqual(b.d.activeElement, kbInput(b));
  } finally { b.restore(); }
});

test('flag ON: typing feeds the existing debounced read - one read per settled query, with the typed text as typed', async () => {
  const seen = [];
  const b = boot({ search: (q) => { seen.push(q); return Promise.resolve(built(['Pro ' + q])); } });
  try {
    centerIntoSearch(b);
    type(b, 'P');
    await wait(DEBOUNCE / 2);
    type(b, 'Pr');
    await wait(DEBOUNCE / 2);
    type(b, 'Pro b');
    assert.strictEqual(query(b), 'Pro b', 'the bar shows the query at once');
    await wait(DEBOUNCE / 2);
    assert.deepStrictEqual(seen, [], 'nothing read while typing');
    await wait(DEBOUNCE);
    assert.deepStrictEqual(seen, ['Pro b'], 'one read, the whole text, case kept');
    assert.deepStrictEqual(labelsOf(b), ['Songs', 'Pro Pro b']);
    assert.strictEqual(b.d.activeElement, kbInput(b), 'the keyboard stays up while the results render');
    assert.strictEqual(inputs(b).length, 1, 'still exactly one after the renders');
    // a control character pasted in never reaches the query, and the field is put back to the query
    type(b, 'Pro b' + String.fromCharCode(9) + 'x');
    assert.strictEqual(query(b), 'Pro bx');
    assert.strictEqual(kbInput(b).value, 'Pro bx');
  } finally { b.restore(); }
});

test('flag ON: an IME composition applies on compositionend, never on the composing input events', async () => {
  const seen = [];
  const b = boot({ search: (q) => { seen.push(q); return Promise.resolve(built(['x'])); } });
  try {
    centerIntoSearch(b);
    const i = kbInput(b);
    i.value = 'ni';
    const ev = new b.w.Event('input', { bubbles: true });
    Object.defineProperty(ev, 'isComposing', { value: true });
    i.dispatchEvent(ev);
    assert.strictEqual(query(b), '', 'a composing input is skipped');
    i.value = 'に';
    i.dispatchEvent(new b.w.Event('compositionend', { bubbles: true }));
    assert.strictEqual(query(b), 'に');
    await wait(DEBOUNCE);
    assert.deepStrictEqual(seen, ['に']);
  } finally { b.restore(); }
});

test('flag ON: the Search key (Enter) puts the keyboard down and the wheel then walks the results from the first row', async () => {
  const b = boot({ search: () => Promise.resolve(built(['One', 'Two', 'Three'])) });
  try {
    centerIntoSearch(b);
    type(b, 'o');
    await wait(DEBOUNCE);
    assert.strictEqual(b.d.activeElement, kbInput(b));
    const ev = new b.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    kbInput(b).dispatchEvent(ev);
    assert.strictEqual(ev.defaultPrevented, true);
    assert.notStrictEqual(b.d.activeElement, kbInput(b), 'keyboard down');
    await wait(5);
    assert.strictEqual(cursorLabel(b), 'One', 'the first result row is highlighted (the heading is never a stop)');
    assert.ok(P(b).querySelector('.ipm-searchbar.is-listfocus'));
    wheelBy(b, 24);
    assert.notStrictEqual(cursorLabel(b), 'One', 'the wheel walks the rows');
    for (let k = 0; k < 6; k++) wheelBy(b, -24);
    assert.strictEqual(cursorLabel(b), 'One', 'up at the first row stays there (no strip to go back to)');
    assert.strictEqual(inputs(b).length, 1, 'the input stays for the next tap on the bar');
    select(b);
    assert.strictEqual(b.plays.length, 1, 'the center on a result plays it');
    assert.strictEqual(b.plays[0].index, 0);
    assert.strictEqual(inputs(b).length, 0, 'Now Playing: the input is gone');
  } finally { b.restore(); }
});

test('flag ON: one wheel detent up on the first result stays on it (keyboard mode has no strip to go back to)', async () => {
  const b = boot({ search: () => Promise.resolve(built(['One', 'Two'])) });
  try {
    centerIntoSearch(b);
    type(b, 'o');
    await wait(DEBOUNCE);
    kbInput(b).dispatchEvent(new b.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await wait(5);
    assert.strictEqual(cursorLabel(b), 'One');
    wheelBy(b, -24);
    assert.strictEqual(cursorLabel(b), 'One', 'still on the first row');
    assert.ok(P(b).querySelector('.ipm-searchbar.is-listfocus'), 'and the wheel still holds the results');
  } finally { b.restore(); }
});

test('flag ON: turning the wheel while the keyboard is up with results puts it down and walks them from the first row', async () => {
  const b = boot({ search: () => Promise.resolve(built(['One', 'Two'])) });
  try {
    centerIntoSearch(b);
    type(b, 'o');
    await wait(DEBOUNCE);
    assert.strictEqual(b.d.activeElement, kbInput(b), 'typing: keyboard up');
    assert.strictEqual(cursorLabel(b), null, 'no highlight while typing');
    wheelBy(b, 24);
    assert.notStrictEqual(b.d.activeElement, kbInput(b), 'the wheel put the keyboard down');
    assert.ok(cursorLabel(b) === 'One' || cursorLabel(b) === 'Two', 'and highlights a result row: ' + cursorLabel(b));
    assert.ok(P(b).querySelector('.ipm-searchbar.is-listfocus'));
  } finally { b.restore(); }
});

test('flag ON: the input lies exactly over the query bar (its rect), and is placed again on a re-layout (render, resize)', async () => {
  const b = boot({ search: () => Promise.resolve(built(['One'])) });
  try {
    let box = { left: 10.4, top: 20.6, width: 150, height: 31 };
    const proto = b.w.Element.prototype;
    const orig = proto.getBoundingClientRect;
    proto.getBoundingClientRect = function () { return this.classList && this.classList.contains('ipm-q') ? Object.assign({ right: 0, bottom: 0, x: 0, y: 0 }, box) : orig.call(this); };
    centerIntoSearch(b);
    const st = () => { const s = kbInput(b).style; return [s.left, s.top, s.width, s.height]; };
    assert.deepStrictEqual(st(), ['10px', '21px', '150px', '31px']);
    box = { left: 12, top: 300, width: 140, height: 28 };
    type(b, 'o'); // a render
    assert.deepStrictEqual(st(), ['12px', '300px', '140px', '28px'], 'after a render');
    box = { left: 5, top: 40, width: 200, height: 30 };
    b.w.dispatchEvent(new b.w.Event('resize'));
    assert.deepStrictEqual(st(), ['5px', '40px', '200px', '30px'], 'after a resize');
    pressMenu(b);
    box = { left: 1, top: 1, width: 1, height: 1 };
    b.w.dispatchEvent(new b.w.Event('resize')); // nothing to place, nothing throws (the listener count is bound below)
    assert.strictEqual(inputs(b).length, 0);
    proto.getBoundingClientRect = orig;
  } finally { b.restore(); }
});

// gate r1 (qa Q2): every handle the input brings (a window resize listener, a MutationObserver on the panel, the blur's
// hand-over timer) goes with it, on every way out.
function countHandles(b) {
  const c = { resizeAdd: 0, resizeRemove: 0, observe: 0, disconnect: 0 };
  const add = b.w.addEventListener.bind(b.w); const rem = b.w.removeEventListener.bind(b.w);
  const mine = new Set(); // only listeners added after counting starts (the engine's own resize listener predates it)
  b.w.addEventListener = (t, f, o) => { if (t === 'resize') { c.resizeAdd += 1; mine.add(f); } return add(t, f, o); };
  b.w.removeEventListener = (t, f, o) => { if (t === 'resize' && mine.has(f)) c.resizeRemove += 1; return rem(t, f, o); };
  const MO = b.w.MutationObserver;
  b.w.MutationObserver = class extends MO {
    observe(t, o) { this.kbCounted = !(o && o.subtree); if (this.kbCounted) c.observe += 1; return super.observe(t, o); }
    disconnect() { if (this.kbCounted) { c.disconnect += 1; this.kbCounted = false; } return super.disconnect(); }
  };
  c.live = () => ({ resize: c.resizeAdd - c.resizeRemove, mo: c.observe - c.disconnect });
  return c;
}
test('flag ON: the input\'s resize listener and panel observer are taken back on MENU, Now Playing, a dock and destroy (never one more per entry)', async () => {
  const b = boot({ search: () => Promise.resolve({ items: [] }), hasCurrent: true });
  try {
    pressMenu(b); // NP -> Main
    const c = countHandles(b);
    const open = () => { centerIntoSearch(b); assert.deepStrictEqual(c.live(), { resize: 1, mo: 1 }, 'one of each while open'); };
    open();
    pressMenu(b); // MENU leaves
    assert.deepStrictEqual(c.live(), { resize: 0, mo: 0 }, 'MENU');
    tapLabel(b, 'Search');
    assert.deepStrictEqual(c.live(), { resize: 1, mo: 1 });
    pressMenu(b); pressMenu(b); tapLabel(b, 'Now Playing');
    assert.deepStrictEqual(c.live(), { resize: 0, mo: 0 }, 'Now Playing');
    pressMenu(b); pressMenu(b); // NP -> Music -> Main
    open();
    P(b).innerHTML = ''; // a dock: the view empties the panel, no render
    await wait(0);
    assert.deepStrictEqual(c.live(), { resize: 0, mo: 0 }, 'dock');
    b.engine.paint();
    assert.deepStrictEqual(c.live(), { resize: 1, mo: 1 }, 'expanded again on Search');
    b.engine.destroy();
    assert.deepStrictEqual(c.live(), { resize: 0, mo: 0 }, 'destroy');
    assert.ok(c.resizeAdd >= 4 && c.observe >= 4, 'the counters saw every entry');
  } finally { b.restore(); }
});

test('flag ON: a blur\'s hand-over timer never acts on a later input (blur, then a dock, then back on Search before it fires)', async () => {
  const b = boot({ search: () => Promise.resolve(built(['One', 'Two'])) });
  try {
    centerIntoSearch(b);
    type(b, 'o');
    await wait(DEBOUNCE);
    kbInput(b).blur(); // schedules the hand-over one turn later
    P(b).innerHTML = ''; // a dock in the same turn
    await Promise.resolve(); // the panel observer runs: the input is gone
    assert.strictEqual(inputs(b).length, 0);
    b.engine.paint(); // expanded again on Search: a NEW input, keyboard down, results not yet walked
    assert.strictEqual(inputs(b).length, 1);
    await wait(10); // the old timer's turn
    assert.strictEqual(cursorLabel(b), null, 'the stale hand-over did nothing to the new input\'s level');
    assert.strictEqual(P(b).querySelector('.ipm-searchbar.is-listfocus'), null);
  } finally { b.restore(); }
});

test('flag ON: a tap on a result row while the keyboard is up plays it: the blur that comes first never redraws the rows under the tap', async () => {
  const b = boot({ search: () => Promise.resolve(built(['One', 'Two'])) });
  try {
    centerIntoSearch(b);
    type(b, 'o');
    await wait(DEBOUNCE);
    assert.strictEqual(b.d.activeElement, kbInput(b), 'keyboard up');
    const row = rowsOf(b).find((r) => r.querySelector('.ipm-lbl').textContent === 'Two');
    kbInput(b).blur(); // the browser blurs on the press...
    tap(b, row); // ...and clicks the same row in the same turn
    assert.strictEqual(b.plays.length, 1, 'the row played');
    assert.strictEqual(b.plays[0].index, 1, 'the row that was tapped');
    assert.strictEqual(b.engine.menuState().screen, 'np');
    assert.strictEqual(inputs(b).length, 0, 'Now Playing: the input is gone');
    await wait(5);
    assert.strictEqual(b.engine.menuState().screen, 'np', 'the late hand-over changed nothing');
  } finally { b.restore(); }
});

test('flag ON: a tap on the query bar brings the keyboard back up, inside the tap (the input itself takes no taps)', async () => {
  const b = boot({ search: () => Promise.resolve(built(['One'])) });
  try {
    centerIntoSearch(b);
    type(b, 'o');
    await wait(DEBOUNCE);
    kbInput(b).blur();
    await wait(5);
    assert.notStrictEqual(b.d.activeElement, kbInput(b));
    tap(b, P(b).querySelector('.ipm-q'));
    assert.strictEqual(b.d.activeElement, kbInput(b), 'focused in the same tap');
    assert.strictEqual(b.plays.length, 0, 'nothing else happened');
    assert.strictEqual(b.engine.menuState().title, 'Search');
    const css = fs.readFileSync(path.join(ROOT, 'public/css/style.css'), 'utf8');
    const rule = /\n {2}:where\(html\.is-phone, html\.mms-popout\) \.ipm-kb\{([^}]*)\}/.exec(css);
    assert.ok(rule, 'the .ipm-kb rule');
    assert.match(rule[1], /(^|;)\s*pointer-events:none;/, 'the input takes no taps (an overlay over the bar keeps its own)');
    assert.doesNotMatch(rule[1], /z-index/, 'and no longer sits above the skin');
  } finally { b.restore(); }
});

test('flag ON: Enter while an IME is composing (isComposing, or WebKit\'s keyCode 229) is the IME\'s confirm, not the Search key', () => {
  const b = boot({ search: () => Promise.resolve({ items: [] }) });
  try {
    centerIntoSearch(b);
    const composing = new b.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, isComposing: true });
    kbInput(b).dispatchEvent(composing);
    assert.strictEqual(b.d.activeElement, kbInput(b), 'isComposing: the keyboard stays');
    assert.strictEqual(composing.defaultPrevented, false);
    const k229 = new b.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    Object.defineProperty(k229, 'keyCode', { value: 229 });
    kbInput(b).dispatchEvent(k229);
    assert.strictEqual(b.d.activeElement, kbInput(b), 'keyCode 229: the keyboard stays');
    kbInput(b).dispatchEvent(new b.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    assert.notStrictEqual(b.d.activeElement, kbInput(b), 'a plain Enter is the Search key');
  } finally { b.restore(); }
});

test('flag ON: the pop-out tray (no menu shown) takes the input away; the menu back brings it back', () => {
  const b = boot({ search: () => Promise.resolve({ items: [] }) });
  try {
    centerIntoSearch(b);
    b.d.body.classList.add('mms-tray');
    b.engine.paint();
    assert.strictEqual(inputs(b).length, 0, 'tray up: no input');
    b.d.body.classList.remove('mms-tray');
    b.engine.paint();
    assert.strictEqual(inputs(b).length, 1, 'tray down, Search on screen: one');
  } finally { b.restore(); }
});

test('flag ON: a blur (Done, a tap outside) puts the keyboard down the same way; results that land while it is down get the wheel too', async () => {
  const d = [];
  const b = boot({ search: () => new Promise((r) => d.push(r)) });
  try {
    centerIntoSearch(b);
    type(b, 'tw');
    kbInput(b).blur();
    await wait(5);
    assert.strictEqual(cursorLabel(b), null, 'nothing to walk yet');
    await wait(DEBOUNCE);
    d[0](built(['Two', 'Twelve']));
    await wait(5);
    assert.strictEqual(cursorLabel(b), 'Two', 'the late results are walked from their first row');
    assert.ok(P(b).querySelector('.ipm-searchbar.is-listfocus'));
  } finally { b.restore(); }
});

test('flag ON: the center with nothing to act on (empty query, no matches) brings the keyboard back up', async () => {
  const b = boot({ search: () => Promise.resolve({ items: [] }) });
  try {
    centerIntoSearch(b);
    kbInput(b).blur();
    await wait(5);
    assert.notStrictEqual(b.d.activeElement, kbInput(b));
    select(b);
    assert.strictEqual(b.d.activeElement, kbInput(b), 'empty query: keyboard up again');
    type(b, 'zz');
    await wait(DEBOUNCE);
    kbInput(b).blur();
    await wait(5);
    select(b);
    assert.strictEqual(b.d.activeElement, kbInput(b), 'no matches: keyboard up again');
    assert.strictEqual(b.plays.length, 0);
    wheelBy(b, 24);
    assert.strictEqual(b.d.activeElement, kbInput(b), 'and the wheel with no rows does nothing');
  } finally { b.restore(); }
});

test('flag ON: MENU leaves Search at once (one level up, the query untouched) and the input is removed; re-entry makes exactly one', () => {
  const b = boot({ search: () => Promise.resolve({ items: [] }) });
  try {
    centerIntoSearch(b);
    type(b, 'abc');
    kbInput(b).blur();
    pressMenu(b);
    assert.strictEqual(b.engine.menuState().title, 'Music', 'climbed, no letter-by-letter delete');
    assert.strictEqual(inputs(b).length, 0, 'removed');
    assert.strictEqual(b.d.getElementById('ipm-kb'), null);
    tapLabel(b, 'Search');
    assert.strictEqual(inputs(b).length, 1, 're-entry: one');
    assert.strictEqual(kbInput(b).value, '', 'a fresh level, a fresh query');
    pressMenu(b);
    tapLabel(b, 'Search');
    assert.strictEqual(inputs(b).length, 1, 'still one');
  } finally { b.restore(); }
});

test('flag ON: Now Playing, a skin with no menus, a dock (the view empties the panel) and destroy each remove the input', async () => {
  const b = boot({ search: () => Promise.resolve({ items: [] }), hasCurrent: false });
  try {
    centerIntoSearch(b);
    assert.strictEqual(inputs(b).length, 1);
    b.S.setActiveSkin('apple'); b.engine.paint(); // a skin change to Cider (no menus)
    assert.strictEqual(inputs(b).length, 0, 'skin change: removed');
    b.S.setActiveSkin('ipod-black'); b.engine.paint();
    centerIntoSearch(b);
    assert.strictEqual(inputs(b).length, 1);
    b.engine.paint(); // a track change repaints the whole panel: the level and its input stay
    assert.strictEqual(inputs(b).length, 1, 'a repaint keeps it');
    assert.strictEqual(b.engine.menuState().title, 'Search');
    P(b).innerHTML = ''; P(b).hidden = true; // the view docks: updateNowPlayingPanel empties the panel, no render
    await wait(0);
    assert.strictEqual(inputs(b).length, 0, 'dock: removed (the observer)');
    b.engine.paint();
    assert.strictEqual(inputs(b).length, 1, 'expanded again on Search: one, unfocused');
    assert.notStrictEqual(b.d.activeElement, kbInput(b));
    b.engine.destroy();
    assert.strictEqual(inputs(b).length, 0, 'destroy: removed');
  } finally { b.restore(); }
});

test('flag ON: a tap on an album result drills in (the input leaves with the level) and MENU comes back to the same query in keyboard mode', async () => {
  const b = boot({ search: () => Promise.resolve({ items: [{ label: 'Albums', info: true, heading: true, value: '' }, { label: 'Proto', node: { type: 'album', key: 'k1', label: 'Proto' } }] }) });
  try {
    centerIntoSearch(b);
    type(b, 'pro');
    await wait(DEBOUNCE);
    tapLabel(b, 'Proto');
    assert.strictEqual(b.engine.menuState().title, 'Proto');
    assert.strictEqual(inputs(b).length, 0, 'the album level has no input');
    pressMenu(b);
    assert.strictEqual(b.engine.menuState().title, 'Search');
    assert.strictEqual(inputs(b).length, 1, 'back on Search: one input');
    assert.strictEqual(kbInput(b).value, 'pro', 'holding the query');
    assert.strictEqual(query(b), 'pro');
    assert.ok(P(b).querySelector('.ipm-searchbar.is-kb'), 'still keyboard mode');
    assert.notStrictEqual(b.d.activeElement, kbInput(b), 'not focused: the keyboard comes up on the center or a tap on the bar');
  } finally { b.restore(); }
});

test('flag ON: Now Playing from the menu removes the input', () => {
  const b = boot({ search: () => Promise.resolve({ items: [] }), hasCurrent: true });
  try {
    pressMenu(b); // the NP screen -> Main
    centerIntoSearch(b);
    assert.strictEqual(inputs(b).length, 1);
    pressMenu(b); pressMenu(b); // Music -> Main
    tapLabel(b, 'Now Playing');
    assert.strictEqual(b.engine.menuState().screen, 'np');
    assert.strictEqual(inputs(b).length, 0);
  } finally { b.restore(); }
});

test('flag ON: no page key handler sees a key typed into the input (keydown/keypress/keyup never bubble past it)', () => {
  const b = boot({ search: () => Promise.resolve({ items: [] }) });
  try {
    centerIntoSearch(b);
    const heard = [];
    for (const t of ['keydown', 'keypress', 'keyup']) {
      b.d.addEventListener(t, (e) => heard.push('document ' + t + ' ' + e.key));
      b.w.addEventListener(t, (e) => heard.push('window ' + t + ' ' + e.key));
      b.d.body.addEventListener(t, (e) => heard.push('body ' + t + ' ' + e.key));
    }
    for (const key of ['Escape', ' ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'f', 'm', 'j', 'l', 'd', '?', 'k', '0', 'Tab', 'Enter']) {
      for (const t of ['keydown', 'keypress', 'keyup']) kbInput(b).dispatchEvent(new b.w.KeyboardEvent(t, { key, bubbles: true, cancelable: true }));
    }
    assert.deepStrictEqual(heard, [], 'nothing reached a bubble listener');
    // the control: the same keys on another element DO reach them (the spies work)
    b.d.getElementById('seek-bar').dispatchEvent(new b.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.deepStrictEqual(heard, ['body keydown Escape', 'document keydown Escape', 'window keydown Escape']);
  } finally { b.restore(); }
});

test('flag ON: the skins search (Extras > Skins > Search) stays on the strip - never an input (R5)', () => {
  const b = boot({ search: () => Promise.resolve({ items: [] }) });
  try {
    tapLabel(b, 'Extras'); tapLabel(b, 'Skins'); tapLabel(b, 'Search');
    assert.strictEqual(b.engine.menuState().title, 'Search');
    assert.strictEqual(inputs(b).length, 0);
    assert.ok(P(b).querySelector('.ipm-strip'), 'the strip');
    select(b);
    assert.strictEqual(inputs(b).length, 0);
    assert.strictEqual(b.flag.reads, 0, 'the flag is not even asked');
  } finally { b.restore(); }
});

// ---------------------------------------------------------------- the wiring outside the engine
test('music.js hands the engine a LIVE keyboardSearch reader (music-skins.js keyboardSearchOn), beside search', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public/js/music.js'), 'utf8');
  const cfg = /\n {8}menu: \{([\s\S]*?)\n {8}\},/.exec(src);
  assert.ok(cfg, 'the pocket menu cfg');
  assert.match(cfg[1], /\n {10}keyboardSearch: function \(\) \{ var MS = window\.FileTubeMusicSkins; return !!\(MS && typeof MS\.keyboardSearchOn === 'function' && MS\.keyboardSearchOn\(\)\); \},/);
});

test('Settings > Mobile player: the "Keyboard search (experimental)" switch reflects and writes ft-pocket-keyboard-search ("1" / removed)', () => {
  const setup = require('../../public/js/setup.js');
  const html = fs.readFileSync(path.join(ROOT, 'public/setup.html'), 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost/setup.html' });
  const w = dom.window;
  w.FileTubeMusicSkins = skins;
  try {
    const c = w.document.getElementById('pocket-kb-search-check');
    assert.ok(c.closest('details[data-collapse-key="mobile-player"]'), 'in Mobile player');
    assert.strictEqual(w.document.querySelector('label[for="pocket-kb-search-check"]').textContent, 'Keyboard search (experimental)');
    assert.match(c.closest('.setup-group').querySelector('.setup-note').textContent, /phone's keyboard instead of the wheel's letters\. Off by default; remembered on this device only\./);
    setup.loadPocketKbSearchControl(w);
    assert.strictEqual(c.checked, false, 'off by default');
    w.localStorage.setItem('ft-pocket-keyboard-search', '1');
    setup.loadPocketKbSearchControl(w);
    assert.strictEqual(c.checked, true, 'reflects on');
    w.localStorage.setItem('ft-pocket-keyboard-search', '0');
    setup.loadPocketKbSearchControl(w);
    assert.strictEqual(c.checked, false, 'only "1" is on');
    setup.wirePocketKbSearchControl(w);
    c.checked = true; c.dispatchEvent(new w.Event('change'));
    assert.strictEqual(w.localStorage.getItem('ft-pocket-keyboard-search'), '1');
    c.checked = false; c.dispatchEvent(new w.Event('change'));
    assert.strictEqual(w.localStorage.getItem('ft-pocket-keyboard-search'), null, 'removed, not "0"');
    const src = fs.readFileSync(path.join(ROOT, 'public/js/setup.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    assert.match(/\nfunction init\(root\) \{([\s\S]*?)\n\}/.exec(src)[1], /\n\s*loadPocketKbSearchControl\(window\);/, 'init prefills it');
    assert.match(/\nfunction wireStaticControls\(signal\) \{([\s\S]*?)\n\}/.exec(src)[1], /\n\s*wirePocketKbSearchControl\(window, signal\);/, 'wireStaticControls wires it');
  } finally { w.close(); }
});

// ---------------------------------------------------------------- R9: the key-listener census
// Every keydown / keypress / keyup listener in a script a player shell can load. The input stops the three at itself,
// so a BUBBLE listener on document/window can never see its keys (bound behaviourally above). A CAPTURE listener runs
// before the target, so each one is classified here by hand, with the reason it cannot act on a key typed into the
// keyboard-search input. A new key listener fails this census until it is classified (a denylist that fails closed).
const SCRIPTS = fs.readdirSync(path.join(ROOT, 'public/js')).filter((f) => f.endsWith('.js')).map((f) => 'public/js/' + f)
  .concat(fs.readdirSync(path.join(ROOT, 'lib/ytdlp/client')).filter((f) => f.endsWith('.js')).map((f) => 'lib/ytdlp/client/' + f));
const CLASSIFIED = [
  // element-scoped: the listener sits on its own element, never on the keyboard-search input
  ['public/js/common.js', "handle.addEventListener('keydown'", 'element'],
  ['public/js/common.js', "searchInput.addEventListener('keydown'", 'element'],
  ['public/js/ui.js', "node.addEventListener('keydown'", 'element'],
  ['public/js/ui.js', "f.input.addEventListener('keydown'", 'element'],
  ['public/js/ui.js', "b.addEventListener('keydown'", 'element'],
  ['public/js/podcasts.js', "url.input.addEventListener('keydown'", 'element'],
  ['public/js/setup.js', "input.addEventListener('keypress'", 'element'],
  ['public/js/setup.js', "newFolderPathInput.addEventListener('keypress'", 'element'],
  ['public/js/setup.js', "input.addEventListener('keydown'", 'element'],
  ['public/js/music.js', "if (searchInput) searchInput.addEventListener('keydown'", 'element'],
  // the keyboard-search input's own listeners (the stop itself)
  ['public/js/skin-surface.js', "['keydown', 'keypress', 'keyup'].forEach(function (t) { i.addEventListener(t, kbKey); });", 'the input itself'],
  ['public/js/skin-surface.js', "if (e.type === 'keydown' && (e.key === 'Enter' || e.keyCode === 13) && !e.isComposing && e.keyCode !== 229) {", 'the input itself (its Search key)'],
  // bubble on document/window: the input's stopPropagation keeps them deaf (bound by the dispatch test above)
  ['public/js/music.js', "document.addEventListener('keydown', function (e) {\n      if (e.key === 'Escape' && actionsMenu", 'bubble'],
  ['public/js/player.js', "document.addEventListener('keydown', function (e) {\n      if (state !== STATE_FULL) return;\n      if (e.ctrlKey", 'bubble'],
  ['public/js/player.js', "document.addEventListener('keydown', function (e) {\n      if (state !== STATE_FULL) return;\n      if (!host", 'bubble'],
  ['public/js/player.js', "document.addEventListener('keydown', function (e) {\n      if (typeof window.isShortcutsModalOpen", 'bubble'],
  ['public/js/common.js', "doc.addEventListener('keydown', onDocKeyDown, { signal: pressSignal });", 'bubble'],
  ['public/js/common.js', "document.addEventListener('keydown', onKey);", 'bubble'],
  ['public/js/common.js', "document.removeEventListener('keydown', onKey);", 'bubble'],
  ['public/js/common.js', "document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSearch(); });", 'bubble'],
  ['public/js/ui.js', "doc.addEventListener('keydown', onKey);", 'bubble'],
  ['public/js/ui.js', "doc.removeEventListener('keydown', onKey);", 'bubble'],
  ['public/js/read.js', "document.addEventListener('keydown', (event) => {", 'bubble'],
  // capture: each one, why it cannot act on a key typed into the input
  ['public/js/common.js', "document.addEventListener('keydown', ddrKeyHandler, true);", 'capture: only while the shortcuts dialog is open, and opening it moves the focus to its close button'],
  ['public/js/common.js', "document.removeEventListener('keydown', shortcutsModalState.ddrKeyHandler, true);", 'capture: the removal of the one above'],
  ['public/js/common.js', "document.addEventListener('keydown', (e) => {\n    if (e.key === 'Escape' && shortcutsModalState)", 'capture: D and ? skip an INPUT target (shouldToggleThemeKey / shouldOpenShortcuts); Escape acts only with the shortcuts dialog open, which holds the focus'],
  ['public/js/ipod-brick.js', "keyDoc.addEventListener('keydown', keyFn, true);", 'capture: only while Brick runs, which starts from Extras, so Search (and its input) has been left'],
  ['public/js/ipod-brick.js', "keyDoc.removeEventListener('keydown', keyFn, true);", 'capture: the removal of the one above'],
  ['public/js/player.js', "['touchstart', 'pointerdown', 'wheel', 'keydown'].forEach(function (type) {", 'capture, passive: any input ends the rotation scroll-snap window; no key action'],
  ['public/js/player.js', "speedBadge.addEventListener('keydown', function (e) {", 'element: the locked 2x pill only; Enter or Space unlocks, a key typed into the input never reaches it'],
  ['public/js/player.js', "document.addEventListener('keydown', resumeCountdownCancelKey, true);", 'capture: observes only, any key just cancels the Resume prompt countdown (it never reads the key or acts on it), live only while that prompt shows'],
  ['public/js/player.js', "document.removeEventListener('keydown', resumeCountdownCancelKey, true);", 'capture: the removal of the one above'],
  ['public/js/remote.js', "var ACTIVATION_EVENTS = ['pointerdown', 'pointerup', 'keydown', 'click'];", 'capture: marks user activation on a speaker; observes only'],
];
test('R9 census: every key listener a player shell can load is classified (element / the input / bubble / capture with a reason)', () => {
  const found = [];
  for (const f of SCRIPTS) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const m of src.matchAll(/['"](keydown|keypress|keyup)['"]/g)) found.push({ f, at: m.index });
  }
  assert.ok(found.length >= 25, 'the scan sees the listeners (' + found.length + ')');
  const claimed = new Set();
  for (const [f, needle, why] of CLASSIFIED) {
    assert.ok(why && why.length >= 6, 'a reason');
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const at = [];
    let k = -1;
    while ((k = src.indexOf(needle, k + 1)) !== -1) at.push(k);
    assert.ok(at.length >= 1, f + ': classified listener not found: ' + needle.slice(0, 60));
    for (const a of at) for (const h of found) if (h.f === f && h.at >= a && h.at < a + needle.length) claimed.add(h.f + ':' + h.at);
  }
  const unclassified = found.filter((h) => !claimed.has(h.f + ':' + h.at)).map((h) => {
    const src = fs.readFileSync(path.join(ROOT, h.f), 'utf8');
    return h.f + ':' + src.slice(0, h.at).split('\n').length + ' ' + src.slice(src.lastIndexOf('\n', h.at) + 1, src.indexOf('\n', h.at)).trim();
  });
  assert.deepStrictEqual(unclassified, [], 'classify each new key listener (and if it is CAPTURE on document/window, say why the keyboard-search input is safe)');
  // gate r1 (adversary A4): the class is checked against the PHASE the call really registers in, not only its text
  let phased = 0;
  for (const [f, needle, why] of CLASSIFIED) {
    if (!(why === 'bubble' || why.startsWith('capture'))) continue;
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    let k = -1;
    while ((k = src.indexOf(needle, k + 1)) !== -1) {
      const li = needle.indexOf("EventListener('key");
      if (li < 0) continue; // an array form (classified by its reason)
      const open = k + li + 'EventListener'.length;
      const phase = listenerPhase(src, open);
      assert.strictEqual(phase, why === 'bubble' ? 'bubble' : 'capture', f + ': ' + needle.slice(0, 50) + ' registers in the ' + phase + ' phase, classified ' + why.split(':')[0]);
      phased += 1;
    }
  }
  assert.ok(phased >= 14, 'the phase check reached the calls (' + phased + ')');
});

// The phase an add/removeEventListener call at `open` (its '(') registers in: its LAST top-level argument `true`, or an
// options object with `capture: true`, is capture; anything else is bubble. Quotes, comments and nested brackets are skipped.
function listenerPhase(src, open) {
  let depth = 0; let q = null; let lastComma = -1; let end = -1;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (q) { if (c === '\\') { i += 1; continue; } if (c === q) q = null; continue; }
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); continue; } // a line comment (an apostrophe in it is no quote)
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i) + 1; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') { depth -= 1; if (depth === 0) { end = i; break; } }
    else if (c === ',' && depth === 1) lastComma = i;
  }
  assert.ok(end > 0 && lastComma > 0, 'parsed the call');
  const last = src.slice(lastComma + 1, end).trim();
  return (last === 'true' || /\bcapture\s*:\s*true\b/.test(last)) ? 'capture' : 'bubble';
}
