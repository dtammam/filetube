'use strict';

// [UNIT] v1.166 (Dean): Sneaky critter mode - the SKELETON. Optional fun mode:
// critters peek from behind page furniture at angles; never over the playback
// surfaces; no duplicates per page; tap the exposed sliver for a noise. The
// pure core (config / folder-listing / plan / hit-test) is bound directly; the
// jsdom-testable DOM renderer is bound behaviourally; layout-dependent
// measurement is source-locked and remains Dean's device pass (jsdom has no
// layout engine - disclosed in the exec plan).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const {
  CRITTER_DENSITY_COUNTS,
  CRITTER_BUILTINS,
  CRITTER_ANCHOR_SELECTORS,
  CRITTER_EXCLUSION_SELECTORS,
  resolveCritterConfig,
  planCritterScatter,
  critterTapHit,
  renderCritterPlacements,
} = require('../../public/js/common.js');
const { buildCritterListing } = require('../../server.js');

const COMMON = fs.readFileSync(path.join(__dirname, '../../public/js/common.js'), 'utf8');
const CSS = fs.readFileSync(path.join(__dirname, '../../public/css/style.css'), 'utf8');
const SETUP_HTML = fs.readFileSync(path.join(__dirname, '../../public/setup.html'), 'utf8');
const SETUP_JS = fs.readFileSync(path.join(__dirname, '../../public/js/setup.js'), 'utf8');

// Deterministic rng for the pure planner.
function seededRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ---- config ----------------------------------------------------------------

test('density tiers are Dean\'s gentler curve: sparse 1 / normal 6 / obscene 16', () => {
  assert.deepStrictEqual(CRITTER_DENSITY_COUNTS, { sparse: 1, normal: 6, obscene: 16 });
});

test('resolveCritterConfig: OFF by default, density defaults to normal, garbage tolerated', () => {
  const from = (map) => resolveCritterConfig((k) => (k in map ? map[k] : null));
  assert.deepStrictEqual(from({}), { enabled: false, density: 'normal', count: 6 }, 'fresh device: inert');
  assert.deepStrictEqual(from({ 'ft-critters:on': '1' }), { enabled: true, density: 'normal', count: 6 });
  assert.deepStrictEqual(from({ 'ft-critters:on': '1', 'ft-critters:density': 'obscene' }),
    { enabled: true, density: 'obscene', count: 16 });
  assert.deepStrictEqual(from({ 'ft-critters:on': '1', 'ft-critters:density': 'sparse' }).count, 1);
  assert.strictEqual(from({ 'ft-critters:on': '1', 'ft-critters:density': 'ferret' }).density, 'normal',
    'a garbage density falls back to normal');
  assert.strictEqual(from({ 'ft-critters:on': 'yes' }).enabled, false, 'only the literal "1" enables');
  // A throwing reader (storage off) must not throw.
  assert.strictEqual(resolveCritterConfig(() => null).enabled, false);
});

// ---- the folder IS the manifest (server pure half) --------------------------

test('gate S3/S1: duplicate basenames collapse to ONE critter; uppercase sound extensions still pair', () => {
  const out = buildCritterListing(['mopsy.png', 'mopsy.webp', 'Rex.png', 'Rex.MP3']);
  assert.deepStrictEqual(out.map((c) => c.id), ['Rex', 'mopsy'],
    'two image files sharing a basename are ONE critter (the no-duplicate rule keys on id)');
  assert.strictEqual(out.find((c) => c.id === 'mopsy').img, '/critters/mopsy.png', 'first in sorted order wins');
  assert.strictEqual(out.find((c) => c.id === 'Rex').sound, '/critters/Rex.MP3',
    'an UPPERCASE sound extension pairs (the ext is stripped raw, matched lowercased)');
});

test('buildCritterListing: any image becomes a critter; a same-basename sound pairs with it; names never matter', () => {
  const out = buildCritterListing([
    'mopsy.png', 'mopsy.mp3',          // image + its sound
    'freya the cat.webp',              // space in name -> URL-encoded
    'bear.svg',
    'notes.txt', 'README.md',          // non-media ignored
    'lonely.wav',                      // sound with NO image: not a critter
  ]);
  assert.deepStrictEqual(out.map((c) => c.id), ['bear', 'freya the cat', 'mopsy'], 'sorted, images only');
  const mopsy = out.find((c) => c.id === 'mopsy');
  assert.strictEqual(mopsy.img, '/critters/mopsy.png');
  assert.strictEqual(mopsy.sound, '/critters/mopsy.mp3', 'same basename pairs the tap noise');
  assert.strictEqual(out.find((c) => c.id === 'bear').sound, null, 'no pair -> null (client falls back to the chirp)');
  assert.strictEqual(out.find((c) => c.id === 'freya the cat').img, '/critters/freya%20the%20cat.webp', 'URL-encoded');
  assert.deepStrictEqual(buildCritterListing([]), []);
  assert.deepStrictEqual(buildCritterListing(null), [], 'never throws on garbage');
});

// ---- the pure planner -------------------------------------------------------

const ANCHOR = (x, y, w = 200, h = 120) => ({ x, y, w, h });
const MANIFEST_8 = Array.from({ length: 8 }, (_, i) => ({ id: 'c' + i, img: '/critters/c' + i + '.png', sound: null }));

test('planCritterScatter: respects count, never duplicates a critter OR an anchor', () => {
  const anchors = Array.from({ length: 12 }, (_, i) => ANCHOR(10, 10 + i * 200));
  const out = planCritterScatter({ anchors, exclusions: [], manifest: MANIFEST_8, count: 6, rng: seededRng(7) });
  assert.strictEqual(out.length, 6);
  assert.strictEqual(new Set(out.map((p) => p.id)).size, 6, 'no critter appears twice (Dean\'s rule)');
  assert.strictEqual(new Set(out.map((p) => p.anchor.x + ',' + p.anchor.y)).size, 6, 'one critter per anchor');
});

