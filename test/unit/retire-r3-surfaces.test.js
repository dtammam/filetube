'use strict';

// [UNIT] Step 7 retire, territory R3 (Settings, Stats, TV): the hand-made controls moved onto
// the primitives. Each behaviour below is driven through the real builders in jsdom (with the
// real ui.js where a surface uses it), so reverting a conversion turns its test red:
//
//   1. TV: a show card, a Continue card and an episode row are LINKS (a real href, so a
//      modified click opens a new tab); a plain click is handled in the view and CLAIMED
//      (preventDefault + stopPropagation), so the router's document link handler never
//      navigates it a second time; the back control and Scan are ui-btns with registry glyphs.
//   2. Settings Appearance: the era / icon-set / Music-skin pickers are radio rows (aria-checked
//      + ONE trailing check), a pick moves the check; the sticker options are ui-chip filters.
//   3. Settings editors: the Library-icon and bottom-bar editors are ui-rows of a grouped
//      ui-list; the three reorder lists wear ui-reorder with the ui-reorder__handle grip; only
//      the VIDEO folder cards reorder (Books / Music / Shows cards do not wear ui-reorder).
//   4. Hidden (feed): a row is a ui-row with a ui-thumb and Restore in the action column.
//   5. Users: the capability tags are ui-chip meta; the table's sort headers are ui-btns.
//   6. Stats: no JS-written styles remain (About / Under the hood lines are the .stats-kv family).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const REPO = path.join(__dirname, '..', '..');
// required with NO global document, so common.js's boot is skipped (it would wire timers that
// outlive a test's jsdom window)
const common = require('../../public/js/common.js');
const setup = require('../../public/js/setup.js');
const stats = require('../../public/js/stats.js');
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');
const settle = () => new Promise((r) => setImmediate(r));
async function settleN(n) { for (let i = 0; i < (n || 8); i++) await settle(); }

// ---- 1. TV -----------------------------------------------------------------

const TV_HTML = `<body><div id="view-root" data-view="tv">
  <div id="tv-status" role="status" hidden></div>
  <div id="tv-crumb" hidden></div>
  <div id="tv-heading"></div>
  <div id="tv-empty" hidden></div>
  <div id="tv-content"></div>
  <button id="tv-scan-btn" type="button">Scan</button>
</div></body>`;

async function bootTv(run) {
  const dom = new JSDOM(TV_HTML, { url: 'http://localhost/tv' });
  const saved = { window: global.window, document: global.document, localStorage: global.localStorage, fetch: global.fetch, AbortController: global.AbortController };
  global.window = dom.window; global.document = dom.window.document;
  global.localStorage = dom.window.localStorage; global.AbortController = dom.window.AbortController;
  global.fetch = (url) => {
    const u = String(url);
    if (/\/api\/tv\/continue$/.test(u)) return Promise.resolve({ ok: true, json: async () => ({ episodes: [{ id: 'ep9', showId: 'sh1', showName: 'Show One', seasonNum: 1, episodeNum: 2, title: 'Two', durationSec: 100, position: 50 }] }) });
    if (/\/api\/tv\/sh1$/.test(u)) return Promise.resolve({ ok: true, json: async () => ({ id: 'sh1', name: 'Show One', seasons: [{ seasonNum: 1, label: 'Season 1', episodes: [{ id: 'ep1', seasonNum: 1, episodeNum: 1, title: 'Pilot', durationSec: 3725 }] }] }) });
    if (/\/api\/tv$/.test(u)) return Promise.resolve({ ok: true, json: async () => ({ shows: [{ id: 'sh1', name: 'Show One', seasonCount: 1, episodeCount: 1 }] }) });
    return Promise.resolve({ ok: true, json: async () => ({}) });
  };
  const nav = []; const pushes = []; let mod = null;
  dom.window.FileTube = {
    registerView: (n, m) => { mod = m; },
    pushViewState: (vs) => { pushes.push(vs); dom.window.history.pushState({ viewState: vs }, '', '/tv'); },
    navigate: (u) => { nav.push(u); },
    shimmerArt: () => {},
  };
  // the router's document-level link handler, as a spy: a claimed click never reaches it
  const docClicks = [];
  dom.window.document.addEventListener('click', (e) => { docClicks.push({ href: e.target.closest && e.target.closest('a[href]') ? e.target.closest('a[href]').getAttribute('href') : null, prevented: e.defaultPrevented }); });
  const resolved = require.resolve('../../public/js/tv.js');
  try {
    delete require.cache[resolved];
    require(resolved);
    mod.init();
    await settleN();
    await run(dom, { nav, pushes, docClicks, content: () => dom.window.document.getElementById('tv-content') });
    mod.destroy();
  } finally {
    delete require.cache[resolved];
    Object.assign(global, saved);
    dom.window.close();
  }
}
const mouse = (dom, el, init) => { const e = new dom.window.MouseEvent('click', Object.assign({ bubbles: true, cancelable: true }, init || {})); el.dispatchEvent(e); return e; };

