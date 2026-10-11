'use strict';

// lib/offline/routes.js - the offline playback routes (v1.387.0, plan D2 + D3 +
// D4): the download manifest, the offline file route, the status check and (W3)
// the offline position sync. Reached by the iOS app with its per-device token
// (lib/auth/gate.js sets req.user from it, so every visibility wrapper below
// applies exactly as it does to a browser session) or by a cookie session (the
// web and the tests). The reference the app is written against is
// docs/references/offline-api.md.
//
// Every item is resolved through the EXISTING per-kind visibility wrappers
// (mediaVisibleTo, trackVisibleTo, podcastEpisodeVisibleTo, tvEpisodeVisibleTo);
// a hidden or missing single item is the neutral 404 the byte routes give; an
// album or season silently omits hidden members and 404s only when none remain
// (LESSONS 10). "track" is three things (plan correction 5): a native music
// track, a library audio item shown in Music (its bytes come from /video/:id
// and its progress lives in the media store) and a chapter row `<id>::c<n>`
// (the parent file, once, with its chapters). Every track id is resolved to one
// of the three first; the two library forms use the MEDIA gate.

const KINDS = Object.freeze(['track', 'album', 'podcastEpisode', 'video', 'tvEpisode', 'tvSeason']);
const SINGLE_KINDS = Object.freeze(['track', 'podcastEpisode', 'video', 'tvEpisode']);
const STATUS_MAX_ITEMS = 500;
const ID_MAX = 512;
const RETRY_AFTER_TRANSCODE_SEC = 60;

const musicStore = require('../music/store');
const libraryAudio = require('../music/libraryAudio');
const tvParse = require('../tv/parse');
const { decidePlayability, isHevc } = require('./playable');

function validId(id) {
  return typeof id === 'string' && id.length >= 1 && id.length <= ID_MAX && !id.includes('\u0000');
}
function fileUrl(kind, id) {
  return `/api/offline/file/${kind}/${encodeURIComponent(id)}`;
}
function fingerprintOf(stat) {
  return `${stat.size}-${Math.round(stat.mtimeMs)}`;
}
// A stored progress row -> the manifest's shape (or null).
function progressOf(row, positionKey) {
  if (!row) return null;
  const pos = Number(row[positionKey]);
  const dur = Number(row.duration);
  return {
    positionSec: Number.isFinite(pos) ? pos : 0,
    durationSec: Number.isFinite(dur) ? dur : null,
    updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : null,
  };
}
function chaptersOf(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((c) => ({ startSec: Number(c && c.startTime), title: c && typeof c.title === 'string' ? c.title : '' }))
    .filter((c) => Number.isFinite(c.startSec) && c.startSec >= 0);
}

