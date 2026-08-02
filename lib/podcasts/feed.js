'use strict';

// v1.69.0 (podcasts): the hand-rolled podcast RSS extractor. PURE - no I/O,
// no deps, no globals; input string in, plain data out.
//
// This is deliberately NOT an XML parser. It is a bounded scanner that pulls
// the handful of fields podcasts need (channel title/author/image, per-item
// title/guid/pubDate/enclosure/duration/description) out of RSS 2.0 text,
// built against Dean's real 490 KB single-line Patreon feed. What that buys
// (exec plan D5, attack surface 4):
//  - XXE / billion-laughs are STRUCTURALLY inert: there is no entity-
//    expansion machinery. A <!DOCTYPE> prelude (internal subset included) is
//    skipped as opaque text; only the five named XML entities + numeric
//    character references are decoded, non-recursively, on already-extracted
//    field VALUES.
//  - No regex ever runs over an unbounded span: item boundaries and tag
//    lookups are indexOf scans; regexes touch only single-tag slices with a
//    hard length bound.
//  - Caps everywhere, truncate-never-crash: input <= MAX_FEED_BYTES, items
//    <= MAX_ITEMS, per-field caps. Malformed input -> { ok:false, error },
//    NEVER a throw.
//  - Items without an AUDIO enclosure are skipped and COUNTED (a video feed
//    reports "0 audio episodes", it does not lie).

const MAX_FEED_BYTES = 25 * 1024 * 1024;
const MAX_ITEMS = 2000;
const MAX_TITLE_LENGTH = 2048;
const MAX_GUID_LENGTH = 2048;
const MAX_URL_LENGTH = 4096;
const MAX_DESCRIPTION_LENGTH = 65536;
const MAX_TAG_SLICE = 8192; // bound for any single-tag regex slice

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/**
 * Decode XML character references in an extracted field value. Named: the
 * five XML built-ins ONLY (a custom entity from a DOCTYPE we never parsed
 * stays as literal text - correct and safe). Numeric: decimal + hex, valid
 * code points only. Single-pass by construction: the replacement values can
 * form no new reference for a later pass because there IS no later pass.
 */
function decodeEntities(text) {
  if (typeof text !== 'string' || text.indexOf('&') === -1) return typeof text === 'string' ? text : '';
  return text.replace(/&(#x?[0-9a-fA-F]{1,7}|[a-zA-Z]{2,6});/g, (whole, body) => {
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (!Number.isInteger(code) || code < 0x20 && code !== 0x9 && code !== 0xA && code !== 0xD) return '';
      if (code > 0x10FFFF) return '';
      try { return String.fromCodePoint(code); } catch { return ''; }
    }
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, body) ? NAMED_ENTITIES[body] : whole;
  });
}

/** Unwrap CDATA sections in a raw tag body (may contain several). */
function unwrapCdata(raw) {
  if (raw.indexOf('<![CDATA[') === -1) return { text: raw, hadCdata: false };
  let out = '';
  let pos = 0;
  let hadCdata = false;
  while (pos < raw.length) {
    const start = raw.indexOf('<![CDATA[', pos);
    if (start === -1) { out += raw.slice(pos); break; }
    out += raw.slice(pos, start);
    const end = raw.indexOf(']]>', start + 9);
    if (end === -1) { out += raw.slice(start + 9); hadCdata = true; break; }
    out += raw.slice(start + 9, end);
    hadCdata = true;
    pos = end + 3;
  }
  return { text: out, hadCdata };
}

/**
 * Find the body of the FIRST `<tagName>...</tagName>` inside `span`
 * (case-insensitive via the caller-supplied lowercased mirror). Handles
 * attributes on the opening tag and self-closing tags (body = ''). Returns
 * null when absent. indexOf-based - never scans with a regex.
 * @param {string} span the original-case text
 * @param {string} lower span.toLowerCase() (same indices)
 * @param {string} tagName lowercase tag name, e.g. 'title' or 'itunes:duration'
 */
function findTagBody(span, lower, tagName) {
  const open = `<${tagName}`;
  let from = 0;
  while (from < lower.length) {
    const at = lower.indexOf(open, from);
    if (at === -1) return null;
    const after = lower[at + open.length];
    // Must be a real tag boundary: '<title>' or '<title ' - not '<titlex'.
    if (after !== '>' && after !== ' ' && after !== '\t' && after !== '\n' && after !== '\r' && after !== '/') {
      from = at + open.length;
      continue;
    }
    const openEnd = lower.indexOf('>', at);
    if (openEnd === -1) return null;
    if (lower[openEnd - 1] === '/') return ''; // self-closing
    const close = lower.indexOf(`</${tagName}`, openEnd + 1);
    if (close === -1) return null;
    return span.slice(openEnd + 1, close);
  }
  return null;
}

