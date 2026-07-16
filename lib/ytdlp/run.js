'use strict';

// The ONLY module in lib/ytdlp/ that touches `child_process`. Every
// invocation goes through an ARGUMENT ARRAY, never a shell string, and never
// sets `shell: true`. This mirrors server.js's FFmpeg pattern (`spawn('ffmpeg',
// args)`, server.js:665) and RELIABILITY.md's "wrap spawn/filesystem calls in
// try/catch; log and degrade, never crash."
//
// This file is a THIN invocation seam only: `runList`/`runDownload` just
// build args (via ./args.js) and call the spawn wrappers below. There is no
// scheduling, dedup, shouldSkip/premiere filtering, or db write here -- that
// is T4's poll loop. Nothing in this file runs at import time or as a side
// effect of requiring it.

// `child_process` is required as a whole module (not destructured) and its
// methods are referenced at CALL time inside the spawn wrappers, rather than
// bound to a local const at require time. This is what lets tests spy on the
// real spawn boundary by monkey-patching `require('child_process').spawn`
// (no mocking library / no dependency injection needed) and still prove the
// exact call shape (`'yt-dlp'`, an array, no `shell: true`) that production
// code takes. (Both the LIST and DOWNLOAD paths use `cp.spawn` -- `execFile`
// is no longer called anywhere in this file; see the LIST-path module
// comment below for why.)
const cp = require('child_process');
// Used to decode the bounded stderr tail (both paths) BOUNDARY-SAFELY --
// see the multibyte-UTF-8 note near `STDERR_TAIL_LIMIT`, below.
const { StringDecoder } = require('string_decoder');
// `repullItemMetaAndSubs`'s Pass B (below) computes a sidecar path PINNED to
// the existing on-disk media file's own directory/basename -- never a
// yt-dlp-generated title template -- so this module needs `path` itself,
// unlike every other function here (which only ever hands yt-dlp an OUTPUT
// TEMPLATE string built by ./args.js).
const path = require('path');
// v1.41.5: Pass B's skip classifier needs to tell "this file genuinely lives
// outside the download root" (structural -- never retry) apart from "its path
// could not be resolved right now" (a NAS/mount blip -- stay retryable), which
// `realpathUnderChannelDir` collapses into a single fail-closed `false`. A bare
// `fs.realpathSync` probe is the cheapest way to distinguish them, and it is
// the SAME primitive that helper itself uses (no forked path logic).
const fs = require('fs');
const {
  buildYtdlpListArgs,
  buildYtdlpDownloadArgs,
  CHANNEL_META_SENTINEL,
  cookiesArgs,
  // `repullItemMetaAndSubs`'s Pass B confinement guard (below) -- the SAME
  // structural check (`fs.realpathSync` both sides, then `isPathUnder`) the
  // download path already uses to confirm a produced file lands under its
  // confined channel dir; reused verbatim here against `config.downloadDir`,
  // never forked.
  realpathUnderChannelDir,
} = require('./args');
// v1.31 P0: the list-pass budget scales with the pacing config (see
// `resolveListTimeoutMs`, below) -- the parse*/DEFAULT_* re-validation
// helpers come straight from config.js so "valid" stays defined in exactly
// one place (the same posture args.js's resolve* helpers use).
const ytdlpConfig = require('./config');
// FR-E: the pure progress-line parser. This file feeds it already-decoded
// plain-text lines from yt-dlp's OWN stdout/stderr on the DOWNLOAD path only
// -- see `spawnYtdlpDownload`'s `onProgress` handling, below. The parser
// itself never sees the argv/cookies path (SF1 is unaffected).
const { parseProgressLine } = require('./progress');
// v1.24.0 A2 (T14): the pure per-item failure-attribution parser -- see that
// file's own module comment for the full "never misattribute" contract.
// This file feeds it already-decoded stderr lines the SAME way it feeds
// `parseProgressLine`, below.
const { parseItemFailureLine } = require('./failures');
// `repullItemMetaAndSubs`'s Pass A (below) derives `releaseDate` and
// `channelAvatarUrl` INDEPENDENTLY via these two standalone validators --
// deliberately NOT `store.sanitizeCapturedChannelMeta` (the combined
// download-time capture validator), whose `channelUrl`-required posture would
// otherwise drop a perfectly good `release_date`/`upload_date` just because
// the JSON's channel URL is missing/odd, which is unacceptable for a
// date-focused backfill. No date parsing / URL validation is reimplemented
// here -- both are the SAME functions `sanitizeCapturedChannelMeta` itself
// calls internally (store.js). No cycle: store.js requires only ./args +
// ./url, never ./run.
// v1.25 QoL bugfix: `probeChannelAvatar` (below) also uses `selectChannelAvatarUrl`
// -- the pure heuristic that picks the AVATAR entry (never a banner) out of a
// channel endpoint's raw `thumbnails[]` array. Same "reused, never forked"
// posture as the other two imports on this line.
// v1.41.5 (MeTube-import hydration): `repullItemMetaAndSubs`'s Pass A now ALSO
// reads the CHANNEL IDENTITY out of the very same `--dump-json` payload it
// already fetches for the date/title/chapters -- and for THAT it does use the
// combined `sanitizeCapturedChannelMeta` (unlike the field-level validators
// above): identity is exactly the all-or-nothing bundle that validator owns
// (a `channelUrl`/`uploaderUrl` that survives `validateChannelUrl` or no
// identity at all), so reusing it keeps ONE validation gate across the
// download-capture path and this backfill instead of forking a second one.
// Its `channelUrl`-required posture is a feature here, not the liability it
// would be for a date.
const { parseCapturedReleaseDate, sanitizeCapturedTitle, sanitizeChannelAvatarUrl, selectChannelAvatarUrl, sanitizeCapturedChannelMeta, CHANNEL_ID_PATTERN } = require('./store');
// v1.25.x QoL bugfix (channel avatar REGISTRY): `probeChannelAvatar` (below)
// now ALSO extracts+validates the channel's stable `channel_id`/`channel_url`
// out of the SAME `--dump-single-json` payload it already parses for the
// avatar -- reuses the UNMODIFIED `url.validateChannelUrl` (no forked/second
// copy), exactly like `store.sanitizeCapturedChannelMeta` already does for a
// per-video capture. No circular require: `url.js` has zero requires of its
// own (verified), so `run.js -> url.js` is a one-way edge, same posture as
// `run.js -> store.js` above.
// v1.41.5: `classifySingleVideo` turns the (already-validated) watch URL Pass A
// was handed back into its bare video id -- the join key
// `sanitizeCapturedChannelMeta` requires. Same one-way `run.js -> url.js` edge.
const { validateChannelUrl, classifySingleVideo } = require('./url');

// LIST pass: metadata-only (`--dump-json`), no file is ever written. Its
// stdout IS the JSON T4/rules.js parses. This USED to go through `execFile` +
// a fixed `maxBuffer` (10MB) on the theory that a channel's metadata dump is
// "large but finite and known ahead of time" -- that assumption was wrong: a
// channel with enough videos legitimately exceeds 10MB of `--dump-json`
// output, and Node's response to a `maxBuffer` overrun is to SIGTERM the
// child before a single video is even considered, i.e. any sufficiently
// large/active channel could never be listed at all (the production bug this
// hotfix fixes). The list path now uses `cp.spawn` (see `spawnYtdlp`, below)
// -- the same streaming approach `spawnYtdlpDownload` already used for
// downloads -- so there is no size-based cap that can ever abort a valid
// listing. Real-world size is separately (and primarily) bounded by
// `--playlist-end` (lib/ytdlp/args.js's `buildYtdlpListArgs`, driven by the
// `FILETUBE_YTDLP_MAX_VIDEOS` config / `config.maxVideos`, default 25 newest
// videos) -- `spawn` without a maxBuffer is defense-in-depth on top of that
// bound (including for the `maxVideos: 0` "unlimited" case), not a
// replacement for it.

// Non-zero spawn timeouts (SF2). `timeout: 0` is UNBOUNDED in Node -- a
// livestream/premiere/slowloris URL would otherwise hang the child forever
// and wedge the (T4) poll loop's awaiting promise. Listing metadata is a
// quick network round-trip so it gets a short ceiling; a real download can
// legitimately run for a long time, so it gets a much longer one. Both are
// finite so a hung child is always eventually reclaimed.
const DEFAULT_LIST_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes -- a listing/metadata pass should be quick
// FIX 2 (two-reviewer gate, post-v1.25.0): a DEDICATED, much shorter timeout
// for `probeChannel` (below) -- a single-video `--dump-json` probe is one
// video's worth of metadata, not a whole channel's, so it never needs
// `DEFAULT_LIST_TIMEOUT_MS`'s full 5-minute channel-enumeration budget.
// This matters because (pre-fix) `probeChannel` was the FIRST thing
// `runOneShot` awaited, and the WHOLE of `runOneShot` ran inside the shared
// `runExclusive` FIFO gate (`lib/ytdlp/index.js`) that subscription polls
// share -- so a slow/hung probe could hold that global download/poll gate
// for up to 5 minutes before its own download even started. FIX 2's other
// half (`lib/ytdlp/index.js`) moves the probe OUTSIDE the exclusive
// section entirely; this shorter timeout is a second, independent bound on
// top of that restructure -- even an UNlocked hung probe should not linger
// indefinitely.
const PROBE_TIMEOUT_MS = 30 * 1000; // 30 seconds -- a single-video probe, never a whole-channel budget
// `repullItemMetaAndSubs`'s dedicated timeout (below): a metadata-only
// `--dump-json` pass or a subtitles-only pass, each for ONE already-downloaded
// video, is closer in shape to `PROBE_TIMEOUT_MS`'s single-video budget than
// to a whole-channel LIST pass -- but subtitle extraction/conversion can
// legitimately take a bit longer than a bare metadata dump, so this gets its
// own, slightly larger, dedicated constant rather than reusing
// `PROBE_TIMEOUT_MS` or (especially) the 5-minute `DEFAULT_LIST_TIMEOUT_MS`
// (a backfill loop calling this once per existing item must never let a
// single hung video consume anywhere near that long). Applied to BOTH passes
// independently (each gets its own full budget), not summed.
const REPULL_TIMEOUT_MS = 60 * 1000; // 60 seconds -- one pass, for one already-downloaded video
// v1.15.1 hotfix: raised from a hardcoded 60 minutes to 180 (3 hours) -- a
// multi-gigabyte video (yt-dlp downloads video+audio as separate streams,
// then merges them) can legitimately take well over an hour on a modest home
// connection, and hitting the old 60-minute ceiling SIGKILLed the child
// mid-download every time, always leaving intermediate/partial files behind
// (lib/ytdlpIntermediates.js). This constant is now only the FALLBACK used
// when a caller doesn't supply a `config` with its own
// `downloadTimeoutMinutes` (see `resolveDownloadTimeoutMs`, below) -- the
// real, configurable ceiling is `config.downloadTimeoutMinutes`
// (FILETUBE_YTDLP_DOWNLOAD_TIMEOUT_MINUTES, lib/ytdlp/config.js), which
// defaults to this same 180 minutes.
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 180 * 60 * 1000; // 180 minutes -- a real video download can legitimately take a while

// `SIGKILL` (not `SIGTERM`) so a wedged/hung yt-dlp process is unconditionally
// reclaimed -- a hung child is, by definition, not responding to signals it
// could otherwise handle gracefully, and there is no cleanup yt-dlp needs to
// do on our behalf (a killed download simply leaves a partial file, which is
// already the outcome of any other yt-dlp failure and is handled the same way
// downstream: re-polled/re-attempted, never silently treated as success).
const DEFAULT_KILL_SIGNAL = 'SIGKILL';

