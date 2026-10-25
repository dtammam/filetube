'use strict';

// lib/pages/routes.js - the Pages HTTP surface (plan D-API, D-RENDER, D-AUTH):
//
//   POST   /api/pages                      save ({ url } | { url, html } | { text })
//   GET    /api/pages?view&list&q&cursor   the library: all / unread / trash / a list / full-text search
//   GET    /api/pages/lists                POST /api/pages/lists
//   PATCH  /api/pages/lists/:id            DELETE /api/pages/lists/:id (never an item)
//   GET    /api/pages/lists/:id/items      PUT /api/pages/lists/:id/items (membership + order, compare-and-set)
//   GET    /api/pages/lists/:id/share      the Share with AI text of a whole list
//   POST   /api/pages/rebuild              admin: the index from the files
//   GET    /api/pages/:id                  metadata + note + Reader HTML
//   GET    /api/pages/:id/share            the Share with AI text
//   PATCH  /api/pages/:id                  note / read / position
//   DELETE /api/pages/:id                  to the trash;  POST /api/pages/:id/restore
//   GET    /api/pages/:id/original         GET /api/pages/:id/assets/:name
//
// Every route is user-scoped: it needs req.user (a cookie session, a paired
// phone's device token, or - for POST /api/pages ONLY - a `shortcut` token; the
// gate enforces the token scopes) and reads and writes only that user's items.
// A missing item and another user's item are the same neutral 404. The shared
// FILETUBE_API_TOKEN sets no req.user, so it can never reach Pages. Static path
// segments register before /:id for every method (LESSONS 11); ids are 12-hex.
//
// Rendering untrusted pages (D-RENDER), defense in depth:
//  - the Reader (GET /api/pages/:id) is allowlist-sanitized HTML the app inserts
//    into its own DOM; its images load from GET /api/pages/:id/assets/:name;
//  - the Original (GET /api/pages/:id/original) is the sanitized page served
//    with a CSP that allows no script, no remote load, no form and no framing
//    by others, plus the CSP `sandbox` directive (an opaque origin even when it
//    is opened directly), and the app frames it in <iframe sandbox> with no
//    allow-scripts and no allow-same-origin. Its own stored images and fonts are
//    INLINED as data: URIs in this response: measured (tools/pages/
//    sandbox-cookie-probe.js, v1.395.0) Chromium and Firefox send no SameSite=Lax
//    cookie for a sandboxed frame's image requests, so an assets URL would 401
//    there.

const fs = require('fs');
const crypto = require('crypto');
const { pipeline } = require('stream');
const paths = require('./paths');
const meta = require('./meta');
const share = require('./share');
const { CONTENT_TYPES } = require('./assets');
const { sanitize, readerFragment } = require('./sanitize');
const { LIST_NAME_MAX, LISTS_PER_USER_MAX, ITEMS_PER_LIST_MAX } = require('./indexStore');

const ORIGINAL_CSP = "default-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'; sandbox allow-popups allow-popups-to-escape-sandbox";
const ASSET_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
const MAX_INLINE_BYTES = 60 * 1024 * 1024;
// A save answers once its images are stored, or after this long with the item
// marked "saving images" (they finish in the background).
const LOCALIZE_WAIT_MS = 8000;
const SAVE_BODY_LIMIT = '16mb';
const PAGE_SIZE = 50;

function hardenHeaders(res, csp) {
  res.setHeader('Content-Security-Policy', csp);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
}

function contentTypeOf(name) {
  const ext = name.slice(name.lastIndexOf('.') + 1);
  return CONTENT_TYPES[ext] || null;
}

// The stored Original with each `assets/<name>` reference (the two spellings our
// own serializer writes: src="..." and url("...")) replaced by a data: URI read
// from the item's own assets folder. A reference to a missing file is left as is.
function inlineAssets(html, assetFile) {
  let budget = MAX_INLINE_BYTES;
  const cache = new Map();
  const dataUri = (name) => {
    if (cache.has(name)) return cache.get(name);
    let out = null;
    const type = contentTypeOf(name);
    const p = type ? assetFile(name) : null;
    if (p) {
      try {
        const buf = fs.readFileSync(p);
        if (buf.length <= budget) { budget -= buf.length; out = `data:${type};base64,${buf.toString('base64')}`; }
      } catch { out = null; }
    }
    cache.set(name, out);
    return out;
  };
  return html
    .replace(/src="assets\/([0-9a-f]{24}\.[a-z0-9]{1,5})"/g, (m, name) => { const d = dataUri(name); return d ? `src="${d}"` : m; })
    .replace(/url\("assets\/([0-9a-f]{24}\.[a-z0-9]{1,5})"\)/g, (m, name) => { const d = dataUri(name); return d ? `url("${d}")` : m; });
}

