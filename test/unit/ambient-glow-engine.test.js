'use strict';

// [UNIT] v1.312 (Dean, device): AMBIENT MODE REBUILD. Ambient ON blacked out EVERY
// video on his iPhone (picture ~1s, then black; audio + glow colours continued; on
// every build back to 1.311.1; OFF = picture). The old effect copied the live
// <video> into a canvas every 500ms AND composited a blurred + masked + scaled
// layer beside it - both iOS video/canvas/GPU-process breakage shapes. The rebuild
// is colour-only: sample a same-origin IMAGE (storyboard sprite tile at the current
// time, else the poster) OFF-DOM, paint CSS gradients on two cross-fading divs.
//
// Bound here: (1) the pure source ladder + swatch maths, (2) the engine driven
// end to end with fakes (paints on a tile change, never on the same tile, falls
// to the poster, hard-fails safely, and NEVER draws the video), (3) the CSS /
// HTML / wiring locks that keep the two iOS suspects out of the tree.
// Plan: docs/exec-plans/active/2026-09-23-ambient-glow-rebuild.md

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const W = require('../../public/js/watch.js');
const { storyboardFrameForTime, storyboardTile } = require('../../public/js/player.js');
const STORYBOARD = { frameForTime: storyboardFrameForTime, tile: storyboardTile };

const REPO = path.join(__dirname, '..', '..');
const WATCH_JS = fs.readFileSync(path.join(REPO, 'public/js/watch.js'), 'utf8');
const WATCH_HTML = fs.readFileSync(path.join(REPO, 'public/watch.html'), 'utf8');
const STYLE_CSS = fs.readFileSync(path.join(REPO, 'public/css/style.css'), 'utf8');

// Comment-stripped source (the standing lesson: a raw lock is comment-porous).
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
// A function body bounded to ITS OWN closing brace at the given indent (the
// v1.304 lesson: an unbounded [\s\S]*? span reaches into the next function).
function fnBody(src, header, indent) {
  const start = src.indexOf(header);
  assert.ok(start >= 0, header + ' exists');
  const end = src.indexOf('\n' + indent + '}', start);
  assert.ok(end > start, header + ' closes');
  return src.slice(start, end);
}
const STRIPPED_JS = stripComments(WATCH_JS);
const ENGINE_SRC = fnBody(STRIPPED_JS, 'function createAmbientEngine(opts) {', '');
const WIRING_SRC = fnBody(STRIPPED_JS, 'function setupAmbientMode() {', '    ');

// A 40-frame, 10x4 storyboard for a 100s video: frame i at i*2.5s.
const GEOM = { v: 1, interval: 2.5, count: 40, cols: 10, rows: 4, tileW: 320, tileH: 180 };
const VIDEO_ITEM = { id: 'vid1', type: 'video', duration: 100, storyboard: GEOM };

// ---- (1) pure helpers -------------------------------------------------------

test('v1.312 ambientSourceFor: a video with a storyboard samples the SPRITE TILE at t (index advances with time)', () => {
  const s0 = W.ambientSourceFor(VIDEO_ITEM, 'vid1', 0, STORYBOARD);
  assert.deepStrictEqual(s0, { kind: 'sprite', url: '/storyboard/vid1', index: 0, col: 0, row: 0, cols: 10, rows: 4 });
  const s25 = W.ambientSourceFor(VIDEO_ITEM, 'vid1', 25, STORYBOARD);
  assert.strictEqual(s25.index, 10, 'floor(25 / 2.5) = frame 10');
  assert.deepStrictEqual([s25.col, s25.row], [0, 1], 'frame 10 is column 0 of row 1');
  const sEnd = W.ambientSourceFor(VIDEO_ITEM, 'vid1', 999, STORYBOARD);
  assert.strictEqual(sEnd.index, 39, 'clamped to the last frame');
  assert.strictEqual(W.ambientSourceFor(VIDEO_ITEM, 'a b', 0, STORYBOARD).url, '/storyboard/a%20b', 'the id is URL-encoded');
});

