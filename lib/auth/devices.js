'use strict';

// lib/auth/devices.js - per-device tokens (v1.387.0 offline playback, plan D1).
//
// The iOS app pairs once (POST /api/devices from the signed-in web view with
// the account's password) and holds a long-lived credential in its Keychain:
// `ftd_` + 32 random bytes (base64url). This module owns the `device_tokens`
// table (schema v37, lib/db/sqlite.js): the token is stored as its sha256 ONLY
// (a database read, a backup or a log can never yield a usable credential),
// bound to the USER row (so the gate sets req.user from it and every
// restriction applies, unlike the shared FILETUBE_API_TOKEN which leaves
// req.user unset and therefore sees everything), and stamped with the user's
// `device_epoch` at issue. Revocation is a row delete, an epoch bump (a
// password change the user or an admin makes, "Remove all devices"), the user
// being disabled or deleted (cascade), or 180 days unused.
//
// It does NOT require('node:sqlite') (the source lock keeps that to
// lib/db/sqlite.js); like lib/auth/store.js it prepares its statements against
// the adapter's warm connection. Crypto helpers come in through `deps` so the
// hash lookup's constant-time compare is the one lib/auth/crypto.js owns.
//
// Also here: the LIVE-RESPONSE registry. The gate checks a token only when a
// request starts, and a background download is one long response; the gate
// registers every response a device token opened and the revoke / epoch bump /
// disable / delete paths destroy them, so a revoked phone's download ends at
// once (plan D1, gate r1 W5).

const crypto = require('node:crypto');

const TOKEN_PREFIX = 'ftd_';
const MAX_LIVE_PER_USER = 20;
const UNUSED_EXPIRY_MS = 180 * 24 * 60 * 60 * 1000; // matches the 180-day cap on a cookie (gate.js SESSION_MAX_AGE_SECONDS)
const LAST_USED_WRITE_INTERVAL_MS = 10 * 60 * 1000; // a single offline video is ~800 range reads; stamp at most once per 10 min
const PLATFORMS = new Set(['ios']); // add-only
const NAME_MAX = 64;

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

// Only a Bearer value starting `ftd_` is ever CLAIMED by the device branch; any
// other Authorization header falls through untouched (an auth proxy's own
// Bearer must keep working for browsers, gate r1 W4).
function isDeviceToken(value) {
  return typeof value === 'string' && value.startsWith(TOKEN_PREFIX);
}

// The moment a row was last seen alive: last_used_at, else created_at.
function lastActivityMs(row) {
  const t = Date.parse(row.lastUsedAt || row.createdAt || '');
  return Number.isFinite(t) ? t : NaN;
}
function isExpired(row, nowMs) {
  const t = lastActivityMs(row);
  return !Number.isFinite(t) || nowMs - t > UNUSED_EXPIRY_MS;
}

function rowToDevice(r) {
  if (!r) return null;
  return {
    id: r.id,
    userId: r.user_id,
    tokenHash: r.token_hash,
    name: r.name,
    platform: r.platform,
    epoch: r.epoch,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
  };
}

// The projection the list routes return: never the hash.
function publicDevice(d) {
  return { id: d.id, name: d.name, platform: d.platform, createdAt: d.createdAt, lastUsedAt: d.lastUsedAt };
}

