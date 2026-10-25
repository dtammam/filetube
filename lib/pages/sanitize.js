'use strict';

// lib/pages/sanitize.js - untrusted page HTML -> markup we store and render (plan
// D-PARSE 4, D-RENDER). An ALLOWLIST: an element not named here is unwrapped
// (its text kept) or, for the dangerous ones in DROP, removed with its content;
// an attribute not named for its element is removed. Two profiles:
//
//  - 'reader': the article only - text structure, links, images, tables, code.
//    No class, id, style; rendered INLINE in the app (lib/pages + public/js/pages.js).
//  - 'original': the whole page's layout - adds the layout elements, class / id /
//    sanitized style (lib/pages/css.js), a safe SVG subset; rendered in a
//    sandboxed iframe with a CSP (defense in depth: sanitizer AND sandbox AND CSP).
//
// And two modes, because images and stylesheets are stored locally AFTER capture:
//
//  - 'capture': every image URL becomes `data-ft-src="<absolute http(s) URL>"`
//    (no src: nothing loads), every stylesheet a `<style data-ft-href>` placeholder,
//    every CSS url() a `url("ft-src:...")` placeholder (lib/pages/css.js).
//  - 'final': the localizer's output is sanitized AGAIN, and now the only image
//    and CSS URLs allowed are this item's own `assets/<sha>.<ext>` files and small
//    raster data: images; every placeholder left over is removed.
//
// Always removed: script, iframe/frame, object/embed/applet, form controls, base,
// meta (one charset meta is written by us), every on* attribute (not on the
// list), javascript:/vbscript:/data: (but raster data: images) URLs, srcdoc,
// formaction, xlink:href to anything but a local #id.

const tidy = require('./tidy');
const { sanitizeCss } = require('./css');
const { isAssetName } = require('./paths');

const READER_TAGS = new Set([
  'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'q', 'cite', 'pre', 'code', 'kbd', 'samp', 'var',
  'em', 'strong', 'b', 'i', 'u', 's', 'strike', 'del', 'ins', 'mark', 'small', 'sub', 'sup', 'abbr', 'dfn', 'time',
  'span', 'div', 'section', 'article', 'header', 'footer', 'aside', 'figure', 'figcaption', 'img', 'ul', 'ol', 'li',
  'dl', 'dt', 'dd', 'table', 'caption', 'colgroup', 'col', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'a',
  'details', 'summary', 'ruby', 'rt', 'rp', 'bdi', 'bdo', 'wbr', 'address',
]);
const ORIGINAL_EXTRA = [
  'html', 'head', 'body', 'title', 'style', 'main', 'nav', 'center', 'font', 'big', 'tt', 'label', 'fieldset', 'legend',
  'menu', 'hgroup', 'search', 'noscript', 'data',
];
const ORIGINAL_TAGS = new Set([...READER_TAGS, ...ORIGINAL_EXTRA]);
// A safe SVG subset (Original only): shapes, text, gradients, local references.
const SVG_TAGS = new Set(['svg', 'g', 'path', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'rect', 'text', 'tspan', 'defs', 'lineargradient', 'radialgradient', 'stop', 'clippath', 'mask', 'symbol', 'use', 'title', 'desc', 'pattern']);
const SVG_ATTRS = new Set(['d', 'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-opacity', 'viewbox', 'width', 'height', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'points', 'transform', 'opacity', 'clip-rule', 'offset', 'stop-color', 'stop-opacity', 'gradientunits', 'gradienttransform', 'patternunits', 'patterntransform', 'preserveaspectratio', 'xmlns', 'class', 'id', 'role', 'aria-hidden', 'aria-label', 'focusable', 'font-size', 'font-family', 'font-weight', 'text-anchor', 'dominant-baseline', 'dx', 'dy', 'visibility', 'display', 'color', 'version', 'fx', 'fy', 'spreadmethod', 'maskunits', 'clippathunits']);
const SVG_REF_ATTRS = new Set(['clip-path', 'mask', 'fill', 'stroke', 'filter']);

