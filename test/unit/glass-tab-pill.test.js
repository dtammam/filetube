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

test('R2: --mobile-bottom-nav-h stays the ONE source; on Modern it is the pill + its gap + the safe area', () => {
  const defs = STYLE_RULES.filter((r) => /--mobile-bottom-nav-h\s*:/.test(r.body));
  assert.deepEqual(defs.map((r) => r.selector), [':root', ':root[data-theme="2021"]'], 'exactly two definitions: the strip and the pill');
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
