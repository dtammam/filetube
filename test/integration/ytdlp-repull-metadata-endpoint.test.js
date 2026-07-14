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
// v1.41.5: the reheat now probes a discovered channel's avatar (once per
// distinct channel) through `ensureChannelAvatar` -> `run.probeChannelAvatar`.
const originalProbeChannelAvatar = run.probeChannelAvatar;

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
  run.probeChannelAvatar = originalProbeChannelAvatar;
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
    // v1.41.5: these fixtures all live under the module's own download dir, so
    // the real `enumerateRepullableItems` would flag them -- which is what
    // licenses the batch to trust their embedded tags (see `trustEmbeddedTags`,
    // lib/ytdlp/index.js). A plain-library-root item is built literally in the
    // tests that need one, deliberately WITHOUT this flag.
    inDownloadRoot: true,
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
    // v1.41.5: `withSourceId` rides along (0 here -- this test's stubbed
    // enumerator predates the field, and the route clamps an absent one).
    assert.deepEqual(await res.json(), { started: true, eligible: 2, ineligible: 3, withSourceId: 0 });

    await flush(30);
    assert.deepEqual(repullCalls.map((c) => c.watchUrl), [itemA.watchUrl, itemB.watchUrl], 'both items must be re-pulled, in order');
    assert.deepEqual(repullCalls.map((c) => c.filePath), [itemA.filePath, itemB.filePath]);
    assert.deepEqual(recordCalls.map((c) => c.mediaId), [itemA.mediaId, itemB.mediaId]);
    assert.equal(recordCalls[0].meta.releaseDate, 1700000000000);
    // v1.33 T1: the worker no longer forwards channelAvatarUrl (dead since
    // v1.25 -- repullItemMetaAndSubs never returns it) and instead forwards
    // the item's derived youtubeId for persistence.
    assert.equal(recordCalls[0].meta.channelAvatarUrl, undefined);
    assert.equal(recordCalls[0].meta.youtubeId, 'aaaaaaaaaaa');
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
  deps.recordRepulledItemMeta = async (d, mediaId, meta) => {
    recordCalls.push({ mediaId, meta });
    return true;
  };

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    await fetch(`${base}/api/ytdlp/repull-metadata`, { method: 'POST' });
    await flush(30);

    // v1.33 T1: the null-result item now STILL calls recordRepulledItemMeta
    // -- its derived youtubeId is worth persisting (gap-fill) even when the
    // network pass produced nothing -- but with markComplete:false, so it
    // stays retryable and is honestly counted failed, exactly as before.
    assert.deepEqual(recordCalls.map((c) => c.mediaId), [itemA.mediaId, itemB.mediaId]);
    assert.equal(recordCalls[0].meta.markComplete, false, 'the null-result item must stay retryable (never marked complete)');
    assert.equal(recordCalls[0].meta.releaseDate, undefined, 'no releaseDate may be invented for a null result');
    assert.equal(recordCalls[0].meta.youtubeId, 'aaaaaaaaaaa');
    assert.equal(recordCalls[1].meta.markComplete, true);
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

// ---- v1.33 T1: the LOCAL tags pass (probeEmbeddedTags dep) ------------------
// A bracket-less (metube-era) item has null videoId/watchUrl. The worker's
// LOCAL ffprobe pass (deps.probeEmbeddedTags) is its only shot: an embedded
// `purl` yields a watch URL (and thus a network pass) on the fly; embedded
// date/title are the fallback when the network yields nothing; an item with
// NOTHING derivable is marked complete (exhausted) so it is never retried on
// every later non-force reheat.

test('local pass: a bracket-less item with an embedded purl derives a watch URL on the fly and network-repulls through it', async () => {
  const deps = makeFakeDeps();
  const item = makeItem({ videoId: null, watchUrl: null, filePath: '/downloads/chan/Metube Import.mp4' });
  deps.enumerateRepullableItems = () => ({ items: [item], eligible: 1, ineligible: 0 });
  deps.probeEmbeddedTags = async () => ({
    releaseDateMs: 1500000000000,
    sourceUrl: 'https://www.youtube.com/watch?v=eeeeeeeeeee',
    title: 'Local Tag Title',
  });

  const repullCalls = [];
  const recordCalls = [];
  run.repullItemMetaAndSubs = async (watchUrl) => {
    repullCalls.push(watchUrl);
    return { releaseDate: 1600000000000, sourceTitle: 'Network Title 🎵', wroteSubs: true };
  };
  deps.recordRepulledItemMeta = async (d, mediaId, meta) => {
    recordCalls.push({ mediaId, meta });
    return true;
  };

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    await fetch(`${base}/api/ytdlp/repull-metadata`, { method: 'POST' });
    await flush(30);

    assert.deepEqual(repullCalls, ['https://www.youtube.com/watch?v=eeeeeeeeeee'],
      'the network pass must run against the purl-derived watch URL');
    assert.equal(recordCalls.length, 1);
    const meta = recordCalls[0].meta;
    assert.equal(meta.youtubeId, 'eeeeeeeeeee', 'the purl-derived id is persisted');
    assert.equal(meta.releaseDate, 1600000000000, 'NETWORK date beats the local embedded date');
    assert.equal(meta.sourceTitle, 'Network Title 🎵', 'NETWORK title beats the local embedded title');
    assert.equal(meta.markComplete, true);
    assert.equal(getReheatEntry().done, 1);
  } finally {
    await close();
  }
});

