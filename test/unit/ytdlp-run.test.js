'use strict';

// [UNIT] lib/ytdlp/run.js -- `redactArgs` (AC 31 log-hygiene half). Pure,
// synchronous, no spawn involved. The spawn-boundary tests (AC 28, and the
// "never logged" half of AC 31) live in
// test/integration/ytdlp-spawn-security.test.js, where `execFile` is spied.

const { test } = require('node:test');
const assert = require('node:assert');
const { redactArgs } = require('../../lib/ytdlp/run');

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
