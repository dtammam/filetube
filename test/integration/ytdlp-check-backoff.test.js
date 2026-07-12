'use strict';

// [INTEGRATION] v1.36 F2/F3: the per-channel check-failure backoff through
// the REAL runPoll/processSubscription/store write path, and the F3
// scheduled-tick-yields-to-an-armed-breaker-resume guard. Same harness
// posture as ytdlp-hardening.test.js: `run.*` monkey-patched on the module
// object, in-memory fake deps, NO real yt-dlp/network ever.
//
// Production shape this locks (Dean's 2026-07-12 logs): four chronically
// slow channels at positions 1-4 of a 181-sub list fed the breaker 4 fresh
// failures every scheduled poll (no failure cooldown existed), tripped it
// ~20 minutes in, and each new trip REPLACED the armed resume -- so the
// deep tail never ran. F2 removes the burners from subsequent automatic
// walks while they cool; F3 stops the scheduled poll from steamrolling an
// armed resume at all.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');

const ytdlp = require('../../lib/ytdlp');
const run = require('../../lib/ytdlp/run');
const store = require('../../lib/ytdlp/store');
const activity = require('../../lib/ytdlp/activity');

const originalRunList = run.runList;
const originalRunDownload = run.runDownload;
const originalProbeChannel = run.probeChannel;

let tmpDir;
let dataDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-backoff-'));
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-backoff-data-'));
  activity.resetForTests();
});

