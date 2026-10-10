'use strict';

// [UNIT] v1.382.0 Feed card actions (plan docs/exec-plans/active/2026-10-10-feed-settings.md W4, D10-D11): double-tap like
// (on only, a heart where the finger was, a lone tap still plays / pauses after the window), the "..." menu's Like / Watch
// later / Hide this / Fewer from with their Undo, and Settings > Feed's "Hidden and fewer" list - through the REAL view in the
// jsdom harness and the REAL setup.js.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const feed = require('../../public/js/feed.js');
const FS = require('../../public/js/feed-settings.js');
const { feedRealm, BOOK, POD, VID, SONG, WL } = require('../helpers/feed-view-harness');

const REPO = path.join(__dirname, '..', '..');
const WINDOW = 40;
const wait = (ms) => new Promise((res) => setTimeout(res, ms));
async function start(r) { r.init(); await r.settle(); r.$('#feed-picker-choices button[data-minutes="10"]').click(); await r.settle(); }
function recorder(r) {
  const seen = [];
  const p = r.w.__harness.player;
  p.pictureTap = () => seen.push('tap');
  p.holdStart = () => { seen.push('hold'); return true; };
  p.holdEnd = () => seen.push('release');
  p.gestureTimings = () => ({ holdMs: 500, moveTol: 16, doubleTapMs: WINDOW });
  return seen;
}
function tap(r, node, x, y) {
  for (const type of ['pointerdown', 'pointerup']) {
    const e = new r.w.Event(type, { bubbles: true });
    Object.assign(e, { pointerId: 1, isPrimary: true, button: 0, clientX: x, clientY: y });
    node.dispatchEvent(e);
  }
}
async function menuPick(r, index, label) {
  r.$$('.feed-card')[index].querySelector('[data-card-menu]').click();
  await r.settle();
  const sheets = r.$$('.ui-sheet');
  const sheet = sheets[sheets.length - 1];
  const labels = Array.from(sheet.querySelectorAll('.ui-row, [role="menuitem"], button')).map((b) => b.textContent.trim()).filter(Boolean);
  if (!label) { r.w.document.dispatchEvent(new r.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await r.settle(); return labels; }
  const row = Array.from(sheet.querySelectorAll('.ui-row, [role="menuitem"], button')).find((b) => b.textContent.trim() === label);
  assert.ok(row, label + ' offered; got ' + JSON.stringify(labels));
  row.click();
  await r.settle();
  return labels;
}

// ---- pure ------------------------------------------------------------------------------------------------------------

test('D10 / D11 pure: each kind\'s like and Watch later route, its hide target, its Fewer from name', () => {
  assert.strictEqual(feed.feedLikeUrl(VID), '/api/liked/v1');
  assert.strictEqual(feed.feedLikeUrl({ ...VID, media: 'audio', id: 'a/b' }), '/api/liked/a%2Fb');
  assert.strictEqual(feed.feedLikeUrl(WL), '/api/liked/v5');
  assert.strictEqual(feed.feedLikeUrl(POD), '/api/podcasts/episodes/ep1/liked');
  assert.strictEqual(feed.feedLikeUrl(SONG), '/api/music/liked/t1');
  assert.strictEqual(feed.feedLikeUrl(BOOK), '/api/books/liked/bk1');
  assert.strictEqual(feed.feedLikeUrl({ kind: 'notice', id: 'notice' }), '');
  assert.strictEqual(feed.feedIsLiked(SONG), true, 'a song: music\'s own flag');
  assert.strictEqual(feed.feedIsLiked({ ...VID, liked: true }), true);
  assert.strictEqual(feed.feedIsLiked(VID), false);
  assert.strictEqual(feed.feedWatchLaterUrl(VID), '/api/watch-later/v1');
  assert.strictEqual(feed.feedWatchLaterUrl(POD), '/api/watch-later/ep1?kind=podcast');
  assert.strictEqual(feed.feedWatchLaterUrl(SONG), '');
  assert.strictEqual(feed.feedWatchLaterUrl(BOOK), '');
  assert.deepStrictEqual([VID, WL, POD, SONG, BOOK].map(feed.feedHideTarget), [{ kind: 'media', id: 'v1' }, { kind: 'media', id: 'v5' }, { kind: 'podcast', id: 'ep1' }, { kind: 'song', id: 't1' }, { kind: 'book', id: 'bk1' }]);
  assert.strictEqual(feed.feedHideTarget({ kind: 'notice', id: 'notice' }), null);
  assert.deepStrictEqual([VID, POD, SONG, BOOK].map((c) => feed.feedFewerTarget(c).key), ['channel:C', 'show:Show', 'artist:Art', 'author:W']);
  assert.strictEqual(feed.feedFewerTarget({ ...VID, channelName: '  ' }), null);
  // gate r1 (qa W1): a name the synced list cannot keep is never offered (it was, nothing was stored, and the toast said it was)
  assert.strictEqual(feed.feedFewerTarget({ ...POD, showName: 'S'.repeat(101) }), null, 'over 100 characters');
  assert.ok(feed.feedFewerTarget({ ...POD, showName: 'S'.repeat(100) }), '100 is kept');
  assert.strictEqual(feed.feedFewerTarget({ ...VID, channelName: 'a\u0001b' }), null, 'a control character');
  assert.deepStrictEqual(feed.feedFewerTarget({ ...VID, channelName: '  Lofi   Girl ' }), { type: 'channel', name: 'Lofi Girl', key: 'channel:Lofi Girl' }, 'the stored spelling');
  assert.strictEqual(feed.feedTapKind(null, 100, 0, 0, 350), 'single');
  assert.strictEqual(feed.feedTapKind({ at: 0, x: 10, y: 10 }, 349, 20, 20, 350), 'double');
  assert.strictEqual(feed.feedTapKind({ at: 0, x: 10, y: 10 }, 350, 20, 20, 350), 'single', 'the window is exclusive');
  assert.strictEqual(feed.feedTapKind({ at: 0, x: 10, y: 10 }, 100, 10 + feed.FEED_DOUBLE_TAP_PX + 1, 10, 350), 'single', 'too far apart');
});

// ---- double tap (D10) ------------------------------------------------------------------------------------------------

test('D10: a lone tap plays / pauses once the double-tap window passed; a double tap likes (one POST), pops a heart where the finger was, never pauses', async () => {
  const r = feedRealm({ batches: [{ cards: [VID, BOOK, POD], exhausted: false }] });
  try {
    const seen = recorder(r);
    await start(r);
    const layer = r.$$('.feed-card')[0].querySelector('.feed-card__touch');
    tap(r, layer, 100, 200);
    assert.deepStrictEqual(seen, [], 'not at once');
    await wait(WINDOW + 20);
    assert.deepStrictEqual(seen, ['tap'], 'the play / pause, after the window');
    tap(r, layer, 100, 200); await wait(5); tap(r, layer, 104, 203);
    await wait(WINDOW + 20);
    assert.deepStrictEqual(seen, ['tap'], 'the double tap is NOT a play / pause (neither of its taps)');
    assert.deepStrictEqual(r.calls('POST', '/api/liked/').map((c) => c.url), ['/api/liked/v1']);
    const heart = r.$$('.feed-card')[0].querySelector('.feed-heart');
    assert.ok(heart, 'a heart');
    assert.ok(/px$/.test(heart.style.getPropertyValue('--heart-x')) && heart.style.getPropertyValue('--heart-y'), 'placed at the tap');
    assert.strictEqual(heart.getAttribute('aria-hidden'), 'true');
    // on only: a second double tap shows the heart and sends nothing
    tap(r, layer, 100, 200); await wait(5); tap(r, layer, 100, 200);
    await wait(WINDOW + 20);
    assert.strictEqual(r.calls('POST', '/api/liked/').length, 1, 'never a second like, never an unlike');
    assert.strictEqual(r.calls('DELETE', '/api/liked/').length, 0);
    assert.ok(r.$$('.feed-card')[0].querySelector('.feed-heart'));
  } finally { r.close(); }
});

test('D10: double tap likes through each kind\'s own route (episode, song, book page); two slow taps are two plays, not a like', async () => {
  const r = feedRealm({ batches: [{ cards: [POD, { ...SONG, track: { ...SONG.track, liked: false } }, BOOK, VID], exhausted: false }] });
  try {
    const seen = recorder(r);
    await start(r);
    let layer = r.$$('.feed-card')[0].querySelector('.feed-card__touch');
    tap(r, layer, 50, 50); await wait(5); tap(r, layer, 52, 50);
    await wait(WINDOW + 20);
    assert.deepStrictEqual(r.calls('POST', '/api/podcasts/episodes/').map((c) => c.url), ['/api/podcasts/episodes/ep1/liked']);
    tap(r, layer, 50, 50); await wait(WINDOW + 20); tap(r, layer, 50, 50); await wait(WINDOW + 20);
    assert.deepStrictEqual(seen, ['tap', 'tap'], 'slow taps: two plays / pauses');
    r.show(1); await r.settle();
    layer = r.$$('.feed-card')[1].querySelector('.feed-card__touch');
    tap(r, layer, 50, 50); await wait(5); tap(r, layer, 50, 50); await r.settle();
    assert.deepStrictEqual(r.calls('POST', '/api/music/liked/').map((c) => c.url), ['/api/music/liked/t1']);
    r.show(2); await r.settle();
    const stage = r.$$('.feed-card')[2].querySelector('.feed-card__stage');
    tap(r, stage, 150, 300); await wait(5); tap(r, stage, 150, 300); await r.settle();
    assert.deepStrictEqual(r.calls('POST', '/api/books/liked/').map((c) => c.url), ['/api/books/liked/bk1']);
  } finally { r.close(); }
});

test('D10: the like goes to the card the gesture STARTED on - a card that changed between the two taps gets nothing', async () => {
  const r = feedRealm({ batches: [{ cards: [VID, BOOK], exhausted: false }] });
  try {
    recorder(r);
    await start(r);
    const layer = r.$$('.feed-card')[0].querySelector('.feed-card__touch');
    tap(r, layer, 50, 50);
    r.$('#feed-done-btn').click(); await r.settle(); // the session ends between the taps (the stack is cleared)
    const recapDone = r.$('#feed-recap-done'); if (recapDone) { recapDone.click(); await r.settle(); }
    tap(r, layer, 50, 50); await wait(WINDOW + 20);
    assert.strictEqual(r.calls('POST', '/api/liked/').length, 0, 'no like on a card that is no longer there');
  } finally { r.close(); }
});

// ---- the menu (D10, D11) ----------------------------------------------------------------------------------------------

test('menu: Like / Unlike and Watch later per kind, through the existing routes; the card remembers', async () => {
  const r = feedRealm({ batches: [{ cards: [{ ...VID, liked: false, inWatchLater: false }, { ...POD, liked: true, inWatchLater: true }, SONG, BOOK], exhausted: false }] });
  try {
    await start(r);
    let labels = await menuPick(r, 0, 'Like');
    assert.ok(labels.includes('Add to Watch later') && labels.includes('Hide this') && labels.includes('Fewer from C'), JSON.stringify(labels));
    assert.deepStrictEqual(r.calls('POST', '/api/liked/').map((c) => c.url), ['/api/liked/v1']);
    labels = await menuPick(r, 0);
    assert.ok(labels.includes('Unlike'), 'liked now: the menu says Unlike');
    await menuPick(r, 0, 'Unlike');
    assert.deepStrictEqual(r.calls('DELETE', '/api/liked/').map((c) => c.url), ['/api/liked/v1']);
    await menuPick(r, 0, 'Add to Watch later');
    assert.deepStrictEqual(r.calls('POST', '/api/watch-later/').map((c) => c.url), ['/api/watch-later/v1']);
    assert.ok((await menuPick(r, 0)).includes('Remove from Watch later'));
    await menuPick(r, 1, 'Remove from Watch later');
    assert.deepStrictEqual(r.calls('DELETE', '/api/watch-later/').map((c) => c.url), ['/api/watch-later/ep1?kind=podcast']);
    await menuPick(r, 1, 'Unlike');
    assert.deepStrictEqual(r.calls('DELETE', '/api/podcasts/episodes/').map((c) => c.url), ['/api/podcasts/episodes/ep1/liked']);
    const songLabels = await menuPick(r, 2);
    assert.ok(songLabels.includes('Unlike') && !songLabels.some((l) => /Watch later/.test(l)) && songLabels.includes('Fewer from Art'), JSON.stringify(songLabels));
    const bookLabels = await menuPick(r, 3);
    assert.ok(bookLabels.includes('Like') && !bookLabels.some((l) => /Watch later/.test(l)) && bookLabels.includes('Fewer from W'), JSON.stringify(bookLabels));
  } finally { r.close(); }
});

test('D11 Hide this: posts the card\'s kind and id, steps the card aside, and its Undo takes it off the list (10 s)', async () => {
  const r = feedRealm({ batches: [{ cards: [VID, POD, SONG, BOOK], exhausted: false }] });
  try {
    await start(r);
    await menuPick(r, 1, 'Hide this');
    const posts = r.calls('POST', '/api/feed/hidden');
    assert.deepStrictEqual(posts.map((c) => c.body), [{ kind: 'podcast', id: 'ep1' }]);
    assert.ok(r.$$('.feed-card')[1].hasAttribute('data-hidden'));
    const i = r.toasts.findIndex((t) => /^Hidden: Ep$/.test(t));
    assert.ok(i >= 0, JSON.stringify(r.toasts));
    const opts = r.w.__toastOpts[i];
    assert.strictEqual(opts.duration, feed.FEED_UNDO_MS);
    opts.action.onAction();
    await r.settle();
    assert.deepStrictEqual(r.fetches.filter((f) => f.method === 'DELETE' && f.url === '/api/feed/hidden').map((c) => c.body), [{ kind: 'podcast', id: 'ep1' }], 'the exact route (a prefix match let a wrong one pass: mutant W4-M18)');
    assert.ok(!r.$$('.feed-card')[1].hasAttribute('data-hidden'));
    await menuPick(r, 2, 'Hide this');
    await menuPick(r, 3, 'Hide this');
    await menuPick(r, 0, 'Hide this');
    assert.deepStrictEqual(r.calls('POST', '/api/feed/hidden').map((c) => c.body).slice(1), [{ kind: 'song', id: 't1' }, { kind: 'book', id: 'bk1' }, { kind: 'media', id: 'v1' }]);
    assert.strictEqual(r.w.__scrolledInto, r.$$('.feed-card')[1], 'hiding the active card moves on to the next');
  } finally { r.close(); }
});

test('D11 Fewer from: writes the synced list (sent at once), toasts with Undo, and Undo removes exactly that name', async () => {
  const r = feedRealm({ batches: [{ cards: [VID, POD, SONG, BOOK], exhausted: false }] });
  try {
    let flushed = 0;
    r.w.__ftPrefsSync = { flush: () => { flushed += 1; } };
    r.w.localStorage.setItem(FS.FEWER_KEY, JSON.stringify(['author:Someone']));
    await start(r);
    await menuPick(r, 1, 'Fewer from Show');
    assert.deepStrictEqual(JSON.parse(r.w.localStorage.getItem(FS.FEWER_KEY)), ['author:Someone', 'show:Show']);
    assert.strictEqual(flushed, 1, 'the sync sends it now (the server reads it for the next batch)');
    const i = r.toasts.indexOf('Fewer from Show');
    assert.ok(i >= 0);
    r.w.__toastOpts[i].action.onAction();
    assert.deepStrictEqual(JSON.parse(r.w.localStorage.getItem(FS.FEWER_KEY)), ['author:Someone']);
    await menuPick(r, 0, 'Fewer from C');
    await menuPick(r, 2, 'Fewer from Art');
    assert.deepStrictEqual(JSON.parse(r.w.localStorage.getItem(FS.FEWER_KEY)), ['author:Someone', 'channel:C', 'artist:Art']);
  } finally { r.close(); }
});

// ---- Settings > Feed > Hidden and fewer ---------------------------------------------------------------------------

test('Settings > Feed lists what was hidden (from the server) and every Fewer from name; Unhide and Remove each undo one', async () => {
  const html = fs.readFileSync(path.join(REPO, 'public', 'setup.html'), 'utf8');
  const PAGE = html.match(/<details class="setup-box setup-sec sub-collapsible" data-collapse-key="feed"[\s\S]*?<\/details>/)[0];
  const dom = new JSDOM(`<!DOCTYPE html><body>${PAGE}</body>`, { url: 'http://localhost/setup.html', runScripts: 'outside-only' });
  const w = dom.window;
  for (const f of ['public/js/icons.js', 'public/js/ui.js', 'public/js/feed-settings.js']) w.eval(fs.readFileSync(path.join(REPO, f), 'utf8'));
  w.localStorage.setItem(FS.FEWER_KEY, JSON.stringify(['channel:Lofi Girl', 'author:Le Guin']));
  const calls = [];
  w.fetch = (u, init) => {
    calls.push({ url: String(u), method: (init && init.method) || 'GET', body: init && init.body ? JSON.parse(init.body) : null });
    if (String(u) === '/api/feed/hidden' && (!init || !init.method)) return Promise.resolve({ ok: true, json: async () => ({ items: [{ kind: 'podcast', id: 'ep9', title: '<b>Ep</b> nine', sub: 'Show' }, { kind: 'media', id: 'v3', title: 'Vid', sub: 'Chan' }] }) });
    return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
  };
  global.window = w; global.document = w.document; const realFetch = global.fetch; global.fetch = w.fetch; // setup.js calls the global fetch (Node's own is put back after)
  delete require.cache[require.resolve('../../public/js/setup.js')];
  const mod = require('../../public/js/setup.js');
  const ctl = new w.AbortController();
  try {
    await mod.renderFeedTuning(w.document, ctl.signal);
    const rows = () => Array.from(w.document.querySelectorAll('#feed-tuning-list .ui-row')).map((r) => r.querySelector('.ui-row__title').textContent + ' | ' + r.querySelector('.ui-row__meta').textContent);
    assert.deepStrictEqual(rows(), ['<b>Ep</b> nine | Hidden · Episode · Show', 'Vid | Hidden · Video · Chan', 'Lofi Girl | Fewer from · Channel', 'Le Guin | Fewer from · Author']);
    assert.strictEqual(w.document.querySelector('#feed-tuning-list b'), null, 'a title is text, never markup');
    assert.strictEqual(w.document.getElementById('feed-tuning-empty').hidden, true);
    const unhide = Array.from(w.document.querySelectorAll('#feed-tuning-list button')).find((b) => b.textContent.trim() === 'Unhide');
    unhide.click();
    await new Promise((res) => setTimeout(res, 10));
    assert.deepStrictEqual(calls.filter((c) => c.method === 'DELETE').map((c) => c.body), [{ kind: 'podcast', id: 'ep9' }]);
    assert.strictEqual(rows().length, 3);
    const remove = Array.from(w.document.querySelectorAll('#feed-tuning-list button')).filter((b) => b.textContent.trim() === 'Remove')[0];
    remove.click();
    assert.deepStrictEqual(JSON.parse(w.localStorage.getItem(FS.FEWER_KEY)), ['author:Le Guin']);
    assert.deepStrictEqual(rows(), ['Vid | Hidden · Video · Chan', 'Le Guin | Fewer from · Author']);
  } finally { ctl.abort(); w.close(); delete global.window; delete global.document; global.fetch = realFetch; }
});

test('Settings > Feed (gate r1, qa suggestion 2): the Fewer from names are drawn again when the account copy lands after the page', async () => {
  const html = fs.readFileSync(path.join(REPO, 'public', 'setup.html'), 'utf8');
  const PAGE = html.match(/<details class="setup-box setup-sec sub-collapsible" data-collapse-key="feed"[\s\S]*?<\/details>/)[0];
  const dom = new JSDOM(`<!DOCTYPE html><body>${PAGE}</body>`, { url: 'http://localhost/setup.html', runScripts: 'outside-only' });
  const w = dom.window;
  for (const f of ['public/js/icons.js', 'public/js/ui.js', 'public/js/feed-settings.js']) w.eval(fs.readFileSync(path.join(REPO, f), 'utf8'));
  const waiters = [];
  w.__ftPrefsSync = { whenBooted: (fn) => waiters.push(fn) };
  w.fetch = () => Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
  const realFetch = global.fetch;
  global.window = w; global.document = w.document; global.fetch = w.fetch;
  delete require.cache[require.resolve('../../public/js/setup.js')];
  const mod = require('../../public/js/setup.js');
  const ctl = new w.AbortController();
  try {
    mod.wireFeedSettingsPage(w.document, ctl.signal);
    await new Promise((res) => setTimeout(res, 10));
    assert.strictEqual(w.document.querySelectorAll('#feed-tuning-list .ui-row').length, 0, 'nothing on this device yet');
    w.localStorage.setItem(FS.FEWER_KEY, JSON.stringify(['show:Radiolab'])); // what applyServer writes (raw)
    waiters.forEach((fn) => fn());
    await new Promise((res) => setTimeout(res, 10));
    assert.deepStrictEqual(Array.from(w.document.querySelectorAll('#feed-tuning-list .ui-row__title')).map((t) => t.textContent), ['Radiolab']);
  } finally { ctl.abort(); w.close(); delete global.window; delete global.document; global.fetch = realFetch; }
});
