'use strict';

// lib/pages/tidy.js - a tolerant HTML tokenizer + tree builder (plan D-PARSE 2).
// The vendored JSDOMParser needs WELL-FORMED markup (its own header: quoted
// attributes, every element closed, `<br/>` for voids, no raw `<` in text), and
// pages fetched from the web are not. This turns tag soup into a small tree
// (parse) and the tree into markup (serialize):
//
//  - void elements never take children; raw-text elements (script, style) and
//    RCDATA ones (textarea, title) read to their own end tag;
//  - implied end tags: p by a block start, li / dt / dd / option / tr / td / th /
//    thead / tbody / tfoot by a sibling, a heading by a heading, a by a;
//  - an end tag closes the nearest open element of its name, a stray one is
//    dropped; everything still open at EOF is closed;
//  - entities are decoded (lib/pages/entities.js, numeric references with the
//    browser's Windows-1252 remap) and re-escaped on output;
//  - comments, doctypes and processing instructions are dropped; CDATA is text;
//  - nesting is capped (MAX_DEPTH) and so is the node count (MAX_NODES), because
//    JSDOMParser recurses and the input is a stranger's.
//
// Not a full HTML5 parser (no adoption agency, no foster parenting): the bar is
// "Readability gets a sane tree" on the fixture corpus (test/fixtures/pages/).
// The same tree feeds the sanitizer (lib/pages/sanitize.js). Linear: one pass
// over the input, no regex backtracking over unbounded spans.

const { NAMED, LEGACY } = require('./entities');

