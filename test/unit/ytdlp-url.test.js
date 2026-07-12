'use strict';

// [UNIT] lib/ytdlp/url.js -- `validateChannelUrl` (AC 29). This is the
// SECURITY-CRITICAL surface for the yt-dlp module: it is the ONE source of
// truth used both at add-time (store.js's validateSubscriptionInput / the
// POST /api/subscriptions route) and again immediately before every spawn
// (args.js's builders). Pure/synchronous -- no server, no fs, no process.

const { test } = require('node:test');
const assert = require('node:assert');
const { validateChannelUrl, isSafeVideoId, buildWatchUrl, classifySingleVideo } = require('../../lib/ytdlp/url');

// ---- accepts a representative set of real YouTube URL shapes --------------

test('accepts an @handle channel URL', () => {
  const result = validateChannelUrl('https://www.youtube.com/@somechannel');
  assert.equal(result.ok, true);
  assert.equal(result.url, 'https://www.youtube.com/@somechannel');
});

test('accepts a /channel/UC... URL', () => {
  const result = validateChannelUrl('https://youtube.com/channel/UC1234567890abcdef');
  assert.equal(result.ok, true);
});

test('accepts a /c/<name> URL', () => {
  assert.equal(validateChannelUrl('https://www.youtube.com/c/SomeChannel').ok, true);
});

test('accepts a /user/<name> URL', () => {
  assert.equal(validateChannelUrl('https://www.youtube.com/user/SomeUser').ok, true);
});

test('accepts a /playlist?list=... URL', () => {
  assert.equal(validateChannelUrl('https://www.youtube.com/playlist?list=PLabc123XYZ').ok, true);
});

test('accepts a /watch?v=... URL', () => {
  assert.equal(validateChannelUrl('https://m.youtube.com/watch?v=dQw4w9WgXcQ').ok, true);
});

test('accepts a youtu.be/<id> short link', () => {
  const result = validateChannelUrl('https://youtu.be/dQw4w9WgXcQ');
  assert.equal(result.ok, true);
});

test('accepts music.youtube.com', () => {
  assert.equal(validateChannelUrl('https://music.youtube.com/channel/UC1234567890abcdef').ok, true);
});

test('normalizes the hostname to lowercase', () => {
  const result = validateChannelUrl('https://WWW.YOUTUBE.COM/@Mixed');
  assert.equal(result.ok, true);
  assert.equal(result.url, 'https://www.youtube.com/@Mixed');
});

// ---- rejects non-YouTube hosts (allowlist, not a suffix check) ------------

test('rejects a non-YouTube host', () => {
  assert.equal(validateChannelUrl('https://evil.com/@channel').ok, false);
});

test('rejects a lookalike subdomain crafted to pass a naive suffix check', () => {
  // A naive `.endsWith('youtube.com')` or `.includes('youtube.com')` check
  // would wrongly accept this -- the allowlist must reject it.
  assert.equal(validateChannelUrl('https://youtube.com.evil.com/@channel').ok, false);
});

test('rejects an arbitrary unlisted subdomain of youtube.com', () => {
  assert.equal(validateChannelUrl('https://gaming.youtube.com/@channel').ok, false);
});

// ---- rejects non-http(s) schemes -------------------------------------------

test('rejects a javascript: scheme', () => {
  assert.equal(validateChannelUrl('javascript:alert(1)').ok, false);
});

test('rejects a file: scheme', () => {
  assert.equal(validateChannelUrl('file:///etc/passwd').ok, false);
});

test('rejects an ftp: scheme', () => {
  assert.equal(validateChannelUrl('ftp://www.youtube.com/@channel').ok, false);
});

// ---- rejects option-injection / shell-metacharacter / whitespace attempts --

test('rejects a URL with a leading "-" (option-injection defense)', () => {
  assert.equal(validateChannelUrl('-–exec=rm -rf /').ok, false);
  assert.equal(validateChannelUrl('--exec').ok, false);
});

test('rejects a URL containing shell metacharacters', () => {
  assert.equal(validateChannelUrl('https://www.youtube.com/@a; rm -rf /').ok, false);
  assert.equal(validateChannelUrl('https://www.youtube.com/@a`whoami`').ok, false);
  assert.equal(validateChannelUrl('https://www.youtube.com/@a$(whoami)').ok, false);
  assert.equal(validateChannelUrl('https://www.youtube.com/@a|cat').ok, false);
  assert.equal(validateChannelUrl('https://www.youtube.com/@a&cat').ok, false);
  assert.equal(validateChannelUrl('https://www.youtube.com/@a<x>').ok, false);
  assert.equal(validateChannelUrl(`https://www.youtube.com/@a'quote"`).ok, false);
});

// NOTE (FR-5, v1.16.0): validateChannelUrl now trims surrounding whitespace
// and, when internal whitespace remains, extracts the first
// `https?://\S+` run as the candidate BEFORE the checks below run -- this is
// what lets the real-world YouTube share-sheet paste
// ("Title\nhttps://youtu.be/<id>?si=<token>") validate. A clean URL followed
// or preceded by other whitespace-separated text is therefore now ACCEPTED
// (the extracted candidate itself is clean); see the FR-5 acceptance/
// security-regression tests further down for the exact accept/reject matrix.
// A metachar directly ATTACHED to the URL (no whitespace between them) is
// still rejected because it becomes PART of the extracted candidate and
// FORBIDDEN_CHARS still runs on it, unchanged -- see "rejects a URL
// containing shell metacharacters" above.
test('whitespace-padded/prose-wrapped input with a clean embedded URL now extracts and validates (FR-5)', () => {
  assert.equal(validateChannelUrl('https://www.youtube.com/@a b').ok, true);
  assert.equal(validateChannelUrl('https://www.youtube.com/@a\tb').ok, true);
  assert.equal(validateChannelUrl(' https://www.youtube.com/@a').ok, true);
});

