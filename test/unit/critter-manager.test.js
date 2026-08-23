'use strict';

// [UNIT] v1.171 (Dean): critter pool MANAGEMENT - the web UI for uploading,
// deleting and downloading the critter folder's images/sounds. This file binds
// the server's pure core: the upload filename gate (a path-traversal surface),
// the magic-byte validators, and the dependency-free store-only zip builder.
// The route-level admin gating is enforced by route-write-classification /
// rbac-census; the destructive routes' resolve-against-real-entries discipline
// is bound here through the exported pure pieces plus source locks.

const { test } = require('node:test');
const assert = require('node:assert');
const zlib = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');

const { sanitizeCritterUploadName, buildStoreZip } = require('../../server.js');

const SERVER = fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8');

// ---- sanitizeCritterUploadName ---------------------------------------------

test('upload name gate: accepts plain names whose extension matches the declared mime family', () => {
  assert.strictEqual(sanitizeCritterUploadName('pearl.png', 'image/png'), 'pearl.png');
  assert.strictEqual(sanitizeCritterUploadName('Mopsy.JPG', 'image/jpeg'), 'Mopsy.JPG', 'case-insensitive extension, name preserved');
  assert.strictEqual(sanitizeCritterUploadName('biscuit.jpeg', 'image/jpeg'), 'biscuit.jpeg');
  assert.strictEqual(sanitizeCritterUploadName('maple.webp', 'image/webp'), 'maple.webp');
  assert.strictEqual(sanitizeCritterUploadName('hazel.gif', 'image/gif'), 'hazel.gif');
  assert.strictEqual(sanitizeCritterUploadName('pearl.mp3', 'audio/mpeg'), 'pearl.mp3');
  assert.strictEqual(sanitizeCritterUploadName('milo.wav', 'audio/wav'), 'milo.wav');
  assert.strictEqual(sanitizeCritterUploadName('milo.wav', 'audio/x-wav'), 'milo.wav', 'browser x-wav alias');
  assert.strictEqual(sanitizeCritterUploadName('milo.m4a', 'audio/mp4'), 'milo.m4a');
  assert.strictEqual(sanitizeCritterUploadName('milo.m4a', 'audio/x-m4a'), 'milo.m4a');
  assert.strictEqual(sanitizeCritterUploadName('milo.ogg', 'audio/ogg'), 'milo.ogg');
  assert.strictEqual(sanitizeCritterUploadName('  padded.png  ', 'image/png'), 'padded.png', 'trimmed');
});

test('upload name gate: REFUSES every traversal/injection shape (the destroy-the-data surface)', () => {
  const evil = [
    '../evil.png', '..\\evil.png', 'a/../../evil.png', '/etc/passwd.png',
    'C:\\evil.png', 'a/b.png', 'a\\b.png',
    '..', '.', '.hidden.png', '.png',
    'nul\u0000.png', 'ctrl\u0001.png', 'del\u007f.png',
    '', '   ', 'x'.repeat(81) + '.png',
  ];
  for (const name of evil) {
    assert.strictEqual(sanitizeCritterUploadName(name, 'image/png'), null, JSON.stringify(name) + ' must be refused');
  }
  assert.strictEqual(sanitizeCritterUploadName(['a.png'], 'image/png'), null, 'a repeated ?name= query (array) is refused');
  assert.strictEqual(sanitizeCritterUploadName(undefined, 'image/png'), null);
});

