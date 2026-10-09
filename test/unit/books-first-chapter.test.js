'use strict';

// [UNIT] v1.380.0 (Feed, "Start something new"): the new-book card must offer the book's FIRST REAL CHAPTER, not its cover,
// copyright page or table of contents (lib/books/excerpt.js firstRealChapter), and the book's own dc:description as PLAIN
// TEXT (lib/books/opf.js plainDescription). The shapes below are the three the wild produces - a Standard-Ebooks-style EPUB 3
// with a landmarks nav, a Gutenberg-style EPUB 2 with a licence page and no nav, a Calibre-style EPUB with a cover page, a
// title page and a table of contents - plus the cases that must NOT be skipped (a real short opening, an opening that says
// "contents" or "cover" in passing) and the one that cannot be told apart (all front matter).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildZip } = require('../helpers/build-zip');
const excerpt = require('../../lib/books/excerpt');
const opf = require('../../lib/books/opf');

const words = (n, w = 'word') => Array.from({ length: n }, () => w).join(' ');
const para = (text) => `<p>${text}</p>`;
const story = (n) => `<h1>Chapter ${n}</h1>` + para(words(120, 'story')) + para(words(120, 'tale'));

// A throwaway EPUB on disk: items = [{id, href, body}], optional nav (landmarks body href) and extra OPF metadata.
function epub({ items, navBodymatter = null, metadata = '', guide = '' }) {
  const manifest = items.map((it) => `<item id="${it.id}" href="${it.href}" media-type="application/xhtml+xml"/>`).join('')
    + (navBodymatter !== null ? '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>' : '');
  const opfXml = `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>T</dc:title><dc:creator>A</dc:creator>${metadata}</metadata><manifest>${manifest}</manifest><spine>${items.map((it) => `<itemref idref="${it.id}"/>`).join('')}</spine>${guide}</package>`;
  const nav = navBodymatter === null ? null : `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="ch1.xhtml">One</a></li></ol></nav><nav epub:type="landmarks"><ol><li><a epub:type="cover" href="cover.xhtml">Cover</a></li><li><a epub:type="bodymatter" href="${navBodymatter}">Start</a></li></ol></nav></body></html>`;
  const entries = [
    { name: 'mimetype', data: 'application/epub+zip', method: 0 },
    { name: 'META-INF/container.xml', data: '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>' },
    { name: 'OEBPS/content.opf', data: opfXml },
    ...(nav ? [{ name: 'OEBPS/nav.xhtml', data: nav }] : []),
    ...items.map((it) => ({ name: `OEBPS/${it.href}`, data: `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body>${it.body}</body></html>` })),
  ];
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ft-firstch-')), 'b.epub');
  fs.writeFileSync(file, buildZip(entries));
  const spine = items.map((it) => ({ idref: it.id, href: `OEBPS/${it.href}` }));
  const book = excerpt.openEpubBook(fs, { filePath: file, spine });
  return { book, spine, cleanup: () => fs.rmSync(path.dirname(file), { recursive: true, force: true }) };
}

function firstOf(spec) {
  const e = epub(spec);
  try { return { ...excerpt.firstRealChapter(e.book, e.spine), info: e.book.packageInfo() }; } finally { e.cleanup(); }
}

test('Standard Ebooks shape: the landmarks nav names the first body item (rule: landmarks), whatever the heuristic would say', () => {
  const r = firstOf({
    navBodymatter: 'ch1.xhtml#start',
    items: [
      { id: 'cover', href: 'cover.xhtml', body: '<img src="c.jpg" alt=""/>' },
      { id: 'titlepage', href: 'titlepage.xhtml', body: '<h1>The Book</h1><p>A. Author</p>' },
      { id: 'imprint', href: 'imprint.xhtml', body: para('This ebook is the product of many hours. ' + words(60)) },
      { id: 'halftitle', href: 'halftitle.xhtml', body: '<h1>Part One</h1>' },
      { id: 'ch1', href: 'ch1.xhtml', body: story(1) },
    ],
  });
  assert.deepStrictEqual({ spineIndex: r.spineIndex, rule: r.rule }, { spineIndex: 4, rule: 'landmarks' });
});

test('landmarks naming a file that is not in the spine falls back to the heuristic', () => {
  const r = firstOf({
    navBodymatter: 'gone.xhtml',
    items: [{ id: 'cover', href: 'cover.xhtml', body: '<img src="c.jpg"/>' }, { id: 'ch1', href: 'ch1.xhtml', body: story(1) }],
  });
  assert.deepStrictEqual({ spineIndex: r.spineIndex, rule: r.rule }, { spineIndex: 1, rule: 'heuristic' });
});

test('Gutenberg shape (no nav): the licence/title pages and the contents are skipped by their text (rule: heuristic)', () => {
  const r = firstOf({
    items: [
      { id: 'pg-header', href: 'pg-header.xhtml', body: '<h2>Copyright</h2>' + para('This eBook is for the use of anyone anywhere. ' + words(40)) },
      { id: 'item2', href: 'part0001.xhtml', body: '<h2>Contents</h2><p>I. Down the Rabbit-Hole</p><p>II. The Pool of Tears</p>' },
      { id: 'item3', href: 'part0002.xhtml', body: story(1) },
    ],
  });
  assert.deepStrictEqual({ spineIndex: r.spineIndex, rule: r.rule }, { spineIndex: 2, rule: 'heuristic' });
});

