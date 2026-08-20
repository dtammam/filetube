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
  // v1.153: Stats joined the quick links (mobile's way in, sidebar-only otherwise).
  // Subscriptions is NOT here because this fixture has no subscriptions nav entry
  // (the enabled-module gate) - covered by its own test below.
  assert.deepStrictEqual(labels, ['Change photo', 'Liked', 'History', 'Stats', 'Settings', 'Theme', 'Sign out'], 'all items present, in order');
  assert.strictEqual(root.querySelector('.account-menu-name').textContent, 'Dean');
  assert.strictEqual(root.querySelector('.account-menu-role').textContent, 'Admin');
  const links = [...root.querySelectorAll('a.account-menu-item')].map((a) => a.getAttribute('href'));
  assert.deepStrictEqual(links, ['/?liked=1', '/history', '/stats.html', '/setup.html']);

  injectAccountMenu();
  await tick();
  assert.strictEqual(global.document.querySelectorAll('#account-menu-root').length, 1, 'injected exactly once');
});

test('injectAccountMenu: the Subscriptions quick link appears only when the module is enabled (v1.153)', async () => {
  const { injectAccountMenu } = fresh({ user: { id: 1, displayName: 'Dean', role: 'member', avatar: { present: false } } });
  // simulate the enabled yt-dlp module: its nav entry is already in the DOM
  const marker = global.document.createElement('a');
  marker.setAttribute('data-nav', 'subscriptions');
  global.document.body.appendChild(marker);
  injectAccountMenu();
  await tick();
  const root = global.document.getElementById('account-menu-root');
  const labels = [...root.querySelectorAll('.account-menu-item span')].map((s) => s.textContent);
  assert.deepStrictEqual(labels, ['Change photo', 'Liked', 'History', 'Stats', 'Subscriptions', 'Settings', 'Theme', 'Sign out'],
    'Subscriptions joins the quick links when enabled');
  const subs = [...root.querySelectorAll('a.account-menu-item')].find((a) => a.textContent.includes('Subscriptions'));
  assert.strictEqual(subs.getAttribute('href'), '/subscriptions');
});

test('v1.153 (Dean): a quick-link click SPA-navigates + closes the menu (keeps the mini-player), not a full reload', async () => {
  const { injectAccountMenu } = fresh({ user: { id: 1, displayName: 'Dean', role: 'member', avatar: { present: false } } });
  const navd = [];
  global.window.FileTube = { navigate: (url) => navd.push(url) };
  injectAccountMenu();
  await tick();
  const settings = [...global.document.querySelectorAll('a.account-menu-item')].find((a) => a.getAttribute('href') === '/setup.html');
  assert.ok(settings, 'the Settings quick link exists');
  // open the menu, then plain-click Settings
  global.document.querySelector('.account-menu-trigger').click();
  const evt = new global.window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
  settings.dispatchEvent(evt);
  // The menu stops propagation to the document router, so WITHOUT the explicit
  // handler this click would full-reload (default nav) and kill playback.
  assert.strictEqual(evt.defaultPrevented, true, 'the default full navigation is prevented');
  assert.deepStrictEqual(navd, ['http://localhost/setup.html'], 'routed through the in-app SPA navigate');
  assert.strictEqual(global.document.querySelector('.account-menu-dropdown').hidden, true, 'the menu closed');
});