function registerRoutes(app, deps) {
  const {
    fs,
    path,
    mime, // mime-types (lookup by path)
    getCachedDatabase,
    musicDb,
    tvDb,
    podcastsDb,
    userStore,
    mediaVisibleTo,
    trackVisibleTo,
    podcastEpisodeVisibleTo,
    tvEpisodeVisibleTo,
    projectedLibraryTracks, // the library-audio projection (RBAC + channel eligibility inside)
    effectiveProgress, // media: the pending overlay then the row
    effectiveMusicProgress, // music: the pending overlay then the row
    resolveItemChapters, // media: manual > embedded > description
    findSubtitleSidecar,
    transcodedPath, // TRANSCODE_DIR/<id>.mp4
    queueTranscode, // the video queue (writes media transcodeStatus; the web ignores it when needsTranscode is false)
    tvRenditionPath, // TRANSCODE_DIR/tv-<id>.mp4
    queueTvTranscode, // the tv-owned queue (file existence is readiness)
    ffmpegIsAvailable, // LIVE reader
    markServed, // protects a streaming cache file from the LRU sweep
    podcastEpisodeConfined, // (ep) -> the /episode route's own path confinement
    probeHevcTag, // (filePath) -> Promise<string|null>: the stream's codec_tag_string
    podcastContentTypes, // the podcasts module's extension -> mime map
    musicContentTypes,
    tvContentTypes,
  } = deps;

  const ownProp = (obj, key) => !!obj && Object.prototype.hasOwnProperty.call(obj, key);

  // ---- per-request caches ----------------------------------------------------
  function projection(req) {
    if (req._ftOfflineProjection) return req._ftOfflineProjection;
    const ns = musicDb.read();
    const native = Object.values(ns.tracks || {}).filter((t) => trackVisibleTo(req, t));
    const projected = projectedLibraryTracks(req, native);
    const byId = new Map();
    const bases = new Map(); // base file id -> its first projected row: a chaptered file is in the list ONLY as its chapter rows
    for (const t of projected) {
      byId.set(t.id, t);
      const base = t.source === 'library-chapter' ? String(t.id).replace(/::c\d+$/, '') : t.id;
      if (!bases.has(base)) bases.set(base, t);
    }
    req._ftOfflineProjection = { ns, native, projected, byId, bases };
    return req._ftOfflineProjection;
  }

  // The HEVC tag cache: id + fingerprint -> tag (never a per-item db.metadata
  // field, LESSONS 9); one in-flight probe per key.
  const hevcTags = new Map();
  const hevcInFlight = new Map();
  async function hevcTagFor(id, filePath, fingerprint) {
    const key = `${id}|${fingerprint}`;
    if (hevcTags.has(key)) return hevcTags.get(key);
    if (hevcInFlight.has(key)) return hevcInFlight.get(key);
    const p = Promise.resolve()
      .then(() => (typeof probeHevcTag === 'function' ? probeHevcTag(filePath) : null))
      .catch(() => null)
      .then((tag) => {
        if (hevcTags.size > 5000) hevcTags.clear();
        hevcTags.set(key, tag || null);
        hevcInFlight.delete(key);
        return tag || null;
      });
    hevcInFlight.set(key, p);
    return p;
  }

  // ---- resolvers: (req, id) -> entry | null | { notOnServer: true } ------------
  // An entry: { kind, id, title, subtitle, album, trackNumber, season, episode, durationSec,
  //   filePath, ext, isAudio, videoCodec, audioCodec, transcodeFailed, transcode: {path, queue}|null,
  //   artworkUrl, chapters, subtitleSidecar, progress, finished, contentType }
  function mediaEntry(req, item, asKind) {
    const ext = typeof item.ext === 'string' ? item.ext.toLowerCase() : path.extname(item.filePath || '').toLowerCase();
    const isAudio = item.type === 'audio';
    const sidecar = !isAudio && typeof findSubtitleSidecar === 'function' ? findSubtitleSidecar(item.filePath) : null;
    const base = asKind === 'track' ? libraryAudio.projectAudioItem(item) : null;
    return {
      kind: asKind, id: item.id,
      title: base ? base.title : (item.title || item.name || 'Untitled'),
      subtitle: base ? base.artist : (item.channelName || item.folderName || ''),
      album: base ? (base.album || null) : null,
      trackNumber: base && Number.isInteger(base.trackNo) ? base.trackNo : null,
      durationSec: Number(item.duration) || 0,
      filePath: item.filePath, ext, isAudio,
      videoCodec: isAudio ? null : (item.codec || null),
      audioCodec: item.audioCodec || (isAudio ? item.codec : null) || null,
      transcodeFailed: item.transcodeStatus === 'failed',
      transcode: isAudio ? null : { path: transcodedPath(item.id), queue: () => queueTranscode(item.id, item.filePath) },
      artworkUrl: item.hasThumbnail ? `/thumbnail/${encodeURIComponent(item.id)}` : null,
      chapters: chaptersOf(resolveItemChapters(item).chapters),
      subtitles: sidecar ? [{ lang: 'und', label: 'Subtitles', url: `/api/subtitles/${encodeURIComponent(item.id)}` }] : [],
      progress: progressOf(effectiveProgress(req.user.id, item.id), 'timestamp'),
      finished: userStore.isWatched(req.user.id, item.id),
      contentType: mime.lookup(item.filePath) || (isAudio ? 'audio/mpeg' : 'video/mp4'),
    };
  }
  function nativeTrackEntry(req, track) {
    const ext = typeof track.ext === 'string' ? track.ext.toLowerCase() : '';
    return {
      kind: 'track', id: track.id,
      title: track.title || 'Untitled', subtitle: track.artist || track.albumArtist || '',
      album: track.album || null, trackNumber: Number.isInteger(track.trackNo) ? track.trackNo : null,
      durationSec: Number(track.durationSec) || 0,
      filePath: track.filePath, ext, isAudio: true,
      videoCodec: null, audioCodec: track.codec || null,
      transcodeFailed: false, transcode: null,
      artworkUrl: `/albumart/${encodeURIComponent(track.id)}`,
      chapters: [], subtitles: [],
      progress: progressOf(effectiveMusicProgress(req.user.id, track.id), 'position'),
      finished: false, // music has no latch
      contentType: musicContentTypes[ext] || 'application/octet-stream',
    };
  }
  function resolveTrack(req, id) {
    const { ns, byId, bases } = projection(req);
    const native = ownProp(ns.tracks, id) ? ns.tracks[id] : null;
    if (native && typeof native.filePath === 'string') return trackVisibleTo(req, native) ? nativeTrackEntry(req, native) : null;
    // A projected library track or a chapter row: the projection already applied the MEDIA gate
    // and the channel eligibility; the entry is the PARENT file (a chapter adds the file once).
    const projected = byId.get(id);
    if (!projected && !bases.has(id)) return null;
    const baseId = projected && projected.source === 'library-chapter' ? String(id).replace(/::c\d+$/, '') : id;
    const db = getCachedDatabase();
    const item = ownProp(db.metadata, baseId) ? db.metadata[baseId] : null;
    if (!item || !mediaVisibleTo(req, item)) return null;
    const entry = mediaEntry(req, item, 'track');
    // The album Music SHOWS for this file: a chaptered file is an album named by its title
    // (lib/music/libraryAudio.js expandAudioToTracks), so the parent entry says the same.
    const row = bases.get(baseId);
    if (row && row.source === 'library-chapter') { entry.album = row.album || null; entry.subtitle = row.albumArtist || row.artist || entry.subtitle; entry.trackNumber = null; }
    return entry;
  }
  function resolveVideo(req, id) {
    const db = getCachedDatabase();
    const item = ownProp(db.metadata, id) ? db.metadata[id] : null;
    if (!item || typeof item.filePath !== 'string' || !mediaVisibleTo(req, item)) return null;
    return mediaEntry(req, item, 'video');
  }
  function resolvePodcastEpisode(req, id) {
    const ns = podcastsDb.read();
    const ep = ownProp(ns.episodes, id) ? ns.episodes[id] : null;
    if (!ep || !podcastEpisodeVisibleTo(req, ep)) return null;
    if (ep.status !== 'downloaded' || typeof ep.filePath !== 'string' || ep.filePath === '') return { notOnServer: true };
    if (!podcastEpisodeConfined(ep)) return null; // the /episode route's neutral 404 for an unconfined path
    const sub = (ns.subscriptions || []).find((s) => s && s.id === ep.subId);
    const ext = path.extname(ep.filePath).toLowerCase();
    const played = userStore.getPodcastPlayed(req.user.id);
    return {
      kind: 'podcastEpisode', id: ep.id,
      title: ep.title || 'Episode', subtitle: (sub && (sub.name || sub.feedUrlDisplay)) || '',
      album: null, trackNumber: null,
      durationSec: Number(ep.durationSec) || 0,
      filePath: ep.filePath, ext, isAudio: true,
      videoCodec: null, audioCodec: null,
      transcodeFailed: false, transcode: null,
      artworkUrl: `/podcastart/${encodeURIComponent(ep.subId)}`,
      chapters: [], subtitles: [],
      progress: progressOf(userStore.getOnePodcastProgress(req.user.id, ep.id), 'position'),
      finished: ownProp(played, ep.id),
      contentType: podcastContentTypes[ext] || 'application/octet-stream',
    };
  }
  function tvEntry(req, ep, played) {
    const ext = typeof ep.ext === 'string' ? ep.ext.toLowerCase() : '';
    return {
      kind: 'tvEpisode', id: ep.id,
      title: ep.title || (ep.episodeNum != null ? `Episode ${ep.episodeNum}` : (ep.showName || 'Episode')),
      subtitle: ep.showName || '',
      album: null, trackNumber: null,
      season: ep.seasonNum == null ? null : ep.seasonNum, episode: ep.episodeNum == null ? null : ep.episodeNum,
      durationSec: Number(ep.durationSec) || 0,
      filePath: ep.filePath, ext, isAudio: false,
      videoCodec: ep.codec || null, audioCodec: ep.audioCodec || null,
      transcodeFailed: false, // the tv queue tracks no status; a failed job simply leaves no rendition
      transcode: { path: tvRenditionPath(ep.id), queue: () => queueTvTranscode(ep.id, ep.filePath) },
      artworkUrl: `/tvthumb/${encodeURIComponent(ep.id)}`,
      chapters: [], subtitles: [], // TV has no sidecar route today (disclosed)
      progress: progressOf(userStore.getOneTvProgress(req.user.id, ep.id), 'position'),
      finished: ownProp(played || userStore.getTvPlayed(req.user.id), ep.id),
      contentType: tvContentTypes[ext] || 'video/mp4',
    };
  }
  function resolveTvEpisode(req, id) {
    const ns = tvDb.read();
    const ep = ownProp(ns.episodes, id) ? ns.episodes[id] : null;
    if (!ep || typeof ep.filePath !== 'string' || !tvEpisodeVisibleTo(req, ep)) return null;
    return tvEntry(req, ep);
  }
  const RESOLVERS = { track: resolveTrack, video: resolveVideo, podcastEpisode: resolvePodcastEpisode, tvEpisode: resolveTvEpisode };

  // Collections: -> { title, entries } | null (nothing visible).
  function resolveAlbum(req, albumKey) {
    const { native, projected } = projection(req);
    const members = native.concat(projected).filter((t) => musicStore.albumKeyFor(t) === albumKey);
    if (members.length === 0) return null;
    const num = (v) => (Number.isInteger(v) ? v : Number.MAX_SAFE_INTEGER);
    members.sort((a, b) => num(a.discNo) - num(b.discNo) || num(a.trackNo) - num(b.trackNo) || String(a.title || '').localeCompare(String(b.title || '')) || String(a.id).localeCompare(String(b.id)));
    const entries = [];
    const seen = new Set();
    for (const t of members) {
      const e = resolveTrack(req, t.id);
      if (!e || e.notOnServer || seen.has(e.id)) continue; // a chapter row adds its parent file once
      seen.add(e.id);
      entries.push(e);
    }
    if (entries.length === 0) return null;
    const first = members[0];
    return { title: first.album || albumKey, subtitle: first.albumArtist || first.artist || '', entries };
  }
  function resolveTvSeason(req, seasonId) {
    const sep = seasonId.lastIndexOf(':');
    if (sep <= 0 || sep === seasonId.length - 1) return null;
    const showId = seasonId.slice(0, sep);
    const seasonKey = seasonId.slice(sep + 1);
    const ns = tvDb.read();
    const visible = Object.values(ns.episodes || {}).filter((ep) => ep && typeof ep.filePath === 'string' && tvEpisodeVisibleTo(req, ep));
    const season = tvParse.groupSeasons(visible, showId).find((s) => (s.seasonNum == null ? 'x' : String(s.seasonNum)) === seasonKey);
    if (!season || season.episodes.length === 0) return null;
    const played = userStore.getTvPlayed(req.user.id);
    const entries = season.episodes.map((ep) => tvEntry(req, ep, played));
    return { title: `${entries[0].subtitle || 'Show'} - ${season.label}`, subtitle: entries[0].subtitle, entries };
  }

  // ---- the file decision (plan D3) ----------------------------------------------
  // -> { mode, reason, servePath, contentType, bytes, ready, fingerprint } | null when the source is gone.
  async function decideFile(entry) {
    let stat;
    try { stat = fs.statSync(entry.filePath); } catch { return null; }
    if (!stat.isFile()) return null;
    const fingerprint = fingerprintOf(stat);
    let hevcTag;
    if (!entry.isAudio && entry.kind !== 'podcastEpisode' && isHevc(entry.videoCodec)) {
      hevcTag = await hevcTagFor(entry.id, entry.filePath, fingerprint);
    }
    const decision = decidePlayability({
      kind: entry.kind, ext: entry.ext, isAudio: entry.isAudio,
      videoCodec: entry.videoCodec, audioCodec: entry.audioCodec, hevcTag,
      transcodeAvailable: !!(entry.transcode && ffmpegIsAvailable()),
      transcodeFailed: entry.transcodeFailed,
    });
    const out = { mode: decision.mode, reason: decision.reason || null, fingerprint, servePath: null, contentType: null, bytes: null, ready: false };
    if (decision.mode === 'original') {
      out.servePath = entry.filePath; out.contentType = entry.contentType; out.bytes = stat.size; out.ready = true;
    } else if (decision.mode === 'transcode') {
      out.contentType = 'video/mp4';
      let tstat = null;
      try { tstat = fs.statSync(entry.transcode.path); } catch { tstat = null; }
      if (tstat && tstat.isFile()) { out.servePath = entry.transcode.path; out.bytes = tstat.size; out.ready = true; }
    }
    return out;
  }
  async function manifestItem(entry) {
    const file = await decideFile(entry);
    if (!file) return null; // the source vanished: gone
    return {
      kind: entry.kind, id: entry.id, title: entry.title, subtitle: entry.subtitle,
      album: entry.album, trackNumber: entry.trackNumber,
      season: entry.season === undefined ? null : entry.season, episode: entry.episode === undefined ? null : entry.episode,
      durationSec: entry.durationSec,
      file: {
        url: fileUrl(entry.kind, entry.id),
        bytes: file.bytes,
        mime: file.contentType,
        fingerprint: file.fingerprint,
        ready: file.ready,
        playable: file.mode !== 'none',
        ...(file.mode === 'none' ? { reason: file.reason } : {}),
      },
      artwork: entry.artworkUrl ? { url: entry.artworkUrl } : null,
      chapters: entry.chapters,
      subtitles: entry.subtitles,
      progress: entry.progress,
      finished: !!entry.finished,
    };
  }

  // ---- GET /api/offline/manifest?kind=&id= (plan D2) ----------------------------
  app.get('/api/offline/manifest', async (req, res) => {
    try {
      const kind = req.query.kind;
      const id = req.query.id;
      if (!KINDS.includes(kind)) return res.status(400).json({ error: `kind must be one of ${KINDS.join(', ')}` });
      if (!validId(id)) return res.status(400).json({ error: 'id must be a string of 1 to 512 characters' });
      if (kind === 'album' || kind === 'tvSeason') {
        const coll = kind === 'album' ? resolveAlbum(req, id) : resolveTvSeason(req, id);
        if (!coll) return res.status(404).json({ error: 'not found' });
        const items = (await Promise.all(coll.entries.map(manifestItem))).filter(Boolean);
        if (items.length === 0) return res.status(404).json({ error: 'not found' });
        return res.json({ kind, id, title: coll.title, items });
      }
      const entry = RESOLVERS[kind](req, id);
      if (!entry) return res.status(404).json({ error: 'not found' });
      if (entry.notOnServer) return res.status(409).json({ error: 'not on server yet' });
      const item = await manifestItem(entry);
      if (!item) return res.status(404).json({ error: 'not found' });
      return res.json({ kind, id, title: item.title, items: [item] });
    } catch (err) {
      console.error('Error in GET /api/offline/manifest:', err);
      return res.status(500).json({ error: `Could not build the manifest: ${err.message}` });
    }
  });

  // ---- GET /api/offline/file/:kind/:id (plan D3) --------------------------------
  // The file the rule picks, through res.sendFile (full Range including suffix
  // ranges, ETag, Last-Modified, If-Range: iOS background downloads resume from
  // resume data that needs a validator; sendRangeable has none and is unchanged).
  app.get('/api/offline/file/:kind/:id', async (req, res) => {
    try {
      const { kind, id } = req.params;
      if (!SINGLE_KINDS.includes(kind) || !validId(id)) return res.status(404).json({ error: 'not found' });
      const entry = RESOLVERS[kind](req, id);
      if (!entry) return res.status(404).json({ error: 'not found' });
      if (entry.notOnServer) return res.status(409).json({ error: 'not on server yet' });
      const file = await decideFile(entry);
      if (!file) return res.status(404).json({ error: 'not found' });
      if (file.mode === 'none') return res.status(409).json({ error: 'not playable on this device', reason: file.reason });
      if (!file.ready) {
        // Only a COMPLETE transcode is ever served: the queues write `<out>.tmp.mp4` and rename
        // (lib/media/transcode.js, lib/tv/routes.js), so an existing `<out>` is complete by
        // construction; an absent one is queued through the existing queue, never a second ffmpeg path.
        entry.transcode.queue();
        res.setHeader('Retry-After', String(RETRY_AFTER_TRANSCODE_SEC));
        return res.status(503).json({ error: 'transcoding' });
      }
      // A download in progress protects the cache file from LRU eviction (the tv byte route's precedent).
      markServed(file.servePath);
      if (file.servePath !== entry.filePath) markServed(entry.filePath);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      return res.sendFile(file.servePath, {
        dotfiles: 'allow', // send 404s a dot-named segment by default
        acceptRanges: true, etag: true, lastModified: true,
        cacheControl: false,
        headers: { 'Content-Type': file.contentType, 'Cache-Control': 'private, no-store' },
      }, (err) => {
        if (!err || res.headersSent) return;
        if (err.code === 'ENOENT') return res.status(404).json({ error: 'not found' });
        if (err.status === 416) return res.status(416).set('Content-Range', `bytes */${file.bytes}`).end();
        console.error('Error in GET /api/offline/file:', err);
        res.status(err.status || 500).json({ error: 'could not send the file' });
      });
    } catch (err) {
      console.error('Error in GET /api/offline/file:', err);
      return res.status(500).json({ error: `Could not serve the file: ${err.message}` });
    }
  });

  // ---- POST /api/offline/status (plan D3) ---------------------------------------
  // One call for the app to re-check its whole catalogue: gone = deleted, moved
  // (ids are md5(path)) or now hidden from this user; changed = a new fingerprint.
  app.post('/api/offline/status', (req, res) => {
    try {
      const body = req.body || {};
      const items = body.items;
      if (!Array.isArray(items)) return res.status(400).json({ error: 'items must be an array' });
      if (items.length > STATUS_MAX_ITEMS) return res.status(400).json({ error: `at most ${STATUS_MAX_ITEMS} items per call` });
      const out = [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (!it || typeof it !== 'object' || !SINGLE_KINDS.includes(it.kind) || !validId(it.id) || typeof it.fingerprint !== 'string') {
          return res.status(400).json({ error: `items[${i}]: kind (track | podcastEpisode | video | tvEpisode), id and fingerprint are required` });
        }
        const entry = RESOLVERS[it.kind](req, it.id);
        let state = 'gone';
        if (entry && !entry.notOnServer) {
          let stat = null;
          try { stat = fs.statSync(entry.filePath); } catch { stat = null; }
          if (stat && stat.isFile()) state = fingerprintOf(stat) === it.fingerprint ? 'ok' : 'changed';
        }
        out.push({ kind: it.kind, id: it.id, state });
      }
      return res.json({ items: out });
    } catch (err) {
      console.error('Error in POST /api/offline/status:', err);
      return res.status(500).json({ error: `Could not check the items: ${err.message}` });
    }
  });

  return { KINDS, SINGLE_KINDS, resolvers: RESOLVERS, resolveAlbum, resolveTvSeason, decideFile };
}

module.exports = { registerRoutes, KINDS, SINGLE_KINDS, STATUS_MAX_ITEMS, fingerprintOf };
