'use strict';

// [UNIT] v1.405.0 nativeTabBar (plan docs/exec-plans/active/2026-11-08-glass-tab-pill.md, W3 + the Contract). The iPhone app draws
// Modern's pill natively ABOVE the web view, so the web must (a) never send anything without the capability, (b) send exactly what
// the web bar shows - items, order, the lit item - on every trigger, (c) say visible:false whenever ANY surface that covers the web
// bar today is up (one predicate over an enumerated list; the census below derives every candidate family from the stylesheets and
// fails a new one until it is classified), (d) land a navTap on the live element and nowhere else, and (e) derive the offset from
// navBarMetrics. Everything runs the REAL committed scripts in a jsdom window (the real index.html bar markup, ui.js sheets,
// host-adapter.js behind a fake host, common.js), LESSONS 2: drive the real path, never a hand-typed one.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { installFakeHost } = require('../helpers/fake-host');

const REPO = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');
const INDEX = read('public/index.html');
const NAV_HTML = INDEX.slice(INDEX.indexOf('<nav class="bottom-nav"'), INDEX.indexOf('</nav>', INDEX.indexOf('<nav class="bottom-nav"')) + 6);
const SCRIPTS = ['public/js/icons.js', 'public/js/glyph-pool.js', 'public/js/body-scroll-lock.js', 'public/js/ui.js', 'public/js/interaction.js', 'public/js/common.js'].map(read);
const ALL_CAPS = ['orientation', 'haptics', 'battery', 'serverSettings', 'statusBar', 'network', 'downloads', 'mediaFetch', 'nativeAudio', 'nativeVideoAudio', 'nativeVideo', 'nativeVideoDock', 'nativeVideoPip'];

