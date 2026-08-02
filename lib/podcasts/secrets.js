'use strict';

// v1.69.0 (podcasts): the feed-URL secret store. A podcast feed URL is a
// CREDENTIAL (Patreon's `?auth=<token>` is the user's paid-feed identity),
// so full feed URLs live here - `<dataDir>/podcast-feeds.json`, mode 0600 -
// and NEVER in db.podcasts. Because backups bundle db namespaces and this
// file is not one, tokens are structurally excluded from backup bundles
// (the push_subscriptions posture). Consequence, DISCLOSED in ROADMAP: a
// backup restored onto a fresh box brings the subscriptions back but not
// their tokens - affected subs surface `secretMissing` and the UI asks for
// the URL again.
//
// Posture (the lib/ytdlp/pending.js file discipline + the session-secret
// permission discipline):
// - Atomic writes: temp + fsync + rename, always within dataDir, 0600 on
//   the temp BEFORE content is written (never a world-readable window).
// - Degrade, never throw: a missing/corrupt file reads as {}; corruption is
//   preserved aside as `.corrupt` once for inspection, never silently lost.
// - Never log a value; log lines name the PATH only.
// - Side-effect-free import; the file exists only after the first set.

const fs = require('fs');
const path = require('path');

const SECRETS_FILENAME = 'podcast-feeds.json';

let tmpSeq = 0;

function resolveSecretsPath(dataDir) {
  return path.join(dataDir, SECRETS_FILENAME);
}

/**
 * Read the secrets map `{ [subId]: feedUrl }`. Missing file -> {}. A corrupt
 * file is moved aside to `<file>.corrupt` (best-effort, first writer wins)
 * and reads as {} - so a later save can never interleave garbage, and the
 * evidence survives for the operator.
 */
function loadFeedSecrets(dataDir) {
  if (typeof dataDir !== 'string' || dataDir === '') return {};
  const filePath = resolveSecretsPath(dataDir);
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    return {}; // ENOENT: normal before the first subscription
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    const out = Object.create(null);
    for (const key of Object.keys(parsed)) {
      if (typeof parsed[key] === 'string' && parsed[key] !== '') out[key] = parsed[key];
    }
    return out;
  } catch {
    try {
      fs.renameSync(filePath, `${filePath}.corrupt`);
      console.error(`Podcasts: feed-secrets file was corrupt; moved aside to ${filePath}.corrupt`);
    } catch { /* best-effort */ }
    return {};
  }
}

function saveFeedSecrets(dataDir, map) {
  const filePath = resolveSecretsPath(dataDir);
  const tmp = `${filePath}.${process.pid}.${tmpSeq++}.tmp`;
  try {
    const clean = {};
    for (const key of Object.keys(map || {})) {
      if (typeof map[key] === 'string' && map[key] !== '') clean[key] = map[key];
    }
    const json = JSON.stringify(clean);
    // 0600 set at open time - the content never exists at a wider mode.
    const fd = fs.openSync(tmp, 'w', 0o600);
    try {
      fs.writeFileSync(fd, json, 'utf8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, filePath);
    // Belt-and-suspenders for a pre-existing wider-mode file the rename kept.
    try { fs.chmodSync(filePath, 0o600); } catch { /* best-effort */ }
    return true;
  } catch (err) {
    console.error(`Podcasts: error writing feed-secrets file at ${filePath}:`, err && err.code ? err.code : 'error');
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch { /* best-effort */ }
    return false;
  }
}

/** Set one sub's feed URL (read-modify-write; small file, rare writes). */
function setFeedSecret(dataDir, subId, feedUrl) {
  const map = loadFeedSecrets(dataDir);
  map[subId] = feedUrl;
  return saveFeedSecrets(dataDir, map);
}

/** Remove one sub's feed URL. Missing key is a success (idempotent). */
function deleteFeedSecret(dataDir, subId) {
  const map = loadFeedSecrets(dataDir);
  if (!(subId in map)) return true;
  delete map[subId];
  return saveFeedSecrets(dataDir, map);
}

/**
 * Archive orphaned secrets into `<file>.orphaned` (0600, same atomic
 * discipline) instead of destroying them (v1.69 delta-round suggestion #5:
 * the orphan sweep is a destructive action gated on a db read - for a
 * CREDENTIAL store, moving beats deleting). Merges over any prior archive;
 * an entry re-orphaned later just overwrites its own key.
 */
function archiveOrphanedSecrets(dataDir, orphans) {
  const keys = Object.keys(orphans || {});
  if (keys.length === 0) return true;
  const archivePath = `${resolveSecretsPath(dataDir)}.orphaned`;
  let existing = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(archivePath, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) existing = parsed;
  } catch { /* missing/corrupt archive: start fresh */ }
  const merged = {};
  for (const k of Object.keys(existing)) {
    if (typeof existing[k] === 'string' && existing[k] !== '') merged[k] = existing[k];
  }
  for (const k of keys) {
    if (typeof orphans[k] === 'string' && orphans[k] !== '') merged[k] = orphans[k];
  }
  const tmp = `${archivePath}.${process.pid}.${tmpSeq++}.tmp`;
  try {
    const fd = fs.openSync(tmp, 'w', 0o600);
    try {
      fs.writeFileSync(fd, JSON.stringify(merged), 'utf8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, archivePath);
    try { fs.chmodSync(archivePath, 0o600); } catch { /* best-effort */ }
    return true;
  } catch (err) {
    console.error(`Podcasts: error writing orphaned-secrets archive at ${archivePath}:`, err && err.code ? err.code : 'error');
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch { /* best-effort */ }
    return false;
  }
}

module.exports = {
  loadFeedSecrets,
  saveFeedSecrets,
  setFeedSecret,
  deleteFeedSecret,
  archiveOrphanedSecrets,
  resolveSecretsPath,
  SECRETS_FILENAME,
};
