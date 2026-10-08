'use strict';

// v1.376.0 W6 (b): files whose album cover is still PENDING (plan
// docs/exec-plans/active/2026-10-08-v1376-notify-podcasts-polish.md, W6; the race the v1.374.0 builder named).
//
// A track of a saved album with a picked cover is written by yt-dlp WITH ITS OWN ART, then FileTube re-embeds the
// album's cover (lib/ytdlp/cover.js reembedCover) and only then triggers the scan. Any OTHER scan in that window - the
// previous track's fire-and-forget scan, the periodic timer, a manual "Scan now" - used to index the file with its own
// art: the library thumbnail held the wrong picture, and the browser cached it under a URL that never changed.
//
// So a one-off that will re-embed a cover CLAIMS its output before yt-dlp starts: every file in the job's folder whose
// name carries the video's `[<id>]` bracket (the one-off template, args.js OUTPUT_TEMPLATE) - and, as yt-dlp reports it,
// the exact final path (FTCHDST) - is "cover pending" until the re-embed resolves (ok, refused or failed) or the job ends
// any other way (cancel, a failed download, a throw). Both scan walkers (lib/scan/orchestrator.js scanDirRecursive and
// lib/music/scan.js collectTracks) DEFER a pending path: it is not indexed this pass, and an entry the library already
// holds for that path is RETAINED (a deferred file never reads as deleted - that would be data loss). The job's own scan
// trigger, after the release, indexes it with the album's cover.
//
// In-process state only: a crash drops every claim, and the next scan indexes the file as it is on disk.

const fs = require('fs');
const path = require('path');

const claims = new Set();

// The real path of `dir`; a folder that does not exist yet (the first track of a new channel folder is claimed before
// yt-dlp creates it) resolves through its nearest existing ancestor, so a download root behind a symlink still matches.
function realDir(dir) {
  let cur = path.resolve(dir);
  const rest = [];
  for (;;) {
    try { return path.join(fs.realpathSync(cur), ...rest); } catch (_) { /* not there (yet): try the parent */ }
    const parent = path.dirname(cur);
    if (parent === cur) return null;
    rest.unshift(path.basename(cur));
    cur = parent;
  }
}
// A directory's filesystem identity (device + inode) when it exists, else null. realpath follows SYMLINKS only:
// two bind mounts of one host folder (the download folder and the library root mounted separately) have two
// real paths but ONE identity (gate r1, adversary).
function dirIdentity(dir) {
  try { const st = fs.statSync(dir); return st.isDirectory() ? `id:${st.dev}:${st.ino}` : null; } catch (_) { return null; }
}
// The keys a directory is matched by: its resolved spelling, its real path (a root configured through a
// symlink) and its identity (a root reached through a second bind mount), each when it exists.
function dirKeysOf(dir) {
  const keys = new Set([path.resolve(dir)]);
  const real = realDir(dir);
  if (real) keys.add(real);
  const id = dirIdentity(dir);
  if (id) keys.add(id);
  return keys;
}

// Claims the output of one job: `dir` = the folder yt-dlp writes into (known before the spawn), `videoId` = the
// video's id. -> a handle { addFile(absPath), release() }, or null when there is nothing to claim. `release` is
// idempotent; `addFile` takes only a file in the claimed folder (an FTCHDST line is stdout text).
function claim({ dir, videoId } = {}) {
  if (typeof dir !== 'string' || dir === '' || !path.isAbsolute(dir)) return null;
  if (typeof videoId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(videoId)) return null;
  const c = { dirKeys: dirKeysOf(dir), bracket: `[${videoId}]`, names: new Set() };
  claims.add(c);
  return {
    addFile(file) {
      if (!claims.has(c) || typeof file !== 'string' || !path.isAbsolute(file)) return false;
      if (!inClaimedDir(c, path.dirname(file))) return false;
      // The job's channel folder may not have existed at the claim: learn its identity now it does.
      const id = dirIdentity(path.dirname(file));
      if (id) c.dirKeys.add(id);
      c.names.add(path.basename(file));
      return true;
    },
    release() { claims.delete(c); },
  };
}

function inClaimedDir(c, dir) {
  if (c.dirKeys.has(path.resolve(dir))) return true;
  const real = realDir(dir);
  if (real && c.dirKeys.has(real)) return true;
  const id = dirIdentity(dir);
  return !!id && c.dirKeys.has(id);
}

// Is `filePath` (an absolute path a walker found) cover pending? Never throws; false when nothing is claimed.
function isPending(filePath) {
  if (claims.size === 0 || typeof filePath !== 'string' || filePath === '') return false;
  const name = path.basename(filePath);
  const dir = path.dirname(filePath);
  for (const c of claims) {
    if ((name.includes(c.bracket) || c.names.has(name)) && inClaimedDir(c, dir)) return true;
  }
  return false;
}

function pendingCount() { return claims.size; }
function resetForTests() { claims.clear(); }

module.exports = { claim, isPending, pendingCount, resetForTests };
