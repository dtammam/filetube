'use strict';

// The server-wide heavy-job gate: ONE promise-chain FIFO through which every
// disk/network-heavy background job (yt-dlp channel polls, one-shot
// downloads, podcast enclosure downloads) serializes, so a home server never
// runs two heavy transfers at once. Extracted VERBATIM from lib/ytdlp/index.js
// (v1.69.0 T2) so a second module can share it without importing a
// possibly-disabled module's internals; the ytdlp module re-exports these
// same functions, so its public API and every existing caller/test are
// unchanged. Module-level singleton BY DESIGN: the process has exactly one
// download pipeline, and the TTS worker's defer signal (isHeavyJobActive)
// is only meaningful if all heavy jobs share one counter.
//
// Every `runExclusive(fn)` call appends `fn` to the shared tail and returns
// a promise that settles with THAT job's own outcome, while the module-level
// tail always advances to a NEVER-REJECTING derivative of it. That second
// part is the v1.9.0/T4 "never wedge the queue" lesson applied here: if a
// job rejects, the caller who queued it still observes the rejection (via
// the returned promise), but the shared tail itself must never carry a
// rejected state forward -- a failing job can never permanently block every
// later job queued behind it. No queue-depth limit is enforced by
// `runExclusive` itself at this scale (a home-server operator, or a poll
// loop, triggers at most a handful of these a minute) -- FIX-10 (two-reviewer
// gate, LOW) instead adds a modest cap SPECIFICALLY at the one-shot HTTP
// route (`POST /api/ytdlp/download`), since that is the one entry point an
// unauthenticated LAN caller can hit repeatedly/programmatically; see
// `MAX_ONESHOT_QUEUE_LENGTH` there.
//
// UNCONTENDED FAST PATH (load-bearing, not just an optimization): when
// nothing else is currently queued, `fn` is invoked SYNCHRONOUSLY, in the
// exact same tick as the `runExclusive(fn)` call -- rather than always
// scheduling it via `somePromise.then(fn)`, which the Promise spec defers to
// a microtask EVEN AGAINST an already-resolved promise. Without this fast
// path, wrapping a poll loop in `runExclusive` would insert a mandatory
// microtask hop before the loop's body (and therefore before its first
// child-spawn/network call) runs, silently breaking the "an async function
// runs synchronously up to its first `await`" contract a large pre-existing
// test suite (and callers) depend on for the common, uncontended case. The
// gate only ever introduces a real queueing delay when a job is ALREADY in
// flight -- exactly the case it exists to serialize.
const { AsyncLocalStorage } = require('node:async_hooks');

// v1.393.0 (R3): each gate job runs inside its own async context, so a job the watchdog has RELEASED (its budget
// is spent) can be told apart from the job that now holds the gate: a spawn site asks `isCurrentJobAbandoned()`
// and refuses, so a hung job that wakes up late can never start a second child beside the next job's.
const jobContext = new AsyncLocalStorage();
function isCurrentJobAbandoned() {
  const ctx = jobContext.getStore();
  return Boolean(ctx && ctx.abandoned);
}