test('local pass: embedded date/title are the fallback when the network pass produces nothing usable', async () => {
  const deps = makeFakeDeps();
  const item = makeItem({ videoId: 'fffffffffff' }); // bracketed -- network runs directly
  deps.enumerateRepullableItems = () => ({ items: [item], eligible: 1, ineligible: 0 });
  deps.probeEmbeddedTags = async () => ({
    releaseDateMs: 1500000000000,
    sourceUrl: null,
    title: 'Embedded Tag Title 🌸',
  });

  const recordCalls = [];
  run.repullItemMetaAndSubs = async () => ({ wroteSubs: true }); // no releaseDate, no sourceTitle
  deps.recordRepulledItemMeta = async (d, mediaId, meta) => {
    recordCalls.push({ mediaId, meta });
    return true;
  };

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    await fetch(`${base}/api/ytdlp/repull-metadata`, { method: 'POST' });
    await flush(30);

    assert.equal(recordCalls.length, 1);
    const meta = recordCalls[0].meta;
    assert.equal(meta.releaseDate, 1500000000000, 'the LOCAL embedded date fills the gap the network left');
    assert.equal(meta.sourceTitle, 'Embedded Tag Title 🌸', 'the LOCAL embedded title fills the gap too');
    assert.equal(meta.youtubeId, 'fffffffffff');
    assert.equal(meta.markComplete, true);
  } finally {
    await close();
  }
});

test('local pass: an item with NOTHING derivable (probe SUCCEEDED, no id anywhere, no local tags) is marked complete (exhausted), never network-spawned, and honestly counted SKIPPED not done', async () => {
  const deps = makeFakeDeps();
  const item = makeItem({ videoId: null, watchUrl: null, filePath: '/downloads/chan/Opaque File.mp4' });
  deps.enumerateRepullableItems = () => ({ items: [item], eligible: 1, ineligible: 0 });
  // A successful probe that found nothing -- the all-null OBJECT (vs `null`,
  // which means the probe itself failed; see the transient test below).
  deps.probeEmbeddedTags = async () => ({ releaseDateMs: null, sourceUrl: null, title: null });

  let networkCalled = false;
  const recordCalls = [];
  run.repullItemMetaAndSubs = async () => {
    networkCalled = true;
    return null;
  };
  deps.recordRepulledItemMeta = async (d, mediaId, meta) => {
    recordCalls.push({ mediaId, meta });
    return true;
  };

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    await fetch(`${base}/api/ytdlp/repull-metadata`, { method: 'POST' });
    await flush(30);

    assert.equal(networkCalled, false, 'no watch URL is derivable -> the network pass must never spawn');
    assert.equal(recordCalls.length, 1);
    assert.equal(recordCalls[0].meta.markComplete, true,
      'exhausted -- nothing a future non-force reheat could ever add, so mark complete to stop the retry loop');
    assert.equal(recordCalls[0].meta.releaseDate, undefined, 'no date may be invented');
    assert.equal(recordCalls[0].meta.sourceTitle, undefined);
    // Honest bookkeeping (gate fix): NOTHING was fetched or persisted for
    // this item -- counting it `done` would let a batch of bare imports
    // report "N done" while doing zero work.
    assert.equal(getReheatEntry().done, 0);
    assert.equal(getReheatEntry().skipped, 1);
    assert.equal(getReheatEntry().failed, 0);
  } finally {
    await close();
  }
});

test('local pass: a TRANSIENT probe failure (probeEmbeddedTags resolves null) on an id-less item is counted failed and NOT marked complete -- the item stays retryable', async () => {
  const deps = makeFakeDeps();
  const item = makeItem({ videoId: null, watchUrl: null, filePath: '/downloads/chan/Locked File.mp4' });
  deps.enumerateRepullableItems = () => ({ items: [item], eligible: 1, ineligible: 0 });
  // `null` -- the whole value -- is probeEmbeddedTags' "the probe itself
  // failed" contract (ffmpeg unavailable / spawn error / malformed output).
  deps.probeEmbeddedTags = async () => null;

  let networkCalled = false;
  const recordCalls = [];
  run.repullItemMetaAndSubs = async () => {
    networkCalled = true;
    return null;
  };
  deps.recordRepulledItemMeta = async (d, mediaId, meta) => {
    recordCalls.push({ mediaId, meta });
    return true;
  };

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    await fetch(`${base}/api/ytdlp/repull-metadata`, { method: 'POST' });
    await flush(30);

    assert.equal(networkCalled, false);
    assert.equal(recordCalls.length, 0,
      'a transient probe failure must persist NOTHING -- especially not a markComplete that would permanently foreclose future discovery');
    assert.equal(getReheatEntry().failed, 1, 'honestly failed (retryable), never done/skipped');
    assert.equal(getReheatEntry().done, 0);
    assert.equal(getReheatEntry().skipped, 0);
  } finally {
    await close();
  }
});

