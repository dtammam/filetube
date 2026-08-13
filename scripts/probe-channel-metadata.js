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
  const name = str(item && item.channelName);
  const hasName = name !== '';
  // v1.114 fix: the REAL affected set is "shows a bad name", which is TWO cases:
  //   - missing channelName -> falls back to the folderName (e.g. "AfterSkool"),
  //   - channelName captured the HANDLE ("@nestalgiamusic") instead of the name.
  // The prior version only counted @handle FOLDERS (0 on real data) and measured
  // re-pullability only inside that empty branch -> under-reported the target as 0.
  const handleName = hasName && name.startsWith('@'); // the handle stored AS the name
  const folderName = str(item && item.folderName);
  const handleFolder = folderName.startsWith('@');
  const repullable = str(item && item.youtubeId) !== ''; // a source to re-pull from (youtubeId proxy)
  const hasAvatar = str(item && item.channelAvatarUrl) !== '';
  const hasChannelId = str(item && item.channelId) !== '';
  const manuallyAttributed = !!(item && item.channelAttributedManually);
  // "bad name" = anything that is NOT the real channel name on the card.
  const badName = !hasName || handleName;
  return { isVideo, hasName, handleName, folderName, handleFolder, repullable, hasAvatar, hasChannelId, manuallyAttributed, badName };
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
    videos: 0, goodName: 0, handleName: 0, noName: 0, manualSkipped: 0,
    fixBTarget: 0, noSource: 0,
    noAvatarNoId: 0, noAvatarHasId: 0, hasAvatar: 0,
  };
  const ex = { backfill: [], noSource: [], handleName: [], avatarRecoverable: [] };
  const push = (arr, s) => { if (arr.length < args.examples) arr.push(s); };

  for (const id of Object.keys(meta)) {
    const c = classifyChannelMetadata(meta[id]);
    if (!c.isVideo) continue;
    stats.videos++;
    // Name buckets: a "bad name" is what shows on the card when the real
    // channelName was never captured (folder fallback) OR the handle was stored
    // as the name. That is the Fix B population; the rest render the real name.
    if (!c.badName) stats.goodName++;
    else {
      if (c.handleName) { stats.handleName++; push(ex.handleName, `channelName="${(meta[id].channelName || '').trim()}"  folder="${c.folderName}"  (id ${id})`); }
      else stats.noName++;
      if (c.manuallyAttributed) stats.manualSkipped++;
      else if (c.repullable) { stats.fixBTarget++; push(ex.backfill, `${c.handleName ? (meta[id].channelName || '').trim() : (c.folderName || '(no folder)')}  (id ${id})`); }
      else { stats.noSource++; push(ex.noSource, `${c.folderName || '(no folder)'}  (id ${id}, no youtubeId)`); }
    }
    // Avatar split (independent of the name).
    if (c.hasAvatar) stats.hasAvatar++;
    else if (c.hasChannelId) { stats.noAvatarHasId++; push(ex.avatarRecoverable, `${c.folderName || '(no folder)'}  (id ${id}, has channelId)`); }
    else stats.noAvatarNoId++;
  }

  console.log('\n=== channel-metadata report ===');
  console.log(`video items:                                 ${stats.videos}`);
  console.log(`  showing the REAL channel name (fine):      ${stats.goodName}`);
  console.log(`  showing an "@handle" AS the name:          ${stats.handleName}`);
  console.log(`  MISSING channelName (shows the folder):    ${stats.noName}`);
  console.log('\n--- FIX B name backfill (bad name = @handle-name OR missing-name) ---');
  console.log(`  re-pullable (has youtubeId) -> FIX B:      ${stats.fixBTarget}`);
  console.log(`  no re-pullable source (cannot backfill):   ${stats.noSource}`);
  console.log(`  manually-attributed (backfill SKIPS):      ${stats.manualSkipped}`);
  console.log('\n--- avatar (Fix A shipped in v1.113) ---');
  console.log(`  has avatar art:                            ${stats.hasAvatar}`);
  console.log(`  no avatar but HAS channelId -> Fix A recovers: ${stats.noAvatarHasId}`);
  console.log(`  no avatar and no channelId -> needs Fix B:     ${stats.noAvatarNoId}`);

  console.log(`\n=> FIX B name-backfill target (bad name, re-pullable, not manual): ${stats.fixBTarget}`);
  console.log(`=> FIX A avatar recoveries (live in v1.113): ${stats.noAvatarHasId}`);
  console.log('   (NOTE: "re-pullable" here = has a youtubeId. The real reheat can');
  console.log('    ALSO derive a source from a filename [id] bracket or an embedded');
  console.log('    purl, so the true backfillable count may be HIGHER than above.)');

  if (args.examples > 0) {
    const dump = (label, arr) => { if (arr.length) { console.log(`\n--- ${label} ---`); arr.forEach(s => console.log('  ' + s)); } };
    dump('example Fix B backfill targets (bad name, re-pullable)', ex.backfill);
    dump('example "@handle stored as the name" items', ex.handleName);
    dump('example bad-name items with NO source (cannot backfill)', ex.noSource);
    dump('example avatar-recoverable items (Fix A)', ex.avatarRecoverable);
  }
}

if (require.main === module) main();

module.exports = { classifyChannelMetadata };
