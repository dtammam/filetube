'use strict';

// [UNIT] v1.20.0 FR-1/FR-3 (T3) -- the watch-page Subscribe toggle's pure
// decision helpers + the compact subscribe-confirm modal builder, all added
// to public/js/common.js. See
// docs/exec-plans/active/2026-07-08-v1.20-subscribe.md ("FR-1 -- subscribe
// toggle + compact options modal" / "FR-3 -- hide when no channel / module
// disabled") for the full design/rationale.
//
// `buildSubscribeModal`'s DOM-construction tests reuse the exact minimal fake
// `document`/`Element` pattern established by test/unit/ytdlp-oneoff-modal.test.js
// (an `innerHTML` setter that unconditionally THROWS, so any regression to
// innerHTML for a dynamic string fails loudly rather than silently passing).

const { test } = require('node:test');
const assert = require('node:assert');
const {
  shouldShowSubscribeButton,
  decideSubscribeButtonState,
  buildSubscribeRequestBody,
  buildSubscribeModal,
} = require('../../public/js/common.js');

// ---- shouldShowSubscribeButton ---------------------------------------------

test('shouldShowSubscribeButton: true iff moduleEnabled===true AND channelIdentity is non-null', () => {
  assert.strictEqual(shouldShowSubscribeButton({ moduleEnabled: true, channelIdentity: { channelUrl: 'x' } }), true);
});

test('shouldShowSubscribeButton: module disabled -> false regardless of identity', () => {
  assert.strictEqual(shouldShowSubscribeButton({ moduleEnabled: false, channelIdentity: { channelUrl: 'x' } }), false);
});

test('shouldShowSubscribeButton: no channel identity -> false even when the module is enabled', () => {
  assert.strictEqual(shouldShowSubscribeButton({ moduleEnabled: true, channelIdentity: null }), false);
});

test('shouldShowSubscribeButton: a truthy-but-not-strictly-true moduleEnabled never shows (fail closed)', () => {
  assert.strictEqual(shouldShowSubscribeButton({ moduleEnabled: 1, channelIdentity: { channelUrl: 'x' } }), false);
  assert.strictEqual(shouldShowSubscribeButton({ moduleEnabled: 'true', channelIdentity: { channelUrl: 'x' } }), false);
});

// ---- decideSubscribeButtonState --------------------------------------------

const YT_DLP_ITEM = { channelUrl: 'https://www.youtube.com/channel/UC12345', channelId: 'UC12345' };
const NON_YTDLP_ITEM = { artist: 'Some Artist', folderName: 'Movies' };

test('decideSubscribeButtonState: module disabled -> hidden regardless of matching subscriptions', () => {
  const subs = [{ id: 'sub-1', channelUrl: 'https://www.youtube.com/channel/UC12345' }];
  const state = decideSubscribeButtonState(YT_DLP_ITEM, subs, false);
  assert.deepStrictEqual(state, { visible: false, subscribed: false, subId: null, identity: null });
});

test('decideSubscribeButtonState: no resolvable channel identity -> hidden even when the module is enabled', () => {
  const state = decideSubscribeButtonState(NON_YTDLP_ITEM, [], true);
  assert.deepStrictEqual(state, { visible: false, subscribed: false, subId: null, identity: null });
});

test('decideSubscribeButtonState: resolvable identity, NO matching subscription -> visible + "Subscribe" (not subscribed)', () => {
  const state = decideSubscribeButtonState(YT_DLP_ITEM, [], true);
  assert.strictEqual(state.visible, true);
  assert.strictEqual(state.subscribed, false);
  assert.strictEqual(state.subId, null);
  assert.deepStrictEqual(state.identity, { channelUrl: 'https://www.youtube.com/channel/UC12345', channelId: 'UC12345' });
});

