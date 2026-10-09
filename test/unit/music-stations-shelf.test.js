'use strict';

// [UNIT] v1.378.0 music stations W3 (plan docs/exec-plans/completed/2026-10-09-music-stations.md, D7, D8,
// D10): the Stations shelf on the REAL music.js home - the cards from a fake GET /api/music/stations, a
// card tap starting the station through the radio route with its NAME in the queue context (the
// "Radio: <name>" line, the desktop panel's context line, the skin ctx), the card menu (Edit / Delete
// for the viewer's own, Hide / Unhide for the rest) through the real ui.js, the editor's live count
// and save, "More stations", and a hostile station name that never becomes markup.

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const { loadUi, openDialog, drainSheets } = require('../helpers/ui-dialogs');

const musicPath = require.resolve('../../public/js/music.js');
const surfacePath = require.resolve('../../public/js/skin-surface.js');
require('../../public/js/common.js');
const common = require('../../public/js/common.js');

const PICKS = [
  { id: 'r1', title: 'Reggae One', artist: 'Band A', album: 'Roots', albumKey: 'Band A␟Roots', durationSec: 200, source: 'native' },
  { id: 'r2', title: 'Reggae Two', artist: 'Band B', album: 'Dub', albumKey: 'Band B␟Dub', durationSec: 200, source: 'native' },
];
const HOSTILE = '<img src=x onerror=alert(1)>';
const STATIONS = [
  { key: 'favorites', name: 'Favorites', kind: 'builtin', subtitle: 'Builds as you listen', count: 3, strict: false, group: 'main', hidden: false, artIds: ['a1', 'a2'], artVs: [null, null] },
  { key: 's:reggae', name: 'Reggae', kind: 'style', subtitle: '52 songs', count: 52, strict: false, group: 'main', hidden: false, artIds: ['a1', 'a2', 'a3', 'a4'], artVs: [null, null, null, null] },
  { key: 'c:abcdefabcdef', name: HOSTILE, kind: 'custom', subtitle: '20 songs', count: 20, strict: true, group: 'main', hidden: false, artIds: ['a5'], artVs: [null], def: { id: 'abcdefabcdef', name: HOSTILE, genres: [], artists: ['Rocker 1', 'Rocker 2'], words: [], yearFrom: null, yearTo: null, exclude: [], strict: true } },
  { key: 'g:rock', name: 'Rock', kind: 'genre', subtitle: '50 songs', count: 50, strict: false, group: 'more', hidden: false, artIds: ['a6'], artVs: [null] },
  { key: 'g:pop', name: 'Pop', kind: 'genre', subtitle: '41 songs', count: 41, strict: false, group: 'main', hidden: true, artIds: ['a7'], artVs: [null] },
];

const VIEW_HTML = `<body><div id="view-root" data-view="music">
  <select id="music-sort-select"></select>
  <button id="music-view-toggle" hidden><i></i></button>
  <button id="music-autoplay-btn" type="button" aria-pressed="false">Autoplay</button>
  <div id="player-slot"></div>
  <video id="media-player"></video>
  <div id="music-nowplaying-panel" class="music-nowplaying-panel"></div>
  <button type="button" class="music-nowplaying" id="music-nowplaying" hidden></button>
  <section id="music-jumpback" hidden></section>
  <div class="music-tabs" id="music-tabs" role="tablist">
    <button type="button" class="music-tab active" data-tab="home" role="tab">Home</button>
    <button type="button" class="music-tab" data-tab="songs" role="tab">Songs</button>
  </div>
  <div id="music-crumb" hidden></div><div id="music-status" role="status" hidden></div>
  <div id="music-content"></div><div id="music-empty" hidden></div>
</div></body>`;

const settle = () => new Promise((r) => setImmediate(r));
async function settleAll(n) { for (let i = 0; i < (n || 12); i++) { await settle(); await new Promise((r) => setTimeout(r, 2)); } }

