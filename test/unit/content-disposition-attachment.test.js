'use strict';

// [UNIT] FR-3 (v1.19.0, download-to-device): `contentDispositionAttachment`
// (server.js) -- the pure, header-injection-SAFE `Content-Disposition:
// attachment` value builder used by GET /video/:id's `?download=1` intent.
// Proves the two forms (ASCII `filename="..."` fallback + RFC 5987
// `filename*=UTF-8''...`) are both safe against a title carrying CR/LF,
// quotes, backslashes, or semicolons -- no header/param injection vector --
// and that non-ASCII titles/empty titles are handled sanely.
const { test } = require('node:test');
const assert = require('node:assert');
const { contentDispositionAttachment } = require('../../server');

test('a normal ASCII title produces both a plain filename and a matching filename* form', () => {
  const header = contentDispositionAttachment('My Vacation Clip', '.mp4');
  assert.equal(header, 'attachment; filename="My Vacation Clip.mp4"; filename*=UTF-8\'\'My%20Vacation%20Clip.mp4');
});

test('a non-ASCII title is stripped in the ASCII fallback but preserved (percent-encoded) in filename*', () => {
  const header = contentDispositionAttachment('Café Résumé 日本語', '.mp3');
  // ASCII fallback: every non-ASCII char replaced with '_', ASCII bytes kept.
  assert.match(header, /filename="Caf. R.sum. ___\.mp3"/);
  const encodedMatch = /filename\*=UTF-8''([^;]+)$/.exec(header);
  assert.ok(encodedMatch, 'filename* form must be present');
  assert.equal(decodeURIComponent(encodedMatch[1]), 'Café Résumé 日本語.mp3');
});

test('a title containing CR/LF cannot inject a second header -- both forms strip/encode it away', () => {
  const evil = 'Evil\r\nSet-Cookie: pwned=1';
  const header = contentDispositionAttachment(evil, '.mp4');
  // The header value itself must not contain a raw CR or LF anywhere -- that
  // is the actual injection vector (a real second header line). The literal
  // text "Set-Cookie" is harmless once it's just inert data inside a single
  // quoted-string/percent-encoded value, which is what both forms below are.
  assert.ok(!header.includes('\r') && !header.includes('\n'), 'no raw CR/LF may appear in the header value -- this is what prevents a real second header line');
  assert.equal(header.split('\n').length, 1, 'the whole header value must stay on a single line');
  assert.match(header, /filename="Evil__Set-Cookie: pwned=1\.mp4"/, 'CR/LF replaced with _, everything else preserved as inert quoted data');
  const encodedMatch = /filename\*=UTF-8''([^;]+)$/.exec(header);
  assert.ok(!encodedMatch[1].includes('\r') && !encodedMatch[1].includes('\n'), 'the filename* form percent-encodes CR/LF (%0D/%0A) rather than leaving them raw');
});

test('a title containing double quotes and backslashes cannot break out of the quoted-string filename', () => {
  const evil = 'Weird "Title"\\Name';
  const header = contentDispositionAttachment(evil, '.mp4');
  const asciiMatch = /filename="([^"]*)"/.exec(header);
  assert.ok(asciiMatch, 'the ASCII filename value must remain a single well-formed quoted-string (no stray unescaped quote breaking it open)');
  assert.ok(!asciiMatch[1].includes('"') && !asciiMatch[1].includes('\\'), 'quotes/backslashes must be stripped, not passed through raw');
});

test('a title containing a semicolon stays confined inside the quoted filename value (no stray Content-Disposition parameter)', () => {
  const evil = 'Part 1; rm -rf /';
  const header = contentDispositionAttachment(evil, '.mp4');
  const asciiMatch = /filename="([^"]*)"/.exec(header);
  assert.ok(asciiMatch, 'must still produce one well-formed quoted filename value');
  assert.equal(asciiMatch[1], 'Part 1; rm -rf /.mp4', 'a semicolon inside a quoted-string is syntactically safe (does not terminate/split the header)');
  // Exactly one filename= parameter and one filename*= parameter -- the
  // semicolon inside the quotes must not have produced a spurious extra
  // Content-Disposition parameter.
  assert.equal((header.match(/filename=/g) || []).length, 1);
  assert.equal((header.match(/filename\*=/g) || []).length, 1);
});

test('an empty/missing title falls back to "download" rather than producing an empty filename', () => {
  assert.match(contentDispositionAttachment('', '.mp4'), /filename="download\.mp4"/);
  assert.match(contentDispositionAttachment(undefined, '.mp4'), /filename="download\.mp4"/);
  assert.match(contentDispositionAttachment(null, ''), /filename="download"/);
});

test('a title containing an apostrophe is percent-encoded (%27) in filename* -- RFC 5987 treats \' as a delimiter, not a bare attr-char', () => {
  const header = contentDispositionAttachment("Dean's Vacation", '.mp4');
  const encodedMatch = /filename\*=UTF-8''([^;]+)$/.exec(header);
  assert.ok(encodedMatch, 'filename* form must be present');
  assert.ok(!encodedMatch[1].includes("'"), 'a raw, unencoded \' must never appear in the filename* ext-value');
  assert.match(encodedMatch[1], /Dean%27s/, "the apostrophe must be percent-encoded as %27");
  assert.equal(decodeURIComponent(encodedMatch[1]), "Dean's Vacation.mp4", 'decoding still round-trips to the original title');
  // The ASCII fallback form is unaffected by this fix (a bare quoted-string
  // apostrophe is not a delimiter there).
  assert.match(header, /filename="Dean's Vacation\.mp4"/);
});

test('a non-alphanumeric extension is sanitized so it cannot smuggle characters into the header value', () => {
  const header = contentDispositionAttachment('Clip', '.mp4"; evil=1');
  assert.match(header, /filename="Clip\.mp4evil1"/);
  assert.ok(!header.includes('"; evil='), 'a crafted extension must not be able to break out of the quoted-string or add a parameter');
});
