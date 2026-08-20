// v1.156 (T3, gate WARNING 1): BEHAVIORAL coverage for the pills->panel
// controller (openPanel/closePanel/wirePanels), which is closure-internal in
// initSubscriptionsView and was previously bound only by static HTML string
// matching. The whole redesign rests on this controller, and "presence not
// binding" is this repo's most-struck class -- a mutant on the `'sub-panel-'`
// id concat or the backdrop guard must go RED here.
//
// The controller is not exported, so this mounts the real subscriptions.html in
// jsdom, stubs the browser globals subscriptions.js reaches for, requires it
// fresh so its self-registration runs against our FileTube stub, captures the
// init, and drives real click/keydown events.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const SUBS_HTML = fs.readFileSync(
  path.join(__dirname, '..', '..', 'lib', 'ytdlp', 'views', 'subscriptions.html'),
  'utf8',
);
const SUBS_PATH = require.resolve('../../lib/ytdlp/client/subscriptions.js');

function mountView() {
  const dom = new JSDOM(SUBS_HTML, { url: 'http://localhost/subscriptions' });
  const { window } = dom;
  const { document } = window;

  // Synchronous stand-ins for the CSS-transition overlay helpers: just toggle
  // the class (openPanel/closePanel only need the class + the hidden flag).
  const openOverlay = (el, cls) => { if (el && el.classList) el.classList.add(cls); };
  const closeOverlayThen = (el, cls, after) => {
    if (el && el.classList) el.classList.remove(cls);
    if (typeof after === 'function') after();
  };
  // Every endpoint the init path hits resolves to a harmless empty shape.
  const fetchStub = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });

  global.window = window;
  global.document = document;
  global.localStorage = window.localStorage;
  global.navigator = window.navigator;
  global.AbortController = window.AbortController;
  global.openOverlay = openOverlay;
  global.closeOverlayThen = closeOverlayThen;
  global.fetch = fetchStub;
  window.openOverlay = openOverlay;
  window.closeOverlayThen = closeOverlayThen;
  window.fetch = fetchStub;

  let captured = null;
  window.FileTube = {
    registerView: (name, handlers) => { if (name === 'subscriptions') captured = handlers; },
    navigate: () => {},
  };

  delete require.cache[SUBS_PATH]; // re-run top-level so registerView fires against our stub
  require(SUBS_PATH);
  assert.ok(captured && typeof captured.init === 'function', 'subscriptions.js must self-register an init');

  const viewRoot = document.getElementById('view-root');
  captured.init(viewRoot);
  return { window, document, viewRoot, handlers: captured };
}

const click = (window, el) => el.dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true }));

test('T3 controller: each pill opens its matching panel; opening another closes the first', () => {
  const { window, document, viewRoot, handlers } = mountView();
  try {
    const add = document.getElementById('sub-panel-add');
    const oneoff = document.getElementById('sub-panel-oneoff');
    const activity = document.getElementById('sub-panel-activity');
    assert.strictEqual(add.hidden, true, 'panels start hidden');
    assert.strictEqual(oneoff.hidden, true);
    assert.strictEqual(activity.hidden, true);

    click(window, viewRoot.querySelector('[data-sub-panel="add"]'));
    assert.strictEqual(add.hidden, false, 'the Add pill opens #sub-panel-add (binds the sub-panel-<key> concat)');

    // switch panels: opening Activity closes Add
    click(window, viewRoot.querySelector('[data-sub-panel="activity"]'));
    assert.strictEqual(add.hidden, true, 'opening another panel closes the first');
    assert.strictEqual(activity.hidden, false);

    click(window, viewRoot.querySelector('[data-sub-panel="oneoff"]'));
    assert.strictEqual(activity.hidden, true);
    assert.strictEqual(oneoff.hidden, false, 'the One-off pill opens #sub-panel-oneoff');
  } finally {
    handlers.destroy();
  }
});

test('T3 controller: a click INSIDE the sheet never closes; the backdrop, the back chevron, and Esc all close', () => {
  const { window, document, viewRoot, handlers } = mountView();
  try {
    const activity = document.getElementById('sub-panel-activity');
    click(window, viewRoot.querySelector('[data-sub-panel="activity"]'));
    assert.strictEqual(activity.hidden, false);

    // a click that lands inside the .sub-sheet (target !== backdrop) must NOT close
    click(window, activity.querySelector('.sub-sheet-body'));
    assert.strictEqual(activity.hidden, false, 'a click inside the sheet must not close the panel (backdrop guard)');

    // a click ON the backdrop itself (target === panel) closes
    click(window, activity);
    assert.strictEqual(activity.hidden, true, 'a click on the backdrop closes the panel');

    // Esc closes an open panel
    click(window, viewRoot.querySelector('[data-sub-panel="add"]'));
    const add = document.getElementById('sub-panel-add');
    assert.strictEqual(add.hidden, false);
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
    assert.strictEqual(add.hidden, true, 'Esc closes the open panel');

    // the back chevron closes
    click(window, viewRoot.querySelector('[data-sub-panel="oneoff"]'));
    const oneoff = document.getElementById('sub-panel-oneoff');
    assert.strictEqual(oneoff.hidden, false);
    click(window, oneoff.querySelector('[data-sub-panel-close]'));
    assert.strictEqual(oneoff.hidden, true, 'the nav-bar back chevron closes the panel');
  } finally {
    handlers.destroy();
  }
});

test('T3 controller: with the reloc-preview modal open, Esc dismisses the MODAL, not the panel underneath (QA layering fix)', () => {
  const { window, document, viewRoot, handlers } = mountView();
  try {
    click(window, viewRoot.querySelector('[data-sub-panel="activity"]'));
    const activity = document.getElementById('sub-panel-activity');
    const reloc = document.getElementById('reloc-preview-backdrop');
    assert.strictEqual(activity.hidden, false);
    // simulate the reloc-preview modal being open over the Activity panel
    reloc.hidden = false;
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
    assert.strictEqual(reloc.hidden, true, 'Esc dismisses the top-most overlay (the reloc modal) first');
    assert.strictEqual(activity.hidden, false, 'the Activity panel stays open underneath');
  } finally {
    handlers.destroy();
  }
});
