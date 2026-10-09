'use strict';

// [UNIT] v1.378.0 music stations W4 (plan docs/exec-plans/active/2026-10-09-music-stations.md, D11, D12): the
// Pocket Radio row (the main menu, right after Music), the "Radio: <name>" line on EVERY skin (one writer,
// the inert-sibling class: the test renders every registered skin), the remote channel carrying a station
// (the phone's play command, the speaker's report, the phone's mirror) and the desktop panel's context line.

const { test } = require('node:test');
const assert = require('node:assert');
const SK = require('../../public/js/music-skins.js');
const R = require('../../public/js/remote.js');
const fs = require('node:fs');
const path = require('node:path');

const CTX = {
  track: { title: 'Song', artist: 'Band', album: 'Rec', artUrl: '' }, artistTap: false, artistTitle: '',
  upNext: [], fullList: [], playing: true, posSec: 5, durSec: 100, posLabel: '0:05', remLabel: '-1:35', curNum: 1, total: 1,
};
const HOSTILE = '<b>Reggae</b> & "Dub"';

test('D11: the main menu has Radio right after Music, with and without the optional rows; its title is Radio; its rows come from the view', () => {
  const labels = (o) => SK.menuStaticItems({ type: 'main' }, o).map((r) => r.label);
  assert.deepStrictEqual(labels({}), ['Music', 'Radio', 'Settings', 'Shuffle Songs']);
  const full = labels({ hasGames: true, hasSkins: true, hasPlayOn: true, hasCurrent: true });
  assert.deepStrictEqual(full, ['Music', 'Radio', 'Extras', 'Settings', 'Shuffle Songs', 'Speakers', 'Now Playing']);
  assert.deepStrictEqual(SK.menuStaticItems({ type: 'main' }, {}).find((r) => r.label === 'Radio').node, { type: 'radio' });
  assert.strictEqual(SK.menuStaticItems({ type: 'radio' }, {}), null, 'a level the view loads (GET /api/music/stations)');
  assert.strictEqual(SK.menuTitle({ type: 'radio' }), 'Radio');
  // the smallest skins' LCD list scrolls: a 7-row main menu is windowed, never squeezed (menuWindow holds the cursor)
  const w = SK.menuWindow(7, 6, 0, 0, 0, 0);
  assert.ok(w.start <= 6 && w.end >= 7, 'the last row (Now Playing) stays reachable: ' + JSON.stringify(w));
});

