'use strict';

// v1.37.0 T2 (books): tolerant, SCOPED extraction of exactly what the book
// scanner needs from an EPUB's package documents -- container.xml's rootfile
// path, and the OPF's dc:title / dc:creator / spine reading order / cover
// image href. This is deliberately NOT a general XML parser: the inputs are
// spec-shaped (OCF/OPF), the needed subset is tiny and frozen, and every
// miss degrades to a fallback (filename title, no cover) rather than a
// failure -- the scanner never aborts on a weird book (the
// extractMetadataAndThumbnail catch posture). String/regex scanning over a
// bounded document is the right tool at this scope; anything fancier is a
// dependency this repo deliberately doesn't take server-side.
//
// Namespace tolerance: elements are matched by LOCAL name with an optional
// prefix (`(?:[\w.-]+:)?`), so `<dc:title>`, `<title>`, `<opf:package>` and
// friends all resolve. Attribute order is never assumed.

// Decode the five XML built-ins + numeric references -- OPF metadata text
// commonly carries &amp; and friends. Anything unrecognized passes through.
function decodeXmlEntities(text) {
  return String(text)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = parseInt(dec, 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    })
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

// First element with the given LOCAL name (optional namespace prefix); its
// decoded, trimmed text content, or null. Bounded scan, never throws.
function firstElementText(xml, localName) {
  const re = new RegExp(`<(?:[\\w.-]+:)?${localName}\\b[^>]*>([\\s\\S]*?)</(?:[\\w.-]+:)?${localName}>`, 'i');
  const match = re.exec(xml);
  if (!match) return null;
  const text = decodeXmlEntities(match[1].replace(/<[^>]*>/g, '')).trim();
  return text === '' ? null : text;
}

