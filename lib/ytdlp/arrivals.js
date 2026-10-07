'use strict';

// v1.373.0: playlist arrivals (plan docs/exec-plans/completed/2026-10-07-v1373-hide-from-feed.md, R2, R3, R5).
//
// A playlist job's videos land in the library only when the post-download scan indexes them (fire-and-forget), so what
// the job wants done with each one waits here until the scan sees it:
//   - every playlist video raises NO download notification (Dean: "notifications don't pop for these. for playlists");
//   - with "Hide from feed" ticked, it joins the downloader's own Hide from feed list (v1.97).
// An arrival is THAT download's (gate r1, adversary W1 / qa W1 / security LOW): it matches only the same YouTube id AND
// the same type (the job's format - an audio file or a video), it is USED UP by the first scan that matches it (the scan
// removes it after its commit), and the job removes it when that video does not finish. So a later download of the same
// video - the other format, a re-download, a subscription, someone else's one-off - notifies and stays visible as usual.
// Persisted to `<dataDir>/ytdlp-playlist-arrivals.json` with waiting.js's posture: atomic temp + fsync + rename inside
// dataDir, degrade (never throw), no fs at require time. Bounded: at most MAX_ARRIVALS entries (the oldest dropped), each
// expiring after ARRIVAL_TTL_MS (a scan that never runs). An entry is
// { youtubeId, type: 'audio'|'video', userId|null, hide, sinceMs, createdAt }.

const fs = require('fs');
const path = require('path');
const { isSafeVideoId } = require('./url');

const ARRIVALS_FILENAME = 'ytdlp-playlist-arrivals.json';
const MAX_ARRIVALS = 2000;
const ARRIVAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TYPES = new Set(['audio', 'video']);

let arrivalsTmpSeq = 0;

function resolveArrivalsPath(dataDir) {
  return path.join(dataDir, ARRIVALS_FILENAME);
}

// An entry read back from disk is untrusted at rest: only the exact shape survives.
function validEntry(e) {
  return !!e && typeof e === 'object' && !Array.isArray(e)
    && isSafeVideoId(e.youtubeId)
    && TYPES.has(e.type)
    && (e.userId === null || (Number.isSafeInteger(e.userId) && e.userId > 0)) // users.id is an INTEGER key
    && typeof e.hide === 'boolean'
    && (e.hide === false || e.userId !== null) // a hide always names its user
    && Number.isFinite(e.sinceMs)
    && Number.isFinite(e.createdAt);
}
const sameDownload = (e, youtubeId, type) => e.youtubeId === youtubeId && e.type === type;

// The live arrivals (expired and malformed entries left out).
function listArrivals(dataDir, nowMs = Date.now()) {
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

// Record (or refresh) what to do when this download lands. `userId` only with `hide` (else null). Returns the entry or
// null.
function addArrival(dataDir, { youtubeId, type, userId, hide, sinceMs } = {}, nowMs = Date.now()) {
  if (typeof dataDir !== 'string' || dataDir === '') return null;
  const hiding = hide === true && Number.isSafeInteger(userId) && userId > 0;
  const entry = {
    youtubeId,
    type,
    userId: hiding ? userId : null,
    hide: hiding,
    sinceMs: Number.isFinite(sinceMs) ? sinceMs : nowMs,
    createdAt: nowMs,
  };
  if (!validEntry(entry)) return null;
  const rest = listArrivals(dataDir, nowMs).filter((e) => !sameDownload(e, youtubeId, type));
  rest.push(entry);
  writeArrivals(dataDir, rest);
  return entry;
}

// The arrival for this download in an already-read list (the scan reads the file once), or null.
function findArrival(arrivals, youtubeId, type) {
  if (!Array.isArray(arrivals) || !isSafeVideoId(youtubeId)) return null;
  return arrivals.find((e) => sameDownload(e, youtubeId, type)) || null;
}

// Remove these downloads' arrivals (the scan's used-up ones, or a job's video that did not finish). `keys` =
// [{ youtubeId, type }]. Writes only when something was removed; returns how many were.
function removeArrivals(dataDir, keys, nowMs = Date.now()) {
  if (typeof dataDir !== 'string' || dataDir === '' || !Array.isArray(keys) || keys.length === 0) return 0;
  const all = listArrivals(dataDir, nowMs);
  const rest = all.filter((e) => !keys.some((k) => k && sameDownload(e, k.youtubeId, k.type)));
  if (rest.length !== all.length) writeArrivals(dataDir, rest);
  return all.length - rest.length;
}

module.exports = { addArrival, listArrivals, findArrival, removeArrivals, ARRIVALS_FILENAME, MAX_ARRIVALS, ARRIVAL_TTL_MS };
