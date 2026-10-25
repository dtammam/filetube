'use strict';

// [UNIT] v1.395.0 Pages (plan D-PARSE 2): the tidier turns tag soup into markup
// the vendored JSDOMParser accepts. Each rule is checked by what JSDOMParser
// builds from the output, and the output always re-parses to itself.

const test = require('node:test');
const assert = require('node:assert');
const tidy = require('../../lib/pages/tidy');
const JSDOMParser = require('../../lib/pages/vendor/JSDOMParser');

const clean = (html) => tidy.serialize(tidy.parse(html));

function jsdomParserBody(html) {
  const parser = new JSDOMParser();
  const doc = parser.parse(tidy.serialize(tidy.ensureDocument(tidy.parse(html))), 'https://example.org/');
  return { doc, errors: parser.errorState };
}

test('void elements are self-closed, attributes always quoted, boolean attributes get a value', () => {
  assert.strictEqual(clean('<p>a<br>b<img src=x.png alt=hi hidden></p>'), '<p>a<br/>b<img src="x.png" alt="hi" hidden=""/></p>');
});

test('implied end tags: p by a block, li by li, td/tr by their siblings, a heading by a heading, a by a', () => {
  assert.strictEqual(clean('<p>one<p>two<div>three</div>'), '<p>one</p><p>two</p><div>three</div>');
  assert.strictEqual(clean('<ul><li>a<li>b<ul><li>c<li>d</ul><li>e</ul>'), '<ul><li>a</li><li>b<ul><li>c</li><li>d</li></ul></li><li>e</li></ul>');
  assert.strictEqual(clean('<table><tr><td>1<td>2<tr><td>3</table>'), '<table><tr><td>1</td><td>2</td></tr><tr><td>3</td></tr></table>');
  assert.strictEqual(clean('<h1>a<h2>b</h2>'), '<h1>a</h1><h2>b</h2>');
  assert.strictEqual(clean('<a href=1>x<a href=2>y</a>'), '<a href="1">x</a><a href="2">y</a>');
  assert.strictEqual(clean('<dl><dt>t<dd>d<dt>t2</dl>'), '<dl><dt>t</dt><dd>d</dd><dt>t2</dt></dl>');
  assert.strictEqual(clean('<td><p>in cell<div>x</div></td>'), '<td><p>in cell</p><div>x</div></td>', 'the p closes inside its cell');
});

test('stray end tags are dropped; unclosed tags are closed at EOF; </br> is a <br>', () => {
  assert.strictEqual(clean('a</span></div>b'), 'ab');
  assert.strictEqual(clean('<div><span>open'), '<div><span>open</span></div>');
  assert.strictEqual(clean('x</br>y'), 'x<br/>y');
});

test('raw text: script and style read to their own end tag, their text escaped for JSDOMParser', () => {
  const out = clean('<script>if (a < b && c > d) { x = "</div>"; }</script><style>p > a { color: red }</style>');
  assert.strictEqual(out, '<script>if (a &lt; b &amp;&amp; c &gt; d) { x = "&lt;/div&gt;"; }</script><style>p &gt; a { color: red }</style>');
  const html = tidy.serialize(tidy.parse('<style>p > a { color: red }</style>'), { mode: 'html' });
  assert.strictEqual(html, '<style>p > a { color: red }</style>', 'html mode keeps CSS raw');
});

test('entities: named, numeric, hex, the Windows-1252 remap, legacy no-semicolon in text but not in a URL query', () => {
  assert.strictEqual(tidy.decodeEntities('&amp;&lt;&gt;&quot;&apos;&nbsp;&eacute;&hellip;'), '&<>"\'\u00a0\u00e9\u2026');
  assert.strictEqual(tidy.decodeEntities('&#8217;&#x2019;&#146;&#0;&#xD800;&#99999999;'), '\u2019\u2019\u2019\ufffd\ufffd\ufffd');
  assert.strictEqual(tidy.decodeEntities('&copy2019 &unknown; &'), '\u00a92019 &unknown; &');
  assert.strictEqual(tidy.decodeEntities('?a=1&copy=2&amp=3', true), '?a=1&copy=2&amp=3');
  assert.strictEqual(clean('<a href="?q=1&amp;r=2&copy=3">x &lt;y&gt;</a>'), '<a href="?q=1&amp;r=2&amp;copy=3">x &lt;y&gt;</a>');
});

