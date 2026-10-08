'use strict';

// v1.371.0: "Save as an album" (plan docs/exec-plans/completed/2026-10-07-v1371-album-tags.md). A playlist job picked in
// the app can carry an album: every chosen track is tagged with the album, the album artist and its track number
// (and, when asked, a cleaned-up title), so Music groups them as ONE album instead of "Unknown Album" under the
// channel's handle. Pure: validation of the request and the yt-dlp argv that writes the tags.
// The track number is the picker's: v1.376.0 (ruling R6) numbers the songs that will be downloaded 1..N in playlist order
// (public/js/common.js albumTrackNumbers); v1.371.0-v1.375.0 sent the playlist position. The server validates either the
// same way (an integer 1..ALBUM_TRACK_MAX per id), so a pending entry an older version wrote still runs.
//
// How the tags get into the file (measured against yt-dlp 2026.08.19, plan section 3): yt-dlp's FFmpegMetadataPP writes
// any info field `meta_<key>` as the file tag `<key>`, in the same `--embed-metadata` pass every download already runs.
// A field is seeded with `--parse-metadata 'pre_process:%(id)s:(?P<meta_x>.+)'` (a TEMPLATE as FROM: a bare word there
// is read as a field NAME, MetadataParserPP.field_to_template) and then set to the literal with
// `--replace-in-metadata 'pre_process:meta_x' '(?s).+' <value>`. The value is a Python `re` REPLACEMENT string, so a
// backslash is doubled (`\g<0>` would otherwise become the video id - measured). The explicit `pre_process:` WHEN
// prefix is always written, so a value can never be read as one (options.py _dict_from_options_callback). Every value
// is its own argv element (no shell), never a template: `%(...)s` in an album name stays literal text.
// The metadata step prints "Changed <field> to: <value>" (the THIRD-PARTY title included) to stdout without escaping. It
// is silent today because every one-off `--print` implies `--quiet` (args.js); if a change ever lifts quiet, a title
// with a newline could forge a FTCHSRC / FTCHDST line that run.js reads as a file path (gate r1 security INFO 1).

const { isSafeVideoId } = require('./url');

const ALBUM_TEXT_MAX = 200;
const ALBUM_TRACK_MAX = 9999;
// Control characters (C0, DEL, C1) and the invisible format characters that only hide or spoof text (zero-width space,
// line / paragraph separators, bidi embeddings and overrides, word joiners, BOM): an invisible character would make a
// second album that looks identical to the first (v1.371.0 gate r1). The joiners and direction marks that real titles
// carry stay allowed (v1.372.0 gate r1: U+200D builds emoji like the family one, U+200C / U+200E / U+200F belong to
// Persian, Hebrew and Arabic titles; refusing them failed a whole album download).
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f\u200b\u2028-\u202e\u2060-\u2069\ufeff]/;
// The invisible formatting characters a name drawn from a YouTube title may carry: DROPPED from a name rather than failing
// the album (control characters are still refused - a NUL never reaches storage). v1.372.0 gate r2 (security INFO): the
// bidi isolates U+2066-2069 join the set.
const INVISIBLE_FORMAT_ALL = /[\u200b\u2028-\u202e\u2060-\u2069\ufeff]/g;
// The album and the album artist are Music's grouping KEY: a joiner or direction mark at either end is invisible and would
// make a second "Kyle Gordon" that looks identical (the default artist picks one up from a title or a "- Topic" channel -
// v1.372.0 gate r2 adversary W2), so it is trimmed with the whitespace; one inside a Persian, Hebrew or Arabic name stays.
const EDGE_MARKS = /^[\s\u200c-\u200f]+|[\s\u200c-\u200f]+$/g;
function tidyKeyName(v) {
  return typeof v === 'string' ? v.replace(INVISIBLE_FORMAT_ALL, '').replace(EDGE_MARKS, '') : v;
}

function cleanText(v) {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (t === '' || t.length > ALBUM_TEXT_MAX || CONTROL_CHARS.test(t)) return null;
  return t;
}

