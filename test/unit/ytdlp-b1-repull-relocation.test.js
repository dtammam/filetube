'use strict';

// [UNIT] v1.24.1 fast-follow -- B1's "Re-pull this channel now" button,
// relocated from an inline `public/index.html` `<script>` into
// `public/js/common.js`'s router runtime (see that section's own comment,
// and test/unit/ytdlp-t6-repull-and-subs-ui.test.js's updated B1
// assertions). This file covers the PURE match/gating helpers directly, plus
// the DOM-level no-double-inject guard, using the minimal fake-DOM pattern
// established by test/unit/oneoff-modal-teardown.test.js. The one-time
// health-probe latch + disabled-module inert path (which need a pristine,
// unlatched module instance) are covered separately in
// ytdlp-b1-repull-probe-enabled.test.js / ytdlp-b1-repull-probe-disabled.test.js
// -- each gets its OWN process/module instance (per CONTRIBUTING.md), so
// none of these files can accidentally leak `repullHealthChecked`/
// `repullModuleEnabled` state into another.

const { test } = require('node:test');
const assert = require('node:assert');
const {
  REPULL_BTN_ID,
  findRepullSubscriptionForRoot,
  shouldShowRepullButton,
  ensureRepullButton,
  removeRepullButton,
} = require('../../public/js/common.js');

// ---- findRepullSubscriptionForRoot (pure match logic) ----------------------

test('findRepullSubscriptionForRoot: matches a subscription whose channelDir equals root exactly', () => {
  const subs = [
    { id: 'sub-1', channelDir: '/media/OtherChannel' },
    { id: 'sub-2', channelDir: '/media/SomeChannel' },
  ];
  const match = findRepullSubscriptionForRoot('/media/SomeChannel', subs);
  assert.ok(match);
  assert.strictEqual(match.id, 'sub-2');
});

test('findRepullSubscriptionForRoot: no matching channelDir -> null', () => {
  const subs = [{ id: 'sub-1', channelDir: '/media/OtherChannel' }];
  assert.strictEqual(findRepullSubscriptionForRoot('/media/Nonexistent', subs), null);
});

test('findRepullSubscriptionForRoot: falsy root -> null even with subscriptions present', () => {
  const subs = [{ id: 'sub-1', channelDir: '/media/OtherChannel' }];
  assert.strictEqual(findRepullSubscriptionForRoot('', subs), null);
  assert.strictEqual(findRepullSubscriptionForRoot(null, subs), null);
});

test('findRepullSubscriptionForRoot: non-array subs -> null, never throws', () => {
  assert.doesNotThrow(() => {
    assert.strictEqual(findRepullSubscriptionForRoot('/media/X', null), null);
    assert.strictEqual(findRepullSubscriptionForRoot('/media/X', undefined), null);
    assert.strictEqual(findRepullSubscriptionForRoot('/media/X', 'not-an-array'), null);
  });
});

test('findRepullSubscriptionForRoot: malformed entries (missing/non-string channelDir) are skipped safely', () => {
  const subs = [null, {}, { id: 'sub-1', channelDir: 42 }, { id: 'sub-2', channelDir: '/media/X' }];
  const match = findRepullSubscriptionForRoot('/media/X', subs);
  assert.ok(match);
  assert.strictEqual(match.id, 'sub-2');
});

test('findRepullSubscriptionForRoot: is an exact match, not a substring/prefix match', () => {
  const subs = [{ id: 'sub-1', channelDir: '/media/SomeChannelExtra' }];
  assert.strictEqual(findRepullSubscriptionForRoot('/media/SomeChannel', subs), null);
});

// ---- shouldShowRepullButton (pure gating: disabled-module inert path) ------

test('shouldShowRepullButton: moduleEnabled true + a matching subscription -> returns it', () => {
  const subs = [{ id: 'sub-1', channelDir: '/media/X' }];
  const result = shouldShowRepullButton(true, '/media/X', subs);
  assert.ok(result);
  assert.strictEqual(result.id, 'sub-1');
});

test('shouldShowRepullButton: moduleEnabled false -> null regardless of a matching subscription (disabled-module inert)', () => {
  const subs = [{ id: 'sub-1', channelDir: '/media/X' }];
  assert.strictEqual(shouldShowRepullButton(false, '/media/X', subs), null);
});

test('shouldShowRepullButton: a truthy-but-not-strictly-true moduleEnabled never shows (fails closed)', () => {
  const subs = [{ id: 'sub-1', channelDir: '/media/X' }];
  assert.strictEqual(shouldShowRepullButton(1, '/media/X', subs), null);
  assert.strictEqual(shouldShowRepullButton('true', '/media/X', subs), null);
});

test('shouldShowRepullButton: moduleEnabled true but no matching root -> null', () => {
  const subs = [{ id: 'sub-1', channelDir: '/media/X' }];
  assert.strictEqual(shouldShowRepullButton(true, '/media/Nonexistent', subs), null);
});

