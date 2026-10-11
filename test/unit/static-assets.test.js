'use strict';

// v1.386.0 speed pass (W2): lib/staticAssets.js - content-versioned asset URLs, the long cache, compression.
// The one property that must never break: a response is cached `immutable` ONLY when its URL's `v` is the hash of
// the exact bytes sent, so a release (new bytes -> new hash -> a new URL in the always-revalidated shell) can never
// leave a device on old JS/CSS. The census at the bottom checks it for EVERY file the real public/ ships.

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const express = require('express');
const { createStaticAssets, pickEncoding, IMMUTABLE, REVALIDATE, STATIC_DIRS } = require('../../lib/staticAssets');

const sha16 = (b) => crypto.createHash('sha256').update(b).digest('hex').slice(0, 16);

let dir, server, base, assets, fellThrough;
function write(rel, content) {
  const f = path.join(dir, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, content);
  return f;
}
// a file's next version must not share its old mtime (the memo re-reads on size OR mtime)
function rewrite(rel, content) {
  const f = write(rel, content);
  const t = new Date(Date.now() + 5000 + Math.floor(Math.random() * 100000));
  fs.utimesSync(f, t, t);
}
async function get(p, headers) {
  const r = await fetch(base + p, { headers: Object.assign({ 'Accept-Encoding': 'identity' }, headers || {}) });
  return { r, body: Buffer.from(await r.arrayBuffer()) };
}

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-static-assets-'));
  write('js/app.js', 'window.APP = "one";\n' + 'x'.repeat(4000));
  write('js/tiny.js', 'var t=1;');
  write('assets/skins/board.webp', Buffer.from('BOARD-ONE'));
  write('fonts/f.woff2', Buffer.from('FONT'));
  write('assets/icons/i.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>');
  write('css/style.css', [
    '.a{background:url(../assets/skins/board.webp) 0 0 / 10px no-repeat}',
    '.b{mask:url("/assets/icons/i.svg")}',
    '@font-face{font-family:F;src:url(\'../fonts/f.woff2\') format("woff2")}',
    '.c{background:url(data:image/png;base64,AAAA)}',
    '.d{background:url(../assets/missing.webp)}',
    '.e{background:url(../assets/skins/board.webp?keep=1)}',
    '.f{background:url(https://example.com/x.png)}',
  ].join('\n') + '\n' + '/* pad */'.repeat(200));
  write('manifest.webmanifest', '{}');
  assets = createStaticAssets({ publicDir: dir });
  const app = express();
  fellThrough = [];
  app.use(assets.middleware);
  app.use((req, res) => { fellThrough.push(req.path); res.status(418).end('fell-through'); });
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => { server.close(); });

test('rewriteHtml stamps scripts, stylesheets and preloads with the hash of the served bytes, and nothing else', () => {
  const html = '<head><link rel="manifest" href="/manifest.webmanifest"><link rel="icon" href="/assets/icons/i.svg">' +
    '<link rel="preload" href="/fonts/f.woff2" as="font" crossorigin><link rel="stylesheet" href="/css/style.css">' +
    '<script src="/js/app.js"></script><script src="/js/nope.js"></script><script src="https://cdn.example/x.js"></script>' +
    '<script src="/js/app.js?already=1"></script><img src="/assets/skins/board.webp"></head>';
  const out = assets.rewriteHtml(html);
  const v = (p) => assets.versionOf(p);
  assert.ok(out.includes(`<script src="/js/app.js?v=${v('/js/app.js')}"></script>`));
  assert.strictEqual(v('/js/app.js'), sha16(fs.readFileSync(path.join(dir, 'js/app.js'))));
  assert.ok(out.includes(`<link rel="stylesheet" href="/css/style.css?v=${v('/css/style.css')}">`));
  assert.ok(out.includes(`<link rel="preload" href="/fonts/f.woff2?v=${v('/fonts/f.woff2')}" as="font" crossorigin>`));
  // untouched: the manifest, an icon link, a missing file, another origin, an already-queried URL, an <img>
  assert.ok(out.includes('<link rel="manifest" href="/manifest.webmanifest">'));
  assert.ok(out.includes('<link rel="icon" href="/assets/icons/i.svg">'));
  assert.ok(out.includes('<script src="/js/nope.js"></script>'));
  assert.ok(out.includes('<script src="https://cdn.example/x.js"></script>'));
  assert.ok(out.includes('<script src="/js/app.js?already=1"></script>'));
  assert.ok(out.includes('<img src="/assets/skins/board.webp">'));
});

