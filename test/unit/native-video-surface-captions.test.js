'use strict';

// [UNIT] v1.399.0 native video surface, W4 (plan docs/exec-plans/active/2026-10-28-native-video-surface.md, S7): captions from the
// PROXY's time. Under `nativeVideo` the element has no media, so its TextTrack never advances; the overlay is fed by a cue list
// the web parses from the same /api/subtitles/:id WebVTT (a port of lib/transcript.js parseVttCues, bound equal here) and looks
// up at the proxy's currentTime, repainted every 250 ms while captions are on. Same overlay, same look; without the capability
// the <track> path is byte-identical (the control).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { installFakeHost } = require('../helpers/fake-host');
const player = require('../../public/js/player.js');
const transcript = require('../../lib/transcript.js');

const REPO = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(REPO, 'public', 'js', f), 'utf8');
const SCRIPTS = ['host-adapter.js', 'native-audio.js', 'player.js'];
const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms));
const CAPS = { capabilities: ['nativeAudio', 'nativeVideoAudio', 'nativeVideo'] };
const VIDEO = { id: 'v1', type: 'video', title: 'A talk', channelName: 'Ch', folderName: 'Ch', duration: 600, hasThumbnail: true, hasSubtitles: true, width: 1920, height: 1080, browseCtx: null, readerHref: null, resumeMode: null, autoAdvanceViaTrackNav: false, progressEndpoint: null, startAt: null };
const MODES = { autoplay: true, shuffle: false, loop: 'off' };
const ITEM = { kind: 'video', id: 'v1', src: '/api/offline/file/video/v1', title: 'A talk', artist: 'Ch', artworkSrc: '/thumbnail/v1', durationSec: 600, progress: { route: '/api/progress', key: 'v1' } };
const STATE = (rev, pos, extra) => Object.assign({ v: 1, type: 'audioState', rev, queue: [ITEM], index: 0, state: 'playing', positionSec: pos, durationSec: 600, rate: 1, modes: MODES, sleep: { mode: 'off' } }, extra || {});
const TICK = (rev, pos) => ({ v: 1, type: 'audioTick', rev, positionSec: pos });

// A fixture with everything the parser must handle: a BOM, CRLF, a header field, a NOTE block (one holding a timing line), a cue identifier, inline tags and
// entities, a rolling cue with a whitespace-only first payload line, a payload line that LOOKS like a timing line, a malformed
// timing block, and a STYLE block.
const VTT = '﻿WEBVTT\r\nKind: captions\r\nLanguage: en\r\n\r\nNOTE a comment\r\nthat spans two lines\r\n\r\nNOTE\r\n00:00:20.000 --> 00:00:21.000\r\nnot a cue: inside a NOTE block\r\n\r\n00:00:00.000 --> 00:00:02.000\r\nOne\r\n\r\nintro\r\n00:00:02.000 --> 00:00:04.000 align:start position:0%\r\n \r\nTwo<00:00:02.500><c> words</c> &amp; more\r\n\r\n00:00:10.000 --> 00:00:12.000\r\n<v Dean>Ten</v>\r\n00:00:99.999 --> 00:00:11.000\r\n\r\n00:00:xx.000 --> 00:00:14.000\r\nnever\r\n\r\nSTYLE\r\n::cue { color: red }\r\n\r\n01:00:00.000 --> 01:00:01.500\r\nAn hour\r\n';

test('W4 (pure): the client parser equals lib/transcript.js parseVttCues on the fixture (the port is bound to the server\'s parser)', () => {
  const ours = player.parseVttCues(VTT);
  const theirs = transcript.parseVttCues(VTT);
  assert.deepStrictEqual(ours, theirs);
  assert.deepStrictEqual(ours, [
    { startMs: 0, endMs: 2000, lines: ['One'] },
    { startMs: 2000, endMs: 4000, lines: ['Two words & more'] },
    { startMs: 10000, endMs: 12000, lines: ['Ten', '00:00:99.999 --> 00:00:11.000'] },
    { startMs: 3600000, endMs: 3601500, lines: ['An hour'] },
  ], 'the header, NOTE, STYLE and the malformed block are skipped; tags and entities are cleaned; a timing-looking payload line is payload');
  for (const garbage of ['', null, undefined, 42, 'WEBVTT', 'not a vtt\n\nat all']) assert.deepStrictEqual(player.parseVttCues(garbage), transcript.parseVttCues(garbage));
  assert.strictEqual(player.cleanVttCueLine('  <b>a</b>&nbsp;&lt;b&gt; '), transcript.cleanCueLine('  <b>a</b>&nbsp;&lt;b&gt; '));
});

