'use strict';

// [UNIT] v1.408.0 W1 - the iPod's top edge on the phone (plan docs/exec-plans/completed/2026-11-15-ipod-hold-switch.md, R2, R10-R13).
// The Click full player stops under the phone's top safe area (black above) and shows its top EDGE straight on. Bound here:
//   - holdSpec: DERIVED from the registry for every Click colorway (never a hand list), each family where the photos put it;
//   - the ONE writer: renderIpod draws exactly one .ip-top carrying that spec, on every Click colorway, and on nothing else;
//   - the CSS: the cut reads the SAME effective inset as the padding (turn-safe), never under its minimum; the strip shows
//     only on the phone's full player; the Sideways layout cuts by env() like the rest of its block.
// The pixels are measured in Chromium (the plan's Evidence: scripts/pocket-top-edge-probe.js).

const { test } = require('node:test');
const assert = require('node:assert');
const { readStyleCss, readTokensCss, cssRules } = require('../helpers/stylesheets.js');
const SK = require('../../public/js/music-skins.js');

const POS = ['orig', 'c4', 'std', 'mini', 'slim2', 'slim3', 'slim4', 'slim5'];
const EDGE = ['chrome', 'cap', 'metal'];

test('holdSpec: every Click colorway gets a known position and edge, derived from line / gen / look', () => {
  const ids = SK.clickColorways();
  assert.ok(ids.length > 90, 'the census reaches the whole registry (' + ids.length + ')');
  for (const id of ids) {
    const h = SK.holdSpec(id);
    assert.ok(POS.includes(h.pos), id + ' pos ' + h.pos);
    assert.ok(EDGE.includes(h.edge), id + ' edge ' + h.edge);
  }
});

test('holdSpec: each family where the real model put its switch (the W0 photos; R10 shared design, R11 Slim 3 on top)', () => {
  const by = (pred) => SK.SKINS.filter((s) => s.menus === 'click' && pred(s));
  const expect = (rows, pos, edge, why) => {
    assert.ok(rows.length > 0, 'fixture reaches ' + why);
    for (const s of rows) assert.deepStrictEqual(SK.holdSpec(s.id), { pos, edge }, s.id + ': ' + why);
  };
  expect(by((s) => s.look === 'original'), 'orig', 'chrome', 'the first iPod, top right');
  expect(by((s) => s.line === 'classic' && s.gen === 4), 'c4', 'chrome', 'the 4G, top right');
  expect(by((s) => s.line === 'classic' && s.gen === 5), 'std', 'chrome', 'the 5G, top left, chrome back');
  expect(by((s) => s.line === 'classic' && s.gen === 6), 'std', 'metal', 'the 6G, anodised front');
  expect(by((s) => s.line === 'mini'), 'mini', 'cap', 'the mini, end caps');
  expect(by((s) => s.line === 'nano' && s.gen === 1), 'std', 'chrome', 'nano 1G');
  expect(by((s) => s.line === 'nano' && s.gen === 2), 'slim2', 'cap', 'nano 2G');
  expect(by((s) => s.line === 'nano' && s.gen === 3), 'slim3', 'chrome', 'nano 3G drawn on top (R11)');
  expect(by((s) => s.line === 'nano' && s.gen === 4), 'slim4', 'cap', 'nano 4G');
  expect(by((s) => s.line === 'nano' && s.gen === 5), 'slim5', 'metal', 'nano 5G');
  expect(by((s) => s.line === 'nano' && s.gen >= 6), 'std', 'metal', 'nano 6G/7G had no switch: the shared design (R10)');
  expect(by((s) => s.line === 'shuffle'), 'std', 'metal', 'the shuffles had no switch: the shared design (R10)');
  expect(by((s) => s.line === 'touch' && s.gen <= 4), 'std', 'chrome', 'touch 1G/4G, chrome back (R10)');
  expect(by((s) => s.line === 'touch' && s.gen > 4), 'std', 'metal', 'touch 5G/6G, aluminium (R10)');
  expect(by((s) => s.line === 'custom'), 'std', 'chrome', 'the Custom 5G bodies');
  // the right-hand switches are exactly the two models that had one there
  const right = SK.clickColorways().filter((id) => ['orig', 'c4'].includes(SK.holdSpec(id).pos));
  assert.deepStrictEqual(right.sort(), by((s) => s.look === 'original' || (s.line === 'classic' && s.gen === 4)).map((s) => s.id).sort());
});

