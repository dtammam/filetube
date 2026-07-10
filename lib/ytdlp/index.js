'use strict';

// Wiring surface for the optional yt-dlp subscription module. Requiring this
// file has NO side effects: it only defines functions. Every side effect
// (route registration, timer arming, directory creation/presence checks, and
// the download loop itself) lives behind a named function that early-returns
// when `isEnabled(config)` is false, mirroring server.js's
// `require.main === module` guard for process-lifecycle work.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parseYtdlpConfig, isEnabled } = require('./config');
const store = require('./store');
const rules = require('./rules');
const args = require('./args');
const url = require('./url');
// FR-E: the ephemeral in-process activity map. Never imports store.js/db.json
// itself (see the module comment at the top of activity.js) -- this file is
// the ONLY orchestrator that writes into it, driving the queued/listing/
// downloading/done/error transitions for both subscriptions and one-shots.
const activity = require('./activity');
// Required as a whole module object (never destructured) so tests can
// monkey-patch `run.runList`/`run.runDownload` at the exact call sites this
// file uses, mirroring how `store` is already referenced above and how
// lib/ytdlp/run.js itself references `child_process` -- no mocking library
// or dependency injection needed to spy the invocation boundary.
const run = require('./run');
// v1.15.1 hotfix: the same yt-dlp-intermediate predicate server.js's library
// scan uses to exclude these from being INDEXED (see that module's own
// comment for why this is a leaf module, required directly here rather than
// via server.js, to avoid a circular dependency) -- used by
// `cleanupFailedDownloadIntermediates`, below, as defense-in-depth so a
// failed/killed download's leftovers don't linger on disk at all.
const { isYtdlpIntermediate } = require('../ytdlpIntermediates');

// Module-level poll-timer handle, mirroring server.js's `scanTimer` +
// armScanTimer()/currentScanTimer() shape (server.js:1121-1140) exactly: kept
// at module scope so repeated arm calls clear-then-re-arm rather than
// stacking intervals, and so `currentYtdlpPollTimer()` gives tests a single
// source of truth for "is a poll timer currently armed."
let ytdlpPollTimer = null;

// Overlap guard for `runPoll`, mirroring server.js's `scanState.scanning`:
// two concurrent poll triggers (the timer firing while a re-pull-all is
// still running, a re-pull-one clicked twice, etc.) must never stack
// parallel spawns -- that would overload a home server and risks racing
// yt-dlp's own archive bookkeeping for the SAME channel. A poll requested
// while one is already running simply coalesces to a bounded no-op (the next
// scheduled/triggered poll will pick up whatever the in-flight one didn't
// finish) rather than queueing indefinitely (no livelock).
let pollBusy = false;

// C5: a trigger arriving WHILE `pollBusy` is true no longer just no-ops --
// it sets this flag instead, mirroring server.js's `scanState.rescanRequested`
// + `scheduleDeferredRescan` pattern. `runPoll`'s `finally` (below) checks it
// after clearing `pollBusy` and, if set, arms exactly ONE unref'd follow-up
// poll -- never an unbounded queue (a trigger arriving during the follow-up
// itself just re-sets the flag and gets its own single follow-up in turn).
// This matters most under `pollMinutes=0` (manual-only), where a dropped
// trigger would otherwise be lost forever behind the busy 202.
//
// D3 (T4 fix round #2): tracks WHICH target was requested while busy, so the
// single coalesced follow-up re-runs only what was actually asked for
// instead of always escalating to a full re-pull-all. `undefined` = nothing
// pending; `RERUN_ALL` = a general re-pull-all was requested (or two
// DIFFERENT targets coalesced together, which must escalate rather than
// silently drop one of them); any other value is the single specific
// `subId` that was requested.
const RERUN_ALL = Symbol('ytdlp-poll-rerun-all');
let pollRerunTarget; // stays `undefined` until a busy-coalesce sets it

// Records a coalesced re-pull request's target. A first request just records
// its target (specific `subId` or `RERUN_ALL` for a general re-pull-all). A
// SECOND request arriving before the follow-up fires escalates to
// `RERUN_ALL` UNLESS it asks for the exact same specific target already
// pending -- this is what prevents a specific + a general request (or two
// different specific requests) from silently dropping one of them: the
// single follow-up this function ultimately arms can only carry one target,
// so "re-run everything" is the only way to honor both.
function requestPollRerun(subId) {
  const requested = (subId === undefined || subId === null) ? RERUN_ALL : subId;
  if (pollRerunTarget === undefined) {
    pollRerunTarget = requested;
  } else if (pollRerunTarget !== requested) {
    pollRerunTarget = RERUN_ALL;
  }
}

// Single-guarded (mirrors server.js's `deferredRescanTimer`): never more than
// one follow-up poll pending at a time.
let pollRerunTimer = null;

// E4 (T4 fix round #3, LOW, concurrency hardening): `pollRerunTarget` is now
// the SINGLE SOURCE OF TRUTH this timer callback DRAINS at fire time -- it
// reads (and clears) whatever is CURRENTLY recorded there the moment it
// actually runs, rather than a value captured in a closure argument when the
// timer was armed. Previously `schedulePollRerun` took a `subId` parameter
// and `runPoll`'s `finally` read-then-cleared `pollRerunTarget` itself before
// calling this function -- so if a follow-up timer was ALREADY armed (e.g.
// for subscription B) when a LATER poll's `finally` tried to schedule its own
// follow-up (e.g. for subscription D), the `if (pollRerunTimer) return;`
// guard silently dropped D: `pollRerunTarget` had already been cleared to
// `undefined` by B's `finally` before the timer even fired, so there was no
// record of D anywhere once its own scheduling attempt was declined. Now
// `requestPollRerun` (called from `runPoll`'s busy branch) is the ONLY writer
// of `pollRerunTarget`, and this timer callback is the ONLY reader/clearer of
// it -- so a request recorded AFTER a timer is already armed (D, above) lands
// in the exact same variable the already-armed timer will read when it
// fires, honoring the RERUN_ALL/specific-target coalescing semantics
// (`requestPollRerun`'s escalation rule, above) no matter how the triggers
// interleave. `runPoll`'s `finally` (below) no longer captures a target at
// all -- it just ensures exactly one timer is armed when a target is
// pending.
function schedulePollRerun(deps, config) {
  if (pollRerunTimer) return; // never stack/chain more than one pending follow-up
  pollRerunTimer = setTimeout(() => {
    pollRerunTimer = null;
    if (pollRerunTarget === undefined) return; // nothing pending after all -- nothing to drain
    const target = pollRerunTarget;
    pollRerunTarget = undefined;
    runPoll(deps, config, target === RERUN_ALL ? undefined : target).catch((err) => {
      console.error('yt-dlp: coalesced re-pull follow-up failed unexpectedly:', err && err.message);
    });
  }, 0);
  pollRerunTimer.unref(); // never keep the process (or a test runner) alive
}

// F3 (T4 cleanup pass): test/reset-only hook, mirroring the shape of the
// other test-observability accessors above (`isPollBusy`, `currentYtdlpPollTimer`).
// `pollRerunTimer`/`pollRerunTarget` are module-level singleton state shared
// by every test file that requires `lib/ytdlp` in the SAME process; the
// `setTimeout(0)` follow-up is unref'd specifically so it never keeps a test
// runner alive, which means it's also never guaranteed to have fired before
// a test file's `afterEach` runs. If it hasn't, `pollRerunTimer` is left
// non-null and `schedulePollRerun`'s `if (pollRerunTimer) return;` guard
// would then silently swallow every future follow-up arm attempt -- not just
// in the test that left it dangling, but in every later test sharing this
// module instance. Never called from production code paths; exists purely
// so test teardown can guarantee a clean slate between tests.
function resetPollRerunStateForTests() {
  clearPendingPollRerun();
}

/**
 * v1.24.8: the PRODUCTION entry point for clearing a pending coalesced
 * re-pull -- same body as `resetPollRerunStateForTests` above (that function
 * now simply delegates here), but reachable from real request handlers, not
 * just test teardown. Called by the stop-all cancel route (below) after it
 * has finished latching/killing/clearing every currently queued/active
 * subscription: without this, a re-pull that had already coalesced while
 * this poll was busy (`requestPollRerun`, above) would fire its unref'd
 * follow-up timer moments later and immediately re-spawn the very backlog
 * stop-all just cleared, defeating the whole point of "stop everything."
 */
function clearPendingPollRerun() {
  if (pollRerunTimer) clearTimeout(pollRerunTimer);
  pollRerunTimer = null;
  pollRerunTarget = undefined;
}

// Bound how much of a composed status string is ever persisted -- a
// pathological/very long redacted error must not bloat db.json indefinitely.
const MAX_STATUS_LENGTH = 300;

// FIX-10 (two-reviewer gate, LOW): a modest cap on how many one-shot
// downloads (`POST /api/ytdlp/download`) may sit pending on the shared
// `runExclusive` FIFO at once -- see that route's own comment and
// `runExclusive`'s module comment (below) for why this lives here rather
// than as a general `runExclusive` queue-depth limit.
const MAX_ONESHOT_QUEUE_LENGTH = 50;

// v1.25 QoL (T3): the fixed fallback folder a one-shot download lands in
// when the pre-download channel probe (`runOneShot`, below) fails or finds
// no channel identity for the video -- e.g. a probe timeout, yt-dlp binary
// unavailable, or a video whose extractor genuinely reports none of
// `channel`/`uploader`/`channel_id`. Deliberately NOT the old flat
// `'One-Off'` literal: Dean wants every download (probed-successfully or
// not) organized under a NAMED per-channel-or-fallback folder, never a
// single flat catch-all bucket -- see this task's own design note. Routed
// through `args.resolveChannelDir({ name: ONE_OFF_FALLBACK_FOLDER })`
// exactly like a probed channel name or a user-supplied override, so it
// inherits the exact same sanitize/confine guarantees.
const ONE_OFF_FALLBACK_FOLDER = 'Uncategorized';

// v1.24.0 A3: the LIVE `ChildProcess` handle for every one-shot download
// currently in flight, keyed by its `jobId` -- this is the module-level
// registry `runOneShot` (below) populates via `run.runDownload`'s
// `opts.onChild` hook (lib/ytdlp/run.js), and the ONLY thing the new `POST
// /api/ytdlp/download/:jobId/cancel` route (below) needs to `child.kill(...)`
// a specific job. Deliberately scoped to ONE-SHOTS only (never subscription
// downloads -- see that route's own comment for the scope rationale). An
// entry is deleted the moment `run.runDownload`'s own promise settles (see
// `runOneShot`), so a completed/failed/errored job can never be "cancelled"
// after the fact and this map can never grow unbounded relative to the
// already-bounded `MAX_ONESHOT_QUEUE_LENGTH` pending-queue cap above.
const activeOneShotChildren = new Map();

/**
 * v1.24.0 A3 (two-reviewer-gate fix round, FIX-1): a DURABLE latch of every
 * one-shot `jobId` that has been cancelled, kept SEPARATELY from the
 * mutable `activity` snapshot `wasJobCancelled` used to read (pre-fix). The
 * pre-fix version read `activity.getSnapshot()` at the moment `runOneShot`'s
 * terminal write ran -- but a late, pipe-buffered progress `data` line (or
 * the ungated close-time flush, both in `run.js`) can call `onProgress` ->
 * `activity.setOneShot(jobId, {state:'downloading'})` and clobber the
 * `'cancelled'` state back to `'downloading'` BEFORE the terminal write ever
 * reads it -- so the live-state read was not a reliable source of truth for
 * "was this job cancelled." This `Set` is: the cancel route ADDS `jobId` to
 * it (alongside the existing SIGKILL + `setOneShot('cancelled')`, see that
 * route below); `runOneShot`'s OUTER `finally` (wrapping its whole
 * try/catch, NOT the inner `try/finally` around just the `run.runDownload`
 * await -- deleting it there would run BEFORE the terminal-write checks
 * below ever get to read it, silently defeating the latch) DELETES it once
 * the job has fully run its course, so it can never grow unbounded relative
 * to a job's own lifetime. Checked at THREE points, all below: (1)
 * `runOneShot`'s `onProgress` wrapper is a no-op once a job is in this set,
 * so a late progress line never even momentarily flips the UI away from
 * `'cancelled'`; (2) both terminal `error` write sites check this set
 * (instead of the old live-state read) and skip the `error` write
 * entirely when cancelled; (3) those same two sites RE-ASSERT
 * `activity.setOneShot(jobId, {state:'cancelled'})` in case a late progress
 * line already flipped it before this latch was checked, so the FINAL state
 * is always, definitively, `'cancelled'`.
 */
const cancelledOneShotJobs = new Set();

/**
 * v1.24.8: the SUBSCRIPTION-side twin of `activeOneShotChildren`, one
 * namespace over -- the LIVE `ChildProcess` handle for the subscription
 * currently spawning a download, keyed by `sub.id`. Populated by
 * `runSubscriptionCycle`'s own `run.runDownload` call via the SAME
 * `opts.onChild` hook (lib/ytdlp/run.js) `runOneShot` already uses; deleted
 * in a `finally` wrapping that same await, exactly mirroring
 * `activeOneShotChildren`'s registration/cleanup discipline (see that Map's
 * doc comment above). Because `runPoll`'s loop is strictly sequential (one
 * subscription at a time -- see `runPoll`'s own doc comment), this Map can
 * only ever hold AT MOST ONE entry at a time in production; it is still keyed
 * by `sub.id` (rather than a single module-level variable) so `POST
 * /api/subscriptions/:id/cancel` (below) can address the right one without
 * having to separately track "which subscription is this."
 */
const activeSubscriptionDownloads = new Map();

/**
 * v1.24.8: the SUBSCRIPTION-side twin of `cancelledOneShotJobs`, one
 * namespace over -- a durable latch of subscription ids that a cancel
 * request has targeted THIS poll. Unlike a one-shot job (whose latch entry
 * is scoped to that job's own lifetime), a subscription is LONG-LIVED --
 * it is polled again and again, forever, by every future scheduled/manual
 * poll -- so this latch must NOT survive past the poll it was recorded in,
 * or a single cancel would permanently mute that channel from ever being
 * polled again. It is therefore bounded to the CURRENT poll: `runPoll`'s
 * `finally` (below) clears the WHOLE set unconditionally once that poll's
 * targeted loop has finished, so a subscription cancelled in poll N is
 * polled completely normally in poll N+1 (see the regression test covering
 * exactly this in test/integration/ytdlp-subscription-cancel.test.js).
 *
 * Checked at TWO points, mirroring `cancelledOneShotJobs`'s three (a
 * subscription has no separate "late progress line" call site of its own --
 * both its progress AND its terminal writes already funnel through the same
 * `guardedSetSubscriptionActivity` choke point, so ONE guard covers both):
 * (1) `runPoll`'s sequential loop skips a latched id entirely BEFORE calling
 * `processSubscription`, so an already-cancelled but not-yet-spawned
 * (`'queued'`) subscription can never spawn a download child in the first
 * place; (2) `guardedSetSubscriptionActivity` (the single choke point every
 * subscription activity write -- progress AND terminal -- funnels through)
 * short-circuits to hold/re-assert `'cancelled'` instead of writing
 * `'error'`/`'downloading'`/anything else for a latched id, closing the same
 * T15 late-write race class one-shot cancel already closed, in exactly one
 * place.
 */
const cancelledSubscriptionIds = new Set();

// ---- v1.25 QoL follow-up: metadata+subtitle re-pull backfill (reheat) -----
//
// A SINGLE module-level "reheat" batch, one at a time (a second `POST
// /api/ytdlp/repull-metadata` while one is already running is rejected --
// see the route below), mirroring the one-shot/`activeOneShotChildren`
// posture but simpler: there is no `ChildProcess` handle to track here --
// `run.repullItemMetaAndSubs` (lib/ytdlp/run.js) owns its own two spawns
// internally and never exposes them -- so "cancel" is a plain cooperative
// latch the batch loop checks BETWEEN items (the loop is the only place a
// cancel can actually take effect; an item already mid-flight always runs to
// completion, exactly like `enumerateRepullableItems`'s own "resumable, not
// preemptible mid-item" posture).
//
// `repullMetadataInProgress`: the concurrency guard the route checks BEFORE
// ever calling `enumerateRepullableItems`/spawning the background batch --
// analogous to `MAX_ONESHOT_QUEUE_LENGTH`'s queue-depth guard for one-shots,
// but here it's a hard single-flight lock (never more than one reheat batch
// at a time), since every item already funnels through the SAME shared
// `runExclusive` FIFO gate a concurrent second batch would just serialize
// behind anyway -- rejecting outright is clearer than silently interleaving
// two "which batch is this progress for" activity writers.
let repullMetadataInProgress = false;

// `repullMetadataCancelled`: the durable cooperative-cancel latch, checked at
// the TOP of every loop iteration in `runRepullMetadataBatch` (below) --
// mirrors `cancelledSubscriptionIds`/`cancelledOneShotJobs`'s "durable Set,
// not a live activity-state read" discipline, simplified to a single boolean
// since only one reheat batch can ever be in flight at a time (see
// `repullMetadataInProgress` above). Reset to `false` every time a NEW batch
// starts (never left dangling from a prior run), and never touched again
// until either the cancel route sets it or the batch itself finishes.
let repullMetadataCancelled = false;

// Fixed `activity.oneShots` key for the reheat's LiveEntry -- there is only
// ever at most one reheat batch running at a time (see
// `repullMetadataInProgress` above), so a single well-known id (rather than a
// fresh `crypto.randomUUID()` per batch, the way one-shot downloads each get
// their own) is simplest: the `/subscriptions` page's existing ~2.5s `GET
// /api/subscriptions/status` poll can render it without first having to
// learn a dynamically-generated id from the `202` response. Reuses the
// EXISTING `oneShots` namespace (`activity.setOneShot`) rather than adding a
// third one to lib/ytdlp/activity.js -- that module's shallow-merge
// `mergeEntry` already round-trips whatever shape a patch carries (see its
// own header comment), so the reheat's `{kind, total, done, skipped, failed,
// current}` fields ride through it unchanged, and its EXISTING
// `TERMINAL_STATES`-gated TTL-prune (`done`/`error`/`cancelled`) applies to
// this entry for free.
const REPULL_METADATA_ACTIVITY_ID = 'repull-metadata';

/**
 * The reheat's background worker: iterates `items` (an
 * `enumerateRepullableItems`-shaped array) ONE AT A TIME, each spawn wrapped
 * in `runExclusive` so it shares the SAME global FIFO gate the poll loop and
 * one-shot downloads already serialize against (NFR2) -- a reheat batch can
 * never storm the network, and never runs a metadata spawn concurrently with
 * a subscription/one-shot download spawn.
 *
 * Runs entirely OUTSIDE the HTTP request/response cycle (the route below has
 * already responded `202` by the time this starts) -- like `runOneShot`, this
 * has its own top-level `try/finally` and MUST NEVER let a rejection escape
 * uncaught (the route's own `.catch` below is defense-in-depth only, matching
 * every other background-worker call site in this module).
 *
 * Idempotent/resumable: an item whose `alreadyRepulled` flag is already set
 * is SKIPPED (counted, never re-spawned) unless `force` is true -- so a
 * crashed/killed process can simply be re-triggered and picks up wherever it
 * left off, never re-doing already-completed work by default.
 *
 * One bad item never wedges the batch: a `null` result from
 * `run.repullItemMetaAndSubs` (that function's own "nothing usable" outcome
 * -- it NEVER throws, see its doc comment) is counted `failed` and the loop
 * simply continues; the `try/catch` around the whole per-item body is pure
 * defense-in-depth against a future regression of that guarantee (or a throw
 * from `deps.recordRepulledItemMeta`), matching this module's "never let a
 * background failure escape uncaught" posture elsewhere (`runOneShot`,
 * `processSubscription`).
 *
 * `done` vs `failed` counting -- an item is counted `done` iff BOTH (a) the
 * SUBTITLE pass actually completed (`result.wroteSubs === true` -- passed
 * through as `meta.markComplete` to `deps.recordRepulledItemMeta`, which is
 * what gates the `metadataRepulledAt` idempotency marker, see that
 * function's own doc comment in server.js) AND (b) the write was actually
 * persisted (`recordRepulledItemMeta` resolved truthy). Every other outcome
 * is counted `failed`, even when metadata was usefully persisted along the
 * way -- honest bookkeeping, not an optimistic one:
 *   - `result` is `null` (Pass A AND Pass B both produced nothing) -> `failed`.
 *   - `result.wroteSubs === false` (a TRANSIENT subs-spawn failure --
 *     timeout/spawn error; NOT the same as a genuinely sub-less video, which
 *     exits 0 and yields `wroteSubs: true`) -> `failed`, even though
 *     `releaseDate`/`channelAvatarUrl` may have been persisted -- the item
 *     stays `alreadyRepulled: false` so a later non-`force` reheat retries
 *     its subtitles.
 *   - `recordRepulledItemMeta` resolves `false` (the item vanished from
 *     `db.metadata` mid-batch, its own safe no-op) -> `failed`, never `done`
 *     -- there is nothing to show for this item, so counting it `done` would
 *     overstate success.
 *   - `result.wroteSubs === true` AND the write was persisted -> `done`.
 *
 * NEVER triggers a scan: `recordRepulledItemMeta` (server.js) already writes
 * `releaseDate`/`channelAvatarUrl`/`hasSubtitles` directly into
 * `db.metadata`, so the UI reflects a reheated item immediately without a
 * rescan -- deliberately, to avoid exactly the kind of unconditional
 * re-processing pass the thumbnail-backfill-regression lesson warns against.
 *
 * @param {object} deps the SAME deps object `registerRoutes` received
 * @param {object} config parsed yt-dlp config
 * @param {Array<{mediaId: string, filePath: string, videoId: string, watchUrl: string, alreadyRepulled: boolean}>} items
 * @param {boolean} force when true, re-processes items already marked `alreadyRepulled`
 */
