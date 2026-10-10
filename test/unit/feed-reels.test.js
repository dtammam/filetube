'use strict';

// [UNIT] v1.383.0 Feed reels and speed (plan docs/exec-plans/active/2026-10-10-feed-reels.md). W1: the book bugs and the Start
// over hardening, through the REAL feed view in jsdom (test/helpers/feed-view-harness.js) and the real lib parsers:
//   K3 a  a book card that started over shows the reset pages (the server's `reset`) at once, and Undo puts the pages it showed
//         back - on the page it was on
//   K3 b  the chapter-start divider and the meta line name the chapter as the BOOK does (the server's chapterLabel), never by
//         spine position; the table-of-contents parsers (nav toc, NCX) are bounded and keep document order
//   K7 c  the Start over confirm names the STORED place (read just before it opens), not the card's served copy

const { test } = require('node:test');
const assert = require('node:assert');
const { feedRealm, BOOK, POD, VID } = require('../helpers/feed-view-harness');
const feed = require('../../public/js/feed.js');
const opf = require('../../lib/books/opf');

const blk = (i, n, extra) => Object.assign({ spineIndex: 7, blockIndex: i, text: Array.from({ length: n }, (_, k) => `b${i}w${k}`).join(' '), heading: false, chapterStart: false }, extra || {});
// a reading book at chapter III: 5 blocks of 10 words lay into pages of 25 words: ['1:10 2:10', '3:10 4:10', '5:10']
const READING = Object.assign({}, BOOK, { chapterLabel: 'Chapter III', blocks: [1, 2, 3, 4, 5].map((i) => blk(i, 10)), words: 50, dwellSec: 10, next: { spineIndex: 7, blockIndex: 6 } });
// what the server answers a book Start over with: the first real chapter's opening (spine 5, the book's chapter I)
const RESET = { start: { spineIndex: 5, blockIndex: 0 }, chapterLabel: 'Chapter I', blocks: [{ spineIndex: 5, blockIndex: 0, text: 'I', heading: true, chapterStart: true, chapterLabel: 'Chapter I' }, { spineIndex: 5, blockIndex: 1, text: 'r1 r2 r3 r4 r5 r6 r7 r8', heading: false, chapterStart: false }], words: 9, next: { spineIndex: 5, blockIndex: 2 }, atEnd: false };
const PLACED_VID = Object.assign({}, VID, { progress: 400, fresh: false });

