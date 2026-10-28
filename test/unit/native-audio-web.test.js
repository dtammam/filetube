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
  // a plain song AFTER the chaptered file: the solo-chapter exit has somewhere to go (the web's exit would jump here)
  { id: 's9', title: 'After', artist: 'Sp', album: 'Talk', albumKey: 'Sp\u001fTalk', durationSec: 100 },
];

function realm({ host = { capabilities: ['nativeAudio'] }, url = 'http://localhost/music?play=t2&ao=1', items = SONGS, progress = {}, queue = null } = {}) {
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
  const msActions = [], msState = [], msPos = [];
  w.navigator.mediaSession = { metadata: null, _pb: 'none', get playbackState() { return this._pb; }, set playbackState(v) { this._pb = v; msState.push(v); }, setActionHandler(a, h) { msActions.push([a, h === null ? null : typeof h]); }, setPositionState(p) { msPos.push(p); } };
  w.MediaMetadata = function (init) { Object.assign(this, init); };
  const calls = [];
  w.fetch = (u, init) => {
    const url = String(u); const method = (init && init.method) || 'GET';
    calls.push(method + ' ' + url);
    let body = {};
    if (/^\/api\/music\/progress\/|^\/api\/progress\//.test(url)) body = { position: progress[url.split('/').pop()] || 0 };
    else if (/^\/api\/videos\/vid1$/.test(url)) body = { id: 'vid1', title: 'A talk', channelName: 'Ch', folderName: 'Ch', duration: 600, chapters: [] }; // the Listen row's video
    else if (url.indexOf('/api/music') === 0) body = { items, total: items.length };
    else if (url.indexOf('/api/queue') === 0) body = queue ? (typeof queue === 'function' ? queue() : queue) : { entries: [], pointerUid: null };
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
  return { w, fake, calls, protoPlays, msActions, msState, msPos, errors, mod, player: w.FileTube.player, na: w.FileTube.nativeAudio, el, lastLoad, snap, tick, own, slot: w.document.getElementById('player-slot'), close: () => { try { mod.destroy(); } catch (_) { /* best-effort */ } w.close(); } };
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
    // BETWEEN loads (the view's registerTrackNav ran after the load, the next load has not cleared anything yet): no web
    // lock-screen handler may be live - setMediaSessionAction itself must null it, not only the clear at the next setup
    const midLoad = {};
    for (const [a, h] of r.msActions) midLoad[a] = h;
    assert.strictEqual(midLoad.previoustrack, null, 'previoustrack after registerTrackNav under native: ' + JSON.stringify(midLoad));
    assert.strictEqual(midLoad.nexttrack, null, 'nexttrack after registerTrackNav under native');
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
    const playsBefore = r.fake.of('audio.play').length;
    r.fake.emit(r.snap({ index: 2, positionSec: 0 }));
    await settle(120);
    assert.strictEqual(r.player.currentId, 't3');
    assert.strictEqual(r.fake.of('audio.load').length, before.loads, 'a follow posts no load');
    assert.strictEqual(r.fake.of('audio.jump').length, before.jumps, 'a follow posts no jump');
    assert.deepStrictEqual(r.fake.of('audio.pause'), [], 'the follow\'s teardown never pauses native (beginLoad / transitioning)');
    assert.strictEqual(r.calls.filter((c) => /^GET \/api\/music\/progress\/t3/.test(c)).length, 1, 'native\'s own advance keeps the browser\'s resume rule: the progress of the new item is read (gate r2 qa W-r2-1)');
    assert.strictEqual(r.fake.of('audio.play').length, playsBefore, 'but no redundant audio.play: native is already playing');
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
    // gate r1 adversary S-A: a same-rev snapshot of the item we just LEFT, arriving late, is not read as "native went back"
    const late = r.snap({ index: 2, positionSec: 41, queue: ld.queue.concat(picks) });
    r.fake.emit(late);
    await settle(80);
    assert.strictEqual(r.player.currentId, 'r1', 'the late snapshot of t3 did not drag the view back');
    const posBefore = r.el().currentTime;
    r.fake.emit(r.tick(77));
    await settle(10);
    assert.ok(Math.abs(r.el().currentTime - posBefore) < 0.5, 'an old-item tick inside the fence moves nothing (r2-S2): ' + r.el().currentTime);
    // gate r2 adversary W-r2-A: the jumped-to item FAILS and native skips on to the next one - that snapshot is trusted at once
    r.player.next(); // jump to r2 (index 4)
    await settle(80);
    assert.strictEqual(r.fake.of('audio.jump').pop().index, 4);
    r.fake.emit({ v: 1, type: 'audioError', id: 'r2', error: 'notPlayable' });
    r.fake.emit(r.snap({ index: 2, positionSec: 0, queue: ld.queue.concat(picks) })); // native wrapped to t3 (its own choice): neither the target nor the item left
    await settle(120);
    assert.strictEqual(r.player.currentId, 't3', 'a snapshot of another item clears the fence and is followed at once');
    assert.ok(r.el().currentTime < 1, 'and its position is read: ' + r.el().currentTime);
    r.fake.emit(r.snap({ index: 3, positionSec: 1, queue: ld.queue.concat(picks) }));
    await settle(40);
    assert.ok(Math.abs(r.el().currentTime - 1) < 0.3, 'the first snapshot of the jumped-to item is trusted (' + r.el().currentTime + ')');
  } finally { r.close(); }
});

