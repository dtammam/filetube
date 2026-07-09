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

const {
  countItems, formatItemCountLabel, renderItemCountBadge,
  filterByMediaType, getStoredFormatFilter, setStoredFormatFilter,
  FORMAT_FILTER_MODES, buildFormatToggleControl, renderFormatToggle,
} = require('../../public/js/common.js');

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

  // Minimal single-class selector support -- sufficient for
  // buildFormatToggleControl's own `.format-toggle-btn` lookup.
  querySelectorAll(selector) {
    const cls = String(selector).replace('.', '');
    const results = [];
    const walk = (node) => {
      if (!Array.isArray(node.children)) return; // a createTextNode leaf has no .children
      node.children.forEach((child) => {
        if (child.className && child.className.split(' ').filter(Boolean).includes(cls)) results.push(child);
        walk(child);
      });
    };
    walk(this);
    return results;
  }
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
  const registry = {};
  global.document = makeFakeDoc(registry);
  const actions = new FakeNode('div');

  renderFormatToggle(actions, 'both');
  const firstControl = actions.children[0];
  registry['library-format-toggle'] = firstControl;

  renderFormatToggle(actions, 'video');
  assert.strictEqual(actions.children.length, 1, 'still exactly one toggle control, never a duplicate');
  assert.notStrictEqual(actions.children[0], firstControl);
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
  const registry = {};
  global.document = makeFakeDoc(registry);
  const section = new FakeNode('div');
  const header = new FakeNode('span');
  section.appendChild(header);

  renderItemCountBadge(header, [{ id: 1 }]);
  const firstBadge = section.children[1];
  registry['library-item-count'] = firstBadge;

  renderItemCountBadge(header, [{ id: 1 }, { id: 2 }, { id: 3 }]);

  assert.strictEqual(section.children.length, 2, 'still header + exactly one badge');
  assert.strictEqual(section.children[1], firstBadge, 'reuses the existing badge node');
  assert.strictEqual(firstBadge.textContent, '3 items');
  delete global.document;
});

test('renderItemCountBadge: no-ops safely when headerEl is missing/unattached', () => {
  global.document = makeFakeDoc({});
  assert.doesNotThrow(() => renderItemCountBadge(null, []));
  const detached = new FakeNode('span'); // no parentNode
  assert.doesNotThrow(() => renderItemCountBadge(detached, []));
  delete global.document;
});
