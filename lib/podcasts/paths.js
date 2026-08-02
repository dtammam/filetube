'use strict';

// v1.69.0 (podcasts): show-directory + episode-filename resolution, the
// lib/ytdlp/args.js two-line defense verbatim: a charset sanitizer as the
// first line, a STRUCTURAL resolved-path confinement assert as the second -
// even a sanitizer bug cannot escape the podcasts root, because the resolved
// path is checked, never assumed safe. Every input here (show title, episode
// title, guid) is FEED-CONTROLLED and therefore hostile until proven
// otherwise (exec plan attack surface 3).

const path = require('path');
const crypto = require('crypto');

const MAX_SHOW_DIR_NAME_LENGTH = 80;
const MAX_EPISODE_TITLE_LENGTH = 100; // the v1.41.13 ENAMETOOLONG cap

/**
 * Sanitize a feed/show title into a directory name: strip control chars,
 * neutralize path separators + traversal runs, collapse everything outside
 * [A-Za-z0-9 _-] to '-'. Degrades to 'podcast', never ''.
 */
function sanitizeShowDirName(name) {
  if (typeof name !== 'string') return 'podcast';
  let cleaned = name
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/[/\\]/g, '-')
    .replace(/\.\./g, '-');
  cleaned = cleaned.replace(/[^A-Za-z0-9 _-]/g, '-');
  cleaned = cleaned.trim().replace(/^-+/, '');
  if (cleaned.length > MAX_SHOW_DIR_NAME_LENGTH) cleaned = cleaned.slice(0, MAX_SHOW_DIR_NAME_LENGTH);
  cleaned = cleaned.trim();
  return cleaned === '' ? 'podcast' : cleaned;
}

/**
 * Resolve (and confine) a show's directory under the podcasts root. Throws
 * on escape - the resolveChannelDir posture: the throw is a structural
 * invariant violation, not a user-input error (user input was already
 * sanitized; reaching the throw means a code bug, and refusing loudly beats
 * writing somewhere unexpected).
 */
function resolveShowDir(rootDir, showName) {
  const root = path.resolve(rootDir);
  const candidate = path.resolve(root, sanitizeShowDirName(showName));
  if (candidate !== root && !candidate.startsWith(root + path.sep)) {
    throw new Error('Refusing to resolve show dir outside the podcasts root');
  }
  return candidate;
}

/**
 * The bracket id for an episode's filename: the guid itself when it already
 * fits the safe charset (Patreon's numeric post ids do), else md5(guid).
 * Result always matches lib/ytdlp/url.js UNIVERSAL_BRACKET's id charset, so
 * `Title [rss=<guidKey>].mp3` parses via the existing extractMediaRef with
 * zero changes.
 */
function guidKey(guid) {
  const g = typeof guid === 'string' ? guid : '';
  if (/^[A-Za-z0-9_-]{1,64}$/.test(g)) return g;
  return crypto.createHash('md5').update(g, 'utf8').digest('hex');
}

/**
 * Sanitize an episode title for a filename (NOT a directory): same charset
 * discipline as the show dir, plus the 100-char cap. Degrades to 'episode'.
 */
function sanitizeEpisodeTitle(title) {
  if (typeof title !== 'string') return 'episode';
  let cleaned = title
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/[/\\]/g, '-')
    .replace(/\.\./g, '-');
  cleaned = cleaned.replace(/[^A-Za-z0-9 _-]/g, '-');
  cleaned = cleaned.trim().replace(/^-+/, '');
  if (cleaned.length > MAX_EPISODE_TITLE_LENGTH) cleaned = cleaned.slice(0, MAX_EPISODE_TITLE_LENGTH);
  cleaned = cleaned.trim();
  return cleaned === '' ? 'episode' : cleaned;
}

// Extensions we will ever write for a downloaded enclosure. Anything the
// enclosure URL/type suggests outside this set falls back to .mp3 - the
// extension is OUR choice of safe label, never the feed's.
const SAFE_AUDIO_EXTENSIONS = new Set(['.mp3', '.m4a', '.aac', '.ogg', '.opus', '.flac', '.wav']);

/**
 * Choose the on-disk extension for an enclosure from its URL pathname, falling
 * back to '.mp3'. The enclosure's `type` attr is advisory and messier in the
 * wild (audio/mpeg vs audio/x-m4a vs octet-stream) - the URL's own extension
 * is the more reliable signal, and both are feed-controlled anyway; the
 * allowlist is what makes the choice safe.
 */
function enclosureExtension(enclosureUrl) {
  try {
    const p = new URL(enclosureUrl).pathname.toLowerCase();
    const ext = path.posix.extname(p);
    if (SAFE_AUDIO_EXTENSIONS.has(ext)) return ext;
  } catch { /* fall through */ }
  return '.mp3';
}

/**
 * The episode's on-disk filename: `<title, <=100ch> [rss=<guidKey>]<ext>`.
 */
function episodeFileName(title, guid, enclosureUrl) {
  return `${sanitizeEpisodeTitle(title)} [rss=${guidKey(guid)}]${enclosureExtension(enclosureUrl)}`;
}

/**
 * The in-flight temp name for a downloading enclosure. Dot-prefixed (the
 * scanner-invisible convention) + a distinctive suffix the sweep can target
 * without ever matching a finished file.
 */
function partFileName(finalName) {
  return `.${finalName}.ptpart`;
}

const PART_SUFFIX = '.ptpart';

module.exports = {
  sanitizeShowDirName,
  resolveShowDir,
  guidKey,
  sanitizeEpisodeTitle,
  enclosureExtension,
  episodeFileName,
  partFileName,
  PART_SUFFIX,
  MAX_SHOW_DIR_NAME_LENGTH,
  MAX_EPISODE_TITLE_LENGTH,
  SAFE_AUDIO_EXTENSIONS,
};
