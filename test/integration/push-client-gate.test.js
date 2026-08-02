'use strict';

// [INTEGRATION] v1.66 - the push client's two load-bearing behaviors, bound
// against the REAL public/js/common.js export (the history-nav-gate
// pattern: require the shipped file, stub only the platform globals, and
// write each test to kill a named mutant).
//
// Mutants these exist to kill:
//   M1: delete the shedder's /sw.js exemption line -> the push worker is
//       unregistered on every page boot and pushes die within a day.
//   M2: broaden the exemption (e.g. skip ALL registrations) -> the v1.26.4
//       offline shell is never shed from old installs.
//   M3: gut reconcilePushSubscription's POST -> a users-restore silently
//       kills every device until each one re-enables by hand (the D2
//       self-heal is the disclosed compensation for bundle exclusion).
//   M4: make the reconcile register/subscribe unconditionally -> logged-out
//       or never-opted-in devices start registering workers.

const { test } = require('node:test');
const assert = require('node:assert');

const {
  unregisterStaleServiceWorkers,
  reconcilePushSubscription,
  pushB64urlToUint8,
} = require('../../public/js/common.js');

async function settle() {
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
}

function withPlatform({ registrations = [], registration = null, fetchImpl }, fn) {
  // Node 21+: globalThis.navigator is getter-only -- swap via defineProperty.
  const savedNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const savedFetch = global.fetch;
  const calls = { unregistered: [], registered: [], fetches: [] };
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      serviceWorker: {
        getRegistrations: async () => registrations.map((r) => ({
          active: { scriptURL: r.scriptURL },
          unregister: async () => { calls.unregistered.push(r.scriptURL); return true; },
        })),
        getRegistration: async () => registration,
        register: async (url) => { calls.registered.push(url); return registration || {}; },
      },
    },
  });
  global.fetch = fetchImpl || (async (url, opts) => { calls.fetches.push({ url, opts }); return { ok: true, json: async () => ({}) }; });
  return (async () => {
    try {
      await fn(calls);
    } finally {
      if (savedNavigator) Object.defineProperty(globalThis, 'navigator', savedNavigator);
      else delete globalThis.navigator;
      global.fetch = savedFetch;
    }
  })();
}

test('shedder: unregisters the old offline SW and anything foreign, but NEVER /sw.js (kills M1+M2)', () =>
  withPlatform({
    registrations: [
      { scriptURL: 'https://filetube.example/sw-offline.js' }, // v1.26.4 shape
      { scriptURL: 'https://filetube.example/sw.js' },         // the push worker
      { scriptURL: 'https://filetube.example/js/other-sw.js' },
    ],
  }, async (calls) => {
    unregisterStaleServiceWorkers();
    await settle();
    assert.deepEqual(calls.unregistered.sort(), [
      'https://filetube.example/js/other-sw.js',
      'https://filetube.example/sw-offline.js',
    ], 'both foreign workers shed');
    assert.ok(!calls.unregistered.includes('https://filetube.example/sw.js'), 'the push worker survives the shed pass');
  }));

test('reconcile: an existing device subscription re-POSTs to the server and freshens the worker (kills M3)', () => {
  const sub = {
    endpoint: 'https://push.example/wp/Reconcile-1',
    toJSON: () => ({ endpoint: 'https://push.example/wp/Reconcile-1', keys: { p256dh: 'P', auth: 'A' } }),
  };
  return withPlatform({
    registration: { pushManager: { getSubscription: async () => sub } },
  }, async (calls) => {
    reconcilePushSubscription();
    await settle();
    const post = calls.fetches.find((f) => f.url === '/api/push/subscribe');
    assert.ok(post, 'the subscription re-asserted server-side');
    assert.equal(post.opts.method, 'POST');
    assert.equal(JSON.parse(post.opts.body).endpoint, 'https://push.example/wp/Reconcile-1');
    assert.deepEqual(calls.registered, ['/sw.js'], 'the worker file freshened through the ONE register site');
  });
});

test('reconcile: no registration, or a registration without a subscription, does NOTHING (kills M4)', async () => {
  await withPlatform({ registration: null }, async (calls) => {
    reconcilePushSubscription();
    await settle();
    assert.deepEqual(calls.fetches, [], 'no registration -> no network');
    assert.deepEqual(calls.registered, [], 'and no worker registration');
  });
  await withPlatform({
    registration: { pushManager: { getSubscription: async () => null } },
  }, async (calls) => {
    reconcilePushSubscription();
    await settle();
    assert.deepEqual(calls.fetches, [], 'no subscription -> no network');
    assert.deepEqual(calls.registered, [], 'never auto-opts a device in');
  });
});

test('pushB64urlToUint8 decodes base64url (padding-free) to the exact bytes', () => {
  const bytes = pushB64urlToUint8('BAECAwQ'); // 0x04 01 02 03 04
  assert.deepEqual([...bytes], [4, 1, 2, 3, 4]);
});