test('gate r1 adversary W-A: a TERMINAL pagehide (persisted false) releases the subscription but never pauses native (audio keeps playing across a navigation); a persisted one only unsubscribes', async () => {
  const r = realm();
  try {
    await settle(80);
    r.fake.emit(r.snap({ positionSec: 30 }));
    await settle(20);
    const PH = r.w.PageTransitionEvent || r.w.Event;
    let ev; try { ev = new r.w.PageTransitionEvent('pagehide', { persisted: false }); } catch (_) { ev = new r.w.Event('pagehide'); Object.defineProperty(ev, 'persisted', { value: false }); }
    r.w.dispatchEvent(ev);
    await settle(40);
    assert.strictEqual(r.fake.of('audio.unsubscribe').length, 1, 'the subscription is released');
    assert.deepStrictEqual(r.fake.of('audio.pause'), [], 'never audio.pause on a navigation');
    assert.deepStrictEqual(r.fake.of('audio.stop'), [], 'never audio.stop either');
    assert.strictEqual(r.el().paused, false, 'the proxy still reads playing');
    assert.ok(PH);
  } finally { r.close(); }
});

test('gate r1 adversary W-B + W-C: under native the web writes no MediaSession playbackState or position; after the next WEB load (a video) the lock-screen transport handlers are functions again and no proxy property is left on the element', async () => {
  const r = realm();
  try {
    await settle(80);
    const pb0 = r.msState.length, pos0 = r.msPos.length;
    r.fake.emit(r.snap({ positionSec: 30 }));
    for (let i = 31; i < 36; i++) r.fake.emit(r.tick(i));
    r.fake.emit(r.snap({ state: 'paused', positionSec: 36 }));
    r.player.play(); r.player.pause();
    await settle(80);
    assert.strictEqual(r.msState.length, pb0, 'no playbackState write under native (play / pause events, ticks): ' + JSON.stringify(r.msState.slice(pb0)));
    assert.strictEqual(r.msPos.length, pos0, 'no setPositionState under native');
    const PROPS = ['currentTime', 'duration', 'paused', 'ended', 'playbackRate', 'defaultPlaybackRate', 'readyState', 'buffered', 'seeking', 'play', 'pause'];
    assert.deepStrictEqual(PROPS.filter((k) => Object.prototype.hasOwnProperty.call(r.el(), k)), PROPS, 'all eleven proxy properties are own while native owns the load');
    r.player.load('v1', { type: 'video', title: 'V', channelName: 'C' }, { slot: r.slot });
    await settle(60);
    const el = r.el();
    assert.deepStrictEqual(PROPS.filter((k) => Object.prototype.hasOwnProperty.call(el, k)), [], 'none left after the hand-back');
    assert.strictEqual(el.play, r.w.HTMLMediaElement.prototype.play, 'the real play() is back');
    const last = {};
    for (const [a, h] of r.msActions) last[a] = h;
    for (const a of ['play', 'pause', 'seekto', 'seekbackward', 'seekforward']) assert.strictEqual(last[a], 'function', a + ' is registered again for the web element: ' + JSON.stringify(last));
    assert.ok(r.msState.length > pb0, 'the web element\'s own playbackState writes resume');
  } finally { r.close(); }
});

