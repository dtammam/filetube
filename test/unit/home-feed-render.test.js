'use strict';

// [UNIT] v1.79 home feed - the CLIENT render builders (public/js/main.js's
// buildFeedCardHtml / buildFeedRowHtml). Pure string functions over the
// server-resolved GET /api/home item shape. Adversarial gate WARNING-1: the
// T4 render path shipped with zero coverage; the reviewer verified the
// escaping is sound only BY INSPECTION. This binds it so a future regression
// to the escaping or the row structure fails the suite.

const { test } = require('node:test');
const assert = require('node:assert');

const { JSDOM } = require('jsdom');
const { buildFeedCardHtml, buildFeedRowHtml, buildFeedSkeleton, renderHomeFeed } = require('../../public/js/main.js');

function feedItem(over) {
  return Object.assign({
    id: 'vid1', kind: 'media', title: 'A Video', subtitle: 'A Channel',
    thumbnailUrl: '/thumbnail/vid1', href: '/watch.html?v=vid1', progressPercent: 0,
  }, over);
}

// ---- buildFeedCardHtml ------------------------------------------------------

test('card: renders the server-resolved fields into the row-card chassis', () => {
  const html = buildFeedCardHtml(feedItem());
  assert.match(html, /class="book-row-card music-row-card video-row-card"/);
  assert.match(html, /href="\/watch\.html\?v=vid1"/);
  assert.match(html, /src="\/thumbnail\/vid1"/);
  assert.match(html, /A Video/);
  assert.match(html, /A Channel/);
});

test('card: a progress bar appears only above 0.5% and is clamped to 100', () => {
  assert.doesNotMatch(buildFeedCardHtml(feedItem({ progressPercent: 0 })), /book-row-progress/);
  assert.doesNotMatch(buildFeedCardHtml(feedItem({ progressPercent: 0.4 })), /book-row-progress/);
  assert.match(buildFeedCardHtml(feedItem({ progressPercent: 42 })), /width: 42%/);
  assert.match(buildFeedCardHtml(feedItem({ progressPercent: 250 })), /width: 100%/); // clamped
});

test('card: every rendered field is HTML-escaped (no injection)', () => {
  // Free-text fields (server-resolved from item titles/channel names) AND the
  // url fields (server-built + encodeURIComponent-safe, so this escape is
  // defense-in-depth) - a hostile value in ANY of the four must be neutralized,
  // so swapping escapeBookRowHtml for identity on any one kills a case here
  // (adversarial delta residual: the href/thumbnailUrl escapes were unbound).
  const html = buildFeedCardHtml(feedItem({
    title: '<img src=x onerror=alert(1)>',
    subtitle: '"><script>bad()</script>',
    href: '"><script>href-evil()</script>',
    thumbnailUrl: '"><script>thumb-evil()</script>',
  }));
  assert.doesNotMatch(html, /<img src=x/);
  assert.doesNotMatch(html, /<script>bad/);
  assert.doesNotMatch(html, /<script>href-evil/);
  assert.doesNotMatch(html, /<script>thumb-evil/);
  assert.match(html, /&lt;img src=x/);
  assert.match(html, /href-evil/); // present but escaped (the &lt;script&gt; form)
  assert.match(html, /thumb-evil/);
});

// ---- buildFeedRowHtml -------------------------------------------------------

test('row: header + optional See-all + a card per item', () => {
  const html = buildFeedRowHtml({
    id: 'continue-watching', title: 'Continue watching', seeAllHref: null,
    items: [feedItem({ id: 'a' }), feedItem({ id: 'b' })],
  });
  assert.match(html, /<h3>Continue watching<\/h3>/);
  assert.doesNotMatch(html, /books-row-seeall/); // null href -> no See-all
  assert.strictEqual((html.match(/book-row-card/g) || []).length, 2);
});

test('row: a seeAllHref renders the See-all link', () => {
  const html = buildFeedRowHtml({
    id: 'recently-added', title: 'Recently added', seeAllHref: '/?folder=Chan',
    items: [feedItem()],
  });
  assert.match(html, /class="books-row-seeall" href="\/\?folder=Chan"/);
});

test('row: an empty or malformed row renders nothing (belt-and-braces)', () => {
  assert.strictEqual(buildFeedRowHtml({ id: 'x', title: 'X', items: [] }), '');
  assert.strictEqual(buildFeedRowHtml({ id: 'x', title: 'X' }), '');
  assert.strictEqual(buildFeedRowHtml(null), '');
});

test('row: the row title is escaped too', () => {
  const html = buildFeedRowHtml({ id: 'x', title: 'More from <b>Evil</b>', seeAllHref: null, items: [feedItem()] });
  assert.doesNotMatch(html, /<b>Evil<\/b>/);
  assert.match(html, /More from &lt;b&gt;Evil&lt;\/b&gt;/);
});

