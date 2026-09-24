'use strict';

// Chapter Snap (v1.319, Dean 2026-09-24): the PURE core of the chapter-time
// editor. A chaptered album often starts a chapter in dead air, or while the
// previous song is still fading out. One ffmpeg `silencedetect` pass over the
// file finds the quiet stretches; each boundary is offered a snapped start at
// the end of the nearest silence, minus a short lead-in, and the user nudges,
// auditions and saves.
//
// TIMES ONLY. The editor never adds, removes, reorders or renames a chapter:
// a liked chapter is keyed `<mediaId>::c<n>` by its INDEX in the resolved list
// (lib/music/libraryAudio.js chapterTrackId), so the chapter COUNT and ORDER
// are the invariant every function below protects.
//
// PERSISTENCE: a save writes the existing `chaptersManual` field (manual wins
// at serve time, the scan carries it forward, the Phase-2 merge mirrors it,
// the backup bundle carries items verbatim). No new per-item field: the
// "edited by snap" provenance rides INSIDE each chaptersManual element as two
// extra keys, `snapFrom` (the start time the editor began from) and
// `snapBase` (which source that list came from). Anything that carries
// chaptersManual carries the provenance with it, and the text editor's save
// (a full manual replace) drops it, which is correct: a typed list is plain
// manual chapters again.
//
// No fs, no spawn, no server state: required by lib/media/chapterSnapRoutes.js
// and the unit tests directly.

const crypto = require('node:crypto');

const LEAD_IN_DEFAULT_SEC = 0.25;
const LEAD_IN_MIN_SEC = 0;
const LEAD_IN_MAX_SEC = 2;
// How far from a boundary a silence may sit and still count as ITS gap: a
// little before (a chapter that starts late, after the music began) and more
// after (a chapter that starts in the previous song's fade-out, then the gap).
const WINDOW_BEFORE_SEC = 8;
const WINDOW_AFTER_SEC = 12;
// A suggestion closer than this to the current time is "already fine".
const FINE_EPSILON_SEC = 0.1;
// The smallest gap a nudge may leave between two chapter starts (client
// clamp; the server's rule is only "strictly after").
const MIN_CHAPTER_GAP_SEC = 0.1;
const MAX_START_SEC = 7 * 24 * 3600; // the ceiling for a start when the duration is unknown

const SNAP_BASES = new Set(['embedded', 'description', 'manual']);

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

// The server-wide lead-in, clamped at READ time as well as at the settings
// write (a restored backup bundle writes settings keys generically).
function clampLeadIn(v) {
  const n = Number(v);
  if (typeof v !== 'number' || !Number.isFinite(n)) return LEAD_IN_DEFAULT_SEC;
  return Math.min(LEAD_IN_MAX_SEC, Math.max(LEAD_IN_MIN_SEC, Math.round(n * 100) / 100));
}

function isValidLeadIn(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= LEAD_IN_MIN_SEC && v <= LEAD_IN_MAX_SEC;
}

// True when the item's manual chapters were written by THIS editor: every
// element carries a finite `snapFrom` and the same known `snapBase`. A
// partial or mixed list is NOT a snap edit (fail closed: no Revert offered).
function isSnapEdited(item) {
  const cm = item && item.chaptersManual;
  if (!Array.isArray(cm) || cm.length === 0) return false;
  const base = cm[0] && cm[0].snapBase;
  if (!SNAP_BASES.has(base)) return false;
  return cm.every((e) => e && typeof e === 'object'
    && typeof e.snapFrom === 'number' && Number.isFinite(e.snapFrom) && e.snapFrom >= 0
    && e.snapBase === base);
}

