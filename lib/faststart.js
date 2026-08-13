'use strict';

// v1.111 (Dean, streaming Tier 1): MP4 faststart detection + a lossless, in-place
// remux that front-loads the `moov` atom.
//
// WHY: an mp4 whose `moov` box (the index) trails after `mdat` (the media) forces
// a browser to fetch deep into the file before it can decode frame 1 or seek --
// the "slow to start on click" symptom. `+faststart` relocates `moov` to the
// front. It is a CONTAINER remux only: `-c copy`, no re-encode, no quality loss,
// no re-download.
//
// SAFETY (this file NEVER loses data):
//   - It only ever touches a file whose extension is `.mp4` -- so the mp4-only
//     `-movflags` can never be handed to a webm/mkv muxer (the failure mode that
//     killed the yt-dlp-flag approach: ffmpeg rejects it and exits non-zero).
//   - It only remuxes a file whose `moov` genuinely TRAILS (probed first); an
//     already-faststart or non-mp4-structured file is left byte-for-byte alone.
//   - It writes a sibling temp, verifies ffmpeg exit 0 AND the temp is itself
//     faststart, then ATOMICALLY renames the temp over the original (POSIX
//     rename: a concurrent reader keeps streaming the old inode uncorrupted).
//   - On ANY failure it deletes the temp and keeps the original untouched.
//   - It preserves the original mtime, so the scan's change-detection and the
//     deletion-tombstone mtime comparison never mistake a faststart remux for a
//     re-download.

const fs = require('fs');
const path = require('path');

// Walk the top-level MP4 boxes and report whether `moov` appears before `mdat`.
// Reads only a few KB of box HEADERS (seeks by box size; never reads media
// payloads). Returns { faststart: true|false|null, order:[...], reason } --
// `null` when the file isn't MP4-box-structured or has no `moov` (both "leave it
// alone"). Ported verbatim from scripts/probe-faststart.js so the diagnostic
// script and the runtime remux share ONE box-walker (the script now requires
// this). fsi is injectable for unit tests.
function probeMp4Faststart(filePath, fsi) {
  const io = fsi || fs;
  let fd;
  try { fd = io.openSync(filePath, 'r'); } catch (e) { return { error: e.code || String(e) }; }
  try {
    const size = io.fstatSync(fd).size;
    const header = Buffer.alloc(16);
    let offset = 0;
    const order = [];
    let guard = 0;
    while (offset + 8 <= size && guard++ < 100000) {
      const got = io.readSync(fd, header, 0, 16, offset);
      if (got < 8) break;
      let boxSize = header.readUInt32BE(0);
      const type = header.toString('latin1', 4, 8);
      let headerLen = 8;
      if (boxSize === 1) {
        if (got < 16) break;
        const hi = header.readUInt32BE(8);
        const lo = header.readUInt32BE(12);
        boxSize = hi * 4294967296 + lo;
        headerLen = 16;
      } else if (boxSize === 0) {
        boxSize = size - offset;
      }
      if (!/^[\x20-\x7e]{4}$/.test(type)) {
        return { faststart: null, reason: 'not-mp4-box-structure', order };
      }
      if ((type === 'moov' || type === 'mdat') && !order.includes(type)) order.push(type);
      if (order.includes('moov') && order.includes('mdat')) break;
      if (boxSize < headerLen) break;
      offset += boxSize;
    }
    if (!order.includes('moov')) return { faststart: null, reason: 'no-moov-seen', order };
    if (!order.includes('mdat')) return { faststart: true, reason: 'moov-only-or-first', order };
    return { faststart: order.indexOf('moov') < order.indexOf('mdat'), reason: 'compared', order };
  } finally {
    io.closeSync(fd);
  }
}

// The ffmpeg arg array for a lossless faststart remux. Pure/testable; fixed
// literals + the two caller paths (no interpolation into a shell -- spawned as
// an argv array). `-c copy` = no re-encode; `-movflags +faststart` = moov first.
function buildFaststartRemuxArgs(inPath, outPath) {
  return ['-hide_banner', '-loglevel', 'error', '-y', '-i', inPath, '-c', 'copy', '-movflags', '+faststart', outPath];
}

// Only `.mp4` is eligible -- the hard safety boundary (never hand -movflags to a
// non-mp4 muxer). Case-insensitive.
function isFaststartEligible(filePath) {
  return typeof filePath === 'string' && path.extname(filePath).toLowerCase() === '.mp4';
}

// Lossless in-place faststart remux, best-effort and non-throwing. Resolves to
// an OUTCOME string: 'skip-non-mp4' | 'skip-not-trailing' | 'remuxed' |
// 'failed'. deps is injectable for tests: { spawn, probe, fsi }.
//   spawn(cmd, args) -> a child with .on('close'|'error'); defaults to
//                       child_process.spawn('ffmpeg', ...).
async function remuxFaststartInPlace(filePath, deps = {}) {
  const io = deps.fsi || fs;
  const spawn = deps.spawn || require('child_process').spawn;
  const probe = deps.probe || ((fp) => probeMp4Faststart(fp, io));

  if (!isFaststartEligible(filePath)) return 'skip-non-mp4';

  let before;
  try { before = probe(filePath); } catch (_) { return 'failed'; }
  // Leave alone: already faststart, or not a decidable trailing-moov mp4.
  if (!before || before.faststart !== false) return 'skip-not-trailing';

  // Preserve the original mtime so the scan / tombstone logic never sees the
  // remux as a file change.
  let origStat;
  try { origStat = io.statSync(filePath); } catch (_) { return 'failed'; }

  const tmpPath = filePath + '.faststart.tmp.mp4';
  try { if (io.existsSync(tmpPath)) io.unlinkSync(tmpPath); } catch (_) { /* best-effort */ }

  const ok = await new Promise((resolve) => {
    let child;
    try { child = spawn('ffmpeg', buildFaststartRemuxArgs(filePath, tmpPath)); }
    catch (_) { resolve(false); return; }
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });

  const cleanupTmp = () => { try { if (io.existsSync(tmpPath)) io.unlinkSync(tmpPath); } catch (_) { /* best-effort */ } };

  if (!ok) { cleanupTmp(); return 'failed'; }
  // Verify the remux actually produced a faststart mp4 before we swap it in --
  // never replace the good original with a dud.
  let after;
  try { after = probe(tmpPath); } catch (_) { after = null; }
  if (!after || after.faststart !== true) { cleanupTmp(); return 'failed'; }

  try {
    io.renameSync(tmpPath, filePath); // atomic on the same filesystem
    // Restore the original mtime (best-effort; a failure here is cosmetic).
    try { io.utimesSync(filePath, origStat.atime, origStat.mtime); } catch (_) { /* cosmetic */ }
    return 'remuxed';
  } catch (_) {
    cleanupTmp();
    return 'failed';
  }
}

module.exports = { probeMp4Faststart, buildFaststartRemuxArgs, isFaststartEligible, remuxFaststartInPlace };