afterEach(() => {
  run.runList = originalRunList;
  run.runDownload = originalRunDownload;
  run.probeChannel = originalProbeChannel;
  activity.resetForTests();
  ytdlp.resetPollRerunStateForTests(); // also clears breaker state/timer
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function makeFakeDeps(initialDb = {}) {
  let db = initialDb;
  return {
    dataDir,
    loadDatabase: () => db,
    updateDatabase: (mutatorFn) => Promise.resolve(mutatorFn(db)),
    scanDirectories: async () => {},
    getMediaId: (input) => crypto.createHash('md5').update(input).digest('hex'),
  };
}

function baseConfig(overrides = {}) {
  return {
    enabled: true,
    cookiesFile: null,
    pollMinutes: 0,
    downloadDir: tmpDir,
    version: null,
    ...overrides,
  };
}

async function addSub(deps, channelUrl) {
  return store.addSubscription(deps, { channelUrl, format: 'video', quality: 'best' });
}

const failList = async () => ({ ok: false, code: 'ETIMEDOUT', stdout: '', stderr: '', error: 'yt-dlp list pass timed out after 5.1m and was killed' });
const emptyOkList = async () => ({ ok: true, stdout: '', stderr: '' });

function getSub(deps, id) {
  return store.listSubscriptions(deps).find((s) => s.id === id);
}

// ---- F2: failure persists the backoff pair; success clears it --------------

test('v1.36 F2: a check failure persists checkFailures=1 + a ~30m backoffUntil in the SAME status write; a second consecutive failure doubles the window', async () => {
  const deps = makeFakeDeps();
  const sub = await addSub(deps, 'https://www.youtube.com/@burner');
  run.runList = failList;

  const before = Date.now();
  await ytdlp.runPoll(deps, baseConfig(), sub.id); // explicit repull (bypasses any gate) -- exercises the write path
  let persisted = getSub(deps, sub.id);
  assert.equal(persisted.checkFailures, 1);
  const until1 = Date.parse(persisted.backoffUntil);
  assert.ok(until1 >= before + 29 * 60 * 1000 && until1 <= Date.now() + 31 * 60 * 1000, 'first failure -> ~30 minutes');
  assert.match(persisted.lastStatus, /error/, 'lastStatus still records the real failure alongside the backoff fields');

  await ytdlp.runPoll(deps, baseConfig(), sub.id);
  persisted = getSub(deps, sub.id);
  assert.equal(persisted.checkFailures, 2);
  const until2 = Date.parse(persisted.backoffUntil);
  assert.ok(until2 >= before + 59 * 60 * 1000, 'second consecutive failure -> ~60 minutes (exponential)');
});

test('v1.36 F2: a success RESETS the pair (checkFailures 0, backoffUntil null) -- the channel is immediately eligible again', async () => {
  const deps = makeFakeDeps();
  const sub = await addSub(deps, 'https://www.youtube.com/@recovers');
  run.runList = failList;
  await ytdlp.runPoll(deps, baseConfig(), sub.id);
  assert.equal(getSub(deps, sub.id).checkFailures, 1);

  run.runList = emptyOkList; // quick "nothing new" success
  await ytdlp.runPoll(deps, baseConfig(), sub.id);
  const persisted = getSub(deps, sub.id);
  assert.equal(persisted.checkFailures, 0);
  assert.equal(persisted.backoffUntil, null);
  assert.equal(ytdlp.isInCheckBackoff(persisted, Date.now()), false);
});

// ---- F2: the automatic paths skip a cooling channel -------------------------

test('v1.36 F2: a scheduled FULL poll skips channels inside their backoff window -- the healthy rest of the list still runs (the anti-starvation core)', async () => {
  const deps = makeFakeDeps();
  const burner = await addSub(deps, 'https://www.youtube.com/@burner');
  const healthy1 = await addSub(deps, 'https://www.youtube.com/@healthy1');
  const healthy2 = await addSub(deps, 'https://www.youtube.com/@healthy2');

  const listed = [];
  run.runList = async (sub) => {
    listed.push(sub.id);
    return sub.id === burner.id ? failList() : emptyOkList();
  };

  // Round 1: full poll -- the burner (walk-order head) fails and starts cooling.
  await ytdlp.runPoll(deps, baseConfig());
  assert.deepEqual(listed, [burner.id, healthy1.id, healthy2.id], 'round 1 walks everyone');
  assert.ok(getSub(deps, burner.id).backoffUntil, 'the burner is now cooling');

  // Round 2: the burner is skipped OUTRIGHT; the healthy tail still runs.
  listed.length = 0;
  await ytdlp.runPoll(deps, baseConfig());
  assert.deepEqual(listed, [healthy1.id, healthy2.id], 'round 2 must not touch the cooling burner');
  assert.equal(getSub(deps, burner.id).checkFailures, 1, 'a skipped channel accrues NO additional failures');

  // Round 3: window expired -> eligible again.
  await store.setSubscriptionStatus(deps, burner.id, { backoffUntil: new Date(Date.now() - 1000).toISOString() });
  listed.length = 0;
  await ytdlp.runPoll(deps, baseConfig());
  assert.deepEqual(listed, [burner.id, healthy1.id, healthy2.id], 'an expired window restores normal eligibility');
});

test('v1.36 F2: a skipped-for-backoff channel never feeds the breaker -- consecutive failures at the head no longer trip it on the NEXT run', async () => {
  const deps = makeFakeDeps();
  const subs = [];
  for (let i = 0; i < 4; i++) subs.push(await addSub(deps, `https://www.youtube.com/@chronic${i}`));
  const tail = await addSub(deps, 'https://www.youtube.com/@tailhealthy');

  run.runList = async (sub) => (sub.id === tail.id ? emptyOkList() : failList());
  const config = baseConfig({ breakerFailures: 4, breakerBackoffMinutes: 30 });

  // Run 1: the four chronic heads trip the breaker; the tail is deferred.
  await ytdlp.runPoll(deps, config);
  assert.ok(ytdlp.getPollBreakerState(), 'run 1 trips (pre-F2 shape)');
  ytdlp.resetPollRerunStateForTests(); // stand in for the resume having run/cleared

  // Run 2 (next scheduled full poll): all four burners are cooling -> only
  // the tail runs, nothing fails, NO new trip. Pre-F2 this run re-tripped
  // on the same four channels every time.
  const listed = [];
  run.runList = async (sub) => {
    listed.push(sub.id);
    return sub.id === tail.id ? emptyOkList() : failList();
  };
  await ytdlp.runPoll(deps, config);
  assert.deepEqual(listed, [tail.id], 'only the healthy tail runs while the burners cool');
  assert.equal(ytdlp.getPollBreakerState(), null, 'no failures reached the breaker');
});

test("v1.36 F2: the breaker's own deferred-tail resume (array runPoll) ALSO honors backoff -- a deferred channel cooling from an earlier cycle is not hammered", async () => {
  const deps = makeFakeDeps();
  const cooling = await addSub(deps, 'https://www.youtube.com/@coolingdown');
  const fresh = await addSub(deps, 'https://www.youtube.com/@fresh');
  await store.setSubscriptionStatus(deps, cooling.id, {
    checkFailures: 2,
    backoffUntil: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  });

  const listed = [];
  run.runList = async (sub) => { listed.push(sub.id); return emptyOkList(); };
  await ytdlp.runPoll(deps, baseConfig(), [cooling.id, fresh.id]);
  assert.deepEqual(listed, [fresh.id], 'the array/resume path must filter cooling channels exactly like the full walk');
});

test('v1.36 F2: an EXPLICIT single-channel repull bypasses backoff (deliberate user action, FR-D posture) -- and its success clears the pair', async () => {
  const deps = makeFakeDeps();
  const sub = await addSub(deps, 'https://www.youtube.com/@userinsists');
  await store.setSubscriptionStatus(deps, sub.id, {
    checkFailures: 3,
    backoffUntil: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
  });

  let ran = false;
  run.runList = async () => { ran = true; return emptyOkList(); };
  const result = await ytdlp.runPoll(deps, baseConfig(), sub.id);
  assert.equal(result.started, true, 'the explicit repull must run despite the backoff window');
  assert.equal(ran, true);
  const persisted = getSub(deps, sub.id);
  assert.equal(persisted.checkFailures, 0);
  assert.equal(persisted.backoffUntil, null);
});

// (The `'cancelled'`-leaves-both-fields-untouched rule is locked at the unit
// level -- test/unit/ytdlp-backoff.test.js -- where the empty-patch contract
// is directly observable; the integration wiring passes `result.outcome`
// into the same computeCheckBackoff call these tests exercise via
// error/success, so there is no distinct integration path to cover.)

// ---- F2: API surfaces --------------------------------------------------------

test('v1.36 F2: GET /api/subscriptions/status folds a FUTURE backoffUntil into nextPollDue (the "next check ~" estimate stays honest)', async () => {
  const express = require('express');
  const deps = makeFakeDeps();
  const sub = await addSub(deps, 'https://www.youtube.com/@cooling');
  const lastCheckedAt = new Date().toISOString();
  const backoffUntil = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
  await store.setSubscriptionStatus(deps, sub.id, { lastCheckedAt, checkFailures: 3, backoffUntil });

  const app = express();
  app.use(express.json());
  ytdlp.registerRoutes(app, deps, baseConfig({ pollMinutes: 60 }));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const snap = await (await fetch(`http://127.0.0.1:${server.address().port}/api/subscriptions/status`)).json();
    const entry = snap.subscriptions[sub.id];
    assert.equal(entry.nextPollDue, Date.parse(backoffUntil), 'the backoff window (later than lastChecked+interval) must win');
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
});

// ---- F3: the scheduled tick yields to an armed breaker resume ----------------

test('v1.36 F3: scheduledPollTick SKIPS while a breaker resume timer is armed -- and runs normally once the breaker is cleared', async () => {
  const deps = makeFakeDeps();
  const a = await addSub(deps, 'https://www.youtube.com/@t1');
  const b = await addSub(deps, 'https://www.youtube.com/@t2');
  const c = await addSub(deps, 'https://www.youtube.com/@t3');
  assert.ok(a && b && c);

  run.runList = failList;
  const config = baseConfig({ breakerFailures: 2, breakerBackoffMinutes: 30 });
  await ytdlp.runPoll(deps, config);
  assert.ok(ytdlp.getPollBreakerState(), 'precondition: breaker tripped, resume armed');

  // The scheduled tick lands while the resume is armed: it must NOT start a
  // poll (pre-F3 it restarted the full walk and REPLACED the armed resume).
  let listCalls = 0;
  run.runList = async () => { listCalls += 1; return emptyOkList(); };
  ytdlp.scheduledPollTick(deps, config);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(listCalls, 0, 'an armed resume owns recovery -- the tick must yield');
  assert.ok(ytdlp.getPollBreakerState(), 'the breaker state/resume must survive the tick untouched');

  // Breaker cleared (resume completed) -> the next tick polls normally.
  ytdlp.resetPollRerunStateForTests();
  ytdlp.scheduledPollTick(deps, config);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.ok(listCalls > 0, 'with no breaker armed, the tick runs a normal full poll');
});