test('a stylesheet stamps its own url() targets, so a changed image changes the stylesheet hash (the bust chain)', async () => {
  const { body } = await get('/css/style.css');
  const css = body.toString('utf8');
  const vb = assets.versionOf('/assets/skins/board.webp');
  assert.ok(css.includes(`url(../assets/skins/board.webp?v=${vb})`), 'relative target stamped, spelling kept');
  assert.ok(css.includes(`url("/assets/icons/i.svg?v=${assets.versionOf('/assets/icons/i.svg')}")`), 'quoted absolute target stamped, quotes kept');
  assert.ok(css.includes(`url('../fonts/f.woff2?v=${assets.versionOf('/fonts/f.woff2')}')`), 'the font the shell preloads gets the SAME stamp');
  assert.ok(css.includes('url(data:image/png;base64,AAAA)'));
  assert.ok(css.includes('url(../assets/missing.webp)'));
  assert.ok(css.includes('url(../assets/skins/board.webp?keep=1)'));
  assert.ok(css.includes('url(https://example.com/x.png)'));
  assert.strictEqual(assets.versionOf('/css/style.css'), sha16(body), 'the stylesheet version is the hash of the REWRITTEN bytes');
  const cssV1 = assets.versionOf('/css/style.css');
  rewrite('assets/skins/board.webp', Buffer.from('BOARD-TWO!'));
  const vb2 = assets.versionOf('/assets/skins/board.webp');
  assert.notStrictEqual(vb2, vb);
  const cssV2 = assets.versionOf('/css/style.css');
  assert.notStrictEqual(cssV2, cssV1, 'a new image means a new stylesheet URL in the shell');
  const again = (await get('/css/style.css')).body.toString('utf8');
  assert.ok(again.includes(`board.webp?v=${vb2}`) && !again.includes(`board.webp?v=${vb})`));
});

test('immutable only for the hash of the bytes sent; every other v (none, old, made up, repeated) revalidates', async () => {
  const v = assets.versionOf('/js/app.js');
  let res = await get('/js/app.js?v=' + v);
  assert.strictEqual(res.r.status, 200);
  assert.strictEqual(res.r.headers.get('cache-control'), IMMUTABLE);
  assert.strictEqual(sha16(res.body), v);
  for (const q of ['', '?v=', '?v=0000000000000000', '?v=' + v + 'x', '?v=' + v + '&v=' + v, '?V=' + v]) {
    res = await get('/js/app.js' + q);
    assert.strictEqual(res.r.status, 200, q);
    assert.strictEqual(res.r.headers.get('cache-control'), REVALIDATE, 'revalidate for ' + JSON.stringify(q));
  }
  // a release: the file changes; the OLD v now names bytes that are gone, so it must never be cached immutable
  rewrite('js/app.js', 'window.APP = "two";\n' + 'y'.repeat(4000));
  res = await get('/js/app.js?v=' + v);
  assert.strictEqual(res.r.headers.get('cache-control'), REVALIDATE, 'an old version stamp gets the new bytes, revalidated');
  assert.ok(res.body.toString().startsWith('window.APP = "two"'));
  const v2 = assets.versionOf('/js/app.js');
  assert.notStrictEqual(v2, v);
  res = await get('/js/app.js?v=' + v2);
  assert.strictEqual(res.r.headers.get('cache-control'), IMMUTABLE);
  assert.strictEqual(sha16(res.body), v2);
});

