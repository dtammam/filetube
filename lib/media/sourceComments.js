'use strict';

// v1.394.0: a downloaded video's top comments, the snapshot taken when it was
// downloaded (or last reheated). One feature-owned table, never a db.metadata
// field (LESSONS 9: no persist-gate OR-chain to join):
//
//   media_source_comments (media_id TEXT PRIMARY KEY, payload TEXT NOT NULL,
//                          fetched_at TEXT NOT NULL, state TEXT NOT NULL)
//
// `state` is 'ok' (payload = the comments, newest snapshot) or 'disabled' (the
// source has comments turned off; payload = []). It is keyed by the media id
// (md5 of the path), so it rides every id-keyed carrier: the delete / prune /
// purge and the move / trash / restore re-key statements live in
// lib/auth/store.js removeMediaState / rekeyMediaState (the one choke point
// every one of those paths calls), and the backup bundle carries it as
// `sourceComments` (lib/admin/backup.js).
//
// Everything stored here came from a stranger on the internet. Every boundary
// that reads it (the download print, the download-meta bridge, a reheat's
// JSON, a backup bundle, the table itself) goes through sanitizeSnapshot: the
// fields R1-R6 render and nothing else (never author_url or a thumbnail),
// control characters stripped, every length capped.
//
// R9 (a failed fetch never erases) lives in decideSnapshot: it returns null for
// "keep what is stored" (a failed, interrupted or empty fetch) and a snapshot
// only for a successful non-empty fetch or a source with comments turned off.

const { isPersistableId } = require('./jsonRowStore');

const TABLE = 'media_source_comments';
const MAX_COMMENTS = 10;
const MAX_TEXT = 2000;
const MAX_AUTHOR = 100;
const MAX_ID = 128;
const MAX_TIME_TEXT = 40;
const MAX_PAYLOAD_BYTES = 48 * 1024;
const MAX_LIKES = 1e12;
// A comment cannot predate the site; a timestamp in the future is a bad estimate.
const MIN_TIMESTAMP_SEC = Date.UTC(2005, 0, 1) / 1000;
const STATES = new Set(['ok', 'disabled']);

const UPSERT_SQL = `INSERT INTO ${TABLE}(media_id, payload, fetched_at, state) VALUES(?, ?, ?, ?) ON CONFLICT(media_id) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at, state = excluded.state`;

function assertMediaId(id) {
  if (typeof id !== 'string' || id === '') {
    throw new Error(`sourceComments: media id must be a non-empty string (got ${typeof id})`);
  }
  if (id.includes('\u0000')) {
    throw new Error('sourceComments: media id contains U+0000 - node:sqlite reads a NUL-bearing TEXT back truncated on Node 24.14 and older, so a persisted NUL-bearing key would read back as a colliding prefix. Refusing.');
  }
}

// Text keeps its line breaks and tabs; every other control character goes.
function cleanText(v, max, keepBreaks) {
  if (typeof v !== 'string') return '';
  const re = keepBreaks ? /[\u0000-\u0008\u000b-\u001f\u007f]/g : /[\u0000-\u001f\u007f]/g; // eslint-disable-line no-control-regex
  const s = v.replace(re, '').replace(/[\u2028\u2029]/g, keepBreaks ? '\n' : ' ').trim();
  return s.length > max ? s.slice(0, max) : s;
}

function cleanCount(v) {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_LIKES ? v : null;
}

function cleanTimestamp(v, nowMs) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  if (v < MIN_TIMESTAMP_SEC || v > nowMs / 1000 + 86400) return null;
  return Math.floor(v);
}

