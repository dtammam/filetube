'use strict';

// [UNIT] v1.311.2 - the ONE shared iOS body scroll lock (public/js/body-scroll-lock.js).
// Pure behavior against a jsdom document: owner-keyed nesting (two overlays never
// clobber each other's saved scroll), idempotence, the restore / no-restore
// release, and the router seams (scrollYOf / a navigation's deferred scrollTo).
// Plus the shell PARITY net: every shell that loads the player or the skin
// engine loads the lock BEFORE them (derived from the shells on disk each run).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const BL = require('../../public/js/body-scroll-lock.js');
const REPO = path.join(__dirname, '..', '..');

function page(y) {
  const dom = new JSDOM('<!DOCTYPE html><body><main>x</main></body>');
  const win = dom.window;
  const scrolls = [];
  let sy = y;
  // Like iOS: a pinned body reads scroll 0 (QA r1 S5).
  Object.defineProperty(win, 'pageYOffset', { get: () => (win.document.body.style.position === 'fixed' ? 0 : sy), configurable: true });
  win.scrollTo = (_x, ny) => { scrolls.push(ny); sy = ny; };
  return { doc: win.document, win, scrolls, setY: (n) => { sy = n; } };
}

test('lock pins the body at -Y (the iOS lock that holds); the last release unpins and restores Y', () => {
  const { doc, win, scrolls } = page(420);
  assert.strictEqual(BL.lock(doc, win, 'a'), true);
  assert.strictEqual(doc.body.style.position, 'fixed');
  assert.strictEqual(doc.body.style.top, '-420px');
  // gate r1 N24 (adversary): without left/right a fixed body shrinks to its content on iOS.
  assert.strictEqual(doc.body.style.left, '0px');
  assert.strictEqual(doc.body.style.right, '0px');
  assert.strictEqual(BL.isLocked(doc), true);
  assert.strictEqual(BL.release(doc, win, 'a'), true);
  assert.strictEqual(doc.body.style.position, '');
  assert.strictEqual(doc.body.style.top, '');
  assert.strictEqual(doc.body.style.left, '');
  assert.strictEqual(doc.body.style.right, '');
  assert.deepStrictEqual(scrolls, [420], 'restored exactly once, to the entry scroll');
  assert.strictEqual(BL.isLocked(doc), false);
});

test('two owners never clobber: the second joins (no re-capture at the pinned 0), only the LAST release restores', () => {
  const { doc, win, scrolls, setY } = page(300);
  BL.lock(doc, win, 'skin-ghost:1');
  setY(0); // a pinned body reads 0 - a second private copy would have captured THIS
  BL.lock(doc, win, 'audio-expanded');
  assert.strictEqual(doc.body.style.top, '-300px', 'the first owner\'s capture stands');
  assert.strictEqual(BL.release(doc, win, 'skin-ghost:1'), false, 'not the last owner');
  assert.strictEqual(doc.body.style.position, 'fixed', 'still pinned for the remaining owner');
  assert.deepStrictEqual(scrolls, []);
  assert.strictEqual(BL.release(doc, win, 'audio-expanded'), true);
  assert.deepStrictEqual(scrolls, [300], 'back to the REAL entry scroll, never 0');
});

test('idempotence: a repeated lock by one owner needs ONE release; a stranger\'s release is a no-op', () => {
  const { doc, win } = page(50);
  BL.lock(doc, win, 'a'); BL.lock(doc, win, 'a');
  assert.strictEqual(BL.release(doc, win, 'nobody'), false);
  assert.strictEqual(BL.holds(doc, 'a'), true);
  assert.strictEqual(BL.release(doc, win, 'a'), true, 'one release frees a twice-taken lock');
  assert.strictEqual(BL.release(doc, win, 'a'), false, 'and a second is inert');
});

