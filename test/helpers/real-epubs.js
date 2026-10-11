'use strict';

// v1.383.0 (plan 2026-10-10-feed-reels K3 b): three EPUBs shaped like the books people really have, for measuring the Feed's
// first-real-chapter rule and its chapter labels. Each one's front matter, file names and table of contents follow a real
// producer's output:
//   standardEbook()  an EPUB 3 in the Standard Ebooks shape: cover, titlepage, imprint, dedication, epigraph, then
//                    chapter-1..; a nav document with a toc AND a bodymatter landmark
//   calibreSplit()   an EPUB 2 as Calibre writes it after a conversion: titlepage.xhtml (the cover picture), then
//                    index_split_000 (title + copyright + ISBN), index_split_001 (contents), and chapters SPLIT over several
//                    files (Chapter 1 spans split_002 and split_003); an NCX table of contents, no nav, no landmarks
//   prologueBook()   an EPUB 2 from a publisher: cover, copyright, contents, a SHORT prologue (under 150 words), then
//                    chapter01..; an NCX whose entries point at the files with #fragments
// `expect` on each is what a reader of the book calls its first chapter: the spine item, and the label the book's own
// table of contents gives it.

const { buildZip } = require('./build-zip');

const PARA = 'The keeper climbed the stair at dusk as he had done every evening for eleven years, counting the steps out of habit rather than need, and at the top he stood for a moment with his hand on the cold brass of the rail and looked out at the water.';
const prose = (n) => Array.from({ length: n }, () => `<p>${PARA}</p>`).join('');
const xhtml = (body, title = 'x') => `<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>${title}</title></head><body>${body}</body></html>`;
const container = '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>';

function pack({ version, files, extraManifest = '', spineAttr = '', title, author }) {
  const manifest = files.map((f) => `<item id="${f.id}" href="${f.href}" media-type="application/xhtml+xml"${f.props ? ` properties="${f.props}"` : ''}/>`).join('') + extraManifest;
  const spine = files.filter((f) => !f.notInSpine).map((f) => `<itemref idref="${f.id}"/>`).join('');
  const opf = `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="${version}"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${title}</dc:title><dc:creator>${author}</dc:creator></metadata><manifest>${manifest}</manifest><spine${spineAttr}>${spine}</spine></package>`;
  return [
    { name: 'mimetype', data: 'application/epub+zip', method: 0 },
    { name: 'META-INF/container.xml', data: container },
    { name: 'OEBPS/content.opf', data: opf },
  ];
}

function standardEbook() {
  const files = [
    { id: 'cover', href: 'text/cover.xhtml', body: '<section epub:type="cover"><img src="../images/cover.svg" alt=""/></section>' },
    { id: 'titlepage', href: 'text/titlepage.xhtml', body: '<section epub:type="titlepage"><h1>The Keeper</h1><p>By Ann Harbour.</p></section>' },
    { id: 'imprint', href: 'text/imprint.xhtml', body: '<section epub:type="imprint"><h2>Imprint</h2><p>This ebook is the product of many hours of hard work by volunteers for Standard Ebooks, and builds on the hard work of other literature lovers made possible by the public domain.</p></section>' },
    { id: 'dedication', href: 'text/dedication.xhtml', body: '<section epub:type="dedication"><p>To the keepers of every light.</p></section>' },
    { id: 'epigraph', href: 'text/epigraph.xhtml', body: '<section epub:type="epigraph"><blockquote><p>The sea has many voices.</p></blockquote></section>' },
    ...[1, 2, 3, 4].map((n) => ({ id: `chapter-${n}`, href: `text/chapter-${n}.xhtml`, body: `<section epub:type="chapter"><h2>${['I', 'II', 'III', 'IV'][n - 1]}</h2>${prose(8)}</section>` })),
    { id: 'colophon', href: 'text/colophon.xhtml', body: '<section epub:type="colophon"><p>The Keeper was published in 1911.</p></section>' },
  ];
  const nav = xhtml('<nav epub:type="toc"><h2>Contents</h2><ol>'
    + '<li><a href="text/titlepage.xhtml">Titlepage</a></li><li><a href="text/imprint.xhtml">Imprint</a></li>'
    + '<li><a href="text/dedication.xhtml">Dedication</a></li><li><a href="text/epigraph.xhtml">Epigraph</a></li>'
    + [1, 2, 3, 4].map((n) => `<li><a href="text/chapter-${n}.xhtml">${['I', 'II', 'III', 'IV'][n - 1]}</a></li>`).join('')
    + '<li><a href="text/colophon.xhtml">Colophon</a></li></ol></nav>'
    + '<nav epub:type="landmarks"><ol><li><a href="text/titlepage.xhtml" epub:type="frontmatter">Front Matter</a></li><li><a href="text/chapter-1.xhtml" epub:type="bodymatter">Body</a></li></ol></nav>', 'Table of Contents');
  const entries = pack({ version: '3.0', files, extraManifest: '<item id="toc" href="toc.xhtml" media-type="application/xhtml+xml" properties="nav"/>', title: 'The Keeper', author: 'Ann Harbour' });
  entries.push({ name: 'OEBPS/toc.xhtml', data: nav });
  for (const f of files) entries.push({ name: `OEBPS/${f.href}`, data: xhtml(f.body) });
  return { buffer: buildZip(entries), title: 'The Keeper', expect: { spineIndex: 5, label: 'I', spineCount: files.length } };
}

