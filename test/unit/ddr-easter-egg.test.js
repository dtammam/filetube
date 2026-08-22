'use strict';

// [UNIT] v1.163 (Dean) - the "FileTube FileTube Revolution" easter egg: a hidden
// mini-synth living in the top-right of the keyboard-shortcuts window (the Discord
// "DDR" homage), plus the desktop TWO-COLUMN layout so the whole reference fits
// without scrolling. This binds:
//   1. the pure key->note map (ddrNoteForArrow),
//   2. the header renders four arrow buttons + the subtitle,
//   3. a matching arrow key / a click lights the arrow up (the .ddr-hit pulse) -
//      the behaviour that survives even where Web Audio does not (jsdom),
//   4. the synth is source-guarded so a browser without AudioContext is silent,
//      never throwing,
//   5. the groups moved into a .shortcuts-body wrapper the CSS flows into two
//      columns on desktop.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const {
  DDR_ARROWS,
  ddrNoteForArrow,
  playDdrNote,
  buildShortcutsModal,
  openShortcutsModal,
  closeShortcutsModal,
  KEYBOARD_SHORTCUT_GROUPS,
  DDR_TEXT_PRESENTATION,
  ddrArrowDisplayGlyph,
} = require('../../public/js/common.js');

const COMMON = fs.readFileSync(path.join(__dirname, '../../public/js/common.js'), 'utf8');
const CSS = fs.readFileSync(path.join(__dirname, '../../public/css/style.css'), 'utf8');

function doc() {
  return new JSDOM('<!doctype html><html><body></body></html>').window.document;
}

// ---- the pure key -> note map ----------------------------------------------

test('DDR_ARROWS defines the four DDR arrows with distinct ascending notes', () => {
  assert.equal(DDR_ARROWS.length, 4, 'the four DDR directions');
  assert.deepEqual(DDR_ARROWS.map((a) => a.key),
    ['ArrowLeft', 'ArrowDown', 'ArrowUp', 'ArrowRight']);
  assert.deepEqual(DDR_ARROWS.map((a) => a.glyph), ['←', '↓', '↑', '→']);
  // Distinct, positive frequencies (a chord you can actually noodle a tune on).
  const freqs = DDR_ARROWS.map((a) => a.freq);
  assert.equal(new Set(freqs).size, 4, 'every arrow is a distinct note');
  assert.ok(freqs.every((f) => f > 0), 'real audible frequencies');
});

test('ddrNoteForArrow maps each arrow key to its frequency, everything else to 0', () => {
  for (const a of DDR_ARROWS) {
    assert.equal(ddrNoteForArrow(a.key), a.freq, `${a.key} -> its note`);
  }
  for (const k of ['k', 'Enter', 'Escape', ' ', 'a', '', null, undefined]) {
    assert.equal(ddrNoteForArrow(k), 0, `${k} is not a DDR key -> 0 (silent)`);
  }
});

// ---- the synth is guarded (never throws where Web Audio is absent) ----------

test('playDdrNote is a silent no-op (never throws) when AudioContext is unavailable', () => {
  // jsdom has no AudioContext, so this exercises the real degrade path the
  // easter egg ships with: no sound, no exception.
  assert.equal(typeof globalThis.window === 'undefined' || !globalThis.window.AudioContext, true,
    'the test env genuinely lacks Web Audio (otherwise this proves nothing)');
  assert.doesNotThrow(() => playDdrNote(440));
  assert.doesNotThrow(() => playDdrNote(0), 'a zero/invalid frequency is a no-op too');
  assert.doesNotThrow(() => playDdrNote(-1));
  assert.doesNotThrow(() => playDdrNote('nope'));
});

test('SOURCE: the synth is built on Web Audio and short-circuits when it is absent', () => {
  const start = COMMON.indexOf('function playDdrNote(');
  assert.notEqual(start, -1, 'playDdrNote exists');
  const body = COMMON.slice(start, COMMON.indexOf('\n}\n', start));
  // The guard that makes the no-op real, and the actual synthesis it guards.
  assert.match(body, /window\.AudioContext \|\| window\.webkitAudioContext/, 'reads the Web Audio ctor');
  assert.match(body, /if \(!Ctx\) return;/, 'silently returns when there is no AudioContext');
  assert.match(body, /createOscillator\(\)/, 'actually oscillates a note');
  assert.match(body, /catch \(_\)/, 'wrapped so a mid-play failure stays silent, never throws');
});

