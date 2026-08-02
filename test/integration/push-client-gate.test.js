'use strict';

// [INTEGRATION] v1.66 - the push client's two load-bearing behaviors, bound
// against the REAL public/js/common.js export (the history-nav-gate
// pattern: require the shipped file, stub only the platform globals, and
// write each test to kill a named mutant).
//
// Mutants these exist to kill:
//   M1: delete the shedder's worker exemption -> the push worker is
//       unregistered on every page boot and pushes die within a day.
//   M2: widen the exemption to '/sw.js' (the wave's FIRST draft, caught by
//       the QA seat) -> the v1.26.4 offline worker, which registered at
//       exactly that path, is spared forever and its fetch handler keeps
//       intercepting media on old installs.
//   (v1.67.3: the worker is /filetube-worker.js; the old /push-sw.js stays
//   exempt so devices that subscribed under it keep push until the reconcile
//   upgrades them in place.)
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

test('shedder: sheds /sw.js and anything foreign, but spares BOTH FileTube worker names - the current /filetube-worker.js AND the old /push-sw.js (v1.67.3 migration) (kills M1+M2)', () =>
  withPlatform({
    registrations: [
      // The v1.26.4 worker's ACTUAL url - verified against d96a7f8, which
      // registered '/sw.js'. (An earlier fixture invented '/sw-offline.js',
      // asserting the shed of a worker that never existed while the real one
      // was silently exempt - divergent fixture in the wrong direction, QA W2.)
      { scriptURL: 'https://filetube.example/sw.js' },
      { scriptURL: 'https://filetube.example/filetube-worker.js' }, // the v1.67.3 worker
      { scriptURL: 'https://filetube.example/push-sw.js' },         // old-name device: MUST survive (live subscription)
      { scriptURL: 'https://filetube.example/js/other-sw.js' },
      // Nested lookalikes: a SUFFIX exemption would spare these. Exact
      // pathname only, so both are shed.
      { scriptURL: 'https://filetube.example/media/user/filetube-worker.js' },
      { scriptURL: 'https://filetube.example/media/user/push-sw.js' },
      // Case variant must not sneak past.
      { scriptURL: 'https://filetube.example/PUSH-SW.js' },
      { scriptURL: '' }, // torn registration: fail closed, shed it
    ],
  }, async (calls) => {
    unregisterStaleServiceWorkers();
    await settle();
    assert.deepEqual(calls.unregistered.sort(), [
      '',
      'https://filetube.example/PUSH-SW.js',
      'https://filetube.example/js/other-sw.js',
      'https://filetube.example/media/user/filetube-worker.js',
      'https://filetube.example/media/user/push-sw.js',
      'https://filetube.example/sw.js',
    ], 'the offline worker, the foreign one, both nested lookalikes, the case variant and a torn registration are ALL shed');
    assert.ok(!calls.unregistered.includes('https://filetube.example/filetube-worker.js'),
      'the current worker survives');
    assert.ok(!calls.unregistered.includes('https://filetube.example/push-sw.js'),
      'the OLD-name worker survives too (its device carries a live subscription the reconcile upgrades)');
  }));

test('shedder: either worker name with a cache-busting query string is still spared (pathname match, not URL match)', () =>
  withPlatform({
    registrations: [
      { scriptURL: 'https://filetube.example/filetube-worker.js?v=2' },
      { scriptURL: 'https://filetube.example/push-sw.js?v=9' },
    ],
  }, async (calls) => {
    unregisterStaleServiceWorkers();
    await settle();
    assert.deepEqual(calls.unregistered, [], 'a query string does not make either a foreign worker');
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
    assert.deepEqual(calls.registered, ['/filetube-worker.js'], 'the worker file freshened through the ONE register site (the v1.67.3 name - this is also the in-place upgrade path for old-name devices)');
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