// One comment, from yt-dlp's comment dict (snake_case) OR our stored shape
// (camelCase) - the same function re-validates both. Null = drop it.
function sanitizeComment(raw, nowMs) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  // R5: top-level only. yt-dlp marks a top-level comment parent 'root'.
  if (raw.parent !== undefined && raw.parent !== null && raw.parent !== 'root') return null;
  const text = cleanText(raw.text, MAX_TEXT, true);
  if (text === '') return null;
  const out = {
    id: cleanText(raw.id, MAX_ID, false),
    text,
    author: cleanText(raw.author, MAX_AUTHOR, false),
  };
  const likes = cleanCount(raw.likeCount !== undefined ? raw.likeCount : raw.like_count);
  if (likes !== null) out.likeCount = likes;
  if ((raw.isPinned !== undefined ? raw.isPinned : raw.is_pinned) === true) out.isPinned = true;
  if ((raw.isUploader !== undefined ? raw.isUploader : raw.author_is_uploader) === true) out.isUploader = true;
  const ts = cleanTimestamp(raw.timestamp, nowMs);
  if (ts !== null) out.timestamp = ts;
  const timeText = cleanText(raw.timeText !== undefined ? raw.timeText : raw._time_text, MAX_TIME_TEXT, false);
  if (timeText !== '') out.timeText = timeText;
  return out;
}

function sanitizeComments(list, nowMs) {
  const out = [];
  if (!Array.isArray(list)) return out;
  let bytes = 2;
  for (const raw of list) {
    if (out.length >= MAX_COMMENTS) break;
    const c = sanitizeComment(raw, nowMs);
    if (!c) continue;
    const size = Buffer.byteLength(JSON.stringify(c), 'utf8') + 1;
    if (bytes + size > MAX_PAYLOAD_BYTES) break;
    bytes += size;
    out.push(c);
  }
  return out;
}

function cleanFetchedAt(v, nowMs) {
  const ms = typeof v === 'number' ? v : (typeof v === 'string' ? Date.parse(v) : NaN);
  if (!Number.isFinite(ms) || ms <= 0 || ms > nowMs + 86400e3) return null;
  return new Date(ms).toISOString();
}

// A stored / bridged / bundled snapshot, re-validated. Null = unusable.
// Shape: { state: 'ok'|'disabled', fetchedAt: ISO string, comments: [...] }.
function sanitizeSnapshot(raw, nowMs = Date.now()) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (!STATES.has(raw.state)) return null;
  const fetchedAt = cleanFetchedAt(raw.fetchedAt, nowMs);
  if (!fetchedAt) return null;
  if (raw.state === 'disabled') return { state: 'disabled', fetchedAt, comments: [] };
  const comments = sanitizeComments(raw.comments, nowMs);
  if (comments.length === 0) return null; // an 'ok' snapshot is never empty (R9)
  return { state: 'ok', fetchedAt, comments };
}

// R9, from what yt-dlp reported for one video: `info` carries its `comments`
// and `comment_count` (the FTCOMMENTS print's object, or a reheat's dumped
// JSON). Measured on yt-dlp 2026.8.17 (plan Evidence, W2):
//   success           -> comments: [...], comment_count: comments.length
//   comments disabled -> BOTH keys absent (extract_comments returns them as
//                        None and the `.{}` selector / the dump drop None keys)
//   interrupted / an error swallowed under --ignore-errors
//                     -> comments: [...partial], comment_count: null
//   an error under our 'only_download' -> no print at all (and no info)
// So: a full, non-empty list replaces; both keys absent is 'disabled'; every
// other shape (partial, zero, malformed) keeps the stored snapshot (null).
function decideSnapshot(info, nowMs = Date.now()) {
  if (!info || typeof info !== 'object' || Array.isArray(info)) return null;
  const hasComments = Object.prototype.hasOwnProperty.call(info, 'comments') && info.comments !== null;
  const hasCount = Object.prototype.hasOwnProperty.call(info, 'comment_count') && info.comment_count !== null;
  const fetchedAt = new Date(nowMs).toISOString();
  if (!hasComments && !hasCount) return { state: 'disabled', fetchedAt, comments: [] };
  if (!Array.isArray(info.comments)) return null;
  if (typeof info.comment_count !== 'number' || !Number.isInteger(info.comment_count) || info.comment_count < info.comments.length) return null;
  const comments = sanitizeComments(info.comments, nowMs);
  if (comments.length === 0) return null;
  return { state: 'ok', fetchedAt, comments };
}

