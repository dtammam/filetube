'use strict';

// v1.78 device handoff - the PRESENCE store. Ephemeral, in-memory, per-user
// knowledge of "what is playing RIGHT NOW, on which device".
//
// WHY this is not in the database: presence is a liveness signal, not a
// fact worth persisting. Position is ALREADY durable (the progress
// coalescer + effectiveProgress), so a server restart that drops presence
// costs the user nothing but the discovery card - resume itself still
// works off the persisted progress. That degradation is the design
// (Dean's intake ruling 5), which is why this wave ships with NO schema
// migration.
//
// Shape: Map<userId, Map<deviceId, entry>>, entry =
//   {deviceId, deviceLabel, mediaId, kind, position, duration, state,
//    lastSeenAt, orderTok}
// REAL Maps, deliberately, at BOTH levels (the v1.42 row-key lesson): a
// deviceId or mediaId of '__proto__'/'constructor' is just a key here, and
// there is no plain-object index anywhere in the chain to inherit through.
//
// The store is PURE of transport concerns - it never sees a request, never
// resolves a title, never renders. server.js validates auth and resolves
// display metadata; this module owns liveness semantics and only those.

// --- Tunables (initial values from the exec plan; a change needs a reason
// recorded in the commit, per the plan's "tune only with reason"). ---

// A 'playing' entry is only believed to still BE playing while pings keep
// arriving. The client pings every ~4s, so 15s tolerates three consecutive
// lost pings before we downgrade the display to "paused".
const ACTIVE_TTL_MS = 15 * 1000;

// How long a stopped entry lingers before it expires entirely. This is the
// whole point of the feature: Dean pauses on the iPhone, walks to the PC,
// and the card is still there when he sits down.
const LINGER_TTL_MS = 30 * 60 * 1000;

// Hard cap on devices tracked per user, evicting the least-recently-seen.
// Incognito tabs mint a fresh UUID on every launch, so without this the map
// grows without bound for one determined user (named attack surface #1).
const DEVICE_CAP = 8;

// Length caps on every client-supplied string that reaches the map or the
// card. The label is rendered (as textContent, never HTML) so it is capped
// tight; ids are md5 hex in practice and capped well above that.
const LABEL_MAX = 32;
const DEVICE_ID_MAX = 64;
const MEDIA_ID_MAX = 128;

// The media kinds that carry a player and therefore a presence. This is the
// first-class-kind roster minus books (a different resume model - reading
// position is not "playing"), per intake ruling 1.
const KINDS = new Set(['media', 'podcast', 'track']);

// deviceId charset: what crypto.randomUUID() emits, plus the underscore, so
// a hand-rolled fallback id still fits. Anything else is refused outright
// rather than sanitized - a device that cannot name itself legibly simply
// gets no presence, which is a graceful loss, not an error.
const DEVICE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

// Characters stripped from a label rather than refused - a label is
// cosmetic and one stray character should not cost the user their handoff
// card. Written as \u escapes, NEVER as raw bytes (the v1.37.5 rule: no
// control characters in source; a raw NUL in this file even defeats grep).
// The set: C0/DEL controls, zero-width and bidi MARKS (200B-200F), the line
// and paragraph separators, and the bidi OVERRIDES (202A-202E) - the last
// group matters because the label is rendered next to other text and an
// override would let it reorder its neighbours on screen.
// eslint-disable-next-line no-control-regex
const LABEL_STRIP_RE = /[\u0000-\u001F\u007F\u200B-\u200F\u2028\u2029\u202A-\u202E]/g;

const FALLBACK_LABEL = 'Another device';