// Removed WITH their content (everything else not allowed is unwrapped).
const DROP = new Set([
  'script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'input', 'button', 'select', 'textarea',
  'option', 'optgroup', 'datalist', 'progress', 'meter', 'base', 'meta', 'link', 'template', 'canvas', 'audio', 'video',
  'track', 'source', 'param', 'map', 'area', 'dialog', 'portal', 'slot', 'math', 'noembed', 'noframes', 'xmp',
  'plaintext', 'keygen', 'command', 'foreignobject', 'animate', 'animatemotion', 'animatetransform', 'set',
  'handler', 'listener', 'image', 'feimage', 'discard', 'output',
]);
const READER_DROP_EXTRA = new Set(['style', 'noscript', 'head', 'title', 'svg', 'form', 'nav']);

const GLOBAL_READER_ATTRS = new Set(['lang', 'dir', 'title']);
const GLOBAL_ORIGINAL_ATTRS = new Set(['lang', 'dir', 'title', 'class', 'id', 'role', 'hidden', 'align', 'valign', 'width', 'height', 'bgcolor', 'color', 'border', 'cellpadding', 'cellspacing', 'nowrap', 'clear', 'noshade', 'size', 'face', 'summary', 'headers', 'abbr', 'axis', 'name', 'tabindex', 'translate']);
const PER_TAG = {
  a: ['href'],
  img: ['alt', 'width', 'height'],
  td: ['colspan', 'rowspan', 'scope', 'headers'],
  th: ['colspan', 'rowspan', 'scope', 'headers', 'abbr'],
  col: ['span'],
  colgroup: ['span'],
  ol: ['start', 'reversed', 'type'],
  ul: ['type'],
  li: ['value', 'type'],
  time: ['datetime'],
  data: ['value'],
  style: ['media'],
  details: ['open'],
  bdo: ['dir'],
};
const NUMERIC = new Set(['width', 'height', 'colspan', 'rowspan', 'span', 'start', 'value', 'border', 'cellpadding', 'cellspacing', 'size', 'tabindex']);
const ENUMS = {
  scope: /^(row|col|rowgroup|colgroup)$/i,
  type: /^(1|a|i|disc|circle|square)$/i,
  dir: /^(ltr|rtl|auto)$/i,
  reversed: /^(|reversed)$/i,
  open: /^(|open)$/i,
  hidden: /^(|hidden|until-found)$/i,
  nowrap: /^(|nowrap)$/i,
  noshade: /^(|noshade)$/i,
  translate: /^(yes|no)$/i,
};
const MAX_ATTR = 4096;
const MAX_STYLE_ATTR = 16384;
const DATA_IMAGE_RE = /^data:image\/(png|gif|jpeg|jpg|webp|avif);base64,[A-Za-z0-9+/=]*$/;
const MAX_DATA_IMAGE = 64 * 1024;
const LAZY_SRC_ATTRS = ['data-src', 'data-lazy-src', 'data-original', 'data-hi-res-src', 'data-full-src', 'data-lazy', 'data-url', 'data-orig-src'];
const LAZY_SRCSET_ATTRS = ['data-srcset', 'data-lazy-srcset'];
const MAX_STYLESHEETS = 30;
const URL_LIKE = /^\s*(javascript|vbscript|livescript|data|file|filesystem|blob):/i;

function httpUrl(v, base) {
  if (typeof v !== 'string' || v.trim() === '' || v.length > 4096) return null;
  try {
    const u = new URL(v.trim(), base);
    if ((u.protocol === 'http:' || u.protocol === 'https:') && !u.username && !u.password) return u.toString();
  } catch { /* not a URL */ }
  return null;
}

