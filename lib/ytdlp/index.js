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
const store = require('./store');

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

  // ---- CRUD + settings (T2) -----------------------------------------------
  // All registered here, inside the same `isEnabled` gate as `/health` above,
  // so they are equally absent (native Express 404) when the module is
  // disabled -- no separate no-op guard is needed per-route.

  app.get('/api/subscriptions', (req, res) => {
    res.json(store.listSubscriptions(deps));
  });

  app.post('/api/subscriptions', async (req, res) => {
    // BASIC shape check ONLY (non-empty string, http/https scheme) -- see
    // store.js's `isBasicHttpUrl`/`validateSubscriptionInput` comment. The
    // full YouTube allowlist + normalization + metacharacter rejection is
    // lib/ytdlp/url.js's `validateChannelUrl` (T3's deliverable, deliberately
    // NOT created here to avoid a T2/T3 merge collision over the same
    // validator surface); T3 upgrades this route to call it.
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