test('local pass: an exhausted item whose local tags DID yield a date/title is counted done (real work landed) and marked complete', async () => {
  const deps = makeFakeDeps();
  const item = makeItem({ videoId: null, watchUrl: null, filePath: '/downloads/chan/Tagged Import.mp4' });
  deps.enumerateRepullableItems = () => ({ items: [item], eligible: 1, ineligible: 0 });
  deps.probeEmbeddedTags = async () => ({ releaseDateMs: 1400000000000, sourceUrl: null, title: 'Embedded Only Title' });

  const recordCalls = [];
  run.repullItemMetaAndSubs = async () => {
    throw new Error('must never be called without a watch URL');
  };
  deps.recordRepulledItemMeta = async (d, mediaId, meta) => {
    recordCalls.push({ mediaId, meta });
    return true;
  };

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    await fetch(`${base}/api/ytdlp/repull-metadata`, { method: 'POST' });
    await flush(30);

    assert.equal(recordCalls.length, 1);
    assert.equal(recordCalls[0].meta.releaseDate, 1400000000000);
    assert.equal(recordCalls[0].meta.sourceTitle, 'Embedded Only Title');
    assert.equal(recordCalls[0].meta.markComplete, true);
    assert.equal(getReheatEntry().done, 1, 'a date/title genuinely landed -- done, not skipped');
    assert.equal(getReheatEntry().skipped, 0);
  } finally {
    await close();
  }
});

test('local pass: a probeEmbeddedTags dep that THROWS is contained -- the item still processes via its bracket id', async () => {
  const deps = makeFakeDeps();
  const item = makeItem({ videoId: 'ggggggggggg' });
  deps.enumerateRepullableItems = () => ({ items: [item], eligible: 1, ineligible: 0 });
  deps.probeEmbeddedTags = async () => { throw new Error('ffprobe exploded'); };

  const recordCalls = [];
  run.repullItemMetaAndSubs = async () => ({ releaseDate: 1700000000000, wroteSubs: true });
  deps.recordRepulledItemMeta = async (d, mediaId, meta) => {
    recordCalls.push(meta);
    return true;
  };

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    await fetch(`${base}/api/ytdlp/repull-metadata`, { method: 'POST' });
    await flush(30);

    assert.equal(recordCalls.length, 1);
    assert.equal(recordCalls[0].releaseDate, 1700000000000);
    assert.equal(getReheatEntry().done, 1, 'a local-probe failure must never fail the item');
  } finally {
    await close();
  }
});

// ---- v1.34 gate fix (QA CRITICAL): the chapters-only persist gate -----------
// An item whose probe yields ONLY chapters (no date/title/id change, no subs
// write) must still reach recordRepulledItemMeta -- the persist gate's
// OR-chain omitting the new field was the persist-gate bug class's FIFTH
// strike, caught in-gate.
test('a reheat item yielding ONLY chapters still persists them (never silently dropped)', async () => {
  const deps = makeFakeDeps();
  const item = makeItem({ videoId: 'ccccccccccc' });
  deps.enumerateRepullableItems = () => ({ items: [item], eligible: 1, ineligible: 0 });

  const recordCalls = [];
  // Network pass yields chapters and nothing else; subs pass failed
  // (wroteSubs false -> retryable), so WITHOUT chapters in the gate this
  // item would skip recordRepulledItemMeta entirely.
  run.repullItemMetaAndSubs = async () => ({
    chapters: [{ startTime: 0, title: 'Intro' }, { startTime: 60, title: 'Main' }],
    wroteSubs: false,
  });
  deps.recordRepulledItemMeta = async (d, mediaId, meta) => {
    recordCalls.push({ mediaId, meta });
    return true;
  };

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    await fetch(`${base}/api/ytdlp/repull-metadata`, { method: 'POST' });
    await flush(30);

    assert.equal(recordCalls.length, 1, 'chapters alone must be enough to trigger the persist');
    assert.deepEqual(recordCalls[0].meta.chapters, [{ startTime: 0, title: 'Intro' }, { startTime: 60, title: 'Main' }]);
    assert.equal(recordCalls[0].meta.markComplete, false, 'subs still failed -- retryable, honest');
    assert.equal(getReheatEntry().failed, 1, 'counted failed (subs incomplete) even though chapters persisted -- unchanged honest bookkeeping');
  } finally {
    await close();
  }
});

test('local-pass chapters flow through to recordRepulledItemMeta with network > local precedence', async () => {
  const deps = makeFakeDeps();
  const item = makeItem({ videoId: 'ddddddddddd' });
  deps.enumerateRepullableItems = () => ({ items: [item], eligible: 1, ineligible: 0 });
  deps.probeEmbeddedTags = async () => ({
    releaseDateMs: null, sourceUrl: null, title: null,
    chapters: [{ startTime: 5, title: 'Local Embedded' }],
  });

  const recordCalls = [];
  run.repullItemMetaAndSubs = async () => ({ wroteSubs: true }); // network yields no chapters
  deps.recordRepulledItemMeta = async (d, mediaId, meta) => {
    recordCalls.push({ mediaId, meta });
    return true;
  };

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    await fetch(`${base}/api/ytdlp/repull-metadata`, { method: 'POST' });
    await flush(30);

    assert.equal(recordCalls.length, 1);
    assert.deepEqual(recordCalls[0].meta.chapters, [{ startTime: 5, title: 'Local Embedded' }],
      'the LOCAL embedded chapters fill the gap the network left');
  } finally {
    await close();
  }
});