async function runRepullMetadataBatch(deps, config, items, force) {
  const total = Array.isArray(items) ? items.length : 0;
  let done = 0;
  let skipped = 0;
  let failed = 0;

  activity.setOneShot(REPULL_METADATA_ACTIVITY_ID, {
    kind: 'repull',
    state: 'running',
    total,
    done,
    skipped,
    failed,
    current: null,
  });

  try {
    for (const item of (Array.isArray(items) ? items : [])) {
      // Durable cancel latch, checked at the TOP of every iteration -- an
      // item already mid-flight (there is none at this exact point, since
      // the check runs BEFORE this iteration's own runExclusive call) always
      // runs to completion; only the NEXT item is ever skipped by a cancel.
      if (repullMetadataCancelled) {
        activity.setOneShot(REPULL_METADATA_ACTIVITY_ID, { state: 'cancelled', current: null });
        return;
      }

      if (item.alreadyRepulled && !force) {
        skipped += 1;
        activity.setOneShot(REPULL_METADATA_ACTIVITY_ID, { skipped, current: item.videoId });
        continue;
      }

      activity.setOneShot(REPULL_METADATA_ACTIVITY_ID, { current: item.videoId });
      try {
        // NFR2: shares the SAME shared FIFO gate the poll loop and one-shot
        // downloads use -- never runs concurrently with either.
        const result = await runExclusive(() => run.repullItemMetaAndSubs(item.watchUrl, item.filePath, config));
        if (result) {
          // Gate the idempotency marker on the SUBTITLE pass actually
          // completing -- see this function's own doc comment (`done` vs
          // `failed` counting) and `recordRepulledItemMeta`'s doc comment
          // (server.js) for the full rationale.
          const markComplete = result.wroteSubs === true;
          const recorded = await deps.recordRepulledItemMeta(deps, item.mediaId, {
            releaseDate: result.releaseDate,
            channelAvatarUrl: result.channelAvatarUrl,
            filePath: item.filePath,
            markComplete,
          }, Date.now());
          if (markComplete && recorded) {
            done += 1;
            activity.setOneShot(REPULL_METADATA_ACTIVITY_ID, { done, current: item.videoId });
          } else {
            // Either the subs pass didn't complete (retryable -- see
            // `markComplete` above) or the item vanished mid-batch
            // (`recorded === false`, a safe no-op) -- honestly `failed`,
            // never `done`, even though metadata may still have been
            // persisted along the way.
            failed += 1;
            activity.setOneShot(REPULL_METADATA_ACTIVITY_ID, { failed, current: item.videoId });
          }
        } else {
          failed += 1;
          activity.setOneShot(REPULL_METADATA_ACTIVITY_ID, { failed, current: item.videoId });
        }
      } catch (err) {
        // One bad item must never wedge the batch -- log and move on to the
        // next item, exactly like `processSubscription`'s own per-subscription
        // failure boundary.
        failed += 1;
        console.error(`yt-dlp: repull-metadata item ${item.videoId} failed unexpectedly:`, err && err.message);
        activity.setOneShot(REPULL_METADATA_ACTIVITY_ID, { failed, current: item.videoId });
      }
    }

    activity.setOneShot(REPULL_METADATA_ACTIVITY_ID, { state: 'done', current: null });
  } finally {
    // Cleared unconditionally once the batch has fully run its course
    // (finished normally, cancelled, or an unexpected throw escaped past the
    // per-item try/catch above) -- never any earlier, so the concurrency
    // guard above always reflects reality.
    repullMetadataInProgress = false;
  }
}

/**
 * Test-only: reset the reheat's module-level singleton state back to its
 * initial idle values, mirroring `resetPollRerunStateForTests` above. Never
 * used by production code -- a real reheat batch's own `finally` (in
 * `runRepullMetadataBatch`) is what clears `repullMetadataInProgress` in
 * practice; this exists purely so `node:test` files sharing this module's
 * cache across multiple tests in one process never bleed a prior test's
 * "in progress"/"cancelled" latch state into the next.
 */
function resetRepullMetadataStateForTests() {
  repullMetadataInProgress = false;
  repullMetadataCancelled = false;
}

/**
 * Compose a SAFE, persistable `lastStatus` string from a (possibly unsafe)
 * raw error/message. `runList`/`runDownload` (lib/ytdlp/run.js) ALREADY
 * redact the cookies path out of everything they return (SF1) -- but
 * `lastStatus` is what gets PERSISTED to db.json and served back verbatim via
 * `GET /api/subscriptions`, i.e. a leak sink in its own right, so this is a
 * SECOND, independent redaction pass immediately before the value is ever
 * assigned to `lastStatus`. Never trust upstream redaction alone for a value
 * this sensitive -- belt-and-suspenders, matching the SF1 posture elsewhere
 * in this module.
 */
function safeErrorStatus(rawMessage, config) {
  const base = typeof rawMessage === 'string' && rawMessage.trim() !== '' ? rawMessage.trim() : 'unknown error';
  const redacted = run.redactString(base, config && config.cookiesFile);
  const bounded = redacted.length > MAX_STATUS_LENGTH ? `${redacted.slice(0, MAX_STATUS_LENGTH)}...` : redacted;
  return `error: ${bounded}`;
}

// Reads the module-owned download-archive file's raw contents for
// `rules.isArchived`'s dedup pre-check. Missing/unreadable (no downloads have
// ever run yet, or a permissions hiccup) is treated as "nothing archived yet"
// rather than an error -- the poll must still be able to proceed and let
// yt-dlp's own `--download-archive` be the authoritative dedup mechanism
// either way (FR4).
function readArchiveTextSafely(config) {
  try {
    return fs.readFileSync(args.resolveArchivePath(config), 'utf8');
  } catch {
    return '';
  }
}

/**
 * FIX-6 (two-reviewer gate) + QW1 (fast-follow): guard EVERY orchestrator
 * activity write -- both the TERMINAL (done/error) writes and the
 * non-terminal per-cycle `onProgress` patches -- against a subscription that
 * was DELETED mid-cycle. `DELETE /api/subscriptions/:id` calls
 * `activity.clearSubscription(id)` exactly once -- but a
 * `runSubscriptionCycle`/`processSubscription` call already in flight for
 * that id (it captured its own `sub` object before the delete) keeps running
 * right through its own state transitions, which would otherwise call
 * `activity.setSubscription(id, ...)` and silently RE-CREATE an activity
 * entry for an id that no longer has a subscription row. FIX-3's
 * settled-guard (in lib/ytdlp/run.js) closes the analogous window for a LATE
 * `onProgress` dispatch arriving after the download promise has already
 * settled, but it has no idea whether the subscription itself still exists --
 * this guard is what closes THAT window, for both the terminal writes
 * (originally FIX-6) and the in-flight, non-terminal `onProgress` patch
 * (QW1: pre-fix, a progress line landing in the gap between a delete and the
 * cycle's own terminal write could briefly resurrect the deleted id in the
 * status snapshot -- ephemeral-map only, no data loss, but self-inconsistent
 * until the terminal write self-heals it; QW1 closes the window instead of
 * relying on that self-heal).
 *
 * Checked on every call site that writes subscription activity (terminal AND
 * non-terminal) -- a cheap `loadDatabase`-backed existence check is
 * negligible next to the `updateDatabase`/`scanDirectories` calls the same
 * cycle already makes, and progress patches for a single download are not
 * frequent enough (one per parsed yt-dlp progress line) to make this a hot
 * loop. If the subscription is confirmed gone, the write is replaced with an
 * explicit `clearSubscription` so the snapshot can never resurrect it; a
 * `loadDatabase` failure fails OPEN (still writes the status) so a transient
 * read error can never suppress a legitimate status update for a
 * subscription that's still very much alive.
 *
 * FIX 1 (two-reviewer gate, post-v1.24.8): the EXISTENCE check runs FIRST,
 * BEFORE the `cancelledSubscriptionIds` latch check -- reversed from the
 * v1.24.8 ordering, which checked the latch first and could RESURRECT a
 * deleted subscription's activity entry. Repro this closes: cancel
 * subscription X (latches X into `cancelledSubscriptionIds`) -> `DELETE
 * /api/subscriptions/X` (clears X's activity entry and removes its store
 * row) -> the SIGKILLed download's promise later settles `ok:false` ->
 * `runSubscriptionCycle` calls this guard with `{state:'error'}` -- with the
 * latch checked first, that write short-circuited straight to
 * `activity.setSubscription(X, {state:'cancelled'})`, WITHOUT ever
 * re-checking whether X still exists, resurrecting a ghost "Cancelled" row
 * for a channel that no longer exists (subscription activity entries have no
 * TTL, so the ghost persisted until process restart). Existence-first means
 * a subscription that no longer exists is ALWAYS cleared (and returns)
 * regardless of the latch; only once existence is confirmed does the latch
 * get a chance to re-assert `'cancelled'` over a late `state:'error'` write
 * (mirroring the one-shot cancel path's re-assert discipline against
 * `cancelledOneShotJobs`, above) or neutralize a late `onProgress` patch that
 * would otherwise clobber `'cancelled'` back to `'downloading'`.
 * `cancelledSubscriptionIds` is scoped to the CURRENT poll only (cleared in
 * `runPoll`'s `finally`, below), so this can never permanently mute a
 * channel from a future poll.
 */
function guardedSetSubscriptionActivity(deps, subId, patch) {
  let stillExists = true;
  try {
    stillExists = store.listSubscriptions(deps).some((s) => s.id === subId);
  } catch {
    stillExists = true; // fail-open: never suppress a legitimate status write over a read hiccup
  }
  if (!stillExists) {
    // A deleted subscription is cleared UNCONDITIONALLY -- even if it was
    // also latched as cancelled -- so its activity entry can never be
    // resurrected by the latch check below (FIX 1).
    activity.clearSubscription(subId);
    return;
  }
  if (cancelledSubscriptionIds.has(subId)) {
    activity.setSubscription(subId, { state: 'cancelled' });
    return;
  }
  activity.setSubscription(subId, patch);
}

/**
 * v1.24.8: the single source of truth both cancel routes (below, inside
 * `registerRoutes`) use to decide whether a subscription id is actually
 * worth adding to `cancelledSubscriptionIds` at all. "Cancellable" means: a
 * LIVE download child is tracked (`activeSubscriptionDownloads`), OR the
 * live activity snapshot currently reports `'queued'` (already committed to
 * THIS poll's targeted loop, not yet spawned -- the loop-skip check in
 * `runPoll`, below, is what actually stops it).
 *
 * Deliberately EXCLUDES `'listing'` and every terminal/absent state:
 * - `'listing'`: that phase's own `run.runList` spawn has no tracked child
 *   handle at all (no `onChild` support -- out of scope for this round, the
 *   same posture as the one-shot module's accepted tech-debt #24
 *   limitation) -- latching it would rewrite its eventual activity write to
 *   `'cancelled'` WITHOUT actually stopping anything underneath, which would
 *   be actively misleading (the download would silently proceed while the
 *   UI claims it was cancelled).
 * - idle / no entry at all (never polled, or already terminal): there is
 *   nothing here to cancel. This is the load-bearing half of the fix --
 *   WITHOUT this check, cancelling an id with nothing in progress would
 *   still unconditionally add it to the shared, poll-scoped
 *   `cancelledSubscriptionIds` latch, where it would sit as an "orphan"
 *   entry, UNCONSUMED (nothing is currently polling it, so nothing will
 *   `continue`-skip it, and no in-flight cycle's write will ever hit the
 *   guard to clear it) until some UNRELATED future poll's `finally` wipes
 *   the WHOLE set -- silently causing THIS subscription's next real poll to
 *   be wrongly skipped if it happens to start before that unrelated
 *   cleanup runs. Never latching an id that isn't genuinely in progress is
 *   what keeps the latch free of orphans in the first place.
 *
 * `snapshot` may be passed in (the stop-all route already computed one for
 * its own filter pass, so it reuses it) or omitted, in which case a fresh
 * one is taken.
 */
function isSubscriptionCancelTarget(id, snapshot) {
  const child = activeSubscriptionDownloads.get(id) || null;
  if (child) return { cancellable: true, child };
  const resolvedSnapshot = snapshot || activity.getSnapshot();
  const entry = resolvedSnapshot.subscriptions[id];
  const state = entry && entry.state;
  return { cancellable: state === 'queued', child: null };
}

/**
 * SF4 defense-in-depth: after a download completes, verify every file that
 * landed directly in the channel dir still resolves (following symlinks)
 * under that same dir's real path -- `resolveChannelDir` + yt-dlp's own
 * `--windows-filenames` (v1.15.0 item 5; previously `--restrict-filenames`)
 * already prevent an escape any other way, so this can
 * only ever trip on a symlink planted inside the channel dir. Anything that
 * fails the check is quarantined (deleted) BEFORE `scanDirectories()` ever
 * runs, so it can never be indexed into the library. Never throws -- a
 * missing/unreadable channel dir yields 0 quarantined, not an error.
 * @returns {number} how many files were quarantined
 */
function quarantineEscapedDownloads(channelDir) {
  let entries;
  try {
    entries = fs.readdirSync(channelDir, { withFileTypes: true });
  } catch {
    return 0; // nothing produced (or the dir doesn't exist) -- nothing to quarantine
  }
  let quarantined = 0;
  for (const entry of entries) {
    // A symlink dirent reports `isFile() === false` (its own d_type is
    // DT_LNK, not DT_REG) -- but a symlink pointing outside the channel dir
    // is EXACTLY the escape this check exists to catch, so it must not be
    // skipped here. Plain directories are skipped and NOT recursed into --
    // this is a deliberate, documented assumption (T4 fix-round low-tail),
    // not an oversight: `OUTPUT_TEMPLATE` (lib/ytdlp/args.js) has no `/` in
    // it, so yt-dlp's `-o` template is FLAT -- every file it writes lands
    // directly in `channelDir`, never in a subdirectory. If a future template
    // change ever introduces nested output paths, this function's coverage
    // would need to recurse too (see the accompanying test asserting this
    // flat-output assumption).
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;
    const fullPath = path.join(channelDir, entry.name);
    if (!args.realpathUnderChannelDir(fullPath, channelDir)) {
      try {
        fs.unlinkSync(fullPath);
        quarantined += 1;
        console.error(`yt-dlp: quarantined a downloaded file that resolved outside its confined channel dir: ${entry.name}`);
      } catch (err) {
        console.error(`yt-dlp: failed to quarantine an escaped file (${entry.name}):`, err && err.code);
      }
    }
  }
  return quarantined;
}

/**
 * v1.15.1 hotfix: best-effort cleanup of yt-dlp's OWN intermediate/partial-
 * download artifacts (merge temps, per-format fragments, `.part`/`.ytdl`
 * markers -- see lib/ytdlpIntermediates.js) left in `channelDir` after a
 * download FAILS or times out (e.g. the download-timeout SIGKILL on a
 * multi-gigabyte video). This is defense-in-depth ON TOP OF server.js's
 * scan-time exclusion (which already stops these being INDEXED) -- this
 * stops them from lingering on disk at all. Never throws: a missing/
 * unreadable dir yields 0 removed, and a per-file unlink failure is logged
 * and skipped, never propagated -- a cleanup failure must NEVER fail the
 * caller's own download-failure handling. Only files matching the
 * intermediate shape are ever removed; a completed/final file is always left
 * untouched.
 * @returns {number} how many intermediate files were removed
 */
function cleanupFailedDownloadIntermediates(channelDir) {
  let entries;
  try {
    entries = fs.readdirSync(channelDir, { withFileTypes: true });
  } catch {
    return 0; // nothing produced (or the dir doesn't exist) -- nothing to clean up
  }
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!isYtdlpIntermediate(entry.name)) continue;
    const fullPath = path.join(channelDir, entry.name);
    try {
      fs.unlinkSync(fullPath);
      removed += 1;
    } catch (err) {
      console.error(`yt-dlp: failed to clean up an intermediate file after a failed download (${entry.name}):`, err && err.code);
    }
  }
  return removed;
}

/**
 * v1.20.0 FR-2: persist every captured (untrusted) channel-meta entry a
 * download spawn returned (`run.runDownload`'s `channelMeta` array -- see
 * lib/ytdlp/run.js's `parseChannelMetaLine`) into `db.ytdlp.downloadMeta`,
 * via `store.recordDownloadChannelMeta` (which runs the SECURITY-CRITICAL
 * `sanitizeCapturedChannelMeta` gate before anything is written). Shared by
 * both `runSubscriptionCycle` and `runOneShot` below -- neither orchestrator
 * re-implements the persistence/validation logic itself.
 *
 * v1.24.0 C6 (T11, Wave 3): ALSO best-effort backfills the MATCHING
 * subscription's own `channelAvatarUrl` (`store.recordSubscriptionChannelAvatar`)
 * from this same captured entry -- independent of whether the per-video
 * `downloadMeta` write above succeeded, since a subscription-level avatar is
 * useful even when, say, this particular entry's videoId already had a
 * `downloadMeta` entry recorded earlier. Re-sanitizes via the SAME
 * `store.sanitizeCapturedChannelMeta` gate `recordDownloadChannelMeta` already
 * ran internally -- cheap (pure, synchronous, no I/O) and keeps this call
 * site never trusting a raw entry field directly, matching this module's
 * re-validate-at-every-boundary posture. One-off downloads (no subscription)
 * simply never match any subscription's `channelUrl` here -- a silent no-op,
 * never an error.
 *
 * PRODUCER NOTE (T11 completion, Wave 3): `entry.channelThumbnail`/
 * `entry.releaseDate`/`entry.uploadDate` are the raw input keys
 * `store.sanitizeCapturedChannelMeta` reads (see `args.js`'s widened
 * `CHANNEL_META_PRINT_TEMPLATE`) -- `lib/ytdlp/run.js`'s `parseChannelMetaLine`
 * now surfaces all three on its returned object too, so this whole
 * C5-ytdlp/C6 pipeline is wired end-to-end for a real download (previously a
 * gap: `parseChannelMetaLine` returned only its original five fields, making
 * this pipeline unit-tested but functionally inert for real downloads).
 *
 * Never throws: a single entry's persistence failing (a rare
 * `updateDatabase` write error) is logged and skipped, never allowed to fail
 * the download itself -- the download already succeeded by the time this
 * runs, and losing a channel-identity capture is far cheaper than reporting
 * a completed download as an error.
 * @param {object} deps `{ updateDatabase, ... }`
 * @param {*} channelMeta the raw `channelMeta` array from a download result
 * @returns {Promise<Set<string>>} the set of videoIds successfully recorded
 */
async function persistCapturedChannelMeta(deps, channelMeta) {
  const recordedIds = new Set();
  for (const entry of Array.isArray(channelMeta) ? channelMeta : []) {
    try {
      const recorded = await store.recordDownloadChannelMeta(deps, entry);
      if (recorded && entry && typeof entry.videoId === 'string') recordedIds.add(entry.videoId);
      const sanitized = store.sanitizeCapturedChannelMeta(entry);
      if (sanitized && sanitized.channelAvatarUrl) {
        await store.recordSubscriptionChannelAvatar(deps, sanitized.channelUrl, sanitized.channelAvatarUrl);
      }
    } catch (err) {
      console.error('yt-dlp: failed to record captured channel metadata for a downloaded video (continuing):', err && err.message);
    }
  }
  return recordedIds;
}