// One attribute's decoded value from an element tag string, or null.
function attrValue(tag, attrName) {
  const re = new RegExp(`\\b${attrName}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, 'i');
  const match = re.exec(tag);
  return match ? decodeXmlEntities(match[2]).trim() : null;
}

// Every opening tag of a given LOCAL name (self-closing or not), as raw tag
// strings for attribute extraction.
function allTags(xml, localName) {
  const re = new RegExp(`<(?:[\\w.-]+:)?${localName}\\b[^>]*>`, 'gi');
  return xml.match(re) || [];
}

/**
 * container.xml -> the package document (OPF) path, zip-entry-relative.
 * @returns {string|null}
 */
function parseContainerRootfile(containerXml) {
  if (typeof containerXml !== 'string') return null;
  for (const tag of allTags(containerXml, 'rootfile')) {
    const fullPath = attrValue(tag, 'full-path');
    if (fullPath) return fullPath;
  }
  return null;
}

// Resolve an OPF-relative href against the OPF's own directory into a
// zip-entry name ('.'/'..' segments collapsed; zip names never start '/').
function resolveOpfHref(opfPath, href) {
  const baseSegments = String(opfPath).split('/').slice(0, -1);
  const segments = [...baseSegments];
  for (const part of String(href).split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') { segments.pop(); continue; }
    segments.push(part);
  }
  return segments.join('/');
}

// Input bounds for the v1.380.0 parsers below. A hostile EPUB deflates a megabyte of '<' into a kilobyte, and an unanchored
// lazy scan rescans to the end from every '<' (quadratic: 100 KB of '<' froze the server for 26 s). Every scan here is
// bounded: a tag is at most MAX_TAG_CHARS long, an element's text at most MAX_ELEMENT_CHARS, a nav document at MAX_NAV_CHARS.
const MAX_TAG_CHARS = 1000;
const MAX_ELEMENT_CHARS = 20000;
const MAX_NAV_CHARS = 262144;

// The raw (still entity-encoded) inner text of the first element with the given LOCAL name, or null. Bounded: the
// opening tag is found by a regex whose tag body is capped, the closing tag only within MAX_ELEMENT_CHARS of it.
function firstElementRaw(xml, localName) {
  const open = new RegExp(`<(?:[\\w.-]+:)?${localName}\\b[^>]{0,${MAX_TAG_CHARS}}>`, 'i').exec(xml);
  if (!open) return null;
  const start = open.index + open[0].length;
  const rest = xml.slice(start, start + MAX_ELEMENT_CHARS);
  const close = new RegExp(`</(?:[\\w.-]+:)?${localName}>`, 'i').exec(rest);
  return close ? rest.slice(0, close.index) : null;
}

const DESCRIPTION_MAX_CHARS = 600;

// v1.380.0 (Feed, "Start something new"): a book's dc:description is PUBLISHER text and can carry
// markup, escaped markup (&lt;p&gt;) and CDATA. It is rendered as TEXT NODES by the card, but the
// stored/served string is made plain here as well: CDATA unwrapped, tags removed, entities decoded,
// anything the decode turned back into a tag removed AGAIN, whitespace collapsed, capped at
// DESCRIPTION_MAX_CHARS on a word boundary. Null when nothing readable is left. Input is cut to
// MAX_ELEMENT_CHARS first and every tag match is length-bounded (no quadratic rescan).
function plainDescription(raw) {
  if (typeof raw !== 'string' || raw === '') return null;
  let t = raw.slice(0, MAX_ELEMENT_CHARS).replace(/<!\[CDATA\[([\s\S]{0,20000}?)\]\]>/g, '$1');
  for (let pass = 0; pass < 2; pass++) {
    t = t.replace(/<(script|style)\b[^>]{0,300}>[\s\S]{0,20000}?<\/\1\s*>/gi, ' ').replace(/<\/?(?:br|p|div|li|ul|ol|h[1-6]|blockquote)\b[^>]{0,300}>/gi, ' ').replace(/<[^>]{0,300}>/g, '');
    t = decodeXmlEntities(t);
  }
  t = t.replace(/<[^>]{0,300}>/g, '').replace(/\p{Cc}+/gu, ' ').replace(/\s+/g, ' ').trim();
  if (t === '') return null;
  if (t.length <= DESCRIPTION_MAX_CHARS) return t;
  const cut = t.slice(0, DESCRIPTION_MAX_CHARS);
  const space = cut.lastIndexOf(' ');
  return (space > DESCRIPTION_MAX_CHARS * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, '') + '\u2026';
}

/**
 * The EPUB 3 navigation document's `landmarks` entry for the start of the body
 * (`epub:type="bodymatter"`), resolved to a zip entry name (fragment dropped), or null.
 * Linear: indexOf scanning over a nav cut to MAX_NAV_CHARS, every tag length-bounded.
 */
function parseNavBodymatter(navXhtml, navPath) {
  if (typeof navXhtml !== 'string' || navXhtml === '') return null;
  const nav = navXhtml.slice(0, MAX_NAV_CHARS);
  const lower = nav.toLowerCase();
  let from = 0;
  while (from < nav.length) {
    const at = lower.indexOf('<nav', from);
    if (at < 0) return null;
    const tagEnd = nav.indexOf('>', at);
    from = at + 4;
    if (tagEnd < 0 || tagEnd - at > MAX_TAG_CHARS) continue;
    if (!/\btype\s*=\s*(["'])[^"']{0,200}\blandmarks\b/i.test(nav.slice(at, tagEnd))) continue;
    const close = lower.indexOf('</nav>', tagEnd);
    const inner = nav.slice(tagEnd + 1, close < 0 ? nav.length : close);
    for (const tag of inner.match(/<a\b[^>]{0,1000}>/gi) || []) {
      const type = attrValue(tag, 'epub:type') || attrValue(tag, 'type') || '';
      if (!/(?:^|\s)bodymatter(?:\s|$)/i.test(type)) continue;
      const href = attrValue(tag, 'href');
      if (href) return resolveOpfHref(navPath, href.split('#')[0]);
    }
    return null;
  }
  return null;
}

/**
 * Parse the OPF package document.
 * @param {string} opfXml the OPF's text
 * @param {string} opfPath the OPF's zip-entry path (hrefs resolve against it)
 * @returns {{ title: string|null, author: string|null, description: string|null,
 *   spine: Array<{idref: string, href: string}>, navEntryName: string|null,
 *   coverEntryName: string|null, coverMediaType: string|null }}
 *   `description` is the book's own dc:description as PLAIN TEXT (plainDescription);
 *   `navEntryName` is the EPUB 3 navigation document's zip entry (v1.380.0, Feed).
 */
function parseOpf(opfXml, opfPath) {
  const result = { title: null, author: null, description: null, spine: [], navEntryName: null, coverEntryName: null, coverMediaType: null };
  if (typeof opfXml !== 'string' || opfXml === '') return result;

  result.title = firstElementText(opfXml, 'title');
  result.author = firstElementText(opfXml, 'creator');
  result.description = plainDescription(firstElementRaw(opfXml, 'description'));

  // Manifest: id -> {href, mediaType, properties}
  const manifest = new Map();
  for (const tag of allTags(opfXml, 'item')) {
    const id = attrValue(tag, 'id');
    const href = attrValue(tag, 'href');
    if (!id || !href) continue;
    manifest.set(id, {
      href,
      mediaType: attrValue(tag, 'media-type') || '',
      properties: attrValue(tag, 'properties') || '',
    });
  }

  for (const [, item] of manifest) {
    if (/(?:^|\s)nav(?:\s|$)/i.test(item.properties)) { result.navEntryName = resolveOpfHref(opfPath, item.href); break; }
  }

  // Spine: reading order. `spine[i]` IS the chapter address the reader's
  // progress locator and wave-2's TTS chapter cache both key on.
  for (const tag of allTags(opfXml, 'itemref')) {
    const idref = attrValue(tag, 'idref');
    if (!idref) continue;
    const item = manifest.get(idref);
    if (!item) continue; // an itemref pointing nowhere is silently dropped
    result.spine.push({ idref, href: resolveOpfHref(opfPath, item.href) });
  }

  // Cover resolution, in spec-preference order:
  //   1. EPUB3: the manifest item carrying properties~="cover-image".
  //   2. EPUB2: <meta name="cover" content="<manifest id>">.
  //   3. Heuristic: first image-typed manifest item whose id or href
  //      contains "cover" (case-insensitive).
  let coverItem = null;
  for (const [, item] of manifest) {
    if (/(?:^|\s)cover-image(?:\s|$)/i.test(item.properties)) { coverItem = item; break; }
  }
  if (!coverItem) {
    for (const tag of allTags(opfXml, 'meta')) {
      if ((attrValue(tag, 'name') || '').toLowerCase() === 'cover') {
        const content = attrValue(tag, 'content');
        if (content && manifest.has(content)) { coverItem = manifest.get(content); break; }
      }
    }
  }
  if (!coverItem) {
    for (const [id, item] of manifest) {
      if (!item.mediaType.toLowerCase().startsWith('image/')) continue;
      if (/cover/i.test(id) || /cover/i.test(item.href)) { coverItem = item; break; }
    }
  }
  if (coverItem && coverItem.mediaType.toLowerCase().startsWith('image/')) {
    result.coverEntryName = resolveOpfHref(opfPath, coverItem.href);
    result.coverMediaType = coverItem.mediaType.toLowerCase();
  }

  return result;
}

module.exports = {
  parseContainerRootfile,
  parseOpf,
  parseNavBodymatter,
  plainDescription,
  DESCRIPTION_MAX_CHARS,
  resolveOpfHref,
  decodeXmlEntities,
};