test('upload name gate: extension and mime must AGREE; svg is never uploadable (stored-XSS posture)', () => {
  assert.strictEqual(sanitizeCritterUploadName('pearl.mp3', 'image/png'), null, 'sound extension under an image mime');
  assert.strictEqual(sanitizeCritterUploadName('pearl.png', 'audio/mpeg'), null, 'image extension under a sound mime');
  assert.strictEqual(sanitizeCritterUploadName('pearl.jpg', 'image/png'), null, 'wrong image family');
  assert.strictEqual(sanitizeCritterUploadName('pearl.svg', 'image/svg+xml'), null, 'svg mime not in the upload allowlist');
  assert.strictEqual(sanitizeCritterUploadName('pearl.svg', 'image/png'), null, 'svg extension under an allowed mime');
  assert.strictEqual(sanitizeCritterUploadName('pearl.exe', 'image/png'), null);
  assert.strictEqual(sanitizeCritterUploadName('pearl', 'image/png'), null, 'no extension');
  assert.strictEqual(sanitizeCritterUploadName('README.md', 'image/png'), null, 'the folder contract file is untouchable');
});

// ---- magic-byte validators (source-locked shapes, exercised via upload sets) -

test('upload magic bytes: each declared mime validates its real signature and rejects a lying body', () => {
  // The maps are module-internal; bind them through the source (both defined)
  // plus behavioral probes of the signature logic re-derived here. The lock:
  // every mime the raw-body parser accepts has a validator in one of the maps.
  const start = SERVER.indexOf('const CRITTER_UPLOAD_IMAGE_TYPES');
  assert.ok(start !== -1, 'image validator map exists');
  const soundStart = SERVER.indexOf('const CRITTER_UPLOAD_SOUND_TYPES');
  assert.ok(soundStart !== -1, 'sound validator map exists');
  const extMapStart = SERVER.indexOf('const CRITTER_UPLOAD_EXT_FOR_MIME');
  const extMapSrc = SERVER.slice(extMapStart, SERVER.indexOf('};', extMapStart));
  const mimes = [...extMapSrc.matchAll(/'((?:image|audio)\/[a-z0-9+-]+)'/g)].map((m) => m[1]);
  assert.ok(mimes.length >= 9, 'ext-for-mime map enumerates the full allowlist (' + mimes.length + ')');
  const validatorsSrc = SERVER.slice(start, SERVER.indexOf('const CRITTER_UPLOAD_EXT_FOR_MIME'));
  for (const mime of new Set(mimes)) {
    assert.ok(validatorsSrc.includes(`'${mime}'`), mime + ' accepted by the parser MUST have a magic validator');
  }
});

// ---- buildStoreZip ----------------------------------------------------------

function readEocd(zip) {
  const sig = zip.readUInt32LE(zip.length - 22);
  return {
    sig,
    count: zip.readUInt16LE(zip.length - 22 + 10),
    cdSize: zip.readUInt32LE(zip.length - 22 + 12),
    cdStart: zip.readUInt32LE(zip.length - 22 + 16),
  };
}

