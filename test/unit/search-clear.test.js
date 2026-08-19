'use strict';

// [UNIT] v1.150 (Dean) - the search-box clear X (public/js/common.js) and
// the mobile search-toolbar strip's wiring locks. The X's contract: visible
// ONLY while the input carries text, clears the BOX and refocuses on click
// (never navigates), injected once per page between the input and the
// Search button. The fake-DOM shim mirrors library-toolbar.test.js's
// established FakeNode posture (common.js touches document only inside
// function bodies).

const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert');

const { shouldShowSearchClear, injectSearchClearButton } = require('../../public/js/common.js');

// ---- the pure predicate -----------------------------------------------------

test('shouldShowSearchClear: text shows, empty/non-string hides', () => {
  assert.equal(shouldShowSearchClear('grüne soße'), true);
  assert.equal(shouldShowSearchClear(' '), true, 'whitespace still counts - the box is non-empty and clearable');
  assert.equal(shouldShowSearchClear(''), false);
  for (const junk of [null, undefined, 0, {}]) assert.equal(shouldShowSearchClear(junk), false);
});

// ---- a minimal DOM shim -----------------------------------------------------

class FakeEl {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.id = '';
    this.className = '';
    this.children = [];
    this.parentNode = null;
    this.hidden = false;
    this.value = '';
    this._attrs = {};
    this._listeners = {};
    this.focused = false;
  }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  insertBefore(n, ref) {
    const i = ref ? this.children.indexOf(ref) : -1;
    n.parentNode = this;
    if (i === -1) this.children.push(n); else this.children.splice(i, 0, n);
    return n;
  }
  setAttribute(k, v) { this._attrs[k] = String(v); }
  getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; }
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
  fire(type) { (this._listeners[type] || []).forEach((fn) => fn({ target: this })); }
  focus() { this.focused = true; }
}

function shimDoc(registry) {
  global.document = {
    getElementById: (id) => registry[id] || null,
    createElement: (t) => new FakeEl(t),
    createTextNode: (text) => ({ nodeType: 3, textContent: text }),
  };
}

function buildForm(initialValue) {
  const form = new FakeEl('div');
  const input = new FakeEl('input');
  input.value = initialValue;
  const btn = new FakeEl('button');
  btn.id = 'search-btn';
  form.appendChild(input);
  form.appendChild(btn);
  return { form, input, btn };
}

// ---- the injector -----------------------------------------------------------

test('injectSearchClearButton: mounts BEFORE the Search button, hidden on an empty box, visible on a prefilled one', () => {
  shimDoc({});
  const empty = buildForm('');
  const clearEmpty = injectSearchClearButton(empty.input, empty.btn);
  assert.equal(empty.form.children.indexOf(clearEmpty), 1, 'between input and Search');
  assert.equal(clearEmpty.hidden, true);
  assert.equal(clearEmpty.getAttribute('aria-label'), 'Clear search');
  const filled = buildForm('brotkanal');
  const clearFilled = injectSearchClearButton(filled.input, filled.btn);
  assert.equal(clearFilled.hidden, false, 'a prefilled box (search results page) shows the X at injection');
  delete global.document;
});

test('injectSearchClearButton: visibility rides input events - INCLUDING the synthetic one main.js dispatches after a programmatic set', () => {
  shimDoc({});
  const { input, btn } = buildForm('');
  const clear = injectSearchClearButton(input, btn);
  assert.equal(clear.hidden, true);
  input.value = 'kochen mit maria'; // the programmatic set fires nothing...
  assert.equal(clear.hidden, true, '...so the X is stale until the event arrives');
  input.fire('input'); // main.js's synthetic dispatch
  assert.equal(clear.hidden, false);
  input.value = '';
  input.fire('input');
  assert.equal(clear.hidden, true);
  delete global.document;
});