test('release { restore:false } unpins without scrolling (the faux keeper restores on its own terms)', () => {
  const { doc, win, scrolls } = page(420);
  BL.lock(doc, win, 'faux-fullscreen');
  BL.release(doc, win, 'faux-fullscreen', { restore: false });
  assert.strictEqual(doc.body.style.position, '');
  assert.deepStrictEqual(scrolls, []);
});

test('router seams: scrollYOf reads the pinned Y; a navigation\'s scrollTo under the lock is DEFERRED and wins the release', () => {
  const { doc, win, scrolls, setY } = page(420);
  BL.lock(doc, win, 'faux-fullscreen');
  setY(0);
  assert.strictEqual(BL.scrollYOf(doc, win), 420, 'the router records the real scroll, not the pinned 0');
  BL.scrollTo(doc, win, 900); // the router places the NEW page while the overlay is up
  assert.deepStrictEqual(scrolls, [], 'nothing scrolls while pinned (it would be clamped)');
  assert.strictEqual(doc.body.style.top, '-900px', 're-pinned at the new place');
  assert.strictEqual(BL.scrollYOf(doc, win), 900);
  BL.release(doc, win, 'faux-fullscreen', { restore: false });
  assert.deepStrictEqual(scrolls, [900], 'even a no-restore release lands where the navigation put the page');
  // unlocked: the seams are plain window scroll
  setY(77);
  assert.strictEqual(BL.scrollYOf(doc, win), 77);
  BL.scrollTo(doc, win, 12);
  assert.deepStrictEqual(scrolls, [900, 12]);
});

test('locks are per DOCUMENT (a pop-out skin has its own body)', () => {
  const a = page(10); const b = page(20);
  BL.lock(a.doc, a.win, 'x');
  assert.strictEqual(BL.isLocked(b.doc), false);
  BL.lock(b.doc, b.win, 'x');
  BL.release(a.doc, a.win, 'x');
  assert.strictEqual(BL.isLocked(b.doc), true);
  BL.release(b.doc, b.win, 'x');
});

// ---- shell parity (the v1.250 SHELL PARITY class): DERIVED roster ----------
function shellFiles() {
  const out = [];
  for (const dir of [path.join(REPO, 'public'), path.join(REPO, 'lib', 'ytdlp', 'views')]) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) if (f.endsWith('.html')) out.push(path.join(dir, f));
  }
  return out;
}
const tagAt = (html, file) => html.search(new RegExp('<script[^>]+src="/js/' + file.replace('.', '\\.') + '"'));

test('every shell that loads player.js or skin-surface.js loads body-scroll-lock.js BEFORE them', () => {
  const consumers = shellFiles().filter((p) => {
    const h = fs.readFileSync(p, 'utf8');
    return tagAt(h, 'player.js') !== -1 || tagAt(h, 'skin-surface.js') !== -1;
  });
  assert.ok(consumers.length >= 11, `roster sanity: found ${consumers.length} player/skin shells`);
  for (const p of consumers) {
    const h = fs.readFileSync(p, 'utf8');
    const lock = tagAt(h, 'body-scroll-lock.js');
    assert.ok(lock !== -1, `${path.relative(REPO, p)} must load the shared body lock`);
    for (const dep of ['player.js', 'skin-surface.js']) {
      const at = tagAt(h, dep);
      if (at !== -1) assert.ok(lock < at, `${path.relative(REPO, p)}: the lock loads before ${dep}`);
    }
  }
});

test('no private body lock survives: only body-scroll-lock.js pins the body', () => {
  const dir = path.join(REPO, 'public', 'js');
  const offenders = fs.readdirSync(dir).filter((f) => f.endsWith('.js') && f !== 'body-scroll-lock.js')
    .filter((f) => /body\.style\.position\s*=\s*['"`]fixed['"`]|body\.style\.setProperty\(\s*['"`]position['"`]/.test(fs.readFileSync(path.join(dir, f), 'utf8')));
  assert.deepStrictEqual(offenders, [], 'a hand-copied lock clobbers the shared one - route it through FileTubeBodyLock');
});
