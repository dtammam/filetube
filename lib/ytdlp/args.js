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

// ---- v1.13.0 item 4: filetype/container allowlist (spawn-args-flagged) ----
//
// `store.js` persists `filetype` as a user-supplied string, format-partitioned
// (video vs audio have distinct valid containers) -- same posture as
// format/quality above: RE-ASSERTED here, independently of store.js's own
// checks, immediately before it can influence an argv element. This is the
// SINGLE source of truth for the allowlist; store.js imports it rather than
// forking its own copy.
//
// `'default'` is a member of BOTH sets and means "today's behavior": for
// audio, force `mp3` (unchanged from the historical hardcoded arg); for
// video, emit NO container flag at all (yt-dlp's own choice, unchanged from
// today). An unset/missing/mismatched/hostile value ALSO normalizes to
// `'default'` -- there is no error path here, mirroring `normalizeQuality`'s
// "soft preference, never a hard boundary" posture (unlike `assertFormat`).
const VALID_FILETYPES = {
  video: new Set(['mp4', 'mkv', 'webm', 'default']),
  audio: new Set(['mp3', 'm4a', 'opus', 'default']),
};
const DEFAULT_FILETYPE = 'default';

/**
 * Normalize a (possibly hostile) filetype/container value for the given
 * `format`. This is the LAST gate before argv: anything outside the fixed,
 * format-partitioned allowlist above -- an unknown format, a non-string, an
 * option-injection attempt (`--exec`), a path (`../x`), an object, or a
 * value that is valid for the OTHER format (e.g. a video extension supplied
 * alongside `format: 'audio'`) -- is safely defaulted to `'default'` rather
 * than rejected with an error, exactly like `normalizeQuality`. Never
 * throws.
 */
