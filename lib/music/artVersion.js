'use strict';

// lib/music/artVersion.js - v1.376.0 W6 (c): Music's art URLs carry a VERSION of the picture they point at (plan
// docs/exec-plans/completed/2026-10-08-v1376-notify-podcasts-polish.md, W6).
//
// Why: /albumart/<id> and /thumbnail/<id> answer `Cache-Control: private, max-age=86400`, and the URL never changed
// when the picture did - so after a cover changed (the v1.374.0 album cover re-embed, a re-extracted thumbnail, new
// album art) the browser kept painting the old one for up to a day (measured 2026-10-08: Mr. Jambo's row kept the old
// art from the cache while the server held the new one; Dean's private window showed the new one).
//
// The version is the art FILE's own mtime and size (base 36), read when a payload is built: a changed picture is a new
// URL, an unchanged one keeps its cached copy. It names nothing but the picture the viewer is already being sent (the
// ids in a payload are only ever ones the viewer can see - the callers filter by visibility first), so it leaks nothing
// across users.
//
// ONE resolution: `artFileFor` is the file GET /albumart/:id serves (lib/music/routes.js uses it), so the version and
// the bytes can never be read from two different files. ONE writer per side: `albumArtUrl` / `withArtVersion` here for
// the server-built URLs, public/js/music.js `albumArtSrc` for the client-built ones (main.js's Home, search and Liked cards
// call the same shape through `musicArtSrc` there - test/unit/music-art-version.test.js locks the two together).

// The version of one file's stat, '' when there is no file.
function versionOfStat(st) {
  if (!st || !Number.isFinite(st.mtimeMs) || !Number.isFinite(st.size)) return '';
  return Math.floor(st.mtimeMs).toString(36) + '-' + st.size.toString(36);
}

// `url` with `v=<version>` added (a `?` or `&` as the URL needs); unchanged for an empty version.
function withArtVersion(url, v) {
  if (typeof url !== 'string' || url === '' || typeof v !== 'string' || v === '') return url;
  return url + (url.includes('?') ? '&' : '?') + 'v=' + encodeURIComponent(v);
}

// `/albumart/<id>[?s=<size>][&v=<version>]` - the server-built album-art URL.
function albumArtUrl(id, { size, v } = {}) {
  const base = '/albumart/' + encodeURIComponent(id == null ? '' : String(id)) + (Number.isInteger(size) && size > 0 ? '?s=' + size : '');
  return withArtVersion(base, v);
}

// deps: { fs, path, ALBUMART_DIR, THUMBNAIL_DIR, readTrack(id) -> native track | null (an OWN-property lookup),
// readMediaItem(id) -> db.metadata item | null (an OWN-property lookup) }.
function createArtVersions(deps) {
  const { fs, path, ALBUMART_DIR, THUMBNAIL_DIR, readTrack, readMediaItem } = deps;

  // THE rule for the file /albumart serves (two halves, shared by the by-id and the by-track forms below):
  //   - a native track: its album's art file, <ALBUMART_DIR>/<albumArtKey>.jpg, else .png; none -> null (the route's
  //     placeholder SVG; a thumbnail never stands in for a native track);
  //   - a library audio item (and each `::c<n>` chapter of it: the BASE item) with a thumbnail:
  //     <THUMBNAIL_DIR>/<baseId>.jpg - the same file /thumbnail/<baseId> serves.
  const albumCandidates = (key) => ['.jpg', '.png'].map((ext) => path.join(ALBUMART_DIR, `${key}${ext}`));
  const thumbFile = (baseId) => path.join(THUMBNAIL_DIR, `${baseId}.jpg`);
  const baseOf = (id) => String(id).replace(/::c\d+$/, '');
  const isLibTrack = (t) => !!t && (t.source === 'library' || t.source === 'library-chapter');

  // By id, WITHOUT the visibility gate (the route gates the viewer; a payload builder only ever asks about ids the
  // viewer can see). -> { kind: 'album', file, key } | { kind: 'thumb', file, baseId } | null. GET /albumart uses this.
  function artFileFor(id) {
    if (typeof id !== 'string' || id === '') return null;
    const track = readTrack(id);
    if (track) {
      const key = typeof track.albumArtKey === 'string' && track.albumArtKey ? track.albumArtKey : null;
      if (!key) return null;
      const file = albumCandidates(key).find((f) => fs.existsSync(f));
      return file ? { kind: 'album', file, key } : null;
    }
    const baseId = baseOf(id);
    const item = readMediaItem(baseId);
    if (!item || item.type !== 'audio' || !item.hasThumbnail) return null;
    const file = thumbFile(baseId);
    return fs.existsSync(file) ? { kind: 'thumb', file, baseId } : null;
  }

  // The candidate files for a track RECORD a list already holds (a native track, or a projected library track from
  // lib/music/libraryAudio.js, whose `hasEmbeddedArt` is its item's hasThumbnail) - no lookup per row. Every track of
  // one cover resolves to the same file, so this is the version of the row's `artId` too.
  function candidatesForTrack(track) {
    if (!track || track.id == null) return [];
    if (isLibTrack(track)) return track.hasEmbeddedArt ? [thumbFile(baseOf(track.id))] : [];
    return typeof track.albumArtKey === 'string' && track.albumArtKey ? albumCandidates(track.albumArtKey) : [];
  }

  function versionOfFiles(files, seen) {
    for (const f of files) {
      if (seen && seen.has(f)) return seen.get(f);
      let v = '';
      try { v = versionOfStat(fs.statSync(f, { throwIfNoEntry: false })); } catch (_) { v = ''; }
      if (seen) seen.set(f, v);
      if (v) return v;
    }
    return '';
  }

  // The version of the picture /albumart/<id> serves ('' when it serves the placeholder). Never throws.
  function versionOf(id) {
    try {
      const art = artFileFor(id);
      return art ? versionOfFiles([art.file]) : '';
    } catch (_) {
      return '';
    }
  }

  // A memo for ONE payload (an album's songs share one file: one stat): call it per request, never keep it.
  // -> { ofTrack(track), ofId(id, tracksById) } - by id, a track the payload's own list holds is read from the list.
  function memo() {
    const seen = new Map();
    return {
      ofTrack: (track) => { try { return versionOfFiles(candidatesForTrack(track), seen); } catch (_) { return ''; } },
      ofId: (id, tracksById) => {
        const t = tracksById && typeof id === 'string' && tracksById.has(id) ? tracksById.get(id) : null;
        try {
          if (t) return versionOfFiles(candidatesForTrack(t), seen);
          const art = artFileFor(id);
          return art ? versionOfFiles([art.file], seen) : '';
        } catch (_) { return ''; }
      },
    };
  }

  return { artFileFor, versionOf, memo };
}

module.exports = { versionOfStat, withArtVersion, albumArtUrl, createArtVersions };
