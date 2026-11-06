'use strict';

// [UNIT] v1.404.0 picture-in-picture, W2 + W3 (plan 2026-11-05-ios-pip, R1-R4). The REAL player.js, native-audio.js and
// host-adapter.js in a jsdom realm with a fake host (test/helpers/live-dock-realm.js); the row is reached through a real click on it and native
// through videoPip events, never a hand-set flag (LESSONS 2). jsdom cannot float a video: WebKit's own calls are fakes that record, and whether Apple's
// window opens is the device check. scripts/pip-tap-probe.js proves the click arrives from a real tap in WebKit.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { realm, loaded, settle, VIDEO, VIDEO_CAPS, DOCK_CAPS, STATE } = require('../helpers/live-dock-realm');
const { pipRouteDecision } = require('../../public/js/player.js');

const REPO = path.join(__dirname, '..', '..');
const PIP_CAPS = { capabilities: DOCK_CAPS.capabilities.concat(['nativeVideoPip']) };
const PIP_ON = { v: 1, type: 'videoPip', active: true };
const PIP_OFF = { v: 1, type: 'videoPip', active: false };
const pip = (r) => r.wrapper().querySelector('#pip-btn');
const label = (r) => r.wrapper().querySelector('.player-pip-label');
const labelShown = (r) => !!(label(r) && !label(r).hidden);
const pipPosts = (r) => r.fake.of('video.pip').map((m) => m.action);
// a spy on the standard call: under a native surface it must never run
function spyStandard(w) {
  const s = { calls: 0 };
  w.HTMLVideoElement.prototype.requestPictureInPicture = function () { s.calls += 1; return Promise.reject(new w.Error('should not run')); };
  w.document.pictureInPictureEnabled = true;
  return s;
}
function openRow(r) { r.wrapper().querySelector('#settings-btn').click(); return pip(r); }

test('pipRouteDecision: every door', () => {
  const base = { nativeOwned: false, nativePip: false, nativeVideo: false, elementEmpty: false, mobile: false, supportsPresentation: false, standardEnabled: false };
  const d = (o) => pipRouteDecision(Object.assign({}, base, o));
  assert.strictEqual(d({ nativeOwned: true, nativePip: true, supportsPresentation: true, standardEnabled: true }), 'native', 'native first: the element has nothing to float');
  assert.strictEqual(d({ nativeOwned: true, supportsPresentation: true, standardEnabled: true }), 'none', 'owned without the capability: no row, never the standard call');
  assert.strictEqual(d({ nativeVideo: true, elementEmpty: true, standardEnabled: true, mobile: true }), 'none', 'a host with nativeVideo, nothing loaded yet');
  assert.strictEqual(d({ nativeVideo: true, standardEnabled: true, mobile: true, supportsPresentation: true }), 'presentation', 'a web-element video in the app (R2)');
  assert.strictEqual(d({ elementEmpty: true, standardEnabled: true }), 'standard', 'no host: an empty element is not a reason (desktop byte-identical)');
  assert.strictEqual(d({ mobile: true, supportsPresentation: true, standardEnabled: true }), 'presentation', 'iPhone Safari');
  assert.strictEqual(d({ mobile: true, standardEnabled: true }), 'standard', 'a phone without the WebKit call');
  assert.strictEqual(d({ supportsPresentation: true, standardEnabled: true }), 'standard', 'Mac Safari stays on the standard call');
  assert.strictEqual(d({ supportsPresentation: true }), 'none', 'a desktop without the standard call: hidden, as before this release');
  assert.strictEqual(d({ mobile: true, webkitSaysNo: true, standardEnabled: true }), 'none', 'a phone, media loaded, WebKit says no: pictureInPictureEnabled ignores the embedder');
  assert.strictEqual(d({ webkitSaysNo: true, standardEnabled: true }), 'standard', 'desktop byte-identical');
  assert.strictEqual(d({}), 'none');
});

