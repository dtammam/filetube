'use strict';

// [UNIT] v1.376.0 (W5) - an INSTRUMENT, not a fix. Dean saw a thin line of the picture's colours under the
// phone player's control bar. The headless probe (Chromium and WebKit, DPR 3) did not reproduce a 1-2 px
// line: the bar's, the player's and the stage's bottoms coincide, and the only paint under the bar is the
// ambient glow's bloom (dark + Ambient on, while it runs). So the lifecycle log (Settings > Troubleshooting,
// exported with one button) gains a `player:strip` line: the device's own layout of that strip. This binds
// the pure formatter and its wiring in the REAL player.js (jsdom): FULL in a slot records on the mount and
// at each pause / playing; the mini player and the flag off record nothing.

const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { formatPlayerStripDetail } = require('../../public/js/player.js');

const PUB = path.join(__dirname, '..', '..', 'public');
const LOCK_SRC = fs.readFileSync(path.join(PUB, 'js', 'body-scroll-lock.js'), 'utf8');
const COMMON_SRC = fs.readFileSync(path.join(PUB, 'js', 'common.js'), 'utf8');
const PLAYER_SRC = fs.readFileSync(path.join(PUB, 'js', 'player.js'), 'utf8');
const WATCH = fs.readFileSync(path.join(PUB, 'watch.html'), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');

test('formatPlayerStripDetail: every field, the gap the bar leaves and the edges in device px (the probe\'s own 390 x DPR 3 reading)', () => {
  const line = formatPlayerStripDetail({
    dpr: 3, vw: 390, mode: 'dark', era: '2021', ctl: 'custom', amb: true,
    vid: { t: 72, b: 291.375 }, bar: { t: 290.796875, b: 370.796875 }, wrap: { t: 72, b: 370.796875 }, stage: { t: 72, b: 370.796875 },
    next: 386.796875, glow: 436.53125,
  });
  assert.strictEqual(line, 'dpr=3 vw=390 m=dark e=2021 ctl=custom amb=1 vid=72.000-291.375 bar=290.797-370.797 wrap=72.000-370.797 '
    + 'stage=72.000-370.797 next=386.797 gap=0.000 dev=1112.391/1112.391 glow=436.531');
});

test('formatPlayerStripDetail: a strip the bar does not cover shows as a non-zero gap; ambient off drops the glow field', () => {
  const line = formatPlayerStripDetail({ dpr: 3, vw: 390, mode: 'light', era: '2009', ctl: 'custom', amb: false,
    vid: { t: 72, b: 291 }, bar: { t: 291, b: 371 }, wrap: { t: 72, b: 371.5 }, stage: { t: 72, b: 371.5 }, next: 387.5, glow: 999 });
  assert.match(line, / gap=0\.500 /);
  assert.match(line, / dev=1113\.000\/1114\.500$/);
  assert.ok(!/glow=/.test(line), 'no glow field while ambient is off');
  assert.match(line, / amb=0 /);
});

test('formatPlayerStripDetail: missing readings print "-", never NaN, and it never throws', () => {
  const line = formatPlayerStripDetail({});
  assert.strictEqual(line, 'dpr=- vw=- m=- e=- ctl=- amb=0 vid=- bar=- wrap=- stage=- next=- gap=- dev=-/-');
  assert.doesNotThrow(() => formatPlayerStripDetail());
  assert.ok(!/NaN/.test(formatPlayerStripDetail({ dpr: 0, vw: NaN, bar: { t: 1, b: NaN }, wrap: { t: 1, b: 2 } })));
});

// ---- the wiring, in the real player ----

let dom = null;
afterEach(() => { if (dom) { dom.window.close(); dom = null; } });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function boot(flagOn) {
  dom = new JSDOM(WATCH, { url: 'http://localhost/watch.html?v=v1', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  Object.defineProperty(w.navigator, 'platform', { value: 'iPhone' });
  w.matchMedia = (q) => ({ media: q, matches: /coarse|hover: none|max-width/.test(q), addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  w.fetch = async () => ({ ok: true, status: 200, json: async () => ({ mobileCustomPlayer: true }), text: async () => '' });
  w.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
  w.HTMLMediaElement.prototype.pause = function () {};
  w.HTMLMediaElement.prototype.load = function () {};
  w.scrollTo = () => {};
  if (flagOn) w.localStorage.setItem('ft-debug-lifecycle', '1');
  w.document.body.setAttribute('data-view', 'watch');
  w.eval(COMMON_SRC.slice(COMMON_SRC.indexOf('function resolveAudioArtUrl('), COMMON_SRC.indexOf('\n}\n', COMMON_SRC.indexOf('function resolveAudioArtUrl(')) + 3));
  w.eval(LOCK_SRC);
  w.eval(PLAYER_SRC);
  const stage = w.document.createElement('div'); stage.className = 'watch-player-stage';
  const slot = w.document.createElement('div'); slot.id = 'player-slot'; stage.appendChild(slot);
  const title = w.document.createElement('h1'); title.className = 'watch-title';
  w.document.body.append(stage, title);
  const p = w.FileTube.player;
  assert.strictEqual(p.load('v1', { id: 'v1', title: 'T', type: 'video', ext: '.mp4' }, { slot }), true);
  await wait(60);
  const strips = () => JSON.parse(w.localStorage.getItem('ft-lifecycle-log') || '[]').filter((e) => e.type === 'player:strip').map((e) => e.detail);
  return { w, p, slot, strips, video: w.document.getElementById('media-player') };
}

test('flag on, FULL in the slot: a strip line on the mount and on each pause / playing, carrying the bar and the player', async () => {
  const h = await boot(true);
  const mount = h.strips();
  assert.strictEqual(mount.length, 1, 'one line for the mount: ' + JSON.stringify(mount));
  assert.match(mount[0], /^mount dpr=\S+ vw=\S+ m=\S+ e=\S+ ctl=(custom|native) amb=0 vid=\S+ bar=\S+ wrap=\S+ stage=\S+ next=\S+ gap=\S+ dev=\S+$/);
  h.video.dispatchEvent(new h.w.Event('pause'));
  h.video.dispatchEvent(new h.w.Event('playing'));
  const all = h.strips();
  assert.deepStrictEqual(all.map((d) => d.split(' ')[0]), ['mount', 'pause', 'playing']);
});

test('flag on, the mini player: a pause records no strip (the strip is the FULL player\'s)', async () => {
  const h = await boot(true);
  h.p.dock();
  const before = h.strips().length;
  h.video.dispatchEvent(new h.w.Event('pause'));
  assert.strictEqual(h.strips().length, before);
});

test('flag off: nothing is recorded, not even the mount', async () => {
  const h = await boot(false);
  h.video.dispatchEvent(new h.w.Event('pause'));
  h.video.dispatchEvent(new h.w.Event('playing'));
  assert.deepStrictEqual(h.strips(), []);
});
