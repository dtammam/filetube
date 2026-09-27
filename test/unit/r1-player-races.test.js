'use strict';

// [UNIT] v1.339 R1 (plan 2026-09-26-fouc-toctou-audit, T-C2 + T-C3): two wrong-item races in the
// REAL public/js/player.js, driven inside a jsdom realm built from the real music.html shell (the
// player-adopt-flavor harness shape). Each race holds its await open with a manually resolved
// promise (LESSONS 2: a race test's precondition is event-loop order, not timing).
//
// T-C2: the music 'ended' advance consults GET /api/queue; a manual Next pressed while that fetch
//   is in flight loads the next track (and re-registers nav around it), then the queue answer
//   fell through to fallbackToTrackNav() with no `currentId === endedId` re-check - skipping 2.
// T-C3: the outgoing item's final position was saved only by the 'pause' listener, but
//   teardownMediaState()/close() pause and then empty the element (removeAttribute('src') +
//   load()). The pause EVENT is a queued task: by the time it runs, load() has reset currentTime
//   to 0 and currentId names the next item (or null), so the save was dropped. The media stubs
//   below model exactly that spec order: pause() flips `paused` and QUEUES 'pause'; load()
//   resets currentTime to 0 synchronously.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const REPO = path.join(__dirname, '..', '..');

function realPlayerRealm() {
  const vc = new VirtualConsole();
  const dom = new JSDOM(fs.readFileSync(path.join(REPO, 'public', 'music.html'), 'utf8'), {
    url: 'http://localhost/music', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc,
  });
  const w = dom.window;
  w.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  const proto = w.HTMLMediaElement.prototype;
  Object.defineProperty(proto, 'currentTime', { configurable: true, get() { return this._t || 0; }, set(v) { this._t = v; } });
  Object.defineProperty(proto, 'paused', { configurable: true, get() { return this._paused !== false; } });
  proto.play = function () { this._paused = false; return Promise.resolve(); };
  proto.pause = function () {
    if (this._paused === false) {
      this._paused = true;
      const el = this;
      setTimeout(() => el.dispatchEvent(new w.Event('pause')), 0); // the spec's queued task
    }
  };
  proto.load = function () { this._paused = true; this._t = 0; }; // the load algorithm: position -> 0, no pause event
  w.resolveAudioArtUrl = () => '/thumbnail/a1';
  w.formatDuration = () => '';
  w.navigator.mediaSession = { metadata: null, playbackState: 'none', setActionHandler() {}, setPositionState() {} };
  w.MediaMetadata = function (init) { Object.assign(this, init); };
  const gets = [];
  const posts = [];
  const held = []; // pending /api/queue answers, released by the test
  w.fetch = (u, init) => {
    const url = String(u);
    const method = (init && init.method) || 'GET';
    if (method === 'POST') posts.push({ url, body: JSON.parse(init.body) });
    else gets.push(url);
    const reply = (body) => ({ ok: true, json: async () => body });
    if (method === 'GET' && url.indexOf('/api/queue') === 0) {
      return new Promise((resolve) => { held.push(() => resolve(reply({ entries: [], pointerUid: null }))); });
    }
    return Promise.resolve(reply({}));
  };
  w.eval(fs.readFileSync(path.join(REPO, 'public', 'js', 'player.js'), 'utf8'));
  return {
    w, player: w.FileTube.player, slot: w.document.getElementById('player-slot'), gets, posts, held,
    media: () => w.document.getElementById('media-player'),
    close: () => w.close(),
  };
}
const settle = () => new Promise((r) => setTimeout(r, 20));
const trackData = (title) => ({
  type: 'audio', title, channelName: 'Band', folderName: 'Band', album: 'Record', albumKey: 'Band␟Record',
  duration: 200, artUrl: '/thumbnail/x', streamSrc: '/video/x', progressEndpoint: '/api/progress',
  resumeMode: 'music', autoAdvanceViaTrackNav: true, browseCtx: '{"src":"music"}', readerHref: '/music?nowplaying=1',
});
const savesFor = (r, id) => r.posts.filter((p) => p.url === '/api/progress' && p.body.id === id);

// ---- T-C2 -----------------------------------------------------------------------------------

test('T-C2: a manual Next during the ended-advance queue fetch is NOT followed by a second advance (no skip-2)', async () => {
  const r = realPlayerRealm();
  try {
    r.player.load('a1', trackData('One'), { slot: r.slot });
    let a1Nexts = 0;
    r.player.setTrackNav({ onNext: () => { a1Nexts += 1; } });
    r.media()._paused = true; // a natural end leaves the element paused (the spec fires pause before ended)
    r.media().dispatchEvent(new r.w.Event('ended'));
    assert.strictEqual(r.held.length, 1, 'precondition: the ended advance is waiting on GET /api/queue');
    // The competing action, inside the await: the user presses Next -> music plays a2 and re-arms nav around it.
    r.player.load('a2', trackData('Two'), { slot: r.slot });
    let a2Nexts = 0;
    r.player.setTrackNav({ onNext: () => { a2Nexts += 1; } });
    r.held.shift()(); // release the queue answer (empty queue -> the trackNav fallback)
    await settle();
    assert.strictEqual(r.player.currentId, 'a2', 'precondition: a2 is the playing track');
    assert.strictEqual(a2Nexts, 0, 'the stale ended advance must not step past a2 (that is the skip-2)');
    assert.strictEqual(a1Nexts, 0, 'and the torn-down a1 nav is never called either');
  } finally { r.close(); }
});

