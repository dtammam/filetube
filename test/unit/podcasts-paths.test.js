'use strict';

// [UNIT] v1.69.0 (podcasts): show-dir/episode-filename resolution
// (lib/podcasts/paths.js). Exec plan attack surface 3: every input here is
// FEED-CONTROLLED. The confinement tests are structural (resolved-path
// checked), the bracket tests bind compatibility with the existing
// extractMediaRef universal-bracket parser byte-for-byte.

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const paths = require('../../lib/podcasts/paths');
const { extractMediaRef } = require('../../lib/ytdlp/url');

test('sanitizeShowDirName: traversal, separators, control bytes, unicode all neutralized', () => {
  assert.strictEqual(paths.sanitizeShowDirName('../../etc/passwd'), 'etc-passwd');
  assert.strictEqual(paths.sanitizeShowDirName('a/b\\c'), 'a-b-c');
  assert.strictEqual(paths.sanitizeShowDirName('Show\x00\x1fName'), 'ShowName');
  assert.strictEqual(paths.sanitizeShowDirName('Café “Live”'), 'Caf- -Live-');
  assert.strictEqual(paths.sanitizeShowDirName(''), 'podcast');
  assert.strictEqual(paths.sanitizeShowDirName(null), 'podcast');
  assert.strictEqual(paths.sanitizeShowDirName('...'), 'podcast', 'an all-dots name fully degrades to the fallback - no traversal remains');
  assert.ok(paths.sanitizeShowDirName('x'.repeat(500)).length <= paths.MAX_SHOW_DIR_NAME_LENGTH);
});

test('resolveShowDir: confined under the root; hostile names cannot escape', () => {
  const root = '/data/podcasts';
  assert.strictEqual(paths.resolveShowDir(root, 'The Tim Dillon Show Bonus Feed'), path.join(root, 'The Tim Dillon Show Bonus Feed'));
  const hostile = paths.resolveShowDir(root, '../../../../etc');
  assert.ok(hostile.startsWith(root + path.sep), `resolved inside root: ${hostile}`);
});

test('guidKey: safe guids pass through; URL guids hash to md5 hex', () => {
  assert.strictEqual(paths.guidKey('165557309'), '165557309', 'Patreon numeric guid passes through');
  const urlGuid = paths.guidKey('https://example.com/ep/1?x=y');
  assert.match(urlGuid, /^[0-9a-f]{32}$/, 'URL guid becomes md5 hex');
  assert.match(paths.guidKey(''), /^[0-9a-f]{32}$/, 'empty guid still yields a stable key');
  assert.match(paths.guidKey('has spaces'), /^[0-9a-f]{32}$/);
});

test('episodeFileName: parses back through the existing universal bracket parser', () => {
  const cases = [
    ['Bonus #342 - Human Shields In The Hamptons (ft. Ray Kump)', '165557309', 'https://x.example/e/165557309.mp3'],
    ['Ep with a / slash and .. dots', 'https://example.com/guid-url', 'https://x.example/audio.m4a'],
    ['', '', 'https://x.example/noext'],
  ];
  for (const [title, guid, enclosure] of cases) {
    const name = paths.episodeFileName(title, guid, enclosure);
    const base = name.replace(/\.[a-z0-9]+$/, '');
    const ref = extractMediaRef(base);
    assert.ok(ref, `bracket parses: ${name}`);
    assert.strictEqual(ref.source, 'rss', `source is rss: ${name}`);
    assert.strictEqual(ref.id, paths.guidKey(guid), `id round-trips: ${name}`);
  }
});

test('episodeFileName: title capped at 100 chars, extension from allowlist only', () => {
  const long = paths.episodeFileName('t'.repeat(400), 'g1', 'https://x.example/e.mp3');
  assert.ok(long.length < 200, `bounded: ${long.length}`);
  assert.ok(long.endsWith('.mp3'));
  assert.strictEqual(paths.enclosureExtension('https://x.example/e.m4a'), '.m4a');
  assert.strictEqual(paths.enclosureExtension('https://x.example/e.exe'), '.mp3', 'unknown extension falls back to .mp3');
  assert.strictEqual(paths.enclosureExtension('https://x.example/e.mp3?sig=..%2F..%2Fx'), '.mp3', 'query cannot influence the extension');
  assert.strictEqual(paths.enclosureExtension('not a url'), '.mp3');
});

test('partFileName: dot-prefixed with the .ptpart suffix, distinct from the final name', () => {
  const final = 'Ep [rss=1].mp3';
  const part = paths.partFileName(final);
  assert.strictEqual(part, '.Ep [rss=1].mp3.ptpart');
  assert.notStrictEqual(part, final);
  assert.ok(part.endsWith(paths.PART_SUFFIX));
});
