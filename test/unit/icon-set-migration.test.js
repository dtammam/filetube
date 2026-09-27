'use strict';

// [UNIT] UI pass D2.6: the emoji icon set is retired, and a stored `emoji` resolves
// to `filled` on every path a stored value reaches the page by:
//   1. this device's ft-icons (read at boot by initIconSet; prefs-sync writes a
//      synced row straight into ft-icons, so a row from another device arrives here),
//   2. the v1.43 user-settings mirror (`icons` on /api/auth/me, seeded by
//      pullMirroredDisplayPrefs when this device has no local choice),
//   3. the Settings Icons picker's highlight.
// The inline FOUC bootstraps are run in resolve-icon-set.test.js.
//
// Boot never REWRITES a stored `emoji`: a boot write changes the value, so prefs-sync
// would stamp it now and push it, beating a newer explicit choice made on another
// device (the prefs-sync last-BOOT-wins class). The pref is only resolved.
//
// Harness: jsdom, the REAL committed glyph-pool.js + icons.js + common.js evaluated
// via vm in the window (the star-pref-seed posture), fetch stubbed at the seam.

const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const PUB = path.join(__dirname, '..', '..', 'public');
const src = (f) => fs.readFileSync(path.join(PUB, 'js', f), 'utf8');
const GLYPH_POOL_SRC = src('glyph-pool.js');
const ICONS_SRC = src('icons.js');
const COMMON_SRC = src('common.js');
const SETUP_SRC = src('setup.js');

const openWindows = [];
after(() => { for (const w of openWindows) { try { w.close(); } catch (_) { /* best effort */ } } });

function boot({ localPrefs = {}, serverSettings = {}, html = '' } = {}) {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>${html}</body></html>`, {
    url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const w = dom.window;
  for (const [k, v] of Object.entries(localPrefs)) w.localStorage.setItem(k, v);
  const writes = [];
  const realSet = w.Storage.prototype.setItem;
  w.Storage.prototype.setItem = function (k, v) { writes.push([k, String(v)]); return realSet.call(this, k, v); };
  const fetchLog = [];
  w.fetch = (url, opts) => {
    fetchLog.push({ url: String(url), method: (opts && opts.method) || 'GET' });
    if (String(url).includes('/api/auth/me')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ settings: serverSettings }) });
    }
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
  };
  vm.createContext(w);
  vm.runInContext(GLYPH_POOL_SRC, w, { filename: 'glyph-pool.js' });
  vm.runInContext(ICONS_SRC, w, { filename: 'icons.js' });
  vm.runInContext(COMMON_SRC, w, { filename: 'common.js' });
  openWindows.push(w);
  return { w, writes, fetchLog };
}

const flush = () => new Promise((r) => setTimeout(r, 50));

test('a stored ft-icons=emoji boots as filled, draws the filled sprite, and is NOT rewritten at boot', async () => {
  const { w, writes } = boot({ localPrefs: { 'ft-era': '2021', 'ft-mode': 'light', 'ft-icons': 'emoji', 'ft-star-ratings': 'shown' } });
  w.document.documentElement.setAttribute('data-theme', '2021');
  w.document.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));
  await flush();
  assert.equal(w.document.documentElement.getAttribute('data-icons'), 'filled',
    'emoji -> filled (not the 2021 auto rounded, not the garbage default outlined)');
  const sprite = w.document.getElementById('ft-icon-sprite');
  assert.ok(sprite, 'the sprite is injected');
  assert.equal(sprite.getAttribute('data-set'), 'filled', 'the chrome glyphs draw the filled set');
  assert.equal(w.localStorage.getItem('ft-icons'), 'emoji', 'the stored pref is resolved, never rewritten');
  assert.deepEqual(writes.filter(([k]) => k === 'ft-icons'), [], 'boot writes nothing to ft-icons');
});

test('the user-settings mirror: icons=emoji on the server seeds filled on a device with no local choice', async () => {
  const { w, fetchLog } = boot({
    localPrefs: { 'ft-era': '2009', 'ft-mode': 'dark', 'ft-star-ratings': 'shown' },
    serverSettings: { icons: 'emoji' },
  });
  w.document.documentElement.setAttribute('data-theme', '2009');
  w.document.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));
  await flush();
  assert.ok(fetchLog.some((f) => f.url.includes('/api/auth/me')), 'the seed pull ran (vacuity guard)');
  assert.equal(w.document.documentElement.getAttribute('data-icons'), 'filled');
  assert.equal(w.localStorage.getItem('ft-icons'), 'filled', 'the seed persists the replacement, not the retired id');
  assert.ok(!fetchLog.some((f) => f.url.includes('/api/me/settings')), 'the seed never writes back to the mirror');
});

test('the user-settings mirror: a server icons=emoji never overrides a local choice', async () => {
  const { w } = boot({
    localPrefs: { 'ft-era': '2009', 'ft-mode': 'dark', 'ft-icons': 'rounded' },
    serverSettings: { icons: 'emoji' },
  });
  w.document.documentElement.setAttribute('data-theme', '2009');
  w.document.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));
  await flush();
  assert.equal(w.document.documentElement.getAttribute('data-icons'), 'rounded');
  assert.equal(w.localStorage.getItem('ft-icons'), 'rounded');
});

// setup.js's renderIconPicker, run for real against common.js's registry.
function renderPicker(storedIcons) {
  const { w } = boot({ html: '<div id="icon-picker"></div>' });
  if (storedIcons !== null) w.localStorage.setItem('ft-icons', storedIcons);
  const m = /\nfunction renderIconPicker\(\) \{[\s\S]*?\n\}\n/.exec(SETUP_SRC);
  assert.ok(m, 'renderIconPicker is in setup.js');
  vm.runInContext('var controller = new AbortController();' + m[0] + ';renderIconPicker();', w);
  const cards = [...w.document.querySelectorAll('#icon-picker .theme-card')];
  return {
    ids: cards.map((c) => c.dataset.iconsPref),
    active: cards.filter((c) => c.classList.contains('active')).map((c) => c.dataset.iconsPref),
  };
}

test('the Settings Icons picker offers Auto, Outlined, Rounded, Filled - no Emoji', () => {
  assert.deepEqual(renderPicker(null).ids, ['auto', 'outlined', 'rounded', 'filled']);
});

test('the Settings Icons picker highlights Filled for a stored emoji (and each real choice as itself)', () => {
  assert.deepEqual(renderPicker('emoji').active, ['filled']);
  for (const v of ['auto', 'outlined', 'rounded', 'filled']) assert.deepEqual(renderPicker(v).active, [v]);
  assert.deepEqual(renderPicker(null).active, ['outlined'], 'unset highlights the default');
});
