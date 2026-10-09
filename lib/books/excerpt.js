'use strict';

// lib/books/excerpt.js - v1.379.0 Feed mode (plan D4/D5): the server-side pieces
// that turn a reading position into a plain-text excerpt, and a saved position
// into the block coordinates the feed works in.
//
// The feed's unit of position is the BLOCK: (spineIndex, blockIndex), where
// blockIndex is the reader's own rule (public/js/read.js READER_BLOCK_SELECTOR,
// counted in document order), implemented server-side by lib/books/tts-chunk.js.
// A position the feed writes is { kind:'epub', cfi:'', spineIndex, blockIndex }:
// an EMPTY cfi on purpose. The W1 measurement (tools/feed-proof/reader-resume.js)
// showed the server cannot write a CFI epub.js will honour: epub.js loads a
// chapter through srcdoc, so the HTML parser builds the live DOM (it always
// inserts a <head>, and it re-nests lax markup such as a self-closing <a/>),
// and an element path computed over the raw XHTML names the wrong node. The
// reader, which has that live DOM, resolves the block itself and asks epub.js
// for the node's CFI (read.js openEpub). The reader's own locators keep their
// text-precise CFI and are never rewritten here.
//
// The inverse (a saved CFI -> a block) is needed for a place the reader saved
// WITHOUT a blockIndex (pre-v1.38 locators, or a relocation whose range lookup
// failed). It walks the raw XHTML with ONE normalization of the HTML parser
// (a phantom <head> when the source has none, so <body> is /4 either way) and
// fails CLOSED: a path that does not land in a block resolves to null, and a
// null position is one the feed neither serves from nor moves.
//
// The walkers share the chunker's tag tokenizer (findTagEnd / parseTag) so
// element counting and block counting cannot disagree about where a tag ends.

const { chunkChapterDetailed, findTagEnd, parseTag, BLOCK_TAGS } = require('./tts-chunk');
const zip = require('./zip');

// HTML void elements: an EPUB's XHTML must self-close them, but a lax book writes
// `<br>`; counting one as an open container would swallow the rest of the chapter.
const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
// Elements whose BODY is raw text: counted as one element child, never descended
// (a `<p>` inside a script string is not an element in the browser's DOM either).
const RAW_TEXT_TAGS = new Set(['script', 'style']);

// The reading speed the dwell rule assumes (plan D4: words / 300 per minute x 0.6).
const READ_WORDS_PER_MINUTE = 300;
const READ_DWELL_FRACTION = 0.6;
// The excerpt collector's work bounds (a run of picture-only chapters is skipped
// through, never scanned forever; each chapter costs one inflate).
const MAX_EXCERPT_BLOCKS = 80;
const MAX_EMPTY_CHAPTERS = 12;
const DEFAULT_EXCERPT_WORDS = 450;
const MAX_EXCERPT_WORDS = 1500;

// The same non-element regions the chunker strips, so the walker never sees a tag
// inside a comment, CDATA section, processing instruction or doctype.
function stripNonElements(html) {
  return String(html || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, ' ')
    .replace(/<\?[\s\S]*?\?>/g, ' ')
    .replace(/<!DOCTYPE[^>]*>/gi, ' ');
}

