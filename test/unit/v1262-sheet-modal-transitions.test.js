'use strict';

// [UNIT] v1.26.2 CSS/polish wave -- Item 4 (sheet/modal transitions). Since the UI pass
// every sheet and modal is a ui.sheet: this file binds the transition intents on ui.css and
// (step 7) that the retired v1.26.2 JS helpers stay gone.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const UI_CSS_ALL = fs.readFileSync(path.join(ROOT, 'public', 'css', 'ui.css'), 'utf8');
const CSS_PATH = path.join(ROOT, 'public', 'css', 'style.css');
const css = fs.readFileSync(CSS_PATH, 'utf8');

// ---- v1.26.2 code-review fix (F4, NIT): bracket-matching function-body ----
// ---- extractor, mirroring test/unit/v1262-mobile-input-zoom.test.js's -----
// ---- mobileBlocks() helper (same "balance braces from the opening `{`" ----
// ---- technique, applied to a named `function foo() { ... }` instead of ---
// ---- an `@media` block). Used below to SCOPE the "no bypass" assertion ---
// ---- to openPlaylistsSheet/closePlaylistsSheet's own bodies, rather than --
// ---- (pre-fix) counting `.hidden = ` occurrences across the ENTIRE file --
// ---- -- a count that would still pass even if some THIRD, unrelated ------
// ---- function elsewhere in common.js also assigned `backdrop.hidden`/ ----
// ---- `sheet.hidden` directly (the exact bypass this test exists to -------
// ---- catch). --------------------------------------------------------------
function extractFunctionBody(source, functionName) {
  const re = new RegExp(`function\\s+${functionName}\\s*\\([^)]*\\)\\s*\\{`);
  const m = re.exec(source);
  if (!m) return null;
  let depth = 1;
  let i = m.index + m[0].length;
  while (depth > 0 && i < source.length) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') depth--;
    i++;
  }
  // Both the body text AND its [start, end) index range in `source` --
  // callers need the range to tell whether some OTHER match found via a
  // separate, whole-file regex pass falls inside this function or not.
  return { text: source.slice(m.index, i), start: m.index, end: i };
}

