'use strict';

// Wave 7b of the relational-migration arc (the monolith split): a source lock
// that reads server.js's TEXT has to keep reading the code it was written for
// after that code moves into a route module. A moved sentence is not a deleted
// sentence, so the locks are RE-POINTED at the surface rather than relaxed:
// server.js PLUS every `registerRoutes(app, deps)` module it registers.
//
// The list is DERIVED from server.js's own requires - every
// `require('./lib/<...>routes')` - so each later slice of the split joins the
// surface the moment server.js requires its module. A hand-maintained sibling
// list is exactly what the v1.259 registry lesson says goes stale (a registry
// add that misses one hand-kept list is INERT), and an inert lock is worse
// than none: it stays green over the code it no longer reads.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');

// The route modules server.js registers, as repo-relative paths, sorted.
function routeModulePaths(root = ROOT) {
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const out = [];
  const re = /require\('\.\/(lib\/[A-Za-z0-9_\-/]*routes)'\)/g;
  let m = re.exec(server);
  while (m) {
    out.push(`${m[1]}.js`);
    m = re.exec(server);
  }
  return [...new Set(out)].sort();
}

// Every file of the surface (server.js first), as absolute paths.
function routeSurfaceFiles(root = ROOT) {
  return [path.join(root, 'server.js'), ...routeModulePaths(root).map((p) => path.join(root, p))];
}

// The surface as ONE string. `read` receives an absolute path and returns the
// text to include, so a caller can run its own comment-stripper per file (the
// v1.50/v1.77/v1.133 comment-porous lesson: strip ONCE at read).
function routeSurfaceSource(read = (p) => fs.readFileSync(p, 'utf8'), root = ROOT) {
  return routeSurfaceFiles(root).map((p) => read(p)).join('\n');
}

module.exports = { routeModulePaths, routeSurfaceFiles, routeSurfaceSource };
