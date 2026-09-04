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
  const cancels = [];
  dom.window.requestAnimationFrame = (fn) => { frames.push(fn); return frames.length; };
  dom.window.cancelAnimationFrame = (id) => { cancels.push(id); };
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
  // pump() re-runs whatever the loop scheduled, which is the ONLY way to see whether
  // it actually stopped - the old harness stubbed cancel as a no-op and never re-ran a
  // frame, so its "stops the loop" title asserted nothing (slim CRITICAL-2).
  const pump = () => { const q = frames.splice(0); q.forEach((f) => f(16)); return q.length; };
  return { dom, frames, cancels, calls, pump, host: dom.window.document.getElementById('lcd') };
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

test('destroy is idempotent AND actually stops the loop (measured by re-pumping, not by title)', () => {
  const b = boot();
  const g = b.dom.window.FileTubeBrick.mount(b.host, {});
  assert.ok(b.pump() > 0, 'the loop was running');
  g.destroy();
  assert.ok(b.cancels.length >= 1, 'cancelAnimationFrame was actually called (delete it and this reds)');
  b.pump();
  assert.equal(b.pump(), 0, 'nothing re-scheduled itself after destroy - the loop is genuinely dead');
  assert.doesNotThrow(() => g.destroy(), 'a double teardown is survivable');
});

