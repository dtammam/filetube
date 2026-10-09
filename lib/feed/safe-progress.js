'use strict';

// lib/feed/safe-progress.js - v1.379.0 Feed mode, plan D5 (the data-loss rule):
// the feed only ever moves a reading place or a resume point FORWARD, never back,
// and never when the stored position changed after the card was served (another
// device read or listened on). Pure decisions, no I/O: the routes in
// lib/feed/routes.js feed them the stored record and the requested move, and
// refuse with the reason this module names. Every refusal leaves storage untouched.
//
// Why pure: LESSONS 2 ("a pure decision function binds the rule, not the wiring
// that calls it") - the rule is tested here per input, and the integration tests
// in test/integration/feed-progress.test.js drive the real routes so the wiring
// is bound too.

const REASONS = Object.freeze({
  OK: 'ok',
  STALE: 'stale', // the stored position moved since the card was served (another device)
  UNKNOWN_SERVED: 'not-served', // no card for this item was served to this user in this process
  BACKWARD: 'backward', // the move would not advance the position
  UNRESOLVED: 'unresolved', // the stored position has no coordinates the feed can compare
  INVALID: 'invalid', // the requested position is not a position
  TOO_EARLY: 'too-early', // a FRESH card (an item the viewer had not started) has not played for the minute that makes it started
});

// v1.380.0 (R5, D7): a fresh video / episode only counts as started after about a minute of actual playback.
const FRESH_START_SEC = 60;
// A clip shorter than a minute and a quarter can never reach 60 s of playing: it needs 80% of its own length instead
// (gate r1, adversary W3), never more than FRESH_START_SEC. Unknown / non-positive duration = the full minute.
function freshNeedSec(durationSec) {
  const d = Number(durationSec);
  return Number.isFinite(d) && d > 0 ? Math.min(FRESH_START_SEC, Math.max(1, d * 0.8)) : FRESH_START_SEC;
}

function isPos(v) {
  return !!v && Number.isInteger(v.spineIndex) && v.spineIndex >= 0 && Number.isInteger(v.blockIndex) && v.blockIndex >= 0;
}

/**
 * Order two book positions: -1 when a is before b, 1 when after, 0 when equal.
 * A position is { spineIndex, blockIndex }. Spine order first, block order within.
 */
function compareBookPosition(a, b) {
  if (a.spineIndex !== b.spineIndex) return a.spineIndex < b.spineIndex ? -1 : 1;
  if (a.blockIndex !== b.blockIndex) return a.blockIndex < b.blockIndex ? -1 : 1;
  return 0;
}

/**
 * The book rule. `stored` is the resolved coordinates of the saved place
 * ({spineIndex, blockIndex}) or null for an unstarted book; `next` is where the
 * feed wants to move. `served` is the served-registry verdict for this item
 * ('ok' | 'stale' | 'unknown', lib/feed/served.js).
 * @returns {{ ok: boolean, reason: string }}
 */
function decideBookMove({ stored, next, served, storedExists }) {
  if (!isPos(next)) return { ok: false, reason: REASONS.INVALID };
  if (served === 'stale') return { ok: false, reason: REASONS.STALE };
  if (served !== 'ok') return { ok: false, reason: REASONS.UNKNOWN_SERVED };
  if (storedExists && !isPos(stored)) return { ok: false, reason: REASONS.UNRESOLVED };
  if (storedExists && compareBookPosition(next, stored) <= 0) return { ok: false, reason: REASONS.BACKWARD };
  return { ok: true, reason: REASONS.OK };
}

/**
 * The time-position rule (podcast episodes and media): `storedSec` is the saved
 * position in seconds (0 or null when none), `nextSec` the ping's position.
 * Forward means STRICTLY later; an equal position is a no-op refusal (nothing to
 * save, nothing lost).
 */
function decideTimeMove({ storedSec, nextSec, served, fresh = false, playedSec = 0, durationSec = 0 }) {
  if (typeof nextSec !== 'number' || !Number.isFinite(nextSec) || nextSec < 0) return { ok: false, reason: REASONS.INVALID };
  if (served === 'stale') return { ok: false, reason: REASONS.STALE };
  if (served !== 'ok') return { ok: false, reason: REASONS.UNKNOWN_SERVED };
  // The one-minute rule: a fresh card writes NOTHING (no position, no watched / played latch, no Watch later removal -
  // those all ride this write) until the player reports a minute of actual playback. The client's player holds the same
  // line (public/js/player.js saveProgressToServer); this is the server's own, for a client that does not.
  if (fresh === true && !(typeof playedSec === 'number' && Number.isFinite(playedSec) && playedSec >= freshNeedSec(durationSec))) return { ok: false, reason: REASONS.TOO_EARLY };
  const cur = typeof storedSec === 'number' && Number.isFinite(storedSec) && storedSec > 0 ? storedSec : 0;
  if (nextSec <= cur) return { ok: false, reason: REASONS.BACKWARD };
  return { ok: true, reason: REASONS.OK };
}

// The HTTP status a refusal maps to: a refusal is a CONFLICT with the stored
// state (409), except a malformed request (400).
function statusForReason(reason) {
  return reason === REASONS.INVALID ? 400 : 409;
}

module.exports = {
  REASONS,
  FRESH_START_SEC,
  freshNeedSec,
  compareBookPosition,
  decideBookMove,
  decideTimeMove,
  statusForReason,
};
