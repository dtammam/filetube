'use strict';

// [UNIT] v1.24.1 fast-follow -- B1's relocated "Re-pull this channel now"
// widget: the ENABLED-module path through `probeAndReconcileRepullButton`/
// `reconcileRepullButton`/`fetchSubscriptionsForRepull`. Kept in its OWN
// file (separate process per CONTRIBUTING.md's test isolation) because
// `repullHealthChecked`/`repullModuleEnabled`/`repullSubsCache` are
// intentionally module-scoped, ONE-TIME-per-tab state -- exercising the
// "module enabled" path here can never leak into
// ytdlp-b1-repull-probe-disabled.test.js's "module disabled" path, since
// each file gets a pristine `require('../../public/js/common.js')` instance.

const { test } = require('node:test');
const assert = require('node:assert');
const {
  REPULL_BTN_ID,
  probeAndReconcileRepullButton,
} = require('../../public/js/common.js');

class FakeElement {
  constructor(tag) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.className = '';
    this.dataset = {};
    this.style = {};
    this.disabled = false;
    this.id = '';
    this._textContent = '';
  }
  appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
  remove() {
    if (this.parentElement) {
      const idx = this.parentElement.children.indexOf(this);
      if (idx >= 0) this.parentElement.children.splice(idx, 1);
      this.parentElement = null;
    }
  }
  setAttribute() {}
  addEventListener() {}
  querySelector() { return null; }
  get textContent() { return this._textContent; }
  set textContent(value) { this._textContent = value; }
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

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test('probeAndReconcileRepullButton (module ENABLED): injects the button for a matching root, follows navigation, and never re-probes health', async () => {
  const actions = new FakeElement('div');
  const doc = {
    getElementById: (id) => findById(actions, id),
    querySelector: (sel) => (sel === '.section-actions' ? actions : null),
    createElement: (tag) => new FakeElement(tag),
    createTextNode: (text) => ({ nodeType: 3, textContent: text }),
  };

  const subs = [
    { id: 'sub-A', channelDir: '/media/ChannelA' },
    { id: 'sub-B', channelDir: '/media/ChannelB' },
  ];

  let healthCalls = 0;
  let subsCalls = 0;
  const fetchImpl = (url) => {
    if (url === '/api/subscriptions/health') {
      healthCalls += 1;
      return Promise.resolve({ ok: true });
    }
    if (url === '/api/subscriptions') {
      subsCalls += 1;
      return Promise.resolve({ ok: true, json: () => Promise.resolve(subs) });
    }
    return Promise.reject(new Error('unexpected fetch: ' + url));
  };

  const originalDocument = global.document;
  const originalFetch = global.fetch;
  const originalWindow = global.window;
  global.document = doc;
  global.fetch = fetchImpl;
  global.window = { location: { search: '?root=' + encodeURIComponent('/media/ChannelA') } };

  try {
    // First navigation: /?root=/media/ChannelA -- a matching subscription.
    probeAndReconcileRepullButton();
    await flush();
    await flush(); // one extra tick for the chained fetch(health) -> reconcile -> fetch(subs) -> then()

    assert.strictEqual(healthCalls, 1, 'expected exactly one health probe');
    assert.strictEqual(subsCalls, 1, 'expected exactly one /api/subscriptions fetch');
    assert.strictEqual(actions.children.length, 1, 'expected the button injected for the matching root');
    assert.strictEqual(actions.children[0].id, REPULL_BTN_ID);
    assert.strictEqual(actions.children[0].dataset.subId, 'sub-A');

    // Simulate an in-app navigation to a DIFFERENT channel folder (still
    // within the subscriptions cache TTL) -- the router calls
    // probeAndReconcileRepullButton() again; the health probe must NOT
    // fire a second time, and the cached subscriptions list should be
    // reused rather than re-fetched.
    global.window.location.search = '?root=' + encodeURIComponent('/media/ChannelB');
    probeAndReconcileRepullButton();
    await flush();
    await flush();

    assert.strictEqual(healthCalls, 1, 'the one-time health probe must never re-fire on a later navigation');
    assert.strictEqual(subsCalls, 1, 'a cache-TTL-fresh subscriptions list must be reused, not re-fetched, on the very next navigation');
    assert.strictEqual(actions.children.length, 1, 'still exactly one button -- reused, not duplicated');
    assert.strictEqual(actions.children[0].dataset.subId, 'sub-B', 'the button must now target the NEW matching subscription');

    // Navigating to a folder with NO matching subscription removes it.
    global.window.location.search = '?root=' + encodeURIComponent('/media/NotSubscribed');
    probeAndReconcileRepullButton();
    await flush();
    await flush();

    assert.strictEqual(actions.children.length, 0, 'expected the button removed for a non-subscribed root');
  } finally {
    global.document = originalDocument;
    global.fetch = originalFetch;
    global.window = originalWindow;
  }
});