test('injectSearchClearButton: click clears the BOX, hides itself, refocuses the input - and NEVER navigates', () => {
  shimDoc({});
  const { input, btn } = buildForm('sauerteig');
  const clear = injectSearchClearButton(input, btn);
  clear.fire('click');
  assert.equal(input.value, '');
  assert.equal(clear.hidden, true);
  assert.equal(input.focused, true);
  // Never navigates: the handler is bound with no navigate/location access -
  // bound by source lock (no jsdom navigation to observe in this shim).
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'common.js'), 'utf8');
  const body = src.slice(src.indexOf('function injectSearchClearButton'), src.indexOf('function injectSearchClearButton') + 1600);
  assert.doesNotMatch(body, /navigate|location|performGlobalSearch|search-open/, 'the X clears the box only');
  delete global.document;
});

test('injectSearchClearButton: idempotent per page, and no-ops without the form pair', () => {
  const existing = new FakeEl('button');
  shimDoc({ 'search-clear-btn': existing });
  const { input, btn } = buildForm('x');
  assert.equal(injectSearchClearButton(input, btn), existing, 'a second injection returns the live button');
  delete global.document;
  shimDoc({});
  assert.equal(injectSearchClearButton(null, null), null);
  const orphanBtn = new FakeEl('button'); // no parentNode
  assert.equal(injectSearchClearButton(new FakeEl('input'), orphanBtn), null);
  delete global.document;
});

// ---- source + CSS locks for the wave's two halves ---------------------------

test('v1.150 locks: main.js dispatches the synthetic input event after its programmatic set', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'main.js'), 'utf8');
  assert.match(src, /searchInput\.value = searchQuery;[\s\S]{0,400}dispatchEvent\(new Event\('input'\)\)/,
    'the value set and the dispatch travel together');
});

test('v1.150 locks: the mobile strip - both mounts stamp the class, the non-search belt removes toggle AND class', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'main.js'), 'utf8');
  assert.strictEqual((src.match(/classList\.add\('search-scoped-toolbar'\)/g) || []).length, 2, 'both mount sites stamp the strip class');
  assert.match(src, /!searchQuery && sectionActions[\s\S]{0,400}removeChild\(staleScope\)[\s\S]{0,200}classList\.remove\('search-scoped-toolbar'\)/,
    'the belt ACTUALLY removes the stale toggle (gate S1: the old lock was satisfied by the querySelector string alone) and the class');
});

test('v1.150 locks: the CSS carries the strip and the X with their load-bearing declarations', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'style.css'), 'utf8')
    .replace(/\/\*[^]*?\*\//g, ''); // comments stripped once (the 5th-strike discipline)
  // The strip: nowrap + scroll inside the mobile block, scoped to the class.
  assert.match(css, /\.section-actions\.search-scoped-toolbar \{[^}]*flex-wrap: nowrap;[^}]*overflow-x: auto;/);
  assert.match(css, /\.section-actions\.search-scoped-toolbar::-webkit-scrollbar \{ display: none; \}/);
  // Gate W1: the sort menu's clip escape - while the menu is open the strip
  // lifts its overflow on BOTH axes (the popout cannot escape a scroll
  // container's clip otherwise, and both scrollbars are hidden).
  assert.match(css, /\.section-actions\.search-scoped-toolbar:has\(#sort-menu:not\(\[hidden\]\)\) \{[^}]*overflow: visible;/,
    'the open sort menu lifts the strip clip');
  assert.match(css, /\.section-actions\.search-scoped-toolbar > \* \{[^}]*flex: 0 0 auto;[^}]*order: 0;/,
    'the two-row machinery is neutralized inside the strip');
  // The X: a styling source exists, the [hidden] override survives, and the
  // mobile tap bump is the invisible-zone kind.
  assert.match(css, /\.search-clear-btn \{[^}]*background: none;/);
  assert.match(css, /\.search-clear-btn\[hidden\] \{ display: none !important; \}/,
    'the [hidden]-loses-to-author-display lesson');
  assert.match(css, /\.search-clear-btn \{ min-width: var\(--size-touch\); min-height: var\(--size-touch\); \}/);
});
