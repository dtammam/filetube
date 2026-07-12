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

// v1.28.0 (iOS Shortcuts robustness): `/shorts/<id>`, `/live/<id>`, and
// `/embed/<id>` are all single-video URL shapes YouTube itself generates (the
// Shorts share sheet, a livestream link, and an iframe embed URL,
// respectively) -- same id charset discipline as every other id shape in
// this file (`[A-Za-z0-9_-]{6,}`). The UPPER length bound is intentionally
// NOT baked into this regex: it is enforced separately, via `isSafeIdParam`
// (two-reviewer gate follow-up, F3 -- see `isPlausiblePath` below), the SAME
// 64-char cap already used for every other id shape in this file (`?v=`,
// `?list=`, `buildWatchUrl`'s own input, `isSafeVideoId`), so a bare
// `validateChannelUrl` call and `classifySingleVideo`'s own downstream
// re-check agree on what counts as a safe id, sourced from one predicate
// rather than a second, drifting length literal. Deliberately does NOT touch
// the SUBSCRIPTION-side skip-Shorts `--match-filter` (args.js) -- that is an
// unrelated, list-time filtering concern for channel polls, not a URL-shape
// validation rule.
//
// Two-reviewer gate follow-up (F2): `/embed/videoseries` is YouTube's own
// canonical WHOLE-PLAYLIST embed URL (`/embed/videoseries?list=<id>`) -- the
// literal token `videoseries` (not a real video id) happens to fit the id
// charset above, so without this exclusion it would be silently accepted as
// videoId `"videoseries"` (202, then a confusing downstream yt-dlp failure
// once it actually tries to fetch a "video" with that id). The negative
// lookahead rejects ONLY the exact literal segment `videoseries` (followed
// immediately by `/` or end-of-path) so it falls through to this function's
// normal "not a single video" handling instead -- mirroring how `/playlist`
// itself is already handled elsewhere in this file. Any OTHER id that merely
// happens to START WITH "videoseries" (e.g. a longer, unrelated id) is
// unaffected: the lookahead only matches the token in isolation.
const SHORTS_LIVE_EMBED_PATH = /^\/(?:shorts|live|embed)\/(?!videoseries(?:\/|$))([A-Za-z0-9_-]{6,})\/?$/;

// ---- v1.28.0: Shortcut/share-sheet-friendly input normalization -----------
//
// Real iOS Shortcuts/share-sheet payloads glue punctuation directly onto an
// otherwise-clean URL: a Shortcut's own JSON-dictionary text field can carry
// literal typed quote characters around the URL, a markdown/rich-text share
// wraps it in `[title](url)`/`<url>`, and a sentence just ends the URL with a
// period. None of this punctuation is ever part of a real YouTube URL, so
// peeling it off the OUTERMOST edges only, before FORBIDDEN_CHARS (or any
// other guard) ever runs, is safe by construction: it can only ever DELETE
// characters from the two ends of the string, never rearrange or reveal
// anything, so whatever remains still passes through the exact same
// unchanged guard chain below. A wrap character that is NOT at the true edge
// (e.g. the embedded apostrophe in `.../@a'quote"`) is never touched, so an
// attempt to smuggle a metacharacter mid-string is still caught by
// FORBIDDEN_CHARS exactly as before this normalization existed.
const WRAPPING_CHARS = new Set(['"', "'", '‘', '’', '“', '”', '<', '>', '(', ')', '[', ']', '{', '}']);

// Deliberately narrower than the spec's literal ".,;!" -- "!" and "." and ","
// are NOT shell metacharacters (none appear in FORBIDDEN_CHARS at all), so
// stripping a glued trailing one is purely cosmetic. ";" is EXPLICITLY
// excluded here even though it is common "end of clause" punctuation,
// because ";" IS a FORBIDDEN_CHARS member (shell command separator): the
// pre-existing, explicitly regression-locked test
// (`https://www.youtube.com/@a; rm -rf /`, test/unit/ytdlp-url.test.js)
// depends on a semicolon glued to the end of a whitespace-extracted
// candidate still tripping FORBIDDEN_CHARS. Stripping it here would silently
// turn that hostile input into an ACCEPTED clean handle URL instead of a
// rejection -- a real (if narrow) security regression -- so this
// deliberately deviates from the task brief's literal "TRAILING-only .,;!"
// wording by dropping ";" from the set. See the SDE completion report.
const TRAILING_ONLY_CHARS = new Set(['.', ',', '!']);