async function boot(run, opts) {
  opts = opts || {};
  const dom = new JSDOM(VIEW_HTML, { url: 'http://localhost/music' });
  const saved = { window: global.window, document: global.document, localStorage: global.localStorage, fetch: global.fetch, AbortController: global.AbortController, Event: global.Event, requestAnimationFrame: global.requestAnimationFrame };
  global.window = dom.window; global.document = dom.window.document;
  global.localStorage = dom.window.localStorage; global.AbortController = dom.window.AbortController;
  global.Event = dom.window.Event;
  global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  dom.window.localStorage.setItem('filetube_music_tab', 'home');
  dom.window.localStorage.setItem('ft-music-autoplay', '1');
  dom.window.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  dom.window.scrollTo = () => {};
  const playerState = { state: 'docked', currentId: null, meta: null, lastData: null };
  let registered = null;
  const calls = []; // every fetch as "<METHOD> <url>" and the parsed body
  let stations = JSON.parse(JSON.stringify(opts.stations || STATIONS));
  dom.window.FileTube = {
    registerView: (n, m) => { registered = m; },
    encodeListContext: common.encodeListContext, decodeListContext: common.decodeListContext, shimmerArt: () => {},
    player: {
      currentId: null, getState: () => playerState.state, expand: () => { playerState.state = 'full'; },
      getCurrentMeta: () => playerState.meta,
      load: (id, data) => { playerState.currentId = id; dom.window.FileTube.player.currentId = id; playerState.state = 'full'; playerState.lastData = data; playerState.meta = { isMusic: true, id, title: 'x', browseCtx: data && data.browseCtx }; },
      setTrackNav: () => {},
    },
  };
  global.window.showToast = (m) => { calls.push({ toast: m }); };
  dom.window.encodeListContext = common.encodeListContext; // the browser's common.js global the view reads
  global.fetch = (url, init) => {
    const u = String(url); const method = (init && init.method) || 'GET';
    const body = init && init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, url: u, body });
    const json = (o, status) => Promise.resolve({ ok: !status || status < 400, status: status || 200, json: async () => o });
    if (u.indexOf('/api/music/stations/preview') === 0) return json({ count: body && body.artists && body.artists.length ? 7 * body.artists.length : 0, artists: body && body.artists ? body.artists.length : 0 });
    if (u.indexOf('/api/music/stations/hidden') === 0) { const st = stations.find((x) => x.key === body.key); if (st) st.hidden = body.hidden; return json({ ok: true }); }
    if (u === '/api/music/stations' && method === 'POST') { const st = { key: 'c:111111111111', name: body.name, kind: 'custom', subtitle: '14 songs', count: 14, strict: !!body.strict, group: 'main', hidden: false, artIds: ['a9'], artVs: [null], def: Object.assign({ id: '111111111111' }, body) }; stations.push(st); return json({ station: st }, 201); }
    if (u.indexOf('/api/music/stations/') === 0 && method === 'DELETE') { if (opts.deleteFails) return json({ error: 'nope' }, 500); stations = stations.filter((x) => x.def && x.def.id !== decodeURIComponent(u.slice('/api/music/stations/'.length))); return json({ ok: true }); }
    if (u.indexOf('/api/music/stations/') === 0 && method === 'PUT') { const id = decodeURIComponent(u.slice('/api/music/stations/'.length)); const st = stations.find((x) => x.def && x.def.id === id); if (st) { st.name = body.name; st.def = Object.assign({ id }, body); } return json({ station: st }); }
    if (u === '/api/music/stations') { if (opts.stationsFail && opts.stationsFail()) return Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'down' }) }); return json({ stations }); }
    if (u.indexOf('/api/music/radio?') === 0) return json({ items: PICKS });
    if (u.indexOf('/api/music/artists') === 0 || u.indexOf('/api/music/albums') === 0) return json({ items: [] });
    if (u.indexOf('/api/music?') === 0) return json({ items: [] });
    if (method === 'POST') return json({ ok: true });
    return json({ items: [] });
  };
  const root = () => dom.window.document.getElementById('view-root');
  const ctx = { dom, doc: dom.window.document, calls, playerState, stations: () => stations, click: (sel) => { const el = dom.window.document.querySelector(sel); if (!el) throw new Error('no element ' + sel); el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); return el; } };
  try {
    delete require.cache[require.resolve('../../public/js/ui.js')];
    loadUi();
    delete require.cache[surfacePath];
    require(surfacePath);
    delete require.cache[musicPath];
    require(musicPath);
    registered.init(root());
    await settleAll();
    await run(ctx);
    await drainSheets(dom.window);
    registered.destroy();
  } finally { delete require.cache[musicPath]; Object.assign(global, saved); }
}

