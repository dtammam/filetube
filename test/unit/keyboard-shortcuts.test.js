'use strict';

// [UNIT] v1.47.8 -- the keyboard-shortcuts reference (Dean).
//
// "Can we make a keyboard shortcuts page/modal? ... mirror YouTube's or other
// modern apps'. Ignore/not display on mobile viewport. Keep it simple."
//
// THE LOAD-BEARING TEST IN THIS FILE is the drift lock: every key the dialog
// documents must be handled by real code. A reference listing keys that do
// nothing is worse than no reference -- it converts "I don't know the shortcut"
// into "the app is broken", and it rots silently the first time a handler is
// renamed or removed. So the list is checked against player.js's and read.js's
// actual keydown handlers rather than against YouTube's published set.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const {
  KEYBOARD_SHORTCUT_GROUPS,
  shouldOpenShortcuts,
  buildShortcutsModal,
  SHORTCUTS_DESKTOP_QUERY,
} = require('../../public/js/common.js');

const PLAYER = fs.readFileSync(path.join(__dirname, '../../public/js/player.js'), 'utf8');
const READ = fs.readFileSync(path.join(__dirname, '../../public/js/read.js'), 'utf8');
const COMMON = fs.readFileSync(path.join(__dirname, '../../public/js/common.js'), 'utf8');
const CSS = fs.readFileSync(path.join(__dirname, '../../public/css/style.css'), 'utf8');
const STATS_HTML = fs.readFileSync(path.join(__dirname, '../../public/stats.html'), 'utf8');

function doc() {
  return new JSDOM('<!doctype html><html><body></body></html>').window.document;
}

const allItems = () => KEYBOARD_SHORTCUT_GROUPS.flatMap((g) => g.items);

/**
 * The player's shortcut keydown handler, BOUNDED to that handler.
 *
 * v1.47.8 gate W5: this used to slice to EOF, so any matching literal anywhere
 * in the remaining ~850 lines satisfied the assertions while the variable was
 * named `handler` and the comment claimed the switch was the source of truth.
 */
