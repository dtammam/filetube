'use strict';

// [UNIT] v1.379.0 Feed mode, plan D4: the CFI -> block inverse walker (a saved place
// without a blockIndex), the CFI parser, the excerpt collector and the dwell rule
// (lib/books/excerpt.js). The walker is bound against the chunker's block count on
// the SAME markup (one document, both rules), with the markup shapes the gate brief
// names: nested blocks, void tags, a style/script sibling, a self-closing block,
// comments and CDATA, a namespace-prefixed element, and the HTML parser's phantom
// <head>. The epub.js base arithmetic (2 * (index + 1)) is checked against the
// vendored source.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const x = require('../../lib/books/excerpt');
const chunk = require('../../lib/books/tts-chunk');
const { buildEpub } = require('../helpers/build-zip');

const DOC = '<?xml version="1.0"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title><style>p{color:red}</style></head>'
  + '<body><!-- <p>not a block</p> --><h1>Title</h1><p>First.</p><br><blockquote><p>Quoted <em>x</em>.</p></blockquote><p/>'
  + '<div><script>var s = "<p>never</p>";</script><p>Last.</p></div><svg:svg><svg:text>no block</svg:text></svg:svg><![CDATA[<p>cdata</p>]]></body></html>';

test('blockIndexForElementPath: the browser\'s element path (head /2, body /4, one even step per element) lands on the chunker\'s block', () => {
  // The chunker's slots on DOC: h1(0) p(1) blockquote(2) p-in-quote(3) p/(4) p-in-div(5). In the
  // live DOM: head /2, body /4; inside body the comment is no element, h1 /2, p /4, br /6 (void:
  // counted, never descended), blockquote /8 (its p /8/2), the self-closing p /10, div /12 (its
  // script /12/2, counted and never parsed; its p /12/4), the prefixed svg /14.
  const blocks = chunk.chunkChapterDetailed(DOC);
  assert.deepStrictEqual(blocks.map((b) => b.tag + ':' + b.text), ['h1:Title', 'p:First.', 'blockquote:', 'p:Quoted x .', 'p:', 'p:Last.']);
  assert.strictEqual(x.blockIndexForElementPath(DOC, [4, 2]), 0);
  assert.strictEqual(x.blockIndexForElementPath(DOC, [4, 4]), 1);
  assert.strictEqual(x.blockIndexForElementPath(DOC, [4, 8]), 2);
  assert.strictEqual(x.blockIndexForElementPath(DOC, [4, 8, 2]), 3);
  assert.strictEqual(x.blockIndexForElementPath(DOC, [4, 10]), 4);
  assert.strictEqual(x.blockIndexForElementPath(DOC, [4, 12, 4]), 5);
  // /4/8/2/2 would be the <em> inside the quoted paragraph (an inline element):
  // the nearest block ABOVE it is block 3, exactly what read.js blockIndexForNode walks up to.
  assert.strictEqual(x.blockIndexForElementPath(DOC, [4, 8, 2, 2]), 3);
  // the br (/4/6) and the svg (/4/14) are elements but no block encloses them
  assert.strictEqual(x.blockIndexForElementPath(DOC, [4, 6]), null);
  assert.strictEqual(x.blockIndexForElementPath(DOC, [4, 14, 2]), null);
  // body itself encloses no block -> null; a path that names no element -> null
  assert.strictEqual(x.blockIndexForElementPath(DOC, [4]), null);
  assert.strictEqual(x.blockIndexForElementPath(DOC, [4, 40]), null);
  assert.strictEqual(x.blockIndexForElementPath(DOC, []), null);
  assert.strictEqual(x.blockIndexForElementPath(DOC, [3]), null, 'an odd (text) step is not an element path');
});

