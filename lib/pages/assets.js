'use strict';

// lib/pages/assets.js - store a capture's images, stylesheets and fonts locally
// (plan D-PARSE 5). Input: the capture-mode Reader and Original markup
// (lib/pages/sanitize.js) whose images are `data-ft-src`, whose stylesheets are
// `<style data-ft-href>` placeholders and whose CSS url()s are `ft-src:`
// placeholders. Every fetch goes through lib/pages/fetch.js (the SSRF guard).
// Output: the same markup with each stored asset as `assets/<sha256-24>.<ext>`,
// every failed one removed, then sanitized AGAIN in the final mode (only this
// item's own assets survive), plus the asset bytes for lib/pages/disk.js.
//
// Caps (plan D-STORE): 300 assets and 50 MB per item, 10 MB per asset, 30
// stylesheets of at most 2 MB. Over a cap the extra assets are dropped and the
// reason is recorded on the item; a failed asset is never fatal.

const crypto = require('crypto');
const tidy = require('./tidy');
const css = require('./css');
const { sanitize, readerFragment, originalDocument } = require('./sanitize');
const { guardedFetch, decodeHtml } = require('./fetch');

const MAX_ASSETS = 300;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;
const MAX_STYLESHEET_BYTES = css.MAX_CSS_BYTES;
const CONCURRENCY = 6;
const DEADLINE_MS = 120000;

// Magic bytes -> extension. SVG is NOT here: an SVG is a document that can carry
// script, so it is never stored as an asset (LESSONS 10: refuse SVG).
function sniff(buf) {
  if (!buf || buf.length < 4) return null;
  const b = buf;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { ext: 'png', kind: 'image' };
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: 'jpg', kind: 'image' };
  if (b.subarray(0, 6).toString('latin1') === 'GIF87a' || b.subarray(0, 6).toString('latin1') === 'GIF89a') return { ext: 'gif', kind: 'image' };
  if (b.length >= 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return { ext: 'webp', kind: 'image' };
  if (b.length >= 12 && b.subarray(4, 8).toString('latin1') === 'ftyp' && /^(avif|avis)$/.test(b.subarray(8, 12).toString('latin1'))) return { ext: 'avif', kind: 'image' };
  if (b[0] === 0x42 && b[1] === 0x4d && b.length > 26) return { ext: 'bmp', kind: 'image' };
  if (b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0) return { ext: 'ico', kind: 'image' };
  const sig = b.subarray(0, 4).toString('latin1');
  if (sig === 'wOF2') return { ext: 'woff2', kind: 'font' };
  if (sig === 'wOFF') return { ext: 'woff', kind: 'font' };
  if (sig === 'OTTO') return { ext: 'otf', kind: 'font' };
  if (b[0] === 0 && b[1] === 1 && b[2] === 0 && b[3] === 0) return { ext: 'ttf', kind: 'font' };
  return null;
}

const CONTENT_TYPES = Object.freeze({
  png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp',
  ico: 'image/x-icon', woff2: 'font/woff2', woff: 'font/woff', otf: 'font/otf', ttf: 'font/ttf',
});

function assetName(buf, ext) {
  return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 24) + '.' + ext;
}

// Run `fn` over items with at most `limit` in flight.
async function pool(items, limit, fn) {
  let next = 0;
  const workers = [];
  for (let w = 0; w < Math.min(limit, items.length); w += 1) {
    workers.push((async () => {
      while (next < items.length) {
        const k = next;
        next += 1;
        await fn(items[k], k);
      }
    })());
  }
  await Promise.all(workers);
}

function walkStyleBearers(tree, fn) {
  for (const node of tidy.elements(tree)) {
    if (node.name === 'style') fn(node, 'text');
    if (tidy.getAttr(node, 'style') !== null) fn(node, 'attr');
  }
}

