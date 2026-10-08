'use strict';

// [UNIT] v1.24.0 "UX Round" C2 (item count) + C3 (format toggle), T3,
// `public/js/common.js`. C2: pure `countItems`/`formatItemCountLabel` + the
// idempotent `renderItemCountBadge` sibling-injection. C3: pure
// `filterByMediaType` (missing/ambiguous item type fails safe to "both" --
// never hidden), the `filetube_format` localStorage preference
// (`getStoredFormatFilter`/`setStoredFormatFilter`, mirroring the existing
// `filetube_sort` persistence pattern), and the createElement-built
// `buildFormatToggleControl`/`renderFormatToggle` widgets - replaced in UI pass
// sweep S2 (F19) by the ONE library filter chip row, buildFilterChipRow (ui-chip
// filter chips; the v1.50/v1.149 locks below are converted onto it, AC12).
//
// `common.js` only touches the GLOBAL `document`/`localStorage` inside
// function bodies (never at module-eval time), so it's required FIRST, with
// both left undefined, and only THEN does this file install fake shims --
// mirrors test/unit/pinned-sidebar.test.js's established pattern. Each test
// file runs in its own node:test process, so neither shim leaks elsewhere.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const {
  countItems, formatItemCountLabel, renderItemCountBadge,
  filterByMediaType, getStoredFormatFilter, setStoredFormatFilter,
  FORMAT_FILTER_MODES, FORMAT_TOGGLE_OPTIONS,
  WATCH_TOGGLE_MODES, WATCH_TOGGLE_OPTIONS, getStoredWatchFilter, setStoredWatchFilter,
  buildFilterChipRow,
  channelFormatForItem, channelHrefForItem, urlFormatFilter, buildNotificationRowModel,
} = require('../../public/js/common.js');
const { JSDOM } = require('jsdom');

const STYLE_CSS = fs.readFileSync(path.join(__dirname, '../../public/css/style.css'), 'utf8');
const { cssRules } = require('../helpers/stylesheets');

// ---- v1.188 (Dean): the library toolbar wears the modern feed-chip PILL look --

