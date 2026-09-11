'use strict';

// [UNIT] v1.281 (Dean): the immersive mobile music skin (body.mms-on, mobile+music only)
// flashed a scrollbar on the right at launch - the app's globally-styled ::-webkit-scrollbar
// showing on a child that briefly overflowed while the layout settled. The skin is
// drag/wheel/touch-driven, so no scrollbar belongs in it. This source-locks the hide (the
// visual is Dean's device arbiter). Scoped to body.mms-on so ordinary scrollable views keep
// their styled scrollbar.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const CSS = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'style.css'), 'utf8');

test('the immersive skin hides scrollbars (webkit + firefox), scoped to body.mms-on', () => {
  assert.match(CSS, /body\.mms-on ::-webkit-scrollbar \{ display:none; \}/, 'webkit scrollbar hidden inside the skin');
  // the Firefox twin lives INSIDE the one @supports not selector(::-webkit-scrollbar) guard
  // (the era-scrollbar ENGINE PARTITION: an unguarded scrollbar-width makes Chromium discard
  // all ::-webkit-scrollbar art). era-scrollbar-css.test.js enforces the partition itself.
  assert.match(CSS, /body\.mms-on, body\.mms-on \* \{ scrollbar-width: none; \}/, 'firefox twin present');
  const guard = /@supports not selector\(::-webkit-scrollbar\)\s*\{([\s\S]*?)\n\}/.exec(CSS);
  assert.ok(guard && /body\.mms-on, body\.mms-on \* \{ scrollbar-width: none; \}/.test(guard[1]), 'the Firefox twin sits INSIDE the @supports guard');
});

test('the hide is SCOPED to the skin (mms-on) - the global styled scrollbar is untouched', () => {
  // the app's global ::-webkit-scrollbar styling (line ~607) must still exist unscoped, so
  // ordinary scrollable views keep their gutter; only the immersive skin drops it.
  assert.match(CSS, /\n::-webkit-scrollbar \{/, 'the global scrollbar styling is still present');
  // the hide rule must carry the body.mms-on prefix (never a bare ::-webkit-scrollbar{display:none}).
  assert.doesNotMatch(CSS, /\n::-webkit-scrollbar \{ display:none; \}/, 'the hide is never global');
});
