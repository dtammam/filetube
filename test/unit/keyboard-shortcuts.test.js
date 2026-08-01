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
  const start = PLAYER.indexOf("document.addEventListener('keydown'");
  assert.notEqual(start, -1, 'expected the player keydown handler');
  // The handler ends where the NEXT document-level keydown listener begins
  // (player.js binds a second one for the audio-expand Escape).
  const next = PLAYER.indexOf("document.addEventListener('keydown'", start + 10);
  const raw = PLAYER.slice(start, next === -1 ? PLAYER.length : next);
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
    '←': "case 'ArrowLeft':",
    '→': "case 'ArrowRight':",
    '↑': "case 'ArrowUp':",
    '↓': "case 'ArrowDown':",
    F: "case 'f':",
    C: "case 'c':",
    '<': "case '<':",
    '>': "case '>':",
    N: "case 'N':",
    P: "case 'P':",
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
    "case 'ArrowLeft':": '\u2190', "case 'ArrowRight':": '\u2192',
    "case 'ArrowUp':": '\u2191', "case 'ArrowDown':": '\u2193',
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
  // R/S live OUTSIDE the main switch by design (the switch early-returns on
  // a focused BUTTON, the exact post-overlay-render state) -- they are
  // accounted for here and drift-locked against their OWN listener below.
  // D (v1.50.3 dark/light) is GLOBAL (any page, not just the player) and
  // lives in common.js's capture-phase handler -- drift-locked below too.
  const accountedFor = new Set([...Object.values(CAP_FOR_CASE), 'Shift', '0', '9', '\u2026', '?', 'R', 'S', 'D']);
  const invented = [...documented].filter((k) => !accountedFor.has(k));
  assert.deepEqual(invented, [], `advertised but unaccounted for: ${invented}`);
});

test('DRIFT LOCK: the documented R/S resume keys are really handled (their own listener + the pure decision table)', () => {
  // The dialog documents R/S with a "while the Resume prompt is showing"
  // scope; the real handler is resolveResumeShortcutAction + a dedicated
  // listener that routes through the REAL buttons' .click() (one shared
  // decision path with the mouse). Both halves are locked:
  const { resolveResumeShortcutAction } = require('../../public/js/player.js');
  assert.equal(resolveResumeShortcutAction({ key: 'r', overlayVisible: true }), 'resume');
  assert.equal(resolveResumeShortcutAction({ key: 'S', overlayVisible: true }), 'restart');
  assert.equal(resolveResumeShortcutAction({ key: 'r', overlayVisible: false }), 'none',
    'the advertised scoping ("while the prompt is showing") must be real');

  // ...and the listener actually wires the verdicts to the real buttons.
  const start = PLAYER.indexOf('resolveResumeShortcutAction({');
  assert.notEqual(start, -1, 'expected the resume-shortcut listener call site');
  const wiring = PLAYER.slice(start, start + 800);
  assert.match(wiring, /resumeYesBtn\.click\(\)/, 'R must route through the real Resume button');
  assert.match(wiring, /resumeNoBtn\.click\(\)/, 'S must route through the real Start-over button');
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

  for (const [caseLiteral, cap] of [["case 'ArrowLeft':", '\u2190'], ["case 'ArrowRight':", '\u2192'],
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
  const rightRow = reading.items.find((i) => i.keys[0] === '\u2192');
  const leftRow = reading.items.find((i) => i.keys[0] === '\u2190');
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
  const { backdrop, modal } = buildShortcutsModal(d, {});
  assert.equal(backdrop.className, 'oneoff-modal-backdrop', 'reuses the existing modal chrome');
  assert.ok(modal.classList.contains('shortcuts-modal'));
  assert.equal(modal.getAttribute('role'), 'dialog');
  assert.equal(modal.getAttribute('aria-modal'), 'true');

  const titles = [...modal.querySelectorAll('.shortcuts-group-title')].map((n) => n.textContent);
  assert.deepEqual(titles, KEYBOARD_SHORTCUT_GROUPS.map((g) => g.title));
  assert.equal(modal.querySelectorAll('.shortcuts-row').length, allItems().length);
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
  const d = doc();
  let closed = 0;
  const { modal, closeBtn } = buildShortcutsModal(d, { onClose: () => { closed += 1; } });
  closeBtn.dispatchEvent(new d.defaultView.Event('click'));
  assert.equal(closed, 1);
  // A click on the dialog body must NOT dismiss it.
  modal.dispatchEvent(new d.defaultView.Event('click', { bubbles: true }));
  assert.equal(closed, 1, 'clicking inside the dialog must not close it');
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

test('MOBILE: the Stats entry point is hidden at the phone breakpoint', () => {
  // v1.55 Track D (DELIBERATE lock update): the box gained sub-collapsible
  // between the two anchor classes -- match the list openly.
  assert.match(STATS_HTML, /class="setup-box[^"]*shortcuts-entry"/);
  assert.match(STATS_HTML, /id="show-shortcuts-btn"/);
  // v1.63 lock conversion (disclosed): this used to slice from the LAST
  // phone media block - an incidental anchor that broke the day the queue
  // panel appended a newer one. The semantics were always "SOME phone
  // block hides the entry"; assert that directly across every block.
  const phoneBlocks = CSS.split('@media (max-width: 768px)').slice(1);
  assert.ok(phoneBlocks.some((b) => /\.shortcuts-entry \{\s*display: none;\s*\}/.test(b)),
    'a phone must not be offered a keyboard reference it cannot use');
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
  const fn = COMMON.slice(COMMON.indexOf('function closeShortcutsModal()'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  assert.match(body, /backdrop\.remove\(\)/);
  assert.doesNotMatch(body, /hidden = true/, 'hiding is exactly the bug that class is about');
});

test('the dialog can never be stacked twice', () => {
  const fn = COMMON.slice(COMMON.indexOf('function openShortcutsModal()'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  assert.match(body, /if \(shortcutsModalState\.backdrop\.isConnected\) return;/,
    'holding "?" or double-pressing must not append two backdrops');
  // gate S9: a stranded reference must self-recover, not kill `?` for the session.
  assert.match(body, /shortcutsModalState = null;/);
});
