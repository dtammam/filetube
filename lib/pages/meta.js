'use strict';

// lib/pages/meta.js - item.json, the one record of a saved item that survives a
// lost database (plan P10, D-STORE). Every reader and writer goes through
// normalizeMeta (the SAME bounds whether the record came from a save, a note
// edit, a rebuild of files on disk or a hand-edited file), and serializeMeta
// writes the fields in ONE fixed order, so the bytes are a pure function of the
// record: a delete -> trash -> restore round trip leaves item.json byte-identical
// (the trash stamp is the only field it adds and removes).

const SCHEMA = 1;

const LIMITS = Object.freeze({
  title: 500,
  site: 200,
  author: 200,
  url: 4096,
  description: 1000,
  language: 35,
  note: 4000,
  leadImage: 64,
  droppedList: 20,
  droppedText: 200,
});

// Where a save came from (P4 "the capture source"). Anything else is 'api'.
const SOURCES = new Set(['web', 'download-dialog', 'shortcut', 'extension', 'ios-share', 'api']);
const KINDS = new Set(['url', 'text']);
const ASSET_STATES = new Set(['pending', 'done']);
const FILES = Object.freeze(['reader.html', 'original.html', 'text.txt']);

// The fixed key order of item.json (serializeMeta). A new field is APPENDED.
const KEY_ORDER = Object.freeze([
  'schema', 'id', 'kind', 'title', 'site', 'author', 'url', 'canonicalUrl', 'publishedAt', 'savedAt',
  'wordCount', 'readingMinutes', 'leadImage', 'description', 'language', 'source', 'note',
  'hasReader', 'hasOriginal', 'assets', 'hashes', 'trashedAt',
]);

// Text keeps line breaks and tabs only where `keepBreaks`; every other control
// character goes (and U+0000 always: node:sqlite truncates a NUL-bearing TEXT).
function cleanText(v, max, keepBreaks = false) {
  if (typeof v !== 'string') return '';
  const re = keepBreaks ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g : /[\u0000-\u001f\u007f]/g; // eslint-disable-line no-control-regex
  let s = v.replace(re, keepBreaks ? '' : ' ').replace(/[\u2028\u2029]/g, keepBreaks ? '\n' : ' ');
  s = keepBreaks ? s.replace(/\r\n?/g, '\n').trim() : s.replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max) : s;
}

