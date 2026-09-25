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

const ROOT = path.join(__dirname, '..', '..');
const RAW = fs.readFileSync(path.join(ROOT, 'public', 'css', 'style.css'), 'utf8');
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
  'ipod-gold': {
    '--pk-c-body': 'linear-gradient(146deg, var(--mms-ipod-sheen-a) 0%, var(--mms-ipod-sheen-b) 12%, var(--mms-ipod-sheen-0) 34%), linear-gradient(158deg, #b98629 0%, #a8761f 38%, #a17118 55%, #8c6112 80%, #7b540c 100%)',
    '--pk-c-body-edge': '#5a3a06',
    '--pk-c-wheel-1': '#f1f2f0', '--pk-c-wheel-2': '#e1e3e0', '--pk-c-wheel-sheen': 'var(--mms-ipod-sheen-d)', '--pk-c-wheel-oy': '40%',
    '--pk-c-wheel-label': '#c0c7c0',
    '--pk-c-center-1': '#c8940f', '--pk-c-center-2': '#b07e07', '--pk-c-center-oy': '38%',
    '--pk-c-lit-band': 'rgba(255,255,255,.22)', '--pk-c-lit-band2': 'rgba(255,255,255,.13)',
    '--pk-c-lits-band': 'rgba(255,255,255,.32)', '--pk-c-lits-band2': 'rgba(255,255,255,.18)', '--pk-c-lits-core': 'rgba(255,255,255,.46)',
    '--pk-c-lita-glow': '255,210,125', '--pk-c-lita-core': '255,238,196',
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
  const defs = ALL.filter((r) => decls(r.body).some(([p]) => /^--pk-(?!c-)/.test(p)));
  assert.deepStrictEqual(defs.map((r) => r.sel), ['.mms-ipod'], 'one chassis rule holds the structure + type tokens');
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
