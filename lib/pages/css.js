'use strict';

// lib/pages/css.js - the CSS half of the Pages sanitizer (plan D-PARSE 4): a
// stylesheet or a style="" value from a stranger's page, made inert. Tokenized
// (comments, strings, escapes, url(), at-keywords, functions, blocks), never
// regex-matched over raw text, so an escape (`u\rl(`, `\65 xpression(`) or a
// comment (`ex/**/pression(`) cannot hide a token from the check. Every check
// reads a token's DECODED value; the output re-emits the kept tokens' original
// text.
//
// Removed: @import (and @charset, @namespace); every declaration whose value
// names expression(), -moz-binding, behavior, javascript:/vbscript:, or a
// function that loads by string (image(), image-set(), cross-fade(), element(),
// paint(), src()). And every url():
//  - mode 'capture': an http(s) URL becomes a PLACEHOLDER
//    `url("ft-src:<encodeURIComponent(absolute URL)>")` that names nothing a
//    browser can load; the asset localizer (lib/pages/assets.js) swaps it for a
//    local file or `none`;
//  - mode 'final': only this item's own `assets/<sha>.<ext>` survives;
//  - both: a small raster data: image and a local `#id` reference are kept;
//    anything else becomes `none`.
// Nothing in the output can make the browser fetch from anywhere but the item's
// own assets (the CSP enforces that too: img-src / font-src 'self' data:).

const MAX_CSS_BYTES = 2 * 1024 * 1024;
const BAD_FUNCTIONS = new Set(['expression', 'image', 'image-set', '-webkit-image-set', 'cross-fade', '-webkit-cross-fade', 'element', '-moz-element', 'paint', 'src', 'env']);
const BAD_PROPERTIES = new Set(['behavior', '-moz-binding', 'binding']);
const DATA_IMAGE_RE = /^data:image\/(png|gif|jpeg|jpg|webp|avif);base64,[a-z0-9+/=\s]*$/i;
const ASSET_REF_RE = /^assets\/[0-9a-f]{24}\.[a-z0-9]{1,5}$/;
const PLACEHOLDER_RE = /url\("ft-src:([A-Za-z0-9%._~!*'()-]+)"\)/g;
const MAX_DATA_URI = 64 * 1024;

function isHex(c) { return /[0-9a-fA-F]/.test(c); }

// One pass. Token: { t: type, raw: source text, v: decoded value }.
function tokenize(css) {
  const s = css;
  const n = s.length;
  const out = [];
  let i = 0;
  const readEscape = () => { // s[i] is the backslash
    let j = i + 1;
    if (j >= n) { i = j; return '\ufffd'; }
    if (s[j] === '\n') { i = j + 1; return ''; }
    if (isHex(s[j])) {
      const st = j;
      while (j < n && j - st < 6 && isHex(s[j])) j += 1;
      const cp = parseInt(s.slice(st, j), 16);
      if (j < n && /\s/.test(s[j])) j += 1;
      i = j;
      return cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff) ? '\ufffd' : String.fromCodePoint(cp);
    }
    i = j + 1;
    return s[j];
  };
  const isNameChar = (c) => c !== undefined && (/[A-Za-z0-9_-]/.test(c) || c.charCodeAt(0) >= 0x80);
  const readName = () => {
    let v = '';
    while (i < n) {
      if (s[i] === '\\' && s[i + 1] !== '\n' && i + 1 < n) { v += readEscape(); continue; }
      if (!isNameChar(s[i])) break;
      v += s[i];
      i += 1;
    }
    return v;
  };
  while (i < n) {
    const start = i;
    const c = s[i];
    if (c === '/' && s[i + 1] === '*') {
      const end = s.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
      out.push({ t: 'ws', raw: ' ', v: ' ' }); // a comment separates tokens, like whitespace
      continue;
    }
    if (/\s/.test(c)) {
      while (i < n && /\s/.test(s[i])) i += 1;
      out.push({ t: 'ws', raw: s.slice(start, i), v: ' ' });
      continue;
    }
    if (c === '"' || c === "'") {
      i += 1;
      let v = '';
      while (i < n && s[i] !== c) {
        if (s[i] === '\\') { v += readEscape(); continue; }
        if (s[i] === '\n') break; // a bad string ends at the line
        v += s[i];
        i += 1;
      }
      if (s[i] === c) i += 1;
      out.push({ t: 'str', raw: s.slice(start, i), v });
      continue;
    }
    if (c === '@') {
      i += 1;
      const v = readName();
      out.push({ t: 'at', raw: s.slice(start, i), v: v.toLowerCase() });
      continue;
    }
    if (c === '{' || c === '}' || c === ';' || c === ':' || c === '(' || c === ')' || c === ',' || c === '[' || c === ']') {
      i += 1;
      out.push({ t: c, raw: c, v: c });
      continue;
    }
    if (isNameChar(c) || (c === '\\' && s[i + 1] !== '\n') || (c === '-' && (isNameChar(s[i + 1]) || s[i + 1] === '\\'))) {
      const v = readName();
      if (i === start) { i += 1; out.push({ t: 'delim', raw: c, v: c }); continue; }
      if (s[i] === '(') {
        i += 1;
        const name = v.toLowerCase();
        if (name === 'url') {
          // url( <ws>* (string | unquoted) <ws>* )
          let j = i;
          while (j < n && /\s/.test(s[j])) j += 1;
          if (s[j] === '"' || s[j] === "'") {
            out.push({ t: 'fn', raw: s.slice(start, i), v: 'url' });
            continue; // the string token + ')' follow as their own tokens
          }
          i = j;
          let u = '';
          while (i < n && s[i] !== ')') {
            if (s[i] === '\\') { u += readEscape(); continue; }
            u += s[i];
            i += 1;
          }
          if (s[i] === ')') i += 1;
          out.push({ t: 'url', raw: s.slice(start, i), v: u.trim() });
          continue;
        }
        out.push({ t: 'fn', raw: s.slice(start, i), v: name });
        continue;
      }
      out.push({ t: 'ident', raw: s.slice(start, i), v: v.toLowerCase() });
      continue;
    }
    i += 1;
    out.push({ t: 'delim', raw: c, v: c });
  }
  return out;
}

