'use strict';

// [UNIT] The pocket design system (v1.332, plan docs/exec-plans/completed/2026-09-25-pocket-design-system.md).
// Every Click colorway draws ONE chassis that reads three token layers (--pk-<part> structure,
// --pk-fs-<role> type, --pk-c-<role> colorway roles). This file binds the system's rules in source
// (paint is jsdom-invisible; the rendered proof is scripts/pocket-render-probe.js):
//   AC4 - one colorway = ONE block of role tokens: every registry colorway (enumerated from the
//         registry, never a literal) has exactly one rule that sets EVERY role, no other rule sets a
//         role, and no other rule names a colorway class (the structural rules exist once);
//       - the colorway VALUES (the value authority for every colorway's palette);
//   AC5 - no raw sizes in the pocket rules: every size and font-size reads a structure or type token.
// Comments are stripped ONCE at read (the comment-porous lock lesson).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { unscopePocket } = require('../helpers/stylesheets.js'); // UI pass D7: the Pocket takeover's device-class scope

const ROOT = path.join(__dirname, '..', '..');
const RAW = unscopePocket(fs.readFileSync(path.join(ROOT, 'public', 'css', 'style.css'), 'utf8'));
const CSS = RAW.replace(/\/\*[\s\S]*?\*\//g, '');
const SK = require('../../public/js/music-skins.js');

// every style rule, flattened out of @media blocks: { sel, body, media }
function rules(src) {
  const out = [];
  let i = 0;
  const stack = [];
  let start = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '{') {
      const head = src.slice(start, i).trim();
      if (head.startsWith('@')) { stack.push(head); start = i + 1; i += 1; continue; }
      const end = src.indexOf('}', i);
      out.push({ sel: head, body: src.slice(i + 1, end), media: stack.join(' ') });
      i = end + 1; start = i; continue;
    }
    if (ch === '}') { stack.pop(); start = i + 1; }
    i += 1;
  }
  return out;
}
const ALL = rules(CSS);
const decls = (body) => [...body.matchAll(/([\w-]+)\s*:\s*([^;]+)(?:;|$)/g)].map((m) => [m[1].trim(), m[2].trim()]);

// The ONE role list a colorway sets (the plan's "colorway roles").
const ROLES = ['--pk-c-body', '--pk-c-body-edge', '--pk-c-wheel-1', '--pk-c-wheel-2', '--pk-c-wheel-sheen', '--pk-c-wheel-oy',
  '--pk-c-wheel-label', '--pk-c-center-1', '--pk-c-center-2', '--pk-c-center-oy',
  '--pk-c-lit-band', '--pk-c-lit-band2', '--pk-c-lits-band', '--pk-c-lits-band2', '--pk-c-lits-core',
  '--pk-c-lita-glow', '--pk-c-lita-core']; // v1.333 Ambient: the reflection's tint (an r,g,b triple read as rgba(var(role), a))
const clickIds = () => SK.SKINS.filter((s) => s.menus === 'click').map((s) => s.id);
const classOf = (id) => 'mms-' + id;

