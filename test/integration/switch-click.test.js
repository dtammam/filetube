'use strict';

// [INTEGRATION] v1.406.1 switch-click (plan docs/exec-plans/active/2026-11-08-switch-click.md, W1): what the web posts to the
// native host when the user switches from a docked, playing video to another one. The REAL watch view (watch.js, common.js,
// main.js), the REAL player (player.js) and native bridge (native-audio.js, host-adapter.js) run in one jsdom realm with a fake
// host; the seeds and detail records are the SERVER-EMITTED shapes (GET /api/home?view=grid for Modern, GET /api/videos for
// Classic, GET /api/videos/:id for hydration), never hand-typed (LESSONS 2). Every message to native is recorded in order.
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-switch-click-'));

const { test, before, after, afterEach } = require('node:test');
const assert = require('node:assert');
const { JSDOM, VirtualConsole } = require('jsdom');
const { app } = require('../../server');
const { seedState } = require('../helpers/seed-state');
const { authenticateFetch } = require('../helpers/auth');
const { installFakeHost } = require('../helpers/fake-host');

const REPO = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CAPS = ['nativeAudio', 'nativeVideoAudio', 'nativeVideo', 'nativeVideoDock'];
const MODES = { autoplay: true, shuffle: false, loop: 'off' };
const HYDRATE_MS = 250; // the two hydration fetches (a phone round trip)
const LOAD_MS = 40;     // the app's first snapshot of a load
const PLAY_MS = 120;    // audio.play -> 'playing'

let server;
let base;
const shapes = {};
before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  authenticateFetch(server, base);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-switch-lib-'));
  const mk = (n, ext) => { const p = path.join(root, `${n}${ext || '.mp4'}`); fs.writeFileSync(p, 'x'); return p; };
  const common = { folderName: path.basename(root), rootFolder: root, size: 12345, duration: 600 };
  seedState({
    folders: [root], folderSettings: {}, liked: [],
    settings: { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30 },
    metadata: {
      va: { ...common, id: 'va', title: 'Video A', type: 'video', ext: '.mp4', filePath: mk('va'), addedAt: 5, hasThumbnail: true, needsTranscode: false, width: 1920, height: 1080, audioStatus: 'ready' },
      vb: { ...common, id: 'vb', title: 'Video B', type: 'video', ext: '.mp4', filePath: mk('vb'), addedAt: 4, hasThumbnail: true, needsTranscode: false, width: 1920, height: 1080, audioStatus: 'ready' },
      ta: { ...common, id: 'ta', title: 'Song A', type: 'audio', ext: '.mp3', filePath: mk('ta', '.mp3'), addedAt: 3, hasThumbnail: true, needsTranscode: false },
    },
  });
  const get = async (u) => { const r = await fetch(base + u); assert.equal(r.status, 200, u); return r.json(); };
  const grid = await get('/api/home?view=grid');
  shapes.grid = Object.fromEntries((grid.items || []).map((it) => [it.id, it]));
  const list = await get('/api/videos?limit=50');
  shapes.list = Object.fromEntries((list.items || list.videos || list || []).map((it) => [it.id, it]));
  shapes.detail = { va: await get('/api/videos/va'), vb: await get('/api/videos/vb') };
  shapes.config = await get('/api/config');
});
const realms = new Set();
const teardown = (r) => { if (!realms.has(r)) return; realms.delete(r); r.stopApp(); r.w.close(); };
afterEach(() => { for (const r of Array.from(realms)) teardown(r); });
after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

