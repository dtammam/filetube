'use strict';

// [UNIT] v1.397.0 native audio (D2 "and podcasts"; gate r1 adversary W-C): a fake host through the REAL player.js +
// podcasts.js view. The episode tap goes to native as one audio.load with the show's playable episodes (kind
// podcastEpisode, the podcast file route, the show's art, the podcasts progress route, no radio seed, the podcast modes);
// native's advance is FOLLOWED without a new load; the user's Next is an audio.jump.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { installFakeHost } = require('../helpers/fake-host');

const REPO = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(REPO, 'public', 'js', f), 'utf8');
const settle = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const EPISODES = [1, 2, 3].map((n) => ({ id: 'e' + n, title: 'Episode ' + n, subId: 'sub1', showName: 'The Show', status: 'downloaded', durationSec: 1800 + n, pubDateMs: n, description: '' }));

function realm({ host = { capabilities: ['nativeAudio'] }, progress = {}, queue = null } = {}) {
  const vc = new VirtualConsole();
  const errors = [];
  vc.on('jsdomError', (e) => errors.push(String((e && e.stack) || e)));
  const dom = new JSDOM(fs.readFileSync(path.join(REPO, 'public', 'podcasts.html'), 'utf8'), { url: 'http://localhost/podcasts?play=e2', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc });
  const w = dom.window;
  w.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  w.scrollTo = () => {};
  w.HTMLMediaElement.prototype.load = function () {};
  w.HTMLMediaElement.prototype.pause = function () {};
  w.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
  w.resolveAudioArtUrl = () => '/podcastart/sub1';
  w.formatDuration = (s) => String(Math.floor(s || 0));
  w.clampPositionState = (s) => s;
  w.navigator.mediaSession = { metadata: null, playbackState: 'none', setActionHandler() {}, setPositionState() {} };
  w.MediaMetadata = function (init) { Object.assign(this, init); };
  // ui.js reads the global document at require time (the sticker-sheet and extras tests do the same dance)
  const saved = { window: global.window, document: global.document };
  global.window = w; global.document = w.document;
  const uiPath = require.resolve('../../public/js/ui.js'); delete require.cache[uiPath];
  w.ui = require('../../public/js/ui.js');
  w.FTIcons = require('../../public/js/icons.js');
  const calls = [];
  w.fetch = (u, init) => {
    const url = String(u); const method = (init && init.method) || 'GET';
    calls.push(method + ' ' + url);
    let body = {};
    if (/^\/api\/podcasts\/episodes\/e\d$/.test(url)) body = EPISODES.find((e) => url.endsWith(e.id));
    else if (/^\/api\/podcasts\/shows\/sub1\/episodes/.test(url)) body = { show: { id: 'sub1', name: 'The Show' }, episodes: EPISODES };
    else if (/^\/api\/podcasts\/progress\//.test(url)) body = { position: progress[url.split('/').pop()] || 0 };
    else if (url.indexOf('/api/podcasts/pins') === 0) body = [];
    else if (url.indexOf('/api/queue') === 0) body = queue || { entries: [], pointerUid: null };
    return Promise.resolve({ ok: true, status: 200, json: async () => body });
  };
  const fake = host ? installFakeHost(w, host) : null;
  for (const f of ['host-adapter.js', 'native-audio.js', 'player.js']) w.eval(read(f));
  let mod = null;
  w.FileTube.registerView = (n, m) => { mod = m; };
  w.FileTube.shimmerArt = () => {};
  for (const f of ['music-skins.js', 'skin-surface.js', 'pocket-lighting.js', 'podcasts.js']) w.eval(read(f));
  mod.init(w.document.getElementById('view-root'));
  const lastLoad = () => { const l = fake.of('audio.load'); return l[l.length - 1]; };
  const snap = (over) => { const ld = lastLoad(); return Object.assign({ v: 1, type: 'audioState', rev: ld.rev, queue: ld.queue, index: ld.index, state: 'playing', positionSec: 0, durationSec: 1800, rate: 1, modes: ld.modes, sleep: { mode: 'off' } }, over || {}); };
  return { w, fake, calls, errors, player: w.FileTube.player, na: w.FileTube.nativeAudio, el: () => w.document.getElementById('media-player'), lastLoad, snap, close: () => { try { mod.destroy(); } catch (_) { /* best-effort */ } global.window = saved.window; global.document = saved.document; w.close(); } };
}

test('a podcast episode deep link goes to native: ONE audio.load with the show\'s playable episodes at the tapped index, the podcast file route and art, the podcasts progress route, no radio seed, the podcast modes; the element has no src', async () => {
  const r = realm();
  try {
    await settle(200);
    const loads = r.fake.of('audio.load');
    assert.strictEqual(loads.length, 1, 'one audio.load: ' + JSON.stringify(r.errors));
    assert.deepStrictEqual(loads[0].queue.map((it) => it.id), ['e1', 'e2', 'e3']);
    assert.strictEqual(loads[0].index, 1);
    assert.deepStrictEqual(loads[0].queue[1], { kind: 'podcastEpisode', id: 'e2', src: '/api/offline/file/podcastEpisode/e2', title: 'Episode 2', artist: 'The Show', artworkSrc: '/podcastart/sub1', durationSec: 1802, progress: { route: '/api/podcasts/progress', key: 'e2' } });
    assert.deepStrictEqual(loads[0].modes, { autoplay: true, shuffle: false, loop: 'off' });
    assert.strictEqual(r.el().getAttribute('src'), null);
    assert.strictEqual(r.player.currentId, 'e2');
    assert.ok(r.fake.of('audio.play').length >= 1, 'the web\'s own resume (position 0) plays');
  } finally { r.close(); }
});

test('podcasts FOLLOW native\'s advance (no load, no jump, no pause), and the user\'s Next is an audio.jump; a snapshot drives the proxy', async () => {
  const r = realm();
  try {
    await settle(200);
    r.fake.emit(r.snap({ positionSec: 100 }));
    await settle(30);
    assert.ok(Math.abs(r.el().currentTime - 100) < 0.3);
    const before = { loads: r.fake.of('audio.load').length, jumps: r.fake.of('audio.jump').length };
    r.fake.emit(r.snap({ index: 2, positionSec: 0 }));
    await settle(150);
    assert.strictEqual(r.player.currentId, 'e3', 'followed: ' + JSON.stringify(r.errors));
    assert.strictEqual(r.fake.of('audio.load').length, before.loads);
    assert.strictEqual(r.fake.of('audio.jump').length, before.jumps);
    assert.deepStrictEqual(r.fake.of('audio.pause'), []);
    r.player.prev();
    await settle(100);
    assert.deepStrictEqual(r.fake.of('audio.jump').pop(), { v: 1, type: 'audio.jump', index: 1 });
    assert.strictEqual(r.player.currentId, 'e2');
    assert.deepStrictEqual(r.calls.filter((c) => /^POST \/api\/podcasts\/progress/.test(c)), [], 'no web progress POST under native');
  } finally { r.close(); }
});

test('gate r2 qa W-r2-1: native advances to an episode with a saved place - the web follows, READS the place and seeks native there (the browser\'s podcast resume rule), with no autostart', async () => {
  const r = realm({ progress: { e3: 1200 } });
  try {
    await settle(200);
    r.fake.emit(r.snap({ positionSec: 100 }));
    await settle(30);
    const plays = r.fake.of('audio.play').length;
    r.fake.emit(r.snap({ index: 2, positionSec: 0 }));
    await settle(200);
    assert.strictEqual(r.player.currentId, 'e3');
    assert.ok(r.calls.includes('GET /api/podcasts/progress/e3'), 'the place is read');
    assert.deepStrictEqual(r.fake.of('audio.seek').pop(), { v: 1, type: 'audio.seek', positionSec: 1200 }, 'native is sent to the saved place');
    assert.strictEqual(r.fake.of('audio.play').length, plays, 'no redundant audio.play');
  } finally { r.close(); }
});

test('gate r2 qa W-r2-2 (D12 for podcasts): the server Up-next queue\'s podcast entries after the playing episode join the playable list (one more audio.load), a track entry is left out, and native\'s advance into one is followed with the pointer posted', async () => {
  const r = realm({ queue: { pointerUid: 'u-e2', entries: [
    { uid: 'u-e2', mediaId: 'e2', kind: 'podcast', item: { title: 'Episode 2', name: 'Episode 2', channelName: 'The Show', folderName: 'The Show', artUrl: '/podcastart/sub1', durationSec: 1802, hasThumbnail: false } },
    { uid: 'u-t1', mediaId: 't1', kind: 'track', item: { title: 'A song', name: 'A song', channelName: 'A', folderName: 'B', artUrl: '/albumart/t1', durationSec: 100, hasThumbnail: false } },
    { uid: 'u-e9', mediaId: 'e9', kind: 'podcast', item: { title: 'Episode 9', name: 'Episode 9', channelName: 'Other Show', folderName: 'Other Show', artUrl: '/podcastart/sub9', durationSec: 900, hasThumbnail: false } },
  ] } });
  try {
    await settle(250);
    const loads = r.fake.of('audio.load');
    assert.strictEqual(loads.length, 2, 'the view load, then the flattened queue: ' + JSON.stringify(r.errors));
    assert.deepStrictEqual(loads[1].queue.map((it) => it.id), ['e1', 'e2', 'e3', 'e9'], 'the podcast entry after the pointer, never the track');
    assert.strictEqual(loads[1].index, 1);
    const e9 = loads[1].queue[3];
    assert.deepStrictEqual({ kind: e9.kind, src: e9.src, title: e9.title, artist: e9.artist, artworkSrc: e9.artworkSrc, durationSec: e9.durationSec, progress: e9.progress }, { kind: 'podcastEpisode', src: '/api/offline/file/podcastEpisode/e9', title: 'Episode 9', artist: 'Other Show', artworkSrc: '/podcastart/sub9', durationSec: 900, progress: { route: '/api/podcasts/progress', key: 'e9' } });
    r.fake.emit(r.snap({ index: 3, positionSec: 0 }));
    await settle(200);
    assert.strictEqual(r.player.currentId, 'e9', 'followed into the queued episode');
    assert.ok(r.calls.includes('POST /api/queue/pointer'), 'the pointer moved');
  } finally { r.close(); }
});

test('no host: the podcast plays on the web element (/episode/:id), nothing posted', async () => {
  const r = realm({ host: null });
  try {
    await settle(200);
    assert.strictEqual(r.player.currentId, 'e2');
    assert.strictEqual(r.el().getAttribute('src'), '/episode/e2');
    assert.strictEqual(r.na.enabled, false);
  } finally { r.close(); }
});