async function startRealm(r) { r.init(); await r.settle(); r.$('#feed-picker-choices button[data-minutes="10"]').click(); await r.settle(); }
const okBtn = (sheet) => Array.from(sheet.querySelectorAll('.ui-confirm__actions .ui-btn')).find((b) => /Start over/.test(b.textContent));
function realm(cards, routes, extra) {
  return feedRealm(Object.assign({
    batches: [{ cards, exhausted: false }],
    route: (m, u, body) => {
      if (u === '/api/feed/start-over') return routes.start ? routes.start(body) : { status: 200, body: { ok: true, token: 'a'.repeat(24), previous: {} } };
      if (u === '/api/feed/start-over/undo') return routes.undo ? routes.undo(body) : { status: 200, body: { ok: true } };
      if (u.indexOf('/api/feed/start-over/place?') === 0) return routes.place ? routes.place(u) : { status: 200, body: { ok: true, nothing: false, sec: 400, chapterLabel: 'Chapter III' } };
      return null;
    },
  }, extra || {}));
}
async function openMenuRow(r, index, rx) {
  r.$$('.feed-card')[index].querySelector('[data-card-menu]').click();
  await r.settle();
  const sheets = r.$$('.ui-sheet');
  const row = Array.from(sheets[sheets.length - 1].querySelectorAll('.ui-row, [role="listitem"], button')).find((b) => rx.test(b.textContent));
  assert.ok(row, 'the menu offers ' + rx);
  row.click();
  await r.settle();
}
const lastSheet = (r) => { const s = r.$$('.ui-sheet'); return s[s.length - 1]; };
const pageWords = (node) => Array.from(node.querySelectorAll('.feed-card__page p, .feed-card__page h3')).map((p) => p.textContent.split(' ')[0]);
const pressRight = (r) => r.doc.dispatchEvent(new r.w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

// ---- K3 a --------------------------------------------------------------------------------------------------------------------

test('K3 a: a book card started over shows the reset pages AT ONCE (the first real chapter, its name in the meta line); Undo puts back the pages it showed, on the page it was on', async () => {
  const r = realm([READING, POD, VID], { start: () => ({ status: 200, body: { ok: true, token: 'a'.repeat(24), previous: {}, reset: RESET } }) }, { pageWords: 25 });
  try {
    r.w.innerWidth = 390;
    await startRealm(r); r.show(0);
    const node = r.$$('.feed-card')[0];
    pressRight(r); await r.settle();
    assert.deepStrictEqual(pageWords(node), ['b3w0', 'b4w0'], 'on page 2 of the old place');
    assert.strictEqual(node.querySelector('.feed-card__overlay .feed-card__meta').textContent, 'W · Chapter III');
    await openMenuRow(r, 0, /Start over/);
    okBtn(lastSheet(r)).click(); await r.settle();
    assert.deepStrictEqual(pageWords(node), ['I', 'r1'], 'the card\'s first block is now the first real chapter\'s');
    assert.strictEqual(node.querySelector('.feed-card__chapter-start'), null, 'a heading block draws no divider over itself');
    assert.strictEqual(node.querySelector('.feed-card__overlay .feed-card__meta').textContent, 'W · Chapter I');
    assert.strictEqual(node.querySelector('.feed-card__kind').textContent, 'Book · Started over');
    assert.strictEqual(node.querySelector('[data-page-readout]').textContent, 'Opens at the beginning next time');
    // Undo: the pages it showed, on the page it was on
    r.w.__toastOpts[r.toasts.indexOf('Started over: Alpha')].action.onAction(); await r.settle();
    assert.deepStrictEqual(pageWords(node), ['b3w0', 'b4w0'], 'back on page 2 of the old place');
    assert.strictEqual(node.querySelector('.feed-card__overlay .feed-card__meta').textContent, 'W · Chapter III');
    assert.strictEqual(node.querySelector('.feed-card__kind').textContent, 'Book');
    pressRight(r); await r.settle();
    assert.deepStrictEqual(pageWords(node), ['b5w0'], 'the old pages, all of them');
    r.advance(30000); r.show(1); await r.settle();
    assert.strictEqual(r.calls('POST', '/api/feed/progress/book/bk1').length, 0, 'a started-over card writes nothing, after Undo too (its serve was forgotten)');
  } finally { r.close(); }
});

test('K3 a: a Start over answer WITHOUT reset pages (an unreadable file) leaves the pages and still says it started over', async () => {
  const r = realm([READING, POD, VID], {}, { pageWords: 25 });
  try {
    await startRealm(r); r.show(0);
    const node = r.$$('.feed-card')[0];
    await openMenuRow(r, 0, /Start over/);
    okBtn(lastSheet(r)).click(); await r.settle();
    assert.deepStrictEqual(pageWords(node), ['b1w0', 'b2w0']);
    assert.strictEqual(node.querySelector('.feed-card__kind').textContent, 'Book · Started over');
  } finally { r.close(); }
});

test('K3 a: a started-over book card that is pruned and rebuilt shows the reset pages (laid out again, never an empty page)', async () => {
  const r = realm([READING, POD, VID, Object.assign({}, POD, { id: 'ep2' }), Object.assign({}, VID, { id: 'v2' }), Object.assign({}, POD, { id: 'ep3' })], { start: () => ({ status: 200, body: { ok: true, token: 'a'.repeat(24), previous: {}, reset: RESET } }) }, { pageWords: 25 });
  try {
    await startRealm(r); r.show(0);
    await openMenuRow(r, 0, /Start over/);
    okBtn(lastSheet(r)).click(); await r.settle();
    r.show(5); await r.settle();
    assert.ok(r.$$('.feed-card')[0].hasAttribute('data-pruned'), 'pruned');
    r.show(1); await r.settle();
    assert.deepStrictEqual(pageWords(r.$$('.feed-card')[0]), ['I', 'r1']);
  } finally { r.close(); }
});

// ---- K3 b --------------------------------------------------------------------------------------------------------------------

test('K3 b: the chapter-start divider draws the book\'s own name (chapterLabel), never "Chapter <spine + 1>"; no name, no divider', async () => {
  const card = Object.assign({}, BOOK, { chapterLabel: 'Chapter I', blocks: [{ spineIndex: 5, blockIndex: 3, text: 'Mid-chapter text.', heading: false, chapterStart: false }, { spineIndex: 6, blockIndex: 0, text: 'A new chapter opens.', heading: false, chapterStart: true, chapterLabel: 'Chapter II' }, { spineIndex: 7, blockIndex: 0, text: 'Unnamed.', heading: false, chapterStart: true }] });
  const r = realm([card, POD], {});
  try {
    await startRealm(r); r.show(0);
    const dividers = Array.from(r.$$('.feed-card')[0].querySelectorAll('.feed-card__chapter-start')).map((d) => d.textContent);
    assert.deepStrictEqual(dividers, ['Chapter II'], 'was ["Chapter 7", "Chapter 8"]');
  } finally { r.close(); }
});

test('K3 b: feedBookMeta joins the author and the chapter name, either alone when the other is empty', () => {
  assert.strictEqual(feed.feedBookMeta({ author: 'W', chapterLabel: 'Prologue' }), 'W · Prologue');
  assert.strictEqual(feed.feedBookMeta({ author: 'W', chapterLabel: '' }), 'W', 'front matter: no trailing dot');
  assert.strictEqual(feed.feedBookMeta({ author: '', chapterLabel: 'Chapter I' }), 'Chapter I');
  assert.strictEqual(feed.feedBookMeta(null), '');
});

test('K3 b: parseNavToc reads the toc nav (not landmarks) in document order, hrefs resolved against the nav, fragments dropped, labels plain', () => {
  const nav = '<html><body><nav epub:type="landmarks"><ol><li><a href="x.xhtml" epub:type="bodymatter">Body</a></li></ol></nav>'
    + '<nav epub:type="toc" id="toc"><ol><li><a href="text/one.xhtml#s1"><span>Chapter</span> <b>One</b> &amp; more</a><ol><li><a href="text/one.xhtml#s2">Part</a></li></ol></li><li><a href="../two.xhtml">Two</a></li></ol></nav></body></html>';
  assert.deepStrictEqual(opf.parseNavToc(nav, 'OEBPS/nav/nav.xhtml'), [
    { href: 'OEBPS/nav/text/one.xhtml', label: 'Chapter One & more' },
    { href: 'OEBPS/nav/text/one.xhtml', label: 'Part' },
    { href: 'OEBPS/two.xhtml', label: 'Two' },
  ]);
  assert.deepStrictEqual(opf.parseNavToc('<nav epub:type="landmarks"><a href="a">A</a></nav>', 'n.xhtml'), [], 'no toc nav');
  assert.deepStrictEqual(opf.parseNavToc('', 'n'), []);
  assert.strictEqual(opf.parseNavToc('<nav epub:type="toc"><a href="a.xhtml">' + 'x'.repeat(300) + '</a></nav>', 'n')[0].label.length, opf.TOC_LABEL_MAX_CHARS + 1, 'a long label is capped (plus the ellipsis)');
});

test('K3 b: parseNcxToc reads each navPoint\'s OWN label and content (a parent before its children), bounded', () => {
  const ncx = '<ncx><navMap><navPoint id="a"><navLabel><text>Part One</text></navLabel><content src="Text/p1.xhtml"/>'
    + '<navPoint id="b"><navLabel><text>1. The Ferry</text></navLabel><content src="Text/c1.xhtml#c1"/></navPoint></navPoint>'
    + '<navPoint id="c"><navLabel><text>Broken</text></navLabel></navPoint>'
    + '<navPoint id="d"><navLabel><text>2.</text></navLabel><content src="Text/c2.xhtml"/></navPoint></navMap></ncx>';
  assert.deepStrictEqual(opf.parseNcxToc(ncx, 'OEBPS/toc.ncx'), [
    { href: 'OEBPS/Text/p1.xhtml', label: 'Part One' },
    { href: 'OEBPS/Text/c1.xhtml', label: '1. The Ferry' },
    { href: 'OEBPS/Text/c2.xhtml', label: '2.' },
  ], 'a point with no content is skipped, never given its child\'s src');
  // hostile input stays linear (each shape once rescanned the rest of the document per tag: quadratic): unclosed points, anchors
  // with no '>', anchors with no '</a>', points with no label - a full 256 KB each, then a quarter of it: the time must scale ~4x,
  // never ~16x
  const shapes = [(n) => '<navPoint>'.repeat(n / 10), (n) => '<nav epub:type="toc">' + '<a '.repeat(n / 3), (n) => '<nav epub:type="toc">' + '<a href="x">'.repeat(n / 12), (n) => '<navPoint><content src="a"/>'.repeat(n / 27)];
  for (const make of shapes) {
    const big = make(262144);
    const small = make(65536);
    const time = (input) => { const t = process.hrtime.bigint(); opf.parseNcxToc(input, 'x'); opf.parseNavToc(input, 'x'); return Number(process.hrtime.bigint() - t) / 1e6; };
    time(small); // warm
    const tBig = time(big);
    assert.ok(tBig < 400, 'a full-size hostile document parses fast: ' + tBig.toFixed(1) + ' ms');
  }
});

test('K3 b: parseOpf finds the NCX by the spine\'s toc id, else by its media type', () => {
  const man = (extra) => `<package><manifest><item id="n1" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="c" href="c.xhtml" media-type="application/xhtml+xml"/>${extra}</manifest><spine SPINE><itemref idref="c"/></spine></package>`;
  assert.strictEqual(opf.parseOpf(man('<item id="alt" href="other.ncx" media-type="application/x-dtbncx+xml"/>').replace('SPINE', 'toc="alt"'), 'OEBPS/content.opf').ncxEntryName, 'OEBPS/other.ncx');
  assert.strictEqual(opf.parseOpf(man('').replace('SPINE', ''), 'OEBPS/content.opf').ncxEntryName, 'OEBPS/toc.ncx');
  assert.strictEqual(opf.parseOpf('<package><manifest></manifest><spine></spine></package>', 'a.opf').ncxEntryName, null);
});

// ---- K7 c --------------------------------------------------------------------------------------------------------------------

test('K7 c: the confirm names the STORED place read just before it opens - another device\'s newer place, not the card\'s served one', async () => {
  const asked = [];
  const r = realm([PLACED_VID, READING], { place: (u) => { asked.push(u); return { status: 200, body: { ok: true, nothing: false, sec: u.indexOf('kind=media') > 0 ? 900 : 0, chapterLabel: u.indexOf('kind=book') > 0 ? 'Chapter IV' : undefined } }; } });
  try {
    await startRealm(r); r.show(0);
    await openMenuRow(r, 0, /Start over/);
    assert.deepStrictEqual(asked, ['/api/feed/start-over/place?kind=media&id=v1']);
    assert.ok(/Your place, 15:00 of 20:00, will be forgotten\./.test(lastSheet(r).textContent), 'the stored 15:00, not the card\'s 6:40: ' + lastSheet(r).textContent);
    Array.from(lastSheet(r).querySelectorAll('.ui-confirm__actions .ui-btn')).find((b) => /Cancel/.test(b.textContent)).click(); await r.settle();
    assert.strictEqual(r.calls('POST', '/api/feed/start-over').length, 0);
    r.show(1); await r.settle();
    await openMenuRow(r, 1, /Start over/);
    assert.ok(/Your place in Alpha \(Chapter IV\) will be forgotten/.test(lastSheet(r).textContent), 'the stored chapter, not the card\'s III: ' + lastSheet(r).textContent);
  } finally { r.close(); }
});

test('K7 c: a stored place with nothing to forget is said without a confirm; a failed read still asks, naming only the item', async () => {
  const r = realm([PLACED_VID, POD], { place: () => ({ status: 200, body: { ok: true, nothing: true, sec: 0 } }) });
  try {
    await startRealm(r); r.show(0);
    await openMenuRow(r, 0, /Start over/);
    assert.ok(r.toasts.includes('Nothing to start over: it was not started'));
    assert.ok(!r.$$('.ui-sheet').some((s) => /Start over\?/.test(s.textContent)), 'no confirm');
    assert.strictEqual(r.calls('POST', '/api/feed/start-over').length, 0);
  } finally { r.close(); }
  const r2 = realm([PLACED_VID, POD], { place: () => ({ status: 500, body: {} }) });
  try {
    await startRealm(r2); r2.show(0);
    await openMenuRow(r2, 0, /Start over/);
    const text = lastSheet(r2).textContent;
    assert.ok(/Start over\?/.test(text) && /Your place will be forgotten\./.test(text), text);
    assert.ok(!/6:40/.test(text), 'never the card\'s served place');
  } finally { r2.close(); }
});

test('K7 c: feedStartOverText reads the stored place when given one, and names nothing but the item when the read failed (null)', () => {
  const vid = { kind: 'video', media: 'video', title: 'V', progress: 400, duration: 1200 };
  assert.strictEqual(feed.feedStartOverText(vid), 'Your place, 6:40 of 20:00, will be forgotten.');
  assert.strictEqual(feed.feedStartOverText(vid, { sec: 61 }), 'Your place, 1:01 of 20:00, will be forgotten.');
  assert.strictEqual(feed.feedStartOverText(vid, null), 'Your place will be forgotten.');
  assert.strictEqual(feed.feedStartOverText(Object.assign({}, vid, { kind: 'watchlater' }), null), 'Your place will be forgotten. It stays in Watch later.');
  const pod = { kind: 'podcast', media: 'podcast', title: 'P', position: 30, durationSec: 600 };
  assert.strictEqual(feed.feedStartOverText(pod, { sec: 0 }), 'It will count as not started.');
  assert.strictEqual(feed.feedStartOverText({ kind: 'book', title: 'B', chapterLabel: 'Chapter I' }, { chapterLabel: '' }), 'Your place in B will be forgotten. It opens at the beginning next time.', 'the stored place\'s chapter, even when it has none');
});

// ==== W2 ======================================================================================================================
const { SONG } = require('../helpers/feed-view-harness');
const waitMs = (ms) => new Promise((res) => setTimeout(res, ms));
const advanceBtn = (r, i) => r.$$('.feed-card')[i].querySelector('[data-advance]');
function flowRealm(cards, extra) { return feedRealm(Object.assign({ batches: [{ cards, exhausted: false }] }, extra || {})); }

// ---- K1 auto-advance -------------------------------------------------------------------------------------------------------

test('K1: a video card that reaches its Done state shows "Next in 2" and then scrolls (smoothly) to the next card', async () => {
  const r = flowRealm([VID, POD, VID]);
  try {
    await startRealm(r); r.show(0);
    r.timeAt(500);
    assert.strictEqual(advanceBtn(r, 0), null, 'not before Done');
    r.timeAt(900); await r.settle(2);
    const btn = advanceBtn(r, 0);
    assert.ok(btn, 'the countdown shows');
    assert.ok(/Next in 2/.test(btn.textContent));
    assert.strictEqual(r.w.__scrolledInto, undefined, 'nothing moves yet');
    await waitMs(1150);
    assert.ok(/Next in 1/.test(advanceBtn(r, 0).textContent), 'it counts down');
    await waitMs(1000);
    assert.strictEqual(r.w.__scrolledInto, r.$$('.feed-card')[1], 'to the next card');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(r.w.__scrolledArg)), { behavior: 'smooth', block: 'start' }, 'the same snap a swipe ends in');
    assert.strictEqual(advanceBtn(r, 0), null, 'the countdown is gone');
  } finally { r.close(); }
});

