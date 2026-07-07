'use strict';

// [UNIT] v1.21.0 FR-7, T6 -- extra-deliberate delete for local
// (non-yt-dlp) files.
//
// `isYtdlpManagedItem` is the fail-safe detection predicate (AC45/AC50):
// it must return `true` ONLY on a POSITIVE yt-dlp signal (a non-empty
// channelUrl/channelId/channelName, v1.20 FR-2) -- ANY absence/ambiguity
// (including every pre-v1.20 local file) must resolve to `false`, which
// callers treat as LOCAL/irreplaceable and route through the MORE
// deliberate `showHardDeleteModal`. This file exhaustively covers that
// truth table (the adversarial-review focus: the predicate can only ever
// ADD friction, never remove it -- AC51) plus `deleteFlowFor`'s mirror of
// it, and `showHardDeleteModal`'s DOM construction against a fake document,
// reusing the exact minimal fake `document`/`Element` pattern established
// by test/unit/subscribe-button.test.js / oneoff-modal-teardown.test.js
// (an `innerHTML` setter/getter that unconditionally THROWS, so any
// regression to innerHTML for a dynamic string fails loudly rather than
// silently passing).

const { test } = require('node:test');
const assert = require('node:assert');
const {
  isYtdlpManagedItem,
  deleteFlowFor,
  showHardDeleteModal,
} = require('../../public/js/common.js');

// ---- isYtdlpManagedItem: fail-safe truth table ------------------------------

test('isYtdlpManagedItem: true when channelUrl is a non-empty string', () => {
  assert.strictEqual(isYtdlpManagedItem({ channelUrl: 'https://www.youtube.com/channel/UC1' }), true);
});

test('isYtdlpManagedItem: true when channelId is a non-empty string (channelUrl absent)', () => {
  assert.strictEqual(isYtdlpManagedItem({ channelId: 'UC12345' }), true);
});

test('isYtdlpManagedItem: true when channelName is a non-empty string (channelUrl/channelId absent)', () => {
  assert.strictEqual(isYtdlpManagedItem({ channelName: 'Real Creator' }), true);
});

test('isYtdlpManagedItem: true when only PART of the signal set is present (partial-signal case)', () => {
  assert.strictEqual(isYtdlpManagedItem({ channelId: 'UC1', channelUrl: '', channelName: undefined }), true);
});

test('isYtdlpManagedItem: false when ALL THREE fields are absent (pre-v1.20 local file, the common case -- AC50)', () => {
  assert.strictEqual(isYtdlpManagedItem({ title: 'home_movie.mp4', filePath: '/media/home_movie.mp4' }), false);
});

test('isYtdlpManagedItem: false on an item with only unrelated fields (artist/folderName, a local file with tags)', () => {
  assert.strictEqual(isYtdlpManagedItem({ artist: 'Some Artist', folderName: 'Movies' }), false);
});

test('isYtdlpManagedItem: false on empty-string signal fields (never treats "" as a signal)', () => {
  assert.strictEqual(isYtdlpManagedItem({ channelUrl: '', channelId: '', channelName: '' }), false);
});

test('isYtdlpManagedItem: false on whitespace-only signal fields', () => {
  assert.strictEqual(isYtdlpManagedItem({ channelUrl: '   ', channelId: '\t', channelName: '\n' }), false);
});

test('isYtdlpManagedItem: false on non-string signal fields (malformed shape, never coerced to truthy)', () => {
  assert.strictEqual(isYtdlpManagedItem({ channelUrl: 123 }), false);
  assert.strictEqual(isYtdlpManagedItem({ channelId: true }), false);
  assert.strictEqual(isYtdlpManagedItem({ channelName: {} }), false);
  assert.strictEqual(isYtdlpManagedItem({ channelUrl: null }), false);
});