test('v1.312 ambientSourceFor: the POSTER rung - no storyboard, audio, tv artUrl, missing geometry helpers', () => {
  assert.deepStrictEqual(W.ambientSourceFor({ id: 'v', type: 'video', duration: 100 }, 'v', 5, STORYBOARD),
    { kind: 'image', url: '/thumbnail/v', index: 0 }, 'a video without a sprite samples its thumbnail');
  assert.strictEqual(W.ambientSourceFor({ type: 'audio', storyboard: GEOM }, 'a1', 5, STORYBOARD).kind, 'image',
    'audio NEVER takes the sprite rung even if a geometry is present (the v1.187.2 W4 gate, by type)');
  assert.deepStrictEqual(W.ambientSourceFor({ type: 'video', artUrl: '/tvposter/show1' }, 'ep1', 5, STORYBOARD),
    { kind: 'image', url: '/tvposter/show1', index: 0 }, 'a tv episode (no storyboard, an explicit artUrl) samples its poster - /thumbnail/<episodeId> would 404');
  assert.strictEqual(W.ambientSourceFor({ type: 'video', artUrl: '' }, 'v', 5, STORYBOARD).url, '/thumbnail/v', 'an EMPTY artUrl falls to the thumbnail (player.js\'s own poster rule)');
  assert.strictEqual(W.ambientSourceFor(VIDEO_ITEM, 'vid1', 5, null).kind, 'image', 'no geometry helpers (player module absent) -> the image rung, never a throw');
  assert.strictEqual(W.ambientSourceFor(VIDEO_ITEM, '', 5, STORYBOARD), null, 'no id -> nothing to sample');
});

// A 16x9 RGBA buffer painted by regions so every swatch is distinguishable.
function paintedBuffer(w, h, fn) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [r, g, b] = fn(x, y);
    const i = (y * w + x) * 4;
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
  }
  return data;
}

test('v1.312 ambientEdgeColors: the eight swatches average their OWN region (edges + corners)', () => {
  const w = W.AMBIENT_SAMPLE_W, h = W.AMBIENT_SAMPLE_H;
  assert.deepStrictEqual([w, h], [16, 9], 'the off-DOM sample is 16x9 (tiny: the cost floor)');
  // top rows red, bottom rows blue, left columns green, right columns yellow, the
  // corners white - a corner cell is 4x3 (w/4 x h/3), an edge band the rest.
  const data = paintedBuffer(w, h, (x, y) => {
    const corner = (x < 4 || x >= 12) && (y < 3 || y >= 6);
    if (corner) return [255, 255, 255];
    if (y < 3) return [255, 0, 0];
    if (y >= 6) return [0, 0, 255];
    if (x < 4) return [0, 255, 0];
    if (x >= 12) return [255, 255, 0];
    return [0, 0, 0];
  });
  const c = W.ambientEdgeColors(data, w, h);
  assert.deepStrictEqual(c.t, [255, 0, 0]);
  assert.deepStrictEqual(c.b, [0, 0, 255]);
  assert.deepStrictEqual(c.l, [0, 255, 0]);
  assert.deepStrictEqual(c.r, [255, 255, 0]);
  for (const k of ['tl', 'tr', 'bl', 'br']) assert.deepStrictEqual(c[k], [255, 255, 255], k + ' is the corner cell');
});

test('v1.312 ambientLift / ambientGlowVars: black still tints, white never washes out, a hue survives; eight rgb() vars', () => {
  assert.deepStrictEqual(W.ambientLift([0, 0, 0]), [77, 77, 77], 'lightness floor 0.30 -> a dark scene still reads as faint light');
  assert.deepStrictEqual(W.ambientLift([255, 255, 255]), [158, 158, 158], 'lightness ceiling 0.62 -> a white scene does not wash the page');
  const red = W.ambientLift([200, 30, 30]);
  assert.ok(red[0] > red[1] + 60 && red[0] > red[2] + 60, 'a red scene stays red: ' + red.join(','));
  const vars = W.ambientGlowVars({ t: [255, 0, 0], b: [0, 0, 255], l: [0, 255, 0], r: [255, 255, 0], tl: [0, 0, 0], tr: [0, 0, 0], bl: [0, 0, 0], br: [0, 0, 0] });
  assert.deepStrictEqual(Object.keys(vars).sort(), ['--ag-b', '--ag-bl', '--ag-br', '--ag-l', '--ag-r', '--ag-t', '--ag-tl', '--ag-tr']);
  for (const v of Object.values(vars)) assert.match(v, /^rgb\(\d+, \d+, \d+\)$/, v);
  assert.strictEqual(W.ambientGlowVars({}).t, undefined, 'missing swatches default to black-lifted, never a throw');
  assert.strictEqual(W.ambientGlowVars({})['--ag-t'], 'rgb(77, 77, 77)');
});

