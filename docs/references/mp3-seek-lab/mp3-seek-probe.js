#!/usr/bin/env node
// mp3-seek-probe: does this MP3 give a byte-estimating player (iOS AVFoundation) an
// accurate seek? Walks every frame for the TRUE byte->time map, then asks where a seek
// to each target second lands under the estimators a player without a full frame index
// uses: the Xing TOC (100 points), the average bitrate, and the first frame's bitrate.
// Usage: node mp3-seek-probe.js file.mp3 [m:ss | seconds ...]   (no deps, read-only)
'use strict';
const fs = require('fs');
const file = process.argv[2];
if (!file) { console.error('usage: node mp3-seek-probe.js file.mp3 [m:ss ...]'); process.exit(2); }
const buf = fs.readFileSync(file);
const parseT = s => s.includes(':') ? s.split(':').reduce((a, v) => a * 60 + Number(v), 0) : Number(s);
const fmt = t => (t < 0 ? '-' : '') + Math.floor(Math.abs(t) / 60) + ':' + (Math.abs(t) % 60).toFixed(2).padStart(5, '0');

// ---- ID3v2 (maybe several) + embedded CHAP frames
let pos = 0; const chaps = [];
while (buf.toString('latin1', pos, pos + 3) === 'ID3') {
  const ver = buf[pos + 3], flags = buf[pos + 5];
  const size = (buf[pos + 6] << 21) | (buf[pos + 7] << 14) | (buf[pos + 8] << 7) | buf[pos + 9];
  const end = pos + 10 + size + (flags & 0x10 ? 10 : 0);
  let p = pos + 10;
  while (p + 10 <= pos + 10 + size && buf[p] !== 0) {
    const id = buf.toString('latin1', p, p + 4);
    const fsz = ver === 4 ? ((buf[p + 4] << 21) | (buf[p + 5] << 14) | (buf[p + 6] << 7) | buf[p + 7]) : buf.readUInt32BE(p + 4);
    if (id === 'CHAP') {
      const body = p + 10, z = buf.indexOf(0, body);
      chaps.push({ id: buf.toString('latin1', body, z), startMs: buf.readUInt32BE(z + 1) });
    }
    p += 10 + fsz;
  }
  console.log(`ID3v2.${ver} tag: ${size + 10} bytes at ${pos}`);
  pos = end;
}

// ---- frame header
const BR = { 1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], 2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160] };
const SR = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
function hdr(o) {
  if (o + 4 > buf.length || buf[o] !== 0xff || (buf[o + 1] & 0xe0) !== 0xe0) return null;
  const v = (buf[o + 1] >> 3) & 3, layer = (buf[o + 1] >> 1) & 3;
  const bi = buf[o + 2] >> 4, si = (buf[o + 2] >> 2) & 3, pad = (buf[o + 2] >> 1) & 1, mode = buf[o + 3] >> 6;
  if (v === 1 || layer !== 1 || bi === 0 || bi === 15 || si === 3) return null; // Layer III only
  const mpeg1 = v === 3, sr = SR[v][si], kbps = BR[mpeg1 ? 1 : 2][bi];
  const spf = mpeg1 ? 1152 : 576;
  return { sr, kbps, spf, mpeg1, mode, len: Math.floor((spf / 8) * kbps * 1000 / sr) + pad };
}
// first frame = the first header whose successor is also a header (skip junk)
let first = pos;
while (first < buf.length) { const h = hdr(first); if (h && hdr(first + h.len)) break; first++; }
const h0 = hdr(first);
if (!h0) { console.error('no MPEG Layer III frames found'); process.exit(1); }
console.log(`first frame at byte ${first}: MPEG${h0.mpeg1 ? 1 : 2} L3 ${h0.sr} Hz, ${h0.mode === 3 ? 'mono' : 'stereo'}, ${h0.kbps} kbps`);

