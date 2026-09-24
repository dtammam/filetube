'use strict';

// [UNIT] Tracker #237 (music follow-ups, 2026-09-24): a same-id ADOPT refreshes every field the
// adopting surface DECLARES. player.js load() adopts a same-id load (isAdoptLoad) and keeps the
// FIRST genuine load's data, refreshing only browseCtx plus applyAdoptFlavor's declared fields.
// An audio item opened on the WATCH page, then /music?play=<id>, adopted with the watch load's
// data: getCurrentMeta().album / albumKey read '' (the dock-return re-init had no album to
// rebuild), and without the music load's autoAdvanceViaTrackNav the track's natural end took the
// VIDEO autoplay path (GET /api/settings, autoplayNext off -> stop), so the visible album queue
// never advanced. MEASURED in headless Chromium before the fix (plan: the adopt probe).
//
// The drive here is the REAL public/js/player.js (the load() adopt branch, the real 'ended'
// cascade) inside a jsdom realm built from the real music.html shell (its player template).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { applyAdoptFlavor } = require('../../public/js/player.js');

const REPO = path.join(__dirname, '..', '..');

function realPlayerRealm() {
  const vc = new VirtualConsole(); // jsdom's own "not implemented" noise stays out of the report
  const dom = new JSDOM(fs.readFileSync(path.join(REPO, 'public', 'music.html'), 'utf8'), {
    url: 'http://localhost/music', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc,
  });
  const w = dom.window;
  w.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  w.HTMLMediaElement.prototype.load = function () {};
  w.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
  w.HTMLMediaElement.prototype.pause = function () {};
  // the two common.js page globals the audio load path reaches (common.js is not loaded here)
  w.resolveAudioArtUrl = () => '/thumbnail/a1';
  w.formatDuration = () => '';
  const fetches = [];
  w.fetch = (u, init) => {
    fetches.push(((init && init.method) || 'GET') + ' ' + String(u));
    const body = String(u).indexOf('/api/queue') === 0 ? { entries: [], pointerUid: null } : {};
    return Promise.resolve({ ok: true, json: async () => body });
  };
  w.eval(fs.readFileSync(path.join(REPO, 'public', 'js', 'player.js'), 'utf8'));
  return { w, player: w.FileTube.player, slot: w.document.getElementById('player-slot'), fetches, close: () => w.close() };
}
const settle = () => new Promise((r) => setTimeout(r, 20));

// watch.js initWatch's load data: `{ ...mediaData, channelName, browseCtx, readerHref: null, resumeMode: null }`
const WATCH_DATA = { id: 'a1', type: 'audio', title: 'Alpha One', channelName: 'Band', folderName: 'Band', filePath: '/lib/a1.mp3', duration: 20, browseCtx: '', readerHref: null, resumeMode: null };
// music.js loadTrack's load data for the same library audio item (the fields that matter here)
const MUSIC_DATA = {
  type: 'audio', title: 'Alpha One', channelName: 'Band', folderName: 'Band', album: 'Record', albumKey: 'Band␟Record',
  channelFolder: 'Band', duration: 20, artUrl: '/thumbnail/a1', streamSrc: '/video/a1', progressEndpoint: '/api/progress',
  resumeMode: 'music', autoAdvanceViaTrackNav: true, browseCtx: '{"src":"music"}', readerHref: '/music?nowplaying=1',
};

test('#237: Watch -> Music on the SAME id ADOPTS through the real load(), and the meta carries the music load\'s album + albumKey (the dock-return re-init reads them)', async () => {
  const r = realPlayerRealm();
  try {
    assert.strictEqual(r.player.load('a1', WATCH_DATA, { slot: r.slot }), true, 'the watch page loads the audio item');
    assert.strictEqual(r.player.getCurrentMeta().albumKey, '', 'precondition: the watch load declares no album key');
    assert.strictEqual(r.player.load('a1', MUSIC_DATA, { slot: r.slot }), true, 'music re-opens the same id');
    const meta = r.player.getCurrentMeta();
    assert.strictEqual(meta.isMusic, true, 'precondition: the adopt flipped the flavor to music');
    assert.strictEqual(meta.album, 'Record', 'the adopt refreshed the album');
    assert.strictEqual(meta.albumKey, 'Band␟Record', 'the adopt refreshed the album key');
    assert.strictEqual(meta.channelFolder, 'Band', 'the v1.317 channelFolder carry still holds');
  } finally { r.close(); }
});

