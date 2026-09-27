'use strict';
// The geometry checks' pure halves (test/geometry/checks.js evaluators and the runner's
// expected-failure accounting), on synthetic boxes - no browser. The browser halves are
// mutation-proven by `node test/geometry/run.js --mutants` (plan D10.2, LESSONS 2).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { evalG1, evalG2, evalG3, evalG4, TOL, G4_TOL } = require('../geometry/checks.js');
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
  assert.strictEqual(FAST_SCENES.length, 4);
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
  assert.deepStrictEqual(Object.keys(byCheck).sort(), ['G1', 'G2', 'G3', 'G4']);
});

test('geometry files are not *.test.js (npm test must not try to boot Playwright)', () => {
  const files = fs.readdirSync(path.join(__dirname, '..', 'geometry'));
  assert.ok(files.includes('run.js'));
  assert.deepStrictEqual(files.filter((f) => f.endsWith('.test.js')), []);
});
