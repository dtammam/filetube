'use strict';

// v1.373.0: playlist arrivals (plan docs/exec-plans/active/2026-10-07-v1373-hide-from-feed.md, R2, R3, R5).
//
// A playlist job's videos land in the library only when the post-download scan indexes them (fire-and-forget), so what
// the job wants done with each one waits here, keyed by YouTube id, until the scan sees it:
//   - every playlist video raises NO download notification (Dean: "notifications don't pop for these. for playlists");
//   - with "Hide from feed" ticked, it joins the downloader's own Hide from feed list (v1.97) - only an item added at or
//     after `sinceMs`, so a copy someone already had is never hidden.
// Persisted to `<dataDir>/ytdlp-playlist-arrivals.json` with waiting.js's posture: atomic temp + fsync + rename inside
// dataDir, degrade (never throw), no fs at require time. Bounded: at most MAX_ARRIVALS entries (the oldest dropped), each
// expiring after ARRIVAL_TTL_MS. An entry is { youtubeId, userId|null, hide, sinceMs, createdAt }; it stays until it
// expires (a second scan of the same item is a no-op: the hide is idempotent and no notification is raised twice).

const fs = require('fs');
const path = require('path');
const { isSafeVideoId } = require('./url');

const ARRIVALS_FILENAME = 'ytdlp-playlist-arrivals.json';
const MAX_ARRIVALS = 2000;
const ARRIVAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

let arrivalsTmpSeq = 0;

function resolveArrivalsPath(dataDir) {
  return path.join(dataDir, ARRIVALS_FILENAME);
}

// An entry read back from disk is untrusted at rest: only the exact shape survives.
function validEntry(e) {
  return !!e && typeof e === 'object' && !Array.isArray(e)
    && isSafeVideoId(e.youtubeId)
    && (e.userId === null || (Number.isSafeInteger(e.userId) && e.userId > 0)) // users.id is an INTEGER key
    && typeof e.hide === 'boolean'
    && (e.hide === false || e.userId !== null) // a hide always names its user
    && Number.isFinite(e.sinceMs)
    && Number.isFinite(e.createdAt);
}

function readLive(dataDir, nowMs) {
  if (typeof dataDir !== 'string' || dataDir === '') return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(resolveArrivalsPath(dataDir), 'utf8'));
    return Array.isArray(parsed) ? parsed.filter((e) => validEntry(e) && nowMs - e.createdAt < ARRIVAL_TTL_MS) : [];
  } catch {
    return [];
  }
}

function writeArrivals(dataDir, entries) {
  const filePath = resolveArrivalsPath(dataDir);
  const tmp = `${filePath}.${process.pid}.${arrivalsTmpSeq++}.tmp`;
  try {
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeFileSync(fd, JSON.stringify(entries.slice(-MAX_ARRIVALS)), 'utf8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, filePath);
  } catch (err) {
    console.error('Error writing yt-dlp playlist-arrivals file:', err);
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch { /* best-effort */ }
  }
}

// Record (or refresh) what to do when `youtubeId` lands. `userId` only with `hide` (else null). Returns the entry or null.
function addArrival(dataDir, { youtubeId, userId, hide, sinceMs } = {}, nowMs = Date.now()) {
  if (typeof dataDir !== 'string' || dataDir === '') return null;
  const entry = {
    youtubeId,
    userId: hide === true && Number.isSafeInteger(userId) && userId > 0 ? userId : null,
    hide: hide === true && Number.isSafeInteger(userId) && userId > 0,
    sinceMs: Number.isFinite(sinceMs) ? sinceMs : nowMs,
    createdAt: nowMs,
  };
  if (!validEntry(entry)) return null;
  const rest = readLive(dataDir, nowMs).filter((e) => e.youtubeId !== youtubeId);
  rest.push(entry);
  writeArrivals(dataDir, rest);
  return entry;
}

// The live arrival for `youtubeId`, or null.
function findArrival(dataDir, youtubeId, nowMs = Date.now()) {
  if (!isSafeVideoId(youtubeId)) return null;
  return readLive(dataDir, nowMs).find((e) => e.youtubeId === youtubeId) || null;
}

module.exports = { addArrival, findArrival, ARRIVALS_FILENAME, MAX_ARRIVALS, ARRIVAL_TTL_MS };
