'use strict';

require('../helpers/isolate-data-dir'); // tech-debt #202: MUST precede any server.js require (it opens a db)

// [UNIT] Wave 7b slice S6 (the monolith split) -- the structural lock on the
// move itself, the FACTORY shape's version of test/unit/scan-helpers-extraction
// .test.js (which locks Wave 6's plain re-exports).
//
// The six import-relocation / repull planners now live in
// lib/ytdlp/relocation.js behind `createRelocation(deps)`. server.js calls the
// factory once and re-exports the six names it always exported, because a dozen
// test files and the yt-dlp router's deps bridge reach them through
// `require('../../server')`. A factory cannot be identity-checked the Wave 6 way
// (`server[name] === lib[name]`) -- each call builds fresh closures -- so the
// equivalent is bound three ways here:
//
//   1. NOT STILL HERE -- the name is no longer DEFINED as a top-level function
//      in server.js (comments stripped first, the v1.50/v1.77/v1.133 lesson: a
//      comment merely MENTIONING the name must not satisfy or trip the check).
//      A copy left behind would keep every existing test green while the
//      lib/ module quietly forked.
//   2. THE EXPORT IS THE MODULE'S OWN DECLARATION -- `server[name].toString()`
//      is a substring of lib/ytdlp/relocation.js's source. A wrapper
//      (`(...a) => impl(...a)`), a re-implementation, or a stale copy in
//      server.js all pass a presence check and fail this one. This is the check
//      the main session's function verifier cannot express (`Function.prototype
//      .toString()` drops the declaration line's own leading indent but keeps
//      the body's, so comparing against a uniformly re-indented original fails
//      for every factory slice -- measured, and the reason this lock exists in
//      the repo rather than in a scratch script).
//   3. THE COLLABORATORS CROSS LIVE -- the factory destructures its deps ONCE,
//      at boot, so anything reached through a destructured VALUE is frozen at
//      that instant. Nothing here is a reassigned `let`, so the stores cross as
//      the same object reference; the test below proves that by mutating a store
//      AFTER the factory call and watching the very next decision change. A
//      future dep that IS a `let` would have to cross as an accessor, and this
//      test is where that shows up.
//
// It also pins the collaborators that deliberately STAYED in server.js, so
// "left behind" is a recorded decision rather than an oversight nobody notices.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const MODULE_REL = 'lib/ytdlp/relocation.js';

// The six functions slice S6 moved, in server.js's source order.
const MOVED = [
  'migrateOneOffsIntoChannelFolders',
  'planImportRelocation',
  'relocateHydratedImportIntoChannelFolder',
  'buildImportRelocationPreview',
  'enumerateRepullableItems',
  'recordRepulledItemMeta',
];

// Collaborators the census flagged that deliberately did NOT move, each for a
// reason a later slice has to face rather than rediscover:
//   - classifyTransfer / classifyMetadataEffect / resolveRelocationTitle are
//     EXPORTED from server.js and have their own direct tests;
//     classifyTransfer also reads nearestExistingDir, which stays with it.
//   - isMediaJobInFlight reads transcodeQueue/audioExtractQueue, two arrays the
//     transcode lanes (slice S8) own.
const STAYED = ['classifyTransfer', 'classifyMetadataEffect', 'resolveRelocationTitle', 'isMediaJobInFlight'];

// The same crude comment stripper the other source locks in this suite use: it
// can only ever over-strip string literals that look like comments, which makes
// the lock more permissive on strings and never produces a false positive.
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const SERVER_RAW = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const SERVER_SRC = stripComments(SERVER_RAW);
const MODULE_SRC = fs.readFileSync(path.join(ROOT, MODULE_REL), 'utf8');
const server = require('../../server');
const relocation = require(`../../${MODULE_REL}`);

// Fail-safe floor: an emptied roster must not let this whole file pass
// vacuously (the "does the driver ever REACH the state" rule).
test('S6 lock: the moved roster is non-trivial (fail-safe floor)', () => {
  assert.strictEqual(MOVED.length, 6, 'slice S6 moved exactly six functions');
  assert.ok(STAYED.length >= 4, 'and pinned the collaborators that stayed');
});

