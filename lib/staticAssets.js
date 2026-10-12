'use strict';

// v1.386.0 speed pass (docs/exec-plans/completed/2026-10-11-speed-pass.md, W2): the app's static files with
// content-versioned URLs, a long cache, and compression.
//
// Before: every file under public/ was served `Cache-Control: no-cache`, so a phone revalidated every file a page
// uses (49 on a warm /music open, one round trip each, painful over the VPN) and downloaded them uncompressed
// (~4.5 MB on a first /music open). Now:
//
//   - The HTML shells stay `no-cache` (revalidated on every load), and at serve time each same-origin <script src>
//     and <link rel=stylesheet|preload|modulepreload href> under a static folder gets `?v=<hash>`, where <hash> is
//     the sha256 of the exact bytes this module serves for that file. Stylesheets get the same stamp on their own
//     url() references (fonts, icons, the skin photos), so their bytes, and therefore their hash, change whenever
//     a file they point at changes.
//   - A request whose `v` EQUALS the hash of the bytes being sent is answered `private, max-age=31536000,
//     immutable`: the browser never asks again. Anything else (no `v`, an old or made-up `v`, a file that changed
//     since the shell was sent) is answered `no-cache` exactly as before, so a versioned URL can never be cached
//     with bytes other than the ones its hash names.
//   - A new release changes a file's bytes, so its hash, so the URL the (always revalidated) shell names: a phone
//     or home-screen app can never keep running old JS/CSS after a release. tools/speed-proof/cache-bust-proof.js
//     proves it in Chromium and WebKit.
//   - Text files (js, css, svg, json, ...) over 1 KB go out brotli- or gzip-compressed when the browser accepts it
//     (compressed once per file version, off the event loop, and kept in memory).
//
// Files this module does not take (anything outside the static folders, a Range request, a file over MAX_BYTES)
// fall through to express.static with the old `no-cache` header. URLs built in JS at runtime (a script the SPA
// router loads on an in-app navigation, an icon mask set from code) carry no `v` and keep the old
// revalidate-every-time behaviour.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const mime = require('mime-types');

const STATIC_DIRS = ['js', 'css', 'fonts', 'assets', 'icons', 'vendor', 'critters'];
const STATIC_PATH = new RegExp('^/(?:' + STATIC_DIRS.join('|') + ')/[^?#]+$');
const MAX_BYTES = 6 * 1024 * 1024;
const COMPRESSIBLE = new Set(['.js', '.css', '.svg', '.json', '.map', '.txt', '.html', '.xml', '.webmanifest']);
const MIN_COMPRESS_BYTES = 1024;
const IMMUTABLE = 'private, max-age=31536000, immutable';
const REVALIDATE = 'no-cache';

