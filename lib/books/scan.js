'use strict';

// v1.37.0 T4 (books): the book scanner's PURE core -- walk configured book
// roots for .epub/.pdf, extract EPUB metadata/covers via the T1/T2 modules,
// and produce the next `db.books.items` map + cover-write instructions.
// This module does the fs READS (walk, file reads, cover writes are handed
// back as instructions so the server wiring owns all writes-with-state);
// it never touches the database -- server.js's `scanBooks()` wiring owns
// the single `updateDatabase` mutator and the scan-state machine, mirroring
// the media scan's Phase-1(extract)/Phase-2(merge) discipline.

const fs = require('fs');
const path = require('path');
const zip = require('./zip');
const opf = require('./opf');

const BOOK_EXTENSIONS = new Set(['.epub', '.pdf']);
// Read at most this much of an EPUB into memory for metadata extraction --
// EPUBs are single-digit MB; a 200MB "epub" is not a book we index covers
// for (it still indexes by filename).
const MAX_EPUB_READ_BYTES = 64 * 1024 * 1024;

const COVER_EXT_BY_TYPE = new Map([
  ['image/jpeg', '.jpg'],
  ['image/jpg', '.jpg'],
  ['image/png', '.png'],
]);

// Title fallback: the filename without extension, underscores/dots eased,
// whitespace collapsed. Never empty (falls back to the raw base name).
function titleFromFilename(filePath) {
  const base = path.basename(filePath, path.extname(filePath));
  const eased = base.replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim();
  return eased !== '' ? eased : base;
}

/**
 * Recursively walk one root for book files. Returns absolute file paths.
 * Symlinked directories are NOT followed (loop hygiene -- same posture as
 * the media walk); unreadable subtrees are skipped with a warn, never a
 * throw.
 */
function walkBookRoot(root) {
  const found = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    let dirents;
    try {
      dirents = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      console.warn(`books: skipping unreadable directory ${dir}: ${err && err.code}`);
      continue;
    }
    for (const dirent of dirents) {
      const full = path.join(dir, dirent.name);
      if (dirent.isDirectory()) {
        stack.push(full);
      } else if (dirent.isFile() && BOOK_EXTENSIONS.has(path.extname(dirent.name).toLowerCase())) {
        found.push(full);
      }
    }
  }
  return found;
}

/**
 * Extract EPUB metadata + cover bytes. Every failure degrades to the
 * filename-title shape (the scanner NEVER aborts on a weird book).
 * v1.37.0 gate fix (adversarial W2): ASYNC -- the file read is awaited
 * (fs.promises), so a large EPUB's I/O never blocks the event loop; the
 * zip/OPF parsing that follows is CPU-bounded to single-digit ms per book.
 * @returns {Promise<{ title, author, spine, cover: ({data: Buffer, ext: string}|null) }>}
 */
async function extractEpubMetadata(filePath) {
  const fallback = { title: titleFromFilename(filePath), author: '', spine: [], cover: null };
  try {
    const stat = await fs.promises.stat(filePath);
    if (stat.size > MAX_EPUB_READ_BYTES) {
      console.warn(`books: ${filePath} exceeds the ${MAX_EPUB_READ_BYTES}-byte metadata-read cap -- indexing by filename`);
      return fallback;
    }
    const buf = await fs.promises.readFile(filePath);
    const entries = zip.listEntries(buf);
    const containerXml = zip.extractEntryByName(buf, entries, 'META-INF/container.xml');
    if (!containerXml) return fallback;
    const opfPath = opf.parseContainerRootfile(containerXml.toString('utf8'));
    if (!opfPath) return fallback;
    const opfXml = zip.extractEntryByName(buf, entries, opfPath);
    if (!opfXml) return fallback;
    const parsed = opf.parseOpf(opfXml.toString('utf8'), opfPath);

    let cover = null;
    if (parsed.coverEntryName) {
      const ext = COVER_EXT_BY_TYPE.get(parsed.coverMediaType) || null;
      if (ext) {
        try {
          const data = zip.extractEntryByName(buf, entries, parsed.coverEntryName);
          if (data && data.length > 0) cover = { data, ext };
        } catch (err) {
          console.warn(`books: cover extraction failed for ${filePath} (${err && err.code}) -- placeholder card`);
        }
      }
    }

    return {
      title: parsed.title || fallback.title,
      author: parsed.author || '',
      spine: parsed.spine,
      cover,
    };
  } catch (err) {
    console.warn(`books: EPUB metadata extraction failed for ${filePath} (${(err && err.code) || (err && err.message)}) -- indexing by filename`);
    return fallback;
  }
}

