'use strict';

// v1.405.0 the glass tab pill (plan docs/exec-plans/active/2026-11-08-glass-tab-pill.md). The look itself is measured by
// scripts/glass-pill-probe.js (R4 item widths, R5 base-vs-branch identity of every other look and desktop); this file binds
// the parts a stylesheet census or a jsdom DOM can hold: the pill is Modern-only and phone-only, the label stays the
// accessible name, the ONE offset var is re-derived from the pill's own tokens, and the lit item is scrolled into view when
// the row overflows (Dean's R4 ruling: "scroll inside the pill").
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const STYLE = fs.readFileSync(path.join(ROOT, 'public', 'css', 'style.css'), 'utf8');
const TOKENS = fs.readFileSync(path.join(ROOT, 'public', 'css', 'tokens.css'), 'utf8');
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

// Every top-level rule of a stylesheet with the @media chain it sits in (a small brace scanner; comments stripped first).
function rules(css) {
  const src = stripComments(css);
  const out = [];
  const stack = [];
  let buf = '';
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') {
      const head = buf.trim();
      buf = '';
      if (head.startsWith('@')) { stack.push(head); continue; }
      const end = src.indexOf('}', i);
      out.push({ at: stack.slice(), selector: head, body: src.slice(i + 1, end) });
      i = end;
    } else if (ch === '}') {
      stack.pop();
      buf = '';
    } else buf += ch;
  }
  return out;
}
const STYLE_RULES = rules(STYLE);
const PHONE = '@media (max-width: 768px)';
const SCROLLBAR_GUARD = '@supports not selector(::-webkit-scrollbar)'; // Firefox's scrollbar-width lives in the ONE engine guard
const PILL = () => STYLE_RULES.find((r) => r.selector === '[data-theme="2021"] .bottom-nav' && r.at.length === 1 && r.at[0] === PHONE);

test('R1: the pill rules are scoped to Modern AND the phone breakpoint, never bare', () => {
  const modern = STYLE_RULES.filter((r) => /\[data-theme="2021"\] \.bottom-nav/.test(r.selector) && r.at[0] !== SCROLLBAR_GUARD);
  assert.ok(modern.length >= 4, 'the pill, its items, the active capsule and the label rule exist');
  for (const r of modern) {
    assert.ok(r.at[0] === PHONE, `${r.selector} sits inside ${PHONE} (got ${JSON.stringify(r.at)})`);
  }
  const pill = PILL();
  assert.match(pill.body, /border-radius:\s*var\(--radius-full\)/);
  assert.match(pill.body, /backdrop-filter:\s*var\(--pill-glass\)/);
  assert.doesNotMatch(pill.body, /(^|[;\s])display\s*:/, 'display is never redeclared, so the landscape and fullscreen hides keep winning');
  const fallback = modern.find((r) => r.at.some((a) => a.startsWith('@supports not')));
  assert.ok(fallback && /background:\s*var\(--pill-ground-solid\)/.test(fallback.body), 'a WebKit without backdrop-filter gets the solid ground');
});

test('R1: the label is visually hidden but stays the accessible name (never display:none / visibility:hidden)', () => {
  const label = STYLE_RULES.find((r) => r.selector === '[data-theme="2021"] .bottom-nav .bottom-nav-label');
  assert.ok(label, 'the Modern label rule exists');
  assert.match(label.body, /clip-path:\s*inset\(50%\)/);
  assert.match(label.body, /position:\s*absolute/);
  assert.doesNotMatch(label.body, /display\s*:\s*none|visibility\s*:\s*hidden|aria-hidden/);
});

test('R4: every item keeps a 44px target and the row scrolls inside the pill instead of shrinking', () => {
  const item = STYLE_RULES.find((r) => r.selector === '[data-theme="2021"] .bottom-nav > .bottom-nav-item');
  assert.match(item.body, /min-width:\s*var\(--hit\)/);
  assert.match(item.body, /flex:\s*1 0 var\(--hit\)/, 'grow to share the space when they fit, never shrink below the target');
  const pill = PILL();
  assert.match(pill.body, /overflow-x:\s*auto/);
  assert.match(pill.body, /justify-content:\s*flex-start/, 'an overflowing space-around centres and strands the first items');
  assert.match(TOKENS, /--hit:\s*44px;/);
});

