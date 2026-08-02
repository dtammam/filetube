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

  if (wasIdle) {
    let result;
    try {
      result = fn();
    } catch (err) {
      // A synchronous throw from `fn` itself is still THIS job's own
      // outcome (a rejection), not a bypass of the queue-length bookkeeping.
      result = Promise.reject(err);
    }
    const settled = Promise.resolve(result);
    gateTail = settled.then(settleTail, settleTail);
    return settled;
  }

  const result = gateTail.then(fn, fn);
  gateTail = result.then(settleTail, settleTail);
  return result;
}

module.exports = { runExclusive, isHeavyJobActive, getHeavyQueueLength, getGateQueueSnapshot };
