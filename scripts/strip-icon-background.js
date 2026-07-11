#!/usr/bin/env node
'use strict';

// v1.28.1 -- one-shot regeneration of the committed icon assets with a
// TRANSPARENT background, from the glossy raster art that currently ships
// with a baked-in opaque white field (Dean's report: the white box shows in
// browser tabs / dark UIs).
//
// WHY A RASTER TRANSFORM (and not a re-render): the glossy play-button art
// exists ONLY as a white-backed 512px PNG embedded inside public/favicon.svg
// (which is an <svg><image href="data:image/png..."></svg> wrapper, not real
// vector). assets/images/filetube_icon.svg and generate-pwa-icons.js are the
// OLD flat design -- running that generator would CLOBBER the glossy art, so
// this script deliberately does not touch it.
//
// TECHNIQUE: edge-connected flood fill. The white background touches the
// image border; the white page glyph in the middle of the button is fully
// enclosed by red, so it can never be reached by the fill and survives
// intact. Pixels adjacent to the removed region are then UN-COMPOSITED from
// white (observed = true*a + 255*(1-a); for red edges and gray shadows,
// a = 1 - min(g,b)/255 recovers both the alpha and the true color), so the
// anti-aliased rim doesn't keep a white halo on dark tabs.
//
// OUTPUTS (all committed static assets, like generate-pwa-icons.js's):
//   public/icons/apple-touch-icon.png  -- the ORIGINAL white-backed 192 art,
//                                         preserved: iOS home-screen icons do
//                                         not support transparency (iOS would
//                                         composite onto BLACK), so the
//                                         apple-touch-icon keeps its opaque
//                                         white field on purpose.
//   public/icons/icon-512.png          -- transparent
//   public/icons/icon-192.png          -- transparent (downscaled from 512)
//   public/favicon.svg                 -- same wrapper, transparent PNG inside
//   public/favicon.ico                 -- 16/32/48 32bpp BMP entries with a
//                                         real alpha channel (same structure
//                                         the pwa-icons tests lock)
//
// Run manually: node scripts/strip-icon-background.js
// Idempotent: transparent pixels count as background for the flood fill, and
// apple-touch-icon.png is only created from icon-192.png when it does not
// exist yet (so a re-run can never capture an already-transparent 192).

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { buildPng, PNG_SIGNATURE } = require('./generate-pwa-icons');

const ROOT = path.join(__dirname, '..');
const ICONS_DIR = path.join(ROOT, 'public', 'icons');
const FAVICON_SVG = path.join(ROOT, 'public', 'favicon.svg');
const FAVICON_ICO = path.join(ROOT, 'public', 'favicon.ico');

// ---------------------------------------------------------------------------
// Minimal PNG decoder (non-interlaced 8-bit RGB/RGBA -- exactly what our own
// assets are; anything else is rejected loudly rather than mis-decoded).
// ---------------------------------------------------------------------------