// v1.31 P0: human-readable budget for timeout/stall reasons. Minutes to one
// decimal only when needed ("5m", "7.5m") -- these strings land verbatim in
// persisted lastStatus/runlog reasons, so keep them short and stable.
function formatTimeoutMinutes(ms) {
  const mins = ms / 60000;
  const rounded = Math.round(mins * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}m`;
}

// v1.31 P0 (the H0 fix): the LIST pass budget is no longer a blind constant.
// Base = config.listTimeoutMinutes (FILETUBE_YTDLP_LIST_TIMEOUT_MINUTES,
// default 5). On top of the base, the budget SCALES with the pacing config
// that legitimately slows a listing down: each considered entry costs
// roughly ESTIMATED_REQUESTS_PER_ENTRY HTTP requests, and each request pays
// `--sleep-requests` seconds of deliberate sleep -- v1.29 added that pacing
// WITHOUT growing this budget, which is exactly how Dean's production run
// produced twenty identical 5-minute timeout kills (H0).
//
// v1.36 F1 (QA gate CRITICAL): the entry count driving the pacing term is
// now `config.listScanCap` -- the count the list pass can ACTUALLY extract
// up to (breakEarlyArgs's `--playlist-end` backstop) -- not the dormant
// `maxVideos` download-count field (default 2), whose 6-second pacing term
// reproduced the incident's exact 5.1m budget. The H0 principle restated:
// whatever bound the argv lets yt-dlp walk to, the budget must pay for.
// With break-early triggering (the overwhelmingly common case) a listing
// finishes in seconds and never approaches this ceiling; the bigger budget
// only binds when the walk is genuinely productive toward the cap -- which
// must SUCCEED, not die at 5.1m with the pre-v1.36 signature. A hung
// connection still fails fast via --socket-timeout/--retries, never by
// waiting out this ceiling. `listScanCap: 0` ("cap off") scales as
// UNLIMITED_SCALING_STAND_IN entries -- a stand-in, not a promise -- and
// the whole budget stays capped at MAX_LIST_TIMEOUT_MS so a pathological
// config can never make a hung listing effectively unbounded (SF2 still
// holds: the budget is always finite).
const ESTIMATED_REQUESTS_PER_ENTRY = 3;
const UNLIMITED_SCALING_STAND_IN = 100;
const MAX_LIST_TIMEOUT_MS = 60 * 60 * 1000; // 60 minutes -- absolute list-budget cap
function resolveListTimeoutMs(sub, config) {
  const baseMinutes = ytdlpConfig.parseListTimeoutMinutes(config && config.listTimeoutMinutes);
  const sleepRequests = ytdlpConfig.parseSleepSeconds(
    config && config.sleepRequests,
    ytdlpConfig.DEFAULT_SLEEP_REQUESTS,
  );
  const scanCap = ytdlpConfig.parseListScanCap(config && config.listScanCap);
  const entries = scanCap > 0 ? scanCap : UNLIMITED_SCALING_STAND_IN;
  const pacingMs = entries * ESTIMATED_REQUESTS_PER_ENTRY * sleepRequests * 1000;
  return Math.min(baseMinutes * 60 * 1000 + pacingMs, MAX_LIST_TIMEOUT_MS);
}

// Bounded tail kept for stderr (both the list and download paths) for
// diagnostics ONLY -- SF3 is explicitly about NOT accumulating stderr in an
// unbounded buffer (a download's periodic progress output, or a listing's
// warnings, can in principle be large over a long-running process, and with
// `execFile` + `maxBuffer` would eventually SIGTERM the child). This tail is
// small and fixed-size regardless of how long the process runs or how much
// it prints.
//
// The tail is built from a per-stream `StringDecoder('utf8')`, NOT repeated
// independent `chunk.toString()` calls: a raw Buffer chunk boundary can land
// in the MIDDLE of a multi-byte UTF-8 character (e.g. an emoji/CJK character
// in yt-dlp's warning/progress text), and decoding each chunk independently
// would corrupt it into U+FFFD on both sides of the split. `StringDecoder`
// buffers an incomplete trailing byte sequence internally until its
// continuation arrives in a later chunk, so only the fully-bounded string
// output is ever sliced to the fixed tail length -- never the raw bytes.
const STDERR_TAIL_LIMIT = 4096;

// v1.20.0 FR-2: a hard cap on how many parsed channel-meta lines a single
// download spawn ever accumulates. In normal operation there is exactly one
// `FTCHMETA` line per downloaded video (args.js's `--print after_move:`
// template, emitted once per target), and a single `runDownload` call never
// targets more than a modest number of survivor ids -- but this cap exists
// as the SAME defensive posture as `STDERR_TAIL_LIMIT`: a pathological/
// adversarial yt-dlp output (or a future template bug that emits the line
// more than once per video) must never let this in-memory array grow
// unbounded for the lifetime of one spawn. Exported like `STDERR_TAIL_LIMIT`
// so tests can assert the cap against the real constant.
const MAX_CAPTURED_META = 1000;

/**
 * v1.20.0 FR-2: pure parser for the `--print after_move:FTCHMETA <json>` line
 * `args.js`'s download builder adds to stdout (see
 * `CHANNEL_META_PRINT_TEMPLATE`'s doc comment there). Recognizes ONLY a line
 * that starts with the fixed `FTCHMETA ` sentinel (sentinel + a single
 * space); anything else (a normal `--newline` progress line, a warning, blank
 * output) returns `null` and is left for `parseProgressLine` to handle
 * exactly as before this feature.
 *
 * SECURITY (two-reviewer-gate fix, post-release): the payload after the
 * sentinel is now a SINGLE JSON object (see `CHANNEL_META_PRINT_TEMPLATE`'s
 * `.{...}j` field selector) rather than a tab-delimited string -- JSON.parse
 * is the ONLY thing that ever splits this payload into fields, so an
 * embedded newline inside any field's value (e.g. a hostile `channel` display
 * name) can never forge a second, independently-parseable capture line: it
 * arrives already escaped as the two-character sequence `\n` INSIDE the JSON
 * string, never as a raw line break. A payload that fails `JSON.parse` (a
 * corrupt/truncated line, or anything else that merely happens to start with
 * the sentinel) is treated as malformed and this returns `null` -- it must
 * NEVER throw, since a throw here would otherwise propagate out of the
 * streamed line-splitter and break the whole download.
 *
 * yt-dlp's `%(...)j` JSON conversion renders an unavailable field as JSON
 * `null` (its own convention for this conversion, distinct from the `NA`
 * string used by plain `%(field)s` interpolation); an empty string is also
 * possible. Both normalize to `null` (absent) on the returned object -- never
 * treated as literal data.
 *
 * IMPORTANT: this function is wired to run ONLY against the DOWNLOAD
 * spawn's STDOUT line stream (see `spawnYtdlpDownload` below) -- `--print`
 * only ever writes to stdout, so parsing stderr for this sentinel gains
 * nothing and is a needless attack surface: yt-dlp echoes other
 * attacker-controlled, potentially MULTI-LINE text (e.g. video descriptions)
 * to stderr, and a raw (non-JSON-escaped) newline there could otherwise be
 * used to plant a line that merely LOOKS like a capture line. Stderr lines
 * are never handed to this parser at all, regardless of their shape.
 *
 * Returned values are RAW, UNVALIDATED strings straight from yt-dlp's own
 * stdout (untrusted input) -- this function does NO validation itself; see
 * `store.sanitizeCapturedChannelMeta` for the mandatory validation gate that
 * MUST run before any of these values are persisted or used.
 *
 * v1.25 QoL bugfix: NO LONGER surfaces a `channelThumbnail` field. The
 * per-video `channel_thumbnail` key this used to read (`args.js`'s
 * `CHANNEL_META_PRINT_TEMPLATE`) was verified against a live yt-dlp
 * (2026.07.04) `--dump-json` for an actual video and does not exist there --
 * only `thumbnail`/`thumbnails` (the VIDEO's own thumbnails, not the
 * channel's) are present on a per-video info dict, so this field was always
 * `null` and `channelAvatarUrl` was never captured through this path. A real
 * channel avatar now comes from `probeChannelAvatar` (below), which hits the
 * CHANNEL endpoint directly (`--dump-single-json --playlist-items 0`), the
 * only place yt-dlp actually exposes it.
 * @param {*} line a single already-decoded, newline-stripped line
 * @returns {{videoId: (string|null), channelUrl: (string|null), channelId: (string|null), uploaderUrl: (string|null), channelName: (string|null), uploadDate: (string|null), releaseDate: (string|null)} | null}
 */
function parseChannelMetaLine(line) {
  if (typeof line !== 'string') return null;
  const prefix = `${CHANNEL_META_SENTINEL} `;
  if (!line.startsWith(prefix)) return null;
  const payload = line.slice(prefix.length);
  let parsed;
  try {
    parsed = JSON.parse(payload);
  } catch {
    // Malformed/truncated JSON -- skip this line entirely, never throw.
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const present = (value) => (typeof value === 'string' && value !== '' && value !== 'NA' ? value : null);
  return {
    videoId: present(parsed.id),
    // v1.33 T3: the video's REAL title (emoji intact), raw/unvalidated here --
    // bounded downstream by `store.sanitizeCapturedTitle` (via
    // `sanitizeCapturedChannelMeta`), same division of labor as the date
    // fields below.
    title: present(parsed.title),
    channelUrl: present(parsed.channel_url),
    channelId: present(parsed.channel_id),
    uploaderUrl: present(parsed.uploader_url),
    channelName: present(parsed.channel),
    // v1.24.0 C5-ytdlp: raw (unvalidated) upload/release date, straight off
    // the same `--print` line -- bounded/validated downstream by
    // `store.sanitizeCapturedChannelMeta` (which expects EXACTLY these key
    // names: `uploadDate`/`releaseDate`), never here (this function's job is
    // JSON-parse + presence-check only).
    uploadDate: present(parsed.upload_date),
    releaseDate: present(parsed.release_date),
  };
}

/**
 * Redact the value of every `--cookies <path>` pair in an args array. Used
 * for ANY log line that might include the argv -- the cookies path is a
 * reference to a mounted, potentially sensitive credentials file and must
 * NEVER appear in logs (or, by extension, anywhere persisted). Returns a new
 * array; never mutates the input.
 */
function redactArgs(args) {
  if (!Array.isArray(args)) return args;
  const redacted = [];
  for (let i = 0; i < args.length; i++) {
    redacted.push(args[i]);
    if (args[i] === '--cookies' && i + 1 < args.length) {
      redacted.push('<redacted>');
      i += 1; // skip the real path -- it must never be pushed/logged
    }
  }
  return redacted;
}

/**
 * SF1: strip every occurrence of `cookiesPath` out of an arbitrary string
 * (typically Node's own `error.message`, which for `execFile`/`spawn`
 * failures is `"Command failed: yt-dlp <full argv incl. --cookies
 * <path>> -- <url>\n<stderr>"` -- the FULL, un-redacted argv, defeating
 * `redactArgs` when the message itself is what gets logged/returned instead
 * of a value built from `redactArgs`'s output). A single global substring
 * replace also covers a `--cookies=<path>` equals-form rendering of the same
 * path, since it is the path text itself being matched, not a `--cookies
 * <path>` token pair. Guarded against a null/empty `cookiesPath` (returned
 * unchanged) so callers can pass `config.cookiesFile` unconditionally.
 */
function redactString(str, cookiesPath) {
  if (typeof str !== 'string' || str === '') return str;
  if (typeof cookiesPath !== 'string' || cookiesPath === '') return str;
  return str.split(cookiesPath).join('<redacted>');
}

/**
 * Compose a SAFE, loggable/returnable description of a spawn failure from
 * known-good pieces ONLY -- never the raw `error.message`/`stderr`, which on
 * Node can embed the full argv (including a `--cookies <path>` value) even
 * when the args array handed to `execFile`/`spawn` was itself never
 * shell-interpolated (SF1). `redactArgs(args)` is already safe to include;
 * `error.code`/`signal` are structured fields Node sets independently of the
 * message text.
 */
function describeFailure(args, error) {
  const code = error && error.code !== undefined && error.code !== null ? error.code : 'unknown';
  const signal = error && error.signal ? ` signal=${error.signal}` : '';
  return `code=${code}${signal} args=${redactArgs(args).join(' ')}`;
}

// v1.29.0 (R0.1/R0.2/R0.8, "diagnostics foundation"): strip ASCII control
// characters (C0 + DEL) from a single stderr line -- yt-dlp's stderr is
// untrusted and could in principle embed a `\r`/terminal-escape sequence.
// Mirrors failures.js's `sanitizeReason` control-char posture (kept as a
// tiny local copy rather than an import so this module's ONLY child_process
// dependency stays put -- see this file's own header comment -- and so
// `pickStderrReason`, below, has no cross-module coupling for a two-line
// regex). Never throws; a non-string input is handed back unchanged.
function stripControlChars(str) {
  if (typeof str !== 'string') return str;
  // eslint-disable-next-line no-control-regex
  return str.replace(/[\x00-\x1f\x7f]/g, '');
}

/**
 * v1.29.0 (R0.1/R0.2/R0.8): pick the most meaningful line out of an
 * already-bounded, already-redacted `safeStderr` tail (`STDERR_TAIL_LIMIT`
 * chars, `redactString`-cleaned -- see the close handler in
 * `spawnYtdlpDownload`, below) to use as a real failure reason instead of the
 * generic `"yt-dlp exited with code <n>"` string.
 *
 * Selection order: the LAST line matching yt-dlp's own `ERROR:` prefix
 * (case-insensitive -- this is the line yt-dlp itself considers the
 * authoritative failure reason, and the last one wins when there are
 * several, e.g. a retry sequence); else the last non-empty line (still more
 * useful than a bare exit code); else `''` when the tail carries nothing
 * usable, letting the caller fall back to the generic string.
 *
 * Pure and side-effect-free: no new unbounded field is introduced here --
 * this only SELECTS from a string the caller already bounded and redacted.
 * Every returned line is stripped of control characters (see
 * `stripControlChars`, above) and trimmed, so the result is always safe to
 * render as plain text.
 *
 * @param {*} safeStderr the bounded, redacted stderr tail
 * @returns {string} the picked reason line, or `''` when nothing usable
 */
function pickStderrReason(safeStderr) {
  if (typeof safeStderr !== 'string' || safeStderr === '') return '';
  const lines = safeStderr.split(/\r?\n/);
  let lastErrorLine = '';
  let lastNonEmptyLine = '';
  for (const rawLine of lines) {
    const line = stripControlChars(rawLine).trim();
    if (line === '') continue;
    lastNonEmptyLine = line;
    if (/^ERROR:/i.test(line)) lastErrorLine = line;
  }
  return lastErrorLine || lastNonEmptyLine;
}

/**
 * Invoke yt-dlp for the LIST/metadata pass (and the `--version`
 * presence-check) using `spawn` (arg-array, NO shell -- same guarantee as
 * before: NEVER pass a shell string, NEVER set `{ shell: true }`) instead of
 * `execFile` + `maxBuffer`. See the module comment above (near
 * `STDERR_TAIL_LIMIT`) for why: `execFile`'s fixed `maxBuffer` made Node
 * SIGTERM the child the moment a channel's `--dump-json` dump exceeded it,
 * failing the ENTIRE listing (and therefore the whole poll) for any
 * sufficiently large channel, before a single video was even considered.
 *
 * DESIGN CHOICE (this hotfix): stdout is still collected and returned as a
 * single joined string on `result.stdout` -- the exact same shape as before
 * -- so `runList` / `rules.parseYtdlpVideoList` remain the one NDJSON-parsing
 * seam, unchanged. RAW Buffer chunks are pushed into an array and decoded
 * ONCE, together, at `close` via `Buffer.concat(stdoutChunks).toString('utf8')`
 * -- this is not just an O(n^2) string-copy avoidance, it is what makes
 * chunk boundaries irrelevant to correctness: decoding each chunk
 * independently (the pre-fix behavior) can split a multi-byte UTF-8
 * character -- an emoji or CJK character in a video title/uploader/
 * description is common -- across two chunks, corrupting it into U+FFFD on
 * both sides while `JSON.parse` still succeeds (a silent data-corruption
 * bug, not a crash). Buffering the raw bytes and decoding once at the end
 * closes that gap entirely. There is no `maxBuffer`-style hard cap anywhere
 * in this path that could ever abort a valid listing. Real-world size is
 * bounded upstream instead. v1.36 F1 CORRECTION (QA gate): the original
 * v1.25 claim here -- that the `--dateafter <sub.cutoffDate>` window alone
 * meant a channel's back catalog was "never re-listed forever" -- was WRONG
 * about wall clock: `--dateafter` filters what SURVIVES the listing but
 * never stops the enumeration/extraction itself, and pre-cutoff videos are
 * never downloaded, so they are never archived, so yt-dlp full-extracted
 * them again on EVERY poll (the production "same large channels time out
 * every run" incident). The real upstream bounds are now `breakEarlyArgs`
 * (lib/ytdlp/args.js): lazy enumeration that STOPS at the first
 * genuinely-pre-cutoff video (`--break-match-filters`, exiting 101 --
 * mapped to success via `breakExitOk` below) plus the
 * `--playlist-end <listScanCap>` backstop. `--dateafter` itself is now
 * DORMANT (it masked the breaking filter -- yt-dlp checks daterange first,
 * non-breaking); the authoritative per-video date gate is
 * `rules.isBeforeCutoff` in the JS survivor loop. Removing the artificial
 * `maxBuffer` ceiling here remains defense-in-depth on top of those bounds.
 *
 * Wrapped so this never throws/rejects uncaught: any failure (binary
 * missing, non-zero exit, timeout, a broken stdout/stderr stream) resolves to
 * a structured `{ ok: false, ... }` result instead, per RELIABILITY.md ("log
 * and degrade, never crash"). Same redaction (SF1), non-zero-timeout-with-
 * killSignal (SF2), and settled-guard/stream-'error' handling (SF7)
 * guarantees as `spawnYtdlpDownload` apply here too. Downloads use
 * `spawnYtdlpDownload` instead (unaffected by this change).
 * @param {string[]} args flat argv (see lib/ytdlp/args.js builders)
 * @param {{timeoutMs?: number, cwd?: string, cookiesPath?: string, killSignal?: string}} [opts]
 * @returns {Promise<{ok: boolean, code: (number|string|null), stdout: string, stderr: string, error?: string}>}
 */
function spawnYtdlp(args, opts = {}) {
  const cookiesPath = opts.cookiesPath || null;
  const timeoutMs = opts.timeoutMs || DEFAULT_LIST_TIMEOUT_MS;
  const killSignal = opts.killSignal || DEFAULT_KILL_SIGNAL;
  // v1.31 P0: every timeout kill names its phase and budget -- the bare
  // "timed out and was killed" gave Dean's production run twenty identical,
  // undiagnosable reasons. Callers pass a human phase label (`'list pass'`,
  // `'probe'`, `'metadata re-pull'`, ...); the duration is derived from the
  // ACTUAL budget applied, so the message can never drift from the timer.
  const phaseLabel = typeof opts.phaseLabel === 'string' && opts.phaseLabel ? opts.phaseLabel : 'list pass';
  // v1.36 F1: when the argv carries a --break-* condition (the break-early
  // list pass), yt-dlp signals "stopped early ON PURPOSE" with exit code 101
  // (its documented code for --break-match-filters / --max-downloads style
  // aborts). For that caller -- and ONLY that caller (opt-in flag, so a
  // download pass exiting 101 stays a failure) -- 101 is a SUCCESS: the JSON
  // lines already on stdout are the complete post-cutoff listing. Strictly
  // opt-in and strictly `=== 101`: any other non-zero code (or 101 without
  // the flag) keeps the existing failure path untouched.
  const breakExitOk = opts.breakExitOk === true;

  return new Promise((resolve) => {
    let child;
    try {
      child = cp.spawn('yt-dlp', args, {
        cwd: opts.cwd,
        // stdout is piped and streamed below (no maxBuffer-style cap);
        // stderr is piped and drained into a bounded tail only, exactly like
        // `spawnYtdlpDownload`.
        stdio: ['ignore', 'pipe', 'pipe'],
        // Deliberately NO `shell` key: spawn defaults to `shell: false`.
        // Never set this to `true` -- see the module comment above.
      });
    } catch (err) {
      // A synchronous throw from spawn itself (malformed args, etc.) -- still
      // never propagates uncaught, and still never leaks the raw
      // message/cookies path (SF1's sync-throw path).
      console.error('Failed to start yt-dlp:', describeFailure(args, err));
      resolve({ ok: false, code: null, stdout: '', stderr: '', error: redactString(err.message, cookiesPath) });
      return;
    }

    // Raw Buffer chunks (NOT pre-decoded strings) -- decoded ONCE, together,
    // at 'close'. See the module comment above (near `spawnYtdlp`'s JSDoc)
    // for why this matters: chunk-boundary-safe multibyte UTF-8 decoding.
    const stdoutChunks = [];
    const stderrDecoder = new StringDecoder('utf8');
    let stderrTail = '';
    let timedOut = false;
    let settled = false;

    let timer = null;
    function clear() {
      if (timer) clearTimeout(timer);
    }

    // SF7: a piped stream can itself emit 'error' (a rare underlying fd/read
    // error) independently of the child process's own 'error'/'close'
    // events. An EventEmitter with ZERO 'error' listeners THROWS
    // synchronously when one fires -- without a listener here that throw
    // would happen before any settle-the-promise logic runs, hanging this
    // promise forever. Both stdout and stderr are guarded (unlike the
    // download path, which only pipes stderr): the list path pipes BOTH
    // streams, so both need the same guard. Each handler also calls
    // `child.kill(killSignal)` BEFORE resolving -- a stream-'error' can fire
    // while the child is still running, and `clear()` has just disarmed the
    // timeout timer, so without an explicit kill here (mirroring the timeout
    // path) that child would be orphaned with nothing left to reap it.
    if (child.stdout) {
      child.stdout.on('data', (chunk) => {
        stdoutChunks.push(chunk);
      });
      child.stdout.on('error', (err) => {
        if (settled) return;
        settled = true;
        clear();
        child.kill(killSignal);
        console.error('yt-dlp stdout stream failed:', describeFailure(args, err));
        resolve({
          ok: false,
          code: 'ESTDOUT',
          stdout: '',
          stderr: redactString(stderrTail, cookiesPath),
          error: redactString(err.message, cookiesPath),
        });
      });
    }

    if (child.stderr) {
      child.stderr.on('data', (chunk) => {
        // Boundary-safe decode (see the `STDERR_TAIL_LIMIT` module comment)
        // -- only the DECODED string is sliced to the bounded tail, never
        // the raw bytes, so the tail stays fixed-size (SF3) without ever
        // splitting a multi-byte character across the slice boundary.
        stderrTail = (stderrTail + stderrDecoder.write(chunk)).slice(-STDERR_TAIL_LIMIT);
      });
      child.stderr.on('error', (err) => {
        if (settled) return;
        settled = true;
        clear();
        child.kill(killSignal);
        console.error('yt-dlp stderr stream failed:', describeFailure(args, err));
        resolve({
          ok: false,
          code: 'ESTDERR',
          stdout: '',
          stderr: redactString(stderrTail, cookiesPath),
          error: redactString(err.message, cookiesPath),
        });
      });
    }

    // Non-zero default (SF2): `timeout: 0` (or omitted) is unbounded in Node,
    // so a hung/slowloris listing would otherwise wedge the poll loop
    // forever. `.unref()`'d so a real child process (which itself keeps the
    // event loop alive) doesn't need this timer to also do so -- see the
    // v1.11.1 CI lesson referenced in `spawnYtdlpDownload`, below.
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        child.kill(killSignal);
      }, timeoutMs);
      if (typeof timer.unref === 'function') timer.unref();
    }

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clear();
      console.error('yt-dlp failed to start:', describeFailure(args, err));
      resolve({ ok: false, code: null, stdout: '', stderr: '', error: redactString(err.message, cookiesPath) });
    });

    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clear();
      // Flush any trailing bytes the decoder was still holding onto pending
      // a continuation that will now never arrive (the process has closed).
      stderrTail = (stderrTail + stderrDecoder.end()).slice(-STDERR_TAIL_LIMIT);
      const safeStderr = redactString(stderrTail, cookiesPath);
      // Decode ONCE, from the raw, fully-buffered bytes -- see the module
      // comment above `spawnYtdlp` for why this (not per-chunk decoding) is
      // what makes chunk boundaries irrelevant to multibyte correctness.
      const safeStdout = redactString(Buffer.concat(stdoutChunks).toString('utf8'), cookiesPath);
      if (timedOut) {
        console.error('yt-dlp timed out:', describeFailure(args, { code: 'ETIMEDOUT', signal }));
        resolve({ ok: false, code: 'ETIMEDOUT', stdout: '', stderr: safeStderr, error: `yt-dlp ${phaseLabel} timed out after ${formatTimeoutMinutes(timeoutMs)} and was killed` });
        return;
      }
      if (code === 0 || (breakExitOk && code === 101)) {
        // v1.36 F1: `code` is passed through verbatim (0 or 101) so a caller
        // that cares can distinguish "ran to the end" from "stopped early at
        // the cutoff" -- both are `ok: true` for the break-early list pass.
        resolve({ ok: true, code, stdout: safeStdout, stderr: safeStderr });
        return;
      }
      // SF1: log a SAFE, composed description -- never the raw error
      // message/stderr (which can embed the full un-redacted argv, incl. the
      // cookies path, defeating `redactArgs` if logged/returned directly).
      const resultCode = code !== null && code !== undefined ? code : (signal || null);
      console.error('yt-dlp failed:', describeFailure(args, { code: resultCode, signal }));
      resolve({
        ok: false,
        code: resultCode,
        stdout: safeStdout,
        stderr: safeStderr,
        // SF1: the RETURNED error is redacted too -- this is the field T4
        // would persist to db.json / expose via GET /api/subscriptions.
        error: redactString(`yt-dlp exited with code ${resultCode}`, cookiesPath),
      });
    });
  });
}

