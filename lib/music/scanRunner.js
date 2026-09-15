'use strict';

// lib/music/scanRunner.js - ONE pass of the music scan (the walk + probe, the
// merge into the music tables, the per-user state prune, and the pruned
// tracks' album-art / cached-rendition hygiene), moved VERBATIM out of
// server.js in Wave 7b, slice S3, of the relational-migration arc
// (docs/exec-plans/completed/2026-09-13-sqlite-relational-migration.md). The body
// is byte-identical to server.js's `runMusicScan`; its free identifiers resolve
// from the `deps` bundle the factory closes over. The S2 lib/books/scanRunner.js
// shape, for the same reasons.
//
// A factory rather than a registerRoutes module because the pass needs its
// collaborators bound once at boot, and because only the PASS moved: its caller
// `scanMusic` stays in server.js, where it owns musicScanState, the single
// deferred-rescan timer and the MAX_RESCAN_FOLLOWUPS budget, is called by the
// media-scan timer, the boot path and POST /api/music/{config,scan}, and is
// re-exported for the integration tests. `runMusicScan` itself had exactly one
// referrer (scanMusic) and was never exported, which is what made it separable.
//
// probeMusicTrack and extractAlbumArt DID have this pass as their only referrer,
// and they still STAY in server.js: both read `ffmpegAvailable`, a mutable `let`
// the boot-time `exec('ffmpeg -version')` callback flips to true after this
// factory has already run, so a destructured copy would freeze them at
// false - the probe would return null for every track and the album-art
// extraction would skip every embedded cover on a machine that HAS ffmpeg. They
// cross as deps, which keeps the seam live with no token deviation here.

function createMusicScanRunner(deps) {
  const {
    ALBUMART_DIR,
    albumArtExists,
    audioPath,
    extractAlbumArt, // stays in server.js: reads the mutable ffmpegAvailable
    fs,
    getMediaId,
    musicDb,
    musicScan,
    musicStore,
    path,
    probeMusicTrack, // stays in server.js: reads the mutable ffmpegAvailable
    settingsStore,
    updateDatabase,
    userStore,
  } = deps;

  async function runMusicScan() {
    const scanSettings = settingsStore.get(); // Wave 4: captured with the snapshot
    const ns = musicDb.read(); // Wave 5: the Phase-1 snapshot comes from the tables
    const folders = ns.folders.slice();
    if (folders.length === 0 && Object.keys(ns.tracks).length === 0) return; // music-less: total no-op
    const { tracks, survivingIds, missingRoots, erroredDirs } = await musicScan.collectTracks(folders, ns.tracks, { getMediaId, probe: probeMusicTrack });
    for (const root of missingRoots) {
      console.warn(`music: configured folder is missing/unmounted -- nothing under it will be pruned: ${root}`);
    }

    const pruneMissing = !!scanSettings.pruneMissing;
    const prunedIds = [];
    const prunedRecords = [];
    let finalTracks = tracks;
    // Wave 5: the merge runs against a FRESH holder; the diff rides the doc commit.
    await updateDatabase(() => musicDb.mutate((holder) => {
      const freshNs = musicStore.ensureMusic(holder);
      // The books/media Option-C mount-loss guard, applied to music: a root
      // whose directory still exists but yielded ZERO files this pass while the
      // library previously had tracks under it is the unmounted-share signature
      // -- treat as VANISHED (prune nothing beneath it), never a bulk deletion.
      const effectiveMissingRoots = new Set(missingRoots);
      for (const root of folders) {
        if (effectiveMissingRoots.has(root)) continue;
        const hadTracks = Object.values(freshNs.tracks).some((t) => t && t.rootFolder === root);
        const hasSurvivors = Object.values(tracks).some((t) => t && t.rootFolder === root);
        if (hadTracks && !hasSurvivors) {
          effectiveMissingRoots.add(root);
          console.warn(`music: root ${root} exists but scanned EMPTY while the library has tracks under it -- treating as unmounted, pruning nothing beneath it`);
        }
      }
      const prunable = new Set(musicStore.selectPrunableTrackIds(freshNs.tracks, survivingIds, { missingRoots: effectiveMissingRoots, pruneMissing, erroredDirs }));
      const next = {};
      for (const [id, t] of Object.entries(tracks)) next[id] = t;
      for (const [id, t] of Object.entries(freshNs.tracks)) {
        if (next[id]) continue;
        if (prunable.has(id)) {
          prunedIds.push(id);
          prunedRecords.push(t); // captured for the orphaned-art sweep
          continue;
        }
        next[id] = t; // non-surviving but protected (mount-loss / pruneMissing off)
      }
      freshNs.tracks = next;
      finalTracks = next;
      return true;
    }));

    // Per-user music state is track-id-keyed -- pruned tracks shed liked/progress
    // and null any resume pointer that referenced them (post-commit, the
    // removeMediaState posture; one transaction).
    if (prunedIds.length > 0) {
      try {
        userStore.removeMusicState(prunedIds);
      } catch (err) {
        console.error('music: failed to prune per-user music state (continuing):', err && err.message);
      }
    }

    // Album art for surviving albums that still lack an art file (best-effort).
    try {
      for (const job of musicScan.selectAlbumArtJobs(finalTracks, albumArtExists)) {
        await extractAlbumArt(job);
      }
    } catch (err) {
      console.error('music: album-art extraction pass failed (continuing):', err && err.message);
    }

    // Orphaned album art: unlink ONLY when an album's LAST track was pruned
    // (selectOrphanedArtKeys excludes any key a surviving track still references).
    for (const key of musicScan.selectOrphanedArtKeys(prunedRecords, finalTracks)) {
      for (const ext of ['.jpg', '.png']) {
        try { fs.unlinkSync(path.join(ALBUMART_DIR, `${key}${ext}`)); } catch (_) { /* best-effort */ }
      }
    }
    // A pruned track's cached ALAC rendition (audioPath) is regenerable, but
    // shed it now so a re-added same-name file doesn't serve a stale rendition.
    for (const id of prunedIds) {
      try { fs.unlinkSync(audioPath(id)); } catch (_) { /* best-effort / absent */ }
    }
  }

  return { runMusicScan };
}

module.exports = { createMusicScanRunner };
