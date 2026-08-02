'use strict';

// v1.69.0 (podcasts): the `db.podcasts` namespace owner - backfill, record
// shapes, subscription/episode reducers, and the backfill-selection policy.
// Mirrors lib/music/store.js's namespace discipline exactly: nothing in this
// file reads or writes any other namespace, and nothing outside the podcasts
// module writes `db.podcasts`.
//
// HARD INVARIANTS:
//  - `db.podcasts.subscriptions` NEVER stores a full feed URL. The secret
//    lives in the 0600 secrets file (lib/podcasts/secrets.js), OUTSIDE the
//    db and therefore structurally outside backup bundles. Records carry
//    only `feedUrlDisplay` (origin+pathname) + `feedHost`.
//  - `db.podcasts.episodes` is guid-derived-id keyed and doubles as the
//    download ARCHIVE: a record whose status is `tombstone` or
//    `deleted-on-disk` still blocks re-download forever (the ytdlp
//    "deleted stays gone" law) - deleting a sub's EPISODE RECORDS is the
//    only way to forget, and only sub deletion does that.
//  - Episode maps are built with null-prototype accumulators and read with
//    hasOwnProperty discipline (the repo's __proto__ row-key hazard).

const crypto = require('crypto');
const { validateFeedUrl } = require('./feedUrl');

const VALID_EPISODE_STATUSES = new Set([
  'pending', // known from the feed, queued for download
  'downloaded', // on disk, playable
  'failed', // last download attempt failed; retried on later polls
  'skipped', // excluded by the backfill policy at add time; never downloaded
  'deleted-on-disk', // file vanished while its root was mounted; not re-downloaded
  'trashed', // v1.70: user-deleted -> file moved to .filetube-trash, restorable
  'tombstone', // trash retention expired (or legacy delete); never re-downloaded
]);

const MAX_SUB_NAME_LENGTH = 200;
const MAX_STATUS_LENGTH = 300; // lastStatus cap, the ytdlp posture
const MAX_EPISODE_TITLE_STORE = 2048; // stored title cap (parser also caps)
const MAX_DESCRIPTION_STORE = 65536; // stored description cap
const MAX_BACKFILL_LATEST = 10000;

function ensurePodcasts(db) {
  if (!db.podcasts || typeof db.podcasts !== 'object' || Array.isArray(db.podcasts)) {
    db.podcasts = { subscriptions: [], episodes: {}, settings: {} };
    return db.podcasts;
  }
  const ns = db.podcasts;
  if (!Array.isArray(ns.subscriptions)) ns.subscriptions = [];
  if (!ns.episodes || typeof ns.episodes !== 'object' || Array.isArray(ns.episodes)) ns.episodes = {};
  if (!ns.settings || typeof ns.settings !== 'object' || Array.isArray(ns.settings)) ns.settings = {};
  return ns;
}

/** The non-mutating read view for GET routes (the readMusic invariant). */
function readPodcasts(db) {
  const ns = db && db.podcasts;
  if (!ns || typeof ns !== 'object' || Array.isArray(ns)) {
    return { subscriptions: [], episodes: {}, settings: {} };
  }
  return {
    subscriptions: Array.isArray(ns.subscriptions) ? ns.subscriptions : [],
    episodes: ns.episodes && typeof ns.episodes === 'object' && !Array.isArray(ns.episodes) ? ns.episodes : {},
    settings: ns.settings && typeof ns.settings === 'object' && !Array.isArray(ns.settings) ? ns.settings : {},
  };
}

/** Stable subscription id from the normalized full feed URL. */
function subscriptionIdFor(feedUrl) {
  return crypto.createHash('md5').update(`podcast\n${feedUrl}`, 'utf8').digest('hex');
}

/** Stable episode id - guid-scoped to its subscription, file-move-proof. */
function episodeIdFor(subId, guid) {
  return crypto.createHash('md5').update(`podcast-ep\n${subId}\n${guid}`, 'utf8').digest('hex');
}

