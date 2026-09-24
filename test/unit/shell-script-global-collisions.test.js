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
// v1.77 (adversarial gate): DERIVED, not hand-listed. The v1.64 gate already
// caught four shells missing from this list and the fix was to add them by
// hand plus a comment asserting "All shells are now enumerated" - which was
// false again within three releases: podcasts.html, login.html and welcome.html
// were all absent while the comment claimed completeness. A hand-enumerated
// guard list rots (the v1.64 lesson, re-learned by the list that recorded it),
// and the comment claiming otherwise is worse than the gap.
//
// Now: every .html in public/ plus every .html in the yt-dlp module's views/.
// subscriptions.html lives OUTSIDE public/ (a res.sendFile route), which is the
// exact reason its script set historically drifts from the rest - so the
// second directory is deliberate, not incidental.
// diag.html is the standalone perf-diagnostics control page (served at /diag,
// gated by the experimental toggle). It loads ONLY its own /js/diag-page.js -
// none of the shared app globals - so there is no shared global scope for it to
// collide in, and it is deliberately not an app shell. Excluded here (an
// exclusion for a known-standalone page, not a rot-prone inclusion list).
const NON_SHELL_PAGES = new Set(['diag.html']);
const SHELLS = [
  ...fs.readdirSync(path.join(ROOT, 'public'))
    .filter((f) => f.endsWith('.html') && !NON_SHELL_PAGES.has(f))
    .sort()
    .map((f) => `public/${f}`),
  ...fs.readdirSync(path.join(ROOT, 'lib', 'ytdlp', 'views'))
    .filter((f) => f.endsWith('.html'))
    .sort()
    .map((f) => `lib/ytdlp/views/${f}`),
];

// Vacuity guard: a changed layout must not silently empty the roster.
if (SHELLS.length < 12) {
  throw new Error(`expected >=12 served shells, derived ${SHELLS.length}: ${SHELLS.join(', ')}`);
}

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
    // Two shell shapes, both worth checking for collisions - the point of this
    // file is that all scripts on a page share ONE global scope, and that is as
    // true of the auth pages as of the app shells.
    //
    // v1.77: the floor used to be a blanket `>= 5`, which is why login.html and
    // welcome.html could never have been added to the (then hand-written)
    // roster without failing. They are signed-out AUTH pages: glyph-pool +
    // common + login.js, and legitimately load none of the view scripts. So the
    // floor is now per-shape - a vacuity guard that the scripts were found at
    // all, plus the full-set requirement where the full set is actually
    // expected (any shell loading main.js).
    const isAppShell = srcs.some((s) => s.endsWith('/main.js'));
    assert.ok(srcs.length >= 3, `${shell}: no script set found (got ${srcs.length})`);
    if (isAppShell) {
      assert.ok(srcs.length >= 5, `${shell} should load the shared app script set (got ${srcs.length})`);
    }

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

// v1.303 (wheel config): the real mobile wheel (skin-surface.js) reads
// window.FileTubeWheelConfig at gesture start, so EVERY shell that loads
// skin-surface.js must load wheel-config.js EARLIER in source order - else the
// wheel reads an undefined config on that shell. Dynamic over the enumerated
// SHELLS (the v1.250 SHELL-PARITY class: a hand-kept list rots; a NEW shell that
// hosts the skin is caught automatically).
for (const shell of SHELLS) {
  test(`wheel-config.js loads before skin-surface.js wherever the wheel ships: ${shell}`, () => {
    const html = fs.readFileSync(path.join(ROOT, shell), 'utf8');
    const srcs = scriptSrcsInOrder(html);
    const surfaceIdx = srcs.findIndex((s) => s.endsWith('/skin-surface.js'));
    if (surfaceIdx < 0) return; // this shell does not host the skin - nothing to require
    const configIdx = srcs.findIndex((s) => s.endsWith('/wheel-config.js'));
    assert.ok(configIdx >= 0,
      `${shell} loads skin-surface.js but not wheel-config.js - the wheel reads FileTubeWheelConfig`);
    assert.ok(configIdx < surfaceIdx,
      `${shell} loads wheel-config.js (idx ${configIdx}) AFTER skin-surface.js (idx ${surfaceIdx}) - ` +
      'the wheel would read an undefined config at gesture start');
  });
}

// v1.317 M4 (desktop music ambient): the ambient engine + its shared host live in
// public/js/ambient.js, read through window.FileTubeAmbient by watch.js (the watch view)
// AND music.js (the music view, lazy-loaded into WHATEVER shell was cold-loaded). So EVERY
// app shell - any shell that loads the SPA (main.js) or a consumer (watch.js / player.js /
// music.js) - must load ambient.js, EARLIER than the first consumer. Dynamic over the
// enumerated SHELLS (the v1.250 SHELL-PARITY class: a hand-kept list rots; a NEW shell is
// caught automatically). Missing it would not throw: the views guard the global and simply
// never light the glow - a silent, per-shell INERT FEATURE, which is why this is a census.
const AMBIENT_CONSUMERS = ['/watch.js', '/player.js', '/music.js'];
const ambientShells = SHELLS.filter((shell) => {
  const srcs = scriptSrcsInOrder(fs.readFileSync(path.join(ROOT, shell), 'utf8'));
  return srcs.some((s) => s.endsWith('/main.js') || AMBIENT_CONSUMERS.some((c) => s.endsWith(c)));
});
test('ambient.js census is not vacuous: every app shell is enumerated (>= 11)', () => {
  assert.ok(ambientShells.length >= 11, `expected >= 11 app shells, derived ${ambientShells.length}: ${ambientShells.join(', ')}`);
  assert.ok(ambientShells.includes('public/music.html') && ambientShells.includes('public/watch.html') && ambientShells.includes('lib/ytdlp/views/subscriptions.html'),
    'the two hosting views\' shells and the out-of-public shell are in the roster');
});
for (const shell of ambientShells) {
  test(`ambient.js loads before every ambient consumer: ${shell}`, () => {
    const srcs = scriptSrcsInOrder(fs.readFileSync(path.join(ROOT, shell), 'utf8'));
    const ambientIdx = srcs.findIndex((s) => s.endsWith('/ambient.js'));
    assert.ok(ambientIdx >= 0, `${shell} is an app shell but does not load ambient.js - the watch and music views would never light the glow there`);
    assert.strictEqual(srcs.filter((s) => s.endsWith('/ambient.js')).length, 1, `${shell} loads ambient.js exactly once`);
    for (const c of AMBIENT_CONSUMERS) {
      const idx = srcs.findIndex((s) => s.endsWith(c));
      if (idx < 0) continue;
      assert.ok(ambientIdx < idx, `${shell} loads ambient.js (idx ${ambientIdx}) AFTER ${c} (idx ${idx})`);
    }
  });
}
