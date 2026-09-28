'use strict';

// [UNIT] v1.99 shimmer sweep tranche 2: the mobile AVATAR BAR reveal-once (Dean's
// device report - it popped in above the chips and shifted them) and the WATCH
// RELATED rail reveal-once. Plus the standing reveal-once CONTRACT landing in
// CONTRIBUTING. Builders follow the buildSkeletonGrid contract; wiring is
// source-locked (the sibling view-file posture).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { buildAvatarBarSkeleton } = require('../../public/js/main.js');
const { buildRelatedSkeletonCards } = require('../../public/js/watch.js');

const countOf = (html, cls) => (html.match(new RegExp('class="[^"]*\\b' + cls + '(?![-\\w])', 'g')) || []).length;

// UI pass sweep S2 (D4.4, D9; converts the v1.99 box-reuse locks, AC12): the
// skeletons are the SAME primitives as the real content, so the reserved box IS
// the final box: the avatar bar's disc is ui-avatar xl on both sides; the related
// rail's card is the ui-thumb + a TWO-line title (F63) + byline + meta.
const { JSDOM } = require('jsdom');

test('buildAvatarBarSkeleton: n chips whose disc is the SAME ui-avatar xl box the real chip draws; caps at 12; n<=0 -> \'\'', () => {
  const html = buildAvatarBarSkeleton(5);
  assert.strictEqual(countOf(html, 'modern-avatar-chip'), 5);
  assert.strictEqual((html.match(/class="ui-avatar ui-avatar--xl skeleton-shimmer"/g) || []).length, 5, 'the real disc box (zero-shift)');
  const main = fs.readFileSync(path.join(__dirname, '../../public/js/main.js'), 'utf8');
  assert.match(main, /u\.avatar\(\{ name: c\.name, url: c\.avatarUrl \|\| null, kind: 'channel', size: 'xl' \}\)/, 'the real chip draws ui.avatar xl');
  assert.ok((html.match(/skeleton-shimmer/g) || []).length >= 10, 'shimmer on the disc and the label line');
  assert.ok(html.includes('aria-hidden="true"'));
  assert.strictEqual(buildAvatarBarSkeleton(0), '');
  assert.strictEqual(buildAvatarBarSkeleton(-3), '');
  assert.strictEqual(buildAvatarBarSkeleton('x'), '');
  assert.strictEqual(countOf(buildAvatarBarSkeleton(50), 'modern-avatar-chip'), 12, 'capped at 12');
});

test('buildRelatedSkeletonCards: n cards of the FINAL geometry - the ui-thumb box, a two-line title, byline + meta lines; n<=0 -> \'\'', () => {
  const doc = new JSDOM('<!doctype html><body></body>').window.document;
  const html = buildRelatedSkeletonCards(4, doc);
  const g = new JSDOM(`<div id="g">${html}</div>`).window.document;
  const cards = g.querySelectorAll('#g > .related-card[aria-hidden="true"]');
  assert.strictEqual(cards.length, 4);
  for (const c of cards) {
    assert.ok(c.querySelector(':scope > .ui-thumb.ui-thumb--16x9.ui-thumb--row.related-thumb.skeleton-shimmer'), 'the real ui-thumb box (zero-shift)');
    assert.strictEqual(c.querySelectorAll('.related-info > .related-title > .skeleton-text').length, 2, 'F63: a TWO-line title skeleton (the clamp maximum)');
    assert.ok(c.querySelector('.related-info > .related-uploader > .skeleton-text') && c.querySelector('.related-info > .related-meta > .skeleton-text'), 'byline + meta line boxes');
  }
  assert.strictEqual(buildRelatedSkeletonCards(0, doc), '');
  // A DISCRIMINATING input for the Number.isInteger guard (the divergent-fixture trap).
  assert.strictEqual(buildRelatedSkeletonCards(3.5, doc), '', 'non-integer positive -> empty (binds the isInteger guard, not just the loop bound)');
});

test('avatar bar: PERSIST last-known count + RESERVE the strip before the fetch (no pop-in above the chips)', () => {
  const main = fs.readFileSync(path.join(__dirname, '../../public/js/main.js'), 'utf8');
  // Persist on populate: a real count is written, and an empty result writes 0
  // (so the next load reserves NOTHING -> no reverse-shift).
  assert.match(main, /writeModernAvatarBarCount\(channels\.length\)/, 'populate persists the real count');
  assert.match(main, /writeModernAvatarBarCount\(0\)/, 'an empty result persists 0');
  // Seed from the cache BEFORE the fetch (reserve the strip).
  assert.match(main, /const seedN = readModernAvatarBarCount\(\);\s*\n\s*if \(seedN > 0\) \{ bar\.innerHTML = buildAvatarBarSkeleton\(seedN\); bar\.hidden = false; \}/,
    'the strip is reserved with last-known-many shimmer chips before the /api/channels fetch');
  // Cleared on fetch error (never a stranded shimmer).
  assert.match(main, /\.catch\(\(\) => \{ if \(!sig\.aborted\) \{ bar\.textContent = ''; bar\.hidden = true; \} \}\)/,
    'a channels fetch error clears the seed, not a forever-shimmer');
});

