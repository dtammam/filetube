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
  showMoveModal, showConfirmModal,
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

// ---- F2 (MAJOR) regression: showConfirmModal must never double-fire -------
// ---- onConfirm/teardown from a double-tap during the close fade. ----------
//
// Unlike showMoveModal (which takes an injectable `doc` param), showConfirmModal
// always operates against the GLOBAL `document` and builds its buttons from a
// raw `innerHTML` template -- so this fake DOM only stubs what that call path
// actually touches: `createElement` returns an `AnimatableFakeElement`
// (already used above for classList/transitionend support), `innerHTML`
// assignment naively pulls every `id="..."` out of the fixed showConfirmModal
// template and registers a fake button for each into a document-wide id
// registry, exactly mirroring what `document.getElementById('modal-cancel-
// btn'|'modal-confirm-btn')` then looks up.

class FakeButton extends AnimatableFakeElement {
  constructor() {
    super();
    this.disabled = false;
  }
  click() {
    (this._listeners.click || []).slice().forEach((fn) => fn({ target: this }));
  }
}

function withFakeDocumentForConfirmModal(fn) {
  const byId = new Map();
  const bodyChildren = [];
  const body = {
    appendChild: (el) => { bodyChildren.push(el); el.parentNode = body; return el; },
    removeChild: (el) => {
      const idx = bodyChildren.indexOf(el);
      if (idx >= 0) bodyChildren.splice(idx, 1);
      el.parentNode = null;
    },
  };
  const fakeDoc = {
    createElement: (tag) => {
      const el = new AnimatableFakeElement();
      el.tagName = String(tag).toUpperCase();
      el.parentNode = null;
      Object.defineProperty(el, 'innerHTML', {
        set(html) {
          const idRe = /id="([\w-]+)"/g;
          let m;
          while ((m = idRe.exec(html))) {
            const btn = new FakeButton();
            btn.id = m[1];
            byId.set(m[1], btn);
          }
        },
      });
      return el;
    },
    getElementById: (id) => byId.get(id) || null,
    body,
  };
  const originalDocument = global.document;
  global.document = fakeDoc;
  try {
    fn(fakeDoc, bodyChildren);
  } finally {
    global.document = originalDocument;
  }
}

test('F2: showConfirmModal -- double-clicking Confirm calls onConfirm exactly once, even before the close fade finishes', (t) => {
  // Mock timers so closeOverlayThen's 300ms fallback (armed by the first
  // click's teardown()) never fires for real past the end of this test.
  t.mock.timers.enable({ apis: ['setTimeout'] });
  withFakeDocumentForConfirmModal((fakeDoc) => {
    let confirmCalls = 0;
    showConfirmModal('Delete?', 'Are you sure?', () => { confirmCalls++; });
    const confirmBtn = fakeDoc.getElementById('modal-confirm-btn');
    confirmBtn.click();
    confirmBtn.click(); // double-tap before the ~200-300ms close fade completes
    confirmBtn.click();
    assert.strictEqual(confirmCalls, 1, 'onConfirm must fire exactly once no matter how many clicks land');
    assert.strictEqual(confirmBtn.disabled, true, 'Confirm is disabled the instant it settles');
  });
});

test('F2: showConfirmModal -- Confirm then Cancel does not also re-run teardown/onConfirm a second time (the settled guard covers both buttons)', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  withFakeDocumentForConfirmModal((fakeDoc) => {
    let confirmCalls = 0;
    showConfirmModal('Delete?', 'Are you sure?', () => { confirmCalls++; });
    const confirmBtn = fakeDoc.getElementById('modal-confirm-btn');
    const cancelBtn = fakeDoc.getElementById('modal-cancel-btn');
    confirmBtn.click();
    cancelBtn.click();
    assert.strictEqual(confirmCalls, 1, 'onConfirm must still have fired exactly once');
    assert.strictEqual(cancelBtn.disabled, true, 'Cancel is also disabled once the modal has settled');
  });
});

