'use strict';

// [INTEGRATION] `POST /api/ytdlp/repull-metadata` (+ its companion `POST
// /api/ytdlp/repull-metadata/cancel`): the metadata+subtitle re-pull backfill
// ("reheat") HTTP surface + orchestration in `lib/ytdlp/index.js`. This is
// DISTINCT from `POST /api/subscriptions/repull` (test/integration/
// ytdlp-repull-endpoints.test.js): that route re-polls subscriptions for NEW
// videos; this route re-pulls metadata+subtitles for EXISTING,
// already-downloaded items.
//
// Both `deps` seams (`enumerateRepullableItems`/`recordRepulledItemMeta`,
// already implemented+tested in server.js -- see
// test/integration/repull-persist.test.js) and `run.repullItemMetaAndSubs`
// (already implemented+tested in lib/ytdlp/run.js -- see
// test/integration/ytdlp-repull.test.js) are STUBBED here at their own
// boundaries: this file owns ONLY the route + orchestration contract (202
// posture, concurrency guard, skip/force, one-bad-item resilience,
// runExclusive serialization, cancel, activity progress, no-auto-run) -- not
// their own internals, which are covered elsewhere. No real yt-dlp binary,
// no real db.json; mirrors ytdlp-repull-endpoints.test.js's same-process
// fake-`express()`-app + fake-`deps` pattern.

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
const originalRepullItemMetaAndSubs = run.repullItemMetaAndSubs;

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-repull-meta-'));
  ytdlp.resetRepullMetadataStateForTests();
  activity.resetForTests();
});