// Validates the album a playlist job carries (a fresh POST or a pending entry read back after a restart: untrusted
// either way). `ids` = the job's validated video ids. -> { ok: true, album } | { ok: false, error }. `album` is
// { title, artist, cleanTitles, tracks, titles, coverId? } with `tracks` (id -> track number) and `titles` (id -> song name, v1.372.0;
// absent in a v1.371.0 entry) null-prototype maps holding only the job's ids.
function albumFrom(input, ids) {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : null;
  if (!src) return { ok: false, error: 'Invalid album' };
  const title = cleanText(tidyKeyName(src.title));
  if (!title) return { ok: false, error: `The album needs a name (up to ${ALBUM_TEXT_MAX} characters)` };
  const artist = cleanText(tidyKeyName(src.artist));
  if (!artist) return { ok: false, error: `The album needs an album artist (up to ${ALBUM_TEXT_MAX} characters)` };
  const rawTracks = src.tracks && typeof src.tracks === 'object' && !Array.isArray(src.tracks) ? src.tracks : {};
  const tracks = Object.create(null);
  for (const id of Array.isArray(ids) ? ids : []) {
    if (!Object.prototype.hasOwnProperty.call(rawTracks, id)) continue;
    const n = rawTracks[id];
    if (!Number.isInteger(n) || n < 1 || n > ALBUM_TRACK_MAX) return { ok: false, error: 'Invalid track number' };
    tracks[id] = n;
  }
  // v1.372.0: the song names the picker showed (cleaned and / or typed), written as they are. Absent in a v1.371.0 entry.
  // A name drawn from a YouTube title can carry an invisible character the picker does not show; it is dropped here
  // rather than failing the whole album (gate r1), and a name that is still unusable names its song.
  const rawTitles = src.titles && typeof src.titles === 'object' && !Array.isArray(src.titles) ? src.titles : {};
  const titles = Object.create(null);
  for (const id of Array.isArray(ids) ? ids : []) {
    if (!Object.prototype.hasOwnProperty.call(rawTitles, id)) continue;
    const t = cleanText(typeof rawTitles[id] === 'string' ? rawTitles[id].replace(INVISIBLE_FORMAT_ALL, '') : rawTitles[id]);
    if (!t) return { ok: false, error: `The name for ${id} must be 1 to ${ALBUM_TEXT_MAX} characters, with no control characters` };
    titles[id] = t;
  }
  const out = { title, artist, cleanTitles: src.cleanTitles === true, tracks, titles };
  // v1.374.0 (d): the album's one cover - a video id (any loaded row of the playlist, ticked or not; the image host is
  // fixed, so membership in `ids` is not required). Absent / null = each song keeps its own art (the key stays absent,
  // so a job without a cover is the album object it always was). Never a URL: only an id by the job's own rule.
  if (src.coverId !== undefined && src.coverId !== null) {
    if (typeof src.coverId !== 'string' || !isSafeVideoId(src.coverId)) return { ok: false, error: 'Invalid album cover' };
    out.coverId = src.coverId;
  }
  return { ok: true, album: out };
}

// The per-video tags of one track of an album (null when there is no album).
function trackTagsFor(album, videoId) {
  if (!album || typeof album !== 'object') return null;
  const tracks = album.tracks && typeof album.tracks === 'object' ? album.tracks : {};
  const track = Object.prototype.hasOwnProperty.call(tracks, videoId) ? tracks[videoId] : null;
  const titles = album.titles && typeof album.titles === 'object' ? album.titles : {};
  const title = Object.prototype.hasOwnProperty.call(titles, videoId) && typeof titles[videoId] === 'string' ? titles[videoId] : null;
  return { album: album.title, albumArtist: album.artist, track: Number.isInteger(track) ? track : null, cleanTitles: album.cleanTitles === true, title };
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
// "(Lyrics)", "[HD]", "(Official Lyric Video)", "(Visualizer)". A group is noise only when EVERY word in it is a noise
// word, so a credit ("(feat. X)") and any group with a real word ("[Instrumental Version]", "(Live at Video Games
// Live)", "(Audio Commentary)") stay (gate r1: the first rule stripped any group CONTAINING a noise word). The rule
// runs twice, so "(Official Video [HD])" loses "[HD]" and then "(Official Video)".
const TITLE_NOISE_PATTERN = '(?i)\\s*[\\[(]\\s*(?:(?:official|music|lyrics?|audio|video|visuali[sz]er|hd|4k|hq|mv)\\s*)+[\\])]';

// The title with the noise groups removed, by the SAME pattern the yt-dlp path runs (JS and Python read it alike: the
// leading (?i) becomes the i flag), twice, spaces collapsed. The picker shows this, then strips the artist prefix itself
// (the album artist is typed there).
const TITLE_NOISE_RE = new RegExp(TITLE_NOISE_PATTERN.replace(/^\(\?i\)/, ''), 'gi');
function cleanTitleNoise(title) {
  if (typeof title !== 'string') return '';
  return title.replace(TITLE_NOISE_RE, '').replace(TITLE_NOISE_RE, '').replace(/\s{2,}/g, ' ').trim();
}

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
  const title = cleanText(tags.title);
  if (title) {
    // v1.372.0: the name the picker showed, exactly (the user's edit or the picker's cleanup) - no rule runs on it
    out.push(...seedArgs('meta_title'), ...setArgs('meta_title', title));
  } else if (tags.cleanTitles === true) {
    // a v1.371.0 pending entry (no names map): the in-yt-dlp cleanup
    out.push('--parse-metadata', 'pre_process:title:(?P<meta_title>.+)');
    out.push('--replace-in-metadata', 'pre_process:meta_title', `(?i)^${pyRegexLiteral(albumArtist)}\\s*[-–—]\\s*`, '');
    out.push('--replace-in-metadata', 'pre_process:meta_title', TITLE_NOISE_PATTERN, '');
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
  cleanTitleNoise,
  pyReplacementLiteral,
  pyRegexLiteral,
};