test('gate r1 adversary W-C: a solo chapter tap (a row of a chaptered file with a later chapter) under native primes no radio and never jumps at the chapter end (native ends the clip); S-B: the position never extrapolates past the clip', async () => {
  const r = realm({ url: 'http://localhost/music?play=f%3A%3Ac1&ao=1', items: CHAPTERS });
  try {
    await settle(80);
    const row = r.w.document.querySelector('.music-song-row[data-index="0"]');
    assert.ok(row, 'the first chapter row is rendered');
    row.click();
    await settle(80);
    assert.strictEqual(r.player.currentId, 'f::c0', 'the tap loaded chapter 0 (a solo select: a later chapter exists)');
    const jumps = r.fake.of('audio.jump').length, seeks = r.fake.of('audio.seek').length;
    r.fake.emit(r.snap({ index: 0, positionSec: 29, durationSec: 30 }));
    for (const p of [29.5, 29.8, 29.95, 30]) { r.fake.emit(r.tick(p)); await settle(5); }
    await settle(400);
    assert.strictEqual(r.fake.of('audio.jump').length, jumps, 'no web jump at the solo chapter\'s end (the exit would jump to the song after the file)');
    assert.strictEqual(r.player.currentId, 'f::c0', 'the web did not move on by itself');
    assert.strictEqual(r.fake.of('audio.seek').length, seeks, 'no web seek either');
    assert.deepStrictEqual(r.calls.filter((c) => /\/api\/music\/radio/.test(c)), [], 'the solo exit station is never primed under native');
    assert.ok(r.el().currentTime <= 30.0001, 'the extrapolated position is clamped to the clip end (' + r.el().currentTime + ')');
  } finally { r.close(); }
});

