// v1.31 P4: durable pending-one-shot store.
//
// Pre-v1.31, an accepted one-shot download (`202 {accepted, jobId}` already
// sent to the caller) existed ONLY as an in-memory activity entry plus a
// position on the in-memory `runExclusive` FIFO -- a server restart while it
// was still queued (or mid-download) silently vaporized it, with no runlog
// line and no trace. For an API/Shortcut caller that trusted the 202, the
// job just never happened. This module persists the accepted-but-not-yet-
// terminal one-shot set to `<dataDir>/ytdlp-pending-oneshots.json` so
// `startBackground` can REQUEUE survivors after a restart (lib/ytdlp/
// index.js owns the requeue logic; this module owns only the durable set).
//
// Posture (mirrors lib/ytdlp/runlog.js exactly):
// - Atomic writes: temp file + fsync + rename, always within dataDir.
// - Bounded: at most MAX_PENDING_ONESHOTS entries -- the same ceiling as
//   index.js's MAX_ONESHOT_QUEUE_LENGTH route cap, re-declared here so this
//   module stays dependency-free of index.js (index.js asserts they match
//   in its own require-time check).
// - Degrade, never throw: a lost/corrupt pending file costs restart-
//   requeue coverage only, never a crash and never the live download path.
// - Side-effect-free import: no fs access at require time; the file is only
//   created by the first `add`.

const fs = require('fs');
const path = require('path');

const PENDING_FILENAME = 'ytdlp-pending-oneshots.json';
const MAX_PENDING_ONESHOTS = 50;

let pendingTmpSeq = 0;

function resolvePendingPath(dataDir) {
  return path.join(dataDir, PENDING_FILENAME);
}

/**
 * Read the current pending set. Returns an array of plain entry objects
 * (`{jobId, url, format, quality, filetype, folder, createdAt}` by
 * convention -- not re-validated here; the requeue caller re-validates
 * every field before acting on it, exactly like every other
 * untrusted-at-rest input). Missing/corrupt file -> `[]`, never a throw,
 * never file creation on read.
 * @param {*} dataDir
 * @returns {Array<object>}
 */
function readPending(dataDir) {
  if (typeof dataDir !== 'string' || dataDir === '') return [];
  try {
    const raw = fs.readFileSync(resolvePendingPath(dataDir), 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((e) => e && typeof e === 'object' && typeof e.jobId === 'string');
  } catch {
    // ENOENT (normal before the first add) and corrupt-JSON both degrade to
    // an empty set -- a corrupt file is overwritten wholesale by the next add.
    return [];
  }
}

function writePending(dataDir, entries) {
  const filePath = resolvePendingPath(dataDir);
  const tmp = `${filePath}.${process.pid}.${pendingTmpSeq++}.tmp`;
  try {
    const bounded = entries.slice(-MAX_PENDING_ONESHOTS);
    const json = JSON.stringify(bounded);
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeFileSync(fd, json, 'utf8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, filePath);
  } catch (err) {
    console.error('Error writing yt-dlp pending-one-shots file:', err);
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch (cleanupErr) {
      console.error('Error cleaning up temp pending-one-shots file:', cleanupErr);
    }
  }
}

/**
 * Record an accepted one-shot. Idempotent per jobId (a duplicate add
 * replaces the prior entry). Never throws.
 */
function addPending(dataDir, entry) {
  if (typeof dataDir !== 'string' || dataDir === '') return;
  if (!entry || typeof entry !== 'object' || typeof entry.jobId !== 'string') return;
  const existing = readPending(dataDir).filter((e) => e.jobId !== entry.jobId);
  existing.push(entry);
  writePending(dataDir, existing);
}

/**
 * Remove a one-shot that reached ANY terminal fate (downloaded, failed,
 * cancelled, dropped) -- terminal jobs are the runlog's story, not this
 * file's. Removing an absent jobId is a no-op. Never throws.
 */
function removePending(dataDir, jobId) {
  if (typeof dataDir !== 'string' || dataDir === '') return;
  if (typeof jobId !== 'string' || jobId === '') return;
  const existing = readPending(dataDir);
  const remaining = existing.filter((e) => e.jobId !== jobId);
  if (remaining.length === existing.length) return; // nothing to do -- skip the write
  writePending(dataDir, remaining);
}

module.exports = {
  readPending,
  addPending,
  removePending,
  MAX_PENDING_ONESHOTS,
  PENDING_FILENAME,
};