// ---- the header renders the arrows + subtitle ------------------------------

test('buildShortcutsModal renders the DDR arrow row (top-right) and the subtitle', () => {
  const d = doc();
  const { modal } = buildShortcutsModal(d, {});
  const row = modal.querySelector('.shortcuts-ddr');
  assert.ok(row, 'the arrow row renders');
  assert.equal(row.getAttribute('aria-hidden'), 'true', 'decorative to a screen reader');
  const arrows = [...row.querySelectorAll('.shortcuts-ddr-arrow')];
  assert.equal(arrows.length, 4, 'one button per DDR arrow');
  // Each rendered glyph is the bare arrow PLUS the U+FE0E text-presentation
  // selector (v1.163.1 - keep iOS from painting them as colour emoji). Uses the
  // exported constant, never a raw control byte in this source file.
  assert.deepEqual(arrows.map((b) => b.textContent),
    DDR_ARROWS.map((a) => a.glyph + DDR_TEXT_PRESENTATION));
  for (const b of arrows) {
    assert.ok(b.textContent.includes(DDR_TEXT_PRESENTATION),
      'the arrow carries the text-presentation selector so the OS renders it monochrome, not colour emoji');
  }
  for (const b of arrows) {
    assert.equal(b.tabIndex, -1, 'the arrows are not in the tab order (mouse/keys only)');
    assert.equal(b.type, 'button', 'never a submit');
  }
  const subtitle = modal.querySelector('.shortcuts-subtitle');
  assert.ok(subtitle, 'the DDR subtitle renders');
  assert.match(subtitle.textContent, /FileTube FileTube Revolution/,
    'the Discord-homage subtitle (the whole point of the joke)');
});

test('the text-presentation selector is U+FE0E and is appended by ddrArrowDisplayGlyph', () => {
  // v1.163.1: the fix for Dean's device (iOS painted the arrows blue/red as
  // colour emoji). The selector must be exactly VARIATION SELECTOR-15, and the
  // helper appends it to the bare glyph (which itself stays uncoloured/semantic).
  // SEL is built from the codepoint so THIS source file carries no raw control byte.
  const SEL = String.fromCharCode(0xFE0E);
  assert.equal(DDR_TEXT_PRESENTATION, SEL, 'exactly U+FE0E (text presentation)');
  assert.equal(DDR_TEXT_PRESENTATION.charCodeAt(0), 0xFE0E);
  for (const a of DDR_ARROWS) {
    assert.equal(ddrArrowDisplayGlyph(a.glyph), a.glyph + SEL, 'bare glyph + selector');
    // the DATA glyph is left bare (no selector baked into DDR_ARROWS).
    assert.equal(a.glyph.length, 1, 'the source-of-truth glyph carries no selector');
  }
  assert.equal(ddrArrowDisplayGlyph(null), SEL, 'never throws on a null glyph');
  assert.equal(ddrArrowDisplayGlyph(undefined), SEL);
});