// The card / item projection the client reads. Never a path, never another user's row.
function publicItem(item) {
  const lead = item.leadImage ? `/api/pages/${item.id}/assets/${item.leadImage.slice('assets/'.length)}` : null;
  return {
    id: item.id,
    kind: item.kind,
    title: item.title,
    site: item.site,
    author: item.author,
    url: item.url,
    publishedAt: item.publishedAt,
    savedAt: item.savedAt,
    wordCount: item.wordCount,
    readingMinutes: meta.readingMinutes(item.wordCount),
    leadImage: lead,
    description: item.description,
    hasReader: item.hasReader,
    hasOriginal: item.hasOriginal,
    saving: item.assetsState === 'pending',
    read: !!item.readAt,
    readAt: item.readAt,
    position: item.position,
    trashedAt: item.trashedAt,
  };
}

// The Reader's stored `assets/<name>` references, as the app (whose page URL is
// /pages/<id>) must load them.
function readerForApp(html, id) {
  return String(html).replace(/src="assets\/([0-9a-f]{24}\.[a-z0-9]{1,5})"/g, (_m, name) => `src="/api/pages/${id}/assets/${name}"`);
}

// A list's membership version: compare-and-set for PUT .../items, so a stale
// client's replace can never drop an item another device added (LESSONS 9).
function listVersion(ids) {
  return crypto.createHash('sha256').update(ids.join(',')).digest('hex').slice(0, 16);
}

function cleanListName(v) {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, ' ').trim();
  if (t === '' || t.length > LIST_NAME_MAX || /[\u0000-\u001f\u007f]/.test(t)) return null; // eslint-disable-line no-control-regex
  return t;
}