test('blockIndexForElementPath: a source without <head> still has body at /4 (the HTML parser\'s phantom head), and lax markup does not swallow the chapter', () => {
  const noHead = '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body><p>a</p><p>b</p></body></html>';
  assert.strictEqual(x.blockIndexForElementPath(noHead, [4, 2]), 0);
  assert.strictEqual(x.blockIndexForElementPath(noHead, [4, 4]), 1);
  assert.strictEqual(x.blockIndexForElementPath(noHead, [2, 2]), null, 'nothing the feed knows lives under the phantom head');
  const withHead = '<html><head><title>t</title></head><body><p>a</p></body></html>';
  assert.strictEqual(x.blockIndexForElementPath(withHead, [4, 2]), 0, 'a real head is not doubled');
  const lax = '<html><body><p>a<br>b</p><p>c <span>d</p><p>e</p></body></html>';
  assert.strictEqual(x.blockIndexForElementPath(lax, [4, 2]), 0);
  assert.strictEqual(x.blockIndexForElementPath(lax, [4, 6]), 2, 'the unclosed span closes with its paragraph');
});

test('parseEpubCfi: the spine base and the even element steps; a text step and offset are dropped; assertions ignored', () => {
  assert.deepStrictEqual(x.parseEpubCfi('epubcfi(/6/4[ch1]!/4/2/6[p1]/1:10)'), { spineNodeIndex: 2, spineIndex: 1, steps: [4, 2, 6] });
  assert.deepStrictEqual(x.parseEpubCfi('epubcfi(/6/2!/4/2)'), { spineNodeIndex: 2, spineIndex: 0, steps: [4, 2] });
  assert.deepStrictEqual(x.parseEpubCfi('epubcfi(/8/10!/4)'), { spineNodeIndex: 3, spineIndex: 4, steps: [4] });
  assert.deepStrictEqual(x.parseEpubCfi('epubcfi(/6/4!)'), { spineNodeIndex: 2, spineIndex: 1, steps: [] }, 'a chapter-start CFI');
  // a range CFI (epub.js locations) keeps its start path
  assert.deepStrictEqual(x.parseEpubCfi('epubcfi(/6/4!/4/2,/1:0,/1:20)'), { spineNodeIndex: 2, spineIndex: 1, steps: [4, 2] });
  assert.strictEqual(x.parseEpubCfi('epubcfi(/6/3!/4/2)'), null, 'an odd spine step is not a spine item');
  assert.strictEqual(x.parseEpubCfi('/6/4!/4/2'), null);
  assert.strictEqual(x.parseEpubCfi('epubcfi(/6/4!/4/x)'), null);
  assert.strictEqual(x.parseEpubCfi(null), null);
  assert.strictEqual(x.parseEpubCfi(''), null);
  // the vendored epub.js carries the base arithmetic parseEpubCfi inverts (primary source, LESSONS 2/11)
  const vendored = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'vendor', 'epubjs', 'epub.min.js'), 'utf8');
  assert.ok(/generateChapterComponent\((\w),(\w),(\w)\)\{var \w="\/"\+2\*\(\1\+1\)\+"\/"/.test(vendored), 'epub.js builds the spine base as /2*(spineNodeIndex+1)/');
  assert.ok(vendored.includes('"srcdoc"in this.iframe?this.supportsSrcdoc=!0'), 'epub.js loads chapters through srcdoc (the HTML parser) - why the reader, not the server, resolves a block');
});



// ---- the collector ------------------------------------------------------------------

const CHAPTERS = [
  '<h1>One</h1><p>one two three</p><p>four five</p>',
  '', // a chapter with no text (pictures only) is skipped through
  '<h1>Three</h1><blockquote><p>six seven eight nine</p></blockquote><p>ten</p>',
];
const load = (s) => (CHAPTERS[s] === undefined ? null : chunk.chunkChapterDetailed('<html><body>' + CHAPTERS[s] + '</body></html>'));

