'use strict';

// Channel URL validation for the optional yt-dlp subscription module. This is
// the SECURITY-CRITICAL surface (AC 27-31): `validateChannelUrl` is the ONE
// source of truth for "is this a channel URL we will ever pass to yt-dlp,"
// used both at add-time (the POST /api/subscriptions route, via
// store.js's validateSubscriptionInput) and again immediately before every
// spawn (lib/ytdlp/args.js's builders re-validate `sub.channelUrl`
// defense-in-depth). Pure and synchronous, no side effects, never throws --
// every failure mode returns `{ ok: false, error }` so callers can map it to
// a clean `400` instead of a crash.
//
// Fail-safe posture: when in doubt, reject. A hostile/malformed URL must
// never reach persistence (db.json) or a child-process argv.

// Only these exact YouTube hosts are accepted (case-insensitively). This is
// deliberately an ALLOWLIST, not a "ends with youtube.com" suffix check --
// the latter would accept an attacker-registered `youtube.com.evil.com`.
const ALLOWED_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
]);

// Defense-in-depth length cap: no legitimate YouTube channel/video/playlist
// URL is anywhere near this long. Rejecting oversized input early avoids
// wasting cycles on regex/URL-parsing of a deliberately huge string.
const MAX_URL_LENGTH = 2048;

// Shell metacharacters + whitespace/control characters, checked against the
// RAW input string (before any parsing/trimming) so nothing "cleaned up" by
// `new URL()` can smuggle a hostile character past this check. Covers the
// option-injection defense (leading `-`, checked separately below) and the
// documented reject-list: `; | & \` $ < > ' " ( ) \` plus any whitespace or
// control character (including newlines).
// eslint-disable-next-line no-control-regex
const FORBIDDEN_CHARS = /[\s\x00-\x1f\x7f;&|`$<>'"(){}\\]/;

// Plausible path shapes we accept, kept intentionally tight (an allowlist of
// SHAPES, not a denylist of bad ones): an @handle, /channel/<id>, /c/<name>,
// or /user/<name>. `/playlist` and `/watch` are handled separately (their
// search params are what's checked, not the bare path) and `youtu.be` is
// handled separately too (its whole path IS the video id).
const CHANNEL_PATH_PATTERNS = [
  /^\/@[A-Za-z0-9._-]+\/?$/, // /@handle
  /^\/channel\/[A-Za-z0-9_-]+\/?$/, // /channel/UC...
  /^\/c\/[A-Za-z0-9._-]+\/?$/, // /c/Name
  /^\/user\/[A-Za-z0-9._-]+\/?$/, // /user/Name
];

const YOUTU_BE_PATH = /^\/[A-Za-z0-9_-]{6,}$/; // youtu.be/<videoId>

// SF5: `searchParams.get(...)` returns the percent-DECODED value, but
// `FORBIDDEN_CHARS` above only ever runs against the RAW (still-encoded)
// string -- so a payload like `?v=%3B%20rm%20-rf%20%2F` (decodes to
// `; rm -rf /`) contains no raw metacharacter and would otherwise sail past
// that check. A real YouTube video/playlist id is always a short run of
// `[A-Za-z0-9_-]`, so the DECODED `list`/`v` value is constrained to that
// exact charset with a bounded length here -- independent of, and in
// addition to, the pre-decode raw-string check above.
const ID_PARAM_PATTERN = /^[A-Za-z0-9_-]+$/;
const MAX_ID_PARAM_LENGTH = 64;

function isSafeIdParam(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_ID_PARAM_LENGTH &&
    ID_PARAM_PATTERN.test(value)
  );
}

// ---- C1: per-survivor watch-URL construction -------------------------------
//
// The download-scoping fix (T4 fix round, C1) targets individual survivor
// video ids instead of the whole channel. Those ids come from yt-dlp
// `--dump-json` metadata (`video.id`), which has NOT yet passed through this
// file's own charset/length check the way a persisted `channelUrl` has --
// `isSafeVideoId` re-asserts the SAME rule (`ID_PARAM_PATTERN` +
// `MAX_ID_PARAM_LENGTH`) already used for `?v=`/`?list=` params above, single-
// sourced from `isSafeIdParam` rather than a second, drifting regex.

// Exported alias: same predicate as `isSafeIdParam`, named for the video-id
// call site (lib/ytdlp/index.js's survivor filter, lib/ytdlp/args.js's
// download-arg builder) so callers don't need to know this is the identical
// check already used for URL query params.
function isSafeVideoId(id) {
  return isSafeIdParam(id);
}

// Builds a canonical, host-hardcoded watch URL for a single video id, or
// `null` when the id fails `isSafeVideoId` (fail-safe: an unsafe id simply
// never becomes a download target, it is never silently coerced/truncated).
// The host and scheme are ours (not attacker-controlled); only the id is
// data, and it is charset/length-bounded before it is ever interpolated.
function buildWatchUrl(id) {
  return isSafeVideoId(id) ? `https://www.youtube.com/watch?v=${id}` : null;
}

function fail(error) {
  return { ok: false, error };
}

function isPlausiblePath(hostname, parsed) {
  if (hostname === 'youtu.be') {
    return YOUTU_BE_PATH.test(parsed.pathname);
  }
  if (parsed.pathname === '/playlist') {
    return isSafeIdParam(parsed.searchParams.get('list'));
  }
  if (parsed.pathname === '/watch') {
    return isSafeIdParam(parsed.searchParams.get('v'));
  }
  return CHANNEL_PATH_PATTERNS.some((re) => re.test(parsed.pathname));
}