// v1.24.0 A2 (T14): a title is only ever worth attaching to a failure entry
// when it is a genuine, bounded, control-char-free string -- same defensive
// posture as failures.js's own `sanitizeReason` (this is display text for an
// unauthenticated, ephemeral status snapshot, never persisted). Returns
// `undefined` (never `''`/`null`) for anything unusable, so a caller can
// spread it in with `...(title ? { title } : {})` and get a field that is
// cleanly ABSENT rather than empty.
const MAX_FAILURE_TITLE_LENGTH = 200;
function sanitizeFailureTitle(raw) {
  if (typeof raw !== 'string') return undefined;
  // eslint-disable-next-line no-control-regex
  const stripped = raw.replace(/[\x00-\x1f\x7f]/g, '').trim();
  if (stripped === '') return undefined;
  return stripped.length > MAX_FAILURE_TITLE_LENGTH ? stripped.slice(0, MAX_FAILURE_TITLE_LENGTH) : stripped;
}

/**
 * v1.24.0 A2 (T14): map a download spawn's captured `itemFailures` (raw
 * `{videoId, reason}` pairs from `run.js`'s bounded, already-redacted
 * per-item ERROR-line capture -- see lib/ytdlp/failures.js's
 * `parseItemFailureLine`) onto the activity LiveEntry shape this cycle
 * exposes: `{videoId, title?, reason}`. `title`, when available, comes from
 * THIS cycle's own already-fetched `--dump-json` video list (`videos`, the
 * SAME array the survivor filter in `runSubscriptionCycle` walked) -- never
 * a second yt-dlp call or a second source of truth. An unattributed failure
 * (`videoId: null` -- see failures.js's "never misattribute" doc comment)
 * has no id to look a title up by and is passed through with no `title`
 * field, never dropped. Pure (no I/O); returns `[]` for anything that isn't
 * a non-empty array, so a caller can safely omit the `failures` field
 * entirely when this returns empty (backward-compatible: absent when
 * nothing failed).
 */
function mapItemFailuresForActivity(itemFailures, videos) {
  if (!Array.isArray(itemFailures) || itemFailures.length === 0) return [];
  const titleById = new Map();
  for (const video of Array.isArray(videos) ? videos : []) {
    const id = video && typeof video.id === 'string' ? video.id : null;
    const title = sanitizeFailureTitle(video && video.title);
    if (id && title && !titleById.has(id)) titleById.set(id, title);
  }
  return itemFailures
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => {
      const videoId = typeof entry.videoId === 'string' && entry.videoId !== '' ? entry.videoId : null;
      const reason = typeof entry.reason === 'string' ? entry.reason : '';
      const title = videoId ? titleById.get(videoId) : undefined;
      return title ? { videoId, title, reason } : { videoId, reason };
    });
}

/**
 * Run one subscription's list -> filter -> download -> confinement cycle and
 * return the SAFE status string to persist. May throw (a builder/validation
 * error, an unexpected rejection) -- the caller (`processSubscription`)
 * wraps this in its own try/catch, so a throw here is just another path to a
 * safe `error: ...` status, never a crash.
 *
 * C1 (T4 fix round): the filter loop below no longer just counts survivors --
 * it collects their IDS into `survivorIds`, which is handed to
 * `run.runDownload` as the literal, structurally-binding download target set
 * (via `url.isSafeVideoId`/`args.buildYtdlpDownloadArgs`'s per-id `watch?v=`
 * URLs). A deferred (`is_live`/`is_upcoming`) or skipped (members-only/
 * restricted/unrecognized) video's id is NEVER pushed here, so it can never
 * be fetched by the download child no matter what `sub.channelUrl` is -- this
 * is what closes both the premiere-hang and members-only-bypass breaches
 * structurally rather than advisorily.
 *
 * Concurrency note (the v1.9.0 lesson): NOTHING in this function touches
 * `updateDatabase` -- `runList`/`runDownload` are plain awaited child-process
 * calls, and `store.getAllowMembersOnly` is a read-only `loadDatabase` call
 * (no lock). The ONLY `updateDatabase` call for this subscription happens in
 * `processSubscription`, AFTER this function has fully settled -- so the
 * serialized-writer lock is never held across a `runList`/`runDownload`
 * await.
 */
async function runSubscriptionCycle(deps, config, sub) {
  // FR-E: state transitions are driven by THIS orchestrator, never by the
  // pure progress parser (lib/ytdlp/progress.js) -- see that file's own
  // module comment. `listing` covers the metadata (`--dump-json`) pass.
  activity.setSubscription(sub.id, { state: 'listing' });
  const listResult = await run.runList(sub, config);
  if (!listResult.ok) {
    const status = safeErrorStatus(listResult.error, config);
    // FIX-6: terminal write guarded -- see guardedSetSubscriptionActivity's
    // doc comment.
    // FIX-3 (two-reviewer gate): ALWAYS write `failures` (empty here -- a
    // listing failure never reaches the per-item attribution step below) so
    // this settle CLEARS any `failures[]` a PRIOR error cycle's download
    // branch left behind. `activity.js`'s `mergeEntry` shallow-merges and
    // never clears a field on its own -- an error write that omits the key
    // entirely would let a stale, no-longer-relevant failure list keep
    // rendering under this cycle's own (unrelated) error.
    guardedSetSubscriptionActivity(deps, sub.id, { state: 'error', error: status, failures: [] });
    return status;
  }

  const videos = rules.parseYtdlpVideoList(listResult.stdout);
  const archiveText = readArchiveTextSafely(config);
  const allowMembersOnly = Boolean(store.getAllowMembersOnly(deps));
  // C4: the SAME "cookies actually usable" predicate `args.cookiesArgs` uses
  // (a single `fs.existsSync` check) -- a set-but-unmounted cookies path now
  // reads as "not usable" here too, so a members-only video is cleanly
  // skipped rather than surviving into a doomed download.
  const cookiesConfigured = args.cookiesUsable(config);

  const survivorIds = [];
  // D5: a Set of ids already accepted this cycle -- yt-dlp can list the SAME
  // video under multiple tabs/playlists in one channel dump (e.g. "Videos"
  // and "Live"), and both copies would otherwise pass every filter and be
  // pushed twice, inflating the "downloaded N new video(s)" count and adding
  // a duplicate `watch?v=<id>` positional to the download args for no reason
  // (`--download-archive` would still dedup the actual download, but the
  // status/count and the argv itself must not lie about it).
  const seenSurvivorIds = new Set();
  for (const video of videos) {
    const id = video && typeof video.id === 'string' ? video.id : null;
    // C2: prefer yt-dlp's own lowercase `video.extractor` over the TitleCase
    // `extractor_key` -- `rules.isArchived`'s own case-insensitive compare
    // (below) is a second, independent layer of the same fix.
    const extractor = (video && (video.extractor || video.extractor_key)) || 'youtube';

    // Filter order (doc-reconciled, T4 fix-round low-tail): dedup ->
    // members/availability skip -> premiere-defer. A video that fails an
    // earlier check is never evaluated against a later one. The order
    // between skip and defer is behaviorally immaterial (independent, pure
    // drop decisions) -- this order matches the exec plan's Design section.
    if (id && rules.isArchived(archiveText, extractor, id)) continue;
    const decision = rules.shouldSkip(video, { allowMembersOnly, cookiesConfigured });
    if (decision.skip) {
      // D6 (T4 fix round #2, REVERSES a round-#1 low-tail item): `availability`
      // is a non-secret yt-dlp enum (`subscriber_only`/`needs_auth`/...) --
      // logging it plainly costs nothing security-wise and gives an operator
      // the actual skip reason to debug against. The ONLY redaction that
      // matters in this module is SF1's cookies-path scrubbing, which this
      // line never touches.
      console.log(`yt-dlp: skipping video ${id || '(unknown id)'} for subscription ${sub.id}: ${decision.reason}`);
      continue;
    }
    if (rules.shouldDeferPremiere(video, Date.now())) continue;

    // v1.15.0 item 4: BINDING Shorts exclusion (the `--match-filter` in
    // `args.buildYtdlpListArgs` is defense-in-depth only, applied on the LIST
    // pass -- THIS is what structurally keeps a Short out of the download
    // target set, same as the members-only/premiere filters above). Strict
    // `=== true` re-assert -- a truthy-but-non-`true` `skipShorts` value
    // never triggers exclusion.
    if (sub.skipShorts === true && rules.isShort(video)) {
      console.log(`yt-dlp: skipping Short ${id || '(unknown id)'} for subscription ${sub.id} (skipShorts enabled)`);
      continue;
    }

    // C1: a survivor can only ever be individually targeted by the download
    // spawn if it has a charset/length-safe id -- re-asserted here via the
    // SAME predicate `args.js`'s builder will apply again before it can
    // become a `watch?v=` URL. A survivor lacking one is skipped-and-logged
    // (fail-safe: it simply can never be targeted, never silently dropped
    // into a whole-channel fallback).
    if (!id || !url.isSafeVideoId(id)) {
      console.log(`yt-dlp: skipping a video with an unusable/unsafe id for subscription ${sub.id} (cannot be individually targeted)`);
      continue;
    }
    if (seenSurvivorIds.has(id)) continue; // D5: de-dupe -- already accepted this id this cycle
    seenSurvivorIds.add(id);
    survivorIds.push(id);
  }

  if (survivorIds.length === 0) {
    // FIX-6: terminal write guarded.
    guardedSetSubscriptionActivity(deps, sub.id, { state: 'done', percent: 100 });
    return 'ok: no new videos';
  }

  // FR-E: `total` is set BEFORE the download await so the very first status
  // poll after this point already reflects the real target count; `index`
  // starts at 0 (yt-dlp's own `Downloading item N of M` progress lines --
  // parsed by lib/ytdlp/progress.js -- update it as the download proceeds).
  activity.setSubscription(sub.id, { state: 'downloading', total: survivorIds.length, index: 0, percent: 0 });
  // QW1: gate every non-terminal progress patch through the same
  // existence-guard as the terminal writes below (see
  // `guardedSetSubscriptionActivity`'s doc comment) -- otherwise a progress
  // line arriving after the subscription was deleted mid-download would
  // briefly recreate the deleted id's activity entry.
  const onProgress = (patch) => guardedSetSubscriptionActivity(deps, sub.id, patch);

  // ONE `runDownload` call, scoped to exactly `survivorIds` (C1) --
  // `--download-archive` still dedups within that set and remains the single
  // authoritative dedup mechanism (FR4); the JS `isArchived` pre-check above
  // is a redundant-but-cheap short-circuit, not a second source of truth.
  //
  // v1.24.8: `onChild` registers the live handle into
  // `activeSubscriptionDownloads` (above) the instant `run.js` actually
  // spawns it -- BEFORE this `await` resolves -- so `POST
  // /api/subscriptions/:id/cancel` (and the stop-all route) can find it for
  // the entire time this subscription's download is in flight. The `finally`
  // deletes it unconditionally the moment `run.runDownload`'s own promise
  // settles (success, failure, or a stream-level rejection): a child that
  // has already exited has nothing left to cancel, and this is the ONLY
  // place that ever removes an `activeSubscriptionDownloads` entry, closing
  // every leak path -- mirrors `runOneShot`'s identical
  // `activeOneShotChildren` registration/cleanup exactly.
  let downloadResult;
  try {
    downloadResult = await run.runDownload(sub, config, survivorIds, {
      onProgress,
      onChild: (child) => activeSubscriptionDownloads.set(sub.id, child),
    });
  } finally {
    activeSubscriptionDownloads.delete(sub.id);
  }

  // C6: confinement quarantine runs on EVERY path -- success AND failure --
  // BEFORE this function returns (and therefore before `processSubscription`'s
  // `scanDirectories()` trigger). Previously an early return on
  // `!downloadResult.ok` skipped this entirely, so a path-escaping symlink
  // produced by a partial-success-then-nonzero-exit download could still be
  // indexed by the unconditional post-poll scan.
  let quarantined = 0;
  try {
    const channelDir = args.resolveChannelDir(config, sub);
    quarantined = quarantineEscapedDownloads(channelDir);
  } catch (err) {
    // The confinement check itself failing (e.g. the dir vanished between
    // download and check) must not be reported as a download failure -- log
    // it distinctly and fall through to the download's own ok/error status.
    console.error(`yt-dlp: post-download confinement check failed for subscription ${sub.id}:`, err && err.code);
  }

  if (!downloadResult.ok) {
    // v1.15.1 hotfix: best-effort cleanup of any intermediate/partial
    // artifacts the failed/timed-out download left behind -- see
    // `cleanupFailedDownloadIntermediates`'s doc comment. Wrapped again here
    // (on top of that function's own internal guards) so a cleanup failure
    // can never be reported as -- or suppress -- the download's own error
    // status.
    try {
      const channelDir = args.resolveChannelDir(config, sub);
      cleanupFailedDownloadIntermediates(channelDir);
    } catch (err) {
      console.error(`yt-dlp: post-failure intermediate cleanup failed for subscription ${sub.id}:`, err && err.code);
    }
    let status = safeErrorStatus(downloadResult.error, config);
    // Two-reviewer gate (post-v1.24.8): a user-cancelled download must not
    // PERSIST a misleading synthesized error. `guardedSetSubscriptionActivity`
    // (below) already corrects the EPHEMERAL activity snapshot to
    // `'cancelled'` via its latch check, but this `status` value is what
    // `processSubscription` persists verbatim as the subscription's durable
    // `lastStatus` (survives a restart, and renders on /subscriptions
    // whenever no live snapshot masks it) -- without this, a cancelled
    // download's SIGKILL would persist as e.g. `"error: yt-dlp exited with
    // code SIGKILL"`, a false failure for a deliberate user action. Checked
    // here (rather than only relying on the ephemeral guard) since this
    // `status` is also this function's RETURN value, independent of
    // whatever the activity write below ends up doing with its own patch.
    if (cancelledSubscriptionIds.has(sub.id)) {
      status = 'cancelled';
    }
    // v1.24.0 A2 (T14): map whatever per-item failures `run.runDownload`
    // attributed (or surfaced as unattributed) onto this LiveEntry -- see
    // `mapItemFailuresForActivity`'s doc comment above. `activity.setSubscription`
    // (called by `guardedSetSubscriptionActivity` below) shallow-merges
    // (`activity.js`'s `mergeEntry`), so this needs no `activity.js` change.
    // FIX-3 (two-reviewer gate, post-release, REVISES the original A2
    // comment here): the `failures` field is now ALWAYS written on this
    // error settle -- `failures: []` when nothing was attributable this
    // cycle, never an omitted key -- so a later error cycle without any
    // attribution correctly CLEARS an earlier cycle's stale `failures[]`
    // instead of leaving it to survive under `mergeEntry`'s shallow merge
    // (mergeEntry never clears a field on its own). Reproduction this
    // closes: cycle 1 errors with an attributed failure; cycle 2 errors
    // again with NO attribution (e.g. a listing/network failure) -- pre-fix,
    // cycle 1's stale failure entry kept rendering under cycle 2's
    // unrelated error. The listing-error branch above, and
    // `processSubscription`'s catch-all below, write `failures: []`
    // directly (they never have per-item attribution to map in the first
    // place); this branch is the only one that can have a non-empty list.
    const failures = mapItemFailuresForActivity(downloadResult.itemFailures, videos);
    // FIX-6: terminal write guarded.
    guardedSetSubscriptionActivity(deps, sub.id, {
      state: 'error',
      error: status,
      failures,
    });
    return status;
  }

  // v1.20.0 FR-2: persist captured channel identity for this download.
  // Anything `run.runDownload` captured (validated/sanitized inside
  // `store.recordDownloadChannelMeta`) is recorded first; for any survivor
  // capture produced NOTHING usable for (a missing/malformed/hostile print
  // line -- dropped by the sanitizer), this subscription's OWN
  // already-validated `channelUrl`/`name` is recorded as a fallback, keyed by
  // that survivor id -- so a subscription download always ends up with at
  // least the subscription's own identity. This never affects the download's
  // own success/failure status.
  //
  // v1.24.0 C6 (T11): the fallback ALSO threads the subscription's own,
  // already-backfilled `channelAvatarUrl` (see `persistCapturedChannelMeta`
  // above -- absent until a PRIOR download for this same subscription
  // captured one) through as the raw `channelThumbnail` input field
  // `store.sanitizeCapturedChannelMeta` expects -- re-validated by that same
  // gate before it is ever persisted, never trusted as-is even though it
  // already passed validation once when it was first written onto `sub`.
  // Guarded to only include the key when a value is actually present, so a
  // subscription with no captured avatar yet behaves EXACTLY as before this
  // change (no new field on the fallback entry at all).
  const recordedIds = await persistCapturedChannelMeta(deps, downloadResult.channelMeta);
  for (const survivorId of survivorIds) {
    if (recordedIds.has(survivorId)) continue;
    try {
      await store.recordDownloadChannelMeta(deps, {
        videoId: survivorId,
        channelUrl: sub.channelUrl,
        channelName: sub.name,
        ...(typeof sub.channelAvatarUrl === 'string' && sub.channelAvatarUrl !== '' ? { channelThumbnail: sub.channelAvatarUrl } : {}),
      });
    } catch (err) {
      console.error(`yt-dlp: failed to record fallback channel metadata for subscription ${sub.id} survivor ${survivorId} (continuing):`, err && err.message);
    }
  }

  // FIX-6: terminal write guarded.
  guardedSetSubscriptionActivity(deps, sub.id, { state: 'done', percent: 100 });
  if (quarantined > 0) {
    return `ok: downloaded, but ${quarantined} file(s) quarantined (path confinement)`;
  }

  return `ok: downloaded ${survivorIds.length} new video(s)`;
}

/**
 * Process exactly one subscription: run its cycle, persist a SAFE status,
 * and trigger a scan -- and NEVER reject, no matter what fails inside. This
 * is what lets `runPoll`'s sequential loop continue to the next subscription
 * after any single one fails (NFR5, the v1.9.0 "log and degrade, never
 * crash/wedge" lesson): every failure mode (a thrown builder error, a
 * `runList`/`runDownload` `ok:false`, a `setSubscriptionStatus` rejection, a
 * `scanDirectories` rejection) is caught in place and logged, never allowed
 * to propagate out of this function.
 *
 * FIX 1 (two-reviewer gate, post-v1.25.0): also decides whether THIS cycle
 * qualifies to advance `sub.cutoffDate` forward to "today" -- closing the
 * blocker where a fixed `cutoffDate` made every future poll re-LIST
 * (`--dump-json`, unbounded growth) every video published since the
 * ORIGINAL cutoff, forever, rather than just since the last successful poll.
 *
 * `lastStatus` is ALREADY the single source of truth for this cycle's
 * outcome -- `runSubscriptionCycle`'s every return path is one of exactly
 * two shapes: an `'ok: ...'`-prefixed string (listing succeeded, and either
 * there was nothing new to download or the download itself fully succeeded
 * -- see that function's own doc comment for its filter/download/quarantine
 * ordering) or a non-`'ok'` string (`'error: ...'` from a listing failure, a
 * download failure, or a thrown builder error; or the literal `'cancelled'`
 * for a user-cancelled download). So "reached a SUCCESSFUL terminal state
 * AND no video in this cycle failed to download" reduces to exactly one
 * check: does `lastStatus` start with `'ok'`. When in doubt (any error,
 * any cancel), `advanceToCutoffDate` stays `undefined` -- `cutoffDate` is
 * left completely unchanged (the safe default: a slightly wider next list,
 * never a missed video).
 *
 * `nowMs` (mirrors the T1 `nowMs = Date.now()` pattern) is an OPTIONAL
 * injected "current time," threaded down from `runPoll`, purely so this
 * advance is deterministic/testable -- it does not affect `lastCheckedAt`
 * (still the real wall clock at write time, unchanged behavior).
 */
