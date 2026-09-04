'use strict';

require('../helpers/isolate-data-dir'); // tech-debt #202: MUST precede any server.js require (it opens a db)

// [UNIT] v1.85 #1 - normalizeSearchTerm (server.js). The term is the PK of
// user_search_history, so normalization decides dedup: whitespace-collapsed,
// trimmed, length-capped; empty/garbage -> '' (the route rejects it).

const { test } = require('node:test');
const assert = require('node:assert');
const { normalizeSearchTerm } = require('../../server');

test('trims + collapses internal whitespace', () => {
  assert.strictEqual(normalizeSearchTerm('  hello   world  '), 'hello world');
  assert.strictEqual(normalizeSearchTerm('\tcat\n dog '), 'cat dog');
});

test('empty / whitespace-only / non-string -> "" (rejected upstream)', () => {
  assert.strictEqual(normalizeSearchTerm(''), '');
  assert.strictEqual(normalizeSearchTerm('    '), '');
  assert.strictEqual(normalizeSearchTerm(null), '');
  assert.strictEqual(normalizeSearchTerm(undefined), '');
  assert.strictEqual(normalizeSearchTerm(42), '');
});

test('caps length at 200 (a pasted essay never becomes a giant key)', () => {
  const long = 'a'.repeat(500);
  assert.strictEqual(normalizeSearchTerm(long).length, 200);
});

test('preserves case (display fidelity; exact-dedup is intentional)', () => {
  assert.strictEqual(normalizeSearchTerm('Fireship'), 'Fireship');
});