// ---- v1.41.5 (Dean's MeTube-import hydration): channel identity + a ---------
// ONCE-PER-CHANNEL avatar probe --------------------------------------------

test('the batch threads Pass A\'s channel identity into recordRepulledItemMeta, and probes the avatar ONCE PER DISTINCT CHANNEL (not once per item)', async () => {
  const deps = makeFakeDeps({ ytdlp: { subscriptions: [], channelAvatars: {}, downloadMeta: {} } });
  // 4 imported items across 2 channels -- the shape of Dean's library (many
  // videos, few channels). A per-ITEM avatar probe would be 4 spawns.
  const items = [
    makeItem({ videoId: 'aaaaaaaaaaa' }),
    makeItem({ videoId: 'bbbbbbbbbbb' }),
    makeItem({ videoId: 'ccccccccccc' }),
    makeItem({ videoId: 'ddddddddddd' }),
  ];
  deps.enumerateRepullableItems = () => ({ items, eligible: 4, ineligible: 0, withSourceId: 4 });

  const CHANNEL_ONE = {
    channelUrl: 'https://www.youtube.com/@ChannelOne',
    channelId: 'UC1111111111111111111111',
    channelName: 'Channel One',
  };
  const CHANNEL_TWO = {
    channelUrl: 'https://www.youtube.com/@ChannelTwo',
    channelId: 'UC2222222222222222222222',
    channelName: 'Channel Two',
  };
  const channelByVideo = {
    'https://www.youtube.com/watch?v=aaaaaaaaaaa': CHANNEL_ONE,
    'https://www.youtube.com/watch?v=bbbbbbbbbbb': CHANNEL_ONE,
    'https://www.youtube.com/watch?v=ccccccccccc': CHANNEL_TWO,
    'https://www.youtube.com/watch?v=ddddddddddd': CHANNEL_ONE,
  };

  run.repullItemMetaAndSubs = async (watchUrl) => ({
    channel: { ...channelByVideo[watchUrl] },
    wroteSubs: false,
    subsSkipped: true, // an out-of-root import: Pass B can never run
  });

  const avatarProbes = [];
  run.probeChannelAvatar = async (channelUrl) => {
    avatarProbes.push(channelUrl);
    return { avatarUrl: `https://yt3.googleusercontent.com/${encodeURIComponent(channelUrl)}.jpg`, channelId: null, channelUrl };
  };

  const recordCalls = [];
  deps.recordRepulledItemMeta = async (d, mediaId, meta) => {
    recordCalls.push({ mediaId, meta });
    return true;
  };

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    await fetch(`${base}/api/ytdlp/repull-metadata`, { method: 'POST' });
    await flush(60);

    assert.equal(recordCalls.length, 4);
    assert.deepEqual(recordCalls[0].meta.channel, CHANNEL_ONE, 'the discovered identity must reach the persistence seam');
    assert.deepEqual(recordCalls[2].meta.channel, CHANNEL_TWO);
    assert.ok(recordCalls[0].meta.channelAvatarUrl, 'the probed avatar rides along with it');

    assert.deepEqual(avatarProbes, [CHANNEL_ONE.channelUrl, CHANNEL_TWO.channelUrl],
      'exactly ONE avatar probe per DISTINCT channel -- 4 items across 2 channels must never mean 4 probes');

    // Every item still gets the right avatar, memo hit or not.
    assert.equal(recordCalls[3].meta.channelAvatarUrl, recordCalls[0].meta.channelAvatarUrl,
      'the 3rd item on channel one reuses the memoized avatar');

    const entry = getReheatEntry();
    assert.equal(entry.state, 'done');
    assert.equal(entry.done, 4, 'an out-of-root import whose subs pass could never run is DONE, not failed');
    assert.equal(entry.failed, 0);
  } finally {
    await close();
  }
});

test('a FAILED avatar probe is memoized too -- a channel whose avatar cannot be probed is never re-probed once per item', async () => {
  const deps = makeFakeDeps({ ytdlp: { subscriptions: [], channelAvatars: {}, downloadMeta: {} } });
  const items = [makeItem({ videoId: 'aaaaaaaaaaa' }), makeItem({ videoId: 'bbbbbbbbbbb' }), makeItem({ videoId: 'ccccccccccc' })];
  deps.enumerateRepullableItems = () => ({ items, eligible: 3, ineligible: 0, withSourceId: 3 });

  run.repullItemMetaAndSubs = async () => ({
    channel: { channelUrl: 'https://www.youtube.com/@OneChannel', channelName: 'One Channel' },
    wroteSubs: true,
  });

  let probeCount = 0;
  run.probeChannelAvatar = async () => {
    probeCount += 1;
    return null; // total miss (the channel endpoint yielded nothing usable)
  };

  const recordCalls = [];
  deps.recordRepulledItemMeta = async (d, mediaId, meta) => {
    recordCalls.push(meta);
    return true;
  };

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    await fetch(`${base}/api/ytdlp/repull-metadata`, { method: 'POST' });
    await flush(60);

    assert.equal(probeCount, 1, 'a miss is cached: 3 items on one channel must still cost exactly ONE probe');
    assert.equal(recordCalls.length, 3);
    assert.equal(recordCalls[0].channelAvatarUrl, undefined, 'no avatar found -> the field is simply absent (never an empty string)');
    assert.ok(recordCalls[0].channel, 'the identity still lands -- an avatar is a bonus, not a precondition');
  } finally {
    await close();
  }
});