test('K1: a touch anywhere on the card during the countdown cancels it, and the card stays (a later end does not start it again)', async () => {
  const r = flowRealm([VID, POD]);
  try {
    await startRealm(r); r.show(0);
    r.timeAt(900); await r.settle(2);
    assert.ok(advanceBtn(r, 0));
    const ev = new r.w.Event('pointerdown', { bubbles: true }); ev.pointerId = 1;
    r.$$('.feed-card')[0].querySelector('.feed-card__overlay').dispatchEvent(ev);
    assert.strictEqual(advanceBtn(r, 0), null, 'cancelled at once');
    r.media.dispatchEvent(new r.w.Event('ended')); await r.settle(2);
    assert.strictEqual(advanceBtn(r, 0), null, 'stays until swiped');
    await waitMs(2200);
    assert.strictEqual(r.w.__scrolledInto, undefined, 'never moved');
  } finally { r.close(); }
});

test('K1: the countdown\'s own button keeps the card too (a keyboard\'s way); moving on by hand ends a running countdown', async () => {
  const r = flowRealm([VID, POD, Object.assign({}, POD, { id: 'ep2' })]);
  try {
    await startRealm(r); r.show(0);
    r.timeAt(900); await r.settle(2);
    advanceBtn(r, 0).click();
    assert.strictEqual(advanceBtn(r, 0), null);
    assert.ok(r.$$('.feed-card')[0].hasAttribute('data-advance-stay'));
    // card 1 (podcast) done, then swiped by hand before the 2 s
    r.show(1); await r.settle();
    r.timeAt(840); await r.settle(2);
    assert.ok(advanceBtn(r, 1), 'the episode counts down');
    r.show(2); await r.settle();
    assert.strictEqual(advanceBtn(r, 1), null, 'gone with the swipe');
    r.w.__scrolledInto = undefined;
    await waitMs(2200);
    assert.strictEqual(r.w.__scrolledInto, undefined, 'and it never fires after');
  } finally { r.close(); }
});

