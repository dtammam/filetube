'use strict';

// v1.47.4 item 7 (Dean: "If any downloads fail I'd like it to be explicitly
// logged and have the error so one can look in posterity. It should be able to
// be cleared/deleted as well."): a durable, capped, per-FAILURE log at
// `<dataDir>/ytdlp-failures.jsonl` -- one JSON object per failed download item.
//
// WHY THIS IS A SEPARATE STORE FROM `runlog.js` (the design fork, recorded
// because it is the non-obvious call here):
//
//   1. RETENTION. The run log is capped at 500 RUNS. A busy subscription poll
//      cycle churns through that cap quickly, so a failure recorded there is
//      evicted by unrelated LATER SUCCESSES. Dean asked to look at failures "in
//      posterity" -- a record that a healthy week silently deletes does not
//      meet that. Failures get their own cap, spent only on failures.
//   2. DELETE SEMANTICS. The run log's entries are RUNS; a failure is a
//      sub-item of a run's `failures[]`. Per-entry delete against that shape
//      means rewriting historical run rows in place -- mutating the run history
//      as a side effect of tidying a failure list. A failure-per-line file
//      makes delete a clean whole-line removal that cannot corrupt run history.
//   3. IDENTITY. Delete needs a stable per-failure id. Run entries have no such
//      thing, and synthesizing one from (run ts + array index) breaks the
//      moment the run log rolls.
//
// It is a separate FILE, not a separate mechanism: the atomic-write posture
// (temp file in the SAME directory -> fsync -> rename), the defensive
// line-by-line read, the exact on-disk cap, and the never-throw/degrade
// contract are all deliberately identical to `runlog.js`. Read that module's
// header for the full rationale behind each; the reasoning is not duplicated
// here, only the posture.
//
// SIDE-EFFECT-FREE IMPORT: requiring this file touches no filesystem and
// registers no routes/timers. The file on disk is created lazily, on the FIRST
// `recordFailures` call only; every read against a missing file returns `[]`
// and never creates it -- the disabled-yt-dlp-module no-op guarantee (R0.7).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FAILLOG_FILENAME = 'ytdlp-failures.jsonl';

// Hard cap on persisted failure entries. Larger than the run log's 500 because
// these are the records Dean explicitly wants to keep around, and one line here
// is far smaller than a run row. Exported so tests/routes assert against the
// real value rather than a hardcoded duplicate.
const YTDLP_FAILLOG_MAX_ENTRIES = 1000;

// Bound on every persisted string field. `failures.js` already sanitizes and
// caps the reason text it produces, but this module is also reachable with
// caller-built entries, so it re-bounds at ITS OWN boundary rather than
// trusting upstream -- the same revalidate-at-every-boundary posture
// `args.js`'s `resolvePlayerClient` established.
const MAX_FIELD_LENGTH = 500;

// Mirrors `runlog.js`'s `runlogTmpSeq`: a monotonic per-process counter
// combined with the pid guarantees a unique same-directory temp filename per
// write, so two in-flight writes can never collide on the same temp path.
let faillogTmpSeq = 0;

function resolveFaillogPath(dataDir) {
  return path.join(dataDir, FAILLOG_FILENAME);
}

/**
 * Strip ASCII control characters (C0 + DEL) and cap length. yt-dlp's stderr is
 * untrusted text that can in principle embed terminal escapes, and these
 * strings are both persisted AND rendered. Callers still render via
 * `textContent`, never `innerHTML` -- this is defense in depth at the source,
 * mirroring `failures.js`'s `sanitizeReason` exactly.
 */