test('D10: the shelf shows the main stations and New station, never the More or hidden ones until "More stations"; names are text, never markup', async () => {
  await boot(async (c) => {
    const shelf = c.doc.querySelector('.music-stations');
    assert.ok(shelf, 'the Stations shelf rendered');
    const keys = Array.from(shelf.querySelectorAll('.music-shelf-strip:not(.music-stations-more) .music-station-tile')).map((b) => b.getAttribute('data-station-key'));
    assert.deepStrictEqual(keys, ['favorites', 's:reggae', 'c:abcdefabcdef'], 'main, not hidden');
    assert.ok(shelf.querySelector('.music-station-new'), 'New station is at the end');
    assert.strictEqual(shelf.querySelector('.music-stations-more'), null);
    const custom = shelf.querySelector('[data-station-key="c:abcdefabcdef"].music-station-tile .music-station-name');
    assert.strictEqual(custom.textContent, HOSTILE, 'the hostile name is shown as text');
    assert.strictEqual(shelf.querySelector('img[src="x"]'), null, 'and never became an element');
    assert.strictEqual(shelf.querySelector('[data-station-key="favorites"] .music-station-meta').textContent, 'Builds as you listen');
    assert.strictEqual(shelf.querySelector('[data-station-key="s:reggae"] .music-station-mosaic').getAttribute('data-tiles'), '4');
    // the shelf sits above the albums (D10): it is the last section here (no albums in this fixture) but exists even with no library
    const toggle = shelf.querySelector('.music-stations-toggle');
    assert.ok(toggle && toggle.textContent.trim() === 'More stations', 'a More stations toggle: one station is under More, one hidden');
    toggle.dispatchEvent(new c.dom.window.MouseEvent('click', { bubbles: true }));
    const more = c.doc.querySelector('.music-stations-more');
    assert.ok(more, 'the second strip unfolded');
    assert.deepStrictEqual(Array.from(more.querySelectorAll('.music-station-tile')).map((b) => b.getAttribute('data-station-key')), ['g:rock', 'g:pop']);
    assert.strictEqual(more.querySelector('[data-station-key="g:pop"] .music-station-meta').textContent, 'Hidden');
    assert.strictEqual(c.doc.querySelector('.music-stations-toggle').textContent.trim(), 'Fewer stations');
  });
});

test('D10: a card tap starts the station through the radio route and the queue context carries the seed AND the name; the "Radio: <name>" line, the desktop panel and the skin ctx read it; a resume keeps it', async () => {
  await boot(async (c) => {
    c.click('.music-station-tile[data-station-key="s:reggae"]');
    await settleAll();
    const radio = c.calls.find((x) => x.url && x.url.indexOf('/api/music/radio?') === 0);
    assert.ok(radio && radio.url.indexOf('seed=' + encodeURIComponent('station:s:reggae')) !== -1, 'the station seed: ' + (radio && radio.url));
    assert.strictEqual(c.playerState.currentId, 'r1', 'the first pick plays');
    const ctx = JSON.parse(c.playerState.lastData.browseCtx);
    assert.deepStrictEqual(ctx, { src: 'music', radio: 'station:s:reggae', radioName: 'Reggae' }, 'the context carries the seed and the name');
    const line = c.doc.getElementById('music-nowplaying');
    assert.strictEqual(line.hidden, false);
    assert.strictEqual(line.textContent, 'Radio: Reggae', 'the line names the station, not the album');
    assert.strictEqual(line.getAttribute('data-album-key'), null, 'no album to open from a station line');
    const panelCtx = c.doc.querySelector('#music-nowplaying-panel .mnp-ctx');
    assert.ok(panelCtx && panelCtx.textContent === 'Radio: Reggae', 'the desktop panel has the context line');
    // the resume POST carries the context too (a reload re-seeds the same station by name)
    const resume = c.calls.find((x) => x.url === '/api/music/resume');
    assert.strictEqual(resume.body.queueCtx.radioName, 'Reggae');
  });
});

