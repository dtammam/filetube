'use strict';

// [INTEGRATION] Chapter Snap persist (#269, gate r1 adversary W2 = qa W2): a FLAT pocket-menu
// queue that holds only SOME of a file's chapters (Liked Songs: one chapter) survives a return
// re-check after ANOTHER device re-timed the file - it is patched in place, never replaced by the
// whole Songs library, and its flat segment end (K4) still pauses with Autoplay off. Driven through
// the REAL music.js view + skin engine against a REAL server (its own DATA_DIR), the shared
// harness in test/helpers/pocket-menu-harness.js; the fixture is the adversary's r1 repro.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-snap-return-flat-'));
const DATA_DIR = process.env.DATA_DIR;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, updateDatabase, musicDb } = require('../../server');
const musicStore = require('../../lib/music/store');
const { seedState } = require('../helpers/seed-state');
const { authenticateFetch } = require('../helpers/auth');
const { createPocketHarness } = require('../helpers/pocket-menu-harness');


let server, base, auth, authedFetch;
const ROOT = path.join(DATA_DIR, 'ytdlp');
const { menu, select, labels, tapRow, settleNet, boot } = createPocketHarness(() => ({ base, authedFetch }));
const XSS = '<img src=x onerror=window.__pwn=1>';
const AUTOPLAY_KEY = 'ft-music-autoplay'; // music.js AUTOPLAY_STORAGE_KEY

function audioItem(id, folderName, artistName, tags, extra) {
  return Object.assign({
    id, type: 'audio', title: (tags && tags.title) || id, name: `${id}.mp3`,
    filePath: path.join(ROOT, folderName, `${id}.mp3`), rootFolder: ROOT, folderName, channelName: artistName,
    duration: 200, hasThumbnail: true, ext: '.mp3', addedAt: 1788000000000,
    tags: Object.assign({ artist: artistName }, tags || {}),
  }, extra || {});
}
const MIX_CHAPTERS = [{ startTime: 0, title: 'Intro' }, { startTime: 300, title: 'Track A' }, { startTime: 900, title: 'Track B' }];

before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  auth = authenticateFetch(server, base);
  authedFetch = global.fetch;
  seedState({ folders: [ROOT], folderSettings: {}, metadata: {}, liked: [], settings: { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30 } });
  await updateDatabase((db) => {
    db.metadata = {
      nd1: audioItem('nd1', 'tonzak', 'Tonzak', { title: 'Neon Arrival', album: 'Night Drive', track: '1', genre: 'Synthwave' }, { addedAt: 1788000000001 }),
      nd2: audioItem('nd2', 'tonzak', 'Tonzak', { title: 'Overpass', album: 'Night Drive', track: '2', genre: 'Synthwave' }, { addedAt: 1788000000002 }),
      nd3: audioItem('nd3', 'tonzak', 'Tonzak', { title: 'Tail Lights', album: 'Night Drive', track: '3', genre: 'Synthwave' }, { addedAt: 1788000000003 }),
      rm1: audioItem('rm1', 'nestalgiamusic', 'NESTALGIA', { title: 'Cartridge Blues', album: 'Retro Mix', track: '1', genre: 'Music' }),
      rm2: audioItem('rm2', 'nestalgiamusic', 'NESTALGIA', { title: 'Pixel Rain', album: 'Retro Mix', track: '2', genre: 'Music' }),
      djmix1: audioItem('djmix1', 'nestalgiamusic', 'NESTALGIA', { title: 'Full Album Mix', genre: 'Music' },
        { title: 'Full Album Mix', duration: 1800, chapters: MIX_CHAPTERS }),
      za1: audioItem('za1', 'zarchivo', 'Zarchivo', { title: 'Loose Single' }),
      // crafted markup in EVERY string a menu level renders (title, artist, album, genre)
      xss1: audioItem('xss1', 'evil', XSS, { title: XSS + ' song', album: '<b class=pwn>alb</b>', genre: '<i class=pwn>g</i>' }),
    };
    // thirty fillers (title-sorted LAST) so the Songs list is longer than one browse chunk (K3)
    for (let f = 1; f <= 30; f++) {
      const id = 'fil' + f;
      db.metadata[id] = audioItem(id, 'fillers', 'Filler Band', { title: 'Zz Filler ' + String(f).padStart(2, '0'), album: 'Fillers', track: String(f), genre: 'Filler' });
    }
    musicDb.mutate((h) => {
      const ns = musicStore.ensureMusic(h);
      ns.folders = [ROOT];
      // a NATIVE track with neither artist nor album artist: the untagged-artist bucket ('')
      ns.tracks = { nat1: { id: 'nat1', title: 'Nameless Tune', artist: '', albumArtist: '', album: '', filePath: path.join(ROOT, 'native/nat1.mp3'), rootFolder: ROOT, folderName: 'native', ext: '.mp3', codec: 'mp3', durationSec: 100, albumArtKey: null, addedAt: '2026-01-01T00:00:00.000Z' } };
      return true;
    });
    return true;
  });
});