// UI pass sweep S2 (F19, AC12 conversion of the v1.188/v1.190 pill-recipe lock):
// the toolbar's filters are ui-chip filter chips (the primitive owns 32px pills,
// --surface-2, selected = ink on --fill-selected, never red, hover gated) in ONE
// horizontally scrolling row, and the trailing tools are ui-btn icons.
test('sweep S2 (F19): the library toolbar is one chip row - .library-chips scrolls, never wraps; the tools never shrink', () => {
  const rules = cssRules(STYLE_CSS);
  const rule = (sel) => { const r = rules.find((x) => x.sel.replace(/\s+/g, ' ') === sel && x.at.length === 0); return r ? r.body : ''; };
  const chips = rule('.library-chips');
  assert.match(chips, /display:\s*flex/);
  assert.match(chips, /overflow-x:\s*auto/, 'the chips scroll horizontally');
  assert.doesNotMatch(chips, /flex-wrap:\s*wrap/, 'never a second row');
  assert.match(rule('.library-chip-host'), /min-width:\s*0/, 'the chip host can shrink so the row never overflows');
  assert.match(rule('.library-tools'), /flex:\s*none/, 'the trailing tools keep their size');
  // No bespoke chip/pill recipe survives on the toolbar (the primitive is the look).
  assert.doesNotMatch(STYLE_CSS.replace(/\/\*[\s\S]*?\*\//g, ''), /\.section-actions \.btn(?![\w-])|\.format-toggle-btn|\.modern-chip(?![\w-])/, 'the v1.188 pill recipe and .modern-chip are gone');
  // The primitive itself: selected is ink on the tonal fill, never red (F13/F19).
  const UI = fs.readFileSync(path.join(__dirname, '../../public/css/ui.css'), 'utf8');
  const sel = cssRules(UI).find((x) => x.sel === '.ui-chip--filter[aria-pressed="true"]');
  assert.ok(sel && /--fill-selected/.test(sel.body) && !/--accent/.test(sel.body));
});

test('sweep S2: the toolbar markup is one row - the chip host, then ui-btn icon tools (sort, shuffle, rescan, view)', () => {
  const html = fs.readFileSync(path.join(__dirname, '../../public/index.html'), 'utf8');
  const bar = html.slice(html.indexOf('<div class="section-actions">'), html.indexOf('<div class="video-grid"'));
  assert.match(bar, /<div class="library-chip-host" id="library-chip-host"><\/div>\s*<div class="library-tools">/);
  for (const [id, icon] of [['sort-select-btn', 'sort'], ['shuffle-again-btn', 'shuffle'], ['rescan-library-btn', 'refresh'], ['view-mode-btn', 'view_list']]) {
    const m = new RegExp('<button type="button" class="ui-btn ui-btn--tonal ui-btn--sm ui-btn--icon" id="' + id + '"[^>]*aria-label="[^"]+"[^>]*>[\\s\\S]*?<use href="#i-' + icon + '"/>').exec(bar);
    assert.ok(m, id + ' is a ui-btn tonal icon with an aria-label and the ' + icon + ' registry icon');
  }
  assert.doesNotMatch(bar, /sort-menu|sort-caret|btn-label|&#9662;/, 'no hand-built dropdown or text caret');
});

test('v1.189.0 the pill look extends to the music / podcasts toolbars, tokens only, primary accent preserved (books is ui-btn since S10, History since S2)', () => {
  // UI pass sweep S10 (AC12 conversion of the books third): the books toolbar left this
  // recipe for ui-btn primitives - its Sort and Scan are tonal pill ui-btns in the shell
  // markup, and no .books-toolbar .btn rule survives to restyle them.
  const books = fs.readFileSync(path.join(__dirname, '../../public/books.html'), 'utf8');
  for (const id of ['books-sort-btn', 'books-scan-btn']) {
    const tag = new RegExp(`<button[^>]*id="${id}"[^>]*>`).exec(books);
    assert.ok(tag, `books.html carries #${id}`);
    for (const cls of ['ui-btn', 'ui-btn--tonal', 'ui-btn--pill']) assert.match(tag[0], new RegExp(`class="[^"]*\\b${cls}(?![\\w-])`), `#${id} is a ${cls}`);
  }
  assert.doesNotMatch(STYLE_CSS, /\.books-toolbar \.btn/, 'no bespoke .btn recipe for the books toolbar remains');
  // UI pass sweep S7 (AC12 conversion of the music / podcasts third): both toolbars left the
  // v1.189 .btn pill recipe for ui primitives - every control is a ui-btn (tonal sm pills;
  // podcasts' one primary Add), a ui-chip mode toggle or the ui-select sort field - and no
  // .music-toolbar-actions .btn rule survives to restyle them.
  const music = fs.readFileSync(path.join(__dirname, '../../public/music.html'), 'utf8');
  const bar = music.slice(music.indexOf('<div class="music-toolbar-actions">'), music.indexOf('<div id="music-stage"'));
  assert.ok(bar.length > 200, 'precondition: the music toolbar markup');
  for (const id of ['music-shuffle-btn', 'music-scan-btn', 'music-popout-btn', 'music-actions-btn', 'music-view-toggle']) {
    const tag = new RegExp(`<button[^>]*id="${id}"[^>]*>`).exec(bar);
    assert.ok(tag, `music.html carries #${id}`);
    for (const cls of ['ui-btn', 'ui-btn--tonal', 'ui-btn--sm', 'ui-btn--pill']) assert.match(tag[0], new RegExp(`class="[^"]*\\b${cls}(?![\\w-])`), `#${id} is a ${cls}`);
  }
  for (const id of ['music-loop-btn', 'music-autoplay-btn']) {
    assert.match(bar, new RegExp(`<button class="ui-chip ui-chip--filter music-mode-btn" id="${id}"[^>]*aria-pressed="false"`), `#${id} is a filter chip (its ON state is the chip's selected fill)`);
  }
  assert.match(bar, /<span class="ui-select music-sort"><select id="music-sort-select" class="ui-select__native"/, 'the sort is the ui-select field');
  assert.doesNotMatch(bar, /class="btn\b|class="[^"]*\sbtn\b|btn-sm/, 'no legacy .btn control left in the music toolbar');
  const pods = fs.readFileSync(path.join(__dirname, '../../public/podcasts.html'), 'utf8');
  const podBar = pods.slice(pods.indexOf('<div class="music-toolbar-actions">'), pods.indexOf('id="podcasts-status"'));
  assert.ok(podBar.length > 100, 'precondition: the podcasts toolbar markup');
  assert.doesNotMatch(podBar, /class="btn\b|btn-sm|music-theater-btn/, 'the podcasts toolbar: no legacy .btn control (its theatre toggle is the player\'s own #theater-btn since S7)');
  assert.doesNotMatch(STYLE_CSS.replace(/\/\*[\s\S]*?\*\//g, ''), /\.music-toolbar-actions \.btn\b/, 'no bespoke .btn recipe for the music/podcasts toolbar remains');
});

// ---- countItems / formatItemCountLabel (pure, no DOM) ----------------------

test('countItems: counts a normal array', () => {
  assert.strictEqual(countItems([{ id: 1 }, { id: 2 }, { id: 3 }]), 3);
});

test('countItems: an empty array counts as 0', () => {
  assert.strictEqual(countItems([]), 0);
});

test('countItems: never throws on a non-array/missing input, counts as 0', () => {
  assert.strictEqual(countItems(undefined), 0);
  assert.strictEqual(countItems(null), 0);
  assert.strictEqual(countItems('not an array'), 0);
  assert.strictEqual(countItems({}), 0);
});

test('formatItemCountLabel: pluralizes correctly', () => {
  assert.strictEqual(formatItemCountLabel(0), '0 items');
  assert.strictEqual(formatItemCountLabel(1), '1 item');
  assert.strictEqual(formatItemCountLabel(2), '2 items');
  assert.strictEqual(formatItemCountLabel(42), '42 items');
});

test('formatItemCountLabel: a non-finite/garbage count fails safe to "0 items", never throws/NaN', () => {
  assert.strictEqual(formatItemCountLabel(NaN), '0 items');
  assert.strictEqual(formatItemCountLabel(undefined), '0 items');
  assert.strictEqual(formatItemCountLabel(Infinity), '0 items');
});

// ---- filterByMediaType (pure, no DOM) ---------------------------------------

const MIXED_ITEMS = [
  { id: 'v1', type: 'video' },
  { id: 'a1', type: 'audio' },
  { id: 'v2', type: 'video' },
  { id: 'a2', type: 'audio' },
  { id: 'x1' }, // missing type -- ambiguous
  { id: 'x2', type: 'weird' }, // unrecognized type -- ambiguous
];

test('filterByMediaType: "video" keeps only video items PLUS every ambiguous/missing-type item (fail-safe, never hidden)', () => {
  const result = filterByMediaType(MIXED_ITEMS, 'video');
  assert.deepStrictEqual(result.map((i) => i.id), ['v1', 'v2', 'x1', 'x2']);
});

test('filterByMediaType: "audio" keeps only audio items PLUS every ambiguous/missing-type item (fail-safe, never hidden)', () => {
  const result = filterByMediaType(MIXED_ITEMS, 'audio');
  assert.deepStrictEqual(result.map((i) => i.id), ['a1', 'a2', 'x1', 'x2']);
});

test('filterByMediaType: "both" returns every item unchanged', () => {
  const result = filterByMediaType(MIXED_ITEMS, 'both');
  assert.deepStrictEqual(result.map((i) => i.id), MIXED_ITEMS.map((i) => i.id));
});

test('filterByMediaType: an unrecognized/missing mode fails safe to "both" (never silently hides items on a bad mode string)', () => {
  assert.deepStrictEqual(filterByMediaType(MIXED_ITEMS, 'bogus').map((i) => i.id), MIXED_ITEMS.map((i) => i.id));
  assert.deepStrictEqual(filterByMediaType(MIXED_ITEMS, undefined).map((i) => i.id), MIXED_ITEMS.map((i) => i.id));
});

test('filterByMediaType: never mutates the input array, never throws on a non-array input', () => {
  const copy = MIXED_ITEMS.map((i) => ({ ...i }));
  filterByMediaType(MIXED_ITEMS, 'video');
  assert.deepStrictEqual(MIXED_ITEMS, copy);
  assert.deepStrictEqual(filterByMediaType(undefined, 'video'), []);
  assert.deepStrictEqual(filterByMediaType(null, 'audio'), []);
});

// ---- getStoredFormatFilter / setStoredFormatFilter (localStorage) ----------

function makeFakeLocalStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  };
}

test('getStoredFormatFilter: an unset preference (no localStorage entry) defaults to "both"', () => {
  global.localStorage = makeFakeLocalStorage();
  assert.strictEqual(getStoredFormatFilter(), 'both');
  delete global.localStorage;
});

test('getStoredFormatFilter/setStoredFormatFilter: round-trips a valid mode through localStorage', () => {
  global.localStorage = makeFakeLocalStorage();
  setStoredFormatFilter('video');
  assert.strictEqual(getStoredFormatFilter(), 'video');
  setStoredFormatFilter('audio');
  assert.strictEqual(getStoredFormatFilter(), 'audio');
  delete global.localStorage;
});

test('setStoredFormatFilter: an invalid mode normalizes to "both" before persisting', () => {
  global.localStorage = makeFakeLocalStorage();
  const normalized = setStoredFormatFilter('garbage');
  assert.strictEqual(normalized, 'both');
  assert.strictEqual(getStoredFormatFilter(), 'both');
  delete global.localStorage;
});

test('getStoredFormatFilter: a corrupted stored value (not one of the 3 valid modes) fails safe to "both"', () => {
  global.localStorage = { getItem: () => 'nonsense', setItem: () => {} };
  assert.strictEqual(getStoredFormatFilter(), 'both');
  delete global.localStorage;
});

test('getStoredFormatFilter/setStoredFormatFilter: never throw when localStorage is unavailable entirely (private mode/sandbox/Node)', () => {
  assert.doesNotThrow(() => getStoredFormatFilter());
  assert.doesNotThrow(() => setStoredFormatFilter('video'));
  assert.strictEqual(getStoredFormatFilter(), 'both');
});

test('FORMAT_FILTER_MODES: exposes exactly the 3 valid modes', () => {
  assert.deepStrictEqual(FORMAT_FILTER_MODES, ['both', 'video', 'audio']);
});

// ---- DOM builders: buildFormatToggleControl / renderFormatToggle / renderItemCountBadge ----

class FakeNode {
  constructor(tag) {
    this.tagName = tag ? String(tag).toUpperCase() : undefined;
    this.id = '';
    this.className = '';
    this.children = [];
    this.parentNode = null;
    this._textContent = '';
    this.style = {};
    this.dataset = {};
    this._attrs = {};
    this._listeners = {};
  }

  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx >= 0) this.children.splice(idx, 1);
    child.parentNode = null;
    return child;
  }

  insertBefore(newNode, refNode) {
    const idx = refNode ? this.children.indexOf(refNode) : -1;
    newNode.parentNode = this;
    if (idx === -1) this.children.push(newNode);
    else this.children.splice(idx, 0, newNode);
    return newNode;
  }

  get nextSibling() {
    if (!this.parentNode) return null;
    const idx = this.parentNode.children.indexOf(this);
    return idx === -1 ? null : (this.parentNode.children[idx + 1] || null);
  }

  get firstChild() { return this.children[0] || null; }

  set textContent(value) { this._textContent = value; this.children = []; }
  get textContent() { return this._textContent; }

  set innerHTML(_value) {
    throw new Error('must never assign innerHTML -- use textContent/createTextNode instead');
  }

  setAttribute(name, value) { this._attrs[name] = String(value); }
  getAttribute(name) { return Object.prototype.hasOwnProperty.call(this._attrs, name) ? this._attrs[name] : null; }

  addEventListener(type, handler) { (this._listeners[type] = this._listeners[type] || []).push(handler); }
  dispatchEvent(evt) { (this._listeners[evt.type] || []).forEach((h) => h(evt)); }
  click() { this.dispatchEvent({ type: 'click' }); }

  get classList() {
    const self = this;
    return {
      add(name) {
        const set = new Set(self.className.split(' ').filter(Boolean));
        set.add(name);
        self.className = Array.from(set).join(' ');
      },
      remove(name) {
        self.className = self.className.split(' ').filter((c) => c && c !== name).join(' ');
      },
      toggle(name, force) {
        const has = self.className.split(' ').filter(Boolean).includes(name);
        const shouldHave = typeof force === 'boolean' ? force : !has;
        if (shouldHave && !has) this.add(name);
        if (!shouldHave && has) this.remove(name);
      },
      contains(name) { return self.className.split(' ').filter(Boolean).includes(name); },
    };
  }

  // Minimal selector support: a single `.class` or `#id` selector --
  // sufficient for buildFormatToggleControl's own `.format-toggle-btn`
  // lookup and the SCOPED `#library-format-toggle`/`#library-item-count`
  // de-dupe lookups in renderFormatToggle/renderItemCountBadge.
  querySelectorAll(selector) {
    const s = String(selector);
    const matches = s.startsWith('#')
      ? (node) => node.id === s.slice(1)
      : (node) => node.className && node.className.split(' ').filter(Boolean).includes(s.replace('.', ''));
    const results = [];
    const walk = (node) => {
      if (!Array.isArray(node.children)) return; // a createTextNode leaf has no .children
      node.children.forEach((child) => {
        if (matches(child)) results.push(child);
        walk(child);
      });
    };
    walk(this);
    return results;
  }

  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function makeFakeDoc(registry) {
  return {
    _registry: registry,
    getElementById: (id) => registry[id] || null,
    createElement: (tag) => new FakeNode(tag),
    createTextNode: (text) => ({ nodeType: 3, textContent: text }),
  };
}

// ---- UI pass sweep S2 (F19): the ONE filter chip row (buildFilterChipRow) ----
// Converted from the v1.24/v1.50/v1.149 buildFormatToggleControl /
// buildWatchToggleControl / buildSearchScopeToggleControl locks (AC12): the
// dimensions and their persistence/onChange contracts carry over; the widget is
// one row of ui-chip filter chips with ONE leading "All".

function chipDoc() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  return dom.window.document;
}
const FORMAT_GROUP = (v) => ({ key: 'format', value: v, all: 'both', options: FORMAT_TOGGLE_OPTIONS.map((o) => ({ value: o.mode, label: o.label })) });
const WATCH_GROUP = (v) => ({ key: 'watch', value: v, all: 'all', options: WATCH_TOGGLE_OPTIONS.map((o) => ({ value: o.mode, label: o.label })) });
const pressed = (row) => Array.from(row.querySelectorAll('.ui-chip')).map((c) => c.textContent + '=' + c.getAttribute('aria-pressed'));

test('buildFilterChipRow: ONE leading All, then each dimension\'s chips - all ui-chip filter buttons, one row', () => {
  const doc = chipDoc();
  const row = buildFilterChipRow([FORMAT_GROUP('video'), WATCH_GROUP('all')], null, { doc, id: 'library-filter-chips' });
  assert.strictEqual(row.id, 'library-filter-chips');
  assert.strictEqual(row.className, 'library-chips');
  assert.strictEqual(row.getAttribute('role'), 'group');
  const chips = Array.from(row.children);
  assert.ok(chips.every((c) => c.tagName === 'BUTTON' && c.className === 'ui-chip ui-chip--filter'));
  assert.deepStrictEqual(chips.map((c) => c.textContent), ['All', 'Videos', 'Audio', 'New', 'Watching', 'Watched'],
    'exactly one All (F19: two rows each starting with All is the bug)');
  assert.deepStrictEqual(pressed(row), ['All=false', 'Videos=true', 'Audio=false', 'New=false', 'Watching=false', 'Watched=false']);
});

test('buildFilterChipRow: All is pressed exactly when every dimension is at its all-value', () => {
  const doc = chipDoc();
  assert.strictEqual(buildFilterChipRow([FORMAT_GROUP('both'), WATCH_GROUP('all')], null, { doc }).children[0].getAttribute('aria-pressed'), 'true');
  assert.strictEqual(buildFilterChipRow([FORMAT_GROUP('both'), WATCH_GROUP('new')], null, { doc }).children[0].getAttribute('aria-pressed'), 'false');
});

test('buildFilterChipRow: a chip selects its value (deselecting its siblings); tapping it again returns the dimension to all - ONE onChange per tap', () => {
  const doc = chipDoc();
  const calls = [];
  const row = buildFilterChipRow([FORMAT_GROUP('both'), WATCH_GROUP('all')], (ch) => calls.push(ch), { doc });
  const chip = (label) => Array.from(row.children).find((c) => c.textContent === label);
  chip('Videos').click();
  chip('Audio').click();
  assert.deepStrictEqual(pressed(row).slice(0, 3), ['All=false', 'Videos=false', 'Audio=true'], 'single-select within a dimension');
  chip('Watching').click();
  assert.deepStrictEqual(pressed(row), ['All=false', 'Videos=false', 'Audio=true', 'New=false', 'Watching=true', 'Watched=false'], 'dimensions are independent');
  chip('Audio').click();
  assert.deepStrictEqual(calls, [{ format: 'video' }, { format: 'audio' }, { watch: 'watching' }, { format: 'both' }]);
});

test('buildFilterChipRow: All resets EVERY dimension in ONE onChange (one reload); an All tap that changes nothing never calls it', () => {
  const doc = chipDoc();
  const calls = [];
  const row = buildFilterChipRow([FORMAT_GROUP('audio'), WATCH_GROUP('new')], (ch) => calls.push(ch), { doc });
  row.children[0].click();
  assert.deepStrictEqual(calls, [{ format: 'both', watch: 'all' }]);
  assert.deepStrictEqual(pressed(row).filter((p) => p.endsWith('=true')), ['All=true']);
  row.children[0].click();
  assert.strictEqual(calls.length, 1, 'no-op tap, no reload');
});

test('buildFilterChipRow: builds via createElement/textContent only, never innerHTML (regression guard)', () => {
  const src = buildFilterChipRow.toString().replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(src, /\.innerHTML\s*=/);
  assert.doesNotMatch(src, /localStorage/, 'the row never persists anything - the caller owns state');
});

test('renderItemCountBadge: inserts a sibling badge right after headerEl with the correct label', () => {
  global.document = makeFakeDoc({});
  const section = new FakeNode('div');
  const header = new FakeNode('span');
  header.id = 'videos-section-header';
  section.appendChild(header);

  renderItemCountBadge(header, [{ id: 1 }, { id: 2 }]);

  assert.strictEqual(section.children.length, 2);
  const badge = section.children[1];
  assert.strictEqual(badge.id, 'library-item-count');
  assert.strictEqual(badge.textContent, '2 items');
  assert.strictEqual(header.textContent, '', 'headerEl itself is never touched -- the badge is a sibling');
  delete global.document;
});

test('renderItemCountBadge: a second call updates the SAME badge in place (idempotent, never duplicates)', () => {
  global.document = makeFakeDoc({});
  const section = new FakeNode('div');
  const header = new FakeNode('span');
  section.appendChild(header);

  renderItemCountBadge(header, [{ id: 1 }]);
  const firstBadge = section.children[1];

  renderItemCountBadge(header, [{ id: 1 }, { id: 2 }, { id: 3 }]);

  assert.strictEqual(section.children.length, 2, 'still header + exactly one badge');
  assert.strictEqual(section.children[1], firstBadge, 'reuses the existing badge node');
  assert.strictEqual(firstBadge.textContent, '3 items');
  delete global.document;
});

test('renderItemCountBadge: re-render against a DETACHED cached view never doubles the badge (same class as the doubled-row bug)', () => {
  global.document = makeFakeDoc({}); // getElementById never finds anything
  const section = new FakeNode('div');
  const header = new FakeNode('span');
  section.appendChild(header);

  renderItemCountBadge(header, [{ id: 1 }]);
  renderItemCountBadge(header, [{ id: 1 }, { id: 2 }]); // background refresh while detached

  const badges = section.children.filter((c) => c.id === 'library-item-count');
  assert.strictEqual(badges.length, 1, 'exactly one badge, never two');
  assert.strictEqual(badges[0].textContent, '2 items');
  delete global.document;
});

test('renderItemCountBadge: a detached re-render never steals/removes the LIVE page\'s badge', () => {
  const registry = {};
  global.document = makeFakeDoc(registry);
  const liveSection = new FakeNode('div');
  const liveHeader = new FakeNode('span');
  liveSection.appendChild(liveHeader);
  renderItemCountBadge(liveHeader, [{ id: 1 }]);
  const liveBadge = liveSection.children[1];
  registry['library-item-count'] = liveBadge; // the live one IS document-visible

  const detachedSection = new FakeNode('div');
  const detachedHeader = new FakeNode('span');
  detachedSection.appendChild(detachedHeader);
  renderItemCountBadge(detachedHeader, [{ id: 1 }, { id: 2 }]);

  assert.strictEqual(liveSection.children[1], liveBadge, 'live badge untouched');
  assert.strictEqual(liveBadge.parentNode, liveSection);
  assert.strictEqual(detachedSection.children.filter((c) => c.id === 'library-item-count').length, 1);
  delete global.document;
});

test('renderItemCountBadge: no-ops safely when headerEl is missing/unattached', () => {
  global.document = makeFakeDoc({});
  assert.doesNotThrow(() => renderItemCountBadge(null, []));
  const detached = new FakeNode('span'); // no parentNode
  assert.doesNotThrow(() => renderItemCountBadge(detached, []));
  delete global.document;
});

// ---- v1.50 T3: the watched-state toggle (the format toggle's sibling) ------
// Mirrors the format-toggle coverage above 1:1 -- same component, different
// axis -- plus the mount-position contract (directly after the format
// toggle) and the born-with-the-fix detached-cache posture.

test('getStoredWatchFilter: unset/corrupt/unavailable storage all fail safe to "all"', () => {
  global.localStorage = makeFakeLocalStorage();
  assert.strictEqual(getStoredWatchFilter(), 'all');
  delete global.localStorage;
  global.localStorage = { getItem: () => 'nonsense', setItem: () => {} };
  assert.strictEqual(getStoredWatchFilter(), 'all');
  delete global.localStorage;
  assert.doesNotThrow(() => getStoredWatchFilter()); // no localStorage at all
  assert.strictEqual(getStoredWatchFilter(), 'all');
});

test('getStoredWatchFilter/setStoredWatchFilter: round-trips every valid mode; invalid normalizes to "all"', () => {
  global.localStorage = makeFakeLocalStorage();
  for (const mode of WATCH_TOGGLE_MODES) {
    setStoredWatchFilter(mode);
    assert.strictEqual(getStoredWatchFilter(), mode);
  }
  assert.strictEqual(setStoredWatchFilter('garbage'), 'all');
  assert.strictEqual(getStoredWatchFilter(), 'all');
  delete global.localStorage;
});

test('WATCH_TOGGLE_MODES: exactly the 4 modes, matching the server\'s WATCH_FILTER_MODES contract', () => {
  assert.deepStrictEqual(WATCH_TOGGLE_MODES, ['all', 'new', 'watching', 'watched']);
});

test('the watch dimension offers New/Watching/Watched (all = the row\'s shared All); the format dimension Videos/Audio', () => {
  assert.deepStrictEqual(WATCH_TOGGLE_OPTIONS.map((o) => [o.mode, o.label]), [['new', 'New'], ['watching', 'Watching'], ['watched', 'Watched']]);
  assert.deepStrictEqual(FORMAT_TOGGLE_OPTIONS.map((o) => [o.mode, o.label]), [['video', 'Videos'], ['audio', 'Audio']]);
  for (const o of WATCH_TOGGLE_OPTIONS) assert.ok(WATCH_TOGGLE_MODES.includes(o.mode));
  for (const o of FORMAT_TOGGLE_OPTIONS) assert.ok(FORMAT_FILTER_MODES.includes(o.mode));
});

// ---- v1.149: the search-scope toggle (All | Titles | Channels) --------------
//
// A sibling of format/watch in structure but DELIBERATELY unpersisted:
// clicking must never touch localStorage (each new search starts on 'all' -
// the design decision, bound below by a spying fake). Requires the same
// fake-doc shims as its siblings.

const {
  SEARCH_SCOPE_MODES, SEARCH_SCOPE_OPTIONS, normalizeSearchScopeMode,
} = require('../../public/js/common.js');

test('v1.149 normalizeSearchScopeMode: whitelist with all-fallback, mirroring the server normalizer', () => {
  assert.deepEqual(SEARCH_SCOPE_MODES, ['all', 'title', 'channel']);
  assert.strictEqual(normalizeSearchScopeMode('channel'), 'channel');
  assert.strictEqual(normalizeSearchScopeMode('title'), 'title');
  for (const junk of ['channels', 'ALL', '', null, undefined, 7]) {
    assert.strictEqual(normalizeSearchScopeMode(junk), 'all');
  }
});

test('v1.149 the scope dimension: Titles/Channels (never a second "Videos" label beside the format\'s)', () => {
  assert.deepStrictEqual(SEARCH_SCOPE_OPTIONS.map((o) => [o.mode, o.label]), [['title', 'Titles'], ['channel', 'Channels']]);
  const doc = chipDoc();
  const row = buildFilterChipRow([FORMAT_GROUP('both'), { key: 'scope', value: 'channel', all: 'all', options: SEARCH_SCOPE_OPTIONS.map((o) => ({ value: o.mode, label: o.label })) }], null, { doc });
  const labels = Array.from(row.children).map((c) => c.textContent);
  assert.strictEqual(labels.filter((l) => l === 'Videos').length, 1, 'one Videos in the row');
  assert.strictEqual(Array.from(row.children).find((c) => c.textContent === 'Channels').getAttribute('aria-pressed'), 'true');
});

test('v1.149 main.js source locks: the scope rides the query only under a search; the chip row adds it only on a non-liked search', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'main.js'), 'utf8');
  assert.match(src, /if \(searchQuery && activeSearchScope !== 'all'\) queryParams\.push\(`searchIn=\$\{encodeURIComponent\(activeSearchScope\)\}`\)/,
    'buildVideosApiUrl sends searchIn only for a non-default scope during a search');
  const mount = src.slice(src.indexOf('function mountLibraryChips() {'), src.indexOf('function updateShuffleButtonVisibility() {'));
  assert.match(mount, /if \(isUnifiedSearch\) \{\s*groups\.push\(\{ key: 'type'/, 'a global search shows the type dimension only');
  assert.match(mount, /if \(searchQuery && !likedFilter && !watchLaterFilter\) \{\s*groups\.push\(\{ key: 'scope'/, 'the scope dimension: a folder/root search, never over Liked');
  assert.strictEqual((src.match(/ensureLibraryChips\(\);/g) || []).length, 2, 'mounted (guarded) at the two toolbar sites');
});

test('v1.149 gate round 1: main.js source locks - deep-link init, ctx threading, and the liked-view mount exclusion', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'main.js'), 'utf8');
  // W2: a shared ?searchIn= link must initialize the scope (the surviving
  // mutant replaced this with a hardcoded 'all' and nothing redded).
  assert.match(src, /normalizeSearchScopeMode\(urlParams\.get\('searchIn'\)\)/,
    'the view closure initializes the scope from the deep link through the whitelist');
  // W1: the scope rides the watch-page list context.
  assert.match(src, /searchIn: activeSearchScope/, 'encodeListContext receives the live scope');
  // S2: no scope toggle over a Liked view (its endpoint ignores search).
  // v1.205: the scope-toggle mount is now the else-branch of the type-chip row.
  // S2: no scope over a Liked view (its endpoint ignores search) - the chip row's
  // scope dimension is gated on a non-liked search (bound in the test above).
});

// ---- v1.376 W3 (R3): a channel link carries the item's type for that visit ----

test('channelFormatForItem: a library media item maps to its own type; every other kind and type carries nothing (positive guards)', () => {
  assert.strictEqual(channelFormatForItem({ type: 'video' }), 'video', 'a /api/videos item (no kind)');
  assert.strictEqual(channelFormatForItem({ type: 'audio' }), 'audio');
  assert.strictEqual(channelFormatForItem({ kind: 'media', type: 'video' }), 'video', 'a bell row (kind media)');
  assert.strictEqual(channelFormatForItem({ kind: 'media', type: 'audio' }), 'audio');
  for (const kind of ['podcast', 'track', 'book', 'tv-episode', 'tv-show', 'engine', 'Media', '']) {
    assert.strictEqual(channelFormatForItem({ kind, type: 'audio' }), '', `kind ${JSON.stringify(kind)} never carries a format`);
    assert.strictEqual(channelFormatForItem({ kind, type: 'video' }), '', `kind ${JSON.stringify(kind)} never carries a format`);
  }
  for (const type of [undefined, null, '', 'engine', 'Video', 'both', 'image']) {
    assert.strictEqual(channelFormatForItem({ type }), '', `type ${JSON.stringify(type)} carries nothing`);
  }
  assert.strictEqual(channelFormatForItem(null), '');
  assert.strictEqual(channelFormatForItem('video'), '');
});

test('channelHrefForItem: appends format to the channel href with the right separator, or leaves it as it was', () => {
  assert.strictEqual(channelHrefForItem('/?folder=F%C3%B6lder', { type: 'video' }), '/?folder=F%C3%B6lder&format=video');
  assert.strictEqual(channelHrefForItem('/?folder=x', { type: 'audio' }), '/?folder=x&format=audio');
  assert.strictEqual(channelHrefForItem('/channel', { type: 'audio' }), '/channel?format=audio');
  assert.strictEqual(channelHrefForItem('/?folder=x', { kind: 'podcast', type: 'audio' }), '/?folder=x');
  assert.strictEqual(channelHrefForItem('/?folder=x', {}), '/?folder=x');
  assert.strictEqual(channelHrefForItem('', { type: 'video' }), '');
  assert.strictEqual(channelHrefForItem(null, { type: 'video' }), null);
});

test('urlFormatFilter: only the three format modes count; absent or junk is null (the remembered filter applies)', () => {
  assert.strictEqual(urlFormatFilter('?folder=x&format=video'), 'video');
  assert.strictEqual(urlFormatFilter('?format=audio'), 'audio');
  assert.strictEqual(urlFormatFilter(new URLSearchParams('format=both')), 'both');
  for (const q of ['', '?folder=x', '?format=', '?format=Audio', '?format=podcast', '?format=video%00']) {
    assert.strictEqual(urlFormatFilter(q), null, q);
  }
  assert.strictEqual(urlFormatFilter(undefined), null);
});

test('bell row: a media row\'s "Open channel" carries the row\'s type (the server row shape); podcast and engine rows are unchanged', () => {
  const vid = buildNotificationRowModel({ id: 1, mediaId: 'a', kind: 'media', type: 'video', title: 'T', createdAt: 1, folderName: 'Földer Ä' });
  assert.strictEqual(vid.channelHref, '/?folder=' + encodeURIComponent('Földer Ä') + '&format=video');
  const aud = buildNotificationRowModel({ id: 2, mediaId: 'b', kind: 'media', type: 'audio', title: 'T', createdAt: 1, folderName: 'Földer Ä' });
  assert.strictEqual(aud.channelHref, '/?folder=' + encodeURIComponent('Földer Ä') + '&format=audio');
  const pod = buildNotificationRowModel({ id: 3, mediaId: 'e', kind: 'podcast', type: 'audio', title: 'E', createdAt: 1, artUrl: '/podcastart/s1', folderName: 'Földer Ä' });
  assert.strictEqual(pod.channelHref, '/podcasts?show=s1', 'a podcast row opens its show, never a filtered folder');
  const eng = buildNotificationRowModel({ id: 4, mediaId: 'engine:x', kind: 'engine', type: 'engine', title: 'E', createdAt: 1 });
  assert.strictEqual(eng.channelHref, null);
});
