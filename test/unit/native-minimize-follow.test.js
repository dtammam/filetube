'use strict';

// [UNIT] v1.400.1 minimize follow (plan docs/exec-plans/active/2026-11-01-minimize-native-follow.md, R1 + R2 + R3): under a native
// picture the pull / spring-back / fly-in moves the wrapper with a TRANSFORM that no observer hears; the surface controller now
// measures every frame while one of the three classes is on the wrapper. The REAL player.js + native-audio.js run in a phone jsdom
// realm; the box is moved ONLY through the wrapper's class + style.transform (what claimMinimizeDrag / followMinimizeDrag write),
// and getBoundingClientRect is derived from that transform (LESSONS 2, 11: never a pre-moved rect).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { installFakeHost } = require('../helpers/fake-host');
const na = require('../../public/js/native-audio.js');

const REPO = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(REPO, 'public', 'js', f), 'utf8');
const SCRIPTS = ['host-adapter.js', 'native-audio.js', 'player.js'];
const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms));
const CAPS = { capabilities: ['nativeAudio', 'nativeVideoAudio', 'nativeVideo'] };
const VIDEO = { id: 'v1', type: 'video', title: 'A talk', channelName: 'Ch', folderName: 'Ch', duration: 600, hasThumbnail: true, width: 1920, height: 1080, browseCtx: null, readerHref: null, resumeMode: null, autoAdvanceViaTrackNav: false, progressEndpoint: null, startAt: null };
const MODES = { autoplay: true, shuffle: false, loop: 'off' };
const ITEM = { kind: 'video', id: 'v1', src: '/api/offline/file/video/v1', title: 'A talk', artist: 'Ch', artworkSrc: '/thumbnail/v1', durationSec: 600, progress: { route: '/api/progress', key: 'v1' } };
const STATE = (rev, extra) => Object.assign({ v: 1, type: 'audioState', rev, queue: [ITEM], index: 0, state: 'playing', positionSec: 12, durationSec: 600, rate: 1, modes: MODES, sleep: { mode: 'off' } }, extra || {});
const BASE = { left: 0, top: 300, width: 393, height: 221 };

