'use strict';

// [UNIT] v1.98 shimmer sweep (tranche 1) - the four library-view skeleton
// builders (Music, Podcasts, Books, History). Each seeds a shape-matched
// reveal-once shimmer into its host BEFORE the fetch, so a place never shows a
// blank host then a snap-in. They follow the buildSkeletonGrid contract: exactly
// n nodes, n<=0 -> '', every node carries `.skeleton-shimmer`, and each REUSES
// its view's real container + reserved-aspect box class so the swap is
// zero-shift.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { buildHistorySkeletonRows } = require('../../public/js/history.js');
const { buildBookSkeletonCards } = require('../../public/js/books.js');
const { buildMusicSkeletonCards, buildMusicSkeletonRows, buildMusicArtistSkeletonCards } = require('../../public/js/music.js');
const { buildPodcastSkeletonCards } = require('../../public/js/podcasts.js');

// Count class-attribute tokens EXACTLY equal to `cls` (a trailing lookahead
// rejects a longer token, so `podcast-card` never matches `podcast-card-art`).
const countOf = (html, cls) => (html.match(new RegExp('class="[^"]*\\b' + cls + '(?![-\\w])', 'g')) || []).length;

// The n / n<=0 / shimmer-present contract, applied to every builder.
const CASES = [
  { name: 'history rows', fn: buildHistorySkeletonRows, container: 'history-row', aspectBox: 'history-thumb' },
  { name: 'book cards', fn: buildBookSkeletonCards, container: 'book-card', aspectBox: 'book-cover-link' },
  { name: 'music album cards', fn: buildMusicSkeletonCards, container: 'music-album-card', aspectBox: 'music-album-art', wrapper: 'music-card-grid' },
  { name: 'music song rows', fn: buildMusicSkeletonRows, container: 'music-song-row', aspectBox: 'music-song-thumb-wrap', wrapper: 'music-song-list' },
  { name: 'podcast cards', fn: buildPodcastSkeletonCards, container: 'podcast-card', aspectBox: 'podcast-card-art', wrapper: 'podcast-grid' },
];

