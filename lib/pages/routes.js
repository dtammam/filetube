'use strict';

// lib/pages/routes.js - the Pages HTTP surface (plan D-API, D-RENDER, D-AUTH).
// Every route is user-scoped: it needs req.user (a cookie session, a paired
// phone's device token, or - for POST /api/pages ONLY - a `shortcut` token; the
// gate enforces the token scopes) and reads and writes only that user's items.
// A missing item and another user's item are the same neutral 404. The shared
// FILETUBE_API_TOKEN sets no req.user, so it can never reach Pages.
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
const { pipeline } = require('stream');
const paths = require('./paths');
const { CONTENT_TYPES } = require('./assets');

const ORIGINAL_CSP = "default-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'; sandbox allow-popups allow-popups-to-escape-sandbox";
const ASSET_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
const MAX_INLINE_BYTES = 60 * 1024 * 1024;

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

function registerPagesRoutes(app, deps) {
  const { pages } = deps;
  const { service } = pages;

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

module.exports = { registerPagesRoutes, inlineAssets, ORIGINAL_CSP, ASSET_CSP };