test('TV: the show card and the Continue card are links with real hrefs (a modified click is the browser\'s: not claimed, nothing opened in place)', async () => {
  await bootTv(async (dom, t) => {
    const card = t.content().querySelector('a.show-card');
    assert.ok(card, 'the show card is an <a>');
    assert.strictEqual(card.getAttribute('href'), '/tv?show=sh1', 'its href is the show deep link the view init reads');
    const cont = t.content().querySelector('a.tv-continue-card');
    assert.ok(cont && cont.getAttribute('href') === '/watch.html?tv=ep9', 'the Continue card links to the episode');
    assert.strictEqual(t.content().querySelectorAll('button.show-card, button.tv-continue-card').length, 0, 'no bespoke card buttons');
    for (const mod of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { button: 1 }]) {
      const e = mouse(dom, card, mod);
      assert.strictEqual(e.defaultPrevented, false, JSON.stringify(mod) + ': the browser keeps the click (open in a new tab)');
    }
    await settleN();
    assert.strictEqual(t.pushes.length, 0, 'a modified click opened nothing in place');
    assert.strictEqual(t.docClicks.length, 4, 'and it reached the document (the router ignores a modified click itself)');
  });
});

test('TV: a plain click on a show card opens it IN PLACE and is claimed - the router\'s document handler never sees it', async () => {
  await bootTv(async (dom, t) => {
    const e = mouse(dom, t.content().querySelector('a.show-card'));
    assert.strictEqual(e.defaultPrevented, true, 'claimed');
    await settleN();
    assert.strictEqual(t.docClicks.length, 0, 'never reached the document handler (no second navigation)');
    assert.deepStrictEqual(t.pushes, [{ t: 'show', id: 'sh1' }], 'the v1.218 back level');
    // the detail: a ui-list of whole-row episode links, and a ui-btn back control
    const row = t.content().querySelector('.tv-episode-list a.ui-row.tv-episode');
    assert.ok(row, 'an episode row is an a.ui-row in the season ui-list');
    assert.ok(row.closest('.ui-list').getAttribute('role') === 'list' && row.getAttribute('role') === 'listitem');
    assert.strictEqual(row.getAttribute('href'), '/watch.html?tv=ep1');
    assert.strictEqual(row.querySelector('.ui-row__overline').textContent, 'S01E01', 'the code is the overline');
    assert.strictEqual(row.querySelector('.ui-row__title').textContent, 'Pilot');
    assert.strictEqual(row.querySelector('.ui-row__aside').textContent, '1:02:05', 'the length is the aside');
    const back = dom.window.document.getElementById('tv-back');
    assert.ok(back.classList.contains('ui-btn') && back.classList.contains('ui-btn--plain'), 'the back control is a plain ui-btn');
    assert.strictEqual(back.querySelector('use').getAttribute('href'), '#i-arrow_back', 'the registry arrow (no text arrow glyph)');
    assert.strictEqual(back.textContent, 'All shows');
    // a plain click on the episode row: claimed, and the view navigates once
    const e2 = mouse(dom, row);
    assert.strictEqual(e2.defaultPrevented, true);
    assert.deepStrictEqual(t.nav, ['/watch.html?tv=ep1'], 'one navigation, by the view');
    assert.strictEqual(t.docClicks.length, 0, 'the router handler never saw it');
  });
});