// The localizer. `docs` = { reader?: string, original?: string, leadImage?: url,
// base: page URL }. Resolves { reader, original, assets: [{name, data}],
// leadImage: 'assets/...' | null, count, bytes, dropped: [reason...] }.
async function localize(docs, { deps = {}, now = () => Date.now(), deadlineMs = DEADLINE_MS } = {}) {
  const deadline = now() + deadlineMs;
  const dropped = [];
  const note = (why) => { if (dropped.length < 20 && !dropped.includes(why)) dropped.push(why); };
  const readerTree = typeof docs.reader === 'string' ? tidy.parse(docs.reader) : null;
  const originalTree = typeof docs.original === 'string' ? tidy.parse(docs.original) : null;

  // 1. Stylesheets (Original): fetch, sanitize against the SHEET's URL, inline.
  if (originalTree) {
    const sheets = [];
    for (const node of tidy.elements(originalTree)) if (node.name === 'style' && tidy.getAttr(node, 'data-ft-href')) sheets.push(node);
    await pool(sheets, CONCURRENCY, async (node) => {
      const href = tidy.getAttr(node, 'data-ft-href');
      tidy.removeAttr(node, 'data-ft-href');
      if (now() > deadline) { node.children = []; note('stylesheets: the time limit was reached'); return; }
      const r = await guardedFetch(href, { maxBytes: MAX_STYLESHEET_BYTES, accept: 'text/css,*/*;q=0.1', deps });
      if (!r.ok || (r.contentType && /^(image|video|audio|font)\//.test(r.contentType))) { node.children = []; note('a stylesheet could not be fetched'); return; }
      const out = css.sanitizeCss(decodeHtml(r.body, r.contentType), { base: r.finalUrl || href, mode: 'capture' });
      node.children = out.css ? [{ type: 'text', value: out.css, parent: node }] : [];
    });
  }

  // 2. Every asset URL, in document order: images first (Reader, Original), then CSS refs, then the lead image.
  const wanted = [];
  const want = (u, kind) => { if (typeof u === 'string' && u && !wanted.some((w) => w.url === u)) wanted.push({ url: u, kind }); };
  for (const t of [readerTree, originalTree]) {
    if (!t) continue;
    for (const node of tidy.elements(t)) if (node.name === 'img') want(tidy.getAttr(node, 'data-ft-src'), 'image');
  }
  if (originalTree) {
    walkStyleBearers(originalTree, (node, where) => {
      const text = where === 'text' ? tidy.textContent(node) : tidy.getAttr(node, 'style');
      for (const u of css.placeholderUrls(text)) want(u, 'css');
    });
  }
  want(docs.leadImage, 'image');

  // 3. Fetch under the caps.
  const stored = new Map(); // url -> 'assets/<name>'
  const assets = new Map(); // name -> Buffer
  let bytes = 0;
  if (wanted.length > MAX_ASSETS) note(`${wanted.length - MAX_ASSETS} assets over the ${MAX_ASSETS}-asset cap`);
  await pool(wanted.slice(0, MAX_ASSETS), CONCURRENCY, async (w) => {
    if (now() > deadline) { note('assets: the time limit was reached'); return; }
    if (bytes >= MAX_TOTAL_BYTES) { note('assets over the 50 MB cap'); return; }
    const r = await guardedFetch(w.url, { accept: w.kind === 'image' ? 'image/avif,image/webp,image/png,image/*;q=0.8' : '*/*', deps });
    if (!r.ok) { note('some images could not be fetched'); return; }
    const type = sniff(r.body);
    if (!type || (type.kind === 'font' && w.kind !== 'css')) { note('some files were not images or fonts'); return; }
    if (bytes + r.body.length > MAX_TOTAL_BYTES) { note('assets over the 50 MB cap'); return; }
    bytes += r.body.length;
    const name = assetName(r.body, type.ext);
    if (!assets.has(name)) assets.set(name, r.body);
    else bytes -= r.body.length;
    stored.set(w.url, 'assets/' + name);
  });

  // 4. Rewrite, then the FINAL sanitize (only stored assets survive).
  const rewriteImages = (t) => {
    for (const node of tidy.elements(t)) {
      if (node.name !== 'img') continue;
      const u = tidy.getAttr(node, 'data-ft-src');
      tidy.removeAttr(node, 'data-ft-src');
      if (u && stored.has(u)) tidy.setAttr(node, 'src', stored.get(u));
    }
  };
  let reader = null;
  let original = null;
  if (readerTree) {
    rewriteImages(readerTree);
    reader = readerFragment(sanitize(readerTree, { profile: 'reader', base: docs.base || null, final: true }).tree);
  }
  if (originalTree) {
    rewriteImages(originalTree);
    walkStyleBearers(originalTree, (node, where) => {
      if (where === 'text') {
        const text = css.resolvePlaceholders(tidy.textContent(node), stored);
        node.children = text ? [{ type: 'text', value: text, parent: node }] : [];
      } else {
        tidy.setAttr(node, 'style', css.resolvePlaceholders(tidy.getAttr(node, 'style'), stored));
      }
    });
    original = originalDocument(sanitize(originalTree, { profile: 'original', base: docs.base || null, final: true }).tree);
  }
  const used = new Set();
  const collect = (html) => { for (const m of String(html || '').matchAll(/assets\/([0-9a-f]{24}\.[a-z0-9]{1,5})/g)) used.add(m[1]); };
  collect(reader);
  collect(original);
  const lead = docs.leadImage && stored.has(docs.leadImage) ? stored.get(docs.leadImage) : (() => {
    const first = [...String(reader || '').matchAll(/src="(assets\/[0-9a-f]{24}\.(?:png|jpg|gif|webp|avif))"/g)][0];
    return first ? first[1] : null;
  })();
  if (lead) used.add(lead.slice(7));
  const kept = [...assets.entries()].filter(([name]) => used.has(name)).map(([name, data]) => ({ name, data }));
  return {
    reader,
    original,
    assets: kept,
    leadImage: lead,
    count: kept.length,
    bytes: kept.reduce((n, a) => n + a.data.length, 0),
    dropped,
  };
}

module.exports = { localize, sniff, assetName, CONTENT_TYPES, MAX_ASSETS, MAX_TOTAL_BYTES };