function playerShortcutHandler() {
  // v1.132: player.js now binds MORE document-level keydown listeners than
  // the shortcut switch + the audio-expand Escape (the resume-countdown
  // cancel listener registers/unregisters dynamically and sits EARLIER in
  // the file), so "the first occurrence" is no longer the handler. Anchor on
  // content instead: the shortcut handler is the ONE keydown block that
  // contains the `switch (` dispatch; still bounded to the next keydown
  // listener (the W5 lesson - never slice to EOF).
  const occurrences = [];
  for (let i = PLAYER.indexOf("document.addEventListener('keydown'"); i !== -1; i = PLAYER.indexOf("document.addEventListener('keydown'", i + 10)) {
    occurrences.push(i);
  }
  assert.ok(occurrences.length > 0, 'expected the player keydown handler');
  let start = -1;
  let next = -1;
  for (let i = 0; i < occurrences.length; i++) {
    const end = i + 1 < occurrences.length ? occurrences[i + 1] : PLAYER.length;
    if (/switch \(/.test(PLAYER.slice(occurrences[i], end))) { start = occurrences[i]; next = end; break; }
  }
  assert.notEqual(start, -1, 'expected the ONE keydown listener containing the shortcut switch');
  const raw = PLAYER.slice(start, next);
  // Strip line comments: the slice still trails ~15 lines of inter-listener
  // prose, and player.js's own commentary contains the literal `case 'Escape':`
  // -- so without this, a shortcut written only in a COMMENT satisfies the lock
  // (gate delta, item 2).
  return raw.split('\n').filter((line) => !/^\s*\/\//.test(line)).join('\n');
}


// ---- THE DRIFT LOCK --------------------------------------------------------

test('DRIFT LOCK: every documented playback key is actually handled in player.js', () => {
  // The switch in player.js's keydown handler is the source of truth. Each
  // entry below maps a documented cap to the literal that must appear in that
  // handler. If someone removes a shortcut, this fails instead of the docs
  // quietly lying.
  const handler = playerShortcutHandler();
  const expectations = {
    K: "case 'k':",
    Space: "case ' ':",
    J: "case 'j':",
    L: "case 'l':",
    // step 7: the arrow keys are listed by their KeyboardEvent.key names (their caps draw the registry arrows)
    ArrowLeft: "case 'ArrowLeft':",
    ArrowRight: "case 'ArrowRight':",
    ArrowUp: "case 'ArrowUp':",
    ArrowDown: "case 'ArrowDown':",
    F: "case 'f':",
    C: "case 'c':",
    '<': "case '<':",
    '>': "case '>':",
    N: "case 'N':",
    P: "case 'P':",
    // v1.132 gate S1 (pre-existing hole, measured on both sides of the wave):
    // the dialog documents M/mute but no row bound it - deleting case 'm'
    // stayed green. Both directions of the drift lock derive from rows here.
    M: "case 'm':",
  };
  const documented = new Set(allItems().flatMap((i) => i.keys));
  for (const [cap, literal] of Object.entries(expectations)) {
    if (!documented.has(cap)) continue; // not advertised -> nothing to verify
    assert.ok(handler.includes(literal),
      `the dialog documents "${cap}" but player.js has no ${literal} branch`);
  }
});

test('DRIFT LOCK: the digit-seek row corresponds to a real 0-9 branch', () => {
  const handler = playerShortcutHandler();
  const digits = allItems().find((i) => i.keys.includes('0'));
  assert.ok(digits, 'the reference advertises digit seeking');
  assert.match(handler, /case '0': case '1': case '2': case '3': case '4':/);
  assert.match(handler, /case '5': case '6': case '7': case '8': case '9':/);
  assert.match(digits.desc, /0% - 90%/, 'the description must match what the code does (N x 10%)');
});

test('DRIFT LOCK: Shift+N / Shift+P really require Shift in the handler', () => {
  const handler = playerShortcutHandler();
  // Documenting a bare "N" would be wrong -- the code gates on e.shiftKey.
  assert.match(handler, /case 'N':\s*\n\s*if \(e\.shiftKey/);
  assert.match(handler, /case 'P':\s*\n\s*if \(e\.shiftKey/);
  const nav = KEYBOARD_SHORTCUT_GROUPS.find((g) => g.title === 'Moving around');
  assert.ok(nav.items.some((i) => i.keys.join('+') === 'Shift+N'));
  assert.ok(nav.items.some((i) => i.keys.join('+') === 'Shift+P'));
});

test('DRIFT LOCK: the reader arrows correspond to read.js handlers', () => {
  assert.match(READ, /event\.key === 'ArrowRight'/);
  assert.match(READ, /event\.key === 'ArrowLeft'/);
  const reading = KEYBOARD_SHORTCUT_GROUPS.find((g) => g.title === 'Reading (books)');
  assert.deepEqual(reading.items.map((i) => i.desc), ['Previous page', 'Next page']);
});

test('BIDIRECTIONAL: the reference documents every player shortcut, and no others', () => {
  // v1.47.8 gate W4/W5: the original version compared the docs against a
  // HARDCODED set, so it could only ever catch a documented-but-missing key --
  // never a real shortcut that nobody documented. That hole is exactly where
  // the defect was: `M` (mute) existed and was absent from the dialog.
  //
  // Both directions are now derived from the handler itself.
  const handler = playerShortcutHandler();
  const CAP_FOR_CASE = {
    "case 'k':": 'K', "case ' ':": 'Space', "case 'j':": 'J', "case 'l':": 'L',
    "case 'm':": 'M', "case 'f':": 'F', "case 'c':": 'C',
    "case '<':": '<', "case '>':": '>',
    "case 'ArrowLeft':": 'ArrowLeft', "case 'ArrowRight':": 'ArrowRight',
    "case 'ArrowUp':": 'ArrowUp', "case 'ArrowDown':": 'ArrowDown',
    "case 'N':": 'N', "case 'P':": 'P',
  };
  const documented = new Set(allItems().flatMap((i) => i.keys));

  const undocumented = Object.entries(CAP_FOR_CASE)
    .filter(([literal]) => handler.includes(literal))
    .filter(([, cap]) => !documented.has(cap))
    .map(([, cap]) => cap);
  assert.deepEqual(undocumented, [],
    `player.js handles these but the dialog never mentions them: ${undocumented}`);

  // THE UNIVERSE IS DERIVED FROM THE HANDLER (gate delta M-E). Previously only
  // the FILTER was; the universe was this hardcoded map, so a shortcut added
  // tomorrow that nobody adds to the map stayed invisible -- the same hole as
  // the original hardcoded set, moved one layer deeper. `M` was caught because
  // I added it to the map by hand, not because the lock found it. Now any case
  // literal the map has never heard of fails loudly.
  const seen = [...handler.matchAll(/case '([^']+)':/g)].map((m) => m[1]);
  const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
  const KNOWN_LITERALS = new Set([...Object.keys(CAP_FOR_CASE).map((k) => k.slice(6, -2)),
    ...DIGITS, 'K', 'J', 'L', 'M', 'F', 'C', ' ', 'Spacebar']);
  const unknown = [...new Set(seen)].filter((lit) => !KNOWN_LITERALS.has(lit));
  assert.deepEqual(unknown, [],
    `player.js handles case '${unknown}' which this lock has never heard of -- `
    + 'add it to CAP_FOR_CASE and document it, or it is an undocumented shortcut');

  // ...and nothing advertised is unaccounted for (separators and `?` aside).
  // R and S (the v1.363 Resume prompt; S also serves the "Resumed at" toast) live OUTSIDE the main switch by design
  // (the switch early-returns on a focused BUTTON) -- they are
  // accounted for here and drift-locked against their OWN listener below.
  // D (v1.50.3 dark/light) is GLOBAL (any page, not just the player) and
  // lives in common.js's capture-phase handler -- drift-locked below too.
  const accountedFor = new Set([...Object.values(CAP_FOR_CASE), 'Shift', '0', '9', '\u2026', '?', 'R', 'S', 'D']);
  const invented = [...documented].filter((k) => !accountedFor.has(k));
  assert.deepEqual(invented, [], `advertised but unaccounted for: ${invented}`);
});

test('DRIFT LOCK: the documented R and S resume keys are really handled (their own listener + the pure decision table)', () => {
  // v1.363: the dialog documents R and S with a "while the Resume prompt shows" scope (S also while
  // the "Resumed at" toast shows); the real handler is resolveResumeShortcutAction + a dedicated
  // listener that routes through the REAL buttons' .click() (one shared decision path with the
  // mouse). Both halves are locked:
  const { resolveResumeShortcutAction } = require('../../public/js/player.js');
  assert.equal(resolveResumeShortcutAction({ key: 'S', overlayVisible: true }), 'restart');
  assert.equal(resolveResumeShortcutAction({ key: 'S', promptVisible: true }), 'restart');
  assert.equal(resolveResumeShortcutAction({ key: 'R', promptVisible: true }), 'resume');
  assert.equal(resolveResumeShortcutAction({ key: 's', overlayVisible: false }), 'none',
    'the advertised scoping ("while it shows") must be real');
  assert.equal(resolveResumeShortcutAction({ key: 'r', promptVisible: false }), 'none', 'R is scoped to the prompt');
  assert.equal(resolveResumeShortcutAction({ key: 'r', overlayVisible: true }), 'none', 'R does nothing for the toast: the load already resumed');

  // ...and the listener actually wires the verdicts to the real buttons.
  const start = PLAYER.indexOf('resolveResumeShortcutAction({');
  assert.notEqual(start, -1, 'expected the resume-shortcut listener call site');
  const wiring = PLAYER.slice(start, start + 1600);
  assert.match(wiring, /resumeYesBtn\.click\(\)/, 'R must route through the real Resume button');
  assert.match(wiring, /resumeNoBtn\.click\(\)/, 'S must route through the real Start from beginning button while the prompt shows');
  assert.match(wiring, /resumeRestartBtn\.click\(\)/, 'S must route through the real Start over button for the toast');
});

test('DRIFT LOCK: the documented D dark/light key is really handled (pure decision + the shared toggleTheme path)', () => {
  const { shouldToggleThemeKey } = require('../../public/js/common.js');
  assert.equal(shouldToggleThemeKey({ key: 'd' }, '', false), true);
  assert.equal(shouldToggleThemeKey({ key: 'D' }, '', false), true);
  assert.equal(shouldToggleThemeKey({ key: 'd', metaKey: true }, '', false), false, 'Cmd+D stays the browser bookmark');
  assert.equal(shouldToggleThemeKey({ key: 'd', ctrlKey: true }, '', false), false);
  assert.equal(shouldToggleThemeKey({ key: 'd' }, 'INPUT', false), false, 'never while typing');
  assert.equal(shouldToggleThemeKey({ key: 'd' }, '', true), false, 'never in contentEditable');
  assert.equal(shouldToggleThemeKey({ key: 'x' }, '', false), false);
  assert.equal(shouldToggleThemeKey(null, '', false), false, 'never throws on a malformed event');

  // ...and the wiring routes through the SAME toggleTheme() the header
  // moon/sun button uses -- one shared path, never a second theme writer.
  const wireStart = COMMON.indexOf('function wireKeyboardShortcutsHelp');
  const wireEnd = COMMON.indexOf('\nfunction ', wireStart + 10);
  // Gate W2: strip comments first -- the literal `toggleTheme()` also lives
  // in the explanatory comment, so an un-stripped match is presence-in-a-
  // comment, not binding (the reviewer's deleted-call mutant SURVIVED the
  // earlier spelling of this lock).
  const body = COMMON.slice(wireStart, wireEnd)
    .split('\n').filter((line) => !/^\s*\/\//.test(line)).join('\n');
  assert.match(body, /shouldToggleThemeKey\(e, tag, editable\)/, 'the capture handler consults the pure decision');
  assert.match(body, /^\s*toggleTheme\(\);$/m, 'the verdict routes through the shared toggleTheme() as a real statement');
});

// ---- SEMANTIC locks (gate W5: existence is not enough) ---------------------
//
// The gate mutation-proved the original lock: changing skip(-5) to skip(-15)
// left the dialog saying "Back 5 seconds" and all 18 tests GREEN. That is not
// hypothetical -- v1.41.11 changed exactly that number (15s -> 5s), so the lock
// as written would have shipped a lying dialog through that very release.

test('SEMANTIC: the documented seek amounts match the code\'s actual arguments', () => {
  const handler = playerShortcutHandler();
  const amountFor = (caseLiteral) => {
    const idx = handler.indexOf(caseLiteral);
    assert.notEqual(idx, -1, `expected ${caseLiteral}`);
    // Bounded to THIS branch (up to its `break;`). A fixed character window
    // bled into the NEXT branch: with ArrowLeft's own skip(-5) deleted, it read
    // ArrowRight's skip(5), matched "Back 5 seconds", and a DEAD arrow key
    // shipped green (gate delta M-D).
    const end = handler.indexOf('break;', idx);
    const branch = handler.slice(idx, end === -1 ? idx + 160 : end);
    const m = /skip\((-?\d+)\)/.exec(branch);
    assert.ok(m, `expected a skip() call inside the ${caseLiteral} branch`);
    return Math.abs(Number(m[1]));
  };
  // Scoped to the PLAYBACK group: the arrows also appear under "Reading
  // (books)", and `allItems().find` resolved correctly only because Playback is
  // declared first -- reordering the groups would have silently retargeted this
  // assertion (gate delta, item 2, brittleness note).
  const playback = KEYBOARD_SHORTCUT_GROUPS.find((g) => g.title === 'Playback').items;
  const descFor = (cap) => playback.find((i) => i.keys.length === 1 && i.keys[0] === cap).desc;

  for (const [caseLiteral, cap] of [["case 'ArrowLeft':", 'ArrowLeft'], ["case 'ArrowRight':", 'ArrowRight'],
    ["case 'j':", 'J'], ["case 'l':", 'L']]) {
    const seconds = amountFor(caseLiteral);
    assert.match(descFor(cap), new RegExp(`\\b${seconds} seconds\\b`),
      `the dialog's "${descFor(cap)}" must state the ${seconds}s the code actually skips`);
  }
});

test('SEMANTIC: the reader arrows are documented in the RIGHT direction', () => {
  // The original assertion compared the doc list against itself -- a tautology
  // that stayed green with read.js's arrows inverted.
  assert.match(READ, /event\.key === 'ArrowRight'\) \{ if \(adapter\) adapter\.next\(\); \}/,
    'ArrowRight must advance');
  assert.match(READ, /event\.key === 'ArrowLeft'\) \{ if \(adapter\) adapter\.prev\(\); \}/,
    'ArrowLeft must go back');
  const reading = KEYBOARD_SHORTCUT_GROUPS.find((g) => g.title === 'Reading (books)');
  const rightRow = reading.items.find((i) => i.keys[0] === 'ArrowRight');
  const leftRow = reading.items.find((i) => i.keys[0] === 'ArrowLeft');
  assert.match(rightRow.desc, /Next/, 'the right arrow must be documented as forward');
  assert.match(leftRow.desc, /Previous/, 'the left arrow must be documented as back');
});

// ---- the trigger -----------------------------------------------------------

test('shouldOpenShortcuts: "?" opens it', () => {
  assert.equal(shouldOpenShortcuts({ key: '?' }, 'DIV', false), true);
  assert.equal(shouldOpenShortcuts({ key: '/' }, 'DIV', false), false);
  assert.equal(shouldOpenShortcuts({ key: 'k' }, 'DIV', false), false);
});

test('shouldOpenShortcuts: never fires while the user is typing', () => {
  // Otherwise "?" in the search box would open a dialog instead of a character.
  for (const tag of ['INPUT', 'TEXTAREA', 'SELECT', 'input', 'textarea']) {
    assert.equal(shouldOpenShortcuts({ key: '?' }, tag, false), false, `${tag} must be exempt`);
  }
  assert.equal(shouldOpenShortcuts({ key: '?' }, 'DIV', true), false, 'contenteditable must be exempt');
});

test('shouldOpenShortcuts: never hijacks a browser/OS combo', () => {
  for (const mod of ['ctrlKey', 'metaKey', 'altKey']) {
    assert.equal(shouldOpenShortcuts({ key: '?', [mod]: true }, 'DIV', false), false, `${mod} must pass through`);
  }
});

test('shouldOpenShortcuts: never throws on a malformed event', () => {
  for (const bad of [null, undefined, {}, 42, 'x']) {
    assert.doesNotThrow(() => shouldOpenShortcuts(bad, 'DIV', false));
    assert.equal(shouldOpenShortcuts(bad, 'DIV', false), false);
  }
});

// ---- the dialog ------------------------------------------------------------

test('buildShortcutsModal renders every group and row as text (never innerHTML)', () => {
  const d = doc();
  const { sheet, backdrop, modal } = buildShortcutsModal(d, {});
  // Sweep S9: the one overlay primitive - a ui.sheet dialog titled "Keyboard shortcuts", its
  // scrim the backdrop, the reference its content.
  assert.equal(backdrop, sheet.scrim);
  assert.ok(backdrop.classList.contains('ui-scrim'), 'the one scrim');
  assert.ok(sheet.el.classList.contains('ui-sheet') && sheet.el.classList.contains('ui-sheet--dialog'));
  assert.equal(sheet.el.getAttribute('role'), 'dialog');
  assert.equal(sheet.el.getAttribute('aria-modal'), 'true');
  assert.equal(sheet.el.querySelector('.ui-sheet__title').textContent, 'Keyboard shortcuts');
  assert.ok(modal.classList.contains('shortcuts-modal'));
  assert.strictEqual(modal.parentElement, sheet.body, 'the reference is the sheet body content');

  const titles = [...modal.querySelectorAll('.shortcuts-group-title')].map((n) => n.textContent);
  assert.deepEqual(titles, KEYBOARD_SHORTCUT_GROUPS.map((g) => g.title));
  assert.equal(modal.querySelectorAll('.shortcuts-row').length, allItems().length);
});

// Step 7 (UI pass, D1-AC4, DELIBERATE conversion of the arrow caps): an arrow key's cap is the
// registry arrow with an accessible name, never a text arrow glyph.
test('the arrow key caps draw the registry arrows (named for assistive tech), never a text arrow', () => {
  const d = doc();
  const { modal } = buildShortcutsModal(d, {});
  const caps = [...modal.querySelectorAll('kbd.shortcuts-kbd--icon')];
  const want = { 'Left arrow': 'arrow_back', 'Right arrow': 'arrow_forward', 'Up arrow': 'arrow_upward', 'Down arrow': 'arrow_downward' };
  assert.equal(caps.length, 6, 'Left/Right twice (playback, reading), Up/Down once');
  for (const k of caps) {
    const name = k.getAttribute('aria-label');
    assert.ok(want[name], 'a named arrow cap: ' + name);
    assert.equal(k.querySelector('svg.ui-icon use').getAttribute('href'), '#i-' + want[name]);
    assert.equal(k.textContent, '', 'no text glyph in the cap');
  }
  assert.doesNotMatch(modal.textContent, /[\u2190-\u2193]/, 'no arrow glyph anywhere in the reference');
});

test('the digit RANGE separator is not rendered as a key cap', () => {
  // "0 … 9" describes a range; rendering "…" as a <kbd> would imply a key that
  // does not exist -- the same class of lie the drift lock exists to prevent.
  const d = doc();
  const { modal } = buildShortcutsModal(d, {});
  const caps = [...modal.querySelectorAll('kbd')].map((k) => k.textContent);
  assert.ok(caps.includes('0') && caps.includes('9'));
  assert.ok(!caps.includes('…'), 'the range separator must be plain text');
});

test('the close control is wired and the backdrop closes on its own click only', () => {
  // Sweep S9: each of the sheet's own dismissals (Close, the scrim) reports through onClose,
  // exactly once; a click inside the dialog never closes it.
  for (const how of ['close', 'scrim']) {
    const d = doc();
    let closed = 0;
    const { sheet, modal, closeBtn } = buildShortcutsModal(d, { onClose: () => { closed += 1; } });
    sheet.open();
    modal.dispatchEvent(new d.defaultView.Event('click', { bubbles: true }));
    assert.equal(closed, 0, 'clicking inside the dialog must not close it');
    assert.strictEqual(closeBtn, sheet.el.querySelector('.ui-sheet__close'), 'the one Close is the sheet\'s');
    (how === 'close' ? closeBtn : sheet.scrim).dispatchEvent(new d.defaultView.Event('click', { bubbles: true }));
    assert.equal(closed, 1, how + ' closes, once');
    assert.equal(sheet.isOpen(), false);
  }
});

test('buildShortcutsModal never throws without handlers', () => {
  assert.doesNotThrow(() => buildShortcutsModal(doc(), undefined));
  assert.doesNotThrow(() => buildShortcutsModal(doc(), {}));
});

// ---- mobile exclusion (Dean's explicit ask) --------------------------------

test('MOBILE: the trigger is desktop-gated at EVENT time, not at boot', () => {
  // A laptop window can be resized after load; a boot-time check would strand
  // whichever answer it happened to see. Same reasoning as the pinch-zoom
  // suppression.
  const fn = COMMON.slice(COMMON.indexOf('function wireKeyboardShortcutsHelp()'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  assert.match(body, /if \(!isDesktopViewport\(\)\) return;/);
  assert.ok(body.indexOf('addEventListener') < body.indexOf('isDesktopViewport()'),
    'the desktop check must live INSIDE the handler, not around the binding');
  // Esc must still close on any viewport -- a dialog you cannot dismiss is worse
  // than one you cannot open.
  assert.ok(body.indexOf("e.key === 'Escape'") < body.indexOf('isDesktopViewport()'),
    'Esc must be handled before the desktop gate');
});

test('MOBILE (v1.165 DELIBERATE lock INVERSION): the Stats entry is VISIBLE on phones now', () => {
  // Dean reversed his v1.47.8 "not on mobile" ruling on 2026-08-22: the
  // shortcuts window hosts the DDR mini-synth (v1.163) whose arrows are
  // TAPPABLE, so the phone gets the entry (the toy) and the shortcut list rides
  // along as reference. Only the `?` KEY stays desktop-gated (next test).
  assert.match(STATS_HTML, /class="setup-box[^"]*shortcuts-entry"/);
  assert.match(STATS_HTML, /id="show-shortcuts-btn"/);
  // NO rule may hide the entry any more, at ANY width (the entry is now the
  // phone's ONLY route to the window). Gate W1 (delta): a `{`-anchored regex was
  // porous to a SELECTOR-LIST spelling (`.shortcuts-entry, .other { display:none }`
  // survived - the divergent-fixture class), so this net matches the class
  // anywhere in a selector prelude. Comments are stripped FIRST (the
  // comment-porous class): style.css legitimately MENTIONS .shortcuts-entry in
  // the v1.165 prose explaining the removal, and an unstripped net false-reds
  // on it.
  const cssNoComments = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/[^{}]*\.shortcuts-entry[^{}]*\{[^}]*display:\s*none/.test(cssNoComments),
    'no rule (any width, any selector-list spelling) may display:none the shortcuts entry');
  // ...and the section must not re-acquire the master-detail phone hide either.
  assert.doesNotMatch(STATS_HTML, /data-collapse-key="keyboard-shortcuts"[^>]*data-md-hide-mobile/,
    'keyboard-shortcuts must not be marked data-md-hide-mobile');
});

test('the desktop query matches the stylesheet phone breakpoint', () => {
  // 768px is the phone breakpoint everywhere in style.css; the JS gate must be
  // its complement or the button and the key would disagree at the boundary.
  assert.equal(SHORTCUTS_DESKTOP_QUERY, '(min-width: 769px)');
  assert.ok(CSS.includes('@media (max-width: 768px)'));
});

// ---- no touch-eating overlay (the v1.17.0 class) ---------------------------

test('closing REMOVES the dialog from the DOM rather than hiding it', () => {
  // v1.17.0: a backdrop left in the tree with an author `display` is an
  // invisible full-viewport click/touch eater. This dialog must not recreate it.
  // Sweep S9: the dialog is a ui.sheet, whose close removes the scrim AND the sheet from the
  // DOM when its exit ends (ui-builders binds that); closing routes through it.
  const fn = COMMON.slice(COMMON.indexOf('function closeShortcutsModal()'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  assert.match(body, /state\.sheet\.close\(\)/);
  assert.doesNotMatch(body, /hidden = true/, 'hiding is exactly the bug that class is about');
});

test('behaviour: open, then close -> the scrim and the sheet leave the DOM (no stranded click-eater)', async () => {
  const { JSDOM: J } = require('jsdom');
  const dom = new J('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
  const saved = { window: global.window, document: global.document };
  global.window = dom.window; global.document = dom.window.document;
  try {
    const common = require('../../public/js/common.js');
    common.openShortcutsModal();
    assert.ok(dom.window.document.querySelector('.ui-sheet .shortcuts-modal'), 'open');
    assert.strictEqual(common.isShortcutsModalOpen(), true);
    common.closeShortcutsModal();
    assert.strictEqual(common.isShortcutsModalOpen(), false, 'closed at once for other key handlers');
    for (let i = 0; i < 40 && dom.window.document.querySelector('.ui-sheet'); i++) await new Promise((r) => setTimeout(r, 20));
    assert.strictEqual(dom.window.document.querySelector('.ui-scrim'), null, 'no scrim left behind');
    assert.strictEqual(dom.window.document.querySelector('.ui-sheet'), null, 'no sheet left behind');
  } finally { Object.assign(global, saved); dom.window.close(); }
});

test('the dialog can never be stacked twice', () => {
  const fn = COMMON.slice(COMMON.indexOf('function openShortcutsModal()'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  assert.match(body, /if \(shortcutsModalState\.sheet\.el\.isConnected\) return;/,
    'holding "?" or double-pressing must not append two backdrops');
  // gate S9: a stranded reference must self-recover, not kill `?` for the session.
  assert.match(body, /shortcutsModalState = null;/);
});
