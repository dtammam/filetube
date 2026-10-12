'use strict';

// v1.386.0 speed pass (W3): large JSON answers go out compressed. Measured on a 23,000-track library: a 1,000-song
// page was 524 KB on the wire (41 KB as brotli), the Pocket's Songs list ~12 MB in 5,000-row pages (~1.5 MB); over
// the VPN's ~20 Mbit/s that is seconds of transfer before a list can draw.
//
// The hook sits at res.end, AFTER Express has built the answer (its ETag, its 304 for a fresh If-None-Match, its
// Content-Length): only a GET's 200 with a JSON Content-Type, at least MIN_BYTES long and not already encoded, is
// replaced by its brotli (or gzip) form, compressed off the event loop. Everything else - media, byte ranges, the
// event stream, static files (lib/staticAssets.js encodes those itself), small answers - passes through untouched.
// The ETag stays Express's weak validator (the same JSON either way), and `Vary: Accept-Encoding` tells caches the
// form depends on the request.

const zlib = require('node:zlib');
const { pickEncoding } = require('./staticAssets');

const MIN_BYTES = 8 * 1024;

function compressJson(buf, encoding, done) {
  if (encoding === 'br') {
    zlib.brotliCompress(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length } }, done);
  } else {
    zlib.gzip(buf, { level: 6 }, done);
  }
}

function jsonCompression(req, res, next) {
  if (req.method !== 'GET') return next();
  const encoding = pickEncoding(req.headers['accept-encoding']);
  if (!encoding) return next();
  const end = res.end;
  res.end = function (chunk, enc, cb) {
    res.end = end; // one shot
    const type = String(res.getHeader('Content-Type') || '');
    // a body already partly written (res.write before end) is never compressed: its head and first bytes are out
    // res.locals.skipCompression: a route that measures the wire itself (the /diag payload probe's plain baseline)
    const ok = !(res.locals && res.locals.skipCompression) && !res.headersSent && res.statusCode === 200 && /^application\/json\b/i.test(type) && !res.getHeader('Content-Encoding') && chunk != null && typeof chunk !== 'function';
    const buf = ok ? (Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), typeof enc === 'string' ? enc : 'utf8')) : null;
    if (!buf || buf.length < MIN_BYTES) return end.call(res, chunk, enc, cb);
    compressJson(buf, encoding, (err, out) => {
      if (err || res.headersSent || res.destroyed) return end.call(res, buf, cb); // fall back to the plain body
      res.setHeader('Content-Encoding', encoding);
      const vary = String(res.getHeader('Vary') || '');
      if (!/\baccept-encoding\b/i.test(vary)) res.setHeader('Vary', vary ? vary + ', Accept-Encoding' : 'Accept-Encoding');
      res.setHeader('Content-Length', out.length);
      end.call(res, out, typeof cb === 'function' ? cb : undefined);
    });
    return res;
  };
  next();
}

module.exports = { jsonCompression, MIN_BYTES };