for (const name of MOVED) {
  test(`S6 lock: ${name} is no longer DEFINED in server.js`, () => {
    const defined = new RegExp(`^(async )?function ${name}\\(`, 'm');
    assert.ok(!defined.test(SERVER_SRC),
      `${name} is still defined in server.js - a leftover copy forks silently from ${MODULE_REL}`);
  });

  test(`S6 lock: server.js's ${name} export IS the declaration inside ${MODULE_REL}`, () => {
    const exported = server[name];
    assert.strictEqual(typeof exported, 'function', `server.js must still export ${name}`);
    assert.strictEqual(exported.name, name, 'and export it under its own name, not a wrapper\'s');
    // toString() hands back the declaration's source as it appears in the
    // module; the module indents it one level inside the factory, and toString()
    // drops only the FIRST line's indent - so the whole thing is a substring of
    // the module's text, and is NOT a substring of server.js's.
    const src = exported.toString();
    assert.ok(MODULE_SRC.includes(src),
      `${name}'s exported object is not the function declared in ${MODULE_REL} - a wrapper or a re-implementation`);
    assert.ok(!SERVER_SRC.includes(src),
      `${name}'s body must not also exist in server.js - two copies is a fork waiting to happen`);
  });
}

test(`S6 lock: ${MODULE_REL} is a factory - one export, and it yields all six`, () => {
  assert.deepStrictEqual(Object.keys(relocation), ['createRelocation'],
    'the module\'s only door is the factory: a second export is a second, unbound way in');
  // The factory must not touch its deps at build time (server.js calls it at
  // boot, before ffmpeg/db probes have run), so a Proxy that throws on read
  // would be wrong to demand - but every name must come back a function.
  const built = relocation.createRelocation({});
  assert.deepStrictEqual(Object.keys(built).sort(), [...MOVED].sort());
  for (const name of MOVED) assert.strictEqual(typeof built[name], 'function', `${name} comes back from the factory`);
});

test('S6 lock: server.js requires the module, and the module never requires server.js back', () => {
  assert.ok(SERVER_SRC.includes(`require('./${MODULE_REL.replace(/\.js$/, '')}')`),
    `server.js must require ${MODULE_REL} - an unrequired module is dead code no call site exercises`);
  assert.ok(!/require\(\s*['"`][^'"`]*\/server(\.js)?['"`]\s*\)/.test(stripComments(MODULE_SRC)),
    `${MODULE_REL} must never require server.js - the deps bridge exists to avoid that circular trap`);
});

test('S6 lock: the collaborators that deliberately STAYED are still defined in server.js', () => {
  for (const name of STAYED) {
    const defined = new RegExp(`^(async )?function ${name}\\(`, 'm');
    assert.ok(defined.test(SERVER_SRC),
      `${name} was expected to stay in server.js - if it moved, update this lock and say why in the commit`);
  }
});

test('S6 seam: the factory\'s deps cross LIVE - a store mutated after the build is seen by the next decision', () => {
  // planImportRelocation reads `settingsStore.getKey('relocateHydratedImports')`
  // and `ytdlp.isEnabled(config)` through the destructured deps. The destructure
  // runs ONCE, so this drives the actual hazard: flip the collaborator's state
  // AFTER createRelocation() has returned, and the very next call must see it.
  // (Freeze the seam - hand in a boolean instead of the store - and the second
  // assertion below still reads the first value.)
  let relocateSetting = true;
  const built = relocation.createRelocation({
    settingsStore: { getKey: (k) => (k === 'relocateHydratedImports' ? relocateSetting : undefined) },
    ytdlp: { isEnabled: () => true, extraScanRoots: () => ['/downloads'] },
    fs: { existsSync: () => true },
    path,
  });
  const deps = { loadDatabase: () => ({ metadata: {} }), updateDatabase: () => {} };

  const before = built.planImportRelocation(deps, {}, 'vid1', null, undefined);
  assert.strictEqual(before.reason, 'item-gone', 'sanity: the setting was ON, so the decision got past the opt-out');

  relocateSetting = false; // the operator flips it OFF mid-batch
  const after = built.planImportRelocation(deps, {}, 'vid1', null, undefined);
  assert.strictEqual(after.reason, 'setting-off',
    'the opt-out is read LIVE through the store object - a destructured VALUE would have frozen it at boot');
});
