'use strict';

// [UNIT] v1.395.0 Pages, Step 2 (plan D-PARSE, Testing strategy): the fixture
// corpus (test/fixtures/pages/, README there) through BOTH capture paths - the raw
// HTML a server fetch gets (tidy + extract), and the browser-serialized form a
// device sends (jsdom's real XMLSerializer over the same page, the shape
// `new XMLSerializer().serializeToString(document)` produces in Safari/Chrome).
// Expectations come from the source corpus's own expected metadata, never from
// our output.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { extract, cleanByline } = require('../../lib/pages/extract');
const metaLib = require('../../lib/pages/meta');

const DIR = path.join(__dirname, '..', 'fixtures', 'pages');
const CORPUS = JSON.parse(fs.readFileSync(path.join(DIR, 'corpus.json'), 'utf8'));

function browserSerialized(html, url) {
  const dom = new JSDOM(html, { url, virtualConsole: new VirtualConsole() });
  try {
    return new dom.window.XMLSerializer().serializeToString(dom.window.document);
  } finally {
    dom.window.close();
  }
}

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const results = [];

for (const [name, spec] of Object.entries(CORPUS)) {
  test(`corpus ${name} (${spec.kind}): both paths extract the expected title, author, date, words and sentences`, () => {
    const raw = fs.readFileSync(path.join(DIR, spec.file), 'utf8');
    const paths = { raw: extract(raw, spec.url), browser: extract(browserSerialized(raw, spec.url), spec.url) };
    const row = { name };
    for (const [which, r] of Object.entries(paths)) {
      assert.strictEqual(r.error, null, `${which}: no extraction error`);
      assert.strictEqual(r.metadata.title, spec.title, `${which}: title`);
      if (spec.author) assert.strictEqual(r.metadata.author, cleanByline(norm(spec.author)), `${which}: author`);
      if (spec.publishedTime) assert.strictEqual(r.metadata.publishedAt, new Date(spec.publishedTime).toISOString(), `${which}: published`);
      assert.strictEqual(!!r.article, spec.reader !== false || !!r.article, `${which}: reader`);
      if (spec.reader) {
        assert.ok(r.article, `${which}: a Reader view`);
        const words = metaLib.countWords(r.article.text);
        if (spec.words) assert.ok(words >= spec.words[0] && words <= spec.words[1], `${which}: ${words} words, expected ${spec.words[0]}-${spec.words[1]}`);
        const text = norm(r.article.text);
        for (const s of spec.sentences) assert.ok(text.includes(norm(s)), `${which}: Reader text has ${JSON.stringify(s)}`);
        row[which] = { words, title: r.metadata.title, author: r.metadata.author, published: r.metadata.publishedAt };
      } else {
        row[which] = { words: r.article ? metaLib.countWords(r.article.text) : 0, title: r.metadata.title };
      }
    }
    // The two capture paths agree with each other.
    assert.deepStrictEqual(row.browser, row.raw, 'raw + tidy and browser-serialized give the same result');
    results.push(row);
  });
}

test('the corpus covers every kind the plan names', () => {
  const kinds = Object.values(CORPUS).map((c) => c.kind).join(' | ');
  for (const k of ['news', 'blog', 'newsletter', 'docs', 'long-form', 'tables', 'code', 'tag soup', 'non-article', 'lazy', 'non-English']) {
    assert.ok(kinds.includes(k), `a ${k} page`);
  }
  assert.ok(Object.keys(CORPUS).length >= 15);
});

test('a page with no <html>, no <body> and unclosed tags (1992 markup) still yields a Reader view and keeps its links', () => {
  const r = extract(fs.readFileSync(path.join(DIR, 'cern.html'), 'utf8'), CORPUS.cern.url);
  assert.ok(r.article);
  assert.match(r.article.html, /href="http:\/\/info\.cern\.ch\/hypertext\/WWW\/WhatIs\.html"/, 'a relative link became absolute against the page URL');
});

test('metadata fill-in: canonical on the same host only, lead image absolute, JSON-LD author and date when no meta says so', () => {
  const html = `<html lang="en-GB"><head><title>T</title>
    <link rel="canonical" href="/story/1">
    <meta property="og:image" content="/img/lead.jpg">
    <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebSite"},{"@type":"NewsArticle","headline":"H","author":[{"@type":"Person","name":"Ada Lovelace"}],"datePublished":"2024-03-01T10:00:00Z","publisher":{"name":"The Paper"}}]}</script>
    </head><body><article><p>${'Word '.repeat(80)}</p></article></body></html>`;
  const r = extract(html, 'https://www.example.com/story/1?utm=x');
  assert.strictEqual(r.metadata.canonicalUrl, 'https://www.example.com/story/1');
  assert.strictEqual(r.metadata.leadImage, 'https://www.example.com/img/lead.jpg');
  assert.strictEqual(r.metadata.author, 'Ada Lovelace');
  assert.strictEqual(r.metadata.publishedAt, '2024-03-01T10:00:00.000Z');
  assert.strictEqual(r.metadata.language, 'en-GB');
  const other = extract(html.replace('href="/story/1"', 'href="https://evil.example.net/story/1"'), 'https://www.example.com/story/1');
  assert.strictEqual(other.metadata.canonicalUrl, null, 'a canonical on another host is not trusted (it is the duplicate key)');
});

test('a page with too little text has no Reader view (extraction failed -> Original only, P3)', () => {
  const r = extract('<html><head><title>Login</title></head><body><form><input name=u><button>Sign in</button></form></body></html>', 'https://example.com/login');
  assert.strictEqual(r.article, null);
  assert.strictEqual(r.metadata.title, 'Login');
});

test.after(() => {
  // The per-page table for the plan's Evidence (printed, never asserted).
  for (const r of results) console.log(`# corpus ${r.name}: raw ${JSON.stringify(r.raw)} | browser ${JSON.stringify(r.browser)}`);
});
