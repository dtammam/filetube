'use strict';

// Persistence accessors for the optional yt-dlp subscription module. Every
// side effect here goes exclusively through the INJECTED `updateDatabase`/
// `loadDatabase` deps (the same v1.9.0 serialized-writer primitive server.js
// uses for everything else) -- this module never touches the filesystem or
// `db.json` directly, and never imports server.js. Because this module is
// only ever reached from routes registered inside `registerRoutes`'s
// `isEnabled` gate (see lib/ytdlp/index.js), an empty/default namespace is
// materialized ONLY when an enabled module writer actually runs one of these
// functions -- the disabled path never calls in here at all, so it stays
// byte-identical.

const DEFAULT_YTDLP_NAMESPACE = Object.freeze({ allowMembersOnly: false, subscriptions: [] });

const VALID_FORMATS = new Set(['audio', 'video']);
const DEFAULT_FORMAT = 'video';
const DEFAULT_QUALITY = 'best';

// Defensive backfill, applied MODULE-LOCALLY (inside this file's own
// mutators/readers) rather than in server.js's core `loadDatabase`. Mirrors
// the `folderSettings`/`settings` backfill pattern there (server.js:83-86):
// a missing/partial `db.ytdlp` is completed without ever clobbering fields
// that are already present, and no other top-level key is touched. This is
// what keeps core `loadDatabase`/`DEFAULT_SETTINGS` untouched and the
// disabled path byte-identical -- an old or disabled db.json simply never
// gains a `ytdlp` key because nothing here ever runs against it.
function ensureYtdlp(db) {
  if (!db.ytdlp || typeof db.ytdlp !== 'object') {
    // NOTE: build a fresh object/array here rather than `{ ...DEFAULT_YTDLP_NAMESPACE }`
    // -- a shallow spread of the frozen constant would copy the SAME
    // `subscriptions` array reference into every db that hits this branch
    // (Object.freeze is shallow), silently sharing subscriptions across
    // unrelated db instances. `DEFAULT_YTDLP_NAMESPACE` exists only as a
    // documented/exported shape constant, never as a literal to spread from.
    db.ytdlp = { allowMembersOnly: false, subscriptions: [] };
  } else {
    if (typeof db.ytdlp.allowMembersOnly !== 'boolean') db.ytdlp.allowMembersOnly = false;
    if (!Array.isArray(db.ytdlp.subscriptions)) db.ytdlp.subscriptions = [];
  }
  return db.ytdlp;
}

// Pure fallback display name derived from the channel URL, since no yt-dlp
// metadata exists yet at add-time in T2 (that arrives in T3/T4, which can
// enrich this with the real channel title). Prefers an `@handle` path
// segment (the common YouTube channel URL shape), else the last non-empty
// path segment, else the hostname, else a generic fallback -- never throws
// on a malformed input.
function deriveDisplayName(input) {
  if (typeof input !== 'string' || input.trim() === '') return 'Untitled channel';
  let url;
  try {
    url = new URL(input.trim());
  } catch {
    return input.trim();
  }
  const segments = url.pathname.split('/').filter(Boolean);
  const handle = segments.find((seg) => seg.startsWith('@'));
  if (handle) return handle;
  if (segments.length > 0) return segments[segments.length - 1];
  return url.hostname || 'Untitled channel';
}

