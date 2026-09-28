'use strict';

// [UNIT] Sweep S1 (UI professionalism pass, plan D4 / D7 / F20 / F49 / F50 / F66): the app
// chrome on the primitives. jsdom-bound, with the REAL public/js/ui.js where a surface needs
// it (the account menu and the playlists sheet are ui.sheets; the unpin asks ui.confirm).
//
//   1. common.js's chrome builders emit exactly ui.js's DOM (no drift between the two);
//   2. the bottom bar's selected tab swaps to its filled glyph (F49);
//   3. the playlists sheet is a ui.sheet of ui-rows with a reserved action column (F50);
//   4. unpin asks through ui.confirm and only a confirmed answer DELETEs (D4.8);
//   5. the browser theme colour follows the app's era + mode (F66);
//   6. D7 stillness: the sidebar slides only when the menu toggle arms it, and a real width
//      change holds html.no-motion for 300ms; no layout property transitions;
//   7. F20: a ui-btn link (the bottom bar's tabs) never underlines, in any era.

const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const REPO = path.join(__dirname, '..', '..');
const COMMON = require.resolve('../../public/js/common.js');
const UI = require.resolve('../../public/js/ui.js');
const ICONS = require('../../public/js/icons.js');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const stripJs = (s) => strip(s).replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

let dom = null;
function fresh(body, url) {
  delete global.document; delete global.window; delete global.fetch;
  delete require.cache[COMMON];
  const c = require(COMMON); // boot skipped (no document at require time)
  dom = new JSDOM(`<!DOCTYPE html><html><head></head><body>${body || ''}</body></html>`, { url: url || 'http://localhost/' });
  global.window = dom.window;
  global.document = dom.window.document;
  delete require.cache[UI];
  const ui = require(UI);
  dom.window.ui = ui;
  return { c, ui };
}
afterEach(async () => {
  if (global.document && global.document.querySelector('.ui-sheet')) await tick(400); // let a closing sheet finish
  if (dom) { dom.window.close(); dom = null; }
  delete global.document; delete global.window; delete global.fetch;
  delete require.cache[COMMON];
});

// ---------------------------------------------------------------- 1. builders == ui.js
test('chromeButtonEl / uiIconEl / uiIconMarkup emit exactly ui.js DOM (the chrome cannot drift from the primitives)', () => {
  const { c, ui } = fresh();
  const doc = dom.window.document;
  const mine = c.chromeButtonEl({ icon: 'search', ariaLabel: 'Search', doc });
  const theirs = ui.button({ variant: 'plain', size: 'md', shape: 'icon', icon: 'search', ariaLabel: 'Search', doc });
  assert.strictEqual(mine.outerHTML, theirs.outerHTML, 'an icon button');
  assert.strictEqual(c.uiIconEl('menu', 'lg', doc).outerHTML, ui.icon('menu', { size: 'lg', doc }).outerHTML, 'an icon');
  const holder = doc.createElement('div');
  holder.innerHTML = c.uiIconMarkup('home', 'lg');
  assert.strictEqual(holder.firstChild.outerHTML, ui.icon('home', { size: 'lg', doc }).outerHTML, 'the static markup twin');
  // the hook class is appended after the primitive classes, nothing else changes
  const hooked = c.chromeButtonEl({ cls: 'queue-btn', icon: 'search', ariaLabel: 'Search', doc });
  assert.strictEqual(hooked.className, theirs.className + ' queue-btn');
});

test('chromeAvatarEl without ui.js builds the same DOM ui.avatar does (initials, tone, the img fallback)', () => {
  const { c, ui } = fresh();
  const doc = dom.window.document;
  delete dom.window.ui; // the jsdom-harness path (no ui.js on the page)
  for (const [name, url] of [['Harbor Workshop', null], ['dean', null], ['', null], ['Ada Lovelace', '/a.png']]) {
    const mine = c.chromeAvatarEl(name, url, 'sm', doc);
    const theirs = ui.avatar({ name, url, kind: 'person', size: 'sm', doc });
    assert.strictEqual(mine.outerHTML, theirs.outerHTML, `${JSON.stringify(name)} ${url}`);
  }
  const a = c.chromeAvatarEl('Ada Lovelace', '/broken.png', 'xs', doc);
  a.querySelector('img').dispatchEvent(new dom.window.Event('error'));
  assert.strictEqual(a.querySelector('img'), null);
  assert.strictEqual(a.querySelector('.ui-avatar__mono').textContent, 'AL', 'a failed photo becomes the monogram');
});