/**
 * Validate the add-subscription input. Returns the validated feed URL parts
 * (the FULL url goes to the secrets store, never into the record) plus
 * normalized optional fields. Error messages are neutral - never echo input.
 * @param {{feedUrl?:*, name?:*, backfill?:*}} input
 */
function validateAddInput(input) {
  const body = input && typeof input === 'object' ? input : {};
  const feed = validateFeedUrl(body.feedUrl);
  if (!feed.ok) return { ok: false, error: feed.error };
  let name = '';
  if (body.name !== undefined && body.name !== null) {
    if (typeof body.name !== 'string') return { ok: false, error: 'name must be a string' };
    name = body.name.trim().slice(0, MAX_SUB_NAME_LENGTH);
  }
  const backfill = normalizeBackfill(body.backfill === undefined ? 'all' : body.backfill);
  if (backfill === null) return { ok: false, error: 'backfill must be "all", "new", or a positive episode count' };
  return { ok: true, feed, name, backfill };
}

/**
 * 'all' | 'new' | positive integer (latest N). Returns the normalized value
 * or null on invalid input.
 */
function normalizeBackfill(value) {
  if (value === 'all' || value === 'new') return value;
  const n = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (Number.isInteger(n) && n >= 1 && n <= MAX_BACKFILL_LATEST) return n;
  return null;
}

/**
 * Build a fresh subscription record. `id` and `nowMs` injected (determinism).
 */
function subscriptionRecordFrom({ id, feed, name, backfill, nowMs, order }) {
  return {
    id,
    name: name || '', // '' = adopt the feed's own <title> on first poll
    feedUrlDisplay: feed.display,
    feedHost: feed.host,
    addedAt: nowMs,
    order,
    paused: false,
    backfill,
    lastCheckedAt: null,
    lastStatus: 'pending first check',
    checkFailures: 0,
    backoffUntil: 0,
    author: '',
    description: '',
    showDirName: '', // adopted with the title on first poll; '' until then
    secretMissing: false, // true after a restore that lost the secrets file
  };
}

/**
 * Reducer: add a subscription. Idempotent by id - returns false (skip save)
 * when the id already exists, the updateDatabase no-op convention.
 */
function reduceAddSubscription(ns, record) {
  if (ns.subscriptions.some((s) => s && s.id === record.id)) return false;
  let maxOrder = 0;
  for (const s of ns.subscriptions) {
    if (s && Number.isFinite(s.order) && s.order > maxOrder) maxOrder = s.order;
  }
  ns.subscriptions.push({ ...record, order: maxOrder + 1 });
  return true;
}

/** Patch allowlist: name, paused, backfill. Everything else is poller-owned. */
function validatePatch(patch) {
  const body = patch && typeof patch === 'object' ? patch : {};
  const out = {};
  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || body.name.trim() === '') return { ok: false, error: 'name must be a non-empty string' };
    out.name = body.name.trim().slice(0, MAX_SUB_NAME_LENGTH);
  }
  if (body.paused !== undefined) {
    if (typeof body.paused !== 'boolean') return { ok: false, error: 'paused must be a boolean' };
    out.paused = body.paused;
  }
  if (body.backfill !== undefined) {
    const bf = normalizeBackfill(body.backfill);
    if (bf === null) return { ok: false, error: 'backfill must be "all", "new", or a positive episode count' };
    out.backfill = bf;
  }
  if (Object.keys(out).length === 0) return { ok: false, error: 'no editable fields in patch' };
  return { ok: true, patch: out };
}

function findSubscription(ns, id) {
  return ns.subscriptions.find((s) => s && s.id === id) || null;
}

/** Reducer: apply a validated patch. Returns false when the id is unknown. */
function reduceUpdateSubscription(ns, id, patch) {
  const sub = findSubscription(ns, id);
  if (!sub) return false;
  Object.assign(sub, patch);
  return true;
}