/** Extracted+decoded text field with a cap. '' when absent. */
function tagText(span, lower, tagName, cap) {
  const body = findTagBody(span, lower, tagName);
  if (body === null) return '';
  const { text, hadCdata } = unwrapCdata(body);
  // CDATA content is literal by definition - entity-decode only non-CDATA.
  const decoded = hadCdata ? text : decodeEntities(text);
  return decoded.trim().slice(0, cap);
}

/** Pull one attribute value out of a single already-sliced tag string. */
function attrValue(tagSlice, name) {
  const re = new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'i');
  const m = re.exec(tagSlice);
  if (m) return m[1];
  const reSingle = new RegExp(`${name}\\s*=\\s*'([^']*)'`, 'i');
  const m2 = reSingle.exec(tagSlice);
  return m2 ? m2[1] : '';
}

/** The first `<tagName ...>` TAG SLICE (opening tag only, length-bounded). */
function findTagSlice(span, lower, tagName) {
  const at = lower.indexOf(`<${tagName}`, 0);
  if (at === -1) return null;
  const after = lower[at + tagName.length + 1];
  if (after !== '>' && after !== ' ' && after !== '\t' && after !== '\n' && after !== '\r' && after !== '/') return null;
  const end = lower.indexOf('>', at);
  if (end === -1 || end - at > MAX_TAG_SLICE) return null;
  return span.slice(at, end + 1);
}