const MAX_STRIP_ITERATIONS = 8;

// Strips at most one WRAPPING_CHARS character from the front, and one
// WRAPPING_CHARS-or-TRAILING_ONLY_CHARS character from the back, per pass,
// bounded to MAX_STRIP_ITERATIONS passes (handles nested wraps like
// `"<url>"` peeling one layer per pass) and stopping the instant a pass
// removes nothing. Never touches the middle of the string.
function stripSurroundingPunctuation(s) {
  let result = s;
  for (let i = 0; i < MAX_STRIP_ITERATIONS; i += 1) {
    const before = result;
    if (result.length > 0 && WRAPPING_CHARS.has(result[0])) {
      result = result.slice(1);
    }
    if (result.length > 0) {
      const lastChar = result[result.length - 1];
      if (WRAPPING_CHARS.has(lastChar) || TRAILING_ONLY_CHARS.has(lastChar)) {
        result = result.slice(0, -1);
      }
    }
    if (result === before) break;
  }
  return result;
}

// A backslash is never legitimate anywhere in a real YouTube URL. Truncating
// at the first one (rather than rejecting outright) recovers a clean URL
// from input where something was appended after a stray backslash; a
// backslash used AS the hostile payload itself is simply discarded along
// with everything after it, so it never reaches FORBIDDEN_CHARS at all --
// harmless either way, since FORBIDDEN_CHARS already rejects a bare `\`.
function truncateAtBackslash(s) {
  const idx = s.indexOf('\\');
  return idx === -1 ? s : s.slice(0, idx);
}

// Two-reviewer gate follow-up (F4): a URL fragment (`#...`) is NEVER sent to
// a server -- a browser strips it before the request line even leaves the
// client -- and it is NEVER part of a YouTube video/playlist/channel's
// identity (that's entirely the path + query's job). Discarding everything
// from the first `#` onward here, BEFORE `rebuildQueryAllowlist` runs, is
// therefore purely cosmetic and safe by the exact same "can only ever DELETE
// characters, never rearrange or reveal anything" construction
// `stripSurroundingPunctuation`/`truncateAtBackslash` above already rely on:
// whatever remains still passes through the same unchanged guard chain
// below. Run BEFORE the query rebuild (rather than after, or left to `new
// URL()` to handle on its own) specifically so a hostile payload glued onto
// a fragment (e.g. `watch?v=ID#&$(evil)`) is discarded WHOLESALE -- without
// this step, `rebuildQueryAllowlist`'s own `&`-split would instead treat the
// fragment as trailing garbage stuck to the kept `v` value (`v=ID#`), which
// `new URL()` then reinterprets as "empty fragment", leaving a harmless but
// stray trailing `#` in the accepted, persisted URL.
function stripFragment(s) {
  const idx = s.indexOf('#');
  return idx === -1 ? s : s.slice(0, idx);
}