function statementsFor(adapter) {
  if (adapter.__sourceCommentStmts) return adapter.__sourceCommentStmts;
  const sql = adapter.sql;
  const s = {
    get: sql.prepare(`SELECT payload, fetched_at, state FROM ${TABLE} WHERE media_id = ?`),
    all: sql.prepare(`SELECT media_id, payload, fetched_at, state FROM ${TABLE} ORDER BY media_id`),
    upsert: sql.prepare(UPSERT_SQL),
    del: sql.prepare(`DELETE FROM ${TABLE} WHERE media_id = ?`),
    clear: sql.prepare(`DELETE FROM ${TABLE}`),
    countRows: sql.prepare(`SELECT COUNT(*) AS c FROM ${TABLE}`),
  };
  adapter.__sourceCommentStmts = s;
  return s;
}

function rowToSnapshot(row) {
  if (!row) return null;
  let comments = [];
  try { comments = JSON.parse(row.payload); } catch (_) { comments = null; }
  return sanitizeSnapshot({ state: row.state, fetchedAt: row.fetched_at, comments });
}

function rowParams(id, snap) {
  return [id, JSON.stringify(snap.comments), snap.fetchedAt, snap.state];
}

function createSourceCommentStore(adapter) {
  const st = () => statementsFor(adapter);
  const tx = (fn) => {
    if (adapter.inTransaction) return fn();
    adapter.begin();
    try {
      const out = fn();
      adapter.commit();
      return out;
    } catch (err) {
      adapter.rollback();
      throw err;
    }
  };

  return {
    // READ-tolerant: an id that could never have been persisted reads as null.
    get(id) {
      if (!isPersistableId(id)) return null;
      return rowToSnapshot(st().get.get(id));
    },

    // { [mediaId]: snapshot } - the backup bundle's shape. Own properties only.
    getAll() {
      const out = {};
      for (const row of st().all.all()) {
        const snap = rowToSnapshot(row);
        if (snap) Object.defineProperty(out, row.media_id, { value: snap, enumerable: true, writable: true, configurable: true });
      }
      return out;
    },

    size() {
      return st().countRows.get().c;
    },

    // The ONE writer (download consume, reheat). R9: `decided` is what
    // decideSnapshot returned - null keeps the stored row untouched. Returns
    // true when a row was written.
    apply(id, decided) {
      assertMediaId(id);
      const snap = sanitizeSnapshot(decided);
      if (!snap) return false;
      st().upsert.run(...rowParams(id, snap));
      return true;
    },

    // Wipe-and-replace from a { [mediaId]: snapshot } map (restore, seeding).
    // Validates every entry first (refuse-whole); inside the caller's
    // transaction when one is open.
    replaceAll(map) {
      const entries = [];
      if (map != null) {
        if (typeof map !== 'object' || Array.isArray(map)) throw new Error('sourceComments: replaceAll expects an object map');
        for (const id of Object.keys(map)) {
          assertMediaId(id);
          const snap = sanitizeSnapshot(map[id]);
          if (!snap) throw new Error(`sourceComments: the snapshot for ${JSON.stringify(id.slice(0, 64))} is not valid`);
          entries.push([id, snap]);
        }
      }
      tx(() => {
        st().clear.run();
        for (const [id, snap] of entries) st().upsert.run(...rowParams(id, snap));
      });
    },
  };
}

module.exports = {
  TABLE,
  UPSERT_SQL,
  MAX_COMMENTS,
  MAX_TEXT,
  MAX_AUTHOR,
  MAX_PAYLOAD_BYTES,
  sanitizeComment,
  sanitizeSnapshot,
  decideSnapshot,
  rowParams,
  createSourceCommentStore,
};
