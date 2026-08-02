'use strict';

// [UNIT] v1.69.0 T2 - lib/heavyGate.js, the server-wide heavy-job FIFO
// extracted verbatim from lib/ytdlp/index.js so the podcasts module can
// serialize enclosure downloads through the SAME gate. These tests bind the
// four load-bearing behaviors the extraction must preserve:
//   1. strict FIFO order under contention,
//   2. the uncontended SYNCHRONOUS fast path (same-tick invocation),
//   3. never-wedge: a rejecting job settles its own caller but later jobs run,
//   4. whole-lifetime queue counting (isHeavyJobActive/getHeavyQueueLength)
//      and the FIFO-ordered, meta-opt-in snapshot.
// The ytdlp module re-exports these same functions; test/unit/
// ytdlp-heavy-job-active.test.js binds that re-export seam separately.

const { test } = require('node:test');
const assert = require('node:assert');

const gate = require('../../lib/heavyGate');

test('FIFO order under contention: jobs run one at a time, in enqueue order', async () => {
  const order = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });

  const p1 = gate.runExclusive(async () => { order.push('start1'); await firstGate; order.push('end1'); });
  const p2 = gate.runExclusive(async () => { order.push('start2'); order.push('end2'); });
  const p3 = gate.runExclusive(async () => { order.push('start3'); order.push('end3'); });

  // Job 1 holds the gate; 2 and 3 must not have started.
  assert.deepStrictEqual(order, ['start1'], 'queued jobs do not start while the gate is held');
  releaseFirst();
  await Promise.all([p1, p2, p3]);
  assert.deepStrictEqual(order, ['start1', 'end1', 'start2', 'end2', 'start3', 'end3'], 'strict FIFO, one at a time');
});

test('uncontended fast path: fn runs synchronously in the same tick as the call', async () => {
  let ranSynchronously = false;
  const p = gate.runExclusive(() => { ranSynchronously = true; return Promise.resolve('v'); });
  assert.strictEqual(ranSynchronously, true, 'fn invoked before runExclusive returns (no microtask hop)');
  assert.strictEqual(await p, 'v', 'the returned promise settles with the job outcome');
});

test('never-wedge: a rejecting job rejects its own caller, later jobs still run', async () => {
  const boom = new Error('job failed');
  const p1 = gate.runExclusive(() => Promise.reject(boom));
  const p2 = gate.runExclusive(() => 'after-rejection');
  await assert.rejects(p1, boom, 'the failing job\'s caller observes the rejection');
  assert.strictEqual(await p2, 'after-rejection', 'the queue advances past a rejected job');
  assert.strictEqual(gate.isHeavyJobActive(), false, 'the counter fully unwinds after a rejection');
});

test('a synchronous throw from fn is that job\'s own rejection, bookkeeping intact', async () => {
  const boom = new Error('sync throw');
  const p1 = gate.runExclusive(() => { throw boom; });
  await assert.rejects(p1, boom);
  assert.strictEqual(gate.isHeavyJobActive(), false, 'counter unwinds after a sync throw');
  assert.strictEqual(await gate.runExclusive(() => 'still-alive'), 'still-alive');
});

test('whole-lifetime counting + snapshot: queued jobs count and appear in FIFO order; meta is opt-in', async () => {
  assert.strictEqual(gate.isHeavyJobActive(), false, 'idle gate reads false');
  assert.strictEqual(gate.getHeavyQueueLength(), 0, 'idle length is 0');

  let release;
  const hold = new Promise((resolve) => { release = resolve; });
  const p1 = gate.runExclusive(() => hold, { kind: 'poll', label: 'first', jobId: 'a' });
  const p2 = gate.runExclusive(() => 'second', { kind: 'oneshot', label: 'second', jobId: 'b' });
  const p3 = gate.runExclusive(() => 'third'); // no meta: counted, but absent from the snapshot

  assert.strictEqual(gate.isHeavyJobActive(), true, 'in-flight + queued jobs read active');
  assert.strictEqual(gate.getHeavyQueueLength(), 3, 'length counts running AND queued jobs');
  assert.deepStrictEqual(
    gate.getGateQueueSnapshot(),
    [
      { kind: 'poll', label: 'first', jobId: 'a' },
      { kind: 'oneshot', label: 'second', jobId: 'b' },
    ],
    'snapshot is FIFO-ordered and contains only meta-opted jobs'
  );

  release();
  await Promise.all([p1, p2, p3]);
  assert.strictEqual(gate.isHeavyJobActive(), false, 'gate drains to inactive');
  assert.strictEqual(gate.getHeavyQueueLength(), 0, 'length drains to 0');
  assert.deepStrictEqual(gate.getGateQueueSnapshot(), [], 'snapshot drains empty');
});

test('the ytdlp module re-exports the SAME gate instance (shared serialization seam)', async () => {
  const ytdlp = require('../../lib/ytdlp');
  assert.strictEqual(ytdlp.runExclusive, gate.runExclusive, 'one runExclusive binding');
  assert.strictEqual(ytdlp.isHeavyJobActive, gate.isHeavyJobActive, 'one isHeavyJobActive binding');
  // Behavioral proof, not just identity: a job queued via the gate module is
  // visible through the ytdlp re-export while in flight.
  let release;
  const hold = new Promise((resolve) => { release = resolve; });
  const p = gate.runExclusive(() => hold);
  assert.strictEqual(ytdlp.isHeavyJobActive(), true, 'a heavyGate job is active through the ytdlp view');
  release();
  await p;
});
