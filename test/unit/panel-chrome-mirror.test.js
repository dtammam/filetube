'use strict';

// [UNIT] v1.68.3 (Dean, on-device): design-language convergence locks.
//
// Three findings from one report: (1) the v1.67 card-corner <select>s
// shipped BARE - a class with no CSS behind it - because nothing styles
// selects by default and no instrument can see a MISSING rule (the census
// governs literals PRESENT in declarations); the move-modal select was
// bare the same way, and the one-off modal had shipped this exact class
// before (its scoped fix left the class open). (2) The queue panel slammed
// shut on an empty queue instead of showing an empty state. (3) The queue
// panel's clear button had drifted from the notification panel's design
// language - two hand-rolled stylings for the same affordance.
//
// The locks:
//   - the BASE `select` element rule exists with the tokened declarations
//     (the structural fix: the styled path is the default);
//   - the queue/notif panel chrome pairs are declaration-IDENTICAL (edit
//     either side and this forces the other, or a deliberate lock update);
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

// Extract a rule's declarations as a SORTED array of `prop: value` strings,
// comments stripped - order-insensitive, whitespace-insensitive.
function declarations(css, selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:^|\\n)${esc} \\{([\\s\\S]*?)\\}`);
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

// ---- queue panel chrome mirrors the notification panel ----------------------

for (const [queueSel, notifSel] of [
  ['.queue-panel-header', '.notif-panel-header'],
  ['.queue-clear-btn', '.notif-clear-btn'],
  ['.queue-clear-btn:hover', '.notif-clear-btn:hover'],
  ['.queue-empty', '.notif-empty'],
]) {
  test(`panel mirror: ${queueSel} is declaration-identical to ${notifSel}`, () => {
    assert.deepStrictEqual(declarations(STYLE_CSS, queueSel), declarations(STYLE_CSS, notifSel),
      `${queueSel} must carry exactly ${notifSel}'s declarations - one panel design language`);
  });
}

// ---- the queue empty posture (comment-stripped source locks) ----------------

const STRIPPED_COMMON = COMMON_JS
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map((l) => l.replace(/\/\/.*$/, ''))
  .join('\n');

test('an OPEN queue panel never auto-closes on empty: the setChrome close call is GONE', () => {
  assert.ok(!STRIPPED_COMMON.includes('if (btn.hidden && !panel.hidden) closePanel();'),
    'the auto-close that raced ahead of the empty state must not return');
  // The button-hiding half of ruling 4 survives.
  assert.ok(STRIPPED_COMMON.includes('btn.hidden = !shouldShowQueueButton(q);'),
    'the queue button still hides when the queue empties (ruling 4)');
});

test('the empty queue renders the bell-style empty message', () => {
  assert.ok(
    STRIPPED_COMMON.includes("renderEmpty('No queued items yet. Items you queue up to play show here.')"),
    'the exact empty copy, in the renderRows zero-models path'
  );
});
