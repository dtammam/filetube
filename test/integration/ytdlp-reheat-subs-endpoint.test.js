'use strict';

// [INTEGRATION] `POST /api/ytdlp/reheat-sub-counts` (+ its companion
// `POST /api/ytdlp/reheat-sub-counts/cancel`): the v1.56 "Reheat sub counts"
// bulk subscriber-count refresh HTTP surface + orchestration in
// lib/ytdlp/index.js. Deliberately mirrors
// test/integration/ytdlp-refresh-avatars-endpoint.test.js structure-for-
// structure (the batch is that one's shape verbatim, different unit of
// action): 202 posture, distinct-channel targets, concurrency guard,
// skip/failed accounting, runExclusive serialization, cancel, activity
// progress, no-auto-run structural lock.
//
// `run.probeChannelFollowerCount` (implemented+tested in lib/ytdlp/run.js)
// is STUBBED at its own boundary; `deps.recordChannelFollowerCountFanout`
// (implemented+tested in server.js / test/unit/reheat-subs-fanout.test.js)
// is a SPY here -- this file owns ONLY the route + orchestration contract.
// The REAL server.js deps-bridge binding (the seat-that-forgot-to-call-the-
// helper / presence-not-binding class) is locked separately by
// test/integration/reheat-subs-bridge.test.js against the real app.

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
const originalProbeChannelFollowerCount = run.probeChannelFollowerCount;

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-reheat-subs-'));
  ytdlp.resetReheatSubsStateForTests();
  activity.resetForTests();
});

