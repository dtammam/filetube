'use strict';

// [UNIT] v1.85 #2 - the "You" bottom-nav tab (common.js injectYouNavItem),
// jsdom-bound. It builds a data-nav="you" item carrying the avatar + "You"
// label and, on click, opens the SAME account menu by dispatching a click on the
// header .account-menu-trigger (works even when that trigger is display:none on
// mobile). No-op on a signed-out shell; idempotent.

const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const COMMON = require.resolve('../../public/js/common.js');
let dom;

function fresh(bodyHtml) {
  delete global.document; delete global.window; delete global.fetch;
  delete require.cache[COMMON];
  const common = require(COMMON); // boot skipped
  dom = new JSDOM(`<!DOCTYPE html><body>${bodyHtml || ''}</body>`, { url: 'http://localhost/' });
  global.window = dom.window;
  global.document = dom.window.document;
  return common;
}
afterEach(() => {
  if (dom) { dom.window.close(); dom = null; }
  delete global.window; delete global.document; delete global.fetch;
  delete require.cache[COMMON];
});
const tick = () => new Promise((r) => setTimeout(r, 0));

const SHELL = '<nav id="bottom-nav"><a class="bottom-nav-item" data-nav="home"><span class="bottom-nav-label">Home</span></a></nav>'
  + '<div class="header-right"><button class="account-menu-trigger">avatar</button></div>';

test('signed-in: injects a right-most "You" tab with an avatar + label', async () => {
  const c = fresh(SHELL);
  global.fetch = () => Promise.resolve({ ok: true, json: async () => ({ user: { id: 1, username: 'dean', avatar: { present: false } } }) });
  c.injectYouNavItem();
  await tick();
  const you = global.document.querySelector('#bottom-nav [data-nav="you"]');
  assert.ok(you, 'the You tab was injected');
  assert.strictEqual(you.querySelector('.bottom-nav-label').textContent, 'You');
  assert.ok(you.querySelector('.account-avatar.bottom-nav-you-avatar'), 'carries the account avatar');
  // right-most: last child of the nav
  assert.strictEqual(global.document.querySelector('#bottom-nav').lastElementChild, you, 'the You tab is right-most');
});

test('clicking "You" opens the REAL account menu and it STAYS open (v1.85.1 bubble fix)', async () => {
  // Shell with an EMPTY .header-right (injectAccountMenu builds the real menu +
  // its document-close-on-outside-click handler) + the bottom nav.
  const c = fresh('<nav id="bottom-nav"></nav><div class="header-right"></div>');
  global.fetch = () => Promise.resolve({ ok: true, json: async () => ({ user: { id: 1, username: 'dean', displayName: 'Dean', role: 'member', avatar: { present: false } } }) });
  c.injectAccountMenu();
  c.injectYouNavItem();
  await tick();
  const dropdown = global.document.querySelector('.account-menu-dropdown');
  assert.ok(dropdown, 'the real account menu was built');
  assert.strictEqual(dropdown.hidden, true, 'starts closed');

  // Tap "You". Without stopPropagation the click bubbles to document, whose
  // close-handler fires right after trigger.click() opens it -> menu closes
  // (the device-pass "tab does nothing" failure). With the fix it stays open.
  global.document.querySelector('[data-nav="you"]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.strictEqual(dropdown.hidden, false, 'the account menu opened AND stayed open (did not open-then-close)');
});

test('signed-out shell: no "You" tab (fetch not ok / no user)', async () => {
  const c = fresh(SHELL);
  global.fetch = () => Promise.resolve({ ok: false, json: async () => ({}) });
  c.injectYouNavItem();
  await tick();
  assert.strictEqual(global.document.querySelector('[data-nav="you"]'), null, 'no account -> no You tab');
});

test('idempotent: two calls inject exactly one "You" tab', async () => {
  const c = fresh(SHELL);
  global.fetch = () => Promise.resolve({ ok: true, json: async () => ({ user: { id: 1, username: 'dean', avatar: { present: false } } }) });
  c.injectYouNavItem();
  c.injectYouNavItem();
  await tick();
  assert.strictEqual(global.document.querySelectorAll('[data-nav="you"]').length, 1);
});