test('Calibre shape (cover page, title page, copyright, contents, then the story): the first story item wins', () => {
  const r = firstOf({
    items: [
      { id: 'cover', href: 'cover.xhtml', body: '<div><img src="cover.jpg" alt="cover"/></div>' },
      { id: 'title', href: 'title_page.xhtml', body: '<h1>Title</h1><p>by Someone</p>' },
      { id: 'copy', href: 'copyright.xhtml', body: para('Copyright 2020. All rights reserved. ' + words(30)) },
      { id: 'dedication', href: 'section0004.xhtml', body: para('For my mother, with all my love.') },
      { id: 'toc', href: 'toc.xhtml', body: '<h1>Contents</h1><p>Chapter 1</p><p>Chapter 2</p>' },
      { id: 'ch1', href: 'chapter1.xhtml', body: story(1) },
    ],
  });
  assert.deepStrictEqual({ spineIndex: r.spineIndex, rule: r.rule }, { spineIndex: 5, rule: 'heuristic' });
});

test('a real chapter is never skipped: a long first item, a short real prologue, and a story that mentions "cover" or "contents"', () => {
  assert.deepStrictEqual(
    (({ spineIndex, rule }) => ({ spineIndex, rule }))(firstOf({ items: [{ id: 'ch1', href: 'ch1.xhtml', body: story(1) }, { id: 'ch2', href: 'ch2.xhtml', body: story(2) }] })),
    { spineIndex: 0, rule: 'spine-0' }, 'chapter 1 is the first item: nothing to skip');
  const prologue = firstOf({ items: [{ id: 'cover', href: 'cover.xhtml', body: '<img src="c.jpg"/>' }, { id: 'pro', href: 'prologue.xhtml', body: '<h1>Prologue</h1>' + para('The night the ship went down, the captain took the lamp and walked the deck one last time. ' + words(40, 'sea')) }, { id: 'ch1', href: 'ch1.xhtml', body: story(1) }] });
  assert.strictEqual(prologue.spineIndex, 1, 'a short prologue that is not front-matter shaped is the opening');
  const passing = firstOf({ items: [{ id: 'ch1', href: 'ch1.xhtml', body: para('She pulled the cover over the boat and read the contents of the letter twice. ' + words(40, 'quiet')) }, { id: 'ch2', href: 'ch2.xhtml', body: story(2) }] });
  assert.strictEqual(passing.spineIndex, 0, 'a short opening that only MENTIONS cover / contents is still the opening');
});

test('a book that is all front matter cannot be told apart: spine item 0, rule none', () => {
  const r = firstOf({ items: [{ id: 'cover', href: 'cover.xhtml', body: '<img src="c.jpg"/>' }, { id: 'toc', href: 'toc.xhtml', body: '<h1>Contents</h1>' }] });
  assert.deepStrictEqual({ spineIndex: r.spineIndex, rule: r.rule }, { spineIndex: 0, rule: 'none' });
});

test('the skip is bounded: front-matter-shaped items past the cap are not skipped forever', () => {
  const items = Array.from({ length: 30 }, (_, i) => ({ id: `f${i}`, href: `cover${i}.xhtml`, body: '<img src="c.jpg"/>' }));
  items.push({ id: 'ch1', href: 'ch1.xhtml', body: story(1) });
  const r = firstOf({ items });
  assert.strictEqual(r.rule, 'none', 'more than the cap of leading picture pages: give up at item 0 rather than guess');
});

// ---- the description: publisher text, made plain ------------------------------------------

test('plainDescription: markup, escaped markup, CDATA, entities and control characters become plain text, capped on a word', () => {
  assert.strictEqual(opf.plainDescription('A &amp; B'), 'A & B');
  assert.strictEqual(opf.plainDescription('&lt;p&gt;Hello &lt;b&gt;there&lt;/b&gt;&lt;/p&gt;'), 'Hello there');
  assert.strictEqual(opf.plainDescription('<![CDATA[<i>Wrapped</i> text]]>'), 'Wrapped text');
  assert.strictEqual(opf.plainDescription('<p>One</p><p>Two</p>'), 'One Two', 'paragraphs do not glue together');
  assert.strictEqual(opf.plainDescription('&lt;script&gt;alert(1)&lt;/script&gt;Safe'), 'Safe', 'script content is dropped, not shown');
  assert.strictEqual(opf.plainDescription('a\u0000b\u0007c'), 'a b c');
  assert.strictEqual(opf.plainDescription('   '), null);
  assert.strictEqual(opf.plainDescription(null), null);
  const long = opf.plainDescription(Array.from({ length: 300 }, (_, i) => `w${i}`).join(' '));
  assert.ok(long.length <= opf.DESCRIPTION_MAX_CHARS + 1 && long.endsWith('…'), 'capped with an ellipsis');
  assert.ok(!/<|>/.test(opf.plainDescription('x &lt;img src=x onerror=alert(1)&gt; y')), 'hostile markup leaves no angle bracket');
});