test('a metachar attached directly to an otherwise-whitespace-wrapped URL is still rejected (extraction cannot drop an attached metachar)', () => {
  // The metachar/text after the URL is on the SAME whitespace-delimited
  // token as the URL itself (no space between "/@a" and ";rm"), so it is
  // included in the extracted candidate and FORBIDDEN_CHARS still rejects it.
  const result = validateChannelUrl('https://www.youtube.com/@a;rm -rf /');
  assert.equal(result.ok, false);
});

test('whitespace with no extractable http(s) substring is still rejected', () => {
  assert.equal(validateChannelUrl('just some prose with no url').ok, false);
  assert.equal(validateChannelUrl('   ').ok, false);
});

test('rejects a URL containing raw control characters', () => {
  assert.equal(validateChannelUrl('https://www.youtube.com/@a\x01b').ok, false);
});

// ---- rejects empty/non-string/bare input -----------------------------------

test('rejects empty and non-string input', () => {
  assert.equal(validateChannelUrl('').ok, false);
  assert.equal(validateChannelUrl('   ').ok, false);
  assert.equal(validateChannelUrl(undefined).ok, false);
  assert.equal(validateChannelUrl(null).ok, false);
  assert.equal(validateChannelUrl(42).ok, false);
  assert.equal(validateChannelUrl({}).ok, false);
});

test('rejects a bare host with no plausible channel/video/playlist path', () => {
  assert.equal(validateChannelUrl('https://www.youtube.com').ok, false);
  assert.equal(validateChannelUrl('https://www.youtube.com/').ok, false);
  assert.equal(validateChannelUrl('https://www.youtube.com/some/random/path').ok, false);
});

test('rejects an oversized URL', () => {
  const huge = 'https://www.youtube.com/@' + 'a'.repeat(3000);
  assert.equal(validateChannelUrl(huge).ok, false);
});

test('never throws regardless of input shape', () => {
  const inputs = ['', null, undefined, 42, {}, [], 'https://www.youtube.com/@a; rm -rf /', '-x'];
  for (const input of inputs) {
    assert.doesNotThrow(() => validateChannelUrl(input));
  }
});

// ---- SF5: percent-DECODED ?v=/?list= id params are constrained to a safe --
// ---- charset -- the raw-metachar check above runs PRE-decode, so a value --
// ---- like `%3B%20rm%20-rf%20%2F` (decodes to `; rm -rf /`) carries no raw --
// ---- metacharacter and must be caught here instead. ------------------------

test('rejects a ?v= value whose percent-DECODED form contains shell metacharacters/whitespace', () => {
  const result = validateChannelUrl('https://www.youtube.com/watch?v=%3B%20rm%20-rf%20%2F');
  assert.equal(result.ok, false);
});

test('rejects a ?list= value whose percent-DECODED form contains shell metacharacters/whitespace', () => {
  const result = validateChannelUrl('https://www.youtube.com/playlist?list=%3B%20rm%20-rf%20%2F');
  assert.equal(result.ok, false);
});

test('accepts a normal, already-safe ?v= video id', () => {
  const result = validateChannelUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(result.ok, true);
});

test('accepts a normal, already-safe ?list= playlist id', () => {
  const result = validateChannelUrl('https://www.youtube.com/playlist?list=PLabc123XYZ_-9');
  assert.equal(result.ok, true);
});

test('rejects a ?v= value that decodes to something over the bounded id length', () => {
  const huge = 'a'.repeat(200);
  const result = validateChannelUrl(`https://www.youtube.com/watch?v=${huge}`);
  assert.equal(result.ok, false);
});

// ---- SF6: embedded userinfo (user:pass@host) is rejected -------------------

test('rejects a URL with embedded userinfo (user:pass@host)', () => {
  const result = validateChannelUrl('https://user:pass@www.youtube.com/@x');
  assert.equal(result.ok, false);
});

test('rejects a URL with a username but no password', () => {
  const result = validateChannelUrl('https://user@www.youtube.com/@x');
  assert.equal(result.ok, false);
});

test('a normal URL with no userinfo is still accepted', () => {
  const result = validateChannelUrl('https://www.youtube.com/@x');
  assert.equal(result.ok, true);
});

// ---- C1: isSafeVideoId / buildWatchUrl (per-survivor download-scoping) ----
//
// These reuse the SAME `ID_PARAM_PATTERN`/`MAX_ID_PARAM_LENGTH` predicate
// already exercised above via the `?v=`/`?list=` SF5 tests -- single-sourced,
// not a second regex.

test('isSafeVideoId: accepts a valid id (alphanumeric plus - and _)', () => {
  assert.equal(isSafeVideoId('dQw4w9WgXcQ'), true);
  assert.equal(isSafeVideoId('abc-DEF_123'), true);
});

test('isSafeVideoId: rejects an id containing a path-traversal sequence', () => {
  assert.equal(isSafeVideoId('../etc/passwd'), false);
  assert.equal(isSafeVideoId('..'), false);
});

