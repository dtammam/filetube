'use strict';

// [UNIT] v1.15.0 item 8 -- PWA home-screen icon PNGs, generated with NO new
// dependency by scripts/generate-pwa-icons.js (node:zlib + node:fs only).
// Covers: the hand-rolled PNG-chunk plumbing (CRC32 against a known-good PNG
// constant, chunk framing), the pure geometry helpers (rounded-rect + point-
// in-triangle), and that the committed public/icons/*.png assets are
// structurally valid PNGs wired into the manifest + apple-touch-icon links.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const {
  crc32,
  chunk,
  buildPng,
  insideRoundedSquare,
  insideTriangle,
  renderIcon,
  PNG_SIGNATURE,
  SIZES,
} = require('../../scripts/generate-pwa-icons');

// ---- crc32 (PNG-spec CRC32, polynomial 0xEDB88320) ----

test('crc32: matches the well-known CRC of an empty IEND chunk (0xAE426082)', () => {
  // Every valid PNG ends in the exact 12-byte sequence
  // `00 00 00 00 49 45 4E 44 AE 42 60 82` (a zero-length IEND chunk) -- this
  // is a widely-published reference CRC, so matching it is strong evidence
  // the CRC32 table/algorithm here is spec-correct.
  assert.equal(crc32(Buffer.from('IEND', 'ascii')), 0xae426082);
});

test('crc32: is deterministic and sensitive to its input', () => {
  const a = crc32(Buffer.from('hello'));
  const b = crc32(Buffer.from('hello'));
  const c = crc32(Buffer.from('hellp'));
  assert.equal(a, b);
  assert.notEqual(a, c);
});

// ---- chunk / buildPng framing ----

test('chunk: frames length (BE) + type + data + a trailing CRC32 of type+data', () => {
  const data = Buffer.from([1, 2, 3]);
  const c = chunk('tEST', data);
  assert.equal(c.readUInt32BE(0), data.length);
  assert.equal(c.slice(4, 8).toString('ascii'), 'tEST');
  assert.deepEqual(c.slice(8, 11), data);
  const expectedCrc = crc32(Buffer.concat([Buffer.from('tEST', 'ascii'), data]));
  assert.equal(c.readUInt32BE(11), expectedCrc);
});

test('buildPng: emits the PNG signature, a correctly-shaped IHDR, and an inflatable IDAT matching width*height*4 RGBA bytes (+1 filter byte/row)', () => {
  const width = 4, height = 3;
  const rgba = Buffer.alloc(width * height * 4, 0x80);
  const png = buildPng(width, height, rgba);

  assert.deepEqual(png.slice(0, 8), PNG_SIGNATURE);

  // IHDR immediately follows the signature: length(4) + 'IHDR' + 13 data bytes + crc(4)
  const ihdrLen = png.readUInt32BE(8);
  assert.equal(ihdrLen, 13);
  assert.equal(png.slice(12, 16).toString('ascii'), 'IHDR');
  const ihdrData = png.slice(16, 16 + 13);
  assert.equal(ihdrData.readUInt32BE(0), width);
  assert.equal(ihdrData.readUInt32BE(4), height);
  assert.equal(ihdrData[8], 8); // bit depth
  assert.equal(ihdrData[9], 6); // color type: RGBA

  // Locate + inflate the IDAT chunk generically rather than assuming a fixed offset.
  const idatTypeIdx = png.indexOf('IDAT', 0, 'ascii');
  assert.ok(idatTypeIdx > 0, 'expected an IDAT chunk');
  const idatLen = png.readUInt32BE(idatTypeIdx - 4);
  const idatData = png.slice(idatTypeIdx + 4, idatTypeIdx + 4 + idatLen);
  const raw = zlib.inflateSync(idatData);
  assert.equal(raw.length, (width * 4 + 1) * height, 'raw scanline data must be (stride+1 filter byte) * height');

  // The PNG must end in the exact well-known empty-IEND tail.
  assert.deepEqual(png.slice(-12), Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]));
});

// ---- geometry helpers ----

test('insideRoundedSquare: the exact corner pixel is outside the rounded field (gets cut/transparent)', () => {
  assert.equal(insideRoundedSquare(2, 2, 192, 192 * 0.18), false);
});

test('insideRoundedSquare: the middle of a straight edge (not near a corner) is inside', () => {
  assert.equal(insideRoundedSquare(96, 2, 192, 192 * 0.18), true);
});

test('insideRoundedSquare: the center of the square is always inside', () => {
  assert.equal(insideRoundedSquare(96, 96, 192, 192 * 0.18), true);
});

test('insideTriangle: the icon center falls inside the play-triangle (matches favicon.svg geometry)', () => {
  // Same triangle as public/favicon.svg's 512-viewBox path, scaled to a
  // 192-size icon: (200,150)->(75,56.25), (200,362)->(75,135.75), (370,256)->(138.75,96).
  const a = [75, 56.25], b = [75, 135.75], c = [138.75, 96];
  assert.equal(insideTriangle(96, 96, a, b, c), true);
});

test('insideTriangle: a point outside the triangle (top-left background corner) is false', () => {
  const a = [75, 56.25], b = [75, 135.75], c = [138.75, 96];
  assert.equal(insideTriangle(10, 10, a, b, c), false);
});

