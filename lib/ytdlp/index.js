'use strict';

// Wiring surface for the optional yt-dlp subscription module. Requiring this
// file has NO side effects: it only defines functions. Every side effect
// (route registration, timer arming, and -- in later tasks -- directory
// creation/presence checks) lives behind a named function that early-returns
// when `isEnabled(config)` is false, mirroring server.js's
// `require.main === module` guard for process-lifecycle work. T1 lands only
// the dormant skeleton + the /health probe; CRUD, invocation, the real poll
// loop, and the UI are later tasks (T2-T6).

const { parseYtdlpConfig, isEnabled } = require('./config');

// Module-level poll-timer handle, mirroring server.js's `scanTimer` +
// armScanTimer()/currentScanTimer() shape (server.js:1121-1140) exactly: kept
// at module scope so repeated arm calls clear-then-re-arm rather than
// stacking intervals, and so `currentYtdlpPollTimer()` gives tests a single
// source of truth for "is a poll timer currently armed."
let ytdlpPollTimer = null;

// Inert placeholder for T4's real `runPoll()`. The timer must exist (so
// tests can assert armed-vs-null and `.unref()`-ness) but must do no real
// work -- no spawn, no fs, no persistence -- until T4 wires the download
// loop behind it.
function pollPlaceholder() {
  // Intentionally a no-op in T1.
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
}

/**
 * Arm (or clear) the background poll timer. Mirrors `armScanTimer()`
 * exactly: clear any existing timer first (so repeated calls re-arm rather
 * than stack), then arm a `.unref()`'d `setInterval` ONLY when the module is
 * enabled AND `pollMinutes > 0` (`0` means "manual re-pull only," mirroring
 * `scanIntervalMinutes`'s "0 = Off" convention); otherwise leaves it `null`.
 * `.unref()` so an armed timer never keeps the process -- or a test runner
 * that calls this directly -- alive. The binary-presence check that also
 * gates real arming arrives in T4; T1 gates on `enabled && pollMinutes > 0`
 * only.
 */
function armYtdlpTimer(config = parseYtdlpConfig()) {
  if (ytdlpPollTimer) {
    clearInterval(ytdlpPollTimer);
    ytdlpPollTimer = null;
  }
  if (isEnabled(config) && config.pollMinutes > 0) {
    ytdlpPollTimer = setInterval(pollPlaceholder, config.pollMinutes * 60 * 1000).unref();
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
 * Called only from server.js's `require.main === module` guard (process
 * lifecycle start), never at import time or module top-level -- so
 * requiring this module, or importing server.js for tests, never arms a
 * timer or touches the filesystem. Early-returns when disabled. When
 * enabled, T1 only arms the poll timer; the real presence check +
 * `db.folders` registration + initial poll are wired in T3/T4.
 */
function startBackground(deps = {}, config = parseYtdlpConfig()) {
  if (!isEnabled(config)) return;
  armYtdlpTimer(config);
}

module.exports = {
  registerRoutes,
  armYtdlpTimer,
  currentYtdlpPollTimer,
  startBackground,
  // Re-exported so `node:test` files can reach the pure helpers via
  // `require('../../lib/ytdlp')` without a second require of `./config`.
  parseYtdlpConfig,
  isEnabled,
};
