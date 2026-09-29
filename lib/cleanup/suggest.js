'use strict';

// lib/cleanup/suggest.js - the pure rules behind GET /api/cleanup/suggestions.
// No I/O, no require('../server'): the route hands in already-read state. READ-ONLY by
// construction: this module only ever answers "what could be cleared"; the delete itself is
// the existing DELETE /api/videos/:id (Trash), one explicit id at a time, from the client.
//
// The safety posture (Dean: "I cannot lose data"): a suggestion is a SHORTLIST, never a verdict.
// An item is PROTECTED (never listed, in any group) when anyone liked it, when anyone has it
// part-watched, or when it has no usable size/id. "Never opened" means NO user has a progress
// row or a completion mark AND its play counter is 0 - one user's opinion never nominates a
// file another user is still using.

const path = require('path');

const DAY_MS = 86400000;
const DEFAULT_DAYS = 30;
const MIN_DAYS = 1;
const MAX_DAYS = 3650;
const LARGEST_LIMIT = 20;
const WATCHED_PCT = 90; // lib/videoQuery WATCHED_PCT - the History page's "finished"
const WATCHING_MIN_PCT = 0.5; // lib/videoQuery WATCHING_MIN_PCT - above this is "in progress"
const DURATION_TOLERANCE_S = 1;

function normalizeDays(raw) {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return DEFAULT_DAYS;
  return Math.min(MAX_DAYS, Math.max(MIN_DAYS, n));
}

function num(v) { return typeof v === 'number' && Number.isFinite(v) ? v : 0; }
function text(v) { return typeof v === 'string' && v.trim() !== ''; }
function iso(ms) { return ms > 0 ? new Date(ms).toISOString() : null; }
function has(obj, key) { return !!obj && Object.prototype.hasOwnProperty.call(obj, key); }

function progressPct(row) {
  const dur = num(row && row.duration);
  return dur > 0 ? (num(row.timestamp) / dur) * 100 : 0;
}