/**
 * Reducer: delete a subscription AND its episode records (the records are
 * the archive; sub deletion is the one deliberate "forget everything" verb).
 * Files on disk are NOT touched here (they are the user's cache; the route
 * owns that disclosure). Returns the removed episode ids (the per-user
 * carrier cleanup joins in the route) or false when unknown.
 */
function reduceDeleteSubscription(ns, id) {
  const idx = ns.subscriptions.findIndex((s) => s && s.id === id);
  if (idx === -1) return false;
  ns.subscriptions.splice(idx, 1);
  const removed = [];
  for (const epId of Object.keys(ns.episodes)) {
    if (!Object.prototype.hasOwnProperty.call(ns.episodes, epId)) continue;
    const ep = ns.episodes[epId];
    if (ep && ep.subId === id) {
      removed.push(epId);
      delete ns.episodes[epId];
    }
  }
  return removed;
}

/**
 * Reducer: poller status write (the setSubscriptionStatus posture: ONE
 * atomic mutation for status + backoff + adopted feed metadata).
 * `fields.lastStatus` MUST already be redacted + is length-capped here as
 * the second line of defense.
 */
function reduceSetSubscriptionStatus(ns, id, fields) {
  const sub = findSubscription(ns, id);
  if (!sub) return false;
  const f = fields && typeof fields === 'object' ? fields : {};
  if (f.lastCheckedAt !== undefined) sub.lastCheckedAt = f.lastCheckedAt;
  if (f.lastStatus !== undefined) sub.lastStatus = String(f.lastStatus).slice(0, MAX_STATUS_LENGTH);
  if (f.checkFailures !== undefined) sub.checkFailures = f.checkFailures;
  if (f.backoffUntil !== undefined) sub.backoffUntil = f.backoffUntil;
  if (f.secretMissing !== undefined) sub.secretMissing = f.secretMissing === true;
  // Feed-adopted metadata: only ever FILLS or refreshes; a user-renamed sub
  // (name already set by the user via PATCH) keeps its name.
  if (f.adoptedTitle && sub.name === '') sub.name = String(f.adoptedTitle).slice(0, MAX_SUB_NAME_LENGTH);
  if (f.adoptedShowDirName && sub.showDirName === '') sub.showDirName = String(f.adoptedShowDirName);
  if (f.author !== undefined) sub.author = String(f.author || '').slice(0, MAX_SUB_NAME_LENGTH);
  if (f.description !== undefined) sub.description = String(f.description || '').slice(0, MAX_DESCRIPTION_STORE);
  return true;
}

/**
 * PURE backfill policy: given the parsed feed items (assumed newest-first;
 * re-sorted here by pubDate to be safe) and the set of guids already known,
 * split the UNKNOWN items into { download, skip } per the policy.
 *  - 'all': every unknown item downloads.
 *  - 'new': on the FIRST poll (no guids known yet) every current item is
 *    skipped (recorded, never downloaded); afterwards unknown items download.
 *  - N: the newest N unknown items download, the rest skip. (Applied per
 *    poll against the current unknowns; after the first poll steady-state
 *    unknowns are just "new since last poll", which is what you want.)
 * @param {Array<{guid:string, pubDateMs:number}>} items parsed feed items
 * @param {Set<string>} knownGuids guids with ANY existing record
 * @param {'all'|'new'|number} backfill
 * @param {boolean} firstPoll no episode records exist for this sub yet
 */
function selectBackfill(items, knownGuids, backfill, firstPoll) {
  const unknown = (Array.isArray(items) ? items : [])
    .filter((it) => it && typeof it.guid === 'string' && it.guid !== '' && !knownGuids.has(it.guid))
    .slice()
    .sort((a, b) => (b.pubDateMs || 0) - (a.pubDateMs || 0));
  if (backfill === 'all') return { download: unknown, skip: [] };
  if (backfill === 'new') {
    return firstPoll ? { download: [], skip: unknown } : { download: unknown, skip: [] };
  }
  const n = Number.isInteger(backfill) && backfill >= 1 ? backfill : 0;
  return { download: unknown.slice(0, n), skip: unknown.slice(n) };
}

