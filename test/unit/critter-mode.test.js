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
  assert.strictEqual(out.find((c) => c.id === 'bear').sound, null, 'no pair -> sound stays null (the OWNED-pairing field)');
  assert.strictEqual(out.find((c) => c.id === 'freya the cat').img, '/critters/freya%20the%20cat.webp', 'URL-encoded');
  assert.deepStrictEqual(buildCritterListing([]), []);
  assert.deepStrictEqual(buildCritterListing(null), [], 'never throws on garbage');
});

test('v1.179 the VOICE POOL: unmatched critters BORROW a folder sound deterministically; owned pairings win; chirp only when soundless', () => {
  // Dean: "if a given character doesn't have an MP3 with the corresponding
  // name, I still want them to get a sound that is not our boop... if I do
  // keep at least one name the same, it'll use that file explicitly."
  const out = buildCritterListing(['pearl.png', 'pearl.mp3', 'maple.png', 'biscuit.png', 'lonely.wav']);
  const pearl = out.find((c) => c.id === 'pearl');
  assert.strictEqual(pearl.sound, '/critters/pearl.mp3', 'the explicit pairing is untouched');
  assert.strictEqual(pearl.voice, '/critters/pearl.mp3', 'an owned sound IS the voice');
  const maple = out.find((c) => c.id === 'maple');
  const biscuit = out.find((c) => c.id === 'biscuit');
  assert.strictEqual(maple.sound, null, 'no owned pairing (the manager badge stays honest)');
  const pool = ['/critters/lonely.wav', '/critters/pearl.mp3'];
  assert.ok(pool.includes(maple.voice), 'maple borrows from the folder pool: ' + maple.voice);
  assert.ok(pool.includes(biscuit.voice), 'biscuit borrows too: ' + biscuit.voice);
  // DETERMINISM (the identity property): the same folder yields the same
  // borrowed voice for the same critter, every call, any file order.
  const again = buildCritterListing(['lonely.wav', 'biscuit.png', 'pearl.mp3', 'maple.png', 'pearl.png']);
  assert.strictEqual(again.find((c) => c.id === 'maple').voice, maple.voice, 'stable across calls and input order');
  assert.strictEqual(again.find((c) => c.id === 'biscuit').voice, biscuit.voice);
  // No sounds anywhere: voice null -> the synth chirp remains the fallback.
  const silent = buildCritterListing(['maple.png', 'biscuit.png']);
  assert.strictEqual(silent.find((c) => c.id === 'maple').voice, null, 'a soundless folder keeps the chirp');
  // The SPREAD is the point (my constant-hash mutant survived the binds
  // above - "deterministic and in-pool" is satisfiable by everyone sharing
  // pool[0]): six unmatched critters over three sounds must land on more
  // than one voice. Measured against the real hash first: these ids spread
  // across all three.
  const spread = buildCritterListing(['a.png', 'b.png', 'c.png', 'd.png', 'e.png', 'f.png', 'x.mp3', 'y.mp3', 'z.mp3']);
  assert.ok(new Set(spread.map((c) => c.voice)).size >= 2,
    'borrowed voices SPREAD across the pool - a constant hash (everyone gets pool[0]) reds here');
  // Gate W closure: a basename with TWO sound extensions must resolve the
  // same way in ANY readdir order (the seat's repro: last-write-wins on an
  // UNSORTED iteration flipped both the owned pairing and the pool member
  // with folder churn). Lexicographic last-wins: rex.wav.
  const dualA = buildCritterListing(['a.png', 'rex.png', 'rex.mp3', 'rex.wav']);
  const dualB = buildCritterListing(['rex.wav', 'rex.mp3', 'rex.png', 'a.png']);
  assert.strictEqual(dualA.find((c) => c.id === 'rex').sound, '/critters/rex.wav', 'deterministic owned pairing');
  assert.strictEqual(dualB.find((c) => c.id === 'rex').sound, dualA.find((c) => c.id === 'rex').sound, 'order-independent');
  assert.strictEqual(dualB.find((c) => c.id === 'a').voice, dualA.find((c) => c.id === 'a').voice, 'order-independent borrow');
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

test('planCritterScatter: every placement PEEKS - overlaps its anchor but extends outside it; tilt within +-38 around its base', () => {
  const anchors = Array.from({ length: 20 }, (_, i) => ANCHOR(200, 200 + i * 300));
  const out = planCritterScatter({ anchors, exclusions: [], manifest: MANIFEST_8, count: 8, rng: seededRng(11) });
  assert.strictEqual(out.length, 8);
  for (const p of out) {
    const a = p.anchor;
    const overlaps = p.x < a.x + a.w && p.x + p.w > a.x && p.y < a.y + a.h && p.y + p.h > a.y;
    const fullyInside = p.x >= a.x && p.x + p.w <= a.x + a.w && p.y >= a.y && p.y + p.h <= a.y + a.h;
    assert.ok(overlaps, 'the critter straddles its anchor (the hidden half)');
    assert.ok(!fullyInside, 'part of the critter sticks OUT (the peeking half)');
    // v1.170: the angle is a TILT of at most +-38 around a base of 0deg
    // (upright) or 180deg (a bottom-family peek hangs head-down).
    const tilt = Math.cos(p.angle * Math.PI / 180) < 0 ? p.angle - 180 : p.angle;
    assert.ok(tilt >= -38 && tilt <= 38, 'a jaunty (v1.168: wilder) but readable tilt, got angle ' + p.angle);
    assert.ok(p.flip === 1 || p.flip === -1, 'every placement picks a pose direction');
    // 200x120 anchors: even a max-tilt 88px critter fits the cross axis
    // (88*1.404 < 120*1.15), so the v1.170 fit never shrinks the big band.
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
      { id: 'a', x: 10, y: 20, w: 50, h: 50, angle: -12, flip: 1, hue: 90, cover: { b: 25 }, anchor: { x: 0, y: 45, w: 300, h: 100 }, img: null, svg: CRITTER_BUILTINS[0].svg },
      { id: 'b', x: 300, y: 400, w: 60, h: 60, angle: 8, flip: -1, hue: 200, cover: { l: 30 }, anchor: { x: 200, y: 380, w: 130, h: 120 }, img: '/critters/b.png', svg: null },
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
    assert.strictEqual(pose.style.getPropertyValue('--critter-hue'), '90deg', 'BUILTINS keep the hue variety spin');
    assert.strictEqual(pose.style.getPropertyValue('--critter-flip'), '1', 'un-flipped pose');
    // v1.179.2 (Dean): uploaded art is COLOR-FAITHFUL - no hue var on an img
    // critter; the filter's 0deg fallback is a no-op rotation.
    assert.strictEqual(kids[1].firstElementChild.style.getPropertyValue('--critter-hue'), '',
      'an IMAGE critter renders exactly as the file - the hue spin is builtins-only');
    assert.strictEqual(kids[1].firstElementChild.style.getPropertyValue('--critter-flip'), '-1', 'mirrored pose');
    assert.ok(pose.querySelector('svg'), 'a folder-less critter renders its built-in figurine');
    const img = kids[1].querySelector('img');
    assert.ok(img, 'a folder critter renders its image');
    assert.strictEqual(img.getAttribute('src'), '/critters/b.png');
    assert.strictEqual(img.getAttribute('alt'), '', 'decorative');
    // Re-render fully replaces - a second scatter never stacks on the first.
    renderCritterPlacements(layer, [{ id: 'c', x: 1, y: 2, w: 44, h: 44, angle: 0, flip: 1, hue: 0, cover: { t: 10 }, anchor: { x: 0, y: 0, w: 200, h: 12 }, img: null, svg: null }]);
    assert.strictEqual(layer.querySelectorAll('.critter').length, 1, 'no accumulation across scatters');
  } finally { unmount(dom); }
});

test('v1.174 buildCritterClip (pure GEOMETRIC TRUTH): the hidden region is the MEASURED critter/anchor intersection, per topology', () => {
  const { buildCritterClip } = require('../../public/js/common.js');
  // Fixed placement: box (100,100) 50x50, pad 15 -> wrapper 80x80; a doc
  // coordinate d maps to wrapper-local 15 + (d - 100).
  const P = (anchor) => ({ x: 100, y: 100, w: 50, h: 50, anchor });
  const pad = 15;
  // THREE touched sides (the classic big-anchor edge peeks) -> plain insets.
  assert.strictEqual(buildCritterClip(P({ x: 0, y: 125, w: 400, h: 200 }), pad),
    'inset(0px 0px 40px 0px)', 'anchor below: visible top strip [0..40]');
  assert.strictEqual(buildCritterClip(P({ x: 0, y: 0, w: 400, h: 125 }), pad),
    'inset(40px 0px 0px 0px)', 'anchor above: visible bottom strip');
  assert.strictEqual(buildCritterClip(P({ x: 125, y: 0, w: 300, h: 400 }), pad),
    'inset(0px 40px 0px 0px)', 'anchor right: visible left strip');
  assert.strictEqual(buildCritterClip(P({ x: 0, y: 0, w: 125, h: 400 }), pad),
    'inset(0px 0px 0px 40px)', 'anchor left: visible right strip');
  // TWO ADJACENT (corner peeks) -> the v1.168 L, all four orientations.
  assert.strictEqual(buildCritterClip(P({ x: 120, y: 130, w: 200, h: 200 }), pad),
    'polygon(0px 0px, 80px 0px, 80px 45px, 35px 45px, 35px 80px, 0px 80px)', 'anchor bottom-right (tl peek)');
  assert.strictEqual(buildCritterClip(P({ x: 0, y: 130, w: 130, h: 200 }), pad),
    'polygon(0px 0px, 80px 0px, 80px 80px, 45px 80px, 45px 45px, 0px 45px)', 'anchor bottom-left (tr peek)');
  assert.strictEqual(buildCritterClip(P({ x: 120, y: 0, w: 200, h: 130 }), pad),
    'polygon(0px 0px, 35px 0px, 35px 45px, 80px 45px, 80px 80px, 0px 80px)', 'anchor top-right (bl peek)');
  assert.strictEqual(buildCritterClip(P({ x: 0, y: 0, w: 130, h: 130 }), pad),
    'polygon(45px 0px, 80px 0px, 80px 80px, 0px 80px, 0px 45px, 45px 45px)', 'anchor top-left (br peek)');
  // ONE touched side (the C-notch): unreachable from today's planner (the
  // cross-fit caps size at 1.15x the anchor cross extent - the seat measured
  // 0 occurrences over 92k placements), kept as defense-in-depth. Gate
  // WARNING closure: ALL FOUR orientations exact-bound - the R-only coverage
  // left T/B/L emit mutants green, the v1.168 corner class re-struck.
  assert.strictEqual(buildCritterClip(P({ x: 130, y: 110, w: 60, h: 20 }), pad),
    'polygon(0px 0px, 80px 0px, 80px 25px, 45px 25px, 45px 45px, 80px 45px, 80px 80px, 0px 80px)',
    'R-notch: small anchor to the right hides only its actual [45..80]x[25..45] footprint');
  assert.strictEqual(buildCritterClip(P({ x: 110, y: 80, w: 20, h: 40 }), pad),
    'polygon(0px 0px, 25px 0px, 25px 35px, 45px 35px, 45px 0px, 80px 0px, 80px 80px, 0px 80px)',
    'T-notch: narrow anchor from above');
  assert.strictEqual(buildCritterClip(P({ x: 110, y: 130, w: 20, h: 60 }), pad),
    'polygon(0px 0px, 80px 0px, 80px 80px, 45px 80px, 45px 45px, 25px 45px, 25px 80px, 0px 80px)',
    'B-notch: narrow anchor from below');
  assert.strictEqual(buildCritterClip(P({ x: 80, y: 110, w: 40, h: 20 }), pad),
    'polygon(0px 0px, 80px 0px, 80px 80px, 0px 80px, 0px 45px, 35px 45px, 35px 25px, 0px 25px)',
    'L-notch: small anchor to the left');
  // TWO OPPOSITE sides: a band across (deep inward reach on a short anchor);
  // both free strips ride ONE traced path.
  assert.strictEqual(buildCritterClip(P({ x: 110, y: 90, w: 20, h: 200 }), pad),
    'polygon(0px 0px, 25px 0px, 25px 80px, 45px 80px, 45px 0px, 80px 0px, 80px 80px, 0px 80px)',
    'narrow tall anchor through the middle: vertical band hidden, both sides visible');
  // Degenerates: no overlap and no anchor clip NOTHING (never a floating cut);
  // full cover hides everything (the planner peek invariant makes it unreachable).
  assert.strictEqual(buildCritterClip(P({ x: 500, y: 500, w: 50, h: 50 }), pad), '');
  assert.strictEqual(buildCritterClip({ x: 100, y: 100, w: 50, h: 50 }, pad), '');
  assert.strictEqual(buildCritterClip(P({ x: 0, y: 0, w: 400, h: 400 }), pad), 'inset(40px)');
});

test('v1.174 THE CLASS INVARIANT: every internal cut line lies ON an anchor edge - floating cuts are geometrically impossible', () => {
  // Dean: "We fix that class of bugs and it's done." Sweep real planner
  // output over the shapes that produced the bug (a small wide button, the
  // 24px micro-anchor, a tall narrow anchor) and assert every coordinate in
  // every emitted clip is either a wrapper edge (0/W) or an anchor edge
  // mapped into wrapper coords (+-1px rounding).
  const shapes = [
    { x: 200, y: 500, w: 120, h: 44 },
    { x: 60, y: 400, w: 24, h: 24 },
    { x: 300, y: 300, w: 44, h: 120 },
  ];
  const { buildCritterClip } = require('../../public/js/common.js');
  let clips = 0;
  for (const a of shapes) {
    for (let seed = 1; seed <= 300; seed += 1) {
      const out = planCritterScatter({ anchors: [a], exclusions: [], manifest: MANIFEST_8, count: 1, rng: seededRng(seed) });
      for (const p of out) {
        const pad = Math.round(p.w * 0.3);
        const clip = buildCritterClip(p, pad);
        if (!clip) continue;
        clips += 1;
        const W = p.w + 2 * pad;
        const anchorEdges = [
          pad + (a.x - p.x), pad + (a.x + a.w - p.x),
          pad + (a.y - p.y), pad + (a.y + a.h - p.y),
        ];
        // inset(t r b l) values are OFFSETS from each edge - convert to cut
        // COORDINATES (right cut x = W-r, bottom cut y = W-b); polygon points
        // are coordinates already. The full-cover guard inset(Npx) is accepted
        // as-is (its planner case is unreachable; guarded).
        const raw = [...clip.matchAll(/(-?\d+)px/g)].map((m) => Number(m[1]));
        let coords = raw;
        const insetM = clip.match(/^inset\((-?\d+)px (-?\d+)px (-?\d+)px (-?\d+)px\)$/);
        if (insetM) {
          const [t, r, b, l] = insetM.slice(1).map(Number);
          coords = [t, W - r, W - b, l];
        } else if (/^inset\(-?\d+px\)$/.test(clip)) {
          coords = [];
        }
        for (const c of coords) {
          const ok = c === 0 || c === W || anchorEdges.some((e) => Math.abs(e - c) <= 1);
          assert.ok(ok, `seed ${seed} anchor ${a.w}x${a.h}: cut at ${c} is on NO anchor edge (W=${W}, edges ${anchorEdges.map((e) => e.toFixed(1)).join(',')}) - a floating cut (${clip})`);
        }
      }
    }
  }
  assert.ok(clips > 500, `the sweep exercised real clips (${clips})`);
});

// ---- the post-scatter settle ladder (v1.166.4 empty + v1.173 drift) ---------

test('v1.166.4/v1.173: every scatter arms a bounded settle ladder (1.5s then 4s) whose fire-time decision is the PURE critterSettleAction', () => {
  // v1.166.4: watch-style views measure ZERO anchors on the first pass
  // (fetch-then-render, slower than the 200ms debounce on a VPN'd phone).
  // v1.173 (Dean's "Dreams of a Life" screenshot): a page that placed against
  // its loading SKELETONS reflows when real content lands - the placed
  // critters keep their document coords and float over TEXT. The ladder now
  // re-checks BOTH at fire time via critterSettleAction; a settled page
  // stands down, so placed critters still never re-roll.
  const scatterBody = COMMON.slice(COMMON.indexOf('function scatterCritters()'), COMMON.indexOf('\nfunction armCritterSettleCheck'))
    .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.match(scatterBody, /armCritterSettleCheck\(\);/, 'every scatter arms the shared settle check');
  assert.match(scatterBody, /critterPlacedDocH = docEl\.scrollHeight;/, 'the placed-against height is stashed at placement time');
  // v1.176: the arm + fire live in the SHARED helper (the re-glue pass keeps
  // the remaining checks alive through it too).
  const body = COMMON.slice(COMMON.indexOf('function armCritterSettleCheck'), COMMON.indexOf('\nfunction reglueCritterPlacements'))
    .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.match(body, /if \(critterSettleChecks >= 2\) return;/, 'capped at two checks per navigation');
  assert.match(body, /critterSettleChecks === 0 \? 1500 : 4000/, 'the ladder: +1.5s then +4s');
  // Gate WARNING (demonstrated race): the belts that make "never move
  // mid-view" literally true - the STASHED handle + the LIVE fire-time reads.
  assert.match(body, /critterRetryTimer = setTimeout\(function \(\) \{/, 'the settle handle is STASHED (cancellable)');
  assert.match(body,
    /critterSettleAction\(critterPlacements\.length, critterPlacedDocH, document\.documentElement\.scrollHeight\)/,
    'the fire-time decision reads LIVE placements + LIVE height, never captured snapshots');
  assert.match(body, /if \(action === 'rescatter-empty'\) scatterCritters\(\);/, 'EMPTY earns the full scatter (nothing to preserve)');
  assert.match(body, /else if \(action === 'rescatter-drift'\) reglueCritterPlacements\(\);/,
    'v1.176: DRIFT re-GLUES - placed critters ride their own anchors, never re-roll');
  const reglue = COMMON.slice(COMMON.indexOf('function reglueCritterPlacements'), COMMON.indexOf('\n// Debounced entry point'))
    .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.match(reglue, /renderCritterPlacements\(ensureCritterLayer\(\), survivors, true\);/, 're-glue renders STILL (no fade replay)');
  assert.match(reglue, /armCritterSettleCheck\(\);/, 're-glue keeps the remaining checks alive');
  assert.match(reglue, /critterRectsIntersect\(rect, exclusions\[e\]\)/, 'a critter sliding into the player/dock is DROPPED');
  const nudge = COMMON.slice(COMMON.indexOf('function wireCritterContentNudge'), COMMON.indexOf('function unwireCritterContentNudge'));
  assert.match(nudge, /if \(action === 'rescatter-empty'\) scatterCritters\(\);\n\s*else reglueCritterPlacements\(\);/,
    'the nudge maps identically: empty scatters, drift re-glues');
  const sched = COMMON.slice(COMMON.indexOf('function scheduleCritterScatter()'), COMMON.indexOf('\nfunction wireCritterListeners'));
  assert.match(sched, /critterSettleChecks = 0;/, 'every scheduled scatter (a navigation) re-arms the ladder');
  assert.match(sched, /if \(critterRetryTimer\) \{ clearTimeout\(critterRetryTimer\); critterRetryTimer = null; \}/,
    'a new navigation CANCELS the previous view\'s pending check (the stale-timer race, demonstrated by the gate)');
});

test('v1.173 critterSettleAction (pure): empty always retries; placed critters re-scatter ONLY past the 24px drift threshold', () => {
  const { critterSettleAction } = require('../../public/js/common.js');
  assert.strictEqual(critterSettleAction(0, 1000, 1000), 'rescatter-empty', 'empty placements retry regardless of height');
  assert.strictEqual(critterSettleAction(0, 1000, 900), 'rescatter-empty');
  assert.strictEqual(critterSettleAction(6, 1000, 1000), 'stand-down', 'settled page: never re-roll');
  assert.strictEqual(critterSettleAction(6, 1000, 1024), 'stand-down', 'exactly at threshold: still settled (24px is jitter headroom)');
  assert.strictEqual(critterSettleAction(6, 1000, 1025), 'rescatter-drift', 'past threshold: the page reflowed under the critters');
  assert.strictEqual(critterSettleAction(6, 1000, 970), 'rescatter-drift', 'SHRINK drifts too (the one-line-title case shifts content UP)');
  assert.strictEqual(critterSettleAction(1, 500.4, 500.9), 'stand-down', 'fractional heights are truncated, not drift');
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
  assert.match(body, /return \{ id: String\(c && c\.id \|\| ''\), img: \(c && c\.img\) \|\| null, sound: \(c && c\.sound\) \|\| null, voice: \(c && c\.voice\) \|\| null \};/,
    'a fetched entry can never smuggle an svg field into the innerHTML branch (v1.179: voice joins the whitelist)');
  // v1.179: the placement's sound is the EFFECTIVE voice - the tap path
  // plays owned-or-borrowed unchanged, chirping only when both are null.
  const planner = COMMON.slice(COMMON.indexOf('function planCritterScatter'), COMMON.indexOf('\nfunction critterTapHit'));
  assert.match(planner, /sound: c\.voice \|\| c\.sound \|\| null/, 'the borrowed voice reaches the tap through the placement');
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

// ---- v1.170 peek-fit polish (Dean's three screenshots) ----------------------

test('v1.170 CROSS-AXIS FIT: no critter towers over a small button - rotated extent capped at 1.15x the anchor cross axis', () => {
  // Dean's screenshot: critters TALLER than the 44px action buttons read as
  // notched floating cut-outs (the sandwich clip hides only the covered band;
  // the bands past the anchor's far edges stay visible). Sweep: every
  // placement's ROTATED extent perpendicular to its peek direction fits the
  // anchor's extent there (15% grace, +1px rounding slack).
  const button = { x: 200, y: 500, w: 120, h: 44 };
  let sideOrCorner = 0;
  for (let seed = 1; seed <= 300; seed += 1) {
    const out = planCritterScatter({ anchors: [button], exclusions: [], manifest: MANIFEST_8, count: 1, rng: seededRng(seed) });
    for (const p of out) {
      const tilt = Math.cos(p.angle * Math.PI / 180) < 0 ? p.angle - 180 : p.angle;
      const rad = Math.abs(tilt) * Math.PI / 180;
      const extent = p.w * (Math.sin(rad) + Math.cos(rad));
      const c = p.cover;
      const corner = ((c.l ? 1 : 0) + (c.r ? 1 : 0) + (c.t ? 1 : 0) + (c.b ? 1 : 0)) === 2;
      const side = !corner && (c.l > 0 || c.r > 0);
      const allow = corner ? Math.min(button.w, button.h) : (side ? button.h : button.w);
      assert.ok(extent <= allow * 1.15 + 1,
        `seed ${seed}: rotated extent ${extent.toFixed(1)} exceeds allowed ${(allow * 1.15).toFixed(1)} (cover ${JSON.stringify(c)})`);
      if (side || corner) sideOrCorner += 1;
    }
  }
  assert.ok(sideOrCorner > 40, 'the sweep actually exercised side/corner peeks (' + sideOrCorner + ')');
});

test('v1.170 micro-anchor: a 24px avatar disc hosts a near-upright critter its own size, carrying the disc for the renderer', () => {
  const avatar = { x: 60, y: 400, w: 24, h: 24, round: true };
  let placed = 0;
  for (let seed = 1; seed <= 200; seed += 1) {
    const out = planCritterScatter({ anchors: [avatar], exclusions: [], manifest: MANIFEST_8, count: 1, rng: seededRng(seed) });
    for (const p of out) {
      placed += 1;
      const tilt = Math.cos(p.angle * Math.PI / 180) < 0 ? p.angle - 180 : p.angle;
      const rad = Math.abs(tilt) * Math.PI / 180;
      assert.ok(p.w >= 26, `seed ${seed}: the 26px floor holds`);
      assert.ok(p.w * (Math.sin(rad) + Math.cos(rad)) <= 24 * 1.15 + 1,
        `seed ${seed}: micro-anchor fit violated (w=${p.w}, tilt=${tilt})`);
      assert.ok(Math.abs(tilt) <= 4, `seed ${seed}: at the size floor the TILT flattens instead (got ${tilt})`);
      // Round pass-through: the disc, in critter-local coordinates.
      assert.ok(p.roundCover, 'a circle anchor carries roundCover');
      assert.strictEqual(p.roundCover.r, 12);
      assert.strictEqual(p.roundCover.cx, 60 + 12 - p.x);
      assert.strictEqual(p.roundCover.cy, 400 + 12 - p.y);
    }
  }
  assert.ok(placed > 150, 'the sweep placed critters (' + placed + ')');
});

test('v1.170 bottom-family flip: a peek below its element hangs HEAD-DOWN (base 180deg) - and BOTH bases actually occur', () => {
  // Dean: "looks like critter feet behind an element... maybe reverse the
  // image 180 degrees?" - his fix, both directions bound (the v1.169
  // top-only-pool survivor: directional asserts need explicit counters).
  const anchors = [{ x: 100, y: 500, w: 200, h: 120 }];
  let headDownCount = 0; let uprightCount = 0;
  for (let seed = 1; seed <= 300; seed += 1) {
    const out = planCritterScatter({ anchors, exclusions: [], manifest: MANIFEST_8, count: 1, rng: seededRng(seed) });
    for (const p of out) {
      const bottomFamily = p.cover.t > 0; // concealed from ABOVE = emerging below
      const headDown = Math.cos(p.angle * Math.PI / 180) < 0;
      assert.strictEqual(headDown, bottomFamily,
        `seed ${seed}: 180-flip iff bottom-family (angle ${p.angle}, cover ${JSON.stringify(p.cover)})`);
      if (headDown) headDownCount += 1; else uprightCount += 1;
    }
  }
  assert.ok(headDownCount > 40 && uprightCount > 40,
    `both pose bases occur (headDown=${headDownCount}, upright=${uprightCount})`);
});

test('v1.170 buildCritterRoundMask (pure): transparent inside the disc, opaque past a half-px rim, pad-shifted centre', () => {
  const { buildCritterRoundMask } = require('../../public/js/common.js');
  assert.strictEqual(buildCritterRoundMask({ cx: 10, cy: 20, r: 12 }, 15),
    'radial-gradient(circle at 25px 35px, transparent 12px, #000 12.5px)');
  assert.strictEqual(buildCritterRoundMask({ cx: -4, cy: 0, r: 22 }, 13),
    'radial-gradient(circle at 9px 13px, transparent 22px, #000 22.5px)');
});

test('v1.170 renderer: roundCover swaps the rect clip for the circular mask class + custom property; rect placements the reverse', () => {
  const dom = new JSDOM('<!DOCTYPE html><body><div id="critter-layer"></div></body>', { url: 'http://localhost/' });
  global.window = dom.window; global.document = dom.window.document;
  try {
    const layer = dom.window.document.getElementById('critter-layer');
    renderCritterPlacements(layer, [
      { id: 'r', x: 50, y: 60, w: 30, h: 30, angle: 0, flip: 1, hue: 0, cover: { l: 10 }, roundCover: { cx: 15, cy: 15, r: 12 }, img: '/critters/r.png', svg: null },
      { id: 'q', x: 200, y: 60, w: 40, h: 40, angle: 0, flip: 1, hue: 0, cover: { l: 10 }, roundCover: null, anchor: { x: 140, y: 40, w: 70, h: 100 }, img: '/critters/q.png', svg: null },
    ]);
    const roundEl = layer.children[0];
    const rectEl = layer.children[1];
    // pad = round(30*0.3) = 9 -> centre shifts to (24, 24).
    assert.ok(roundEl.classList.contains('critter-round'), 'round anchors get the mask class');
    assert.strictEqual(roundEl.style.getPropertyValue('--critter-mask'),
      'radial-gradient(circle at 24px 24px, transparent 12px, #000 12.5px)');
    assert.strictEqual(roundEl.style.clipPath, '', 'NEVER the rect clip on a disc - square corners cut hard edges (Dean\'s Bernard)');
    assert.ok(!rectEl.classList.contains('critter-round'), 'rect anchors keep the sandwich clip...');
    assert.ok(rectEl.style.clipPath.length > 0, '...which is applied');
    assert.strictEqual(rectEl.style.getPropertyValue('--critter-mask'), '', 'and never the mask');
    // The CSS side of the seam: BOTH mask spellings consume the custom property.
    assert.match(CSS, /\.critter-round\s*\{[^}]*-webkit-mask-image:\s*var\(--critter-mask, none\)/, 'webkit spelling (iOS)');
    assert.match(CSS, /\.critter-round\s*\{[^}]*[^-]mask-image:\s*var\(--critter-mask, none\)/, 'standard spelling (Firefox)');
  } finally { delete global.window; delete global.document; dom.window.close(); }
});

test('v1.170 collector: a TRUE circle is marked round; pills and slightly-rounded squares are not; unreadable style fails OPEN', () => {
  const dom = new JSDOM('<!DOCTYPE html><body>'
    + '<div class="card-channel-avatar" data-m="avatar"></div>'
    + '<button class="btn" data-m="pill">Pill</button>'
    + '<button class="btn" data-m="square">Sq</button>'
    + '<div class="setup-box" data-m="quarter"></div>'
    + '</body>', { url: 'http://localhost/' });
  global.window = dom.window; global.document = dom.window.document;
  const proto = dom.window.Element.prototype;
  const orig = proto.getBoundingClientRect;
  const RECTS = {
    avatar: { left: 10, top: 10, width: 24, height: 24 },   // square + 50% radius = circle
    pill: { left: 50, top: 10, width: 120, height: 40 },    // 50% radius but WIDE = pill, not a circle
    square: { left: 200, top: 10, width: 44, height: 44 },  // square but small radius
    quarter: { left: 300, top: 10, width: 60, height: 60 }, // square, 25% radius - rounded, NOT a circle
  };
  proto.getBoundingClientRect = function () {
    const m = this.getAttribute && this.getAttribute('data-m');
    if (m && RECTS[m]) {
      const r = RECTS[m];
      return { left: r.left, top: r.top, width: r.width, height: r.height, right: r.left + r.width, bottom: r.top + r.height };
    }
    return orig.call(this);
  };
  // jsdom's css engine does not expand border-radius shorthands reliably, so
  // the computed-style READ is stubbed; the parse/decision logic is the target.
  const origGCS = dom.window.getComputedStyle;
  dom.window.getComputedStyle = (el) => {
    const m = el.getAttribute && el.getAttribute('data-m');
    return { position: 'static', borderTopLeftRadius: m === 'square' ? '8px' : (m === 'quarter' ? '25%' : '50%') };
  };
  try {
    const { collectCritterRects, CRITTER_ANCHOR_SELECTORS: POOL } = require('../../public/js/common.js');
    const rects = collectCritterRects(POOL, true);
    const byW = (w) => rects.find((r) => r.w === w);
    assert.strictEqual(byW(24).round, true, 'the 24px 50%-radius avatar IS a circle');
    assert.strictEqual(byW(120).round, false, 'a 50%-radius PILL is not (w far from h)');
    assert.strictEqual(byW(44).round, false, 'an 8px-radius square is not');
    // Gate M12 closure: the sub-50 PERCENT arm was unbound - a 25% radius on
    // a square box must classify as rounded, never as a circle.
    assert.strictEqual(byW(60).round, false, 'a 25%-radius square is rounded, NOT a circle');
    // Fail OPEN: an unreadable RADIUS downgrades to the rect clip. (The
    // position read must keep working - a fully-throwing stub would instead
    // trip critterInsideFixed's fail-CLOSED catch and skip the anchor.)
    dom.window.getComputedStyle = () => ({ position: 'static', get borderTopLeftRadius() { throw new Error('nope'); } });
    const rects2 = collectCritterRects(['.card-channel-avatar'], true);
    assert.strictEqual(rects2.length, 1, 'still collected');
    assert.strictEqual(rects2[0].round, false, 'unreadable style -> rect clip (a sharper cut, never a bad hide)');
  } finally {
    proto.getBoundingClientRect = orig;
    dom.window.getComputedStyle = origGCS;
    delete global.window; delete global.document;
    dom.window.close();
  }
});

// ---- v1.172: master-detail pane swaps re-scatter (Dean's Settings shots) ----

// Dean's screenshots: the SAME critters floated over BOTH the Settings menu
// and an open section - a pane swap changes what fills the screen but the
// router never fires, so the stale scatter survived. The bind is END-TO-END
// behavioral: with critter mode DISABLED, a scatter pass REMOVES an existing
// #critter-layer - so "the pipeline ran after a pane transition" is observable
// as the seeded layer disappearing after the 200ms debounce.
function mountMdWithLayer() {
  const MD_ROOT = SETUP_HTML.match(/<div class="md-root" data-md-page="setup"[\s\S]*?<\/div><!-- \/\.md-root -->/);
  assert.ok(MD_ROOT, 'setup.html carries the .md-root wrapper');
  const dom = new JSDOM('<!DOCTYPE html><html data-theme="2021"><body>' + MD_ROOT[0]
    + '<div id="critter-layer" class="critter-layer"></div></body></html>', { url: 'http://localhost/setup.html' });
  global.window = dom.window; global.document = dom.window.document;
  global.MutationObserver = dom.window.MutationObserver; global.localStorage = dom.window.localStorage;
  return dom;
}
function unmountMd(dom) {
  delete global.window; delete global.document; delete global.MutationObserver; delete global.localStorage;
  dom.window.close();
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 320)); // past the 200ms debounce

test('v1.172: drilling into a section re-runs the scatter pipeline (the stale cross-pane critters, Dean\'s screenshots)', async () => {
  const dom = mountMdWithLayer();
  try {
    const { wireMasterDetail } = require('../../public/js/common.js');
    wireMasterDetail('setup', dom.window.document, new dom.window.AbortController().signal);
    await settle();
    assert.ok(dom.window.document.getElementById('critter-layer'),
      'wiring ALONE never scatters - the initial pass belongs to the router hook');
    const row = dom.window.document.querySelector('.md-nav .md-row');
    assert.ok(row, 'the menu rendered rows');
    row.click();
    await settle();
    assert.strictEqual(dom.window.document.getElementById('critter-layer'), null,
      'the pane swap ran the scatter pipeline (mode off -> the stale layer is cleared)');
  } finally { unmountMd(dom); }
});

test('v1.172: the Back button (menu pane returns) re-runs the scatter pipeline too - both transition directions bound', async () => {
  const dom = mountMdWithLayer();
  try {
    const { wireMasterDetail } = require('../../public/js/common.js');
    wireMasterDetail('setup', dom.window.document, new dom.window.AbortController().signal);
    const row = dom.window.document.querySelector('.md-nav .md-row');
    row.click();
    await settle(); // the drill-in scatter consumed the seeded layer...
    const layer = dom.window.document.createElement('div');
    layer.id = 'critter-layer';
    dom.window.document.body.appendChild(layer); // ...re-seed for the Back leg
    const back = dom.window.document.querySelector('.md-back');
    assert.ok(back, 'the back control exists');
    back.click();
    await settle();
    assert.strictEqual(dom.window.document.getElementById('critter-layer'), null,
      'Back ran the scatter pipeline for the returning menu pane');
  } finally { unmountMd(dom); }
});

// ---- v1.175: instant arrival (Dean: "prevent FOUC/load-in") -----------------

test('v1.175 warmCritterAssets: pre-decodes every pool image once per manifest generation; builtins and failures are no-ops', async (t) => {
  const dom = new JSDOM('<!DOCTYPE html><body></body>', { url: 'http://localhost/' });
  global.window = dom.window; global.document = dom.window.document;
  const created = [];
  let decodes = 0;
  global.window.Image = class {
    constructor() { created.push(this); }
    set src(v) { this._src = v; }
    get src() { return this._src; }
    decode() { decodes += 1; return Promise.reject(new Error('decode fails - must be swallowed')); }
  };
  t.after(() => { delete global.window; delete global.document; dom.window.close(); });
  const { warmCritterAssets } = require('../../public/js/common.js');
  warmCritterAssets([
    { id: 'pearl', img: '/critters/pearl.png', sound: null },
    { id: 'builtin', img: null, svg: '<svg/>' },
    { id: 'milo', img: '/critters/milo.png', sound: '/critters/milo.mp3' },
  ]);
  await new Promise((resolve) => setTimeout(resolve, 0)); // let the rejected decode settle (must not throw/unhandled)
  assert.deepStrictEqual(created.map((i) => i.src), ['/critters/pearl.png', '/critters/milo.png'],
    'every image entry warms; the svg builtin does not');
  assert.strictEqual(decodes, 2, 'decode() requested per image');
  // The ONCE-per-generation guarantee is structural: warming rides the CACHED
  // manifest promise's construction. Source-lock the structure.
  assert.match(COMMON, /\.catch\(function \(\) \{ return CRITTER_BUILTINS; \}\)\n {4}\.then\(function \(manifest\) \{\n[\s\S]{0,400}warmCritterAssets\(manifest\);/,
    'warming is chained INSIDE fetchCritterManifest\'s cached promise - once per generation by construction');
});

test('v1.175 CONTENT NUDGE: critters arrive in the same beat as late content - no 1.5s wait; the ladder budget still caps everything', async (t) => {
  // The user-facing claim end-to-end: a view whose anchors render AFTER the
  // first scatter (fetch-then-render) gets its critters ~150ms after the
  // content lands, NOT at the +1.5s fallback. Real scatterCritters, real
  // observer, stubbed geometry (jsdom has no layout).
  const dom = new JSDOM('<!DOCTYPE html><body><div id="view-root"></div></body>', { url: 'http://localhost/' });
  global.window = dom.window; global.document = dom.window.document;
  global.MutationObserver = dom.window.MutationObserver;
  global.localStorage = dom.window.localStorage;
  localStorage.setItem('ft-critters:on', '1');
  global.window.Image = class { decode() { return Promise.resolve(); } };
  // No global fetch -> the manifest falls back to the BUILTINS (no network).
  const docEl = dom.window.document.documentElement;
  Object.defineProperty(docEl, 'scrollWidth', { value: 800, configurable: true });
  Object.defineProperty(docEl, 'scrollHeight', { value: 2000, configurable: true });
  const proto = dom.window.Element.prototype;
  const origRect = proto.getBoundingClientRect;
  proto.getBoundingClientRect = function () {
    if (this.classList && this.classList.contains('video-card')) {
      return { left: 100, top: 300, width: 300, height: 200, right: 400, bottom: 500 };
    }
    return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 };
  };
  t.after(() => {
    proto.getBoundingClientRect = origRect;
    localStorage.clear();
    // Disable + rescatter disconnects the observer so no handle outlives the test.
    const { scatterCritters } = require('../../public/js/common.js');
    localStorage.setItem('ft-critters:on', '0');
    scatterCritters();
    delete global.window; delete global.document; delete global.MutationObserver; delete global.localStorage;
    dom.window.close();
  });
  const { scatterCritters } = require('../../public/js/common.js');
  scatterCritters(); // first pass: NO anchors in the DOM yet -> empty
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.strictEqual(dom.window.document.querySelectorAll('.critter').length, 0, 'nothing to anchor to yet');
  // The content lands (fetch-then-render resolves) ...
  const card = dom.window.document.createElement('div');
  card.className = 'video-card';
  dom.window.document.getElementById('view-root').appendChild(card);
  // ... and the nudge places critters ~150ms later - far inside the old 1.5s.
  await new Promise((resolve) => setTimeout(resolve, 450));
  assert.ok(dom.window.document.querySelectorAll('.critter').length > 0,
    'critters arrived with the content (the nudge), not at the +1.5s fallback');
});

test('v1.175 nudge discipline (source locks): shares the ladder budget, cancels the stale timer, filters its own layer, unwires when off', () => {
  const nudge = COMMON.slice(COMMON.indexOf('function wireCritterContentNudge'), COMMON.indexOf('\n// v1.173 PURE fire-time decision'));
  assert.match(nudge, /if \(critterSettleChecks >= 2\) return;/,
    'the nudge SPENDS the settle ladder\'s own bounded budget - it accelerates, never adds re-rolls');
  assert.match(nudge, /if \(critterRetryTimer\) \{ clearTimeout\(critterRetryTimer\); critterRetryTimer = null; \}/,
    'a nudged scatter CANCELS the pending fallback timer first (the v1.166.4 unstashed-handle lesson)');
  assert.match(nudge, /if \(!foreign\) return;/,
    'the critter layer\'s own render churn never self-triggers');
  assert.match(nudge, /var action = critterSettleAction\(critterPlacements\.length, critterPlacedDocH, document\.documentElement\.scrollHeight\);/,
    'the nudge fires the SAME pure decision as the timers - stand-down still means never move');
  const scatter = COMMON.slice(COMMON.indexOf('function scatterCritters()'), COMMON.indexOf('\nfunction critterSettleAction'));
  const disabledBranch = scatter.slice(0, scatter.indexOf('wireCritterListeners()'));
  assert.match(disabledBranch, /unwireCritterContentNudge\(\);/,
    'mode off disconnects the observer (the v1.160 lesson: no global observer tax for non-opted users)');
  // Gate S2: anchored past the `un` prefix - the bare substring was vacuously
  // satisfied by unwireCritterContentNudge() in the disabled branch.
  assert.match(scatter, /\n {2}wireCritterContentNudge\(\);/, 'mode on wires it (the enabled path\'s own call)');
  const sched = COMMON.slice(COMMON.indexOf('function scheduleCritterScatter()'), COMMON.indexOf('\nfunction wireCritterListeners'));
  assert.match(sched, /if \(critterNudgeDebounce\) \{ clearTimeout\(critterNudgeDebounce\); critterNudgeDebounce = null; \}/,
    'gate S1: a navigation cancels the pending nudge debounce along with every other handle');
});

// ---- v1.176: re-glue, never re-roll (Dean's watch-page shift) ---------------

test('v1.176 RE-GLUE end-to-end: a drift correction keeps every critter on ITS OWN anchor - translated with it, never re-rolled', async (t) => {
  // Dean's report: on watch/audio pages the critters appeared, then <1s later
  // SHIFTED to brand-new spots - the v1.173 drift re-scatter re-ROLLING, made
  // visible by v1.175's instant arrival. The bind: drift with UNMOVED anchors
  // changes nothing; drift with a MOVED anchor slides its critter by exactly
  // the anchor's delta, same critter id, no fade replay.
  const dom = new JSDOM('<!DOCTYPE html><body><div id="view-root"><div class="video-card" id="card"></div></div></body>', { url: 'http://localhost/' });
  global.window = dom.window; global.document = dom.window.document;
  global.MutationObserver = dom.window.MutationObserver;
  global.localStorage = dom.window.localStorage;
  localStorage.setItem('ft-critters:on', '1');
  global.window.Image = class { decode() { return Promise.resolve(); } };
  const docEl = dom.window.document.documentElement;
  Object.defineProperty(docEl, 'scrollWidth', { value: 800, configurable: true });
  let docH = 2000;
  Object.defineProperty(docEl, 'scrollHeight', { get: () => docH, configurable: true });
  const cardRect = { left: 100, top: 300, width: 300, height: 200 };
  const proto = dom.window.Element.prototype;
  const origRect = proto.getBoundingClientRect;
  proto.getBoundingClientRect = function () {
    if (this.id === 'card') {
      return { left: cardRect.left, top: cardRect.top, width: cardRect.width, height: cardRect.height, right: cardRect.left + cardRect.width, bottom: cardRect.top + cardRect.height };
    }
    return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 };
  };
  t.after(() => {
    proto.getBoundingClientRect = origRect;
    const { scatterCritters } = require('../../public/js/common.js');
    localStorage.setItem('ft-critters:on', '0');
    scatterCritters(); // disable: cancels every pending handle
    delete global.window; delete global.document; delete global.MutationObserver; delete global.localStorage;
    dom.window.close();
  });
  const { scatterCritters, reglueCritterPlacements } = require('../../public/js/common.js');
  scatterCritters();
  await new Promise((resolve) => setTimeout(resolve, 260));
  const before = [...dom.window.document.querySelectorAll('.critter')].map((el) => ({
    id: el.getAttribute('data-critter-id'), left: el.style.left, top: el.style.top,
  }));
  assert.ok(before.length > 0, 'critters placed on the card');
  // DRIFT with an UNMOVED anchor (content grew far below): nothing may change.
  docH = 2400;
  reglueCritterPlacements();
  const afterStill = [...dom.window.document.querySelectorAll('.critter')].map((el) => ({
    id: el.getAttribute('data-critter-id'), left: el.style.left, top: el.style.top,
  }));
  assert.deepStrictEqual(afterStill, before, 'unmoved anchors: identical critters at identical positions (the Dean bug assertion)');
  assert.ok(dom.window.document.querySelector('.critter').classList.contains('critter-still'),
    'a re-glue rebuild is STILL - no arrival-fade replay');
  // DRIFT with the anchor MOVED down 60px: the critter rides it exactly.
  cardRect.top = 360;
  reglueCritterPlacements();
  const afterMove = [...dom.window.document.querySelectorAll('.critter')];
  assert.strictEqual(afterMove.length, before.length, 'same critters survive');
  assert.strictEqual(afterMove[0].getAttribute('data-critter-id'), before[0].id, 'same critter, not a re-roll');
  const topBefore = parseInt(before[0].top, 10);
  const topAfter = parseInt(afterMove[0].style.top, 10);
  assert.strictEqual(topAfter - topBefore, 60, 'translated by exactly the anchor\'s delta');
  // The anchor LEAVES the page: its critter is dropped, never re-homed.
  dom.window.document.getElementById('card').remove();
  reglueCritterPlacements();
  assert.strictEqual(dom.window.document.querySelectorAll('.critter').length, 0,
    'no furniture, no critter - dropped, never re-rolled elsewhere');
});

test('v1.176 gate W closure: the re-glue DROP predicates bind - exclusion (never over playback), bounds, hidden', async (t) => {
  // The seat proved the drops correct but mutable-green: removing the
  // exclusion/bounds/hidden drops shipped green because only the
  // disconnected-anchor drop was bound. This is the seat's own repro shape.
  const dom = new JSDOM('<!DOCTYPE html><body><div id="view-root"><div class="video-card" id="card"></div></div><div id="player-dock"></div></body>', { url: 'http://localhost/' });
  global.window = dom.window; global.document = dom.window.document;
  global.MutationObserver = dom.window.MutationObserver;
  global.localStorage = dom.window.localStorage;
  localStorage.setItem('ft-critters:on', '1');
  global.window.Image = class { decode() { return Promise.resolve(); } };
  const docEl = dom.window.document.documentElement;
  Object.defineProperty(docEl, 'scrollWidth', { value: 800, configurable: true });
  Object.defineProperty(docEl, 'scrollHeight', { value: 2000, configurable: true });
  const cardRect = { left: 100, top: 300, width: 300, height: 200 };
  let cardHidden = false;
  const proto = dom.window.Element.prototype;
  const origRect = proto.getBoundingClientRect;
  proto.getBoundingClientRect = function () {
    if (this.id === 'card') {
      // v1.180 gate W: the collapse is WIDTH:0 AT POSITION (a real CSS
      // width-collapse keeps left/top), not the origin zero-rect - the
      // origin case is vw-subsumed (translated x < 0), the at-position
      // case is NOT, and only the D5 hidden-drop catches it.
      if (cardHidden) return { left: cardRect.left, top: cardRect.top, width: 0, height: 0, right: cardRect.left, bottom: cardRect.top };
      return { left: cardRect.left, top: cardRect.top, width: cardRect.width, height: cardRect.height, right: cardRect.left + cardRect.width, bottom: cardRect.top + cardRect.height };
    }
    if (this.id === 'player-dock') {
      return { left: 0, top: 1600, width: 800, height: 200, right: 800, bottom: 1800 };
    }
    return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 };
  };
  t.after(() => {
    proto.getBoundingClientRect = origRect;
    const { scatterCritters } = require('../../public/js/common.js');
    localStorage.setItem('ft-critters:on', '0');
    scatterCritters();
    delete global.window; delete global.document; delete global.MutationObserver; delete global.localStorage;
    dom.window.close();
  });
  const { scatterCritters, reglueCritterPlacements } = require('../../public/js/common.js');
  const place = async () => {
    cardHidden = false; cardRect.top = 300;
    scatterCritters();
    await new Promise((resolve) => setTimeout(resolve, 260));
    assert.ok(dom.window.document.querySelectorAll('.critter').length > 0, 'placed on the card');
  };
  // EXCLUSION: the card slides ONTO the player dock - its critter is dropped,
  // never left over the playback surface (Dean's founding constraint, on the
  // NEW mid-view path).
  await place();
  cardRect.top = 1620;
  reglueCritterPlacements();
  assert.strictEqual(dom.window.document.querySelectorAll('.critter').length, 0, 'slid into #player-dock: dropped');
  // BOUNDS: the card slides past the page end - never grow the document (W4).
  await place();
  cardRect.top = 2100;
  reglueCritterPlacements();
  assert.strictEqual(dom.window.document.querySelectorAll('.critter').length, 0, 'past scrollHeight: dropped');
  // HIDDEN: the anchor collapses to a zero rect - dropped.
  await place();
  cardHidden = true;
  reglueCritterPlacements();
  assert.strictEqual(dom.window.document.querySelectorAll('.critter').length, 0, 'hidden anchor: dropped');
  // HIDDEN, the NON-SUBSUMING placement (the seat's counterexample, delta
  // round: my "the overlap predicate subsumes the hidden drop" claim was
  // REFUTED by measurement - without the hidden drop, a collapse-translate
  // can slide the critter box OVER the zero-point so `overlaps` stays true
  // and the stray critter survives at a garbage near-origin position). The
  // survivor geometry needs BOTH coordinates before the anchor's corner (a
  // tl-corner-family peek: after the translate by (-left, -top) the origin
  // sits strictly inside the box). Loop the unseedable scatter until it
  // draws one, THEN collapse - this bind reds only on the hidden drop.
  // v1.180 adjustment: at x=10 a tl-corner peek lands at x<0 and the NEW
  // screen-edge invariant correctly refuses it - the loop starved. x=60
  // keeps every draw on-screen while preserving the exact D5 survivor
  // condition (origin-inside-translated-box needs both coords before the
  // corner, regardless of where the corner is).
  cardRect.left = 60; cardRect.top = 130; cardRect.width = 120; cardRect.height = 44;
  let gotTlCornerPeek = false;
  for (let attempt = 0; attempt < 120 && !gotTlCornerPeek; attempt += 1) {
    cardHidden = false;
    scatterCritters();
    await new Promise((resolve) => setTimeout(resolve, 230));
    const wrap = dom.window.document.querySelector('.critter');
    if (!wrap) continue;
    const W = parseInt(wrap.style.width, 10);
    const pad = Math.round(W * 0.1875); // pad = 0.3w, W = 1.6w
    const px = parseInt(wrap.style.left, 10) + pad;
    const py = parseInt(wrap.style.top, 10) + pad;
    if (px < cardRect.left && py < cardRect.top) gotTlCornerPeek = true;
  }
  assert.ok(gotTlCornerPeek, 'the sweep drew a tl-corner peek (both coordinates before the anchor corner)');
  cardHidden = true;
  reglueCritterPlacements();
  // v1.180 gate W CORRECTION (my second subsumption claim, also measured
  // wrong by the seat): the screen-edge drop subsumes D5 ONLY for the
  // ORIGIN collapse (display:none-style zero rect at 0,0 - translated x
  // goes negative). A WIDTH:0-AT-POSITION collapse keeps its coordinates,
  // the translated critter stays on-screen (seat: 15/29 positions
  // survive), and ONLY the D5 hidden drop catches it. The stub above uses
  // the at-position geometry so this assertion reds on the D5 line-mutant.
  assert.strictEqual(dom.window.document.querySelectorAll('.critter').length, 0,
    'a width:0-at-position collapse sheds its critter - the D5 hidden drop is LOAD-BEARING here, nothing subsumes it');
});

// ---- v1.177: the rounded shave (Dean's Modern-2021 screenshots) -------------

function decodeShave(mask) {
  const m = mask.match(/^url\("data:image\/svg\+xml,(.*)"\)$/);
  assert.ok(m, 'the mask is an inline SVG data URI: ' + mask.slice(0, 40));
  return decodeURIComponent(m[1]);
}

test('v1.177 buildCritterShaveMask (pure): the hole follows the anchor\'s PAINTED corners - rounded only at TRUE anchor corners', () => {
  const { buildCritterShaveMask } = require('../../public/js/common.js');
  const P = (anchor, radii) => ({ x: 100, y: 100, w: 50, h: 50, anchor, radii });
  const pad = 15; // wrapper 80; doc d -> local 15 + (d - 100)
  const R10 = { tl: 10, tr: 10, br: 10, bl: 10 };
  // 3-side inset (anchor below, extends past L/R/B): the only interior side
  // is the anchor's TOP EDGE - no true corner inside the wrapper, so the
  // hole stays square even though the anchor is rounded (its real corners
  // lie outside the wrapper).
  assert.strictEqual(decodeShave(buildCritterShaveMask(P({ x: 0, y: 125, w: 400, h: 200 }, R10), pad)),
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 80 80'><path fill-rule='evenodd' d='M0 0H80V80H0ZM0 40H80V80H0V40Z' fill='#fff'/></svg>");
  // Corner L (anchor to the bottom-right): exactly ONE true anchor corner
  // (its tl) inside the wrapper - one arc, the rest straight.
  assert.strictEqual(decodeShave(buildCritterShaveMask(P({ x: 120, y: 130, w: 200, h: 200 }, R10), pad)),
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 80 80'><path fill-rule='evenodd' d='M0 0H80V80H0ZM45 45H80V80H35V55A10 10 0 0 1 45 45Z' fill='#fff'/></svg>");
  // C-notch (small anchor to the right, cross-smaller): its tl AND bl
  // corners are inside the wrapper - two arcs on the interior side's ends.
  assert.strictEqual(decodeShave(buildCritterShaveMask(P({ x: 130, y: 110, w: 60, h: 20 }, { tl: 8, tr: 8, br: 8, bl: 8 }), pad)),
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 80 80'><path fill-rule='evenodd' d='M0 0H80V80H0ZM53 25H80V45H53A8 8 0 0 1 45 37V33A8 8 0 0 1 53 25Z' fill='#fff'/></svg>");
  // Gate W closure (the orientation class, FOURTH strike): the tr and br arc
  // emits were mutation-unbound - fixtures covered only tl and tl+bl. Both
  // strings below were derived independently twice (the seat's and mine
  // matched byte-for-byte before this was written down).
  assert.strictEqual(decodeShave(buildCritterShaveMask(P({ x: 0, y: 130, w: 130, h: 200 }, R10), pad)),
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 80 80'><path fill-rule='evenodd' d='M0 0H80V80H0ZM0 45H35A10 10 0 0 1 45 55V80H0V45Z' fill='#fff'/></svg>",
    'tr arc: anchor to the bottom-left');
  assert.strictEqual(decodeShave(buildCritterShaveMask(P({ x: 0, y: 0, w: 130, h: 130 }, R10), pad)),
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 80 80'><path fill-rule='evenodd' d='M0 0H80V80H0ZM0 0H45V35A10 10 0 0 1 35 45H0V0Z' fill='#fff'/></svg>",
    'br arc: anchor to the top-left');
  const clamped = decodeShave(buildCritterShaveMask(P({ x: 120, y: 130, w: 200, h: 200 }, { tl: 40, tr: 40, br: 40, bl: 40 }), pad));
  assert.match(clamped, /A17 17 0 0 1/, 'radius clamped to 17');
  // Degenerates: no anchor / no overlap emit NOTHING (never a floating cut).
  assert.strictEqual(buildCritterShaveMask({ x: 100, y: 100, w: 50, h: 50, radii: R10 }, pad), '');
  assert.strictEqual(buildCritterShaveMask(P({ x: 500, y: 500, w: 50, h: 50 }, R10), pad), '');
});

test('v1.177 renderer ladder: circle -> radial mask; rounded anchor -> SVG shave mask; square/tiny-radius -> the rect clip', () => {
  const dom = new JSDOM('<!DOCTYPE html><body><div id="critter-layer"></div></body>', { url: 'http://localhost/' });
  global.window = dom.window; global.document = dom.window.document;
  try {
    const layer = dom.window.document.getElementById('critter-layer');
    const base = { x: 100, y: 100, w: 50, h: 50, angle: 0, flip: 1, hue: 0, cover: {}, anchor: { x: 120, y: 130, w: 200, h: 200 } };
    renderCritterPlacements(layer, [
      { ...base, id: 'circle', roundCover: { cx: 25, cy: 25, r: 12 } },
      { ...base, id: 'rounded', roundCover: null, radii: { tl: 10, tr: 10, br: 10, bl: 10 } },
      { ...base, id: 'tiny', roundCover: null, radii: { tl: 2, tr: 2, br: 2, bl: 2 } },
      { ...base, id: 'square', roundCover: null, radii: null },
    ]);
    const kids = layer.querySelectorAll('.critter');
    assert.match(kids[0].style.getPropertyValue('--critter-mask'), /^radial-gradient/, 'true circle keeps the radial mask');
    assert.match(kids[1].style.getPropertyValue('--critter-mask'), /^url\("data:image\/svg\+xml,/, 'rounded anchor gets the SVG shave');
    assert.ok(kids[1].classList.contains('critter-round'), 'the shave rides the SAME mask plumbing');
    assert.strictEqual(kids[1].style.clipPath, '', 'never both mask AND clip');
    assert.ok(kids[2].style.clipPath.length > 0, '<=2px radii stay on the cheaper clip');
    assert.strictEqual(kids[2].style.getPropertyValue('--critter-mask'), '');
    assert.ok(kids[3].style.clipPath.length > 0, 'no radii: the rect clip');
  } finally { delete global.window; delete global.document; dom.window.close(); }
});

test('v1.177 collector: per-corner radii harvested from computed style (px, %, missing), clamped to half; planner passes them through', () => {
  const dom = new JSDOM('<!DOCTYPE html><body><button class="btn" data-m="1">B</button></body>', { url: 'http://localhost/' });
  global.window = dom.window; global.document = dom.window.document;
  const proto = dom.window.Element.prototype;
  const origRect = proto.getBoundingClientRect;
  proto.getBoundingClientRect = function () {
    if (this.getAttribute && this.getAttribute('data-m')) return { left: 10, top: 10, width: 120, height: 40, right: 130, bottom: 50 };
    return origRect.call(this);
  };
  const origGCS = dom.window.getComputedStyle;
  dom.window.getComputedStyle = () => ({
    position: 'static',
    borderTopLeftRadius: '10px',
    borderTopRightRadius: '50%', // resolves against min dim (40) -> 20, clamps to half (20)
    borderBottomRightRadius: '999px', // clamps to half (20)
    // bottom-left missing -> 0
  });
  try {
    const { collectCritterRects, planCritterScatter } = require('../../public/js/common.js');
    const rects = collectCritterRects(['.btn'], true);
    assert.strictEqual(rects.length, 1);
    assert.deepStrictEqual(rects[0].radii, { tl: 10, tr: 20, br: 20, bl: 0 }, 'per-corner parse: px, %, clamp, missing');
    const out = planCritterScatter({ anchors: rects, exclusions: [], manifest: [{ id: 'c', img: '/critters/c.png', sound: null }], count: 1, rng: () => 0.4 });
    assert.strictEqual(out.length, 1);
    assert.deepStrictEqual(out[0].radii, rects[0].radii, 'the planner passes the painted radii through to the renderer');
  } finally {
    proto.getBoundingClientRect = origRect;
    dom.window.getComputedStyle = origGCS;
    delete global.window; delete global.document;
    dom.window.close();
  }
});

test('v1.177 refactor lock: the clip and the shave consume ONE shared hidden-rect truth', () => {
  const clip = COMMON.slice(COMMON.indexOf('function buildCritterClip'), COMMON.indexOf('\n// v1.177 (Dean'));
  assert.match(clip, /var h = critterHiddenRect\(p, pad\);/, 'buildCritterClip derives from the shared geometry');
  const shave = COMMON.slice(COMMON.indexOf('function buildCritterShaveMask'), COMMON.indexOf('\nfunction renderCritterPlacements'));
  assert.match(shave, /var h = critterHiddenRect\(p, pad\);/, 'buildCritterShaveMask derives from the SAME geometry');
});

// ---- v1.178: anchor ADOPTION (Dean's "flash and find a second position") ----

test('v1.178 ADOPTION end-to-end: a view rebuild that REPLACES the anchor keeps the critter in place on the twin', async (t) => {
  // Dean's residual flash: views rebuild content wholesale (the related rail,
  // the feed grid) - the anchor ELEMENT is replaced by an identical twin, the
  // v1.176 re-glue dropped the orphan, and the empty settle check
  // re-scattered to fresh spots. Adoption re-attaches the critter to the twin
  // by selector + geometry: same id, same position, NO flash.
  const dom = new JSDOM('<!DOCTYPE html><body><div id="view-root"><div class="video-card" id="card" data-rx="100" data-ry="300"></div></div></body>', { url: 'http://localhost/' });
  global.window = dom.window; global.document = dom.window.document;
  global.MutationObserver = dom.window.MutationObserver;
  global.localStorage = dom.window.localStorage;
  localStorage.setItem('ft-critters:on', '1');
  global.window.Image = class { decode() { return Promise.resolve(); } };
  const docEl = dom.window.document.documentElement;
  Object.defineProperty(docEl, 'scrollWidth', { value: 800, configurable: true });
  Object.defineProperty(docEl, 'scrollHeight', { value: 2000, configurable: true });
  const proto = dom.window.Element.prototype;
  const origRect = proto.getBoundingClientRect;
  proto.getBoundingClientRect = function () {
    const rx = this.getAttribute && this.getAttribute('data-rx');
    if (rx !== null && rx !== undefined && rx !== '') {
      const x = Number(rx); const y = Number(this.getAttribute('data-ry'));
      const w = Number(this.getAttribute('data-rw') || 300); const h = Number(this.getAttribute('data-rh') || 200);
      return { left: x, top: y, width: w, height: h, right: x + w, bottom: y + h };
    }
    return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 };
  };
  t.after(() => {
    proto.getBoundingClientRect = origRect;
    const { scatterCritters } = require('../../public/js/common.js');
    localStorage.setItem('ft-critters:on', '0');
    scatterCritters();
    delete global.window; delete global.document; delete global.MutationObserver; delete global.localStorage;
    dom.window.close();
  });
  const { scatterCritters, reglueCritterPlacements } = require('../../public/js/common.js');
  scatterCritters();
  await new Promise((resolve) => setTimeout(resolve, 260));
  const before = [...dom.window.document.querySelectorAll('.critter')].map((el) => ({
    id: el.getAttribute('data-critter-id'), left: el.style.left, top: el.style.top,
  }));
  assert.ok(before.length > 0, 'placed on the card');
  // THE VIEW REBUILD: the card is REPLACED by an identical twin at the same
  // spot (relatedContainer.innerHTML = ... semantics).
  const view = dom.window.document.getElementById('view-root');
  view.innerHTML = '<div class="video-card" id="card-rebuilt" data-rx="100" data-ry="300"></div>';
  reglueCritterPlacements();
  const after = [...dom.window.document.querySelectorAll('.critter')].map((el) => ({
    id: el.getAttribute('data-critter-id'), left: el.style.left, top: el.style.top,
  }));
  assert.deepStrictEqual(after, before, 'ADOPTED: same critter, same position, no flash (the Dean assertion)');
  // The twin RENDERED 40px lower (the settle shifted it): adopted AND ridden.
  view.innerHTML = '<div class="video-card" id="card-again" data-rx="100" data-ry="340"></div>';
  reglueCritterPlacements();
  const ridden = [...dom.window.document.querySelectorAll('.critter')];
  assert.strictEqual(ridden.length, before.length, 'still the same critters');
  assert.strictEqual(parseInt(ridden[0].style.top, 10) - parseInt(before[0].top, 10), 40, 'translated by the twin\'s delta');
  // TOO FAR: the "twin" appears half a screen away - different furniture, drop.
  view.innerHTML = '<div class="video-card" id="card-far" data-rx="100" data-ry="900"></div>';
  reglueCritterPlacements();
  assert.strictEqual(dom.window.document.querySelectorAll('.critter').length, 0, 'a 560px jump is not adoption material');
});

test('v1.178 adoption discipline: size-mismatched cousins refused; the true twin adopts exactly once', async (t) => {
  const dom = new JSDOM('<!DOCTYPE html><body><div id="view-root">'
    + '<div class="video-card" id="a" data-rx="100" data-ry="300"></div>'
    + '<div class="video-card" id="b" data-rx="100" data-ry="700"></div>'
    + '</div></body>', { url: 'http://localhost/' });
  global.window = dom.window; global.document = dom.window.document;
  global.MutationObserver = dom.window.MutationObserver;
  global.localStorage = dom.window.localStorage;
  localStorage.setItem('ft-critters:on', '1');
  global.window.Image = class { decode() { return Promise.resolve(); } };
  const docEl = dom.window.document.documentElement;
  Object.defineProperty(docEl, 'scrollWidth', { value: 800, configurable: true });
  Object.defineProperty(docEl, 'scrollHeight', { value: 2000, configurable: true });
  const proto = dom.window.Element.prototype;
  const origRect = proto.getBoundingClientRect;
  proto.getBoundingClientRect = function () {
    const rx = this.getAttribute && this.getAttribute('data-rx');
    if (rx !== null && rx !== undefined && rx !== '') {
      const x = Number(rx); const y = Number(this.getAttribute('data-ry'));
      const w = Number(this.getAttribute('data-rw') || 300); const h = Number(this.getAttribute('data-rh') || 200);
      return { left: x, top: y, width: w, height: h, right: x + w, bottom: y + h };
    }
    return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 };
  };
  t.after(() => {
    proto.getBoundingClientRect = origRect;
    const { scatterCritters } = require('../../public/js/common.js');
    localStorage.setItem('ft-critters:on', '0');
    scatterCritters();
    delete global.window; delete global.document; delete global.MutationObserver; delete global.localStorage;
    dom.window.close();
  });
  const { scatterCritters, reglueCritterPlacements } = require('../../public/js/common.js');
  scatterCritters();
  await new Promise((resolve) => setTimeout(resolve, 260));
  const placed = dom.window.document.querySelectorAll('.critter').length;
  assert.strictEqual(placed, 2, 'one critter per card');
  const view = dom.window.document.getElementById('view-root');
  // Rebuild replaces BOTH cards with: one size-mismatched cousin CENTERED
  // exactly where card A was (3x wider, distance ZERO - the size gate is the
  // ONLY thing refusing it; a first spelling put the cousin off-center and
  // the distance gate subsumed the size gate, leaving its mutant green - the
  // survivor-geometry lesson, again) and ONE true twin near card B.
  view.innerHTML = '<div class="video-card" id="fat" data-rx="-200" data-ry="300" data-rw="900"></div>'
    + '<div class="video-card" id="twin-b" data-rx="100" data-ry="700"></div>';
  reglueCritterPlacements();
  assert.strictEqual(dom.window.document.querySelectorAll('.critter').length, 1,
    'the cousin is refused (0.5x-2x size gate); the true twin is adopted once');
  // Gate W closure #1 (the seat's repro; the old title CLAIMED this without
  // exercising it - the vacuous-claim class): TWO orphans, ONE twin whose
  // center is within 240px of BOTH old anchors. Exactly one may adopt -
  // without the claimed-list guard both stack on the same element.
  localStorage.setItem('ft-critters:on', '1');
  view.innerHTML = '<div class="video-card" id="a2" data-rx="100" data-ry="300"></div>'
    + '<div class="video-card" id="b2" data-rx="100" data-ry="700"></div>';
  scatterCritters();
  await new Promise((resolve) => setTimeout(resolve, 260));
  assert.strictEqual(dom.window.document.querySelectorAll('.critter').length, 2, 're-seeded on both cards');
  view.innerHTML = '<div class="video-card" id="one-twin" data-rx="100" data-ry="500"></div>'; // center 600: 200px from both old centers
  reglueCritterPlacements();
  assert.strictEqual(dom.window.document.querySelectorAll('.critter').length, 1,
    'ONE adoption, never a stacked pair (delete the claimed guard and this reds with 2)');
  // Gate W closure #2 (claimed-SEED): a still-connected survivor's anchor may
  // not be poached by an orphan. Card A stays; card B (within 240px of A) is
  // removed - B's orphan must DROP, not stack onto A.
  view.innerHTML = '<div class="video-card" id="a3" data-rx="100" data-ry="300"></div>'
    + '<div class="video-card" id="b3" data-rx="100" data-ry="460"></div>';
  scatterCritters();
  await new Promise((resolve) => setTimeout(resolve, 260));
  assert.strictEqual(dom.window.document.querySelectorAll('.critter').length, 2, 're-seeded again');
  const survivorPos = [...dom.window.document.querySelectorAll('.critter')].map((el) => el.style.left + '/' + el.style.top);
  dom.window.document.getElementById('b3').remove();
  reglueCritterPlacements();
  const remaining = [...dom.window.document.querySelectorAll('.critter')];
  assert.strictEqual(remaining.length, 1,
    'the orphan DROPS rather than poaching the survivor\'s anchor (delete the claimed-seed and this reds with 2)');
  assert.ok(survivorPos.includes(remaining[0].style.left + '/' + remaining[0].style.top),
    'the survivor kept its exact position');
});

// ---- v1.179.1: the voice probe instrument -----------------------------------

test('v1.179.1 probeCritterVoices: reports the REAL manifest counts and the playback attempt\'s exact failure', async (t) => {
  const dom = new JSDOM('<!DOCTYPE html><body></body>', { url: 'http://localhost/' });
  global.window = dom.window; global.document = dom.window.document;
  // Gate S2: a MIXED fixture - one voiceless entry - so the stale-client
  // detector's filter is distinguished from counting everything.
  global.fetch = () => Promise.resolve({ ok: true, json: async () => ({ critters: [
    { id: 'a', img: '/critters/a.png', sound: null, voice: '/critters/cute1.mp3' },
    { id: 'b', img: '/critters/b.png', sound: null, voice: '/critters/cute2.mp3' },
    { id: 'mute', img: '/critters/mute.png', sound: null, voice: null },
  ] }) });
  const err = new Error('The operation is not supported.');
  err.name = 'NotSupportedError';
  global.window.Image = class { decode() { return Promise.resolve(); } };
  global.Audio = global.window.Audio = class {
    addEventListener() { /* no load error in this scenario */ }
    play() { return Promise.reject(err); }
    pause() { /* probe only */ }
  };
  t.after(() => {
    delete global.window; delete global.document; delete global.fetch; delete global.Audio;
    dom.window.close();
  });
  const { probeCritterVoices, applyCritterMode } = require('../../public/js/common.js');
  applyCritterMode(); // bust any cached manifest from earlier tests
  const r = await probeCritterVoices();
  assert.strictEqual(r.total, 3);
  assert.strictEqual(r.withVoice, 2, 'the FILTER counts voiced entries only (gate S2: an all-voiced fixture let a neutered filter survive)');
  assert.strictEqual(r.sample, '/critters/cute1.mp3');
  assert.strictEqual(r.coldManifest, true, 'the cold-manifest tell rides the report (gate S1)');
  assert.match(r.play, /^PLAY REJECTED: NotSupportedError/, 'the error NAME reaches the report - codec vs policy vs load distinguishable');
});

test('v1.179.1 the chirp fallback RECORDS why (source locks: all three arms write the reason)', () => {
  const tap = COMMON.slice(COMMON.indexOf('var hit = critterTapHit'), COMMON.indexOf('\n  // Reflow moves the furniture'));
  assert.match(tap, /critterLastChirpReason = 'play rejected: ' \+ \(\(err && err\.name\) \|\| 'unknown'\) \+ ' for ' \+ hit\.sound;/, 'rejected play records the name + URL');
  assert.match(tap, /critterLastChirpReason = 'Audio constructor threw: '/, 'sync throw recorded');
  assert.match(tap, /critterLastChirpReason = 'placement carried no voice/, 'the no-voice arm recorded');
});

// ---- v1.180: the SCREEN-EDGE invariant (Dean's pink-dress amputation) -------

test('v1.180 SCREEN-EDGE: no placement ever crosses the viewport left/right edge - and inflated scrollWidth cannot defeat full-bleed', () => {
  // Dean's screenshot: a side peek off a card whose edge sits at the screen
  // boundary, guillotined. Two holes closed: (1) horizontal overflow
  // inflates scrollWidth, so a visually-full-bleed card computed <85% and
  // kept side peeks; (2) non-full-bleed anchors near either screen edge
  // could poke past it (incl. the old negative-x trade). Both directions of
  // variety still bound (the v1.169 lesson).
  const bounds = { w: 1200, h: 5000 }; // scrollWidth INFLATED by an overflow
  const viewportW = 400;
  // The screenshot case: 95% of the VIEWPORT but only 31% of scrollWidth.
  const card = { x: 8, y: 600, w: 380, h: 200 };
  let tops = 0; let bottoms = 0;
  for (let seed = 1; seed <= 300; seed += 1) {
    const out = planCritterScatter({ anchors: [card], exclusions: [], manifest: MANIFEST_8, count: 1, rng: seededRng(seed), bounds, viewportW });
    for (const p of out) {
      assert.ok(p.x >= 0 && p.x + p.w <= viewportW, `seed ${seed}: crossed the screen edge (x=${p.x}, w=${p.w})`);
      if (p.y < card.y) tops += 1; else bottoms += 1;
    }
  }
  assert.ok(tops > 40 && bottoms > 40, `full-bleed vs the VIEWPORT redirects to both vertical edges (t=${tops}, b=${bottoms})`);
  // Non-full-bleed anchors flush against either screen edge: side peeks that
  // would cross are SKIPPED, never emitted; legal placements still occur.
  let placed = 0;
  for (const a of [{ x: 0, y: 600, w: 200, h: 300 }, { x: 200, y: 600, w: 200, h: 300 }]) {
    for (let seed = 1; seed <= 300; seed += 1) {
      const out = planCritterScatter({ anchors: [a], exclusions: [], manifest: MANIFEST_8, count: 1, rng: seededRng(seed), bounds, viewportW });
      for (const p of out) {
        placed += 1;
        assert.ok(p.x >= 0, `seed ${seed}: crossed the LEFT screen edge (x=${p.x})`);
        assert.ok(p.x + p.w <= viewportW, `seed ${seed}: crossed the RIGHT screen edge`);
      }
    }
  }
  assert.ok(placed > 200, 'edge-flush anchors still host critters on their legal sides (' + placed + ')');
  // viewportW absent (pure tests / legacy callers): the old behavior stands.
  const legacy = planCritterScatter({ anchors: [{ x: 0, y: 0, w: 400, h: 200 }], exclusions: [], manifest: MANIFEST_8, count: 1, rng: seededRng(2) });
  assert.ok(legacy.length >= 0, 'no viewportW: no crossing enforcement (backward-compatible)');
});

test('v1.180 SCREEN-EDGE on the re-glue path: a drift slide that would carry a critter off-screen DROPS it', async (t) => {
  // scrollWidth (2000) exceeds innerWidth (jsdom 1024) so the document-bounds
  // check alone cannot catch the slide - only the viewport drop can. The
  // anchor jumps right by 1400px: every translated critter lands past the
  // screen edge and must be dropped, never left amputated.
  const dom = new JSDOM('<!DOCTYPE html><body><div id="view-root"><div class="video-card" id="card" data-rx="100" data-ry="300"></div></div></body>', { url: 'http://localhost/' });
  global.window = dom.window; global.document = dom.window.document;
  global.MutationObserver = dom.window.MutationObserver;
  global.localStorage = dom.window.localStorage;
  localStorage.setItem('ft-critters:on', '1');
  global.window.Image = class { decode() { return Promise.resolve(); } };
  const docEl = dom.window.document.documentElement;
  Object.defineProperty(docEl, 'scrollWidth', { value: 2000, configurable: true });
  Object.defineProperty(docEl, 'scrollHeight', { value: 2000, configurable: true });
  const cardRect = { left: 100, top: 300 };
  const proto = dom.window.Element.prototype;
  const origRect = proto.getBoundingClientRect;
  proto.getBoundingClientRect = function () {
    if (this.id === 'card') return { left: cardRect.left, top: cardRect.top, width: 300, height: 200, right: cardRect.left + 300, bottom: cardRect.top + 200 };
    return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 };
  };
  t.after(() => {
    proto.getBoundingClientRect = origRect;
    const { scatterCritters } = require('../../public/js/common.js');
    localStorage.setItem('ft-critters:on', '0');
    scatterCritters();
    delete global.window; delete global.document; delete global.MutationObserver; delete global.localStorage;
    dom.window.close();
  });
  const { scatterCritters, reglueCritterPlacements } = require('../../public/js/common.js');
  scatterCritters();
  await new Promise((resolve) => setTimeout(resolve, 260));
  assert.ok(dom.window.document.querySelectorAll('.critter').length > 0, 'placed');
  cardRect.left = 1500; // translated critters land ~1440-1830: inside scrollWidth, PAST the screen
  reglueCritterPlacements();
  assert.strictEqual(dom.window.document.querySelectorAll('.critter').length, 0,
    'off-screen slides drop (delete the reglue vw check and this reds by leaving amputated critters)');
});

// ---- CSS locks --------------------------------------------------------------

test('v1.175: every critter ARRIVES on a pure-opacity fade (no pop-in; no motion, so no reduced-motion arm needed)', () => {
  assert.match(CSS, /\.critter\s*\{[^}]*animation:\s*critter-arrive/, '.critter carries the arrival animation');
  const kf = /@keyframes critter-arrive\s*\{([\s\S]*?)\n\}/.exec(CSS);
  assert.ok(kf, 'the keyframes exist');
  assert.match(kf[1], /opacity/, 'it fades');
  assert.doesNotMatch(kf[1], /transform|margin|left:|top:|width|height/, 'OPACITY ONLY - zero motion, zero layout shift');
});

test('tap reactions: a pool of tiny transform-only animations, each defined in CSS and all reduced-motion-safe', () => {
  const { CRITTER_REACTIONS } = require('../../public/js/common.js');
  assert.deepStrictEqual(CRITTER_REACTIONS, ['critter-wiggle', 'critter-shiver', 'critter-hop', 'critter-twirl', 'critter-duck', 'critter-squish'],
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
  // v1.171: the controls moved to their OWN section (Dean's ruling); v1.174:
  // the name is just "Critters" (Dean killed the v1.173 companions split -
  // the name now matches every id, key, and route).
  assert.match(SETUP_HTML, /<summary>Critters<\/summary>/);
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

// ---- v1.182: settle-before-reveal (Dean: "right place from the jump, no flash") ----
// Root cause the wave fixes: the engine placed at a fixed +200ms against loading
// skeletons / a partial feed and corrected in view (the visible flash). The
// first placement now WAITS for the view's content to settle, so it is the ONLY
// placement, at the final layout. These drive scheduleCritterScatter end-to-end.

// Shared rig: a JSDOM whose `.video-card`s report a real rect (jsdom has no
// layout), mode ON, builtins manifest (no network). Cleanup disables the mode,
// which tears down the layer, the nudge observer, AND every pending wait/settle
// handle (scatterCritters -> disconnectCritterWait at entry).
function mountCritterFeed(bodyHtml) {
  const dom = new JSDOM('<!DOCTYPE html><body>' + (bodyHtml || '<div id="view-root"></div>') + '</body>', { url: 'http://localhost/' });
  global.window = dom.window; global.document = dom.window.document;
  global.MutationObserver = dom.window.MutationObserver;
  global.localStorage = dom.window.localStorage;
  localStorage.setItem('ft-critters:on', '1');
  global.window.Image = class { decode() { return Promise.resolve(); } };
  const docEl = dom.window.document.documentElement;
  Object.defineProperty(docEl, 'scrollWidth', { value: 800, configurable: true });
  Object.defineProperty(docEl, 'scrollHeight', { value: 2000, configurable: true });
  const proto = dom.window.Element.prototype;
  const origRect = proto.getBoundingClientRect;
  proto.getBoundingClientRect = function () {
    if (this.classList && this.classList.contains('video-card')) {
      return { left: 100, top: 300, width: 300, height: 200, right: 400, bottom: 500 };
    }
    return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 };
  };
  return { dom, proto, origRect };
}
function unmountCritterFeed(ctx) {
  ctx.proto.getBoundingClientRect = ctx.origRect;
  const { scatterCritters } = require('../../public/js/common.js');
  global.localStorage.setItem('ft-critters:on', '0');
  scatterCritters(); // disable: layer removed, nudge observer + every pending handle cleared
  delete global.window; delete global.document; delete global.MutationObserver; delete global.localStorage;
  ctx.dom.window.close();
}
const napMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const critterCount = (ctx) => ctx.dom.window.document.querySelectorAll('.critter').length;

test('v1.182 A (the headline): while a feed skeleton is present the scatter reveals NOTHING; it places ONCE after the real cards land', async (t) => {
  // buildSkeletonGrid renders `.video-card.skeleton-card` - a valid anchor AND a
  // loading marker. The leading quiet timer must self-defer while it is there
  // (a reveal now would re-drift when the shorter-titled real cards land), then
  // reveal the moment the real cards replace it.
  const ctx = mountCritterFeed('<div id="view-root"><div class="video-card skeleton-card"></div></div>');
  t.after(() => unmountCritterFeed(ctx));
  const { scheduleCritterScatter } = require('../../public/js/common.js');
  scheduleCritterScatter();
  await napMs(450); // past the leading quiet (300ms) AND the old 200ms debounce
  assert.strictEqual(critterCount(ctx), 0, 'skeletons present: the reveal self-defers (no flash against loading content)');
  // The feed resolves: the skeleton is replaced by a real card (a childList mutation).
  const root = ctx.dom.window.document.getElementById('view-root');
  root.innerHTML = '<div class="video-card"></div>';
  await napMs(700); // the mutation re-arms the quiet timer (300ms); wait well past it -> reveal
  assert.ok(critterCount(ctx) > 0, 'placed once, after the real cards settled - at the final layout');
});

test('v1.182 B: a static, non-loading view reveals promptly (the leading quiet), well under the 2.5s cap', async (t) => {
  const ctx = mountCritterFeed('<div id="view-root"><div class="video-card"></div></div>');
  t.after(() => unmountCritterFeed(ctx));
  const { scheduleCritterScatter } = require('../../public/js/common.js');
  scheduleCritterScatter();
  // "not instant" proven RACE-FREE: nothing places synchronously (the leading
  // quiet + cap are both setTimeouts) - no nap, so no timing flake.
  assert.strictEqual(critterCount(ctx), 0, 'not instant: placement is always deferred, never the old +200ms race');
  await napMs(700); // well past the 300ms leading quiet, well under the 2500ms cap
  assert.ok(critterCount(ctx) > 0, 'a static view (no skeletons) does not wait the full cap to reveal');
});

test('v1.182 C: a new navigation (disconnectCritterWait) cancels a pending wait - nothing places behind the moved-on view', async (t) => {
  const ctx = mountCritterFeed('<div id="view-root"><div class="video-card skeleton-card"></div></div>');
  t.after(() => unmountCritterFeed(ctx));
  const { scheduleCritterScatter, disconnectCritterWait } = require('../../public/js/common.js');
  scheduleCritterScatter(); // wait armed, deferred by the skeleton
  await napMs(120);
  disconnectCritterWait(); // the navigation-away teardown (also called from scheduleCritterScatter + scatterCritters)
  // Content lands AFTER the wait was torn down: nothing may re-arm it.
  ctx.dom.window.document.getElementById('view-root').innerHTML = '<div class="video-card"></div>';
  await napMs(450);
  assert.strictEqual(critterCount(ctx), 0, 'a torn-down wait never fires a placement (no leaked observer/timer)');
});

test('v1.182 D (pure): critterPageLoading is true iff a feed skeleton is on the page', async (t) => {
  const ctx = mountCritterFeed('<div id="view-root"><div class="video-card skeleton-card"></div></div>');
  t.after(() => unmountCritterFeed(ctx));
  const { critterPageLoading } = require('../../public/js/common.js');
  assert.strictEqual(critterPageLoading(), true, 'a .skeleton-card means the feed is still loading');
  ctx.dom.window.document.getElementById('view-root').innerHTML = '<div class="video-card"></div>';
  assert.strictEqual(critterPageLoading(), false, 'no skeleton -> settled');
});

test('v1.182 E (source locks): the wait phase - cap value, doc-guarded observer, skeleton-gated reveal, cancelled on every nav', () => {
  // The cap is Dean's chosen ceiling; the quiet is the settle beat.
  assert.match(COMMON, /var CRITTER_REVEAL_CAP_MS = 2500;/, 'the reveal cap is 2.5s (Dean\'s ruling)');
  assert.match(COMMON, /var CRITTER_QUIET_MS = 300;/, 'the quiet debounce is a settled beat');
  assert.match(COMMON, /var CRITTER_LOADING_SELECTORS = \['\.skeleton-card'\];/, 'the loading marker is the feed skeleton');
  const sched = COMMON.slice(COMMON.indexOf('function scheduleCritterScatter()'), COMMON.indexOf('\nfunction wireCritterListeners'));
  assert.match(sched, /disconnectCritterWait\(\);/, 'a navigation cancels the wait phase (observer + quiet + cap) - the unstashed-handle class');
  // gate CRITICAL: the previous view's persistent nudge observer is disconnected
  // on every navigation so it cannot re-scatter onto the new view's skeletons.
  assert.match(sched, /unwireCritterContentNudge\(\);/, 'a navigation disconnects the previous view\'s nudge observer (the gate CRITICAL)');
  // gate WARNING: the outgoing view's critters clear NOW, never linger to the cap.
  assert.match(sched, /var staleLayer = document\.getElementById\('critter-layer'\);\n\s*if \(staleLayer\) staleLayer\.remove\(\);\n\s*critterPlacements = \[\];/,
    'a navigation clears the outgoing view\'s critters immediately (no stale linger)');
  assert.match(sched, /if \(!resolveCritterConfig\(\)\.enabled\) \{[\s\S]*?return;/, 'mode OFF clears + returns (no deferred scatter)');
  assert.match(sched, /armCritterQuietWait\(\);/, 'mode ON arms the wait, never an immediate placement');
  const wait = COMMON.slice(COMMON.indexOf('function armCritterQuietWait'), COMMON.indexOf('\nfunction scheduleCritterScatter'));
  assert.match(wait, /fetchCritterManifest\(\);/, 'the pool warms DURING the wait (no half-decoded flash at reveal)');
  assert.match(wait, /critterCapTimer = setTimeout\(revealCritterScatter, CRITTER_REVEAL_CAP_MS\);/, 'the hard cap is armed to the reveal');
  assert.match(wait, /document !== critterWaitObsDoc\) return;/, 'the wait observer stands down on a swapped/torn-down document (the jsdom class)');
  const quiet = COMMON.slice(COMMON.indexOf('function armCritterQuietTimer'), COMMON.indexOf('\nfunction armCritterQuietWait'));
  assert.match(quiet, /if \(critterPageLoading\(\)\) return;/, 'the quiet timer never reveals against feed skeletons');
  assert.match(quiet, /revealCritterScatter\(\);/, 'once settled it reveals');
  const scatter = COMMON.slice(COMMON.indexOf('function scatterCritters()'), COMMON.indexOf('\nfunction armCritterSettleCheck'));
  assert.match(scatter, /disconnectCritterWait\(\);/, 'any direct scatter supersedes a pending wait (no double placement)');
});

test('v1.182 F (gate CRITICAL regression): a SECOND navigation in one document never places against the new view\'s skeletons', async (t) => {
  // The bug the QA seat caught: view A reveals (wiring the persistent nudge
  // observer); navigating to a skeleton view B left that observer live, and it
  // re-scattered onto B's loading skeletons DURING B's wait - the exact flash.
  // Same document across both navigations (the SPA case the fresh-JSDOM tests
  // could not reach).
  const ctx = mountCritterFeed('<div id="view-root"><div class="video-card"></div></div>');
  t.after(() => unmountCritterFeed(ctx));
  const { scheduleCritterScatter } = require('../../public/js/common.js');
  // VIEW A: settle + reveal (this wires the post-reveal nudge observer).
  scheduleCritterScatter();
  await napMs(700); // well past the 300ms leading quiet (generous margin - no cold-start flake)
  assert.ok(critterCount(ctx) > 0, 'view A revealed');
  // NAVIGATE (same document) to VIEW B: a feed rendering a skeleton grid.
  scheduleCritterScatter();
  const root = ctx.dom.window.document.getElementById('view-root');
  root.innerHTML = '<div class="video-card skeleton-card"></div><div class="video-card skeleton-card"></div>';
  await napMs(450); // past the leftover-observer's old 150ms window AND the leading quiet
  assert.strictEqual(critterCount(ctx), 0,
    'NOTHING places onto view B\'s skeletons - the leftover nudge observer was disconnected on nav');
  assert.ok(ctx.dom.window.document.querySelector('.skeleton-card'), 'skeletons still present (still loading)');
  // Real cards land -> reveal once, at the settled layout.
  root.innerHTML = '<div class="video-card"></div>';
  await napMs(700); // past the mutation-armed quiet (300ms) with generous margin
  assert.ok(critterCount(ctx) > 0, 'placed once, after view B settled');
});

test('v1.182 G (gate WARNING regression): a navigation clears the outgoing view\'s critters immediately - no stale linger to the cap', async (t) => {
  const ctx = mountCritterFeed('<div id="view-root"><div class="video-card"></div></div>');
  t.after(() => unmountCritterFeed(ctx));
  const { scheduleCritterScatter } = require('../../public/js/common.js');
  scheduleCritterScatter();
  await napMs(700); // past the 300ms leading quiet with generous margin
  assert.ok(critterCount(ctx) > 0, 'view A has critters painted');
  // Navigate away: the outgoing critters must be gone AT ONCE, not float over
  // the new (loading) view for up to the 2.5s cap.
  scheduleCritterScatter();
  assert.strictEqual(ctx.dom.window.document.getElementById('critter-layer'), null,
    'the old layer is removed synchronously on navigation');
  assert.strictEqual(critterCount(ctx), 0, 'no stale critters linger during the next wait');
});

test('v1.182 H (functional cap): the 2.5s cap reveals even against a feed that never stops loading', async (t) => {
  const { scheduleCritterScatter, setCritterTimingForTest } = require('../../public/js/common.js');
  // quiet effectively never fires; the cap is the ONLY path to a reveal - the
  // wave's "reveal no matter what" backstop. The cap is comfortably above any
  // nap below so there is NO timing race (the flake the QA seat caught: a
  // napMs(120) that could overrun a 250ms cap on a cold start).
  setCritterTimingForTest(100000, 400);
  const ctx = mountCritterFeed('<div id="view-root"><div class="video-card skeleton-card"></div></div>');
  t.after(() => { setCritterTimingForTest(300, 2500); unmountCritterFeed(ctx); }); // restore defaults (require cache persists)
  scheduleCritterScatter();
  // RACE-FREE pre-cap assertion: placement is always deferred (leading quiet +
  // cap are both setTimeouts), so nothing is painted synchronously - no nap.
  assert.strictEqual(critterCount(ctx), 0, 'before the cap: nothing placed (the persistent skeleton keeps the quiet gate closed)');
  await napMs(800); // 2x the 400ms cap - generous margin, no cold-start flake
  assert.ok(critterCount(ctx) > 0, 'the cap forced a reveal despite the never-clearing skeleton - the inescapable backstop');
});
