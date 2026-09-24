'use strict';

// [UNIT] v1.317 M4 (Dean): desktop MUSIC ambient. "Ambient mode in the music player in
// desktop" / "I have ambient mode selected in this player but I don't see any ambience
// for the music." The cog's Ambient row lives in the PERSISTENT player host, so it rode
// along from a watch visit into Music - checked, and inert: nothing on the music side
// read it. Now music.js drives the SAME engine through the SAME host as the watch page
// (public/js/ambient.js createAmbientHost), with the playing track's ALBUM ART as the
// image (base media id, never `::c`; same-origin only).
//
// Everything here drives the REAL shapes (the INERT FEATURE lesson): the real music.html
// (its #view-root, its #music-player-stage + glow pair, and its REAL player host template
// with the real cog menu), the real music.js, the real ambient.js, and tracks serialized
// by the SERVER's own publicTrackListItem from the real expandAudioToTracks projection -
// played through the real `?play=` continue path and the real row tap. The player stub
// mounts the template's host exactly as player.js does (clone once, reparent into the
// slot / the dock). Axes bound: paint (ON + dark + playing + desktop + expanded here),
// every OFF axis, the CLEAR axis on a populated glow, dock / expand, a track advance, a
// chapter roll, teardown (every signal aborted, observers disconnected), a late seam of a
// dead view, and the cog row shared with the watch view.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { JSDOM } = require('jsdom');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-music-ambient-'));
const { publicTrackListItem } = require('../../server');
const { expandAudioToTracks } = require('../../lib/music/libraryAudio.js');

const REPO = path.join(__dirname, '..', '..');
const MUSIC_HTML = fs.readFileSync(path.join(REPO, 'public/music.html'), 'utf8');
const WATCH_JS = fs.readFileSync(path.join(REPO, 'public/js/watch.js'), 'utf8');
const musicPath = require.resolve('../../public/js/music.js');
const AMBIENT = require('../../public/js/ambient.js');
const SKINS = require('../../public/js/music-skins.js');
const MUSIC = require('../../public/js/music.js');

const settle = () => new Promise((r) => setImmediate(r));
async function settleN(n) { for (let i = 0; i < (n || 10); i++) await settle(); }
async function until(fn, ms) {
  const end = Date.now() + (ms || 8000);
  while (Date.now() < end) { if (fn()) return true; await new Promise((r) => setTimeout(r, 50)); }
  return fn();
}

// ---- the REAL track shapes (the server's own serializer over the real projection) ----
const CHAPTERED_ITEM = {
  id: 'yt1abcDEF', title: 'Live at the Hall', name: 'live.mp3', type: 'audio', ext: '.mp3',
  filePath: '/library/Chan/live.mp3', rootFolder: '/library', folderName: 'Chan', channelName: 'Chan',
  duration: 600, addedAt: Date.now(), hasThumbnail: true, tags: {},
};
const CHAPTERS = [{ startTime: 0, title: 'Opener' }, { startTime: 200, title: 'Middle' }, { startTime: 400, title: 'Closer' }];
const CHAPTER_TRACKS = expandAudioToTracks(CHAPTERED_ITEM, () => CHAPTERS).map((t) => publicTrackListItem(t, 'u1', null, null));
const NATIVE = [
  { id: 'n1', title: 'Native One', artist: 'Band', album: 'Record', albumArtist: 'Band', trackNo: 1, ext: '.mp3', codec: 'mp3', durationSec: 180 },
  { id: 'n2', title: 'Native Two', artist: 'Band', album: 'Record', albumArtist: 'Band', trackNo: 2, ext: '.mp3', codec: 'mp3', durationSec: 190 },
].map((t) => publicTrackListItem(t, 'u1', null, null));

test('fixture sanity: the server shapes are what production emits (chapter ids `<base>::c<n>` with the BASE thumbnail art; native tracks carry no art URL)', () => {
  assert.deepStrictEqual(CHAPTER_TRACKS.map((t) => t.id), ['yt1abcDEF::c0', 'yt1abcDEF::c1', 'yt1abcDEF::c2']);
  for (const t of CHAPTER_TRACKS) {
    assert.strictEqual(t.source, 'library-chapter');
    assert.strictEqual(t.artUrl, '/thumbnail/yt1abcDEF', 'every chapter carries the FILE\'s art');
    assert.ok(t.albumKey, 'an album key (the album drill + ?play= land in the album)');
  }
  for (const t of NATIVE) assert.strictEqual(t.artUrl, undefined, 'a native track has no art URL (music.js falls to /albumart/<id>)');
});