test('decideSubscribeButtonState: resolvable identity WITH a matching subscription -> visible + "Subscribed", carries the matched id', () => {
  const subs = [
    { id: 'other', channelUrl: 'https://www.youtube.com/channel/UCOTHER' },
    { id: 'sub-42', channelUrl: 'https://www.youtube.com/channel/UC12345' },
  ];
  const state = decideSubscribeButtonState(YT_DLP_ITEM, subs, true);
  assert.strictEqual(state.visible, true);
  assert.strictEqual(state.subscribed, true);
  assert.strictEqual(state.subId, 'sub-42');
});

test('decideSubscribeButtonState: matches via the canonical matcher (differing URL shapes), never naive string equality', () => {
  // File's own channelUrl is a /@handle; the persisted subscription is a
  // /channel/UC... -- these are provably the same channel via the shared
  // channelId key (see channelIdentityMatches, T2).
  const item = { channelUrl: 'https://www.youtube.com/@somecreator', channelId: 'UC99999' };
  const subs = [{ id: 'sub-x', channelUrl: 'https://www.youtube.com/channel/UC99999' }];
  const state = decideSubscribeButtonState(item, subs, true);
  assert.strictEqual(state.subscribed, true);
  assert.strictEqual(state.subId, 'sub-x');
});

test('decideSubscribeButtonState: malformed/missing input never throws', () => {
  assert.doesNotThrow(() => decideSubscribeButtonState(null, null, true));
  assert.doesNotThrow(() => decideSubscribeButtonState(undefined, undefined, undefined));
  const state = decideSubscribeButtonState(null, null, true);
  assert.strictEqual(state.visible, false);
});

// ---- buildSubscribeRequestBody: the exact POST body shape ------------------

test('buildSubscribeRequestBody: builds the field names store.validateSubscriptionInput expects', () => {
  const body = buildSubscribeRequestBody(
    'https://www.youtube.com/channel/UC12345',
    'Real Creator',
    'video',
    'best',
    '2',
    false,
    'mp4'
  );
  assert.deepStrictEqual(body, {
    channelUrl: 'https://www.youtube.com/channel/UC12345',
    format: 'video',
    quality: 'best',
    skipShorts: false,
    name: 'Real Creator',
    filetype: 'mp4',
    maxVideos: 2,
  });
});

test('buildSubscribeRequestBody: blank/whitespace name is omitted (never sent as an empty string)', () => {
  const body = buildSubscribeRequestBody('https://www.youtube.com/@x', '   ', 'audio', 'best', '2', true, undefined);
  assert.strictEqual('name' in body, false);
  assert.strictEqual('filetype' in body, false);
});

test('buildSubscribeRequestBody: an invalid/blank maxVideos is omitted, not coerced to 0/NaN', () => {
  const body = buildSubscribeRequestBody('https://www.youtube.com/@x', 'X', 'video', 'best', '', false, 'mp4');
  assert.strictEqual('maxVideos' in body, false);

  const body2 = buildSubscribeRequestBody('https://www.youtube.com/@x', 'X', 'video', 'best', 'not-a-number', false, 'mp4');
  assert.strictEqual('maxVideos' in body2, false);
});

test('buildSubscribeRequestBody: skipShorts is always an explicit boolean, coerced from any truthy/falsy input', () => {
  assert.strictEqual(buildSubscribeRequestBody('u', 'n', 'video', 'best', '1', 1, undefined).skipShorts, true);
  assert.strictEqual(buildSubscribeRequestBody('u', 'n', 'video', 'best', '1', 0, undefined).skipShorts, false);
});

// ---- buildSubscribeModal: DOM construction ---------------------------------

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
    this.checked = false;
    this.value = undefined;
    this.parentElement = null;
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  get firstChild() {
    return this.children.length > 0 ? this.children[0] : null;
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx >= 0) this.children.splice(idx, 1);
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
    throw new Error('buildSubscribeModal must never assign innerHTML -- use textContent instead');
  }

  get innerHTML() {
    throw new Error('buildSubscribeModal must never read/assign innerHTML');
  }

  *walk() {
    yield this;
    for (const child of this.children) {
      if (child instanceof FakeElement) yield* child.walk();
    }
  }
}

