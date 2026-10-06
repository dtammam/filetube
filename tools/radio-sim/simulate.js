#!/usr/bin/env node
'use strict';

// tools/radio-sim/simulate.js - a READ-ONLY baseline simulator for FileTube's music
// Autoplay ("radio") picker as it ships today. It opens the library database read-only,
// rebuilds the exact track list GET /api/music builds for an unrestricted (admin) viewer,
// and replays the client's end-of-queue extension many times from random seed tracks.
//
// SELF-CONTAINED on purpose: only Node built-ins (node:sqlite, the same driver the server
// uses - lib/db/sqlite.js:36), no repo-relative requires, so it runs inside the production
// container by piping it over stdin (tools/ is NOT copied into the image - Dockerfile
// COPYs only package*.json, server.js, public/, lib/, scripts/):
//
//   docker exec -i <container> node - --data /app/data < tools/radio-sim/simulate.js
//
// Every mirrored piece cites the code it copies (paths relative to the repo root):
//   picker         public/js/music.js fetchAutoplayPicks / maybeExtendQueueForAutoplay (~4165-4270)
//   list build     lib/music/routes.js GET /api/music (207-257)
//   projection     server.js projectedLibraryTracks (4209-4235) + itemChapterTracks (4192-4198)
//   shaping        lib/music/libraryAudio.js projectAudioItem / expandAudioToTracks
//   tags           lib/music/tags.js buildTrackMetadata (title/year/genre subset used here)
//   chapters       server.js resolveItemChapters (2434-2446) + deriveDescriptionChapters (2425)
//   random sort    lib/music/query.js sortTracks 'random' -> lib/videoQuery.js fisherYatesShuffle
//                  (49-57) seeded by createSeededRng (mulberry32, 67-75) via normalizeSeed (239-243)
//   artist filter  lib/music/query.js matchesArtist (track artist OR album artist, exact)
//   album key      lib/music/store.js albumKeyFor (`<albumArtist||artist>U+241F<album>`)
//
// Usage:
//   node tools/radio-sim/simulate.js [--data DIR | --db FILE] [--trials 200] [--seed 1]
//   node tools/radio-sim/simulate.js --selftest     (a SYNTHETIC library, to sanity-check the sim)
//   --picker new    runs v1.368.0's station picker (lib/music/radio.js pickRadioBatch, imported -
//                   never a copy) instead of today's; in the repo it is required directly, over stdin
//                   pipe the BUNDLE: node tools/radio-sim/bundle.js | docker exec -i <c> node - --picker new
// DATA dir default mirrors server.js:206: $DATA_DIR, else /app/data if it exists, else cwd.

const fs = require('node:fs');
const path = require('node:path');