test('D11 / D12: every skin shows "Radio: <name>" while a station plays, escaped, and nothing of it otherwise', () => {
  assert.ok(SK.IDS.length > 10, 'the real skin list');
  for (const id of SK.IDS) {
    const on = SK.renderFull(id, Object.assign({}, CTX, { radio: { name: HOSTILE } }));
    assert.ok(on.indexOf('Radio: &lt;b&gt;Reggae&lt;/b&gt; &amp; &quot;Dub&quot;') !== -1, id + ' shows the station line, escaped');
    assert.ok(on.indexOf('<b>Reggae</b>') === -1, id + ' never renders the name as markup');
    const off = SK.renderFull(id, CTX);
    assert.ok(off.indexOf('Radio:') === -1, id + ' has no station line without a station');
    const blank = SK.renderFull(id, Object.assign({}, CTX, { radio: { name: '   ' } }));
    assert.ok(blank.indexOf('Radio:') === -1, id + ': a blank name is no station');
  }
  // Nordic: the context line is the station instead of the album; the Click LCD: the album slot
  assert.ok(/mms-ctx mms-radio">Radio: Chill</.test(SK.renderFull('spotify', Object.assign({}, CTX, { radio: { name: 'Chill' } }))));
  assert.ok(/Playing from Rec/.test(SK.renderFull('spotify', CTX)));
  assert.ok(/ip-album ip-radio">Radio: Chill</.test(SK.renderFull('ipod', Object.assign({}, CTX, { radio: { name: 'Chill' } }))));
  assert.ok(/ip-album">Rec</.test(SK.renderFull('ipod', CTX)));
  assert.ok(/mms-ctx mms-radio">Radio: Chill</.test(SK.renderFull('apple', Object.assign({}, CTX, { radio: { name: 'Chill' } }))));
});

test('D12: the speaker\'s report carries the station only while a song plays; a name is trimmed and bounded', () => {
  const snap = { id: 't1', position: 1, duration: 100, playing: true };
  assert.deepStrictEqual(R.buildStatePayload('pc', snap, false, false, null, { name: '  Chill ' }).radio, { name: 'Chill' });
  assert.strictEqual(R.buildStatePayload('pc', snap, false, false, null, null).radio, null);
  assert.strictEqual(R.buildStatePayload('pc', snap, false, false, null, { name: '' }).radio, null);
  assert.strictEqual(R.buildStatePayload('pc', { id: null }, false, false, null, { name: 'Chill' }).radio, null, 'idle: no station');
  assert.strictEqual(R.buildStatePayload('pc', snap, false, false, null, { name: 'x'.repeat(80) }).radio.name.length, 60);
});

test('D11 / D12 wiring (source): the speaker reader reports the station, the handler plays a sent station as a station with Autoplay on, the phone sends the station with its play command, the mirror reads it', () => {
  const MUSIC = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'music.js'), 'utf8');
  assert.match(MUSIC, /REMOTE\.setQueueReader\(function \(\) \{ var ci = currentSkinIndex\(\); return ci >= 0 && ci < queue\.length \? \{ list: queue, index: ci, radio: stationRadioName\(\) \? \{ name: stationRadioName\(\) \} : null \} : null; \}\);/);
  const handler = MUSIC.slice(MUSIC.indexOf('var remotePlay = function (req) {'), MUSIC.indexOf('REMOTE.setMusicPlayHandler(remotePlay);'));
  assert.match(handler, /req\.radio\.seed\.indexOf\('station:'\) === 0/, 'a station seed only');
  assert.match(handler, /play\.ctx = \{ src: 'music', radio: radio\.seed \};/);
  assert.match(handler, /play\.ctx\.radioName = radio\.name\.trim\(\)\.slice\(0, 60\);/);
  assert.match(handler, /if \(!autoplayEnabled\(\)\) \{ setAutoplayEnabled\(true\); reflectPlaybackModes\(\); \}/);
  assert.match(handler, /markAutoplayPicks\(Array\.isArray\(req\.tracks\) \? req\.tracks\.slice\(1\) : \[\]\);/);
  const remotePlayAt = MUSIC.slice(MUSIC.indexOf('function remotePlayAt(i) {'), MUSIC.indexOf('function playOnItems() {'));
  assert.match(remotePlayAt, /RC\.play\(ids, idx, rseed \? \{ seed: rseed, name: stationRadioName\(\) \} : null\);/);
  const mirror = MUSIC.slice(MUSIC.indexOf('function remoteSkinCtx() {'), MUSIC.indexOf('function remotePlayAt('));
  assert.match(mirror, /radio: \(st\.radio && typeof st\.radio\.name === 'string' && st\.radio\.name\) \? \{ name: st\.radio\.name \} : null/);
  const level = MUSIC.slice(MUSIC.indexOf('function menuRadioLevel() {'), MUSIC.indexOf('function withRadioRow('));
  assert.match(level, /fetchJson\('\/api\/music\/stations'\)/);
  assert.match(level, /if \(!st \|\| !st\.key \|\| st\.hidden\) continue;/, 'hidden stations are left out (D8)');
  assert.match(level, /action: 'radio', seed: 'station:' \+ st\.key, stationName: st\.name/);
  assert.match(MUSIC, /onStartRadio: function \(seed, name\) \{ startRadio\(seed, null, name\); \}/);
  const SURFACE = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'skin-surface.js'), 'utf8');
  assert.match(SURFACE, /cfg\.onStartRadio\(it\.seed, it\.stationName\)/);
});

