'use strict';

// v1.66 web push - delivery policy + the sender. Everything here is
// deps-injected (store, transport, SSRF guard, clock) so the whole policy
// is unit-testable without a network; server.js wires the real deps once at
// boot and triggers rounds DETACHED from the scan (never awaited there -
// the scan-coalescing state machine must not stall on a slow push service).
//
// Intake rulings implemented (exec plan v1.66):
//   P2 - <=COLLAPSE_MAX missed rows push individually; more push ONE
//        summary. Cursor advances to the newest either way on success.
//   P3 - 404/410 prune the subscription; 429 honors Retry-After as a
//        cooldown (default 10 min, cap 24 h); redirects are REFUSED (a
//        push service never redirects; following one would re-open the
//        SSRF door guardHop just closed); everything else skips the round
//        and the cursor retries naturally on the next feed event.

const https = require('node:https');
const { vapidAuthorizationFor } = require('./vapid');
const { encryptPushPayload } = require('./encrypt');

const COLLAPSE_MAX = 3;
// Must be >= the feed's own cap (NOTIFICATION_CAP = 200, lib/auth/store.js):
// the feed can never hold more rows than that, so a full read can never
// truncate and the cursor always reaches the newest row - which is what
// ruling P2 promises ("cursor advances to newest either way"). At 50 this
// was FALSE: the QA seat measured 120 missed rows produce a "50 new videos"
// banner with the cursor stranded at 50. The truncation re-run below is the
// belt to this suspenders.
const FEED_READ_LIMIT = 200;
const DEFAULT_COOLDOWN_MS = 10 * 60 * 1000;
const MAX_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10 * 1000;
const PUSH_TTL_SECONDS = 24 * 60 * 60;

// ---- pure policy -----------------------------------------------------------

// P2: what to send for a subscription's missed rows.
function decideDeliveries(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return { kind: 'none' };
  if (rows.length <= COLLAPSE_MAX) return { kind: 'individual', rows };
  return { kind: 'summary', count: rows.length, maxId: rows[rows.length - 1].id };
}

// P3: what a push-service response means. Returns one of:
//   { action: 'ok' } | { action: 'prune' } | { action: 'skip' }
//   { action: 'cooldown', until: <epoch ms> }
function classifyPushResponse(statusCode, retryAfterHeader, nowMs) {
  if (statusCode >= 200 && statusCode < 300) return { action: 'ok' };
  if (statusCode === 404 || statusCode === 410) return { action: 'prune' };
  if (statusCode === 429) {
    let waitMs = DEFAULT_COOLDOWN_MS;
    if (typeof retryAfterHeader === 'string' && retryAfterHeader.length > 0) {
      const secs = Number(retryAfterHeader);
      if (Number.isFinite(secs) && secs > 0) {
        waitMs = secs * 1000;
      } else {
        const dateMs = Date.parse(retryAfterHeader);
        if (Number.isFinite(dateMs) && dateMs > nowMs) waitMs = dateMs - nowMs;
      }
    }
    return { action: 'cooldown', until: nowMs + Math.min(waitMs, MAX_COOLDOWN_MS) };
  }
  // 3xx deliberately lands here: redirects are refused, never followed.
  return { action: 'skip' };
}

// The per-user opt-out (mirrored setting; absent = on).
function pushOptedOut(settingsJson) {
  try {
    return JSON.parse(settingsJson || '{}').pushEnabled === 'off';
  } catch {
    return false;
  }
}

// ---- default transport -----------------------------------------------------

// One POST, no redirect following (https.request never follows - and
// classifyPushResponse treats any 3xx as a refusal), hard timeout, body
// discarded (only status + headers matter).
function defaultTransport({ url, headers, body }) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: 'POST', headers, timeout: REQUEST_TIMEOUT_MS }, (res) => {
      res.resume(); // drain; the response body is irrelevant
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('push endpoint timeout')));
    req.on('error', reject);
    req.end(body);
  });
}

// ---- the delivery round ----------------------------------------------------