test('planCritterScatter: the count caps at the manifest length (5 with only the built-ins) and at the anchor pool', () => {
  const anchors = Array.from({ length: 12 }, (_, i) => ANCHOR(10, 10 + i * 200));
  assert.strictEqual(
    planCritterScatter({ anchors, exclusions: [], manifest: CRITTER_BUILTINS, count: 16, rng: seededRng(1) }).length,
    5, 'obscene with an empty folder = the 5 built-ins, never repeats');
  assert.strictEqual(
    planCritterScatter({ anchors: anchors.slice(0, 2), exclusions: [], manifest: MANIFEST_8, count: 16, rng: seededRng(2) }).length,
    2, 'few anchors = few critters');
});

test('planCritterScatter: an anchor intersecting a playback exclusion is NEVER used (Dean\'s hard constraint)', () => {
  const player = { x: 0, y: 0, w: 800, h: 450 };
  const anchors = [
    ANCHOR(100, 100),          // inside the player rect -> excluded
    ANCHOR(700, 400),          // straddles the player edge -> excluded
    ANCHOR(100, 600),          // clear of it -> usable
  ];
  const out = planCritterScatter({ anchors, exclusions: [player], manifest: MANIFEST_8, count: 8, rng: seededRng(3) });
  assert.strictEqual(out.length, 1, 'only the clear anchor is used');
  assert.deepStrictEqual(out[0].anchor, anchors[2]);
});

test('planCritterScatter: every placement PEEKS - overlaps its anchor but extends outside it; angle within +-24', () => {
  const anchors = Array.from({ length: 20 }, (_, i) => ANCHOR(200, 200 + i * 300));
  const out = planCritterScatter({ anchors, exclusions: [], manifest: MANIFEST_8, count: 8, rng: seededRng(11) });
  assert.strictEqual(out.length, 8);
  for (const p of out) {
    const a = p.anchor;
    const overlaps = p.x < a.x + a.w && p.x + p.w > a.x && p.y < a.y + a.h && p.y + p.h > a.y;
    const fullyInside = p.x >= a.x && p.x + p.w <= a.x + a.w && p.y >= a.y && p.y + p.h <= a.y + a.h;
    assert.ok(overlaps, 'the critter straddles its anchor (the hidden half)');
    assert.ok(!fullyInside, 'part of the critter sticks OUT (the peeking half)');
    assert.ok(p.angle >= -38 && p.angle <= 38, 'a jaunty (v1.168: wilder) but readable angle');
    assert.ok(p.flip === 1 || p.flip === -1, 'every placement picks a pose direction');
    assert.ok(p.w >= 44 && p.w <= 88, 'CODE owns display size regardless of source render size');
  }
});

test('planCritterScatter: anchors too small to hide behind are skipped (v1.169: the minimum is 24x24 for the avatar micro-ambush)', () => {
  const out = planCritterScatter({
    anchors: [{ x: 10, y: 10, w: 30, h: 20 }], exclusions: [], manifest: MANIFEST_8, count: 4, rng: seededRng(5),
  });
  assert.strictEqual(out.length, 0, 'h=20 still too small');
  const avatar = planCritterScatter({
    anchors: [{ x: 50, y: 500, w: 24, h: 24 }], exclusions: [], manifest: MANIFEST_8, count: 1, rng: seededRng(6),
  });
  assert.strictEqual(avatar.length, 1, 'a 24x24 avatar circle hosts a micro-ambush');
  assert.ok(avatar[0].w >= 26 && avatar[0].w <= 36, 'scaled to the tiny anchor (1.1-1.5x its height)');
});

test('v1.169 FULL-BLEED rule: a full-width anchor only peeks TOP or BOTTOM - never off the screen edge', () => {
  // Dean's mobile-feed screenshots: side/corner peeks off full-bleed cards
  // landed on the viewport edge, amputated. With bounds given, an anchor
  // spanning >=85% of the document width protrudes only vertically.
  const bounds = { w: 400, h: 5000 };
  const card = { x: 8, y: 600, w: 384, h: 300 }; // a full-bleed mobile card
  let tops = 0; let bottoms = 0;
  for (let seed = 1; seed <= 300; seed += 1) {
    const out = planCritterScatter({ anchors: [card], exclusions: [], manifest: MANIFEST_8, count: 1, rng: seededRng(seed), bounds });
    for (const p of out) {
      assert.ok(p.x >= card.x && p.x + p.w <= card.x + card.w,
        `seed ${seed}: horizontal protrusion off a full-bleed card (edge went sideways)`);
      const vertical = p.y < card.y || p.y + p.h > card.y + card.h;
      assert.ok(vertical, `seed ${seed}: the peek must protrude vertically`);
      if (p.y < card.y) tops += 1; else bottoms += 1;
    }
  }
  // Gate S1: BOTH vertical directions must occur (a top-only pool halves the
  // feed's variety silently; ~50/50 over 300 seeds makes >40 each ~8-sigma safe).
  assert.ok(tops > 40 && bottoms > 40, `both directions used (tops=${tops}, bottoms=${bottoms})`);
  // A NON-full-bleed anchor keeps the full 8-position pool (side peeks appear across seeds).
  const narrow = { x: 100, y: 600, w: 200, h: 300 };
  let sideways = 0;
  for (let seed = 1; seed <= 120; seed += 1) {
    const out = planCritterScatter({ anchors: [narrow], exclusions: [], manifest: MANIFEST_8, count: 1, rng: seededRng(seed), bounds });
    for (const p of out) { if (p.x < narrow.x || p.x + p.w > narrow.x + narrow.w) sideways += 1; }
  }
  assert.ok(sideways > 20, 'narrow anchors still get side/corner peeks (' + sideways + '/120)');
});

test('gate W1: a placement\'s OWN rect never intersects an exclusion (a peek must not REACH INTO the player/dock)', () => {
  // The adversarial repro: a card 8px above the dock - an unchecked bottom-edge
  // peek reaches ~40px past the card, INTO the dock. Sweep many seeds; zero
  // placement rects may touch the exclusion (skipped, never nudged).
  const card = { x: 100, y: 850, w: 300, h: 142 };
  const dock = { x: 0, y: 1000, w: 800, h: 80 };
  for (let seed = 1; seed <= 300; seed += 1) {
    const out = planCritterScatter({ anchors: [card], exclusions: [dock], manifest: MANIFEST_8, count: 1, rng: seededRng(seed) });
    for (const p of out) {
      const hits = p.x < dock.x + dock.w && p.x + p.w > dock.x && p.y < dock.y + dock.h && p.y + p.h > dock.y;
      assert.ok(!hits, `seed ${seed}: placement rect reached into the excluded dock`);
    }
  }
});