// ---- renderIcon (pure pixel buffer) ----

test('renderIcon: the corner pixel is fully transparent and the center pixel is fully opaque white', () => {
  const size = 64;
  const rgba = renderIcon(size);
  const cornerIdx = (0 * size + 0) * 4;
  assert.equal(rgba[cornerIdx + 3], 0, 'corner alpha should be 0 (fully cut by the rounded field)');

  const center = Math.floor(size / 2);
  const centerIdx = (center * size + center) * 4;
  assert.equal(rgba[centerIdx + 3], 255, 'center should be fully opaque');
  assert.equal(rgba[centerIdx], 255);
  assert.equal(rgba[centerIdx + 1], 255);
  assert.equal(rgba[centerIdx + 2], 255);
});

// ---- committed assets (public/icons/*.png) ----

const ICONS_DIR = path.join(__dirname, '..', '..', 'public', 'icons');

test('committed PNGs: icon-192.png and icon-512.png exist and are valid PNGs of the right dimensions', () => {
  for (const size of SIZES) {
    const p = path.join(ICONS_DIR, `icon-${size}.png`);
    assert.ok(fs.existsSync(p), `expected ${p} to exist`);
    const buf = fs.readFileSync(p);
    assert.deepEqual(buf.slice(0, 8), PNG_SIGNATURE);
    const ihdrData = buf.slice(16, 16 + 13);
    assert.equal(ihdrData.readUInt32BE(0), size);
    assert.equal(ihdrData.readUInt32BE(4), size);
    assert.equal(ihdrData[9], 6, 'expected RGBA color type');
  }
});

// ---- manifest / apple-touch-icon wiring ----

test('manifest.webmanifest declares both PNG icon sizes alongside the existing SVG entry', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'manifest.webmanifest'), 'utf8'));
  const srcs = manifest.icons.map((i) => i.src);
  assert.ok(srcs.includes('/favicon.svg'), 'the SVG icon entry must remain');
  assert.ok(srcs.includes('/icons/icon-192.png'));
  assert.ok(srcs.includes('/icons/icon-512.png'));
  const png192 = manifest.icons.find((i) => i.src === '/icons/icon-192.png');
  assert.equal(png192.sizes, '192x192');
  assert.equal(png192.type, 'image/png');
});

test('every page that ships a manifest link also points apple-touch-icon at the 192px PNG', () => {
  const pages = [
    path.join(__dirname, '..', '..', 'public', 'index.html'),
    path.join(__dirname, '..', '..', 'public', 'watch.html'),
    path.join(__dirname, '..', '..', 'public', 'setup.html'),
    path.join(__dirname, '..', '..', 'lib', 'ytdlp', 'views', 'subscriptions.html'),
  ];
  for (const p of pages) {
    const html = fs.readFileSync(p, 'utf8');
    assert.match(html, /<link rel="apple-touch-icon" href="\/icons\/icon-192\.png">/, `${p} should use the PNG apple-touch-icon`);
  }
});

// ---- FR-2 (v1.22.2): raster favicon fallback (tab vs. bookmark parity) ----

test('every page ships PNG rel="icon" fallbacks (192 and 512) alongside the SVG favicon', () => {
  const pages = [
    path.join(__dirname, '..', '..', 'public', 'index.html'),
    path.join(__dirname, '..', '..', 'public', 'watch.html'),
    path.join(__dirname, '..', '..', 'public', 'setup.html'),
    path.join(__dirname, '..', '..', 'lib', 'ytdlp', 'views', 'subscriptions.html'),
  ];
  for (const p of pages) {
    const html = fs.readFileSync(p, 'utf8');
    assert.match(
      html,
      /<link rel="icon" type="image\/svg\+xml" href="\/favicon\.svg">/,
      `${p} should keep the existing SVG favicon link`
    );
    assert.match(
      html,
      /<link rel="icon" type="image\/png" sizes="192x192" href="\/icons\/icon-192\.png">/,
      `${p} should add a 192px PNG rel="icon" fallback`
    );
    assert.match(
      html,
      /<link rel="icon" type="image\/png" sizes="512x512" href="\/icons\/icon-512\.png">/,
      `${p} should add a 512px PNG rel="icon" fallback`
    );
  }
});

test('the four shells\' icon <link> blocks (SVG + PNG fallbacks + apple-touch-icon + manifest) are byte-identical', () => {
  const pages = [
    path.join(__dirname, '..', '..', 'public', 'index.html'),
    path.join(__dirname, '..', '..', 'public', 'watch.html'),
    path.join(__dirname, '..', '..', 'public', 'setup.html'),
    path.join(__dirname, '..', '..', 'lib', 'ytdlp', 'views', 'subscriptions.html'),
  ];
  const extractIconBlock = (html) => {
    const start = html.indexOf('<link rel="icon"');
    const end = html.indexOf('<link rel="manifest"');
    assert.ok(start !== -1 && end !== -1 && end > start, 'expected an icon block followed by a manifest link');
    return html.slice(start, end);
  };
  const [first, ...rest] = pages.map((p) => extractIconBlock(fs.readFileSync(p, 'utf8')));
  for (let i = 0; i < rest.length; i += 1) {
    assert.equal(rest[i], first, `${pages[i + 1]} icon block should be byte-identical to ${pages[0]}`);
  }
});
