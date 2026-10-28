'use strict';

// [UNIT] v1.397.0 native audio, W3 + W4 (plan docs/exec-plans/active/2026-10-28-native-audio.md): a FAKE HOST in jsdom that
// plays snapshots back through the REAL player.js + music.js + skin engine. Proves: the view's load goes to native as one
// audio.load with the whole queue and the element gets no src; native's snapshots drive the element proxy, so the dock, the
// scrubber and the remote snapshot render from them; every stand-down item is silent (the progress saver, the play tally, the
// web's radio, the chapter loop, MediaSession); the web FOLLOWS native's advance without a new load; a user's Next is an
// audio.jump; native's radio appends join the queue; a shuffle toggle re-sends the queue at the latest tick (D17); a video
// load stops native; intents travel through the element; a stale snapshot is dropped; an idle native is re-sent on play; and
// with no host the audio path is byte-identical (D10).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { installFakeHost } = require('../helpers/fake-host');

const REPO = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(REPO, 'public', 'js', f), 'utf8');
const settle = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const SONGS = [1, 2, 3].map((n) => ({ id: 't' + n, title: 'Song ' + n, artist: 'A', album: 'B', albumKey: 'A\u001fB', durationSec: 100 }));
const CHAPTERS = [
  { id: 'f::c0', source: 'library-chapter', chapterStartSec: 0, durationSec: 30, streamSrc: '/video/f', progressEndpoint: '/api/progress', artUrl: '/thumbnail/f', title: 'One', artist: 'Sp', album: 'Talk', albumKey: 'Sp\u001fTalk' },
  { id: 'f::c1', source: 'library-chapter', chapterStartSec: 30, durationSec: 65, streamSrc: '/video/f', progressEndpoint: '/api/progress', artUrl: '/thumbnail/f', title: 'Two', artist: 'Sp', album: 'Talk', albumKey: 'Sp\u001fTalk' },
];

