#!/usr/bin/env node
'use strict';

// v1.15.0 item 8 -- generate PWA home-screen icon PNGs with NO new
// dependency: `node:zlib` (deflate) + `node:fs` only. Hand-builds minimal PNG
// chunks (IHDR/IDAT/IEND, each with its own CRC32) over a directly-rendered
// RGBA pixel buffer: a rounded brand-red field (matching public/favicon.svg's
// #cc0000) with the same white play-triangle, 4x4-supersampled
// (premultiplied-alpha averaged) for clean edges without a canvas/image
// library.
//
// Run manually to (re)generate the committed assets:
//   node scripts/generate-pwa-icons.js
// (Not part of the build/test pipeline -- the PNGs it writes to
// public/icons/ are committed as static assets, like any other pre-built
// asset in this repo.)

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT_DIR = path.join(__dirname, '..', 'public', 'icons');
const SIZES = [192, 512];

const RED = [0xcc, 0x00, 0x00];
const WHITE = [0xff, 0xff, 0xff];

// The exact triangle from public/favicon.svg's 512-viewBox path
// (`M200 150 L200 362 L370 256 Z`), expressed as fractions of the icon size
// so it scales cleanly to any output dimension.
const TRIANGLE_FRAC = [
  [200 / 512, 150 / 512],
  [200 / 512, 362 / 512],
  [370 / 512, 256 / 512],
];

const SUPERSAMPLE = 4; // 4x4 = 16 samples/pixel for anti-aliased edges

// ---------------------------------------------------------------------------
// PNG chunk plumbing (node:zlib only -- no image library)
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

// Builds a full 8-bit RGBA (color type 6), non-interlaced PNG from a flat
// RGBA pixel buffer (width*height*4 bytes). Each scanline is written with an
// explicit "None" filter-type byte (0), per the PNG spec, so the reconstructed
// raw stream is just [filterByte, R,G,B,A, R,G,B,A, ...] per row.
function buildPng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: truecolor + alpha (RGBA)
  ihdr[10] = 0; // compression method (deflate, the only defined value)
  ihdr[11] = 0; // filter method (adaptive filtering, "None" used per-row here)
  ihdr[12] = 0; // interlace method (none)

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter type: None
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idatData = zlib.deflateSync(raw);

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', idatData),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Pixel rendering: rounded-rect field + triangle, supersampled for AA
// ---------------------------------------------------------------------------

// Rounded-box signed-distance test (Inigo Quilez's formulation): returns true
// when (x, y) falls inside a `size`x`size` square with corner radius `r`.
function insideRoundedSquare(x, y, size, r) {
  const half = size / 2;
  const dx = Math.abs(x - half) - (half - r);
  const dy = Math.abs(y - half) - (half - r);
  const ax = Math.max(dx, 0);
  const ay = Math.max(dy, 0);
  const dist = Math.sqrt(ax * ax + ay * ay) + Math.min(Math.max(dx, dy), 0);
  return dist <= r;
}

// Standard sign-of-cross-products point-in-triangle test.
function insideTriangle(px, py, [ax, ay], [bx, by], [cx, cy]) {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

// Renders one size to a flat RGBA buffer. Each output pixel is
// 4x4-supersampled; the final color/alpha is a premultiplied-alpha average of
// the sub-samples (color averaged over only the "inside" sub-samples, alpha
// as the inside-sample coverage ratio) so both the rounded-corner cutoff and
// the red/white triangle edge get clean anti-aliasing without any color
// fringing.
function renderIcon(size) {
  const radius = size * 0.18;
  const triangle = TRIANGLE_FRAC.map(([fx, fy]) => [fx * size, fy * size]);
  const rgba = Buffer.alloc(size * size * 4);
  const step = 1 / SUPERSAMPLE;
  const totalSamples = SUPERSAMPLE * SUPERSAMPLE;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sumR = 0, sumG = 0, sumB = 0, insideCount = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const px = x + (sx + 0.5) * step;
          const py = y + (sy + 0.5) * step;
          if (!insideRoundedSquare(px, py, size, radius)) continue; // transparent
          insideCount++;
          const [cr, cg, cb] = insideTriangle(px, py, triangle[0], triangle[1], triangle[2]) ? WHITE : RED;
          sumR += cr; sumG += cg; sumB += cb;
        }
      }
      const idx = (y * size + x) * 4;
      const alpha = Math.round((insideCount / totalSamples) * 255);
      if (insideCount > 0) {
        rgba[idx] = Math.round(sumR / insideCount);
        rgba[idx + 1] = Math.round(sumG / insideCount);
        rgba[idx + 2] = Math.round(sumB / insideCount);
      }
      rgba[idx + 3] = alpha;
    }
  }
  return rgba;
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const size of SIZES) {
    const rgba = renderIcon(size);
    const png = buildPng(size, size, rgba);
    const outPath = path.join(OUT_DIR, `icon-${size}.png`);
    fs.writeFileSync(outPath, png);
    console.log(`Wrote ${outPath} (${png.length} bytes)`);
  }
}

module.exports = {
  crc32,
  chunk,
  buildPng,
  insideRoundedSquare,
  insideTriangle,
  renderIcon,
  PNG_SIGNATURE,
  SIZES,
};

if (require.main === module) {
  main();
}