// Step 7 (UI pass, DELIBERATE conversion): the openOverlay / closeOverlayThen /
// prefersReducedMotion / overlayCanAnimate helpers (and their fake-DOM tests: the two-step
// reveal, the transitionend-deferred teardown, the F1 reopen-cancels-a-pending-close locks)
// are retired with their last callers - every sheet and modal they animated is a ui.sheet
// (sweeps S1, S4, S5, S9), whose enter/exit, re-open mid-exit and reduced motion are ui.js's
// and bound by test/unit/ui-builders.test.js (the ui.sheet tests). Bound here: the helpers do
// not come back.
test('step 7: the v1.26.2 overlay helpers are gone - not defined, not exported, not called', () => {
  const common = require('../../public/js/common.js');
  for (const n of ['openOverlay', 'closeOverlayThen', 'overlayCanAnimate', 'prefersReducedMotion']) {
    assert.strictEqual(common[n], undefined, n + ' is not exported');
  }
  for (const f of fs.readdirSync(path.join(ROOT, 'public', 'js')).filter((x) => x.endsWith('.js'))) {
    const code = fs.readFileSync(path.join(ROOT, 'public', 'js', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    assert.doesNotMatch(code, /\b(openOverlay|closeOverlayThen|overlayCanAnimate|prefersReducedMotion)\s*\(/, f + ': no definition or call');
  }
});

// ---- F2 (MAJOR) regression: showConfirmModal must never double-fire ------------------
// Sweep S9 (AC12): showConfirmModal draws ui.confirm and showMoveModal a ui.sheet dialog, so
// their F2 locks (a double tap on Confirm runs onConfirm once; Confirm then Cancel does not
// re-run it; a double Cancel never confirms; the move dialog's caller-owned teardown) moved
// to test/unit/overlays-dialogs-s9.test.js, driven in jsdom with the real ui.js - where a
// closing dialog answers nothing because ui.confirm only answers from a LIVE dialog.

// ---- CSS: .sheet-open / .modal-open transition rules -----------------------

// Sweep S9 (AC12, the triage's "S9 half"): the generic .modal-backdrop / .modal-content family
// is gone with its last creator; every dialog is a ui.sheet dialog, whose fade + scale-in and
// tall-dialog cap are the primitive's. The intents, kept on ui.css:
//   - v1.26.2: the dialog fades in and scales in (never teleports);
//   - v1.108 (Dean: "the Edit chapters section is cut off at the bottom"): a TALL dialog caps
//     its height and scrolls INSIDE (the body scrolls, the actions stay reachable), clearing
//     the PWA home indicator.
test('a ui.sheet dialog fades and scales in (opacity 0 -> is-open 1, scale(0.98) -> none), and no generic .modal-* rule is left', () => {
  assert.match(UI_CSS_ALL, /\.ui-sheet \{[^}]*opacity:\s*0;[^}]*transition:\s*opacity var\(--dur-fade\)/s);
  assert.match(UI_CSS_ALL, /\.ui-sheet\.is-open \{ opacity: 1; \}/);
  assert.match(UI_CSS_ALL, /\.ui-sheet--dialog \{[^}]*transform:\s*scale\(0\.98\);/s);
  const live = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(live, /\.modal-(backdrop|content|title|body|open|closing)\b/, 'the generic modal family is gone');
});

test('v1.108: a tall ui.sheet dialog caps its height and scrolls INSIDE its body (split clip / scroll), clearing the home indicator', () => {
  const sheet = /\.ui-sheet \{([^}]*)\}/.exec(UI_CSS_ALL.replace(/\/\*[\s\S]*?\*\//g, ''));
  assert.ok(sheet);
  assert.match(sheet[1], /max-height:\s*90dvh;/, 'a dvh cap');
  assert.match(sheet[1], /overflow:\s*hidden;/, 'the sheet clips');
  const body = /\.ui-sheet__body \{([^}]*)\}/.exec(UI_CSS_ALL.replace(/\/\*[\s\S]*?\*\//g, ''));
  assert.match(body[1], /overflow-y:\s*auto;/, 'the body scrolls - a tall dialog never clips its actions off-screen');
  assert.match(UI_CSS_ALL, /\.ui-sheet--dialog \{[^}]*inset:\s*0;[^}]*margin:\s*auto;/s, 'centred in the viewport (so its cap is inside it)');
});

// Sweep S1 (DELIBERATE lock update, AC12 - the triage's "ui-sheet open/close contract
// (--dur-sheet)"): the Playlists sheet is a ui.sheet bottom sheet, so its slide is the
// primitive's (translateY(100%) -> the drag offset, 0, on .is-open, over --dur-sheet) and
// no bespoke .playlists-sheet rule may re-style it.
test('the Playlists sheet slides up as a ui.sheet bottom sheet (ui.css: translateY(100%) -> is-open), with no bespoke rule of its own', () => {
  const ui = fs.readFileSync(path.join(ROOT, 'public', 'css', 'ui.css'), 'utf8');
  assert.match(ui, /\.ui-sheet--bottom \{[^}]*transform:\s*translateY\(100%\);/s);
  assert.match(ui, /\.ui-sheet--bottom\.is-open \{\s*transform:\s*translateY\(var\(--ui-drag, 0px\)\);/);
  assert.match(ui, /\.ui-sheet \{[^}]*transition:[^;]*transform var\(--dur-sheet\)/s, 'the slide runs over --dur-sheet');
  const live = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(live, /\.playlists-sheet(?![-\w])[^{]*\{/, 'no .playlists-sheet rule in style.css');
  const src = fs.readFileSync(path.join(ROOT, 'public', 'js', 'common.js'), 'utf8');
  assert.match(src, /U\.sheet\(\{ variant: 'bottom', title: 'Playlists', content: list,/, 'built as a bottom ui.sheet titled Playlists');
});

// UI pass S5 (AC12): the Subscriptions settings/panel sheets are ui.sheets now, so the
// retired .sub-sheet translateX slide is replaced by the primitive's contract: a bottom
// sheet slides on Y, a dialog scales in, and the open class is ALWAYS applied (F48).
const UI_CSS = fs.readFileSync(path.join(ROOT, 'public', 'css', 'ui.css'), 'utf8');
test('the Subscriptions sheets are ui.sheets: bottom slides translateY(100%) -> drag offset, dialog scales, both open via .is-open', () => {
  assert.match(UI_CSS, /\.ui-sheet--bottom \{[^}]*transform:\s*translateY\(100%\);/s);
  assert.match(UI_CSS, /\.ui-sheet--bottom\.is-open \{ transform: translateY\(var\(--ui-drag, 0px\)\); \}/);
  assert.match(UI_CSS, /\.ui-sheet--dialog \{[^}]*transform:\s*scale\(0\.98\);/s);
  assert.match(UI_CSS, /\.ui-sheet--popover\.is-open,\s*\n\.ui-sheet--dialog\.is-open \{ transform: none; \}/);
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ''), /\.sub-sheet/, 'the bespoke .sub-sheet family is gone');
});

test('prefers-reduced-motion: reduce collapses every sheet transition to opacity only (no stuck half-state), and no bespoke modal rule remains to collapse', () => {
  // Sweeps S1 + S5 + S9: every sheet and dialog is a ui.sheet - ui.css's own reduced-motion
  // rule makes it opacity-only and ALWAYS applies the open class (F48). Sweep S9 deleted the
  // generic .modal-backdrop / .modal-content family and its reduced-motion override.
  assert.match(UI_CSS, /@media \(prefers-reduced-motion: reduce\) \{\s*\n\s*\.ui-sheet,\s*\n\s*\.ui-sheet\.is-open,\s*\n\s*\.ui-sheet--bottom,\s*\n\s*\.ui-sheet--panel \{\s*\n\s*transform: none;\s*\n\s*transition: opacity var\(--dur-fade\) linear;/,
    'the ui.sheet reduced-motion contract');
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ''), /\.modal-backdrop|\.modal-content/, 'no bespoke modal rule left to collapse');
});

test('every open/close call site of the Playlists sheet routes through openPlaylistsSheet/closePlaylistsSheet (no bypass leaving a stuck half-state)', () => {
  // Sweep S1 (DELIBERATE lock update): the sheet is ONE ui.sheet controller
  // (playlistsSheetCtrl, built by ensurePlaylistsSheet). Its open() / close() are called only
  // from openPlaylistsSheet / closePlaylistsSheet, and nothing reaches into its element to
  // flip `hidden` (which would bypass ui.sheet's state machine - the class of stuck
  // half-state the F1 fix above was about).
  const commonJs = fs.readFileSync(path.join(ROOT, 'public', 'js', 'common.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const openFn = extractFunctionBody(commonJs, 'openPlaylistsSheet');
  const closeFn = extractFunctionBody(commonJs, 'closePlaylistsSheet');
  assert.ok(openFn && closeFn, 'both functions exist');
  const inside = (i) => (i >= openFn.start && i < openFn.end) || (i >= closeFn.start && i < closeFn.end);
  const calls = [...commonJs.matchAll(/(?:playlistsSheetCtrl|ctrl)\.(open|close)\(\)/g)];
  const ctrlCalls = calls.filter((m) => commonJs.slice(Math.max(0, m.index - 40), m.index).includes('playlistsSheet') || m[0].startsWith('playlistsSheetCtrl') || inside(m.index));
  assert.ok(ctrlCalls.length >= 2, 'the sheet is opened and closed somewhere (anti-vacuity)');
  for (const m of ctrlCalls) assert.ok(inside(m.index), 'a Playlists sheet open/close outside openPlaylistsSheet/closePlaylistsSheet: ' + commonJs.slice(m.index - 60, m.index + 20));
  assert.doesNotMatch(commonJs, /getElementById\('playlists-(?:sheet|backdrop)'\)/, 'nothing looks the sheet element up to poke it');
  assert.doesNotMatch(commonJs, /playlistsSheetCtrl\.el\.hidden\s*=/, 'nothing flips hidden on the ui.sheet element');
});