test('renderIpod: every Click colorway draws exactly ONE top edge carrying its spec; Cider and Nordic draw none', () => {
  const ctx = { track: { title: 'T', artist: 'A' }, posLabel: '0:00', remLabel: '-1:00' };
  for (const id of SK.clickColorways()) {
    const html = SK.renderFull(id, ctx);
    const tops = html.match(/<div class="ip-top"[^>]*>/g) || [];
    assert.strictEqual(tops.length, 1, id);
    const h = SK.holdSpec(id);
    assert.ok(tops[0].includes('data-hs-pos="' + h.pos + '"') && tops[0].includes('data-hs-edge="' + h.edge + '"'), id + ' ' + tops[0]);
    assert.strictEqual((html.match(/class="ip-edge"/g) || []).length, 1, id + ' one edge band');
  }
  for (const id of ['apple', 'spotify']) assert.ok(!/ip-top/.test(SK.renderFull(id, ctx)), id);
});

test('CSS: the cut reads the padding\'s own effective inset (turn-safe) and never drops under its minimum', () => {
  const css = readStyleCss();
  const rules = cssRules(css);
  const CHAIN = 'var(--mms-up-top, var(--pk-top-inset, env(safe-area-inset-top,0px)))';
  const cut = rules.filter((r) => /--ip-cut\s*:/.test(r.body));
  const portrait = cut.filter((r) => r.sel.trim() === ':where(html.is-phone) .mms-full.mms-ipod');
  assert.strictEqual(portrait.length, 1, cut.map((r) => r.sel).join(' | '));
  assert.ok(portrait[0].body.includes('--ip-cut:max(' + CHAIN + ', var(--pk-hold-strip-min))'), portrait[0].body);
  // the iPod's padding pads by the cut (where one is set), else by the same chain (the pop-out)
  const pad = rules.filter((r) => r.sel.trim() === ':where(html.is-phone, html.mms-popout) .mms-ipod' && /padding:/.test(r.body));
  assert.strictEqual(pad.length, 1);
  assert.ok(pad[0].body.includes('padding:calc(var(--ip-cut, ' + CHAIN + ') + var(--space-8))'), pad[0].body);
  // the Sideways layout: its cut is env() like the rest of that block, and its padding and row height read it
  const land = cut.filter((r) => /\.mms-full\.mms-ipod$/.test(r.sel.trim()) && r.sel.includes('pk-upright'));
  assert.strictEqual(land.length, 1, 'one landscape cut');
  assert.ok(land[0].body.includes('--ip-cut:max(env(safe-area-inset-top,0px), var(--pk-hold-strip-min))'), land[0].body);
  assert.match(land[0].at, /orientation: landscape/);
  // it FOLLOWS the portrait cut at equal specificity, so on a Sideways phone it is the one that applies
  assert.ok(land[0].index > portrait[0].index, 'the Sideways cut wins by order');
  // the D7 Sideways layout pads and sizes its row by the cut
  const d7 = rules.filter((r) => r.at.includes('orientation: landscape') && /--pkl-h:/.test(r.body));
  assert.strictEqual(d7.length, 1);
  assert.ok(/padding:calc\(var\(--ip-cut\) \+ var\(--pkl-pad-y\)\)/.test(d7[0].body), 'landscape top padding');
  assert.strictEqual((d7[0].body.match(/--pkl-h:calc\(100d?vh - var\(--ip-cut\)/g) || []).length, 2, 'both row-height spellings');
  // the minimum is a token (the knob above the edge stays on screen with no inset)
  assert.match(readTokensCss(), /--pk-hold-strip-min:\s*8px;/);
});

test('CSS: the strip shows only on the phone\'s full player; it paints black over the body with no z rung and takes no touch', () => {
  const rules = cssRules(readStyleCss());
  const hide = rules.filter((r) => r.sel.trim() === '.mms-ipod .ip-top');
  assert.strictEqual(hide.length, 1); assert.match(hide[0].body, /display:none/);
  const show = rules.filter((r) => r.sel.trim() === ':where(html.is-phone) .mms-full.mms-ipod .ip-top' && /display:/.test(r.body));
  assert.strictEqual(show.length, 1);
  for (const want of ['display:block', 'position:absolute', 'top:0', 'height:var(--ip-cut)', 'background:var(--mms-black)', 'pointer-events:none']) assert.ok(show[0].body.includes(want), want);
  assert.ok(!/z-index/.test(show[0].body), 'no z rung: DOM order paints it over the body');
  // the show rule outranks the hide rule (a class more), so it is the cascade, not file order, that shows it
  const edge = rules.filter((r) => /\.ip-edge$/.test(r.sel.trim()));
  assert.deepStrictEqual(edge.map((r) => (r.body.match(/background:([^;]+)/) || [])[1].trim()).sort(),
    ['var(--pk-hold-edge-cap)', 'var(--pk-hold-edge-chrome)', 'var(--pk-hold-edge-sheen), var(--pk-c-body-edge)'].sort());
});
