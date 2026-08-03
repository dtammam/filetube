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
    // v1.50 per-user watched latch (sticky completion membership -- see the
    // schema v4 comment in lib/db/sqlite.js). Same id-keyed-carrier shape as
    // user_liked: point membership writes + by-media delete + OR-REPLACE
    // re-key.
    addWatched: sql.prepare('INSERT INTO user_watched (user_id, media_id, completed_at) VALUES (?, ?, ?) ON CONFLICT(user_id, media_id) DO NOTHING'),
    hasWatched: sql.prepare('SELECT 1 AS x FROM user_watched WHERE user_id = ? AND media_id = ?'),
    getWatched: sql.prepare('SELECT media_id FROM user_watched WHERE user_id = ? ORDER BY media_id'),
    delWatchedByMedia: sql.prepare('DELETE FROM user_watched WHERE media_id = ?'),
    rekeyWatched: sql.prepare('UPDATE OR REPLACE user_watched SET media_id = ? WHERE media_id = ?'),
    // v1.64 history: the timestamped watched read (the first live reader of
    // completed_at -- previously backup-export-only) + the user-scoped
    // deletes backing removeHistory/clearHistory below.
    getWatchedTimes: sql.prepare('SELECT media_id, completed_at FROM user_watched WHERE user_id = ?'),
    delWatched: sql.prepare('DELETE FROM user_watched WHERE user_id = ? AND media_id = ?'),
    clearProgressByUser: sql.prepare('DELETE FROM user_progress WHERE user_id = ?'),
    clearWatchedByUser: sql.prepare('DELETE FROM user_watched WHERE user_id = ?'),
    // Per-user book progress
    upsertBookProgress: sql.prepare(`
      INSERT INTO user_book_progress (user_id, book_id, position_json, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, book_id) DO UPDATE SET position_json = excluded.position_json, updated_at = excluded.updated_at
    `),
    getBookProgress: sql.prepare('SELECT book_id, position_json, updated_at FROM user_book_progress WHERE user_id = ?'),
    getOneBookProgress: sql.prepare('SELECT position_json FROM user_book_progress WHERE user_id = ? AND book_id = ?'),
    delBookProgressByBook: sql.prepare('DELETE FROM user_book_progress WHERE book_id = ?'),
    // ---- v1.72 books first-class: likes + the manual finished latch ----
    // (TWELFTH carrier strike - all arms in the birth commit: these
    // statements, the accessors, removeBookState, the backup export/
    // restore/validation halves, and the carrier tests.)
    addBookLiked: sql.prepare('INSERT INTO user_book_liked (user_id, book_id, liked_at) VALUES (?, ?, ?) ON CONFLICT(user_id, book_id) DO NOTHING'),
    removeBookLiked: sql.prepare('DELETE FROM user_book_liked WHERE user_id = ? AND book_id = ?'),
    getBookLiked: sql.prepare('SELECT book_id, liked_at FROM user_book_liked WHERE user_id = ? ORDER BY liked_at DESC, book_id'),
    delBookLikedByBook: sql.prepare('DELETE FROM user_book_liked WHERE book_id = ?'),
    setBookFinished: sql.prepare('INSERT INTO user_book_finished (user_id, book_id, finished_at) VALUES (?, ?, ?) ON CONFLICT(user_id, book_id) DO UPDATE SET finished_at = excluded.finished_at'),
    clearBookFinished: sql.prepare('DELETE FROM user_book_finished WHERE user_id = ? AND book_id = ?'),
    getBookFinished: sql.prepare('SELECT book_id, finished_at FROM user_book_finished WHERE user_id = ?'),
    delBookFinishedByBook: sql.prepare('DELETE FROM user_book_finished WHERE book_id = ?'),
    // v1.72 podcast show pins (the user_book_pins shape; pin_id = subId).
    upsertPodcastPin: sql.prepare('INSERT INTO user_podcast_pins (user_id, pin_id, pin_json, pin_order) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, pin_id) DO UPDATE SET pin_json = excluded.pin_json, pin_order = excluded.pin_order'),
    getPodcastPins: sql.prepare('SELECT pin_json FROM user_podcast_pins WHERE user_id = ? ORDER BY pin_order, pin_id'),
    delAllPodcastPins: sql.prepare('DELETE FROM user_podcast_pins WHERE user_id = ?'),
    delPodcastPinBySub: sql.prepare('DELETE FROM user_podcast_pins WHERE pin_id = ?'),
    // Per-user pins (book + channel)
    upsertBookPin: sql.prepare('INSERT INTO user_book_pins (user_id, pin_id, pin_json, pin_order) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, pin_id) DO UPDATE SET pin_json = excluded.pin_json, pin_order = excluded.pin_order'),
    getBookPins: sql.prepare('SELECT pin_json FROM user_book_pins WHERE user_id = ? ORDER BY pin_order, pin_id'),
    delBookPin: sql.prepare('DELETE FROM user_book_pins WHERE user_id = ? AND pin_id = ?'),
    delAllBookPins: sql.prepare('DELETE FROM user_book_pins WHERE user_id = ?'),
    // v1.63 playback queue (whole-set replace like the pins; the routes run
    // lib/queue/store.js's pure reducers and persist their output).
    upsertQueueEntry: sql.prepare('INSERT INTO user_queue (user_id, entry_uid, media_id, entry_order, entry_kind) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, entry_uid) DO UPDATE SET media_id = excluded.media_id, entry_order = excluded.entry_order, entry_kind = excluded.entry_kind'),
    getQueueEntries: sql.prepare('SELECT entry_uid, media_id, entry_kind FROM user_queue WHERE user_id = ? ORDER BY entry_order, entry_uid'),
    delAllQueueEntries: sql.prepare('DELETE FROM user_queue WHERE user_id = ?'),
    getQueueState: sql.prepare('SELECT pointer_uid, updated_at FROM user_queue_state WHERE user_id = ?'),
    upsertQueueState: sql.prepare('INSERT INTO user_queue_state (user_id, pointer_uid, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET pointer_uid = excluded.pointer_uid, updated_at = excluded.updated_at'),
    delQueueState: sql.prepare('DELETE FROM user_queue_state WHERE user_id = ?'),
    // NINTH id-keyed carrier: media deletion purges queue entries (every
    // user's), relocation re-keys them - wired into removeMediaState /
    // rekeyMediaState below, same commit as the table's birth. Since v10
    // both are SCOPED to media-kind rows: a podcast episode id is md5 hex
    // exactly like a media id, and a colliding media delete/re-key must
    // never touch a podcast-kind row (its lifecycle is delQueueByEpisode).
    delQueueByMedia: sql.prepare("DELETE FROM user_queue WHERE media_id = ? AND entry_kind = 'media'"),
    rekeyQueueMedia: sql.prepare("UPDATE user_queue SET media_id = ? WHERE media_id = ? AND entry_kind = 'media'"),
    // v1.71: podcast-kind queue rows retire with their EPISODE (wired into
    // removePodcastEpisodeState below, same commit as the column's birth).
    delQueueByEpisode: sql.prepare("DELETE FROM user_queue WHERE media_id = ? AND entry_kind = 'podcast'"),
    // v1.72: track-kind rows retire with the music prune (removeMusicState)
    // - same-id media/podcast rows are untouchable by construction.
    delQueueByTrack: sql.prepare("DELETE FROM user_queue WHERE media_id = ? AND entry_kind = 'track'"),
    upsertChannelPin: sql.prepare('INSERT INTO user_channel_pins (user_id, pin_id, pin_json, pin_order) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, pin_id) DO UPDATE SET pin_json = excluded.pin_json, pin_order = excluded.pin_order'),
    getChannelPins: sql.prepare('SELECT pin_json FROM user_channel_pins WHERE user_id = ? ORDER BY pin_order, pin_id'),
    delChannelPin: sql.prepare('DELETE FROM user_channel_pins WHERE user_id = ? AND pin_id = ?'),
    delAllChannelPins: sql.prepare('DELETE FROM user_channel_pins WHERE user_id = ?'),
    // ---- v1.44 music: per-user liked / per-track progress / resume pointer ----
    // Mirrors the media accessors above; track_id is the same md5(path) scheme.
    upsertMusicProgress: sql.prepare(`
      INSERT INTO user_music_progress (user_id, track_id, position_seconds, duration_seconds, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id, track_id) DO UPDATE SET position_seconds = excluded.position_seconds, duration_seconds = excluded.duration_seconds, updated_at = excluded.updated_at
    `),
    getMusicProgress: sql.prepare('SELECT track_id, position_seconds, duration_seconds, updated_at FROM user_music_progress WHERE user_id = ?'),
    getOneMusicProgress: sql.prepare('SELECT position_seconds, duration_seconds, updated_at FROM user_music_progress WHERE user_id = ? AND track_id = ?'),
    // Track-id lifecycle carriers (the SEVENTH-strike class: prune AND move
    // must carry these): delete-by-track + OR-REPLACE re-key, exactly like the
    // media rows above.
    delMusicProgressByTrack: sql.prepare('DELETE FROM user_music_progress WHERE track_id = ?'),
    delMusicLikedByTrack: sql.prepare('DELETE FROM user_music_liked WHERE track_id = ?'),
    rekeyMusicProgress: sql.prepare('UPDATE OR REPLACE user_music_progress SET track_id = ? WHERE track_id = ?'),
    rekeyMusicLiked: sql.prepare('UPDATE OR REPLACE user_music_liked SET track_id = ? WHERE track_id = ?'),
    // A pruned/re-keyed track that the resume pointer still references must not
    // leave a dangling last_track_id (a "resume" to a gone track). Null it on
    // prune; re-key it on move.
    nullMusicStateByTrack: sql.prepare('UPDATE user_music_state SET last_track_id = NULL, queue_ctx_json = NULL, position_seconds = NULL WHERE last_track_id = ?'),
    // ---- v1.69 podcasts: per-user episode resume + played latch ----
    // Keyed by EPISODE id (md5 of subId+guid), not media id - these rows do
    // NOT ride removeMediaState/rekeyMediaState. Delete carrier =
    // removePodcastEpisodeState below (wired in this same commit, the
    // TENTH id-keyed carrier); no re-key exists by construction (episode
    // ids are guid-derived, stable across file moves).
    upsertPodcastProgress: sql.prepare(`
      INSERT INTO user_podcast_progress (user_id, episode_id, position_seconds, duration_seconds, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id, episode_id) DO UPDATE SET position_seconds = excluded.position_seconds, duration_seconds = excluded.duration_seconds, updated_at = excluded.updated_at
    `),
    getPodcastProgress: sql.prepare('SELECT episode_id, position_seconds, duration_seconds, updated_at FROM user_podcast_progress WHERE user_id = ?'),
    getOnePodcastProgress: sql.prepare('SELECT position_seconds, duration_seconds, updated_at FROM user_podcast_progress WHERE user_id = ? AND episode_id = ?'),
    setPodcastPlayed: sql.prepare('INSERT INTO user_podcast_played (user_id, episode_id, played_at) VALUES (?, ?, ?) ON CONFLICT(user_id, episode_id) DO UPDATE SET played_at = excluded.played_at'),
    delPodcastPlayed: sql.prepare('DELETE FROM user_podcast_played WHERE user_id = ? AND episode_id = ?'),
    getPodcastPlayedForUser: sql.prepare('SELECT episode_id, played_at FROM user_podcast_played WHERE user_id = ?'),
    delPodcastProgressByEpisode: sql.prepare('DELETE FROM user_podcast_progress WHERE episode_id = ?'),
    delPodcastPlayedByEpisode: sql.prepare('DELETE FROM user_podcast_played WHERE episode_id = ?'),
    // ---- v1.71 podcasts: per-user episode likes (ELEVENTH id-keyed carrier,
    // same episode-id space and delete carrier as the v9 pair) ----
    addPodcastLiked: sql.prepare('INSERT INTO user_podcast_liked (user_id, episode_id, liked_at) VALUES (?, ?, ?) ON CONFLICT(user_id, episode_id) DO NOTHING'),
    removePodcastLiked: sql.prepare('DELETE FROM user_podcast_liked WHERE user_id = ? AND episode_id = ?'),
    getPodcastLiked: sql.prepare('SELECT episode_id, liked_at FROM user_podcast_liked WHERE user_id = ? ORDER BY liked_at DESC, episode_id'),
    delPodcastLikedByEpisode: sql.prepare('DELETE FROM user_podcast_liked WHERE episode_id = ?'),
    rekeyMusicStateTrack: sql.prepare('UPDATE user_music_state SET last_track_id = ? WHERE last_track_id = ?'),
    addMusicLiked: sql.prepare('INSERT INTO user_music_liked (user_id, track_id, liked_at) VALUES (?, ?, ?) ON CONFLICT(user_id, track_id) DO NOTHING'),
    removeMusicLiked: sql.prepare('DELETE FROM user_music_liked WHERE user_id = ? AND track_id = ?'),
    getMusicLiked: sql.prepare('SELECT track_id FROM user_music_liked WHERE user_id = ? ORDER BY liked_at DESC, track_id'),
    upsertMusicState: sql.prepare(`
      INSERT INTO user_music_state (user_id, last_track_id, queue_ctx_json, position_seconds, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET last_track_id = excluded.last_track_id, queue_ctx_json = excluded.queue_ctx_json, position_seconds = excluded.position_seconds, updated_at = excluded.updated_at
    `),
    getMusicState: sql.prepare('SELECT last_track_id, queue_ctx_json, position_seconds, updated_at FROM user_music_state WHERE user_id = ?'),
    // ---- v1.51 notification bell: global feed + per-user seen/read state ----
    // The feed is GLOBAL (one download = one event); every per-user question
    // (badge, dots, cleared view) is a join of the two per-user tables
    // against it. media_id is the same md5(path) id every other carrier
    // keys by, so the feed is a full id-keyed-carrier citizen: the
    // delete/prune/re-key statements below ride removeMediaState/
    // rekeyMediaState, and the per-user state rides the backup bundle.
    insertNotification: sql.prepare('INSERT INTO notifications (media_id, created_at) VALUES (?, ?)'),
    notificationById: sql.prepare('SELECT id FROM notifications WHERE id = ?'),
    notificationIdByMedia: sql.prepare('SELECT id FROM notifications WHERE media_id = ?'),
    delNotificationById: sql.prepare('DELETE FROM notifications WHERE id = ?'),
    delReadsByNotificationId: sql.prepare('DELETE FROM user_notification_reads WHERE notification_id = ?'),
    countAllNotifications: sql.prepare('SELECT COUNT(*) AS c FROM notifications'),
    // Overflow = everything past the newest CAP rows (LIMIT -1 OFFSET n is
    // SQLite's documented "no limit, skip n" spelling).
    notificationOverflowIds: sql.prepare('SELECT id FROM notifications ORDER BY created_at DESC, id DESC LIMIT -1 OFFSET ?'),
    listNotificationsForUser: sql.prepare(`
      SELECT n.id, n.media_id, n.created_at,
             CASE WHEN r.notification_id IS NULL THEN 1 ELSE 0 END AS unread
      FROM notifications n
      LEFT JOIN user_notification_reads r
        ON r.notification_id = n.id AND r.user_id = ?
      LEFT JOIN user_notification_dismissals d
        ON d.notification_id = n.id AND d.user_id = ?
      WHERE n.created_at > ? AND d.notification_id IS NULL
      ORDER BY n.created_at DESC, n.id DESC
      LIMIT ?
    `),
    // v1.68: the badge excludes THIS user's dismissed rows (panel and badge
    // must agree), so the count is per-user now.
    countNotificationsSince: sql.prepare(`
      SELECT COUNT(*) AS c FROM notifications n
      WHERE n.created_at > ?
        AND NOT EXISTS (
          SELECT 1 FROM user_notification_dismissals d
          WHERE d.notification_id = n.id AND d.user_id = ?
        )
    `),
    getNotificationState: sql.prepare('SELECT last_seen_at, cleared_at FROM user_notification_state WHERE user_id = ?'),
    // Monotonic MAX() upserts: a stale/racing writer can never move a
    // watermark BACKWARD, and mark-seen can never un-clear.
    upsertNotificationSeen: sql.prepare(`
      INSERT INTO user_notification_state (user_id, last_seen_at, cleared_at) VALUES (?, ?, 0)
      ON CONFLICT(user_id) DO UPDATE SET last_seen_at = MAX(user_notification_state.last_seen_at, excluded.last_seen_at)
    `),
    upsertNotificationState: sql.prepare(`
      INSERT INTO user_notification_state (user_id, last_seen_at, cleared_at) VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        last_seen_at = MAX(user_notification_state.last_seen_at, excluded.last_seen_at),
        cleared_at = MAX(user_notification_state.cleared_at, excluded.cleared_at)
    `),
    addNotificationRead: sql.prepare('INSERT INTO user_notification_reads (user_id, notification_id, read_at) VALUES (?, ?, ?) ON CONFLICT(user_id, notification_id) DO NOTHING'),
    // v1.68 dismissal lane (mirrors the reads statements one-for-one).
    addNotificationDismissal: sql.prepare('INSERT INTO user_notification_dismissals (user_id, notification_id, dismissed_at) VALUES (?, ?, ?) ON CONFLICT(user_id, notification_id) DO NOTHING'),
    delDismissalsByNotificationId: sql.prepare('DELETE FROM user_notification_dismissals WHERE notification_id = ?'),
    delDismissalsByMedia: sql.prepare('DELETE FROM user_notification_dismissals WHERE notification_id IN (SELECT id FROM notifications WHERE media_id = ?)'),
    dismissalsForUser: sql.prepare('SELECT n.media_id, d.dismissed_at FROM user_notification_dismissals d JOIN notifications n ON n.id = d.notification_id WHERE d.user_id = ? ORDER BY n.media_id'),
    readsForUser: sql.prepare('SELECT n.media_id, r.read_at FROM user_notification_reads r JOIN notifications n ON n.id = r.notification_id WHERE r.user_id = ? ORDER BY n.media_id'),
    // Id-keyed-carrier lifecycle (reads deleted FIRST -- the subquery needs
    // the feed row still present to resolve the id).
    delReadsByMedia: sql.prepare('DELETE FROM user_notification_reads WHERE notification_id IN (SELECT id FROM notifications WHERE media_id = ?)'),
    delNotificationByMedia: sql.prepare('DELETE FROM notifications WHERE media_id = ?'),
    rekeyNotification: sql.prepare('UPDATE OR REPLACE notifications SET media_id = ? WHERE media_id = ?'),
    userCreatedAtById: sql.prepare('SELECT created_at FROM users WHERE id = ?'),
    allNotifications: sql.prepare('SELECT media_id, created_at FROM notifications ORDER BY created_at, id'),
    // ---- v1.66 web push: per-device subscriptions with a feed cursor ----
    // The conflict target is the endpoint (the subscription's identity). A
    // re-subscribe re-binds keys and owner but the cursor only ever moves
    // FORWARD (MAX) - an endpoint that re-registers must not get re-pushed
    // rows it already saw, and a racing delivery can never rewind it.
    upsertPushSubscription: sql.prepare(`
      INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, last_pushed_id, cooldown_until, created_at)
      VALUES (?, ?, ?, ?, ?, 0, ?)
      ON CONFLICT(endpoint) DO UPDATE SET
        user_id = excluded.user_id,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        last_pushed_id = MAX(push_subscriptions.last_pushed_id, excluded.last_pushed_id)
    `),
    getPushSubscription: sql.prepare('SELECT endpoint, user_id, p256dh, auth, last_pushed_id, cooldown_until, created_at FROM push_subscriptions WHERE endpoint = ?'),
    // Delivery roster: disabled accounts are excluded HERE (one join, not a
    // per-send check); settings_json rides along for the pushEnabled opt-out.
    listPushSubscriptions: sql.prepare(`
      SELECT p.endpoint, p.user_id, p.p256dh, p.auth, p.last_pushed_id, p.cooldown_until, u.settings_json
      FROM push_subscriptions p JOIN users u ON u.id = p.user_id
      WHERE u.disabled = 0
      ORDER BY p.endpoint
    `),
    countPushSubscriptionsForUser: sql.prepare('SELECT COUNT(*) AS c FROM push_subscriptions WHERE user_id = ?'),
    delPushSubscription: sql.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?'),
    delPushSubscriptionOwned: sql.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?'),
    advancePushCursor: sql.prepare('UPDATE push_subscriptions SET last_pushed_id = MAX(last_pushed_id, ?) WHERE endpoint = ?'),
    setPushCooldown: sql.prepare('UPDATE push_subscriptions SET cooldown_until = ? WHERE endpoint = ?'),
    // Delivery reads the feed by CURSOR id (not the panel's created_at sort):
    // AUTOINCREMENT ids are append-ordered, which is exactly the "rows since
    // last push" question. LIMIT bounds a pathological gap.
    notificationsAfterId: sql.prepare('SELECT id, media_id, created_at FROM notifications WHERE id > ? ORDER BY id LIMIT ?'),
    maxNotificationId: sql.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM notifications'),
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