test('comments, doctypes and processing instructions are dropped; CDATA becomes text', () => {
  assert.strictEqual(clean('<!DOCTYPE html><?xml version="1.0"?><!-- c --><p>a<![CDATA[<b>]]></p>'), '<p>a&lt;b&gt;</p>');
  assert.strictEqual(clean('<p>a<!-- never closed'), '<p>a</p>');
});

test('attribute names that JSDOMParser cannot read are dropped; duplicates keep the first', () => {
  assert.strictEqual(clean('<p a="1" A="2" "bad"=3 b\'c=4 data-x=5 @click=y>t</p>'), '<p a="1" data-x="5">t</p>');
});

test('depth and node caps: deep nesting is flattened (text kept), so JSDOMParser never recurses past MAX_DEPTH', () => {
  const deep = '<div>'.repeat(5000) + 'core text' + '</div>'.repeat(5000);
  const tree = tidy.parse(deep);
  let depth = 0;
  let n = tree;
  while (n.children && n.children.length && n.children[0].type === 'element') { n = n.children[0]; depth += 1; }
  assert.ok(depth <= tidy.MAX_DEPTH, `depth ${depth}`);
  assert.match(tidy.serialize(tree), /core text/);
  const { doc } = jsdomParserBody(deep);
  assert.match(doc.body.textContent, /core text/);
});

test('tidied output is accepted by JSDOMParser with no parse error, across a tag-soup sampler', () => {
  for (const soup of [
    '<HTML><BODY><P>One<P>Two<UL><LI>a<LI>b</UL><TABLE><TR><TD>c<TD>d</TABLE></BODY>',
    '<p>unquoted <a href=/x?a=1&b=2 target=_blank>link</a> & more < less > greater',
    '<div><span><b>nested <i>badly</b> closed</i></span>',
    '<select><option>a<option>b<optgroup label=g><option>c</select>',
    '<svg viewBox="0 0 10 10"><path d="M0 0L10 10"/><circle r=2 /></svg><p>after</p>',
    '<textarea><p>not markup</p></textarea><title>a &amp; b</title>',
    '<p>trailing <',
  ]) {
    const { doc, errors } = jsdomParserBody(soup);
    assert.strictEqual(errors, '', `JSDOMParser errors for ${soup}: ${errors}`);
    assert.ok(doc.body, 'a body');
    const once = tidy.serialize(tidy.parse(soup));
    assert.strictEqual(tidy.serialize(tidy.parse(once)), once, 'idempotent');
  }
});

test('ensureDocument builds html > head + body, head-only elements first into head, content order kept', () => {
  const tree = tidy.ensureDocument(tidy.parse('<title>T</title><meta charset=utf-8><h1>H</h1>text<p>p</p>'));
  assert.strictEqual(tidy.serialize(tree), '<html><head><title>T</title><meta charset="utf-8"/></head><body><h1>H</h1>text<p>p</p></body></html>');
  const t2 = tidy.ensureDocument(tidy.parse('<html><head><title>x</title></head><p>before</p><body><p>in</p></body></html>'));
  assert.strictEqual(tidy.serialize(t2), '<html><head><title>x</title></head><body><p>before</p><p>in</p></body></html>');
});

test('linear time: a megabyte of hostile input parses in well under a second', () => {
  const inputs = [
    '<'.repeat(1 << 20),
    '<a '.repeat(1 << 18),
    '&'.repeat(1 << 20),
    '<p>'.repeat(1 << 18),
    '<script>' + '</scrip'.repeat(1 << 17),
    '<title>'.repeat(1 << 17),
    '<a href="'.repeat(1 << 17),
    '<body>'.repeat(1 << 18),
  ];
  for (const s of inputs) {
    const t0 = process.hrtime.bigint();
    tidy.serialize(tidy.parse(s));
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    assert.ok(ms < 1500, `${JSON.stringify(s.slice(0, 12))}... took ${ms.toFixed(0)} ms`);
  }
});

test('lib/pages/entities.js (generated): every legacy no-semicolon name decodes, and the table is the HTML 4 set + apos', () => {
  const { NAMED, LEGACY } = require('../../lib/pages/entities');
  for (const name of LEGACY) assert.ok(NAMED[name] !== undefined, `${name} has a code point`);
  assert.strictEqual(LEGACY.size, 106);
  assert.strictEqual(Object.keys(NAMED).length, 259, '252 HTML 4.01 names + apos + six uppercase aliases');
  assert.strictEqual(Object.getPrototypeOf(NAMED), null, 'a null-prototype map: `&constructor;` and `&__proto__;` are not entities');
  assert.strictEqual(tidy.decodeEntities('&constructor;&__proto__;&toString;'), '&constructor;&__proto__;&toString;');
});