// BASIC shape check only: non-empty string, http/https scheme, parseable as
// a URL. This is deliberately NOT the full validator -- lib/ytdlp/url.js's
// `validateChannelUrl` (T3) owns the YouTube-specific allowlist, metacharacter
// rejection, and normalization; T3 will upgrade the POST route to call it.
// Keeping this check minimal here avoids a merge collision between T2 and T3
// over the same validator surface.
function isBasicHttpUrl(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return false;
  try {
    const url = new URL(raw.trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

// Normalizes a channel URL for idempotent id derivation: trims whitespace and
// lowercases the host only (path/query casing can be meaningful to yt-dlp,
// so it is left as-is). Deterministic and simple by design -- the fuller
// normalization (trailing slashes, tracking params, etc.) belongs to T3.
function normalizeChannelUrl(raw) {
  const trimmed = raw.trim();
  try {
    const url = new URL(trimmed);
    url.hostname = url.hostname.toLowerCase();
    return url.toString();
  } catch {
    return trimmed;
  }
}

/**
 * Validate an add-subscription request body's BASIC shape. Returns
 * `{ ok: true, value: { channelUrl, format, quality } }` on success (with
 * `format`/`quality` defaulted) or `{ ok: false, error: string }` on failure.
 * Pure -- does not touch any deps.
 */
function validateSubscriptionInput(body) {
  const input = body && typeof body === 'object' ? body : {};
  if (!isBasicHttpUrl(input.channelUrl)) {
    return { ok: false, error: 'channelUrl must be a non-empty http(s) URL' };
  }
  const format = input.format === undefined ? DEFAULT_FORMAT : input.format;
  if (!VALID_FORMATS.has(format)) {
    return { ok: false, error: "format must be 'audio' or 'video'" };
  }
  const quality = typeof input.quality === 'string' && input.quality.trim() !== ''
    ? input.quality.trim()
    : DEFAULT_QUALITY;
  return {
    ok: true,
    value: {
      channelUrl: input.channelUrl.trim(),
      format,
      quality,
      name: typeof input.name === 'string' && input.name.trim() !== '' ? input.name.trim() : undefined,
    },
  };
}

// Reads the current subscription list. Read-only: backfills IN MEMORY (via
// ensureYtdlp on the freshly-loaded db) so a caller always sees a well-formed
// array, but never writes -- only `addSubscription`/`deleteSubscription`/
// `setSubscriptionStatus`/`setAllowMembersOnly` persist through
// `updateDatabase`.
function listSubscriptions(deps) {
  const db = deps.loadDatabase();
  return ensureYtdlp(db).subscriptions;
}

/**
 * Add a subscription. `{ channelUrl, format, quality, name }` is assumed
 * already-validated (callers should run `validateSubscriptionInput` first);
 * this function still defends against missing `format`/`quality` by
 * defaulting them, mirroring the record shape everywhere. Idempotent by id:
 * `id = getMediaId(normalizedChannelUrl)` (the same stable md5-of-path hash
 * server.js uses for media ids, reused for a stable hash-of-string). If a
 * subscription with that id already exists, no duplicate is created -- the
 * existing record is returned unchanged (add is a no-op re-add, not a
 * conflict error, since re-adding the same channel is a normal user action).
 */
function addSubscription(deps, { channelUrl, format, quality, name } = {}) {
  const normalized = normalizeChannelUrl(channelUrl);
  const id = deps.getMediaId(normalized);
  const resolvedFormat = VALID_FORMATS.has(format) ? format : DEFAULT_FORMAT;
  const resolvedQuality = typeof quality === 'string' && quality.trim() !== '' ? quality.trim() : DEFAULT_QUALITY;

  let record;
  return deps.updateDatabase((db) => {
    const ns = ensureYtdlp(db);
    const existing = ns.subscriptions.find((sub) => sub.id === id);
    if (existing) {
      record = existing;
      return false; // no-op re-add: nothing changed, skip the save
    }
    record = {
      id,
      channelUrl,
      name: name || deriveDisplayName(channelUrl),
      format: resolvedFormat,
      quality: resolvedQuality,
      addedAt: new Date().toISOString(),
      lastCheckedAt: null,
      lastStatus: null,
    };
    ns.subscriptions.push(record);
  }).then(() => record);
}

/**
 * Remove a subscription by id. Returns `true` if a subscription was removed,
 * `false` if no subscription with that id existed (so the route can 404).
 *
 * D3 nuance: this ONLY stops future polling of the subscription (it is
 * simply no longer in `db.ytdlp.subscriptions`). It never touches the
 * download-archive file -- that is a downloaded-media-file dedup concern
 * (T3/T4), entirely separate from subscription bookkeeping, and this
 * function has no knowledge of it.
 */
function deleteSubscription(deps, id) {
  let removed = false;
  return deps.updateDatabase((db) => {
    const ns = ensureYtdlp(db);
    const before = ns.subscriptions.length;
    ns.subscriptions = ns.subscriptions.filter((sub) => sub.id !== id);
    removed = ns.subscriptions.length < before;
    if (!removed) return false; // unknown id: nothing changed, skip the save
  }).then(() => removed);
}

/**
 * Update a subscription's poll-status fields (used by T4's poll loop).
 * Returns `true` if the subscription was found and updated, `false`
 * otherwise. Only `lastCheckedAt`/`lastStatus` are touched.
 */
function setSubscriptionStatus(deps, id, { lastCheckedAt, lastStatus } = {}) {
  let updated = false;
  return deps.updateDatabase((db) => {
    const ns = ensureYtdlp(db);
    const sub = ns.subscriptions.find((s) => s.id === id);
    if (!sub) return false;
    sub.lastCheckedAt = lastCheckedAt !== undefined ? lastCheckedAt : sub.lastCheckedAt;
    sub.lastStatus = lastStatus !== undefined ? lastStatus : sub.lastStatus;
    updated = true;
  }).then(() => updated);
}

// Reads the persisted members-only toggle (default false). Read-only, same
// in-memory-backfill pattern as listSubscriptions.
function getAllowMembersOnly(deps) {
  const db = deps.loadDatabase();
  return ensureYtdlp(db).allowMembersOnly;
}

// Persists the members-only toggle. `value` is coerced to a strict boolean
// by the caller (the route validates it is a boolean before calling this).
function setAllowMembersOnly(deps, value) {
  const bool = value === true;
  return deps.updateDatabase((db) => {
    const ns = ensureYtdlp(db);
    ns.allowMembersOnly = bool;
  }).then(() => bool);
}

module.exports = {
  ensureYtdlp,
  deriveDisplayName,
  isBasicHttpUrl,
  normalizeChannelUrl,
  validateSubscriptionInput,
  listSubscriptions,
  addSubscription,
  deleteSubscription,
  setSubscriptionStatus,
  getAllowMembersOnly,
  setAllowMembersOnly,
  DEFAULT_YTDLP_NAMESPACE,
  VALID_FORMATS,
  DEFAULT_FORMAT,
  DEFAULT_QUALITY,
};
