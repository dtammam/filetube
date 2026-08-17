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

test('gate W1: the restored chip PAINTS active - the mount site feeds the live state into the row builder, and the builder derives .active/aria-selected from it', () => {
  // The seat's surviving mutant: hardcoding buildModernChipRowHtml('all') at
  // the mount site kept the whole suite green while the restored chip
  // filtered correctly but PAINTED All as active (the v1.138 enabling-wire
  // class - state-restore and state-write were bound, the state->paint
  // consumer was not).
  assert.match(MAIN_SRC, /buildModernChipRowHtml\(activeModernChip\)/,
    'the mount site consumes the LIVE (possibly restored) chip - never a literal');
  assert.ok(!/buildModernChipRowHtml\('all'\)/.test(MAIN_SRC), 'no hardcoded-All mount exists');
  // The builder's active derivation: EVERY link of the four-link paint chain
  // is individually locked (round-2 mutant F: `const a = 'all';` inside the
  // builder survived while mount->param, a->on, and on->markup all still
  // matched - the param->a link was the one unlocked seam).
  assert.match(MAIN_SRC, /const a = typeof resolveModernChip === 'function' \? resolveModernChip\(active\) : 'all';/,
    'link 2: the builder actually consumes its parameter, bounded');
  assert.match(MAIN_SRC, /const on = c\.filter === a;/, 'link 3: the active derivation');
  assert.match(MAIN_SRC, /class="modern-chip\$\{on \? ' active' : ''\}"/, 'paints .active from it');
  assert.match(MAIN_SRC, /aria-selected="\$\{on\}"/, 'and aria-selected from it');
});

test('gate W2 (pre-existing v1.86 gap): the chip actually drives the fetch URL - the ?filter= wire is bound end to end', () => {
  // The seat's second survivor: `const filter = 'all';` in buildModernGridUrl
  // kept the suite green - chips painted active while every fetch ignored
  // them. The memory wave restores a value into this wire, so it gets bound
  // here rather than tech-debted.
  assert.match(MAIN_SRC,
    /const filter = \(typeof resolveModernChip === 'function'\) \? resolveModernChip\(activeModernChip\) : activeModernChip;/,
    'the fetch filter derives from the live chip, bounded');
  assert.match(MAIN_SRC, /&filter=\$\{encodeURIComponent\(filter\)\}/,
    'and the derived value is what reaches the server');
});

test('the persisted value is the RESOLVED chip, never the raw dataset attribute', () => {
  // `next` is resolveModernChip(btn.dataset.chip) - assert the write consumes
  // the bounded variable, and that no path stores the raw dataset value.
  assert.ok(!/setItem\('filetube_modern_chip', btn\.dataset\.chip\)/.test(MAIN_SRC),
    'raw dataset values must never reach storage');
  assert.match(MAIN_SRC, /const next = resolveModernChip\(btn\.dataset\.chip\);/,
    'the bounded derivation the persisted value flows from');
});
