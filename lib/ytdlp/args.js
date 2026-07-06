'use strict';

// Pure yt-dlp argument-array builders + path-confinement helpers. This file
// NEVER builds a shell command string -- every builder returns a flat
// `string[]` (one flag/value per element) that lib/ytdlp/run.js hands
// directly to `child_process.spawn('yt-dlp', argsArray, ...)`. No user value
// is ever concatenated into a single option string, and the positional
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
const { validateChannelUrl, buildWatchUrl } = require('./url');

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

// ---- SF4: filename confinement defense-in-depth ----------------------------
//
// `-o`'s filename component ultimately comes from video metadata (the title),
// which is attacker-controlled (a channel could title a video
// `"../../../etc/passwd"`). `resolveChannelDir` already confines the
// DIRECTORY the template is rooted at, but yt-dlp itself does the actual
// substitution/sanitization of `%(title)s` at download time -- these two
// helpers are the DEFENSE-IN-DEPTH layer for that step: `--restrict-filenames`
// (added to the download args below) is the first line of defense, asking
// yt-dlp to itself avoid special/unicode characters in generated filenames;
// `isPathUnder`/`realpathUnderChannelDir` are the second, structural one a
// caller can use to verify -- after the fact -- that whatever file yt-dlp
// actually produced still resolves under the confined channel dir, the same
// way `resolveChannelDir` verifies the dir itself.

/**
 * Pure containment check: does `candidate`'s resolved path equal `root`, or
 * live somewhere underneath it? No filesystem access; both inputs are
 * resolved (not assumed already-normalized) here. Non-string input is
 * rejected rather than thrown on, since this is meant to be usable directly
 * as a boolean guard.
 */
function isPathUnder(candidate, root) {
  if (typeof candidate !== 'string' || typeof root !== 'string' || candidate === '' || root === '') return false;
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(resolvedRoot + path.sep);
}

// T4: call this after each individual video download completes (before
// indexing it / treating it as a success) -- resolve the produced file's
// REAL path (following any symlink) and confirm it lands under the channel
// dir's real path. Treat `false` as a per-video failure (log + skip),
// exactly like any other spawn failure -- never a crash. Not wired here;
// this task only provides the helper + its unit test.
function realpathUnderChannelDir(filePath, channelDir) {
  let realFile;
  let realRoot;
  try {
    realFile = fs.realpathSync(filePath);
    realRoot = fs.realpathSync(channelDir);
  } catch {
    // Missing/unreadable path -- fail closed rather than assume safety.
    return false;
  }
  return isPathUnder(realFile, realRoot);
}

// ---- cookies (conditional, never logged) -----------------------------------

// C4: the ONE shared "cookies actually usable" predicate -- both this file's
// own `cookiesArgs` AND `lib/ytdlp/index.js`'s `cookiesConfigured` gate call
// this, so a cookies path that is SET but not actually mounted (a dangling
// `FILETUBE_YTDLP_COOKIES_FILE`) reads as "not usable" everywhere. Before
// this fix, `index.js` used a path-set check (`Boolean(config.cookiesFile)`)
// while this file used `fs.existsSync` -- the mismatch let a members-only
// video survive `shouldSkip` (which thought cookies were available) only to
// fail downstream when the download actually tried to use a missing file,
// reporting a confusing `error:` status instead of a clean skip.
function cookiesUsable(config) {
  return Boolean(config && typeof config.cookiesFile === 'string' && config.cookiesFile && fs.existsSync(config.cookiesFile));
}

// `--cookies <path>` is included ONLY when a cookies file is BOTH configured
// AND actually present on disk -- an operator who sets the ENV var but
// forgets to mount the file must fail safe to "no cookies" (members-only
// content stays skipped) rather than pass a dangling path to yt-dlp.
function cookiesArgs(config) {
  if (cookiesUsable(config)) {
    return ['--cookies', config.cookiesFile];
  }
  return [];
}

// Output filename template, confined to the per-channel dir. `%(id)s` is
// included alongside `%(title)s` so filenames stay distinguishable even when
// two videos share a title.
const OUTPUT_TEMPLATE = '%(title)s [%(id)s].%(ext)s';

// ---- v1.11.1 hotfix: bound the LIST pass to the newest N videos -----------
//
// Before this fix, `buildYtdlpListArgs` had NO scope limit at all: a fresh
// subscribe (or any re-pull) enumerated -- and would attempt to download --
// a channel's ENTIRE back-catalog, and the (execFile-era) `--dump-json`
// output for a sufficiently large/active channel could exceed the fixed
// `maxBuffer` lib/ytdlp/run.js used to enforce, aborting the whole listing
// before a single video was even considered. `--playlist-end <N>` bounds the
// LIST pass to yt-dlp's own newest-N-videos semantics; the DOWNLOAD pass
// (`buildYtdlpDownloadArgs`) does NOT need (or get) this flag -- it already
// targets only the explicit per-survivor `targetIds` the caller derived FROM
// this bounded list, so it is structurally bounded already.
function playlistEndArgs(config) {
  const maxVideos = config && config.maxVideos;
  // Only a positive integer becomes `--playlist-end <N>`. `0` is the
  // documented "unlimited" sentinel (config.js's DEFAULT_MAX_VIDEOS comment)
  // and deliberately omits the flag -- yt-dlp then considers the whole
  // channel, same as before this fix. A missing/non-numeric/negative value
  // (a malformed `config` this file didn't itself validate) ALSO omits the
  // flag -- failing safe to "no limit" rather than guessing a bound the
  // operator never configured, mirroring this file's other defensive
  // builders (e.g. `normalizeQuality`).
  if (typeof maxVideos === 'number' && Number.isInteger(maxVideos) && maxVideos > 0) {
    return ['--playlist-end', String(maxVideos)];
  }
  return [];
}

