'use strict';

// [UNIT] v1.69.0 (podcasts): feed-URL validation + secret redaction
// (lib/podcasts/feedUrl.js). The redaction tests are the load-bearing ones:
// the exec plan's attack surface 1 is token leakage through error/status
// strings, and these bind the exact shapes observed on Dean's real feed
// (query `?auth=<token>` + path `/u/<token>/`).

const { test } = require('node:test');
const assert = require('node:assert');

const { validateFeedUrl, displayFeedUrl, redactSecretText, MAX_FEED_URL_LENGTH } = require('../../lib/podcasts/feedUrl');

test('validateFeedUrl: accepts a real tokened Patreon-shaped feed URL', () => {
  const r = validateFeedUrl('https://www.patreon.com/rss/someshow?auth=abcDEF123456789&show=12345');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.host, 'www.patreon.com');
  assert.strictEqual(r.display, 'https://www.patreon.com/rss/someshow', 'display drops the query entirely');
});

test('validateFeedUrl: accepts a plain free http feed', () => {
  const r = validateFeedUrl('http://feeds.example.com/podcast.xml');
  assert.strictEqual(r.ok, true);
});

test('validateFeedUrl: rejections are neutral and never echo the input', () => {
  const cases = [
    [undefined, /required/i],
    ['', /required/i],
    ['a'.repeat(MAX_FEED_URL_LENGTH + 1), /too long/i],
    ['https://example.com/feed with space', /forbidden characters/i],
    ['https://example.com/feed\nx', /forbidden characters/i],
    ['not-a-url', /not a valid URL/i],
    ['ftp://example.com/feed', /http/i],
    ['file:///etc/passwd', /http/i],
    ['https://user:pass@example.com/feed', /credentials/i],
    ['https://localhost/feed', /not allowed/i],
    ['https://127.0.0.1/feed', /not allowed/i],
    ['https://192.168.1.10/feed', /not allowed/i],
    ['https://[::1]/feed', /not allowed/i],
    ['https://0x7f000001/feed', /not allowed/i], // hex-encoded 127.0.0.1
  ];
  for (const [input, want] of cases) {
    const r = validateFeedUrl(input);
    assert.strictEqual(r.ok, false, `should reject: ${String(input).slice(0, 40)}`);
    assert.match(r.error, want);
    if (typeof input === 'string' && input.length > 8) {
      assert.ok(!r.error.includes(input), 'error must never echo the (possibly secret) input');
    }
  }
});

test('displayFeedUrl: origin + pathname only; malformed degrades to empty string', () => {
  assert.strictEqual(displayFeedUrl('https://h.example/p/q?auth=SECRET#frag'), 'https://h.example/p/q');
  assert.strictEqual(displayFeedUrl('garbage'), '');
  assert.strictEqual(displayFeedUrl(null), '');
});

test('redactSecretText: scrubs stored feed URLs, their query values, and encoded variants', () => {
  const stored = 'https://www.patreon.com/rss/show?auth=SeCrEtT0ken123&show=98765';
  const err = `request to ${stored} failed, auth=SeCrEtT0ken123 rejected (also SeCrEtT0ken123 and ${encodeURIComponent('SeCrEtT0ken123')})`;
  const out = redactSecretText(err, [stored]);
  assert.ok(!out.includes('SeCrEtT0ken123'), `token must not survive: ${out}`);
  assert.ok(out.includes('https://www.patreon.com/rss/show'), 'display form is kept for diagnosability');
});

test('redactSecretText: generic patterns scrub tokens we never stored (hostile enclosure URLs)', () => {
  const msg = 'GET https://www.patreon.com/api/rss/u/AbCdEfGhIjKlMnOpQrStUvWx/e/1.mp3?sig=xyz failed; retry ?auth=NeverStoredTok9 later';
  const out = redactSecretText(msg, []);
  assert.ok(!out.includes('AbCdEfGhIjKlMnOpQrStUvWx'), `path token must not survive: ${out}`);
  assert.ok(!out.includes('NeverStoredTok9'), `query token must not survive: ${out}`);
  assert.ok(out.includes('/u/<redacted>/'), 'path token replaced with a marker');
});

test('redactSecretText: never throws on junk input', () => {
  assert.strictEqual(redactSecretText(null, ['x']), '');
  assert.strictEqual(redactSecretText(undefined), '');
  assert.strictEqual(redactSecretText('plain text', ['not a url', '']), 'plain text');
});