// Walk a chapter's element tree once, calling `visit(frame)` at every element
// start tag. A frame is { name, steps, blockIndex|null }: `steps` is the CFI
// even-step path from the document element's children down to this element (the
// document element itself has steps [] and is never a block), `blockIndex` is the
// chunker's slot when the element is block-level. Returning a non-undefined value
// from `visit` stops the walk and returns it.
//
// One HTML-parser normalization, because the reader's CFIs come from epub.js's
// srcdoc-loaded (HTML-parsed) DOM: a document element whose first element child
// is not <head> gets a phantom head, so <body> is the SECOND child (/4) exactly as
// the browser sees it.
function walkElements(xhtml, visit) {
  const html = stripNonElements(xhtml);
  const n = html.length;
  const root = { name: '#document', steps: null, children: 0, blockIndex: null, isDocumentElement: false };
  const stack = [root];
  let blockCount = 0;
  let i = 0;
  while (i < n) {
    const lt = html.indexOf('<', i);
    if (lt === -1) break;
    const gt = findTagEnd(html, lt);
    if (gt === -1) break;
    const rawTag = html.slice(lt, gt + 1);
    i = gt + 1;
    const tag = parseTag(rawTag);
    if (!tag) continue;
    if (tag.isClose) {
      for (let s = stack.length - 1; s >= 1; s--) {
        if (stack[s].name === tag.name) { stack.length = s; break; }
      }
      continue;
    }
    const parent = stack[stack.length - 1];
    if (parent.isDocumentElement && parent.children === 0 && tag.name !== 'head') parent.children += 1; // the phantom <head>
    parent.children += 1;
    // The document element (html) is the root's child; the CFI path starts at ITS
    // children, so the document element's own step is dropped.
    const steps = parent === root ? [] : parent.steps.concat(parent.children * 2);
    const isBlock = BLOCK_TAGS.has(tag.name);
    const frame = { name: tag.name, steps, children: 0, blockIndex: isBlock ? blockCount : null, isDocumentElement: parent === root };
    if (isBlock) blockCount += 1;
    const out = visit(frame);
    if (out !== undefined) return out;
    if (RAW_TEXT_TAGS.has(tag.name)) {
      if (!tag.selfClose) {
        const close = html.toLowerCase().indexOf('</' + tag.name, i);
        if (close === -1) break;
        const closeEnd = findTagEnd(html, close);
        if (closeEnd === -1) break;
        i = closeEnd + 1;
      }
      continue;
    }
    if (tag.selfClose || VOID_TAGS.has(tag.name)) continue;
    stack.push(frame);
  }
  return undefined;
}

/**
 * The blockIndex of the nearest block-level element AT or ABOVE the element a CFI
 * path names (the reader's blockIndexForNode rule: a cursor inside an inline
 * element belongs to its nearest block ancestor). `steps` is the even element
 * steps only (parseEpubCfi strips the text step). Null when the path names no
 * element on the chain or no block encloses it - fail closed.
 */
function blockIndexForElementPath(xhtml, steps) {
  if (!Array.isArray(steps) || steps.length === 0 || steps.some((s) => !Number.isInteger(s) || s <= 0 || s % 2 !== 0)) return null;
  let deepest = null;
  const found = walkElements(xhtml, (frame) => {
    if (frame.steps.length > steps.length) return undefined;
    for (let k = 0; k < frame.steps.length; k++) if (frame.steps[k] !== steps[k]) return undefined;
    // frame.steps is a prefix of the target: this element is on the chain.
    if (frame.blockIndex !== null) deepest = frame.blockIndex;
    if (frame.steps.length === steps.length) return deepest === null ? -1 : deepest;
    return undefined;
  });
  if (found === undefined || found === -1) return null;
  return found;
}

/**
 * Parse an epub.js CFI into the parts the feed needs:
 * { spineNodeIndex, spineIndex, steps } - `steps` are the even element steps of
 * the content path (a trailing text step and offset are dropped). Null for
 * anything that is not a two-part spine CFI. epub.js builds the base as
 * "/" + 2 * (spineNodeIndex + 1) + "/" + 2 * (spineIndex + 1) (vendored source,
 * generateChapterComponent), so the spine item is itemStep / 2 - 1.
 */
function parseEpubCfi(cfi) {
  if (typeof cfi !== 'string') return null;
  const m = /^epubcfi\(\/(\d+)\/(\d+)(?:\[[^\]]*\])?!((?:\/\d+(?:\[[^\]]*\])?)*)(?::\d+)?(?:,[^)]*)?\)$/.exec(cfi.trim());
  if (!m) return null;
  const spineStep = Number(m[1]);
  const itemStep = Number(m[2]);
  if (spineStep % 2 !== 0 || itemStep % 2 !== 0 || spineStep < 2 || itemStep < 2) return null;
  const steps = [];
  for (const part of m[3].split('/')) {
    if (part === '') continue;
    const step = Number(part.replace(/\[[^\]]*\]$/, ''));
    if (!Number.isInteger(step) || step <= 0) return null;
    if (step % 2 !== 0) break; // a text node: the element path ended one step up
    steps.push(step);
  }
  return { spineNodeIndex: spineStep / 2 - 1, spineIndex: itemStep / 2 - 1, steps };
}