test('gate r1 adversary S-B: a stale tick is dropped; an idle (lost-queue) native makes the next pick a LOAD, not a jump; setSleep posts the contract shapes; an ALAC row under native never prewarms /track', async () => {
  const r = realm({ items: SONGS.map((s, i) => (i === 2 ? Object.assign({}, s, { needsTranscode: true }) : s)) });
  try {
    await settle(80);
    r.fake.emit(r.snap({ positionSec: 20 }));
    r.fake.emit({ v: 1, type: 'audioTick', rev: 0, positionSec: 90 });
    await settle(20);
    assert.ok(r.el().currentTime < 30, 'a rev-0 tick is stale: ' + r.el().currentTime);
    assert.strictEqual(r.na.setSleep('minutes', 15), true);
    assert.deepStrictEqual(r.fake.of('audio.sleep').pop(), { v: 1, type: 'audio.sleep', mode: 'minutes', minutes: 15 });
    r.na.setSleep('endOfItem');
    assert.deepStrictEqual(r.fake.of('audio.sleep').pop(), { v: 1, type: 'audio.sleep', mode: 'endOfItem' });
    r.na.setSleep('off');
    assert.deepStrictEqual(r.fake.of('audio.sleep').pop(), { v: 1, type: 'audio.sleep', mode: 'off' });
    // native lost its queue; the user picks the ALAC row (index 2): a LOAD (native has nothing to jump within), and no /track prewarm
    r.fake.emit({ v: 1, type: 'audioState', rev: 0, queue: [], index: 0, state: 'idle', positionSec: 0, durationSec: 0, rate: 1, modes: { autoplay: true, shuffle: false, loop: 'off' }, sleep: { mode: 'off' } });
    await settle(20);
    const loads0 = r.fake.of('audio.load').length, jumps0 = r.fake.of('audio.jump').length;
    assert.ok(Math.abs(r.el().currentTime - 20) < 0.3, 'the lost-queue snapshot keeps the last known position (r2-S3): ' + r.el().currentTime);
    r.player.next();
    await settle(120);
    assert.strictEqual(r.player.currentId, 't3');
    assert.strictEqual(r.fake.of('audio.jump').length, jumps0, 'no jump into a queue native no longer holds');
    assert.strictEqual(r.fake.of('audio.load').length, loads0 + 1, 'the queue is re-sent');
    assert.deepStrictEqual(r.calls.filter((c) => /^GET \/track\//.test(c)), [], 'no ALAC prewarm of /track under native');
  } finally { r.close(); }
});

test('gate r1 adversary W-A (adoption): a fresh Music page while native already plays - the first snapshot makes the view adopt native\'s queue (its rows, the playing one as a FOLLOW): the dock shows it, nothing is posted, the web\'s resume / autostart stay silent, and the next load counts up from native\'s rev', async () => {
  const r = realm({ url: 'http://localhost/music' });
  try {
    await settle(80);
    assert.strictEqual(r.player.currentId, null, 'nothing loaded on a plain /music');
    const queue = [1, 2, 3].map((n) => ({ kind: 'track', id: 'n' + n, src: '/api/offline/file/track/n' + n, title: 'Native ' + n, artist: 'NA', album: 'NB', artworkSrc: '/albumart/n' + n, durationSec: 120, progress: { route: '/api/music/progress', key: 'n' + n }, radioSeed: 'track:n' + n }));
    r.fake.emit({ v: 1, type: 'audioState', rev: 5, queue, index: 1, state: 'paused', positionSec: 44, durationSec: 120, rate: 1, modes: { autoplay: true, shuffle: false, loop: 'off' }, sleep: { mode: 'off' } });
    await settle(150);
    assert.strictEqual(r.player.currentId, 'n2', 'the view adopted the playing item: ' + JSON.stringify(r.errors));
    assert.deepStrictEqual(r.fake.types().filter((t) => t.indexOf('audio.') === 0 && t !== 'audio.subscribe'), [], 'a follow: nothing posted (no load, no play, no seek)');
    assert.deepStrictEqual(r.calls.filter((c) => /^GET \/api\/music\/progress\//.test(c)), [], 'an ADOPTION reads no progress either: native is where it is');
    assert.strictEqual(r.el().paused, true, 'paused, as native reported');
    assert.ok(Math.abs(r.el().currentTime - 44) < 0.3);
    assert.strictEqual(r.player.getState(), 'docked', 'the mini player shows it');
    assert.strictEqual(r.player.getRemoteSnapshot().hasNext, true, 'the queue is native\'s');
    r.player.next();
    await settle(100);
    assert.strictEqual(r.fake.of('audio.jump').pop().index, 2, 'Next jumps within native\'s queue');
    r.fake.emit({ v: 1, type: 'audioState', rev: 5, queue, index: 2, state: 'playing', positionSec: 0, durationSec: 120, rate: 1, modes: { autoplay: true, shuffle: false, loop: 'off' }, sleep: { mode: 'off' } });
    await settle(60);
    // the web's next load counts up from native's rev (gate r2 adversary S-r2-A)
    const t1 = { id: 't1', type: 'audio', title: 'Song 1', channelName: 'A', album: 'B', duration: 100, artUrl: '/albumart/t1', streamSrc: '/track/t1', progressEndpoint: '/api/music/progress', resumeMode: 'music' };
    r.player.load('t1', Object.assign({}, t1, { nativeQueue: () => ({ items: [t1], index: 0 }) }), { slot: r.slot });
    await settle(30);
    assert.strictEqual(r.fake.of('audio.load').pop().rev, 6, 'rev 6 after adopting rev 5');
    r.player.load('v1', { type: 'video', title: 'V' }, { slot: r.slot });
    await settle(30);
    assert.strictEqual(r.fake.of('audio.stop').length, 1);
  } finally { r.close(); }
});

test('gate r2 adversary W-r2-C: a live native snapshot arriving while a VIDEO plays on the web element never makes Music adopt over it', async () => {
  const r = realm({ url: 'http://localhost/music' });
  try {
    await settle(80);
    r.player.load('v1', { type: 'video', title: 'V' }, { slot: r.slot });
    await settle(30);
    assert.strictEqual(r.el().getAttribute('src'), '/video/v1');
    const queue = [1, 2].map((n) => ({ kind: 'track', id: 'n' + n, src: '/api/offline/file/track/n' + n, title: 'Native ' + n, progress: { route: '/api/music/progress', key: 'n' + n } }));
    r.fake.emit({ v: 1, type: 'audioState', rev: 5, queue, index: 0, state: 'playing', positionSec: 10, durationSec: 120, rate: 1, modes: { autoplay: true, shuffle: false, loop: 'off' }, sleep: { mode: 'off' } });
    await settle(120);
    assert.strictEqual(r.player.currentId, 'v1', 'the video stays');
    assert.strictEqual(r.el().getAttribute('src'), '/video/v1');
    assert.deepStrictEqual(r.fake.types().filter((t) => t.indexOf('audio.') === 0 && t !== 'audio.subscribe'), [], 'nothing posted');
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
    assert.deepStrictEqual(ld.queue.map((it) => it.id), ['f::c0', 'f::c1', 's9']);
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

test('gate r1 qa C1: a Listen row (a VIDEO played as audio from the watch page) stays on the web element - native is stopped, the element gets its src, nothing is claimed', async () => {
  const r = realm({ url: 'http://localhost/music?play=vid1&listen=1', items: [{ id: 'vid1', listen: true, source: 'library', title: 'A talk', artist: 'Ch', album: '', albumKey: '', durationSec: 600, streamSrc: '/video/vid1', progressEndpoint: '/api/progress', artUrl: '/thumbnail/vid1' }] });
  try {
    await settle(120);
    assert.strictEqual(r.player.currentId, 'vid1', 'the listen row loaded: ' + JSON.stringify(r.errors));
    assert.strictEqual(r.el().getAttribute('src'), '/video/vid1', 'the web element plays the video\'s audio, as today');
    assert.deepStrictEqual(r.fake.of('audio.load'), [], 'never claimed: the audio file route cannot serve a video id');
    assert.strictEqual(r.own('currentTime'), false);
    assert.strictEqual(r.na.active(), false);
  } finally { r.close(); }
});

const SHAPED_QUEUE = (pointerUid) => ({ pointerUid, entries: [
  { uid: 'u-t2', mediaId: 't2', kind: 'track', item: { title: 'Song 2', name: 'Song 2', channelName: 'A', folderName: 'B', artUrl: '/albumart/art2?s=256&v=7', durationSec: 100, hasThumbnail: false } },
  { uid: 'u-q1', mediaId: 'q1', kind: 'track', item: { title: 'Queued One', name: 'Queued One', channelName: 'QA', folderName: 'QB', artUrl: '/albumart/artq1?s=256', durationSec: 77, hasThumbnail: false } },
  { uid: 'u-e1', mediaId: 'e1', kind: 'podcast', item: { title: 'An episode', name: 'An episode', channelName: 'The Show', folderName: 'The Show', artUrl: '/podcastart/sub1', durationSec: 1800, hasThumbnail: false } },
  { uid: 'u-q2', mediaId: 'q2', kind: 'track', item: { title: 'Queued Two', name: 'Queued Two', channelName: 'QA', folderName: 'QB', artUrl: '/albumart/artq2?s=256', durationSec: 66, hasThumbnail: false } },
] });

test('gate r1 qa W1 + W2 (D12): the server Up-next queue in its REAL shape - the track entries after the pointer join the Item list (artist from channelName, album from folderName, the art URL as served) in one more audio.load at the same index and position; a podcast entry (another kind) is left out; the web mirrors the rows and posts the pointer when native reaches one', async () => {
  const r = realm({ queue: SHAPED_QUEUE('u-t2') });
  try {
    await settle(150);
    const loads = r.fake.of('audio.load');
    assert.strictEqual(loads.length, 2, 'the view load, then the flattened queue: ' + JSON.stringify(r.errors));
    assert.deepStrictEqual(loads[1].queue.map((it) => it.id), ['t1', 't2', 't3', 'q1', 'q2'], 'the two track entries after the pointer, never the podcast');
    assert.strictEqual(loads[1].index, 1);
    assert.strictEqual(loads[1].rev, 2);
    // the re-sent queue is the VIEW's (the rows it mirrored, rebuilt through its own descriptor builder), so the entry's
    // artist / album / duration come from the real shapedQueue fields and the art is the track's own album art route
    const q1 = loads[1].queue[3];
    assert.deepStrictEqual({ kind: q1.kind, id: q1.id, src: q1.src, title: q1.title, artist: q1.artist, album: q1.album, durationSec: q1.durationSec, progress: q1.progress, radioSeed: q1.radioSeed }, { kind: 'track', id: 'q1', src: '/api/offline/file/track/q1', title: 'Queued One', artist: 'QA', album: 'QB', durationSec: 77, progress: { route: '/api/music/progress', key: 'q1' }, radioSeed: 'track:q1' }, 'the real shapedQueue fields');
    assert.match(q1.artworkSrc, /^\/albumart\//);
    assert.strictEqual(r.player.getRemoteSnapshot().hasNext, true, 'the web mirrored them: t2 has a Next beyond t3');
    // native reaches q1: the pointer follows (POST /api/queue/pointer with ITS uid), and the view follows the item
    r.fake.emit(r.snap({ index: 3, positionSec: 0 }));
    await settle(120);
    assert.ok(r.calls.includes('POST /api/queue/pointer'), 'the pointer moved: ' + JSON.stringify(r.calls.filter((c) => c.includes('queue'))));
    assert.strictEqual(r.player.currentId, 'q1');
  } finally { r.close(); }
});

test('gate r1 qa (suspicion 2): an engine that lost its queue reports rev 0 idle - the one older-rev snapshot the web accepts - and the next play re-sends the queue; any other older rev is still dropped', async () => {
  const r = realm();
  try {
    await settle(80);
    r.fake.emit(r.snap({ positionSec: 20 }));
    await settle(20);
    r.fake.emit({ v: 1, type: 'audioState', rev: 0, queue: [], index: 0, state: 'idle', positionSec: 0, durationSec: 0, rate: 1, modes: { autoplay: true, shuffle: false, loop: 'off' }, sleep: { mode: 'off' } });
    await settle(20);
    assert.strictEqual(r.el().paused, true, 'the web learned native is idle');
    r.player.play();
    const loads = r.fake.of('audio.load');
    assert.strictEqual(loads.length, 2, 'the queue is re-sent');
    assert.strictEqual(loads[1].autoplay, true);
    assert.strictEqual(loads[1].rev, 2);
    r.fake.emit({ v: 1, type: 'audioState', rev: 0, queue: loads[0].queue, index: 1, state: 'playing', positionSec: 99, durationSec: 100, rate: 1, modes: loads[0].modes, sleep: { mode: 'off' } });
    await settle(20);
    assert.ok(r.el().currentTime < 90, 'a rev-0 snapshot that is NOT the lost-queue shape is dropped like any stale one (' + r.el().currentTime + ')');
  } finally { r.close(); }
});

test('gate r1 qa (suspicion 1): the FIRST snapshot of a load fires loadedmetadata + durationchange on the element (the real duration arrives there), and does not ask the view to follow the item it just loaded', async () => {
  const r = realm();
  try {
    await settle(80);
    const seen = [];
    for (const ev of ['loadedmetadata', 'durationchange']) r.el().addEventListener(ev, () => seen.push(ev));
    const loadsBefore = r.fake.of('audio.load').length;
    r.fake.emit(r.snap({ positionSec: 0, durationSec: 147 }));
    await settle(60);
    assert.ok(seen.includes('loadedmetadata') && seen.includes('durationchange'), 'the dock learned the duration: ' + JSON.stringify(seen));
    assert.strictEqual(r.el().duration, 147);
    assert.strictEqual(r.fake.of('audio.load').length, loadsBefore, 'no follow re-load of the item the web itself loaded');
    assert.strictEqual(r.player.currentId, 't2');
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