const fakeDoc = {
  createElement: (tag) => new FakeElement(tag),
  createTextNode: (text) => ({ nodeType: 3, textContent: text }),
};

test('buildSubscribeModal: starts hidden, renders the read-only identity via textContent, pre-fills format/quality/filetype/maxVideos', () => {
  const modal = buildSubscribeModal(fakeDoc, {
    channelName: 'Real Creator Name',
    channelUrl: 'https://www.youtube.com/channel/UC12345',
    format: 'audio',
    defaultMaxVideos: 2,
  }, {});

  assert.strictEqual(modal.backdrop.hidden, true, 'modal must start hidden');
  assert.strictEqual(modal.modal.hidden, true);

  // READ-ONLY identity -- textContent only, never an editable input.
  assert.strictEqual(modal.identityName.textContent, 'Real Creator Name');
  assert.strictEqual(modal.identityUrl.textContent, 'https://www.youtube.com/channel/UC12345');
  assert.notStrictEqual(modal.identityName.tagName, 'INPUT', 'identity name must not be an editable field');
  assert.notStrictEqual(modal.identityUrl.tagName, 'INPUT', 'identity url must not be an editable field');

  assert.strictEqual(modal.formatSelect.value, 'audio', 'format pre-filled from the file\'s own media type');
  assert.strictEqual(modal.qualitySelect.value, 'best');
  assert.strictEqual(modal.filetypeSelect.value, 'mp3', 'filetype defaults to the audio allowlist\'s recommended value');
  assert.strictEqual(modal.maxVideosInput.value, '2', 'maxVideos pre-filled from defaultMaxVideos (AC26)');
  assert.strictEqual(modal.skipShortsCheck.checked, false, 'skip-Shorts defaults to OFF');

  // Only the known, fixed set of tags may exist anywhere in the built modal.
  const tagNames = new Set([...modal.backdrop.walk()].map((el) => el.tagName));
  for (const tag of tagNames) {
    assert.ok(['DIV', 'SPAN', 'BUTTON', 'SELECT', 'OPTION', 'INPUT', 'LABEL'].includes(tag), `unexpected element tag: ${tag}`);
  }
});

test('buildSubscribeModal: an omitted/invalid defaultMaxVideos falls back to 2 (never blank/NaN)', () => {
  const modal = buildSubscribeModal(fakeDoc, { channelUrl: 'https://www.youtube.com/@x' }, {});
  assert.strictEqual(modal.maxVideosInput.value, '2');

  const modal2 = buildSubscribeModal(fakeDoc, { channelUrl: 'https://www.youtube.com/@x', defaultMaxVideos: -1 }, {});
  assert.strictEqual(modal2.maxVideosInput.value, '2');
});

test('buildSubscribeModal: missing channelName falls back to a neutral placeholder, never blank/undefined text', () => {
  const modal = buildSubscribeModal(fakeDoc, { channelUrl: 'https://www.youtube.com/@x' }, {});
  assert.strictEqual(modal.identityName.textContent, 'This channel');
});

test('buildSubscribeModal: switching format to audio repopulates the filetype select (shared reducer wiring, AC7)', () => {
  const modal = buildSubscribeModal(fakeDoc, { channelUrl: 'https://www.youtube.com/@x', format: 'video' }, {});
  modal.formatSelect.value = 'audio';
  modal.formatSelect.fire('change');
  assert.deepStrictEqual(modal.filetypeSelect.children.map((o) => o.value), ['mp3', 'm4a', 'opus', 'default']);
  assert.strictEqual(modal.filetypeSelect.value, 'mp3');
});