test('TV: a plain click on a Continue card opens its episode once, claimed', async () => {
  await bootTv(async (dom, t) => {
    const e = mouse(dom, t.content().querySelector('a.tv-continue-card'));
    assert.strictEqual(e.defaultPrevented, true);
    assert.deepStrictEqual(t.nav, ['/watch.html?tv=ep9']);
    assert.strictEqual(t.docClicks.length, 0);
  });
});

test('TV: the Scan control is a tonal ui-btn with the registry refresh glyph', () => {
  const html = read('public/tv.html');
  const m = /<button class="([^"]*)" id="tv-scan-btn"[^>]*>([\s\S]*?)<\/button>/.exec(html);
  assert.ok(m, 'the scan button');
  assert.match(m[1], /\bui-btn\b.*\bui-btn--tonal\b/);
  assert.match(m[2], /<use href="#i-refresh"\/>/);
  assert.doesNotMatch(m[2], /icon-refresh/, 'no pre-registry icon class');
});

// ---- 2. Settings Appearance ------------------------------------------------

function settingsDom(body, extra) {
  const dom = new JSDOM(`<!DOCTYPE html><html data-theme="2014"><body>${body}</body></html>`, { url: 'http://localhost/setup.html' });
  global.window = dom.window; global.document = dom.window.document; global.localStorage = dom.window.localStorage;
  Object.assign(dom.window, extra || {});
  return dom;
}
function clearGlobals() { delete global.window; delete global.document; delete global.localStorage; delete global.fetch; }
// setup.js's picker builders, run for real in a vm context over the page window (the pattern of
// icon-set-migration.test.js), with THEME_REGISTRY / setTheme from common.js.
const vm = require('node:vm');
const SETUP_SRC = read('public/js/setup.js');
function extract(re, what) { const m = re.exec(SETUP_SRC); assert.ok(m, what + ' is in setup.js'); return m[0]; }

test('Settings: the era picker is a radiogroup of radio rows - ONE aria-checked row with ONE trailing check; a pick moves it', () => {
  const dom = settingsDom('<div id="theme-picker" role="radiogroup"></div>');
  try {
    const w = dom.window;
      const picks = [];
    w.THEME_REGISTRY = common.THEME_REGISTRY;
    w.setTheme = (era) => { picks.push(era); w.document.documentElement.setAttribute('data-theme', era); };
    vm.createContext(w);
    const src = 'var controller = new AbortController();'
      + extract(/\nconst CHOICE_CHECK_ICON = [^\n]*\n/, 'the check glyph')
      + extract(/\nfunction choiceRowHtml\(o\) \{[\s\S]*?\n\}\n/, 'choiceRowHtml')
      + extract(/\nfunction renderThemePicker\(\) \{[\s\S]*?\n\}\n/, 'renderThemePicker')
      + ';renderThemePicker();';
    vm.runInContext(src, w);
    const rows = () => [...w.document.querySelectorAll('#theme-picker button.ui-row')];
    assert.strictEqual(rows().length, common.THEME_REGISTRY.length, 'one row per era');
    const state = () => rows().map((r) => [r.dataset.era, r.getAttribute('role'), r.getAttribute('aria-checked'), !!r.querySelector('.ui-row__actions use[href="#i-check"]')]);
    for (const [era, role, checked, check] of state()) {
      assert.strictEqual(role, 'radio');
      assert.strictEqual(checked, era === '2014' ? 'true' : 'false', era + ' checked iff it is the era');
      assert.strictEqual(check, era === '2014', era + ' carries the trailing check iff checked');
    }
    assert.ok(rows().every((r) => r.querySelector('.ui-row__media .theme-swatch')), 'the era swatch sits in the media column');
    assert.strictEqual(w.document.querySelectorAll('#theme-picker .theme-card, #theme-picker .active').length, 0, 'no card / red-border state');
    rows().find((r) => r.dataset.era === '2005').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    assert.deepStrictEqual(picks, ['2005'], 'the pick applies the era (setTheme, no Save)');
    assert.deepStrictEqual(state().filter((s) => s[2] === 'true').map((s) => s[0]), ['2005'], 'the check moved');
    assert.strictEqual(state().filter((s) => s[3]).length, 1, 'still exactly one check');
  } finally { clearGlobals(); }
});

