'use strict';

// [UNIT] UI pass sweep S8 (Settings and forms; plan D4.8 / D4.10, findings F09 F36 F54 F55).
//
// 1. Destructive paths: every destructive Settings action (remove a logo / sticker / photo,
//    clear the transcode cache, restore a backup, delete a user, remove a folder) opens a
//    DANGER ui.confirm, and its request - the SAME endpoint and body as before - goes out only
//    after the confirm resolves true. Every dismissal (Cancel, Esc, the scrim, Close) sends
//    nothing. Driven through the REAL setup.js wiring, the REAL setup.html markup and the REAL
//    ui.js. (The critter, trash and timing-log confirms are bound in their own files.)
// 2. The admin password reset is a ui.prompt with a MASKED field: the typed value is never
//    in the DOM unmasked by default, the show toggle unmasks it on request, and the value goes
//    only to POST /api/users/:id/password.
// 3. The form contract of setup.html / login.html / welcome.html: every checkbox is a
//    ui-switch, every text/number field a ui-field input, every select a ui-select, no inline
//    style, no window.alert/confirm/prompt left in the swept scripts.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { loadUi, openDialog, parts, answer, settle, drainSheets, DISMISSALS } = require('../helpers/ui-dialogs');

const ROOT = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const SETUP_HTML = read('public/setup.html');

// setup.js runs after glyph-pool.js and common.js in the shell: their top-level helpers are
// globals there. Borrow them for the harness (only the names not already defined), restored after.
const SHELL_GLOBALS = Object.assign({}, require('../../public/js/glyph-pool.js'), require('../../public/js/common.js'));
const setup = require('../../public/js/setup.js');

// ---- harness ---------------------------------------------------------------------------

// The real setup.html (scripts do not run), the real ui.js, a recording fetch.
function mount(routes) {
  const virtualConsole = new (require('jsdom').VirtualConsole)(); // jsdom's "navigation not implemented" (the logo reload) stays quiet
  const dom = new JSDOM(SETUP_HTML, { url: 'http://localhost/setup.html', virtualConsole });
  const w = dom.window;
  const calls = [];
  const saved = { window: global.window, document: global.document, fetch: global.fetch, localStorage: global.localStorage,
    requestAnimationFrame: global.requestAnimationFrame, setActionStatus: global.setActionStatus, showToast: global.showToast,
    setButtonBusy: global.setButtonBusy, applyCustomLogoIfSet: global.applyCustomLogoIfSet, wireReorderable: global.wireReorderable };
  const borrowed = Object.keys(SHELL_GLOBALS).filter((k) => !(k in global));
  for (const k of borrowed) global[k] = SHELL_GLOBALS[k];
  global.window = w; global.document = w.document; global.localStorage = w.localStorage;
  global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  global.setActionStatus = (el, t) => { if (el) el.textContent = t || ''; };
  global.showToast = () => {};
  global.setButtonBusy = (b, busy) => { if (b) b.disabled = !!busy; };
  global.applyCustomLogoIfSet = () => {};
  global.wireReorderable = () => {};
  global.fetch = (url, init) => {
    const method = (init && init.method) || 'GET';
    const body = init && typeof init.body === 'string' ? init.body : (init && init.body);
    calls.push({ method, url: String(url), body });
    const r = (routes && routes[method + ' ' + url]) || { ok: true, json: {} };
    return Promise.resolve({ ok: r.ok !== false, status: r.ok === false ? 400 : 200, json: () => Promise.resolve(r.json || {}) });
  };
  loadUi();
  const ac = new w.AbortController();
  setup.__setFolderStateForTests({ controller: ac, folders: [], settings: {} });
  const teardown = async () => {
    await drainSheets(w);
    ac.abort();
    setup.__setFolderStateForTests({ controller: null });
    Object.assign(global, saved);
    for (const k of borrowed) delete global[k];
    w.close();
  };
  return { w, d: w.document, calls, ac, teardown };
}
const sent = (calls, method, url) => calls.filter((c) => c.method === method && c.url === url);