/**
 * Validate (and normalize) a user-supplied channel/video/playlist URL.
 * Returns `{ ok: true, url: <normalizedString> }` on success or
 * `{ ok: false, error: <short reason> }` on failure. Never throws.
 * @param {*} raw candidate URL (expected to be a string; anything else is rejected)
 */
function validateChannelUrl(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return fail('channelUrl must be a non-empty string');
  }
  if (raw.length > MAX_URL_LENGTH) {
    return fail('channelUrl is too long');
  }
  // Option-injection defense: a URL starting with `-` could be misread as a
  // flag by yt-dlp's own arg parser if it were ever placed before a `--`
  // separator (the builders in args.js always place it after one, but this
  // check makes the intent explicit and rejects the value outright rather
  // than relying solely on that downstream mitigation).
  if (raw.startsWith('-')) {
    return fail('channelUrl must not start with "-"');
  }
  // Checked against the RAW string (not the parsed/trimmed URL) so nothing a
  // permissive URL parser might tolerate can carry a shell metacharacter or
  // control character through validation.
  if (FORBIDDEN_CHARS.test(raw)) {
    return fail('channelUrl contains whitespace or disallowed characters');
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return fail('channelUrl is not a valid URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return fail('channelUrl must use http or https');
  }

  // SF6: legitimate YouTube URLs never carry embedded `user:pass@` userinfo.
  // Rejecting outright (rather than silently stripping it) is the cleaner,
  // fail-safe choice: a URL that came with credentials embedded is already
  // suspicious, stripping-and-continuing would let it silently succeed
  // (and the credentials would still have been visible in the raw input,
  // e.g. in a request log upstream of this check), and yt-dlp members-only
  // auth in this module is cookies-file-only (D2) -- there is no legitimate
  // use for userinfo here at all.
  if (parsed.username || parsed.password) {
    return fail('channelUrl must not contain embedded userinfo');
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!ALLOWED_HOSTS.has(hostname)) {
    return fail('channelUrl host is not an allowed YouTube host');
  }

  if (!isPlausiblePath(hostname, parsed)) {
    return fail('channelUrl does not look like a channel, playlist, user, handle, or video URL');
  }

  // Normalize: lowercase the host (path/query casing can be meaningful, e.g.
  // an @handle or a playlist id, so it is left untouched).
  parsed.hostname = hostname;
  return { ok: true, url: parsed.toString() };
}

// ---- FR-A: single-video URL classifier -------------------------------------
//
// `classifySingleVideo` is the validator foundation the one-shot download
// endpoint (T3's `POST /api/ytdlp/download`) uses to decide whether a
// user-supplied URL names exactly one video (the only thing the one-shot
// endpoint will ever download) or a channel/playlist/handle (which T3 must
// reject with a `400`, never spawning yt-dlp, AC 9/10).
//
// SINGLE SOURCE OF TRUTH: `validateChannelUrl` runs FIRST, unconditionally,
// so every existing security check (host allowlist, http/https-only,
// userinfo-reject, shell-metachar/whitespace-reject, decoded-id charset via
// SF5) applies before this function does anything else -- this is
// deliberately a thin classification LAYER on top of that validator, never a
// parallel/forked re-implementation of it.
function classifySingleVideo(raw) {
  const validated = validateChannelUrl(raw);
  if (!validated.ok) {
    return { ok: false, kind: 'invalid', error: validated.error };
  }

  let parsed;
  try {
    parsed = new URL(validated.url);
  } catch {
    // Unreachable in practice (validateChannelUrl already parsed this exact
    // string successfully) -- fail closed rather than throw if it somehow
    // is not.
    return { ok: false, kind: 'invalid', error: 'channelUrl is not a valid URL' };
  }

  const hostname = parsed.hostname.toLowerCase();
  let videoId = null;
  if (hostname === 'youtu.be') {
    // youtu.be/<id> -- the whole (already shape-validated) path IS the id.
    videoId = parsed.pathname.replace(/^\//, '');
  } else if (parsed.pathname === '/watch') {
    // youtube.com/watch?v=<id> (incl. www./m./music. -- all in ALLOWED_HOSTS).
    videoId = parsed.searchParams.get('v');
  } else {
    // Anything else that made it past validateChannelUrl's own shape check
    // is necessarily a channel/playlist/handle/user/c URL, never a single
    // video -- classify (not re-validate) which kind, for the caller's 400
    // message.
    const kind = parsed.pathname === '/playlist' ? 'playlist' : 'channel';
    return { ok: false, kind, error: 'URL is a channel/playlist/handle, not a single video' };
  }

  // Defense-in-depth re-check: the SAME charset/length predicate already
  // used for the ?v=/?list= params inside validateChannelUrl itself,
  // asserted again here immediately before videoId is allowed to become the
  // classifier's own output (and, downstream, a buildWatchUrl input).
  if (!isSafeVideoId(videoId)) {
    return { ok: false, kind: 'invalid', error: 'video id failed validation' };
  }

  return { ok: true, kind: 'video', videoId, watchUrl: buildWatchUrl(videoId) };
}

module.exports = {
  validateChannelUrl,
  ALLOWED_HOSTS,
  isSafeVideoId,
  buildWatchUrl,
  classifySingleVideo,
};
