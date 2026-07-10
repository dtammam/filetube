'use strict';

// [INTEGRATION] `POST /api/ytdlp/refresh-avatars` (+ its companion `POST
// /api/ytdlp/refresh-avatars/cancel`): the "Refresh channel avatars" bulk-pull
// HTTP surface + orchestration in `lib/ytdlp/index.js` (v1.25.5 QoL follow-up,
// channel avatars round 2). Distinct from `POST /api/ytdlp/repull-metadata`
// (test/integration/ytdlp-repull-metadata-endpoint.test.js, which this file's
// own structure deliberately mirrors): that route re-pulls metadata+subtitles
// for EXISTING downloaded ITEMS; this route re-probes the CHANNEL AVATAR for
// EVERY subscription, on demand.
//
// `run.probeChannelAvatar` (already implemented+tested in lib/ytdlp/run.js)
// and `store.recordSubscriptionChannelAvatar` (already implemented+tested in
// lib/ytdlp/store.js) are STUBBED/exercised here at their own boundaries:
// this file owns ONLY the route + orchestration contract (202 posture,
// concurrency guard, skip-when-no-channelUrl, per-item failure resilience,
// runExclusive serialization, cancel, activity progress, no-auto-run). No
// real yt-dlp binary, no real db.json; mirrors the reheat endpoint test's
// same-process fake-`express()`-app + fake-`deps` pattern.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const express = require('express');

const ytdlp = require('../../lib/ytdlp');
const run = require('../../lib/ytdlp/run');
const store = require('../../lib/ytdlp/store');
const activity = require('../../lib/ytdlp/activity');

const originalRunList = run.runList;
const originalRunDownload = run.runDownload;
const originalProbeChannelAvatar = run.probeChannelAvatar;

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-refresh-avatars-'));
  ytdlp.resetRefreshAvatarsStateForTests();
  activity.resetForTests();
});