test('K1: a song that ends counts down; a book card never does; Auto-advance off: never', async () => {
  const r = flowRealm([SONG, BOOK, POD]);
  try {
    await startRealm(r); r.show(0);
    r.media.dispatchEvent(new r.w.Event('ended')); await r.settle(2);
    assert.ok(advanceBtn(r, 0), 'a song');
    r.show(1); await r.settle();
    r.media.dispatchEvent(new r.w.Event('ended')); await r.settle(2);
    assert.strictEqual(r.$('[data-advance]'), null, 'never on a book card');
  } finally { r.close(); }
  const r2 = flowRealm([VID, POD]);
  try {
    r2.w.localStorage.setItem('ft-feed-settings', '{"advance":false}');
    await startRealm(r2); r2.show(0);
    r2.timeAt(900); await r2.settle(2);
    assert.strictEqual(advanceBtn(r2, 0), null, 'switched off');
  } finally { r2.close(); }
});

test('K1 pure: feedAdvanceDue - media cards with the setting on, never a book, a notice or during the wind-down', () => {
  for (const c of [VID, POD, SONG, Object.assign({}, VID, { kind: 'watchlater' })]) assert.strictEqual(feed.feedAdvanceDue(c, { advance: true }, false), true, c.kind);
  assert.strictEqual(feed.feedAdvanceDue(VID, null, false), true, 'no reading: the default (on)');
  assert.strictEqual(feed.feedAdvanceDue(BOOK, { advance: true }, false), false);
  assert.strictEqual(feed.feedAdvanceDue({ kind: 'notice' }, { advance: true }, false), false);
  assert.strictEqual(feed.feedAdvanceDue(VID, { advance: true }, true), false, 'the wind-down: the recap opens instead');
  assert.strictEqual(feed.feedAdvanceDue(VID, { advance: false }, false), false);
});

test('K1: during the wind-down a Done card opens the recap, never the countdown', async () => {
  const r = flowRealm([VID, POD], { startedAt: new Date(Date.now() - 11 * 60000).toISOString() });
  try {
    await startRealm(r); r.show(0);
    r.tickIntervals(); // time is up: winding down
    r.timeAt(900); await r.settle(4);
    assert.strictEqual(advanceBtn(r, 0), null);
    assert.ok(r.calls('POST', '/api/feed/sessions/abcdef0123456789/finish').length >= 1, 'the session finished (the recap)');
  } finally { r.close(); }
});

// ---- K4 a way to the full item at any time ------------------------------------------------------------------------------

test('K4: the title, the channel / show line and the open button each take the card to the full item mid-slice - once, never a play / pause or a like', async () => {
  for (const which of ['title', 'meta', 'button']) {
    const r = flowRealm([VID, POD]);
    try {
      const taps = [];
      r.w.__harness.player.pictureTap = () => taps.push('tap');
      await startRealm(r); r.show(0);
      r.timeAt(500);
      const node = r.$$('.feed-card')[0];
      const target = which === 'title' ? node.querySelector('.feed-card__title') : which === 'meta' ? node.querySelector('.feed-card__overlay .feed-card__meta') : node.querySelector('[data-open-full]');
      assert.ok(target, which);
      target.click(); target.click();
      await r.settle();
      const navs = r.loads.filter((l) => l.navigate);
      assert.deepStrictEqual(navs.map((l) => l.navigate), ['/watch.html?v=v1'], which + ': one exit to the full item');
      assert.strictEqual(r.calls('POST', '/api/feed/sessions/abcdef0123456789/finish').length, 1, which + ': the session ends as Done would');
      assert.ok(!r.loads.some((l) => l.pause || l.close), which + ': the player is carried over, never paused or closed');
      await waitMs(400);
      assert.deepStrictEqual(taps, [], which + ': never a play / pause');
      assert.strictEqual(r.calls('POST', '/api/liked/').length, 0, which + ': never a like');
    } finally { r.close(); }
  }
});