test('R1: the row posts video.pip start, never the standard call; pressed, label, thumbnail and visible:false come ONLY from videoPip; stop reverses all of it', async () => {
  let std;
  const r = realm({ caps: PIP_CAPS, beforeScripts: (w) => { std = spyStandard(w); } });
  try {
    await loaded(r);
    assert.strictEqual(r.last().visible, true);
    assert.strictEqual(r.bodyOn(), true, 'the hole is open');
    const row = openRow(r);
    assert.strictEqual(row.hidden, false, 'the row shows');
    r.fake.clear();
    row.click();
    assert.deepStrictEqual(pipPosts(r), ['start']);
    assert.strictEqual(row.getAttribute('aria-pressed'), 'false', 'a post is a request, not a state');
    assert.strictEqual(labelShown(r), false);
    assert.strictEqual(r.fake.of('video.surface').length, 0, 'nothing moved yet');

    r.fake.emit(PIP_ON);
    assert.strictEqual(row.getAttribute('aria-pressed'), 'true');
    assert.strictEqual(row.getAttribute('aria-label'), 'Exit picture in picture');
    assert.strictEqual(label(r).textContent, 'Playing in picture-in-picture');
    assert.strictEqual(labelShown(r), true);
    assert.strictEqual(r.el().webkitPresentationMode, 'picture-in-picture');
    assert.strictEqual(r.last().visible, false, 'the surface posts visible:false at once');
    assert.strictEqual(r.poster(), '/thumbnail/v1', 'the thumbnail in the slot');
    assert.strictEqual(r.bodyOn(), false, 'the hole closed: the page paints the box');
    await settle(80);
    assert.strictEqual(r.poster(), '/thumbnail/v1', 'still there after the frames (holeApply(null) must not take it back)');

    const n = r.surfaces().length;
    row.click();
    assert.deepStrictEqual(pipPosts(r), ['start', 'stop']);
    assert.strictEqual(row.getAttribute('aria-pressed'), 'true', 'still only what native says');
    r.fake.emit(PIP_OFF);
    assert.strictEqual(row.getAttribute('aria-pressed'), 'false');
    assert.strictEqual(row.getAttribute('aria-label'), 'Picture in picture');
    assert.strictEqual(labelShown(r), false);
    assert.strictEqual(r.el().webkitPresentationMode, 'inline');
    assert.strictEqual(r.surfaces().length, n + 1, 'one post');
    assert.strictEqual(r.last().visible, true);
    assert.strictEqual(r.poster(), null, 'the thumbnail left');
    assert.strictEqual(r.bodyOn(), true, 'the hole reopened');
    assert.strictEqual(std.calls, 0, 'the standard call never ran');
  } finally { r.close(); }
});

test('R1: automatic PiP or Apple\'s own controls (no button press) drive the same state; a repeat of the same videoPip posts nothing', async () => {
  const r = realm({ caps: PIP_CAPS });
  try {
    await loaded(r);
    r.fake.emit(PIP_ON);
    assert.strictEqual(pip(r).getAttribute('aria-pressed'), 'true');
    assert.strictEqual(r.last().visible, false);
    const n = r.surfaces().length;
    r.fake.emit(PIP_ON);
    assert.strictEqual(r.surfaces().length, n);
    r.fake.emit({ v: 1, type: 'videoPip', active: 'yes' });
    assert.strictEqual(pip(r).getAttribute('aria-pressed'), 'true', 'a malformed event changes nothing');
    assert.deepStrictEqual(pipPosts(r), [], 'the web never posted');
    r.fake.emit(PIP_OFF);
    assert.strictEqual(r.last().visible, true);
  } finally { r.close(); }
});

for (const [name, caps] of [['v0.17 (dock, no pip)', DOCK_CAPS], ['v0.16 (no dock, no pip)', VIDEO_CAPS]]) {
  test('R2: ' + name + ': the row is hidden, nothing posts, the standard call never runs, the element has no PiP answer of ours, videoPip is ignored', async () => {
    let std;
    const r = realm({ caps, beforeScripts: (w) => { std = spyStandard(w); } });
    try {
      await loaded(r);
      const row = openRow(r);
      assert.strictEqual(row.hidden, true, 'never a dead button');
      row.click();
      assert.deepStrictEqual(pipPosts(r), []);
      assert.strictEqual(std.calls, 0);
      assert.strictEqual(Object.prototype.hasOwnProperty.call(r.el(), 'webkitPresentationMode'), false);
      const n = r.surfaces().length;
      r.fake.emit(PIP_ON);
      assert.strictEqual(r.surfaces().length, n, 'no surface change');
      assert.strictEqual(row.getAttribute('aria-pressed'), 'false');
    } finally { r.close(); }
  });
}

