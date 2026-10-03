'use strict';
// The geometry checks' pure halves (test/geometry/checks.js evaluators and the runner's
// expected-failure accounting), on synthetic boxes - no browser. The browser halves are
// mutation-proven by `node test/geometry/run.js --mutants` (plan D10.2, LESSONS 2).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { evalG1, evalG2, evalG3, evalG4, evalHeader, evalBottomBar, evalSheetHeader, evalPopover, evalPlayerBleed, TOL, G4_TOL } = require('../geometry/checks.js');
const { summarize, expectedFor, loadExpected } = require('../geometry/run.js');
const { SURFACES, FAST_SCENES, G4_SEQUENCES } = require('../geometry/scenes.js');
const { MUTATIONS } = require('../geometry/mutations.js');

const row = (title, lead, media, body, aside, actions) => ({ title, slots: { lead, media, body, aside, actions } });

test('tolerances are the plan\'s: 0.5px for G1-G3, 1px for G4 (D10.2)', () => {
  assert.strictEqual(TOL, 0.5);
  assert.strictEqual(G4_TOL, 1);
});

test('G1: equal slot lefts pass; a slot 0.6px off fails naming the list, slot and row; 0.5px passes', () => {
  const ok = [{ list: 'N', rows: [row('a', 24, 40, 84, 222, 326), row('b', 24, 40, 84, 222, 326)] }];
  assert.deepStrictEqual(evalG1(ok).failures, []);
  assert.deepStrictEqual(evalG1(ok).measured, { lists: 1, rows: 2 });
  const edge = [{ list: 'N', rows: [row('a', 24, 40, 84, 222, 326), row('b', 24, 40.5, 84, 222, 326)] }];
  assert.deepStrictEqual(evalG1(edge).failures, []);
  const bad = [{ list: 'N', rows: [row('a', 24, 40, 84, 222, 326), row('b', 24, 40, 84, 222.6, 326), row('c', 24, 40, 84, 222, 326)] }];
  const f = evalG1(bad).failures;
  assert.strictEqual(f.length, 1);
  assert.deepStrictEqual([f[0].list, f[0].slot, f[0].row, f[0].delta], ['N', 'aside', 'b', 0.6]);
});

test('G1: a slot present in one row and missing in another fails; single-row lists are not counted', () => {
  const lists = [{ list: 'N', rows: [row('a', 24, 40, 84, 222, 326), row('b', 24, null, 84, 222, 326)] }, { list: 'one', rows: [row('x', 1, 2, 3, 4, 5)] }];
  const r = evalG1(lists);
  assert.strictEqual(r.failures.length, 1);
  assert.strictEqual(r.failures[0].slot, 'media');
  assert.strictEqual(r.measured.lists, 1);
});

test('G1: slots are the UNION of every row\'s keys - an actions#N slot only some rows carry fails, even when the first row lacks it', () => {
  const r = (title, slots) => ({ title, slots });
  const base = { lead: 16, media: 16, body: 64, aside: 242, actions: 242 };
  const lists = [{ list: 'subs', rows: [
    r('a', { ...base, 'actions#1': 242, 'actions#2': 286 }),
    r('b', { ...base, 'actions#1': 242, 'actions#2': 286, 'actions#3': 330 }),
  ] }];
  const f = evalG1(lists).failures;
  assert.strictEqual(f.length, 1);
  assert.deepStrictEqual([f[0].slot, f[0].row, f[0].note], ['actions#3', 'b', 'slot missing in one row']);
  const moved = [{ list: 'subs', rows: [r('a', { ...base, 'actions#2': 286 }), r('b', { ...base, 'actions#2': 242 })] }];
  assert.deepStrictEqual(evalG1(moved).failures.map((x) => [x.slot, x.delta]), [['actions#2', -44]]);
});

