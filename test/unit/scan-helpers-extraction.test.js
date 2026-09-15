'use strict';

require('../helpers/isolate-data-dir'); // tech-debt #202: MUST precede any server.js require (it opens a db)

// [UNIT] Wave 6 (scan extraction) -- the structural lock on the move itself.
//
// The scan pipeline's pure helpers now live in lib/scan/*.js. server.js
// requires them back and re-exports them, because ~a dozen existing test files
// import them from `require('../../server')`. That re-export is the whole
// safety net of this extraction, so it gets BOUND three ways, not asserted in
// prose:
//
//   1. NOT STILL HERE - the name is no longer DEFINED as a function in
//      server.js (comments stripped first, the v1.50/v1.77/v1.133 lesson: a
//      comment merely MENTIONING the name must not satisfy or trip the check).
//      A copy left behind in server.js would keep every existing test green
//      while the lib/ module quietly forked.
//   2. EXPORTED from its lib/scan module.
//   3. THE SAME OBJECT through both doors - identity, not just presence. A
//      re-export that wrapped or re-implemented the helper would pass a
//      presence check and fail this one.
//
// It also pins the two helpers that deliberately STAYED, so "left behind" is a
// recorded decision rather than an oversight nobody notices later.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');

// name -> the lib/scan module that now owns it.
const MOVED = {
  matchRootFolder: 'roots',
  normalizeScanRoot: 'roots',
  detectVanishedRoots: 'roots',
  selectPrunableIds: 'merge',
  mergeScannedMetadata: 'merge',
  extractYtdlpVideoId: 'identity',
  youtubeIdFromUrlString: 'identity',
  deriveScanYoutubeId: 'identity',
  deriveReleaseDate: 'identity',
  applyCapturedViewCount: 'captured',
  applyCapturedFollowerCount: 'captured',
  collectDownloadNotification: 'captured',
  applyHasSubtitlesDetection: 'probe',
};

// Helpers that were CANDIDATES for the move and deliberately stayed in
// server.js. Pinned so a later extraction has to face the reason rather than
// discover it again:
//   - needsTranscode's TRANSCODE_EXTENSIONS list is source-locked out of
//     server.js's own TEXT by test/unit/tv-scan.test.js.
//   - codecNeedsTranscode is the codec-allowlist half needsTranscode calls.
// reconcileTranscode was pinned here through Wave 6, but Wave 7b slice S8 moved
// the WHOLE transcode-queue machinery (including transcodedPath, the very reason
// it was impure) into lib/media/transcode.js, so reconcileTranscode moved with
// it - see the dedicated S8 lock below, which records the move and guards the
// re-export the way the Wave 6 MOVED helpers above are guarded.
const STAYED = ['needsTranscode', 'codecNeedsTranscode'];

// Crude but sufficient comment stripper (the same shape the other source locks
// in this suite use): it can only ever over-strip string literals that look
// like comments, which makes the lock more permissive on strings and never
// produces a false positive.
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const SERVER_SRC = stripComments(fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8'));
const server = require('../../server');

// Fail-safe floor: a typo'd/emptied MOVED map must not let this whole file
// pass vacuously (the "ask whether the driver ever REACHES the state" rule).
test('Wave 6 lock: the moved-helper roster is non-trivial (fail-safe floor)', () => {
  assert.ok(Object.keys(MOVED).length >= 13,
    `expected >=13 moved helpers, roster has ${Object.keys(MOVED).length}`);
  assert.ok(new Set(Object.values(MOVED)).size >= 5, 'the helpers are spread over >=5 concern modules');
});

for (const [name, mod] of Object.entries(MOVED)) {
  test(`Wave 6 lock: ${name} is no longer DEFINED in server.js`, () => {
    const defined = new RegExp(`^(async )?function ${name}\\(`, 'm');
    assert.ok(!defined.test(SERVER_SRC),
      `${name} is still defined in server.js - a leftover copy forks silently from lib/scan/${mod}.js`);
  });

  test(`Wave 6 lock: ${name} is exported from lib/scan/${mod}.js AND from server.js, as the SAME function`, () => {
    const lib = require(`../../lib/scan/${mod}`);
    assert.strictEqual(typeof lib[name], 'function', `lib/scan/${mod}.js must export ${name}`);
    assert.strictEqual(typeof server[name], 'function', `server.js must re-export ${name}`);
    assert.strictEqual(server[name], lib[name],
      `${name} must be the SAME function object through both doors - a copy or a wrapper is a fork waiting to happen`);
  });
}

test('Wave 6 lock: every lib/scan module is actually REQUIRED by server.js (no orphan module)', () => {
  const dir = path.join(ROOT, 'lib', 'scan');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));
  assert.ok(files.length >= 5, `fail-safe floor: expected >=5 lib/scan modules, found ${files.length}`);
  for (const f of files) {
    const base = f.replace(/\.js$/, '');
    assert.ok(SERVER_SRC.includes(`require('./lib/scan/${base}')`),
      `server.js must require lib/scan/${f} - an unrequired module is dead code no call site exercises`);
  }
});

test('Wave 6 lock: the helpers that deliberately STAYED are still defined in server.js', () => {
  for (const name of STAYED) {
    const defined = new RegExp(`^(async )?function ${name}\\(`, 'm');
    assert.ok(defined.test(SERVER_SRC),
      `${name} was expected to stay in server.js - if it moved, update this lock and say why in the commit`);
  }
});

test('Wave 7b S8 lock: reconcileTranscode moved to lib/media/transcode.js - gone from server.js text, still re-exported', () => {
  // reconcileTranscode was a Wave 6 STAYED helper; slice S8 moved the transcode
  // queue machinery (and transcodedPath, its impurity) out, so it moved too. The
  // byte-identity + factory-return re-export are bound by the Wave 7b machine
  // verifiers (scripts/verify-split-functions.js); here we bind the two things a
  // unit lock can: it is no longer DEFINED in server.js (no leftover fork), and
  // server.js still re-exports it as a function (the dozen callers keep working).
  const defined = new RegExp('^(async )?function reconcileTranscode\\(', 'm');
  assert.ok(!defined.test(SERVER_SRC),
    'reconcileTranscode is still defined in server.js - a leftover copy forks from lib/media/transcode.js');
  assert.strictEqual(typeof server.reconcileTranscode, 'function',
    'server.js must still re-export reconcileTranscode (it is exported and a dozen tests import it)');
});

test('Wave 6 lock: TRANSCODE_EXTENSIONS stays in server.js text (test/unit/tv-scan.test.js parses it from there)', () => {
  // This is the exact reason needsTranscode did not move. Binding it here means
  // a future extraction trips THIS test, which names the consequence, rather
  // than tv-scan.test.js, which would just look unrelated.
  assert.match(SERVER_SRC, /const TRANSCODE_EXTENSIONS = \[/,
    'moving this constant out of server.js silently breaks the TV_EXTENSIONS drift lock');
});

test('Wave 6 lock: no lib/scan module requires server.js back (no circular dependency)', () => {
  const dir = path.join(ROOT, 'lib', 'scan');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    const src = stripComments(fs.readFileSync(path.join(dir, f), 'utf8'));
    assert.ok(!/require\(\s*['"`][^'"`]*\/server(\.js)?['"`]\s*\)/.test(src),
      `lib/scan/${f} must never require server.js - it is a leaf module by design`);
  }
});
