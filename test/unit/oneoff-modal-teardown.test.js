'use strict';

// [UNIT] v1.17.0 FR-6, T5 -- stuck one-off download modal teardown.
//
// Root cause (confirmed in docs/exec-plans/active/2026-07-06-v1.17-polish.md's
// Design -> FR-6): `.oneoff-modal-backdrop` sets `display: flex` with NO
// `[hidden]` override, so an author `display` rule beat the UA
// `[hidden] { display: none }` rule -- `backdrop.hidden = true` (the entire
// teardown `closeModal` used to do) never actually hid the full-viewport,
// `position: fixed`, `z-index: 2100` overlay. It stayed painted and ate every
// touch: the page read dimmed and dead after tapping away without submitting
// a URL.
//
// This file exercises the REAL `injectOneOffDownloadButtonIfEnabled` (not a
// re-implementation of its private `closeModal`) end-to-end against a
// minimal fake DOM, mirroring the two established fake-DOM patterns already
// in this test/unit/ suite:
//   - test/unit/oneoff-modal-mobile-polish.test.js's FakeElement/
//     makeFakeDocument/withGlobals/flush harness (fetch+DOM wiring).
//   - test/unit/ytdlp-oneoff-modal.test.js's fuller FakeElement (hidden,
//     textContent, an innerHTML setter that THROWS so any regression to
//     innerHTML fails loudly instead of silently passing).
// This FakeElement adds `parentElement` tracking + a real `remove()` (a
// `.detach-from-parent` implementation), the one extra primitive this task's
// teardown needs that neither existing fake already had.

const { test } = require('node:test');
const assert = require('node:assert');
const { injectOneOffDownloadButtonIfEnabled } = require('../../public/js/common.js');

class FakeElement {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.attributes = {};
    this.className = '';
    this._textContent = '';
    this._listeners = {};
    this.hidden = false;
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  insertBefore(newNode, refNode) {
    newNode.parentElement = this;
    const idx = this.children.indexOf(refNode);
    if (idx === -1) this.children.push(newNode);
    else this.children.splice(idx, 0, newNode);
    return newNode;
  }

  insertAdjacentElement(position, el) {
    if (!this.parentElement) return null;
    el.parentElement = this.parentElement;
    if (position === 'afterend') {
      const idx = this.parentElement.children.indexOf(this);
      this.parentElement.children.splice(idx + 1, 0, el);
    }
    return el;
  }