test('F2: showConfirmModal -- double-clicking Cancel never calls onConfirm', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  withFakeDocumentForConfirmModal((fakeDoc) => {
    let confirmCalls = 0;
    showConfirmModal('Delete?', 'Are you sure?', () => { confirmCalls++; });
    const cancelBtn = fakeDoc.getElementById('modal-cancel-btn');
    cancelBtn.click();
    cancelBtn.click();
    assert.strictEqual(confirmCalls, 0);
  });
});

test('F2: showConfirmModal -- teardown() adds .modal-closing to the backdrop (matches style.css\'s pointer-events: none guard)', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  withFakeDocumentForConfirmModal((fakeDoc, bodyChildren) => {
    showConfirmModal('Delete?', 'Are you sure?', () => {});
    const confirmBtn = fakeDoc.getElementById('modal-confirm-btn');
    const backdrop = bodyChildren[0];
    assert.ok(!backdrop.classList.contains('modal-closing'), 'not closing yet');
    confirmBtn.click();
    assert.ok(backdrop.classList.contains('modal-closing'), 'teardown() must mark the backdrop as closing');
  });
});

// ---- showMoveModal regression: still fully synchronous against its own ------
// ---- fake-DOM harness (no classList) -- open/close animation must never ----
// ---- change this pre-existing, already-tested behavior. --------------------

test('showMoveModal: teardown() still fully (synchronously) detaches the backdrop against a fake DOM with no classList', () => {
  class PlainFakeElement {
    constructor(tagName) {
      this.tagName = String(tagName).toUpperCase();
      this.children = [];
      this.className = '';
      this._textContent = '';
      this._listeners = {};
      this.disabled = false;
      this.value = undefined;
      this.parentElement = null;
    }
    appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
    remove() {
      if (this.parentElement) {
        const idx = this.parentElement.children.indexOf(this);
        if (idx >= 0) this.parentElement.children.splice(idx, 1);
        this.parentElement = null;
      }
    }
    setAttribute() {}
    addEventListener(type, handler) { (this._listeners[type] = this._listeners[type] || []).push(handler); }
    fire(type, evt) { (this._listeners[type] || []).forEach((fn) => fn(evt || { target: this })); }
    get textContent() { return this._textContent; }
    set textContent(v) { this._textContent = v; this.children = []; }
  }
  const body = new PlainFakeElement('body');
  const doc = { createElement: (t) => new PlainFakeElement(t), createTextNode: (t) => ({ nodeType: 3, textContent: t }), body };
  const modal = showMoveModal({ id: 'x', title: 'T' }, ['/a'], () => {}, doc);
  assert.strictEqual(body.children.length, 1);
  modal.teardown();
  assert.strictEqual(body.children.length, 0, 'teardown() must still synchronously detach the backdrop with no classList support');
});

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

test('.playlists-sheet slides up via .sheet-open (translateY(100%) -> translateY(0)), scoped to the mobile :not([hidden]) state', () => {
  assert.match(css, /\.playlists-sheet:not\(\[hidden\]\)\s*\{[^}]*transform:\s*translateY\(100%\);/s);
  assert.match(css, /\.playlists-sheet:not\(\[hidden\]\)\.sheet-open\s*\{\s*transform:\s*translateY\(0\);/);
});

test('.sub-sheet slides up via .sheet-open (translateY(100%) -> translateY(0)) at every viewport width (not gated by [hidden] -- fresh create/destroy)', () => {
  assert.match(css, /\.sub-sheet\s*\{[^}]*transform:\s*translateY\(100%\);/s);
  assert.match(css, /\.sub-sheet\.sheet-open\s*\{\s*transform:\s*translateY\(0\);/);
});

test('prefers-reduced-motion: reduce collapses every sheet/modal transition to instant, fully-visible/in-place (no stuck half-state)', () => {
  const rule = /\.modal-backdrop,\s*\.modal-content,\s*\.playlists-sheet-backdrop:not\(\[hidden\]\),\s*\.playlists-sheet:not\(\[hidden\]\),\s*\.sub-sheet-backdrop,\s*\.sub-sheet\s*\{([^}]*)\}/.exec(css);
  assert.ok(rule, 'expected a combined selector list covering every sheet/modal surface');
  assert.match(rule[1], /transition:\s*none;/);
  assert.match(rule[1], /opacity:\s*1;/);
  assert.match(rule[1], /transform:\s*none;/);

  // And that selector list must actually live inside the reduced-motion query.
  const queryBlock = /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\.sub-sheet\s*\{[^}]*\}\s*\n\}/.exec(css);
  assert.ok(queryBlock, 'expected the combined rule to sit inside @media (prefers-reduced-motion: reduce)');
});