// ---- (2) the engine, driven with fakes -----------------------------------------

function makeLayer(name) {
  const l = { name, vars: {}, classes: new Set() };
  l.style = { setProperty: (k, v) => { l.vars[k] = v; } };
  l.classList = { add: (c) => l.classes.add(c), remove: (c) => l.classes.delete(c), contains: (c) => l.classes.has(c) };
  return l;
}
function harness(opts) {
  const layers = [makeLayer('A'), makeLayer('B')];
  const glow = { querySelectorAll: () => layers };
  const video = { currentTime: 0, tagName: 'VIDEO' };
  const timers = [];
  const draws = [];
  let shade = 0;
  const ctx = {
    drawImage(...args) { draws.push(args); shade = args[1]; }, // the last sx decides the colour below
    getImageData(x, y, w, h) {
      return { data: paintedBuffer(w, h, () => [Math.min(255, 40 + (shade / 320) * 20), 80, 120]) };
    },
  };
  const canvas = { getContext: () => (opts && opts.throwOnRead ? { drawImage() {}, getImageData() { throw new Error('tainted'); } } : ctx) };
  const loads = [];
  const images = (opts && opts.images) || { '/storyboard/vid1': { naturalWidth: 3200, naturalHeight: 720 } };
  const engine = W.createAmbientEngine({
    glow, video,
    getMediaData: () => (opts && 'mediaData' in opts ? opts.mediaData : VIDEO_ITEM),
    mediaId: opts && 'mediaId' in opts ? opts.mediaId : 'vid1',
    storyboard: STORYBOARD,
    loadImage: (url) => { loads.push(url); return Promise.resolve(images[url] || null); },
    makeCanvas: () => canvas,
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].cancelled = true; },
    clockMs: 1000,
  });
  const tick = () => { const t = timers.pop(); assert.ok(t && !t.cancelled, 'a live clock is armed'); timers.length = 0; t.fn(); };
  const settle = () => new Promise((r) => setImmediate(r));
  const front = () => layers.find((l) => l.classes.has('is-front')) || null;
  return { engine, layers, video, timers, draws, loads, tick, settle, front, images };
}

