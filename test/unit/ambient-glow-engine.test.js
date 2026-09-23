'use strict';

// [UNIT] v1.312 (Dean, device): AMBIENT MODE REBUILD. Ambient ON blacked out EVERY
// video on his iPhone (picture ~1s, then black; audio + glow colours continued; on
// every build back to 1.311.1; OFF = picture). The old effect copied the live
// <video> into a canvas every 500ms AND composited a blurred + masked + scaled
// layer beside it - both iOS video/canvas/GPU-process breakage shapes. The rebuild
// is colour-only: sample a same-origin IMAGE (storyboard sprite tile at the current
// time, else the poster) OFF-DOM, paint CSS gradients on two cross-fading divs.
//
// v1.313 POLISH (Dean: "hard borders/edges, look at the player corners"): the
// eight gradients became ONE vignetted tiny bitmap (the tile stretched over the
// glow box, alpha 1 under the player -> 0 at the box edge, rounded corners) set
// as the layer's background-image; the bilinear upscale is the blur.
//
// Bound here: (1) the pure source ladder + the vignette maths, (2) the engine
// driven end to end with fakes (paints on a tile change, never on the same tile,
// falls to the poster, hard-fails safely, and NEVER draws the video), (3) the
// CSS / HTML / wiring locks that keep the two iOS suspects out of the tree.
// Plans: docs/exec-plans/completed/2026-09-23-ambient-glow-rebuild.md,
//        docs/exec-plans/active/2026-09-23-ambient-glow-polish.md

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
  assert.strictEqual(W.ambientSourceFor({ type: 'video' }, '', 5, STORYBOARD), null, 'no id AND no art -> nothing to sample');
});

