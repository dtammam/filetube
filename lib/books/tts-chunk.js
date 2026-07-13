'use strict';

// v1.38.0 TTS — the server-side chapter chunker. It splits a chapter's XHTML
// into "blocks" by EXACTLY the same rule the reader uses to compute a reading
// position's blockIndex (public/js/read.js: READER_BLOCK_SELECTOR +
// blockIndexForNode), so "Listen from Here" lands on the same paragraph the
// eye is on. This is the wave's single most important correctness invariant.
//
// The block rule (read.js): blockIndex is the DOCUMENT-ORDER index of the
// reading node's NEAREST block-level ancestor among ALL block-level elements
// (`doc.querySelectorAll(READER_BLOCK_SELECTOR)`). querySelectorAll returns
// elements in document order == the order of their START tags in a well-formed
// document, so this chunker assigns blockIndex at each block element's OPEN tag
// and attributes each run of text to the INNERMOST currently-open block (its
// nearest block ancestor). Nested blocks (e.g. `<blockquote><p>…</p></blockquote>`,
// `<li><p>…</p></li>`) therefore each get their own slot; an ancestor block that
// holds only nested blocks has empty direct text but STILL occupies its
// blockIndex slot so indices stay aligned with the reader's count (the worker
// gives such a slot the startSec of its first descendant block).
//
// NO server-side DOM dependency (new server runtime deps are barred; only
// ffmpeg + optional yt-dlp/piper). EPUB content documents are well-formed XHTML
// by spec, so a small SAX-style scan is sufficient; it is fail-soft (a
// malformed run degrades a chapter's timing slightly, never throws).
//
// This scan follows XML/XHTML rules (case-sensitive-lowercased tag match,
// self-closing `<p/>` respected, namespace prefixes NOT treated as block tags).
// The reader's blockIndexForNode runs against epub.js's parsed DOM; for the
// spec-conformant lowercase, unprefixed, well-nested XHTML the EPUB spec
// mandates, the two agree. Spec-VIOLATING markup (uppercase/prefixed tags, a
// stray `<td>` outside a table that a browser would foster-parent) can drift
// text attribution -- accepted as fail-soft (never a crash), and a bump of
// READER_TTS_REV re-syncs both sides if the rule ever changes.
//
// The block tag set + the version are DERIVED from read.js — one source of
// truth. Any change to READER_BLOCK_SELECTOR or READER_TTS_REV flows here
// automatically; test/unit/books-tts-chunk.test.js locks that they never fork.

const { READER_BLOCK_SELECTOR, READER_TTS_REV } = require('../../public/js/read.js');

// Derive the block-level tag set from the shared selector (single source of
// truth). The selector is a flat comma list of bare tag names.
const BLOCK_TAGS = new Set(
  READER_BLOCK_SELECTOR.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
);

// A minimal HTML entity decoder for spoken text — the XML five plus the handful
// of typographic/space entities that actually show up in EPUB prose, plus
// numeric (decimal + hex) references. Unknown named entities are left as-is
// (harmless in speech).
const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  nbsp: ' ', mdash: '—', ndash: '–', hellip: '…',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  copy: '©', reg: '®', trade: '™', deg: '°',
};

function decodeEntities(text) {
  if (text.indexOf('&') === -1) return text;
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      if (Number.isFinite(code) && code > 0 && code <= 0x10FFFF) {
        try { return String.fromCodePoint(code); } catch (_) { return match; }
      }
      return match;
    }
    const named = NAMED_ENTITIES[body];
    return named !== undefined ? named : match;
  });
}

// Find the index of the closing `>` for a tag that starts at `lt`, skipping
// `>` characters that live inside quoted attribute values.
function findTagEnd(html, lt) {
  let quote = null;
  for (let j = lt + 1; j < html.length; j++) {
    const ch = html[j];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '>') {
      return j;
    }
  }
  return -1;
}

// Parse a raw tag token like `<p class="x">`, `</p>`, `<br/>` into
// { name, isClose, selfClose } — or null for a non-element token.
function parseTag(rawTag) {
  const m = /^<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9:-]*)/.exec(rawTag);
  if (!m) return null;
  return {
    name: m[2].toLowerCase(),
    isClose: m[1] === '/',
    selfClose: /\/\s*>$/.test(rawTag),
  };
}

/**
 * Split chapter XHTML into blocks aligned with the reader's blockIndex.
 * @param {string} xhtml a chapter's XHTML content document
 * @returns {{blockIndex:number, text:string}[]} one entry per block-level
 *   element in document order; `text` is that block's DIRECT spoken text
 *   (whitespace-collapsed, entity-decoded), '' for an ancestor-only block.
 */
function chunkChapter(xhtml) {
  const html = typeof xhtml === 'string' ? xhtml : '';
  // Strip regions that never contribute spoken text or block structure.
  const cleaned = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, ' ')
    .replace(/<\?[\s\S]*?\?>/g, ' ')
    .replace(/<!DOCTYPE[^>]*>/gi, ' ')
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, ' ');

  const blocks = [];          // { blockIndex, tag, text } in start-tag order
  const openBlockStack = [];  // indices into `blocks` of currently-open blocks
  let i = 0;
  const n = cleaned.length;

  function appendText(raw) {
    if (openBlockStack.length === 0) return; // text outside any block: not spoken
    const collapsed = decodeEntities(raw).replace(/\s+/g, ' ').trim();
    if (collapsed === '') return;
    const top = blocks[openBlockStack[openBlockStack.length - 1]];
    top.text += (top.text ? ' ' : '') + collapsed;
  }

  while (i < n) {
    const lt = cleaned.indexOf('<', i);
    if (lt === -1) { appendText(cleaned.slice(i)); break; }
    if (lt > i) appendText(cleaned.slice(i, lt));
    const gt = findTagEnd(cleaned, lt);
    if (gt === -1) { appendText(cleaned.slice(lt)); break; } // unterminated: treat rest as text
    const rawTag = cleaned.slice(lt, gt + 1);
    i = gt + 1;
    const tag = parseTag(rawTag);
    if (!tag) continue;
    if (!BLOCK_TAGS.has(tag.name)) continue; // inline/void tag: structure-neutral, text already captured
    if (tag.isClose) {
      // Pop the nearest open block of this name (fail-soft on mismatch).
      for (let s = openBlockStack.length - 1; s >= 0; s--) {
        if (blocks[openBlockStack[s]].tag === tag.name) { openBlockStack.splice(s, 1); break; }
      }
    } else {
      blocks.push({ blockIndex: blocks.length, tag: tag.name, text: '' });
      if (!tag.selfClose) openBlockStack.push(blocks.length - 1);
    }
  }

  return blocks.map((b) => ({ blockIndex: b.blockIndex, text: b.text }));
}

module.exports = {
  chunkChapter,
  // Re-exported so the worker/cache key and the lock test read the SAME values
  // this chunker actually uses (never a re-declared copy).
  READER_BLOCK_SELECTOR,
  READER_TTS_REV,
  BLOCK_TAGS,
};
