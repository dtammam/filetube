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

test('buildAvatarBarSkeleton: n chips reusing the real .modern-avatar-chip/.modern-avatar-circle; caps at 12; n<=0 -> \'\'', () => {
  const html = buildAvatarBarSkeleton(5);
  assert.strictEqual(countOf(html, 'modern-avatar-chip'), 5);
  assert.strictEqual(countOf(html, 'modern-avatar-circle'), 5, 'each reuses the real 56px disc box (zero-shift)');
  assert.ok((html.match(/skeleton-shimmer/g) || []).length >= 10, 'shimmer on the disc and the label line');
  assert.ok(html.includes('aria-hidden="true"'));
  assert.strictEqual(buildAvatarBarSkeleton(0), '');
  assert.strictEqual(buildAvatarBarSkeleton(-3), '');
  assert.strictEqual(buildAvatarBarSkeleton('x'), '');
  assert.strictEqual(countOf(buildAvatarBarSkeleton(50), 'modern-avatar-chip'), 12, 'capped at 12');
});

test('buildRelatedSkeletonCards: n cards reusing the real .related-card/.related-thumb; n<=0 -> \'\'', () => {
  const html = buildRelatedSkeletonCards(4);
  assert.strictEqual(countOf(html, 'related-card'), 4);
  assert.strictEqual(countOf(html, 'related-thumb'), 4, 'each reuses the real 16/9 thumb box (zero-shift)');
  assert.ok(html.includes('related-info'), 'the real info column');
  assert.ok(html.includes('skeleton-line-title') && html.includes('skeleton-line-meta'), 'title + meta lines');
  assert.doesNotMatch(html, /<span class="skeleton-line/, 'block div text lines, not inline spans');
  assert.strictEqual(buildRelatedSkeletonCards(0), '');
  assert.strictEqual(buildRelatedSkeletonCards(-3), '', 'negative -> empty (guard bound, not just n=0)');
  assert.strictEqual(buildRelatedSkeletonCards('x'), '', 'non-integer -> empty');
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
  // The three existing exits all innerHTML= real content, so the seed never strands.
  assert.match(watch, /relatedContainer\.innerHTML = related\.map/, 'success reveals real cards');
  assert.match(watch, /No other files found/, 'empty reveals the empty message');
});

test('CSS: the related thumb restores the shimmer fill (it is #000 letterbox) and the avatar name line is sized for zero-shift', () => {
  const css = fs.readFileSync(path.join(__dirname, '../../public/css/style.css'), 'utf8');
  assert.match(css, /\.related-thumb\.skeleton-shimmer \{[\s\S]*?background-color: var\(--bg-secondary\)/,
    'related-thumb skeleton restores --bg-secondary (else the sweep is swallowed by #000)');
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
