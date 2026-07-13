'use strict';

// [UNIT] v1.38.0 T4 — the TTS chunker + the block-contract lock. This is the
// wave's most important correctness invariant: the server chunker MUST split a
// chapter the same way the reader (public/js/read.js) computes a reading
// position's blockIndex, or "Listen from Here" lands on the wrong paragraph.

const { test } = require('node:test');
const assert = require('node:assert');

const chunk = require('../../lib/books/tts-chunk');
const reader = require('../../public/js/read.js');

// ---- §5.1 the lock: single source of truth, no drift possible ----------------

test('LOCK: the chunker derives its block tags + rev from read.js, never a forked copy', () => {
  // The chunker re-exports the SAME values it uses.
  assert.strictEqual(chunk.READER_BLOCK_SELECTOR, reader.READER_BLOCK_SELECTOR,
    'chunker selector must be identical to the reader contract');
  assert.strictEqual(chunk.READER_TTS_REV, reader.READER_TTS_REV,
    'chunker ttsRev must be identical to the reader constant (bump both in lockstep)');
  // The derived tag set is exactly the selector, tag-for-tag.
  const fromSelector = new Set(reader.READER_BLOCK_SELECTOR.split(',').map((s) => s.trim().toLowerCase()));
  assert.deepStrictEqual([...chunk.BLOCK_TAGS].sort(), [...fromSelector].sort());
});

// ---- §5.2 semantics: document order + nearest-ancestor direct text -----------

function texts(xhtml) {
  return chunk.chunkChapter(xhtml).map((b) => b.text);
}

test('a flat sequence of paragraphs/headings maps 1:1 in document order', () => {
  const xhtml = '<html><body><h1>Title</h1><p>First.</p><p>Second.</p></body></html>';
  const blocks = chunk.chunkChapter(xhtml);
  assert.deepStrictEqual(blocks, [
    { blockIndex: 0, text: 'Title' },
    { blockIndex: 1, text: 'First.' },
    { blockIndex: 2, text: 'Second.' },
  ]);
});

test('inline markup inside a block is captured as that block\'s text (never its own slot)', () => {
  // span/em/strong/a are NOT block-level -> no slot, but their text belongs to
  // the enclosing <p>, matching blockIndexForNode (nearest block ancestor).
  const xhtml = '<p>Hello <em>brave</em> <a href="x">new</a> world</p>';
  assert.deepStrictEqual(texts(xhtml), ['Hello brave new world']);
});

test('a nested block gets its OWN slot in document order; the ancestor keeps only its direct text', () => {
  // querySelectorAll order: blockquote(0), p(1). The reader lands a cursor
  // inside the <p> on index 1; a cursor in blockquote's own (empty) text on 0.
  const xhtml = '<blockquote><p>Quoted line.</p></blockquote>';
  const blocks = chunk.chunkChapter(xhtml);
  assert.deepStrictEqual(blocks, [
    { blockIndex: 0, text: '' },            // ancestor-only: no direct text
    { blockIndex: 1, text: 'Quoted line.' },
  ]);
});

test('list items and a paragraph nested in a list item each get a slot, in start-tag order', () => {
  const xhtml = '<ul><li>Alpha</li><li>Bravo <p>nested</p> tail</li></ul>';
  // Block start-tag order: li(0), li(1), p(2). The second li\'s direct text is
  // its own text nodes ("Bravo" + "tail"); the nested p is its own slot.
  const blocks = chunk.chunkChapter(xhtml);
  assert.deepStrictEqual(blocks, [
    { blockIndex: 0, text: 'Alpha' },
    { blockIndex: 1, text: 'Bravo tail' },
    { blockIndex: 2, text: 'nested' },
  ]);
});

test('entities are decoded and whitespace collapsed for spoken text', () => {
  const xhtml = '<p>Salt &amp; pepper &#8212; to\n\t   taste&#x2026;</p>';
  assert.deepStrictEqual(texts(xhtml), ['Salt & pepper — to taste…']);
});

test('comments, CDATA, script, and style contribute no spoken text', () => {
  const xhtml = '<p>Keep</p><!-- drop --><script>var x=1<2;</script><style>p{color:red}</style><p>This</p>';
  assert.deepStrictEqual(texts(xhtml), ['Keep', 'This']);
});

test('an attribute value containing ">" does not truncate the tag', () => {
  const xhtml = '<p title="a > b">Body</p>';
  assert.deepStrictEqual(texts(xhtml), ['Body']);
});

test('pre and td are block-level; text outside any block is not spoken', () => {
  const xhtml = 'loose text<pre>code here</pre><table><tr><td>cell</td></tr></table>trailing';
  assert.deepStrictEqual(texts(xhtml), ['code here', 'cell']);
});

test('the block COUNT equals the number of block-level start tags (index alignment with the reader)', () => {
  // 1 h2 + 3 p + 1 blockquote + 1 inner p + 2 li = 8 block elements.
  const xhtml = '<h2>H</h2><p>a</p><p>b</p><blockquote><p>c</p></blockquote><ul><li>d</li><li>e</li></ul><p>f</p>';
  const blocks = chunk.chunkChapter(xhtml);
  assert.strictEqual(blocks.length, 8);
  // Indices are 0..7 contiguous in document order.
  assert.deepStrictEqual(blocks.map((b) => b.blockIndex), [0, 1, 2, 3, 4, 5, 6, 7]);
});

test('empty / non-string input is handled fail-soft (no throw, empty result)', () => {
  assert.deepStrictEqual(chunk.chunkChapter(''), []);
  assert.deepStrictEqual(chunk.chunkChapter(null), []);
  assert.deepStrictEqual(chunk.chunkChapter(undefined), []);
});
