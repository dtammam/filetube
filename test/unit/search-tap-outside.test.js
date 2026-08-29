'use strict';

// [UNIT] v1.209 (Dean): tapping OUTSIDE the open search - with nothing typed -
// dismisses it (so changing your mind, e.g. tapping the home logo, no longer
// needs a second press of the search button). Boots the REAL
// wireSearchAffordances in jsdom and drives the open + the outside/inside/typed
// pointerdown cases behaviourally.

const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const COMMON = require.resolve('../../public/js/common.js');
let dom;

// The header shape wireSearchAffordances needs: a .header-search host with the
// #search-input, a .header-right for the toggle button, and a home logo OUTSIDE
// the search area (Dean's exact tap target).
const HTML = `<!DOCTYPE html><body>
  <header>
    <a id="home-logo" class="logo" href="/">FileTube</a>
    <div class="header-search"><input id="search-input" type="text" /></div>
    <div class="header-right"></div>
  </header>
  <main id="page">body</main>
</body>`;

function boot() {
  delete global.document; delete global.window; delete global.fetch;
  delete require.cache[COMMON];
  const common = require(COMMON); // boot skipped (no document at require time)
  dom = new JSDOM(HTML, { url: 'http://localhost/' });
  global.window = dom.window;
  global.document = dom.window.document;
  global.fetch = () => Promise.resolve({ ok: true, json: async () => ({ terms: [] }) });
  common.wireSearchAffordances();
  return dom.window.document;
}
afterEach(() => {
  if (dom) { dom.window.close(); dom = null; }
  delete global.window; delete global.document; delete global.fetch;
  delete require.cache[COMMON];
});

const isOpen = (doc) => doc.documentElement.classList.contains('search-open');
const down = (el) => el.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true }));
function open(doc) {
  doc.getElementById('search-toggle-btn').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
}

test('v1.209: a tap OUTSIDE the open+empty search closes it (the home logo tap)', () => {
  const doc = boot();
  open(doc);
  assert.ok(isOpen(doc), 'search opened');
  down(doc.getElementById('home-logo'));
  assert.ok(!isOpen(doc), 'tapping the home logo (outside, empty) dismisses search');
});

test('v1.209: a tap INSIDE the search area does NOT close it', () => {
  const doc = boot();
  open(doc);
  down(doc.getElementById('search-input'));
  assert.ok(isOpen(doc), 'tapping the input keeps it open');
  down(doc.getElementById('search-history-panel'));
  assert.ok(isOpen(doc), 'tapping the history panel keeps it open (still inside the search area)');
});

test('v1.209: a tap outside does NOT discard a TYPED query (stays open)', () => {
  const doc = boot();
  open(doc);
  doc.getElementById('search-input').value = 'jazz';
  down(doc.getElementById('home-logo'));
  assert.ok(isOpen(doc), 'a non-empty box is preserved - only an EMPTY search dismisses on tap-away');
});

test('v1.209 (gate): tapping the TOGGLE button to close ends CLOSED, not reopened', () => {
  // The toggle lives in .header-right (OUTSIDE .header-search), so its own token
  // in the closest-guard is load-bearing: without it, pointerdown would
  // closeSearch, then the toggle's click (now not-open) would REOPEN. Binds the
  // #search-toggle-btn token specifically (the other tokens nest in
  // .header-search and are redundant under this fixture).
  const doc = boot();
  open(doc);
  assert.ok(isOpen(doc), 'opened');
  const toggle = doc.getElementById('search-toggle-btn');
  down(toggle);                                   // pointerdown must NOT close (inside the guard)
  toggle.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); // click toggles closed
  assert.ok(!isOpen(doc), 'the toggle closes it and it STAYS closed (no reopen flicker)');
});

test('v1.209: an outside tap while search is CLOSED is a no-op (no throw, stays closed)', () => {
  const doc = boot();
  assert.ok(!isOpen(doc), 'starts closed');
  down(doc.getElementById('home-logo'));
  assert.ok(!isOpen(doc), 'still closed, no error');
});
