// v1.316 (Dean, B2) -> UI pass S5: the /subscriptions row controls (pin / push-bell /
// menu) carry each era's REAL control treatment by BEING the one control primitive,
// not by a hand-copied per-control bevel.
//
// v1.316 made them `btn btn-chip <role>`; UI pass S5 converts that lock (AC12, the
// plan's triage row "ui-btn era treatment attached once; role classes box-free"):
//   AC4  - every row control is a ui.button (`ui-btn ui-btn--plain ui-btn--icon` +
//          a role class); NO style.css or ui.css rule names a role class (so nothing
//          can paint over or drift from the primitive), no per-era rule copies one,
//          and the retired `.sub-row*` / `.btn-chip` family is gone for good;
//   AC3  - ONE writer of the bell's rendered state (applyBellState -> ui.setPressed);
//          the builder declares the bell's two glyphs exactly once.
// Plan: docs/exec-plans/completed/2026-09-23-sub-bell-polish.md; UI pass D4.1/D4.9.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const STYLE = strip(fs.readFileSync(path.join(ROOT, 'public', 'css', 'style.css'), 'utf8'));
const UI = strip(fs.readFileSync(path.join(ROOT, 'public', 'css', 'ui.css'), 'utf8'));
const JS_RAW = fs.readFileSync(path.join(ROOT, 'lib', 'ytdlp', 'client', 'subscriptions.js'), 'utf8');
const JS = JS_RAW.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
const { createSubscriptionRow, applyBellState } = require('../../lib/ytdlp/client/subscriptions.js');

const ROLES = ['subs-pin', 'subs-bell', 'subs-more'];
const doc = () => new JSDOM('<!doctype html><body></body>').window.document;

// Every rule block whose selector list mentions `.sel` as a class token.
function rulesTargeting(css, sel) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    if (new RegExp(`\\.${sel}(?![\\w-])`).test(m[1])) out.push(m[1].trim());
  }
  return out;
}

test('AC4: createSubscriptionRow builds pin, bell and menu as plain icon ui-btns with a role class (executed, real DOM)', () => {
  const d = doc();
  const row = createSubscriptionRow({ id: 's1', name: 'Alpha', channelDir: '/dl/Alpha', pushBell: true }, d, {}, undefined, true);
  const acts = [...row.querySelector('.ui-row__actions').children];
  assert.strictEqual(acts.length, 3, 'three trailing slots');
  ROLES.forEach((role, i) => {
    const b = acts[i];
    assert.strictEqual(b.tagName, 'BUTTON', `${role} is a button`);
    assert.deepStrictEqual(b.className.split(' '), ['ui-btn', 'ui-btn--plain', 'ui-btn--md', 'ui-btn--icon', role], `${role} is exactly a plain icon ui-btn + its role`);
    assert.ok(b.getAttribute('aria-label'), `${role} is named`);
    assert.ok(b.querySelector('.ui-btn__icon > svg.ui-icon use'), `${role} draws a sprite glyph (no text glyph)`);
  });
});

test('AC4: no stylesheet rule names a row-control role class - the treatment can only come from .ui-btn', () => {
  for (const role of ROLES) {
    assert.deepStrictEqual(rulesTargeting(STYLE, role), [], `style.css must not style .${role}`);
    assert.deepStrictEqual(rulesTargeting(UI, role), [], `ui.css must not style .${role}`);
  }
});

test('AC4: the retired .sub-row* / .btn-chip family is gone (no rule, no builder) - nothing can reach a row control by ancestry', () => {
  assert.doesNotMatch(STYLE, /\.sub-row(?![\w-])|\.sub-row-[a-z-]+|\.btn-chip(?![\w-])|\.sub-sheet|\.sub-list(?![\w-])/, 'no .sub-row* / .btn-chip / .sub-sheet / .sub-list rule remains');
  assert.doesNotMatch(JS, /btn-chip|'sub-row/, 'the client builds none of them');
  // a divergent ancestor selector could still reach the controls: the channel list (or a row
  // keyed by data-sub-id) with a bare button / .ui-btn descendant
  const reaching = [];
  const re = /([^{}]+)\{[^{}]*\}/g;
  let m;
  while ((m = re.exec(STYLE))) {
    for (const sel of m[1].split(',')) {
      if (/(\.subs-(list|sections)(?![\w-])|\[data-sub-id)[^,]*(\bbutton\b|\.ui-btn(?![\w-]))/.test(sel)) reaching.push(sel.trim());
    }
  }
  assert.deepStrictEqual(reaching, [], 'no channel-list ancestor rule styles its buttons');
});

test('AC4: the era treatment is attached ONCE, on the primitive - no per-era rule copies a role class', () => {
  assert.match(UI, /\[data-theme="2009"\] \.ui-btn--secondary,\s*\[data-theme="2009"\] \.ui-btn--tonal \{\s*background: var\(--btn-fill\);/, 'the 2009 gloss rides the primitive');
  assert.match(UI, /\[data-theme="2005"\] \.ui-btn--icon,/, '2005 squares every icon button');
  for (const css of [STYLE, UI]) {
    for (const role of ROLES) {
      assert.doesNotMatch(css, new RegExp(`\\[data-theme="[0-9]+"\\][^{]*\\.${role}(?![\\w-])`), `no per-era hand copy for .${role}`);
    }
  }
});

test('AC3: ONE writer of the bell state - applyBellState is ui.setPressed, the builder declares the two glyphs once, and only boolean true is ON', () => {
  assert.strictEqual((JS.match(/'notifications_off'/g) || []).length, 1, 'the OFF glyph is named in exactly one place');
  assert.strictEqual((JS.match(/'notifications_active'/g) || []).length, 1, 'the ON glyph is named in exactly one place');
  assert.doesNotMatch(JS, /\u{1F514}|\u{1F515}|🔔|🔕/u, 'no emoji bell');
  const fnStart = JS.indexOf('function applyBellState(bellBtn, on) {');
  assert.ok(fnStart !== -1);
  const fn = JS.slice(fnStart, JS.indexOf('\n}', fnStart));
  assert.match(fn, /subsUi\(\)\.setPressed\(bellBtn, on === true\)/, 'the writer is the primitive\'s pressed writer');
  const rowStart = JS.indexOf('function createSubscriptionRow(');
  const rowFn = JS.slice(rowStart, JS.indexOf('\n}', rowStart));
  assert.match(rowFn, /pressed: sub\.pushBell === true/, 'the build reads the record\'s boolean truth');
  assert.doesNotMatch(rowFn, /bellBtn\.className =/, 'the builder never writes the bell class itself');
  // executed: the writer flips aria-pressed and the drawn glyph together
  const d = doc();
  const row = createSubscriptionRow({ id: 's1', name: 'Alpha', pushBell: false }, d, {});
  const b = row.querySelector('.subs-bell');
  const drawn = () => b.querySelector('.ui-btn__icon use').getAttribute('href');
  assert.deepStrictEqual([b.getAttribute('aria-pressed'), drawn()], ['false', '#i-notifications_off']);
  applyBellState(b, true);
  assert.deepStrictEqual([b.getAttribute('aria-pressed'), drawn(), b.querySelectorAll('svg').length], ['true', '#i-notifications_active', 1]);
  applyBellState(b, 1);
  assert.deepStrictEqual([b.getAttribute('aria-pressed'), drawn(), b.querySelectorAll('svg').length], ['false', '#i-notifications_off', 1], 'only boolean true is ON; the glyph is swapped, never stacked');
});
