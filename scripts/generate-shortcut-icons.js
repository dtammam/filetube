#!/usr/bin/env node
'use strict';

// v1.352 L2: the 96x96 PNG the manifest's app-icon shortcuts use, made from the COMMITTED
// public/icons/icon-192.png (a 2:1 box downscale in premultiplied alpha), so it always matches the
// installed app icon. No new dependency: node:zlib + the PNG writer in generate-pwa-icons.js.
// (generate-pwa-icons.js itself no longer reproduces the committed 192/512 files byte for byte, so
// re-running it would restyle them; this script only writes icon-96.png.)
//
//   node scripts/generate-shortcut-icons.js

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { buildPng } = require('./generate-pwa-icons');

const ICONS = path.join(__dirname, '..', 'public', 'icons');
const SHORTCUT_SIZE = 96;

// An 8-bit RGBA, non-interlaced PNG -> { width, height, rgba }. Throws on any other shape.
function decodeRgbaPng(buf) {
  let o = 8;
  let width = 0;
  let height = 0;
  const idat = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o);
    const type = buf.slice(o + 4, o + 8).toString('ascii');
    const data = buf.slice(o + 8, o + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 6 || data[12] !== 0) throw new Error('decodeRgbaPng: only 8-bit RGBA, non-interlaced');
    } else if (type === 'IDAT') idat.push(data);
    o += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const rgba = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const row = raw.slice(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? rgba[y * stride + i - 4] : 0;
      const b = y > 0 ? rgba[(y - 1) * stride + i] : 0;
      const c = i >= 4 && y > 0 ? rgba[(y - 1) * stride + i - 4] : 0;
      let v = row[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += Math.floor((a + b) / 2);
      else if (f === 4) { const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c); v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c); }
      else if (f !== 0) throw new Error('decodeRgbaPng: bad filter ' + f);
      rgba[y * stride + i] = v & 0xff;
    }
  }
  return { width, height, rgba };
}

// 2:1 box downscale, averaging in premultiplied alpha (clean edges, no dark fringe).
function halve({ width, height, rgba }) {
  const w = width >> 1;
  const h = height >> 1;
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const i = ((2 * y + dy) * width + (2 * x + dx)) * 4;
        const al = rgba[i + 3];
        r += rgba[i] * al; g += rgba[i + 1] * al; b += rgba[i + 2] * al; a += al;
      }
      const j = (y * w + x) * 4;
      if (a > 0) { out[j] = Math.round(r / a); out[j + 1] = Math.round(g / a); out[j + 2] = Math.round(b / a); }
      out[j + 3] = Math.round(a / 4);
    }
  }
  return { width: w, height: h, rgba: out };
}

function main() {
  const src = decodeRgbaPng(fs.readFileSync(path.join(ICONS, 'icon-192.png')));
  const small = halve(src);
  if (small.width !== SHORTCUT_SIZE) throw new Error('expected ' + SHORTCUT_SIZE + ', got ' + small.width);
  const png = buildPng(small.width, small.height, small.rgba);
  const out = path.join(ICONS, 'icon-96.png');
  fs.writeFileSync(out, png);
  console.log(`Wrote ${out} (${png.length} bytes)`);
}

module.exports = { decodeRgbaPng, halve, SHORTCUT_SIZE };

if (require.main === module) main();