test('isSafeVideoId: a "-"-leading id is charset-valid (option-injection is defended elsewhere: it is always embedded after "watch?v=" in a URL that itself never starts with "-")', () => {
  // `isSafeVideoId` is the SAME charset/length predicate already used for
  // `?v=`/`?list=` query params (`isSafeIdParam`/`ID_PARAM_PATTERN`), which
  // does not itself anchor against a leading "-" -- unlike `validateChannelUrl`'s
  // own `raw.startsWith('-')` check, which guards the WHOLE argv token. A
  // leading "-" inside an id is harmless here because `buildWatchUrl` always
  // prepends the fixed `https://www.youtube.com/watch?v=` prefix, so the
  // resulting URL argv token can never itself start with "-".
  assert.equal(isSafeVideoId('-exec'), true);
});

test('isSafeVideoId: rejects whitespace and shell metacharacters', () => {
  assert.equal(isSafeVideoId('abc def'), false);
  assert.equal(isSafeVideoId('abc;rm -rf /'), false);
  assert.equal(isSafeVideoId('abc\ndef'), false);
  assert.equal(isSafeVideoId('abc$(whoami)'), false);
});

test('isSafeVideoId: rejects an oversized id (over MAX_ID_PARAM_LENGTH)', () => {
  assert.equal(isSafeVideoId('a'.repeat(65)), false);
  assert.equal(isSafeVideoId('a'.repeat(64)), true);
});

test('isSafeVideoId: rejects empty/non-string input, never throws', () => {
  assert.doesNotThrow(() => isSafeVideoId(''));
  assert.equal(isSafeVideoId(''), false);
  assert.equal(isSafeVideoId(null), false);
  assert.equal(isSafeVideoId(undefined), false);
  assert.equal(isSafeVideoId(42), false);
});