test('collectExcerpt: stops at the target, next is the first block AFTER the excerpt, headings and chapter starts are marked', () => {
  const r = x.collectExcerpt({ loadBlocks: load, spineCount: 3, spineIndex: 0, blockIndex: 0, targetWords: 4 });
  assert.deepStrictEqual(r.blocks.map((b) => [b.spineIndex, b.blockIndex, b.text, b.heading, b.chapterStart]), [
    [0, 0, 'One', true, true],
    [0, 1, 'one two three', false, false],
  ]);
  assert.strictEqual(r.words, 4);
  assert.deepStrictEqual(r.next, { spineIndex: 0, blockIndex: 2 });
  assert.strictEqual(r.atEnd, false);
  assert.deepStrictEqual(r.start, { spineIndex: 0, blockIndex: 0 });
});

test('collectExcerpt: crosses an empty chapter into the next, skips ancestor-only slots, and ends the book with next null', () => {
  const r = x.collectExcerpt({ loadBlocks: load, spineCount: 3, spineIndex: 0, blockIndex: 2, targetWords: 6 });
  assert.deepStrictEqual(r.blocks.map((b) => [b.spineIndex, b.blockIndex, b.text]), [
    [0, 2, 'four five'],
    [2, 0, 'Three'],
    [2, 2, 'six seven eight nine'], // block 1 is the blockquote's empty slot
  ]);
  assert.strictEqual(r.blocks[1].chapterStart, true);
  assert.strictEqual(r.words, 7);
  assert.deepStrictEqual(r.next, { spineIndex: 2, blockIndex: 3 }, 'the block after the excerpt, in the same chapter');
  const tail = x.collectExcerpt({ loadBlocks: load, spineCount: 3, spineIndex: 2, blockIndex: 3, targetWords: 50 });
  assert.deepStrictEqual(tail.blocks.map((b) => b.text), ['ten']);
  assert.strictEqual(tail.next, null);
  assert.strictEqual(tail.atEnd, true);
});

test('collectExcerpt: a start on an empty slot moves to the next readable block; a chapter boundary at the target lands next on (s+1, 0)', () => {
  const r = x.collectExcerpt({ loadBlocks: load, spineCount: 3, spineIndex: 2, blockIndex: 1, targetWords: 1 });
  assert.deepStrictEqual(r.start, { spineIndex: 2, blockIndex: 2 });
  assert.deepStrictEqual(r.next, { spineIndex: 2, blockIndex: 3 });
  const b = x.collectExcerpt({ loadBlocks: load, spineCount: 3, spineIndex: 0, blockIndex: 1, targetWords: 5 });
  assert.deepStrictEqual(b.blocks.map((t) => t.text), ['one two three', 'four five']);
  assert.deepStrictEqual(b.next, { spineIndex: 2, blockIndex: 0 }, 'chapter 1 has no text, so the next READABLE position is chapter 3\'s start (never an empty chapter the write would refuse)');
});

test('collectExcerpt: nothing readable at or after the position is an empty excerpt at the end', () => {
  const r = x.collectExcerpt({ loadBlocks: load, spineCount: 3, spineIndex: 2, blockIndex: 4, targetWords: 10 });
  assert.deepStrictEqual(r.blocks, []);
  assert.strictEqual(r.atEnd, true);
  assert.strictEqual(r.next, null);
  assert.strictEqual(r.start, null);
  const past = x.collectExcerpt({ loadBlocks: load, spineCount: 3, spineIndex: 9, blockIndex: 0, targetWords: 10 });
  assert.strictEqual(past.atEnd, true);
});

