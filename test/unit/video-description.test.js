'use strict';

// v1.48 item 1 (Dean): "Can we have the full description of the video pulled.
// Right now it's truncated."
//
// The truncation was render-only (a 400-char `clip` in renderEmbeddedTags), so
// the fix is a pure display decision: `resolveDisplayDescription` answers "what
// description, if any, does the description box show". These tests pin the two
// things that are easy to regress -- that NOTHING is truncated, and that the
// universal-lane title/description collision stays suppressed.

const { test } = require('node:test');
const assert = require('node:assert');
const { resolveDisplayDescription } = require('../../public/js/watch.js');

test('resolveDisplayDescription: exported for Node (require-safe)', () => {
  assert.equal(typeof resolveDisplayDescription, 'function');
});

test('resolveDisplayDescription: returns the description verbatim, with NO length cap', () => {
  // Deliberately far past the old 400-char clip that caused Dean's report, and
  // past any round number a future "sensible cap" might reintroduce.
  const long = 'A'.repeat(12000);
  const out = resolveDisplayDescription({ description: long }, 'Some Video Title');
  assert.equal(out.length, 12000, 'full text survives -- no truncation anywhere in this path');
  assert.equal(out, long);
  assert.ok(!out.includes('…'), 'never appends an ellipsis');
});

test('resolveDisplayDescription: preserves interior newlines and blank lines', () => {
  // The CSS renders this with `white-space: pre-wrap`; if the helper collapsed
  // or stripped newlines, a real multi-paragraph description (chapter lists,
  // links, credits) would render as one unreadable run.
  const desc = 'Line one\n\nLine three\n  indented four';
  assert.equal(resolveDisplayDescription({ description: desc }, 'T'), desc);
});

test('resolveDisplayDescription: trims only the OUTER whitespace', () => {
  assert.equal(resolveDisplayDescription({ description: '\n\n  Real text\n\n' }, 'T'), 'Real text');
});

test('resolveDisplayDescription: empty for a file with no description tag', () => {
  assert.equal(resolveDisplayDescription({}, 'T'), '');
  assert.equal(resolveDisplayDescription(null, 'T'), '');
  assert.equal(resolveDisplayDescription(undefined, 'T'), '');
  assert.equal(resolveDisplayDescription({ description: '' }, 'T'), '');
  assert.equal(resolveDisplayDescription({ description: '   \n  ' }, 'T'), '');
});

test('resolveDisplayDescription: ignores a non-string description tag', () => {
  assert.equal(resolveDisplayDescription({ description: 12345 }, 'T'), '');
  assert.equal(resolveDisplayDescription({ description: { a: 1 } }, 'T'), '');
});

// ---- the universal-lane collision (v1.41.16-18) ----------------------------
// A non-YouTube download's TITLE is its description, written by
// UNIVERSAL_OUTPUT_TEMPLATE's `%(title).100s`. Rendering the description for
// those items prints the same text twice: once cut to 100 chars as the title,
// once in full below it.

test('resolveDisplayDescription: suppressed when the description IS the title', () => {
  const same = 'This clip shows the thing happening';
  assert.equal(resolveDisplayDescription({ description: same }, same), '');
});

test('resolveDisplayDescription: title match is case-insensitive and whitespace-tolerant', () => {
  assert.equal(resolveDisplayDescription({ description: '  Some Clip  ' }, 'some clip'), '');
  assert.equal(resolveDisplayDescription({ description: 'SOME CLIP' }, '  Some Clip  '), '');
});

test('resolveDisplayDescription: a description that merely STARTS with the title still shows', () => {
  // The guard must be equality, not prefix: a real description very often opens
  // by restating the video's title and then continues. Suppressing those would
  // silently hide exactly the descriptions Dean asked to see.
  const title = 'Everywhere At The End Of Time';
  const desc = `${title}\n\nStages 1-6, complete. Recorded 2016-2019.`;
  assert.equal(resolveDisplayDescription({ description: desc }, title), desc);
});

test('resolveDisplayDescription: an absent/blank title never suppresses the description', () => {
  assert.equal(resolveDisplayDescription({ description: 'Real description' }, ''), 'Real description');
  assert.equal(resolveDisplayDescription({ description: 'Real description' }, null), 'Real description');
  assert.equal(resolveDisplayDescription({ description: 'Real description' }, undefined), 'Real description');
  // A description of literally whitespace-only vs an empty title must not
  // collide into "equal" and start showing blank text.
  assert.equal(resolveDisplayDescription({ description: '   ' }, ''), '');
});
