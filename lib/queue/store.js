'use strict';

// v1.63 playback queue - the PURE reducers (the booksStore.reduce* posture:
// routes run these against the user's current state and persist the output
// via userStore.setQueue; all queue semantics live here and only here).
//
// Shape: { entries: [{uid, mediaId, kind}], pointerUid: string|null }.
// kind (v1.71): 'media' | 'podcast'. A podcast entry's mediaId holds a
// podcast EPISODE id - md5 hex exactly like a media id, so the kind is
// CARRIED on the entry, never inferred (the v1.69 id-space lesson). The
// reducers are otherwise kind-agnostic: entries pass through filter/slice
// untouched, so only reduceAdd (which MINTS entries) names it.
// The pointer is the NOW-PLAYING entry (YouTube's model, Dean's ruling 6):
// entries before it stay visible-but-played (jump-back allowed), the head
// to play next is the entry AFTER the pointer; a null pointer means the
// queue has not started - the head is the first entry. A DANGLING pointer
// (its entry removed, e.g. by the media-delete carrier) normalizes to null
// pointer semantics at the boundary where it is detected.

const crypto = require('node:crypto');

const QUEUE_CAP = 200; // sanity cap, way above real use; adds beyond it are refused loudly

function normalize(state) {
  const entries = (Array.isArray(state && state.entries) ? state.entries : [])
    .filter((e) => e && typeof e.uid === 'string' && e.uid && typeof e.mediaId === 'string' && e.mediaId);
  let pointerUid = (state && typeof state.pointerUid === 'string' && state.pointerUid) || null;
  if (pointerUid && !entries.some((e) => e.uid === pointerUid)) pointerUid = null; // dangling -> not-started semantics
  return { entries, pointerUid };
}

function pointerIndex(state) {
  const s = normalize(state);
  if (!s.pointerUid) return -1;
  return s.entries.findIndex((e) => e.uid === s.pointerUid);
}

// The entry playback should advance INTO (null = queue exhausted).
function nextEntry(state) {
  const s = normalize(state);
  const idx = pointerIndex(s);
  return s.entries[idx + 1] || null;
}

// The entry BEFORE the pointer (for queue-aware Prev; null = none).
function prevEntry(state) {
  const s = normalize(state);
  const idx = pointerIndex(s);
  return idx > 0 ? s.entries[idx - 1] : null;
}

function reduceAdd(state, mediaId, position, kind) {
  const s = normalize(state);
  if (typeof mediaId !== 'string' || !mediaId) return { state: s, changed: false, error: 'bad-media' };
  if (s.entries.length >= QUEUE_CAP) return { state: s, changed: false, error: 'queue-full' };
  const entry = { uid: crypto.randomUUID(), mediaId, kind: kind === 'podcast' ? 'podcast' : 'media' };
  const entries = s.entries.slice();
  if (position === 'next') {
    // "Play next" = directly after the now-playing entry (or at the very
    // front when the queue has not started).
    entries.splice(pointerIndex(s) + 1, 0, entry);
  } else {
    entries.push(entry);
  }
  return { state: { entries, pointerUid: s.pointerUid }, changed: true, added: entry };
}

function reduceRemove(state, uid) {
  const s = normalize(state);
  const entries = s.entries.filter((e) => e.uid !== uid);
  if (entries.length === s.entries.length) return { state: s, changed: false };
  // Removing the now-playing entry moves the pointer to the PREVIOUS entry
  // (so "next" still lands on the removed entry's successor), or null at
  // the front - never forward, which would silently skip an unplayed item.
  let pointerUid = s.pointerUid;
  if (pointerUid === uid) {
    const oldIdx = s.entries.findIndex((e) => e.uid === uid);
    pointerUid = oldIdx > 0 ? s.entries[oldIdx - 1].uid : null;
    if (pointerUid && !entries.some((e) => e.uid === pointerUid)) pointerUid = null;
  }
  return { state: normalize({ entries, pointerUid }), changed: true };
}

// v1.65 gate (QA W1): the client only ever SEES entries whose media is live
// (shapedQueue hides trashed/dead ids), but reduceReorder demands the full
// raw uid multiset -- so after trashing a queued item every reorder tap
// 409'd for the whole retention window, with no user-discoverable
// workaround. Pure: lift a proposed order over the VISIBLE subset back to a
// full-multiset order, pinning each hidden entry at its current absolute
// index (least surprising: an invisible row never appears to move). The
// reducer's strictness is untouched -- a genuinely stale client still fails
// its bijection check downstream.
function expandVisibleOrder(state, visibleUids, orderedUids) {
  const s = normalize(state);
  if (!Array.isArray(visibleUids) || !Array.isArray(orderedUids)) return orderedUids;
  const hidden = new Set(s.entries.map((e) => e.uid).filter((u) => !visibleUids.includes(u)));
  if (hidden.size === 0) return orderedUids;
  const queued = orderedUids.slice();
  const out = [];
  for (const e of s.entries) {
    if (hidden.has(e.uid)) out.push(e.uid);
    else if (queued.length > 0) out.push(queued.shift());
  }
  // Anything the client sent beyond the visible slots (a stale/invented uid)
  // rides along so the reducer can refuse it, never silently dropped.
  return out.concat(queued);
}

function reduceReorder(state, orderedUids) {
  const s = normalize(state);
  if (!Array.isArray(orderedUids)) return { state: s, changed: false, error: 'bad-order' };
  // STRICT bijection (the ledger-check posture): the new order must be
  // exactly the current uid multiset - a stale client that drops or
  // invents an entry is refused, never "helpfully" merged.
  const current = s.entries.map((e) => e.uid).sort();
  const proposed = orderedUids.slice().sort();
  if (current.length !== proposed.length || current.some((u, i) => u !== proposed[i])) {
    return { state: s, changed: false, error: 'order-mismatch' };
  }
  const byUid = new Map(s.entries.map((e) => [e.uid, e]));
  const entries = orderedUids.map((u) => byUid.get(u));
  return { state: { entries, pointerUid: s.pointerUid }, changed: true };
}

function reduceSetPointer(state, uid) {
  const s = normalize(state);
  if (uid === null) return { state: { entries: s.entries, pointerUid: null }, changed: true };
  if (!s.entries.some((e) => e.uid === uid)) return { state: s, changed: false, error: 'no-such-entry' };
  return { state: { entries: s.entries, pointerUid: uid }, changed: true };
}

function reduceClear() {
  return { state: { entries: [], pointerUid: null }, changed: true };
}

module.exports = {
  expandVisibleOrder,
  QUEUE_CAP,
  normalize,
  pointerIndex,
  nextEntry,
  prevEntry,
  reduceAdd,
  reduceRemove,
  reduceReorder,
  reduceSetPointer,
  reduceClear,
};