test('buildSubscribeModal: confirm calls onConfirm with the exact body built from the chosen control values (AC4)', () => {
  const calls = [];
  const modal = buildSubscribeModal(fakeDoc, {
    channelName: 'Real Creator',
    channelUrl: 'https://www.youtube.com/channel/UC12345',
    format: 'video',
    defaultMaxVideos: 2,
  }, { onConfirm: (body) => calls.push(body) });

  modal.qualitySelect.value = '720p';
  modal.maxVideosInput.value = '5';
  modal.skipShortsCheck.checked = true;
  modal.confirmBtn.click();

  assert.strictEqual(calls.length, 1);
  assert.deepStrictEqual(calls[0], {
    channelUrl: 'https://www.youtube.com/channel/UC12345',
    name: 'Real Creator',
    format: 'video',
    quality: '720p',
    maxVideos: 5,
    skipShorts: true,
    filetype: 'mp4',
  });
});

test('buildSubscribeModal: Cancel calls onClose and does NOT call onConfirm', () => {
  let closed = false;
  const confirmCalls = [];
  const modal = buildSubscribeModal(fakeDoc, { channelUrl: 'https://www.youtube.com/@x' }, {
    onClose: () => { closed = true; },
    onConfirm: (body) => confirmCalls.push(body),
  });
  modal.cancelBtn.click();
  assert.strictEqual(closed, true);
  assert.strictEqual(confirmCalls.length, 0);
});

test('buildSubscribeModal: the [x] close button calls onClose, not onConfirm', () => {
  let closed = false;
  const modal = buildSubscribeModal(fakeDoc, { channelUrl: 'https://www.youtube.com/@x' }, { onClose: () => { closed = true; } });
  modal.closeBtn.click();
  assert.strictEqual(closed, true);
});

test('buildSubscribeModal: clicking the backdrop itself calls onClose, but a click bubbled from inside the modal does not', () => {
  let closeCalls = 0;
  const modal = buildSubscribeModal(fakeDoc, { channelUrl: 'https://www.youtube.com/@x' }, { onClose: () => { closeCalls += 1; } });

  modal.backdrop.fire('click', { target: modal.backdrop });
  assert.strictEqual(closeCalls, 1);

  modal.backdrop.fire('click', { target: modal.modal });
  assert.strictEqual(closeCalls, 1, 'a click on the inner modal content must not close it');
});

test('buildSubscribeModal: setError renders a hostile string as inert text via textContent, never innerHTML (XSS regression)', () => {
  const modal = buildSubscribeModal(fakeDoc, { channelUrl: 'https://www.youtube.com/@x' }, {});
  const hostile = '<img src=x onerror=alert(1)>';
  assert.doesNotThrow(() => modal.setError(hostile));
  assert.strictEqual(modal.statusEl.textContent, hostile);

  const tagNames = new Set([...modal.backdrop.walk()].map((el) => el.tagName));
  assert.ok(!tagNames.has('SCRIPT'));
  assert.ok(!tagNames.has('IMG'));
});

test('buildSubscribeModal: a hostile channelName/channelUrl renders as inert text, never parsed as markup (XSS regression)', () => {
  const hostileName = '<script>window.__xss = true;</script>';
  const hostileUrl = 'https://www.youtube.com/@x"><img src=x onerror=alert(1)>';
  const modal = buildSubscribeModal(fakeDoc, { channelName: hostileName, channelUrl: hostileUrl }, {});
  assert.strictEqual(modal.identityName.textContent, hostileName);
  assert.strictEqual(modal.identityUrl.textContent, hostileUrl);

  const tagNames = new Set([...modal.backdrop.walk()].map((el) => el.tagName));
  assert.ok(!tagNames.has('SCRIPT'));
  assert.ok(!tagNames.has('IMG'));
});

// ---- Static-source regression guard: no innerHTML in the new builder ------

test('buildSubscribeModal source contains no innerHTML assignment (static regression guard)', () => {
  const stripComments = (src) => src.replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(stripComments(buildSubscribeModal.toString()), /\.innerHTML\s*=/, 'buildSubscribeModal must never assign innerHTML');
});