// ---- ensureRepullButton / removeRepullButton (DOM: no-double-inject guard) -
//
// Minimal fake DOM sufficient for these two builder functions: a tree of
// FakeElements rooted at a `.section-actions` container, with a real
// (recursive) getElementById so the SAME no-double-inject guard the real
// browser DOM provides is genuinely exercised, not just assumed.

class FakeElement {
  constructor(tag) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.className = '';
    this.dataset = {};
    this.style = {};
    this.attributes = {};
    this.disabled = false;
    this.id = '';
    this._textContent = '';
    this._listeners = {};
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  remove() {
    if (this.parentElement) {
      const idx = this.parentElement.children.indexOf(this);
      if (idx >= 0) this.parentElement.children.splice(idx, 1);
      this.parentElement = null;
    }
  }

  setAttribute(name, value) { this.attributes[name] = value; }
  getAttribute(name) { return this.attributes[name]; }

  addEventListener(type, handler) { (this._listeners[type] = this._listeners[type] || []).push(handler); }
  fire(type, evt) { (this._listeners[type] || []).forEach((fn) => fn(evt || { target: this })); }
  click() { this.fire('click', { target: this }); }

  // Recursive, just enough for `.btn-label` lookups inside a button node.
  // Text nodes (plain `{ nodeType: 3, ... }` objects from createTextNode)
  // have no querySelector of their own -- skip recursing into those.
  querySelector(sel) {
    const wantClass = sel.startsWith('.') ? sel.slice(1) : null;
    for (const child of this.children) {
      if (wantClass && String(child.className).split(' ').includes(wantClass)) return child;
      if (typeof child.querySelector === 'function') {
        const nested = child.querySelector(sel);
        if (nested) return nested;
      }
    }
    return null;
  }

  get textContent() { return this._textContent; }
  set textContent(value) { this._textContent = value; this.children = []; }
}

function findById(node, id) {
  if (!node || !id) return null;
  if (node.id === id) return node;
  for (const child of node.children) {
    const found = findById(child, id);
    if (found) return found;
  }
  return null;
}

function makeFakeDocument(actions) {
  return {
    getElementById: (id) => findById(actions, id),
    querySelector: (sel) => (sel === '.section-actions' ? actions : null),
    createElement: (tag) => new FakeElement(tag),
    createTextNode: (text) => ({ nodeType: 3, textContent: text }),
  };
}

function withFakeDocument(doc, run) {
  const original = global.document;
  global.document = doc;
  try {
    return run();
  } finally {
    global.document = original;
  }
}

test('ensureRepullButton: injects exactly one button into .section-actions, with the subscription id on dataset', () => {
  const actions = new FakeElement('div');
  const doc = makeFakeDocument(actions);
  withFakeDocument(doc, () => {
    ensureRepullButton({ id: 'sub-1' });
    assert.strictEqual(actions.children.length, 1);
    const btn = actions.children[0];
    assert.strictEqual(btn.id, REPULL_BTN_ID);
    assert.strictEqual(btn.dataset.subId, 'sub-1');
  });
});

test('ensureRepullButton: a second call for the SAME view reuses the existing button (no double-inject)', () => {
  const actions = new FakeElement('div');
  const doc = makeFakeDocument(actions);
  withFakeDocument(doc, () => {
    ensureRepullButton({ id: 'sub-1' });
    const firstBtn = actions.children[0];

    ensureRepullButton({ id: 'sub-1' });

    assert.strictEqual(actions.children.length, 1, 'a repeated call must never append a second button');
    assert.strictEqual(actions.children[0], firstBtn, 'the SAME node must be reused, not rebuilt');
  });
});

test('ensureRepullButton: reconciling against a DIFFERENT subscription updates the existing button\'s target instead of adding another', () => {
  const actions = new FakeElement('div');
  const doc = makeFakeDocument(actions);
  withFakeDocument(doc, () => {
    ensureRepullButton({ id: 'sub-1' });
    ensureRepullButton({ id: 'sub-2' });

    assert.strictEqual(actions.children.length, 1);
    assert.strictEqual(actions.children[0].dataset.subId, 'sub-2');
  });
});

test('ensureRepullButton: no .section-actions in the current view -> no-op (and clears any stale button)', () => {
  const doc = {
    getElementById: () => null,
    querySelector: () => null,
    createElement: (tag) => new FakeElement(tag),
    createTextNode: (text) => ({ nodeType: 3, textContent: text }),
  };
  withFakeDocument(doc, () => {
    assert.doesNotThrow(() => ensureRepullButton({ id: 'sub-1' }));
  });
});

test('removeRepullButton: detaches the button from its parent when present', () => {
  const actions = new FakeElement('div');
  const doc = makeFakeDocument(actions);
  withFakeDocument(doc, () => {
    ensureRepullButton({ id: 'sub-1' });
    assert.strictEqual(actions.children.length, 1);

    removeRepullButton();

    assert.strictEqual(actions.children.length, 0);
  });
});

test('removeRepullButton: a no-op (never throws) when no button exists', () => {
  const actions = new FakeElement('div');
  const doc = makeFakeDocument(actions);
  withFakeDocument(doc, () => {
    assert.doesNotThrow(() => removeRepullButton());
  });
});
