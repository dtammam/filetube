'use strict';

// [INTEGRATION] v1.31 yt-dlp hardening -- the P1 queue decomposition
// (per-channel gate jobs; a one-shot interleaves between channels), the P2
// circuit breaker (consecutive-failure trip + honest state + backoff
// retry), the P4 durable pending-one-shot store (restart requeue), and the
// P5 status-snapshot enrichment (queuedAhead / breaker / ytdlpVersion).
// Same harness posture as ytdlp-poll.test.js: `run.*` monkey-patched on the
// module object, in-memory fake deps, NO real yt-dlp/network ever.

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
const runlog = require('../../lib/ytdlp/runlog');
const pending = require('../../lib/ytdlp/pending');

const originalRunList = run.runList;
const originalRunDownload = run.runDownload;
const originalProbeChannel = run.probeChannel;

let tmpDir;
let dataDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-hard-'));
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-hard-data-'));
  activity.resetForTests();
});

afterEach(() => {
  run.runList = originalRunList;
  run.runDownload = originalRunDownload;
  run.probeChannel = originalProbeChannel;
  activity.resetForTests();
  ytdlp.resetPollRerunStateForTests(); // also clears the v1.31 breaker state/timer
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function makeFakeDeps(initialDb = {}) {
  let db = initialDb;
  return {
    dataDir,
    loadDatabase: () => db,
    updateDatabase: (mutatorFn) => {
      const result = mutatorFn(db);
      return Promise.resolve(result);
    },
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

async function addSub(deps, overrides = {}) {
  return store.addSubscription(deps, {
    channelUrl: 'https://www.youtube.com/@somechannel',
    format: 'video',
    quality: 'best',
    ...overrides,
  });
}

function ndjson(videos) {
  return videos.map((v) => JSON.stringify(v)).join('\n');
}

// A deferred you can resolve from the test body.
function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

// ---- P1: per-channel gate jobs -- a one-shot interleaves mid-poll ----------

test('P1: a one-shot submitted while channel 1 of a 3-channel poll is downloading starts BEFORE channel 2 (<=1 channel wait, AC3.x)', async () => {
  const deps = makeFakeDeps();
  await addSub(deps, { channelUrl: 'https://www.youtube.com/@ch1' });
  await addSub(deps, { channelUrl: 'https://www.youtube.com/@ch2' });
  await addSub(deps, { channelUrl: 'https://www.youtube.com/@ch3' });

  const order = [];
  const ch1Gate = deferred();
  let oneShotLaunched = false;
  let listCall = 0;

  run.runList = async (sub) => {
    listCall += 1;
    order.push(`list:${sub.channelUrl}`);
    // Channel 1's list pass blocks until the test has submitted the
    // one-shot -- guaranteeing the one-shot is enqueued while channel 1's
    // gate job is still running.
    if (listCall === 1) await ch1Gate.promise;
    return { ok: true, stdout: ndjson([{ id: `vid${listCall}`, availability: 'public' }]), stderr: '' };
  };
  run.runDownload = async (sub) => {
    order.push(`download:${sub.channelUrl || sub.name || 'oneshot'}`);
    return { ok: true, code: 0, stdout: '', stderr: '', channelMeta: [], itemFailures: [] };
  };
  // The one-shot's folder probe (unlocked, outside the gate).
  run.probeChannel = async () => null;

  const config = baseConfig();
  const pollPromise = ytdlp.runPoll(deps, config);

  // Give the poll a beat to enter channel 1's blocked list pass, then
  // submit the one-shot via the SAME launch chain the HTTP route uses.
  await new Promise((r) => setTimeout(r, 20));
  const jobId = crypto.randomUUID();
  activity.setOneShot(jobId, { state: 'queued', url: 'https://www.youtube.com/watch?v=oneshot1234', format: 'video', quality: 'best', filetype: null });
  const oneShotPromise = ytdlp.launchOneShotJob(deps, config, {
    jobId,
    videoId: 'oneshot1234',
    watchUrl: 'https://www.youtube.com/watch?v=oneshot1234',
    format: 'video',
    quality: 'best',
    filetype: null,
    explicitFolder: 'One-Off',
  }).then(() => { oneShotLaunched = true; });

  await new Promise((r) => setTimeout(r, 20));
  ch1Gate.resolve(); // channel 1 finishes; the FIFO decides what runs next
  await Promise.all([pollPromise, oneShotPromise]);

  const oneShotIdx = order.findIndex((e) => e.includes('oneshot') || e === 'download:One-Off');
  const ch2Idx = order.findIndex((e) => e === 'list:https://www.youtube.com/@ch2');
  assert.ok(oneShotLaunched, 'the one-shot must have completed');
  assert.ok(oneShotIdx !== -1, `one-shot download must appear in the order (got: ${JSON.stringify(order)})`);
  assert.ok(ch2Idx !== -1, 'channel 2 must still run');
  assert.ok(
    oneShotIdx < ch2Idx,
    `the one-shot must run BEFORE channel 2 (pre-v1.31 it waited for the whole poll): ${JSON.stringify(order)}`,
  );
});

test('P1 invariant (AC-INV): spawns stay strictly serial through the decomposed queue -- never two concurrent run.* calls', async () => {
  const deps = makeFakeDeps();
  await addSub(deps, { channelUrl: 'https://www.youtube.com/@ch1' });
  await addSub(deps, { channelUrl: 'https://www.youtube.com/@ch2' });
  await addSub(deps, { channelUrl: 'https://www.youtube.com/@ch3' });

  let active = 0;
  let maxActive = 0;
  async function tracked(fn) {
    active += 1;
    maxActive = Math.max(maxActive, active);
    // A real async gap so overlap WOULD be observed if the gate ever let two
    // jobs run concurrently.
    await new Promise((r) => setTimeout(r, 5));
    active -= 1;
    return fn();
  }
  run.runList = (sub) => tracked(() => ({ ok: true, stdout: ndjson([{ id: `v-${sub.id}`, availability: 'public' }]), stderr: '' }));
  run.runDownload = () => tracked(() => ({ ok: true, code: 0, stdout: '', stderr: '', channelMeta: [], itemFailures: [] }));
  run.probeChannel = async () => null;

  const config = baseConfig();
  const jobId = crypto.randomUUID();
  activity.setOneShot(jobId, { state: 'queued', url: 'https://www.youtube.com/watch?v=oneshotABCD', format: 'video', quality: 'best', filetype: null });
  await Promise.all([
    ytdlp.runPoll(deps, config),
    ytdlp.launchOneShotJob(deps, config, {
      jobId,
      videoId: 'oneshotABCD',
      watchUrl: 'https://www.youtube.com/watch?v=oneshotABCD',
      format: 'video',
      quality: 'best',
      filetype: null,
      explicitFolder: 'One-Off',
    }),
  ]);
  assert.equal(maxActive, 1, 'the gate must never let two spawn-layer calls overlap');
});

// ---- P2: the circuit breaker -----------------------------------------------

test('P2: N consecutive channel failures trip the breaker -- remaining channels skipped, honest state + runlog line, backoff timer armed (AC1.x)', async () => {
  const deps = makeFakeDeps();
  const subs = [];
  for (let i = 1; i <= 6; i++) {
    subs.push(await addSub(deps, { channelUrl: `https://www.youtube.com/@ch${i}` }));
  }

  let listCalls = 0;
  run.runList = async () => {
    listCalls += 1;
    return { ok: false, code: 'ETIMEDOUT', stdout: '', stderr: '', error: 'yt-dlp list pass timed out after 5m and was killed' };
  };
  run.runDownload = async () => {
    throw new Error('download must never run when every list pass fails');
  };

  const config = baseConfig({ breakerFailures: 3, breakerBackoffMinutes: 30 });
  await ytdlp.runPoll(deps, config);

  assert.equal(listCalls, 3, 'exactly breakerFailures channels run before the trip -- the remaining 3 are never hammered');

  const state = ytdlp.getPollBreakerState();
  assert.ok(state, 'breaker state must be set after a trip');
  assert.equal(state.consecutiveFailures, 3);
  assert.equal(state.skipped, 3);
  assert.ok(typeof state.resumeAt === 'string' && !Number.isNaN(Date.parse(state.resumeAt)), 'resumeAt must be a valid ISO timestamp');

  // The skipped channels' live 'queued' entries were cleared (no stuck rows).
  const snapshot = activity.getSnapshot();
  for (const sub of subs.slice(3)) {
    assert.equal(snapshot.subscriptions[sub.id], undefined, `skipped ${sub.id} must not linger 'queued'`);
  }

  // Durable trip record in the runlog.
  const lines = runlog.readRuns(dataDir);
  const trip = lines.find((l) => l.kind === 'breaker');
  assert.ok(trip, 'a breaker runlog line must exist');
  assert.equal(trip.outcome, 'tripped');
  assert.match(trip.reason, /run paused after 3 consecutive failures; 3 channel\(s\) deferred; retrying at /);
});

test('P2 converse (AC-INV both-directions): successes RESET the counter -- no trip when failures never run consecutively', async () => {
  const deps = makeFakeDeps();
  for (let i = 1; i <= 6; i++) {
    await addSub(deps, { channelUrl: `https://www.youtube.com/@alt${i}` });
  }
  let call = 0;
  run.runList = async () => {
    call += 1;
    // fail, fail, SUCCEED (resets), fail, fail, SUCCEED -- never 3 in a row.
    if (call % 3 === 0) return { ok: true, stdout: '', stderr: '' }; // no videos -> success outcome
    return { ok: false, code: 1, stdout: '', stderr: '', error: 'boom' };
  };
  run.runDownload = async () => ({ ok: true, code: 0, stdout: '', stderr: '', channelMeta: [], itemFailures: [] });

  const config = baseConfig({ breakerFailures: 3, breakerBackoffMinutes: 30 });
  await ytdlp.runPoll(deps, config);

  assert.equal(call, 6, 'every channel must run -- the breaker must NOT trip');
  assert.equal(ytdlp.getPollBreakerState(), null, 'no trip -> no breaker state');
});

test('P2: breakerFailures=0 disables the breaker entirely (pre-v1.31 plow-through)', async () => {
  const deps = makeFakeDeps();
  for (let i = 1; i <= 5; i++) {
    await addSub(deps, { channelUrl: `https://www.youtube.com/@off${i}` });
  }
  let call = 0;
  run.runList = async () => {
    call += 1;
    return { ok: false, code: 1, stdout: '', stderr: '', error: 'boom' };
  };
  run.runDownload = async () => ({ ok: true, code: 0, stdout: '', stderr: '', channelMeta: [], itemFailures: [] });

  await ytdlp.runPoll(deps, baseConfig({ breakerFailures: 0 }));
  assert.equal(call, 5, 'with the breaker off, every channel still runs');
  assert.equal(ytdlp.getPollBreakerState(), null);
});

// ---- P4: durable pending one-shots ------------------------------------------

test('P4: pending store round-trip -- add is idempotent per jobId, remove clears, corrupt file degrades to []', () => {
  pending.addPending(dataDir, { jobId: 'job-1', url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', createdAt: 'x' });
  pending.addPending(dataDir, { jobId: 'job-2', url: 'https://www.youtube.com/watch?v=bbbbbbbbbbb', createdAt: 'y' });
  pending.addPending(dataDir, { jobId: 'job-1', url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', createdAt: 'z' });
  const entries = pending.readPending(dataDir);
  assert.equal(entries.length, 2, 'duplicate add replaces, never duplicates');
  assert.equal(entries.find((e) => e.jobId === 'job-1').createdAt, 'z');

  pending.removePending(dataDir, 'job-1');
  assert.deepEqual(pending.readPending(dataDir).map((e) => e.jobId), ['job-2']);

  fs.writeFileSync(path.join(dataDir, pending.PENDING_FILENAME), '{corrupt', 'utf8');
  assert.deepEqual(pending.readPending(dataDir), [], 'corrupt file degrades to empty, never throws');
});

test('P4: requeuePendingOneShots requeues a valid survivor (activity + runlog "requeued" + runs it) and drops an invalid one WITH a runlog line', async () => {
  const validJobId = crypto.randomUUID();
  const invalidJobId = crypto.randomUUID();
  pending.addPending(dataDir, {
    jobId: validJobId,
    url: 'https://www.youtube.com/watch?v=survivor123',
    videoId: 'survivor123',
    format: 'video',
    quality: 'best',
    filetype: null,
    folder: 'One-Off',
    createdAt: new Date().toISOString(),
  });
  pending.addPending(dataDir, {
    jobId: invalidJobId,
    url: 'not a url at all',
    createdAt: new Date().toISOString(),
  });

  const deps = makeFakeDeps();
  let downloaded = null;
  run.probeChannel = async () => null;
  run.runDownload = async (sub, _config, targetIds) => {
    downloaded = targetIds;
    return { ok: true, code: 0, stdout: '', stderr: '', channelMeta: [], itemFailures: [] };
  };

  ytdlp.requeuePendingOneShots(deps, baseConfig());
  // The valid survivor's chain is fire-and-forget -- give it a beat.
  await new Promise((r) => setTimeout(r, 50));

  assert.deepEqual(downloaded, ['survivor123'], 'the valid survivor must actually download');

  const lines = runlog.readRuns(dataDir);
  const requeued = lines.find((l) => l.outcome === 'requeued' && l.id === validJobId);
  assert.ok(requeued, 'the survivor must get a runlog "requeued" line');
  const dropped = lines.find((l) => l.outcome === 'dropped' && l.id === invalidJobId);
  assert.ok(dropped, 'the invalid entry must get a runlog "dropped" line -- never silent');

  const remaining = pending.readPending(dataDir).map((e) => e.jobId);
  assert.ok(!remaining.includes(invalidJobId), 'the dropped entry must leave the pending file');
  assert.ok(!remaining.includes(validJobId), 'the completed survivor must leave the pending file too');
});

test('P4: the HTTP-accepted one-shot path persists the job and clears it at its terminal fate', async () => {
  const deps = makeFakeDeps();
  run.probeChannel = async () => null;
  const downloadGate = deferred();
  run.runDownload = async () => {
    await downloadGate.promise;
    return { ok: true, code: 0, stdout: '', stderr: '', channelMeta: [], itemFailures: [] };
  };

  const jobId = crypto.randomUUID();
  pending.addPending(dataDir, { jobId, url: 'https://www.youtube.com/watch?v=persistedXY', createdAt: new Date().toISOString() });
  activity.setOneShot(jobId, { state: 'queued', url: 'https://www.youtube.com/watch?v=persistedXY', format: 'video', quality: 'best', filetype: null });
  const chain = ytdlp.launchOneShotJob(deps, baseConfig(), {
    jobId,
    videoId: 'persistedXY1',
    watchUrl: 'https://www.youtube.com/watch?v=persistedXY1',
    format: 'video',
    quality: 'best',
    filetype: null,
    explicitFolder: 'One-Off',
  });

  // Mid-flight: the pending entry must still exist (a restart NOW would requeue it).
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(pending.readPending(dataDir).some((e) => e.jobId === jobId), 'pending entry must survive until terminal');

  downloadGate.resolve();
  await chain;
  assert.ok(!pending.readPending(dataDir).some((e) => e.jobId === jobId), 'terminal fate must clear the pending entry');
});

// ---- P5: gate-queue snapshot ------------------------------------------------

test('P5: getGateQueueSnapshot reports queued jobs in FIFO order with kind/label/jobId metadata', async () => {
  const deps = makeFakeDeps();
  run.probeChannel = async () => null;
  const firstGate = deferred();
  let call = 0;
  run.runDownload = async () => {
    call += 1;
    if (call === 1) await firstGate.promise;
    return { ok: true, code: 0, stdout: '', stderr: '', channelMeta: [], itemFailures: [] };
  };

  const config = baseConfig();
  const jobA = crypto.randomUUID();
  const jobB = crypto.randomUUID();
  for (const [jobId, vid] of [[jobA, 'aaaaaaaaaa1'], [jobB, 'bbbbbbbbbb2']]) {
    activity.setOneShot(jobId, { state: 'queued', url: `https://www.youtube.com/watch?v=${vid}`, format: 'video', quality: 'best', filetype: null });
  }
  const chainA = ytdlp.launchOneShotJob(deps, config, {
    jobId: jobA, videoId: 'aaaaaaaaaa1', watchUrl: 'https://www.youtube.com/watch?v=aaaaaaaaaa1', format: 'video', quality: 'best', filetype: null, explicitFolder: 'One-Off',
  });
  await new Promise((r) => setTimeout(r, 20)); // A reaches the gate first
  const chainB = ytdlp.launchOneShotJob(deps, config, {
    jobId: jobB, videoId: 'bbbbbbbbbb2', watchUrl: 'https://www.youtube.com/watch?v=bbbbbbbbbb2', format: 'video', quality: 'best', filetype: null, explicitFolder: 'One-Off',
  });
  await new Promise((r) => setTimeout(r, 20));

  const queue = ytdlp.getGateQueueSnapshot();
  assert.equal(queue.length, 2, `A running + B queued (got ${JSON.stringify(queue)})`);
  assert.equal(queue[0].jobId, jobA);
  assert.equal(queue[0].kind, 'oneshot');
  assert.equal(queue[1].jobId, jobB);

  firstGate.resolve();
  await Promise.all([chainA, chainB]);
  assert.equal(ytdlp.getGateQueueSnapshot().length, 0, 'settled jobs leave the queue');
});

// ---- v1.31 gate-fix round ---------------------------------------------------

test('GATE FIX (adversarial CRITICAL): a single-subscription repull does NOT clear a tripped breaker or cancel its backoff retry', async () => {
  const deps = makeFakeDeps();
  const subs = [];
  for (let i = 1; i <= 4; i++) {
    subs.push(await addSub(deps, { channelUrl: `https://www.youtube.com/@bk${i}` }));
  }
  run.runList = async () => ({ ok: false, code: 1, stdout: '', stderr: '', error: 'boom' });
  run.runDownload = async () => ({ ok: true, code: 0, stdout: '', stderr: '', channelMeta: [], itemFailures: [] });

  const config = baseConfig({ breakerFailures: 2, breakerBackoffMinutes: 30 });
  await ytdlp.runPoll(deps, config);
  assert.ok(ytdlp.getPollBreakerState(), 'breaker must be tripped');

  // The bug: this targeted repull used to wipe the state + timer.
  run.runList = async () => ({ ok: true, stdout: '', stderr: '' });
  await ytdlp.runPoll(deps, config, subs[0].id);
  assert.ok(ytdlp.getPollBreakerState(), 'a single-channel repull must leave the tripped breaker (and its retry) intact');

  // Converse: a FULL untripped poll DOES clear it.
  await ytdlp.runPoll(deps, config);
  assert.equal(ytdlp.getPollBreakerState(), null, 'a full clean poll clears the breaker');
});

test('GATE FIX (AC-INV-1b harness integrity): the serial-spawn detector genuinely catches overlap when the gate is bypassed', async () => {
  // The SAME max-active instrument the AC-INV-1a test uses -- run WITHOUT
  // the gate (direct Promise.all) to prove the instrument is sensitive to
  // the property it claims to verify (not a tautology).
  let active = 0;
  let maxActive = 0;
  async function tracked() {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((r) => setTimeout(r, 10));
    active -= 1;
  }
  await Promise.all([tracked(), tracked(), tracked()]);
  assert.ok(maxActive > 1, `bypassing the gate MUST register overlap (got maxActive=${maxActive}) -- proving the AC-INV-1a detector is real`);
});

test('GATE FIX (AC-INV-2b harness integrity): a rejecting gate job never wedges the tail -- the next job still runs', async () => {
  const deps = makeFakeDeps();
  run.probeChannel = async () => null;
  // Job 1: runOneShot's own internals never reject, so force a rejection at
  // the gate level via a launchOneShotJob whose folder probe is sabotaged to
  // throw synchronously inside the gate job (resolveOneOffFolder never
  // rejects in production -- this is the deliberate-regression double).
  run.runDownload = async () => { throw new Error('deliberate mid-job rejection'); };
  const jobId1 = crypto.randomUUID();
  activity.setOneShot(jobId1, { state: 'queued', url: 'https://www.youtube.com/watch?v=wedge111111', format: 'video', quality: 'best', filetype: null });
  await ytdlp.launchOneShotJob(deps, baseConfig(), {
    jobId: jobId1, videoId: 'wedge111111', watchUrl: 'https://www.youtube.com/watch?v=wedge111111', format: 'video', quality: 'best', filetype: null, explicitFolder: 'One-Off',
  });
  // Job 2 must still get its turn and complete.
  let secondRan = false;
  run.runDownload = async () => { secondRan = true; return { ok: true, code: 0, stdout: '', stderr: '', channelMeta: [], itemFailures: [] }; };
  const jobId2 = crypto.randomUUID();
  activity.setOneShot(jobId2, { state: 'queued', url: 'https://www.youtube.com/watch?v=after2222222'.slice(0, 43), format: 'video', quality: 'best', filetype: null });
  await ytdlp.launchOneShotJob(deps, baseConfig(), {
    jobId: jobId2, videoId: 'after222222', watchUrl: 'https://www.youtube.com/watch?v=after222222', format: 'video', quality: 'best', filetype: null, explicitFolder: 'One-Off',
  });
  assert.ok(secondRan, 'the tail must never wedge behind a failed job (never-wedge invariant, exercised through a REAL failure)');
  assert.equal(ytdlp.getGateQueueSnapshot().length, 0, 'both jobs must have left the queue');
});

test('GATE FIX (AC-INV-3 structural resolution): the queue can only ever contain the current channel + one-shots -- a repull during a poll COALESCES (never a competing queue entry), making the priority tiers structural', async () => {
  const deps = makeFakeDeps();
  await addSub(deps, { channelUrl: 'https://www.youtube.com/@pri1' });
  await addSub(deps, { channelUrl: 'https://www.youtube.com/@pri2' });

  const ch1Gate = deferred();
  let listCall = 0;
  let repullDecision = null;
  run.runList = async () => {
    listCall += 1;
    if (listCall === 1) await ch1Gate.promise;
    return { ok: true, stdout: '', stderr: '' };
  };
  run.runDownload = async () => ({ ok: true, code: 0, stdout: '', stderr: '', channelMeta: [], itemFailures: [] });

  const config = baseConfig();
  const pollPromise = ytdlp.runPoll(deps, config);
  await new Promise((r) => setTimeout(r, 20));

  // A repull arriving mid-poll: coalesces via pollBusy -- it never enqueues
  // a competing gate job, so "repull vs scheduled" priority is vacuous by
  // construction (there is only ever ONE poll's channels on the gate).
  await ytdlp.runPoll(deps, config, undefined, Date.now(), (d) => { repullDecision = d; });
  assert.deepEqual(repullDecision, { started: false, reason: 'busy' }, 'a mid-poll repull must coalesce, never compete');

  // And the gate itself holds at most the current channel job right now.
  const queue = ytdlp.getGateQueueSnapshot();
  assert.equal(queue.length, 1, `only the current channel job may be on the gate (got ${JSON.stringify(queue)})`);
  assert.equal(queue[0].kind, 'channel');

  ch1Gate.resolve();
  await pollPromise;
  // Drain the coalesced follow-up poll's unref'd timer before the next test.
  await new Promise((r) => setTimeout(r, 30));
});

test('GATE FIX (FR3.9): queued subscriptions in a multi-channel poll carry queuedAhead positions', async () => {
  const deps = makeFakeDeps();
  await addSub(deps, { channelUrl: 'https://www.youtube.com/@qa1' });
  await addSub(deps, { channelUrl: 'https://www.youtube.com/@qa2' });
  const sub3 = await addSub(deps, { channelUrl: 'https://www.youtube.com/@qa3' });

  const ch1Gate = deferred();
  let listCall = 0;
  let observedAhead = null;
  run.runList = async () => {
    listCall += 1;
    if (listCall === 1) {
      // While channel 1 runs, channel 3 must show 2 ahead (ch1 running + ch2 waiting).
      const snap = activity.getSnapshot();
      observedAhead = snap.subscriptions[sub3.id] && snap.subscriptions[sub3.id].queuedAhead;
      ch1Gate.resolve();
    }
    return { ok: true, stdout: '', stderr: '' };
  };
  run.runDownload = async () => ({ ok: true, code: 0, stdout: '', stderr: '', channelMeta: [], itemFailures: [] });

  await ytdlp.runPoll(deps, baseConfig());
  assert.equal(observedAhead, 2, 'channel 3 must report 2 jobs ahead while channel 1 runs');
});

// ---- v1.32 --------------------------------------------------------------

test('v1.32: the breaker backoff retry targets EXACTLY the deferred channels (array runPoll), not the full list from the top', async () => {
  const deps = makeFakeDeps();
  const subs = [];
  for (let i = 1; i <= 5; i++) {
    subs.push(await addSub(deps, { channelUrl: `https://www.youtube.com/@rs${i}` }));
  }
  const listCalls = [];
  run.runList = async (sub) => {
    listCalls.push(sub.channelUrl);
    return { ok: false, code: 1, stdout: '', stderr: '', error: 'boom' };
  };
  run.runDownload = async () => ({ ok: true, code: 0, stdout: '', stderr: '', channelMeta: [], itemFailures: [] });

  const config = baseConfig({ breakerFailures: 2, breakerBackoffMinutes: 30 });
  await ytdlp.runPoll(deps, config);
  assert.equal(listCalls.length, 2, 'trip after 2');
  const state = ytdlp.getPollBreakerState();
  assert.equal(state.skipped, 3);

  // Simulate the resume directly with the deferred-id array (the timer's
  // own callback shape). Channels succeed now.
  listCalls.length = 0;
  run.runList = async (sub) => {
    listCalls.push(sub.channelUrl);
    return { ok: true, stdout: '', stderr: '' };
  };
  const deferredIds = subs.slice(2).map((s) => s.id);
  await ytdlp.runPoll(deps, config, deferredIds);
  assert.deepEqual(
    listCalls,
    ['https://www.youtube.com/@rs3', 'https://www.youtube.com/@rs4', 'https://www.youtube.com/@rs5'],
    'the resume must run ONLY the deferred channels, in order -- never the chronic burners at the head',
  );
  assert.equal(ytdlp.getPollBreakerState(), null, 'a clean array-targeted resume clears the breaker');
});

test('v1.32: runPoll with an array of ids intersects against existing subscriptions (stale ids dropped; empty intersection = not-found)', async () => {
  const deps = makeFakeDeps();
  const sub = await addSub(deps, { channelUrl: 'https://www.youtube.com/@only1' });
  let calls = 0;
  run.runList = async () => { calls += 1; return { ok: true, stdout: '', stderr: '' }; };
  run.runDownload = async () => ({ ok: true, code: 0, stdout: '', stderr: '', channelMeta: [], itemFailures: [] });

  await ytdlp.runPoll(deps, baseConfig(), [sub.id, 'ghost-id-deleted-long-ago']);
  assert.equal(calls, 1, 'stale ids silently dropped, real one runs');

  const result = await ytdlp.runPoll(deps, baseConfig(), ['ghost-a', 'ghost-b']);
  assert.deepEqual(result, { started: false, reason: 'not-found' });
});

test('v1.32: a LIST-pass failure is tagged failureKind:"check" and a DOWNLOAD-pass failure failureKind:"download" on the activity entry', async () => {
  const deps = makeFakeDeps();
  const sub = await addSub(deps, { channelUrl: 'https://www.youtube.com/@kindcheck' });
  run.runList = async () => ({ ok: false, code: 'ETIMEDOUT', stdout: '', stderr: '', error: 'yt-dlp list pass timed out after 5m and was killed' });
  await ytdlp.runPoll(deps, baseConfig({ breakerFailures: 0 }));
  let entry = activity.getSnapshot().subscriptions[sub.id];
  assert.equal(entry.state, 'error');
  assert.equal(entry.failureKind, 'check', 'list failure -> check kind');

  run.runList = async () => ({ ok: true, stdout: ndjson([{ id: 'kindvid0001', availability: 'public' }]), stderr: '' });
  run.runDownload = async () => ({ ok: false, code: 1, stdout: '', stderr: '', error: 'boom', channelMeta: [], itemFailures: [] });
  await ytdlp.runPoll(deps, baseConfig({ breakerFailures: 0 }));
  entry = activity.getSnapshot().subscriptions[sub.id];
  assert.equal(entry.state, 'error');
  assert.equal(entry.failureKind, 'download', 'download failure -> download kind');
});

test('v1.32 gate fix: a sub PAUSED during the backoff window is excluded from the array-targeted breaker resume (FR-D)', async () => {
  const deps = makeFakeDeps();
  const subs = [];
  for (let i = 1; i <= 4; i++) {
    subs.push(await addSub(deps, { channelUrl: `https://www.youtube.com/@pz${i}` }));
  }
  run.runList = async () => ({ ok: false, code: 1, stdout: '', stderr: '', error: 'boom' });
  run.runDownload = async () => ({ ok: true, code: 0, stdout: '', stderr: '', channelMeta: [], itemFailures: [] });
  await ytdlp.runPoll(deps, baseConfig({ breakerFailures: 2 }));
  assert.equal(ytdlp.getPollBreakerState().skipped, 2);

  // Admin pauses one of the two deferred channels during the backoff window.
  await store.updateSubscription(deps, subs[2].id, { paused: true });

  const listCalls = [];
  run.runList = async (sub) => { listCalls.push(sub.channelUrl); return { ok: true, stdout: '', stderr: '' }; };
  await ytdlp.runPoll(deps, baseConfig({ breakerFailures: 2 }), [subs[2].id, subs[3].id]);
  assert.deepEqual(listCalls, ['https://www.youtube.com/@pz4'], 'the paused deferred sub must be skipped by the automatic resume');
});

test('v1.32 gate fix: a stale failureKind:"check" from a prior cycle is CLEARED by the catch-all error write (never mutes a real failure)', async () => {
  const deps = makeFakeDeps();
  const sub = await addSub(deps, { channelUrl: 'https://www.youtube.com/@stalekind' });
  // Cycle 1: a genuine check failure tags the entry.
  run.runList = async () => ({ ok: false, code: 'ETIMEDOUT', stdout: '', stderr: '', error: 'yt-dlp list pass timed out after 5m and was killed' });
  await ytdlp.runPoll(deps, baseConfig({ breakerFailures: 0 }));
  assert.equal(activity.getSnapshot().subscriptions[sub.id].failureKind, 'check');
  // Cycle 2: an unexpected THROW reaches processSubscription's catch-all.
  run.runList = async () => { throw new Error('unexpected builder explosion'); };
  await ytdlp.runPoll(deps, baseConfig({ breakerFailures: 0 }));
  const entry = activity.getSnapshot().subscriptions[sub.id];
  assert.equal(entry.state, 'error');
  assert.equal(entry.failureKind, null, 'the catch-all must CLEAR the stale check tag (shallow-merge staleness, FIX-3 class)');
});