test('K4: a podcast opens in the podcast player, a song in Music; the open button is a named button; a book card keeps Open in reader (no open button)', async () => {
  const r = flowRealm([POD, SONG, BOOK]);
  try {
    await startRealm(r); r.show(0);
    const btn = r.$$('.feed-card')[0].querySelector('[data-open-full]');
    assert.strictEqual(btn.tagName, 'BUTTON');
    assert.strictEqual(btn.getAttribute('aria-label'), 'Open the full item');
    assert.ok(r.$$('.feed-card')[1].querySelector('[data-open-full]'), 'a song has one');
    assert.strictEqual(r.$$('.feed-card')[2].querySelector('[data-open-full]'), null, 'a book card has none');
    assert.strictEqual(r.$$('.feed-card')[2].querySelector('.feed-card__title').hasAttribute('data-open'), false);
    btn.click(); await r.settle();
    assert.deepStrictEqual(r.loads.filter((l) => l.navigate).map((l) => l.navigate), ['/podcasts?play=ep1']);
  } finally { r.close(); }
  const r2 = flowRealm([SONG, POD]);
  try {
    await startRealm(r2); r2.show(0);
    r2.$$('.feed-card')[0].querySelector('.feed-card__title').click(); await r2.settle();
    assert.deepStrictEqual(r2.loads.filter((l) => l.navigate).map((l) => l.navigate), ['/music?play=t1']);
  } finally { r2.close(); }
});

// ---- K2 b the early load ----------------------------------------------------------------------------------------------------

test('K2 b pure: feedNextActive - the next card from a quarter on screen, the active one holds while a quarter of it shows, a spring-back returns', () => {
  const R = (pairs) => pairs.map(([index, ratio]) => ({ index, ratio }));
  assert.strictEqual(feed.feedNextActive(R([[0, 1]]), -1), 0, 'the first card');
  assert.strictEqual(feed.feedNextActive(R([[0, 1], [1, 0]]), 0), -1, 'at rest: nothing changes');
  assert.strictEqual(feed.feedNextActive(R([[0, 0.8], [1, 0.2]]), 0), -1, 'a fifth of the next: not yet');
  assert.strictEqual(feed.feedNextActive(R([[0, 0.75], [1, 0.25]]), 0), 1, 'a quarter of the next: it loads now (was at 60%)');
  assert.strictEqual(feed.feedNextActive(R([[0, 0.7], [1, 0.3]]), 1), -1, 'the old card (70% on screen) does not take it straight back');
  assert.strictEqual(feed.feedNextActive(R([[0, 0.85], [1, 0.15]]), 1), 0, 'a swipe that springs back: the old card again');
  assert.strictEqual(feed.feedNextActive(R([[1, 0.2], [2, 0.8]]), 1), 2, 'past the active one: the best card at 60%');
  assert.strictEqual(feed.feedNextActive(R([[1, 0.2], [0, 0.5]]), 1), -1, 'the active card under a quarter but nothing at 60% yet: keep');
  assert.strictEqual(feed.feedNextActive(R([[2, 0.3], [1, 0.7]]), 2), -1, 'backwards the previous card waits for 60% (the old rule) once the active one is under a quarter');
  assert.strictEqual(feed.feedNextActive([], 3), -1);
});

test('K2 b: the next card starts loading at a quarter on screen; a spring-back returns to the first card, which plays on from where it was (not its slice start)', async () => {
  const r = flowRealm([VID, POD]);
  try {
    await startRealm(r); r.show(0);
    r.timeAt(450);
    const ob = r.observers[r.observers.length - 1];
    const fire = (pairs) => ob.cb(pairs.map(([i, ratio]) => ({ target: r.$$('.feed-card')[i], isIntersecting: ratio > 0, intersectionRatio: ratio })));
    fire([[0, 0.74], [1, 0.26]]);
    await r.settle(2);
    const podLoads = r.loads.filter((l) => l.id === 'ep1');
    assert.strictEqual(podLoads.length, 1, 'the episode loads at a quarter on screen');
    fire([[0, 0.88], [1, 0.12]]);
    await r.settle(2);
    const vLoads = r.loads.filter((l) => l.id === 'v1');
    assert.strictEqual(vLoads.length, 2, 'back to the video');
    assert.strictEqual(vLoads[1].data.startAt, 450, 'from where it was left (it said 400, its slice start)');
  } finally { r.close(); }
});

// ---- K2 a warming the next card --------------------------------------------------------------------------------------------

test('K2 a: the next card is warmed when a card becomes active - its first bytes by ONE range request and its art; only one card ahead, once', async () => {
  const r = flowRealm([VID, POD, SONG, Object.assign({}, VID, { id: 'v9' })]);
  try {
    await startRealm(r); r.show(0); await r.settle();
    const ranged = () => r.fetches.filter((f) => f.headers && f.headers.Range);
    assert.deepStrictEqual(ranged().map((f) => [f.url, f.headers.Range]), [['/episode/ep1', 'bytes=0-262143']], 'the next card (the episode) only');
    r.show(0); await r.settle();
    assert.strictEqual(ranged().length, 1, 'once');
    r.show(1); await r.settle();
    assert.deepStrictEqual(ranged().map((f) => f.url), ['/episode/ep1', '/track/t1'], 'then the card after it - still one ahead');
    assert.ok(!r.fetches.some((f) => f.url === '/video/v9'), 'never two ahead');
    assert.ok(!r.loads.some((l) => l.id === 't1'), 'a warmed card is never loaded into the player before it is active');
  } finally { r.close(); }
});

test('K2 a: a file that needs a transcode is never warmed (it would queue the transcode); a next book card is laid out into pages ahead', async () => {
  const r = flowRealm([POD, Object.assign({}, VID, { transcode: true }), POD]);
  try {
    await startRealm(r); r.show(0); await r.settle();
    assert.strictEqual(r.fetches.filter((f) => f.headers && f.headers.Range).length, 0);
  } finally { r.close(); }
  const r2 = flowRealm([POD, READING], { pageWords: 25 });
  try {
    await startRealm(r2); r2.show(0); await r2.settle();
    assert.strictEqual(r2.$$('.feed-card')[1].querySelector('[data-page-readout]').textContent, 'Page 1 of 3', 'the next book card is already in fitted pages');
  } finally { r2.close(); }
});

test('K2 a pure: feedStreamUrl is the URL the shared player loads for each kind; none for a transcode or a book', () => {
  assert.strictEqual(feed.feedStreamUrl(VID), '/video/v1');
  assert.strictEqual(feed.feedStreamUrl(Object.assign({}, VID, { media: 'audio', id: 'a b' })), '/video/a%20b');
  assert.strictEqual(feed.feedStreamUrl(POD), '/episode/ep1');
  assert.strictEqual(feed.feedStreamUrl(SONG), '/track/t1');
  assert.strictEqual(feed.feedStreamUrl(Object.assign({}, SONG, { track: { streamSrc: '/x' } })), '/x');
  assert.strictEqual(feed.feedStreamUrl(Object.assign({}, VID, { transcode: true })), '');
  assert.strictEqual(feed.feedStreamUrl(BOOK), '');
  assert.strictEqual(feed.feedPlayerDescriptor(SONG).streamSrc, feed.feedStreamUrl(SONG), 'the same URL the song card plays');
  assert.strictEqual(feed.feedPlayerDescriptor(POD).streamSrc, feed.feedStreamUrl(POD), 'the same URL the episode card plays');
});

