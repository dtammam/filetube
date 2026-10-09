'use strict';

// [UNIT] v1.378.0 music stations W1 (plan docs/exec-plans/active/2026-10-09-music-stations.md, D1): the
// client's play / skip / finish reporting on the REAL music.js, driven through a <video> whose position
// a test sets and whose timeupdate / ended it fires. Each rule has an input where the rule and its
// absence DIVERGE (LESSONS 2): a seek adds no listening, a short song's half, a skip only before the
// threshold, a chapter's own segment, a same-id re-init that must not count twice.

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const musicPath = require.resolve('../../public/js/music.js');
require('../../public/js/common.js');

const NATIVE = [
  { id: 't0', title: 'Long Song', artist: 'Band', album: 'Rec', albumKey: 'Band␟Rec', durationSec: 200, source: 'native' },
  { id: 't1', title: 'Second Song', artist: 'Band', album: 'Rec', albumKey: 'Band␟Rec', durationSec: 200, source: 'native' },
  { id: 'short', title: 'Short Song', artist: 'Band', album: 'Rec', albumKey: 'Band␟Rec', durationSec: 40, source: 'native' },
  { id: 'nolen', title: 'No Length', artist: 'Band', album: 'Rec', albumKey: 'Band␟Rec', durationSec: 0, source: 'native' },
];
const AK = 'DJ␟Live Set';
const CHAPTERS = [
  { id: 'film::c0', title: 'Chapter One', artist: 'DJ', album: 'Live Set', albumKey: AK, durationSec: 120, source: 'library-chapter', chapterStartSec: 0, streamSrc: '/video/film' },
  { id: 'film::c1', title: 'Chapter Two', artist: 'DJ', album: 'Live Set', albumKey: AK, durationSec: 120, source: 'library-chapter', chapterStartSec: 120, streamSrc: '/video/film' },
  { id: 'film::c2', title: 'Chapter Three', artist: 'DJ', album: 'Live Set', albumKey: AK, durationSec: 120, source: 'library-chapter', chapterStartSec: 240, streamSrc: '/video/film' },
];

const VIEW_HTML = `<body><div id="view-root" data-view="music">
  <select id="music-sort-select"></select>
  <button id="music-view-toggle" hidden><i></i></button>
  <button id="music-autoplay-btn" type="button" aria-pressed="false">Autoplay</button>
  <div id="player-slot"></div>
  <video id="media-player"></video>
  <div id="music-nowplaying-panel" class="music-nowplaying-panel"></div>
  <button type="button" class="music-nowplaying" id="music-nowplaying" hidden></button>
  <section id="music-jumpback" hidden></section>
  <div class="music-tabs" id="music-tabs" role="tablist">
    <button type="button" class="music-tab active" data-tab="albums" role="tab">Albums</button>
    <button type="button" class="music-tab" data-tab="songs" role="tab">Songs</button>
  </div>
  <div id="music-crumb" hidden></div><div id="music-status" role="status" hidden></div>
  <div id="music-content"></div><div id="music-empty" hidden></div>
</div></body>`;

const settle = () => new Promise((r) => setImmediate(r));