function registerPagesRoutes(app, deps) {
  const { pages, express, formatBodyParserError, getAiPrompts, requireAdmin, log = console.log } = deps;
  const { service, capture } = pages;
  const index = service.index;

  function userOf(req, res) {
    if (!req.user || !paths.isUserId(req.user.id)) {
      res.status(401).json({ error: 'authentication required', authRequired: true });
      return null;
    }
    return req.user.id;
  }

  function itemOr404(req, res) {
    const uid = userOf(req, res);
    if (uid === null) return null;
    const id = req.params.id;
    const item = paths.isItemId(id) ? service.getItem(uid, id) : null;
    if (!item) { res.status(404).json({ error: 'No such page.' }); return null; }
    return item;
  }

  function listOr404(req, res) {
    const uid = userOf(req, res);
    if (uid === null) return null;
    const id = req.params.id;
    const list = paths.isItemId(id) ? index.getList(uid, id) : null;
    if (!list) { res.status(404).json({ error: 'No such list.' }); return null; }
    return { uid, list };
  }

  function fail(res, err, what) {
    const status = err && Number.isInteger(err.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
    if (status >= 500) log(`[pages] ${what} failed: ${err && err.stack ? err.stack : err}`);
    if (!res.headersSent) res.status(status).json({ error: status >= 500 && !(err && err.status) ? `Could not ${what}.` : String(err.message || err) });
  }

  // The prompt a promptId names (the shared "Share with AI" list), or null.
  function promptText(req, res) {
    const pid = req.query.promptId;
    if (pid === undefined || pid === '') return '';
    const list = typeof getAiPrompts === 'function' ? getAiPrompts() : [];
    const p = Array.isArray(list) ? list.find((x) => x && x.id === pid) : null;
    if (!p) { res.status(400).json({ error: 'No such prompt.' }); return null; }
    return p.text;
  }

  // ---- save (D-API, D-AUTH: a `shortcut` token reaches this route and no other) ----
  // The global 100 kb JSON parser skips this route (server.js); this one parses
  // AFTER the auth gate, so the large-body allowance is for signed-in callers only.
  const saveParser = express.json({ limit: SAVE_BODY_LIMIT });
  app.post('/api/pages', saveParser, async (req, res) => {
    // A Shortcut shows the reply's `message` (D-AUTH, Error handling): every answer here
    // carries one, the error text on a failure.
    const json = res.json.bind(res);
    res.json = (body) => json(body && typeof body.error === 'string' && body.message === undefined ? { ...body, message: body.error } : body);
    const uid = userOf(req, res);
    if (uid === null) return;
    const b = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : null;
    if (!b) return res.status(400).json({ error: 'Send JSON: { url } or { url, html } or { text }.' });
    const str = (k) => (typeof b[k] === 'string' ? b[k] : null);
    for (const k of ['url', 'html', 'text', 'title', 'note', 'source']) {
      if (b[k] !== undefined && b[k] !== null && typeof b[k] !== 'string') return res.status(400).json({ error: `${k} must be a string` });
    }
    const viaSaveOnlyToken = req.authVia === 'device' && req.devicePlatform === 'shortcut';
    let source = str('source');
    if (!meta.SOURCES.has(source)) source = viaSaveOnlyToken ? 'shortcut' : 'api';
    const note = meta.cleanText(str('note') || '', meta.LIMITS.note, true);
    const text = str('text');
    const url = str('url');
    const html = str('html');
    try {
      let out;
      if (text !== null && text.trim() !== '') {
        if (html) return res.status(400).json({ error: 'Send either text or html, not both.' });
        out = await service.saveText(uid, { text, title: str('title'), url, note, source });
        out.localized = Promise.resolve(out.item);
      } else if (url) {
        out = await capture.saveUrl(uid, { url, html: html && html.trim() !== '' ? html : null, title: str('title'), note, source });
      } else {
        return res.status(400).json({ error: 'Nothing to save: send a url, or some text.' });
      }
      let item = out.item;
      if (!out.duplicate) {
        let timer;
        const waited = await Promise.race([
          out.localized.then((x) => x || item, () => item),
          new Promise((r) => { timer = setTimeout(() => r(null), LOCALIZE_WAIT_MS); if (timer.unref) timer.unref(); }),
        ]);
        clearTimeout(timer);
        out.localized.catch((err) => log(`[pages] images for ${item.id} failed: ${err && err.message}`));
        item = service.getItem(uid, item.id) || waited || item;
      }
      // P12: a URL already saved returns that item. One in the trash says so (it is not in All),
      // and is restored from Pages > Trash, never saved twice (gate r1 qa W3).
      const message = !out.duplicate ? 'Saved to Pages' : (item.trashedAt ? 'Already in Pages, in the trash: restore it from Pages > Trash' : 'Already in Pages');
      // A save-only token (Shortcut, extension) never reads an existing item back: it learns that it
      // is saved, nothing more (gate r1 security-brief S3).
      if (out.duplicate && viaSaveOnlyToken) return res.json({ duplicate: true, message });
      return res.json({ item: publicItem(item), duplicate: !!out.duplicate, message });
    } catch (err) {
      return fail(res, err, 'save the page');
    }
  }, (err, req, res, next) => {
    // Route-scoped body-parser errors (the global mapper can never see them:
    // Express walks its error stack forward only) - a clean JSON answer a
    // Shortcut can show.
    const mapped = typeof formatBodyParserError === 'function' ? formatBodyParserError(err) : null;
    if (mapped) return res.status(mapped.status).json(mapped.body);
    return next(err);
  });

  // ---- the library ----
  app.get('/api/pages', (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    const uid = userOf(req, res);
    if (uid === null) return;
    const view = ['all', 'unread', 'trash'].includes(req.query.view) ? req.query.view : 'all';
    let listId = null;
    if (typeof req.query.list === 'string' && req.query.list !== '') {
      if (!paths.isItemId(req.query.list) || !index.getList(uid, req.query.list)) return res.status(404).json({ error: 'No such list.' });
      listId = req.query.list;
    }
    const q = typeof req.query.q === 'string' && req.query.q.trim() !== '' ? req.query.q.slice(0, 500) : null;
    const offset = /^\d{1,7}$/.test(String(req.query.cursor || '')) ? Number(req.query.cursor) : 0;
    try {
      const r = index.listItems(uid, { view, listId, q, offset, limit: PAGE_SIZE });
      const next = r.offset + r.items.length < r.total ? String(r.offset + r.items.length) : null;
      return res.json({ items: r.items.map(publicItem), total: r.total, nextCursor: next });
    } catch (err) {
      return fail(res, err, 'list the pages');
    }
  });

  // ---- lists (static segments BEFORE /:id, per method - LESSONS 11) ----
  app.get('/api/pages/lists', (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    const uid = userOf(req, res);
    if (uid === null) return;
    return res.json({ lists: index.lists(uid) });
  });

  app.post('/api/pages/lists', (req, res) => {
    const uid = userOf(req, res);
    if (uid === null) return;
    const name = cleanListName(req.body && req.body.name);
    if (!name) return res.status(400).json({ error: `A list name is 1 to ${LIST_NAME_MAX} characters.` });
    if (index.countLists(uid) >= LISTS_PER_USER_MAX) return res.status(409).json({ error: `At most ${LISTS_PER_USER_MAX} lists.` });
    try {
      return res.status(201).json({ list: index.createList(uid, paths.newItemId(), name, new Date().toISOString()) });
    } catch (err) {
      return fail(res, err, 'create the list');
    }
  });

  // Admin: rebuild the index from the files (Settings > Scan & cache).
  app.post('/api/pages/rebuild', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const r = await service.rebuild();
      return res.json(r);
    } catch (err) {
      return fail(res, err, 'rebuild the Pages index');
    }
  });

  app.patch('/api/pages/lists/:id', (req, res) => {
    const got = listOr404(req, res);
    if (!got) return;
    const name = cleanListName(req.body && req.body.name);
    if (!name) return res.status(400).json({ error: `A list name is 1 to ${LIST_NAME_MAX} characters.` });
    index.renameList(got.uid, got.list.id, name);
    return res.json({ list: { ...got.list, name } });
  });

  app.delete('/api/pages/lists/:id', (req, res) => {
    const got = listOr404(req, res);
    if (!got) return;
    // A list is a named order of items; deleting it never touches an item.
    index.deleteList(got.uid, got.list.id);
    return res.json({ success: true });
  });

  app.get('/api/pages/lists/:id/items', (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    const got = listOr404(req, res);
    if (!got) return;
    const ids = index.listItemIds(got.uid, got.list.id);
    return res.json({ items: ids, version: listVersion(ids) });
  });

  app.put('/api/pages/lists/:id/items', (req, res) => {
    const got = listOr404(req, res);
    if (!got) return;
    const b = req.body || {};
    const ids = b.items;
    if (!Array.isArray(ids) || ids.length > ITEMS_PER_LIST_MAX) return res.status(400).json({ error: `items must be an array of at most ${ITEMS_PER_LIST_MAX} ids` });
    if (new Set(ids).size !== ids.length) return res.status(400).json({ error: 'items holds an id twice' });
    const current = index.listItemIds(got.uid, got.list.id);
    // An id already in the list may stay even when its page is gone from the index (a rebuild
    // that lost its files): the client sends back what it read, and refusing it would make the
    // list uneditable for good (gate r1 qa W2). A NEW id must be one of the caller's own pages.
    for (const id of ids) {
      if (!paths.isItemId(id) || (!current.includes(id) && !service.getItem(got.uid, id))) return res.status(400).json({ error: 'items names a page you do not have' });
    }
    if (typeof b.version !== 'string' || b.version !== listVersion(current)) {
      return res.status(409).json({ error: 'The list changed on another device. Try again.', items: current, version: listVersion(current) });
    }
    index.setListItems(got.uid, got.list.id, ids, new Date().toISOString());
    return res.json({ items: ids, version: listVersion(ids) });
  });

  app.get('/api/pages/lists/:id/share', (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    const got = listOr404(req, res);
    if (!got) return;
    const prompt = promptText(req, res);
    if (prompt === null) return;
    const docs = [];
    for (const id of index.listItemIds(got.uid, got.list.id)) {
      const item = service.getItem(got.uid, id);
      if (!item || item.trashedAt) continue;
      docs.push(share.itemDocument(item, service.readRecord(item), service.readFile(item, 'text.txt') || ''));
    }
    return res.json({ title: got.list.name, text: share.withPrompt(prompt, share.listDocument(docs)), count: docs.length });
  });

  // ---- one item ----
  app.get('/api/pages/:id', (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    const item = itemOr404(req, res);
    if (!item) return;
    let record = null;
    let reader = null;
    try {
      record = service.readRecord(item);
      reader = item.hasReader ? service.readFile(item, 'reader.html') : null;
    } catch (err) {
      return fail(res, err, 'read the page');
    }
    return res.json({
      item: {
        ...publicItem(item),
        note: record ? record.note : '',
        language: record ? record.language : null,
        canonicalUrl: item.canonicalUrl,
        source: record ? record.source : null,
        lists: index.listsOfItem(item.userId, item.id),
        dropped: record && record.assets ? record.assets.dropped : [],
      },
      // The stored Reader passed the allowlist at save time; it is sanitized AGAIN as it is served
      // (final mode: only this item's own assets), because the files may live on a share someone
      // else can write, and this HTML is inserted into the app's own page (gate r1 adversary A4).
      reader: reader === null ? null : readerForApp(readerFragment(sanitize(reader, { profile: 'reader', base: item.url || null, final: true }).tree), item.id),
    });
  });

  app.get('/api/pages/:id/share', (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    const item = itemOr404(req, res);
    if (!item) return;
    const prompt = promptText(req, res);
    if (prompt === null) return;
    const doc = share.itemDocument(item, service.readRecord(item), service.readFile(item, 'text.txt') || '');
    return res.json({ title: item.title, text: share.withPrompt(prompt, doc) });
  });

  app.patch('/api/pages/:id', async (req, res) => {
    const item = itemOr404(req, res);
    if (!item) return;
    const b = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    if (b.note !== undefined && typeof b.note !== 'string') return res.status(400).json({ error: 'note must be a string' });
    if (typeof b.note === 'string' && b.note.length > meta.LIMITS.note) return res.status(400).json({ error: `A note is at most ${meta.LIMITS.note} characters.` });
    if (b.read !== undefined && typeof b.read !== 'boolean') return res.status(400).json({ error: 'read must be true or false' });
    if (b.position !== undefined && b.position !== null && !(typeof b.position === 'number' && Number.isFinite(b.position) && b.position >= 0 && b.position <= 1)) return res.status(400).json({ error: 'position must be between 0 and 1' });
    try {
      if (typeof b.note === 'string') await service.setNote(item.userId, item.id, b.note);
      if (b.read !== undefined || b.position !== undefined) service.setReadState(item.userId, item.id, { read: b.read, position: b.position });
      const fresh = service.getItem(item.userId, item.id);
      const record = service.readRecord(fresh);
      return res.json({ item: { ...publicItem(fresh), note: record ? record.note : '' } });
    } catch (err) {
      return fail(res, err, 'update the page');
    }
  });

  // Delete = to the trash (P10): restorable for 30 days, never an unlink here.
  app.delete('/api/pages/:id', async (req, res) => {
    const item = itemOr404(req, res);
    if (!item) return;
    try {
      const t = await service.trash(item.userId, item.id);
      return res.json({ item: publicItem(t) });
    } catch (err) {
      return fail(res, err, 'move the page to the trash');
    }
  });

  app.post('/api/pages/:id/restore', async (req, res) => {
    const item = itemOr404(req, res);
    if (!item) return;
    try {
      const r = await service.restore(item.userId, item.id);
      return res.json({ item: publicItem(r) });
    } catch (err) {
      return fail(res, err, 'restore the page');
    }
  });

  // The Original view (D-RENDER).
  app.get('/api/pages/:id/original', (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    const item = itemOr404(req, res);
    if (!item) return;
    let html = null;
    try { html = item.hasOriginal ? service.readFile(item, 'original.html') : null; } catch { html = null; }
    if (html === null) return res.status(404).json({ error: 'This page has no Original view.' });
    hardenHeaders(res, ORIGINAL_CSP);
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.type('text/html; charset=utf-8');
    return res.send(inlineAssets(html, (name) => service.assetFile(item, name)));
  });

  // One stored image or font (the Reader's images, the lead image on a card).
  app.get('/api/pages/:id/assets/:name', (req, res) => {
    const item = itemOr404(req, res);
    if (!item) return;
    const name = req.params.name;
    const type = paths.isAssetName(name) ? contentTypeOf(name) : null;
    const file = type ? service.assetFile(item, name) : null;
    if (!file) return res.status(404).json({ error: 'No such file.' });
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) return res.status(404).json({ error: 'No such file.' });
      hardenHeaders(res, ASSET_CSP);
      res.setHeader('Content-Type', type);
      res.setHeader('Content-Length', String(st.size));
      res.setHeader('Content-Disposition', 'inline');
      // Content-hashed: the bytes behind a name never change.
      res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
      // pipeline, never .pipe(): a client abort must destroy the read stream (LESSONS 11).
      pipeline(fs.createReadStream(file), res, () => {});
      return undefined;
    });
  });
}

module.exports = { registerPagesRoutes, inlineAssets, publicItem, readerForApp, listVersion, ORIGINAL_CSP, ASSET_CSP, LOCALIZE_WAIT_MS, SAVE_BODY_LIMIT };
