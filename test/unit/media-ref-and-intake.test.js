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
    'javascript:alert(1)': /http|media URL|characters/,
    'https://user:pass@vimeo.com/1': /credentials/,
    'http://127.0.0.1/admin': /not allowed/,
    'http://169.254.169.254/latest/meta-data/': /not allowed/,
    'http://localhost:8080/': /not allowed/,
    'http://[::1]/': /not allowed/,
    'http://2130706433/': /not allowed/,
    '-notaurl': /not allowed|media URL/,
    '': /required/,
    'not a url at all': /media URL|characters/,
  };
  for (const [u, re] of Object.entries(bad)) {
    const r = isPlausibleMediaUrl(u);
    assert.strictEqual(r.ok, false, `${u} must be rejected`);
    assert.match(r.error, re, `${u} error "${r.error}" should match ${re}`);
  }
});

test('isPlausibleMediaUrl: a hostile prefix glued before an embedded URL is neutralized by extraction (matches validateChannelUrl F6)', () => {
  // The embedded URL is extracted and the prefix discarded -- so option
  // injection can't survive, and a private-IP embedded target is still caught.
  assert.strictEqual(isPlausibleMediaUrl('garbage prefix http://vimeo.com/1').ok, true, 'the real URL is extracted and accepted');
  const inner = isPlausibleMediaUrl('$(evil) http://169.254.169.254/latest/');
  assert.strictEqual(inner.ok, false, 'an embedded private-IP target is still caught by the SSRF guard after extraction');
  assert.match(inner.error, /not allowed/);
});

test('C1 (gate CRITICAL): an IPv4-mapped IPv6 literal is caught THROUGH the real URL parser (not a hand-built form)', () => {
  // new URL() serializes ::ffff:a.b.c.d to HEX hextets -- the actual bytes the
  // SSRF guard must classify. Drive the WHOLE intake, not isPrivateOrLocalHost
  // with a production-never-emits dotted string.
  for (const u of [
    'http://[::ffff:169.254.169.254]/Mediasite/Play/0123456789abcdef0123456789abcdef', // cloud metadata
    'http://[::ffff:127.0.0.1]:8080/x',   // loopback
    'http://[::ffff:10.0.0.1]/x',         // private
    'http://[0:0:0:0:0:ffff:a9fe:a9fe]/x', // fully-spelled mapped 169.254.169.254
  ]) {
    const r = isPlausibleMediaUrl(u);
    assert.strictEqual(r.ok, false, `${u} must be refused (SSRF)`);
    assert.match(r.error, /not allowed/);
  }
  // A genuine public IPv6 still passes.
  assert.strictEqual(isPlausibleMediaUrl('http://[2001:4860:4860::8888]/x').ok, true);
});

test('C2 (gate CRITICAL): the universal lane PRESERVES a non-YouTube query identity (never the YouTube v/list allowlist)', () => {
  const bili = isPlausibleMediaUrl('https://www.bilibili.com/video/BV1xx411c7mD?p=3');
  assert.strictEqual(bili.ok, true);
  assert.match(bili.url, /[?&]p=3/, 'the ?p=3 part selector MUST survive (yt-dlp downloads the wrong part otherwise)');

  const multi = isPlausibleMediaUrl('https://vk.com/video?z=abc&list=xyz&video_id=42');
  assert.strictEqual(multi.ok, true);
  assert.match(multi.url, /video_id=42/, 'the resource id in the query survives');
  assert.match(multi.url, /z=abc/, 'other params survive too');
  assert.ok(!/ /.test(multi.url), 'no bare unsafe chars remain (query re-encoded via searchParams)');
});

test('isPlausibleMediaUrl: no user-visible message leaks an internal parameter name', () => {
  // The screenshot bug: "channelUrl host is not an allowed YouTube host".
  for (const u of ['http://127.0.0.1/x', 'ftp://x/y', 'https://user:p@vimeo.com/1', 'https://a.com/x y']) {
    const r = isPlausibleMediaUrl(u);
    assert.ok(!/channelUrl|videoId|isSafe/.test(r.error), `error must not leak internals: "${r.error}"`);
  }
});

// ---- classifyOneOffUrl: the YouTube-vs-universal lane branch (D1a) ----------

const { classifyOneOffUrl } = require('../../lib/ytdlp/url.js');

test('classifyOneOffUrl: a YouTube single-video URL takes the legacy lane, byte-for-byte', () => {
  const r = classifyOneOffUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.lane, 'youtube');
  assert.strictEqual(r.videoId, 'dQw4w9WgXcQ');
  assert.match(r.watchUrl, /youtube\.com\/watch\?v=dQw4w9WgXcQ/);
  assert.strictEqual(r.sourceUrl, undefined, 'the youtube lane carries no raw sourceUrl');
});

test('classifyOneOffUrl: youtu.be + shorts + share-sheet prose all stay the legacy lane', () => {
  for (const u of [
    'https://youtu.be/dQw4w9WgXcQ',
    'https://www.youtube.com/shorts/abcdefghijk',
    'Check this out\nhttps://youtu.be/dQw4w9WgXcQ?si=xyz',
  ]) {
    const r = classifyOneOffUrl(u);
    assert.strictEqual(r.ok, true, `${u}: ${r.error || ''}`);
    assert.strictEqual(r.lane, 'youtube', `${u} should be the youtube lane`);
  }
});

test('classifyOneOffUrl: a non-YouTube media URL takes the universal lane with a raw sourceUrl', () => {
  for (const u of ['https://vimeo.com/76979871', 'https://soundcloud.com/artist/track', 'https://www.facebook.com/reel/897928030021587/']) {
    const r = classifyOneOffUrl(u);
    assert.strictEqual(r.ok, true, `${u}: ${r.error || ''}`);
    assert.strictEqual(r.lane, 'universal');
    assert.ok(typeof r.sourceUrl === 'string' && r.sourceUrl.startsWith('http'), `${u} carries a sourceUrl`);
    assert.strictEqual(r.videoId, undefined);
  }
});

test('classifyOneOffUrl: a non-YouTube URL is normalized (Shortcut prose extraction) before the universal lane', () => {
  const r = classifyOneOffUrl('My fav track "https://soundcloud.com/artist/track"');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.lane, 'universal');
  assert.strictEqual(r.sourceUrl, 'https://soundcloud.com/artist/track', 'quotes + prose stripped');
});

test('classifyOneOffUrl: a YouTube CHANNEL/playlist/unsupported-shape is a hard reject, NEVER the universal lane', () => {
  for (const u of [
    'https://www.youtube.com/@somechannel',
    'https://www.youtube.com/playlist?list=PLxxxxxxxx',
    'https://www.youtube.com/clip/UgkxSomeClipId',   // YoutubeIE matches this, classifySingleVideo does not
  ]) {
    const r = classifyOneOffUrl(u);
    assert.strictEqual(r.ok, false, `${u} must be rejected, not universal-laned`);
    assert.ok(!/lane/.test(JSON.stringify(r)), `${u} must not produce a lane`);
  }
});

test('classifyOneOffUrl: private/hostile targets are rejected with a leak-free message', () => {
  for (const u of ['http://127.0.0.1/admin', 'ftp://x/y', 'https://user:p@vimeo.com/1', '']) {
    const r = classifyOneOffUrl(u);
    assert.strictEqual(r.ok, false, `${u} must be rejected`);
    assert.ok(!/channelUrl|videoId|isSafe/.test(r.error || ''), `no internal leak: "${r.error}"`);
  }
});
