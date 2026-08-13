#!/usr/bin/env node
'use strict';

// probe-faststart.js - READ-ONLY perf diagnostic for FileTube (Idea 1).
//
// For every .mp4 in the library it walks the top-level MP4 boxes and reports
// whether `moov` precedes `mdat` (faststart / web-optimized) or trails it.
// A trailing `moov` forces the browser to fetch far into the file before it
// can decode frame 1 - the prime suspect for "slow to start" on click.
//
// No ffmpeg, no transcode, no writes. It only reads a few KB of box headers
// per file (seeks by box size; never reads media payloads).
//
// Usage:
//   node scripts/probe-faststart.js                     # auto-find the data dir
//   node scripts/probe-faststart.js --data-dir /app/data
//   node scripts/probe-faststart.js --dir /path/to/media  # walk a folder instead
//   node scripts/probe-faststart.js --list                # print every trailing-moov file
//
// Reads the library through the SAME db adapter the server uses
// (lib/db/sqlite.js) so the `node:sqlite`-only source-lock holds - this
// script never touches node:sqlite directly.

const fs = require('fs');
const path = require('path');
const { readPersistedDatabase, SQLITE_FILENAME } = require('../lib/db/sqlite');

function parseArgs(argv) {
  const out = { dataDir: null, dir: null, list: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--data-dir' || a === '--db') out.dataDir = argv[++i];
    else if (a === '--dir') out.dir = argv[++i];
    else if (a === '--list') out.list = true;
    else if (a === '-h' || a === '--help') { out.help = true; }
  }
  return out;
}

function findDataDir(explicit) {
  const candidates = [
    explicit,
    process.env.DATA_DIR,
    '/app/data',
    path.resolve('.'),
  ].filter(Boolean);
  for (const c of candidates) {
    try { if (fs.existsSync(path.join(c, SQLITE_FILENAME))) return c; } catch { /* ignore */ }
  }
  return null;
}

function mp4FilePathsFromDb(dataDir) {
  // If the caller passed a filetube.db FILE path (legacy --db), accept its dir.
  let dir = dataDir;
  try { if (fs.statSync(dataDir).isFile()) dir = path.dirname(dataDir); } catch { /* ignore */ }
  const db = readPersistedDatabase(dir);
  const meta = (db && db.metadata) || {};
  const paths = [];
  for (const id of Object.keys(meta)) {
    const it = meta[id];
    if (it && it.type === 'video' && typeof it.filePath === 'string') paths.push(it.filePath);
  }
  return paths;
}

function walkDir(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile()) out.push(full);
    }
  }
  return out;
}

// v1.111: the box-walker moved to lib/faststart.js so this diagnostic script and
// the runtime remux share ONE source of truth (they must never disagree about
// what "trailing moov" means). Same signature/return shape as before.
const { probeMp4Faststart: probeMp4 } = require('../lib/faststart');

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log('Usage: node scripts/probe-faststart.js [--data-dir PATH | --dir PATH] [--list]');
    return;
  }

  let files;
  if (args.dir) {
    files = walkDir(args.dir).filter(f => f.toLowerCase().endsWith('.mp4'));
    console.log(`Scanning dir ${args.dir}: ${files.length} .mp4 files`);
  } else {
    const dataDir = findDataDir(args.dataDir);
    if (!dataDir) {
      console.error('Could not find filetube.db. Pass --data-dir PATH or --dir PATH.');
      process.exit(2);
    }
    console.log(`Reading library from ${path.join(dataDir, SQLITE_FILENAME)}`);
    const all = mp4FilePathsFromDb(dataDir);
    files = all.filter(f => f.toLowerCase().endsWith('.mp4'));
    const nonMp4 = all.length - files.length;
    console.log(`${all.length} video items; ${files.length} .mp4 (faststart applies), ${nonMp4} non-mp4 (n/a)`);
  }

  const stats = { faststart: 0, trailing: 0, missing: 0, unknown: 0, error: 0 };
  const trailingList = [];
  for (const f of files) {
    const r = probeMp4(f);
    if (r.error) { stats.error++; if (args.list) console.log(`  ERR  ${r.error}  ${f}`); continue; }
    if (r.faststart === true) stats.faststart++;
    else if (r.faststart === false) { stats.trailing++; trailingList.push(f); }
    else { stats.unknown++; }
  }

  console.log('\n=== faststart report ===');
  console.log(`faststart (moov first, fast to start):  ${stats.faststart}`);
  console.log(`TRAILING moov (slow to start suspect):  ${stats.trailing}`);
  console.log(`unknown / not-mp4-structure:            ${stats.unknown}`);
  console.log(`unreadable (missing/permission):        ${stats.error}`);
  const total = stats.faststart + stats.trailing;
  if (total > 0) {
    const pct = Math.round((stats.trailing / total) * 100);
    console.log(`\n=> ${pct}% of readable mp4s have a TRAILING moov.`);
    if (pct >= 20) {
      console.log('   A `-movflags +faststart` remux pass would likely help time-to-first-frame.');
    } else {
      console.log('   Most files are already faststart; the slowness (if any) is elsewhere');
      console.log('   (preload strategy, first-byte warmup, or the AVI live-transcode path).');
    }
  }
  if (args.list && trailingList.length) {
    console.log('\n--- trailing-moov files ---');
    for (const f of trailingList) console.log('  ' + f);
  }
}

main();