test('buildWatchUrl: builds a canonical watch URL for a safe id', () => {
  assert.equal(buildWatchUrl('dQw4w9WgXcQ'), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
});

test('buildWatchUrl: returns null (never a malformed/partial URL) for an unsafe id', () => {
  assert.equal(buildWatchUrl('../etc/passwd'), null);
  assert.equal(buildWatchUrl('abc def'), null);
  assert.equal(buildWatchUrl(''), null);
  assert.equal(buildWatchUrl(null), null);
  assert.equal(buildWatchUrl(undefined), null);
});

test('buildWatchUrl: the host is always the hardcoded www.youtube.com, never derived from input', () => {
  const result = buildWatchUrl('dQw4w9WgXcQ');
  assert.ok(result.startsWith('https://www.youtube.com/watch?v='));
});

test('buildWatchUrl: a "-"-leading id is embedded safely -- the resulting URL argv token never itself starts with "-"', () => {
  const result = buildWatchUrl('-exec');
  assert.equal(result, 'https://www.youtube.com/watch?v=-exec');
  assert.ok(!result.startsWith('-'), 'the URL token itself must never start with "-", regardless of the id');
});

// ---- FR-A: classifySingleVideo -- one-shot download URL classifier --------
//
// Reuses validateChannelUrl as its FIRST step, so it must reject everything
// validateChannelUrl already rejects (hostile/invalid/non-YouTube/non-http(s))
// -- these tests deliberately re-exercise a representative slice of the
// security surface above through the classifier, not just the "happy path"
// shape checks.

test('classifySingleVideo: accepts a youtu.be/<id> short link -- ok, kind video, correct videoId', () => {
  const result = classifySingleVideo('https://youtu.be/dQw4w9WgXcQ');
  assert.equal(result.ok, true);
  assert.equal(result.kind, 'video');
  assert.equal(result.videoId, 'dQw4w9WgXcQ');
  assert.equal(result.watchUrl, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
});

test('classifySingleVideo: accepts a youtube.com/watch?v=<id> URL (incl. www./m./music.) -- ok, kind video', () => {
  for (const host of ['www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube.com']) {
    const result = classifySingleVideo(`https://${host}/watch?v=dQw4w9WgXcQ`);
    assert.equal(result.ok, true, `expected ${host} watch URL to classify as a single video`);
    assert.equal(result.kind, 'video');
    assert.equal(result.videoId, 'dQw4w9WgXcQ');
    assert.equal(result.watchUrl, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  }
});

test('classifySingleVideo: rejects a channel URL (@handle) -- ok:false, kind channel', () => {
  const result = classifySingleVideo('https://www.youtube.com/@somechannel');
  assert.equal(result.ok, false);
  assert.equal(result.kind, 'channel');
  assert.equal(typeof result.error, 'string');
});

test('classifySingleVideo: rejects a /channel/UC... URL -- ok:false, kind channel', () => {
  const result = classifySingleVideo('https://www.youtube.com/channel/UC1234567890abcdef');
  assert.equal(result.ok, false);
  assert.equal(result.kind, 'channel');
});

test('classifySingleVideo: rejects a /c/<name> and /user/<name> URL -- ok:false, kind channel', () => {
  assert.equal(classifySingleVideo('https://www.youtube.com/c/SomeChannel').kind, 'channel');
  assert.equal(classifySingleVideo('https://www.youtube.com/user/SomeUser').kind, 'channel');
});

test('classifySingleVideo: rejects a /playlist?list=... URL -- ok:false, kind playlist', () => {
  const result = classifySingleVideo('https://www.youtube.com/playlist?list=PLabc123XYZ');
  assert.equal(result.ok, false);
  assert.equal(result.kind, 'playlist');
});

test('classifySingleVideo: rejects a non-YouTube host -- ok:false, kind invalid, never throws', () => {
  const result = classifySingleVideo('https://evil.com/watch?v=dQw4w9WgXcQ');
  assert.equal(result.ok, false);
  assert.equal(result.kind, 'invalid');
});

test('classifySingleVideo: rejects a non-http(s) scheme -- ok:false, kind invalid', () => {
  assert.equal(classifySingleVideo('javascript:alert(1)').ok, false);
  assert.equal(classifySingleVideo('javascript:alert(1)').kind, 'invalid');
  assert.equal(classifySingleVideo('file:///etc/passwd').ok, false);
});

test('classifySingleVideo: rejects a metachar/shell-injection URL -- ok:false, no throw', () => {
  const result = classifySingleVideo('https://www.youtube.com/watch?v=x; rm -rf /');
  assert.equal(result.ok, false);
  assert.equal(result.kind, 'invalid');
});

test('classifySingleVideo: rejects a percent-decoded-hostile ?v= value (SF5) -- ok:false', () => {
  const result = classifySingleVideo('https://www.youtube.com/watch?v=%3B%20rm%20-rf%20%2F');
  assert.equal(result.ok, false);
});

test('classifySingleVideo: rejects empty/non-string/malformed input, never throws', () => {
  for (const input of ['', '   ', undefined, null, 42, {}, [], 'not a url']) {
    assert.doesNotThrow(() => classifySingleVideo(input));
    const result = classifySingleVideo(input);
    assert.equal(result.ok, false);
    assert.equal(result.kind, 'invalid');
  }
});

test('classifySingleVideo: never throws across a representative attack/edge-case sweep', () => {
  const inputs = [
    'https://youtu.be/dQw4w9WgXcQ',
    'https://www.youtube.com/@a; rm -rf /',
    '-–exec=rm -rf /',
    'https://user:pass@www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com',
  ];
  for (const input of inputs) {
    assert.doesNotThrow(() => classifySingleVideo(input));
  }
});

// ---- FR-5 (v1.16.0): share-URL validator robustness -- mandated security- --
// ---- regression + acceptance tests (docs/exec-plans/active/2026-07-06-    --
// ---- v1.16-watch-experience.md, "## Acceptance criteria" > FR-5). The     --
// ---- real-world trigger is a YouTube share-sheet paste, which arrives as  --
// ---- prose with an embedded URL and/or stray surrounding whitespace, e.g. --
// ---- "Title\nhttps://youtu.be/<id>?si=<token>". validateChannelUrl now    --
// ---- trims + (when whitespace remains) extracts the first `https?://\S+` --
// ---- run as the candidate BEFORE the UNCHANGED strict validation runs on  --
// ---- that candidate -- every existing guard must still apply to it.      --

test('FR-5 (a): a hostile embedded URL is STILL rejected -- extraction cannot smuggle a disallowed host past the allowlist', () => {
  const result = validateChannelUrl('click https://evil.com/x');
  assert.equal(result.ok, false, 'the extracted candidate (https://evil.com/x) must still fail the host allowlist');
});

test('FR-5 (b): a bare share-sheet URL with a trailing ?si= param passes -- trims and validates', () => {
  const result = validateChannelUrl(' https://youtu.be/dQw4w9WgXcQ?si=abc123\n');
  assert.equal(result.ok, true);
});

test('FR-5 (c): an extracted candidate carrying a shell metachar is STILL rejected', () => {
  const semicolon = validateChannelUrl('Title\nhttps://youtu.be/dQw4w9WgXcQ;rm');
  assert.equal(semicolon.ok, false, 'a metachar attached to the extracted candidate must still trip FORBIDDEN_CHARS');

  const backtick = validateChannelUrl('Title\nhttps://youtu.be/dQw4w9WgXcQ`whoami`');
  assert.equal(backtick.ok, false);

  const leadingDash = validateChannelUrl('Title\n-–exec=rm -rf /');
  assert.equal(leadingDash.ok, false, 'a leading "-" candidate must still be rejected');

  const userinfo = validateChannelUrl('Title\nhttps://user:pass@www.youtube.com/@x');
  assert.equal(userinfo.ok, false, 'embedded userinfo in the extracted candidate must still be rejected');
});

test('FR-5 (d): a disallowed host is STILL rejected even when embedded in surrounding text', () => {
  const result = validateChannelUrl('Check this out\nhttps://youtube.com.evil.com/@channel');
  assert.equal(result.ok, false);
});

test('FR-5 (e): whitespace with no extractable http(s) substring still yields rejection', () => {
  const result = validateChannelUrl('Title\nnot a url at all');
  assert.equal(result.ok, false);
});

test('FR-5: oversized input is STILL rejected on the RAW length, before any extraction work', () => {
  const huge = 'Title\nhttps://youtu.be/dQw4w9WgXcQ?si=' + 'a'.repeat(3000);
  const result = validateChannelUrl(huge);
  assert.equal(result.ok, false);
});

test('FR-5: a channel/playlist/handle URL on the one-off single-video path is STILL rejected (kind channel/playlist), even wrapped in share-sheet text', () => {
  const channel = classifySingleVideo('Check out this channel\nhttps://www.youtube.com/@somechannel');
  assert.equal(channel.ok, false);
  assert.equal(channel.kind, 'channel');

  const playlist = classifySingleVideo('Check out this playlist\nhttps://www.youtube.com/playlist?list=PLabc123XYZ');
  assert.equal(playlist.ok, false);
  assert.equal(playlist.kind, 'playlist');
});

test('FR-5: ACCEPT -- a trimmed share-sheet URL (surrounding whitespace only) validates as a video', () => {
  const result = validateChannelUrl(' https://youtu.be/dQw4w9WgXcQ?si=xyz\n');
  assert.equal(result.ok, true);
});

// SUPERSEDED by v1.28.0 (iOS Shortcuts robustness): the note above documented
// a real, then-current limitation -- a multi-param `&`-joined share URL was
// rejected outright because FORBIDDEN_CHARS (unweakened, unchanged) rejects
// a bare `&`. v1.28.0 fixes this WITHOUT touching FORBIDDEN_CHARS: the query
// is now rebuilt ALLOWLIST-style (keep only `v`/`list`, drop everything else)
// BEFORE FORBIDDEN_CHARS ever runs, so a legitimate `&`-joined share URL no
// longer carries an `&` into that check at all. See
// `rebuildQueryAllowlist`'s doc comment in lib/ytdlp/url.js.
test('v1.28.0: a watch-URL share payload using "&si=" now ACCEPTS -- the query is rebuilt allowlist-style before FORBIDDEN_CHARS ever sees the "&"', () => {
  const result = validateChannelUrl('Title\nhttps://www.youtube.com/watch?v=dQw4w9WgXcQ&si=xyz');
  assert.equal(result.ok, true);
  assert.equal(result.url, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'the "&si=xyz" param must be dropped, never merely tolerated');
});

test('FR-5: classifySingleVideo on a share-sheet payload returns kind "video", the correct videoId, and a clean canonical watchUrl (no ?si)', () => {
  const result = classifySingleVideo('Check this out https://youtu.be/dQw4w9WgXcQ?si=xyz123');
  assert.equal(result.ok, true);
  assert.equal(result.kind, 'video');
  assert.equal(result.videoId, 'dQw4w9WgXcQ');
  assert.equal(result.watchUrl, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.ok(!result.watchUrl.includes('si='), 'buildWatchUrl must rebuild a clean canonical URL, dropping ?si=');
});

// SUPERSEDED by v1.28.0 -- see the matching validateChannelUrl test above.
// classifySingleVideo runs validateChannelUrl first, so the same "&"-param
// fix applies here too: a `&`-joined watch-URL share payload now classifies
// as a valid single video with a clean canonical watchUrl.
test('v1.28.0: classifySingleVideo on a youtube.com/watch share-sheet payload with "&si=" now classifies as a valid video with a clean canonical watchUrl', () => {
  const result = classifySingleVideo('Title\nhttps://www.youtube.com/watch?v=dQw4w9WgXcQ&si=xyz123');
  assert.equal(result.ok, true);
  assert.equal(result.kind, 'video');
  assert.equal(result.videoId, 'dQw4w9WgXcQ');
  assert.equal(result.watchUrl, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
});

// ---- v1.28.0: iOS Shortcuts / share-sheet robustness -----------------------
//
// FR: POST /api/ytdlp/download must robustly accept what iOS Shortcuts/share
// sheets actually send (quote-wrapped bodies, "&"-joined query strings,
// /shorts/<id> links) WITHOUT weakening the yt-dlp injection guard
// (FORBIDDEN_CHARS stays byte-identical -- see the source-lock test at the
// bottom of this section).

test("Dean's verbatim reported URL passes", () => {
  const result = validateChannelUrl('https://youtu.be/86iSEaS6Mvk?is=gpYMZDxYGIFGBBVP');
  assert.equal(result.ok, true);
  assert.equal(result.url, 'https://youtu.be/86iSEaS6Mvk', 'the unrecognized "is=" query param must be dropped (not a "v"/"list" key)');
});

test('v1.28.0: a fully ASCII-quote-wrapped URL (a Shortcut\'s own literal typed quote characters) validates', () => {
  const result = validateChannelUrl('"https://youtu.be/86iSEaS6Mvk"');
  assert.equal(result.ok, true);
  assert.equal(result.url, 'https://youtu.be/86iSEaS6Mvk');
});

test('v1.28.0: a curly-quote-wrapped URL (rich-text paste) validates', () => {
  const result = validateChannelUrl('“https://youtu.be/86iSEaS6Mvk”');
  assert.equal(result.ok, true);
  assert.equal(result.url, 'https://youtu.be/86iSEaS6Mvk');
});

test('v1.28.0: a parens-wrapped URL validates', () => {
  const result = validateChannelUrl('(https://youtu.be/86iSEaS6Mvk)');
  assert.equal(result.ok, true);
  assert.equal(result.url, 'https://youtu.be/86iSEaS6Mvk');
});

test('v1.28.0: an angle-bracket-wrapped URL validates', () => {
  const result = validateChannelUrl('<https://youtu.be/86iSEaS6Mvk>');
  assert.equal(result.ok, true);
  assert.equal(result.url, 'https://youtu.be/86iSEaS6Mvk');
});

test('v1.28.0: a markdown-link-wrapped URL embedded in prose validates -- the glued trailing ")" tail is stripped', () => {
  const result = validateChannelUrl('Check this out: [Video](https://youtu.be/86iSEaS6Mvk)');
  assert.equal(result.ok, true);
  assert.equal(result.url, 'https://youtu.be/86iSEaS6Mvk');
});

test('v1.28.0: a sentence-ending period glued directly onto a share-sheet URL is stripped', () => {
  const result = validateChannelUrl('Watch this: https://youtu.be/86iSEaS6Mvk.');
  assert.equal(result.ok, true);
  assert.equal(result.url, 'https://youtu.be/86iSEaS6Mvk');
});

// ---- two-reviewer gate follow-up (F6, optional): SPACELESS markdown link ---

test('F6: a SPACELESS markdown link "[title](url)" (no whitespace anywhere) validates -- previously rejected (the inner "(" tripped FORBIDDEN_CHARS with no whitespace to trigger extraction)', () => {
  const result = validateChannelUrl('[Video](https://youtu.be/dQw4w9WgXcQ)');
  assert.equal(result.ok, true);
  assert.equal(result.url, 'https://youtu.be/dQw4w9WgXcQ');
});

test('F6: a spaceless markdown link followed immediately by trailing prose punctuation still validates', () => {
  const result = validateChannelUrl('[Video](https://youtu.be/dQw4w9WgXcQ).');
  assert.equal(result.ok, true);
  assert.equal(result.url, 'https://youtu.be/dQw4w9WgXcQ');
});

test('F6: a spaceless hostile prefix glued before a legitimate URL still extracts-and-accepts, matching the PRE-EXISTING whitespace-triggered precedent (the hostile prefix is discarded, never reaches a spawn either way)', () => {
  const result = validateChannelUrl('$(rm)https://www.youtube.com/@channel');
  assert.equal(result.ok, true);
  assert.equal(result.url, 'https://www.youtube.com/@channel');
});

test('F6: a spaceless string with NO extractable http(s) substring is still rejected, unchanged', () => {
  assert.equal(validateChannelUrl('[novalidurlhere]').ok, false);
});

// ---- &-param canonicalization (exact output asserted) ----------------------

test('v1.28.0: youtu.be/<id>?si=<x>&t=<n> canonicalizes to the bare youtu.be/<id> (exact output)', () => {
  const result = validateChannelUrl('https://youtu.be/dQw4w9WgXcQ?si=abc123&t=1');
  assert.equal(result.ok, true);
  assert.equal(result.url, 'https://youtu.be/dQw4w9WgXcQ');
});

test('v1.28.0: watch?v=<id>&feature=share canonicalizes to watch?v=<id> only (exact output)', () => {
  const result = validateChannelUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&feature=share');
  assert.equal(result.ok, true);
  assert.equal(result.url, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
});

test('v1.28.0: a playlist URL with extra "&"-joined params keeps only "list" (exact output)', () => {
  const result = validateChannelUrl('https://www.youtube.com/playlist?list=PLabc123XYZ&index=5&foo=bar');
  assert.equal(result.ok, true);
  assert.equal(result.url, 'https://www.youtube.com/playlist?list=PLabc123XYZ');
});

// ---- two-reviewer gate follow-up (F4): trailing fragment stripped ----------

test('F4: watch?v=ID#junk canonicalizes cleanly, with no trailing "#" in the accepted output', () => {
  const result = validateChannelUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ#junk');
  assert.equal(result.ok, true);
  assert.equal(result.url, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.ok(!result.url.includes('#'), 'the accepted, persisted URL must never carry a stray "#"');
});

test('F4: a hostile payload glued onto a fragment ("#&$(evil)") is discarded wholesale, not just left inert', () => {
  const result = validateChannelUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ#&$(evil)');
  assert.equal(result.ok, true);
  assert.equal(result.url, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'the fragment (and everything glued to it) must be fully gone, not merely appended harmlessly');
});

test('F4: a fragment on a youtu.be short link is also stripped', () => {
  const result = validateChannelUrl('https://youtu.be/dQw4w9WgXcQ#t=30s');
  assert.equal(result.ok, true);
  assert.equal(result.url, 'https://youtu.be/dQw4w9WgXcQ');
});

// ---- two-reviewer gate follow-up (F5): lock two intentional side effects --

test('F5(a): a channel URL with an extra query param (?sub_confirmation=1) canonicalizes by DROPPING the param -- intentional, locked behavior', () => {
  const result = validateChannelUrl('https://www.youtube.com/@Chan?sub_confirmation=1');
  assert.equal(result.ok, true);
  assert.equal(result.url, 'https://www.youtube.com/@Chan', 'a channel URL never keeps ANY query param -- only /watch (?v=) and /playlist (?list=) keep one');
});

test('F5(b): a second, un-"&"-joined "?" (watch?v=X?evil=1) fails safe -- rejected, never silently truncated to a valid-looking URL', () => {
  const result = validateChannelUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ?evil=1');
  assert.equal(result.ok, false, 'a malformed multi-"?" query must never be coerced into an accepted URL');
});

test('F5(b): the same multi-"?" shape rejects identically through classifySingleVideo (the shared validator, not a forked path)', () => {
  const result = classifySingleVideo('https://www.youtube.com/watch?v=dQw4w9WgXcQ?evil=1');
  assert.equal(result.ok, false);
});

test('F5(b): a hostile fragment on the shared-validator path never survives into the canonicalized output', () => {
  const result = validateChannelUrl('https://www.youtube.com/@chan#$(rm -rf /)');
  assert.equal(result.ok, true);
  assert.equal(result.url, 'https://www.youtube.com/@chan');
  assert.ok(!result.url.includes('$') && !result.url.includes('('), 'the fragment payload must never survive into the accepted, persisted output');
});

// ---- /shorts/, /live/, /embed/ single-video shapes --------------------------

for (const kind of ['shorts', 'live', 'embed']) {
  test(`v1.28.0: classifySingleVideo recognizes /${kind}/<id> as a single video, canonicalized to the ordinary watch URL`, () => {
    const result = classifySingleVideo(`https://www.youtube.com/${kind}/dQw4w9WgXcQ`);
    assert.equal(result.ok, true, `expected /${kind}/<id> to classify as a single video`);
    assert.equal(result.kind, 'video');
    assert.equal(result.videoId, 'dQw4w9WgXcQ');
    assert.equal(result.watchUrl, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  });

  test(`v1.28.0: classifySingleVideo recognizes /${kind}/<id>?si=<x> (with an extraneous query param, dropped) as a single video`, () => {
    const result = classifySingleVideo(`https://www.youtube.com/${kind}/dQw4w9WgXcQ?si=abc123`);
    assert.equal(result.ok, true, `expected /${kind}/<id>?si= to classify as a single video`);
    assert.equal(result.kind, 'video');
    assert.equal(result.videoId, 'dQw4w9WgXcQ');
    assert.equal(result.watchUrl, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  });
}

// ---- two-reviewer gate follow-up (F2): /embed/videoseries is a PLAYLIST ----

test('F2: classifySingleVideo rejects /embed/videoseries?list=... -- it is the canonical WHOLE-PLAYLIST embed, not a single video', () => {
  const result = classifySingleVideo('https://www.youtube.com/embed/videoseries?list=PLabc123XYZ');
  assert.equal(result.ok, false);
  assert.notEqual(result.videoId, 'videoseries', 'must never accept the literal token "videoseries" as a video id');
});

test('F2: classifySingleVideo rejects bare /embed/videoseries (no query) the same way', () => {
  const result = classifySingleVideo('https://www.youtube.com/embed/videoseries');
  assert.equal(result.ok, false);
});

test('F2: an id that merely STARTS WITH "videoseries" (not the exact token) is unaffected -- still classifies as a video', () => {
  const result = classifySingleVideo('https://www.youtube.com/embed/videoseriesX');
  assert.equal(result.ok, true);
  assert.equal(result.videoId, 'videoseriesX');
});

// ---- two-reviewer gate follow-up (F3): shorts/live/embed id length cap -----

test('F3: validateChannelUrl({ allowSingleVideoShapes: true }) rejects a 2000-char /shorts/<id> (oversized, past the shared 64-char id cap)', () => {
  const huge = 'a'.repeat(2000);
  const result = validateChannelUrl(`https://www.youtube.com/shorts/${huge}`, { allowSingleVideoShapes: true });
  assert.equal(result.ok, false);
});

test('F3: classifySingleVideo rejects a 2000-char /shorts/<id> the same way', () => {
  const huge = 'a'.repeat(2000);
  const result = classifySingleVideo(`https://www.youtube.com/shorts/${huge}`);
  assert.equal(result.ok, false);
});

test('F3: validateChannelUrl({ allowSingleVideoShapes: true }) and classifySingleVideo AGREE on a 65-char (one past the 64-char cap) /shorts/<id>', () => {
  const tooLong = 'a'.repeat(65);
  const direct = validateChannelUrl(`https://www.youtube.com/shorts/${tooLong}`, { allowSingleVideoShapes: true });
  const classified = classifySingleVideo(`https://www.youtube.com/shorts/${tooLong}`);
  assert.equal(direct.ok, false);
  assert.equal(classified.ok, false);
});

// ---- two-reviewer gate follow-up (F7): shorts/live/embed gated OFF the -----
// ---- subscription-add path (the DEFAULT, opts-less validateChannelUrl) ----

for (const kind of ['shorts', 'live', 'embed']) {
  test(`F7: bare validateChannelUrl (no opts -- the subscription-add path's own call shape) rejects /${kind}/<id>`, () => {
    const result = validateChannelUrl(`https://www.youtube.com/${kind}/dQw4w9WgXcQ`);
    assert.equal(result.ok, false, `expected the subscription-safe default to reject /${kind}/<id>`);
  });

  test(`F7: validateChannelUrl({ allowSingleVideoShapes: false }) explicitly rejects /${kind}/<id>, same as the default`, () => {
    const result = validateChannelUrl(`https://www.youtube.com/${kind}/dQw4w9WgXcQ`, { allowSingleVideoShapes: false });
    assert.equal(result.ok, false);
  });
}

test('F7: the PRE-EXISTING /watch and youtu.be subscription shapes are UNCHANGED -- still accepted with no opts', () => {
  assert.equal(validateChannelUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ').ok, true);
  assert.equal(validateChannelUrl('https://youtu.be/dQw4w9WgXcQ').ok, true);
});

test('F7: classifySingleVideo (the one-off download path) still accepts /shorts/<id> -- only IT opts in', () => {
  const result = classifySingleVideo('https://www.youtube.com/shorts/dQw4w9WgXcQ');
  assert.equal(result.ok, true);
  assert.equal(result.videoId, 'dQw4w9WgXcQ');
});

// ---- HOSTILE inputs still rejected, even wrapped/query-laden ---------------

test('v1.28.0: an embedded evil.com host is STILL rejected, even quote-wrapped', () => {
  assert.equal(validateChannelUrl('"https://evil.com/@x"').ok, false);
});

test('v1.28.0: a %3B%20-encoded metachar ?v= value is STILL rejected, even quote-wrapped', () => {
  const result = validateChannelUrl('"https://www.youtube.com/watch?v=%3B%20rm%20-rf%20%2F"');
  assert.equal(result.ok, false);
});

test('v1.28.0: a leading "-" flag-injection attempt is STILL rejected, even quote-wrapped', () => {
  assert.equal(validateChannelUrl('"-exec=rm -rf /"').ok, false);
});

test('v1.28.0: an oversized quote-wrapped URL is STILL rejected (the RAW length cap runs before any normalization)', () => {
  const huge = '"https://www.youtube.com/@' + 'a'.repeat(3000) + '"';
  assert.equal(validateChannelUrl(huge).ok, false);
});

test('v1.28.0: "; rm -rf /" glued to a URL (with a space before the payload) is STILL rejected -- the semicolon is never stripped', () => {
  assert.equal(validateChannelUrl('https://www.youtube.com/@a; rm -rf /').ok, false);
  assert.equal(validateChannelUrl('"https://www.youtube.com/@a; rm -rf /"').ok, false);
});

test('v1.28.0: "$(cmd)" command substitution is STILL rejected, even though a lone trailing ")" is normally stripped', () => {
  assert.equal(validateChannelUrl('https://www.youtube.com/@a$(whoami)').ok, false);
  assert.equal(validateChannelUrl('$(whoami)').ok, false);
});

test('v1.28.0: a backtick command-substitution attempt is STILL rejected', () => {
  assert.equal(validateChannelUrl('https://www.youtube.com/@a`whoami`').ok, false);
});

test('v1.28.0: embedded userinfo (user:pass@) is STILL rejected, even quote-wrapped', () => {
  assert.equal(validateChannelUrl('"https://user:pass@www.youtube.com/@x"').ok, false);
});

test('v1.28.0: a javascript: scheme is STILL rejected, even quote-wrapped', () => {
  assert.equal(validateChannelUrl('"javascript:alert(1)"').ok, false);
});

// ---- self-diagnosing rejection message --------------------------------------

test('v1.28.0: the FORBIDDEN_CHARS rejection message names the first offending PRINTABLE character, quoted', () => {
  const result = validateChannelUrl('https://www.youtube.com/@a;rm');
  assert.equal(result.ok, false);
  assert.match(result.error, /disallowed character \(';'\)/);
});

test('v1.28.0: the FORBIDDEN_CHARS rejection message names a control/whitespace character as its Unicode code point', () => {
  const result = validateChannelUrl('https://www.youtube.com/@a\x01b');
  assert.equal(result.ok, false);
  assert.match(result.error, /disallowed character \(U\+0001\)/);
});

test('v1.28.0: the rejection message is a single stable string shape across different offending characters', () => {
  const semicolon = validateChannelUrl('https://www.youtube.com/@a;rm');
  const pipe = validateChannelUrl('https://www.youtube.com/@a|cat');
  assert.match(semicolon.error, /^channelUrl contains a disallowed character \(.+\) -- send the bare video URL without surrounding quotes or extra query parameters$/);
  assert.match(pipe.error, /^channelUrl contains a disallowed character \(.+\) -- send the bare video URL without surrounding quotes or extra query parameters$/);
});

// ---- spawn-guard regression locks -------------------------------------------

test('SOURCE LOCK: FORBIDDEN_CHARS is byte-identical to its pre-v1.28.0 definition', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'lib', 'ytdlp', 'url.js'), 'utf8');
  assert.match(
    source,
    /const FORBIDDEN_CHARS = \/\[\\s\\x00-\\x1f\\x7f;&\|`\$<>'"\(\)\{\}\\\\\]\/;/,
    'FORBIDDEN_CHARS must remain byte-identical -- only what reaches it (candidate normalization) may change',
  );
});

test('SOURCE LOCK: buildWatchUrl remains the only spawn-bound URL constructor a Short/live/embed canonicalizes through', () => {
  assert.equal(classifySingleVideo('https://www.youtube.com/shorts/dQw4w9WgXcQ').watchUrl, buildWatchUrl('dQw4w9WgXcQ'));
});

// ---- v1.36 F1 fix round 2: isChannelRootUrl (the break-early-safety shape check)

const { isChannelRootUrl } = require('../../lib/ytdlp/url');

test('v1.36 isChannelRootUrl: true for exactly the bare channel shapes (@handle, /channel/, /c/, /user/) on allowed hosts', () => {
  assert.equal(isChannelRootUrl('https://www.youtube.com/@somechannel'), true);
  assert.equal(isChannelRootUrl('https://youtube.com/channel/UCabcdefghijklmnopqrstuv'), true);
  assert.equal(isChannelRootUrl('https://www.youtube.com/c/SomeName'), true);
  assert.equal(isChannelRootUrl('https://www.youtube.com/user/SomeUser'), true);
});

test('v1.36 isChannelRootUrl: false for playlist/watch/youtu.be shapes (valid subscriptions, but NOT single-feed-swappable) and for anything invalid', () => {
  assert.equal(isChannelRootUrl('https://www.youtube.com/playlist?list=PLabcdefghijklm'), false, 'a playlist sub must never be treated as a channel root');
  assert.equal(isChannelRootUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), false);
  assert.equal(isChannelRootUrl('https://youtu.be/dQw4w9WgXcQ'), false);
  assert.equal(isChannelRootUrl('https://evil.com/@somechannel'), false, 'host allowlist still binds');
  assert.equal(isChannelRootUrl('not a url'), false);
  assert.equal(isChannelRootUrl(null), false);
  assert.equal(isChannelRootUrl(undefined), false);
});