test('AC4: every registry colorway has EXACTLY ONE block that sets every role, and nothing else sets a role', () => {
  const ids = clickIds();
  assert.ok(ids.length >= 3 && ids.includes('ipod'), 'precondition: the registry lists the Click colorways (' + ids.join(', ') + ')');
  const roleRules = ALL.filter((r) => decls(r.body).some(([p]) => p.startsWith('--pk-c-')));
  for (const id of ids) {
    const blocks = roleRules.filter((r) => r.sel === '.' + classOf(id));
    assert.strictEqual(blocks.length, 1, id + ': exactly one role block (.' + classOf(id) + ')');
    const set = new Set(decls(blocks[0].body).map(([p]) => p));
    for (const role of ROLES) assert.ok(set.has(role), id + ' sets ' + role);
    for (const p of set) assert.ok(ROLES.includes(p), id + ': ' + p + ' is not a colorway role (a block holds roles only)');
  }
  const stray = roleRules.filter((r) => !ids.some((id) => r.sel === '.' + classOf(id)));
  assert.deepStrictEqual(stray.map((r) => r.sel), [], 'a role set outside a colorway block');
  // every role the chassis reads is one the blocks set (no dangling role)
  const read = new Set([...CSS.matchAll(/var\((--pk-c-[\w-]+)/g)].map((m) => m[1]));
  for (const r of read) assert.ok(ROLES.includes(r), 'the chassis reads ' + r + ', which no block sets');
  for (const r of ROLES) assert.ok(read.has(r), r + ' is set but never read (a dead role)');
});

// Gate r1 W2 (adversary, measured): the lock counted only rules that SET a role, so a second,
// role-free `.mms-ipod-red{ background:... }` and an attribute spelling `[class~="mms-ipod-red"]`
// both slipped past it. Now ANY mention of a colorway class in ANY selector (a class selector or an
// attribute selector naming it) other than its ONE block fails - and the block itself is one rule.
test('AC4: no rule but its own block names a colorway class, in any spelling - the structural rules exist ONCE', () => {
  const others = clickIds().filter((id) => id !== 'ipod').map(classOf);
  assert.ok(others.length >= 2, 'precondition: the non-default colorways');
  const names = (sel, cls) => new RegExp('(^|[^\\w-])' + cls + '(?![\\w-])').test(sel);
  const bad = [];
  for (const cls of others) {
    const hits = ALL.filter((r) => names(r.sel, cls));
    const blocks = hits.filter((r) => r.sel === '.' + cls);
    if (blocks.length !== 1) bad.push(cls + ': ' + blocks.length + ' rules with the bare selector (one block, no second rule)');
    for (const r of hits) if (r.sel !== '.' + cls) bad.push(r.sel);
  }
  assert.deepStrictEqual(bad, [], 'a colorway-specific rule outside its one block');
  // not vacuous: the two shapes the gate measured are caught
  assert.ok(names('[class~="mms-ipod-red"] .ip-wheel', 'mms-ipod-red') && names('.mms-ipod-red.mms-lit', 'mms-ipod-red'));
  assert.ok(!names('.mms-ipod-redder', 'mms-ipod-red'), 'a longer class is another class');
});

// The value authority for the colorways (the palettes that used to be --mms-ipodk-* / --mms-ipodm-*
// root tokens): every role of every colorway, byte-exact. Changing a value here is a RENDERING change.
const SHEEN_BODY = 'linear-gradient(146deg, var(--mms-ipod-sheen-a) 0%, var(--mms-ipod-sheen-b) 12%, var(--mms-ipod-sheen-0) 34%)';
const COLORWAYS = {
  ipod: {
    '--pk-c-body': 'linear-gradient(180deg, var(--mms-ipod-gloss-hi) 0%, var(--mms-ipod-sheen-0) 15%), radial-gradient(135% 90% at 50% 122%, var(--mms-ipod-gloss-shadow) 0%, transparent 55%), ' + SHEEN_BODY + ', radial-gradient(120% 60% at 85% 108%, var(--mms-ipod-sheen-c) 0%, var(--mms-ipod-sheen-0) 55%), linear-gradient(158deg, var(--mms-ipod-body1), var(--mms-ipod-body2))',
    '--pk-c-body-edge': 'var(--mms-ipod-edge)',
    '--pk-c-wheel-1': 'var(--mms-ipod-wheel1)', '--pk-c-wheel-2': 'var(--mms-ipod-wheel2)', '--pk-c-wheel-sheen': 'var(--mms-ipod-sheen-d)', '--pk-c-wheel-oy': '40%',
    '--pk-c-wheel-label': 'var(--mms-ipod-wheel-lbl)',
    '--pk-c-center-1': 'var(--mms-ipod-body1)', '--pk-c-center-2': 'var(--mms-ipod-body2)', '--pk-c-center-oy': '40%',
    '--pk-c-lit-band': 'var(--mms-lit-band)', '--pk-c-lit-band2': 'var(--mms-lit-band2)',
    '--pk-c-lits-band': 'var(--mms-lits-band)', '--pk-c-lits-band2': 'var(--mms-lits-band2)', '--pk-c-lits-core': 'var(--mms-lits-core)',
    '--pk-c-lita-glow': '255,255,255', '--pk-c-lita-core': '255,255,255',
  },
  'ipod-black': {
    '--pk-c-body': SHEEN_BODY + ', linear-gradient(158deg, #343436, #161618)',
    '--pk-c-body-edge': '#0a0a0b',
    '--pk-c-wheel-1': '#3d3d3f', '--pk-c-wheel-2': '#232325', '--pk-c-wheel-sheen': 'var(--mms-ipod-sheen-d)', '--pk-c-wheel-oy': '40%',
    '--pk-c-wheel-label': '#b9babd',
    '--pk-c-center-1': '#343436', '--pk-c-center-2': '#161618', '--pk-c-center-oy': '40%',
    '--pk-c-lit-band': 'rgba(255,255,255,.16)', '--pk-c-lit-band2': 'rgba(255,255,255,.09)',
    '--pk-c-lits-band': 'rgba(255,255,255,.26)', '--pk-c-lits-band2': 'rgba(255,255,255,.14)', '--pk-c-lits-core': 'rgba(255,255,255,.4)',
    '--pk-c-lita-glow': '165,170,182', '--pk-c-lita-core': '226,230,237',
  },
  'ipod-matte': {
    '--pk-c-body': 'linear-gradient(180deg, rgba(255,255,255,.26) 0, var(--mms-ipod-sheen-0) 2.2%), linear-gradient(90deg, rgba(0,0,0,.30) 0%, rgba(0,0,0,.04) 15%, var(--mms-ipod-clear) 30%, var(--mms-ipod-clear) 70%, rgba(0,0,0,.04) 85%, rgba(0,0,0,.30) 100%), linear-gradient(180deg, #949497 0%, #86868a 7%, #7a7a7e 40%, #6a6a70 55%, #4a4a50 74%, #2d2d32 90%, #1c1c21 100%)',
    '--pk-c-body-edge': '#0a0a0b',
    '--pk-c-wheel-1': '#343437', '--pk-c-wheel-2': '#242427', '--pk-c-wheel-sheen': 'rgba(255,255,255,.42)', '--pk-c-wheel-oy': '42%',
    '--pk-c-wheel-label': '#b9babd',
    '--pk-c-center-1': '#6e6e72', '--pk-c-center-2': '#55555a', '--pk-c-center-oy': '38%',
    '--pk-c-lit-band': 'rgba(255,255,255,.09)', '--pk-c-lit-band2': 'rgba(255,255,255,.05)',
    '--pk-c-lits-band': 'rgba(255,255,255,.14)', '--pk-c-lits-band2': 'rgba(255,255,255,.08)', '--pk-c-lits-core': 'rgba(255,255,255,.22)',
    '--pk-c-lita-glow': '130,133,140', '--pk-c-lita-core': '165,168,176',
  },
  // v1.332 (D2): sampled from Commons "Product Red iPod nano.jpg" - the side-by-side cites every value
  'ipod-red': {
    '--pk-c-body': 'linear-gradient(180deg, rgba(255,255,255,.22) 0, var(--mms-ipod-sheen-0) 1.8%), linear-gradient(90deg, rgba(0,0,0,.24) 0%, rgba(0,0,0,.06) 14%, var(--mms-ipod-clear) 30%, var(--mms-ipod-clear) 58%, rgba(255,255,255,.1) 78%, var(--mms-ipod-clear) 90%, rgba(0,0,0,.16) 100%), linear-gradient(180deg, #ee2b3e 0%, #e82639 30%, #e02031 60%, #d4192b 82%, #c41424 100%)',
    '--pk-c-body-edge': '#8e0e18',
    '--pk-c-wheel-1': '#f7f9f8', '--pk-c-wheel-2': '#e5e9e7', '--pk-c-wheel-sheen': 'var(--mms-ipod-sheen-d)', '--pk-c-wheel-oy': '40%',
    '--pk-c-wheel-label': '#c4cfcf',
    '--pk-c-center-1': '#f6475d', '--pk-c-center-2': '#ea3348', '--pk-c-center-oy': '38%',
    '--pk-c-lit-band': 'rgba(255,255,255,.2)', '--pk-c-lit-band2': 'rgba(255,255,255,.12)',
    '--pk-c-lits-band': 'rgba(255,255,255,.3)', '--pk-c-lits-band2': 'rgba(255,255,255,.17)', '--pk-c-lits-core': 'rgba(255,255,255,.45)',
    '--pk-c-lita-glow': '255,96,110', '--pk-c-lita-core': '255,200,204',
  },
  // v1.332 (D8): each sampled from its reference photo - the side-by-sides cite every value
  'ipod-silver': {
    '--pk-c-body': 'linear-gradient(180deg, rgba(0,0,0,.2) 0%, var(--mms-ipod-clear) 10%, var(--mms-ipod-clear) 88%, rgba(0,0,0,.2) 100%), linear-gradient(98deg, #dcdcdf 0%, #c4c5c7 17%, #9d9da0 44%, #838386 66%, #747477 86%, #8a8a8d 100%)',
    '--pk-c-body-edge': '#5a5a5d',
    '--pk-c-wheel-1': '#d3d3d2', '--pk-c-wheel-2': '#c4c4c2', '--pk-c-wheel-sheen': 'var(--mms-ipod-sheen-d)', '--pk-c-wheel-oy': '40%',
    '--pk-c-wheel-label': '#7b7f82',
    '--pk-c-center-1': '#a2a0a4', '--pk-c-center-2': '#8a898c', '--pk-c-center-oy': '38%',
    '--pk-c-lit-band': 'rgba(255,255,255,.26)', '--pk-c-lit-band2': 'rgba(255,255,255,.15)',
    '--pk-c-lits-band': 'rgba(255,255,255,.36)', '--pk-c-lits-band2': 'rgba(255,255,255,.2)', '--pk-c-lits-core': 'rgba(255,255,255,.5)',
    '--pk-c-lita-glow': '250,250,252', '--pk-c-lita-core': '255,255,255',
  },
  'ipod-encore': {
    '--pk-c-body': 'linear-gradient(146deg, var(--mms-ipod-sheen-a) 0%, var(--mms-ipod-sheen-b) 12%, var(--mms-ipod-sheen-0) 34%), linear-gradient(158deg, #343436, #161618)',
    '--pk-c-body-edge': '#0a0a0b',
    '--pk-c-wheel-1': '#c4505f', '--pk-c-wheel-2': '#a63f4e', '--pk-c-wheel-sheen': 'var(--mms-ipod-sheen-d)', '--pk-c-wheel-oy': '40%',
    '--pk-c-wheel-label': '#efe8eb',
    '--pk-c-center-1': '#2e2527', '--pk-c-center-2': '#161113', '--pk-c-center-oy': '40%',
    '--pk-c-lit-band': 'rgba(255,255,255,.16)', '--pk-c-lit-band2': 'rgba(255,255,255,.09)',
    '--pk-c-lits-band': 'rgba(255,255,255,.26)', '--pk-c-lits-band2': 'rgba(255,255,255,.14)', '--pk-c-lits-core': 'rgba(255,255,255,.4)',
    '--pk-c-lita-glow': '165,170,182', '--pk-c-lita-core': '226,230,237',
  },
  'ipod-blue': {
    '--pk-c-body': 'linear-gradient(180deg, rgba(255,255,255,.3) 0, var(--mms-ipod-sheen-0) 1.6%), linear-gradient(90deg, rgba(0,0,0,.3) 0%, rgba(0,0,0,.06) 12%, var(--mms-ipod-clear) 26%, var(--mms-ipod-clear) 74%, rgba(0,0,0,.06) 88%, rgba(0,0,0,.3) 100%), linear-gradient(180deg, #62c1df 0%, #4fb0cb 18%, #45a7c0 40%, #3e96ab 50%, #2f7a90 68%, #245a6a 85%, #1d4654 100%)',
    '--pk-c-body-edge': '#123140',
    '--pk-c-wheel-1': '#d3d3d2', '--pk-c-wheel-2': '#c4c4c2', '--pk-c-wheel-sheen': 'var(--mms-ipod-sheen-d)', '--pk-c-wheel-oy': '40%',
    '--pk-c-wheel-label': '#5ca3b1',
    '--pk-c-center-1': '#d3d3d2', '--pk-c-center-2': '#c4c4c2', '--pk-c-center-oy': '38%',
    '--pk-c-lit-band': 'rgba(255,255,255,.16)', '--pk-c-lit-band2': 'rgba(255,255,255,.09)',
    '--pk-c-lits-band': 'rgba(255,255,255,.24)', '--pk-c-lits-band2': 'rgba(255,255,255,.13)', '--pk-c-lits-core': 'rgba(255,255,255,.36)',
    '--pk-c-lita-glow': '120,208,232', '--pk-c-lita-core': '200,238,248',
  },
  'ipod-green': {
    '--pk-c-body': 'linear-gradient(180deg, rgba(255,255,255,.26) 0, var(--mms-ipod-sheen-0) 1.6%), linear-gradient(90deg, rgba(0,0,0,.28) 0%, rgba(0,0,0,.06) 12%, var(--mms-ipod-clear) 26%, var(--mms-ipod-clear) 74%, rgba(0,0,0,.06) 88%, rgba(0,0,0,.28) 100%), linear-gradient(180deg, #5d8c4e 0%, #568649 25%, #4d7c44 50%, #467541 75%, #3f703d 100%)',
    '--pk-c-body-edge': '#2b4f29',
    '--pk-c-wheel-1': '#d3d3d2', '--pk-c-wheel-2': '#c4c4c2', '--pk-c-wheel-sheen': 'var(--mms-ipod-sheen-d)', '--pk-c-wheel-oy': '40%',
    '--pk-c-wheel-label': '#3e9557',
    '--pk-c-center-1': '#d3d3d2', '--pk-c-center-2': '#c4c4c2', '--pk-c-center-oy': '38%',
    '--pk-c-lit-band': 'rgba(255,255,255,.14)', '--pk-c-lit-band2': 'rgba(255,255,255,.08)',
    '--pk-c-lits-band': 'rgba(255,255,255,.22)', '--pk-c-lits-band2': 'rgba(255,255,255,.12)', '--pk-c-lits-core': 'rgba(255,255,255,.34)',
    '--pk-c-lita-glow': '140,190,120', '--pk-c-lita-core': '190,225,176',
  },
  'ipod-pink': {
    '--pk-c-body': 'linear-gradient(180deg, rgba(255,255,255,.28) 0, var(--mms-ipod-sheen-0) 1.6%), linear-gradient(90deg, rgba(0,0,0,.28) 0%, rgba(0,0,0,.06) 12%, var(--mms-ipod-clear) 26%, var(--mms-ipod-clear) 74%, rgba(0,0,0,.06) 88%, rgba(0,0,0,.28) 100%), linear-gradient(180deg, #9e5a73 0%, #8f4c64 25%, #824153 50%, #763849 75%, #652430 100%)',
    '--pk-c-body-edge': '#4a1522',
    '--pk-c-wheel-1': '#d3d3d2', '--pk-c-wheel-2': '#c4c4c2', '--pk-c-wheel-sheen': 'var(--mms-ipod-sheen-d)', '--pk-c-wheel-oy': '40%',
    '--pk-c-wheel-label': '#9e5a73',
    '--pk-c-center-1': '#d3d3d2', '--pk-c-center-2': '#c4c4c2', '--pk-c-center-oy': '38%',
    '--pk-c-lit-band': 'rgba(255,255,255,.16)', '--pk-c-lit-band2': 'rgba(255,255,255,.09)',
    '--pk-c-lits-band': 'rgba(255,255,255,.24)', '--pk-c-lits-band2': 'rgba(255,255,255,.13)', '--pk-c-lits-core': 'rgba(255,255,255,.36)',
    '--pk-c-lita-glow': '220,138,168', '--pk-c-lita-core': '240,190,210',
  },
  // v1.335: the twelve more colorways, each sampled from its reference photo (the plan's Research table cites every value)
  'ipod-frost': {
    '--pk-c-body': 'linear-gradient(180deg, rgba(255,255,255,.34) 0, var(--mms-ipod-sheen-0) 1.6%), linear-gradient(90deg, rgba(0,0,0,.22) 0%, rgba(0,0,0,.06) 12%, var(--mms-ipod-clear) 26%, var(--mms-ipod-clear) 74%, rgba(0,0,0,.06) 88%, rgba(0,0,0,.22) 100%), linear-gradient(180deg, #cfd0d4 0%, #c3c5c9 20%, #b2b4b9 45%, #9fa2a8 70%, #8a8b90 100%)',
    '--pk-c-body-edge': '#6c6d72',
    '--pk-c-wheel-1': '#d3d3d2', '--pk-c-wheel-2': '#c4c4c2', '--pk-c-wheel-sheen': 'var(--mms-ipod-sheen-d)', '--pk-c-wheel-oy': '40%',
    '--pk-c-wheel-label': '#9b9ba2',
    '--pk-c-center-1': '#d3d3d2', '--pk-c-center-2': '#c4c4c2', '--pk-c-center-oy': '38%',
    '--pk-c-lit-band': 'rgba(255,255,255,.24)', '--pk-c-lit-band2': 'rgba(255,255,255,.14)',
    '--pk-c-lits-band': 'rgba(255,255,255,.34)', '--pk-c-lits-band2': 'rgba(255,255,255,.19)', '--pk-c-lits-core': 'rgba(255,255,255,.48)',
    '--pk-c-lita-glow': '240,242,246', '--pk-c-lita-core': '255,255,255',
  },
  'ipod-sky': {
    '--pk-c-body': 'linear-gradient(180deg, rgba(255,255,255,.28) 0, var(--mms-ipod-sheen-0) 1.6%), linear-gradient(90deg, rgba(0,0,0,.28) 0%, rgba(0,0,0,.06) 12%, var(--mms-ipod-clear) 26%, var(--mms-ipod-clear) 74%, rgba(0,0,0,.06) 88%, rgba(0,0,0,.28) 100%), linear-gradient(180deg, #a6dbea 0%, #98cfe0 25%, #88bfd0 50%, #77aebf 75%, #6397a8 100%)',
    '--pk-c-body-edge': '#3f6e7c',
    '--pk-c-wheel-1': '#d3d3d2', '--pk-c-wheel-2': '#c4c4c2', '--pk-c-wheel-sheen': 'var(--mms-ipod-sheen-d)', '--pk-c-wheel-oy': '40%',
    '--pk-c-wheel-label': '#86898c',
    '--pk-c-center-1': '#d3d3d2', '--pk-c-center-2': '#c4c4c2', '--pk-c-center-oy': '38%',
    '--pk-c-lit-band': 'rgba(255,255,255,.16)', '--pk-c-lit-band2': 'rgba(255,255,255,.09)',
    '--pk-c-lits-band': 'rgba(255,255,255,.24)', '--pk-c-lits-band2': 'rgba(255,255,255,.13)', '--pk-c-lits-core': 'rgba(255,255,255,.36)',
    '--pk-c-lita-glow': '170,225,240', '--pk-c-lita-core': '215,242,250',
  },
  'ipod-olive': {
    '--pk-c-body': 'linear-gradient(180deg, rgba(255,255,255,.28) 0, var(--mms-ipod-sheen-0) 1.6%), linear-gradient(90deg, rgba(0,0,0,.28) 0%, rgba(0,0,0,.06) 12%, var(--mms-ipod-clear) 26%, var(--mms-ipod-clear) 74%, rgba(0,0,0,.06) 88%, rgba(0,0,0,.28) 100%), linear-gradient(180deg, #8ca24a 0%, #81963f 25%, #768a36 50%, #65782a 75%, #4d5c16 100%)',
    '--pk-c-body-edge': '#36420b',
    '--pk-c-wheel-1': '#d3d3d2', '--pk-c-wheel-2': '#c4c4c2', '--pk-c-wheel-sheen': 'var(--mms-ipod-sheen-d)', '--pk-c-wheel-oy': '40%',
    '--pk-c-wheel-label': '#8b938d',
    '--pk-c-center-1': '#d3d3d2', '--pk-c-center-2': '#c4c4c2', '--pk-c-center-oy': '38%',
    '--pk-c-lit-band': 'rgba(255,255,255,.16)', '--pk-c-lit-band2': 'rgba(255,255,255,.09)',
    '--pk-c-lits-band': 'rgba(255,255,255,.24)', '--pk-c-lits-band2': 'rgba(255,255,255,.13)', '--pk-c-lits-core': 'rgba(255,255,255,.36)',
    '--pk-c-lita-glow': '175,200,110', '--pk-c-lita-core': '215,230,170',
  },
  'ipod-blush': {
    '--pk-c-body': 'linear-gradient(180deg, rgba(255,255,255,.28) 0, var(--mms-ipod-sheen-0) 1.6%), linear-gradient(90deg, rgba(0,0,0,.28) 0%, rgba(0,0,0,.06) 12%, var(--mms-ipod-clear) 26%, var(--mms-ipod-clear) 74%, rgba(0,0,0,.06) 88%, rgba(0,0,0,.28) 100%), linear-gradient(180deg, #d6a2ab 0%, #c5909b 25%, #b0808b 50%, #a27280 75%, #8a5d6c 100%)',
    '--pk-c-body-edge': '#6a4251',
    '--pk-c-wheel-1': '#d3d3d2', '--pk-c-wheel-2': '#c4c4c2', '--pk-c-wheel-sheen': 'var(--mms-ipod-sheen-d)', '--pk-c-wheel-oy': '40%',
    '--pk-c-wheel-label': '#969493',
    '--pk-c-center-1': '#d3d3d2', '--pk-c-center-2': '#c4c4c2', '--pk-c-center-oy': '38%',
    '--pk-c-lit-band': 'rgba(255,255,255,.16)', '--pk-c-lit-band2': 'rgba(255,255,255,.09)',
    '--pk-c-lits-band': 'rgba(255,255,255,.24)', '--pk-c-lits-band2': 'rgba(255,255,255,.13)', '--pk-c-lits-core': 'rgba(255,255,255,.36)',
    '--pk-c-lita-glow': '235,170,185', '--pk-c-lita-core': '248,210,220',
  },
  'ipod-2004': {
    '--pk-c-body': 'linear-gradient(180deg, var(--mms-ipod-gloss-hi) 0%, var(--mms-ipod-sheen-0) 15%), radial-gradient(135% 90% at 50% 122%, var(--mms-ipod-gloss-shadow) 0%, transparent 55%), linear-gradient(146deg, var(--mms-ipod-sheen-a) 0%, var(--mms-ipod-sheen-b) 12%, var(--mms-ipod-sheen-0) 34%), linear-gradient(158deg, #ffffff, #eeeef0)',
    '--pk-c-body-edge': '#c8c8cc',
    '--pk-c-wheel-1': '#cfd0d6', '--pk-c-wheel-2': '#bdbec4', '--pk-c-wheel-sheen': 'var(--mms-ipod-sheen-d)', '--pk-c-wheel-oy': '40%',
    '--pk-c-wheel-label': '#efeeee',
    '--pk-c-center-1': '#ffffff', '--pk-c-center-2': '#eeeef0', '--pk-c-center-oy': '40%',
    '--pk-c-lit-band': 'var(--mms-lit-band)', '--pk-c-lit-band2': 'var(--mms-lit-band2)',
    '--pk-c-lits-band': 'var(--mms-lits-band)', '--pk-c-lits-band2': 'var(--mms-lits-band2)', '--pk-c-lits-core': 'var(--mms-lits-core)',
    '--pk-c-lita-glow': '255,255,255', '--pk-c-lita-core': '255,255,255',
  },
  'ipod-charcoal': {
    '--pk-c-body': 'linear-gradient(180deg, rgba(255,255,255,.2) 0, var(--mms-ipod-sheen-0) 2%), linear-gradient(90deg, rgba(0,0,0,.3) 0%, rgba(0,0,0,.06) 12%, var(--mms-ipod-clear) 26%, var(--mms-ipod-clear) 74%, rgba(0,0,0,.06) 88%, rgba(0,0,0,.3) 100%), linear-gradient(180deg, #666668 0%, #5a5a5c 25%, #505052 50%, #414143 75%, #2e2e2f 100%)',
    '--pk-c-body-edge': '#161617',
    '--pk-c-wheel-1': '#343434', '--pk-c-wheel-2': '#262626', '--pk-c-wheel-sheen': 'rgba(255,255,255,.3)', '--pk-c-wheel-oy': '40%',
    '--pk-c-wheel-label': '#e4e4e6',
    '--pk-c-center-1': '#525254', '--pk-c-center-2': '#404042', '--pk-c-center-oy': '38%',
    '--pk-c-lit-band': 'rgba(255,255,255,.1)', '--pk-c-lit-band2': 'rgba(255,255,255,.06)',
    '--pk-c-lits-band': 'rgba(255,255,255,.16)', '--pk-c-lits-band2': 'rgba(255,255,255,.09)', '--pk-c-lits-core': 'rgba(255,255,255,.24)',
    '--pk-c-lita-glow': '140,142,148', '--pk-c-lita-core': '180,182,188',
  },
  'ipod-violet': {
    '--pk-c-body': 'linear-gradient(180deg, rgba(255,255,255,.3) 0, var(--mms-ipod-sheen-0) 1.6%), linear-gradient(90deg, rgba(0,0,0,.26) 0%, rgba(0,0,0,.06) 12%, var(--mms-ipod-clear) 26%, var(--mms-ipod-clear) 74%, rgba(0,0,0,.06) 88%, rgba(0,0,0,.26) 100%), linear-gradient(180deg, #8c70ea 0%, #7e63e0 30%, #7057d2 60%, #6049bc 85%, #503ca4 100%)',
    '--pk-c-body-edge': '#33256e',
    '--pk-c-wheel-1': '#f3f4f3', '--pk-c-wheel-2': '#e3e5e4', '--pk-c-wheel-sheen': 'var(--mms-ipod-sheen-d)', '--pk-c-wheel-oy': '40%',
    '--pk-c-wheel-label': '#b0b3b8',
    '--pk-c-center-1': '#7a60dc', '--pk-c-center-2': '#6049bc', '--pk-c-center-oy': '38%',
    '--pk-c-lit-band': 'rgba(255,255,255,.16)', '--pk-c-lit-band2': 'rgba(255,255,255,.09)',
    '--pk-c-lits-band': 'rgba(255,255,255,.24)', '--pk-c-lits-band2': 'rgba(255,255,255,.13)', '--pk-c-lits-core': 'rgba(255,255,255,.36)',
    '--pk-c-lita-glow': '150,120,240', '--pk-c-lita-core': '210,195,250',
  },
  'ipod-yellow': {
    '--pk-c-body': 'linear-gradient(180deg, rgba(255,255,255,.34) 0, var(--mms-ipod-sheen-0) 1.6%), linear-gradient(90deg, rgba(0,0,0,.2) 0%, rgba(0,0,0,.06) 12%, var(--mms-ipod-clear) 26%, var(--mms-ipod-clear) 74%, rgba(0,0,0,.06) 88%, rgba(0,0,0,.2) 100%), linear-gradient(180deg, #f2e852 0%, #ece23c 30%, #e2d632 60%, #d2c42a 85%, #bcad22 100%)',
    '--pk-c-body-edge': '#7a6e10',
    '--pk-c-wheel-1': '#f3f4f3', '--pk-c-wheel-2': '#e3e5e4', '--pk-c-wheel-sheen': 'var(--mms-ipod-sheen-d)', '--pk-c-wheel-oy': '40%',
    '--pk-c-wheel-label': '#a9acae',
    '--pk-c-center-1': '#eadf3a', '--pk-c-center-2': '#d4c62c', '--pk-c-center-oy': '38%',
    '--pk-c-lit-band': 'rgba(255,255,255,.16)', '--pk-c-lit-band2': 'rgba(255,255,255,.09)',
    '--pk-c-lits-band': 'rgba(255,255,255,.24)', '--pk-c-lits-band2': 'rgba(255,255,255,.13)', '--pk-c-lits-core': 'rgba(255,255,255,.36)',
    '--pk-c-lita-glow': '245,230,90', '--pk-c-lita-core': '252,245,180',
  },
  'ipod-lime': {
    '--pk-c-body': 'linear-gradient(180deg, rgba(255,255,255,.3) 0, var(--mms-ipod-sheen-0) 1.6%), linear-gradient(90deg, rgba(0,0,0,.22) 0%, rgba(0,0,0,.06) 12%, var(--mms-ipod-clear) 26%, var(--mms-ipod-clear) 74%, rgba(0,0,0,.06) 88%, rgba(0,0,0,.22) 100%), linear-gradient(180deg, #c6e878 0%, #bddf70 30%, #b2d467 60%, #a2c35a 85%, #8fae4b 100%)',
    '--pk-c-body-edge': '#5f7a2a',
    '--pk-c-wheel-1': '#f3f4f3', '--pk-c-wheel-2': '#e3e5e4', '--pk-c-wheel-sheen': 'var(--mms-ipod-sheen-d)', '--pk-c-wheel-oy': '40%',
    '--pk-c-wheel-label': '#a9b2b8',
    '--pk-c-center-1': '#b4d468', '--pk-c-center-2': '#a2c25a', '--pk-c-center-oy': '38%',
    '--pk-c-lit-band': 'rgba(255,255,255,.16)', '--pk-c-lit-band2': 'rgba(255,255,255,.09)',
    '--pk-c-lits-band': 'rgba(255,255,255,.24)', '--pk-c-lits-band2': 'rgba(255,255,255,.13)', '--pk-c-lits-core': 'rgba(255,255,255,.36)',
    '--pk-c-lita-glow': '190,230,110', '--pk-c-lita-core': '225,245,185',
  },
  'ipod-cobalt': {
    '--pk-c-body': 'linear-gradient(180deg, rgba(255,255,255,.3) 0, var(--mms-ipod-sheen-0) 1.6%), linear-gradient(90deg, rgba(0,0,0,.26) 0%, rgba(0,0,0,.06) 12%, var(--mms-ipod-clear) 26%, var(--mms-ipod-clear) 74%, rgba(0,0,0,.06) 88%, rgba(0,0,0,.26) 100%), linear-gradient(180deg, #1a86dc 0%, #0e70c6 25%, #0862b4 50%, #0556a4 75%, #034890 100%)',
    '--pk-c-body-edge': '#02325f',
    '--pk-c-wheel-1': '#f3f4f3', '--pk-c-wheel-2': '#e3e5e4', '--pk-c-wheel-sheen': 'var(--mms-ipod-sheen-d)', '--pk-c-wheel-oy': '40%',
    '--pk-c-wheel-label': '#9a9fa0',
    '--pk-c-center-1': '#1266bc', '--pk-c-center-2': '#044e9f', '--pk-c-center-oy': '38%',
    '--pk-c-lit-band': 'rgba(255,255,255,.16)', '--pk-c-lit-band2': 'rgba(255,255,255,.09)',
    '--pk-c-lits-band': 'rgba(255,255,255,.24)', '--pk-c-lits-band2': 'rgba(255,255,255,.13)', '--pk-c-lits-core': 'rgba(255,255,255,.36)',
    '--pk-c-lita-glow': '60,150,240', '--pk-c-lita-core': '170,210,250',
  },
  'ipod-magenta': {
    '--pk-c-body': 'linear-gradient(180deg, rgba(255,255,255,.3) 0, var(--mms-ipod-sheen-0) 1.6%), linear-gradient(90deg, rgba(0,0,0,.26) 0%, rgba(0,0,0,.06) 12%, var(--mms-ipod-clear) 26%, var(--mms-ipod-clear) 74%, rgba(0,0,0,.06) 88%, rgba(0,0,0,.26) 100%), linear-gradient(180deg, #d8309a 0%, #cc1f8a 30%, #c21780 60%, #b01272 85%, #980d62 100%)',
    '--pk-c-body-edge': '#650842',
    '--pk-c-wheel-1': '#f3f4f3', '--pk-c-wheel-2': '#e3e5e4', '--pk-c-wheel-sheen': 'var(--mms-ipod-sheen-d)', '--pk-c-wheel-oy': '40%',
    '--pk-c-wheel-label': '#b0b3b3',
    '--pk-c-center-1': '#cc1d88', '--pk-c-center-2': '#b21274', '--pk-c-center-oy': '38%',
    '--pk-c-lit-band': 'rgba(255,255,255,.16)', '--pk-c-lit-band2': 'rgba(255,255,255,.09)',
    '--pk-c-lits-band': 'rgba(255,255,255,.24)', '--pk-c-lits-band2': 'rgba(255,255,255,.13)', '--pk-c-lits-core': 'rgba(255,255,255,.36)',
    '--pk-c-lita-glow': '235,90,175', '--pk-c-lita-core': '250,185,225',
  },
  'ipod-raspberry': {
    '--pk-c-body': 'linear-gradient(180deg, rgba(255,255,255,.3) 0, var(--mms-ipod-sheen-0) 1.6%), linear-gradient(90deg, rgba(0,0,0,.26) 0%, rgba(0,0,0,.06) 12%, var(--mms-ipod-clear) 26%, var(--mms-ipod-clear) 74%, rgba(0,0,0,.06) 88%, rgba(0,0,0,.26) 100%), linear-gradient(180deg, #d8416f 0%, #c93563 25%, #b82a55 50%, #a02246 75%, #861b39 100%)',
    '--pk-c-body-edge': '#5a1024',
    '--pk-c-wheel-1': '#f3f4f3', '--pk-c-wheel-2': '#e3e5e4', '--pk-c-wheel-sheen': 'var(--mms-ipod-sheen-d)', '--pk-c-wheel-oy': '40%',
    '--pk-c-wheel-label': '#b6b5b7',
    '--pk-c-center-1': '#d23870', '--pk-c-center-2': '#b82a5a', '--pk-c-center-oy': '38%',
    '--pk-c-lit-band': 'rgba(255,255,255,.16)', '--pk-c-lit-band2': 'rgba(255,255,255,.09)',
    '--pk-c-lits-band': 'rgba(255,255,255,.24)', '--pk-c-lits-band2': 'rgba(255,255,255,.13)', '--pk-c-lits-core': 'rgba(255,255,255,.36)',
    '--pk-c-lita-glow': '235,90,130', '--pk-c-lita-core': '250,180,200',
  },
  // v1.335 (D9-D12): the Original's COLORS (its structure is the look section; pocket-original-look.test.js)
  'ipod-original': {
    '--pk-c-body': 'linear-gradient(180deg, var(--mms-ipod-gloss-hi) 0%, var(--mms-ipod-sheen-0) 15%), radial-gradient(135% 90% at 50% 122%, var(--mms-ipod-gloss-shadow) 0%, transparent 55%), linear-gradient(146deg, var(--mms-ipod-sheen-a) 0%, var(--mms-ipod-sheen-b) 12%, var(--mms-ipod-sheen-0) 34%), linear-gradient(158deg, #fafafa, #e4e4e4)',
    '--pk-c-body-edge': '#c4c4c4',
    '--pk-c-wheel-1': '#f6f6f6',
    '--pk-c-wheel-2': '#e6e6e6',
    '--pk-c-wheel-sheen': 'var(--mms-ipod-sheen-d)',
    '--pk-c-wheel-oy': '40%',
    '--pk-c-wheel-label': '#a4a4a4',
    '--pk-c-center-1': '#fdfdfd',
    '--pk-c-center-2': '#ececec',
    '--pk-c-center-oy': '40%',
    '--pk-c-lit-band': 'var(--mms-lit-band)',
    '--pk-c-lit-band2': 'var(--mms-lit-band2)',
    '--pk-c-lits-band': 'var(--mms-lits-band)',
    '--pk-c-lits-band2': 'var(--mms-lits-band2)',
    '--pk-c-lits-core': 'var(--mms-lits-core)',
    '--pk-c-lita-glow': '255,255,255',
    '--pk-c-lita-core': '255,255,255',
  },
  // v1.345 (iPod true-up, Dean 2026-09-29): the 27 new colorways and the retuned Mini 1G Gold, pinned byte-exact from the plan's payload blocks (roles-new.css, role-gold.css).
  'ipod-nano3-silver': {
    '--pk-c-body': 'linear-gradient(180deg, rgba(255,255,255,.3) 0, var(--mms-ipod-sheen-0) 1.6%), linear-gradient(90deg, rgba(0,0,0,.24) 0%, rgba(0,0,0,.06) 12%, var(--mms-ipod-clear) 26%, var(--mms-ipod-clear) 74%, rgba(0,0,0,.06) 88%, rgba(0,0,0,.24) 100%), linear-gradient(180deg, #c3c7c9 0%, #b6babd 30%, #a9adb1 60%, #999ea2 85%, #888f94 100%)',
    '--pk-c-body-edge': '#5e6468',
    '--pk-c-wheel-1': '#f3f4f3',
    '--pk-c-wheel-2': '#e3e5e4',
    '--pk-c-wheel-sheen': 'var(--mms-ipod-sheen-d)',
    '--pk-c-wheel-oy': '40%',
    '--pk-c-wheel-label': '#b0b3b8',
    '--pk-c-center-1': '#b1b5b8',
    '--pk-c-center-2': '#969ca0',
    '--pk-c-center-oy': '38%',
    '--pk-c-lit-band': 'rgba(255,255,255,.16)',
    '--pk-c-lit-band2': 'rgba(255,255,255,.09)',
    '--pk-c-lits-band': 'rgba(255,255,255,.24)',
    '--pk-c-lits-band2': 'rgba(255,255,255,.13)',
    '--pk-c-lits-core': 'rgba(255,255,255,.36)',
    '--pk-c-lita-glow': '214,216,218',
    '--pk-c-lita-core': '239,239,240',
  },
  'ipod-nano3-blue': {
    '--pk-c-body': 'linear-gradient(180deg, rgba(255,255,255,.3) 0, var(--mms-ipod-sheen-0) 1.6%), linear-gradient(90deg, rgba(0,0,0,.24) 0%, rgba(0,0,0,.06) 12%, var(--mms-ipod-clear) 26%, var(--mms-ipod-clear) 74%, rgba(0,0,0,.06) 88%, rgba(0,0,0,.24) 100%), linear-gradient(180deg, #88babd 0%, #78b0b4 30%, #68a6ab 60%, #57989d 85%, #4c8589 100%)',
    '--pk-c-body-edge': '#2d4f51',
    '--pk-c-wheel-1': '#f3f4f3',
    '--pk-c-wheel-2': '#e3e5e4',
    '--pk-c-wheel-sheen': 'var(--mms-ipod-sheen-d)',
    '--pk-c-wheel-oy': '40%',
    '--pk-c-wheel-label': '#b0b3b8',
    '--pk-c-center-1': '#71acb0',
    '--pk-c-center-2': '#55959a',
    '--pk-c-center-oy': '38%',
    '--pk-c-lit-band': 'rgba(255,255,255,.16)',
    '--pk-c-lit-band2': 'rgba(255,255,255,.09)',
    '--pk-c-lits-band': 'rgba(255,255,255,.24)',
    '--pk-c-lits-band2': 'rgba(255,255,255,.13)',
    '--pk-c-lits-core': 'rgba(255,255,255,.36)',
    '--pk-c-lita-glow': '159,199,202',
    '--pk-c-lita-core': '217,233,234',
  },
  'ipod-nano3-green': {
    '--pk-c-body': 'linear-gradient(180deg, rgba(255,255,255,.3) 0, var(--mms-ipod-sheen-0) 1.6%), linear-gradient(90deg, rgba(0,0,0,.24) 0%, rgba(0,0,0,.06) 12%, var(--mms-ipod-clear) 26%, var(--mms-ipod-clear) 74%, rgba(0,0,0,.06) 88%, rgba(0,0,0,.24) 100%), linear-gradient(180deg, #90bc99 0%, #80b28a 30%, #70a87b 60%, #5e9c6b 85%, #53895e 100%)',
    '--pk-c-body-edge': '#325339',
    '--pk-c-wheel-1': '#f3f4f3',
    '--pk-c-wheel-2': '#e3e5e4',
    '--pk-c-wheel-sheen': 'var(--mms-ipod-sheen-d)',
    '--pk-c-wheel-oy': '40%',
    '--pk-c-wheel-label': '#b0b3b8',
    '--pk-c-center-1': '#7aae84',
    '--pk-c-center-2': '#5c9868',
    '--pk-c-center-oy': '38%',
    '--pk-c-lit-band': 'rgba(255,255,255,.16)',
    '--pk-c-lit-band2': 'rgba(255,255,255,.09)',
    '--pk-c-lits-band': 'rgba(255,255,255,.24)',
    '--pk-c-lits-band2': 'rgba(255,255,255,.13)',
    '--pk-c-lits-core': 'rgba(255,255,255,.36)',
    '--pk-c-lita-glow': '166,201,173',
    '--pk-c-lita-core': '219,233,222',
  },
  'ipod-nano3-red': {
    '--pk-c-body': 'linear-gradient(180deg, rgba(255,255,255,.3) 0, var(--mms-ipod-sheen-0) 1.6%), linear-gradient(90deg, rgba(0,0,0,.24) 0%, rgba(0,0,0,.06) 12%, var(--mms-ipod-clear) 26%, var(--mms-ipod-clear) 74%, rgba(0,0,0,.06) 88%, rgba(0,0,0,.24) 100%), linear-gradient(180deg, #9a2d45 0%, #86273c 30%, #722133 60%, #5b1a29 85%, #43131e 100%)',
    '--pk-c-body-edge': '#000000',
    '--pk-c-wheel-1': '#f3f4f3',
    '--pk-c-wheel-2': '#e3e5e4',
    '--pk-c-wheel-sheen': 'var(--mms-ipod-sheen-d)',
    '--pk-c-wheel-oy': '40%',
    '--pk-c-wheel-label': '#b0b3b8',
    '--pk-c-center-1': '#7e2538',
    '--pk-c-center-2': '#571927',
    '--pk-c-center-oy': '38%',
    '--pk-c-lit-band': 'rgba(255,255,255,.16)',
    '--pk-c-lit-band2': 'rgba(255,255,255,.09)',
    '--pk-c-lits-band': 'rgba(255,255,255,.24)',
    '--pk-c-lits-band2': 'rgba(255,255,255,.13)',
    '--pk-c-lits-core': 'rgba(255,255,255,.36)',
    '--pk-c-lita-glow': '181,53,81',
    '--pk-c-lita-core': '225,174,185',
  },
  'ipod-nano4-blue': {
    '--pk-c-body': 'linear-gradient(180deg, rgba(255,255,255,.3) 0, var(--mms-ipod-sheen-0) 1.6%), linear-gradient(90deg, rgba(0,0,0,.24) 0%, rgba(0,0,0,.06) 12%, var(--mms-ipod-clear) 26%, var(--mms-ipod-clear) 74%, rgba(0,0,0,.06) 88%, rgba(0,0,0,.24) 100%), linear-gradient(180deg, #4790c5 0%, #3a83b8 30%, #3475a5 60%, #2d658d 85%, #255476 100%)',
    '--pk-c-body-edge': '#102534',
    '--pk-c-wheel-1': '#f3f4f3',
    '--pk-c-wheel-2': '#e3e5e4',
    '--pk-c-wheel-sheen': 'var(--mms-ipod-sheen-d)',
    '--pk-c-wheel-oy': '40%',
    '--pk-c-wheel-label': '#b0b3b8',
    '--pk-c-center-1': '#387db0',
    '--pk-c-center-2': '#2b6289',
    '--pk-c-center-oy': '38%',
    '--pk-c-lit-band': 'rgba(255,255,255,.16)',
    '--pk-c-lit-band2': 'rgba(255,255,255,.09)',
    '--pk-c-lits-band': 'rgba(255,255,255,.24)',
    '--pk-c-lits-band2': 'rgba(255,255,255,.13)',
    '--pk-c-lits-core': 'rgba(255,255,255,.36)',
    '--pk-c-lita-glow': '98,160,205',
    '--pk-c-lita-core': '192,217,235',
  },
  'ipod-nano4-orange': {
    '--pk-c-body': 'linear-gradient(180deg, rgba(255,255,255,.3) 0, var(--mms-ipod-sheen-0) 1.6%), linear-gradient(90deg, rgba(0,0,0,.24) 0%, rgba(0,0,0,.06) 12%, var(--mms-ipod-clear) 26%, var(--mms-ipod-clear) 74%, rgba(0,0,0,.06) 88%, rgba(0,0,0,.24) 100%), linear-gradient(180deg, #eab068 0%, #e7a452 30%, #e4983c 60%, #e08a21 85%, #c77a1c 100%)',
    '--pk-c-body-edge': '#7b4b11',
    '--pk-c-wheel-1': '#f3f4f3',
    '--pk-c-wheel-2': '#e3e5e4',
    '--pk-c-wheel-sheen': 'var(--mms-ipod-sheen-d)',
    '--pk-c-wheel-oy': '40%',
    '--pk-c-wheel-label': '#b0b3b8',
    '--pk-c-center-1': '#e69f49',
    '--pk-c-center-2': '#dd871f',
    '--pk-c-center-oy': '38%',
    '--pk-c-lit-band': 'rgba(255,255,255,.16)',
    '--pk-c-lit-band2': 'rgba(255,255,255,.09)',
    '--pk-c-lits-band': 'rgba(255,255,255,.24)',
    '--pk-c-lits-band2': 'rgba(255,255,255,.13)',
    '--pk-c-lits-core': 'rgba(255,255,255,.36)',
    '--pk-c-lita-glow': '238,192,136',
    '--pk-c-lita-core': '248,230,207',
  },
  'ipod-nano5-green': {
    '--pk-c-body': 'linear-gradient(180deg, rgba(255,255,255,.3) 0, var(--mms-ipod-sheen-0) 1.6%), linear-gradient(90deg, rgba(0,0,0,.24) 0%, rgba(0,0,0,.06) 12%, var(--mms-ipod-clear) 26%, var(--mms-ipod-clear) 74%, rgba(0,0,0,.06) 88%, rgba(0,0,0,.24) 100%), linear-gradient(180deg, #48a05c 0%, #408e52 30%, #387c48 60%, #2f673c 85%, #25522f 100%)',
    '--pk-c-body-edge': '#0a160d',
    '--pk-c-wheel-1': '#f3f4f3',
    '--pk-c-wheel-2': '#e3e5e4',
    '--pk-c-wheel-sheen': 'var(--mms-ipod-sheen-d)',
    '--pk-c-wheel-oy': '40%',
    '--pk-c-wheel-label': '#b0b3b8',
    '--pk-c-center-1': '#3d874e',
    '--pk-c-center-2': '#2d643a',
    '--pk-c-center-oy': '38%',
    '--pk-c-lit-band': 'rgba(255,255,255,.16)',
    '--pk-c-lit-band2': 'rgba(255,255,255,.09)',
    '--pk-c-lits-band': 'rgba(255,255,255,.24)',
    '--pk-c-lits-band2': 'rgba(255,255,255,.13)',
    '--pk-c-lits-core': 'rgba(255,255,255,.36)',
    '--pk-c-lita-glow': '88,180,109',
    '--pk-c-lita-core': '188,225,197',
  },
  'ipod-nano5-orange': {
    '--pk-c-body': 'linear-gradient(180deg, rgba(255,255,255,.3) 0, var(--mms-ipod-sheen-0) 1.6%), linear-gradient(90deg, rgba(0,0,0,.24) 0%, rgba(0,0,0,.06) 12%, var(--mms-ipod-clear) 26%, var(--mms-ipod-clear) 74%, rgba(0,0,0,.06) 88%, rgba(0,0,0,.24) 100%), linear-gradient(180deg, #e89a54 0%, #e58d3e 30%, #e28028 60%, #cf711c 85%, #b46218 100%)',
    '--pk-c-body-edge': '#68380e',
    '--pk-c-wheel-1': '#f3f4f3',
    '--pk-c-wheel-2': '#e3e5e4',
    '--pk-c-wheel-sheen': 'var(--mms-ipod-sheen-d)',
    '--pk-c-wheel-oy': '40%',
    '--pk-c-wheel-label': '#b0b3b8',
    '--pk-c-center-1': '#e48835',
    '--pk-c-center-2': '#cb6e1b',
    '--pk-c-center-oy': '38%',
    '--pk-c-lit-band': 'rgba(255,255,255,.16)',
    '--pk-c-lit-band2': 'rgba(255,255,255,.09)',
    '--pk-c-lits-band': 'rgba(255,255,255,.24)',
    '--pk-c-lits-band2': 'rgba(255,255,255,.13)',
    '--pk-c-lits-core': 'rgba(255,255,255,.36)',
    '--pk-c-lita-glow': '236,173,116',
    '--pk-c-lita-core': '247,222,199',
  },
  'ipod-nano5-pink': {
    '--pk-c-body': 'linear-gradient(180deg, rgba(255,255,255,.3) 0, var(--mms-ipod-sheen-0) 1.6%), linear-gradient(90deg, rgba(0,0,0,.24) 0%, rgba(0,0,0,.06) 12%, var(--mms-ipod-clear) 26%, var(--mms-ipod-clear) 74%, rgba(0,0,0,.06) 88%, rgba(0,0,0,.24) 100%), linear-gradient(180deg, #da5994 0%, #d54487 30%, #d02f7a 60%, #b8296b 85%, #9f245c 100%)',
    '--pk-c-body-edge': '#581433',
    '--pk-c-wheel-1': '#f3f4f3',
    '--pk-c-wheel-2': '#e3e5e4',
    '--pk-c-wheel-sheen': 'var(--mms-ipod-sheen-d)',
    '--pk-c-wheel-oy': '40%',
    '--pk-c-wheel-label': '#b0b3b8',
    '--pk-c-center-1': '#d33c82',
    '--pk-c-center-2': '#b32869',
    '--pk-c-center-oy': '38%',
    '--pk-c-lit-band': 'rgba(255,255,255,.16)',
    '--pk-c-lit-band2': 'rgba(255,255,255,.09)',
    '--pk-c-lits-band': 'rgba(255,255,255,.24)',
    '--pk-c-lits-band2': 'rgba(255,255,255,.13)',
    '--pk-c-lits-core': 'rgba(255,255,255,.36)',
    '--pk-c-lita-glow': '224,118,167',
    '--pk-c-lita-core': '243,200,220',
  },
  'ipod-nano6-green': {
    '--pk-c-body': 'linear-gradient(180deg, rgba(255,255,255,.3) 0, var(--mms-ipod-sheen-0) 1.6%), linear-gradient(90deg, rgba(0,0,0,.24) 0%, rgba(0,0,0,.06) 12%, var(--mms-ipod-clear) 26%, var(--mms-ipod-clear) 74%, rgba(0,0,0,.06) 88%, rgba(0,0,0,.24) 100%), linear-gradient(180deg, #cfe081 0%, #c7db6d 30%, #bfd659 60%, #b6d040 85%, #a7c230 100%)',
    '--pk-c-body-edge': '#6b7c1f',
    '--pk-c-wheel-1': '#343434',
    '--pk-c-wheel-2': '#262626',
    '--pk-c-wheel-sheen': 'rgba(255,255,255,.3)',
    '--pk-c-wheel-oy': '40%',
    '--pk-c-wheel-label': '#e4e4e6',
    '--pk-c-center-1': '#c7db6d',
    '--pk-c-center-2': '#b7d144',
    '--pk-c-center-oy': '38%',
    '--pk-c-lit-band': 'rgba(255,255,255,.16)',
    '--pk-c-lit-band2': 'rgba(255,255,255,.09)',
    '--pk-c-lits-band': 'rgba(255,255,255,.24)',
    '--pk-c-lits-band2': 'rgba(255,255,255,.13)',
    '--pk-c-lits-core': 'rgba(255,255,255,.36)',
    '--pk-c-lita-glow': '218,231,158',
    '--pk-c-lita-core': '240,245,216',
  },
  'ipod-nano6-orange': {
    '--pk-c-body': 'linear-gradient(180deg, rgba(255,255,255,.3) 0, var(--mms-ipod-sheen-0) 1.6%), linear-gradient(90deg, rgba(0,0,0,.24) 0%, rgba(0,0,0,.06) 12%, var(--mms-ipod-clear) 26%, var(--mms-ipod-clear) 74%, rgba(0,0,0,.06) 88%, rgba(0,0,0,.24) 100%), linear-gradient(180deg, #e6bd64 0%, #e3b44e 30%, #e0ab38 60%, #d79e22 85%, #bc8a1e 100%)',
    '--pk-c-body-edge': '#725312',
    '--pk-c-wheel-1': '#343434',
    '--pk-c-wheel-2': '#262626',
    '--pk-c-wheel-sheen': 'rgba(255,255,255,.3)',
    '--pk-c-wheel-oy': '40%',
    '--pk-c-wheel-label': '#e4e4e6',
    '--pk-c-center-1': '#e3b44e',
    '--pk-c-center-2': '#dba123',
    '--pk-c-center-oy': '38%',
    '--pk-c-lit-band': 'rgba(255,255,255,.16)',
    '--pk-c-lit-band2': 'rgba(255,255,255,.09)',
    '--pk-c-lits-band': 'rgba(255,255,255,.24)',
    '--pk-c-lits-band2': 'rgba(255,255,255,.13)',
    '--pk-c-lits-core': 'rgba(255,255,255,.36)',
    '--pk-c-lita-glow': '235,202,131',
    '--pk-c-lita-core': '247,234,205',
  },
  'ipod-nano6-pink': {
    '--pk-c-body': 'linear-gradient(180deg, rgba(255,255,255,.3) 0, var(--mms-ipod-sheen-0) 1.6%), linear-gradient(90deg, rgba(0,0,0,.24) 0%, rgba(0,0,0,.06) 12%, var(--mms-ipod-clear) 26%, var(--mms-ipod-clear) 74%, rgba(0,0,0,.06) 88%, rgba(0,0,0,.24) 100%), linear-gradient(180deg, #e996cd 0%, #e581c3 30%, #e16cb9 60%, #db52ad 85%, #d639a1 100%)',
    '--pk-c-body-edge': '#992070',
    '--pk-c-wheel-1': '#343434',
    '--pk-c-wheel-2': '#262626',
    '--pk-c-wheel-sheen': 'rgba(255,255,255,.3)',
    '--pk-c-wheel-oy': '40%',
    '--pk-c-wheel-label': '#e4e4e6',
    '--pk-c-center-1': '#e581c3',
    '--pk-c-center-2': '#dc57af',
    '--pk-c-center-oy': '38%',
    '--pk-c-lit-band': 'rgba(255,255,255,.16)',
    '--pk-c-lit-band2': 'rgba(255,255,255,.09)',
    '--pk-c-lits-band': 'rgba(255,255,255,.24)',
    '--pk-c-lits-band2': 'rgba(255,255,255,.13)',
    '--pk-c-lits-core': 'rgba(255,255,255,.36)',
    '--pk-c-lita-glow': '239,180,219',
    '--pk-c-lita-core': '249,225,241',
  },
  'ipod-nano7-pink': {
    '--pk-c-body': 'linear-gradient(180deg, rgba(255,255,255,.3) 0, var(--mms-ipod-sheen-0) 1.6%), linear-gradient(90deg, rgba(0,0,0,.24) 0%, rgba(0,0,0,.06) 12%, var(--mms-ipod-clear) 26%, var(--mms-ipod-clear) 74%, rgba(0,0,0,.06) 88%, rgba(0,0,0,.24) 100%), linear-gradient(180deg, #ed9695 0%, #e9807f 30%, #e56a69 60%, #e1514f 85%, #dc3735 100%)',
    '--pk-c-body-edge': '#9f1d1b',
    '--pk-c-wheel-1': '#f3f4f3',
    '--pk-c-wheel-2': '#e3e5e4',
    '--pk-c-wheel-sheen': 'var(--mms-ipod-sheen-d)',
    '--pk-c-wheel-oy': '40%',
    '--pk-c-wheel-label': '#b0b3b8',
    '--pk-c-center-1': '#e87776',
    '--pk-c-center-2': '#e04c4b',
    '--pk-c-center-oy': '38%',
    '--pk-c-lit-band': 'rgba(255,255,255,.16)',
    '--pk-c-lit-band2': 'rgba(255,255,255,.09)',
    '--pk-c-lits-band': 'rgba(255,255,255,.24)',
    '--pk-c-lits-band2': 'rgba(255,255,255,.13)',
    '--pk-c-lits-core': 'rgba(255,255,255,.36)',
    '--pk-c-lita-glow': '242,180,179',
    '--pk-c-lita-core': '250,225,225',
  },
  'ipod-nano7-yellow': {
    '--pk-c-body': 'linear-gradient(180deg, rgba(255,255,255,.3) 0, var(--mms-ipod-sheen-0) 1.6%), linear-gradient(90deg, rgba(0,0,0,.24) 0%, rgba(0,0,0,.06) 12%, var(--mms-ipod-clear) 26%, var(--mms-ipod-clear) 74%, rgba(0,0,0,.06) 88%, rgba(0,0,0,.24) 100%), linear-gradient(180deg, #e7e47a 0%, #e3e064 30%, #dfdc4e 60%, #dad634 85%, #ccc825 100%)',
    '--pk-c-body-edge': '#828018',
    '--pk-c-wheel-1': '#f3f4f3',
    '--pk-c-wheel-2': '#e3e5e4',
    '--pk-c-wheel-sheen': 'var(--mms-ipod-sheen-d)',
    '--pk-c-wheel-oy': '40%',
    '--pk-c-wheel-label': '#b0b3b8',
    '--pk-c-center-1': '#e1de5b',
    '--pk-c-center-2': '#dad630',
    '--pk-c-center-oy': '38%',
    '--pk-c-lit-band': 'rgba(255,255,255,.16)',
    '--pk-c-lit-band2': 'rgba(255,255,255,.09)',
    '--pk-c-lits-band': 'rgba(255,255,255,.24)',
    '--pk-c-lits-band2': 'rgba(255,255,255,.13)',
    '--pk-c-lits-core': 'rgba(255,255,255,.36)',
    '--pk-c-lita-glow': '236,234,152',
    '--pk-c-lita-core': '247,247,214',
  },
  'ipod-nano7-green': {
    '--pk-c-body': 'linear-gradient(180deg, rgba(255,255,255,.3) 0, var(--mms-ipod-sheen-0) 1.6%), linear-gradient(90deg, rgba(0,0,0,.24) 0%, rgba(0,0,0,.06) 12%, var(--mms-ipod-clear) 26%, var(--mms-ipod-clear) 74%, rgba(0,0,0,.06) 88%, rgba(0,0,0,.24) 100%), linear-gradient(180deg, #9ad5af 0%, #88cda1 30%, #76c593 60%, #60bc82 85%, #4bb371 100%)',
    '--pk-c-body-edge': '#32764a',
    '--pk-c-wheel-1': '#f3f4f3',
    '--pk-c-wheel-2': '#e3e5e4',
    '--pk-c-wheel-sheen': 'var(--mms-ipod-sheen-d)',
    '--pk-c-wheel-oy': '40%',
    '--pk-c-wheel-label': '#b0b3b8',
    '--pk-c-center-1': '#81ca9b',
    '--pk-c-center-2': '#5dbb7f',
    '--pk-c-center-oy': '38%',
    '--pk-c-lit-band': 'rgba(255,255,255,.16)',
    '--pk-c-lit-band2': 'rgba(255,255,255,.09)',
    '--pk-c-lits-band': 'rgba(255,255,255,.24)',
    '--pk-c-lits-band2': 'rgba(255,255,255,.13)',
    '--pk-c-lits-core': 'rgba(255,255,255,.36)',
    '--pk-c-lita-glow': '179,223,195',
    '--pk-c-lita-core': '225,242,231',
  },
  'ipod-nano7-purple': {
    '--pk-c-body': 'linear-gradient(180deg, rgba(255,255,255,.3) 0, var(--mms-ipod-sheen-0) 1.6%), linear-gradient(90deg, rgba(0,0,0,.24) 0%, rgba(0,0,0,.06) 12%, var(--mms-ipod-clear) 26%, var(--mms-ipod-clear) 74%, rgba(0,0,0,.06) 88%, rgba(0,0,0,.24) 100%), linear-gradient(180deg, #d9a8d3 0%, #d196ca 30%, #c984c1 60%, #c06fb6 85%, #b75aac 100%)',
    '--pk-c-body-edge': '#813978',
    '--pk-c-wheel-1': '#f3f4f3',
    '--pk-c-wheel-2': '#e3e5e4',
    '--pk-c-wheel-sheen': 'var(--mms-ipod-sheen-d)',
    '--pk-c-wheel-oy': '40%',
    '--pk-c-wheel-label': '#b0b3b8',
    '--pk-c-center-1': '#ce8fc6',
    '--pk-c-center-2': '#be6bb5',
    '--pk-c-center-oy': '38%',
    '--pk-c-lit-band': 'rgba(255,255,255,.16)',
    '--pk-c-lit-band2': 'rgba(255,255,255,.09)',
    '--pk-c-lits-band': 'rgba(255,255,255,.24)',
    '--pk-c-lits-band2': 'rgba(255,255,255,.13)',
    '--pk-c-lits-core': 'rgba(255,255,255,.36)',
    '--pk-c-lita-glow': '228,193,223',
    '--pk-c-lita-core': '244,230,242',
  },
  'ipod-nano7-slate': {
    '--pk-c-body': 'linear-gradient(180deg, rgba(255,255,255,.3) 0, var(--mms-ipod-sheen-0) 1.6%), linear-gradient(90deg, rgba(0,0,0,.24) 0%, rgba(0,0,0,.06) 12%, var(--mms-ipod-clear) 26%, var(--mms-ipod-clear) 74%, rgba(0,0,0,.06) 88%, rgba(0,0,0,.24) 100%), linear-gradient(180deg, #5a5f6b 0%, #4e535d 30%, #42474f 60%, #34383e 85%, #26292e 100%)',
    '--pk-c-body-edge': '#000000',
    '--pk-c-wheel-1': '#343434',
    '--pk-c-wheel-2': '#262626',
    '--pk-c-wheel-sheen': 'rgba(255,255,255,.3)',
    '--pk-c-wheel-oy': '40%',
    '--pk-c-wheel-label': '#e4e4e6',
    '--pk-c-center-1': '#4e535d',
    '--pk-c-center-2': '#373a41',
    '--pk-c-center-oy': '38%',
    '--pk-c-lit-band': 'rgba(255,255,255,.16)',
    '--pk-c-lit-band2': 'rgba(255,255,255,.09)',
    '--pk-c-lits-band': 'rgba(255,255,255,.24)',
    '--pk-c-lits-band2': 'rgba(255,255,255,.13)',
    '--pk-c-lits-core': 'rgba(255,255,255,.36)',
    '--pk-c-lita-glow': '106,113,126',
    '--pk-c-lita-core': '195,198,203',
  },
  'ipod-nano7-red': {
    '--pk-c-body': 'linear-gradient(180deg, rgba(255,255,255,.3) 0, var(--mms-ipod-sheen-0) 1.6%), linear-gradient(90deg, rgba(0,0,0,.24) 0%, rgba(0,0,0,.06) 12%, var(--mms-ipod-clear) 26%, var(--mms-ipod-clear) 74%, rgba(0,0,0,.06) 88%, rgba(0,0,0,.24) 100%), linear-gradient(180deg, #ec6c6c 0%, #e95555 30%, #e63e3e 60%, #e32323 85%, #cd1b1b 100%)',
    '--pk-c-body-edge': '#801111',
    '--pk-c-wheel-1': '#f3f4f3',
    '--pk-c-wheel-2': '#e3e5e4',
    '--pk-c-wheel-sheen': 'var(--mms-ipod-sheen-d)',
    '--pk-c-wheel-oy': '40%',
    '--pk-c-wheel-label': '#b0b3b8',
    '--pk-c-center-1': '#e84c4c',
    '--pk-c-center-2': '#e21f1f',
    '--pk-c-center-oy': '38%',
    '--pk-c-lit-band': 'rgba(255,255,255,.16)',
    '--pk-c-lit-band2': 'rgba(255,255,255,.09)',
    '--pk-c-lits-band': 'rgba(255,255,255,.24)',
    '--pk-c-lits-band2': 'rgba(255,255,255,.13)',
    '--pk-c-lits-core': 'rgba(255,255,255,.36)',
    '--pk-c-lita-glow': '240,139,139',
    '--pk-c-lita-core': '249,209,209',
  },
  'ipod-nano7-spacegray': {
    '--pk-c-body': 'linear-gradient(180deg, rgba(255,255,255,.3) 0, var(--mms-ipod-sheen-0) 1.6%), linear-gradient(90deg, rgba(0,0,0,.24) 0%, rgba(0,0,0,.06) 12%, var(--mms-ipod-clear) 26%, var(--mms-ipod-clear) 74%, rgba(0,0,0,.06) 88%, rgba(0,0,0,.24) 100%), linear-gradient(180deg, #a7a6a9 0%, #9a999c 30%, #8d8c8f 60%, #7e7d80 85%, #6f6d71 100%)',
    '--pk-c-body-edge': '#434345',
    '--pk-c-wheel-1': '#343434',
    '--pk-c-wheel-2': '#262626',
    '--pk-c-wheel-sheen': 'rgba(255,255,255,.3)',
    '--pk-c-wheel-oy': '40%',
    '--pk-c-wheel-label': '#e4e4e6',
    '--pk-c-center-1': '#9a999c',
    '--pk-c-center-2': '#807f83',
    '--pk-c-center-oy': '38%',
    '--pk-c-lit-band': 'rgba(255,255,255,.16)',
    '--pk-c-lit-band2': 'rgba(255,255,255,.09)',
    '--pk-c-lits-band': 'rgba(255,255,255,.24)',
    '--pk-c-lits-band2': 'rgba(255,255,255,.13)',
    '--pk-c-lits-core': 'rgba(255,255,255,.36)',
    '--pk-c-lita-glow': '185,184,186',
    '--pk-c-lita-core': '227,227,227',
  },
  'ipod-nano7-blue': {
    '--pk-c-body': 'linear-gradient(180deg, rgba(255,255,255,.3) 0, var(--mms-ipod-sheen-0) 1.6%), linear-gradient(90deg, rgba(0,0,0,.24) 0%, rgba(0,0,0,.06) 12%, var(--mms-ipod-clear) 26%, var(--mms-ipod-clear) 74%, rgba(0,0,0,.06) 88%, rgba(0,0,0,.24) 100%), linear-gradient(180deg, #4372bd 0%, #3c67aa 30%, #355c97 60%, #2d4e81 85%, #25406a 100%)',
    '--pk-c-body-edge': '#0f192a',
    '--pk-c-wheel-1': '#f3f4f3',
    '--pk-c-wheel-2': '#e3e5e4',
    '--pk-c-wheel-sheen': 'var(--mms-ipod-sheen-d)',
    '--pk-c-wheel-oy': '40%',
    '--pk-c-wheel-label': '#b0b3b8',
    '--pk-c-center-1': '#3962a2',
    '--pk-c-center-2': '#2c4c7d',
    '--pk-c-center-oy': '38%',
    '--pk-c-lit-band': 'rgba(255,255,255,.16)',
    '--pk-c-lit-band2': 'rgba(255,255,255,.09)',
    '--pk-c-lits-band': 'rgba(255,255,255,.24)',
    '--pk-c-lits-band2': 'rgba(255,255,255,.13)',
    '--pk-c-lits-core': 'rgba(255,255,255,.36)',
    '--pk-c-lita-glow': '93,134,198',
    '--pk-c-lita-core': '190,207,232',
  },
  'ipod-nano7-gold': {
    '--pk-c-body': 'linear-gradient(180deg, rgba(255,255,255,.3) 0, var(--mms-ipod-sheen-0) 1.6%), linear-gradient(90deg, rgba(0,0,0,.24) 0%, rgba(0,0,0,.06) 12%, var(--mms-ipod-clear) 26%, var(--mms-ipod-clear) 74%, rgba(0,0,0,.06) 88%, rgba(0,0,0,.24) 100%), linear-gradient(180deg, #f4edde 0%, #eee2cb 30%, #e8d7b8 60%, #e0caa1 85%, #d9be8a 100%)',
    '--pk-c-body-edge': '#c39948',
    '--pk-c-wheel-1': '#f3f4f3',
    '--pk-c-wheel-2': '#e3e5e4',
    '--pk-c-wheel-sheen': 'var(--mms-ipod-sheen-d)',
    '--pk-c-wheel-oy': '40%',
    '--pk-c-wheel-label': '#b0b3b8',
    '--pk-c-center-1': '#ebdec3',
    '--pk-c-center-2': '#dfc89d',
    '--pk-c-center-oy': '38%',
    '--pk-c-lit-band': 'rgba(255,255,255,.16)',
    '--pk-c-lit-band2': 'rgba(255,255,255,.09)',
    '--pk-c-lits-band': 'rgba(255,255,255,.24)',
    '--pk-c-lits-band2': 'rgba(255,255,255,.13)',
    '--pk-c-lits-core': 'rgba(255,255,255,.36)',
    '--pk-c-lita-glow': '253,252,249',
    '--pk-c-lita-core': '254,254,253',
  },
  'ipod-shuffle2-purple': {
    '--pk-c-body': 'linear-gradient(180deg, rgba(255,255,255,.3) 0, var(--mms-ipod-sheen-0) 1.6%), linear-gradient(90deg, rgba(0,0,0,.24) 0%, rgba(0,0,0,.06) 12%, var(--mms-ipod-clear) 26%, var(--mms-ipod-clear) 74%, rgba(0,0,0,.06) 88%, rgba(0,0,0,.24) 100%), linear-gradient(180deg, #8888b2 0%, #7978a8 30%, #6a689e 60%, #5c5b8d 85%, #504f7a 100%)',
    '--pk-c-body-edge': '#2d2d46',
    '--pk-c-wheel-1': '#9897bc',
    '--pk-c-wheel-2': '#8584b0',
    '--pk-c-wheel-sheen': 'var(--mms-ipod-sheen-d)',
    '--pk-c-wheel-oy': '40%',
    '--pk-c-wheel-label': '#d9d9e7',
    '--pk-c-center-1': '#67659c',
    '--pk-c-center-2': '#565584',
    '--pk-c-center-oy': '38%',
    '--pk-c-lit-band': 'rgba(255,255,255,.16)',
    '--pk-c-lit-band2': 'rgba(255,255,255,.09)',
    '--pk-c-lits-band': 'rgba(255,255,255,.24)',
    '--pk-c-lits-band2': 'rgba(255,255,255,.13)',
    '--pk-c-lits-core': 'rgba(255,255,255,.36)',
    '--pk-c-lita-glow': '158,157,192',
    '--pk-c-lita-core': '216,216,230',
  },
  'ipod-shuffle2-green': {
    '--pk-c-body': 'linear-gradient(180deg, rgba(255,255,255,.3) 0, var(--mms-ipod-sheen-0) 1.6%), linear-gradient(90deg, rgba(0,0,0,.24) 0%, rgba(0,0,0,.06) 12%, var(--mms-ipod-clear) 26%, var(--mms-ipod-clear) 74%, rgba(0,0,0,.06) 88%, rgba(0,0,0,.24) 100%), linear-gradient(180deg, #8aba57 0%, #7db048 30%, #709e41 60%, #618838 85%, #51722f 100%)',
    '--pk-c-body-edge': '#263516',
    '--pk-c-wheel-1': '#96c269',
    '--pk-c-wheel-2': '#87b954',
    '--pk-c-wheel-sheen': 'var(--mms-ipod-sheen-d)',
    '--pk-c-wheel-oy': '40%',
    '--pk-c-wheel-label': '#dbe9cc',
    '--pk-c-center-1': '#6e9a3f',
    '--pk-c-center-2': '#597d33',
    '--pk-c-center-oy': '38%',
    '--pk-c-lit-band': 'rgba(255,255,255,.16)',
    '--pk-c-lit-band2': 'rgba(255,255,255,.09)',
    '--pk-c-lits-band': 'rgba(255,255,255,.24)',
    '--pk-c-lits-band2': 'rgba(255,255,255,.13)',
    '--pk-c-lits-core': 'rgba(255,255,255,.36)',
    '--pk-c-lita-glow': '155,197,112',
    '--pk-c-lita-core': '215,232,198',
  },
  'ipod-shuffle2-gold': {
    '--pk-c-body': 'linear-gradient(180deg, rgba(255,255,255,.3) 0, var(--mms-ipod-sheen-0) 1.6%), linear-gradient(90deg, rgba(0,0,0,.24) 0%, rgba(0,0,0,.06) 12%, var(--mms-ipod-clear) 26%, var(--mms-ipod-clear) 74%, rgba(0,0,0,.06) 88%, rgba(0,0,0,.24) 100%), linear-gradient(180deg, #e6ce96 0%, #e1c581 30%, #dcbc6c 60%, #d6b054 85%, #d0a53b 100%)',
    '--pk-c-body-edge': '#927123',
    '--pk-c-wheel-1': '#ebd8aa',
    '--pk-c-wheel-2': '#e5cd91',
    '--pk-c-wheel-sheen': 'var(--mms-ipod-sheen-d)',
    '--pk-c-wheel-oy': '40%',
    '--pk-c-wheel-label': '#f7efdc',
    '--pk-c-center-1': '#dbba68',
    '--pk-c-center-2': '#d3aa47',
    '--pk-c-center-oy': '38%',
    '--pk-c-lit-band': 'rgba(255,255,255,.16)',
    '--pk-c-lit-band2': 'rgba(255,255,255,.09)',
    '--pk-c-lits-band': 'rgba(255,255,255,.24)',
    '--pk-c-lits-band2': 'rgba(255,255,255,.13)',
    '--pk-c-lits-core': 'rgba(255,255,255,.36)',
    '--pk-c-lita-glow': '237,220,178',
    '--pk-c-lita-core': '248,241,224',
  },
  'ipod-shuffle3-pink': {
    '--pk-c-body': 'linear-gradient(180deg, rgba(255,255,255,.3) 0, var(--mms-ipod-sheen-0) 1.6%), linear-gradient(90deg, rgba(0,0,0,.24) 0%, rgba(0,0,0,.06) 12%, var(--mms-ipod-clear) 26%, var(--mms-ipod-clear) 74%, rgba(0,0,0,.06) 88%, rgba(0,0,0,.24) 100%), linear-gradient(180deg, #d76f95 0%, #d25b86 30%, #cd4777 60%, #c03567 85%, #a82e5a 100%)',
    '--pk-c-body-edge': '#641b36',
    '--pk-c-wheel-1': '#dd83a4',
    '--pk-c-wheel-2': '#d66b92',
    '--pk-c-wheel-sheen': 'var(--mms-ipod-sheen-d)',
    '--pk-c-wheel-oy': '40%',
    '--pk-c-wheel-label': '#f2d1dd',
    '--pk-c-center-1': '#cb4374',
    '--pk-c-center-2': '#b43161',
    '--pk-c-center-oy': '38%',
    '--pk-c-lit-band': 'rgba(255,255,255,.16)',
    '--pk-c-lit-band2': 'rgba(255,255,255,.09)',
    '--pk-c-lits-band': 'rgba(255,255,255,.24)',
    '--pk-c-lits-band2': 'rgba(255,255,255,.13)',
    '--pk-c-lits-core': 'rgba(255,255,255,.36)',
    '--pk-c-lita-glow': '223,139,169',
    '--pk-c-lita-core': '242,209,221',
  },
  'ipod-shuffle3-blue': {
    '--pk-c-body': 'linear-gradient(180deg, rgba(255,255,255,.3) 0, var(--mms-ipod-sheen-0) 1.6%), linear-gradient(90deg, rgba(0,0,0,.24) 0%, rgba(0,0,0,.06) 12%, var(--mms-ipod-clear) 26%, var(--mms-ipod-clear) 74%, rgba(0,0,0,.06) 88%, rgba(0,0,0,.24) 100%), linear-gradient(180deg, #5aa9be 0%, #48a0b7 30%, #4190a5 60%, #387d8f 85%, #306a79 100%)',
    '--pk-c-body-edge': '#17333b',
    '--pk-c-wheel-1': '#6db3c5',
    '--pk-c-wheel-2': '#57a8bd',
    '--pk-c-wheel-sheen': 'var(--mms-ipod-sheen-d)',
    '--pk-c-wheel-oy': '40%',
    '--pk-c-wheel-label': '#cce4eb',
    '--pk-c-center-1': '#3f8da1',
    '--pk-c-center-2': '#347384',
    '--pk-c-center-oy': '38%',
    '--pk-c-lit-band': 'rgba(255,255,255,.16)',
    '--pk-c-lit-band2': 'rgba(255,255,255,.09)',
    '--pk-c-lits-band': 'rgba(255,255,255,.24)',
    '--pk-c-lits-band2': 'rgba(255,255,255,.13)',
    '--pk-c-lits-core': 'rgba(255,255,255,.36)',
    '--pk-c-lita-glow': '116,183,200',
    '--pk-c-lita-core': '199,226,233',
  },
  'ipod-shuffle4-blue': {
    '--pk-c-body': 'linear-gradient(180deg, rgba(255,255,255,.3) 0, var(--mms-ipod-sheen-0) 1.6%), linear-gradient(90deg, rgba(0,0,0,.24) 0%, rgba(0,0,0,.06) 12%, var(--mms-ipod-clear) 26%, var(--mms-ipod-clear) 74%, rgba(0,0,0,.06) 88%, rgba(0,0,0,.24) 100%), linear-gradient(180deg, #a2c1e2 0%, #8fb4dc 30%, #7ca7d6 60%, #6497cf 85%, #4d88c7 100%)',
    '--pk-c-body-edge': '#2d5d90',
    '--pk-c-wheel-1': '#b6cee8',
    '--pk-c-wheel-2': '#9fbee1',
    '--pk-c-wheel-sheen': 'var(--mms-ipod-sheen-d)',
    '--pk-c-wheel-oy': '40%',
    '--pk-c-wheel-label': '#e0eaf5',
    '--pk-c-center-1': '#78a4d5',
    '--pk-c-center-2': '#5990cb',
    '--pk-c-center-oy': '38%',
    '--pk-c-lit-band': 'rgba(255,255,255,.16)',
    '--pk-c-lit-band2': 'rgba(255,255,255,.09)',
    '--pk-c-lits-band': 'rgba(255,255,255,.24)',
    '--pk-c-lits-band2': 'rgba(255,255,255,.13)',
    '--pk-c-lits-core': 'rgba(255,255,255,.36)',
    '--pk-c-lita-glow': '190,211,235',
    '--pk-c-lita-core': '229,237,247',
  },
  'ipod-gold': {
    '--pk-c-body': 'linear-gradient(180deg, rgba(255,255,255,.28) 0, var(--mms-ipod-sheen-0) 1.6%), linear-gradient(90deg, rgba(0,0,0,.28) 0%, rgba(0,0,0,.06) 12%, var(--mms-ipod-clear) 26%, var(--mms-ipod-clear) 74%, rgba(0,0,0,.06) 88%, rgba(0,0,0,.28) 100%), linear-gradient(180deg, #e8dfb6 0%, #e2d6a3 25%, #dccd90 50%, #d5c378 75%, #cdb961 100%)',
    '--pk-c-body-edge': '#a48f34',
    '--pk-c-wheel-1': '#d3d3d2',
    '--pk-c-wheel-2': '#c4c4c2',
    '--pk-c-wheel-sheen': 'var(--mms-ipod-sheen-d)',
    '--pk-c-wheel-oy': '40%',
    '--pk-c-wheel-label': '#86898c',
    '--pk-c-center-1': '#d3d3d2',
    '--pk-c-center-2': '#c4c4c2',
    '--pk-c-center-oy': '38%',
    '--pk-c-lit-band': 'rgba(255,255,255,.16)',
    '--pk-c-lit-band2': 'rgba(255,255,255,.09)',
    '--pk-c-lits-band': 'rgba(255,255,255,.24)',
    '--pk-c-lits-band2': 'rgba(255,255,255,.13)',
    '--pk-c-lits-core': 'rgba(255,255,255,.36)',
    '--pk-c-lita-glow': '236,228,194',
    '--pk-c-lita-core': '247,244,231',
  },
};

test('the colorway VALUES: every role of every colorway, byte-exact (the palettes\' value authority)', () => {
  for (const id of clickIds()) {
    assert.ok(COLORWAYS[id], id + ' has its values pinned here');
    const block = ALL.find((r) => r.sel === '.' + classOf(id) && /--pk-c-/.test(r.body));
    const got = Object.fromEntries(decls(block.body).map(([p, v]) => [p, v.replace(/\s+/g, ' ')]));
    assert.deepStrictEqual(got, COLORWAYS[id], id + ': the role values');
  }
  assert.deepStrictEqual(Object.keys(COLORWAYS).sort(), clickIds().sort(), 'no pinned colorway outside the registry');
});

// ---- AC5: no raw sizes in the pocket rules ----
// The pocket rules: every rule scoped to the chassis (.mms-ipod), the Nano tray's reshape of its screen,
// and the tray-only menu hide. Their size properties must read a --pk-* structure token (or a global
// token); font sizes a --pk-fs-* type role. Allowed literals are the unit-free geometry of a box
// (0, 100% fills, the 50% centring of a positioned layer), a 1px hairline, and the lighting layers'
// overhangs (the band's -25% / -35% and the glass streak's -50% / -70% - locked with their travel in
// test/unit/pocket-lighting.test.js AC6: a layer's overhang is its translate budget, not a size).
// Gate r1 S1 (adversary): an UNSCOPED `.ip-wheel .ip-center{ width:61px }` wins over the chassis, so
// any rule that names a pocket element class (ip-* / ipm-*) is a pocket rule too, scoped or not.
const POCKET = (sel) => /\.mms-ipod\b/.test(sel) || /(^|[\s>+~,(])\.(ip|ipm)-[\w-]/.test(sel);
const SIZE_PROPS = /^(width|height|min-width|min-height|max-width|max-height|aspect-ratio|grid-auto-rows|flex|flex-basis|padding(-[a-z]+)?|margin(-[a-z]+)?|gap|top|left|right|bottom|inset)$/;
const ALLOWED = new Set(['0', '100%', '50%', '1px', '-25%', '-35%', '-50%', '-70%']);
function rawLengths(v) {
  // strip var(...) references and calc() over tokens, then look for a raw length
  const bare = v.replace(/var\([^()]*(\([^()]*\))*[^()]*\)/g, 'V').replace(/env\([^)]*\)/g, 'E');
  return (bare.match(/-?\d*\.?\d+(px|vw|vh|em|rem|%)/g) || []).filter((x) => !ALLOWED.has(x));
}

test('AC5: every size in the pocket rules reads a structure token (no raw px / vw / % sizes outside the token definitions)', () => {
  const pocket = ALL.filter((r) => POCKET(r.sel));
  assert.ok(pocket.length > 60, 'precondition: the pocket rules were found (' + pocket.length + ')');
  const bad = [];
  for (const r of pocket) {
    for (const [p, v] of decls(r.body)) {
      if (p.startsWith('--') || !SIZE_PROPS.test(p)) continue;
      const raw = rawLengths(v);
      if (raw.length) bad.push(r.sel + ' { ' + p + ': ' + v + ' } -> ' + raw.join(', '));
    }
  }
  assert.deepStrictEqual(bad, [], 'raw sizes in the pocket rules');
  // not vacuous: a raw size in a pocket rule is caught
  assert.deepStrictEqual(rawLengths('min(70vw,288px)'), ['70vw', '288px']);
  assert.deepStrictEqual(rawLengths('var(--pk-wheel-d)'), []);
});

test('AC5: every font-size in the pocket rules reads a pocket TYPE role (--pk-fs-*)', () => {
  const bad = [];
  let n = 0;
  for (const r of ALL.filter((x) => POCKET(x.sel))) {
    for (const [p, v] of decls(r.body)) {
      if (p !== 'font-size') continue;
      n += 1;
      if (!/^var\(--pk-fs-[a-z0-9-]+\)$/.test(v)) bad.push(r.sel + ' { font-size: ' + v + ' }');
    }
  }
  assert.ok(n > 20, 'precondition: the pocket font sizes (' + n + ')');
  assert.deepStrictEqual(bad, [], 'a pocket font size that skips the type roles');
});

test('AC5: the structure + type tokens are defined ONCE, on the chassis (.mms-ipod), and every one is read', () => {
  // v1.335 (the Original look, plan 2026-09-25-click-colorways-seven D12): the look's OWN tokens (--pk-o-*: its
  // LCD, ink, ring and disc) are a second family, defined once on the look block; it never redefines a chassis
  // token (the intent of this lock - the structure + type sizes have ONE authority) and the chassis never
  // holds a look token.
  // The SCREEN roles (--pk-s-*) live on the chassis too, each exactly its palette token (so every skin paints
  // the shared screen); the ONE place they are re-pointed is the Original's glass (below).
  const defs = ALL.filter((r) => decls(r.body).some(([p]) => /^--pk-(?!c-|o-|s-)/.test(p)));
  assert.deepStrictEqual(defs.map((r) => r.sel), ['.mms-ipod'], 'one chassis rule holds the structure + type tokens');
  const scr = ALL.filter((r) => decls(r.body).some(([p]) => /^--pk-s-/.test(p)));
  assert.deepStrictEqual(scr.map((r) => r.sel), ['.mms-ipod', '.mms-look-original .ip-lcd-in'], 'the screen roles: defined on the chassis, re-pointed only in the Original\'s glass');
  assert.strictEqual(scr[0], defs[0], 'the screen roles sit in the chassis structure block');
  for (const [p, v] of decls(defs[0].body).filter(([q]) => /^--pk-s-/.test(q))) assert.match(v, /^var\(--mms-[a-z0-9-]+\)$/, p + ' is exactly a palette token on the chassis');
  const lookDefs = ALL.filter((r) => decls(r.body).some(([p]) => /^--pk-o-/.test(p)));
  assert.deepStrictEqual(lookDefs.map((r) => r.sel), ['.mms-look-original'], 'one look rule holds the look tokens');
  assert.deepStrictEqual(decls(lookDefs[0].body).map(([p]) => p).filter((p) => /^--pk-(?!o-)/.test(p)), [], 'the look block redefines no chassis, screen or role token');
  assert.deepStrictEqual(decls(scr[1].body).map(([p]) => p).filter((p) => /^--pk-(?!s-)/.test(p)), [], 'the glass re-points only screen roles');
  assert.deepStrictEqual(decls(defs[0].body).map(([p]) => p).filter((p) => /^--pk-o-/.test(p)), [], 'the chassis holds no look token');
  const names = decls(defs[0].body).map(([p]) => p).filter((p) => p.startsWith('--pk-'));
  assert.strictEqual(new Set(names).size, names.length, 'no token defined twice');
  for (const n of names) assert.ok(new RegExp('var\\(' + n + '\\)').test(CSS), n + ' is read somewhere');
});

// ---- AC6: overflow is ONE rule, and every text element the renderers draw is classified ----
// The text-line rule's selector list (parsed from the stylesheet - the list IS the classification),
// the elements that deliberately WRAP, and the fixed GLYPHS (a mark, a count, a letter - text that
// never grows with a user's name). A new text element fails this census until it joins a list.
const { JSDOM } = require('jsdom');
const WRAP = ['ipm-note', 'ipm-noterow ipm-lbl'];
const GLYPH = ['mms-playind', 'ip-stars', 'mms-rn', 'mms-chev-r', 'ipm-chev', 'ipm-check', 'ipm-letter', 'ipm-badge', 'ipm-gl', 'ip-zone'];
function textLineClasses() {
  const r = ALL.filter((x) => /white-space:\s*nowrap/.test(x.body) && /text-overflow:\s*ellipsis/.test(x.body) && /\.mms-ipod \.ipm-lbl\b/.test(x.sel));
  assert.strictEqual(r.length, 1, 'ONE text-line rule');
  return r[0].sel.split(',').map((s) => s.trim().replace(/^\.mms-ipod \./, ''));
}
const LONG = 'The Complete Northbound Night Transit Sessions Recorded Live At The Harbor Lights Ballroom In The Winters Of Ninety Nine';
function pocketLevels() {
  const ctx = { track: { title: LONG, artist: LONG, album: LONG, artUrl: '' }, upNext: [], playing: true, posLabel: '1:02', remLabel: '-2:41', posSec: 62, durSec: 223, curNum: 3, total: 12,
    fullList: [{ index: 0, title: LONG, durLabel: '4:51', state: 'played' }, { index: 1, title: LONG, durLabel: '10:04:51', state: 'current' }, { index: 2, title: LONG, durLabel: '', state: 'next' }], artistTap: true };
  const out = [SK.renderFull('ipod', ctx), SK.renderFull('ipod', Object.assign({}, ctx, { artistTap: false }))];
  const v = (items, extra) => SK.renderMenuView('click', Object.assign({ title: LONG, items, cursor: 0, start: 0, end: items.length, rowH: 0, state: 'ready', currentId: 's1' }, extra || {}));
  out.push(v(SK.menuStaticItems({ type: 'main' }, { hasCurrent: true, hasGames: true })));
  out.push(v([{ label: LONG, node: { type: 'album' } }, { label: LONG, id: 's1', song: true, sub: LONG }, { label: LONG, check: true, action: 'lighting' }]));
  out.push(v(SK.menuAboutItems({ songs: 1234567, albums: 5, artists: 7, version: '1.332.0-' + LONG }), { aboutName: LONG }));
  out.push(v(SK.menuLightingItems({ strength: 'subtle', note: LONG })));
  out.push(v([], { state: 'loading' }), v([], { state: 'error' }), v([], { state: 'empty', emptyText: LONG }));
  const runs = SK.menuLetterRuns(new Array(30).fill(0).map((_, i) => ({ label: String.fromCharCode(65 + (i % 26)) + ' ' + LONG })));
  out.push(v([{ label: LONG }], { jump: { letter: 'A', overlay: true, badge: true, grid: SK.menuLetterTargets(runs) } }));
  return out;
}
// v1.335 (plan 2026-09-25-click-colorways-seven, the Original's screen): every rule that styles the glass or an
// element INSIDE it reads the SCREEN roles, never the 16 palette tokens they wrap - else the Original's monochrome
// glass would miss it (the inert-sibling class). The glass's classes are DERIVED from the renderers (every level
// pocketLevels draws, the glass itself, plus Brick's layer), never a hand list. Gate r1 W2 (qa + adversary): the
// glass element itself, a var() WITH a fallback, and a rule under ANY ancestor (only the other skins' own screens,
// Cider's and Nordic's, are out of scope) are all in.
function glassClasses() {
  const inGlass = new Set(['ipod-brick']);
  for (const html of pocketLevels()) {
    const doc = new JSDOM('<div id="h">' + html + '</div>').window.document;
    const glasses = doc.querySelectorAll('.ip-lcd-in');
    const roots = glasses.length ? [...glasses] : [doc.getElementById('h')]; // a menu view renders INTO the glass
    for (const g of roots) { for (const c of g.classList) inGlass.add(c); for (const el of g.querySelectorAll('[class]')) for (const c of el.classList) inGlass.add(c); }
  }
  return inGlass;
}
function glassButtons() {
  const out = new Set();
  for (const html of pocketLevels()) {
    const doc = new JSDOM('<div id="h">' + html + '</div>').window.document;
    const glasses = doc.querySelectorAll('.ip-lcd-in');
    const roots = glasses.length ? [...glasses] : [doc.getElementById('h')];
    for (const g of roots) for (const b of g.querySelectorAll('button[class]')) out.add(b.classList[0]);
  }
  return out;
}
const OTHER_SKIN = /\.mms-(apple|spotify)\b/;
test('the screen census: no rule on or inside the LCD glass reads a WRAPPED palette token (it reads --pk-s-*)', () => {
  const chassis = ALL.find((r) => r.sel === '.mms-ipod' && /--pk-s-/.test(r.body));
  const wrapped = decls(chassis.body).filter(([p]) => /^--pk-s-/.test(p)).map(([, v]) => /^var\((--[a-z0-9-]+)\)$/.exec(v)[1]);
  assert.ok(wrapped.length >= 16, 'the screen roles wrap the palette (' + wrapped.length + ')');
  const inGlass = glassClasses();
  assert.ok(inGlass.has('ip-lcd-in') && inGlass.has('ipm-row') && inGlass.has('mms-row') && inGlass.has('ip-status'), 'the derived glass classes, the glass itself included (' + inGlass.size + ')');
  const reads = (body, t) => new RegExp('var\\(\\s*' + t + '\\s*[,)]').test(body);
  const bad = [];
  for (const r of ALL) {
    if (OTHER_SKIN.test(r.sel)) continue; // Cider's and Nordic's own screens share a few class names
    const classes = (r.sel.match(/\.([a-z][a-z0-9-]*)/g) || []).map((c) => c.slice(1));
    if (!classes.some((c) => inGlass.has(c))) continue;
    for (const t of wrapped) if (reads(r.body, t)) bad.push(r.sel + ' reads ' + t);
  }
  assert.deepStrictEqual(bad, [], 'a glass rule that bypasses the screen roles');
  // not vacuous: each spelling the census hunts - bare, with a fallback, spaced - is caught
  for (const probe of ['color:var(' + wrapped[0] + ');', 'color:var(' + wrapped[0] + ', #fff);', 'color:var( ' + wrapped[0] + ' );']) assert.ok(reads(probe, wrapped[0]), probe);
  assert.ok(!reads('color:var(' + wrapped[0] + '-x);', wrapped[0]), 'a longer token name is not a read');
});

test('the Original: every button the renderers put in the glass inherits the bitmap face AND its size adjust', () => {
  // a button's UA font shorthand resets both (48ef515f; gate r1 adversary S1: the quick-scroll letter and badge)
  const buttons = [...glassButtons()].sort();
  assert.ok(buttons.includes('ipm-row') && buttons.includes('mms-row'), 'the derived glass buttons (' + buttons.join(' ') + ')');
  const rule = ALL.filter((r) => /font-size-adjust:\s*inherit/.test(r.body) && /font-family:\s*inherit/.test(r.body) && /mms-look-original/.test(r.sel));
  assert.strictEqual(rule.length, 1, 'ONE inherit rule on the look');
  const covered = rule[0].sel.split(',').map((x) => x.trim());
  for (const b of buttons) assert.ok(covered.includes('.mms-look-original .' + b), 'the glass button .' + b + ' inherits the face and the adjust');
});

function classify(html) {
  const doc = new JSDOM('<div id="h">' + html + '</div>').window.document;
  const found = [];
  for (const el of doc.querySelectorAll('#h *')) {
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (own) found.push(el);
  }
  return found;
}
function key(el) {
  const c = [...el.classList];
  if (c.includes('ipm-lbl') && el.closest('.ipm-noterow')) return 'ipm-noterow ipm-lbl';
  return c.find((x) => /^(ip|ipm|mms)-/.test(x)) || '(' + el.tagName.toLowerCase() + ' with no class)';
}

test('AC6: ONE text-line rule, and every text element on every pocket level is a text line, a wrap, or a glyph', () => {
  const lines = textLineClasses();
  for (const c of ['ip-np', 'ip-ttl', 'ip-artist', 'ip-album', 'mms-rt', 'ipm-lbl', 'ipm-about-name']) assert.ok(lines.includes(c), c + ' is a text line');
  const unclassified = new Set();
  let n = 0;
  for (const html of pocketLevels()) {
    for (const el of classify(html)) {
      n += 1;
      const k = key(el);
      if (WRAP.includes(k) || GLYPH.includes(k)) continue;
      if (!lines.includes(k)) unclassified.add(k + ': "' + el.textContent.slice(0, 30) + '"');
    }
  }
  assert.ok(n > 40, 'precondition: the census read the rendered text (' + n + ' elements)');
  assert.deepStrictEqual([...unclassified], [], 'a text element that is neither a text line, a wrap nor a glyph - classify it');
  // not vacuous: a NEW text element the lists do not know fails
  const extra = classify('<div class="ip-lcd"><span class="ip-newline">' + LONG + '</span></div>').map(key);
  assert.ok(extra.includes('ip-newline') && !lines.includes('ip-newline') && !WRAP.includes('ip-newline') && !GLYPH.includes('ip-newline'));
});

test('AC6: no pocket rule re-declares the line by hand (ellipsis / nowrap live in the ONE rule; the wraps are the named exceptions)', () => {
  const pocket = ALL.filter((r) => POCKET(r.sel));
  const hand = pocket.filter((r) => /text-overflow\s*:\s*ellipsis/.test(r.body)).map((r) => r.sel);
  assert.strictEqual(hand.length, 1, 'only the text-line rule ellipsizes: ' + hand.join(' || '));
  const wraps = pocket.filter((r) => /white-space\s*:\s*(normal|pre-wrap|pre-line|break-spaces)/.test(r.body)).map((r) => r.sel);
  assert.deepStrictEqual(wraps, ['.mms-ipod .ipm-noterow .ipm-lbl'], 'the one deliberate wrap');
  // the wrap exception comes AFTER the text line (equal-or-higher specificity + later = it wins)
  assert.ok(CSS.indexOf('.mms-ipod .ipm-noterow .ipm-lbl{') > CSS.indexOf('.mms-ipod .ipm-about-name{ min-width:0; white-space:nowrap;'), 'the wrap follows the line');
});
