'use strict';

// [UNIT] UI pass sweep S3 - the watch page on the primitives, driven through the REAL view
// (watch.html + ui.js + common.js + main.js + watch.js in jsdom, test/helpers/watch-view-harness.js).
// Converts (AC12, replacements in this commit) watch-action-bar-nowrap, watch-action-row-tiers,
// watch-action-bar-container-query, era-row-overflow (the v1.25-v1.253 flex-row locks: the row
// is ONE line of equal stacked columns now, measured by test/geometry/watch.check.js in every
// era) and uploader-subs-badge (F43: the count is a ui-chip--meta, never a button-shaped badge).
//   D4.9  the action bar: stacked plain ui-btns in the fixed order Like, Share, Listen,
//         Transcript, More; Share / Transcript only when the item has a link / captions; the
//         Like toggle (stable label stack, favorite / favorite.fill, never red); "Copied!" is
//         a toast; More is ONE ui.menu of every other verb, built from the live state;
//   D4.9  the channel row: ui-avatar lg, the name over a ui-chip--meta count, Subscribe
//         (primary) / Subscribed (secondary) pill, the bell (reserved until subscribed), Pin;
//   D8.1  fabricated stats (a mock view count, a mock subscriber count, the stars, the mock
//         commenters) carry .ft-fabricated; real ones never do;
//   D8.4  About this file: collapsed, opens to Size / Type / Location (+ Copy) and the tags;
//         no self-hosting paragraph, no monospace, no bold labels.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { watchViewRealm, VIDEO } = require('../helpers/watch-view-harness');

