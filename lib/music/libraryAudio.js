'use strict';

// Wave G - the VIRTUAL projection of library audio (db.metadata, type 'audio' -
// the yt-dlp MP3s) into the Music library, with NO data duplication. This is the
// pure decision layer: given a media item + the per-folder marks, decide if it
// belongs in Music (isEligibleAudio), and shape it into a music-track record the
// existing music query pipeline (matchesSearch/sortTracks/groupAlbums/
// groupArtists/publicTrackListItem) consumes natively (projectAudioItem).
//
// Framing (from the LIVE data - see docs/exec-plans/active/music-library-
// projection.md): yt-dlp embeds only { title, artist, date, genre, ... } - NO
// album/track/disc tags, and `artist` IS the channel. So the only clean
// music/not-music signal is the CHANNEL (folder): a per-folder mark, defaulting
// to the genre tag (genre === 'Music'). Reuses musicTags.buildTrackMetadata (the
// SAME resolver the real music scan uses) - zero re-probe.

const musicTags = require('./tags');

// The projection is CHANNEL-level ALL-OR-NOTHING (v1.211, Dean): a channel is
// either fully in Music or not - never a confusing partial (a "blue but 1 of
// 352" toggle). So the genre-seeded default is decided PER CHANNEL, not per
// item: a channel auto-qualifies when a STRICT MAJORITY of its audio is tagged
// genre 'Music' (a mixed channel like NESTALGIA - 351 "Gaming" + 1 "Music" -
// does NOT auto-qualify; you flip it on in one tap to get ALL of it). This map
// is computed ONCE from the full audio set and threaded into isEligibleAudio /
// channelEffectiveOn so both the projection and the toggle agree.
function autoMusicChannels(audioItems) {
  const stats = new Map(); // folderName -> { total, music }
  for (const it of Array.isArray(audioItems) ? audioItems : []) {
    if (!it || it.type !== 'audio' || typeof it.folderName !== 'string') continue;
    let s = stats.get(it.folderName);
    if (!s) { s = { total: 0, music: 0 }; stats.set(it.folderName, s); }
    s.total += 1;
    if (it.tags && typeof it.tags === 'object' && it.tags.genre === 'Music') s.music += 1;
  }
  const out = new Set();
  for (const [key, s] of stats) if (s.music * 2 > s.total) out.add(key); // strict majority
  return out;
}

// Is a CHANNEL (folder) effectively in Music? override wins; else the
// channel-level auto default (majority-music). The single source of truth for
// the projection predicate, the folder toggle's state, and the Settings list.
function channelEffectiveOn(folderName, channelMarks, autoSet) {
  const marks = channelMarks && typeof channelMarks === 'object' ? channelMarks : {};
  const override = (typeof folderName === 'string' && Object.prototype.hasOwnProperty.call(marks, folderName))
    ? marks[folderName]
    : undefined;
  if (override === 'on') return true;
  if (override === 'off') return false;
  return !!(autoSet && typeof folderName === 'string' && autoSet.has(folderName));
}

// Is a library audio ITEM shown in Music? Non-audio never; otherwise its
// channel's effective state (all-or-nothing). `autoSet` is autoMusicChannels()'s
// output (the majority-music folders).
function isEligibleAudio(item, channelMarks, autoSet) {
  if (!item || item.type !== 'audio') return false;
  return channelEffectiveOn(item.folderName, channelMarks, autoSet);
}

// Project a db.metadata audio item into a music-track-shaped record.
//
// buildTrackMetadata gives us title/trackNo/discNo/year (embedded tag wins, path
// convention fills gaps) - all safe. But artist and album are resolved EXPLICITLY
// here, NOT from buildTrackMetadata's path convention:
//   - artist = embedded artist tag (which the live data proves IS the channel),
//     else channelName, else folderName. We do NOT let the path convention coin
//     an artist from a folder SLUG (e.g. 'nestalgiamusic' instead of 'NESTALGIA').
//   - album = a REAL embedded album tag only, else '' (untitled). The path
//     convention would otherwise stamp the folder slug as the album, inventing an
//     album shelf - the opposite of Dean's "no album sub-shelves" (no album tags
//     exist in this content anyway). album '' -> albumKeyFor groups ONE untitled
//     album per artist.
// Carries a `source:'library'` discriminator + its OWN routes so the shared
// player streams the mp3 from /video, arts from /thumbnail, and saves progress to
// the MEDIA store (/api/progress) - unifying resume with the feed side.
// v1.223 (Dean): media items store addedAt as a NUMERIC epoch (birthtime/mtime,
// server.js scan), but native music tracks store an ISO STRING - and every music
// "newest" sort (sortTracks / groupAlbums / groupArtists) compares addedAt as a
// STRING. So a projected download's numeric addedAt was DROPPED (its album/artist
// aggregated to '' and sank to the BOTTOM of "Recently added"), which is exactly
// why a fresh YouTube album never surfaced. Normalize to ISO here so a projected
// track sorts alongside native tracks by real recency. Accepts a number, a numeric
// string, or an already-ISO string.
function addedAtToIso(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return new Date(v).toISOString();
  if (typeof v === 'string' && v) {
    if (/^\d+$/.test(v)) { const n = Number(v); if (Number.isFinite(n)) return new Date(n).toISOString(); }
    return v; // already an ISO/comparable string
  }
  return '';
}

