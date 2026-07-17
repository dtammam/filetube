'use strict';

// [UNIT] v1.43.1 B3 — "space pauses the video while typing". Two mechanisms,
// both locked here against source text (the player.js DOM-wiring precedent;
// Dean's on-device pass arbitrates runtime):
//
//   1. The global shortcut switch (player.js) HAS guarded typing contexts
//      since v1.16 — but it deliberately early-returns (no preventDefault)
//      while a BUTTON is focused so keyboard users can operate controls.
//      That leaves the browser's click-the-focused-button default alive:
//      after a POINTER click on the pause button, the next Space re-fires
//      it. Fix: pointer-driven clicks on any player button blur it
//      (keyboard activations, e.detail === 0, keep focus for a11y).
//   2. read.js's arrow-key page-flip handler had NO typing guard at all —
//      arrows pressed mid-word in the search box flipped the book.
//
// Audit of every other key handler (this fix's census): main.js sort-menu
// keydowns are element-scoped (fire only with focus on the sort control);
// watch.js/common.js keydowns are Escape-only (closing a modal while typing
// in it is intended); setup.js/common.js keypress handlers are Enter-only
// and input-scoped. No other GLOBAL single-key surface exists.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const pub = (f) => fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', f), 'utf8');
const stripLineComments = (src) => src.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');

const PLAYER_JS = pub('player.js');
const READ_JS = pub('read.js');

test('player.js: the FULL-only shortcut switch keeps its typing-context guard (INPUT/TEXTAREA/BUTTON/SELECT/A + contenteditable)', () => {
  const code = stripLineComments(PLAYER_JS);
  assert.match(code, /\['INPUT', 'TEXTAREA', 'BUTTON', 'SELECT', 'A'\]\.indexOf\(tag\) !== -1 \|\| \(el && el\.isContentEditable\)/,
    'removing this guard makes every single-key shortcut fire while typing');
});

test('player.js: pointer clicks on player buttons blur (capture phase), keyboard activations keep focus', () => {
  const code = stripLineComments(PLAYER_JS);
  const m = /host\.addEventListener\('click', function \(e\) \{([\s\S]*?)\}, true\);/.exec(code);
  assert.ok(m, 'the capture-phase host click listener exists (capture: the control bar stopPropagation would starve a bubble listener)');
  const body = m[1];
  assert.match(body, /e\.detail === 0/, 'keyboard-synthesized clicks (detail 0) are exempt — Tab users keep their focus');
  assert.match(body, /closest\('button'\)/, 'delegated to every player button, not just play/pause');
  assert.match(body, /btn\.blur\(\)/, 'the focused-button Space re-fire dies at the source');
});

test('read.js: the arrow-key page-flip handler now refuses typing contexts', () => {
  const m = /document\.addEventListener\('keydown', \(event\) => \{([\s\S]*?)\}, \{ signal \}\);/.exec(stripLineComments(READ_JS));
  assert.ok(m, 'the reader keydown handler exists');
  const body = m[1];
  assert.match(body, /\['INPUT', 'TEXTAREA', 'SELECT'\]\.includes\(tag\) \|\| \(el && el\.isContentEditable\)/,
    'typing guard present');
  const guardIdx = body.indexOf("includes(tag)");
  const flipIdx = body.indexOf('adapter.next()');
  assert.ok(guardIdx !== -1 && flipIdx !== -1 && guardIdx < flipIdx, 'the guard runs BEFORE any page flip');
});