async function processSubscription(deps, config, sub, nowMs = Date.now()) {
  let lastStatus = 'ok';
  try {
    lastStatus = await runSubscriptionCycle(deps, config, sub);
  } catch (err) {
    const message = err && typeof err.message === 'string' ? err.message : String(err);
    lastStatus = safeErrorStatus(message, config);
    // FR-E: a THROW out of runSubscriptionCycle (e.g. a builder error) is a
    // failure mode its own internal `error` transitions above don't cover --
    // this is the catch-all so the live status always reflects the terminal
    // outcome, never left stuck on whatever transient state preceded the throw.
    // FIX-6: terminal write guarded. FIX-3: `failures: []` -- see the
    // download-error branch's doc comment above for why an error settle must
    // always write this field rather than omit it.
    if (sub && sub.id) guardedSetSubscriptionActivity(deps, sub.id, { state: 'error', error: lastStatus, failures: [] });
    console.error(`yt-dlp: poll failed for subscription ${sub && sub.id} (logging and continuing to the next subscription):`, lastStatus);
  }

  // FIX 1: advance to TODAY (inclusive -- `--dateafter` is `>=`, so a video
  // published later today is still caught next poll), never further.
  // `store.setSubscriptionStatus` itself ALSO guards against moving
  // `cutoffDate` backward (defense-in-depth, see its own doc comment) -- this
  // check is what decides whether to attempt the advance at all.
  const advanceCutoffDate = typeof lastStatus === 'string' && lastStatus.startsWith('ok')
    ? store.formatYyyymmdd(nowMs)
    : undefined;

  try {
    await store.setSubscriptionStatus(deps, sub.id, {
      lastCheckedAt: new Date().toISOString(),
      lastStatus,
      ...(advanceCutoffDate !== undefined ? { cutoffDate: advanceCutoffDate } : {}),
    });
  } catch (err) {
    // The status WRITE itself failing (a saveDatabase error, etc.) must still
    // never wedge the loop -- log and move on to the scan trigger/next sub.
    console.error(`yt-dlp: failed to persist poll status for subscription ${sub && sub.id}:`, err && err.message);
  }

  // Trigger the EXISTING coalescing scan entry point so any newly downloaded
  // files are indexed into the normal media library (AC17) -- fire-and-forget
  // outside any lock, mirroring server.js's own
  // `scanDirectories().catch(console.error)` call sites. A scan failure here
  // must never crash/hang this poll either.
  if (deps && typeof deps.scanDirectories === 'function') {
    Promise.resolve()
      .then(() => deps.scanDirectories())
      .catch((err) => console.error('yt-dlp: post-poll scan trigger failed:', err && err.message));
  }
}

/**
 * The download-loop orchestrator. `subId` omitted (or null/undefined) polls
 * EVERY subscription; a specific `subId` polls just that one (the "re-pull
 * one" case). Subscriptions are processed SEQUENTIALLY, one channel at a
 * time (single-worker posture, like the existing transcode queue) -- never
 * `Promise.all`/parallel spawns, so a home server is never asked to run
 * several yt-dlp child processes at once.
 *
 * Returns `{ started: false, reason: 'not-found' }` if `subId` doesn't match
 * any subscription (callers map this to a 404) -- checked FIRST (D4, T4 fix
 * round #2), before the busy-coalesce path, so a bogus id can never arm a
 * spurious follow-up poll (or coalesce into someone else's) just because a
 * different poll happened to be in flight. Otherwise returns
 * `{ started: false, reason: 'busy' }` if a poll is already running (the
 * overlap guard coalesced this trigger -- see D3 below); otherwise
 * `{ started: true, count }` once every targeted subscription has been
 * processed (each one already had its own status persisted and scan
 * triggered by the time this resolves).
 *
 * `nowMs` (FIX 1, two-reviewer gate, mirrors the T1 `nowMs = Date.now()`
 * pattern) is an OPTIONAL injected "current time," threaded straight down to
 * every `processSubscription` call this poll makes -- purely so a qualifying
 * cycle's `cutoffDate` advance (see that function's own doc comment) is
 * deterministic/testable. Every real (non-test) call site omits it and gets
 * the real wall clock, unchanged behavior.
 */
async function runPoll(deps, config, subId, nowMs = Date.now()) {
  // D4: validate the target BEFORE the busy-coalesce path below. This is a
  // synchronous, lock-free read (`store.listSubscriptions` is a plain
  // `loadDatabase` call), so checking it unconditionally -- even while a
  // poll is already busy -- costs nothing and closes the bogus-id-during-a-
  // busy-poll gap: a bogus id must 404 immediately, never coalesce into (or
  // spuriously arm) a follow-up poll for a subscription that doesn't exist.
  const allSubs = store.listSubscriptions(deps);
  let targets = allSubs;
  if (subId !== undefined && subId !== null) {
    const match = allSubs.find((s) => s.id === subId);
    if (!match) return { started: false, reason: 'not-found' };
    targets = [match];
  } else {
    // FR-D: `paused` governs only the AUTOMATIC loop -- the scheduled timer
    // and a general re-pull-all (this `else` branch, the "poll everything"
    // case). A specific `subId` re-pull (the `if` branch above) is a
    // deliberate per-row user action and always runs, paused or not: pause
    // is a documented, intentional override point, not a 409 (design
    // decision, FR-D).
    targets = allSubs.filter((sub) => !sub.paused);
  }

  if (pollBusy) {
    // C5: don't just drop this trigger -- record its target so ONE follow-up
    // poll runs once the in-flight one finishes (see the `finally` block
    // below). D3: the target is now THREADED through rather than always
    // escalating to a full re-pull-all -- a re-pull-one coalesced here re-runs
    // only that subscription; a specific + a general (or two different
    // specific) requests coalescing together escalate to "all" so neither is
    // silently dropped. This matters most under `pollMinutes=0`
    // (manual-only), where a dropped trigger would otherwise never be picked
    // up by anything else.
    console.log('yt-dlp: a poll is already running; this trigger is coalesced into a single follow-up re-run once it finishes');
    requestPollRerun(subId);
    return { started: false, reason: 'busy' };
  }

  pollBusy = true;
  try {
    // FIX-7 (two-reviewer gate): mark every TARGETED subscription 'queued'
    // BEFORE the `runExclusive` await below, not inside its callback. The
    // pre-fix placement (inside the callback, right before each
    // `processSubscription` call) meant a sub only ever showed 'queued' once
    // this poll's OWN turn on the shared FIFO gate actually arrived -- so a
    // poll waiting behind an in-flight ONE-SHOT (NFR2's serialization) looked
    // stale/idle in the status snapshot for the entire time it sat queued,
    // even though a poll was genuinely pending. Setting it here, synchronously
    // before `runExclusive` is even called, makes the snapshot reflect a
    // pending poll immediately, regardless of how long it waits its turn.
    for (const sub of targets) {
      activity.setSubscription(sub.id, { state: 'queued' });
    }
    // FR-A/NFR2: the ENTIRE targeted loop is a SINGLE job on the shared
    // `runExclusive` FIFO (not one job per subscription) -- so a one-shot
    // download queued while a multi-subscription poll is still working
    // through its list waits for the WHOLE poll to finish, never
    // interleaving a spawn between two subscriptions of the same poll. This
    // is what makes "a poll and a one-shot never spawn concurrently"
    // structurally true regardless of how many subscriptions this poll
    // targets.
    await runExclusive(async () => {
      for (const sub of targets) {
        // v1.24.8: a subscription latched by a cancel request (either the
        // per-subscription route or stop-all) is SKIPPED here, before it
        // ever reaches `processSubscription` -- this is what keeps a
        // QUEUED-but-not-yet-spawned subscription from ever spawning a
        // download child at all once it has been cancelled, closing the
        // window `guardedSetSubscriptionActivity`'s latch check alone cannot
        // (that guard only neutralizes a WRITE; it cannot un-spawn a child
        // that hasn't been created yet). The cancel route already cleared
        // this subscription's activity entry -- skipping it here means
        // nothing in this loop ever calls `activity.setSubscription` for it
        // again this poll, so it correctly stays absent from the snapshot.
        if (cancelledSubscriptionIds.has(sub.id)) continue;
        // Intentionally sequential (one channel at a time, never
        // Promise.all/parallelized) -- see the function doc comment above.
        // (The 'queued' transition for every target already happened above,
        // before this callback ever got its turn on the FIFO -- FIX-7.)
        await processSubscription(deps, config, sub, nowMs);
      }
    });
  } finally {
    // Always cleared -- even if a bug somehow let a rejection escape
    // `processSubscription` (it shouldn't; see its own try/catch), the
    // overlap guard must never wedge every future poll permanently.
    pollBusy = false;
    // v1.24.8: the cancel latch is bounded to EXACTLY this poll -- clear it
    // unconditionally now that this poll's targeted loop has fully finished
    // (success or not). A subscription is long-lived (polled again and again
    // by every future scheduled/manual poll), so a latch entry that survived
    // past its own poll would silently and PERMANENTLY mute that channel
    // from ever being polled again -- see `cancelledSubscriptionIds`'s doc
    // comment above. "Queued" only ever exists during an in-flight poll, so
    // any cancel always lands during -- and is fully consumed by -- the poll
    // it targeted.
    cancelledSubscriptionIds.clear();
    // C5+D3+E4: a trigger that arrived while this poll was in flight recorded
    // its target in `pollRerunTarget` above (via `requestPollRerun`, in the
    // busy branch) -- this just ensures exactly ONE unref'd follow-up timer
    // is armed to drain it (never an unbounded queue). E4: this does NOT
    // read/clear `pollRerunTarget` itself -- the timer callback
    // (`schedulePollRerun`, above) is the sole reader/clearer, so it always
    // drains whatever is CURRENTLY pending at fire time, even if that value
    // was updated (or escalated to `RERUN_ALL`) by a request recorded AFTER
    // this `finally` ran but before an already-armed timer fired. A trigger
    // arriving DURING the follow-up itself just re-records a target (via the
    // busy branch of the follow-up's own `runPoll` call) and gets its own
    // single follow-up in turn.
    if (pollRerunTarget !== undefined) {
      schedulePollRerun(deps, config);
    }
  }

  return { started: true, count: targets.length };
}

// Test-observability accessor, mirroring `currentYtdlpPollTimer`/
// `currentScanTimer`: exposes whether a poll is currently in flight without
// reaching into module internals.
function isPollBusy() {
  return pollBusy;
}

// FR-A/NFR2: a shared FIFO gate so the poll loop's spawns and a one-shot
// download's spawn NEVER run concurrently -- both write into the SAME
// `--download-archive` file (lib/ytdlp/args.js's `resolveArchivePath`), and
// yt-dlp's own read-modify-write of that file is not designed to be safe
// against two simultaneous writers. This is a DISTINCT concern from
// `pollBusy`/the coalescing machinery above: `pollBusy` prevents STACKED
// POLLS (a scheduled poll firing while a re-pull-all is still running);
// this gate prevents CONCURRENT SPAWNS across the poll body and a one-shot,
// which `pollBusy` alone cannot do (a one-shot is not a poll and never sets
// `pollBusy`).
//
// A plain promise-chain FIFO: every `runExclusive(fn)` call appends `fn` to
// the shared tail and returns a promise that settles with THAT job's own
// outcome, while the module-level tail always advances to a NEVER-REJECTING
// derivative of it. That second part is the v1.9.0/T4 "never wedge the
// queue" lesson applied here: if a job rejects, the caller who queued it
// still observes the rejection (via the returned promise), but the shared
// tail itself must never carry a rejected state forward -- a failing job can
// never permanently block every later job queued behind it. No queue-depth
// limit is enforced by `runExclusive` itself at this scale (a home-server
// operator, or the poll loop, triggers at most a handful of these a minute) --
// FIX-10 (two-reviewer gate, LOW) instead adds a modest cap SPECIFICALLY at
// the one-shot HTTP route (`POST /api/ytdlp/download`, below), since that is
// the one entry point an unauthenticated LAN caller can hit repeatedly/
// programmatically; see `MAX_ONESHOT_QUEUE_LENGTH` there.
//
// UNCONTENDED FAST PATH (load-bearing, not just an optimization): when
// nothing else is currently queued, `fn` is invoked SYNCHRONOUSLY, in the
// exact same tick as the `runExclusive(fn)` call -- rather than always
// scheduling it via `somePromise.then(fn)`, which the Promise spec defers to
// a microtask EVEN AGAINST an already-resolved promise. Without this fast
// path, wrapping `runPoll`'s loop in `runExclusive` would insert a mandatory
// microtask hop before the loop's body (and therefore before its first
// `run.runList`/`run.runDownload` call) runs, silently breaking the "an
// async function runs synchronously up to its first `await`" contract a
// large pre-existing test suite (and callers) depend on for the common,
// uncontended case. The gate only ever introduces a real queueing delay when
// a job is ALREADY in flight -- exactly the case it exists to serialize.
let ytdlpTail = Promise.resolve();
let ytdlpQueueLength = 0;
function runExclusive(fn) {
  const wasIdle = ytdlpQueueLength === 0;
  ytdlpQueueLength += 1;
  const settleTail = () => {
    ytdlpQueueLength -= 1;
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
    ytdlpTail = settled.then(settleTail, settleTail);
    return settled;
  }

  const result = ytdlpTail.then(fn, fn);
  ytdlpTail = result.then(settleTail, settleTail);
  return result;
}

/**
 * v1.15.0 item 6 REGRESSION FIX (review-gate item 6): after a successful
 * ONE-OFF download, append this video's id to the SAME shared
 * download-archive file (`args.resolveArchivePath(config)`) that
 * SUBSCRIPTIONS read via `--download-archive` (`buildYtdlpListArgs`) and
 * `rules.isArchived`'s JS pre-check. `buildYtdlpDownloadArgs`'s one-off
 * branch deliberately passes `--no-download-archive` so a fresh one-off of an
 * already-archived id still actually re-downloads (that flag/behavior is
 * UNCHANGED by this fix) -- but that also meant a one-off never RECORDED the
 * id anywhere. If a video is both one-offed and separately subscribed (on a
 * channel whose poll hasn't reached it yet), the next subscription poll would
 * see it as un-archived and download it AGAIN, producing a duplicate library
 * entry. This function closes that gap by recording the id ourselves,
 * immediately after a successful one-off, so a LATER subscription poll
 * correctly skips it -- while the one-off DOWNLOAD pass itself keeps ignoring
 * the archive every time (re-download-on-request is preserved).
 *
 * `classifySingleVideo` (lib/ytdlp/url.js) only ever accepts a YouTube
 * single-video URL, so the extractor for every one-off is always the fixed
 * literal `youtube` (lowercase, matching yt-dlp's own archive-line
 * convention and `rules.isArchived`'s case-insensitive extractor compare).
 *
 * Idempotent: `rules.isArchived` (the SAME predicate the subscription path
 * uses) is consulted first, so running this twice for the same id never
 * grows a duplicate line. Defensive: any failure (a read/write error, a
 * vanished download dir) is logged and swallowed -- NEVER surfaced as a
 * one-off failure, since the download itself already succeeded by the time
 * this runs and losing this dedup optimization is far cheaper than reporting
 * a completed download as an error.
 */
function recordOneShotInArchive(config, videoId) {
  try {
    const archivePath = args.resolveArchivePath(config);
    const existingText = readArchiveTextSafely(config);
    if (rules.isArchived(existingText, 'youtube', videoId)) return; // already recorded -- idempotent no-op
    // The archive lives directly under config.downloadDir, which the
    // download that just succeeded already wrote into -- but mkdir
    // defensively anyway in case this ever runs against a dir that vanished
    // between the download and this call.
    fs.mkdirSync(path.dirname(archivePath), { recursive: true });
    const needsLeadingNewline = existingText.length > 0 && !existingText.endsWith('\n');
    fs.appendFileSync(archivePath, `${needsLeadingNewline ? '\n' : ''}youtube ${videoId}\n`, 'utf8');
  } catch (err) {
    console.error(`yt-dlp: failed to record one-off download ${videoId} in the shared archive (a later subscription poll may re-download it):`, err && err.message);
  }
}

/**
 * v1.25 QoL (T3), RESTRUCTURED by FIX 2 (two-reviewer gate, post-v1.25.0):
 * resolve the one-shot's effective destination folder -- an explicit,
 * already-confined `folder` override when the caller supplied one (the route
 * validated/confined it synchronously before ever responding -- see that
 * route's own comment), else a PROBE of the video's channel identity
 * (`run.probeChannel`), falling back to the fixed `ONE_OFF_FALLBACK_FOLDER`
 * literal when the probe fails or finds nothing.
 *
 * FIX 2: this is now called OUTSIDE `runExclusive` -- BEFORE the download is
 * ever queued onto the shared FIFO gate `runOneShot` (below) and subscription
 * polls both share (see that gate's own module comment for NFR2). Pre-fix,
 * `runOneShot` awaited `run.probeChannel` as its OWN first action while
 * ALREADY holding that gate (the whole of `runOneShot` was wrapped in
 * `runExclusive`) -- so a slow/hung probe (bounded only by the old, 5-minute
 * `DEFAULT_LIST_TIMEOUT_MS`) held the global download/poll gate for up to 5
 * minutes before its own download even started, starving every OTHER queued
 * one-shot or subscription poll behind it. Now the probe runs UNLOCKED (never
 * holds the gate at all -- see `PROBE_TIMEOUT_MS`, `lib/ytdlp/run.js`, for the
 * probe's own, much shorter dedicated timeout, the other half of this fix),
 * and only the resolved `folder` is threaded into the `runExclusive`-wrapped
 * download that follows (the route handler, below, is what wires this
 * ordering: `const folder = await resolveOneOffFolder(...); runExclusive(()
 * => runOneShot(..., { folder }))`).
 *
 * `run.probeChannel` itself never throws/rejects (see its own doc comment);
 * the `try/catch` below is pure defense-in-depth against a future regression
 * of that guarantee, matching this module's "never let a background failure
 * escape uncaught" posture elsewhere.
 *
 * The probed/fallback string is RAW, UNVALIDATED text -- it flows into
 * `args.resolveChannelDir` exactly like a user-supplied folder override
 * always has, inheriting that call's sanitize (`sanitizeChannelName`) +
 * structural path-confinement guarantees; it is never used to build a
 * filesystem path directly. An explicit, non-empty `folder` is returned
 * as-is, WITHOUT ever invoking the probe -- the override always wins and the
 * probe is skipped entirely (unchanged behavior from pre-fix T3).
 * @param {string} watchUrl an ALREADY-VALIDATED single-video watch URL
 * @param {string|null|undefined} folder the caller's explicit override, or
 *   `null`/`undefined` when unresolved (the common case)
 * @param {object} config
 * @param {string} jobId used only for the diagnostic log line on a probe throw
 * @returns {Promise<string>} the resolved, non-empty folder name
 */
async function resolveOneOffFolder(watchUrl, folder, config, jobId) {
  if (typeof folder === 'string' && folder !== '') return folder;
  let probedChannel = null;
  try {
    probedChannel = await run.probeChannel(watchUrl, config);
  } catch (err) {
    // Defense-in-depth only -- `run.probeChannel` itself never rejects.
    console.error(`yt-dlp: one-off channel probe threw unexpectedly for ${jobId} (falling back to '${ONE_OFF_FALLBACK_FOLDER}'):`, err && err.message);
  }
  return typeof probedChannel === 'string' && probedChannel.trim() !== '' ? probedChannel : ONE_OFF_FALLBACK_FOLDER;
}

/**
 * FR-A: the one-shot background download worker. Runs entirely OUTSIDE the
 * HTTP request/response cycle (the route that queues this via `runExclusive`
 * has already responded `202` by the time this starts) -- so this function
 * has its OWN top-level try/catch and MUST NEVER let a rejection escape
 * uncaught: there is no request left to fail, and an unhandled rejection here
 * would crash the whole process (the Express-4 async-crash lesson this
 * codebase has hit before).
 *
 * Builds a SYNTHETIC, non-persisted "sub"-shaped object (`{ id: jobId, name:
 * folder, format, quality, filetype }`) so it can reuse EVERY existing arg-builder/
 * path-confinement/spawn primitive verbatim, exactly the way `store.js`'s
 * persisted subscription records do: `args.resolveChannelDir` (path
 * confinement via `.name`), `run.runDownload` ->
 * `args.buildYtdlpDownloadArgs` (`--windows-filenames`, `--embed-metadata`/
 * `--embed-thumbnail`, `--download-archive` dedup (bypassed for this one-shot
 * path via `opts.oneOff: true` -- v1.15.0 item 6), cookies redaction),
 * `spawnYtdlpDownload`'s timeout+SIGKILL. Nothing here is a second,
 * divergent download path -- it is the SAME one subscriptions use, given a
 * one-video-only target set (`[videoId]`) instead of a whole channel's
 * survivor list.
 *
 * State transitions mirror `runSubscriptionCycle`'s shape (queued was
 * already set by the route before this was queued via `runExclusive`;
 * `downloading` here, `done`/`error` at the end) so the `/subscriptions`
 * page's poll can render a one-shot row the same way it renders a
 * subscription's live status.
 *
 * FIX 2 (two-reviewer gate, post-v1.25.0, REVISES the v1.25 QoL T3 shape):
 * `folder` is now ALWAYS already-resolved by the time this function runs --
 * the caller (the route handler, below) awaits `resolveOneOffFolder` (above)
 * BEFORE ever calling `runExclusive(() => runOneShot(...))`, so the probe
 * itself never runs inside this function (or inside the exclusive section) at
 * all anymore. The `folder || ONE_OFF_FALLBACK_FOLDER` below is pure
 * defense-in-depth against a hostile/buggy caller passing an empty value
 * directly (every real call site always supplies `resolveOneOffFolder`'s own
 * return value, which is never empty) -- it is NOT a second probe path.
 */
