'use strict';

// [UNIT] v1.66 - delivery policy (lib/push/deliver.js) against a fully
// stubbed store/transport/guard: the P2 collapse table, the P3 status
// table (prune/cooldown/redirect-refusal/skip), cursor discipline
// (per-row advance, stop-at-first-failure, vanished-media skip), the
// opt-out and cooldown and disabled gates, and the trigger coalescer.

const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');

const {
  createPushDelivery, decideDeliveries, classifyPushResponse, pushOptedOut,
  COLLAPSE_MAX, DEFAULT_COOLDOWN_MS, MAX_COOLDOWN_MS,
} = require('../../lib/push/deliver');
const { mintVapidJwkPair, publicKeyToUncompressedB64url } = require('../../lib/push/keys');

const NOW = Date.parse('2026-04-01T00:00:00.000Z');

// ---- pure policy tables ----------------------------------------------------

test('P2 decideDeliveries: none / individual (<=3) / one summary (>3, cursor target = newest id)', () => {
  assert.deepEqual(decideDeliveries([]), { kind: 'none' });
  assert.deepEqual(decideDeliveries(undefined), { kind: 'none' });
  const three = [{ id: 7 }, { id: 8 }, { id: 11 }];
  assert.deepEqual(decideDeliveries(three), { kind: 'individual', rows: three });
  assert.equal(COLLAPSE_MAX, 3, 'ruling P2 as approved');
  const four = [{ id: 7 }, { id: 8 }, { id: 11 }, { id: 40 }];
  assert.deepEqual(decideDeliveries(four), { kind: 'summary', count: 4, maxId: 40 });
});

test('P3 classifyPushResponse: 2xx ok; 404/410 prune; 429 Retry-After seconds/date/garbage/cap; 3xx REFUSED; 5xx skip', () => {
  assert.deepEqual(classifyPushResponse(201, undefined, NOW), { action: 'ok' });
  assert.deepEqual(classifyPushResponse(404, undefined, NOW), { action: 'prune' });
  assert.deepEqual(classifyPushResponse(410, undefined, NOW), { action: 'prune' });
  assert.deepEqual(classifyPushResponse(429, '120', NOW), { action: 'cooldown', until: NOW + 120000 });
  const httpDate = new Date(NOW + 300000).toUTCString();
  assert.deepEqual(classifyPushResponse(429, httpDate, NOW), { action: 'cooldown', until: NOW + 300000 });
  assert.deepEqual(classifyPushResponse(429, 'garbage', NOW), { action: 'cooldown', until: NOW + DEFAULT_COOLDOWN_MS });
  assert.deepEqual(classifyPushResponse(429, undefined, NOW), { action: 'cooldown', until: NOW + DEFAULT_COOLDOWN_MS });
  assert.deepEqual(classifyPushResponse(429, String(90 * 60 * 60), NOW), { action: 'cooldown', until: NOW + MAX_COOLDOWN_MS }, 'cap 24h');
  assert.deepEqual(classifyPushResponse(301, undefined, NOW), { action: 'skip' }, 'redirects are refused, never followed');
  assert.deepEqual(classifyPushResponse(500, undefined, NOW), { action: 'skip' });
  assert.deepEqual(classifyPushResponse(403, undefined, NOW), { action: 'skip' }, 'VAPID rejection is a skip, not a prune (key rotation must not silently shed devices)');
});

test('pushOptedOut: only the literal off string opts out; garbage json fails open (deliver)', () => {
  assert.equal(pushOptedOut('{"pushEnabled":"off"}'), true);
  assert.equal(pushOptedOut('{"pushEnabled":"on"}'), false);
  assert.equal(pushOptedOut('{}'), false);
  assert.equal(pushOptedOut(undefined), false);
  assert.equal(pushOptedOut('{nope'), false);
});

// ---- harness ---------------------------------------------------------------

// A real browser-side keypair so the encrypted bodies are genuinely
// decryptable shapes (the crypto itself is vector-bound in push-crypto).
const ua = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const UA_P256DH = publicKeyToUncompressedB64url(ua.publicKey.export({ format: 'jwk' }));
const UA_AUTH = crypto.randomBytes(16).toString('base64url');
const VAPID_PAIR = mintVapidJwkPair();
const VAPID_KEYS = {
  privateJwk: VAPID_PAIR.privateKey,
  publicKeyB64url: publicKeyToUncompressedB64url(VAPID_PAIR.publicKey),
  subject: 'mailto:test@filetube.local',
};

