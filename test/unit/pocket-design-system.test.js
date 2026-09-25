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
  // v1.332 (D2): sampled from Commons "Product Red iPod nano.jpg" - the side-by-side cites every value
  'ipod-red': {
    '--pk-c-body': 'linear-gradient(180deg, rgba(255,255,255,.22) 0, var(--mms-ipod-sheen-0) 1.8%), linear-gradient(90deg, rgba(0,0,0,.24) 0%, rgba(0,0,0,.06) 14%, var(--mms-ipod-clear) 30%, var(--mms-ipod-clear) 58%, rgba(255,255,255,.1) 78%, var(--mms-ipod-clear) 90%, rgba(0,0,0,.16) 100%), linear-gradient(180deg, #ee2b3e 0%, #e82639 30%, #e02031 60%, #d4192b 82%, #c41424 100%)',
    '--pk-c-body-edge': '#8e0e18',
    '--pk-c-wheel-1': '#f7f9f8', '--pk-c-wheel-2': '#e5e9e7', '--pk-c-wheel-sheen': 'var(--mms-ipod-sheen-d)', '--pk-c-wheel-oy': '40%',
    '--pk-c-wheel-label': '#c4cfcf',
    '--pk-c-center-1': '#f6475d', '--pk-c-center-2': '#ea3348', '--pk-c-center-oy': '38%',
    '--pk-c-lit-band': 'rgba(255,255,255,.2)', '--pk-c-lit-band2': 'rgba(255,255,255,.12)',
    '--pk-c-lits-band': 'rgba(255,255,255,.3)', '--pk-c-lits-band2': 'rgba(255,255,255,.17)', '--pk-c-lits-core': 'rgba(255,255,255,.45)',
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