/**
 * A tiny, bounded line-splitter used ONLY for FR-E progress parsing on the
 * download path. Operates on already-decoded strings (each stream feeding it
 * keeps its OWN `StringDecoder`, exactly like the diagnostic stderr tail, so
 * a multi-byte UTF-8 character split across a raw Buffer chunk boundary is
 * never corrupted). `onLine` fires once per COMPLETE line (the trailing `\n`
 * is stripped, never included). The not-yet-terminated remainder ("carry")
 * is capped at `STDERR_TAIL_LIMIT` so a pathological/adversarial stream that
 * never emits a newline cannot grow this buffer without bound -- this is a
 * PARSE-time buffer only, distinct from (and in addition to) the stderr
 * diagnostic tail; nothing here is ever accumulated for the RETURNED result
 * (SF3 is unaffected: `spawnYtdlpDownload` still returns `stdout: ''`).
 */
function makeLineSplitter(onLine) {
  let carry = '';
  return {
    push(text) {
      if (typeof text !== 'string' || text === '') return;
      carry += text;
      let idx = carry.indexOf('\n');
      while (idx !== -1) {
        onLine(carry.slice(0, idx));
        carry = carry.slice(idx + 1);
        idx = carry.indexOf('\n');
      }
      if (carry.length > STDERR_TAIL_LIMIT) {
        carry = carry.slice(-STDERR_TAIL_LIMIT);
      }
    },
    // Called once, at 'close': whatever partial line never received a
    // trailing newline (yt-dlp's very last progress update commonly has no
    // trailing `\n` before the process exits) is still worth a final parse
    // attempt.
    flush() {
      if (carry !== '') {
        const last = carry;
        carry = '';
        onLine(last);
      }
    },
  };
}

