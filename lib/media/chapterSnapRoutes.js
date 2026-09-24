'use strict';

// Chapter Snap (Dean 2026-09-24): the four routes behind the chapter
// time editor. Every one is a LIBRARY WRITE surface or reads one (the scan
// spends server CPU on a file, the GET exposes chapter titles and times of an
// item), so every one carries the SAME two gates as the text chapter editor
// (POST /api/videos/:id/chapters): requireModifyLibrary FIRST (403), then the
// per-user visibility gate (404, never an oracle for a restricted id). The
// visibility gate is RE-CHECKED on the fresh record inside every write's
// updateDatabase tick (a restriction added while the request waited counts).
//
//   GET  /api/videos/:id/chapter-snap         the editor's seed (from STORAGE)
//   POST /api/videos/:id/chapter-snap/scan    start (or join) the silence scan
//   POST /api/videos/:id/chapter-snap         save new start times (times only)
//   POST /api/videos/:id/chapter-snap/revert  back to the source chapters
//
// A save or revert carries the `version` the editor was seeded with; a record
// that changed since is refused with 409 inside the write tick, so a stale
// editor can never overwrite newer chapters. The token covers the stored manual
// list, the resolved list and - for a snap edit - the REVERT TARGET (the source
// chapters), so another tab's save, a text-editor save, a revert AND a reheat
// that re-pulled the source all change it (lib/media/chapterSnap.js
// chaptersVersion; gate r1 adversary W2). A save may change start times ONLY: the chapter
// count, order and titles are the stored ones (likes and progress are keyed
// `<mediaId>::c<n>`).

const snap = require('./chapterSnap');

