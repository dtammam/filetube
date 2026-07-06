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

// KNOWN DESIGN-DOC DISCREPANCY (flagged, not silently "fixed" -- see the SDE
// completion report): the exec plan's mandated test #6 reads `ACCEPT:
// "Title\nhttps://www.youtube.com/watch?v=<id>&si=<x>" extracts -> valid
// video`, and its FR-5 design narrative claims "?si=/&feature=/&pp= pass as
// before". That is NOT actually true today, independent of this task's
// whitespace/extraction change: `FORBIDDEN_CHARS` has *always* included the
// bare `&` character (it is explicitly in the file's own documented
// reject-list, `lib/ytdlp/url.js` FORBIDDEN_CHARS comment), so ANY
// `youtube.com/watch?v=...&si=...`-shaped URL -- even a clean, no-whitespace
// one, entirely independent of extraction -- was rejected before this task
// and is STILL rejected after it (verified against the pre-task code). This
// task's brief is explicit that FORBIDDEN_CHARS must NOT be weakened, so
// this test documents the actual (guard-preserving) behavior rather than the
// plan's literal (unattainable-without-weakening-a-guard) wording. A
// `youtu.be/<id>?si=<x>` share link (a single query param, no `&`) DOES pass
// -- see the "ACCEPT" tests above -- which is the realistic form this
// normalization pre-step was built to accept.
test('FR-5 (documented discrepancy): a watch-URL share payload using "&si=" is STILL rejected -- "&" is, and remains, in FORBIDDEN_CHARS regardless of extraction', () => {
  const result = validateChannelUrl('Title\nhttps://www.youtube.com/watch?v=dQw4w9WgXcQ&si=xyz');
  assert.equal(result.ok, false, 'FORBIDDEN_CHARS already rejects a bare (whitespace-free) "&"-joined URL, independent of this task\'s change -- not a regression, but a real limitation to flag for EM/PE');
});

test('FR-5: classifySingleVideo on a share-sheet payload returns kind "video", the correct videoId, and a clean canonical watchUrl (no ?si)', () => {
  const result = classifySingleVideo('Check this out https://youtu.be/dQw4w9WgXcQ?si=xyz123');
  assert.equal(result.ok, true);
  assert.equal(result.kind, 'video');
  assert.equal(result.videoId, 'dQw4w9WgXcQ');
  assert.equal(result.watchUrl, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.ok(!result.watchUrl.includes('si='), 'buildWatchUrl must rebuild a clean canonical URL, dropping ?si=');
});

// See the "documented discrepancy" test above -- a `&`-joined query string
// (as on a shared youtube.com/watch link) is rejected by the pre-existing,
// unweakened FORBIDDEN_CHARS guard, so classifySingleVideo (which runs
// validateChannelUrl first) correctly rejects it too, via classifySingleVideo's
// OWN 'invalid' kind (validateChannelUrl itself failed, before classification
// logic ever inspects the path/host) rather than a video/channel/playlist
// classification.
test('FR-5: classifySingleVideo on a youtube.com/watch share-sheet payload with "&si=" is rejected (kind invalid) -- same pre-existing FORBIDDEN_CHARS limitation as validateChannelUrl', () => {
  const result = classifySingleVideo('Title\nhttps://www.youtube.com/watch?v=dQw4w9WgXcQ&si=xyz123');
  assert.equal(result.ok, false);
  assert.equal(result.kind, 'invalid');
});