// Taps `trigger` once per dismissal (asserting nothing is sent), then once more and confirms;
// returns the calls the confirmed tap made. `expectTitle` binds the dialog to its action.
async function assertConfirmGate(c, trigger, { method, url, expectTitle }) {
  for (const how of DISMISSALS) {
    trigger();
    await settle();
    const k = parts(openDialog(c.d));
    assert.ok(k.ok.classList.contains('ui-btn--destructive'), `${url}: a danger confirm`);
    if (expectTitle) assert.match(k.title, expectTitle);
    assert.strictEqual(sent(c.calls, method, url).length, 0, `${url}: opening the confirm sends nothing`);
    answer(c.d, how);
    await settle();
    assert.strictEqual(sent(c.calls, method, url).length, 0, `${url}: ${how} sends nothing`);
    await drainSheets(c.w);
  }
  trigger();
  await settle();
  answer(c.d, 'ok');
  await settle(12);
  const hits = sent(c.calls, method, url);
  assert.strictEqual(hits.length, 1, `${url}: OK sends exactly one ${method}`);
  return hits[0];
}

// ---- 1. the destructive paths ------------------------------------------------------------

test('Remove light/dark logo: confirm first, then the same DELETE /api/settings/logo[?variant=dark]', async () => {
  const c = mount();
  try {
    setup.wireLogoControls();
    await assertConfirmGate(c, () => c.d.getElementById('logo-reset-btn').click(),
      { method: 'DELETE', url: '/api/settings/logo', expectTitle: /Remove the light-mode logo\?/ });
    await assertConfirmGate(c, () => c.d.getElementById('logo-reset-btn-dark').click(),
      { method: 'DELETE', url: '/api/settings/logo?variant=dark', expectTitle: /Remove the dark-mode logo\?/ });
  } finally { await c.teardown(); }
});

test('Remove your sticker image: confirm first, then the same DELETE /api/me/sticker', async () => {
  const c = mount({ 'GET /api/me/sticker': { ok: true } });
  try {
    await setup.renderStickerPicker();
    const btn = () => c.d.getElementById('sticker-remove-custom');
    assert.strictEqual(btn().hidden, false, 'a custom image exists, so Remove shows');
    // the picker re-renders after a remove; the gate re-reads the button each tap
    await assertConfirmGate(c, () => btn().click(), { method: 'DELETE', url: '/api/me/sticker', expectTitle: /Remove your sticker image\?/ });
  } finally { await c.teardown(); }
});

test('Sticker Size / Tilt are ui.segmented controls: a pick merges just that field (the rest of the pref survives)', async () => {
  const c = mount({ 'GET /api/me/sticker': { ok: false } });
  try {
    c.w.localStorage.setItem('ft-sticker', JSON.stringify({ kind: 'emoji', value: 'x', size: 'default', tilt: 'right' }));
    await setup.renderStickerPicker();
    const segs = c.d.querySelectorAll('#sticker-picker .ui-segmented');
    assert.strictEqual(segs.length, 2, 'size + tilt');
    assert.strictEqual(c.d.querySelector('[data-sticker-tilt="right"]').getAttribute('aria-checked'), 'true', 'reflects the stored tilt');
    c.d.querySelector('[data-sticker-size="2x"]').click();
    await settle();
    assert.deepStrictEqual(JSON.parse(c.w.localStorage.getItem('ft-sticker')), { kind: 'emoji', value: 'x', size: '2x', tilt: 'right' });
    assert.strictEqual(c.d.querySelector('[data-sticker-size="2x"]').getAttribute('aria-checked'), 'true', 're-rendered on the pick');
  } finally { await c.teardown(); }
});

test('Clear the transcode cache: confirm first, then the same POST /api/cache/clear', async () => {
  const c = mount({ 'POST /api/cache/clear': { ok: true, json: { success: true } } });
  try {
    // main.js / player.js prefs this wiring reads in the shell (not under test here)
    const stubs = { homeFeedEnabled: () => false, modernModeEnabled: () => false, applyHomeFeedPref() {}, applyModernModePref() {},
      initDebugLifecycleFlag() {}, setPerPageSortEnabled() {}, isPerPageSortEnabled: () => false };
    const added = Object.keys(stubs).filter((k) => !(k in global));
    for (const k of added) global[k] = stubs[k];
    try { setup.wireStaticControls(c.ac.signal); } finally { for (const k of added) delete global[k]; }
    await assertConfirmGate(c, () => c.d.getElementById('clear-cache-btn').click(),
      { method: 'POST', url: '/api/cache/clear', expectTitle: /Clear the transcode cache\?/ });
  } finally { await c.teardown(); }
});