async function runOneShot(deps, config, { videoId, watchUrl, format, quality, filetype, folder, jobId }) {
  // Defense-in-depth only -- see this function's own doc comment above.
  const effectiveFolder = typeof folder === 'string' && folder !== '' ? folder : ONE_OFF_FALLBACK_FOLDER;

  // v1.21.0 FR-8 (T7): re-assert format/quality/filetype here too (the route
  // above already set them on the initial 'queued' write) -- mirrors how
  // label/url are already re-asserted on every state transition, so the
  // fields a Retry re-POST needs survive regardless of which write a client
  // happens to observe.
  activity.setOneShot(jobId, {
    state: 'downloading',
    title: null,
    index: 1,
    total: 1,
    percent: 0,
    label: effectiveFolder,
    url: watchUrl,
    format,
    quality,
    filetype,
  });

  try {
    // v1.13.0 item 4: `filetype` rides the same synthetic-sub-shape route
    // format/quality already use -- `args.buildYtdlpDownloadArgs` reads
    // `sub.filetype` (re-asserted via `normalizeFiletype`) exactly the way it
    // reads `sub.format`/`sub.quality`.
    const syntheticSub = { id: jobId, name: effectiveFolder, format, quality, filetype };
    // FIX-1 (two-reviewer gate): a no-op once this job is in the cancelled
    // latch (see `cancelledOneShotJobs`'s doc comment above) -- this drops a
    // late/buffered progress line AT THE SOURCE, so it can never even
    // momentarily flip the UI's live state away from `'cancelled'` in the
    // first place (belt-and-suspenders with the terminal-write re-assert
    // below, which covers a progress line that lands in the narrow window
    // BEFORE the cancel route has added `jobId` to the latch).
    const onProgress = (patch) => {
      if (cancelledOneShotJobs.has(jobId)) return;
      activity.setOneShot(jobId, patch);
    };

    // NFR1/AC 54-58: the SAME download primitive the poll loop uses --
    // arg-array/no-shell, `--` before the positional target, path
    // confinement, `--download-archive` dedup, cookies redaction, timeout +
    // SIGKILL are all inherited from `run.runDownload`/`args.js`, not
    // reimplemented here.
    // v1.15.0 item 6: a one-shot ALWAYS bypasses the shared download-archive
    // (`--no-download-archive` + `--force-overwrites`, built by
    // `args.buildYtdlpDownloadArgs` when `opts.oneOff` is `true`) -- an
    // explicitly re-requested video must actually re-download (overwriting
    // any existing file) rather than being silently skipped as already-
    // archived. Subscriptions (`runSubscriptionCycle`'s `run.runDownload`
    // call above) never set this, so their archive dedup is unchanged.
    //
    // v1.24.0 A3: `onChild` registers the live handle into
    // `activeOneShotChildren` (above) the instant `run.js` actually spawns
    // it -- BEFORE this `await` resolves -- so the cancel route can find it
    // for the entire time this download is in flight. The `finally` deletes
    // it unconditionally the moment `run.runDownload`'s own promise settles
    // (success, failure, or a stream-level rejection): a child that has
    // already exited has nothing left to cancel, and this is the ONLY place
    // that ever removes an entry, closing every leak path (mirrors the
    // pattern `spawnYtdlpDownload`'s own `settled` guard uses one layer
    // down).
    let downloadResult;
    try {
      downloadResult = await run.runDownload(syntheticSub, config, [videoId], {
        onProgress,
        oneOff: true,
        onChild: (child) => activeOneShotChildren.set(jobId, child),
      });
    } finally {
      // A child that has already exited has nothing left to cancel -- this
      // is the ONLY place that ever removes an `activeOneShotChildren`
      // entry, closing every leak path. (FIX-1: `cancelledOneShotJobs` is
      // DELIBERATELY NOT cleared here -- see the outer `finally` at the
      // bottom of this function for why it must survive past this point.)
      activeOneShotChildren.delete(jobId);
    }

    // SF4: quarantine BEFORE any scan trigger, on BOTH the success AND
    // failure path (C6's lesson from the poll loop -- a partial-success-
    // then-nonzero-exit download can still have produced an escaping
    // symlink that must never be indexed).
    let quarantined = 0;
    try {
      const channelDir = args.resolveChannelDir(config, syntheticSub);
      quarantined = quarantineEscapedDownloads(channelDir);
    } catch (err) {
      console.error(`yt-dlp: post-download confinement check failed for one-shot ${jobId}:`, err && err.code);
    }

    if (!downloadResult.ok) {
      // v1.15.1 hotfix: best-effort cleanup of any intermediate/partial
      // artifacts the failed/timed-out one-shot download left behind -- see
      // `cleanupFailedDownloadIntermediates`'s doc comment. Wrapped again
      // here so a cleanup failure can never be reported as -- or suppress --
      // the download's own error status.
      try {
        const channelDir = args.resolveChannelDir(config, syntheticSub);
        cleanupFailedDownloadIntermediates(channelDir);
      } catch (err) {
        console.error(`yt-dlp: post-failure intermediate cleanup failed for one-shot ${jobId}:`, err && err.code);
      }
      // v1.24.0 A3 / FIX-1 (two-reviewer gate): a cancel request may have
      // already SIGKILLed this exact child and written the terminal
      // 'cancelled' state (see the cancel route below) BEFORE this branch
      // runs -- the kill is delivered synchronously by that route, but the
      // resulting `downloadResult.ok === false` only reaches this `await`
      // afterward, asynchronously. Checks the DURABLE `cancelledOneShotJobs`
      // latch, not a live-state read (see that Set's doc comment for why a
      // live read is not reliable here: a late progress line can clobber the
      // live state back to 'downloading' before this check runs). Never let
      // a cancel be clobbered back to 'error': the user-initiated cancel is
      // the more specific outcome and must win, per the AC's "never error"
      // requirement. Re-asserts 'cancelled' in case a late progress line
      // already flipped the live state before this check ran, so the FINAL
      // state is always, definitively, 'cancelled'.
      if (cancelledOneShotJobs.has(jobId)) {
        activity.setOneShot(jobId, { state: 'cancelled' });
      } else {
        activity.setOneShot(jobId, { state: 'error', error: safeErrorStatus(downloadResult.error, config) });
      }
      return;
    }

    // v1.15.0 item 6 regression fix: record this id in the shared archive
    // NOW that the one-off has actually succeeded, so a later subscription
    // poll of the same video correctly skips it instead of re-downloading a
    // duplicate -- see recordOneShotInArchive's doc comment above. Never
    // throws (fully self-contained try/catch); a failure here must never be
    // reported as a one-off failure, since the download itself already
    // succeeded.
    recordOneShotInArchive(config, videoId);

    // v1.20.0 FR-2: persist whatever channel identity `run.runDownload`
    // captured for this one-shot video (validated/sanitized inside
    // `store.recordDownloadChannelMeta`). Unlike the subscription path
    // above, there is NO fallback here -- a one-shot has no channel known up
    // front, so a capture miss simply leaves the item without identity (it
    // falls to FR-3's hide rule once scanned). Never affects the one-shot's
    // own success/failure status.
    await persistCapturedChannelMeta(deps, downloadResult.channelMeta);

    // Fire-and-forget, exactly like `processSubscription`'s own scan trigger
    // above -- indexing must never block (or be blocked by) this function's
    // own settle, and a scan failure here must never be reported as a
    // download failure.
    if (deps && typeof deps.scanDirectories === 'function') {
      Promise.resolve()
        .then(() => deps.scanDirectories())
        .catch((err) => console.error(`yt-dlp: post-one-shot scan trigger failed for ${jobId}:`, err && err.message));
    }

    activity.setOneShot(jobId, {
      state: 'done',
      percent: 100,
      ...(quarantined > 0 ? { note: `${quarantined} file(s) quarantined (path confinement)` } : {}),
    });
  } catch (err) {
    // MUST have its own try/catch (per this function's doc comment above): a
    // throw here (a builder error, a rejected `scanDirectories` somehow
    // escaping its own `.catch`, etc.) becomes a redacted, persisted-nowhere
    // `error` activity entry -- never an unhandled rejection.
    const message = err && typeof err.message === 'string' ? err.message : String(err);
    const status = safeErrorStatus(message, config);
    console.error(`yt-dlp: one-shot ${jobId} failed unexpectedly:`, status);
    // v1.24.0 A3 / FIX-1: same durable-latch guard as the `!downloadResult.ok`
    // branch above -- never clobber an already-cancelled job back to 'error',
    // and re-assert 'cancelled' in case a late progress line flipped the live
    // state first.
    if (cancelledOneShotJobs.has(jobId)) {
      activity.setOneShot(jobId, { state: 'cancelled' });
    } else {
      activity.setOneShot(jobId, { state: 'error', error: status });
    }
  } finally {
    // FIX-1 (two-reviewer gate): the latch is removed HERE -- once this
    // whole function has fully run its course (the try body's success path,
    // its `!downloadResult.ok` early return, OR the catch block above) --
    // never any earlier. It must NOT be cleared inside the inner
    // `try/finally` around the `run.runDownload` await above: that finally
    // runs BEFORE the `cancelledOneShotJobs.has(jobId)` checks in both the
    // `!downloadResult.ok` branch and this catch block get a chance to read
    // it, which would silently defeat the latch (a real regression this
    // exact structure was caught introducing during development -- covered
    // by the two dedicated cancel-race tests in
    // test/integration/ytdlp-oneshot-cancel.test.js). Scoped to exactly this
    // job's own lifetime, so it can never grow unbounded.
    cancelledOneShotJobs.delete(jobId);
  }
}

/**
 * v1.20.0 FR-4: enrich a subscription (from `store.listSubscriptions`, which
 * stays pure/unchanged) with a computed, READ-ONLY `channelDir` -- the same
 * confined per-channel download directory `args.resolveChannelDir` already
 * derives for the download/quarantine/cleanup call sites above (`config`
 * being in scope only inside the route handler, not inside `store.js`, is
 * exactly why this enrichment happens HERE rather than in `listSubscriptions`
 * itself -- see the exec plan's Design section, FR-4).
 *
 * `resolveChannelDir` THROWS on a confinement failure (see its own doc
 * comment in args.js) -- wrapped in try/catch here so a single malformed/
 * unresolvable subscription can never fail the whole `GET /api/subscriptions`
 * response; that subscription's row is returned WITHOUT a `channelDir` field
 * instead (the client, lib/ytdlp/client/subscriptions.js, treats an absent
 * `channelDir` as "no playlist link for this row" and simply omits it).
 *
 * HARD INVARIANT (two-reviewer gate): this is a per-request, in-memory
 * computation only -- it never calls `updateDatabase`/`saveDatabase` and
 * never writes into `db.folders`/`folderSettings`. The per-channel dir is
 * surfaced to the client purely as a value to build a `/?root=<channelDir>`
 * link from (GET /api/videos's `underFolder` is already a pure path-prefix
 * match, not restricted to `db.folders` entries -- AC19/AC21), so nothing
 * here needs (or is allowed) to touch the synthetic-root/folder model.
 */
function enrichSubscriptionWithChannelDir(config, sub) {
  try {
    return { ...sub, channelDir: args.resolveChannelDir(config, sub) };
  } catch {
    return sub; // confinement/resolution failure -- omit channelDir, never throw the route
  }
}

// ---- v1.24.0 A4 (FR-5): poll-timing helper ---------------------------------
//
// Documents (and makes testable) the CURRENT polling behavior rather than
// adding any new persistence: the poll is armed by `armYtdlpTimer` (below) as
// a `.unref()`'d `setInterval` at `config.pollMinutes` (0 = manual-only, no
// timer -- see `armYtdlpTimer`'s own doc comment). There is no persisted
// "poll cycle START" timestamp; the only durable per-subscription timing
// signal is `sub.lastCheckedAt` (stamped by `runSubscriptionCycle`/`runPoll`
// once a cycle for that subscription FINISHES, see `L581` above). So a
// "next pull due" estimate is necessarily an ESTIMATE, not a guarantee: it is
// simply `lastCheckedAt + the armed interval`, surfaced for display only.

/**
 * Pure helper (A4): estimate the next-due epoch ms for a subscription that
 * was last (successfully or not) checked at `lastCheckedMs`, given the
 * currently-armed poll interval `intervalMs`. Returns `null` -- "no estimate
 * available" -- in either of two cases, both of which the caller/UI should
 * treat identically (never throws on either):
 *   - `intervalMs === 0` (or any non-positive/non-finite value): manual-only
 *     polling is armed (`FILETUBE_YTDLP_POLL_MINUTES=0`), so there is no
 *     scheduled next check to estimate at all.
 *   - `lastCheckedMs` is not a finite number (e.g. a subscription that has
 *     never completed a poll cycle yet, `sub.lastCheckedAt === null`): there
 *     is no baseline timestamp to add the interval to.
 * Otherwise returns `lastCheckedMs + intervalMs` -- a plain epoch ms the
 * client renders as a "next check ~" estimate.
 * @param {number} lastCheckedMs epoch ms of the subscription's last completed
 *   poll cycle (e.g. `Date.parse(sub.lastCheckedAt)`), or any non-finite
 *   value when unknown/never-checked.
 * @param {number} intervalMs the currently-armed poll interval in ms (e.g.
 *   `config.pollMinutes * 60000`), or `0` for manual-only.
 * @returns {number|null} the next-due epoch ms, or `null` when no estimate
 *   applies.
 */
function computeNextPollDue(lastCheckedMs, intervalMs) {
  if (typeof intervalMs !== 'number' || !Number.isFinite(intervalMs) || intervalMs <= 0) return null;
  if (typeof lastCheckedMs !== 'number' || !Number.isFinite(lastCheckedMs)) return null;
  return lastCheckedMs + intervalMs;
}

// ---- v1.24.0 B4 (FR-8): drag-and-drop subscription reorder (route) --------
//
// The store-side reducer/mutator (`store.reduceReorder`/`store.reorderSubscriptions`,
// T7) is deliberately tolerant of a malformed `orderedIds` (never throws,
// degrades safely) but does NOT validate the REQUEST's shape -- exactly like
// every other store mutator in this module (`validateSubscriptionPatch`
// before `updateSubscription`, `validatePinInput` before `addPin`), request-
// shape validation is this route layer's job. `body.orderedIds` must be a
// well-formed array of non-empty strings; anything else is a `400` before
// `store.reorderSubscriptions` (and therefore any `updateDatabase` write) is
// ever reached.

/**
 * Pure request-shape validator for `POST /api/subscriptions/reorder`'s body
 * (B4). Returns `{ ok: true, value: orderedIds }` (the array, unchanged) or
 * `{ ok: false, error }`. Does not know about, or validate against, the
 * actual current subscription list -- `store.reduceReorder` already ignores
 * any id that doesn't match a real subscription and is safe to hand a
 * partial/reordered subset (see its own doc comment) -- this only rejects a
 * request whose `orderedIds` is not even a plausible array of ids.
 * @param {object} body the raw request body.
 * @returns {{ok: boolean, value: (Array<string>|undefined), error: (string|undefined)}}
 */
function validateReorderRequest(body) {
  const input = body && typeof body === 'object' ? body : {};
  const orderedIds = input.orderedIds;
  if (!Array.isArray(orderedIds)) {
    return { ok: false, error: 'orderedIds must be an array of subscription ids' };
  }
  // Generous-but-bounded sanity cap -- mirrors the "reject pathological
  // garbage outright" posture of `MAX_SUB_MAX_VIDEOS`/`MAX_PINS` elsewhere in
  // this module/store.js -- no real subscription list is anywhere near this
  // size; this only guards against a hostile/malformed oversized payload.
  if (orderedIds.length > 5000) {
    return { ok: false, error: 'orderedIds is too long' };
  }
  for (const id of orderedIds) {
    if (typeof id !== 'string' || id.trim() === '') {
      return { ok: false, error: 'orderedIds must be an array of subscription ids' };
    }
  }
  return { ok: true, value: orderedIds };
}

// v1.24.3: PINNED-channel mirror of `validateReorderRequest` immediately
// above -- IDENTICAL shape validation (a well-formed array, sanity-capped at
// 5000, of non-empty strings), kept as its own function rather than a shared
// call so the error text stays accurate ("pin ids", not "subscription ids")
// for `POST /api/subscriptions/pins/reorder`'s 400 response. Does not know
// about, or validate against, the actual current pin list -- exactly like
// `validateReorderRequest`, `store.reducePinReorder` already tolerates a
// partial/hostile id list on its own.
function validatePinReorderRequest(body) {
  const input = body && typeof body === 'object' ? body : {};
  const orderedIds = input.orderedIds;
  if (!Array.isArray(orderedIds)) {
    return { ok: false, error: 'orderedIds must be an array of pin ids' };
  }
  if (orderedIds.length > 5000) {
    return { ok: false, error: 'orderedIds is too long' };
  }
  for (const id of orderedIds) {
    if (typeof id !== 'string' || id.trim() === '') {
      return { ok: false, error: 'orderedIds must be an array of pin ids' };
    }
  }
  return { ok: true, value: orderedIds };
}

// v1.24.3: shared read-time enrichment for the pinned-channel routes --
// REFACTORED out of `GET /api/subscriptions/pins` (originally inline, v1.24.0
// C6) so the new `POST /api/subscriptions/pins/reorder` route below can
// respond with the SAME enriched shape without a second, drifting copy of
// this lookup. A pin record is a bare `{ id, channelDir, label, pinnedAt,
// order }` snapshot and NEVER stores an avatar (see store.js's pin schema).
// The captured `channelAvatarUrl` lives on the matching SUBSCRIPTION record
// (written by `recordSubscriptionChannelAvatar` at download time). Enriched
// here at READ time -- not stored on the pin -- so a later-captured avatar
// shows up on an already-existing pin, and a pin with no matching
// subscription simply falls through to the generated glyph (client-side
// `derivePinnedPlaylistEntries` reads `channelAvatarUrl`). Matched by
// resolved `channelDir` (the SAME key a pin is built from), and re-validated
// through `sanitizeChannelAvatarUrl` again here (defense in depth -- never
// trust a persisted value straight into an `<img src>`).
// @param {object} config parsed yt-dlp config
// @param {object} deps `{ loadDatabase, ... }`
// @param {Array<object>} pins bare pin records (e.g. `store.listPins(deps)`)
// @returns {Array<object>} pins, each optionally carrying `channelAvatarUrl`
function enrichPinsWithChannelAvatar(config, deps, pins) {
  const avatarByChannelDir = new Map();
  for (const sub of store.listSubscriptions(deps)) {
    const enriched = enrichSubscriptionWithChannelDir(config, sub);
    if (!enriched || typeof enriched.channelDir !== 'string' || enriched.channelDir === '') continue;
    if (avatarByChannelDir.has(enriched.channelDir)) continue;
    const safeAvatar = store.sanitizeChannelAvatarUrl(enriched.channelAvatarUrl);
    if (safeAvatar) avatarByChannelDir.set(enriched.channelDir, safeAvatar);
  }
  return (Array.isArray(pins) ? pins : []).map((pin) => {
    const avatar = pin && avatarByChannelDir.get(pin.channelDir);
    return avatar ? { ...pin, channelAvatarUrl: avatar } : pin;
  });
}

