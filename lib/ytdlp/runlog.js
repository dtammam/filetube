'use strict';

// v1.29.0 T1 (R0.5/R0.6, "diagnostics foundation"): a capped, durable JSONL
// run log for the yt-dlp subscription module -- one JSON object per line,
// appended at the end of every completed subscription/one-shot run. Lives
// at `<dataDir>/ytdlp-runs.jsonl`, the SAME directory `db.json` lives in
// (the app's `DATA_DIR`, resolved by the caller exactly the way
// `server.js` resolves it for `loadDatabase`/`saveDatabase` -- this module
// never resolves `DATA_DIR`/`config.downloadDir` itself, it only takes a
// `dataDir` string). T9 (a later task) reads this to render a download
// history view; T3 (a later task) is the only caller that ever writes to
// it, from the terminal branch of `processSubscription`/`runOneShot` -- ONE
// line per completed run (no start/dangling lines), per the EM's
// `runlog_lines` ratification.
//
// SIDE-EFFECT-FREE IMPORT: requiring this file touches no filesystem and
// registers no routes/timers -- same posture as `lib/ytdlp/config.js`. The
// file on disk is created lazily, on the FIRST `recordRun` call only; a
// `readRuns` against a missing file returns `[]` and never creates it. This
// is what keeps the disabled-yt-dlp-module no-op guarantee (R0.7) intact --
// `recordRun`/`readRuns` are only ever reachable from enabled-only call
// sites (T3/T9's job to gate, not this module's).
//
// ATOMIC WRITE: every `recordRun` call does a full read -> defensive parse
// -> push -> `slice(-YTDLP_RUNLOG_MAX_ENTRIES)` -> write-temp-then-rename,
// mirroring `server.js`'s `saveDatabase` atomic-write posture exactly (temp
// file in the SAME directory so `renameSync` is an atomic metadata-only
// operation on POSIX filesystems; `fsync`ed before the rename so a crash
// either leaves the OLD file fully intact or the NEW one fully intact,
// never a torn/half-written file). This keeps an EXACT bound (never more
// than `YTDLP_RUNLOG_MAX_ENTRIES` lines on disk) rather than a best-effort
// rotation -- unbounded logs are a regression per this wave's constraints.
//
// DEFENSIVE READ: `readRuns` (and `recordRun`'s own internal read) parses
// the file LINE BY LINE; a malformed/partial/corrupt line (e.g. a half-
// written line left by a killed process, or hand-edited garbage) is skipped
// silently, never thrown -- mirrors `loadDatabase`'s "a hostile/corrupt
// on-disk file must never crash the process" posture (RELIABILITY.md).

const fs = require('fs');
const path = require('path');

// The run-log's filename, always resolved relative to the caller-supplied
// `dataDir` -- never a hardcoded absolute path.
const RUNLOG_FILENAME = 'ytdlp-runs.jsonl';

// Hard cap on how many run-log lines ever persist to disk at once. Exported
// so tests (and T9, later) can assert against the real value instead of a
// hardcoded duplicate -- mirrors how `run.js` exports `STDERR_TAIL_LIMIT`.
const YTDLP_RUNLOG_MAX_ENTRIES = 500;

// Monotonic per-process counter combined with the pid to guarantee a unique
// same-directory temp filename per append, mirroring `server.js`'s
// `dbTmpSeq` (used by `saveDatabase`) so two in-flight appends (should that
// ever happen) can never collide on the same temp path.
let runlogTmpSeq = 0;

function resolveRunlogPath(dataDir) {
  return path.join(dataDir, RUNLOG_FILENAME);
}

/**
 * Read and defensively parse every line of the run log at `dataDir`, in
 * on-disk (oldest-first / append) order. A missing file (ENOENT) or any
 * other read failure (permissions, `dataDir` not a directory, etc.) yields
 * `[]` -- never throws, and never creates the file. A line that isn't
 * valid JSON, or that parses to a non-object (e.g. a bare number/string/
 * `null` left by corruption), is skipped rather than surfaced.
 *
 * @param {*} dataDir absolute path to the app's data directory
 * @returns {object[]} every successfully-parsed run entry, oldest-first
 */