// The watch.html shell with the scripts a soft-nav'd watch view runs on, in the shell's order (one eval: classic scripts share
// one lexical scope). The router's two hooks the switch rides are driven as the router drives them: applyPlayerTransition docks
// on leaving watch, and the incoming watch view's init(root) runs on a fresh #view-root.
function realm(opts) {
  opts = opts || {}; // pictureField: the app reports audioState.pictureReady
  const dom = new JSDOM(read('public/watch.html'), { url: 'http://localhost/watch.html?v=va', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
  const w = dom.window;
  w.matchMedia = (q) => ({ matches: /max-width:\s*768px|pointer:\s*coarse|hover:\s*none/.test(q) && !/any-pointer/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  w.scrollTo = () => {};
  w.HTMLMediaElement.prototype.load = function () {};
  w.HTMLMediaElement.prototype.pause = function () {};
  // the WEB element axis (what native-post counts cannot see): every play() and every src set on any media element
  const webMedia = [];
  const tag = (el) => (el.tagName || '').toLowerCase() + '#' + (el.id || '?');
  w.HTMLMediaElement.prototype.play = function () { webMedia.push({ t: Date.now(), ev: 'play() ' + tag(this) + ' src=' + (this.getAttribute('src') || '') }); return Promise.resolve(); };
  const srcDesc = Object.getOwnPropertyDescriptor(w.HTMLMediaElement.prototype, 'src');
  Object.defineProperty(w.HTMLMediaElement.prototype, 'src', { configurable: true, get: srcDesc.get, set(v) { webMedia.push({ t: Date.now(), ev: 'src= ' + tag(this) + ' ' + v }); srcDesc.set.call(this, v); } });
  // v1.406.1 (W2): the REAL element resets too - load(), pause() and removeAttribute('src') on any media element (native-audio
  // proxies play / pause on the shared element while it owns it, so a proxied pause never reaches the prototype). Dean's device
  // test: a media load() inside the tap's gesture with no web media active clicked the audio native was playing.
  const realLoad = w.HTMLMediaElement.prototype.load;
  w.HTMLMediaElement.prototype.load = function () { webMedia.push({ t: Date.now(), ev: 'load() ' + tag(this) }); return realLoad.call(this); };
  const realPause = w.HTMLMediaElement.prototype.pause;
  w.HTMLMediaElement.prototype.pause = function () { webMedia.push({ t: Date.now(), ev: 'pause() ' + tag(this) }); return realPause.call(this); };
  const realRemove = w.Element.prototype.removeAttribute;
  w.Element.prototype.removeAttribute = function (n) { if (n === 'src' && this instanceof w.HTMLMediaElement) webMedia.push({ t: Date.now(), ev: 'removeAttribute(src) ' + tag(this) }); return realRemove.call(this, n); };
  const setAttr = w.Element.prototype.setAttribute;
  w.Element.prototype.setAttribute = function (n, v) { if (n === 'src' && this instanceof w.HTMLMediaElement) webMedia.push({ t: Date.now(), ev: 'setAttribute(src) ' + tag(this) + ' ' + v }); return setAttr.call(this, n, v); };
  w.navigator.mediaSession = { metadata: null, playbackState: 'none', setActionHandler() {}, setPositionState() {} };
  w.MediaMetadata = function (init) { Object.assign(this, init); };
  const json = (body, status) => Promise.resolve({ ok: (status || 200) < 300, status: status || 200, json: async () => body, text: async () => JSON.stringify(body) });
  w.fetch = (u) => {
    const url = String(u);
    // the two hydration fetches answer after a phone-like round trip (the window the seed path starts early in)
    if (url === '/api/config') return sleep(HYDRATE_MS).then(() => json(shapes.config));
    const m = /^\/api\/videos\/([^/?]+)$/.exec(url);
    if (m && shapes.detail[m[1]]) return sleep(HYDRATE_MS).then(() => json(shapes.detail[m[1]]));
    if (url === '/api/settings') return json({ backgroundAudioForVideo: true });
    if (url === '/api/auth/me') return json({ user: { username: 'admin', role: 'admin' } });
    if (/^\/api\/progress\//.test(url)) return json({ timestamp: 0 });
    if (url.indexOf('/api/queue') === 0) return json({ entries: [], pointerUid: null });
    if (url.indexOf('/api/videos?') === 0) return json({ items: [], total: 0 });
    return json({});
  };
  const fake = installFakeHost(w, { capabilities: opts.caps || CAPS }); // caps: ['orientation'] = a host without native audio (the web plays)
  // stamp each post with the ms since the last tap (the timing axis of an audible cut)
  let tapAt = Date.now();
  const rawPost = fake.host.post;
  fake.host.post = function (msg) { rawPost.call(this, Object.assign({}, msg, { __t: Date.now() - tapAt })); };
  // the picture's box: the slot's, or the dock's once the wrapper sits in #player-dock (live-dock-realm's geometry)
  const SLOT_BOX = { left: 0, top: 300, width: 393, height: 221 };
  const DOCK_BOX = { left: 225, top: 640, width: 160, height: 90 };
  const boxNow = () => { const wr = w.document.getElementById('player-wrapper'); const b = wr && wr.closest('#player-dock') ? DOCK_BOX : (wr && wr.closest('#view-root') ? SLOT_BOX : null); if (!b) return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0 }; return { ...b, right: b.left + b.width, bottom: b.top + b.height, x: b.left, y: b.top }; };
  w.HTMLVideoElement.prototype.getBoundingClientRect = boxNow;
  w.HTMLDivElement.prototype.getBoundingClientRect = function () { return this.id === 'player-wrapper' ? boxNow() : { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0 }; };
  const views = {};
  const order = ['host-adapter.js', 'offline.js', 'native-audio.js', 'icons.js', 'glyph-pool.js', 'body-scroll-lock.js', 'ui.js', 'interaction.js', 'common.js', 'main.js', 'rich-text.js', 'watch.js', 'player.js'];
  const srcs = [];
  for (const f of order) {
    if (f === 'watch.js') srcs.push('window.FileTube = window.FileTube || {}; window.__realRegister = window.FileTube.registerView; window.FileTube.registerView = function (n, h) { window.__views[n] = h; };');
    srcs.push(read('public/js/' + f));
  }
  w.__views = views;
  w.eval(srcs.join('\n;\n'));
  const pristine = w.document.getElementById('view-root').cloneNode(true);
  let root = w.document.getElementById('view-root');
  // A model of the app (v0.17, today's build): an audio.load answers 'loading' (autoplay false) after LOAD_MS, an audio.play
  // answers 'playing' after PLAY_MS and starts an audioTick about once a second, an audio.pause / audio.stop answer at once.
  // `pictureField` (opts) adds audioState.pictureReady (the app build v1.406.0 asked for; today's app does not send it).
  const app = { rev: 0, queue: [], index: 0, state: 'idle', pos: 0, seen: 0, ticks: null };
  const snapOut = () => fake.emit(Object.assign({ v: 1, type: 'audioState', rev: app.rev, queue: app.queue, index: app.index, state: app.state, positionSec: app.pos, durationSec: 600, rate: 1, modes: MODES, sleep: { mode: 'off' } }, opts.pictureField ? { pictureReady: app.state === 'playing' } : {}));
  const later = (ms, fn) => setTimeout(() => { if (app.seen !== Infinity) fn(); }, ms); // nothing answers after teardown
  const answer = () => {
    while (app.seen < fake.posts.length) {
      const m = fake.posts[app.seen++];
      if (m.type === 'audio.load') { const rev = m.rev; app.rev = rev; app.queue = m.queue; app.index = m.index; app.pos = m.positionSec || 0; app.state = 'loading'; clearInterval(app.ticks); later(LOAD_MS, () => { if (app.rev === rev) snapOut(); }); }
      else if (m.type === 'audio.play') { const rev = app.rev; later(PLAY_MS, () => { if (app.rev !== rev) return; app.state = 'playing'; snapOut(); clearInterval(app.ticks); app.ticks = setInterval(() => { app.pos += 1; fake.emit({ v: 1, type: 'audioTick', rev: app.rev, positionSec: app.pos }); }, 1000); }); }
      else if (m.type === 'audio.pause') { app.state = 'paused'; clearInterval(app.ticks); snapOut(); }
      else if (m.type === 'audio.stop') { app.state = 'idle'; app.queue = []; clearInterval(app.ticks); snapOut(); }
    }
  };
  w.addEventListener('unload', () => clearInterval(app.ticks));
  const settle = async (ms) => { const end = Date.now() + (ms || 200); while (Date.now() < end) { answer(); await sleep(5); } answer(); };
  const api = {
    w, fake, player: () => w.FileTube.player,
    // open the watch page for `id` (a fresh #view-root, the router's swap), optionally with the seed a card stashed
    async openWatch(id, seed) {
      if (seed) w.FileTube.stashWatchSeed(seed, { folderSettings: shapes.config.folderSettings || {} });
      w.history.pushState({}, '', '/watch.html?v=' + id);
      const fresh = pristine.cloneNode(true);
      root.replaceWith(fresh);
      root = fresh;
      tapAt = Date.now(); webMedia.length = 0;
      views.watch.init(root);
    },
    // leave watch for Home: the router's applyPlayerTransition docks, then the view is destroyed and #view-root swapped
    leaveToHome() {
      w.FileTube.player.dock();
      views.watch.destroy();
      w.history.pushState({}, '', '/');
      const home = w.document.createElement('div'); home.id = 'view-root';
      root.replaceWith(home);
      root = home;
    },
    settle,
    resetClock() { tapAt = Date.now(); webMedia.length = 0; },
    webMedia: () => webMedia.map((e) => '+' + (e.t - tapAt) + 'ms ' + e.ev),
    stopApp() { clearInterval(app.ticks); app.seen = Infinity; },
  };
  realms.add(api);
  return api;
}

// one line per message to native, in order (host.hello and the subscribe bookkeeping are kept: they are posts too)
function trace(fake) {
  return fake.posts.map((m) => {
    const t = `+${m.__t}ms `;
    if (m.type === 'audio.load') return t + `audio.load rev=${m.rev} index=${m.index} pos=${m.positionSec} autoplay=${m.autoplay} item=${JSON.stringify(m.queue[m.index])}`;
    const o = Object.assign({}, m); delete o.v; delete o.type; delete o.__t;
    return t + m.type + (Object.keys(o).length ? ' ' + JSON.stringify(o) : '');
  });
}

// The switch's contract: ONE audio.load for the new item, no audio.stop, no second load at hydration, one audio.play (v1.405.0's
// shape, measured on both trees); and no web media element is touched at all - no play, src, load(), pause() or src removal
// (v1.406.1: native owns the sound, and an element reset inside the tap clicked native's audio on the phone).
function assertOneHandover(fake, webMedia, id) {
  const t = trace(fake);
  const loads = fake.of('audio.load');
  assert.strictEqual(loads.length, 1, 'one handover load per switch:\n' + t.join('\n'));
  assert.strictEqual(loads[0].queue[loads[0].index].id, id, 'the load names the tapped item');
  assert.strictEqual(fake.of('audio.stop').length, 0, 'never stop-then-load:\n' + t.join('\n'));
  assert.strictEqual(fake.of('audio.play').length, 1, 'one play:\n' + t.join('\n'));
  assert.deepStrictEqual(webMedia, [], 'no web media element plays, loads, pauses or drops a src during the switch (v1.406.1)');
}

async function switchFromDocked(seedFor) {
  const r = realm();
  await r.openWatch('va', null); // a cold open of A: no seed, the hydration load is the claim
  await r.settle(1600);
  assert.strictEqual(r.player().currentId, 'va', 'A loaded');
  r.leaveToHome();
  await r.settle(150);
  assert.strictEqual(r.player().getState(), 'docked', 'A docked on Home');
  r.fake.clear();
  await r.openWatch('vb', seedFor('vb'));
  await r.settle(1600); // the hydration lands (HYDRATE_MS) and the app answers
  assert.strictEqual(r.player().currentId, 'vb', 'B loaded');
  assertOneHandover(r.fake, r.webMedia(), 'vb');
  teardown(r);
}

test('W1: docked A -> Modern card B (the server-emitted grid seed): one handover load, no stop, no reload at hydration', async () => {
  await switchFromDocked((id) => shapes.grid[id]);
});

test('W1: docked A -> Classic card B (the server-emitted list record): one handover load, no stop, no reload at hydration', async () => {
  await switchFromDocked((id) => shapes.list[id]);
});

test('W1: a docked Music track -> Modern card B: one handover load, no stop', async () => {
  const r = realm();
  // the track as music.js hands it to the player (a library track: type audio, resumeMode music, its queue provider)
  const track = { type: 'audio', title: 'Song A', channelName: 'Artist', album: 'Album', duration: 600, artUrl: '/albumart/ta', resumeMode: 'music', progressEndpoint: '/api/music/progress', readerHref: '/music?nowplaying=1' };
  track.nativeQueue = () => ({ items: [Object.assign({ id: 'ta' }, track)], index: 0 });
  r.player().load('ta', track, { dock: true });
  await r.settle(1600);
  assert.strictEqual(r.player().getState(), 'docked', 'the track docked');
  assert.strictEqual(r.fake.of('audio.load').length, 1, 'native plays the track');
  r.fake.clear();
  await r.openWatch('vb', shapes.grid.vb);
  await r.settle(1600);
  assert.strictEqual(r.player().currentId, 'vb', 'B loaded');
  assertOneHandover(r.fake, r.webMedia(), 'vb');
  teardown(r);
});

// The browser half (no native host): the element holds the previous video, so the switch still resets it before the new src -
// the guard skips only an element that holds nothing (the poster/last-frame reset of v1.18.0 FR-2 is unchanged).
test('W2: without a native host the switch still resets the element that holds the previous video', async () => {
  const r = realm({ caps: ['orientation'] });
  await r.openWatch('va', null);
  await r.settle(600);
  r.leaveToHome();
  await r.settle(100);
  await r.openWatch('vb', shapes.grid.vb);
  await r.settle(600);
  const ops = r.webMedia();
  const reset = ops.findIndex((e) => /removeAttribute\(src\) video#media-player/.test(e));
  const load = ops.findIndex((e, i) => i > reset && /load\(\) video#media-player/.test(e));
  const src = ops.findIndex((e) => /src= video#media-player \/video\/vb/.test(e));
  assert.ok(reset >= 0 && load > reset && src > load, 'drop A, load(), then B\'s src:\n' + ops.join('\n'));
  teardown(r);
});

// The dock's [x] (player.close) runs the same resets as a switch (the element, the sidecar, the keep-alive): under native they
// hold nothing, so nothing is reset there either - native's audio.stop is the whole close.
test('W2: closing a docked native video touches no web media element', async () => {
  const r = realm();
  await r.openWatch('va', null);
  await r.settle(1600);
  r.leaveToHome();
  await r.settle(150);
  r.fake.clear(); r.resetClock();
  r.player().close();
  await r.settle(100);
  assert.deepStrictEqual(r.webMedia(), [], 'no load(), pause() or src removal on an element that holds nothing');
  assert.strictEqual(r.fake.of('audio.stop').length, 1, 'native stops');
  teardown(r);
});

test('W2: mediaElementHoldsMedia reads each way an element can hold media', () => {
  const { mediaElementHoldsMedia } = require('../../public/js/player.js');
  const el = (o) => Object.assign({ hasAttribute: (n) => n === 'src' && !!o.srcAttr, currentSrc: '', srcObject: null, networkState: 0 }, o);
  assert.strictEqual(mediaElementHoldsMedia(null), false);
  assert.strictEqual(mediaElementHoldsMedia(el({})), false, 'an empty element (NETWORK_EMPTY, no src): nothing to reset');
  assert.strictEqual(mediaElementHoldsMedia(el({ srcAttr: true })), true, 'a src attribute');
  assert.strictEqual(mediaElementHoldsMedia(el({ currentSrc: '/video/x' })), true, 'a resolved source (a <source> child)');
  assert.strictEqual(mediaElementHoldsMedia(el({ srcObject: {} })), true, 'a stream');
  assert.strictEqual(mediaElementHoldsMedia(el({ networkState: 2 })), true, 'still loading (NETWORK_LOADING)');
  assert.strictEqual(mediaElementHoldsMedia(el({ networkState: 1 })), true, 'loaded and idle (NETWORK_IDLE)');
});
