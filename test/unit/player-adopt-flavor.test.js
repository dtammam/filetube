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
  // a lock-screen shim so setupMediaSession's metadata is observable (gate r1, adversary W4)
  w.navigator.mediaSession = { metadata: null, playbackState: 'none', setActionHandler() {}, setPositionState() {} };
  w.MediaMetadata = function (init) { Object.assign(this, init); };
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
// NOTE: the player keeps the load data object it is handed (currentData) and the adopt mutates
// it, so every load below gets a FRESH copy of the shared fixtures.

// watch.js initWatch's load data: `{ ...mediaData, channelName, browseCtx, readerHref: null, resumeMode: null,
// autoAdvanceViaTrackNav: false }` (gate r1: the last stamp). DIVERGENT presentation on purpose
// (adversary W4): the media record's file title + uploader, where music shows the tag title + artist.
const WATCH_DATA = { id: 'a1', type: 'audio', title: 'file-a1', channelName: 'Uploader', folderName: 'Uploads', filePath: '/lib/a1.mp3', duration: 20, browseCtx: '', readerHref: null, resumeMode: null, autoAdvanceViaTrackNav: false };
// music.js loadTrack's load data for the same library audio item (the fields that matter here)
const MUSIC_DATA = {
  type: 'audio', title: 'Alpha One', channelName: 'Band', folderName: 'Band', album: 'Record', albumKey: 'Band␟Record',
  channelFolder: 'Band', duration: 20, artUrl: '/thumbnail/a1', streamSrc: '/video/a1', progressEndpoint: '/api/progress',
  resumeMode: 'music', autoAdvanceViaTrackNav: true, browseCtx: '{"src":"music"}', readerHref: '/music?nowplaying=1',
};

test('#237: Watch -> Music on the SAME id ADOPTS through the real load(), and the meta carries the music load\'s album + albumKey (the dock-return re-init reads them)', async () => {
  const r = realPlayerRealm();
  try {
    assert.strictEqual(r.player.load('a1', { ...WATCH_DATA }, { slot: r.slot }), true, 'the watch page loads the audio item');
    assert.strictEqual(r.player.getCurrentMeta().albumKey, '', 'precondition: the watch load declares no album key');
    assert.strictEqual(r.player.getCurrentMeta().title, 'file-a1', 'precondition: the watch presentation');
    assert.strictEqual(r.player.load('a1', { ...MUSIC_DATA }, { slot: r.slot }), true, 'music re-opens the same id');
    const meta = r.player.getCurrentMeta();
    assert.strictEqual(meta.isMusic, true, 'precondition: the adopt flipped the flavor to music');
    assert.strictEqual(meta.album, 'Record', 'the adopt refreshed the album');
    assert.strictEqual(meta.albumKey, 'Band␟Record', 'the adopt refreshed the album key');
    assert.strictEqual(meta.channelFolder, 'Band', 'the v1.317 channelFolder carry still holds');
    // gate r1 (adversary W4): the rest of the presentation set - the re-init read "file-a1 Uploader"
    assert.strictEqual(meta.title, 'Alpha One', 'the adopt refreshed the title (the tag title, not the file title)');
    assert.strictEqual(meta.artist, 'Band', 'and the artist (not the uploader)');
    const md = r.w.navigator.mediaSession.metadata;
    assert.ok(md, 'the lock screen was re-asserted on the adopt');
    assert.strictEqual(md.title, 'Alpha One', 'the lock-screen title follows the adopt');
    assert.strictEqual(md.artist, 'Band', 'and its artist');
    assert.strictEqual(md.album, 'Record', 'and its album');
  } finally { r.close(); }
});