test('CSS: the arrow GLYPH stays neutral (never coloured); only the SQUARE lights up on press, by axis', () => {
  const block = CSS.slice(CSS.indexOf('.shortcuts-ddr-arrow {'));
  const baseRule = block.slice(0, block.indexOf('}'));
  assert.match(baseRule, /font-variant-emoji:\s*text/,
    'the glyph is forced to monochrome text so iOS cannot emoji-colour the arrow itself');
  assert.match(baseRule, /color:\s*var\(--text-secondary\)/,
    'the glyph rests at the neutral secondary colour');
  // v1.163.2 (Dean): the GLYPH is NOT recoloured by axis - the resting axis-colour
  // rules were removed. Only .ddr-hit (the pressed SQUARE) is coloured by axis.
  assert.doesNotMatch(CSS, /\.shortcuts-ddr-arrow--[hv]\s*\{\s*color:/,
    'no resting axis rule recolours the glyph (that was the misread; it is gone)');
  // Pressed square: left/right (--h) flash BLUE, up/down (--v) flash RED. Theme tokens.
  assert.match(CSS, /\.shortcuts-ddr-arrow--h\.ddr-hit\s*\{[^}]*background-color:\s*var\(--text-link\)/,
    'left/right SQUARE lights blue on press (--text-link)');
  assert.match(CSS, /\.shortcuts-ddr-arrow--v\.ddr-hit\s*\{[^}]*background-color:\s*var\(--yt-red\)/,
    'up/down SQUARE lights red on press (--yt-red)');
  // The axis press-rules must follow the base .ddr-hit rule so equal-specificity
  // source order lets left/right's blue beat the base red.
  assert.ok(CSS.indexOf('.shortcuts-ddr-arrow--h.ddr-hit') > CSS.indexOf('.shortcuts-ddr-arrow.ddr-hit {'),
    'the axis press-colours are declared after the base .ddr-hit (source order wins at equal specificity)');
});

test('render: left/right arrows carry the --h class (blue press), up/down the --v class (red press)', () => {
  const d = doc();
  const { ddrByKey } = buildShortcutsModal(d, {});
  assert.ok(ddrByKey.ArrowLeft.el.classList.contains('shortcuts-ddr-arrow--h'), 'left = horizontal -> blue press');
  assert.ok(ddrByKey.ArrowRight.el.classList.contains('shortcuts-ddr-arrow--h'), 'right = horizontal -> blue press');
  assert.ok(ddrByKey.ArrowUp.el.classList.contains('shortcuts-ddr-arrow--v'), 'up = vertical -> red press');
  assert.ok(ddrByKey.ArrowDown.el.classList.contains('shortcuts-ddr-arrow--v'), 'down = vertical -> red press');
  // and the data field that drives it:
  for (const a of DDR_ARROWS) {
    assert.ok(a.axis === 'h' || a.axis === 'v', `${a.key} has a colour axis`);
  }
});

test('buildShortcutsModal exposes ddrByKey mapping each arrow key to its play+pulse handle', () => {
  const d = doc();
  const { ddrByKey } = buildShortcutsModal(d, {});
  assert.ok(ddrByKey, 'the key handler needs this map');
  assert.deepEqual(Object.keys(ddrByKey).sort(), DDR_ARROWS.map((a) => a.key).sort());
  for (const a of DDR_ARROWS) {
    assert.equal(ddrByKey[a.key].freq, a.freq, 'carries the right note');
    assert.equal(typeof ddrByKey[a.key].pulse, 'function', 'and a pulse trigger');
    assert.ok(ddrByKey[a.key].el.classList.contains('shortcuts-ddr-arrow'), 'points at its button');
  }
});

test('clicking an arrow lights it up (the .ddr-hit pulse) - the behaviour that survives without audio', () => {
  const d = doc();
  const { ddrByKey } = buildShortcutsModal(d, {});
  const left = ddrByKey.ArrowLeft.el;
  assert.ok(!left.classList.contains('ddr-hit'), 'starts un-lit');
  left.dispatchEvent(new d.defaultView.Event('click', { bubbles: true }));
  assert.ok(left.classList.contains('ddr-hit'), 'a click lights the arrow (playDdrNote is silent in jsdom, the pulse is not)');
});

// ---- the arrow keys drive the synth WHILE the window is open ----------------

test('KEY HANDLER: an arrow key lights the matching arrow and is swallowed while the window is open; released on close', () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
  const origWindow = global.window;
  const origDocument = global.document;
  global.window = dom.window;
  global.document = dom.window.document;
  try {
    openShortcutsModal();
    const state = dom.window.document.querySelector('.shortcuts-ddr');
    assert.ok(state, 'the window is open');
    const up = [...dom.window.document.querySelectorAll('.shortcuts-ddr-arrow')][2]; // ArrowUp is index 2

    const evt = new dom.window.KeyboardEvent('keydown', { key: 'ArrowUp', cancelable: true, bubbles: true });
    dom.window.document.dispatchEvent(evt);
    assert.ok(up.classList.contains('ddr-hit'), 'the matching arrow lit up');
    assert.equal(evt.defaultPrevented, true, 'the key is consumed so it never seeks/scrolls behind the dialog');

    // A non-arrow key is NOT swallowed (Esc/Tab/? must still work).
    const kEvt = new dom.window.KeyboardEvent('keydown', { key: 'k', cancelable: true, bubbles: true });
    dom.window.document.dispatchEvent(kEvt);
    assert.equal(kEvt.defaultPrevented, false, 'non-DDR keys pass through untouched');

    // Close: the capture-phase listener must be removed or it eats arrows forever.
    closeShortcutsModal();
    const after = new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true, bubbles: true });
    dom.window.document.dispatchEvent(after);
    assert.equal(after.defaultPrevented, false, 'once closed, arrows return to the player (handler unbound)');
  } finally {
    global.window = origWindow;
    global.document = origDocument;
    dom.window.close();
  }
});