test('W4 (pure): vttCuesActiveAt picks the cues showing at t (start <= t < end), in order, shaped for the overlay', () => {
  const cues = player.parseVttCues(VTT);
  assert.deepStrictEqual(player.vttCuesActiveAt(cues, 0), [{ text: 'One' }]);
  assert.deepStrictEqual(player.vttCuesActiveAt(cues, 1.999), [{ text: 'One' }]);
  assert.deepStrictEqual(player.vttCuesActiveAt(cues, 2), [{ text: 'Two words & more' }], 'the end is exclusive, the start inclusive');
  assert.deepStrictEqual(player.vttCuesActiveAt(cues, 5), []);
  assert.deepStrictEqual(player.vttCuesActiveAt(cues, 11), [{ text: 'Ten\n00:00:99.999 --> 00:00:11.000' }]);
  assert.deepStrictEqual(player.vttCuesActiveAt(cues, 3600.2), [{ text: 'An hour' }]);
  assert.deepStrictEqual(player.vttCuesActiveAt([{ startMs: 0, endMs: 1000, lines: ['a'] }, { startMs: 0, endMs: 1000, lines: ['b'] }], 0.5), [{ text: 'a' }, { text: 'b' }], 'two cues at once, document order');
  assert.deepStrictEqual(player.vttCuesActiveAt(cues, NaN), []);
  assert.deepStrictEqual(player.vttCuesActiveAt(null, 1), []);
  assert.deepStrictEqual(player.vttCuesActiveAt([{ startMs: 0, endMs: 1000, lines: [] }], 0.5), [], 'a text-less hold cue shows nothing');
});

