'use strict';

// ---- v1.43 user + per-user-state store --------------------------------------
//
// Relational account data (users + per-user progress/liked/book-progress/
// pins) lives in the SQLite tables v1.42 created empty. This module owns the
// SQL for them. It does NOT require('node:sqlite') — the source-lock keeps
// that to lib/db/sqlite.js; instead it receives the adapter and prepares its
// statements against the adapter's warm connection (adapter.sql). server.js
// owns transport (routes, cookies); lib/auth/crypto.js owns the math; this
// owns storage.
//
// Design source: docs/exec-plans/active/v1.42-multiuser-tranche.md §v1.43 +
// its "design-delta review round" (the atomicity, no-id-reuse, and
// warm-connection contracts below are the reviewed spec).

// Lazily prepare (and cache) every statement against the adapter's handle.
// Prepared once per adapter, reused across requests — the WARM-connection
// point-query contract (design-delta SUGGESTION-6): NO full-db re-parse on a
// per-request tv check, even on range-heavy stream routes.
function statementsFor(adapter) {
  if (adapter.__authStmts) return adapter.__authStmts;
  const sql = adapter.sql;
  const s = {
    count: sql.prepare('SELECT COUNT(*) AS c FROM users'),
    byId: sql.prepare('SELECT * FROM users WHERE id = ?'),
    byUsername: sql.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE'),
    list: sql.prepare('SELECT id, username, display_name, role, can_manage_subscriptions, disabled, created_at FROM users ORDER BY id'),
    // Count-guarded insert (design-delta WARNING-4): the WHERE makes the
    // whole create-admin atomic in ONE synchronous statement — no await
    // between guard and insert, so two concurrent setups can never both win.
    // `changes` tells the caller whether the row landed.
    insertGuarded: sql.prepare(`
      INSERT INTO users (username, display_name, password_hash, role, can_manage_subscriptions, settings_json, token_version, disabled, created_at)
      SELECT ?, ?, ?, ?, ?, '{}', 0, 0, ?
      WHERE (SELECT COUNT(*) FROM users) = 0
    `),
    // v1.43 user-management: an admin adds users AFTER setup — no count
    // guard, the UNIQUE(username COLLATE NOCASE) constraint is the backstop.
    insertPlain: sql.prepare(`
      INSERT INTO users (username, display_name, password_hash, role, can_manage_subscriptions, settings_json, token_version, disabled, created_at)
      VALUES (?, ?, ?, ?, ?, '{}', 0, 0, ?)
    `),
    updatePassword: sql.prepare('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?'),
    setDisabled: sql.prepare('UPDATE users SET disabled = ?, token_version = token_version + 1 WHERE id = ?'),
    setRole: sql.prepare('UPDATE users SET role = ? WHERE id = ?'),
    setCanManageSubs: sql.prepare('UPDATE users SET can_manage_subscriptions = ? WHERE id = ?'),
    setSettings: sql.prepare('UPDATE users SET settings_json = ? WHERE id = ?'),
    del: sql.prepare('DELETE FROM users WHERE id = ?'),
    // Per-user progress (media)
    upsertProgress: sql.prepare(`
      INSERT INTO user_progress (user_id, media_id, timestamp, duration, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id, media_id) DO UPDATE SET timestamp = excluded.timestamp, duration = excluded.duration, updated_at = excluded.updated_at
    `),
    getProgress: sql.prepare('SELECT media_id, timestamp, duration, updated_at FROM user_progress WHERE user_id = ?'),
    getOneProgress: sql.prepare('SELECT timestamp, duration, updated_at FROM user_progress WHERE user_id = ? AND media_id = ?'),
    delProgress: sql.prepare('DELETE FROM user_progress WHERE user_id = ? AND media_id = ?'),
    // Media-id lifecycle (v1.43 chunk 4b): per-user rows are id-keyed carriers
    // exactly like db.progress/db.liked/db.viewCounts were, so every delete/
    // prune/move re-key site must carry them too (the v1.41.6 liked-drop /
    // v1.42 move-zeroes-viewCounts class, now on its SEVENTH strike memory).
    delProgressByMedia: sql.prepare('DELETE FROM user_progress WHERE media_id = ?'),
    delLikedByMedia: sql.prepare('DELETE FROM user_liked WHERE media_id = ?'),
    // OR REPLACE: if some user already has a row under the new id (an
    // in-flight ping re-keyed ahead of us), the re-key must not throw on the
    // PK collision -- last write wins, same as the pendingProgress overlay.
    rekeyProgress: sql.prepare('UPDATE OR REPLACE user_progress SET media_id = ? WHERE media_id = ?'),
    rekeyLiked: sql.prepare('UPDATE OR REPLACE user_liked SET media_id = ? WHERE media_id = ?'),
    // Per-user liked (membership)
    addLiked: sql.prepare('INSERT INTO user_liked (user_id, media_id, liked_at) VALUES (?, ?, ?) ON CONFLICT(user_id, media_id) DO NOTHING'),
    removeLiked: sql.prepare('DELETE FROM user_liked WHERE user_id = ? AND media_id = ?'),
    getLiked: sql.prepare('SELECT media_id FROM user_liked WHERE user_id = ? ORDER BY liked_at DESC, media_id'),
    // Per-user book progress
    upsertBookProgress: sql.prepare(`
      INSERT INTO user_book_progress (user_id, book_id, position_json, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, book_id) DO UPDATE SET position_json = excluded.position_json, updated_at = excluded.updated_at
    `),
    getBookProgress: sql.prepare('SELECT book_id, position_json, updated_at FROM user_book_progress WHERE user_id = ?'),
    // Per-user pins (book + channel)
    upsertBookPin: sql.prepare('INSERT INTO user_book_pins (user_id, pin_id, pin_json, pin_order) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, pin_id) DO UPDATE SET pin_json = excluded.pin_json, pin_order = excluded.pin_order'),
    getBookPins: sql.prepare('SELECT pin_json FROM user_book_pins WHERE user_id = ? ORDER BY pin_order, pin_id'),
    delBookPin: sql.prepare('DELETE FROM user_book_pins WHERE user_id = ? AND pin_id = ?'),
    upsertChannelPin: sql.prepare('INSERT INTO user_channel_pins (user_id, pin_id, pin_json, pin_order) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, pin_id) DO UPDATE SET pin_json = excluded.pin_json, pin_order = excluded.pin_order'),
    getChannelPins: sql.prepare('SELECT pin_json FROM user_channel_pins WHERE user_id = ? ORDER BY pin_order, pin_id'),
    delChannelPin: sql.prepare('DELETE FROM user_channel_pins WHERE user_id = ? AND pin_id = ?'),
  };
  adapter.__authStmts = s;
  return s;
}