// ---- arg builders -----------------------------------------------------------

/**
 * Build the argv (flat string[]) for a metadata-only LIST pass: no files are
 * downloaded, one JSON object per video is printed to stdout for T4's
 * `parseYtdlpVideoList` to consume (dedup/shouldSkip/premiere-defer all run
 * on this metadata before any download is attempted). Bounded to the newest
 * `config.maxVideos` videos via `--playlist-end` (v1.11.1 hotfix; see
 * `playlistEndArgs` above) unless `maxVideos` is `0` (unlimited).
 */
function buildYtdlpListArgs(sub, config) {
  const validatedUrl = requireValidUrl(sub && sub.channelUrl);
  const archivePath = resolveArchivePath(config);
  const args = [
    '--dump-json',
    '--no-download',
    '--no-warnings',
    '--download-archive', archivePath,
    // v1.11.1 hotfix: bound the listing to the newest N videos (see
    // playlistEndArgs above) -- omitted entirely when maxVideos is 0/unset.
    ...playlistEndArgs(config),
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
 *
 * C1 (T4 fix round): `targetIds` -- a `string[]` of per-video ids the caller
 * has already filtered (dedup/premiere-defer/members-skip) -- replaces
 * `sub.channelUrl` as the positional target(s). This is what makes skip/defer
 * STRUCTURALLY binding on the child process instead of merely advisory: a
 * video whose id never appears in `targetIds` can never be fetched by this
 * spawn, no matter what `sub.channelUrl` points at. `requireValidUrl` on the
 * channel URL is deliberately NOT called here (the download pass no longer
 * targets the channel URL at all) -- `resolveChannelDir` still derives the
 * per-channel OUTPUT directory from `sub.name`/`sub.channelUrl` exactly as
 * before, which is a distinct (and still-validated, via `resolveChannelDir`
 * itself) concern from the download target.
 *
 * Each id is mapped through `buildWatchUrl` (host hardcoded to
 * `www.youtube.com`, id charset/length-bounded) and any id that fails
 * validation is silently dropped (fail-safe) rather than degrading to some
 * fallback target. If NO id survives, this throws -- a per-subscription
 * failure the poll loop already catches (logged -> safe `error:` status ->
 * continue) -- rather than ever producing a truncated/garbage arg array or
 * (worse) falling back to a whole-channel target.
 */
function buildYtdlpDownloadArgs(sub, config, targetIds) {
  const format = assertFormat(sub && sub.format);
  const quality = normalizeQuality(sub && sub.quality);
  const archivePath = resolveArchivePath(config);
  const channelDir = resolveChannelDir(config, sub);
  const outputTemplate = path.join(channelDir, OUTPUT_TEMPLATE);

  const targetUrls = (Array.isArray(targetIds) ? targetIds : [])
    .map((id) => buildWatchUrl(id))
    .filter((watchUrl) => watchUrl !== null);
  if (targetUrls.length === 0) {
    throw new Error('Refusing to build yt-dlp download args: no valid target video ids (targetIds was empty or every id failed validation)');
  }

  const args = [];
  // SF4: defense-in-depth against a hostile video title becoming a path
  // (yt-dlp itself avoids unsafe/unicode characters when generating
  // filenames from metadata) -- see the module comment above `isPathUnder`.
  args.push('--restrict-filenames');
  if (format === 'audio') {
    args.push('-x', '--audio-format', 'mp3');
  } else {
    args.push('-f', QUALITY_SELECTORS[quality]);
  }
  args.push('--download-archive', archivePath, '--no-warnings');
  args.push(...cookiesArgs(config));
  args.push('-o', outputTemplate);
  // ONE invocation, N positional URLs (never per-id spawns, never
  // `--abort-on-error` -- yt-dlp's default behavior of continuing to the next
  // URL on a per-video failure is exactly the isolation this needs). See
  // buildYtdlpListArgs above for why `--` must immediately precede the
  // positional target(s).
  args.push('--', ...targetUrls);
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
  cookiesUsable,
  isPathUnder,
  realpathUnderChannelDir,
  playlistEndArgs,
  QUALITY_ALLOWLIST,
  DEFAULT_QUALITY,
  OUTPUT_TEMPLATE,
};
