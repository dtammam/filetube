'use strict';

// [UNIT] v1.13.0 item 2 (AC5/AC7) -- the mobile-PORTRAIT player height cap.
// The visual correctness itself is Dean's on-device call (AC6); this is the
// mechanical CSS-presence guard: a media query scoped to a narrow, PORTRAIT
// viewport sets `.player-container`'s `max-height` to a value in the
// requested 40vh-50vh range, and desktop/landscape are left alone (no
// unscoped `.player-container { max-height: ... }` rule exists outside that
// query).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const CSS_PATH = path.join(__dirname, '..', '..', 'public', 'css', 'style.css');
const css = fs.readFileSync(CSS_PATH, 'utf8');

test('mobile player height: a portrait-scoped media query sets .player-container max-height between 40vh and 50vh', () => {
  // Match an `@media (... ) and (orientation: portrait) { ... .player-container { ... max-height: <N>vh ... } ... }`
  // block -- deliberately permissive about exact media-query syntax/ordering,
  // strict about the selector + property + value range.
  const mediaBlockRe = /@media[^{]*orientation:\s*portrait[^{]*\{([\s\S]*?)\n\}/g;
  let found = null;
  let match;
  while ((match = mediaBlockRe.exec(css)) !== null) {
    const block = match[1];
    const rule = /\.player-container\s*\{[^}]*max-height:\s*(\d+(?:\.\d+)?)vh/.exec(block);
    if (rule) {
      found = Number(rule[1]);
      break;
    }
  }
  assert.ok(found !== null, 'expected a portrait-scoped @media block setting .player-container max-height in vh');
  assert.ok(found >= 40 && found <= 50, `expected the portrait max-height (${found}vh) to be within the 40-50vh target range`);
});

test('mobile player height: the base (unscoped) .player-container rule carries no max-height (desktop/base behavior untouched)', () => {
  const baseRuleMatch = /(?:^|\n)\.player-container\s*\{([^}]*)\}/.exec(css);
  assert.ok(baseRuleMatch, 'expected to find the base .player-container rule');
  assert.ok(!/max-height/.test(baseRuleMatch[1]), 'the unscoped base .player-container rule must not itself cap max-height');
  // The aspect-ratio + object-fit:contain letterboxing this cap relies on
  // must still be present and unchanged.
  assert.match(baseRuleMatch[1], /aspect-ratio:\s*16\/9/);
});

test('mobile player height: the landscape-orientation media query does not touch .player-container (landscape unaffected)', () => {
  const landscapeBlockRe = /@media[^{]*orientation:\s*landscape[^{]*\{([\s\S]*?)\n\}/g;
  let match;
  while ((match = landscapeBlockRe.exec(css)) !== null) {
    assert.ok(!/\.player-container/.test(match[1]), 'a landscape media query must not style .player-container');
  }
});

test('mobile player height: the audio-mode/.audio-bg-art rules are untouched by this change (still present, unscoped by any new media query)', () => {
  // v1.21 FR-2 (T2) additively extended this rule with pointer-events/cursor
  // (the cover-art click-to-play surface) -- still asserting the same core
  // "audio mode reveals the art" declaration this test has always guarded,
  // just no longer requiring it to be the ONLY declaration in the block.
  assert.match(css, /#player-wrapper\.audio-mode #audio-bg-art\s*\{[^}]*display:\s*block;[^}]*\}/);
  assert.match(css, /#player-wrapper\.audio-mode #media-player\s*\{/);
});