function projectAudioItem(item) {
  const meta = musicTags.buildTrackMetadata({
    tags: item.tags,
    filePath: item.filePath,
    rootFolder: item.rootFolder,
  });
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  const tags = item.tags && typeof item.tags === 'object' ? item.tags : {};
  const artist = str(tags.artist) || item.channelName || item.folderName || 'Unknown';
  const album = str(tags.album); // real album tag only; never the path slug
  const albumArtist = str(tags.albumartist) || artist;
  return {
    id: item.id,
    filePath: item.filePath,
    rootFolder: item.rootFolder,
    folderName: item.folderName,
    ext: item.ext,
    addedAt: addedAtToIso(item.addedAt), // v1.223: numeric media epoch -> ISO, so "newest" sorts see it
    title: meta.title || item.title || item.name || 'Unknown',
    artist,
    album,
    albumArtist,
    trackNo: meta.trackNo,
    discNo: meta.discNo,
    year: meta.year,
    genre: meta.genre,
    // The captured release/upload date (epoch ms) - the natural sort for yt-dlp
    // downloads (Dean). 0 when unknown; the release-date sort falls back to
    // addedAt within the 0 bucket.
    releaseDate: Number(item.releaseDate) || 0,
    durationSec: Number(item.duration) || 0,
    // The item's YouTube thumbnail stands in for embedded album art; the grid's
    // representative-art logic uses this + the id (art served via /albumart/:id
    // falling back to the media thumbnail - see the /albumart route).
    hasEmbeddedArt: !!item.hasThumbnail,
    albumArtKey: null,
    // Wave G projection markers + per-item route overrides (the plumbing reuse):
    source: 'library',
    streamSrc: '/video/' + item.id,
    artUrl: '/thumbnail/' + item.id,
    progressEndpoint: '/api/progress',
  };
}

// v1.221 chapter-albums: a chapter-track's id is the file id + chapter index. It
// is OPAQUE - nothing decodes it: RBAC gates the media item (mediaVisibleTo)
// BEFORE expansion, the byte route is the literal /video/<itemId>, and a resolve
// (/api/music/:id) matches the whole id against the projection. The `::c<idx>`
// suffix only guarantees no collision with a real media id (`::` never appears in
// a yt-dlp/md5/sha media id), so a chapter id can never masquerade as a native one.
function chapterTrackId(itemId, index) { return String(itemId) + '::c' + index; }

// A chaptered audio FILE (>=2 resolved chapters) expands into one VIRTUAL track per
// chapter - each streams the ONE file (streamSrc /video/<itemId>) and carries a
// chapterStartSec seek offset; they share the file's title as their album, so
// groupAlbums folds them into one Album. A 0-1 chapter file (or one whose chapters
// don't survive validation) stays a SINGLE track (projectAudioItem) - never a bogus
// album. `resolveChapters(item)` -> ascending [{ startTime: seconds, title }].
function expandAudioToTracks(item, resolveChapters) {
  const base = projectAudioItem(item);
  let chapters = [];
  try { chapters = typeof resolveChapters === 'function' ? resolveChapters(item) : []; } catch (_) { chapters = []; }
  if (!Array.isArray(chapters) || chapters.length < 2) return [base];
  const fileDur = Number(item.duration) || base.durationSec || 0;
  const albumTitle = base.title; // the file's title IS the album
  const out = [];
  for (let i = 0; i < chapters.length; i += 1) {
    const ch = chapters[i];
    const start = Number(ch && ch.startTime);
    if (!Number.isFinite(start) || start < 0) continue;
    const next = chapters[i + 1];
    const nextStart = next ? Number(next.startTime) : NaN;
    const end = Number.isFinite(nextStart) ? nextStart : fileDur;
    const span = end > start ? end - start : 0;
    out.push(Object.assign({}, base, {
      id: chapterTrackId(item.id, i),
      title: (ch && typeof ch.title === 'string' && ch.title.trim()) ? ch.title.trim() : ('Track ' + (i + 1)),
      album: albumTitle,
      albumArtist: base.artist,
      trackNo: i + 1,
      discNo: null,
      durationSec: span,
      source: 'library-chapter',
      streamSrc: '/video/' + item.id, // the ONE file; the chapter id never reaches the byte route
      chapterStartSec: start,
    }));
  }
  return out.length >= 2 ? out : [base]; // degrade if fewer than 2 chapters survived
}

module.exports = {
  autoMusicChannels,
  channelEffectiveOn,
  isEligibleAudio,
  projectAudioItem,
  expandAudioToTracks,
  chapterTrackId,
  addedAtToIso,
};