afterEach(() => {
  run.runList = originalRunList;
  run.runDownload = originalRunDownload;
  run.repullItemMetaAndSubs = originalRepullItemMetaAndSubs;
  ytdlp.resetRepullMetadataStateForTests();
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

function makeItem(overrides = {}) {
  const videoId = overrides.videoId || 'aaaaaaaaaaa';
  return {
    mediaId: `media-${videoId}`,
    filePath: `/downloads/chan/Some Video [${videoId}].mp4`,
    videoId,
    watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
    alreadyRepulled: false,
    ...overrides,
  };
}

function flush(ms = 15) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getReheatEntry() {
  return activity.getSnapshot().oneShots[ytdlp.REPULL_METADATA_ACTIVITY_ID];
}

// ---- Disabled module: native 404, no spawn ---------------------------------

test('disabled module: POST /api/ytdlp/repull-metadata (and its cancel companion) are native 404s, no spawn', async () => {
  const deps = makeFakeDeps();
  let called = false;
  run.repullItemMetaAndSubs = async () => {
    called = true;
    return null;
  };

  const { base, close } = await startTestApp(deps, disabledConfig());
  try {
    const res = await fetch(`${base}/api/ytdlp/repull-metadata`, { method: 'POST' });
    assert.equal(res.status, 404);
    await flush();
    assert.equal(called, false, 'a disabled module must never spawn a re-pull');

    const cancelRes = await fetch(`${base}/api/ytdlp/repull-metadata/cancel`, { method: 'POST' });
    assert.equal(cancelRes.status, 404);
  } finally {
    await close();
  }
});

// ---- Enabled: 202 with the blast radius, background batch wiring ----------

test('enabled: responds 202 with {started:true, eligible, ineligible}; the background batch calls repullItemMetaAndSubs then recordRepulledItemMeta per eligible item, in order', async () => {
  const deps = makeFakeDeps();
  const itemA = makeItem({ videoId: 'aaaaaaaaaaa' });
  const itemB = makeItem({ videoId: 'bbbbbbbbbbb' });
  deps.enumerateRepullableItems = () => ({ items: [itemA, itemB], eligible: 2, ineligible: 3 });

  const repullCalls = [];
  const recordCalls = [];
  run.repullItemMetaAndSubs = async (watchUrl, filePath) => {
    repullCalls.push({ watchUrl, filePath });
    return { releaseDate: 1700000000000, channelAvatarUrl: 'https://example.com/avatar.jpg', wroteSubs: true };
  };
  deps.recordRepulledItemMeta = async (d, mediaId, meta) => {
    recordCalls.push({ mediaId, meta });
    return true;
  };

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    const res = await fetch(`${base}/api/ytdlp/repull-metadata`, { method: 'POST' });
    assert.equal(res.status, 202);
    assert.deepEqual(await res.json(), { started: true, eligible: 2, ineligible: 3 });

    await flush(30);
    assert.deepEqual(repullCalls.map((c) => c.watchUrl), [itemA.watchUrl, itemB.watchUrl], 'both items must be re-pulled, in order');
    assert.deepEqual(repullCalls.map((c) => c.filePath), [itemA.filePath, itemB.filePath]);
    assert.deepEqual(recordCalls.map((c) => c.mediaId), [itemA.mediaId, itemB.mediaId]);
    assert.equal(recordCalls[0].meta.releaseDate, 1700000000000);
    assert.equal(recordCalls[0].meta.channelAvatarUrl, 'https://example.com/avatar.jpg');
    assert.equal(recordCalls[0].meta.filePath, itemA.filePath, 'filePath must be forwarded so recordRepulledItemMeta can re-check the subtitle sidecar');
    assert.equal(recordCalls[0].meta.markComplete, true, 'markComplete must be true when the subs pass (wroteSubs) completed');

    const entry = getReheatEntry();
    assert.equal(entry.state, 'done');
    assert.equal(entry.total, 2);
    assert.equal(entry.done, 2);
    assert.equal(entry.failed, 0);
    assert.equal(entry.skipped, 0);
  } finally {
    await close();
  }
});

// ---- Idempotent skip + force ------------------------------------------------

test('an alreadyRepulled item is skipped (counted skipped) by default; ?force=1 re-includes it', async () => {
  const deps = makeFakeDeps();
  const oldItem = makeItem({ videoId: 'ccccccccccc', alreadyRepulled: true });
  deps.enumerateRepullableItems = () => ({ items: [oldItem], eligible: 1, ineligible: 0 });

  const repullCalls = [];
  run.repullItemMetaAndSubs = async (watchUrl) => {
    repullCalls.push(watchUrl);
    // F1: `wroteSubs: false` (a transient subs-spawn failure) is counted
    // `failed`, not `done` -- see the dedicated markComplete-counting tests
    // below for that contract. This test is about skip/force, not counting,
    // so it exercises the OTHER branch (`wroteSubs: true`) to keep its own
    // `done` assertion meaningful.
    return { wroteSubs: true };
  };
  deps.recordRepulledItemMeta = async () => true;

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    const res1 = await fetch(`${base}/api/ytdlp/repull-metadata`, { method: 'POST' });
    assert.equal(res1.status, 202);
    await flush(20);
    assert.deepEqual(repullCalls, [], 'an alreadyRepulled item must never be re-pulled without force');
    const entryAfterSkip = getReheatEntry();
    assert.equal(entryAfterSkip.skipped, 1);
    assert.equal(entryAfterSkip.done, 0);
    assert.equal(entryAfterSkip.state, 'done');

    const res2 = await fetch(`${base}/api/ytdlp/repull-metadata?force=1`, { method: 'POST' });
    assert.equal(res2.status, 202);
    await flush(20);
    assert.deepEqual(repullCalls, [oldItem.watchUrl], '?force=1 must re-include a previously-skipped item');
    const entryAfterForce = getReheatEntry();
    assert.equal(entryAfterForce.skipped, 0);
    assert.equal(entryAfterForce.done, 1);
  } finally {
    await close();
  }
});

test('force via a JSON body ({force:true}) also re-includes an alreadyRepulled item', async () => {
  const deps = makeFakeDeps();
  const oldItem = makeItem({ videoId: 'ddddddddddd', alreadyRepulled: true });
  deps.enumerateRepullableItems = () => ({ items: [oldItem], eligible: 1, ineligible: 0 });

  const repullCalls = [];
  run.repullItemMetaAndSubs = async (watchUrl) => {
    repullCalls.push(watchUrl);
    return { wroteSubs: false };
  };
  deps.recordRepulledItemMeta = async () => true;

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    const res = await fetch(`${base}/api/ytdlp/repull-metadata`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force: true }),
    });
    assert.equal(res.status, 202);
    await flush(20);
    assert.deepEqual(repullCalls, [oldItem.watchUrl]);
  } finally {
    await close();
  }
});

