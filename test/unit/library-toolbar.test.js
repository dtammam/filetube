'use strict';

// [UNIT] v1.24.0 "UX Round" C2 (item count) + C3 (format toggle), T3,
// `public/js/common.js`. C2: pure `countItems`/`formatItemCountLabel` + the
// idempotent `renderItemCountBadge` sibling-injection. C3: pure
// `filterByMediaType` (missing/ambiguous item type fails safe to "both" --
// never hidden), the `filetube_format` localStorage preference
// (`getStoredFormatFilter`/`setStoredFormatFilter`, mirroring the existing
// `filetube_sort` persistence pattern), and the createElement-built
// `buildFormatToggleControl`/`renderFormatToggle` widgets.
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
  FORMAT_FILTER_MODES, buildFormatToggleControl, renderFormatToggle,
  WATCH_TOGGLE_MODES, getStoredWatchFilter, setStoredWatchFilter,
  buildWatchToggleControl, renderWatchToggle,
} = require('../../public/js/common.js');

const STYLE_CSS = fs.readFileSync(path.join(__dirname, '../../public/css/style.css'), 'utf8');

// ---- v1.188 (Dean): the library toolbar wears the modern feed-chip PILL look --

test('v1.188 the .section-actions toolbar buttons adopt the modern-chip pill recipe (rounded/flat/secondary), with an inverted active filter', () => {
  const base = /\.section-actions \.btn \{([^}]*)\}/.exec(STYLE_CSS);
  assert.ok(base, 'the .section-actions .btn pill rule exists');
  assert.match(base[1], /border-radius:\s*var\(--radius-full\)/, 'fully-rounded like a feed chip');
  assert.match(base[1], /background-color:\s*var\(--bg-secondary\)/, 'flat secondary fill');
  assert.match(base[1], /border-color:\s*var\(--border-color\)/, 'hairline border');
  assert.match(base[1], /box-shadow:\s*none/, 'flat - the base .btn shadow is dropped');
  assert.match(base[1], /font-weight:\s*normal/, 'v1.190: normal weight to match the feed chips (not the base .btn semibold)');
  const hover = /\.section-actions \.btn:hover \{([^}]*)\}/.exec(STYLE_CSS);
  assert.ok(hover, 'the hover rule exists');
  assert.match(hover[1], /background-color:\s*var\(--bg-sidebar\)/, 'hover tints to the sidebar bg like a chip');
  // The selected filter reads like an ACTIVE feed chip (inverted), not the old
  // red-accent. Higher specificity than the base .format-toggle-btn.active.
  const active = /\.section-actions \.format-toggle-btn\.active \{([^}]*)\}/.exec(STYLE_CSS);
  assert.ok(active, 'the inverted active-filter rule exists');
  assert.match(active[1], /background-color:\s*var\(--text-primary\)/, 'active fills with the primary ink');
  assert.match(active[1], /color:\s*var\(--bg-color\)/, 'active text inverts to the page bg');
  assert.match(active[1], /font-weight:\s*normal/, 'v1.190: the active chip is not bold either (the inverted fill is the emphasis)');
  // gate QA-W2: 2009 keeps its gloss (background-image), so the inverted fill
  // never shows there - the active label must stay legible with --text-primary
  // ink rather than the inverted --bg-color (which would be near-invisible on the
  // retained light gloss). This 0-4-0 selector outranks the gloss .btn rule.
  const era2009 = /\[data-theme="2009"\] \.section-actions \.format-toggle-btn\.active \{([^}]*)\}/.exec(STYLE_CSS);
  assert.ok(era2009, 'the 2009 legibility override exists');
  assert.match(era2009[1], /color:\s*var\(--text-primary\)/, '2009 active label keeps legible primary ink on its retained gloss');
});