function normalizeFiletype(format, raw) {
  const allowed = VALID_FILETYPES[format];
  if (!allowed || typeof raw !== 'string') return DEFAULT_FILETYPE;
  return allowed.has(raw) ? raw : DEFAULT_FILETYPE;
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

// ---- v1.15.0 item 4: Shorts exclusion (defense-in-depth, JS filter binding) -
//
// The BINDING Shorts exclusion is the JS `rules.isShort` filter in
// `lib/ytdlp/index.js`'s survivor loop (C1 architecture: only ids that
// survive the JS filter ever become download targets). This `--match-filter`
// is a defense-in-depth layer applied to the LIST pass only -- a FIXED
// literal, never interpolated with any per-sub/per-video value, so it can
// never become an argv-injection vector no matter what a hostile
// `skipShorts` value might be (which is re-asserted as a strict boolean
// immediately below anyway).
const SHORTS_MATCH_FILTER = 'webpage_url!*=/shorts/';

// ---- v1.18.0 FR-1a: iOS-compatible H.264/AAC format sort (soft preference) --
//
// A FIXED literal, never interpolated with any per-sub/per-video value --
// like SHORTS_MATCH_FILTER above, it can never become an argv-injection
// vector. This is a `-S` (format SORT) field list, not an `-f` (format
// FILTER) selector: yt-dlp keeps this sort field first and appends its own
// default tie-breakers (res/fps/bitrate) after it, so within whichever
// height ceiling QUALITY_SELECTORS already applied, an H.264 (avc1) video +
// AAC (mp4a) audio stream is PREFERRED when one exists, but nothing is
// EXCLUDED -- a source with only VP9/AV1 (e.g. the 2160p/1440p tiers, which
// YouTube often serves only that way) still resolves to its best-available
// stream rather than failing selection. Applied unconditionally in the video
// branch of buildYtdlpDownloadArgs (every quality tier, every filetype
// selection including 'default'/'mkv'/'webm') -- see the FR-1a design notes.
const VIDEO_FORMAT_SORT = 'vcodec:h264,acodec:aac';

// ---- v1.20.0 FR-2: channel-identity capture print template (two-reviewer gate) --
//
// A FIXED literal, EXACTLY like SHORTS_MATCH_FILTER/VIDEO_FORMAT_SORT above --
// `CHANNEL_META_SENTINEL` and the `%(...)j` field-selector placeholder are the
// ONLY content of this string; nothing per-sub/per-video is ever interpolated
// into it, so it can never become an argv-injection vector no matter what a
// hostile subscription/video metadata value might be. It is added
// UNCONDITIONALLY to every download-pass build (both audio and video, both
// the subscription-poll path and the one-shot path -- there is only one
// `buildYtdlpDownloadArgs`, shared by both, see lib/ytdlp/index.js).
//
// The `after_move:` WHEN-prefix is LOAD-BEARING: a bare `--print` (with no
// WHEN-prefix) implies `--simulate`, which would silently skip the actual
// download. `after_move:` instead prints AFTER the file has been moved to its
// final on-disk path, so the download itself proceeds completely unaffected
// -- this flag exists purely to emit one extra parseable line to stdout per
// downloaded video (parsed by lib/ytdlp/run.js's `parseChannelMetaLine`,
// reusing the SAME streamed stdout line-splitter FR-E's progress parsing
// already uses -- no second spawn, no `--write-info-json`, no extra network
// round-trip).
//
// `FTCHMETA` is a fixed sentinel prefix so the parser can cheaply recognize
// this ONE line shape among yt-dlp's other stdout output (progress lines,
// warnings, etc.) without risking a false-positive match.
//
// SECURITY (two-reviewer-gate fix, post-release): the ORIGINAL version of this
// template rendered its fields tab-delimited via `%(id)s\t%(channel_url)s\t...`.
// yt-dlp's `%(field)s` string interpolation does NOT escape a literal newline
// that happens to be embedded in a free-text metadata field (e.g. `channel`,
// the creator's attacker-controlled display name) -- a channel name containing
// `"\nFTCHMETA\t<attacker-chosen-id>\thttps://youtube.com/@attacker\t..."`
// would have forged a SECOND, fully-parseable capture line, misattributing an
// attacker-chosen channel identity to an arbitrary video id. This template now
// instead selects a SUBSET of the info-dict via yt-dlp's `.{key,...}` field
// selector and converts it to a single JSON object with the `j` conversion
// (`%(.{id,channel_url,channel_id,uploader_url,channel})j`) -- JSON-encoding
// escapes every control character (including a literal newline) INSIDE a
// string value as the two-character sequence `\n`, so the entire print output
// is structurally guaranteed to be exactly one line, no matter what any field
// (including the free-text `channel` display name) contains. A missing/
// unavailable field renders as JSON `null` (yt-dlp's own behavior for this
// conversion), which `run.js`'s parser treats identically to the old `NA`/
// empty-string convention: absent, never literal data.
//
// This is defense-in-depth on TOP of `run.js` also now parsing this sentinel
// from stdout ONLY (never stderr) -- see that file's module comment. Between
// the two fixes, neither an embedded-newline forgery NOR a stderr-borne
// forged line can produce a rogue capture entry.
const CHANNEL_META_SENTINEL = 'FTCHMETA';
const CHANNEL_META_PRINT_TEMPLATE = `after_move:${CHANNEL_META_SENTINEL} %(.{id,channel_url,channel_id,uploader_url,channel})j`;

// ---- arg builders -----------------------------------------------------------

/**
 * Build the argv (flat string[]) for a metadata-only LIST pass: no files are
 * downloaded, one JSON object per video is printed to stdout for T4's
 * `parseYtdlpVideoList` to consume (dedup/shouldSkip/premiere-defer all run
 * on this metadata before any download is attempted). Bounded to the newest
 * N videos via `--playlist-end` (v1.11.1 hotfix; see `playlistEndArgs`
 * above), where N is `sub.maxVideos` when set (FR-C per-subscription
 * override), else the global `config.maxVideos` -- `0` (from either source)
 * means unlimited.
 */
function buildYtdlpListArgs(sub, config) {
  const validatedUrl = requireValidUrl(sub && sub.channelUrl);
  const archivePath = resolveArchivePath(config);
  // FR-C: a per-subscription `maxVideos` override takes precedence over the
  // global `config.maxVideos` (config.js's `FILETUBE_YTDLP_MAX_VIDEOS`,
  // default 25). `sub.maxVideos` is only consulted when it is NOT
  // null/undefined -- so an explicit per-sub `0` (unlimited) is honored, and
  // an unset/missing per-sub value falls back to the global UNCHANGED
  // (AC19). `playlistEndArgs` itself is untouched: it already reads
  // `.maxVideos` off whatever object it is handed and applies the same
  // "0/malformed = omit the flag" semantics either way.
  const subMaxVideos = sub ? sub.maxVideos : undefined;
  const effectiveMaxVideos = subMaxVideos ?? (config && config.maxVideos);
  const args = [
    '--dump-json',
    '--no-download',
    '--no-warnings',
    '--download-archive', archivePath,
    // v1.11.1 hotfix + FR-C: bound the listing to the newest N videos (see
    // playlistEndArgs above) -- omitted entirely when the effective
    // maxVideos is 0/unset.
    ...playlistEndArgs({ maxVideos: effectiveMaxVideos }),
    // v1.15.0 item 4: defense-in-depth Shorts filter, emitted ONLY when the
    // per-subscription toggle is the STRICT boolean `true` (re-asserted here
    // independently of store.js's own `validateSkipShorts` check, mirroring
    // this file's other re-assert-at-build-time posture) -- a truthy-but-
    // non-`true` value (a string, an object, `1`) emits nothing.
    ...(sub && sub.skipShorts === true ? ['--match-filter', SHORTS_MATCH_FILTER] : []),
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
 *
 * v1.15.0 item 6: an optional 4th arg `opts = { oneOff }`. `oneOff: true`
 * (the one-shot `runOneShot` path ONLY) bypasses the shared
 * `--download-archive` dedup (`--no-download-archive` + `--force-overwrites`)
 * so an explicitly-requested re-download actually overwrites the existing
 * file instead of being silently skipped as already-archived. Every
 * subscription call site omits `opts`/passes `oneOff` falsy, so
 * `--download-archive` (and D3 "deleted stays gone") is UNCHANGED there.
 * @param {object} sub
 * @param {object} config
 * @param {string[]} targetIds
 * @param {{oneOff?: boolean}} [opts]
 */
function buildYtdlpDownloadArgs(sub, config, targetIds, opts = {}) {
  const format = assertFormat(sub && sub.format);
  const quality = normalizeQuality(sub && sub.quality);
  const oneOff = Boolean(opts && opts.oneOff === true);
  // `resolveArchivePath` is still called UNCONDITIONALLY -- it is a cheap
  // confinement assertion (throws if the archive path would resolve outside
  // the download root) as much as a value lookup -- but its RESULT is only
  // consumed below in the subscription (non-one-off) branch.
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
  // SF4 / v1.15.0 item 5: defense-in-depth against a hostile video title
  // becoming a path (yt-dlp itself avoids unsafe/unicode characters when
  // generating filenames from metadata) -- see the module comment above
  // `isPathUnder`. `--windows-filenames` (replacing the previous
  // `--restrict-filenames`) still strips every path-dangerous character
  // (`/ \ : * ? " < > |`, control chars, trailing dots/spaces) but ALLOWS
  // spaces and ordinary punctuation, producing human-readable on-disk names
  // (e.g. `Link Miguel en Vivo [id].mp3` instead of the previous ASCII-
  // folded/underscored form). This is a DEFENSE-IN-DEPTH sanitizer flag
  // ONLY -- the AUTHORITATIVE path-traversal guard remains
  // `resolveChannelDir` (above) + the post-download
  // `realpathUnderChannelDir`/`quarantineEscapedDownloads` confinement
  // (lib/ytdlp/index.js), both of which are UNTOUCHED by this flag change.
  args.push('--windows-filenames');
  // FR-E: yt-dlp otherwise repaints a single progress line with carriage
  // returns (`\r`), which is not line-delimited and can't be split/parsed
  // safely. `--newline` makes it emit one full line PER PROGRESS UPDATE
  // instead, which lib/ytdlp/run.js's download path now parses (via
  // lib/ytdlp/progress.js) for live status. Harmless when nothing consumes
  // it (the LIST pass is untouched by this flag; it is download-only).
  args.push('--newline');
  // v1.13.0 item 4: filetype/container is re-asserted (never trusted from
  // sub.filetype directly) via normalizeFiletype -- see its doc comment
  // above. AUDIO: `-x --audio-format <fmt>`, generalized from the previous
  // hardcoded `mp3` ('default'/unset still resolves to `mp3`, unchanged
  // behavior). VIDEO: `--merge-output-format <ext>` is a LOSSLESS REMUX of
  // the already-selected streams into the chosen container -- deliberately
  // NEVER `--recode-video` (that would force a full CPU re-encode); omitted
  // entirely for `'default'`, which reproduces today's behavior (yt-dlp picks
  // its own container). Must be emitted BEFORE the `--`/positional target(s)
  // pushed below.
  const filetype = normalizeFiletype(format, sub && sub.filetype);
  if (format === 'audio') {
    const audioFmt = filetype === 'default' ? 'mp3' : filetype;
    args.push('-x', '--audio-format', audioFmt);
  } else {
    args.push('-f', QUALITY_SELECTORS[quality]);
    // FR-1a: soft H.264/AAC format-sort preference (see VIDEO_FORMAT_SORT's
    // doc comment above) -- applies to EVERY quality tier and EVERY filetype
    // selection (unconditional in this branch, not gated on `filetype`).
    args.push('-S', VIDEO_FORMAT_SORT);
    if (filetype !== 'default') {
      args.push('--merge-output-format', filetype);
    }
  }
  // FR-H: embed metadata (tags.title etc.) and, best-effort, the video's
  // thumbnail, for BOTH audio and video downloads -- each its own argv
  // element. ffmpeg (present in the pinned image) does the actual
  // postprocessing (audio postprocessor for mp3, container muxer for
  // mp4/mkv/webm). `--embed-thumbnail` degrades gracefully when the target
  // container cannot carry a thumbnail (a yt-dlp warning, not a failure) --
  // it never wedges or fails a download.
  args.push('--embed-metadata', '--embed-thumbnail');
  // v1.15.0 item 6: subscriptions (the default -- `oneOff` falsy) keep
  // `--download-archive` UNCHANGED (D3 "deleted stays gone" holds). A
  // ONE-OFF re-download instead bypasses the shared archive entirely
  // (`--no-download-archive`) and forces yt-dlp to overwrite any existing
  // on-disk file (`--force-overwrites`) rather than silently skipping an
  // already-archived id -- this is the explicit "download THIS video again"
  // user intent, scoped to the one-shot path only (see runOneShot in
  // lib/ytdlp/index.js, which is the only caller that ever sets
  // `opts.oneOff: true`).
  if (oneOff) {
    args.push('--no-download-archive', '--force-overwrites');
  } else {
    args.push('--download-archive', archivePath);
  }
  args.push('--no-warnings');
  args.push(...cookiesArgs(config));
  // v1.20.0 FR-2: fixed-literal channel-identity capture print (see
  // CHANNEL_META_PRINT_TEMPLATE's doc comment above -- `after_move:` keeps
  // this a real download, never `--simulate`). Emitted before the `-o`
  // template / `--`/positional targets, unconditionally, for both formats.
  args.push('--print', CHANNEL_META_PRINT_TEMPLATE);
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
  normalizeFiletype,
  QUALITY_ALLOWLIST,
  DEFAULT_QUALITY,
  VALID_FILETYPES,
  DEFAULT_FILETYPE,
  SHORTS_MATCH_FILTER,
  VIDEO_FORMAT_SORT,
  OUTPUT_TEMPLATE,
  CHANNEL_META_SENTINEL,
  CHANNEL_META_PRINT_TEMPLATE,
};
