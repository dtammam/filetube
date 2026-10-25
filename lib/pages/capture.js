'use strict';

// lib/pages/capture.js - one URL save, end to end (plan D-PARSE, Error handling):
//
//   input  : the page as a device's browser rendered it (`html`, its URL), or a
//            bare link the server fetches through the guard (lib/pages/fetch.js)
//   extract: tidy + Readability + metadata (lib/pages/extract.js)
//   sanitize (capture mode): the Reader (when extraction found an article) and
//            the Original (always), lib/pages/sanitize.js
//   write  : the item at once, images pending (lib/pages/service.js saveItem)
//   assets : localized afterwards (lib/pages/assets.js), the item's files
//            rewritten in place when they land (service.updateFiles)
//
// A save never loses what it got: device HTML is used as sent (a server fetch is
// only for a bare link); extraction failed = Original only ("Reader view
// unavailable"); assets failed = the item without them; a server fetch that
// fails entirely writes nothing and returns the error.

const meta = require('./meta');
const { extract, treeToText } = require('./extract');
const { sanitize, readerFragment, originalDocument } = require('./sanitize');
const { fetchPage, PAGE_MAX_BYTES } = require('./fetch');
const { localize } = require('./assets');

function badRequest(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

// The item record + files for one page. Pure but for the optional fetch.
async function buildFromUrl({ url, html = null, note = '', source = 'api', title = null }, { deps } = {}) {
  const pageUrl = meta.cleanUrl(url);
  if (!pageUrl) throw badRequest('url must be an http(s) link');
  let body = html;
  let finalUrl = pageUrl;
  if (typeof body === 'string') {
    if (Buffer.byteLength(body, 'utf8') > PAGE_MAX_BYTES) throw badRequest('the page is larger than 10 MB', 413);
  } else {
    const got = await fetchPage(pageUrl, { deps });
    if (!got.ok) throw badRequest(`Could not fetch the page: ${got.error}`, 502);
    body = got.html;
    finalUrl = got.finalUrl || pageUrl;
  }
  const ex = extract(body, finalUrl);
  const readerClean = ex.article ? sanitize(ex.article.tree, { profile: 'reader', base: finalUrl }) : null;
  const originalClean = sanitize(ex.tree, { profile: 'original', base: finalUrl });
  const files = {};
  if (readerClean) files['reader.html'] = readerFragment(readerClean.tree);
  files['original.html'] = originalDocument(originalClean.tree);
  const text = ex.article ? ex.article.text : treeToText(originalClean.tree);
  files['text.txt'] = (text || '').trim() + '\n';
  const words = meta.countWords(text || '');
  const m = ex.metadata;
  const record = {
    kind: 'url',
    title: meta.cleanText(title || '', meta.LIMITS.title) || meta.cleanText(m.title || '', meta.LIMITS.title) || pageUrl,
    site: m.site,
    author: m.author,
    url: pageUrl,
    canonicalUrl: m.canonicalUrl || (finalUrl !== pageUrl ? meta.cleanUrl(finalUrl) : null) || pageUrl,
    publishedAt: m.publishedAt,
    wordCount: words,
    readingMinutes: meta.readingMinutes(words),
    leadImage: null,
    description: m.description,
    language: m.language,
    source,
    note,
    hasReader: !!readerClean,
    hasOriginal: true,
    assets: { state: 'pending', count: 0, bytes: 0, dropped: [] },
  };
  return { record, files, leadImageUrl: m.leadImage, base: finalUrl };
}

function createCapture({ service, deps = {}, log = console.log, now = () => Date.now() } = {}) {
  const inFlight = new Map(); // item id -> promise: one localization per item at a time

  // Localize one saved item's assets and rewrite its files. Reads what is STORED
  // (never the capture's memory), so a restart resumes it from the files; the
  // write re-checks inside the queue that the item is still pending.
  function localizeItem(userId, id, leadUrl = null) {
    if (inFlight.has(id)) return inFlight.get(id);
    const run = (async () => {
      const item = service.getItem(userId, id);
      if (!item || item.assetsState !== 'pending') return item;
      const reader = service.readFile(item, 'reader.html');
      const original = service.readFile(item, 'original.html');
      let out = null;
      try {
        out = await localize({ reader, original, leadImage: leadUrl, base: item.url }, { deps: deps.fetch, now });
      } catch (err) {
        log(`[pages] images for ${id} failed: ${err && err.message}`);
      }
      return service.updateFiles(userId, id, (cur) => {
        if (!cur.assets || cur.assets.state !== 'pending') return null;
        const files = {};
        if (out && typeof out.reader === 'string' && typeof reader === 'string') files['reader.html'] = out.reader;
        if (out && typeof out.original === 'string' && typeof original === 'string') files['original.html'] = out.original;
        return {
          record: {
            ...cur,
            leadImage: out ? out.leadImage : null,
            assets: { state: 'done', count: out ? out.count : 0, bytes: out ? out.bytes : 0, dropped: out ? out.dropped : ['the images could not be saved'] },
          },
          files,
          assets: out ? out.assets : [],
        };
      });
    })().finally(() => inFlight.delete(id));
    inFlight.set(id, run);
    return run;
  }

  // Save a URL. Resolves { item, duplicate, localized: Promise<item> }.
  async function saveUrl(userId, input) {
    const pageUrl = meta.cleanUrl(input.url);
    if (!pageUrl) throw badRequest('url must be an http(s) link');
    const early = service.index.findByUrl(userId, pageUrl);
    if (early) return { item: early, duplicate: true, localized: Promise.resolve(early) };
    const built = await buildFromUrl(input, { deps: deps.fetch });
    const saved = await service.saveItem(userId, { record: built.record, files: built.files });
    if (saved.duplicate) return { item: saved.item, duplicate: true, localized: Promise.resolve(saved.item) };
    return { item: saved.item, duplicate: false, localized: localizeItem(userId, saved.item.id, built.leadImageUrl) };
  }

  // Boot: finish every item a restart interrupted (one at a time, in the background).
  async function resumePending() {
    let n = 0;
    for (const p of service.index.pendingItems()) {
      try { await localizeItem(p.userId, p.id, null); n += 1; } catch (err) { log(`[pages] resume ${p.id}: ${err && err.message}`); }
    }
    return n;
  }

  return { saveUrl, localizeItem, resumePending, inFlight };
}

module.exports = { createCapture, buildFromUrl };
