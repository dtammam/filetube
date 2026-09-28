'use strict';

// [UNIT] v1.26.2 CSS/polish wave -- Item 4 (sheet/modal transitions).
// Covers the shared `openOverlay`/`closeOverlayThen`/`prefersReducedMotion`
// helpers (public/js/common.js) directly against a fake DOM (mirrors
// test/unit/move-modal.test.js's fake-DOM harness pattern), plus mechanical
// CSS-presence guards for the new `.sheet-open`/`.modal-open` transition
// rules and their `prefers-reduced-motion` override, mirroring
// test/unit/player-media-aspect-css.test.js's style-locking pattern.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const {
  prefersReducedMotion, overlayCanAnimate, openOverlay, closeOverlayThen,
} = require('../../public/js/common.js');

const ROOT = path.join(__dirname, '..', '..');
const CSS_PATH = path.join(ROOT, 'public', 'css', 'style.css');
const css = fs.readFileSync(CSS_PATH, 'utf8');

// ---- Fake DOM WITH classList/transitionend support (unlike move-modal's) ---

class AnimatableFakeElement {
  constructor() {
    this._classes = new Set();
    this.hidden = undefined;
    this.offsetHeight = 0;
    this._listeners = {};
  }
  get classList() {
    return {
      add: (c) => this._classes.add(c),
      remove: (c) => this._classes.delete(c),
      contains: (c) => this._classes.has(c),
    };
  }
  addEventListener(type, fn) {
    (this._listeners[type] = this._listeners[type] || []).push(fn);
  }
  removeEventListener(type, fn) {
    if (this._listeners[type]) this._listeners[type] = this._listeners[type].filter((f) => f !== fn);
  }
  dispatchTransitionEnd() {
    (this._listeners.transitionend || []).slice().forEach((fn) => fn({ target: this }));
  }
  // F1: a reopen interrupts an in-flight closing transition -- real browsers
  // fire `transitioncancel`, NOT `transitionend`, in that case.
  dispatchTransitionCancel() {
    (this._listeners.transitioncancel || []).slice().forEach((fn) => fn({ target: this }));
  }
}

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

function withStubbedWindow(matches, fn) {
  const original = global.window;
  global.window = { matchMedia: () => ({ matches }) };
  try {
    fn();
  } finally {
    global.window = original;
  }
}

// ---- prefersReducedMotion ---------------------------------------------------

test('prefersReducedMotion: false when there is no window (Node/non-browser environment)', () => {
  const original = global.window;
  delete global.window;
  try {
    assert.strictEqual(prefersReducedMotion(), false);
  } finally {
    global.window = original;
  }
});

test('prefersReducedMotion: reflects window.matchMedia(\'(prefers-reduced-motion: reduce)\').matches', () => {
  withStubbedWindow(true, () => assert.strictEqual(prefersReducedMotion(), true));
  withStubbedWindow(false, () => assert.strictEqual(prefersReducedMotion(), false));
});

// ---- overlayCanAnimate -------------------------------------------------------

test('overlayCanAnimate: false for null/undefined and for elements without a real classList (e.g. the move-modal fake-DOM harness)', () => {
  assert.strictEqual(overlayCanAnimate(null), false);
  assert.strictEqual(overlayCanAnimate(undefined), false);
  assert.strictEqual(overlayCanAnimate({}), false);
});

test('overlayCanAnimate: true for an element with a real classList.add/remove', () => {
  assert.strictEqual(overlayCanAnimate(new AnimatableFakeElement()), true);
});

// ---- openOverlay --------------------------------------------------------------

test('openOverlay: unhides the element and adds the open class when animation is possible', () => {
  const el = new AnimatableFakeElement();
  el.hidden = true;
  openOverlay(el, 'sheet-open');
  assert.strictEqual(el.hidden, false);
  assert.ok(el.classList.contains('sheet-open'));
});

test('openOverlay: still unhides but skips the class when the element cannot animate (e.g. no classList)', () => {
  const el = { hidden: true };
  openOverlay(el, 'sheet-open');
  assert.strictEqual(el.hidden, false);
});

