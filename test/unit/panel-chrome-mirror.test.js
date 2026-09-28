'use strict';

// [UNIT] v1.68.3 (Dean, on-device): design-language convergence locks.
//
// Three findings from one report: (1) the v1.67 card-corner <select>s
// shipped BARE - a class with no CSS behind it - because nothing styles
// selects by default and no instrument can see a MISSING rule (the census
// governs literals PRESENT in declarations); the move-modal select and
// the ytdlp failures-filter select (its 'form-input' class binds NO rule
// anywhere - gate W1's catch) were bare the same way, and the one-off
// modal had shipped this exact class before (its scoped fix left the
// class open). (2) The queue panel slammed
// shut on an empty queue instead of showing an empty state. (3) The queue
// panel's clear button had drifted from the notification panel's design
// language - two hand-rolled stylings for the same affordance.
//
// The locks:
//   - the BASE `select` element rule exists with the tokened declarations
//     (the structural fix: the styled path is the default);
//   - (sweep S4) the queue and notification panels are ONE primitive (ui.sheet), so the
//     v1.68.3 declaration mirror became "no hand-built panel family is styled again";
//   - the queue panel's empty posture (no auto-close, the bell-style copy)
//     is bound as comment-stripped source (execution vacuity disclosed
//     under tech-debt #78's class - the DOM chrome has no jsdom harness).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.join(__dirname, '..', '..');
const STYLE_CSS = fs.readFileSync(path.join(REPO, 'public', 'css', 'style.css'), 'utf8');
const COMMON_JS = fs.readFileSync(path.join(REPO, 'public', 'js', 'common.js'), 'utf8');
const { cssRules } = require('../helpers/stylesheets');