// ---------------------------------------------------------------- 2. the bottom bar (F49)
test('bottomNavItemEl: a ui-btn stack tab (fixed icon slot over the label); the selected tab swaps to its FILLED glyph', () => {
  const { c } = fresh();
  dom.window.FTIcons = ICONS;
  const doc = dom.window.document;
  const tab = c.bottomNavItemEl({ href: '/history', nav: 'history', icon: 'history', label: 'History', doc });
  assert.ok(tab.matches('a.ui-btn.ui-btn--plain.ui-btn--stack.bottom-nav-item[data-nav="history"][href="/history"]'));
  assert.ok(tab.querySelector(':scope > .ui-btn__icon > svg.ui-icon.ui-icon--lg') && tab.querySelector(':scope > .ui-btn__label.bottom-nav-label').textContent === 'History');
  const href = () => tab.querySelector('use').getAttribute('href');
  c.setBottomNavItemFilled(tab, true);
  assert.strictEqual(href(), '#i-history-fill', 'selected: the filled twin');
  c.setBottomNavItemFilled(tab, true);
  assert.strictEqual(href(), '#i-history-fill', 'idempotent');
  c.setBottomNavItemFilled(tab, false);
  assert.strictEqual(href(), '#i-history', 'deselected: the outline again');
  const odd = c.bottomNavItemEl({ href: '/x', nav: 'x', icon: 'menu', label: 'X', doc });
  c.setBottomNavItemFilled(odd, true);
  assert.strictEqual(odd.querySelector('use').getAttribute('href'), '#i-menu', 'no registered twin: the outline stays (never a blank glyph)');
  for (const name of ['home', 'folder', 'history', 'podcasts', 'music_note', 'menu_book', 'smart_display', 'download', 'dark_mode', 'light_mode', 'settings', 'subscriptions', 'star']) {
    assert.ok(ICONS.has(name + '.fill'), `every bottom-bar glyph has its FILL twin: ${name}`);
  }
});

test('applyNavHighlight lights ONE tab, filled; moving away restores the outline', () => {
  const { c } = fresh('<nav id="bottom-nav"></nav>');
  dom.window.FTIcons = ICONS;
  const doc = dom.window.document;
  const nav = doc.getElementById('bottom-nav');
  nav.appendChild(c.bottomNavItemEl({ href: '/', nav: 'home', icon: 'home', label: 'Home', doc }));
  nav.appendChild(c.bottomNavItemEl({ href: '/history', nav: 'history', icon: 'history', label: 'History', doc }));
  c.applyNavHighlight('/history', '');
  const use = (k) => nav.querySelector(`[data-nav="${k}"] use`).getAttribute('href');
  assert.deepStrictEqual([...nav.querySelectorAll('.active')].map((e) => e.getAttribute('data-nav')), ['history']);
  assert.strictEqual(use('history'), '#i-history-fill');
  assert.strictEqual(use('home'), '#i-home');
  c.applyNavHighlight('/', '');
  assert.strictEqual(use('home'), '#i-home-fill');
  assert.strictEqual(use('history'), '#i-history', 'the old tab is back to its outline');
});

