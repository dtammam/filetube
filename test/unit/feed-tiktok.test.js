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
  // room for 3 words is below the 8-word minimum: the 20-word paragraph starts the next page whole (divergent from a split-anything rule)
  assert.deepStrictEqual(shape(feed.feedPaginate([blk(1, 22), blk(2, 20)], budget(25))), ['1:22', '2:20']);
  // room for 9: split
  assert.deepStrictEqual(shape(feed.feedPaginate([blk(1, 16), blk(2, 20)], budget(25))), ['1:16 2:9', '2:11c']);
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
      const kids = Array.from(node.children).map((c) => c.className).filter((c) => c !== 'feed-hint');
      const want = node.hasAttribute('data-media')
        ? ['feed-card__media', 'feed-card__hudspace', 'feed-card__stage', 'feed-card__touch', 'feed-card__overlay'] // W3: the gesture layer under the overlay
        : ['feed-card__media', 'feed-card__hudspace', 'feed-card__stage', 'feed-card__overlay'];
      assert.deepStrictEqual(kids, want, node.getAttribute('data-kind'));
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

test('W2 view (D6): a page box that is not laid out yet (no height) is never measured - the card keeps one page until it is', async () => {
  const r = feedRealm({ unlaidPages: true, batches: [{ cards: [PAGED_BOOK, POD, VID], exhausted: false }] });
  try {
    await startRealm(r);
    r.show(0);
    const node = r.$$('.feed-card')[0];
    assert.strictEqual(node.querySelectorAll('.feed-card__page p').length, 5, 'all five blocks on the one unmeasured page');
    assert.strictEqual(node.querySelector('[data-page-readout]').textContent, '', 'no "Page 1 of 50" from measuring a zero box');
  } finally { r.close(); }
});

// ---- W3 (D7, D8): page swipes with the edge rule, tap / hold on video ------------------------------------------------

test('W3 feedPageSwipe: left = next, right = prev; never from within 24 px of either edge, never short, never mostly vertical', () => {
  const w = 390;
  assert.strictEqual(feed.feedPageSwipe({ startX: 200, dx: -80, dy: 10, width: w }), 'next');
  assert.strictEqual(feed.feedPageSwipe({ startX: 200, dx: 80, dy: -10, width: w }), 'prev');
  assert.strictEqual(feed.feedPageSwipe({ startX: 23, dx: 120, dy: 0, width: w }), null, 'the left edge belongs to the system\'s back gesture');
  assert.strictEqual(feed.feedPageSwipe({ startX: 24, dx: 120, dy: 0, width: w }), 'prev', 'exactly 24 px in is the page\'s');
  assert.strictEqual(feed.feedPageSwipe({ startX: w - 23, dx: -120, dy: 0, width: w }), null, 'the right edge too');
  assert.strictEqual(feed.feedPageSwipe({ startX: w - 24, dx: -120, dy: 0, width: w }), 'next');
  assert.strictEqual(feed.feedPageSwipe({ startX: 200, dx: -39, dy: 0, width: w }), null, 'shorter than 40 px');
  assert.strictEqual(feed.feedPageSwipe({ startX: 200, dx: -60, dy: 41, width: w }), null, 'mostly vertical: the stack\'s');
  assert.strictEqual(feed.feedPageSwipe({ startX: 200, dx: -60, dy: 40, width: w }), 'next', '1.5 to 1 is still a page turn');
  assert.strictEqual(feed.feedPageSwipe(null), null);
  assert.strictEqual(feed.FEED_EDGE_PX, 24);
});

function pointer(r, target, type, x, y, extra) {
  const e = new r.w.Event(type, { bubbles: true, cancelable: true });
  const props = Object.assign({ clientX: x, clientY: y, pointerId: 1, isPrimary: true, button: 0 }, extra || {});
  for (const k of Object.keys(props)) Object.defineProperty(e, k, { value: props[k] });
  target.dispatchEvent(e);
}
function swipe(r, target, x0, x1) { pointer(r, target, 'pointerdown', x0, 300); pointer(r, target, 'pointerup', x1, 305); }
const readout = (r) => r.$$('.feed-card')[0].querySelector('[data-page-readout]').textContent;
const firstWords = (r) => Array.from(r.$$('.feed-card')[0].querySelectorAll('.feed-card__page p')).map((p) => p.textContent.split(' ')[0]);

