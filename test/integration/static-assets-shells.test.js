'use strict';

// [INTEGRATION] v1.386.0 speed pass (W2): the REAL server's shells name each static file by the hash of the bytes it
// serves (lib/staticAssets.js), so the files can be cached for a year while a release still reaches every device on
// its next load. Through the real middleware chain (auth gate included):
//   - every header shell is `no-cache` and stamps its scripts / stylesheets / preloads with `?v=<16 hex>`;
//   - each stamped URL answers 200 `immutable`, compressed when the browser accepts it, and the stamp is the hash
//     of the decoded bytes; the same file under a wrong stamp revalidates;
//   - the LOGIN shell's stamped files load WITHOUT a session (the gate's allowlist reads the path, not the query) -
//     a stamp that tripped the gate would leave the sign-in page unstyled and its form dead;
//   - the service worker and the manifest (root files) keep their `no-cache` header;
//   - the /diag compression probe's PLAIN baseline stays plain under the new JSON compression (lib/jsonCompression.js).

process.env.FT_DIAG = '1'; // the /diag probes are on for this file (the payload baseline check below)
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'filetube-static-shells-'));

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const http = require('node:http');
const zlib = require('node:zlib');
const { app } = require('../../server');
const { authenticateFetch } = require('../helpers/auth');

let server, base, auth;
before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  auth = authenticateFetch(server, base);
});
after(() => { auth.restore(); server.close(); });

const sha16 = (b) => crypto.createHash('sha256').update(b).digest('hex').slice(0, 16);
function rawGet(p, headers) {
  return new Promise((resolve, reject) => {
    http.get(base + p, { headers: headers || {} }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => resolve({ res, buf: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}
const decode = (r) => (r.res.headers['content-encoding'] === 'br' ? zlib.brotliDecompressSync(r.buf) : r.res.headers['content-encoding'] === 'gzip' ? zlib.gunzipSync(r.buf) : r.buf);
const stamped = (html) => [...html.matchAll(/(?:src|href)="(\/(?:js|css|fonts|assets|icons|vendor|critters)\/[^"?]+)\?v=([0-9a-f]{16})"/g)].map((m) => ({ path: m[1], v: m[2] }));

test('every header shell is no-cache and stamps its scripts, stylesheets and preloads', async () => {
  for (const p of ['/', '/music', '/podcasts', '/tv', '/books', '/history', '/watch.html', '/setup.html', '/stats.html', '/read.html', '/feed', '/cleanup']) {
    const r = await fetch(base + p, { headers: { Accept: 'text/html' } });
    const html = await r.text();
    assert.strictEqual(r.status, 200, p);
    assert.strictEqual(r.headers.get('cache-control'), 'no-cache', p + ' shell stays revalidated');
    const list = stamped(html);
    assert.ok(list.some((x) => x.path === '/js/common.js'), p + ' stamps common.js');
    assert.ok(list.some((x) => x.path === '/css/style.css'), p + ' stamps style.css');
    // no unstamped static script/stylesheet left behind
    const bare = [...html.matchAll(/<script\b[^>]*\bsrc="(\/(?:js|vendor)\/[^"]+)"/g)].map((m) => m[1]).filter((u) => !/\?v=[0-9a-f]{16}$/.test(u));
    assert.deepStrictEqual(bare.filter((u) => u !== '/js/perf-collector.js'), [], p + ' every shell script is stamped');
  }
});

test('a stamped URL is immutable, compressed, and its stamp names the decoded bytes; a wrong stamp revalidates', async () => {
  const html = await (await fetch(base + '/music', { headers: { Accept: 'text/html' } })).text();
  const list = stamped(html);
  assert.ok(list.length >= 20, 'the music shell stamps its files: ' + list.length);
  for (const { path, v } of list) {
    const r = await rawGet(path + '?v=' + v, { Cookie: auth.cookie, 'Accept-Encoding': 'br, gzip' });
    assert.strictEqual(r.res.statusCode, 200, path);
    assert.strictEqual(r.res.headers['cache-control'], 'private, max-age=31536000, immutable', path);
    assert.strictEqual(sha16(decode(r)), v, path + ': the stamp is the hash of the bytes served');
    if (/\.(js|css)$/.test(path)) assert.ok(['br', 'gzip'].includes(r.res.headers['content-encoding']), path + ' compressed');
    const wrong = await rawGet(path + '?v=0123456789abcdef', { Cookie: auth.cookie });
    assert.strictEqual(wrong.res.headers['cache-control'], 'no-cache', path + ' under a wrong stamp');
  }
});

test('the login shell\'s stamped files load without a session (the gate allowlist reads the path, not the query)', async () => {
  const r = await fetch(base + '/login', { headers: { Accept: 'text/html', Cookie: '' } });
  assert.strictEqual(r.status, 200);
  const list = stamped(await r.text());
  assert.ok(list.some((x) => x.path === '/css/style.css') && list.some((x) => x.path === '/js/login.js'), 'login stamps its stylesheet and form script');
  for (const { path, v } of list) {
    const a = await rawGet(path + '?v=' + v, {}); // no cookie at all
    assert.strictEqual(a.res.statusCode, 200, path + ' loads signed out');
  }
});

test('root files (the push worker, the manifest) keep no-cache', async () => {
  for (const p of ['/filetube-worker.js', '/manifest.webmanifest']) {
    const r = await rawGet(p, { Cookie: auth.cookie });
    assert.strictEqual(r.res.statusCode, 200, p);
    assert.strictEqual(r.res.headers['cache-control'], 'no-cache', p);
  }
});

test('the /diag payload probe: the plain baseline stays plain, the br sample stays br', async () => {
  const plain = await rawGet('/api/diag/payload?enc=none', { Cookie: auth.cookie, 'Accept-Encoding': 'br, gzip' });
  assert.strictEqual(plain.res.statusCode, 200);
  assert.strictEqual(plain.res.headers['content-encoding'], undefined, 'the baseline is measured plain');
  assert.ok(plain.buf.length >= 8192, 'the baseline is big enough that the compressor WOULD have taken it');
  assert.strictEqual(String(plain.buf.length), plain.res.headers['x-wire-bytes']);
  const br = await rawGet('/api/diag/payload?enc=br', { Cookie: auth.cookie, 'Accept-Encoding': 'br, gzip' });
  assert.strictEqual(br.res.headers['content-encoding'], 'br');
  assert.strictEqual(String(br.buf.length), br.res.headers['x-wire-bytes']);
});
