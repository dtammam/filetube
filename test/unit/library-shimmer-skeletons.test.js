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
const { buildPodcastSkeletonRows } = require('../../public/js/podcasts.js');

// Count class-attribute tokens EXACTLY equal to `cls` (a trailing lookahead
// rejects a longer token, so `podcast-card` never matches `podcast-card-art`).
const countOf = (html, cls) => (html.match(new RegExp('class="[^"]*\\b' + cls + '(?![-\\w])', 'g')) || []).length;

// The n / n<=0 / shimmer-present contract, applied to every builder.
const CASES = [
  // UI pass S10: the reserved box is the real card's 2:3 ui-thumb (inside .book-cover-link)
  { name: 'book cards', fn: buildBookSkeletonCards, container: 'book-card', aspectBox: 'ui-thumb--2x3' },
  { name: 'music album cards', fn: buildMusicSkeletonCards, container: 'music-album-card', aspectBox: 'music-album-art', wrapper: 'music-card-grid' },
];

// UI pass S7 (D9; AC12): Music's song-row skeletons are ui-rows of the FINAL row geometry
// (the ui-art media slot, two line boxes, the three reserved action slots) inside the real
// song ui-list - converted out of the shared CASES table (the history precedent above).
test('music song rows: exactly n ui-row skeletons of the final row geometry, in the real song list; n<=0 -> \'\'', () => {
  const { JSDOM } = require('jsdom');
  const doc = new JSDOM('<!doctype html><body>' + buildMusicSkeletonRows(3) + '</body>').window.document;
  const list = doc.querySelector('.music-song-list.ui-list.ui-list--media-art.ui-list--actions-3');
  assert.ok(list, 'the SAME ui-list the real rows render in');
  const rows = list.querySelectorAll(':scope > .music-song-row.ui-row.ui-row--media[aria-hidden="true"]');
  assert.strictEqual(rows.length, 3);
  for (const r of rows) {
    assert.ok(r.querySelector('.ui-row__media > .ui-art.ui-avatar--lg.skeleton-shimmer'), 'the real 40px art box');
    assert.ok(r.querySelector('.ui-row__title > .skeleton-text.skeleton-shimmer') && r.querySelector('.ui-row__meta > .skeleton-text.skeleton-shimmer'), 'two line boxes');
    assert.strictEqual(r.querySelectorAll('.ui-row__actions > .ui-row__slot').length, 3, 'the three reserved action slots');
    assert.ok(r.querySelector('.ui-row__lead') && r.querySelector('.ui-row__aside'), 'every slot');
  }
  for (const n of [0, -2, 'nope', undefined]) assert.strictEqual(buildMusicSkeletonRows(n), '');
});