after(async () => {
  auth.restore();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});
const mp = (h, t, dur) => {
  const el = h.D.getElementById('media-player');
  Object.defineProperty(el, 'duration', { configurable: true, get: () => dur });
  Object.defineProperty(el, 'currentTime', { configurable: true, get: () => t.v, set(v) { t.v = v; } });
  el.play = () => Promise.resolve(); el.pause = () => { h.paused = (h.paused || 0) + 1; };
  return el;
};
async function tick(h, el, t, v) { t.v = v; el.dispatchEvent(new h.dom.window.Event('timeupdate')); await settleNet(5); }
async function setMix(text) {
  const r = await authedFetch(base + '/api/videos/djmix1/chapters', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
  assert.ok(r.ok, 'chapter write ' + r.status);
}


for (const [label, text, end] of [['a LATER chapter moved (Track B 900 -> 905, same count)', '0:00 Intro\n5:00 Track A\n15:05 Track B', 905],
  ['the liked chapter itself moved (Track A 300 -> 310)', '0:00 Intro\n5:10 Track A\n15:00 Track B', 900]]) {
  test(`Liked Songs holding ONE chapter, Autoplay off - ${label} on another device, the page comes back: no library re-list, the segment still ends with a pause`, async () => {
    await setMix('0:00 Intro\n5:00 Track A\n15:00 Track B');
    const lr = await authedFetch(base + '/api/liked/' + encodeURIComponent('djmix1::c1'), { method: 'POST' });
    assert.ok(lr.ok, 'liked ' + lr.status);
    await boot({ skin: 'ipod', play: 'nd1', setup: (dom) => { dom.window.localStorage.setItem(AUTOPLAY_KEY, '0'); }, run: async (h) => {
      menu(h); select(h); tapRow(h, 'Playlists'); await settleNet();
      tapRow(h, 'Liked Songs'); await settleNet();
      assert.ok(labels(h).indexOf('Track A') >= 0, 'the Liked Songs level lists the liked chapter');
      tapRow(h, 'Track A'); await settleNet();
      assert.strictEqual(h.player.currentId, 'djmix1::c1', 'the liked chapter plays');
      const t = { v: 300 }; const el = mp(h, t, 1800);
      await tick(h, el, t, 312);
      const logBefore = h.log.length;
      await setMix(text); // ANOTHER device re-times the file
      Object.defineProperty(h.D, 'visibilityState', { configurable: true, get: () => 'visible' });
      h.D.dispatchEvent(new h.dom.window.Event('visibilitychange'));
      await settleNet(80);
      const after = h.log.slice(logBefore);
      assert.ok(after.some((u) => /^\/api\/videos\/djmix1$/.test(u)), 'the return re-checked the playing file');
      assert.deepStrictEqual(after.filter((u) => /^\/api\/music\?/.test(u) && /limit=1000\b/.test(u)), [], 'no Songs-library re-list over the Liked queue');
      const loadsBefore = h.spy.loads.length; const pausedBefore = h.paused || 0;
      await tick(h, el, t, end - 0.8); await tick(h, el, t, end - 0.1); await tick(h, el, t, end + 0.3);
      assert.strictEqual(h.spy.loads.length - loadsBefore, 0, 'nothing loads at the segment end (the list ends, Autoplay off)');
      assert.ok((h.paused || 0) - pausedBefore >= 1, 'the flat segment end (K4) paused at the NEW boundary');
    } });
  });
}