test('ETag + If-None-Match answer 304 per representation; compression follows Accept-Encoding and round-trips', async () => {
  const v = assets.versionOf('/js/app.js');
  const plain = await get('/js/app.js?v=' + v);
  const etag = plain.r.headers.get('etag');
  assert.strictEqual(etag, '"' + v + '"');
  const nm = await get('/js/app.js?v=' + v, { 'If-None-Match': etag });
  assert.strictEqual(nm.r.status, 304);
  assert.strictEqual(nm.r.headers.get('cache-control'), IMMUTABLE);
  const stale = await get('/js/app.js', { 'If-None-Match': '"0000000000000000"' });
  assert.strictEqual(stale.r.status, 200);

  const br = await fetch(base + '/js/app.js?v=' + v, { headers: { 'Accept-Encoding': 'gzip, br' } });
  assert.strictEqual(br.headers.get('content-encoding'), 'br');
  assert.strictEqual(br.headers.get('vary'), 'Accept-Encoding');
  assert.strictEqual(br.headers.get('etag'), '"' + v + '-br"');
  // fetch decodes; compare to the identity bytes
  assert.strictEqual(sha16(Buffer.from(await br.arrayBuffer())), v);
  const http = require('node:http');
  const raw = await new Promise((resolve, reject) => {
    http.get(base + '/js/app.js?v=' + v, { headers: { 'Accept-Encoding': 'gzip' } }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => resolve({ res, buf: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
  assert.strictEqual(raw.res.headers['content-encoding'], 'gzip');
  assert.strictEqual(sha16(zlib.gunzipSync(raw.buf)), v);
  assert.ok(raw.buf.length < plain.body.length);
  // a refused coding is never chosen; a tiny file and a binary file are never compressed
  assert.strictEqual(pickEncoding('br;q=0, gzip'), 'gzip');
  assert.strictEqual(pickEncoding('br;q=0, gzip;q=0'), null);
  assert.strictEqual(pickEncoding('identity'), null);
  const tiny = await fetch(base + '/js/tiny.js', { headers: { 'Accept-Encoding': 'br' } });
  assert.strictEqual(tiny.headers.get('content-encoding'), null);
  const bin = await fetch(base + '/assets/skins/board.webp', { headers: { 'Accept-Encoding': 'br' } });
  assert.strictEqual(bin.headers.get('content-encoding'), null);
  assert.strictEqual(bin.headers.get('content-type'), 'image/webp');
});

test('a Range request, a traversal, a root file and an unknown file fall through to express.static', async () => {
  fellThrough.length = 0;
  const range = await fetch(base + '/js/app.js', { headers: { Range: 'bytes=0-3' } });
  assert.strictEqual(range.status, 418);
  for (const p of ['/js/../manifest.webmanifest', '/js/%2e%2e/manifest.webmanifest', '/manifest.webmanifest', '/js/none.js', '/js/', '/js/%E0%A4%A']) {
    const r = await fetch(base + p);
    assert.strictEqual(r.status, 418, p);
  }
  const head = await fetch(base + '/js/app.js', { method: 'HEAD' });
  assert.strictEqual(head.status, 200);
  assert.strictEqual(head.headers.get('cache-control'), REVALIDATE);
  const post = await fetch(base + '/js/app.js', { method: 'POST' });
  assert.strictEqual(post.status, 418);
});

// The census: every file the REAL public/ ships under a static folder, through the real module. Its own stamp is
// immutable and names its bytes; a wrong stamp revalidates. A shell's every stamp equals the file's version.
test('census: every shipped static file is immutable only under the hash of its served bytes', async () => {
  const pub = path.join(__dirname, '..', '..', 'public');
  const real = createStaticAssets({ publicDir: pub });
  const app = express();
  app.use(real.middleware);
  app.use((req, res) => res.status(418).end());
  const srv = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const b = 'http://127.0.0.1:' + srv.address().port;
  let n = 0;
  try {
    const files = [];
    const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else files.push(f); } };
    for (const d of STATIC_DIRS) if (fs.existsSync(path.join(pub, d))) walk(path.join(pub, d));
    assert.ok(files.length > 50, 'the census sees the shipped files');
    for (const f of files) {
      const urlPath = '/' + path.relative(pub, f).split(path.sep).join('/');
      if (!/^[\w./-]+$/.test(urlPath)) continue; // a name a shell could not reference plainly
      const v = real.versionOf(urlPath);
      if (v === null) { assert.ok(fs.statSync(f).size > 6 * 1024 * 1024, urlPath + ' has no version but is not oversized'); continue; }
      const ok = await fetch(b + urlPath + '?v=' + v, { headers: { 'Accept-Encoding': 'identity' } });
      const bytes = Buffer.from(await ok.arrayBuffer());
      assert.strictEqual(ok.headers.get('cache-control'), IMMUTABLE, urlPath);
      assert.strictEqual(sha16(bytes), v, urlPath + ': the immutable bytes are the ones the stamp names');
      const bad = await fetch(b + urlPath + '?v=deadbeefdeadbeef');
      await bad.arrayBuffer();
      assert.strictEqual(bad.headers.get('cache-control'), REVALIDATE, urlPath);
      n++;
    }
    assert.ok(n > 50);
    // every shell's stamps
    for (const shell of fs.readdirSync(pub).filter((x) => x.endsWith('.html'))) {
      const out = real.rewriteHtml(fs.readFileSync(path.join(pub, shell), 'utf8'));
      for (const m of out.matchAll(/(?:src|href)="(\/[^"?]+)\?v=([0-9a-f]{16})"/g)) {
        assert.strictEqual(m[2], real.versionOf(m[1]), shell + ' ' + m[1]);
      }
    }
  } finally { srv.close(); }
});
