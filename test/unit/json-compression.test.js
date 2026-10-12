'use strict';

// [UNIT] v1.386.0 speed pass (W3): lib/jsonCompression.js - a GET's large JSON 200 goes out compressed; nothing else
// changes. Binds: br and gzip round-trip to the exact JSON, the threshold, the ETag/304 path (Express's own), and
// that non-JSON, non-200, non-GET, already-encoded and refused-coding answers pass through untouched.

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const zlib = require('node:zlib');
const express = require('express');
const { jsonCompression, MIN_BYTES } = require('../../lib/jsonCompression');

let server, base;
const BIG = { items: Array.from({ length: 400 }, (_, i) => ({ id: 'id' + i, title: 'Song number ' + i, artist: 'Band' })) };
before(async () => {
  const app = express();
  app.use(jsonCompression);
  app.get('/big', (req, res) => res.json(BIG));
  app.get('/small', (req, res) => res.json({ ok: true }));
  app.get('/text', (req, res) => res.type('text').send('x'.repeat(MIN_BYTES * 2)));
  app.get('/missing', (req, res) => res.status(404).json(BIG));
  app.post('/big', (req, res) => res.json(BIG));
  app.get('/measured', (req, res) => { res.locals.skipCompression = true; res.json(BIG); });
  app.get('/pre', (req, res) => { res.setHeader('Content-Encoding', 'identity'); res.json(BIG); });
  app.get('/stream', (req, res) => { res.setHeader('Content-Type', 'application/json'); res.write(JSON.stringify(BIG).slice(0, 10)); res.end(JSON.stringify(BIG).slice(10)); });
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => server.close());

function raw(path, headers, method) {
  return new Promise((resolve, reject) => {
    const req = http.request(base + path, { method: method || 'GET', headers: headers || {} }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => resolve({ res, buf: Buffer.concat(chunks) }));
    });
    req.on('error', reject); req.end();
  });
}

test('a large JSON 200 goes out brotli or gzip and decodes to the exact JSON', async () => {
  const plain = JSON.stringify(BIG);
  assert.ok(Buffer.byteLength(plain) > MIN_BYTES, 'the fixture is over the threshold');
  const br = await raw('/big', { 'Accept-Encoding': 'gzip, deflate, br' });
  assert.strictEqual(br.res.headers['content-encoding'], 'br');
  assert.match(br.res.headers.vary, /Accept-Encoding/);
  assert.strictEqual(Number(br.res.headers['content-length']), br.buf.length);
  assert.strictEqual(zlib.brotliDecompressSync(br.buf).toString('utf8'), plain);
  assert.ok(br.buf.length < plain.length / 4);
  const gz = await raw('/big', { 'Accept-Encoding': 'gzip' });
  assert.strictEqual(gz.res.headers['content-encoding'], 'gzip');
  assert.strictEqual(zlib.gunzipSync(gz.buf).toString('utf8'), plain);
  const none = await raw('/big', {});
  assert.strictEqual(none.res.headers['content-encoding'], undefined);
  assert.strictEqual(none.buf.toString('utf8'), plain);
  const refused = await raw('/big', { 'Accept-Encoding': 'br;q=0, gzip;q=0' });
  assert.strictEqual(refused.res.headers['content-encoding'], undefined);
});

test('the ETag is Express\'s (same either way) and a fresh If-None-Match still answers 304', async () => {
  const a = await raw('/big', { 'Accept-Encoding': 'br' });
  const b = await raw('/big', {});
  assert.ok(a.res.headers.etag && a.res.headers.etag === b.res.headers.etag);
  const nm = await raw('/big', { 'Accept-Encoding': 'br', 'If-None-Match': a.res.headers.etag });
  assert.strictEqual(nm.res.statusCode, 304);
  assert.strictEqual(nm.buf.length, 0);
});

test('small, non-JSON, non-200, non-GET, pre-encoded and streamed answers pass through untouched', async () => {
  for (const [p, method] of [['/small'], ['/text'], ['/missing'], ['/big', 'POST'], ['/pre'], ['/stream'], ['/measured']]) {
    const r = await raw(p, { 'Accept-Encoding': 'br, gzip' }, method);
    assert.ok(!r.res.headers['content-encoding'] || r.res.headers['content-encoding'] === 'identity', p + ' ' + (method || 'GET'));
  }
  const s = await raw('/stream', { 'Accept-Encoding': 'br' });
  assert.strictEqual(s.buf.toString('utf8'), JSON.stringify(BIG), 'a streamed body arrives whole and plain');
});
