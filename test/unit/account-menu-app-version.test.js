'use strict';

// [UNIT] v1.387.0 (Dean's scope addition, 2026-10-12, via the FileTube Root): inside the iOS app the avatar menu shows the
// app's own version and build under the server version ("iOS app 0.9.0 (12)"), built from the host's announced identity
// (host-adapter.js `app`). The REAL common.js menu: with a host the row is there with that text; without a host, or with a
// malformed identity, no row and the menu's rows are identical to today's. Plus the pure line builder on its own.

const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const COMMON = require.resolve('../../public/js/common.js');
const UI = require.resolve('../../public/js/ui.js');
let dom, savedFetch;

function fresh(host) {
  delete global.document; delete global.window; delete global.sessionStorage;
  delete require.cache[COMMON];
  const common = require(COMMON);
  dom = new JSDOM('<!DOCTYPE html><head><meta name="ft-version" content="1.387.0"></head><header><div class="header-right"></div></header>', { url: 'http://localhost/' });
  global.window = dom.window;
  global.document = dom.window.document;
  global.sessionStorage = dom.window.sessionStorage;
  delete require.cache[UI];
  dom.window.ui = require(UI);
  if (host) dom.window.FileTube = { host };
  savedFetch = global.fetch;
  global.fetch = async (url, init) => {
    const method = (init && init.method) || 'GET';
    if (url === '/api/auth/me' && method === 'GET') return { ok: true, status: 200, json: async () => ({ user: { id: 1, displayName: 'Dean', username: 'dean', role: 'admin', avatar: { present: false, version: 0 } } }) };
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  return common;
}
afterEach(async () => {
  if (global.document && global.document.querySelector('.ui-sheet')) await new Promise((r) => setTimeout(r, 400));
  global.fetch = savedFetch;
  if (dom) { dom.window.close(); dom = null; }
  delete global.window; delete global.document; delete global.sessionStorage;
  delete require.cache[COMMON];
});
const tick = () => new Promise((r) => setTimeout(r, 0));
async function openedMenu(common) {
  common.injectAccountMenu();
  for (let i = 0; i < 6; i++) await tick();
  global.document.querySelector('.account-menu-trigger').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  for (let i = 0; i < 6; i++) await tick();
  return global.document.getElementById('account-menu-sheet') || global.document;
}
const footRows = (root) => [...root.querySelectorAll('.account-menu-version, .account-menu-app-version, .account-menu-disk, .account-menu-trash')].map((r) => r.className.split(' ').filter((c) => c.startsWith('account-menu-')).join(' '));

test('inside the app: the row "iOS app <version> (<build>)" sits right under the server version row', async () => {
  const common = fresh({ present: true, bridge: 1, has: () => false, post: () => false, on: () => () => {}, appLike: () => true, app: { name: 'filetube-ios', version: '0.9.0', build: '12' } });
  const root = await openedMenu(common);
  const row = root.querySelector('.account-menu-app-version');
  assert.ok(row, 'the app row');
  assert.strictEqual(row.textContent.trim(), 'iOS app 0.9.0 (12)');
  assert.strictEqual(row.getAttribute('aria-label'), 'iOS app 0.9.0 (12)');
  const ver = root.querySelector('.account-menu-version');
  assert.ok(ver, 'the server version row (meta ft-version)');
  assert.strictEqual(ver.nextElementSibling, row, 'directly under the server version');
  assert.ok(ver.textContent.includes('1.387.0'));
});

test('a browser (no host) and a host with a malformed identity: no app row, and the footer rows are exactly today\'s', async () => {
  const base = fresh(null);
  const root0 = await openedMenu(base);
  const rows0 = footRows(root0);
  assert.strictEqual(root0.querySelector('.account-menu-app-version'), null);
  assert.ok(rows0.includes('account-menu-version'), 'sanity: the server version row is there');
  for (const app of [null, { name: 'filetube-ios', version: 'nine' }, { version: '0.9.0' }]) {
    const common = fresh({ present: true, bridge: 1, has: () => false, post: () => false, on: () => () => {}, appLike: () => true, app });
    const root = await openedMenu(common);
    assert.strictEqual(root.querySelector('.account-menu-app-version'), null, JSON.stringify(app));
    assert.deepStrictEqual(footRows(root), rows0, 'identical footer rows');
  }
});

test('hostAppVersionLine (pure): the words, the optional build, the "App" label for another host name, null for everything malformed', () => {
  const { hostAppVersionLine } = fresh(null);
  assert.strictEqual(hostAppVersionLine({ present: true, app: { name: 'filetube-ios', version: '0.9.0', build: '12' } }), 'iOS app 0.9.0 (12)');
  assert.strictEqual(hostAppVersionLine({ present: true, app: { name: 'filetube-ios', version: '1.0.0', build: null } }), 'iOS app 1.0.0');
  assert.strictEqual(hostAppVersionLine({ present: true, app: { name: 'other-host', version: '2.0.0', build: '3' } }), 'App 2.0.0 (3)');
  assert.strictEqual(hostAppVersionLine({ present: false, app: { name: 'filetube-ios', version: '0.9.0' } }), null, 'not present');
  assert.strictEqual(hostAppVersionLine({ present: true, app: null }), null);
  assert.strictEqual(hostAppVersionLine({ present: true, app: { name: 'filetube-ios', version: 'v9' } }), null);
  assert.strictEqual(hostAppVersionLine(null), null);
});