test('v1.189.0 the pill look extends to the books / music / podcasts / history toolbars, tokens only, primary accent preserved', () => {
  // The three other list-page toolbar containers all get the pill SHAPE.
  const shape = /\.books-toolbar \.btn,\s*\.music-toolbar-actions \.btn,\s*\.history-toolbar-actions \.btn \{([^}]*)\}/.exec(STYLE_CSS);
  assert.ok(shape, 'the grouped pill-shape rule for the other toolbars exists (books + music/podcasts + history)');
  assert.match(shape[1], /border-radius:\s*var\(--radius-full\)/, 'fully rounded like the home toolbar');
  assert.match(shape[1], /box-shadow:\s*none/, 'flat - base .btn shadow dropped');
  assert.match(shape[1], /font-weight:\s*normal/, 'v1.190: normal weight to match the feed chips + the home toolbar');
  // The flat secondary FILL is scoped to :not(.btn-primary) so +Add / Subscribe
  // keep their --yt-red accent (only the shape rounds).
  const fill = /\.books-toolbar \.btn:not\(\.btn-primary\),\s*\.music-toolbar-actions \.btn:not\(\.btn-primary\),\s*\.history-toolbar-actions \.btn:not\(\.btn-primary\) \{([^}]*)\}/.exec(STYLE_CSS);
  assert.ok(fill, 'the fill rule excludes .btn-primary (accent preserved)');
  assert.match(fill[1], /background-color:\s*var\(--bg-secondary\)/, 'non-primary buttons get the flat secondary fill');
  assert.match(fill[1], /border-color:\s*var\(--border-color\)/, 'hairline border');
  // Bind the hover tint too (gate SUGGESTION: without this a future edit could
  // silently drop it, matching the v1.188 sibling test's own hover lock).
  const hover = /\.books-toolbar \.btn:not\(\.btn-primary\):hover,\s*\.music-toolbar-actions \.btn:not\(\.btn-primary\):hover,\s*\.history-toolbar-actions \.btn:not\(\.btn-primary\):hover \{([^}]*)\}/.exec(STYLE_CSS);
  assert.ok(hover, 'the non-primary hover rule exists for the other toolbars');
  assert.match(hover[1], /background-color:\s*var\(--bg-sidebar\)/, 'hover tints to the sidebar bg like the home toolbar');
  // No raw color literal sneaks in (the census enforces this globally, but bind
  // it here too since this is the theming question Dean raised).
  assert.doesNotMatch(shape[1] + fill[1], /#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(/, 'every color is a token, none raw - themes with the era system');
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

test('buildFormatToggleControl: builds 3 buttons (All/Videos/Audio), marking the current mode active/aria-pressed', () => {
  global.document = makeFakeDoc({});
  const control = buildFormatToggleControl('video');
  assert.strictEqual(control.id, 'library-format-toggle');
  assert.strictEqual(control.children.length, 3);
  const [all, videos, audio] = control.children;
  assert.strictEqual(all.tagName, 'BUTTON');
  assert.strictEqual(all.getAttribute('aria-pressed'), 'false');
  assert.strictEqual(videos.getAttribute('aria-pressed'), 'true');
  assert.ok(videos.classList.contains('active'));
  assert.strictEqual(audio.getAttribute('aria-pressed'), 'false');
  delete global.document;
});

test('buildFormatToggleControl: an unrecognized currentMode falls back to "both" active', () => {
  global.document = makeFakeDoc({});
  const control = buildFormatToggleControl('bogus');
  const all = control.children[0];
  assert.ok(all.classList.contains('active'));
  delete global.document;
});

test('buildFormatToggleControl: clicking a button persists the mode, updates aria-pressed across all buttons, and invokes onChange', () => {
  global.document = makeFakeDoc({});
  global.localStorage = makeFakeLocalStorage();
  let changedTo = null;
  const control = buildFormatToggleControl('both', (mode) => { changedTo = mode; });
  const [, videosBtn] = control.children;

  videosBtn.click();

  assert.strictEqual(changedTo, 'video');
  assert.strictEqual(getStoredFormatFilter(), 'video');
  assert.ok(videosBtn.classList.contains('active'));
  assert.strictEqual(videosBtn.getAttribute('aria-pressed'), 'true');
  assert.ok(!control.children[0].classList.contains('active'), 'the previously-active "All" button is deactivated');
  assert.strictEqual(control.children[0].getAttribute('aria-pressed'), 'false');

  delete global.document;
  delete global.localStorage;
});

test('buildFormatToggleControl: builds via createElement/textContent only, never innerHTML (regression guard)', () => {
  const stripComments = (src) => src.replace(/\/\/.*$/gm, '');
  const src = stripComments(buildFormatToggleControl.toString());
  assert.doesNotMatch(src, /\.innerHTML\s*=/);
});

test('renderFormatToggle: mounts as the FIRST child of actionsEl', () => {
  const registry = {};
  global.document = makeFakeDoc(registry);
  const actions = new FakeNode('div');
  const existingChild = new FakeNode('select');
  actions.appendChild(existingChild);

  renderFormatToggle(actions, 'both');

  assert.strictEqual(actions.children.length, 2);
  assert.strictEqual(actions.children[0].id, 'library-format-toggle');
  assert.strictEqual(actions.children[1], existingChild);
  delete global.document;
});

test('renderFormatToggle: idempotent -- a second call removes the prior control rather than duplicating it', () => {
  global.document = makeFakeDoc({});
  const actions = new FakeNode('div');

  renderFormatToggle(actions, 'both');
  const firstControl = actions.children[0];

  renderFormatToggle(actions, 'video');
  assert.strictEqual(actions.children.length, 1, 'still exactly one toggle control, never a duplicate');
  assert.notStrictEqual(actions.children[0], firstControl);
  delete global.document;
});

// ---- v1.50 T1 regression: the "doubled All/Videos/Audio row" bug -----------
// homeViewCache keeps the home view alive DETACHED (no destroy()), and a
// background `__filetubeRefreshLibrary` can re-render it there while another
// view is live. The old document.getElementById de-dupe could not see the
// detached tree (-> double-append on reattach) and could find-and-remove the
// LIVE page's control instead. The fix scopes every de-dupe lookup to the
// container that is being rendered into. These tests simulate exactly that:
// `document.getElementById` deliberately CANNOT see the detached nodes.

test('renderFormatToggle: re-render against a DETACHED cached view never doubles the toggle (the v1.50 doubled-row bug)', () => {
  // getElementById never finds anything -- exactly the detached-cache case.
  global.document = makeFakeDoc({});
  const detachedActions = new FakeNode('div');

  renderFormatToggle(detachedActions, 'both');
  renderFormatToggle(detachedActions, 'both'); // background refresh while off Home

  const toggles = detachedActions.children.filter((c) => c.id === 'library-format-toggle');
  assert.strictEqual(toggles.length, 1, 'exactly one toggle after a detached re-render, never two');
  delete global.document;
});

test('renderFormatToggle: a detached re-render never steals/removes the LIVE page\'s toggle', () => {
  const registry = {};
  global.document = makeFakeDoc(registry);
  const liveActions = new FakeNode('div');
  renderFormatToggle(liveActions, 'both');
  const liveToggle = liveActions.children[0];
  registry['library-format-toggle'] = liveToggle; // the live one IS document-visible

  const detachedActions = new FakeNode('div');
  renderFormatToggle(detachedActions, 'video');

  assert.strictEqual(liveActions.children[0], liveToggle, 'live toggle untouched');
  assert.strictEqual(liveToggle.parentNode, liveActions);
  assert.strictEqual(detachedActions.children.filter((c) => c.id === 'library-format-toggle').length, 1);
  delete global.document;
});

test('renderFormatToggle: no-ops safely when actionsEl is missing', () => {
  global.document = makeFakeDoc({});
  assert.doesNotThrow(() => renderFormatToggle(null, 'both'));
  delete global.document;
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

test('buildWatchToggleControl: 4 buttons (All/New/Watching/Watched), current mode active/aria-pressed, format-toggle component classes', () => {
  global.document = makeFakeDoc({});
  const control = buildWatchToggleControl('watching');
  assert.strictEqual(control.id, 'library-watch-toggle');
  assert.ok(control.className.includes('format-toggle'), 'reuses the format-toggle component styling');
  assert.ok(control.className.includes('watch-toggle'), 'carries the layout-override class');
  assert.strictEqual(control.children.length, 4);
  const labels = control.children.map((b) => b.textContent || (b.children[0] && b.children[0].textContent));
  assert.deepStrictEqual(labels, ['All', 'New', 'Watching', 'Watched']);
  const pressed = control.children.map((b) => b.getAttribute('aria-pressed'));
  assert.deepStrictEqual(pressed, ['false', 'false', 'true', 'false']);
  delete global.document;
});

test('buildWatchToggleControl: clicking persists the mode, flips active/aria-pressed, and invokes onChange', () => {
  global.document = makeFakeDoc({});
  global.localStorage = makeFakeLocalStorage();
  let changedTo = null;
  const control = buildWatchToggleControl('all', (mode) => { changedTo = mode; });
  const newBtn = control.children[1];

  newBtn.click();

  assert.strictEqual(changedTo, 'new');
  assert.strictEqual(getStoredWatchFilter(), 'new');
  assert.ok(newBtn.classList.contains('active'));
  assert.strictEqual(control.children[0].getAttribute('aria-pressed'), 'false', 'the previously-active "All" is deactivated');
  delete global.document;
  delete global.localStorage;
});

test('renderWatchToggle: mounts DIRECTLY AFTER the format toggle; falls back to first child without one', () => {
  global.document = makeFakeDoc({});
  const actions = new FakeNode('div');
  const sortBtn = new FakeNode('button');
  actions.appendChild(sortBtn);
  renderFormatToggle(actions, 'both');

  renderWatchToggle(actions, 'all');

  assert.strictEqual(actions.children[0].id, 'library-format-toggle');
  assert.strictEqual(actions.children[1].id, 'library-watch-toggle');
  assert.strictEqual(actions.children[2], sortBtn);

  const bare = new FakeNode('div');
  const other = new FakeNode('button');
  bare.appendChild(other);
  renderWatchToggle(bare, 'all');
  assert.strictEqual(bare.children[0].id, 'library-watch-toggle', 'no format toggle -> first child');
  delete global.document;
});

test('renderWatchToggle: idempotent + detached-cache safe (the doubled-row class, from birth)', () => {
  global.document = makeFakeDoc({}); // getElementById never finds anything -- the detached case
  const actions = new FakeNode('div');

  renderWatchToggle(actions, 'all');
  renderWatchToggle(actions, 'watched'); // background refresh while detached

  const toggles = actions.children.filter((c) => c.id === 'library-watch-toggle');
  assert.strictEqual(toggles.length, 1, 'exactly one watch toggle, never two');
  assert.doesNotThrow(() => renderWatchToggle(null, 'all'), 'no-ops safely without a container');
  delete global.document;
});

// ---- v1.149: the search-scope toggle (All | Titles | Channels) --------------
//
// A sibling of format/watch in structure but DELIBERATELY unpersisted:
// clicking must never touch localStorage (each new search starts on 'all' -
// the design decision, bound below by a spying fake). Requires the same
// fake-doc shims as its siblings.

const {
  SEARCH_SCOPE_MODES, normalizeSearchScopeMode,
  buildSearchScopeToggleControl, renderSearchScopeToggle,
} = require('../../public/js/common.js');

test('v1.149 normalizeSearchScopeMode: whitelist with all-fallback, mirroring the server normalizer', () => {
  assert.deepEqual(SEARCH_SCOPE_MODES, ['all', 'title', 'channel']);
  assert.strictEqual(normalizeSearchScopeMode('channel'), 'channel');
  assert.strictEqual(normalizeSearchScopeMode('title'), 'title');
  for (const junk of ['channels', 'ALL', '', null, undefined, 7]) {
    assert.strictEqual(normalizeSearchScopeMode(junk), 'all');
  }
});

test('v1.149 buildSearchScopeToggleControl: three buttons (All/Titles/Channels - never a second "Videos" label), active from the argument', () => {
  global.document = makeFakeDoc({});
  const control = buildSearchScopeToggleControl('channel');
  assert.strictEqual(control.id, 'library-search-scope-toggle');
  assert.strictEqual(control.children.length, 3);
  // FakeNode keeps appended text nodes in `children` (nodeType 3) rather
  // than aggregating textContent - read the label from the text-node child.
  const labels = Array.prototype.map.call(control.children,
    (b) => (b.children.find((c) => c.nodeType === 3) || {}).textContent);
  assert.deepEqual(labels, ['All', 'Titles', 'Channels'], 'the format toggle beside it owns "Videos" - this one must not');
  assert.deepEqual(Array.prototype.map.call(control.children, (b) => b.dataset.searchScope), ['all', 'title', 'channel']);
  assert.ok(control.children[2].classList.contains('active'));
  assert.strictEqual(control.children[2].getAttribute('aria-pressed'), 'true');
  assert.strictEqual(control.children[0].getAttribute('aria-pressed'), 'false');
  delete global.document;
});

test('v1.149 buildSearchScopeToggleControl: click flips active + fires onChange - and NEVER touches localStorage (the no-persistence decision)', () => {
  global.document = makeFakeDoc({});
  const writes = [];
  global.localStorage = { getItem: () => null, setItem: (k, v) => { writes.push([k, v]); } };
  let changedTo = null;
  const control = buildSearchScopeToggleControl('all', (mode) => { changedTo = mode; });
  control.children[2].click();
  assert.strictEqual(changedTo, 'channel');
  assert.ok(control.children[2].classList.contains('active'));
  assert.strictEqual(control.children[0].getAttribute('aria-pressed'), 'false');
  assert.deepEqual(writes, [], 'a scope click must not persist anything - each new search starts on all');
  delete global.document;
  delete global.localStorage;
});

test('v1.149 renderSearchScopeToggle: mounts AFTER the watch toggle and de-dupes container-scoped', () => {
  global.document = makeFakeDoc({});
  const actions = global.document.createElement('div');
  renderFormatToggle(actions, 'both', () => {});
  renderWatchToggle(actions, 'all', () => {});
  renderSearchScopeToggle(actions, 'title', () => {});
  const ids = Array.prototype.map.call(actions.children, (c) => c.id);
  assert.deepEqual(ids, ['library-format-toggle', 'library-watch-toggle', 'library-search-scope-toggle']);
  renderSearchScopeToggle(actions, 'channel', () => {});
  assert.strictEqual(actions.children.length, 3, 'a re-render replaces, never accumulates (the doubled-row class)');
  delete global.document;
});

test('v1.149 main.js source locks: the scope rides the query only under a search, and both toolbar sites are search-gated', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'main.js'), 'utf8');
  assert.match(src, /if \(searchQuery && activeSearchScope !== 'all'\) queryParams\.push\(`searchIn=\$\{encodeURIComponent\(activeSearchScope\)\}`\)/,
    'buildVideosApiUrl sends searchIn only for a non-default scope during a search');
  // v1.205 Wave B: the two toolbar sites are still search-gated + liked-
  // excluded, but each now BRANCHES: a global search mounts the type-chip row,
  // a folder/root search keeps the video-only scope toggle.
  assert.strictEqual((src.match(/searchQuery && !likedFilter && sectionActions/g) || []).length, 2,
    'both toolbar render sites exist, search-gated and liked-excluded');
  assert.strictEqual((src.match(/!isUnifiedSearch && !sectionActions\.querySelector\('#library-search-scope-toggle'\)/g) || []).length, 2,
    'the video-only searchIn scope toggle mounts ONLY for a non-unified (folder/root) search, at both sites');
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
  assert.strictEqual((src.match(/searchQuery && !likedFilter && sectionActions/g) || []).length, 2,
    'both mount sites are search-gated AND liked-excluded');
  assert.strictEqual((src.match(/!isUnifiedSearch && !sectionActions\.querySelector\('#library-search-scope-toggle'\)/g) || []).length, 2,
    'the scope toggle is gated to a non-unified search at both sites');
});