test('G2: centre-y within 0.5px passes, 0.6px fails; a stacked button compares centre-x', () => {
  const box = (x, y, w, h) => ({ x, y, w, h });
  const items = [
    { where: 'ui-btn', name: 'ok', axis: 'y', icon: box(0, 11, 22, 22), ref: box(30, 15, 50, 14) },
    { where: 'ui-btn', name: 'low', axis: 'y', icon: box(0, 11.6, 22, 22), ref: box(30, 15, 50, 14) },
    { where: 'ui-btn', name: 'stack', axis: 'x', icon: box(20, 0, 24, 24), ref: box(21.5, 30, 21, 11) },
    { where: 'ui-btn', name: 'stack-off', axis: 'x', icon: box(21, 0, 24, 24), ref: box(21.5, 30, 21, 11) },
  ];
  const r = evalG2(items);
  assert.deepStrictEqual(r.failures.map((f) => [f.name, f.delta]), [['low', 0.6], ['stack-off', 1]]);
  assert.strictEqual(r.measured.items, 4);
});

test('G3: equal heights pass; a 0.6px taller sibling fails and lists every height', () => {
  const g = (hs) => ({ group: 'G', buttons: hs.map((h, i) => ({ name: 'b' + i, h })) });
  assert.deepStrictEqual(evalG3([g([44, 44, 44.5])]).failures, []);
  const r = evalG3([g([44, 44.6, 44])]);
  assert.strictEqual(r.failures.length, 1);
  assert.deepStrictEqual(r.failures[0].heights, ['b0=44', 'b1=44.6', 'b2=44']);
});

test('G4: one jump then still passes; a box still moving after the first changed frame fails', () => {
  const f = (vw, boxes) => ({ vw, vh: 800, boxes });
  const still = [f(390, { a: [0, 0, 390, 50] }), f(390, { a: [0, 0, 390, 50] }), f(844, { a: [0, 0, 844, 50] }), f(844, { a: [0, 0, 844, 50] }), f(844, { a: [0, 0, 844, 50] })];
  const r = evalG4(still);
  assert.deepStrictEqual([r.changed, r.firstChange, r.settled, r.moved.length], [true, 2, true, 0]);
  const sliding = [f(390, { a: [0, 0, 390, 50] }), f(844, { a: [0, 0, 844, 50], b: [10, 60, 100, 20] }), f(844, { a: [0, 0, 844, 50], b: [30, 60, 100, 20] }),
    f(844, { a: [0, 0, 844, 50], b: [64, 60, 100, 20] }), f(844, { a: [0, 0, 844, 50], b: [64, 60, 100, 20] })];
  const s = evalG4(sliding);
  assert.strictEqual(s.firstChange, 1);
  assert.deepStrictEqual(s.moved.map((m) => [m.key, m.frame, m.delta]), [['b', 2, 34]]);
  // a 1px wobble is within tolerance; the first changed frame itself may differ
  const wobble = [f(390, { a: [0, 0, 390, 50] }), f(844, { a: [0, 5, 844, 50] }), f(844, { a: [0, 1, 844, 50] }), f(844, { a: [0, 0, 844, 50] }), f(844, { a: [0, 0, 844, 50] })];
  assert.strictEqual(evalG4(wobble).moved.length, 0);
});

test('G4: no change at all is reported (the runner fails it as VACUOUS); an unsettled end is reported', () => {
  const f = (y) => ({ vw: 390, vh: 800, boxes: { a: [0, y, 10, 10] } });
  assert.strictEqual(evalG4([f(0), f(0), f(0), f(0)]).changed, false);
  assert.strictEqual(evalG4([f(0), f(10), f(20), f(30)]).settled, false);
});

test('G4 evaluator is self-contained (the runner evaluates its source text inside the page)', () => {
  const standalone = new Function(`return (${evalG4.toString()})`)();
  const f = (vw) => ({ vw, vh: 800, boxes: { a: [0, 0, vw, 50] } });
  assert.strictEqual(standalone([f(390), f(844), f(844), f(844)], 1).changed, true);
});