function fakeStore(subs, feedRows) {
  const state = new Map(subs.map((s) => [s.endpoint, { ...s }]));
  return {
    calls: [],
    state,
    listPushSubscriptionsForDelivery() {
      return [...state.values()].map((s) => ({ p256dh: UA_P256DH, auth: UA_AUTH, settingsJson: '{}', ...s }));
    },
    listNotificationsAfter(cursor, limit) {
      return feedRows.filter((r) => r.id > cursor).slice(0, limit);
    },
    advancePushCursor(endpoint, id) {
      const s = state.get(endpoint);
      if (s) s.lastPushedId = Math.max(s.lastPushedId || 0, id);
      this.calls.push(['advance', endpoint, id]);
    },
    setPushCooldown(endpoint, until) {
      const s = state.get(endpoint);
      if (s) s.cooldownUntil = until;
      this.calls.push(['cooldown', endpoint, until]);
    },
    removePushSubscription(endpoint) {
      state.delete(endpoint);
      this.calls.push(['prune', endpoint]);
    },
  };
}

const META = {
  'vid-Ä1': { title: 'Vídeo One', channel: 'Chännel A' },
  'vid-Ä2': { title: 'Vídeo Two', channel: 'Chännel A' },
  'vid-Ä3': { title: 'Vídeo Three', channel: 'Chännel B' },
  'vid-Ä4': { title: 'Vídeo Four', channel: 'Chännel B' },
};

function harness({ subs, feed, responses, meta = META, enabled = () => true, guard }) {
  const store = fakeStore(subs, feed);
  const sends = [];
  const transport = async ({ url, headers, body }) => {
    sends.push({ url, headers, body });
    const next = responses.shift() || { statusCode: 201, headers: {} };
    if (next.throw) throw new Error(next.throw);
    return next;
  };
  const delivery = createPushDelivery({
    store,
    vapidKeys: VAPID_KEYS,
    guardHop: guard || (async () => ({ ok: true })),
    enabled,
    resolveMeta: (id) => meta[id] || null,
    transport,
    now: () => NOW,
    log: () => {},
  });
  return { store, sends, delivery };
}

const FEED = [
  { id: 10, mediaId: 'vid-Ä1', createdAt: NOW - 4000 },
  { id: 11, mediaId: 'vid-Ä2', createdAt: NOW - 3000 },
  { id: 12, mediaId: 'vid-Ä3', createdAt: NOW - 2000 },
  { id: 13, mediaId: 'vid-Ä4', createdAt: NOW - 1000 },
];
const SUB = { endpoint: 'https://push.example/wp/One', lastPushedId: 9, cooldownUntil: 0 };

// ---- delivery rounds -------------------------------------------------------

test('individual mode: one encrypted POST per missed row, cursor advances per row, payload rides ENCRYPTED', async () => {
  const { store, sends, delivery } = harness({
    subs: [{ ...SUB, lastPushedId: 10 }], // rows 11..13 missed = exactly 3
    feed: FEED,
    responses: [],
  });
  const c = await delivery.deliverRound();
  assert.equal(c.sent, 3);
  assert.equal(sends.length, 3);
  assert.equal(store.state.get(SUB.endpoint).lastPushedId, 13);
  for (const s of sends) {
    assert.equal(s.headers['Content-Encoding'], 'aes128gcm');
    assert.equal(s.headers.TTL, 24 * 60 * 60);
    assert.match(s.headers.Authorization, /^vapid t=.+, k=.+$/);
    assert.ok(Buffer.isBuffer(s.body));
    assert.ok(!s.body.includes(Buffer.from('Vídeo')), 'title never rides plaintext');
  }
  assert.deepEqual(
    store.calls.filter((x) => x[0] === 'advance').map((x) => x[2]),
    [11, 12, 13],
    'per-row advance in id order'
  );
});

test('summary mode: >3 missed rows = ONE post, cursor jumps to newest', async () => {
  const { store, sends, delivery } = harness({ subs: [{ ...SUB }], feed: FEED, responses: [] });
  const c = await delivery.deliverRound();
  assert.equal(c.sent, 1);
  assert.equal(sends.length, 1, 'four missed rows collapse to one push');
  assert.equal(store.state.get(SUB.endpoint).lastPushedId, 13);
});

