'use strict';

// [UNIT] C1 (v1.24 UX Round, Wave 3) -- client half of the move-files
// feature: `showMoveModal` (a pure, self-contained DOM builder) and
// `requestMoveItem` (the `POST /api/videos/:id/move` caller). Mirrors
// test/unit/hard-delete-local-files.test.js's fake-DOM harness pattern
// (an `innerHTML` setter/getter that unconditionally THROWS, so any
// regression to innerHTML for a dynamic string fails loudly rather than
// silently passing) plus a minimal `<select>`/`<option>` shape neither of
// that file's existing FakeElements needed.

const { test } = require('node:test');
const assert = require('node:assert');
const { showMoveModal, requestMoveItem } = require('../../public/js/common.js');

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.attributes = {};
    this.className = '';
    this._textContent = '';
    this._listeners = {};
    this.disabled = false;
    this.value = undefined;
    this.parentElement = null;
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

  setAttribute(name, value) {
    this.attributes[name] = value;
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

  get textContent() {
    return this._textContent;
  }

  set textContent(value) {
    this._textContent = value;
    this.children = [];
  }

  set innerHTML(_value) {
    throw new Error('showMoveModal must never assign innerHTML -- use textContent/DOM nodes instead');
  }

  get innerHTML() {
    throw new Error('showMoveModal must never read/assign innerHTML');
  }

  *walk() {
    yield this;
    for (const child of this.children) {
      if (child instanceof FakeElement) yield* child.walk();
    }
  }
}

function makeFakeDoc() {
  const body = new FakeElement('body');
  return {
    doc: {
      createElement: (tag) => new FakeElement(tag),
      createTextNode: (text) => ({ nodeType: 3, textContent: text }),
      body,
    },
    body,
  };
}

const ITEM = { id: 'abc123', title: 'My Vacation', filePath: '/media/lib/My Vacation.mp4' };
const FOLDERS = ['/media/lib', '/media/other'];

// ---- showMoveModal: DOM construction ---------------------------------------

test('showMoveModal: appends a backdrop to document.body immediately (self-contained, no caller boilerplate)', () => {
  const { doc, body } = makeFakeDoc();
  showMoveModal(ITEM, FOLDERS, () => {}, doc);
  assert.strictEqual(body.children.length, 1);
  assert.strictEqual(body.children[0].className, 'modal-backdrop');
});

test('showMoveModal: reuses the GENERIC modal classes, never a new/hard-delete/oneoff class family', () => {
  const { doc } = makeFakeDoc();
  const modal = showMoveModal(ITEM, FOLDERS, () => {}, doc);
  assert.strictEqual(modal.backdrop.className, 'modal-backdrop');
  assert.strictEqual(modal.modal.className, 'modal-content');
  assert.strictEqual(modal.title.className, 'modal-title');
  assert.strictEqual(modal.moveBtn.className, 'btn btn-primary');
  assert.strictEqual(modal.cancelBtn.className, 'btn');
});

test('showMoveModal: populates the folder <select> with exactly the given folders, as option values', () => {
  const { doc } = makeFakeDoc();
  const modal = showMoveModal(ITEM, FOLDERS, () => {}, doc);
  const optionValues = modal.select.children.map((opt) => opt.value);
  assert.deepStrictEqual(optionValues, FOLDERS);
});

test('showMoveModal: the item title is rendered via a dedicated text node/textContent, never innerHTML (hostile title is inert)', () => {
  const { doc } = makeFakeDoc();
  const hostileItem = { id: 'x', title: '<img src=x onerror=alert(1)>' };
  // Must not throw (would throw if it ever assigned innerHTML -- see the fake's guard above).
  assert.doesNotThrow(() => showMoveModal(hostileItem, FOLDERS, () => {}, doc));
});

test('showMoveModal: the Move button is DISABLED when no folders are configured', () => {
  const { doc } = makeFakeDoc();
  const modal = showMoveModal(ITEM, [], () => {}, doc);
  assert.strictEqual(modal.moveBtn.disabled, true);
});

test('showMoveModal: the Move button is enabled when at least one folder is configured', () => {
  const { doc } = makeFakeDoc();
  const modal = showMoveModal(ITEM, FOLDERS, () => {}, doc);
  assert.strictEqual(modal.moveBtn.disabled, false);
});

test('showMoveModal: clicking Move with a selected folder calls onMove(targetFolder, ...) exactly once', () => {
  const { doc } = makeFakeDoc();
  let calls = [];
  const modal = showMoveModal(ITEM, FOLDERS, (target, ctx) => { calls.push({ target, ctx }); }, doc);
  modal.select.value = '/media/other';
  modal.moveBtn.click();
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].target, '/media/other');
  assert.strictEqual(typeof calls[0].ctx.teardown, 'function');
});

