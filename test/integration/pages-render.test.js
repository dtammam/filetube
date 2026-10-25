'use strict';

// [INTEGRATION] v1.395.0 Pages, Step 3 (plan D-RENDER): the Original is served with
// the strict CSP (incl. the CSP sandbox) and its stored assets INLINED as data:
// URIs (a sandboxed frame's image requests carry no SameSite=Lax cookie in
// Chromium/Firefox - tools/pages/sandbox-cookie-probe.js); an asset is served by
// a strict name with its stored type; another user's item is the neutral 404.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-pages-render-'));

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, pages, __mintTestSession } = require('../../server');
const { ORIGINAL_CSP } = require('../../lib/pages/routes');

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('pixels')]);
const NAME = require('crypto').createHash('sha256').update(PNG).digest('hex').slice(0, 24) + '.png';

let server;
let base;
let owner;
let other;
let item;

before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  owner = __mintTestSession({ username: 'testadmin' });
  other = __mintTestSession({ username: 'sam', role: 'member' });
  const original = `<!DOCTYPE html>\n<html><head><meta charset="utf-8"/><style>.h{background:url("assets/${NAME}")}</style></head><body><p class="h">Hello</p><img src="assets/${NAME}" alt="x" loading="lazy"/><img src="assets/ffffffffffffffffffffffff.png"/></body></html>\n`;
  const saved = await pages.service.saveItem(owner.user.id, {
    record: { kind: 'url', title: 'Render me', url: 'https://example.com/a', canonicalUrl: 'https://example.com/a', hasReader: true, hasOriginal: true, wordCount: 1, readingMinutes: 1, source: 'web', assets: { state: 'done', count: 1, bytes: PNG.length, dropped: [] } },
    files: { 'reader.html': `<p>Hello <img src="assets/${NAME}" alt="x" loading="lazy"/></p>\n`, 'original.html': original, 'text.txt': 'Hello\n' },
    assets: [{ name: NAME, data: PNG }],
  });
  item = saved.item;
});

after(() => { server.close(); });

const get = (p, session) => fetch(base + p, { headers: session ? { Cookie: session.cookie } : {}, redirect: 'manual' });

test('GET /api/pages/:id/original: the strict CSP + sandbox, nosniff, no framing by others, assets inlined as data: URIs', async () => {
  const r = await get(`/api/pages/${item.id}/original`, owner);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.headers.get('content-security-policy'), ORIGINAL_CSP);
  assert.match(ORIGINAL_CSP, /default-src 'none'/);
  assert.match(ORIGINAL_CSP, /; sandbox allow-popups allow-popups-to-escape-sandbox$/);
  assert.ok(!/script-src|allow-scripts|allow-same-origin/.test(ORIGINAL_CSP));
  assert.strictEqual(r.headers.get('x-content-type-options'), 'nosniff');
  assert.strictEqual(r.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.match(r.headers.get('content-type'), /^text\/html; charset=utf-8/);
  assert.match(r.headers.get('cache-control'), /no-store/);
  const body = await r.text();
  const dataUri = `data:image/png;base64,${PNG.toString('base64')}`;
  assert.ok(body.includes(`src="${dataUri}"`), 'the img is inlined');
  assert.ok(body.includes(`url("${dataUri}")`), 'the CSS url() is inlined');
  assert.ok(body.includes('src="assets/ffffffffffffffffffffffff.png"'), 'a reference to a file that does not exist is left alone');
});

test('another user, a missing id, a malformed id: the same neutral 404; no session: 401', async () => {
  const r1 = await get(`/api/pages/${item.id}/original`, other);
  const r2 = await get('/api/pages/000000000000/original', owner);
  const r3 = await get('/api/pages/..%2F..%2Fetc/original', owner);
  for (const r of [r1, r2, r3]) {
    assert.strictEqual(r.status, 404);
    assert.deepStrictEqual(await r.json(), { error: 'No such page.' });
  }
  const r4 = await get(`/api/pages/${item.id}/original`, null);
  assert.strictEqual(r4.status, 401);
});

test('GET /api/pages/:id/assets/:name: the stored type, the asset CSP, immutable caching; a bad name or another user is a 404', async () => {
  const r = await get(`/api/pages/${item.id}/assets/${NAME}`, owner);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.headers.get('content-type'), 'image/png');
  assert.match(r.headers.get('content-security-policy'), /^default-src 'none'.*sandbox$/);
  assert.strictEqual(r.headers.get('x-content-type-options'), 'nosniff');
  assert.strictEqual(r.headers.get('cache-control'), 'private, max-age=31536000, immutable');
  assert.ok(Buffer.from(await r.arrayBuffer()).equals(PNG));
  for (const bad of ['../item.json', '..%2Fitem.json', 'item.json', `${NAME.slice(0, -4)}.svg`, `${NAME.toUpperCase()}`, 'ffffffffffffffffffffffff.png']) {
    const b = await get(`/api/pages/${item.id}/assets/${bad}`, owner);
    assert.strictEqual(b.status, 404, bad);
  }
  assert.strictEqual((await get(`/api/pages/${item.id}/assets/${NAME}`, other)).status, 404);
});