function sanitizeField(raw) {
  if (typeof raw !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  const stripped = raw.replace(/[\x00-\x1f\x7f]/g, '').trim();
  return stripped.length > MAX_FIELD_LENGTH ? stripped.slice(0, MAX_FIELD_LENGTH) : stripped;
}

/**
 * Read and defensively parse every line, in on-disk (oldest-first) order. A
 * missing file, a permission error, a malformed/partial line, or a line that
 * parses to a non-object are all skipped rather than thrown on -- and a read
 * never CREATES the file.
 *
 * Entries without a usable `id` are dropped rather than surfaced: an entry that
 * cannot be addressed cannot be deleted, so surfacing one would put a
 * permanently-undeletable row in a list whose whole point is being clearable.
 *
 * PURGE-ON-WRITE (v1.47.4 gate SUGGESTION, adversarial seat -- documenting a
 * real consequence rather than changing it): because every write path rebuilds
 * the file from THIS function's output, an id-less line is not merely hidden
 * from readers, it is ERASED from disk by the next `recordFailures`/
 * `deleteFailure`/`clearFailures`. That is the intended outcome (such a line is
 * unaddressable and un-actionable, so keeping it forever serves nobody), but it
 * is destructive and was previously undocumented, which is not acceptable for a
 * store whose contract is "kept for posterity".
 */
function readAllEntries(dataDir) {
  if (typeof dataDir !== 'string' || dataDir === '') return [];
  let raw;
  try {
    raw = fs.readFileSync(resolveFaillogPath(dataDir), 'utf8');
  } catch (_) {
    return [];
  }
  const entries = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch (_) {
      continue; // malformed/partial line -- skip, never throw
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
    if (typeof parsed.id !== 'string' || parsed.id === '') continue;
    entries.push(parsed);
  }
  return entries;
}

/**
 * The one atomic writer. Temp file in the SAME directory (so `renameSync` is an
 * atomic metadata-only operation on POSIX filesystems), fsync'd before the
 * rename gate, so a crash leaves either the OLD file fully intact or the NEW
 * one fully intact -- never a torn file.
 *
 * Never throws: a failure-log write problem must never break the caller's own
 * download/terminal-status handling. A lost diagnostics line is a diagnostics
 * regression, not a data-integrity one (RELIABILITY.md).
 *
 * @returns {boolean} whether the write actually landed (callers that report a
 *   count to the user need to know, rather than claiming a silent success)
 */
function writeAllEntries(dataDir, entries) {
  const filePath = resolveFaillogPath(dataDir);
  const tmp = `${filePath}.${process.pid}.${faillogTmpSeq++}.tmp`;
  try {
    const bounded = entries.slice(-YTDLP_FAILLOG_MAX_ENTRIES);
    const json = bounded.map((e) => JSON.stringify(e)).join('\n') + (bounded.length ? '\n' : '');
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeFileSync(fd, json, 'utf8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    // A rename-based atomic write REPLACES the inode, so the new file would
    // otherwise carry the temp file's default mode (0644) rather than the
    // log's. An operator who chmod'd this log to 0600 for privacy would have
    // it silently widened by the next write -- so the previous mode is carried
    // across explicitly. Best-effort by design: a stat/chmod failure must not
    // cost us the write itself, which is the thing that actually matters.
    try {
      const prevMode = fs.statSync(filePath).mode & 0o777;
      fs.chmodSync(tmp, prevMode);
    } catch (_) {
      // No existing file (first write), or an unreadable/unchmod-able one --
      // fall through and let the new file take the default mode.
    }
    fs.renameSync(tmp, filePath);
    return true;
  } catch (err) {
    console.error('Error writing yt-dlp failure-log:', err);
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch (cleanupErr) {
      console.error('Error cleaning up temp failure-log file:', cleanupErr);
    }
    return false;
  }
}

/**
 * Normalize one caller-supplied failure into the persisted shape, minting its
 * id. `source` is constrained to a known set so a typo'd/hostile value can
 * never become an unfilterable category in the UI.
 *
 * `crypto.randomUUID()` rather than a timestamp-derived id: two failures in the
 * same batch share a millisecond, and an id collision would make one row delete
 * the other.
 */
function normalizeEntry(raw, nowMs) {
  const source = raw && raw.source === 'subscription' ? 'subscription' : 'one-off';
  const ts = Number.isFinite(nowMs) ? nowMs : Date.now();
  return {
    id: crypto.randomUUID(),
    ts: new Date(ts).toISOString(),
    source,
    videoId: sanitizeField(raw && raw.videoId),
    title: sanitizeField(raw && raw.title),
    url: sanitizeField(raw && raw.url),
    // The whole point of the feature: the VERBATIM yt-dlp error, not a
    // templated summary. A missing reason is recorded honestly as unknown
    // rather than dropped, so the row still shows the failure happened.
    reason: sanitizeField(raw && raw.reason) || 'Unknown error (no reason reported by yt-dlp)',
    // v1.47.4 item 1 (L3): true when the media DID land after the
    // subtitle-stripped retry, so the row reads "downloaded without captions"
    // rather than implying the whole download was lost.
    ...(raw && raw.subtitleFallback === true ? { subtitleFallback: true } : {}),
  };
}

/**
 * Append `failures` (an array of caller-built failure descriptors), keeping the
 * file capped at `YTDLP_FAILLOG_MAX_ENTRIES` (oldest fall off the front).
 * A non-array, empty array, or bad `dataDir` is a silent no-op -- never throws.
 *
 * @returns {number} how many of THESE entries actually survived to disk (0 on
 *   any failure). v1.47.4 gate SUGGESTION (adversarial seat): this used to
 *   return `normalized.length`, which was a lie whenever the batch pushed the
 *   file past its cap -- recording 1500 entries against a 1000 cap claimed
 *   1500 while 1000 were on disk. The count is now derived from what the cap
 *   actually kept, so a caller reporting it to a user cannot overstate.
 */
function recordFailures(dataDir, failures, nowMs) {
  if (typeof dataDir !== 'string' || dataDir === '') return 0;
  if (!Array.isArray(failures) || failures.length === 0) return 0;
  const normalized = failures
    .filter((f) => f && typeof f === 'object')
    .map((f) => normalizeEntry(f, nowMs));
  if (normalized.length === 0) return 0;
  const existing = readAllEntries(dataDir);
  const combined = existing.concat(normalized);
  const ok = writeAllEntries(dataDir, combined);
  if (!ok) return 0;
  // The tail that survived `writeAllEntries`' slice, intersected with what THIS
  // call contributed: a batch larger than the cap keeps only its own tail.
  return Math.min(normalized.length, YTDLP_FAILLOG_MAX_ENTRIES);
}

/**
 * Read up to `limit` failures, NEWEST-FIRST (the order this list is always
 * displayed in -- unlike `runlog.readRuns`, which hands back on-disk order and
 * makes each caller reverse it). `limit` is itself capped at the file's own
 * cap. An omitted/invalid limit returns everything.
 */
function readFailures(dataDir, limit) {
  const entries = readAllEntries(dataDir);
  const requested = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : YTDLP_FAILLOG_MAX_ENTRIES;
  const cap = Math.min(requested, YTDLP_FAILLOG_MAX_ENTRIES);
  const newestFirst = entries.slice().reverse();
  return newestFirst.slice(0, cap);
}

/**
 * Delete exactly one failure by id.
 *
 * Returns `false` when the id matched nothing, WITHOUT rewriting the file --
 * so a bad/stale id from a double-click or a stale tab is a genuine no-op
 * rather than a needless rewrite of the whole log. Also returns `false` if the
 * write itself fails, so the caller never reports a deletion that did not land.
 */
function deleteFailure(dataDir, id) {
  if (typeof dataDir !== 'string' || dataDir === '') return false;
  if (typeof id !== 'string' || id === '') return false;
  const entries = readAllEntries(dataDir);
  const remaining = entries.filter((e) => e.id !== id);
  if (remaining.length === entries.length) return false; // no such id -- do not rewrite
  return writeAllEntries(dataDir, remaining);
}

/**
 * Clear the whole log by truncating it to an empty file.
 *
 * Deliberately writes an EMPTY file rather than unlinking: it keeps this
 * module's single atomic-write path, so a crash mid-clear leaves either the old
 * log or an empty one, never a partially-deleted state. The file's mode is
 * carried across by `writeAllEntries` (see the chmod note there).
 *
 * @returns {number} how many entries were removed (0 if already empty or the
 *   write failed) -- the caller reports a real count, never an assumed one.
 */
function clearFailures(dataDir) {
  if (typeof dataDir !== 'string' || dataDir === '') return 0;
  const existing = readAllEntries(dataDir);
  if (existing.length === 0) return 0;
  return writeAllEntries(dataDir, []) ? existing.length : 0;
}

module.exports = {
  recordFailures,
  readFailures,
  deleteFailure,
  clearFailures,
  YTDLP_FAILLOG_MAX_ENTRIES,
  MAX_FIELD_LENGTH,
};