test('Restore a backup: confirm first, then the same POST /api/admin/restore with the file\'s JSON', async () => {
  const c = mount({ 'POST /api/admin/restore': { ok: true, json: {} } });
  try {
    setup.wireRestoreControls(c.ac.signal);
    const input = c.d.getElementById('restore-file-input');
    Object.defineProperty(input, 'files', { value: [{ text: () => Promise.resolve('{"version":1}') }], configurable: true });
    const hit = await assertConfirmGate(c, () => c.d.getElementById('restore-btn').click(),
      { method: 'POST', url: '/api/admin/restore', expectTitle: /Restore this backup\?/ });
    assert.deepStrictEqual(JSON.parse(hit.body), { version: 1 }, 'the same bundle body');
  } finally { await c.teardown(); }
});

test('Remove your profile photo: confirm first, then the same DELETE /api/me/avatar', async () => {
  const c = mount({ 'GET /api/auth/me': { ok: true, json: { user: { id: 'u1', username: 'amy', role: 'member', avatar: { present: true } } } } });
  try {
    await setup.initAccountSection(c.ac.signal);
    assert.strictEqual(c.d.getElementById('account-photo-remove').hidden, false);
    await assertConfirmGate(c, () => c.d.getElementById('account-photo-remove').click(),
      { method: 'DELETE', url: '/api/me/avatar', expectTitle: /Remove your profile photo\?/ });
  } finally { await c.teardown(); }
});

const USERS = [
  { id: 'u-amy', username: 'amy', role: 'admin' },
  { id: 'u-bob', username: 'bob', role: 'member', canManageSubscriptions: false, canModifyLibrary: false },
];
function usersRoutes() {
  return {
    'GET /api/auth/me': { ok: true, json: { user: { id: 'u-amy', username: 'amy', role: 'admin' } } },
    'GET /api/users': { ok: true, json: { users: USERS } },
  };
}
const userBtn = (c, username, action) => {
  const row = Array.from(c.d.querySelectorAll('#users-list .stable-row')).find((r) => r.textContent.includes(username));
  assert.ok(row, 'row for ' + username);
  return row.querySelector('[data-user-action="' + action + '"]');
};

test('Delete a user: a danger confirm naming the account first, then the same DELETE /api/users/:id', async () => {
  const c = mount(usersRoutes());
  try {
    await setup.initAccountSection(c.ac.signal);
    await settle();
    assert.strictEqual(userBtn(c, 'amy', 'delete'), null, 'you cannot delete yourself');
    assert.ok(userBtn(c, 'bob', 'delete').classList.contains('ui-btn--danger'), 'Delete wears the danger role');
    await assertConfirmGate(c, () => userBtn(c, 'bob', 'delete').click(),
      { method: 'DELETE', url: '/api/users/u-bob', expectTitle: /Delete bob\?/ });
  } finally { await c.teardown(); }
});

test('a confirm left open when the view is torn down closes, and a late OK sends nothing (the view signal rides every confirm)', async () => {
  const c = mount(usersRoutes());
  try {
    await setup.initAccountSection(c.ac.signal);
    await settle();
    userBtn(c, 'bob', 'delete').click(); // act() itself has no signal check: only the confirm's does
    await settle();
    const k = parts(openDialog(c.d));
    c.ac.abort(); // navigate away
    k.ok.click(); // a late OK on the dialog the navigation should have closed
    await settle(12);
    assert.strictEqual(sent(c.calls, 'DELETE', '/api/users/u-bob').length, 0, 'the teardown answered false');
    assert.ok(!k.dlg.classList.contains('is-open'), 'and the dialog is closing, not stranded over the next view');
  } finally { await c.teardown(); }
});