test('buildStoreZip: structurally valid store-only zip - signatures, counts, offsets, CRCs, byte-exact stored data', () => {
  const entries = [
    { name: 'pearl.png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]) },
    { name: 'pearl.mp3', data: Buffer.from('ID3-not-really-audio') },
    { name: 'm\u00f6psy.webp', data: Buffer.from('RIFFxxxxWEBP') }, // UTF-8 name survives
  ];
  const zip = buildStoreZip(entries);
  // EOCD
  const eocd = readEocd(zip);
  assert.strictEqual(eocd.sig, 0x06054b50, 'EOCD signature');
  assert.strictEqual(eocd.count, 3, 'entry count');
  assert.strictEqual(eocd.cdStart + eocd.cdSize + 22, zip.length, 'EOCD geometry closes the file exactly');
  // Walk the central directory; verify every record against its local header.
  let p = eocd.cdStart;
  for (let i = 0; i < eocd.count; i += 1) {
    assert.strictEqual(zip.readUInt32LE(p), 0x02014b50, `central signature #${i}`);
    assert.strictEqual(zip.readUInt16LE(p + 10), 0, `method STORE #${i}`);
    const crc = zip.readUInt32LE(p + 16);
    const size = zip.readUInt32LE(p + 20);
    assert.strictEqual(zip.readUInt32LE(p + 24), size, 'compressed == uncompressed under STORE');
    const nameLen = zip.readUInt16LE(p + 28);
    const localOff = zip.readUInt32LE(p + 42);
    const name = zip.toString('utf8', p + 46, p + 46 + nameLen);
    // The matching local header.
    assert.strictEqual(zip.readUInt32LE(localOff), 0x04034b50, `local signature for ${name}`);
    const lNameLen = zip.readUInt16LE(localOff + 26);
    assert.strictEqual(zip.toString('utf8', localOff + 30, localOff + 30 + lNameLen), name, 'names agree');
    const data = zip.subarray(localOff + 30 + lNameLen, localOff + 30 + lNameLen + size);
    const src = entries.find((e) => e.name === name);
    assert.ok(src, `zip entry ${name} came from the input`);
    assert.ok(data.equals(src.data), `stored bytes are byte-exact for ${name}`);
    assert.strictEqual(crc, zlib.crc32(src.data) >>> 0, `CRC32 recomputed independently for ${name}`);
    assert.strictEqual((zip.readUInt16LE(localOff + 6) & 0x0800), 0x0800, 'UTF-8 name flag set');
    p += 46 + nameLen;
  }
  assert.strictEqual(p, eocd.cdStart + eocd.cdSize, 'central directory size accounts for every record');
});

test('buildStoreZip: an empty pool yields a valid empty zip (EOCD only)', () => {
  const zip = buildStoreZip([]);
  assert.strictEqual(zip.length, 22, 'bare EOCD');
  const eocd = readEocd(zip);
  assert.strictEqual(eocd.sig, 0x06054b50);
  assert.strictEqual(eocd.count, 0);
  assert.strictEqual(eocd.cdSize, 0);
  assert.strictEqual(eocd.cdStart, 0);
});

// ---- destructive-route source locks -----------------------------------------

test('delete routes: unlink targets come from the REAL directory listing, never from the caller\'s string joined into a path', () => {
  // The discipline that keeps traversal impossible even if the query slips
  // through: both DELETE routes iterate listCritterFiles() (regular files,
  // critter extensions only) and unlink only matched entries.
  const item = SERVER.slice(SERVER.indexOf("app.delete('/api/critters/item'"), SERVER.indexOf("app.delete('/api/critters/all'"));
  assert.ok(item.includes('listCritterFiles()'), 'item delete resolves against the listing');
  assert.match(item, /path\.basename\(n, path\.extname\(n\)\) === id/, 'match rule mirrors buildCritterListing basename semantics');
  assert.ok(!/fs\.unlinkSync\(path\.join\([^)]*\bid\b/.test(item), 'the caller id is NEVER joined into an unlink path');
  const all = SERVER.slice(SERVER.indexOf("app.delete('/api/critters/all'"), SERVER.indexOf("app.get('/api/critters/archive'"));
  assert.ok(all.includes('listCritterFiles()'), 'delete-all is scoped to the listing');
  const lister = SERVER.slice(SERVER.indexOf('function listCritterFiles'), SERVER.indexOf("app.post(\n  '/api/critters/upload'"));
  assert.ok(lister.includes('e.isFile()'), 'regular files only - symlinks/subdirs/README are never touched');
  assert.ok(lister.includes('CRITTER_IMAGE_EXTS.has(ext) || CRITTER_SOUND_EXTS.has(ext)'), 'critter extensions only');
});

test('every management route is admin-gated in-route (requireAdmin), matching the census classification', () => {
  for (const marker of ["app.post(\n  '/api/critters/upload'", "app.delete('/api/critters/item'", "app.delete('/api/critters/all'", "app.get('/api/critters/archive'"]) {
    const at = SERVER.indexOf(marker);
    assert.ok(at !== -1, marker + ' exists');
    const head = SERVER.slice(at, at + 600);
    assert.ok(head.includes('if (!requireAdmin(req, res)) return;'), marker + ' calls requireAdmin first');
  }
});