// Extract a rule's declarations as a SORTED array of `prop: value` strings,
// comments stripped - order-insensitive, whitespace-insensitive. A rule may be
// indented: UI pass step 4 (AC6) moved every :hover rule inside @media (hover: hover).
function declarations(css, selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:^|\\n)[ ]*${esc} \\{([\\s\\S]*?)\\}`);
  const m = re.exec(css);
  assert.ok(m, `rule found: ${selector}`);
  return m[1]
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(';')
    .map((d) => d.replace(/\s+/g, ' ').trim())
    .filter((d) => d !== '')
    .sort();
}

// ---- the base <select> rule (the structural fix) ----------------------------

test('a BASE `select` element rule exists and carries the full tokened control styling', () => {
  const decls = declarations(STYLE_CSS, 'select');
  for (const required of [
    'padding: var(--space-5) var(--space-6)',
    'border: 1px solid var(--border-dark)',
    'border-radius: var(--radius)',
    'font-size: var(--fs-base)',
    'background-color: var(--bg-color)',
    'color: var(--text-primary)',
    'cursor: pointer',
  ]) {
    assert.ok(decls.includes(required), `base select rule carries: ${required}`);
  }
});

test('the base select rule mirrors .setup-select (the settings pattern it was lifted from)', () => {
  assert.deepStrictEqual(declarations(STYLE_CSS, 'select'), declarations(STYLE_CSS, '.setup-select'),
    'base select and .setup-select must not drift apart');
});

// ---- the queue and notification panels: ONE primitive (sweep S4) ------------
//
// v1.68.3 locked the two hand-built panels' chrome declaration-identical (header, Clear
// button, empty state) so they could not drift apart. Sweep S4 (AC12 conversion) makes the
// drift impossible by construction: both panels ARE ui.sheet, their rows ui-rows, their
// empty states ui.state, their Clear buttons ui.button - and the one surface rule they keep
// is shared. What the mirror guarded is bound here as: no stylesheet still styles either
// hand-built family, the shared rule is ONE rule naming both, and (behaviourally, in
// notif-panel-sheet.test.js) both panels render through the same builders.
const UI_CSS = fs.readFileSync(path.join(REPO, 'public', 'css', 'ui.css'), 'utf8');
test('panel mirror (sweep S4): neither retired panel family has a rule left; the Clear rows share ONE rule', () => {
  for (const r of cssRules(STYLE_CSS)) {
    assert.doesNotMatch(r.sel, /\.(?:notif|queue)-(?:panel|row|clear|empty)\b/, `a retired panel selector is styled again: ${r.sel}`);
  }
  const tools = cssRules(STYLE_CSS).filter((r) => /\.(?:notif|queue)-sheet__tools/.test(r.sel));
  assert.strictEqual(tools.length, 1, 'one rule');
  assert.match(tools[0].sel, /\.notif-sheet__tools/);
  assert.match(tools[0].sel, /\.queue-sheet__tools/);
});

// ---- nothing scrolls under the panel header (v1.68.3's two device reports) ----
//
// The bug (Dean, on-device, twice): the old panels' header was position:sticky INSIDE the
// scroller, and the rows' positioned thumbnails - then the z-index:2 duration badge, which
// escaped the thumb wrapper to the panel root - painted OVER it as they scrolled under. The
// v1.68.3 fix was a z-index on the header plus `isolation: isolate` on the thumb wrapper.
// Sweep S4 keeps the guarantee by structure, and binds each link: the ui.sheet header is a
// SIBLING of the one scroller (.ui-sheet__body), never inside it, so nothing in the list can
// scroll under it; the scroller clips its content; and the duration badge's container
// (.ui-thumb) is a positioned, clipping box with no z-index stacked above it anywhere.
test('the panel header sits OUTSIDE the scroller, and the scroller clips (no row can scroll under the header)', () => {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<!doctype html><body></body>');
  const ui = require('../../public/js/ui.js');
  const sheet = ui.sheet({ variant: 'dialog', title: 'Notifications', content: dom.window.document.createElement('div'), doc: dom.window.document, win: dom.window });
  const header = sheet.el.querySelector('.ui-sheet__header');
  assert.ok(header && header.parentNode === sheet.el, 'the header is a direct child of the sheet');
  assert.ok(!sheet.body.contains(header), 'the header is never inside the scrolling body');
  const rule = (sel) => cssRules(UI_CSS).find((r) => r.sel === sel && r.at === '');
  assert.match(rule('.ui-sheet__body').body, /overflow-y:\s*auto/, 'the body is the scroller');
  assert.match(rule('.ui-sheet').body, /overflow:\s*hidden/, 'the sheet clips (the anti-bleed split)');
  assert.doesNotMatch(rule('.ui-sheet__body').body, /border-radius/, 'the scroller carries no radius (LESSONS 6)');
  dom.window.close();
});

// The v1.68.3 isolation assertion, kept on the badge's container in the panel: it must
// establish a stacking context (a drop of the rule, or of the declaration, reds this).
test('the panel thumbnail (the duration badge\'s container) establishes a stacking context', () => {
  const decls = declarations(STYLE_CSS, '.notif-sheet .ui-thumb');
  assert.ok(decls.some((d) => /^isolation: isolate$/.test(d) || /^z-index: \S/.test(d)),
    '.notif-sheet .ui-thumb must create a stacking context (isolation: isolate)');
});

test('the duration badge stays inside its thumbnail: .ui-thumb is positioned and clipping, the badge carries no z-index', () => {
  const thumb = cssRules(UI_CSS).find((r) => r.sel === '.ui-thumb' && r.at === '');
  assert.match(thumb.body, /position:\s*relative/);
  assert.match(thumb.body, /overflow:\s*hidden/);
  for (const css of [UI_CSS, STYLE_CSS]) {
    for (const r of cssRules(css)) {
      if (/ui-thumb__duration/.test(r.sel)) assert.doesNotMatch(r.body, /z-index/, `no z-index lifts the badge: ${r.sel}`);
    }
  }
});

// ---- the queue empty posture (comment-stripped source locks) ----------------

const STRIPPED_COMMON = COMMON_JS
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map((l) => l.replace(/\/\/.*$/, ''))
  .join('\n');

test('an OPEN queue panel never auto-closes on empty: setChrome contains NO close call at all', () => {
  // Gate v1.68.3 S1 (measured): the first cut asserted the absence of one
  // exact spelling, and a reordered-condition respelling reintroduced the
  // bug green. Bind the whole body: no closePanel token, any spelling.
  const body = /const setChrome = \(q\) => \{([\s\S]*?)\n {6}\};/.exec(STRIPPED_COMMON);
  assert.ok(body, 'setChrome body found');
  assert.ok(!body[1].includes('closePanel'),
    'setChrome must never close the panel - the empty state renders instead');
  // The button-hiding half of ruling 4 survives.
  assert.ok(body[1].includes('btn.hidden = !shouldShowQueueButton(q);'),
    'the queue button still hides when the queue empties (ruling 4)');
});

test('the empty queue renders the bell-style empty message', () => {
  // Sweep S4: the empty state is a ui.state (title + body) - the same copy, split. The
  // rendered empty panel is driven in queue-panel-sheet.test.js.
  assert.ok(
    STRIPPED_COMMON.includes("U.state({ icon: 'queue_music', title: 'No queued items yet', body: 'Items you queue up to play show here.'"),
    'the exact empty copy, in the renderEmpty path'
  );
});