// One page: opts.caps = the host's announced capabilities (null = no host at all, a browser), theme, phone, landscape, config.
function realm(opts = {}) {
  const theme = opts.theme || '2021';
  const dom = new JSDOM(`<!doctype html><html data-theme="${theme}" data-mode="light"><head><meta name="ft-version" content="1.405.0"></head><body>`
    + '<div id="view-root"><input id="field" type="text"><input id="box" type="checkbox"></div>' + NAV_HTML + '</body></html>',
  { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
  const w = dom.window;
  const media = { phone: opts.phone !== false, landscape: !!opts.landscape };
  w.matchMedia = (q) => ({ matches: q === '(max-width: 768px)' ? media.phone : q === '(orientation: landscape)' ? media.landscape : false,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  w.fetch = () => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
  if (opts.config) w.localStorage.setItem('ft-bottomnav', JSON.stringify(opts.config));
  const fake = opts.caps === null ? null : installFakeHost(w, { capabilities: opts.caps || ALL_CAPS.concat(['nativeTabBar']) });
  w.eval(read('public/js/host-adapter.js'));
  w.eval(SCRIPTS.join('\n;\n'));
  const $ = (s) => w.document.querySelector(s);
  const nav = () => w.document.getElementById('bottom-nav');
  const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 10)); }; // past a frame (ui.js opens on rAF)
  const bars = () => (fake ? fake.of('nav.bar') : []);
  const last = () => bars()[bars().length - 1];
  const visibleIds = () => Array.prototype.filter.call(nav().querySelectorAll('.bottom-nav-item[data-nav]'), (el) => !el.hidden).map((el) => el.getAttribute('data-nav'));
  const boot = async () => { w.applyBottomNavCustomization(); w.applyNavHighlight('/', ''); w.initNativeTabBar(); await settle(); };
  const emit = (detail) => fake.emit(Object.assign({ v: 1 }, detail));
  return { w, dom, fake, $, nav, settle, bars, last, visibleIds, boot, emit, media, close: () => w.close() };
}

// ---- the census: every position:fixed family above --z-nav, from the stylesheets, classified ------------------------------------

const cssOf = (f) => read('public/css/' + f).replace(/\/\*[\s\S]*?\*\//g, '');
function zTokens() { const out = {}; for (const m of cssOf('tokens.css').matchAll(/(--z-[\w-]+):\s*(\d+)\s*;/g)) if (!(m[1] in out)) out[m[1]] = +m[2]; return out; }
function resolveZ(v, tok) {
  v = v.trim();
  let m = /^var\((--z-[\w-]+)\)$/.exec(v); if (m) return tok[m[1]];
  m = /^calc\(\s*var\((--z-[\w-]+)\)\s*([+-])\s*(\d+)\s*\)$/.exec(v); if (m) return m[2] === '+' ? tok[m[1]] + +m[3] : tok[m[1]] - +m[3];
  m = /^(\d+)$/.exec(v); if (m) return +m[1];
  return null;
}
function fixedFamiliesAbove(z) {
  const tok = zTokens(); const out = [];
  for (const file of ['style.css', 'ui.css']) {
    const re = /([^{}]+)\{([^{}]*)\}/g; let m; const text = cssOf(file);
    while ((m = re.exec(text))) {
      if (!/position\s*:\s*fixed\b/.test(m[2])) continue;
      const zm = /z-index\s*:\s*([^;]+);/.exec(m[2]);
      const zv = zm ? resolveZ(zm[1], tok) : null;
      const selector = m[1].trim().split('\n').pop().trim();
      if (zv === null || zv > z) out.push({ selector, z: zv });
    }
  }
  return out.sort((a, b) => a.selector.localeCompare(b.selector));
}
// covers:<name> = nativeTabBarVisible() must see it (the name is its NATIVE_TAB_BAR_COVERS entry, bound per surface below);
// clear = it never meets the bar (it sits above the bar's top, at the top of the screen, or is the pill's own tip);
// under = no z-index: painted in the root layer, UNDER the web bar today, so a native pill over it is what the web bar does now.
const FAMILIES = {
  'header': 'clear',
  '.select-bar': 'clear', // phone: bottom = --mobile-bottom-nav-h + gap
  '#player-dock': 'clear',
  '#handoff-card': 'clear',
  '#remote-pill': 'clear',
  '#dl-status-chip': 'clear',
  '.ui-toast-host': 'clear',
  '.bottom-nav-tip': 'clear',
  '#player-wrapper.css-fullscreen': 'covers:faux-fullscreen',
  '#player-wrapper.audio-mode.audio-expanded': 'covers:audio-expanded',
  '.speed-sheet-backdrop': 'covers:speed-sheet',
  '.whcal-overlay': 'covers:watch-calendar',
  '.reader-nowplaying': 'covers:reader-nowplaying',
  ':where(html.is-phone, html.mms-popout) .mms-full': 'covers:music-skin',
  '.ui-scrim': 'covers:sheet',
  '.ui-sheet': 'covers:sheet',
  ':where(html.is-phone, html.mms-popout) body.mms-tray .music-nowplaying-panel': 'under',
  ':where(html.is-phone, html.mms-popout) .ipm-kb': 'under',
};

test('census: every position:fixed family above --z-nav is classified; every "covers" family is in the ONE predicate\'s list', () => {
  const r = realm();
  try {
    const found = fixedFamiliesAbove(zTokens()['--z-nav']).map((f) => f.selector);
    assert.deepEqual(found.slice().sort(), Object.keys(FAMILIES).sort(), 'a new fixed family above the bar must be classified here (and, if it covers the bar, added to NATIVE_TAB_BAR_COVERS)');
    const covers = require('../../public/js/common.js').NATIVE_TAB_BAR_COVERS.map((e) => e[0]);
    for (const [sel, disp] of Object.entries(FAMILIES)) {
      if (!disp.startsWith('covers:')) continue;
      assert.ok(covers.includes(disp.slice(7)), `${sel}: its predicate entry "${disp.slice(7)}" exists`);
    }
  } finally { r.close(); }
});

// ---- (a) capability off: never a nav.bar, the web pill shows ----------------------------------------------------------------------

test('cap off (an app build without nativeTabBar, and no host at all): no nav.bar ever, no listener, the web pill shows', async () => {
  for (const caps of [ALL_CAPS, null]) {
    const r = realm({ caps });
    try {
      await r.boot();
      r.w.localStorage.setItem('ft-bottomnav', JSON.stringify({ shown: ['music'] }));
      r.w.applyBottomNavCustomization();
      r.w.applyNavHighlight('/history', '');
      r.w.document.body.classList.add('ft-css-fullscreen');
      if (r.fake) { r.emit({ type: 'navBarMetrics', height: 70 }); r.emit({ type: 'navTap', id: 'history' }); } // a host may still speak: nobody listens
      await r.settle();
      assert.equal(r.w.document.documentElement.style.getPropertyValue('--native-tab-bar-h'), '', 'no metrics listener without the capability');
      if (r.fake) assert.deepEqual(r.fake.types().filter((t) => t !== 'host.hello'), [], 'nothing but the hello leaves the page');
      assert.equal(r.nav().hidden, false, 'the web pill stays');
      assert.equal(r.w.document.documentElement.hasAttribute('data-native-tab-bar'), false);
      assert.equal(r.w.nativeTabBarDrawing(), false);
    } finally { r.close(); }
  }
});

// ---- (b) the payload is the web bar, on every trigger ---------------------------------------------------------------------------

test('cap on: the first nav.bar is the web bar\'s visible items in order, with their accessible names and the lit item; the web pill hides', async () => {
  const r = realm();
  try {
    await r.boot();
    assert.equal(r.bars().length, 1, 'one message after the announce');
    const m = r.last();
    assert.deepEqual(m.items.map((i) => i.id), r.visibleIds());
    assert.deepEqual(m.items.map((i) => i.id), r.w.resolveBottomNavLayout(Array.prototype.map.call(r.nav().querySelectorAll('[data-nav]'), (e) => e.getAttribute('data-nav')), r.w.readBottomNavConfig()).visible, 'the resolver\'s visible order');
    assert.deepEqual(m.items.find((i) => i.id === 'home'), { id: 'home', label: 'Home', active: true });
    assert.equal(m.items.filter((i) => i.active).length, 1);
    assert.equal(m.visible, true);
    assert.equal(m.v, 1);
    assert.equal(r.nav().hidden, true, 'the web pill is [hidden] while native draws');
    assert.ok(r.nav().querySelector('[data-nav="home"]'), '...but stays in the DOM (the item source and the navTap target)');
  } finally { r.close(); }
});

test('cap on: every customization and every navigation re-sends; an identical result is never re-sent', async () => {
  const r = realm();
  try {
    await r.boot();
    r.w.applyBottomNavCustomization(); r.w.applyNavHighlight('/', ''); await r.settle();
    assert.equal(r.bars().length, 1, 'an identical apply + highlight sends nothing');
    r.w.localStorage.setItem('ft-bottomnav', JSON.stringify({ shown: ['music', 'books'], order: ['music', 'home', 'books', 'feed', 'playlists', 'history', 'settings'] }));
    r.w.applyBottomNavCustomization(); await r.settle();
    assert.equal(r.bars().length, 2);
    assert.deepEqual(r.last().items.map((i) => i.id), r.visibleIds(), 'the reorder + opt-in, as the web bar now shows it');
    assert.equal(r.last().items[0].id, 'music');
    r.w.applyNavHighlight('/music', ''); await r.settle();
    assert.equal(r.bars().length, 3);
    assert.deepEqual(r.last().items.filter((i) => i.active).map((i) => i.id), ['music'], 'the selection follows the navigation');
    r.w.localStorage.setItem('ft-bottomnav', JSON.stringify({ hidden: ['history'] }));
    r.w.applyBottomNavCustomization(); await r.settle();
    assert.ok(!r.last().items.some((i) => i.id === 'history'), 'a hidden item leaves the native pill too');
  } finally { r.close(); }
});

test('cap on: the async injectors\' race (both insert afterend on Settings) still yields the resolver\'s order, and they reach the pill', async () => {
  const r = realm({ config: { shown: ['settings'] } });
  try {
    await r.boot();
    const settings = r.$('#bottom-nav [data-nav="settings"]');
    for (const [id, label] of [['subscriptions', 'Subs'], ['oneoff-download', 'Download']]) { // Download resolves LAST, so lands FIRST
      const el = r.w.bottomNavItemEl({ href: '/x', nav: id, icon: 'download', label, doc: r.w.document });
      settings.insertAdjacentElement('afterend', el);
      r.w.applyBottomNavCustomization();
    }
    await r.settle();
    const ids = r.last().items.map((i) => i.id);
    assert.deepEqual(ids, r.visibleIds());
    assert.ok(ids.indexOf('oneoff-download') < ids.indexOf('subscriptions'), 'roster order, never the race\'s DOM order');
  } finally { r.close(); }
});

test('cap on: the You avatar sends its photo path as imageUrl; a photo off-origin is left out (the message still goes)', async () => {
  const r = realm();
  try {
    await r.boot();
    const you = r.w.bottomNavItemEl({ tag: 'button', nav: 'you', slotEl: r.w.document.createElement('span'), label: 'You', ariaLabel: 'You (account menu)', doc: r.w.document });
    const img = r.w.document.createElement('img'); img.className = 'ui-avatar__img'; img.setAttribute('src', '/api/users/u1/avatar?v=3');
    you.querySelector('.ui-btn__icon').appendChild(img);
    r.nav().appendChild(you);
    r.w.applyBottomNavCustomization(); await r.settle();
    assert.deepEqual(r.last().items.find((i) => i.id === 'you'), { id: 'you', label: 'You (account menu)', active: false, imageUrl: '/api/users/u1/avatar?v=3' });
    img.setAttribute('src', 'https://evil.example/a.png'); await r.settle();
    const y = r.last().items.find((i) => i.id === 'you');
    assert.equal(y.imageUrl, undefined, 'an off-origin photo is never sent');
    assert.equal(r.nav().hidden, true, 'and the message itself still went (the pill did not fall back to the web)');
  } finally { r.close(); }
});

test('cap on: an item with no name at all still goes, labelled by its id (a label is required: an empty one would refuse the message)', async () => {
  const r = realm();
  try {
    await r.boot();
    const el = r.w.bottomNavItemEl({ href: '/x', nav: 'pages', icon: 'download', label: '', doc: r.w.document });
    r.nav().querySelector('[data-nav="pages"]').remove();
    r.nav().appendChild(el);
    r.w.localStorage.setItem('ft-bottomnav', JSON.stringify({ shown: ['pages'] }));
    r.w.applyBottomNavCustomization(); await r.settle();
    assert.deepEqual(r.last().items.find((i) => i.id === 'pages'), { id: 'pages', label: 'pages', active: false });
    assert.equal(r.nav().hidden, true);
  } finally { r.close(); }
});

test('cap on: a payload the adapter refuses never hides the web pill', async () => {
  const r = realm();
  try {
    await r.boot();
    const bad = r.w.bottomNavItemEl({ href: '/x', nav: 'x'.repeat(65), icon: 'download', label: 'Too long', doc: r.w.document }); // id > 64: refused
    r.nav().appendChild(bad); r.w.applyBottomNavCustomization(); await r.settle();
    assert.equal(r.bars().length, 1, 'the refused message never left the page');
    assert.equal(r.nav().hidden, false, 'so the web pill is back');
  } finally { r.close(); }
});

test('cap on: a page restored from the back-forward cache re-sends its current nav.bar (native released it on the commit)', async () => {
  const r = realm();
  try {
    await r.boot();
    const ev = new r.w.Event('pageshow'); Object.defineProperty(ev, 'persisted', { value: true });
    r.w.dispatchEvent(ev); await r.settle();
    assert.equal(r.bars().length, 2);
    assert.deepEqual(r.bars()[1], r.bars()[0]);
  } finally { r.close(); }
});

// ---- (c) the ONE visibility predicate, per covering surface -----------------------------------------------------------------------

const SURFACES = [
  ['sheet (a ui.js bottom sheet: Playlists, the account menu)', (r) => { const s = r.w.ui.sheet({ variant: 'bottom', title: 'T', doc: r.w.document }); s.open(); return () => { s.close(); }; }, 'sheet'],
  ['dialog (a ui.js confirm)', (r) => { const s = r.w.ui.sheet({ variant: 'dialog', title: 'T', doc: r.w.document }); s.open(); return () => { s.close(); }; }, 'sheet'],
  ['faux fullscreen', (r) => { r.w.document.body.classList.add('ft-css-fullscreen'); return () => r.w.document.body.classList.remove('ft-css-fullscreen'); }, 'faux-fullscreen'],
  ['faux fullscreen (the wrapper\'s class)', (r) => { const p = r.w.document.createElement('div'); p.id = 'player-wrapper'; r.$('#view-root').appendChild(p); p.className = 'css-fullscreen'; return () => { p.className = ''; }; }, 'faux-fullscreen'],
  ['the expanded audio player', (r) => { const p = r.w.document.createElement('div'); p.id = 'player-wrapper'; p.className = 'audio-mode'; r.$('#view-root').appendChild(p); return { later: () => p.classList.add('audio-expanded'), undo: () => p.classList.remove('audio-expanded') }; }, 'audio-expanded'],
  ['the speed sheet', (r) => { const b = r.w.document.createElement('div'); b.className = 'speed-sheet-backdrop'; r.w.document.body.appendChild(b); return () => b.remove(); }, 'speed-sheet'],
  ['the watch-history calendar', (r) => { const o = r.w.document.createElement('div'); o.className = 'whcal-overlay'; r.w.document.body.appendChild(o); return () => o.remove(); }, 'watch-calendar'],
  ['the reader\'s now-playing bar', (r) => { const n = r.w.document.createElement('div'); n.id = 'reader-nowplaying'; n.className = 'reader-nowplaying'; n.hidden = true; r.$('#view-root').appendChild(n); return { later: () => { n.hidden = false; }, undo: () => { n.hidden = true; } }; }, 'reader-nowplaying'],
  ['the phone music skin', (r) => {
    const st = r.w.document.createElement('style'); st.textContent = '.mms-full { position: fixed; }'; r.w.document.head.appendChild(st); // style.css's html.is-phone rule
    const p = r.w.document.createElement('div'); p.className = 'music-nowplaying-panel mms mms-full'; p.hidden = true; r.$('#view-root').appendChild(p);
    return { later: () => { p.hidden = false; }, undo: () => { p.hidden = true; } };
  }, 'music-skin'],
  ['native fullscreen', (r) => { Object.defineProperty(r.w.document, 'fullscreenElement', { configurable: true, get: () => r.nav() }); r.w.document.dispatchEvent(new r.w.Event('fullscreenchange')); return () => { Object.defineProperty(r.w.document, 'fullscreenElement', { configurable: true, get: () => null }); r.w.document.dispatchEvent(new r.w.Event('fullscreenchange')); }; }, 'fullscreen'],
  ['the keyboard (a focused text field)', (r) => { r.$('#field').focus(); return () => r.$('#field').blur(); }, 'keyboard'],
  ['a retro look', (r) => { r.w.document.documentElement.setAttribute('data-theme', '2005'); return () => r.w.document.documentElement.setAttribute('data-theme', '2021'); }, null],
  ['landscape', (r) => { r.media.landscape = true; r.w.dispatchEvent(new r.w.Event('resize')); return () => { r.media.landscape = false; r.w.dispatchEvent(new r.w.Event('resize')); }; }, null],
  ['above the phone breakpoint', (r) => { r.media.phone = false; r.w.dispatchEvent(new r.w.Event('resize')); return () => { r.media.phone = true; r.w.dispatchEvent(new r.w.Event('resize')); }; }, null],
];
for (const [name, open, coverName] of SURFACES) {
  test(`visible: ${name} -> visible:false at once (the web bar shows, as today), and back to true when it clears`, async () => {
    const r = realm();
    try {
      await r.boot();
      assert.equal(r.last().visible, true);
      let undo = open(r);
      if (undo && typeof undo === 'object') { await r.settle(); undo.later(); undo = undo.undo; }
      await r.settle();
      assert.equal(r.last().visible, false, 'the native pill is told to hide');
      assert.equal(r.nav().hidden, false, 'the web bar is back under the surface, exactly as today');
      if (coverName) assert.equal(r.w.bottomNavCoveredBy(), coverName);
      undo();
      await r.settle(); await r.settle();
      assert.equal(r.last().visible, true, 'cleared: the native pill returns');
      assert.equal(r.nav().hidden, true);
    } finally { r.close(); }
  });
}

test('visible: after an SPA navigation REPLACES #view-root (the router\'s oldRoot.replaceWith), a surface inside the NEW root is still seen', async () => {
  const r = realm();
  try {
    await r.boot();
    const fresh = r.w.document.createElement('div'); fresh.id = 'view-root';
    const bar = r.w.document.createElement('div'); bar.id = 'reader-nowplaying'; bar.className = 'reader-nowplaying'; bar.hidden = true; fresh.appendChild(bar);
    r.$('#view-root').replaceWith(fresh);
    r.w.applyNavHighlight('/books', ''); // the router repaints the bar after the swap
    await r.settle();
    assert.equal(r.last().visible, true);
    bar.hidden = false; await r.settle();
    assert.equal(r.last().visible, false, 'the reader bar in the new root hides the native pill');
    bar.hidden = true; await r.settle();
    assert.equal(r.last().visible, true);
  } finally { r.close(); }
});

test('visible: a focused checkbox raises no keyboard - the pill stays', async () => {
  const r = realm();
  try {
    await r.boot();
    r.$('#box').focus(); await r.settle();
    assert.equal(r.last().visible, true);
    assert.equal(r.w.bottomNavCoveredBy(), null);
  } finally { r.close(); }
});

// ---- (d) navTap ------------------------------------------------------------------------------------------------------------------

test('navTap: lands on the live element exactly as a tap would (a link through its click, Playlists\' button); hostile, unknown, hidden and stale ids do nothing', async () => {
  const r = realm({ config: { shown: ['music'] } });
  try {
    await r.boot();
    const clicks = [];
    r.w.document.addEventListener('click', (e) => { const it = e.target.closest && e.target.closest('[data-nav]'); clicks.push(it ? it.getAttribute('data-nav') : e.target.tagName); e.preventDefault(); }, true);
    r.emit({ type: 'navTap', id: 'history' });
    r.emit({ type: 'navTap', id: 'playlists' });
    assert.deepEqual(clicks, ['history', 'playlists']);
    for (const id of ['nope', '"] , * , [x="', 'podcasts' /* default-hidden: in the DOM, [hidden] */, '']) r.emit({ type: 'navTap', id });
    r.emit({ type: 'navTap', id: 42 });
    r.emit({ type: 'navTap' });
    assert.deepEqual(clicks, ['history', 'playlists'], 'nothing else was clicked, nothing threw');
    // stale: the web already told the pill to hide (a sheet is up) - a tap still in flight is dropped
    r.w.document.body.classList.add('ft-css-fullscreen'); await r.settle();
    r.emit({ type: 'navTap', id: 'history' });
    assert.deepEqual(clicks, ['history', 'playlists']);
  } finally { r.close(); }
});

// ---- (e) navBarMetrics drives the ONE offset ---------------------------------------------------------------------------------

test('navBarMetrics: native\'s height becomes --native-tab-bar-h, and the offset var switches to it only while native draws', async () => {
  const r = realm();
  try {
    await r.boot();
    const root = r.w.document.documentElement;
    assert.equal(root.hasAttribute('data-native-tab-bar'), false, 'no metrics yet: the web pill\'s offset stands');
    r.emit({ type: 'navBarMetrics', height: 62 });
    assert.equal(root.style.getPropertyValue('--native-tab-bar-h'), '62px');
    assert.equal(root.hasAttribute('data-native-tab-bar'), true);
    r.emit({ type: 'navBarMetrics', height: -1 }); r.emit({ type: 'navBarMetrics', height: 'big' }); r.emit({ type: 'navBarMetrics', height: 9999 });
    assert.equal(root.style.getPropertyValue('--native-tab-bar-h'), '62px', 'a bad metric is dropped as data');
    r.w.document.body.classList.add('ft-css-fullscreen'); await r.settle();
    assert.equal(root.hasAttribute('data-native-tab-bar'), false, 'the web bar is back: its own offset again');
    r.w.document.body.classList.remove('ft-css-fullscreen'); await r.settle();
    assert.equal(root.hasAttribute('data-native-tab-bar'), true);
    // the CSS half: one definition per renderer
    const css = read('public/css/style.css').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.match(css, /:root\[data-theme="2021"\]\[data-native-tab-bar\]\s*\{\s*--mobile-bottom-nav-h:\s*calc\(var\(--native-tab-bar-h, calc\(var\(--pill-h\) \+ var\(--pill-gap\)\)\) \+ env\(safe-area-inset-bottom\)\);\s*\}/);
  } finally { r.close(); }
});

test('navBarMetrics: a JS-sized surface (the reader) reserves the offset var while native draws, though the web pill is [hidden]', async () => {
  const r = realm();
  try {
    await r.boot();
    r.w.HTMLElement.prototype.getBoundingClientRect = function () { return { height: this.className === 'bottom-nav-reserve-probe' ? 96 : 0, top: 0, bottom: 0, left: 0, right: 0, width: 0 }; };
    assert.equal(r.nav().hidden, true);
    assert.equal(r.w.bottomNavReservePx(), 96, 'the resolved var, not 0 for a display:none bar');
  } finally { r.close(); }
});

// ---- reachability: the boot runs it on every bar shell ------------------------------------------------------------------------

test('reachability: the page boot starts it right after the static layout (every bar shell runs common.js\'s DOMContentLoaded block)', () => {
  const src = read('public/js/common.js');
  const boot = src.indexOf("document.addEventListener('DOMContentLoaded', () => {");
  const body = src.slice(boot, src.indexOf('\n});', boot));
  assert.match(body, /\n {2}applyBottomNavCustomization\(\);\n {2}bindBottomNavLongPress\(\);[^\n]*\n {2}initNativeTabBar\(\);/);
  for (const f of ['public/index.html', 'public/watch.html', 'public/read.html', 'lib/ytdlp/views/subscriptions.html']) {
    const html = read(f);
    assert.ok(html.indexOf('/js/host-adapter.js') > 0 && html.indexOf('/js/host-adapter.js') < html.indexOf('<script src="/js/common.js'), `${f}: the adapter loads before common.js`);
  }
});

// ---- the adapter's half -----------------------------------------------------------------------------------------------------------

test('adapter: nav.bar needs the capability; an imageUrl that is not a same-origin path refuses the WHOLE message; the events are data', () => {
  const r = realm();
  try {
    const host = r.w.FileTube.host;
    const ok = { items: [{ id: 'you', label: 'You', active: false, imageUrl: '/api/users/u/avatar' }], visible: true };
    assert.equal(host.post('nav.bar', ok), true);
    for (const u of ['//evil.example/a.png', 'https://evil.example/a.png', '/\\evil.example', '/a\tb', 'javascript:alert(1)', '']) {
      assert.equal(host.post('nav.bar', { items: [{ id: 'you', label: 'You', active: false, imageUrl: u }], visible: true }), false, JSON.stringify(u));
    }
    assert.equal(host.post('nav.bar', { items: [], visible: 'yes' }), false);
    assert.equal(host.post('nav.bar', { items: new Array(33).fill({ id: 'a', label: 'A', active: false }), visible: true }), false, 'at most 32 items');
    assert.equal(host.post('nav.bar', { items: [{ id: 'home', label: 'Home', active: true, extra: 'x' }], visible: true }), true);
    assert.deepEqual(r.fake.of('nav.bar').pop().items[0], { id: 'home', label: 'Home', active: true }, 'an unknown field never leaves the page');
  } finally { r.close(); }
  const off = realm({ caps: ALL_CAPS });
  try { assert.equal(off.w.FileTube.host.post('nav.bar', { items: [], visible: false }), false, 'not announced: never sent'); } finally { off.close(); }
});