test('openOverlay: is a no-op on null/undefined (never throws)', () => {
  assert.doesNotThrow(() => openOverlay(null, 'sheet-open'));
  assert.doesNotThrow(() => openOverlay(undefined, 'sheet-open'));
});

test('openOverlay: skips adding the open class under prefers-reduced-motion (CSS then renders the base/open states identically)', () => {
  const el = new AnimatableFakeElement();
  withStubbedWindow(true, () => {
    openOverlay(el, 'sheet-open');
  });
  assert.ok(!el.classList.contains('sheet-open'));
});

// ---- closeOverlayThen ---------------------------------------------------------

test('closeOverlayThen: calls afterClose synchronously when the element cannot animate (no classList) -- matches showMoveModal\'s synchronous teardown() tests', () => {
  let called = false;
  closeOverlayThen({}, 'sheet-open', () => { called = true; });
  assert.strictEqual(called, true);
});

test('closeOverlayThen: calls afterClose synchronously under prefers-reduced-motion, even when the element CAN animate', () => {
  const el = new AnimatableFakeElement();
  el.classList.add('sheet-open');
  let called = false;
  withStubbedWindow(true, () => {
    closeOverlayThen(el, 'sheet-open', () => { called = true; });
  });
  assert.strictEqual(called, true);
  assert.ok(!el.classList.contains('sheet-open'), 'the open class must still be removed even on the instant path');
});

test('closeOverlayThen: removes the open class immediately, but defers afterClose until transitionend fires', () => {
  const el = new AnimatableFakeElement();
  el.classList.add('sheet-open');
  let called = false;
  closeOverlayThen(el, 'sheet-open', () => { called = true; });
  assert.ok(!el.classList.contains('sheet-open'), 'the class is removed right away (kicks off the CSS transition)');
  assert.strictEqual(called, false, 'afterClose must not fire before the transition actually finishes');
  el.dispatchTransitionEnd();
  assert.strictEqual(called, true, 'afterClose fires once transitionend arrives');
});

test('closeOverlayThen: a transitionend from an unrelated element (bubbling) does not finish this close', () => {
  const el = new AnimatableFakeElement();
  const other = new AnimatableFakeElement();
  el.classList.add('sheet-open');
  let called = false;
  closeOverlayThen(el, 'sheet-open', () => { called = true; });
  // Fire transitionend on a DIFFERENT target than `el` -- the listener checks
  // `e.target === el`, so this must be ignored.
  (el._listeners.transitionend || []).forEach((fn) => fn({ target: other }));
  assert.strictEqual(called, false);
});

test('closeOverlayThen: calling afterClose is a no-op-safe default when afterClose is omitted', () => {
  assert.doesNotThrow(() => closeOverlayThen({}, 'sheet-open'));
});

// ---- F1 (BLOCKER) regression: stale close-timer race on a REUSED node -------
// ---- (e.g. the Playlists sheet's persistent #playlists-sheet/#playlists- ----
// ---- backdrop) -- reopening before an earlier close's transitionend/300ms --
// ---- fallback fires must never let that abandoned close hide the sheet -----
// ---- the user just reopened. ------------------------------------------------

test('F1: reopening BEFORE a pending close\'s transitionend fires cancels that close outright -- the stale 300ms fallback deadline is a true no-op', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const el = new AnimatableFakeElement();
  el.hidden = false;
  el.classList.add('sheet-open');

  let afterCloseCalls = 0;
  closeOverlayThen(el, 'sheet-open', () => { afterCloseCalls++; el.hidden = true; });
  assert.ok(!el.classList.contains('sheet-open'), 'the close removed the open class, arming a 300ms fallback + transitionend listener');

  // Reopen BEFORE either the transitionend or the 300ms fallback fires --
  // this is the exact race F1 covers (a rapid close -> reopen on the SAME
  // reused node).
  openOverlay(el, 'sheet-open');
  assert.strictEqual(el.hidden, false, 'the reopen must unhide immediately');
  assert.ok(el.classList.contains('sheet-open'), 'the reopen must re-add the open class');

  // Advance past the abandoned close's original 300ms fallback deadline --
  // it must have been cancelled by the reopen above, so `afterClose` (which
  // would hide the sheet again) must never fire.
  t.mock.timers.tick(300);
  assert.strictEqual(afterCloseCalls, 0, 'the stale close\'s afterClose must never fire once cancelled by a reopen');
  assert.strictEqual(el.hidden, false, 'the sheet must still be visible after the stale deadline passes');
  assert.ok(el.classList.contains('sheet-open'), 'the sheet must still carry the open class after the stale deadline passes');
});