// Boot the real view with `list` as the Recently played queue and `?play=<id>`; `posts` collects every
// POST /api/music/plays body as "<id> <kind>".
async function boot(list, playId, run) {
  const dom = new JSDOM(VIEW_HTML, { url: 'http://localhost/music?play=' + encodeURIComponent(playId) });
  const saved = { window: global.window, document: global.document, localStorage: global.localStorage, fetch: global.fetch, AbortController: global.AbortController };
  global.window = dom.window; global.document = dom.window.document;
  global.localStorage = dom.window.localStorage; global.AbortController = dom.window.AbortController;
  dom.window.localStorage.setItem('ft-music-autoplay', '0'); // no station appends here
  const playerState = { state: 'docked', currentId: null, meta: null };
  const metaById = (id) => { const t = list.find((x) => x.id === id); return t ? { isMusic: true, id: t.id, title: t.title, artist: t.artist, album: t.album, albumKey: t.albumKey } : null; };
  let registered = null;
  let lastNav = null;
  const posts = [];
  dom.window.FileTube = {
    registerView: (n, m) => { registered = m; },
    encodeListContext: (c) => JSON.stringify(c), decodeListContext: (s) => { try { return JSON.parse(s); } catch (_) { return null; } }, shimmerArt: () => {},
    player: {
      currentId: null, getState: () => playerState.state, expand: () => { playerState.state = 'full'; },
      getCurrentMeta: () => playerState.meta,
      load: (id, data) => { playerState.currentId = id; dom.window.FileTube.player.currentId = id; playerState.meta = Object.assign({}, metaById(id), { browseCtx: data && data.browseCtx }); },
      setTrackNav: (h) => { lastNav = h || null; },
    },
  };
  global.window.addToQueue = () => {};
  global.fetch = (url, init) => {
    const s = String(url);
    const method = (init && init.method) || 'GET';
    if (method === 'POST') {
      if (s.indexOf('/api/music/plays') !== -1) { const b = JSON.parse(init.body); posts.push(b.id + ' ' + b.kind); }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    }
    if (s.indexOf('filter=recent-listening') !== -1 || s.indexOf('album=') !== -1) return Promise.resolve({ ok: true, json: async () => ({ items: list }) }); // the album drill a ?play= lands in is the same list
    const idm = s.match(/\/api\/music\/([^?]+)$/);
    if (idm) { const t = list.find((x) => x.id === decodeURIComponent(idm[1])); return Promise.resolve({ ok: true, json: async () => (t || {}) }); }
    return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
  };
  const mp = dom.window.document.getElementById('media-player');
  let ct = 0; let dur = NaN;
  Object.defineProperty(mp, 'currentTime', { configurable: true, get: () => ct, set: (v) => { ct = Number(v); } });
  Object.defineProperty(mp, 'duration', { configurable: true, get: () => dur });
  const tick = (t) => { ct = t; mp.dispatchEvent(new dom.window.Event('timeupdate')); };
  // real playback: one tick a second from `from` to `to` inclusive
  const playThrough = (from, to) => { for (let t = from; t <= to; t += 1) tick(t); };
  const root = () => dom.window.document.getElementById('view-root');
  const ctx = { dom, mp, tick, playThrough, posts, setDuration: (d) => { dur = d; }, getNav: () => lastNav, playingId: () => playerState.currentId, view: () => registered,
    reinit: async () => { registered.destroy(); registered.init(root()); for (let i = 0; i < 10; i++) await settle(); } };
  try {
    delete require.cache[musicPath];
    require(musicPath);
    registered.init(root());
    for (let i = 0; i < 10; i++) await settle();
    await run(ctx);
    registered.destroy();
  } finally { delete require.cache[musicPath]; Object.assign(global, saved); }
}

test('D1 play: 30 s of real playback counts ONE play per load; a replay of the same load counts nothing more', async () => {
  await boot(NATIVE, 't0', async (c) => {
    assert.strictEqual(c.playingId(), 't0');
    c.playThrough(0, 29);
    assert.deepStrictEqual(c.posts, [], '29 s heard: not yet a play');
    c.tick(30);
    assert.deepStrictEqual(c.posts, ['t0 play'], 'the 30th second is the play');
    c.playThrough(31, 120);
    assert.deepStrictEqual(c.posts, ['t0 play'], 'one play per load, however long it runs');
  });
});

test('D1 play: a SEEK is not a play - one jump of 100 s adds nothing, only the steps after it count', async () => {
  await boot(NATIVE, 't0', async (c) => {
    c.tick(0); c.tick(100);
    c.playThrough(101, 128);
    assert.deepStrictEqual(c.posts, [], '28 real seconds after a 100 s jump: no play yet (a jump counts for nothing)');
    c.playThrough(129, 130);
    assert.deepStrictEqual(c.posts, ['t0 play']);
  });
});

