'use strict';

// [UNIT] v1.40.0 — the pure browse-context helpers behind context-aware
// prev/next (public/js/common.js). They let a video opened from a browsing
// view carry that view's EXACT list + order (folder/search/liked scope, sort,
// AND the server shuffle seed) to the watch page + autoplay, so stepping walks
// what was on screen instead of the item's own channel folder. The DOM wiring
// (main.js emit / watch.js buttons / player.js autoplay) is validated
// on-device; this locks the encode/decode/URL contract those three share.

const { test } = require('node:test');
const assert = require('node:assert');

const {
  encodeListContext,
  decodeListContext,
  buildContextListUrl,
} = require('../../public/js/common.js');

// ---- encodeListContext ------------------------------------------------------

test('encodeListContext: round-trips a full videos context through decode', () => {
  const ctx = { src: 'videos', sort: 'random', seed: 12345, search: '', folder: '', root: '/media/YouTube', format: 'all' };
  const param = encodeListContext(ctx);
  assert.ok(param && typeof param === 'string');
  const back = decodeListContext(param);
  assert.ok(!('src' in back), 'the default videos src is omitted (only "liked" is stored)');
  assert.strictEqual(back.sort, 'random');
  assert.strictEqual(back.seed, '12345'); // stringified on encode
  assert.strictEqual(back.root, '/media/YouTube');
  assert.ok(!('search' in back), 'empty fields are dropped');
  assert.ok(!('folder' in back), 'empty fields are dropped');
});

test('v1.44 music: encodeListContext preserves src="music" + album/artist/filter; buildContextListUrl hits /api/music in order', () => {
  const ctx = { src: 'music', album: 'k1', sort: 'album-order', seed: 7 };
  const back = decodeListContext(encodeListContext(ctx));
  assert.strictEqual(back.src, 'music');
  assert.strictEqual(back.album, 'k1');
  assert.strictEqual(back.sort, 'album-order');
  const url = buildContextListUrl(back, 5000);
  assert.ok(url.startsWith('/api/music?'), 'music ctx targets /api/music');
  assert.match(url, /album=k1/);
  assert.match(url, /sort=album-order/);
  assert.match(url, /limit=5000/);

  // artist + filter variants
  const artistUrl = buildContextListUrl({ src: 'music', artist: 'Pink Floyd' }, 100);
  assert.match(artistUrl, /^\/api\/music\?/);
  assert.match(artistUrl, /artist=Pink%20Floyd/);
  const likedUrl = buildContextListUrl({ src: 'music', filter: 'liked' }, 100);
  assert.match(likedUrl, /filter=liked/);
});

test('encodeListContext: only src="liked" survives; any other src is treated as the default library', () => {
  assert.match(decodeListContext(encodeListContext({ src: 'liked', sort: 'newest' })).src || '', /liked/);
  const notLiked = decodeListContext(encodeListContext({ src: 'videos', sort: 'newest' }));
  assert.ok(!('src' in notLiked), 'a non-liked src is omitted (defaults to the library endpoint)');
  const garbageSrc = decodeListContext(encodeListContext({ src: 'nonsense', sort: 'newest' }));
  assert.ok(!('src' in garbageSrc));
});

test('encodeListContext: an empty / no-op / non-object context encodes to "" (caller omits the param)', () => {
  assert.strictEqual(encodeListContext({}), '');
  assert.strictEqual(encodeListContext({ src: 'videos', search: '', folder: '' }), '', 'nothing meaningful -> empty');
  assert.strictEqual(encodeListContext(null), '');
  assert.strictEqual(encodeListContext(undefined), '');
  assert.strictEqual(encodeListContext('nope'), '');
});

test('encodeListContext: seed=0 is preserved (falsy-but-meaningful), but null/undefined/"" seed is dropped', () => {
  assert.strictEqual(decodeListContext(encodeListContext({ sort: 'random', seed: 0 })).seed, '0');
  assert.ok(!('seed' in decodeListContext(encodeListContext({ sort: 'newest', seed: null }))));
  assert.ok(!('seed' in decodeListContext(encodeListContext({ sort: 'newest', seed: '' }))));
});

// ---- decodeListContext ------------------------------------------------------

