// v1.370.0 W4: waiting playlists (plan docs/exec-plans/completed/2026-10-06-v1370-playlist-picker.md, R9, R13).
//
// The iPhone Shortcut posts a link with the API token and never opens the app. A playlist link it posts is
// NOT downloaded (the token gains no playlist route): it is kept here as "Playlist waiting: choose videos"
// until someone allowed to download opens FileTube, picks from it, or dismisses it. Persisted to
// `<dataDir>/ytdlp-waiting-playlists.json` with pending.js's posture: atomic temp + fsync + rename inside
// dataDir, degrade (never throw), no fs at require time. Bounded: at most MAX_WAITING entries (the oldest
// dropped), each expiring after WAITING_TTL_MS.
//
// An entry holds only what the server rebuilt from a classified link: { id, kind ('playlist' |
// 'watch-in-list'), listId, videoId|null, url (the canonical rebuilt URL, never the posted text), createdAt }.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WAITING_FILENAME = 'ytdlp-waiting-playlists.json';
const MAX_WAITING = 20;
const WAITING_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ID_SHAPE = /^[0-9a-f-]{36}$/;

let waitingTmpSeq = 0;

function resolveWaitingPath(dataDir) {
  return path.join(dataDir, WAITING_FILENAME);
}

function fresh(e, nowMs) {
  const t = Date.parse(e.createdAt);
  return Number.isFinite(t) && nowMs - t < WAITING_TTL_MS;
}

function readRaw(dataDir) {
  if (typeof dataDir !== 'string' || dataDir === '') return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(resolveWaitingPath(dataDir), 'utf8'));
    return Array.isArray(parsed) ? parsed.filter((e) => e && typeof e === 'object' && typeof e.id === 'string') : [];
  } catch {
    return [];
  }
}

function writeWaiting(dataDir, entries) {
  const filePath = resolveWaitingPath(dataDir);
  const tmp = `${filePath}.${process.pid}.${waitingTmpSeq++}.tmp`;
  try {
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeFileSync(fd, JSON.stringify(entries.slice(-MAX_WAITING)), 'utf8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, filePath);
  } catch (err) {
    console.error('Error writing yt-dlp waiting-playlists file:', err);
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch { /* best-effort */ }
  }
}

// The live list, oldest first: expired entries are left out (and dropped from the file on the next write).
function listWaiting(dataDir, nowMs = Date.now()) {
  return readRaw(dataDir).filter((e) => fresh(e, nowMs));
}

// `entry` = { kind, listId, videoId, url } from the caller's classification. The same list (and video) posted
// again refreshes its place instead of adding a second row. Returns the stored entry (or null).
function addWaiting(dataDir, entry, nowMs = Date.now()) {
  if (typeof dataDir !== 'string' || dataDir === '' || !entry || typeof entry.listId !== 'string' || typeof entry.url !== 'string') return null;
  const stored = {
    id: crypto.randomUUID(),
    kind: entry.kind === 'watch-in-list' ? 'watch-in-list' : 'playlist',
    listId: entry.listId,
    videoId: typeof entry.videoId === 'string' ? entry.videoId : null,
    url: entry.url,
    createdAt: new Date(nowMs).toISOString(),
  };
  const live = listWaiting(dataDir, nowMs);
  const prior = live.find((e) => e.listId === stored.listId && e.videoId === stored.videoId);
  // the same list (and video) posted again keeps its ID (the first push's &waiting=<id> must still clear it)
  // and moves to the newest place with a fresh time; `repeat` tells the caller to send no second push
  if (prior) stored.id = prior.id;
  const rest = live.filter((e) => e !== prior);
  rest.push(stored);
  writeWaiting(dataDir, rest);
  return Object.assign({}, stored, { repeat: !!prior });
}

// Dismiss (or picked): true when an entry was removed.
function removeWaiting(dataDir, id, nowMs = Date.now()) {
  if (typeof dataDir !== 'string' || dataDir === '' || typeof id !== 'string' || !ID_SHAPE.test(id)) return false;
  const all = listWaiting(dataDir, nowMs);
  const rest = all.filter((e) => e.id !== id);
  if (rest.length === all.length) return false;
  writeWaiting(dataDir, rest);
  return true;
}

module.exports = { listWaiting, addWaiting, removeWaiting, MAX_WAITING, WAITING_TTL_MS, WAITING_FILENAME };
