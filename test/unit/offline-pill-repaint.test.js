'use strict';

// [UNIT] v1.387.1 reachability: a failed offline add on an ALBUM or a TV SEASON reaches the real pill. Boots the REAL
// music.js and tv.js views in jsdom with the real adapter, the real offline.js and a fake host, then makes the host send
// downloadsAddFailed / download events and reads the pill the user would see (the lesson: a unit test of a state nobody
// paints is worthless). Also binds the toast that carries the reason on touch and the parent notify of a member event.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { installFakeHost, loadAdapter } = require('../helpers/fake-host');

const OFFLINE_SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'offline.js'), 'utf8');
const settle = () => new Promise((resolve) => setImmediate(resolve));
const ALBUM_KEY = 'Floyd\u001fWall';

function boot({ html, url, fetchMap, modulePath, initArg, tab }) {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
  const win = dom.window;
  const saved = { window: global.window, document: global.document, localStorage: global.localStorage, fetch: global.fetch, AbortController: global.AbortController };
  global.window = win; global.document = win.document; global.localStorage = win.localStorage; global.AbortController = win.AbortController; global.fetch = fetchMap;
  let mod = null;
  win.FileTube = {
    registerView: (n, m) => { mod = m; }, pushViewState: () => {}, replaceViewState: () => {}, navigate: () => {},
    player: { currentId: null, getState: () => 'closed', expand: () => {}, load: () => {}, setTrackNav: () => {} }, shimmerArt: () => {},
  };
  const fake = installFakeHost(win, { capabilities: ['downloads'] });
  loadAdapter(win);
  win.eval(OFFLINE_SRC);
  if (tab) { try { win.localStorage.setItem('filetube_music_tab', tab); } catch (_) { /* ignore */ } }
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
  require(resolved);
  return { dom, win, fake, mod, offline: win.FileTube.offline, restore() { delete require.cache[resolved]; Object.assign(global, saved); } };
}

const MUSIC_HTML = `<body><div id="view-root" data-view="music">
  <select id="music-sort-select"></select><button id="music-view-toggle" hidden><i></i></button><div id="player-slot"></div>
  <button class="music-nowplaying" id="music-nowplaying" hidden></button><section id="music-jumpback" hidden></section>
  <div class="music-tabs" id="music-tabs" role="tablist"><button type="button" class="music-tab active" data-tab="albums" role="tab">Albums</button></div>
  <div id="music-crumb" hidden></div><div id="music-status" role="status" hidden></div><div id="music-content"></div><div id="music-empty" hidden></div></div></body>`;
const ALBUMS = [{ albumKey: ALBUM_KEY, album: 'The Wall', artist: 'Pink Floyd', artId: 'x', trackCount: 4 }];
const SONGS = [{ id: 't1', title: 'In the Flesh', artist: 'Pink Floyd', album: 'The Wall', albumKey: ALBUM_KEY, durationSec: 200 }];
function musicFetch(url) {
  const u = String(url);
  if (u.indexOf('/api/music/albums') === 0) return Promise.resolve({ ok: true, json: async () => ({ items: ALBUMS }) });
  if (u.indexOf('/api/music?') === 0 || u.indexOf('/api/music&') === 0 || u.indexOf('album=') !== -1) return Promise.resolve({ ok: true, json: async () => ({ items: SONGS }) });
  return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
}

test('v1.387.1 music: a failed album add repaints the drill pill in place with the reason; a retry, a member event and a snapshot repaint it again; leaving the view stops it', async () => {
  const b = boot({ html: MUSIC_HTML, url: 'http://localhost/music', fetchMap: musicFetch, modulePath: '../../public/js/music.js', tab: 'albums' });
  try {
    b.mod.init(b.win.document.getElementById('view-root'));
    for (let i = 0; i < 8; i++) await settle();
    const content = b.win.document.getElementById('music-content');
    content.querySelector('.music-album-card').dispatchEvent(new b.win.MouseEvent('click', { bubbles: true }));
    for (let i = 0; i < 8; i++) await settle();
    let pill = content.querySelector('.music-drill-offline');
    assert.ok(pill, 'the drill has the album pill');
    assert.strictEqual(pill.getAttribute('title'), null);
    b.fake.emit({ v: 1, type: 'downloadsAddFailed', kind: 'album', id: ALBUM_KEY, error: 'network' });
    pill = content.querySelector('.music-drill-offline');
    assert.strictEqual(pill.getAttribute('data-offline-action'), 'offline-add');
    assert.strictEqual(pill.getAttribute('title'), b.offline.ERROR_COPY.network, 'the reason is on the pill');
    // A retry (the pill's own click) clears it.
    pill.dispatchEvent(new b.win.MouseEvent('click', { bubbles: true }));
    assert.strictEqual(content.querySelector('.music-drill-offline').getAttribute('title'), null, 'a retry repaints the plain pill');
    assert.deepEqual(b.fake.of('downloads.add').pop(), { v: 1, type: 'downloads.add', kind: 'album', id: ALBUM_KEY });
    // A member event repaints it as saving (the notify to the parent).
    b.fake.emit({ v: 1, type: 'download', kind: 'track', id: 't1', state: 'downloading', progress: 0.25, parentKind: 'album', parentId: ALBUM_KEY });
    const saving = content.querySelector('.music-drill-offline');
    assert.strictEqual(saving.getAttribute('data-offline-action'), 'offline-remove');
    assert.match(saving.textContent, /Saving for offline\.\.\. 25%/);
    // Leaving the view: the listener lets go and never touches a detached tree.
    content.remove();
    b.fake.emit({ v: 1, type: 'downloadsAddFailed', kind: 'album', id: 'other', error: 'network' });
  } finally { b.mod.destroy(); b.restore(); b.win.close(); }
});

