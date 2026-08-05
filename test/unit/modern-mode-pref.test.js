'use strict';

// [UNIT] v1.84 T1 - the Modern-mode pref's real USE, jsdom-bound (not asserted
// as a source pattern - the repo's recurring "a decision is not its use"
// strike). applyModernModePref must set the `data-modern` attribute on <html>,
// write localStorage, reflect the settings checkbox, and mirror ONLY when asked;
// bootModernModePref must reflect a device-chosen value WITHOUT a network seed,
// and seed an UN-chosen device from the user record.

const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const COMMON = require.resolve('../../public/js/common.js');
let dom;

function fresh() {
  delete global.document; delete global.window; delete global.localStorage; delete global.fetch;
  delete require.cache[COMMON];
  const common = require(COMMON); // boot skipped (no document at require)
  dom = new JSDOM('<!DOCTYPE html><html><body><input type="checkbox" id="modern-mode-check"></body></html>', { url: 'http://localhost/' });
  global.window = dom.window;
  global.document = dom.window.document;
  global.localStorage = dom.window.localStorage;
  return common;
}
afterEach(() => {
  if (dom) { dom.window.close(); dom = null; }
  delete global.window; delete global.document; delete global.localStorage; delete global.fetch;
  delete require.cache[COMMON];
});

const attr = () => global.document.documentElement.getAttribute('data-modern');
const check = () => global.document.getElementById('modern-mode-check').checked;

test('applyModernModePref("on"): sets data-modern, localStorage, checkbox; modernModeEnabled reads it', () => {
  const c = fresh();
  c.applyModernModePref('on', {});
  assert.strictEqual(global.localStorage.getItem('ft-modern-mode'), 'on');
  assert.strictEqual(attr(), 'on');
  assert.strictEqual(check(), true);
  assert.strictEqual(c.modernModeEnabled(), true);
});

test('applyModernModePref normalizes any non-"on" value to "off" (garbage never enables)', () => {
  const c = fresh();
  c.applyModernModePref('YES', {}); // case-exact: only literal "on" enables
  assert.strictEqual(global.localStorage.getItem('ft-modern-mode'), 'off');
  assert.strictEqual(attr(), 'off');
  assert.strictEqual(check(), false);
  assert.strictEqual(c.modernModeEnabled(), false);
});

test('applyModernModePref mirrors to /api/me/settings ONLY when opts.mirror', () => {
  const c = fresh();
  let posted = null;
  global.fetch = (url, opts) => { posted = { url, body: JSON.parse(opts.body) }; return Promise.resolve({ ok: true, json: async () => ({}) }); };

  c.applyModernModePref('on', {}); // no mirror
  assert.strictEqual(posted, null, 'a plain apply does not hit the network');

  c.applyModernModePref('off', { mirror: true });
  assert.strictEqual(posted.url, '/api/me/settings');
  assert.deepStrictEqual(posted.body, { modernMode: 'off' }, 'mirrors the exact key/value');
});

test('bootModernModePref: a device that already chose reflects WITHOUT a seed fetch', async () => {
  const c = fresh();
  global.localStorage.setItem('ft-modern-mode', 'on');
  let fetched = false;
  global.fetch = () => { fetched = true; return Promise.resolve({ ok: true, json: async () => ({}) }); };
  await c.bootModernModePref();
  assert.strictEqual(attr(), 'on', 'the chosen value is reflected onto <html> immediately');
  assert.strictEqual(fetched, false, 'a chosen device is never overridden by the server');
});

test('bootModernModePref: an UN-chosen device seeds modernMode from the user record', async () => {
  const c = fresh();
  global.fetch = (url) => Promise.resolve({ ok: true, json: async () => ({ user: {}, settings: { modernMode: 'on' } }) });
  await c.bootModernModePref();
  assert.strictEqual(attr(), 'on');
  assert.strictEqual(global.localStorage.getItem('ft-modern-mode'), 'on', 'seeded into the device cache');
});

test('bootModernModePref: an UN-chosen device with no server value stays off (absent => off)', async () => {
  const c = fresh();
  global.fetch = (url) => Promise.resolve({ ok: true, json: async () => ({ user: {}, settings: {} }) });
  await c.bootModernModePref();
  assert.strictEqual(attr(), 'off');
  assert.strictEqual(global.localStorage.getItem('ft-modern-mode'), null, 'nothing seeded');
});