function statementsFor(adapter) {
  if (adapter.__deviceStmts) return adapter.__deviceStmts;
  const sql = adapter.sql;
  const s = {
    insert: sql.prepare('INSERT INTO device_tokens (user_id, token_hash, name, platform, epoch, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?, NULL)'),
    byHash: sql.prepare('SELECT * FROM device_tokens WHERE token_hash = ?'),
    byId: sql.prepare('SELECT * FROM device_tokens WHERE id = ?'),
    // Live = the row's epoch is the user's CURRENT epoch (an older epoch is a
    // revoked generation). Expiry is decided in JS against the caller's clock.
    liveForUser: sql.prepare('SELECT d.* FROM device_tokens d JOIN users u ON u.id = d.user_id WHERE d.user_id = ? AND d.epoch = u.device_epoch ORDER BY d.id'),
    allForUser: sql.prepare('SELECT d.*, u.device_epoch AS user_epoch FROM device_tokens d JOIN users u ON u.id = d.user_id WHERE d.user_id = ? ORDER BY d.id'),
    remove: sql.prepare('DELETE FROM device_tokens WHERE user_id = ? AND id = ?'),
    removeById: sql.prepare('DELETE FROM device_tokens WHERE id = ?'),
    removeByUser: sql.prepare('DELETE FROM device_tokens WHERE user_id = ?'),
    touch: sql.prepare('UPDATE device_tokens SET last_used_at = ? WHERE id = ?'),
    countAll: sql.prepare('SELECT COUNT(*) AS c FROM device_tokens'),
  };
  adapter.__deviceStmts = s;
  return s;
}

