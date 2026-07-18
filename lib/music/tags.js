'use strict';

// v1.44 T3 (music): pure metadata resolution for music tracks. Given the
// embedded ffprobe tags (already whitelisted by server.js's parseFfprobeTags —
// this module never spawns ffprobe, keeping it CI-testable without ffmpeg) and
// the file's path, produce the track record fields with the locked precedence:
// EMBEDDED tag wins per field; a missing field falls back to the path
// convention `.../<Artist>/<Album>/<NN> <Title>.ext`. Album art extraction
// (the ffmpeg spawn + sidecar file read) lives in the scan, not here — this
// module only names the sidecar CANDIDATES (a pure list) the scan probes.

const path = require('node:path');

// Sidecar cover filenames to look for in a track's directory when there is no
// embedded art, in preference order (embedded art is tried first, in the scan).
// The scan matches these case-insensitively against the real directory listing.
const SIDECAR_ART_NAMES = [
  'cover.jpg', 'cover.jpeg', 'cover.png',
  'folder.jpg', 'folder.jpeg', 'folder.png',
  'front.jpg', 'front.jpeg', 'front.png',
];

/**
 * Parse a track/disc number from an embedded tag value. ffprobe reports these
 * as strings like "3", "03", or "3/12" (number-of-total) — take the leading
 * integer. Returns null for anything without a leading number.
 */
function parseTrackNumber(raw) {
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.trunc(raw);
  if (typeof raw !== 'string') return null;
  const m = raw.trim().match(/^(\d{1,4})/);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Extract a 4-digit year from an embedded date tag ("2019", "2019-04-01",
 * "01/04/2019"). Returns null when no plausible 4-digit year is present.
 */
function parseYear(raw) {
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 1000 && raw <= 9999) return raw;
  if (typeof raw !== 'string') return null;
  const m = raw.match(/(?<!\d)(\d{4})(?!\d)/);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  return (y >= 1000 && y <= 9999) ? y : null;
}

/**
 * Split a filename stem into an optional disc/track number prefix and a title.
 * Handles: "01 Title", "01. Title", "01 - Title", "01_Title", and the
 * disc-track form "1-01 Title" / "1.01 Title". A leading 4+ digit run (e.g. a
 * year "1979 Something") is NOT treated as a track number. This is a best-
 * effort FALLBACK — only consulted when the embedded title/track tags are
 * missing — so the inherent ambiguity of "12 Monkeys" (title vs track 12) is
 * an accepted limitation, documented for the gate.
 * @returns {{discNo: (number|null), trackNo: (number|null), title: string}}
 */
function splitTrackAndTitle(stem) {
  const s = typeof stem === 'string' ? stem.trim() : '';
  // disc-track: "D-TT sep Title" / "D.TT sep Title"
  let m = s.match(/^(\d{1,2})[-.](\d{1,3})[\s._-]+(.+)$/);
  if (m) return { discNo: parseInt(m[1], 10), trackNo: parseInt(m[2], 10), title: m[3].trim() };
  // plain track: "TT sep Title" (1-3 digits, so a 4-digit year won't match)
  m = s.match(/^(\d{1,3})[\s._-]+(.+)$/);
  if (m) return { discNo: null, trackNo: parseInt(m[1], 10), title: m[2].trim() };
  return { discNo: null, trackNo: null, title: s };
}

/**
 * Derive {artist, album, trackNo, discNo, title} from a file's path relative
 * to its music root, using the `<Artist>/<Album>/<NN> <Title>.ext` convention.
 * Degrades gracefully at shallower depths (a bare album folder → album only;
 * a loose file at the root → title only). Never throws.
 */
function parsePathConvention(filePath, rootFolder) {
  const fp = typeof filePath === 'string' ? filePath : '';
  const ext = path.extname(fp);
  const base = path.basename(fp, ext);
  const { discNo, trackNo, title } = splitTrackAndTitle(base);

  let artist = '';
  let album = '';
  const root = typeof rootFolder === 'string' && rootFolder ? path.resolve(rootFolder) : '';
  const abs = fp ? path.resolve(fp) : '';
  let rel = '';
  if (root && abs && (abs === root || abs.startsWith(root + path.sep))) {
    rel = abs.slice(root.length + (abs[root.length] === path.sep ? 1 : 0));
  } else {
    rel = fp; // not under root (shouldn't happen in the scan) — use the whole path
  }
  const parts = rel.split(/[\\/]+/).filter(Boolean);
  // parts includes the filename as the last element.
  if (parts.length >= 3) {
    artist = parts[parts.length - 3];
    album = parts[parts.length - 2];
  } else if (parts.length === 2) {
    // A single folder above the file: most commonly the album folder.
    album = parts[0];
  }
  return { artist, album, trackNo, discNo, title };
}

/**
 * The locked precedence resolver: embedded tag wins per field, path convention
 * fills gaps. `tags` is the output of server.js's parseFfprobeTags (lowercase
 * whitelisted keys incl. 'track'/'albumartist'/'disc' — see the v1.44
 * whitelist extension). Returns the track metadata subset of a track record.
 */
function buildTrackMetadata({ tags, filePath, rootFolder } = {}) {
  const t = tags && typeof tags === 'object' ? tags : {};
  const conv = parsePathConvention(filePath, rootFolder);
  const str = (v) => (typeof v === 'string' ? v.trim() : '');

  let title = str(t.title) || conv.title || '';
  if (!title) {
    // Absolute last resort: the bare filename (never leave a track untitled).
    const ext = path.extname(typeof filePath === 'string' ? filePath : '');
    title = path.basename(typeof filePath === 'string' ? filePath : '', ext) || 'Unknown';
  }
  const artist = str(t.artist) || conv.artist || '';
  const album = str(t.album) || conv.album || '';
  // Album artist: explicit tag, else the track artist (so a single-artist
  // album groups under one key even without an ALBUMARTIST tag).
  const albumArtist = str(t.albumartist) || artist || '';

  const embeddedTrack = parseTrackNumber(t.track);
  const trackNo = embeddedTrack != null ? embeddedTrack : (conv.trackNo != null ? conv.trackNo : null);
  const embeddedDisc = parseTrackNumber(t.disc);
  const discNo = embeddedDisc != null ? embeddedDisc : (conv.discNo != null ? conv.discNo : null);

  const year = parseYear(t.date);
  const genre = str(t.genre) || '';

  return { title, artist, album, albumArtist, trackNo, discNo, year, genre };
}

module.exports = {
  SIDECAR_ART_NAMES,
  parseTrackNumber,
  parseYear,
  splitTrackAndTitle,
  parsePathConvention,
  buildTrackMetadata,
};