test('F1: reopening BEFORE a pending close\'s deadline also survives a late, interrupted transitioncancel from that same abandoned close', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const el = new AnimatableFakeElement();
  el.classList.add('sheet-open');

  let afterCloseCalls = 0;
  closeOverlayThen(el, 'sheet-open', () => { afterCloseCalls++; });
  openOverlay(el, 'sheet-open');

  // Even if the browser still delivers a (now-irrelevant) transitioncancel
  // from the abandoned close's interrupted transition, cancelPendingClose
  // already tore down that listener -- this must be a complete no-op.
  el.dispatchTransitionCancel();
  t.mock.timers.tick(300);
  assert.strictEqual(afterCloseCalls, 0);
  assert.ok(el.classList.contains('sheet-open'));
});

test('F1: rapid close -> open -> close converges on CLOSED (the LAST call\'s intent), not the first close\'s', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const el = new AnimatableFakeElement();
  el.classList.add('sheet-open');

  const calls = [];
  closeOverlayThen(el, 'sheet-open', () => calls.push('close-1'));
  openOverlay(el, 'sheet-open');
  closeOverlayThen(el, 'sheet-open', () => calls.push('close-2'));

  assert.ok(!el.classList.contains('sheet-open'), 'the second close removed the open class again');
  // Let the SECOND close's own transition finish normally.
  el.dispatchTransitionEnd();
  assert.deepStrictEqual(calls, ['close-2'], 'only the LAST close\'s afterClose must ever fire');

  // The first close's now-cancelled fallback timer must not also fire.
  t.mock.timers.tick(300);
  assert.deepStrictEqual(calls, ['close-2']);
  assert.ok(!el.classList.contains('sheet-open'), 'final state is CLOSED, matching the last call');
});

test('F1: finish() belt-and-braces -- even if a stale transitionend slips through, afterClose is skipped once the element carries the open class again', () => {
  // Exercises the classList.contains(openClass) guard inside finish()
  // directly (rather than relying solely on cancelPendingClose), by racing
  // a raw dispatchTransitionEnd() against a reopen without going through
  // mock timers at all.
  const el = new AnimatableFakeElement();
  el.classList.add('sheet-open');
  let afterCloseCalls = 0;
  closeOverlayThen(el, 'sheet-open', () => { afterCloseCalls++; });
  // Directly re-add the open class (simulating some other path re-opening
  // without going through cancelPendingClose) to isolate the classList
  // check from the generation-counter cancellation above.
  el.classList.add('sheet-open');
  el.dispatchTransitionEnd();
  assert.strictEqual(afterCloseCalls, 0, 'afterClose must be skipped when the element still/again carries the open class');
});

// ---- F2 (MAJOR) regression: showConfirmModal must never double-fire ------------------
// Sweep S9 (AC12): showConfirmModal draws ui.confirm and showMoveModal a ui.sheet dialog, so
// their F2 locks (a double tap on Confirm runs onConfirm once; Confirm then Cancel does not
// re-run it; a double Cancel never confirms; the move dialog's caller-owned teardown) moved
// to test/unit/overlays-dialogs-s9.test.js, driven in jsdom with the real ui.js - where a
// closing dialog answers nothing because ui.confirm only answers from a LIVE dialog.

// ---- CSS: .sheet-open / .modal-open transition rules -----------------------

