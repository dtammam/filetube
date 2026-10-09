'use strict';

// lib/feed/served.js - v1.379.0 Feed mode, plan D5: the served-position registry.
//
// A feed card is served with the user's stored position as it was at that moment.
// The feed may move that position only while the stored record is STILL the one
// the card was built from - if another device read or listened on in between, the
// stored `updatedAt` differs from the served one and the write is refused as
// stale (lib/feed/safe-progress.js). Each successful feed write advances the
// registry to the new `updatedAt`, so a card's later pings stay in the chain.
//
// Per process and per user: the registry is memory, bounded by entries and age.
// A server restart empties it, so a card served before the restart cannot write
// until a new card is served ('unknown' - a deliberate fail-closed, disclosed in
// the plan's evidence). Keys are composed with a separator no id contains.

const DEFAULT_MAX_ENTRIES = 4000;
const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000; // a feed session is minutes; six hours is generous

function keyOf(userId, kind, id) {
  return `${userId}\u0000${kind}\u0000${id}`;
}

function normalizeStamp(updatedAt) {
  return typeof updatedAt === 'string' && updatedAt !== '' ? updatedAt : '';
}

function createServedRegistry({ now = () => Date.now(), maxEntries = DEFAULT_MAX_ENTRIES, ttlMs = DEFAULT_TTL_MS } = {}) {
  const map = new Map(); // key -> { stamp, at }

  function prune() {
    const cutoff = now() - ttlMs;
    for (const [k, v] of map) {
      if (v.at < cutoff) map.delete(k);
    }
    while (map.size > maxEntries) {
      const oldest = map.keys().next().value;
      map.delete(oldest);
    }
  }

  return {
    /** A card for (kind, id) was served to `userId` from a record stamped `updatedAt` ('' = no record). */
    mark(userId, kind, id, updatedAt) {
      const k = keyOf(userId, kind, id);
      map.delete(k); // re-insert so insertion order is recency
      map.set(k, { stamp: normalizeStamp(updatedAt), at: now() });
      prune();
    },
    /**
     * 'ok' when the stored record's stamp is the served (or last feed-written) one,
     * 'stale' when it differs, 'unknown' when nothing was served (or it aged out).
     */
    status(userId, kind, id, storedUpdatedAt) {
      const k = keyOf(userId, kind, id);
      const v = map.get(k);
      if (!v) return 'unknown';
      if (v.at < now() - ttlMs) { map.delete(k); return 'unknown'; }
      return v.stamp === normalizeStamp(storedUpdatedAt) ? 'ok' : 'stale';
    },
    /** A feed write landed with `updatedAt`: the chain continues from it. */
    advance(userId, kind, id, updatedAt) {
      const k = keyOf(userId, kind, id);
      map.delete(k);
      map.set(k, { stamp: normalizeStamp(updatedAt), at: now() });
      prune();
    },
    forget(userId, kind, id) {
      map.delete(keyOf(userId, kind, id));
    },
    size() {
      return map.size;
    },
  };
}

module.exports = { createServedRegistry, DEFAULT_MAX_ENTRIES, DEFAULT_TTL_MS };