afterEach(() => {
  run.runList = originalRunList;
  run.runDownload = originalRunDownload;
  run.probeChannelFollowerCount = originalProbeChannelFollowerCount;
  ytdlp.resetReheatSubsStateForTests();
  activity.resetForTests();
  ytdlp.armYtdlpTimer(ytdlp.parseYtdlpConfig({})); // clear any armed timer between tests
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// The fanout is a SPY recording (target, probed) pairs; per-call return
// values come from `plan` (defaults to 1 stamped item per successful probe).
function makeFakeDeps(initialDb = {}, fanoutPlan = () => 1) {
  let db = initialDb;
  const fanoutCalls = [];
  const deps = {
    loadDatabase: () => db,
    updateDatabase: (mutatorFn) => Promise.resolve(mutatorFn(db)),
    scanDirectories: async () => {},
    getMediaId: (input) => crypto.createHash('md5').update(input).digest('hex'),
    recordChannelFollowerCountFanout: async (passedDeps, target, probed) => {
      fanoutCalls.push({ passedDeps, target, probed });
      return fanoutPlan(target, probed);
    },
  };
  deps.fanoutCalls = fanoutCalls;
  return deps;
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

function getReheatSubsEntry() {
  return activity.getSnapshot().oneShots[ytdlp.REHEAT_SUBS_ACTIVITY_ID];
}

// ---- Disabled module: native 404, no spawn ---------------------------------

test('disabled module: POST /api/ytdlp/reheat-sub-counts (and its cancel companion) are native 404s, no probe', async () => {
  const deps = makeFakeDeps();
  let called = false;
  run.probeChannelFollowerCount = async () => {
    called = true;
    return null;
  };

  const { base, close } = await startTestApp(deps, disabledConfig());
  try {
    const res = await fetch(`${base}/api/ytdlp/reheat-sub-counts`, { method: 'POST' });
    assert.equal(res.status, 404);
    await flush();
    assert.equal(called, false, 'a disabled module must never spawn a follower-count probe');

    const cancelRes = await fetch(`${base}/api/ytdlp/reheat-sub-counts/cancel`, { method: 'POST' });
    assert.equal(cancelRes.status, 404);
  } finally {
    await close();
  }
});

// ---- Enabled: 202 with the total; probe + fan-out per distinct channel ----

test('enabled: 202 {started:true, total}; each distinct channel is probed and the fan-out is called with (deps, target, probed); itemsUpdated accumulates', async () => {
  const deps = makeFakeDeps({}, () => 3);
  const config = enabledConfig();
  const subA = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@chanA', format: 'video' });
  const subB = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@chanB', format: 'video' });

  const probeCalls = [];
  run.probeChannelFollowerCount = async (channelUrl) => {
    probeCalls.push(channelUrl);
    return { followerCount: 1000 * probeCalls.length, channelId: null, channelUrl: null };
  };

  const { base, close } = await startTestApp(deps, config);
  try {
    const res = await fetch(`${base}/api/ytdlp/reheat-sub-counts`, { method: 'POST' });
    assert.equal(res.status, 202);
    assert.deepEqual(await res.json(), { started: true, total: 2 });

    await flush(30);
    assert.deepEqual(probeCalls, [subA.channelUrl, subB.channelUrl], 'both channels must be probed, in order');

    assert.equal(deps.fanoutCalls.length, 2);
    assert.equal(deps.fanoutCalls[0].passedDeps, deps, 'the batch must pass the SAME deps object through (the deps-bridge contract)');
    assert.equal(deps.fanoutCalls[0].target.channelUrl, subA.channelUrl);
    assert.deepEqual(deps.fanoutCalls[0].probed, { followerCount: 1000, channelId: null, channelUrl: null });
    assert.equal(deps.fanoutCalls[1].target.channelUrl, subB.channelUrl);

    const entry = getReheatSubsEntry();
    assert.equal(entry.state, 'done');
    assert.equal(entry.total, 2);
    assert.equal(entry.done, 2);
    assert.equal(entry.failed, 0);
    assert.equal(entry.skipped, 0);
    assert.equal(entry.itemsUpdated, 6, 'the fan-out per-channel stamped-item counts must accumulate (3 + 3)');
  } finally {
    await close();
  }
});

test('a probe success whose fan-out matches 0 items is still DONE (a subscribed channel with no downloaded items is legitimate)', async () => {
  const deps = makeFakeDeps({}, () => 0);
  const config = enabledConfig();
  await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@chanA', format: 'video' });

  run.probeChannelFollowerCount = async () => ({ followerCount: 5, channelId: null, channelUrl: null });

  const { base, close } = await startTestApp(deps, config);
  try {
    await fetch(`${base}/api/ytdlp/reheat-sub-counts`, { method: 'POST' });
    await flush(30);
    const entry = getReheatSubsEntry();
    assert.equal(entry.done, 1);
    assert.equal(entry.failed, 0);
    assert.equal(entry.itemsUpdated, 0);
    assert.equal(entry.state, 'done');
  } finally {
    await close();
  }
});

test('distinct channels are drawn from subscriptions AND db.metadata items (a never-subscribed one-off channel is probed too, deduped by channelId)', async () => {
  const deps = makeFakeDeps();
  const config = enabledConfig();
  const subA = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@chanA', format: 'video' });

  const db = deps.loadDatabase();
  db.metadata = {
    oneOffVideo: {
      id: 'oneOffVideo',
      channelId: 'UConeoffchannelidxxxxxxx',
      channelUrl: 'https://www.youtube.com/channel/UConeoffchannelidxxxxxxx',
    },
  };

  const probeCalls = [];
  run.probeChannelFollowerCount = async (channelUrl) => {
    probeCalls.push(channelUrl);
    return { followerCount: 10, channelId: null, channelUrl: null };
  };

  const { base, close } = await startTestApp(deps, config);
  try {
    const res = await fetch(`${base}/api/ytdlp/reheat-sub-counts`, { method: 'POST' });
    assert.deepEqual(await res.json(), { started: true, total: 2 }, 'total must count the DISTINCT channel from db.metadata too');
    await flush(30);
    assert.deepEqual(
      new Set(probeCalls),
      new Set([subA.channelUrl, 'https://www.youtube.com/channel/UConeoffchannelidxxxxxxx']),
    );
  } finally {
    await close();
  }
});

test('a target with no channelUrl is counted skipped, never probed, and the fan-out never runs for it', async () => {
  const deps = makeFakeDeps();
  const config = enabledConfig();
  await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@chanA', format: 'video' });
  const db = deps.loadDatabase();
  store.ensureYtdlp(db).subscriptions.push({ id: 'no-url-sub', name: 'No URL', channelUrl: '', format: 'video', quality: 'best', order: 1 });

  const probeCalls = [];
  run.probeChannelFollowerCount = async (channelUrl) => {
    probeCalls.push(channelUrl);
    return { followerCount: 10, channelId: null, channelUrl: null };
  };

  const { base, close } = await startTestApp(deps, config);
  try {
    const res = await fetch(`${base}/api/ytdlp/reheat-sub-counts`, { method: 'POST' });
    assert.deepEqual(await res.json(), { started: true, total: 2 });
    await flush(30);
    assert.equal(probeCalls.length, 1, 'only the target with a real channelUrl may be probed');
    assert.equal(deps.fanoutCalls.length, 1);

    const entry = getReheatSubsEntry();
    assert.equal(entry.skipped, 1);
    assert.equal(entry.done, 1);
    assert.equal(entry.state, 'done');
  } finally {
    await close();
  }
});

test('two targets resolving to the SAME probed channelId fan out only ONCE (gate S2: pre-first-poll handle-vs-canonical double enumeration must not double-count itemsUpdated)', async () => {
  const deps = makeFakeDeps({}, () => 4);
  const config = enabledConfig();
  // The repro'd enumeration shape: a subscription knowing only its handle
  // URL (channelId still unpopulated, pre-first-poll)...
  await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@name', format: 'video' });
  // ...plus an item for the SAME channel under its canonical URL + id --
  // the collector's idless-target upgrade keys on URL equality, so these
  // yield TWO targets for one real channel.
  const db = deps.loadDatabase();
  db.metadata = {
    vid1: { id: 'vid1', channelId: 'UCsamechannelidxxxxxxxxx', channelUrl: 'https://www.youtube.com/channel/UCsamechannelidxxxxxxxxx' },
  };

  run.probeChannelFollowerCount = async (channelUrl) => ({ followerCount: 99, channelId: 'UCsamechannelidxxxxxxxxx', channelUrl });

  const { base, close } = await startTestApp(deps, config);
  try {
    const res = await fetch(`${base}/api/ytdlp/reheat-sub-counts`, { method: 'POST' });
    assert.deepEqual(await res.json(), { started: true, total: 2 }, 'the enumeration double-counts this shape (inherited from refresh-avatars, tech-debt tracked)');
    await flush(30);

    assert.equal(deps.fanoutCalls.length, 1, 'the SECOND target resolving to the same probed channelId must skip the duplicate fan-out');
    const entry = getReheatSubsEntry();
    assert.equal(entry.done, 2, 'both targets were genuinely probed and are fresh -- both count done');
    assert.equal(entry.itemsUpdated, 4, 'itemsUpdated must stay an honest count of DISTINCT stamped videos (4, not 8)');
    assert.equal(entry.state, 'done');
  } finally {
    await close();
  }
});

// ---- Failure resilience ----------------------------------------------------

test('a null probe result (no usable count -- e.g. a non-YouTube extractor) is counted failed; the fan-out NEVER runs for it; the batch continues', async () => {
  const deps = makeFakeDeps();
  const config = enabledConfig();
  const subA = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@chanA', format: 'video' });
  const subB = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@chanB', format: 'video' });

  run.probeChannelFollowerCount = async (channelUrl) => (channelUrl === subA.channelUrl ? null : { followerCount: 42, channelId: null, channelUrl: null });

  const { base, close } = await startTestApp(deps, config);
  try {
    await fetch(`${base}/api/ytdlp/reheat-sub-counts`, { method: 'POST' });
    await flush(30);

    const entry = getReheatSubsEntry();
    assert.equal(entry.failed, 1);
    assert.equal(entry.done, 1);
    assert.equal(entry.state, 'done', 'one failed probe must not prevent a terminal done state');
    assert.equal(deps.fanoutCalls.length, 1, 'a failed probe must never reach the fan-out writer (existing counts stay untouched)');
    assert.equal(deps.fanoutCalls[0].target.channelUrl, subB.channelUrl);
  } finally {
    await close();
  }
});

test('a throw from the probe OR the fan-out for one channel is counted failed and the batch still continues', async () => {
  const deps = makeFakeDeps({}, (target) => {
    if (target.channelUrl === 'https://www.youtube.com/@chanB') throw new Error('boom -- simulated fan-out failure');
    return 1;
  });
  const config = enabledConfig();
  const subA = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@chanA', format: 'video' });
  await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@chanB', format: 'video' });
  await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@chanC', format: 'video' });

  run.probeChannelFollowerCount = async (channelUrl) => {
    if (channelUrl === subA.channelUrl) throw new Error('boom -- simulated probe failure');
    return { followerCount: 42, channelId: null, channelUrl: null };
  };

  const { base, close } = await startTestApp(deps, config);
  try {
    await fetch(`${base}/api/ytdlp/reheat-sub-counts`, { method: 'POST' });
    await flush(30);

    const entry = getReheatSubsEntry();
    assert.equal(entry.failed, 2, 'the probe throw AND the fan-out throw must each count failed');
    assert.equal(entry.done, 1);
    assert.equal(entry.state, 'done');
  } finally {
    await close();
  }
});

// ---- Serialization: shares the global runExclusive FIFO gate ---------------

test('reheat-subs probes are serialized: never run concurrently with a stubbed subscription poll download (shared runExclusive gate)', async () => {
  const deps = makeFakeDeps();
  const config = enabledConfig();
  await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@chanA', format: 'video' });

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
  run.probeChannelFollowerCount = async () => {
    await enter();
    return { followerCount: 42, channelId: null, channelUrl: null };
  };

  const { base, close } = await startTestApp(deps, config);
  try {
    const reheatPromise = fetch(`${base}/api/ytdlp/reheat-sub-counts`, { method: 'POST' });
    const pollPromise = ytdlp.runPoll(deps, config);
    await reheatPromise;
    await pollPromise;
    await flush(120);

    assert.equal(overlapDetected, false, 'the follower-count probe spawn and the poll download spawn must never overlap');
  } finally {
    await close();
  }
});

test('within one batch, channels are strictly sequential (channel N+1 never starts before channel N settles)', async () => {
  const deps = makeFakeDeps();
  const config = enabledConfig();
  const subA = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@chanA', format: 'video' });
  const subB = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@chanB', format: 'video' });
  const subC = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@chanC', format: 'video' });

  let active = 0;
  let overlapDetected = false;
  const order = [];
  run.probeChannelFollowerCount = async (channelUrl) => {
    active += 1;
    if (active > 1) overlapDetected = true;
    order.push(channelUrl);
    await flush(10);
    active -= 1;
    return { followerCount: 42, channelId: null, channelUrl: null };
  };

  const { base, close } = await startTestApp(deps, config);
  try {
    await fetch(`${base}/api/ytdlp/reheat-sub-counts`, { method: 'POST' });
    await flush(60);

    assert.equal(overlapDetected, false);
    assert.deepEqual(order, [subA.channelUrl, subB.channelUrl, subC.channelUrl]);
  } finally {
    await close();
  }
});

// ---- Concurrency guard: single-flight --------------------------------------

test('a second POST while a batch is already running is rejected (409, alreadyRunning) -- never starts a second batch', async () => {
  const deps = makeFakeDeps();
  const config = enabledConfig();
  await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@chanA', format: 'video' });

  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  let probeCallCount = 0;
  run.probeChannelFollowerCount = async () => {
    probeCallCount += 1;
    await firstGate;
    return { followerCount: 42, channelId: null, channelUrl: null };
  };

  const { base, close } = await startTestApp(deps, config);
  try {
    const res1 = await fetch(`${base}/api/ytdlp/reheat-sub-counts`, { method: 'POST' });
    assert.equal(res1.status, 202);
    await flush(15);

    const res2 = await fetch(`${base}/api/ytdlp/reheat-sub-counts`, { method: 'POST' });
    assert.equal(res2.status, 409);
    assert.deepEqual(await res2.json(), { started: false, alreadyRunning: true });

    releaseFirst();
    await flush(30);
    assert.equal(probeCallCount, 1, 'only ONE batch should ever have run');
  } finally {
    await close();
  }
});

// ---- Cancel ----------------------------------------------------------------

test('cancel sets the durable latch and stops the batch cleanly between items; terminal (cancelled); a fresh batch can start after', async () => {
  const deps = makeFakeDeps();
  const config = enabledConfig();
  const subA = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@chanA', format: 'video' });
  await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@chanB', format: 'video' });
  await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@chanC', format: 'video' });

  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const probeCalls = [];
  run.probeChannelFollowerCount = async (channelUrl) => {
    probeCalls.push(channelUrl);
    if (channelUrl === subA.channelUrl) await firstGate;
    return { followerCount: 42, channelId: null, channelUrl: null };
  };

  const { base, close } = await startTestApp(deps, config);
  try {
    const res = await fetch(`${base}/api/ytdlp/reheat-sub-counts`, { method: 'POST' });
    assert.equal(res.status, 202);
    await flush(15); // channel A is now in-flight, blocked on firstGate

    const cancelRes = await fetch(`${base}/api/ytdlp/reheat-sub-counts/cancel`, { method: 'POST' });
    assert.equal(cancelRes.status, 200);
    assert.deepEqual(await cancelRes.json(), { cancelled: true });

    releaseFirst(); // channel A (already in-flight) finishes normally
    await flush(30);

    assert.deepEqual(probeCalls, [subA.channelUrl], 'channels B and C must never be probed once cancelled');
    assert.equal(deps.fanoutCalls.length, 1, 'the in-flight item still completes (probe + fan-out); only the NEXT item is skipped');

    const entry = getReheatSubsEntry();
    assert.equal(entry.state, 'cancelled');

    const res2 = await fetch(`${base}/api/ytdlp/reheat-sub-counts`, { method: 'POST' });
    assert.equal(res2.status, 202, 'the single-flight guard must be released after a cancel');
  } finally {
    await close();
  }
});

test('cancel is an idempotent no-op ({cancelled:false}) when no batch is currently running', async () => {
  const deps = makeFakeDeps();
  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    const res = await fetch(`${base}/api/ytdlp/reheat-sub-counts/cancel`, { method: 'POST' });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { cancelled: false });
  } finally {
    await close();
  }
});

// ---- Activity progress entry ----------------------------------------------

test('activity progress entry is created (kind reheat-subs), advances, and goes terminal (done)', async () => {
  const deps = makeFakeDeps();
  const config = enabledConfig();
  const subA = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@chanA', format: 'video' });
  await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@chanB', format: 'video' });

  assert.equal(getReheatSubsEntry(), undefined, 'no entry should exist before the route is ever hit');

  let releaseA;
  const gateA = new Promise((resolve) => { releaseA = resolve; });
  run.probeChannelFollowerCount = async (channelUrl) => {
    if (channelUrl === subA.channelUrl) await gateA;
    return { followerCount: 42, channelId: null, channelUrl: null };
  };

  const { base, close } = await startTestApp(deps, config);
  try {
    await fetch(`${base}/api/ytdlp/reheat-sub-counts`, { method: 'POST' });
    await flush(15);

    const midEntry = getReheatSubsEntry();
    assert.ok(midEntry, 'an activity entry must exist once the batch has started');
    assert.equal(midEntry.kind, 'reheat-subs');
    assert.equal(midEntry.total, 2);
    assert.equal(midEntry.done, 0);
    assert.equal(midEntry.current, subA.channelUrl, 'current is the channelId || channelUrl || subId label');
    assert.notEqual(midEntry.state, 'done');

    releaseA();
    await flush(30);

    const finalEntry = getReheatSubsEntry();
    assert.equal(finalEntry.state, 'done');
    assert.equal(finalEntry.done, 2);
    assert.equal(finalEntry.failed, 0);
    assert.equal(finalEntry.skipped, 0);
  } finally {
    await close();
  }
});

// ---- No auto-run (thumbnail-backfill-regression lesson) --------------------

test('structural lock: runReheatSubsBatch is never invoked from any boot/scan/poll/timer path -- POST /api/ytdlp/reheat-sub-counts is the ONLY trigger', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../lib/ytdlp/index.js'), 'utf8');

  const callSites = src.match(/(?<!function )runReheatSubsBatch\(/g) || [];
  assert.equal(callSites.length, 1, 'runReheatSubsBatch must be called from exactly one place (the POST /api/ytdlp/reheat-sub-counts route handler)');

  // Same paren/brace depth-counting extraction as the refresh-avatars
  // structural guard (see that test for the rationale).
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
    assert.ok(!body.includes('runReheatSubsBatch'), `${fnName} must never call runReheatSubsBatch (no auto-run)`);
    assert.ok(!body.includes('reheatSubsInProgress = true'), `${fnName} must never flip the reheat-subs in-progress latch (no auto-run)`);
  }
});