/**
 * v1.22.0 FR-2: pure matcher underlying the retroactive, folder-based
 * Subscribe-button backfill (see `backfillChannelIdentityFromFolder`,
 * below). yt-dlp downloads land FLAT directly under
 * `resolveChannelDir(config, sub)` -- `args.js`'s `OUTPUT_TEMPLATE` has no
 * path separator, so every download is a direct child of its channel dir,
 * never nested deeper -- meaning an item's channel dir is always exactly
 * `path.dirname(item.filePath)`.
 *
 * Matches by EXACT directory equality against each already-resolved
 * subscription's `channelDir`, never a `startsWith`/prefix test: a file
 * that merely shares a path PREFIX with a channelDir (e.g. a sibling folder
 * "Some Channel 2" vs. "Some Channel") must never match.
 *
 * @param {string} filePath absolute path of the scanned file being considered
 * @param {Array<{channelDir?: string, channelUrl?: string, name?: string, channelId?: string, channelAvatarUrl?: string}>} resolvedSubs
 *   subscriptions already enriched via `enrichSubscriptionWithChannelDir`
 *   (a subscription that failed confinement/resolution simply has no
 *   `channelDir` field on it and is skipped here, never matched against).
 * @returns {{channelUrl: string, channelName?: string, channelId?: string, channelAvatarUrl?: string} | null}
 *   the matched subscription's identity fields (channelName from `sub.name`,
 *   channelId only if present, channelAvatarUrl -- v1.24.0 C6, RAW/
 *   unvalidated here, same as channelId above -- only if present; the
 *   caller, `backfillChannelIdentityFromFolder`, is responsible for
 *   re-validating it before persisting), or `null` on no match / invalid
 *   input.
 */
function matchChannelDirToSubscription(filePath, resolvedSubs) {
  if (typeof filePath !== 'string' || filePath.trim() === '' || !Array.isArray(resolvedSubs)) return null;
  let fileDir;
  try {
    fileDir = path.dirname(path.resolve(filePath));
  } catch {
    return null;
  }
  for (const sub of resolvedSubs) {
    if (!sub || typeof sub.channelDir !== 'string') continue;
    if (typeof sub.channelUrl !== 'string' || sub.channelUrl.trim() === '') continue;
    if (fileDir !== sub.channelDir) continue;
    const result = { channelUrl: sub.channelUrl };
    if (typeof sub.name === 'string' && sub.name.trim() !== '') result.channelName = sub.name;
    if (typeof sub.channelId === 'string' && sub.channelId.trim() !== '') result.channelId = sub.channelId;
    // v1.24.0 C6: RAW pass-through -- `sub.channelAvatarUrl` was already
    // validated once by `store.recordSubscriptionChannelAvatar` when it was
    // written onto this subscription record, but this function makes no
    // trust claim of its own (see channelId/name above, same posture); the
    // caller re-validates via `store.sanitizeChannelAvatarUrl` before ever
    // persisting it onto an item.
    if (typeof sub.channelAvatarUrl === 'string' && sub.channelAvatarUrl.trim() !== '') {
      result.channelAvatarUrl = sub.channelAvatarUrl;
    }
    return result;
  }
  return null;
}

// v1.22.0 FR-2: per-scan memoization of channelDir-enriched subscriptions,
// keyed by the `fresh` db object a single `updateDatabase(fresh => ...)`
// mutator invocation hands to every item in its loop. server.js's scan
// calls `loadDatabase()` fresh INSIDE every `updateDatabase` invocation (a
// brand-new object each call -- see that function's own doc comment), so a
// `WeakMap` keyed on `fresh` is scan-scoped by construction: a new scan's
// `fresh` object is a new key (no cross-scan leakage), and a `WeakMap` holds
// no strong reference to its keys (no memory-growth risk -- the entry is
// eligible for GC the moment nothing else references that scan's `fresh`
// object anymore).
const resolvedSubsByDb = new WeakMap();

function resolveSubsForBackfill(fresh, config) {
  if (resolvedSubsByDb.has(fresh)) return resolvedSubsByDb.get(fresh);
  const subs = store.ensureYtdlp(fresh).subscriptions;
  const resolved = subs.map((sub) => enrichSubscriptionWithChannelDir(config, sub));
  resolvedSubsByDb.set(fresh, resolved);
  return resolved;
}

/**
 * v1.22.0 FR-2: the retroactive, folder-based channel-identity backfill --
 * the sibling to `consumeDownloadChannelMeta`'s first-scan bridge, but
 * deliberately NOT scoped to `freshlyScannedIds` (server.js's call site owns
 * that scoping decision, plus the never-overwrite/`ytdlpDownloadRoots`
 * guards that must surround every call to this function). Runs for every
 * item server.js chooses to call it for, so it also heals the AC20
 * periodic-scan race: a file the periodic auto-scan indexed before its
 * `downloadMeta` entry was written simply has no `channelUrl` yet, and picks
 * its identity up from its own download folder here on the very next scan --
 * no re-sequencing of the download/scan triggers needed.
 *
 * Re-validates the matched `channelUrl` through the UNMODIFIED
 * `url.validateChannelUrl` before returning it -- defense-in-depth, matching
 * `consumeDownloadChannelMeta`'s own re-validation posture, even though the
 * value is already a subscription's own previously-validated `channelUrl`
 * (a corrupted/hand-edited subscription record that no longer passes is
 * dropped here, never persisted).
 *
 * v1.24.0 C6: also heals a matched subscription's `channelAvatarUrl` onto
 * identity-less old items the same way -- re-validated here (via
 * `store.sanitizeChannelAvatarUrl`, the SAME gate `consumeDownloadChannelMeta`
 * re-checks the print-line-captured avatar through) rather than trusted as
 * already-safe, matching this function's own re-validate-everything posture
 * for `channelUrl` immediately above.
 *
 * @param {object} fresh the db object INSIDE a running `updateDatabase` mutator
 * @param {{filePath?: string}} item a `db.metadata` item being considered
 * @param {object} config parsed yt-dlp config (`parseYtdlpConfig()`)
 * @returns {{channelUrl: string, channelName?: string, channelId?: string, channelAvatarUrl?: string} | null}
 */
function backfillChannelIdentityFromFolder(fresh, item, config) {
  if (!item || typeof item.filePath !== 'string') return null;
  const resolvedSubs = resolveSubsForBackfill(fresh, config);
  if (!resolvedSubs.length) return null;
  const match = matchChannelDirToSubscription(item.filePath, resolvedSubs);
  if (!match) return null;
  const check = url.validateChannelUrl(match.channelUrl);
  if (!check.ok) return null; // fails re-validation -- never persisted (AC18)
  const result = { channelUrl: check.url };
  if (match.channelName) result.channelName = match.channelName;
  if (match.channelId) result.channelId = match.channelId;
  const safeAvatarUrl = store.sanitizeChannelAvatarUrl(match.channelAvatarUrl);
  if (safeAvatarUrl) result.channelAvatarUrl = safeAvatarUrl;
  return result;
}

/**
 * Register the module's routes on `app`. FIRST LINE is the disabled
 * early-return: when off, nothing is added to the router, so every
 * /api/subscriptions* request falls through to Express's native 404 -- this
 * is what makes "disabled == byte-identical to today" provable (there is no
 * route object to 403/redirect/render a disabled page).
 *
 * `deps` ({ updateDatabase, loadDatabase, scanDirectories, getMediaId }) is
 * accepted now, even though T1's only route (/health) doesn't use it, so the
 * CRUD/poll routes T2-T4 add don't require re-touching the server.js call
 * site. `config` defaults to a fresh ENV parse so callers can also inject an
 * explicit config for tests (the same-process enable/disable toggle proof).
 */
