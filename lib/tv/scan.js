'use strict';

// v1.195 T2 (TV Shows): the scanner's PURE core -- walk configured Shows roots at
// the <Show>/<Season>/<Episode> structure, resolve per-episode fields via
// lib/tv/parse.js, and produce the next `db.tv.episodes` map. Mirrors
// lib/music/scan.js discipline exactly: fs READS only (walk, stat, poster
// detection); never touches the database and never spawns ffmpeg itself --
// ffprobe is injected as `deps.probe` so the module is CI-testable with no ffmpeg
// present. The server's scanTv() wiring owns the single updateDatabase mutator,
// the scan-state machine, the thumbnail-extract spawn, and the prune.

const fs = require('fs');
const path = require('path');
const { TRASH_DIR_NAME } = require('../trashPaths');
const parse = require('./parse');

// The playable-episode extension set. MUST stay a superset-match of server.js's
// VIDEO_EXTENSIONS + TRANSCODE_EXTENSIONS so an episode is exactly the set of
// files the video pipeline can serve (browser-incompatible containers like AVI
// transcode on demand, same as the main library). A source-lock test binds this
// against server.js so the two never drift.
const TV_EXTENSIONS = new Set(['.mp4', '.mkv', '.webm', '.avi', '.mov', '.m4v', '.flv', '.wmv', '.mpg', '.mpeg']);

// Show-folder poster filenames, in preference order, each tried case-insensitively
// across the image extensions. Mirrors the podcast cover probe.
const POSTER_BASENAMES = ['poster', 'folder', 'cover', 'show'];
const POSTER_EXTS = ['.jpg', '.jpeg', '.png', '.webp'];

const TV_SCAN_YIELD_BATCH = 8;

// Recursively collect video files under one directory (a season folder, or a
// deeper Extras subtree). Unreadable dir -> skipped + recorded in erroredDirs
// (the subtree-conservatism guard the prune relies on). Symlinked dirs not
// followed (loop hygiene).
function walkVideoFiles(dir, erroredDirs) {
  const found = [];
  const stack = [dir];
  while (stack.length > 0) {
    const cur = stack.pop();
    let dirents;
    try {
      dirents = fs.readdirSync(cur, { withFileTypes: true });
    } catch (err) {
      console.warn(`tv: skipping unreadable directory ${cur}: ${err && err.code}`);
      if (Array.isArray(erroredDirs)) erroredDirs.push(cur);
      continue;
    }
    for (const dirent of dirents) {
      const full = path.join(cur, dirent.name);
      if (dirent.isDirectory()) {
        if (dirent.name === TRASH_DIR_NAME) continue;
        stack.push(full);
      } else if (dirent.isFile() && TV_EXTENSIONS.has(path.extname(dirent.name).toLowerCase())) {
        found.push(full);
      }
    }
  }
  return found;
}

/**
 * Walk one Shows root and emit one tuple per episode file, encoding the
 * Show/Season structure. The immediate children of a root are SHOWS; a show's
 * immediate subdirectories are SEASONS (folderSeason = parseSeasonFolder), and
 * files directly in the show folder are flat (folderSeason = null -> the
 * filename's SxxEyy provides the season). An unrecognized subfolder yields
 * folderSeason = null too, so its files fall back to their filename season, else
 * Extras. Loose files directly under the ROOT (no show folder) are ignored -- a
 * show must be a folder (the asserted structure).
 * @returns {{episodes: Array<{filePath, showPath, showName, folderSeason}>, erroredDirs: string[]}}
 */
function walkShowsRoot(root, erroredDirs) {
  const episodes = [];
  let showEntries;
  try {
    showEntries = fs.readdirSync(root, { withFileTypes: true });
  } catch (err) {
    console.warn(`tv: skipping unreadable root ${root}: ${err && err.code}`);
    if (Array.isArray(erroredDirs)) erroredDirs.push(root);
    return { episodes, erroredDirs: erroredDirs || [] };
  }
  for (const showEnt of showEntries) {
    if (!showEnt.isDirectory() || showEnt.name === TRASH_DIR_NAME) continue;
    const showPath = path.join(root, showEnt.name);
    const showName = showEnt.name;
    let inner;
    try {
      inner = fs.readdirSync(showPath, { withFileTypes: true });
    } catch (err) {
      console.warn(`tv: skipping unreadable show ${showPath}: ${err && err.code}`);
      if (Array.isArray(erroredDirs)) erroredDirs.push(showPath);
      continue;
    }
    for (const ent of inner) {
      const full = path.join(showPath, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === TRASH_DIR_NAME) continue;
        const folderSeason = parse.parseSeasonFolder(ent.name);
        for (const filePath of walkVideoFiles(full, erroredDirs)) {
          episodes.push({ filePath, showPath, showName, folderSeason });
        }
      } else if (ent.isFile() && TV_EXTENSIONS.has(path.extname(ent.name).toLowerCase())) {
        episodes.push({ filePath: full, showPath, showName, folderSeason: null });
      }
    }
  }
  return { episodes, erroredDirs: erroredDirs || [] };
}