for (const c of CASES) {
  test(`${c.name}: exactly n nodes, each reusing the real container + aspect box + skeleton-shimmer`, () => {
    const html = c.fn(3);
    assert.strictEqual(countOf(html, c.container), 3, 'exactly 3 container nodes');
    assert.strictEqual(countOf(html, c.aspectBox), 3, 'each reuses the real reserved-aspect box (zero-shift)');
    // Every skeleton carries the shimmer (the box + the two text lines -> >= 3 per node).
    assert.ok((html.match(/skeleton-shimmer/g) || []).length >= 9, 'shimmer on the box and the text lines');
    assert.ok(html.includes('skeleton-line-title') && html.includes('skeleton-line-meta'), 'two skeleton text lines');
    assert.ok(html.includes('aria-hidden="true"'), 'the placeholder is aria-hidden');
    if (c.wrapper) assert.ok(html.includes('class="' + c.wrapper + '"'), `wrapped in the real .${c.wrapper} container`);
  });

  test(`${c.name}: n<=0 / non-integer returns '' (never throws)`, () => {
    assert.strictEqual(c.fn(0), '');
    assert.strictEqual(c.fn(-2), '');
    assert.strictEqual(c.fn('nope'), '');
    assert.strictEqual(c.fn(), '');
  });

  test(`${c.name}: uses skeleton-line for text (BLOCK divs), never inline spans that would collapse the 11px bar`, () => {
    const html = c.fn(1);
    // The skeleton text lines must be <div> (block) - an inline <span> ignores
    // the 11px height and renders no bar.
    assert.doesNotMatch(html, /<span class="skeleton-line/, 'skeleton text lines are block <div>, not inline <span>');
    assert.match(html, /<div class="skeleton-line/, 'skeleton text lines present as block divs');
  });
}

// v1.103: artist cards are now art-forward (a square mosaic over name + meta),
// the SAME shape as an album card - so the skeleton reserves the mosaic square
// box, matching the revealed card exactly (reveal-once: seed the shape you
// reveal). It shares .music-card-grid with albums (no more .music-artist-grid).
test('music artist skeleton: mosaic-square cards, wrapped in .music-card-grid, n<=0 -> \'\'', () => {
  const html = buildMusicArtistSkeletonCards(4);
  assert.strictEqual(countOf(html, 'music-artist-card'), 4);
  assert.ok(html.includes('class="music-card-grid"'), 'the shared card grid wrapper');
  assert.ok(!html.includes('music-artist-grid'), 'no defunct .music-artist-grid (dropped in v1.103)');
  assert.strictEqual(countOf(html, 'music-artist-mosaic skeleton-shimmer'), 4, 'each card reserves the mosaic square (matches the revealed shape)');
  assert.ok(html.includes('skeleton-line-title') && html.includes('skeleton-line-meta'), 'name + meta lines');
  assert.doesNotMatch(html, /<span class="skeleton-line/, 'block div text lines');
  assert.strictEqual(buildMusicArtistSkeletonCards(0), '');
  assert.strictEqual(buildMusicArtistSkeletonCards('x'), '');
});

test('each view SEEDS its skeleton into the host before the fetch, and CLEARS it on error (never stranded)', () => {
  const history = fs.readFileSync(path.join(__dirname, '../../public/js/history.js'), 'utf8');
  const books = fs.readFileSync(path.join(__dirname, '../../public/js/books.js'), 'utf8');
  const music = fs.readFileSync(path.join(__dirname, '../../public/js/music.js'), 'utf8');
  const podcasts = fs.readFileSync(path.join(__dirname, '../../public/js/podcasts.js'), 'utf8');

  // Seeded before the first load (bind CODE, not comment text).
  assert.match(history, /listEl\.innerHTML = buildHistorySkeletonRows\(\d+\);\s*\n\s*fetchPage\(0, true\)/, 'history seeds before fetchPage(0)');
  assert.match(books, /grid\.innerHTML = buildBookSkeletonCards\(\d+\);\s*\n\s*try \{/, 'books seeds before its await');
  // Music seeds the SHAPE-MATCHED skeleton per tab, and does NOT seed a drill
  // (its header can't be reserved by a bare song-row skeleton - gate W2).
  assert.match(music, /if \(content && !drill\) \{[\s\S]*?tab === 'songs'[\s\S]*?buildMusicSkeletonRows\(\d+\)[\s\S]*?tab === 'artists'[\s\S]*?buildMusicArtistSkeletonCards\(\d+\)[\s\S]*?buildMusicSkeletonCards\(\d+\)/, 'music seeds per-tab shape, skips drill');
  // Podcasts seeds ONLY the true blank moment (grid on screen, not already populated).
  assert.match(podcasts, /if \(!currentShow && content && !content\.querySelector\('\.podcast-grid'\)\) \{\s*\n\s*content\.innerHTML = buildPodcastSkeletonCards\(\d+\);/, 'podcasts seeds only when the grid is blank (no reveal-once flash-backward)');

  // Cleared on error so a failed FIRST load shows the empty state, not a forever-shimmer.
  assert.match(history, /if \(replace\) \{ listEl\.innerHTML = ''; refreshChrome\(\); \}/, 'history clears the shimmer on error');
  assert.match(books, /catch \(err\) \{\s*\n\s*grid\.innerHTML = '';/, 'books clears the shimmer on error');
  assert.match(music, /catch \(err\) \{[\s\S]*?if \(content\) content\.innerHTML = '';/, 'music clears the shimmer on error');
  assert.match(podcasts, /catch[\s\S]*?if \(!currentShow && content\) content\.innerHTML = '';/, 'podcasts clears the shimmer on error');
});

test('the shimmer base fill is restored on the reused art boxes (so the sweep is visible, not swallowed by --thumbnail-bg)', () => {
  const css = fs.readFileSync(path.join(__dirname, '../../public/css/style.css'), 'utf8');
  // The library art boxes share the specificity-winning shimmer-fill rule
  // (later selectors like .related-thumb may join it - tolerate them). v1.103:
  // .music-artist-mosaic joins between album-art and podcast-card-art.
  assert.match(css, /\.book-cover-link\.skeleton-shimmer,\s*\n\s*\.music-album-art\.skeleton-shimmer,\s*\n\s*\.music-artist-mosaic\.skeleton-shimmer,[\s\S]{0,120}\n\s*\.podcast-card-art\.skeleton-shimmer[\s\S]{0,240}background-color: var\(--bg-secondary\);/,
    'a specificity-winning rule restores --bg-secondary on the reused skeleton art boxes (incl. the artist mosaic)');
  // .history-thumb already uses --bg-secondary, so it is deliberately NOT in the rule.
  assert.doesNotMatch(css, /\.history-thumb\.skeleton-shimmer \{/, 'history-thumb (already --bg-secondary) is not redundantly re-listed');
});
