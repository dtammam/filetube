#!/usr/bin/env node
'use strict';
// Stop B compare mode: pixel-diff two capture directories by scene filename.
// Dependency-free (tools/capture/png.js). Antialiasing tolerance: a pixel
// counts as changed only when a channel differs by > threshold (default 16)
// AND it is not an isolated single-pixel change (its 4-neighborhood contains
// another changed pixel) - the standard cheap AA suppressor. Emits
// report.json + report.md ranked by diff magnitude, plus a side-by-side
// crop PNG around the densest diff cluster per changed scene. Expectations
// reconcile against the Step 3 expected-delta ledgers at Stop B.
const fs = require('node:fs');
const path = require('node:path');
const { decode, encode } = require('./png.js');

function diffPair(aBuf, bBuf, threshold) {
  const A = decode(aBuf); const B = decode(bBuf);
  if (A.width !== B.width || A.height !== B.height) {
    return { changed: -1, pct: 100, note: `size mismatch ${A.width}x${A.height} vs ${B.width}x${B.height}`, A, B };
  }
  const w = A.width; const h = A.height;
  const hot = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    if (Math.abs(A.data[o] - B.data[o]) > threshold ||
        Math.abs(A.data[o + 1] - B.data[o + 1]) > threshold ||
        Math.abs(A.data[o + 2] - B.data[o + 2]) > threshold) hot[i] = 1;
  }
  // AA suppression: keep only hot pixels with a hot 4-neighbor
  let changed = 0; let cx = 0; let cy = 0;
  const kept = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!hot[i]) continue;
      if ((x > 0 && hot[i - 1]) || (x < w - 1 && hot[i + 1]) ||
          (y > 0 && hot[i - w]) || (y < h - 1 && hot[i + w])) {
        kept[i] = 1; changed++; cx += x; cy += y;
      }
    }
  }
  return { changed, pct: (changed / (w * h)) * 100, A, B, kept,
    center: changed ? { x: Math.round(cx / changed), y: Math.round(cy / changed) } : null };
}

function crop(img, cx, cy, size) {
  const half = size >> 1;
  const x0 = Math.max(0, Math.min(img.width - size, cx - half));
  const y0 = Math.max(0, Math.min(img.height - size, cy - half));
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    img.data.copy(out, y * size * 4, ((y0 + y) * img.width + x0) * 4, ((y0 + y) * img.width + x0 + size) * 4);
  }
  return { width: size, height: size, data: out };
}

function sideBySide(a, b) {
  const gap = 8; const w = a.width + gap + b.width; const h = Math.max(a.height, b.height);
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    if (y < a.height) a.data.copy(out, y * w * 4, y * a.width * 4, (y + 1) * a.width * 4);
    for (let g = 0; g < gap; g++) out.writeUInt32BE(0xff00ffff, (y * w + a.width + g) * 4);
    if (y < b.height) b.data.copy(out, (y * w + a.width + gap) * 4, y * b.width * 4, (y + 1) * b.width * 4);
  }
  return { width: w, height: h, data: out };
}

function compareDirs(dirA, dirB, outDir, threshold = 16, cropSize = 320) {
  fs.mkdirSync(outDir, { recursive: true });
  const scenes = fs.readdirSync(dirA).filter((f) => f.endsWith('.png'));
  const results = [];
  for (const f of scenes) {
    const bPath = path.join(dirB, f);
    if (!fs.existsSync(bPath)) { results.push({ scene: f, changed: -1, note: 'missing in B' }); continue; }
    const r = diffPair(fs.readFileSync(path.join(dirA, f)), fs.readFileSync(bPath), threshold);
    const row = { scene: f, changed: r.changed, pct: Number((r.pct || 0).toFixed(4)), note: r.note || '' };
    if (r.changed > 0 && r.center) {
      const sbs = sideBySide(crop(r.A, r.center.x, r.center.y, cropSize), crop(r.B, r.center.x, r.center.y, cropSize));
      fs.writeFileSync(path.join(outDir, f.replace('.png', '.sbs.png')), encode(sbs));
      row.crop = f.replace('.png', '.sbs.png');
    }
    results.push(row);
  }
  const missing = fs.readdirSync(dirB).filter((f) => f.endsWith('.png') && !fs.existsSync(path.join(dirA, f)))
    .map((f) => ({ scene: f, changed: -1, note: 'missing in A' }));
  const all = results.concat(missing).sort((a, b) => (b.changed - a.changed));
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ threshold, results: all }, null, 1));
  const md = ['# Capture comparison', `threshold=${threshold} (channel delta), AA-suppressed`, '',
    '| scene | changed px | % | note |', '|---|---|---|---|',
    ...all.map((r) => `| ${r.scene} | ${r.changed} | ${r.pct ?? ''} | ${r.note || (r.crop ? `crop: ${r.crop}` : '')} |`)];
  fs.writeFileSync(path.join(outDir, 'report.md'), md.join('\n'));
  return all;
}

module.exports = { diffPair, compareDirs, crop, sideBySide };

if (require.main === module) {
  const [, , a, b, out] = process.argv;
  if (!a || !b) { console.error('usage: compare.js <dirA> <dirB> [outDir]'); process.exit(2); }
  const res = compareDirs(a, b, out || `compare-${Date.now()}`);
  const changed = res.filter((r) => r.changed !== 0);
  console.log(`${res.length} scenes, ${changed.length} with differences`);
  for (const r of changed.slice(0, 30)) console.log(`  ${r.scene}  ${r.changed} px (${r.pct}%) ${r.note}`);
  process.exit(0);
}