test('isYtdlpManagedItem: never throws on null/undefined/malformed input -- fails safe to false', () => {
  assert.doesNotThrow(() => isYtdlpManagedItem(null));
  assert.doesNotThrow(() => isYtdlpManagedItem(undefined));
  assert.doesNotThrow(() => isYtdlpManagedItem('a string, not an object'));
  assert.doesNotThrow(() => isYtdlpManagedItem(42));
  assert.strictEqual(isYtdlpManagedItem(null), false);
  assert.strictEqual(isYtdlpManagedItem(undefined), false);
  assert.strictEqual(isYtdlpManagedItem('nope'), false);
  assert.strictEqual(isYtdlpManagedItem(42), false);
});

test('isYtdlpManagedItem: no ambiguous/absent input can ever resolve to true (fail-safe direction, AC51)', () => {
  const ambiguousInputs = [
    {},
    { channelUrl: '' },
    { channelUrl: null },
    { channelUrl: undefined },
    { channelUrl: '  ' },
    null,
    undefined,
    { random: 'field' },
  ];
  for (const input of ambiguousInputs) {
    assert.strictEqual(isYtdlpManagedItem(input), false, `expected LOCAL (false) for ${JSON.stringify(input)}`);
  }
});

// ---- deleteFlowFor: mirrors the predicate into the caller vocabulary -------

test('deleteFlowFor: "normal" for a yt-dlp-managed item', () => {
  assert.strictEqual(deleteFlowFor({ channelUrl: 'https://www.youtube.com/@x' }), 'normal');
});

test('deleteFlowFor: "hard" for a local item (no signal at all)', () => {
  assert.strictEqual(deleteFlowFor({ title: 'local.mp4' }), 'hard');
});

test('deleteFlowFor: "hard" for null/undefined/malformed input (fails safe toward MORE friction)', () => {
  assert.strictEqual(deleteFlowFor(null), 'hard');
  assert.strictEqual(deleteFlowFor(undefined), 'hard');
});

