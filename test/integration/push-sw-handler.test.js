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

const SW_PATH = path.join(__dirname, '..', '..', 'public', 'filetube-worker.js');
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

async function firePush(visibilityStates, payload = { title: 'Vid', body: 'Chan', url: '/watch.html?v=x' }) {
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
  assert.equal(captured.shown[0].opts.data.url, '/watch.html?v=x');
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
    notification: { close() {}, data: { url: '/watch.html?v=y' } },
    waitUntil: (p) => { waited = p; },
  });
  await waited;
  assert.deepEqual(captured.focused, [true]);
  assert.deepEqual(captured.navigated, ['/watch.html?v=y']);
  assert.deepEqual(captured.opened, [], 'an existing window is reused, never a second tab');

  // With no windows: openWindow to the url.
  captured.focused.length = 0; captured.navigated.length = 0;
  globalThis.self.clients.matchAll = async () => [];
  let waited2;
  await listeners.notificationclick({
    notification: { close() {}, data: { url: '/watch.html?v=z' } },
    waitUntil: (p) => { waited2 = p; },
  });
  await waited2;
  assert.deepEqual(captured.opened, ['/watch.html?v=z']);
});

// ---- v1.376.0 W1 (Dean's R1): the banner's "Watch later" action -----------------------
// Executed against the stubbed `self` with a scripted global fetch: the action adds then
// dismisses, opens nothing; every click WITHOUT the action keeps the pre-v1.376 open path.

const ITEM_PAYLOAD = { title: 'Vid', body: 'Chan', url: '/watch.html?v=m%201', notifId: 77, mediaId: 'm 1', kind: 'media' };

async function fireClick(action, data, fetchImpl) {
  const savedFetch = globalThis.fetch;
  const fetches = [];
  globalThis.fetch = async (url, init) => { fetches.push({ url, method: (init && init.method) || 'GET', body: init && init.body, credentials: init && init.credentials }); return fetchImpl ? fetchImpl(url, init) : { ok: true, status: 200, json: async () => ({}) }; };
  captured.shown.length = 0;
  globalThis.self.clients.matchAll = async () => windowsFor(['hidden']);
  let waited;
  try {
    await listeners.notificationclick({ action, notification: { close() {}, data }, waitUntil: (p) => { waited = p; } });
    await waited;
  } finally { globalThis.fetch = savedFetch; }
  return fetches;
}

test('v1.376.0 W1: an item push shows a "Watch later" action and carries its ids; a summary push shows the old banner exactly', async () => {
  await firePush([], ITEM_PAYLOAD);
  const o = captured.shown[0].opts;
  assert.deepEqual(o.actions, [{ action: 'watchlater', title: 'Watch later' }]);
  assert.deepEqual(o.data, { url: '/watch.html?v=m%201', notifId: 77, mediaId: 'm 1', kind: 'media', title: 'Vid' });
  await firePush([], { title: '4 new videos', body: 'FileTube', url: '/' });
  assert.deepEqual(captured.shown[0].opts, { body: 'FileTube', icon: '/icons/icon-192.png', data: { url: '/' } }, 'no action, no extra data');
  await firePush([], { ...ITEM_PAYLOAD, kind: 'engine' });
  assert.equal(captured.shown[0].opts.actions, undefined, 'an unknown kind gets no action');
});

test('v1.376.0 W1: the Watch later action POSTs the add (with its kind), THEN dismisses that notification, and opens NO window', async () => {
  const data = { url: '/podcasts?play=e1', notifId: 78, mediaId: 'e1', kind: 'podcast', title: 'Ep' };
  const fetches = await fireClick('watchlater', data);
  assert.deepEqual(fetches.map((f) => [f.method, f.url]), [['POST', '/api/watch-later/e1'], ['POST', '/api/notifications/dismiss']]);
  assert.deepEqual(JSON.parse(fetches[0].body), { kind: 'podcast' });
  assert.deepEqual(JSON.parse(fetches[1].body), { id: 78 });
  assert.ok(fetches.every((f) => f.credentials === 'same-origin'), 'the session cookie rides');
  assert.deepEqual([captured.opened, captured.focused, captured.navigated], [[], [], []], 'nothing opened');
  assert.equal(captured.shown.length, 0, 'no follow-up banner on success');
});

test('v1.376.0 W1: a failed add sends no dismiss and says so with a banner that opens the item', async () => {
  const fetches = await fireClick('watchlater', { ...ITEM_PAYLOAD, url: '/watch.html?v=m%201' }, async () => ({ ok: false, status: 401 }));
  assert.deepEqual(fetches.map((f) => f.url), ['/api/watch-later/m%201'], 'no dismiss after a failed add');
  assert.equal(captured.shown.length, 1);
  assert.equal(captured.shown[0].title, 'Could not add to Watch later');
  assert.deepEqual(captured.shown[0].opts.data, { url: '/watch.html?v=m%201' }, 'its tap opens the item, and carries no action');
  assert.deepEqual(captured.opened, []);
});

test('v1.376.0 W1: a click WITHOUT the action (the banner body, an unknown action) opens the item and fetches nothing', async () => {
  for (const action of ['', undefined, 'open', 'WATCHLATER']) {
    captured.opened.length = 0; captured.focused.length = 0; captured.navigated.length = 0;
    const fetches = await fireClick(action, { ...ITEM_PAYLOAD });
    assert.deepEqual(fetches, [], `no request for action ${JSON.stringify(action)}`);
    assert.deepEqual(captured.navigated, ['/watch.html?v=m%201'], `the open path for action ${JSON.stringify(action)}`);
  }
  // The action on a banner that does not carry its item (an older payload) opens too.
  captured.navigated.length = 0;
  const f2 = await fireClick('watchlater', { url: '/watch.html?v=q' });
  assert.deepEqual(f2, []);
  assert.deepEqual(captured.navigated, ['/watch.html?v=q']);
});