function ncx(points) {
  return '<?xml version="1.0" encoding="UTF-8"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="x"/></head><docTitle><text>Book</text></docTitle><navMap>'
    + points.map((p, i) => `<navPoint id="np${i}" playOrder="${i + 1}"><navLabel><text>${p.label}</text></navLabel><content src="${p.src}"/>${p.children ? p.children.map((c, j) => `<navPoint id="np${i}_${j}" playOrder="${i + 1}${j}"><navLabel><text>${c.label}</text></navLabel><content src="${c.src}"/></navPoint>`).join('') : ''}</navPoint>`).join('')
    + '</navMap></ncx>';
}

function calibreSplit() {
  const files = [
    { id: 'titlepage', href: 'titlepage.xhtml', body: '<div><svg xmlns="http://www.w3.org/2000/svg"><image href="cover.jpeg"/></svg></div>' },
    { id: 'id1', href: 'index_split_000.html', body: '<p class="title">THE SALT ROAD</p><p>M. Castell</p><p>Copyright 2019 M. Castell. All rights reserved.</p><p>ISBN 978-0-00-000000-0</p>' },
    { id: 'id2', href: 'index_split_001.html', body: '<p>Contents</p><p>Chapter One</p><p>Chapter Two</p><p>Chapter Three</p>' },
    { id: 'id3', href: 'index_split_002.html', body: `<h2 class="chapter">Chapter One</h2>${prose(6)}` },
    { id: 'id4', href: 'index_split_003.html', body: prose(6) },
    { id: 'id5', href: 'index_split_004.html', body: `<h2 class="chapter">Chapter Two</h2>${prose(9)}` },
    { id: 'id6', href: 'index_split_005.html', body: `<h2 class="chapter">Chapter Three</h2>${prose(9)}` },
  ];
  const entries = pack({ version: '2.0', files, extraManifest: '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>', spineAttr: ' toc="ncx"', title: 'The Salt Road', author: 'M. Castell' });
  entries.push({ name: 'OEBPS/toc.ncx', data: ncx([
    { label: 'Chapter One', src: 'index_split_002.html#filepos1234' },
    { label: 'Chapter Two', src: 'index_split_004.html' },
    { label: 'Chapter Three', src: 'index_split_005.html' },
  ]) });
  for (const f of files) entries.push({ name: `OEBPS/${f.href}`, data: xhtml(f.body) });
  return { buffer: buildZip(entries), title: 'The Salt Road', expect: { spineIndex: 3, label: 'Chapter One', spineCount: files.length, continued: { spineIndex: 4, label: 'Chapter One' } } };
}

function prologueBook() {
  const files = [
    { id: 'cover', href: 'Text/cover.xhtml', body: '<div class="cover"><img src="../Images/cover.jpg" alt="Cover"/></div>' },
    { id: 'copy', href: 'Text/copyright.xhtml', body: '<p>Copyright © 2021 by Ruth Ober</p><p>All rights reserved. No part of this book may be reproduced without permission.</p>' },
    { id: 'toc', href: 'Text/contents.xhtml', body: '<h1>Contents</h1><p><a href="prologue.xhtml">Prologue</a></p><p><a href="chapter01.xhtml">1. The Ferry</a></p><p><a href="chapter02.xhtml">2. Low Water</a></p>' },
    { id: 'pro', href: 'Text/prologue.xhtml', body: '<h1 id="p">Prologue</h1><p>The ferry left at six. Nobody on the quay that morning would remember who had been aboard, and by the time anyone thought to ask, the tide had taken the only boat that could have carried the news across. It was the last ordinary day on the island, though none of them knew it yet, and the gulls went on with their business over the harbour roofs as they always had.</p>' },
    { id: 'c1', href: 'Text/chapter01.xhtml', body: `<h1 id="c1">1. The Ferry</h1>${prose(8)}` },
    { id: 'c2', href: 'Text/chapter02.xhtml', body: `<h1 id="c2">2. Low Water</h1>${prose(8)}` },
  ];
  const entries = pack({ version: '2.0', files, extraManifest: '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>', spineAttr: ' toc="ncx"', title: 'Low Water', author: 'Ruth Ober' });
  entries.push({ name: 'OEBPS/toc.ncx', data: ncx([
    { label: 'Cover', src: 'Text/cover.xhtml' },
    { label: 'Copyright', src: 'Text/copyright.xhtml' },
    { label: 'Prologue', src: 'Text/prologue.xhtml#p' },
    { label: '1. The Ferry', src: 'Text/chapter01.xhtml#c1' },
    { label: '2. Low Water', src: 'Text/chapter02.xhtml#c2' },
  ]) });
  for (const f of files) entries.push({ name: `OEBPS/${f.href}`, data: xhtml(f.body) });
  return { buffer: buildZip(entries), title: 'Low Water', expect: { spineIndex: 3, label: 'Prologue', spineCount: files.length } };
}

module.exports = { standardEbook, calibreSplit, prologueBook };