// ---------------------------------------------------------------- 3. the playlists sheet (F50)
test('the playlists sheet is a bottom ui.sheet whose rows are ui-rows, each with the reserved action column', async () => {
  const { c } = fresh('<nav id="bottom-nav"></nav>');
  const doc = dom.window.document;
  global.resolveFolderGlyphClass = require('../../public/js/glyph-pool.js').resolveFolderGlyphClass; // a page global
  global.fetch = async (url) => {
    if (url === '/api/config') return { ok: true, json: async () => ({ folders: ['/m/a', '/m/b'], folderSettings: { '/m/a': { name: 'Alpha' } }, syntheticFolders: [] }) };
    if (url === '/api/subscriptions/pins') return { ok: true, json: async () => [{ id: 'p1', channelDir: '/d/Harbor', label: 'Harbor Workshop' }] };
    if (url === '/api/liked/count' || /liked/.test(url)) return { ok: true, json: async () => ({ total: 0, count: 0 }) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  c.openPlaylistsSheet();
  await tick(); await tick();
  const sheet = doc.getElementById('playlists-sheet');
  assert.ok(sheet && sheet.classList.contains('ui-sheet') && sheet.classList.contains('ui-sheet--bottom'), 'a bottom ui.sheet');
  assert.strictEqual(sheet.querySelector('.ui-sheet__title').textContent, 'Playlists');
  const rows = [...sheet.querySelectorAll('.ui-row')];
  assert.ok(rows.length >= 3, `library + pinned rows rendered (${rows.length})`);
  for (const r of rows) {
    assert.strictEqual(r.closest('.ui-list').classList.contains('ui-list--actions-1'), true, 'every list reserves one action column');
    assert.ok(r.querySelector(':scope > .ui-row__actions > .ui-row__slot, :scope > .ui-row__actions > .ui-btn'), 'every row fills its action column (a slot or the unpin)');
    assert.ok(!r.classList.contains('sidebar-item'), 'no desktop sidebar row in the phone sheet');
  }
  const pinned = rows.find((r) => r.textContent.includes('Harbor Workshop'));
  assert.ok(pinned.querySelector('.ui-row__media > .ui-avatar.ui-avatar--md'), 'the pin row carries its 36px avatar');
  assert.ok(pinned.querySelector('.ui-row__actions > button.ui-btn.pinned-unpin-btn[aria-pressed="true"] use[href="#i-keep-fill"]'), 'and the pinned (keep.fill) unpin toggle');
  // idempotent conversion
  const a = rows.find((r) => r.tagName === 'A');
  assert.strictEqual(c.toSheetRow(a), a);
  assert.strictEqual(a.querySelectorAll(':scope > .ui-row__body').length, 1);
  c.closePlaylistsSheet();
  delete global.resolveFolderGlyphClass;
});

// ---------------------------------------------------------------- 4. unpin asks first (D4.8)
test('unpin: a tap opens ui.confirm; Cancel, Esc, the scrim and Close never DELETE; only OK does - once', async () => {
  const { c } = fresh();
  const doc = dom.window.document;
  const deletes = [];
  let done = 0;
  global.fetch = async (url, init) => { if (init && init.method === 'DELETE') deletes.push(url); return { ok: true, json: async () => ({}) }; };
  const pin = { id: 'p9', pinSource: 'books' };
  const btn = c.buildUnpinButton(pin, () => { done += 1; }, 'md', 'Night Reading');
  doc.body.appendChild(btn);
  const dialog = () => doc.querySelector('.ui-sheet--dialog');
  const dismissals = [
    () => [...dialog().querySelectorAll('button')].find((b) => b.textContent === 'Cancel').click(),
    () => doc.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' })),
    () => doc.querySelector('.ui-scrim').click(),
    () => dialog().querySelector('.ui-sheet__close').click(),
  ];
  for (const dismiss of dismissals) {
    btn.click();
    assert.ok(dialog(), 'the confirm opened');
    assert.match(dialog().textContent, /Unpin Night Reading\?/);
    dismiss();
    await tick(400);
    assert.deepStrictEqual(deletes, [], 'a dismissal never deletes');
  }
  btn.click();
  const ok = [...dialog().querySelectorAll('button')].find((b) => b.textContent === 'Unpin');
  ok.click(); ok.click(); // a double tap on the answer
  await tick(); await tick();
  assert.deepStrictEqual(deletes, ['/api/books/pins/p9'], 'a confirmed unpin deletes exactly once, at the owning endpoint');
  await tick(400);
  assert.strictEqual(done, 1, 'the surfaces refresh once');
});

// Gate r1 (adversary 3): the unpin control lives in the SHELL (sidebar, playlists sheet), which
// no view teardown reaches, so its confirm binds the router's shown-view signal
// (FileTube.viewSignal, aborted the moment the user leaves the view; the router half is bound
// in card-action-menu-fullchain). A stand-in router signal drives it here.
test('unpin: the confirm is bound to FileTube.viewSignal - leaving the view dismisses it and its OK then deletes nothing', async () => {
  const { c } = fresh();
  const doc = dom.window.document;
  const deletes = [];
  global.fetch = async (url, init) => { if (init && init.method === 'DELETE') deletes.push(url); return { ok: true, json: async () => ({}) }; };
  const ac = new dom.window.AbortController();
  dom.window.FileTube = { viewSignal: () => ac.signal };
  const btn = c.buildUnpinButton({ id: 'p9', pinSource: 'books' }, () => {}, 'md', 'Night Reading');
  doc.body.appendChild(btn);
  btn.click();
  const dialog = doc.querySelector('.ui-sheet--dialog:not(.is-closing)');
  assert.ok(dialog, 'the confirm opened');
  const ok = [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Unpin');
  ac.abort(); // the user navigates away
  assert.strictEqual(doc.querySelector('.ui-sheet--dialog:not(.is-closing)'), null, 'the confirm closed with the view');
  ok.click();
  await tick(); await tick();
  assert.deepStrictEqual(deletes, [], 'no unpin after the view was left');
  await tick(400);
});

// The backup checks after the answer, each bound by the one input only it refuses: a stand-in
// window.ui.confirm (the real one answers only true/false and closes on abort, masking both).
test('unpin: only an answer of exactly `true` unpins, and a yes that lands after the view was left unpins nothing', async () => {
  const { c } = fresh();
  const doc = dom.window.document;
  const deletes = [];
  global.fetch = async (url, init) => { if (init && init.method === 'DELETE') deletes.push(url); return { ok: true, json: async () => ({}) }; };
  const cases = [[1, 'stay', 0], ['yes', 'stay', 0], [{}, 'stay', 0], [true, 'leave', 0], [true, 'stay', 1]]; // the last: the positive control
  for (const [answerValue, leave, want] of cases) {
    deletes.length = 0;
    const ac = new dom.window.AbortController();
    dom.window.FileTube = { viewSignal: () => ac.signal };
    let resolve;
    dom.window.ui = { confirm: () => new Promise((r) => { resolve = r; }) }; // ignores its signal
    const btn = c.buildUnpinButton({ id: 'p9', pinSource: 'books' }, () => {}, 'md', 'Night Reading');
    doc.body.appendChild(btn);
    btn.click();
    assert.strictEqual(typeof resolve, 'function', 'the confirm was asked');
    if (leave === 'leave') ac.abort();
    resolve(answerValue);
    await tick(); await tick();
    assert.strictEqual(deletes.length, want, `answer ${JSON.stringify(answerValue)}, ${leave}`);
    btn.remove();
  }
});

// ---------------------------------------------------------------- 5. theme colour (F66)
test('syncThemeColorMeta: the pre-paint light/dark pair collapses to the header ground of the app mode; junk is refused', () => {
  const { c } = fresh();
  const doc = dom.window.document;
  doc.head.innerHTML = '<meta name="theme-color" content="#f2f2f7" media="(prefers-color-scheme: light)"><meta name="theme-color" content="#000000" media="(prefers-color-scheme: dark)">';
  let value = '#1c1916';
  dom.window.getComputedStyle = () => ({ getPropertyValue: (p) => (p === '--header-bg' ? ' ' + value + ' ' : '') });
  assert.strictEqual(c.syncThemeColorMeta(doc), '#1c1916');
  for (const m of doc.querySelectorAll('meta[name="theme-color"]')) {
    assert.strictEqual(m.getAttribute('content'), '#1c1916');
    assert.strictEqual(m.getAttribute('media'), null, 'no OS-scheme split once the app mode is known');
  }
  value = 'var(--surface-0)'; // an unresolved value never reaches the meta
  assert.strictEqual(c.syncThemeColorMeta(doc), '');
  assert.strictEqual(doc.querySelector('meta[name="theme-color"]').getAttribute('content'), '#1c1916');
  // the shells ship the pair (13 shells), and applyTheme calls the sync
  const shells = fs.readdirSync(path.join(REPO, 'public')).filter((f) => f.endsWith('.html')).map((f) => 'public/' + f).concat(['lib/ytdlp/views/subscriptions.html'])
    .filter((f) => fs.readFileSync(path.join(REPO, f), 'utf8').includes('name="theme-color"'));
  assert.ok(shells.length >= 13, `${shells.length} shells carry theme-color`);
  for (const f of shells) {
    const html = fs.readFileSync(path.join(REPO, f), 'utf8');
    assert.ok(!html.includes('content="#cc0000"'), `${f}: no static brand-red theme-color`);
    assert.ok(html.includes('media="(prefers-color-scheme: light)"') && html.includes('media="(prefers-color-scheme: dark)"'), `${f}: the light/dark pair`);
  }
  const src = strip(fs.readFileSync(COMMON, 'utf8'));
  assert.match(/function applyTheme\([\s\S]*?\n\}/.exec(src)[0], /syncThemeColorMeta\(\)/, 'applyTheme keeps the browser chrome in sync');
});

// ---------------------------------------------------------------- 6. D7 stillness
test('D7: the sidebar slides only while armed by the menu toggle; the arm clears on its transitionend or a fallback', async () => {
  const { c } = fresh('<aside id="sidebar" class="sidebar"><div class="inner"></div></aside>');
  const sb = dom.window.document.getElementById('sidebar');
  c.armSidebarSlide(sb);
  assert.ok(sb.classList.contains('is-animating'));
  const inner = new dom.window.Event('transitionend', { bubbles: true });
  sb.querySelector('.inner').dispatchEvent(inner);
  assert.ok(sb.classList.contains('is-animating'), 'a child transition does not clear the arm');
  sb.dispatchEvent(new dom.window.Event('transitionend'));
  assert.ok(!sb.classList.contains('is-animating'), 'the sidebar\'s own transitionend clears it');
  c.armSidebarSlide(sb);
  await tick(300);
  assert.ok(!sb.classList.contains('is-animating'), 'the fallback clears it when no transition runs');
  const src = stripJs(fs.readFileSync(COMMON, 'utf8'));
  assert.match(src, /menuToggle\.addEventListener\('click', \(\) => \{\s*armSidebarSlide\(sidebar\);\s*sidebar\.classList\.toggle\('hidden'\);/, 'ONLY the menu toggle arms the slide, before it toggles');
  assert.strictEqual((src.match(/armSidebarSlide\(/g) || []).length, 2, 'one definition, one caller');
});

test('D7: a real width change (resize, rotate) holds html.no-motion for 300ms; a height-only resize (the iOS toolbar) does not', async () => {
  const { c } = fresh();
  const w = dom.window;
  const root = w.document.documentElement;
  Object.defineProperty(w, 'innerWidth', { value: 390, writable: true, configurable: true });
  c.wireNoMotionOnResize(w);
  w.dispatchEvent(new w.Event('resize'));
  assert.ok(!root.classList.contains('no-motion'), 'same width (the toolbar collapsing): no hold');
  w.innerWidth = 844;
  w.dispatchEvent(new w.Event('resize'));
  assert.ok(root.classList.contains('no-motion'), 'a width change holds');
  await tick(320);
  assert.ok(!root.classList.contains('no-motion'), 'released after 300ms');
  w.dispatchEvent(new w.Event('orientationchange'));
  assert.ok(root.classList.contains('no-motion'), 'a rotation holds');
  await tick(320);
  const src = strip(fs.readFileSync(COMMON, 'utf8'));
  assert.match(src, /wireNoMotionOnResize\(window\);/, 'wired at boot');
});

test('D7 CSS: no layout transition on .main-content; the sidebar\'s transform transition only under .is-animating; html.no-motion zeroes transitions', () => {
  const css = strip(fs.readFileSync(path.join(REPO, 'public/css/style.css'), 'utf8'));
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
  for (const r of rules.filter((x) => /(^|,\s*|\s)\.main-content(\.[\w-]+)?$/.test(x.sel))) {
    assert.doesNotMatch(r.body, /transition/, `${r.sel}: no transition (margin-left is a layout property)`);
  }
  for (const r of rules.filter((x) => /(^|,\s*)\.sidebar(\.(hidden|mobile-open))?$/.test(x.sel))) {
    assert.doesNotMatch(r.body, /transition/, `${r.sel}: no ungated transition`);
  }
  const armed = rules.find((x) => x.sel === '.sidebar.is-animating');
  assert.ok(armed && /transition:\s*transform [^;,]*;/.test(armed.body), 'the armed drawer transitions transform, nothing else');
  const hold = rules.find((x) => /html\.no-motion \*/.test(x.sel));
  assert.ok(hold && /transition:\s*none !important;/.test(hold.body), 'the rotation hold');
});

// ---------------------------------------------------------------- 7. F20
test('F20: a ui-btn link never underlines - the [data-theme] prefix outranks the 2005 `a` underline and the global a:hover', () => {
  const ui = strip(fs.readFileSync(path.join(REPO, 'public/css/ui.css'), 'utf8'));
  assert.match(ui, /\[data-theme\] a\.ui-btn,\s*a\.ui-btn \{\s*text-decoration: none;\s*\}/);
  const style = strip(fs.readFileSync(path.join(REPO, 'public/css/style.css'), 'utf8'));
  assert.match(style, /\[data-theme="2005"\] a \{ text-decoration: underline; \}/, 'the rule it must beat is (0,1,1)');
  assert.match(style, /\[data-theme\] a\.sidebar-item,\s*a\.sidebar-item \{\s*text-decoration: none;\s*\}/, 'the sidebar rows too');
});
