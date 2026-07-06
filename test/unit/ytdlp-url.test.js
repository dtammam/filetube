'use strict';

// [UNIT] lib/ytdlp/url.js -- `validateChannelUrl` (AC 29). This is the
// SECURITY-CRITICAL surface for the yt-dlp module: it is the ONE source of
// truth used both at add-time (store.js's validateSubscriptionInput / the
// POST /api/subscriptions route) and again immediately before every spawn
// (args.js's builders). Pure/synchronous -- no server, no fs, no process.

const { test } = require('node:test');
const assert = require('node:assert');
const { validateChannelUrl } = require('../../lib/ytdlp/url');

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

test('rejects a URL containing whitespace anywhere, including embedded newlines', () => {
  assert.equal(validateChannelUrl('https://www.youtube.com/@a b').ok, false);
  assert.equal(validateChannelUrl('https://www.youtube.com/@a\nrm -rf /').ok, false);
  assert.equal(validateChannelUrl('https://www.youtube.com/@a\tb').ok, false);
  assert.equal(validateChannelUrl(' https://www.youtube.com/@a').ok, false);
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