function registerRoutes(app, deps = {}, config = parseYtdlpConfig()) {
  if (!isEnabled(config)) return;

  // The nav-link capability probe (public/js/common.js, T5): its mere
  // existence (200 vs 404) is the enable/disable signal, so the body only
  // needs to confirm the module is on.
  //
  // v1.20.0 FR-1 (T3), AC26: additive `defaultMaxVideos` field -- the
  // watch-page Subscribe modal's "download last N" pre-fill reads this field
  // so there is exactly one source of truth for the default, never a second
  // hardcoded literal on the client that could drift from it (mirrors the
  // v1.18.0 25->3 precedent's single-source discipline).
  //
  // (two-reviewer-gate fix, post-release): this now returns the ENV-RESOLVED
  // effective default -- `config.maxVideos` (already parsed by
  // `parseYtdlpConfig`, honoring `FILETUBE_YTDLP_MAX_VIDEOS` and falling back
  // to `DEFAULT_MAX_VIDEOS` when unset) -- NOT the bare fixed constant. The
  // modal ALWAYS pre-fills and then SENDS whatever this field reports, and
  // the plain `/subscriptions` add form leaves its equivalent field blank so
  // the server falls back to `config.maxVideos` there too -- returning the
  // fixed constant here meant an operator who set
  // `FILETUBE_YTDLP_MAX_VIDEOS` had that override silently ignored for every
  // watch-page subscribe, while the add-form path honored it, a two-entry-
  // point inconsistency. With no override this is still `DEFAULT_MAX_VIDEOS`
  // (2), so the common case is unaffected; with an override it now reflects
  // it, matching the add form. `config.maxVideos` can also be `0`
  // (unlimited) when so configured -- pre-filling the modal with `0` in that
  // case is the operator's actual configured default and is acceptable,
  // consistent with 0-means-unlimited semantics elsewhere in this module.
  app.get('/api/subscriptions/health', (req, res) => {
    res.json({ enabled: true, defaultMaxVideos: config.maxVideos });
  });

  // ---- /subscriptions page + its client controller (T5, D4) --------------
  // Registered INSIDE this same `isEnabled` gate, so both are equally absent
  // (native Express 404) when the module is disabled -- exactly like every
  // other route above. The page HTML and its controller JS are served from
  // lib/ytdlp/views + lib/ytdlp/client (NOT public/), so express.static can
  // never leak either one when the module is off: there is simply no file
  // for it to find at these paths under public/ (AC3).
  app.get('/subscriptions', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'subscriptions.html'));
  });

  app.get('/js/subscriptions.js', (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'subscriptions.js'));
  });

  // ---- CRUD + settings (T2) -----------------------------------------------
  // All registered here, inside the same `isEnabled` gate as `/health` above,
  // so they are equally absent (native Express 404) when the module is
  // disabled -- no separate no-op guard is needed per-route.

  app.get('/api/subscriptions', (req, res) => {
    res.json(store.listSubscriptions(deps).map((sub) => enrichSubscriptionWithChannelDir(config, sub)));
  });

  app.post('/api/subscriptions', async (req, res) => {
    // Full validation: store.js's `validateSubscriptionInput` runs the
    // channel URL through `validateChannelUrl` (lib/ytdlp/url.js) -- the
    // YouTube host allowlist, path-shape check, and option-injection/shell-
    // metacharacter rejection -- and returns the NORMALIZED url, which is
    // what gets persisted. A malformed/hostile URL never reaches
    // `addSubscription` (and therefore never reaches a spawn).
    const validation = store.validateSubscriptionInput(req.body);
    if (!validation.ok) {
      return res.status(400).json({ error: validation.error });
    }
    try {
      const record = await store.addSubscription(deps, validation.value);
      res.status(201).json(record);
    } catch (err) {
      console.error('Error adding subscription:', err);
      res.status(500).json({ error: `Could not add subscription: ${err.message}` });
    }
  });

  app.delete('/api/subscriptions/:id', async (req, res) => {
    try {
      // D3 nuance: removing a SUBSCRIPTION only stops future polling of that
      // channel. It must NOT touch the download-archive file -- that dedup
      // mechanism belongs to already-downloaded media (T3/T4) and is
      // untouched by subscription bookkeeping.
      const removed = await store.deleteSubscription(deps, req.params.id);
      if (!removed) return res.status(404).json({ error: 'Subscription not found' });
      // FR-E: a removed subscription can never reappear in a status
      // snapshot -- drop its (ephemeral, in-memory) live entry too, distinct
      // from (and in addition to) the persisted-record removal above.
      activity.clearSubscription(req.params.id);
      res.json({ success: true });
    } catch (err) {
      console.error('Error deleting subscription:', err);
      res.status(500).json({ error: `Could not delete subscription: ${err.message}` });
    }
  });

  // FR-D: edit/pause an existing subscription without a delete+re-add.
  // `store.validateSubscriptionPatch` accepts any SUBSET of
  // `{format, quality, maxVideos, paused}` -- a field simply absent means
  // "leave unchanged." `store.updateSubscription` preserves every other
  // field (id/channelUrl/name/addedAt/lastCheckedAt/lastStatus/archive
  // association, AC21) and returns `null` for an unknown id, mapped to a
  // `404` here (AC24).
  app.patch('/api/subscriptions/:id', async (req, res) => {
    const validation = store.validateSubscriptionPatch(req.body);
    if (!validation.ok) {
      return res.status(400).json({ error: validation.error });
    }
    try {
      const updated = await store.updateSubscription(deps, req.params.id, validation.value);
      if (!updated) return res.status(404).json({ error: 'Subscription not found' });
      res.json(updated);
    } catch (err) {
      console.error('Error updating subscription:', err);
      res.status(500).json({ error: `Could not update subscription: ${err.message}` });
    }
  });

  // ---- v1.24.0 B4 (FR-8): drag-and-drop subscription reorder --------------
  //
  // Registered inside this SAME `isEnabled` gate as every route above, so it
  // is equally absent (native Express 404) when the module is disabled. The
  // request-shape validation is `validateReorderRequest` (this file, above)
  // -- `store.reorderSubscriptions`/`store.reduceReorder` (T7) do the actual
  // persistence and are safe to hand anything that already passed that
  // validation. Responds with the SAME enriched shape `GET /api/subscriptions`
  // returns (each row gets its `channelDir`), so the client can simply
  // replace its in-memory list with the response, exactly like the PATCH
  // route above already does for a single row.
  app.post('/api/subscriptions/reorder', async (req, res) => {
    const validation = validateReorderRequest(req.body);
    if (!validation.ok) {
      return res.status(400).json({ error: validation.error });
    }
    try {
      await store.reorderSubscriptions(deps, validation.value);
      // `store.reorderSubscriptions` resolves with the raw persisted array
      // (whatever internal array order `db.ytdlp.subscriptions` happens to
      // be in) -- re-reading via `store.listSubscriptions` gives the SAME
      // order-sorted, freshly-copied shape `GET /api/subscriptions` itself
      // returns, so the client can simply replace its in-memory list with
      // this response and it is already display-ordered.
      const reordered = store.listSubscriptions(deps);
      res.json(reordered.map((sub) => enrichSubscriptionWithChannelDir(config, sub)));
    } catch (err) {
      console.error('Error reordering subscriptions:', err);
      res.status(500).json({ error: `Could not reorder subscriptions: ${err.message}` });
    }
  });

  // ---- v1.21.0 FR-5: channel pins (HEAVY, two-reviewer, data-safety gate) --
  //
  // Registered inside this SAME `isEnabled` gate as every route above -- when
  // the module is disabled, all three are equally absent (native Express 404,
  // AC69), no separate no-op guard needed. `store.js` owns the actual
  // persistence/validation logic (`validatePinInput`/`listPins`/`addPin`/
  // `removePin`) -- these handlers are thin HTTP adapters, exactly like the
  // CRUD routes above.
  //
  // HARD INVARIANT (the gate's actual focus, re-stated at the call site for
  // an adversarial reviewer): NOTHING in this block reads or writes
  // `db.folders`/`db.folderSettings` -- `store.addPin`/`store.removePin`
  // mutate ONLY `db.ytdlp.pins`, via the SAME serialized `updateDatabase`
  // every other mutator in this module already uses (see store.js's own
  // module comment above its pin-store section for the full structural
  // argument).
  app.get('/api/subscriptions/pins', (req, res) => {
    res.json(enrichPinsWithChannelAvatar(config, deps, store.listPins(deps)));
  });

  app.post('/api/subscriptions/pins', async (req, res) => {
    // AC: `channelDir` is untrusted client input -- confined under
    // `config.downloadDir` (the SAME `isPathUnder` posture `resolveChannelDir`
    // uses) BEFORE anything is queued for persistence; a `channelDir` outside
    // the download root is a hard `400`, never silently neutralized/stored.
    const validation = store.validatePinInput(config, req.body);
    if (!validation.ok) {
      return res.status(400).json({ error: validation.error });
    }
    try {
      const record = await store.addPin(deps, validation.value);
      res.status(201).json(record);
    } catch (err) {
      console.error('Error adding pin:', err);
      res.status(500).json({ error: `Could not add pin: ${err.message}` });
    }
  });

  app.delete('/api/subscriptions/pins/:id', async (req, res) => {
    try {
      const removed = await store.removePin(deps, req.params.id);
      if (!removed) return res.status(404).json({ error: 'Pin not found' });
      res.json({ success: true });
    } catch (err) {
      console.error('Error removing pin:', err);
      res.status(500).json({ error: `Could not remove pin: ${err.message}` });
    }
  });

  // ---- v1.24.3: drag-and-drop PINNED-channel reorder -----------------------
  //
  // Registered inside this SAME `isEnabled` gate as every route above -- when
  // the module is disabled this is equally absent (native Express 404), no
  // separate no-op guard needed. Mirrors `POST /api/subscriptions/reorder`
  // (B4, above) EXACTLY, one layer down: `validatePinReorderRequest` (this
  // file, above) does the request-shape validation, `store.reorderPins`/
  // `store.reducePinReorder` do the actual persistence (mutating ONLY
  // `db.ytdlp.pins`, never `db.folders`/`db.folderSettings` -- see the pin
  // section's own HARD INVARIANT comment above), and the response is the
  // SAME enriched shape `GET /api/subscriptions/pins` returns (via the
  // shared `enrichPinsWithChannelAvatar` helper, avoiding a second, drifting
  // copy of the avatar lookup), so the client can simply replace its
  // in-memory pin list with the response.
  app.post('/api/subscriptions/pins/reorder', async (req, res) => {
    const validation = validatePinReorderRequest(req.body);
    if (!validation.ok) {
      return res.status(400).json({ error: validation.error });
    }
    try {
      await store.reorderPins(deps, validation.value);
      const reordered = store.listPins(deps);
      res.json(enrichPinsWithChannelAvatar(config, deps, reordered));
    } catch (err) {
      console.error('Error reordering pins:', err);
      res.status(500).json({ error: `Could not reorder pins: ${err.message}` });
    }
  });

  // v1.24.0 A4 (FR-5): additive `pollMinutes` field -- the currently-armed
  // poll interval (`0` = manual-only, mirroring `armYtdlpTimer`'s own gate),
  // surfaced so the client can pair it with each subscription's own
  // `lastCheckedAt` (already returned by `GET /api/subscriptions`) to render
  // a "next check ~" estimate via `computeNextPollDue` -- or simply read the
  // per-subscription `nextPollDue`/`lastCheckedAt` this module already
  // precomputes on `GET /api/subscriptions/status` below. Does NOT change
  // the `POST /api/subscriptions/settings` response shape (still exactly
  // `{ allowMembersOnly }`, locked by an existing test) -- this is additive
  // to the GET response only.
  app.get('/api/subscriptions/settings', (req, res) => {
    res.json({ allowMembersOnly: store.getAllowMembersOnly(deps), pollMinutes: config.pollMinutes });
  });

  app.post('/api/subscriptions/settings', async (req, res) => {
    const { allowMembersOnly } = req.body || {};
    if (typeof allowMembersOnly !== 'boolean') {
      return res.status(400).json({ error: 'allowMembersOnly must be a boolean' });
    }
    try {
      const value = await store.setAllowMembersOnly(deps, allowMembersOnly);
      res.json({ allowMembersOnly: value });
    } catch (err) {
      console.error('Error saving subscriptions settings:', err);
      res.status(500).json({ error: `Could not save settings: ${err.message}` });
    }
  });

  // ---- Manual re-pull triggers (T4) ---------------------------------------
  // Independent of the scheduled timer (AC 15-16). Neither handler awaits the
  // full poll before responding -- a poll can legitimately run for a long
  // time (a whole channel's worth of downloads), and blocking the HTTP
  // response on that would tie up a request for as long as the download
  // takes. Instead: validate/respond promptly, then kick the (fire-and-
  // forget, `.catch`-guarded) poll off in the background -- mirrors the
  // existing `scanDirectories().catch(console.error)` pattern used elsewhere
  // in this codebase for the same reason. `runPoll` itself never rejects in
  // practice (every per-subscription failure is caught internally), but the
  // `.catch` here is defense-in-depth against an unhandled rejection ever
  // escaping this handler (the v1.9.0 route lesson).

  app.post('/api/subscriptions/repull', (req, res) => {
    res.status(202).json({ accepted: true });
    runPoll(deps, config).catch((err) => {
      console.error('yt-dlp: re-pull-all failed unexpectedly:', err && err.message);
    });
  });

  app.post('/api/subscriptions/:id/repull', (req, res) => {
    // Existence is checked synchronously (a plain `loadDatabase` read, no
    // lock) so the 404 can be returned immediately -- no need to await any
    // part of the poll itself just to validate the id.
    const exists = store.listSubscriptions(deps).some((sub) => sub.id === req.params.id);
    if (!exists) {
      return res.status(404).json({ error: 'Subscription not found' });
    }
    res.status(202).json({ accepted: true });
    runPoll(deps, config, req.params.id).catch((err) => {
      console.error('yt-dlp: re-pull-one failed unexpectedly:', err && err.message);
    });
  });

  // ---- FR-A: one-shot single-video download -------------------------------
  //
  // NEVER creates a subscription -- this is the T3/T4-class user-URL spawn
  // surface the two-reviewer gate covers. Validation is entirely SYNCHRONOUS
  // (classifySingleVideo/format-allowlist/normalizeQuality/resolveChannelDir
  // are all pure, no-I/O functions), so the handler itself never needs to be
  // `async`: every 400 is returned before anything is queued, and the actual
  // download always happens strictly AFTER the `202` response, in the
  // background, via `runExclusive` (NFR2 -- never concurrently with the poll
  // loop's own spawns).
  app.post('/api/ytdlp/download', (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};

    // AC9/10: a channel/playlist/handle/malformed/non-YouTube/non-http(s)
    // URL is rejected here, BEFORE anything is queued -- `classifySingleVideo`
    // (lib/ytdlp/url.js) is the single source of truth (reuses
    // `validateChannelUrl` verbatim), never a parallel/forked validator.
    const classification = url.classifySingleVideo(body.url);
    if (!classification.ok) {
      return res.status(400).json({ error: classification.error });
    }

    const format = body.format === undefined ? store.DEFAULT_FORMAT : body.format;
    if (!store.VALID_FORMATS.has(format)) {
      return res.status(400).json({ error: "format must be 'audio' or 'video'" });
    }
    // FR-B/AC16-17: `normalizeQuality` NEUTRALIZES a hostile/unknown value to
    // the safe default ('best') rather than erroring -- quality is a soft
    // preference, never a hard validation boundary (matches the subscription
    // add path's posture).
    const quality = args.normalizeQuality(body.quality);

    // v1.13.0 item 4: format-aware validation at the boundary -- store.js's
    // validator is the same one the subscription add/patch paths use (single
    // source of truth). An invalid/mismatched-format value 400s here, before
    // anything is queued; `args.normalizeFiletype` remains the defensive
    // re-assert immediately before argv, exactly like format/quality above.
    const filetypeResult = store.validateFiletype(format, body.filetype);
    if (!filetypeResult.ok) {
      return res.status(400).json({ error: filetypeResult.error });
    }
    const filetype = filetypeResult.value;

    // v1.25 QoL (T3): `body.folder`, when explicitly supplied, is an ADVANCED
    // OVERRIDE that always wins -- validated/confined synchronously right
    // here, exactly as before this feature (AC55, unchanged). When it is
    // absent, the folder is NO LONGER a fixed `'One-Off'` literal: it is left
    // unresolved (`null`) here and resolved later, in the background, by
    // `runOneShot` -- which probes the video's channel identity and routes
    // into that channel's own folder (falling back to a fixed
    // `ONE_OFF_FALLBACK_FOLDER` literal when the probe fails/finds nothing).
    // That deferral is deliberate: a channel probe is an extra network round-
    // trip this route's own synchronous-validation-only design (see the
    // module comment above) must never block the `202` response on.
    const explicitFolder = typeof body.folder === 'string' && body.folder.trim() !== '' ? body.folder.trim() : null;

    // AC55: confine an EXPLICIT target folder BEFORE ever responding --
    // reuses the EXACT SAME traversal guard subscription channel dirs get
    // (`resolveChannelDir`'s sanitize + resolved-path-under-root check). A
    // hostile folder value 400s here; it can never reach a spawn. A probed/
    // fallback folder (the `explicitFolder === null` case) is confined the
    // SAME way, just later -- inside `runOneShot`, via the identical
    // `resolveChannelDir` call `args.buildYtdlpDownloadArgs`/the quarantine
    // check already make -- so no safety margin is lost by deferring it;
    // `sanitizeChannelName` guarantees ANY string (probed, fallback, or user-
    // supplied) sanitizes to a safe single path segment.
    if (explicitFolder !== null) {
      try {
        args.resolveChannelDir(config, { name: explicitFolder });
      } catch {
        return res.status(400).json({ error: 'folder is invalid' });
      }
    }

    // FIX-10 (two-reviewer gate, LOW): this route has no auth (the app's
    // existing LAN posture -- this is defense-in-depth, not a full fix for
    // that), so nothing stops a caller from POSTing here in a tight loop. A
    // modest cap on the shared `runExclusive` FIFO's pending depth (which
    // this one-shot is ABOUT to join) rejects a new one-shot once too many
    // are already queued, rather than letting the queue -- and therefore the
    // number of in-memory `activity.oneShots` entries and eventually-spawned
    // yt-dlp children -- grow unbounded.
    if (ytdlpQueueLength >= MAX_ONESHOT_QUEUE_LENGTH) {
      return res.status(503).json({ error: 'Too many downloads are already queued; try again shortly' });
    }

    const jobId = crypto.randomUUID();
    // v1.21.0 FR-8 (T7): `format`/`quality`/`filetype` are ADDITIVE fields on
    // the one-shot LiveEntry -- `url` (the already-validated watch URL) and
    // `label` (the folder name) already existed and double as the retry
    // mechanism's `url`/`folder`, so these three are the only NEW fields.
    // Together they let a client reconstruct the exact original request body
    // (`{url, format, quality, filetype, folder}`) for a Retry re-POST to
    // this SAME route on failure -- see `runOneShot` below, which re-asserts
    // them once the job actually starts, and public/js/common.js's
    // `buildOneShotRetryBody`, which reads them back off a failed job's
    // `GET /api/subscriptions/status` entry. Never used for anything else
    // server-side; this route's own validation above already ran before this
    // point either way.
    // v1.25 QoL (T3): `label` is `explicitFolder` when the caller supplied
    // one, else `null` until `runOneShot`'s probe resolves the real folder
    // (see that function's own comment) -- a still-`null` label at this
    // 'queued' instant is expected/transient, never a bug: the very next
    // write (the 'downloading' transition, at the latest) always carries a
    // resolved, non-empty label.
    activity.setOneShot(jobId, {
      state: 'queued',
      title: null,
      index: 1,
      total: 1,
      percent: 0,
      label: explicitFolder,
      url: classification.watchUrl,
      format,
      quality,
      filetype,
    });

    res.status(202).json({ accepted: true, jobId });

    // FIX 2 (two-reviewer gate, post-v1.25.0): resolve the destination
    // folder (an explicit override, or a channel probe -- see
    // `resolveOneOffFolder`'s own doc comment) FIRST, UNLOCKED -- i.e.
    // strictly BEFORE this job ever joins the shared `runExclusive` FIFO gate
    // subscription polls also share. Only the ACTUAL download (`runOneShot`,
    // given the already-resolved `folder`) is the exclusive section now; a
    // slow/hung probe can therefore never hold that gate hostage the way it
    // used to (pre-fix, the whole of `runOneShot` -- probe included -- ran
    // inside `runExclusive`). `resolveOneOffFolder` itself never throws
    // (mirrors `run.probeChannel`'s own guarantee) -- the outer `.catch`
    // below is pure defense-in-depth against a synchronous throw escaping
    // before either promise chain's own try ever starts, mirroring the
    // re-pull routes' `.catch` posture above.
    resolveOneOffFolder(classification.watchUrl, explicitFolder, config, jobId)
      .then((folder) => runExclusive(() => runOneShot(deps, config, {
        videoId: classification.videoId,
        watchUrl: classification.watchUrl,
        format,
        quality,
        filetype,
        folder,
        jobId,
      })))
      .catch((err) => {
        console.error(`yt-dlp: one-shot ${jobId} background task failed unexpectedly:`, err && err.message);
        activity.setOneShot(jobId, { state: 'error', error: safeErrorStatus(err && err.message, config) });
      });
  });

  // ---- v1.24.0 A3: cancel an in-progress one-shot download -----------------
  //
  // Registered inside this SAME `isEnabled` gate as every route above, so it
  // is equally absent (native Express 404) when the module is disabled --
  // the disabled-module no-op guarantee needs no separate guard here.
  //
  // Scope note: this cancels ONLY the one-shot path (`activeOneShotChildren`,
  // above) -- the home status chip's cancellable job, which is where Dean
  // initiates ad-hoc downloads. Subscription-poll cancellation was OUT OF
  // SCOPE for the original v1.24.0 A3 round (a subscription's `runDownload`
  // targets a WHOLE batch of survivor videos in one spawn, and cancelling
  // mid-batch raised coalescing/partial-batch questions that round
  // deliberately deferred) -- v1.24.8 (below, `POST
  // /api/subscriptions/:id/cancel` and `POST
  // /api/subscriptions/downloads/cancel`) closes that gap with the
  // subscription-side twin of this exact machinery.
  //
  // No live handle for `jobId` (already finished, never existed, or a typo)
  // -> a clean `404`, never a crash: an unknown/already-settled job is simply
  // not cancellable, not an error condition.
  app.post('/api/ytdlp/download/:jobId/cancel', (req, res) => {
    const jobId = req.params.jobId;
    const child = activeOneShotChildren.get(jobId);
    if (!child) {
      res.status(404).json({ error: 'No in-progress download for this job id' });
      return;
    }
    // FIX-1 (two-reviewer gate): add the durable latch BEFORE the kill --
    // see `cancelledOneShotJobs`'s doc comment above. This must be set
    // synchronously, in this same tick, so it is already in place before ANY
    // later progress line (buffered or otherwise) or the download's own
    // settle can race it.
    cancelledOneShotJobs.add(jobId);
    // Same posture as the existing timeout-kill path (`run.js`'s
    // `DEFAULT_KILL_SIGNAL`, `'SIGKILL'`): a killed download is already a
    // handled outcome elsewhere in this module -- the partial file it leaves
    // behind is reaped the SAME way any other failed/timed-out download's is,
    // by `cleanupFailedDownloadIntermediates` (see `runOneShot`'s
    // `!downloadResult.ok` branch, above, which still runs once the killed
    // child's own 'close' event resolves `run.runDownload`'s promise). Never
    // throws: `ChildProcess#kill` itself doesn't throw for a live handle, but
    // this is wrapped anyway (RELIABILITY.md: never let a single request
    // handler crash the process over a spawn-lifecycle edge case).
    try {
      child.kill(run.DEFAULT_KILL_SIGNAL);
    } catch (err) {
      console.error(`yt-dlp: failed to kill one-shot ${jobId} on cancel:`, err && err.message);
    }
    // A NEW terminal state, distinct from 'error' -- written here,
    // SYNCHRONOUSLY, so the very next status poll already reflects the
    // cancellation regardless of how long the killed child takes to actually
    // exit. `runOneShot`'s own terminal writes guard against overwriting this
    // back to 'error' (and re-assert 'cancelled' if a late progress line
    // already clobbered it) using the SAME `cancelledOneShotJobs` latch set
    // just above -- 'cancelled' always wins.
    activity.setOneShot(jobId, { state: 'cancelled' });
    res.json({ cancelled: true, jobId });
  });

  // ---- v1.24.8: stop subscription downloads --------------------------------
  //
  // Two routes, registered inside this SAME `isEnabled` gate as every route
  // above (native Express 404 when the module is disabled -- no separate
  // guard needed). Both target the SUBSCRIPTION poll loop's spawns
  // (`activeSubscriptionDownloads`/`cancelledSubscriptionIds`, above),
  // mirroring the one-shot cancel route immediately above it, one namespace
  // over. Cancel targets the CURRENT backlog only: `sub.paused` and the poll
  // interval are both untouched by either route -- the periodic
  // `armYtdlpTimer` (or a future manual re-pull) will poll every affected
  // subscription again at its next normal trigger. This is NOT pause.
  //
  // ROUTE-ORDER NOTE (load-bearing): the "stop all" route
  // (`/api/subscriptions/downloads/cancel`, a fixed literal path) is
  // registered BEFORE the single-subscription route
  // (`/api/subscriptions/:id/cancel`, a param route). Express matches routes
  // in REGISTRATION order -- had `:id/cancel` been registered first, a
  // request to `/api/subscriptions/downloads/cancel` would have matched IT
  // first instead, with `id` bound to the literal string `'downloads'`
  // (which is never a real subscription id, so stop-all would have 404'd
  // every single time instead of ever reaching its own handler below).

  // ---- Cancel EVERY currently queued/active subscription download ----------
  //
  // The "stop all" counterpart: latches every subscription id the live
  // activity snapshot currently reports as queued or downloading (see
  // `isSubscriptionCancelTarget`'s doc comment just below for exactly why
  // 'listing' and every terminal state are deliberately excluded), kills the
  // (at most one, per `runPoll`'s strictly sequential loop) active download
  // child -- writing its terminal 'cancelled' state -- and clears every
  // merely-queued entry, exactly mirroring the single-cancel route's own
  // active/queued branches below, one loop over. Also clears any pending
  // coalesced re-pull so stop-all does not immediately respawn the whole
  // backlog it just cleared. Always responds 200 with the count actually
  // cancelled -- including `{ cancelled: 0 }` when nothing was in progress,
  // a clean no-op rather than an error.
  app.post('/api/subscriptions/downloads/cancel', (req, res) => {
    const snapshot = activity.getSnapshot();
    const targetIds = Object.keys(snapshot.subscriptions).filter((id) => isSubscriptionCancelTarget(id, snapshot).cancellable);

    for (const id of targetIds) {
      cancelledSubscriptionIds.add(id);
      const child = activeSubscriptionDownloads.get(id);
      if (child) {
        // ACTIVE: same posture as the single-cancel route below -- SIGKILL,
        // then write the terminal 'cancelled' state synchronously.
        try {
          child.kill(run.DEFAULT_KILL_SIGNAL);
        } catch (err) {
          console.error(`yt-dlp: failed to kill subscription ${id} download on stop-all:`, err && err.message);
        }
        activity.setSubscription(id, { state: 'cancelled' });
      } else {
        // QUEUED (no download child registered yet): nothing to kill --
        // clear the entry entirely, exactly like the single-cancel route's
        // own queued branch.
        activity.clearSubscription(id);
      }
    }

    // C5's coalesced-while-busy re-pull machinery could have already armed a
    // follow-up for this exact backlog -- clear it so stop-all is not
    // immediately undone moments later.
    clearPendingPollRerun();

    res.json({ cancelled: targetIds.length });
  });

  // ---- Cancel ONE subscription's current backlog ---------------------------
  //
  // Works whether the subscription is currently DOWNLOADING (an active
  // `run.runDownload` child to SIGKILL) or merely QUEUED (nothing spawned
  // yet -- the poll loop's own cancel-skip, below, is what stops it from
  // ever spawning). An id that never matched any subscription 404s, same
  // posture as the one-shot route's unknown-jobId 404; a KNOWN subscription
  // with nothing currently in progress (see `isSubscriptionCancelTarget`,
  // below) is a harmless, idempotent 200 that deliberately never touches the
  // latch at all.
  //
  // FIX 2 (two-reviewer gate, post-v1.24.8): that idempotent no-op 200 MUST
  // report `{cancelled: false, id}`, not `{cancelled: true, id}` -- the
  // latter was a silent fake-success. `isSubscriptionCancelTarget`
  // deliberately excludes `'listing'` (no child to kill during listing), so
  // a Cancel request against a `'listing'` subscription took this exact
  // no-op branch, yet the pre-fix `{cancelled: true}` told the client
  // otherwise: no error, no toast, and the download proceeded to completion
  // while the user believed it had been stopped. `{cancelled: true, id}` is
  // now reserved for the branch below, which actually latched the id AND
  // attempted a kill (or cleared a genuinely queued entry).
  app.post('/api/subscriptions/:id/cancel', (req, res) => {
    const id = req.params.id;
    // Existence check mirrors the `POST /api/subscriptions/:id/repull`
    // route's own synchronous, lock-free `store.listSubscriptions` read
    // above -- a bogus id 404s immediately, before anything is latched.
    const exists = store.listSubscriptions(deps).some((sub) => sub.id === id);
    if (!exists) {
      res.status(404).json({ error: 'Subscription not found' });
      return;
    }

    const target = isSubscriptionCancelTarget(id);
    if (!target.cancellable) {
      // Nothing actionable for this id right now -- a harmless, idempotent
      // no-op that deliberately never adds to the latch (see
      // `isSubscriptionCancelTarget`'s doc comment for exactly why an
      // unconditional add here would be an "orphan latch" bug, not a
      // no-op). FIX 2: `cancelled: false` -- this request did NOT actually
      // cancel anything (still HTTP 200 -- it is not an error, just a no-op).
      res.json({ cancelled: false, id });
      return;
    }

    // Add to the durable latch BEFORE the kill -- same discipline as
    // `cancelledOneShotJobs.add(jobId)` above: synchronous, in this same
    // tick, so it is already in place before ANY later progress line or the
    // download's own settle can race it (see `cancelledSubscriptionIds`'s
    // doc comment).
    cancelledSubscriptionIds.add(id);
    if (target.child) {
      // ACTIVE: same posture as the one-shot kill path -- never throws
      // (RELIABILITY.md: never let a single request handler crash the
      // process over a spawn-lifecycle edge case).
      try {
        target.child.kill(run.DEFAULT_KILL_SIGNAL);
      } catch (err) {
        console.error(`yt-dlp: failed to kill subscription ${id} download on cancel:`, err && err.message);
      }
      // Written SYNCHRONOUSLY, so the very next status poll already reflects
      // the cancellation regardless of how long the killed child takes to
      // actually exit. `guardedSetSubscriptionActivity`'s latch check
      // (above) re-asserts this if `runSubscriptionCycle`'s own terminal
      // write (or a late progress patch) lands afterward -- 'cancelled'
      // always wins, mirroring the one-shot route's re-assert discipline.
      activity.setSubscription(id, { state: 'cancelled' });
    } else {
      // QUEUED (no download child registered yet): there is no child to
      // kill, and nothing terminal to report -- clear the entry entirely so
      // it vanishes from the snapshot rather than lingering on a stale
      // 'queued' state. The loop-skip below (in `runPoll`) is what keeps
      // this subscription from ever spawning a download child in the first
      // place, so the latch + this clear are the whole story for this case.
      activity.clearSubscription(id);
    }
    res.json({ cancelled: true, id });
  });

  // ---- v1.25 QoL follow-up: metadata+subtitle re-pull backfill ("reheat") --
  //
  // Distinct from `POST /api/subscriptions/repull` (above, ~L2112): that
  // route re-polls subscriptions for NEW videos; this route re-pulls
  // metadata+subtitles for EXISTING, already-downloaded items. Reuses the
  // TWO seams server.js already built and bridges through `deps` -- see
  // `enumerateRepullableItems`/`recordRepulledItemMeta`'s own header comments
  // in server.js for the full wiring-contract rationale (a
  // `require('../../server')` from this module would hit a circular-require
  // trap) -- and `run.repullItemMetaAndSubs` (lib/ytdlp/run.js) for the
  // per-item spawn seam. This route itself owns only the HTTP surface +
  // orchestration: validate/guard synchronously, respond `202` with the
  // blast radius BEFORE any network I/O, then run the batch in the
  // background via `runRepullMetadataBatch` (above).
  //
  // NEVER auto-run (thumbnail-backfill-regression lesson): this route is the
  // ONLY trigger for a reheat batch -- no boot path, no scan path, nothing on
  // a timer ever calls `runRepullMetadataBatch`/`enumerateRepullableItems`/
  // `recordRepulledItemMeta` (see the structural regression test asserting
  // exactly this).
  app.post('/api/ytdlp/repull-metadata', (req, res) => {
    // Hard single-flight guard (see `repullMetadataInProgress`'s own doc
    // comment above) -- checked FIRST, before touching the database or
    // computing eligibility, so a second concurrent POST never even pays for
    // a `loadDatabase()` read.
    if (repullMetadataInProgress) {
      return res.status(409).json({ started: false, alreadyRunning: true });
    }
    if (!deps || typeof deps.loadDatabase !== 'function'
      || typeof deps.enumerateRepullableItems !== 'function'
      || typeof deps.recordRepulledItemMeta !== 'function') {
      // Defense-in-depth only -- server.js always wires all three (see the
      // `ytdlp.registerRoutes(app, {...})` call site's own comment); a
      // deployment missing this wiring gets a clean 503 rather than a crash.
      return res.status(503).json({ error: 'Metadata re-pull is unavailable (missing server wiring)' });
    }

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const force = body.force === true || (req.query && (req.query.force === '1' || req.query.force === 'true'));

    let db;
    try {
      db = deps.loadDatabase();
    } catch (err) {
      console.error('yt-dlp: repull-metadata could not read the database:', err && err.message);
      return res.status(500).json({ error: 'Could not read the database' });
    }
    const { items, eligible, ineligible } = deps.enumerateRepullableItems(db, config);

    // 202 immediately, reporting the blast radius up front -- this route
    // NEVER blocks on the network pass (mirrors `POST /api/subscriptions/repull`
    // and `POST /api/ytdlp/download`'s own "validate/respond promptly, then
    // do the real work in the background" posture).
    res.status(202).json({ started: true, eligible, ineligible });

    repullMetadataInProgress = true;
    repullMetadataCancelled = false;
    runRepullMetadataBatch(deps, config, items, force).catch((err) => {
      // Defense-in-depth only -- `runRepullMetadataBatch` already has its own
      // top-level try/finally and should never actually reject.
      console.error('yt-dlp: repull-metadata batch failed unexpectedly:', err && err.message);
      repullMetadataInProgress = false;
      activity.setOneShot(REPULL_METADATA_ACTIVITY_ID, { state: 'error', current: null });
    });
  });

  // ---- Cancel an in-progress reheat batch -----------------------------------
  //
  // Sets the durable cooperative-cancel latch (`repullMetadataCancelled`) so
  // `runRepullMetadataBatch`'s loop stops cleanly BETWEEN items -- there is
  // no per-item `ChildProcess` handle to SIGKILL here (unlike the one-shot/
  // subscription cancel routes above): `run.repullItemMetaAndSubs` owns its
  // own two spawns internally and never exposes them, so an item already
  // mid-flight always runs to completion; only the NEXT item is skipped.
  // Idempotent: cancelling when nothing is running is a harmless no-op
  // (`{cancelled: false}`), mirroring the single-subscription cancel route's
  // own no-op posture for a target that isn't actually in progress.
  app.post('/api/ytdlp/repull-metadata/cancel', (req, res) => {
    if (!repullMetadataInProgress) {
      return res.json({ cancelled: false });
    }
    repullMetadataCancelled = true;
    res.json({ cancelled: true });
  });

  // ---- FR-E: live status snapshot ------------------------------------------
  //
  // Returns the EPHEMERAL in-process activity map (subscriptions + one-shots)
  // -- never persisted, never touches db.json. Registered inside this same
  // `isEnabled` gate, so it is equally absent (native 404) when the module is
  // disabled (AC2/32). Contains only titles/percent/state/label/url and a
  // redacted `error` string (never a raw error/stderr, never a cookies path
  // -- NFR3/AC31).
  //
  // v1.24.0 A4 (FR-5): additively merges two poll-timing fields onto each
  // CURRENT subscription's entry -- `lastCheckedAt` (verbatim, the SAME
  // persisted value `GET /api/subscriptions` already returns) and
  // `nextPollDue` (via `computeNextPollDue`, using the currently-armed
  // interval) -- so the client's existing ~2.5s status poll can render a
  // "last pulled" / "next check ~" estimate without a second request or
  // client-side date math. No new persistence: both values are read fresh
  // from `store.listSubscriptions`/`config.pollMinutes` on every request.
  // A subscription with no live activity entry yet still gets these two
  // fields (the loop below creates a minimal entry for it); a subscription
  // that was just deleted is never re-added here (it is simply absent from
  // `store.listSubscriptions`), preserving FIX-6/QW1's "a deleted
  // subscription never reappears in the status snapshot" invariant.
  app.get('/api/subscriptions/status', (req, res) => {
    const snapshot = activity.getSnapshot();
    const pollIntervalMs = config.pollMinutes > 0 ? config.pollMinutes * 60 * 1000 : 0;
    for (const sub of store.listSubscriptions(deps)) {
      if (!sub || typeof sub.id !== 'string') continue;
      const lastCheckedMs = typeof sub.lastCheckedAt === 'string' ? Date.parse(sub.lastCheckedAt) : NaN;
      const existing = snapshot.subscriptions[sub.id] || {};
      snapshot.subscriptions[sub.id] = {
        ...existing,
        // v1.24.8: the channel/subscription name, so the download status chip
        // can label each row by CHANNEL (incl. every queued row) instead of a
        // generic "Subscription download". Additive + display-only; the client
        // falls back to the in-flight title, then the generic literal, when a
        // sub has no name. `textContent`-rendered client-side (creator-controlled).
        ...(typeof sub.name === 'string' && sub.name !== '' ? { name: sub.name } : {}),
        lastCheckedAt: sub.lastCheckedAt,
        nextPollDue: computeNextPollDue(lastCheckedMs, pollIntervalMs),
      };
    }
    res.json(snapshot);
  });
}

