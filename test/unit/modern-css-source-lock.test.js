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

// UI pass sweep S2 (F19, AC12): the Modern chips are the ui-chip filter primitive
// in the shared .library-chips row - the pill and the selected state are ui.css's.
test('the filter chips are ui-chip filter pills; the selected chip is ink on the tonal fill, never red', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'main.js'), 'utf8');
  assert.match(main, /<button type="button" class="ui-chip ui-chip--filter" aria-pressed="\$\{on\}" data-chip="\$\{c\.filter\}">/);
  assert.match(main, /<div class="modern-chip-row library-chips" role="group"/);
  const ui = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'ui.css'), 'utf8');
  assert.match(ui, /\.ui-chip--filter \{[^}]*border-radius:\s*var\(--r-pill\)/, 'chips are pills');
  // UI pass S7: the tonal fill is LAYERED over the chip ground (ui-chip-selected.test.js measures that it shows)
  assert.match(ui, /\.ui-chip--filter\[aria-pressed="true"\] \{[^}]*background-image:\s*linear-gradient\(var\(--fill-selected\), var\(--fill-selected\)\)/, 'the selected chip');
});

test('the mobile avatar bar is hidden on desktop', () => {
  assert.match(css, /\.modern-avatar-bar \{/, 'the avatar bar exists');
  assert.match(css, /@media \(min-width:\s*1024px\)\s*\{\s*\.modern-avatar-bar \{\s*display:\s*none/,
    'desktop hides the avatar bar (YouTube desktop uses the sidebar for subs)');
});

// UI pass sweep S2 (F53, D4.4; AC12): thumbnail rounding is the ui-thumb's era
// knob (--thumb-radius: --r-md in Modern, 0 in the square retro eras) and the
// byline avatar is ui.avatar (a monogram on a hash tone - never an inline colour).
test('rounded thumbnails come from the ui-thumb era knob, not a data-modern override', () => {
  const ui = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'ui.css'), 'utf8');
  assert.match(ui, /\.ui-thumb \{[^}]*border-radius:\s*var\(--thumb-radius\)/, 'the thumb radius is the era knob');
  const tokens = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'tokens.css'), 'utf8');
  assert.match(tokens, /:root \{[\s\S]*?--thumb-radius:\s*var\(--r-md\)/, 'Modern rounds');
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ''), /html\[data-modern="on"\][^{]*\.card-media|\.thumbnail-container/, 'no bespoke rounding rule');
});

test('the byline avatar is ui.avatar - a monogram tone from the palette, never an inline --ch-av colour', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'main.js'), 'utf8');
  assert.match(main, /ui\.avatar\(\{ name: opts\.channelName, url: opts\.avatar\.url \|\| null, kind: 'channel', size: 'sm', doc \}\)/);
  assert.doesNotMatch(main, /--ch-av|card-channel-avatar/, 'the inline colour and the bespoke disc are gone');
  assert.doesNotMatch(css, /\.card-channel-avatar/, 'no bespoke avatar CSS');
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

test('(v1.86.0 gate WARNING) the header sort ▾ is ROUTE-GATED: display:none by default, shown only on body[data-view="home"]', () => {
  // The control lives in the PERSISTENT header; the SPA router caches the home
  // view on nav-away WITHOUT aborting, so a JS abort-only removal orphans it.
  // Route-CSS is the fix: hidden by default, shown only on the home route.
  assert.match(css, /\.modern-sort \{[^}]*display:\s*none/,
    'the sort ▾ wrapper must be display:none by default (route-gated), not unconditionally shown');
  assert.match(css, /body\[data-view="home"\] \.modern-sort \{\s*display:\s*inline-flex/,
    'only the home route shows the ▾ (re-shows on cache-restore, hides on every other view)');
});

// v1.86.3 (Dean): the sort glyph is the uniform header-glyph box. Sweep S9: it is a header
// ui-btn (chromeButtonEl: plain, md, icon - the 22px --icon-md glyph every header button
// draws), so no bespoke rule sizes or paints it; the header geometry check (HDR) measures
// the header's buttons level and equal.
test('(v1.86.3 Dean, sweep S9) the sort glyph needs no bespoke size or paint rule - it is a header ui-btn', () => {
  assert.doesNotMatch(css, /\.modern-sort-btn\s*\{/, 'no bespoke .modern-sort-btn rule');
  assert.doesNotMatch(css, /\.modern-sort-caret|\.sort-menu\b/, 'the caret and the hand-built menu are gone');
});
