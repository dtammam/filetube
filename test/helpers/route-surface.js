'use strict';

// Wave 7b of the relational-migration arc (the monolith split): a source lock
// that reads server.js's TEXT has to keep reading the code it was written for
// after that code moves into a module of its own. A moved sentence is not a
// deleted sentence, so the locks are RE-POINTED at the surface rather than
// relaxed: server.js PLUS every module the split carved out of it (the
// `registerRoutes(app, deps)` routers and, from slice S2, the extracted
// helpers those routers and the scan share).
//
// The list is DERIVED from server.js's own requires - every `./lib/...` module
// it requires whose header carries the SPLIT_MARKER sentence - so each later
// slice of the split joins the surface the moment server.js requires its
// module. A hand-maintained sibling list is exactly what the v1.259 registry
// lesson says goes stale (a registry add that misses one hand-kept list is
// INERT), and an inert lock is worse than none: it stays green over the code
// it no longer reads.
//
// Wave 7b slice S2 widened the derivation: it matched the require PATH
// (`.../<something>routes`) until lib/books/scanRunner.js became the first
// extracted module whose name is not a router, and matching on the path alone
// would have silently dropped the book scan's merge out of every lock that
// counts it. The later slices are mostly non-router extractions (the trash and
// move helpers, the relocation planner, the transcode queues, the scan
// orchestrator), so the marker - which says WHERE the code came from - is the
// honest membership test, not the filename.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');

// The sentence every module extracted from server.js by the Wave 7b split
// carries in its header comment. Membership in the surface is opt-in and
// self-describing; a module that does not say it came out of server.js is a
// library, not a piece of the monolith that moved. Matched over the header
// with its `//` prefixes dropped and its whitespace collapsed, because the
// sentence wraps across comment lines at a different word in every module.
const SPLIT_MARKER = /moved verbatim out of server\.js/i;

// A `require('./lib/x')` may name a file or a directory with an index.js.
function resolveLibModule(root, rel) {
  for (const candidate of [`${rel}.js`, `${rel}/index.js`]) {
    if (fs.existsSync(path.join(root, candidate))) return candidate;
  }
  return null;
}

// A module's source as ONE space-separated line, `//` prefixes removed - the
// form SPLIT_MARKER is tested against.
function flattenComments(src) {
  return src.replace(/^[ \t]*\/\/[ \t]?/gm, '').replace(/\s+/g, ' ');
}

// The modules server.js was split into, as repo-relative paths, sorted.
function routeModulePaths(root = ROOT) {
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const out = [];
  // Either quote spelling (gate: a double-quoted require silently dropped its module
  // from the surface - loud for an exact count, silent for a floor or a negative).
  const re = /require\((['"])\.\/(lib\/[A-Za-z0-9_\-/]*)\1\)/g;
  let m = re.exec(server);
  while (m) {
    const rel = resolveLibModule(root, m[2]);
    if (rel && SPLIT_MARKER.test(flattenComments(fs.readFileSync(path.join(root, rel), 'utf8')))) out.push(rel);
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

module.exports = {
  SPLIT_MARKER, routeModulePaths, routeSurfaceFiles, routeSurfaceSource,
};
