'use strict';

// [UNIT] v1.75 T2 - the bottom bar's ORDER AUTHORITY, bound where it is used.
//
// Three things this wave changed can only be proved at the DOM/asset layer,
// never by a resolver test:
//
//  1. The v1.39.2 CSS `order:` ladder is GONE. It pinned seven data-nav ids to
//     fixed flex positions and left every id added since (history, podcasts,
//     music, books, downloads) at the default `order: 0`, i.e. LEFT of Home -
//     Dean's reported symptom - while also making the v1.44 reorder feature
//     unable to move any of those seven. CSS `order` beats DOM order outright,
//     so a green resolver test proved nothing about the rendered bar.
//  2. Every shell that carries the bar carries the new Liked item (the
//     enumerate-by-grep rule: the roster is derived from the files here, never
//     from a list typed into this test).
//  3. The Settings editor lists rows in the SAME sequence the bar renders and
//     refuses the un-check that would empty the bar.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const common = require('../../public/js/common.js');
const { resolveBottomNavLayout, applyBottomNavCustomization, BOTTOM_NAV_OPTIONAL, BOTTOM_NAV_DEFAULT_HIDDEN } = common;

const PUBLIC_DIR = path.join(__dirname, '../../public');
const CSS = fs.readFileSync(path.join(PUBLIC_DIR, 'css/style.css'), 'utf8');

// The shells are DERIVED, never listed: any .html that mounts the bar is in.
const SHELLS = fs.readdirSync(PUBLIC_DIR)
  .filter((f) => f.endsWith('.html'))
  .filter((f) => fs.readFileSync(path.join(PUBLIC_DIR, f), 'utf8').includes('class="bottom-nav'));

// ---- 1. the CSS ladder must never come back --------------------------------

test('v1.75: NO css rule assigns flex `order` to a bottom-nav item - the resolver is the sole authority', () => {
  // Comments are stripped first: this file documents the deleted ladder in
  // prose, and a source lock that matches its own explanation is theatre (the
  // v1.50 source-lock lesson).
  const code = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  const offenders = code
    .split('\n')
    .map((line, i) => [i + 1, line])
    .filter(([, line]) => /order\s*:/.test(line) && /bottom-nav/.test(line));
  assert.deepEqual(offenders, [], `flex order on the bottom bar is the v1.39.2 defect: ${JSON.stringify(offenders)}`);
  // And specifically the seven ids the old ladder named, in any selector shape.
  for (const id of ['home', 'playlists', 'oneoff-download', 'subscriptions', 'books', 'theme', 'settings']) {
    const re = new RegExp(`#bottom-nav\\s*\\[data-nav="${id}"\\][^}]*order\\s*:`);
    assert.ok(!re.test(code), `the ladder rule for '${id}' is back`);
  }
});

// ---- 2. the nine-shell enumeration -----------------------------------------

