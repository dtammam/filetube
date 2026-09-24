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
//        docs/exec-plans/completed/2026-09-23-ambient-glow-polish.md

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// v1.317 M4: the helpers + engine MOVED VERBATIM from watch.js to ambient.js (the music
// view drives the same engine), and the watch WIRING became createAmbientHost there. The
// locks below read ambient.js; the watch.js re-export and its thin setupAmbientMode are
// bound at the end of this file (no hand-copy may survive in watch.js).
const W = require('../../public/js/ambient.js');
const { storyboardFrameForTime, storyboardTile } = require('../../public/js/player.js');
const STORYBOARD = { frameForTime: storyboardFrameForTime, tile: storyboardTile };

const REPO = path.join(__dirname, '..', '..');
const AMBIENT_JS = fs.readFileSync(path.join(REPO, 'public/js/ambient.js'), 'utf8');
const WATCH_JS = fs.readFileSync(path.join(REPO, 'public/js/watch.js'), 'utf8');
const MUSIC_HTML = fs.readFileSync(path.join(REPO, 'public/music.html'), 'utf8');
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
const STRIPPED_JS = stripComments(AMBIENT_JS);
const STRIPPED_WATCH_JS = stripComments(WATCH_JS);
const ENGINE_SRC = fnBody(STRIPPED_JS, 'function createAmbientEngine(opts) {', '');
// The WIRING is the shared host now (v1.317 M4): watch and music both run through it.
const WIRING_SRC = fnBody(STRIPPED_JS, 'function createAmbientHost(opts) {', '');

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
  // the inner rectangle = the player: 1/(1+2*reach) of each half-axis, on pixel CENTRES
  // normalised to the outermost pixel (gate r1 adversary F2: derive the plateau EDGE from
  // the constants and bind it on BOTH axes - 255 at the last inside pixel, <255 one out).
  const plateauEdge = (n, reach) => { const half = n / 2, u = 1 / (1 + 2 * reach); let last = Math.floor(half); for (let i = Math.floor(half); i < n; i++) { if (Math.abs(i + 0.5 - half) / (half - 0.5) <= u) last = i; else break; } return last; };
  const px = plateauEdge(w, W.AMBIENT_REACH_X), py = plateauEdge(h, W.AMBIENT_REACH_Y);
  const ix = px - cx + 1, iy = py - cy + 1; // plateau half-extents in pixels
  assert.ok(px > cx && px < w - 2 && py > cy && py < h - 2, 'the plateau edge lies strictly between the centre and the ring: ' + px + ',' + py);
  assert.strictEqual(alphaAt(data, w, cx, cy), 255, 'the centre is opaque');
  for (const [x, y, label] of [[px, cy, 'right plateau edge'], [w - 1 - px, cy, 'left plateau edge'], [cx, py, 'bottom plateau edge'], [cx, h - 1 - py, 'top plateau edge'], [px, py, 'the player\'s bottom-right corner'], [w - 1 - px, h - 1 - py, 'the player\'s top-left corner']]) assert.strictEqual(alphaAt(data, w, x, y), 255, label + ' (' + x + ',' + y + ') is opaque: the whole player rectangle, incl. its rounded-corner gaps, shows the frame');
  for (const [x, y, label] of [[px + 1, cy, 'one right of the plateau'], [w - 2 - px, cy, 'one left of the plateau'], [cx, py + 1, 'one below the plateau'], [cx, h - 2 - py, 'one above the plateau']]) assert.ok(alphaAt(data, w, x, y) < 255, label + ' (' + x + ',' + y + ') already falls: ' + alphaAt(data, w, x, y));
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
// The fake tile colour: the tile's position (sx + sy) decides its red - tile 0 is
// [40,80,120], row 1 col 0 (sy 180) [73.75,80,120], row 1 col 1 (sx 320 + sy 180) [133.75,80,120].
const TILE_RED = (shade) => Math.min(255, 40 + (shade / 320) * 60);
function harness(opts) {
  const layers = [makeLayer('A'), makeLayer('B')];
  const glow = { querySelectorAll: () => layers };
  const video = { currentTime: 0, tagName: 'VIDEO' };
  const timers = [];
  const draws = [];
  let shade = 0;
  let wall = 0; // the injected wall clock (ms); tick() advances it by the clock period
  const puts = []; // every putImageData's buffer (the vignetted bitmap the PNG is made of)
  const ctx = {
    drawImage(...args) { draws.push(args); shade = args[1] + args[2]; },
    getImageData(x, y, w, h) {
      return { data: paintedBuffer(w, h, () => [TILE_RED(shade), 80, 120]), width: w, height: h };
    },
    putImageData(id) { puts.push(id.data); },
  };
  // A content-addressed fake PNG: the same bitmap -> the same URL, a different tile -> a different URL.
  const canvas = {
    getContext: () => (opts && opts.throwOnRead ? { drawImage() {}, getImageData() { throw new Error('tainted'); } } : ctx),
    toDataURL: (type) => { if (opts && opts.nonPng) return 'data:,'; const last = puts[puts.length - 1]; let hsh = 0; for (let i = 0; i < last.length; i++) hsh = (hsh * 31 + last[i]) >>> 0; return 'data:' + type + ';base64,' + hsh.toString(36); },
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
    now: () => wall,
    fadeMs: opts && 'fadeMs' in opts ? opts.fadeMs : undefined,
    smoothTauS: opts && 'smoothTauS' in opts ? opts.smoothTauS : undefined,
    minDelta: opts && 'minDelta' in opts ? opts.minDelta : undefined,
    onHardFail: () => { hardFails++; },
  });
  // One clock period: the wall advances 1s, then the armed tick runs (the real
  // setTimeout order). Tests that need the fade gap (2.4s) to have passed tick
  // past it, exactly as the production clock would.
  const tick = () => { const t = timers.pop(); assert.ok(t && !t.cancelled, 'a live clock is armed'); timers.length = 0; wall += 1000; t.fn(); };
  const settle = () => new Promise((r) => setImmediate(r));
  const front = () => layers.find((l) => l.classes.has('is-front')) || null;
  const release = () => { const r = pendingLoads.splice(0); r.forEach((fn) => fn()); };
  const liveTimers = () => timers.filter((t) => !t.cancelled).length;
  // The centre pixel (under the player, alpha 255) of the last written bitmap = the lifted running field.
  const centre = () => { const b = puts[puts.length - 1]; const i = (18 * 64 + 32) * 4; return [b[i], b[i + 1], b[i + 2]]; };
  return { engine, layers, video, timers, draws, loads, tick, settle, front, images, release, liveTimers, hardFails: () => hardFails, ctx, canvas, puts, centre, wall: () => wall };
}
// Tick the clock past the fade gap so the next source change can paint at once.
async function pastFade(h) { for (let i = 0; i < 3; i++) { h.tick(); await h.settle(); } }

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

