'use strict';

// v1.37.0 T1 (books): a PURE, dependency-free ZIP central-directory reader --
// exactly the subset an EPUB needs, nothing more. An EPUB is a ZIP whose
// entries are stored (method 0) or raw-DEFLATE (method 8); Node's built-in
// `zlib.inflateRawSync` handles the latter, so no vendored/new server
// dependency is required (the repo's no-new-server-runtime-deps posture --
// the vendored-lib precedent is CLIENT-side only; see
// docs/exec-plans/active/v1.37.0-books.md §2 for the full assessment).
//
// Design decisions, per the exec plan:
//   - The CENTRAL directory is authoritative for names/sizes/offsets --
//     local headers are consulted only to compute each entry's data start
//     (their name/extra lengths can legally differ from the central copy),
//     which also makes data-descriptor entries (GP bit 3) a non-issue: we
//     never need the local header's (possibly zeroed) size fields.
//   - ZIP64 is deliberately UNSUPPORTED (EPUBs never need multi-GB
//     archives): the 0xFFFF/0xFFFFFFFF EOCD sentinels raise a coded error
//     the scanner catches and degrades on (filename-title, no cover).
//   - Encrypted entries (GP bit 0) raise a coded error, never garbage.
//   - Zip-bomb hygiene: the central directory is capped at
//     MAX_CENTRAL_DIR_BYTES and any single entry's inflated output at
//     MAX_INFLATED_BYTES (enforced BOTH by the declared uncompressedSize
//     check and by zlib's own maxOutputLength, so a lying header cannot
//     bypass the cap).
//
// Every function here is pure/synchronous over a caller-supplied Buffer
// (the scanner reads the file; this module never touches fs) and throws
// coded Errors (`err.code`) -- callers catch and degrade, never crash a
// scan (the extractMetadataAndThumbnail catch posture, server.js).

const zlib = require('zlib');

const EOCD_SIGNATURE = 0x06054b50; // PK\x05\x06
const CENTRAL_SIGNATURE = 0x02014b50; // PK\x01\x02
const LOCAL_SIGNATURE = 0x04034b50; // PK\x03\x04

// EOCD is 22 bytes + a comment of up to 65535 bytes -- the EOCD scan never
// needs to look further back than this from the end of the file.
const MAX_EOCD_SCAN_BYTES = 65535 + 22;
// Zip-bomb hygiene caps -- see the module comment.
const MAX_CENTRAL_DIR_BYTES = 4 * 1024 * 1024;
const MAX_INFLATED_BYTES = 16 * 1024 * 1024;

const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;

function codedError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

// Scan backwards from the end of the buffer for the EOCD record. Returns
// its byte offset, or throws EZIPNOEOCD. The backwards scan (rather than a
// fixed -22 read) tolerates trailing archive comments.
function findEndOfCentralDirectory(buf) {
  const floor = Math.max(0, buf.length - MAX_EOCD_SCAN_BYTES);
  for (let i = buf.length - 22; i >= floor; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIGNATURE) {
      // Sanity: the comment length recorded at i+20 must fit the remaining
      // bytes -- guards against the signature bytes appearing inside a
      // comment/entry by coincidence.
      const commentLength = buf.readUInt16LE(i + 20);
      if (i + 22 + commentLength === buf.length) return i;
    }
  }
  throw codedError('EZIPNOEOCD', 'not a zip: no end-of-central-directory record found');
}

/**
 * Parse the central directory. Returns an array of entry records:
 * `{ name, method, flags, compressedSize, uncompressedSize,
 *    localHeaderOffset }` -- names decoded as UTF-8 (EPUB OCF mandates
 * UTF-8/ASCII entry names, so the legacy CP437 case degrades harmlessly to
 * a name the OPF lookups simply won't match).
 * @param {Buffer} buf the whole zip file
 * @returns {Array<object>}
 */