test('expected failures: ok / FAIL / XFAIL / XPASS, prefix ids and match narrowing', () => {
  const entries = [
    { id: 'G4/pocket/dark', owner: 'S7', reason: 'F23' },
    { id: 'G3/kit/*', match: 'row #4', owner: 'step 4', reason: 'mixed sizes' },
  ];
  assert.strictEqual(expectedFor(entries, 'G3/kit/2021-light-phone').length, 1);
  assert.strictEqual(expectedFor(entries, 'G3/other/2021-light-phone').length, 0);
  const results = [
    { id: 'G1/kit/a', failures: [] },
    { id: 'G1/kit/b', failures: ['off'] },
    { id: 'G4/pocket/dark', failures: ['moved'] },
    { id: 'G3/kit/a', failures: [{ group: 'row #4' }] },
    { id: 'G3/kit/b', failures: [{ group: 'row #4' }, { group: 'row #2' }] },
    { id: 'G3/kit/c', failures: [] },
  ];
  const s = summarize(results, entries);
  assert.deepStrictEqual(s.counts, { ok: 1, FAIL: 2, XFAIL: 2, XPASS: 1 });
  assert.strictEqual(s.fail, 3);
  const status = (id) => { const l = s.lines.find((x) => (/^(\S+)\s+(\S+)/.exec(x) || [])[2] === id); return l.slice(0, 5).trim(); };
  assert.deepStrictEqual(['G1/kit/a', 'G1/kit/b', 'G4/pocket/dark', 'G3/kit/a', 'G3/kit/b', 'G3/kit/c'].map(status), ['ok', 'FAIL', 'XFAIL', 'XFAIL', 'FAIL', 'XPASS']);
});