test('R2: a web-element video in the app (native stands down) takes the browser path when WebKit allows it, else hides; the row follows ownership', async () => {
  let setCalls = [], supports = true;
  const r = realm({ caps: DOCK_CAPS, beforeScripts: (w) => {
    w.document.pictureInPictureEnabled = true; // WebKit's real shape: true on the platform whatever the embedder allows
    w.HTMLVideoElement.prototype.webkitSupportsPresentationMode = () => supports;
    w.HTMLVideoElement.prototype.webkitSetPresentationMode = (m) => { setCalls.push(m); };
  } });
  r.w.showToast = () => {};
  try {
    await loaded(r);
    assert.strictEqual(openRow(r).hidden, true, 'native owns it: no capability, no row');
    r.player.load('f1', Object.assign({}, VIDEO, { id: 'f1', projection: 'equirect' }), { slot: r.slot }); // a 360 video stays on the web element
    await settle(60);
    assert.strictEqual(r.na.surfaceOwned(), false, 'stood down');
    assert.ok(r.el().getAttribute('src'), 'the web element has a source');
    r.el().dispatchEvent(new r.w.Event('loadedmetadata'));
    assert.strictEqual(pip(r).hidden, false);
    pip(r).click();
    assert.deepStrictEqual(setCalls, ['picture-in-picture']);
    assert.deepStrictEqual(pipPosts(r), [], 'never video.pip for a video native does not own');
    supports = false;
    r.el().dispatchEvent(new r.w.Event('loadedmetadata'));
    assert.strictEqual(pip(r).hidden, false, 'not loaded yet: its no means nothing');
    Object.defineProperty(r.el(), 'readyState', { configurable: true, get: () => 1 });
    r.el().dispatchEvent(new r.w.Event('loadedmetadata'));
    assert.strictEqual(pip(r).hidden, true, 'loaded and WebKit still says no (Q1): hidden, whatever pictureInPictureEnabled says');
    delete r.el().readyState;
    r.el().removeAttribute('src');
    supports = true;
    r.el().dispatchEvent(new r.w.Event('emptied'));
    assert.strictEqual(pip(r).hidden, true, 'R2 wiring: this host, the element empty again: nothing to float, though WebKit and the platform say yes');
  } finally { r.close(); }
});

test('the one predicate: native PiP reads as a native presentation through the element - the chevron hides and returns, watch.js says pip', async () => {
  const r = realm({ caps: PIP_CAPS });
  try {
    await loaded(r);
    const chev = () => r.wrapper().querySelector('.player-minimize');
    r.player.pause && r.player.pause();
    r.fake.emit(STATE(r.fake.of('audio.load')[0].rev, { state: 'paused' }));
    r.w.dispatchEvent(new r.w.Event('resize'));
    await settle(20);
    assert.strictEqual(chev().hidden, false, 'paused in the slot: the chevron is up');
    r.fake.emit(PIP_ON);
    assert.strictEqual(chev().hidden, true, 'follows PiP in (R1: the minimize pull never fights PiP)');
    const W = require('../../public/js/watch.js');
    assert.strictEqual(W.nativePresentationKind(r.el(), r.w.document), 'pip', "watch.js's note reads the same element");
    r.fake.emit(PIP_OFF);
    assert.strictEqual(chev().hidden, false, 'and back out');
    assert.strictEqual(W.nativePresentationKind(r.el(), r.w.document), '');
  } finally { r.close(); }
});

