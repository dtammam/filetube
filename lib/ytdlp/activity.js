'use strict';

// Ephemeral (NON-persisted) in-process "live activity" map for FR-E. This is
// deliberately NOT part of db.json: it is rebuilt from empty on every process
// restart, and exists purely to answer "what is happening RIGHT NOW" for the
// `/subscriptions` page's ~2.5s poll. The durable, terminal summary remains
// `sub.lastStatus`/`lastCheckedAt` (store.js's `setSubscriptionStatus`) --
// this module never reads or writes db.json, never imports store.js, and has
// no knowledge of `updateDatabase`.
//
// Two namespaces, matching the design's LiveEntry model: `subscriptions`
// (keyed by subscription id) and `oneShots` (keyed by a one-shot `jobId`,
// which has no subscription row to live on). Every mutator is synchronous --
// Node has no real concurrency here, and the shared spawn-serialization gate
// (T3's `runExclusive`) plus the single-flight poll loop mean only one writer
// is ever in a non-terminal state at a time, so no locking is needed.
//
// Testability: every function that stamps a timestamp accepts an optional
// `now` (a `() => ms` function, a raw `ms` number, or omitted for the real
// `Date.now()`) so tests never depend on real wall-clock time or real
// timers.
//
// v1.21.0 FR-8 (T7): a one-shot's `LiveEntry` now additionally carries
// `format`/`quality`/`filetype` (written by `lib/ytdlp/index.js`'s download
// route + `runOneShot`, alongside the pre-existing `url`/`label`) so a
// FAILED one-shot's original request can be reconstructed client-side for a
// Retry re-POST to `POST /api/ytdlp/download` (`public/js/common.js`'s
// `buildOneShotRetryBody`). This module needed NO functional change for
// that -- `mergeEntry` already shallow-merges whatever patch it is handed,
// so an unrecognized-by-this-module field name round-trips through
// `setOneShot`/`getSnapshot` exactly like every existing field already did.

// `cancelled` (v1.24, T15/A3): a NEW terminal one-shot state (a user-cancelled
// download, distinct from `error`) -- included here so a cancelled job's entry
// TTL-prunes like `done`/`error` instead of lingering in `oneShots` forever.
const TERMINAL_STATES = new Set(['done', 'error', 'cancelled']);

// One-shot jobs have no subscription row, so nothing else ever removes a
// finished one-shot's entry -- without pruning, `oneShots` would grow
// unboundedly across the process's lifetime. Terminal (done/error/cancelled)
// entries older than this are dropped on every `getSnapshot()` call. Subscription
// entries are NOT pruned here: they are bounded by subscription count and
// intentionally kept as the "last live" record between polls.
const ONESHOT_TTL_MS = 5 * 60 * 1000; // 5 minutes

let state = {
  subscriptions: Object.create(null),
  oneShots: Object.create(null),
};

// Resolve `now` (a function, a raw ms number, or undefined) to a concrete ms
// timestamp. Never throws -- any unrecognized shape falls back to the real
// clock, exactly like an omitted argument would.
function resolveNowMs(now) {
  if (typeof now === 'number' && Number.isFinite(now)) return now;
  if (typeof now === 'function') {
    const result = now();
    return typeof result === 'number' && Number.isFinite(result) ? result : Date.now();
  }
  return Date.now();
}

function toIso(nowMs) {
  return new Date(nowMs).toISOString();
}

function mergeEntry(map, id, patch, nowMs) {
  if (typeof id !== 'string' || id === '') return null;
  const existing = map[id] && typeof map[id] === 'object' ? map[id] : {};
  const safePatch = patch && typeof patch === 'object' ? patch : {};
  const updated = { ...existing, ...safePatch, updatedAt: toIso(nowMs) };
  map[id] = updated;
  return { ...updated };
}

