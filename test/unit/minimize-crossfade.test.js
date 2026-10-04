'use strict';

// [UNIT] v1.362.4 (plan 2026-10-04-minimize-crossfade, Dean's rulings F1-F3) - the page under the video fades like
// YouTube's when it minimizes and expands. The REAL player.js is driven in a jsdom watch shell (the minimize-player
// harness shape) through the real pull, the arrow and the mini player's tap; the CSS is locked by selector, so no rule
// can ever fade an ancestor of the video (LESSONS 7, the v1.312 class).

const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const PUB = path.join(__dirname, '..', '..', 'public');
const LOCK_SRC = fs.readFileSync(path.join(PUB, 'js', 'body-scroll-lock.js'), 'utf8');
const COMMON_SRC = fs.readFileSync(path.join(PUB, 'js', 'common.js'), 'utf8');
const PLAYER_SRC = fs.readFileSync(path.join(PUB, 'js', 'player.js'), 'utf8');
const CSS = fs.readFileSync(path.join(PUB, 'css', 'style.css'), 'utf8');
const WATCH = fs.readFileSync(path.join(PUB, 'watch.html'), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');

let dom = null;
afterEach(() => { if (dom) { dom.window.close(); dom = null; } });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const HOLD = 200; // the drive's VIEW_FADE_HOLD_MS (the real 4000 is asserted below)

async function boot(item, o) {
  const opt = o || {};
  dom = new JSDOM(WATCH, { url: 'http://localhost/watch.html?v=' + item.id + (opt.query || ''), runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  Object.defineProperty(w.navigator, 'platform', { value: opt.desktop ? 'Win32' : 'iPhone' });
  w.matchMedia = (q) => ({ media: q, matches: opt.desktop ? false : (/prefers-reduced-motion/.test(q) ? !!opt.reduced : /coarse|hover: none|max-width/.test(q)), addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  Object.defineProperty(w, 'innerHeight', { value: 664, configurable: true });
  Object.defineProperty(w, 'innerWidth', { value: 390, configurable: true });
  w.fetch = async () => ({ ok: true, status: 200, json: async () => ({ mobileCustomPlayer: true }), text: async () => '' });
  w.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
  w.HTMLMediaElement.prototype.pause = function () {};
  w.HTMLMediaElement.prototype.load = function () {};
  w.scrollTo = () => {};
  w.document.body.setAttribute('data-view', 'watch');
  w.eval(COMMON_SRC.slice(COMMON_SRC.indexOf('function resolveAudioArtUrl('), COMMON_SRC.indexOf('\n}\n', COMMON_SRC.indexOf('function resolveAudioArtUrl(')) + 3));
  w.eval(LOCK_SRC);
  const NEEDLE = 'var VIEW_FADE_HOLD_MS = 4000;';
  assert.strictEqual(PLAYER_SRC.split(NEEDLE).length, 2, 'the hold constant is defined once');
  w.eval(PLAYER_SRC.replace(NEEDLE, 'var VIEW_FADE_HOLD_MS = ' + HOLD + ';'));
  const leaves = []; const navs = [];
  w.FileTube.leaveWatchForBrowse = () => { leaves.push(1); };
  w.FileTube.navigate = (u) => { navs.push(u); };
  const dockEl = w.document.getElementById('player-dock');
  dockEl.style.right = '8px'; dockEl.style.bottom = '80px'; dockEl.style.width = '160px'; dockEl.style.setProperty('--size-touch', '44px');
  const slot = w.document.getElementById('player-slot');
  const p = w.FileTube.player;
  assert.strictEqual(p.load(item.id, item, { slot }), true);
  await wait(60);
  const v = w.document.getElementById('media-player');
  const host = w.document.getElementById('player-wrapper');
  Object.defineProperty(v, 'paused', { value: false, configurable: true });
  const rect = { left: 0, top: 0, x: 0, y: 0, width: 390, height: 260, right: 390, bottom: 260 };
  v.getBoundingClientRect = () => rect;
  host.getBoundingClientRect = () => (host.parentNode === slot ? rect : { left: 222, top: 450, x: 222, y: 450, width: 160, height: 134, right: 382, bottom: 584 });
  const root = w.document.getElementById('view-root');
  const html = w.document.documentElement;
  return { w, doc: w.document, p, v, host, slot, root, html, leaves, navs, dockEl };
}
const VIDEO = { id: 'v1', title: 'T', type: 'video', ext: '.mp4' };

function ev(w, type, x, y, stamp) {
  const e = new w.Event(type, { bubbles: true, cancelable: true });
  const list = [{ clientX: x, clientY: y }];
  Object.defineProperty(e, 'touches', { value: type === 'touchend' || type === 'touchcancel' ? [] : list });
  Object.defineProperty(e, 'changedTouches', { value: list });
  if (stamp !== undefined) Object.defineProperty(e, 'timeStamp', { value: stamp });
  return e;
}
const fire = (w, el, type, x, y, stamp) => { const e = ev(w, type, x, y, stamp); el.dispatchEvent(e); return e; };
function pull(h, dy) {
  const x = 200, y0 = 100; let t = 1000;
  fire(h.w, h.v, 'touchstart', x, y0, t);
  for (let d = 10; d <= dy; d += 10) { t += 40; fire(h.w, h.v, 'touchmove', x, y0 + d, t); }
  return { x, y: y0 + dy, t };
}
const fade = (h) => h.root.style.getPropertyValue('--minimize-fade');
const travelOf = () => 664 - 80 - (160 * 9 / 16 + 44);

test('the pull: the page under the video follows the finger (--minimize-fade = the pull\'s progress, no easing)', async () => {
  const h = await boot(VIDEO);
  pull(h, 100);
  assert.ok(h.root.classList.contains('is-minimize-fading'));
  assert.ok(!h.root.classList.contains('is-minimize-fade-ease'), 'the finger drives it');
  const p = Number(fade(h));
  assert.ok(Math.abs(p - 100 / travelOf()) < 0.02, 'progress ' + p + ' ~ ' + (100 / travelOf()));
});

test('a spring-back eases the page back up, then removes the fade', async () => {
  const h = await boot(VIDEO);
  const g = pull(h, 60);
  assert.ok(Number(fade(h)) > 0);
  fire(h.w, h.v, 'touchend', g.x, g.y, g.t + 10);
  assert.strictEqual(fade(h), '0', 'eases to 0');
  assert.ok(h.root.classList.contains('is-minimize-fade-ease'));
  await wait(450);
  assert.strictEqual(fade(h), '', 'gone after the snap');
  assert.ok(!h.root.classList.contains('is-minimize-fading'));
});

test('a commit (pull past the threshold): the watch page holds at its floor (1, eased) and the next page is marked to fade in; the mark ends', async () => {
  const h = await boot(VIDEO);
  const g = pull(h, 200);
  fire(h.w, h.v, 'touchend', g.x, g.y, g.t + 10);
  assert.strictEqual(h.p.getState(), 'docked');
  assert.strictEqual(h.leaves.length, 1);
  assert.strictEqual(fade(h), '1', 'held at the floor while it leaves (not flashed back by the dock)');
  assert.ok(h.root.classList.contains('is-minimize-fade-ease'));
  assert.strictEqual(h.html.getAttribute('data-ft-view-fade'), 'arrive');
  await wait(HOLD + 50);
  assert.strictEqual(h.html.getAttribute('data-ft-view-fade'), null, 'the mark ends');
  assert.strictEqual(fade(h), '', 'a page that never left is restored');
});

test('the arrow: the same leave, eased from full', async () => {
  const h = await boot(VIDEO);
  Object.defineProperty(h.v, 'paused', { value: true, configurable: true });
  h.v.dispatchEvent(new h.w.Event('pause'));
  const chev = h.host.querySelector('.player-minimize');
  assert.ok(chev && !chev.hidden, 'precondition: the arrow shows while paused');
  chev.dispatchEvent(new h.w.MouseEvent('click', { bubbles: true }));
  assert.strictEqual(h.p.getState(), 'docked');
  assert.strictEqual(fade(h), '1');
  assert.ok(h.root.classList.contains('is-minimize-fade-ease'));
  assert.strictEqual(h.html.getAttribute('data-ft-view-fade'), 'arrive');
});

test('a close or a new load mid-pull removes the fade (the one remover)', async () => {
  const h = await boot(VIDEO);
  pull(h, 80);
  assert.ok(Number(fade(h)) > 0);
  h.p.close();
  assert.strictEqual(fade(h), '');
  assert.ok(!h.root.classList.contains('is-minimize-fading'));
});

test('expand: a tap on the mini player dims the page it leaves (is-view-leaving) and marks the watch page to fade in; the class is gone after the hold (a cached home comes back clean)', async () => {
  const h = await boot(VIDEO);
  h.p.dock();
  h.root.setAttribute('data-view', 'home'); // the browse page the mini player floats over
  h.dockEl.dispatchEvent(new h.w.MouseEvent('click', { bubbles: true }));
  assert.deepStrictEqual(h.navs, ['/watch.html?v=v1']);
  assert.ok(h.root.classList.contains('is-view-leaving'));
  assert.strictEqual(h.html.getAttribute('data-ft-view-fade'), 'arrive');
  await wait(HOLD + 50);
  assert.ok(!h.root.classList.contains('is-view-leaving'), 'the marked node is restored even after it left');
  assert.strictEqual(h.html.getAttribute('data-ft-view-fade'), null);
});

test('no fade where it does not belong: reduced motion, ?minimizeAnim=0, a reader/music return, a desktop dock', async () => {
  let h = await boot(VIDEO, { reduced: true });
  let g = pull(h, 200);
  fire(h.w, h.v, 'touchend', g.x, g.y, g.t + 10);
  assert.strictEqual(h.p.getState(), 'docked', 'precondition: it still minimizes');
  assert.strictEqual(fade(h), '');
  assert.strictEqual(h.html.getAttribute('data-ft-view-fade'), null, 'reduced motion');
  h.root.setAttribute('data-view', 'home');
  h.dockEl.dispatchEvent(new h.w.MouseEvent('click', { bubbles: true }));
  assert.ok(!h.root.classList.contains('is-view-leaving'), 'reduced motion: no expand fade');
  dom.window.close(); dom = null;
  h = await boot(VIDEO, { query: '&minimizeAnim=0' });
  g = pull(h, 200);
  fire(h.w, h.v, 'touchend', g.x, g.y, g.t + 10);
  assert.strictEqual(h.p.getState(), 'docked');
  assert.strictEqual(h.html.getAttribute('data-ft-view-fade'), null, '?minimizeAnim=0');
  dom.window.close(); dom = null;
  h = await boot(Object.assign({}, VIDEO, { readerHref: '/music?nowplaying=1' }));
  h.p.dock();
  h.root.setAttribute('data-view', 'home');
  h.dockEl.dispatchEvent(new h.w.MouseEvent('click', { bubbles: true }));
  assert.ok(!h.root.classList.contains('is-view-leaving'), 'a music / reader return never fades');
  dom.window.close(); dom = null;
  h = await boot(VIDEO, { desktop: true });
  h.p.dock();
  h.root.setAttribute('data-view', 'home');
  h.dockEl.dispatchEvent(new h.w.MouseEvent('click', { bubbles: true }));
  assert.ok(!h.root.classList.contains('is-view-leaving'), 'desktop');
});

test('the real hold is 4 s, and the fade code never writes to the media or the host\'s paint', () => {
  assert.match(PLAYER_SRC, /var VIEW_FADE_HOLD_MS = 4000;/);
  const a = PLAYER_SRC.indexOf('// ---- v1.362.4: the page under the video fades');
  const b = PLAYER_SRC.indexOf('\n  }\n', PLAYER_SRC.indexOf('function markViewArrival('));
  const code = PLAYER_SRC.slice(a, b).replace(/\/\/.*$/gm, '');
  assert.ok(a > 0 && b > a);
  assert.ok(!/host\.style|mediaPlayer\.|opacity|filter/.test(code), 'only classes, one custom property and the <html> mark');
});

// ---- CSS: never an ancestor of the video (LESSONS 7) ------------------------------------------------------

function rulesWith(prop) {
  const out = [];
  const css = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) { if (new RegExp('(^|[;\\s])' + prop + '\\s*:').test(m[2])) out.push({ sel: m[1].trim(), body: m[2] }); }
  return out;
}

test('the crossfade rules are exactly the planned selectors', () => {
  assert.ok(CSS.includes('#view-root[data-view="watch"] .watch-main > :not(:has(#player-slot)),\n#view-root[data-view="watch"] .watch-sidebar {\n  opacity: calc(1 - 0.6 * var(--minimize-fade, 0));\n}'));
  assert.ok(CSS.includes('#view-root:not([data-view="watch"]):not(:has(#player-wrapper)).is-view-leaving {\n  opacity: 0.4;\n  transition: opacity var(--dur-fade) var(--ease-std);\n}'));
  assert.ok(CSS.includes('  animation: ft-view-arrive var(--dur-sheet) var(--ease-enter);'));
  assert.ok(/@keyframes ft-view-arrive \{\n {2}from \{ opacity: 0\.4; \}\n {2}to \{ opacity: 1; \}\n\}/.test(CSS));
});

test('no opacity or animation rule paints the video or any of its watch-page ancestors; a whole-root fade always excludes the watch page and a root that holds the player', () => {
  const ancestors = ['#player-wrapper', '#player-slot', '.watch-player-stage', '.watch-main', '.watch-container'];
  let checked = 0;
  for (const prop of ['opacity', 'animation']) {
    for (const r of rulesWith(prop)) {
      for (const sel of r.sel.split(',').map((x) => x.trim()).filter(Boolean)) {
        const subject = sel.split(/\s*>\s*|\s+/).filter(Boolean).pop();
        const own = subject.replace(/:not\((?:[^()]|\([^()]*\))*\)/g, ''); // what the subject IS, not what it excludes
        for (const a of ancestors) {
          const re = new RegExp(a.replace(/[.#]/g, '\\$&') + '(?![\\w-])');
          assert.ok(!re.test(own), prop + ' paints ' + a + ' via "' + sel + '"');
        }
        if (/^#view-root/.test(own)) {
          checked++;
          assert.ok(!/\[data-view="watch"\]/.test(own), 'never the watch #view-root: ' + sel);
          assert.ok(/:not\(\[data-view="watch"\]\)/.test(subject) && /:not\(:has\(#player-wrapper\)\)/.test(subject), 'a whole-root ' + prop + ' excludes the watch page and a root holding the player: ' + sel);
        }
      }
    }
  }
  assert.ok(checked >= 2, 'the census saw the whole-root rules (' + checked + ')');
});

test('mutant F-M4: the commit never flashes the page back up (the fade is never removed between the pull and the floor)', async () => {
  const h = await boot(VIDEO);
  const g = pull(h, 200);
  const mo = new h.w.MutationObserver(() => {});
  mo.observe(h.root, { attributes: true, attributeFilter: ['style'], attributeOldValue: true });
  fire(h.w, h.v, 'touchend', g.x, g.y, g.t + 10);
  const states = mo.takeRecords().map((r) => r.oldValue || '').concat([h.root.getAttribute('style') || '']);
  mo.disconnect();
  assert.ok(states.length >= 2, 'the commit changed the style');
  for (const st of states) assert.match(st, /--minimize-fade/, 'a state without the fade (a flash): ' + JSON.stringify(states));
  assert.strictEqual(fade(h), '1');
});

test('mutant F-M13: a page root that holds the player (the mini player inside it) is never dimmed by the expand', async () => {
  const h = await boot(VIDEO);
  h.p.dock();
  h.root.setAttribute('data-view', 'home');
  h.root.appendChild(h.dockEl); // a shell whose dock sits inside #view-root: the root holds the player
  h.dockEl.dispatchEvent(new h.w.MouseEvent('click', { bubbles: true }));
  assert.deepStrictEqual(h.navs, ['/watch.html?v=v1'], 'precondition: the tap still expands');
  assert.ok(!h.root.classList.contains('is-view-leaving'));
});