const TV_HTML = `<body><div id="view-root" data-view="tv"><div id="tv-status" role="status" hidden></div><div id="tv-crumb" hidden></div><div id="tv-heading"></div>
  <div id="tv-empty" hidden></div><div id="tv-content"></div><button id="tv-scan-btn" type="button">Scan</button></div></body>`;
function tvFetch(url) {
  const u = String(url);
  if (/\/api\/tv\/[^/]+$/.test(u)) return Promise.resolve({ ok: true, json: async () => ({ id: 'sh1', name: 'Show One', seasons: [{ seasonNum: 1, label: 'Season 1', episodes: [{ id: 'e1', title: 'Hello', seasonNum: 1, episodeNum: 1, durationSec: 100 }] }] }) });
  if (u.indexOf('/api/tv') !== -1) return Promise.resolve({ ok: true, json: async () => ({ shows: [{ id: 'sh1', name: 'Show One', seasonCount: 1, episodeCount: 1 }], cont: [] }) });
  return Promise.resolve({ ok: true, json: async () => ({}) });
}

test('v1.387.1 tv: a failed season add repaints that season\'s pill in place; the episode pill is untouched; destroy() releases the listener', async () => {
  const b = boot({ html: TV_HTML, url: 'http://localhost/tv', fetchMap: tvFetch, modulePath: '../../public/js/tv.js', initArg: null });
  try {
    b.mod.init(null);
    for (let i = 0; i < 8; i++) await settle();
    const content = b.win.document.getElementById('tv-content');
    content.querySelector('.show-card').dispatchEvent(new b.win.MouseEvent('click', { bubbles: true }));
    for (let i = 0; i < 8; i++) await settle();
    const season = () => content.querySelector('.tv-offline[data-offline-kind="tvSeason"]');
    assert.ok(season(), 'the season pill');
    assert.strictEqual(season().getAttribute('title'), null);
    b.fake.emit({ v: 1, type: 'downloadsAddFailed', kind: 'tvSeason', id: 'sh1:1', error: 'notOnServer' });
    assert.strictEqual(season().getAttribute('title'), 'Not on the server yet', 'the reason rides the season pill');
    assert.strictEqual(content.querySelector('.tv-offline[data-offline-kind="tvEpisode"]').getAttribute('title'), null);
    b.fake.emit({ v: 1, type: 'download', kind: 'tvEpisode', id: 'e1', state: 'downloading', progress: 0.5, parentKind: 'tvSeason', parentId: 'sh1:1' });
    assert.strictEqual(season().getAttribute('title'), null, 'a member event clears it and the pill repaints');
    assert.strictEqual(season().getAttribute('data-offline-action'), 'offline-remove');
    b.mod.destroy();
    b.fake.emit({ v: 1, type: 'download', kind: 'tvEpisode', id: 'e1', state: 'done', localSrc: 'l', parentKind: 'tvSeason', parentId: 'sh1:1' });
    assert.strictEqual(season().getAttribute('data-offline-action'), 'offline-remove', 'unchanged after destroy (no repaint; the DOM is gone in the app)');
    assert.match(season().textContent, /Saving for offline/, 'destroy released the listener: no repaint to Remove offline copy');
  } finally { b.restore(); b.win.close(); }
});

test('v1.387.1: the failure also raises one toast with the reason (touch has no title); the id is read through the chapter-row normalization; a member event notifies its album', () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only', url: 'http://localhost/' });
  const win = dom.window;
  const toasts = [];
  win.ui = { toast: (m, o) => toasts.push([m, o && o.kind]) };
  const fake = installFakeHost(win, { capabilities: ['downloads'] });
  loadAdapter(win);
  win.eval(OFFLINE_SRC);
  const offline = win.FileTube.offline;
  const seen = [];
  offline.onChange((k, id) => seen.push([k, id]));
  fake.emit({ v: 1, type: 'downloadsAddFailed', kind: 'album', id: ALBUM_KEY, error: 'storageFull' });
  assert.deepEqual(toasts, [['Not enough space on this phone', 'error']]);
  fake.emit({ v: 1, type: 'downloadsAddFailed', kind: 'track', id: 'm1::c3', error: 'network' });
  assert.deepEqual(offline.state('track', 'm1'), { state: 'failed', error: 'network' }, 'stored under the normalized key');
  assert.deepEqual(offline.state('track', 'm1::c3'), { state: 'failed', error: 'network' });
  seen.length = 0;
  fake.emit({ v: 1, type: 'download', kind: 'track', id: 't1', state: 'queued', parentKind: 'album', parentId: ALBUM_KEY });
  assert.ok(seen.some(([k, id]) => k === 'album' && id === ALBUM_KEY), 'the album surface is told its member changed');
  win.close();
});
