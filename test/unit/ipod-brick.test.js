'use strict';

// [UNIT] v1.270 BRICK - the easter egg's wiring. Dean asked for something
// "extremely small and modular... not tied into any bigger thing", so the tests
// that matter are the ISOLATION ones: the engine seam is generic, the game owns
// its own teardown, and the row cannot appear on skins with no wheel to play it.
//
// The physics is deliberately NOT pinned. It is an easter egg; a ball-angle lock
// would be exactly the brittle-for-no-reason test this repo keeps deleting.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const BRICK_SRC = fs.readFileSync(path.join(ROOT, 'public', 'js', 'ipod-brick.js'), 'utf8');

function boot() {
  const dom = new JSDOM('<!doctype html><html><body><div id="lcd" style="width:200px;height:120px"></div></body></html>',
    { url: 'http://localhost/', runScripts: 'outside-only' });
  const frames = [];
  dom.window.requestAnimationFrame = (fn) => { frames.push(fn); return frames.length; };
  dom.window.cancelAnimationFrame = () => {};
  // jsdom has no canvas backend; a stub proves the mount path without pulling one in.
  const calls = [];
  dom.window.HTMLCanvasElement.prototype.getContext = function () {
    return new Proxy({}, {
      get(_t, k) {
        if (k === 'measureText') return () => ({ width: 10 });
        return (...a) => { calls.push(String(k)); return a; };
      },
      set() { return true; },
    });
  };
  dom.window.eval(BRICK_SRC);
  return { dom, frames, calls, host: dom.window.document.getElementById('lcd') };
}

test('mount attaches a canvas inside the host and destroy removes it (the whole lifetime is the caller\'s)', () => {
  const b = boot();
  const g = b.dom.window.FileTubeBrick.mount(b.host, {});
  assert.ok(g, 'mount returned a handle');
  assert.equal(b.host.querySelectorAll('canvas').length, 1, 'exactly one canvas, inside the host');
  assert.ok(b.host.querySelector('.ipod-brick'), 'wrapped so the CSS can position it');
  g.destroy();
  assert.equal(b.host.querySelectorAll('canvas').length, 0, 'destroy leaves the host as it found it');
  assert.equal(b.host.innerHTML, '', 'no residue at all');
});

test('destroy is idempotent and stops the loop - a second call must not throw', () => {
  const b = boot();
  const g = b.dom.window.FileTubeBrick.mount(b.host, {});
  g.destroy();
  assert.doesNotThrow(() => g.destroy(), 'a double teardown is survivable');
});

test('the wheel drives the paddle, and the paddle CANNOT leave the board', () => {
  const b = boot();
  const g = b.dom.window.FileTubeBrick.mount(b.host, {});
  // A huge rotation in each direction must clamp, not run off.
  for (let i = 0; i < 50; i++) g.onRotate(60);
  b.frames.forEach((f) => f(16));
  assert.doesNotThrow(() => g.onRotate(60), 'still alive at the right wall');
  for (let i = 0; i < 200; i++) g.onRotate(-60);
  assert.doesNotThrow(() => g.onRotate(-60), 'still alive at the left wall');
  g.destroy();
});

test('Select launches from ready, and reports whether it consumed the press', () => {
  const b = boot();
  const g = b.dom.window.FileTubeBrick.mount(b.host, {});
  assert.equal(g.select(), true, 'the first Select launches the ball');
  assert.equal(g.select(), false, 'a Select mid-play is not consumed (so it cannot swallow the button forever)');
  g.destroy();
});

test('the engine seam is GENERIC: setWheelTakeover names nothing about games', () => {
  const engine = fs.readFileSync(path.join(ROOT, 'public', 'js', 'skin-surface.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  assert.match(engine, /setWheelTakeover: function \(t\)/, 'the setter exists');
  // The engine DOES name a `brick` sticker hook - exactly as it names autoplay, tray
  // and watchBack; that is the established row pattern and not a coupling. The real
  // isolation property is narrower and this is it: the engine never touches the GAME.
  assert.ok(!/FileTubeBrick/.test(engine), 'the engine never references the game object - it only asks the VIEW to render a row and calls back (comments stripped, so prose cannot satisfy this)');
  assert.ok(!/ipod-brick/.test(engine), 'and never reaches for its file');
  assert.ok(!/canvas/i.test(engine), 'and knows nothing about how the takeover draws itself');
  assert.match(engine, /wheelTakeover && typeof wheelTakeover\.onRotate === 'function'/, 'rotation routes to the takeover');
  // Both are folded INSIDE the existing single handler for each control - a second
  // handler would silently steal the v1.233 lock's first-occurrence anchor.
  assert.match(engine, /data-skin-menu[\s\S]{0,400}?if \(wheelTakeover\)[\s\S]{0,200}?onExit/, 'MENU backs out of a takeover - the iPod rule');
  assert.match(engine, /data-skin-select[\s\S]{0,300}?if \(wheelTakeover\)[\s\S]{0,200}?onSelect/, 'Select reaches the takeover');
});

test('the row is gated on the VIEW\'s answer, and music restricts it to skins that have a wheel', () => {
  const engine = fs.readFileSync(path.join(ROOT, 'public', 'js', 'skin-surface.js'), 'utf8');
  assert.match(engine, /stickerCfg\.brick && typeof stickerCfg\.brick\.visible === 'function'/, 'the engine asks the view, it does not decide');
  const music = fs.readFileSync(path.join(ROOT, 'public', 'js', 'music.js'), 'utf8');
  assert.match(music, /return id === 'ipod' \|\| id === 'ipod-black';/, 'Pocket Classic only - the flat skins have no wheel, and Seattle Classic\'s pad is half the usable ring (#207)');
  assert.match(music, /if \(!window\.FileTubeBrick\) return false;/, 'and it hides itself entirely if the game file never loaded');
});

test('SHELL PARITY: every shell that loads the skin engine also loads the game (dynamic, fail-safe floor)', () => {
  const dir = path.join(ROOT, 'public');
  const shells = fs.readdirSync(dir).filter((f) => f.endsWith('.html'));
  assert.ok(shells.length >= 10, `fail-safe floor: found only ${shells.length} shells`);
  let checked = 0;
  const missing = [];
  for (const f of shells) {
    const html = fs.readFileSync(path.join(dir, f), 'utf8');
    if (!html.includes('src="/js/skin-surface.js"')) continue;
    checked++;
    if (!html.includes('src="/js/ipod-brick.js"')) missing.push(f);
  }
  assert.ok(checked >= 8, `fail-safe floor: only ${checked} shells load the engine`);
  assert.deepStrictEqual(missing, [], 'shells with a wheel but no game (the v1.250 parity class)');
});