test('.modal-backdrop fades in/out via .modal-open (opacity 0 -> 1) and .modal-content scales in (0.97 -> 1)', () => {
  const backdropRule = /\.modal-backdrop\s*\{([^}]*)\}/.exec(css);
  assert.ok(backdropRule);
  assert.match(backdropRule[1], /opacity:\s*0;/);
  assert.match(backdropRule[1], /transition:\s*opacity[^;]*;/);
  assert.match(css, /\.modal-backdrop\.modal-open\s*\{\s*opacity:\s*1;/);

  const contentRule = /\.modal-content\s*\{([^}]*)\}/.exec(css);
  assert.ok(contentRule);
  assert.match(contentRule[1], /transform:\s*scale\(0\.97\);/);
  assert.match(css, /\.modal-backdrop\.modal-open \.modal-content\s*\{\s*transform:\s*scale\(1\);/);
});

// v1.108 (Dean: "the Edit chapters section is cut off at the bottom of the
// scroll window"): the centred .modal-content must cap its height and scroll
// internally so a tall modal (chapters editor) never clips its Save/Cancel row
// off the viewport bottom. Bind all three parts -- remove any and a tall modal
// regresses to the clip.
test('.modal-content caps its height (dvh + safe-area insets) and scrolls internally, with a safe-area bottom pad', () => {
  const contentRule = /\.modal-content\s*\{([^}]*)\}/.exec(css);
  assert.ok(contentRule);
  const body = contentRule[1];
  assert.match(body, /overflow-y:\s*auto;/, 'a tall modal must scroll instead of clipping');
  assert.match(body, /max-height:\s*calc\(100dvh[^;]*env\(safe-area-inset-top[^;]*env\(safe-area-inset-bottom[^;]*\);/,
    'dvh height cap that clears the PWA notch/home-indicator');
  assert.match(body, /max-height:\s*calc\(100vh[^;]*\);/, 'vh fallback for engines without dvh');
  assert.match(body, /padding-bottom:\s*calc\(var\(--space-10\)\s*\+\s*env\(safe-area-inset-bottom,\s*0px\)\);/,
    'Save/Cancel stays clear of the home indicator when scrolled to the bottom');
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

test('prefers-reduced-motion: reduce collapses every sheet/modal transition to instant, fully-visible/in-place (no stuck half-state)', () => {
  // Sweeps S1 + S5: the Playlists sheet and the Subscriptions sheet left this list (a ui.sheet: ui.css's own reduced-motion rule
  // makes it opacity-only and ALWAYS applies the open class, F48).
  const rule = /\.modal-backdrop,\s*\.modal-content\s*\{([^}]*)\}/.exec(css); // S5 moved the sub-sheet to ui.sheet too
  const ui = fs.readFileSync(path.join(ROOT, 'public', 'css', 'ui.css'), 'utf8');
  assert.match(ui, /@media \(prefers-reduced-motion: reduce\) \{\s*\.ui-sheet,\s*\.ui-sheet\.is-open,\s*\.ui-sheet--bottom,\s*\.ui-sheet--panel \{\s*transform: none;\s*transition: opacity var\(--dur-fade\) linear;/,
    'the ui.sheet reduced-motion contract');
  assert.ok(rule, 'expected a combined selector list covering every sheet/modal surface');
  assert.match(rule[1], /transition:\s*none;/);
  assert.match(rule[1], /opacity:\s*1;/);
  assert.match(rule[1], /transform:\s*none;/);

  // And that selector list must actually live inside the reduced-motion query.
  const queryBlock = /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.modal-backdrop,\s*\.modal-content\s*\{[^}]*\}\s*\n\}/.exec(css);
  assert.ok(queryBlock, 'expected the combined rule to sit inside @media (prefers-reduced-motion: reduce)');
  // The ui.sheets (the Subscriptions panels + settings sheet) take their own reduced-motion
  // rule in ui.css: opacity only, never a transform (F48 - the open class still applies).
  assert.match(UI_CSS, /@media \(prefers-reduced-motion: reduce\) \{\s*\n\s*\.ui-sheet,\s*\n\s*\.ui-sheet\.is-open,\s*\n\s*\.ui-sheet--bottom,\s*\n\s*\.ui-sheet--panel \{\s*\n\s*transform: none;/);
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
