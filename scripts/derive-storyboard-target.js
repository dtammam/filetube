#!/usr/bin/env node
'use strict';

// derive-storyboard-target.js - machine-derives how many library items would
// get a v1.92 storyboard, so the exec plan's "283 video items" number is a
// PREDICTION the tools re-assert at each commit rather than a hand count.
//
// Reads through the db adapter (lib/db/sqlite.js) so the node:sqlite
// source-lock holds. Read-only.
//
// Usage: node scripts/derive-storyboard-target.js [--data-dir PATH]

const fs = require('fs');
const path = require('path');
const { readPersistedDatabase, SQLITE_FILENAME } = require('../lib/db/sqlite');
const { shouldGenerateStoryboard } = require('../lib/storyboard');

function findDataDir(explicit) {
  const candidates = [explicit, process.env.DATA_DIR, '/app/data', path.resolve('.')].filter(Boolean);
  for (const c of candidates) {
    try { if (fs.existsSync(path.join(c, SQLITE_FILENAME))) return c; } catch { /* ignore */ }
  }
  return null;
}

function main() {
  let dataDir = null;
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '--data-dir') dataDir = process.argv[++i];
  }
  dataDir = findDataDir(dataDir);
  if (!dataDir) { console.error('No filetube.db found; pass --data-dir PATH'); process.exit(2); }

  const db = readPersistedDatabase(dataDir);
  const meta = (db && db.metadata) || {};
  const ids = Object.keys(meta);
  let video = 0, audio = 0, target = 0, tooShort = 0;
  const byExt = {};
  for (const id of ids) {
    const it = meta[id];
    if (!it) continue;
    if (it.type === 'video') video++;
    else if (it.type === 'audio') audio++;
    const ext = String(it.ext || '?').toLowerCase();
    byExt[ext] = (byExt[ext] || 0) + 1;
    if (it.type === 'video' && !shouldGenerateStoryboard(it)) tooShort++;
    if (shouldGenerateStoryboard(it)) target++;
  }
  console.log(`items: ${ids.length}  video: ${video}  audio: ${audio}`);
  console.log(`by ext: ${JSON.stringify(byExt)}`);
  console.log(`STORYBOARD TARGET (shouldGenerateStoryboard): ${target}`);
  console.log(`  video items too short / no duration (no storyboard): ${tooShort}`);
}

main();
