'use strict';

// [UNIT] v1.55 Track C - the ONE busy/status feedback system (Dean: "a more
// unified system for that type of thing across the settings pages").
// setActionStatus/setButtonBusy are the only writers of the tone classes;
// the subscriptions client's control appliers are re-driven here with fake
// elements to prove the busy state now TRACKS running-ness (the old code
// only ever wrote text), and the never-clearing info lines are proven NOT
// busy (a spinner with no clearing writer would spin forever).

const { test } = require('node:test');
const assert = require('node:assert');
const { setActionStatus, setButtonBusy } = require('../../public/js/common.js');

// The subscriptions client reads the helpers as browser globals with a
// typeof guard -- expose them BEFORE require so the wiring under test runs
// the real classList path, not the Node fallback.
global.setActionStatus = setActionStatus;
global.setButtonBusy = setButtonBusy;
const {
  applyReheatStateToControls,
  applyRefreshAvatarsStateToControls,
  triggerReheat,
} = require('../../lib/ytdlp/client/subscriptions.js');

function fakeClassList() {
  const set = new Set();
  return {
    toggle(name, force) {
      const on = force === undefined ? !set.has(name) : Boolean(force);
      if (on) set.add(name); else set.delete(name);
      return on;
    },
    add(name) { set.add(name); },
    remove(name) { set.delete(name); },
    contains(name) { return set.has(name); },
  };
}
function fakeEl() {
  return { textContent: '', hidden: false, disabled: false, classList: fakeClassList() };
}

test('setActionStatus: text + tone in one call; null text updates tone only', () => {
  const el = fakeEl();
  setActionStatus(el, 'Working…', 'busy');
  assert.equal(el.textContent, 'Working…');
  assert.equal(el.classList.contains('action-status-busy'), true);
  setActionStatus(el, null, undefined);
  assert.equal(el.textContent, 'Working…', 'null text preserves the line');
  assert.equal(el.classList.contains('action-status-busy'), false, 'but the stale spinner clears');
  setActionStatus(el, 'Broke.', 'error');
  assert.equal(el.classList.contains('action-status-error'), true);
  assert.equal(el.classList.contains('action-status-busy'), false, 'tones are mutually exclusive');
  assert.doesNotThrow(() => setActionStatus(null, 'x'), 'null element is a no-op');
});

test('setButtonBusy: disabled and the spinner class can never desync', () => {
  const btn = fakeEl();
  setButtonBusy(btn, true);
  assert.equal(btn.disabled, true);
  assert.equal(btn.classList.contains('btn-busy'), true);
  setButtonBusy(btn, false);
  assert.equal(btn.disabled, false);
  assert.equal(btn.classList.contains('btn-busy'), false);
});

test('applyReheatStateToControls: running drives button-busy AND status-busy; idle clears both, preserving the summary text', () => {
  const elements = { button: fakeEl(), cancelButton: fakeEl(), status: fakeEl() };
  elements.status.textContent = 'Reheat summary line';
  applyReheatStateToControls(elements, { state: 'running', total: 10, done: 2 });
  assert.equal(elements.button.disabled, true);
  assert.equal(elements.button.classList.contains('btn-busy'), true);
  assert.equal(elements.status.classList.contains('action-status-busy'), true);
  applyReheatStateToControls(elements, { state: 'done', total: 10, done: 10 });
  assert.equal(elements.button.classList.contains('btn-busy'), false);
  assert.equal(elements.status.classList.contains('action-status-busy'), false,
    'the spinner MUST stop when the batch ends, even when the text is left alone');
});

test('applyRefreshAvatarsStateToControls: same contract as the reheat applier', () => {
  const elements = { button: fakeEl(), cancelButton: fakeEl(), status: fakeEl() };
  applyRefreshAvatarsStateToControls(elements, { state: 'running', total: 5 });
  assert.equal(elements.button.classList.contains('btn-busy'), true);
  assert.equal(elements.status.classList.contains('action-status-busy'), true);
  applyRefreshAvatarsStateToControls(elements, undefined);
  assert.equal(elements.button.classList.contains('btn-busy'), false);
  assert.equal(elements.status.classList.contains('action-status-busy'), false);
});

test('triggerReheat: failure renders the error tone and re-enables the button', async () => {
  const elements = { button: fakeEl(), status: fakeEl() };
  await new Promise((resolve) => {
    triggerReheat(elements, () => Promise.resolve({
      ok: false, status: 500, json: () => Promise.resolve({}),
    }));
    setImmediate(resolve);
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(elements.status.classList.contains('action-status-error'), true);
  assert.equal(elements.button.disabled, false, 'a failed start must re-enable the button');
  assert.equal(elements.button.classList.contains('btn-busy'), false);
});

// The never-clearing one-shot info lines must NOT be 'busy' (nothing ever
// clears them -- a spinner there would spin forever). Statement-anchored
// source lock, comments stripped.
test('LOCK: repull/one-shot info lines are idle, never busy', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'lib', 'ytdlp', 'client', 'subscriptions.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  assert.match(src, /actionStatus\(repullStatus, 'Re-pull requested…'\);/);
  assert.match(src, /actionStatus\(repullStatus, 'Re-pull-all requested…'\);/);
  assert.match(src, /actionStatus\(oneShotStatus, 'Download queued…'\);/);
  assert.equal(/actionStatus\(repullStatus, '[^']*', 'busy'\)/.test(src), false,
    'no repull info line may claim busy - nothing clears it');
});