function str(v) {
  return typeof v === 'string' ? v : '';
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

// Normalize a client-supplied device label into something safe to render.
// Returns the fallback for anything empty after stripping - never null, so
// the card always has a headline.
function normalizeLabel(raw) {
  const cleaned = str(raw).replace(LABEL_STRIP_RE, '').trim();
  if (!cleaned) return FALLBACK_LABEL;
  return cleaned.length > LABEL_MAX ? cleaned.slice(0, LABEL_MAX) : cleaned;
}

// The DERIVED state a reader sees, which is not always the state that was
// written: a 'playing' entry whose pings stopped decays to 'paused' after
// ACTIVE_TTL. That decay is what covers the app-killed case (ruling 5) -
// no beacon ever arrives, and we must not claim the phone is still playing.
function derivedState(entry, now) {
  if (entry.state === 'paused') return 'paused';
  return (now - entry.lastSeenAt) <= ACTIVE_TTL_MS ? 'playing' : 'paused';
}

function isExpired(entry, now) {
  return (now - entry.lastSeenAt) > LINGER_TTL_MS;
}

/**
 * Build a presence store. `now` is injectable so the TTL behavior can be
 * tested with a fake clock instead of real sleeps.
 */
function createPresenceStore(options) {
  const opts = options || {};
  const clock = typeof opts.now === 'function' ? opts.now : Date.now;
  const deviceCap = Number.isInteger(opts.deviceCap) && opts.deviceCap > 0 ? opts.deviceCap : DEVICE_CAP;

  /** @type {Map<any, Map<string, object>>} */
  const byUser = new Map();

  // Drop expired entries for one user, and the user's map itself once empty.
  // Called on every read AND every write, which is why there is no sweeper
  // timer: at this scale (a handful of devices per user) the work is
  // trivial and it keeps the module free of lifecycle/teardown concerns.
  function pruneUser(userId, now) {
    const devices = byUser.get(userId);
    if (!devices) return null;
    for (const [deviceId, entry] of devices) {
      if (isExpired(entry, now)) devices.delete(deviceId);
    }
    if (devices.size === 0) {
      byUser.delete(userId);
      return null;
    }
    return devices;
  }

  // Evict least-recently-seen until a NEW device fits under the cap. An
  // existing device updating in place never evicts anything (it re-uses its
  // key), which is why this runs only on the insert path.
  function evictToCap(devices) {
    while (devices.size >= deviceCap) {
      let oldestId = null;
      let oldestAt = Infinity;
      for (const [deviceId, entry] of devices) {
        if (entry.lastSeenAt < oldestAt) {
          oldestAt = entry.lastSeenAt;
          oldestId = deviceId;
        }
      }
      if (oldestId === null) return; // unreachable while size > 0; belt and braces
      devices.delete(oldestId);
    }
  }

  /**
   * Record a presence event (a progress ping, or an explicit pause beacon).
   *
   * Returns true if the event was stored, false if it was refused or
   * ignored. Callers deliberately do NOT surface that boolean to the
   * client: presence is a side effect of the progress ping, and a refused
   * presence must never change the ping's own status code (named attack
   * surface #5 - backward compatibility of the three progress handlers).
   *
   * `at` is a CLIENT-supplied ordering token (the device's own clock in ms),
   * used ONLY to reject out-of-order updates from the same device - a pause
   * beacon and a play ping race constantly because sendBeacon is
   * fire-and-forget (named attack surface #6). It never reaches the UI:
   * everything displayed is stamped from the SERVER clock, so a device with
   * a wrong clock can skew nothing but its own event ordering.
   */
  function record(userId, event) {
    if (userId === undefined || userId === null) return false;
    const ev = event || {};

    const deviceId = str(ev.deviceId);
    if (!DEVICE_ID_RE.test(deviceId) || deviceId.length > DEVICE_ID_MAX) return false;

    const mediaId = str(ev.mediaId);
    if (!mediaId || mediaId.length > MEDIA_ID_MAX) return false;

    const kind = KINDS.has(ev.kind) ? ev.kind : 'media';
    const state = ev.state === 'paused' ? 'paused' : 'playing';
    const now = clock();

    // The ordering token falls back to the server clock when the client
    // omits or garbles it. Server time and device time are different scales,
    // but they never mix WITHIN one device: the same client code always
    // sends the same flavor for a given deviceId.
    const orderTok = Number.isFinite(Number(ev.at)) ? Number(ev.at) : now;

    let devices = pruneUser(userId, now);
    if (!devices) {
      devices = new Map();
      byUser.set(userId, devices);
    }

    const existing = devices.get(deviceId);
    // Strictly-older events lose. Equal tokens win, so a client whose clock
    // has no sub-second resolution still lands its latest event.
    if (existing && orderTok < existing.orderTok) return false;

    if (!existing) evictToCap(devices);

    devices.set(deviceId, {
      deviceId,
      deviceLabel: normalizeLabel(ev.deviceLabel),
      mediaId,
      kind,
      position: num(ev.position),
      duration: num(ev.duration),
      state,
      lastSeenAt: now,
      orderTok,
    });
    return true;
  }

  /**
   * The most recent presence for `userId` that did NOT come from
   * `requestingDeviceId` - the card must never offer a device its own
   * playback (AC7). A blank/absent requesting id excludes nothing, which is
   * correct: a caller that cannot identify itself still gets to see that
   * SOMETHING is playing, it just risks seeing itself.
   *
   * Returns null when there is nothing to offer. The returned object is a
   * fresh COPY carrying the DERIVED state and a server-computed age - the
   * caller can decorate it (title, thumbnail) without touching the store.
   */
  function readOther(userId, requestingDeviceId) {
    const now = clock();
    const devices = pruneUser(userId, now);
    if (!devices) return null;

    const selfId = str(requestingDeviceId);
    let best = null;
    for (const entry of devices.values()) {
      if (selfId && entry.deviceId === selfId) continue;
      if (!best || entry.lastSeenAt > best.lastSeenAt) best = entry;
    }
    if (!best) return null;

    return {
      deviceId: best.deviceId,
      deviceLabel: best.deviceLabel,
      mediaId: best.mediaId,
      kind: best.kind,
      position: best.position,
      duration: best.duration,
      state: derivedState(best, now),
      ageSeconds: Math.max(0, Math.round((now - best.lastSeenAt) / 1000)),
    };
  }

  // Drop one device's presence outright (logout, or a client saying "I am
  // done"). Silent no-op when there is nothing to forget.
  function forget(userId, deviceId) {
    const devices = byUser.get(userId);
    if (!devices) return false;
    const removed = devices.delete(str(deviceId));
    if (devices.size === 0) byUser.delete(userId);
    return removed;
  }

  // Test/introspection surface: how many devices are tracked for a user
  // (after pruning), and how many users the map holds. The cap test binds
  // on these, so they are part of the module's contract, not a debug hatch.
  function deviceCount(userId) {
    const devices = pruneUser(userId, clock());
    return devices ? devices.size : 0;
  }

  function userCount() {
    return byUser.size;
  }

  function clear() {
    byUser.clear();
  }

  return { record, readOther, forget, deviceCount, userCount, clear };
}

module.exports = {
  createPresenceStore,
  normalizeLabel,
  ACTIVE_TTL_MS,
  LINGER_TTL_MS,
  DEVICE_CAP,
  LABEL_MAX,
  DEVICE_ID_MAX,
  MEDIA_ID_MAX,
  FALLBACK_LABEL,
  KINDS,
};