// ---------------------------------------------------------------- args
function parseArgs(argv) {
  const out = { trials: 200, seed: 1, data: null, db: null, selftest: false, picker: 'today' };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--data') out.data = argv[++i];
    else if (a === '--db') out.db = argv[++i];
    else if (a === '--trials') out.trials = Math.max(1, parseInt(argv[++i], 10) || 200);
    else if (a === '--seed') out.seed = parseInt(argv[++i], 10) || 1;
    else if (a === '--selftest') out.selftest = true;
    else if (a === '--picker') out.picker = argv[++i] === 'new' ? 'new' : 'today';
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

// ---------------------------------------------------------------- mirrored primitives
// lib/videoQuery.js:67-75 (mulberry32) - verbatim.
function createSeededRng(seed) {
  let a = seed | 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// lib/videoQuery.js:49-57 - verbatim.
function fisherYatesShuffle(items, rng) {
  const rand = typeof rng === 'function' ? rng : Math.random;
  const arr = Array.isArray(items) ? items.slice() : [];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
// lib/videoQuery.js:239-243.
function normalizeSeed(raw) {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : undefined;
}
// lib/music/store.js albumKeyFor.
const ALBUM_KEY_SEP = '␟';
function albumKeyFor(t) {
  const artist = (typeof t.albumArtist === 'string' && t.albumArtist.trim()) || (typeof t.artist === 'string' && t.artist.trim()) || '';
  const album = (typeof t.album === 'string' && t.album.trim()) || '';
  return `${artist}${ALBUM_KEY_SEP}${album}`;
}
// lib/music/query.js matchesArtist.
function matchesArtist(t, name) {
  if (!name) return true;
  return (typeof t.artist === 'string' && t.artist === name) || (typeof t.albumArtist === 'string' && t.albumArtist === name);
}
// lib/music/tags.js parseYear (year only; title/track fields do not affect the picker).
function parseYear(raw) {
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 1000 && raw <= 9999) return raw;
  if (typeof raw !== 'string') return null;
  const m = raw.match(/(?<!\d)(\d{4})(?!\d)/);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  return (y >= 1000 && y <= 9999) ? y : null;
}
// server.js:2297-2330 + 2352-2380 + 2425-2446 (chapter resolution for projected audio).
const MAX_CHAPTERS = 300;
const CHAPTER_LINE = /^\s*[([]?\s*((?:\d{1,3}:)?\d{1,2}:\d{2})\s*[)\]]?\s*[-–—:.]?\s*(.*)$/;
function chapterTimestampToSeconds(str) {
  const parts = String(str).split(':').map(Number);
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return NaN;
  if (parts.length === 3) return (parts[0] * 60 + parts[1]) * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return NaN;
}
function normalizeChapter(startTime, rawTitle) {
  const t = Number(startTime);
  if (!Number.isFinite(t) || t < 0) return null;
  return { startTime: t, title: typeof rawTitle === 'string' ? rawTitle.trim() : '' };
}
function finalizeChapters(list) {
  const sorted = list.slice().sort((a, b) => a.startTime - b.startTime);
  const out = [];
  for (const ch of sorted) {
    if (out.length > 0 && ch.startTime === out[out.length - 1].startTime) continue;
    out.push(ch);
    if (out.length >= MAX_CHAPTERS) break;
  }
  return out;
}
function parseChapterLines(text) {
  if (typeof text !== 'string' || text === '') return [];
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const m = CHAPTER_LINE.exec(line);
    if (!m) continue;
    const secs = chapterTimestampToSeconds(m[1]);
    if (!Number.isFinite(secs)) continue;
    const ch = normalizeChapter(secs, m[2]);
    if (ch) out.push(ch);
  }
  return finalizeChapters(out);
}
function resolveItemChapters(item) {
  if (Array.isArray(item.chaptersManual) && item.chaptersManual.length > 0) return item.chaptersManual;
  if (Array.isArray(item.chapters) && item.chapters.length > 0) return item.chapters;
  const d = parseChapterLines(item.tags && item.tags.description);
  if (d.length < 2 || d[0].startTime !== 0) return [];
  return d;
}
// lib/music/tags.js buildTrackMetadata's TITLE: embedded tag, else the filename stem with a
// leading track number stripped (splitTrackAndTitle), else the bare stem, else 'Unknown'. It is
// never empty, so projectAudioItem's `|| item.title` fallback never fires.
function trackTitle(tags, filePath) {
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  const fp = typeof filePath === 'string' ? filePath : '';
  const ext = path.extname(fp);
  const stem = path.basename(fp, ext).trim();
  let conv = stem;
  let m = stem.match(/^(\d{1,2})[-.](\d{1,3})[\s._-]+(.+)$/);
  if (m) conv = m[3].trim();
  else if ((m = stem.match(/^(\d{1,3})[\s._-]+(.+)$/))) conv = m[2].trim();
  return str(tags.title) || conv || path.basename(fp, ext) || 'Unknown';
}
// lib/music/libraryAudio.js projectAudioItem (picker-relevant fields only).
function projectAudioItem(item) {
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  const tags = item.tags && typeof item.tags === 'object' ? item.tags : {};
  const artist = str(tags.artist) || item.channelName || item.folderName || 'Unknown';
  return {
    id: item.id,
    title: trackTitle(tags, item.filePath) || item.title || item.name || 'Unknown',
    artist,
    album: str(tags.album),
    albumArtist: str(tags.albumartist) || artist,
    year: parseYear(tags.date),
    genre: str(tags.genre),
    folderName: item.folderName, // the radio's T5 (same folder / channel)
    durationSec: Number(item.duration) || 0,
    fileDurationSec: Number(item.duration) || 0,
    source: 'library',
  };
}
// lib/music/libraryAudio.js expandAudioToTracks.
function expandAudioToTracks(item) {
  const base = projectAudioItem(item);
  let chapters = [];
  try { chapters = resolveItemChapters(item); } catch { chapters = []; }
  if (!Array.isArray(chapters) || chapters.length < 2) return [base];
  const fileDur = Number(item.duration) || base.durationSec || 0;
  const out = [];
  for (let i = 0; i < chapters.length; i += 1) {
    const ch = chapters[i];
    const start = Number(ch && ch.startTime);
    if (!Number.isFinite(start) || start < 0) continue;
    const next = chapters[i + 1];
    const nextStart = next ? Number(next.startTime) : NaN;
    const end = Number.isFinite(nextStart) ? nextStart : fileDur;
    out.push(Object.assign({}, base, {
      id: String(item.id) + '::c' + i,
      album: base.title,
      albumArtist: base.artist,
      durationSec: end > start ? end - start : 0,
      source: 'library-chapter',
      chapterStartSec: start,
      chapterCount: chapters.length,
    }));
  }
  return out.length >= 2 ? out : [base];
}

// ---------------------------------------------------------------- loading
function resolveDbPath(args) {
  if (args.db) return path.resolve(args.db);
  const dir = args.data ? path.resolve(args.data)
    : (process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : (fs.existsSync('/app/data') ? '/app/data' : process.cwd()));
  return path.join(dir, 'filetube.db');
}

function loadLibrary(dbPath) {
  // Silence node:sqlite's one-line ExperimentalWarning so the report stays clean.
  const origEmit = process.emitWarning;
  process.emitWarning = function (w, ...rest) { if (String(w && w.message ? w.message : w).includes('SQLite')) return; return origEmit.call(process, w, ...rest); };
  const { DatabaseSync } = require('node:sqlite');
  process.emitWarning = origEmit;
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const notes = [];
  try {
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name));
    const version = db.prepare('PRAGMA user_version').get().user_version;
    // Native music tracks: music_tracks (v28+, read ORDER BY key like lib/media/jsonRowStore.js:81).
    const tracks = {};
    if (tables.has('music_tracks')) {
      for (const r of db.prepare('SELECT track_id, json FROM music_tracks ORDER BY track_id').all()) tracks[r.track_id] = JSON.parse(r.json);
    } else notes.push(`no music_tracks table (schema v${version}): 0 native tracks`);
    // Channel opt-out marks: music_channels (v28+).
    const marks = {};
    if (tables.has('music_channels')) {
      for (const r of db.prepare('SELECT folder_name, json FROM music_channels').all()) {
        try { marks[r.folder_name] = JSON.parse(r.json); } catch { marks[r.folder_name] = r.json; }
      }
    }
    // Media index: media_items (v32+, ORDER BY rowid - lib/media/items.js:48); older: doc_kv 'metadata'.
    const metadata = {};
    if (tables.has('media_items')) {
      for (const r of db.prepare('SELECT media_id, json FROM media_items ORDER BY rowid').all()) metadata[r.media_id] = JSON.parse(r.json);
    } else if (tables.has('doc_kv')) {
      for (const r of db.prepare("SELECT key, json FROM doc_kv WHERE namespace = 'metadata' ORDER BY rowid").all()) metadata[r.key] = JSON.parse(r.json);
      notes.push(`media index read from doc_kv (pre-v32 schema v${version})`);
    }
    // Liked counts (any user) - context only, not used by today's picker.
    const count = (t) => (tables.has(t) ? db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n : 0);
    const signals = {
      musicLiked: count('user_music_liked'), mediaLiked: count('user_liked'),
      musicProgressRows: count('user_music_progress'), mediaProgressRows: count('user_progress'),
      watchedRows: count('user_watched'),
    };
    return { tracks, marks, metadata, notes, version, signals };
  } finally {
    db.close();
  }
}