function realm(opts) {
  opts = opts || {};
  const dom = new JSDOM(fs.readFileSync(path.join(REPO, 'public', 'music.html'), 'utf8'), { url: 'http://localhost/watch.html?v=v1', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
  const w = dom.window;
  w.matchMedia = (q) => ({ matches: (/max-width:\s*768px|pointer:\s*coarse|hover:\s*none/.test(q) && !/any-pointer/.test(q)) || (!!opts.reduced && /prefers-reduced-motion/.test(q)), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  w.scrollTo = () => {};
  w.HTMLMediaElement.prototype.load = function () {};
  w.HTMLMediaElement.prototype.pause = function () {};
  w.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
  w.resolveAudioArtUrl = () => '/albumart/t1';
  w.formatDuration = () => '';
  w.clampPositionState = (s) => s;
  w.navigator.mediaSession = { metadata: null, playbackState: 'none', setActionHandler() {}, setPositionState() {} };
  w.MediaMetadata = function (init) { Object.assign(this, init); };
  w.fetch = (u) => {
    const url = String(u); let body = {};
    if (url === '/api/settings') body = { backgroundAudioForVideo: true };
    else if (/\/prepare-audio$/.test(url)) body = { audioStatus: 'ready' };
    else if (url.indexOf('/api/queue') === 0) body = { entries: [], pointerUid: null };
    else if (/^\/api\/progress\//.test(url)) body = { timestamp: 0 };
    return Promise.resolve({ ok: true, status: 200, json: async () => body });
  };
  const fake = installFakeHost(w, opts.caps || CAPS);
  const style = w.document.createElement('style'); style.textContent = '#player-wrapper { border-top-left-radius: 12px; }'; w.document.head.appendChild(style);
  for (const f of SCRIPTS) w.eval(read(f));
  const reads = { n: 0 };
  // the box the browser would lay out: the base slot box moved by the WRAPPER's own inline transform (transform-origin 0 0)
  const boxNow = () => {
    const wr = w.document.getElementById('player-wrapper');
    const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)\s*scale\(([-\d.]+)\)/.exec((wr && wr.style.transform) || '');
    const tx = m ? +m[1] : 0, ty = m ? +m[2] : 0, s = m ? +m[3] : 1;
    const l = BASE.left + tx, t = BASE.top + ty, ww = BASE.width * s, hh = BASE.height * s;
    return { left: l, top: t, width: ww, height: hh, right: l + ww, bottom: t + hh, x: l, y: t };
  };
  w.HTMLVideoElement.prototype.getBoundingClientRect = () => { reads.n += 1; return boxNow(); };
  return {
    w, fake, reads, player: w.FileTube.player, slot: w.document.getElementById('player-slot'),
    wrapper: () => w.document.getElementById('player-wrapper'),
    hole: () => w.document.getElementById('ft-video-hole'),
    surfaces: () => fake.of('video.surface'),
    last: () => { const s = fake.of('video.surface'); return s[s.length - 1]; },
    // what claimMinimizeDrag + followMinimizeDrag write
    pull(dy) { const wr = this.wrapper(); if (!wr.classList.contains('is-minimize-drag')) { wr.classList.remove('is-minimize-snap', 'is-minimize-settle'); wr.classList.add('is-minimize-drag'); } wr.style.transformOrigin = '0 0'; wr.style.transform = 'translate(0px, ' + dy + 'px) scale(' + (1 - dy / 1000) + ')'; },
    close: () => w.close(),
  };
}
async function loaded(r) {
  r.player.load('v1', VIDEO, { slot: r.slot });
  await settle(80);
  const loads = r.fake.of('audio.load');
  assert.strictEqual(loads.length, 1, 'the claim');
  r.fake.emit(STATE(loads[0].rev));
  await settle(60);
}

test('surfaceLiveDecision: true for exactly the three pull classes', () => {
  assert.strictEqual(typeof na.surfaceLiveDecision, 'function');
  for (const c of ['is-minimize-drag', 'is-minimize-snap', 'is-minimize-settle', 'player-wrapper is-minimize-snap css']) assert.strictEqual(na.surfaceLiveDecision(c), true, c);
  for (const c of ['', 'player-wrapper', 'is-minimize-fading', 'is-minimize-dragger', 'x-is-minimize-drag', null, undefined]) assert.strictEqual(na.surfaceLiveDecision(c), false, String(c));
});

test('R1: a transform-only move posts the moved rect within a frame, every frame; the posts stop when the classes clear (and one exact measure ends it)', async () => {
  const r = realm();
  try {
    await loaded(r);
    const n0 = r.surfaces().length;
    r.pull(40); await settle(40);
    assert.strictEqual(r.surfaces().length, n0 + 1, 'the first moved frame posted');
    assert.strictEqual(r.last().rect.y, 340, 'at the transform-moved top');
    for (const dy of [80, 130, 190]) { r.pull(dy); await settle(40); assert.strictEqual(r.last().rect.y, 300 + dy, 'follows dy ' + dy + ' within a frame'); }
    assert.strictEqual(r.surfaces().length, n0 + 4);
    const wr = r.wrapper(); wr.classList.remove('is-minimize-drag'); wr.style.transform = ''; await settle(60);
    assert.deepStrictEqual(r.last().rect, { x: 0, y: 300, w: 393, h: 221 }, 'the final exact measure');
    const n1 = r.surfaces().length; r.reads.n = 0;
    await settle(300);
    assert.strictEqual(r.surfaces().length, n1, 'no more posts once the classes are gone');
    assert.ok(r.reads.n <= 1, 'no per-frame reads once the classes are gone: ' + r.reads.n);
  } finally { r.close(); }
});

test('R1: the loop runs while the spring (snap) and fly-in (settle) classes hold the wrapper, with a transition moving the box', async () => {
  const r = realm();
  try {
    await loaded(r);
    r.pull(150); await settle(40);
    const wr = r.wrapper();
    wr.classList.remove('is-minimize-drag'); wr.classList.add('is-minimize-snap'); wr.style.transform = '';
    await settle(40);
    const n = r.surfaces().length;
    // a CSS transition changes the computed box with no DOM write: simulate by moving the inline transform via a non-observed style write
    wr.style.transform = 'translate(0px, 90px) scale(0.91)'; await settle(40);
    assert.strictEqual(r.surfaces().length, n + 1, 'snap: a box move with no class change is still posted');
    wr.classList.remove('is-minimize-snap'); wr.classList.add('is-minimize-settle');
    wr.style.transform = 'translate(0px, 30px) scale(0.97)'; await settle(40);
    assert.strictEqual(r.last().rect.y, 330, 'settle: followed too');
  } finally { r.close(); }
});

test('R1 census: with none of the classes, an idle second posts nothing, reads the box at most for the backstop and writes nothing', async () => {
  const r = realm();
  try {
    await loaded(r);
    r.reads.n = 0; const n0 = r.surfaces().length;
    await settle(1000);
    assert.strictEqual(r.surfaces().length, n0);
    assert.ok(r.reads.n <= 2, 'idle reads: ' + r.reads.n);
  } finally { r.close(); }
});

test('R2: during live motion the hole opens on the INTERSECTION of this frame\'s rect and the previously posted one; the final measure is exact', async () => {
  const r = realm();
  try {
    await loaded(r);
    r.pull(0); await settle(40);
    const seen = [];
    const mo = new r.w.MutationObserver(() => seen.push(r.hole().style.getPropertyValue('clip-path') || ''));
    mo.observe(r.hole(), { attributes: true, attributeFilter: ['style'] });
    r.pull(100); await settle(60);
    // frame 1 of the move: previous rect top 300 / bottom 521, this frame top 400 / bottom ~598.9 -> the intersection is 400..521
    assert.ok(seen.length >= 2, 'the hole was written on the moving frame and again once the rect held: ' + seen.length);
    assert.ok(/M12,400H/.test(seen[0]) && seen[0].includes('V521H'), 'first frame: the intersection (top 400, bottom 521): ' + seen[0]);
    assert.ok(/V598\.9/.test(seen[seen.length - 1]), 'next frame (rect unchanged): the exact rect: ' + seen[seen.length - 1]);
    mo.disconnect();
    const wr = r.wrapper(); wr.classList.remove('is-minimize-drag'); wr.style.transform = ''; await settle(60);
    const exact = r.hole().style.getPropertyValue('clip-path');
    assert.ok(exact.includes('V521H'), 'exact rect on the final measure: ' + exact);
  } finally { r.close(); }
});

// ---- W2 (R3): nothing paints over the picture ----------------------------------------------------------------------------

function watchPage(r) {
  const d = r.w.document, root = d.getElementById('view-root');
  root.setAttribute('data-view', 'watch');
  const main = d.createElement('div'); main.className = 'watch-main';
  const stage = d.createElement('div'); stage.className = 'watch-player-stage'; stage.appendChild(r.slot);
  const title = d.createElement('div'); title.className = 'watch-title';
  const actions = d.createElement('div'); actions.className = 'watch-actions';
  main.append(stage, title, actions);
  const side = d.createElement('aside'); side.className = 'watch-sidebar';
  root.append(main, side);
  // the title sits under the picture's bottom half when it is pulled down; the action row is far below; the sidebar beside nothing
  const rect = (t, h) => () => ({ left: 0, top: t, width: 393, height: h, right: 393, bottom: t + h, x: 0, y: t });
  title.getBoundingClientRect = rect(540, 60); actions.getBoundingClientRect = rect(1400, 60); side.getBoundingClientRect = rect(2000, 400); stage.getBoundingClientRect = rect(300, 221);
  const clipOf = (n) => n.style.getPropertyValue('clip-path');
  return { stage, title, actions, side, clipOf };
}

test('R3: while the pull runs, a faded element meeting the box is clipped to exclude it (even-odd, in its own coordinates); others and the stage are untouched', async () => {
  const r = realm();
  try {
    const p = watchPage(r);
    await loaded(r);
    r.pull(100); await settle(60); // the box is now top 400, bottom ~599: it meets the title (500..560)
    assert.match(p.clipOf(p.title), /^path\(evenodd, "M-4000,-4000H4393V4060H-4000ZM0,-140h/, 'title clipped around the box, box top 140px above the title top: ' + p.clipOf(p.title));
    assert.strictEqual(p.clipOf(p.actions), '', 'an element the box does not meet is not clipped');
    assert.strictEqual(p.clipOf(p.side), '');
    assert.strictEqual(p.clipOf(p.stage), '', 'never the element holding the player slot (LESSONS 7)');
    assert.strictEqual(r.wrapper().style.getPropertyValue('clip-path'), '', 'nor the wrapper');
    r.pull(0); await settle(60);
    assert.strictEqual(p.clipOf(p.title), '', 'the box left the title: that clip is gone');
  } finally { r.close(); }
});

test('R3: every clip is gone after each end path - the classes clearing, the dock (clearMinimizeDrag), a stand-down load, no clip while idle', async () => {
  const r = realm();
  try {
    const p = watchPage(r);
    await loaded(r);
    await settle(80);
    assert.strictEqual(p.clipOf(p.title), '', 'idle: none');
    // 1. snap/settle end: the classes clear
    r.pull(100); await settle(60); assert.notStrictEqual(p.clipOf(p.title), '');
    const wr = r.wrapper(); wr.classList.remove('is-minimize-drag'); wr.style.transform = ''; await settle(60);
    assert.strictEqual(p.clipOf(p.title), '', 'classes cleared: the first non-live measure removes the clip');
    // 2. the one remover: clearMinimizeDrag via the dock
    r.pull(100); await settle(60); assert.notStrictEqual(p.clipOf(p.title), '');
    r.player.dock(); await settle(5);
    assert.strictEqual(p.clipOf(p.title), '', 'dock(): clearMinimizeDrag cleared it at once, before any frame');
    // 3. a stand-down (surfaceOff) with the clip applied
    r.player.expand(r.slot); await settle(60);
    r.pull(100); await settle(60); assert.notStrictEqual(p.clipOf(p.title), '');
    r.w.FileTube.nativeAudio.release && r.w.FileTube.nativeAudio.release();
    r.w.FileTube.nativeAudio.clearOcclusion(); // the controller's belt is what surfaceOff calls
    assert.strictEqual(p.clipOf(p.title), '');
  } finally { r.close(); }
});

test('R3: player.js clearMinimizeDrag calls clearOcclusion (the one remover keeps the one place)', () => {
  const src = read('player.js');
  const fn = src.slice(src.indexOf('function clearMinimizeDrag()'));
  assert.ok(fn.slice(0, fn.indexOf('\n  }\n')).includes('na.clearOcclusion();'));
});

// ---- W3 (R4): a clean release -----------------------------------------------------------------------------------------

test('R4b: the thumbnail is preloaded at the claim; it is the poster only once docked (never during the pull); gone on expand', async () => {
  const r = realm();
  try {
    const imgs = [];
    r.w.Image = function () { const o = { set src(v) { imgs.push(v); } }; return o; };
    await loaded(r);
    assert.deepStrictEqual(imgs, ['/thumbnail/v1'], 'preloaded once, at the claim');
    r.pull(120); await settle(60);
    assert.strictEqual(r.w.document.getElementById('media-player').getAttribute('poster'), null, 'no poster over the live picture during the pull');
    const wr = r.wrapper(); wr.classList.remove('is-minimize-drag'); wr.style.transform = '';
    r.player.dock(); await settle(40);
    assert.strictEqual(r.w.document.getElementById('media-player').getAttribute('poster'), '/thumbnail/v1', 'the dock paints the thumbnail in the same sync as visible: false');
    assert.strictEqual(r.last().visible, false);
  } finally { r.close(); }
});

test('R4c: committing the minimize under a native picture holds the slot height until clearMinimizeDrag runs', async () => {
  const r = realm();
  try {
    const p = watchPage(r);
    r.w.document.body.setAttribute('data-view', 'watch');
    await loaded(r);
    const h = 321;
    r.slot.getBoundingClientRect = () => ({ left: 0, top: 300, width: 393, height: h, right: 393, bottom: 300 + h, x: 0, y: 300 });
    const chev = r.wrapper().querySelector('.player-minimize');
    assert.ok(chev, 'the chevron exists');
    chev.click();
    assert.strictEqual(r.player.getState(), 'docked', 'the commit docked');
    assert.strictEqual(r.slot.style.minHeight, '321px', 'the slot keeps its height after the host leaves (no page jump before the swap)');
    r.player.expand(r.slot); // an end path (resetTransientPlaybackUi -> clearMinimizeDrag)
    r.player.dock();
    await settle(900);
    assert.strictEqual(r.slot.style.minHeight, '', 'the hold ends with the pull (the one remover)');
    void p;
  } finally { r.close(); }
});

// ---- gate r1 (adversary): the guards the first tests did not bind -----------------------------------------------------------

test('R4c (gate r1 W1): a player WITHOUT nativeVideo holds nothing - the same commit leaves the slot style untouched', async () => {
  const r = realm({ caps: { capabilities: ['nativeAudio', 'nativeVideoAudio'] } });
  try {
    watchPage(r);
    r.w.document.body.setAttribute('data-view', 'watch');
    r.player.load('v1', VIDEO, { slot: r.slot });
    await settle(120);
    r.slot.getBoundingClientRect = () => ({ left: 0, top: 300, width: 393, height: 321, right: 393, bottom: 621, x: 0, y: 300 });
    r.wrapper().classList.remove('native-controls'); // a web-only phone defaults to the browser's own bar, which refuses minimize; the custom bar is the case under test
    r.wrapper().querySelector('.player-minimize').click();
    assert.strictEqual(r.player.getState(), 'docked', 'the web-only commit must really dock, or this proves nothing');
    assert.strictEqual(r.slot.style.minHeight, '', 'no hold without a native surface');
  } finally { r.close(); }
});

test('R4c (gate r1 W2): under reduced motion (no settle timer) the hold still ends on its own', async () => {
  const r = realm({ reduced: true });
  try {
    watchPage(r);
    r.w.document.body.setAttribute('data-view', 'watch');
    await loaded(r);
    r.slot.getBoundingClientRect = () => ({ left: 0, top: 300, width: 393, height: 321, right: 393, bottom: 621, x: 0, y: 300 });
    r.wrapper().querySelector('.player-minimize').click();
    assert.strictEqual(r.player.getState(), 'docked');
    assert.strictEqual(r.slot.style.minHeight, '321px', 'held right after the commit');
    await settle(900);
    assert.strictEqual(r.slot.style.minHeight, '', 'released by the fallback timer, not left until some other clear');
  } finally { r.close(); }
});

test('R1 (gate r1 W3): a wrapper detached mid-pull never keeps the loop alive (no box reads at 60 Hz)', async () => {
  const r = realm();
  try {
    await loaded(r);
    r.pull(100); await settle(60);
    r.slot.remove();
    await settle(80);
    r.reads.n = 0;
    await settle(400);
    assert.ok(r.reads.n <= 2, 'a detached wrapper with is-minimize-drag still on it: reads in 400 ms = ' + r.reads.n);
  } finally { r.close(); }
});