test('an ORPHANED game stops itself - the repaint detaches it with no event (slim CRITICAL-2)', () => {
  const b = boot();
  const g = b.dom.window.FileTubeBrick.mount(b.host, {});
  assert.ok(b.pump() > 0, 'running while attached');
  b.host.innerHTML = ''; // exactly what engine paint() does to the panel
  b.pump();              // the frame already scheduled notices and bails
  assert.equal(b.pump(), 0, 'a detached game stops scheduling instead of burning 60fps forever');
  g.destroy();
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
  assert.match(engine, /data-skin-menu[\s\S]{0,400}?if \(wheelTakeover\) \{ releaseWheelTakeover\(\); return; \}/, 'MENU backs out of a takeover - the iPod rule - via the single release');
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


test('slim CRITICAL-2: the ENGINE releases its takeover before it destroys the panel', () => {
  const engine = fs.readFileSync(path.join(ROOT, 'public', 'js', 'skin-surface.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  // Structural, not event-driven: whatever blows away the panel owns the release, so
  // track change / chapter roll / skin pick / dock / view swap are all covered at once.
  assert.match(engine, /function releaseWheelTakeover\(\)[\s\S]{0,320}?wheelTakeover = null;[\s\S]{0,200}?onExit/, 'the release nulls the pointer AND tells the takeover');
  assert.match(engine, /function paint\(\) \{[\s\S]{0,120}?releaseWheelTakeover\(\);/, 'paint() releases before it replaces innerHTML (v1.271 added a deferral guard above it)');
  assert.match(engine, /function destroy\(\) \{\s*releaseWheelTakeover\(\);/, 'destroy() releases too');
  // MENU's exit goes through the same release, so the pointer cannot be left dangling
  // by a view that forgets to clear it - one owner for one invariant.
  assert.match(engine, /if \(wheelTakeover\) \{ releaseWheelTakeover\(\); return; \}/, 'MENU exits VIA the release, not by calling onExit directly');
  const music = fs.readFileSync(path.join(ROOT, 'public', 'js', 'music.js'), 'utf8');
  assert.match(music, /var activeBrickStop = null;/, 'and the view keeps a module-scoped stopper');
  assert.match(music, /if \(activeBrickStop\)/, 'which its destroy() calls - destroy runs at module scope and cannot see the closure');
});

test('slim W3: the row is gated on the view\'s answer - source lock (the behaviour is measured in the gate\'s own probes)', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'js', 'skin-surface.js'), 'utf8');
  assert.match(html, /if \(inMainDoc && stickerCfg\.brick && typeof stickerCfg\.brick\.visible === 'function'\) \{[\s\S]{0,320}?if \(brOn\) brickRow =/,
    'main-document only, and it renders only when the view answers true');
  assert.match(html, /var brOn = false;\s*try \{ brOn = !!stickerCfg\.brick\.visible\(\); \} catch \(_\) \{ brOn = false; \}/,
    'a THROWING visible() hides the row rather than breaking the menu');
});


test('v1.270 GEOMETRY LOCK: the overlay\'s containing block is the LCD inner box, and the WHEEL is outside it', () => {
  // THE bug this wave shipped: .ipod-brick{position:absolute; inset:0} resolved
  // against .mms-full{position:fixed} because nothing between them was positioned,
  // so the game covered the whole screen and sat on the wheel - unplayable and
  // un-exitable. `position:relative` on .ip-lcd-in is 45 lines from the rule that
  // depends on it and was tied to it only by a comment; deleting it restored the
  // defect with the whole suite green. This asserts the RELATIONSHIP instead.
  const cssRaw = fs.readFileSync(path.join(ROOT, 'public', 'css', 'style.css'), 'utf8');
  const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, ' ');
  // Rules that can establish a containing block for an absolutely-positioned child.
  // NOTE contain:size does NOT - only layout/paint/strict/content do.
  const ESTABLISHES = /(^|;)\s*(position\s*:\s*(?!static)[a-z-]+|transform\s*:(?!\s*none)|filter\s*:(?!\s*none)|backdrop-filter\s*:(?!\s*none)|perspective\s*:(?!\s*none)|will-change\s*:\s*(transform|filter|perspective)|container-type\s*:(?!\s*normal)|contain\s*:[^;]*\b(layout|paint|strict|content)\b)/;
  const rules = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const sel = m[1].trim();
    if (!sel || sel.startsWith('@') || sel.startsWith('%')) continue;
    if (ESTABLISHES.test(m[2])) rules.push({ sel, body: m[2] });
  }
  assert.ok(rules.length > 20, `sanity: parsed ${rules.length} containing-block rules`);

  const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const d = dom.window.document;
  const skins = require('../../public/js/music-skins.js');
  const panel = d.createElement('div');
  panel.className = 'music-nowplaying-panel mms mms-full mms-ipod';
  panel.innerHTML = skins.renderFull('ipod', { track: { title: 'T', artist: 'A' }, upNext: [], fullList: [], posLabel: '0:00', remLabel: '-1:00' });
  d.body.appendChild(panel);
  // Mount where the ENGINE says, not where I assume - otherwise lcdHost() could be
  // changed to return the whole panel (the same full-screen geometry by another
  // route) and this test would sail past it, which is exactly what it did once.
  const engineSrc = fs.readFileSync(path.join(ROOT, 'public', 'js', 'skin-surface.js'), 'utf8');
  const hostSel = /lcdHost: function \(\) \{ return panel\.querySelector\('([^']+)'\)/.exec(engineSrc);
  assert.ok(hostSel, 'lcdHost mounts into a QUERIED descendant, not the panel itself');
  const lcdIn = panel.querySelector(hostSel[1]);
  assert.ok(lcdIn, `the skin renders lcdHost's target (${hostSel[1]})`);
  const brick = d.createElement('div');
  brick.className = 'ipod-brick';
  lcdIn.appendChild(brick); // exactly where lcdHost() puts it

  const matches = (el) => rules.some((r) => r.sel.split(',').some((one) => {
    try { return el.matches(one.trim()); } catch (_) { return false; }
  }));
  let nearest = null;
  for (let el = brick.parentElement; el; el = el.parentElement) {
    if (matches(el)) { nearest = el; break; }
  }
  assert.ok(nearest, 'SOME ancestor establishes a containing block');
  assert.ok(nearest.classList.contains('ip-lcd-in'),
    `the overlay's containing block must be .ip-lcd-in, got .${nearest.className.split(' ').join('.')} - anything higher and the game covers the screen`);
  const wheel = panel.querySelector('.ip-wheel');
  assert.ok(wheel, 'the skin renders a wheel');
  assert.ok(!nearest.contains(wheel), 'and the WHEEL must sit OUTSIDE that box, or the game paints over the controls');
  // slim SUGGESTION H - the other half of the same claim, and a gap in the shape the
  // seat originally handed me: walking the ancestors proves nothing if the overlay
  // opts out of them. `position:fixed` resolves against the VIEWPORT regardless of
  // what this test just measured (position does not establish a fixed containing
  // block - only transform/filter/perspective/contain/container-type do), which
  // reproduces CRITICAL-1 in full with the suite green.
  const brickRule = /\.ipod-brick\{([^}]*)\}/.exec(css);
  assert.ok(brickRule, 'the overlay rule exists');
  assert.match(brickRule[1], /position:\s*absolute/, 'ABSOLUTE, not fixed - fixed ignores the ancestor chain this test just walked and covers the screen');
  assert.match(brickRule[1], /inset:\s*0/, 'and it fills that box (inset:auto collapses the game to nothing)');
  dom.window.close();
});


test('slim W-C: the resize listener is BALANCED - a mount/destroy cycle strands nothing on window', () => {
  const dom = new JSDOM('<!doctype html><body><div id="lcd"></div></body>', { url: 'http://localhost/', runScripts: 'outside-only' });
  dom.window.requestAnimationFrame = () => 1;
  dom.window.cancelAnimationFrame = () => {};
  dom.window.HTMLCanvasElement.prototype.getContext = function () {
    return new Proxy({}, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 10 }) : () => {}), set: () => true });
  };
  let live = 0;
  const addR = dom.window.addEventListener.bind(dom.window);
  const remR = dom.window.removeEventListener.bind(dom.window);
  dom.window.addEventListener = (t, f, o) => { if (t === 'resize') live++; return addR(t, f, o); };
  dom.window.removeEventListener = (t, f, o) => { if (t === 'resize') live--; return remR(t, f, o); };
  dom.window.eval(BRICK_SRC);
  const host = dom.window.document.getElementById('lcd');
  for (let i = 0; i < 3; i++) {
    const g = dom.window.FileTubeBrick.mount(host, {});
    assert.equal(live, 1, 'mounted: exactly one resize listener');
    g.destroy();
    assert.equal(live, 0, `cycle ${i + 1}: destroy removed it - a stranded onResize retains a detached canvas and re-runs on every rotation`);
  }
  dom.window.close();
});