/** itunes:duration: bare seconds or [HH:]MM:SS. null when unparseable. */
function parseDuration(text) {
  const t = (text || '').trim();
  if (t === '') return null;
  if (/^\d+$/.test(t)) {
    const n = Number(t);
    return Number.isSafeInteger(n) ? n : null;
  }
  const m = /^(?:(\d{1,3}):)?(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return null;
  const h = m[1] ? Number(m[1]) : 0;
  return h * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/** RFC-1123 (and lenient) pubDate -> ms, or null. */
function parsePubDate(text) {
  const t = (text || '').trim();
  if (t === '') return null;
  const ms = Date.parse(t);
  return Number.isFinite(ms) ? ms : null;
}

/** Is this enclosure audio? type wins; a missing/generic type falls back to the URL extension. */
function isAudioEnclosure(type, url) {
  const t = (type || '').trim().toLowerCase();
  if (t.startsWith('audio/')) return true;
  if (t !== '' && t !== 'application/octet-stream') return false;
  return /\.(mp3|m4a|aac|ogg|opus|flac|wav)(\?|$)/i.test(url || '');
}

/**
 * Skip an optional <!DOCTYPE ...> prelude, internal subset included, WITHOUT
 * interpreting it. Manual bracket scan - a hostile subset full of entity
 * definitions is dropped as opaque bytes.
 */
function stripDoctype(xml) {
  const at = xml.search(/<!DOCTYPE/i);
  if (at === -1) return xml;
  let pos = at + 9;
  let depth = 0;
  while (pos < xml.length) {
    const ch = xml[pos];
    if (ch === '[') depth += 1;
    else if (ch === ']') depth = Math.max(0, depth - 1);
    else if (ch === '>' && depth === 0) {
      return xml.slice(0, at) + xml.slice(pos + 1);
    }
    pos += 1;
  }
  return xml.slice(0, at); // unterminated DOCTYPE: drop the rest
}

/** Strip XML comments (bounded scan; unterminated comment drops the tail). */
function stripComments(xml) {
  if (xml.indexOf('<!--') === -1) return xml;
  let out = '';
  let pos = 0;
  while (pos < xml.length) {
    const start = xml.indexOf('<!--', pos);
    if (start === -1) { out += xml.slice(pos); break; }
    out += xml.slice(pos, start);
    const end = xml.indexOf('-->', start + 4);
    if (end === -1) break;
    pos = end + 3;
  }
  return out;
}

/**
 * Parse a podcast RSS document. Never throws.
 * @param {*} xml
 * @returns {{ok:true, channel:object, items:object[], skippedNoAudio:number, truncatedItems:boolean}|{ok:false, error:string}}
 */
function parsePodcastFeed(xml) {
  if (typeof xml !== 'string' || xml.trim() === '') return { ok: false, error: 'empty feed document' };
  if (xml.length > MAX_FEED_BYTES) return { ok: false, error: 'feed document too large' };

  let doc;
  try {
    doc = stripComments(stripDoctype(xml));
  } catch {
    return { ok: false, error: 'malformed feed document' };
  }
  const lowerDoc = doc.toLowerCase();
  if (lowerDoc.indexOf('<rss') === -1 && lowerDoc.indexOf('<feed') === -1 && lowerDoc.indexOf('<channel') === -1) {
    return { ok: false, error: 'not an RSS document' };
  }

  // Channel header = everything from <channel> up to the first <item>.
  const chanStart = lowerDoc.indexOf('<channel');
  const firstItem = lowerDoc.indexOf('<item');
  const headEnd = firstItem === -1 ? doc.length : firstItem;
  const head = doc.slice(chanStart === -1 ? 0 : chanStart, headEnd);
  const headLower = lowerDoc.slice(chanStart === -1 ? 0 : chanStart, headEnd);

  const channel = {
    title: tagText(head, headLower, 'title', MAX_TITLE_LENGTH),
    description: stripHtml(tagText(head, headLower, 'description', MAX_DESCRIPTION_LENGTH)),
    author: tagText(head, headLower, 'itunes:author', MAX_TITLE_LENGTH),
    imageUrl: '',
  };
  const itunesImage = findTagSlice(head, headLower, 'itunes:image');
  if (itunesImage) channel.imageUrl = decodeEntities(attrValue(itunesImage, 'href')).slice(0, MAX_URL_LENGTH);
  if (!channel.imageUrl) {
    const imageBody = findTagBody(head, headLower, 'image');
    if (imageBody !== null && imageBody !== '') {
      const il = imageBody.toLowerCase();
      channel.imageUrl = tagText(imageBody, il, 'url', MAX_URL_LENGTH);
    }
  }

  const items = [];
  let skippedNoAudio = 0;
  let truncatedItems = false;
  let pos = firstItem;
  while (pos !== -1 && pos < doc.length) {
    if (items.length >= MAX_ITEMS) { truncatedItems = true; break; }
    const end = lowerDoc.indexOf('</item', pos);
    if (end === -1) break;
    const span = doc.slice(pos, end);
    const spanLower = lowerDoc.slice(pos, end);

    const enclosureSlice = findTagSlice(span, spanLower, 'enclosure');
    const enclosureUrl = enclosureSlice ? decodeEntities(attrValue(enclosureSlice, 'url')).slice(0, MAX_URL_LENGTH) : '';
    const enclosureType = enclosureSlice ? attrValue(enclosureSlice, 'type').slice(0, 256) : '';
    const enclosureLengthRaw = enclosureSlice ? attrValue(enclosureSlice, 'length') : '';
    const enclosureBytes = /^\d{1,15}$/.test(enclosureLengthRaw) ? Number(enclosureLengthRaw) : null;

    if (enclosureUrl !== '' && isAudioEnclosure(enclosureType, enclosureUrl)) {
      const guid = tagText(span, spanLower, 'guid', MAX_GUID_LENGTH);
      items.push({
        title: tagText(span, spanLower, 'title', MAX_TITLE_LENGTH),
        // A guid-less item falls back to the enclosure URL as its identity -
        // imperfect but stable, and real feeds in the wild do omit guid.
        guid: guid !== '' ? guid : enclosureUrl,
        link: tagText(span, spanLower, 'link', MAX_URL_LENGTH),
        description: stripHtml(tagText(span, spanLower, 'description', MAX_DESCRIPTION_LENGTH)),
        pubDateMs: parsePubDate(tagText(span, spanLower, 'pubdate', 128)),
        durationSec: parseDuration(tagText(span, spanLower, 'itunes:duration', 32)),
        enclosureUrl,
        enclosureType,
        enclosureBytes,
      });
    } else {
      skippedNoAudio += 1;
    }
    pos = lowerDoc.indexOf('<item', end);
  }

  return { ok: true, channel, items, skippedNoAudio, truncatedItems };
}

/**
 * Reduce an (already entity-decoded) description to plain text: tags out,
 * whitespace collapsed. Descriptions render via textContent client-side
 * regardless (the repo's no-innerHTML law) - this just makes the stored
 * value what the UI actually wants to show.
 */
function stripHtml(text) {
  if (typeof text !== 'string' || text === '') return '';
  return text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

module.exports = {
  parsePodcastFeed,
  decodeEntities,
  parseDuration,
  parsePubDate,
  isAudioEnclosure,
  stripDoctype,
  stripHtml,
  MAX_FEED_BYTES,
  MAX_ITEMS,
};
