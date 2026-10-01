'use strict';

// [UNIT] v1.352 L1: `/watch?v=<id>&t=<time>` starts a library video at that moment. The parser table,
// and the REAL public/js/player.js in a jsdom realm: an explicit start beats a saved position of 300 s
// (no "Resumed at" toast), a start past the end plays from 0, and the adopt branch (the same video
// already loaded) seeks once per value. watch.js hands startAt to every load it makes.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const W = require('../../public/js/watch.js');

const REPO = path.join(__dirname, '..', '..');
const settle = () => new Promise((r) => setTimeout(r, 30));

test('parseStartTime: whole seconds and the YouTube form; null for junk, negative, empty and over 24 h', () => {
  const ok = { 90: 90, 0: 0, '1m30s': 90, '2m': 120, '45s': 45, '1h2m3s': 3723, '1h': 3600, ' 10 ': 10, '1H2M': 3720, 86400: 86400 };
  for (const [k, v] of Object.entries(ok)) assert.strictEqual(W.parseStartTime(String(k)), v, k);
  for (const bad of ['', ' ', '-5', '1.5', 'abc', '1m30', 'm', 's', '1x', '86401', '25h', '1h2m3s4', null, undefined, 90]) {
    assert.strictEqual(W.parseStartTime(bad), null, String(bad));
  }
});

function realm(progressSec) {
  const dom = new JSDOM(fs.readFileSync(path.join(REPO, 'public', 'watch.html'), 'utf8'), {
    url: 'http://localhost/watch?v=v1', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: new VirtualConsole(),
  });
  const w = dom.window;
  w.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  w.HTMLMediaElement.prototype.load = function () {};
  w.HTMLMediaElement.prototype.play = function () { Object.defineProperty(this, 'paused', { value: false, configurable: true }); return Promise.resolve(); };
  w.HTMLMediaElement.prototype.pause = function () { Object.defineProperty(this, 'paused', { value: true, configurable: true }); };
  w.navigator.mediaSession = { metadata: null, playbackState: 'none', setActionHandler() {}, setPositionState() {} };
  w.MediaMetadata = function (init) { Object.assign(this, init); };
  const fetches = [];
  w.fetch = (u) => {
    fetches.push(String(u));
    const body = String(u).startsWith('/api/progress/') ? { timestamp: progressSec } : String(u).startsWith('/api/videos/') ? { transcodeStatus: 'ready' } : {};
    return Promise.resolve({ ok: true, json: async () => body });
  };
  w.eval(fs.readFileSync(path.join(REPO, 'public', 'js', 'player.js'), 'utf8'));
  return { w, player: w.FileTube.player, get el() { return w.document.getElementById('media-player'); }, fetches, close: () => w.close() };
}
const VIDEO = { type: 'video', title: 'Clip', channelName: 'Chan', duration: 600 };

test('an explicit start overrides a saved position of 300 s, with no progress read and no Resumed-at toast', async () => {
  const r = realm(300);
  try {
    assert.strictEqual(r.player.load('v1', { ...VIDEO, startAt: 30 }, { slot: r.w.document.getElementById('player-slot') }), true);
    await settle();
    assert.strictEqual(r.el.currentTime, 30);
    assert.ok(!r.fetches.some((u) => u.startsWith('/api/progress/v1')), 'the saved position is not consulted');
    const toast = r.w.document.getElementById('resume-toast');
    assert.ok(!toast || toast.hidden || !toast.classList.contains('visible'), 'no Resumed at toast');
  } finally { r.close(); }
  const plain = realm(300);
  try {
    plain.player.load('v1', { ...VIDEO }, { slot: plain.w.document.getElementById('player-slot') });
    await settle();
    assert.strictEqual(plain.el.currentTime, 300, 'without t it resumes at the saved position (the control)');
  } finally { plain.close(); }
});

test('a start at or past the end plays from 0 (known duration, and one learned at loadedmetadata)', async () => {
  const r = realm(0);
  try {
    r.player.load('v1', { ...VIDEO, startAt: 900 }, { slot: r.w.document.getElementById('player-slot') });
    await settle();
    assert.strictEqual(r.el.currentTime, 0, 'duration 600 known up front');
  } finally { r.close(); }
  const u = realm(0);
  try {
    u.player.load('v1', { type: 'video', title: 'Clip', startAt: 900 }, { slot: u.w.document.getElementById('player-slot') });
    await settle();
    assert.strictEqual(u.el.currentTime, 900, 'no duration yet: asked for as given');
    Object.defineProperty(u.el, 'duration', { value: 120, configurable: true });
    u.el.dispatchEvent(new u.w.Event('loadedmetadata'));
    assert.strictEqual(u.el.currentTime, 0, 'the end, once known, sends it back to 0');
  } finally { u.close(); }
});

test('adopt (the same video already loaded): a new t seeks, the same t again does not', async () => {
  const r = realm(0);
  try {
    const slot = r.w.document.getElementById('player-slot');
    r.player.load('v1', { ...VIDEO, startAt: 30 }, { slot });
    await settle();
    r.el.currentTime = 41; // it played on
    r.player.load('v1', { ...VIDEO, startAt: 30 }, { slot }); // the watch page's own follow-up load
    assert.strictEqual(r.el.currentTime, 41, 'the same value is not applied twice');
    r.player.load('v1', { ...VIDEO, startAt: 200 }, { slot }); // a new &t= link to the playing video
    assert.strictEqual(r.el.currentTime, 200);
    r.player.load('v1', { ...VIDEO }, { slot });
    assert.strictEqual(r.el.currentTime, 200, 'no startAt: an adopt touches nothing');
  } finally { r.close(); }
});

test('watch.js hands startAt (parsed from ?t=) to every player.load the watch view makes', () => {
  const src = fs.readFileSync(path.join(REPO, 'public', 'js', 'watch.js'), 'utf8');
  assert.match(src, /const startAt = parseStartTime\(new URLSearchParams\(window\.location\.search\)\.get\('t'\)\);/);
  const initAt = src.indexOf('const startAt = parseStartTime(');
  const loads = src.slice(initAt).split('window.FileTube.player.load(').slice(1, 4).map((x) => x.slice(0, 400));
  assert.strictEqual(loads.length, 3);
  for (const l of loads) assert.match(l, /startAt \}/, 'a load without startAt: ' + l.slice(0, 80));
});
