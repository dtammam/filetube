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
const { buildMusicSkeletonCards, buildMusicSkeletonRows } = require('../../public/js/music.js');
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

test('each view SEEDS its skeleton into the host before the fetch, and CLEARS it on error (never stranded)', () => {
  const history = fs.readFileSync(path.join(__dirname, '../../public/js/history.js'), 'utf8');
  const books = fs.readFileSync(path.join(__dirname, '../../public/js/books.js'), 'utf8');
  const music = fs.readFileSync(path.join(__dirname, '../../public/js/music.js'), 'utf8');
  const podcasts = fs.readFileSync(path.join(__dirname, '../../public/js/podcasts.js'), 'utf8');

  // Seeded before the first load.
  assert.match(history, /listEl\.innerHTML = buildHistorySkeletonRows\(\d+\);\s*\n\s*fetchPage\(0, true\)/, 'history seeds before fetchPage(0)');
  assert.match(books, /grid\.innerHTML = buildBookSkeletonCards\(\d+\);/, 'books seeds before its await');
  assert.match(music, /content\.innerHTML = \(drill \|\| tab === 'songs'\)/, 'music seeds the shape-matched skeleton before its await');
  assert.match(podcasts, /content\.innerHTML = buildPodcastSkeletonCards\(\d+\);/, 'podcasts seeds before the shows fetch');

  // Cleared on error so a failed FIRST load shows the empty state, not a forever-shimmer.
  assert.match(history, /if \(replace\) \{ listEl\.innerHTML = ''; refreshChrome\(\); \}/, 'history clears the shimmer on error');
  assert.match(books, /catch \(err\) \{\s*\n\s*grid\.innerHTML = '';/, 'books clears the shimmer on error');
  assert.match(music, /if \(content\) content\.innerHTML = ''; \/\/ v1\.98/, 'music clears the shimmer on error');
  assert.match(podcasts, /if \(!currentShow && content\) content\.innerHTML = ''; \/\/ never strand/, 'podcasts clears the shimmer on error');
});

test('the shimmer base fill is restored on the reused art boxes (so the sweep is visible, not swallowed by --thumbnail-bg)', () => {
  const css = fs.readFileSync(path.join(__dirname, '../../public/css/style.css'), 'utf8');
  assert.match(css, /\.book-cover-link\.skeleton-shimmer,[\s\S]*?\.history-thumb\.skeleton-shimmer \{\s*background-color: var\(--bg-secondary\);/,
    'a specificity-winning rule restores --bg-secondary on the reused skeleton art boxes');
});
