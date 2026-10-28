'use strict';

// [UNIT] v1.397.0 native audio (D13): the sticker sheet's Sleep tile exists ONLY while the iOS app's engine owns playback;
// its strip posts the sleep intent through native-audio.js; without the api the sheet is byte-identical to before.

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const SS = require('../helpers/sticker-sheet.js');

const skinsPath = require.resolve('../../public/js/music-skins.js');
const surfacePath = require.resolve('../../public/js/skin-surface.js');
const HTML = `<body>
  <video id="media-player"></video>
  <button id="pp-btn"></button><button id="track-prev-btn"></button><button id="track-next-btn"></button>
  <input id="seek-bar" type="range" />
  <div id="panel" class="music-nowplaying-panel" hidden></div>
</body>`;
const rows = () => [0, 1, 2].map((i) => ({ index: i, title: 'T' + i, artist: 'A', durLabel: '3:00', state: i === 1 ? 'current' : (i < 1 ? 'played' : 'next') }));

function boot(nativeApi) {
  const dom = new JSDOM(HTML, { url: 'http://localhost/music' });
  const saved = { window: global.window, document: global.document, fetch: global.fetch, Event: global.Event };
  global.window = dom.window; global.document = dom.window.document; global.Event = dom.window.Event;
  dom.window.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  SS.installUi(dom);
  dom.window.showToast = () => {};
  dom.window.fetchCurrentUser = () => Promise.resolve({ user: { role: 'admin' } });
  dom.window.fetchLikedTotal = () => Promise.resolve(0);
  if (nativeApi) dom.window.FileTube = { nativeAudio: nativeApi };
  delete require.cache[skinsPath]; delete require.cache[surfacePath];
  global.module = undefined;
  dom.window.FileTubeMusicSkins = require(skinsPath);
  require(surfacePath);
  global.fetch = () => Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  const ctx = { track: { title: 'Song', artist: 'A', album: 'B', artUrl: '/albumart/x' }, upNext: rows(), fullList: rows(), playing: true, posSec: 10, durSec: 300, posLabel: '0:10', remLabel: '-4:50', curNum: 2, total: 3 };
  const engine = dom.window.FileTubeSkinSurface.create({
    panel: dom.window.document.getElementById('panel'),
    getSkinId: () => 'ipod', getCtx: () => ctx, hostCtl: (id) => dom.window.document.getElementById(id),
    onSelectIndex: () => {}, onDock: () => {}, win: dom.window, onHome: () => {},
    sticker: {
      onSkinChange: () => {},
      getPlayer: () => ({ isLoopEnabled: () => false, setLoop: () => {}, getCurrentTime: () => null, close() {} }),
      isChapterTrack: () => false,
      shuffle: { enabled: () => false, onToggle: () => {} },
      extras: { getBaseId: () => 's1', isEligible: () => true, onMutated() {}, signal: new AbortController().signal, offlineKind: 'track' },
    },
  });
  engine.paint();
  return { dom, engine, restore() { engine.destroy(); global.window = saved.window; global.document = saved.document; global.fetch = saved.fetch; global.Event = saved.Event; } };
}
async function openSheet(dom, rounds) {
  SS.clickEl(dom, dom.window.document.querySelector('#panel [data-skin-sticker]'));
  for (let i = 0; i < (rounds || 6); i++) await SS.settle();
  return SS.menuOf(dom);
}
function fakeNative(state) {
  const api = { enabled: true, calls: [], listeners: [], active: () => true, sleep: () => state.sleep, setSleep(mode, minutes) { api.calls.push([mode, minutes]); return true; }, onChange(fn) { api.listeners.push(fn); return () => {}; } };
  return api;
}

test('no native api (every browser, an app without nativeAudio): the sheet has no Sleep tile and no sleep strip', async () => {
  const b = boot(null);
  try {
    const menu = await openSheet(b.dom);
    assert.ok(menu, 'the sheet opened');
    assert.strictEqual(menu.querySelector('[data-skin-sleeptoggle]'), null);
    assert.strictEqual(menu.querySelector('[data-skin-sleep]'), null);
    assert.strictEqual(menu.querySelectorAll('.mms-ss__strip').length, 1, 'only the Speed strip');
  } finally { b.restore(); }
});