// A stored users row → the shape the app passes around as req.user. Coerces
// the SQLite integer flags to booleans; never exposes password_hash beyond
// the auth layer that needs it.
function rowToUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    canManageSubscriptions: row.can_manage_subscriptions === 1,
    tokenVersion: row.token_version,
    disabled: row.disabled === 1,
    createdAt: row.created_at,
    settingsJson: row.settings_json,
    // password_hash intentionally carried on a SEPARATE accessor
    // (getPasswordHash) so a stray res.json(user) can never leak it.
  };
}

const VALID_USERNAME = /^[A-Za-z0-9._-]{1,64}$/;
const VALID_ROLE = new Set(['admin', 'member']);

function normalizeUsername(u) {
  return typeof u === 'string' ? u.trim() : '';
}

module.exports = function createUserStore(adapter) {
  const st = () => statementsFor(adapter);

  return {
    countUsers() {
      return st().count.get().c;
    },

    getById(id) {
      if (!Number.isInteger(id) || id <= 0) return null;
      return rowToUser(st().byId.get(id));
    },

    getByUsername(username) {
      const u = normalizeUsername(username);
      if (!u) return null;
      return rowToUser(st().byUsername.get(u));
    },

    // Only the auth verify path calls this; kept off the user object so
    // res.json(user) can never serialize a hash.
    getPasswordHash(id) {
      const row = st().byId.get(id);
      return row ? row.password_hash : null;
    },

    listUsers() {
      return st().list.all().map((r) => ({
        id: r.id, username: r.username, displayName: r.display_name,
        role: r.role, canManageSubscriptions: r.can_manage_subscriptions === 1,
        disabled: r.disabled === 1, createdAt: r.created_at,
      }));
    },

    validateUsername(username) {
      return VALID_USERNAME.test(normalizeUsername(username));
    },

    // ---- create-admin + adoption, ONE synchronous transaction (WARNING-4) --
    // `passwordHash` is computed by the ASYNC crypto BEFORE this call (no
    // await inside the tx). `adoption` carries the pre-read global state to
    // fold into the first admin: { progress, liked, bookProgress, bookPins,
    // channelPins }. Returns the created user, or null if a user already
    // existed (the count-guard fired) — the caller maps null → 409/redirect.
    createFirstAdmin({ username, displayName, passwordHash }, adoption, nowIso) {
      const u = normalizeUsername(username);
      if (!VALID_USERNAME.test(u) || typeof passwordHash !== 'string') {
        throw new Error('createFirstAdmin: invalid username or hash');
      }
      const s = st();
      const sql = adapter.sql;
      sql.exec('BEGIN IMMEDIATE');
      try {
        const res = s.insertGuarded.run(u, displayName || u, passwordHash, 'admin', 1, nowIso);
        if (res.changes !== 1) {
          // A user already existed — guard fired, nothing inserted.
          sql.exec('ROLLBACK');
          return null;
        }
        const id = Number(res.lastInsertRowid);
        adoptInto(s, id, adoption, nowIso);
        sql.exec('COMMIT');
        return this.getById(id);
      } catch (err) {
        sql.exec('ROLLBACK');
        throw err;
      }
    },

    // Admin-created member/admin (post-setup). Throws on a UNIQUE collision
    // (caller maps to 409). No adoption — a new user starts empty.
    createUser({ username, displayName, passwordHash, role = 'member', canManageSubscriptions = false }, nowIso) {
      const u = normalizeUsername(username);
      if (!VALID_USERNAME.test(u)) throw new Error('createUser: invalid username');
      if (!VALID_ROLE.has(role)) throw new Error('createUser: invalid role');
      if (typeof passwordHash !== 'string') throw new Error('createUser: invalid hash');
      const res = st().insertPlain.run(u, displayName || u, passwordHash, role, canManageSubscriptions ? 1 : 0, nowIso);
      return this.getById(Number(res.lastInsertRowid));
    },

    updatePassword(id, passwordHash) {
      st().updatePassword.run(passwordHash, id); // bumps token_version -> instant revocation
    },
    setDisabled(id, disabled) {
      st().setDisabled.run(disabled ? 1 : 0, id); // bumps token_version -> instant revocation
    },
    setRole(id, role) {
      if (!VALID_ROLE.has(role)) throw new Error('setRole: invalid role');
      st().setRole.run(role, id);
    },
    setCanManageSubscriptions(id, v) {
      st().setCanManageSubs.run(v ? 1 : 0, id);
    },
    setSettingsJson(id, json) {
      st().setSettings.run(typeof json === 'string' ? json : JSON.stringify(json || {}), id);
    },
    deleteUser(id) {
      // Hard delete; ON DELETE CASCADE clears the per-user tables. ids are
      // never manually reused, so a stale cookie's uid can't inherit a
      // recreated user (design-delta SUGGESTION-6).
      st().del.run(id);
    },

    // ---- per-user state (thin, used by the migrated routes) ----------------
    getProgress(userId) {
      const out = {};
      for (const r of st().getProgress.all(userId)) {
        out[r.media_id] = { timestamp: r.timestamp, duration: r.duration, updatedAt: r.updated_at };
      }
      return out;
    },
    getOneProgress(userId, mediaId) {
      const r = st().getOneProgress.get(userId, mediaId);
      return r ? { timestamp: r.timestamp, duration: r.duration, updatedAt: r.updated_at } : null;
    },
    setProgress(userId, mediaId, { timestamp, duration, updatedAt }) {
      st().upsertProgress.run(userId, mediaId, timestamp, duration, updatedAt);
    },
    // The coalescer's flush target (v1.43 chunk 4b): a whole batch window's
    // pings -- possibly many users x many ids -- commit as ONE SQLite
    // transaction, preserving the v1.30 A4 write-amplification contract
    // (N pings -> 1 durable write) now that the rows live per-user instead
    // of in the doc-table `progress` namespace. Entries:
    // [{ userId, mediaId, value: {timestamp, duration, updatedAt} }].
    setProgressBatch(entries) {
      if (!Array.isArray(entries) || entries.length === 0) return;
      const s = st();
      adapter.begin();
      try {
        for (const e of entries) {
          s.upsertProgress.run(e.userId, e.mediaId, num(e.value.timestamp), num(e.value.duration), typeof e.value.updatedAt === 'string' ? e.value.updatedAt : null);
        }
        adapter.commit();
      } catch (err) {
        adapter.rollback();
        throw err;
      }
    },
    // ---- media-id lifecycle (delete/prune/move) -----------------------------
    // Called AFTER the corresponding doc-table mutator has committed (the
    // rekeyInFlightState posture: a rolled-back doc write must never leave
    // the user tables re-keyed/emptied ahead of it). One transaction per call.
    removeMediaState(mediaIds) {
      const ids = Array.isArray(mediaIds) ? mediaIds : [mediaIds];
      if (ids.length === 0) return;
      const s = st();
      adapter.begin();
      try {
        for (const id of ids) {
          s.delProgressByMedia.run(id);
          s.delLikedByMedia.run(id);
        }
        adapter.commit();
      } catch (err) {
        adapter.rollback();
        throw err;
      }
    },
    rekeyMediaState(oldId, newId) {
      const s = st();
      adapter.begin();
      try {
        s.rekeyProgress.run(newId, oldId);
        s.rekeyLiked.run(newId, oldId);
        adapter.commit();
      } catch (err) {
        adapter.rollback();
        throw err;
      }
    },
    getLiked(userId) {
      return st().getLiked.all(userId).map((r) => r.media_id);
    },
    addLiked(userId, mediaId, likedAt) {
      st().addLiked.run(userId, mediaId, likedAt);
    },
    removeLiked(userId, mediaId) {
      st().removeLiked.run(userId, mediaId);
    },
    getBookProgress(userId) {
      const out = {};
      for (const r of st().getBookProgress.all(userId)) {
        try { out[r.book_id] = JSON.parse(r.position_json); } catch { /* skip a corrupt row */ }
      }
      return out;
    },
    setBookProgress(userId, bookId, position) {
      st().upsertBookProgress.run(userId, bookId, JSON.stringify(position), position && position.updatedAt ? position.updatedAt : null);
    },
    getBookPins(userId) {
      return st().getBookPins.all(userId).map((r) => safeParse(r.pin_json)).filter(Boolean);
    },
    setBookPin(userId, pin) {
      st().upsertBookPin.run(userId, pin.id, JSON.stringify(pin), pin.order || 0);
    },
    removeBookPin(userId, pinId) {
      st().delBookPin.run(userId, pinId);
    },
    getChannelPins(userId) {
      return st().getChannelPins.all(userId).map((r) => safeParse(r.pin_json)).filter(Boolean);
    },
    setChannelPin(userId, pin) {
      st().upsertChannelPin.run(userId, pin.id, JSON.stringify(pin), pin.order || 0);
    },
    removeChannelPin(userId, pinId) {
      st().delChannelPin.run(userId, pinId);
    },

    // Test-only: wipe every user (cascade clears the per-user tables). Used by
    // server.js's __resetDatabaseForTests so a suite starts with zero users
    // (the doc-table wipe in exclusiveReplace does not touch the relational
    // user tables). ids do NOT reset — AUTOINCREMENT keeps climbing, which is
    // the correct never-reuse behavior even across a test reset.
    __clearAllUsersForTests() {
      adapter.sql.exec('DELETE FROM users');
    },
    // Test-only: wipe per-user STATE while keeping the users themselves (the
    // between-test reset -- __resetDatabaseForTests wipes the doc tables and
    // calls this, so a case's progress/likes/pins never bleed into the next,
    // while the suite's minted admin and its session cookie stay valid).
    __clearUserStateForTests() {
      adapter.sql.exec('DELETE FROM user_progress');
      adapter.sql.exec('DELETE FROM user_liked');
      adapter.sql.exec('DELETE FROM user_book_progress');
      adapter.sql.exec('DELETE FROM user_book_pins');
      adapter.sql.exec('DELETE FROM user_channel_pins');
    },
  };
};

