'use strict';

// [UNIT] v1.63.1 - the hide-the-fake-stars pref's pure decision
// (public/js/common.js). The DOM apply/boot/toggle paths are the usual
// thin injector shells (integration + Dean's device probe cover them);
// the CSS gate (.ft-hide-stars) is source-locked here so the one rule
// that hides EVERY star writer cannot silently vanish.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { shouldShowStarRatings } = require('../../public/js/common.js');

test('shouldShowStarRatings: ONLY the literal "hidden" hides; default and garbage show (today\'s look)', () => {
  assert.equal(shouldShowStarRatings('hidden'), false);
  assert.equal(shouldShowStarRatings('shown'), true);
  assert.equal(shouldShowStarRatings(null), true);
  assert.equal(shouldShowStarRatings(undefined), true);
  assert.equal(shouldShowStarRatings(''), true);
  assert.equal(shouldShowStarRatings('HIDDEN'), true, 'case-exact - garbage shows');
  assert.equal(shouldShowStarRatings('true'), true);
});

test('the ONE CSS gate covers both star writers (source lock)', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'style.css'), 'utf8');
  // UI pass sweep S3: the watch control is .watch-rating (drawn registry stars, .ft-fabricated)
  assert.match(css, /\.ft-hide-stars \.watch-rating,\s*\.ft-hide-stars \.card-rating \{\s*display: none;\s*\}/,
    'the root-class rule hides the watch control AND the card rows in one place');
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'watch.html'), 'utf8');
  assert.match(html, /<span class="watch-rating ft-fabricated" id="star-rating-control"/, 'the watch control carries both gates (the pref class + the era flourish)');
  assert.ok(!/\u2605|\u2606/.test(html), 'no text star glyph in the watch shell (they are drawn)');
});

// UI pass sweep S2 (D8.1; AC12 - the plan's star-ratings-pref conversion): the
// card stars are a FABRICATED stat, so they also answer to the era flourish; the
// pref composes on top (a retro era shows them unless the pref hides them). The
// per-era jsdom cascade over the real rules is test/unit/card-action-menu.test.js;
// here the two gates are bound together on the card row.
test('D8.1: the card star row is gated by BOTH the era flourish (.ft-fabricated) and this pref (.card-rating)', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'style.css'), 'utf8');
  assert.match(css, /html:not\(\[data-era-flourish="on"\]\) \.ft-fabricated \{\s*display: none;\s*\}/, 'the era gate');
  const main = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'main.js'), 'utf8');
  assert.match(main, /stars\.className = 'card-rating ft-fabricated';/, 'the card star row carries both gates');
  const { eraShowsFabricated } = require('../../public/js/common.js');
  assert.deepStrictEqual(['2005', '2009', '2014', '2021'].map(eraShowsFabricated), [true, true, true, false]);
});

// UI pass sweep S3 (D4.9; converts the v1.63.1 phone-centring lock, AC12): the stars left the
// action row (they sit in the meta line under the title) and the row is ONE line of equal
// columns spanning the phone's width - nothing wraps, so nothing needs centring. The equal
// columns are measured by test/geometry/watch.check.js (D4.9 unequal columns / one top).
test('the phone action bar spans the column in equal columns (the v1.63.1 centring, superseded)', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const phoneBlocks = css.split('@media (max-width: 768px)').slice(1);
  assert.ok(phoneBlocks.some((b) => /\.watch-actions \{[^}]*grid-auto-columns: minmax\(0, 1fr\);[^}]*\}/.test(b)),
    'equal columns across the phone column');
  assert.match(css, /\n\.watch-actions \{[^}]*display: grid;[^}]*grid-auto-flow: column;[^}]*\}/, 'one row (a column-flow grid never wraps)');
});