function decodePng(buf) {
  if (!buf.slice(0, 8).equals(PNG_SIGNATURE)) throw new Error('not a PNG');
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const depth = buf[24];
  const ctype = buf[25];
  const interlace = buf[28];
  if (depth !== 8 || interlace !== 0 || (ctype !== 6 && ctype !== 2)) {
    throw new Error(`unsupported PNG shape (depth=${depth} ctype=${ctype} interlace=${interlace})`);
  }
  const bpp = ctype === 6 ? 4 : 3;
  const idat = [];
  let off = 8;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.slice(off + 4, off + 8).toString('ascii');
    if (type === 'IDAT') idat.push(buf.slice(off + 8, off + 8 + len));
    if (type === 'IEND') break;
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * bpp + 1;
  const rgba = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(width * bpp);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * stride];
    const row = Buffer.from(raw.slice(y * stride + 1, (y + 1) * stride));
    for (let x = 0; x < row.length; x++) {
      const a = x >= bpp ? row[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      if (filter === 1) row[x] = (row[x] + a) & 255;
      else if (filter === 2) row[x] = (row[x] + b) & 255;
      else if (filter === 3) row[x] = (row[x] + ((a + b) >> 1)) & 255;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        row[x] = (row[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
      // filter 0: verbatim
    }
    for (let px = 0; px < width; px++) {
      const s = px * bpp;
      const d = (y * width + px) * 4;
      rgba[d] = row[s];
      rgba[d + 1] = row[s + 1];
      rgba[d + 2] = row[s + 2];
      rgba[d + 3] = bpp === 4 ? row[s + 3] : 255;
    }
    prev = row;
  }
  return { width, height, rgba };
}

// ---------------------------------------------------------------------------
// Background removal: edge-connected flood fill + rim un-compositing.
// ---------------------------------------------------------------------------

const WHITE_MIN = 245; // min(r,g,b) >= this counts as background white for the fill

function stripBackground({ width, height, rgba }) {
  const isBgColor = (i) =>
    rgba[i + 3] < 16 || // idempotency: already-transparent counts as background
    (rgba[i] >= WHITE_MIN && rgba[i + 1] >= WHITE_MIN && rgba[i + 2] >= WHITE_MIN);

  const bg = new Uint8Array(width * height);
  const queue = [];
  const push = (x, y) => {
    const p = y * width + x;
    if (bg[p]) return;
    if (!isBgColor(p * 4)) return;
    bg[p] = 1;
    queue.push(p);
  };
  for (let x = 0; x < width; x++) { push(x, 0); push(x, height - 1); }
  for (let y = 0; y < height; y++) { push(0, y); push(width - 1, y); }
  while (queue.length) {
    const p = queue.pop();
    const x = p % width, y = (p / width) | 0;
    if (x > 0) push(x - 1, y);
    if (x < width - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < height - 1) push(x, y + 1);
  }

  // Rim band: any non-background pixel within 2px (chebyshev) of the fill.
  const rim = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (bg[p]) continue;
      let near = false;
      for (let dy = -2; dy <= 2 && !near; dy++) {
        for (let dx = -2; dx <= 2 && !near; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height && bg[ny * width + nx]) near = true;
        }
      }
      if (near) rim[p] = 1;
    }
  }

  let cleared = 0, unmixed = 0;
  for (let p = 0; p < width * height; p++) {
    const i = p * 4;
    if (bg[p]) {
      rgba[i] = rgba[i + 1] = rgba[i + 2] = rgba[i + 3] = 0;
      cleared++;
    } else if (rim[p]) {
      // Un-composite from white. The art's edge colors are red (#cc0000-ish,
      // g/b near 0) or neutral gray shadow (r=g=b): in both cases the smaller
      // of g/b tracks how much WHITE was mixed in, so a = 1 - min(g,b)/255.
      const g = rgba[i + 1], b = rgba[i + 2];
      const whiteMix = Math.min(g, b) / 255;
      if (whiteMix <= 0.05) { unmixed += 0; continue; } // effectively pure art color already
      const a = Math.max(0, Math.min(1, 1 - whiteMix));
      if (a < 0.02) { // indistinguishable from background -- clear it
        rgba[i] = rgba[i + 1] = rgba[i + 2] = rgba[i + 3] = 0;
        cleared++;
        continue;
      }
      for (let ch = 0; ch < 3; ch++) {
        rgba[i + ch] = Math.max(0, Math.min(255, Math.round((rgba[i + ch] - 255 * (1 - a)) / a)));
      }
      rgba[i + 3] = Math.round(rgba[i + 3] * a);
      unmixed++;
    }
  }
  return { cleared, unmixed };
}

// ---------------------------------------------------------------------------
// Box downscale on premultiplied alpha (exact integer ratios only: 512 -> 192
// uses a 512-wide accumulator instead, so accept any target evenly coverable
// by area sampling).
// ---------------------------------------------------------------------------

function downscale(src, srcSize, dstSize) {
  const dst = Buffer.alloc(dstSize * dstSize * 4);
  const ratio = srcSize / dstSize;
  for (let dy = 0; dy < dstSize; dy++) {
    for (let dx = 0; dx < dstSize; dx++) {
      const x0 = dx * ratio, x1 = (dx + 1) * ratio;
      const y0 = dy * ratio, y1 = (dy + 1) * ratio;
      let r = 0, g = 0, b = 0, a = 0, area = 0;
      for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy++) {
        const hy = Math.min(sy + 1, y1) - Math.max(sy, y0);
        for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx++) {
          const wx = Math.min(sx + 1, x1) - Math.max(sx, x0);
          const w = hy * wx;
          const i = (sy * srcSize + sx) * 4;
          const pa = src[i + 3] / 255;
          r += src[i] * pa * w;
          g += src[i + 1] * pa * w;
          b += src[i + 2] * pa * w;
          a += pa * w;
          area += w;
        }
      }
      const d = (dy * dstSize + dx) * 4;
      const outA = a / area;
      if (outA > 0) {
        dst[d] = Math.round(Math.min(255, r / area / outA));
        dst[d + 1] = Math.round(Math.min(255, g / area / outA));
        dst[d + 2] = Math.round(Math.min(255, b / area / outA));
      }
      dst[d + 3] = Math.round(Math.min(255, outA * 255));
    }
  }
  return dst;
}