function realm({ host = { capabilities: ['nativeAudio'] }, url = 'http://localhost/music?play=t2&ao=1', items = SONGS, progress = {} } = {}) {
  const vc = new VirtualConsole();
  const errors = [];
  vc.on('jsdomError', (e) => errors.push(String((e && e.stack) || e)));
  const dom = new JSDOM(fs.readFileSync(path.join(REPO, 'public', 'music.html'), 'utf8'), { url, runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc });
  const w = dom.window;
  w.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  w.scrollTo = () => {};
  const protoPlays = [];
  w.HTMLMediaElement.prototype.load = function () {};
  w.HTMLMediaElement.prototype.pause = function () {};
  w.HTMLMediaElement.prototype.play = function () { protoPlays.push(this.id); return Promise.resolve(); };
  w.resolveAudioArtUrl = () => '/albumart/x';
  w.formatDuration = (s) => String(Math.floor(s || 0));
  w.clampPositionState = (s) => s;
  const msActions = [];
  w.navigator.mediaSession = { metadata: null, playbackState: 'none', setActionHandler(a, h) { msActions.push([a, h === null ? null : typeof h]); }, setPositionState() {} };
  w.MediaMetadata = function (init) { Object.assign(this, init); };
  const calls = [];
  w.fetch = (u, init) => {
    const url = String(u); const method = (init && init.method) || 'GET';
    calls.push(method + ' ' + url);
    let body = {};
    if (/^\/api\/music\/progress\/|^\/api\/progress\//.test(url)) body = { position: progress[url.split('/').pop()] || 0 };
    else if (url.indexOf('/api/music') === 0) body = { items, total: items.length };
    else if (url.indexOf('/api/queue') === 0) body = { entries: [], pointerUid: null };
    else if (url.indexOf('/api/music/radio') === 0) body = { items: [] };
    return Promise.resolve({ ok: true, status: 200, json: async () => body });
  };
  const fake = host ? installFakeHost(w, host) : null;
  for (const f of ['host-adapter.js', 'native-audio.js', 'player.js']) w.eval(read(f));
  let mod = null;
  w.FileTube.registerView = (n, m) => { mod = m; };
  w.FileTube.shimmerArt = () => {};
  for (const f of ['music-skins.js', 'skin-surface.js', 'pocket-lighting.js', 'music.js']) w.eval(read(f));
  mod.init(w.document.getElementById('view-root'));
  const el = () => w.document.getElementById('media-player');
  const lastLoad = () => { const l = fake.of('audio.load'); return l[l.length - 1]; };
  // native's answer to the last audio.load, as a full snapshot (the queue echoed back), with overrides
  const snap = (over) => { const ld = lastLoad(); return Object.assign({ v: 1, type: 'audioState', rev: ld.rev, queue: ld.queue, index: ld.index, state: 'playing', positionSec: 0, durationSec: 100, rate: 1, modes: ld.modes, sleep: { mode: 'off' } }, over || {}); };
  const tick = (positionSec, rev) => ({ v: 1, type: 'audioTick', rev: rev === undefined ? lastLoad().rev : rev, positionSec });
  const own = (name) => Object.getOwnPropertyDescriptor(el(), name) !== undefined;
  return { w, fake, calls, protoPlays, msActions, errors, mod, player: w.FileTube.player, na: w.FileTube.nativeAudio, el, lastLoad, snap, tick, own, slot: w.document.getElementById('player-slot'), close: () => { try { mod.destroy(); } catch (_) { /* best-effort */ } w.close(); } };
}

test('the Music view\'s load goes to native: ONE audio.load with the whole album queue at the tapped index, the element has no src and is a proxy; the web\'s resume decides autoplay (audio.play after the progress read)', async () => {
  const r = realm();
  try {
    await settle(80);
    assert.strictEqual(r.na.enabled, true);
    const loads = r.fake.of('audio.load');
    assert.strictEqual(loads.length, 1, 'exactly one audio.load');
    assert.deepStrictEqual(loads[0].queue.map((it) => it.id), ['t1', 't2', 't3'], 'the whole queue (D5)');
    assert.strictEqual(loads[0].index, 1);
    assert.strictEqual(loads[0].positionSec, 0);
    assert.strictEqual(loads[0].autoplay, false, 'the web\'s own resume logic plays, exactly as it does on the element');
    assert.deepStrictEqual(loads[0].modes, { autoplay: true, shuffle: false, loop: 'off' });
    assert.strictEqual(loads[0].rev, 1);
    assert.deepStrictEqual(loads[0].queue[1], { kind: 'track', id: 't2', src: '/api/offline/file/track/t2', title: 'Song 2', artist: 'A', album: 'B', artworkSrc: '/albumart/t2', durationSec: 100, progress: { route: '/api/music/progress', key: 't2' }, radioSeed: 'track:t2' });
    assert.strictEqual(r.el().getAttribute('src'), null, 'no src: the web element can never play');
    assert.deepStrictEqual(r.protoPlays, [], 'the real element\'s play() is never reached');
    assert.ok(r.own('currentTime') && r.own('paused') && r.own('play'), 'the element instance carries the proxy accessors');
    assert.ok(r.fake.of('audio.play').length >= 1, 'the resume read came back at 0: autoStart -> audio.play');
    assert.deepStrictEqual(r.fake.of('audio.seek'), [], 'no seek for a fresh start');
    assert.strictEqual(r.fake.of('audio.subscribe').length, 1, 'one subscription per page');
    assert.strictEqual(r.player.currentId, 't2');
  } finally { r.close(); }
});

test('snapshots drive the proxy: position, paused, duration, the dock\'s play button and scrubber, the remote snapshot; a tick moves the position and it keeps rolling between ticks while playing', async () => {
  const r = realm();
  try {
    await settle(80);
    r.fake.emit(r.snap({ positionSec: 30 }));
    await settle(60);
    const el = r.el();
    assert.ok(Math.abs(el.currentTime - 30) < 0.3, 'currentTime ' + el.currentTime);
    assert.strictEqual(el.paused, false);
    assert.strictEqual(el.duration, 100);
    assert.strictEqual(el.readyState, 4);
    assert.strictEqual(r.w.document.getElementById('pp-btn').getAttribute('aria-pressed'), 'true', 'the dock shows Pause');
    const rs = r.player.getRemoteSnapshot();
    assert.strictEqual(rs.playing, true); assert.strictEqual(rs.duration, 100); assert.ok(Math.abs(rs.position - 30) < 0.3);
    r.fake.emit(r.tick(45));
    await settle(60);
    assert.ok(el.currentTime >= 45 && el.currentTime < 45.5, 'a tick moves it (' + el.currentTime + ') and it rolls on');
    const bar = r.w.document.getElementById('seek-bar');
    assert.ok(Math.abs(Number(bar.value) - 0.45) < 0.01, 'the scrubber follows (' + bar.value + ')');
    r.fake.emit(r.snap({ state: 'paused', positionSec: 46 }));
    await settle(60);
    assert.strictEqual(el.paused, true);
    assert.strictEqual(r.w.document.getElementById('pp-btn').getAttribute('aria-pressed'), 'false', 'the dock shows Play');
    assert.ok(Math.abs(el.currentTime - 46) < 0.01, 'paused: the position holds still');
    assert.strictEqual(r.player.getRemoteSnapshot().playing, false);
  } finally { r.close(); }
});

test('stand-down: no progress POST, no plays POST, no web radio fetch at the last track, no MediaSession metadata or handlers; close() posts audio.stop, saves nothing and hands the element back', async () => {
  const r = realm();
  try {
    await settle(80);
    r.fake.emit(r.snap({ positionSec: 30 }));
    await settle(30);
    for (let i = 31; i < 40; i++) r.fake.emit(r.tick(i));
    // native advances to the LAST track: the web follows; its own radio extension must stay silent
    r.fake.emit(r.snap({ index: 2, positionSec: 0 }));
    await settle(120);
    assert.strictEqual(r.player.currentId, 't3', 'the web followed native to the last track');
    r.fake.emit(r.snap({ index: 2, positionSec: 50 }));
    await settle(60);
    const elBefore = r.el();
    r.player.close();
    await settle(30);
    assert.deepStrictEqual(r.calls.filter((c) => /^POST \/api\/music\/progress|^POST \/api\/progress|^POST \/api\/music\/plays/.test(c)), [], 'the saver and the tally are silent (native posts them)');
    assert.deepStrictEqual(r.calls.filter((c) => /\/api\/music\/radio/.test(c)), [], 'the web never asks for radio under native');
    assert.strictEqual(r.w.navigator.mediaSession.metadata, null, 'no web now-playing card');
    const lastPerAction = {};
    for (const [a, h] of r.msActions) lastPerAction[a] = h;
    assert.ok(Object.keys(lastPerAction).length >= 6, 'the handlers the player set at creation were all cleared again: ' + JSON.stringify(lastPerAction));
    assert.ok(Object.values(lastPerAction).every((h) => h === null), 'the LAST handler of every MediaSession action under native is null: ' + JSON.stringify(lastPerAction));
    assert.strictEqual(r.fake.of('audio.stop').length, 1, 'close() stops native');
    assert.strictEqual(Object.getOwnPropertyDescriptor(elBefore, 'currentTime'), undefined, 'the proxy is gone with the ownership');
    assert.strictEqual(r.na.active(), false);
  } finally { r.close(); }
});

test('FOLLOW: native advances (index + 1) -> the view loads that row with NO new audio.load or audio.jump; the user\'s Next is an audio.jump; native\'s radio appends join the web queue (the last row gains a Next) without a re-send', async () => {
  const r = realm();
  try {
    await settle(80);
    r.fake.emit(r.snap({ positionSec: 10 }));
    await settle(30);
    const before = { loads: r.fake.of('audio.load').length, jumps: r.fake.of('audio.jump').length };
    r.fake.emit(r.snap({ index: 2, positionSec: 0 }));
    await settle(120);
    assert.strictEqual(r.player.currentId, 't3');
    assert.strictEqual(r.fake.of('audio.load').length, before.loads, 'a follow posts no load');
    assert.strictEqual(r.fake.of('audio.jump').length, before.jumps, 'a follow posts no jump');
    assert.strictEqual(r.player.getRemoteSnapshot().hasNext, false, 't3 is the last row');
    // native appended two radio picks: the web mirrors them (t3 is no longer last) and does not re-send the queue
    const ld = r.lastLoad();
    const picks = [{ kind: 'track', id: 'r1', src: '/api/offline/file/track/r1', title: 'Pick 1', artist: 'P', album: 'Q', artworkSrc: '/albumart/r1', durationSec: 90, progress: { route: '/api/music/progress', key: 'r1' }, radioSeed: 'track:r1' }, { kind: 'track', id: 'r2', src: '/api/offline/file/track/r2', title: 'Pick 2', progress: { route: '/api/music/progress', key: 'r2' } }];
    r.fake.emit(r.snap({ index: 2, positionSec: 20, queue: ld.queue.concat(picks) }));
    await settle(60);
    assert.strictEqual(r.player.getRemoteSnapshot().hasNext, true, 'the appended picks are in the web queue');
    assert.strictEqual(r.fake.of('audio.load').length, before.loads, 'mirroring native\'s own append never re-sends the queue');
    // the user's Next from the dock: the web asks native to jump (the web still owns the order)
    r.player.next();
    await settle(80);
    const jumps = r.fake.of('audio.jump');
    assert.strictEqual(jumps.length, before.jumps + 1, 'one audio.jump');
    assert.strictEqual(jumps[jumps.length - 1].index, 3, 'to the first pick');
    assert.strictEqual(r.player.currentId, 'r1');
    assert.strictEqual(r.fake.of('audio.load').length, before.loads, 'a pick within the known queue is a jump, not a load');
  } finally { r.close(); }
});

const SIX = [1, 2, 3, 4, 5, 6].map((n) => ({ id: 't' + n, title: 'Song ' + n, artist: 'A', album: 'B', albumKey: 'A\u001fB', durationSec: 100 }));
test('D17: a shuffle toggle re-sends audio.load with rev + 1, the CURRENT item at its new index and the position of the LATEST tick, plus audio.setModes; Loop posts setModes too', async () => {
  const r = realm({ items: SIX });
  try {
    await settle(80);
    r.fake.emit(r.snap({ positionSec: 10 }));
    r.fake.emit(r.tick(42));
    await settle(20);
    const btn = r.w.document.getElementById('music-shufflemode-btn');
    assert.ok(btn, 'the desktop Shuffle mode button exists');
    r.w.fisherYatesShuffle = (arr) => arr.slice().reverse(); // the common.js shuffle (not loaded here): a deterministic reorder of the rows after the current one
    btn.click();
    await settle(60);
    assert.deepStrictEqual(r.errors, [], 'no script error on the toggle');
    const loads = r.fake.of('audio.load');
    assert.strictEqual(loads.length, 2, 'the reordered queue is re-sent once');
    const re = loads[1];
    assert.strictEqual(re.modes.shuffle, true, 'the re-sent load carries the new modes (so no separate audio.setModes is needed for it)');
    assert.deepStrictEqual(r.fake.of('audio.setModes'), [], 'no redundant setModes after a load that already carries the modes');
    assert.strictEqual(re.rev, 2);
    assert.strictEqual(re.queue[re.index].id, 't2', 'the current item at its index in the NEW order');
    assert.strictEqual(re.queue.length, 6);
    assert.notDeepStrictEqual(re.queue.map((it) => it.id), loads[0].queue.map((it) => it.id), 'the order changed');
    assert.ok(re.positionSec >= 42 && re.positionSec < 42.5, 'the position of the latest tick, never a stale value (' + re.positionSec + ')');
    assert.strictEqual(re.autoplay, true, 'it was playing');
    r.player.setLoop(true);
    const after = r.fake.of('audio.setModes');
    assert.strictEqual(after[after.length - 1].modes.loop, 'one', 'Loop is one of native\'s modes');
    // a snapshot from BEFORE the re-send (rev 1) is dropped
    r.fake.emit({ v: 1, type: 'audioState', rev: 1, queue: loads[0].queue, index: 1, state: 'playing', positionSec: 5, durationSec: 100, rate: 1, modes: loads[0].modes, sleep: { mode: 'off' } });
    await settle(20);
    assert.ok(r.el().currentTime > 40, 'the stale snapshot did not move the position (' + r.el().currentTime + ')');
  } finally { r.close(); }
});

test('intents travel through the element: seek, rate, pause / play from the player api; a video load stops native and takes the element back; an idle native is re-sent on play', async () => {
  const r = realm();
  try {
    await settle(80);
    r.fake.emit(r.snap({ positionSec: 10 }));
    await settle(20);
    const el = r.el();
    el.currentTime = 50;
    assert.deepStrictEqual(r.fake.of('audio.seek').pop(), { v: 1, type: 'audio.seek', positionSec: 50 });
    assert.ok(Math.abs(el.currentTime - 50) < 0.3, 'the proxy reads the seek back at once');
    el.playbackRate = 1.5;
    assert.deepStrictEqual(r.fake.of('audio.setRate').pop(), { v: 1, type: 'audio.setRate', rate: 1.5 });
    assert.strictEqual(el.playbackRate, 1.5);
    r.player.pause();
    assert.strictEqual(r.fake.of('audio.pause').length, 1);
    assert.strictEqual(el.paused, true, 'the intent shows at once');
    r.player.play();
    assert.ok(r.fake.of('audio.play').length >= 2);
    assert.strictEqual(el.paused, false);
    r.player.seek(70);
    assert.strictEqual(r.fake.of('audio.seek').pop().positionSec, 70);
    // native lost its engine (idle, empty queue): the next play re-sends the queue, playing, where the web is
    r.fake.emit(r.snap({ state: 'idle', queue: [], index: 0, positionSec: 0, durationSec: 0 }));
    await settle(20);
    r.player.play();
    const loads = r.fake.of('audio.load');
    assert.strictEqual(loads.length, 2, 'one re-send');
    assert.strictEqual(loads[1].autoplay, true);
    assert.strictEqual(loads[1].queue[loads[1].index].id, 't2');
    // a video load: native goes silent and the web element plays it
    r.player.load('v1', { type: 'video', title: 'V', channelName: 'C' }, { slot: r.slot });
    await settle(30);
    assert.strictEqual(r.fake.of('audio.stop').length, 1, 'audio.stop before the web plays');
    assert.strictEqual(r.el().getAttribute('src'), '/video/v1');
    assert.strictEqual(r.own('currentTime'), false, 'the proxy accessors are gone');
    assert.strictEqual(r.na.active(), false);
  } finally { r.close(); }
});

test('chapter rows: the Item carries the parent file + clip, the proxy shows FILE-absolute time over the file\'s duration, a seek inside the chapter is clip-relative, one outside jumps to the chapter that holds it, and the web\'s chapter loop stays silent with Loop on', async () => {
  const r = realm({ url: 'http://localhost/music?play=f%3A%3Ac1&ao=1', items: CHAPTERS });
  try {
    r.w.localStorage.setItem('ft-loop', '1');
    await settle(80);
    const ld = r.lastLoad();
    assert.ok(ld, 'the chapter queue went to native');
    assert.deepStrictEqual(ld.queue.map((it) => it.id), ['f::c0', 'f::c1']);
    assert.strictEqual(ld.index, 1);
    assert.deepStrictEqual(ld.queue[1].clip, { startSec: 30, endSec: 95 });
    assert.strictEqual(ld.queue[1].src, '/api/offline/file/track/f', 'the parent FILE');
    assert.deepStrictEqual(ld.queue[1].progress, { route: '/api/progress', key: 'f' }, 'saves under the parent, file-absolute');
    assert.strictEqual(ld.modes.loop, 'one', 'Loop on = loop the chapter (D6)');
    r.fake.emit(r.snap({ positionSec: 10, durationSec: 65 }));
    await settle(30);
    const el = r.el();
    assert.ok(Math.abs(el.currentTime - 40) < 0.3, 'file-absolute: 30 + 10 (' + el.currentTime + ')');
    assert.strictEqual(el.duration, 95, 'the file ends where its last chapter ends');
    const seeks0 = r.fake.of('audio.seek').length;
    el.currentTime = 60;
    assert.deepStrictEqual(r.fake.of('audio.seek').pop(), { v: 1, type: 'audio.seek', positionSec: 30 }, 'inside the chapter: clip-relative');
    el.currentTime = 12;
    assert.deepStrictEqual(r.fake.of('audio.jump').pop(), { v: 1, type: 'audio.jump', index: 0 }, 'outside: the chapter that holds 12 s');
    assert.strictEqual(r.fake.of('audio.seek').pop().positionSec, 12);
    // the web's own chapter loop (music.js enforceChapterLoop, player.js chapterLoop) must not seek native back at the chapter end
    r.fake.emit(r.snap({ positionSec: 64.5, durationSec: 65 }));
    const seeks1 = r.fake.of('audio.seek').length;
    for (const p of [64.6, 64.8, 64.95, 65]) { r.fake.emit(r.tick(p)); await settle(5); }
    await settle(40);
    assert.strictEqual(r.fake.of('audio.seek').length, seeks1, 'no seek from the web at the chapter end: native loops the clip');
    assert.ok(seeks1 > seeks0);
  } finally { r.close(); }
});

test('D10: no host - the same view load sets the stream src, posts nothing, installs no proxy; nativeAudio is inert', async () => {
  const r = realm({ host: null });
  try {
    await settle(80);
    assert.strictEqual(r.na.enabled, false);
    assert.strictEqual(r.el().getAttribute('src'), '/track/t2');
    assert.strictEqual(r.own('currentTime'), false);
    assert.strictEqual(r.na.claim(r.el(), 't2', { type: 'audio', nativeQueue: () => ({ items: [], index: 0 }) }), false);
    assert.strictEqual(r.na.active(), false);
    assert.deepEqual(r.na.sleep(), { mode: 'off' });
    assert.strictEqual(r.na.syncQueue(), false);
    assert.strictEqual(r.na.setSleep('minutes', 10), false);
  } finally { r.close(); }
});

test('an older app build (a host without nativeAudio): the browser path, nothing posted, no subscription', async () => {
  const r = realm({ host: { capabilities: ['orientation', 'downloads', 'haptics'] } });
  try {
    await settle(80);
    assert.strictEqual(r.na.enabled, false);
    assert.strictEqual(r.el().getAttribute('src'), '/track/t2');
    assert.deepStrictEqual(r.fake.types().filter((t) => t.indexOf('audio.') === 0), [], 'no audio message of any kind');
  } finally { r.close(); }
});