// The "&"-param fix: iOS share sheets commonly append a SECOND query param
// (`?si=<token>&t=5`, `?v=<id>&feature=share`) that has nothing to do with
// the video/playlist identity -- but the bare `&` character is, and remains,
// in FORBIDDEN_CHARS (shell metacharacter), so a multi-param query has always
// been rejected outright even when the URL itself was entirely legitimate.
// Rebuilding the query ALLOWLIST-style -- keep only `list` for a `/playlist`
// path, else only `v`, dropping everything else including every `&` -- fixes
// this WITHOUT touching FORBIDDEN_CHARS itself: by the time that check runs,
// there is no `&` left in a legitimate share URL for it to ever see.
// Deliberately plain string ops, not `new URL()`: the candidate has not been
// parsed yet at this point (and may still fail to parse), so this must stay
// defensive against a candidate that isn't a well-formed URL at all -- on any
// shape it doesn't recognize, it degrades to "drop the query," never throws.
function rebuildQueryAllowlist(s) {
  const qIdx = s.indexOf('?');
  if (qIdx === -1) return s; // no query string to rebuild
  const pathPart = s.slice(0, qIdx);
  const queryPart = s.slice(qIdx + 1);
  const keepKey = pathPart.endsWith('/playlist') ? 'list' : 'v';
  let keptValue = null;
  for (const pair of queryPart.split('&')) {
    const eqIdx = pair.indexOf('=');
    const key = eqIdx === -1 ? pair : pair.slice(0, eqIdx);
    if (key === keepKey) {
      keptValue = eqIdx === -1 ? '' : pair.slice(eqIdx + 1);
      break;
    }
  }
  return keptValue === null ? pathPart : `${pathPart}?${keepKey}=${keptValue}`;
}

