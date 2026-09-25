'use strict';

// [UNIT] v1.334 TAP TO PLAY (Dean 2026-09-25: "flakiness of me tapping an iOS PWA notification and having it
// launch the app, go to the music page, but not actually launch the song"; his ruling D9 in plan
// 2026-09-25-pocket-open-ask-sticker-light: "Tap-to-play cue + log").
//
// Diagnosis (the plan's Research): both notification arms load a FRESH page that never had a tap, iOS refuses
// an audible play() without one (WebKit MediaElementSession -> NotAllowedError), and player.js swallowed the
// refusal - a paused player that looked broken. Now the load's auto-start logs both outcomes to the
// ?debugLifecycle=1 ring and a refusal raises player.autoStartRefused(); the painted skin shows one "Tap to
// play" cue whose tap presses the player's own play control inside the gesture.
//
// Driven through the REAL public/js/player.js inside a realm built from the real music.html shell, and end
// to end through the real music.js + skin engine at the notification's own URL (/music?play=<id>&ao=1).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const REPO = path.join(__dirname, '..', '..');
const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));

// The real music.html realm + the real player.js. `outcome` decides what play() does: 'refuse' (iOS's
// NotAllowedError), 'ok', or 'abort' (a newer load replaced it). Counts every play().
function realm({ url = 'http://localhost/music?play=t1&ao=1', outcome = 'refuse', mobile = true, view = false } = {}) {
  const vc = new VirtualConsole();
  const dom = new JSDOM(fs.readFileSync(path.join(REPO, 'public', 'music.html'), 'utf8'), { url, runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc });
  const w = dom.window;
  const ctl = { outcome, plays: 0 };
  w.matchMedia = (q) => ({ matches: /max-width:\s*768px/.test(q) && mobile, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  w.scrollTo = () => {};
  w.HTMLMediaElement.prototype.load = function () {};
  w.HTMLMediaElement.prototype.pause = function () {};
  w.HTMLMediaElement.prototype.play = function () {
    ctl.plays += 1;
    if (ctl.outcome === 'ok') return Promise.resolve();
    return Promise.reject(new w.DOMException('refused', ctl.outcome === 'abort' ? 'AbortError' : 'NotAllowedError'));
  };
  w.resolveAudioArtUrl = () => '/albumart/t1';
  w.formatDuration = () => '';
  w.clampPositionState = (s) => s; // a common.js page global the play listener reaches (common.js is not loaded here)
  w.navigator.mediaSession = { metadata: null, playbackState: 'none', setActionHandler() {}, setPositionState() {} };
  w.MediaMetadata = function (init) { Object.assign(this, init); };
  w.localStorage.setItem('ft-debug-lifecycle', '1');
  w.localStorage.setItem('ft-music-skin', 'ipod');
  const track = { id: 't1', title: 'Song', artist: 'A', album: '', albumKey: '', durationSec: 100 };
  w.fetch = (u) => Promise.resolve({ ok: true, json: async () => (String(u).indexOf('/api/music') === 0 ? { items: [track], total: 1 } : String(u).indexOf('/api/queue') === 0 ? { entries: [], pointerUid: null } : {}) });
  const events = [];
  w.document.addEventListener('filetube:autostart', (e) => events.push(e.detail && e.detail.refused));
  w.eval(fs.readFileSync(path.join(REPO, 'public', 'js', 'player.js'), 'utf8'));
  let mod = null;
  if (view) {
    w.FileTube.registerView = (n, m) => { mod = m; };
    w.FileTube.shimmerArt = () => {};
    for (const f of ['music-skins.js', 'skin-surface.js', 'pocket-lighting.js', 'music.js']) w.eval(fs.readFileSync(path.join(REPO, 'public', 'js', f), 'utf8'));
    mod.init(w.document.getElementById('view-root'));
  }
  const log = () => { try { return JSON.parse(w.localStorage.getItem('ft-lifecycle-log') || '[]'); } catch (_) { return []; } };
  return { w, ctl, events, log, player: w.FileTube.player, mod, slot: w.document.getElementById('player-slot'), close: () => { try { if (mod) mod.destroy(); } catch (_) { /* best-effort */ } w.close(); } };
}
const MUSIC_DATA = { type: 'audio', title: 'Song', channelName: 'A', folderName: 'A', album: '', albumKey: '', duration: 100, artUrl: '/albumart/t1', streamSrc: '/track/t1', resumeMode: 'music', autoAdvanceViaTrackNav: true, readerHref: '/music?nowplaying=1' };

test('the load\'s auto-start: an iOS refusal (NotAllowedError) raises autoStartRefused() + one event and is LOGGED (the reason, whether the page ever had a tap, its age); the element\'s play, the next load and close() lower it', async () => {
  const r = realm({ url: 'http://localhost/music' });
  try {
    assert.strictEqual(r.player.autoStartRefused(), false, 'nothing loaded: not refused');
    r.player.load('t1', { ...MUSIC_DATA }, { slot: r.slot });
    await settle();
    assert.ok(r.ctl.plays >= 1, 'the load tried to auto-start');
    assert.strictEqual(r.player.autoStartRefused(), true, 'the refusal is no longer swallowed');
    assert.deepStrictEqual(r.events, [true], 'one event says so');
    const ref = r.log().filter((e) => e.type === 'autostart:refused');
    assert.strictEqual(ref.length, 1, 'logged once');
    assert.match(ref[0].detail, /^NotAllowedError · tap (had|never|n\/a) · page \d+ms$/, 'the reason, the tap history, the page age (cold vs warm)');
    // the element plays (the cue's tap, the lock screen, anything): lowered
    r.w.document.getElementById('media-player').dispatchEvent(new r.w.Event('play'));
    assert.strictEqual(r.player.autoStartRefused(), false, 'a play lowers it');
    assert.deepStrictEqual(r.events, [true, false]);
    // refused again on a NEW load, then the next load lowers it before its own auto-start decides
    r.player.load('t2', { ...MUSIC_DATA, title: 'Two' }, { slot: r.slot });
    await settle();
    assert.strictEqual(r.player.autoStartRefused(), true, 'populated again');
    r.ctl.outcome = 'ok';
    r.player.load('t3', { ...MUSIC_DATA, title: 'Three' }, { slot: r.slot });
    assert.strictEqual(r.player.autoStartRefused(), false, 'the next load starts un-refused (synchronously, before its auto-start)');
    await settle();
    assert.strictEqual(r.player.autoStartRefused(), false, 'and an allowed start keeps it down');
    assert.ok(r.log().some((e) => e.type === 'autostart:ok'), 'an allowed start is logged too (the "sometimes it works" half)');
    r.ctl.outcome = 'refuse';
    r.player.load('t4', { ...MUSIC_DATA, title: 'Four' }, { slot: r.slot });
    await settle();
    assert.strictEqual(r.player.autoStartRefused(), true);
    r.player.close();
    assert.strictEqual(r.player.autoStartRefused(), false, 'close() lowers it');
  } finally { r.close(); }
});

test('only iOS\'s no-gesture refusal counts: an AbortError (a newer load replacing this one) never raises the flag, and neither does a refusal that lands after a newer load began', async () => {
  const a = realm({ url: 'http://localhost/music', outcome: 'abort' });
  try {
    a.player.load('t1', { ...MUSIC_DATA }, { slot: a.slot });
    await settle();
    assert.strictEqual(a.player.autoStartRefused(), false, 'AbortError: not a refusal');
    assert.ok(a.log().some((e) => e.type === 'autostart:refused' && /^AbortError/.test(e.detail)), 'but it is logged by name');
  } finally { a.close(); }
  const s = realm({ url: 'http://localhost/music' });
  try {
    let rejectLate = null;
    s.w.HTMLMediaElement.prototype.play = function () { s.ctl.plays += 1; return new Promise((res, rej) => { rejectLate = rej; }); };
    s.player.load('t1', { ...MUSIC_DATA }, { slot: s.slot });
    await settle();
    assert.ok(rejectLate, 'the first load\'s play is pending');
    const first = rejectLate;
    s.ctl.outcome = 'ok';
    s.w.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
    s.player.load('t2', { ...MUSIC_DATA, title: 'Two' }, { slot: s.slot });
    first(new s.w.DOMException('refused', 'NotAllowedError'));
    await settle();
    assert.strictEqual(s.player.autoStartRefused(), false, 'a stale load\'s refusal never flags the new one');
  } finally { s.close(); }
});

test('END TO END - the notification\'s own URL (/music?play=t1&ao=1) through the real music.js + skin engine: iOS refuses, the Click skin shows ONE "Tap to play" cue, its tap presses play INSIDE the gesture, and the play clears it', async () => {
  const r = realm({ view: true });
  try {
    await settle(400);
    const panel = r.w.document.getElementById('music-nowplaying-panel');
    assert.ok(panel.querySelector('.ip-wheel'), 'the Click skin opened');
    assert.strictEqual(r.player.autoStartRefused(), true);
    const cues = panel.querySelectorAll('[data-skin-tapplay]');
    assert.strictEqual(cues.length, 1, 'one cue');
    assert.match(cues[0].textContent, /Tap to play/);
    assert.strictEqual(cues[0].tagName, 'BUTTON', 'a real control (keyboard + screen reader)');
    const before = r.ctl.plays;
    r.ctl.outcome = 'ok';
    cues[0].dispatchEvent(new r.w.MouseEvent('click', { bubbles: true }));
    assert.strictEqual(r.ctl.plays, before + 1, 'play() ran in the SAME turn as the tap (the gesture iOS needs)');
    r.w.document.getElementById('media-player').dispatchEvent(new r.w.Event('play'));
    assert.strictEqual(panel.querySelectorAll('[data-skin-tapplay]').length, 0, 'the play cleared the cue');
  } finally { r.close(); }
  // the never-shows axis: a start iOS allows (a warm, tapped page) shows no cue at all
  const ok = realm({ view: true, outcome: 'ok' });
  try {
    await settle(400);
    const panel = ok.w.document.getElementById('music-nowplaying-panel');
    assert.ok(panel.querySelector('.ip-wheel'), 'the Click skin opened');
    assert.strictEqual(panel.querySelectorAll('[data-skin-tapplay]').length, 0, 'an allowed start: no cue');
  } finally { ok.close(); }
});

// ---------------------------------------------------------------- the engine's cue, arm by arm
const ENGINE_HTML = '<body><video id="media-player"></video><button id="pp-btn"></button><button id="track-prev-btn"></button><button id="track-next-btn"></button><input id="seek-bar" type="range" /><div id="panel" class="music-nowplaying-panel" hidden></div></body>';
function engine({ otherDoc = false, skin = 'ipod' } = {}) {
  const dom = new JSDOM(ENGINE_HTML, { url: 'http://localhost/music', pretendToBeVisual: true });
  const saved = { window: global.window, document: global.document, Event: global.Event };
  global.window = dom.window; global.document = dom.window.document; global.Event = dom.window.Event;
  const sdom = otherDoc ? new JSDOM(ENGINE_HTML, { url: 'http://localhost/popout', pretendToBeVisual: true }) : dom;
  dom.window.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  const skinsPath = require.resolve('../../public/js/music-skins.js');
  const surfacePath = require.resolve('../../public/js/skin-surface.js');
  delete require.cache[skinsPath]; delete require.cache[surfacePath];
  global.module = undefined;
  dom.window.FileTubeMusicSkins = require(skinsPath);
  require(surfacePath);
  const st = { refused: true, paused: true, pp: 0 };
  const D = sdom.window.document;
  const mp = D.getElementById('media-player');
  Object.defineProperty(mp, 'paused', { configurable: true, get: () => st.paused });
  D.getElementById('pp-btn').addEventListener('click', () => { st.pp += 1; });
  const player = { autoStartRefused: () => st.refused };
  const e = dom.window.FileTubeSkinSurface.create({
    panel: D.getElementById('panel'), win: sdom.window, getSkinId: () => skin,
    getCtx: () => ({ track: { title: 'T', artist: 'A' }, upNext: [], fullList: [], playing: false }),
    hostCtl: (id) => D.getElementById(id), onSelectIndex: () => {}, onDock: () => {},
    sticker: { getPlayer: () => player, onSkinChange() {} },
  });
  const panel = D.getElementById('panel');
  const cue = () => panel.querySelectorAll('[data-skin-tapplay]');
  const flip = (refused) => { st.refused = refused; dom.window.document.dispatchEvent(new dom.window.CustomEvent('filetube:autostart', { detail: { refused } })); };
  let dead = false;
  return { e, st, panel, cue, flip, win: sdom.window, kill: () => { dead = true; e.destroy(); }, restore: () => { if (!dead) e.destroy(); Object.assign(global, saved); } };
}

test('the engine\'s cue: shown while refused + paused, on every skin; survives a repaint; appears on the event and goes on its clear; never while playing, never in the pop-out; its tap presses #pp-btn only while paused; destroy unbinds the event', () => {
  for (const skin of ['ipod', 'apple', 'ipod-red']) {
    const x = engine({ skin });
    try {
      x.e.paint();
      assert.strictEqual(x.cue().length, 1, skin + ': refused + paused: the cue');
      x.e.paint();
      assert.strictEqual(x.cue().length, 1, skin + ': a repaint keeps exactly one');
    } finally { x.restore(); }
  }
  const x = engine();
  try {
    x.st.refused = false; x.e.paint();
    assert.strictEqual(x.cue().length, 0, 'not refused: no cue (the never-shows axis)');
    x.flip(true);
    assert.strictEqual(x.cue().length, 1, 'the refusal event brings it up on the painted skin');
    x.cue()[0].dispatchEvent(new x.win.MouseEvent('click', { bubbles: true }));
    assert.strictEqual(x.st.pp, 1, 'the tap pressed the player\'s play control');
    x.flip(false);
    assert.strictEqual(x.cue().length, 0, 'the clear takes it down (from a POPULATED state)');
    x.flip(true); x.st.paused = false; x.e.reflect();
    assert.strictEqual(x.cue().length, 0, 'a playing element never shows it (reflect settles it)');
    x.st.paused = true; x.e.reflect();
    assert.strictEqual(x.cue().length, 1);
    x.st.paused = false;
    x.cue()[0].dispatchEvent(new x.win.MouseEvent('click', { bubbles: true }));
    assert.strictEqual(x.st.pp, 1, 'already playing: the tap never presses play/pause (it would PAUSE)');
    assert.strictEqual(x.cue().length, 0, 'and the cue settles away');
  } finally { x.restore(); }
  const d = engine();
  try {
    d.e.paint(); assert.strictEqual(d.cue().length, 1);
    d.kill();
    d.st.refused = true; d.panel.innerHTML = '<i></i>';
    d.win.document.dispatchEvent(new d.win.CustomEvent('filetube:autostart', { detail: { refused: true } }));
    assert.strictEqual(d.cue().length, 0, 'a destroyed engine no longer listens');
  } finally { d.restore(); }
  const p = engine({ otherDoc: true });
  try { p.e.paint(); assert.strictEqual(p.cue().length, 0, 'the pop-out never shows it (the flag lives on the main window)'); } finally { p.restore(); }
});

test('every auto-start branch of the load reports a refusal (music, podcast, TV, a book\'s narration, a chapter track\'s seek, a plain video): none swallows it any more', async () => {
  const shapes = {
    music: { ...MUSIC_DATA },
    podcast: { type: 'audio', title: 'Ep', duration: 100, resumeMode: 'podcast', readerHref: '/podcasts?nowplaying=1' },
    tv: { type: 'video', title: 'S1E1', duration: 100, resumeMode: 'tv', progress: 0 },
    book: { type: 'audio', title: 'Chapter 1', duration: 100, suppressProgress: true },
    chapter: { ...MUSIC_DATA, chapterStartSec: 30 },
    video: { type: 'video', title: 'A video', duration: 100 },
  };
  for (const [kind, data] of Object.entries(shapes)) {
    const r = realm({ url: 'http://localhost/music', mobile: false });
    try {
      r.player.load('x-' + kind, data, { slot: r.slot });
      await settle(60);
      assert.strictEqual(r.player.autoStartRefused(), true, kind + ': the refusal raised the flag');
      assert.ok(r.log().some((e) => e.type === 'autostart:refused'), kind + ': and was logged');
    } finally { r.close(); }
  }
});