test('v1.312 engine: start() loads the sprite and paints the FIRST tile onto a layer that becomes the front', async () => {
  const h = harness();
  assert.strictEqual(h.engine.start(), true);
  assert.deepStrictEqual(h.loads, ['/storyboard/vid1'], 'one sprite load');
  assert.strictEqual(h.front(), null, 'nothing painted before the image resolves');
  await h.settle();
  const f = h.front();
  assert.ok(f, 'the resolved image was sampled and a layer is now the front');
  assert.match(f.vars['--ag-t'], /^rgb\(/, 'the eight colour vars landed on the front layer');
  assert.deepStrictEqual(h.engine.painted(), { kind: 'sprite', url: '/storyboard/vid1', index: 0 });
  assert.strictEqual(h.draws.length, 1, 'ONE draw for the first tile');
  assert.deepStrictEqual(h.draws[0].slice(1), [0, 0, 320, 180, 0, 0, 16, 9], 'tile 0 = the top-left 320x180 cell of the 3200x720 sprite, into the 16x9 sample');
});

test('v1.312 engine: a tile change swaps the front layer with NEW colours; the same tile on the clock paints NOTHING', async () => {
  const h = harness();
  h.engine.start(); await h.settle();
  const first = h.front();
  h.tick(); await h.settle();
  assert.strictEqual(h.draws.length, 1, 'same tile (t=0) on the next clock -> no re-sample');
  assert.strictEqual(h.front(), first, 'and no layer swap');
  h.video.currentTime = 27; // frame 10 -> column 0, row 1
  h.tick(); await h.settle();
  assert.strictEqual(h.draws.length, 2, 'a new tile index -> one new sample');
  assert.deepStrictEqual(h.draws[1].slice(1, 5), [0, 180, 320, 180], 'row 1 column 0 of the sprite');
  const second = h.front();
  assert.notStrictEqual(second, first, 'the OTHER layer is now the front (a cross-fade, never a pop)');
  assert.ok(!first.classes.has('is-front'), 'the old front stepped back');
  assert.strictEqual(h.engine.painted().index, 10);
  h.video.currentTime = 29; // still frame 11? 29/2.5 = 11.6 -> frame 11 -> a change
  h.tick(); await h.settle();
  assert.strictEqual(h.engine.painted().index, 11);
  assert.strictEqual(h.front(), first, 'alternates back');
});

test('v1.312 engine: stop() cancels the clock; start() again re-arms; a stopped engine ignores a late image', async () => {
  const h = harness();
  h.engine.start();
  assert.strictEqual(h.engine.running(), true);
  h.engine.stop();
  assert.strictEqual(h.engine.running(), false);
  assert.ok(h.timers.every((t) => t.cancelled), 'the armed clock was cleared');
  await h.settle();
  assert.strictEqual(h.front(), null, 'the sprite that resolved AFTER stop() painted nothing');
  assert.strictEqual(h.engine.start(), true, 're-armable');
  await h.settle();
  assert.ok(h.front(), 'and paints on the re-start (the cached image, no second load)');
  assert.strictEqual(h.loads.length, 1);
});

test('v1.312 engine: a sprite that fails to load FALLS to the poster for the rest of the view', async () => {
  const h = harness({ images: { '/thumbnail/vid1': { naturalWidth: 640, naturalHeight: 360 } } });
  h.engine.start();
  assert.deepStrictEqual(h.loads, ['/storyboard/vid1'], 'the sprite was tried first');
  await h.settle();
  assert.deepStrictEqual(h.loads, ['/storyboard/vid1', '/thumbnail/vid1'], 'the 404 dropped it to the thumbnail at once (no clock needed)');
  await h.settle();
  assert.ok(h.front(), 'the poster painted');
  assert.strictEqual(h.engine.painted().kind, 'image');
  assert.deepStrictEqual(h.draws[0].slice(1), [0, 0, 640, 360, 0, 0, 16, 9], 'the WHOLE poster is sampled');
  h.video.currentTime = 50; h.tick(); await h.settle();
  assert.strictEqual(h.loads.length, 2, 'later tile changes never retry the sprite');
  assert.strictEqual(h.draws.length, 1, 'and a static poster is never re-sampled');
});

test('v1.312 engine: a poster that fails too paints NOTHING (no default hue); no id samples nothing', async () => {
  const h = harness({ images: {} });
  h.engine.start(); await h.settle(); h.tick(); await h.settle(); h.tick(); await h.settle();
  assert.strictEqual(h.front(), null, 'no colours were ever painted');
  assert.strictEqual(h.engine.painted(), null);
  const none = harness({ mediaId: null });
  none.engine.start(); await none.settle();
  assert.strictEqual(none.loads.length, 0, 'no id -> no load');
});

test('v1.312 engine: a sample throw (tainted/zero canvas) HARD-FAILS this engine - stopped and never re-armed', async () => {
  const h = harness({ throwOnRead: true });
  h.engine.start(); await h.settle();
  assert.strictEqual(h.engine.hardFailed(), true);
  assert.strictEqual(h.engine.running(), false, 'the clock is gone');
  assert.strictEqual(h.engine.start(), false, 'start() refuses after a hard failure (no throw/catch/re-arm spin)');
  assert.strictEqual(h.front(), null);
});

test('v1.312 THE CONSTRAINT: the engine never hands the VIDEO element to drawImage - only the loaded image', async () => {
  const h = harness();
  h.engine.start(); await h.settle();
  h.video.currentTime = 27; h.tick(); await h.settle();
  assert.ok(h.draws.length >= 2);
  for (const d of h.draws) {
    assert.notStrictEqual(d[0], h.video, 'the media element is NEVER a draw source');
    assert.strictEqual(d[0], h.images['/storyboard/vid1'], 'the draw source is the same-origin sprite image');
  }
});

// ---- (3) the source / CSS / HTML locks -----------------------------------------

test('v1.312 SOURCE LOCK: no drawImage from a media element anywhere in the ambient code (engine + wiring), and the video is read for time only', () => {
  const draws = [...ENGINE_SRC.matchAll(/drawImage\(\s*([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
  assert.deepStrictEqual(draws, ['img'], 'exactly one drawImage in the engine and its source is the loaded IMAGE');
  assert.doesNotMatch(WIRING_SRC, /drawImage|getContext|captureStream|requestVideoFrameCallback/, 'the wiring never touches a canvas or the video\'s frames');
  assert.doesNotMatch(ENGINE_SRC, /video\.(videoWidth|videoHeight|captureStream|requestVideoFrameCallback)/, 'the engine reads the video for currentTime only');
  assert.match(ENGINE_SRC, /Number\(video\.currentTime\)/, 'currentTime is the ONLY thing read off the video');
  assert.doesNotMatch(ENGINE_SRC + WIRING_SRC, /requestAnimationFrame/, 'no frame-loop residency (the v1.187.2 cost floor)');
  assert.match(ENGINE_SRC, /timerId = setT\(tick, clockMs\)/, 'a plain 1s clock');
  assert.strictEqual(W.AMBIENT_CLOCK_MS, 1000);
});

test('v1.312 WIRING LOCK: setupAmbientMode builds the engine from the view (lazy mediaData, the player\'s storyboard geometry, an OFF-DOM canvas) and funnels start/stop', () => {
  assert.match(WIRING_SRC, /const engine = createAmbientEngine\(\{/, 'the engine is created in the wiring');
  assert.match(WIRING_SRC, /getMediaData: function \(\) \{ return mediaData; \}/, 'mediaData is read LAZILY (the v1.197.1 TDZ lesson)');
  assert.match(WIRING_SRC, /storyboard: \(window\.FileTube && window\.FileTube\.storyboard\) \|\| null/, 'the sprite geometry comes from the player module, guarded');
  assert.match(WIRING_SRC, /makeCanvas: function \(\) \{ return document\.createElement\('canvas'\); \}/, 'the sample canvas is created OFF-DOM (never appended)');
  assert.doesNotMatch(WIRING_SRC, /appendChild\(|insertBefore\(|insertAdjacentElement\(/, 'nothing is ever inserted into the document by ambient');
  const startFn = fnBody(WIRING_SRC, 'function start() {', '      ');
  const stopFn = fnBody(WIRING_SRC, 'function stop() {', '      ');
  assert.match(startFn, /glow\.hidden = false;[\s\S]*glow\.classList\.add\('is-on'\)[\s\S]*setAttribute\('data-ambient-on', ''\)[\s\S]*engine\.start\(\)/, 'start: reveal, is-on, the sidebar signal, then the engine');
  assert.match(stopFn, /engine\.stop\(\)[\s\S]*classList\.remove\('is-on'\)[\s\S]*glow\.hidden = true;[\s\S]*removeAttribute\('data-ambient-on'\)/, 'stop: the engine, is-on, hide, the sidebar signal');
  assert.match(WIRING_SRC, /if \(shouldRun\(\)\) start\(\); else stop\(\);/, 'the one gate');
  assert.match(WIRING_SRC, /ambientShouldRun\(\{ prefOn: prefOn, dark: isDarkMode\(document\), playing: currentlyPlaying\(\), docVisible: !document\.hidden \}\)/, 'the pure predicate, all four axes');
  for (const ev of ['play', 'playing', 'pause', 'ended', 'emptied']) assert.match(WIRING_SRC, new RegExp("video\\.addEventListener\\('" + ev + "', evaluate, \\{ signal \\}\\)"), ev + ' re-evaluates');
  assert.match(WIRING_SRC, /document\.addEventListener\('visibilitychange', evaluate, \{ signal \}\)/, 'tab hide/show re-evaluates');
  assert.match(WIRING_SRC, /attributeFilter: \['data-mode', 'data-theme'\]/, 'a theme flip re-evaluates');
  assert.match(WIRING_SRC, /signal\.addEventListener\('abort', \(\) => \{ stop\(\); if \(themeObs\)[\s\S]*disconnect\(\)/, 'teardown stops the engine + disconnects the observer');
  assert.match(WIRING_SRC, /im\.src = url;/, 'images load through a plain Image');
  assert.match(WIRING_SRC, /localStorage\.setItem\('ft-ambient', ambientStorageValue\(prefOn\)\)/, 'the pref key is unchanged');
  assert.match(WIRING_SRC, /localStorage\.setItem\('ft-ambient-intensity', level\)/, 'the intensity key is unchanged');
  assert.match(WIRING_SRC, /if \(levelRow\) levelRow\.hidden = !dark \|\| !prefOn;/, 'the amount row still needs dark AND on (gate S5)');
});

// Every rule whose selector mentions .ambient-glow, comment-stripped, as {selector, body}.
function glowRules() {
  const css = STYLE_CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...css.matchAll(/([^{}]*\.ambient-glow[^{}]*)\{([^}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2] }));
}

test('v1.312 CSS LOCK: NO .ambient-glow rule carries a filter / transform / mask / backdrop-filter / will-change (the second iOS suspect)', () => {
  const rules = glowRules();
  assert.ok(rules.length >= 8, 'the glow rules exist (' + rules.length + ')');
  for (const r of rules) {
    for (const prop of ['filter', 'transform', 'mask-image', '-webkit-mask-image', 'mask', 'backdrop-filter', 'will-change', 'mix-blend-mode']) {
      assert.doesNotMatch(r.body, new RegExp('(^|[\\s;])' + prop.replace(/[-]/g, '\\-') + '\\s*:'), r.selector + ' must not declare ' + prop);
    }
  }
  assert.doesNotMatch(WATCH_HTML, /<canvas id="ambient-glow"/, 'the canvas is gone from the view');
  assert.match(WATCH_HTML, /<div id="ambient-glow" class="ambient-glow" aria-hidden="true" hidden>\s*<div class="ambient-glow-layer"><\/div>\s*<div class="ambient-glow-layer"><\/div>\s*<\/div>/, 'a div pair: the glow with exactly two layers, born hidden');
});

test('v1.312 CSS GEOMETRY: the glow reaches by negative insets; each band is the reach re-expressed in ELEMENT terms; the ladder is opacity-only except extreme', () => {
  const base = glowRules().find((r) => r.selector === '.ambient-glow');
  assert.ok(base, 'the base rule');
  const num = (body, name) => { const m = new RegExp('--ambient-' + name + ':\\s*([0-9.]+)%').exec(body); assert.ok(m, name + ' declared'); return Number(m[1]); };
  const check = (body, label) => {
    const rx = num(body, 'reach-x'), ry = num(body, 'reach-y'), bx = num(body, 'band-x'), by = num(body, 'band-y');
    assert.ok(Math.abs(bx - (rx / (100 + 2 * rx)) * 100) < 0.01, label + ': band-x ' + bx + ' must be reach-x/(100+2*reach-x) = ' + (rx / (100 + 2 * rx)) * 100);
    assert.ok(Math.abs(by - (ry / (100 + 2 * ry)) * 100) < 0.01, label + ': band-y ' + by + ' must be reach-y/(100+2*reach-y)');
    assert.ok(rx > 0 && ry > 0, label + ': reach > 0 on both axes (the v1.187.1 reach invariant, now by construction)');
    return { rx, ry };
  };
  const b = check(base.body, 'base');
  assert.ok(b.rx >= 10 && b.rx <= 14 && b.ry >= 18 && b.ry <= 26, 'the base reach matches YouTube\'s measured ~11% / ~20%: ' + JSON.stringify(b));
  for (const side of ['top', 'bottom']) assert.match(base.body, new RegExp(side + ':\\s*calc\\(-1 \\* var\\(--ambient-reach-y\\)\\)'), side + ' is the negative y reach');
  for (const side of ['left', 'right']) assert.match(base.body, new RegExp(side + ':\\s*calc\\(-1 \\* var\\(--ambient-reach-x\\)\\)'), side + ' is the negative x reach');
  assert.match(base.body, /z-index:\s*-1/, 'behind #player-slot');
  assert.match(base.body, /pointer-events:\s*none/);
  const on = glowRules().find((r) => r.selector === '.ambient-glow.is-on');
  assert.match(on.body, /opacity:\s*var\(--ambient-opacity, 0\.55\)/, 'the on-state opacity is the rung var, normal-defaulted');
  const rung = (n) => glowRules().find((r) => r.selector === '.ambient-glow[data-ambient="' + n + '"]');
  const op = (n) => Number(/--ambient-opacity:\s*([0-9.]+)/.exec(rung(n).body)[1]);
  assert.ok(op('subtle') < op('normal') && op('normal') < op('intense') && op('intense') < op('extreme'), 'strictly increasing ladder');
  assert.ok(op('extreme') <= 1, 'extreme caps at fully opaque gradients');
  for (const n of ['subtle', 'normal', 'intense']) assert.doesNotMatch(rung(n).body, /--ambient-reach/, n + ' changes brightness only');
  const ex = check(rung('extreme').body, 'extreme');
  assert.ok(ex.rx > b.rx && ex.ry > b.ry, 'extreme widens the reach');
  // the level rides the data attribute (CSS owns the numbers), set by the wiring
  assert.match(WIRING_SRC, /glow\.setAttribute\('data-ambient', level\)/);
});

test('v1.312 CSS PAINT: the layer stacks eight gradients (four edge bands + four corner ellipses), every colour var falls back to transparent, and the layers cross-fade on opacity', () => {
  const layer = glowRules().find((r) => r.selector === '.ambient-glow-layer');
  assert.ok(layer, 'the layer rule');
  const bg = /background:\s*([\s\S]*?);\s*(?:\n|$)/.exec(layer.body);
  assert.ok(bg, 'a background stack');
  const parts = bg[1].split(/,\s*\n\s*/);
  assert.strictEqual(parts.length, 8, 'eight gradient layers');
  const linear = parts.filter((p) => /^linear-gradient\(/.test(p)), radial = parts.filter((p) => /^radial-gradient\(/.test(p));
  assert.strictEqual(linear.length, 4, 'four edge bands');
  assert.strictEqual(radial.length, 4, 'four corner ellipses');
  for (const dir of ['top', 'bottom', 'left', 'right']) assert.ok(linear.some((p) => p.startsWith('linear-gradient(to ' + dir + ',')), 'a band fading outward ' + dir);
  for (const k of ['t', 'b', 'l', 'r', 'tl', 'tr', 'bl', 'br']) assert.ok(parts.some((p) => p.includes('var(--ag-' + k + ', transparent)')), '--ag-' + k + ' is used with a transparent fallback');
  for (const p of parts) assert.match(p, /, transparent\)/, 'every gradient ends transparent (no hard cut): ' + p.slice(0, 40));
  for (const p of parts) assert.match(p, /no-repeat$/, p.slice(0, 40));
  assert.match(layer.body, /transition:\s*opacity var\(--ambient-fade\) linear/, 'the cross-fade');
  assert.match(layer.body, /opacity:\s*0/, 'a layer is invisible until it is the front');
  const front = glowRules().find((r) => r.selector === '.ambient-glow-layer.is-front');
  assert.match(front.body, /opacity:\s*1/, 'the front layer shows');
  assert.match(STYLE_CSS, /@media \(prefers-reduced-motion: reduce\) \{\n {2}\.ambient-glow,\n {2}\.ambient-glow-layer \{ transition: none; \}/, 'reduced motion drops both transitions');
  // the light belt + the sidebar bleed survive the rebuild
  assert.ok(glowRules().some((r) => r.selector === ':root:not([data-mode="dark"]) .ambient-glow' && /opacity:\s*0 !important/.test(r.body)), 'the dark-only belt');
  assert.match(STYLE_CSS, /:root\[data-ambient-on\] \.sidebar \{/, 'the v1.188 sidebar bleed');
});