// ---------------------------------------------------------------------------
// ICO builder: 32bpp BMP entries (BITMAPINFOHEADER + bottom-up BGRA + 1bpp
// AND mask) -- the same structure the previous favicon.ico used and the
// pwa-icons tests lock (biSize=40, bitCount=32), now with real alpha.
// ---------------------------------------------------------------------------

function buildIcoBmpEntry(rgba, size) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);            // biSize
  header.writeInt32LE(size, 4);           // biWidth
  header.writeInt32LE(size * 2, 8);       // biHeight = XOR + AND
  header.writeUInt16LE(1, 12);            // biPlanes
  header.writeUInt16LE(32, 14);           // biBitCount
  const xor = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const s = ((size - 1 - y) * size + x) * 4; // bottom-up
      const d = (y * size + x) * 4;
      xor[d] = rgba[s + 2];     // B
      xor[d + 1] = rgba[s + 1]; // G
      xor[d + 2] = rgba[s];     // R
      xor[d + 3] = rgba[s + 3]; // A
    }
  }
  const maskStride = Math.ceil(size / 32) * 4;
  const mask = Buffer.alloc(maskStride * size); // all zeros: alpha channel governs
  return Buffer.concat([header, xor, mask]);
}

function buildIco(entries) {
  const count = entries.length;
  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(0, 0);
  dir.writeUInt16LE(1, 2);
  dir.writeUInt16LE(count, 4);
  const dirEntries = [];
  const blobs = [];
  let offset = 6 + count * 16;
  for (const { size, data } of entries) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size === 256 ? 0 : size, 0);
    e.writeUInt8(size === 256 ? 0 : size, 1);
    e.writeUInt8(0, 2);  // palette
    e.writeUInt8(0, 3);  // reserved
    e.writeUInt16LE(1, 4);  // planes
    e.writeUInt16LE(32, 6); // bpp
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    dirEntries.push(e);
    blobs.push(data);
  }
  return Buffer.concat([dir, ...dirEntries, ...blobs]);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  // 1. Preserve the ORIGINAL opaque 192 art as the apple-touch-icon before
  //    anything is overwritten (iOS composites transparency onto black).
  const appleTouchPath = path.join(ICONS_DIR, 'apple-touch-icon.png');
  if (!fs.existsSync(appleTouchPath)) {
    fs.copyFileSync(path.join(ICONS_DIR, 'icon-192.png'), appleTouchPath);
    console.log('wrote icons/apple-touch-icon.png (preserved opaque art)');
  } else {
    console.log('icons/apple-touch-icon.png already exists -- left untouched');
  }

  // 2. Master art = the 512px PNG inside favicon.svg (highest-fidelity copy).
  const svg = fs.readFileSync(FAVICON_SVG, 'utf8');
  const m = /href="data:image\/png;base64,([^"]+)"/.exec(svg);
  if (!m) throw new Error('favicon.svg: no embedded base64 PNG found');
  const master = decodePng(Buffer.from(m[1], 'base64'));
  if (master.width !== 512 || master.height !== 512) {
    throw new Error(`expected a 512x512 master, got ${master.width}x${master.height}`);
  }

  // 3. Strip the background.
  const stats = stripBackground(master);
  console.log(`background removed: ${stats.cleared} px cleared, ${stats.unmixed} rim px un-composited`);

  // 4. Regenerate every transparent asset from the one master.
  const png512 = buildPng(512, 512, master.rgba);
  fs.writeFileSync(path.join(ICONS_DIR, 'icon-512.png'), png512);
  fs.writeFileSync(
    path.join(ICONS_DIR, 'icon-192.png'),
    buildPng(192, 192, downscale(master.rgba, 512, 192))
  );
  fs.writeFileSync(FAVICON_SVG, svg.replace(m[1], png512.toString('base64')));
  const ico = buildIco([48, 32, 16].map((size) => ({
    size,
    data: buildIcoBmpEntry(downscale(master.rgba, 512, size), size),
  })));
  fs.writeFileSync(FAVICON_ICO, ico);
  console.log('wrote icons/icon-512.png, icons/icon-192.png, favicon.svg, favicon.ico');
}

if (require.main === module) main();

module.exports = { decodePng, stripBackground, downscale, buildIcoBmpEntry, buildIco, WHITE_MIN };