// lib/music/routes.js:207-210 for an unrestricted viewer: native tracks, then the projection.
function buildList(lib) {
  const list = Object.values(lib.tracks).map((t) => Object.assign({}, t, { source: t.source || 'native', fileDurationSec: Number(t.durationSec) || 0 }));
  const nativeIds = new Set(list.map((t) => t.id));
  for (const item of Object.values(lib.metadata)) {
    if (!item || item.type !== 'audio') continue;
    if (typeof item.folderName === 'string' && lib.marks[item.folderName] === 'off') continue; // isEligibleAudioUniversal
    if (nativeIds.has(item.id)) continue;
    for (const t of expandAudioToTracks(item)) list.push(t);
  }
  return list;
}

// ---------------------------------------------------------------- the picker (music.js ~4165-4205)
const AUTOPLAY_APPEND_COUNT = 5;
const AUTOPLAY_ARTIST_MAX = 3;
function apiMusicRandom(list, seedStr, limit, artist) {
  // GET /api/music?[artist=]&sort=random&seed=&limit= (routes.js:207-257): filter, shuffle, slice.
  const filtered = artist ? list.filter((t) => matchesArtist(t, artist)) : list;
  const shuffled = fisherYatesShuffle(filtered, createSeededRng(normalizeSeed(seedStr)));
  return shuffled.slice(0, limit);
}
function fetchAutoplayPicks(cur, queue, playedIds, list, seedStr) {
  let exclude = {};
  for (const q of queue) exclude[q.id] = true;
  for (const id of playedIds) exclude[id] = true;
  const picks = [];
  const takeFrom = (items, cap) => {
    for (let k = 0; k < items.length && picks.length < cap; k++) {
      const t = items[k];
      if (!t || !t.id || exclude[t.id]) continue;
      exclude[t.id] = true;
      picks.push(Object.assign({}, t, { arm: cap === AUTOPLAY_ARTIST_MAX ? 'artist' : 'library' }));
    }
  };
  if (cur.artist) takeFrom(apiMusicRandom(list, seedStr, 30, cur.artist), AUTOPLAY_ARTIST_MAX);
  let libItems = [];
  if (picks.length < AUTOPLAY_APPEND_COUNT) {
    libItems = apiMusicRandom(list, seedStr, 60);
    takeFrom(libItems, AUTOPLAY_APPEND_COUNT);
  }
  let recycled = false;
  if (picks.length === 0 && libItems.length) {
    exclude = {};
    for (const q of queue) exclude[q.id] = true;
    takeFrom(libItems, AUTOPLAY_APPEND_COUNT);
    recycled = picks.length > 0;
  }
  return { picks, recycled };
}