test('v1.312 engine: a tile change swaps the front layer with NEW colours; the same tile on the clock paints NOTHING (v1.314: never inside the fade, smoothed in media time, a tiny step absorbed)', async () => {
  const h = harness();
  h.engine.start(); await h.settle();
  const first = h.front();
  assert.deepStrictEqual(h.centre(), W.ambientLift([40, 80, 120]), 'the first paint IS tile 0 (no history -> a snap)');
  h.tick(); await h.settle();
  assert.strictEqual(h.draws.length, 1, 'same tile (t=0) on the next clock -> no re-sample');
  assert.strictEqual(h.front(), first, 'and no layer swap');
  h.video.currentTime = 27; // frame 10 -> column 0, row 1
  h.tick(); await h.settle();
  // v1.314: the previous cross-fade (2.4s) is still running at wall 2s - the tile WAITS
  assert.strictEqual(h.wall(), 2000);
  assert.strictEqual(h.draws.length, 1, 'a tile that lands inside the fade is NOT sampled yet (the back layer is still fading out)');
  assert.strictEqual(h.engine.painted().index, 0, 'and is not marked: the next clock re-checks it');
  h.tick(); await h.settle();
  assert.strictEqual(h.wall(), 3000);
  assert.strictEqual(h.draws.length, 2, 'past the fade: a new tile index -> one new sample');
  assert.deepStrictEqual(h.draws[1].slice(1, 5), [0, 180, 320, 180], 'row 1 column 0 of the sprite');
  const second = h.front();
  assert.notStrictEqual(second, first, 'the OTHER layer is now the front (a cross-fade, never a pop)');
  assert.notStrictEqual(second.vars['background-image'], first.vars['background-image'], 'with a DIFFERENT bitmap (the new tile)');
  assert.ok(!first.classes.has('is-front'), 'the old front stepped back');
  assert.strictEqual(h.engine.painted().index, 10);
  // v1.314 SMOOTHING: the painted field is NOT tile 10 - it is tile 0 moved toward tile 10 by
  // 1 - exp(-27s / tau): the glow drifts in media time instead of morphing to each new picture.
  const k1 = W.ambientSmoothing(27, W.AMBIENT_SMOOTH_TAU_S);
  const acc1 = 40 + k1 * (TILE_RED(180) - 40);
  assert.ok(k1 > 0.8 && k1 < 0.9, 'a 27s jump is nearly a snap: ' + k1);
  assert.deepStrictEqual(h.centre(), W.ambientLift([Math.round(acc1), 80, 120]), 'the bitmap carries the BLENDED field (' + acc1.toFixed(2) + '), not the raw tile (' + TILE_RED(180) + ')');
  h.video.currentTime = 29; // 29/2.5 = 11.6 -> frame 11 (column 1, row 1): a change, 2s of media later
  h.tick(); await h.settle(); h.tick(); await h.settle();
  assert.strictEqual(h.draws.length, 2, 'inside the new fade (wall 4s, 5s vs a paint at 3s): still waiting');
  h.tick(); await h.settle();
  assert.strictEqual(h.wall(), 6000);
  assert.strictEqual(h.draws.length, 3, 'past the fade: tile 11 sampled');
  assert.deepStrictEqual(h.draws[2].slice(1, 5), [320, 180, 320, 180], 'row 1 column 1');
  // 2s of media at tau 15s blends in ~12% of tile 11: the field moves ~2.7/255 - UNDER the threshold
  const k2 = W.ambientSmoothing(2, W.AMBIENT_SMOOTH_TAU_S);
  const acc2 = acc1 + k2 * (TILE_RED(500) - acc1);
  assert.ok((acc2 - acc1) / 3 < W.AMBIENT_MIN_DELTA, 'the step is below the threshold: ' + ((acc2 - acc1) / 3).toFixed(2));
  assert.strictEqual(h.engine.painted().index, 11, 'the absorbed tile is MARKED (never re-sampled)');
  assert.strictEqual(h.front(), second, 'but NO layer swap: a step this small is absorbed, not cross-faded (the churn Dean saw)');
  assert.strictEqual(h.puts.length, 2, 'and no bitmap was encoded for it');
  h.tick(); await h.settle();
  assert.strictEqual(h.draws.length, 3, 'the absorbed tile is not sampled again on the next clock');
  h.video.currentTime = 31; // frame 12 (column 2, row 1): the field keeps integrating...
  h.tick(); await h.settle();
  assert.strictEqual(h.draws.length, 4);
  const acc3 = acc2 + W.ambientSmoothing(2, W.AMBIENT_SMOOTH_TAU_S) * (TILE_RED(820) - acc2);
  assert.ok((acc3 - acc1) / 3 >= W.AMBIENT_MIN_DELTA, '...until the accumulated drift crosses the threshold: ' + ((acc3 - acc1) / 3).toFixed(2));
  assert.strictEqual(h.engine.painted().index, 12);
  assert.strictEqual(h.front(), first, 'alternates back: the drift is painted as ONE small cross-fade');
  assert.deepStrictEqual(h.centre(), W.ambientLift([Math.round(acc3), 80, 120]), 'carrying the whole accumulated field (the absorbed tile included)');
});