test('R2: --mobile-bottom-nav-h stays the ONE source; on Modern it is the pill + its gap + the safe area (or native\'s, while the app draws it)', () => {
  const defs = STYLE_RULES.filter((r) => /--mobile-bottom-nav-h\s*:/.test(r.body));
  assert.deepEqual(defs.map((r) => r.selector), [':root', ':root[data-theme="2021"]', ':root[data-theme="2021"][data-native-tab-bar]'],
    'exactly one definition per renderer: the strip, the web pill, the app\'s native pill (W3, native-tab-bar.test.js)');
  assert.match(defs[0].body, /--mobile-bottom-nav-h:\s*calc\(72px \+ env\(safe-area-inset-bottom\)\)/, 'the other looks keep the 72px strip');
  assert.match(defs[1].body, /--mobile-bottom-nav-h:\s*calc\(var\(--pill-h\) \+ var\(--pill-gap\) \+ env\(safe-area-inset-bottom\)\)/);
  const pill = PILL();
  assert.match(pill.body, /height:\s*var\(--pill-h\)/, 'the pill is as tall as the offset says');
  assert.match(pill.body, /bottom:\s*calc\(env\(safe-area-inset-bottom\) \+ var\(--pill-gap\)\)/, 'and floats the gap the offset reserves');
  // No consumer keeps its own copy of the bar's height (the v1.17.0 FR-2 single source).
  const ownCopies = STYLE_RULES.filter((r) => /calc\(72px/.test(r.body) && !/--mobile-bottom-nav-h\s*:/.test(r.body));
  assert.deepEqual(ownCopies.map((r) => r.selector), []);
});

// ---- the lit item scrolls into view (R4) ----------------------------------------------------------------------------

const ITEMS = ['home', 'feed', 'playlists', 'history', 'podcasts', 'music', 'books', 'settings'];
function withPill(fn) {
  const html = '<body><nav class="bottom-nav" id="bottom-nav">'
    + ITEMS.map((id) => `<a href="/${id === 'home' ? '' : id}" class="bottom-nav-item" data-nav="${id}"></a>`).join('') + '</nav></body>';
  const dom = new JSDOM(html, { url: 'http://localhost/' });
  global.document = dom.window.document;
  global.window = dom.window;
  global.localStorage = dom.window.localStorage;
  dom.window.localStorage.setItem('ft-bottomnav', JSON.stringify({ shown: ['podcasts', 'music', 'books', 'settings'] }));
  try { return fn(dom); } finally {
    delete global.document; delete global.window; delete global.localStorage; dom.window.close();
  }
}
// jsdom has no layout: give the nav a 288px viewport over a row of 44px items (the pill at 320px wide), and a real scrollLeft.
function layout(nav, viewW) {
  let sl = 0;
  const items = Array.prototype.slice.call(nav.querySelectorAll('.bottom-nav-item')).filter((el) => !el.hidden);
  items.forEach((el) => {
    Object.defineProperty(el, 'offsetLeft', { configurable: true, get: () => 6 + 44 * Array.prototype.indexOf.call(nav.children, el) });
    Object.defineProperty(el, 'offsetWidth', { configurable: true, get: () => 44 });
  });
  Object.defineProperty(nav, 'clientWidth', { configurable: true, get: () => viewW });
  Object.defineProperty(nav, 'scrollWidth', { configurable: true, get: () => 12 + 44 * items.length });
  Object.defineProperty(nav, 'scrollLeft', { configurable: true, get: () => sl, set: (v) => { sl = v; } });
}

test('R4: a lit item past the pill edge is scrolled into view; one already in view leaves the row alone', () => {
  const common = require('../../public/js/common.js');
  withPill(() => {
    common.applyBottomNavCustomization();
    const nav = global.document.getElementById('bottom-nav');
    layout(nav, 288);
    common.applyNavHighlight('/', '');
    assert.equal(nav.scrollLeft, 0, 'Home is in view: no scroll');
    common.applyNavHighlight('/books', '');
    const books = nav.querySelector('[data-nav="books"]');
    assert.ok(books.classList.contains('active'));
    assert.ok(books.offsetLeft >= nav.scrollLeft && books.offsetLeft + 44 <= nav.scrollLeft + 288, `Books is within the visible row (scrollLeft ${nav.scrollLeft})`);
    common.applyNavHighlight('/', '');
    assert.equal(nav.scrollLeft, 6, 'back to Home: the row scrolls back so Home shows');
  });
});

test('R4: a bar that fits (every other look, the default bar) is never scrolled', () => {
  const common = require('../../public/js/common.js');
  withPill(() => {
    common.applyBottomNavCustomization();
    const nav = global.document.getElementById('bottom-nav');
    layout(nav, 1000);
    nav.scrollLeft = 0;
    common.applyNavHighlight('/books', '');
    assert.equal(nav.scrollLeft, 0);
  });
});

// ---- R3: a long press shows the name (the REAL common.js binder over the REAL FTInteraction engine) ----------------

const FTInteraction = require('../../public/js/interaction.js');
function withTipBar(t, { theme = '2021', phone = true } = {}, fn) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const html = `<html data-theme="${theme}"><body><nav class="bottom-nav" id="bottom-nav">`
    + '<a href="/" class="bottom-nav-item" data-nav="home"><span class="bottom-nav-label">Home</span></a>'
    + '<button type="button" class="bottom-nav-item" data-nav="oneoff-download" aria-label="Download a video"><span class="bottom-nav-label">Download</span></button>'
    + '<a href="/music" class="bottom-nav-item" data-nav="music" hidden><span class="bottom-nav-label">Music</span></a>'
    + '</nav><div id="away">x</div></body></html>';
  const dom = new JSDOM(html, { url: 'http://localhost/' });
  const w = dom.window;
  // the engine and the tip's timers resolve through the jsdom window: route them to the mockable globals
  w.setTimeout = (f, ms) => setTimeout(f, ms);
  w.clearTimeout = (id) => clearTimeout(id);
  w.matchMedia = (q) => ({ matches: q === '(max-width: 768px)' ? phone : false });
  w.FTInteraction = FTInteraction;
  global.document = w.document; global.window = w; global.localStorage = w.localStorage;
  const common = require('../../public/js/common.js');
  const pe = (type, el, o = {}) => el.dispatchEvent(new w.PointerEvent(type, { bubbles: true, cancelable: true, composed: true, pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0, clientX: o.x ?? 20, clientY: o.y ?? 800 }));
  const click = (el) => { const e = new w.MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }); el.dispatchEvent(e); return e; };
  const tip = () => w.document.querySelector('.bottom-nav-tip');
  const $ = (id) => w.document.querySelector(`[data-nav="${id}"]`);
  try { common.bindBottomNavLongPress(); return fn({ w, common, pe, click, tip, $, tick: (ms) => t.mock.timers.tick(ms) }); } finally {
    delete global.document; delete global.window; delete global.localStorage; dom.window.close();
  }
}

