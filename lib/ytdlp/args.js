'use strict';

// Pure yt-dlp argument-array builders + path-confinement helpers. This file
// NEVER builds a shell command string -- every builder returns a flat
// `string[]` (one flag/value per element) that lib/ytdlp/run.js hands
// directly to `child_process.execFile('yt-dlp', argsArray, ...)`. No user
// value is ever concatenated into a single option string, and the positional
// channel URL always comes LAST, immediately after a `--` separator, so it
// can never be parsed as an option even if upstream validation were somehow
// bypassed (defense-in-depth on top of lib/ytdlp/url.js's allowlist).
//
// Side effects are limited to a single synchronous `fs.existsSync` check (is
// a cookies file present) -- there is no other I/O and no invocation here;
// nothing in this file spawns a process. Pure/testable without a real
// binary.

const fs = require('fs');
const path = require('path');
const { validateChannelUrl } = require('./url');

// ---- quality/format sanitization (T2-QA-folded; security-adjacent) -------
//
// `store.js` persists `format`/`quality` as user-supplied strings at
// add-time (already checked against `store.VALID_FORMATS` there). Because a
// hostile value could still reach this file directly (e.g. a future caller,
// or a subtly-corrupted db.json record), both are RE-ASSERTED here,
// independently of store.js's own checks, immediately before either value
// is allowed to influence an argv element.

const VALID_FORMATS = new Set(['audio', 'video']);
const DEFAULT_QUALITY = 'best';

// A fixed, known-safe set of resolution ceilings. Deliberately an ALLOWLIST
// (not a denylist of "bad" characters) -- nothing outside this set can ever
// become its own argv token, so a hostile quality string (`--exec`,
// `-f evil`, a 10KB blob, embedded whitespace/metacharacters) can never turn
// into a stray yt-dlp option.
const QUALITY_ALLOWLIST = new Set(['best', '2160p', '1440p', '1080p', '720p', '480p', '360p']);

// `-f` selectors per quality ceiling, video branch only (audio ignores this
// map -- see buildYtdlpDownloadArgs). `bestvideo+bestaudio/best` is yt-dlp's
// own documented fallback idiom: prefer separate best video+audio streams,
// falling back to a single combined "best" format when the site/extractor
// doesn't expose split streams.
const QUALITY_SELECTORS = {
  best: 'bestvideo+bestaudio/best',
  '2160p': 'bestvideo[height<=2160]+bestaudio/best[height<=2160]',
  '1440p': 'bestvideo[height<=1440]+bestaudio/best[height<=1440]',
  '1080p': 'bestvideo[height<=1080]+bestaudio/best[height<=1080]',
  '720p': 'bestvideo[height<=720]+bestaudio/best[height<=720]',
  '480p': 'bestvideo[height<=480]+bestaudio/best[height<=480]',
  '360p': 'bestvideo[height<=360]+bestaudio/best[height<=360]',
};

/**
 * Normalize a (possibly hostile) quality value. Anything outside the fixed
 * allowlist -- including an option-injection attempt, whitespace/shell
 * metacharacters, or an oversized string -- is safely defaulted to `'best'`
 * rather than rejected with an error: this keeps every builder call
 * side-effect-free and always producing a valid arg array, since `quality`
 * is a soft preference, never a value that should ever appear verbatim in
 * argv unless it is one of the seven known-safe tokens above.
 */
function normalizeQuality(rawQuality) {
  if (typeof rawQuality !== 'string') return DEFAULT_QUALITY;
  const trimmed = rawQuality.trim();
  return QUALITY_ALLOWLIST.has(trimmed) ? trimmed : DEFAULT_QUALITY;
}

/**
 * Re-assert `format` at build time. Unlike quality, an invalid format is a
 * hard error (never silently coerced) -- there is no safe default direction
 * to pick between "extract audio" and "download video," so callers (T4's
 * poll loop) must handle the throw as a per-subscription failure (log +
 * error status + continue), never as a crash.
 */
function assertFormat(format) {
  if (!VALID_FORMATS.has(format)) {
    throw new Error(`Invalid yt-dlp format: ${JSON.stringify(format)} (expected 'audio' or 'video')`);
  }
  return format;
}

// Re-validates the channel URL immediately before it is allowed to become a
// positional argv element -- defense-in-depth on top of the add-time check
// in store.js/the POST route. Throws (rather than returning a sentinel) so a
// malformed URL can never silently produce a truncated/garbage arg array;
// T4's spawn wrappers are expected to try/catch around the builder call.
function requireValidUrl(rawUrl) {
  const result = validateChannelUrl(rawUrl);
  if (!result.ok) {
    throw new Error(`Refusing to build yt-dlp args for an invalid channel URL: ${result.error}`);
  }
  return result.url;
}

// ---- path confinement ------------------------------------------------------

const MAX_CHANNEL_NAME_LENGTH = 150;

/**
 * Turn an arbitrary (possibly hostile) channel display name into a
 * filesystem-safe, single-segment folder name. The final character set is a
 * strict ALLOWLIST (letters, digits, space, underscore, dash) -- dots are
 * deliberately excluded entirely, not just literal `..` sequences, so no
 * ordering trick (unicode dot look-alikes, partial matches, etc.) can leave
 * a residual traversal segment behind. Never returns an empty string.
 */