test('native active: a Sleep tile (Off) opens a strip of Off / 15 / 30 / 45 / 60 min / End of track; a pick posts the intent; the cap follows native\'s state; an inactive api hides it again', async () => {
  const state = { sleep: { mode: 'off' } };
  const na = fakeNative(state);
  const b = boot(na);
  try {
    let menu = await openSheet(b.dom);
    const tile = menu.querySelector('[data-skin-sleeptoggle]');
    assert.ok(tile, 'the Sleep tile exists');
    assert.strictEqual(tile.querySelector('.mms-ss__cap').textContent, 'Off');
    assert.strictEqual(tile.getAttribute('aria-pressed'), 'false');
    assert.strictEqual(menu.querySelectorAll('.mms-ss__strip').length, 2, 'Speed and Sleep strips');
    const strip = menu.querySelectorAll('.mms-ss__strip')[1];
    assert.strictEqual(strip.hidden, true, 'closed until the tile is tapped');
    SS.clickEl(b.dom, tile);
    for (let i = 0; i < 4; i++) await SS.settle();
    menu = SS.menuOf(b.dom);
    const chips = [...menu.querySelectorAll('[data-skin-sleep]')];
    assert.deepStrictEqual(chips.map((c) => c.getAttribute('data-skin-sleep')), ['off', '15', '30', '45', '60', 'end']);
    assert.deepStrictEqual(chips.map((c) => c.textContent.trim()), ['Off', '15 min', '30 min', '45 min', '60 min', 'End of track']);
    assert.strictEqual(menu.querySelectorAll('.mms-ss__strip')[1].hidden, false, 'the strip opened');
    SS.clickEl(b.dom, chips[2]);
    for (let i = 0; i < 4; i++) await SS.settle();
    assert.deepStrictEqual(na.calls, [['minutes', 30]], 'the pick posts audio.sleep { minutes: 30 } through the api');
    state.sleep = { mode: 'minutes', endsAt: Date.now() + 30 * 60000 };
    na.listeners.forEach((fn) => fn()); // native reports the armed timer
    for (let i = 0; i < 4; i++) await SS.settle();
    menu = SS.menuOf(b.dom);
    const tile2 = menu.querySelector('[data-skin-sleeptoggle]');
    assert.strictEqual(tile2.getAttribute('aria-pressed'), 'true');
    assert.match(tile2.querySelector('.mms-ss__cap').textContent, /^(29|30) min$/);
    assert.strictEqual(menu.querySelectorAll('.mms-ss__strip')[1].hidden, true, 'the strip closed on the pick');
    // End of track, then Off
    SS.clickEl(b.dom, tile2);
    for (let i = 0; i < 4; i++) await SS.settle();
    SS.clickEl(b.dom, SS.menuOf(b.dom).querySelector('[data-skin-sleep="end"]'));
    for (let i = 0; i < 4; i++) await SS.settle();
    state.sleep = { mode: 'endOfItem' }; na.listeners.forEach((fn) => fn());
    for (let i = 0; i < 4; i++) await SS.settle();
    assert.strictEqual(SS.menuOf(b.dom).querySelector('[data-skin-sleeptoggle] .mms-ss__cap').textContent, 'End of track');
    SS.clickEl(b.dom, SS.menuOf(b.dom).querySelector('[data-skin-sleeptoggle]'));
    for (let i = 0; i < 4; i++) await SS.settle();
    SS.clickEl(b.dom, SS.menuOf(b.dom).querySelector('[data-skin-sleep="off"]'));
    for (let i = 0; i < 4; i++) await SS.settle();
    assert.deepStrictEqual(na.calls, [['minutes', 30], ['endOfItem', undefined], ['off', undefined]]);
    // native lets go (a video started): the tile is gone on the next paint
    na.active = () => false; na.listeners.forEach((fn) => fn());
    for (let i = 0; i < 4; i++) await SS.settle();
    assert.strictEqual(SS.menuOf(b.dom).querySelector('[data-skin-sleeptoggle]'), null);
  } finally { b.restore(); }
});