// v1.51: the global notification feed keeps only the newest CAP rows --
// overflow (and its reads) is evicted oldest-first on every insert, so the
// table can never grow unbounded even if no client ever opens the panel.
const NOTIFICATION_CAP = 200;

// v1.51: a user with NO user_notification_state row defaults last_seen_at to
// their account's created_at (users.created_at is TEXT ISO) -- a brand-new
// account must not wake up to a badge full of downloads that predate it.
// Invalid/absent created_at falls to 0 (count everything: fail loud, not
// silently blank).
function defaultLastSeenAt(createdAtText) {
  const ms = Date.parse(typeof createdAtText === 'string' ? createdAtText : '');
  return Number.isFinite(ms) && ms > 0 ? ms : 0;
}

// v1.51: shared shape check for a feed entry crossing the store boundary.
// mediaId must be a non-empty string; createdAt a finite positive epoch-ms
// number. Anything else is dropped by callers (never coerced here).
function isValidNotificationEntry(e) {
  return Boolean(e) && typeof e.mediaId === 'string' && e.mediaId !== '' &&
    typeof e.createdAt === 'number' && Number.isFinite(e.createdAt) && e.createdAt > 0;
}

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
          s.delWatchedByMedia.run(id);
          // v1.51 notification feed (EIGHTH id-keyed carrier): reads first --
          // the reads subquery resolves the notification id from the still-
          // present feed row. v1.68: dismissals ride the same order for the
          // same reason.
          s.delReadsByMedia.run(id);
          s.delDismissalsByMedia.run(id);
          s.delNotificationByMedia.run(id);
          // v1.63 playback queue (NINTH id-keyed carrier): a deleted video
          // leaves every user's queue. The pointer is left as-is even if
          // its entry vanished - the read path treats a dangling pointer as
          // "before the first remaining entry" (queueStore.normalize).
          s.delQueueByMedia.run(id);
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
        s.rekeyWatched.run(newId, oldId);
        // v1.51 notification feed. GATE FIX (QA S1 / adversarial W2): if the
        // DESTINATION id already has a feed row, `UPDATE OR REPLACE` below
        // would delete it directly -- bypassing the reads-first discipline
        // and orphaning its user_notification_reads rows forever. Scrub the
        // colliding row (reads first) before the re-key. Practically
        // unreachable today (moveItemToFolder refuses an existing
        // destination file), but this seam must not be the one carrier that
        // leaks on collision. For the SURVIVING (moved) row, reads key by
        // notification id, which the re-key leaves untouched.
        const collided = s.notificationIdByMedia.get(newId);
        if (collided) {
          s.delReadsByNotificationId.run(collided.id);
          s.delDismissalsByNotificationId.run(collided.id); // v1.68 gate W3: dismissals must not be the one carrier this seam leaks
          s.delNotificationById.run(collided.id);
        }
        s.rekeyNotification.run(newId, oldId);
        // v1.63 playback queue (NINTH carrier): plain UPDATE, not OR
        // REPLACE - entry identity is entry_uid, not media_id, so two
        // entries pointing at the same media are legal and a re-key can
        // never collide on the primary key.
        s.rekeyQueueMedia.run(newId, oldId);
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
    // ---- v1.50 watched latch ------------------------------------------------
    getWatchedIds(userId) {
      return st().getWatched.all(userId).map((r) => r.media_id);
    },
    // Sticky + idempotent: the check-then-insert keeps the progress-ping hot
    // path write-free once latched (one indexed point SELECT per ping in the
    // final stretch); ON CONFLICT DO NOTHING makes a concurrent double-cross
    // harmless. Playback NEVER deletes a row (that is the whole point -- a
    // loop restart or rewatch-from-0 must not un-watch); the only steady-
    // state, per-item deletes are the user's own history removals
    // (removeHistory/clearHistory, v1.64) and the media-lifecycle prune
    // above. (Account-lifecycle paths -- the restore pre-wipe, the
    // user-delete cascade, a re-key collision scrub -- replace or retire
    // whole state and sit outside this playback invariant.)
    markWatched(userId, mediaId, completedAt) {
      const s = st();
      if (s.hasWatched.get(userId, mediaId)) return false;
      s.addWatched.run(userId, mediaId, completedAt);
      return true;
    },
    // ---- v1.64 watch history ------------------------------------------------
    // { [mediaId]: completedAt } -- null-prototype for the same __proto__
    // row-key reason as getProgress.
    getWatchedTimes(userId) {
      const out = Object.create(null);
      for (const r of st().getWatchedTimes.all(userId)) out[r.media_id] = r.completed_at;
      return out;
    },
    // USER-INITIATED history removal. One transaction so a remove can never
    // land half (progress gone, latch kept = a "watched" ghost with no
    // resume point). The caller (the /api/history DELETE routes) must also
    // purge the coalescer's staged entries -- a staged ping flushed after
    // this commit would silently resurrect the row.
    removeHistory(userId, mediaId) {
      const s = st();
      adapter.begin();
      try {
        s.delProgress.run(userId, mediaId);
        s.delWatched.run(userId, mediaId);
        adapter.commit();
      } catch (err) {
        adapter.rollback();
        throw err;
      }
    },
    clearHistory(userId) {
      const s = st();
      adapter.begin();
      try {
        s.clearProgressByUser.run(userId);
        s.clearWatchedByUser.run(userId);
        adapter.commit();
      } catch (err) {
        adapter.rollback();
        throw err;
      }
    },
    // ---- v1.51 notification bell --------------------------------------------
    // The per-user watermark pair, with the no-row default described at
    // `defaultLastSeenAt`. Read-only: the row is only ever WRITTEN by
    // mark-seen/clear, so a user who never opens the panel costs no storage.
    getNotificationState(userId) {
      const s = st();
      const row = s.getNotificationState.get(userId);
      if (row) return { lastSeenAt: row.last_seen_at, clearedAt: row.cleared_at };
      const u = s.userCreatedAtById.get(userId);
      return { lastSeenAt: defaultLastSeenAt(u && u.created_at), clearedAt: 0 };
    },
    // Insert feed rows. Replace-on-same-media semantics: a re-download of the
    // same on-disk path deletes the old row (and its reads) and inserts a
    // fresh one, so the event re-sorts to the top with a new id -- to every
    // user it IS new again, which is the honest reading of "this file was
    // downloaded again". Invalid entries are skipped, never coerced. Cap
    // eviction runs in the same transaction. Returns how many rows landed.
    recordNotifications(entries) {
      const list = (Array.isArray(entries) ? entries : []).filter(isValidNotificationEntry);
      if (list.length === 0) return 0;
      const s = st();
      let inserted = 0;
      adapter.begin();
      try {
        for (const e of list) {
          s.delReadsByMedia.run(e.mediaId);
          s.delDismissalsByMedia.run(e.mediaId); // v1.68: a re-download is NEW again - a prior dismissal dies with the old row
          s.delNotificationByMedia.run(e.mediaId);
          s.insertNotification.run(e.mediaId, Math.floor(e.createdAt));
          inserted++;
        }
        for (const row of s.notificationOverflowIds.all(NOTIFICATION_CAP)) {
          s.delReadsByNotificationId.run(row.id);
          s.delDismissalsByNotificationId.run(row.id); // v1.68: dismissals evict with their row
          s.delNotificationById.run(row.id);
        }
        adapter.commit();
      } catch (err) {
        adapter.rollback();
        throw err;
      }
      return inserted;
    },
    // Panel list: rows the user has not cleared, newest first, each with its
    // per-user unread flag. The LIMIT is the cap (the table can briefly hold
    // more than CAP inside recordNotifications' transaction, never here).
    //
    // GATE FIX (adversarial S2): a row that PREDATES the user's account never
    // wears a dot -- it cannot be "new to them". Without this, a user created
    // after the upgrade seeding (which read-marks only then-existing users)
    // opened their first panel to 30 dotted history rows. Same account-clock
    // source as the badge default; an unparseable created_at degrades to 0
    // (suppress nothing -- fail loud, consistent with defaultLastSeenAt).
    listNotifications(userId) {
      const s = st();
      const state = this.getNotificationState(userId);
      const u = s.userCreatedAtById.get(userId);
      const accountMs = defaultLastSeenAt(u && u.created_at);
      const items = s.listNotificationsForUser.all(userId, userId, state.clearedAt, NOTIFICATION_CAP)
        .map((r) => ({
          id: r.id,
          mediaId: r.media_id,
          createdAt: r.created_at,
          unread: r.unread === 1 && r.created_at > accountMs,
        }));
      return { items, lastSeenAt: state.lastSeenAt };
    },
    // Badge count: rows newer than BOTH watermarks (a cleared row is never
    // "unseen" -- clear implies seen).
    countUnseenNotifications(userId) {
      const state = this.getNotificationState(userId);
      const since = Math.max(state.lastSeenAt, state.clearedAt);
      return st().countNotificationsSince.get(since, userId).c;
    },
    markNotificationsSeen(userId, nowMs) {
      st().upsertNotificationSeen.run(userId, nowMs);
    },
    // Row tap. Returns false for an id that is not in the feed (evicted,
    // pruned, or fabricated) so the route can 400 instead of banking a read
    // for a phantom row.
    markNotificationRead(userId, notificationId, nowMs) {
      const s = st();
      if (!Number.isInteger(notificationId) || !s.notificationById.get(notificationId)) return false;
      s.addNotificationRead.run(userId, notificationId, nowMs);
      return true;
    },
    // Clear-all: hides everything at or before nowMs AND marks it seen (a
    // cleared panel with a nonzero badge would contradict itself).
    clearNotifications(userId, nowMs) {
      st().upsertNotificationState.run(userId, nowMs, nowMs);
    },
    // v1.68 (Dean ruling 3): per-row dismissal - the row leaves THIS user's
    // panel and badge, survives for everyone else. Same phantom-id
    // discipline as markNotificationRead (false -> the route 400s).
    // Idempotent: re-dismissing an already-dismissed row is true.
    dismissNotification(userId, notificationId, nowMs) {
      const s = st();
      if (!Number.isInteger(notificationId) || !s.notificationById.get(notificationId)) return false;
      s.addNotificationDismissal.run(userId, notificationId, nowMs);
      return true;
    },
    // v1.68 (Dean rulings 1-2): the play hook - a play of media that has a
    // feed row dismisses it for the player. NO feed row is a clean no-op
    // (false), never an error: most plays are of media that was never in
    // the feed, or whose row was evicted.
    dismissNotificationByMedia(userId, mediaId, nowMs) {
      const s = st();
      if (typeof mediaId !== 'string' || mediaId === '') return false;
      const row = s.notificationIdByMedia.get(mediaId);
      if (!row) return false;
      s.addNotificationDismissal.run(userId, row.id, nowMs);
      return true;
    },
    countNotifications() {
      return st().countAllNotifications.get().c;
    },
    // One-shot upgrade seeding (exec-plan decision 4): feed rows land as
    // ALREADY-SEEN, ALREADY-READ history for every EXISTING user -- panel
    // populated, badge 0, no dots. Callers guard with countNotifications()
    // + the settings flag; this method itself is just the atomic write.
    seedNotifications(entries, nowMs) {
      const list = (Array.isArray(entries) ? entries : []).filter(isValidNotificationEntry);
      if (list.length === 0) return 0;
      const s = st();
      adapter.begin();
      try {
        const ids = [];
        for (const e of list) {
          s.delReadsByMedia.run(e.mediaId);
          s.delDismissalsByMedia.run(e.mediaId); // v1.68: same replace semantics as recordNotifications
          s.delNotificationByMedia.run(e.mediaId);
          ids.push(Number(s.insertNotification.run(e.mediaId, Math.floor(e.createdAt)).lastInsertRowid));
        }
        for (const u of adapter.sql.prepare('SELECT id FROM users').all()) {
          s.upsertNotificationSeen.run(u.id, nowMs);
          for (const nid of ids) s.addNotificationRead.run(u.id, nid, nowMs);
        }
        adapter.commit();
      } catch (err) {
        adapter.rollback();
        throw err;
      }
      return list.length;
    },
    // Backup surface for the GLOBAL feed (the per-user halves ride each
    // user's bundle entry in exportUsersForBackup below).
    exportNotificationsForBackup() {
      return st().allNotifications.all().map((r) => ({ mediaId: r.media_id, createdAt: r.created_at }));
    },
    // Restore the global feed. MUST run inside the caller's already-open
    // restore transaction, BEFORE replaceAllUsersRaw (reads in the user
    // bundles resolve media ids against this table). Absent/malformed rows
    // are skipped -- a pre-v1.51 bundle restores an intact instance with
    // whatever feed it already had, untouched (`undefined` input is a no-op).
    //
    // GATE FIX (QA W1): EXISTING users' reads are snapshotted by MEDIA id
    // before the wipe and re-resolved after the insert. Feed ids are
    // regenerated here, so the raw read rows cannot survive -- but a bundle
    // that carries `notifications` WITHOUT a users array (a hand-trimmed or
    // feed-only bundle; validateBackupBundle legally accepts it) previously
    // destroyed every user's already-tapped dots with nothing repopulating
    // them. A users-carrying restore still wins wholesale: replaceAllUsersRaw
    // runs AFTER this in the same transaction, cascade-wipes these re-keyed
    // rows with the users, and repopulates from the bundle.
    //
    // GATE FIX (adversarial W3): the incoming feed is capped to the SAME
    // NOTIFICATION_CAP the live insert path enforces (newest first) -- a
    // crafted/oversized bundle can no longer restore an unbounded feed that
    // the panel LIMITs away while the badge counts it.
    replaceAllNotificationsRaw(rows) {
      if (!Array.isArray(rows)) return;
      const sql = adapter.sql;
      const s = st();
      const preserved = sql.prepare(
        'SELECT r.user_id AS userId, n.media_id AS mediaId, r.read_at AS readAt FROM user_notification_reads r JOIN notifications n ON n.id = r.notification_id'
      ).all();
      // v1.68: dismissals snapshot by MEDIA id exactly like reads (same
      // QA-W1 reasoning: feed ids regenerate below, a feed-only bundle
      // must not resurrect every user's dismissed rows).
      const preservedDismissals = sql.prepare(
        'SELECT d.user_id AS userId, n.media_id AS mediaId, d.dismissed_at AS dismissedAt FROM user_notification_dismissals d JOIN notifications n ON n.id = d.notification_id'
      ).all();
      sql.exec('DELETE FROM user_notification_reads');
      sql.exec('DELETE FROM user_notification_dismissals');
      sql.exec('DELETE FROM notifications');
      const kept = rows.filter(isValidNotificationEntry)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, NOTIFICATION_CAP)
        .reverse(); // insert oldest-first so ids ascend with time, like live inserts
      for (const r of kept) {
        s.insertNotification.run(r.mediaId, Math.floor(r.createdAt));
      }
      for (const p of preserved) {
        const feedRow = s.notificationIdByMedia.get(p.mediaId);
        if (feedRow) s.addNotificationRead.run(p.userId, feedRow.id, p.readAt);
      }
      for (const p of preservedDismissals) {
        const feedRow = s.notificationIdByMedia.get(p.mediaId);
        if (feedRow) s.addNotificationDismissal.run(p.userId, feedRow.id, p.dismissedAt);
      }
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
    // endpoint -- the scan prune is the only lifecycle site. v1.72: the
    // liked + finished carriers retire with progress (one transaction).
    removeBookState(bookIds) {
      const ids = Array.isArray(bookIds) ? bookIds : [bookIds];
      if (ids.length === 0) return;
      const s = st();
      adapter.begin();
      try {
        for (const id of ids) {
          s.delBookProgressByBook.run(id);
          s.delBookLikedByBook.run(id);
          s.delBookFinishedByBook.run(id);
        }
        adapter.commit();
      } catch (err) {
        adapter.rollback();
        throw err;
      }
    },
    // ---- v1.72 books first-class: likes + the manual finished latch ----
    getBookLiked(userId) {
      return st().getBookLiked.all(userId).map((r) => ({ bookId: r.book_id, likedAt: r.liked_at }));
    },
    addBookLiked(userId, bookId, likedAt) {
      st().addBookLiked.run(userId, bookId, likedAt);
    },
    removeBookLiked(userId, bookId) {
      st().removeBookLiked.run(userId, bookId);
    },
    getBookFinished(userId) {
      // Null-prototype map keyed by book id (the __proto__ row-key defense),
      // value = finished_at - the getPodcastPlayed shape.
      const out = Object.create(null);
      for (const r of st().getBookFinished.all(userId)) out[r.book_id] = r.finished_at;
      return out;
    },
    // ---- v1.72 podcast show pins (the book-pins accessor shape) ----
    getPodcastPins(userId) {
      return st().getPodcastPins.all(userId).map((r) => safeParse(r.pin_json)).filter(Boolean);
    },
    // Whole-set replace (one transaction) - the setBookPins posture: the
    // routes run lib/podcasts/store.js's pure reducers and persist here.
    setPodcastPins(userId, pins) {
      const s = st();
      adapter.begin();
      try {
        s.delAllPodcastPins.run(userId);
        for (const pin of Array.isArray(pins) ? pins : []) {
          if (pin && pin.id) s.upsertPodcastPin.run(userId, pin.id, JSON.stringify(pin), num(pin.order));
        }
        adapter.commit();
      } catch (err) {
        adapter.rollback();
        throw err;
      }
    },
    // Unsubscribe carrier: the show's pin rows retire for EVERY user (the
    // delete carrier joins the birth commit - the id-keyed-carrier law).
    removePodcastShowPins(subId) {
      st().delPodcastPinBySub.run(subId);
    },
    setBookFinished(userId, bookId, finishedAt) {
      st().setBookFinished.run(userId, bookId, finishedAt);
    },
    clearBookFinished(userId, bookId) {
      st().clearBookFinished.run(userId, bookId);
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
    // ---- v1.63 playback queue ----------------------------------------------
    getQueue(userId) {
      // kind: pre-v10 rows read back as 'media' via the column DEFAULT;
      // anything unexpected normalizes to 'media' too (fail-toward-legacy).
      // v1.72: 'track' joins the recognized roster (music in the one queue).
      const entries = st().getQueueEntries.all(userId).map((r) => ({ uid: r.entry_uid, mediaId: r.media_id, kind: (r.entry_kind === 'podcast' || r.entry_kind === 'track') ? r.entry_kind : 'media' }));
      const state = st().getQueueState.get(userId) || {};
      return { entries, pointerUid: state.pointer_uid || null, updatedAt: state.updated_at || 0 };
    },
    // Whole-set replace in one transaction (the setBookPins posture): the
    // queue routes run lib/queue/store.js's pure reducers and persist the
    // output here, keeping the reducers the single source of queue
    // semantics. A null/empty entries array + null pointer = cleared queue
    // (both tables emptied - the icon existence check is entries.length).
    setQueue(userId, entries, pointerUid, updatedAt) {
      const s = st();
      adapter.begin();
      try {
        s.delAllQueueEntries.run(userId);
        const list = Array.isArray(entries) ? entries : [];
        list.forEach((e, i) => {
          // v1.72: 'track' joins the persisted roster; anything else still
          // fails toward 'media' (the pre-v10 legacy posture).
          if (e && e.uid && e.mediaId) s.upsertQueueEntry.run(userId, e.uid, e.mediaId, i, (e.kind === 'podcast' || e.kind === 'track') ? e.kind : 'media');
        });
        if (list.length === 0 && !pointerUid) s.delQueueState.run(userId);
        else s.upsertQueueState.run(userId, pointerUid || null, updatedAt || 0);
        adapter.commit();
      } catch (err) {
        adapter.rollback();
        throw err;
      }
    },
    // ---- v1.66 web push subscriptions --------------------------------------
    // Store-level shape refusal mirrors isValidNotificationEntry: garbage is
    // skipped/thrown here even though the route validates first - the store
    // is the last writer standing. Deliberately NOT in exportUsersForBackup /
    // replaceAllUsersRaw: subscriptions never ride bundles (exec plan v1.66
    // D2 - endpoint+auth are secrets, and rows are bound to this instance's
    // VAPID key). A users-restore drops them via cascade; the client boot
    // reconcile re-registers.
    upsertPushSubscription(userId, sub, initialCursor, nowMs) {
      if (!Number.isInteger(userId)) throw new Error('userId must be an integer');
      const ok = sub && typeof sub === 'object'
        && typeof sub.endpoint === 'string' && sub.endpoint.length > 0 && sub.endpoint.length <= 2048
        && typeof sub.p256dh === 'string' && sub.p256dh.length > 0 && sub.p256dh.length <= 512
        && typeof sub.auth === 'string' && sub.auth.length > 0 && sub.auth.length <= 512;
      if (!ok) throw new Error('invalid push subscription shape');
      const cursor = Number.isInteger(initialCursor) && initialCursor > 0 ? initialCursor : 0;
      st().upsertPushSubscription.run(sub.endpoint, userId, sub.p256dh, sub.auth, cursor, Math.floor(nowMs));
    },
    getPushSubscription(endpoint) {
      const r = st().getPushSubscription.get(endpoint);
      if (!r) return null;
      return { endpoint: r.endpoint, userId: r.user_id, p256dh: r.p256dh, auth: r.auth, lastPushedId: r.last_pushed_id, cooldownUntil: r.cooldown_until, createdAt: r.created_at };
    },
    // Delivery roster (disabled users already excluded by the join).
    listPushSubscriptionsForDelivery() {
      return st().listPushSubscriptions.all().map((r) => ({
        endpoint: r.endpoint,
        userId: r.user_id,
        p256dh: r.p256dh,
        auth: r.auth,
        lastPushedId: r.last_pushed_id,
        cooldownUntil: r.cooldown_until,
        settingsJson: r.settings_json,
      }));
    },
    countPushSubscriptions(userId) {
      return st().countPushSubscriptionsForUser.get(userId).c;
    },
    // Prune (dead endpoint: 404/410, or delivery-time guard refusal).
    removePushSubscription(endpoint) {
      st().delPushSubscription.run(endpoint);
    },
    // Unsubscribe route: only the owner's row; returns whether one existed.
    removeOwnPushSubscription(userId, endpoint) {
      return st().delPushSubscriptionOwned.run(endpoint, userId).changes > 0;
    },
    advancePushCursor(endpoint, notificationId) {
      if (!Number.isInteger(notificationId) || notificationId < 0) return;
      st().advancePushCursor.run(notificationId, endpoint);
    },
    setPushCooldown(endpoint, untilMs) {
      st().setPushCooldown.run(Math.max(0, Math.floor(untilMs) || 0), endpoint);
    },
    getMaxNotificationId() {
      return st().maxNotificationId.get().m;
    },
    listNotificationsAfter(cursorId, limit) {
      return st().notificationsAfterId.all(cursorId, limit).map((r) => ({ id: r.id, mediaId: r.media_id, createdAt: r.created_at }));
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

    // ---- v1.44 music: per-user liked / progress / resume pointer ------------
    getMusicLiked(userId) {
      return st().getMusicLiked.all(userId).map((r) => r.track_id);
    },
    addMusicLiked(userId, trackId, likedAt) {
      st().addMusicLiked.run(userId, trackId, likedAt);
    },
    removeMusicLiked(userId, trackId) {
      st().removeMusicLiked.run(userId, trackId);
    },
    getMusicProgress(userId) {
      // Null-prototype accumulator (the __proto__ row-key lesson): a hostile
      // track_id of '__proto__' must land as a PLAIN key, never a prototype write.
      const out = Object.create(null);
      for (const r of st().getMusicProgress.all(userId)) {
        out[r.track_id] = { position: r.position_seconds, duration: r.duration_seconds, updatedAt: r.updated_at };
      }
      return out;
    },
    getOneMusicProgress(userId, trackId) {
      const r = st().getOneMusicProgress.get(userId, trackId);
      return r ? { position: r.position_seconds, duration: r.duration_seconds, updatedAt: r.updated_at } : null;
    },
    setMusicProgress(userId, trackId, { position, duration, updatedAt }) {
      st().upsertMusicProgress.run(userId, trackId, num(position), num(duration), typeof updatedAt === 'string' ? updatedAt : null);
    },
    // The music coalescer's flush target — a whole batch window's pings commit
    // as ONE transaction (the v1.30 write-amp contract). Entries:
    // [{ userId, trackId, value: {position, duration, updatedAt} }].
    setMusicProgressBatch(entries) {
      if (!Array.isArray(entries) || entries.length === 0) return;
      const s = st();
      // FK-poison guard (identical to setProgressBatch): a staged ping for a
      // user DELETEd between staging and flush would FK-violate mid-transaction
      // and roll back the WHOLE batch, destroying innocent co-users' positions.
      // Filter to still-existing users BEFORE the transaction.
      const existing = new Set(adapter.sql.prepare('SELECT id FROM users').all().map((r) => r.id));
      const rows = entries.filter((e) => existing.has(e.userId));
      if (rows.length === 0) return;
      adapter.begin();
      try {
        for (const e of rows) {
          s.upsertMusicProgress.run(e.userId, e.trackId, num(e.value.position), num(e.value.duration), typeof e.value.updatedAt === 'string' ? e.value.updatedAt : null);
        }
        adapter.commit();
      } catch (err) {
        adapter.rollback();
        throw err;
      }
    },
    // ---- v1.69 podcasts: per-user episode resume + played latch ----
    getPodcastProgress(userId) {
      // Null-prototype accumulator (the __proto__ row-key lesson).
      const out = Object.create(null);
      for (const r of st().getPodcastProgress.all(userId)) {
        out[r.episode_id] = { position: r.position_seconds, duration: r.duration_seconds, updatedAt: r.updated_at };
      }
      return out;
    },
    getOnePodcastProgress(userId, episodeId) {
      const r = st().getOnePodcastProgress.get(userId, episodeId);
      return r ? { position: r.position_seconds, duration: r.duration_seconds, updatedAt: r.updated_at } : null;
    },
    setPodcastProgress(userId, episodeId, { position, duration, updatedAt }) {
      st().upsertPodcastProgress.run(userId, episodeId, num(position), num(duration), typeof updatedAt === 'string' ? updatedAt : null);
    },
    getPodcastPlayed(userId) {
      const out = Object.create(null);
      for (const r of st().getPodcastPlayedForUser.all(userId)) {
        out[r.episode_id] = r.played_at;
      }
      return out;
    },
    setPodcastPlayed(userId, episodeId, playedAt) {
      st().setPodcastPlayed.run(userId, episodeId, typeof playedAt === 'string' ? playedAt : null);
    },
    clearPodcastPlayed(userId, episodeId) {
      st().delPodcastPlayed.run(userId, episodeId);
    },
    // ---- v1.71 podcasts: per-user episode likes ----
    getPodcastLiked(userId) {
      return st().getPodcastLiked.all(userId).map((r) => ({ episodeId: r.episode_id, likedAt: r.liked_at }));
    },
    addPodcastLiked(userId, episodeId, likedAt) {
      st().addPodcastLiked.run(userId, episodeId, typeof likedAt === 'string' ? likedAt : null);
    },
    removePodcastLiked(userId, episodeId) {
      st().removePodcastLiked.run(userId, episodeId);
    },
    // The TENTH id-keyed carrier's delete half: an episode (or its whole
    // subscription) leaving the library purges every user's rows for it.
    // Called AFTER the doc-table mutation commits (the removeMediaState
    // posture). No re-key half exists BY CONSTRUCTION: episode ids derive
    // from subId+guid, never from file paths, so a file move never re-keys.
    // Since v10 the same carrier retires the ELEVENTH table (likes) and
    // every podcast-kind queue row for the episode, in the SAME transaction.
    removePodcastEpisodeState(episodeIds) {
      const ids = Array.isArray(episodeIds) ? episodeIds : [episodeIds];
      if (ids.length === 0) return;
      const s = st();
      adapter.begin();
      try {
        for (const id of ids) {
          s.delPodcastProgressByEpisode.run(id);
          s.delPodcastPlayedByEpisode.run(id);
          s.delPodcastLikedByEpisode.run(id);
          s.delQueueByEpisode.run(id);
        }
        adapter.commit();
      } catch (err) {
        adapter.rollback();
        throw err;
      }
    },
    // Resume pointer: one row per user (last track + its queue context +
    // position). queueCtx is the v1.40 context descriptor string (opaque here);
    // stored as JSON text, parsed back on read.
    getMusicState(userId) {
      const r = st().getMusicState.get(userId);
      if (!r) return null;
      return {
        lastTrackId: r.last_track_id || null,
        queueCtx: r.queue_ctx_json ? safeParse(r.queue_ctx_json) : null,
        position: r.position_seconds,
        updatedAt: r.updated_at,
      };
    },
    setMusicState(userId, { lastTrackId, queueCtx, position, updatedAt } = {}) {
      st().upsertMusicState.run(
        userId,
        typeof lastTrackId === 'string' ? lastTrackId : null,
        queueCtx === undefined || queueCtx === null ? null : JSON.stringify(queueCtx),
        num(position),
        typeof updatedAt === 'string' ? updatedAt : new Date().toISOString(),
      );
    },
    // Track-id lifecycle (prune): shed every user's liked/progress for the
    // pruned tracks AND null any resume pointer that referenced them, in ONE
    // transaction. Post-commit posture (mirrors removeMediaState/removeBookState).
    removeMusicState(trackIds) {
      const ids = Array.isArray(trackIds) ? trackIds : [trackIds];
      if (ids.length === 0) return;
      const s = st();
      adapter.begin();
      try {
        for (const id of ids) {
          s.delMusicProgressByTrack.run(id);
          s.delMusicLikedByTrack.run(id);
          s.nullMusicStateByTrack.run(id);
          // v1.72: a pruned track's queue rows retire too (kind-scoped -
          // a media/podcast row sharing the md5 id survives untouched).
          s.delQueueByTrack.run(id);
        }
        adapter.commit();
      } catch (err) {
        adapter.rollback();
        throw err;
      }
    },
    // Track-id lifecycle (move/re-key): carry liked/progress AND the resume
    // pointer to the new id. OR-REPLACE so an in-flight ping re-keyed ahead of
    // us doesn't throw on the PK collision (last write wins).
    rekeyMusicState(oldId, newId) {
      const s = st();
      adapter.begin();
      try {
        s.rekeyMusicProgress.run(newId, oldId);
        s.rekeyMusicLiked.run(newId, oldId);
        s.rekeyMusicStateTrack.run(newId, oldId);
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
        // v1.51: raw state row (null when the user never touched the panel --
        // the bundle carries that absence honestly rather than a fake 0/0 row).
        const nstate = st().getNotificationState.get(r.id) || null;
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
          // v1.50 watched latch (id-keyed carrier: rides the same bundle).
          watched: sql.prepare('SELECT media_id, completed_at FROM user_watched WHERE user_id = ? ORDER BY media_id').all(r.id)
            .map((row) => ({ mediaId: row.media_id, completedAt: row.completed_at })),
          bookProgress: this.getBookProgress(r.id),
          bookPins: this.getBookPins(r.id),
          // v1.72 books first-class (TWELFTH-strike carrier): likes ride as
          // {bookId, likedAt} rows (the musicLiked ritual), the finished
          // latch as a plain {bookId: finishedAt} object (the podcastPlayed
          // ritual). Book ids are the scanner's stable keys - they survive
          // the trip like media ids do.
          bookLiked: this.getBookLiked(r.id),
          bookFinished: { ...this.getBookFinished(r.id) },
          // v1.72 podcast show pins ride like bookPins (pin records
          // verbatim; subIds are md5(feed identity) - instance-agnostic).
          podcastPins: this.getPodcastPins(r.id),
          channelPins: this.getChannelPins(r.id),
          // v1.44 music (SEVENTH-strike carrier: the new id-keyed per-user
          // namespace rides the SAME backup bundle as the tables that carry it).
          musicLiked: sql.prepare('SELECT track_id, liked_at FROM user_music_liked WHERE user_id = ? ORDER BY liked_at, track_id').all(r.id)
            .map((row) => ({ trackId: row.track_id, likedAt: row.liked_at })),
          musicProgress: this.getMusicProgress(r.id),
          musicState: this.getMusicState(r.id),
          // v1.69 podcasts (TENTH-strike carrier: the new id-keyed per-user
          // namespace rides the SAME bundle as the tables' birth commit).
          // Episode ids are md5(subId+guid) - instance-agnostic, they
          // survive the trip like media ids do. Spread into plain objects:
          // the accessors return null-prototype maps (the __proto__ row-key
          // defense), which JSON.stringify serializes fine, but a plain
          // object keeps the bundle shape boring.
          podcastProgress: { ...this.getPodcastProgress(r.id) },
          podcastPlayed: { ...this.getPodcastPlayed(r.id) },
          // v1.71 episode likes (ELEVENTH-strike carrier, same bundle
          // ritual as musicLiked: array of {episodeId, likedAt}).
          podcastLiked: this.getPodcastLiked(r.id),
          // v1.51 notification bell (EIGHTH-strike carrier). Reads are
          // exported keyed by MEDIA id, not notification id -- feed ids are
          // instance-local AUTOINCREMENT values that a restore regenerates,
          // while media ids are stable md5(path) keys that survive the trip.
          notificationState: nstate ? { lastSeenAt: nstate.last_seen_at, clearedAt: nstate.cleared_at } : null,
          notificationReads: st().readsForUser.all(r.id)
            .map((row) => ({ mediaId: row.media_id, readAt: row.read_at })),
          // v1.68: the dismissal lane rides the same per-user bundle half.
          notificationDismissals: st().dismissalsForUser.all(r.id)
            .map((row) => ({ mediaId: row.media_id, dismissedAt: row.dismissed_at })),
          // v1.63 playback queue (NINTH-strike carrier). Media ids are the
          // stable md5(path) keys that survive the trip; entry uids are
          // instance-agnostic uuids and ride verbatim.
          queue: this.getQueue(r.id),
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
    replaceAllUsersRaw(users, nowMs = Date.now()) {
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
        // v1.50 watched latch (absent in pre-v1.50 bundles -- restores empty).
        for (const w of Array.isArray(u.watched) ? u.watched : []) {
          if (w && typeof w.mediaId === 'string') s.addWatched.run(u.id, w.mediaId, typeof w.completedAt === 'string' ? w.completedAt : null);
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
        // v1.72 books first-class (TWELFTH-strike carrier). Absent in
        // pre-v1.72 bundles - legal, restores nothing.
        for (const like of Array.isArray(u.bookLiked) ? u.bookLiked : []) {
          if (like && typeof like.bookId === 'string') s.addBookLiked.run(u.id, like.bookId, typeof like.likedAt === 'string' ? like.likedAt : null);
        }
        const bf = u.bookFinished && typeof u.bookFinished === 'object' && !Array.isArray(u.bookFinished) ? u.bookFinished : {};
        for (const bookId of Object.keys(bf)) {
          s.setBookFinished.run(u.id, bookId, typeof bf[bookId] === 'string' ? bf[bookId] : null);
        }
        for (const pin of Array.isArray(u.channelPins) ? u.channelPins : []) {
          if (pin && pin.id) s.upsertChannelPin.run(u.id, pin.id, JSON.stringify(pin), num(pin.order));
        }
        // v1.72 podcast show pins (absent in pre-v1.72 bundles - legal).
        for (const pin of Array.isArray(u.podcastPins) ? u.podcastPins : []) {
          if (pin && pin.id) s.upsertPodcastPin.run(u.id, pin.id, JSON.stringify(pin), num(pin.order));
        }
        // v1.44 music per-user state (SEVENTH-strike carrier).
        for (const like of Array.isArray(u.musicLiked) ? u.musicLiked : []) {
          if (like && typeof like.trackId === 'string') s.addMusicLiked.run(u.id, like.trackId, typeof like.likedAt === 'string' ? like.likedAt : null);
        }
        const mp = u.musicProgress && typeof u.musicProgress === 'object' ? u.musicProgress : {};
        for (const trackId of Object.keys(mp)) {
          const pos = mp[trackId];
          if (!pos || typeof pos !== 'object') continue;
          s.upsertMusicProgress.run(u.id, trackId, num(pos.position), num(pos.duration), typeof pos.updatedAt === 'string' ? pos.updatedAt : null);
        }
        // v1.69 podcast per-user state (TENTH-strike carrier). Absent in
        // pre-v1.69 bundles - legal, restores nothing.
        const pp = u.podcastProgress && typeof u.podcastProgress === 'object' ? u.podcastProgress : {};
        for (const episodeId of Object.keys(pp)) {
          const pos = pp[episodeId];
          if (!pos || typeof pos !== 'object') continue;
          s.upsertPodcastProgress.run(u.id, episodeId, num(pos.position), num(pos.duration), typeof pos.updatedAt === 'string' ? pos.updatedAt : null);
        }
        const played = u.podcastPlayed && typeof u.podcastPlayed === 'object' ? u.podcastPlayed : {};
        for (const episodeId of Object.keys(played)) {
          s.setPodcastPlayed.run(u.id, episodeId, typeof played[episodeId] === 'string' ? played[episodeId] : null);
        }
        // v1.71 episode likes (ELEVENTH-strike carrier). Absent in
        // pre-v1.71 bundles - legal, restores nothing.
        for (const like of Array.isArray(u.podcastLiked) ? u.podcastLiked : []) {
          if (like && typeof like.episodeId === 'string' && like.episodeId) {
            s.addPodcastLiked.run(u.id, like.episodeId, typeof like.likedAt === 'string' ? like.likedAt : null);
          }
        }
        // v1.51 notification state (EIGHTH-strike carrier). A bundle that
        // carries state restores it verbatim. A PRE-v1.51 bundle carries
        // none: those users get last_seen_at = the restore moment -- the
        // surviving/restored feed predates the restore, so "everything up to
        // now is seen" is the only default that does not greet every restored
        // account with a badge-storm of old history (the account-created_at
        // default cannot help here: restored accounts are typically OLDER
        // than every feed row).
        // Three bundle shapes, three restores:
        // - object  (v1.51+, user HAS state)  -> verbatim.
        // - null    (v1.51+, user never touched the panel) -> NO row, so the
        //   account-created_at default keeps working after the round-trip.
        // - absent  (pre-v1.51 bundle)        -> last_seen_at = restore
        //   moment, because "everything before the restore is seen".
        const ns = u.notificationState && typeof u.notificationState === 'object' ? u.notificationState : null;
        if (ns && typeof ns.lastSeenAt === 'number' && Number.isFinite(ns.lastSeenAt)) {
          const nsCleared = typeof ns.clearedAt === 'number' && Number.isFinite(ns.clearedAt) ? ns.clearedAt : 0;
          s.upsertNotificationState.run(u.id, ns.lastSeenAt, nsCleared);
        } else if (!('notificationState' in u)) {
          s.upsertNotificationState.run(u.id, nowMs, 0);
        }
        for (const rd of Array.isArray(u.notificationReads) ? u.notificationReads : []) {
          if (!rd || typeof rd.mediaId !== 'string') continue;
          const feedRow = s.notificationIdByMedia.get(rd.mediaId);
          // A read whose feed row did not survive the trip (evicted, or the
          // bundle predates the feed) is dropped -- reads are meaningless
          // without their row.
          if (feedRow) {
            s.addNotificationRead.run(u.id, feedRow.id, typeof rd.readAt === 'number' && Number.isFinite(rd.readAt) ? rd.readAt : nowMs);
          }
        }
        // v1.68 dismissals: same by-media re-resolve, same dropped-when-
        // rowless posture, absent key (pre-v1.68 bundle) restores nothing
        // dismissed - legal.
        for (const dm of Array.isArray(u.notificationDismissals) ? u.notificationDismissals : []) {
          if (!dm || typeof dm.mediaId !== 'string') continue;
          const feedRow = s.notificationIdByMedia.get(dm.mediaId);
          if (feedRow) {
            s.addNotificationDismissal.run(u.id, feedRow.id, typeof dm.dismissedAt === 'number' && Number.isFinite(dm.dismissedAt) ? dm.dismissedAt : nowMs);
          }
        }
        // v1.63 playback queue (NINTH-strike carrier). Absent (pre-v1.63
        // bundle) or malformed -> no queue rows: an empty queue is the
        // correct default and no header icon appears. A partial restore
        // must preserve what it does not repopulate (the v1.51 lesson) -
        // that is handled a level up: users-carrying restores replace the
        // user set wholesale, and non-users bundles never reach this code.
        const qb = u.queue && typeof u.queue === 'object' ? u.queue : null;
        if (qb) {
          const qEntries = Array.isArray(qb.entries) ? qb.entries : [];
          qEntries.forEach((e, i) => {
            if (e && typeof e.uid === 'string' && e.uid && typeof e.mediaId === 'string' && e.mediaId) {
              // v10: kind rides the bundle; pre-v10 bundles carry none and
              // every row restores as 'media' (the column's own default).
              // v1.72: 'track' rides the trip too.
              s.upsertQueueEntry.run(u.id, e.uid, e.mediaId, i, (e.kind === 'podcast' || e.kind === 'track') ? e.kind : 'media');
            }
          });
          const qPtr = typeof qb.pointerUid === 'string' && qb.pointerUid ? qb.pointerUid : null;
          if (qEntries.length > 0 || qPtr) {
            s.upsertQueueState.run(u.id, qPtr, typeof qb.updatedAt === 'number' && Number.isFinite(qb.updatedAt) ? qb.updatedAt : 0);
          }
        }
        const ms = u.musicState && typeof u.musicState === 'object' ? u.musicState : null;
        if (ms) {
          s.upsertMusicState.run(
            u.id,
            typeof ms.lastTrackId === 'string' ? ms.lastTrackId : null,
            ms.queueCtx === undefined || ms.queueCtx === null ? null : JSON.stringify(ms.queueCtx),
            num(ms.position),
            typeof ms.updatedAt === 'string' ? ms.updatedAt : null,
          );
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
      adapter.sql.exec('DELETE FROM user_watched');
      adapter.sql.exec('DELETE FROM user_book_progress');
      adapter.sql.exec('DELETE FROM user_book_pins');
      adapter.sql.exec('DELETE FROM user_channel_pins');
      adapter.sql.exec('DELETE FROM user_music_liked');
      adapter.sql.exec('DELETE FROM user_music_progress');
      adapter.sql.exec('DELETE FROM user_music_state');
      // v1.69 podcasts: the per-user episode state must not bleed across cases.
      adapter.sql.exec('DELETE FROM user_podcast_progress');
      adapter.sql.exec('DELETE FROM user_podcast_played');
      // v1.71: episode likes join the same reset.
      adapter.sql.exec('DELETE FROM user_podcast_liked');
      // v1.51 notification bell: the per-user halves AND the global feed --
      // a case's downloads must not bleed a badge into the next case.
      adapter.sql.exec('DELETE FROM user_notification_reads');
      adapter.sql.exec('DELETE FROM user_notification_state');
      adapter.sql.exec('DELETE FROM notifications');
      // v1.63 playback queue (gate W2: the NINTH carrier missed THIS seam
      // at birth - a seeded queue must not bleed into the next case).
      adapter.sql.exec('DELETE FROM user_queue');
      adapter.sql.exec('DELETE FROM user_queue_state');
      // v1.66 web push: a case's subscriptions must not receive the next
      // case's deliveries.
      adapter.sql.exec('DELETE FROM push_subscriptions');
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