test('the committed expected-failure list is well formed, and every entry names its owner', () => {
  const entries = loadExpected();
  // (An EMPTY list is the goal - S7 empties the F23 entries - so no minimum here.)
  for (const e of entries) assert.ok(/^(G[1-4]|LOAD|PAGEERROR)\//.test(e.id), e.id);
});

test('scene list: every live surface has a path, a ready selector and anti-vacuity floors for each of its checks; the fast set is 4 live scenes', () => {
  for (const s of SURFACES) {
    if (s.pending) { assert.ok(s.owner && s.note, s.id); continue; }
    assert.strictEqual(typeof s.path, 'function', s.id);
    assert.ok(s.ready, s.id);
    for (const c of s.checks) assert.ok(s.min && s.min[c] && Object.keys(s.min[c]).length, `${s.id} ${c} needs a floor`);
  }
  // D10.2 asked for 4 (~20s); the merge of S1/S3/S4 keeps 5 real surfaces (~12s measured) - a deliberate,
  // recorded deviation (test/geometry/scenes.js). The bound stays tight so the set cannot creep.
  assert.strictEqual(FAST_SCENES.length, 5);
  for (const f of FAST_SCENES) assert.ok(SURFACES.find((s) => s.id === f.surface && !s.pending), f.surface);
  assert.ok(G4_SEQUENCES.some((q) => q.id === 'pocket-rotation'));
});

test('every check has at least one mutation proof, each aimed at a live scene or sequence', () => {
  const byCheck = {};
  for (const [name, m] of Object.entries(MUTATIONS)) {
    byCheck[m.check] = (byCheck[m.check] || 0) + 1;
    assert.ok(m.css && m.css.length > 10, name);
    if (m.check === 'G4') assert.ok(G4_SEQUENCES.find((q) => q.id === m.target.sequence), name);
    else assert.ok(SURFACES.find((s) => s.id === m.target.surface && !s.pending), name);
  }
  // Sweep S1 adds HDR / NAV, the chrome's rendered contracts; sweep S9 SHD, the sheet header;
  // gate r1 POP, an open menu's reach; v1.359 BLD, the phone player edge to edge.
  assert.deepStrictEqual(Object.keys(byCheck).sort(), ['BLD', 'G1', 'G2', 'G3', 'G4', 'HDR', 'NAV', 'POP', 'SHD']);
});

test('geometry files are not *.test.js (npm test must not try to boot Playwright)', () => {
  const files = fs.readdirSync(path.join(__dirname, '..', 'geometry'));
  assert.ok(files.includes('run.js'));
  assert.deepStrictEqual(files.filter((f) => f.endsWith('.test.js')), []);
});

// ---- sweep S1: the chrome's evaluators (HDR, NAV) on synthetic measurements ----
const btn = (name, x, w, y = 6, h = w) => ({ name, box: { x, y, w, h } });
const phoneHeader = (over) => ({
  vw: 390,
  buttons: [btn('queue', 214, 44), btn('bell', 258, 44), btn('download', 302, 44), btn('search', 346, 44)],
  searchVisible: true, searchBox: { x: 346, y: 6, w: 44, h: 44 }, accountVisible: false, field: null,
  reserve: { w: 44, h: 44, bellW: 44, bellH: 44, skel: { dx: 11, dy: 11, w: 22, h: 22 }, glyph: { dx: 11, dy: 11, w: 22, h: 22 } },
  sidebar: [{ name: 'Home', active: true, deco: 'none', weight: '400' }, { name: 'Settings', active: false, deco: 'none', weight: '400' }],
  ...over,
});

test('HDR: a level, evenly spaced 44px phone row with the magnifier rightmost passes', () => {
  const { measured, failures } = evalHeader(phoneHeader());
  assert.deepStrictEqual(failures, []);
  assert.strictEqual(measured.buttons, 4);
});

test('HDR: each broken property fails on its own (hidden magnifier, avatar shown, 43px, uneven gap, shifted reserve, bold/underlined sidebar)', () => {
  const cases = [
    [{ searchVisible: false, searchBox: null }, /magnifier is hidden/],
    [{ accountVisible: true }, /header avatar shows/],
    [{ buttons: [btn('queue', 214, 44), btn('bell', 258, 43, 6, 43), btn('download', 302, 44), btn('search', 346, 44)] }, /bell: 43x43, want 44x44/],
    [{ buttons: [btn('queue', 210, 44), btn('bell', 258, 44), btn('download', 302, 44), btn('search', 346, 44)] }, /uneven glyph spacing/],
    [{ searchBox: { x: 214, y: 6, w: 44, h: 44 } }, /not the rightmost/],
    [{ reserve: { w: 44, h: 44, bellW: 44, bellH: 44, skel: { dx: 12, dy: 11, w: 20, h: 22 }, glyph: { dx: 11, dy: 11, w: 22, h: 22 } } }, /bell reserve disc dx/],
    [{ sidebar: [{ name: 'Home', active: true, deco: 'none', weight: '700' }, { name: 'Settings', active: false, deco: 'none', weight: '400' }] }, /differ in weight/],
    [{ sidebar: [{ name: 'Home', active: true, deco: 'underline', weight: '400' }] }, /underlined/],
  ];
  for (const [over, re] of cases) {
    const { failures } = evalHeader(phoneHeader(over));
    assert.ok(failures.some((f) => re.test(f)), `${re} in ${JSON.stringify(failures)}`);
  }
});

test('HDR: desktop wants 36px buttons, the avatar and the 36px field, and no magnifier', () => {
  const desk = (over) => phoneHeader({ vw: 1440, searchVisible: false, searchBox: null, accountVisible: true, field: { x: 400, y: 10, w: 600, h: 36 },
    buttons: [btn('queue', 1260, 36), btn('bell', 1300, 36), btn('download', 1340, 36), btn('Account menu', 1380, 36)], ...over });
  assert.deepStrictEqual(evalHeader(desk()).failures, []);
  assert.ok(evalHeader(desk({ searchVisible: true, searchBox: { x: 1, y: 1, w: 36, h: 36 } })).failures.some((f) => /magnifier shows/.test(f)));
  assert.ok(evalHeader(desk({ accountVisible: false })).failures.some((f) => /avatar is hidden/.test(f)));
  assert.ok(evalHeader(desk({ field: { x: 400, y: 10, w: 600, h: 40 } })).failures.some((f) => /search field is 40px/.test(f)));
});

const INKS = { ink1: 'rgb(255, 255, 255)', ink2: 'rgb(161, 161, 166)', accent: 'rgb(255, 69, 58)', accentFill: 'rgb(224, 25, 15)' };
const tab = (name, x, over) => ({ name, active: false, slot: { x, y: 800, w: 24, h: 24 }, label: { x, y: 826, w: 40, h: 13 },
  color: INKS.ink2, weight: '500', deco: 'none', href: '#i-' + name, ...over });
const bar = (over) => ({ shown: true, inks: INKS, tabs: [tab('home', 20, { active: true, color: INKS.ink1, href: '#i-home-fill' }), tab('history', 90), tab('you', 160, { href: '' })], ...over });

test('NAV: fixed 24px slots, one label line, one ink-1 active tab with its filled glyph pass', () => {
  const { measured, failures } = evalBottomBar(bar());
  assert.deepStrictEqual(failures, []);
  assert.strictEqual(measured.tabs, 3);
  assert.deepStrictEqual(evalBottomBar({ shown: false, tabs: [] }).failures, [], 'no bar (desktop) - nothing to check');
});

test('NAV: each broken property fails on its own', () => {
  const t = bar().tabs;
  const cases = [
    [[t[0], t[1], tab('you', 160, { slot: { x: 160, y: 800, w: 24, h: 28 }, label: { x: 160, y: 830, w: 40, h: 13 } })], /icon slot 24x28/],
    [[t[0], t[1], tab('you', 160, { label: { x: 160, y: 827, w: 40, h: 13 } })], /label top 827/],
    [[tab('home', 20, { active: true, color: INKS.accent, href: '#i-home-fill' }), t[1]], /red/],
    [[tab('home', 20, { active: true, color: INKS.ink1, href: '#i-home' }), t[1]], /not the filled twin/],
    [[t[0], tab('history', 90, { color: INKS.ink1 })], /want --ink-2/],
    [[t[0], tab('history', 90, { deco: 'underline' })], /underlined/],
    [[t[0], tab('history', 90, { weight: '700' })], /differ in weight/],
    [[tab('home', 20), t[1]], /0 active tabs/],
  ];
  for (const [tabs, re] of cases) {
    const { failures } = evalBottomBar(bar({ tabs }));
    assert.ok(failures.some((f) => re.test(f)), `${re} in ${JSON.stringify(failures)}`);
  }
});

// ---- SHD (sweep S9): the sheet header ----
// A 390px dialog: header 16..374 wide at y 200 (56 tall), end padding 4 - so the Close's
// trailing edge must sit at 370; a 44px Close with a centred 22px glyph; a title level with it.
const sheetHead = (over) => ({
  name: 'Move this local file to Trash?',
  header: { x: 16, y: 200, w: 358, h: 56 }, padEnd: 4,
  close: { x: 326, y: 206, w: 44, h: 44 }, icon: { x: 337, y: 217, w: 22, h: 22 },
  title: { x: 32, y: 217, w: 250, h: 22 },
  ...over,
});

test('SHD: a titled and a titleless header with the Close on the trailing edge, level and centred, pass', () => {
  const { measured, failures } = evalSheetHeader([sheetHead(), sheetHead({ name: '(no title)', title: null })]);
  assert.deepStrictEqual(failures, []);
  assert.deepStrictEqual(measured, { headers: 2, titleless: 1 });
});

test('SHD: each broken property fails on its own (Close on the leading edge, glyph off centre on x and on y, title not level, title under the Close, no glyph)', () => {
  const cases = [
    [{ title: null, name: '(no title)', close: { x: 16, y: 206, w: 44, h: 44 }, icon: { x: 27, y: 217, w: 22, h: 22 } }, /not the header's trailing edge/],
    [{ icon: { x: 337.6, y: 217, w: 22, h: 22 } }, /glyph centre-x off/],
    [{ icon: { x: 337, y: 217.6, w: 22, h: 22 } }, /glyph centre-y off/],
    [{ title: { x: 32, y: 218, w: 250, h: 22 } }, /not level/],
    [{ title: { x: 32, y: 217, w: 300, h: 22 } }, /runs under the Close/],
    [{ icon: null }, /no icon glyph/],
    [{ close: null }, /no header or no Close/],
  ];
  for (const [over, re] of cases) {
    const { failures } = evalSheetHeader([sheetHead(over)]);
    assert.ok(failures.some((f) => re.test(f)), `${re} in ${JSON.stringify(failures)}`);
  }
  assert.deepStrictEqual(evalSheetHeader([sheetHead({ icon: { x: 337.5, y: 217.5, w: 22, h: 22 } })]).failures, [], '0.5px is inside the tolerance');
});

// POP (gate r1, adversary 4): the r1 repro's own numbers - the 1280x800 page, the first card's
// kebab at y496-528, a 328px menu of six 44px rows.
function popData(over) {
  const sheetY = over && over.sheetY != null ? over.sheetY : 168;
  const rows = ['Add to queue', 'Like', 'Save to device', 'Transcript', 'Reheat metadata', 'Move to Trash']
    .map((name, i) => ({ name, box: { x: 458, y: sheetY + 56 + i * 44, w: 380, h: 44 }, hitSelf: true }));
  return {
    vp: { x: 0, y: 0, w: 1280, h: 800 }, popover: true,
    sheet: { x: 458, y: sheetY, w: 380, h: 328 },
    body: { box: { x: 458, y: sheetY + 56, w: 380, h: 272 }, scrolls: false },
    band: { gap: 8, safeTop: 0, safeBottom: 0 },
    anchor: { x: 458, y: 496, w: 32, h: 32 },
    rows, ...(over || {}),
  };
}

test('POP: a menu flipped above its kebab, every row inside the viewport and hit-testable, passes', () => {
  assert.deepStrictEqual(evalPopover(popData()), { measured: { rows: 6 }, failures: [] });
  // below the anchor, when it fits there (a taller viewport)
  assert.deepStrictEqual(evalPopover(popData({ sheetY: 528, vp: { x: 0, y: 0, w: 1440, h: 900 } })).failures, []);
});

test('POP: each broken property fails on its own (off the bottom, a row unreachable, a row covered, covering the anchor that it fits beside, no anchor, no sheet)', () => {
  // the r1 placement: below the kebab at 1280x800
  const r1 = evalPopover(popData({ sheetY: 528 })).failures;
  assert.ok(r1.some((f) => /leaves the 1280x800 viewport/.test(f)), r1.join(' | '));
  assert.ok(r1.some((f) => /Move to Trash .* unreachable/.test(f)), r1.join(' | '));
  assert.ok(r1.some((f) => /Reheat metadata .* unreachable/.test(f)), r1.join(' | '));
  // the same rows reached through a scrolling body inside the viewport are fine
  const scrolled = popData({ sheetY: 16 });
  scrolled.sheet = { x: 458, y: 16, w: 380, h: 200 };
  scrolled.body = { box: { x: 458, y: 72, w: 380, h: 144 }, scrolls: true };
  scrolled.anchor = { x: 458, y: 180, w: 32, h: 32 };
  scrolled.band = { gap: 8, safeTop: 0, safeBottom: 0 };
  scrolled.vp = { x: 0, y: 0, w: 1280, h: 230 };
  assert.deepStrictEqual(evalPopover(scrolled).failures.filter((f) => /unreachable/.test(f)), [], 'a scrolling body reaches them');
  // a row something else sits on
  const covered = popData();
  covered.rows[5].hitSelf = false;
  assert.deepStrictEqual(evalPopover(covered).failures, ['Move to Trash (y444-488): something else is on top of it']);
  // shifted over the kebab though it fits above it (the flip mutated away)
  const shifted = evalPopover(popData({ sheetY: 464 })).failures;
  assert.ok(shifted.some((f) => /covers its anchor y496-528 though it fits above it/.test(f)), shifted.join(' | '));
  // covering the anchor is right when it fits on NEITHER side (the landscape phone)
  const land = popData({ sheetY: 54, vp: { x: 0, y: 0, w: 844, h: 390 }, anchor: { x: 495, y: 179, w: 32, h: 32 } });
  assert.deepStrictEqual(evalPopover(land).failures, [], 'fits neither side: shifting over it is the placement');
  // the band's edge (gap 8 + safe-area top 8 = 16): an anchor at y344 leaves exactly 328 above,
  // so the menu fits there and must not cover it; at y343 it does not fit above (nor below)
  const edge = { vp: { x: 0, y: 0, w: 1280, h: 600 }, anchor: { x: 458, y: 344, w: 32, h: 32 }, band: { gap: 8, safeTop: 8, safeBottom: 0 } }; // 600 tall: never fits below
  assert.deepStrictEqual(evalPopover(popData({ ...edge, sheetY: 16 })).failures, [], 'flipped, flush on the anchor top');
  assert.ok(evalPopover(popData({ ...edge, sheetY: 17 })).failures.some((f) => /covers its anchor .* fits above/.test(f)), '1px over it');
  assert.deepStrictEqual(evalPopover(popData({ ...edge, anchor: { x: 458, y: 343, w: 32, h: 32 }, sheetY: 17 })).failures, [], 'fits neither side: covering is allowed');
  assert.ok(evalPopover(popData({ anchor: null })).failures.some((f) => /anchor was not found/.test(f)));
  assert.deepStrictEqual(evalPopover({ vp: { x: 0, y: 0, w: 1, h: 1 }, sheet: null, rows: [] }), { measured: { rows: 0 }, failures: ['no open sheet'] });
  // a bottom sheet is not held to the anchor rule
  const bottom = popData({ popover: false, sheetY: 505, vp: { x: 0, y: 0, w: 390, h: 844 } });
  bottom.sheet = { x: 0, y: 505, w: 390, h: 339 };
  bottom.rows.forEach((r, i) => { r.box = { x: 0, y: 572 + i * 44, w: 390, h: 44 }; });
  assert.deepStrictEqual(evalPopover(bottom).failures, []);
});

// BLD (v1.359): the phone player edge to edge, the desktop player inside its column.
const bleed = (o = {}) => ({
  vw: 390, phone: true, wrapper: { x: 0, y: 56, w: 390, h: 219.4 }, title: { x: 16, y: 290, w: 358, h: 30 },
  stagePad: { l: 0, r: 0 }, border: [0, 0, 0, 0], radius: [0, 0, 0, 0], ...o,
});

test('BLD: a phone player flush with both edges, unframed and square passes', () => {
  assert.deepStrictEqual(evalPlayerBleed(bleed()), { measured: { player: 1 }, failures: [] });
});

test('BLD: a notched phone passes only with the player at the inset and the title at the gutter', () => {
  const d = bleed({ vw: 844, wrapper: { x: 47, y: 0, w: 750, h: 400 }, stagePad: { l: 47, r: 47 } });
  assert.deepStrictEqual(evalPlayerBleed(d).failures, []);
  assert.strictEqual(evalPlayerBleed({ ...d, wrapper: { x: 0, y: 0, w: 844, h: 400 } }).failures.length >= 1, true, 'under the notch is a failure');
});

test('BLD: the gutter back (x 16, w 358), a border, a radius and a bled title each fail by name', () => {
  assert.match(evalPlayerBleed(bleed({ wrapper: { x: 16, y: 56, w: 358, h: 200 } })).failures.join('|'), /starts at x 16.*|358px wide/);
  assert.match(evalPlayerBleed(bleed({ border: [1, 1, 1, 1] })).failures.join('|'), /paints a border/);
  assert.match(evalPlayerBleed(bleed({ radius: [12, 12, 12, 12] })).failures.join('|'), /rounded/);
  assert.match(evalPlayerBleed(bleed({ title: { x: 0, y: 290, w: 390, h: 30 } })).failures.join('|'), /title starts at x 0/);
});

test('BLD: desktop keeps its column; a bleed there fails; no wrapper is a failure, never a pass', () => {
  const desk = { vw: 1440, phone: false, wrapper: { x: 254, y: 80, w: 900, h: 506 }, title: { x: 254, y: 600, w: 900, h: 30 }, stagePad: { l: 0, r: 0 }, border: [1, 1, 1, 1], radius: [12, 12, 12, 12] };
  assert.deepStrictEqual(evalPlayerBleed(desk).failures, []);
  assert.match(evalPlayerBleed({ ...desk, wrapper: { x: 0, y: 80, w: 1440, h: 506 } }).failures.join('|'), /reaches a viewport edge/);
  assert.deepStrictEqual(evalPlayerBleed(null), { measured: { player: 0 }, failures: ['no player wrapper in the stage'] });
});
