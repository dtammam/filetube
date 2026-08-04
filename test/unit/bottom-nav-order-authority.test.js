'use strict';

// [UNIT] v1.75 T2 - the bottom bar's ORDER AUTHORITY, bound where it is used.
//
// Three things this wave changed can only be proved at the DOM/asset layer,
// never by a resolver test:
//
//  1. The v1.39.2 CSS `order:` ladder is GONE. It pinned seven data-nav ids
//     (home, playlists, oneoff-download, subscriptions, books, theme, settings)
//     to fixed flex positions and left the four it never grew a rule for
//     (history, podcasts, music, downloads) at the default `order: 0`, i.e.
//     LEFT of Home - Dean's reported symptom - while also making the v1.44
//     reorder feature unable to move any of the seven. CSS `order` beats DOM
//     order outright, so a green resolver test proved nothing about the
//     rendered bar. (Gate correction: `books` was PINNED at 5. An earlier
//     version of this header, and of the style.css comment, listed it among
//     the unpinned.)
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

// Every CSS rule as {selector, body}, comments stripped and newlines flattened.
// The gate's round-1 version scanned LINES, so a rule written across several
// lines - the prevailing style in this file - slipped straight past it; and it
// only knew the `#bottom-nav [data-nav="x"]` selector shape, so
// `.bottom-nav-item[data-nav="x"]` was invisible too. Both seats landed a live
// mutant on it. Parse instead of grep.
function cssRulesFrom(text) {
  const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');
  const rules = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    rules.push({ selector: m[1].trim(), body: m[2].trim() });
  }
  return rules;
}