// ---- One bad item never wedges the batch -----------------------------------

test('a null result from repullItemMetaAndSubs is counted failed; the batch continues to the next item', async () => {
  const deps = makeFakeDeps();
  const itemA = makeItem({ videoId: 'aaaaaaaaaaa' });
  const itemB = makeItem({ videoId: 'bbbbbbbbbbb' });
  deps.enumerateRepullableItems = () => ({ items: [itemA, itemB], eligible: 2, ineligible: 0 });

  const recordCalls = [];
  run.repullItemMetaAndSubs = async (watchUrl) => (watchUrl === itemA.watchUrl ? null : { wroteSubs: true });
  deps.recordRepulledItemMeta = async (d, mediaId) => {
    recordCalls.push(mediaId);
    return true;
  };

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    await fetch(`${base}/api/ytdlp/repull-metadata`, { method: 'POST' });
    await flush(30);

    assert.deepEqual(recordCalls, [itemB.mediaId], 'only the successful item must be recorded; the null-result item must never call recordRepulledItemMeta');
    const entry = getReheatEntry();
    assert.equal(entry.failed, 1);
    assert.equal(entry.done, 1);
    assert.equal(entry.state, 'done', 'one failed item must not prevent the batch from reaching a terminal done state');
  } finally {
    await close();
  }
});

test('a throw from recordRepulledItemMeta for one item is counted failed and the batch still continues', async () => {
  const deps = makeFakeDeps();
  const itemA = makeItem({ videoId: 'aaaaaaaaaaa' });
  const itemB = makeItem({ videoId: 'bbbbbbbbbbb' });
  deps.enumerateRepullableItems = () => ({ items: [itemA, itemB], eligible: 2, ineligible: 0 });
  run.repullItemMetaAndSubs = async () => ({ wroteSubs: true });

  const recordCalls = [];
  deps.recordRepulledItemMeta = async (d, mediaId) => {
    if (mediaId === itemA.mediaId) throw new Error('boom -- simulated persistence failure');
    recordCalls.push(mediaId);
    return true;
  };

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    await fetch(`${base}/api/ytdlp/repull-metadata`, { method: 'POST' });
    await flush(30);

    assert.deepEqual(recordCalls, [itemB.mediaId], 'item B must still be processed despite item A throwing');
    const entry = getReheatEntry();
    assert.equal(entry.failed, 1);
    assert.equal(entry.done, 1);
    assert.equal(entry.state, 'done');
  } finally {
    await close();
  }
});

// ---- F1: markComplete gating / done-vs-failed counting ---------------------
//
// `runRepullMetadataBatch`'s own `deps.recordRepulledItemMeta` seam is
// stubbed here, so these tests lock the ORCHESTRATION contract (what
// `markComplete` value is forwarded, and how the outcome is counted) -- the
// actual `metadataRepulledAt`-gating behavior of the real
// `recordRepulledItemMeta` lives in test/integration/repull-persist.test.js.

test('a wroteSubs:false result (transient subs-spawn failure) is forwarded to recordRepulledItemMeta with markComplete:false, and is counted failed even though metadata was persisted', async () => {
  const deps = makeFakeDeps();
  const itemA = makeItem({ videoId: 'aaaaaaaaaaa' });
  deps.enumerateRepullableItems = () => ({ items: [itemA], eligible: 1, ineligible: 0 });

  run.repullItemMetaAndSubs = async () => ({ releaseDate: 1700000000000, wroteSubs: false });
  const recordCalls = [];
  deps.recordRepulledItemMeta = async (d, mediaId, meta) => {
    recordCalls.push({ mediaId, meta });
    return true; // the metadata write itself succeeds
  };

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    await fetch(`${base}/api/ytdlp/repull-metadata`, { method: 'POST' });
    await flush(30);

    assert.equal(recordCalls.length, 1, 'recordRepulledItemMeta must still be called so the successfully-fetched metadata is persisted');
    assert.equal(recordCalls[0].meta.markComplete, false, 'markComplete must be false when the subs pass did not complete');
    assert.equal(recordCalls[0].meta.releaseDate, 1700000000000, 'the metadata Pass A actually produced must still be forwarded for persistence');

    const entry = getReheatEntry();
    assert.equal(entry.failed, 1, 'a subs-spawn failure must be counted failed, not done, so the item is retried on a later non-force reheat');
    assert.equal(entry.done, 0);
    assert.equal(entry.state, 'done', 'the BATCH itself still reaches a terminal done state even though this item failed');
  } finally {
    await close();
  }
});