test('v1.317 musicAmbientArtUrl: the cover rule on the BASE id - explicit art wins, a `::c` id never reaches a URL, the listen marker keeps its thumbnail', () => {
  const f = MUSIC.musicAmbientArtUrl;
  assert.strictEqual(f('yt1abcDEF::c2', '/thumbnail/yt1abcDEF', null), '/thumbnail/yt1abcDEF', 'a projected chapter: its own (base) art');
  assert.strictEqual(f('n1', undefined, null), '/albumart/n1', 'a native track: the /albumart route');
  assert.strictEqual(f('yt1abcDEF::c2', '', null), '/albumart/yt1abcDEF', 'a chapter whose entry lost its art: the BASE id, never `::c2`');
  assert.strictEqual(f('v9::c1', '', 'v9::c0'), '/thumbnail/v9', 'a listen chapter the queue lost: the listen marker (same base) keeps the thumbnail route');
  assert.strictEqual(f('v9', '', 'v9'), '/thumbnail/v9', 'a plain listen track');
  assert.strictEqual(f('n1', '', 'v9'), '/albumart/n1', 'a DIFFERENT listen marker does not apply');
  assert.strictEqual(f('', '/x', null), '', 'nothing playing -> no art');
  assert.strictEqual(f(null, '/x', null), '');
});