test('a media card reached by a jump of more than three cards (still pruned) is rebuilt BEFORE it plays - it loads into its own slot', async () => {
  const cards = [VID, POD, Object.assign({}, POD, { id: 'ep2' }), Object.assign({}, POD, { id: 'ep3' }), Object.assign({}, POD, { id: 'ep4' }), Object.assign({}, POD, { id: 'ep5' })];
  const r = flowRealm(cards);
  try {
    await startRealm(r); r.show(0); r.show(5); await r.settle();
    assert.ok(r.$$('.feed-card')[0].hasAttribute('data-pruned'), 'card 0 is pruned');
    r.show(0); await r.settle();
    const last = r.loads.filter((l) => l.id === 'v1').pop();
    assert.ok(last && last.lo && last.lo.slot && r.$$('.feed-card')[0].contains(last.lo.slot), 'loaded into the rebuilt card\'s slot');
  } finally { r.close(); }
});

// ==== W3 song reels (K5) ======================================================================================================
const { songClipFor } = require('../../lib/feed/api');
const CLIP = Object.assign({}, SONG, { track: Object.assign({}, SONG.track, { durationSec: 200 }), startAt: 66.7, endAt: 111.7, clipSec: 45 });
const WHOLE = Object.assign({}, SONG, { id: 't2', track: Object.assign({}, SONG.track, { id: 't2', durationSec: 200 }) });
const playsOf = (r) => r.calls('POST', '/api/music/plays').map((c) => c.body.id + ' ' + c.body.kind);
const playFrom = (r, from, to, step) => { for (let t = from; t <= to + 1e-9; t += (step || 0.5)) r.timeAt(Math.round(t * 10) / 10); };

test('K5 pure: songClipFor - the clip from a third in, moved earlier to end before the song; a song no longer than the clip, Whole song or no length: none', () => {
  assert.deepStrictEqual(songClipFor(200, 45), { startAt: 66.7, endAt: 111.7 });
  assert.deepStrictEqual(songClipFor(60, 45), { startAt: 15, endAt: 60 }, 'a third in (20 s) would run past the end: moved to 15 s');
  assert.strictEqual(songClipFor(45, 45), null, 'no longer than the clip: the whole song');
  assert.strictEqual(songClipFor(200, 0), null, 'Whole song');
  assert.strictEqual(songClipFor(0, 45), null, 'unknown length');
  assert.strictEqual(songClipFor(NaN, 30), null);
});

test('K5 pure: a clip counts ONE play when heard to its end and never a skip or a finish; a seek to its end is not hearing it', () => {
  const st = feed.feedSongTally(45);
  for (let t = 66.7; t <= 111.7; t += 0.5) assert.deepStrictEqual(feed.feedSongTick(st, t, 0, 200), [], 'a clip never counts on the way');
  assert.deepStrictEqual(feed.feedSongEnd(st), ['play']);
  assert.deepStrictEqual(feed.feedSongEnd(st), [], 'once');
  assert.deepStrictEqual(feed.feedSongLeave(st), [], 'never a skip');
  const seek = feed.feedSongTally(45);
  feed.feedSongTick(seek, 66.7, 0, 200); feed.feedSongTick(seek, 110, 0, 200); feed.feedSongTick(seek, 111.7, 0, 200);
  assert.deepStrictEqual(feed.feedSongEnd(seek), [], 'a jump to the end: not heard');
  const early = feed.feedSongTally(45);
  for (let t = 66.7; t <= 80; t += 0.5) feed.feedSongTick(early, t, 0, 200);
  assert.deepStrictEqual(feed.feedSongLeave(early), [], 'a clip swiped past at 13 s: not a skip (a reel is not a rejection)');
});

test('K5 pure: a WHOLE song counts by Music\'s rules - a play at 30 s, a finish in its last 5 %, a skip only when swiped past after 3 s heard and before the play', () => {
  const st = feed.feedSongTally(0);
  const got = [];
  for (let t = 0; t <= 200; t += 1) got.push(...feed.feedSongTick(st, t, 0, 200));
  assert.deepStrictEqual(got, ['play', 'finish']);
  assert.deepStrictEqual(feed.feedSongEnd(st), [], 'the end after a finish adds nothing');
  const skip = feed.feedSongTally(0);
  for (let t = 0; t <= 10; t += 1) feed.feedSongTick(skip, t, 0, 200);
  assert.deepStrictEqual(feed.feedSongLeave(skip), ['skip']);
  const glimpse = feed.feedSongTally(0);
  for (let t = 0; t <= 2; t += 0.5) feed.feedSongTick(glimpse, t, 0, 200);
  assert.deepStrictEqual(feed.feedSongLeave(glimpse), [], 'a 2 s glimpse during a swipe that sprang back: not a skip');
  const short = feed.feedSongTally(0);
  const s2 = [];
  for (let t = 0; t <= 20; t += 1) s2.push(...feed.feedSongTick(short, t, 0, 40));
  assert.deepStrictEqual(s2, ['play'], 'half of a 40 s song');
});

test('K5: a song clip card plays from its start a third in, says how long, never saves the song\'s place, and counts ONE play heard to its end; Keep listening opens the song in Music', async () => {
  const r = flowRealm([CLIP, POD]);
  try {
    let released = 0;
    r.w.FileTube.musicPlayCountRelease = () => { released += 1; };
    await startRealm(r); r.show(0);
    const load = r.loads.filter((l) => l.id === 't1').pop();
    assert.strictEqual(load.data.startAt, 66.7, 'from a third in');
    assert.strictEqual(load.data.progressGate(), false, 'a clip never moves the song\'s saved place');
    assert.ok(released >= 1, 'Music\'s tally was let go before the load');
    assert.ok(/0:45 of this song/.test(r.$$('.feed-card')[0].textContent));
    playFrom(r, 66.7, 111.7);
    await r.settle(2);
    assert.deepStrictEqual(playsOf(r), ['t1 play'], 'heard to its end: one play');
    assert.ok(r.$$('.feed-card')[0].hasAttribute('data-done'), 'the clip ends at its end (Done)');
    const keep = r.$$('.feed-card')[0].querySelector('[data-keep]');
    assert.ok(keep && /Keep listening/.test(keep.textContent));
    keep.click(); await r.settle();
    assert.deepStrictEqual(r.loads.filter((l) => l.navigate).map((l) => l.navigate), ['/music?play=t1'], 'the whole song in Music');
  } finally { r.close(); }
});