// Fold the pre-auth global state into a freshly-created user's per-user rows,
// inside the caller's open transaction. The global rows carry real
// updatedAt since v1.30 (drift correction #4) — copied verbatim; a legacy
// row lacking it gets setup-time. liked has no per-item timestamp → setup
// time. Deterministic + idempotent (only ever runs against an empty new id).
function adoptInto(s, userId, adoption, nowIso) {
  if (!adoption) return;
  const progress = adoption.progress || {};
  for (const mediaId of Object.keys(progress)) {
    const p = progress[mediaId];
    if (!p || typeof p !== 'object') continue;
    s.upsertProgress.run(userId, mediaId, num(p.timestamp), num(p.duration), typeof p.updatedAt === 'string' ? p.updatedAt : nowIso);
  }
  for (const mediaId of Array.isArray(adoption.liked) ? adoption.liked : []) {
    s.addLiked.run(userId, mediaId, nowIso);
  }
  const bp = adoption.bookProgress || {};
  for (const bookId of Object.keys(bp)) {
    const pos = bp[bookId];
    if (!pos || typeof pos !== 'object') continue;
    s.upsertBookProgress.run(userId, bookId, JSON.stringify(pos), typeof pos.updatedAt === 'string' ? pos.updatedAt : nowIso);
  }
  for (const pin of Array.isArray(adoption.bookPins) ? adoption.bookPins : []) {
    if (pin && pin.id) s.upsertBookPin.run(userId, pin.id, JSON.stringify(pin), num(pin.order));
  }
  for (const pin of Array.isArray(adoption.channelPins) ? adoption.channelPins : []) {
    if (pin && pin.id) s.upsertChannelPin.run(userId, pin.id, JSON.stringify(pin), num(pin.order));
  }
}

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}
function safeParse(json) {
  try { return JSON.parse(json); } catch { return null; }
}
