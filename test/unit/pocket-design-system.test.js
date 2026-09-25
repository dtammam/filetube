'use strict';

// [UNIT] The pocket design system (v1.332, plan docs/exec-plans/active/2026-09-25-pocket-design-system.md).
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
  '--pk-c-lit-band', '--pk-c-lit-band2', '--pk-c-lits-band', '--pk-c-lits-band2', '--pk-c-lits-core'];
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

test('AC4: no rule but its own block names a colorway class - the structural rules exist ONCE', () => {
  const others = clickIds().filter((id) => id !== 'ipod').map(classOf);
  assert.ok(others.length >= 2, 'precondition: the non-default colorways');
  const bad = [];
  for (const r of ALL) {
    for (const cls of others) {
      const re = new RegExp('\\.' + cls + '(?![\\w-])');
      if (re.test(r.sel) && r.sel !== '.' + cls) bad.push(r.sel);
    }
  }
  assert.deepStrictEqual(bad, [], 'a colorway-specific structural rule');
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
  },
  'ipod-black': {
    '--pk-c-body': SHEEN_BODY + ', linear-gradient(158deg, #343436, #161618)',
    '--pk-c-body-edge': '#0a0a0b',
    '--pk-c-wheel-1': '#3d3d3f', '--pk-c-wheel-2': '#232325', '--pk-c-wheel-sheen': 'var(--mms-ipod-sheen-d)', '--pk-c-wheel-oy': '40%',
    '--pk-c-wheel-label': '#b9babd',
    '--pk-c-center-1': '#343436', '--pk-c-center-2': '#161618', '--pk-c-center-oy': '40%',
    '--pk-c-lit-band': 'rgba(255,255,255,.16)', '--pk-c-lit-band2': 'rgba(255,255,255,.09)',
    '--pk-c-lits-band': 'rgba(255,255,255,.26)', '--pk-c-lits-band2': 'rgba(255,255,255,.14)', '--pk-c-lits-core': 'rgba(255,255,255,.4)',
  },
  'ipod-matte': {
    '--pk-c-body': 'linear-gradient(180deg, rgba(255,255,255,.26) 0, var(--mms-ipod-sheen-0) 2.2%), linear-gradient(90deg, rgba(0,0,0,.30) 0%, rgba(0,0,0,.04) 15%, var(--mms-ipod-clear) 30%, var(--mms-ipod-clear) 70%, rgba(0,0,0,.04) 85%, rgba(0,0,0,.30) 100%), linear-gradient(180deg, #949497 0%, #86868a 7%, #7a7a7e 40%, #6a6a70 55%, #4a4a50 74%, #2d2d32 90%, #1c1c21 100%)',
    '--pk-c-body-edge': '#0a0a0b',
    '--pk-c-wheel-1': '#343437', '--pk-c-wheel-2': '#242427', '--pk-c-wheel-sheen': 'rgba(255,255,255,.42)', '--pk-c-wheel-oy': '42%',
    '--pk-c-wheel-label': '#b9babd',
    '--pk-c-center-1': '#6e6e72', '--pk-c-center-2': '#55555a', '--pk-c-center-oy': '38%',
    '--pk-c-lit-band': 'rgba(255,255,255,.09)', '--pk-c-lit-band2': 'rgba(255,255,255,.05)',
    '--pk-c-lits-band': 'rgba(255,255,255,.14)', '--pk-c-lits-band2': 'rgba(255,255,255,.08)', '--pk-c-lits-core': 'rgba(255,255,255,.22)',
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
const POCKET = (sel) => /\.mms-ipod\b/.test(sel) || /body\.mms-tray \.(ip-|ipm-)/.test(sel);
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