// The editor's optimistic-concurrency token: a hash of everything a save or a
// revert is based on - the stored manual list (provenance included), the
// resolved list with its source, AND (for a snap edit) the revert TARGET, i.e.
// the source chapters a revert would land on (gate r1, adversary W2: under a snap
// edit the resolved list IS the manual list, so without the target a reheat that
// re-pulled the source between "the confirm named N chapters" and "Revert" left
// the token unchanged and the revert landed on chapters nobody confirmed). A
// save, revert or text save whose token no longer matches is refused.
function chaptersVersion(item, resolveItemChapters) {
  const resolved = resolveItemChapters(item);
  const manual = item && Array.isArray(item.chaptersManual) ? item.chaptersManual : null;
  const plan = isSnapEdited(item) ? planRevert(item, resolveItemChapters) : null;
  const target = plan ? [plan.chaptersSource, plan.chapters] : null;
  const payload = JSON.stringify([manual, resolved.chaptersSource, resolved.chapters, target]);
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

// A TEXT save of a snap edit (the text editor's POST) keeps the provenance when it
// changed titles only - the same count and every start within half a millisecond -
// so "Edited" and Revert survive a rename. Any time or count change returns the
// parsed list as-is: a plain typed list (the stated rule; gate r1 adversary W1).
function carrySnapProvenance(item, parsed) {
  if (!isSnapEdited(item) || !Array.isArray(parsed) || parsed.length !== item.chaptersManual.length) return parsed;
  const cm = item.chaptersManual;
  for (let i = 0; i < parsed.length; i += 1) {
    if (!(Math.abs(Number(parsed[i].startTime) - Number(cm[i].startTime)) < 0.0005)) return parsed;
  }
  return parsed.map((c, i) => ({ startTime: cm[i].startTime, title: c.title, snapFrom: cm[i].snapFrom, snapBase: cm[i].snapBase }));
}

// The distance from a time to a silence interval (0 inside it).
function distanceTo(t, s) {
  if (t < s.start) return s.start - t;
  if (t > s.end) return t - s.end;
  return 0;
}

// One suggestion per chapter. `chapters` = the resolved list (ascending),
// `silences` = [{start, end}] from the cache. Chapter 1 never moves.
//   status 'first'   - chapter 1, always where it is
//   status 'suggest' - a snapped time differs from the current one
//   status 'fine'    - the snap lands where the chapter already starts
//   status 'no-gap'  - no silence near this boundary (a gapless album), or
//                      the only nearby silence would cross a neighbour
// `reason` on a suggestion: 'silence' (the start sits inside the quiet gap),
// 'tail' (it sits before the gap, in the previous song's ending), 'late' (it
// sits after the gap, once the music has begun).
function suggestSnaps(chapters, silences, opts) {
  const o = opts || {};
  const leadIn = clampLeadIn(o.leadInSec);
  const dur = Number(o.durationSec);
  const list = Array.isArray(chapters) ? chapters : [];
  const sil = Array.isArray(silences) ? silences : [];
  const out = [];
  for (let i = 0; i < list.length; i += 1) {
    const b = Number(list[i].startTime);
    if (i === 0) { out.push({ index: 0, status: 'first', time: b }); continue; }
    // Every in-window silence, nearest first; the first whose snapped start
    // lands strictly between the neighbours wins (gate r1 qa S9: the nearest
    // one crossing a neighbour no longer hides a valid next one).
    const cands = [];
    for (const s of sil) {
      if (!(s.end >= b - WINDOW_BEFORE_SEC && s.start <= b + WINDOW_AFTER_SEC)) continue;
      cands.push({ s, d: distanceTo(b, s) });
    }
    if (cands.length === 0) { out.push({ index: i, status: 'no-gap', time: null }); continue; }
    cands.sort((x, y) => (x.d - y.d) || (Math.abs(x.s.end - b) - Math.abs(y.s.end - b)));
    const prev = Number(list[i - 1].startTime);
    const next = i + 1 < list.length ? Number(list[i + 1].startTime) : (Number.isFinite(dur) && dur > 0 ? dur : Infinity);
    let best = null;
    let t = null;
    for (const c of cands) {
      const tc = round3(Math.max(c.s.start, c.s.end - leadIn));
      if (tc > prev && tc < next) { best = c.s; t = tc; break; }
    }
    if (!best) { out.push({ index: i, status: 'no-gap', time: null }); continue; }
    if (Math.abs(t - b) < FINE_EPSILON_SEC) { out.push({ index: i, status: 'fine', time: t }); continue; }
    const reason = (b >= best.start && b <= best.end) ? 'silence' : (b < best.start ? 'tail' : 'late');
    out.push({ index: i, status: 'suggest', time: t, reason, silenceStart: round3(best.start), silenceEnd: round3(best.end) });
  }
  return out;
}

// "Snap all": every suggestion applied at once, ordering-safe. A boundary
// takes its suggestion only when it lands strictly after the (already final)
// previous start and strictly before BOTH values the next start can end up
// at (its current time and its own suggestion), so the result is strictly
// increasing by construction.
function snapAllStarts(chapters, suggestions, durationSec) {
  const list = Array.isArray(chapters) ? chapters : [];
  const sug = Array.isArray(suggestions) ? suggestions : [];
  const dur = Number(durationSec);
  const starts = list.map((c) => Number(c.startTime));
  for (let i = 1; i < list.length; i += 1) {
    const s = sug[i];
    if (!s || s.status !== 'suggest') continue;
    let upper = Number.isFinite(dur) && dur > 0 ? dur : Infinity;
    if (i + 1 < list.length) {
      upper = Number(list[i + 1].startTime);
      const ns = sug[i + 1];
      if (ns && ns.status === 'suggest') upper = Math.min(upper, ns.time);
    }
    if (s.time > starts[i - 1] && s.time < upper) starts[i] = s.time;
  }
  return starts;
}

// Validate a save's start list against the CURRENT resolved chapters.
// Returns { ok:true, starts } (rounded to the millisecond) or { ok:false, error }.
function validateSnapStarts(chapters, starts, durationSec) {
  const list = Array.isArray(chapters) ? chapters : [];
  if (list.length < 2) return { ok: false, error: 'This item needs at least two chapters to fix their times.' };
  if (!Array.isArray(starts)) return { ok: false, error: 'starts must be an array of chapter start times (seconds).' };
  if (starts.length !== list.length) {
    return { ok: false, error: `Chapter times only: expected ${list.length} start times, got ${starts.length}. Adding or removing chapters is done in the text editor.` };
  }
  const out = [];
  for (let i = 0; i < starts.length; i += 1) {
    const v = starts[i];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return { ok: false, error: `Chapter ${i + 1}: the start time must be a number of seconds.` };
    out.push(round3(v));
  }
  if (out[0] !== round3(Number(list[0].startTime))) return { ok: false, error: 'The first chapter always keeps its start.' };
  for (let i = 1; i < out.length; i += 1) {
    if (!(out[i] > out[i - 1])) return { ok: false, error: `Chapter ${i + 1} must start after chapter ${i}.` };
  }
  const dur = Number(durationSec);
  // The file end bounds the last start; with no known duration, a week is the
  // sanity ceiling (no absurd value is ever stored).
  const end = Number.isFinite(dur) && dur > 0 ? dur : MAX_START_SEC;
  if (!(out[out.length - 1] < end)) {
    return { ok: false, error: `Chapter ${out.length} must start before the end of the file.` };
  }
  return { ok: true, starts: out };
}

// The chaptersManual list a save writes: the CURRENT titles (never the
// client's), the new starts, and the provenance. A re-edit of a snap edit
// keeps the ORIGINAL base (snapFrom/snapBase from the first edit), so Revert
// always goes back to what the editor first started from.
function buildSnappedManual(item, resolved, starts) {
  const chapters = resolved.chapters;
  let base;
  let baseSource;
  if (isSnapEdited(item)) {
    base = item.chaptersManual.map((e) => e.snapFrom);
    baseSource = item.chaptersManual[0].snapBase;
  } else {
    base = chapters.map((c) => Number(c.startTime));
    baseSource = resolved.chaptersSource;
  }
  return chapters.map((c, i) => ({
    startTime: starts[i],
    title: typeof c.title === 'string' ? c.title : '',
    snapFrom: base[i],
    snapBase: baseSource,
  }));
}

// What "Revert to source chapters" would do, computed from STORAGE (the
// persisted item), never from any on-screen list:
//   - base 'manual' (the list was typed in the text editor, then snapped):
//     restore those typed start times, titles unchanged;
//   - base 'embedded'/'description': drop the manual list, so the item
//     resolves to whatever its source says NOW (a reheat in between wins).
// Returns null when the item is not a snap edit, else
// { restore: [..] | null, chapters, chaptersSource, count, damaged }.
function planRevert(item, resolveItemChapters) {
  if (!isSnapEdited(item)) return null;
  const cm = item.chaptersManual;
  if (cm[0].snapBase === 'manual') {
    const restore = cm.map((e) => ({ startTime: e.snapFrom, title: typeof e.title === 'string' ? e.title : '' }));
    let damaged = false;
    for (let i = 1; i < restore.length; i += 1) if (!(restore[i].startTime > restore[i - 1].startTime)) damaged = true;
    return { restore, chapters: restore, chaptersSource: 'manual', count: restore.length, damaged };
  }
  const probe = Object.assign({}, item);
  delete probe.chaptersManual;
  const r = resolveItemChapters(probe);
  return { restore: null, chapters: r.chapters, chaptersSource: r.chaptersSource, count: r.chapters.length, damaged: false };
}

// The chapter list as the editor shows it: index, current start, title and
// where it started from (the snap base when edited, else itself).
function editorRows(item, resolved) {
  const edited = isSnapEdited(item);
  return resolved.chapters.map((c, i) => ({
    index: i,
    startTime: Number(c.startTime),
    title: typeof c.title === 'string' ? c.title : '',
    sourceStart: edited ? item.chaptersManual[i].snapFrom : Number(c.startTime),
  }));
}

module.exports = {
  LEAD_IN_DEFAULT_SEC,
  LEAD_IN_MIN_SEC,
  LEAD_IN_MAX_SEC,
  WINDOW_BEFORE_SEC,
  WINDOW_AFTER_SEC,
  FINE_EPSILON_SEC,
  MIN_CHAPTER_GAP_SEC,
  SNAP_BASES,
  round3,
  clampLeadIn,
  isValidLeadIn,
  isSnapEdited,
  chaptersVersion,
  carrySnapProvenance,
  suggestSnaps,
  snapAllStarts,
  validateSnapStarts,
  buildSnappedManual,
  planRevert,
  editorRows,
};