test('K5: a clip swiped past early counts nothing (never a skip); a whole song swiped past after 3 s is a skip, a glimpse is not', async () => {
  const r = flowRealm([CLIP, WHOLE, POD, Object.assign({}, WHOLE, { id: 't3' })]);
  try {
    await startRealm(r); r.show(0);
    playFrom(r, 66.7, 80);
    r.show(1); await r.settle();
    assert.deepStrictEqual(playsOf(r), [], 'the clip: nothing');
    playFrom(r, 0, 6);
    r.show(2); await r.settle();
    assert.deepStrictEqual(playsOf(r), ['t2 skip'], 'the whole song: a skip');
    r.show(3); await r.settle();
    playFrom(r, 0, 1.5);
    r.show(2); await r.settle();
    assert.deepStrictEqual(playsOf(r), ['t2 skip'], 'a glimpse of t3: nothing');
  } finally { r.close(); }
});

// ==== W4 music while reading (K6) =============================================================================================
const TRACKS = [1, 2, 3, 4, 5, 6].map((i) => ({ id: 'm' + i, title: 'Tune ' + i, artist: 'Band ' + i, durationSec: 90 + i * 3, liked: false }));
function musicRealm(cards, o) {
  const opts = o || {};
  const radio = [];
  const r = feedRealm(Object.assign({
    batches: [{ cards, exhausted: false }],
    route: (m, u) => {
      if (u === '/api/music/stations') return { status: 200, body: { stations: opts.stations || [{ key: 'favorites', name: 'Favorites' }, { key: 's:lofi', name: 'Lofi' }, { key: 's:jazz', name: 'Jazz', hidden: true }] } };
      if (u.indexOf('/api/music/radio?') === 0) { radio.push(u); const n = radio.length - 1; const k = opts.batch || 5; return { status: 200, body: { items: opts.empty ? [] : TRACKS.slice(n * k, n * k + k) } }; }
      return null;
    },
  }, opts.realm || {}));
  r.radio = radio;
  return r;
}
const songLoads = (r) => r.loads.filter((l) => l.id && /^m\d$/.test(l.id));
const chip = (r, i) => r.$$('.feed-card')[i].querySelector('[data-music-chip]');

test('K6 pure: the station - the chosen one when the viewer can see it, else the first of Chill / Lofi / Jazz / Ambient / Favorites they have; a hidden one never; none: no music', () => {
  const FSm = require('../../public/js/feed-settings.js');
  const st = (keys) => keys.map((k) => ({ key: k, name: k }));
  assert.strictEqual(feed.feedMusicStation(st(['favorites', 's:jazz', 's:lofi']), '', FSm.MUSIC_STATION_ORDER), 's:lofi', 'Lofi before Jazz before Favorites');
  assert.strictEqual(feed.feedMusicStation(st(['favorites', 's:chill']), '', FSm.MUSIC_STATION_ORDER), 's:chill');
  assert.strictEqual(feed.feedMusicStation(st(['favorites']), '', FSm.MUSIC_STATION_ORDER), 'favorites', 'the liked songs (Favorites) last');
  assert.strictEqual(feed.feedMusicStation(st(['favorites', 'c:abc']), 'c:abc', FSm.MUSIC_STATION_ORDER), 'c:abc', 'the chosen one');
  assert.strictEqual(feed.feedMusicStation(st(['favorites']), 'c:gone', FSm.MUSIC_STATION_ORDER), 'favorites', 'a chosen one that is gone falls back');
  assert.strictEqual(feed.feedMusicStation([{ key: 's:lofi', hidden: true }, { key: 'favorites' }], 's:lofi', FSm.MUSIC_STATION_ORDER), 'favorites', 'a hidden station never');
  assert.strictEqual(feed.feedMusicStation([], '', FSm.MUSIC_STATION_ORDER), '');
  assert.strictEqual(feed.feedMusicStartSec(90), 30);
  assert.strictEqual(feed.feedMusicStartSec(0), 0);
  assert.strictEqual(feed.feedMusicChipText({ title: 'T', artist: 'A' }), 'T · A');
});

test('K6: a book card plays a song from the station a third in, from the Feed\'s hidden slot, with a chip naming it; it plays on across page turns and the next book card; never a saved place, never a count', async () => {
  const BOOK2 = Object.assign({}, READING, { id: 'bk2', title: 'Beta' });
  const r = musicRealm([READING, BOOK2, VID], { realm: { pageWords: 25 } });
  try {
    let released = 0;
    r.w.FileTube.musicPlayCountRelease = () => { released += 1; };
    await startRealm(r); r.show(0); await r.settle();
    assert.strictEqual(r.radio.length, 1);
    assert.ok(/seed=station%3As%3Alofi/.test(r.radio[0]), 'Lofi (Jazz is hidden; Lofi comes before Favorites): ' + r.radio[0]);
    const loads = songLoads(r);
    assert.strictEqual(loads.length, 1);
    assert.strictEqual(loads[0].id, 'm1');
    assert.strictEqual(loads[0].data.startAt, 31, 'a third into the 93 s song');
    assert.strictEqual(loads[0].data.progressGate(), false, 'never a saved place');
    assert.ok(loads[0].lo.slot.classList.contains('feed-music-slot') && loads[0].lo.slot.hidden, 'the Feed\'s hidden slot (a book card has no media)');
    assert.ok(released >= 1, 'Music\'s tally let go: never a count');
    assert.ok(/Tune 1 · Band 1/.test(chip(r, 0).textContent), 'the chip');
    pressRight(r); await r.settle();
    r.show(1); await r.settle();
    assert.strictEqual(songLoads(r).length, 1, 'page turns and the next book card: the same song plays on');
    assert.strictEqual(chip(r, 0), null);
    assert.ok(chip(r, 1), 'the chip moved to the active book card');
    assert.strictEqual(r.calls('POST', '/api/music/plays').length, 0, 'nothing counted');
    // the song ends: the next one from the station
    r.media.dispatchEvent(new r.w.Event('ended')); await r.settle();
    assert.deepStrictEqual(songLoads(r).map((l) => l.id), ['m1', 'm2']);
    assert.ok(/Tune 2/.test(chip(r, 1).textContent));
    assert.strictEqual(r.calls('POST', '/api/music/plays').length, 0, 'an ended song under a book is not a play or a finish');
  } finally { r.close(); }
});