test('v1.153.1: Subscriptions is added to an ALREADY-BUILT menu when the module enables late (cold-cache first load)', async () => {
  const common = fresh({ user: { id: 1, displayName: 'Dean', role: 'member', avatar: { present: false } } });
  const { injectAccountMenu, ensureAccountMenuSubscriptionsRow } = common;
  // cold cache: NO subscriptions marker in the DOM when the menu builds
  injectAccountMenu();
  await tick();
  const labelsOf = () => [...global.document.querySelectorAll('.account-menu-item span')].map((s) => s.textContent);
  assert.ok(!labelsOf().includes('Subscriptions'), 'not present at build time (cold cache)');
  // the /health probe resolves later -> injectSubscriptionsNavNodes patches the menu
  ensureAccountMenuSubscriptionsRow();
  assert.deepStrictEqual(labelsOf(), ['Change photo', 'Liked', 'History', 'Stats', 'Subscriptions', 'Settings', 'Theme', 'Sign out'],
    'Subscriptions inserted after Stats, before Settings');
  assert.strictEqual([...global.document.querySelectorAll('a.account-menu-item[href="/subscriptions"]')].length, 1);
  // idempotent: a second call never duplicates
  ensureAccountMenuSubscriptionsRow();
  assert.strictEqual([...global.document.querySelectorAll('a.account-menu-item[href="/subscriptions"]')].length, 1);
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

// ---- v1.158 (Dean): the "Total size on disk" footer row --------------------

const { formatByteSize } = require('../../public/js/stats.js');

test('formatDiskBytes: byte-exact with the Stats formatByteSize (the two figures can never drift)', () => {
  const { formatDiskBytes } = fresh({});
  for (const b of [0, 1, 1023, 1024, 1536, 1048576, 2.5 * 1024 ** 3, 999 * 1024 ** 4, -5, NaN, 'x']) {
    assert.strictEqual(formatDiskBytes(b), formatByteSize(b), `same string for ${b}`);
  }
});

function withDiskMenu(mePayload) {
  const common = fresh(mePayload || { user: { id: 1, displayName: 'Dean', role: 'admin', avatar: { present: false } } });
  const meta = global.document.createElement('meta'); // so the version row exists (ordering test)
  meta.setAttribute('name', 'ft-version'); meta.setAttribute('content', '1.158.0');
  global.document.head.appendChild(meta);
  return common;
}
// Re-point fetch so the storage-summary open-fetch resolves with `bytes` (or
// fails when bytes === null). /api/auth/me already resolved at inject time.
function stubStorage(bytes) {
  global.fetch = async (url) => {
    if (url === '/api/storage-summary') {
      return bytes === null
        ? { ok: false, status: 500, json: async () => ({}) }
        : { ok: true, status: 200, json: async () => ({ totalSizeBytes: bytes }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };
}

test('the disk row is an account-menu-disk LINK to Stats, ABOVE the version row, shimmering before open', async () => {
  const { injectAccountMenu } = withDiskMenu();
  injectAccountMenu();
  await tick();
  const disk = global.document.querySelector('.account-menu-disk');
  assert.ok(disk, 'the disk row rendered');
  assert.strictEqual(disk.tagName, 'A');
  assert.strictEqual(disk.getAttribute('href'), '/stats.html', 'clicking opens Stats');
  assert.ok(disk.querySelector('.account-menu-disk-shimmer.skeleton-shimmer'), 'shimmers until the lazy fetch');
  // Ordering: disk sits ABOVE the version row.
  const ver = global.document.querySelector('.account-menu-version');
  assert.ok(ver, 'the version row exists');
  assert.ok(disk.compareDocumentPosition(ver) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING,
    'the version row comes AFTER the disk row (disk is above version)');
});

test('on first open the disk total resolves: shimmer clears, shows "<size> on disk" matching formatDiskBytes', async () => {
  const { injectAccountMenu, formatDiskBytes } = withDiskMenu();
  injectAccountMenu();
  await tick();
  stubStorage(2.5 * 1024 ** 3);
  global.document.querySelector('.account-menu-trigger').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await tick();
  const disk = global.document.querySelector('.account-menu-disk');
  assert.strictEqual(disk.hidden, false, 'the row stays');
  assert.strictEqual(disk.querySelector('.skeleton-shimmer'), null, 'the shimmer is gone');
  assert.strictEqual(disk.textContent, formatDiskBytes(2.5 * 1024 ** 3) + ' on disk');
});

test('the disk fetch is lazy (only on open) and happens at most once across opens', async () => {
  const { injectAccountMenu } = withDiskMenu();
  injectAccountMenu();
  await tick();
  let hits = 0;
  global.fetch = async (url) => {
    if (url === '/api/storage-summary') hits += 1;
    return { ok: true, status: 200, json: async () => ({ totalSizeBytes: 100 }) };
  };
  assert.strictEqual(hits, 0, 'no fetch before the menu is ever opened');
  const trigger = global.document.querySelector('.account-menu-trigger');
  trigger.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); // open
  await tick();
  trigger.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); // close
  trigger.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); // open again
  await tick();
  assert.strictEqual(hits, 1, 'fetched exactly once (first open), not on every open');
});

test('a failed disk fetch hides the row AND its divider (never a broken value)', async () => {
  const { injectAccountMenu } = withDiskMenu();
  injectAccountMenu();
  await tick();
  const disk = global.document.querySelector('.account-menu-disk');
  const divider = disk.previousElementSibling; // the footer divider we added above it
  assert.ok(divider.classList.contains('account-menu-divider'), 'precondition: a divider sits above the disk row');
  stubStorage(null); // 500
  global.document.querySelector('.account-menu-trigger').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await tick();
  assert.strictEqual(disk.hidden, true, 'the disk row hides on failure');
  assert.strictEqual(divider.hidden, true, 'and its divider hides too (no orphan separator)');
});

// ---- v1.158 (Dean): the per-device admin flag (drives the nav admin-reserve) --

test('fetchCurrentUser stamps ft-is-admin for an admin and CLEARS it for a member (single writer)', async () => {
  // admin -> flag set
  const a = fresh({ user: { id: 1, displayName: 'Dean', role: 'admin', avatar: { present: false } } });
  global.localStorage = dom.window.localStorage;
  a.injectAccountMenu(); // calls the shared, memoized fetchCurrentUser
  await tick();
  assert.strictEqual(global.localStorage.getItem('ft-is-admin'), '1', 'admin -> flag set (so the nav can pre-reserve)');
  delete global.localStorage;

  // member -> a stale admin flag is cleared (fresh require resets the memoized promise)
  const m = fresh({ user: { id: 2, displayName: 'Kid', role: 'member', avatar: { present: false } } });
  global.localStorage = dom.window.localStorage;
  global.localStorage.setItem('ft-is-admin', '1'); // left over from a prior admin session on this device
  m.injectAccountMenu();
  await tick();
  assert.strictEqual(global.localStorage.getItem('ft-is-admin'), null, 'member -> the stale flag is cleared (no phantom admin reserve)');
  delete global.localStorage;
});
