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
  if (pollRerunTimer) clearTimeout(pollRerunTimer);
  pollRerunTimer = null;
  pollRerunTarget = undefined;
}

// Bound how much of a composed status string is ever persisted -- a
// pathological/very long redacted error must not bloat db.json indefinitely.
const MAX_STATUS_LENGTH = 300;

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
 * SF4 defense-in-depth: after a download completes, verify every file that
 * landed directly in the channel dir still resolves (following symlinks)
 * under that same dir's real path -- `resolveChannelDir` + yt-dlp's own
 * `--restrict-filenames` already prevent an escape any other way, so this can
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
    activity.setSubscription(sub.id, { state: 'error', error: status });
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
    activity.setSubscription(sub.id, { state: 'done', percent: 100 });
    return 'ok: no new videos';
  }

  // FR-E: `total` is set BEFORE the download await so the very first status
  // poll after this point already reflects the real target count; `index`
  // starts at 0 (yt-dlp's own `Downloading item N of M` progress lines --
  // parsed by lib/ytdlp/progress.js -- update it as the download proceeds).
  activity.setSubscription(sub.id, { state: 'downloading', total: survivorIds.length, index: 0, percent: 0 });
  const onProgress = (patch) => activity.setSubscription(sub.id, patch);

  // ONE `runDownload` call, scoped to exactly `survivorIds` (C1) --
  // `--download-archive` still dedups within that set and remains the single
  // authoritative dedup mechanism (FR4); the JS `isArchived` pre-check above
  // is a redundant-but-cheap short-circuit, not a second source of truth.
  const downloadResult = await run.runDownload(sub, config, survivorIds, { onProgress });

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
    const status = safeErrorStatus(downloadResult.error, config);
    activity.setSubscription(sub.id, { state: 'error', error: status });
    return status;
  }

  activity.setSubscription(sub.id, { state: 'done', percent: 100 });
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
 */
