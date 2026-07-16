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

test('v1.32 gate fix: GET /logo sends X-Content-Type-Options: nosniff (subtitle-route precedent)', async () => {
  const post = await fetch(`${base}/api/settings/logo`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/png' },
    body: TINY_PNG,
  });
  assert.equal(post.status, 200);
  const logo = await fetch(`${base}/logo`);
  assert.equal(logo.status, 200);
  assert.equal(logo.headers.get('x-content-type-options'), 'nosniff');
});

// ---- v1.33.1: per-mode (light/dark) logo variants ---------------------------
// The plain routes stay the LIGHT variant (byte-compatible with v1.32);
// `?variant=dark` addresses the dark one. GET cross-falls-back so a single
// upload serves BOTH modes; 404 only when neither is set.

// A tiny-but-real JPEG head (SOI + APP0), distinct bytes from TINY_PNG so
// serve assertions can tell the two variants apart.
const TINY_JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
  Buffer.from('JFIF\0', 'ascii'),
  Buffer.alloc(16, 7),
]);

test('v1.33.1: dark-variant upload round-trips independently -- ?variant=dark serves it, settings reports both flags', async () => {
  // Fresh light upload first (the earlier DELETE test cleared it).
  await fetch(`${base}/api/settings/logo`, {
    method: 'POST', headers: { 'Content-Type': 'image/png' }, body: TINY_PNG,
  });
  const post = await fetch(`${base}/api/settings/logo?variant=dark`, {
    method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: TINY_JPEG,
  });
  assert.equal(post.status, 200);

  const light = await fetch(`${base}/logo`);
  assert.equal(light.headers.get('content-type'), 'image/png');
  assert.ok(Buffer.from(await light.arrayBuffer()).equals(TINY_PNG), 'plain /logo stays the light upload');

  const dark = await fetch(`${base}/logo?variant=dark`);
  assert.equal(dark.status, 200);
  assert.equal(dark.headers.get('content-type'), 'image/jpeg');
  assert.ok(Buffer.from(await dark.arrayBuffer()).equals(TINY_JPEG), '?variant=dark serves the dark upload');

  const settings = await (await fetch(`${base}/api/settings`)).json();
  assert.equal(settings.customLogo, true);
  assert.equal(settings.customLogoDark, true);
});

test('v1.33.1: DELETE is variant-scoped -- removing the dark one leaves light serving, and dark then FALLS BACK to light', async () => {
  const del = await fetch(`${base}/api/settings/logo?variant=dark`, { method: 'DELETE' });
  assert.equal(del.status, 200);

  const settings = await (await fetch(`${base}/api/settings`)).json();
  assert.equal(settings.customLogo, true, 'the light variant must be untouched');
  assert.equal(settings.customLogoDark, false);

  const dark = await fetch(`${base}/logo?variant=dark`);
  assert.equal(dark.status, 200, 'dark request must fall back to the light upload ("only one -> used for both")');
  assert.equal(dark.headers.get('content-type'), 'image/png');
  assert.ok(Buffer.from(await dark.arrayBuffer()).equals(TINY_PNG));
});

test('v1.33.1: the reverse fallback -- dark-only upload serves the plain (light) /logo too; 404 only when NEITHER is set', async () => {
  // Clear light; upload dark only.
  await fetch(`${base}/api/settings/logo`, { method: 'DELETE' });
  await fetch(`${base}/api/settings/logo?variant=dark`, {
    method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: TINY_JPEG,
  });

  const light = await fetch(`${base}/logo`);
  assert.equal(light.status, 200, 'light request must fall back to the dark upload');
  assert.equal(light.headers.get('content-type'), 'image/jpeg');

  // Clear dark too -> nothing set -> 404 both ways.
  await fetch(`${base}/api/settings/logo?variant=dark`, { method: 'DELETE' });
  assert.equal((await fetch(`${base}/logo`)).status, 404);
  assert.equal((await fetch(`${base}/logo?variant=dark`)).status, 404);
});

test('v1.33.1: a garbage variant value normalizes to light (never a crash, never a third file)', async () => {
  await fetch(`${base}/api/settings/logo?variant=sparkly`, {
    method: 'POST', headers: { 'Content-Type': 'image/png' }, body: TINY_PNG,
  });
  const settings = await (await fetch(`${base}/api/settings`)).json();
  assert.equal(settings.customLogo, true, 'an unknown variant lands on the light/default one');
  assert.equal(settings.customLogoDark, false);
  const served = await fetch(`${base}/logo?variant=sparkly`);
  assert.equal(served.status, 200);
  assert.equal(served.headers.get('content-type'), 'image/png');
  // cleanup for any later-added tests
  await fetch(`${base}/api/settings/logo`, { method: 'DELETE' });
});

test('v1.33.1: customLogoDarkMime is NOT settable via the generic POST /api/settings (unknown key -> 400)', async () => {
  const res = await fetch(`${base}/api/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ customLogoDarkMime: 'image/png' }),
  });
  assert.equal(res.status, 400);
});

// ---- v1.41.18 (Dean): server-side FOUC kill --------------------------------
// The header shells are static HTML, so the text wordmark painted before the
// custom logo swapped in -- a flash on every refresh. The server now bakes
// `ft-custom-logo` onto <html> at serve time when a logo is configured, so the
// wordmark-hiding CSS is in force before any parsing. Self-contained: manages
// its own logo state so it is order-independent of the tests above.
const SHELL_PATHS = ['/', '/index.html', '/watch.html', '/stats.html', '/setup.html', '/read.html', '/books.html', '/books'];

test('v1.41.18: NO ft-custom-logo class on any shell when no custom logo is configured', async () => {
  await fetch(`${base}/api/settings/logo`, { method: 'DELETE' });
  await fetch(`${base}/api/settings/logo?variant=dark`, { method: 'DELETE' });
  for (const p of SHELL_PATHS) {
    const html = await (await fetch(`${base}${p}`)).text();
    const htmlTag = /<html\b[^>]*>/i.exec(html)[0];
    assert.doesNotMatch(htmlTag, /ft-custom-logo/, `${p} must NOT carry the class with no logo configured (${htmlTag})`);
  }
});

test('v1.41.18: EVERY shell is served with ft-custom-logo baked onto <html> once a logo is configured (pre-paint, zero flash)', async () => {
  const post = await fetch(`${base}/api/settings/logo`, {
    method: 'POST', headers: { 'Content-Type': 'image/png' }, body: TINY_PNG,
  });
  assert.equal(post.status, 200);
  for (const p of SHELL_PATHS) {
    const res = await fetch(`${base}${p}`);
    assert.equal(res.status, 200, `${p} serves`);
    const html = await res.text();
    const htmlTag = /<html\b[^>]*>/i.exec(html)[0];
    assert.match(htmlTag, /\bft-custom-logo\b/, `${p} must carry ft-custom-logo on <html> (${htmlTag})`);
    // The existing lang attr must survive the injection (no clobbering).
    assert.match(htmlTag, /lang="en"/, `${p} must keep lang="en" alongside the injected class`);
  }
});

test('v1.41.18: the class is withdrawn again after the logo is DELETED (self-heals to the text wordmark)', async () => {
  await fetch(`${base}/api/settings/logo`, { method: 'DELETE' });
  const html = await (await fetch(`${base}/`)).text();
  const htmlTag = /<html\b[^>]*>/i.exec(html)[0];
  assert.doesNotMatch(htmlTag, /ft-custom-logo/, 'a removed logo brings the text wordmark back on the next load');
});
