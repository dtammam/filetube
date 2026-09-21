'use strict';

// lib/diag/routes.js - the HTTP surface of the perf-diagnostics suite. The
// routes are registered UNCONDITIONALLY (route registration is one-time at
// boot) but every one is gated per-request by the shared gate: requireAdmin
// FIRST (a non-admin always 403s), then isDiagEnabled() (an admin 404s while the
// perfDiagnosticsEnabled setting - or FT_DIAG - is off, and reaches it when on).
// The global authGate still fronts everything, so an unauthenticated caller is
// 401'd before any of this. Three groups:
//
//   GET  /diag                     - the standalone control page (its own shell,
//                                    NOT a templated app shell)
//   Active probes (isolate ONE variable each, all Cache-Control: no-store):
//   GET  /api/diag/ping            - tiny body -> client measures raw RTT
//   GET  /api/diag/blob?bytes=N    - incompressible random bytes -> throughput
//   GET  /api/diag/payload?enc=..  - a representative JSON body, optionally
//                                    gzip/brotli'd -> the compression delta
//   Run store (the labeled captures the client POSTs once at stop):
//   POST /api/diag/runs            GET /api/diag/runs
//   GET  /api/diag/runs/:id        DELETE /api/diag/runs/:id
//
// The probes are deliberately small in scope: they answer "what is the pipe's
// RTT / throughput ceiling, and what would compression buy" independent of the
// app's own code paths, so a slow real endpoint can be attributed to the pipe
// vs the box vs the payload rather than guessed at.

const express = require('express');
const zlib = require('zlib');
const crypto = require('crypto');

const MAX_BLOB_BYTES = 30 * 1024 * 1024; // cap the throughput probe so it can't be turned into a bandwidth sink

// A deterministic, representative "feed-ish" JSON payload for the compression
// probe. Shaped like a real list response (repetitive keys, mixed text) so the
// gzip/brotli ratio reflects what real /api/* traffic would see.
let SAMPLE_PAYLOAD_CACHE = null;
function samplePayload() {
  if (SAMPLE_PAYLOAD_CACHE) return SAMPLE_PAYLOAD_CACHE;
  const items = [];
  for (let i = 0; i < 400; i++) {
    items.push({
      id: `vid_${i.toString(36)}_${(i * 2654435761 % 1e9).toString(36)}`,
      title: `Sample item number ${i} - a representative video or track title of the kind the feed returns`,
      channel: `Channel ${i % 37}`,
      channelId: `chan_${i % 37}`,
      duration: 60 + (i * 17) % 5400,
      views: (i * 31337) % 1000000,
      publishedAt: 1700000000000 + i * 86400000,
      thumbnail: `/thumbnail/vid_${i.toString(36)}`,
      description: 'A moderately long description field that carries the sort of natural-language text real feed rows include, repeated enough to be representative of typical payload compressibility.',
      tags: ['sample', 'diagnostic', `bucket-${i % 12}`, 'representative'],
      progress: (i % 7) / 7,
    });
  }
  SAMPLE_PAYLOAD_CACHE = Buffer.from(JSON.stringify({ items, generatedFor: 'compression-probe' }));
  return SAMPLE_PAYLOAD_CACHE;
}

function registerDiagRoutes(app, deps) {
  const { publicDir, path, requireAdmin, runStore, isDiagEnabled } = deps;

  // Shared gate: admin FIRST (so a non-admin always gets 403, exactly like every
  // other admin route - the RBAC enforcement census expects that), THEN the
  // feature check (so an admin sees 404 while the experimental toggle is off,
  // keeping the feature hidden, and reaches it once it is on).
  const admin = requireAdmin || ((req, res, next) => next());
  const enabledCheck = (req, res, next) => {
    if (isDiagEnabled && !isDiagEnabled()) return res.status(404).end();
    next();
  };
  const gate = [admin, enabledCheck];
  const jsonBig = express.json({ limit: '10mb' });

  // --- control page ---------------------------------------------------------
  app.get('/diag', gate, (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(publicDir, 'diag.html'));
  });

  // --- active probes --------------------------------------------------------
  app.get('/api/diag/ping', gate, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ now: Date.now() });
  });

  app.get('/api/diag/blob', gate, (req, res) => {
    let bytes = parseInt(req.query.bytes, 10);
    if (!Number.isFinite(bytes) || bytes <= 0) bytes = 1024 * 1024;
    bytes = Math.min(bytes, MAX_BLOB_BYTES);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', String(bytes));
    // Stream in chunks of random (incompressible) data so a proxy's gzip can't
    // shrink it and distort the throughput reading, and so we never hold 30MB.
    const CHUNK = 256 * 1024;
    let sent = 0;
    function pump() {
      while (sent < bytes) {
        const n = Math.min(CHUNK, bytes - sent);
        const buf = crypto.randomBytes(n);
        sent += n;
        if (!res.write(buf)) {
          res.once('drain', pump);
          return;
        }
      }
      res.end();
    }
    pump();
  });

  app.get('/api/diag/payload', gate, (req, res) => {
    const enc = String(req.query.enc || 'none');
    const body = samplePayload();
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('X-Uncompressed-Bytes', String(body.length)); // let the client report the ratio without decoding math
    if (enc === 'gz') {
      const out = zlib.gzipSync(body, { level: 6 });
      res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Content-Length', String(out.length));
      res.setHeader('X-Wire-Bytes', String(out.length)); // authoritative on-wire size (iOS Safari zeroes Resource Timing sizes)
      return res.end(out);
    }
    if (enc === 'br') {
      const out = zlib.brotliCompressSync(body, {
        params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 },
      });
      res.setHeader('Content-Encoding', 'br');
      res.setHeader('Content-Length', String(out.length));
      res.setHeader('X-Wire-Bytes', String(out.length));
      return res.end(out);
    }
    res.setHeader('Content-Length', String(body.length));
    res.setHeader('X-Wire-Bytes', String(body.length));
    res.end(body);
  });

  // --- run store ------------------------------------------------------------
  app.post('/api/diag/runs', gate, jsonBig, (req, res) => {
    try {
      const rec = runStore.save(req.body || {});
      res.json({ ok: true, id: rec.id, createdAt: rec.createdAt });
    } catch (e) {
      const code = e && e.code === 'RUN_TOO_LARGE' ? 413 : 400;
      res.status(code).json({ ok: false, error: String(e && e.message || e) });
    }
  });

  app.get('/api/diag/runs', gate, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ runs: runStore.list() });
  });

  app.get('/api/diag/runs/:id', gate, (req, res) => {
    const rec = runStore.get(req.params.id);
    if (!rec) return res.status(404).json({ ok: false, error: 'not found' });
    res.setHeader('Cache-Control', 'no-store');
    res.json(rec);
  });

  app.delete('/api/diag/runs/:id', gate, (req, res) => {
    const ok = runStore.remove(req.params.id);
    res.status(ok ? 200 : 404).json({ ok });
  });
}

module.exports = { registerDiagRoutes, MAX_BLOB_BYTES };
