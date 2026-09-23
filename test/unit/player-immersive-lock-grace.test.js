'use strict';

// [UNIT] v1.311.2 - the REAL player.js, run in a jsdom window with the real watch
// shell, driven through its real controls. Binds three of Dean's iPhone reports
// by REACHABILITY (the source-lock tests before this could not):
//   #2 faux fullscreen + the expanded audio view take the SHARED iOS body lock
//      (body-scroll-lock.js) - and the old scroll-keeper rules still hold: only
//      the exit button restores; a dock/teardown exit lands where the navigation
//      put the page; a skin that already holds the lock is never clobbered.
//   #3 a touch that wakes the HIDDEN bar keeps it untappable for DOUBLE_TAP_MS.
//   #4 the ±15s buttons are gone, and double-tap seek + its ripple still work.

const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const PUB = path.join(__dirname, '..', '..', 'public');
const LOCK_SRC = fs.readFileSync(path.join(PUB, 'js', 'body-scroll-lock.js'), 'utf8');
const COMMON_SRC = fs.readFileSync(path.join(PUB, 'js', 'common.js'), 'utf8');
const PLAYER_SRC = fs.readFileSync(path.join(PUB, 'js', 'player.js'), 'utf8');
const WATCH = fs.readFileSync(path.join(PUB, 'watch.html'), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');

let dom = null;
afterEach(() => { if (dom) { dom.window.close(); dom = null; } });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// An iPhone-shaped window with the custom player ON (mobileCustomPlayer), the
// page scrolled to `y`, and the real player loaded with `item`.
async function bootPlayer(item, y) {
  dom = new JSDOM(WATCH, { url: 'http://localhost/watch.html?v=' + item.id, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  Object.defineProperty(w.navigator, 'platform', { value: 'iPhone' });
  w.matchMedia = (q) => ({ matches: /coarse|hover: none|max-width/.test(q), addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  w.fetch = async () => ({ ok: true, status: 200, json: async () => ({ mobileCustomPlayer: true }), text: async () => '' });
  w.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
  w.HTMLMediaElement.prototype.pause = function () {};
  w.HTMLMediaElement.prototype.load = function () {};
  let sy = y;
  const scrolls = [];
  // Like iOS: a PINNED body (position:fixed) reads scroll 0 - so any code that reads
  // raw window scroll under the lock is exposed here (QA r1 S5).
  const readY = () => (w.document.body && w.document.body.style.position === 'fixed' ? 0 : sy);
  Object.defineProperty(w, 'pageYOffset', { get: readY, configurable: true });
  Object.defineProperty(w, 'scrollY', { get: readY, configurable: true });
  w.scrollTo = (_x, ny) => { scrolls.push(ny); sy = ny; };
  // common.js's art resolver (a global in the browser; common.js itself is not booted here).
  w.eval(COMMON_SRC.slice(COMMON_SRC.indexOf('function resolveAudioArtUrl('), COMMON_SRC.indexOf('\n}\n', COMMON_SRC.indexOf('function resolveAudioArtUrl(')) + 3));
  w.eval(LOCK_SRC);
  w.eval(PLAYER_SRC);
  const slot = w.document.createElement('div'); slot.id = 'player-slot'; w.document.body.appendChild(slot);
  const p = w.FileTube.player;
  assert.strictEqual(p.load(item.id, item, { slot }), true, 'the real player loaded the item');
  await wait(30); // the settings fetch resolves -> custom-player mode
  const doc = w.document;
  return { w, doc, p, scrolls, host: doc.getElementById('player-wrapper'), fsBtn: doc.getElementById('fs-btn'), BL: w.FileTubeBodyLock, setY: (n) => { sy = n; } };
}
const VIDEO = { id: 'v1', title: 'T', type: 'video', ext: '.mp4' };

// ---- #2: the shared body lock ------------------------------------------------

test('#2 faux fullscreen: the real #fs-btn pins the body (position:fixed at -Y); the exit button unpins and restores Y once', async () => {
  const { doc, fsBtn, host, scrolls, BL } = await bootPlayer(VIDEO, 420);
  fsBtn.click();
  assert.ok(host.classList.contains('css-fullscreen'), 'precondition: FAUX fullscreen (custom player on a phone)');
  assert.strictEqual(doc.body.style.position, 'fixed', 'the iOS lock is taken - overflow:hidden alone never held');
  assert.strictEqual(doc.body.style.top, '-420px');
  assert.strictEqual(BL.holds(doc, 'faux-fullscreen'), true);
  fsBtn.click();
  assert.ok(!host.classList.contains('css-fullscreen'));
  assert.strictEqual(doc.body.style.position, '', 'released on exit');
  assert.deepStrictEqual(scrolls, [420], 'the exit button puts the page back exactly once');
});

test('#2 faux fullscreen: a DOCK exit unpins WITHOUT restoring the old page\'s scroll (gate C1 preserved)', async () => {
  const { doc, p, fsBtn, scrolls } = await bootPlayer(VIDEO, 420);
  fsBtn.click();
  p.dock();
  assert.strictEqual(doc.body.style.position, '', 'the dock releases the lock');
  assert.deepStrictEqual(scrolls, [], 'no restore onto wherever the navigation is taking us');
});

test('#2 a navigation placed while locked wins the release (the router\'s scrollTo is deferred, not clamped away)', async () => {
  const { doc, p, fsBtn, scrolls, BL } = await bootPlayer(VIDEO, 420);
  fsBtn.click();
  BL.scrollTo(doc, doc.defaultView, 900); // common.js placePageScroll during a swap under the overlay
  p.dock();
  assert.deepStrictEqual(scrolls, [900], 'the page lands where the router put it');
});

test('#2 a skin that ALREADY holds the lock is never clobbered: faux captures the REAL scroll, and the body stays pinned for the skin', async () => {
  const { doc, w, fsBtn, scrolls, BL, setY } = await bootPlayer(VIDEO, 300);
  BL.lock(doc, w, 'skin-ghost:1');
  setY(0); // what a pinned body reads
  fsBtn.click();
  fsBtn.click(); // exit (restoreScroll)
  assert.strictEqual(doc.body.style.position, 'fixed', 'the skin still owns the body');
  assert.deepStrictEqual(scrolls, [], 'no scroll while another owner pins it');
  BL.release(doc, w, 'skin-ghost:1');
  assert.deepStrictEqual(scrolls, [300], 'the real pre-entry scroll (300), never the pinned 0');
});

test('#2 expanded audio view: expanding pins the body, collapsing unpins and restores', async () => {
  const { doc, host, fsBtn, scrolls } = await bootPlayer({ id: 'a1', title: 'Song', type: 'audio', ext: '.mp3', hasThumbnail: true }, 250);
  assert.ok(host.classList.contains('audio-mode'), 'precondition: the art surface is up');
  fsBtn.click();
  assert.ok(host.classList.contains('audio-expanded'), 'precondition: expanded');
  assert.ok(doc.body.classList.contains('ft-audio-expanded'));
  assert.strictEqual(doc.body.style.position, 'fixed');
  assert.strictEqual(doc.body.style.top, '-250px');
  fsBtn.click();
  assert.ok(!host.classList.contains('audio-expanded'));
  assert.strictEqual(doc.body.style.position, '');
  assert.deepStrictEqual(scrolls, [250]);
});

// ---- #3: the tap-reveal grace ------------------------------------------------

function playing(w) {
  const v = w.document.getElementById('media-player');
  Object.defineProperty(v, 'paused', { value: false, configurable: true });
  return v;
}
function touchDown(w, el) {
  const Ctor = w.PointerEvent || w.Event;
  const e = new Ctor(w.PointerEvent ? 'pointerdown' : 'touchstart', { bubbles: true, cancelable: true });
  if (w.PointerEvent) Object.defineProperty(e, 'pointerType', { value: 'touch' });
  el.dispatchEvent(e);
}

test('#3 a touch that wakes the HIDDEN bar keeps it untappable for DOUBLE_TAP_MS, then it is tappable again', async () => {
  const { w, host, fsBtn } = await bootPlayer(VIDEO, 0);
  fsBtn.click();
  const v = playing(w);
  host.classList.add('controls-autohidden'); // the bar has faded
  touchDown(w, v);
  assert.ok(!host.classList.contains('controls-autohidden'), 'the tap reveals the bar');
  assert.ok(host.classList.contains('controls-reveal-grace'), 'but it cannot be hit yet - the second tap of a double-tap passes through');
  await wait(200);
  assert.ok(host.classList.contains('controls-reveal-grace'), 'still inside the 350ms double-tap window');
  await wait(180); // 380ms: past DOUBLE_TAP_MS (350), so the window is pinned, not just "some time"
  assert.ok(!host.classList.contains('controls-reveal-grace'), 'the bar is tappable once the 350ms window closes');
});

test('#3 no grace when the bar was already visible (a deliberate bar tap is never delayed)', async () => {
  const { w, host, fsBtn } = await bootPlayer(VIDEO, 0);
  fsBtn.click();
  const v = playing(w);
  touchDown(w, v);
  assert.ok(!host.classList.contains('controls-reveal-grace'));
});

test('#3 a MOUSE press never arms the grace (desktop never double-taps)', async (t) => {
  const { w, host, fsBtn } = await bootPlayer(VIDEO, 0);
  if (!w.PointerEvent) { t.skip('no PointerEvent in this jsdom - the listener is touchstart-only'); return; }
  fsBtn.click();
  const v = playing(w);
  host.classList.add('controls-autohidden');
  const e = new w.PointerEvent('pointerdown', { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'pointerType', { value: 'mouse' });
  v.dispatchEvent(e);
  assert.ok(!host.classList.contains('controls-autohidden'), 'the click still reveals');
  assert.ok(!host.classList.contains('controls-reveal-grace'), 'but never delays the bar');
});

test('#3 exiting fullscreen clears a live grace (it never outlives the overlay)', async () => {
  const { w, host, fsBtn } = await bootPlayer(VIDEO, 0);
  fsBtn.click();
  const v = playing(w);
  host.classList.add('controls-autohidden');
  touchDown(w, v);
  assert.ok(host.classList.contains('controls-reveal-grace'));
  fsBtn.click();
  assert.ok(!host.classList.contains('controls-reveal-grace'));
});

test('#3 CSS: the grace class takes the bar AND its controls out of hit-testing', () => {
  const css = fs.readFileSync(path.join(PUB, 'css', 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(css, /#player-wrapper\.controls-reveal-grace \.player-controls,\s*#player-wrapper\.controls-reveal-grace \.player-controls \*\s*\{\s*pointer-events:\s*none !important;\s*\}/);
});

// ---- #4: the ±15s buttons are gone; double-tap seek stays ---------------------

test('#4 no shell carries the ±15s buttons; every shell that has the gesture layer keeps both ripples', () => {
  const dirs = [PUB, path.join(__dirname, '..', '..', 'lib', 'ytdlp', 'views')];
  let layers = 0;
  for (const dir of dirs) {
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.html'))) {
      const h = fs.readFileSync(path.join(dir, f), 'utf8');
      assert.doesNotMatch(h, /skip-back-btn|skip-fwd-btn|class="skip-btn/, `${f} still ships a skip button`);
      if (h.includes('id="skip-controls"')) {
        layers += 1;
        assert.match(h, /id="skip-ripple-left"/, `${f}: left ripple`);
        assert.match(h, /id="skip-ripple-right"/, `${f}: right ripple`);
      }
    }
  }
  assert.ok(layers >= 10, `the census walked the player shells (saw ${layers})`);
  const src = PLAYER_SRC.replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(src, /skipBackBtn|skipFwdBtn|revealSkipButtons|hideSkipButtons|skip-visible/, 'no dead skip-button code left in player.js');
});

test('#4 double-tap on the right half still seeks +15s and flashes the ripple', async () => {
  const { w, doc } = await bootPlayer(VIDEO, 0);
  const v = doc.getElementById('media-player');
  Object.defineProperty(v, 'duration', { value: 600, configurable: true });
  let t = 100;
  Object.defineProperty(v, 'currentTime', { get: () => t, set: (n) => { t = n; }, configurable: true });
  v.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 225, right: 400, bottom: 225 });
  const touch = (type, x) => {
    const e = new w.Event(type, { bubbles: true, cancelable: true });
    const list = [{ clientX: x, clientY: 100 }];
    Object.defineProperty(e, 'touches', { value: type === 'touchend' ? [] : list });
    Object.defineProperty(e, 'changedTouches', { value: list });
    v.dispatchEvent(e);
  };
  touch('touchstart', 350); touch('touchend', 350);
  await wait(40); // a real human gap (the classifier needs gap > 0, < DOUBLE_TAP_MS)
  touch('touchstart', 350); touch('touchend', 350);
  assert.strictEqual(t, 115, 'a right-side double-tap skips forward 15s');
  assert.ok(doc.getElementById('skip-ripple-right').classList.contains('active'), 'and the ripple shows');
});

// ---- r1 gate fixes -----------------------------------------------------------

test('gate W1 (adversary): close() from faux fullscreen releases the body - no pinned page, class gone', async () => {
  const { doc, p, fsBtn, host, BL } = await bootPlayer(VIDEO, 420);
  fsBtn.click();
  assert.strictEqual(doc.body.style.position, 'fixed', 'precondition: locked');
  p.close();
  assert.strictEqual(doc.body.style.position, '', 'a closed player never leaves the page pinned');
  assert.ok(!doc.body.classList.contains('ft-css-fullscreen'), 'the body class is gone (header/nav back, swipe-back live)');
  assert.ok(!host.classList.contains('css-fullscreen'));
  assert.strictEqual(BL.isLocked(doc), false);
});

function tapVideo(w, v, x) {
  touchDown(w, v); // the pointerdown the reveal/grace listens to
  const mk = (type) => {
    const e = new w.Event(type, { bubbles: true, cancelable: true });
    const list = [{ clientX: x, clientY: 100 }];
    Object.defineProperty(e, 'touches', { value: type === 'touchend' ? [] : list });
    Object.defineProperty(e, 'changedTouches', { value: list });
    return e;
  };
  return { start: () => v.dispatchEvent(mk('touchstart')), end: () => v.dispatchEvent(mk('touchend')) };
}

test('gate W3 (adversary): a skip-CHAIN tap re-arms the grace (tap 3+ lands with the bar already up)', async () => {
  const { w, doc, host, fsBtn } = await bootPlayer(VIDEO, 0);
  fsBtn.click();
  const v = playing(w);
  Object.defineProperty(v, 'duration', { value: 600, configurable: true });
  v.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 225, right: 400, bottom: 225 });
  host.classList.add('controls-autohidden');
  let t1 = tapVideo(w, v, 350); t1.start(); t1.end();
  await wait(40);
  const t2 = tapVideo(w, v, 350); t2.start(); t2.end(); // the double-tap: a skip, the chain is now hot
  await wait(400); // tap 2's grace has expired; the chain (800ms) is still hot
  assert.ok(!host.classList.contains('controls-reveal-grace'), 'precondition: no grace left from the pair');
  assert.ok(!host.classList.contains('controls-autohidden'), 'precondition: the bar is UP (not hidden) for the chain tap');
  t1 = tapVideo(w, v, 350);
  assert.ok(host.classList.contains('controls-reveal-grace'), 'the chain tap re-armed the grace - it cannot hit #fs-btn');
  assert.ok(doc.getElementById('fs-btn'));
});

test('gate W3 (adversary): a double-tap whose FIRST touch was held keeps the grace for the second tap', async () => {
  const { w, host, fsBtn } = await bootPlayer(VIDEO, 0);
  fsBtn.click();
  const v = playing(w);
  v.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 225, right: 400, bottom: 225 });
  host.classList.add('controls-autohidden');
  const t1 = tapVideo(w, v, 350); t1.start();
  await wait(300); t1.end(); // held: touch-down at 0, touch-end at ~300
  await wait(150); // second touch-down at ~450: past the first grace (350) but inside DOUBLE_TAP_MS of the first touch-END
  assert.ok(!host.classList.contains('controls-reveal-grace'), 'precondition: the first grace expired');
  tapVideo(w, v, 350);
  assert.ok(host.classList.contains('controls-reveal-grace'), 'the second half of the double-tap is still shielded');
});
