'use strict';

// [UNIT] v1.376.0 (W4, Dean's ruling R4): the mini player's ROOT SIGNAL. On a phone the handoff card
// ("Listening on <device> / Continue here") spanned the screen on the dock's row and covered it (measured
// at 390: 160 x 132 px of the 134 px dock, every dock control under the card). The card now stacks above
// the dock as a one-line bar, keyed on html.has-player-dock and sized by --player-dock-h, which ONE place
// writes: player.js setDockShown, through which every dock show (dock(), mountInDock()) and every exit
// (hideDock(): close(), an expand back into a slot) passes. This drives the REAL player.js in a jsdom watch
// shell: each show sets both, each exit clears both, always from a POPULATED (docked) state (LESSONS 4:
// reveal and clear are two axes; a clear test on an element born hidden is vacuous). The pixels (the bar
// above the dock, every control hittable) are measured in a real engine by test/geometry/handoff-dock.js.

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

// A recording ResizeObserver: the test fires its callback after changing the dock's measured height.
function fakeResizeObserver(w, log) {
  w.ResizeObserver = class {
    constructor(cb) { this.cb = cb; this.targets = []; this.disconnected = false; log.push(this); }
    observe(el) { this.targets.push(el); }
    unobserve() {}
    disconnect() { this.disconnected = true; }
  };
}

async function boot(o) {
  const opt = o || {};
  dom = new JSDOM(WATCH, { url: 'http://localhost/watch.html?v=v1', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  Object.defineProperty(w.navigator, 'platform', { value: 'iPhone' });
  w.matchMedia = (q) => ({ media: q, matches: /coarse|hover: none|max-width/.test(q), addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  w.fetch = async () => ({ ok: true, status: 200, json: async () => ({ mobileCustomPlayer: true }), text: async () => '' });
  w.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
  w.HTMLMediaElement.prototype.pause = function () {};
  w.HTMLMediaElement.prototype.load = function () {};
  w.scrollTo = () => {};
  const observers = [];
  if (!opt.noResizeObserver) fakeResizeObserver(w, observers);
  w.document.body.setAttribute('data-view', 'watch');
  w.eval(COMMON_SRC.slice(COMMON_SRC.indexOf('function resolveAudioArtUrl('), COMMON_SRC.indexOf('\n}\n', COMMON_SRC.indexOf('function resolveAudioArtUrl(')) + 3));
  w.eval(LOCK_SRC);
  w.eval(PLAYER_SRC);
  const dockEl = w.document.getElementById('player-dock');
  let dockH = 133.4;
  dockEl.getBoundingClientRect = () => ({ left: 222, top: 630, x: 222, y: 630, width: 160, height: dockH, right: 382, bottom: 630 + dockH });
  const slot = w.document.createElement('div'); slot.id = 'player-slot'; w.document.body.appendChild(slot);
  const p = w.FileTube.player;
  assert.strictEqual(p.load('v1', { id: 'v1', title: 'T', type: 'video', ext: '.mp4' }, { slot }), true, 'the real player loaded the item');
  await wait(30);
  const root = w.document.documentElement;
  const read = () => ({
    cls: root.classList.contains('has-player-dock'),
    h: root.style.getPropertyValue('--player-dock-h'),
    hidden: dockEl.hidden,
    state: p.getState(),
  });
  // Only the observers of the dock itself (player.js runs other observers, the seek bar's chapter ticks).
  const dockObservers = () => observers.filter((ob) => ob.targets.includes(dockEl));
  return { w, p, slot, dockEl, root, read, dockObservers, setDockH: (v) => { dockH = v; } };
}

test('FULL in the slot: no signal (the dock is hidden, nothing to stack above)', async () => {
  const h = await boot();
  assert.deepStrictEqual(h.read(), { cls: false, h: '', hidden: true, state: 'full' });
});

test('dock(): the class and the dock height (ceil of its rendered height) are set, and an observer follows the dock', async () => {
  const h = await boot();
  h.p.dock();
  assert.deepStrictEqual(h.read(), { cls: true, h: '134px', hidden: false, state: 'docked' });
  assert.strictEqual(h.dockObservers().length, 1, 'one observer of the dock');
  assert.deepStrictEqual(h.dockObservers()[0].targets, [h.dockEl], 'it observes the dock alone');
  // The dock's height follows the item (aspect ratio, audio mode): the observer re-measures.
  h.setDockH(181.2);
  h.dockObservers()[0].cb([]);
  assert.strictEqual(h.read().h, '182px');
});

test('close() from the docked state clears the class AND the height, and lets the observer go (the X on the mini player, a Delete)', async () => {
  const h = await boot();
  h.p.dock();
  assert.strictEqual(h.read().cls, true, 'populated first');
  h.p.close();
  assert.deepStrictEqual(h.read(), { cls: false, h: '', hidden: true, state: 'closed' });
  assert.strictEqual(h.dockObservers()[0].disconnected, true);
});

test('expand back into a slot (the dock tap, a navigation to the watch page) clears the class AND the height', async () => {
  const h = await boot();
  h.p.dock();
  assert.strictEqual(h.read().cls, true, 'populated first');
  h.p.expand(h.slot);
  assert.deepStrictEqual(h.read(), { cls: false, h: '', hidden: true, state: 'full' });
  assert.strictEqual(h.dockObservers()[0].disconnected, true);
});

test('dock -> expand -> dock: the signal comes back on the second show, with a fresh observer', async () => {
  const h = await boot();
  h.p.dock();
  h.p.expand(h.slot);
  h.p.dock();
  assert.deepStrictEqual(h.read(), { cls: true, h: '134px', hidden: false, state: 'docked' });
  assert.strictEqual(h.dockObservers().length, 2, 'the first observer was let go, a second one follows the shown dock');
  assert.deepStrictEqual(h.dockObservers().map((ob) => ob.disconnected), [true, false]);
});

test('a fresh load straight into the dock (mountInDock, the browse-while-playing path) sets the signal; its close clears it', async () => {
  const h = await boot();
  h.p.close();
  assert.strictEqual(h.read().cls, false);
  assert.strictEqual(h.p.load('v2', { id: 'v2', title: 'T2', type: 'video', ext: '.mp4' }, { dock: true }), true);
  await wait(30);
  assert.deepStrictEqual(h.read(), { cls: true, h: '134px', hidden: false, state: 'docked' });
  h.p.close();
  assert.deepStrictEqual(h.read(), { cls: false, h: '', hidden: true, state: 'closed' });
});

test('no ResizeObserver (an old engine): the show still writes the class and one measured height; the exit still clears both', async () => {
  const h = await boot({ noResizeObserver: true });
  h.p.dock();
  assert.deepStrictEqual(h.read(), { cls: true, h: '134px', hidden: false, state: 'docked' });
  h.p.close();
  assert.deepStrictEqual(h.read(), { cls: false, h: '', hidden: true, state: 'closed' });
});

test('the dock\'s [hidden] has ONE writer: no other assignment of it is left in player.js', () => {
  const src = PLAYER_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const writes = src.match(/\bdockEl\.hidden\s*=(?!=)/g) || [];
  assert.strictEqual(writes.length, 1, 'only setDockShown assigns the dock\'s hidden (found ' + writes.length + ')');
  assert.match(src, /function setDockShown\(dockEl, shown\) \{\s*if \(!dockEl\) return;\s*dockEl\.hidden = !shown;/);
});
