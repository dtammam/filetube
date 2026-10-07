'use strict';

// v1.371.0: "Save as an album" (plan docs/exec-plans/active/2026-10-07-v1371-album-tags.md). A playlist job picked in
// the app can carry an album: every chosen track is tagged with the album, the album artist and its playlist position
// (and, when asked, a cleaned-up title), so Music groups them as ONE album instead of "Unknown Album" under the
// channel's handle. Pure: validation of the request and the yt-dlp argv that writes the tags.
//
// How the tags get into the file (measured against yt-dlp 2026.08.19, plan section 3): yt-dlp's FFmpegMetadataPP writes
// any info field `meta_<key>` as the file tag `<key>`, in the same `--embed-metadata` pass every download already runs.
// A field is seeded with `--parse-metadata 'pre_process:%(id)s:(?P<meta_x>.+)'` (a TEMPLATE as FROM: a bare word there
// is read as a field NAME, MetadataParserPP.field_to_template) and then set to the literal with
// `--replace-in-metadata 'pre_process:meta_x' '(?s).+' <value>`. The value is a Python `re` REPLACEMENT string, so a
// backslash is doubled (`\g<0>` would otherwise become the video id - measured). The explicit `pre_process:` WHEN
// prefix is always written, so a value can never be read as one (options.py _dict_from_options_callback). Every value
// is its own argv element (no shell), never a template: `%(...)s` in an album name stays literal text.

const ALBUM_TEXT_MAX = 200;
const ALBUM_TRACK_MAX = 9999;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

function cleanText(v) {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (t === '' || t.length > ALBUM_TEXT_MAX || CONTROL_CHARS.test(t)) return null;
  return t;
}

// Validates the album a playlist job carries (a fresh POST or a pending entry read back after a restart: untrusted
// either way). `ids` = the job's validated video ids. -> { ok: true, album } | { ok: false, error }. `album` is
// { title, artist, cleanTitles, tracks } with `tracks` a null-prototype map id -> track number, holding only the
// job's ids.
function albumFrom(input, ids) {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : null;
  if (!src) return { ok: false, error: 'Invalid album' };
  const title = cleanText(src.title);
  if (!title) return { ok: false, error: `The album needs a name (up to ${ALBUM_TEXT_MAX} characters)` };
  const artist = cleanText(src.artist);
  if (!artist) return { ok: false, error: `The album needs an album artist (up to ${ALBUM_TEXT_MAX} characters)` };
  const rawTracks = src.tracks && typeof src.tracks === 'object' && !Array.isArray(src.tracks) ? src.tracks : {};
  const tracks = Object.create(null);
  for (const id of Array.isArray(ids) ? ids : []) {
    if (!Object.prototype.hasOwnProperty.call(rawTracks, id)) continue;
    const n = rawTracks[id];
    if (!Number.isInteger(n) || n < 1 || n > ALBUM_TRACK_MAX) return { ok: false, error: 'Invalid track number' };
    tracks[id] = n;
  }
  return { ok: true, album: { title, artist, cleanTitles: src.cleanTitles === true, tracks } };
}

// The per-video tags of one track of an album (null when there is no album).
function trackTagsFor(album, videoId) {
  if (!album || typeof album !== 'object') return null;
  const tracks = album.tracks && typeof album.tracks === 'object' ? album.tracks : {};
  const track = Object.prototype.hasOwnProperty.call(tracks, videoId) ? tracks[videoId] : null;
  return { album: album.title, albumArtist: album.artist, track: Number.isInteger(track) ? track : null, cleanTitles: album.cleanTitles === true };
}

// A Python `re` replacement string that yields `s` literally.
function pyReplacementLiteral(s) {
  return String(s).replace(/\\/g, '\\\\');
}

// A Python `re` pattern that matches `s` literally: every ASCII character other than a letter, digit or underscore is
// backslash-escaped (Python accepts an escaped ASCII punctuation or space; an escaped ASCII LETTER is an error, so
// letters are never escaped); non-ASCII characters match themselves.
function pyRegexLiteral(s) {
  let out = '';
  for (const ch of String(s)) {
    out += (ch.length === 1 && ch.charCodeAt(0) < 128 && !/[A-Za-z0-9_]/.test(ch)) ? '\\' + ch : ch;
  }
  return out;
}

// Bracket groups that are YouTube noise, not part of the song's name: "[Official Audio]", "(Official Music Video)",
// "(Lyrics)", "[HD]", "(Visualizer)". A group that starts with feat / ft / with is a credit and stays, and so does
// any other group ("[Instrumental Version]", "(Original 1997 VHS Version)").
const TITLE_NOISE_PATTERN = '(?i)\\s*[\\[(](?!\\s*(?:feat|ft|with)\\b)[^\\])]*\\b(?:official|audio|video|lyrics?|visuali[sz]er|hd|4k|hq|mv)\\b[^\\])]*[\\])]';

function seedArgs(field) {
  return ['--parse-metadata', `pre_process:%(id)s:(?P<${field}>.+)`];
}
function setArgs(field, value) {
  return ['--replace-in-metadata', `pre_process:${field}`, '(?s).+', pyReplacementLiteral(value)];
}

// The yt-dlp argv that tags one track (empty for no tags). `tags` = trackTagsFor(...).
function albumTagArgs(tags) {
  if (!tags || typeof tags !== 'object') return [];
  const album = cleanText(tags.album);
  const albumArtist = cleanText(tags.albumArtist);
  if (!album || !albumArtist) return [];
  const out = [];
  out.push(...seedArgs('meta_album'), ...setArgs('meta_album', album));
  out.push(...seedArgs('meta_album_artist'), ...setArgs('meta_album_artist', albumArtist));
  if (Number.isInteger(tags.track) && tags.track >= 1 && tags.track <= ALBUM_TRACK_MAX) {
    out.push(...seedArgs('meta_track'), ...setArgs('meta_track', String(tags.track)));
  }
  // The track's artist: kept when the video credits one ("Kyle Gordon, Daniel Radcliffe" on a "Provided to YouTube"
  // track); the album artist when it does not (an official-channel upload, which yt-dlp would tag with the channel's
  // handle, its uploader fallback).
  out.push('--parse-metadata', 'pre_process:%(artist,creator|)s:(?P<meta_artist>.*)');
  out.push('--replace-in-metadata', 'pre_process:meta_artist', '^$', pyReplacementLiteral(albumArtist));
  if (tags.cleanTitles === true) {
    out.push('--parse-metadata', 'pre_process:title:(?P<meta_title>.+)');
    out.push('--replace-in-metadata', 'pre_process:meta_title', `(?i)^${pyRegexLiteral(albumArtist)}\\s*[-–—]\\s*`, '');
    out.push('--replace-in-metadata', 'pre_process:meta_title', TITLE_NOISE_PATTERN, '');
    out.push('--replace-in-metadata', 'pre_process:meta_title', '\\s{2,}', ' ');
    out.push('--replace-in-metadata', 'pre_process:meta_title', '^\\s+|\\s+$', '');
  }
  return out;
}

module.exports = {
  ALBUM_TEXT_MAX,
  ALBUM_TRACK_MAX,
  TITLE_NOISE_PATTERN,
  albumFrom,
  trackTagsFor,
  albumTagArgs,
  pyReplacementLiteral,
  pyRegexLiteral,
};
