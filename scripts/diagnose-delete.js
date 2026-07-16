#!/usr/bin/env node
'use strict';
/*
 * diagnose-delete.js -- READ-ONLY diagnostic for the "won't delete / comes back"
 * class. Touches NOTHING on disk or in the db; it only reads. For each target
 * video id it prints, side by side:
 *   - the STORED filePath (exact codepoints) from db.json
 *   - whether fs.existsSync(stored) is true (the delete fast-path)
 *   - a RAW-BYTE listing of the real parent directory, marking which dirents
 *     share the target [id] bracket + extension (this is what resolveLeafBy
 *     BracketId matches on) and flagging AMBIGUITY (2+ matches -> resolver bails)
 *   - the deletion-tombstone state for the item
 *
 * Usage:
 *   node scripts/diagnose-delete.js                 # auto-find db.json
 *   node scripts/diagnose-delete.js /path/to/db.json
 *
 * The three ids below are Dean's failing files; edit TARGET_IDS to add more.
 */
const fs = require('fs');
const path = require('path');

const TARGET_IDS = ['lUirOY2Xf_4', 'N5OU1gTCc5M', 'PnFlu3Awh74'];

// ---- locate db.json --------------------------------------------------------
function findDbPath() {
  if (process.argv[2]) return process.argv[2];
  const candidates = [
    process.env.FILETUBE_DATA_DIR && path.join(process.env.FILETUBE_DATA_DIR, 'db.json'),
    path.join(process.cwd(), 'data', 'db.json'),
    path.join(process.cwd(), 'db.json'),
    '/data/db.json',
    path.join(__dirname, '..', 'data', 'db.json'),
  ].filter(Boolean);
  for (const c of candidates) { try { if (fs.existsSync(c)) return c; } catch (_) {} }
  return null;
}

// ---- codepoint dump: reveals full-width / emoji / combining / invalid bytes -
function codepoints(str) {
  const out = [];
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    out.push('U+' + cp.toString(16).toUpperCase().padStart(4, '0'));
  }
  return out.join(' ');
}

// The bracket matcher, byte-for-byte identical in intent to the server's
// extractYtdlpVideoId (` [<11 id>]` or `_[<11 id>]` suffix).
function extractId(baseName) {
  const m = /^(.*?)[ _]\[([A-Za-z0-9_-]{11})\]$/.exec(baseName);
  return m ? m[2] : null;
}

function line(s) { process.stdout.write(s + '\n'); }
function hr() { line('-'.repeat(78)); }

function main() {
  const dbPath = findDbPath();
  if (!dbPath) {
    line('ERROR: could not find db.json. Pass its path: node scripts/diagnose-delete.js /path/to/db.json');
    process.exit(2);
  }
  line(`db.json: ${dbPath}`);
  let db;
  try { db = JSON.parse(fs.readFileSync(dbPath, 'utf8')); }
  catch (e) { line(`ERROR reading db.json: ${e.message}`); process.exit(2); }

  const metadata = db.metadata || {};
  const tombstones = db.deleteTombstones || {};

  for (const targetId of TARGET_IDS) {
    hr();
    line(`TARGET ID: ${targetId}`);

    // Find every db entry whose stored filePath references this id (bracket OR
    // the entry's own youtubeId field OR a raw substring -- catch all shapes).
    const hits = [];
    for (const [key, item] of Object.entries(metadata)) {
      if (!item || typeof item.filePath !== 'string') continue;
      const base = path.basename(item.filePath, path.extname(item.filePath));
      const bracketId = extractId(base);
      const matches =
        bracketId === targetId ||
        item.youtubeId === targetId ||
        item.filePath.includes(targetId);
      if (matches) hits.push({ key, item, bracketId });
    }

    if (hits.length === 0) {
      line('  db: NO metadata entry references this id.');
      line('      -> the card you see is NOT backed by db.metadata under this id;');
      line('         it may be a stale client view, a different id, or already removed.');
    }

    for (const { key, item, bracketId } of hits) {
      line('');
      line(`  db.metadata key (= id the DELETE request uses): ${key}`);
      line(`  stored filePath : ${JSON.stringify(item.filePath)}`);
      line(`  stored basename : ${codepoints(path.basename(item.filePath))}`);
      line(`  bracket in stored name parses to: ${bracketId === null ? 'NULL (no parseable [id]!) <-- resolver by-id recovery CANNOT fire' : bracketId}`);
      line(`  item.youtubeId  : ${item.youtubeId === undefined ? '(unset)' : JSON.stringify(item.youtubeId)}`);

      let existsStored = false;
      try { existsStored = fs.existsSync(item.filePath); } catch (_) {}
      line(`  fs.existsSync(stored) : ${existsStored}  ${existsStored ? '<-- fast-path delete should just work' : '<-- fast path MISSES; falls to resolver'}`);

      // Raw-byte listing of the real parent dir.
      const dir = path.dirname(item.filePath);
      let dirExists = false;
      try { dirExists = fs.existsSync(dir); } catch (_) {}
      line(`  parent dir      : ${JSON.stringify(dir)}  (exists: ${dirExists})`);
      if (!dirExists) {
        line('  -> parent dir missing at the STORED spelling; the folder name itself may diverge.');
        continue;
      }

      let bufEntries;
      try { bufEntries = fs.readdirSync(dir, { encoding: 'buffer' }); }
      catch (e) { line(`  readdir failed: ${e.code || e.message}`); continue; }

      const storedExt = path.extname(item.filePath);
      const matchesOnDisk = [];
      line(`  disk entries carrying id ${targetId} with ext ${storedExt}:`);
      for (const buf of bufEntries) {
        const str = buf.toString('utf8');
        const roundTrips = Buffer.from(str, 'utf8').equals(buf); // false => invalid UTF-8 bytes
        const base = path.basename(str, path.extname(str));
        const idHere = extractId(base);
        if (path.extname(str) !== storedExt) continue;
        if (idHere !== targetId) {
          // also catch raw-byte bracket matches that fail utf8 decode
          if (!buf.includes(Buffer.from(`[${targetId}]`))) continue;
        }
        matchesOnDisk.push(str);
        const full = path.join(dir, str);
        let existsCandidate = false;
        try { existsCandidate = fs.existsSync(full); } catch (_) {}
        line(`     * ${JSON.stringify(str)}`);
        line(`         codepoints: ${codepoints(str)}`);
        line(`         utf8 round-trips: ${roundTrips}  existsSync(candidate): ${existsCandidate}`);
        line(`         same bytes as stored basename: ${buf.equals(Buffer.from(path.basename(item.filePath), 'utf8'))}`);
      }
      if (matchesOnDisk.length === 0) {
        line('     (none) -> the file with this id is NOT in this folder. Either already');
        line('              deleted, or it lives under a different parent path.');
      } else if (matchesOnDisk.length > 1) {
        line(`  *** AMBIGUOUS: ${matchesOnDisk.length} disk files share id ${targetId}+${storedExt}.`);
        line('      resolveLeafByBracketId returns null on 2+ matches ("do not guess")');
        line('      -> resolver reports GONE -> delete fakes success, unlinks NOTHING. <== LIKELY BUG');
      }

      const tomb = tombstones[key];
      line(`  tombstone[${key}]: ${tomb ? JSON.stringify(tomb) : '(none)'}`);
    }
  }
  hr();
  line(`total deleteTombstones in db: ${Object.keys(tombstones).length}`);
}

main();
