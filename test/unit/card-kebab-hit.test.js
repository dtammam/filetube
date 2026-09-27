'use strict';

// [UNIT] UI pass sweep S2 (D8.5) - the card's one control is reachable by touch
// without shadowing anything. Converted from test/unit/card-corner-mobile-size.test.js
// (AC12; a plan "risky conversion": gate W3 found the corner buttons' invisible
// ::after tap zones overlapping SIBLING pills in list view, so a tap on one
// control fired another). The corners are gone; what the lock guarded - every
// card control has a comfortable touch target and no control's hit area covers
// another control - now binds:
//   1. the kebab is a ui-btn --icon (built in card-action-menu.test.js), whose hit
//      area is the primitive's ::before of --hit (44px) at every width, never a
//      per-surface ::after inset;
//   2. the kebab lives in the card's INFO row (never over the thumbnail), in grid
//      AND list view, so the thumbnail link and the kebab cannot overlap; the card
//      has exactly one control (card-action-menu.test.js), so no sibling can be
//      shadowed;
//   3. no surface rule re-sizes the kebab or grows an ::after hit zone on a card.

const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert');
const { cssRules } = require('../helpers/stylesheets');

const ROOT = path.join(__dirname, '..', '..', 'public', 'css');
const UI = cssRules(fs.readFileSync(path.join(ROOT, 'ui.css'), 'utf8'));
const STYLE = cssRules(fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8'));
const TOKENS = fs.readFileSync(path.join(ROOT, 'tokens.css'), 'utf8');

test('the ui-btn icon hit area is --hit (44px) at every width, centred on the button', () => {
  assert.match(TOKENS, /--hit:\s*44px;/);
  const hit = UI.filter((r) => r.sel === '.ui-btn--icon::before');
  assert.strictEqual(hit.length, 1);
  assert.strictEqual(hit[0].at, '', 'not width-gated');
  assert.match(hit[0].body, /width:\s*var\(--hit\)/);
  assert.match(hit[0].body, /height:\s*var\(--hit\)/);
  assert.match(hit[0].body, /transform:\s*translate\(-50%, -50%\)/);
});

test('no card rule grows a hit zone or re-sizes the kebab (the W3 shadowing shape cannot come back)', () => {
  for (const r of STYLE) {
    if (/card-kebab/.test(r.sel)) assert.fail(`a surface rule styles the kebab: ${r.sel} (the primitive owns it)`);
    if (/\.video-card|\.video-info|\.card-media|\.video-grid/.test(r.sel) && /::?after|::?before/.test(r.sel)) {
      assert.doesNotMatch(r.body, /inset|position:\s*absolute/, `no card pseudo-element hit zone: ${r.sel}`);
    }
  }
});

test('list view keeps the kebab out of the thumbnail: the media is a fixed-width column, the info row (kebab) beside it', () => {
  const media = STYLE.filter((r) => r.sel === '.video-grid.list-view .card-media');
  assert.ok(media.length >= 1 && media.every((r) => /width:/.test(r.body)), 'the list-view thumb is its own column');
  const info = STYLE.find((r) => r.sel === '.video-grid.list-view .video-info' && r.at === '');
  assert.match(info.body, /flex:\s*1/, 'the info row (holding the kebab) takes the rest');
  const card = STYLE.find((r) => r.sel === '.video-grid.list-view .video-card' && r.at === '');
  assert.match(card.body, /flex-direction:\s*row/);
});