test('W3 view (D7): a swipe left / right on a book card turns its page; one from the screen edge does nothing; the arrow keys turn it too', async () => {
  const r = feedRealm({ pageWords: 25, batches: [{ cards: [PAGED_BOOK, POD, VID], exhausted: false }] });
  try {
    r.w.innerWidth = 390;
    await startRealm(r);
    r.show(0);
    const stage = r.$$('.feed-card')[0].querySelector('.feed-card__stage');
    swipe(r, stage, 300, 200);
    assert.strictEqual(readout(r), 'Page 2 of 3');
    assert.deepStrictEqual(firstWords(r), ['b3w0', 'b4w0']);
    swipe(r, stage, 10, 200); // from the left edge: the system's
    assert.strictEqual(readout(r), 'Page 2 of 3');
    swipe(r, stage, 385, 200); // from the right edge
    assert.strictEqual(readout(r), 'Page 2 of 3');
    swipe(r, stage, 100, 200);
    assert.strictEqual(readout(r), 'Page 1 of 3');
    swipe(r, stage, 100, 200); // nothing before page 1
    assert.strictEqual(readout(r), 'Page 1 of 3');
    r.doc.dispatchEvent(new r.w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    assert.strictEqual(readout(r), 'Page 2 of 3');
    r.doc.dispatchEvent(new r.w.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    assert.strictEqual(readout(r), 'Page 1 of 3');
  } finally { r.close(); }
});

test('W3 view (D6 + D7): pages read in order move the place page by page; a page skipped quickly holds the place at it; all read = the card\'s next', async () => {
  const r = feedRealm({ pageWords: 25, batches: [{ cards: [PAGED_BOOK, POD, VID], exhausted: false }] });
  try {
    r.w.innerWidth = 390;
    await startRealm(r);
    r.show(0);
    const stage = r.$$('.feed-card')[0].querySelector('.feed-card__stage');
    r.advance(6000); swipe(r, stage, 300, 200); // page 1 read
    r.advance(1000); swipe(r, stage, 300, 200); // page 2 glanced at for 1 s: not read
    r.advance(9000); // page 3 read
    r.show(1); await r.settle();
    let w = r.calls('POST', '/api/feed/progress/book/bk1');
    assert.deepStrictEqual(w.map((x) => x.body), [{ spineIndex: 0, blockIndex: 3 }], 'held at page 2\'s start: a page read after an unread one moves nothing past it');
    // back to the card: page 3 is on screen (the card remembers its page); read page 2 properly, then everything is read
    r.show(0);
    swipe(r, stage, 100, 200); r.advance(6000); swipe(r, stage, 300, 200); r.advance(100);
    r.show(1); await r.settle();
    w = r.calls('POST', '/api/feed/progress/book/bk1');
    assert.deepStrictEqual(w.map((x) => x.body), [{ spineIndex: 0, blockIndex: 3 }, { spineIndex: 0, blockIndex: 6 }], 'then the card\'s next, forward only');
  } finally { r.close(); }
});

test('W3 view (D7): past the last page the next pages come from the excerpt route in CONTINUATION mode, as pages of their own; the place can then move into them', async () => {
  const more = { blocks: [6, 7].map((i) => blk(i, 10)), next: { spineIndex: 0, blockIndex: 8 }, atEnd: false, words: 20 };
  const r = feedRealm({ pageWords: 25, batches: [{ cards: [PAGED_BOOK, POD, VID], exhausted: false }], route: (m, u) => (u.indexOf('/api/books/bk1/excerpt') === 0 ? { status: 200, body: more } : null) });
  try {
    r.w.innerWidth = 390;
    await startRealm(r);
    r.show(0);
    const stage = r.$$('.feed-card')[0].querySelector('.feed-card__stage');
    for (let i = 0; i < 3; i++) { r.advance(6000); swipe(r, stage, 300, 200); }
    await r.settle();
    const gets = r.calls('GET', '/api/books/bk1/excerpt');
    assert.strictEqual(gets.length, 1);
    assert.strictEqual(gets[0].url, '/api/books/bk1/excerpt?spine=0&block=6&continuation=1', 'from the card\'s next, never re-stamping the serve');
    assert.strictEqual(readout(r), 'Page 4 of 4');
    assert.deepStrictEqual(firstWords(r), ['b6w0', 'b7w0']);
    r.advance(6000);
    r.show(1); await r.settle();
    assert.deepStrictEqual(r.calls('POST', '/api/feed/progress/book/bk1').map((x) => x.body), [{ spineIndex: 0, blockIndex: 8 }], 'every page read, the continuation\'s next');
  } finally { r.close(); }
});

function recordingPlayer(r, holdMs) {
  const seen = [];
  const p = r.w.__harness.player;
  p.pictureTap = () => seen.push('tap');
  p.holdStart = () => { seen.push('hold'); return true; };
  p.holdEnd = () => seen.push('release');
  p.gestureTimings = () => ({ holdMs: holdMs || 40, moveTol: 16 });
  return seen;
}
const wait = (ms) => new Promise((res) => setTimeout(res, ms));

test('W3 view (D8): on the playing video a tap is the player\'s picture tap; a press and hold is 2x while held (no tap); a drag is neither; a card not playing is not touched', async () => {
  const r = feedRealm({ batches: [{ cards: [VID, POD, Object.assign({}, VID, { id: 'v2' })], exhausted: false }] });
  try {
    const seen = recordingPlayer(r);
    await startRealm(r);
    r.show(0);
    const layer = r.$$('.feed-card')[0].querySelector('.feed-card__touch');
    assert.ok(layer, 'the gesture layer');
    pointer(r, layer, 'pointerdown', 200, 300); pointer(r, layer, 'pointerup', 202, 301);
    assert.deepStrictEqual(seen, ['tap']);
    pointer(r, layer, 'pointerdown', 200, 300); await wait(70); pointer(r, layer, 'pointerup', 200, 300);
    assert.deepStrictEqual(seen, ['tap', 'hold', 'release'], 'held: 2x, then released at the lift - and no tap');
    pointer(r, layer, 'pointerdown', 200, 300); pointer(r, layer, 'pointermove', 200, 340); await wait(70); pointer(r, layer, 'pointerup', 200, 340);
    assert.deepStrictEqual(seen, ['tap', 'hold', 'release'], 'a drag (a swipe) is never a tap or a hold');
    pointer(r, layer, 'pointerdown', 200, 300); await wait(70); pointer(r, layer, 'pointercancel', 200, 300);
    assert.deepStrictEqual(seen.slice(3), ['hold', 'release'], 'the browser taking the touch releases a hold');
    // the third card (another video) is not the playing one
    const other = r.$$('.feed-card')[2].querySelector('.feed-card__touch');
    pointer(r, other, 'pointerdown', 200, 300); await wait(70); pointer(r, other, 'pointerup', 200, 300);
    assert.deepStrictEqual(seen.slice(5), [], 'nothing reaches the player from a card it is not playing');
  } finally { r.close(); }
});

test('W3 view (D8): an episode or a song: a tap plays / pauses; a hold is NOT 2x', async () => {
  const r = feedRealm({ batches: [{ cards: [POD, VID], exhausted: false }] });
  try {
    const seen = recordingPlayer(r);
    await startRealm(r);
    r.show(0);
    const layer = r.$$('.feed-card')[0].querySelector('.feed-card__touch');
    pointer(r, layer, 'pointerdown', 200, 300); await wait(70); pointer(r, layer, 'pointerup', 200, 300);
    pointer(r, layer, 'pointerdown', 200, 300); pointer(r, layer, 'pointerup', 200, 300);
    assert.ok(!seen.includes('hold'), 'no hold on audio');
    assert.strictEqual(seen.filter((x) => x === 'tap').length, 2, 'a long press on audio is just a tap at the lift');
  } finally { r.close(); }
});

test('W3 view (D8): the progress line follows the slice', async () => {
  const r = feedRealm({ batches: [{ cards: [VID, POD], exhausted: false }] });
  try {
    await startRealm(r);
    r.show(0);
    r.timeAt(650); // VID slice 400..900: half
    assert.strictEqual(r.$$('.feed-card')[0].querySelector('.feed-card__progress').style.getPropertyValue('--p'), '0.5');
  } finally { r.close(); }
});

test('W3 view (D11): the first paged book card of a session says "Swipe left for the next page", on the first 3 sessions only', async () => {
  for (const [count, shown] of [[0, true], [2, true], [3, false]]) {
    const r = feedRealm({ pageWords: 25, batches: [{ cards: [VID, PAGED_BOOK, POD], exhausted: false }] });
    try {
      r.w.localStorage.setItem('ft-feed-page-hint-sessions', String(count));
      r.w.localStorage.setItem('ft-feed-hint-sessions', '3'); // the "Swipe up" cue is done on this device
      await startRealm(r);
      r.show(0); r.show(1);
      const hint = r.$('#feed-hint');
      assert.strictEqual(!!(hint && hint.hasAttribute('data-page-hint')), shown, 'count ' + count);
      if (shown) {
        assert.strictEqual(hint.textContent, 'Swipe left for the next page');
        assert.strictEqual(r.w.localStorage.getItem('ft-feed-page-hint-sessions'), String(count + 1));
      }
    } finally { r.close(); }
  }
});

test('W3 player API (D8): the Feed\'s tap and hold are the player\'s own picture machinery, not a copy', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public/js/player.js'), 'utf8');
  assert.match(src, /pictureTap: function \(\) \{ toggleArtPlayPause\('feed-tap'\); \}/);
  assert.match(src, /holdStart: function \(\) \{ engageHold\(\); return holdActive; \}/);
  assert.match(src, /holdEnd: function \(\) \{ if \(!holdActive\) return; holdGestureLive = false; releaseHold\(\); \}/);
  assert.match(src, /gestureTimings: function \(\) \{ return \{ holdMs: HOLD_MS, moveTol: MOVE_TOL \}; \}/);
  const feedSrc = fs.readFileSync(path.join(ROOT, 'public/js/feed.js'), 'utf8');
  assert.ok(!/playbackRate\s*=/.test(feedSrc), 'the Feed never sets a rate itself');
});

// ---- W4 (D9): Start over from a card's "..." - confirm, the request, New from the start, Undo ---------------------

test('W4 pure (D9): which reset a card has, and the confirm\'s sentence naming what is lost', () => {
  assert.strictEqual(feed.feedStartOverKind(VID), 'media');
  assert.strictEqual(feed.feedStartOverKind(POD), 'podcast');
  assert.strictEqual(feed.feedStartOverKind({ kind: 'watchlater', media: 'podcast', id: 'e' }), 'podcast');
  assert.strictEqual(feed.feedStartOverKind({ kind: 'watchlater', media: 'video', id: 'v' }), 'media');
  assert.strictEqual(feed.feedStartOverKind(BOOK), 'book');
  assert.strictEqual(feed.feedStartOverKind({ kind: 'book', newBook: true }), '', 'a new book has nothing to forget');
  assert.strictEqual(feed.feedStartOverKind({ kind: 'song', id: 't' }), '', 'a song keeps no place');
  assert.strictEqual(feed.feedStartOverKind(null), '');
  assert.strictEqual(feed.feedClockLong(4990), '1:23:10');
  assert.strictEqual(feed.feedClockLong(7440), '2:04:00');
  assert.strictEqual(feed.feedClockLong(65), '1:05');
  assert.strictEqual(feed.feedStartOverText({ kind: 'video', media: 'video', progress: 4990, duration: 7440 }), 'Your place, 1:23:10 of 2:04:00, will be forgotten.');
  assert.strictEqual(feed.feedStartOverText({ kind: 'podcast', media: 'podcast', position: 600, durationSec: 1800 }), 'Your place, 10:00 of 30:00, will be forgotten.');
  assert.strictEqual(feed.feedStartOverText({ kind: 'watchlater', media: 'video', progress: 30, duration: 600 }), 'Your place, 0:30 of 10:00, will be forgotten. It stays in Watch later.');
  assert.strictEqual(feed.feedStartOverText({ kind: 'video', media: 'video', progress: 0, duration: 600 }), 'It will count as not started.');
  assert.strictEqual(feed.feedStartOverText(BOOK), 'Your place in Alpha (Chapter 1 of 3) will be forgotten. It opens at the beginning next time.');
  assert.strictEqual(feed.FEED_UNDO_MS, 10000);
});

const PLACED_VID = Object.assign({}, VID, { progress: 400, fresh: false });
async function openStartOver(r, index) {
  const card = r.$$('.feed-card')[index];
  card.querySelector('[data-card-menu]').click();
  await r.settle();
  const row = Array.from(r.doc.querySelectorAll('.ui-sheet .ui-row, .ui-sheet [role="listitem"], .ui-sheet button')).find((b) => /Start over/.test(b.textContent));
  assert.ok(row, 'the menu offers Start over');
  row.click();
  await r.settle();
  const sheets = r.$$('.ui-sheet');
  const confirm = sheets[sheets.length - 1];
  assert.ok(confirm && /Start over\?/.test(confirm.textContent), 'a confirm asks');
  return confirm;
}
const okBtn = (sheet) => Array.from(sheet.querySelectorAll('.ui-confirm__actions .ui-btn')).find((b) => /Start over/.test(b.textContent));
const cancelBtn = (sheet) => Array.from(sheet.querySelectorAll('.ui-confirm__actions .ui-btn')).find((b) => /Cancel/.test(b.textContent));

function startOverRealm(cards, routes) {
  return feedRealm({
    batches: [{ cards, exhausted: false }],
    route: (m, u, body) => {
      if (u === '/api/feed/start-over') return routes.start ? routes.start(body) : { status: 200, body: { ok: true, token: 'a'.repeat(24), previous: {} } };
      if (u === '/api/feed/start-over/undo') return routes.undo ? routes.undo(body) : { status: 200, body: { ok: true } };
      return null;
    },
  });
}

test('W4 view (D9): "..." > Start over > a confirm naming the place; Cancel sends nothing', async () => {
  const r = startOverRealm([PLACED_VID, POD], {});
  try {
    await startRealm(r);
    r.show(0);
    const sheet = await openStartOver(r, 0);
    assert.ok(/Your place, 6:40 of 20:00, will be forgotten\./.test(sheet.textContent));
    cancelBtn(sheet).click(); await r.settle();
    assert.strictEqual(r.calls('POST', '/api/feed/start-over').length, 0);
  } finally { r.close(); }
});

test('W4 view (D9): a confirmed Start over sends ONE request for THIS card; the card says New and plays again from 0; Undo (10 s) puts the card back exactly', async () => {
  const r = startOverRealm([PLACED_VID, POD], {});
  try {
    await startRealm(r);
    r.show(0);
    const loads0 = r.loads.filter((l) => l.id === 'v1').length;
    const sheet = await openStartOver(r, 0);
    okBtn(sheet).click(); okBtn(sheet).click(); await r.settle();
    const posts = r.calls('POST', '/api/feed/start-over');
    assert.strictEqual(posts.length, 1, 'one request, however many taps');
    assert.deepStrictEqual(posts[0].body, { session: 'abcdef0123456789', kind: 'media', id: 'v1' });
    const node = r.$$('.feed-card')[0];
    assert.strictEqual(node.querySelector('.feed-card__kind').textContent, 'Video · New from C');
    const reload = r.loads.filter((l) => l.id === 'v1');
    assert.strictEqual(reload.length, loads0 + 1, 'the card plays again');
    assert.strictEqual(reload[reload.length - 1].data.startAt, 0, 'from the start');
    assert.strictEqual(typeof reload[reload.length - 1].data.progressGate, 'function', 'as a NEW card: the one-minute rule guards its writes');
    const ti = r.toasts.indexOf('Started over: V');
    assert.ok(ti >= 0, 'a toast says so');
    const opts = r.w.__toastOpts[ti];
    assert.strictEqual(opts.duration, 10000);
    assert.strictEqual(opts.action.label, 'Undo');
    opts.action.onAction(); await r.settle();
    assert.deepStrictEqual(r.calls('POST', '/api/feed/start-over/undo').map((c) => c.body), [{ session: 'abcdef0123456789', token: 'a'.repeat(24) }]);
    assert.strictEqual(node.querySelector('.feed-card__kind').textContent, 'Video · Continue');
    const back = r.loads.filter((l) => l.id === 'v1');
    assert.strictEqual(back[back.length - 1].data.startAt, 400, 'back at its place');
    assert.strictEqual(back[back.length - 1].data.progressGate, undefined, 'and a continuing card again');
  } finally { r.close(); }
});

test('W4 view (D9): refusals are said in words - nothing to start over, an Undo after the item was played elsewhere', async () => {
  const r = startOverRealm([PLACED_VID, POD], { start: () => ({ status: 409, body: { ok: false, reason: 'nothing' } }) });
  try {
    await startRealm(r); r.show(0);
    okBtn(await openStartOver(r, 0)).click(); await r.settle();
    assert.ok(r.toasts.includes('Nothing to start over: it was not started'));
    assert.strictEqual(r.$$('.feed-card')[0].querySelector('.feed-card__kind').textContent, 'Video · Continue', 'the card is unchanged');
  } finally { r.close(); }
  const r2 = startOverRealm([PLACED_VID, POD], { undo: () => ({ status: 409, body: { ok: false, reason: 'moved' } }) });
  try {
    await startRealm(r2); r2.show(0);
    okBtn(await openStartOver(r2, 0)).click(); await r2.settle();
    r2.w.__toastOpts[r2.toasts.indexOf('Started over: V')].action.onAction(); await r2.settle();
    assert.ok(r2.toasts.includes('Could not undo: it was played since'), 'and no promise of a record the user cannot open (gate r1, adversary W1)');
    assert.strictEqual(r2.$$('.feed-card')[0].querySelector('.feed-card__kind').textContent, 'Video · New from C', 'the card stays started over');
  } finally { r2.close(); }
});

test('W4 view (D9): a book card started over says so and never moves the place again (its pages read or not)', async () => {
  const r = startOverRealm([PAGED_BOOK, POD, VID], {});
  try {
    r.w.innerWidth = 390;
    await startRealm(r); r.show(0);
    okBtn(await openStartOver(r, 0)).click(); await r.settle();
    assert.deepStrictEqual(r.calls('POST', '/api/feed/start-over')[0].body, { session: 'abcdef0123456789', kind: 'book', id: 'bk1' });
    const node = r.$$('.feed-card')[0];
    assert.strictEqual(node.querySelector('.feed-card__kind').textContent, 'Book · Started over');
    r.advance(30000);
    r.show(1); await r.settle();
    assert.strictEqual(r.calls('POST', '/api/feed/progress/book/bk1').length, 0, 'a read page after a Start over moves nothing');
  } finally { r.close(); }
});

test('W4 view (D9): no "..." on a song or a new book; the menu on every other kind', async () => {
  const NEW = Object.assign({}, BOOK, { id: 'nb', newBook: true, blocks: [] });
  const SONG = { kind: 'song', id: 't1', track: { id: 't1', title: 'S', artist: 'A' } };
  const r = startOverRealm([SONG, NEW, PLACED_VID, POD, BOOK], {});
  try {
    await startRealm(r);
    const has = r.$$('.feed-card').map((n) => n.getAttribute('data-kind') + (n.hasAttribute('data-new-book') ? ':new' : '') + '=' + !!n.querySelector('[data-card-menu]'));
    assert.deepStrictEqual(has.slice(0, 5), ['song=false', 'book:new=false', 'video=true', 'podcast=true', 'book=true']);
  } finally { r.close(); }
});

test('W4 view (D9): the card under an open confirm changed (the session ended, a new one began) - the confirm resets NOTHING', async () => {
  const OTHER = Object.assign({}, VID, { id: 'v9', title: 'Other', progress: 300, fresh: false });
  let phase = 'first';
  let firstServed = false;
  const r = feedRealm({
    batches: [{ cards: [], exhausted: false }],
    route: (m, u) => {
      if (u === '/api/feed/start-over') return { status: 200, body: { ok: true, token: 'b'.repeat(24), previous: {} } };
      if (u.indexOf('/api/feed?') !== 0) return null;
      if (phase === 'gone') return { status: 404, body: { error: 'no such session' } };
      if (phase === 'second') return { status: 200, body: { cards: [JSON.parse(JSON.stringify(OTHER)), JSON.parse(JSON.stringify(POD))], exhausted: false } };
      if (firstServed) return { status: 200, body: { cards: [], exhausted: false } };
      firstServed = true;
      return { status: 200, body: { cards: [JSON.parse(JSON.stringify(PLACED_VID)), JSON.parse(JSON.stringify(POD))], exhausted: false } };
    },
  });
  try {
    await startRealm(r); r.show(0);
    const sheet = await openStartOver(r, 0);
    const ok = okBtn(sheet);
    // the server forgets the session (a restart): the next batch is a 404 and the view resets to the picker
    phase = 'gone';
    r.show(1); await r.settle();
    assert.strictEqual(r.$('#feed-session').hidden, true, 'back at the picker');
    // a new session puts a DIFFERENT card at index 0
    phase = 'second';
    r.$('#feed-picker-choices button[data-minutes="10"]').click(); await r.settle();
    assert.strictEqual(r.$$('.feed-card')[0].getAttribute('data-id'), 'v9', 'a new card sits where the old one was');
    ok.click(); await r.settle();
    assert.strictEqual(r.calls('POST', '/api/feed/start-over').length, 0, 'the confirm was for v1, which is gone: nothing is reset');
  } finally { r.close(); }
});

test('W4 the Feed\'s toasts pass the real (message, opts) signature: no "[object Object]" on a device', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public/js/feed.js'), 'utf8');
  assert.ok(!/U\(\)\.toast\(\{/.test(src), 'no toast called with one object');
  assert.match(src, /function toast\(text, opts\) \{ var u = U\(\); return u \? u\.toast\(String\(text\), Object\.assign\(\{ doc: document \}, opts \|\| \{\}\)\) : null; \}/);
});

// ---- gate r1 fix round ---------------------------------------------------------------------------------------------

test('r1 (qa W1, adversary W1): Undo tapped AFTER leaving the Feed still reaches the server, with the session the reset ran in', async () => {
  const r = startOverRealm([PLACED_VID, POD], {});
  try {
    await startRealm(r); r.show(0);
    okBtn(await openStartOver(r, 0)).click(); await r.settle();
    const opts = r.w.__toastOpts[r.toasts.indexOf('Started over: V')];
    r.destroy(); // the router leaves the Feed: the view's signal aborts (the harness's fetch now rejects on it, as the platform's does)
    opts.action.onAction(); await r.settle();
    assert.deepStrictEqual(r.calls('POST', '/api/feed/start-over/undo').map((c) => c.body), [{ session: 'abcdef0123456789', token: 'a'.repeat(24) }], 'the Undo the user tapped was sent');
    assert.ok(r.toasts.includes('Your place is back: V'), 'and it says so');
    assert.ok(!r.toasts.includes('Could not undo'));
  } finally { r.close(); }
});

test('r1 (adversary W1): Undo tapped after the session ended and a NEW one began sends the reset\'s own session, not the new one', async () => {
  const r = startOverRealm([PLACED_VID, POD], {});
  try {
    await startRealm(r); r.show(0);
    okBtn(await openStartOver(r, 0)).click(); await r.settle();
    const opts = r.w.__toastOpts[r.toasts.indexOf('Started over: V')];
    r.$('#feed-done-btn').click(); await r.settle();
    const done = r.$('#feed-recap-done'); if (done) { done.click(); await r.settle(); }
    r.$('#feed-picker-choices button[data-minutes="10"]').click(); await r.settle();
    opts.action.onAction(); await r.settle();
    const undos = r.calls('POST', '/api/feed/start-over/undo');
    assert.strictEqual(undos.length, 1);
    assert.strictEqual(undos[0].body.session, 'abcdef0123456789');
  } finally { r.close(); }
});

test('r1 (adversary W4): the toast names the place the SERVER forgot (its previous), which can differ from the card\'s', () => {
  assert.strictEqual(feed.feedStartedOverText({ title: 'V' }, { progress: { timestamp: 4990, duration: 7440 } }), 'Started over: V (it was at 1:23:10)');
  assert.strictEqual(feed.feedStartedOverText({ title: 'Ep' }, { progress: { position: 600 } }), 'Started over: Ep (it was at 10:00)');
  assert.strictEqual(feed.feedStartedOverText({ title: 'Book' }, { progress: { locator: {} } }), 'Started over: Book');
  assert.strictEqual(feed.feedStartedOverText({ title: 'V' }, { progress: null, watchedAt: 'x' }), 'Started over: V');
});

// a long paged book: 5 blocks laid into 3 pages of 25 words, a continuation of 2 more blocks (one page)
const MORE = { blocks: [6, 7].map((i) => blk(i, 10)), next: { spineIndex: 0, blockIndex: 8 }, atEnd: false, words: 20 };
function prunableRealm(extra) {
  const SONG2 = { kind: 'song', id: 't9', track: { id: 't9', title: 'S', artist: 'A' } };
  return feedRealm(Object.assign({ pageWords: 25, batches: [{ cards: [PAGED_BOOK, POD, VID, SONG2, Object.assign({}, VID, { id: 'v3' }), Object.assign({}, POD, { id: 'e3' })], exhausted: false }], route: (m, u) => (u.indexOf('/api/books/bk1/excerpt') === 0 ? { status: 200, body: MORE } : null) }, extra || {}));
}

test('r1 (qa W2): a book card rebuilt after it was pruned keeps its continuation pages and its reads - the place never jumps past unread text', async () => {
  const r = prunableRealm();
  try {
    r.w.innerWidth = 390;
    await startRealm(r); r.show(0);
    const stage = () => r.$$('.feed-card')[0].querySelector('.feed-card__stage');
    for (let i = 0; i < 3; i++) { r.advance(6000); swipe(r, stage(), 300, 200); }
    await r.settle();
    assert.strictEqual(readout(r), 'Page 4 of 4', 'the continuation is page 4');
    r.advance(500); // a glance at page 4: not read
    for (let i = 1; i <= 4; i++) { r.show(i); await r.settle(); }
    assert.ok(r.$$('.feed-card')[0].hasAttribute('data-pruned'), 'card 0 was pruned');
    r.show(0); await r.settle();
    assert.strictEqual(readout(r), 'Page 4 of 4', 'rebuilt with ALL its pages, on the page the reader was on');
    r.show(1); await r.settle();
    assert.deepStrictEqual(r.calls('POST', '/api/feed/progress/book/bk1').map((c) => c.body), [{ spineIndex: 0, blockIndex: 6 }], 'only up to the unread page 4, never its end (0,8)');
  } finally { r.close(); }
});

test('r1 (qa W4 M13): a resize re-lays the pages and keeps what was read as a place - the old read marks never cover new, unseen text', async () => {
  const r = feedRealm({ pageWords: 25, batches: [{ cards: [PAGED_BOOK, POD, VID], exhausted: false }] });
  try {
    r.w.innerWidth = 390;
    await startRealm(r); r.show(0);
    r.advance(6000); // page 1 (blocks 1-2) read
    r.w.__pageWords = 50; // the phone turns: a bigger box, pages of 50 words
    r.w.dispatchEvent(new r.w.Event('resize'));
    await new Promise((res) => setTimeout(res, 200));
    assert.strictEqual(readout(r), '', 'one page now holds all five blocks');
    r.advance(100); // the new, bigger page is barely looked at
    r.show(1); await r.settle();
    assert.deepStrictEqual(r.calls('POST', '/api/feed/progress/book/bk1').map((c) => c.body), [{ spineIndex: 0, blockIndex: 3 }], 'the place read before the turn, not the card\'s end');
  } finally { r.close(); }
});

test('r1 (adversary suggestion): a book card that was started over stays so when rebuilt after pruning - no "..." again, never a write', async () => {
  const r = prunableRealm({ route: (m, u) => (u === '/api/feed/start-over' ? { status: 200, body: { ok: true, token: 'c'.repeat(24), previous: {} } } : null) });
  try {
    r.w.innerWidth = 390;
    await startRealm(r); r.show(0);
    okBtn(await openStartOver(r, 0)).click(); await r.settle();
    for (let i = 1; i <= 4; i++) { r.show(i); await r.settle(); }
    r.show(0); await r.settle();
    const node = r.$$('.feed-card')[0];
    assert.strictEqual(node.querySelector('.feed-card__kind').textContent, 'Book · Started over');
    assert.strictEqual(node.querySelector('[data-card-menu]'), null);
    assert.strictEqual(readout(r), 'Opens at the beginning next time');
    r.advance(30000); r.show(1); await r.settle();
    assert.strictEqual(r.calls('POST', '/api/feed/progress/book/bk1').length, 0);
  } finally { r.close(); }
});

test('r1 (adversary W3 C11): a continuation reply that lands after the session was replaced touches nothing on the new card', async () => {
  let release = null;
  const r = feedRealm({ pageWords: 25, batches: [{ cards: [PAGED_BOOK, POD, VID], exhausted: false }] });
  const f = r.w.fetch;
  r.w.fetch = (u, init) => (String(u).indexOf('/api/books/bk1/excerpt') === 0
    ? new Promise((res) => { release = () => res({ ok: true, status: 200, json: async () => MORE }); })
    : f(u, init));
  try {
    r.w.innerWidth = 390;
    await startRealm(r); r.show(0);
    const stage = () => r.$$('.feed-card')[0].querySelector('.feed-card__stage');
    for (let i = 0; i < 3; i++) { r.advance(6000); swipe(r, stage(), 300, 200); }
    await r.settle();
    assert.ok(release, 'the continuation is in flight');
    r.$('#feed-done-btn').click(); await r.settle();
    const done = r.$('#feed-recap-done'); if (done) { done.click(); await r.settle(); }
    r.$('#feed-picker-choices button[data-minutes="10"]').click(); await r.settle();
    r.show(0); await r.settle();
    assert.strictEqual(readout(r), 'Page 1 of 3', 'a new session, the same book, page 1');
    release(); await r.settle();
    assert.strictEqual(readout(r), 'Page 1 of 3', 'the old reply did not turn the new card');
  } finally { r.close(); }
});

test('r1 (adversary W3 C6): feedBookTarget - only "The end." left unread means every real page was read: the card\'s end', () => {
  const end = { atEnd: true };
  const pages = [[blk(1, 10)], [blk(2, 10)], [{ spineIndex: -1, blockIndex: -1, text: 'The end.', end: true }]];
  assert.deepStrictEqual(feed.feedBookTarget(pages, { 0: true, 1: true }, end), end);
  assert.deepStrictEqual(feed.feedBookTarget(pages, { 0: true }, end), { spineIndex: 0, blockIndex: 2 });
});

test('r1 (adversary suggestion): past FEED_MAX_PAGES the blocks that were never laid out are never passed - every page read moves nothing past them', async () => {
  const LONG = Object.assign({}, PAGED_BOOK, { blocks: Array.from({ length: 45 }, (_, i) => blk(i + 1, 10)), words: 450, next: { spineIndex: 0, blockIndex: 46 } });
  const r = feedRealm({ pageWords: 1, batches: [{ cards: [LONG, POD, VID], exhausted: false }] });
  try {
    r.w.innerWidth = 390;
    await startRealm(r); r.show(0);
    assert.strictEqual(readout(r), 'Page 1 of ' + feed.FEED_MAX_PAGES, 'cut at the cap');
    const stage = () => r.$$('.feed-card')[0].querySelector('.feed-card__stage');
    for (let i = 0; i < feed.FEED_MAX_PAGES; i++) { r.advance(6000); swipe(r, stage(), 300, 200); }
    r.advance(6000);
    r.show(1); await r.settle();
    const w = r.calls('POST', '/api/feed/progress/book/bk1').map((c) => c.body);
    assert.ok(!w.some((b) => b.blockIndex === 46), 'never the card\'s next: ' + JSON.stringify(w));
    assert.strictEqual(r.calls('GET', '/api/books/bk1/excerpt').length, 0, 'and no continuation past a cut card');
  } finally { r.close(); }
});

test('r1 (qa S2, adversary G5): the video layer cancels a touchmove ONLY while 2x is held - any other touch keeps scrolling the stack', async () => {
  const r = feedRealm({ batches: [{ cards: [VID, POD], exhausted: false }] });
  try {
    recordingPlayer(r);
    await startRealm(r); r.show(0);
    const layer = r.$$('.feed-card')[0].querySelector('.feed-card__touch');
    const move = () => { const e = new r.w.Event('touchmove', { bubbles: true, cancelable: true }); layer.dispatchEvent(e); return e.defaultPrevented; };
    pointer(r, layer, 'pointerdown', 200, 300);
    assert.strictEqual(move(), false, 'before the hold: a swipe scrolls');
    await wait(70);
    assert.strictEqual(move(), true, 'while 2x is held: the stack stays put');
    pointer(r, layer, 'pointerup', 200, 300);
    assert.strictEqual(move(), false, 'after the lift: scrolls again');
  } finally { r.close(); }
});