  // The exact primitive `closeModal` now calls: detaches this node from
  // whatever container it's currently in, mirroring the real
  // `Element.prototype.remove()`.
  remove() {
    if (this.parentElement) {
      const idx = this.parentElement.children.indexOf(this);
      if (idx >= 0) this.parentElement.children.splice(idx, 1);
      this.parentElement = null;
    }
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  getAttribute(name) {
    return this.attributes[name];
  }

  addEventListener(type, handler) {
    (this._listeners[type] = this._listeners[type] || []).push(handler);
  }

  fire(type, evt) {
    const event = evt || { target: this };
    (this._listeners[type] || []).forEach((fn) => fn(event));
  }

  click() {
    this.fire('click', { target: this });
  }

  querySelector() {
    return null; // never a pre-existing Settings link in this test's header
  }

  get textContent() {
    return this._textContent;
  }

  set textContent(value) {
    this._textContent = value;
    this.children = [];
  }

  // Same discipline as ytdlp-oneoff-modal.test.js's fake: any live
  // `innerHTML` assignment in buildOneOffModal (or anything it calls) must
  // fail this test loudly, not silently pass.
  set innerHTML(_value) {
    throw new Error('the one-off modal must never assign innerHTML -- use textContent/DOM nodes instead');
  }

  get innerHTML() {
    throw new Error('the one-off modal must never read/assign innerHTML');
  }
}

function makeFakeDocument() {
  const headerRight = new FakeElement('div');
  const body = new FakeElement('body');
  const docListeners = {};

  const doc = {
    getElementById: () => null,
    querySelector: (sel) => (sel === '.header-right' ? headerRight : null),
    createElement: (tag) => new FakeElement(tag),
    createTextNode: (text) => ({ nodeType: 3, textContent: text }),
    addEventListener: (type, handler) => { (docListeners[type] = docListeners[type] || []).push(handler); },
    body,
  };

  return { doc, headerRight, body, docListeners };
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function withGlobals(doc, fetchImpl, run) {
  const originalDocument = global.document;
  const originalFetch = global.fetch;
  const originalWindow = global.window;
  global.document = doc;
  global.fetch = fetchImpl;
  global.window = { location: { reload: () => {} } };
  return Promise.resolve()
    .then(run)
    .finally(() => {
      global.document = originalDocument;
      global.fetch = originalFetch;
      global.window = originalWindow;
    });
}

// Boots the module-enabled injection and returns the header button, ready to
// be clicked to open the modal.
async function bootAndOpen({ doc, headerRight }) {
  injectOneOffDownloadButtonIfEnabled();
  await flush();
  const headerBtn = headerRight.children.find((c) => c.id === 'ytdlp-oneoff-btn');
  assert.ok(headerBtn, 'expected the header button to be injected');
  headerBtn.click();
  return headerBtn;
}

test('backdrop-dismiss WITHOUT submitting a URL fully tears down the modal: the backdrop node is detached from document.body', async () => {
  const { doc, headerRight, body } = makeFakeDocument();
  await withGlobals(doc, () => Promise.resolve({ ok: true, status: 200 }), async () => {
    await bootAndOpen({ doc, headerRight });

    assert.strictEqual(body.children.length, 1, 'expected the backdrop appended to document.body on open');
    const backdrop = body.children[0];
    assert.strictEqual(backdrop.hidden, false, 'expected the modal visible after open');

    // A direct click on the backdrop itself (target === backdrop) -- the
    // "tap away without submitting a URL" case that used to leave the page
    // stuck dimmed/unresponsive.
    backdrop.fire('click', { target: backdrop });

    assert.strictEqual(body.children.length, 0, 'the backdrop must be fully detached from document.body, not merely hidden');
    assert.strictEqual(backdrop.parentElement, null, 'the detached node must have no parent left');
  });
});

test('the [x] close button hits the SAME teardown as a backdrop tap', async () => {
  const { doc, headerRight, body } = makeFakeDocument();
  await withGlobals(doc, () => Promise.resolve({ ok: true, status: 200 }), async () => {
    await bootAndOpen({ doc, headerRight });
    const backdrop = body.children[0];
    const modal = backdrop.children.find((c) => c.className === 'oneoff-modal');
    const header = modal && modal.children.find((c) => c.className === 'oneoff-modal-header');
    const closeBtn = header && header.children.find((c) => c.className === 'oneoff-modal-close');
    assert.ok(closeBtn, 'expected the [x] close button inside the modal header');

    closeBtn.click();

    assert.strictEqual(body.children.length, 0, 'the [x] button must fully detach the backdrop, same as a backdrop tap');
  });
});

test('Esc fully tears down an OPEN modal the same way', async () => {
  const { doc, headerRight, body, docListeners } = makeFakeDocument();
  await withGlobals(doc, () => Promise.resolve({ ok: true, status: 200 }), async () => {
    await bootAndOpen({ doc, headerRight });
    assert.strictEqual(body.children.length, 1);

    docListeners.keydown.forEach((fn) => fn({ key: 'Escape' }));

    assert.strictEqual(body.children.length, 0, 'Esc must fully detach the backdrop while the modal is open');
  });
});

test('Esc is an inert no-op once the modal is already closed (no dangling reference/duplicate teardown)', async () => {
  const { doc, headerRight, body, docListeners } = makeFakeDocument();
  await withGlobals(doc, () => Promise.resolve({ ok: true, status: 200 }), async () => {
    await bootAndOpen({ doc, headerRight });
    const backdrop = body.children[0];
    backdrop.fire('click', { target: backdrop }); // close it first
    assert.strictEqual(body.children.length, 0);

    // Must not throw, and must not somehow re-add/duplicate anything.
    assert.doesNotThrow(() => docListeners.keydown.forEach((fn) => fn({ key: 'Escape' })));
    assert.strictEqual(body.children.length, 0);
  });
});

test('reopening after a teardown rebuilds a FRESH modal (a new node), not a reference to the torn-down one', async () => {
  const { doc, headerRight, body } = makeFakeDocument();
  await withGlobals(doc, () => Promise.resolve({ ok: true, status: 200 }), async () => {
    const headerBtn = await bootAndOpen({ doc, headerRight });
    const firstBackdrop = body.children[0];
    firstBackdrop.fire('click', { target: firstBackdrop });
    assert.strictEqual(body.children.length, 0);

    headerBtn.click(); // reopen

    assert.strictEqual(body.children.length, 1, 'expected a fresh backdrop appended on reopen');
    const secondBackdrop = body.children[0];
    assert.notStrictEqual(secondBackdrop, firstBackdrop, 'reopen must rebuild fresh, not reuse the torn-down node');
    assert.strictEqual(secondBackdrop.hidden, false);
  });
});

test('a click that bubbled from inside the modal (target is the inner .oneoff-modal, not the backdrop) does NOT tear it down', async () => {
  const { doc, headerRight, body } = makeFakeDocument();
  await withGlobals(doc, () => Promise.resolve({ ok: true, status: 200 }), async () => {
    await bootAndOpen({ doc, headerRight });
    const backdrop = body.children[0];
    const modal = backdrop.children.find((c) => c.className === 'oneoff-modal');
    assert.ok(modal, 'expected the inner .oneoff-modal dialog');

    backdrop.fire('click', { target: modal });

    assert.strictEqual(body.children.length, 1, 'a click that originated inside the dialog must not close it');
  });
});
