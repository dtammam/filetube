'use strict';

// lib/pages/extract.js - a page's HTML -> the Reader article + its metadata (plan
// D-PARSE 3). Every input goes through the tidier first (lib/pages/tidy.js), the
// browser-serialized HTML a device sends included: the vendored JSDOMParser
// needs well-formed markup, and a device is a client we do not control. Then the
// vendored Mozilla Readability (lib/pages/vendor/, unmodified) finds the article,
// with the page URL so its relative links and images become absolute.
//
// Metadata (P4): Readability's own reading of og:* / twitter:* / dc:* / JSON-LD,
// filled in by ours where it is silent (the canonical link, the lead image, more
// date and author spellings, the language), all from the tidy tree before
// Readability mutates its copy.

const tidy = require('./tidy');
const meta = require('./meta');
const JSDOMParser = require('./vendor/JSDOMParser');
const Readability = require('./vendor/Readability');

const MAX_JSONLD_BYTES = 256 * 1024;
const MAX_ELEMS = 120000;
const MIN_READER_WORDS = 30;
const ARTICLE_TYPES = new Set(['article', 'newsarticle', 'blogposting', 'reportagenewsarticle', 'analysisnewsarticle', 'opinionnewsarticle', 'reviewnewsarticle', 'backgroundnewsarticle', 'scholarlyarticle', 'techarticle', 'socialmediaposting', 'liveblogposting', 'report', 'webpage', 'medicalscholarlyarticle', 'discussionforumposting']);

function absUrl(v, base) {
  if (typeof v !== 'string' || v.trim() === '') return null;
  try {
    const u = new URL(v.trim(), base);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.toString();
  } catch { return null; }
}

function sameHost(a, b) {
  try {
    const strip = (h) => h.toLowerCase().replace(/^www\./, '');
    return strip(new URL(a).hostname) === strip(new URL(b).hostname);
  } catch { return false; }
}

function looksLikeUrl(s) {
  return /^(https?:)?\/\//i.test(s) || /^www\./i.test(s);
}

// "By Jane Doe" / "Jane Doe | Reporter" -> "Jane Doe"; URLs and empties -> null.
function cleanByline(s) {
  if (typeof s !== 'string') return null;
  let b = s.replace(/\s+/g, ' ').trim();
  b = b.replace(/^(by|written by|posted by|von|par|por|di)\s*[:-]?\s+/i, '');
  if (!b || looksLikeUrl(b) || b.length > meta.LIMITS.author) return b && !looksLikeUrl(b) ? b.slice(0, meta.LIMITS.author) : null;
  return b;
}

function jsonLdNames(v) {
  if (!v) return [];
  if (typeof v === 'string') return [v];
  if (Array.isArray(v)) return v.flatMap(jsonLdNames);
  if (typeof v === 'object' && typeof v.name === 'string') return [v.name];
  return [];
}