test('collectExcerpt is bounded: the block cap stops a long excerpt with next on the following paragraph; a run of empty chapters ends the walk', () => {
  const many = (s) => (s < 50 ? chunk.chunkChapterDetailed('<html><body>' + '<p>w</p>'.repeat(10) + '</body></html>') : null);
  const r = x.collectExcerpt({ loadBlocks: many, spineCount: 50, spineIndex: 0, blockIndex: 0, targetWords: 5000 });
  assert.strictEqual(r.blocks.length, x.MAX_EXCERPT_BLOCKS);
  assert.deepStrictEqual(r.next, { spineIndex: 8, blockIndex: 0 }, '80 blocks = chapters 0-7; next is the first paragraph of chapter 8');
  assert.strictEqual(r.atEnd, false);
  let loads = 0;
  const sparse = (s) => { loads += 1; return s < 50 ? [] : null; };
  const q = x.collectExcerpt({ loadBlocks: sparse, spineCount: 50, spineIndex: 0, blockIndex: 0, targetWords: 10 });
  assert.deepStrictEqual(q.blocks, []);
  assert.strictEqual(q.next, null);
  assert.strictEqual(q.atEnd, true, 'no readable text within MAX_EMPTY_CHAPTERS consecutive text-less chapters reads as the end');
  assert.strictEqual(loads, x.MAX_EMPTY_CHAPTERS + 1, 'the walk loaded exactly the bounded run, not all 50 chapters');
  // a picture chapter inside a text book is skipped: text before, 3 empty, text after
  const gap = (s) => (s === 0 ? [{ blockIndex: 0, tag: 'p', text: 'a' }] : s === 4 ? [{ blockIndex: 0, tag: 'p', text: 'b' }] : s < 5 ? [] : null);
  const g = x.collectExcerpt({ loadBlocks: gap, spineCount: 5, spineIndex: 0, blockIndex: 0, targetWords: 1 });
  assert.deepStrictEqual(g.blocks.map((t) => t.text), ['a']);
  assert.deepStrictEqual(g.next, { spineIndex: 4, blockIndex: 0 });
  const capped = x.collectExcerpt({ loadBlocks: many, spineCount: 50, spineIndex: 0, blockIndex: 0, targetWords: 999999 });
  assert.ok(capped.blocks.length <= x.MAX_EXCERPT_BLOCKS, 'a huge words request is clamped to MAX_EXCERPT_WORDS and the block cap');
});

test('bookDwellSeconds: words / 300 per minute x 0.6, whole seconds, floor 5', () => {
  assert.strictEqual(x.bookDwellSeconds(450), 54);
  assert.strictEqual(x.bookDwellSeconds(300), 36);
  assert.strictEqual(x.bookDwellSeconds(10), 5);
  assert.strictEqual(x.bookDwellSeconds(0), 5);
  assert.strictEqual(x.bookDwellSeconds(NaN), 5);
  assert.strictEqual(x.READ_WORDS_PER_MINUTE, 300);
  assert.strictEqual(x.READ_DWELL_FRACTION, 0.6);
});

test('approximatePercent stays strictly inside (0, 100) so a feed-written place reads as "reading"', () => {
  assert.strictEqual(x.approximatePercent(0, 0, 10, 4), 0.01);
  assert.strictEqual(x.approximatePercent(1, 5, 10, 4), 37.5);
  assert.strictEqual(x.approximatePercent(3, 10, 10, 4), 99.99);
  assert.strictEqual(x.approximatePercent(0, 0, 0, 0), 0);
});

test('countWords splits on whitespace runs', () => {
  assert.strictEqual(x.countWords('  one two\n three  '), 3);
  assert.strictEqual(x.countWords(''), 0);
  assert.strictEqual(x.countWords(null), 0);
});

// ---- openEpubBook + resolveLocatorPosition against a real fixture EPUB -----------------