test('R3: a 500ms hold on an item shows its name above the pill, and the release does NOT activate the item', (t) => {
  withTipBar(t, {}, ({ pe, click, tip, $, tick, common }) => {
    let activated = 0;
    $('home').addEventListener('click', () => { activated++; });
    pe('pointerdown', $('home'));
    tick(common.BOTTOM_NAV_NAME_MS - 1);
    assert.equal(tip(), null, 'nothing before the hold completes');
    tick(1);
    assert.ok(tip() && !tip().hidden, 'the tip shows at the hold');
    assert.equal(tip().textContent, 'Home');
    assert.equal(tip().getAttribute('role'), 'tooltip');
    pe('pointerup', $('home'));
    const ev = click($('home'));
    assert.equal(activated, 0, 'the click after a fired hold is swallowed - no navigation');
    assert.ok(ev.defaultPrevented, 'a link default (navigation) is prevented too');
    assert.ok(!tip().hidden, 'the tip lingers briefly after the release');
    tick(common.BOTTOM_NAV_TIP_LINGER_MS);
    assert.ok(tip().hidden, 'then hides');
  });
});

test('R3: the name is the accessible name - an aria-label wins over the caption', (t) => {
  withTipBar(t, {}, ({ pe, tip, $, tick, common }) => {
    pe('pointerdown', $('oneoff-download'));
    tick(common.BOTTOM_NAV_NAME_MS);
    assert.equal(tip().textContent, 'Download a video');
  });
});

test('R3: a normal tap is unchanged - it activates, no tip, nothing prevented', (t) => {
  withTipBar(t, {}, ({ pe, click, tip, $, tick }) => {
    let activated = 0;
    $('home').addEventListener('click', () => { activated++; });
    pe('pointerdown', $('home'));
    tick(120);
    pe('pointerup', $('home'));
    const ev = click($('home'));
    assert.equal(activated, 1);
    assert.equal(ev.defaultPrevented, false);
    assert.equal(tip(), null);
  });
});

test('R3: every other look, and desktop width, never arm the hold - a long touch then a release activates as before', (t) => {
  for (const opts of [{ theme: '2005' }, { theme: '2009' }, { theme: '2014' }, { theme: '2021', phone: false }]) {
    withTipBar(t, opts, ({ pe, click, tip, $, tick }) => {
      let activated = 0;
      $('home').addEventListener('click', () => { activated++; });
      pe('pointerdown', $('home'));
      tick(2000);
      pe('pointerup', $('home'));
      click($('home'));
      assert.equal(tip(), null, `${JSON.stringify(opts)}: no tip`);
      assert.equal(activated, 1, `${JSON.stringify(opts)}: the release still activates`);
    });
    t.mock.timers.reset();
  }
});