test('D10: the desktop panel\'s context line (skin-surface buildPanelHtml) shows the station, escaped, only when given', () => {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<body></body>');
  const saved = { window: global.window, document: global.document };
  global.window = dom.window; global.document = dom.window.document;
  try {
    delete require.cache[require.resolve('../../public/js/skin-surface.js')];
    require('../../public/js/skin-surface.js');
    const S = dom.window.FileTubeSkinSurface;
    const html = S.buildPanelHtml({ title: 'Song', subline: 'Band', context: 'Radio: ' + HOSTILE }, []);
    assert.ok(html.indexOf('<div class="mnp-ctx">Radio: &lt;b&gt;Reggae&lt;/b&gt; &amp; &quot;Dub&quot;</div>') !== -1, html.slice(0, 200));
    assert.ok(S.buildPanelHtml({ title: 'Song', subline: 'Band' }, []).indexOf('mnp-ctx') === -1);
  } finally { delete require.cache[require.resolve('../../public/js/skin-surface.js')]; Object.assign(global, saved); }
});

// ---- gate r1 adversary W3 (M27 / M28): the D11 wiring at BOTH ends, through the real music.js ---------
test('gate r1 M27 / M28: a phone driving a speaker sends the station with its play command; a speaker handed a station plays it AS a station (its context and name, Autoplay on)', async () => {
  const { JSDOM } = require('jsdom');
  const common = require('../../public/js/common.js');
  const musicPath = require.resolve('../../public/js/music.js');
  const TRACKS = [
    { id: 'r1', title: 'Reggae One', artist: 'Band A', album: 'Roots', albumKey: 'Band A␟Roots', durationSec: 200, source: 'native' },
    { id: 'r2', title: 'Reggae Two', artist: 'Band B', album: 'Dub', albumKey: 'Band B␟Dub', durationSec: 200, source: 'native' },
  ];
  const STATIONS = [{ key: 's:reggae', name: 'Reggae', kind: 'style', subtitle: '52 songs', count: 52, strict: false, group: 'main', hidden: false, artIds: ['a1'], artVs: [null] }];
  const VIEW_HTML = `<body><div id="view-root" data-view="music">
    <select id="music-sort-select"></select><button id="music-view-toggle" hidden><i></i></button>
    <button id="music-autoplay-btn" type="button" aria-pressed="false">Autoplay</button>
    <div id="player-slot"></div><video id="media-player"></video>
    <div id="music-nowplaying-panel" class="music-nowplaying-panel"></div>
    <button type="button" class="music-nowplaying" id="music-nowplaying" hidden></button>
    <section id="music-jumpback" hidden></section>
    <div class="music-tabs" id="music-tabs" role="tablist"><button type="button" class="music-tab active" data-tab="home" role="tab">Home</button></div>
    <div id="music-crumb" hidden></div><div id="music-status" role="status" hidden></div>
    <div id="music-content"></div><div id="music-empty" hidden></div></div></body>`;
  const settle = () => new Promise((r) => setImmediate(r));
  async function settleAll(n) { for (let i = 0; i < (n || 12); i++) { await settle(); await new Promise((r) => setTimeout(r, 2)); } }
  async function boot(remoteOn, run) {
    const dom = new JSDOM(VIEW_HTML, { url: 'http://localhost/music' });
    const saved = { window: global.window, document: global.document, localStorage: global.localStorage, fetch: global.fetch, AbortController: global.AbortController, Event: global.Event, requestAnimationFrame: global.requestAnimationFrame };
    global.window = dom.window; global.document = dom.window.document; global.localStorage = dom.window.localStorage;
    global.AbortController = dom.window.AbortController; global.Event = dom.window.Event; global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
    dom.window.localStorage.setItem('filetube_music_tab', 'home');
    dom.window.localStorage.setItem('ft-music-autoplay', '0');
    dom.window.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
    dom.window.scrollTo = () => {};
    dom.window.encodeListContext = common.encodeListContext;
    const calls = []; const rcPlays = []; let playHandler = null;
    const playerState = { currentId: null, meta: null, lastData: null, state: 'docked' };
    dom.window.FileTube = {
      registerView: (n, m) => { dom.window.__m = m; },
      encodeListContext: common.encodeListContext, decodeListContext: common.decodeListContext, shimmerArt: () => {},
      player: { currentId: null, getState: () => playerState.state, expand: () => { playerState.state = 'full'; }, getCurrentMeta: () => playerState.meta, pause: () => {},
        load: (id, data) => { playerState.currentId = id; dom.window.FileTube.player.currentId = id; playerState.state = 'full'; playerState.lastData = data; playerState.meta = { isMusic: true, id, browseCtx: data && data.browseCtx }; },
        setTrackNav: () => {} },
      // the controller handle (RC): a speaker chosen
      remoteControl: { isRemote: () => remoteOn, state: () => ({ state: 'idle', track: null, queue: null, radio: null }), play: (ids, idx, radio) => { rcPlays.push({ ids, idx, radio }); return Promise.resolve(true); },
        label: () => 'Desk', targetId: () => (remoteOn ? 'pc' : null), position: () => 0, seek: () => {}, leave: () => {}, select: () => {}, toggle: () => {}, prev: () => {}, next: () => {},
        onChange: () => () => {}, consumeResume: () => null, fetchTargets: () => Promise.resolve([]), volume: () => null },
      // the target handle (REMOTE): this tab as a speaker
      remote: { setMusicPlayHandler: (fn) => { playHandler = fn; }, setQueueReader: () => {}, setNowPlayingResolver: () => {}, isOn: () => false, onChange: () => () => {}, toggle: () => {}, trackChanged: () => {} },
    };
    dom.window.showToast = () => {};
    global.fetch = (url, init) => {
      const u = String(url); const method = (init && init.method) || 'GET';
      calls.push({ method, url: u, body: init && init.body ? JSON.parse(init.body) : undefined });
      const json = (o) => Promise.resolve({ ok: true, status: 200, json: async () => o });
      if (u === '/api/music/stations') return json({ stations: STATIONS });
      if (u.indexOf('/api/music/radio?') === 0) return json({ items: TRACKS });
      if (u.indexOf('/api/music/artists') === 0 || u.indexOf('/api/music/albums') === 0 || u.indexOf('/api/music?') === 0) return json({ items: [] });
      return json({ ok: true, items: [] });
    };
    try {
      delete require.cache[musicPath];
      require(musicPath);
      dom.window.__m.init(dom.window.document.getElementById('view-root'));
      await settleAll();
      await run({ dom, doc: dom.window.document, calls, rcPlays, playerState, handler: () => playHandler });
      dom.window.__m.destroy();
    } finally { delete require.cache[musicPath]; Object.assign(global, saved); }
  }
  // M28: the phone (a speaker chosen) taps a station card: the play command carries the seed and the name, nothing loads here
  await boot(true, async (c) => {
    const tile = c.doc.querySelector('.music-station-tile[data-station-key="s:reggae"]');
    assert.ok(tile, 'the shelf rendered');
    tile.dispatchEvent(new c.dom.window.MouseEvent('click', { bubbles: true }));
    await settleAll();
    assert.strictEqual(c.rcPlays.length, 1, 'one play command to the speaker');
    assert.deepStrictEqual(c.rcPlays[0], { ids: ['r1', 'r2'], idx: 0, radio: { seed: 'station:s:reggae', name: 'Reggae' } });
    assert.strictEqual(c.playerState.currentId, null, 'nothing loaded on the phone');
  });
  // M27: the speaker receives the command: it plays as a station (ctx + name), Autoplay turned on
  await boot(false, async (c) => {
    assert.strictEqual(typeof c.handler(), 'function', 'the view registered its play handler');
    c.handler()({ tracks: TRACKS, index: 0, label: 'Phone', radio: { seed: 'station:s:reggae', name: 'Reggae' } });
    await settleAll();
    assert.strictEqual(c.playerState.currentId, 'r1');
    assert.deepStrictEqual(JSON.parse(c.playerState.lastData.browseCtx), { src: 'music', radio: 'station:s:reggae', radioName: 'Reggae' }, 'the speaker\'s queue IS the station');
    assert.strictEqual(c.dom.window.localStorage.getItem('ft-music-autoplay'), '1', 'Autoplay on so the station continues');
    assert.strictEqual(c.doc.getElementById('music-nowplaying').textContent, 'Radio: Reggae');
    // a plain play from the phone stays a plain flat list
    c.handler()({ tracks: TRACKS, index: 1, label: 'Phone' });
    await settleAll();
    assert.strictEqual(JSON.parse(c.playerState.lastData.browseCtx).radio, undefined, 'no station: no seed in the context');
  });
});
