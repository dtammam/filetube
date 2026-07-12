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

/**
 * Parse the OPF package document.
 * @param {string} opfXml the OPF's text
 * @param {string} opfPath the OPF's zip-entry path (hrefs resolve against it)
 * @returns {{ title: string|null, author: string|null,
 *   spine: Array<{idref: string, href: string}>,
 *   coverEntryName: string|null, coverMediaType: string|null }}
 */
function parseOpf(opfXml, opfPath) {
  const result = { title: null, author: null, spine: [], coverEntryName: null, coverMediaType: null };
  if (typeof opfXml !== 'string' || opfXml === '') return result;

  result.title = firstElementText(opfXml, 'title');
  result.author = firstElementText(opfXml, 'creator');

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
  resolveOpfHref,
  decodeXmlEntities,
};