function cleanUrl(v) {
  if (typeof v !== 'string' || v === '' || v.length > LIMITS.url) return null;
  let u;
  try { u = new URL(v); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  return u.toString();
}

// A date is kept even when it is in the future (a page's scheduled date, a file
// written on a machine whose clock ran ahead): rejecting it would hide the item.
// Whoever DECIDES on a date (the trash expiry) refuses a future one itself.
function cleanIso(v) {
  if (typeof v !== 'string' || v === '' || v.length > 64) return null;
  const ms = Date.parse(v);
  if (!Number.isFinite(ms)) return null;
  if (ms < Date.UTC(1990, 0, 1) || ms > Date.UTC(9999, 0, 1)) return null;
  return new Date(ms).toISOString();
}

function cleanCount(v, max = 1e9) {
  return Number.isSafeInteger(v) && v >= 0 && v <= max ? v : 0;
}

const HASH_RE = /^[0-9a-f]{64}$/;
const LEAD_RE = /^assets\/[0-9a-f]{24}\.[a-z0-9]{1,5}$/;

// Null = not a usable record (the rebuild skips it and logs). The id is required
// and must match the folder (the caller checks).
function normalizeMeta(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (raw.schema !== SCHEMA) return null;
  if (typeof raw.id !== 'string' || !/^[0-9a-f]{12}$/.test(raw.id)) return null;
  if (!KINDS.has(raw.kind)) return null;
  const savedAt = cleanIso(raw.savedAt);
  if (!savedAt) return null;
  const title = cleanText(raw.title, LIMITS.title) || 'Untitled';
  const url = cleanUrl(raw.url);
  if (raw.kind === 'url' && !url) return null;
  const hashes = {};
  if (raw.hashes && typeof raw.hashes === 'object' && !Array.isArray(raw.hashes)) {
    for (const f of FILES) {
      if (typeof raw.hashes[f] === 'string' && HASH_RE.test(raw.hashes[f])) hashes[f] = raw.hashes[f];
    }
  }
  const assetsIn = raw.assets && typeof raw.assets === 'object' && !Array.isArray(raw.assets) ? raw.assets : {};
  const dropped = Array.isArray(assetsIn.dropped)
    ? assetsIn.dropped.slice(0, LIMITS.droppedList).map((d) => cleanText(d, LIMITS.droppedText)).filter(Boolean)
    : [];
  const out = {
    schema: SCHEMA,
    id: raw.id,
    kind: raw.kind,
    title,
    site: cleanText(raw.site, LIMITS.site) || null,
    author: cleanText(raw.author, LIMITS.author) || null,
    url,
    canonicalUrl: cleanUrl(raw.canonicalUrl) || url,
    publishedAt: cleanIso(raw.publishedAt),
    savedAt,
    wordCount: cleanCount(raw.wordCount),
    readingMinutes: cleanCount(raw.readingMinutes, 1e6),
    leadImage: typeof raw.leadImage === 'string' && LEAD_RE.test(raw.leadImage) ? raw.leadImage : null,
    description: cleanText(raw.description, LIMITS.description) || null,
    language: /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(String(raw.language || '')) ? String(raw.language).slice(0, LIMITS.language) : null,
    source: SOURCES.has(raw.source) ? raw.source : 'api',
    note: cleanText(raw.note, LIMITS.note, true),
    hasReader: raw.hasReader === true,
    hasOriginal: raw.kind === 'url' && raw.hasOriginal === true,
    assets: {
      state: ASSET_STATES.has(assetsIn.state) ? assetsIn.state : 'done',
      count: cleanCount(assetsIn.count, 100000),
      bytes: cleanCount(assetsIn.bytes, Number.MAX_SAFE_INTEGER),
      dropped,
    },
    hashes,
  };
  const trashedAt = cleanIso(raw.trashedAt);
  if (trashedAt) out.trashedAt = trashedAt;
  return out;
}

// Deterministic bytes: KEY_ORDER, nested objects in their own fixed order, two-space
// indent, trailing newline. Absent optional keys (trashedAt) are omitted entirely.
function serializeMeta(meta) {
  const ordered = {};
  for (const k of KEY_ORDER) {
    if (!Object.prototype.hasOwnProperty.call(meta, k) || meta[k] === undefined) continue;
    if (k === 'assets') {
      const a = meta.assets || {};
      ordered.assets = { state: a.state, count: a.count, bytes: a.bytes, dropped: Array.isArray(a.dropped) ? a.dropped : [] };
    } else if (k === 'hashes') {
      const h = {};
      for (const f of FILES) if (meta.hashes && meta.hashes[f]) h[f] = meta.hashes[f];
      ordered.hashes = h;
    } else {
      ordered[k] = meta[k];
    }
  }
  return JSON.stringify(ordered, null, 2) + '\n';
}

// Reading speed for "N min read": 230 words a minute, at least one minute for any text.
function readingMinutes(wordCount) {
  if (!Number.isSafeInteger(wordCount) || wordCount <= 0) return 0;
  return Math.max(1, Math.round(wordCount / 230));
}

// Words in a plain text: runs of letters/digits (any script). CJK text has no spaces,
// so each CJK character counts as a word (a fair reading-time proxy).
function countWords(text) {
  if (typeof text !== 'string' || text === '') return 0;
  let n = 0;
  const cjk = text.match(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/g);
  if (cjk) n += cjk.length;
  const rest = text.replace(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/g, ' ');
  const words = rest.match(/[\p{L}\p{N}]+(?:['\u2019-][\p{L}\p{N}]+)*/gu);
  if (words) n += words.length;
  return n;
}

module.exports = {
  SCHEMA,
  LIMITS,
  SOURCES,
  KINDS,
  FILES,
  KEY_ORDER,
  cleanText,
  cleanUrl,
  cleanIso,
  normalizeMeta,
  serializeMeta,
  readingMinutes,
  countWords,
};
