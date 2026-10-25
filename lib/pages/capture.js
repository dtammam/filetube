'use strict';

// lib/pages/capture.js - one URL save, end to end (plan D-PARSE, Error handling):
//
//   input  : the page as a device's browser rendered it (`html`, its URL), or a
//            bare link the server fetches through the guard (lib/pages/fetch.js)
//   process: tidy + Readability + metadata + the capture-mode sanitize of the
//            Reader (when extraction found an article) and the Original (always),
//            in a worker thread with a deadline (lib/pages/process.js)
//   write  : the item at once, images pending (lib/pages/service.js saveItem)
//   assets : localized afterwards (lib/pages/assets.js), the item's files
//            rewritten in place when they land (service.updateFiles)
//
// A save never loses what it got: device HTML is used as sent (a server fetch is
// only for a bare link); extraction failed = Original only ("Reader view
// unavailable"); assets failed = the item without them; a server fetch that
// fails entirely writes nothing and returns the error.

const meta = require('./meta');
const { processInWorker } = require('./process');
const { fetchPage, PAGE_MAX_BYTES } = require('./fetch');
const { localize } = require('./assets');

function badRequest(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

// The item record + files for one page. Pure but for the optional fetch.
async function buildFromUrl({ url, html = null, note = '', source = 'api', title = null }, opts = {}) {
  const deps = opts.deps;
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
  // Tidy, Readability and both sanitize passes run in a worker with a deadline (process.js).
  const got = await processInWorker(body, finalUrl, { deadlineMs: opts.deadlineMs });
  if (!got.original) throw badRequest(`Could not read the page: ${got.error || 'unknown error'}`, 422);
  const files = {};
  if (got.reader) files['reader.html'] = got.reader.reader;
  files['original.html'] = got.original.original;
  const text = got.reader ? got.reader.text : got.original.originalText;
  files['text.txt'] = (text || '').trim() + '\n';
  const words = meta.countWords(text || '');
  const m = (got.reader && got.reader.metadata) || got.original.metadata;
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
    hasReader: !!got.reader,
    hasOriginal: true,
    assets: { state: 'pending', count: 0, bytes: 0, dropped: [] },
  };
  return { record, files, leadImageUrl: m.leadImage, base: finalUrl };
}

// A bounded capture queue (gate r2 adversary A7 / qa S8 / security S4): a capture holds a slot from
// the worker's processing through the image localization, so at most MAX_ACTIVE run at once and at
// most MAX_WAITING wait; any more is refused at once (503 with a message the Shortcut shows) instead
// of stacking workers - eight parallel 8.3 MB saves measured 4.45 GB and a 23 s event-loop stall.
const CAPTURE_MAX_ACTIVE = 2;
const CAPTURE_MAX_WAITING = 4;

function createLimiter(maxActive, maxWaiting) {
  let active = 0;
  const waiting = [];
  const release = () => {
    active -= 1;
    const next = waiting.shift();
    if (next) { active += 1; next(); }
  };
  return {
    // Resolves a release function. `wait: false` (a save) refuses when the queue is full;
    // `wait: true` (a restart's resume) always waits its turn.
    acquire({ wait = false } = {}) {
      if (active < maxActive) { active += 1; return Promise.resolve(release); }
      if (!wait && waiting.length >= maxWaiting) {
        return Promise.reject(Object.assign(new Error('FileTube is busy saving other pages. Try again in a minute.'), { status: 503 }));
      }
      return new Promise((resolve) => waiting.push(() => resolve(release)));
    },
    stats() { return { active, waiting: waiting.length }; },
  };
}

function createCapture({ service, deps = {}, log = console.log, now = () => Date.now(), maxActive = CAPTURE_MAX_ACTIVE, maxWaiting = CAPTURE_MAX_WAITING } = {}) {
  const inFlight = new Map(); // item id -> promise: one localization per item at a time
  const limiter = createLimiter(maxActive, maxWaiting);

  // Localize one saved item's assets and rewrite its files. Reads what is STORED
  // (never the capture's memory), so a restart resumes it from the files; the
  // write re-checks inside the queue that the item is still pending.
  // `slot`: a release the caller already holds (a save hands its slot over), else one is taken here.
  function localizeItem(userId, id, leadUrl = null, slot = null) {
    if (inFlight.has(id)) { if (slot) slot(); return inFlight.get(id); }
    let release = slot;
    const run = (async () => {
      if (!release) release = await limiter.acquire({ wait: true });
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
    })().finally(() => { inFlight.delete(id); if (release) release(); });
    inFlight.set(id, run);
    return run;
  }

  // Save a URL. Resolves { item, duplicate, localized: Promise<item> }.
  async function saveUrl(userId, input) {
    const pageUrl = meta.cleanUrl(input.url);
    if (!pageUrl) throw badRequest('url must be an http(s) link');
    const early = service.index.findByUrl(userId, pageUrl);
    if (early) return { item: early, duplicate: true, localized: Promise.resolve(early) };
    const release = await limiter.acquire(); // 503 when the queue is full
    let handedOver = false;
    try {
      const built = await buildFromUrl(input, { deps: deps.fetch });
      const saved = await service.saveItem(userId, { record: built.record, files: built.files });
      if (saved.duplicate) return { item: saved.item, duplicate: true, localized: Promise.resolve(saved.item) };
      handedOver = true; // the localization releases the slot when the images are stored
      return { item: saved.item, duplicate: false, localized: localizeItem(userId, saved.item.id, built.leadImageUrl, release) };
    } finally {
      if (!handedOver) release();
    }
  }

  // Boot: finish every item a restart interrupted (one at a time, in the background).
  async function resumePending() {
    let n = 0;
    for (const p of service.index.pendingItems()) {
      try { await localizeItem(p.userId, p.id, null); n += 1; } catch (err) { log(`[pages] resume ${p.id}: ${err && err.message}`); }
    }
    return n;
  }

  return { saveUrl, localizeItem, resumePending, inFlight, limiter };
}

module.exports = { createCapture, buildFromUrl, createLimiter, CAPTURE_MAX_ACTIVE, CAPTURE_MAX_WAITING };