test('openEpubBook reads a fixture EPUB: chapter XHTML by spine index (memoized), blocks, the caps', () => {
  const file = path.join(require('node:os').tmpdir(), `ft-excerpt-${process.pid}.epub`);
  fs.writeFileSync(file, buildEpub({ chapters: ['<h1>A</h1><p>alpha</p>', '<p>beta</p>'] }));
  try {
    const book = x.openEpubBook(fs, { filePath: file, spine: [{ idref: 'ch0', href: 'OEBPS/ch0.xhtml' }, { idref: 'ch1', href: 'OEBPS/ch1.xhtml' }] });
    assert.strictEqual(book.spineCount, 2);
    assert.match(book.loadXhtml(0), /<p>alpha<\/p>/);
    assert.strictEqual(book.loadXhtml(0), book.loadXhtml(0));
    assert.strictEqual(book.loadXhtml(2), null);
    assert.strictEqual(book.loadXhtml(-1), null);
    assert.deepStrictEqual(book.loadBlocks(1).map((b) => b.text), ['beta']);
    assert.deepStrictEqual(book.loadBlocks(5), []);
    // a missing zip entry is a null chapter, not a throw
    const missing = x.openEpubBook(fs, { filePath: file, spine: [{ idref: 'z', href: 'OEBPS/zzz.xhtml' }] });
    assert.strictEqual(missing.loadXhtml(0), null);
    // no spine -> null (the feed never serves it)
    assert.strictEqual(x.openEpubBook(fs, { filePath: file, spine: [] }), null);
    // an unreadable file throws the fs error (the route answers 503)
    assert.throws(() => x.openEpubBook(fs, { filePath: file + '.nope', spine: [{ href: 'a' }] }), /ENOENT/);
    // a file over the cap is refused without reading it
    const fakeFs = { statSync: () => ({ size: x.MAX_EPUB_READ_BYTES + 1 }), readFileSync: () => { throw new Error('must not read'); } };
    assert.strictEqual(x.openEpubBook(fakeFs, { filePath: file, spine: [{ href: 'a' }] }), null);
  } finally {
    fs.rmSync(file, { force: true });
  }
});

test('resolveLocatorPosition: the reader\'s own spine+block when saved; else the CFI\'s chapter and block; null when nothing resolves', () => {
  const xhtml = '<html><body><p>a</p><p>b <em>c</em></p></body></html>';
  const loadXhtml = (s) => (s === 1 ? xhtml : null);
  assert.deepStrictEqual(x.resolveLocatorPosition({ kind: 'epub', cfi: 'epubcfi(/6/4!/4/4)', spineIndex: 1, blockIndex: 7 }, loadXhtml), { spineIndex: 1, blockIndex: 7 }, 'saved coordinates win');
  assert.deepStrictEqual(x.resolveLocatorPosition({ kind: 'epub', cfi: '', spineIndex: 1, blockIndex: 7 }, loadXhtml), { spineIndex: 1, blockIndex: 7 }, 'a feed-written block position (empty cfi)');
  assert.deepStrictEqual(x.resolveLocatorPosition({ kind: 'epub', cfi: 'epubcfi(/6/4!/4/4/2/1:3)' }, loadXhtml), { spineIndex: 1, blockIndex: 1 }, 'a text cursor inside <em> is its paragraph (body /4: the browser\'s phantom head)');
  assert.deepStrictEqual(x.resolveLocatorPosition({ kind: 'epub', cfi: 'epubcfi(/6/4!)' }, loadXhtml), { spineIndex: 1, blockIndex: 0 }, 'a chapter-start CFI');
  assert.deepStrictEqual(x.resolveLocatorPosition({ kind: 'epub', cfi: 'epubcfi(/6/4!/4/4)', spineIndex: 1 }, loadXhtml), { spineIndex: 1, blockIndex: 1 }, 'spineIndex without blockIndex: the block comes from the CFI');
  assert.strictEqual(x.resolveLocatorPosition({ kind: 'epub', cfi: 'epubcfi(/6/4!/2/4)' }, loadXhtml), null, 'a path under the (phantom) head resolves to nothing: fail closed');
  assert.strictEqual(x.resolveLocatorPosition({ kind: 'epub', cfi: 'epubcfi(/6/2!/4/4)' }, loadXhtml), null, 'a chapter the loader cannot read');
  assert.strictEqual(x.resolveLocatorPosition({ kind: 'epub', cfi: 'garbage' }, loadXhtml), null);
  assert.strictEqual(x.resolveLocatorPosition({ kind: 'pdf', page: 3 }, loadXhtml), null);
  assert.strictEqual(x.resolveLocatorPosition(null, loadXhtml), null);
});