function sanitizeChannelName(name) {
  if (typeof name !== 'string') return 'channel';
  let cleaned = name
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, '') // strip control characters
    .replace(/[/\\]/g, '-') // neutralize path separators (both slash styles)
    .replace(/\.\./g, '-'); // neutralize literal traversal sequences (belt-and-suspenders)
  // Collapse everything outside the safe charset (including any residual or
  // unicode dot-like character) to '-'.
  cleaned = cleaned.replace(/[^A-Za-z0-9 _-]/g, '-');
  cleaned = cleaned.trim().replace(/^-+/, '');
  if (cleaned.length > MAX_CHANNEL_NAME_LENGTH) cleaned = cleaned.slice(0, MAX_CHANNEL_NAME_LENGTH);
  cleaned = cleaned.trim();
  return cleaned === '' ? 'channel' : cleaned;
}

/**
 * Resolve (and confine) the per-channel download directory under
 * `config.downloadDir`. Throws if, after sanitization, the resolved path is
 * not the download root itself or a direct descendant of it -- this is the
 * actual traversal guard (sanitizeChannelName is the first line of defense,
 * this is the second, structural one: even a sanitizer bug cannot escape the
 * root because the resolved path is checked, not assumed safe).
 */
function resolveChannelDir(config, sub) {
  const root = path.resolve(config && config.downloadDir);
  const rawName = (sub && (sub.name || sub.channelUrl)) || 'channel';
  const candidate = path.resolve(root, sanitizeChannelName(rawName));
  if (candidate !== root && !candidate.startsWith(root + path.sep)) {
    throw new Error(`Refusing to resolve channel dir outside the download root: ${candidate}`);
  }
  return candidate;
}

// The download-archive is a single module-owned dotfile living directly
// under the download root (not per-channel) -- confinement is asserted the
// same way as resolveChannelDir for consistency, even though `path.join`
// with a fixed literal cannot itself escape the root.
function resolveArchivePath(config) {
  const root = path.resolve(config && config.downloadDir);
  const archivePath = path.join(root, '.ytdlp-archive.txt');
  if (archivePath !== root && !archivePath.startsWith(root + path.sep)) {
    throw new Error(`Refusing to resolve archive path outside the download root: ${archivePath}`);
  }
  return archivePath;
}

// ---- cookies (conditional, never logged) -----------------------------------

// `--cookies <path>` is included ONLY when a cookies file is BOTH configured
// AND actually present on disk -- an operator who sets the ENV var but
// forgets to mount the file must fail safe to "no cookies" (members-only
// content stays skipped) rather than pass a dangling path to yt-dlp.
function cookiesArgs(config) {
  if (config && typeof config.cookiesFile === 'string' && config.cookiesFile && fs.existsSync(config.cookiesFile)) {
    return ['--cookies', config.cookiesFile];
  }
  return [];
}

// Output filename template, confined to the per-channel dir. `%(id)s` is
// included alongside `%(title)s` so filenames stay distinguishable even when
// two videos share a title.
const OUTPUT_TEMPLATE = '%(title)s [%(id)s].%(ext)s';

// ---- arg builders -----------------------------------------------------------

/**
 * Build the argv (flat string[]) for a metadata-only LIST pass: no files are
 * downloaded, one JSON object per video is printed to stdout for T4's
 * `parseYtdlpVideoList` to consume (dedup/shouldSkip/premiere-defer all run
 * on this metadata before any download is attempted).
 */
function buildYtdlpListArgs(sub, config) {
  const validatedUrl = requireValidUrl(sub && sub.channelUrl);
  const archivePath = resolveArchivePath(config);
  const args = [
    '--dump-json',
    '--no-download',
    '--no-warnings',
    '--download-archive', archivePath,
    ...cookiesArgs(config),
    // The `--` separator MUST come immediately before the positional URL: it
    // tells yt-dlp's own arg parser "everything after this is a positional
    // argument, never an option" -- a second, independent guard against
    // option-injection even if `validateChannelUrl`'s leading-`-` check were
    // somehow bypassed upstream.
    '--',
    validatedUrl,
  ];
  return args;
}

/**
 * Build the argv (flat string[]) for a DOWNLOAD pass of the (already
 * filtered-by-T4) survivors. `sub.format`/`sub.quality` are re-validated here
 * (see normalizeQuality/assertFormat above) before they can influence any
 * flag.
 */
function buildYtdlpDownloadArgs(sub, config) {
  const validatedUrl = requireValidUrl(sub && sub.channelUrl);
  const format = assertFormat(sub && sub.format);
  const quality = normalizeQuality(sub && sub.quality);
  const archivePath = resolveArchivePath(config);
  const channelDir = resolveChannelDir(config, sub);
  const outputTemplate = path.join(channelDir, OUTPUT_TEMPLATE);

  const args = [];
  if (format === 'audio') {
    args.push('-x', '--audio-format', 'mp3');
  } else {
    args.push('-f', QUALITY_SELECTORS[quality]);
  }
  args.push('--download-archive', archivePath, '--no-warnings');
  args.push(...cookiesArgs(config));
  args.push('-o', outputTemplate);
  // See buildYtdlpListArgs above for why `--` must immediately precede the
  // positional URL.
  args.push('--', validatedUrl);
  return args;
}

module.exports = {
  buildYtdlpListArgs,
  buildYtdlpDownloadArgs,
  normalizeQuality,
  assertFormat,
  sanitizeChannelName,
  resolveChannelDir,
  resolveArchivePath,
  cookiesArgs,
  QUALITY_ALLOWLIST,
  DEFAULT_QUALITY,
  OUTPUT_TEMPLATE,
};