test('gate W2: an ORIGIN-FLUSH anchor still peeks - never a fully-hidden, untappable critter', () => {
  // The adversarial repro: full-bleed mobile cards at x=0/y=0 engaged the old
  // zero-clamp, snapping ~1/3 of placements fully INSIDE the anchor. Negative
  // coords are legal (they clip off-page - still a peek).
  const flush = { x: 0, y: 0, w: 400, h: 200 };
  for (let seed = 1; seed <= 300; seed += 1) {
    const out = planCritterScatter({ anchors: [flush], exclusions: [], manifest: MANIFEST_8, count: 1, rng: seededRng(seed) });
    for (const p of out) {
      const fullyInside = p.x >= flush.x && p.x + p.w <= flush.x + flush.w && p.y >= flush.y && p.y + p.h <= flush.y + flush.h;
      assert.ok(!fullyInside, `seed ${seed}: placement fully hidden inside its anchor`);
    }
  }
});

test('gate W4: with document bounds, no placement grows the page (right/bottom edges skip)', () => {
  // An anchor flush with the right/bottom document edge: any peek past the
  // bounds is SKIPPED so the scrollable area never widens (zero layout shift).
  const bounds = { w: 500, h: 900 };
  const edgeCard = { x: 300, y: 758, w: 200, h: 142 }; // flush right AND bottom
  for (let seed = 1; seed <= 300; seed += 1) {
    const out = planCritterScatter({ anchors: [edgeCard], exclusions: [], manifest: MANIFEST_8, count: 1, rng: seededRng(seed), bounds });
    for (const p of out) {
      assert.ok(p.x + p.w <= bounds.w, `seed ${seed}: placement widens the document`);
      assert.ok(p.y + p.h <= bounds.h, `seed ${seed}: placement lengthens the document`);
    }
  }
});