let gateTail = Promise.resolve();
let gateQueueLength = 0;
// v1.31 P1/P5: ordered metadata for every gate job that opts in (channel
// polls and one-shots do; internal maintenance jobs may not) -- this is what
// lets a status snapshot tell a queued job HOW MANY jobs are ahead of it
// instead of a bare, indistinguishable 'queued'. Entries are pushed at
// enqueue time and spliced out when the job settles; the array is therefore
// always in true FIFO order (head = running or next-to-run).
const gateQueue = [];
function getGateQueueSnapshot() {
  return gateQueue.map((e) => ({ kind: e.kind, label: e.label, jobId: e.jobId }));
}
// v1.38.0 TTS defer coordination (Dean's "less-spiky" choice): the
// authoritative "a heavy job is in flight or queued" signal.
// `gateQueueLength` is incremented for the ENTIRE lifetime of every
// runExclusive job and decremented only on settle, so this is a strictly
// more precise gate than the meta-tagged `getGateQueueSnapshot().length`.
// The server's TTS worker reads it (a single read-only counter, atomic under
// JS single-threadedness) at each dequeue and defers synthesis while it is
// true, so TTS never hammers CPU/disk alongside a download. One-directional:
// downloads never wait for TTS.
function isHeavyJobActive() {
  return gateQueueLength > 0;
}
// The raw whole-lifetime counter, for depth-cap checks (the one-shot route's
// MAX_ONESHOT_QUEUE_LENGTH guard). Same counter isHeavyJobActive reads --
// exposed as a getter, never as the mutable binding.
function getHeavyQueueLength() {
  return gateQueueLength;
}
// v1.393.0 (R3): the gate's backstop. A job whose `meta.budgetMs` (its own worst case, derived by the caller from
// the timeouts of everything it can await) has passed is HUNG: some await in it never settles. The watchdog logs one
// loud line, marks the job abandoned (it may spawn nothing more), and asks `meta.onBudgetExceeded()` whether the
// gate can safely move on. That hook must stop the job's children and answer `true` only when every one is GONE:
// releasing beside a live yt-dlp would run two at once (they share one download archive). While it answers
// `false` (a child that will not die) the gate stays held and the check repeats every BUDGET_RECHECK_MS. On
// release the returned promise settles with `meta.budgetResult()` (or `{ ok: false, code: 'EBUDGET', ... }`) and
// the hung job's late result or rejection is ignored.
const BUDGET_RECHECK_MS = 30 * 1000;
function guardBudget(settled, ctx, meta, entry) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let done = false;
    let timer = null;
    let loud = false;
    const end = (settle, value) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      timer = null;
      settle(value);
    };
    settled.then((value) => end(resolve, value), (err) => end(reject, err));
    const arm = (ms) => {
      timer = setTimeout(expire, ms);
      if (typeof timer.unref === 'function') timer.unref();
    };
    async function expire() {
      timer = null;
      if (done) return;
      ctx.abandoned = true;
      if (!loud) {
        loud = true;
        const kind = entry ? entry.kind : meta.kind || 'job';
        const label = entry ? entry.label : meta.label || '';
        console.error(`gate job exceeded its budget: ${kind} ${label} ${Date.now() - startedAt}`);
      }
      let safe = false;
      try {
        safe = typeof meta.onBudgetExceeded === 'function' ? (await meta.onBudgetExceeded()) === true : false;
      } catch (err) {
        console.error('gate: budget hook threw (the gate stays held):', err && err.message);
      }
      if (done) return;
      if (!safe) {
        arm(meta.recheckMs > 0 ? meta.recheckMs : BUDGET_RECHECK_MS);
        return;
      }
      let result = { ok: false, code: 'EBUDGET', error: 'stopped: exceeded its time budget' };
      try {
        if (typeof meta.budgetResult === 'function') result = meta.budgetResult();
      } catch (err) {
        console.error('gate: budget result builder threw (using the default):', err && err.message);
      }
      console.error('gate: released after the budget; the hung job\'s late result is ignored');
      end(resolve, result);
    }
    arm(meta.budgetMs);
  });
}

function runExclusive(fn, meta) {
  const wasIdle = gateQueueLength === 0;
  gateQueueLength += 1;
  const entry = meta && typeof meta === 'object'
    ? { kind: typeof meta.kind === 'string' ? meta.kind : 'job', label: typeof meta.label === 'string' ? meta.label : '', jobId: typeof meta.jobId === 'string' ? meta.jobId : null }
    : null;
  if (entry) gateQueue.push(entry);
  const settleTail = () => {
    gateQueueLength -= 1;
    if (entry) {
      const i = gateQueue.indexOf(entry);
      if (i !== -1) gateQueue.splice(i, 1);
    }
  };
  const budgeted = Boolean(meta && typeof meta === 'object' && Number.isFinite(meta.budgetMs) && meta.budgetMs > 0);
  // The job runs inside its own context (synchronously, so the uncontended fast path is unchanged); a budgeted
  // job is wrapped by the watchdog from the moment it STARTS.
  const start = () => {
    const ctx = { abandoned: false };
    if (!budgeted) return jobContext.run(ctx, fn);
    let result;
    try {
      result = jobContext.run(ctx, fn);
    } catch (err) {
      result = Promise.reject(err);
    }
    return guardBudget(Promise.resolve(result), ctx, meta, entry);
  };

  if (wasIdle) {
    let result;
    try {
      result = start();
    } catch (err) {
      // A synchronous throw from `fn` itself is still THIS job's own
      // outcome (a rejection), not a bypass of the queue-length bookkeeping.
      result = Promise.reject(err);
    }
    const settled = Promise.resolve(result);
    gateTail = settled.then(settleTail, settleTail);
    return settled;
  }

  const result = gateTail.then(start, start);
  gateTail = result.then(settleTail, settleTail);
  return result;
}

module.exports = { runExclusive, isHeavyJobActive, getHeavyQueueLength, getGateQueueSnapshot, isCurrentJobAbandoned, BUDGET_RECHECK_MS };