// ---- v1.102 shimmer sweep (tranche 4): the feed-mode skeleton ---------------

const countOf = (html, cls) => (html.match(new RegExp('class="[^"]*\\b' + cls + '(?![-\\w])', 'g')) || []).length;

test('skeleton: N rows x M cards, each real .video-row-card chassis + shimmer cover + two text lines', () => {
  const html = buildFeedSkeleton(3, 6);
  assert.strictEqual(countOf(html, 'books-home-row'), 3, 'three real feed-row sections');
  assert.strictEqual(countOf(html, 'video-row-card'), 18, '6 cards per row');
  // Each card reuses the REAL 16:9 cover box (zero-shift on reveal) + shimmers it.
  assert.strictEqual(countOf(html, 'book-row-cover'), 18, 'each card reuses the real cover box');
  assert.strictEqual((html.match(/book-row-cover video-row-cover skeleton-shimmer/g) || []).length, 18, 'the cover box shimmers');
  // A header title bar per row (the ready-made .skel-title asset).
  assert.strictEqual((html.match(/skeleton-shimmer skel-title/g) || []).length, 3, 'a shimmer title bar per row header');
  assert.ok(html.includes('skeleton-line-title') && html.includes('skeleton-line-meta'), 'two text lines per card');
  assert.ok(html.includes('aria-hidden="true"'), 'placeholders are aria-hidden');
});

test('skeleton: non-positive / non-integer counts -> \'\' (never throws)', () => {
  assert.strictEqual(buildFeedSkeleton(0, 6), '');
  assert.strictEqual(buildFeedSkeleton(3, 0), '');
  assert.strictEqual(buildFeedSkeleton(-1, 6), '');
  assert.strictEqual(buildFeedSkeleton('x', 6), '');
  assert.strictEqual(buildFeedSkeleton(), '');
});

// renderHomeFeed seeds the skeleton BEFORE awaiting /api/home, then REPLACES it
// once the fetch settles - real rows on success, empty state on no-rows, a
// recovery message on error. Binds the reveal (delete the seed -> the pre-fetch
// assertion goes red), not mere presence.
async function runFeed(fetchImpl) {
  delete global.document; delete global.window; delete global.fetch;
  const dom = new JSDOM('<!DOCTYPE html><body><div id="host"></div></body>', { url: 'http://localhost/' });
  global.window = dom.window;
  global.document = dom.window.document;
  const host = dom.window.document.getElementById('host');
  // A deferred fetch so we can inspect the host WHILE the fetch is pending.
  let resolveFetch;
  const pending = new Promise((res) => { resolveFetch = res; });
  global.fetch = () => pending.then(() => fetchImpl());
  const done = renderHomeFeed(host, undefined);
  // Synchronously after the call, before the fetch resolves: the skeleton is up.
  const midShimmer = host.querySelectorAll('.skeleton-shimmer').length;
  resolveFetch();
  await done;
  const out = { midShimmer, finalShimmer: host.querySelectorAll('.skeleton-shimmer').length, html: host.innerHTML };
  dom.window.close();
  return out;
}

test('renderHomeFeed: shimmers before the fetch, then reveals real rows (reveal-once)', async () => {
  const rows = [{ id: 'r', title: 'Recently added', seeAllHref: null, items: [feedItem()] }];
  const out = await runFeed(() => ({ ok: true, json: async () => ({ rows }) }));
  assert.ok(out.midShimmer > 0, 'the feed host shimmers while /api/home is in flight');
  assert.strictEqual(out.finalShimmer, 0, 'the skeleton is gone once real rows render');
  assert.match(out.html, /Recently added/, 'the real feed row rendered in its place');
});

test('renderHomeFeed: an empty feed replaces the skeleton with the empty state (never a stranded shimmer)', async () => {
  const out = await runFeed(() => ({ ok: true, json: async () => ({ rows: [] }) }));
  assert.ok(out.midShimmer > 0, 'shimmered during the fetch');
  assert.strictEqual(out.finalShimmer, 0, 'skeleton cleared');
  assert.match(out.html, /home-feed-empty/, 'the empty state took its place');
});

test('renderHomeFeed: a fetch error replaces the skeleton with the recovery message', async () => {
  const out = await runFeed(() => { throw new Error('network'); });
  assert.ok(out.midShimmer > 0, 'shimmered during the fetch');
  assert.strictEqual(out.finalShimmer, 0, 'skeleton cleared even on error');
  assert.match(out.html, /Could not load your home feed/, 'the recovery message took its place');
});