test('D10: a song radio (not a station) keeps the album line and no context line', async () => {
  await boot(async (c) => {
    // a built-in with no name recorded: drive startRadio through a station whose name is empty -> no radioName
    c.stations().find((s) => s.key === 'favorites').name = '';
    // reload the shelf from the altered payload by re-rendering: tap the toggle twice
    c.click('.music-stations-toggle'); c.click('.music-stations-toggle');
    c.click('.music-station-tile[data-station-key="favorites"]');
    await settleAll();
    const ctx = JSON.parse(c.playerState.lastData.browseCtx);
    assert.strictEqual(ctx.radioName, undefined, 'no name, no radioName');
    assert.strictEqual(c.doc.getElementById('music-nowplaying').textContent, 'Playing from Roots', 'the album line as before');
    assert.strictEqual(c.doc.querySelector('#music-nowplaying-panel .mnp-ctx'), null);
  });
  // the pure label rule
  const M = require('../../public/js/music.js');
  assert.strictEqual(M.deriveNowPlayingLabel({ id: 'a', album: 'Roots' }, 'a'), 'Playing from Roots');
  assert.strictEqual(M.deriveNowPlayingLabel({ id: 'a', album: 'Roots' }, 'a', 'Reggae'), 'Radio: Reggae');
  assert.strictEqual(M.deriveNowPlayingLabel({ id: 'a', album: 'Roots' }, 'b', 'Reggae'), '', 'another item playing: nothing, station or not');
  assert.strictEqual(M.deriveNowPlayingLabel({ id: 'a', album: '' }, 'a', '  '), '', 'a blank name is no station');
  assert.deepStrictEqual(JSON.parse(common.encodeListContext({ src: 'music', radio: 'track:x', radioName: 'Reggae' })), { src: 'music', radio: 'track:x' }, 'a name rides a station seed only');
  assert.deepStrictEqual(JSON.parse(common.encodeListContext({ src: 'music', radio: 'station:s:reggae', radioName: 'x'.repeat(61) })), { src: 'music', radio: 'station:s:reggae' }, 'an over-long name is dropped, never truncated into markup');
});