/**
 * Invoke yt-dlp for a DOWNLOAD using `spawn` (arg-array, NO shell -- same
 * guarantee as `spawnYtdlp` above). SF3: `execFile`'s `maxBuffer` (the
 * mechanism BOTH this path and the list path used to use) bounds stdout AND
 * stderr combined; a long-running download's periodic stderr progress output
 * can exceed it, and Node's response is to SIGTERM the child -- killing a
 * legitimate multi-hour download and leaving a partial file. `spawn` gives
 * direct access to the stderr stream so it can be drained WITHOUT
 * accumulating an in-memory buffer that could ever trip a size limit: only a
 * small, fixed-size tail is kept (for diagnostics), no matter how long the
 * process runs or how much it prints.
 *
 * Same redaction (SF1) and non-zero-timeout-with-killSignal (SF2) guarantees
 * as `spawnYtdlp` apply here too.
 *
 * FR-E: `opts.onProgress`, when a function, is called with each non-null
 * `parseProgressLine(line)` patch parsed from EITHER stream (yt-dlp writes
 * `--newline` progress to stdout; some diagnostic lines land on stderr too).
 * stdout is now piped (previously ignored) but is PARSED-AND-DISCARDED --
 * never accumulated -- so the returned `result.stdout` stays `''`, exactly
 * as before this feature, and SF3's "no unbounded buffer" guarantee is
 * unaffected. `onProgress` is wrapped so a throwing callback can NEVER break
 * this download's own promise/settle logic. Backward-compatible: when
 * `opts.onProgress` is omitted, behavior is identical to before (the only
 * difference anywhere on this path is the harmless `--newline` flag added in
 * lib/ytdlp/args.js).
 *
 * v1.24.0 A2 (T14): `opts.knownIds` (a `Set<string>`/`string[]` of the exact
 * survivor ids THIS spawn was told to target -- `runDownload` below sources
 * it straight from its own `targetIds` param, so callers never need to pass
 * it separately) is threaded to `parseItemFailureLine` for every stderr
 * line. A match accumulates into the returned `itemFailures[]` array --
 * SAME bounded-capture posture and cap constant (`MAX_CAPTURED_META`) as the
 * existing `channelMeta[]` capture below, so a pathological/adversarial
 * stream can never grow this array unbounded (SF3 unaffected). Each
 * captured `reason` is passed through the SAME `redactString` every other
 * returned string on this path already uses, so a cookies path embedded in
 * a forged/echoed error line can never survive into the returned result
 * (SF1 unaffected). Omitting `opts.knownIds` (every pre-A2 call site) is
 * fully backward-compatible: every candidate is then unattributed
 * (`videoId: null`) rather than misattributed -- see failures.js's own
 * "never misattribute" doc comment.
 *
 * v1.24.0 A3: `opts.onChild(child)`, when a function, is invoked
 * SYNCHRONOUSLY immediately after a successful `cp.spawn` (i.e. before this
 * function's own Promise ever resolves) -- a minimal, OPT-IN registration
 * hook, not a global registry: this module has no knowledge of jobs/ids and
 * never tracks a child itself. `lib/ytdlp/index.js`'s `runOneShot` is the
 * only caller that passes one today, storing the handle in its own
 * module-level `Map<jobId, ChildProcess>` so the NEW `POST
 * /api/ytdlp/download/:jobId/cancel` route can look it up and
 * `child.kill('SIGKILL')` it (see that file's own comment for the full
 * cancel flow). Wrapped in a try/catch exactly like `safeOnProgress` below --
 * a throwing `onChild` callback must never break the download itself.
 * Omitting `opts.onChild` (every pre-A3 call site) is fully
 * backward-compatible: nothing here changes when it is absent.
 * @param {string[]} args flat argv (see lib/ytdlp/args.js's buildYtdlpDownloadArgs)
 * @param {{timeoutMs?: number, cwd?: string, cookiesPath?: string, killSignal?: string, onProgress?: (patch: object) => void, knownIds?: (Set<string>|string[]), onChild?: (child: import('child_process').ChildProcess) => void}} [opts]
 * @returns {Promise<{ok: boolean, code: (number|string|null), stdout: string, stderr: string, error?: string, channelMeta: object[], itemFailures: {videoId: (string|null), reason: string}[]}>}
 */