test('Settings: the sticker options are ui-chip filters; the stored choice is the pressed chip, and a pick moves it', async () => {
  const dom = settingsDom('<div id="sticker-picker"></div><input type="file" id="sticker-file-input" hidden>');
  const w = dom.window;
  global.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
  delete require.cache[require.resolve('../../public/js/ui.js')];
  require('../../public/js/ui.js');
  try {
    w.localStorage.setItem('ft-sticker', JSON.stringify({ kind: 'emoji', value: '🎧' }));
    setup.__setFolderStateForTests({ controller: new w.AbortController(), folders: [], settings: {} });
    await setup.renderStickerPicker();
    const chips = () => [...w.document.querySelectorAll('#sticker-picker .sticker-cards > button')];
    assert.ok(chips().length >= 9, 'the logo + 8 emoji presets');
    for (const c of chips()) assert.ok(c.classList.contains('ui-chip') && c.classList.contains('ui-chip--filter'), 'every option is a filter chip');
    const pressed = () => chips().filter((c) => c.getAttribute('aria-pressed') === 'true').map((c) => c.dataset.stickerEmoji || c.dataset.stickerKind);
    assert.deepStrictEqual(pressed(), ['🎧'], 'the stored emoji is the one pressed chip');
    chips().find((c) => c.dataset.stickerKind === 'logo').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await settleN();
    assert.deepStrictEqual(pressed(), ['logo'], 'a pick re-renders with the new chip pressed');
    assert.strictEqual(JSON.parse(w.localStorage.getItem('ft-sticker')).kind, 'logo', 'and persists it');
    assert.strictEqual(w.document.querySelectorAll('#sticker-picker .theme-card').length, 0, 'no bespoke cards');
  } finally { setup.__setFolderStateForTests({ controller: null }); clearGlobals(); }
});

// ---- 3. Settings editors ---------------------------------------------------

test('Settings: the Library-icon editor is ui-rows of its grouped ui-list (the select in the aside column)', () => {
  const dom = settingsDom('<div id="library-glyph-editor" class="ui-list ui-list--grouped" role="list"></div>');
  const pool = require('../../public/js/glyph-pool.js');
  global.GLYPH_POOL = pool.GLYPH_POOL; global.DEFAULT_FOLDER_GLYPH = pool.DEFAULT_FOLDER_GLYPH; global.LIBRARY_GLYPH_SLOTS = pool.LIBRARY_GLYPH_SLOTS;
  try {
    const host = dom.window.document.getElementById('library-glyph-editor');
    setup.drawLibraryGlyphEditor(host, {}, new dom.window.AbortController().signal);
    const rows = [...host.children];
    assert.ok(rows.length >= 5, 'one row per Library entry');
    for (const r of rows) {
      assert.ok(r.classList.contains('ui-row') && r.getAttribute('role') === 'listitem', 'a ui-row list item');
      assert.deepStrictEqual([...r.children].map((c) => c.className.split(' ')[0]), ['ui-row__lead', 'ui-row__media', 'ui-row__body', 'ui-row__aside', 'ui-row__actions'], 'every reserved slot, in order');
      assert.ok(r.querySelector('.ui-row__body > .ui-row__title.library-glyph-label'), 'the entry name is the title');
      assert.ok(r.querySelector('.ui-row__aside > .ui-select > select.ui-select__native'), 'the select trails in the aside');
    }
  } finally { clearGlobals(); delete global.GLYPH_POOL; delete global.DEFAULT_FOLDER_GLYPH; delete global.LIBRARY_GLYPH_SLOTS; }
});