const REPO = path.join(__dirname, '..', '..');
const HTML = fs.readFileSync(path.join(REPO, 'public/watch.html'), 'utf8');
const VIEW = HTML.slice(HTML.indexOf('id="view-root"'), HTML.indexOf('id="player-host-template"'));
const CSS = fs.readFileSync(path.join(REPO, 'public/css/style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const W = require('../../public/js/watch.js');

async function mounted(opts) {
  const r = watchViewRealm(opts);
  r.init();
  await r.settle(20);
  return r;
}
const barIds = (r) => Array.from(r.doc.querySelectorAll('#watch-actions > .ui-btn')).map((b) => b.id);

// ---- the action bar ------------------------------------------------------------------

test('D4.9: the bar is stacked plain ui-btns in the order Like, Share, Listen, Transcript, More, revealed once (data-loading dropped)', async () => {
  const r = await mounted();
  try {
    assert.deepStrictEqual(barIds(r), ['like-media-btn', 'share-media-btn', 'listen-media-btn', 'transcript-media-btn', 'more-actions-btn']);
    for (const b of r.doc.querySelectorAll('#watch-actions > .ui-btn')) {
      for (const c of ['ui-btn--plain', 'ui-btn--stack']) assert.ok(b.classList.contains(c), b.id + ' ' + c);
      assert.ok(b.querySelector('.ui-btn__icon > svg.ui-icon use'), b.id + ' draws a registry glyph');
      assert.ok(b.querySelector('.ui-btn__label').textContent.trim(), b.id + ' has its caption');
    }
    assert.strictEqual(r.$('#watch-actions').hasAttribute('data-loading'), false, 'revealed');
    assert.deepStrictEqual(W.WATCH_BAR_ORDER, ['like', 'share', 'listen', 'transcript', 'more']);
  } finally { r.close(); }
});

test('D4.9: no link -> no Share, no captions -> no Transcript; the order holds with the gaps closed', async () => {
  const r = await mounted({ item: { ...VIDEO, watchUrl: undefined, hasSubtitles: false } });
  try {
    assert.deepStrictEqual(barIds(r), ['like-media-btn', 'listen-media-btn', 'more-actions-btn']);
  } finally { r.close(); }
});

test('D4.9 / F21 / D8.8: Like is a toggle - both labels in the stable stack, the glyph fills, never red; the state follows the server', async () => {
  const r = await mounted({ route: (m, u) => (u === '/api/liked/vid1' ? { status: 200, body: {} } : null) });
  try {
    const like = r.$('#like-media-btn');
    const slots = Array.from(like.querySelectorAll('.ui-btn__stack > .ui-btn__slot')).map((s) => [s.textContent, s.hasAttribute('data-idle')]);
    assert.deepStrictEqual(slots, [['Like', false], ['Liked', true]], 'both words laid out, Liked idle');
    assert.strictEqual(like.getAttribute('aria-pressed'), 'false');
    assert.ok(!/primary|danger|liked/.test(like.className), 'no red / selected-red class');
    like.click();
    await r.settle(8);
    assert.deepStrictEqual(r.calls('POST', '/api/liked/vid1').length, 1, 'one POST');
    assert.strictEqual(like.getAttribute('aria-pressed'), 'true');
    assert.strictEqual(like.querySelector('.ui-btn__icon use').getAttribute('href'), '#i-favorite-fill', 'the filled heart');
    assert.deepStrictEqual(Array.from(like.querySelectorAll('.ui-btn__slot')).map((s) => s.hasAttribute('data-idle')), [true, false], 'Liked shows');
  } finally { r.close(); }
});

test('D4.9: Share copies through the shared flow and answers with a toast - the button\'s label never changes ("Copied!" was a label swap)', async () => {
  const r = await mounted();
  try {
    r.w.shareExternalUrl = () => Promise.resolve('copied');
    const share = r.$('#share-media-btn');
    const before = share.textContent;
    share.click();
    await r.settle(6);
    assert.strictEqual(share.textContent, before, 'the label is untouched');
    const toast = r.doc.querySelector('.ui-toast');
    assert.ok(toast && /Link copied/.test(toast.textContent), 'a ui.toast says so');
  } finally { r.close(); }
});

test('D4.9 / F45: More opens ONE ui.menu of every other verb (a sheet, not the old choice modal), built from the live state', async () => {
  const r = await mounted({ route: (m, u) => (u === '/api/watched/vid1' ? { status: 200, body: {} } : null) });
  try {
    r.$('#more-actions-btn').click();
    await r.settle(4);
    const labels = Array.from(r.doc.querySelectorAll('.ui-sheet .ui-row')).map((x) => x.textContent.trim());
    assert.deepStrictEqual(labels, ['Play next', 'Add to queue', 'Save to device', 'Mark as watched', 'Copy description', 'Reheat metadata', 'Move to folder', 'Move to Trash']);
    assert.strictEqual(r.doc.querySelector('.modal-backdrop'), null, 'no choice modal');
    for (const row of r.doc.querySelectorAll('.ui-sheet .ui-row')) assert.ok(row.querySelector('.ui-row__media svg.ui-icon'), 'every entry has its glyph');
    // Mark as watched POSTs, and the NEXT open reads the new state
    Array.from(r.doc.querySelectorAll('.ui-sheet .ui-row')).find((x) => x.textContent.trim() === 'Mark as watched').click();
    await r.settle(8);
    assert.strictEqual(r.calls('POST', '/api/watched/vid1').length, 1);
    r.$('#more-actions-btn').click();
    await r.settle(4);
    assert.ok(Array.from(r.doc.querySelectorAll('.ui-sheet.is-open .ui-row')).some((x) => x.textContent.trim() === 'Mark as unwatched'), 'the label follows the state');
  } finally { r.close(); }
});

test('buildWatchMoreItems: every entry is gated on its own input (capability, flag, link, module, busy)', () => {
  const ids = (s) => W.buildWatchMoreItems(s).map((i) => i.id);
  assert.deepStrictEqual(ids({}), ['queue-next', 'queue-add', 'watched']);
  assert.deepStrictEqual(ids({ downloadHref: '/video/x?download=1', hasDescription: true, reheatEnabled: true, canModifyLibrary: true, canAttribute: true }),
    ['queue-next', 'queue-add', 'download', 'watched', 'copy-description', 'reheat', 'move', 'attribute', 'delete']);
  assert.ok(!ids({ canAttribute: true }).includes('attribute'), 'attribute needs the write capability too');
  assert.strictEqual(W.buildWatchMoreItems({ canModifyLibrary: true }).find((i) => i.id === 'delete').danger, true);
});

// ---- the channel row -----------------------------------------------------------------

const SUB = { id: 's1', channelUrl: VIDEO.channelUrl, name: 'Harbor Workshop', pushBell: true, channelDir: '/lib/Harbor Workshop' };

test('D4.9: subscribed - ui-avatar lg, the name over a ui-chip--meta count, a SECONDARY "Subscribed" pill, the bell ON and the pin as sm plain icon toggles', async () => {
  const r = await mounted({ subs: [SUB], pins: [{ id: 'p1', channelDir: '/lib/Harbor Workshop', label: 'Harbor Workshop' }] });
  try {
    const av = r.$('#uploader-avatar-letter');
    assert.ok(av.classList.contains('ui-avatar') && av.classList.contains('ui-avatar--lg'), 'ui-avatar lg');
    const chip = r.$('#uploader-subs-count');
    assert.ok(chip.classList.contains('ui-chip--meta') && !chip.closest('button'), 'a meta chip, never a button');
    const sub = r.$('#subscribe-btn-mock');
    assert.strictEqual(sub.hidden, false);
    assert.ok(sub.classList.contains('ui-btn--secondary') && sub.classList.contains('ui-btn--pill') && sub.classList.contains('ui-btn--sm'));
    assert.ok(!sub.classList.contains('ui-btn--primary'));
    assert.deepStrictEqual(Array.from(sub.querySelectorAll('.ui-btn__slot')).map((s) => [s.textContent, s.hasAttribute('data-idle')]), [['Subscribe', true], ['Subscribed', false]]);
    const ids = Array.from(r.$('#watch-channel-actions').children).map((c) => c.id);
    assert.deepStrictEqual(ids, ['subscribe-btn-mock', 'notify-channel-btn', 'pin-channel-btn']);
    const bell = r.$('#notify-channel-btn');
    const pin = r.$('#pin-channel-btn');
    for (const t of [bell, pin]) {
      for (const c of ['ui-btn--plain', 'ui-btn--sm', 'ui-btn--icon']) assert.ok(t.classList.contains(c), t.id + ' ' + c);
      assert.ok(!/primary|danger|gold|red/.test(t.className), t.id + ' never gold or red');
    }
    assert.strictEqual(bell.getAttribute('aria-pressed'), 'true', 'the ON bell');
    assert.strictEqual(bell.querySelector('use').getAttribute('href'), '#i-notifications_active');
    assert.strictEqual(pin.getAttribute('aria-pressed'), 'true', 'pinned');
    assert.strictEqual(pin.querySelector('use').getAttribute('href'), '#i-keep-fill');
    assert.strictEqual(bell.hasAttribute('data-reserved'), false);
  } finally { r.close(); }
});

test('D4.9: not subscribed - the PRIMARY "Subscribe" pill, the bell slot RESERVED (invisible, inert), the pin in its place', async () => {
  const r = await mounted({ subs: [] });
  try {
    const sub = r.$('#subscribe-btn-mock');
    assert.ok(sub.classList.contains('ui-btn--primary') && !sub.classList.contains('ui-btn--secondary'));
    const bell = r.$('#notify-channel-btn');
    assert.ok(bell, 'the slot exists');
    assert.ok(bell.hasAttribute('data-reserved') && bell.hasAttribute('inert') && bell.getAttribute('aria-hidden') === 'true');
    assert.match(CSS, /\.watch-channel__bell\[data-reserved\] \{\s*visibility: hidden;\s*\}/, 'the reserved slot is invisible but keeps its box');
    const before = r.fetches.length;
    bell.click();
    await r.settle(4);
    assert.strictEqual(r.fetches.filter((f) => f.method === 'PATCH').length, 0, 'a reserved bell never PATCHes');
    assert.ok(r.fetches.length >= before);
    assert.ok(r.$('#pin-channel-btn'), 'Pin is offered unsubscribed (its folder resolves from the file)');
  } finally { r.close(); }
});

// ---- D8.1: fabricated vs real ---------------------------------------------------------

test('D8.1: a MOCK view count, a MOCK subscriber count, the stars and the mock commenters carry .ft-fabricated; the user\'s comment and REAL counts never do', async () => {
  const mock = await mounted();
  try {
    assert.ok(mock.$('#views-count').classList.contains('ft-fabricated'), 'mock views');
    assert.ok(mock.$('#uploader-subs-count').classList.contains('ft-fabricated'), 'mock subscribers');
    assert.ok(mock.$('#star-rating-control').classList.contains('ft-fabricated'), 'the stars');
    assert.strictEqual(mock.$('#star-rating-control').querySelectorAll('svg.ui-icon').length, 5, 'five drawn stars');
    assert.ok(!/★|☆/.test(mock.$('#star-rating-control').textContent), 'no text star');
    const items = Array.from(mock.doc.querySelectorAll('#comments-container .comment-item'));
    assert.ok(items.length > 0 && items.every((i) => i.classList.contains('ft-fabricated')), 'every mock comment is fabricated');
    assert.ok(mock.doc.querySelector('#comments-container .comments-empty.ft-unfabricated'), 'Modern (flourish off) shows the empty state instead');
    assert.strictEqual(mock.$('#comment-count-real').textContent, '0');
    // the user posts one: it is real
    mock.$('#new-comment-text').value = 'mine';
    mock.$('#post-comment-btn').click();
    const mine = Array.from(mock.doc.querySelectorAll('#comments-container .comment-item')).find((i) => /mine/.test(i.textContent));
    assert.ok(mine && !mine.classList.contains('ft-fabricated'), 'the user\'s comment shows in every era');
    assert.strictEqual(mock.$('#comment-count-real').textContent, '1');
    assert.strictEqual(mock.doc.querySelector('#comments-container .comments-empty'), null, 'no empty state once a real comment exists');
  } finally { mock.close(); }
  const real = await mounted({ item: { ...VIDEO, sourceViewCount: 1234, sourceViewCountCapturedAt: Date.now() - 86400e3, sourceFollowerCount: 5000, sourceFollowerCountCapturedAt: Date.now() - 86400e3 } });
  try {
    assert.ok(!real.$('#views-count').classList.contains('ft-fabricated'), 'a captured view count shows in every era');
    assert.match(real.$('#views-count').textContent, /1,234 views/);
    assert.ok(!real.$('#uploader-subs-count').classList.contains('ft-fabricated'), 'a captured subscriber count shows in every era');
  } finally { real.close(); }
});

test('D8.1: the ONE era mechanism hides .ft-fabricated unless the flourish is on, and .ft-unfabricated exactly when it is', () => {
  assert.match(CSS, /html:not\(\[data-era-flourish="on"\]\) \.ft-fabricated \{\s*display: none;\s*\}/);
  assert.match(CSS, /html\[data-era-flourish="on"\] \.ft-unfabricated \{\s*display: none;\s*\}/);
  assert.match(VIEW, /<span class="ft-fabricated" id="comment-count-badge">0<\/span><span class="ft-unfabricated" id="comment-count-real">0<\/span>/);
});

// ---- D8.4: About this file ------------------------------------------------------------

test('D8.4: About this file is ONE collapsed ui-row (info glyph) that opens to Size / Type / Location (+ Copy) and the embedded tags', async () => {
  const r = await mounted();
  try {
    const toggle = r.$('#about-file-toggle');
    assert.ok(toggle.classList.contains('ui-row') && toggle.tagName === 'BUTTON');
    assert.strictEqual(toggle.getAttribute('aria-expanded'), 'false');
    assert.strictEqual(toggle.querySelector('.ui-row__media use').getAttribute('href'), '#i-info');
    assert.strictEqual(r.$('#about-file-body').hidden, true, 'collapsed');
    toggle.click();
    assert.strictEqual(toggle.getAttribute('aria-expanded'), 'true');
    assert.strictEqual(r.$('#about-file-body').hidden, false, 'open');
    const rows = Array.from(r.doc.querySelectorAll('#about-file-body .ui-row')).map((x) => [x.querySelector('.ui-row__overline').textContent, x.querySelector('.ui-row__title').textContent]);
    assert.deepStrictEqual(rows.slice(0, 3), [['Size', '38.1 MB'], ['Type', 'MP4'], ['Location', VIDEO.filePath]]);
    assert.deepStrictEqual(rows.slice(3), [['Genre', 'Craft']], 'the embedded tags follow (description is shown above, never twice)');
    toggle.click();
    assert.strictEqual(r.$('#about-file-body').hidden, true, 'closes again');
  } finally { r.close(); }
});

test('D8.4 / F68: the path row\'s Copy writes the path through ui.copy and says so', async () => {
  const r = await mounted();
  try {
    const written = [];
    Object.defineProperty(r.w.navigator, 'clipboard', { value: { writeText: (t) => { written.push(t); return Promise.resolve(); } }, configurable: true });
    r.$('#about-file-toggle').click();
    r.doc.querySelector('#about-file-body .ui-btn[aria-label="Copy the file path"]').click();
    await r.settle(4);
    assert.deepStrictEqual(written, [VIDEO.filePath]);
    assert.ok(/Path copied/.test(r.doc.querySelector('.ui-toast').textContent));
  } finally { r.close(); }
});

test('D8.4 / F25: the description box carries no self-hosting paragraph, no monospace, no bold labels, no inline style', () => {
  assert.ok(!/self-hosted on your network/.test(HTML), 'the boilerplate is gone');
  assert.ok(!/description-fileinfo|description-meta|embedded-tags/.test(VIEW), 'the old blocks are gone');
  assert.ok(!/<code|<b>|<strong/.test(VIEW), 'no code / bold markup');
  assert.ok(!/style="/.test(VIEW), 'no inline style anywhere in the view');
  assert.ok(!/★|☆|&bull;/.test(VIEW), 'no text glyphs');
  assert.ok(!/class="btn\b|class="btn /.test(VIEW), 'no legacy .btn in the view');
  const aboutCss = CSS.match(/\.about-file[^{]*\{[^}]*\}/g) || [];
  assert.ok(aboutCss.length > 0 && aboutCss.every((r) => !/monospace|--mono-font|font-weight: var\(--fw-bold\)/.test(r)), 'no monospace, no bold in About');
});

test('the retired flex-row families are gone from style.css (their locks converted here and to watch.check.js)', () => {
  for (const sel of ['.watch-action-btns', '.uploader-info-panel', '.uploader-subs', '.star-rating', '.rating-count', '.description-meta', '.description-fileinfo', '.embedded-tags', '.comment-avatar', '#more-actions-btn', '#queue-add-btn']) {
    assert.ok(!new RegExp(sel.replace(/[.#]/g, (m) => '\\' + m) + '\\b').test(CSS), sel + ' left in style.css');
  }
  assert.ok(!/@container watch-action-bar/.test(CSS), 'the v1.201 container query is gone (one row of equal columns at every width)');
});