function linkUrl(v, base) {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (/^mailto:[^\s<>"]{1,512}$/i.test(t)) return t;
  return httpUrl(t, base);
}

function dataImage(v) {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, '');
  return t.length <= MAX_DATA_IMAGE && DATA_IMAGE_RE.test(t) ? t : null;
}

// The srcset spec's own split (a URL can hold commas: `w_100,h_50`): a URL runs to
// whitespace; trailing commas end it; descriptors run to the next comma.
function parseSrcset(s) {
  const out = [];
  if (typeof s !== 'string') return out;
  let i = 0;
  const n = Math.min(s.length, 16384);
  while (i < n) {
    while (i < n && /[\s,]/.test(s[i])) i += 1;
    const us = i;
    while (i < n && !/\s/.test(s[i])) i += 1;
    let url = s.slice(us, i);
    let descriptor = '';
    if (url.endsWith(',')) url = url.replace(/,+$/, '');
    else {
      const ds = i;
      let paren = 0;
      while (i < n && (paren > 0 || s[i] !== ',')) { if (s[i] === '(') paren += 1; else if (s[i] === ')') paren -= 1; i += 1; }
      descriptor = s.slice(ds, i).trim();
    }
    if (url) {
      let w = 0; let x = 1;
      const mw = /^(\d+)w$/.exec(descriptor);
      const mx = /^(\d+(?:\.\d+)?)x$/.exec(descriptor);
      if (mw) w = Number(mw[1]);
      else if (mx) x = Number(mx[1]);
      out.push({ url, w, x });
    }
  }
  return out;
}

// The best candidate: the widest at or under 1600 px (else the narrowest wider),
// or the highest density at or under 2x.
function bestFromSrcset(s) {
  const c = parseSrcset(s);
  if (c.length === 0) return null;
  const byW = c.filter((x) => x.w > 0);
  if (byW.length) {
    const under = byW.filter((x) => x.w <= 1600).sort((a, b) => b.w - a.w);
    if (under.length) return under[0].url;
    return byW.sort((a, b) => a.w - b.w)[0].url;
  }
  const under = c.filter((x) => x.x <= 2).sort((a, b) => b.x - a.x);
  return (under[0] || c[0]).url;
}

// The URL an <img> (or a <picture>'s sources) means to show.
function imageCandidate(node, sources) {
  const get = (k) => tidy.getAttr(node, k);
  for (const s of sources || []) {
    const type = (tidy.getAttr(s, 'type') || '').toLowerCase();
    if (type && !/^image\/(webp|jpeg|jpg|png|gif|avif)$/.test(type)) continue;
    const pick = bestFromSrcset(tidy.getAttr(s, 'srcset') || tidy.getAttr(s, 'data-srcset'));
    if (pick) return pick;
  }
  for (const k of LAZY_SRCSET_ATTRS) { const p = bestFromSrcset(get(k)); if (p) return p; }
  const fromSrcset = bestFromSrcset(get('srcset'));
  if (fromSrcset) return fromSrcset;
  for (const k of LAZY_SRC_ATTRS) { const v = get(k); if (v && !/^data:/i.test(v.trim())) return v; }
  return get('src');
}

function cleanAttrValue(name, value) {
  if (typeof value !== 'string' || value.length > MAX_ATTR) return null;
  // eslint-disable-next-line no-control-regex
  const v = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  if (NUMERIC.has(name)) return /^\s*\d{1,6}(?:%|px)?\s*$/.test(v) ? v.trim().replace(/px$/, '') : null;
  if (ENUMS[name]) return ENUMS[name].test(v.trim()) ? v.trim() : null;
  if (URL_LIKE.test(v)) return null; // a non-URL attribute that still spells a script URL
  return v;
}

function svgRefOk(v) {
  // fill="url(#grad)" / clip-path="url(#c)" (a local id), or a plain paint value.
  const t = v.trim();
  if (/^url\(\s*['"]?#[A-Za-z0-9_-]{1,100}['"]?\s*\)/.test(t)) return t.replace(/\s+/g, '');
  if (/url\(/i.test(t)) return null;
  return t;
}

// The sanitizer. Returns { tree, images, stylesheets, cssRefs, dropped }.
// `ctx.final` = the final mode (local assets only). `ctx.base` = the page URL.
function sanitize(input, { profile = 'reader', base = null, final = false } = {}) {
  if (profile !== 'reader' && profile !== 'original') throw new Error('pages: unknown sanitizer profile');
  const original = profile === 'original';
  const tree = typeof input === 'string' ? tidy.parse(input) : input;
  const allowed = original ? ORIGINAL_TAGS : READER_TAGS;
  const dropSet = original ? DROP : new Set([...DROP, ...READER_DROP_EXTRA]);
  const globals = original ? GLOBAL_ORIGINAL_ATTRS : GLOBAL_READER_ATTRS;
  const report = { images: [], stylesheets: [], cssRefs: [], dropped: [] };
  const seenImages = new Set();
  const cssOpts = () => ({ base, mode: final ? 'final' : 'capture' });

  function addRefs(refs) { for (const r of refs) if (!report.cssRefs.includes(r)) report.cssRefs.push(r); }

  function cleanImg(node, sources) {
    const out = { type: 'element', name: 'img', attrs: [], children: [], parent: null };
    if (final) {
      const src = tidy.getAttr(node, 'src');
      if (src && /^assets\//.test(src) && isAssetName(src.slice(7))) out.attrs.push(['src', src]);
      else if (dataImage(src)) out.attrs.push(['src', dataImage(src)]);
      else return null; // an image that was not stored is not shown
    } else {
      const pending = tidy.getAttr(node, 'data-ft-src');
      const cand = pending || imageCandidate(node, sources);
      const data = dataImage(cand) || dataImage(tidy.getAttr(node, 'src'));
      const abs = httpUrl(cand, base);
      if (abs) {
        out.attrs.push(['data-ft-src', abs]);
        if (!seenImages.has(abs)) { seenImages.add(abs); report.images.push(abs); }
      } else if (data) {
        out.attrs.push(['src', data]);
      } else {
        return null;
      }
    }
    for (const k of ['alt', 'width', 'height', 'title']) {
      const v = tidy.getAttr(node, k);
      const c = v === null ? null : cleanAttrValue(k, v);
      if (c !== null) out.attrs.push([k, c]);
    }
    if (original) {
      for (const k of ['class', 'id']) { const v = tidy.getAttr(node, k); if (v && v.length <= MAX_ATTR) out.attrs.push([k, v]); }
      const st = tidy.getAttr(node, 'style');
      if (st) { const r = sanitizeCss(st, { ...cssOpts(), declarationsOnly: true }); addRefs(r.refs); if (r.css.trim()) out.attrs.push(['style', r.css]); }
    }
    out.attrs.push(['loading', 'lazy']);
    return out;
  }

  function cleanAttrs(node, inSvg) {
    const out = [];
    const tagAttrs = PER_TAG[node.name] || [];
    for (const [k, v] of node.attrs) {
      if (k.startsWith('on')) continue;
      if (inSvg) {
        if (k === 'href' || k === 'xlink:href') {
          if (node.name === 'use' && /^#[A-Za-z0-9_-]{1,100}$/.test(v.trim())) out.push(['href', v.trim()]);
          continue;
        }
        if (SVG_REF_ATTRS.has(k)) { const r = svgRefOk(v); if (r !== null) out.push([k, r]); continue; }
        if (k === 'style') { const r = sanitizeCss(v, { ...cssOpts(), declarationsOnly: true }); addRefs(r.refs); if (r.css.trim()) out.push(['style', r.css]); continue; }
        if (SVG_ATTRS.has(k)) { const c = cleanAttrValue(k === 'width' || k === 'height' ? 'svgsize' : k, v); if (c !== null) out.push([k, c]); }
        continue;
      }
      if (k === 'href' && node.name === 'a') {
        const u = linkUrl(v, base);
        if (u) out.push(['href', u]);
        continue;
      }
      if (k === 'style' && original) {
        if (v.length > MAX_STYLE_ATTR) continue;
        const r = sanitizeCss(v, { ...cssOpts(), declarationsOnly: true });
        addRefs(r.refs);
        if (r.css.trim()) out.push(['style', r.css]);
        continue;
      }
      if (k === 'type' && !['ol', 'ul', 'li'].includes(node.name)) continue;
      if (k === 'width' || k === 'height' || k === 'align' || k === 'valign' || k === 'bgcolor' || k === 'color' || k === 'border' || k === 'size' || k === 'face') {
        if (!original && !tagAttrs.includes(k)) continue;
      }
      if (!globals.has(k) && !tagAttrs.includes(k) && !(original && /^aria-[a-z-]{1,40}$/.test(k))) continue;
      const c = cleanAttrValue(k, v);
      if (c !== null) out.push([k, c]);
    }
    if (node.name === 'a' && out.some((a) => a[0] === 'href')) {
      out.push(['target', '_blank']);
      out.push(['rel', 'noopener noreferrer']);
    }
    return out;
  }

  function cleanChildren(node, inSvg) {
    const out = [];
    for (const ch of node.children || []) for (const c of cleanNode(ch, inSvg)) out.push(c);
    return out;
  }

  function cleanNode(node, inSvg) {
    if (node.type === 'text') return [{ type: 'text', value: node.value, parent: null }];
    if (node.type !== 'element') return [];
    const name = node.name;
    if (name.includes(':') && !inSvg) return cleanChildren(node, inSvg); // o:p and friends: unwrap
    if (name === 'picture') {
      const img = node.children.find((c) => c.type === 'element' && c.name === 'img');
      const sources = node.children.filter((c) => c.type === 'element' && c.name === 'source');
      if (!img && sources.length === 0) return [];
      const cleaned = cleanImg(img || { type: 'element', name: 'img', attrs: [], children: [] }, sources);
      return cleaned ? [cleaned] : [];
    }
    if (name === 'img') { const c = cleanImg(node, null); return c ? [c] : []; }
    if (original && name === 'link') {
      if (final) return [];
      const rel = (tidy.getAttr(node, 'rel') || '').toLowerCase().split(/\s+/);
      const href = httpUrl(tidy.getAttr(node, 'href'), base);
      if (!rel.includes('stylesheet') || rel.includes('alternate') || !href || report.stylesheets.length >= MAX_STYLESHEETS) return [];
      const media = tidy.getAttr(node, 'media');
      report.stylesheets.push(href);
      const attrs = [['data-ft-href', href]];
      if (media && /^[a-z0-9 (),:.\-_]{1,200}$/i.test(media)) attrs.push(['media', media]);
      return [{ type: 'element', name: 'style', attrs, children: [], parent: null }];
    }
    if (original && name === 'style') {
      if (inSvg) return [];
      const pendingHref = final ? null : tidy.getAttr(node, 'data-ft-href');
      const attrs = [];
      if (pendingHref && httpUrl(pendingHref, base)) {
        attrs.push(['data-ft-href', httpUrl(pendingHref, base)]);
        if (!report.stylesheets.includes(attrs[0][1])) report.stylesheets.push(attrs[0][1]);
      }
      const media = tidy.getAttr(node, 'media');
      if (media && /^[a-z0-9 (),:.\-_]{1,200}$/i.test(media)) attrs.push(['media', media]);
      const r = sanitizeCss(tidy.textContent(node), cssOpts());
      addRefs(r.refs);
      if (!r.css.trim() && !pendingHref) return [];
      return [{ type: 'element', name: 'style', attrs, children: r.css ? [{ type: 'text', value: r.css, parent: null }] : [], parent: null }];
    }
    if (dropSet.has(name)) return [];
    if (original && name === 'svg' && !inSvg) {
      return [{ type: 'element', name: 'svg', attrs: cleanAttrs(node, true), children: cleanChildren(node, true), parent: null }];
    }
    if (inSvg) {
      if (!SVG_TAGS.has(name)) return [];
      return [{ type: 'element', name, attrs: cleanAttrs(node, true), children: cleanChildren(node, true), parent: null }];
    }
    if (!allowed.has(name)) return cleanChildren(node, false);
    return [{ type: 'element', name, attrs: cleanAttrs(node, false), children: cleanChildren(node, false), parent: null }];
  }

  const root = { type: 'root', children: cleanChildren(tree, false), parent: null };
  return { tree: root, ...report };
}

// The stored Original: a full document with a charset meta and the sanitized tree.
function originalDocument(cleanTree) {
  const t = tidy.ensureDocument(cleanTree);
  const html = t.children[0];
  const head = html.children[0];
  head.children.unshift({ type: 'element', name: 'meta', attrs: [['charset', 'utf-8']], children: [], parent: head });
  return '<!DOCTYPE html>\n' + tidy.serialize(t, { mode: 'html' }) + '\n';
}

function readerFragment(cleanTree) {
  return tidy.serialize(cleanTree, { mode: 'html' }) + '\n';
}

module.exports = { sanitize, originalDocument, readerFragment, parseSrcset, bestFromSrcset, imageCandidate, httpUrl, READER_TAGS, ORIGINAL_TAGS, DROP };
