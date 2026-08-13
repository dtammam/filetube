#!/usr/bin/env node
'use strict';

// probe-channel-metadata.js - READ-ONLY diagnostic for the channel display-name
// "@handle" + missing-avatar issue (v1.113 backfill wave). It sizes the backfill:
// how many video items lack a captured `channelName`, how many of those show the
// download-folder "@handle" as their name, how many are re-pullable (have a
// youtubeId source), and the avatar split. NO writes, no yt-dlp, no network.
//
// Reads the library through the SAME db adapter the server uses (lib/db/sqlite),
// so the node:sqlite source-lock holds - this script never touches node:sqlite.
//
// Usage:
//   node scripts/probe-channel-metadata.js                 # auto-find the data dir
//   node scripts/probe-channel-metadata.js --data-dir /app/data
//   node scripts/probe-channel-metadata.js --examples 5    # show N real rows per bucket

const fs = require('fs');
const path = require('path');
const { readPersistedDatabase, SQLITE_FILENAME } = require('../lib/db/sqlite');

// PURE, testable classifier: given a metadata item, report the flags the sizing
// buckets are derived from. No I/O. An unrecognized/missing field degrades to the
// safe "absent" reading (never throws). Exported for the unit test.
function classifyChannelMetadata(item) {
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  const isVideo = !!item && item.type === 'video';
  const hasName = str(item && item.channelName) !== '';
  const folderName = str(item && item.folderName);
  const handleFolder = folderName.startsWith('@');
  const repullable = str(item && item.youtubeId) !== ''; // a source to re-pull from
  const hasAvatar = str(item && item.channelAvatarUrl) !== '';
  const hasChannelId = str(item && item.channelId) !== '';
  const manuallyAttributed = !!(item && item.channelAttributedManually);
  return { isVideo, hasName, folderName, handleFolder, repullable, hasAvatar, hasChannelId, manuallyAttributed };
}

function parseArgs(argv) {
  const out = { dataDir: null, examples: 3 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--data-dir' || a === '--db') out.dataDir = argv[++i];
    else if (a === '--examples') out.examples = Math.max(0, parseInt(argv[++i], 10) || 0);
    else if (a === '-h' || a === '--help') out.help = true;
  }
  return out;
}

function findDataDir(explicit) {
  const candidates = [explicit, process.env.DATA_DIR, '/app/data', path.resolve('.')].filter(Boolean);
  for (const c of candidates) {
    try { if (fs.existsSync(path.join(c, SQLITE_FILENAME))) return c; } catch { /* ignore */ }
  }
  return null;
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log('Usage: node scripts/probe-channel-metadata.js [--data-dir PATH] [--examples N]');
    return;
  }
  let dir = findDataDir(args.dataDir);
  if (!dir) { console.error('Could not find filetube.db. Pass --data-dir PATH.'); process.exit(2); }
  try { if (fs.statSync(dir).isFile()) dir = path.dirname(dir); } catch { /* ignore */ }
  console.log(`Reading library from ${path.join(dir, SQLITE_FILENAME)}`);

  const db = readPersistedDatabase(dir);
  const meta = (db && db.metadata) || {};

  const stats = {
    videos: 0, hasName: 0,
    noName: 0, noNameHandle: 0, noNameHandleRepullable: 0, noNameHandleNoSource: 0, noNameOther: 0,
    noAvatarNoId: 0, noAvatarHasId: 0, hasAvatar: 0,
    manualSkipped: 0,
  };
  const ex = { handleRepullable: [], handleNoSource: [], avatarRecoverable: [] };
  const push = (arr, s) => { if (arr.length < args.examples) arr.push(s); };

  for (const id of Object.keys(meta)) {
    const c = classifyChannelMetadata(meta[id]);
    if (!c.isVideo) continue;
    stats.videos++;
    if (c.hasName) stats.hasName++;
    else {
      stats.noName++;
      if (c.manuallyAttributed) stats.manualSkipped++; // won't be backfilled (attribution wins)
      if (c.handleFolder) {
        stats.noNameHandle++;
        if (c.repullable && !c.manuallyAttributed) { stats.noNameHandleRepullable++; push(ex.handleRepullable, `${c.folderName}  (id ${id})`); }
        else { stats.noNameHandleNoSource++; push(ex.handleNoSource, `${c.folderName}  (id ${id}, no youtubeId)`); }
      } else {
        stats.noNameOther++;
      }
    }
    // Avatar split (independent of name)
    if (c.hasAvatar) stats.hasAvatar++;
    else if (c.hasChannelId) { stats.noAvatarHasId++; push(ex.avatarRecoverable, `${c.folderName || '(no folder)'}  (id ${id}, has channelId)`); }
    else stats.noAvatarNoId++;
  }

  console.log('\n=== channel-metadata report ===');
  console.log(`video items:                              ${stats.videos}`);
  console.log(`  with a captured channelName (fine):     ${stats.hasName}`);
  console.log(`  MISSING channelName:                    ${stats.noName}`);
  console.log(`    of those, folderName is an "@handle":  ${stats.noNameHandle}`);
  console.log(`      re-pullable (has youtubeId) -> FIX B:  ${stats.noNameHandleRepullable}`);
  console.log(`      no source (cannot backfill):           ${stats.noNameHandleNoSource}`);
  console.log(`    non-@handle missing-name items:        ${stats.noNameOther}`);
  console.log(`  manually-attributed (backfill SKIPS):   ${stats.manualSkipped}`);
  console.log('\n--- avatar ---');
  console.log(`  has avatar art:                         ${stats.hasAvatar}`);
  console.log(`  no avatar but HAS channelId -> FIX A recovers: ${stats.noAvatarHasId}`);
  console.log(`  no avatar and no channelId -> needs FIX B:     ${stats.noAvatarNoId}`);

  console.log(`\n=> FIX B backfill target (repullable @handle, no manual attr): ${stats.noNameHandleRepullable}`);
  console.log(`=> FIX A search-avatar recoveries (no avatar but resolvable id): ${stats.noAvatarHasId}`);

  if (args.examples > 0) {
    const dump = (label, arr) => { if (arr.length) { console.log(`\n--- ${label} ---`); arr.forEach(s => console.log('  ' + s)); } };
    dump('example @handle items to backfill (Fix B)', ex.handleRepullable);
    dump('example @handle items with NO source (cannot backfill)', ex.handleNoSource);
    dump('example avatar-recoverable items (Fix A)', ex.avatarRecoverable);
  }
}

if (require.main === module) main();

module.exports = { classifyChannelMetadata };
