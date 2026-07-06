'use strict';

// Wiring surface for the optional yt-dlp subscription module. Requiring this
// file has NO side effects: it only defines functions. Every side effect
// (route registration, timer arming, directory creation/presence checks, and
// the download loop itself) lives behind a named function that early-returns
// when `isEnabled(config)` is false, mirroring server.js's
// `require.main === module` guard for process-lifecycle work.

const fs = require('fs');
const path = require('path');
const { parseYtdlpConfig, isEnabled } = require('./config');
const store = require('./store');
const rules = require('./rules');
const args = require('./args');
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
    // skipped here. Plain directories are skipped (yt-dlp's `-o` template
    // never creates one; nothing to quarantine there).
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
 * Concurrency note (the v1.9.0 lesson): NOTHING in this function touches
 * `updateDatabase` -- `runList`/`runDownload` are plain awaited child-process
 * calls, and `store.getAllowMembersOnly` is a read-only `loadDatabase` call
 * (no lock). The ONLY `updateDatabase` call for this subscription happens in
 * `processSubscription`, AFTER this function has fully settled -- so the
 * serialized-writer lock is never held across a `runList`/`runDownload`
 * await.
 */
async function runSubscriptionCycle(deps, config, sub) {
  const listResult = await run.runList(sub, config);
  if (!listResult.ok) {
    return safeErrorStatus(listResult.error, config);
  }

  const videos = rules.parseYtdlpVideoList(listResult.stdout);
  const archiveText = readArchiveTextSafely(config);
  const allowMembersOnly = Boolean(store.getAllowMembersOnly(deps));
  const cookiesConfigured = Boolean(config && config.cookiesFile);

  let survivorCount = 0;
  for (const video of videos) {
    const id = video && typeof video.id === 'string' ? video.id : null;
    const extractor = (video && (video.extractor_key || video.extractor)) || 'youtube';

    // Filter order (design-mandated): dedup -> premiere-defer -> members/
    // availability skip. A video that fails an earlier check is never
    // evaluated against a later one.
    if (id && rules.isArchived(archiveText, extractor, id)) continue;
    if (rules.shouldDeferPremiere(video, Date.now())) continue;
    const decision = rules.shouldSkip(video, { allowMembersOnly, cookiesConfigured });
    if (decision.skip) {
      console.log(`yt-dlp: skipping video ${id || '(unknown id)'} for subscription ${sub.id}: ${decision.reason}`);
      continue;
    }
    survivorCount += 1;
  }

  if (survivorCount === 0) {
    return 'ok: no new videos';
  }

  // A single `runDownload` call handles every survivor for this channel:
  // yt-dlp itself re-walks the channel and, via `--download-archive`, only
  // actually fetches ids not already recorded there -- our own JS-side
  // `isArchived` pre-check above is a redundant-but-cheap short-circuit, not
  // a second source of truth (FR4: yt-dlp's archive is the ONE dedup
  // mechanism).
  const downloadResult = await run.runDownload(sub, config);
  if (!downloadResult.ok) {
    return safeErrorStatus(downloadResult.error, config);
  }

  try {
    const channelDir = args.resolveChannelDir(config, sub);
    const quarantined = quarantineEscapedDownloads(channelDir);
    if (quarantined > 0) {
      return `ok: downloaded, but ${quarantined} file(s) quarantined (path confinement)`;
    }
  } catch (err) {
    // The confinement RE-check itself failing (e.g. the dir vanished between
    // download and check) must not be reported as a download failure -- log
    // it distinctly and still report the download as successful.
    console.error(`yt-dlp: post-download confinement check failed for subscription ${sub.id}:`, err && err.code);
  }

  return `ok: downloaded ${survivorCount} new video(s)`;
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
 * Returns `{ started: false, reason: 'busy' }` if a poll is already running
 * (the overlap guard coalesced this trigger to a no-op) or
 * `{ started: false, reason: 'not-found' }` if `subId` doesn't match any
 * subscription (callers map this to a 404); otherwise
 * `{ started: true, count }` once every targeted subscription has been
 * processed (each one already had its own status persisted and scan
 * triggered by the time this resolves).
 */
async function runPoll(deps, config, subId) {
  if (pollBusy) {
    console.log('yt-dlp: a poll is already running; this trigger is coalesced (no-op)');
    return { started: false, reason: 'busy' };
  }

  const allSubs = store.listSubscriptions(deps);
  let targets = allSubs;
  if (subId !== undefined && subId !== null) {
    const match = allSubs.find((s) => s.id === subId);
    if (!match) return { started: false, reason: 'not-found' };
    targets = [match];
  }

  pollBusy = true;
  try {
    for (const sub of targets) {
      // Intentionally sequential (one channel at a time, never
      // Promise.all/parallelized) -- see the function doc comment above.
      await processSubscription(deps, config, sub);
    }
  } finally {
    // Always cleared -- even if a bug somehow let a rejection escape
    // `processSubscription` (it shouldn't; see its own try/catch), the
    // overlap guard must never wedge every future poll permanently.
    pollBusy = false;
  }

  return { started: true, count: targets.length };
}

// Test-observability accessor, mirroring `currentYtdlpPollTimer`/
// `currentScanTimer`: exposes whether a poll is currently in flight without
// reaching into module internals.
function isPollBusy() {
  return pollBusy;
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
      res.json({ success: true });
    } catch (err) {
      console.error('Error deleting subscription:', err);
      res.status(500).json({ error: `Could not delete subscription: ${err.message}` });
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
 * Idempotently register `config.downloadDir` into `db.folders` (via
 * `updateDatabase`) so the EXISTING scanner covers the download root with
 * ZERO scanner changes (AC 17) -- and make sure the directory actually
 * exists on disk first, mirroring server.js's own startup
 * mkdir-if-missing pattern for DATA_DIR/THUMBNAIL_DIR/TRANSCODE_DIR. Only
 * ever called from `startBackground`'s `isEnabled` gate, so a disabled
 * module never creates this directory or touches `db.folders`.
 */
function ensureDownloadDirRegistered(config, deps) {
  const downloadDir = config && config.downloadDir;
  if (typeof downloadDir !== 'string' || downloadDir.trim() === '') return Promise.resolve();

  try {
    fs.mkdirSync(downloadDir, { recursive: true });
  } catch (err) {
    console.error('yt-dlp: could not create the download directory; subscriptions may fail until it exists:', err && err.code);
  }

  if (!deps || typeof deps.updateDatabase !== 'function') return Promise.resolve();

  return deps.updateDatabase((db) => {
    if (!Array.isArray(db.folders)) db.folders = [];
    if (db.folders.includes(downloadDir)) return false; // already registered -- idempotent no-op
    db.folders.push(downloadDir);
  });
}

/**
 * Called only from server.js's `require.main === module` guard (process
 * lifecycle start), never at import time or module top-level -- so
 * requiring this module, or importing server.js for tests, never arms a
 * timer, creates a directory, or touches `db.folders`. Early-returns when
 * disabled. When enabled: ensures the download dir exists and is registered
 * into `db.folders` (fire-and-forget, `.catch`-guarded -- this function's own
 * call sites in server.js don't await it either, matching the existing
 * `scanDirectories()`/`armScanTimer()` startup calls), then arms the real
 * poll timer with `deps` wired through so its interval callback can actually
 * run `runPoll`.
 */
function startBackground(deps = {}, config = parseYtdlpConfig()) {
  if (!isEnabled(config)) return;
  ensureDownloadDirRegistered(config, deps).catch((err) => {
    console.error('yt-dlp: failed to register the download directory:', err && err.message);
  });
  armYtdlpTimer(config, deps);
}

module.exports = {
  registerRoutes,
  armYtdlpTimer,
  currentYtdlpPollTimer,
  startBackground,
  runPoll,
  isPollBusy,
  // Re-exported so `node:test` files can reach the pure helpers via
  // `require('../../lib/ytdlp')` without a second require of `./config`.
  parseYtdlpConfig,
  isEnabled,
};