// ---- Xing/Info (+LAME) or VBRI in the first frame
const sideInfo = h0.mpeg1 ? (h0.mode === 3 ? 17 : 32) : (h0.mode === 3 ? 9 : 17);
let xo = first + 4 + sideInfo, xing = null;
const tag = buf.toString('latin1', xo, xo + 4);
if (tag === 'Xing' || tag === 'Info') {
  const fl = buf.readUInt32BE(xo + 4); let p = xo + 8;
  xing = { tag };
  if (fl & 1) { xing.frames = buf.readUInt32BE(p); p += 4; }
  if (fl & 2) { xing.bytes = buf.readUInt32BE(p); p += 4; }
  if (fl & 4) { xing.toc = [...buf.subarray(p, p + 100)]; p += 100; }
  if (fl & 8) p += 4;
  const enc = buf.toString('latin1', p, p + 9).replace(/\0/g, '');
  if (/^(LAME|Lavc|Lavf|L3.99)/.test(enc)) {
    const d = buf.readUIntBE(p + 21, 3);
    xing.encoder = enc; xing.delay = d >> 12; xing.padding = d & 0xfff;
  }
  console.log(`${tag} header: frames=${xing.frames ?? 'absent'} bytes=${xing.bytes ?? 'absent'} TOC=${xing.toc ? 'present' : 'ABSENT'}` +
    (xing.encoder ? ` encoder="${xing.encoder}" delay=${xing.delay} padding=${xing.padding} samples` : ' (no LAME tag)'));
  if (tag === 'Info') console.log('  "Info" = the encoder declared CBR');
} else if (buf.toString('latin1', first + 36, first + 40) === 'VBRI') {
  console.log('VBRI (Fraunhofer) header present; its seek table is not modelled here');
} else console.log('NO Xing/Info/VBRI header: a player can only estimate from a bitrate');

// ---- true frame map
const offs = []; const kb = new Map(); let o = first, spf = h0.spf, sr = h0.sr;
while (o < buf.length) { const h = hdr(o); if (!h) break; offs.push(o); kb.set(h.kbps, (kb.get(h.kbps) || 0) + 1); o += h.len; }
const trailing = buf.length - o;
const audioFrames = xing ? offs.slice(1) : offs; // the Xing frame decodes as silence and is skipped
const audioStart = audioFrames[0], audioEnd = o;
const dur = audioFrames.length * spf / sr;
console.log(`walked ${offs.length} frames (${trailing} trailing bytes${buf.toString('latin1', buf.length - 128, buf.length - 125) === 'TAG' ? ', ID3v1' : ''}); duration ${fmt(dur)}` +
  (xing && xing.frames ? `; Xing says ${xing.frames} frames (${xing.frames === offs.length ? 'matches incl. Xing frame' : xing.frames === audioFrames.length ? 'matches' : 'MISMATCH'})` : ''));
console.log('bitrate histogram (kbps:frames): ' + [...kb].sort((a, b) => a[0] - b[0]).map(([k, n]) => `${k}:${n}`).join(' ') + (kb.size > 1 ? '  -> VBR' : '  -> CBR'));
if (xing && xing.bytes) console.log(`Xing byte count ${xing.bytes} vs walked ${audioEnd - first} (from the Xing frame) / ${audioEnd - audioStart} (audio only)`);

const timeAt = b => { // true media time of the frame containing byte b
  let lo = 0, hi = audioFrames.length - 1;
  if (b < audioFrames[0]) return 0;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (audioFrames[m] <= b) lo = m; else hi = m - 1; }
  return lo * spf / sr;
};
const est = {};
if (xing && xing.toc) est['Xing TOC'] = T => {
  const pct = Math.min(99.999, Math.max(0, T / dur * 100)), a = Math.floor(pct);
  const fa = xing.toc[a], fb = a < 99 ? xing.toc[a + 1] : 256;
  const total = xing.bytes || (audioEnd - first);
  return first + (fa + (fb - fa) * (pct - a)) / 256 * total;
};
est['avg bitrate'] = T => audioStart + T / dur * (audioEnd - audioStart);
est['1st-frame kbps'] = T => audioStart + T * hdr(audioStart).kbps * 125;

const targets = process.argv.slice(3).map(parseT);
if (chaps.length) {
  console.log('embedded ID3 CHAP starts: ' + chaps.map(c => fmt(c.startMs / 1000)).join(' '));
  if (!targets.length) chaps.forEach(c => targets.push(c.startMs / 1000));
}
console.log('\nwhere a seek to T lands (true audio position) - error = landed - T; + = LATE (later audio), - = EARLY');
console.log('T'.padEnd(10) + Object.keys(est).map(k => k.padStart(18)).join(''));
for (const T of targets) console.log(fmt(T).padEnd(10) + Object.values(est).map(f => { const e = timeAt(f(T)) - T; return ((e >= 0 ? '+' : '') + e.toFixed(2) + 's').padStart(18); }).join(''));
console.log('\nwhole-file sweep (every 1 s): max |error| and mean error');
for (const [k, f] of Object.entries(est)) {
  let mx = 0, sum = 0, n = 0;
  for (let T = 0; T < dur - 1; T++) { const e = timeAt(f(T)) - T; mx = Math.max(mx, Math.abs(e)); sum += e; n++; }
  console.log(`  ${k.padEnd(16)} max ${mx.toFixed(2)}s  mean ${(sum / n >= 0 ? '+' : '') + (sum / n).toFixed(2)}s`);
}
