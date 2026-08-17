'use strict';

// [UNIT] v1.82 T2 - the account menu. jsdom-level coverage of the avatar builder
// (monogram vs uploaded image) and injectAccountMenu's structure + interaction.
//
// common.js's boot block is wrapped in `if (typeof document !== 'undefined')`,
// so we REQUIRE it with no document (boot skipped -> no handoff setInterval hang,
// the v1.78.1 lesson) and only set a jsdom document for the function CALLS.

const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const COMMON = require.resolve('../../public/js/common.js');
let dom, savedFetch;

function fresh(mePayload) {
  // Require while `document` is undefined so the shell boot never runs.
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

test('buildAccountAvatarEl: no photo -> initials monogram + a deterministic colour', () => {
  const { buildAccountAvatarEl } = fresh({});
  const el = buildAccountAvatarEl({ id: 1, displayName: 'Dean', avatar: { present: false } });
  assert.strictEqual(el.textContent, 'D', 'first-letter monogram');
  assert.ok(el.style.backgroundColor, 'a palette colour is applied');
  assert.strictEqual(el.querySelector('img'), null, 'no image element when unset');
});

test('buildAccountAvatarEl: an uploaded photo -> a cache-busted <img>, no monogram text', () => {
  const { buildAccountAvatarEl } = fresh({});
  const el = buildAccountAvatarEl({ id: 7, displayName: 'Kid', avatar: { present: true, version: 1234 } });
  const img = el.querySelector('img');
  assert.ok(img, 'an image element is rendered');
  assert.strictEqual(img.getAttribute('src'), '/api/users/7/avatar?v=1234', 'served by id + cache-busted by version');
  assert.strictEqual(el.textContent, '', 'no monogram glyph when a photo is shown');
});

test('injectAccountMenu: builds the trigger + full dropdown, once, with account + all items', async () => {
  const { injectAccountMenu } = fresh({ user: { id: 1, displayName: 'Dean', username: 'dean', role: 'admin', avatar: { present: false, version: 0 } } });
  injectAccountMenu();
  await tick();

  const root = global.document.getElementById('account-menu-root');
  assert.ok(root, 'the menu mounted into .header-right');
  const trigger = root.querySelector('.account-menu-trigger');
  assert.strictEqual(trigger.getAttribute('aria-haspopup'), 'menu');
  assert.strictEqual(trigger.getAttribute('aria-expanded'), 'false');
  assert.strictEqual(trigger.querySelector('.account-avatar').textContent, 'D', 'monogram in the trigger');

  const labels = [...root.querySelectorAll('.account-menu-item span')].map((s) => s.textContent);
  assert.deepStrictEqual(labels, ['Change photo', 'Liked', 'History', 'Settings', 'Theme', 'Sign out'], 'all items present, in order');
  assert.strictEqual(root.querySelector('.account-menu-name').textContent, 'Dean');
  assert.strictEqual(root.querySelector('.account-menu-role').textContent, 'Admin');
  const links = [...root.querySelectorAll('a.account-menu-item')].map((a) => a.getAttribute('href'));
  assert.deepStrictEqual(links, ['/?liked=1', '/history', '/setup.html']);

  injectAccountMenu();
  await tick();
  assert.strictEqual(global.document.querySelectorAll('#account-menu-root').length, 1, 'injected exactly once');
});

test('injectAccountMenu: click toggles the dropdown; outside-click + Escape close it', async () => {
  const { injectAccountMenu } = fresh({ user: { id: 1, displayName: 'Dean', role: 'member', avatar: { present: false } } });
  injectAccountMenu();
  await tick();

  const trigger = global.document.querySelector('.account-menu-trigger');
  const menu = global.document.querySelector('.account-menu-dropdown');
  assert.strictEqual(menu.hidden, true, 'starts closed');

  trigger.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.strictEqual(menu.hidden, false, 'opens on trigger click');
  assert.strictEqual(trigger.getAttribute('aria-expanded'), 'true');

  global.document.body.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.strictEqual(menu.hidden, true, 'outside-click closes');

  trigger.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.strictEqual(menu.hidden, false);
  global.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.strictEqual(menu.hidden, true, 'Escape closes');
});

test('injectAccountMenu: the Theme item glyph reflects the current mode and updates on toggle', async () => {
  const common = fresh({ user: { id: 1, displayName: 'Dean', role: 'admin', avatar: { present: false } } });
  global.document.documentElement.setAttribute('data-mode', 'light');
  common.injectAccountMenu();
  await tick();
  const icon = global.document.getElementById('account-menu-theme-icon');
  assert.ok(icon, 'the theme item icon carries the sync id');
  assert.strictEqual(icon.className, 'icon-moon', 'light mode shows the moon (switch-to-dark)');
  // Flip to dark and re-sync (applyTheme calls updateAccountMenuThemeItem).
  global.document.documentElement.setAttribute('data-mode', 'dark');
  common.updateAccountMenuThemeItem();
  assert.strictEqual(icon.className, 'icon-sun', 'dark mode shows the sun');
});

test('applyTheme syncs the account-menu theme glyph on every toggle (source lock)', () => {
  // Binds the toggle-PATH wiring, not just injection-time: a mutant that drops
  // the updateAccountMenuThemeItem() call from applyTheme leaves the glyph stale.
  const src = require('node:fs').readFileSync(COMMON, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const applyBody = /function applyTheme\([\s\S]*?\n\}/.exec(src);
  assert.ok(applyBody, 'applyTheme found');
  assert.match(applyBody[0], /updateAccountMenuThemeItem\(\)/, 'applyTheme must sync the account-menu theme glyph on toggle');
});

test('injectAccountMenu: a signed-out shell (401 me) injects nothing', async () => {
  const { injectAccountMenu } = fresh(null);
  injectAccountMenu();
  await tick();
  assert.strictEqual(global.document.getElementById('account-menu-root'), null, 'no menu for a signed-out shell');
});

// ---- v1.144 (Dean): the version row links to the build's release notes ----

test('releaseNotesUrl: a valid version maps to its GitHub release page; junk maps to null', () => {
  const { releaseNotesUrl } = fresh({});
  assert.strictEqual(releaseNotesUrl('1.143.0'), 'https://github.com/dtammam/filetube/releases/tag/v1.143.0');
  assert.strictEqual(releaseNotesUrl(''), null);
  assert.strictEqual(releaseNotesUrl('1.143'), null, 'incomplete version never builds a URL');
  assert.strictEqual(releaseNotesUrl('1.143.0-evil/../x'), null, 'nothing unvalidated reaches the href');
  assert.strictEqual(releaseNotesUrl(null), null);
});

test('injectAccountMenu: the version row is an ANCHOR to the running build\'s release notes (new tab, noopener)', async () => {
  const { injectAccountMenu } = fresh({ user: { id: 1, displayName: 'Dean', username: 'dean', role: 'admin', avatar: { present: false, version: 0 } } });
  const meta = global.document.createElement('meta');
  meta.setAttribute('name', 'ft-version');
  meta.setAttribute('content', '1.144.0');
  global.document.head.appendChild(meta);

  injectAccountMenu();
  await tick();

  const ver = global.document.querySelector('.account-menu-version');
  assert.ok(ver, 'the version row rendered (meta present)');
  assert.strictEqual(ver.tagName, 'A', 'it is a link now, not a static div');
  assert.strictEqual(ver.getAttribute('href'), 'https://github.com/dtammam/filetube/releases/tag/v1.144.0',
    'clicking lands on THIS build\'s release notes');
  assert.strictEqual(ver.getAttribute('target'), '_blank');
  assert.strictEqual(ver.getAttribute('rel'), 'noopener');
  assert.strictEqual(ver.textContent, 'Version 1.144.0', 'the visible text is unchanged from v1.90');
});

test('injectAccountMenu: a version the URL builder rejects renders NO row (gate W1 - the bounding guard is load-bearing, not decoration)', async () => {
  // appVersionString prefix-matches (so '1.144.0-evil' passes it), but
  // releaseNotesUrl is anchored and returns null - the row must not render.
  // The seat's surviving mutant dropped the notesUrl guard and raw-concatted
  // the href: this case is what makes that mutant red.
  const { injectAccountMenu } = fresh({ user: { id: 1, displayName: 'Dean', username: 'dean', role: 'admin', avatar: { present: false, version: 0 } } });
  const meta = global.document.createElement('meta');
  meta.setAttribute('name', 'ft-version');
  meta.setAttribute('content', '1.144.0-evil');
  global.document.head.appendChild(meta);
  injectAccountMenu();
  await tick();
  assert.strictEqual(global.document.querySelector('.account-menu-version'), null,
    'a version that cannot build a valid release URL renders no row - never a dead or attacker-shaped link');
});

test('injectAccountMenu: no version meta -> no version row at all (never a dead link)', async () => {
  const { injectAccountMenu } = fresh({ user: { id: 1, displayName: 'Dean', username: 'dean', role: 'admin', avatar: { present: false, version: 0 } } });
  injectAccountMenu();
  await tick();
  assert.strictEqual(global.document.querySelector('.account-menu-version'), null);
});