test('every open/close call site of the Playlists sheet routes through openPlaylistsSheet/closePlaylistsSheet (no bypass leaving a stuck half-state)', () => {
  const commonJs = fs.readFileSync(path.join(ROOT, 'public', 'js', 'common.js'), 'utf8');

  const openFn = extractFunctionBody(commonJs, 'openPlaylistsSheet');
  const closeFn = extractFunctionBody(commonJs, 'closePlaylistsSheet');
  assert.ok(openFn, 'expected to find openPlaylistsSheet\'s function body');
  assert.ok(closeFn, 'expected to find closePlaylistsSheet\'s function body');

  const HIDDEN_ASSIGNMENT = /(?:backdrop|sheet)\.hidden\s*=/g;
  const inClose = closeFn.text.match(HIDDEN_ASSIGNMENT) || [];
  assert.ok(inClose.length >= 2, 'expected the sheet/backdrop hidden assignments inside closePlaylistsSheet to still exist');

  // v1.26.2 code-review fix (F4, NIT): the check above alone is unscoped in
  // spirit -- `(?:backdrop|sheet)\.hidden\s*=` is a generic pattern that
  // ALSO matches plenty of other, unrelated local `backdrop`/`sheet`
  // variables elsewhere in this file (e.g. buildSubscribeModal's own
  // `backdrop`), so counting matches file-wide (the pre-fix version of this
  // test) would still pass even if those unrelated assignments changed --
  // it was never actually verifying anything about the PLAYLISTS sheet
  // specifically. What actually matters: every place in the file that gets
  // a handle on the Playlists sheet's OWN `#playlists-backdrop`/
  // `#playlists-sheet` nodes (there is exactly one other call site today --
  // the bottom-nav's one-time close-wiring block) must ONLY ever wire an
  // event listener against them, never assign `.hidden` directly (which
  // would bypass openOverlay/closeOverlayThen, and so the F1 stale-timer
  // fix, entirely).
  function isInside(index, fn) {
    return !!fn && index >= fn.start && index < fn.end;
  }

  const ID_LOOKUP = /const\s+(backdrop|sheet)\s*=\s*document\.getElementById\('playlists-(?:backdrop|sheet)'\);/g;
  let lookupMatch;
  let outsideLookupCount = 0;
  while ((lookupMatch = ID_LOOKUP.exec(commonJs))) {
    if (isInside(lookupMatch.index, openFn) || isInside(lookupMatch.index, closeFn)) continue;
    outsideLookupCount++;
    const varName = lookupMatch[1];
    // A generous fixed window after the lookup -- comfortably covers a
    // wiring block's own `if (x) x.addEventListener(...)` lines without
    // reaching into unrelated code further down the file.
    const windowText = commonJs.slice(lookupMatch.index, lookupMatch.index + 600);
    assert.ok(
      !new RegExp(`${varName}\\.hidden\\s*=`).test(windowText),
      `found a direct .hidden assignment on the Playlists sheet's own "${varName}" OUTSIDE openPlaylistsSheet/closePlaylistsSheet -- a bypass of openOverlay/closeOverlayThen`
    );
  }
  assert.ok(outsideLookupCount >= 1, 'expected at least one other #playlists-backdrop/#playlists-sheet reference outside the two functions (the bottom-nav wiring) to actually exercise this guard');
});