// UI pass sweep S2 (D9; AC12): History's skeleton rows are ui-rows of the FINAL
// row geometry (the ui-thumb media slot, two line boxes, the reserved action
// slot) - converted out of the shared CASES table below.
test('history rows: exactly n ui-row skeletons of the final row geometry, aria-hidden, shimmering; n<=0 -> \'\'', () => {
  const { JSDOM } = require('jsdom');
  const doc = new JSDOM('<!doctype html><body></body>').window.document;
  const html = buildHistorySkeletonRows(3, doc);
  const g = new JSDOM(`<div id="g">${html}</div>`).window.document;
  const rows = g.querySelectorAll('#g > .ui-row.ui-row--media[aria-hidden="true"]');
  assert.strictEqual(rows.length, 3);
  for (const r of rows) {
    assert.ok(r.querySelector('.ui-row__media > .ui-thumb.ui-thumb--16x9.ui-thumb--row.skeleton-shimmer'), 'the real thumb box');
    assert.ok(r.querySelector('.ui-row__title > .skeleton-text.skeleton-shimmer') && r.querySelector('.ui-row__meta > .skeleton-text.skeleton-shimmer'), 'two line boxes');
    assert.strictEqual(r.querySelectorAll('.ui-row__actions > .ui-row__slot').length, 1, 'the reserved Remove slot');
  }
  for (const n of [0, -2, 'nope', undefined]) assert.strictEqual(buildHistorySkeletonRows(n, doc), '');
});

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
  // Podcasts seeds ONLY the true blank moment (the show list on screen, not already populated).
  // UI pass S6: the list is a ui-list .podcast-show-list and its placeholder buildPodcastSkeletonRows.
  assert.match(podcasts, /if \(!currentShow && content && !content\.querySelector\('\.podcast-show-list'\)\) \{\s*\n\s*content\.innerHTML = buildPodcastSkeletonRows\(\d+\);/, 'podcasts seeds only when the list is blank (no reveal-once flash-backward)');

  // Cleared on error so a failed FIRST load shows the empty state, not a forever-shimmer.
  // Sweep S2 (D9): a failed FIRST load REPLACES the shimmer with the error state (Retry), never "No watch history yet".
  assert.match(history, /if \(replace\) \{\s*listEl\.replaceChildren\(historyUi\(\)\.state\(\{ icon: 'warning', title: 'Could not load your history'/, 'history clears the shimmer on error');
  assert.match(books, /catch \(err\) \{\s*\n\s*grid\.innerHTML = '';/, 'books clears the shimmer on error');
  // UI pass S7 (D9): a failed load REPLACES the shimmer with the error state (Retry), never "No music yet".
  assert.match(music, /catch \(err\) \{[\s\S]*?showLoadError\(\);/, 'music replaces the shimmer on error');
  assert.match(music, /function showLoadError\(\) \{\s*setEmpty\(false\);\s*if \(!content\) return;\s*content\.innerHTML = '';[\s\S]*?\.state\(\{ icon: 'warning'/, 'music clears the shimmer and shows the error state');
  // UI pass S6: the clear is followed by the error state (D9), inside the same guard.
  assert.match(podcasts, /catch[\s\S]*?if \(!currentShow && content\) \{\s*\n\s*content\.innerHTML = '';/, 'podcasts clears the shimmer on error');
});

test('the shimmer base fill is restored on the reused art boxes (so the sweep is visible, not swallowed by --thumbnail-bg)', () => {
  const css = fs.readFileSync(path.join(__dirname, '../../public/css/style.css'), 'utf8');
  // The library art boxes share the specificity-winning shimmer-fill rule
  // (later selectors like .related-thumb may join it - tolerate them). v1.103:
  // .music-artist-mosaic joins between album-art and podcast-card-art.
  // UI pass S6 + S10: podcasts and books left the list (their placeholders are a .ui-art square and a
  // .ui-thumb card box, which the later .skeleton-shimmer rule already fills; each sweep's own test binds that order).
  assert.match(css, /\.music-album-art\.skeleton-shimmer,\s*\n\s*\.music-artist-mosaic\.skeleton-shimmer,[\s\S]{0,360}background-color: var\(--bg-secondary\);/,
    'a specificity-winning rule restores --bg-secondary on the reused skeleton art boxes (incl. the artist mosaic)');
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ''), /\.podcast-card-art/, 'no rule for the retired podcast card art box');
  // History's thumb is a ui-thumb since sweep S2 (the .skeleton-shimmer fill applies directly).
  assert.doesNotMatch(css, /\.history-thumb/, 'no bespoke history thumb rule');
});

// ---- UI pass S6: the podcasts show list's placeholder (ui-list media rows) ----------------------
// Replaces the retired `podcast cards` case above: the show list is a ui-list of media rows now,
// and its placeholder is the same row DOM with a shimmering ui-art xl square.
test('podcast show rows: exactly n ui-row placeholders, each with the xl ui-art square + two block text bars', () => {
  const html = buildPodcastSkeletonRows(3);
  assert.strictEqual(countOf(html, 'ui-row'), 3, 'exactly 3 rows');
  assert.strictEqual((html.match(/class="ui-art ui-avatar--xl skeleton-shimmer"/g) || []).length, 3, 'each reserves the real xl art square');
  assert.strictEqual((html.match(/<div class="skeleton-line skeleton-line-title skeleton-shimmer">/g) || []).length, 3, 'a title bar per row (block div)');
  assert.strictEqual((html.match(/<div class="skeleton-line skeleton-line-meta skeleton-shimmer">/g) || []).length, 3, 'a meta bar per row (block div)');
  assert.doesNotMatch(html, /<span class="skeleton-line/, 'no inline-span bars');
  assert.ok(html.includes('podcast-show-list'), 'wrapped in the real .podcast-show-list container');
  assert.strictEqual(buildPodcastSkeletonRows(0), '');
  assert.strictEqual(buildPodcastSkeletonRows(-2), '');
  assert.strictEqual(buildPodcastSkeletonRows('nope'), '');
  assert.strictEqual(buildPodcastSkeletonRows(), '');
});

// UI pass sweep S10 (AC12 conversion of the books half above): the book skeleton's box
// is now the real card's ui-thumb, which paints --thumb-ground in ui.css. The shared
// `.skeleton-shimmer` rule (style.css, one class, same specificity as `.ui-thumb`) wins
// by FILE ORDER because every shell loads ui.css before style.css - so the lock is that
// order in every shell, plus no style.css rule re-grounding a ui-thumb after it.
test('book skeleton: the ui-thumb box shows the shimmer fill (style.css after ui.css in every shell; nothing re-grounds .ui-thumb)', () => {
  const pub = path.join(__dirname, '../../public');
  for (const page of fs.readdirSync(pub).filter((f) => f.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(pub, page), 'utf8');
    const uiAt = html.indexOf('href="/css/ui.css"');
    const styleAt = html.indexOf('href="/css/style.css"');
    if (uiAt === -1 || styleAt === -1) continue;
    assert.ok(uiAt < styleAt, `${page}: ui.css loads before style.css`);
  }
  const style = fs.readFileSync(path.join(pub, 'css/style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const base = /\n\.skeleton-shimmer \{[^}]*background-color: var\(--bg-secondary\);/.exec(style);
  assert.ok(base, 'the shared .skeleton-shimmer rule paints --bg-secondary');
  assert.doesNotMatch(style, /\.ui-thumb[^{},]*\{[^}]*background/, 'no style.css rule repaints a ui-thumb ground');
  assert.ok(buildBookSkeletonCards(1).includes('ui-thumb ui-thumb--2x3 ui-thumb--card skeleton-shimmer'), 'the skeleton box is the card thumb, shimmering');
});
