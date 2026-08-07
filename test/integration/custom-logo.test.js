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
const { authenticateFetch } = require('../helpers/auth');

let server;
let base;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
  authenticateFetch(server, base); // v1.43: auth through the real gate
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

test('v1.89: GET /logo serves the bundled default banner before any upload (was 404 pre-v1.89), and settings still reports customLogo:false', async () => {
  const logo = await fetch(`${base}/logo`);
  assert.equal(logo.status, 200, 'no upload -> the built-in default banner, not a 404');
  assert.equal(logo.headers.get('content-type'), 'image/png');
  const light = Buffer.from(await logo.arrayBuffer());
  assert.ok(light.length > 100 && light[0] === 0x89 && light[1] === 0x50, 'a real PNG banner');
  // The dark variant serves a DIFFERENT default banner (white-text vs black-text).
  const dark = await fetch(`${base}/logo?variant=dark`);
  assert.equal(dark.status, 200);
  const darkBytes = Buffer.from(await dark.arrayBuffer());
  assert.ok(!light.equals(darkBytes), 'the dark default banner differs from the light one');
  // Slim-gate S1: bind the MAPPING behaviorally, not just via a source-lock --
  // light -> the black-text banner file, dark -> the white-text banner file.
  // A coordinated filename swap in defaultLogoPath flips these and goes red here.
  const brandDir = path.join(__dirname, '..', '..', 'public', 'assets', 'brand');
  const blackFile = fs.readFileSync(path.join(brandDir, 'filetube-banner-black.png'));
  const whiteFile = fs.readFileSync(path.join(brandDir, 'filetube-banner-white.png'));
  assert.ok(light.equals(blackFile), 'light mode serves the black-text banner (legible on a light header)');
  assert.ok(darkBytes.equals(whiteFile), 'dark mode serves the white-text banner (legible on a dark header)');
  // The default is NOT an "upload" -- the Settings->Logo controls still see no custom logo.
  const settings = await (await fetch(`${base}/api/settings`)).json();
  assert.equal(settings.customLogo, false, 'the bundled default is not reported as a user upload');
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

test('v1.89: DELETE reverts to the bundled default banner (was a 404 pre-v1.89) and customLogo flips false', async () => {
  const before = Buffer.from(await (await fetch(`${base}/logo`)).arrayBuffer()); // the uploaded TINY_PNG
  const del = await fetch(`${base}/api/settings/logo`, { method: 'DELETE' });
  assert.equal(del.status, 200);
  const after = await fetch(`${base}/logo`);
  assert.equal(after.status, 200, 'delete now falls back to the default banner, not a 404');
  const afterBytes = Buffer.from(await after.arrayBuffer());
  assert.ok(!afterBytes.equals(before), 'the served logo is the default banner, no longer the deleted upload');
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

  // Clear dark too -> no upload -> v1.89 serves the bundled default banner both
  // ways (was 404 pre-v1.89), each variant its own default (light black-text,
  // dark white-text).
  await fetch(`${base}/api/settings/logo?variant=dark`, { method: 'DELETE' });
  const defLight = await fetch(`${base}/logo`);
  const defDark = await fetch(`${base}/logo?variant=dark`);
  assert.equal(defLight.status, 200);
  assert.equal(defDark.status, 200);
  assert.equal(defLight.headers.get('content-type'), 'image/png');
  assert.equal(defDark.headers.get('content-type'), 'image/png');
  assert.ok(!Buffer.from(await defLight.arrayBuffer()).equals(Buffer.from(await defDark.arrayBuffer())),
    'the two default banner variants are distinct files');
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

// ---- v1.41.18 (Dean) / v1.89: server-side FOUC kill -------------------------
// The header shells paint the text wordmark before JS runs, so the server bakes
// `ft-custom-logo` onto <html> at serve time to keep the wordmark-hiding CSS in
// force pre-paint. v1.89: the header now ALWAYS resolves to an image (the bundled
// default banner when nothing is uploaded, or the upload), so the class is baked
// in UNCONDITIONALLY -- it is no longer gated on an upload, and never withdrawn.
// Self-contained: manages its own logo state so it is order-independent.
const SHELL_PATHS = ['/', '/index.html', '/watch.html', '/stats.html', '/setup.html', '/read.html', '/books.html', '/books'];

test('v1.89: EVERY shell carries ft-custom-logo baked onto <html> even with NO upload (the default banner is the logo, pre-paint zero flash)', async () => {
  await fetch(`${base}/api/settings/logo`, { method: 'DELETE' });
  await fetch(`${base}/api/settings/logo?variant=dark`, { method: 'DELETE' });
  for (const p of SHELL_PATHS) {
    const res = await fetch(`${base}${p}`);
    assert.equal(res.status, 200, `${p} serves`);
    const htmlTag = /<html\b[^>]*>/i.exec(await res.text())[0];
    assert.match(htmlTag, /\bft-custom-logo\b/, `${p} must carry ft-custom-logo even with no upload (default banner) (${htmlTag})`);
    assert.match(htmlTag, /lang="en"/, `${p} must keep lang="en" alongside the injected class`);
  }
});

test('v1.89: the class stays baked in after an UPLOAD too (upload overrides the default banner, same pre-paint hide)', async () => {
  const post = await fetch(`${base}/api/settings/logo`, {
    method: 'POST', headers: { 'Content-Type': 'image/png' }, body: TINY_PNG,
  });
  assert.equal(post.status, 200);
  for (const p of SHELL_PATHS) {
    const htmlTag = /<html\b[^>]*>/i.exec(await (await fetch(`${base}${p}`)).text())[0];
    assert.match(htmlTag, /\bft-custom-logo\b/, `${p} must carry ft-custom-logo with an upload (${htmlTag})`);
  }
});

test('v1.89: the class is NOT withdrawn after DELETE (reverts to the default banner, never back to the text wordmark)', async () => {
  await fetch(`${base}/api/settings/logo`, { method: 'DELETE' });
  const htmlTag = /<html\b[^>]*>/i.exec(await (await fetch(`${base}/`)).text())[0];
  assert.match(htmlTag, /\bft-custom-logo\b/, 'a deleted upload reverts to the default banner, so the class stays baked in');
});