function readAllEntries(dataDir) {
  if (typeof dataDir !== 'string' || dataDir === '') return [];
  let raw;
  try {
    raw = fs.readFileSync(resolveRunlogPath(dataDir), 'utf8');
  } catch (_) {
    // Missing file, permission error, etc. -- no runs to report. Never
    // throws, and critically never CREATES the file (R0.7's disabled-module
    // no-op guarantee: a mere read must stay a pure no-op).
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
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      entries.push(parsed);
    }
  }
  return entries;
}

/**
 * Append one run-log entry, keeping the on-disk file capped at
 * `YTDLP_RUNLOG_MAX_ENTRIES` lines (oldest entries fall off the front once
 * the cap is exceeded). The caller (T3) supplies the line's fields --
 * `{ ts, kind, id, name, outcome, succeeded, failed, reason, cookieWarning,
 * failures: [{ videoId, title?, reason }] }` -- already bounded/sanitized
 * upstream (e.g. `failures.js`'s `sanitizeReason`/`MAX_REASON_LENGTH`);
 * this function does not re-validate or re-bound individual string fields,
 * it only serializes whatever it is given and must never THROW on a
 * missing/oddly-typed field (a hostile/malformed `entry` is still just
 * `JSON.stringify`-ed as-is).
 *
 * Degrades gracefully on any failure (disk full, permission error, a
 * genuinely unserializable `entry` such as one containing a circular
 * reference): logs and returns, never throws, never crashes the process --
 * a lost run-log line is a diagnostics-only regression, not a data-integrity
 * one (RELIABILITY.md: "wrap fs calls in try/catch; log and degrade").
 *
 * @param {*} dataDir absolute path to the app's data directory
 * @param {*} entry the run-log line's fields (see module comment above)
 */
function recordRun(dataDir, entry) {
  if (typeof dataDir !== 'string' || dataDir === '') return;
  if (!entry || typeof entry !== 'object') return;
  const filePath = resolveRunlogPath(dataDir);
  const tmp = `${filePath}.${process.pid}.${runlogTmpSeq++}.tmp`;
  try {
    const existing = readAllEntries(dataDir);
    existing.push(entry);
    const bounded = existing.slice(-YTDLP_RUNLOG_MAX_ENTRIES);
    const json = bounded.map((e) => JSON.stringify(e)).join('\n') + (bounded.length ? '\n' : '');
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeFileSync(fd, json, 'utf8');
      fs.fsyncSync(fd); // flush bytes to disk before the rename gate
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, filePath); // atomic within dataDir's filesystem
  } catch (err) {
    console.error('Error recording yt-dlp run-log entry:', err);
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp); // best-effort cleanup for THIS call's temp
    } catch (cleanupErr) {
      console.error('Error cleaning up temp run-log file:', cleanupErr);
    }
    // Deliberately NOT rethrown -- a run-log write failure must never break
    // the caller's own terminal-status handling (T3's job); this module
    // degrades silently, per RELIABILITY.md.
  }
}

/**
 * Read up to `limit` run-log entries (in on-disk / append order --
 * oldest-first; T9, the history-view caller, is responsible for reversing
 * to newest-first for display, since it already re-caps/orders for its own
 * route). `limit` is itself capped at `YTDLP_RUNLOG_MAX_ENTRIES` regardless
 * of what the caller asks for, since the file itself never holds more than
 * that. An omitted/invalid `limit` (non-finite, `<= 0`) defaults to the full
 * cap. A missing/unreadable file returns `[]`, never throws.
 *
 * @param {*} dataDir absolute path to the app's data directory
 * @param {*} [limit] max number of entries to return
 * @returns {object[]} at most `min(limit, YTDLP_RUNLOG_MAX_ENTRIES)` entries, oldest-first
 */
function readRuns(dataDir, limit) {
  const entries = readAllEntries(dataDir);
  const requested = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : YTDLP_RUNLOG_MAX_ENTRIES;
  const cap = Math.min(requested, YTDLP_RUNLOG_MAX_ENTRIES);
  return cap >= entries.length ? entries : entries.slice(-cap);
}

module.exports = {
  recordRun,
  readRuns,
  YTDLP_RUNLOG_MAX_ENTRIES,
};