test('a wroteSubs:true result is forwarded to recordRepulledItemMeta with markComplete:true, and is counted done', async () => {
  const deps = makeFakeDeps();
  const itemA = makeItem({ videoId: 'aaaaaaaaaaa' });
  deps.enumerateRepullableItems = () => ({ items: [itemA], eligible: 1, ineligible: 0 });

  run.repullItemMetaAndSubs = async () => ({ wroteSubs: true });
  const recordCalls = [];
  deps.recordRepulledItemMeta = async (d, mediaId, meta) => {
    recordCalls.push({ mediaId, meta });
    return true;
  };

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    await fetch(`${base}/api/ytdlp/repull-metadata`, { method: 'POST' });
    await flush(30);

    assert.equal(recordCalls.length, 1);
    assert.equal(recordCalls[0].meta.markComplete, true, 'markComplete must be true when the subs pass completed');

    const entry = getReheatEntry();
    assert.equal(entry.done, 1);
    assert.equal(entry.failed, 0);
  } finally {
    await close();
  }
});

test('a vanished item (recordRepulledItemMeta resolves false, a safe no-op) is counted failed, not done -- even though wroteSubs was true', async () => {
  const deps = makeFakeDeps();
  const itemA = makeItem({ videoId: 'aaaaaaaaaaa' });
  deps.enumerateRepullableItems = () => ({ items: [itemA], eligible: 1, ineligible: 0 });

  run.repullItemMetaAndSubs = async () => ({ wroteSubs: true });
  deps.recordRepulledItemMeta = async () => false; // the item vanished from db.metadata mid-batch

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    await fetch(`${base}/api/ytdlp/repull-metadata`, { method: 'POST' });
    await flush(30);

    const entry = getReheatEntry();
    assert.equal(entry.done, 0, 'a no-op write must never be counted done, even though the subs pass fully completed');
    assert.equal(entry.failed, 1, 'a no-op write must be counted failed -- there is nothing to show for this item');
  } finally {
    await close();
  }
});

// ---- Serialization: shares the global runExclusive FIFO gate --------------

test('reheat items are serialized: never runs concurrently with a stubbed subscription poll download (shared runExclusive gate)', async () => {
  const deps = makeFakeDeps();
  const config = enabledConfig();
  await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@chanA', format: 'video' });

  const itemA = makeItem({ videoId: 'aaaaaaaaaaa' });
  deps.enumerateRepullableItems = () => ({ items: [itemA], eligible: 1, ineligible: 0 });
  deps.recordRepulledItemMeta = async () => true;

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
  run.repullItemMetaAndSubs = async () => {
    await enter();
    return { wroteSubs: true };
  };

  const { base, close } = await startTestApp(deps, config);
  try {
    const repullPromise = fetch(`${base}/api/ytdlp/repull-metadata`, { method: 'POST' });
    const pollPromise = ytdlp.runPoll(deps, config);
    await repullPromise;
    await pollPromise;
    await flush(80);

    assert.equal(overlapDetected, false, 'the reheat spawn and the subscription-poll download spawn must never run concurrently');
  } finally {
    await close();
  }
});