function registerChapterSnapRoutes(app, deps) {
  const {
    requireModifyLibrary,
    restrictedVideoMutation,
    mediaVisibleTo,
    getCachedDatabase,
    updateDatabase,
    resolveItemChapters,
    settingsStore,
    silenceService,
    maxChapters, // server.js MAX_CHAPTERS - the one chapter-count cap (gate r1 qa S7)
  } = deps;

  function ownItem(db, id) {
    return db && db.metadata && Object.prototype.hasOwnProperty.call(db.metadata, id) ? db.metadata[id] : null;
  }
  function usableId(id) {
    return typeof id === 'string' && id !== '' && !id.includes('\u0000');
  }
  // The shared gate prefix. Returns the cached item or null (a response was sent).
  function gate(req, res) {
    if (!requireModifyLibrary(req, res)) return null; // write-RBAC, first
    if (restrictedVideoMutation(req, res, req.params.id)) return null; // 404 for a restricted item
    if (!usableId(req.params.id)) { res.status(404).json({ error: 'Media file not found' }); return null; }
    // restrictedVideoMutation above already applied mediaVisibleTo to this SAME cached
    // record (one synchronous read); the write routes re-check on the FRESH record.
    const item = ownItem(getCachedDatabase(), req.params.id);
    if (!item) { res.status(404).json({ error: 'Media file not found' }); return null; }
    return item;
  }
  function leadIn() {
    return snap.clampLeadIn(settingsStore.getKey('chapterSnapLeadInSec'));
  }

  // The editor state, built from the stored record. Suggestions only once the
  // silence scan for THIS file (size + mtime) is cached.
  function editorState(item) {
    const resolved = resolveItemChapters(item);
    const edited = snap.isSnapEdited(item);
    const plan = edited ? snap.planRevert(item, resolveItemChapters) : null;
    const silence = silenceService.stateFor(item);
    const duration = Number(item.duration) || null;
    let suggestions = null;
    let snapAll = null;
    const leadInSec = leadIn();
    if (silence.state === 'ready' && resolved.chapters.length >= 2) {
      suggestions = snap.suggestSnaps(resolved.chapters, silence.silences, { leadInSec, durationSec: duration });
      snapAll = snap.snapAllStarts(resolved.chapters, suggestions, duration);
    }
    return {
      id: item.id,
      title: item.title || item.name || '',
      type: item.type,
      duration,
      version: snap.chaptersVersion(item, resolveItemChapters),
      minGapSec: snap.MIN_CHAPTER_GAP_SEC, // the nudge clamp's gap - ONE source (gate r1 qa S7)
      chaptersSource: resolved.chaptersSource,
      edited,
      chapters: snap.editorRows(item, resolved),
      revert: plan ? { source: plan.chaptersSource, count: plan.count } : null,
      leadInSec,
      silence: { state: silence.state, error: silence.error || undefined, gaps: silence.silences ? silence.silences.length : undefined },
      suggestions,
      snapAll,
    };
  }

  app.get('/api/videos/:id/chapter-snap', (req, res) => {
    const item = gate(req, res);
    if (!item) return;
    res.json(editorState(item));
  });

  app.post('/api/videos/:id/chapter-snap/scan', (req, res) => {
    const item = gate(req, res);
    if (!item) return;
    if (resolveItemChapters(item).chapters.length < 2) {
      return res.status(400).json({ error: 'This item needs at least two chapters to fix their times.' });
    }
    const outcome = silenceService.start(item);
    if (outcome === 'unavailable') return res.status(409).json({ error: 'The file for this item is not available right now.' });
    if (outcome === 'busy') return res.status(429).json({ error: 'The server is already finding silence in other files. Try again in a minute.' });
    res.status(outcome === 'ready' ? 200 : 202).json({ state: outcome });
  });

  // Shared write-tick prologue: the fresh record, re-gated, version-checked.
  function freshForWrite(db, req, version, outcome) {
    const item = ownItem(db, req.params.id);
    if (!item || !mediaVisibleTo(req, item)) { outcome.status = 404; outcome.body = { error: 'Media file not found' }; return null; }
    const resolved = resolveItemChapters(item);
    if (typeof version !== 'string' || version !== snap.chaptersVersion(item, resolveItemChapters)) {
      outcome.status = 409;
      outcome.body = { error: 'These chapters changed since the editor opened. Reload the editor to see the current times.', stale: true };
      return null;
    }
    return { item, resolved };
  }

  app.post('/api/videos/:id/chapter-snap', async (req, res) => {
    if (!gate(req, res)) return;
    const body = req.body || {};
    if (!Array.isArray(body.starts) || body.starts.length > maxChapters) {
      return res.status(400).json({ error: 'starts must be an array of chapter start times (seconds).' });
    }
    const outcome = { status: 0, body: null };
    try {
      await updateDatabase((db) => {
        const fresh = freshForWrite(db, req, body.version, outcome);
        if (!fresh) return false;
        const checked = snap.validateSnapStarts(fresh.resolved.chapters, body.starts, fresh.item.duration);
        if (!checked.ok) { outcome.status = 400; outcome.body = { error: checked.error }; return false; }
        fresh.item.chaptersManual = snap.buildSnappedManual(fresh.item, fresh.resolved, checked.starts);
        const after = resolveItemChapters(fresh.item);
        outcome.status = 200;
        outcome.body = { success: true, chapters: after.chapters, chaptersSource: after.chaptersSource, chaptersEdited: true, version: snap.chaptersVersion(fresh.item, resolveItemChapters) };
        return true;
      });
    } catch (err) {
      console.error(`Error saving snapped chapters for ${req.params.id}:`, err);
      return res.status(500).json({ error: `Could not save chapters: ${err.message}` });
    }
    res.status(outcome.status || 500).json(outcome.body || { error: 'Could not save chapters.' });
  });

  app.post('/api/videos/:id/chapter-snap/revert', async (req, res) => {
    if (!gate(req, res)) return;
    const body = req.body || {};
    const outcome = { status: 0, body: null };
    try {
      await updateDatabase((db) => {
        const fresh = freshForWrite(db, req, body.version, outcome);
        if (!fresh) return false;
        // Seeded from STORAGE: the plan reads the persisted record in this tick.
        const plan = snap.planRevert(fresh.item, resolveItemChapters);
        if (!plan) { outcome.status = 409; outcome.body = { error: 'These chapters have no corrected times to revert.' }; return false; }
        if (plan.damaged) { outcome.status = 409; outcome.body = { error: 'The saved source times are out of order, so they cannot be restored here. Use the text editor.' }; return false; }
        const from = fresh.resolved.chapters.length;
        if (plan.count !== from && body.allowCountChange !== true) {
          outcome.status = 409;
          outcome.body = { error: `The source now has ${plan.count} chapters, not ${from}. Reverting changes the chapter count and takes the source's titles too, so liked chapters can move to a different song.`, countChange: { from, to: plan.count } };
          return false;
        }
        if (plan.restore) fresh.item.chaptersManual = plan.restore;
        else delete fresh.item.chaptersManual;
        const after = resolveItemChapters(fresh.item);
        outcome.status = 200;
        outcome.body = { success: true, chapters: after.chapters, chaptersSource: after.chaptersSource, chaptersEdited: false, version: snap.chaptersVersion(fresh.item, resolveItemChapters) };
        return true;
      });
    } catch (err) {
      console.error(`Error reverting chapters for ${req.params.id}:`, err);
      return res.status(500).json({ error: `Could not revert chapters: ${err.message}` });
    }
    res.status(outcome.status || 500).json(outcome.body || { error: 'Could not revert chapters.' });
  });
}

module.exports = { registerChapterSnapRoutes };
