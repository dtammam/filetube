'use strict';

// [UNIT] Media capability parity CENSUS - the enforcement half of the standardization
// audit (lib/media-capabilities.js is the declaration). Modeled on
// search-provider-census.test.js: parity is enforced-by-test, not opt-in. A SUPPORTED
// cell whose wiring vanished, a media type/capability left undeclared, a Share marked
// N/A (Dean: EVERYTHING is shareable), or a TODO gap that silently appears/closes, all
// go RED here. The TODO set is the machine-derived worklist for the follow-up wave.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { KIND_TO_LIBRARY } = require('../../lib/auth/visibility');
const { MEDIA_TYPES, CAPABILITIES, MEDIA_VIEW_FILES, MATRIX } = require('../../lib/media-capabilities');

const ROOT = path.join(__dirname, '..', '..');
const readFiles = (rel) => rel.map((f) => {
  try { return fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch (_) { return ''; }
});

// ---- authority coverage -----------------------------------------------------

test('census: every KIND_TO_LIBRARY media type is declared in the matrix (a new type goes RED)', () => {
  const libraries = new Set(Object.values(KIND_TO_LIBRARY));
  assert.ok(libraries.size >= 5, `expected >=5 libraries (video/music/podcasts/books/tv), saw ${[...libraries]}`);
  for (const lib of libraries) {
    assert.ok(MATRIX[lib], `media type '${lib}' has no capability declaration in lib/media-capabilities.js`);
  }
  assert.deepStrictEqual([...MEDIA_TYPES].sort(), [...libraries].sort(), 'MEDIA_TYPES must equal the KIND_TO_LIBRARY set');
});

// ---- completeness: every (media x capability) cell declared ------------------

test('census: every media type declares EVERY capability (no undeclared cell)', () => {
  for (const type of MEDIA_TYPES) {
    for (const cap of CAPABILITIES) {
      const cell = MATRIX[type] && MATRIX[type][cap];
      assert.ok(cell && typeof cell.state === 'string',
        `${type}.${cap} is undeclared - add it to the matrix (supported/na/todo/delegated)`);
      assert.ok(['supported', 'na', 'todo', 'delegated'].includes(cell.state),
        `${type}.${cap} has an unknown state '${cell.state}'`);
    }
  }
});

// ---- SUPPORTED => actually wired (the source-lock) --------------------------

test('census: every SUPPORTED cell is wired - at least one marker appears in the view files', () => {
  for (const type of MEDIA_TYPES) {
    const srcs = readFiles(MEDIA_VIEW_FILES[type] || []);
    for (const cap of CAPABILITIES) {
      const cell = MATRIX[type][cap];
      if (cell.state !== 'supported') continue;
      assert.ok(Array.isArray(cell.markers) && cell.markers.length > 0, `${type}.${cap} SUPPORTED but declares no markers`);
      const hit = cell.markers.some((m) => srcs.some((s) => s.includes(m)));
      assert.ok(hit, `${type}.${cap} is SUPPORTED but NONE of its markers ${JSON.stringify(cell.markers)} appear in ${JSON.stringify(MEDIA_VIEW_FILES[type])} - the capability's wiring is missing or its marker is stale`);
    }
  }
});

// ---- Dean's directive: EVERYTHING is shareable ------------------------------

test('census: Share is universal - no media type may mark share N/A', () => {
  for (const type of MEDIA_TYPES) {
    const share = MATRIX[type].share;
    assert.notStrictEqual(share.state, 'na',
      `${type}.share is N/A, but Dean's ruling is that EVERYTHING is shareable - it must be supported, delegated, or a todo gap`);
  }
});

// ---- NA / DELEGATED integrity ----------------------------------------------

test('census: every N/A cell carries a non-empty reason', () => {
  for (const type of MEDIA_TYPES) {
    for (const cap of CAPABILITIES) {
      const cell = MATRIX[type][cap];
      if (cell.state !== 'na') continue;
      assert.ok(typeof cell.reason === 'string' && cell.reason.trim() !== '', `${type}.${cap} is N/A without a reason`);
    }
  }
});

test('census: every DELEGATED cell names a target', () => {
  for (const type of MEDIA_TYPES) {
    for (const cap of CAPABILITIES) {
      const cell = MATRIX[type][cap];
      if (cell.state !== 'delegated') continue;
      assert.ok(typeof cell.to === 'string' && cell.to.trim() !== '', `${type}.${cap} is DELEGATED without a target`);
    }
  }
});

// ---- TODO = the disclosed worklist (no silent gap; no silent close) ---------

test('census: the TODO set matches the declared snapshot (a new gap or a closed-but-unpromoted gap goes RED)', () => {
  const todos = [];
  for (const type of MEDIA_TYPES) {
    for (const cap of CAPABILITIES) {
      const cell = MATRIX[type][cap];
      if (cell.state === 'todo') todos.push(`${type}.${cap}:${cell.when}`);
    }
  }
  todos.sort();
  // The known, declared gaps as of the wave's start. Closing one (wiring it + flipping
  // to SUPPORTED) requires updating this snapshot - so a gap can't silently vanish, and
  // a NEW gap can't silently appear.
  const EXPECTED = [
    'books.share:next-wave',
    'podcasts.playerMenu:next-wave',
    'podcasts.share:next-wave',
    'podcasts.transcript:future',
  ].sort();
  assert.deepStrictEqual(todos, EXPECTED,
    'the TODO worklist changed - if you closed a gap, flip it to SUPPORTED and remove it here; if you added one, declare it and add it here');
});

test('census: print the cell-state census (visibility, always passes)', () => {
  const counts = { supported: 0, na: 0, todo: 0, delegated: 0 };
  for (const type of MEDIA_TYPES) for (const cap of CAPABILITIES) counts[MATRIX[type][cap].state]++;
  const total = MEDIA_TYPES.length * CAPABILITIES.length;
  assert.strictEqual(counts.supported + counts.na + counts.todo + counts.delegated, total, `all ${total} cells accounted for`);
  console.log(`[media-capability-census] ${total} cells: ${counts.supported} supported, ${counts.na} N/A, ${counts.todo} todo, ${counts.delegated} delegated`);
});
