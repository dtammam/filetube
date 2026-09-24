// v1.316 (Dean, B2): the /subscriptions row chips (pin / push-bell / kebab)
// are styled with each era's REAL control treatment by being real `.btn`s
// (`btn btn-chip <role>`), not by a hand-copied per-chip bevel.
//
// Why a lock and not only a look: the 2009 gloss is a `background-image` on
// `.btn` alone; the 2005 flat bevel / 2014 flat / 2021 shadow ride `.btn`'s
// `--btn-bg` + `--shadow`. A chip that declares its own background / border /
// radius / shadow anywhere would paint OVER the era treatment (or drift from
// it) and the row would silently fall out of the design language again. So:
//   AC4  - every chip builder writes `btn btn-chip`; no rule targeting a chip
//          role class declares a box property (vendor + case variants included);
//          `.btn-chip` declares none either; the 2009 gloss still targets `.btn`.
//   AC3  - ONE writer of the bell's rendered state (the glyph literals appear
//          exactly once, inside applyBellState; the builder calls it).
// Plan: docs/exec-plans/completed/2026-09-23-sub-bell-polish.md.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'css', 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const JS_RAW = fs.readFileSync(path.join(ROOT, 'lib', 'ytdlp', 'client', 'subscriptions.js'), 'utf8');
const JS = JS_RAW.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
const { createSubscriptionRow, applyBellState } = require('../../lib/ytdlp/client/subscriptions.js');
// The row builder reaches for common.js's avatar helpers as page globals.
const common = require('../../public/js/common.js');
global.resolveAvatarSource = common.resolveAvatarSource;
global.deriveAvatar = common.deriveAvatar;

// v1.317 (QA r2 suggestion on v1.316.0): the `-active` modifier tokens join the census so a
// future `.sub-row-bell-active { background }` cannot slip past the box-property lock.
const ROLES = ['sub-row-pin', 'sub-row-bell', 'sub-row-kebab', 'sub-row-pin-active', 'sub-row-bell-active'];

// Every rule block whose selector list mentions `sel` (as a class token).
function rulesTargeting(css, sel) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const selectors = m[1].trim();
    if (new RegExp(`\\.${sel}(?![\\w-])`).test(selectors)) out.push({ selectors, body: m[2] });
  }
  return out;
}
// The box properties that carry an era's control treatment. Case-insensitive
// and vendor-prefix-aware (the v1.313 lesson: a lower-case list is porous).
// Gate r1 (qa #4, adversary #3): widened past the first cut - min/max box,
// margin/inset, aspect-ratio, flex-basis, box-sizing, opacity, transform/scale/
// translate/filter/mask, the `-o-` prefix - so a deforming or repainting rule on
// a role class cannot ship with AC4 green.
const BOX_PROP = /(^|[;\s])(-(?:webkit|moz|ms|o)-)?(background(?:-[a-z]+)?|border(?:-[a-z-]+)?|box-shadow|box-sizing|(?:min-|max-)?(?:width|height)|padding(?:-[a-z]+)?|margin(?:-[a-z]+)?|inset(?:-[a-z]+)?|aspect-ratio|flex(?:-[a-z]+)?|outline(?:-[a-z]+)?|opacity|transform|scale|translate|filter|mask(?:-[a-z]+)?|clip-path)\s*:/i;
// A DIVERGENT selector that could still reach a chip: any rule whose selector
// list names a subscription-row ancestor AND a bare `button`/`.btn` descendant
// (e.g. `.sub-row > button`, `.sub-list .btn`) - the adversary's MI3 survivor.
function rulesReachingChipsByAncestor(css) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const selectors = m[1].trim();
    if (/@(media|supports|container)/.test(selectors)) continue;
    if (/\.sub-(row|list|section)(?![\w-])[^,]*(\bbutton\b|\.btn(?![\w-]))/.test(selectors)) out.push({ selectors, body: m[2] });
  }
  return out;
}

test('AC4: createSubscriptionRow builds pin, bell and kebab as `btn btn-chip <role>` (executed, real DOM)', () => {
  const { document } = new JSDOM('<!doctype html><body></body>').window;
  const row = createSubscriptionRow(
    { id: 'c1', name: 'Chip', channelUrl: 'https://www.youtube.com/@chip', channelDir: '/data/chip', pushBell: true },
    document, {}, null, true,
  );
  const buttons = [...row.querySelectorAll('button')];
  assert.deepStrictEqual(buttons.map((b) => b.className), [
    'btn btn-chip sub-row-pin sub-row-pin-active',
    'btn btn-chip sub-row-bell sub-row-bell-active',
    'btn btn-chip sub-row-kebab',
  ]);
  for (const b of buttons) assert.ok(b.classList.contains('btn') && b.classList.contains('btn-chip'), `${b.className} is a .btn.btn-chip`);
  const off = createSubscriptionRow({ id: 'c2', name: 'Off', channelUrl: 'https://www.youtube.com/@off' }, document, {}, null, false);
  assert.deepStrictEqual([...off.querySelectorAll('button')].map((b) => b.className), ['btn btn-chip sub-row-bell', 'btn btn-chip sub-row-kebab']);
});