function spawnYtdlpDownload(args, opts = {}) {
  const cookiesPath = opts.cookiesPath || null;
  const timeoutMs = opts.timeoutMs || DEFAULT_DOWNLOAD_TIMEOUT_MS;
  const killSignal = opts.killSignal || DEFAULT_KILL_SIGNAL;
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
  const onChild = typeof opts.onChild === 'function' ? opts.onChild : null;
  // v1.31 P3: stall watchdog -- an IDLE window, distinct from the absolute
  // `timeoutMs` ceiling above. A healthy yt-dlp download prints progress
  // lines continuously (`--newline`); a child that produces NO output on
  // either stream for `stallMs` is wedged (dead socket, tarpit, hung merge)
  // and is reclaimed immediately with a specific "stalled" reason instead of
  // holding the serial queue hostage for the remainder of the (up to 3h)
  // ceiling. 0/absent = disabled (pre-v1.31 behavior: ceiling only).
  // DELIBERATE BREADTH (vs FR4.3's literal "progress signal" wording): ANY
  // output on either stream re-arms the window, not only parsed progress
  // events -- yt-dlp legitimately goes percent-quiet during postprocess/
  // merge phases while still logging to stderr, and killing a merging
  // download as "stalled" would be a false positive worse than the extra
  // leniency.
  const stallMs = Number.isFinite(opts.stallMs) && opts.stallMs > 0 ? opts.stallMs : 0;

  return new Promise((resolve) => {
    let child;
    try {
      child = cp.spawn('yt-dlp', args, {
        cwd: opts.cwd,
        // FR-E: stdout is now piped too (previously `'ignore'`) so download
        // progress lines (yt-dlp writes them to stdout under `--newline`) can
        // be parsed; it is parsed-and-discarded below, never accumulated.
        // stderr remains piped so it can be drained below WITHOUT letting
        // Node accumulate/buffer it internally the way `execFile`'s
        // `maxBuffer` does.
        stdio: ['ignore', 'pipe', 'pipe'],
        // Deliberately NO `shell` key: `spawn` defaults to `shell: false`.
        // Never set this to `true` -- see the module comment above.
      });
      // v1.24.0 A3: registration happens ONLY on a successful spawn (this
      // line is never reached when the `try` above throws) -- a caller's
      // `onChild` handle is therefore always a live, spawned child, never a
      // half-constructed one.
      if (onChild) {
        try {
          onChild(child);
        } catch (err) {
          console.error('yt-dlp onChild callback threw (ignored):', err && err.message);
        }
      }
    } catch (err) {
      console.error('Failed to start yt-dlp:', describeFailure(args, err));
      resolve({ ok: false, code: null, stdout: '', stderr: '', error: redactString(err.message, cookiesPath), channelMeta: [], itemFailures: [] });
      return;
    }

    const stderrDecoder = new StringDecoder('utf8');
    let stderrTail = '';
    let timedOut = false;
    let settled = false;
    // v1.20.0 FR-2: bounded capture of parsed FTCHMETA lines (see
    // `parseChannelMetaLine`'s doc comment above and `MAX_CAPTURED_META`).
    // Raw/untrusted -- returned to the caller as-is; validation happens
    // downstream in `store.sanitizeCapturedChannelMeta`, never here.
    const capturedMeta = [];
    // v1.24.0 A2 (T14): the exact survivor id set this spawn was told to
    // target -- normalized ONCE here (accepts a `Set` or a plain array;
    // anything else is an empty set) so `parseItemFailureLine` always gets a
    // real `Set` to `.has()` against. SAME bounded-capture posture/cap as
    // `capturedMeta` above (see `handleStderrLine`, below) -- this is what
    // makes SF3 ("no unbounded buffer") hold for this new array too.
    const knownIds = opts.knownIds instanceof Set
      ? opts.knownIds
      : new Set(Array.isArray(opts.knownIds) ? opts.knownIds : []);
    const itemFailures = [];

    let timer = null;
    // v1.31 P3: the stall watchdog's idle timer. Re-armed on EVERY data
    // chunk from either stream (see the 'data' handlers below); firing means
    // the child produced nothing for a full `stallMs` window. `stalled` is
    // checked before `timedOut` at 'close' -- both flags can never be set
    // together (whichever timer fires first kills the child; the kill makes
    // the other timer irrelevant and `clear()` disarms it).
    let stallTimer = null;
    let stalled = false;
    function armStallTimer() {
      if (!stallMs || settled) return;
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        stalled = true;
        child.kill(killSignal);
      }, stallMs);
      if (typeof stallTimer.unref === 'function') stallTimer.unref();
    }
    function clear() {
      if (timer) clearTimeout(timer);
      if (stallTimer) clearTimeout(stallTimer);
    }

    // FR-E: onProgress must NEVER break this download's own promise/settle
    // logic -- a throwing callback is caught and logged, never propagated.
    function safeOnProgress(patch) {
      if (!onProgress || !patch) return;
      try {
        onProgress(patch);
      } catch (err) {
        console.error('yt-dlp onProgress callback threw (ignored):', err && err.message);
      }
    }
    // v1.20.0 FR-2 (two-reviewer-gate fix, post-release): FTCHMETA capture
    // parsing is now attempted ONLY on stdout lines, never stderr -- see
    // `parseChannelMetaLine`'s doc comment above for why. `--print` (the
    // only thing that ever produces this sentinel) writes exclusively to
    // stdout, so stderr never legitimately carries a capture line; treating
    // an FTCHMETA-shaped stderr line as one would let attacker-controlled
    // stderr text (yt-dlp echoes descriptions/warnings there, which CAN
    // contain raw, un-JSON-escaped newlines) plant a forged capture entry.
    function handleStdoutLine(line) {
      const meta = parseChannelMetaLine(line);
      if (meta) {
        if (capturedMeta.length < MAX_CAPTURED_META) capturedMeta.push(meta);
        return;
      }
      safeOnProgress(parseProgressLine(line));
    }
    // stderr NEVER attempts FTCHMETA recognition -- only the existing
    // progress/log parsing, unchanged from before this fix. A line here that
    // happens to start with the FTCHMETA sentinel is simply not progress
    // (parseProgressLine returns null for it) and is silently dropped, same
    // as any other unrecognized stderr line.
    //
    // v1.24.0 A2 (T14): a SECOND, independent consumer of the same stderr
    // lines -- yt-dlp's own per-video `ERROR: [...] <id>: <reason>` text
    // lands here (real yt-dlp errors are stderr output; see failures.js's
    // module comment for the documented residual-risk discussion this
    // module's design accepts). `parseItemFailureLine` never throws and a
    // non-matching line returns `null`, so this can never interfere with
    // the progress parsing on the line below either way. Bounded by the
    // SAME cap as `capturedMeta` (SF3): a pathological/adversarial stream
    // can never grow `itemFailures` without bound.
    //
    // FIX-6 (two-reviewer gate, post-release, SF1 hardening): `redactString`
    // now runs on the FULL, UNCAPPED line BEFORE it is ever handed to
    // `parseItemFailureLine` -- not on the already-parsed `failure.reason`
    // afterward. `parseItemFailureLine`'s own `sanitizeReason` caps its
    // returned reason at `MAX_REASON_LENGTH` (500 chars); redacting AFTER
    // that cap (the pre-fix order) meant a cookies path straddling the
    // 500-char boundary could leave an un-redacted prefix in the captured
    // reason. Redacting the full line first, then letting the cap run
    // strictly afterward (inside the parser), guarantees redact-THEN-cap
    // ordering with no possible un-redacted remnant, regardless of where in
    // the line the cookies path falls. `parseProgressLine` below still
    // consumes the ORIGINAL (non-redacted) `line` -- redaction only needs to
    // protect what actually gets captured/returned/persisted, and
    // `parseProgressLine`'s own output never includes raw line text.
    function handleStderrLine(line) {
      const redactedLine = redactString(line, cookiesPath);
      const failure = parseItemFailureLine(redactedLine, knownIds);
      if (failure && itemFailures.length < MAX_CAPTURED_META) {
        itemFailures.push({ videoId: failure.videoId, reason: failure.reason });
      }
      safeOnProgress(parseProgressLine(line));
    }
    // Each stream gets its OWN StringDecoder + line-splitter (see
    // `makeLineSplitter`'s comment above) so a multi-byte character split
    // across a chunk boundary decodes intact on either channel.
    const stdoutDecoder = new StringDecoder('utf8');
    const stdoutLineSplitter = makeLineSplitter(handleStdoutLine);
    const stderrLineSplitter = makeLineSplitter(handleStderrLine);

    // SF7: a piped stream can itself emit 'error' (a rare underlying fd/read
    // error) independently of the child process's own 'error'/'close'
    // events. An EventEmitter with ZERO 'error' listeners THROWS
    // synchronously when one fires -- and that throw happens BEFORE any of
    // the settle-the-promise logic below runs, so without a listener here
    // this promise would never resolve. Both stdout and stderr are guarded
    // (stdout is now piped on this path too, mirroring the list path's own
    // dual-stream guard). Each handler also calls `child.kill(killSignal)`
    // BEFORE resolving -- a stream-'error' can fire while the child is still
    // running, and `clear()` has just disarmed the timeout timer, so without
    // an explicit kill here that child would be orphaned with nothing left
    // to reap it.
    if (child.stdout) {
      child.stdout.on('data', (chunk) => {
        // FIX-3 (two-reviewer gate): once this download's promise has
        // already settled (a normal 'close', a timeout-kill, or a stream
        // 'error' on EITHER stream), a still-buffered/late 'data' event on
        // stdout must not dispatch onProgress -- without this guard, a
        // late, non-terminal `{state: 'downloading', ...}` patch could
        // OVERWRITE the orchestrator's own terminal state transition
        // (`activity.setSubscription`'s 'done'/'error', written immediately
        // after this promise resolves), leaving a phantom entry stuck
        // non-terminal forever (never TTL-pruned, since only one-shots are
        // TTL-pruned and subscriptions aren't pruned by age at all). The
        // decoder must still be DRAINED even when discarding (never skip
        // `stdoutDecoder.write`) so a multi-byte character split across this
        // chunk boundary and the next doesn't corrupt state for whichever
        // later chunk actually does still get parsed. The close-time flush
        // below is NOT gated by this check -- it is the deliberate final
        // step of the SAME settle sequence, not a stray late event.
        const decoded = stdoutDecoder.write(chunk);
        if (settled) return;
        // v1.31 P3: any output = the child is alive; re-arm the idle window.
        armStallTimer();
        stdoutLineSplitter.push(decoded);
      });
      child.stdout.on('error', (err) => {
        if (settled) return;
        settled = true;
        clear();
        child.kill(killSignal);
        console.error('yt-dlp stdout stream failed:', describeFailure(args, err));
        resolve({
          ok: false,
          code: 'ESTDOUT',
          stdout: '',
          stderr: redactString(stderrTail, cookiesPath),
          error: redactString(err.message, cookiesPath),
          channelMeta: capturedMeta,
          itemFailures,
        });
      });
    }

    if (child.stderr) {
      child.stderr.on('data', (chunk) => {
        // Boundary-safe decode (see the `STDERR_TAIL_LIMIT` module comment
        // near `spawnYtdlp`) -- only the DECODED string is sliced to the
        // bounded tail, never the raw bytes, so the tail stays fixed-size
        // (SF3) without ever splitting a multi-byte character. The SAME
        // decoded string also feeds the FR-E line-splitter (parsed and
        // discarded, never itself accumulated).
        const decoded = stderrDecoder.write(chunk);
        stderrTail = (stderrTail + decoded).slice(-STDERR_TAIL_LIMIT);
        // FIX-3 (two-reviewer gate): same settled-guard as the stdout 'data'
        // handler above -- the diagnostic tail keeps accumulating either way
        // (harmless, still bounded), but progress dispatch must stop once
        // this download's promise has already settled.
        if (settled) return;
        // v1.31 P3: stderr output also proves liveness (yt-dlp logs
        // warnings/retries there while making real progress).
        armStallTimer();
        stderrLineSplitter.push(decoded);
      });
      child.stderr.on('error', (err) => {
        if (settled) return;
        settled = true;
        clear();
        child.kill(killSignal);
        console.error('yt-dlp stderr stream failed:', describeFailure(args, err));
        resolve({
          ok: false,
          code: 'ESTDERR',
          stdout: '',
          stderr: redactString(stderrTail, cookiesPath),
          error: redactString(err.message, cookiesPath),
          channelMeta: capturedMeta,
          itemFailures,
        });
      });
    }

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        child.kill(killSignal);
      }, timeoutMs);
      if (typeof timer.unref === 'function') timer.unref();
    }
    // v1.31 P3: arm the initial idle window at spawn -- a child that never
    // produces a single byte of output is the most wedged child of all.
    armStallTimer();

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clear();
      console.error('yt-dlp failed to start:', describeFailure(args, err));
      resolve({ ok: false, code: null, stdout: '', stderr: '', error: redactString(err.message, cookiesPath), channelMeta: capturedMeta, itemFailures });
    });

    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clear();
      // Flush any trailing bytes the decoders were still holding onto
      // pending a continuation that will now never arrive (the process has
      // closed), then let each line-splitter parse whatever final partial
      // line never received a trailing newline. (This also runs
      // `handleStderrLine` -- and therefore `parseItemFailureLine` -- one
      // last time on a not-yet-newline-terminated final stderr line, exactly
      // like the FR-E progress parser already relied on for its own final
      // line.)
      const trailingStdout = stdoutDecoder.end();
      if (trailingStdout) stdoutLineSplitter.push(trailingStdout);
      stdoutLineSplitter.flush();
      stderrTail = (stderrTail + stderrDecoder.end()).slice(-STDERR_TAIL_LIMIT);
      stderrLineSplitter.flush();
      const safeStderr = redactString(stderrTail, cookiesPath);
      // v1.31 P3: `stalled` is checked FIRST -- whichever timer killed the
      // child is the honest reason, and a stall-kill's close event must
      // never be misattributed to the absolute ceiling.
      if (stalled) {
        console.error('yt-dlp stalled:', describeFailure(args, { code: 'ESTALLED', signal }));
        resolve({ ok: false, code: 'ESTALLED', stdout: '', stderr: safeStderr, error: `yt-dlp download stalled -- no output for ${formatTimeoutMinutes(stallMs)} and was killed`, channelMeta: capturedMeta, itemFailures });
        return;
      }
      if (timedOut) {
        console.error('yt-dlp timed out:', describeFailure(args, { code: 'ETIMEDOUT', signal }));
        resolve({ ok: false, code: 'ETIMEDOUT', stdout: '', stderr: safeStderr, error: `yt-dlp download timed out after ${formatTimeoutMinutes(timeoutMs)} (absolute ceiling) and was killed`, channelMeta: capturedMeta, itemFailures });
        return;
      }
      if (code === 0) {
        resolve({ ok: true, code: 0, stdout: '', stderr: safeStderr, channelMeta: capturedMeta, itemFailures });
        return;
      }
      const resultCode = code !== null && code !== undefined ? code : (signal || null);
      console.error('yt-dlp failed:', describeFailure(args, { code: resultCode, signal }));
      // v1.29.0 (R0.1/R0.2/R0.8): promote the real stderr reason when one is
      // present in the already-bounded/redacted tail -- the generic exit-code
      // string survives ONLY as the fallback when stderr yielded nothing
      // usable. This changes ONLY the error *reason string*; it has no
      // opinion on `status`/cancellation -- `lib/ytdlp/index.js`'s
      // `cancelledSubscriptionIds`/`cancelledOneShotJobs` override runs
      // downstream of this resolve and forces `status = 'cancelled'`
      // unconditionally (checked against its own latch Set, never against
      // this `error` string's content), so a cancelled run's SIGKILL still
      // surfaces as `'cancelled'` regardless of what reason is picked here.
      resolve({
        ok: false,
        code: resultCode,
        stdout: '',
        stderr: safeStderr,
        error: redactString(pickStderrReason(safeStderr) || `yt-dlp exited with code ${resultCode}`, cookiesPath),
        channelMeta: capturedMeta,
        itemFailures,
      });
    });
  });
}

