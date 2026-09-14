'use strict';

// lib/tv/scanRunner.js - ONE pass of the Shows scan (the walk, the merge into
// the tv tables with the mount-loss guard, the pruned episodes' per-user and
// thumbnail hygiene, and the per-episode thumbnail pass), moved VERBATIM out
// of server.js in Wave 7b, slice S4, of the relational-migration arc
// (docs/exec-plans/active/2026-09-13-sqlite-relational-migration.md). The body
// is byte-identical to server.js's `runTvScan`; its free identifiers resolve
// from the `deps` bundle the factory closes over.
//
// A factory rather than a registerRoutes module because the pass needs its
// collaborators bound once at boot, and because only the PASS moved: its
// caller `scanTv` stays in server.js, where it owns `tvScanState`, the single
// deferred-rescan timer and the MAX_RESCAN_FOLLOWUPS budget, is called by the
// media scan's timer and the boot path as well as by the Shows routes, and is
// exported. `runTvScan` had exactly one caller (scanTv); server.js exported it
// for parity, and keeps exporting the SAME function object this factory
// returns (the scan-helpers-extraction re-export posture).
//
// The probe and the thumbnail helpers (probeTvEpisode, tvThumbPath,
// tvThumbExists, extractTvThumb) stay in server.js and cross as deps:
// probeTvEpisode is exported, and tvThumbPath is read by lib/tv/routes.js too.

function createTvScanRunner(deps) {
  const {
    extractTvThumb,
    fs,
    getMediaId,
    probeTvEpisode,
    settingsStore,
    tvDb,
    tvScan,
    tvStore,
    tvThumbExists,
    tvThumbPath,
    updateDatabase,
    userStore,
  } = deps;

  async function runTvScan() {
    const scanSettings = settingsStore.get(); // Wave 4: captured with the snapshot
    const ns = tvDb.read(); // Wave 5: the Phase-1 snapshot comes from the tables (no doc snapshot needed)
    const folders = ns.folders.slice();
    if (folders.length === 0 && Object.keys(ns.episodes).length === 0) return; // Shows-less: total no-op
    const { episodes, survivingIds, missingRoots, erroredDirs } = await tvScan.collectEpisodes(
      folders, ns.episodes, { getId: getMediaId, getShowId: getMediaId, probe: probeTvEpisode });
    for (const root of missingRoots) {
      console.warn(`tv: configured folder is missing/unmounted -- nothing under it will be pruned: ${root}`);
    }

    const pruneMissing = !!scanSettings.pruneMissing;
    const prunedIds = [];
    let finalEpisodes = episodes;
    // Wave 5: the merge runs against a FRESH holder and its diff (changed +
    // pruned episode rows only) rides the doc commit's transaction.
    await updateDatabase(() => tvDb.mutate((holder) => {
      const freshNs = tvStore.ensureTv(holder); // the LIVE rows, read inside the lock
      // The music/books Option-C mount-loss guard: a root that still EXISTS but
      // yielded ZERO files this pass while the library previously had episodes under
      // it is the unmounted-share signature -- treat as VANISHED (prune nothing).
      const effectiveMissingRoots = new Set(missingRoots);
      for (const root of folders) {
        if (effectiveMissingRoots.has(root)) continue;
        const hadEpisodes = Object.values(freshNs.episodes).some((e) => e && e.rootFolder === root);
        const hasSurvivors = Object.values(episodes).some((e) => e && e.rootFolder === root);
        if (hadEpisodes && !hasSurvivors) {
          effectiveMissingRoots.add(root);
          console.warn(`tv: root ${root} exists but scanned EMPTY while the library has episodes under it -- treating as unmounted, pruning nothing beneath it`);
        }
      }
      const prunable = new Set(tvStore.selectPrunableEpisodeIds(freshNs.episodes, survivingIds, { missingRoots: effectiveMissingRoots, pruneMissing, erroredDirs }));
      const next = {};
      for (const [id, e] of Object.entries(episodes)) next[id] = e;
      for (const [id, e] of Object.entries(freshNs.episodes)) {
        if (next[id]) continue;
        if (prunable.has(id)) { prunedIds.push(id); continue; }
        next[id] = e; // non-surviving but protected (mount-loss / pruneMissing off)
      }
      freshNs.episodes = next;
      finalEpisodes = next;
      return true;
    }));

    // Per-user episode state is episode-id-keyed -- pruned episodes shed
    // progress/played/liked (post-commit, the removeMusicState posture).
    if (prunedIds.length > 0) {
      try { userStore.removeTvEpisodeState(prunedIds); }
      catch (err) { console.error('tv: failed to prune per-user episode state (continuing):', err && err.message); }
    }

    // Per-episode thumbnails for surviving episodes that still lack one (best-effort).
    try {
      for (const job of tvScan.selectThumbJobs(finalEpisodes, tvThumbExists)) {
        const ep = finalEpisodes[job.id];
        await extractTvThumb({ id: job.id, filePath: job.filePath, durationSec: ep && ep.durationSec });
      }
    } catch (err) {
      console.error('tv: thumbnail extraction pass failed (continuing):', err && err.message);
    }

    // A pruned episode's cached thumbnail is regenerable, but shed it now so a
    // re-added same-path file doesn't serve a stale frame.
    for (const id of prunedIds) {
      try { fs.unlinkSync(tvThumbPath(id)); } catch (_) { /* best-effort / absent */ }
    }
  }

  return { runTvScan };
}

module.exports = { createTvScanRunner };
