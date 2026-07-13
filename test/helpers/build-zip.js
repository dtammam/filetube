'use strict';

// v1.37.0 T1 test helper: a minimal ZIP WRITER, so the books tests can build
// real zip/EPUB fixtures in-memory at test time instead of committing binary
// fixtures to git (the stub-ffmpeg-on-PATH philosophy applied to fixtures).
// Deliberately supports exactly what the reader under test must handle:
// stored (method 0) and raw-DEFLATE (method 8) entries, optional
// data-descriptor flagging (GP bit 3 -- central sizes stay authoritative,
// which is precisely the property lib/books/zip.js relies on), optional
// encrypted flagging (GP bit 0 -- flag only; the reader must refuse before
// ever looking at the bytes), an optional archive comment, and an optional
// divergent LOCAL extra field (longer than the central copy's) to prove the
// reader positions data via the LOCAL header's own lengths.

const zlib = require('zlib');

/**
 * @param {Array<{name: string, data: (Buffer|string), method?: 0|8,
 *   withDescriptor?: boolean, encrypted?: boolean, localExtra?: Buffer}>} entries
 * @param {{comment?: string}} [opts]
 * @returns {Buffer} a well-formed zip file
 */
function buildZip(entries, opts = {}) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const spec of entries) {
    const nameBuf = Buffer.from(spec.name, 'utf8');
    const raw = Buffer.isBuffer(spec.data) ? spec.data : Buffer.from(String(spec.data), 'utf8');
    const method = spec.method === 0 ? 0 : 8;
    const stored = method === 0 ? raw : zlib.deflateRawSync(raw);
    const crc = zlib.crc32(raw) >>> 0;
    let flags = 0;
    if (spec.withDescriptor) flags |= 0x8;
    if (spec.encrypted) flags |= 0x1;
    const localExtra = Buffer.isBuffer(spec.localExtra) ? spec.localExtra : Buffer.alloc(0);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10); // mod time
    local.writeUInt16LE(0, 12); // mod date
    // A data-descriptor entry legally zeroes crc/sizes in the LOCAL header
    // (they live in the descriptor after the data); the reader must never
    // depend on them.
    local.writeUInt32LE(spec.withDescriptor ? 0 : crc, 14);
    local.writeUInt32LE(spec.withDescriptor ? 0 : stored.length, 18);
    local.writeUInt32LE(spec.withDescriptor ? 0 : raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(localExtra.length, 28);

    const descriptor = spec.withDescriptor ? (() => {
      const d = Buffer.alloc(16);
      d.writeUInt32LE(0x08074b50, 0); // optional descriptor signature
      d.writeUInt32LE(crc, 4);
      d.writeUInt32LE(stored.length, 8);
      d.writeUInt32LE(raw.length, 12);
      return d;
    })() : Buffer.alloc(0);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(stored.length, 20); // authoritative
    central.writeUInt32LE(raw.length, 24); // authoritative
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // central extra: none
    central.writeUInt16LE(0, 32); // comment: none
    central.writeUInt16LE(0, 34); // disk start
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42); // local header offset

    localParts.push(local, nameBuf, localExtra, stored, descriptor);
    centralParts.push(Buffer.concat([central, nameBuf]));
    offset += local.length + nameBuf.length + localExtra.length + stored.length + descriptor.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const commentBuf = Buffer.from(opts.comment || '', 'utf8');
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(commentBuf.length, 20);

  return Buffer.concat([...localParts, centralDir, eocd, commentBuf]);
}

/**
 * Build a minimal, VALID EPUB fixture (mimetype + container.xml + OPF +
 * chapters [+ cover]) for the scanner/OPF tests. Every part overridable.
 */
function buildEpub({ title = 'Fixture Book', author = 'Fixture Author', chapters = ['<p>Hello</p>'], coverData = null, opfExtra = '' } = {}) {
  const manifestChapters = chapters.map((_, i) => `<item id="ch${i}" href="ch${i}.xhtml" media-type="application/xhtml+xml"/>`).join('');
  const spineRefs = chapters.map((_, i) => `<itemref idref="ch${i}"/>`).join('');
  const coverManifest = coverData ? '<item id="cover-img" href="cover.jpg" media-type="image/jpeg" properties="cover-image"/>' : '';
  const opf = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${title}</dc:title>
    <dc:creator>${author}</dc:creator>
    ${opfExtra}
  </metadata>
  <manifest>${coverManifest}${manifestChapters}</manifest>
  <spine>${spineRefs}</spine>
</package>`;
  const container = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;
  const entries = [
    { name: 'mimetype', data: 'application/epub+zip', method: 0 },
    { name: 'META-INF/container.xml', data: container },
    { name: 'OEBPS/content.opf', data: opf },
    ...chapters.map((body, i) => ({
      name: `OEBPS/ch${i}.xhtml`,
      data: `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body>${body}</body></html>`,
    })),
  ];
  if (coverData) entries.push({ name: 'OEBPS/cover.jpg', data: coverData });
  return buildZip(entries);
}

module.exports = { buildZip, buildEpub };
