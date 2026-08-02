'use strict';

// [INTEGRATION] v1.66 - the push service worker's HANDLERS, executed against
// a stubbed `self` (the jsdom-on-the-real-export pattern, like
// history-nav-gate.test.js). This exists because ruling P4 - "a locked
// phone gets the banner, a visible window does not" - was twice bound only
// by a SUBSTRING grep, and a one-character inversion of the handler's use of
// decidePushDisplay passed the entire suite (adversarial gate, twice): a
// locked phone got NO banner and a visible window got a banner AND a nudge.
// The pure decision is table-tested in v1264-service-worker.test.js; this
// file binds the handler's CONSUMPTION of it by running the real listener.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const SW_PATH = path.join(__dirname, '..', '..', 'public', 'push-sw.js');
const listeners = {};
const captured = { shown: [], posted: [], opened: [], focused: [], navigated: [] };
let savedSelf;

before(() => {
  savedSelf = Object.getOwnPropertyDescriptor(globalThis, 'self');
  // A minimal ServiceWorkerGlobalScope. matchAll is swapped per test.
  const fakeSelf = {
    addEventListener: (type, fn) => { listeners[type] = fn; },
    skipWaiting() {},
    clients: {
      claim() {},
      matchAll: async () => [],
      openWindow: async (url) => { captured.opened.push(url); return {}; },
    },
    registration: {
      showNotification: async (title, opts) => { captured.shown.push({ title, opts }); },
    },
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
  };
  Object.defineProperty(globalThis, 'self', { configurable: true, value: fakeSelf });
  delete require.cache[require.resolve(SW_PATH)];
  require(SW_PATH); // registers the listeners against fakeSelf
});

after(() => {
  if (savedSelf) Object.defineProperty(globalThis, 'self', savedSelf);
  else delete globalThis.self;
  delete require.cache[require.resolve(SW_PATH)];
});

beforeEach(() => {
  captured.shown.length = 0;
  captured.posted.length = 0;
  captured.opened.length = 0;
  captured.focused.length = 0;
  captured.navigated.length = 0;
});

function windowsFor(visibilityStates) {
  return visibilityStates.map((v) => ({
    visibilityState: v,
    postMessage: (m) => captured.posted.push(m),
    focus: async () => { captured.focused.push(true); },
    navigate: async (u) => { captured.navigated.push(u); },
  }));
}

async function firePush(visibilityStates, payload = { title: 'Vid', body: 'Chan', url: '/watch.html?id=x' }) {
  // Reset here too, not just in beforeEach: some tests fire more than once.
  captured.shown.length = 0;
  captured.posted.length = 0;
  globalThis.self.clients.matchAll = async () => windowsFor(visibilityStates);
  let waited;
  await listeners.push({
    data: payload === null ? null : { json: () => payload },
    waitUntil: (p) => { waited = p; },
  });
  await waited;
  return { notified: captured.shown.length, nudged: captured.posted.length };
}

test('P4 by execution: no windows (locked phone) => ONE banner, no nudge', async () => {
  const r = await firePush([]);
  assert.deepEqual(r, { notified: 1, nudged: 0 });
  assert.equal(captured.shown[0].title, 'Vid');
  assert.equal(captured.shown[0].opts.body, 'Chan');
  assert.equal(captured.shown[0].opts.data.url, '/watch.html?id=x');
});

test('P4 by execution: all-hidden windows still banner (backgrounded is not visible)', async () => {
  assert.deepEqual(await firePush(['hidden']), { notified: 1, nudged: 0 });
  assert.deepEqual(await firePush(['hidden', 'hidden']), { notified: 1, nudged: 0 });
});

test('P4 by execution: a visible window SUPPRESSES the banner and nudges instead', async () => {
  const r = await firePush(['visible']);
  assert.deepEqual(r, { notified: 0, nudged: 1 }, 'no OS banner, exactly one postMessage');
});

test('P4 by execution: mixed visible+hidden suppresses, and ONLY the visible window is nudged', async () => {
  const r = await firePush(['hidden', 'visible', 'hidden']);
  assert.equal(r.notified, 0, 'a single visible window suppresses the banner');
  assert.equal(r.nudged, 1, 'the hidden windows are not nudged - only the visible one');
});

test('a malformed/absent payload still delivers the FileTube fallback banner (never throws)', async () => {
  assert.deepEqual(await firePush([], null), { notified: 1, nudged: 0 });
  assert.equal(captured.shown[0].title, 'FileTube');
});

test('notificationclick focuses + navigates an existing window; opens one when none exist', async () => {
  // With an open window: focus it and navigate, do NOT openWindow.
  globalThis.self.clients.matchAll = async () => windowsFor(['visible']);
  let waited;
  await listeners.notificationclick({
    notification: { close() {}, data: { url: '/watch.html?id=y' } },
    waitUntil: (p) => { waited = p; },
  });
  await waited;
  assert.deepEqual(captured.focused, [true]);
  assert.deepEqual(captured.navigated, ['/watch.html?id=y']);
  assert.deepEqual(captured.opened, [], 'an existing window is reused, never a second tab');

  // With no windows: openWindow to the url.
  captured.focused.length = 0; captured.navigated.length = 0;
  globalThis.self.clients.matchAll = async () => [];
  let waited2;
  await listeners.notificationclick({
    notification: { close() {}, data: { url: '/watch.html?id=z' } },
    waitUntil: (p) => { waited2 = p; },
  });
  await waited2;
  assert.deepEqual(captured.opened, ['/watch.html?id=z']);
});