test('D8 / D7: the card menu - Hide posts and the card leaves the shelf (Unhide brings it back); Edit opens the editor seeded from the definition; Delete asks, then posts', async () => {
  await boot(async (c) => {
    c.click('.music-station-more[data-station-key="s:reggae"]');
    await settleAll();
    let rows = Array.from(c.doc.querySelectorAll('.ui-sheet .ui-row__title')).map((r) => r.textContent);
    assert.deepStrictEqual(rows, ['Hide'], 'a generated station: Hide only');
    c.doc.querySelector('.ui-sheet .ui-row').dispatchEvent(new c.dom.window.MouseEvent('click', { bubbles: true }));
    await settleAll();
    const hide = c.calls.find((x) => x.url === '/api/music/stations/hidden');
    assert.deepStrictEqual(hide.body, { key: 's:reggae', hidden: true });
    assert.strictEqual(c.doc.querySelector('.music-shelf-strip:not(.music-stations-more) [data-station-key="s:reggae"]'), null, 'hidden: off the main strip');
    await drainSheets(c.dom.window);
    // under More stations it is Hidden with Unhide
    c.click('.music-stations-toggle');
    c.click('.music-stations-more .music-station-more[data-station-key="s:reggae"]');
    await settleAll();
    rows = Array.from(c.doc.querySelectorAll('.ui-sheet .ui-row__title')).map((r) => r.textContent);
    assert.deepStrictEqual(rows, ['Unhide']);
    c.doc.querySelector('.ui-sheet .ui-row').dispatchEvent(new c.dom.window.MouseEvent('click', { bubbles: true }));
    await settleAll();
    assert.ok(c.doc.querySelector('.music-shelf-strip:not(.music-stations-more) [data-station-key="s:reggae"]'), 'back on the main strip');
    await drainSheets(c.dom.window);
    // the viewer's own: Edit / Delete
    c.click('.music-station-more[data-station-key="c:abcdefabcdef"]');
    await settleAll();
    rows = Array.from(c.doc.querySelectorAll('.ui-sheet .ui-row__title')).map((r) => r.textContent);
    assert.deepStrictEqual(rows, ['Edit', 'Delete']);
    c.doc.querySelectorAll('.ui-sheet .ui-row')[0].dispatchEvent(new c.dom.window.MouseEvent('click', { bubbles: true }));
    await settleAll();
    const dlg = openDialog(c.doc);
    assert.strictEqual(dlg.querySelector('.ui-sheet__title').textContent, 'Edit station');
    const inputs = Array.from(dlg.querySelectorAll('.ui-field__input')).map((i) => i.value);
    assert.strictEqual(inputs[0], HOSTILE, 'the name is a VALUE in the field, never markup');
    assert.strictEqual(inputs[2], 'Rocker 1, Rocker 2', 'the artists list seeded');
    assert.strictEqual(dlg.querySelector('.ui-switch').getAttribute('aria-checked'), 'true', 'strict seeded');
    await settleAll(20);
    assert.strictEqual(dlg.querySelector('.music-station-count').textContent, '14 songs from 2 artists', 'the count previewed at once');
    assert.strictEqual(dlg.querySelector('.ui-confirm__actions .ui-btn--primary').disabled, false);
    c.doc.querySelector('.ui-sheet__close').dispatchEvent(new c.dom.window.MouseEvent('click', { bubbles: true }));
    await drainSheets(c.dom.window);
    // Delete asks first; a confirm posts DELETE and the card is gone
    c.click('.music-station-more[data-station-key="c:abcdefabcdef"]');
    await settleAll();
    c.doc.querySelectorAll('.ui-sheet .ui-row')[1].dispatchEvent(new c.dom.window.MouseEvent('click', { bubbles: true }));
    await settleAll();
    const confirm = openDialog(c.doc);
    assert.strictEqual(confirm.querySelector('.ui-sheet__title').textContent, 'Delete this station?');
    assert.strictEqual(confirm.querySelector('.ui-confirm__body').textContent, HOSTILE, 'the body is text');
    await new Promise((r) => setTimeout(r, 450)); // past the activation guard
    confirm.querySelectorAll('.ui-confirm__actions .ui-btn')[1].dispatchEvent(new c.dom.window.MouseEvent('click', { bubbles: true }));
    await settleAll();
    const del = c.calls.find((x) => x.method === 'DELETE');
    assert.strictEqual(del.url, '/api/music/stations/abcdefabcdef');
    assert.strictEqual(c.doc.querySelector('[data-station-key="c:abcdefabcdef"]'), null, 'the card is gone');
  });
});

