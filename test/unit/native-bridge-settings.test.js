'use strict';

// [UNIT] v1.384.0 (native bridge D9 + D10), through the REAL setup.js / common.js / pocket-lighting.js with the REAL adapter and a FAKE host.
// D9: "Server address" (Settings > Account) exists only inside the app (the host announces serverSettings); its tap posts
//     host.openServerSettings; setup.html itself has no trace of it, so the settings census (static controls) is untouched.
// D10: the standalone checks that serve the INSTALLED-app surface also answer yes inside the app (appLike()); every browser result is the same.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { installFakeHost, loadAdapter } = require('../helpers/fake-host');
const { census } = require('../../scripts/settings-census.js');

const SETUP_HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'setup.html'), 'utf8');
const setup = require('../../public/js/setup.js');
const lighting = require('../../public/js/pocket-lighting.js');

function page(host) {
  const dom = new JSDOM(SETUP_HTML.replace(/<script[\s\S]*?<\/script>/g, ''), { url: 'http://localhost/setup.html', runScripts: 'outside-only' });
  const fake = host ? installFakeHost(dom.window, host) : null;
  loadAdapter(dom.window);
  return { w: dom.window, fake };
}

test('D9: inside the app the Account page gets one "Server address" row whose button posts host.openServerSettings', () => {
  const { w, fake } = page({});
  fake.clear();
  setup.wireServerAddressRow(w);
  const group = w.document.getElementById('server-address-group');
  assert.ok(group, 'the row exists');
  assert.ok(w.document.getElementById('account-box').contains(group), 'on the Account page');
  assert.strictEqual(group.querySelector('.ui-row__title').textContent, 'Server address');
  const btn = group.querySelector('#server-address-btn');
  btn.click();
  assert.deepStrictEqual(fake.posts, [{ v: 1, type: 'host.openServerSettings' }]);
  setup.wireServerAddressRow(w); // a second wire never doubles the row
  assert.strictEqual(w.document.querySelectorAll('#server-address-group').length, 1);
  w.close();
});

test('D9: no row in a browser, and none in a host that did not announce serverSettings', () => {
  for (const host of [null, { capabilities: ['haptics', 'battery', 'orientation'] }]) {
    const { w, fake } = page(host);
    const before = w.document.documentElement.outerHTML;
    setup.wireServerAddressRow(w);
    assert.strictEqual(w.document.getElementById('server-address-group'), null);
    assert.strictEqual(w.document.documentElement.outerHTML, before, 'the page is byte-identical');
    if (fake) assert.deepStrictEqual(fake.of('host.openServerSettings'), []);
    w.close();
  }
});

test('D9: setup.html has no static trace of the row, so the settings census (static controls) neither sees nor needs it', () => {
  assert.ok(!/server-address/i.test(SETUP_HTML));
  assert.ok(!census(SETUP_HTML).pages.flatMap((p) => p.controls).some((c) => /server-address/.test(c.id)));
  assert.deepStrictEqual(census(SETUP_HTML).problems, []);
});

// ---- D10
function envWin(opts) {
  const dom = new JSDOM('<body></body>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const w = dom.window;
  if (opts.standalone) Object.defineProperty(w.navigator, 'standalone', { value: true, configurable: true });
  w.matchMedia = (q) => ({ matches: !!opts.mq && /display-mode: standalone/.test(q), media: q, addEventListener() {}, removeEventListener() {} });
  if (opts.host) installFakeHost(w, opts.host);
  if (opts.adapter !== false) loadAdapter(w);
  return w;
}

test('D10 common.js: the last-session logic treats the app as installed (appLike); a browser tab and a PWA answer as they did', () => {
  const cases = [
    { name: 'browser tab', o: {}, want: false },
    { name: 'PWA (navigator.standalone)', o: { standalone: true }, want: true },
    { name: 'PWA (display-mode)', o: { mq: true }, want: true },
    { name: 'native host', o: { host: {} }, want: true },
    { name: 'no adapter at all, browser tab', o: { adapter: false }, want: false },
    { name: 'no adapter at all, PWA', o: { adapter: false, standalone: true }, want: true },
  ];
  for (const c of cases) {
    const w = envWin(c.o);
    const saved = global.window; global.window = w;
    try {
      // isStandaloneDisplay is a plain function declaration in common.js: evaluate the SOURCE of the real function in this window
      const src = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'common.js'), 'utf8');
      const m = /function isStandaloneDisplay\(\) \{[\s\S]*?\n\}\n/.exec(src);
      assert.ok(m, 'found the real function');
      const fn = new w.Function(m[0] + '; return isStandaloneDisplay();');
      assert.strictEqual(fn.call(w), c.want, c.name);
    } finally { global.window = saved; w.close(); }
  }
});

test('D10 pocket-lighting.js: the turn-inset window opens in the app (phone class) as in the home-screen app, and not in a browser tab', () => {
  for (const [name, o, want] of [['tab', {}, false], ['PWA', { standalone: true }, true], ['app', { host: {} }, true]]) {
    const dom = new JSDOM('<html class="is-phone"><body></body></html>', { url: 'http://localhost/music', pretendToBeVisual: true, runScripts: 'outside-only' });
    const w = dom.window;
    if (o.standalone) Object.defineProperty(w.navigator, 'standalone', { value: true, configurable: true });
    w.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
    if (o.host) installFakeHost(w, o.host);
    loadAdapter(w);
    Object.defineProperty(w, 'screen', { value: { width: 393, height: 852, orientation: new w.EventTarget() }, configurable: true });
    Object.defineProperty(w, 'innerHeight', { get: () => 852, configurable: true });
    Object.defineProperty(w, 'innerWidth', { get: () => 393, configurable: true });
    w.getComputedStyle = () => ({ paddingTop: '59px' });
    w.requestAnimationFrame = () => 1; w.cancelAnimationFrame = () => {};
    w.setTimeout = () => 1; w.clearTimeout = () => {};
    const h = lighting.installTurnInset(w, {});
    w.dispatchEvent(new w.Event('orientationchange'));
    assert.strictEqual(h.isOpen(), want, name);
    h.destroy();
    w.close();
  }
});
