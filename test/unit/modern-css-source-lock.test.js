'use strict';

// [UNIT] v1.84 T6 - source-lock the Modern-mode CSS. These view styles MUST live
// in style.css (the SPA swaps only #view-root, so a page-local <style> would be
// lost on in-app nav - the repo's recurring lesson). Binding the load-bearing
// rules means a stylesheet edit that drops the modern grid, chips, avatar bar,
// rounded thumbs, or the monogram custom-property consumption goes RED here
// rather than silently on Dean's device.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'style.css'), 'utf8');

test('the flat grid: 3-up on desktop, 4-up on wide, 1-up on phones', () => {
  assert.match(css, /\.modern-home-mode #video-grid \{[^}]*grid-template-columns:\s*repeat\(3,\s*1fr\)/,
    'modern home is a 3-up grid');
  assert.match(css, /@media \(min-width:\s*1500px\)\s*\{\s*\.modern-home-mode #video-grid \{\s*grid-template-columns:\s*repeat\(4,\s*1fr\)/,
    'reflows to 4-up on wide desktops');
  // 1-up on phones lives in the 480px block.
  const phone = css.split('@media (max-width: 480px)').slice(1);
  assert.ok(phone.some((b) => /\.modern-home-mode #video-grid \{[^}]*grid-template-columns:\s*1fr/.test(b)),
    'one full-width card per row on phones');
});

test('the filter chips + active pill', () => {
  assert.match(css, /\.modern-chip \{[^}]*border-radius:\s*var\(--radius-full\)/, 'chips are pills');
  assert.match(css, /\.modern-chip\.active \{[^}]*background-color:\s*var\(--text-primary\)/, 'the active chip is the inverted pill');
});

test('the mobile avatar bar is hidden on desktop', () => {
  assert.match(css, /\.modern-avatar-bar \{/, 'the avatar bar exists');
  assert.match(css, /@media \(min-width:\s*1024px\)\s*\{\s*\.modern-avatar-bar \{\s*display:\s*none/,
    'desktop hides the avatar bar (YouTube desktop uses the sidebar for subs)');
});

test('rounded thumbnails wherever modern is on', () => {
  assert.match(css, /html\[data-modern="on"\][^{]*\.card-media[^{]*\{[^}]*border-radius:\s*var\(--radius-lg\)/,
    'modern rounds the thumbnail');
});

test('the byline monogram consumes the inline --ch-av custom property (census-safe colour)', () => {
  assert.match(css, /\.card-channel-avatar-mono \{\s*background-color:\s*var\(--ch-av\b/,
    'the per-card monogram colour comes from the inline custom property T5 sets');
});

test('(v1.85.2 #3+#4) modern home hides the whole section-title row (folder heading + controls bar)', () => {
  // Dean, on-device: the modern grid should not show the default folder-name
  // heading ("Downloads") NOR the sort/shuffle/rescan/view controls. One rule
  // hides the wrapper that holds both. It MUST out-specify the base display.
  assert.match(css, /\.modern-home-mode \.section-title \{\s*display:\s*none/,
    'the modern section-title hide must exist and be class-scoped (0,2,0)');

  // Prove it WINS (the v1.85 device-pass lesson): the only rule that sets
  // `display` on .section-title is the base `.section-title { ...display:flex }`
  // at (0,1,0); the id-scoped `#library-content .section-title` sets position/
  // margins but NEVER display. So no higher-or-equal-specificity display rule
  // can tie-and-follow ours. Assert that invariant so a future edit that adds
  // `#library-content .section-title { display: ... }` (which WOULD beat us at
  // 1,1,0) trips this test instead of silently re-showing the row on-device.
  const idScoped = css.match(/#library-content \.section-title \{[^}]*\}/g) || [];
  for (const block of idScoped) {
    assert.doesNotMatch(block, /display\s*:/,
      'no #library-content .section-title rule may set display, or it (1,1,0) would defeat the modern hide (0,2,0)');
  }
});