/**
 * v1.15.1 hotfix: resolve the effective DOWNLOAD spawn timeout (ms) from
 * `config.downloadTimeoutMinutes` (lib/ytdlp/config.js's
 * `parseDownloadTimeoutMinutes`, itself already bounds-checked/defaulted at
 * the config-parsing boundary) -- falling back to `DEFAULT_DOWNLOAD_TIMEOUT_MS`
 * only when `config` doesn't carry a valid one (e.g. a test/caller that
 * builds a bare `{ downloadDir, cookiesFile }` config object directly,
 * bypassing `parseYtdlpConfig`). Re-validated here too (never trusts
 * `config` blindly) so a hostile/malformed `config.downloadTimeoutMinutes`
 * can never produce a zero/negative/non-finite `setTimeout` delay (SF2: a
 * download timeout must always be non-zero and finite).
 * @param {object} config
 * @returns {number} a positive, finite timeout in milliseconds
 */
function resolveDownloadTimeoutMs(config) {
  const minutes = config && config.downloadTimeoutMinutes;
  if (Number.isInteger(minutes) && minutes > 0) {
    return minutes * 60 * 1000;
  }
  return DEFAULT_DOWNLOAD_TIMEOUT_MS;
}

/**
 * Thin seam for T4: build the metadata-listing args and run them. No
 * scheduling/dedup/filtering here -- see the module comment above.
 */
function runList(sub, config) {
  const listArgs = buildYtdlpListArgs(sub, config);
  return spawnYtdlp(listArgs, {
    // v1.31 P0 (H0 fix): pacing-aware budget, no longer the blind 5-minute
    // constant -- see resolveListTimeoutMs's comment.
    timeoutMs: resolveListTimeoutMs(sub, config),
    phaseLabel: 'list pass',
    cookiesPath: config && config.cookiesFile,
    // v1.36 F1: a break-early stop exits 101 and is a SUCCESS here -- but
    // ONLY when this argv actually carries the break flag (QA gate WARNING:
    // a blanket `true` would silently bless a GENUINE exit 101 in the
    // no-cutoff + cap-off shape where breakEarlyArgs emitted nothing).
    breakExitOk: listArgs.includes('--break-match-filters'),
  });
}

/**
 * v1.25 QoL (T3): metadata-only probe for a SINGLE video's channel identity.
 * Used ONLY by the one-shot download path (`lib/ytdlp/index.js`'s
 * `runOneShot`) so an ad-hoc download can be routed into a per-channel
 * folder instead of a flat catch-all -- never used by the subscription
 * list/poll path (a subscription's channel is already known up front from
 * `sub.channelUrl`; T4's own download pass separately captures identity as a
 * side effect via `parseChannelMetaLine`/`CHANNEL_META_PRINT_TEMPLATE`).
 *
 * SAME arg-array / `--` separator / no-`shell:true` / cookies / timeout
 * discipline as `runList`/`spawnYtdlp` above -- this is not a second,
 * divergent spawn posture: `--dump-json --no-download --no-warnings
 * --no-playlist`, then the SAME `cookiesArgs(config)` every other spawn in
 * this file uses (so a members-only/cookie-gated video probes exactly as
 * successfully as its real download would), then `--` and the single
 * already-validated positional watch URL. `--no-playlist` is defense-in-depth
 * only -- the caller is required to pass an already-classified single-video
 * URL (e.g. `classifySingleVideo(...).watchUrl`), never a channel/playlist
 * URL, so this flag should never actually change anything in practice.
 *
 * FIX 2 (two-reviewer gate, post-v1.25.0): uses `PROBE_TIMEOUT_MS` (30s), NOT
 * `DEFAULT_LIST_TIMEOUT_MS` (5min) -- a single-video probe never needs a
 * whole-channel-enumeration budget. See `PROBE_TIMEOUT_MS`'s own doc comment
 * above for the full rationale (this is also the other half of the fix that
 * moves the CALL to this function outside the shared `runExclusive` FIFO
 * gate, in `lib/ytdlp/index.js`).
 *
 * NEVER throws and NEVER rejects: any failure at any layer (binary missing,
 * non-zero exit, timeout, malformed/non-JSON stdout, an object with none of
 * the recognized fields) resolves to `null` -- "no channel identity
 * available" -- so a caller can treat a probe failure exactly like a probe
 * that legitimately found nothing: fall through to a fixed fallback folder,
 * never surface this as (or let it block/delay) the download itself.
 * `spawnYtdlp` itself already never rejects (see its own doc comment); the
 * trailing `.catch` here is pure defense-in-depth against a future
 * regression of that guarantee, mirroring this file's other "never let an
 * internal seam's failure escape uncaught" postures.
 *
 * Returns the FIRST present (non-empty, non-`'NA'` string) field, in order:
 * `.channel` (the display name `--dump-json` reports for the video's
 * channel/uploader), `.uploader` (fallback -- some extractors only populate
 * this one), `.channel_id` (last-resort stable identifier, used only when
 * neither display name survived). This is RAW, UNVALIDATED text straight off
 * yt-dlp's own stdout (untrusted input -- the same trust level
 * `parseChannelMetaLine`'s return value already carries elsewhere in this
 * file) -- this function does NO sanitization itself. The caller MUST feed
 * the result into `args.resolveChannelDir({ name })`, which sanitizes
 * (`sanitizeChannelName`) and structurally confines it, exactly like every
 * other channel-display-name value in this codebase already is; this
 * function must never be used to build a filesystem path directly.
 * @param {string} watchUrl an ALREADY-VALIDATED single-video watch URL (e.g.
 *   `classifySingleVideo(...).watchUrl` -- host-hardcoded, id charset-bounded)
 * @param {object} config
 * @returns {Promise<string|null>}
 */