test('Settings: a bottom bar editor item is a ui-row wearing ui-reorder - the grip in the media column, the name the title, the switch trailing', () => {
  const dom = settingsDom('<div id="bottombar-editor" class="ui-list ui-list--grouped" role="list"></div>');
  try {
    const w = dom.window;
    w.FileTube = {
      BOTTOM_NAV_OPTIONAL: common.BOTTOM_NAV_OPTIONAL, resolveBottomNavLayout: common.resolveBottomNavLayout,
      readBottomNavConfig: common.readBottomNavConfig, writeBottomNavConfig: common.writeBottomNavConfig,
      applyBottomNavCustomization: () => {}, wireReorderable: common.wireReorderable,
    };
    setup.renderBottomBarEditor(new w.AbortController().signal);
    const rows = [...w.document.querySelectorAll('#bottombar-editor > *')];
    assert.strictEqual(rows.length, common.BOTTOM_NAV_OPTIONAL.length, 'one item per roster id');
    for (const r of rows) {
      assert.ok(['ui-row', 'ui-row--default', 'ui-reorder'].every((c) => r.classList.contains(c)) && r.getAttribute('role') === 'listitem', r.className);
      assert.ok(r.querySelector(':scope > .ui-row__media > .ui-reorder__handle'), 'the grip in the media column');
      assert.ok(r.querySelector(':scope > .ui-row__body > .ui-row__title.bottombar-editor-label'), 'the name is the title');
      assert.ok(r.querySelector(':scope > .ui-row__actions > input.ui-switch[role="switch"]'), 'the switch trails');
      const handle = r.querySelector('.ui-reorder__handle');
      assert.strictEqual(handle.getAttribute('tabindex'), '0', 'wireReorderable took the grip as the keyboard control');
    }
  } finally { clearGlobals(); }
});