// One session: queue = [seed]; every time the LAST queued track starts, append picks.
// chapterMode 'span': a chapter pick plays only its own segment (a flat menu-list queue,
// music.js enforceFlatSegmentEnd 4749-4786). 'roll': it plays from its start to the FILE end
// (any other queue: nav/continue leave soloChapter falsy, music.js:3982-3993, so nothing stops
// the file at the segment boundary; the queue advances on 'ended').
function simulateSession(list, seedTrack, rng, maxSec, chapterMode) {
  const queue = [Object.assign({}, seedTrack, { arm: 'seed' })];
  const played = [];
  const playedIds = [];
  let elapsed = 0;
  let endedEarly = false;
  let recycles = 0;
  for (let i = 0; elapsed < maxSec; i += 1) {
    if (i >= queue.length) { endedEarly = true; break; }
    const cur = queue[i];
    if (playedIds.indexOf(cur.id) === -1) playedIds.push(cur.id); // autoplayNotePlayed (loadTrack, music.js:3975)
    let dur = Number(cur.durationSec) || 0;
    if (chapterMode === 'roll' && cur.source === 'library-chapter') dur = Math.max(dur, (cur.fileDurationSec || 0) - (cur.chapterStartSec || 0));
    if (!(dur > 0)) dur = FALLBACK_DURATION_SEC;
    played.push({ t: cur, startSec: elapsed, dur });
    elapsed += dur;
    if (i === queue.length - 1) {
      const seedStr = String(Math.floor(rng() * 100000)); // client: String(Date.now() % 100000)
      const { picks, recycled } = fetchAutoplayPicks(cur, queue, playedIds, list, seedStr);
      if (recycled) recycles += 1;
      for (const p of picks) queue.push(p);
    }
  }
  return { played, endedEarly, recycles, elapsed };
}
const FALLBACK_DURATION_SEC = 210;

// ---------------------------------------------------------------- the v1.368.0 picker (--picker new)
// The REAL module: required from the repo, or from the bundle tools/radio-sim/bundle.js prepends
// (its './store' is this file's albumKeyFor mirror - the only function radio.js takes from it).
function loadRadio() {
  // eslint-disable-next-line no-undef
  if (typeof __RADIO_BUNDLE__ === 'function') return __RADIO_BUNDLE__({ albumKeyFor });
  try {
    return require(path.join(__dirname, '..', '..', 'lib', 'music', 'radio.js'));
  } catch {
    process.stderr.write('--picker new needs lib/music/radio.js: run inside the repo, or pipe the bundle (node tools/radio-sim/bundle.js)\n');
    process.exit(2);
  }
}
// One station session, the v1.368.0 client: the seed track plays, and whenever the LAST queued track
// starts the client asks for a batch against the station seed (R8: the first track, never the last),
// sending the session's plays as the exclude list (R11, last 200). A radio chapter pick stops at its
// own segment (R13), so chapters are 'span'. No likes or recency: the simulator has no viewer.
function simulateNewSession(list, seedTrack, rng, maxSec, radio, neighbours) {
  const profile = radio.buildStationProfile({ kind: 'track', value: seedTrack.id }, list);
  const queue = [Object.assign({}, seedTrack, { arm: 'seed' })];
  const played = [];
  const playedIds = [];
  let elapsed = 0;
  let endedEarly = false;
  for (let i = 0; elapsed < maxSec; i += 1) {
    if (i >= queue.length) { endedEarly = true; break; }
    const cur = queue[i];
    if (playedIds.indexOf(cur.id) === -1) playedIds.push(cur.id);
    let dur = Number(cur.durationSec) || 0;
    if (!(dur > 0)) dur = FALLBACK_DURATION_SEC;
    played.push({ t: cur, startSec: elapsed, dur });
    elapsed += dur;
    if (i === queue.length - 1) {
      const batchRng = createSeededRng(Math.floor(rng() * 4294967296));
      const picks = radio.pickRadioBatch(profile, list, { exclude: playedIds.slice(-radio.EXCLUDE_CAP), count: radio.BATCH_COUNT }, batchRng);
      const inQueue = new Set(queue.map((q) => q.id));
      for (const p of picks) if (!inQueue.has(p.id)) queue.push(Object.assign({}, p, { arm: 'radio', tier: radio.tierOf(p, profile, neighbours) }));
    }
  }
  return { played, endedEarly, recycles: 0, elapsed };
}