// `users` is [{ userId, progress: {id: {timestamp,duration,updatedAt}}, watched: {id: completedAtIso},
// liked: Set|Array }] for EVERY account. `viewerId` picks the one whose "watched" list is offered.
function computeSuggestions(input) {
  const opts = input || {};
  const days = normalizeDays(opts.days);
  const nowMs = num(opts.nowMs) || Date.now();
  const cutoffMs = nowMs - days * DAY_MS;
  const metadata = opts.metadata && typeof opts.metadata === 'object' ? opts.metadata : {};
  const isVisible = typeof opts.isVisible === 'function' ? opts.isVisible : () => true;
  const isSubscriptionItem = typeof opts.isSubscriptionItem === 'function' ? opts.isSubscriptionItem : () => false;
  const extractVideoId = typeof opts.extractVideoId === 'function' ? opts.extractVideoId : () => null;
  const viewCounts = opts.viewCounts && typeof opts.viewCounts === 'object' ? opts.viewCounts : {};
  const users = Array.isArray(opts.users) ? opts.users : [];
  const viewer = users.find((u) => u && u.userId === opts.viewerId) || { progress: {}, watched: {}, liked: [] };

  // Per-id facts across every account.
  const liked = new Set();
  const touched = new Set(); // any user has a progress row or completion mark
  const inProgress = new Set(); // any user has it part-watched
  for (const u of users) {
    if (!u) continue;
    for (const id of (u.liked instanceof Set ? [...u.liked] : Array.isArray(u.liked) ? u.liked : [])) liked.add(id);
    const prog = u.progress || {};
    const done = u.watched || {};
    for (const id of Object.keys(prog)) {
      touched.add(id);
      const pct = progressPct(prog[id]);
      if (pct > WATCHING_MIN_PCT && pct < WATCHED_PCT && !has(done, id)) inProgress.add(id);
    }
    for (const id of Object.keys(done)) touched.add(id);
  }

  const items = Object.keys(metadata)
    .map((id) => metadata[id])
    .filter((item) => item && text(item.id) && has(metadata, item.id) && metadata[item.id] === item);

  const neverOpened = (item) => num(viewCounts[item.id]) <= 0 && !touched.has(item.id);
  const protectedItem = (item) => liked.has(item.id) || inProgress.has(item.id) || !(num(item.size) > 0);
  const taken = new Set();
  const shape = (item, reason, extra) => Object.assign({
    id: item.id,
    title: text(item.title) ? item.title : (text(item.filePath) ? path.basename(item.filePath) : item.id),
    size: num(item.size),
    reason,
    addedAt: iso(num(item.addedAt)),
  }, extra || {});
  const bySizeDesc = (a, b) => b.size - a.size || (a.id < b.id ? -1 : 1);

  // (a) finished by THIS user, at least `days` ago. A completion with no timestamp is skipped:
  // an unknown age is never treated as old.
  const watched = [];
  for (const item of items) {
    if (!isVisible(item) || protectedItem(item)) continue;
    const row = has(viewer.progress, item.id) ? viewer.progress[item.id] : null;
    const doneAt = has(viewer.watched, item.id) ? Date.parse(viewer.watched[item.id]) : NaN;
    const finished = has(viewer.watched, item.id) || (row && progressPct(row) >= WATCHED_PCT);
    if (!finished) continue;
    const rowAt = row && text(row.updatedAt) ? Date.parse(row.updatedAt) : NaN;
    const lastMs = Math.max(Number.isFinite(doneAt) ? doneAt : 0, Number.isFinite(rowAt) ? rowAt : 0);
    if (!(lastMs > 0) || lastMs > cutoffMs) continue;
    watched.push(shape(item, 'Watched to the end', { lastPlayedAt: iso(lastMs) }));
    taken.add(item.id);
  }
  watched.sort(bySizeDesc);

  // (b) subscription downloads added `days` ago or more that nobody opened.
  const staleSubscriptions = [];
  for (const item of items) {
    if (taken.has(item.id) || !isVisible(item) || protectedItem(item)) continue;
    if (!isSubscriptionItem(item) || !neverOpened(item)) continue;
    const addedMs = num(item.addedAt);
    if (!(addedMs > 0) || addedMs > cutoffMs) continue;
    staleSubscriptions.push(shape(item, 'Subscription download nobody opened'));
    taken.add(item.id);
  }
  staleSubscriptions.sort(bySizeDesc);

  // (d) duplicates. Grouped over the WHOLE library (so the copy we keep really exists), listed only
  // when visible + unprotected. The OLDEST copy is kept: never listed. Source id first; else the same
  // size with durations within a second.
  const duplicates = [];
  const dupGroups = [];
  const bySource = new Map();
  const unkeyed = [];
  for (const item of items) {
    if (!text(item.filePath)) continue;
    const stem = path.basename(item.filePath, path.extname(item.filePath));
    const key = extractVideoId(stem)
      || (text(item.youtubeId) ? item.youtubeId : null)
      || (text(item.sourceExtractor) && text(item.sourceId) ? `${item.sourceExtractor.trim()}:${item.sourceId}` : null);
    if (key) {
      if (!bySource.has(key)) bySource.set(key, []);
      bySource.get(key).push(item);
    } else if (num(item.size) > 0 && num(item.duration) > 0) {
      unkeyed.push(item);
    }
  }
  for (const group of bySource.values()) if (group.length >= 2) dupGroups.push(group);
  const bySize = new Map();
  for (const item of unkeyed) {
    const k = num(item.size);
    if (!bySize.has(k)) bySize.set(k, []);
    bySize.get(k).push(item);
  }
  for (const same of bySize.values()) {
    if (same.length < 2) continue;
    same.sort((a, b) => num(a.duration) - num(b.duration));
    let cluster = [same[0]];
    for (let i = 1; i < same.length; i += 1) {
      if (num(same[i].duration) - num(cluster[cluster.length - 1].duration) <= DURATION_TOLERANCE_S) cluster.push(same[i]);
      else { if (cluster.length >= 2) dupGroups.push(cluster); cluster = [same[i]]; }
    }
    if (cluster.length >= 2) dupGroups.push(cluster);
  }
  const olderFirst = (a, b) => (num(a.addedAt) - num(b.addedAt)) || (String(a.id) < String(b.id) ? -1 : 1);
  for (const group of dupGroups) {
    const ordered = group.slice().sort(olderFirst);
    const keep = ordered[0];
    for (const item of ordered.slice(1)) {
      if (taken.has(item.id) || !isVisible(item) || protectedItem(item)) continue;
      duplicates.push(shape(item, 'A newer copy of a video you already have', {
        keepId: keep.id,
        keepTitle: text(keep.title) ? keep.title : path.basename(keep.filePath || ''),
      }));
      taken.add(item.id);
    }
  }
  duplicates.sort(bySizeDesc);

  // (c) the biggest never-opened files, added `days` ago or more.
  const largest = items
    .filter((item) => !taken.has(item.id) && isVisible(item) && !protectedItem(item) && neverOpened(item)
      && num(item.addedAt) > 0 && num(item.addedAt) <= cutoffMs)
    .map((item) => shape(item, 'Big file nobody opened'))
    .sort(bySizeDesc)
    .slice(0, LARGEST_LIMIT);

  return { days, watched, stale_subscriptions: staleSubscriptions, largest, duplicates };
}

module.exports = { computeSuggestions, normalizeDays, DEFAULT_DAYS, MIN_DAYS, MAX_DAYS, LARGEST_LIMIT };