test('a docked video: PiP holds across the dock; the dock shows the thumbnail with the layer hidden, the label stays out of it; the end brings the live dock back', async () => {
  const r = realm({ caps: PIP_CAPS });
  try {
    await loaded(r);
    r.fake.emit(PIP_ON);
    r.player.dock();
    assert.strictEqual(r.player.getState(), 'docked');
    assert.strictEqual(r.last().visible, false, 'hidden in the dock too');
    assert.strictEqual(r.last().layer, 'above');
    assert.strictEqual(r.poster(), '/thumbnail/v1');
    assert.strictEqual(pip(r).getAttribute('aria-pressed'), 'true', 'PiP survives the dock');
    assert.ok(r.wrapper().closest('#player-dock').contains(label(r)), 'the label rides the host');
    const css = fs.readFileSync(path.join(REPO, 'public', 'css', 'style.css'), 'utf8');
    assert.ok(/#player-dock \.player-pip-label \{ display: none; \}/.test(css.replace(/\/\*[\s\S]*?\*\//g, '')), 'CSS keeps it out of the mini box');
    await settle(80);
    r.fake.emit(PIP_OFF);
    assert.strictEqual(r.last().visible, true);
    assert.strictEqual(r.last().layer, 'above');
    r.fake.emit(PIP_ON);
    r.player.expand(r.slot);
    assert.strictEqual(r.last().visible, false, 'expanded, still floating: hidden');
    assert.strictEqual(r.last().layer, 'below');
    assert.strictEqual(r.poster(), '/thumbnail/v1', 'the thumbnail in the slot');
    r.fake.emit(PIP_OFF);
    assert.strictEqual(r.last().visible, true);
    assert.strictEqual(r.poster(), null);
  } finally { r.close(); }
});

// Every end path from a POPULATED state, with no videoPip ever arriving (attack surface 3).
const END_PATHS = {
  'a new video': async (r) => { r.player.load('v2', Object.assign({}, VIDEO, { id: 'v2', title: 'B' }), { slot: r.slot }); await settle(60); },
  'the player closed': async (r) => { r.player.close(); await settle(20); },
  'a video native does not own': async (r) => { r.player.load('v3', Object.assign({}, VIDEO, { id: 'v3', projection: 'equirect' }), { slot: r.slot }); await settle(60); },
  'native lost its queue': async (r) => { r.fake.emit(STATE(0, { state: 'idle', queue: [], index: 0, positionSec: 0, durationSec: 0 })); await settle(20); },
  'a page restored from the back-forward cache': async (r) => { const e = new r.w.Event('pageshow'); e.persisted = true; r.w.dispatchEvent(e); await settle(20); },
};
for (const [name, end] of Object.entries(END_PATHS)) {
  test('end path, no videoPip arrives: ' + name + ' clears the pressed state, the label and the thumbnail', async () => {
    const r = realm({ caps: PIP_CAPS });
    try {
      await loaded(r);
      r.fake.emit(PIP_ON);
      await settle(20);
      const row = pip(r), lab = label(r), v = r.el(); // the host may leave the document at the close
      assert.strictEqual(row.getAttribute('aria-pressed'), 'true');
      assert.strictEqual(lab.hidden, false);
      await end(r);
      assert.strictEqual(row.getAttribute('aria-pressed'), 'false');
      assert.strictEqual(lab.hidden, true);
      assert.notStrictEqual(v.getAttribute('poster'), '/thumbnail/v1', 'no stuck thumbnail of the floating video');
      assert.notStrictEqual(v.webkitPresentationMode, 'picture-in-picture');
      if (!r.na.owns()) assert.strictEqual(Object.prototype.hasOwnProperty.call(v, 'webkitPresentationMode'), false, 'a detached element answers for itself again');
    } finally { r.close(); }
  });
}

test('a same-video re-open (the SPA nav back to the watch page) is a follow: PiP stays', async () => {
  const r = realm({ caps: PIP_CAPS });
  try {
    await loaded(r);
    r.fake.emit(PIP_ON);
    r.player.dock();
    r.player.load('v1', VIDEO, { slot: r.slot });
    await settle(60);
    assert.strictEqual(r.fake.of('audio.load').length, 1, 'nothing re-sent');
    assert.strictEqual(pip(r).getAttribute('aria-pressed'), 'true');
    assert.strictEqual(r.last().visible, false);
  } finally { r.close(); }
});

test('a start nobody answers: a toast with the reason, the state stays honest; an answered start never toasts', async () => {
  const r = realm({ caps: PIP_CAPS });
  const toasts = []; r.w.showToast = (m) => toasts.push(m);
  try {
    await loaded(r);
    pip(r).click();
    await settle(200);
    r.fake.emit(PIP_ON);
    await settle(3100);
    assert.deepStrictEqual(toasts, [], 'answered');
    r.fake.emit(PIP_OFF);
    pip(r).click();
    await settle(3100);
    assert.deepStrictEqual(toasts, ['Picture-in-picture is not available here (no response)']);
    assert.strictEqual(pip(r).getAttribute('aria-pressed'), 'false');
    assert.strictEqual(labelShown(r), false);
  } finally { r.close(); }
});

// ---- R3 + R4: browsers (no host) ------------------------------------------------------------------------------------------------------
function safari(w, log) {
  const P = w.HTMLVideoElement.prototype;
  let mode = 'inline';
  Object.defineProperty(P, 'webkitPresentationMode', { configurable: true, get: () => mode });
  P.webkitSupportsPresentationMode = (m) => { log.push('supports:' + m); return log.supports !== false; };
  P.webkitSetPresentationMode = function (m) { log.push('set:' + m + ':' + (w.event && w.event.type === 'click' ? 'sync' : 'async')); if (log.throwIt) throw log.throwIt; if (!log.silent) { mode = m; this.dispatchEvent(new w.Event('webkitpresentationmodechanged')); } };
  P.requestPictureInPicture = function () { log.push('standard'); return Promise.resolve(); };
  w.document.pictureInPictureEnabled = true;
  return { setMode(m) { mode = m; } };
}

test('a videoPip answered for no video of ours: a native TRACK or nothing owned never reads as floating, and pipPost refuses without an owned video', async () => {
  const r = realm({ caps: PIP_CAPS });
  try {
    assert.strictEqual(r.na.pipPost('start'), false, 'nothing owned');
    assert.deepStrictEqual(pipPosts(r), []);
    const TRACK = { kind: 'track', id: 't1', src: '/api/offline/file/track/t1', title: 'Song', progress: { route: '/api/music/progress', key: 't1' } };
    r.player.load('t1', { id: 't1', type: 'audio', title: 'Song', nativeQueue: () => ({ items: [TRACK], index: 0 }) }, { slot: r.slot });
    await settle(60);
    assert.strictEqual(r.na.owns('t1'), true, 'native plays the track');
    assert.strictEqual(r.na.surfaceOwned(), false);
    assert.strictEqual(r.na.pipPost('start'), false, 'a track has no PiP');
    assert.deepStrictEqual(pipPosts(r), []);
    r.fake.emit(PIP_ON);
    assert.strictEqual(r.el().webkitPresentationMode, 'inline', 'the proxy of a track stays inline');
    assert.strictEqual(pip(r).getAttribute('aria-pressed'), 'false');
    assert.strictEqual(labelShown(r), false);
  } finally { r.close(); }
});

test('a start answered and ended at once leaves no watchdog behind: no toast after a PiP that really ran', async () => {
  const r = realm({ caps: PIP_CAPS });
  const toasts = []; r.w.showToast = (m) => toasts.push(m);
  try {
    await loaded(r);
    pip(r).click();
    r.fake.emit(PIP_ON);
    r.fake.emit(PIP_OFF);
    await settle(3100);
    assert.deepStrictEqual(toasts, []);
  } finally { r.close(); }
});

test('a fresh page adopting a video already floating: no load, and the row, the label and the surface say so', async () => {
  const r = realm({ caps: PIP_CAPS });
  try {
    r.fake.emit(STATE(0, { state: 'playing' }));
    r.fake.emit(PIP_ON);
    await settle(10);
    r.player.load('v1', VIDEO, { slot: r.slot });
    await settle(80);
    assert.strictEqual(r.fake.of('audio.load').length, 0, 'a follow');
    assert.strictEqual(pip(r).getAttribute('aria-pressed'), 'true');
    assert.strictEqual(labelShown(r), true);
    assert.strictEqual(r.last().visible, false);
  } finally { r.close(); }
});

function touch(r, el, type, x, y) {
  const e = new r.w.Event(type, { bubbles: true, cancelable: true });
  const t = { clientX: x, clientY: y, identifier: 1, target: el };
  e.touches = type === 'touchend' ? [] : [t];
  e.changedTouches = [t];
  el.dispatchEvent(e);
  return e;
}

test('picture touches under PiP (gate r1): the hold never engages, and a pan before a tap never leaves the picture dead', async () => {
  const r = realm({ caps: PIP_CAPS, settings: { mobileCustomPlayer: true } });
  try {
    await loaded(r);
    const v = r.el();
    // a finger already down when PiP starts: its armed hold must not fire
    touch(r, v, 'touchstart', 100, 350);
    r.fake.emit(PIP_ON);
    r.fake.clear();
    await settle(600);
    assert.deepStrictEqual(r.fake.of('audio.setRate'), [], 'no 2x under PiP');
    touch(r, v, 'touchend', 100, 350);
    await settle(450);
    // a pan on the picture, then a tap elsewhere: the tap is judged against its own start
    touch(r, v, 'touchstart', 100, 350); touch(r, v, 'touchmove', 100, 300); touch(r, v, 'touchend', 100, 300);
    await settle(450);
    r.fake.clear();
    touch(r, v, 'touchstart', 200, 350);
    touch(r, v, 'touchmove', 201, 350); // 1 px of jitter
    const end = touch(r, v, 'touchend', 201, 350);
    await settle(450);
    assert.strictEqual(end.defaultPrevented, true, 'the tap is a tap');
    assert.ok(r.fake.types().some((t) => t === 'audio.pause' || t === 'audio.play'), 'and it toggles: ' + r.fake.types().join());
  } finally { r.close(); }
});

test('the watchdog is about the video it was asked of: a close, a pagehide and a new item say nothing; an unanswered stop says so', async () => {
  for (const leave of [(r) => r.player.close(), (r) => r.w.dispatchEvent(new r.w.Event('pagehide')), (r) => r.player.load('v2', Object.assign({}, VIDEO, { id: 'v2' }), { slot: r.slot })]) {
    const r = realm({ caps: PIP_CAPS });
    const toasts = []; r.w.showToast = (m) => toasts.push(m);
    try {
      await loaded(r);
      pip(r).click();
      leave(r);
      await settle(3200);
      assert.deepStrictEqual(toasts, []);
    } finally { r.close(); }
  }
  const r = realm({ caps: PIP_CAPS });
  const toasts = []; r.w.showToast = (m) => toasts.push(m);
  try {
    await loaded(r);
    r.fake.emit(PIP_ON);
    pip(r).click();
    assert.deepStrictEqual(pipPosts(r), ['stop']);
    await settle(3200);
    assert.deepStrictEqual(toasts, ['Picture-in-picture is not available here (no response)']);
    assert.strictEqual(pip(r).getAttribute('aria-pressed'), 'true', 'still only what native says');
  } finally { r.close(); }
});

test('R3 (iPhone Safari shape): the row uses webkitSetPresentationMode inside the click, the event presses it, the row or Apple\'s own control exits; never the standard call', async () => {
  const log = []; let sf;
  const r = realm({ noHost: true, beforeScripts: (w) => { sf = safari(w, log); } });
  const toasts = []; r.w.showToast = (m) => toasts.push(m);
  try {
    r.player.load('v1', VIDEO, { slot: r.slot });
    await settle(60);
    r.el().dispatchEvent(new r.w.Event('loadedmetadata'));
    const row = pip(r);
    assert.strictEqual(row.hidden, false);
    row.click();
    assert.ok(log.includes('set:picture-in-picture:sync'), 'synchronously inside the click: ' + log.join());
    assert.strictEqual(row.getAttribute('aria-pressed'), 'true');
    assert.strictEqual(labelShown(r), false, 'the label is native-only: WebKit draws its own placeholder in the element');
    row.click();
    assert.ok(log.includes('set:inline:sync'));
    assert.strictEqual(row.getAttribute('aria-pressed'), 'false');
    assert.ok(!log.includes('standard'));
    // Apple's own control ends it: the event alone is enough
    row.click();
    sf.setMode('inline'); r.el().dispatchEvent(new r.w.Event('webkitpresentationmodechanged'));
    assert.strictEqual(row.getAttribute('aria-pressed'), 'false');
    assert.deepStrictEqual(toasts, []);
  } finally { r.close(); }
});

test('R3: WebKit\'s silent no-op becomes a toast after the watchdog; a thrown refusal toasts its name at once', async () => {
  const log = [];
  const r = realm({ noHost: true, beforeScripts: (w) => { safari(w, log); } });
  const toasts = []; r.w.showToast = (m) => toasts.push(m);
  try {
    r.player.load('v1', VIDEO, { slot: r.slot });
    await settle(60);
    log.throwIt = Object.assign(new r.w.Error('x'), { name: 'NotAllowedError' });
    pip(r).click();
    assert.deepStrictEqual(toasts, ['Picture-in-picture is not available here (NotAllowedError)']);
    log.throwIt = null; log.silent = true;
    pip(r).click();
    assert.strictEqual(toasts.length, 1, 'not yet');
    await settle(3100);
    assert.strictEqual(toasts[1], 'Picture-in-picture is not available here (no response)');
    assert.strictEqual(toasts.length, 2, 'the first arm did not fire twice');
  } finally { r.close(); }
});

for (const ev of ['emptied', 'loadstart']) {
  test('R3: ' + ev + ' cancels a pending watchdog: no toast about the media the user left', async () => {
    const log = [];
    const r = realm({ noHost: true, beforeScripts: (w) => { safari(w, log); } });
    const toasts = []; r.w.showToast = (m) => toasts.push(m);
    try {
      r.player.load('v1', VIDEO, { slot: r.slot });
      await settle(60);
      log.silent = true;
      pip(r).click();
      r.el().dispatchEvent(new r.w.Event(ev));
      await settle(3100);
      assert.deepStrictEqual(toasts, []);
    } finally { r.close(); }
  });
}

test('R3: WebKit leaving the standard promise unsettled forever is a toast; a row stays up while presenting even if WebKit then says no', async () => {
  const log = []; let sf;
  const r = realm({ noHost: true, desktop: true, beforeScripts: (w) => { sf = safari(w, log); w.HTMLVideoElement.prototype.requestPictureInPicture = () => new Promise(() => {}); } });
  const toasts = []; r.w.showToast = (m) => toasts.push(m);
  try {
    r.player.load('v1', VIDEO, { slot: r.slot });
    await settle(60);
    pip(r).click();
    await settle(3100);
    assert.deepStrictEqual(toasts, ['Picture-in-picture is not available here (no response)']);
    r.w.document.pictureInPictureEnabled = false;
    sf.setMode('picture-in-picture');
    r.el().dispatchEvent(new r.w.Event('webkitpresentationmodechanged'));
    assert.strictEqual(pip(r).hidden, false, 'the way out stays');
  } finally { r.close(); }
});

test('R3: WebKit answers no until media is loading: the row appears on the event, not only at wire time', async () => {
  const log = []; log.supports = false;
  const r = realm({ noHost: true, beforeScripts: (w) => { safari(w, log); w.document.pictureInPictureEnabled = false; } });
  try {
    r.player.load('v1', VIDEO, { slot: r.slot });
    await settle(60);
    assert.strictEqual(pip(r).hidden, true);
    log.supports = true;
    r.el().dispatchEvent(new r.w.Event('loadedmetadata'));
    assert.strictEqual(pip(r).hidden, false);
    log.supports = false;
    r.el().dispatchEvent(new r.w.Event('loadedmetadata'));
    assert.strictEqual(pip(r).hidden, true);
    log.supports = true; // no event this time: opening the cog re-reads it
    r.wrapper().querySelector('#settings-btn').click();
    assert.strictEqual(pip(r).hidden, false, 'the cog is the last check before the row can be seen');
  } finally { r.close(); }
});

test('R3 desktop: the standard call and exit, as ever, with Mac Safari\'s WebKit methods present; a rejection toasts its name; no enabled flag = hidden', async () => {
  const log = [];
  const r = realm({ noHost: true, desktop: true, beforeScripts: (w) => { safari(w, log); } });
  const toasts = []; r.w.showToast = (m) => toasts.push(m);
  try {
    r.player.load('v1', VIDEO, { slot: r.slot });
    await settle(60);
    const row = pip(r);
    assert.strictEqual(row.hidden, false);
    row.click();
    assert.ok(log.includes('standard'));
    assert.ok(!log.some((l) => l.indexOf('set:') === 0), 'never the WebKit call on a desktop');
    await settle(3100);
    assert.deepStrictEqual(toasts, [], 'the resolved promise cancelled the watchdog');
    let exits = 0;
    r.w.document.pictureInPictureElement = r.el();
    r.w.document.exitPictureInPicture = () => { exits += 1; return Promise.resolve(); };
    r.el().dispatchEvent(new r.w.Event('enterpictureinpicture'));
    assert.strictEqual(row.getAttribute('aria-pressed'), 'true');
    row.click();
    assert.strictEqual(exits, 1);
    r.w.document.exitPictureInPicture = () => Promise.reject(Object.assign(new r.w.Error('x'), { name: 'InvalidStateError' }));
    row.click();
    await settle(10);
    assert.deepStrictEqual(toasts, ['Picture-in-picture is not available here (InvalidStateError)'], 'a refused exit says so too');
    toasts.length = 0;
    r.w.document.pictureInPictureElement = null;
    r.el().dispatchEvent(new r.w.Event('leavepictureinpicture'));
    assert.strictEqual(row.getAttribute('aria-pressed'), 'false');
    r.w.HTMLVideoElement.prototype.requestPictureInPicture = () => Promise.reject(Object.assign(new r.w.Error('x'), { name: 'SecurityError' }));
    row.click();
    await settle(10);
    assert.deepStrictEqual(toasts, ['Picture-in-picture is not available here (SecurityError)']);
  } finally { r.close(); }
  const r2 = realm({ noHost: true, desktop: true });
  try {
    r2.player.load('v1', VIDEO, { slot: r2.slot });
    await settle(60);
    assert.strictEqual(pip(r2).hidden, true, 'no pictureInPictureEnabled, as before: AC58');
  } finally { r2.close(); }
});

test('R4: the rotate bounce never kicks a video out of PiP (webkitDisplayingFullscreen is true there), and still bounces Apple\'s full screen', async () => {
  const log = []; let sf;
  const r = realm({ noHost: true, settings: { mobileCustomPlayer: true }, beforeScripts: (w) => { sf = safari(w, log); } }); // the custom bar is where the row lives
  try {
    r.player.load('v1', VIDEO, { slot: r.slot });
    await settle(60);
    assert.strictEqual(r.wrapper().classList.contains('native-controls'), false, 'the bounce only runs in custom mode');
    const v = r.el();
    let exits = 0, displaying = true;
    Object.defineProperty(v, 'webkitDisplayingFullscreen', { configurable: true, get: () => displaying });
    v.webkitExitFullscreen = () => { exits += 1; displaying = false; };
    sf.setMode('picture-in-picture');
    v.dispatchEvent(new r.w.Event('webkitbeginfullscreen'));
    await settle(120);
    assert.strictEqual(exits, 0, 'in PiP: no exit');
    assert.strictEqual(r.wrapper().classList.contains('css-fullscreen'), false, 'no faux armed under it');
    // the retry loop: Apple's player handed over to PiP between two tries
    sf.setMode('fullscreen');
    v.webkitExitFullscreen = () => { exits += 1; sf.setMode('picture-in-picture'); };
    v.dispatchEvent(new r.w.Event('webkitbeginfullscreen'));
    await settle(200);
    assert.strictEqual(exits, 1, 'the first try ran; the rest of the loop stopped when PiP took over');
    assert.strictEqual(r.wrapper().classList.contains('css-fullscreen'), true, 'the control path still armed faux');
  } finally { r.close(); }
});

test('the row\'s labels are CSS on aria-pressed; [hidden] beats the row\'s display (LESSONS: [hidden] loses to any author display rule)', () => {
  const css = fs.readFileSync(path.join(REPO, 'public', 'css', 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(css.includes('#settings-menu #pip-btn[aria-pressed="true"]::before { content: "Exit picture-in-picture"; }'));
  assert.ok(css.includes('#settings-menu #pip-btn[hidden] { display: none; }'));
  assert.ok(/\.player-pip-label\[hidden\],/.test(css));
});