function probeChannel(watchUrl, config) {
  if (typeof watchUrl !== 'string' || watchUrl === '') return Promise.resolve(null);
  const probeArgs = [
    '--dump-json',
    '--no-download',
    '--no-warnings',
    '--no-playlist',
    ...cookiesArgs(config),
    '--',
    watchUrl,
  ];
  return spawnYtdlp(probeArgs, {
    timeoutMs: PROBE_TIMEOUT_MS,
    phaseLabel: 'probe',
    cookiesPath: config && config.cookiesFile,
  })
    .then((result) => {
      if (!result || !result.ok || typeof result.stdout !== 'string' || result.stdout.trim() === '') return null;
      let parsed;
      try {
        parsed = JSON.parse(result.stdout);
      } catch {
        return null; // malformed/non-JSON stdout -- never throw, just report "no identity found"
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
      const present = (value) => (typeof value === 'string' && value.trim() !== '' && value !== 'NA' ? value : null);
      return present(parsed.channel) || present(parsed.uploader) || present(parsed.channel_id);
    })
    .catch(() => null);
}

/**
 * v1.25 QoL bugfix: metadata-only probe for a CHANNEL's own avatar image.
 * This is the REAL source of a channel avatar -- the per-video
 * `channel_thumbnail` field `parseChannelMetaLine` used to read does not
 * exist on a real yt-dlp per-video `--dump-json` (verified live against
 * yt-dlp 2026.07.04); only the CHANNEL endpoint itself exposes a
 * `thumbnails[]` array that includes the avatar (mixed in with several wide
 * banner crops -- see `store.selectChannelAvatarUrl`'s own doc comment for
 * the square-vs-banner selection heuristic).
 *
 * `--dump-single-json --playlist-items 0` hits the channel/handle URL
 * directly WITHOUT enumerating a single video (`--playlist-items 0`), so this
 * is fast regardless of how many videos the channel has. Works for both
 * `/channel/<id>` and `@handle` URL forms (verified against both). SAME
 * arg-array / `--` separator / no-`shell:true` / cookies / timeout discipline
 * as every other spawn in this file: `cookiesArgs(config)` is threaded so a
 * members-only/cookie-gated channel probes exactly as successfully as any
 * other spawn here, and this reuses `PROBE_TIMEOUT_MS` (30s) -- a channel
 * endpoint probe with no video enumeration is, if anything, cheaper than a
 * single-video probe, so it never needs its own larger budget.
 *
 * NEVER throws and NEVER rejects: any failure at any layer (binary missing,
 * non-zero exit, timeout, malformed/non-JSON stdout, no thumbnails array, no
 * usable square/uncropped entry, an entry that fails `sanitizeChannelAvatarUrl`)
 * resolves to `null` -- "no avatar available" -- so a caller can treat a
 * probe failure exactly like a channel that genuinely has none: fall through
 * to the client's own first-letter avatar fallback, never block/fail
 * whatever triggered this probe (subscribe, or a poll's self-heal).
 *
 * The raw `thumbnails[]` array is handed to `store.selectChannelAvatarUrl`
 * (pure heuristic, unit-tested directly) to pick the avatar entry; the
 * result is ALWAYS passed through `store.sanitizeChannelAvatarUrl`
 * (https-only, bounded, well-formed) before being returned -- this function
 * never returns a raw, unvalidated avatar URL, unlike `probeChannel` above
 * (whose caller does its own validation downstream via `resolveChannelDir`).
 *
 * v1.25.x QoL bugfix (channel avatar REGISTRY): ALSO extracts the channel's
 * own stable `channel_id` (validated via `store.CHANNEL_ID_PATTERN`, the
 * SAME `UC…` shape check `sanitizeCapturedChannelMeta` uses) and its
 * canonical `channel_url` (re-validated/normalized through the UNMODIFIED
 * `url.validateChannelUrl`) from the SAME `--dump-single-json` payload the
 * avatar comes from -- this is the ONLY probe that ever hits the channel
 * endpoint directly, so it is the natural, single place to capture a
 * channel's stable identity for the registry (`lib/ytdlp/index.js`'s
 * `ensureChannelAvatar`/`registerChannelAvatar`, lib/ytdlp/store.js). The
 * return shape is now `{avatarUrl, channelId, channelUrl}` (each field
 * independently `null` when absent/invalid) instead of a bare URL string --
 * every existing caller has been updated to read `.avatarUrl` (see the
 * module-level callers in `lib/ytdlp/index.js`).
 *
 * Still resolves to a plain `null` -- never the object -- when NEITHER an
 * avatar NOR a channelId survive parsing/validation (a genuine total miss:
 * spawn failure, non-JSON stdout, no thumbnails, no channel_id): this keeps
 * "no usable identity found at all" indistinguishable from any other total
 * probe failure, exactly like the old bare-string contract's `null` meant
 * "no avatar found."
 * @param {string} channelUrl an ALREADY-VALIDATED channel URL (e.g.
 *   `sub.channelUrl`, already normalized by `url.validateChannelUrl`)
 * @param {object} config `{ cookiesFile, ... }`
 * @returns {Promise<{avatarUrl: string|null, channelId: string|null, channelUrl: string|null}|null>}
 */
function probeChannelAvatar(channelUrl, config) {
  if (typeof channelUrl !== 'string' || channelUrl === '') return Promise.resolve(null);
  const probeArgs = [
    '--dump-single-json',
    '--playlist-items',
    '0',
    '--no-warnings',
    ...cookiesArgs(config),
    '--',
    channelUrl,
  ];
  return spawnYtdlp(probeArgs, {
    timeoutMs: PROBE_TIMEOUT_MS,
    phaseLabel: 'probe',
    cookiesPath: config && config.cookiesFile,
  })
    .then((result) => {
      if (!result || !result.ok || typeof result.stdout !== 'string' || result.stdout.trim() === '') return null;
      let parsed;
      try {
        parsed = JSON.parse(result.stdout);
      } catch {
        return null; // malformed/non-JSON stdout -- never throw, just report "nothing usable found"
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
      const rawAvatarUrl = selectChannelAvatarUrl(parsed.thumbnails);
      const avatarUrl = sanitizeChannelAvatarUrl(rawAvatarUrl);
      const channelId = typeof parsed.channel_id === 'string' && CHANNEL_ID_PATTERN.test(parsed.channel_id)
        ? parsed.channel_id
        : null;
      let probedChannelUrl = null;
      if (typeof parsed.channel_url === 'string') {
        const check = validateChannelUrl(parsed.channel_url);
        if (check.ok) probedChannelUrl = check.url;
      }
      // A total miss -- neither an avatar nor a channelId survived -- is
      // reported as `null`, the SAME "nothing usable found" contract the old
      // bare-string return used, so a caller checking `if (probed)` alone
      // (defense-in-depth) still behaves correctly.
      if (!avatarUrl && !channelId) return null;
      return { avatarUrl, channelId, channelUrl: probedChannelUrl };
    })
    .catch(() => null);
}

/**
 * Re-pull backfill: refresh RELEASE-DATE metadata and best-effort SUBTITLES
 * for a SINGLE already-downloaded video, without ever downloading the video
 * itself again. Used by a backfill loop over existing yt-dlp downloads
 * (never wired to a route/scheduler here -- this file stays a thin
 * invocation seam only, per the module comment above).
 *
 * ROBUST TWO-PASS design, deliberately NOT the fragile single-pass
 * `--dump-json --no-simulate --write-subs` combo: each concern gets its own
 * spawn, its own failure boundary, and its own timeout, so a metadata-side
 * failure can never take subtitles down with it (or vice versa) -- see the
 * "NEVER throws" contract below.
 *
 * PASS A (metadata only): `--dump-json --skip-download --no-warnings
 * --no-playlist <cookiesArgs> -- <watchUrl>`. Parses `stdout` as a single JSON
 * object (one video, far under the LIST path's own no-cap streaming design)
 * and derives `releaseDate` via `store.parseCapturedReleaseDate` (`release_date`,
 * falling back to `upload_date`) -- the SAME standalone validator
 * `store.sanitizeCapturedChannelMeta` itself calls internally, reused
 * directly rather than through that combined validator. This is deliberate:
 * `sanitizeCapturedChannelMeta` requires a `channelUrl`/`uploaderUrl` that
 * survives `validateChannelUrl` or it drops the ENTIRE entry -- including a
 * perfectly good `release_date` -- which is unacceptable for a backfill
 * whose primary goal is an accurate release date. Calling the field-level
 * validator directly means a video with a valid date but a missing/odd
 * channel URL still yields `{releaseDate}`. No date parsing / URL validation
 * is reimplemented here.
 *
 * v1.25 QoL bugfix: this pass NO LONGER derives a `channelAvatarUrl` --
 * the per-video `channel_thumbnail` field it used to read does not exist on
 * a real yt-dlp per-video `--dump-json` (see `parseChannelMetaLine`'s own
 * doc comment for the same finding); a real avatar backfill is
 * subscription-level, via `probeChannelAvatar` (above), not per-item here.
 *
 * v1.41.5: Pass A ALSO returns the video's CHANNEL IDENTITY (`channel`:
 * `{channelUrl, channelHandleUrl?, channelId?, channelName?}`) off that same
 * payload -- see the in-body comment for why, and `sanitizeCapturedChannelMeta`
 * (store.js) for the single validation gate it crosses. This is the half that
 * hydrates a MeTube-imported file into a REAL channel (name/avatar/Subscribe)
 * instead of a generic folder label. The avatar itself is still NOT read here
 * (see the v1.25 finding directly above): the batch probes it once per
 * distinct discovered channel via `ensureChannelAvatar`.
 *
 * PASS B (subtitles only): `--write-subs --write-auto-subs --sub-langs en.*
 * --sub-format vtt --convert-subs vtt --skip-download --no-warnings
 * --no-playlist <cookiesArgs> -o <pinnedTemplate> -- <watchUrl>` -- the SAME
 * fixed-literal subtitle flags `buildYtdlpDownloadArgs` already uses for a
 * fresh download (lib/ytdlp/args.js), never forked. Unlike a fresh download,
 * `-o` is PINNED to the EXISTING on-disk media file's own directory/basename
 * (`<dir>/<base>.%(ext)s`, computed from `mediaFilePath` -- never a
 * `%(title)s` template) so the sidecar lands as `<base>.en.vtt` regardless of
 * any title drift since the original download, which is what lets the scan's
 * anchored `findSubtitleSidecar` (lib/subtitles.js) pick it up. That computed
 * path is CONFINED with the exact same structural guard the download path
 * uses to verify its own produced files (`realpathUnderChannelDir`, against
 * `config.downloadDir`) -- when `mediaFilePath` does not resolve under the
 * configured download root (or doesn't exist at all -- `realpathUnderChannelDir`
 * fails closed on a missing path), Pass B is skipped entirely (no spawn is
 * ever attempted) and `wroteSubs` stays `false`. `wroteSubs` reflects only
 * whether the spawn itself exited cleanly (best-effort: a video with no
 * subtitles available can exit 0 with nothing written) -- the caller is
 * expected to re-check the sidecar's actual presence on disk before
 * persisting `hasSubtitles`, exactly like the scan already does for a fresh
 * download.
 *
 * NEVER video-download flags in EITHER pass: no `-f`, `-x`,
 * `--merge-output-format`, `--download-archive`, or `--audio-format` ever
 * appears in either arg vector -- both passes are `--skip-download`, metadata/
 * subtitle-only, by construction.
 *
 * NEVER throws / never rejects: each pass runs inside its own try/catch, so a
 * failure at ANY layer of one pass (spawn failure, non-zero exit, timeout,
 * non-JSON stdout, a validator rejecting a field) can never
 * prevent the OTHER pass from being attempted, and can never propagate out of
 * this function. Partial success is a first-class outcome: Pass A failing
 * still returns `{wroteSubs: true}` if Pass B succeeded, and Pass B failing
 * still returns `{releaseDate, wroteSubs: false}` if Pass A succeeded. Only
 * when NEITHER pass produced anything usable does this resolve `null` --
 * "nothing to persist for this item" -- so a caller can treat one bad video
 * exactly like any other structured no-op, never a thing that wedges the
 * rest of a batch.
 *
 * Same arg-array / `--` separator / no-`shell:true` / `cookiesArgs` discipline
 * as `probeChannel`/`runList` above -- `watchUrl` is expected to already be an
 * ALREADY-VALIDATED single-video watch URL (e.g.
 * `classifySingleVideo(...).watchUrl`), never built into a shell string here.
 * @param {string} watchUrl an already-validated single-video watch URL
 * @param {string} mediaFilePath the EXISTING on-disk media file this backfill
 *   targets -- it does NOT have to live under `config.downloadDir` (v1.41.5:
 *   a MeTube-era import in a plain library root is the whole point); Pass B
 *   simply reports `subsSkipped` for those instead of writing a sidecar.
 * @param {object} config `{ downloadDir, cookiesFile, ... }`
 * @returns {Promise<{releaseDate?: number, sourceTitle?: string, chapters?: Array, channel?: {channelUrl: string, channelHandleUrl?: string, channelId?: string, channelName?: string}, wroteSubs: boolean, subsSkipped?: true} | null>}
 */
async function repullItemMetaAndSubs(watchUrl, mediaFilePath, config) {
  if (typeof watchUrl !== 'string' || watchUrl === '') return null;
  if (typeof mediaFilePath !== 'string' || mediaFilePath === '') return null;

  // ---- Pass A: metadata only -- never writes a file, never downloads. ----
  let releaseDate;
  let sourceTitle;
  let chapters;
  let channel;
  try {
    const metaArgs = [
      '--dump-json',
      '--skip-download',
      '--no-warnings',
      '--no-playlist',
      ...cookiesArgs(config),
      '--',
      watchUrl,
    ];
    const metaResult = await spawnYtdlp(metaArgs, {
      timeoutMs: REPULL_TIMEOUT_MS,
      phaseLabel: 'metadata re-pull',
      cookiesPath: config && config.cookiesFile,
    });
    if (metaResult && metaResult.ok && typeof metaResult.stdout === 'string' && metaResult.stdout.trim() !== '') {
      const parsed = JSON.parse(metaResult.stdout); // may throw on malformed/non-JSON stdout -- caught below
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        // `?? undefined` normalizes `parseCapturedReleaseDate`'s own `null`
        // ("absent/invalid") into `undefined`, matching this function's own
        // "present iff the key exists" return contract below.
        const parsedReleaseDate = parseCapturedReleaseDate(parsed.release_date) ?? parseCapturedReleaseDate(parsed.upload_date);
        if (parsedReleaseDate !== null) releaseDate = parsedReleaseDate;
        // v1.33 T3: the video's REAL title off the same dump -- bounded by
        // the SAME field-level sanitizer the capture path uses
        // (`sanitizeCapturedTitle`), called directly for the same reason
        // `parseCapturedReleaseDate` is above: a good title must never be
        // dropped because some OTHER field failed validation.
        const parsedTitle = sanitizeCapturedTitle(parsed.title);
        if (parsedTitle !== null) sourceTitle = parsedTitle;
        // v1.34 T3: the info dict's own chapters array ({start_time, title}
        // objects) -- passed through RAW here (presence-checked only);
        // bounded/normalized downstream by recordRepulledItemMeta's own
        // single-grammar-owner re-normalization, the same division of labor
        // as the date fields above.
        if (Array.isArray(parsed.chapters)) {
          chapters = parsed.chapters
            .filter((ch) => ch && typeof ch === 'object')
            .map((ch) => ({ startTime: Number(ch.start_time), title: typeof ch.title === 'string' ? ch.title : '' }));
        }
        // v1.41.5 (Dean's MeTube-import hydration): the CHANNEL IDENTITY --
        // `channel_url`/`channel_id`/`channel`/`uploader_url` have ALWAYS been
        // sitting in this same per-video info dict; this pass simply never
        // read them. Without them, a MeTube-imported file shows a generic
        // folder-name "channel": no real name, no avatar, no Subscribe button.
        // Everything is validated by the SINGLE download-capture gate
        // (`store.sanitizeCapturedChannelMeta` -- see the import comment at
        // the top of this file), which drops the whole bundle unless a
        // channel URL survives `url.validateChannelUrl`, so an odd/hostile
        // info dict can never yield a half-formed identity. NOTE: this is
        // identity ONLY -- the AVATAR still comes from the channel endpoint
        // (`probeChannelAvatar`, above), which the batch runs once per
        // DISTINCT channel; a per-video dump carries no `channel_thumbnail`
        // (the v1.25 finding, unchanged).
        const classified = classifySingleVideo(watchUrl);
        const captured = sanitizeCapturedChannelMeta({
          videoId: classified.ok ? classified.videoId : parsed.id,
          channelUrl: parsed.channel_url,
          uploaderUrl: parsed.uploader_url,
          channelId: parsed.channel_id,
          channelName: typeof parsed.channel === 'string' && parsed.channel !== '' ? parsed.channel : parsed.uploader,
        });
        if (captured) {
          // Only the identity fields -- the date/title/chapters above are
          // this function's own, field-level-validated business (see the
          // import comment: the combined validator is used here for identity
          // and NOWHERE else in this function).
          channel = {
            channelUrl: captured.channelUrl,
            ...(captured.channelHandleUrl ? { channelHandleUrl: captured.channelHandleUrl } : {}),
            ...(captured.channelId ? { channelId: captured.channelId } : {}),
            ...(captured.channelName ? { channelName: captured.channelName } : {}),
          };
        }
      }
    }
  } catch {
    // Malformed/non-JSON stdout, or any other Pass-A-layer failure -- never
    // fatal to this function; Pass B below is attempted regardless.
  }

  // ---- Pass B: subtitles only -- never downloads video; sidecar pinned to
  // the EXISTING media file's own base, never a %(title)s template. --------
  let wroteSubs = false;
  let subsSkipped = false;
  try {
    const root = config && config.downloadDir;
    if (typeof root === 'string' && root !== '' && realpathUnderChannelDir(mediaFilePath, root)) {
      const dir = path.dirname(mediaFilePath);
      const ext = path.extname(mediaFilePath);
      const base = path.basename(mediaFilePath, ext);
      // Gate finding fix: yt-dlp re-parses ANY `%(field)s`-shaped substring
      // inside an `-o` value as an output-template field and expands it
      // against the CURRENT run's info-dict -- it does not know or care that
      // `base` came from an on-disk filename rather than a template. Since
      // `--windows-filenames` (buildYtdlpDownloadArgs, args.js) does NOT
      // strip `%`/`(`/`)`, a media file whose basename legitimately contains
      // a `%(...)s`-shaped substring (e.g. a title once containing literal
      // parens/percent, such as `Cool clip (%(webpage_url)s remix)
      // [id].mp4`) would otherwise make yt-dlp re-expand that token, landing
      // the subtitle sidecar at a WRONG name that `findSubtitleSidecar`'s
      // anchored `^<base>\.<lang>\.vtt$` match can never find. Doubling every
      // literal `%` to `%%` is yt-dlp's own documented escape for a literal
      // percent in an output template, so `base` is inert here -- ONLY the
      // trailing `.%(ext)s` we append below stays a real, single-percent
      // template token.
      const safeBase = base.replace(/%/g, '%%');
      const pinnedTemplate = path.join(dir, `${safeBase}.%(ext)s`);
      const subsArgs = [
        '--write-subs',
        '--write-auto-subs',
        '--sub-langs',
        'en.*',
        '--sub-format',
        'vtt',
        '--convert-subs',
        'vtt',
        '--skip-download',
        '--no-warnings',
        '--no-playlist',
        ...cookiesArgs(config),
        '-o',
        pinnedTemplate,
        '--',
        watchUrl,
      ];
      const subsResult = await spawnYtdlp(subsArgs, {
        timeoutMs: REPULL_TIMEOUT_MS,
        phaseLabel: 'subtitle re-pull',
        cookiesPath: config && config.cookiesFile,
      });
      wroteSubs = Boolean(subsResult && subsResult.ok);
    } else {
      // `mediaFilePath` did not pass the confinement check: Pass B is skipped
      // entirely, no spawn is ever attempted, and `wroteSubs` stays `false`.
      //
      // v1.41.5: a STRUCTURAL skip is now reported (`subsSkipped`), because it
      // is the NORMAL case for Dean's MeTube imports -- they live in a plain
      // library root, so the subtitle sidecar confinement (deliberately left
      // untouched: this backfill still never writes a file outside the
      // module's own tree) can never apply to them. Without the signal, the
      // batch's `markComplete = wroteSubs === true` gate would read "subs pass
      // didn't complete" -- i.e. a TRANSIENT failure -- and every hydrated
      // import would be reported `failed`, stay un-marked, and be re-fetched
      // over the network on every single later reheat. A skip that can never
      // succeed is not a retryable failure; the caller distinguishes the two
      // on exactly this flag.
      //
      // GATE FIX (adversarial WARNING): `realpathUnderChannelDir` fails CLOSED
      // -- it returns false BOTH for "genuinely outside the root" AND for "any
      // realpathSync throw" (a NAS/mount blip, an EACCES, a file deleted
      // mid-run; see lib/ytdlp/args.js). Claiming a structural skip on the
      // latter would permanently mark an IN-ROOT item reheated with NO
      // subtitles ever fetched, and every later non-force reheat would skip it
      // -- strictly worse than the pre-v1.41.5 behavior, where it stayed
      // retryable. So the skip is only claimed when it is genuinely structural:
      // no download root configured at all, or the path RESOLVES fine and
      // simply lives elsewhere. An unresolvable path is left retryable
      // (`subsSkipped` stays false -> counted `failed`, marker withheld).
      const noRoot = !(typeof root === 'string' && root !== '');
      let resolves = false;
      if (!noRoot) {
        try {
          fs.realpathSync(mediaFilePath);
          resolves = true;
        } catch {
          resolves = false; // unreadable/vanished -- transient, NOT structural
        }
      }
      subsSkipped = noRoot || resolves;
    }
  } catch {
    wroteSubs = false;
  }

  if (releaseDate === undefined && sourceTitle === undefined && chapters === undefined
    && channel === undefined && !wroteSubs) return null;

  return {
    ...(releaseDate !== undefined ? { releaseDate } : {}),
    ...(sourceTitle !== undefined ? { sourceTitle } : {}),
    ...(chapters !== undefined ? { chapters } : {}),
    ...(channel !== undefined ? { channel } : {}),
    wroteSubs,
    ...(subsSkipped ? { subsSkipped: true } : {}),
  };
}

/**
 * Thin seam for T4: build the download args and run them. No scheduling/
 * dedup/filtering here -- see the module comment above. Uses `spawnYtdlpDownload`
 * (SF3), not `spawnYtdlp`.
 *
 * C1 (T4 fix round): `targetIds` (a `string[]` of per-video ids T4 has already
 * filtered) is forwarded straight into `buildYtdlpDownloadArgs`, which is what
 * makes skip/defer decisions structurally binding on this spawn -- everything
 * else here (SF1 redaction, SF2 timeout, SF3 non-buffering stderr, SF7
 * settled-guard) is unchanged.
 *
 * FR-E: an optional 4th arg `opts = { onProgress }` is forwarded straight to
 * `spawnYtdlpDownload`. Omitting it (every pre-T2 call site) is fully
 * backward-compatible -- see that function's own doc comment.
 *
 * v1.15.0 item 6: `opts.oneOff` is forwarded to `buildYtdlpDownloadArgs` (its
 * own 4th param) -- see that function's doc comment. `undefined`/falsy
 * (every subscription call site) is unchanged behavior.
 *
 * v1.15.1 hotfix: the timeout is now `resolveDownloadTimeoutMs(config)`
 * (configurable via `config.downloadTimeoutMinutes`, default 180 minutes)
 * instead of the fixed `DEFAULT_DOWNLOAD_TIMEOUT_MS` constant -- see that
 * function's doc comment. A `config` without a valid
 * `downloadTimeoutMinutes` still gets `DEFAULT_DOWNLOAD_TIMEOUT_MS`, so this
 * is fully backward-compatible.
 *
 * v1.24.0 A2 (T14): `opts.knownIds` is deliberately NOT accepted as a
 * separate param here -- `targetIds` (above) is ALREADY the exact survivor
 * id set this call is targeting (the same array `buildYtdlpDownloadArgs`
 * turns into this spawn's positional `watch?v=` URLs), so it is forwarded
 * to `spawnYtdlpDownload` as `opts.knownIds` directly. Single-sourced: there
 * is no way for the failure-attribution id set to drift from the actual
 * download target set, and every existing caller (subscriptions, one-shot)
 * gets attribution for free without passing anything new.
 *
 * v1.24.0 A3: `opts.onChild` is forwarded straight through to
 * `spawnYtdlpDownload` unchanged -- see that function's own doc comment.
 * Omitting it (every pre-A3 call site) is fully backward-compatible.
 * @param {object} sub
 * @param {object} config
 * @param {string[]} targetIds
 * @param {{onProgress?: (patch: object) => void, oneOff?: boolean, onChild?: (child: import('child_process').ChildProcess) => void}} [opts]
 */
function runDownload(sub, config, targetIds, opts = {}) {
  // v1.41.13: `opts.sourceUrl` (a pre-validated non-YouTube one-off URL) is
  // forwarded to buildYtdlpDownloadArgs, which uses it as the direct download
  // target + the universal template + the extractor gate. Undefined for every
  // subscription and every YouTube one-off (unchanged behavior).
  return spawnYtdlpDownload(buildYtdlpDownloadArgs(sub, config, targetIds, { oneOff: opts && opts.oneOff, sourceUrl: opts && opts.sourceUrl }), {
    timeoutMs: resolveDownloadTimeoutMs(config),
    // v1.31 P3: idle-stall window (FILETUBE_YTDLP_STALL_MINUTES, default 10,
    // 0 = disabled) -- re-validated at this boundary like every other knob.
    stallMs: ytdlpConfig.parseStallMinutes(config && config.stallMinutes) * 60 * 1000,
    cookiesPath: config && config.cookiesFile,
    onProgress: opts && opts.onProgress,
    knownIds: targetIds,
    onChild: opts && opts.onChild,
  });
}

/**
 * Best-effort presence check (`yt-dlp --version`) for a health/status line.
 * Never throws -- returns `false` on any failure (binary missing, spawn
 * error, non-zero exit), `true` only on a clean success.
 */
async function checkYtdlpAvailable() {
  const result = await spawnYtdlp(['--version'], { phaseLabel: 'version check' });
  return result.ok;
}

// v1.31 P6: the binary's actual version string (e.g. "2026.07.04"), for the
// health/status surface -- pre-v1.31 the `--version` stdout was probed for
// availability and then DISCARDED, leaving no way to see drift between the
// pinned Dockerfile version and what's actually on PATH. Returns null when
// yt-dlp is unavailable or prints something version-unlike (bounded +
// charset-checked before anything downstream renders it: digits/dots only,
// the exact shape yt-dlp's CalVer scheme emits).
const YTDLP_VERSION_PATTERN = /^\d{4}\.\d{2}\.\d{2}(?:\.\d+)?$/;
async function getYtdlpVersion() {
  const result = await spawnYtdlp(['--version'], { phaseLabel: 'version check' });
  if (!result || !result.ok || typeof result.stdout !== 'string') return null;
  const version = result.stdout.trim();
  return YTDLP_VERSION_PATTERN.test(version) ? version : null;
}

module.exports = {
  spawnYtdlp,
  spawnYtdlpDownload,
  // Alias kept for naming parity with the exec-plan design doc (`runYtdlp`)
  // -- both names refer to the exact same function.
  runYtdlp: spawnYtdlp,
  redactArgs,
  redactString,
  runList,
  runDownload,
  probeChannel,
  // v1.25 QoL bugfix: the REAL channel-avatar probe (channel endpoint, not
  // the dead per-video `channel_thumbnail` field) -- see its own doc comment
  // above for the full rationale.
  probeChannelAvatar,
  repullItemMetaAndSubs,
  checkYtdlpAvailable,
  // v1.31 P6: the actual binary version for the health/status surface.
  getYtdlpVersion,
  // v1.31 P0: the pacing-aware list budget + the human budget formatter --
  // exported so tests can assert the scaling arithmetic and the exact
  // phase-named reason strings against the real implementations.
  resolveListTimeoutMs,
  formatTimeoutMinutes,
  DEFAULT_LIST_TIMEOUT_MS,
  DEFAULT_DOWNLOAD_TIMEOUT_MS,
  DEFAULT_KILL_SIGNAL,
  // FIX 2 (two-reviewer gate): exported so tests can assert `probeChannel`'s
  // dedicated timeout against the real constant instead of a hardcoded
  // duplicate (mirrors DEFAULT_LIST_TIMEOUT_MS/DEFAULT_DOWNLOAD_TIMEOUT_MS
  // above).
  PROBE_TIMEOUT_MS,
  // `repullItemMetaAndSubs`'s own dedicated timeout -- exported so tests can
  // assert it against the real constant instead of a hardcoded duplicate,
  // same posture as PROBE_TIMEOUT_MS above.
  REPULL_TIMEOUT_MS,
  // v1.15.1 hotfix: exported so tests can assert the config-threading
  // behavior directly instead of only indirectly through `runDownload`.
  resolveDownloadTimeoutMs,
  // Exported so tests can assert the bounded-tail invariant (SF3) against
  // the real constant instead of a hardcoded duplicate.
  STDERR_TAIL_LIMIT,
  // v1.20.0 FR-2: the pure FTCHMETA line parser + its bounded-capture cap,
  // exported so tests can exercise/assert them directly instead of only
  // indirectly through spawnYtdlpDownload.
  parseChannelMetaLine,
  MAX_CAPTURED_META,
  // v1.29.0 (R0.1/R0.2): exported so tests can assert the reason-selection
  // logic directly instead of only indirectly through a full spawn.
  pickStderrReason,
};
