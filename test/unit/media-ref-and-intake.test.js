'use strict';

// [UNIT] v1.41.13 (universal one-offs) P1 -- the two pure foundations:
//   - extractMediaRef: source-aware filename-bracket parser (legacy YouTube
//     11-char shape stays DISJOINT from the new [ExtractorKey=id] shape).
//   - isPlausibleMediaUrl + isPrivateOrLocalHost: the loose one-off intake
//     gate and its LOAD-BEARING SSRF host guard (design C2 -- the only
//     synchronous SSRF defense, so the literal-address matrix must be
//     exhaustive).
// The hostile-id corpus (design task-0, from yt-dlp's own tests) and the
// alternate-IP-encoding matrix are first-class here, not afterthoughts.

const { test } = require('node:test');
const assert = require('node:assert');
const {
  extractMediaRef,
  isPlausibleMediaUrl,
  isPrivateOrLocalHost,
  isSafeVideoId,
} = require('../../lib/ytdlp/url.js');

// ---- extractMediaRef --------------------------------------------------------

test('extractMediaRef: legacy YouTube 11-char bracket -> {source: youtube}', () => {
  assert.deepStrictEqual(extractMediaRef('Some Title [dQw4w9WgXcQ]'), { source: 'youtube', id: 'dQw4w9WgXcQ' });
  assert.deepStrictEqual(extractMediaRef('clip_[lUirOY2Xf_4]'), { source: 'youtube', id: 'lUirOY2Xf_4' }, 'the _[ separator also matches');
});

test('extractMediaRef: universal [ExtractorKey=id] bracket -> {source, id}', () => {
  assert.deepStrictEqual(extractMediaRef('Talk [Vimeo=76979871]'), { source: 'Vimeo', id: '76979871' });
  assert.deepStrictEqual(extractMediaRef('A Reel [FacebookReel=897928030021587]'), { source: 'FacebookReel', id: '897928030021587' });
});

test('extractMediaRef: hostile SANITIZED ids in the bracket parse (design task-0 corpus)', () => {
  // These are the ON-DISK (sanitized) forms -- yt-dlp already folded / ? : etc.
  // per-OS; the bracket id is matched permissively (no [ ] /, <=128).
  assert.deepStrictEqual(extractMediaRef('x [Soundcloud=id=6]'), { source: 'Soundcloud', id: 'id=6' }, 'an id containing = still parses (only the FIRST = splits key from id)');
  assert.deepStrictEqual(extractMediaRef('x [Foo=MTQ2NjMxOQ==]'), { source: 'Foo', id: 'MTQ2NjMxOQ==' }, 'base64-ish id with trailing =');
  assert.deepStrictEqual(extractMediaRef('song [Bandcamp=kichiku_ mad]'), { source: 'Bandcamp', id: 'kichiku_ mad' }, 'a space in the sanitized id');
});

test('extractMediaRef: the two shapes are DISJOINT -- a legacy id never has =, a universal key is required', () => {
  // An 11-char legacy id can never contain '=', so it can't be read as universal.
  assert.deepStrictEqual(extractMediaRef('v [AAAAAAAAAAA]'), { source: 'youtube', id: 'AAAAAAAAAAA' });
  // A 12-char no-= bracket is neither shape.
  assert.strictEqual(extractMediaRef('v [AAAAAAAAAAAA]'), null, '12 chars, no =, is not a legacy id nor a universal ref');
});

test('extractMediaRef: refuses bad shapes -- no bracket, plugin + key, oversize id, nested brackets, bad input', () => {
  assert.strictEqual(extractMediaRef('no bracket here.mp4stem'), null);
  assert.strictEqual(extractMediaRef('x [Some+plugin=abc]'), null, 'a + in the key (plugin suffix) is metadata-only, no bracket match');
  assert.strictEqual(extractMediaRef('x [Vimeo=' + 'a'.repeat(129) + ']'), null, 'id over 128 chars refused');
  assert.strictEqual(extractMediaRef('x [Vimeo=a/b]'), null, 'a slash in the bracket id refused (impossible on disk anyway)');
  assert.strictEqual(extractMediaRef(''), null);
  assert.strictEqual(extractMediaRef(null), null);
  assert.strictEqual(extractMediaRef(undefined), null);
});

