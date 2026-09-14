'use strict';

// [UNIT] Wave 7b R1 gate (adversarial W3): test/helpers/route-surface.js is
// the spine of every source lock that used to read server.js alone - it
// derives "server.js PLUS every module the split moved code into" from the
// modules' header sentence. Nothing bound what it RETURNS: the gate reworded
// one module's header and the module left the surface with zero signal (a
// doc-model read planted in it would then ship green). This binds the
// derivation in BOTH directions: the derived set must equal the expected set
// (a new slice's module carries the sentence and reds this until it is listed
// here; a reworded header drops a module and reds this), and every listed
// module must carry the sentence and be required by server.js.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { routeModulePaths, routeSurfaceFiles, routeSurfaceSource } = require('../helpers/route-surface');

const ROOT = path.join(__dirname, '..', '..');

// The registry of extracted modules. A slice ADDS a line here in its own
// commit (the v1.259 lesson: a registry add that misses a hand-kept list is
// inert - here the derivation and the list check each other).
const EXPECTED = [
  'lib/auth/routes.js',
  'lib/books/routes.js',
  'lib/books/scanRunner.js',
  'lib/media/user-routes.js',
  'lib/music/routes.js',
  'lib/music/scanRunner.js',
  'lib/notifications/routes.js',
  'lib/push/routes.js',
  'lib/queue/routes.js',
  'lib/user/routes.js',
];

test('the route surface is exactly the registry of extracted modules (both directions), each required by server.js and carrying the marker sentence', () => {
  assert.deepStrictEqual(routeModulePaths(), EXPECTED, 'the derived surface and the registry disagree - a new slice must be listed here; a reworded header drops a module');
  const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  for (const rel of EXPECTED) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.match(src.split('\n').slice(0, 15).join(' ').replace(/\/\/\s*/g, ' ').replace(/\s+/g, ' '), /moved verbatim out of server\.js/i, `${rel} carries the marker sentence in its header`);
    const spec = `./${rel.replace(/\.js$/, '')}`;
    assert.ok(server.includes(`require('${spec}')`) || server.includes(`require("${spec}")`), `server.js requires ${spec}`);
  }
  assert.deepStrictEqual(routeSurfaceFiles().map((p) => path.relative(ROOT, p)), ['server.js', ...EXPECTED]);
});

test('the surface source is the concatenation, and a per-file reader is applied to every file', () => {
  const seen = [];
  const src = routeSurfaceSource((p) => { seen.push(path.relative(ROOT, p)); return `<${path.basename(p)}>`; });
  assert.deepStrictEqual(seen, ['server.js', ...EXPECTED]);
  assert.strictEqual(src, ['<server.js>', ...EXPECTED.map((p) => `<${path.basename(p)}>`)].join('\n'));
});