test('an item whose ONLY new fact is its channel identity is persisted and counted done (never dropped as "nothing to persist")', async () => {
  const deps = makeFakeDeps({ ytdlp: { subscriptions: [], channelAvatars: {}, downloadMeta: {} } });
  // No videoId anywhere on the item -- but a local embedded purl gives the
  // worker a watch URL, and the network pass comes back with ONLY a channel.
  const item = { mediaId: 'media-import', filePath: '/library/music/Some Song.mp3', videoId: null, watchUrl: null, alreadyRepulled: false };
  deps.enumerateRepullableItems = () => ({ items: [item], eligible: 1, ineligible: 0, withSourceId: 0 });
  deps.probeEmbeddedTags = async () => ({ sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', releaseDateMs: null, title: null, chapters: null });

  run.repullItemMetaAndSubs = async () => ({
    channel: { channelUrl: 'https://www.youtube.com/@RickAstley', channelName: 'Rick Astley' },
    wroteSubs: false,
    subsSkipped: true,
  });
  run.probeChannelAvatar = async () => null;

  const recordCalls = [];
  deps.recordRepulledItemMeta = async (d, mediaId, meta) => {
    recordCalls.push(meta);
    return true;
  };

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    await fetch(`${base}/api/ytdlp/repull-metadata`, { method: 'POST' });
    await flush(60);

    assert.equal(recordCalls.length, 1, 'the channel-only result must still be persisted (the persist-gate bug class)');
    assert.equal(recordCalls[0].channel.channelName, 'Rick Astley');
    assert.equal(recordCalls[0].youtubeId, 'dQw4w9WgXcQ', 'the id the LOCAL purl tag surfaced is persisted too');
    assert.equal(recordCalls[0].markComplete, true, 'subsSkipped -> the item is done, not retried on every later reheat');

    const entry = getReheatEntry();
    assert.equal(entry.done, 1);
    assert.equal(entry.failed, 0);
  } finally {
    await close();
  }
});

test('a tagless local file (no id, no embedded source URL) NEVER reaches the network -- no repull spawn, no avatar probe', async () => {
  const deps = makeFakeDeps({ ytdlp: { subscriptions: [], channelAvatars: {}, downloadMeta: {} } });
  const item = { mediaId: 'media-home-video', filePath: '/library/home/Family BBQ.mp4', videoId: null, watchUrl: null, alreadyRepulled: false };
  deps.enumerateRepullableItems = () => ({ items: [item], eligible: 1, ineligible: 0, withSourceId: 0 });
  // The LOCAL probe ran fine and found nothing -- a genuine home video.
  deps.probeEmbeddedTags = async () => ({ sourceUrl: null, releaseDateMs: null, title: null, chapters: null });

  let repullCalls = 0;
  let avatarProbes = 0;
  run.repullItemMetaAndSubs = async () => { repullCalls += 1; return { wroteSubs: true }; };
  run.probeChannelAvatar = async () => { avatarProbes += 1; return null; };
  deps.recordRepulledItemMeta = async () => true;

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    await fetch(`${base}/api/ytdlp/repull-metadata`, { method: 'POST' });
    await flush(60);

    assert.equal(repullCalls, 0, 'a file with no derivable YouTube id must NEVER trigger a yt-dlp network call');
    assert.equal(avatarProbes, 0, 'and never an avatar probe either');

    const entry = getReheatEntry();
    assert.equal(entry.skipped, 1, 'exhausted with nothing to persist -> honestly skipped, never "done"');
    assert.equal(entry.done, 0);
    assert.equal(entry.failed, 0);
  } finally {
    await close();
  }
});