/**
 * Arm (or clear) the background poll timer. Mirrors `armScanTimer()`
 * exactly: clear any existing timer first (so repeated calls re-arm rather
 * than stack), then arm a `.unref()`'d `setInterval` ONLY when the module is
 * enabled AND `pollMinutes > 0` (`0` means "manual re-pull only," mirroring
 * `scanIntervalMinutes`'s "0 = Off" convention); otherwise leaves it `null`.
 * `.unref()` so an armed timer never keeps the process -- or a test runner
 * that calls this directly -- alive.
 *
 * `deps` defaults to `{}` so existing callers (and the T1-era test that
 * calls `armYtdlpTimer(config)` with no second argument) keep working
 * unchanged -- the timer still arms/clears exactly as before; it's only the
 * INTERVAL CALLBACK's behavior (now `runPoll` instead of an inert
 * placeholder) that depends on `deps` actually being wired for a real poll to
 * do anything.
 *
 * NOTE on the binary-presence gate: the exec plan's Design section allows
 * (but doesn't require) also gating real arming on `checkYtdlpAvailable()`.
 * That check is async (it spawns `yt-dlp --version`), and this function's
 * contract -- proven by the existing T1 integration test -- is to return the
 * armed timer (or `null`) SYNCHRONOUSLY. Making this function async to
 * accommodate the presence check would break that contract and every
 * existing caller. Left as a deliberate deviation/residual: `startBackground`
 * (below) still gates the REAL enable path, and a missing binary simply
 * surfaces as a redacted `error: ...` `lastStatus` on the first poll attempt
 * (graceful degrade, never a crash) rather than as a suppressed timer.
 */
function armYtdlpTimer(config = parseYtdlpConfig(), deps = {}) {
  if (ytdlpPollTimer) {
    clearInterval(ytdlpPollTimer);
    ytdlpPollTimer = null;
  }
  if (isEnabled(config) && config.pollMinutes > 0) {
    ytdlpPollTimer = setInterval(() => {
      // Defense-in-depth ONLY: `runPoll` -> `processSubscription` already
      // catches every per-subscription failure internally and never
      // rejects in practice. This `.catch` exists so that even a bug in
      // that guarantee can never let an unhandled rejection escape a timer
      // callback (Node terminates the process on those) or wedge the timer
      // from firing again next interval.
      runPoll(deps, config).catch((err) => {
        console.error('yt-dlp: scheduled poll failed unexpectedly:', err && err.message);
      });
    }, config.pollMinutes * 60 * 1000).unref();
  }
  return ytdlpPollTimer;
}

// Test-observability accessor: exposes the current module-level
// `ytdlpPollTimer` (or `null`) without reaching into module internals,
// mirroring server.js's `currentScanTimer()`.
function currentYtdlpPollTimer() {
  return ytdlpPollTimer;
}

/**
 * C3+C7 (T4 fix round, reconciled): make sure `config.downloadDir` exists on
 * disk, mirroring server.js's own startup mkdir-if-missing pattern for
 * DATA_DIR/THUMBNAIL_DIR/TRANSCODE_DIR. This is MKDIR-ONLY -- it no longer
 * touches `db.folders` at all (that push was the root cause of both C3 and
 * C7; see `extraScanRoots` below for the replacement mechanism). Best-effort
 * and synchronous: a failure is logged, never thrown, and never blocks
 * `startBackground`. Only ever called from `startBackground`'s `isEnabled`
 * gate, so a disabled module never creates this directory.
 */
function ensureDownloadDir(config) {
  const downloadDir = config && config.downloadDir;
  if (typeof downloadDir !== 'string' || downloadDir.trim() === '') return;
  try {
    fs.mkdirSync(downloadDir, { recursive: true });
  } catch (err) {
    console.error('yt-dlp: could not create the download directory; subscriptions may fail until it exists:', err && err.code);
  }
}

/**
 * D1 (T4 fix round #2) + E1 (T4 fix round #3, CRITICAL, CONFIRMED regression
 * fix): the MODULE-OWNED scan root, independent of `db.folders` entirely.
 * Pure and side-effect-free beyond a single `fs.existsSync` presence check --
 * safe to call from the core scan path (server.js's `runScanDirectories`) on
 * every scan.
 *
 * **Gates on `isEnabled(config)` OR `fs.existsSync(downloadDir)` -- an
 * OR-gate, not either condition alone.** D1 (round #2) made this gate purely
 * `fs.existsSync`, dropping `config.enabled` from the decision entirely --
 * that reopened the SAME mount-loss data-destruction class the v1.8.0 guard
 * exists to prevent, via a WORSE trigger: an ENABLED module whose download
 * volume goes transiently absent (an NFS/external-drive unmount, a rename, or
 * an EACCES that `existsSync` reports as false) would drop `downloadDir` out
 * of the scan set entirely -- never landing in server.js's `missingRoots`,
 * so `selectPrunableIds`' mount-loss guard (`if (root && missing.has(root))
 * continue;`) never got a chance to fire, and the default-ON `pruneMissing`
 * toggle would permanently reap every downloaded id's metadata/thumbnail/
 * transcode sidecar/`db.progress` entry -- WHILE STILL ENABLED, from a mere
 * infra hiccup rather than any operator action. Pre-D1, an enabled module
 * always contributed `downloadDir` unconditionally, so a transient unmount
 * landed it in `missingRoots` and the mount-loss guard protected it; this
 * OR-gate restores that protection for the enabled case while PRESERVING
 * D1's disable-preserves-content decision for the disabled case.
 *
 * **Reframed invariant** (the fresh-install no-op guarantee, ACs 1-6, is
 * UNCHANGED by this reframe -- see below):
 *   - never-enabled install (disabled, and the dir was never created):
 *     `isEnabled` is false AND `fs.existsSync` is false -> `[]` -> fully
 *     inert, the optional/additive guarantee holds byte-for-byte.
 *   - enabled, dir present: `isEnabled` is true -> `[path.resolve(downloadDir)]`
 *     -> scanned.
 *   - **enabled, dir TRANSIENTLY ABSENT (the E1 fix): `isEnabled` is true ->
 *     `[path.resolve(downloadDir)]` UNCONDITIONALLY, regardless of
 *     `fs.existsSync` -- this is what lands it in server.js's `missingRoots`
 *     so the mount-loss guard PROTECTS the content instead of prune reaping
 *     it.**
 *   - disabled-was-enabled, dir present: `fs.existsSync` is true ->
 *     `[path.resolve(downloadDir)]` -> still scanned -> `pruneMissing` never
 *     reaps it, because the ids never stop surviving the scan in the first
 *     place (Dean's D1 decision: disabling must never destroy already-
 *     downloaded content).
 *   - disabled, dir transiently absent: `isEnabled` is false AND
 *     `fs.existsSync` is false -> `[]` -> a NARROW, documented limitation
 *     (see `docs/ARCHITECTURE.md` and the exec plan's E3 note): with the
 *     module off, a simultaneous volume-unmount is unprotected. Not closed by
 *     persisting a "managed root" marker -- deliberately, per the C3/C7
 *     module-owned design (Dean can revisit if it ever bites in practice).
 *
 * Still closes C3 (a `POST /api/config` save can no longer evict
 * `downloadDir` -- it was never IN `db.folders`) and C7(ii) (`GET
 * /api/config` never surfaces a folder the operator never added) exactly as
 * before -- those were about `db.folders`/`GET /api/config`, untouched by
 * this reframe. `path.resolve`-normalized so `matchRootFolder`'s prefix
 * comparisons stay consistent.
 */
function extraScanRoots(config = parseYtdlpConfig()) {
  const downloadDir = config && config.downloadDir;
  if (typeof downloadDir !== 'string' || downloadDir.trim() === '') return [];
  if (isEnabled(config) || fs.existsSync(downloadDir)) return [path.resolve(downloadDir)];
  return [];
}

/**
 * D2 (T4 fix round #2, HYGIENE, dev/test-only blast radius -- `lib/ytdlp`
 * never shipped in any tagged release): a pre-fix branch pushed
 * `config.downloadDir` into the client-owned `db.folders` via
 * `updateDatabase`. The module now owns that root EXCLUSIVELY via
 * `extraScanRoots` (D1/C3+C7) -- `downloadDir` must never live in
 * `db.folders`, or `GET /api/config` keeps surfacing a folder the operator
 * never added and the tree gets double-walked (once via `db.folders`, once
 * via `extraScanRoots`).
 *
 * Idempotent and cheap: reads the current `db.folders` (a plain
 * `loadDatabase` call, no lock) and only reaches for `updateDatabase` at all
 * if a stale entry actually matching `downloadDir` is present -- a clean
 * `db.json` (the common case; every fresh/never-affected install) never
 * takes the lock or writes anything. Reconciles with D1/E1: this migration is
 * unrelated to whether the dir currently exists on disk or whether the
 * module is enabled (that's `extraScanRoots`'s own concern, and with E1's
 * OR-gate content is already protected there regardless) -- it only ever
 * removes a STRING match in `db.folders`, nothing else. Never throws; a
 * failure is logged and treated as "try again next start" (the stale entry
 * is harmless, if hygienically undesirable, in the meantime).
 *
 * E2 (T4 fix round #3, LOW, caveat note): a plain string match cannot tell a
 * genuine pre-fix stale entry apart from a path an OPERATOR deliberately
 * added to `db.folders` that happens to equal `downloadDir` -- either way
 * this removes it silently. With E1 in place the content stays protected via
 * `extraScanRoots` regardless of whether it's also (redundantly) present in
 * `db.folders`, so the compounding prune risk that originally motivated this
 * migration is gone; the remaining silent-config-mutation risk is made
 * OBSERVABLE by the informational log line below (fired only when an entry
 * is actually removed), not eliminated -- an operator who deliberately added
 * this exact path to `db.folders` would need to re-add it after an upgrade
 * that runs this migration.
 */
function migrateStaleDownloadDirFromFolders(deps, config) {
  const downloadDir = config && config.downloadDir;
  if (typeof downloadDir !== 'string' || downloadDir.trim() === '') return Promise.resolve();
  if (!deps || typeof deps.loadDatabase !== 'function' || typeof deps.updateDatabase !== 'function') {
    return Promise.resolve();
  }
  const resolvedDownloadDir = path.resolve(downloadDir);
  const isStaleEntry = (f) => typeof f === 'string' && path.resolve(f) === resolvedDownloadDir;

  let existingFolders;
  try {
    const db = deps.loadDatabase();
    existingFolders = Array.isArray(db && db.folders) ? db.folders : [];
  } catch (err) {
    console.error('yt-dlp: could not read db.json to check for a stale downloadDir folder entry:', err && err.message);
    return Promise.resolve();
  }
  if (!existingFolders.some(isStaleEntry)) return Promise.resolve(); // nothing to migrate -- never touch updateDatabase

  // F2 (T4 cleanup pass): wrap the INVOCATION itself, not just the returned
  // promise -- a synchronous throw from `deps.updateDatabase` (e.g. thrown
  // during argument evaluation, before it ever returns a promise) would
  // otherwise escape this function entirely, since `Promise.resolve(...)`
  // never gets a chance to wrap it. This function is called unawaited from
  // `startBackground` with no call-site `.catch`, so an uncaught synchronous
  // throw here could crash the startup path -- violating the documented
  // "never throws; log and try again next start" contract.
  let updateResult;
  try {
    updateResult = deps.updateDatabase((db) => {
      const folders = Array.isArray(db.folders) ? db.folders : [];
      const filtered = folders.filter((f) => !isStaleEntry(f));
      if (filtered.length === folders.length) return false; // already gone by the time the lock was acquired
      db.folders = filtered;
      console.log('yt-dlp: migrated a stale downloadDir entry out of db.folders (the module now owns this root via extraScanRoots)');
    });
  } catch (err) {
    console.error('yt-dlp: failed to migrate a stale downloadDir entry out of db.folders:', err && err.message);
    return Promise.resolve();
  }

  return Promise.resolve(updateResult).catch((err) => {
    console.error('yt-dlp: failed to migrate a stale downloadDir entry out of db.folders:', err && err.message);
  });
}

/**
 * Called only from server.js's `require.main === module` guard (process
 * lifecycle start), never at import time or module top-level -- so
 * requiring this module, or importing server.js for tests, never arms a
 * timer or creates a directory. Early-returns when disabled. When enabled:
 * ensures the download dir exists (synchronous, best-effort -- see
 * `ensureDownloadDir` above; the scan-root mechanism is now `extraScanRoots`,
 * merged by server.js's own scan path, not a `db.folders` write here), runs
 * the D2 stale-`db.folders`-entry migration (fire-and-forget -- it has its
 * own internal catch and never throws), then arms the real poll timer with
 * `deps` wired through so its interval callback can actually run `runPoll`.
 */
function startBackground(deps = {}, config = parseYtdlpConfig()) {
  if (!isEnabled(config)) return;
  ensureDownloadDir(config);
  migrateStaleDownloadDirFromFolders(deps, config);
  armYtdlpTimer(config, deps);
}

module.exports = {
  registerRoutes,
  armYtdlpTimer,
  currentYtdlpPollTimer,
  startBackground,
  runPoll,
  isPollBusy,
  resetPollRerunStateForTests,
  extraScanRoots,
  migrateStaleDownloadDirFromFolders,
  // v1.15.1 hotfix: exported so tests can exercise the post-failure
  // intermediate cleanup directly, in addition to indirectly via
  // runPoll/runOneShot.
  cleanupFailedDownloadIntermediates,
  MAX_STATUS_LENGTH,
  // FIX-10: exported so tests can assert the cap against the real constant
  // instead of a hardcoded duplicate (mirrors run.js's STDERR_TAIL_LIMIT export).
  MAX_ONESHOT_QUEUE_LENGTH,
  // Re-exported so `node:test` files can reach the pure helpers via
  // `require('../../lib/ytdlp')` without a second require of `./config`.
  parseYtdlpConfig,
  isEnabled,
  // v1.20.0 FR-2: the scan-time bridge read (store.js owns the
  // db.ytdlp.downloadMeta structural knowledge; re-exported here so
  // server.js's scan -- which already imports this module for
  // extraScanRoots -- never needs to reach into lib/ytdlp/store.js directly,
  // preserving layering).
  consumeDownloadChannelMeta: store.consumeDownloadChannelMeta,
  // v1.20.0 FR-4: exported so unit tests can exercise the channelDir
  // enrichment (present/omitted) directly, without booting the full app.
  enrichSubscriptionWithChannelDir,
  // v1.22.0 FR-2: the retroactive folder-based backfill -- the pure matcher
  // is exported for direct unit testing; the wrapper is what server.js's
  // scan mutator calls (mirroring consumeDownloadChannelMeta's layering:
  // db.ytdlp structural knowledge stays inside the module).
  matchChannelDirToSubscription,
  backfillChannelIdentityFromFolder,
  // v1.24.0 A4/B4: exported so unit tests can exercise these pure helpers
  // directly, without booting the full app.
  computeNextPollDue,
  validateReorderRequest,
  // v1.24.3: pinned-channel DnD reorder -- pure request validator + the
  // shared avatar-enrichment helper, exported for direct unit testing.
  validatePinReorderRequest,
  enrichPinsWithChannelAvatar,
  // v1.24.0 A2 (T14): pure per-item failure-attribution mapping helpers,
  // exported for direct unit testing without booting a full poll cycle.
  mapItemFailuresForActivity,
  sanitizeFailureTitle,
  // v1.25 QoL follow-up (metadata+subtitle re-pull backfill): the fixed
  // `activity.oneShots` key the reheat's LiveEntry lives under, exported so
  // tests can read `activity.getSnapshot().oneShots[REPULL_METADATA_ACTIVITY_ID]`
  // without hardcoding the literal a second time, plus the test-only state
  // reset (mirrors `resetPollRerunStateForTests` above).
  REPULL_METADATA_ACTIVITY_ID,
  resetRepullMetadataStateForTests,
};