test('within one batch, items are strictly sequential (item N+1 never starts before item N settles)', async () => {
  const deps = makeFakeDeps();
  const itemA = makeItem({ videoId: 'aaaaaaaaaaa' });
  const itemB = makeItem({ videoId: 'bbbbbbbbbbb' });
  const itemC = makeItem({ videoId: 'ccccccccccc' });
  deps.enumerateRepullableItems = () => ({ items: [itemA, itemB, itemC], eligible: 3, ineligible: 0 });
  deps.recordRepulledItemMeta = async () => true;

  let active = 0;
  let overlapDetected = false;
  const order = [];
  run.repullItemMetaAndSubs = async (watchUrl) => {
    active += 1;
    if (active > 1) overlapDetected = true;
    order.push(watchUrl);
    await flush(10);
    active -= 1;
    return { wroteSubs: true };
  };

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    await fetch(`${base}/api/ytdlp/repull-metadata`, { method: 'POST' });
    await flush(60);

    assert.equal(overlapDetected, false, 'no two items may ever be in-flight at the same time');
    assert.deepEqual(order, [itemA.watchUrl, itemB.watchUrl, itemC.watchUrl], 'items must be processed strictly in order');
  } finally {
    await close();
  }
});

// ---- Concurrency guard: single-flight ---------------------------------------

test('a second POST while a reheat batch is already running is rejected (409, alreadyRunning) -- never starts a second batch', async () => {
  const deps = makeFakeDeps();
  const itemA = makeItem({ videoId: 'aaaaaaaaaaa' });
  deps.enumerateRepullableItems = () => ({ items: [itemA], eligible: 1, ineligible: 0 });
  deps.recordRepulledItemMeta = async () => true;

  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  let repullCallCount = 0;
  run.repullItemMetaAndSubs = async () => {
    repullCallCount += 1;
    await firstGate;
    return { wroteSubs: true };
  };

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    const res1 = await fetch(`${base}/api/ytdlp/repull-metadata`, { method: 'POST' });
    assert.equal(res1.status, 202);
    await flush(15); // let the background batch actually enter repullItemMetaAndSubs and block on firstGate

    const res2 = await fetch(`${base}/api/ytdlp/repull-metadata`, { method: 'POST' });
    assert.equal(res2.status, 409);
    assert.deepEqual(await res2.json(), { started: false, alreadyRunning: true });

    releaseFirst();
    await flush(30);
    assert.equal(repullCallCount, 1, 'only ONE batch (one repullItemMetaAndSubs call) should ever have run');
  } finally {
    await close();
  }
});

// ---- Cancel -----------------------------------------------------------------

test('cancel sets the durable latch and stops the batch cleanly between items; the activity entry ends terminal (cancelled)', async () => {
  const deps = makeFakeDeps();
  const itemA = makeItem({ videoId: 'aaaaaaaaaaa' });
  const itemB = makeItem({ videoId: 'bbbbbbbbbbb' });
  const itemC = makeItem({ videoId: 'ccccccccccc' });
  deps.enumerateRepullableItems = () => ({ items: [itemA, itemB, itemC], eligible: 3, ineligible: 0 });

  const recordCalls = [];
  deps.recordRepulledItemMeta = async (d, mediaId) => {
    recordCalls.push(mediaId);
    return true;
  };

  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const repullCalls = [];
  run.repullItemMetaAndSubs = async (watchUrl) => {
    repullCalls.push(watchUrl);
    if (watchUrl === itemA.watchUrl) await firstGate;
    return { wroteSubs: true };
  };

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    const res = await fetch(`${base}/api/ytdlp/repull-metadata`, { method: 'POST' });
    assert.equal(res.status, 202);
    await flush(15); // item A is now in-flight, blocked on firstGate

    const cancelRes = await fetch(`${base}/api/ytdlp/repull-metadata/cancel`, { method: 'POST' });
    assert.equal(cancelRes.status, 200);
    assert.deepEqual(await cancelRes.json(), { cancelled: true });

    releaseFirst(); // item A (already in-flight) is allowed to finish normally
    await flush(30);

    assert.deepEqual(repullCalls, [itemA.watchUrl], 'items B and C must never spawn once cancelled');
    assert.deepEqual(recordCalls, [itemA.mediaId], 'the already-in-flight item A still completes/records normally');

    const entry = getReheatEntry();
    assert.equal(entry.state, 'cancelled');

    // The single-flight guard must be released too, so a fresh reheat can be
    // started again after a cancel.
    const res2 = await fetch(`${base}/api/ytdlp/repull-metadata`, { method: 'POST' });
    assert.equal(res2.status, 202);
  } finally {
    await close();
  }
});

