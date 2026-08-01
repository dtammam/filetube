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
  assert.match(css, /\.ft-hide-stars \.star-rating,\s*\.ft-hide-stars \.card-rating \{\s*display: none;\s*\}/,
    'the root-class rule hides the watch control AND the card rows in one place');
});

test('the mobile centering rule exists inside a phone media block (source lock)', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'style.css'), 'utf8');
  const phoneBlocks = css.split('@media (max-width: 768px)').slice(1);
  // Binds BOTH halves: centering (Dean's device finding) AND the definite
  // width (slim gate W3 - without it, a lone fitting icon row hugs
  // flex-start instead of centering).
  assert.ok(phoneBlocks.some((b) => /\.watch-actions \{[^}]*justify-content: center;[^}]*\}/.test(b)),
    'each wrapped action line (stars, icons) centers at phone widths - Dean\'s v1.63.0 device finding');
  assert.ok(phoneBlocks.some((b) => /\.watch-actions \{[^}]*width: 100%;[^}]*\}/.test(b)),
    'definite width so a lone fitting row still centers (gate W3)');
});