test('D7: New station opens the editor; Save stays disabled until the definition matches songs and has a name; typing previews (debounced); Create posts the definition and the shelf gains the card', async () => {
  await boot(async (c) => {
    c.click('.music-station-new');
    await settleAll();
    const dlg = openDialog(c.doc);
    assert.strictEqual(dlg.querySelector('.ui-sheet__title').textContent, 'New station');
    const inputs = dlg.querySelectorAll('.ui-field__input');
    const save = dlg.querySelector('.ui-confirm__actions .ui-btn--primary');
    assert.strictEqual(save.disabled, true, 'nothing yet');
    const type = (input, v) => { input.value = v; input.dispatchEvent(new c.dom.window.Event('input', { bubbles: true })); };
    type(inputs[2], 'Nas, Queen');
    await settleAll(4);
    assert.ok(!c.calls.some((x) => x.url === '/api/music/stations/preview'), 'the preview waits (debounced)');
    await new Promise((r) => setTimeout(r, 400));
    await settleAll();
    const prev = c.calls.filter((x) => x.url === '/api/music/stations/preview');
    assert.strictEqual(prev.length, 1, 'one preview after the pause');
    assert.deepStrictEqual(prev[0].body.artists, ['Nas', 'Queen']);
    assert.strictEqual(dlg.querySelector('.music-station-count').textContent, '14 songs from 2 artists');
    assert.strictEqual(save.disabled, true, 'a count but no name yet');
    type(inputs[0], 'My Two');
    assert.strictEqual(save.disabled, false, 'a name and a count: Create is live');
    dlg.querySelector('.ui-switch').dispatchEvent(new c.dom.window.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 450));
    save.dispatchEvent(new c.dom.window.MouseEvent('click', { bubbles: true }));
    await settleAll(20);
    const post = c.calls.find((x) => x.method === 'POST' && x.url === '/api/music/stations');
    assert.deepStrictEqual(post.body, { name: 'My Two', genres: [], artists: ['Nas', 'Queen'], words: [], yearFrom: null, yearTo: null, exclude: [], strict: true });
    assert.ok(c.doc.querySelector('.music-station-tile[data-station-key="c:111111111111"]'), 'the new card is on the shelf');
    assert.ok(c.calls.some((x) => x.toast === 'Station created.'));
    // an empty-axis definition cannot be saved: the words field cleared, artists cleared -> disabled
  });
});

// ---- gate r1 (qa S4, S5) ------------------------------------------------------------------------------
test('gate r1 qa S5: a failed read of the stations is an ERROR state with Retry, never "no stations"; Retry refetches and the shelf repaints', async () => {
  let fail = true;
  await boot(async (c) => {
    assert.ok(c.doc.querySelector('.music-stations-error'), 'the shelf shows the error');
    assert.strictEqual(c.doc.querySelector('.music-station-new'), null, 'no New station tile over an unknown list');
    assert.strictEqual(c.doc.querySelector('.music-station-tile'), null);
    fail = false;
    c.click('.music-stations-retry');
    await settleAll(20);
    assert.strictEqual(c.doc.querySelector('.music-stations-error'), null, 'the error is gone');
    assert.ok(c.doc.querySelector('.music-station-tile[data-station-key="s:reggae"]'), 'the stations arrived on Retry');
  }, { stationsFail: () => fail });
});

test('gate r1 qa S4: a refused Delete says so and the card stays', async () => {
  await boot(async (c) => {
    c.click('.music-station-more[data-station-key="c:abcdefabcdef"]');
    await settleAll();
    c.doc.querySelectorAll('.ui-sheet .ui-row')[1].dispatchEvent(new c.dom.window.MouseEvent('click', { bubbles: true }));
    await settleAll();
    const confirm = openDialog(c.doc);
    await new Promise((r) => setTimeout(r, 450));
    confirm.querySelectorAll('.ui-confirm__actions .ui-btn')[1].dispatchEvent(new c.dom.window.MouseEvent('click', { bubbles: true }));
    await settleAll(20);
    assert.ok(c.calls.some((x) => x.toast === 'Could not delete the station.'), 'the refusal is said: ' + JSON.stringify(c.calls.filter((x) => x.toast)));
    assert.ok(c.doc.querySelector('[data-station-key="c:abcdefabcdef"]'), 'the card stays');
  }, { deleteFails: true });
});
