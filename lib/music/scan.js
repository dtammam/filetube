'use strict';

// v1.44 T4 (music): the music scanner's PURE core -- walk configured music
// roots for audio files, resolve per-track metadata (embedded ffprobe tags
// with path-convention fallback, via lib/music/tags.js), and produce the next
// `db.music.tracks` map. Mirrors lib/books/scan.js discipline exactly: this
// module does the fs READS (walk, stat, sidecar-art detection); it never
// touches the database and never spawns ffmpeg itself -- ffprobe is injected
// as `deps.probe` so the module is CI-testable with no ffmpeg present. The
// server's `scanMusic()` wiring owns the single updateDatabase mutator, the
// scan-state machine, the album-art extraction spawn, and the prune.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('./store');
const musicTags = require('./tags');

const MUSIC_EXTENSIONS = new Set(['.mp3', '.m4a', '.aac', '.flac', '.wav']);

// Cooperative yield cadence -- the books/media scan discipline (a REAL
// macrotask via setImmediate, never a microtask), so a first scan of tens of
// thousands of tracks never holds the event loop for a long synchronous
// stretch while requests queue.
const MUSIC_SCAN_YIELD_BATCH = 8;

// The album-art cache filename for an album grouping key: md5(albumKey). Kept
// separate from the track id (md5(path)) so all tracks of one album share ONE
// art file (the per-album dedup the prune relies on).
function albumArtKeyFor(track) {
  return crypto.createHash('md5').update(store.albumKeyFor(track)).digest('hex');
}

/**
 * Recursively walk one root for audio files. Returns absolute file paths.
 * Symlinked directories are NOT followed (loop hygiene); unreadable subtrees
 * are skipped with a warn, NEVER a throw (the conservatism the prune depends
 * on -- a transient EACCES must not look like an emptied library).
 */
function walkMusicRoot(root) {
  const found = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    let dirents;
    try {
      dirents = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      console.warn(`music: skipping unreadable directory ${dir}: ${err && err.code}`);
      continue;
    }
    for (const dirent of dirents) {
      const full = path.join(dir, dirent.name);
      if (dirent.isDirectory()) {
        stack.push(full);
      } else if (dirent.isFile() && MUSIC_EXTENSIONS.has(path.extname(dirent.name).toLowerCase())) {
        found.push(full);
      }
    }
  }
  return found;
}

/**
 * Find a sidecar cover file in `dir` (case-insensitively matching one of
 * SIDECAR_ART_NAMES), or null. Pure fs read; unreadable dir -> null (never
 * throws). Returns the absolute path of the first match in preference order.
 */
function findSidecarArt(dir) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return null;
  }
  const lowerToActual = new Map();
  for (const n of names) lowerToActual.set(n.toLowerCase(), n);
  for (const candidate of musicTags.SIDECAR_ART_NAMES) {
    const actual = lowerToActual.get(candidate);
    if (actual) return path.join(dir, actual);
  }
  return null;
}

/**
 * Phase-1: walk every EXISTING root, build the next tracks map against a
 * snapshot of the previous one (unchanged path+size = reuse, including
 * previously-resolved metadata), and probe new/changed files for tags. Pure
 * apart from fs READS and the injected `probe`; the caller owns art WRITES,
 * the db merge, and the prune.
 *
 * @param {string[]} folders configured music roots
 * @param {Object<string, object>} previousTracks snapshot of db.music.tracks
 * @param {{ getMediaId: (fp: string) => string,
 *           probe: (fp: string) => Promise<{tags?: object, durationSec?: number, codec?: string, hasEmbeddedArt?: boolean}|null> }} deps
 * @returns {Promise<{ tracks: Object<string, object>, survivingIds: Set<string>, missingRoots: string[] }>}
 */