/**
 * Find a show-folder poster file, or null. Pure fs read; unreadable dir -> null.
 * First match in POSTER_BASENAMES x POSTER_EXTS preference order, case-insensitive.
 */
function findShowPoster(showDir) {
  let names;
  try {
    names = fs.readdirSync(showDir);
  } catch {
    return null;
  }
  const lowerToActual = new Map();
  for (const n of names) lowerToActual.set(n.toLowerCase(), n);
  for (const base of POSTER_BASENAMES) {
    for (const ext of POSTER_EXTS) {
      const actual = lowerToActual.get(base + ext);
      if (actual) return path.join(showDir, actual);
    }
  }
  return null;
}

/**
 * Phase-1 of a scan: walk every EXISTING root, build the next episodes map against
 * a snapshot of the previous one (unchanged path+size = reuse, incl. resolved
 * fields), and probe new/changed files for duration/codec. Pure apart from fs
 * READS and the injected `probe`; the caller owns thumbnail WRITES, the db merge,
 * and the prune.
 *
 * @param {string[]} folders configured Shows roots
 * @param {Object<string,object>} previousEpisodes snapshot of db.tv.episodes
 * @param {{ getId: (fp:string)=>string, getShowId: (showPath:string)=>string,
 *           probe?: (fp:string)=>Promise<{durationSec?:number, codec?:string, container?:string}|null> }} deps
 * @returns {Promise<{episodes, survivingIds:Set<string>, missingRoots:string[], erroredDirs:string[]}>}
 */
async function collectEpisodes(folders, previousEpisodes, deps) {
  const getId = deps && deps.getId;
  const getShowId = deps && deps.getShowId;
  const probe = deps && deps.probe;
  const episodes = {};
  const survivingIds = new Set();
  const missingRoots = [];
  const erroredDirs = [];
  const prev = previousEpisodes || {};
  let processed = 0;

  for (const root of Array.isArray(folders) ? folders : []) {
    if (typeof root !== 'string' || root === '') continue;
    if (!fs.existsSync(root)) { missingRoots.push(root); continue; }
    const walked = walkShowsRoot(root, erroredDirs);
    for (const item of walked.episodes) {
      processed += 1;
      if (processed % TV_SCAN_YIELD_BATCH === 0) {
        await new Promise((resolve) => setImmediate(resolve));
      }
      const filePath = item.filePath;
      let stat;
      try {
        stat = await fs.promises.stat(filePath);
      } catch {
        continue; // vanished mid-walk
      }
      const id = getId(filePath);
      survivingIds.add(id);
      const existing = prev[id];
      if (existing && existing.filePath === filePath && existing.size === stat.size) {
        episodes[id] = existing; // unchanged: reuse resolved fields
        continue;
      }
      const parsed = parse.parseEpisodeFilename(path.basename(filePath));
      // Folder season wins when the folder IS a recognized season; else the
      // filename's season, else null (Extras).
      const seasonNum = (item.folderSeason != null) ? item.folderSeason : parsed.seasonNum;
      let probed = null;
      if (typeof probe === 'function') {
        try { probed = await probe(filePath); } catch { probed = null; }
      }
      const record = {
        id,
        filePath,
        rootFolder: root,
        showId: getShowId(item.showPath),
        showPath: item.showPath,
        showName: item.showName,
        seasonNum,
        episodeNum: parsed.episodeNum,
        title: parsed.title,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        addedAt: (existing && existing.addedAt) || new Date().toISOString(),
        ext: path.extname(filePath).toLowerCase(),
        durationSec: probed && Number.isFinite(probed.durationSec) ? probed.durationSec : 0,
        codec: probed && typeof probed.codec === 'string' ? probed.codec : null,
        audioCodec: probed && typeof probed.audioCodec === 'string' ? probed.audioCodec : null,
        container: probed && typeof probed.container === 'string' ? probed.container : null,
        thumb: (existing && existing.thumb) || null,
      };
      episodes[id] = record;
    }
  }
  return { episodes, survivingIds, missingRoots, erroredDirs };
}

/**
 * Pure: the episodes that still need a generated thumbnail (one PER EPISODE,
 * unlike music's per-album art) -- those whose thumb file does not yet exist.
 * `thumbExists(id)` reports whether the cached thumbnail is already on disk.
 * @returns {Array<{id, filePath}>}
 */
function selectThumbJobs(episodes, thumbExists) {
  const jobs = [];
  for (const id of Object.keys(episodes || {})) {
    const ep = episodes[id];
    if (!ep || typeof ep.filePath !== 'string') continue;
    if (typeof thumbExists === 'function' && thumbExists(id)) continue;
    jobs.push({ id, filePath: ep.filePath });
  }
  return jobs;
}

module.exports = {
  TV_EXTENSIONS,
  POSTER_BASENAMES,
  POSTER_EXTS,
  walkVideoFiles,
  walkShowsRoot,
  findShowPoster,
  collectEpisodes,
  selectThumbJobs,
};