// Gate r1 (adversary F1, CRITICAL): the `?tv=` path has NO mediaId - resolveWatchMediaId
// reads only ?v=/?id= - and the first cut gated EVERY rung on the id, so tv episodes
// lit the DOM with nothing painted (a divergent fixture had passed 'ep1'). Drive the
// REAL production shape: mediaId null, the tv descriptor (type 'video', artUrl, no
// storyboard), and lock that the tv route really emits that artUrl.
const TV_DESCRIPTOR = { type: 'video', artUrl: '/tvposter/show1', duration: 1200, channelName: 'Show' };
test('v1.312 gate F1: the tv REAL shape (no mediaId, artUrl) takes the POSTER rung - and the tv route really carries artUrl', () => {
  assert.deepStrictEqual(W.ambientSourceFor(TV_DESCRIPTOR, null, 5, STORYBOARD), { kind: 'image', url: '/tvposter/show1', index: 0 });
  assert.deepStrictEqual(W.ambientSourceFor(TV_DESCRIPTOR, undefined, 5, STORYBOARD), { kind: 'image', url: '/tvposter/show1', index: 0 });
  assert.strictEqual(W.ambientSourceFor({ type: 'video', storyboard: GEOM, artUrl: '/x.jpg' }, null, 5, STORYBOARD).kind, 'image', 'without an id there is no sprite URL to build - the art wins');
  const tvRoutes = stripComments(fs.readFileSync(path.join(REPO, 'lib/tv/routes.js'), 'utf8'));
  assert.match(tvRoutes, /artUrl: `\/tvposter\/\$\{encodeURIComponent\(ep\.showId\)\}`/, 'the tv episode descriptor carries the poster artUrl the rung relies on');
  assert.match(stripComments(WATCH_JS), /const mediaId = resolveWatchMediaId\(window\.location\.search\);/, 'and the watch id really is ?v=/?id= only (why tv has none)');
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

// Read a pixel's alpha off a vignetted buffer.
const alphaAt = (data, w, x, y) => data[(y * w + x) * 4 + 3];

test('v1.313 ambientVignette: opaque under the player, ZERO on the outermost ring, monotonic outward, rounded at the corners', () => {
  const w = W.AMBIENT_SAMPLE_W, h = W.AMBIENT_SAMPLE_H;
  assert.deepStrictEqual([w, h], [64, 36], 'the off-DOM bitmap is 64x36 (tiny: the upscale is the blur, the per-paint cost is microseconds)');
  assert.deepStrictEqual([W.AMBIENT_REACH_X, W.AMBIENT_REACH_Y], [0.12, 0.22], 'YouTube\'s measured reach (~11% / ~20%)');
  const data = W.ambientVignette(paintedBuffer(w, h, () => [120, 60, 200]), w, h, null);
  const cx = w / 2, cy = h / 2;
  // the inner rectangle = the player: 1/(1+2*reach) of each half-axis
  const ix = Math.floor((w / 2) / (1 + 2 * W.AMBIENT_REACH_X)), iy = Math.floor((h / 2) / (1 + 2 * W.AMBIENT_REACH_Y));
  assert.strictEqual(alphaAt(data, w, cx, cy), 255, 'the centre is opaque');
  assert.strictEqual(alphaAt(data, w, cx - ix + 1, cy - iy + 1), 255, 'just inside the player\'s corner is opaque (the rounded-corner gap shows the frame, not a notch)');
  for (let x = 0; x < w; x++) { assert.strictEqual(alphaAt(data, w, x, 0), 0, 'top ring x=' + x); assert.strictEqual(alphaAt(data, w, x, h - 1), 0, 'bottom ring x=' + x); }
  for (let y = 0; y < h; y++) { assert.strictEqual(alphaAt(data, w, 0, y), 0, 'left ring y=' + y); assert.strictEqual(alphaAt(data, w, w - 1, y), 0, 'right ring y=' + y); }
  // monotonic non-increasing outward along the mid row and the mid column
  for (let x = cx; x < w - 1; x++) assert.ok(alphaAt(data, w, x + 1, cy) <= alphaAt(data, w, x, cy), 'mid row falls outward at x=' + x);
  for (let y = cy; y < h - 1; y++) assert.ok(alphaAt(data, w, cx, y + 1) <= alphaAt(data, w, cx, y), 'mid column falls outward at y=' + y);
  // the corner diagonal is dimmer than the edge midpoint at the same outward fraction (hypot, not max)
  const outX = w - 1 - Math.round((w / 2 - ix) / 2), outY = h - 1 - Math.round((h / 2 - iy) / 2); // halfway across the reach
  assert.ok(alphaAt(data, w, outX, outY) < alphaAt(data, w, outX, cy), 'corner (' + alphaAt(data, w, outX, outY) + ') < right edge (' + alphaAt(data, w, outX, cy) + ') at the same fraction');
  assert.ok(alphaAt(data, w, outX, outY) < alphaAt(data, w, cx, outY), 'corner < bottom edge at the same fraction');
  assert.ok(alphaAt(data, w, outX, cy) > 60 && alphaAt(data, w, outX, cy) < 200, 'halfway across the reach is a mid alpha (a real ramp, not a step): ' + alphaAt(data, w, outX, cy));
  // the colour was lifted in place (the same pixel colour everywhere; a hue survives)
  assert.ok(data[2] > data[0] && data[0] > data[1], 'the purple stays purple after the lift: ' + [data[0], data[1], data[2]].join(','));
  // a steeper gamma falls faster
  const steep = W.ambientVignette(paintedBuffer(w, h, () => [120, 60, 200]), w, h, { rx: 0.12, ry: 0.22, gamma: 3 });
  assert.ok(alphaAt(steep, w, outX, cy) < alphaAt(data, w, outX, cy), 'gamma is the falloff knob');
  assert.strictEqual(W.AMBIENT_VIGNETTE_GAMMA, 1.5, 'YouTube\'s measured falloff (~half at 37% of the reach, ~15% at 73%)');
});

test('v1.313 ambientLift: a dark scene glows DIMLY (floor 0.12, not the old grey 0.30), white never washes out, a hue survives', () => {
  assert.deepStrictEqual(W.ambientLift([0, 0, 0]), [31, 31, 31], 'lightness floor 0.12 -> a black scene barely tints (the v1.312 0.30 floor was the grey slab)');
  assert.deepStrictEqual(W.ambientLift([255, 255, 255]), [158, 158, 158], 'lightness ceiling 0.62 -> a white scene does not wash the page');
  const red = W.ambientLift([200, 30, 30]);
  assert.ok(red[0] > red[1] + 60 && red[0] > red[2] + 60, 'a red scene stays red: ' + red.join(','));
  const dim = W.ambientLift([40, 20, 60]);
  assert.ok(dim[2] > dim[0] && dim[0] > dim[1] && dim[2] < 110, 'a dim purple stays a DIM purple, not a lifted grey: ' + dim.join(','));
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
  const puts = []; // every putImageData's buffer (the vignetted bitmap the PNG is made of)
  const ctx = {
    drawImage(...args) { draws.push(args); shade = args[1] + args[2]; }, // the tile position (sx + sy) decides the colour below
    getImageData(x, y, w, h) {
      return { data: paintedBuffer(w, h, () => [Math.min(255, 40 + (shade / 320) * 20), 80, 120]), width: w, height: h };
    },
    putImageData(id) { puts.push(id.data); },
  };
  // A content-addressed fake PNG: the same bitmap -> the same URL, a different tile -> a different URL.
  const canvas = {
    getContext: () => (opts && opts.throwOnRead ? { drawImage() {}, getImageData() { throw new Error('tainted'); } } : ctx),
    toDataURL: (type) => { const last = puts[puts.length - 1]; let hsh = 0; for (let i = 0; i < last.length; i++) hsh = (hsh * 31 + last[i]) >>> 0; return 'data:' + type + ';base64,' + hsh.toString(36); },
  };
  const loads = [];
  const pendingLoads = []; // when opts.slowLoads: resolvers, released by h.release()
  const images = (opts && opts.images) || { '/storyboard/vid1': { naturalWidth: 3200, naturalHeight: 720 } };
  let hardFails = 0;
  const engine = W.createAmbientEngine({
    glow, video,
    getMediaData: () => (opts && 'mediaData' in opts ? opts.mediaData : VIDEO_ITEM),
    mediaId: opts && 'mediaId' in opts ? opts.mediaId : 'vid1',
    storyboard: STORYBOARD,
    loadImage: (url) => {
      loads.push(url);
      if (opts && opts.slowLoads) return new Promise((resolve) => { pendingLoads.push(() => resolve(images[url] || null)); });
      return Promise.resolve(images[url] || null);
    },
    makeCanvas: () => canvas,
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].cancelled = true; },
    clockMs: 1000,
    onHardFail: () => { hardFails++; },
  });
  const tick = () => { const t = timers.pop(); assert.ok(t && !t.cancelled, 'a live clock is armed'); timers.length = 0; t.fn(); };
  const settle = () => new Promise((r) => setImmediate(r));
  const front = () => layers.find((l) => l.classes.has('is-front')) || null;
  const release = () => { const r = pendingLoads.splice(0); r.forEach((fn) => fn()); };
  const liveTimers = () => timers.filter((t) => !t.cancelled).length;
  return { engine, layers, video, timers, draws, loads, tick, settle, front, images, release, liveTimers, hardFails: () => hardFails, ctx, canvas, puts };
}

test('v1.312 gate F1: the engine with the tv REAL shape (mediaId null, artUrl) LOADS and paints the poster', async () => {
  const h = harness({ mediaId: null, mediaData: TV_DESCRIPTOR, images: { '/tvposter/show1': { naturalWidth: 600, naturalHeight: 900 } } });
  assert.strictEqual(h.engine.start(), true);
  assert.deepStrictEqual(h.loads, ['/tvposter/show1'], 'the poster is requested with NO id in play');
  await h.settle();
  assert.ok(h.front(), 'and painted');
  assert.deepStrictEqual(h.engine.painted(), { kind: 'image', url: '/tvposter/show1', index: 0 });
  assert.deepStrictEqual(h.draws[0].slice(1), [0, 0, 600, 900, 0, 0, 64, 36], 'the whole poster is sampled');
});

test('v1.312 engine: start() loads the sprite and paints the FIRST tile onto a layer that becomes the front', async () => {
  const h = harness();
  assert.strictEqual(h.engine.start(), true);
  assert.deepStrictEqual(h.loads, ['/storyboard/vid1'], 'one sprite load');
  assert.strictEqual(h.front(), null, 'nothing painted before the image resolves');
  await h.settle();
  const f = h.front();
  assert.ok(f, 'the resolved image was sampled and a layer is now the front');
  assert.match(f.vars['background-image'], /^url\("data:image\/png;base64,[^"]+"\)$/, 'the vignetted PNG data URL landed on the front layer as its background-image');
  assert.strictEqual(h.puts.length, 1, 'the vignetted bitmap was written back before encoding');
  assert.strictEqual(alphaAt(h.puts[0], 64, 0, 0), 0, 'its outermost ring is transparent');
  assert.strictEqual(alphaAt(h.puts[0], 64, 32, 18), 255, 'its centre (under the player) is opaque');
  assert.deepStrictEqual(h.engine.painted(), { kind: 'sprite', url: '/storyboard/vid1', index: 0 });
  assert.strictEqual(h.draws.length, 1, 'ONE draw for the first tile');
  assert.deepStrictEqual(h.draws[0].slice(1), [0, 0, 320, 180, 0, 0, 64, 36], 'tile 0 = the top-left 320x180 cell of the 3200x720 sprite, stretched over the 64x36 bitmap');
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
  assert.notStrictEqual(second.vars['background-image'], first.vars['background-image'], 'with a DIFFERENT bitmap (the new tile)');
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
  assert.deepStrictEqual(h.draws[0].slice(1), [0, 0, 640, 360, 0, 0, 64, 36], 'the WHOLE poster is sampled');
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
  // Gate r1 (adversary F2 / QA W1): the sample runs AFTER the async image load, so
  // the wiring cannot see the failure by return value - it must be told, once.
  assert.strictEqual(h.hardFails(), 1, 'onHardFail fired exactly once, after the load resolved');
  assert.strictEqual(h.engine.start(), false); await h.settle();
  assert.strictEqual(h.hardFails(), 1, 'a refused re-start does not fire it again');
});

test('v1.312 gate F4 (M13): a SYNC sample throw on the clock never re-arms the clock', async () => {
  const h = harness();
  h.engine.start(); await h.settle();
  assert.ok(h.front(), 'first tile painted with a healthy canvas');
  h.ctx.getImageData = () => { throw new Error('canvas gone'); }; // the image is cached now, so the next sample is synchronous inside tick()
  h.video.currentTime = 27;
  h.tick();
  assert.strictEqual(h.engine.hardFailed(), true);
  assert.strictEqual(h.liveTimers(), 0, 'tick() did not arm another clock after the failure');
  assert.strictEqual(h.hardFails(), 1);
});

test('v1.312 gate F4 (M14): a ZERO-SIZE image is a failed source - it falls to the poster instead of re-sampling forever', async () => {
  const h = harness({ images: { '/storyboard/vid1': { naturalWidth: 0, naturalHeight: 0 }, '/thumbnail/vid1': { naturalWidth: 640, naturalHeight: 360 } } });
  h.engine.start(); await h.settle();
  for (let i = 0; i < 5; i++) { h.tick(); await h.settle(); }
  assert.deepStrictEqual(h.loads, ['/storyboard/vid1', '/thumbnail/vid1'], 'the broken sprite dropped to the thumbnail, once');
  assert.strictEqual(h.engine.painted().kind, 'image');
  assert.strictEqual(h.draws.length, 1, 'the poster painted once; the zero-size sprite was never drawn');
});

test('v1.312 gate F4 (M16): a SLOW sprite is requested ONCE across many clocks, then paints the CURRENT tile when it lands', async () => {
  const h = harness({ slowLoads: true });
  h.engine.start();
  for (let i = 0; i < 4; i++) { h.tick(); await h.settle(); }
  assert.strictEqual(h.loads.length, 1, 'one in-flight load, no duplicates while it is pending');
  assert.strictEqual(h.front(), null);
  h.video.currentTime = 27; // the tile moved on while the sprite was loading
  h.release(); await h.settle(); await h.settle();
  assert.ok(h.front(), 'painted once the sprite landed');
  assert.strictEqual(h.engine.painted().index, 10, 'with the tile of NOW (t=27), not the tile of the request (t=0)');
  assert.strictEqual(h.loads.length, 1);
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
  assert.match(ENGINE_SRC, /ambientVignette\(id\.data, AMBIENT_SAMPLE_W, AMBIENT_SAMPLE_H, null\)/, 'v1.313: the bitmap is vignetted with the shared reach constants');
  assert.match(ENGINE_SRC, /c\.putImageData\(id, 0, 0\)[\s\S]*canvas\.toDataURL\('image\/png'\)/, 'written back, then encoded as a PNG');
  assert.match(ENGINE_SRC, /url\.indexOf\('data:image\/png'\) === 0/, 'anything but a PNG data URL is a failed sample (never a canvas/element() paint reference)');
  assert.match(ENGINE_SRC, /back\.style\.setProperty\('background-image', 'url\("' \+ dataUrl \+ '"\)'\)/, 'the back layer paints the bitmap as a plain background-image');
  assert.doesNotMatch(ENGINE_SRC + WIRING_SRC, /-webkit-canvas|element\(|filter|transform/, 'no paint reference to a live canvas/element and no filter/transform from JS either');
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
  assert.match(WIRING_SRC, /mediaId: mediaId,/, 'the view id reaches the engine (the sprite/thumbnail rungs need it; tv has none and rides artUrl)');
  assert.match(WIRING_SRC, /onHardFail: function \(\) \{ stop\(\); \}/, 'gate r1 F2/W1: an async hard failure tears the DOM down through the wiring\'s own stop()');
  assert.match(fnBody(WIRING_SRC, 'function start() {', '      '), /if \(engine\.hardFailed\(\)\) return;/, 'a hard-failed engine is never re-lit (M17)');
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
  // v1.312 (Dean): the v1.187 amount ladder is GONE - one look, no picker, no key.
  assert.doesNotMatch(WIRING_SRC, /ft-ambient-intensity|ambient-level|data-ambient'|resolveAmbientLevel/, 'no ladder in the wiring');
  assert.doesNotMatch(STRIPPED_JS, /AMBIENT_LEVELS|resolveAmbientLevel|watch-ambient-level|ambient-level-row|Ambient amount/, 'no ladder anywhere in watch.js (the cog row, the helpers, the exports)');
  for (const f of ['public/js/prefs-sync.js', 'lib/prefs-allowlist.js']) assert.ok(!fs.readFileSync(path.join(REPO, f), 'utf8').includes('ft-ambient-intensity'), f + ': the dead key left the sync allowlist (a key nothing writes can never sync)');
  assert.doesNotMatch(STYLE_CSS.replace(/\/\*[\s\S]*?\*\//g, ''), /ambient-level-row|settings-menu-select|data-ambient="/, 'no ladder CSS (rows, picker, rungs)');
});

// Every rule whose selector mentions .ambient-glow, comment-stripped, as {selector, body}.
function glowRules() {
  const css = STYLE_CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...css.matchAll(/([^{}]*\.ambient-glow[^{}]*)\{([^}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2] }));
}
// Gate r1 (adversary F3): the constraint must cover EVERY rule that can reach the glow
// or the video's ancestor stage - by id, by class, by child/attribute selectors, or
// via the stage itself (`#ambient-glow {…}`, `.watch-player-stage > div:first-child`,
// a `transform` on `.watch-player-stage` all shipped gate-green under the class-only sweep).
function stageAndGlowRules() {
  const css = STYLE_CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...css.matchAll(/([^{}]*(?:ambient-glow|watch-player-stage)[^{}]*)\{([^}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2] }));
}

test('v1.312 CSS LOCK: NO rule reaching the glow OR the player stage carries a filter / transform / mask / backdrop-filter / will-change (the second iOS suspect)', () => {
  const rules = stageAndGlowRules();
  assert.ok(rules.length >= 9, 'the glow + stage rules exist (' + rules.length + ')'); // glow: base, is-on, layer, is-front, light belt, reduced-motion; stage: base, mobile clip, the fullscreen z-index drop
  assert.ok(rules.some((r) => /^\.watch-player-stage$/.test(r.selector)), 'the stage base rule is in the sweep');
  for (const r of rules) {
    for (const prop of ['filter', 'transform', 'mask-image', '-webkit-mask-image', 'mask', 'backdrop-filter', 'will-change', 'mix-blend-mode']) {
      assert.doesNotMatch(r.body, new RegExp('(^|[\\s;])' + prop.replace(/[-]/g, '\\-') + '\\s*:'), r.selector + ' must not declare ' + prop);
    }
  }
  assert.doesNotMatch(WATCH_HTML, /<canvas id="ambient-glow"/, 'the canvas is gone from the view');
  assert.match(WATCH_HTML, /<div id="ambient-glow" class="ambient-glow" aria-hidden="true" hidden>\s*<div class="ambient-glow-layer"><\/div>\s*<div class="ambient-glow-layer"><\/div>\s*<\/div>/, 'a div pair: the glow with exactly two layers, born hidden');
});

test('v1.312 CSS GEOMETRY: the glow reaches by negative insets; each band is the reach re-expressed in ELEMENT terms; ONE YouTube-matched opacity, no ladder', () => {
  const base = glowRules().find((r) => r.selector === '.ambient-glow');
  assert.ok(base, 'the base rule');
  const num = (body, name) => { const m = new RegExp('--ambient-' + name + ':\\s*([0-9.]+)%').exec(body); assert.ok(m, name + ' declared'); return Number(m[1]); };
  const check = (body, label) => {
    const rx = num(body, 'reach-x'), ry = num(body, 'reach-y');
    // v1.313: the CSS reach and the JS vignette's inner rectangle are ONE number (a
    // hand-copy that drifts lands the glow's peak off the player's edge).
    assert.strictEqual(rx, W.AMBIENT_REACH_X * 100, label + ': --ambient-reach-x equals watch.js AMBIENT_REACH_X');
    assert.strictEqual(ry, W.AMBIENT_REACH_Y * 100, label + ': --ambient-reach-y equals watch.js AMBIENT_REACH_Y');
    assert.doesNotMatch(body, /--ambient-band-/, label + ': no band vars remain (nothing reads them)');
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
  assert.match(on.body, /opacity:\s*var\(--ambient-opacity\)/, 'the on-state opacity is the ONE tuning var');
  const op = Number(/--ambient-opacity:\s*([0-9.]+)/.exec(base.body)[1]);
  // MEASURED (plan Step 4): 0.55 peaked ~+92/255 at the edge, ~3x YouTube's ~+25;
  // 0.3 lands on YouTube. Dean, 2026-09-23: "YouTube style", no ladder.
  assert.ok(op >= 0.25 && op <= 0.35, 'the single opacity sits at YouTube\'s measured peak (0.3), not the old 0.55: ' + op);
  assert.strictEqual(glowRules().filter((r) => /data-ambient=/.test(r.selector)).length, 0, 'no rung rules remain');
});

test('v1.313 CSS PAINT: the layer is a plain background-image slot (100% 100%, no-repeat, NO gradients / colour vars), and the layers cross-fade on opacity', () => {
  const layer = glowRules().find((r) => r.selector === '.ambient-glow-layer');
  assert.ok(layer, 'the layer rule');
  assert.match(layer.body, /background-size:\s*100% 100%/, 'the bitmap is stretched to the whole layer (its inner rectangle IS the player box)');
  assert.match(layer.body, /background-repeat:\s*no-repeat/);
  assert.doesNotMatch(layer.body, /gradient\(|--ag-|background-image:|background:/, 'no CSS-side paint: the image is set inline by the engine, one continuous bitmap (v1.313: the eight gradients had hard band ends + corner notches)');
  assert.doesNotMatch(layer.body, /image-rendering/, 'the default bilinear upscale IS the softness');
  assert.doesNotMatch(STYLE_CSS.replace(/\/\*[\s\S]*?\*\//g, ''), /--ag-[a-z]+|--ambient-band-/, 'the swatch vars and band vars are gone from the sheet');
  assert.match(layer.body, /transition:\s*opacity var\(--ambient-fade\) linear/, 'the cross-fade');
  assert.match(layer.body, /opacity:\s*0/, 'a layer is invisible until it is the front');
  const front = glowRules().find((r) => r.selector === '.ambient-glow-layer.is-front');
  assert.match(front.body, /opacity:\s*1/, 'the front layer shows');
  assert.match(STYLE_CSS, /@media \(prefers-reduced-motion: reduce\) \{\n {2}\.ambient-glow,\n {2}\.ambient-glow-layer \{ transition: none; \}/, 'reduced motion drops both transitions');
  // the light belt + the sidebar bleed survive the rebuild
  assert.ok(glowRules().some((r) => r.selector === ':root:not([data-mode="dark"]) .ambient-glow' && /opacity:\s*0 !important/.test(r.body)), 'the dark-only belt');
  assert.match(STYLE_CSS, /:root\[data-ambient-on\] \.sidebar \{/, 'the v1.188 sidebar bleed');
  // QA r1 S3: the toggle row's belts were bound by a retired v1.187 test - re-lock them
  // (gate W5 there: `[hidden]` loses to the label's `display: inline-flex`, so the
  // !important override is load-bearing).
  assert.match(STYLE_CSS, /:root:not\(\[data-mode="dark"\]\) #ambient-toggle-row \{ display: none; \}/, 'the light-theme belt on the Ambient row');
  assert.match(STYLE_CSS, /#ambient-toggle-row\[hidden\] \{ display: none !important; \}/, 'the [hidden] !important override on the Ambient row');
});