async function collectTracks(folders, previousTracks, deps) {
  const getMediaId = deps && deps.getMediaId;
  const probe = deps && deps.probe;
  const tracks = {};
  const survivingIds = new Set();
  const missingRoots = [];
  const prev = previousTracks || {};
  let processed = 0;

  for (const root of Array.isArray(folders) ? folders : []) {
    if (typeof root !== 'string' || root === '') continue;
    if (!fs.existsSync(root)) {
      missingRoots.push(root);
      continue;
    }
    for (const filePath of walkMusicRoot(root)) {
      processed += 1;
      if (processed % MUSIC_SCAN_YIELD_BATCH === 0) {
        await new Promise((resolve) => setImmediate(resolve));
      }
      let stat;
      try {
        stat = await fs.promises.stat(filePath);
      } catch {
        continue; // vanished mid-walk -- dropped from survivingIds THIS pass only
      }
      const id = getMediaId(filePath);
      survivingIds.add(id);
      const existing = prev[id];
      if (existing && existing.filePath === filePath && existing.size === stat.size) {
        tracks[id] = existing; // unchanged: reuse (incl. resolved metadata + art key)
        continue;
      }
      const ext = path.extname(filePath).toLowerCase();
      let probed = null;
      if (typeof probe === 'function') {
        try { probed = await probe(filePath); } catch { probed = null; }
      }
      const meta = musicTags.buildTrackMetadata({
        tags: probed && probed.tags,
        filePath,
        rootFolder: root,
      });
      const record = {
        id,
        filePath,
        rootFolder: root,
        folderName: path.basename(path.dirname(filePath)),
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        addedAt: (existing && existing.addedAt) || new Date().toISOString(),
        ext,
        title: meta.title,
        artist: meta.artist,
        album: meta.album,
        albumArtist: meta.albumArtist,
        trackNo: meta.trackNo,
        discNo: meta.discNo,
        year: meta.year,
        genre: meta.genre,
        durationSec: probed && Number.isFinite(probed.durationSec) ? probed.durationSec : 0,
        codec: probed && typeof probed.codec === 'string' ? probed.codec : null,
        hasEmbeddedArt: !!(probed && probed.hasEmbeddedArt),
      };
      record.albumArtKey = albumArtKeyFor(record);
      tracks[id] = record;
    }
  }

  return { tracks, survivingIds, missingRoots };
}

/**
 * Pure: given the final tracks map and a predicate that reports whether an
 * album's art file already exists, return ONE representative art job per album
 * that still lacks art -- deduped by albumArtKey. The server wiring runs these
 * (embedded ffmpeg extract, else sidecar copy). A representative is any track
 * of the album; embedded art is preferred, so a track WITH embedded art is
 * chosen over one without when both exist for the album.
 * @returns {Array<{albumArtKey: string, sourceFilePath: string, dir: string, hasEmbeddedArt: boolean}>}
 */
function selectAlbumArtJobs(tracks, artExists) {
  const byAlbum = new Map();
  for (const id of Object.keys(tracks || {})) {
    const t = tracks[id];
    if (!t || typeof t.albumArtKey !== 'string') continue;
    const key = t.albumArtKey;
    if (typeof artExists === 'function' && artExists(key)) continue; // already have art
    const prev = byAlbum.get(key);
    // Prefer a representative that carries embedded art.
    if (!prev || (t.hasEmbeddedArt && !prev.hasEmbeddedArt)) {
      byAlbum.set(key, {
        albumArtKey: key,
        sourceFilePath: t.filePath,
        dir: path.dirname(t.filePath),
        hasEmbeddedArt: !!t.hasEmbeddedArt,
      });
    }
  }
  return [...byAlbum.values()];
}

/**
 * Pure: given the ids being pruned and the FINAL surviving tracks, return the
 * album-art keys whose art file is now orphaned (no surviving track references
 * them) -- so the caller unlinks art ONLY when the LAST track of an album is
 * pruned, never on a single-track prune of a multi-track album.
 * @returns {string[]} orphaned albumArtKeys safe to unlink
 */
function selectOrphanedArtKeys(prunedTracks, survivingTracks) {
  const survivingKeys = new Set();
  for (const id of Object.keys(survivingTracks || {})) {
    const t = survivingTracks[id];
    if (t && typeof t.albumArtKey === 'string') survivingKeys.add(t.albumArtKey);
  }
  const orphaned = new Set();
  for (const t of Array.isArray(prunedTracks) ? prunedTracks : []) {
    if (t && typeof t.albumArtKey === 'string' && !survivingKeys.has(t.albumArtKey)) {
      orphaned.add(t.albumArtKey);
    }
  }
  return [...orphaned];
}

module.exports = {
  MUSIC_EXTENSIONS,
  walkMusicRoot,
  findSidecarArt,
  collectTracks,
  selectAlbumArtJobs,
  selectOrphanedArtKeys,
  albumArtKeyFor,
};