test('Reset password: a MASKED ui.prompt; the value is never in the DOM unmasked by default, and goes only to POST /api/users/:id/password', async () => {
  const c = mount(usersRoutes());
  const SECRET = 'correct-horse-battery';
  try {
    await setup.initAccountSection(c.ac.signal);
    await settle();
    // Dismissals send nothing.
    for (const how of DISMISSALS) {
      userBtn(c, 'bob', 'reset-password').click();
      await settle();
      const k = parts(openDialog(c.d));
      k.input.value = SECRET;
      answer(c.d, how);
      await settle();
      assert.strictEqual(sent(c.calls, 'POST', '/api/users/u-bob/password').length, 0, how + ' sends nothing');
      await drainSheets(c.w);
    }
    userBtn(c, 'bob', 'reset-password').click();
    await settle();
    const k = parts(openDialog(c.d));
    assert.match(k.title, /Reset bob's password/);
    assert.strictEqual(k.input.getAttribute('type'), 'password', 'masked by default');
    assert.strictEqual(c.d.activeElement, k.input, 'focus lands in the field');
    k.input.value = SECRET;
    // The typed value is a live property only: no attribute, no text node carries it.
    assert.strictEqual(k.input.getAttribute('value'), null);
    assert.ok(!c.d.documentElement.outerHTML.includes(SECRET), 'the secret is nowhere in the serialized DOM');
    assert.ok(!c.d.body.textContent.includes(SECRET));
    // The show toggle unmasks on request, and masks again.
    assert.ok(k.reveal, 'a show toggle');
    assert.strictEqual(k.reveal.getAttribute('aria-pressed'), 'false');
    k.reveal.click();
    assert.strictEqual(k.input.getAttribute('type'), 'text', 'Show reveals it');
    k.reveal.click();
    assert.strictEqual(k.input.getAttribute('type'), 'password', 'and masks again');
    answer(c.d, 'ok');
    await settle(12);
    const hits = sent(c.calls, 'POST', '/api/users/u-bob/password');
    assert.strictEqual(hits.length, 1, 'exactly one POST');
    assert.deepStrictEqual(JSON.parse(hits[0].body), { password: SECRET }, 'the same body as before');
    // Nothing else carried the secret anywhere.
    const leaks = c.calls.filter((x) => x !== hits[0] && String(x.body || '').includes(SECRET));
    assert.deepStrictEqual(leaks, [], 'the secret goes to that one request only');
  } finally { await c.teardown(); }
});

test('Remove a configured VIDEO folder: confirm first; the folder leaves the form only on yes (Save persists, as before)', async () => {
  const c = mount();
  try {
    setup.__setFolderStateForTests({ controller: c.ac, folders: ['/media/a', '/media/b'], settings: {} });
    setup.renderFolders();
    const btnFor = (p) => Array.from(c.d.querySelectorAll('#folders-builder-list .folder-remove-btn'))
      .find((b) => b.closest('.folder-item').querySelector('.folder-path-text').textContent === p);
    for (const how of DISMISSALS) {
      btnFor('/media/a').click();
      await settle();
      assert.match(parts(openDialog(c.d)).text, /\/media\/a/, 'the confirm names the folder');
      answer(c.d, how);
      await settle();
      assert.deepStrictEqual(setup.__getConfiguredFoldersForTests(), ['/media/a', '/media/b'], how + ' keeps it');
      await drainSheets(c.w);
    }
    btnFor('/media/a').click();
    await settle();
    answer(c.d, 'ok');
    await settle();
    assert.deepStrictEqual(setup.__getConfiguredFoldersForTests(), ['/media/b'], 'removed on yes');
    assert.deepStrictEqual(c.calls.filter((x) => x.method !== 'GET'), [], 'and nothing is persisted until Save');
    assert.ok(!c.d.querySelector('#folders-builder-list').textContent.includes('×'), 'the Remove control is a sprite icon, not a text glyph');
  } finally { await c.teardown(); }
});

test('Remove a BOOK folder: confirm first; OK drops exactly that folder (by path, even if the list re-rendered)', async () => {
  const c = mount({ 'GET /api/books/config': { ok: true, json: { folders: ['/b/one', '/b/two'] } } });
  try {
    await setup.loadBookConfig();
    const btns = () => c.d.querySelectorAll('#book-folders-builder-list .folder-remove-btn');
    assert.strictEqual(btns().length, 2);
    btns()[1].click();
    await settle();
    answer(c.d, 'cancel');
    await settle();
    assert.strictEqual(btns().length, 2, 'cancel keeps it');
    await drainSheets(c.w);
    btns()[1].click();
    await settle();
    answer(c.d, 'ok');
    await settle();
    const left = Array.from(c.d.querySelectorAll('#book-folders-builder-list .folder-path-text')).map((e) => e.textContent);
    assert.deepStrictEqual(left, ['/b/one']);
  } finally { await c.teardown(); }
});

test('the synthetic downloads folder never reaches the confirm (not removable)', async () => {
  const c = mount();
  try {
    setup.__setFolderStateForTests({ controller: c.ac, folders: ['/dl'], settings: {}, synthetic: ['/dl'] });
    setup.renderFolders();
    const b = c.d.querySelector('#folders-builder-list .folder-remove-btn');
    assert.strictEqual(b.disabled, true);
    b.dispatchEvent(new c.w.MouseEvent('click', { bubbles: true })); // a scripted click on the disabled button
    await settle();
    assert.strictEqual(c.d.querySelector('.ui-sheet--dialog'), null, 'no confirm for a folder that cannot go');
    assert.deepStrictEqual(setup.__getConfiguredFoldersForTests(), ['/dl']);
  } finally { await c.teardown(); }
});

test('the Settings table filter (buildSortableTable) is a ui-field input: 16px + the focus ring, not font: inherit', () => {
  const dom = new JSDOM('<div id="h"></div>');
  const host = dom.window.document.getElementById('h');
  SHELL_GLOBALS.buildSortableTable(host, { columns: [{ key: 'a', label: 'A', format: (r) => r.a }], rows: [{ a: 'x' }], filter: { text: (r) => r.a, placeholder: 'Filter' } });
  const input = host.querySelector('input.stable-filter');
  assert.ok(input, 'the filter renders');
  assert.ok(input.classList.contains('ui-field__input'), 'a ui-field input');
  const css = read('public/css/style.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(css, /\.stable-filter\s*\{/, 'no bespoke rule re-sizes it (the old one set font: inherit)');
  dom.window.close();
});

test('confirmDestructive answers false (and sends nothing) when ui.js is missing', async () => {
  const saved = global.window;
  global.window = {};
  try {
    assert.strictEqual(await setup.confirmDestructive({ title: 'x' }), false);
  } finally { global.window = saved; }
});

// ---- 3. the form contract ------------------------------------------------------------------

const viewRoot = (html) => {
  const d = new JSDOM(html).window.document;
  return d.querySelector('#view-root') || d.body;
};

// Sweep S3's merge follow-up: the resume-countdown switch left with the countdown (the modal it
// configured is gone, D8.2), so the Settings switches number 28.
test('Settings (F09): every checkbox is a ui-switch with role=switch; there are 30', () => {
  const root = viewRoot(SETUP_HTML);
  const boxes = root.querySelectorAll('input[type="checkbox"]');
  // v1.355 DELIBERATE bump (28 -> 30): Troubleshooting > Show rotate debug log (#debug-rotate-check) and
  // Mobile player > Keyboard search (experimental) (#pocket-kb-search-check).
  assert.strictEqual(boxes.length, 30, 'the same settings (no key dropped) minus the retired resume-countdown switch, plus the rotate log and keyboard search');
  for (const b of boxes) {
    assert.ok(b.classList.contains('ui-switch'), b.id + ' is a ui-switch');
    assert.strictEqual(b.getAttribute('role'), 'switch', b.id);
    assert.ok(b.id, 'every switch keeps its id (its wiring and persisted key)');
    const row = b.closest('.ui-row');
    assert.ok(row, b.id + ' sits in a ui-row');
    const label = root.querySelector('label[for="' + b.id + '"]');
    assert.ok(label && label.textContent.trim(), b.id + ' is named by its row title');
    assert.ok(row.closest('.ui-list--grouped'), b.id + ' is in a grouped list');
  }
});

test('Settings (F54, F36): no inline style anywhere in the sections; every field is a ui-field input or a ui-select', () => {
  const root = viewRoot(SETUP_HTML);
  assert.strictEqual(root.querySelectorAll('[style]').length, 0, 'no style="" in #view-root');
  for (const i of root.querySelectorAll('input[type="text"], input[type="number"], input[type="password"], input:not([type])')) {
    assert.ok(i.classList.contains('ui-field__input'), (i.id || i.outerHTML) + ' is a ui-field input (16px + the focus ring)');
  }
  for (const s of root.querySelectorAll('select')) {
    assert.ok(s.classList.contains('ui-select__native') && s.parentElement.classList.contains('ui-select'), s.id + ' is a ui-select');
    assert.ok(s.parentElement.querySelector('use[href="#i-expand_more"]'), s.id + ' carries the registry chevron');
  }
  for (const b of root.querySelectorAll('button')) {
    assert.ok(/\bui-(btn|switch|segmented__item)\b/.test(b.className), 'every button is a primitive: ' + b.outerHTML.slice(0, 80));
  }
  assert.strictEqual(root.querySelectorAll('.field-error, small, .form-group, .setup-check-label').length, 0, 'the legacy field dialects are gone');
});

test('Settings: every field error line starts hidden and setFieldError shows it by the hidden attribute (no inline display)', () => {
  const root = viewRoot(SETUP_HTML);
  const errs = root.querySelectorAll('.ui-field__error');
  assert.ok(errs.length >= 15, 'the error lines exist: ' + errs.length);
  for (const e of errs) assert.ok(e.hasAttribute('hidden'), e.id + ' starts hidden');
});

test('login / welcome: ui-field inputs (16px), a primary ui-btn submit, a ui-segmented era picker; no inline style', () => {
  for (const f of ['public/login.html', 'public/welcome.html']) {
    const html = read(f);
    const d = new JSDOM(html).window.document;
    assert.strictEqual(d.body.querySelectorAll('[style]').length, 0, f + ': no inline style');
    const inputs = d.querySelectorAll('form input');
    assert.ok(inputs.length >= 2);
    for (const i of inputs) {
      assert.ok(i.classList.contains('ui-field__input'), f + ' ' + i.id);
      assert.ok(d.querySelector('label.ui-field__label[for="' + i.id + '"]'), f + ' ' + i.id + ' labelled');
    }
    const submit = d.querySelector('form button[type="submit"]');
    assert.match(submit.className, /\bui-btn ui-btn--primary ui-btn--lg\b/, f + ' submit');
    const seg = d.querySelector('.login-era-switch .ui-segmented[role="radiogroup"]');
    assert.ok(seg, f + ': the era picker is a radiogroup');
    assert.deepStrictEqual(Array.from(seg.querySelectorAll('[role="radio"]')).map((b) => b.getAttribute('data-era')), ['2005', '2009', '2014', '2021']);
  }
});

test('login.js: the era picker becomes a live ui.segmented (current era checked; a pick applies the theme)', async () => {
  const dom = new JSDOM(read('public/login.html'), { url: 'http://localhost/login', runScripts: 'outside-only' });
  const w = dom.window;
  w.document.documentElement.setAttribute('data-theme', '2009');
  w.fetch = () => Promise.reject(new Error('offline'));
  const applied = [];
  w.applyTheme = (era, mode) => { applied.push([era, mode]); w.document.documentElement.setAttribute('data-theme', era); };
  w.eval(read('public/js/ui.js'));
  w.eval(read('public/js/login.js'));
  const seg = w.document.querySelector('.login-era-switch .ui-segmented');
  const checked = seg.querySelector('[aria-checked="true"]');
  assert.strictEqual(checked.getAttribute('data-era'), '2009', 'reflects the current era');
  assert.strictEqual(checked.getAttribute('tabindex'), '0', 'roving focus on the checked item');
  seg.querySelector('[data-era="2021"]').click();
  assert.deepStrictEqual(applied.map((a) => a[0]), ['2021'], 'a pick applies the era');
  assert.strictEqual(seg.querySelector('[aria-checked="true"]').getAttribute('data-era'), '2021');
  w.close();
});

test('F55 census: no window.alert / confirm / prompt is left in the swept scripts', () => {
  for (const f of ['public/js/setup.js', 'public/js/login.js', 'public/js/main.js', 'public/js/common.js']) {
    const src = read(f).replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
    assert.doesNotMatch(src, /\bwindow\.(alert|confirm|prompt)\s*\(/, f);
    assert.doesNotMatch(src, /(^|[^.\w])(alert|confirm|prompt)\s*\(/m, f + ': no bare alert/confirm/prompt call');
  }
});