test('showMoveModal: onMove does NOT auto-teardown the modal -- the caller controls teardown timing (e.g. after a successful request)', () => {
  const { doc, body } = makeFakeDoc();
  const modal = showMoveModal(ITEM, FOLDERS, () => {}, doc);
  modal.select.value = '/media/lib';
  modal.moveBtn.click();
  assert.strictEqual(body.children.length, 1, 'the modal must still be open until the caller explicitly tears it down');
});

test('showMoveModal: clicking Move while disabled (no folders) never calls onMove', () => {
  const { doc } = makeFakeDoc();
  let called = false;
  const modal = showMoveModal(ITEM, [], () => { called = true; }, doc);
  modal.moveBtn.click();
  assert.strictEqual(called, false);
});

test('showMoveModal: Cancel tears down without calling onMove', () => {
  const { doc, body } = makeFakeDoc();
  let called = false;
  const modal = showMoveModal(ITEM, FOLDERS, () => { called = true; }, doc);
  modal.cancelBtn.click();
  assert.strictEqual(called, false);
  assert.strictEqual(body.children.length, 0);
});

test('showMoveModal: clicking the backdrop itself tears down (full teardown, no stuck overlay) without calling onMove', () => {
  const { doc, body } = makeFakeDoc();
  let called = false;
  const modal = showMoveModal(ITEM, FOLDERS, () => { called = true; }, doc);
  modal.backdrop.fire('click', { target: modal.backdrop });
  assert.strictEqual(called, false);
  assert.strictEqual(body.children.length, 0);
  assert.strictEqual(modal.backdrop.parentElement, null);
});

test('showMoveModal: a click bubbled from inside the modal (target is the inner dialog) does NOT tear it down', () => {
  const { doc, body } = makeFakeDoc();
  const modal = showMoveModal(ITEM, FOLDERS, () => {}, doc);
  modal.backdrop.fire('click', { target: modal.modal });
  assert.strictEqual(body.children.length, 1);
});

test('showMoveModal: caller-invoked teardown() fully detaches the backdrop', () => {
  const { doc, body } = makeFakeDoc();
  const modal = showMoveModal(ITEM, FOLDERS, (target, ctx) => ctx.teardown(), doc);
  modal.select.value = '/media/lib';
  modal.moveBtn.click();
  assert.strictEqual(body.children.length, 0);
});

test('showMoveModal: falls back to a generic label when the item has no title', () => {
  const { doc } = makeFakeDoc();
  assert.doesNotThrow(() => showMoveModal({ id: 'noTitle' }, FOLDERS, () => {}, doc));
});

// ---- requestMoveItem: the POST /api/videos/:id/move caller -----------------

function fakeFetchErr(status, body) {
  return () => Promise.resolve({ ok: false, status, json: () => Promise.resolve(body) });
}

test('requestMoveItem: POSTs the correct URL/method/body and resolves with the parsed JSON on success', async () => {
  const calls = [];
  const fetchImpl = (url, opts) => {
    calls.push({ url, opts });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ success: true, id: 'newId' }) });
  };
  const result = await requestMoveItem('abc123', '/media/other', fetchImpl);
  assert.deepStrictEqual(result, { success: true, id: 'newId' });
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].url, '/api/videos/abc123/move');
  assert.strictEqual(calls[0].opts.method, 'POST');
  assert.deepStrictEqual(JSON.parse(calls[0].opts.body), { targetFolder: '/media/other' });
});

test('requestMoveItem: URL-encodes the id', async () => {
  const calls = [];
  const fetchImpl = (url) => { calls.push(url); return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }); };
  await requestMoveItem('id with spaces/slash', '/media/other', fetchImpl);
  assert.strictEqual(calls[0], `/api/videos/${encodeURIComponent('id with spaces/slash')}/move`);
});

test('requestMoveItem: rejects with the server-provided error message on a non-2xx response', async () => {
  await assert.rejects(
    () => requestMoveItem('abc123', '/media/other', fakeFetchErr(400, { error: 'targetFolder is outside every configured/allowed library folder' })),
    /outside every configured/,
  );
});

test('requestMoveItem: rejects with a generic message when the server error body is malformed/empty', async () => {
  await assert.rejects(
    () => requestMoveItem('abc123', '/media/other', fakeFetchErr(500, {})),
    /Move failed \(500\)/,
  );
});

test('requestMoveItem: resolves on a plain 200 with no body edge case (never throws on an empty/malformed JSON body)', async () => {
  const fetchImpl = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.reject(new Error('no body')) });
  const result = await requestMoveItem('abc123', '/media/other', fetchImpl);
  assert.deepStrictEqual(result, {});
});

test('requestMoveItem: rejects cleanly when fetch itself is unavailable (no global fetch, no injected fetchImpl)', async () => {
  // Node 22 provides a global `fetch` -- temporarily remove it so this test
  // exercises the "no fetch at all" branch deterministically, restoring it
  // afterward so no other test in this process is affected.
  const realFetch = global.fetch;
  delete global.fetch;
  try {
    await assert.rejects(() => requestMoveItem('abc123', '/media/other', null), /fetch is not available/);
  } finally {
    global.fetch = realFetch;
  }
});
