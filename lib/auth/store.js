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
    getOneBookProgress: sql.prepare('SELECT position_json FROM user_book_progress WHERE user_id = ? AND book_id = ?'),
    delBookProgressByBook: sql.prepare('DELETE FROM user_book_progress WHERE book_id = ?'),
    // Per-user pins (book + channel)
    upsertBookPin: sql.prepare('INSERT INTO user_book_pins (user_id, pin_id, pin_json, pin_order) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, pin_id) DO UPDATE SET pin_json = excluded.pin_json, pin_order = excluded.pin_order'),
    getBookPins: sql.prepare('SELECT pin_json FROM user_book_pins WHERE user_id = ? ORDER BY pin_order, pin_id'),
    delBookPin: sql.prepare('DELETE FROM user_book_pins WHERE user_id = ? AND pin_id = ?'),
    delAllBookPins: sql.prepare('DELETE FROM user_book_pins WHERE user_id = ?'),
    upsertChannelPin: sql.prepare('INSERT INTO user_channel_pins (user_id, pin_id, pin_json, pin_order) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, pin_id) DO UPDATE SET pin_json = excluded.pin_json, pin_order = excluded.pin_order'),
    getChannelPins: sql.prepare('SELECT pin_json FROM user_channel_pins WHERE user_id = ? ORDER BY pin_order, pin_id'),
    delChannelPin: sql.prepare('DELETE FROM user_channel_pins WHERE user_id = ? AND pin_id = ?'),
    delAllChannelPins: sql.prepare('DELETE FROM user_channel_pins WHERE user_id = ?'),
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
      // Gate QA-WARNING: route through the adapter's begin/commit/rollback so
      // the re-entrancy guard (lib/db/sqlite.js) tracks inTransaction — a bare
      // sql.exec('BEGIN') here would silently defeat it. Safe (fully sync, no
      // await between BEGIN and COMMIT), but the guard exists to KEEP it safe
      // if a future edit adds one.
      adapter.begin();
      try {
        const res = s.insertGuarded.run(u, displayName || u, passwordHash, 'admin', 1, nowIso);
        if (res.changes !== 1) {
          // A user already existed — guard fired, nothing inserted.
          adapter.rollback();
          return null;
        }
        const id = Number(res.lastInsertRowid);
        adoptInto(s, id, adoption, nowIso);
        adapter.commit();
        return this.getById(id);
      } catch (err) {
        adapter.rollback();
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
      // Null-prototype accumulator (v1.42 __proto__ row-key lesson): a
      // hostile media_id of '__proto__' -- e.g. smuggled in via a crafted
      // restore bundle -- must land as a PLAIN key, never a prototype write.
      const out = Object.create(null);
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
      // Gate WARNING-1 (adversarial): a staged ping for a user DELETEd
      // between staging and flush would FK-violate mid-transaction and roll
      // back the WHOLE batch — destroying INNOCENT co-users' positions in
      // that window. Filter to still-existing users BEFORE the transaction
      // (one SELECT, negligible for a window's worth of pings), so a
      // vanished user's row is dropped, never poisons the batch. The delete
      // route also clears the user's pending entries at the source; this is
      // the defense-in-depth net for any staging that slips through.
      const existing = new Set(adapter.sql.prepare('SELECT id FROM users').all().map((r) => r.id));
      const rows = entries.filter((e) => existing.has(e.userId));
      if (rows.length === 0) return;
      adapter.begin();
      try {
        for (const e of rows) {
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
      const out = Object.create(null); // null-prototype: see getProgress
      for (const r of st().getBookProgress.all(userId)) {
        try { out[r.book_id] = JSON.parse(r.position_json); } catch { /* skip a corrupt row */ }
      }
      return out;
    },
    getOneBookProgress(userId, bookId) {
      const r = st().getOneBookProgress.get(userId, bookId);
      if (!r) return null;
      try { return JSON.parse(r.position_json); } catch { return null; }
    },
    setBookProgress(userId, bookId, position) {
      st().upsertBookProgress.run(userId, bookId, JSON.stringify(position), position && position.updatedAt ? position.updatedAt : null);
    },
    // The books coalescer's flush target (mirrors setProgressBatch): one
    // transaction per batch window. Entries: [{ userId, bookId, value }].
    setBookProgressBatch(entries) {
      if (!Array.isArray(entries) || entries.length === 0) return;
      const s = st();
      // Gate WARNING-1: filter to still-existing users before the transaction
      // (same reasoning as setProgressBatch — a deleted user's staged ping
      // must not FK-poison the batch and lose co-users' positions).
      const existing = new Set(adapter.sql.prepare('SELECT id FROM users').all().map((r) => r.id));
      const rows = entries.filter((e) => existing.has(e.userId));
      if (rows.length === 0) return;
      adapter.begin();
      try {
        for (const e of rows) {
          s.upsertBookProgress.run(e.userId, e.bookId, JSON.stringify(e.value), e.value && typeof e.value.updatedAt === 'string' ? e.value.updatedAt : null);
        }
        adapter.commit();
      } catch (err) {
        adapter.rollback();
        throw err;
      }
    },
    // Book-id lifecycle: the books scan's prune mirror (same post-commit
    // posture as removeMediaState). Books have no move/re-key or delete
    // endpoint -- the scan prune is the only lifecycle site.
    removeBookState(bookIds) {
      const ids = Array.isArray(bookIds) ? bookIds : [bookIds];
      if (ids.length === 0) return;
      const s = st();
      adapter.begin();
      try {
        for (const id of ids) s.delBookProgressByBook.run(id);
        adapter.commit();
      } catch (err) {
        adapter.rollback();
        throw err;
      }
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
    // Whole-set replace (one transaction): the pin routes run the store
    // modules' PURE reducers (reduceAddShelfPin/reduceAddPin/reorder --
    // idempotency, order-gap, FIFO-cap semantics preserved verbatim) against
    // the user's current list and persist the reducer's output here. A
    // replace (rather than per-row diffing) keeps the reducers the single
    // source of pin semantics.
    setBookPins(userId, pins) {
      const s = st();
      adapter.begin();
      try {
        s.delAllBookPins.run(userId);
        for (const pin of Array.isArray(pins) ? pins : []) {
          if (pin && pin.id) s.upsertBookPin.run(userId, pin.id, JSON.stringify(pin), num(pin.order));
        }
        adapter.commit();
      } catch (err) {
        adapter.rollback();
        throw err;
      }
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
    setChannelPins(userId, pins) {
      const s = st();
      adapter.begin();
      try {
        s.delAllChannelPins.run(userId);
        for (const pin of Array.isArray(pins) ? pins : []) {
          if (pin && pin.id) s.upsertChannelPin.run(userId, pin.id, JSON.stringify(pin), num(pin.order));
        }
        adapter.commit();
      } catch (err) {
        adapter.rollback();
        throw err;
      }
    },

    // ---- v1.43 chunk 4d: instance-backup export/import ---------------------
    // The bundle carries FULL account rows (including password hashes — the
    // download UI flags the file as sensitive) plus each user's per-user
    // state, so a restore is a complete instance snapshot. The session
    // secret is NOT part of any of this — secrets never ride bundles (the
    // per-instance cookie-name isolation depends on secrets differing).
    exportUsersForBackup() {
      const sql = adapter.sql;
      const users = [];
      for (const r of sql.prepare('SELECT * FROM users ORDER BY id').all()) {
        users.push({
          id: r.id,
          username: r.username,
          displayName: r.display_name,
          passwordHash: r.password_hash,
          role: r.role,
          canManageSubscriptions: r.can_manage_subscriptions === 1,
          settingsJson: r.settings_json,
          tokenVersion: r.token_version,
          disabled: r.disabled === 1,
          createdAt: r.created_at,
          progress: this.getProgress(r.id),
          liked: sql.prepare('SELECT media_id, liked_at FROM user_liked WHERE user_id = ? ORDER BY liked_at, media_id').all(r.id)
            .map((row) => ({ mediaId: row.media_id, likedAt: row.liked_at })),
          bookProgress: this.getBookProgress(r.id),
          bookPins: this.getBookPins(r.id),
          channelPins: this.getChannelPins(r.id),
        });
      }
      return users;
    },

    // Wipe-and-replace every user table from a bundle's `users` array.
    // MUST be called INSIDE an already-open transaction (the restore's
    // exclusiveReplace section) — no begin/commit here, so the user-table
    // replacement commits (or rolls back) ATOMICALLY with the doc-table
    // restore. Ids are preserved verbatim (they FK the per-user rows and
    // keep the restoring admin's session verifiable); the caller validates
    // shapes/uniqueness BEFORE the wipe (refuse-whole posture).
    replaceAllUsersRaw(users) {
      const sql = adapter.sql;
      const s = st();
      // ---- Gate CRITICAL-1 (adversarial): the session-invalidation floor ----
      // The session token binds only {uid, tv}. A users-replacing restore
      // reassigns ids to DIFFERENT identities (bundle ids are preserved
      // because the per-user rows FK them), so a third party's live cookie
      // {uid:2, tv:0} would keep authenticating as whoever now occupies id 2
      // — a silent cross-user bleed AND privilege escalation.
      //
      // The reviewer prescribed rotating the session secret. We use a
      // stronger, narrower lever: a token_version FLOOR captured from the
      // CURRENT rows BEFORE the wipe. A live cookie's tv can never exceed its
      // user's current row tv (tv only increments; the cookie was issued at
      // some past tv <= current), so `MAX(current tv) + 1` provably exceeds
      // EVERY live cookie's tv. Stamping every restored user's tv to at least
      // that floor makes every pre-restore cookie fail the gate's tv check.
      // (The reviewer's objection — "you can't know the live cookies' tv to
      // out-run them" — holds only if you bump AFTER the wipe; snapshotting
      // BEFORE it is exactly what makes the floor knowable.) This beats secret
      // rotation on two counts: it survives a restart (tv is persisted in the
      // DB, whereas a rotated file secret is ignored when FILETUBE_SESSION_
      // SECRET is env-pinned), and it needs no mutable-secret plumbing through
      // the gate. The operator's own cookie is invalidated too — the restore
      // route reissues it against the restored (bumped) row.
      const tvFloor = sql.prepare('SELECT COALESCE(MAX(token_version), -1) AS m FROM users').get().m + 1;
      sql.exec('DELETE FROM users'); // ON DELETE CASCADE clears per-user state
      const insertWithId = sql.prepare(`
        INSERT INTO users (id, username, display_name, password_hash, role, can_manage_subscriptions, settings_json, token_version, disabled, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const u of users) {
        // Gate WARNING-2: normalize (trim) the username on the WRITE, matching
        // createUser/createFirstAdmin — validation tests the trimmed form, so
        // a padded bundle username would otherwise store a row no login (which
        // also trims) can ever match, locking the account (and possibly the
        // operator) out.
        const bundleTv = Number.isInteger(u.tokenVersion) ? u.tokenVersion : 0;
        insertWithId.run(
          u.id, normalizeUsername(u.username), u.displayName || normalizeUsername(u.username), u.passwordHash, u.role,
          u.canManageSubscriptions ? 1 : 0,
          typeof u.settingsJson === 'string' ? u.settingsJson : '{}',
          Math.max(bundleTv, tvFloor), // CRITICAL-1: no pre-restore cookie can match
          u.disabled ? 1 : 0,
          typeof u.createdAt === 'string' ? u.createdAt : new Date(0).toISOString()
        );
        const progress = u.progress && typeof u.progress === 'object' ? u.progress : {};
        for (const mediaId of Object.keys(progress)) {
          const p = progress[mediaId];
          if (!p || typeof p !== 'object') continue;
          s.upsertProgress.run(u.id, mediaId, num(p.timestamp), num(p.duration), typeof p.updatedAt === 'string' ? p.updatedAt : null);
        }
        for (const like of Array.isArray(u.liked) ? u.liked : []) {
          if (like && typeof like.mediaId === 'string') s.addLiked.run(u.id, like.mediaId, typeof like.likedAt === 'string' ? like.likedAt : null);
        }
        const bp = u.bookProgress && typeof u.bookProgress === 'object' ? u.bookProgress : {};
        for (const bookId of Object.keys(bp)) {
          const pos = bp[bookId];
          if (!pos || typeof pos !== 'object') continue;
          s.upsertBookProgress.run(u.id, bookId, JSON.stringify(pos), typeof pos.updatedAt === 'string' ? pos.updatedAt : null);
        }
        for (const pin of Array.isArray(u.bookPins) ? u.bookPins : []) {
          if (pin && pin.id) s.upsertBookPin.run(u.id, pin.id, JSON.stringify(pin), num(pin.order));
        }
        for (const pin of Array.isArray(u.channelPins) ? u.channelPins : []) {
          if (pin && pin.id) s.upsertChannelPin.run(u.id, pin.id, JSON.stringify(pin), num(pin.order));
        }
      }
      // AUTOINCREMENT's never-reuse contract survives the restore for free:
      // SQLite bumps sqlite_sequence to max(seq, rowid) on every explicit-id
      // insert into an AUTOINCREMENT table, so a post-restore create always
      // mints an id above every restored one.
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