test('AC4: no rule targeting a chip role class declares a box property - the era treatment can only come from .btn', () => {
  for (const role of ROLES) {
    const rules = rulesTargeting(CSS, role);
    assert.ok(rules.length > 0, `${role} still has its state-colour rules`);
    for (const r of rules) {
      assert.doesNotMatch(r.body, BOX_PROP, `${r.selectors.replace(/\s+/g, ' ')} must not declare a box property (got: ${r.body.trim().replace(/\s+/g, ' ')})`);
      assert.doesNotMatch(r.body, /gradient|filter|transform|mask|clip-path|scale|translate/i, `${role}: no paint/transform of its own`);
    }
  }
  for (const r of rulesReachingChipsByAncestor(CSS)) {
    assert.doesNotMatch(r.body, BOX_PROP, `${r.selectors.replace(/\s+/g, ' ')} reaches the chips through an ancestor selector and must not declare a box property (got: ${r.body.trim().replace(/\s+/g, ' ')})`);
  }
});

test('AC4: .btn-chip exists, declares NO background/border/radius/shadow (any spelling), sits AFTER .btn so its padding/size win, and its only other rule is the phone touch-floor exemption', () => {
  const chip = rulesTargeting(CSS, 'btn-chip');
  assert.ok(chip.length >= 1, 'the .btn-chip base rule exists');
  // Any FURTHER .btn-chip rule may only re-floor the box (the v1.95 mobile
  // `.btn { min-height: 44px }` would otherwise stretch the square chip).
  for (const extra of chip.slice(1)) {
    assert.match(extra.body.trim(), /^min-height:\s*var\(--size-control-sm\);?$/, `a second .btn-chip rule may only pin min-height (got: ${extra.body.trim()})`);
  }
  assert.strictEqual(chip.length, 2, 'the base rule + the phone floor exemption, nothing else');
  const body = chip[0].body;
  assert.doesNotMatch(body, /(^|[;\s])(-(?:webkit|moz|ms|o)-)?(background(?:-[a-z]+)?|border(?:-[a-z-]+)?|box-shadow|box-sizing|min-(?:width|height)|max-(?:width|height)|margin(?:-[a-z]+)?|inset(?:-[a-z]+)?|aspect-ratio|opacity|transform|scale|translate|filter|mask(?:-[a-z]+)?|clip-path)\s*:/i, '.btn-chip declares no fill/border/shadow and no second box constraint of its own (adversary MJ2: a min-width would stretch the square)');
  assert.doesNotMatch(body, /gradient|filter|transform|mask|opacity/i);
  assert.match(body, /width:\s*var\(--size-control-sm\)/);
  assert.match(body, /height:\s*var\(--size-control-sm\)/);
  assert.match(body, /padding:\s*0\b/, 'drops .btn\'s text padding');
  assert.match(body, /justify-content:\s*center/);
  const btnAt = CSS.search(/\n\.btn \{/);
  const chipAt = CSS.search(/\n\.btn-chip \{/);
  assert.ok(btnAt !== -1 && chipAt > btnAt, '.btn-chip must come after .btn (equal specificity: source order wins for padding)');
});

test('AC4: the 2009 gloss (light + dark) still targets .btn - the chip inherits it by BEING a .btn, not by a copy', () => {
  assert.match(CSS, /\[data-theme="2009"\]\[data-mode="light"\] \.btn \{[^}]*background-image:\s*linear-gradient/);
  assert.match(CSS, /\[data-theme="2009"\]\[data-mode="dark"\] \.btn \{[^}]*background-image:\s*linear-gradient/);
  for (const role of ROLES) {
    assert.doesNotMatch(CSS, new RegExp(`\\[data-theme="[0-9]+"\\][^{]*\\.${role}(?![\\w-])`), `no per-era hand copy for .${role}`);
  }
  assert.doesNotMatch(CSS, /\[data-theme="[0-9]+"\][^{]*\.btn-chip(?![\w-])/, 'no per-era hand copy for .btn-chip');
});

test('AC3: ONE writer of the bell state - the glyph literals appear exactly once (in applyBellState), the builder calls it, and the writer sets class + aria + glyph together', () => {
  const on = (JS.match(/🔔/g) || []).length;
  const off = (JS.match(/🔕/g) || []).length;
  assert.strictEqual(on, 1, 'the ON glyph is written in exactly one place');
  assert.strictEqual(off, 1, 'the OFF glyph is written in exactly one place');
  const fnStart = JS.indexOf('function applyBellState(bellBtn, on) {');
  assert.ok(fnStart !== -1);
  const fn = JS.slice(fnStart, JS.indexOf('\n}', fnStart));
  assert.match(fn, /🔔/);
  assert.match(fn, /aria-pressed/);
  assert.match(fn, /aria-label/);
  assert.match(fn, /'btn btn-chip sub-row-bell sub-row-bell-active' : 'btn btn-chip sub-row-bell'/);
  // the builder routes through the writer (no second copy of the four lines)
  const rowStart = JS.indexOf('function createSubscriptionRow(');
  const rowFn = JS.slice(rowStart, JS.indexOf('\n}', rowStart));
  assert.match(rowFn, /applyBellState\(bellBtn, sub\.pushBell === true\)/);
  assert.doesNotMatch(rowFn, /bellBtn\.className =/, 'the builder never writes the bell class itself');
  // executed: the writer is the same function the module exports
  const { document } = new JSDOM('<button></button>').window;
  const b = document.querySelector('button');
  applyBellState(b, true);
  assert.deepStrictEqual([b.className, b.getAttribute('aria-pressed'), b.textContent], ['btn btn-chip sub-row-bell sub-row-bell-active', 'true', '🔔']);
  applyBellState(b, 1);
  assert.deepStrictEqual([b.className, b.getAttribute('aria-pressed'), b.textContent], ['btn btn-chip sub-row-bell', 'false', '🔕'], 'only boolean true is ON');
});
