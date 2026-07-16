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
const { validateChannelUrl, buildWatchUrl, isChannelRootUrl, isPlausibleMediaUrl } = require('./url');
const ytdlpConfig = require('./config');

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

// v1.37.5 (Dean: a "Skip" action on a failed download): the permanent
// per-video SKIP LIST. A skipped video id is recorded here so no future
// subscription poll re-attempts it. DELIBERATELY SEPARATE from
// `.ytdlp-archive.txt` (which means "already downloaded successfully") so the
// two concepts never bleed together -- a skip stays independently
// inspectable/reversible (a user can hand-edit this one file), and clearing
// the archive to force a re-download never accidentally un-skips a video the
// user permanently rejected. Same `<extractor> <id>` line format + same
// download-root confinement assertion as the archive above.
function resolveSkiplistPath(config) {
  const root = path.resolve(config && config.downloadDir);
  const skiplistPath = path.join(root, '.ytdlp-skiplist.txt');
  if (skiplistPath !== root && !skiplistPath.startsWith(root + path.sep)) {
    throw new Error(`Refusing to resolve skiplist path outside the download root: ${skiplistPath}`);
  }
  return skiplistPath;
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

// v1.41.13 (universal one-offs): the non-YouTube one-off template. The bracket
// carries the EXTRACTOR KEY as well as the id (`[Vimeo=76979871]`) so it stays
// globally unique and DISJOINT from the legacy 11-char YouTube bracket -- every
// shipped YouTube code path keeps matching only YouTube files (design D1;
// parsed back by url.js's extractMediaRef). yt-dlp sanitizes the rendered name
// per-OS (--windows-filenames), so the bracket is never required to round-trip;
// the authoritative {source, id} lives in metadata + the archive (D5).
const UNIVERSAL_OUTPUT_TEMPLATE = '%(title)s [%(extractor_key)s=%(id)s].%(ext)s';

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
//
// DORMANT as of v1.25 QoL T2: `buildYtdlpListArgs` no longer calls this --
// the count cap has been REPLACED by the date-based model (`dateAfterArgs`
// below, `--dateafter <cutoffDate>`, no count cap at all). This function (and
// `config.maxVideos`/`sub.maxVideos`, still parsed/persisted upstream) is
// left in place, still exported, purely to avoid churn in config.js/store.js
// and their own tests, which continue to reference `maxVideos` -- it simply
// no longer bounds anything.
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

// ---- v1.25 QoL T2 (v1.36 F1: fallback-shape only): --dateafter ------------
//
// HISTORY: v1.25 replaced the v1.11.1 count cap (`playlistEndArgs` above,
// dormant) with `--dateafter <sub.cutoffDate>` as the list pass's scoping
// mechanism. v1.36's gate then established two corrections, the second fatal
// to keeping this flag alongside a break filter:
//   1. `--dateafter` is a FILTER, not a stop condition -- yt-dlp still
//      enumerated and full-extracted every unarchived pre-cutoff video on
//      every poll (the production large-channel timeout incident).
//   2. (adversarial gate CRITICAL, verified against yt-dlp source) yt-dlp's
//      `_match_entry` evaluates the daterange check BEFORE match filters,
//      and a daterange rejection is a plain non-breaking skip -- so with
//      `--dateafter` present, a pre-cutoff entry is rejected before
//      `--break-match-filters` (which lives INSIDE the combined match
//      filter) ever sees it, and the break-early stop can NEVER fire.
//
// The list pass therefore emits this flag ONLY in the break-UNSAFE fallback
// shape (playlist-/watch-shaped subs, channelId-less fresh subs -- see
// `resolveBreakEarlyTarget` below), where there is no breaking filter to
// mask and its old filtering job is all that's wanted. In the break-safe
// shape it is ABSENT, and the authoritative per-video date gate is
// `rules.isBeforeCutoff` (lib/ytdlp/index.js's survivor loop -- which also
// covers the slack window the break filter deliberately lets through, and
// runs in BOTH shapes). Same validation contract as always: 8-digit
// re-assert, own argv elements, fail-safe [].
function dateAfterArgs(sub) {
  const cutoffDate = sub && sub.cutoffDate;
  if (typeof cutoffDate === 'string' && /^\d{8}$/.test(cutoffDate)) {
    return ['--dateafter', cutoffDate];
  }
  return [];
}

// ---- v1.36 F1: break-early listing (the "chronic burner" root cause) ------
//
// The pre-v1.36 list pass full-extracted a channel's entire unarchived back
// catalog on every poll (`--dateafter` filters what survives but never stops
// enumeration/extraction; pre-cutoff videos are never downloaded, so never
// archived, so re-fetched forever). At `--sleep-requests 1` a channel with a
// few hundred videos mechanically exceeded the list-pass timeout every
// single time (Dean's production logs: the identical large-catalog channels
// failing with "list pass timed out after 5.1m" on every run). Emitted here,
// all bounded/validated:
//
//   `--lazy-playlist`       -- process entries as enumerated (stop means
//                              stop: no up-front full-playlist collection).
//   `--break-match-filters upload_date>=?<cutoff minus SLACK>`
//                           -- STOP at the first video older than the
//                              slacked cutoff. Uploads feeds are
//                              newest-first, so everything past the first
//                              genuinely-old entry is older still. The `?`
//                              suffix makes an entry with NO upload_date (a
//                              live/premiere placeholder, or any flat entry
//                              during the incomplete-stage pre-check) PASS
//                              rather than break -- it still faces the JS
//                              rules filters, so nothing slips through; it
//                              just can't end the listing early.
//   `--playlist-end <cap>`  -- wall-clock backstop (config.listScanCap,
//                              default 200, 0 = off) for the pathological
//                              case where break-early never triggers.
//
// CRITICAL interplay (adversarial gate, verified against yt-dlp source):
// `--dateafter` must NOT be on this argv. yt-dlp's `_match_entry` runs the
// daterange check BEFORE the (combined) match filter that carries the
// breaking condition, and a daterange rejection is a plain, NON-breaking
// skip -- with both flags present every pre-cutoff entry is rejected by
// daterange first, the breaking filter never fires, and the listing walks
// on exactly as before. The breaking filter alone both rejects the entry
// AND aborts, so dropping `--dateafter` loses nothing; the authoritative
// per-video date gate is `rules.isBeforeCutoff` in the JS survivor loop.
//
// THE SLACK WINDOW (BREAK_EARLY_SLACK_DAYS): the break threshold is the
// cutoff minus a small fixed number of days, NOT the cutoff itself. A
// break condition converts "an out-of-order old-dated entry near the head"
// (a republished/un-privated video, a feed-ordering quirk) from a harmless
// skip into a listing-ending abort that would mask every genuinely-new
// video below it, on every poll. The slack tolerates out-of-order entries
// up to SLACK days old before breaking. Cost: entries between the slacked
// and real cutoffs are extracted and printed, then dropped by the JS date
// gate (`rules.isBeforeCutoff`) -- a few seconds per prolific channel,
// strictly less work than the pre-v1.36 full-catalog walk in every case.
//
// When break-early triggers, yt-dlp exits with code 101 (its documented
// "aborted by a --break-* condition" code) -- run.js's list invocation maps
// that to SUCCESS (see spawnYtdlp's `breakExitOk`); the JSON lines already
// printed before the break are the complete listing for the window.
//
// The cutoff is re-validated here EXACTLY like `dateAfterArgs` (8-digit
// string, own argv elements, never interpolated into a shell -- the
// `upload_date>=?` prefix is a literal and the suffix is the computed,
// fixed-shape 8-digit slacked date). No valid cutoff -> no break filter
// (fail safe to a no-date-bound full walk, still bounded by the cap; the
// JS survivor-loop date gate is a no-op there too, by the same validation).
const BREAK_EARLY_SLACK_DAYS = 7;

// v1.36 F1 fix round 2 (adversarial gate, NEW CRITICAL -- verified against
// yt-dlp master's youtube/_tab.py): a BARE channel URL does NOT resolve to
// one combined feed. yt-dlp rewrites it to the `/videos` tab and appends
// `/streams` and `/shorts` as SEPARATE tab playlists, and a break condition
// aborts the WHOLE process (only `--break-per-input` contains it, per input
// URL -- not per tab). So a working break filter on a bare channel URL
// breaks inside the videos tab on every poll and the streams/shorts tabs
// are never enumerated again: silent, permanent loss of two content
// classes. The fix: when (and ONLY when) the subscription is a channel-root
// URL AND carries a captured `UC…` channelId, the LIST pass targets the
// channel's UPLOADS playlist (`UU` + the id's suffix) instead -- the
// single, combined, newest-first feed of videos + shorts + streams, where a
// break is a genuine single-feed stop (and one feed is cheaper than three
// tab fetches). No channelId yet (a fresh sub -- the list pass itself
// backfills it from the first listed video, see lib/ytdlp/index.js), or a
// playlist-/watch-shaped subscription (NO newest-first guarantee -- a
// generic playlist whose head entry is old would break at entry one and
// list nothing, forever): NO break filter at all; those fall back to the
// pre-v1.36 `--dateafter` walk, bounded by the scan cap.
//
// The UU URL is CONSTRUCTED, not user input: a fixed literal plus the
// suffix of a `CHANNEL_ID_PATTERN`-validated id (re-validated HERE,
// defense-in-depth -- same posture as every other builder in this file),
// still passed as its own positional element after `--`.
const UPLOADS_CHANNEL_ID_PATTERN = /^UC[A-Za-z0-9_-]{22}$/;

function uploadsPlaylistUrl(sub) {
  const channelId = sub && sub.channelId;
  if (typeof channelId !== 'string' || !UPLOADS_CHANNEL_ID_PATTERN.test(channelId)) return null;
  return `https://www.youtube.com/playlist?list=UU${channelId.slice(2)}`;
}

// The single break-early-safety decision: safe ONLY on a single
// newest-first feed, i.e. a channel-root subscription whose combined UU
// uploads playlist we can actually derive. Everything else (playlist subs,
// watch-shaped subs, channelId-less subs) must never see a break filter.
// Returns the UU feed URL when safe, null otherwise.
function resolveBreakEarlyTarget(sub) {
  if (!sub || !isChannelRootUrl(sub.channelUrl)) return null;
  return uploadsPlaylistUrl(sub);
}

// Pure YYYYMMDD arithmetic (UTC, no DST edge): the validated 8-digit cutoff
// minus BREAK_EARLY_SLACK_DAYS, returned in the same fixed 8-digit shape.
function slackedBreakCutoff(cutoffDate) {
  const dt = new Date(Date.UTC(
    Number(cutoffDate.slice(0, 4)),
    Number(cutoffDate.slice(4, 6)) - 1,
    Number(cutoffDate.slice(6, 8)),
  ));
  dt.setUTCDate(dt.getUTCDate() - BREAK_EARLY_SLACK_DAYS);
  const pad = (n) => String(n).padStart(2, '0');
  return `${dt.getUTCFullYear()}${pad(dt.getUTCMonth() + 1)}${pad(dt.getUTCDate())}`;
}

function breakEarlyArgs(sub, config, opts = {}) {
  const out = [];
  const cutoffDate = sub && sub.cutoffDate;
  // v1.36 fix round 2: the break filter is emitted ONLY when the caller has
  // established break-early safety (a single newest-first feed target --
  // see resolveBreakEarlyTarget above). Default false: a caller that
  // doesn't decide gets the cap-only shape, never a break that could mask
  // content.
  if (opts.breakSafe === true && typeof cutoffDate === 'string' && /^\d{8}$/.test(cutoffDate)) {
    out.push('--break-match-filters', `upload_date>=?${slackedBreakCutoff(cutoffDate)}`);
  }
  // Defensive re-bound at build time (same posture as every builder here):
  // whatever reaches config.listScanCap is passed back through the parser,
  // so only a validated integer in [MIN, MAX] ever becomes an argv element.
  const cap = ytdlpConfig.parseListScanCap(config && config.listScanCap);
  if (cap > 0) {
    out.push('--playlist-end', String(cap));
  }
  if (out.length > 0) {
    out.unshift('--lazy-playlist');
  }
  return out;
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
//
// v1.36.1 CORRECTION (found while root-causing Dean's on-device "skipShorts
// sub still downloaded Shorts" report): the original literal keyed on
// `webpage_url` -- which yt-dlp ALWAYS canonicalizes to `watch?v=` form
// during full extraction, so the filter had never matched anything since it
// shipped (silently inert defense-in-depth; the JS layer was the only one
// working, and v1.36's UU-feed listing exposed ITS url-marker dependency
// too -- fixed with the shape fallback in `rules.isShort`). Keyed on
// `original_url` now: for a tab-/feed-listed entry that is the entry URL,
// which carries the `/shorts/` form whenever YouTube's renderer marks the
// entry as a Short. Still just defense-in-depth -- entries YouTube doesn't
// mark are caught by the JS shape fallback, never by this flag.
const SHORTS_MATCH_FILTER = 'original_url!*=/shorts/';

// ---- v1.22.0 FR-6: max-duration download gate (--match-filter, AND-joined) -
//
// CRITICAL, VERIFIED (not assumed): yt-dlp treats MULTIPLE `--match-filter`
// flags as OR'd together (a video passes if it satisfies ANY of them), not
// AND'd -- so requiring a video to pass BOTH the skip-Shorts filter AND the
// duration bound requires combining them into ONE `--match-filter` string,
// joined with ` & ` (yt-dlp's own filter-expression AND operator), rather
// than emitting `SHORTS_MATCH_FILTER` and the duration clause as two
// separate `--match-filter` args (which would let a Short OR an over-length
// video through, whichever it happened to satisfy). `buildMatchFilterArg`
// below is the single place this combination happens.
//
// `duration < <n>` is a FIXED-shape literal, exactly like SHORTS_MATCH_FILTER
// above -- the ONLY variable content is `<n>`, which is a re-validated,
// bounded, non-negative INTEGER (never a raw user string) by the time it
// reaches this function (see `resolveMaxDurationSeconds`/config.js's
// `parseMaxDurationSeconds`/store.js's `validateMaxDurationSeconds`), and the
// whole combined string is emitted as ONE argv element passed to `spawn`
// directly (never a shell) -- so `&` is inert data to yt-dlp's own
// filter-expression parser, never a shell operator, and there is no
// argv-injection surface no matter what a hostile duration value might
// otherwise have been (it cannot reach here un-validated).
//
// DELIBERATE (v1.22.0 product decision): the operator is the strict `<`, NOT
// yt-dlp's `<?` "match-if-field-absent" form. Items whose duration is UNKNOWN
// at list time (live/ongoing streams, extractors that omit duration) are
// therefore EXCLUDED along with over-cap items -- so a 2h-capped subscription
// never accidentally starts recording an unbounded live stream. Do not add a
// `?` suffix without an explicit product decision to reverse this.
function buildDurationClause(maxDurationSeconds) {
  return `duration < ${maxDurationSeconds}`;
}

/**
 * Pure: combine the active match-filter clauses into the single
 * `['--match-filter', <joined>]` argv pair yt-dlp requires to AND multiple
 * conditions together, or `[]` when no clause is active. `skipShorts` is
 * `true` only for the STRICT boolean `true` (mirroring this file's other
 * re-assert-at-build-time posture); `maxDurationSeconds` only contributes a
 * clause when it is a positive integer (`0`/unset/malformed means
 * "unbounded" -- no clause, mirroring `playlistEndArgs`'s own "0/malformed =
 * omit" semantics).
 * @param {{skipShorts?: boolean, maxDurationSeconds?: number}} opts
 * @returns {string[]} either `[]` or `['--match-filter', <clause-string>]`
 */
function buildMatchFilterArg({ skipShorts, maxDurationSeconds } = {}) {
  const clauses = [];
  if (skipShorts === true) clauses.push(SHORTS_MATCH_FILTER);
  if (typeof maxDurationSeconds === 'number' && Number.isInteger(maxDurationSeconds) && maxDurationSeconds > 0) {
    clauses.push(buildDurationClause(maxDurationSeconds));
  }
  if (clauses.length === 0) return [];
  return ['--match-filter', clauses.join(' & ')];
}

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
//
// v1.24.0 C5-ytdlp (T11, Wave 3): the field-selector grew TWO more keys --
// `upload_date`, `release_date` (both a `YYYYMMDD` string per yt-dlp's own
// documented convention, feeding C5's release-date capture). Exactly the SAME
// fixed-literal, JSON-escaped, one-line-safe posture as the five fields
// already selected above -- nothing per-video/per-sub is ever interpolated
// into this string; only the SET of keys `.{...}j` selects grew. A field
// yt-dlp does not populate for a given extractor/video (as is common for
// `release_date`, which is normally only set for premieres/livestreams)
// renders as JSON `null`, the SAME "absent, never literal data" convention
// already documented above -- there is no new failure mode, only a wider,
// best-effort field set.
//
// REMOVED (v1.25 QoL bugfix): this field-selector used to ALSO include
// `channel_thumbnail`, on the theory that it fed C6's channel-avatar
// capture. Verified against a live yt-dlp (2026.07.04) `--dump-json` for an
// actual video: that field simply does not exist on a per-video info dict --
// only `thumbnail`/`thumbnails` (the VIDEO's own thumbnails, never the
// channel's) are present there, so this was always a silent no-op (rendered
// JSON `null` every single time, the same "absent" convention `run.js`'s
// parser treats identically to a genuinely missing field) and
// `channelAvatarUrl` was NEVER actually captured through this per-video
// print line, for any video, ever. A real channel avatar now comes from
// `run.probeChannelAvatar` (lib/ytdlp/run.js), which hits the CHANNEL
// endpoint directly (`--dump-single-json --playlist-items 0`) -- the only
// place yt-dlp actually exposes a channel's own avatar/banner thumbnails --
// on subscribe and via a poll-time self-heal (lib/ytdlp/index.js), then
// serve-time-joined onto individual items (server.js's `GET /api/videos/:id`)
// by matching channelUrl/channelId against a subscription's own captured
// avatar. Keeping the dead `channel_thumbnail` key in this selector would
// have been misleading dead code -- removed entirely rather than left as a
// permanently-null field.
//
// v1.33 T3 (emoji-preserving display titles): the selector grew `title` --
// the video's REAL title, straight off the info dict, BEFORE the
// `--restrict-filenames` output-template sanitization that folds emoji/
// non-ASCII into underscores on the on-disk filename. Same fixed-literal,
// JSON-escaped posture as every other key here; bounded/sanitized downstream
// by `store.sanitizeCapturedTitle` (length cap + control-char strip), never
// trusted raw. This is what lets the UI show the true title (emoji intact)
// while the filename stays filesystem-safe.
const CHANNEL_META_SENTINEL = 'FTCHMETA';
const CHANNEL_META_PRINT_TEMPLATE = `after_move:${CHANNEL_META_SENTINEL} %(.{id,title,channel_url,channel_id,uploader_url,channel,upload_date,release_date})j`;

// ---- v1.29 T3(b): resilience pacing/retry flags (bot-check/429 mitigation) -
//
// `config.sleepRequests`/`sleepInterval`/`maxSleepInterval`/`retries` are
// already bounds-checked once, at parse time, by lib/ytdlp/config.js's
// `parseSleepSeconds`/`parseRetries` (see FILETUBE_YTDLP_SLEEP_REQUESTS etc.
// in README.md). `resolveSleepSeconds`/`resolveRetries` below RE-ASSERT those
// same bounds here, purely defensively, mirroring this file's other
// re-assert-at-build-time posture (`normalizeQuality`, `assertFormat`,
// `playlistEndArgs`, `dateAfterArgs` above): a bare/partial `config` object
// (a test fixture, or a future caller that doesn't route through
// `parseYtdlpConfig`) can never push a NaN/negative/non-finite/out-of-range
// value onto the yt-dlp argv -- it falls back to the same documented default
// instead. Reusing `parseSleepSeconds`/`parseRetries` directly (rather than
// re-implementing the bounds check) keeps the two files' notion of "valid"
// identical by construction; both functions already treat `undefined`/`''`/
// non-numeric input as "use the default," which is exactly what a bare
// config's missing field looks like.
function resolveSleepSeconds(config, key, defaultValue) {
  return ytdlpConfig.parseSleepSeconds(config && config[key], defaultValue);
}

function resolveRetries(config) {
  return ytdlpConfig.parseRetries(config && config.retries);
}

// GF1 F2 (post-gate fix): `config.playerClient` was previously trusted as
// already-safe purely because `config.js`'s `parseYtdlpConfig` validates it
// at ENV-parse time -- inconsistent with this file's own
// revalidate-at-every-boundary posture (`resolveSleepSeconds`/
// `resolveRetries` above, `normalizeQuality`/`assertFormat` elsewhere in this
// file). Not exploitable as shipped (env-only provenance, `shell:false`), but
// a bare/partial `config` object (a test fixture, a future caller that
// doesn't route through `parseYtdlpConfig`, or a forged/corrupted value) must
// never let an un-charset-checked string reach the argv element. Mirrors
// `resolveSleepSeconds`/`resolveRetries` EXACTLY: re-run the same validator
// `config.js` uses (`parsePlayerClient`) at THIS boundary too. A value that
// fails re-validation is treated exactly like "unset" -- returns `null`,
// never partially sanitized, never reaching the argv builder.
function resolvePlayerClient(config) {
  return ytdlpConfig.parsePlayerClient(config && config.playerClient);
}

// v1.31 P0: same revalidate-at-this-boundary posture for the socket timeout
// -- a bare/partial/forged config can never emit an unbounded or
// non-numeric --socket-timeout value.
function resolveSocketTimeout(config) {
  return ytdlpConfig.parseSocketTimeoutSeconds(config && config.socketTimeoutSeconds);
}

/**
 * Pure: build the four fixed-literal pacing/retry flags -- in the SAME order
 * as the committed flag table in the exec plan's Design section
 * (`--sleep-requests`, `--sleep-interval`, `--max-sleep-interval`,
 * `--retries`) -- plus, when configured, the two-element `--extractor-args
 * youtube:player_client=<value>` pair, as a flat argv array. Every flag NAME
 * here is a hardcoded literal; the only variable content is the
 * bounds-checked numeric VALUES (coerced to strings, exactly like every
 * other numeric flag this file already emits, e.g. `playlistEndArgs`) and
 * the charset/length-validated `playerClient` string -- RE-VALIDATED at THIS
 * boundary via `lib/ytdlp/config.js`'s `parsePlayerClient` (see
 * `resolvePlayerClient` above; GF1 F2), the SAME revalidate-at-every-boundary
 * posture `resolveSleepSeconds`/`resolveRetries` already establish for the
 * numerics -- NOT merely trusted because `config.js` already validated it
 * once upstream -- so this can never become an argv-injection vector no
 * matter what a hostile/bare/forged `config` might otherwise contain.
 * @param {object} config
 * @param {{listOnly?: boolean}} [opts] `listOnly: true` restricts the
 *   returned flags to the ones the LIST pass also wants (`--sleep-requests`/
 *   `--retries`) -- `--sleep-interval`/`--max-sleep-interval` only apply to
 *   an actual download (there is no "download interval" on a listing-only
 *   pass) and `--extractor-args youtube:player_client` is download-builder-
 *   only per the Design (kept off the list pass to avoid double-emitting a
 *   two-element pair the list builder has no other use for).
 * @returns {string[]}
 */
function resiliencePacingArgs(config, opts = {}) {
  const listOnly = Boolean(opts && opts.listOnly === true);
  const sleepRequests = resolveSleepSeconds(config, 'sleepRequests', ytdlpConfig.DEFAULT_SLEEP_REQUESTS);
  const retries = resolveRetries(config);
  // v1.31 P0: explicit, bounded --socket-timeout on EVERY pass (list AND
  // download). Under bot-detection YouTube hangs connections rather than
  // erroring; a bounded socket timeout converts a dead socket into a fast,
  // retryable failure so the pass fails (or recovers) within its budget
  // instead of silently burning it -- the H0 root cause behind the uniform
  // "timed out and was killed" cascade. Numeric, bounds-checked, String()-
  // coerced: the same non-injection posture as every other numeric flag.
  const socketTimeout = resolveSocketTimeout(config);

  if (listOnly) {
    return [
      '--socket-timeout', String(socketTimeout),
      '--sleep-requests', String(sleepRequests),
      '--retries', String(retries),
    ];
  }

  let sleepInterval = resolveSleepSeconds(config, 'sleepInterval', ytdlpConfig.DEFAULT_SLEEP_INTERVAL);
  let maxSleepInterval = resolveSleepSeconds(config, 'maxSleepInterval', ytdlpConfig.DEFAULT_MAX_SLEEP_INTERVAL);
  // Defensive re-clamp (parseYtdlpConfig already enforces this at parse
  // time) -- kept here too so a bare/partial config passed directly to this
  // builder can never emit an incoherent (max < interval) pair either.
  if (maxSleepInterval < sleepInterval) maxSleepInterval = sleepInterval;

  const args = [
    '--socket-timeout', String(socketTimeout),
    '--sleep-requests', String(sleepRequests),
    '--sleep-interval', String(sleepInterval),
    '--max-sleep-interval', String(maxSleepInterval),
    '--retries', String(retries),
  ];

  // FILETUBE_YTDLP_PLAYER_CLIENT: unset-by-default (config.playerClient is
  // `null` unless a charset/length-validated override was configured -- see
  // config.js's PLAYER_CLIENT_PATTERN). GF1 F2: `resolvePlayerClient`
  // RE-VALIDATES at this boundary (not just trusting the upstream parse) --
  // a value that fails re-validation resolves to `null` here, so the flag is
  // omitted exactly as if it had never been configured (same fail-safe as an
  // unset value). Emitted as TWO fixed-shape argv elements only when the
  // re-validated value is a non-empty string; the `youtube:player_client=`
  // prefix is a literal, and the appended value is charset/length-checked at
  // THIS boundary -- never interpolated raw user/subscription data (R3b.3's
  // non-injection posture).
  const playerClient = resolvePlayerClient(config);
  if (playerClient) {
    args.push('--extractor-args', `youtube:player_client=${playerClient}`);
  }
  return args;
}

// ---- arg builders -----------------------------------------------------------

/**
 * Build the argv (flat string[]) for a metadata-only LIST pass: no files are
 * downloaded, one JSON object per video is printed to stdout for T4's
 * `parseYtdlpVideoList` to consume (dedup/shouldSkip/premiere-defer all run
 * on this metadata before any download is attempted). Bounded to videos
 * uploaded on or after `sub.cutoffDate` via `--dateafter` (v1.25 QoL T2 --
 * see `dateAfterArgs` above) AND, since v1.36 F1, wall-clock-bounded by
 * `breakEarlyArgs` (lazy enumeration + stop at the first pre-cutoff video +
 * a `--playlist-end` backstop cap -- see its doc comment for why
 * `--dateafter` alone re-extracted the whole unarchived back catalog every
 * poll). Also bounded to items shorter than
 * `--match-filter "duration < <n>"` (v1.22.0 FR-6), where `<n>` is
 * `sub.maxDurationSeconds` when set, else the global
 * `config.maxDurationSeconds` -- `0` (from either source) means unbounded --
 * AND-joined with the skip-Shorts filter into a single `--match-filter` arg
 * by `buildMatchFilterArg` (see its doc comment above for why multiple
 * `--match-filter` flags cannot be used instead).
 */
function buildYtdlpListArgs(sub, config) {
  const validatedUrl = requireValidUrl(sub && sub.channelUrl);
  // v1.36 fix round 2: the break-early-safety decision + target swap -- the
  // UU uploads feed URL when safe, null otherwise. See
  // resolveBreakEarlyTarget's / the argv comment's rationale below.
  const breakEarlyTarget = resolveBreakEarlyTarget(sub);
  const archivePath = resolveArchivePath(config);
  // v1.22.0 FR-6: a per-subscription `maxDurationSeconds` override takes
  // precedence over the global `config.maxDurationSeconds` -- `sub.
  // maxDurationSeconds` is only consulted when it is not null/undefined, so
  // an explicit per-sub `0` (unbounded) is honored, and an unset/missing
  // per-sub value falls back to the global unchanged.
  const subMaxDurationSeconds = sub ? sub.maxDurationSeconds : undefined;
  const effectiveMaxDurationSeconds = subMaxDurationSeconds ?? (config && config.maxDurationSeconds);
  const args = [
    '--dump-json',
    '--no-download',
    '--no-warnings',
    // v1.29 T3(b): pacing/retry flags -- the listing pass is where a
    // bot-check/429 first bites, so it gets `--sleep-requests`/`--retries`
    // too (see resiliencePacingArgs's doc comment above; `listOnly: true`
    // omits the download-only sleep-interval/player_client flags).
    ...resiliencePacingArgs(config, { listOnly: true }),
    '--download-archive', archivePath,
    // v1.36 F1 (fix rounds 1+2, adversarial gate CRITICALs): TWO mutually
    // exclusive shapes, decided by `resolveBreakEarlyTarget` above:
    //
    //   BREAK-SAFE (channel-root sub with a captured UC channelId): the
    //   positional target below is the channel's combined UU uploads
    //   playlist (one newest-first feed) and the break filter is emitted.
    //   `--dateafter` must then be ABSENT -- yt-dlp's daterange check runs
    //   before match filters and its rejection is non-breaking, so a
    //   co-present `--dateafter` masks the breaking filter entirely and the
    //   break-early stop never fires (fix round 1, verified against
    //   source). The authoritative per-video date gate is
    //   `rules.isBeforeCutoff` in the JS survivor loop.
    //
    //   FALLBACK (playlist-/watch-shaped subs -- no newest-first guarantee;
    //   channelId-less fresh subs -- no UU feed derivable): NO break filter
    //   (on a bare channel URL it would break inside the /videos tab and
    //   permanently mask the separate /streams + /shorts tab playlists --
    //   fix round 2; on a generic playlist it could break at entry one),
    //   so `--dateafter` is restored (nothing to mask) and the walk is
    //   bounded by the scan cap + the pacing-scaled timeout, exactly the
    //   pre-v1.36 shape. The list pass self-heals a channel-root sub out of
    //   this shape by capturing channelId from its first successful listing
    //   (lib/ytdlp/index.js).
    ...(breakEarlyTarget ? [] : dateAfterArgs(sub)),
    ...breakEarlyArgs(sub, config, { breakSafe: breakEarlyTarget !== null }),
    // v1.15.0 item 4 + v1.22.0 FR-6: defense-in-depth Shorts filter AND/OR
    // the max-duration gate, AND-joined into ONE --match-filter (see
    // buildMatchFilterArg's doc comment above -- yt-dlp OR's multiple
    // --match-filter flags together, so they must never be emitted as two
    // separate args). `skipShorts` is re-asserted here independently of
    // store.js's own `validateSkipShorts` check (this file's other
    // re-assert-at-build-time posture) -- a truthy-but-non-`true` value (a
    // string, an object, `1`) contributes nothing. Applied on the LIST pass
    // ONLY, mirroring SHORTS_MATCH_FILTER's own placement (AC45: an
    // over-length item is skipped at list time and never becomes a download
    // target).
    ...buildMatchFilterArg({ skipShorts: sub && sub.skipShorts === true, maxDurationSeconds: effectiveMaxDurationSeconds }),
    ...cookiesArgs(config),
    // The `--` separator MUST come immediately before the positional URL: it
    // tells yt-dlp's own arg parser "everything after this is a positional
    // argument, never an option" -- a second, independent guard against
    // option-injection even if `validateChannelUrl`'s leading-`-` check were
    // somehow bypassed upstream. The break-safe target is the CONSTRUCTED
    // UU uploads URL (fixed literal + CHANNEL_ID_PATTERN-validated suffix,
    // see uploadsPlaylistUrl); the fallback target is the fully-validated
    // subscription URL, unchanged.
    '--',
    breakEarlyTarget || validatedUrl,
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

  // v1.41.13: the UNIVERSAL lane -- a non-YouTube one-off carries a
  // pre-validated `opts.sourceUrl` (isPlausibleMediaUrl at the route) instead
  // of YouTube video ids. Only ever set on a one-off (the subscription path
  // never sets it), so the YouTube download argv is byte-for-byte unchanged.
  const universal = oneOff && typeof opts.sourceUrl === 'string' && opts.sourceUrl !== '';
  const outputTemplate = path.join(channelDir, universal ? UNIVERSAL_OUTPUT_TEMPLATE : OUTPUT_TEMPLATE);

  let targetUrls;
  if (universal) {
    // Defense-in-depth: re-assert the loose gate immediately before the URL
    // becomes a positional argv element (the SAME single validator the route
    // used -- never a second, weaker check), mirroring how the YouTube path
    // re-derives every target through buildWatchUrl's host-hardcoded builder.
    const revalidated = isPlausibleMediaUrl(opts.sourceUrl);
    if (!revalidated.ok) {
      throw new Error(`Refusing to build yt-dlp download args: the one-off source URL failed re-validation (${revalidated.error})`);
    }
    targetUrls = [revalidated.url];
  } else {
    targetUrls = (Array.isArray(targetIds) ? targetIds : [])
      .map((id) => buildWatchUrl(id))
      .filter((watchUrl) => watchUrl !== null);
    if (targetUrls.length === 0) {
      throw new Error('Refusing to build yt-dlp download args: no valid target video ids (targetIds was empty or every id failed validation)');
    }
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
  // v1.41.3 (deletion tombstones, adversarial-gate finding): the scan's
  // deferred delete retry compares file mtime against the tombstone's
  // deletedAt -- "older than the delete" means "the file the user already
  // deleted". yt-dlp versions before 2025-07-01 (and ANY user-level yt-dlp
  // config with `--mtime`, which is honored since we don't pass
  // `--ignore-config`) back-date a download's mtime to the video's
  // Last-Modified/upload date -- which would make a deliberate RE-download
  // of a previously-deleted video look "older than the delete" and get
  // reaped by the next scan. `--no-mtime` pins the invariant (download time
  // = mtime) on every deployment; it is a no-op on the pinned Docker binary
  // (2026.7.4), whose default this already is.
  args.push('--no-mtime');
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
  // v1.34 T3 (chapters): `--embed-chapters` writes the video's chapter
  // markers into the downloaded container itself -- the scan's ffprobe
  // (-show_chapters) then captures them with zero extra network plumbing,
  // exactly like the embedded date/title tags. Fixed literal, degrades
  // gracefully on a chapterless video/incompatible container (a yt-dlp
  // warning, never a failure), same posture as --embed-thumbnail.
  args.push('--embed-metadata', '--embed-thumbnail', '--embed-chapters');
  // v1.24 UX Round A6 (T16, Wave 5): fixed-literal subtitle grab -- EXACTLY
  // the same non-injection posture as SHORTS_MATCH_FILTER/VIDEO_FORMAT_SORT
  // above: every token here is a hardcoded literal, never interpolated with
  // any per-sub/per-video value, so it can never become an argv-injection
  // vector no matter what a hostile subscription/video value might be.
  // `--write-subs`/`--write-auto-subs` grab both manually-authored and
  // auto-generated captions when the source offers them; `--sub-langs en.*`
  // scopes to English variants (en, en-US, en-GB, ...); `--sub-format vtt
  // --convert-subs vtt` requests VTT directly AND normalizes whatever format
  // was actually fetched (e.g. an extractor that only offers .srt/.ttml) to
  // VTT using yt-dlp's own bundled ffmpeg postprocessor -- so no separate
  // converter and NO new runtime dependency is needed for the download path
  // (the local lib/subtitles.js `srtToVtt` converter is a completely
  // separate code path, used only for a user's own local .srt sidecar).
  // Applied UNCONDITIONALLY, alongside --embed-metadata/--embed-thumbnail
  // above -- both formats (an audio download still captures any
  // spoken-word/lyric captions a source offers). Sidecar lands next to the
  // media file per OUTPUT_TEMPLATE, e.g. "My Video [dQw4w9WgXcQ].en.vtt" --
  // picked up by the scan's additive `hasSubtitles` detection (server.js)
  // and served by `GET /api/subtitles/:id` (server.js), neither of which
  // this file is involved in.
  args.push('--write-subs', '--write-auto-subs', '--sub-langs', 'en.*', '--sub-format', 'vtt', '--convert-subs', 'vtt');
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
  // v1.41.13 (universal one-offs): the extractor gate + single-item bound,
  // UNIVERSAL LANE ONLY (never the YouTube one-off or the subscription argv).
  //  - `--use-extractors default,-generic`: accept any NAMED extractor,
  //    REFUSE the generic scrape-any-page fallback (the SSRF posture -- design
  //    C2; verified against yt-dlp source that `default,-generic` composes and
  //    that a no-match yields a clean "No suitable extractor" stderr line).
  //  - `--no-playlist` AND `--playlist-items 1`: --no-playlist alone does NOT
  //    bound a pure-playlist URL (yt-dlp's `_yes_playlist` still expands it);
  //    --playlist-items 1 is the hard single-item bound (design W1). Both, so
  //    a video-in-playlist URL grabs the single video and a pure playlist URL
  //    grabs only its first item.
  if (universal) {
    args.push('--use-extractors', 'default,-generic', '--no-playlist', '--playlist-items', '1');
  }
  args.push('--no-warnings');
  // v1.29 T3(b): resilience pacing/retry flags (--sleep-requests/
  // --sleep-interval/--max-sleep-interval/--retries, plus the optional
  // --extractor-args youtube:player_client pair) -- see
  // resiliencePacingArgs's doc comment above. Emitted here, immediately
  // after --no-warnings and well before the `--`/positional target(s)
  // pushed at the very end of this function, so the host allowlist/`--`
  // separator/FORBIDDEN_CHARS/SF4/decoded-id-charset guards below are
  // completely untouched by this addition.
  args.push(...resiliencePacingArgs(config));
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
  UNIVERSAL_OUTPUT_TEMPLATE,
  normalizeQuality,
  assertFormat,
  sanitizeChannelName,
  resolveChannelDir,
  resolveArchivePath,
  resolveSkiplistPath,
  cookiesArgs,
  cookiesUsable,
  isPathUnder,
  realpathUnderChannelDir,
  playlistEndArgs,
  dateAfterArgs,
  // v1.36 F1: break-early listing builders + the safety decision, exported
  // for direct unit-test coverage (same posture as resiliencePacingArgs).
  breakEarlyArgs,
  uploadsPlaylistUrl,
  resolveBreakEarlyTarget,
  buildMatchFilterArg,
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
  // v1.29 T3(b): resilience pacing/retry flag builder, exported so unit
  // tests can exercise it directly (in addition to asserting it through
  // buildYtdlpListArgs/buildYtdlpDownloadArgs).
  resiliencePacingArgs,
};