// GATE FIX (adversarial CRITICAL #2 -- promoted from the reviewer's repro):
// the widened, root-agnostic gate enumerates ordinary NON-YouTube library files
// (ripped CDs, home videos, movie rips) so their embedded tags can still be
// checked for a purl. The batch must NOT then drag the v1.33 local-tag
// fallbacks onto them: `recordRepulledItemMeta` applies sourceTitle/releaseDate
// as a SUPERSEDE, so a ripper's generic ID3 `title` ("Track 05") would replace
// Dean's curated, filename-derived title -- irreversibly (there is no
// title-edit endpoint, and the scan's carry-forward re-prefers sourceTitle
// forever) -- and an embedded `date` tag would rewrite releaseDate, reordering
// the library-wide default sort. Zero network calls involved: it would corrupt
// the title with withSourceId === 0.
test('a NON-YouTube library file (no id, no source URL) never has its title/date/chapters superseded by its own embedded tags', async () => {
  const deps = makeFakeDeps({ ytdlp: { subscriptions: [], channelAvatars: {}, downloadMeta: {} } });
  const item = { mediaId: 'media-cd-rip', filePath: '/library/music/Beethoven - Symphony No. 5.mp3', videoId: null, watchUrl: null, alreadyRepulled: false };
  deps.enumerateRepullableItems = () => ({ items: [item], eligible: 1, ineligible: 0, withSourceId: 0 });
  // The local ffprobe pass succeeds and returns the file's REAL embedded tags --
  // a generic ripper title, a composition date, container chapters. None of it
  // is YouTube provenance, and none of it may be persisted.
  deps.probeEmbeddedTags = async () => ({
    sourceUrl: null,
    title: 'Track 05',
    releaseDateMs: Date.UTC(1808, 11, 22),
    chapters: [{ startTime: 0, title: 'Allegro con brio' }],
  });

  let repullCalls = 0;
  run.repullItemMetaAndSubs = async () => { repullCalls += 1; return { wroteSubs: true }; };
  run.probeChannelAvatar = async () => null;

  const recordCalls = [];
  deps.recordRepulledItemMeta = async (d, mediaId, meta) => {
    recordCalls.push(meta);
    return true;
  };

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    await fetch(`${base}/api/ytdlp/repull-metadata`, { method: 'POST' });
    await flush(60);

    assert.equal(repullCalls, 0, 'sanity: no network call for a file with no YouTube id');
    assert.equal(recordCalls.length, 1, 'the item is still marked exhausted (so it is never re-probed)');
    assert.equal(recordCalls[0].sourceTitle, undefined, 'a NON-YouTube file\'s ID3 title must NEVER be forwarded into the SUPERSEDE write');
    assert.equal(recordCalls[0].releaseDate, undefined, 'nor its embedded date (it would reorder the whole library\'s default sort)');
    assert.equal(recordCalls[0].chapters, undefined, 'nor its container chapters');
    assert.equal(recordCalls[0].markComplete, true, 'exhausted -> marked, never re-probed on later reheats');

    const entry = getReheatEntry();
    assert.equal(entry.skipped, 1, 'nothing was persisted -> honestly skipped, never "done"');
  } finally {
    await close();
  }
});

// The SAME local tags, on a file that IS a YouTube import (its embedded purl
// gives the batch a watch URL): here the fallbacks are exactly right and MUST
// still fire -- the v1.33 behavior this guard must not regress.
test('a YouTube-identified import still gets its LOCAL embedded title/date/chapters as the network fallback (v1.33 behavior preserved)', async () => {
  const deps = makeFakeDeps({ ytdlp: { subscriptions: [], channelAvatars: {}, downloadMeta: {} } });
  const item = { mediaId: 'media-import', filePath: '/library/yt/Some Import.mp4', videoId: null, watchUrl: null, alreadyRepulled: false };
  deps.enumerateRepullableItems = () => ({ items: [item], eligible: 1, ineligible: 0, withSourceId: 0 });
  deps.probeEmbeddedTags = async () => ({
    sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', // <- the purl tag: this IS a YouTube video
    title: 'Rick Astley - Never Gonna Give You Up',
    releaseDateMs: Date.UTC(2009, 9, 25),
    chapters: [{ startTime: 0, title: 'Intro' }],
  });

  // The NETWORK pass fails outright (offline / video gone) -- so the local tags
  // are all we have, and they are legitimate YouTube provenance.
  run.repullItemMetaAndSubs = async () => null;
  run.probeChannelAvatar = async () => null;

  const recordCalls = [];
  deps.recordRepulledItemMeta = async (d, mediaId, meta) => {
    recordCalls.push(meta);
    return true;
  };

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    await fetch(`${base}/api/ytdlp/repull-metadata`, { method: 'POST' });
    await flush(60);

    assert.equal(recordCalls.length, 1);
    assert.equal(recordCalls[0].sourceTitle, 'Rick Astley - Never Gonna Give You Up');
    assert.equal(recordCalls[0].releaseDate, Date.UTC(2009, 9, 25));
    assert.deepEqual(recordCalls[0].chapters, [{ startTime: 0, title: 'Intro' }]);
    assert.equal(recordCalls[0].youtubeId, 'dQw4w9WgXcQ');
  } finally {
    await close();
  }
});

// ---- v1.41.6: the import-relocation seam (`deps.relocateHydratedImport`) ----
//
// The relocation DECISION (eligibility, never touching local media, the
// settings toggle, confinement, no-clobber, the id re-key) belongs to
// server.js's `relocateHydratedImportIntoChannelFolder` and is covered against
// the real filesystem in test/integration/repull-relocate.test.js. What this
// file owns is the BATCH's contract with that seam: when it is called, on which
// items, and how its outcome is counted.