afterEach(() => {
  run.runList = originalRunList;
  run.runDownload = originalRunDownload;
  run.probeChannelAvatar = originalProbeChannelAvatar;
  ytdlp.resetRefreshAvatarsStateForTests();
  activity.resetForTests();
  ytdlp.armYtdlpTimer(ytdlp.parseYtdlpConfig({})); // clear any armed timer between tests
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeFakeDeps(initialDb = {}) {
  let db = initialDb;
  return {
    loadDatabase: () => db,
    updateDatabase: (mutatorFn) => Promise.resolve(mutatorFn(db)),
    scanDirectories: async () => {},
    getMediaId: (input) => crypto.createHash('md5').update(input).digest('hex'),
  };
}

function enabledConfig(overrides = {}) {
  return ytdlp.parseYtdlpConfig({
    FILETUBE_YTDLP_ENABLED: 'true',
    FILETUBE_YTDLP_POLL_MINUTES: '0',
    FILETUBE_YTDLP_DOWNLOAD_DIR: tmpDir,
    ...overrides,
  });
}

function disabledConfig(overrides = {}) {
  return ytdlp.parseYtdlpConfig({
    FILETUBE_YTDLP_ENABLED: 'false',
    FILETUBE_YTDLP_DOWNLOAD_DIR: tmpDir,
    ...overrides,
  });
}

async function startTestApp(deps, config) {
  const app = express();
  app.use(express.json());
  ytdlp.registerRoutes(app, deps, config);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: async () => {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function flush(ms = 15) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRefreshAvatarsEntry() {
  return activity.getSnapshot().oneShots[ytdlp.REFRESH_AVATARS_ACTIVITY_ID];
}

// ---- Disabled module: native 404, no spawn ---------------------------------

test('disabled module: POST /api/ytdlp/refresh-avatars (and its cancel companion) are native 404s, no spawn', async () => {
  const deps = makeFakeDeps();
  let called = false;
  run.probeChannelAvatar = async () => {
    called = true;
    return null;
  };

  const { base, close } = await startTestApp(deps, disabledConfig());
  try {
    const res = await fetch(`${base}/api/ytdlp/refresh-avatars`, { method: 'POST' });
    assert.equal(res.status, 404);
    await flush();
    assert.equal(called, false, 'a disabled module must never spawn an avatar probe');

    const cancelRes = await fetch(`${base}/api/ytdlp/refresh-avatars/cancel`, { method: 'POST' });
    assert.equal(cancelRes.status, 404);
  } finally {
    await close();
  }
});

// ---- Enabled: 202 with the total, the background batch probes each sub ----

test('enabled: responds 202 with {started:true, total}; the background batch probes each subscription\'s channelUrl and stores results, in order', async () => {
  const deps = makeFakeDeps();
  const config = enabledConfig();
  const subA = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@chanA', format: 'video' });
  const subB = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@chanB', format: 'video' });

  const probeCalls = [];
  run.probeChannelAvatar = async (channelUrl) => {
    probeCalls.push(channelUrl);
    return { avatarUrl: `https://example.com/avatar-${probeCalls.length}.jpg`, channelId: null, channelUrl: null };
  };

  const { base, close } = await startTestApp(deps, config);
  try {
    const res = await fetch(`${base}/api/ytdlp/refresh-avatars`, { method: 'POST' });
    assert.equal(res.status, 202);
    assert.deepEqual(await res.json(), { started: true, total: 2 });

    await flush(30);
    assert.deepEqual(probeCalls, [subA.channelUrl, subB.channelUrl], 'both subscriptions must be probed, in order');

    const persisted = store.listSubscriptions(deps);
    assert.equal(persisted.find((s) => s.id === subA.id).channelAvatarUrl, 'https://example.com/avatar-1.jpg');
    assert.equal(persisted.find((s) => s.id === subB.id).channelAvatarUrl, 'https://example.com/avatar-2.jpg');

    const entry = getRefreshAvatarsEntry();
    assert.equal(entry.state, 'done');
    assert.equal(entry.total, 2);
    assert.equal(entry.done, 2);
    assert.equal(entry.failed, 0);
    assert.equal(entry.skipped, 0);
  } finally {
    await close();
  }
});

test('a subscription with no channelUrl is skipped (counted skipped), never probed', async () => {
  const deps = makeFakeDeps();
  const config = enabledConfig();
  await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@chanA', format: 'video' });
  // Force one subscription's channelUrl empty (a malformed/legacy record) --
  // simulates the "no channel identity to probe" case directly, since
  // addSubscription itself always requires a channelUrl.
  const db = deps.loadDatabase();
  store.ensureYtdlp(db).subscriptions.push({ id: 'no-url-sub', name: 'No URL', channelUrl: '', format: 'video', quality: 'best', order: 1 });

  const probeCalls = [];
  run.probeChannelAvatar = async (channelUrl) => {
    probeCalls.push(channelUrl);
    return { avatarUrl: 'https://example.com/avatar.jpg', channelId: null, channelUrl: null };
  };

  const { base, close } = await startTestApp(deps, config);
  try {
    const res = await fetch(`${base}/api/ytdlp/refresh-avatars`, { method: 'POST' });
    assert.equal(res.status, 202);
    assert.deepEqual(await res.json(), { started: true, total: 2 });

    await flush(30);
    assert.equal(probeCalls.length, 1, 'only the subscription with a real channelUrl must ever be probed');

    const entry = getRefreshAvatarsEntry();
    assert.equal(entry.skipped, 1);
    assert.equal(entry.done, 1);
    assert.equal(entry.state, 'done');
  } finally {
    await close();
  }
});

// ---- v1.25.x QoL bugfix: distinct-channel targets drawn from BOTH ----------
// subscriptions AND db.metadata items (the channelId-keyed avatar registry)

test('the refresh batch also probes a distinct channel from db.metadata that has NO matching subscription, and registers it into the canonical registry', async () => {
  const deps = makeFakeDeps();
  const config = enabledConfig();
  const subA = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@chanA', format: 'video' });

  // A one-off (non-subscribed) item's channel -- distinct channelId, its OWN
  // channelUrl (never a subscription's).
  const db = deps.loadDatabase();
  db.metadata = {
    oneOffVideo: {
      id: 'oneOffVideo',
      channelId: 'UConeoffchannelidxxxxxxx',
      channelUrl: 'https://www.youtube.com/channel/UConeoffchannelidxxxxxxx',
    },
  };

  const probeCalls = [];
  run.probeChannelAvatar = async (channelUrl) => {
    probeCalls.push(channelUrl);
    if (channelUrl === subA.channelUrl) {
      return { avatarUrl: 'https://example.com/chanA.jpg', channelId: 'UCchanAAAAAAAAAAAAxxxxxx', channelUrl };
    }
    return { avatarUrl: 'https://example.com/oneoff.jpg', channelId: 'UConeoffchannelidxxxxxxx', channelUrl };
  };

  const { base, close } = await startTestApp(deps, config);
  try {
    const res = await fetch(`${base}/api/ytdlp/refresh-avatars`, { method: 'POST' });
    assert.equal(res.status, 202);
    assert.deepEqual(await res.json(), { started: true, total: 2 }, 'total must count the DISTINCT channel from db.metadata too, not just subscriptions');

    await flush(30);
    assert.deepEqual(
      new Set(probeCalls),
      new Set([subA.channelUrl, 'https://www.youtube.com/channel/UConeoffchannelidxxxxxxx']),
      'both the subscription AND the non-subscribed item\'s channel must be probed',
    );

    const entry = getRefreshAvatarsEntry();
    assert.equal(entry.state, 'done');
    assert.equal(entry.done, 2);

    const freshDb = deps.loadDatabase();
    const ns = store.ensureYtdlp(freshDb);
    assert.equal(ns.channelAvatars.UConeoffchannelidxxxxxxx.avatarUrl, 'https://example.com/oneoff.jpg', 'the non-subscribed channel must be registered into the canonical registry');
    assert.equal(ns.channelAvatars.UCchanAAAAAAAAAAAAxxxxxx.avatarUrl, 'https://example.com/chanA.jpg', 'the subscribed channel must ALSO be registered into the canonical registry');
  } finally {
    await close();
  }
});

test('a db.metadata item whose channelId is ALREADY covered by a subscription is never probed a second time (dedup by channelId)', async () => {
  const deps = makeFakeDeps();
  const config = enabledConfig();
  const subA = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@chanA', format: 'video' });
  await store.recordSubscriptionChannelId(deps, subA.channelUrl, 'UCsharedchannelidxxxxxxx');

  const db = deps.loadDatabase();
  db.metadata = {
    sameChannelVideo: {
      id: 'sameChannelVideo',
      channelId: 'UCsharedchannelidxxxxxxx',
      channelUrl: 'https://www.youtube.com/channel/UCsharedchannelidxxxxxxx',
    },
  };

  const probeCalls = [];
  run.probeChannelAvatar = async (channelUrl) => {
    probeCalls.push(channelUrl);
    return { avatarUrl: 'https://example.com/avatar.jpg', channelId: 'UCsharedchannelidxxxxxxx', channelUrl };
  };

  const { base, close } = await startTestApp(deps, config);
  try {
    const res = await fetch(`${base}/api/ytdlp/refresh-avatars`, { method: 'POST' });
    assert.deepEqual(await res.json(), { started: true, total: 1 }, 'the item shares subA\'s already-known channelId -- must dedup to ONE target');

    await flush(30);
    assert.equal(probeCalls.length, 1, 'a channelId already covered by a subscription must never be probed a second time');
  } finally {
    await close();
  }
});

// v1.25.x QoL bugfix (two-reviewer gate follow-up): a channelId-less
// db.metadata item followed by an id-bearing item for the SAME channelUrl
// (the SAME real channel, discovered twice -- once before its channelId was
// known, once after) previously produced TWO refresh targets, so the batch
// probed the same channel twice in one refresh. The dedup reconcile must
// collapse them into a single target/probe.
test('a channelId-less db.metadata item followed by an id-bearing item for the SAME channelUrl is probed exactly ONCE (dedup reconcile)', async () => {
  const deps = makeFakeDeps();
  const config = enabledConfig();

  const sharedUrl = 'https://www.youtube.com/@dedupreconcile';
  const db = deps.loadDatabase();
  db.metadata = {
    // Insertion order matters: the id-less item is walked FIRST.
    idlessVideo: { id: 'idlessVideo', channelUrl: sharedUrl },
    idBearingVideo: { id: 'idBearingVideo', channelId: 'UCdedupreconcilexxxxxxxx', channelUrl: sharedUrl },
  };

  const probeCalls = [];
  run.probeChannelAvatar = async (channelUrl) => {
    probeCalls.push(channelUrl);
    return { avatarUrl: 'https://example.com/dedup-reconcile.jpg', channelId: 'UCdedupreconcilexxxxxxxx', channelUrl };
  };

  const { base, close } = await startTestApp(deps, config);
  try {
    const res = await fetch(`${base}/api/ytdlp/refresh-avatars`, { method: 'POST' });
    assert.equal(res.status, 202);
    assert.deepEqual(await res.json(), { started: true, total: 1 }, 'the id-less item and its later id-bearing counterpart must collapse into ONE target');

    await flush(30);
    assert.equal(probeCalls.length, 1, 'the same real channel must be probed exactly once, never twice');
    assert.deepEqual(probeCalls, [sharedUrl]);

    const freshDb = deps.loadDatabase();
    const ns = store.ensureYtdlp(freshDb);
    assert.equal(ns.channelAvatars.UCdedupreconcilexxxxxxxx.avatarUrl, 'https://example.com/dedup-reconcile.jpg');
  } finally {
    await close();
  }
});

// ---- One bad item never wedges the batch -----------------------------------

test('a null probe result (no avatar found) is counted failed; the batch continues to the next subscription', async () => {
  const deps = makeFakeDeps();
  const config = enabledConfig();
  const subA = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@chanA', format: 'video' });
  const subB = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@chanB', format: 'video' });

  run.probeChannelAvatar = async (channelUrl) => (channelUrl === subA.channelUrl ? null : { avatarUrl: 'https://example.com/avatar.jpg', channelId: null, channelUrl: null });

  const { base, close } = await startTestApp(deps, config);
  try {
    await fetch(`${base}/api/ytdlp/refresh-avatars`, { method: 'POST' });
    await flush(30);

    const entry = getRefreshAvatarsEntry();
    assert.equal(entry.failed, 1);
    assert.equal(entry.done, 1);
    assert.equal(entry.state, 'done', 'one failed probe must not prevent the batch from reaching a terminal done state');

    const persisted = store.listSubscriptions(deps);
    assert.equal(persisted.find((s) => s.id === subA.id).channelAvatarUrl, undefined, 'a null probe result must never write an avatar');
    assert.equal(persisted.find((s) => s.id === subB.id).channelAvatarUrl, 'https://example.com/avatar.jpg');
  } finally {
    await close();
  }
});

test('a throw from probeChannelAvatar for one subscription is counted failed and the batch still continues', async () => {
  const deps = makeFakeDeps();
  const config = enabledConfig();
  const subA = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@chanA', format: 'video' });
  await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@chanB', format: 'video' });

  run.probeChannelAvatar = async (channelUrl) => {
    if (channelUrl === subA.channelUrl) throw new Error('boom -- simulated probe failure');
    return { avatarUrl: 'https://example.com/avatar.jpg', channelId: null, channelUrl: null };
  };

  const { base, close } = await startTestApp(deps, config);
  try {
    await fetch(`${base}/api/ytdlp/refresh-avatars`, { method: 'POST' });
    await flush(30);

    const entry = getRefreshAvatarsEntry();
    assert.equal(entry.failed, 1);
    assert.equal(entry.done, 1);
    assert.equal(entry.state, 'done');
  } finally {
    await close();
  }
});

// ---- Serialization: shares the global runExclusive FIFO gate --------------

test('refresh-avatars probes are serialized: never runs concurrently with a stubbed subscription poll download (shared runExclusive gate)', async () => {
  const deps = makeFakeDeps();
  const config = enabledConfig();
  await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@chanA', format: 'video' });
  const subB = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@chanB', format: 'video' });

  let active = 0;
  let overlapDetected = false;
  const enter = async () => {
    active += 1;
    if (active > 1) overlapDetected = true;
    await flush(25);
    active -= 1;
  };

  run.runList = async () => ({ ok: true, stdout: JSON.stringify({ id: 'ppppppppppp', availability: 'public' }), stderr: '' });
  run.runDownload = async () => {
    await enter();
    return { ok: true, code: 0, stdout: '', stderr: '' };
  };
  run.probeChannelAvatar = async (channelUrl) => {
    await enter();
    return channelUrl === subB.channelUrl ? 'https://example.com/avatar.jpg' : null;
  };

  const { base, close } = await startTestApp(deps, config);
  try {
    const refreshPromise = fetch(`${base}/api/ytdlp/refresh-avatars`, { method: 'POST' });
    const pollPromise = ytdlp.runPoll(deps, config);
    await refreshPromise;
    await pollPromise;
    await flush(120);

    assert.equal(overlapDetected, false, 'the refresh-avatars probe spawn and the subscription-poll download spawn must never run concurrently');
  } finally {
    await close();
  }
});

test('within one batch, subscriptions are strictly sequential (subscription N+1 never starts before subscription N settles)', async () => {
  const deps = makeFakeDeps();
  const config = enabledConfig();
  const subA = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@chanA', format: 'video' });
  const subB = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@chanB', format: 'video' });
  const subC = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@chanC', format: 'video' });

  let active = 0;
  let overlapDetected = false;
  const order = [];
  run.probeChannelAvatar = async (channelUrl) => {
    active += 1;
    if (active > 1) overlapDetected = true;
    order.push(channelUrl);
    await flush(10);
    active -= 1;
    return 'https://example.com/avatar.jpg';
  };

  const { base, close } = await startTestApp(deps, config);
  try {
    await fetch(`${base}/api/ytdlp/refresh-avatars`, { method: 'POST' });
    await flush(60);

    assert.equal(overlapDetected, false, 'no two subscriptions may ever be probed at the same time');
    assert.deepEqual(order, [subA.channelUrl, subB.channelUrl, subC.channelUrl], 'subscriptions must be processed strictly in order');
  } finally {
    await close();
  }
});

// ---- Concurrency guard: single-flight ---------------------------------------

test('a second POST while a refresh-avatars batch is already running is rejected (409, alreadyRunning) -- never starts a second batch', async () => {
  const deps = makeFakeDeps();
  const config = enabledConfig();
  await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@chanA', format: 'video' });

  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  let probeCallCount = 0;
  run.probeChannelAvatar = async () => {
    probeCallCount += 1;
    await firstGate;
    return 'https://example.com/avatar.jpg';
  };

  const { base, close } = await startTestApp(deps, config);
  try {
    const res1 = await fetch(`${base}/api/ytdlp/refresh-avatars`, { method: 'POST' });
    assert.equal(res1.status, 202);
    await flush(15); // let the background batch actually enter probeChannelAvatar and block on firstGate

    const res2 = await fetch(`${base}/api/ytdlp/refresh-avatars`, { method: 'POST' });
    assert.equal(res2.status, 409);
    assert.deepEqual(await res2.json(), { started: false, alreadyRunning: true });

    releaseFirst();
    await flush(30);
    assert.equal(probeCallCount, 1, 'only ONE batch (one probeChannelAvatar call) should ever have run');
  } finally {
    await close();
  }
});

// ---- Cancel -----------------------------------------------------------------

test('cancel sets the durable latch and stops the batch cleanly between items; the activity entry ends terminal (cancelled)', async () => {
  const deps = makeFakeDeps();
  const config = enabledConfig();
  const subA = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@chanA', format: 'video' });
  await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@chanB', format: 'video' });
  await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@chanC', format: 'video' });

  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const probeCalls = [];
  run.probeChannelAvatar = async (channelUrl) => {
    probeCalls.push(channelUrl);
    if (channelUrl === subA.channelUrl) await firstGate;
    return 'https://example.com/avatar.jpg';
  };

  const { base, close } = await startTestApp(deps, config);
  try {
    const res = await fetch(`${base}/api/ytdlp/refresh-avatars`, { method: 'POST' });
    assert.equal(res.status, 202);
    await flush(15); // subscription A is now in-flight, blocked on firstGate

    const cancelRes = await fetch(`${base}/api/ytdlp/refresh-avatars/cancel`, { method: 'POST' });
    assert.equal(cancelRes.status, 200);
    assert.deepEqual(await cancelRes.json(), { cancelled: true });

    releaseFirst(); // subscription A (already in-flight) is allowed to finish normally
    await flush(30);

    assert.deepEqual(probeCalls, [subA.channelUrl], 'subscriptions B and C must never be probed once cancelled');

    const entry = getRefreshAvatarsEntry();
    assert.equal(entry.state, 'cancelled');

    // The single-flight guard must be released too, so a fresh batch can be
    // started again after a cancel.
    const res2 = await fetch(`${base}/api/ytdlp/refresh-avatars`, { method: 'POST' });
    assert.equal(res2.status, 202);
  } finally {
    await close();
  }
});

test('cancel is an idempotent no-op ({cancelled:false}) when no refresh-avatars batch is currently running', async () => {
  const deps = makeFakeDeps();
  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    const res = await fetch(`${base}/api/ytdlp/refresh-avatars/cancel`, { method: 'POST' });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { cancelled: false });
  } finally {
    await close();
  }
});

// ---- Activity progress entry -------------------------------------------------

test('activity progress entry is created, advances as subscriptions complete, and goes terminal (done)', async () => {
  const deps = makeFakeDeps();
  const config = enabledConfig();
  const subA = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@chanA', format: 'video' });
  await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@chanB', format: 'video' });

  assert.equal(getRefreshAvatarsEntry(), undefined, 'no entry should exist before the route is ever hit');

  let releaseA;
  const gateA = new Promise((resolve) => { releaseA = resolve; });
  run.probeChannelAvatar = async (channelUrl) => {
    if (channelUrl === subA.channelUrl) await gateA;
    return { avatarUrl: 'https://example.com/avatar.jpg', channelId: null, channelUrl: null };
  };

  const { base, close } = await startTestApp(deps, config);
  try {
    await fetch(`${base}/api/ytdlp/refresh-avatars`, { method: 'POST' });
    await flush(15);

    const midEntry = getRefreshAvatarsEntry();
    assert.ok(midEntry, 'an activity entry must exist once the batch has started');
    assert.equal(midEntry.kind, 'refresh-avatars');
    assert.equal(midEntry.total, 2);
    assert.equal(midEntry.done, 0);
    // v1.25.x QoL bugfix: the batch's unit of work is now a distinct CHANNEL
    // target, not a bare subscription id -- `current` is a label built from
    // `channelId || channelUrl || subId` (see `runRefreshAvatarsBatch`'s own
    // doc comment); subA has no channelId yet, so its channelUrl is the label.
    assert.equal(midEntry.current, subA.channelUrl);
    assert.notEqual(midEntry.state, 'done');

    releaseA();
    await flush(30);

    const finalEntry = getRefreshAvatarsEntry();
    assert.equal(finalEntry.state, 'done');
    assert.equal(finalEntry.total, 2);
    assert.equal(finalEntry.done, 2);
    assert.equal(finalEntry.failed, 0);
    assert.equal(finalEntry.skipped, 0);
  } finally {
    await close();
  }
});

// ---- No auto-run (thumbnail-backfill-regression lesson) -------------------

test('structural lock: runRefreshAvatarsBatch is never invoked from any boot/scan/poll/timer path -- POST /api/ytdlp/refresh-avatars is the ONLY trigger', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../lib/ytdlp/index.js'), 'utf8');

  // The batch runner itself must have exactly ONE CALL site in the whole
  // file: the route handler. (`async function runRefreshAvatarsBatch(...)`
  // -- its own declaration -- is excluded via the negative lookbehind,
  // mirroring the reheat's own identical structural guard.)
  const callSites = src.match(/(?<!function )runRefreshAvatarsBatch\(/g) || [];
  assert.equal(callSites.length, 1, 'runRefreshAvatarsBatch must be called from exactly one place (the POST /api/ytdlp/refresh-avatars route handler)');

  // Every automatic/timer/boot-driven code path must never mention the
  // refresh-avatars batch runner or flip its in-progress latch, anywhere in
  // its own function body. Extracted via paren/brace DEPTH-counting (not a
  // single regex) -- see the reheat's own identical structural guard
  // (test/integration/ytdlp-repull-metadata-endpoint.test.js) for the full
  // rationale of this extraction approach.
  function extractFunctionBody(fnName) {
    const nameIdx = src.indexOf(`function ${fnName}(`);
    assert.ok(nameIdx >= 0, `could not locate function ${fnName} in lib/ytdlp/index.js -- this test needs updating`);
    let i = src.indexOf('(', nameIdx);
    let parenDepth = 0;
    do {
      if (src[i] === '(') parenDepth += 1;
      else if (src[i] === ')') parenDepth -= 1;
      i += 1;
    } while (parenDepth > 0 && i < src.length);
    while (src[i] !== '{' && i < src.length) i += 1;
    const start = i;
    let braceDepth = 0;
    do {
      if (src[i] === '{') braceDepth += 1;
      else if (src[i] === '}') braceDepth -= 1;
      i += 1;
    } while (braceDepth > 0 && i < src.length);
    return src.slice(start, i);
  }

  const autoRunFnNames = ['startBackground', 'armYtdlpTimer', 'runPoll', 'processSubscription', 'runSubscriptionCycle', 'runOneShot', 'migrateStaleDownloadDirFromFolders'];
  for (const fnName of autoRunFnNames) {
    const body = extractFunctionBody(fnName);
    assert.ok(!body.includes('runRefreshAvatarsBatch'), `${fnName} must never call runRefreshAvatarsBatch (no auto-run)`);
    assert.ok(!body.includes('refreshAvatarsInProgress = true'), `${fnName} must never flip the refresh-avatars in-progress latch (no auto-run)`);
  }
});