// ---- showHardDeleteModal: DOM construction (fake document) ----------------

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.attributes = {};
    this.className = '';
    this._textContent = '';
    this._listeners = {};
    this.style = {};
    this.hidden = false;
    this.disabled = false;
    this.checked = false;
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
    throw new Error('showHardDeleteModal must never assign innerHTML -- use textContent instead');
  }

  get innerHTML() {
    throw new Error('showHardDeleteModal must never read/assign innerHTML');
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

const LOCAL_ITEM = { id: 'abc123', title: 'My Home Movie', filePath: '/media/downloads/home_movie.mp4' };

test('showHardDeleteModal: appends a backdrop to document.body immediately (self-contained, no caller boilerplate)', () => {
  const { doc, body } = makeFakeDoc();
  showHardDeleteModal(LOCAL_ITEM, () => {}, doc);
  assert.strictEqual(body.children.length, 1);
  assert.strictEqual(body.children[0].className, 'hard-delete-modal-backdrop');
});

test('showHardDeleteModal: the Delete button starts DISABLED', () => {
  const { doc } = makeFakeDoc();
  const modal = showHardDeleteModal(LOCAL_ITEM, () => {}, doc);
  assert.strictEqual(modal.deleteBtn.disabled, true);
});

test('showHardDeleteModal: ticking the checkbox enables Delete; unticking disables it again', () => {
  const { doc } = makeFakeDoc();
  const modal = showHardDeleteModal(LOCAL_ITEM, () => {}, doc);

  modal.checkbox.checked = true;
  modal.checkbox.fire('change');
  assert.strictEqual(modal.deleteBtn.disabled, false);

  modal.checkbox.checked = false;
  modal.checkbox.fire('change');
  assert.strictEqual(modal.deleteBtn.disabled, true);
});

test('showHardDeleteModal: clicking Delete while still disabled (checkbox never ticked) does NOT call onConfirm and does NOT tear down', () => {
  const { doc, body } = makeFakeDoc();
  let confirmed = false;
  const modal = showHardDeleteModal(LOCAL_ITEM, () => { confirmed = true; }, doc);

  modal.deleteBtn.click();

  assert.strictEqual(confirmed, false, 'a disabled Delete button must never trigger onConfirm');
  assert.strictEqual(body.children.length, 1, 'the modal must still be open');
});

test('showHardDeleteModal: ticking the checkbox then clicking Delete calls onConfirm exactly once and tears down', () => {
  const { doc, body } = makeFakeDoc();
  let confirmCalls = 0;
  const modal = showHardDeleteModal(LOCAL_ITEM, () => { confirmCalls += 1; }, doc);

  modal.checkbox.checked = true;
  modal.checkbox.fire('change');
  modal.deleteBtn.click();

  assert.strictEqual(confirmCalls, 1);
  assert.strictEqual(body.children.length, 0, 'the backdrop must be fully detached after confirming');
});

test('showHardDeleteModal: Cancel tears down WITHOUT calling onConfirm', () => {
  const { doc, body } = makeFakeDoc();
  let confirmed = false;
  const modal = showHardDeleteModal(LOCAL_ITEM, () => { confirmed = true; }, doc);

  modal.cancelBtn.click();

  assert.strictEqual(confirmed, false);
  assert.strictEqual(body.children.length, 0);
});

test('showHardDeleteModal: clicking the backdrop itself tears down (full teardown, no stuck overlay) WITHOUT calling onConfirm', () => {
  const { doc, body } = makeFakeDoc();
  let confirmed = false;
  const modal = showHardDeleteModal(LOCAL_ITEM, () => { confirmed = true; }, doc);

  modal.backdrop.fire('click', { target: modal.backdrop });

  assert.strictEqual(confirmed, false);
  assert.strictEqual(body.children.length, 0, 'the backdrop must be fully DETACHED, not merely hidden -- no stuck overlay (v1.17.0 pattern)');
  assert.strictEqual(modal.backdrop.parentElement, null);
});

test('showHardDeleteModal: a click bubbled from inside the modal (target is the inner dialog, not the backdrop) does NOT tear it down', () => {
  const { doc, body } = makeFakeDoc();
  const modal = showHardDeleteModal(LOCAL_ITEM, () => {}, doc);

  modal.backdrop.fire('click', { target: modal.modal });

  assert.strictEqual(body.children.length, 1, 'a click that originated inside the dialog must not close it');
});

test('showHardDeleteModal: a hostile title/filePath renders as inert text via textContent, never parsed as markup (XSS regression)', () => {
  const { doc } = makeFakeDoc();
  const hostileTitle = '<img src=x onerror=alert(1)>';
  const hostilePath = '/media/"><script>window.__xss = true;</script>.mp4';
  const modal = showHardDeleteModal({ title: hostileTitle, filePath: hostilePath }, () => {}, doc);

  assert.strictEqual(modal.nameEl.textContent, hostileTitle);
  assert.strictEqual(modal.pathEl.textContent, hostilePath);

  const tagNames = new Set([...modal.backdrop.walk()].map((el) => el.tagName));
  assert.ok(!tagNames.has('SCRIPT'));
  assert.ok(!tagNames.has('IMG'));
});

test('showHardDeleteModal: a missing/blank title falls back to a neutral placeholder, never blank/undefined text', () => {
  const { doc } = makeFakeDoc();
  const modal = showHardDeleteModal({ filePath: '/media/x.mp4' }, () => {}, doc);
  assert.strictEqual(modal.nameEl.textContent, 'this file');
});

test('showHardDeleteModal: malformed/missing item never throws (fails safe)', () => {
  const { doc } = makeFakeDoc();
  assert.doesNotThrow(() => showHardDeleteModal(null, () => {}, doc));
  assert.doesNotThrow(() => showHardDeleteModal(undefined, () => {}, doc));
});

test('showHardDeleteModal source contains no innerHTML assignment (static regression guard)', () => {
  const stripComments = (src) => src.replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(stripComments(showHardDeleteModal.toString()), /\.innerHTML\s*=/, 'showHardDeleteModal must never assign innerHTML');
});