// Self-diagnosing FORBIDDEN_CHARS rejection message (v1.28.0): names the
// FIRST offending character so a caller (the /subscriptions add form, the
// one-off modal, or an iOS Shortcut author debugging a 400) can see exactly
// what tripped the guard instead of a generic "whitespace or disallowed
// characters" message. A printable character is quoted as-is; a
// whitespace/control character (which would otherwise render invisibly or
// break the message's own formatting) is reported as its Unicode code point.
//
// NIT (two-reviewer gate follow-up, adversarial pass): this echoes the
// offending character back into the returned `error` string, which flows
// out as a JSON `{ error }` body (never HTML) and is rendered by every
// current client via `textContent`/similar (never `innerHTML`), so it is
// safe today. It must STAY that way -- this message is USER INPUT reflected
// back verbatim (a classic reflected-XSS shape if a future consumer ever
// rendered it as HTML) -- any future caller of `validateChannelUrl` /
// `classifySingleVideo` must keep treating this `error` string as plain
// text, never markup.
function describeForbiddenChar(candidate) {
  const match = FORBIDDEN_CHARS.exec(candidate);
  if (!match) return null;
  const ch = match[0];
  const code = ch.codePointAt(0);
  const isPrintable = code >= 0x21 && code <= 0x7e;
  return isPrintable ? `'${ch}'` : `U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
}

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

// `allowSingleVideoShapes` (two-reviewer gate follow-up, F7): whether
// `/shorts/<id>`, `/live/<id>`, `/embed/<id>` are recognized as plausible
// AT ALL. Defaults to caller-controlled, but every actual caller of
// `validateChannelUrl` below except `classifySingleVideo` implicitly passes
// `false` -- see `validateChannelUrl`'s own doc comment for the full
// rationale (in short: this predicate is ALSO the subscription-add
// validator, and a Shorts/live/embed link is never a legitimate
// subscription target).
function isPlausiblePath(hostname, parsed, allowSingleVideoShapes) {
  if (hostname === 'youtu.be') {
    return YOUTU_BE_PATH.test(parsed.pathname);
  }
  if (parsed.pathname === '/playlist') {
    return isSafeIdParam(parsed.searchParams.get('list'));
  }
  if (parsed.pathname === '/watch') {
    return isSafeIdParam(parsed.searchParams.get('v'));
  }
  // v1.28.0, gated by `allowSingleVideoShapes` (two-reviewer gate follow-up,
  // F7): /shorts/<id>, /live/<id>, /embed/<id>. Only `classifySingleVideo`
  // (the one-off download classifier, which NEVER creates a subscription)
  // opts into these three shapes; every other caller of this shared,
  // security-critical validator -- store.js's subscription add/patch path,
  // args.js's pre-spawn re-validation, run.js's captured-metadata sanitizer,
  // this module's own repull/pin routes -- uses the default (`false`) and so
  // still rejects them exactly as before these shapes existed. Without this
  // gate, `POST /api/subscriptions` with a `/shorts/<id>` URL would create a
  // SUBSCRIPTION the poll loop then treats as a "channel," re-listing and
  // re-downloading that one video forever -- not a security issue (still
  // host-allowlisted, charset/length-bounded, and only ever reaches argv via
  // `buildWatchUrl`), but an unintended scope leak the pre-existing
  // `/watch`/`youtu.be` shapes deliberately do NOT have (those two remain
  // accepted on the subscription path unconditionally -- established,
  // pre-v1.28.0 precedent this fix leaves untouched).
  if (allowSingleVideoShapes) {
    const shortsMatch = parsed.pathname.match(SHORTS_LIVE_EMBED_PATH);
    if (shortsMatch) {
      // Two-reviewer gate follow-up (F3): re-assert the SAME charset+length
      // predicate (`isSafeIdParam`, the 64-char cap) already used for every
      // other id shape in this file. Before this fix, an oversized (up to
      // MAX_URL_LENGTH, ~2048-char) shorts/live/embed id passed THIS
      // function outright (SHORTS_LIVE_EMBED_PATH's own charset match has no
      // upper bound) and was only caught one layer down, by
      // `classifySingleVideo`'s own `isSafeVideoId` re-check -- functionally
      // safe (nothing oversized could ever reach a spawn either way), but a
      // consistency wart: a bare `validateChannelUrl(url, { allowSingleVideoShapes: true })`
      // call disagreed with `classifySingleVideo` about what counts as
      // "plausible." They now agree.
      return isSafeIdParam(shortsMatch[1]);
    }
  }
  return CHANNEL_PATH_PATTERNS.some((re) => re.test(parsed.pathname));
}

/**
 * Validate (and normalize) a user-supplied channel/video/playlist URL.
 * Returns `{ ok: true, url: <normalizedString> }` on success or
 * `{ ok: false, error: <short reason> }` on failure. Never throws.
 * @param {*} raw candidate URL (expected to be a string; anything else is rejected)
 * @param {object} [opts]
 * @param {boolean} [opts.allowSingleVideoShapes] two-reviewer gate follow-up
 *   (F7): when `true`, also accepts `/shorts/<id>`, `/live/<id>`,
 *   `/embed/<id>` as plausible (single-video) shapes. Defaults to `false` --
 *   the SUBSCRIPTION-SAFE posture -- because this function is ALSO the
 *   subscription-add validator (store.js's `validateSubscriptionInput`), and
 *   a Shorts/live/embed link is never a legitimate subscription target (see
 *   `isPlausiblePath`'s own doc comment for the full rationale). Only
 *   `classifySingleVideo`, below, passes `true`.
 */
function validateChannelUrl(raw, opts = {}) {
  const allowSingleVideoShapes = opts.allowSingleVideoShapes === true;
  if (typeof raw !== 'string' || raw.trim() === '') {
    return fail('channelUrl must be a non-empty string');
  }
  // Length cap runs on the ORIGINAL raw string, before any trim/extraction
  // work below, so a deliberately oversized blob is rejected up front --
  // extraction can never be used to "shrink" an oversized input past this
  // cap (FR-5, v1.16.0).
  if (raw.length > MAX_URL_LENGTH) {
    return fail('channelUrl is too long');
  }

  // ---- FR-5 normalization pre-step (v1.16.0, extended v1.28.0) ------------
  // Real-world YouTube share-sheet pastes arrive as prose with an embedded
  // URL and/or stray surrounding whitespace, e.g.
  // `"Title\nhttps://youtu.be/<id>?si=<token>"` or
  // `" https://youtu.be/<id>?si=<token>\n"`. Trim first; if internal
  // whitespace still remains (i.e. this is text with an embedded URL, not a
  // bare URL), extract the first `http(s)://`-prefixed run of non-whitespace
  // characters as the candidate. If no such run exists, fall through
  // unchanged -- `trimmed` then fails the (unchanged) `FORBIDDEN_CHARS` check
  // below exactly as it did before this pre-step existed. This ONLY picks a
  // single candidate token; every existing guard below still runs on that
  // token, UNCHANGED, so extraction can never weaken or bypass a check (a
  // hostile embedded URL like `click https://evil.com/x` extracts to
  // `https://evil.com/x`, which still fails the host allowlist below).
  const trimmed = raw.trim();

  // Step a (v1.28.0): peel wrapping/glued punctuation off BOTH ends of the
  // whole trimmed input first -- see `stripSurroundingPunctuation`'s own doc
  // comment for why this is safe. This is what lets a Shortcut's literal
  // `"https://...url..."` (typed quote characters, not JSON string
  // delimiters), `<https://...url...>`, and `(https://...url...)` validate.
  let candidate = stripSurroundingPunctuation(trimmed);

  // Step b (FR-5, v1.16.0; now case-insensitive + re-stripped, v1.28.0): if
  // internal whitespace still remains (this is prose with an embedded URL,
  // not a bare URL), extract the first `http(s)://`-prefixed run of
  // non-whitespace characters. Case-insensitive so an auto-capitalized
  // "Https://..." (iOS' own auto-capitalize-first-word habit) still
  // extracts. The extracted token is re-passed through the SAME end-stripper
  // as step a, so a markdown-style `[title](url)` TAIL (the glued trailing
  // `)`) or a sentence-ending period glued straight onto the URL cleans up
  // too -- see `TRAILING_ONLY_CHARS`'s own comment for why this can never
  // strip away an attached shell metacharacter.
  //
  // Two-reviewer gate follow-up (F6, OPTIONAL item, done): also extract when
  // `candidate` does NOT already look like a bare URL (`!/^https?:\/\//i`),
  // even with NO whitespace anywhere -- covers a SPACELESS markdown link
  // `[title](url)`: step a only peels the outer `[`/`)` (the true edges), so
  // the inner `](` glue survives mid-string (e.g. `Video](https://...`), and
  // its `(` used to trip FORBIDDEN_CHARS below with no whitespace ever
  // present to trigger this extraction at all. This is SAFE for the exact
  // same reason the whitespace-triggered case already was (and already is
  // covered by existing, passing tests: a hostile PREFIX glued before a
  // legitimate URL, e.g. `"$(rm -rf /) https://www.youtube.com/@channel"`,
  // already extracts-and-accepts today, discarding the hostile prefix
  // entirely -- it can never reach a spawn either way, since only the
  // extracted+re-validated candidate is ever persisted/used downstream, the
  // same way `describeForbiddenChar`'s own doc comment on FORBIDDEN_CHARS
  // reasons about what "reaches" a guard). This widened condition changes
  // WHEN extraction is attempted, never WHAT it is allowed to extract
  // (still exactly one `http(s)://`-prefixed run) or what runs on the
  // result (the SAME unchanged guard chain) -- a candidate with no
  // extractable `http(s)://` substring at all still falls through
  // unchanged, exactly as before.
  if (/\s/.test(candidate) || !/^https?:\/\//i.test(candidate)) {
    const match = candidate.match(/https?:\/\/\S+/i);
    if (match) {
      candidate = stripSurroundingPunctuation(match[0]);
    }
  }

  // Step c (v1.28.0): truncate at the first backslash -- see
  // `truncateAtBackslash`'s own doc comment.
  candidate = truncateAtBackslash(candidate);

  // Step c2 (two-reviewer gate follow-up, v1.28.0, F4): strip a trailing
  // fragment -- see `stripFragment`'s own doc comment for why this is safe,
  // and why it must run BEFORE the query rebuild immediately below.
  candidate = stripFragment(candidate);

  // Step d (v1.28.0, the "&"-param fix): rebuild the query ALLOWLIST-style
  // so a legitimate multi-param share URL (`youtu.be/<id>?si=<x>&t=5`,
  // `watch?v=<id>&feature=share`) no longer carries a bare `&` into
  // FORBIDDEN_CHARS below -- see `rebuildQueryAllowlist`'s own doc comment.
  candidate = rebuildQueryAllowlist(candidate);

  // Option-injection defense: a URL starting with `-` could be misread as a
  // flag by yt-dlp's own arg parser if it were ever placed before a `--`
  // separator (the builders in args.js always place it after one, but this
  // check makes the intent explicit and rejects the value outright rather
  // than relying solely on that downstream mitigation).
  if (candidate.startsWith('-')) {
    return fail('channelUrl must not start with "-"');
  }
  // Checked against the candidate (post-normalization, pre-URL-parse) so
  // nothing a permissive URL parser might tolerate can carry a shell
  // metacharacter or control character through validation. FORBIDDEN_CHARS
  // itself is byte-identical to before this feature -- only what reaches it
  // (`candidate`) changed, via the normalization steps above.
  if (FORBIDDEN_CHARS.test(candidate)) {
    const bad = describeForbiddenChar(candidate);
    return fail(
      `channelUrl contains a disallowed character (${bad}) -- send the bare video URL without surrounding quotes or extra query parameters`,
    );
  }

  let parsed;
  try {
    parsed = new URL(candidate);
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

  if (!isPlausiblePath(hostname, parsed, allowSingleVideoShapes)) {
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
//
// Two-reviewer gate follow-up (F7): this is the ONE call site that passes
// `{ allowSingleVideoShapes: true }` -- see `validateChannelUrl`'s own doc
// comment for why every OTHER caller (the subscription-add path, chiefly)
// deliberately does not. `classifySingleVideo` never creates a subscription
// (it feeds only the one-off download route), so opting a Shorts/live/embed
// URL INTO "plausible" here can never let one become a polled subscription.
function classifySingleVideo(raw) {
  const validated = validateChannelUrl(raw, { allowSingleVideoShapes: true });
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
    // v1.28.0: /shorts/<id>, /live/<id>, /embed/<id> -- also single-video
    // shapes (already shape/charset-validated by isPlausiblePath's
    // SHORTS_LIVE_EMBED_PATH above); a Short/live/embed link classifies and
    // downloads exactly like an ordinary watch URL, via the SAME
    // buildWatchUrl canonicalization below.
    const shortsMatch = parsed.pathname.match(SHORTS_LIVE_EMBED_PATH);
    if (shortsMatch) {
      videoId = shortsMatch[1];
    } else {
      // Anything else that made it past validateChannelUrl's own shape check
      // is necessarily a channel/playlist/handle/user/c URL, never a single
      // video -- classify (not re-validate) which kind, for the caller's 400
      // message.
      const kind = parsed.pathname === '/playlist' ? 'playlist' : 'channel';
      return { ok: false, kind, error: 'URL is a channel/playlist/handle, not a single video' };
    }
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

/**
 * v1.36 F1 fix round 2 (adversarial gate): is this a CHANNEL-ROOT URL --
 * one of the bare channel shapes (`/@handle`, `/channel/<id>`, `/c/<name>`,
 * `/user/<name>`) on an allowed YouTube host? Distinct from "valid
 * subscription URL": `validateChannelUrl` also accepts `/playlist?list=`
 * and `/watch?v=`/`youtu.be` shapes, and the caller (args.js's
 * break-early-safe decision) must treat those differently -- a bare channel
 * URL expands to SEPARATE videos/streams/shorts tab playlists on current
 * yt-dlp (so it may be swapped for the channel's combined UU uploads feed
 * when the channelId is known), while a playlist has no newest-first
 * ordering guarantee at all and must never get a break-early filter.
 *
 * Runs the FULL `validateChannelUrl` first (never a second, weaker parser --
 * the same single-validator posture as every other consumer), then shape-
 * checks the validated URL's pathname against the same CHANNEL_PATH_PATTERNS
 * allowlist `isPlausiblePath` uses. Never throws; any invalid/other-shaped
 * input is simply `false`.
 */
function isChannelRootUrl(raw) {
  const validation = validateChannelUrl(raw);
  if (!validation.ok) return false;
  let parsed;
  try {
    parsed = new URL(validation.url);
  } catch {
    return false;
  }
  if (parsed.hostname === 'youtu.be') return false;
  return CHANNEL_PATH_PATTERNS.some((pattern) => pattern.test(parsed.pathname));
}

module.exports = {
  validateChannelUrl,
  ALLOWED_HOSTS,
  isSafeVideoId,
  buildWatchUrl,
  classifySingleVideo,
  isChannelRootUrl,
};
