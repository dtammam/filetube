'use strict';

// [UNIT] Feature A (v1.26.1, Shorts player-size jump) + Feature B (audio-mode
// caption overlay) -- mechanical CSS-presence guards, mirroring the existing
// test/unit/player-responsive-controls.test.js style-locking pattern. Visual
// feel is Dean's on-device iOS arbiter; these lock that the SELECTORS/
// declarations this release depends on actually exist in style.css.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const CSS_PATH = path.join(__dirname, '..', '..', 'public', 'css', 'style.css');
const css = fs.readFileSync(CSS_PATH, 'utf8');

// ---- Feature A: reserved aspect-ratio ---------------------------------------

test('the in-slot #media-player rule consumes --media-aspect with a 16/9 fallback (never a bare hardcoded 16/9)', () => {
  const rule = /#player-wrapper:not\(\.audio-expanded\)\s+#media-player\s*\{([^}]*)\}/.exec(css);
  assert.ok(rule, 'expected the base #player-wrapper:not(.audio-expanded) #media-player rule');
  assert.match(rule[1], /aspect-ratio:\s*var\(--media-aspect,\s*16\s*\/\s*9\);/);
});

test('the DOCKED mini-player forces a compact 16:9 regardless of --media-aspect (a portrait item must never balloon the dock)', () => {
  const rule = /#player-dock\s+#player-wrapper:not\(\.audio-expanded\)\s+#media-player\s*\{([^}]*)\}/.exec(css);
  assert.ok(rule, 'expected a docked-scoped #media-player override');
  assert.match(rule[1], /aspect-ratio:\s*16\s*\/\s*9;/);
  assert.ok(!/var\(--media-aspect/.test(rule[1]), 'the docked override must NOT reference --media-aspect');
});

test('a mobile-portrait height clamp exists for `.portrait-media`, taller than the base 45vh (landscape-tuned) clamp', () => {
  const portraitBlockMatch = /@media \(max-width: 768px\) and \(orientation: portrait\)\s*\{([\s\S]*?)\n\}/.exec(css);
  assert.ok(portraitBlockMatch, 'expected the mobile-portrait @media block');
  const block = portraitBlockMatch[1];
  assert.match(block, /\.player-container\s*\{\s*max-height:\s*45vh;/, 'the base (landscape-tuned) 45vh clamp must still exist, unchanged');
  assert.match(block, /#player-wrapper\.portrait-media\s*\{\s*max-height:\s*min\(78vh,/, 'expected a taller .portrait-media-scoped clamp');
});

test('Feature A introduces no hardcoded color values (aspect-ratio/max-height geometry only)', () => {
  const marker = css.indexOf('Feature A (v1.26.1, Shorts player-size jump): the DOCKED mini-player');
  assert.ok(marker > -1, 'expected to find the Feature A docked-clamp section');
  const section = css.slice(marker, marker + 1200);
  assert.ok(!/#[0-9a-fA-F]{3,6}\b/.test(section.replace(/black backdrop/gi, '')), 'no new hardcoded hex colors expected in the Feature A geometry rules');
});

// ---- Feature B: caption overlay ---------------------------------------------

test('.cc-overlay exists, positioned/hidden via the native [hidden] attribute, above the control strip (in-slot desktop offset 40px)', () => {
  const rule = /(?:^|\n)\.cc-overlay\s*\{([^}]*)\}/.exec(css);
  assert.ok(rule, 'expected a base .cc-overlay rule');
  assert.match(rule[1], /position:\s*absolute;/);
  assert.match(rule[1], /bottom:\s*40px;/);
  assert.match(css, /\.cc-overlay\[hidden\]\s*\{\s*display:\s*none;/);
});

test('.cc-overlay-text renders via textContent-safe styling (white-space: pre-line preserves player.js\'s newline-joined multi-line cues) and uses the era --font-family token, not a hardcoded font', () => {
  const rule = /\.cc-overlay-text\s*\{([^}]*)\}/.exec(css);
  assert.ok(rule, 'expected a .cc-overlay-text rule');
  assert.match(rule[1], /white-space:\s*pre-line;/);
  assert.match(rule[1], /font-family:\s*var\(--font-family\);/);
});

test('.cc-overlay gets the mobile 44px offset and the docked 26px offset, mirroring #audio-bg-art\'s own per-view offsets', () => {
  const mobileBlockMatch = /@media \(max-width: 768px\)\s*\{([\s\S]*?)\n\}/g;
  let foundMobile = false;
  let m;
  while ((m = mobileBlockMatch.exec(css))) {
    if (/\.cc-overlay\s*\{[^}]*bottom:\s*44px;/.test(m[1])) { foundMobile = true; break; }
  }
  assert.ok(foundMobile, 'expected a @media (max-width: 768px) block with .cc-overlay { bottom: 44px; }');
  assert.match(css, /#player-dock\s+\.cc-overlay\s*\{\s*bottom:\s*26px;/);
});

test('the audio-expanded view offsets .cc-overlay above the FLUSH control bar (v1.34.6: 56px desktop / 94px two-row mobile + safe-area-inset-bottom)', () => {
  assert.match(css, /#player-wrapper\.audio-mode\.audio-expanded\s+\.cc-overlay\s*\{\s*bottom:\s*calc\(56px \+ env\(safe-area-inset-bottom,\s*0px\)\);/);
  const mobileBlockMatch = /@media \(max-width: 768px\)\s*\{([\s\S]*?)\n\}/g;
  let found = false;
  let m;
  while ((m = mobileBlockMatch.exec(css))) {
    if (/#player-wrapper\.audio-mode\.audio-expanded\s+\.cc-overlay\s*\{[^}]*bottom:\s*calc\(94px \+ env\(safe-area-inset-bottom,\s*0px\)\);/.test(m[1])) {
      found = true;
      break;
    }
  }
  assert.ok(found, 'expected a mobile-scoped 44px + safe-area .cc-overlay offset in the audio-expanded view');
});

// ---- v1.34 T1 (Dean): Shorts same-footprint-as-16:9 lock --------------------
// A portrait/Shorts item's FULL player box is pinned to 16:9 (the global
// `.player-container video { object-fit: contain }` pillarboxes the tall
// picture inside it) so it can never render taller than a normal video --
// on desktop OR mobile. The docked override has always done this for the
// mini-player; this locks the FULL-player twin.
test('v1.34: .portrait-media pins the FULL player box to 16:9 (Shorts same footprint as normal videos)', () => {
  assert.match(
    css,
    /#player-wrapper\.portrait-media:not\(\.audio-expanded\)\s+#media-player\s*\{\s*aspect-ratio:\s*16\s*\/\s*9;\s*height:\s*auto;/,
    'expected the portrait-media 16:9 footprint override after the base var(--media-aspect) rule'
  );
  // Ordering matters at equal specificity tiers: the override must appear
  // AFTER the base var() rule so portrait wins.
  const baseIdx = css.indexOf('aspect-ratio: var(--media-aspect, 16 / 9);');
  const overrideIdx = css.indexOf('#player-wrapper.portrait-media:not(.audio-expanded) #media-player');
  assert.ok(baseIdx >= 0 && overrideIdx > baseIdx, 'the portrait override must come after the base aspect rule');
});
