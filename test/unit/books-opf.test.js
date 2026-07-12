'use strict';

// [UNIT] v1.37.0 T2: lib/books/opf.js -- the scoped container.xml/OPF
// scanner. Locks: namespaced + bare element forms, EPUB3 cover-image
// property, EPUB2 meta-name-cover, the id/href "cover" heuristic, entity
// decoding, href resolution against the OPF directory, spine order, and
// every missing-field fallback (null, never a throw).

const { test } = require('node:test');
const assert = require('node:assert');

const opf = require('../../lib/books/opf');

test('T2: container.xml rootfile extraction (attribute order + namespace tolerant)', () => {
  assert.equal(
    opf.parseContainerRootfile('<container><rootfiles><rootfile media-type="application/oebps-package+xml" full-path="OEBPS/content.opf"/></rootfiles></container>'),
    'OEBPS/content.opf',
  );
  assert.equal(
    opf.parseContainerRootfile('<ns:container xmlns:ns="urn:x"><ns:rootfiles><ns:rootfile full-path=\'book.opf\'/></ns:rootfiles></ns:container>'),
    'book.opf',
  );
  assert.equal(opf.parseContainerRootfile('<container/>'), null);
  assert.equal(opf.parseContainerRootfile(null), null);
});

test('T2: EPUB3 OPF -- namespaced dc: metadata, properties="cover-image", spine order preserved', () => {
  const xml = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Autumn &amp; Winter</dc:title>
    <dc:creator id="a1">Le&#233;la Example</dc:creator>
  </metadata>
  <manifest>
    <item id="cov" href="images/cover.png" media-type="image/png" properties="cover-image"/>
    <item id="c2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/>
    <item id="c1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="c1"/><itemref idref="c2"/><itemref idref="ghost"/></spine>
</package>`;
  const parsed = opf.parseOpf(xml, 'OEBPS/content.opf');
  assert.equal(parsed.title, 'Autumn & Winter', 'entities decoded');
  assert.equal(parsed.author, 'Leéla Example', 'numeric character references decoded');
  assert.deepEqual(parsed.spine, [
    { idref: 'c1', href: 'OEBPS/text/ch1.xhtml' },
    { idref: 'c2', href: 'OEBPS/text/ch2.xhtml' },
  ], 'spine order preserved, hrefs OPF-relative-resolved, dangling idref dropped');
  assert.equal(parsed.coverEntryName, 'OEBPS/images/cover.png');
  assert.equal(parsed.coverMediaType, 'image/png');
});

test('T2: EPUB2 OPF -- bare dc elements + <meta name="cover" content="id"> cover form', () => {
  const xml = `<package version="2.0">
  <metadata>
    <title>Plain Two</title><creator>Old Author</creator>
    <meta content="mycover" name="cover"/>
  </metadata>
  <manifest>
    <item id="mycover" href="cover.jpeg" media-type="image/jpeg"/>
    <item id="ch" href="ch.html" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="ch"/></spine>
</package>`;
  const parsed = opf.parseOpf(xml, 'content.opf');
  assert.equal(parsed.title, 'Plain Two');
  assert.equal(parsed.author, 'Old Author');
  assert.equal(parsed.coverEntryName, 'cover.jpeg', 'root-level OPF resolves hrefs with no prefix');
  assert.equal(parsed.coverMediaType, 'image/jpeg');
});

test('T2: cover heuristic -- first image item whose id/href mentions cover, when neither spec form exists', () => {
  const xml = `<package><manifest>
    <item id="art" href="art/interior1.jpg" media-type="image/jpeg"/>
    <item id="x" href="art/Cover-Front.jpg" media-type="image/jpeg"/>
  </manifest><spine/></package>`;
  const parsed = opf.parseOpf(xml, 'OPS/pkg.opf');
  assert.equal(parsed.coverEntryName, 'OPS/art/Cover-Front.jpg');
});

test('T2: a non-image "cover" candidate never becomes the cover (media-type gate)', () => {
  const xml = `<package><manifest>
    <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>
  </manifest><spine/></package>`;
  assert.equal(opf.parseOpf(xml, 'x.opf').coverEntryName, null);
});

test('T2: missing/malformed fields degrade to nulls and empty spine -- never a throw', () => {
  for (const bad of ['', null, undefined, '<package/>', '<not-xml', 42]) {
    const parsed = opf.parseOpf(bad, 'content.opf');
    assert.equal(parsed.title, null);
    assert.equal(parsed.author, null);
    assert.deepEqual(parsed.spine, []);
    assert.equal(parsed.coverEntryName, null);
  }
});

test('T2: resolveOpfHref -- ./, ../, and nested resolution stays zip-entry-shaped', () => {
  assert.equal(opf.resolveOpfHref('OEBPS/content.opf', 'text/ch1.xhtml'), 'OEBPS/text/ch1.xhtml');
  assert.equal(opf.resolveOpfHref('OEBPS/content.opf', './cover.jpg'), 'OEBPS/cover.jpg');
  assert.equal(opf.resolveOpfHref('OEBPS/sub/content.opf', '../images/c.png'), 'OEBPS/images/c.png');
  assert.equal(opf.resolveOpfHref('content.opf', 'ch.xhtml'), 'ch.xhtml');
  assert.equal(opf.resolveOpfHref('a/b/c.opf', '../../up.xhtml'), 'up.xhtml');
});

test('T2: title text content strips nested markup (e.g. an embedded span) and trims', () => {
  const parsed = opf.parseOpf('<package><metadata><dc:title xmlns:dc="x">  The <span>Nested</span> Title  </dc:title></metadata><manifest/><spine/></package>', 'x.opf');
  assert.equal(parsed.title, 'The Nested Title');
});