const MAX_DEPTH = 200;
const MAX_NODES = 400000;

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'keygen', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RAW_TEXT = new Set(['script', 'style', 'xmp', 'iframe', 'noembed', 'noframes', 'plaintext']);
const RCDATA = new Set(['textarea', 'title']);
const P_CLOSERS = new Set(['address', 'article', 'aside', 'blockquote', 'center', 'details', 'dialog', 'dir', 'div', 'dl', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr', 'main', 'menu', 'nav', 'ol', 'p', 'pre', 'section', 'summary', 'table', 'ul', 'li', 'dd', 'dt', 'listing', 'plaintext', 'search']);
const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
// The elements an implied-close search does not cross (a `p` inside a table cell
// is not closed by a `div` outside it; an `li` of an inner list never closes an
// outer one).
const SCOPE = new Set(['html', 'table', 'td', 'th', 'caption', 'marquee', 'object', 'applet', 'template', 'svg', 'math', 'foreignobject', 'button']);
const LIST_SCOPE = new Set([...SCOPE, 'ul', 'ol']);
const DL_SCOPE = new Set([...SCOPE, 'dl']);
const TABLE_SCOPE = new Set(['html', 'table', 'template']);
const FOREIGN = new Set(['svg', 'math']);
const CELL_SCOPE = new Set(['tr', ...TABLE_SCOPE]);
const SECTION_CLOSES = ['td', 'th', 'tr', 'thead', 'tbody', 'tfoot'];
const ATTR_NAME_RE = /^[a-z_][a-z0-9_.:-]*$/;
const TAG_NAME_RE = /^[a-z][a-z0-9-]*(?::[a-z][a-z0-9-]*)?$/;

// Windows-1252 for &#128; ... &#159; (what browsers do).
const C1 = { 128: 8364, 130: 8218, 131: 402, 132: 8222, 133: 8230, 134: 8224, 135: 8225, 136: 710, 137: 8240, 138: 352, 139: 8249, 140: 338, 142: 381, 145: 8216, 146: 8217, 147: 8220, 148: 8221, 149: 8226, 150: 8211, 151: 8212, 152: 732, 153: 8482, 154: 353, 155: 8250, 156: 339, 158: 382, 159: 376 };

function codePointText(cp) {
  if (cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return '\ufffd';
  if (C1[cp]) return String.fromCodePoint(C1[cp]);
  if (cp < 32 && cp !== 9 && cp !== 10 && cp !== 13) return '\ufffd';
  return String.fromCodePoint(cp);
}

function isAlnum(c) {
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
}

// Decode character references in `s`. In an attribute value a legacy name with no
// semicolon followed by `=` or an alphanumeric is left alone (`?a=1&copy=2`).
function decodeEntities(s, inAttr = false) {
  if (s.indexOf('&') === -1) return s;
  let out = '';
  let i = 0;
  const n = s.length;
  while (i < n) {
    const amp = s.indexOf('&', i);
    if (amp === -1) { out += s.slice(i); break; }
    out += s.slice(i, amp);
    let j = amp + 1;
    if (s.charCodeAt(j) === 35) { // '#'
      j += 1;
      let hex = false;
      if (s[j] === 'x' || s[j] === 'X') { hex = true; j += 1; }
      const start = j;
      while (j < n && j - start < 8 && (hex ? /[0-9a-fA-F]/.test(s[j]) : /[0-9]/.test(s[j]))) j += 1;
      if (j === start) { out += '&'; i = amp + 1; continue; }
      let cp = parseInt(s.slice(start, j), hex ? 16 : 10);
      while (j < n && (hex ? /[0-9a-fA-F]/.test(s[j]) : /[0-9]/.test(s[j]))) { cp = 0x110000; j += 1; } // overlong: replacement
      if (s[j] === ';') j += 1;
      out += codePointText(cp);
      i = j;
      continue;
    }
    const start = j;
    while (j < n && j - start < 32 && isAlnum(s.charCodeAt(j))) j += 1;
    const name = s.slice(start, j);
    if (name && s[j] === ';' && NAMED[name] !== undefined) {
      out += String.fromCodePoint(NAMED[name]);
      i = j + 1;
      continue;
    }
    // Longest legacy prefix with no semicolon (`&copy2019` -> (c)2019 in text).
    let matched = '';
    for (let k = Math.min(name.length, 6); k >= 2; k -= 1) {
      const cand = name.slice(0, k);
      if (LEGACY.has(cand)) { matched = cand; break; }
    }
    if (matched) {
      const next = s[start + matched.length];
      if (inAttr && next !== undefined && (next === '=' || isAlnum(next.charCodeAt(0)))) { out += '&'; i = amp + 1; continue; }
      out += String.fromCodePoint(NAMED[matched]);
      i = start + matched.length;
      continue;
    }
    out += '&';
    i = amp + 1;
  }
  return out;
}

function el(name, attrs) { return { type: 'element', name, attrs: attrs || [], children: [], parent: null }; }
function text(value) { return { type: 'text', value, parent: null }; }

// ---- the tokenizer + tree builder ---------------------------------------------
function parse(html, opts = {}) {
  const maxDepth = Number.isInteger(opts.maxDepth) ? opts.maxDepth : MAX_DEPTH;
  const maxNodes = Number.isInteger(opts.maxNodes) ? opts.maxNodes : MAX_NODES;
  const src = String(html == null ? '' : html).replace(/\r\n?/g, '\n').replace(/\u0000/g, '\ufffd'); // eslint-disable-line no-control-regex
  const root = { type: 'root', children: [], parent: null };
  const stack = [root];
  let nodes = 0;
  let dropDepth = 0; // elements opened past the caps: their tags are skipped, text is kept
  const seenSingleton = new Set(); // html / head / body: one each
  const top = () => stack[stack.length - 1];
  const inForeign = () => stack.some((x) => x.type === 'element' && FOREIGN.has(x.name));

  function append(node) {
    const parent = top();
    node.parent = parent;
    parent.children.push(node);
    nodes += 1;
  }
  function appendText(value) {
    if (value === '') return;
    const parent = top();
    const last = parent.children[parent.children.length - 1];
    if (last && last.type === 'text') { last.value += value; return; }
    append(text(value));
  }
  function inScope(name, boundary) {
    for (let k = stack.length - 1; k > 0; k -= 1) {
      const x = stack[k];
      if (x.name === name) return k;
      if (boundary.has(x.name)) return -1;
    }
    return -1;
  }
  function popTo(k) { stack.length = k; }
  function closeIfOpen(name, boundary) {
    const k = inScope(name, boundary);
    if (k > 0) popTo(k);
  }
  function findNamed(name) {
    for (let k = stack.length - 1; k > 0; k -= 1) if (stack[k].name === name) return k;
    return -1;
  }

  function startTag(name, attrs, selfClosing) {
    if (name === 'html' || name === 'head' || name === 'body') {
      // One of each, at the document's top; a repeat is dropped (its content stays).
      if (seenSingleton.has(name)) return;
      if (name === 'html' && stack.length !== 1) return;
      seenSingleton.add(name);
      if (name === 'body') closeIfOpen('head', SCOPE);
      const h = el(name, attrs); append(h); stack.push(h); return;
    }
    if (!inForeign()) {
      if (P_CLOSERS.has(name)) closeIfOpen('p', SCOPE);
      if (name === 'li') closeIfOpen('li', LIST_SCOPE);
      if (name === 'dt' || name === 'dd') { closeIfOpen('dt', DL_SCOPE); closeIfOpen('dd', DL_SCOPE); }
      if (HEADINGS.has(name) && HEADINGS.has(top().name)) stack.pop();
      if (name === 'a') closeIfOpen('a', SCOPE);
      if (name === 'option') closeIfOpen('option', SCOPE);
      if (name === 'optgroup') { closeIfOpen('option', SCOPE); closeIfOpen('optgroup', SCOPE); }
      if (name === 'tr') { closeIfOpen('td', TABLE_SCOPE); closeIfOpen('th', TABLE_SCOPE); closeIfOpen('tr', TABLE_SCOPE); }
      if (name === 'td' || name === 'th') { closeIfOpen('td', CELL_SCOPE); closeIfOpen('th', CELL_SCOPE); }
      if (name === 'thead' || name === 'tbody' || name === 'tfoot') {
        for (const t of SECTION_CLOSES) closeIfOpen(t, TABLE_SCOPE);
      }
    }
    if (stack.length > maxDepth || nodes >= maxNodes) {
      if (!VOID.has(name) && !selfClosing) dropDepth += 1;
      return;
    }
    const node = el(name, attrs);
    append(node);
    const isVoid = VOID.has(name) || (selfClosing && inForeign()) || (selfClosing && FOREIGN.has(name));
    if (!isVoid) stack.push(node);
  }

  function endTag(name) {
    if (name === 'br') { startTag('br', [], true); return; }
    if (name === 'html' || name === 'body' || name === 'head') {
      if (name === 'head') { const k = findNamed('head'); if (k > 0) popTo(k); }
      return; // closing body/html early would drop the tail; EOF closes them
    }
    const k = findNamed(name);
    if (k > 0) { popTo(k); return; }
    if (dropDepth > 0) dropDepth -= 1;
  }

  const n = src.length;
  let i = 0;
  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt === -1) { appendText(decodeEntities(src.slice(i))); break; }
    if (lt > i) appendText(decodeEntities(src.slice(i, lt)));
    i = lt;
    const c = src[i + 1];
    if (src.startsWith('<!--', i)) {
      const end = src.indexOf('-->', i + 4);
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (src.startsWith('<![CDATA[', i)) {
      const end = src.indexOf(']]>', i + 9);
      appendText(src.slice(i + 9, end === -1 ? n : end));
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (c === '!' || c === '?') {
      const end = src.indexOf('>', i + 2);
      i = end === -1 ? n : end + 1;
      continue;
    }
    if (c === '/') {
      let j = i + 2;
      while (j < n && /[A-Za-z0-9:-]/.test(src[j])) j += 1;
      const name = src.slice(i + 2, j).toLowerCase();
      const end = src.indexOf('>', j);
      i = end === -1 ? n : end + 1;
      if (name) endTag(name);
      continue;
    }
    if (!c || !/[A-Za-z]/.test(c)) { appendText('<'); i += 1; continue; }
    // A start tag.
    let j = i + 1;
    while (j < n && !/[\s/>]/.test(src[j])) j += 1;
    const rawName = src.slice(i + 1, j).toLowerCase();
    const attrs = [];
    const seen = new Set();
    let selfClosing = false;
    while (j < n) {
      while (j < n && /[\s]/.test(src[j])) j += 1;
      if (src[j] === '>') { j += 1; break; }
      if (src[j] === '/') {
        if (src[j + 1] === '>') { selfClosing = true; j += 2; break; }
        j += 1;
        continue;
      }
      const as = j;
      while (j < n && !/[\s/>=]/.test(src[j])) j += 1;
      if (j === as) { j += 1; continue; } // a lone '=' etc.
      const aname = src.slice(as, j).toLowerCase();
      while (j < n && /\s/.test(src[j])) j += 1;
      let value = '';
      if (src[j] === '=') {
        j += 1;
        while (j < n && /\s/.test(src[j])) j += 1;
        const q = src[j];
        if (q === '"' || q === "'") {
          const end = src.indexOf(q, j + 1);
          value = src.slice(j + 1, end === -1 ? n : end);
          j = end === -1 ? n : end + 1;
        } else {
          const vs = j;
          while (j < n && !/[\s>]/.test(src[j])) j += 1;
          value = src.slice(vs, j);
        }
      }
      if (ATTR_NAME_RE.test(aname) && !seen.has(aname)) {
        seen.add(aname);
        attrs.push([aname, decodeEntities(value, true)]);
      }
    }
    i = j;
    if (!TAG_NAME_RE.test(rawName)) continue;
    const name = rawName;
    if ((RAW_TEXT.has(name) || RCDATA.has(name)) && !selfClosing) {
      // Read to the matching end tag, case-insensitively, in one indexOf scan.
      const lower = name.length;
      let end = -1;
      let k = i;
      while (k < n) {
        const p = src.indexOf('</', k);
        if (p === -1) break;
        if (src.slice(p + 2, p + 2 + lower).toLowerCase() === name && /[\s/>]/.test(src[p + 2 + lower] || '>')) { end = p; break; }
        k = p + 2;
      }
      const body = src.slice(i, end === -1 ? n : end);
      startTag(name, attrs, false);
      if (top().name === name) {
        appendText(RCDATA.has(name) ? decodeEntities(body) : body);
        stack.pop();
      }
      if (end === -1) { i = n; } else { const close = src.indexOf('>', end); i = close === -1 ? n : close + 1; }
      continue;
    }
    startTag(name, attrs, selfClosing);
  }
  return root;
}

const HEAD_ONLY = new Set(['title', 'meta', 'link', 'base', 'style', 'script', 'noscript', 'template']);

// The html > head + body shape a browser always builds (JSDOMParser and the
// Original view both need it): a fragment, a page with no <html> (1992 markup)
// or one with no <body> is wrapped, head-only elements found before the first
// content going into <head>. Mutates and returns the tree.
function ensureDocument(tree) {
  const kids = tree.children;
  let html = kids.find((c) => c.type === 'element' && c.name === 'html');
  if (!html) {
    html = el('html', []);
    html.children = kids.filter((c) => c.type === 'element' || c.value.trim() !== '');
    tree.children = [html];
  } else {
    tree.children = [html];
  }
  html.parent = tree;
  let head = html.children.find((c) => c.type === 'element' && c.name === 'head');
  let body = html.children.find((c) => c.type === 'element' && c.name === 'body');
  const rest = html.children.filter((c) => c !== head && c !== body);
  if (!head) head = el('head', []);
  if (!body) body = el('body', []);
  const lead = [];
  let k = 0;
  // A head-only element (or blank text) before the first content belongs in <head>.
  while (k < rest.length && ((rest[k].type === 'element' && HEAD_ONLY.has(rest[k].name)) || (rest[k].type === 'text' && rest[k].value.trim() === ''))) {
    if (rest[k].type === 'element') lead.push(rest[k]);
    k += 1;
  }
  head.children = head.children.concat(lead);
  // Content found outside <body> keeps its order: before the body's own children
  // when it came first in the source, after them otherwise.
  const bodyIndex = html.children.indexOf(body);
  const tail = rest.slice(k);
  const before = bodyIndex === -1 ? tail : tail.filter((c) => html.children.indexOf(c) < bodyIndex);
  const after = bodyIndex === -1 ? [] : tail.filter((c) => html.children.indexOf(c) > bodyIndex);
  body.children = before.concat(body.children, after);
  html.children = [head, body];
  head.parent = html;
  body.parent = html;
  for (const c of head.children) c.parent = head;
  for (const c of body.children) c.parent = body;
  return tree;
}

function escapeText(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Markup from a tree. mode 'xml' (for JSDOMParser): every text escaped, voids as
// `<br/>`, every element closed. mode 'html' (what the browser renders): the same,
// except the contents of <style> are written raw (CSS must not see `&gt;`); the
// sanitizer guarantees no `</style` inside it and drops <script>.
function serialize(node, { mode = 'xml' } = {}) {
  const out = [];
  const walk = (x, rawParent) => {
    if (x.type === 'text') {
      out.push(rawParent ? x.value : escapeText(x.value));
      return;
    }
    if (x.type === 'element') {
      out.push('<', x.name);
      for (const [k, v] of x.attrs) out.push(' ', k, '="', escapeAttr(v), '"');
      if (VOID.has(x.name)) { out.push('/>'); return; }
      out.push('>');
      const raw = mode === 'html' && x.name === 'style';
      for (const ch of x.children) walk(ch, raw);
      out.push('</', x.name, '>');
      return;
    }
    for (const ch of x.children) walk(ch, false);
  };
  walk(node, false);
  return out.join('');
}

// Plain text of a subtree (block elements break lines). Used for metadata reads.
function textContent(node) {
  if (node.type === 'text') return node.value;
  let s = '';
  for (const ch of node.children || []) s += textContent(ch);
  return s;
}

function getAttr(node, name) {
  if (!node || !node.attrs) return null;
  for (const [k, v] of node.attrs) if (k === name) return v;
  return null;
}

function setAttr(node, name, value) {
  for (const a of node.attrs) if (a[0] === name) { a[1] = value; return; }
  node.attrs.push([name, value]);
}

function removeAttr(node, name) {
  node.attrs = node.attrs.filter((a) => a[0] !== name);
}

// Every element in document order (iterative: the tree can be deep).
function* elements(node) {
  const st = [node];
  while (st.length) {
    const x = st.pop();
    if (x.type === 'element') yield x;
    if (x.children) for (let k = x.children.length - 1; k >= 0; k -= 1) st.push(x.children[k]);
  }
}

module.exports = {
  MAX_DEPTH,
  MAX_NODES,
  VOID,
  parse,
  ensureDocument,
  serialize,
  decodeEntities,
  textContent,
  getAttr,
  setAttr,
  removeAttr,
  elements,
  escapeText,
  escapeAttr,
};
