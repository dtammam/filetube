'use strict';

// [UNIT] v1.110 (Dean): withShareStartTime -- append a YouTube start-time to an
// already-server-resolved share URL. The URL identity is NEVER assembled
// client-side (v1.52 lesson); this only sets the `t=` param via the platform URL
// parser, and must fall back to the plain URL rather than ever emit a broken one.
const { test } = require('node:test');
const assert = require('node:assert');
const { withShareStartTime } = require('../../public/js/common.js');

test('withShareStartTime: sets t=<whole seconds> on a watch?v= URL, preserving other params', () => {
  assert.strictEqual(
    withShareStartTime('https://www.youtube.com/watch?v=ABC123', 90),
    'https://www.youtube.com/watch?v=ABC123&t=90'
  );
  // floors fractional seconds
  assert.strictEqual(
    withShareStartTime('https://www.youtube.com/watch?v=ABC123', 90.9),
    'https://www.youtube.com/watch?v=ABC123&t=90'
  );
  // preserves an existing param (e.g. a playlist)
  assert.strictEqual(
    withShareStartTime('https://www.youtube.com/watch?v=ABC123&list=PL1', 200),
    'https://www.youtube.com/watch?v=ABC123&list=PL1&t=200'
  );
});

test('withShareStartTime: works on a youtu.be short link', () => {
  assert.strictEqual(withShareStartTime('https://youtu.be/ABC123', 42), 'https://youtu.be/ABC123?t=42');
});

test('withShareStartTime: overwrites a pre-existing t param', () => {
  assert.strictEqual(
    withShareStartTime('https://www.youtube.com/watch?v=ABC123&t=5', 300),
    'https://www.youtube.com/watch?v=ABC123&t=300'
  );
});

test('withShareStartTime: returns the URL UNCHANGED for a non-positive / non-finite time (plain link)', () => {
  const url = 'https://youtu.be/ABC123';
  assert.strictEqual(withShareStartTime(url, 0), url, 'zero -> plain link');
  assert.strictEqual(withShareStartTime(url, -5), url, 'negative -> plain link');
  assert.strictEqual(withShareStartTime(url, NaN), url, 'NaN -> plain link');
  assert.strictEqual(withShareStartTime(url, Infinity), url, 'Infinity -> plain link');
  assert.strictEqual(withShareStartTime(url, '90'), url, 'non-number -> plain link');
});

test('withShareStartTime: returns the input UNCHANGED for a non-string or unparseable url (never a broken link)', () => {
  assert.strictEqual(withShareStartTime('', 90), '', 'empty string');
  assert.strictEqual(withShareStartTime(null, 90), null, 'null');
  assert.strictEqual(withShareStartTime(undefined, 90), undefined, 'undefined');
  assert.strictEqual(withShareStartTime('not a url', 90), 'not a url', 'unparseable -> unchanged, not thrown');
});