test('watch related: seed shimmer + reveal the header BEFORE the fetch; the real render is the reveal', () => {
  const watch = fs.readFileSync(path.join(__dirname, '../../public/js/watch.js'), 'utf8');
  assert.match(watch, /relatedContainer\.innerHTML = buildRelatedSkeletonCards\(\d+\);\s*\n\s*try \{/,
    'the rail is seeded with shimmer rows before the try/await');
  // The three exits each REPLACE the seed, so it never strands (sweep S2: DOM + ui.state, D9).
  assert.match(watch, /relatedContainer\.replaceChildren\(frag\);/, 'success reveals real cards');
  assert.match(watch, /relatedContainer\.replaceChildren\(relatedUi\(\)\.state\(\{ icon: 'movie', title: 'No other files yet'/, 'empty reveals the empty state');
  assert.match(watch, /relatedContainer\.replaceChildren\(relatedUi\(\)\.state\(\{ icon: 'warning', title: 'Could not load related files'/, 'an error reveals the error state (Retry)');
});

test('CSS: the related thumb shows the shimmer fill (a ui-thumb: the shared .skeleton-shimmer fill wins by file order) and the avatar name line is sized for zero-shift', () => {
  const css = fs.readFileSync(path.join(__dirname, '../../public/css/style.css'), 'utf8');
  // Step 7 (DELIBERATE conversion): the rail's skeleton box is a ui-thumb (sweep S2), so it needs
  // no restore rule of its own - the shared .skeleton-shimmer (--surface-2) beats .ui-thumb's
  // ground because ui.css loads first (test/unit/library-shimmer-skeletons.test.js binds the
  // order in every shell and that no style.css rule re-grounds a ui-thumb).
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(bare, /\n\.skeleton-shimmer \{[^}]*background-color: var\(--surface-2\);/, 'the shared shimmer fill is --surface-2');
  assert.doesNotMatch(bare, /\.related-thumb[^{,]*\{[^}]*background/, 'no rule re-grounds the rail thumb over the shimmer');
  // Bind the ACTUAL height (not just margin-bottom presence): the real
  // .modern-avatar-name is --fs-2xs (10px) x 1.4 = a 14px line box, so the
  // skeleton line MUST be 14px for a true zero-shift chip (gate WARNING: a 10px
  // line left a ~4px settle). A wrong height here fails, unlike a presence check.
  const nameRule = /\.modern-avatar-chip \.skeleton-line \{([\s\S]*?)\}/.exec(css);
  assert.ok(nameRule, 'the avatar name skeleton rule exists');
  assert.match(nameRule[1], /height: 14px;/, 'the skeleton line is 14px (matches the real --fs-2xs 1.4 line box) - true zero-shift');
  assert.match(nameRule[1], /margin-bottom: 0;/, 'margin-zeroed so the chip height is exactly disc+gap+line');
});

test('sign-out drops the per-device avatar-bar count (so the next user does not reserve this user\'s strip)', () => {
  const common = fs.readFileSync(path.join(__dirname, '../../public/js/common.js'), 'utf8');
  const fn = /function accountSignOut\(\)[\s\S]*?\n\}/.exec(common);
  assert.ok(fn, 'accountSignOut exists');
  assert.match(fn[0], /localStorage\.removeItem\('ft-modern-avatarbar-count'\)/,
    'the avatar-bar count is cleared on sign-out (the shared-browser reverse-collapse mitigation)');
});

test('CONTRIBUTING carries the standing reveal-once contract (every new fetch-then-render surface)', () => {
  const contributing = fs.readFileSync(path.join(__dirname, '../../docs/CONTRIBUTING.md'), 'utf8');
  assert.match(contributing, /Every fetch-then-render surface reveals ONCE - no blank-then-pop \(MANDATORY\)/,
    'the reveal-once rule is a MANDATORY design-contract section');
  assert.match(contributing, /Seed a reserved-space skeleton-shimmer BEFORE the await/, 'the seed-before-await rule');
  assert.match(contributing, /STRAND-SAFE/, 'the strand-clear rule');
  assert.match(contributing, /FLASH-BACKWARD/, 'the no-reseed-over-loaded-content rule');
});