// url(...) in a stylesheet: an optional quote, the target, the same quote.
const CSS_URL = /url\(\s*(['"]?)([^'")\s]+)\1\s*\)/g;
// The tags a shell's assets ride on.
const TAG = /<(script|link)\b[^>]*>/gi;
const VERSIONED_REL = /\brel\s*=\s*"(?:stylesheet|preload|modulepreload)"/i;

function hashOf(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 16);
}

// The encoding to send for an Accept-Encoding header: 'br', 'gzip' or null. A coding listed with q=0 is refused.
function pickEncoding(header) {
  if (typeof header !== 'string' || !header) return null;
  const ok = new Set();
  for (const part of header.split(',')) {
    const [name, ...params] = part.trim().toLowerCase().split(';');
    const q = params.map((x) => x.trim()).find((x) => x.startsWith('q='));
    if (q && !(Number(q.slice(2)) > 0)) continue;
    ok.add(name.trim());
  }
  if (ok.has('br')) return 'br';
  if (ok.has('gzip')) return 'gzip';
  return null;
}

function createStaticAssets({ publicDir }) {
  const root = path.resolve(publicDir);
  const entries = new Map(); // absolute path -> { mtimeMs, size, deps, depSig, bytes, hash, enc }

  // A URL path ('/css/style.css') -> the absolute file it names, or null when it is not a static-folder path or
  // would leave the public folder.
  function absFor(urlPath) {
    if (typeof urlPath !== 'string' || !STATIC_PATH.test(urlPath) || urlPath.includes('\0')) return null;
    // '.', '..' and any dot-segment (a dotfile or dot-directory): express.static's default refuses dotfiles, so this
    // module never serves one either (it falls through to express.static, which 404s it)
    if (urlPath.split('/').some((seg) => seg.startsWith('.'))) return null;
    const abs = path.join(root, urlPath);
    return abs.startsWith(root + path.sep) ? abs : null;
  }
  function statFile(abs) {
    try { const st = fs.statSync(abs); return st.isFile() ? st : null; } catch (_) { return null; }
  }

  // A stylesheet's url() targets -> `?v=<hash>` (same relative spelling, same quotes). Only plain same-origin
  // paths to a static file that exists are stamped; data:, absolute, fragment and already-queried URLs are left
  // alone. A stylesheet's targets are never stylesheets themselves, so this cannot recurse.
  function rewriteCss(text, cssUrlPath) {
    const deps = [];
    const out = text.replace(CSS_URL, (whole, q, target) => {
      if (/^(?:data:|[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(target) || /[?#]/.test(target)) return whole;
      let resolved;
      try { resolved = new URL(target, 'http://x' + cssUrlPath).pathname; } catch (_) { return whole; }
      const abs = absFor(resolved);
      if (!abs || path.extname(abs) === '.css') return whole;
      const dep = load(abs);
      if (!dep) return whole;
      deps.push(abs);
      return 'url(' + q + target + '?v=' + dep.hash + q + ')';
    });
    return { text: out, deps };
  }

  function depSigOf(deps) {
    return deps.map((d) => { const st = statFile(d); return st ? st.mtimeMs + ':' + st.size : 'x'; }).join('|');
  }

  // The bytes this module serves for a file and their hash, re-read whenever the file (or, for a stylesheet, a
  // file it points at) changes size or mtime. null for a missing, non-file or oversized path.
  function load(abs) {
    const st = statFile(abs);
    if (!st || st.size > MAX_BYTES) return null;
    const cur = entries.get(abs);
    if (cur && cur.mtimeMs === st.mtimeMs && cur.size === st.size && (!cur.deps.length || cur.depSig === depSigOf(cur.deps))) return cur;
    let bytes;
    try { bytes = fs.readFileSync(abs); } catch (_) { return null; }
    let deps = [];
    if (path.extname(abs) === '.css') {
      const urlPath = '/' + path.relative(root, abs).split(path.sep).join('/');
      const r = rewriteCss(bytes.toString('utf8'), urlPath);
      bytes = Buffer.from(r.text, 'utf8');
      deps = r.deps;
    }
    const entry = { mtimeMs: st.mtimeMs, size: st.size, deps, depSig: depSigOf(deps), bytes, hash: hashOf(bytes), enc: {} };
    entries.set(abs, entry);
    return entry;
  }

  // The version stamp for a URL path, or null when the path is not one this module serves.
  function versionOf(urlPath) {
    const abs = absFor(urlPath);
    const e = abs ? load(abs) : null;
    return e ? e.hash : null;
  }

  // A shell's <script src> and <link rel=stylesheet|preload|modulepreload href> -> `?v=<hash>`. Everything else in
  // the document is byte-identical.
  function rewriteHtml(html) {
    return String(html).replace(TAG, (tag, name) => {
      const attr = name.toLowerCase() === 'script' ? 'src' : 'href';
      if (attr === 'href' && !VERSIONED_REL.test(tag)) return tag;
      const re = new RegExp('(\\b' + attr + '\\s*=\\s*")([^"]*)(")', 'i');
      return tag.replace(re, (whole, a, value, b) => {
        const v = versionOf(value);
        return v ? a + value + '?v=' + v + b : whole;
      });
    });
  }

  function compressed(entry, encoding) {
    if (!entry.enc[encoding]) {
      entry.enc[encoding] = new Promise((resolve) => {
        const done = (err, buf) => resolve(err ? null : buf);
        if (encoding === 'br') {
          zlib.brotliCompress(entry.bytes, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: entry.bytes.length } }, done);
        } else {
          zlib.gzip(entry.bytes, { level: 9 }, done);
        }
      });
    }
    return entry.enc[encoding];
  }

  function middleware(req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.headers.range) return next(); // a byte range: express.static answers it, as before
    let p;
    try { p = decodeURIComponent(req.path); } catch (_) { return next(); }
    const abs = absFor(p);
    const entry = abs ? load(abs) : null;
    if (!entry) return next();
    const ext = path.extname(abs).toLowerCase();
    const v = req.query && req.query.v;
    const cacheControl = (typeof v === 'string' && v === entry.hash) ? IMMUTABLE : REVALIDATE;
    const compressible = COMPRESSIBLE.has(ext) && entry.bytes.length >= MIN_COMPRESS_BYTES;
    const encoding = compressible ? pickEncoding(req.headers['accept-encoding']) : null;
    const send = (body, enc) => {
      const etag = '"' + entry.hash + (enc ? '-' + enc : '') + '"';
      res.setHeader('Cache-Control', cacheControl);
      res.setHeader('ETag', etag);
      if (compressible) res.setHeader('Vary', 'Accept-Encoding');
      const inm = req.headers['if-none-match'];
      if (typeof inm === 'string' && inm.split(',').some((t) => t.trim().replace(/^W\//, '') === etag)) {
        res.statusCode = 304;
        return res.end();
      }
      res.setHeader('Content-Type', mime.contentType(ext) || 'application/octet-stream');
      if (enc) res.setHeader('Content-Encoding', enc);
      res.setHeader('Content-Length', body.length);
      if (req.method === 'HEAD') return res.end();
      return res.end(body);
    };
    if (!encoding) return send(entry.bytes, null);
    compressed(entry, encoding).then((buf) => (buf ? send(buf, encoding) : send(entry.bytes, null)), () => send(entry.bytes, null));
  }

  return { middleware, rewriteHtml, versionOf, rewriteCss: (text, urlPath) => rewriteCss(text, urlPath).text, __entries: entries };
}

module.exports = { createStaticAssets, pickEncoding, STATIC_DIRS, IMMUTABLE, REVALIDATE };
