'use strict';

// [INTEGRATION] v1.32 (Dean, "white-label"): the replaceable header logo --
// GET /logo (serve/404), POST /api/settings/logo (raw-body upload with
// Content-Type allowlist + magic-byte sniff + 1MB cap), DELETE (reset), and
// the read-only `customLogo` flag on GET /api/settings. Same isolated
// DATA_DIR boot harness as liked.test.js.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-logo-'));
fs.mkdirSync(path.join(process.env.DATA_DIR, '.thumbnails'), { recursive: true });

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app } = require('../../server');

let server;
let base;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

// A tiny-but-real PNG (1x1, valid signature + IHDR) -- enough for the
// magic-byte sniff, no image library needed.
const TINY_PNG = Buffer.from(
  '89504e470d0a1a0a0000000d494844520000000100000001080600000' +
  '01f15c4890000000d49444154789c6260000000060005e27de71c0000000049454e44ae426082',
  'hex',
);

test('v1.32: GET /logo is 404 before any upload, and GET /api/settings reports customLogo:false', async () => {
  const logo = await fetch(`${base}/logo`);
  assert.equal(logo.status, 404);
  const settings = await (await fetch(`${base}/api/settings`)).json();
  assert.equal(settings.customLogo, false);
});

test('v1.32: a valid PNG upload round-trips -- POST accepts, /logo serves the exact bytes with the right type, settings reports customLogo:true', async () => {
  const post = await fetch(`${base}/api/settings/logo`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/png' },
    body: TINY_PNG,
  });
  assert.equal(post.status, 200);
  const logo = await fetch(`${base}/logo`);
  assert.equal(logo.status, 200);
  assert.equal(logo.headers.get('content-type'), 'image/png');
  const served = Buffer.from(await logo.arrayBuffer());
  assert.ok(served.equals(TINY_PNG), 'served bytes must be exactly what was uploaded');
  const settings = await (await fetch(`${base}/api/settings`)).json();
  assert.equal(settings.customLogo, true);
});

test('v1.32: content-type/magic-byte mismatches are rejected -- a text file labeled image/png never lands', async () => {
  const forged = await fetch(`${base}/api/settings/logo`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/png' },
    body: Buffer.from('<script>alert(1)</script> definitely not a png'),
  });
  assert.equal(forged.status, 400);
  // An unlisted type never even reaches the handler's body (express.raw is
  // type-scoped) -- the mime allowlist check 400s it.
  const svg = await fetch(`${base}/api/settings/logo`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/svg+xml' },
    body: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
  });
  assert.equal(svg.status, 400, 'SVG is deliberately excluded (script-capable)');
});

test('v1.32: an oversized upload gets a clean JSON 413, and the previous logo survives untouched', async () => {
  const big = Buffer.concat([TINY_PNG, Buffer.alloc(1024 * 1024 + 10, 0)]);
  const post = await fetch(`${base}/api/settings/logo`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/png' },
    body: big,
  });
  assert.equal(post.status, 413);
  const body = await post.json();
  assert.match(body.error, /max 1 MB/i);
  const logo = await fetch(`${base}/logo`);
  assert.equal(logo.status, 200, 'the previously-uploaded logo must survive a failed replacement');
});

test('v1.32: DELETE resets to the default -- /logo 404s again and customLogo flips false', async () => {
  const del = await fetch(`${base}/api/settings/logo`, { method: 'DELETE' });
  assert.equal(del.status, 200);
  assert.equal((await fetch(`${base}/logo`)).status, 404);
  const settings = await (await fetch(`${base}/api/settings`)).json();
  assert.equal(settings.customLogo, false);
});

test('v1.32: customLogoMime is NOT settable via the generic POST /api/settings (unknown key -> 400)', async () => {
  const post = await fetch(`${base}/api/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ customLogoMime: 'image/png' }),
  });
  assert.equal(post.status, 400);
});
