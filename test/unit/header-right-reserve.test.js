'use strict';

// [UNIT] v1.101 shimmer sweep tranche 3: the persistent HEADER-RIGHT cluster
// (account avatar + notification bell) shipped an empty header and injected both
// AFTER their async fetches, so the top-right popped in on every full page load.
// Now each RESERVES a shimmer placeholder before its fetch and reveals in place.
//
// Behavioural (jsdom) for the account avatar (always-present when signed-in, the
// clean case); source-lock for the bell (feature-probe gated + persist-last-known
// + localStorage, awkward to drive in the account-menu harness) - the sibling
// injector-file posture.

const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const COMMON = require.resolve('../../public/js/common.js');
let dom, savedFetch;

function fresh(mePayload) {
  delete global.document; delete global.window; delete global.sessionStorage;
  delete require.cache[COMMON];
  const common = require(COMMON);
  dom = new JSDOM('<!DOCTYPE html><header><div class="header-right"></div></header>', { url: 'http://localhost/' });
  global.window = dom.window;
  global.document = dom.window.document;
  global.sessionStorage = dom.window.sessionStorage;
  savedFetch = global.fetch;
  global.fetch = async (url, init) => {
    const method = (init && init.method) || 'GET';
    if (url === '/api/auth/me' && method === 'GET') {
      return mePayload === null
        ? { ok: false, status: 401, json: async () => ({}) }
        : { ok: true, status: 200, json: async () => mePayload };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  return common;
}
afterEach(() => {
  global.fetch = savedFetch;
  if (dom) { dom.window.close(); dom = null; }
  delete global.window; delete global.document; delete global.sessionStorage;
  delete require.cache[COMMON];
});
const tick = () => new Promise((r) => setTimeout(r, 0));

test('account avatar: a shimmer placeholder is RESERVED synchronously before /api/auth/me, then REVEALED as the real menu (signed-in)', async () => {
  const common = fresh({ user: { id: 1, username: 'Dean', role: 'admin' } });
  common.injectAccountMenu();
  // Synchronously (before the fetch resolves): the placeholder reserves the slot.
  const ph = global.document.getElementById('account-menu-placeholder');
  assert.ok(ph, 'a placeholder is injected before the fetch resolves (no empty-header pop-in)');
  assert.ok(ph.querySelector('.account-avatar.skeleton-shimmer'), 'the placeholder is a shimmering 32px avatar disc');
  assert.strictEqual(global.document.getElementById('account-menu-root'), null, 'the real menu is not there yet');
  await tick();
  assert.strictEqual(global.document.getElementById('account-menu-placeholder'), null, 'the placeholder is removed on resolve (reveal-once)');
  assert.ok(global.document.getElementById('account-menu-root'), 'the real account menu replaced it');
});

test('account avatar: the placeholder is removed (not stranded) on a signed-out shell', async () => {
  const common = fresh(null); // 401
  common.injectAccountMenu();
  assert.ok(global.document.getElementById('account-menu-placeholder'), 'reserved synchronously');
  await tick();
  assert.strictEqual(global.document.getElementById('account-menu-placeholder'), null, 'signed-out -> placeholder cleared, never a forever-shimmer');
  assert.strictEqual(global.document.getElementById('account-menu-root'), null, 'and no menu injected');
});

test('bell: persist-last-known reserve + reveal-once wiring (source lock)', () => {
  const common = fs.readFileSync(path.join(__dirname, '../../public/js/common.js'), 'utf8');
  const fn = common.slice(common.indexOf('function injectNotificationBellIfEnabled'), common.indexOf('// ---- v1.63: the playback queue'));
  // Reserve only when last-known-enabled; the probe reconciles + persists.
  assert.match(fn, /const NOTIF_BELL_ENABLED_KEY = 'ft-notif-bell-enabled'/, 'the persist key is defined');
  assert.match(fn, /localStorage\.getItem\(NOTIF_BELL_ENABLED_KEY\) === '1'/, 'reads the last-known-enabled flag');
  assert.match(fn, /if \(bellWasEnabled && !document\.getElementById\('notif-bell-placeholder'\)\) \{[\s\S]*?notif-bell-skel skeleton-shimmer/,
    'reserves a shimmer bell placeholder when it was enabled last time');
  assert.match(fn, /localStorage\.setItem\(NOTIF_BELL_ENABLED_KEY, '1'\)/, 'persists enabled=1 when the real bell mounts');
  assert.match(fn, /localStorage\.setItem\(NOTIF_BELL_ENABLED_KEY, '0'\)/, 'persists enabled=0 when the probe says disabled');
  // Strand-safe: the placeholder is removed on the probe resolve AND the catch.
  assert.match(fn, /removeBellPlaceholder\(\); \/\/ reveal-once/, 'removes the reserve on resolve');
  assert.match(fn, /\.catch\(\(\) => \{ removeBellPlaceholder\(\);/, 'removes the reserve on a fetch error (no stranded shimmer)');
});

test('both per-device header reserves are dropped on sign-out (no stale reserve for the next user)', () => {
  const common = fs.readFileSync(path.join(__dirname, '../../public/js/common.js'), 'utf8');
  const fn = common.slice(common.indexOf('function accountSignOut'), common.indexOf('function accountSignOut') + 1100);
  assert.match(fn, /removeItem\('ft-modern-avatarbar-count'\)/, 'avatar-bar count cleared on sign-out');
  assert.match(fn, /removeItem\('ft-notif-bell-enabled'\)/, 'bell-enabled flag cleared on sign-out');
});

test('CSS: the bell placeholder disc is sized to the real 22px bell (zero-shift reveal)', () => {
  const css = fs.readFileSync(path.join(__dirname, '../../public/css/style.css'), 'utf8');
  const rule = /\.notif-bell-skel \{([\s\S]*?)\}/.exec(css);
  assert.ok(rule, 'the .notif-bell-skel rule exists');
  assert.match(rule[1], /width: 22px;/, '22px disc matching the real bell svg');
  assert.match(rule[1], /border-radius: var\(--radius-full\)/, 'a round disc');
});