async function processSubscription(deps, config, sub) {
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
    if (sub && sub.id) activity.setSubscription(sub.id, { state: 'error', error: lastStatus });
    console.error(`yt-dlp: poll failed for subscription ${sub && sub.id} (logging and continuing to the next subscription):`, lastStatus);
  }

  try {
    await store.setSubscriptionStatus(deps, sub.id, {
      lastCheckedAt: new Date().toISOString(),
      lastStatus,
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
 */
async function runPoll(deps, config, subId) {
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
        // FR-E: queued the instant this poll starts working through its
        // target list -- even a sub still waiting its turn (behind an
        // earlier one, or behind an in-flight one-shot via runExclusive
        // above) already reads as "queued" rather than stale/idle.
        activity.setSubscription(sub.id, { state: 'queued' });
        // Intentionally sequential (one channel at a time, never
        // Promise.all/parallelized) -- see the function doc comment above.
        await processSubscription(deps, config, sub);
      }
    });
  } finally {
    // Always cleared -- even if a bug somehow let a rejection escape
    // `processSubscription` (it shouldn't; see its own try/catch), the
    // overlap guard must never wedge every future poll permanently.
    pollBusy = false;
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
// limit is needed at this scale (a home-server operator triggers at most a
// handful of these a minute).
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
 * FR-A: the one-shot background download worker. Runs entirely OUTSIDE the
 * HTTP request/response cycle (the route that queues this via `runExclusive`
 * has already responded `202` by the time this starts) -- so this function
 * has its OWN top-level try/catch and MUST NEVER let a rejection escape
 * uncaught: there is no request left to fail, and an unhandled rejection here
 * would crash the whole process (the Express-4 async-crash lesson this
 * codebase has hit before).
 *
 * Builds a SYNTHETIC, non-persisted "sub"-shaped object (`{ id: jobId, name:
 * folder, format, quality }`) so it can reuse EVERY existing arg-builder/
 * path-confinement/spawn primitive verbatim, exactly the way `store.js`'s
 * persisted subscription records do: `args.resolveChannelDir` (path
 * confinement via `.name`), `run.runDownload` ->
 * `args.buildYtdlpDownloadArgs` (`--restrict-filenames`, `--embed-metadata`/
 * `--embed-thumbnail`, `--download-archive` dedup, cookies redaction),
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
 */
async function runOneShot(deps, config, { videoId, watchUrl, format, quality, folder, jobId }) {
  activity.setOneShot(jobId, {
    state: 'downloading',
    title: null,
    index: 1,
    total: 1,
    percent: 0,
    label: folder,
    url: watchUrl,
  });

  try {
    const syntheticSub = { id: jobId, name: folder, format, quality };
    const onProgress = (patch) => activity.setOneShot(jobId, patch);

    // NFR1/AC 54-58: the SAME download primitive the poll loop uses --
    // arg-array/no-shell, `--` before the positional target, path
    // confinement, `--download-archive` dedup, cookies redaction, timeout +
    // SIGKILL are all inherited from `run.runDownload`/`args.js`, not
    // reimplemented here.
    const downloadResult = await run.runDownload(syntheticSub, config, [videoId], { onProgress });

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
      activity.setOneShot(jobId, { state: 'error', error: safeErrorStatus(downloadResult.error, config) });
      return;
    }

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
    activity.setOneShot(jobId, { state: 'error', error: status });
  }
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
  app.get('/api/subscriptions/health', (req, res) => {
    res.json({ enabled: true });
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
    res.json(store.listSubscriptions(deps));
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

  app.get('/api/subscriptions/settings', (req, res) => {
    res.json({ allowMembersOnly: store.getAllowMembersOnly(deps) });
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
    const folderName = typeof body.folder === 'string' && body.folder.trim() !== '' ? body.folder.trim() : 'One-Off';

    // AC55: confine the target folder BEFORE ever responding -- reuses the
    // EXACT SAME traversal guard subscription channel dirs get
    // (`resolveChannelDir`'s sanitize + resolved-path-under-root check). A
    // hostile folder value 400s here; it can never reach a spawn.
    try {
      args.resolveChannelDir(config, { name: folderName });
    } catch {
      return res.status(400).json({ error: 'folder is invalid' });
    }

    const jobId = crypto.randomUUID();
    activity.setOneShot(jobId, {
      state: 'queued',
      title: null,
      index: 1,
      total: 1,
      percent: 0,
      label: folderName,
      url: classification.watchUrl,
    });

    res.status(202).json({ accepted: true, jobId });

    // Fire-and-forget: `runOneShot` has its OWN top-level try/catch (it must
    // -- there is no request left to fail by the time it runs), and
    // `runExclusive`'s shared tail never carries a rejection forward either
    // (see its own comment above) -- this `.catch` is pure defense-in-depth
    // against a synchronous throw escaping before `runOneShot`'s own try
    // ever starts, mirroring the re-pull routes' `.catch` posture above.
    runExclusive(() => runOneShot(deps, config, {
      videoId: classification.videoId,
      watchUrl: classification.watchUrl,
      format,
      quality,
      folder: folderName,
      jobId,
    })).catch((err) => {
      console.error(`yt-dlp: one-shot ${jobId} background task failed unexpectedly:`, err && err.message);
      activity.setOneShot(jobId, { state: 'error', error: safeErrorStatus(err && err.message, config) });
    });
  });

  // ---- FR-E: live status snapshot ------------------------------------------
  //
  // Returns the EPHEMERAL in-process activity map (subscriptions + one-shots)
  // -- never persisted, never touches db.json. Registered inside this same
  // `isEnabled` gate, so it is equally absent (native 404) when the module is
  // disabled (AC2/32). Contains only titles/percent/state/label/url and a
  // redacted `error` string (never a raw error/stderr, never a cookies path
  // -- NFR3/AC31).
  app.get('/api/subscriptions/status', (req, res) => {
    res.json(activity.getSnapshot());
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
  MAX_STATUS_LENGTH,
  // Re-exported so `node:test` files can reach the pure helpers via
  // `require('../../lib/ytdlp')` without a second require of `./config`.
  parseYtdlpConfig,
  isEnabled,
};