test('setup.html: the editor and picker hosts are ui-lists (grouped), the pickers radiogroups; no bespoke host class is left', () => {
  const html = read('public/setup.html');
  const host = (id) => { const m = new RegExp(`<div [^>]*id="${id}"[^>]*>`).exec(html) || new RegExp(`<div id="${id}"[^>]*>`).exec(html); assert.ok(m, id); return m[0]; };
  for (const id of ['theme-picker', 'icon-picker', 'music-skin-picker']) {
    assert.match(host(id), /class="ui-list [^"]*ui-list--grouped[^"]*setup-choice-list"/, id + ' is a grouped choice list');
    assert.match(host(id), /role="radiogroup"/, id + ' is a radiogroup');
  }
  assert.match(host('library-glyph-editor'), /class="ui-list [^"]*ui-list--grouped[^"]*library-glyph-editor" role="list"/);
  assert.match(host('bottombar-editor'), /class="ui-list [^"]*ui-list--grouped[^"]*bottombar-editor" role="list"/);
  assert.match(host('feedhidden-list'), /class="ui-list ui-list--media ui-list--media-thumb ui-list--actions-2 [^"]*ui-list--grouped feed-hidden-list"/);
  assert.doesNotMatch(html, /class="(theme-picker|card-corner-editor|account-row|feed-hidden-list)\b/, 'no retired host class');
});

test('Settings: only the VIDEO folder cards reorder - Books / Music / Shows cards are .folder-item without ui-reorder (no grab cursor on a list that cannot move)', () => {
  // renderFolders (video) wires wireReorderable; the three unordered-set builders do not
  const src = SETUP_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  assert.strictEqual((src.match(/row\.className = 'folder-item ui-reorder';/g) || []).length, 1, 'one reorderable folder list');
  assert.strictEqual((src.match(/row\.className = 'folder-item';/g) || []).length, 3, 'three plain folder cards (books, music, shows)');
  assert.doesNotMatch(src, /folder-item-row|drag-handle/, 'the retired row / grip classes are gone');
  const css = read('public/css/style.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const card = /\n\.folder-item \{([^}]*)\}/.exec(css);
  assert.ok(card && !/cursor/.test(card[1]), 'the card rule sets no cursor (ui-reorder gives the video cards theirs)');
});

// ---- 4. Hidden (feed) ------------------------------------------------------

test('Hidden: a row is a ui-row - a ui-thumb in the media column, the title / channel as title / meta, Restore trailing', () => {
  const dom = settingsDom('<div id="l"></div>');
  try {
    const l = dom.window.document.getElementById('l');
    l.innerHTML = setup.buildFeedHiddenRowHtml({ id: 'v1', title: 'A video', channelName: 'Chan' });
    const row = l.firstElementChild;
    assert.ok(row.classList.contains('ui-row') && row.getAttribute('role') === 'listitem');
    assert.ok(row.querySelector('.ui-row__media > .ui-thumb.ui-thumb--row > img.ui-thumb__img[src="/thumbnail/v1"]'), 'the thumbnail is a ui-thumb');
    assert.strictEqual(row.querySelector('.ui-row__title').textContent, 'A video');
    assert.strictEqual(row.querySelector('.ui-row__meta').textContent, 'Chan');
    const restore = row.querySelector('.ui-row__actions > button.feedhidden-restore-btn');
    assert.ok(restore && restore.classList.contains('ui-btn'), 'Restore is a ui-btn in the action column');
  } finally { clearGlobals(); }
});

// ---- 5. Users --------------------------------------------------------------

test('Users: the capability tags are ui-chip meta (non-interactive text), beside the role word', () => {
  settingsDom('');
  try {
    const cell = setup.buildUserRoleCell({ role: 'member', canManageSubscriptions: true, canModifyLibrary: true });
    assert.strictEqual(cell.className, 'users-role-cell');
    const chips = [...cell.querySelectorAll('.ui-chip')];
    assert.deepStrictEqual(chips.map((c) => c.textContent), ['subscriptions', 'can edit']);
    for (const c of chips) assert.ok(c.classList.contains('ui-chip--meta') && c.tagName === 'SPAN', 'a meta chip span, never a button');
    assert.strictEqual(cell.querySelectorAll('.users-cap-badge').length, 0);
  } finally { clearGlobals(); }
});

test('the sortable table: a sort header is a plain sm ui-btn; a body row is styled through its table role (no .stable-row rule)', () => {
  const dom = settingsDom('<div id="h"></div>');
  try {
    common.buildSortableTable(dom.window.document.getElementById('h'), {
      columns: [{ key: 'n', label: 'Name' }, { key: 'c', label: 'Count', numeric: true, align: 'end' }],
      rows: [{ n: 'a', c: 1 }, { n: 'b', c: 2 }],
    });
    const ths = [...dom.window.document.querySelectorAll('.stable-head > button')];
    assert.strictEqual(ths.length, 2);
    for (const th of ths) assert.ok(['ui-btn', 'ui-btn--plain', 'ui-btn--sm', 'stable-th'].every((c) => th.classList.contains(c)), th.className);
    assert.strictEqual(dom.window.document.querySelectorAll('.stable-body > [role="row"]').length, 2, 'rows carry the role the CSS keys on');
  } finally { clearGlobals(); }
  const css = read('public/css/style.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(css, /\.stable-row\b/, 'no rule names .stable-row (a JS / test hook only)');
  assert.match(css, /\n\.stable-body > \[role="row"\] \{[^}]*border-bottom:\s*var\(--hairline\) solid var\(--separator\)/, 'the body row rule');
  assert.match(css, /\.stable-th\[aria-sort="ascending"\]::before,\s*\n\.stable-th\[aria-sort="descending"\]::before \{ order: 1;/, 'the caret is ::before ordered after the label (::after is the primitive tint)');
  assert.doesNotMatch(css, /\.stable-th[^{]*::after/, 'nothing overrides the primitive tint layer');
});

// ---- 6. Stats --------------------------------------------------------------

test('Stats: no JS-written styles remain (the About / Under the hood lines and links are the .stats-kv family)', () => {
  const src = read('public/js/stats.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  assert.doesNotMatch(src, /\.style\.|cssText|setProperty\(/, 'no inline style write in stats.js');
  const dom = settingsDom('<div id="a"></div>');
  try {
    stats.renderAbout(dom.window.document.getElementById('a'), { version: '1.2.3', repoUrl: 'https://example.invalid/r' });
    const line = dom.window.document.querySelector('#a .stats-kv');
    assert.ok(line && line.querySelector('.stats-kv__label').textContent === 'FileTube');
    assert.ok(line.querySelector('.stats-kv__value a.stats-link'), 'the version links out, styled by class');
    assert.strictEqual(dom.window.document.querySelectorAll('#a [style]').length, 0, 'no style attribute rendered');
  } finally { clearGlobals(); }
});

// ---- the layout the primitives cannot know (each list's declared columns) --------------
// The row grid is ui.css's; what each list DECLARES is style.css's. Only a probe sees these
// values, so each is pinned by value (LESSONS 6: lock each CSS rule by value).
test('the R3 lists declare their columns in style.css (by value), and the retired bespoke families are gone', () => {
  const { cssRules } = require('../helpers/stylesheets');
  const rules = cssRules(read('public/css/style.css'));
  const body = (sel) => {
    const found = rules.filter((r) => r.sel.split(',').map((x) => x.trim().replace(/\s+/g, ' ')).includes(sel));
    assert.strictEqual(found.length, 1, 'exactly one ' + sel + ' rule');
    return found[0].body;
  };
  assert.match(body('.library-glyph-editor'), /--row-aside:\s*50%/, 'the Library entry select takes half the row');
  assert.match(body('.library-glyph-editor .ui-row__aside > .ui-select'), /flex:\s*1 1 auto/);
  assert.match(body('.bottombar-editor'), /--media-w:\s*var\(--space-8\)/, 'the grip column');
  assert.match(body('.tv-episode-list'), /--row-aside:\s*calc\(var\(--hit\) \+ var\(--space-4\)\)/, 'the length column fits H:MM:SS');
  assert.match(body('.setup-choice-list .ui-row__meta'), /white-space:\s*normal/, 'a picker blurb wraps');
  assert.match(body('.dup-expand[aria-expanded="true"] .ui-icon'), /transform:\s*rotate\(180deg\)/, 'the open toggle turns its chevron');
  assert.match(body('.trash-title-cell > .ui-thumb'), /width:\s*var\(--av-2xl\)/, 'the trash thumbnail width');
  assert.match(body('.feed-hidden-list'), /--media-w:\s*var\(--av-2xl\)/, 'the Hidden list keeps a phone-sized thumbnail column');
  assert.match(body('.tv-continue-strip'), /grid-auto-columns:\s*minmax\(140px, 180px\);\s*justify-content:\s*start/, 'a lone Continue card is not stretched');
  assert.match(body('.theme-swatch'), /outline:\s*var\(--hairline\) solid var\(--separator\)/, 'the swatch keeps its edge on a white group');
  const all = rules.map((r) => r.sel).join('\n');
  for (const gone of ['.theme-card.active', '.remove-folder-btn', '.drag-handle', '.folder-item-row', '.bottombar-editor-row', '.transcript-ai-prompt-row',
    '.card-corner-editor', '.stable-delete-btn', '.stable-expand-btn', '.feed-hidden-row', '.trash-row', '.users-row', '.users-cap-badge',
    '.tv-episode-row', '.tv-back', '.setup-select', '.form-group', '.account-row', '.action-bar-cell', '.sticker-emoji-row', '.sticker-opt-row']) {
    assert.ok(!new RegExp(gone.replace(/[.[\]]/g, (c) => '\\' + c) + '(?![\\w-])').test(all), gone + ' is retired');
  }
});