test('KEY HANDLER: a modifier+arrow combo passes through (bare arrows only)', () => {
  // OS/browser shortcuts like Cmd/Ctrl/Alt+Arrow must not be eaten or play a note
  // (gate fix: mirror player.js's modifier bail).
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
  const origWindow = global.window;
  const origDocument = global.document;
  global.window = dom.window;
  global.document = dom.window.document;
  try {
    openShortcutsModal();
    const left = [...dom.window.document.querySelectorAll('.shortcuts-ddr-arrow')][0]; // ArrowLeft
    for (const mod of ['ctrlKey', 'metaKey', 'altKey']) {
      const evt = new dom.window.KeyboardEvent('keydown', { key: 'ArrowLeft', [mod]: true, cancelable: true, bubbles: true });
      dom.window.document.dispatchEvent(evt);
      assert.equal(evt.defaultPrevented, false, `${mod}+Arrow must pass through to the browser/OS`);
      assert.ok(!left.classList.contains('ddr-hit'), `${mod}+Arrow must NOT play a note`);
    }
    // ...but a bare arrow still fires.
    const bare = new dom.window.KeyboardEvent('keydown', { key: 'ArrowLeft', cancelable: true, bubbles: true });
    dom.window.document.dispatchEvent(bare);
    assert.equal(bare.defaultPrevented, true, 'a bare arrow is still consumed and plays');
    closeShortcutsModal();
  } finally {
    global.window = origWindow;
    global.document = origDocument;
    dom.window.close();
  }
});

test('LEAK GUARD: a stranded backdrop, then a fresh open, does NOT leave the old capture handler eating arrows', () => {
  // The strand-recovery arm of openShortcutsModal must unbind the leaked DDR
  // handler, or the old capture listener keeps swallowing arrows session-wide
  // (gate: QA WARNING / adversarial S3). Simulate a strand: remove the backdrop
  // WITHOUT routing through closeShortcutsModal, then re-open and close.
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
  const origWindow = global.window;
  const origDocument = global.document;
  global.window = dom.window;
  global.document = dom.window.document;
  try {
    openShortcutsModal();                                           // binds handler H1
    dom.window.document.querySelector('.oneoff-modal-backdrop').remove(); // strand it (H1 still on document)
    openShortcutsModal();                                           // strand-recovery: must release H1, bind H2
    closeShortcutsModal();                                          // releases H2
    // If H1 leaked, it is still a capture listener on document and would eat this.
    const evt = new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true, bubbles: true });
    dom.window.document.dispatchEvent(evt);
    assert.equal(evt.defaultPrevented, false,
      'after a strand+recover+close, NO leaked handler eats the arrow (the strand arm unbound it)');
  } finally {
    global.window = origWindow;
    global.document = origDocument;
    dom.window.close();
  }
});