function countWords(text) {
  const t = String(text || '').trim();
  return t === '' ? 0 : t.split(/\s+/).length;
}

/**
 * Collect about `targetWords` of plain text from (spineIndex, blockIndex) on,
 * crossing into the next spine items when a chapter ends. `loadBlocks(spineIndex)`
 * returns that chapter's detailed blocks (chunkChapterDetailed) or null.
 *
 * @returns {{ blocks: Array<{spineIndex:number, blockIndex:number, text:string, heading:boolean, chapterStart:boolean}>,
 *   words: number, next: {spineIndex:number, blockIndex:number}|null, atEnd: boolean,
 *   start: {spineIndex:number, blockIndex:number}|null }}
 *   `next` is the first block WITH TEXT after the excerpt - what the bookmark moves
 *   to when the card is read, always a real block of its chapter (never an empty
 *   slot or a text-less chapter). Null (`atEnd`) when no readable block remains
 *   within the walk's bounds: the book is finished. `start` is the first block
 *   actually included (an empty slot at the requested position is skipped). The
 *   walk is bounded by MAX_EXCERPT_BLOCKS and by MAX_EMPTY_CHAPTERS consecutive
 *   text-less spine items (a run of picture pages).
 */
function collectExcerpt({ loadBlocks, spineCount, spineIndex, blockIndex, targetWords }) {
  const want = Number.isInteger(targetWords) && targetWords > 0 ? Math.min(targetWords, MAX_EXCERPT_WORDS) : DEFAULT_EXCERPT_WORDS;
  const out = [];
  let words = 0;
  let s = Number.isInteger(spineIndex) && spineIndex >= 0 ? spineIndex : 0;
  let b = Number.isInteger(blockIndex) && blockIndex >= 0 ? blockIndex : 0;
  let emptyRun = 0;
  let start = null;
  let next = null;
  outer: while (s < spineCount && emptyRun <= MAX_EMPTY_CHAPTERS) {
    const blocks = loadBlocks(s) || [];
    let chapterHadText = false;
    let chapterStart = b === 0;
    for (; b < blocks.length; b++) {
      const text = String(blocks[b].text || '').trim();
      if (text === '') continue;
      chapterHadText = true;
      if (words >= want || out.length >= MAX_EXCERPT_BLOCKS) { next = { spineIndex: s, blockIndex: b }; break outer; }
      if (!start) start = { spineIndex: s, blockIndex: b };
      out.push({ spineIndex: s, blockIndex: b, text, heading: /^h[1-6]$/.test(blocks[b].tag || ''), chapterStart });
      chapterStart = false;
      words += countWords(text);
    }
    emptyRun = chapterHadText ? 0 : emptyRun + 1;
    s += 1;
    b = 0;
  }
  return { blocks: out, words, next, atEnd: next === null, start };
}

// How long a card has to be active before moving on counts as having read it
// (plan D4): words / 300 per minute x 0.6, in whole seconds, never under 5 s.
function bookDwellSeconds(words) {
  const w = Number(words);
  if (!Number.isFinite(w) || w <= 0) return 5;
  return Math.max(5, Math.ceil((w / READ_WORDS_PER_MINUTE) * 60 * READ_DWELL_FRACTION));
}

// A coarse percent for a (spine, block) position - the reader replaces it with its
// own locations-based number on the next open; this only has to keep the book in
// the "currently reading" band (0 < percent < 98) honestly.
function approximatePercent(spineIndex, blockIndex, blockCount, spineCount) {
  if (!Number.isInteger(spineCount) || spineCount <= 0) return 0;
  const within = Number.isInteger(blockCount) && blockCount > 0 ? Math.min(1, Math.max(0, blockIndex / blockCount)) : 0;
  const pct = ((spineIndex + within) / spineCount) * 100;
  return Math.max(0.01, Math.min(99.99, Math.round(pct * 100) / 100));
}

