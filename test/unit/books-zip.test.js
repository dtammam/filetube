'use strict';

// [UNIT] v1.37.0 T1: lib/books/zip.js -- the pure, dependency-free zip
// central-directory reader the book scanner uses to read EPUBs. Fixtures
// are BUILT at test time by test/helpers/build-zip.js (no binary fixtures
// in git); the reader's whole contract is locked here: central-directory
// authority, local-header data positioning, data-descriptor immunity,
// graceful coded failures (ZIP64/encrypted/unsupported-method/corrupt),
// and the zip-bomb caps.

const { test } = require('node:test');
const assert = require('node:assert');
const zlib = require('node:zlib');

const zip = require('../../lib/books/zip');
const { buildZip, buildEpub } = require('../helpers/build-zip');

test('T1: lists and extracts STORED (method 0) and DEFLATED (method 8) entries byte-exactly', () => {
  const buf = buildZip([
    { name: 'mimetype', data: 'application/epub+zip', method: 0 },
    { name: 'dir/deflated.txt', data: 'hello '.repeat(1000), method: 8 },
  ]);
  const entries = zip.listEntries(buf);
  assert.deepEqual(entries.map((e) => e.name), ['mimetype', 'dir/deflated.txt']);
  assert.equal(zip.extractEntry(buf, entries[0]).toString('utf8'), 'application/epub+zip');
  assert.equal(zip.extractEntry(buf, entries[1]).toString('utf8'), 'hello '.repeat(1000));
});

test('T1: an archive COMMENT does not break the backwards EOCD scan', () => {
  const buf = buildZip([{ name: 'a.txt', data: 'alpha' }], { comment: 'a trailing archive comment PK\x05\x06 with a decoy signature inside' });
  const entries = zip.listEntries(buf);
  assert.equal(zip.extractEntry(buf, entries[0]).toString('utf8'), 'alpha');
});

test('T1: DATA-DESCRIPTOR entries (GP bit 3, zeroed local sizes) extract fine -- central sizes are authoritative', () => {
  const buf = buildZip([{ name: 'desc.txt', data: 'descriptor-backed content', withDescriptor: true }]);
  const entries = zip.listEntries(buf);
  assert.equal(entries[0].flags & 0x8, 0x8, 'sanity: the flag is set');
  assert.equal(zip.extractEntry(buf, entries[0]).toString('utf8'), 'descriptor-backed content');
});

test('T1: a LOCAL extra field longer than the central copy still positions the data correctly (local lengths used for the data start)', () => {
  const buf = buildZip([{ name: 'x.txt', data: 'positioned', localExtra: Buffer.alloc(32, 0xaa) }]);
  const entries = zip.listEntries(buf);
  assert.equal(zip.extractEntry(buf, entries[0]).toString('utf8'), 'positioned');
});

test('T1: ENCRYPTED entries are refused with a coded error, never garbage bytes', () => {
  const buf = buildZip([{ name: 'secret.txt', data: 'sekrit', encrypted: true }]);
  const entries = zip.listEntries(buf);
  assert.throws(() => zip.extractEntry(buf, entries[0]), (err) => err.code === 'EZIPENCRYPTED');
});

test('T1: ZIP64 sentinel values bail with a coded error (unsupported by design)', () => {
  const buf = buildZip([{ name: 'a.txt', data: 'a' }]);
  // Corrupt the EOCD's central-offset field to the ZIP64 sentinel.
  const eocdOffset = buf.length - 22;
  buf.writeUInt32LE(0xffffffff, eocdOffset + 16);
  assert.throws(() => zip.listEntries(buf), (err) => err.code === 'EZIP64');
});

test('T1: not-a-zip and truncated inputs raise coded errors, never throw raw range errors', () => {
  assert.throws(() => zip.listEntries(Buffer.from('definitely not a zip file')), (err) => err.code === 'EZIPNOEOCD');
  assert.throws(() => zip.listEntries(Buffer.alloc(4)), (err) => err.code === 'EZIPNOEOCD');
  const good = buildZip([{ name: 'a.txt', data: 'aaaa' }]);
  const truncated = good.subarray(0, good.length - 30);
  assert.throws(() => zip.listEntries(truncated), (err) => typeof err.code === 'string' && err.code.startsWith('EZIP'));
});

test('T1: an unsupported compression method is a coded error', () => {
  const buf = buildZip([{ name: 'a.txt', data: 'aaaa', method: 0 }]);
  const entries = zip.listEntries(buf);
  // Forge method 6 (imploded) into both headers' method fields.
  const eocdOffset = buf.length - 22;
  const centralOffset = buf.readUInt32LE(eocdOffset + 16);
  buf.writeUInt16LE(6, centralOffset + 10);
  const forged = zip.listEntries(buf);
  assert.equal(forged[0].method, 6);
  assert.throws(() => zip.extractEntry(buf, forged[0]), (err) => err.code === 'EZIPMETHOD');
  assert.ok(entries); // keep the original binding used
});