test('R3 reachability: the page boot binds the tip once per shell (the DOMContentLoaded block every bar shell runs)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public', 'js', 'common.js'), 'utf8');
  const boot = src.indexOf("document.addEventListener('DOMContentLoaded', () => {");
  assert.ok(boot > 0);
  const body = src.slice(boot, src.indexOf('\n});', boot));
  assert.match(body, /\n {2}applyBottomNavCustomization\(\);\n {2}bindBottomNavLongPress\(\);/, 'bound right after the static layout applies');
  // every shell that draws the bar loads the engine BEFORE common.js (no engine = no tip, silently)
  const shells = fs.readdirSync(path.join(ROOT, 'public')).filter((f) => f.endsWith('.html')).map((f) => path.join(ROOT, 'public', f))
    .concat([path.join(ROOT, 'lib', 'ytdlp', 'views', 'subscriptions.html')]);
  const withBar = shells.filter((f) => fs.readFileSync(f, 'utf8').includes('id="bottom-nav"'));
  assert.ok(withBar.length >= 11, `the bar shells (${withBar.length})`);
  for (const f of withBar) {
    const html = fs.readFileSync(f, 'utf8');
    const eng = html.indexOf('/js/interaction.js');
    const main = html.indexOf('<script src="/js/common.js');
    assert.ok(eng > 0 && main > 0 && eng < main, `${path.basename(f)} loads interaction.js before common.js`);
  }
});

// ---- R6: the reader sizes itself against the bar's REAL reserve -----------------------------------------------------

function withReserveBar({ theme, phone = true, display = 'flex' }, fn) {
  const dom = new JSDOM(`<html data-theme="${theme}"><body><nav class="bottom-nav" id="bottom-nav"></nav></body></html>`, { url: 'http://localhost/' });
  const w = dom.window;
  w.matchMedia = (q) => ({ matches: q === '(max-width: 768px)' ? phone : false });
  const nav = w.document.getElementById('bottom-nav');
  Object.defineProperty(nav, 'offsetHeight', { configurable: true, get: () => 52 });
  const realGCS = w.getComputedStyle.bind(w);
  w.getComputedStyle = (el) => (el === nav ? { display } : realGCS(el));
  // jsdom has no layout: the probe element answers the resolved var the way style.css's .bottom-nav-reserve-probe would
  const seen = [];
  w.HTMLElement.prototype.getBoundingClientRect = function () {
    seen.push(this.className);
    return { height: this.className === 'bottom-nav-reserve-probe' ? 98 : 0, top: 0, bottom: 0, left: 0, right: 0, width: 0 };
  };
  global.document = w.document; global.window = w;
  try { return fn(require('../../public/js/common.js'), seen, w); } finally { delete global.document; delete global.window; dom.window.close(); }
}

test('R6: bottomNavReservePx - the strip height on every other look, the ONE var on the pill, 0 when the bar is not drawn', () => {
  for (const theme of ['2005', '2009', '2014']) {
    withReserveBar({ theme }, (c, seen) => { assert.equal(c.bottomNavReservePx(), 52, theme + ': the strip height, as read.js measured it before'); assert.deepEqual(seen, []); });
  }
  withReserveBar({ theme: '2021', phone: false }, (c) => assert.equal(c.bottomNavReservePx(), 52, 'Modern above the phone breakpoint is not the pill'));
  withReserveBar({ theme: '2021' }, (c, seen, w) => {
    assert.equal(c.bottomNavReservePx(), 98, 'the pill: the resolved --mobile-bottom-nav-h (pill + gap + safe area), never its own 56px');
    assert.deepEqual(seen, ['bottom-nav-reserve-probe']);
    assert.equal(w.document.querySelector('.bottom-nav-reserve-probe'), null, 'the probe element is removed again');
  });
  withReserveBar({ theme: '2021', display: 'none' }, (c) => assert.equal(c.bottomNavReservePx(), 0, 'landscape: the pill is display:none'));
  withReserveBar({ theme: '2005', display: 'none' }, (c) => assert.equal(c.bottomNavReservePx(), 0));
  const css = STYLE_RULES.find((r) => r.selector === '.bottom-nav-reserve-probe');
  assert.match(css.body, /height:\s*var\(--mobile-bottom-nav-h, 0px\)/, 'the probe resolves the ONE var');
});

test('R6 reachability: read.js sizes the reader with bottomNavReservePx, and the shell exposes it', () => {
  const read = fs.readFileSync(path.join(ROOT, 'public', 'js', 'read.js'), 'utf8');
  const fnStart = read.indexOf('function sizeReader()');
  const body = read.slice(fnStart, read.indexOf('\n    }', fnStart));
  assert.match(body, /const navH = ft && typeof ft\.bottomNavReservePx === 'function' \? ft\.bottomNavReservePx\(\) : 0;/);
  assert.doesNotMatch(body, /bottomNav\.offsetHeight|getElementById\('bottom-nav'\)/, 'no private copy of the bar height left in the reader');
  const common = fs.readFileSync(path.join(ROOT, 'public', 'js', 'common.js'), 'utf8');
  assert.match(common, /window\.FileTube\.bottomNavReservePx = bottomNavReservePx;/);
});