// gate r1 (qa W2 = adversary W3): the reverse adopt, Listen -> Watch. Music's load declares
// autoAdvanceViaTrackNav true; watch.js now declares it FALSE, so the adopted video's natural end
// takes the VIDEO path (it honours the server autoplayNext setting) instead of the watch context's
// track nav. The control drives the pre-fix watch shape (no declaration): the end advanced.
test('gate r1 F3: Music -> Watch on the SAME id - the watch load\'s autoAdvanceViaTrackNav:false makes the natural end honour autoplayNext (no trackNav advance); the old shape advanced', async () => {
  for (const [watchData, expectQueueBranch, expectNexts, label] of [
    [WATCH_DATA, false, 0, 'the watch declaration: the video path (it reads autoplayNext, off here)'],
    [Object.assign({}, WATCH_DATA, { autoAdvanceViaTrackNav: undefined }), true, 1, 'control, the pre-fix watch shape (no declaration): the queue/trackNav branch'],
  ]) {
    const r = realPlayerRealm();
    try {
      const d = Object.assign({}, watchData);
      if (d.autoAdvanceViaTrackNav === undefined) delete d.autoAdvanceViaTrackNav; // truly undeclared
      r.player.load('a1', { ...MUSIC_DATA }, { slot: r.slot }); // a Listen play of the item
      assert.strictEqual(r.player.load('a1', d, { slot: r.slot }), true, 'the watch page re-opens the same id');
      assert.strictEqual(r.player.getCurrentMeta().isMusic, false, 'precondition: the flavor flipped to the plain video');
      let nexts = 0;
      r.player.setTrackNav({ onNext: () => { nexts += 1; } }); // the watch context's neighbor
      r.fetches.length = 0;
      r.w.document.getElementById('media-player').dispatchEvent(new r.w.Event('ended'));
      await settle(); await settle();
      const gets = r.fetches.filter((f) => f.indexOf('GET ') === 0);
      assert.strictEqual(gets.includes('GET /api/queue'), expectQueueBranch, label + ' (fetches: ' + gets.join(', ') + ')');
      if (!expectQueueBranch) assert.ok(gets.includes('GET /api/settings'), 'the video path consulted the autoplayNext setting');
      assert.strictEqual(nexts, expectNexts, label + ': track-nav advances');
    } finally { r.close(); }
  }
});

test('#237: after that adopt, the track\'s natural END advances through music\'s queue (the trackNav branch: GET /api/queue, onNext), never the video autoplay path', async () => {
  const r = realPlayerRealm();
  try {
    r.player.load('a1', { ...WATCH_DATA }, { slot: r.slot });
    r.player.load('a1', { ...MUSIC_DATA }, { slot: r.slot });
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
    r.player.load('a1', { ...MUSIC_DATA }, { slot: r.slot });
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
  applyAdoptFlavor(cur, { browseCtx: '', readerHref: null, resumeMode: null }); // an adopt that declares none of them
  assert.strictEqual(cur.album, 'Kept');
  assert.strictEqual(cur.albumKey, 'KeptKey');
  assert.strictEqual(cur.autoAdvanceViaTrackNav, true, 'an undeclared flag is kept (watch.js DECLARES false since gate r1, see F3)');
  applyAdoptFlavor(cur, { autoAdvanceViaTrackNav: false });
  assert.strictEqual(cur.autoAdvanceViaTrackNav, false, 'a declared false clears it');
  cur.autoAdvanceViaTrackNav = true;
  applyAdoptFlavor(cur, { album: 7, albumKey: null, autoAdvanceViaTrackNav: 'yes' });
  assert.strictEqual(cur.album, undefined, 'a declared non-string clears it');
  assert.strictEqual(cur.albumKey, undefined);
  assert.strictEqual(cur.autoAdvanceViaTrackNav, false, 'only a literal true arms the trackNav branch');
});

test('applyAdoptFlavor (gate r1, adversary W4): EVERY presentation field a loader declares is carried - title, channelName, folderName, artUrl, subId too - and a media field never is', () => {
  const cur = { title: 'file-a1', channelName: 'Uploader', folderName: 'Uploads', streamSrc: '/video/a1', duration: 20, type: 'audio' };
  applyAdoptFlavor(cur, { title: 'Alpha One', channelName: 'Band', folderName: 'Band', artUrl: '/thumbnail/a1', subId: 's1', streamSrc: '/track/zz', duration: 99, type: 'video', progressEndpoint: '/x' });
  assert.deepStrictEqual(
    { title: cur.title, channelName: cur.channelName, folderName: cur.folderName, artUrl: cur.artUrl, subId: cur.subId },
    { title: 'Alpha One', channelName: 'Band', folderName: 'Band', artUrl: '/thumbnail/a1', subId: 's1' });
  assert.deepStrictEqual({ streamSrc: cur.streamSrc, duration: cur.duration, type: cur.type, progressEndpoint: cur.progressEndpoint },
    { streamSrc: '/video/a1', duration: 20, type: 'audio', progressEndpoint: undefined }, 'the loaded media is untouched (that is what adopt means)');
  applyAdoptFlavor(cur, { title: null });
  assert.strictEqual(cur.title, undefined, 'a declared non-string clears it');
});