/**
 * The scanner's Phase-1: walk every EXISTING root, build the next items map
 * against a snapshot of the previous one (unchanged path+size = reuse,
 * including previously-extracted metadata), and collect cover-write
 * instructions for new/changed EPUBs. Pure apart from fs READS; the caller
 * owns cover WRITES and the db merge.
 *
 * @param {string[]} folders configured book roots
 * @param {Object<string, object>} previousItems snapshot of db.books.items
 * @param {(filePath: string) => string} getMediaId the app's path-id hash
 * @returns {{ items: Object<string, object>, covers: Array<{id: string, ext: string, data: Buffer}>,
 *   survivingIds: Set<string>, missingRoots: string[] }}
 */
// v1.37.0 gate fix (adversarial W2): cooperative yield cadence -- the media
// scan's own SCAN_YIELD_BATCH discipline (v1.30 A2). Every N processed
// files the loop cedes a REAL macrotask (`setImmediate`, never a microtask)
// so a first scan of hundreds of books can never hold the event loop for a
// long synchronous stretch while requests queue.
const BOOK_SCAN_YIELD_BATCH = 8;

async function collectBooks(folders, previousItems, getMediaId) {
  const items = {};
  const covers = [];
  const survivingIds = new Set();
  const missingRoots = [];
  const prev = previousItems || {};
  let processed = 0;

  for (const root of Array.isArray(folders) ? folders : []) {
    if (typeof root !== 'string' || root === '') continue;
    if (!fs.existsSync(root)) {
      missingRoots.push(root);
      continue;
    }
    for (const filePath of walkBookRoot(root)) {
      processed += 1;
      if (processed % BOOK_SCAN_YIELD_BATCH === 0) {
        await new Promise((resolve) => setImmediate(resolve));
      }
      let stat;
      try {
        stat = await fs.promises.stat(filePath);
      } catch {
        continue; // vanished mid-walk
      }
      const id = getMediaId(filePath);
      survivingIds.add(id);
      const existing = prev[id];
      if (existing && existing.filePath === filePath && existing.size === stat.size) {
        items[id] = existing; // unchanged: reuse (incl. extracted metadata + cover flags)
        continue;
      }
      const ext = path.extname(filePath).toLowerCase();
      const format = ext === '.epub' ? 'epub' : 'pdf';
      const base = {
        id,
        filePath,
        rootFolder: root,
        folderName: path.basename(path.dirname(filePath)),
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        addedAt: (existing && existing.addedAt) || new Date().toISOString(),
        format,
        hasCover: false,
        coverExt: null,
      };
      if (format === 'epub') {
        const meta = await extractEpubMetadata(filePath);
        items[id] = { ...base, title: meta.title, author: meta.author, spine: meta.spine };
        if (meta.cover) {
          items[id].hasCover = true;
          items[id].coverExt = meta.cover.ext;
          covers.push({ id, ext: meta.cover.ext, data: meta.cover.data });
        }
      } else {
        // PDFs index by filename; cover + pageCount arrive via the one-shot
        // client backfill (POST /api/books/:id/cover) when first opened.
        items[id] = { ...base, title: titleFromFilename(filePath), author: '', spine: [] };
      }
    }
  }

  return { items, covers, survivingIds, missingRoots };
}

module.exports = {
  collectBooks,
  extractEpubMetadata,
  walkBookRoot,
  titleFromFilename,
  BOOK_EXTENSIONS,
};
