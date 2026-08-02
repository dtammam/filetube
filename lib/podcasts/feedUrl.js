'use strict';

// v1.69.0 (podcasts): pure feed-URL validation + secret redaction. No I/O,
// no deps beyond the shared SSRF literal guard. The threat model (exec plan
// attack surface 1+2): a podcast feed URL is USER-SUPPLIED and often carries
// a private auth token in its query (Patreon: `?auth=<token>`), and the
// feed's enclosure URLs embed the same token in the PATH
// (`/api/rss/u/<token>/e/<id>.mp3`). So this module owns two disciplines:
//
//  1. `validateFeedUrl` - the fail-safe add-time gate (http/https only, no
//     userinfo, charset/length bounds, private/loopback literal-host
//     reject). DNS resolve-then-check happens at FETCH time (fetchGuard.js,
//     per hop) - a literal check alone can never be the whole guard.
//  2. `displayFeedUrl` / `redactSecretText` - the query string is treated as
//     secret-bearing UNCONDITIONALLY (no "which params look secret"
//     heuristics to get wrong): display form is origin + pathname, and every
//     error/status string is scrubbed of stored secret material AND the
//     known token-shaped patterns before it can reach persistence, a log
//     line, or an API response.

const { isPrivateOrLocalHost } = require('../ytdlp/url');

const MAX_FEED_URL_LENGTH = 2048;

// Whitespace/control characters checked against the RAW input (before URL
// parsing can "clean" anything) - the lib/ytdlp/url.js posture. Quotes and
// backslash are excluded too; a real feed URL never carries them, and a
// hostile one loses nothing by being rejected.
// eslint-disable-next-line no-control-regex
const FORBIDDEN_CHARS = /[\s\x00-\x1f\x7f'"`\\]/;

/**
 * Validate a user-supplied podcast feed URL. Pure, synchronous, never
 * throws; every failure is `{ ok:false, error }` with a NEUTRAL message
 * (never echoing the input - the input may be a secret).
 * @param {*} raw
 * @returns {{ok:true, url:string, host:string, display:string}|{ok:false, error:string}}
 */
function validateFeedUrl(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { ok: false, error: 'Feed URL is required' };
  }
  if (raw.length > MAX_FEED_URL_LENGTH) {
    return { ok: false, error: 'Feed URL is too long' };
  }
  if (FORBIDDEN_CHARS.test(raw)) {
    return { ok: false, error: 'Feed URL contains forbidden characters' };
  }
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, error: 'Feed URL is not a valid URL' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, error: 'Feed URL must be http(s)' };
  }
  if (parsed.username !== '' || parsed.password !== '') {
    return { ok: false, error: 'Feed URLs with embedded credentials are not allowed' };
  }
  if (isPrivateOrLocalHost(parsed.hostname)) {
    return { ok: false, error: 'That host is not allowed' };
  }
  return {
    ok: true,
    url: parsed.toString(),
    host: parsed.hostname.toLowerCase(),
    display: displayFeedUrl(parsed),
  };
}

/**
 * The persistable/showable form of a feed URL: origin + pathname, query and
 * fragment ALWAYS dropped. Accepts a string or URL; a malformed string
 * degrades to '' (never throws, never echoes the input).
 */
function displayFeedUrl(urlOrString) {
  let u = urlOrString;
  if (typeof u === 'string') {
    try { u = new URL(u); } catch { return ''; }
  }
  if (!u || typeof u.origin !== 'string') return '';
  return `${u.origin}${u.pathname}`;
}

// Token-shaped patterns scrubbed from EVERY string regardless of what
// secrets we know about (defense-in-depth for URLs we never stored - e.g. a
// hostile feed's enclosure URL embedded in a Node error message):
//  - any query value for a known credential-ish param name,
//  - the Patreon-style `/u/<token>/` path segment.
const GENERIC_QUERY_SECRET = /([?&](?:auth|auth_key|token|key|sig|signature|s|apikey|api_key|access_token)=)[^&\s"']+/gi;
const GENERIC_PATH_TOKEN = /\/u\/[A-Za-z0-9_-]{16,}(\/|$)/g;

/**
 * Scrub secret material out of an arbitrary string (error messages, status
 * text, log lines) before it is persisted or returned. Layered:
 *  1. every full stored secret URL -> its display form,
 *  2. every individual query VALUE of every stored secret URL (len >= 6),
 *     wherever it appears - Node error messages embed full URLs in ways the
 *     whole-URL replace can miss (percent-encoding variants),
 *  3. the generic token-shaped patterns above.
 * Never throws; non-string input returns ''.
 * @param {*} text
 * @param {string[]} [secretUrls] the stored feed URLs (full, with query)
 */
function redactSecretText(text, secretUrls) {
  if (typeof text !== 'string' || text === '') return '';
  let out = text;
  for (const stored of Array.isArray(secretUrls) ? secretUrls : []) {
    if (typeof stored !== 'string' || stored === '') continue;
    let parsed;
    try { parsed = new URL(stored); } catch { continue; }
    const display = displayFeedUrl(parsed);
    out = out.split(stored).join(display || '<redacted-url>');
    for (const [, value] of parsed.searchParams) {
      if (typeof value === 'string' && value.length >= 6) {
        out = out.split(value).join('<redacted>');
        // Percent-encoded variant: an encoded copy of the value can ride an
        // error message even when the raw one does not.
        const enc = encodeURIComponent(value);
        if (enc !== value) out = out.split(enc).join('<redacted>');
      }
    }
  }
  out = out.replace(GENERIC_QUERY_SECRET, '$1<redacted>');
  out = out.replace(GENERIC_PATH_TOKEN, '/u/<redacted>$1');
  return out;
}

module.exports = {
  validateFeedUrl,
  displayFeedUrl,
  redactSecretText,
  MAX_FEED_URL_LENGTH,
};
