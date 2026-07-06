'use strict';

// [UNIT] lib/ytdlp/run.js -- `redactArgs` (AC 31 log-hygiene half). Pure,
// synchronous, no spawn involved. The spawn-boundary tests (AC 28, and the
// "never logged" half of AC 31) live in
// test/integration/ytdlp-spawn-security.test.js, where `execFile` is spied.

const { test } = require('node:test');
const assert = require('node:assert');
const { redactArgs, redactString } = require('../../lib/ytdlp/run');

test('redactArgs replaces the value after --cookies with a redaction marker', () => {
  const args = ['--dump-json', '--cookies', '/secret/path/to/cookies.txt', '--', 'https://www.youtube.com/@x'];
  const redacted = redactArgs(args);
  assert.ok(!redacted.includes('/secret/path/to/cookies.txt'), 'the real cookies path must never survive redaction');
  const idx = redacted.indexOf('--cookies');
  assert.ok(idx >= 0);
  assert.equal(redacted[idx + 1], '<redacted>');
});

test('redactArgs leaves an args array with no --cookies flag unchanged', () => {
  const args = ['--dump-json', '--download-archive', '/data/.ytdlp-archive.txt', '--', 'https://www.youtube.com/@x'];
  assert.deepEqual(redactArgs(args), args);
});

test('redactArgs never mutates the original array', () => {
  const args = ['--cookies', '/secret/cookies.txt'];
  const original = [...args];
  redactArgs(args);
  assert.deepEqual(args, original);
});

test('redactArgs handles a --cookies flag with no following value (malformed/truncated array) without throwing', () => {
  const args = ['--dump-json', '--cookies'];
  assert.doesNotThrow(() => redactArgs(args));
  const redacted = redactArgs(args);
  assert.deepEqual(redacted, args);
});

test('redactArgs is a no-op passthrough on non-array input', () => {
  assert.equal(redactArgs(null), null);
  assert.equal(redactArgs(undefined), undefined);
});

test('redactArgs redacts multiple --cookies occurrences if present', () => {
  const args = ['--cookies', '/a/cookies.txt', '--cookies', '/b/cookies.txt'];
  const redacted = redactArgs(args);
  assert.ok(!redacted.includes('/a/cookies.txt'));
  assert.ok(!redacted.includes('/b/cookies.txt'));
});

// ---- redactString (SF1): strips a cookies path out of an ARBITRARY string,
// e.g. Node's own execFile error.message, which is what actually leaked the
// cookies path in the pre-SF-round code (redactArgs alone never protected
// the raw error.message, only a freshly-built args array). -----------------

test('redactString removes every occurrence of the cookies path from a realistic Node execFile error.message', () => {
  const cookiesPath = '/secret/cookies.txt';
  const message = `Command failed: yt-dlp --dump-json --cookies ${cookiesPath} -- https://www.youtube.com/@x\nsome stderr mentioning ${cookiesPath} again`;
  const redacted = redactString(message, cookiesPath);
  assert.ok(!redacted.includes(cookiesPath), `cookies path survived redaction: ${redacted}`);
  assert.ok(redacted.includes('<redacted>'));
});

test('redactString also redacts a "--cookies=<path>" equals-form rendering of the same path', () => {
  const cookiesPath = '/secret/cookies.txt';
  const message = `Command failed: yt-dlp --cookies=${cookiesPath} -- https://www.youtube.com/@x`;
  const redacted = redactString(message, cookiesPath);
  assert.ok(!redacted.includes(cookiesPath));
});

test('redactString returns the string unchanged when cookiesPath is null/empty/undefined', () => {
  const message = 'Command failed: yt-dlp --dump-json -- https://www.youtube.com/@x';
  assert.equal(redactString(message, null), message);
  assert.equal(redactString(message, ''), message);
  assert.equal(redactString(message, undefined), message);
});

test('redactString is a safe passthrough on non-string input', () => {
  assert.equal(redactString(null, '/a/cookies.txt'), null);
  assert.equal(redactString(undefined, '/a/cookies.txt'), undefined);
  assert.equal(redactString('', '/a/cookies.txt'), '');
});

test('redactString never throws regardless of input shape', () => {
  assert.doesNotThrow(() => redactString(42, '/a/cookies.txt'));
  assert.doesNotThrow(() => redactString('text', 42));
});