/**
 * Reducer: record a batch of feed items as episode records. Items whose
 * guid already has a record are UNTOUCHED (the archive law). New records
 * enter as 'pending' (to download) or 'skipped' (backfill-excluded).
 * Returns the ids created.
 */
function reduceUpsertEpisodes(ns, subId, items, status, nowMs) {
  if (status !== 'pending' && status !== 'skipped') throw new Error('reduceUpsertEpisodes: status must be pending|skipped');
  const created = [];
  for (const it of Array.isArray(items) ? items : []) {
    if (!it || typeof it.guid !== 'string' || it.guid === '') continue;
    const id = episodeIdFor(subId, it.guid);
    if (Object.prototype.hasOwnProperty.call(ns.episodes, id)) continue;
    ns.episodes[id] = {
      id,
      subId,
      guid: it.guid,
      title: String(it.title || '').slice(0, MAX_EPISODE_TITLE_STORE),
      description: String(it.description || '').slice(0, MAX_DESCRIPTION_STORE),
      link: typeof it.link === 'string' ? it.link.slice(0, 2048) : '',
      pubDateMs: Number.isFinite(it.pubDateMs) ? it.pubDateMs : null,
      durationSec: Number.isFinite(it.durationSec) ? it.durationSec : null,
      enclosureBytes: Number.isFinite(it.enclosureBytes) ? it.enclosureBytes : null,
      status,
      fileName: '',
      filePath: '',
      bytes: null,
      downloadedAt: null,
      firstSeenAt: nowMs,
      lastError: '',
    };
    created.push(id);
  }
  return created;
}

/** Reducer: an enclosure landed. */
function reduceEpisodeDownloaded(ns, id, { fileName, filePath, bytes, nowMs }) {
  const ep = Object.prototype.hasOwnProperty.call(ns.episodes, id) ? ns.episodes[id] : null;
  if (!ep) return false;
  ep.status = 'downloaded';
  ep.fileName = String(fileName || '');
  ep.filePath = String(filePath || '');
  ep.bytes = Number.isFinite(bytes) ? bytes : null;
  ep.downloadedAt = nowMs;
  ep.lastError = '';
  return true;
}

/** Reducer: a download attempt failed. `error` MUST be pre-redacted. */
function reduceEpisodeFailed(ns, id, error) {
  const ep = Object.prototype.hasOwnProperty.call(ns.episodes, id) ? ns.episodes[id] : null;
  if (!ep) return false;
  ep.status = 'failed';
  ep.lastError = String(error || '').slice(0, MAX_STATUS_LENGTH);
  return true;
}

/** Reducer: generic guarded status flip (deleted-on-disk, tombstone, retry). */
function reduceEpisodeStatus(ns, id, status) {
  if (!VALID_EPISODE_STATUSES.has(status)) return false;
  const ep = Object.prototype.hasOwnProperty.call(ns.episodes, id) ? ns.episodes[id] : null;
  if (!ep) return false;
  ep.status = status;
  if (status !== 'downloaded') {
    // A record leaving 'downloaded' no longer points at a real file.
    if (status === 'deleted-on-disk' || status === 'tombstone') {
      ep.filePath = '';
      // v1.70: a tombstoned record carries no trash pointer either (the
      // retention sweep tombstones AFTER unlinking the trash file).
      delete ep.trashPath;
      delete ep.trashedAt;
    }
  }
  return true;
}

/**
 * v1.70 D2: the recoverable-delete reducers. Trash is a STATE TRANSITION on
 * the record (the guid stays - the archive law holds through the whole
 * lifecycle): downloaded -> trashed keeps filePath (the restore
 * destination) and records where the bytes went; trashed -> downloaded
 * reverses it; retention expiry (the route layer's sweep) tombstones.
 */