test('v1.314 pure: ambientSmoothing / ambientBlend / ambientMeanDelta', () => {
  assert.strictEqual(W.AMBIENT_SMOOTH_TAU_S, 15, 'the pace knob: a 15s media-time constant');
  assert.strictEqual(W.AMBIENT_MIN_DELTA, 4, 'the absorb threshold (mean |change| per channel, 0-255)');
  assert.strictEqual(W.AMBIENT_FADE_MS, 2400, 'the cross-fade = the minimum paint gap');
  const s = (dt) => W.ambientSmoothing(dt, W.AMBIENT_SMOOTH_TAU_S);
  assert.strictEqual(s(undefined), 1, 'no history -> a snap');
  assert.strictEqual(s(NaN), 1);
  assert.strictEqual(s(0), 0, 'no media time passed -> no movement');
  assert.ok(Math.abs(s(2) - 0.1248) < 0.001, 'a 2s tile cadence moves ~12% per tile: ' + s(2));
  assert.ok(Math.abs(s(10) - 0.4866) < 0.001, 'a 10s cadence ~49%: ' + s(10));
  assert.ok(s(36) > 0.9, 'an hour-long clip\'s 36s tiles are nearly a snap: ' + s(36));
  assert.ok(s(60) > 0.98, 'a seek a minute away snaps');
  assert.strictEqual(s(-2), s(2), 'a backward step blends by |dt|');
  assert.ok(W.ambientSmoothing(2, 30) < W.ambientSmoothing(2, 15), 'a larger tau is lazier');
  assert.strictEqual(W.ambientSmoothing(2, 0), s(2), 'tau <= 0 falls back to the constant');
  // blend: no field -> a copy (weight ignored); a field -> acc += (new - acc) * k, per channel, alpha ignored
  const rgba = (r, g, b) => new Uint8ClampedArray([r, g, b, 255, r, g, b, 255]);
  const a0 = W.ambientBlend(null, rgba(40, 80, 120), 0.1, 2);
  assert.ok(a0 instanceof Float32Array && a0.length === 6);
  assert.deepStrictEqual([...a0], [40, 80, 120, 40, 80, 120], 'the first tile is copied whole');
  const a1 = W.ambientBlend(a0, rgba(140, 80, 20), 0.25, 2);
  assert.strictEqual(a1, a0, 'blended IN PLACE (no per-paint allocation)');
  assert.deepStrictEqual([...a1], [65, 80, 95, 65, 80, 95], '25% of the way: 40 -> 65, 120 -> 95');
  assert.deepStrictEqual([...W.ambientBlend(a1, rgba(140, 80, 20), 1, 2)], [140, 80, 20, 140, 80, 20], 'k=1 snaps');
  assert.deepStrictEqual([...W.ambientBlend(new Float32Array(3), rgba(9, 9, 9), 0.5, 2)], [9, 9, 9, 9, 9, 9], 'a field of the wrong size is replaced, not blended');
  assert.strictEqual(W.ambientMeanDelta(a1, null), Infinity, 'nothing shown yet -> paint');
  assert.strictEqual(W.ambientMeanDelta(new Float32Array([1, 2, 3]), new Float32Array([1, 2])), Infinity, 'mismatched -> paint');
  assert.strictEqual(W.ambientMeanDelta(new Float32Array([10, 20, 30]), new Float32Array([13, 14, 36])), 5, 'mean |delta| over every channel');
});

test('v1.314 engine: a RUNG change (sprite -> poster) SNAPS the field - the poster paints as itself, never blended with the old sprite field', async () => {
  // The descriptor is read LAZILY by the engine (getMediaData), so it can change mid-view: here the
  // storyboard geometry disappears and the ladder falls to the thumbnail rung (a different url/kind).
  let media = VIDEO_ITEM;
  const h = harness({ get mediaData() { return media; }, images: { '/storyboard/vid1': { naturalWidth: 3200, naturalHeight: 720 }, '/thumbnail/vid1': { naturalWidth: 640, naturalHeight: 360 } } });
  h.engine.start(); await h.settle();
  await pastFade(h);
  h.video.currentTime = 27; h.tick(); await h.settle(); // tile 10: the field moves to ~68 red
  const moved = h.centre();
  assert.notDeepStrictEqual(moved, W.ambientLift([40, 80, 120]), 'the field has moved away from tile 0');
  await pastFade(h);
  media = { id: 'vid1', type: 'video', duration: 100 }; // no storyboard -> the poster (/thumbnail/vid1), fake colour [40,80,120]
  h.tick(); await h.settle(); await h.settle();
  assert.strictEqual(h.engine.painted().kind, 'image');
  assert.deepStrictEqual(h.draws[h.draws.length - 1].slice(1, 5), [0, 0, 640, 360], 'the whole poster');
  // dt is 0 here (same media time), so a same-rung blend would have moved NOTHING (k = 0) and kept ~68;
  // a rung change carries weight 1 regardless of dt.
  assert.deepStrictEqual(h.centre(), W.ambientLift([40, 80, 120]), 'the poster paints as itself (weight 1 on a rung change)');
});

test('v1.314 engine: the fade gap is bound to the CSS cross-fade, and a paint deferred by it lands on the next clock with the tile of NOW', async () => {
  const layer = glowRules().find((r) => r.selector === '.ambient-glow-layer');
  assert.match(layer.body, /transition:\s*opacity var\(--ambient-fade\) linear/);
  const base = glowRules().find((r) => r.selector === '.ambient-glow' && /--ambient-fade/.test(r.body));
  const fade = /--ambient-fade:\s*([0-9.]+)s/.exec(base.body);
  assert.ok(fade, '--ambient-fade declared in seconds');
  assert.strictEqual(Number(fade[1]) * 1000, W.AMBIENT_FADE_MS, 'the CSS fade and the engine\'s minimum paint gap are ONE number (a shorter gap repaints the back layer while it is still fading out = a pop)');
  assert.ok(W.AMBIENT_FADE_MS > W.AMBIENT_CLOCK_MS, 'the fade outlasts the clock, so the gap really defers');
  const h = harness();
  h.engine.start(); await h.settle();
  h.video.currentTime = 27; h.tick(); await h.settle(); // wall 1s: deferred
  h.video.currentTime = 52; h.tick(); await h.settle(); // wall 2s: still deferred (frame 20)
  assert.strictEqual(h.draws.length, 1);
  h.tick(); await h.settle(); // wall 3s
  assert.strictEqual(h.draws.length, 2);
  assert.strictEqual(h.engine.painted().index, 20, 'the tile of NOW (t=52), never the tile that was deferred (t=27)');
  // a zero gap (the reduced-motion shape is CSS-side; here the knob itself) paints on the very next clock
  const z = harness({ fadeMs: 0 });
  z.engine.start(); await z.settle();
  z.video.currentTime = 27; z.tick(); await z.settle();
  assert.strictEqual(z.draws.length, 2, 'fadeMs 0 -> no deferral');
});