test('packageInfo reads dc:description on demand from the real zip (hostile OPF markup arrives as plain text)', () => {
  const e = epub({ items: [{ id: 'ch1', href: 'ch1.xhtml', body: story(1) }], metadata: '<dc:description>&lt;img src=x onerror=alert(1)&gt;A lighthouse &amp; a secret.&lt;p&gt;Second.&lt;/p&gt;</dc:description>' });
  try {
    const info = e.book.packageInfo();
    assert.strictEqual(info.description, 'A lighthouse & a secret. Second.');
    assert.strictEqual(e.book.packageInfo(), info, 'memoized');
  } finally { e.cleanup(); }
  const none = epub({ items: [{ id: 'ch1', href: 'ch1.xhtml', body: story(1) }] });
  try { assert.strictEqual(none.book.packageInfo().description, null); } finally { none.cleanup(); }
});

test('parseNavBodymatter: only the landmarks nav counts, the href resolves against the nav and loses its fragment', () => {
  const nav = '<nav epub:type="toc"><ol><li><a epub:type="bodymatter" href="WRONG.xhtml">x</a></li></ol></nav><nav epub:type="landmarks"><ol><li><a epub:type="bodymatter" href="../text/ch1.xhtml#a">Start</a></li></ol></nav>';
  assert.strictEqual(opf.parseNavBodymatter(nav, 'OEBPS/nav/nav.xhtml'), 'OEBPS/text/ch1.xhtml');
  assert.strictEqual(opf.parseNavBodymatter('<nav epub:type="toc"><ol></ol></nav>', 'nav.xhtml'), null);
  assert.strictEqual(opf.parseNavBodymatter(null, 'nav.xhtml'), null);
});

// gate r1 (adversary W2): the heuristic skipped real short first chapters whose text merely CONTAINED a front-matter word
test('a real short chapter 1 is never skipped for a front-matter word in its text (acknowledged, dedicated, cover, first edition, prologue)', () => {
  const openings = [
    'She acknowledged the storm with a nod and went below. ' + words(30, 'sea'),
    'Cover the windows, he said, and bar the door. ' + words(30, 'night'),
    'Prologue. The first edition of the map was lost in the fire. ' + words(30, 'ash'),
    'He had dedicated his life to the sea, and the sea had noticed. ' + words(30, 'salt'),
  ];
  for (const text of openings) {
    const r = firstOf({ items: [{ id: 'ch1', href: 'ch1.xhtml', body: para(text) }, { id: 'ch2', href: 'ch2.xhtml', body: story(2) }] });
    assert.deepStrictEqual({ spineIndex: r.spineIndex, rule: r.rule }, { spineIndex: 0, rule: 'spine-0' }, text.slice(0, 30));
  }
  // and the pages that ARE front matter by what they say still are
  const r = firstOf({ items: [{ id: 'a', href: 'a.xhtml', body: '<h2>Acknowledgements</h2>' + para('Thanks to everyone. ' + words(30)) }, { id: 'b', href: 'b.xhtml', body: para('Published by X. ISBN 978-0-00-000000-0. ' + words(20)) }, { id: 'c', href: 'c.xhtml', body: story(1) }] });
  assert.strictEqual(r.spineIndex, 2);
});

// gate r1 (adversary C2): a hostile OPF / nav must not stall the server (quadratic regexes froze it 26 s on a 1 KB EPUB)
test('hostile OPF and nav input is parsed in linear time (a megabyte of "<", unterminated tags, repeated openers)', () => {
  const timed = (fn) => { const t = Date.now(); fn(); return Date.now() - t; };
  const budget = 1500;
  assert.ok(timed(() => opf.parseOpf('<package><metadata><dc:description>' + '<'.repeat(200000) + '</dc:description></metadata></package>', 'a.opf')) < budget, 'description of "<"');
  assert.ok(timed(() => opf.parseOpf('<description>'.repeat(60000), 'a.opf')) < budget, 'repeated unterminated openers');
  assert.ok(timed(() => opf.plainDescription('<script '.repeat(100000))) < budget, 'unterminated script openers');
  assert.ok(timed(() => opf.parseNavBodymatter('<nav'.repeat(60000), 'n.xhtml')) < budget, 'repeated <nav');
  assert.ok(timed(() => opf.parseNavBodymatter('<nav epub:type="landmarks" '.repeat(30000), 'n.xhtml')) < budget, 'repeated landmarks openers');
  assert.ok(timed(() => opf.parseNavBodymatter('<nav epub:type="landmarks">' + '<a '.repeat(60000), 'n.xhtml')) < budget, 'unterminated anchors');
  // the bounds do not cost the ordinary case
  assert.strictEqual(opf.parseOpf('<package><metadata><dc:description>Fine &amp; plain</dc:description></metadata></package>', 'a.opf').description, 'Fine & plain');
});