test('v1.75: EVERY shell that carries the bar carries the Liked item, hidden until Settings opts in', () => {
  assert.ok(SHELLS.length >= 9, `expected the full shell roster, found ${SHELLS.length}: ${SHELLS}`);
  for (const f of SHELLS) {
    const html = fs.readFileSync(path.join(PUBLIC_DIR, f), 'utf8');
    assert.match(
      html,
      /<a href="\/\?liked=1" class="bottom-nav-item" data-nav="liked" hidden>/,
      `${f}: missing (or un-hidden) liked bottom-nav item`,
    );
    // Exactly one, and it sits directly after Home - the DOM order IS the
    // default order now that no CSS overrides it.
    assert.equal((html.match(/data-nav="liked"/g) || []).length, 1, `${f}: duplicate liked item`);
    assert.ok(
      html.indexOf('data-nav="liked"') > html.indexOf('data-nav="home"'),
      `${f}: liked must follow home in the DOM`,
    );
    const between = html.slice(html.indexOf('data-nav="home"'), html.indexOf('data-nav="liked"'));
    assert.ok(!/data-nav="/.test(between.slice(('data-nav="home"').length)), `${f}: liked is not adjacent to home`);
  }
});

test('v1.75: the Liked item uses the SAME glyph as the sidebar Liked entry, and no raw emoji codepoint', () => {
  // common.js's applyLikedSidebarEntry mints `icon-star`; the two entries are
  // the same destination, so they are the same mark. icon-star is also the one
  // glyph deliberately identical across every data-icons set (style.css AC8),
  // which is why no new icon-set CSS is needed for any of the four sets.
  const commonSrc = fs.readFileSync(path.join(PUBLIC_DIR, 'js/common.js'), 'utf8');
  assert.ok(commonSrc.includes("icon.className = 'icon-star'"), 'the sidebar Liked entry still mints icon-star');
  for (const f of SHELLS) {
    const html = fs.readFileSync(path.join(PUBLIC_DIR, f), 'utf8');
    const item = html.slice(html.indexOf('data-nav="liked"'));
    assert.match(item.slice(0, 200), /<i class="icon-star"><\/i>/, `${f}: liked must render the icon-star glyph`);
    // The v1.38 lesson: glyphs come from CSS/icon assets, never a codepoint
    // typed into markup.
    assert.ok(!/[☀-➿\u{1F300}-\u{1F9FF}]/u.test(item.slice(0, 200)), `${f}: raw emoji codepoint in markup`);
  }
});

// ---- 3. the rendered bar (the decision's USE) ------------------------------

// A shell's bar, in DOM order, exactly as the nine .html files spell it.
const SHELL_ITEMS = [
  ['home', '/'], ['liked', '/?liked=1'], ['playlists', null], ['history', '/history'],
  ['podcasts', '/podcasts'], ['music', '/music'], ['books', '/books'], ['downloads', '/'],
  ['theme', null], ['settings', '/setup.html'],
];

function withBar(config, fn) {
  const html = '<body><nav class="bottom-nav" id="bottom-nav">' + SHELL_ITEMS
    .map(([id, href]) => (href
      ? `<a href="${href}" class="bottom-nav-item" data-nav="${id}"></a>`
      : `<button type="button" class="bottom-nav-item" data-nav="${id}"></button>`))
    .join('') + '</nav></body>';
  const dom = new JSDOM(html, { url: 'http://localhost/' });
  global.document = dom.window.document;
  global.window = dom.window;
  global.localStorage = dom.window.localStorage;
  if (config !== null) dom.window.localStorage.setItem('ft-bottomnav', JSON.stringify(config));
  try {
    return fn(dom);
  } finally {
    delete global.document;
    delete global.window;
    delete global.localStorage;
    dom.window.close();
  }
}

const renderedOrder = () => Array.prototype.slice
  .call(global.document.querySelectorAll('#bottom-nav .bottom-nav-item'))
  .filter((el) => !el.hidden)
  .map((el) => el.getAttribute('data-nav'));

test('v1.75 USE: the rendered bar is the RESOLVED order - Home is first by default and Liked is absent', () => {
  withBar({}, () => {
    applyBottomNavCustomization();
    assert.deepEqual(renderedOrder(), ['home', 'playlists', 'history', 'theme', 'settings']);
  });
});

test('v1.75 USE: reordering Home away from first actually MOVES it in the DOM (what the CSS ladder used to prevent)', () => {
  const order = ['playlists', 'history', 'home', 'theme', 'settings'];
  withBar({ order, hidden: [], shown: [] }, () => {
    applyBottomNavCustomization();
    const rendered = renderedOrder();
    assert.deepEqual(rendered, order);
    assert.notEqual(rendered[0], 'home', "Home is no longer left-most bound - Dean's ask");
  });
});

test('v1.75 USE: an opted-in Liked item renders, points at the central Liked, and hides again on request', () => {
  withBar({ shown: ['liked'] }, () => {
    applyBottomNavCustomization();
    assert.deepEqual(renderedOrder(), ['home', 'liked', 'playlists', 'history', 'theme', 'settings']);
    const el = global.document.querySelector('#bottom-nav [data-nav="liked"]');
    assert.equal(el.getAttribute('href'), '/?liked=1', 'the bottom entry lands on the central mixed-kind Liked');
  });
  withBar({ shown: ['liked'], hidden: ['liked'] }, () => {
    applyBottomNavCustomization();
    assert.ok(renderedOrder().indexOf('liked') === -1);
  });
});

test('v1.75 USE: hiding Home hides it for real; hiding EVERYTHING falls back to the default bar', () => {
  withBar({ hidden: ['home'] }, () => {
    applyBottomNavCustomization();
    assert.deepEqual(renderedOrder(), ['playlists', 'history', 'theme', 'settings']);
  });
  withBar({ hidden: SHELL_ITEMS.map(([id]) => id) }, () => {
    applyBottomNavCustomization();
    assert.deepEqual(renderedOrder(), ['home', 'playlists', 'history', 'theme', 'settings'], 'never an empty strip');
  });
});

test('v1.75 USE: a corrupt/absent config renders the default bar rather than throwing', () => {
  withBar(null, () => {
    applyBottomNavCustomization();
    assert.deepEqual(renderedOrder(), ['home', 'playlists', 'history', 'theme', 'settings']);
  });
  withBar({}, (dom) => {
    dom.window.localStorage.setItem('ft-bottomnav', '{not json');
    applyBottomNavCustomization();
    assert.deepEqual(renderedOrder(), ['home', 'playlists', 'history', 'theme', 'settings']);
  });
});

// ---- 4. the Settings editor -------------------------------------------------

const setup = require('../../public/js/setup.js');

function withEditor(config, fn) {
  const dom = new JSDOM('<body><div id="bottombar-editor"></div></body>', { url: 'http://localhost/setup.html' });
  global.document = dom.window.document;
  global.window = dom.window;
  global.localStorage = dom.window.localStorage;
  dom.window.FileTube = {
    BOTTOM_NAV_OPTIONAL,
    BOTTOM_NAV_DEFAULT_HIDDEN,
    resolveBottomNavLayout,
    readBottomNavConfig: common.readBottomNavConfig,
    writeBottomNavConfig: common.writeBottomNavConfig,
    applyBottomNavCustomization: () => {},
  };
  if (config !== null) dom.window.localStorage.setItem('ft-bottomnav', JSON.stringify(config));
  try {
    // The AbortSignal must come from the SAME realm as the listeners it is
    // registered with - a Node-realm controller is rejected by jsdom.
    return fn(dom, new dom.window.AbortController().signal);
  } finally {
    delete global.document;
    delete global.window;
    delete global.localStorage;
    dom.window.close();
  }
}

const editorRows = () => Array.prototype.slice
  .call(global.document.querySelectorAll('.bottombar-editor-row'))
  .map((row) => ({
    label: row.querySelector('.bottombar-editor-label').textContent,
    checked: row.querySelector('input[type="checkbox"]').checked,
    cb: row.querySelector('input[type="checkbox"]'),
  }));

test('v1.75 EDITOR: every roster id has a real label - no raw slug reaches the panel', () => {
  for (const id of BOTTOM_NAV_OPTIONAL) {
    assert.equal(typeof setup.BOTTOMBAR_LABELS[id], 'string', `missing label for '${id}'`);
    assert.ok(setup.BOTTOMBAR_LABELS[id].length > 0, `empty label for '${id}'`);
  }
  assert.equal(setup.BOTTOMBAR_LABELS.home, 'Home');
  assert.equal(setup.BOTTOMBAR_LABELS.liked, 'Liked');
  assert.equal(setup.BOTTOMBAR_LABELS.settings, 'Settings');
});

test('v1.75 EDITOR: rows list all twelve in the BAR\'s order, with the default ticks', () => {
  withEditor({}, (dom, signal) => {
    setup.renderBottomBarEditor(signal);
    const rows = editorRows();
    assert.equal(rows.length, 12);
    assert.equal(rows[0].label, 'Home', 'Home heads the list, as it heads the bar');
    assert.equal(rows[rows.length - 1].label, 'Settings', 'Settings tails both');
    assert.equal(rows[1].label, 'Liked');
    assert.equal(rows[1].checked, false, 'Liked is opt-in (default-hidden)');
    assert.equal(rows[0].checked, true, 'Home ships visible');
  });
});

test('v1.75 EDITOR: an EXISTING pre-v1.75 config still lists Home first and Settings last (the throw-Home-to-the-end trap)', () => {
  // The trap: such a config's `order` can never name home/settings, so a
  // roster-order walk would list both at the BOTTOM - and one tap of a move
  // button would then persist that as the user's real bar. The editor asks the
  // resolver instead, so its list carries the same compat pins the bar does.
  const cfg = { hidden: ['history'], order: ['theme', 'playlists', 'history'], shown: ['music'] };
  withEditor(cfg, (dom, signal) => {
    setup.renderBottomBarEditor(signal);
    const labels = editorRows().map((r) => r.label);
    assert.equal(labels[0], 'Home');
    assert.equal(labels[labels.length - 1], 'Settings');
    assert.deepEqual(labels.slice(1, 4), ['Light / Dark', 'Playlists', 'History'], 'the config order drives the middle');
    const ticks = editorRows();
    assert.equal(ticks.find((r) => r.label === 'History').checked, false, 'an explicit hide reads back as unchecked');
    assert.equal(ticks.find((r) => r.label === 'Music').checked, true, 'an opted-in default-hidden id reads back as checked');
  });
});

test('v1.75 EDITOR FLOOR: the last un-check is REFUSED - the tick goes back and nothing is persisted', () => {
  const all = BOTTOM_NAV_OPTIONAL.slice();
  const cfg = { hidden: all.filter((id) => id !== 'theme'), order: [], shown: [] };
  withEditor(cfg, (dom, signal) => {
    global.showToast = () => {};
    setup.renderBottomBarEditor(signal);
    const before = dom.window.localStorage.getItem('ft-bottomnav');
    const only = editorRows().find((r) => r.label === 'Light / Dark');
    assert.equal(only.checked, true, 'the one survivor is ticked');
    only.cb.checked = false;
    only.cb.dispatchEvent(new dom.window.Event('change'));
    assert.equal(only.cb.checked, true, 'the tick is put back');
    assert.equal(dom.window.localStorage.getItem('ft-bottomnav'), before, 'nothing was written');
    delete global.showToast;
  });
});

test('v1.75 EDITOR FLOOR: un-checking a NON-last item still works normally', () => {
  withEditor({}, (dom, signal) => {
    global.showToast = () => {};
    setup.renderBottomBarEditor(signal);
    const row = editorRows().find((r) => r.label === 'Playlists');
    row.cb.checked = false;
    row.cb.dispatchEvent(new dom.window.Event('change'));
    assert.equal(row.cb.checked, false, 'a legal hide sticks');
    const written = JSON.parse(dom.window.localStorage.getItem('ft-bottomnav'));
    assert.ok(written.hidden.indexOf('playlists') >= 0, 'and is persisted');
    delete global.showToast;
  });
});

test('v1.75 EDITOR: ticking Liked opts it in through `shown`, which is what the bar reads', () => {
  withEditor({}, (dom, signal) => {
    global.showToast = () => {};
    setup.renderBottomBarEditor(signal);
    const row = editorRows().find((r) => r.label === 'Liked');
    row.cb.checked = true;
    row.cb.dispatchEvent(new dom.window.Event('change'));
    const written = JSON.parse(dom.window.localStorage.getItem('ft-bottomnav'));
    assert.ok(written.shown.indexOf('liked') >= 0, 'shown carries the opt-in');
    assert.ok(resolveBottomNavLayout(BOTTOM_NAV_OPTIONAL, written).visible.indexOf('liked') >= 0, 'and the bar honours it');
    delete global.showToast;
  });
});
