'use strict';

// [UNIT] v1.381.0 Feed, TikTok style (plan docs/exec-plans/active/2026-10-09-feed-tiktok.md).
// W1 (D1, D2): the other-device card (#handoff-card) and the download chip (#dl-status-chip) are not shown
// in the Feed. Both live on <body>, outside #view-root, so the rule keys on body[data-view], which the router
// stamps on every view change (common.js applyZoomPolicy -> deriveRouteView). jsdom cannot measure the cascade:
// the rule is locked by source here and measured in a real browser by tools/feed-proof/layout.js.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const CSS = fs.readFileSync(path.join(ROOT, 'public/css/style.css'), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');

// a selector's specificity (ids, classes / attributes / pseudo-classes, types) - enough for the plain selectors this file uses
function specificity(sel) {
  const s = sel.replace(/::[\w-]+/g, '');
  const ids = (s.match(/#[\w-]+/g) || []).length;
  const cls = (s.match(/\.[\w-]+|\[[^\]]*\]|:(?!not\()[\w-]+/g) || []).length;
  const types = (s.replace(/#[\w-]+|\.[\w-]+|\[[^\]]*\]|:[\w-]+(\([^)]*\))?/g, ' ').match(/[a-z][\w-]*/gi) || []).length;
  return [ids, cls, types];
}
const beats = (a, b) => a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2];

test('W1: in the Feed the other-device card and the download chip are display:none (one rule, both ids)', () => {
  const css = stripComments(CSS);
  const rules = css.match(/[^{}]*\{[^{}]*\}/g) || [];
  const hits = rules.filter((r) => /body\[data-view="feed"\]\s*#(handoff-card|dl-status-chip)/.test(r));
  assert.strictEqual(hits.length, 1, 'exactly one rule carries the Feed hide');
  const [sel, body] = hits[0].split('{');
  const selectors = sel.split(',').map((x) => x.trim());
  assert.ok(selectors.includes('html:root body[data-view="feed"] #handoff-card'), 'the other-device card');
  assert.ok(selectors.includes('html:root body[data-view="feed"] #dl-status-chip'), 'the download chip');
  assert.match(body, /display:\s*none/);
  // no !important (ui-lint display-ownership): the rule must win on specificity, never on file order (LESSONS 6)
  for (const id of ['#handoff-card', '#dl-status-chip']) {
    const mine = specificity(selectors.find((x) => x.endsWith(id)));
    const rivals = rules.filter((r) => r !== hits[0] && /(^|[;{\s])display\s*:/.test(r.split('{')[1]))
      .flatMap((r) => r.split('{')[0].split(',').map((x) => x.trim()))
      .filter((x) => new RegExp(id + '$').test(x));
    assert.ok(rivals.length >= 1, id + ': its own display rule is found (non-vacuity)');
    for (const r of rivals) assert.ok(beats(mine, specificity(r)), `${id}: the Feed hide (${mine}) beats "${r}" (${specificity(r)})`);
  }
});

test('W1: the router stamps body[data-view="feed"] for /feed (the hook the rule keys on) and only there', () => {
  const common = require('../../public/js/common.js');
  assert.strictEqual(common.deriveRouteView('/feed'), 'feed');
  assert.notStrictEqual(common.deriveRouteView('/'), 'feed');
  assert.notStrictEqual(common.deriveRouteView('/music'), 'feed');
  const src = fs.readFileSync(path.join(ROOT, 'public/js/common.js'), 'utf8');
  const fn = src.slice(src.indexOf('function applyZoomPolicy('), src.indexOf('function applyZoomPolicy(') + 900);
  assert.match(fn, /deriveRouteView\(window\.location\.pathname/);
  assert.match(fn, /document\.body\.setAttribute\('data-view', view \|\| ''\)/);
});

// ---- W2 (D3-D6): pages, the read target, Fit / Fill, the layout's CSS ----------------------------------------------

const feed = require('../../public/js/feed.js');
const { feedRealm, BOOK, POD, VID } = require('../helpers/feed-view-harness');

const blk = (i, n, extra) => Object.assign({ spineIndex: 0, blockIndex: i, text: Array.from({ length: n }, (_, k) => `b${i}w${k}`).join(' '), heading: false, chapterStart: false }, extra || {});
const budget = (n) => (blocks) => blocks.reduce((t, b) => t + feed.feedWordCount(b.text), 0) <= n;
const shape = (pages) => pages.map((p) => p.map((b) => `${b.blockIndex}:${feed.feedWordCount(b.text)}${b.cont ? 'c' : ''}`).join(' '));

test('W2 feedPaginate: whole blocks while they fit; a long paragraph continues on the next page (>= 8 words here), parts keep their place', () => {
  assert.deepStrictEqual(shape(feed.feedPaginate([blk(1, 10), blk(2, 10), blk(3, 10)], budget(25))), ['1:10 2:10', '3:10'], '5 words left: too few to split a 10-word paragraph (needs > 16 words)');
  assert.deepStrictEqual(shape(feed.feedPaginate([blk(1, 10), blk(2, 40), blk(3, 3)], budget(25))), ['1:10 2:15', '2:25c', '3:3']);
  const pages = feed.feedPaginate([blk(1, 10), blk(2, 40)], budget(25));
  assert.ok(pages[1].every((b) => b.spineIndex === 0 && b.blockIndex === 2), 'a continuation keeps its block\'s place');
  // a heading is never split across a page break
  assert.deepStrictEqual(shape(feed.feedPaginate([blk(1, 20), blk(2, 30, { heading: true })], budget(25))), ['1:20', '2:25', '2:5c']);
  // a block longer than a whole page is cut at the longest head that fits; the parts after the first are `cont` without a chapter label
  const big = feed.feedPaginate([blk(5, 60, { chapterStart: true })], budget(25));
  assert.deepStrictEqual(shape(big), ['5:25', '5:25c', '5:10c']);
  assert.deepStrictEqual(big.map((p) => p[0].chapterStart), [true, false, false]);
  // it always progresses (nothing fits at all: one word a page, never a hang)
  assert.strictEqual(feed.feedPaginate([blk(1, 3)], () => false).length, 3);
  assert.deepStrictEqual(feed.feedPaginate([], budget(5)), []);
});

test('W2 feedBookTarget: pages read IN ORDER move the place to the first unread page\'s start; all read = the card\'s end; nothing past an unread page', () => {
  const pages = feed.feedPaginate([blk(1, 10), blk(2, 40), blk(3, 20)], budget(25)); // ['1:10 2:15', '2:25c', '3:20']
  const end = { spineIndex: 0, blockIndex: 4 };
  assert.strictEqual(feed.feedBookTarget(pages, {}, end), null, 'nothing read: nothing moves');
  assert.deepStrictEqual(feed.feedBookTarget(pages, { 0: true }, end), { spineIndex: 0, blockIndex: 2 }, 'page 1 read: the split paragraph is re-served from its start');
  assert.deepStrictEqual(feed.feedBookTarget(pages, { 0: true, 1: true }, end), { spineIndex: 0, blockIndex: 3 });
  assert.deepStrictEqual(feed.feedBookTarget(pages, { 0: true, 1: true, 2: true }, end), end);
  assert.strictEqual(feed.feedBookTarget(pages, { 1: true, 2: true }, end), null, 'pages read after an unread one never move the place');
  assert.deepStrictEqual(feed.feedBookTarget(pages, { 0: true, 2: true }, end), { spineIndex: 0, blockIndex: 2 });
  assert.strictEqual(feed.feedBookTarget(pages, { 0: true, 1: true, 2: true }, null), null, 'a parked card (no next) moves nothing at its end');
  // a paragraph over pages 1 and 2, only page 1 read: the target would be the card's own start - nothing moves
  const one = feed.feedPaginate([blk(7, 40)], budget(25));
  assert.strictEqual(feed.feedBookTarget(one, { 0: true }, end), null);
});

test('W2 feedFurther and feedPageDwellSec', () => {
  const a = { spineIndex: 1, blockIndex: 5 };
  const b = { spineIndex: 2, blockIndex: 0 };
  assert.strictEqual(feed.feedFurther(a, b), b);
  assert.strictEqual(feed.feedFurther(b, a), b);
  assert.strictEqual(feed.feedFurther(a, { spineIndex: 1, blockIndex: 6 }).blockIndex, 6);
  assert.strictEqual(feed.feedFurther(a, null), a);
  assert.strictEqual(feed.feedFurther(null, null), null);
  assert.deepStrictEqual(feed.feedFurther(b, { atEnd: true }), { atEnd: true });
  assert.strictEqual(feed.feedFurther(a, a), a, 'equal: the first (so a re-write of the same place is skipped)');
  assert.strictEqual(feed.feedPageDwellSec([blk(1, 300)]), 36, 'the shipped rule on the page\'s words: 300 words / 300 a minute x 0.6 = 36 s');
  assert.strictEqual(feed.feedPageDwellSec([blk(1, 10)]), 5, 'the 5 s floor');
});

// a book card whose 5 blocks of 10 words lay into pages of 25 words: ['1:10 2:10', '3:10 4:10', '5:10']
const PAGED_BOOK = Object.assign({}, BOOK, { blocks: [1, 2, 3, 4, 5].map((i) => blk(i, 10)), words: 50, dwellSec: 10, next: { spineIndex: 0, blockIndex: 6 } });

async function startRealm(r) { r.init(); await r.settle(); r.$('#feed-picker-choices button[data-minutes="10"]').click(); await r.settle(); }

test('W2 view (D6): a book card shows ONE fitted page (no scroller), says which page, and reading page 1 then swiping on moves the place to page 2\'s start - never to the card\'s end', async () => {
  const r = feedRealm({ pageWords: 25, batches: [{ cards: [PAGED_BOOK, POD, VID], exhausted: false }] });
  try {
    await startRealm(r);
    r.show(0);
    const node = r.$$('.feed-card')[0];
    const page = node.querySelector('.feed-card__page');
    assert.ok(page, 'the page box');
    assert.deepStrictEqual(Array.from(page.querySelectorAll('p')).map((p) => p.textContent.split(' ')[0]), ['b1w0', 'b2w0'], 'page 1 holds blocks 1-2');
    assert.strictEqual(node.querySelector('[data-page-readout]').textContent, 'Page 1 of 3');
    r.advance(6000); // past page 1's dwell (20 words: the 5 s floor)
    r.show(1); await r.settle();
    const writes = r.calls('POST', '/api/feed/progress/book/bk1');
    assert.strictEqual(writes.length, 1);
    assert.deepStrictEqual(writes[0].body, { spineIndex: 0, blockIndex: 3 }, 'the first unread page\'s start, not next (0,6)');
    // the recap counts the 20 words on the page read
    r.$('#feed-done-btn').click(); await r.settle();
    const fin = r.calls('POST', '/api/feed/sessions/abcdef0123456789/finish');
    assert.deepStrictEqual(fin[0].body.summary.books, [{ id: 'bk1', title: 'Alpha', pages: 1, words: 20 }]);
  } finally { r.close(); }
});

test('W2 view (D6): a page shown for less than its dwell is not read - swiping on writes nothing', async () => {
  const r = feedRealm({ pageWords: 25, batches: [{ cards: [PAGED_BOOK, POD, VID], exhausted: false }] });
  try {
    await startRealm(r);
    r.show(0);
    r.advance(4000);
    r.show(1); await r.settle();
    assert.strictEqual(r.calls('POST', '/api/feed/progress/book/bk1').length, 0);
  } finally { r.close(); }
});

test('W2 view (D4): a video card is Fill by default; Fit letterboxes every video card and is remembered on the device', async () => {
  const r = feedRealm({ batches: [{ cards: [VID, POD, Object.assign({}, VID, { id: 'v2' })], exhausted: false }] });
  try {
    await startRealm(r);
    const vids = r.$$('.feed-card[data-media="video"]');
    assert.ok(vids.length >= 2, 'the harness repeats its last batch on a prefetch: two or more video cards');
    assert.ok(vids.every((n) => n.getAttribute('data-fit') === 'fill'));
    assert.strictEqual(r.$('.feed-card[data-media="audio"] [data-fit-toggle]'), null, 'an episode has no Fit button');
    vids[0].querySelector('[data-fit-toggle]').click();
    assert.ok(vids.every((n) => n.getAttribute('data-fit') === 'fit'));
    assert.strictEqual(r.w.localStorage.getItem('ft-feed-fit'), 'fit');
    assert.strictEqual(vids[1].querySelector('[data-fit-toggle]').getAttribute('aria-pressed'), 'true');
    vids[1].querySelector('[data-fit-toggle]').click();
    assert.ok(vids.every((n) => n.getAttribute('data-fit') === 'fill'));
    assert.strictEqual(r.w.localStorage.getItem('ft-feed-fit'), 'fill');
  } finally { r.close(); }
  const r2 = feedRealm({ batches: [{ cards: [VID, POD], exhausted: false }] });
  try {
    r2.w.localStorage.setItem('ft-feed-fit', 'fit');
    await startRealm(r2);
    assert.strictEqual(r2.$('.feed-card[data-media="video"]').getAttribute('data-fit'), 'fit', 'read back on the next session');
  } finally { r2.close(); }
});

test('W2 view (D3, D5): every card is media + HUD strip + stage + overlay; an episode shows its art once (backdrop + art, the player surface undrawn)', async () => {
  const r = feedRealm({ batches: [{ cards: [BOOK, POD, VID], exhausted: false }] });
  try {
    await startRealm(r);
    for (const node of r.$$('.feed-card')) {
      assert.deepStrictEqual(Array.from(node.children).slice(0, 4).map((c) => c.className), ['feed-card__media', 'feed-card__hudspace', 'feed-card__stage', 'feed-card__overlay'], node.getAttribute('data-kind'));
      assert.ok(node.querySelector('.feed-card__overlay .feed-card__title'), 'the title is in the overlay');
    }
    const pod = r.$('.feed-card[data-kind="podcast"]');
    assert.strictEqual(pod.getAttribute('data-media'), 'audio');
    assert.strictEqual(pod.querySelector('.feed-card__backdrop').getAttribute('src'), '/podcastart/s1');
    assert.strictEqual(pod.querySelector('.feed-card__stage .feed-card__art').getAttribute('src'), '/podcastart/s1');
    assert.ok(pod.querySelector('.feed-card__media .feed-card__slot'));
  } finally { r.close(); }
});

test('W2 CSS (D6, D3, D4): no feed rule scrolls a card\'s content; the HUD strip; the slot rules out-rank the full player\'s two-id rules', () => {
  const css = stripComments(CSS);
  const rules = css.match(/[^{}]*\{[^{}]*\}/g) || [];
  const feedRules = rules.filter((r) => /data-view="feed"\]/.test(r.split('{')[0]));
  assert.ok(feedRules.length > 20, 'non-vacuity');
  const scrolling = feedRules.filter((r) => /overflow(-y)?\s*:\s*(auto|scroll)/.test(r.split('{')[1]));
  assert.deepStrictEqual(scrolling.map((r) => r.split('{')[0].trim()), ['#view-root[data-view="feed"] .feed-stack'], 'only the stack itself scrolls (card to card)');
  assert.ok(feedRules.some((r) => /\.feed-card__page\s*\{[^}]*overflow:\s*hidden/.test(r)), 'the page clips, never scrolls');
  assert.ok(feedRules.some((r) => /\.feed-card__hudspace\s*\{[^}]*height:\s*calc\(var\(--hit\) \+ 2 \* var\(--space-6\)\)/.test(r)), 'the HUD strip is the HUD\'s height (44 + its 12 px inset, twice)');
  assert.ok(feedRules.some((r) => /\.feed-hud\s*\{[^}]*top:\s*var\(--space-6\)/.test(r)), 'the HUD sits at the strip\'s inset');
  const vid = feedRules.find((r) => /\.feed-card__slot > #player-wrapper #media-player\s*\{/.test(r));
  assert.ok(vid && /height:\s*100%/.test(vid) && /object-fit:\s*cover/.test(vid) && /aspect-ratio:\s*auto/.test(vid));
  const mine = specificity('#view-root[data-view="feed"] .feed-card__slot > #player-wrapper #media-player');
  for (const rival of ['#player-wrapper:not(.audio-expanded) #media-player', '#player-wrapper.portrait-media:not(.audio-expanded) #media-player']) {
    assert.ok(rules.some((r) => r.split('{')[0].split(',').map((x) => x.trim()).includes(rival)), 'the rival exists: ' + rival);
    assert.ok(beats(mine, specificity(rival.replace(':not(', ' ').replace(')', ''))), rival);
  }
  assert.ok(feedRules.some((r) => /\[data-fit="fit"\] \.feed-card__slot > #player-wrapper #media-player\s*\{[^}]*object-fit:\s*contain/.test(r)), 'Fit letterboxes the playing video');
  assert.ok(feedRules.some((r) => /\[data-fit="fit"\] \.feed-card__poster\s*\{[^}]*object-fit:\s*contain/.test(r)), 'and its poster');
});

test('Dean 2026-10-09 ("It should not rotate when going sideways"): a player hosted in a Feed card ignores rotation, and only there', () => {
  const { rotateIgnoredForHost } = require('../../public/js/player.js');
  const cl = (...names) => ({ contains: (n) => names.includes(n) });
  assert.strictEqual(rotateIgnoredForHost(cl('feed-card__slot')), true);
  assert.strictEqual(rotateIgnoredForHost(cl('player-slot')), false);
  assert.strictEqual(rotateIgnoredForHost(null), false);
  const src = fs.readFileSync(path.join(ROOT, 'public/js/player.js'), 'utf8');
  const onRot = src.slice(src.indexOf('function onOrientationChange() {'), src.indexOf('function onOrientationChange() {') + 400);
  assert.match(onRot, /if \(state !== STATE_FULL\) return;[^\n]*\n\s*if \(rotateIgnoredForHost\(host && host\.parentElement && host\.parentElement\.classList\)\) return;/, 'the first thing a FULL rotation asks');
  const intercept = src.slice(src.indexOf("mediaPlayer.addEventListener('webkitbeginfullscreen', function () {"), src.indexOf("mediaPlayer.addEventListener('webkitbeginfullscreen', function () {") + 1600);
  assert.match(intercept, /var feedHost = rotateIgnoredForHost\(/);
  assert.match(intercept, /if \(!feedHost\) \{\s*fauxHandoffAt = Date\.now\(\);\s*setCssFullscreen\(true\);\s*\}/, 'no faux armed for a Feed card; the bounce still runs');
});