test('K6: a non-book card stops the music (a video\'s load replaces it, the chip is gone); back on a book card a NEW song comes (the session\'s songs are sent as plays, never repeated)', async () => {
  const r = musicRealm([READING, VID, Object.assign({}, READING, { id: 'bk3' })], { realm: { pageWords: 25 } });
  try {
    await startRealm(r); r.show(0); await r.settle();
    r.show(1); await r.settle();
    assert.strictEqual(r.$('[data-music-chip]'), null, 'no chip on a video');
    assert.strictEqual(r.loads[r.loads.length - 1].id, 'v1', 'the video plays');
    r.show(2); await r.settle();
    assert.deepStrictEqual(songLoads(r).map((l) => l.id), ['m1', 'm2'], 'the queue\'s next song, not m1 again');
  } finally { r.close(); }
});

test('K6: Music while reading off - no music, no station read; Mute music stops it for the rest of the session (a reload of the view keeps it muted)', async () => {
  const r = musicRealm([READING, POD]);
  try {
    r.w.localStorage.setItem('ft-feed-settings', '{"music":false}');
    await startRealm(r); r.show(0); await r.settle();
    assert.strictEqual(songLoads(r).length, 0);
    assert.ok(!r.fetches.some((f) => f.url === '/api/music/stations'), 'not even the station list');
  } finally { r.close(); }
  const r2 = musicRealm([READING, POD, Object.assign({}, READING, { id: 'bk9' })]);
  try {
    await startRealm(r2); r2.show(0); await r2.settle();
    chip(r2, 0).click(); await r2.settle();
    const sheets = r2.$$('.ui-sheet');
    const mute = Array.from(sheets[sheets.length - 1].querySelectorAll('.ui-row, [role="listitem"], button')).find((b) => /^Mute music$/.test(b.textContent.trim()));
    assert.ok(mute, 'the sheet offers Mute');
    assert.ok(Array.from(sheets[sheets.length - 1].querySelectorAll('.ui-row, [role="listitem"], button')).some((b) => /Like the song/.test(b.textContent)), 'and Like');
    mute.click(); await r2.settle();
    assert.ok(r2.loads.some((l) => l.pause), 'paused now');
    assert.strictEqual(r2.$('[data-music-chip]'), null);
    assert.ok(r2.toasts.includes('Music off for this session'));
    assert.strictEqual(JSON.parse(r2.w.sessionStorage.getItem('ft-feed-session')).musicMuted, true, 'kept with the session');
    r2.show(1); await r2.settle(); r2.show(2); await r2.settle();
    assert.strictEqual(songLoads(r2).length, 1, 'no music on the next book card');
  } finally { r2.close(); }
});

test('K6: no station the viewer has - no music and no chip; leaving the Feed with music playing closes the player (it never follows the user out)', async () => {
  const r = musicRealm([READING, POD], { stations: [] });
  try {
    await startRealm(r); r.show(0); await r.settle();
    assert.strictEqual(songLoads(r).length, 0);
    assert.strictEqual(r.$('[data-music-chip]'), null);
    assert.strictEqual(r.radio.length, 0);
  } finally { r.close(); }
  const r2 = musicRealm([READING, POD]);
  try {
    await startRealm(r2); r2.show(0); await r2.settle();
    assert.strictEqual(songLoads(r2).length, 1);
    r2.destroy(); await r2.settle();
    assert.ok(r2.loads.some((l) => l.close), 'closed with the view');
  } finally { r2.close(); }
});

test('K6: Change station writes the synced setting and plays from the new station at once; Like the song uses music\'s own route', async () => {
  const r = musicRealm([READING, POD]);
  try {
    await startRealm(r); r.show(0); await r.settle();
    chip(r, 0).click(); await r.settle();
    let sheets = r.$$('.ui-sheet');
    Array.from(sheets[sheets.length - 1].querySelectorAll('.ui-row, [role="listitem"], button')).find((b) => /Like the song/.test(b.textContent)).click();
    await r.settle();
    assert.deepStrictEqual(r.calls('POST', '/api/music/liked/').map((c) => c.url), ['/api/music/liked/m1']);
    chip(r, 0).click(); await r.settle();
    sheets = r.$$('.ui-sheet');
    Array.from(sheets[sheets.length - 1].querySelectorAll('.ui-row, [role="listitem"], button')).find((b) => /Change station/.test(b.textContent)).click();
    await r.settle();
    sheets = r.$$('.ui-sheet');
    Array.from(sheets[sheets.length - 1].querySelectorAll('.ui-row, [role="listitem"], button')).find((b) => /^Favorites$/.test(b.textContent.trim())).click();
    await r.settle();
    assert.strictEqual(JSON.parse(r.w.localStorage.getItem('ft-feed-settings')).station, 'favorites', 'the synced setting');
    assert.ok(/seed=station%3Afavorites/.test(r.radio[r.radio.length - 1]), 'the new station\'s batch');
    assert.strictEqual(songLoads(r).length, 2, 'a song from it plays now');
  } finally { r.close(); }
});

test('K6: a swipe off the book card before the station answers never starts the song over the next card', async () => {
  const r = musicRealm([VID, READING, POD]);
  try {
    await startRealm(r); // the video card is active (the realm activates the first card)
    r.show(1); r.show(2); // the book card, then the episode, in the same turn: the station is still being asked
    await r.settle();
    assert.ok(r.fetches.some((f) => f.url === '/api/music/stations'), 'the book card did ask for its music');
    assert.strictEqual(songLoads(r).length, 0, 'no song loaded over the episode');
    assert.strictEqual(r.loads.filter((l) => l.id).pop().id, 'ep1', 'the episode is what plays');
  } finally { r.close(); }
});

test('K6: the next batch of the station is told what this session played (exclude) and what is still queued, so a song is never repeated', async () => {
  const r = musicRealm([READING, POD], { batch: 2 });
  try {
    await startRealm(r); r.show(0); await r.settle();
    assert.strictEqual(r.radio.length, 1);
    r.media.dispatchEvent(new r.w.Event('ended')); await r.settle(); // m2 from the queue
    r.media.dispatchEvent(new r.w.Event('ended')); await r.settle(); // the queue is empty: a new batch
    assert.strictEqual(r.radio.length, 2);
    assert.ok(/[?&]exclude=m1,m2(&|$)/.test(r.radio[1]), 'the session\'s songs as plays: ' + r.radio[1]);
    assert.deepStrictEqual(songLoads(r).map((l) => l.id), ['m1', 'm2', 'm3']);
  } finally { r.close(); }
});

test('K6: book, another card, book again in one turn - only the LAST ask for music plays (a stale answer is dropped): one song, never two', async () => {
  const r = musicRealm([VID, READING, POD, Object.assign({}, READING, { id: 'bk4' })]);
  try {
    await startRealm(r);
    r.show(1); r.show(2); r.show(3);
    await r.settle();
    assert.deepStrictEqual(songLoads(r).map((l) => l.id), ['m1'], 'one song for the book card that is active');
  } finally { r.close(); }
});