test('D1 play: a short song plays at HALF its length (20 s of a 40 s song); a song with no known length uses the element duration, else 30 s', async () => {
  await boot(NATIVE, 'short', async (c) => {
    c.playThrough(0, 19);
    assert.deepStrictEqual(c.posts, []);
    c.tick(20);
    assert.deepStrictEqual(c.posts, ['short play'], 'half of 40 s');
  });
  await boot(NATIVE, 'nolen', async (c) => {
    c.setDuration(50); // the item carries no length; the element knows 50 s
    c.playThrough(0, 24);
    assert.deepStrictEqual(c.posts, []);
    c.tick(25);
    assert.deepStrictEqual(c.posts, ['nolen play'], 'half of the element\'s 50 s');
  });
});

test('D1 finish: the last 5 % of the song is a finish (once); `ended` finishes a song that never reached it; the advance after a finish is never a skip', async () => {
  await boot(NATIVE, 't0', async (c) => {
    c.playThrough(0, 189);
    assert.deepStrictEqual(c.posts, ['t0 play'], '189 of 200 s: not yet the last 5 %');
    c.tick(190);
    assert.deepStrictEqual(c.posts, ['t0 play', 't0 finish']);
    c.playThrough(191, 199);
    c.mp.dispatchEvent(new c.dom.window.Event('ended'));
    assert.deepStrictEqual(c.posts, ['t0 play', 't0 finish'], 'finished once');
    // the queue advances at the end: no skip for t0, the next song starts its own tally
    c.getNav().onNext();
    await settle();
    assert.strictEqual(c.playingId(), 't1');
    assert.deepStrictEqual(c.posts, ['t0 play', 't0 finish'], 'an advance after the end is never a skip');
    c.tick(0); c.playThrough(1, 30);
    assert.deepStrictEqual(c.posts, ['t0 play', 't0 finish', 't1 play']);
  });
  await boot(NATIVE, 't0', async (c) => {
    // a seek to the end then `ended`: no play (a seek is not a play), one finish (D1 as written)
    c.tick(0); c.tick(199);
    c.mp.dispatchEvent(new c.dom.window.Event('ended'));
    assert.deepStrictEqual(c.posts, ['t0 finish']);
  });
});

test('D1 skip: moving on BEFORE the play threshold is a skip; after it, nothing', async () => {
  await boot(NATIVE, 't0', async (c) => {
    c.playThrough(0, 10);
    c.getNav().onNext(); // Next (the lock screen, the Pocket wheel and the remote all land here)
    await settle();
    assert.strictEqual(c.playingId(), 't1');
    assert.deepStrictEqual(c.posts, ['t0 skip'], 'left at 10 s: a skip');
    c.tick(0); c.playThrough(1, 35);
    assert.deepStrictEqual(c.posts, ['t0 skip', 't1 play']);
    c.getNav().onPrev();
    await settle();
    assert.strictEqual(c.playingId(), 't0');
    assert.deepStrictEqual(c.posts, ['t0 skip', 't1 play'], 'moving on after the threshold is not a skip');
  });
});

test('D1 chapters: each chapter is its own track - the roll finishes the one left (its last 5 %) and the new one earns its own play; a seek past a chapter early is a skip of it', async () => {
  await boot(CHAPTERS, 'film::c0', async (c) => {
    c.setDuration(360);
    c.playThrough(0, 29);
    assert.deepStrictEqual(c.posts, []);
    c.tick(30);
    assert.deepStrictEqual(c.posts, ['film::c0 play']);
    c.playThrough(31, 113);
    assert.deepStrictEqual(c.posts, ['film::c0 play'], '113 of 120: not the last 5 % yet');
    c.tick(114);
    assert.deepStrictEqual(c.posts, ['film::c0 play', 'film::c0 finish']);
    c.playThrough(115, 121); // the file rolls into chapter two at 120 (no reload)
    await settle();
    assert.deepStrictEqual(c.posts, ['film::c0 play', 'film::c0 finish'], 'the roll itself posts nothing new');
    c.playThrough(122, 149); // the tally rolls on its own 120 tick (a quarter-second tolerance) and that tick is the segment's first step
    assert.deepStrictEqual(c.posts, ['film::c0 play', 'film::c0 finish'], 'chapter two: 29 s of its own segment heard, not yet');
    c.tick(150);
    assert.deepStrictEqual(c.posts, ['film::c0 play', 'film::c0 finish', 'film::c1 play'], 'chapter two: 30 s of ITS OWN segment is its play');
    // a seek from 150 straight into chapter three: chapter two was played, not finished - not a skip either
    c.tick(260);
    await settle();
    c.playThrough(261, 265);
    assert.deepStrictEqual(c.posts, ['film::c0 play', 'film::c0 finish', 'film::c1 play'], 'chapter two: played, so leaving it early is no skip');
  });
  await boot(CHAPTERS, 'film::c0', async (c) => {
    c.setDuration(360);
    c.playThrough(0, 5);
    c.tick(130); // seeked past chapter one after 5 s
    await settle();
    assert.deepStrictEqual(c.posts, ['film::c0 skip'], 'chapter one left early by a seek: a skip');
  });
});