test('extractMediaRef: legacy branch stays byte-parity with isSafeVideoId shape', () => {
  const ref = extractMediaRef('title [N5OU1gTCc5M]');
  assert.ok(ref && ref.source === 'youtube');
  assert.ok(isSafeVideoId(ref.id), 'a legacy-parsed id is always a safe video id');
});

// ---- isPrivateOrLocalHost (the SSRF literal matrix) -------------------------

test('isPrivateOrLocalHost: every literal loopback/private/link-local form is caught', () => {
  const priv = [
    '127.0.0.1', '127.1', '127.0.0.1.', // dotted + short
    '2130706433',            // decimal 127.0.0.1
    '0177.0.0.1',            // octal first octet
    '0x7f.0.0.1',            // hex first octet
    '0x7f000001',            // single hex
    '10.0.0.5', '10.255.255.255',
    '172.16.0.1', '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',       // cloud metadata
    '0.0.0.0', '0.0.0.1',
    '100.64.0.1',            // CGNAT
    'localhost', 'foo.localhost',
    '[::1]', '[::]', '[0:0:0:0:0:0:0:1]',
    '[fe80::1]', '[fe80::1%eth0]', '[febf::1]',
    '[fc00::1]', '[fd12:3456::1]',
    '[::ffff:127.0.0.1]', '[::ffff:169.254.169.254]',
    '',                      // no host -> reject
  ];
  for (const h of priv) assert.strictEqual(isPrivateOrLocalHost(h), true, `${h} must be treated as private/local`);
});

test('isPrivateOrLocalHost: public hosts and public IPs pass (DNS names deferred to the D6 resolver)', () => {
  const pub = ['youtube.com', 'vimeo.com', 'www.facebook.com', '8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '11.0.0.1', '[2001:4860:4860::8888]'];
  for (const h of pub) assert.strictEqual(isPrivateOrLocalHost(h), false, `${h} must pass the literal guard`);
});

test('isPrivateOrLocalHost: malformed octet values never mis-classify as public', () => {
  assert.strictEqual(isPrivateOrLocalHost('999.0.0.1'), false, 'not a valid v4 -> treated as a DNS name (guard passes; D6 resolves)');
  assert.strictEqual(isPrivateOrLocalHost('256.256.256.256'), false, 'out-of-range octets are not a v4 literal');
});

// ---- isPlausibleMediaUrl ----------------------------------------------------

test('isPlausibleMediaUrl: accepts ordinary non-YouTube media URLs', () => {
  for (const u of [
    'https://vimeo.com/76979871',
    'https://www.facebook.com/reel/897928030021587/',
    'https://soundcloud.com/artist/track',
    'http://example.com/watch?v=x',
  ]) {
    const r = isPlausibleMediaUrl(u);
    assert.strictEqual(r.ok, true, `${u} should pass: ${r.error || ''}`);
  }
});

test('isPlausibleMediaUrl: rejects the whole hostile catalogue', () => {
  const bad = {
    'ftp://example.com/x': /http/,
    'file:///etc/passwd': /http/,
    'javascript:alert(1)': /http|media URL|forbidden/,
    'https://user:pass@vimeo.com/1': /credentials/,
    'http://127.0.0.1/admin': /not allowed/,
    'http://169.254.169.254/latest/meta-data/': /not allowed/,
    'http://localhost:8080/': /not allowed/,
    'http://[::1]/': /not allowed/,
    'http://2130706433/': /not allowed/,
    '-oProxy=http://evil': /start with|forbidden/,
    'https://example.com/a b': /forbidden characters/,
    '': /required/,
    'not a url at all': /media URL|forbidden/,
  };
  for (const [u, re] of Object.entries(bad)) {
    const r = isPlausibleMediaUrl(u);
    assert.strictEqual(r.ok, false, `${u} must be rejected`);
    assert.match(r.error, re, `${u} error "${r.error}" should match ${re}`);
  }
});

test('isPlausibleMediaUrl: no user-visible message leaks an internal parameter name', () => {
  // The screenshot bug: "channelUrl host is not an allowed YouTube host".
  for (const u of ['http://127.0.0.1/x', 'ftp://x/y', 'https://user:p@vimeo.com/1', 'https://a.com/x y']) {
    const r = isPlausibleMediaUrl(u);
    assert.ok(!/channelUrl|videoId|isSafe/.test(r.error), `error must not leak internals: "${r.error}"`);
  }
});