// ---------------------------------------------------------------- metrics
function sessionMetrics(played) {
  const n = played.length;
  const artistOf = (t) => t.artist || '';
  const counts = new Map();
  for (const p of played) counts.set(artistOf(p.t), (counts.get(artistOf(p.t)) || 0) + 1);
  let maxArtist = 0;
  for (const v of counts.values()) maxArtist = Math.max(maxArtist, v);
  const titledAlbum = (t) => ((typeof t.album === 'string' && t.album.trim()) ? albumKeyFor(t) : null);
  const albumCounts = new Map();
  let titledPlays = 0;
  for (const p of played) { const k = titledAlbum(p.t); if (k) { titledPlays += 1; albumCounts.set(k, (albumCounts.get(k) || 0) + 1); } }
  let backToBack = 0;
  let run = n ? 1 : 0; let longestRun = run;
  for (let i = 1; i < n; i += 1) {
    if (artistOf(played[i].t) === artistOf(played[i - 1].t)) { backToBack += 1; run += 1; } else run = 1;
    if (run > longestRun) longestRun = run;
  }
  // A just-played (titled) album returns within the next W tracks: positions with a titled
  // album whose next W plays include the same album key, over positions that HAVE W plays after.
  const albumReturn = (w) => {
    let hit = 0; let den = 0;
    for (let i = 0; i + w < n; i += 1) {
      const k = titledAlbum(played[i].t); if (!k) continue;
      den += 1;
      for (let j = i + 1; j <= i + w; j += 1) if (titledAlbum(played[j].t) === k) { hit += 1; break; }
    }
    return den ? hit / den : null;
  };
  const picks = played.filter((p) => p.t.arm !== 'seed');
  const chapterPicks = picks.filter((p) => p.t.source === 'library-chapter').length;
  const artistArm = picks.filter((p) => p.t.arm === 'artist').length;
  return {
    tracks: n,
    distinctArtists: counts.size,
    artistRepeats: n - counts.size,
    maxArtist,
    albumRepeats: titledPlays - albumCounts.size,
    albumReturn5: albumReturn(5),
    albumReturn10: albumReturn(10),
    backToBack,
    longestRun,
    chapterPickShare: picks.length ? chapterPicks / picks.length : null,
    artistArmShare: picks.length ? artistArm / picks.length : null,
    genreJump: genreJumpShare(played),
    farFromSeed: farFromSeedShare(played),
    farFromTaggedSeed: played.length && primaryGenre(played[0].t) ? farFromSeedShare(played) : null,
  };
}
// Dean's complaint (2026-10-06): "the random genre change is rough". Over consecutive pairs where
// BOTH tracks carry a genre, the share whose primary genre differs.
function primaryGenre(t) {
  const g = typeof t.genre === 'string' ? t.genre.split(/[;/,|]/)[0].trim().toLowerCase() : '';
  return g || null;
}
function genreJumpShare(played) {
  let den = 0; let hit = 0;
  for (let i = 1; i < played.length; i += 1) {
    const a = primaryGenre(played[i - 1].t); const b = primaryGenre(played[i].t);
    if (!a || !b) continue;
    den += 1; if (a !== b) hit += 1;
  }
  return den ? hit / den : null;
}
// Share of picks (after the seed) sharing neither the seed's artist nor its primary genre.
function farFromSeedShare(played) {
  if (!played.length) return null;
  const seed = played[0].t; const sg = primaryGenre(seed);
  const picks = played.slice(1);
  if (!picks.length) return null;
  const far = picks.filter((p) => p.t.artist !== seed.artist && (!sg || primaryGenre(p.t) !== sg)).length;
  return far / picks.length;
}
function prefixUntil(played, sec) {
  const out = [];
  for (const p of played) { if (p.startSec >= sec) break; out.push(p); }
  return out;
}
function quantile(arr, q) {
  const v = arr.filter((x) => x !== null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const idx = Math.min(v.length - 1, Math.max(0, Math.ceil(q * v.length) - 1));
  return v[idx];
}
function fmt(x, pct) {
  if (x === null || x === undefined) return 'n/a';
  if (pct) return (x * 100).toFixed(1) + '%';
  return Number.isInteger(x) ? String(x) : x.toFixed(1);
}
function pad(s, n) { s = String(s); return s.length >= n ? s : s + ' '.repeat(n - s.length); }

// ---------------------------------------------------------------- report
function libraryStats(list, lib) {
  const lines = [];
  const bySource = {};
  for (const t of list) bySource[t.source] = (bySource[t.source] || 0) + 1;
  const artists = new Map();
  for (const t of list) artists.set(t.artist || '', (artists.get(t.artist || '') || 0) + 1);
  const titledAlbums = new Set(list.filter((t) => t.album && t.album.trim()).map(albumKeyFor));
  const allAlbums = new Set(list.map(albumKeyFor));
  const chapterFiles = new Set(list.filter((t) => t.source === 'library-chapter').map((t) => String(t.id).replace(/::c\d+$/, '')));
  const per = [...artists.values()].sort((a, b) => b - a);
  const total = list.length;
  const top = (k) => per.slice(0, k).reduce((s, x) => s + x, 0);
  const zeroDur = list.filter((t) => !(Number(t.durationSec) > 0)).length;
  const durs = list.map((t) => Number(t.durationSec) || 0).filter((d) => d > 0);
  const withGenre = list.filter((t) => t.genre).length;
  const withYear = list.filter((t) => Number.isInteger(t.year)).length;
  lines.push(`tracks (as GET /api/music lists them, unrestricted viewer): ${total}`);
  lines.push(`  by source: ${Object.entries(bySource).map(([k, v]) => `${k}=${v}`).join(', ') || 'none'}`);
  lines.push(`  chaptered files expanded into chapter-tracks: ${chapterFiles.size}`);
  lines.push(`distinct artists (track artist field, the picker's key): ${artists.size}`);
  lines.push(`albums: ${titledAlbums.size} with an album title; ${allAlbums.size} album keys incl. untitled (one per artist)`);
  if (per.length) {
    lines.push(`tracks per artist: min ${per[per.length - 1]}, median ${quantile(per, 0.5)}, p75 ${quantile(per, 0.75)}, p90 ${quantile(per, 0.9)}, max ${per[0]}`);
    lines.push(`  artists with 1 track: ${per.filter((x) => x === 1).length}; with >=10: ${per.filter((x) => x >= 10).length}; with >=50: ${per.filter((x) => x >= 50).length}`);
    lines.push(`  share of all tracks held by the top 1 / 5 / 10 artists: ${fmt(top(1) / total, true)} / ${fmt(top(5) / total, true)} / ${fmt(top(10) / total, true)}`);
  }
  if (durs.length) lines.push(`duration: median ${fmt(quantile(durs, 0.5) / 60)} min, p90 ${fmt(quantile(durs, 0.9) / 60)} min; zero/unknown duration: ${zeroDur} (simulated as ${FALLBACK_DURATION_SEC}s)`);
  lines.push(`tags present: genre ${withGenre}/${total}, year ${withYear}/${total}`);
  for (const [src, n] of Object.entries(bySource)) {
    const sub = list.filter((t) => t.source === src);
    lines.push(`  ${src}: genre ${sub.filter((t) => t.genre).length}/${n}, year ${sub.filter((t) => Number.isInteger(t.year)).length}/${n}, album title ${sub.filter((t) => t.album && t.album.trim()).length}/${n}`);
  }
  const genres = new Map();
  for (const t of list) { const g = primaryGenre(t); if (g) genres.set(g, (genres.get(g) || 0) + 1); }
  const gs = [...genres.entries()].sort((a, b) => b[1] - a[1]);
  lines.push(`distinct primary genres (lowercased, first of ; / , |): ${gs.length}`);
  if (gs.length) lines.push(`  top 25: ${gs.slice(0, 25).map(([g, n]) => `${g} ${n}`).join(' | ')}`);
  const artistGenres = new Map();
  for (const t of list) { const g = primaryGenre(t); if (!g) continue; if (!artistGenres.has(t.artist)) artistGenres.set(t.artist, new Set()); artistGenres.get(t.artist).add(g); }
  lines.push(`artists with >=1 genre-tagged track: ${artistGenres.size}/${artists.size}; of those with >=2 genres: ${[...artistGenres.values()].filter((x) => x.size >= 2).length}`);
  const years = list.map((t) => t.year).filter((y) => Number.isInteger(y));
  if (years.length) {
    const dec = new Map();
    for (const y of years) { const d = Math.floor(y / 10) * 10; dec.set(d, (dec.get(d) || 0) + 1); }
    lines.push(`decades: ${[...dec.entries()].sort((a, b) => a[0] - b[0]).map(([d, n]) => `${d}s ${n}`).join(' | ')}`);
  }
  lines.push(`stored per-user signal rows (all users): music likes ${lib.signals.musicLiked}, media likes ${lib.signals.mediaLiked}, music progress ${lib.signals.musicProgressRows}, media progress ${lib.signals.mediaProgressRows}, watched ${lib.signals.watchedRows}`);
  return lines;
}

function runTrials(list, args, chapterMode, radio) {
  const rng = createSeededRng(args.seed);
  const neighbours = radio ? radio.genreNeighbours(list) : null;
  const H1 = 3600; const H3 = 3 * 3600;
  const res = { h1: [], h3: [], ended1: 0, ended3: 0, recycles: 0, tiers: {} };
  for (let k = 0; k < args.trials; k += 1) {
    const seedTrack = list[Math.floor(rng() * list.length)];
    const s = radio ? simulateNewSession(list, seedTrack, rng, H3, radio, neighbours) : simulateSession(list, seedTrack, rng, H3, chapterMode);
    const p1 = prefixUntil(s.played, H1);
    res.h1.push(sessionMetrics(p1));
    res.h3.push(sessionMetrics(s.played));
    const end1 = p1.length ? p1[p1.length - 1].startSec + p1[p1.length - 1].dur : 0;
    if (s.endedEarly && end1 < H1) res.ended1 += 1;
    if (s.endedEarly) res.ended3 += 1;
    res.recycles += s.recycles;
    for (const p of s.played) if (p.t.tier) res.tiers[p.t.tier] = (res.tiers[p.t.tier] || 0) + 1;
  }
  return res;
}

function tierShare(tiers) {
  const total = Object.values(tiers).reduce((a, b) => a + b, 0);
  if (!total) return 'n/a';
  return [1, 2, 3, 4, 5, 6, 7].map((k) => `T${k} ${fmt((tiers[k] || 0) / total, true)}`).join(' | ');
}

function metricTable(rows, label) {
  const keys = [
    ['tracks', 'tracks played', false],
    ['distinctArtists', 'distinct artists', false],
    ['artistRepeats', 'artist repeats (plays - distinct)', false],
    ['maxArtist', 'max plays of one artist', false],
    ['backToBack', 'same-artist back-to-back pairs', false],
    ['longestRun', 'longest same-artist run', false],
    ['albumRepeats', 'album repeats (titled albums)', false],
    ['albumReturn5', 'titled album returns within next 5', true],
    ['albumReturn10', 'titled album returns within next 10', true],
    ['artistArmShare', 'share of picks from the artist arm', true],
    ['chapterPickShare', 'share of picks that are lone chapters', true],
    ['genreJump', 'genre changes between tagged neighbours', true],
    ['farFromSeed', 'picks sharing neither seed artist nor genre', true],
    ['farFromTaggedSeed', '  the same, seeds WITH a genre tag only', true],
  ];
  const out = [`${label}`, `  ${pad('metric', 40)} ${pad('median', 8)} ${pad('p90', 8)}`];
  for (const [k, name, pct] of keys) {
    const vals = rows.map((r) => r[k]);
    out.push(`  ${pad(name, 40)} ${pad(fmt(quantile(vals, 0.5), pct), 8)} ${pad(fmt(quantile(vals, 0.9), pct), 8)}`);
  }
  return out;
}

function report(list, lib, args, sourceLabel) {
  const L = [];
  L.push(args.picker === 'new' ? 'FileTube radio (Autoplay) simulation - v1.368.0 STATION picker (lib/music/radio.js)' : 'FileTube radio (Autoplay) baseline simulation - TODAY\'S picker');
  L.push(`source: ${sourceLabel}`);
  for (const n of lib.notes) L.push(`note: ${n}`);
  L.push(`trials: ${args.trials} sessions, rng seed ${args.seed}; each starts from 1 uniformly random track, queue = [that track]`);
  L.push('');
  L.push('LIBRARY');
  for (const l of libraryStats(list, lib)) L.push('  ' + l);
  L.push('');
  if (list.length === 0) { L.push('No music tracks: nothing to simulate.'); return L.join('\n'); }
  const hasChapters = list.some((t) => t.source === 'library-chapter');
  const radio = args.picker === 'new' ? loadRadio() : null;
  const modes = (hasChapters && !radio) ? ['roll', 'span'] : ['span'];
  for (const mode of modes) {
    const r = runTrials(list, args, mode, radio);
    const modeLabel = radio ? 'v1.368.0 STATION: seed = the first track, a radio chapter pick stops at its segment (R13)'
      : !hasChapters ? 'no chaptered files, chapter mode irrelevant'
      : (mode === 'roll' ? 'CHAPTER PICKS ROLL TO THE FILE END (any non-menu queue; the common path)'
        : 'CHAPTER PICKS STOP AT THEIR SEGMENT (a flat menu-list queue)');
    L.push(`SESSIONS - ${modeLabel}`);
    L.push(...metricTable(r.h1, ' 1 hour'));
    L.push(...metricTable(r.h3, ' 3 hours'));
    L.push(`  sessions whose picks ran dry (playback stopped) before 1h: ${r.ended1}/${args.trials}; before 3h: ${r.ended3}/${args.trials}`);
    if (!radio) L.push(`  recycle-arm firings (no-repeat rule relaxed), total across trials: ${r.recycles}`);
    else L.push(`  tier share of picks, all sessions, 3 hours: ${tierShare(r.tiers)}`);
    L.push('');
  }
  L.push('Definitions: artist = the track artist field (the picker queries it; matchesArtist also accepts');
  L.push('album artist). Album metrics count only tracks with an album TITLE (a chapter-track\'s album is its');
  L.push('file title); untitled tracks group per artist and are left out. A return within W = a position');
  L.push('whose titled album reappears in the next W plays, over positions that have W plays after them.');
  L.push('Assumes an unrestricted (admin) viewer, Autoplay on, no skips, no user queue edits, every fetch');
  L.push('lands before the last track ends, and the RBAC/channel opt-out filters as stored.');
  return L.join('\n');
}

// ---------------------------------------------------------------- selftest library (synthetic)
const SYN_GENRES = ['Rock', 'Hip-Hop', 'Jazz', 'Electronic', 'Folk', 'Heavy Metal', 'Pop', 'Country'];
function syntheticLibrary(seed) {
  const rng = createSeededRng(seed);
  const tracks = {};
  let id = 0;
  for (let a = 0; a < 60; a += 1) {
    const n = Math.max(1, Math.round(120 / Math.pow(a + 1, 0.9))); // Zipf-ish artist sizes
    for (let i = 0; i < n; i += 1) {
      id += 1;
      const tid = 'syn' + id;
      // genres: 8 families, a few artists straddle two (genre neighbours), every 7th untagged
      const genre = a % 7 === 6 ? '' : SYN_GENRES[(a + (a % 5 === 0 && i % 3 === 0 ? 1 : 0)) % SYN_GENRES.length];
      tracks[tid] = { id: tid, title: 'T' + id, artist: 'Artist ' + a, albumArtist: 'Artist ' + a, album: 'Album ' + a + '-' + Math.floor(i / 10), durationSec: 150 + Math.floor(rng() * 180), source: 'native', genre, year: 1965 + ((a * 7) % 55), folderName: 'artist' + a };
    }
  }
  const metadata = {};
  for (let f = 0; f < 4; f += 1) {
    const chapters = [];
    for (let c = 0; c < 15; c += 1) chapters.push({ startTime: c * 240, title: 'Ch' + c });
    // yt-dlp writes YouTube's CATEGORY ("Music") as the genre tag
    metadata['mix' + f] = { id: 'mix' + f, type: 'audio', title: 'DJ Set ' + f, folderName: 'djchannel', channelName: 'DJ Channel', duration: 3600, chapters, tags: { genre: 'Music', date: '2021' } };
  }
  return { tracks, marks: {}, metadata, notes: ['SYNTHETIC library from --selftest: NOT a real library'], version: 'synthetic', signals: { musicLiked: 0, mediaLiked: 0, musicProgressRows: 0, mediaProgressRows: 0, watchedRows: 0 } };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write('usage: simulate.js [--data DIR | --db FILE] [--trials N] [--seed N] [--selftest] [--picker today|new]\n');
    return;
  }
  let lib; let label;
  if (args.selftest) {
    lib = syntheticLibrary(args.seed);
    label = 'SYNTHETIC (--selftest)';
  } else {
    const dbPath = resolveDbPath(args);
    if (!fs.existsSync(dbPath)) { process.stderr.write(`no database at ${dbPath} (pass --data DIR or --db FILE)\n`); process.exit(2); }
    lib = loadLibrary(dbPath);
    label = `${dbPath} (opened read-only, schema v${lib.version})`;
  }
  const list = buildList(lib);
  process.stdout.write(report(list, lib, args, label) + '\n');
}

// RADIO_SIM_NO_MAIN=1 lets a check script load the mirrored functions without running.
if (process.env.RADIO_SIM_NO_MAIN) {
  module.exports = { createSeededRng, fisherYatesShuffle, normalizeSeed, albumKeyFor, matchesArtist, expandAudioToTracks, apiMusicRandom, fetchAutoplayPicks, buildList };
} else {
  main();
}
