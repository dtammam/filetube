'use strict';

// [UNIT] v1.79 home feed - the CLIENT render builders (public/js/main.js's
// buildFeedCardHtml / buildFeedRowHtml). Pure string functions over the
// server-resolved GET /api/home item shape. Adversarial gate WARNING-1: the
// T4 render path shipped with zero coverage; the reviewer verified the
// escaping is sound only BY INSPECTION. This binds it so a future regression
// to the escaping or the row structure fails the suite.

const { test } = require('node:test');
const assert = require('node:assert');

const { buildFeedCardHtml, buildFeedRowHtml } = require('../../public/js/main.js');

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
