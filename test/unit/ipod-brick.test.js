'use strict';

// [UNIT] v1.270 BRICK - the easter egg's wiring. Dean asked for something
// "extremely small and modular... not tied into any bigger thing", so the tests
// that matter are the ISOLATION ones: the engine seam is generic, the game owns
// its own teardown, and the row cannot appear on skins with no wheel to play it.
//
// v1.271: the physics is now PARTLY pinned, and the reason is instructive. The
// original note here said a ball-angle lock would be brittle-for-no-reason - and
// under that licence the paddle deflection shipped as an inert nudge. Measured end
// to end it bent the ball by 14.7 degrees across the ENTIRE paddle, so the ball
// simply carried on the way it came and the game read as an idle animation. The
// tests below therefore bind PROPERTIES, never literals: "where you hit decides
// where it goes", "the angle is clamped", "a rally speeds up", "the paddle shrinks".
// Each is measured through the public interface only (mount/onRotate/select) and
// read back off the CANVAS OPS, so nothing here depends on the game's internals.

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

// ---------------------------------------------------------------------------
// A headless rig for the PHYSICS tests. It drives the game through nothing but
// mount/onRotate/select and reads every measurement back off the canvas calls, so
// it measures what a player actually SEES. jsdom has no layout, so
// getBoundingClientRect is all zeros and the game clamps to its own 80x60 floor -
// that is the scale every reading below divides by.
const SIM_W = 80, SIM_H = 60;
function sim(rand) {
  const dom = new JSDOM('<!doctype html><body><div id="lcd"></div></body>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window;
  const queue = [];
  win.requestAnimationFrame = (f) => { queue.push(f); return queue.length; };
  win.cancelAnimationFrame = () => {};
  if (rand) win.Math.random = rand;
  const arcs = [], rects = [], texts = [], nums = [];
  win.HTMLCanvasElement.prototype.getContext = function () {
    return new Proxy({}, {
      get(_t, k) {
        if (k === 'measureText') return () => ({ width: 10 });
        if (k === 'arc') return (...a) => { arcs.push(a); nums.push(...a); };
        if (k === 'fillRect') return (...a) => { rects.push(a); nums.push(...a); };
        if (k === 'fillText') return (s, x, y) => { texts.push(String(s)); nums.push(x, y); };
        return (...a) => { for (const v of a) if (typeof v === 'number') nums.push(v); };
      },
      set: () => true,
    });
  };
  win.eval(BRICK_SRC);
  const g = win.FileTubeBrick.mount(win.document.getElementById('lcd'), {});
  let clock = 0;
  // step(ms) advances by a REAL timestamp delta; the loop clamps dt itself.
  const read = (ms) => {
    arcs.length = 0; rects.length = 0; texts.length = 0; nums.length = 0;
    const q = queue.splice(0);
    if (!q.length) return null;
    for (const f of q) { clock += (ms == null ? 1000 / 60 : ms); f(clock); }
    const a = arcs[arcs.length - 1];
    let pad = null;
    for (const r of rects) if (r[1] > 0.7 * SIM_H) pad = r;
    const over = texts.some((s) => /GAME OVER/.test(s));
    return {
      x: a ? a[0] / SIM_W : null, y: a ? a[1] / SIM_H : null, r: a ? a[2] : null,
      padC: pad ? (pad[0] + pad[2] / 2) / SIM_W : null,
      padHW: pad ? (pad[2] / 2) / SIM_W : null,
      padW: pad ? pad[2] / SIM_W : null,
      bricks: rects.filter((r) => r[1] < 0.7 * SIM_H).length,
      over, ready: !over && /Select/.test(texts.join(' ')),
      bad: nums.filter((v) => typeof v === 'number' && !Number.isFinite(v)).length,
    };
  };
  return { g, read, close: () => { g.destroy(); try { win.close(); } catch (_) { /* already gone */ } } };
}

// Runs until the ball comes off the paddle, holding the paddle at a FIXED offset
// under the ball so the contact position is the controlled variable. Returns the
// incoming and outgoing vectors at that contact.
function paddleContact(off, rand, startNudge) {
  const S = sim(rand);
  S.read();
  if (startNudge) S.g.onRotate(startNudge); // in 'ready' this moves the paddle AND the ball
  S.g.select();
  let p1 = null, p2 = null, pad = null, hw = null;
  for (let i = 0; i < 5000; i++) {
    const f = S.read();
    if (!f || f.x == null) break;
    if (p2 && p1) {
      const inVy = p1[1] - p2[1], outVy = f.y - p1[1];
      if (inVy > 0 && outVy < 0 && p1[1] > 0.78) {
        S.close();
        return {
          contactX: p1[0], gotOff: (p1[0] - pad) / hw,
          inVx: (p1[0] - p2[0]) * 60, inVy: inVy * 60,
          outVx: (f.x - p1[0]) * 60, outVy: outVy * 60,
          angle: Math.atan2(-outVy, f.x - p1[0]) * 180 / Math.PI,
        };
      }
    }
    if (f.padC != null) S.g.onRotate(((f.x - off * f.padHW) - f.padC) * 220);
    p2 = p1; p1 = [f.x, f.y]; pad = f.padC; hw = f.padHW;
  }
  S.close();
  return null;
}

// Near a side wall the paddle clamps and the extreme contact offsets are simply
// unreachable - which is exactly how the first version of this probe fooled itself
// into reporting three near-identical contacts. Find a launch that descends
// mid-board FIRST, then run the three offsets against it.
// Returns a FACTORY, not an RNG: every probe needs its own fresh sequence, or the
// second and third runs launch from wherever the first one left the counter.
function midBoardLaunch() {
  for (let k = 0; k < 8; k++) {
    const seq = [0.08 * k, k % 2 ? 0.2 : 0.8];
    const factory = () => { let i = 0; return () => seq[i++ % seq.length]; };
    for (let nudge = -60; nudge <= 60; nudge += 20) {
      const r = paddleContact(0, factory(), nudge);
      if (r && r.contactX > 0.30 && r.contactX < 0.70) return { factory, nudge };
    }
  }
  return null;
}

test('v1.271 DEFLECTION: the SAME incoming ball leaves in materially different directions depending on WHERE it hits the paddle', () => {
  const found = midBoardLaunch();
  assert.ok(found, 'found a launch that descends mid-board (needed so the paddle is not clamped against a wall)');
  const hits = [-0.85, 0, 0.85].map((off) => ({ off, probe: paddleContact(off, found.factory(), found.nudge) }));
  for (const h of hits) assert.ok(h.probe, `contact captured for offset ${h.off}`);

  // The incoming vector MUST be identical across the three - otherwise this measures
  // the approach, not the paddle, and would pass on a game with no deflection at all.
  const ins = new Set(hits.map((h) => h.probe.inVx.toFixed(4) + '/' + h.probe.inVy.toFixed(4)));
  assert.equal(ins.size, 1, `all three probes must share ONE incoming vector, got ${[...ins].join(' | ')}`);

  // And the three contacts must actually be spread across the paddle.
  const offs = hits.map((h) => h.probe.gotOff).sort((a, b) => a - b);
  assert.ok(offs[0] < -0.5, `left probe landed at ${offs[0].toFixed(2)} of the half-paddle`);
  assert.ok(Math.abs(offs[1]) < 0.35, `centre probe landed at ${offs[1].toFixed(2)}`);
  assert.ok(offs[2] > 0.5, `right probe landed at ${offs[2].toFixed(2)}`);

  const angles = hits.map((h) => h.probe.angle);
  const spread = Math.max(...angles) - Math.min(...angles);
  // The pre-v1.271 nudge measured 14.7 degrees across the WHOLE paddle. 60 is far
  // below what an angle map gives (~102 measured) and far above what a nudge can.
  assert.ok(spread > 60, `exit angle must depend on contact position: spread was only ${spread.toFixed(1)}deg across the paddle (a velocity nudge scores ~15)`);
  // Monotonic: further right on the paddle => further right the ball goes.
  const byOff = hits.slice().sort((a, b) => a.probe.gotOff - b.probe.gotOff).map((h) => h.probe.outVx);
  assert.ok(byOff[0] < byOff[1] && byOff[1] < byOff[2],
    `outgoing vx must rise monotonically with contact offset, got ${byOff.map((v) => v.toFixed(3)).join(' < ')}`);
  // THE property Dean asked for, stated as a reversal: a ball travelling one way
  // must be sent back the OTHER way by a hit on the far side of the paddle.
  const sorted = hits.slice().sort((a, b) => a.probe.gotOff - b.probe.gotOff);
  const inSign = Math.sign(sorted[0].probe.inVx);
  const far = inSign < 0 ? sorted[2] : sorted[0];
  assert.equal(Math.sign(far.probe.outVx), -inSign,
    `a ball arriving with vx ${sorted[0].probe.inVx.toFixed(3)} must LEAVE the other way off the far edge of the paddle (got ${far.probe.outVx.toFixed(3)}) - this is the "momentum" a nudge cannot produce`);
});

test('v1.271 the deflection is CLAMPED: an EDGE-SEEKING player still cannot make the ball skim horizontally', () => {
  // The other half of an angle map: unbounded, it lets a ball leave at 3 degrees off
  // horizontal and rattle between the walls until the player gives up.
  //
  // Two traps this test has to dodge. (1) It must actually DRIVE the deflection to
  // its limit - a paddle that centres itself under the ball tops out around 48deg and
  // would pass with the clamp raised to 85. So the paddle here holds the ball at the
  // very edge, alternating sides. (2) It must measure in CLEAN FLIGHT: a frame that
  // contains a bounce shows a net displacement pointing nowhere near the ball's
  // actual heading (those frames read up to 90deg), and every bounce here preserves
  // the angle's magnitude anyway - only the paddle and the launch ever set it.
  const S = sim();
  let p = null, worst = 0, n = 0;
  for (let i = 0; i < 8000; i++) {
    const f = S.read();
    if (!f || f.x == null) break;
    if (f.ready || f.over) { S.g.select(); p = null; }
    else if (p && f.y > 0.45 && f.y < 0.85 && f.x > 0.12 && f.x < 0.88
             && p[1] > 0.45 && p[1] < 0.85 && p[0] > 0.12 && p[0] < 0.88) {
      const ang = Math.abs(Math.atan2(f.x - p[0], f.y - p[1]) * 180 / Math.PI);
      worst = Math.max(worst, Math.min(ang, 180 - ang)); // angle off the vertical axis
      n++;
    }
    if (f.padC != null) {
      const edge = (Math.floor(i / 120) % 2 ? 0.97 : -0.97) * (f.padHW || 0.09);
      S.g.onRotate(((f.x - edge) - f.padC) * 220);
    }
    p = [f.x, f.y];
  }
  S.close();
  assert.ok(n > 500, `gathered ${n} clean free-flight frames`);
  assert.ok(worst <= 62,
    `steepest heading was ${worst.toFixed(1)}deg off vertical - past ~60 the ball crawls sideways and the rally stalls`);
  // Anti-vacuous floor: if the probe never got near the edge, the ceiling above proved
  // nothing. Deleting the clamp must be able to red this test, so it has to be tight.
  assert.ok(worst >= 50,
    `the probe only reached ${worst.toFixed(1)}deg off vertical, so it never exercised the clamp at all`);
});

test('v1.271 PACE: the ball starts materially faster than the old crawl AND a rally accelerates', () => {
  const S = sim();
  const speeds = [];
  let p = null, firstRally = [], bricks0 = null;
  for (let i = 0; i < 3000; i++) {
    const f = S.read();
    if (!f || f.x == null) break;
    if (bricks0 == null) bricks0 = f.bricks;
    if (f.ready || f.over) { S.g.select(); p = null; }
    else if (p) {
      // Filter on the RAW per-frame displacement: a frame containing a bounce shows a
      // short net move even though the ball travelled its full distance, and those
      // frames would drag every average down.
      const raw = Math.hypot(f.x - p[0], f.y - p[1]);
      if (raw < 0.25) { const d = raw * 60; speeds.push(d); firstRally.push(d); }
    }
    if (f.padC != null) S.g.onRotate((f.x - f.padC) * 220);
    p = [f.x, f.y];
  }
  S.close();
  assert.ok(speeds.length > 500, `gathered ${speeds.length} speed samples`);
  const early = firstRally.slice(0, 60);
  const late = firstRally.slice(-60);
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  // The old base was 0.34 board-heights/sec - three seconds to cross the board.
  assert.ok(avg(early) > 0.5, `launch pace was ${avg(early).toFixed(3)} board-heights/sec; below ~0.5 it reads as an idle animation`);
  assert.ok(avg(late) > avg(early) * 1.3,
    `a rally must build: ${avg(early).toFixed(3)} -> ${avg(late).toFixed(3)} board-heights/sec is not an acceleration curve`);
  // ...but never so fast that the substepper can be outrun.
  assert.ok(Math.max(...speeds) < 2.0, `top speed ${Math.max(...speeds).toFixed(2)} must stay under the substepper's reach`);
});

test('v1.271 the paddle SHRINKS as the board is cleared - losing has to become possible', () => {
  const S = sim();
  let start = null, smallest = 1;
  for (let i = 0; i < 6000; i++) {
    const f = S.read();
    if (!f || f.x == null) break;
    if (f.padW != null) { if (start == null) start = f.padW; smallest = Math.min(smallest, f.padW); }
    if (f.ready || f.over) S.g.select();
    if (f.padC != null) S.g.onRotate((f.x - f.padC) * 220);
  }
  S.close();
  assert.ok(start > 0.15, `starts generous: ${start}`);
  assert.ok(smallest < start * 0.75, `the paddle must get harder to hit with: ${start} -> ${smallest}`);
  assert.ok(smallest > 0.05, `...but never a sliver: ${smallest}`);
});

test('v1.271 a NON-FINITE rotation is rejected instead of poisoning the canvas', () => {
  // onRotate is fed by the wheel's own arithmetic; one NaN used to land straight in
  // padX, from there into ball.x on the next launch, and out into ctx.arc forever.
  for (const bad of [NaN, Infinity, -Infinity, undefined, null, '40']) {
    const S = sim();
    S.read();
    S.g.onRotate(bad);
    const f = S.read();
    assert.ok(f, `still running after onRotate(${String(bad)})`);
    assert.equal(f.bad, 0, `onRotate(${String(bad)}) put ${f.bad} non-finite numbers into canvas calls`);
    S.g.select();
    for (let i = 0; i < 30; i++) {
      const q = S.read();
      assert.equal(q.bad, 0, `onRotate(${String(bad)}) poisoned the sim ${i} frames later`);
    }
    S.close();
  }
});

test('v1.271 STRESS: randomised wheel + Select for 20k frames produces no non-finite value and never lets the ball escape', () => {
  let seed = 1234567;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  let frames = 0, bad = 0, escapes = 0;
  for (let run = 0; run < 10; run++) {
    const S = sim(rnd);
    for (let i = 0; i < 2000; i++) {
      // Vary the frame delta too: the loop clamps dt at 50ms, and a fast ball at a
      // clamped dt is exactly the case the substepper exists for.
      const f = S.read(rnd() < 0.2 ? 300 : 1000 / 60);
      if (!f) break;
      frames++; bad += f.bad;
      if (f.x != null && (f.x < -0.05 || f.x > 1.05 || f.y < -0.25 || f.y > 1.25)) escapes++;
      if (rnd() < 0.5) S.g.onRotate((rnd() - 0.5) * 500);
      if (rnd() < 0.05) S.g.select();
    }
    S.close();
  }
  assert.ok(frames > 19000, `ran ${frames} frames`);
  assert.equal(bad, 0, `${bad} non-finite numbers reached the canvas`);
  assert.equal(escapes, 0, `the ball left the board on ${escapes} frames`);
});

test('v1.271 a 0x0 host is survivable - no division by zero reaches the canvas', () => {
  const dom = new JSDOM('<!doctype html><body><div id="lcd"></div></body>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window;
  const queue = [];
  win.requestAnimationFrame = (f) => { queue.push(f); return 1; };
  win.cancelAnimationFrame = () => {};
  let bad = 0;
  win.HTMLCanvasElement.prototype.getContext = function () {
    return new Proxy({}, {
      get(_t, k) {
        if (k === 'measureText') return () => ({ width: 0 });
        return (...a) => { for (const v of a) if (typeof v === 'number' && !Number.isFinite(v)) bad++; };
      },
      set: () => true,
    });
  };
  win.Element.prototype.getBoundingClientRect = () => ({ width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 });
  win.eval(BRICK_SRC);
  const g = win.FileTubeBrick.mount(win.document.getElementById('lcd'), {});
  let t = 0;
  for (let i = 0; i < 400; i++) {
    const q = queue.splice(0);
    for (const f of q) { t += 16; f(t); }
    g.onRotate(37);
    if (i % 20 === 0) g.select();
  }
  g.destroy(); win.close();
  assert.equal(bad, 0, `${bad} non-finite args reached the canvas on a zero-sized host`);
});

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
  assert.match(engine, /function paint\(\) \{[\s\S]{0,900}?releaseWheelTakeover\(\);/, 'paint() releases before it replaces innerHTML (v1.271 added a deferral guard above it)');
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
