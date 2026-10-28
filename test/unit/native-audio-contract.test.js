'use strict';

// [UNIT] v1.397.0 native audio (plan docs/exec-plans/active/2026-10-28-native-audio.md, Step 0 red-first):
// a host announcing `nativeAudio` gets `audio.load` with the whole queue at the player.load choke point and the
// web's media element gets NO src (native owns playback; two audio stacks never both play). With no host the
// audio path is byte-identical: the element's src is the stream URL and nothing is posted (D10).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { installFakeHost } = require('../helpers/fake-host');

const REPO = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(REPO, 'public', 'js', f), 'utf8');
const SCRIPTS = ['host-adapter.js', 'native-audio.js', 'player.js'];
const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));

function realm({ host = null } = {}) {
  const vc = new VirtualConsole();
  const dom = new JSDOM(fs.readFileSync(path.join(REPO, 'public', 'music.html'), 'utf8'), { url: 'http://localhost/music', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc });
  const w = dom.window;
  w.matchMedia = (q) => ({ matches: /max-width:\s*768px|pointer:\s*coarse/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  w.scrollTo = () => {};
  const plays = [];
  w.HTMLMediaElement.prototype.load = function () {};
  w.HTMLMediaElement.prototype.pause = function () {};
  w.HTMLMediaElement.prototype.play = function () { plays.push(this.id); return Promise.resolve(); };
  w.resolveAudioArtUrl = () => '/albumart/t1';
  w.formatDuration = () => '';
  w.clampPositionState = (s) => s;
  w.navigator.mediaSession = { metadata: null, playbackState: 'none', setActionHandler() {}, setPositionState() {} };
  w.MediaMetadata = function (init) { Object.assign(this, init); };
  w.fetch = (u) => Promise.resolve({ ok: true, json: async () => (String(u).indexOf('/api/queue') === 0 ? { entries: [], pointerUid: null } : {}) });
  const fake = host ? installFakeHost(w, host) : null;
  for (const f of SCRIPTS) { if (fs.existsSync(path.join(REPO, 'public', 'js', f))) w.eval(read(f)); }
  return { w, fake, plays, player: w.FileTube.player, slot: w.document.getElementById('player-slot'), el: () => w.document.getElementById('media-player'), close: () => w.close() };
}
const track = (id, extra) => Object.assign({ id, type: 'audio', title: 'Song ' + id, channelName: 'A', folderName: 'A', album: 'B', albumKey: 'A\u001fB', duration: 100, artUrl: '/albumart/' + id, streamSrc: '/track/' + id, progressEndpoint: '/api/music/progress', resumeMode: 'music', autoAdvanceViaTrackNav: true, readerHref: '/music?nowplaying=1' }, extra || {});
const QUEUE = [track('t1'), track('t2'), track('t3')];
const withQueue = (data, index) => Object.assign({}, data, { nativeQueue: () => ({ items: QUEUE, index }) });

test('RED FIRST: a host announcing nativeAudio gets audio.load with the whole queue and the element gets NO src', async () => {
  const r = realm({ host: { capabilities: ['nativeAudio'] } });
  try {
    assert.strictEqual(r.w.FileTube.host.has('nativeAudio'), true, 'the adapter knows the capability');
    r.player.load('t2', withQueue(QUEUE[1], 1), { slot: r.slot });
    await settle();
    const el = r.el();
    assert.ok(el, 'the shared media element exists');
    assert.strictEqual(el.getAttribute('src'), null, 'no src attribute: the web element is silent under native');
    assert.strictEqual(el.src, '', 'no src: the web element is silent under native');
    assert.deepStrictEqual(r.plays, [], 'the web element is never played');
    const loads = r.fake.of('audio.load');
    assert.strictEqual(loads.length, 1, 'exactly one audio.load');
    const msg = loads[0];
    assert.strictEqual(msg.index, 1);
    assert.strictEqual(msg.queue.length, 3, 'the WHOLE queue goes up front (D5)');
    assert.deepStrictEqual(msg.queue.map((it) => it.id), ['t1', 't2', 't3']);
    assert.strictEqual(msg.queue[1].src, '/api/offline/file/track/t2', 'the iOS-playable file route, never /track (503s while an ALAC rendition transcodes)');
    assert.strictEqual(msg.queue[1].kind, 'track');
    assert.deepStrictEqual(msg.queue[1].progress, { route: '/api/music/progress', key: 't2' });
    assert.strictEqual(typeof msg.rev, 'number');
  } finally { r.close(); }
});

test('CONTROL: no host - the same load sets the element src to the stream URL and posts nothing (D10 byte-identity)', async () => {
  const r = realm({ host: null });
  try {
    r.player.load('t2', withQueue(QUEUE[1], 1), { slot: r.slot });
    await settle();
    assert.strictEqual(r.el().getAttribute('src'), '/track/t2', 'the browser path is untouched');
  } finally { r.close(); }
});

test('CONTROL: a host WITHOUT nativeAudio (an older app build) is the browser path too', async () => {
  const r = realm({ host: { capabilities: ['orientation', 'downloads'] } });
  try {
    r.player.load('t2', withQueue(QUEUE[1], 1), { slot: r.slot });
    await settle();
    assert.strictEqual(r.el().getAttribute('src'), '/track/t2');
    assert.deepStrictEqual(r.fake.of('audio.load'), [], 'nothing posted');
  } finally { r.close(); }
});
