#!/usr/bin/env node
'use strict';

// Wave 7b of the relational-migration arc (the monolith split): the ROUTING
// INVARIANT, as a signature per route -
//   "<methods> <path> | <every non-route layer registered BEFORE it, in order>"
// where a non-route layer is an `app.use` middleware or a wildcard route
// (`*`) that can intercept the request. Moving a route group out of server.js
// into a module's `registerRoutes(app, deps)` must leave every route with
// exactly the same layers ahead of it (the auth gate, the shell wildcard, the
// static server, the body-parser error handler) and keep the group's own
// relative order. Run it at the base commit and at the slice; the SORTED
// outputs must be identical, and the moved group's lines must appear in the
// same relative order in both.
//
//   node scripts/route-order-signature.js > before.txt
//   ...move the group...
//   node scripts/route-order-signature.js > after.txt
//   diff <(sort before.txt) <(sort after.txt)     # must be empty
//
// Boots server.js against a throwaway DATA_DIR (the require opens the
// database); only lines starting with "sig " are the signature - server.js
// logs its boot lines on stdout too, so filter on the prefix.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-route-order-'));
process.env.DATA_DIR = dataDir;
const { app } = require(path.join(__dirname, '..', 'server.js'));

const prefix = [];
const sigs = [];
for (const layer of app._router.stack) {
  if (layer.route) {
    const methods = Object.keys(layer.route.methods).sort().join(',');
    const isWildcard = layer.route.path === '*' || layer.route.path === '/*';
    sigs.push(`sig ${methods} ${layer.route.path} | ${prefix.join(',')}`);
    if (isWildcard) prefix.push(`route:${methods}:${layer.route.path}`);
  } else {
    const scoped = layer.regexp && layer.regexp.source !== '^\\/?(?=\\/|$)' ? `[${layer.regexp.source.slice(0, 40)}]` : '';
    prefix.push(layer.name + scoped);
  }
}
process.stdout.write(`${sigs.join('\n')}\n`);
setTimeout(() => {
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (_) { /* best effort */ }
  process.exit(0);
}, 50);
