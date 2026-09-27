'use strict';

// [UNIT] v1.26.2 CSS/polish wave -- Item 1 (subscriptions-page font
// unification) + Item 2 (Reheat/Rescan "trailing line" artifact fix).
// Mechanical CSS/markup-presence guards, mirroring the existing
// test/unit/player-media-aspect-css.test.js style-locking pattern. Visual
// feel is Dean's on-device iOS arbiter; these lock that the actual
// rules/markup this release depends on exist.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const CSS_PATH = path.join(ROOT, 'public', 'css', 'style.css');
const SUBS_HTML_PATH = path.join(ROOT, 'lib', 'ytdlp', 'views', 'subscriptions.html');
const MAIN_JS_PATH = path.join(ROOT, 'public', 'js', 'main.js');

const css = fs.readFileSync(CSS_PATH, 'utf8');
const subsHtml = fs.readFileSync(SUBS_HTML_PATH, 'utf8');
const mainJs = fs.readFileSync(MAIN_JS_PATH, 'utf8');

// ---- Item 1: subscriptions-page font unification ---------------------------

test('.sub-row-name uses the app font, not the mono font (channel names read like the rest of the app)', () => {
  const rule = /\.sub-row-name\s*\{([^}]*)\}/.exec(css);
  assert.ok(rule, 'expected a .sub-row-name rule');
  assert.match(rule[1], /font-family:\s*var\(--font-family\);/);
  assert.ok(!/var\(--mono-font\)/.test(rule[1]), '.sub-row-name must not reference --mono-font');
});

test('.sub-sheet-name uses the app font, not the mono font (settings-sheet channel name matches the row above it)', () => {
  const rule = /\.sub-sheet-name\s*\{([^}]*)\}/.exec(css);
  assert.ok(rule, 'expected a .sub-sheet-name rule');
  assert.match(rule[1], /font-family:\s*var\(--font-family\);/);
  assert.ok(!/var\(--mono-font\)/.test(rule[1]), '.sub-sheet-name must not reference --mono-font');
});

test('no other .sub-* selector still uses --mono-font (only the intentional path/time surfaces do)', () => {
  const monoRuleSelectors = [];
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = ruleRe.exec(css))) {
    const selector = m[1].trim();
    const body = m[2];
    if (/^\.sub-/.test(selector) && /var\(--mono-font\)/.test(body)) {
      monoRuleSelectors.push(selector);
    }
  }
  assert.deepStrictEqual(monoRuleSelectors, [], `unexpected .sub-* rule(s) still using --mono-font: ${monoRuleSelectors.join(', ')}`);
});

// ---- Item 2: Reheat/Rescan "trailing line" artifact -------------------------

test('subscriptions.html: the three status spans moved OUT of .sub-list-header-actions into a dedicated .sub-list-header-status row', () => {
  // v1.55 Track B (DELIBERATE lock update): the div gained the sitewide
  // action-bar class -- match the class list openly, keep the capture shape.
  // v1.156 (T3): no status span may sit inside a button (.sub-list-header-actions)
  // row -- the v1.26.2 invariant that growing status text never reflows the
  // buttons. The spans now live in TWO dedicated .sub-list-header-status rows
  // (Check all's on the main screen; the maintenance ones in the Activity
  // panel with their buttons), so check every actions block and the union of
  // every status row.
  const actionBlocks = [...subsHtml.matchAll(/<div class="sub-list-header-actions[^"]*">([\s\S]*?)<\/div>/g)].map((m) => m[1]).join('');
  for (const id of ['sub-repull-status', 'sub-reheat-status', 'sub-refresh-avatars-status']) {
    assert.ok(!new RegExp(`id="${id}"`).test(actionBlocks), `${id} must not live inside a .sub-list-header-actions row`);
  }
  const statusRows = [...subsHtml.matchAll(/<div class="sub-list-header-status">([\s\S]*?)<\/div>/g)].map((m) => m[1]).join('');
  assert.ok(statusRows.length > 0, 'expected at least one dedicated .sub-list-header-status row');
  assert.match(statusRows, /id="sub-repull-status"/);
  assert.match(statusRows, /id="sub-reheat-status"/);
  assert.match(statusRows, /id="sub-refresh-avatars-status"/);
});

test('subscriptions.html: .sub-list-header-status reserves a min-height so populate/clear can never reflow the buttons row', () => {
  const styleBlock = /<style>[\s\S]*?<\/style>/.exec(subsHtml);
  assert.ok(styleBlock, 'expected a <style> block in subscriptions.html');
  const rule = /\.sub-list-header-status\s*\{([^}]*)\}/.exec(styleBlock[0]);
  assert.ok(rule, 'expected a .sub-list-header-status rule');
  assert.match(rule[1], /flex-basis:\s*100%;/, 'expected the status row to force its own full-width line');
  assert.match(rule[1], /min-height:\s*\d+px;/, 'expected a reserved min-height');
});

test('subscriptions.html: exactly one #sub-repull-all-btn/#sub-reheat-btn/#sub-refresh-avatars-btn remain, unmoved from the buttons row (structural test unaffected)', () => {
  for (const id of ['sub-repull-all-btn', 'sub-reheat-btn', 'sub-refresh-avatars-btn']) {
    const matches = subsHtml.match(new RegExp(`id="${id}"`, 'g')) || [];
    assert.strictEqual(matches.length, 1, `expected exactly one #${id}`);
  }
});

// UI pass sweep S2 (F19; converts the v1.26.2 min-width lock, AC12): Rescan is a
// square ui-btn icon (width = its height, ui.css .ui-btn--icon) and its scanning
// state is aria-busy (the spinner swaps inside the icon slot) - there is no label
// to swap, so the row can never reflow.
test('main.js: #rescan-library-btn keeps a stable width - a square ui-btn icon whose busy state never changes its content box', () => {
  const html = fs.readFileSync(path.join(__dirname, '../../public/index.html'), 'utf8');
  assert.match(html, /<button type="button" class="ui-btn ui-btn--tonal ui-btn--sm ui-btn--icon" id="rescan-library-btn"/);
  const ui = fs.readFileSync(path.join(__dirname, '../../public/css/ui.css'), 'utf8');
  assert.match(ui, /\.ui-btn--icon \{\s*width: var\(--btn-h\);/, 'an icon button is exactly as wide as it is tall');
  assert.match(mainJs, /u\.setBusy\(rescanBtn, !!on\)/, 'scanning is the busy state');
  assert.doesNotMatch(mainJs, /Scanning\.\.\.'|btn-label">Rescan/, 'no label swap left');
});