function reduceEpisodeTrashed(ns, id, { trashPath, nowMs }) {
  const ep = Object.prototype.hasOwnProperty.call(ns.episodes, id) ? ns.episodes[id] : null;
  if (!ep || ep.status !== 'downloaded') return false;
  if (typeof trashPath !== 'string' || trashPath === '') return false;
  ep.status = 'trashed';
  ep.trashPath = trashPath;
  ep.trashedAt = nowMs;
  return true;
}

function reduceEpisodeRestored(ns, id) {
  const ep = Object.prototype.hasOwnProperty.call(ns.episodes, id) ? ns.episodes[id] : null;
  if (!ep || ep.status !== 'trashed') return false;
  ep.status = 'downloaded';
  delete ep.trashPath;
  delete ep.trashedAt;
  return true;
}

/**
 * PURE retention policy: trashed episodes whose trashedAt is older than
 * retentionDays. 0 (or anything non-positive/non-finite) = keep forever.
 */
function selectExpiredTrashedEpisodes(episodes, retentionDays, nowMs) {
  const days = Number(retentionDays);
  if (!Number.isFinite(days) || days <= 0) return [];
  const cutoff = nowMs - days * 24 * 60 * 60 * 1000;
  const expired = [];
  for (const id of Object.keys(episodes || {})) {
    if (!Object.prototype.hasOwnProperty.call(episodes, id)) continue;
    const ep = episodes[id];
    if (ep && ep.status === 'trashed' && Number.isFinite(ep.trashedAt) && ep.trashedAt <= cutoff) {
      expired.push(id);
    }
  }
  return expired;
}

/** All episode records for a sub, newest-first by pubDate. Read-safe. */
function episodesForSub(episodes, subId) {
  const out = [];
  for (const id of Object.keys(episodes || {})) {
    if (!Object.prototype.hasOwnProperty.call(episodes, id)) continue;
    const ep = episodes[id];
    if (ep && ep.subId === subId) out.push(ep);
  }
  out.sort((a, b) => (b.pubDateMs || 0) - (a.pubDateMs || 0));
  return out;
}

/**
 * Pure backoff policy for failed feed checks: 15 min doubling per
 * consecutive failure, capped at 6 h. 0 failures = no backoff.
 */
function computeFeedBackoff(checkFailures, nowMs) {
  const n = Number.isInteger(checkFailures) && checkFailures > 0 ? checkFailures : 0;
  if (n === 0) return 0;
  const base = 15 * 60 * 1000;
  const capped = Math.min(base * 2 ** (n - 1), 6 * 60 * 60 * 1000);
  return nowMs + capped;
}

function isInFeedBackoff(sub, nowMs) {
  return !!(sub && Number.isFinite(sub.backoffUntil) && sub.backoffUntil > nowMs);
}

module.exports = {
  ensurePodcasts,
  readPodcasts,
  subscriptionIdFor,
  episodeIdFor,
  validateAddInput,
  normalizeBackfill,
  subscriptionRecordFrom,
  reduceAddSubscription,
  validatePatch,
  findSubscription,
  reduceUpdateSubscription,
  reduceDeleteSubscription,
  reduceSetSubscriptionStatus,
  selectBackfill,
  reduceUpsertEpisodes,
  reduceEpisodeDownloaded,
  reduceEpisodeFailed,
  reduceEpisodeStatus,
  reduceEpisodeTrashed,
  reduceEpisodeRestored,
  selectExpiredTrashedEpisodes,
  episodesForSub,
  computeFeedBackoff,
  isInFeedBackoff,
  VALID_EPISODE_STATUSES,
  MAX_SUB_NAME_LENGTH,
  MAX_STATUS_LENGTH,
  MAX_BACKFILL_LATEST,
};
