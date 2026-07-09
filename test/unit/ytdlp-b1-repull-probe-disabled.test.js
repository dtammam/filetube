'use strict';

// [UNIT] v1.24.1 fast-follow -- B1's relocated "Re-pull this channel now"
// widget: the DISABLED-module path through `probeAndReconcileRepullButton`.
// Kept in its OWN file/process (see ytdlp-b1-repull-probe-enabled.test.js's
// header comment for why) so this file's freshly-required module instance
// starts with `repullHealthChecked`/`repullModuleEnabled` unlatched,
// independent of the "enabled" file's own one-time latch.

const { test } = require('node:test');
const assert = require('node:assert');
const { probeAndReconcileRepullButton } = require('../../public/js/common.js');

class FakeElement {
  constructor(tag) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.children = [];
    this.id = '';
  }
  appendChild(child) { this.children.push(child); return child; }
  remove() {}
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test('probeAndReconcileRepullButton (module DISABLED): a 404 health probe permanently latches inert -- no DOM writes, no /api/subscriptions fetch, ever, even across repeated calls/navigations', async () => {
  const actions = new FakeElement('div');
  const doc = {
    getElementById: () => null,
    querySelector: (sel) => (sel === '.section-actions' ? actions : null),
    createElement: (tag) => new FakeElement(tag),
    createTextNode: (text) => ({ nodeType: 3, textContent: text }),
  };

  let healthCalls = 0;
  let subsCalls = 0;
  const fetchImpl = (url) => {
    if (url === '/api/subscriptions/health') {
      healthCalls += 1;
      return Promise.resolve({ ok: false, status: 404 });
    }
    if (url === '/api/subscriptions') {
      subsCalls += 1;
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    }
    return Promise.reject(new Error('unexpected fetch: ' + url));
  };

  const originalDocument = global.document;
  const originalFetch = global.fetch;
  const originalWindow = global.window;
  global.document = doc;
  global.fetch = fetchImpl;
  global.window = { location: { search: '?root=' + encodeURIComponent('/media/SomeChannel') } };

  try {
    probeAndReconcileRepullButton();
    await flush();
    await flush();

    assert.strictEqual(healthCalls, 1, 'expected exactly one health probe attempt');
    assert.strictEqual(subsCalls, 0, 'a disabled module must NEVER fetch /api/subscriptions');
    assert.strictEqual(actions.children.length, 0, 'a disabled module must never write any DOM for this widget');

    // A later "navigation" (another router hook call) must remain fully
    // inert -- no repeated health probe, no subscriptions fetch, no DOM.
    global.window.location.search = '?root=' + encodeURIComponent('/media/AnotherChannel');
    probeAndReconcileRepullButton();
    probeAndReconcileRepullButton();
    await flush();
    await flush();

    assert.strictEqual(healthCalls, 1, 'the health probe must never re-fire once latched disabled');
    assert.strictEqual(subsCalls, 0, 'still no /api/subscriptions fetch on any later navigation');
    assert.strictEqual(actions.children.length, 0, 'still no DOM writes on any later navigation');
  } finally {
    global.document = originalDocument;
    global.fetch = originalFetch;
    global.window = originalWindow;
  }
});