test('decodeListContext: returns null for absent / garbage / non-object payloads (never throws)', () => {
  assert.strictEqual(decodeListContext(''), null);
  assert.strictEqual(decodeListContext(null), null);
  assert.strictEqual(decodeListContext(undefined), null);
  assert.strictEqual(decodeListContext('%%%not-json%%%'), null);
  assert.strictEqual(decodeListContext(encodeURIComponent('[1,2,3]')), null, 'a JSON array is not a context object');
  assert.strictEqual(decodeListContext(encodeURIComponent('"a string"')), null);
});

// ---- full URL round-trip (regression lock for the v1.40.0 gate CRITICAL) ----
// encode/decode handle ONLY the JSON layer; the caller owns the percent layer
// (encodeURIComponent on write; URLSearchParams.get decodes on read). Getting
// that wrong silently dropped context for any search/path with % & # + . This
// walks the exact write path (main.js/watch.js) and read path (watch.js).

test('URL round-trip survives %, &, #, + in a search term (the gate CRITICAL)', () => {
  for (const term of ['R&B', '50% off', 'rock #1', 'a+b', 'AT&T', 'plain words']) {
    const ctxParam = encodeListContext({ src: 'videos', sort: 'newest', search: term });
    // write, exactly as main.js/watch.js/player.js build the URL:
    const href = '/watch.html?v=abc&ctx=' + encodeURIComponent(ctxParam);
    // read, exactly as watch.js does (URLSearchParams.get decodes once):
    const got = new URLSearchParams(new URL('https://x' + href).search).get('ctx');
    const decoded = decodeListContext(got);
    assert.ok(decoded, 'ctx survived the URL round-trip for search=' + JSON.stringify(term));
    assert.strictEqual(decoded.search, term, 'search preserved exactly: ' + JSON.stringify(term));
  }
});

test('a SECOND hop (navigateToWatch re-encodes the decoded value) still round-trips', () => {
  const ctxParam = encodeListContext({ src: 'videos', sort: 'random', seed: 9, search: 'R&B' });
  const firstGot = new URLSearchParams(new URL('https://x/w?ctx=' + encodeURIComponent(ctxParam)).search).get('ctx');
  // navigateToWatch appends encodeURIComponent(rawBrowseCtx) where rawBrowseCtx === firstGot:
  const secondHref = '/watch.html?v=next&ctx=' + encodeURIComponent(firstGot);
  const secondGot = new URLSearchParams(new URL('https://x' + secondHref).search).get('ctx');
  const decoded = decodeListContext(secondGot);
  assert.strictEqual(decoded.search, 'R&B');
  assert.strictEqual(decoded.seed, '9');
});

// ---- buildContextListUrl ----------------------------------------------------

test('buildContextListUrl: a videos context builds /api/videos with scope+sort+format+seed and the full limit', () => {
  const url = buildContextListUrl({ src: 'videos', sort: 'random', seed: '77', root: '/media/YT', format: 'all' }, 1000000);
  assert.ok(url.startsWith('/api/videos?'), url);
  assert.match(url, /root=%2Fmedia%2FYT/);
  assert.match(url, /sort=random/);
  assert.match(url, /format=all/);
  assert.match(url, /seed=77/);
  assert.match(url, /limit=1000000/);
});

test('buildContextListUrl: a liked context swaps to the /api/liked endpoint (identical param shape)', () => {
  const url = buildContextListUrl({ src: 'liked', sort: 'newest', seed: '5' }, 500);
  assert.ok(url.startsWith('/api/liked?'), url);
  assert.match(url, /sort=newest/);
  assert.match(url, /limit=500/);
});

test('buildContextListUrl: omits empty fields and encodes a search query safely', () => {
  const url = buildContextListUrl({ src: 'videos', search: 'a b&c', sort: 'newest' }, 10);
  assert.match(url, /search=a%20b%26c/);
  assert.ok(!/folder=/.test(url) && !/root=/.test(url) && !/seed=/.test(url), 'no empty params: ' + url);
  assert.match(url, /limit=10/);
});

test('buildContextListUrl: a null/empty context still yields a valid full-library URL (defensive)', () => {
  assert.strictEqual(buildContextListUrl(null, 42), '/api/videos?limit=42');
  assert.strictEqual(buildContextListUrl({}, 42), '/api/videos?limit=42');
});