// Is this decoded URL one we may keep as a data: image inline?
function inlineDataImage(u) {
  return u.length <= MAX_DATA_URI && DATA_IMAGE_RE.test(u);
}

function resolveHttp(u, base) {
  try {
    const x = new URL(u, base);
    if ((x.protocol === 'http:' || x.protocol === 'https:') && !x.username && !x.password) return x.toString();
  } catch { /* not a URL */ }
  return null;
}

// Sanitize a whole stylesheet (`declarationsOnly` = a style="" value). `base` is
// the URL relative url()s resolve against (the stylesheet's own URL, or the
// page's for inline CSS). `refs` collects the absolute URLs of the placeholders.
function sanitizeCss(css, { base, refs = [], declarationsOnly = false, mode = 'capture' } = {}) {
  if (mode !== 'capture' && mode !== 'final') throw new Error('pages: unknown css mode');
  if (typeof css !== 'string' || css === '') return { css: '', refs };
  if (css.length > MAX_CSS_BYTES) return { css: '', refs, dropped: 'stylesheet over the size cap' };
  const toks = tokenize(css);
  // Pass 1: split into statements at the top level and declarations inside blocks,
  // marking ranges to drop.
  const drop = new Uint8Array(toks.length);
  const dropRange = (a, b) => { for (let k = a; k <= b && k < toks.length; k += 1) drop[k] = 1; };

  // @import / @charset / @namespace: to the next ';' at depth 0 (or the end of a block).
  let depth = 0;
  for (let k = 0; k < toks.length; k += 1) {
    const tk = toks[k];
    if (tk.t === '{') depth += 1;
    else if (tk.t === '}') depth = Math.max(0, depth - 1);
    else if (tk.t === 'at' && (tk.v === 'import' || tk.v === 'charset' || tk.v === 'namespace')) {
      let e = k;
      while (e < toks.length && toks[e].t !== ';' && toks[e].t !== '{' && toks[e].t !== '}') e += 1;
      if (toks[e] && toks[e].t === '{') { // a malformed @import with a block: drop the block too
        let d = 0;
        for (; e < toks.length; e += 1) { if (toks[e].t === '{') d += 1; else if (toks[e].t === '}') { d -= 1; if (d === 0) break; } }
      }
      dropRange(k, toks[e] && toks[e].t === '}' && depth > 0 ? e - 1 : e);
    }
  }

  // Declarations: a run between ';' / '{' / '}' that contains a ':' at its level.
  // A declaration is dropped whole when anything in it is dangerous.
  const isDangerous = (a, b) => {
    let prop = null;
    for (let k = a; k <= b; k += 1) {
      const tk = toks[k];
      if (prop === null && tk.t === 'ident') prop = tk.v;
      if (tk.t === 'fn' && BAD_FUNCTIONS.has(tk.v)) return true;
      if ((tk.t === 'ident' || tk.t === 'str' || tk.t === 'url' || tk.t === 'fn') && /(javascript|vbscript|livescript)\s*:|expression\s*\(|-moz-binding/i.test(tk.v)) return true;
      if (tk.t === 'ident' && BAD_PROPERTIES.has(tk.v)) return true;
    }
    return prop !== null && BAD_PROPERTIES.has(prop);
  };
  let segStart = 0;
  depth = declarationsOnly ? 1 : 0;
  const closeSeg = (end) => {
    if (end < segStart) return;
    let hasColon = false;
    for (let k = segStart; k <= end; k += 1) if (toks[k].t === ':') { hasColon = true; break; }
    if (hasColon && depth > 0 && isDangerous(segStart, end)) dropRange(segStart, end);
  };
  for (let k = 0; k < toks.length; k += 1) {
    const tk = toks[k];
    if (tk.t === '{') { // a selector or at-rule prelude ends; a prelude with a bad function is dropped with its block
      if (isDangerous(segStart, k)) {
        let d = 0; let e = k;
        for (; e < toks.length; e += 1) { if (toks[e].t === '{') d += 1; else if (toks[e].t === '}') { d -= 1; if (d === 0) break; } }
        dropRange(segStart, e);
        k = e;
        segStart = e + 1;
        continue;
      }
      depth += 1;
      segStart = k + 1;
    } else if (tk.t === '}') {
      closeSeg(k - 1);
      depth = Math.max(0, depth - 1);
      segStart = k + 1;
    } else if (tk.t === ';') {
      closeSeg(k - 1);
      segStart = k + 1;
    }
  }
  closeSeg(toks.length - 1);

  // Pass 2: emit, turning every url() into a placeholder (or dropping it).
  let out = '';
  for (let k = 0; k < toks.length; k += 1) {
    if (drop[k]) continue;
    const tk = toks[k];
    let urlValue = null;
    let skipTo = k;
    if (tk.t === 'url') urlValue = tk.v;
    else if (tk.t === 'fn' && tk.v === 'url') {
      let j = k + 1;
      while (j < toks.length && toks[j].t === 'ws') j += 1;
      if (toks[j] && toks[j].t === 'str') {
        urlValue = toks[j].v;
        j += 1;
        while (j < toks.length && toks[j].t === 'ws') j += 1;
        skipTo = toks[j] && toks[j].t === ')' ? j : j - 1;
      } else {
        urlValue = '';
        skipTo = k;
      }
    }
    if (urlValue !== null) {
      const u = urlValue.trim();
      if (u.startsWith('#')) out += 'url("' + u.replace(/[^#A-Za-z0-9_-]/g, '') + '")'; // an SVG fragment ref (a local id)
      else if (/^data:/i.test(u) && inlineDataImage(u)) out += 'url("' + u.replace(/[\s"\\]/g, '') + '")';
      else if (mode === 'final') out += ASSET_REF_RE.test(u) ? 'url("' + u + '")' : 'none';
      else {
        const abs = resolveHttp(u, base);
        if (abs) {
          if (!refs.includes(abs)) refs.push(abs);
          out += 'url("ft-src:' + encodeURIComponent(abs) + '")';
        } else {
          out += 'none';
        }
      }
      k = skipTo;
      continue;
    }
    out += tk.raw;
  }
  // The text is written raw inside <style> (lib/pages/tidy.js serialize, html mode):
  // nothing in it may close the element.
  out = out.replace(/<\//g, '<\\/').replace(/<!--/g, '<\\!--');
  return { css: out, refs };
}

// The absolute URLs a capture-mode text's placeholders stand for.
function placeholderUrls(css) {
  const out = [];
  for (const m of String(css).matchAll(PLACEHOLDER_RE)) {
    let u;
    try { u = decodeURIComponent(m[1]); } catch { continue; }
    if (resolveHttp(u, undefined) === u && !out.includes(u)) out.push(u);
  }
  return out;
}

// The localizer's last step: each placeholder becomes `assets/<name>` from `map`
// (absolute URL -> local path), or `none` when that asset was not stored.
function resolvePlaceholders(css, map) {
  return String(css).replace(PLACEHOLDER_RE, (_m, enc) => {
    let u;
    try { u = decodeURIComponent(enc); } catch { return 'none'; }
    const local = map.get(u);
    return local ? 'url("' + local + '")' : 'none';
  });
}

module.exports = { tokenize, sanitizeCss, placeholderUrls, resolvePlaceholders, MAX_CSS_BYTES, ASSET_REF_RE };