test('cancel is an idempotent no-op ({cancelled:false}) when no reheat batch is currently running', async () => {
  const deps = makeFakeDeps();
  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    const res = await fetch(`${base}/api/ytdlp/repull-metadata/cancel`, { method: 'POST' });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { cancelled: false });
  } finally {
    await close();
  }
});

// ---- Activity progress entry -------------------------------------------------

test('activity progress entry is created, advances as items complete, and goes terminal (done)', async () => {
  const deps = makeFakeDeps();
  const itemA = makeItem({ videoId: 'aaaaaaaaaaa' });
  const itemB = makeItem({ videoId: 'bbbbbbbbbbb' });
  deps.enumerateRepullableItems = () => ({ items: [itemA, itemB], eligible: 2, ineligible: 0 });
  deps.recordRepulledItemMeta = async () => true;

  assert.equal(getReheatEntry(), undefined, 'no entry should exist before the route is ever hit');

  let releaseA;
  const gateA = new Promise((resolve) => { releaseA = resolve; });
  run.repullItemMetaAndSubs = async (watchUrl) => {
    if (watchUrl === itemA.watchUrl) await gateA;
    return { wroteSubs: true };
  };

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    await fetch(`${base}/api/ytdlp/repull-metadata`, { method: 'POST' });
    await flush(15);

    const midEntry = getReheatEntry();
    assert.ok(midEntry, 'an activity entry must exist once the batch has started');
    assert.equal(midEntry.kind, 'repull');
    assert.equal(midEntry.total, 2);
    assert.equal(midEntry.done, 0);
    assert.equal(midEntry.current, itemA.videoId);
    assert.notEqual(midEntry.state, 'done');

    releaseA();
    await flush(30);

    const finalEntry = getReheatEntry();
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

test('structural lock: enumerateRepullableItems/recordRepulledItemMeta/runRepullMetadataBatch are never invoked from any boot/scan/poll/timer path -- POST /api/ytdlp/repull-metadata is the ONLY trigger', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../lib/ytdlp/index.js'), 'utf8');

  // The batch runner itself must have exactly ONE CALL site in the whole
  // file: the route handler. (`async function runRepullMetadataBatch(...)`
  // -- its own declaration -- is excluded via the negative lookbehind, so
  // this proves no OTHER function -- present or future -- has been wired to
  // call it.)
  const callSites = src.match(/(?<!function )runRepullMetadataBatch\(/g) || [];
  assert.equal(callSites.length, 1, 'runRepullMetadataBatch must be called from exactly one place (the POST /api/ytdlp/repull-metadata route handler)');

  // FIX 2 (QA hardening): the `autoRunFnNames` allowlist below is
  // hand-maintained -- it only catches a stray call from a function someone
  // remembered to ADD to the list. These two GLOBAL, allowlist-independent
  // call-site counts are the real backstop: they prove
  // `enumerateRepullableItems`/`recordRepulledItemMeta` are invoked from
  // EXACTLY their one expected call site each, ANYWHERE in this file -- so a
  // brand-new function (never added to `autoRunFnNames`) that starts calling
  // either one trips this immediately. Mirrors the `runRepullMetadataBatch`
  // count above: `(?<!function )NAME\(` matches a real invocation (`deps.NAME(`
  // or `NAME(`) but not the function's own declaration line, a bare
  // `typeof deps.NAME !== 'function'` guard (no `(` immediately follows the
  // name there), or a mention inside a comment/doc-string (also no `(`
  // immediately after).
  const enumerateCallSites = src.match(/(?<!function )enumerateRepullableItems\(/g) || [];
  assert.equal(enumerateCallSites.length, 1, 'enumerateRepullableItems must be called from exactly one place in lib/ytdlp/index.js (the POST /api/ytdlp/repull-metadata route handler) -- a second call site anywhere in this file must fail this test');

  const recordCallSites = src.match(/(?<!function )recordRepulledItemMeta\(/g) || [];
  assert.equal(recordCallSites.length, 1, 'recordRepulledItemMeta must be called from exactly one place in lib/ytdlp/index.js (inside runRepullMetadataBatch) -- a second call site anywhere in this file must fail this test');

  // Every automatic/timer/boot-driven code path must never mention the
  // reheat batch runner or either deps-bridged seam, anywhere in its own
  // function body. Extracted via paren/brace DEPTH-counting (not a single
  // regex) so a default-parameter value that itself contains a call, e.g.
  // `function startBackground(deps = {}, config = parseYtdlpConfig()) {`,
  // is handled correctly -- a naive `\([^)]*\)` would stop at the FIRST `)`
  // (inside `parseYtdlpConfig()`), well short of the real parameter-list end.
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
    // `i` now sits just past the parameter list's closing `)`; advance to
    // the function's opening `{`.
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

  const autoRunFnNames = ['startBackground', 'armYtdlpTimer', 'runPoll', 'processSubscription', 'runSubscriptionCycle', 'migrateStaleDownloadDirFromFolders'];
  for (const fnName of autoRunFnNames) {
    const body = extractFunctionBody(fnName);
    assert.ok(!body.includes('runRepullMetadataBatch'), `${fnName} must never call runRepullMetadataBatch (no auto-run)`);
    assert.ok(!body.includes('enumerateRepullableItems'), `${fnName} must never call enumerateRepullableItems (no auto-run)`);
    assert.ok(!body.includes('recordRepulledItemMeta'), `${fnName} must never call recordRepulledItemMeta (no auto-run)`);
    assert.ok(!body.includes('repullMetadataInProgress = true'), `${fnName} must never flip the reheat's in-progress latch (no auto-run)`);
  }
});

test('structural lock: server.js never CALLS enumerateRepullableItems/recordRepulledItemMeta -- it only defines and exports them', () => {
  // FIX 2 (QA hardening), second half: `enumerateRepullableItems` and
  // `recordRepulledItemMeta` are plain exported functions in server.js (not
  // hidden behind a `deps` bridge on that side), so a future scan/boot
  // caller added DIRECTLY in server.js (e.g. from a scan pass, a startup
  // routine, or a timer) would NOT be caught by the lib/ytdlp/index.js-only
  // checks above. This test closes that gap the same way: a GLOBAL
  // call-invocation count over the whole file, which must be exactly ZERO.
  //
  // What this DOES cover: any textual call-site of the form `NAME(...)`
  // added ANYWHERE in server.js (a scan function, `require.main === module`
  // boot code, a `setInterval` timer body, etc.) -- the two functions are
  // only ever supposed to be (a) DEFINED (`function enumerateRepullableItems(`
  // / `async function recordRepulledItemMeta(`) and (b) EXPORTED as bare
  // property-shorthand entries in `module.exports` (`recordRepulledItemMeta,`
  // / `enumerateRepullableItems,`, no parentheses) -- both excluded below.
  //
  // What this does NOT cover (documented limitation, matching the
  // `runRepullMetadataBatch` guard's own posture): a call reached only via
  // dynamic/indirect means -- bracket notation (`this['enumerateRepullableItems'](...)`),
  // `.call`/`.apply`/`.bind`, a call built up from a string and `eval`'d, or
  // a call added from some OTHER file that `require('../server')`s these
  // functions directly (bypassing the `deps` bridge the module header
  // comment, ~line 3149, documents as the intended wiring contract). Those
  // are all far more conspicuous during code review than a plain call
  // expression, so a purely textual/structural guard is the pragmatic choice
  // here, same as the existing `runRepullMetadataBatch` regex above.
  const src = fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8');

  function countCallInvocations(fnName) {
    // `(?<!function )NAME\(` excludes the function's own declaration line
    // (`function NAME(` / `async function NAME(`) -- the SAME pattern used
    // for `runRepullMetadataBatch` above. A bare `module.exports` property
    // shorthand (`NAME,`) never has a `(` immediately after the name, so it
    // is excluded automatically without any special-casing.
    return (src.match(new RegExp(`(?<!function )${fnName}\\(`, 'g')) || []).length;
  }

  assert.equal(countCallInvocations('enumerateRepullableItems'), 0, 'server.js must never itself CALL enumerateRepullableItems -- only lib/ytdlp/index.js (via the deps bridge) may call it');
  assert.equal(countCallInvocations('recordRepulledItemMeta'), 0, 'server.js must never itself CALL recordRepulledItemMeta -- only lib/ytdlp/index.js (via the deps bridge) may call it');
});