test('T1: the inflated-size cap holds even against a LYING uncompressedSize header (zlib maxOutputLength backstop)', () => {
  // A ~17MiB-of-zeros payload deflates tiny; declare a small uncompressed
  // size in the headers so the declared-size check passes, and prove the
  // zlib backstop still refuses to inflate past the cap.
  const big = Buffer.alloc(zip.MAX_INFLATED_BYTES + 1024 * 1024, 0);
  const buf = buildZip([{ name: 'bomb.bin', data: big, method: 8 }]);
  const entries = zip.listEntries(buf);
  // Honest header first: declared size over the cap -> coded refusal.
  assert.throws(() => zip.extractEntry(buf, entries[0]), (err) => err.code === 'EZIPENTRYTOOBIG');
  // Lying header: patch uncompressedSize down to 1024 in the central record.
  const eocdOffset = buf.length - 22;
  const centralOffset = buf.readUInt32LE(eocdOffset + 16);
  buf.writeUInt32LE(1024, centralOffset + 24);
  const lied = zip.listEntries(buf);
  assert.equal(lied[0].uncompressedSize, 1024, 'sanity: the lie is in place');
  assert.throws(() => zip.extractEntry(buf, lied[0]), (err) => err.code === 'EZIPINFLATE');
});

test('T1: extractEntryByName returns null for an absent name (case-sensitive, OCF posture)', () => {
  const buf = buildZip([{ name: 'OEBPS/content.opf', data: '<package/>' }]);
  const entries = zip.listEntries(buf);
  assert.equal(zip.extractEntryByName(buf, entries, 'oebps/content.opf'), null);
  assert.ok(zip.extractEntryByName(buf, entries, 'OEBPS/content.opf'));
});

test('T1: the buildEpub fixture helper produces a zip this reader round-trips (the scanner-test foundation)', () => {
  const epub = buildEpub({ title: 'Round Trip', author: 'Tester', chapters: ['<p>one</p>', '<p>two</p>'], coverData: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]) });
  const entries = zip.listEntries(epub);
  const names = entries.map((e) => e.name);
  assert.ok(names.includes('mimetype') && names.includes('META-INF/container.xml') && names.includes('OEBPS/content.opf') && names.includes('OEBPS/cover.jpg'));
  const opf = zip.extractEntryByName(epub, entries, 'OEBPS/content.opf').toString('utf8');
  assert.ok(opf.includes('<dc:title>Round Trip</dc:title>'));
  // Deflate sanity for the helper itself: the stored mimetype really is method 0.
  assert.equal(entries.find((e) => e.name === 'mimetype').method, 0);
  assert.equal(zlib.crc32(zip.extractEntryByName(epub, entries, 'mimetype')) >>> 0, zlib.crc32(Buffer.from('application/epub+zip')) >>> 0);
});

// ---- v1.37.0 gate fixes: the caps the first round left unexercised ----------

test('GATE FIX (adversarial W3): a STORED entry with a LYING small uncompressedSize still hits the cap -- method 0 has no zlib backstop, so the stored size is checked independently', () => {
  const big = Buffer.alloc(zip.MAX_INFLATED_BYTES + 1024, 7);
  const buf = buildZip([{ name: 'stored-bomb.bin', data: big, method: 0 }]);
  const entries = zip.listEntries(buf);
  // Forge a tiny uncompressedSize into the central record (offset +24).
  const eocdOffset = buf.length - 22;
  const centralOffset = buf.readUInt32LE(eocdOffset + 16);
  buf.writeUInt32LE(10, centralOffset + 24);
  const lied = zip.listEntries(buf);
  assert.equal(lied[0].uncompressedSize, 10, 'sanity: the lie is in place');
  assert.throws(() => zip.extractEntry(buf, lied[0]), (err) => err.code === 'EZIPENTRYTOOBIG');
  assert.ok(entries, 'original listing was fine');
});

test('GATE FIX (QA W5): the central-directory size cap and corrupt-central branches are exercised', () => {
  const buf = buildZip([{ name: 'a.txt', data: 'aaaa' }]);
  const eocdOffset = buf.length - 22;
  // Oversized central directory claim -> EZIPCENTRALTOOBIG.
  const bigCd = Buffer.from(buf);
  bigCd.writeUInt32LE(zip.MAX_CENTRAL_DIR_BYTES + 1, eocdOffset + 12);
  assert.throws(() => zip.listEntries(bigCd), (err) => err.code === 'EZIPCENTRALTOOBIG' || err.code === 'EZIPCORRUPT');
  // Central directory extending past the EOCD -> EZIPCORRUPT.
  const pastEnd = Buffer.from(buf);
  pastEnd.writeUInt32LE(buf.length, pastEnd.length - 22 + 16); // offset beyond EOCD
  assert.throws(() => zip.listEntries(pastEnd), (err) => err.code === 'EZIPCORRUPT');
  // Inflated totalEntries walks past the real central dir -> EZIPCORRUPT.
  const extraEntries = Buffer.from(buf);
  extraEntries.writeUInt16LE(9, extraEntries.length - 22 + 10);
  assert.throws(() => zip.listEntries(extraEntries), (err) => err.code === 'EZIPCORRUPT');
});
