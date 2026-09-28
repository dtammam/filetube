'use strict';

// v1.340 (Dean, 2026-09-26: "notify button shifts unreasonably - should be stable"): a two-state
// button whose words change must not change WIDTH. UI pass sweep S3 converted this lock (AC12;
// a RISKY conversion in the step 0 triage: gate r1 W1 found every v1.340 rule deletable with
// the suite green). The v1.340 mechanism (common.js stableToggleLabelHtml + the .btn-label-stack
// rules in style.css) is retired with its last callers (the watch channel row); the SAME
// mechanism is the ui-btn primitive's label stack (D4.1: ui.button({ labels }) + ui.setPressed),
// which the watch page's toggles now use. Three layers bind it:
//   1. by value here: the stack CSS in ui.css (every label in one grid cell, the idle ones
//      visibility:hidden - never display:none, which would drop their width);
//   2. by DOM here: the watch toggles are built with both labels (Like/Liked; Subscribe's pill
//      carries Subscribe/Subscribed) and the channel row's Notify / Pin are icon toggles (no
//      label to change);
//   3. by MEASUREMENT: test/geometry/watch.check.js toggles each in a real engine and compares
//      widths across states and across a subscribed / unsubscribed channel, mutation-proven
//      (its `stack-collapse` mutant, idle labels display:none, goes red).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '');
const UI_CSS = strip(fs.readFileSync(path.join(ROOT, 'public', 'css', 'ui.css'), 'utf8'));
const STYLE_CSS = strip(fs.readFileSync(path.join(ROOT, 'public', 'css', 'style.css'), 'utf8'));
const COMMON_SRC = fs.readFileSync(path.join(ROOT, 'public', 'js', 'common.js'), 'utf8');
const WATCH_SRC = fs.readFileSync(path.join(ROOT, 'public', 'js', 'watch.js'), 'utf8');

// The ONE top-level rule for a selector in a sheet, as { prop: value } (whitespace-normalized).
function decls(css, selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*');
  const found = [...css.matchAll(new RegExp('(^|[}\\s])' + esc + '\\s*\\{([^}]*)\\}', 'g'))];
  assert.strictEqual(found.length, 1, `exactly one rule for ${selector}`);
  const out = {};
  for (const d of found[0][2].split(';')) {
    const i = d.indexOf(':');
    if (i > 0) out[d.slice(0, i).trim()] = d.slice(i + 1).trim().replace(/\s+/g, ' ');
  }
  return out;
}

test('W1 (the primitive): every label shares ONE grid cell, so the button is as wide as its longest label', () => {
  assert.strictEqual(decls(UI_CSS, '.ui-btn__stack').display, 'grid');
  assert.strictEqual(decls(UI_CSS, '.ui-btn__stack > .ui-btn__slot')['grid-area'], '1 / 1');
});

test('W1 (the primitive): only the current label is visible - the idle ones keep their width (visibility, never display)', () => {
  assert.deepStrictEqual(decls(UI_CSS, '.ui-btn__stack > .ui-btn__slot[data-idle]'), { visibility: 'hidden' });
});

test('the watch toggles use the stack: Like carries Like + Liked, Subscribe carries Subscribe + Subscribed; Notify and Pin are icon toggles (no label to change)', () => {
  assert.match(WATCH_SRC, /icon: \{ off: 'favorite', on: 'favorite\.fill' \}, labels: \['Like', 'Liked'\]/);
  assert.match(WATCH_SRC, /stack\.className = 'ui-btn__label ui-btn__stack';\n\s*\['Subscribe', 'Subscribed'\]\.forEach/);
  assert.match(WATCH_SRC, /icon: \{ off: 'notifications_off', on: 'notifications_active' \},\n\s*pressed: false, ariaLabel:/);
  assert.match(WATCH_SRC, /icon: \{ off: 'keep', on: 'keep\.fill' \}, pressed: currentPinState\.pinned, ariaLabel: 'Pin channel'/);
  // one writer of the pressed state: ui.setPressed (it swaps the idle slot and the glyph)
  for (const fn of ['applySubscribeButtonLabel', 'applyPinButtonLabel', 'applyBellButtonLabel', 'applyLikeButtonLabel']) {
    const body = WATCH_SRC.slice(WATCH_SRC.indexOf('function ' + fn + '('), WATCH_SRC.indexOf('\n    }\n', WATCH_SRC.indexOf('function ' + fn + '(')));
    assert.match(body, /ui\.setPressed\(/, fn + ' writes through ui.setPressed');
    assert.ok(!/innerHTML/.test(body), fn + ' never rebuilds the label from a string');
  }
});

test('the v1.340 helper and its CSS are retired with their last callers (no second mechanism)', () => {
  assert.ok(!/stableToggleLabelHtml/.test(COMMON_SRC + WATCH_SRC), 'common.js stableToggleLabelHtml is gone');
  assert.ok(!/\.btn-label-stack|\.btn-label-slot|\.btn-glyph/.test(STYLE_CSS), 'its style.css rules are gone');
  assert.ok(!/btn-label-stack|btn-glyph/.test(fs.readFileSync(path.join(ROOT, 'public', 'watch.html'), 'utf8')));
});

test('the header bell draws the SHARED bell path (one glyph everywhere, not a private copy)', () => {
  // UI pass step 2: the header bell is the sprite's shared bell (CHROME_ICON.bell). Sweep S1
  // (DELIBERATE lock update): built as a plain ui-btn icon button with that registry name.
  assert.match(COMMON_SRC, /const bellBtn = chromeButtonEl\(\{ cls: 'notif-bell-btn', icon: CHROME_ICON\.bell,/);
  assert.ok(!/setAttribute\('d', 'M/.test(COMMON_SRC), 'no literal path left in common.js');
});