test('stop-at-first-failure: cursor holds at the last delivered row (5xx skip)', async () => {
  const { store, sends, delivery } = harness({
    subs: [{ ...SUB, lastPushedId: 10 }],
    feed: FEED,
    responses: [{ statusCode: 201, headers: {} }, { statusCode: 500, headers: {} }],
  });
  const c = await delivery.deliverRound();
  assert.equal(c.sent, 1);
  assert.equal(sends.length, 2, 'third row never attempted after the failure');
  assert.equal(store.state.get(SUB.endpoint).lastPushedId, 11, 'cursor = last SUCCESS; 12/13 retry next event');
});

test('410 prunes the subscription mid-round; 429 sets the Retry-After cooldown and a cooling sub is skipped', async () => {
  const gone = { endpoint: 'https://push.example/wp/Gone', lastPushedId: 12, cooldownUntil: 0 };
  const busy = { endpoint: 'https://push.example/wp/Busy', lastPushedId: 12, cooldownUntil: 0 };
  const cooling = { endpoint: 'https://push.example/wp/Cooling', lastPushedId: 0, cooldownUntil: NOW + 5000 };
  const { store, sends, delivery } = harness({
    subs: [gone, busy, cooling],
    feed: FEED,
    responses: [{ statusCode: 410, headers: {} }, { statusCode: 429, headers: { 'retry-after': '60' } }],
  });
  const c = await delivery.deliverRound();
  assert.equal(sends.length, 2, 'the cooling sub never produced a POST');
  assert.equal(store.state.has(gone.endpoint), false, '410 pruned');
  assert.equal(store.state.get(busy.endpoint).cooldownUntil, NOW + 60000, '429 honored');
  assert.equal(store.state.get(busy.endpoint).lastPushedId, 12, 'cursor untouched by the 429');
  assert.equal(c.pruned, 1);
});

test('delivery-time guard refusal PRUNES (a dead/rebound endpoint is not retried forever)', async () => {
  const { store, sends, delivery } = harness({
    subs: [{ ...SUB }],
    feed: FEED,
    responses: [],
    guard: async () => ({ ok: false, error: 'resolves private' }),
  });
  const c = await delivery.deliverRound();
  assert.equal(sends.length, 0, 'no POST to a refused endpoint');
  assert.equal(store.state.size, 0);
  assert.equal(c.pruned, 1);
});

test('opt-out (pushEnabled off) and feature-disabled both suppress sends without touching cursors', async () => {
  const optedOut = { ...SUB, settingsJson: '{"pushEnabled":"off"}' };
  const h1 = harness({ subs: [optedOut], feed: FEED, responses: [] });
  await h1.delivery.deliverRound();
  assert.equal(h1.sends.length, 0);
  assert.equal(h1.store.state.get(SUB.endpoint).lastPushedId, 9, 'cursor untouched - re-enabling delivers whatever is still in the window');

  const h2 = harness({ subs: [{ ...SUB }], feed: FEED, responses: [], enabled: () => false });
  await h2.delivery.deliverRound();
  assert.equal(h2.sends.length, 0, 'notificationsFeatureEnabled=false = no-op round');
});

test('vanished media (pruned between feed insert and delivery) advances past the row silently', async () => {
  const { store, sends, delivery } = harness({
    subs: [{ ...SUB, lastPushedId: 10 }],
    feed: FEED,
    responses: [],
    meta: { 'vid-Ä2': META['vid-Ä2'], 'vid-Ä4': META['vid-Ä4'] }, // vid-Ä3 (row 12) is gone
  });
  const c = await delivery.deliverRound();
  assert.equal(sends.length, 2, 'rows 11 and 13 sent; 12 skipped');
  assert.equal(c.sent, 2);
  assert.equal(store.state.get(SUB.endpoint).lastPushedId, 13);
});

test('a THROWING transport skips that subscription round but the next subscription still delivers', async () => {
  const a = { endpoint: 'https://push.example/wp/A', lastPushedId: 12, cooldownUntil: 0 };
  const b = { endpoint: 'https://push.example/wp/B', lastPushedId: 12, cooldownUntil: 0 };
  const { store, sends, delivery } = harness({
    subs: [a, b],
    feed: FEED,
    responses: [{ throw: 'ECONNRESET' }, { statusCode: 201, headers: {} }],
  });
  const c = await delivery.deliverRound();
  assert.equal(sends.length, 2);
  assert.equal(c.sent, 1);
  assert.equal(store.state.get(a.endpoint).lastPushedId, 12, 'thrown send = cursor holds');
  assert.equal(store.state.get(b.endpoint).lastPushedId, 13, 'unaffected neighbor delivered');
});