test('SOURCE: the arrow-key handler is capture-phase, bare-arrow-only, and unbound on both close and strand', () => {
  // Capture phase so it beats player.js's seek/volume handlers; unbound on close
  // so it never eats arrow keys session-wide (a stuck capture listener would).
  const openStart = COMMON.indexOf('function openShortcutsModal()');
  const openBody = COMMON.slice(openStart, COMMON.indexOf('\n}\n', openStart));
  assert.match(openBody, /addEventListener\('keydown', ddrKeyHandler, true\)/,
    'bound on the CAPTURE phase');
  assert.match(openBody, /e\.preventDefault\(\)/, 'consumes the arrow');
  assert.match(openBody, /e\.stopPropagation\(\)/, 'stops the arrow bubbling to other keydown consumers');
  assert.match(openBody, /e\.ctrlKey \|\| e\.metaKey \|\| e\.altKey/,
    'bare arrows only - OS modifier combos pass through');
  assert.match(openBody, /shortcutsModalState\.ddrKeyHandler = ddrKeyHandler/, 'stashed for teardown');
  // The strand-recovery arm must ALSO release the leaked handler.
  assert.match(openBody, /removeEventListener\('keydown', shortcutsModalState\.ddrKeyHandler, true\)/,
    'the strand-recovery arm unbinds the leaked capture handler');

  const closeStart = COMMON.indexOf('function closeShortcutsModal()');
  const closeBody = COMMON.slice(closeStart, COMMON.indexOf('\n}\n', closeStart));
  assert.match(closeBody, /removeEventListener\('keydown', shortcutsModalState\.ddrKeyHandler, true\)/,
    'the capture listener is removed on close');
});

test('SOURCE: the pulse forces a reflow between remove and add so a rapid re-press retriggers the pop', () => {
  // `void el.offsetWidth` between removing and re-adding .ddr-hit is what makes a
  // second quick press restart the CSS animation instead of no-op'ing. Bind the
  // exact sequence (adversarial S1: the bare reflow line had no lock).
  assert.match(COMMON,
    /classList\.remove\('ddr-hit'\);\s*void [A-Za-z_$][\w$]*\.offsetWidth;\s*[A-Za-z_$][\w$]*\.classList\.add\('ddr-hit'\)/,
    'remove -> reflow -> add, in that order');
});

// ---- the desktop two-column layout (Dean: "fit without scrolling") ----------

test('the shortcut groups live in a .shortcuts-body wrapper (the two-column host)', () => {
  const d = doc();
  const { modal } = buildShortcutsModal(d, {});
  const body = modal.querySelector('.shortcuts-body');
  assert.ok(body, 'the groups are wrapped so the CSS can column them');
  const grouped = body.querySelectorAll('.shortcuts-group');
  assert.equal(grouped.length, KEYBOARD_SHORTCUT_GROUPS.length,
    'every group is INSIDE the body wrapper (not stranded on the modal)');
  // Nothing must append a group directly onto the modal, bypassing the columns.
  assert.equal(modal.querySelectorAll(':scope > .shortcuts-group').length, 0,
    'no group escapes the two-column body');
});

test('CSS: desktop flows the body into two columns and widens the window; mobile stays single', () => {
  const desktop = CSS.split('@media (min-width: 769px)').slice(1).join('\n');
  assert.match(desktop, /\.shortcuts-body\s*\{[^}]*column-count:\s*2/,
    'desktop flows the reference into two columns (no scroll)');
  assert.match(desktop, /\.shortcuts-modal\s*\{[^}]*max-width:\s*840px/,
    'and widens the window to hold them');
  assert.match(desktop, /\.shortcuts-body \.shortcuts-group\s*\{[^}]*break-inside:\s*avoid/,
    'a group never splits across the column break');
  // The base (mobile) rule keeps the narrow single column.
  assert.match(CSS, /\.shortcuts-modal\s*\{\s*max-width:\s*560px/,
    'mobile keeps the single 560px column (unchanged)');
});

test('CSS: the .ddr-hit pulse is disabled under reduced motion', () => {
  const reduced = CSS.split('@media (prefers-reduced-motion: reduce)').slice(1).join('\n');
  assert.match(reduced, /\.shortcuts-ddr-arrow\.ddr-hit\s*\{\s*animation:\s*none/,
    'the pulse honours prefers-reduced-motion');
});