// deps: {
//   store,        // userStore (roster, feed reads, cursor/cooldown/prune)
//   vapidKeys,    // { privateJwk, publicKeyB64url, subject } from resolveVapidKeys
//   guardHop,     // async (url) => { ok } - the SSRF predicate (lib/ytdlp/shortlink)
//   enabled,      // () => boolean - notificationsFeatureEnabled against the live db
//   resolveMeta,  // (mediaId) => { title, channel } | null
//   transport,    // optional override (tests); defaults to defaultTransport
//   now,          // optional clock override
//   log,          // optional logger
// }
function createPushDelivery(deps) {
  const transport = deps.transport || defaultTransport;
  const now = deps.now || Date.now;
  const log = deps.log || ((...a) => console.error(...a));

  async function sendOne(sub, payloadObj, nowMs) {
    const body = encryptPushPayload(JSON.stringify(payloadObj), sub.p256dh, sub.auth);
    const headers = {
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      'Content-Length': body.length,
      TTL: PUSH_TTL_SECONDS,
      Urgency: 'normal',
      Authorization: vapidAuthorizationFor(sub.endpoint, {
        privateJwk: deps.vapidKeys.privateJwk,
        publicKeyB64url: deps.vapidKeys.publicKeyB64url,
        subject: deps.vapidKeys.subject,
        nowMs,
      }),
    };
    let res;
    try {
      res = await transport({ url: sub.endpoint, headers, body });
    } catch (err) {
      log(`[push] ${sub.endpoint.slice(0, 40)}...: transport error (skipping round): ${err && err.message}`);
      return { action: 'skip' };
    }
    return classifyPushResponse(res.statusCode, res.headers && res.headers['retry-after'], nowMs);
  }

  function payloadForRow(row) {
    const meta = deps.resolveMeta(row.mediaId);
    if (!meta) return null; // pruned between feed insert and delivery - skip the row
    return {
      title: String(meta.title || 'New video').slice(0, 120),
      body: String(meta.channel || 'FileTube').slice(0, 120),
      url: `/watch.html?id=${encodeURIComponent(row.mediaId)}`,
    };
  }

  // Apply a classified result to a subscription; returns false when the
  // subscription is done for this round (pruned/cooling/skipped).
  function applyResult(result, sub, advanceToId) {
    if (result.action === 'ok') {
      if (Number.isInteger(advanceToId)) deps.store.advancePushCursor(sub.endpoint, advanceToId);
      return true;
    }
    if (result.action === 'prune') deps.store.removePushSubscription(sub.endpoint);
    if (result.action === 'cooldown') deps.store.setPushCooldown(sub.endpoint, result.until);
    return false;
  }

  async function deliverRound() {
    const counters = { sent: 0, pruned: 0, skipped: 0, truncated: false };
    let truncated = false;
    if (!deps.enabled()) return counters;
    const nowMs = now();
    for (const sub of deps.store.listPushSubscriptionsForDelivery()) {
      if (sub.cooldownUntil > nowMs) { counters.skipped++; continue; }
      if (pushOptedOut(sub.settingsJson)) continue;
      const rows = deps.store.listNotificationsAfter(sub.lastPushedId, FEED_READ_LIMIT);
      if (rows.length === 0) continue;
      // Belt to FEED_READ_LIMIT's suspenders: if a read ever comes back
      // exactly full, more rows may be waiting behind it - ask for another
      // round rather than stranding the cursor mid-gap.
      if (rows.length === FEED_READ_LIMIT) truncated = true;
      // Delivery-time SSRF re-check (the subscribe-time check is not enough:
      // DNS can change between then and now). A refused endpoint is DEAD,
      // not retried - prune it.
      const guard = await deps.guardHop(sub.endpoint);
      if (!guard.ok) {
        deps.store.removePushSubscription(sub.endpoint);
        counters.pruned++;
        log(`[push] pruned subscription (endpoint refused by guard): ${guard.error || 'refused'}`);
        continue;
      }
      const decision = decideDeliveries(rows);
      if (decision.kind === 'summary') {
        const result = await sendOne(sub, {
          title: `${decision.count} new videos`,
          body: 'FileTube',
          url: '/',
        }, nowMs);
        if (applyResult(result, sub, decision.maxId)) counters.sent++;
        else if (result.action === 'prune') counters.pruned++;
        else counters.skipped++;
      } else {
        for (const row of decision.rows) {
          const payload = payloadForRow(row);
          if (!payload) {
            // Row's media vanished: advance past it, nothing to say.
            deps.store.advancePushCursor(sub.endpoint, row.id);
            continue;
          }
          const result = await sendOne(sub, payload, nowMs);
          if (applyResult(result, sub, row.id)) {
            counters.sent++;
          } else {
            if (result.action === 'prune') counters.pruned++;
            else counters.skipped++;
            break; // stop at first failure; cursor holds at the last success
          }
        }
      }
    }
    counters.truncated = truncated;
    return counters;
  }

  // The detached trigger: coalesces overlapping rounds (two scans finishing
  // close together must not double-send - the second request re-runs after
  // the first completes and reads the advanced cursors).
  let running = false;
  let again = false;
  function trigger(reason) {
    if (running) { again = true; return; }
    running = true;
    setImmediate(async () => {
      try {
        do {
          again = false;
          const c = await deliverRound();
          // A full-limit read means rows may still be queued behind it -
          // re-run rather than strand the cursor mid-gap (QA W3).
          if (c.truncated) again = true;
          if (c.sent > 0 || c.pruned > 0) log(`[push] round (${reason}): sent=${c.sent} pruned=${c.pruned} skipped=${c.skipped}`);
        } while (again);
      } catch (err) {
        log(`[push] delivery round failed (feed intact, will retry on next event): ${err && err.message}`);
      } finally {
        running = false;
      }
    });
  }

  return { deliverRound, trigger, __sendOneForTests: sendOne };
}

module.exports = {
  createPushDelivery,
  defaultTransport,
  decideDeliveries,
  classifyPushResponse,
  pushOptedOut,
  COLLAPSE_MAX,
  FEED_READ_LIMIT,
  DEFAULT_COOLDOWN_MS,
  MAX_COOLDOWN_MS,
  PUSH_TTL_SECONDS,
};
