'use strict';

// [UNIT] v1.278 (Dean): the DESKTOP /music actions menu - the video-parity Extras
// (Share/Transcript/Watch/Reheat/Like/Watched/queue/Move/Delete, "if relevant") brought
// to the desktop now-playing view via the SHARED createExtrasMenu factory (skin-surface.js),
// triggered from the top toolbar. These bind the pieces the JS suites can't see: the CSS
// lift (Task 3) that lets the desktop menu be styled, and the shared factory being on the
// public API. The live desktop feel is Dean's device arbiter.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'css', 'style.css'), 'utf8');
const SKIN = fs.readFileSync(path.join(ROOT, 'public', 'js', 'skin-surface.js'), 'utf8');

// ---- Task 2: the Extras action core is a SHARED factory on the public API ----------

test('createExtrasMenu is exported so BOTH the skin engine and the desktop menu reuse ONE core (DRY, no second menu)', () => {
  assert.match(SKIN, /createExtrasMenu:\s*createExtrasMenu/, 'FileTubeSkinSurface exposes createExtrasMenu');
  assert.match(SKIN, /function createExtrasMenu\(cfg\)/, 'the factory exists');
  assert.match(SKIN, /return \{ open: open, handleAction: handleAction, cancelPending: cancelPending, destroy: destroy \};/, 'the documented shape');
});

// ---- Task 3: the CSS lift - the .mms-sm-* item styling is UNCONDITIONAL so the desktop
// menu (which carries the .mms-sticker-menu class) is dressed; only the mobile POSITIONING
// stays behind @media (max-width:768px). --------------------------------------------------

test('the sticker/actions item styling is lifted OUT of the mobile media query (else the desktop menu ships unstyled)', () => {
  const actIdx = CSS.indexOf('.mms-sticker-menu .mms-sm-act{');
  const mobileStickerIdx = CSS.indexOf('body.mms-tray .mms-sticker-menu{ position:fixed');
  assert.ok(actIdx > 0, 'the .mms-sm-act item rule exists');
  assert.ok(mobileStickerIdx > 0, 'the mobile-only tray positioning still exists (inside @media)');
  assert.ok(actIdx < mobileStickerIdx,
    'the .mms-sm-act item rule sits ABOVE the mobile sticker @media block - i.e. it is unconditional, so the desktop actions menu is styled');
});

test('the desktop actions menu has its own top-anchored positioning (not the mobile bottom-of-corner-sticker anchor)', () => {
  assert.match(CSS, /#music-actions-menu\{[^}]*position:absolute/, 'the desktop menu is absolutely positioned');
  assert.match(CSS, /#music-actions-menu\{[^}]*top:calc\(100% \+ var\(--space-3\)\)/, 'anchored BELOW its toolbar button');
  assert.match(CSS, /\.music-actions-wrap\{[^}]*position:relative/, 'the wrapper is the positioning context');
});