test('#237: after that adopt, the track\'s natural END advances through music\'s queue (the trackNav branch: GET /api/queue, onNext), never the video autoplay path', async () => {
  const r = realPlayerRealm();
  try {
    r.player.load('a1', WATCH_DATA, { slot: r.slot });
    r.player.load('a1', MUSIC_DATA, { slot: r.slot });
    let nexts = 0;
    r.player.setTrackNav({ onNext: () => { nexts += 1; } });
    r.fetches.length = 0;
    r.w.document.getElementById('media-player').dispatchEvent(new r.w.Event('ended'));
    await settle(); await settle();
    const gets = r.fetches.filter((f) => f.indexOf('GET ') === 0);
    assert.deepStrictEqual(gets, ['GET /api/queue'], 'the music branch consulted the queue (the video path fetches /api/settings)');
    assert.strictEqual(nexts, 1, 'and advanced through the registered track nav');
  } finally { r.close(); }
});

test('#237 control: a GENUINE music load (nothing adopted) ends the same way - the adopt now matches it', async () => {
  const r = realPlayerRealm();
  try {
    r.player.load('a1', MUSIC_DATA, { slot: r.slot });
    let nexts = 0;
    r.player.setTrackNav({ onNext: () => { nexts += 1; } });
    r.fetches.length = 0;
    r.w.document.getElementById('media-player').dispatchEvent(new r.w.Event('ended'));
    await settle(); await settle();
    assert.deepStrictEqual(r.fetches.filter((f) => f.indexOf('GET ') === 0), ['GET /api/queue']);
    assert.strictEqual(nexts, 1);
    assert.strictEqual(r.player.getCurrentMeta().albumKey, 'Band␟Record');
  } finally { r.close(); }
});

test('applyAdoptFlavor (#237): album / albumKey / autoAdvanceViaTrackNav follow the declared-field contract - declared replaces, undeclared keeps', () => {
  const cur = { title: 'Alpha One', channelName: 'Band', browseCtx: '' }; // the watch load: none of the three
  applyAdoptFlavor(cur, { album: 'Record', albumKey: 'K', autoAdvanceViaTrackNav: true, resumeMode: 'music' });
  assert.strictEqual(cur.album, 'Record');
  assert.strictEqual(cur.albumKey, 'K');
  assert.strictEqual(cur.autoAdvanceViaTrackNav, true);
  applyAdoptFlavor(cur, { album: '', albumKey: '' }); // a music load of an album-less track
  assert.strictEqual(cur.album, '', 'a declared \'\' clears a stale album');
  assert.strictEqual(cur.albumKey, '', 'and a stale key');
  cur.album = 'Kept'; cur.albumKey = 'KeptKey';
  applyAdoptFlavor(cur, { browseCtx: '', readerHref: null, resumeMode: null }); // watch.js declares none of them
  assert.strictEqual(cur.album, 'Kept');
  assert.strictEqual(cur.albumKey, 'KeptKey');
  assert.strictEqual(cur.autoAdvanceViaTrackNav, true, 'watch.js leaves the flag (a Listen -> Watch end still stops: measured, the music nav is gone with its view)');
  applyAdoptFlavor(cur, { album: 7, albumKey: null, autoAdvanceViaTrackNav: 'yes' });
  assert.strictEqual(cur.album, undefined, 'a declared non-string clears it');
  assert.strictEqual(cur.albumKey, undefined);
  assert.strictEqual(cur.autoAdvanceViaTrackNav, false, 'only a literal true arms the trackNav branch');
});