function realm({ host = null } = {}) {
  const vc = new VirtualConsole();
  const dom = new JSDOM(fs.readFileSync(path.join(REPO, 'public', 'music.html'), 'utf8'), { url: 'http://localhost/watch.html?v=v1', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc });
  const w = dom.window;
  w.matchMedia = (q) => ({ matches: /max-width:\s*768px|pointer:\s*coarse|hover:\s*none/.test(q) && !/any-pointer/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  w.scrollTo = () => {};
  w.HTMLMediaElement.prototype.load = function () {};
  w.HTMLMediaElement.prototype.pause = function () {};
  w.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
  // jsdom has no TextTrack: the CC button reads `textTracks[0]` and flips its mode (a real browser's track never advances for a
  // src-less element either, which is exactly why S7 exists)
  const fakeTrack = { mode: 'disabled', activeCues: null, addEventListener() {}, removeEventListener() {} };
  Object.defineProperty(w.HTMLMediaElement.prototype, 'textTracks', { configurable: true, get() { return [fakeTrack]; } });
  w.resolveAudioArtUrl = () => '/albumart/t1';
  w.formatDuration = () => '';
  w.clampPositionState = (s) => s;
  w.navigator.mediaSession = { metadata: null, playbackState: 'none', setActionHandler() {}, setPositionState() {} };
  w.MediaMetadata = function (init) { Object.assign(this, init); };
  const calls = [];
  w.fetch = (u, init) => {
    const url = String(u); calls.push(((init && init.method) || 'GET') + ' ' + url);
    let body = {}; let text = '';
    if (url === '/api/settings') body = { backgroundAudioForVideo: false };
    else if (url.indexOf('/api/queue') === 0) body = { entries: [], pointerUid: null };
    else if (/^\/api\/progress\//.test(url)) body = { timestamp: 0 };
    else if (/^\/api\/subtitles\//.test(url)) text = VTT;
    return Promise.resolve({ ok: true, status: 200, json: async () => body, text: async () => text });
  };
  const fake = host ? installFakeHost(w, host) : null;
  for (const f of SCRIPTS) w.eval(read(f));
  return {
    w, fake, calls, player: w.FileTube.player, na: w.FileTube.nativeAudio,
    slot: w.document.getElementById('player-slot'),
    el: () => w.document.getElementById('media-player'),
    track: () => w.document.getElementById('cc-track'),
    ccBtn: () => w.document.getElementById('player-wrapper').querySelector('#cc-btn'),
    overlay: () => w.document.querySelector('.cc-overlay'),
    overlayText: () => { const o = w.document.querySelector('.cc-overlay'); return o && !o.hidden ? o.textContent : null; },
    subtitleFetches: () => calls.filter((c) => /\/api\/subtitles\//.test(c)).length,
    close: () => w.close(),
  };
}

test('W4 (S7): under nativeVideo the <track> stays inert and CC-on fetches the VTT once; the overlay follows native\'s position - ticks, snapshots and a seek through the proxy; CC-off hides it; CC-on again re-uses the list', async () => {
  const r = realm({ host: CAPS });
  try {
    r.player.load('v1', VIDEO, { slot: r.slot });
    await settle(80);
    const rev = r.fake.of('audio.load')[0].rev;
    assert.strictEqual(r.track().getAttribute('src'), '', 'the track element has no src: the browser never fetches the VTT for a proxied video');
    assert.strictEqual(r.subtitleFetches(), 0, 'nothing fetched before the user turns captions on');
    r.fake.emit(STATE(rev, 0.5));
    await settle(20);
    assert.notStrictEqual(r.ccBtn().style.display, 'none', 'the CC button is offered (hasSubtitles)');
    r.ccBtn().click();
    await settle(60);
    assert.strictEqual(r.subtitleFetches(), 1, 'ONE fetch of /api/subtitles/v1 at the first CC-on');
    assert.strictEqual(r.overlayText(), 'One', 'the cue at native\'s position (0.5 s)');
    r.fake.emit(TICK(rev, 2.2));
    await settle(20);
    assert.strictEqual(r.overlayText(), 'Two words & more', 'a tick moves the overlay (the proxy fires timeupdate)');
    r.fake.emit(STATE(rev, 5, { state: 'paused' }));
    await settle(20);
    assert.strictEqual(r.overlayText(), null, 'no cue at 5 s: hidden');
    r.el().currentTime = 10.5; // a seek through the proxy (a scrub on the web's bar)
    await settle(20);
    assert.strictEqual(r.overlayText(), 'Ten\n00:00:99.999 --> 00:00:11.000', 'the overlay follows the seek');
    assert.ok(r.fake.of('audio.seek').length >= 1, 'the seek went to native');
    // the 250 ms loop: native plays on from a 11.9 s tick with no further message; the cue ends at 12 s
    r.fake.emit(STATE(rev, 11.9, { state: 'playing' }));
    await settle(20);
    assert.ok(r.overlayText() !== null, 'showing at 11.9');
    await settle(450);
    assert.strictEqual(r.overlayText(), null, 'the extrapolated position passed 12 s: the overlay cleared without a new tick');
    r.ccBtn().click(); // off
    await settle(20);
    assert.strictEqual(r.overlayText(), null);
    r.fake.emit(TICK(rev, 0.5));
    await settle(300);
    assert.strictEqual(r.overlayText(), null, 'off stays off (no loop, no repaint)');
    r.ccBtn().click(); // on again
    await settle(60);
    assert.strictEqual(r.subtitleFetches(), 1, 'the list is kept for the item: no second fetch');
    assert.strictEqual(r.overlayText(), 'One');
  } finally { r.close(); }
});

test('W4 (S7): a new item drops the list and starts with captions off; a TV episode (no subtitles route) fetches nothing', async () => {
  const r = realm({ host: CAPS });
  try {
    r.player.load('v1', VIDEO, { slot: r.slot });
    await settle(80);
    r.fake.emit(STATE(r.fake.of('audio.load')[0].rev, 0.5));
    r.ccBtn().click();
    await settle(60);
    assert.strictEqual(r.overlayText(), 'One');
    r.player.load('v2', Object.assign({}, VIDEO, { id: 'v2' }), { slot: r.slot });
    await settle(80);
    assert.strictEqual(r.overlayText(), null, 'the teardown hid the overlay');
    assert.strictEqual(r.ccBtn().classList.contains('active'), false, 'captions start off for the next item, as before');
    r.fake.emit(STATE(r.fake.of('audio.load')[1].rev, 0.5));
    r.ccBtn().click();
    await settle(60);
    assert.strictEqual(r.subtitleFetches(), 2, 'the next item fetched its own document');
    assert.ok(r.calls.includes('GET /api/subtitles/v2'));
    const EP = { id: 'e9', type: 'video', title: 'Pilot', channelName: 'Show', duration: 1800, streamSrc: '/tvepisode/e9', statusUrl: '/api/tv/episode/e9', artUrl: '/tvposter/sh1', progressEndpoint: '/api/tv/progress', resumeMode: 'tv', readerHref: '/watch.html?tv=e9', progress: 0, hasSubtitles: true, browseCtx: null, autoAdvanceViaTrackNav: false, startAt: null };
    r.player.load('e9', EP, { slot: r.slot });
    await settle(80);
    r.ccBtn().click();
    await settle(60);
    assert.strictEqual(r.subtitleFetches(), 2, 'a TV episode has no subtitles route: nothing fetched');
  } finally { r.close(); }
});

test('CONTROL (S11): without nativeVideo the <track> carries /api/subtitles/:id as before and the page itself fetches no VTT at CC-on', async () => {
  const r = realm({ host: { capabilities: ['nativeAudio', 'nativeVideoAudio'] } });
  try {
    r.player.load('v1', VIDEO, { slot: r.slot });
    await settle(80);
    assert.strictEqual(r.track().getAttribute('src'), '/api/subtitles/v1', 'the browser\'s TextTrack path, byte-identical');
    r.ccBtn().click();
    await settle(300);
    assert.strictEqual(r.subtitleFetches(), 0, 'no page fetch, no loop: the track (jsdom loads none) is the source');
    assert.strictEqual(r.overlayText(), null);
  } finally { r.close(); }
});