test('v1.41.6: the batch calls the relocation seam for each recorded item, AFTER its metadata persisted, and counts `moved` in the activity entry', async () => {
  const deps = makeFakeDeps({ ytdlp: { subscriptions: [], channelAvatars: {}, downloadMeta: {} } });
  const item = { mediaId: 'media-import', filePath: '/library/yt/Some Import.mp4', videoId: null, watchUrl: null, alreadyRepulled: false };
  deps.enumerateRepullableItems = () => ({ items: [item], eligible: 1, ineligible: 0, withSourceId: 0 });
  deps.probeEmbeddedTags = async () => ({ sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' });
  run.repullItemMetaAndSubs = async () => ({
    sourceTitle: 'Never Gonna Give You Up',
    subsSkipped: true, // outside the download root -- the v1.41.5 structural skip
    channel: { channelUrl: 'https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw', channelName: 'Rick Astley' },
  });
  run.probeChannelAvatar = async () => null;

  const order = [];
  deps.recordRepulledItemMeta = async () => { order.push('record'); return true; };
  const relocCalls = [];
  deps.relocateHydratedImport = async (d, config, mediaId) => {
    order.push('relocate');
    relocCalls.push(mediaId);
    return { status: 'moved', newId: 'new-id', newPath: '/downloads/Rick Astley/Never Gonna Give You Up [dQw4w9WgXcQ].mp4' };
  };

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    await fetch(`${base}/api/ytdlp/repull-metadata`, { method: 'POST' });
    await flush(60);

    assert.deepEqual(relocCalls, ['media-import'], 'the seam is called once, with the item\'s CURRENT (pre-move) media id');
    assert.deepEqual(order, ['record', 'relocate'], 'the file may only move AFTER its hydrated identity has persisted');

    const entry = getReheatEntry();
    assert.equal(entry.moved, 1, 'a relocation is counted');
    assert.equal(entry.done, 1, 'and the metadata reheat still counts as done');
    assert.equal(entry.failed, 0);
  } finally {
    await close();
  }
});

test('v1.41.6: a FAILED relocation is counted as `moveFailed` -- never as a failed reheat (the metadata pass succeeded) and never wedges the batch', async () => {
  const deps = makeFakeDeps({ ytdlp: { subscriptions: [], channelAvatars: {}, downloadMeta: {} } });
  const items = [
    { mediaId: 'media-a', filePath: '/library/yt/A.mp4', videoId: 'aaaaaaaaaaa', watchUrl: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', alreadyRepulled: false },
    { mediaId: 'media-b', filePath: '/library/yt/B.mp4', videoId: 'bbbbbbbbbbb', watchUrl: 'https://www.youtube.com/watch?v=bbbbbbbbbbb', alreadyRepulled: false },
  ];
  deps.enumerateRepullableItems = () => ({ items, eligible: 2, ineligible: 0, withSourceId: 2 });
  run.repullItemMetaAndSubs = async () => ({ sourceTitle: 'T', wroteSubs: true });
  run.probeChannelAvatar = async () => null;
  deps.recordRepulledItemMeta = async () => true;
  deps.relocateHydratedImport = async (d, config, mediaId) => (
    mediaId === 'media-a'
      ? { status: 'failed', reason: 'Could not move the file: EACCES' }
      : { status: 'skipped', reason: 'no-youtube-identity' }
  );

  const errors = [];
  const originalError = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    await fetch(`${base}/api/ytdlp/repull-metadata`, { method: 'POST' });
    await flush(80);

    const entry = getReheatEntry();
    assert.equal(entry.moveFailed, 1, 'the failed move is reported honestly');
    assert.equal(entry.moved, 0);
    assert.equal(entry.done, 2, 'both metadata reheats still succeeded -- a failed MOVE is not a failed reheat');
    assert.equal(entry.failed, 0);
    assert.equal(entry.state, 'done', 'and a failed move never wedges the batch');
    assert.ok(errors.some((e) => e.includes('could not relocate')), 'the failure is logged');
  } finally {
    console.error = originalError;
    await close();
  }
});

test('v1.41.6: a relocation seam that THROWS is contained -- counted, logged, and the batch runs to completion', async () => {
  const deps = makeFakeDeps({ ytdlp: { subscriptions: [], channelAvatars: {}, downloadMeta: {} } });
  // An out-of-root item with an id -- i.e. an actual relocation candidate (an
  // in-root item never reaches the seam at all; see the pre-filter).
  deps.enumerateRepullableItems = () => ({
    items: [makeItem({ filePath: '/library/yt/Import.mp4', inDownloadRoot: false })],
    eligible: 1, ineligible: 0, withSourceId: 1,
  });
  run.repullItemMetaAndSubs = async () => ({ sourceTitle: 'T', wroteSubs: true });
  run.probeChannelAvatar = async () => null;
  deps.recordRepulledItemMeta = async () => true;
  deps.relocateHydratedImport = async () => { throw new Error('boom'); };

  const originalError = console.error;
  console.error = () => {};
  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    await fetch(`${base}/api/ytdlp/repull-metadata`, { method: 'POST' });
    await flush(60);

    const entry = getReheatEntry();
    assert.equal(entry.moveFailed, 1);
    assert.equal(entry.done, 1, 'the metadata reheat still succeeded');
    assert.equal(entry.state, 'done');
  } finally {
    console.error = originalError;
    await close();
  }
});