test('T-C2 control: with nothing in between, the ended advance still steps through the track nav', async () => {
  const r = realPlayerRealm();
  try {
    r.player.load('a1', trackData('One'), { slot: r.slot });
    let nexts = 0;
    r.player.setTrackNav({ onNext: () => { nexts += 1; } });
    r.media()._paused = true;
    r.media().dispatchEvent(new r.w.Event('ended'));
    assert.strictEqual(r.held.length, 1, 'precondition: the queue consult is in flight');
    r.held.shift()();
    await settle();
    assert.strictEqual(nexts, 1, 'the natural end advanced exactly once');
  } finally { r.close(); }
});

// ---- T-C3 -----------------------------------------------------------------------------------

test('T-C3: switching tracks mid-play saves the OUTGOING item\'s final position (was dropped: the pause save ran after load() zeroed it)', async () => {
  const r = realPlayerRealm();
  try {
    r.player.load('a1', trackData('One'), { slot: r.slot });
    await settle();
    const mp = r.media();
    mp._paused = false; mp._t = 42.5; // a1 is playing at 42.5s, 2.5s past its last 4s interval save
    r.posts.length = 0;
    r.player.load('a2', trackData('Two'), { slot: r.slot });
    await settle(); // let the queued pause event run, as it would in a browser
    const a1 = savesFor(r, 'a1');
    assert.strictEqual(a1.length, 1, 'exactly one final save for a1 (got ' + JSON.stringify(r.posts) + ')');
    assert.strictEqual(a1[0].body.timestamp, 42.5, 'at its real final position');
    assert.strictEqual(savesFor(r, 'a2').filter((p) => p.body.timestamp > 0).length, 0, 'a1\'s position is never written under a2');
  } finally { r.close(); }
});

test('T-C3: close() mid-play saves the closing item\'s final position', async () => {
  const r = realPlayerRealm();
  try {
    r.player.load('a1', trackData('One'), { slot: r.slot });
    await settle();
    const mp = r.media();
    mp._paused = false; mp._t = 77;
    r.posts.length = 0;
    r.player.close();
    await settle();
    const a1 = savesFor(r, 'a1');
    assert.strictEqual(a1.length, 1, 'one final save on close (got ' + JSON.stringify(r.posts) + ')');
    assert.strictEqual(a1[0].body.timestamp, 77);
  } finally { r.close(); }
});

test('T-C3 control: an item the user already PAUSED is saved once by its pause - the switch does not save it again', async () => {
  const r = realPlayerRealm();
  try {
    r.player.load('a1', trackData('One'), { slot: r.slot });
    await settle();
    const mp = r.media();
    mp._paused = false; mp._t = 30;
    r.posts.length = 0;
    mp.pause(); // the user's pause
    await settle();
    assert.strictEqual(savesFor(r, 'a1').length, 1, 'precondition: the pause listener saved it');
    r.player.load('a2', trackData('Two'), { slot: r.slot });
    await settle();
    assert.strictEqual(savesFor(r, 'a1').length, 1, 'no second save at the switch');
  } finally { r.close(); }
});

test('T-C3 control: a playing item still at 0 is not saved at the switch (never overwrite a resume point with 0)', async () => {
  const r = realPlayerRealm();
  try {
    r.player.load('a1', trackData('One'), { slot: r.slot });
    await settle();
    const mp = r.media();
    mp._paused = false; mp._t = 0;
    r.posts.length = 0;
    r.player.load('a2', trackData('Two'), { slot: r.slot });
    await settle();
    assert.deepStrictEqual(savesFor(r, 'a1'), [], 'no save for a1 at position 0');
  } finally { r.close(); }
});

test('T-C3 control: after a natural END (the C2 "ended saves 0" rule) the auto-advance does not re-save the end position', async () => {
  const r = realPlayerRealm();
  try {
    r.player.load('a1', trackData('One'), { slot: r.slot });
    await settle();
    const mp = r.media();
    mp._t = 200; mp._paused = true; // ended: paused at the end
    r.posts.length = 0;
    mp.dispatchEvent(new r.w.Event('ended'));
    r.player.load('a2', trackData('Two'), { slot: r.slot }); // the advance
    if (r.held.length) r.held.shift()();
    await settle();
    assert.deepStrictEqual(savesFor(r, 'a1').map((p) => p.body.timestamp), [0], 'only the ended cascade\'s 0 - never the end position after it');
  } finally { r.close(); }
});

test('T-C3 control: close() with nothing ever loaded does not throw', () => {
  const r = realPlayerRealm();
  try {
    assert.doesNotThrow(() => r.player.close());
    assert.deepStrictEqual(r.posts, []);
  } finally { r.close(); }
});
