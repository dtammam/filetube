'use strict';

// [UNIT] v1.143 (Dean): the home-feed chip filter persists per-device -
// "if one chooses Audio and then closes app/refreshes page... it stays
// there unless toggled off." Implementation is a MIRROR of the modern
// sort's own v1.86.0 persistence (`filetube_modern_sort`): the boot read
// goes through resolveModernChip (bounding a stale/invalid stored value to
// 'all'), the click handler persists the pick, and choosing All persists
// 'all' - the natural cleared state, no extra setting.
//
// main.js's DOM wiring has no browser harness (the library-view-prefs
// posture) - the wiring is locked on comment-STRIPPED source (the v1.140
// lesson); the BOUNDING behavior (resolveModernChip) is exercised by
// invocation in modern-home-layout.test.js and re-asserted here for the
// stored-value rows specifically.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { resolveModernChip, MODERN_CHIP_FILTERS } = require('../../public/js/common.js');

// ---- the bounding behavior for STORED values (localStorage is untrusted) ---

test('resolveModernChip bounds every stored value: each real chip round-trips, junk/stale/absent -> all', () => {
  for (const chip of MODERN_CHIP_FILTERS) assert.strictEqual(resolveModernChip(chip), chip);
  assert.strictEqual(resolveModernChip('watched-later'), 'all', 'a chip retired in some future version must degrade, not break');
  assert.strictEqual(resolveModernChip(null), 'all', 'localStorage.getItem miss (first run) -> all');
  assert.strictEqual(resolveModernChip(undefined), 'all');
  assert.strictEqual(resolveModernChip(''), 'all');
});

// ---- source locks (comment-stripped - the v1.140 lesson) -------------------

const MAIN_SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'main.js'), 'utf8')
  .replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '');

test('boot: the stored chip is read THROUGH the whitelist into the live state (the enabling wire)', () => {
  assert.match(MAIN_SRC,
    /try \{ activeModernChip = resolveModernChip\(localStorage\.getItem\('filetube_modern_chip'\)\); \} catch \(_\) \{\s*\}/,
    'the boot read routes through resolveModernChip - a raw assignment would let untrusted storage drive the ?filter= param');
});

test('click: the picked chip is persisted under the SAME key the boot read consumes', () => {
  assert.match(MAIN_SRC,
    /activeModernChip = next;\s*try \{ localStorage\.setItem\('filetube_modern_chip', next\); \} catch \(_\) \{\s*\}/,
    'the write sits with the state update inside the chip click handler, private-mode tolerant');
});

test('key consistency: exactly the two wired sites use the storage key - a third writer or a renamed half is a conscious decision', () => {
  const uses = (MAIN_SRC.match(/filetube_modern_chip/g) || []).length;
  assert.strictEqual(uses, 2, 'one read (boot) + one write (click) - a drifted key name silently forks the memory');
});

test('the persisted value is the RESOLVED chip, never the raw dataset attribute', () => {
  // `next` is resolveModernChip(btn.dataset.chip) - assert the write consumes
  // the bounded variable, and that no path stores the raw dataset value.
  assert.ok(!/setItem\('filetube_modern_chip', btn\.dataset\.chip\)/.test(MAIN_SRC),
    'raw dataset values must never reach storage');
  assert.match(MAIN_SRC, /const next = resolveModernChip\(btn\.dataset\.chip\);/,
    'the bounded derivation the persisted value flows from');
});