// `deps`: { generateSecret, tokensEqual } from lib/auth/crypto.js (injected so a
// unit test can pin the secret). `nowMs` is the clock (tests move it).
function createDeviceStore(adapter, deps, { nowMs = () => Date.now() } = {}) {
  const st = () => statementsFor(adapter);
  const { generateSecret, tokensEqual } = deps;

  // ---- the live-response registry (process-local) ---------------------------
  const openByDevice = new Map(); // deviceId -> Set<res>
  const devicesByUser = new Map(); // userId -> Set<deviceId>

  function untrack(deviceId, res) {
    const set = openByDevice.get(deviceId);
    if (!set) return;
    set.delete(res);
    if (set.size === 0) openByDevice.delete(deviceId);
  }
  function destroyAll(deviceId) {
    const set = openByDevice.get(deviceId);
    if (!set) return 0;
    const victims = [...set];
    openByDevice.delete(deviceId);
    for (const res of victims) {
      try { res.destroy(); } catch { /* already gone */ }
    }
    return victims.length;
  }

  return {
    TOKEN_PREFIX,
    MAX_LIVE_PER_USER,
    UNUSED_EXPIRY_MS,
    LAST_USED_WRITE_INTERVAL_MS,
    NAME_MAX,
    PLATFORMS,
    hashToken,
    isDeviceToken,
    isExpired,
    publicDevice,

    validName(name) {
      return typeof name === 'string' && name.trim().length >= 1 && name.trim().length <= NAME_MAX && !name.includes('\u0000');
    },
    validPlatform(platform) {
      return typeof platform === 'string' && PLATFORMS.has(platform);
    },

    // Issue a token for a user. Rows of an out-of-date epoch and expired rows
    // are pruned first (they never count toward the cap). Returns
    // { id, token, name, platform, createdAt } or null when the cap is hit.
    // `epoch` is the user's CURRENT device_epoch (the caller reads the row).
    issue({ userId, name, platform, epoch }, nowIso) {
      if (!Number.isInteger(userId) || userId <= 0) throw new Error('issue: invalid user id');
      if (!this.validName(name)) throw new Error('issue: invalid name');
      if (!this.validPlatform(platform)) throw new Error('issue: invalid platform');
      if (!Number.isInteger(epoch) || epoch < 0) throw new Error('issue: invalid epoch');
      const now = Date.parse(nowIso);
      const s = st();
      adapter.begin();
      try {
        let live = 0;
        for (const r of s.allForUser.all(userId)) {
          const d = rowToDevice(r);
          if (r.user_epoch !== d.epoch || isExpired(d, now)) s.removeById.run(d.id);
          else live += 1;
        }
        if (live >= MAX_LIVE_PER_USER) {
          adapter.rollback();
          return null;
        }
        const token = TOKEN_PREFIX + generateSecret();
        const res = s.insert.run(userId, hashToken(token), name.trim(), platform, epoch, nowIso);
        adapter.commit();
        return { id: Number(res.lastInsertRowid), token, name: name.trim(), platform, createdAt: nowIso };
      } catch (err) {
        adapter.rollback();
        throw err;
      }
    },

    // The gate's lookup: hash the presented value, point-query the UNIQUE
    // index, then compare the hashes in constant time (the row's hash against
    // the recomputed one, so the lookup cannot be used as an oracle on the
    // stored text). Returns the row (epoch, userId, stamps) or null; it does
    // NOT judge liveness - the gate re-reads the user and applies the epoch,
    // disabled and expiry rules there, where req.user is set.
    lookup(token) {
      if (!isDeviceToken(token)) return null;
      const h = hashToken(token);
      const row = rowToDevice(st().byHash.get(h));
      if (!row || !tokensEqual(row.tokenHash, h)) return null;
      return row;
    },
    byId(id) {
      if (!Number.isInteger(id) || id <= 0) return null;
      return rowToDevice(st().byId.get(id));
    },

    // The devices a user can see in Settings: current-epoch rows that have not
    // expired (an expired row is pruned as it is listed, so the list is honest).
    listForUser(userId) {
      if (!Number.isInteger(userId) || userId <= 0) return [];
      const now = nowMs();
      const out = [];
      for (const r of st().liveForUser.all(userId)) {
        const d = rowToDevice(r);
        if (isExpired(d, now)) { st().removeById.run(d.id); continue; }
        out.push(publicDevice(d));
      }
      return out;
    },

    // Revoke one of the user's own devices. True when a row went.
    remove(userId, deviceId) {
      if (!Number.isInteger(userId) || !Number.isInteger(deviceId)) return false;
      const res = st().remove.run(userId, deviceId);
      const went = res.changes > 0;
      if (went) destroyAll(deviceId);
      return went;
    },
    // Called when a row is found dead at the gate (expired): drop it.
    prune(deviceId) {
      if (!Number.isInteger(deviceId)) return;
      st().removeById.run(deviceId);
    },
    // "Remove all devices" / a user delete: drop every row of the user. The
    // caller ALSO bumps users.device_epoch (userStore.bumpDeviceEpoch) so a
    // row that raced in is dead too. Returns the number of rows removed.
    removeAllForUser(userId) {
      if (!Number.isInteger(userId)) return 0;
      const res = st().removeByUser.run(userId);
      this.cutUser(userId);
      return res.changes;
    },
    touch(deviceId, nowIso) {
      st().touch.run(nowIso, deviceId);
    },
    countAll() {
      return st().countAll.get().c;
    },

    // ---- live revocation ------------------------------------------------------
    // Register a response a device token opened; it is dropped from the registry
    // when the response closes (normally or not).
    track(deviceId, userId, res) {
      let set = openByDevice.get(deviceId);
      if (!set) { set = new Set(); openByDevice.set(deviceId, set); }
      set.add(res);
      let ids = devicesByUser.get(userId);
      if (!ids) { ids = new Set(); devicesByUser.set(userId, ids); }
      ids.add(deviceId);
      res.once('close', () => untrack(deviceId, res));
    },
    // End every open response of one device (a revoke). Returns the count ended.
    cutDevice(deviceId) {
      return destroyAll(deviceId);
    },
    // End every open response of every device of a user (epoch bump, disable, delete).
    cutUser(userId) {
      const ids = devicesByUser.get(userId);
      if (!ids) return 0;
      let n = 0;
      for (const id of ids) n += destroyAll(id);
      devicesByUser.delete(userId);
      return n;
    },
    openResponseCount(deviceId) {
      const set = openByDevice.get(deviceId);
      return set ? set.size : 0;
    },
  };
}

module.exports = {
  createDeviceStore,
  hashToken,
  isDeviceToken,
  isExpired,
  publicDevice,
  TOKEN_PREFIX,
  MAX_LIVE_PER_USER,
  UNUSED_EXPIRY_MS,
  LAST_USED_WRITE_INTERVAL_MS,
  NAME_MAX,
  PLATFORMS,
};