test('D1 once per load: a dock-return re-init (the same song still playing) keeps the tally - no second play, and the running seconds are not lost', async () => {
  await boot(NATIVE, 't0', async (c) => {
    c.playThrough(0, 20);
    await c.reinit(); // the view is torn down and re-created around the same playing track
    c.playThrough(21, 29);
    assert.deepStrictEqual(c.posts, [], '29 s across the re-init: not yet');
    c.tick(30);
    assert.deepStrictEqual(c.posts, ['t0 play'], 'the seconds before the re-init counted; one play');
    c.playThrough(31, 60);
    assert.deepStrictEqual(c.posts, ['t0 play']);
  });
});

test('D1 counted where the audio PLAYS: a phone driving a speaker never starts a tally (the only tally entries are a local load and a chapter roll; the controller\'s proxy element has no listeners; playAt leaves for the speaker before loadTrack)', () => {
  const fs = require('node:fs');
  const MUSIC = fs.readFileSync(musicPath, 'utf8');
  const lines = MUSIC.split('\n');
  const callers = lines.map((l, i) => [l, i]).filter(([l]) => /\bplayCountBegin\(/.test(l) && !/function playCountBegin/.test(l));
  assert.strictEqual(callers.length, 3, 'exactly three entry points: ' + callers.map(([l]) => l.trim()).join(' | '));
  const inFn = (lineNo, fnName) => { const start = lines.findIndex((l) => l.indexOf('function ' + fnName + '(') !== -1); return start >= 0 && lineNo > start && lineNo < start + 120; };
  assert.ok(callers.some(([, i]) => inFn(i, 'loadTrack')), 'one inside loadTrack');
  assert.ok(callers.some(([, i]) => inFn(i, 'reflectChapter')), 'one inside reflectChapter');
  assert.ok(callers.some(([, i]) => inFn(i, 'playCountTick')), 'one inside the tally\'s own tick (a chapter roll while the view is away - gate r1 C1)');
  // the speaker path: playAt hands the queue to the speaker before anything loads here (bound in
  // music-remote-controller-wiring.test.js too) and the controller's stand-in element fires nothing
  assert.match(MUSIC, /function playAt\(i, opts\) \{\s*if \(i < 0[^\n]*\n\s*if \(remoteOn\(\)\) \{ remotePlayAt\(i\); return; \}/);
  assert.match(MUSIC, /'media-player': \{[\s\S]{0,600}addEventListener: function \(\) \{\}, removeEventListener: function \(\) \{\},/);
  // and the tick / ended listeners are bound to the host element the view resolves (the proxy while remote)
  const bindAt = MUSIC.indexOf('function ensureChapterReflect() {');
  const bind = MUSIC.slice(bindAt, bindAt + 2500);
  assert.ok(bind.indexOf("var mp = hostCtl('media-player'); if (!mp) return;") > 0, 'the host element is resolved through hostCtl (the proxy while remote)');
  assert.ok(bind.indexOf('bindPlayCountTo(mp);') > 0, 'the tally is bound on it, once per element');
  // gate r1 C1 (qa + adversary): the tally's listeners carry NO view signal - they outlive the view
  const binder = MUSIC.slice(MUSIC.indexOf('function bindPlayCountTo(mp) {'), MUSIC.indexOf('function playCountChaptersOf('));
  assert.ok(binder.indexOf("mp.addEventListener('timeupdate', function () { playCountTick(Number(mp.currentTime), Number(mp.duration)); });") > 0, 'the tick, no signal');
  assert.ok(binder.indexOf("mp.addEventListener('ended', playCountEnded);") > 0, 'ended, no signal');
  assert.ok(!/signal/.test(binder), 'no signal anywhere in the binder');
});

// ---- gate r1 (qa C1 = adversary C1): the tally outlives the view --------------------------------------
test('gate r1 C1: a song that plays to its end while the Music view is AWAY (destroyed, the player docked) finishes and is never a skip; the next song the dock advances to earns its own play; a chaptered file keeps rolling its segments', async () => {
  await boot(NATIVE, 't0', async (c) => {
    c.playThrough(0, 10);
    const nav = c.getNav();
    // the user leaves for another page: the view is torn down, the player keeps playing in the dock
    c.view().destroy();
    c.playThrough(11, 199);
    c.mp.dispatchEvent(new c.dom.window.Event('ended'));
    assert.deepStrictEqual(c.posts, ['t0 play', 't0 finish'], 'the away song played and finished');
    nav.onNext(); // the dock's ended-advance through the surviving nav closures
    await settle();
    assert.strictEqual(c.playingId(), 't1');
    assert.deepStrictEqual(c.posts, ['t0 play', 't0 finish'], 'no skip for the song that finished');
    c.tick(0); c.playThrough(1, 199);
    c.mp.dispatchEvent(new c.dom.window.Event('ended'));
    assert.deepStrictEqual(c.posts, ['t0 play', 't0 finish', 't1 play', 't1 finish'], 'the next song, still away, counts too');
    c.view().init(c.dom.window.document.getElementById('view-root')); // so the harness's destroy() has a view
    await settle();
  });
  await boot(CHAPTERS, 'film::c0', async (c) => {
    c.setDuration(360);
    c.playThrough(0, 5);
    c.view().destroy();
    c.playThrough(6, 250); // rolls through chapter one's end (120) and chapter two's (240) while away
    assert.deepStrictEqual(c.posts, ['film::c0 play', 'film::c0 finish', 'film::c1 play', 'film::c1 finish'], 'each chapter is its own segment while the view is away');
    c.view().init(c.dom.window.document.getElementById('view-root'));
    await settle();
  });
});

test('gate r1 qa W2: iOS-sparse steps of up to 4 s count as playback (the LOOP / EXIT siblings\' step); a 5 s jump does not', async () => {
  await boot(NATIVE, 't0', async (c) => {
    for (let t = 0; t <= 28; t += 3.5) c.tick(t); // 3.5 s steps: 8 steps = 28 s heard
    assert.deepStrictEqual(c.posts, [], '28 s: not yet');
    c.tick(31.5);
    assert.deepStrictEqual(c.posts, ['t0 play'], 'sparse ticks are playback');
  });
  await boot(NATIVE, 't0', async (c) => {
    for (let t = 0; t <= 60; t += 5) c.tick(t); // 5 s jumps: never a step
    assert.deepStrictEqual(c.posts, []);
  });
});

test('gate r1 qa S8 / adversary S2: a pick replaced before a single step of playback is no skip; a listen video never starts a tally', async () => {
  await boot(NATIVE, 't0', async (c) => {
    c.getNav().onNext(); // t0 never played a step
    await settle();
    assert.deepStrictEqual(c.posts, [], 'never heard: no skip');
    c.tick(0); c.tick(1);
    c.getNav().onPrev();
    await settle();
    assert.deepStrictEqual(c.posts, ['t1 skip'], 'one real step then moved on: a skip');
  });
  const M = require('../../public/js/music.js');
  assert.strictEqual(typeof M.deriveNowPlayingLabel, 'function');
  const src = require('node:fs').readFileSync(musicPath, 'utf8');
  const begin = src.slice(src.indexOf('function playCountBegin(item, list) {'), src.indexOf('function playCountEnd() {'));
  assert.ok(begin.indexOf("|| item.listen) return;") > 0, 'a listen item returns before a tally is made');
});