// v1.317 M4: the music view's source is the CURRENT track's art, so a long session walks
// a new URL per track; the engine keeps only the current source's decoded image (a kept
// map would grow with the queue). Bound by the reload of a URL that came back.
test('v1.317 engine: only the CURRENT source\'s image is kept - a URL that comes back is re-loaded, a failed one is remembered', async () => {
  const o = {
    mediaId: null, mediaData: { type: 'audio', artUrl: '/albumart/a' },
    images: { '/albumart/a': { naturalWidth: 300, naturalHeight: 300 }, '/albumart/b': { naturalWidth: 300, naturalHeight: 300 } },
  };
  const h = harness(o);
  h.engine.start(); await h.settle();
  assert.strictEqual(h.engine.painted().url, '/albumart/a');
  o.mediaData.artUrl = '/albumart/b';
  await pastFade(h);
  assert.strictEqual(h.engine.painted().url, '/albumart/b', 'the next track\'s art is integrated');
  o.mediaData.artUrl = '/albumart/a';
  await pastFade(h);
  assert.strictEqual(h.engine.painted().url, '/albumart/a');
  assert.deepStrictEqual(h.loads, ['/albumart/a', '/albumart/b', '/albumart/a'], 'track A\'s image was dropped when B became current, so coming back re-loads it');
  // a FAILED url stays remembered (tiny, and never re-requested) - even across a NEW source
  // becoming current in between (the drop runs when the next image is ready; /albumart/b
  // is a different source from the still-painted /albumart/a, so it really re-integrates)
  o.mediaData.artUrl = '/albumart/missing';
  await pastFade(h);
  o.mediaData.artUrl = '/albumart/b';
  await pastFade(h);
  assert.strictEqual(h.engine.painted().url, '/albumart/b', 'precondition: a new source integrated after the failure');
  o.mediaData.artUrl = '/albumart/missing';
  await pastFade(h);
  assert.strictEqual(h.loads.filter((u) => u === '/albumart/missing').length, 1, 'the failed URL was requested once');
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
  // Gate r1 (qa W1): past the fade gap FIRST, or the deferral - not the poster's
  // fixed index - is what keeps the sample count at 1 (a v1.312 assertion silently
  // unbound; the sandbox mutant "re-sample the poster every clock" stayed green).
  await pastFade(h);
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
  await pastFade(h);
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

test('v1.313 gate QA-2: a toDataURL that yields no PNG (WebKit\'s "data:," on an unencodable canvas) is a FAILED source - falls sprite -> poster, then paints NOTHING, never hard-fails or loops', async () => {
  const h = harness({ nonPng: true, images: { '/storyboard/vid1': { naturalWidth: 3200, naturalHeight: 720 }, '/thumbnail/vid1': { naturalWidth: 640, naturalHeight: 360 } } });
  h.engine.start(); await h.settle(); await h.settle();
  for (let i = 0; i < 5; i++) { h.tick(); await h.settle(); }
  assert.deepStrictEqual(h.loads, ['/storyboard/vid1', '/thumbnail/vid1'], 'the sprite was tried, then the poster');
  assert.strictEqual(h.front(), null, 'nothing was ever painted (no url("data:,") reaches the layer)');
  assert.strictEqual(h.engine.painted(), null);
  assert.strictEqual(h.draws.length, 2, 'each rung sampled ONCE, then left failed - no re-sample loop');
  assert.strictEqual(h.engine.hardFailed(), false, 'a non-PNG is a failed rung, not a hard failure');
  assert.strictEqual(h.hardFails(), 0);
  assert.strictEqual(h.engine.running(), true, 'the clock stays armed (a later source change may still paint)');
  for (const l of h.layers) assert.strictEqual(l.vars['background-image'], undefined);
});

test('v1.312 THE CONSTRAINT: the engine never hands the VIDEO element to drawImage - only the loaded image', async () => {
  const h = harness();
  h.engine.start(); await h.settle();
  await pastFade(h);
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
  assert.doesNotMatch(ENGINE_SRC + WIRING_SRC, /-webkit-canvas|-moz-element|['"][^'"\n]*(?:element|image-set|cross-fade|paint|gradient)\(/, 'no paint reference to a live canvas/element/paint worklet/gradient in any STRING the ambient JS writes (#232: gradient( joined the list - the v1.313 glow is a bitmap, never a gradient)');
  // Tracker #232 (v1.313 gate r2 note): the lock is SCOPED to style writes, so an
  // unrelated `arr.filter(...)`, a `transform` in a variable name or a trailing
  // `// no transform` comment can never false-trip it, while `style.webkitFilter`,
  // `style.WebkitTransform`, `style.scale` and `setProperty('-webkit-mask', ...)`
  // (gate r1 adversary F3: the vendor camelCase slipped a case-sensitive lock) still
  // do. Trailing `//` comments are stripped first (the standing comment-porosity
  // lesson: stripComments drops only full-line comments).
  const jsSrc = (ENGINE_SRC + '\n' + WIRING_SRC).replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');
  // Gate r1 (adversary W3 / qa W2): compound assignment (+=, ||=, ??=) is a write
  // too, and a style write can hide behind an alias, Object.assign, or a
  // non-literal setProperty name - those forms are banned outright below.
  const styleWrites = [
    ...[...jsSrc.matchAll(/\.style\.([A-Za-z][\w-]*)\s*(?:[+\-*/%|&^?]{1,2})?=[^=]/g)].map((m) => m[1]),
    ...[...jsSrc.matchAll(/\.style\.setProperty\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1]),
  ];
  assert.deepStrictEqual(styleWrites, ['background-image'], 'the ONLY style write in the ambient JS is the back layer\'s background-image');
  const FORBIDDEN_JS_STYLE = /^-?(?:webkit|moz|ms)?-?(?:filter|transform|backdrop|will-?change|scale|translate|rotate|offset|animation|mask|mix-?blend)/i;
  for (const p of styleWrites) assert.doesNotMatch(p, FORBIDDEN_JS_STYLE, 'style write "' + p + '": no filter/transform/scale/translate/rotate/animation/mask/mix-blend-mode from JS, in any spelling incl. the vendor camelCase');
  assert.doesNotMatch(jsSrc, /\.style\.cssText|\.style\s*\[|setAttribute\(\s*['"]style['"]|insertRule\(|\.cssText\s*=|\.animate\(/, 'no UNSCOPED style write (cssText / computed key / style attribute / insertRule / Element.animate) that the per-property lock could not see');
  assert.doesNotMatch(jsSrc, /Object\.assign\(\s*[^,)]*\.style\b|\.style\s*=[^=]|\.style\.setProperty\(\s*[^'"\s)]|[=,(]\s*[A-Za-z_$][\w$]*\.style\s*[,;)\n]/, 'no style write the per-property lock cannot SEE: Object.assign onto a style, a whole-style assignment, a non-literal setProperty name, or a style object stored/passed under an alias');
  assert.doesNotMatch(WIRING_SRC, /drawImage|getContext|captureStream|requestVideoFrameCallback/, 'the wiring never touches a canvas or the video\'s frames');
  assert.doesNotMatch(ENGINE_SRC, /video\.(videoWidth|videoHeight|captureStream|requestVideoFrameCallback)/, 'the engine reads the video for currentTime only');
  assert.match(ENGINE_SRC, /Number\(video\.currentTime\)/, 'currentTime is the ONLY thing read off the video');
  assert.doesNotMatch(ENGINE_SRC + WIRING_SRC, /requestAnimationFrame/, 'no frame-loop residency (the v1.187.2 cost floor)');
  assert.match(ENGINE_SRC, /timerId = setT\(tick, clockMs\)/, 'a plain 1s clock');
  assert.strictEqual(W.AMBIENT_CLOCK_MS, 1000);
  // v1.314: the pace pipeline is IN the engine's sample/check path (not a green helper nothing calls)
  assert.match(ENGINE_SRC, /acc = ambientBlend\(sameRung \? acc : null, id\.data, k, n\)/, 'every sample is blended into the running field; a rung change starts a fresh one');
  assert.match(ENGINE_SRC, /var k = sameRung && lastT !== null \? ambientSmoothing\(t - lastT, smoothTauS\) : 1/, 'the weight comes from the MEDIA time since the last integrated sample');
  assert.match(ENGINE_SRC, /if \(ambientMeanDelta\(acc, shown\) < minDelta\) return \{ skip: true \}/, 'a step under the threshold is absorbed before any vignette/encode');
  assert.match(ENGINE_SRC, /if \(n - lastPaintAt < fadeMs\) return;/, 'no paint inside the previous fade (n = the clamped now(), qa S1)');
  assert.match(ENGINE_SRC, /if \(bitmap\.skip\) \{ painted = \{ kind: src\.kind, url: src\.url, index: src\.index \}; return; \}/, 'an absorbed tile is marked, never swapped');
  assert.doesNotMatch(ENGINE_SRC, /new Date|performance\.now/, 'wall time comes only through the injected now()');
  // Gate r1 (adversary S2): a direct Date.now() in check() passed the old lock.
  assert.strictEqual((ENGINE_SRC.match(/Date\.now\(/g) || []).length, 1, 'exactly ONE Date.now() in the engine');
  assert.match(ENGINE_SRC, /var now = typeof opts\.now === 'function' \? opts\.now : function \(\) \{ return Date\.now\(\); \};/, '...and it is the now() default, so every wall read goes through the injectable clock');
  assert.match(ENGINE_SRC, /var n = now\(\);\s*if \(lastPaintAt > n\) lastPaintAt = n;/, 'qa S1: a backward wall-clock step (non-monotonic Date.now) clamps the fade anchor instead of deferring every paint for the step');
});

test('v1.312 WIRING LOCK (v1.317: the shared host): createAmbientHost builds the engine from the view (lazy descriptor, an OFF-DOM canvas, the media for time only) and funnels start/stop', () => {
  assert.match(WIRING_SRC, /var engine = createAmbientEngine\(\{/, 'the engine is created in the host');
  assert.match(WIRING_SRC, /getMediaData: typeof opts\.getMediaData === 'function' \? opts\.getMediaData : function \(\) \{ return null; \}/, 'the view\'s descriptor getter reaches the engine UNCALLED (read lazily on every source check)');
  assert.match(WIRING_SRC, /storyboard: opts\.storyboard \|\| null/, 'the sprite geometry is the view\'s, guarded');
  assert.match(WIRING_SRC, /makeCanvas: typeof opts\.makeCanvas === 'function' \? opts\.makeCanvas : function \(\) \{ return doc\.createElement\('canvas'\); \}/, 'the sample canvas is created OFF-DOM (never appended)');
  assert.match(WIRING_SRC, /mediaId: opts\.mediaId,/, 'the view id reaches the engine (the sprite/thumbnail rungs need it; tv and music have none and ride artUrl)');
  assert.match(WIRING_SRC, /video: mediaClock,/, 'the engine gets a currentTime VIEW of the media, never the element');
  assert.match(WIRING_SRC, /Object\.defineProperty\(mediaClock, 'currentTime', \{\s*get: function \(\) \{ var media = getMedia\(\); return media \? media\.currentTime : 0; \},\s*\}\)/, '...whose only member reads the live media element\'s currentTime');
  assert.match(WIRING_SRC, /onHardFail: function \(\) \{ stop\(\); \}/, 'gate r1 F2/W1: an async hard failure tears the DOM down through the host\'s own stop()');
  assert.match(fnBody(WIRING_SRC, 'function start() {', '  '), /if \(engine\.hardFailed\(\)\) return;/, 'a hard-failed engine is never re-lit (M17)');
  assert.doesNotMatch(WIRING_SRC, /appendChild\(|insertBefore\(|insertAdjacentElement\(|insertAdjacentHTML\(/, 'nothing is ever inserted into the document by the host');
  const startFn = fnBody(WIRING_SRC, 'function start() {', '  ');
  const stopFn = fnBody(WIRING_SRC, 'function stop() {', '  ');
  assert.match(startFn, /glow\.hidden = false;[\s\S]*glow\.classList\.add\('is-on'\)[\s\S]*doc\.documentElement\.setAttribute\('data-ambient-on', ''\)[\s\S]*engine\.start\(\)/, 'start: reveal, is-on, the sidebar signal, then the engine');
  assert.match(stopFn, /engine\.stop\(\)[\s\S]*classList\.remove\('is-on'\)[\s\S]*glow\.hidden = true;[\s\S]*doc\.documentElement\.removeAttribute\('data-ambient-on'\)/, 'stop: the engine, is-on, hide, the sidebar signal');
  assert.match(WIRING_SRC, /if \(shouldRun\(\)\) start\(\); else stop\(\);/, 'the one gate');
  assert.match(WIRING_SRC, /ambientShouldRun\(\{ prefOn: prefOn, dark: isDarkMode\(doc\), playing: currentlyPlaying\(\), docVisible: !doc\.hidden \}\) && !!canRun\(\)/, 'the pure predicate, all four axes, AND the view\'s own gate');
  assert.match(WIRING_SRC, /var canRun = typeof opts\.canRun === 'function' \? opts\.canRun : function \(\) \{ return true; \};/, 'a view without its own gate (watch) runs on the four axes alone - exactly as before v1.317');
  for (const ev of ['play', 'playing', 'pause', 'ended', 'emptied']) assert.match(WIRING_SRC, new RegExp("media\\.addEventListener\\('" + ev + "', evaluate, \\{ signal: mediaSignal \\}\\)"), ev + ' re-evaluates');
  assert.match(WIRING_SRC, /doc\.addEventListener\('visibilitychange', evaluate, \{ signal: signal \}\)/, 'tab hide/show re-evaluates');
  assert.match(WIRING_SRC, /attributeFilter: \['data-mode', 'data-theme'\]/, 'a theme flip re-evaluates');
  assert.match(WIRING_SRC, /signal\.addEventListener\('abort', teardown, \{ once: true \}\)/, 'the view abort runs the teardown');
  const teardownFn = fnBody(WIRING_SRC, 'function teardown() {', '  ');
  assert.match(teardownFn, /stop\(\);[\s\S]*mediaCtl\.abort\(\)[\s\S]*themeObs\.disconnect\(\)[\s\S]*slotObs\.disconnect\(\)/, 'teardown stops the engine, drops the media binding, disconnects both observers');
  assert.match(WIRING_SRC, /im\.src = url;/, 'images load through a plain Image');
  assert.match(WIRING_SRC, /localStorage\.setItem\('ft-ambient', ambientStorageValue\(prefOn\)\)/, 'the pref key is unchanged');
  assert.match(WIRING_SRC, /isAmbientEnabled\(localStorage\.getItem\('ft-ambient'\)\)/, '...and read back from the same key');
  // v1.312 (Dean): the v1.187 amount ladder is GONE - one look, no picker, no key.
  assert.doesNotMatch(WIRING_SRC, /ft-ambient-intensity|ambient-level|data-ambient'|resolveAmbientLevel/, 'no ladder in the wiring');
  for (const [name, src] of [['ambient.js', STRIPPED_JS], ['watch.js', STRIPPED_WATCH_JS]]) {
    assert.doesNotMatch(src, /AMBIENT_LEVELS|resolveAmbientLevel|watch-ambient-level|ambient-level-row|Ambient amount/, 'no ladder anywhere in ' + name + ' (the cog row, the helpers, the exports)');
  }
  for (const f of ['public/js/prefs-sync.js', 'lib/prefs-allowlist.js']) assert.ok(!fs.readFileSync(path.join(REPO, f), 'utf8').includes('ft-ambient-intensity'), f + ': the dead key left the sync allowlist (a key nothing writes can never sync)');
  assert.doesNotMatch(STYLE_CSS.replace(/\/\*[\s\S]*?\*\//g, ''), /ambient-level-row|settings-menu-select|data-ambient="/, 'no ladder CSS (rows, picker, rungs)');
});

// v1.317 M4: the watch view hands the SAME collaborators it always used to the shared
// host, and watch.js carries NO second copy of the engine or its helpers (a hand-copy
// is the INERT SIBLING class: the two would drift and one view would paint differently).
test('v1.317 M4: watch.js keeps no hand-copy - setupAmbientMode is a thin call into the shared host with the view\'s own collaborators', () => {
  for (const fn of ['createAmbientEngine', 'ambientSourceFor', 'ambientVignette', 'ambientLift', 'ambientSmoothing', 'ambientBlend', 'ambientMeanDelta', 'isAmbientEnabled', 'ambientStorageValue', 'ambientShouldRun', 'isDarkMode', 'createAmbientHost']) {
    assert.doesNotMatch(STRIPPED_WATCH_JS, new RegExp('function ' + fn + '\\('), 'watch.js must not declare ' + fn + ' (it lives in ambient.js only)');
    assert.match(STRIPPED_JS, new RegExp('\\nfunction ' + fn + '\\('), 'ambient.js declares ' + fn);
  }
  assert.doesNotMatch(STRIPPED_WATCH_JS, /var AMBIENT_[A-Z_]+ =/, 'no ambient constant is re-declared in watch.js');
  const wiring = fnBody(STRIPPED_WATCH_JS, 'function setupAmbientMode() {', '    ');
  assert.match(wiring, /const ambient = window\.FileTubeAmbient;/, 'the host is read off the explicit global');
  assert.match(wiring, /ambient\.createAmbientHost\(\{/);
  assert.match(wiring, /glow: root\.querySelector\('#ambient-glow'\),/, 'the watch view\'s own glow');
  assert.match(wiring, /check: root\.querySelector\('#watch-ambient-check'\),/, 'the cog row\'s checkbox');
  assert.match(wiring, /row: root\.querySelector\('#ambient-toggle-row'\),/);
  assert.match(wiring, /getMedia: function \(\) \{ return document\.getElementById\('media-player'\); \},/, 'the shared media element');
  assert.match(wiring, /getMediaData: function \(\) \{ return mediaData; \},/, 'mediaData is read LAZILY (the v1.197.1 TDZ lesson)');
  assert.match(wiring, /mediaId: mediaId,/, 'the view id reaches the engine');
  assert.match(wiring, /storyboard: \(window\.FileTube && window\.FileTube\.storyboard\) \|\| null,/, 'the sprite geometry comes from the player module, guarded');
  assert.match(wiring, /signal: signal,/, 'the view\'s own abort signal');
  assert.doesNotMatch(wiring, /canRun|observe:/, 'watch adds no gate of its own: its behavior is the v1.312 one');
  // the Node export path still answers the engine through watch.js (one import path for the suite)
  const WATCH = require('../../public/js/watch.js');
  assert.strictEqual(WATCH.createAmbientEngine, W.createAmbientEngine, 'watch.js re-exports the ONE engine');
  assert.strictEqual(WATCH.AMBIENT_REACH_X, W.AMBIENT_REACH_X);
});

// The comment-stripped sheet and the character ranges of every `@media (max-width: 768px)`
// block in it (brace-balanced), so a rule can be told MOBILE from base (v1.314: the glow
// has a mobile override with the same selector).
const CSS_STRIPPED = STYLE_CSS.replace(/\/\*[\s\S]*?\*\//g, '');
const MOBILE_RANGES = (() => {
  const out = [];
  const re = /@media \(max-width:\s*768px\)\s*\{/g;
  let m;
  while ((m = re.exec(CSS_STRIPPED))) {
    let depth = 1, i = m.index + m[0].length;
    for (; i < CSS_STRIPPED.length && depth > 0; i++) { if (CSS_STRIPPED[i] === '{') depth++; else if (CSS_STRIPPED[i] === '}') depth--; }
    out.push([m.index, i]);
  }
  return out;
})();
const inMobile = (idx) => MOBILE_RANGES.some(([a, b]) => idx > a && idx < b);
// Every rule whose selector mentions .ambient-glow, comment-stripped, as {selector, body, mobile}.
function glowRules() {
  return [...CSS_STRIPPED.matchAll(/([^{}]*\.ambient-glow[^{}]*)\{([^}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2], mobile: inMobile(m.index + m[0].indexOf('{')), index: m.index + m[0].indexOf('{') }));
}
// Gate r1 (adversary F3): the constraint must cover EVERY rule that can reach the glow
// or the video's ancestor stage - by id, by class, by child/attribute selectors, or
// via the stage itself (`#ambient-glow {…}`, `.watch-player-stage > div:first-child`,
// a `transform` on `.watch-player-stage` all shipped gate-green under the class-only sweep).
// v1.317 M4: the music view's player stage (`.music-player-stage`, by class or id) and its
// ancestor stage (`.music-stage` / `#music-stage`, shared with podcasts) are in the SAME
// sweep - the fixed fullscreen / expanded-audio overlay lives inside both.
function stageAndGlowRules() {
  return [...CSS_STRIPPED.matchAll(/([^{}]*(?:ambient-glow|watch-player-stage|music-player-stage|music-stage)[^{}]*)\{([^}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2], mobile: inMobile(m.index + m[0].indexOf('{')) }));
}

test('v1.312 CSS LOCK: NO rule reaching the glow OR the player stage carries a filter / transform / mask / backdrop-filter / will-change (the second iOS suspect)', () => {
  const rules = stageAndGlowRules();
  assert.ok(rules.length >= 9, 'the glow + stage rules exist (' + rules.length + ')'); // glow: base, is-on, layer, is-front, light belt, reduced-motion; stage: base, mobile clip, the fullscreen z-index drop
  assert.ok(rules.some((r) => /^\.watch-player-stage$/.test(r.selector)), 'the stage base rule is in the sweep');
  // v1.317 M4: the music stage base rule (desktop only) + its mobile glow belt are in it too.
  const musicStage = rules.filter((r) => /^\.music-player-stage$/.test(r.selector));
  assert.strictEqual(musicStage.length, 1, 'exactly one .music-player-stage base rule is in the sweep');
  assert.match(musicStage[0].body, /position:\s*relative;[\s\S]*z-index:\s*0;/, 'the music stage owns the glow\'s stacking context (desktop)');
  assert.strictEqual(musicStage[0].mobile, false, 'the music stage context is NOT a mobile rule');
  assert.ok(rules.some((r) => /^\.music-player-stage \.ambient-glow$/.test(r.selector) && r.mobile && /display:\s*none/.test(r.body)), 'the phone belt: the music glow is display:none below the breakpoint');
  // Gate r1 adversary F1: property names are case-insensitive and Safari honours its own
  // prefixed spellings (WebKit CSSProperties.json: -webkit-filter / -webkit-transform /
  // -webkit-mask-image are aliases, -webkit-backdrop-filter is its OWN property, -webkit-mask
  // is a shorthand over mask-image; scale / translate / rotate are real properties; a
  // transform can also arrive through @keyframes + animation). One sweep, every spelling.
  // Tracker #232: WHY `contain` / `isolation` / `perspective` are on the list although
  // they are not paint effects - each one (like filter / transform / will-change)
  // turns the element into the CONTAINING BLOCK for position:fixed descendants
  // (`contain: paint|layout|strict|content`, `isolation: isolate` also a stacking
  // context, `perspective`). The faux-fullscreen overlay (#player-wrapper.css-fullscreen,
  // position:fixed) lives INSIDE .watch-player-stage; trapped in the stage's box it
  // can never cover the viewport - the v1.166 "isolation traps in-view fixed overlays"
  // class that broke rotate-to-fullscreen. `url(` is forbidden on these rules because
  // the SHEET must never paint an external resource or a canvas reference here: the
  // only image is the engine's inline PNG data URL (v1.313), set from JS.
  const FORBIDDEN_PROP = /(^|[\s;{])(?:-webkit-|-moz-|-ms-)?(?:filter|backdrop-filter|transform(?:-[a-z-]+)?|mask(?:-[a-z-]+)?|will-change|mix-blend-mode|scale|translate|rotate|offset(?:-[a-z-]+)?|animation(?:-[a-z-]+)?|perspective|contain|isolation)\s*:/i;
  const FORBIDDEN_PAINT = /-webkit-canvas\(|-moz-element\(|(?:^|[^a-z-])element\(|gradient\(|image-set\(|cross-fade\(|paint\(|url\(/i;
  for (const r of rules) {
    assert.doesNotMatch(r.body, FORBIDDEN_PROP, r.selector + ' must not declare a filter / transform / mask / will-change / animation in ANY spelling: ' + (FORBIDDEN_PROP.exec(r.body) || [''])[0]);
    assert.doesNotMatch(r.body, FORBIDDEN_PAINT, r.selector + ' must not paint from a canvas / element / gradient / url in the SHEET (the image is the engine\'s inline PNG data URL only): ' + (FORBIDDEN_PAINT.exec(r.body) || [''])[0]);
  }
  // Tracker #232: bind the keyframes NAME (the old span `[^{]*\{[^}]*` matched a
  // step BODY mentioning "stage", never the name itself).
  assert.doesNotMatch(STYLE_CSS.replace(/\/\*[\s\S]*?\*\//g, ''), /@keyframes\s+[^\s{]*(?:ambient|stage)/i, 'no keyframes named for the glow/stage');
  assert.doesNotMatch(WATCH_HTML, /<canvas id="ambient-glow"/, 'the canvas is gone from the view');
  assert.match(WATCH_HTML, /<div id="ambient-glow" class="ambient-glow" aria-hidden="true" hidden>\s*<div class="ambient-glow-layer"><\/div>\s*<div class="ambient-glow-layer"><\/div>\s*<\/div>/, 'a div pair: the glow with exactly two layers, born hidden');
  // v1.317 M4: the music view's glow is the SAME div pair, inside the player stage that
  // wraps #player-slot (the watch shape), and there is no canvas.
  assert.doesNotMatch(MUSIC_HTML, /<canvas[^>]*ambient/, 'no canvas in the music view');
  assert.match(MUSIC_HTML, /<div id="music-player-stage" class="music-player-stage">\s*<div id="music-ambient-glow" class="ambient-glow" aria-hidden="true" hidden>\s*<div class="ambient-glow-layer"><\/div>\s*<div class="ambient-glow-layer"><\/div>\s*<\/div>\s*<div id="player-slot"><\/div>\s*<\/div>/, 'music: the stage wraps the glow pair (born hidden) and #player-slot');
});

test('v1.312 CSS GEOMETRY: the glow reaches by negative insets; each band is the reach re-expressed in ELEMENT terms; ONE YouTube-matched opacity, no ladder', () => {
  const base = glowRules().find((r) => r.selector === '.ambient-glow' && !r.mobile);
  assert.ok(base, 'the base rule');
  const num = (body, name) => { const m = new RegExp('--ambient-' + name + ':\\s*([0-9.]+)%').exec(body); assert.ok(m, name + ' declared'); return Number(m[1]); };
  const check = (body, label) => {
    const rx = num(body, 'reach-x'), ry = num(body, 'reach-y');
    // v1.313: the CSS reach and the JS vignette's inner rectangle are ONE number (a
    // hand-copy that drifts lands the glow's peak off the player's edge).
    assert.strictEqual(rx, W.AMBIENT_REACH_X * 100, label + ': --ambient-reach-x equals ambient.js AMBIENT_REACH_X');
    assert.strictEqual(ry, W.AMBIENT_REACH_Y * 100, label + ': --ambient-reach-y equals ambient.js AMBIENT_REACH_Y');
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

// v1.314 (Dean, iPhone: "look at left and right of ambient on mobile, make it spread").
// MEASURED (plan: ambient-mobile-spread-and-pace, headless Chromium at 390x844): the
// stage box WAS the player box (x 16, w 358) and the v1.194.3 `overflow-x: clip` sat on
// it, so the 43px side reach was clipped to NOTHING - every gutter pixel read the page
// [18,18,18]; removing the clip tinted the gutter but grew scrollWidth 390 -> 417 (the
// sideways scroll). The fix moves the CLIP EDGE to the viewport edge: the stage grows by
// the page gutter (negative margin + matching padding) and the glow's x insets are
// re-anchored so its bitmap still lands exactly on the player.
test('v1.314 CSS MOBILE SPREAD: the stage clip edge is the VIEWPORT edge (grown by the page gutter) and the glow x insets are re-anchored on the player - geometry identical to desktop', () => {
  const stage = stageAndGlowRules().find((r) => r.selector === '.watch-player-stage' && r.mobile);
  assert.ok(stage, 'the mobile stage rule exists inside a max-width: 768px block');
  assert.match(stage.body, /overflow-x:\s*clip/, 'the v1.194.3 clip stays (nothing may overflow the page sideways)');
  assert.doesNotMatch(stage.body, /overflow-y|overflow:\s*hidden|overflow:\s*clip/, 'x only: the vertical bloom must survive');
  assert.match(stage.body, /--ambient-gutter:\s*var\(--space-8\)/, 'the gutter is a token, --space-8');
  // ...and it is THE token .main-content pads with on mobile (a hand-copy of the gutter would drift)
  const mainMobile = [...CSS_STRIPPED.matchAll(/\.main-content\s*\{([^}]*)\}/g)].filter((m) => inMobile(m.index));
  assert.ok(mainMobile.some((m) => /padding:\s*var\(--space-8\);/.test(m[1])), '.main-content pads var(--space-8) on mobile: the gutter the stage grows into');
  for (const side of ['left', 'right']) {
    assert.match(stage.body, new RegExp('margin-' + side + ':\\s*calc\\(-1 \\* var\\(--ambient-gutter\\)\\)'), 'margin-' + side + ' pulls the stage to the viewport edge');
    assert.match(stage.body, new RegExp('padding-' + side + ':\\s*var\\(--ambient-gutter\\)'), 'padding-' + side + ' keeps the player where it was');
  }
  assert.doesNotMatch(stage.body, /position|z-index|width|height/, 'nothing else moves on the stage (position/z-index stay on the base rule)');
  const glowM = glowRules().find((r) => r.selector === '.ambient-glow' && r.mobile);
  assert.ok(glowM, 'the mobile glow override exists');
  // THE CASCADE (measured: an override placed BEFORE the base rule was inert - same
  // specificity, so source order decides - and the probe read the glow at -12% of the
  // VIEWPORT, x -46.8, instead of -12% of the player, x -27.0). Bind the order.
  const glowBase = glowRules().find((r) => r.selector === '.ambient-glow' && !r.mobile);
  assert.ok(glowM.index > glowBase.index, 'the mobile .ambient-glow override comes AFTER the base rule in the sheet, or the base left/right win the cascade');
  assert.match(glowBase.body, /left:\s*calc\(-1 \* var\(--ambient-reach-x\)\)/, 'and the base rule still declares the desktop insets it must override');
  const fracs = [];
  for (const side of ['left', 'right']) {
    const m = new RegExp(side + ':\\s*calc\\(var\\(--ambient-gutter\\) - \\(100% - 2 \\* var\\(--ambient-gutter\\)\\) \\* ([0-9.]+)\\)').exec(glowM.body);
    assert.ok(m, side + ' is re-anchored: gutter minus the reach as a fraction of the PLAYER width (100% minus two gutters)');
    fracs.push(Number(m[1]));
  }
  for (const f of fracs) assert.strictEqual(f, W.AMBIENT_REACH_X, 'the mobile x reach fraction equals ambient.js AMBIENT_REACH_X (the vignette\'s inner rectangle)');
  assert.doesNotMatch(glowM.body, /top:|bottom:|--ambient-reach|--ambient-opacity|--ambient-fade|overflow/, 'only the x insets change on mobile (the padding is horizontal, so the y reach is still a % of the player height)');
  // The numbers: at a 390px viewport with a 16px gutter the mobile formula puts the glow's edge
  // exactly where the base formula puts it for the 358px player - the glow is byte-identical
  // (probe: x -27.0, w 443.9 both before and after); only the CLIP box changed (358 -> 390).
  const vw = 390, g = 16, player = vw - 2 * g;
  const baseLeft = -W.AMBIENT_REACH_X * player;                 // relative to the player's left edge
  const mobileLeft = g - (vw - 2 * g) * fracs[0];               // relative to the stage padding box = the viewport
  assert.ok(Math.abs((mobileLeft - g) - baseLeft) < 1e-9, 'same glow edge: ' + (mobileLeft - g) + ' vs ' + baseLeft);
  assert.ok(-baseLeft > g, 'the reach (' + (-baseLeft).toFixed(1) + 'px) exceeds the gutter (' + g + 'px): the whole gutter is lit to the screen edge');
  assert.ok(vw + 2 * -mobileLeft > vw, 'the glow still overflows the clip box, which now ends at the viewport - so scrollWidth stays the viewport width');
});

test('v1.313 CSS PAINT: the layer is a plain background-image slot (100% 100%, no-repeat, NO gradients / colour vars), and the layers cross-fade on opacity', () => {
  const layer = glowRules().find((r) => r.selector === '.ambient-glow-layer');
  assert.ok(layer, 'the layer rule');
  assert.match(layer.body, /background-size:\s*100% 100%/, 'the bitmap is stretched to the whole layer (its inner rectangle IS the player box)');
  assert.match(layer.body, /background-repeat:\s*no-repeat/);
  assert.doesNotMatch(layer.body, /gradient\(|--ag-|background-image:|background:/, 'no CSS-side paint: the image is set inline by the engine, one continuous bitmap (v1.313: the eight gradients had hard band ends + corner notches)');
  for (const r of stageAndGlowRules()) assert.doesNotMatch(r.body, /image-rendering/, r.selector + ': the default bilinear upscale IS the softness (no pixelated/crisp-edges override anywhere near the glow)');
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