// The coalescer harness: round 1 BLOCKS inside its transport until the test
// releases it, so triggers arriving mid-round are genuinely overlapping (the
// first draft of these tests only asserted a range that 1 round satisfied -
// the re-run mutant survived; adversarial gate WARNING 2).
function coalescerHarness() {
  const rows = [{ id: 10, mediaId: 'vid-Ä1', createdAt: NOW - 1000 }];
  const sub = { endpoint: 'https://push.example/wp/Coalesce', lastPushedId: 9, cooldownUntil: 0 };
  const store = fakeStore([sub], rows);
  const roundStarts = [];
  const sends = [];
  let gate = null;
  const delivery = createPushDelivery({
    store: {
      listPushSubscriptionsForDelivery() {
        roundStarts.push(Date.now());
        return store.listPushSubscriptionsForDelivery();
      },
      listNotificationsAfter: (c, l) => store.listNotificationsAfter(c, l),
      advancePushCursor: (e, i) => store.advancePushCursor(e, i),
      setPushCooldown: (e, u) => store.setPushCooldown(e, u),
      removePushSubscription: (e) => store.removePushSubscription(e),
    },
    vapidKeys: VAPID_KEYS,
    guardHop: async () => ({ ok: true }),
    enabled: () => true,
    resolveMeta: () => ({ title: 'T', channel: 'C' }),
    transport: async () => {
      sends.push(1);
      if (gate) { const g = gate; gate = null; await g; }
      return { statusCode: 201, headers: {} };
    },
    now: () => NOW,
    log: () => {},
  });
  return {
    delivery, store, rows, sends, roundStarts,
    blockNextSend() {
      let release;
      gate = new Promise((r) => { release = r; });
      return release;
    },
  };
}

test('trigger(): a request arriving DURING an in-flight round forces exactly one re-run, which delivers the row added mid-round', async () => {
  const h = coalescerHarness();
  const release = h.blockNextSend();

  h.delivery.trigger('t1');
  // Let round 1 reach its blocked send.
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(h.roundStarts.length, 1, 'round 1 is in flight');
  assert.equal(h.sends.length, 1, 'and blocked inside its transport');

  // A second scan lands mid-round with a NEW feed row. Without the re-run
  // loop this row waits for an entirely separate trigger.
  h.rows.push({ id: 11, mediaId: 'vid-Ä2', createdAt: NOW - 500 });
  h.delivery.trigger('t2');
  h.delivery.trigger('t3'); // further triggers collapse into the same re-run

  release();
  await new Promise((r) => setTimeout(r, 60));

  assert.equal(h.roundStarts.length, 2, 'exactly ONE re-run for the two mid-round triggers (not two, not zero)');
  assert.equal(h.store.state.get('https://push.example/wp/Coalesce').lastPushedId, 11,
    'the row added mid-round was delivered by the re-run - this is what the do/while exists for');
});

test('trigger(): triggers arriving AFTER a round completes start a fresh round (the latch releases)', async () => {
  const h = coalescerHarness();
  h.delivery.trigger('t1');
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(h.roundStarts.length, 1);
  h.rows.push({ id: 11, mediaId: 'vid-Ä2', createdAt: NOW - 500 });
  h.delivery.trigger('t2');
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(h.roundStarts.length, 2, 'the running latch cleared - a later trigger is not swallowed forever');
  assert.equal(h.store.state.get('https://push.example/wp/Coalesce').lastPushedId, 11);
});

test('trigger(): overlapping triggers never DOUBLE-SEND a row (the running latch)', async () => {
  const h = coalescerHarness();
  const release = h.blockNextSend();
  h.delivery.trigger('t1');
  await new Promise((r) => setTimeout(r, 20));
  // Five more triggers while round 1 is blocked mid-send.
  for (let i = 0; i < 5; i++) h.delivery.trigger(`t${i + 2}`);
  release();
  await new Promise((r) => setTimeout(r, 60));
  // One row in the feed: exactly one delivery attempt for it, plus the
  // re-run's no-op pass (cursor already at 10 -> no rows -> no send).
  assert.equal(h.sends.length, 1, 'six triggers, one feed row, ONE send - no double-notify');
  assert.equal(h.roundStarts.length, 2, 'and the collapse is total: 1 in-flight + 1 re-run');
});