test('v1.168 go-harder: corners join the edge pool, peek depth varies, flips split ~50/50, and CSS carries the flip everywhere', () => {
  // Distribution sweep (seeded): flips near half; exposure never outside the
  // 30-65% band on plain edges (corners expose 25-50% per axis).
  const anchors = Array.from({ length: 10 }, (_, i) => ({ x: 200, y: 200 + i * 400, w: 300, h: 200 }));
  let flips = 0; let total = 0;
  for (let seed = 1; seed <= 200; seed += 1) {
    const rng = seededRng(seed * 2654435761 >>> 0);
    for (let w = 0; w < 5; w += 1) rng();
    const out = planCritterScatter({ anchors, exclusions: [], manifest: MANIFEST_8, count: 6, rng });
    for (const p of out) { total += 1; if (p.flip === -1) flips += 1; }
  }
  const rate = flips / total;
  assert.ok(rate > 0.42 && rate < 0.58, `flip rate ${(rate * 100).toFixed(1)}% - expected ~50%`);
  // The flip must ride EVERY transform (base + all reaction keyframes) or a
  // tapped mirrored critter would snap un-mirrored mid-animation.
  const flipSites = (CSS.match(/scaleX\(var\(--critter-flip, 1\)\)/g) || []).length;
  // CRITTER transforms only (an unrelated pull-to-refresh rotate lives in the
  // same file - scope by the --critter-angle token, not by bare rotate()).
  const transformSites = (CSS.match(/rotate\((?:var\(--critter-angle|calc\(var\(--critter-angle)/g) || []).length;
  assert.strictEqual(flipSites, transformSites,
    'every critter transform site carries the flip (base + wiggle/shiver/hop keyframes)');
  assert.ok(flipSites >= 10, 'sanity: the keyframe family is covered, found ' + flipSites);
});

// ---- the tap hit-test -------------------------------------------------------

test('critterTapHit: only the EXPOSED sliver is tappable; anchor-covered points miss', () => {
  // Critter at (90,80) 60x60; its anchor at (100,100) 200x120. The overlap
  // region is hidden BEHIND the anchor; the strip above/left of it is exposed.
  const placements = [{
    id: 'c1', x: 90, y: 80, w: 60, h: 60, anchor: { x: 100, y: 100, w: 200, h: 120 },
  }];
  assert.strictEqual(critterTapHit(placements, 95, 90).id, 'c1', 'exposed sliver hits');
  assert.strictEqual(critterTapHit(placements, 120, 110), null, 'inside critter but covered by the anchor: miss');
  assert.strictEqual(critterTapHit(placements, 400, 400), null, 'outside entirely: miss');
  assert.strictEqual(critterTapHit([], 95, 90), null);
});

test('critterTapHit: the visually-topmost (last-rendered) critter wins an overlap', () => {
  const under = { id: 'under', x: 0, y: 0, w: 60, h: 60, anchor: { x: 500, y: 500, w: 100, h: 100 } };
  const over = { id: 'over', x: 30, y: 30, w: 60, h: 60, anchor: { x: 500, y: 500, w: 100, h: 100 } };
  assert.strictEqual(critterTapHit([under, over], 40, 40).id, 'over');
});

// ---- the built-ins ----------------------------------------------------------

test('the 5 built-in figurines are distinct, original, and colour-token-pure (currentColor only)', () => {
  assert.strictEqual(CRITTER_BUILTINS.length, 5, 'v1.166.1: bun/cat/bear/fox/chick');
  assert.strictEqual(new Set(CRITTER_BUILTINS.map((c) => c.id)).size, 5);
  for (const c of CRITTER_BUILTINS) {
    assert.match(c.svg, /currentColor/, 'colour rides currentColor (era tokens + hue-rotate do the rest)');
    assert.doesNotMatch(c.svg, /#[0-9a-fA-F]{3,6}\b/, 'no raw colour literal hides in the svg');
    assert.match(c.svg, /aria-hidden="true"/);
  }
});

// ---- the DOM renderer (jsdom) ----------------------------------------------

function mount() {
  const dom = new JSDOM('<!DOCTYPE html><body><div id="critter-layer" class="critter-layer"></div></body>', { url: 'http://localhost/' });
  global.window = dom.window;
  global.document = dom.window.document;
  return dom;
}
function unmount(dom) {
  delete global.window; delete global.document;
  dom.window.close();
}

test('renderCritterPlacements (v1.168 sandwich): clipped wrapper + transform-carrying pose; re-render REPLACES', () => {
  const dom = mount();
  try {
    const layer = dom.window.document.getElementById('critter-layer');
    renderCritterPlacements(layer, [
      { id: 'a', x: 10, y: 20, w: 50, h: 50, angle: -12, flip: 1, hue: 90, cover: { b: 25 }, img: null, svg: CRITTER_BUILTINS[0].svg },
      { id: 'b', x: 300, y: 400, w: 60, h: 60, angle: 8, flip: -1, hue: 200, cover: { l: 30 }, img: '/critters/b.png', svg: null },
    ]);
    const kids = layer.querySelectorAll('.critter');
    assert.strictEqual(kids.length, 2);
    // Wrapper: inflated by pad = round(w * 0.3) = 15, clipped, NO transform props.
    assert.strictEqual(kids[0].style.left, '-5px', 'x - pad');
    assert.strictEqual(kids[0].style.top, '5px', 'y - pad');
    assert.strictEqual(kids[0].style.width, '80px', 'w + 2*pad');
    assert.ok(kids[0].style.clipPath.length > 0, 'the anchor-facing cut is applied');
    assert.strictEqual(kids[0].style.getPropertyValue('--critter-angle'), '', 'transforms live on the POSE, not the wrapper');
    // Pose: at (pad, pad), original size, carries angle/flip/hue.
    const pose = kids[0].firstElementChild;
    assert.strictEqual(pose.className, 'critter-pose');
    assert.strictEqual(pose.style.left, '15px');
    assert.strictEqual(pose.style.width, '50px');
    assert.strictEqual(pose.style.getPropertyValue('--critter-angle'), '-12deg');
    assert.strictEqual(pose.style.getPropertyValue('--critter-hue'), '90deg');
    assert.strictEqual(pose.style.getPropertyValue('--critter-flip'), '1', 'un-flipped pose');
    assert.strictEqual(kids[1].firstElementChild.style.getPropertyValue('--critter-flip'), '-1', 'mirrored pose');
    assert.ok(pose.querySelector('svg'), 'a folder-less critter renders its built-in figurine');
    const img = kids[1].querySelector('img');
    assert.ok(img, 'a folder critter renders its image');
    assert.strictEqual(img.getAttribute('src'), '/critters/b.png');
    assert.strictEqual(img.getAttribute('alt'), '', 'decorative');
    // Re-render fully replaces - a second scatter never stacks on the first.
    renderCritterPlacements(layer, [{ id: 'c', x: 1, y: 2, w: 44, h: 44, angle: 0, flip: 1, hue: 0, cover: { t: 10 }, img: null, svg: null }]);
    assert.strictEqual(layer.querySelectorAll('.critter').length, 1, 'no accumulation across scatters');
  } finally { unmount(dom); }
});

test('v1.168 buildCritterClip (pure): edge cuts are insets at pad+cover; corner cuts hide ONLY the shared quadrant', () => {
  const { buildCritterClip } = require('../../public/js/common.js');
  // size 50, pad 15 -> wrapper 80. Bottom concealed by 25 -> bottom inset 40.
  assert.strictEqual(buildCritterClip({ b: 25 }, 50, 15), 'inset(0px 0px 40px 0px)');
  assert.strictEqual(buildCritterClip({ t: 10 }, 50, 15), 'inset(25px 0px 0px 0px)');
  assert.strictEqual(buildCritterClip({ l: 30 }, 50, 15), 'inset(0px 0px 0px 45px)');
  assert.strictEqual(buildCritterClip({ r: 20 }, 50, 15), 'inset(0px 35px 0px 0px)');
  // Corner (tl peek -> r+b concealed): the L keeps everything except the
  // bottom-right quadrant beyond BOTH cuts (cutX = 80-35=45, cutY = 80-40=40).
  assert.strictEqual(buildCritterClip({ r: 20, b: 25 }, 50, 15),
    'polygon(0px 0px, 80px 0px, 80px 40px, 45px 40px, 45px 80px, 0px 80px)');
  // Gate: ALL FOUR corner orientations exact-bound (three shipped untested and
  // their wrong-quadrant mutants survived - the seat derived these expected
  // strings independently of the implementation before prescribing them).
  assert.strictEqual(buildCritterClip({ l: 30, b: 25 }, 50, 15),
    'polygon(0px 0px, 80px 0px, 80px 80px, 45px 80px, 45px 40px, 0px 40px)');
  assert.strictEqual(buildCritterClip({ r: 20, t: 10 }, 50, 15),
    'polygon(0px 0px, 45px 0px, 45px 25px, 80px 25px, 80px 80px, 0px 80px)');
  assert.strictEqual(buildCritterClip({ l: 30, t: 10 }, 50, 15),
    'polygon(45px 0px, 80px 0px, 80px 80px, 0px 80px, 0px 25px, 45px 25px)');
  // A degenerate empty cover still yields a full-box inset (never a throw).
  assert.strictEqual(buildCritterClip({}, 50, 15), 'inset(0px 0px 0px 0px)');
});

// ---- the empty-first-pass retry ladder (v1.166.4) ---------------------------

test('v1.166.4: an EMPTY scatter earns a bounded retry ladder (1.5s then 4s), re-armed per navigation - placed critters never re-roll', () => {
  // Dean's device pass: the watch page stayed critter-less - its anchors are
  // all fetch-then-render (related rail seeds AFTER /api/videos/:id), slower
  // than the 200ms debounce on a VPN'd phone. The empty branch retries; the
  // non-empty branch NEVER does (that would move placed critters mid-view).
  const start = COMMON.indexOf('function scatterCritters()');
  const body = COMMON.slice(start, COMMON.indexOf('\nfunction scheduleCritterScatter', start))
    .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.match(body, /if \(!placements\.length && critterEmptyRetries < 2\)/,
    'ONLY an empty result retries, capped at two attempts');
  assert.match(body, /critterEmptyRetries === 0 \? 1500 : 4000/, 'the ladder: +1.5s then +4s');
  // Gate WARNING (demonstrated race): the two belts that make "never move
  // mid-view" literally true - the STASHED handle + the fire-time emptiness guard.
  assert.match(body, /critterRetryTimer = setTimeout\(function \(\) \{/, 'the retry handle is STASHED (cancellable)');
  assert.match(body, /if \(!critterPlacements\.length\) scatterCritters\(\);/,
    'the retry re-checks emptiness at FIRE time - placed critters can never re-roll');
  const sched = COMMON.slice(COMMON.indexOf('function scheduleCritterScatter()'), COMMON.indexOf('\nfunction wireCritterListeners'));
  assert.match(sched, /critterEmptyRetries = 0;/, 'every scheduled scatter (a navigation) re-arms the ladder');
  assert.match(sched, /if \(critterRetryTimer\) \{ clearTimeout\(critterRetryTimer\); critterRetryTimer = null; \}/,
    'a new navigation CANCELS the previous view\'s pending retry (the stale-timer race, demonstrated by the gate)');
});

// ---- the Docker mount lockstep (v1.166.3 - gate S1) -------------------------

test('v1.166.3: the compose mount and the server folder path stay in LOCKSTEP (the folder-is-the-manifest chain)', () => {
  // Dean's server exposed the gap: the image bakes public/ in, so without the
  // compose bind, host drops never reach the container. Nothing else binds the
  // compose file (grep: zero test hits) - this pair forces a human to move BOTH
  // ends if the folder ever moves.
  const COMPOSE = fs.readFileSync(path.join(__dirname, '../../docker-compose.yml'), 'utf8');
  assert.match(COMPOSE, /- \.\/public\/critters:\/app\/public\/critters/,
    'docker-compose.yml binds the host critter folder over the baked one');
  const SERVER = fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8');
  assert.match(SERVER, /path\.join\(__dirname, 'public', 'critters'\)/,
    'server.js reads the SAME path the mount targets (WORKDIR /app -> /app/public/critters)');
});

// ---- the paint ground (v1.166.1 - Dean's device pass: NOTHING was visible) --

test('v1.166.1: the layer parents INSIDE .main-content (else z-index:-1 hides under the page background)', () => {
  const dom = new JSDOM('<!DOCTYPE html><body><div class="app-container"><div class="main-content"><div id="view-root"></div></div></div></body>', { url: 'http://localhost/' });
  global.window = dom.window; global.document = dom.window.document;
  try {
    const { ensureCritterLayer } = require('../../public/js/common.js');
    const layer = ensureCritterLayer();
    assert.strictEqual(layer.parentElement.className, 'main-content',
      'inside .main-content, whose isolation:isolate makes negative-z paint above the ground, below the furniture');
    // A shell WITHOUT .main-content (login/welcome) falls back to body.
  } finally {
    delete global.window; delete global.document;
    dom.window.close();
  }
});

test('v1.166.1 GROUND CONTRACT (gate C1+C2 structural fix): .main-content paints NO background, creates NO stacking context', () => {
  // The critter plane's z-index:-1 resolves in the ROOT context: above the
  // CANVAS (body's bg), below every furniture background. That works only
  // while nothing between them paints or isolates:
  // - a background here was the v1.166.0 bug (ZERO critters visible on device);
  // - `isolation: isolate` was the first fix and TRAPPED every in-view fixed
  //   overlay (players, podcasts/subscriptions/reloc sheets) under the fixed
  //   chrome - two adversarial CRITICALs. Neither may return.
  const rule = /\.main-content\s*\{([^}]*)\}/.exec(CSS);
  assert.ok(rule, '.main-content rule exists');
  // Comments stripped FIRST (the comment-porous class, in reverse: the ground-
  // contract comment inside the rule SAYS "background"/"isolation").
  const decls = rule[1].replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(decls, /background/i,
    're-adding a background here re-hides the whole critter plane (the v1.166.0 device finding)');
  assert.doesNotMatch(decls, /isolation/i,
    'isolation traps in-view overlays under the fixed chrome (gate C1+C2) - the escape-arm approach is retired');
  assert.doesNotMatch(CSS, /body\.ft-[a-z-]+ \.main-content/,
    'no per-mode escape arms remain (the structural fix made them unnecessary; their return means someone re-isolated)');
  // The canvas ground this design relies on: body still paints the token.
  const body = /(?:^|\n)body\s*\{([^}]*)\}/.exec(CSS);
  assert.match(body[1], /background-color:\s*var\(--bg-color\)/,
    'body paints the ground the critters sit on (propagates to the canvas, below negative-z)');
});

// ---- inertness + wiring source locks ---------------------------------------

test('SOURCE: the mode is inert when disabled - scatterCritters removes the layer and clears placements', () => {
  const start = COMMON.indexOf('function scatterCritters()');
  const body = COMMON.slice(start, COMMON.indexOf('\nfunction scheduleCritterScatter', start));
  assert.match(body, /if \(!cfg\.enabled\)/);
  assert.match(body, /existing\.remove\(\)/, 'the layer is REMOVED, not hidden (the v1.17.0 class)');
  assert.match(body, /critterPlacements = \[\];/, 'stale placements cleared so taps go dead');
  // TOCTOU (the v1.104/v1.105 class): enabled is RE-CHECKED after the manifest await.
  assert.match(body, /RE-CHECK after the await/i);
  assert.match(body, /if \(!resolveCritterConfig\(\)\.enabled\) return;/);
});

test('SOURCE: all three router completion sites schedule a scatter (swap / home-cache restore / boot)', () => {
  const stripped = COMMON.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const hooks = stripped.match(/scheduleCritterScatter\(\);/g) || [];
  // 3 router sites + the debounce's own internals do not use this exact spelling;
  // applyCritterMode adds one more call site.
  assert.ok(hooks.length >= 4, 'expected the 3 router hooks + the settings apply path, found ' + hooks.length);
  const probeSites = stripped.match(/probeAndReconcileRepullButton\(\);\s*\n\s*scheduleCritterScatter\(\);/g) || [];
  assert.strictEqual(probeSites.length, 3, 'co-located with the repull probe at ALL THREE router sites');
});

test('SOURCE: the tap listener stands down for real UI AND every exclusion; taps resolve by INDEX; never preventDefaults', () => {
  const start = COMMON.indexOf('function wireCritterListeners()');
  // Comments stripped FIRST (the comment-porous class): the prose above the
  // listener SAYS "never preventDefault", which would trip the negative lock.
  const body = COMMON.slice(start, COMMON.indexOf('\nfunction applyCritterMode', start))
    .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.match(body, /closest\('a, button, input, select, textarea, label, \[role="button"\]'\)\) return;/,
    'a click on real UI is never treated as a critter tap');
  // Gate QA-W1: the tap path itself honours the exclusions (a chirp over the
  // playing dock / under a dismissing modal backdrop is the forbidden disruption).
  assert.match(body, /closest\(CRITTER_EXCLUSION_SELECTORS\.join\(','\)\)\) return;/,
    'the tap handler stands down over every playback surface + modal backdrop');
  // Gate W3: NEVER a selector built from the id (a raw filename - a legal
  // double-quote name made querySelector THROW). Index into the layer instead.
  assert.match(body, /children\[critterPlacements\.indexOf\(hit\)\]/, 'reaction element resolved by index');
  // v1.168 gate T-POSE: the reaction must animate the POSE, never the clipped
  // WRAPPER - animating the wrapper swings the cut and the hidden half rotates
  // into view mid-tap (the surviving mutant this line kills).
  assert.match(body, /var el = wrap \? wrap\.firstElementChild : null;/, 'reactions target the pose inside the clip');
  assert.doesNotMatch(body, /querySelector\('\.critter\[data-critter-id/, 'no id-built selector remains');
  assert.doesNotMatch(body, /preventDefault/, 'the critter layer never eats a click');
  // Gate W5: only a WIDTH change re-scatters (iOS URL-bar collapse fires
  // height-only resizes mid-scroll; re-scattering then = moving mid-view).
  assert.match(body, /window\.innerWidth === lastCritterViewportW\) return;/,
    'height-only resizes (the iOS URL bar) never re-scatter');
});

test('the exclusion list covers the WHOLE backdrop family via a suffix net (never one-of-N enumeration)', () => {
  assert.ok(CRITTER_EXCLUSION_SELECTORS.indexOf('[class*="-backdrop"]') !== -1,
    'one suffix selector covers all present AND future modal/sheet backdrops');
});

test('gate QA-S7 (behavioural TOCTOU): toggling OFF while the manifest fetch is in flight renders NOTHING', async () => {
  const dom = new JSDOM('<!DOCTYPE html><body></body></html>', { url: 'http://localhost/' });
  const origWindow = global.window; const origDocument = global.document;
  const origFetch = global.fetch; const origLS = global.localStorage;
  global.window = dom.window; global.document = dom.window.document;
  global.localStorage = dom.window.localStorage;
  let resolveFetch;
  global.fetch = () => new Promise((r) => { resolveFetch = r; });
  dom.window.fetch = global.fetch;
  try {
    const { scatterCritters } = require('../../public/js/common.js');
    dom.window.localStorage.setItem('ft-critters:on', '1');
    scatterCritters();                       // enabled -> manifest fetch starts
    dom.window.localStorage.setItem('ft-critters:on', '0'); // user toggles OFF mid-flight
    resolveFetch({ ok: true, json: async () => ({ critters: [] }) });
    await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r));
    assert.strictEqual(dom.window.document.getElementById('critter-layer'), null,
      'the post-await re-check refused to render (deleting the re-check turns this red)');
  } finally {
    global.window = origWindow; global.document = origDocument;
    global.fetch = origFetch; global.localStorage = origLS;
    dom.window.close();
  }
});

test('SOURCE: fetched manifest entries are SANITIZED to {id, img, sound} - the svg field is builtins-only, enforced', () => {
  const start = COMMON.indexOf('function fetchCritterManifest()');
  const body = COMMON.slice(start, COMMON.indexOf('\nfunction collectCritterRects', start));
  assert.match(body, /return \{ id: String\(c && c\.id \|\| ''\), img: \(c && c\.img\) \|\| null, sound: \(c && c\.sound\) \|\| null \};/,
    'a fetched entry can never smuggle an svg field into the innerHTML branch');
});

test('the anchor pool excludes every playback surface (both directions of Dean\'s constraint)', () => {
  for (const sel of ['#player-wrapper', '.player-container', '#player-dock', '#fs-stage']) {
    assert.ok(CRITTER_EXCLUSION_SELECTORS.indexOf(sel) !== -1, sel + ' is an exclusion');
    assert.ok(CRITTER_ANCHOR_SELECTORS.indexOf(sel) === -1, sel + ' is never an anchor');
  }
});

test('v1.166.2: the WATCH page has anchors, and every anchor honours the ground contract (paints a background)', () => {
  // Dean's device pass: the watch view had zero critters - none of the original
  // four selectors exist there. The two watch anchors, and the CONTRACT for
  // every pool entry: its base CSS rule paints a background (the z-1 layer
  // hides the overlap only when the anchor paints over it).
  assert.ok(CRITTER_ANCHOR_SELECTORS.indexOf('.description-container') !== -1, 'the description box anchors');
  assert.ok(CRITTER_ANCHOR_SELECTORS.indexOf('.related-thumb') !== -1, 'related thumbs anchor (the card itself is transparent - this lock caught that)');
  assert.ok(CRITTER_ANCHOR_SELECTORS.indexOf('.comments-section') === -1,
    'the comments section paints NO background - a critter behind it would show through (deliberately not an anchor)');
  for (const sel of CRITTER_ANCHOR_SELECTORS.filter((s) => s.startsWith('.'))) {
    const rule = new RegExp('(?:^|\\n)' + sel.replace('.', '\\.') + '\\s*\\{([^}]*)\\}').exec(CSS);
    assert.ok(rule, sel + ' has a base CSS rule');
    // v1.167 TIGHTENED (the .3 gate's disclosed nit became load-bearing:
    // `.music-artist-card` paints `background: transparent`, which the old
    // spelling would have false-passed): the value must be REAL paint.
    assert.match(rule[1].replace(/\/\*[\s\S]*?\*\//g, ''), /background(?:-color)?:\s*(?!transparent|none)\S/,
      sel + ' must PAINT a real background - transparent/none is not paint (the ground contract)');
  }
});

// ---- v1.167: buttons priority + scale-to-anchor + the fixed-subtree guard ---

test('v1.167: the machine-derived sweep is in the pool; the transparent rejects are NOT', () => {
  for (const sel of ['.btn', '.sub-row', '.history-thumb', '.book-row-cover', '.music-artist-mosaic', '.podcast-card-art', '.comment-input-box', '.thumbnail-container', '.card-channel-avatar']) {
    assert.ok(CRITTER_ANCHOR_SELECTORS.indexOf(sel) !== -1, sel + ' anchors (verified painting)');
  }
  for (const sel of ['.podcast-card', '.music-artist-card', '.music-album-card', '.history-row', '.comment-item', '.stable-row']) {
    assert.ok(CRITTER_ANCHOR_SELECTORS.indexOf(sel) === -1, sel + ' is transparent - rejected by the ground contract');
  }
  const { CRITTER_PRIORITY_SELECTORS, CRITTER_PRIORITY_WEIGHT } = require('../../public/js/common.js');
  assert.deepStrictEqual(CRITTER_PRIORITY_SELECTORS, ['.btn'], 'buttons are the priority tier (Dean\'s ambush ruling)');
  assert.strictEqual(CRITTER_PRIORITY_WEIGHT, 3);
});

test('v1.167: weighted sampling - a priority anchor wins the draw ~3x as often (seeded sweep)', () => {
  // 1 weighted button among 9 plain anchors, ONE pick per plan: uniform would
  // select the button ~1/10 of the time; weight 3 targets ~3/12. Sweep seeds
  // and assert the observed rate lands far from uniform, near the weighted rate.
  const anchors = Array.from({ length: 10 }, (_, i) => ({ x: 10, y: 10 + i * 300, w: 200, h: 120, weight: i === 0 ? 3 : 1 }));
  let hits = 0;
  const RUNS = 600;
  for (let seed = 1; seed <= RUNS; seed += 1) {
    // Warm the LCG: its FIRST draw is nearly constant across adjacent seeds
    // (s*A+C is ~linear in s), which would hand the weighted anchor a fixed
    // key and sandbag the measurement - discard a few draws to decorrelate.
    const rng = seededRng(seed * 2654435761 >>> 0);
    for (let w = 0; w < 7; w += 1) rng();
    const out = planCritterScatter({ anchors, exclusions: [], manifest: MANIFEST_8, count: 1, rng });
    if (out.length && out[0].anchor.y === 10) hits += 1;
  }
  const rate = hits / RUNS;
  assert.ok(rate > 0.17, `weighted anchor won only ${(rate * 100).toFixed(1)}% - weighting is not biting (uniform would be ~10%)`);
  assert.ok(rate < 0.34, `weighted anchor won ${(rate * 100).toFixed(1)}% - weighting overshoots (target ~25%)`);
});

test('v1.167: scale-to-anchor - behind a small button the critter shrinks to ~1.1-1.5x its height and still peeks', () => {
  const button = { x: 200, y: 500, w: 120, h: 36, weight: 3 }; // a real .btn footprint
  for (let seed = 1; seed <= 300; seed += 1) {
    const out = planCritterScatter({ anchors: [button], exclusions: [], manifest: MANIFEST_8, count: 1, rng: seededRng(seed) });
    for (const p of out) {
      assert.ok(p.w >= 26 && p.w <= Math.round(36 * 1.5) + 1, `seed ${seed}: size ${p.w} outside the small-anchor band`);
      const overlaps = p.x < button.x + button.w && p.x + p.w > button.x && p.y < button.y + button.h && p.y + p.h > button.y;
      const fullyInside = p.x >= button.x && p.x + p.w <= button.x + button.w && p.y >= button.y && p.y + p.h <= button.y + button.h;
      assert.ok(overlaps && !fullyInside, `seed ${seed}: the shrunk critter must still straddle the button`);
    }
  }
  // Big anchors keep the original band.
  const box = { x: 10, y: 10, w: 400, h: 200 };
  const out = planCritterScatter({ anchors: [box], exclusions: [], manifest: MANIFEST_8, count: 1, rng: seededRng(9) });
  assert.ok(out[0].w >= 44 && out[0].w <= 88, 'large anchors keep 44-88');
});

test('gate PNB: collectCritterRects WIRING - fixed subtrees skipped AND .btn tagged weight 3 (kills both survivors)', () => {
  // The adversarial's two surviving mutants: deleting the fixed-guard CALLSITE
  // and neutering the weight TAGGING both stayed green - the helper and the
  // pure planner were bound, their wiring was not. This is the seat's verified
  // prescription: one behavioural test through the REAL collector (jsdom
  // reports 0-rects, so marked elements get stub geometry - the .4 lesson).
  const dom = new JSDOM('<!DOCTYPE html><body>'
    + '<div style="position: fixed;"><button class="btn" data-m="1">Pinned</button></div>'
    + '<button class="btn" data-m="1" id="free">Free</button>'
    + '<div class="sub-row" data-m="1"></div>'
    + '</body>', { url: 'http://localhost/' });
  global.window = dom.window; global.document = dom.window.document;
  const proto = dom.window.Element.prototype;
  const orig = proto.getBoundingClientRect;
  proto.getBoundingClientRect = function () {
    if (this.getAttribute && this.getAttribute('data-m')) {
      return { left: 10, top: 10, width: 200, height: 60, right: 210, bottom: 70 };
    }
    return orig.call(this);
  };
  try {
    const { collectCritterRects, CRITTER_ANCHOR_SELECTORS: POOL } = require('../../public/js/common.js');
    const rects = collectCritterRects(POOL, true);
    assert.strictEqual(rects.length, 2, 'the fixed-wrapped button is SKIPPED (viewport rect vs document critters)');
    const weights = rects.map((r) => r.weight).sort();
    assert.deepStrictEqual(weights, [1, 3], 'the free .btn is TAGGED weight 3; .sub-row stays 1 (the ambush priority wiring)');
  } finally {
    proto.getBoundingClientRect = orig;
    delete global.window; delete global.document;
    dom.window.close();
  }
});

test('v1.167: an anchor inside a FIXED subtree is skipped (its rect is viewport-anchored; critters are document-anchored)', () => {
  const dom = new JSDOM('<!DOCTYPE html><body><div id="fixedwrap" style="position: fixed;"><button class="btn" style="width:100px;height:40px">Pinned</button></div><button id="free" class="btn" style="width:100px;height:40px">Free</button></body>', { url: 'http://localhost/' });
  global.window = dom.window; global.document = dom.window.document;
  try {
    const { critterInsideFixed } = require('../../public/js/common.js');
    assert.strictEqual(critterInsideFixed(dom.window.document.querySelector('#fixedwrap .btn')), true,
      'a button inside a fixed header/nav is never an anchor (it would detach from its critter on scroll)');
    assert.strictEqual(critterInsideFixed(dom.window.document.getElementById('free')), false,
      'an in-flow button anchors normally');
  } finally {
    delete global.window; delete global.document;
    dom.window.close();
  }
});

// ---- CSS locks --------------------------------------------------------------

test('tap reactions: a pool of tiny transform-only animations, each defined in CSS and all reduced-motion-safe', () => {
  const { CRITTER_REACTIONS } = require('../../public/js/common.js');
  assert.deepStrictEqual(CRITTER_REACTIONS, ['critter-wiggle', 'critter-shiver', 'critter-hop'],
    'the reaction pool (Dean: "a variety of very very small visual things")');
  const reduced = CSS.split('@media (prefers-reduced-motion: reduce)').slice(1).join('\n');
  for (const cls of CRITTER_REACTIONS) {
    assert.match(CSS, new RegExp('\\.' + cls + '\\s*\\{\\s*animation:\\s*' + cls), cls + ' has its CSS animation');
    const kf = new RegExp('@keyframes ' + cls + '\\s*\\{([\\s\\S]*?)\\n\\}').exec(CSS);
    assert.ok(kf, cls + ' keyframes exist');
    assert.doesNotMatch(kf[1], /margin|left:|top:|width|height/, cls + ' is transform-only (contained, zero layout shift)');
    assert.match(reduced, new RegExp('\\.' + cls.replace(/-/g, '\\-')), cls + ' dies under reduced motion');
  }
  // The tap handler draws from the SAME pool (a new reaction class added in CSS
  // but not the pool - or vice versa - is drift).
  const start = COMMON.indexOf('function wireCritterListeners()');
  const body = COMMON.slice(start, COMMON.indexOf('\nfunction applyCritterMode', start));
  assert.match(body, /CRITTER_REACTIONS\[Math\.floor\(Math\.random\(\) \* CRITTER_REACTIONS\.length\)\]/,
    'the handler picks a random reaction from the shared pool');
});

test('CSS (v1.168 sandwich): the layer paints ABOVE furniture (z 2, under every ladder rung), pose carries the transform', () => {
  // The old z:-1 plane let ANY neighbouring hairline/box swallow a peek (Dean's
  // subscribe-button kitten). Now: layer above z-auto furniture, hidden halves
  // CLIPPED per-critter, transforms on the POSE so the cut stays straight.
  const layer = /\.critter-layer\s*\{([^}]*)\}/.exec(CSS);
  assert.ok(layer, '.critter-layer rule exists');
  const decls = layer[1].replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(decls, /z-index:\s*2/, 'above in-flow furniture, below popovers (20+)/chrome (99+)');
  assert.doesNotMatch(decls, /z-index:\s*-1/, 'the swallowed-peek plane must not return');
  assert.match(decls, /pointer-events:\s*none/, 'the layer never intercepts input');
  const critter = /(?:^|\n)\.critter\s*\{([^}]*)\}/.exec(CSS);
  assert.match(critter[1], /color:\s*var\(--text-secondary\)/, 'placeholder colour rides a token');
  assert.doesNotMatch(critter[1].replace(/\/\*[\s\S]*?\*\//g, ''), /transform/, 'the WRAPPER never transforms (the clip cut must hug the anchor edge)');
  const pose = /\.critter-pose\s*\{([^}]*)\}/.exec(CSS);
  assert.ok(pose, '.critter-pose rule exists');
  assert.match(pose[1], /rotate\(var\(--critter-angle/, 'angles are per-critter custom props on the pose');
  assert.match(CSS, /\.critter svg,\s*\n\.critter img\s*\{[^}]*object-fit:\s*contain/, 'huge source renders scale to the box');
  // (reduced-motion coverage for ALL reactions lives in the tap-reactions test.)
});

// ---- the Settings surface ---------------------------------------------------

test('Settings: the Sneaky critter mode controls exist and setup.js binds them to the two keys + applyCritterMode', () => {
  assert.match(SETUP_HTML, /Sneaky critter mode/);
  assert.match(SETUP_HTML, /id="critter-mode-check"/);
  assert.match(SETUP_HTML, /id="critter-density-select"/);
  for (const v of ['sparse', 'normal', 'obscene']) {
    assert.match(SETUP_HTML, new RegExp('value="' + v + '"'), 'density option ' + v);
  }
  const start = SETUP_JS.indexOf('function wireCritterModeControls');
  assert.ok(start !== -1, 'setup.js wires the controls');
  const body = SETUP_JS.slice(start, SETUP_JS.indexOf('\nfunction ', start + 10));
  assert.match(body, /localStorage\.setItem\('ft-critters:on'/);
  assert.match(body, /localStorage\.setItem\('ft-critters:density'/);
  const applies = body.match(/applyCritterMode\(\);/g) || [];
  assert.strictEqual(applies.length, 2, 'BOTH controls apply immediately (toggle + density)');
  assert.match(SETUP_JS, /wireCritterModeControls\(controller\.signal\)/, 'wired in the settings init path');
});