/**
 * Shallow-merge `patch` into subscription `id`'s LiveEntry (creating it if
 * absent), stamping `updatedAt`. Returns a COPY of the resulting entry (or
 * `null` for an invalid id) so callers can never mutate the live map by
 * reference.
 */
function setSubscription(id, patch, now) {
  return mergeEntry(state.subscriptions, id, patch, resolveNowMs(now));
}

/**
 * FIX-5 (two-reviewer gate): TTL-prune terminal (done/error) one-shot entries
 * older than `ONESHOT_TTL_MS`, given an already-resolved `nowMs`. Extracted
 * so both `setOneShot` (prune-on-WRITE) and `getSnapshot` (prune-on-READ)
 * share the exact same sweep -- neither is the sole enforcement point.
 */
function pruneStaleOneShots(nowMs) {
  for (const [jobId, entry] of Object.entries(state.oneShots)) {
    if (!entry || !TERMINAL_STATES.has(entry.state)) continue;
    const updatedMs = Date.parse(entry.updatedAt);
    if (Number.isFinite(updatedMs) && nowMs - updatedMs > ONESHOT_TTL_MS) {
      delete state.oneShots[jobId];
    }
  }
}

/**
 * Shallow-merge `patch` into one-shot job `jobId`'s LiveEntry (creating it if
 * absent), stamping `updatedAt`. Same contract as `setSubscription`.
 *
 * FIX-5 (two-reviewer gate): previously the ONLY place `oneShots` was
 * TTL-pruned was `getSnapshot()` -- so a deployment that never polls `GET
 * /api/subscriptions/status` (e.g. only ever drives the module
 * programmatically via `POST /api/ytdlp/download`) would grow this map
 * without bound, one entry per one-shot job, forever. Pruning is now also
 * run here, on every WRITE, using the SAME injected `now` this call already
 * resolves -- so the map self-bounds independent of whether anything ever
 * reads a snapshot, and remains fully deterministic under injected time in
 * tests (no reliance on a real clock/timer).
 */
function setOneShot(jobId, patch, now) {
  const nowMs = resolveNowMs(now);
  pruneStaleOneShots(nowMs);
  return mergeEntry(state.oneShots, jobId, patch, nowMs);
}

/**
 * Drop a subscription's live entry entirely (called on subscription delete,
 * so a removed subscription can never reappear in a status snapshot).
 * Returns `true` if an entry was actually removed, `false` otherwise
 * (unknown/invalid id) -- never throws.
 */
function clearSubscription(id) {
  if (typeof id === 'string' && id !== '' && Object.prototype.hasOwnProperty.call(state.subscriptions, id)) {
    delete state.subscriptions[id];
    return true;
  }
  return false;
}

/**
 * Return a plain-object COPY of the current activity map
 * (`{ subscriptions, oneShots }`), first pruning any TERMINAL (done/error)
 * one-shot entry older than `ONESHOT_TTL_MS` out of the live map so the
 * `oneShots` namespace never grows unbounded. Subscription entries are
 * always included, never pruned by this function.
 */
function getSnapshot(now) {
  const nowMs = resolveNowMs(now);

  pruneStaleOneShots(nowMs);

  const subscriptions = {};
  for (const [id, entry] of Object.entries(state.subscriptions)) {
    subscriptions[id] = { ...entry };
  }
  const oneShots = {};
  for (const [jobId, entry] of Object.entries(state.oneShots)) {
    oneShots[jobId] = { ...entry };
  }
  return { subscriptions, oneShots };
}

/**
 * Test-only: reset the module back to its initial empty state (mirrors
 * `resetPollRerunStateForTests` elsewhere in this codebase). Never used by
 * production code.
 */
function resetForTests() {
  state = { subscriptions: Object.create(null), oneShots: Object.create(null) };
}

module.exports = {
  setSubscription,
  setOneShot,
  clearSubscription,
  getSnapshot,
  resetForTests,
  ONESHOT_TTL_MS,
};