// `order:` but not `border:`/`-order:` - the round-1 regex flagged any
// `border:` declaration on a bottom-nav rule as the v1.39.2 defect.
const ORDER_DECL = /(^|[^-\w])order\s*:/;
// The flex CONTAINER (`#bottom-nav` / `.bottom-nav`), not its children. The
// distinction is load-bearing: `.bottom-nav-item` is itself a column (icon over
// label) and legitimately sets flex-direction; only the container's own
// direction decides the SEQUENCE of the items.
const CONTAINER_SELECTOR = /(#bottom-nav|\.bottom-nav)(?![-\w])/;
const FLOW_DECL = /(^|[^-\w])(flex-direction|direction)\s*:/;

const fmtRule = (r) => `${r.selector} { ${r.body} }`;
// The TWO predicates, defined once. The self-proof below runs its mutant
// fixtures through these same functions - gate round 2 measured that a
// hand-inlined copy let the real lock be neutered while the test that
// certifies it stayed green.
// The selector test covers `data-nav=` as well as the `bottom-nav` token: a
// rule spelled `[data-nav="home"] { order: 1 }` carries neither `#bottom-nav`
// nor `.bottom-nav-item` and fully resurrects the ladder (gate round 2, S1).
// `data-nav=` is exclusive to bottom-bar items in this tree, and the `=`
// keeps `data-nav-sidebar=` out.
const BAR_SELECTOR = /bottom-nav|data-nav\s*=/;
const orderOffenders = (rules) => rules.filter((r) => BAR_SELECTOR.test(r.selector) && ORDER_DECL.test(r.body)).map(fmtRule);
const flowOffenders = (rules) => rules.filter((r) => CONTAINER_SELECTOR.test(r.selector) && FLOW_DECL.test(r.body)).map(fmtRule);

test('v1.75: NO css rule assigns flex `order` to a bottom-nav item - the resolver is the sole authority', () => {
  const offenders = orderOffenders(cssRulesFrom(CSS));
  assert.deepEqual(offenders, [], `flex order on the bottom bar is the v1.39.2 defect: ${JSON.stringify(offenders)}`);
});

test('v1.75: and no rule inverts or re-flows the bar around the resolver either', () => {
  // `order` is not the only way to divorce the rendered sequence from the DOM:
  // flex-direction: row-reverse on the container does it wholesale, and
  // `direction: rtl` does it too. Same defect class, same lock.
  const offenders = flowOffenders(cssRulesFrom(CSS));
  assert.deepEqual(offenders, [], `the bar's sequence must come from the resolver alone: ${JSON.stringify(offenders)}`);
});

test('v1.75: the lock catches every shape the ladder could come back in (verified against real mutants)', () => {
  // The three shapes that survived the round-1 lock, plus the two that did not.
  // Routed through the REAL parser and the REAL predicates the two tests above
  // call, so gutting either one fails this test too - the lock and its own
  // proof cannot drift apart.
  const caught = (css) => {
    const rules = cssRulesFrom(css);
    return orderOffenders(rules).length > 0 || flowOffenders(rules).length > 0;
  };
  assert.ok(caught('#bottom-nav [data-nav="home"] { order: 1; }'), 'single-line ladder rule');
  assert.ok(caught('#bottom-nav [data-nav="liked"] {\n  order: -1;\n}'), 'MULTI-LINE rule (survived round 1)');
  assert.ok(caught('.bottom-nav-item[data-nav="home"] {\n  order: 9;\n}'), 'alternate selector shape (survived round 1)');
  assert.ok(caught('#bottom-nav { flex-direction: row-reverse; }'), 'container reversal (survived round 1)');
  assert.ok(!caught('#bottom-nav .bottom-nav-item { border: 1px solid red; }'), 'border: is NOT order: (round 1 false-positived)');
  assert.ok(caught('[data-nav="home"] {\n  order: 1;\n}'), 'a bare data-nav selector (survived round 2)');
  assert.ok(!caught('.video-card .thumb { order: 1; }'), 'a rule on some other surface is not our business');
  assert.ok(!caught('[data-nav-sidebar="history"] { order: 1; }'), 'the SIDEBAR marker is a different surface');
  assert.ok(!caught('.bottom-nav-item { flex-direction: column; }'), 'an ITEM is legitimately a column - only the container sequences');
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

test('v1.75: the Settings copy states the new freedom and the floor, and no longer promises the retired anchors', () => {
  // Adversarial S2: reverting this sentence survived the whole suite, and it is
  // the ONLY user-facing statement of either fact.
  const html = fs.readFileSync(path.join(PUBLIC_DIR, 'setup.html'), 'utf8');
  const panel = html.slice(html.indexOf('id="bottombar-editor"'));
  const copy = panel.slice(0, panel.indexOf('</small>'));
  assert.ok(!/Home stays first/.test(html), 'the retired promise must not survive anywhere in the shell');
  assert.match(copy, /Home, Liked and Settings included/, 'the copy names what newly became reorderable');
  assert.match(copy, /at least one item/, 'and states the >=1 floor the panel enforces');
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
  const cleanup = () => {
    delete global.document;
    delete global.window;
    delete global.localStorage;
    dom.window.close();
  };
  // Promise-aware: the injector tests below await a probe, and tearing the DOM
  // globals down in a plain `finally` would pull them out from under the
  // still-pending callback ("document is not defined" from inside common.js).
  let result;
  try {
    result = fn(dom);
  } catch (err) {
    cleanup();
    throw err;
  }
  if (result && typeof result.then === 'function') {
    return result.then((v) => { cleanup(); return v; }, (err) => { cleanup(); throw err; });
  }
  cleanup();
  return result;
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

// ---- 3b. gate round 2: the two DOM uses that were still unbound -------------

test('W1: removing the Downloads item re-resolves, so a Downloads-only bar cannot be emptied by a probe', async () => {
  // The only injector that REMOVES a bar item did so without re-applying. That
  // was harmless while home/settings were un-hideable; since v1.75 a user can
  // legally end up with a Downloads-ONLY bar (the >=1 floor accepts it while
  // the item is mounted), and then a config change - or a transient /api/config
  // failure - left a fixed, EMPTY, un-navigable bar that reproduced on every
  // reload. Drives the REAL injector against both of its removal arms.
  const onlyDownloads = { hidden: SHELL_ITEMS.map(([id]) => id).filter((id) => id !== 'downloads'), shown: ['downloads'] };
  for (const [label, fetchImpl] of [
    ['the module reports no download root', () => Promise.resolve({ ok: true, json: () => Promise.resolve({ syntheticFolders: [] }) })],
    ['a transient /api/config failure', () => Promise.reject(new Error('network'))],
  ]) {
    const realFetch = global.fetch;
    await withBar(onlyDownloads, async () => {
      global.fetch = fetchImpl;
      applyBottomNavCustomization();
      assert.deepEqual(renderedOrder(), ['downloads'], `${label}: precondition - a legal Downloads-only bar`);
      common.injectDownloadsNavLinkIfEnabled();
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      assert.equal(global.document.querySelector('#bottom-nav [data-nav="downloads"]'), null, `${label}: the item is removed (module gate wins)`);
      assert.ok(renderedOrder().length > 0, `${label}: the bar must not be left EMPTY`);
      assert.deepEqual(renderedOrder(), ['home', 'playlists', 'history', 'theme', 'settings'], `${label}: the floor's default bar renders`);
    });
    global.fetch = realFetch;
  }
});

test('W2: the highlight DOM pass is bound, not just its two decisions', () => {
  // Three mutants survived all 5955 tests while this pass lived inside the
  // router closure: deleting the bottomNavKeyForHighlight call, hardcoding its
  // second argument to true, and nulling the sidebar href.
  const SIDEBAR = '<aside id="sidebar">'
    + '<a class="sidebar-item" href="/">Home</a>'
    + '<a class="sidebar-item sidebar-item-liked" href="/?liked=1">Liked</a>'
    + '<a class="sidebar-item" href="/music">Music</a></aside>';
  const litBottom = () => {
    const el = global.document.querySelector('#bottom-nav .bottom-nav-item.active');
    return el && el.getAttribute('data-nav');
  };
  const litSidebar = () => {
    const el = global.document.querySelector('#sidebar .sidebar-item.active');
    return el && el.getAttribute('href');
  };

  // Default device: Liked is opted OUT, so /?liked=1 lights HOME on the bar
  // (v1.74's behaviour) while the sidebar's own count-gated Liked entry lights.
  withBar({}, (dom) => {
    dom.window.document.body.insertAdjacentHTML('beforeend', SIDEBAR);
    applyBottomNavCustomization();
    common.applyNavHighlight('/', '?liked=1');
    assert.equal(litBottom(), 'home', 'the bar falls back to Home rather than going unlit');
    assert.equal(litSidebar(), '/?liked=1', 'the sidebar lights Liked on its own terms');
  });

  // Opted IN: the bar lights Liked itself.
  withBar({ shown: ['liked'] }, (dom) => {
    dom.window.document.body.insertAdjacentHTML('beforeend', SIDEBAR);
    applyBottomNavCustomization();
    common.applyNavHighlight('/', '?liked=1');
    assert.equal(litBottom(), 'liked');
    assert.equal(litSidebar(), '/?liked=1');
  });

  // A plain home view lights Home in both places, and never Liked.
  withBar({ shown: ['liked'] }, (dom) => {
    dom.window.document.body.insertAdjacentHTML('beforeend', SIDEBAR);
    applyBottomNavCustomization();
    common.applyNavHighlight('/', '');
    assert.equal(litBottom(), 'home');
    assert.equal(litSidebar(), '/');
  });

  // Another route lights its own item; and repainting clears the previous one.
  withBar({ shown: ['music'] }, (dom) => {
    dom.window.document.body.insertAdjacentHTML('beforeend', SIDEBAR);
    applyBottomNavCustomization();
    common.applyNavHighlight('/', '');
    common.applyNavHighlight('/music', '');
    assert.equal(litBottom(), 'music', 'the stale Home highlight is cleared');
    assert.equal(litSidebar(), '/music');
    assert.equal(global.document.querySelectorAll('.bottom-nav-item.active').length, 1, 'exactly one item is ever lit');
  });

  // S4: a HIDDEN item is never lit - a hidden .active node reads as an unlit bar.
  withBar({ hidden: ['music'] }, (dom) => {
    dom.window.document.body.insertAdjacentHTML('beforeend', SIDEBAR);
    applyBottomNavCustomization();
    common.applyNavHighlight('/music', '');
    assert.equal(litBottom(), null, 'no hidden item carries the highlight');
    assert.equal(litSidebar(), '/music', 'the sidebar entry is unaffected by the BAR being hidden');
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
    // v1.76: the editor wires its rows through the shared gesture layer. The
    // REAL one, not a stub - these tests drive reorders through it.
    wireReorderable: common.wireReorderable,
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

test('v1.75 EDITOR: a move persists the FULL roster, which is what releases the compat pins', () => {
  // The whole "Home is not always left-most bound" mechanism: until an `order`
  // NAMES home/settings the compat fallbacks pin them, and the only thing that
  // ever writes those two ids is a reorder from this panel. Adversarial S5
  // measured it had no direct test.
  //
  // v1.76: the up/down BUTTONS are gone (Dean: they "just suck"); the row's
  // drag handle is now both the pointer grip and the keyboard control, so the
  // move is driven here by the handle's ArrowDown. The property under test -
  // the full roster reaching localStorage - is unchanged, and driving it by
  // keyboard also proves the arrows' accessibility was replaced rather than
  // simply deleted.
  withEditor({}, (dom, signal) => {
    global.showToast = () => {};
    setup.renderBottomBarEditor(signal);
    // The panel re-renders after every move, so re-query each time. Two moves
    // down takes Home past Liked (hidden) AND Playlists (visible) - one move
    // only swaps it with the hidden Liked row, which correctly leaves the
    // VISIBLE bar unchanged and would prove nothing about the rendered order.
    const moveHomeDown = () => {
      const rows = Array.prototype.slice.call(dom.window.document.querySelectorAll('.bottombar-editor-row'));
      const row = rows.find((r) => r.querySelector('.bottombar-editor-label').textContent === 'Home');
      row.querySelector('.drag-handle').dispatchEvent(
        new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
      );
    };
    assert.equal(
      dom.window.document.querySelector('.bottombar-editor-row .bottombar-editor-label').textContent,
      'Home', 'Home heads the panel before any move',
    );
    moveHomeDown();
    const afterOne = JSON.parse(dom.window.localStorage.getItem('ft-bottomnav'));
    assert.equal(afterOne.order.length, BOTTOM_NAV_OPTIONAL.length, 'the full roster is persisted, not just the moved id');
    for (const id of ['home', 'settings']) {
      assert.ok(afterOne.order.indexOf(id) >= 0, `${id} must be NAMED for its compat pin to release`);
    }
    assert.equal(afterOne.order[0], BOTTOM_NAV_OPTIONAL[1], 'Home swapped with the row below it');
    assert.equal(afterOne.order[1], 'home');
    moveHomeDown();
    const written = JSON.parse(dom.window.localStorage.getItem('ft-bottomnav'));
    // And the bar honours it: Home is no longer first, and the pins are gone.
    assert.equal(resolveBottomNavLayout(BOTTOM_NAV_OPTIONAL, written).visible[0], 'playlists');
    assert.equal(resolveBottomNavLayout(BOTTOM_NAV_OPTIONAL, written).visible[1], 'home');
    delete global.showToast;
  });
});

// ---- v1.76: the arrows are gone; the handle drags ---------------------------

test('v1.76 EDITOR: every row has a drag handle and NO up/down buttons survive', () => {
  withEditor({}, (dom, signal) => {
    setup.renderBottomBarEditor(signal);
    const rows = Array.prototype.slice.call(dom.window.document.querySelectorAll('.bottombar-editor-row'));
    assert.ok(rows.length > 0, 'the panel rendered');
    assert.equal(
      dom.window.document.querySelectorAll('.bottombar-editor-btn').length, 0,
      'the up/down buttons Dean asked to be rid of are gone',
    );
    for (const row of rows) {
      const handle = row.querySelector('.drag-handle');
      assert.ok(handle, 'every row has a grip');
      // The grip carries the accessibility the deleted buttons used to.
      assert.equal(handle.getAttribute('tabindex'), '0');
      assert.equal(handle.getAttribute('role'), 'button');
      assert.ok(/^Reorder .+/.test(handle.getAttribute('aria-label') || ''), 'named for a screen reader');
      assert.notEqual(handle.getAttribute('aria-label'), 'Reorder item', 'named by its ITEM, not generically');
    }
  });
});

test('v1.76 EDITOR: a POINTER drag reorders the bar and persists the full roster', () => {
  // The headline of Dean's ask, bound end-to-end: a real drag on the real
  // panel writes a real config the real resolver then renders.
  withEditor({}, (dom, signal) => {
    setup.renderBottomBarEditor(signal);
    const rows = Array.prototype.slice.call(dom.window.document.querySelectorAll('.bottombar-editor-row'));
    // jsdom does no layout, so give the rows the geometry a browser would.
    rows.forEach((row, i) => { row.getBoundingClientRect = () => ({ top: i * 20, bottom: i * 20 + 20, height: 20 }); });
    const labelAt = (i) => rows[i].querySelector('.bottombar-editor-label').textContent;
    const first = labelAt(0);
    const second = labelAt(1);
    assert.equal(first, 'Home', 'Home heads the panel before the drag');

    const pointerAt = (el, type, clientY) => el.dispatchEvent(new dom.window.PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', button: 0, clientX: 0, clientY,
    }));
    const lastBottomHalf = (rows.length - 1) * 20 + 15;
    pointerAt(rows[0], 'pointerdown', 5);
    pointerAt(dom.window.document, 'pointermove', 20);          // past the arm threshold
    pointerAt(dom.window.document, 'pointermove', lastBottomHalf);
    pointerAt(dom.window.document, 'pointerup', lastBottomHalf);

    const written = JSON.parse(dom.window.localStorage.getItem('ft-bottomnav'));
    assert.ok(written && Array.isArray(written.order), 'the drag persisted an order');
    assert.equal(written.order.length, BOTTOM_NAV_OPTIONAL.length, 'the FULL roster, so the compat pins release');
    assert.equal(written.order[written.order.length - 1], 'home', 'the dragged item landed at the end');
    assert.equal(BOTTOMBAR_LABELS_OF(written.order[0]), second, 'the row below it took the lead');
    assert.notEqual(BOTTOMBAR_LABELS_OF(written.order[0]), first);
    // ...and the BAR agrees, which is the thing Dean actually looks at.
    assert.equal(resolveBottomNavLayout(BOTTOM_NAV_OPTIONAL, written).visible.slice(-1)[0], 'home');
  });
});

const BOTTOMBAR_LABELS_OF = (id) => setup.BOTTOMBAR_LABELS[id] || id;

test('v1.76 EDITOR: a drag that ends where it started persists nothing', () => {
  withEditor({}, (dom, signal) => {
    setup.renderBottomBarEditor(signal);
    const before = dom.window.localStorage.getItem('ft-bottomnav');
    const rows = Array.prototype.slice.call(dom.window.document.querySelectorAll('.bottombar-editor-row'));
    rows.forEach((row, i) => { row.getBoundingClientRect = () => ({ top: i * 20, bottom: i * 20 + 20, height: 20 }); });
    const pointerAt = (el, type, clientY) => el.dispatchEvent(new dom.window.PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', button: 0, clientX: 0, clientY,
    }));
    pointerAt(rows[0], 'pointerdown', 5);
    pointerAt(dom.window.document, 'pointermove', 9);   // top half of its own row
    pointerAt(dom.window.document, 'pointerup', 9);
    assert.equal(dom.window.localStorage.getItem('ft-bottomnav'), before, 'no write at all');
  });
});

test('v1.75 EDITOR FLOOR: the floor counts what the BAR mounts, not the roster', () => {
  // Adversarial S4: on a device with the yt-dlp module off, leaving only
  // Subscriptions + Download ticked passes a roster-shaped floor (two visible)
  // while the real bar has nothing - it would then floor to the default and the
  // panel would show ten empty boxes over a fully populated bar.
  const present = SHELL_ITEMS.map(([id]) => id); // no subscriptions / oneoff-download
  const cfg = { hidden: present.slice(), order: [], shown: ['subscriptions', 'oneoff-download'] };
  withEditor(cfg, (dom, signal) => {
    global.showToast = () => {};
    setup.renderBottomBarEditor(signal);
    // Mount the live bar AFTER the panel renders - the two capability probes
    // resolve asynchronously, so a floor that snapshotted the bar at render
    // time would decide against a list that is still filling in (QA gate round
    // 2). Reading it at CHANGE time is the whole point.
    const nav = dom.window.document.createElement('nav');
    nav.id = 'bottom-nav';
    nav.innerHTML = present.map((id) => `<a class="bottom-nav-item" data-nav="${id}"></a>`).join('');
    dom.window.document.body.appendChild(nav);
    const before = dom.window.localStorage.getItem('ft-bottomnav');
    // Ticking Subscriptions off is legal by the roster (Download still shows)
    // but empties the REAL bar, so it must be refused.
    const row = editorRows().find((r) => r.label === 'Subscriptions');
    row.cb.checked = false;
    row.cb.dispatchEvent(new dom.window.Event('change'));
    assert.equal(row.cb.checked, true, 'refused against the live bar');
    assert.equal(dom.window.localStorage.getItem('ft-bottomnav'), before, 'nothing written');
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
