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
  // hostile input stays linear: 200 KB of unclosed points
  const t0 = Date.now();
  opf.parseNcxToc('<navPoint>'.repeat(20000), 'x');
  opf.parseNavToc('<nav epub:type="toc">' + '<a '.repeat(60000), 'x');
  assert.ok(Date.now() - t0 < 2000, 'bounded: ' + (Date.now() - t0) + ' ms');
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