// ---- the harness ------------------------------------------------------------------
async function boot(opts) {
  opts = opts || {};
  const dom = new JSDOM(MUSIC_HTML, { url: 'http://localhost/music' + (opts.search || ''), pretendToBeVisual: true });
  const W = dom.window;
  const D = W.document;
  D.documentElement.setAttribute('data-mode', opts.mode || 'dark');
  D.body.setAttribute('data-view', 'music');
  const savedKeys = ['window', 'document', 'localStorage', 'fetch', 'AbortController', 'MutationObserver', 'Image', 'location'];
  const saved = {};
  for (const k of savedKeys) saved[k] = global[k];
  // Browser collaborators, each observable.
  const loads = [];
  class FakeImage {
    constructor() { this.naturalWidth = 0; this.naturalHeight = 0; }
    set src(u) { this._src = u; loads.push(u); setImmediate(() => { this.naturalWidth = 300; this.naturalHeight = 300; if (this.onload) this.onload(); }); }
    get src() { return this._src; }
  }
  const observers = [];
  class SpyMO extends W.MutationObserver {
    constructor(cb) { super(cb); this.disconnected = false; this.targets = []; observers.push(this); }
    observe(target, o) { this.targets.push({ target, o }); return super.observe(target, o); }
    disconnect() { this.disconnected = true; return super.disconnect(); }
  }
  const bound = [];
  const origAdd = W.EventTarget.prototype.addEventListener;
  W.EventTarget.prototype.addEventListener = function (type, fn, o) {
    if (o && typeof o === 'object' && o.signal) bound.push({ target: this, type, signal: o.signal });
    return origAdd.call(this, type, fn, o);
  };
  let lastDrawn = null;
  W.HTMLCanvasElement.prototype.getContext = function () {
    return {
      drawImage(img) { lastDrawn = img; },
      getImageData(x, y, w, h) {
        const u = (lastDrawn && lastDrawn.src) || '';
        let hsh = 2166136261; for (let i = 0; i < u.length; i++) hsh = Math.imul(hsh ^ u.charCodeAt(i), 16777619) >>> 0; // FNV-1a: one char apart = a far colour
        const data = new Uint8ClampedArray(w * h * 4);
        for (let i = 0; i < data.length; i += 4) { data[i] = hsh % 256; data[i + 1] = (hsh >> 8) % 256; data[i + 2] = (hsh >> 16) % 256; data[i + 3] = 255; }
        return { data, width: w, height: h };
      },
      putImageData() {},
    };
  };
  let pngs = 0;
  W.HTMLCanvasElement.prototype.toDataURL = function () { pngs++; return 'data:image/png;base64,UE5H' + pngs; };
  // The mobile axis: the REAL music-skins isMobileViewport reads window.matchMedia.
  const mq = { mobile: !!opts.mobile, listeners: [] };
  W.matchMedia = (q) => ({ get matches() { return /max-width:\s*768px/.test(q) ? mq.mobile : false; }, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  W.scrollTo = () => {};
  try { W.localStorage.setItem('filetube_music_tab', 'songs'); } catch (_) { /* ignore */ }
  if (opts.pref !== undefined) W.localStorage.setItem('ft-ambient', opts.pref);
  const tracks = opts.tracks || NATIVE.concat(CHAPTER_TRACKS);
  const deferred = [];
  const fetchImpl = (url, init) => {
    const s = String(url);
    const json = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });
    if (init && init.method && init.method !== 'GET') return json({});
    if (opts.deferRecent && s.indexOf('filter=recent-listening') !== -1) return new Promise((resolve) => { deferred.push(() => resolve({ ok: true, status: 200, json: async () => ({ items: tracks }) })); });
    if (s.indexOf('/api/music?') !== -1 && s.indexOf('filter=liked') === -1 && s.indexOf('artist=') === -1) {
      const m = /[?&]album=([^&]*)/.exec(s);
      if (m) { const key = decodeURIComponent(m[1]); return json({ items: tracks.filter((t) => t.albumKey === key) }); }
      return json({ items: tracks });
    }
    const one = /\/api\/music\/([^?]+)$/.exec(s);
    if (one) { const t = tracks.find((x) => x.id === decodeURIComponent(one[1])); return t ? json(t) : Promise.resolve({ ok: false, status: 404, json: async () => ({}) }); }
    return json({ items: [] });
  };
  Object.assign(global, { window: W, document: D, localStorage: W.localStorage, fetch: fetchImpl, AbortController: W.AbortController, MutationObserver: SpyMO, Image: FakeImage, location: W.location });
  W.fetch = fetchImpl;
  // The player: clones the REAL template host once (player.js ensureHost) and reparents it
  // into the slot on a select / into the dock (load / dock / expand), like the real one.
  const ps = { state: 'closed', host: null, media: null, meta: null, playing: { paused: true, ended: false, readyState: 4, currentTime: 0 } };
  function ensureHost() {
    if (ps.host) return ps.host;
    ps.host = D.getElementById('player-host-template').content.cloneNode(true).querySelector('#player-wrapper');
    const m = ps.host.querySelector('#media-player');
    for (const k of ['paused', 'ended', 'readyState']) Object.defineProperty(m, k, { get: () => ps.playing[k], configurable: true });
    Object.defineProperty(m, 'currentTime', { get: () => ps.playing.currentTime, set: (v) => { ps.playing.currentTime = v; }, configurable: true });
    ps.media = m;
    return ps.host;
  }
  const player = {
    currentId: null,
    getState: () => ps.state,
    getCurrentMeta: () => ps.meta,
    setTrackNav() {},
    isLoopEnabled: () => false,
    expand: (slot) => { ensureHost(); slot.appendChild(ps.host); ps.state = 'full'; },
    dock: () => { D.getElementById('player-dock').appendChild(ps.host); ps.state = 'docked'; },
    load: (id, data, o) => {
      ensureHost();
      if (o && o.slot) { o.slot.appendChild(ps.host); ps.state = 'full'; } else { D.getElementById('player-dock').appendChild(ps.host); ps.state = 'docked'; }
      player.currentId = id;
      ps.meta = { isMusic: true, id, title: data.title, artist: data.channelName, album: data.album, albumKey: data.albumKey };
      return true;
    },
    ensureTheaterButton: () => null,
  };
  W.FileTube = {
    registerView: (name, m) => { if (name === 'music') mod = m; },
    encodeListContext: (c) => JSON.stringify(c), decodeListContext: (s) => { try { return JSON.parse(s); } catch (_) { return null; } },
    shimmerArt: () => {}, player,
  };
  W.addToQueue = () => {};
  W.FileTubeAmbient = AMBIENT;
  W.FileTubeMusicSkins = SKINS;
  let mod = null;
  if (opts.prep) opts.prep({ W, D, ps, player, ensureHost });
  delete require.cache[musicPath];
  require(musicPath);
  const root = D.getElementById('view-root');
  mod.init(root);
  await settleN();
  const glow = () => D.getElementById('music-ambient-glow');
  const c = {
    W, D, ps, player, mod, root, loads, observers, bound, deferred, mq,
    glow,
    check: () => D.getElementById('watch-ambient-check'),
    row: () => D.getElementById('ambient-toggle-row'),
    rows: () => [...D.querySelectorAll('#music-content .music-song-row')],
    async tapRow(id) {
      const row = c.rows().find((r) => r.getAttribute('data-id') === id);
      assert.ok(row, 'precondition: a rendered row for ' + id + ' (have ' + c.rows().map((r) => r.getAttribute('data-id')).join(',') + ')');
      row.dispatchEvent(new W.MouseEvent('click', { bubbles: true }));
      await settleN();
    },
    async play() { ps.playing.paused = false; ps.media.dispatchEvent(new W.Event('playing')); await settleN(); },
    async pause() { ps.playing.paused = true; ps.media.dispatchEvent(new W.Event('pause')); await settleN(); },
    lit: () => glow().classList.contains('is-on') && !glow().hidden && D.documentElement.hasAttribute('data-ambient-on'),
    anyLit: () => !glow().hidden || glow().classList.contains('is-on') || D.documentElement.hasAttribute('data-ambient-on'),
    painted: () => [...glow().querySelectorAll('.ambient-glow-layer')].some((l) => /^url\("data:image\/png/.test(l.style.getPropertyValue('background-image'))),
    async toggle(on) { const k = c.check(); k.checked = on; k.dispatchEvent(new W.Event('change')); await settleN(); },
    cleanup() { try { if (mod) mod.destroy(); } catch (_) { /* ignore */ } W.EventTarget.prototype.addEventListener = origAdd; delete require.cache[musicPath]; for (const k of savedKeys) global[k] = saved[k]; },
  };
  return c;
}
async function withMusic(opts, run) { const c = await boot(opts); try { await run(c); } finally { c.cleanup(); } }

// ---- the paint axis (the real ?play= shape, the real row tap) -----------------------

test('v1.317 AC1: the REAL ?play=<chapter> continue path - dark + ambient ON + playing on desktop paints the glow from the FILE\'s art (the base id, never `::c`), via the real cog row', async () => {
  await withMusic({ pref: '1', search: '?play=' + encodeURIComponent('yt1abcDEF::c1') }, async (c) => {
    await until(() => c.player.currentId === 'yt1abcDEF::c1');
    assert.strictEqual(c.player.currentId, 'yt1abcDEF::c1', 'the continue path loaded the chapter (the real ?play= arm)');
    assert.strictEqual(c.ps.state, 'full', 'expanded into THIS view\'s slot');
    assert.ok(c.root.querySelector('#music-player-stage #player-slot #player-wrapper'), 'the host sits inside the music player stage');
    const row = c.row();
    assert.ok(row && row.parentNode && row.parentNode.id === 'settings-menu', 'the Ambient row was written into the REAL template host\'s cog menu');
    assert.strictEqual(c.check().checked, true, 'it reflects the shared ft-ambient pref');
    assert.strictEqual(c.anyLit(), false, 'loaded but not yet playing: nothing lit');
    await c.play();
    assert.ok(await until(() => c.painted()), 'a layer is painted');
    assert.ok(c.lit(), 'glow on, unhidden, root sidebar signal set');
    assert.deepStrictEqual(c.loads, ['/thumbnail/yt1abcDEF'], 'the ONE image sampled is the file\'s art - no `::c` URL, no media element');
    for (const u of c.loads) assert.doesNotMatch(u, /::c|%3A%3Ac/, 'never a chapter id in a URL');
  });
});

test('v1.317 AC1b: a real row tap on a NATIVE track paints from /albumart/<id>, and the track ADVANCE repaints to the next cover on the engine clock (the display advances without a reload)', async () => {
  await withMusic({ pref: '1' }, async (c) => {
    await c.tapRow('n1');
    assert.strictEqual(c.player.currentId, 'n1');
    await c.play();
    assert.ok(await until(() => c.painted()), 'painted');
    assert.deepStrictEqual(c.loads, ['/albumart/n1']);
    const firstPaint = c.glow().querySelector('.ambient-glow-layer.is-front').style.getPropertyValue('background-image');
    // the advance: the next song through the real row tap in the album drill (music.js
    // loadTrack -> the per-advance seam); the engine re-reads the art on its own clock.
    await c.tapRow('n2');
    assert.strictEqual(c.player.currentId, 'n2');
    await c.play();
    assert.ok(await until(() => c.loads.includes('/albumart/n2'), 6000), 'the engine requested the next track\'s cover (loads: ' + c.loads.join(',') + ')');
    assert.ok(await until(() => {
      const f = c.glow().querySelector('.ambient-glow-layer.is-front');
      return f && f.style.getPropertyValue('background-image') !== firstPaint;
    }, 8000), 'and cross-faded to a NEW bitmap after the fade gap');
    assert.ok(c.lit(), 'still lit across the advance');
  });
});

test('v1.317 AC1c: a CHAPTER change inside one file keeps the same cover - the base-id art is not re-requested', async () => {
  await withMusic({ pref: '1' }, async (c) => {
    await c.tapRow('yt1abcDEF::c0');
    await c.play();
    assert.ok(await until(() => c.painted()), 'painted');
    assert.deepStrictEqual(c.loads, ['/thumbnail/yt1abcDEF']);
    await c.tapRow('yt1abcDEF::c2'); // the album drill lists the file's chapters
    assert.strictEqual(c.player.currentId, 'yt1abcDEF::c2');
    await c.play();
    await new Promise((r) => setTimeout(r, 1300)); // one engine clock
    assert.deepStrictEqual(c.loads, ['/thumbnail/yt1abcDEF'], 'the chapter change re-requested nothing (one file, one cover)');
    assert.ok(c.lit());
  });
});

// ---- every OFF axis, and the CLEAR axis on a populated glow ------------------------

test('v1.317 AC2: ambient OFF paints nothing; turning it ON from the music cog row lights it; turning it OFF clears the POPULATED glow and writes the shared key', async () => {
  await withMusic({ pref: '0' }, async (c) => {
    await c.tapRow('n1');
    await c.play();
    assert.strictEqual(c.anyLit(), false, 'OFF: nothing lit');
    assert.deepStrictEqual(c.loads, [], 'OFF: nothing even requested');
    await c.toggle(true);
    assert.strictEqual(c.W.localStorage.getItem('ft-ambient'), '1', 'the SHARED watch key');
    assert.ok(await until(() => c.painted() && c.lit()), 'ON from the music side lights it');
    await c.toggle(false);
    assert.strictEqual(c.anyLit(), false, 'the populated glow is cleared: is-on off, hidden, root signal gone');
    assert.strictEqual(c.W.localStorage.getItem('ft-ambient'), '0');
  });
});

test('v1.317 AC2b: LIGHT mode paints nothing and hides the row; a flip to dark lights it; a flip back to light clears it', async () => {
  await withMusic({ pref: '1', mode: 'light' }, async (c) => {
    await c.tapRow('n1');
    await c.play();
    assert.strictEqual(c.anyLit(), false, 'light: nothing lit');
    assert.strictEqual(c.row().hidden, true, 'light: the row hides');
    c.D.documentElement.setAttribute('data-mode', 'dark');
    assert.ok(await until(() => c.lit() && c.painted()), 'dark: the theme observer lit it');
    assert.strictEqual(c.row().hidden, false);
    c.D.documentElement.setAttribute('data-mode', 'light');
    assert.ok(await until(() => !c.anyLit()), 'back to light: cleared');
  });
});

test('v1.317 AC2c: PAUSE clears a populated glow; play re-lights it', async () => {
  await withMusic({ pref: '1' }, async (c) => {
    await c.tapRow('n1');
    await c.play();
    assert.ok(await until(() => c.lit()));
    await c.pause();
    assert.strictEqual(c.anyLit(), false, 'paused: cleared');
    await c.play();
    assert.ok(await until(() => c.lit()), 'playing again: lit');
  });
});

test('v1.317 AC3: DESKTOP ONLY - on the phone breakpoint (the real music-skins isMobileViewport) nothing lights even with every other axis on', async () => {
  await withMusic({ pref: '1', mobile: true }, async (c) => {
    await c.tapRow('n1');
    await c.play();
    await new Promise((r) => setTimeout(r, 200));
    assert.strictEqual(c.anyLit(), false, 'mobile music ambient is out of scope: nothing lit');
    assert.deepStrictEqual(c.loads, [], 'and nothing requested');
  });
});

test('v1.317 AC4: DOCK clears a populated glow (no media event fires - the slot observer catches the move); EXPAND re-lights it', async () => {
  await withMusic({ pref: '1' }, async (c) => {
    await c.tapRow('n1');
    await c.play();
    assert.ok(await until(() => c.lit()));
    c.player.dock();
    assert.ok(await until(() => !c.anyLit()), 'docked: nothing to glow around - cleared');
    c.player.expand(c.root.querySelector('#player-slot'));
    assert.ok(await until(() => c.lit()), 'expanded again: lit');
  });
});

test('v1.317 AC5: a NON-music item expanded into the music slot (a podcast via ?nowplaying=1) never lights - the view\'s current-MUSIC-track guard', async () => {
  await withMusic({
    pref: '1', search: '?nowplaying=1',
    prep: ({ D, ps, player, ensureHost }) => {
      ensureHost();
      D.getElementById('player-dock').appendChild(ps.host);
      ps.state = 'docked';
      player.currentId = 'pod-ep-1';
      ps.meta = { isMusic: false, resumeMode: 'podcast', id: 'pod-ep-1', title: 'Episode' };
    },
  }, async (c) => {
    assert.strictEqual(c.ps.state, 'full', 'precondition: the live podcast was expanded into the music slot');
    await c.play();
    await new Promise((r) => setTimeout(r, 200));
    assert.strictEqual(c.anyLit(), false, 'not a music track: nothing lit');
    assert.deepStrictEqual(c.loads, [], 'no /albumart/<episode> request');
  });
});

test('v1.317 AC6: a cross-origin art URL is never sampled (a tainted canvas would hard-fail the engine) - nothing lights', async () => {
  const evil = Object.assign({}, CHAPTER_TRACKS[0], { id: 'x1', source: 'library', artUrl: 'https://evil.example/cover.jpg', albumKey: 'x-album' });
  delete evil.chapterStartSec;
  await withMusic({ pref: '1', tracks: [evil] }, async (c) => {
    await c.tapRow('x1');
    await c.play();
    await new Promise((r) => setTimeout(r, 200));
    assert.strictEqual(c.anyLit(), false);
    assert.deepStrictEqual(c.loads, []);
  });
});

// ---- teardown ------------------------------------------------------------------------

test('v1.317 AC7: soft-nav AWAY (destroy) clears a lit glow, aborts every signal the ambient wiring bound on, disconnects its observers, and the dead listeners never act again', async () => {
  await withMusic({ pref: '1' }, async (c) => {
    await c.tapRow('n1');
    await c.play();
    assert.ok(await until(() => c.lit()));
    const mine = c.bound.filter((b) => b.target === c.ps.media || (b.target === c.check() && b.type === 'change') || (b.target === c.D && b.type === 'visibilitychange'));
    assert.ok(mine.some((b) => b.target === c.ps.media && b.type === 'playing'), 'precondition: the media binding is recorded');
    // the ambient observers: the theme one on <html> (data-mode/data-theme) and the slot one
    const slot = c.root.querySelector('#player-slot');
    const themeObs = c.observers.filter((o) => o.targets.some((t) => t.target === c.D.documentElement && t.o && t.o.attributeFilter && t.o.attributeFilter.includes('data-mode')));
    const slotObs = c.observers.filter((o) => o.targets.some((t) => t.target === slot && t.o && t.o.childList));
    assert.strictEqual(themeObs.length, 1, 'one theme observer');
    assert.strictEqual(slotObs.length, 1, 'one slot observer');
    c.mod.destroy();
    assert.strictEqual(c.anyLit(), false, 'destroy cleared the glow AND the root sidebar signal (the next view starts clean)');
    for (const b of mine) assert.strictEqual(b.signal.aborted, true, b.type + ' listener: its signal is aborted');
    assert.strictEqual(themeObs[0].disconnected, true, 'the theme observer is disconnected');
    assert.strictEqual(slotObs[0].disconnected, true, 'the slot observer is disconnected');
    // the dead wiring never acts: a play event, a toggle, a theme flip
    await c.play();
    c.D.documentElement.setAttribute('data-mode', 'light'); c.D.documentElement.setAttribute('data-mode', 'dark');
    await settleN();
    assert.strictEqual(c.anyLit(), false, 'nothing re-lit after the view died');
    const before = c.W.localStorage.getItem('ft-ambient');
    await c.toggle(false);
    assert.strictEqual(c.W.localStorage.getItem('ft-ambient'), before, 'the dead view\'s toggle listener is gone (the next view binds its own)');
  });
});

test('v1.317 AC8: a LATE seam of a dead view never lights the next page - (a) the host was never built (cold ?play= whose fetch lands after the soft-nav)', async () => {
  await withMusic({ pref: '1', deferRecent: true, search: '?play=n1' }, async (c) => {
    assert.ok(c.deferred.length >= 1, 'precondition: the continue fetch is in flight (plus the Jump-back strip\'s)');
    c.mod.destroy();
    c.ps.playing.paused = false; // the late load will find media playing
    c.deferred.splice(0).forEach((fn) => fn());
    await settleN(20);
    assert.strictEqual(c.player.currentId, 'n1', 'the dead closure DID load the track (the seam is real)');
    await c.play();
    await new Promise((r) => setTimeout(r, 200));
    assert.strictEqual(c.anyLit(), false, 'but no ambient: a host is never built for an aborted view');
    assert.deepStrictEqual(c.loads, []);
  });
});

test('v1.317 AC8: a LATE seam of a dead view never lights the next page - (b) the host WAS built (re-init with a playing host), then torn down before the fetch lands', async () => {
  await withMusic({ pref: '1' }, async (c) => {
    await c.tapRow('n1'); // the host now exists
    c.mod.destroy();
    // a nav BACK into music with a continue link whose fetch is slow
    c.W.history.replaceState(null, '', '/music?play=n2');
    const deferred = [];
    const realFetch = global.fetch;
    global.fetch = c.W.fetch = (url, init) => (String(url).indexOf('filter=recent-listening') !== -1
      ? new Promise((resolve) => { deferred.push(() => resolve({ ok: true, status: 200, json: async () => ({ items: NATIVE }) })); })
      : realFetch(url, init));
    c.mod.init(c.root);
    await settleN();
    assert.ok(c.check(), 'precondition: the re-init built its host against the existing player host');
    c.mod.destroy();
    c.ps.playing.paused = false;
    deferred.splice(0).forEach((fn) => fn());
    await settleN(20);
    assert.strictEqual(c.player.currentId, 'n2', 'the dead closure loaded n2 (the seam is real)');
    await c.play();
    await new Promise((r) => setTimeout(r, 200));
    assert.strictEqual(c.anyLit(), false, 'the torn host ignores the late evaluate');
    assert.deepStrictEqual(c.loads, []);
  });
});

// ---- the row shared with the watch view -------------------------------------------------

// The REAL watch.js ensureCogControlsInjected, lifted out of its view closure and run
// against this document (its only free names are document + window).
function watchCogInjector(W) {
  const start = WATCH_JS.indexOf('    function ensureCogControlsInjected() {');
  const end = WATCH_JS.indexOf('\n    }\n', start);
  assert.ok(start > 0 && end > start, 'ensureCogControlsInjected found in watch.js');
  const body = WATCH_JS.slice(start, end + 6);
  return new Function('document', 'window', body + '\nreturn ensureCogControlsInjected;')(W.document, W);
}

test('v1.317 AC9: ONE Ambient row across the two views - a cold /music writes it, the watch injector then adds Autoplay + Loop BEFORE it (order Autoplay, Loop, Ambient), and nothing is duplicated either way round', async () => {
  await withMusic({ pref: '1' }, async (c) => {
    await c.tapRow('n1'); // music mounts first: the Ambient row is written by music
    const check = c.check();
    assert.ok(check);
    const W = c.W;
    W.FileTube.player.ensureTheaterButton = () => null;
    watchCogInjector(W)();
    watchCogInjector(W)(); // a second watch mount adds nothing
    const labels = [...c.D.querySelectorAll('#settings-menu .settings-menu-toggle')].map((l) => l.getAttribute('for'));
    assert.deepStrictEqual(labels, ['watch-autoplay-check', 'watch-loop-check', 'watch-ambient-check'], 'the watch order, whichever view came first');
    assert.strictEqual(c.check(), check, 'the SAME checkbox (the music binding still owns it)');
    for (const id of ['watch-autoplay-check', 'watch-loop-check', 'watch-ambient-check']) assert.strictEqual(c.D.querySelectorAll('#' + id).length, 1, id + ' exactly once');
  });
  // the other way round: watch first (a fresh host), then music reuses its row
  await withMusic({ pref: '1', prep: ({ W, D, ps, ensureHost }) => {
    ensureHost(); D.getElementById('player-dock').appendChild(ps.host); ps.state = 'docked';
    W.FileTube.player.ensureTheaterButton = () => null;
    watchCogInjector(W)();
  } }, async (c) => {
    const labels = [...c.D.querySelectorAll('#settings-menu .settings-menu-toggle')].map((l) => l.getAttribute('for'));
    assert.deepStrictEqual(labels, ['watch-autoplay-check', 'watch-loop-check', 'watch-ambient-check']);
    await c.tapRow('n1');
    await c.play();
    assert.ok(await until(() => c.lit()), 'music drives the row the watch view wrote');
    assert.strictEqual(c.D.querySelectorAll('#watch-ambient-check').length, 1);
  });
});

// ---- CSS the jsdom realm cannot evaluate (media queries / the cascade): locked here,
// MEASURED in headless Chromium (plan: the probe numbers) ------------------------------
const STYLE = fs.readFileSync(path.join(REPO, 'public/css/style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
function mediaBlockList(query) {
  const out = [];
  const re = new RegExp('@media ' + query.replace(/[()]/g, '\\$&') + '\\s*\\{', 'g');
  let m;
  while ((m = re.exec(STYLE))) {
    let depth = 1, i = m.index + m[0].length;
    for (; i < STYLE.length && depth > 0; i++) { if (STYLE[i] === '{') depth++; else if (STYLE[i] === '}') depth--; }
    out.push(STYLE.slice(m.index + m[0].length, i - 1));
  }
  return out;
}
const mediaBlocks = (query) => mediaBlockList(query).join('\n');

test('v1.317 CSS: the cog Ambient row shows only where it is WIRED - watch, and desktop music - never visible-but-inert on another view or the phone music view', () => {
  assert.match(STYLE, /body:not\(\[data-view="watch"\]\):not\(\[data-view="music"\]\) #ambient-toggle-row \{ display: none; \}/, 'hidden on every view that does not wire it');
  assert.match(mediaBlocks('(max-width: 768px)'), /body\[data-view="music"\] #ambient-toggle-row \{ display: none; \}/, 'hidden in the phone music view (mobile music ambient is out of scope)');
  assert.doesNotMatch(mediaBlocks('(max-width: 768px)'), /body\[data-view="watch"\] #ambient-toggle-row/, 'the phone WATCH view keeps its row (watch ambient runs on mobile)');
});

test('v1.317 CSS: the music player stage owns its stacking context on DESKTOP only, and in theatre the player\'s bottom margin moves OUT to the stage (the glow box = the player box)', () => {
  const desk = mediaBlocks('(min-width: 769px)');
  assert.match(desk, /\.music-player-stage \{\s*position: relative;\s*z-index: 0;/, 'desktop: the stage scopes the glow');
  let outside = STYLE;
  for (const q of ['(min-width: 769px)', '(max-width: 768px)', '(min-width: 1024px)', '(max-width: 1023px)', '(max-width: 1024px)']) for (const b of mediaBlockList(q)) outside = outside.split(b).join('');
  // (the fullscreen / audio-expand DROP to z-index:auto is unscoped on purpose - it removes a context)
  const unscoped = [...outside.matchAll(/([^{}]*(?:music-player-stage)[^{}]*)\{([^}]*)\}/g)].filter((m) => !/ft-css-fullscreen|ft-audio-expanded/.test(m[1]));
  for (const m of unscoped) assert.doesNotMatch(m[2], /position|z-index/, m[1].trim() + ': no UNSCOPED stage context (the phone skin\'s fixed covers must never be trapped)');
  assert.ok([...outside.matchAll(/body\.ft-audio-expanded \.music-player-stage[^{]*\{\s*z-index: auto;/g)].length === 1, 'the drop itself is present');
  const theatre = mediaBlocks('(min-width: 1024px)');
  assert.match(theatre, /\.music-stage\.is-theater > \.music-player-stage \{ flex: 2 1 0; min-width: 0; margin-bottom: var\(--space-8\); \}/, 'the stage is the flex item and carries the 16px below the row');
  assert.match(theatre, /\.music-stage\.is-theater > \.music-player-stage #player-wrapper \{ margin-bottom: 0; \}/, 'the player itself carries none there (MEASURED: else the stage is 16px taller than the player)');
  assert.match(theatre, /\.music-stage\.is-theater #player-slot \{ flex: 2 1 0; min-width: 0; \}/, 'podcasts\' bare-slot theatre rule is untouched');
});