function listEntries(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) {
    throw codedError('EZIPNOEOCD', 'not a zip: too small');
  }
  const eocdOffset = findEndOfCentralDirectory(buf);
  const totalEntries = buf.readUInt16LE(eocdOffset + 10);
  const centralSize = buf.readUInt32LE(eocdOffset + 12);
  const centralOffset = buf.readUInt32LE(eocdOffset + 16);

  // ZIP64 sentinels -- unsupported by design (see module comment).
  if (totalEntries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw codedError('EZIP64', 'zip64 archives are not supported');
  }
  if (centralSize > MAX_CENTRAL_DIR_BYTES) {
    throw codedError('EZIPCENTRALTOOBIG', `central directory exceeds the ${MAX_CENTRAL_DIR_BYTES}-byte cap`);
  }
  if (centralOffset + centralSize > eocdOffset) {
    throw codedError('EZIPCORRUPT', 'central directory extends past the end-of-central-directory record');
  }

  const entries = [];
  let cursor = centralOffset;
  for (let i = 0; i < totalEntries; i++) {
    if (cursor + 46 > buf.length || buf.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) {
      throw codedError('EZIPCORRUPT', `malformed central directory entry #${i}`);
    }
    const flags = buf.readUInt16LE(cursor + 8);
    const method = buf.readUInt16LE(cursor + 10);
    const compressedSize = buf.readUInt32LE(cursor + 20);
    const uncompressedSize = buf.readUInt32LE(cursor + 24);
    const nameLength = buf.readUInt16LE(cursor + 28);
    const extraLength = buf.readUInt16LE(cursor + 30);
    const commentLength = buf.readUInt16LE(cursor + 32);
    const localHeaderOffset = buf.readUInt32LE(cursor + 42);
    const name = buf.toString('utf8', cursor + 46, cursor + 46 + nameLength);
    entries.push({ name, method, flags, compressedSize, uncompressedSize, localHeaderOffset });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/**
 * Extract one entry's bytes. The entry record must come from
 * `listEntries(buf)` over the SAME buffer (central sizes are authoritative).
 * @param {Buffer} buf the whole zip file
 * @param {object} entry a record from listEntries
 * @returns {Buffer} the entry's uncompressed bytes
 */
function extractEntry(buf, entry) {
  if (!entry || typeof entry.localHeaderOffset !== 'number') {
    throw codedError('EZIPCORRUPT', 'invalid entry record');
  }
  if ((entry.flags & 0x1) !== 0) {
    throw codedError('EZIPENCRYPTED', `entry is encrypted: ${entry.name}`);
  }
  if (entry.uncompressedSize > MAX_INFLATED_BYTES) {
    throw codedError('EZIPENTRYTOOBIG', `entry exceeds the ${MAX_INFLATED_BYTES}-byte inflated cap: ${entry.name}`);
  }
  const off = entry.localHeaderOffset;
  if (off + 30 > buf.length || buf.readUInt32LE(off) !== LOCAL_SIGNATURE) {
    throw codedError('EZIPCORRUPT', `missing local header for entry: ${entry.name}`);
  }
  // The LOCAL header's own name/extra lengths (which can differ from the
  // central copy's) position the data start -- the sizes still come from
  // the central record.
  const localNameLength = buf.readUInt16LE(off + 26);
  const localExtraLength = buf.readUInt16LE(off + 28);
  const dataStart = off + 30 + localNameLength + localExtraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > buf.length) {
    throw codedError('EZIPCORRUPT', `entry data extends past end of file: ${entry.name}`);
  }
  const data = buf.subarray(dataStart, dataEnd);

  if (entry.method === METHOD_STORED) {
    return Buffer.from(data); // copy: never hand out a window into the caller's buffer
  }
  if (entry.method === METHOD_DEFLATE) {
    // maxOutputLength enforces the cap even against a LYING
    // uncompressedSize header -- zlib throws ERR_BUFFER_TOO_LARGE, which
    // surfaces as a coded failure below.
    try {
      return zlib.inflateRawSync(data, { maxOutputLength: MAX_INFLATED_BYTES });
    } catch (err) {
      throw codedError('EZIPINFLATE', `failed to inflate entry ${entry.name}: ${err && err.message}`);
    }
  }
  throw codedError('EZIPMETHOD', `unsupported compression method ${entry.method} for entry: ${entry.name}`);
}

/**
 * Convenience: extract an entry by exact name, or `null` when absent.
 * (Case-sensitive: EPUB OCF names are case-sensitive by spec.)
 */
function extractEntryByName(buf, entries, name) {
  const entry = entries.find((e) => e.name === name);
  return entry ? extractEntry(buf, entry) : null;
}

module.exports = {
  listEntries,
  extractEntry,
  extractEntryByName,
  MAX_CENTRAL_DIR_BYTES,
  MAX_INFLATED_BYTES,
};