// The scanner's own read cap (lib/books/scan.js MAX_EPUB_READ_BYTES): a book over
// it was indexed by filename with no spine, so the feed never reaches it; the cap
// here guards a file that GREW since its scan.
const MAX_EPUB_READ_BYTES = 64 * 1024 * 1024;

/**
 * Open an indexed EPUB for the feed: one synchronous read of the file (the TTS
 * worker's own pattern, lib/media/transcode.js runChapterSynthesis), the zip
 * directory, and a per-call memo of chapter XHTML by spine index. Returns null for
 * a book with no usable spine; throws the fs error for an unreadable file (the
 * caller answers 503).
 *
 * @param {object} fsImpl node:fs (injected so a route test can fail the read)
 * @param {{filePath:string, spine:Array<{href:string}>}} book the books_items record
 */
function openEpubBook(fsImpl, book) {
  if (!book || typeof book.filePath !== 'string' || !Array.isArray(book.spine) || book.spine.length === 0) return null;
  const stat = fsImpl.statSync(book.filePath);
  if (stat.size > MAX_EPUB_READ_BYTES) return null;
  const buf = fsImpl.readFileSync(book.filePath);
  const entries = zip.listEntries(buf);
  const memo = new Map();
  return {
    spineCount: book.spine.length,
    /** The chapter's XHTML text, or null when the spine item is out of range or missing from the zip. */
    loadXhtml(spineIndex) {
      if (!Number.isInteger(spineIndex) || spineIndex < 0 || spineIndex >= book.spine.length) return null;
      if (memo.has(spineIndex)) return memo.get(spineIndex);
      const entry = book.spine[spineIndex];
      const xhtmlBuf = entry && typeof entry.href === 'string' ? zip.extractEntryByName(buf, entries, entry.href) : null;
      const text = xhtmlBuf ? xhtmlBuf.toString('utf8') : null;
      memo.set(spineIndex, text);
      return text;
    },
    /** The chapter's detailed blocks (chunkChapterDetailed), [] for a missing chapter. */
    loadBlocks(spineIndex) {
      const text = this.loadXhtml(spineIndex);
      return text === null ? [] : chunkChapterDetailed(text);
    },
  };
}

/**
 * The feed's coordinates for a stored EPUB locator: the locator's own spineIndex +
 * blockIndex when the reader (or the feed) saved both; else the CFI's spine step
 * and, through `loadXhtml`, the nearest block its element path lands in. Null when
 * neither resolves (the feed then neither serves from nor moves this position).
 */
function resolveLocatorPosition(locator, loadXhtml) {
  if (!locator || locator.kind !== 'epub') return null;
  if (Number.isInteger(locator.spineIndex) && locator.spineIndex >= 0 && Number.isInteger(locator.blockIndex) && locator.blockIndex >= 0) {
    return { spineIndex: locator.spineIndex, blockIndex: locator.blockIndex };
  }
  const parsed = parseEpubCfi(locator.cfi);
  if (!parsed) return null;
  const spineIndex = Number.isInteger(locator.spineIndex) && locator.spineIndex >= 0 ? locator.spineIndex : parsed.spineIndex;
  if (parsed.steps.length === 0) return { spineIndex, blockIndex: 0 }; // a chapter-start CFI
  const xhtml = typeof loadXhtml === 'function' ? loadXhtml(spineIndex) : null;
  if (xhtml === null || xhtml === undefined) return null;
  const blockIndex = blockIndexForElementPath(xhtml, parsed.steps);
  return blockIndex === null ? null : { spineIndex, blockIndex };
}

module.exports = {
  openEpubBook,
  resolveLocatorPosition,
  blockIndexForElementPath,
  parseEpubCfi,
  collectExcerpt,
  countWords,
  bookDwellSeconds,
  approximatePercent,
  chunkChapterDetailed,
  MAX_EPUB_READ_BYTES,
  DEFAULT_EXCERPT_WORDS,
  MAX_EXCERPT_WORDS,
  MAX_EXCERPT_BLOCKS,
  MAX_EMPTY_CHAPTERS,
  READ_WORDS_PER_MINUTE,
  READ_DWELL_FRACTION,
};