function typeMatches(t) {
  const list = Array.isArray(t) ? t : [t];
  return list.some((x) => typeof x === 'string' && ARTICLE_TYPES.has(x.toLowerCase().replace(/^https?:\/\/schema\.org\//, '')));
}

// The first Article-like object in the page's JSON-LD (an @graph or a list is
// walked; a script that is not valid JSON is skipped).
function readJsonLd(tree) {
  for (const node of tidy.elements(tree)) {
    if (node.name !== 'script') continue;
    const type = (tidy.getAttr(node, 'type') || '').toLowerCase().trim();
    if (type !== 'application/ld+json') continue;
    const raw = tidy.textContent(node);
    if (raw.length > MAX_JSONLD_BYTES) continue;
    let data;
    try { data = JSON.parse(raw.replace(/^\s*<!\[CDATA\[|\]\]>\s*$/g, '')); } catch { continue; }
    const queue = Array.isArray(data) ? [...data] : [data];
    let guard = 0;
    while (queue.length && guard++ < 500) {
      const o = queue.shift();
      if (!o || typeof o !== 'object') continue;
      if (Array.isArray(o['@graph'])) queue.push(...o['@graph']);
      if (typeMatches(o['@type'])) {
        const img = o.image;
        const image = typeof img === 'string' ? img : (Array.isArray(img) ? (typeof img[0] === 'string' ? img[0] : img[0] && img[0].url) : img && img.url);
        return {
          headline: typeof o.headline === 'string' ? o.headline : (typeof o.name === 'string' ? o.name : null),
          authors: jsonLdNames(o.author),
          datePublished: typeof o.datePublished === 'string' ? o.datePublished : null,
          publisher: jsonLdNames(o.publisher)[0] || null,
          image: typeof image === 'string' ? image : null,
          description: typeof o.description === 'string' ? o.description : null,
          url: typeof o.url === 'string' ? o.url : null,
        };
      }
    }
  }
  return null;
}

// <meta> values keyed by name / property / itemprop (lowercase), first wins;
// plus <link rel> hrefs and the first <time datetime>.
function readHead(tree) {
  const metas = Object.create(null);
  const links = Object.create(null);
  let htmlLang = null;
  let titleText = null;
  let firstTime = null;
  for (const node of tidy.elements(tree)) {
    if (node.name === 'html' && htmlLang === null) htmlLang = tidy.getAttr(node, 'lang') || tidy.getAttr(node, 'xml:lang');
    else if (node.name === 'title' && titleText === null) titleText = tidy.textContent(node).trim();
    else if (node.name === 'meta') {
      const key = (tidy.getAttr(node, 'property') || tidy.getAttr(node, 'name') || tidy.getAttr(node, 'itemprop') || '').toLowerCase().trim();
      const content = tidy.getAttr(node, 'content');
      if (key && typeof content === 'string' && content.trim() !== '' && metas[key] === undefined) metas[key] = content.trim();
    } else if (node.name === 'link') {
      const rel = (tidy.getAttr(node, 'rel') || '').toLowerCase().split(/\s+/);
      const href = tidy.getAttr(node, 'href');
      for (const r of rel) if (r && href && links[r] === undefined) links[r] = href;
    } else if (node.name === 'time' && firstTime === null) {
      const dt = tidy.getAttr(node, 'datetime');
      if (dt && Number.isFinite(Date.parse(dt))) firstTime = dt;
    }
  }
  return { metas, links, htmlLang, titleText, firstTime };
}

function firstOf(obj, keys) {
  for (const k of keys) if (obj[k]) return obj[k];
  return null;
}

function isoOrNull(v) {
  if (typeof v !== 'string' || v.trim() === '') return null;
  const ms = Date.parse(v.trim());
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function readMetadata(tree, pageUrl) {
  const { metas, links, htmlLang, titleText, firstTime } = readHead(tree);
  const ld = readJsonLd(tree) || {};
  const canonical = absUrl(links.canonical, pageUrl) || absUrl(metas['og:url'], pageUrl) || absUrl(ld.url, pageUrl);
  const authorMeta = firstOf(metas, ['author', 'article:author', 'parsely-author', 'sailthru.author', 'dc.creator', 'dcterms.creator', 'byl']);
  return {
    title: firstOf(metas, ['og:title', 'twitter:title']) || ld.headline || titleText || null,
    site: firstOf(metas, ['og:site_name', 'application-name', 'publisher']) || ld.publisher || null,
    author: (authorMeta && !looksLikeUrl(authorMeta) ? authorMeta : null) || (ld.authors && ld.authors.length ? ld.authors.join(', ') : null),
    publishedAt: isoOrNull(firstOf(metas, ['article:published_time', 'og:published_time', 'datepublished', 'publish-date', 'parsely-pub-date', 'pubdate', 'publishdate', 'sailthru.date', 'dc.date.issued', 'dc.date', 'dcterms.date', 'date'])) || isoOrNull(ld.datePublished) || isoOrNull(firstTime),
    description: firstOf(metas, ['og:description', 'description', 'twitter:description']) || ld.description || null,
    leadImage: absUrl(firstOf(metas, ['og:image', 'og:image:url', 'og:image:secure_url', 'twitter:image', 'twitter:image:src']), pageUrl) || absUrl(links.image_src, pageUrl) || absUrl(ld.image, pageUrl),
    language: (htmlLang || metas['og:locale'] || metas['content-language'] || '').replace('_', '-').split(/[,\s]/)[0] || null,
    canonicalUrl: canonical,
  };
}

// The block elements whose text starts a new paragraph in text.txt.
const BLOCK = new Set(['p', 'div', 'section', 'article', 'header', 'footer', 'aside', 'blockquote', 'pre', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'figure', 'figcaption', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'details', 'summary', 'main', 'nav', 'address']);

// Reader tree -> plain text: paragraphs separated by a blank line, list items
// prefixed "- ", table cells by a tab, <pre> kept verbatim, <br> a line break.
function treeToText(tree) {
  const out = [];
  let line = '';
  const flush = (blank) => {
    const t = line.replace(/[ \t\u00a0]+/g, ' ').trim();
    if (t) out.push(t);
    if (blank && out.length && out[out.length - 1] !== '') out.push('');
    line = '';
  };
  const walk = (node, inPre) => {
    if (node.type === 'text') {
      line += inPre ? node.value : node.value.replace(/\s+/g, ' ');
      return;
    }
    if (node.type !== 'element' && node.type !== 'root') return;
    const name = node.name;
    if (name === 'script' || name === 'style' || name === 'noscript' || name === 'template') return;
    if (name === 'br') { if (inPre) line += '\n'; else flush(false); return; }
    if (name === 'pre') {
      flush(true);
      let s = '';
      const grab = (x) => { if (x.type === 'text') s += x.value; else if (x.name === 'br') s += '\n'; else for (const c of x.children || []) grab(c); };
      grab(node);
      if (s.trim()) out.push(s.replace(/\s+$/, ''));
      out.push('');
      return;
    }
    const block = BLOCK.has(name);
    if (block) flush(name !== 'li' && name !== 'tr' && name !== 'dt' && name !== 'dd');
    if (name === 'li') line += '- ';
    if (name === 'td' || name === 'th') line += line ? '\t' : '';
    if (name === 'img') { const alt = tidy.getAttr(node, 'alt'); if (alt && alt.trim()) line += ' [' + alt.trim() + '] '; return; }
    for (const c of node.children || []) walk(c, inPre);
    if (block) flush(name !== 'li' && name !== 'tr' && name !== 'dt' && name !== 'dd');
  };
  walk(tree, false);
  flush(false);
  while (out.length && out[out.length - 1] === '') out.pop();
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

// The whole pipeline up to (not including) sanitizing: { tree, metadata, article }
// where article is { html, title, byline, siteName, publishedTime, lang, excerpt }
// or null when Readability found nothing worth a Reader view.
function extract(html, pageUrl) {
  const tree = tidy.ensureDocument(tidy.parse(html));
  const metadata = readMetadata(tree, pageUrl);
  let article = null;
  let error = null;
  try {
    const doc = new JSDOMParser().parse(tidy.serialize(tree, { mode: 'xml' }), pageUrl);
    const r = new Readability(doc, { maxElemsToParse: MAX_ELEMS, keepClasses: false }).parse();
    if (r && typeof r.content === 'string') {
      const readerTree = tidy.parse(r.content);
      const text = treeToText(readerTree);
      if (meta.countWords(text) >= MIN_READER_WORDS) {
        article = { html: r.content, tree: readerTree, text, title: r.title, byline: r.byline, siteName: r.siteName, publishedTime: r.publishedTime, lang: r.lang, excerpt: r.excerpt };
      }
    }
  } catch (err) {
    error = err && err.message ? err.message : String(err);
  }
  const host = (() => { try { return new URL(pageUrl).hostname.replace(/^www\./, ''); } catch { return null; } })();
  const merged = {
    title: (article && article.title) || metadata.title || host || 'Untitled',
    site: (article && article.siteName) || metadata.site || host,
    author: cleanByline((article && article.byline) || metadata.author),
    publishedAt: isoOrNull(article && article.publishedTime) || metadata.publishedAt,
    description: (article && article.excerpt) || metadata.description,
    leadImage: metadata.leadImage,
    language: (article && article.lang) || metadata.language,
    // A canonical link is the duplicate key (P12), so it is trusted only on the
    // page's own host: a page cannot claim to BE another site's article.
    canonicalUrl: sameHost(metadata.canonicalUrl, pageUrl) ? metadata.canonicalUrl : null,
  };
  return { tree, metadata: merged, article, error };
}

module.exports = { extract, sameHost, readMetadata, readJsonLd, treeToText, cleanByline, absUrl, MIN_READER_WORDS };