test('v1.41.6: an item whose metadata write did NOT land is never relocated (a file must not move on the strength of a write that failed)', async () => {
  const deps = makeFakeDeps({ ytdlp: { subscriptions: [], channelAvatars: {}, downloadMeta: {} } });
  // A genuine relocation candidate (out of root, with an id), so the ONLY thing
  // standing between it and a move is the `recorded` gate under test.
  deps.enumerateRepullableItems = () => ({
    items: [makeItem({ filePath: '/library/yt/Import.mp4', inDownloadRoot: false })],
    eligible: 1, ineligible: 0, withSourceId: 1,
  });
  run.repullItemMetaAndSubs = async () => ({ sourceTitle: 'T', wroteSubs: true });
  run.probeChannelAvatar = async () => null;
  deps.recordRepulledItemMeta = async () => false; // the item vanished mid-batch
  let called = false;
  deps.relocateHydratedImport = async () => { called = true; return { status: 'moved' }; };

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    await fetch(`${base}/api/ytdlp/repull-metadata`, { method: 'POST' });
    await flush(60);

    assert.equal(called, false, 'no relocation for an item whose identity never persisted');
    const entry = getReheatEntry();
    assert.equal(entry.moved, 0);
    assert.equal(entry.failed, 1, 'and the reheat itself is honestly failed');
  } finally {
    await close();
  }
});

test('v1.41.6: a deps bundle WITHOUT the relocation seam (older/stubbed server) reheats exactly as it did in v1.41.5 -- no throw, no counters', async () => {
  const deps = makeFakeDeps({ ytdlp: { subscriptions: [], channelAvatars: {}, downloadMeta: {} } });
  // A relocation candidate, so the absent seam is genuinely the only reason
  // nothing moves.
  deps.enumerateRepullableItems = () => ({
    items: [makeItem({ filePath: '/library/yt/Import.mp4', inDownloadRoot: false })],
    eligible: 1, ineligible: 0, withSourceId: 1,
  });
  run.repullItemMetaAndSubs = async () => ({ sourceTitle: 'T', wroteSubs: true });
  run.probeChannelAvatar = async () => null;
  deps.recordRepulledItemMeta = async () => true;
  // deliberately no deps.relocateHydratedImport

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    await fetch(`${base}/api/ytdlp/repull-metadata`, { method: 'POST' });
    await flush(60);

    const entry = getReheatEntry();
    assert.equal(entry.done, 1);
    assert.equal(entry.moved, 0);
    assert.equal(entry.moveFailed, 0);
    assert.equal(entry.state, 'done');
  } finally {
    await close();
  }
});

// DEAN'S ACTUAL LIBRARY STATE, and the literal ask ("if a reheat FINDS a
// hydrated file not in such a folder, fix it"): v1.41.5's reheat already
// hydrated every import, so every one of them carries `metadataRepulledAt` and
// lands on the non-force SKIP path. If the relocation only ran for freshly
// reheated items, Dean would press Reheat, watch it skip the whole library, and
// see nothing move.
test('v1.41.6: an ALREADY-hydrated item (skipped by a non-force reheat) is still relocated -- no network pass, no force flag needed', async () => {
  const deps = makeFakeDeps({ ytdlp: { subscriptions: [], channelAvatars: {}, downloadMeta: {} } });
  const items = [
    // A previously-hydrated MeTube import: marked, outside the download root,
    // with a persisted youtubeId. THE case.
    { mediaId: 'media-import', filePath: '/library/yt/Some Import.mp4', videoId: 'dQw4w9WgXcQ', watchUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', inDownloadRoot: false, alreadyRepulled: true },
    // A home video: marked, outside the root, NO id -> must not even reach the seam.
    { mediaId: 'media-home', filePath: '/library/home/BBQ.mp4', videoId: null, watchUrl: null, inDownloadRoot: false, alreadyRepulled: true },
    // A native download: marked, already in the root -> must not reach the seam.
    { mediaId: 'media-native', filePath: '/downloads/chan/V [aaaaaaaaaaa].mp4', videoId: 'aaaaaaaaaaa', watchUrl: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', inDownloadRoot: true, alreadyRepulled: true },
  ];
  deps.enumerateRepullableItems = () => ({ items, eligible: 3, ineligible: 0, withSourceId: 2 });

  let networkCalls = 0;
  run.repullItemMetaAndSubs = async () => { networkCalls += 1; return { wroteSubs: true }; };
  run.probeChannelAvatar = async () => null;
  let recordCalls = 0;
  deps.recordRepulledItemMeta = async () => { recordCalls += 1; return true; };

  const seen = [];
  deps.relocateHydratedImport = async (d, config, mediaId) => {
    seen.push(mediaId);
    return { status: 'moved', newId: 'new', newPath: '/downloads/Rick Astley/x.mp4' };
  };

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    await fetch(`${base}/api/ytdlp/repull-metadata`, { method: 'POST' });
    await flush(80);

    assert.deepEqual(seen, ['media-import'], 'ONLY the out-of-root item with a YouTube id is offered to the relocation seam');
    assert.equal(networkCalls, 0, 'and it costs NO network pass -- the metadata is already hydrated');
    assert.equal(recordCalls, 0, 'and no metadata write');

    const entry = getReheatEntry();
    assert.equal(entry.moved, 1);
    assert.equal(entry.skipped, 3, 'all three are still honestly counted as skipped reheats');
    assert.equal(entry.done, 0);
    assert.equal(entry.state, 'done');
  } finally {
    await close();
  }
});
