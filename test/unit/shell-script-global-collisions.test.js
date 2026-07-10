'use strict';

// Guard: cross-file GLOBAL LEXICAL COLLISIONS between the classic scripts a
// shell loads together.
//
// WHY THIS EXISTS (v1.26.3 hotfix): classic <script> tags all share ONE
// global lexical environment. Two files each declaring a top-level
// `const X` are fine in isolation (eslint and `node --check` are per-file;
// unit tests `require()` each file into its own module scope) -- but the
// moment one page loads both, the second script dies at instantiation with
// "SyntaxError: Identifier 'X' has already been declared" and NOT ONE LINE
// of it runs. That is exactly how v1.26.0's F4 fix (a deliberately
// "duplicated, not shared" `const ACTIVE_ENTRY_STALE_MS` in both common.js
// and subscriptions.js) silently emptied the /subscriptions page for three
// releases: subscriptions.js never evaluated, so the list never rendered
// and no error surfaced.
//
// HOW IT WORKS: for every shell, collect its <script src> list in load
// order, resolve each to the real file that route serves, concatenate the
// sources, and COMPILE (never run) the result as one vm.Script. A duplicate
// top-level `const`/`let`/`class` across any two files in that set is a
// SyntaxError at compile time -- same failure mode the browser hits at
// script instantiation. Duplicate `function`/`var` declarations are
// var-like and legal in both worlds, so they cannot false-positive here.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..', '..');

// Every shell FileTube serves, and where each lives. subscriptions.html is
// deliberately OUTSIDE public/ (res.sendFile route) -- the exact reason its
// script set historically drifts from the other four.
const SHELLS = [
  'public/index.html',
  'public/watch.html',
  'public/stats.html',
  'public/setup.html',
  'lib/ytdlp/views/subscriptions.html',
];

// Route -> served file, for scripts whose URL is not a literal public/ path.
// `/js/subscriptions.js` is served from lib/ytdlp/client/ (see
// lib/ytdlp/index.js's explicit app.get for it).
const ROUTE_OVERRIDES = {
  '/js/subscriptions.js': 'lib/ytdlp/client/subscriptions.js',
};

function scriptSrcsInOrder(html) {
  const srcs = [];
  const re = /<script[^>]*\bsrc\s*=\s*"([^"]+)"[^>]*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) srcs.push(m[1]);
  return srcs;
}

function resolveServedFile(src) {
  if (ROUTE_OVERRIDES[src]) return path.join(ROOT, ROUTE_OVERRIDES[src]);
  // Everything else is express.static('public').
  return path.join(ROOT, 'public', src.replace(/^\//, ''));
}

for (const shell of SHELLS) {
  test(`shell scripts share one global scope without lexical collisions: ${shell}`, () => {
    const html = fs.readFileSync(path.join(ROOT, shell), 'utf8');
    const srcs = scriptSrcsInOrder(html);
    assert.ok(srcs.length >= 5, `${shell} should load the shared script set (got ${srcs.length})`);

    const pieces = srcs.map((src) => {
      const file = resolveServedFile(src);
      assert.ok(fs.existsSync(file), `${shell} references ${src} but ${file} does not exist`);
      return `// ==== ${src} ====\n${fs.readFileSync(file, 'utf8')}`;
    });

    // Compile-only: a cross-file duplicate top-level const/let/class throws
    // SyntaxError here, exactly as the browser does at instantiation.
    try {
      new vm.Script(pieces.join('\n;\n'), { filename: `${shell}#concatenated` });
    } catch (err) {
      assert.fail(
        `Global lexical collision (or parse error) in ${shell}'s script set: ${err.message}. ` +
        'Two classic scripts loaded by this shell declare the same top-level const/let/class -- ' +
        'the second one will silently fail to run in the browser (see the v1.26.3 hotfix).'
      );
    }
  });
}
