'use strict';

// [UNIT] v1.15.0 item 2 -- mobile UI scale polish for the home page.
// (a) the sort-controls row ([heading] + [sort <select>] + ["Shuffle again"])
// used to overflow a ~375-414px phone viewport, clipping the trailing button.
// (b) the video-card grid read large/zoomed on a phone. Visual correctness is
// Dean's on-device call; these are the mechanical CSS/markup-presence guards.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const CSS_PATH = path.join(__dirname, '..', '..', 'public', 'css', 'style.css');
const HTML_PATH = path.join(__dirname, '..', '..', 'public', 'index.html');
const css = fs.readFileSync(CSS_PATH, 'utf8');
const html = fs.readFileSync(HTML_PATH, 'utf8');

// The main mobile breakpoint block runs from `@media (max-width: 768px) {`
// up to the landscape-orientation query that immediately follows it (same
// anchor used by test/unit/settings-mobile-polish.test.js).
const mobileBlockRe = /@media \(max-width: 768px\) \{([\s\S]*?)\n\}\n\n\/\* In landscape/;

function mobileBlock() {
  const block = mobileBlockRe.exec(css);
  assert.ok(block, 'expected the main mobile (max-width:768px) media query block');
  return block[1];
}

test('index.html: the sort-row heading, sort-select, and Shuffle/Rescan buttons share .section-title/.section-actions', () => {
  assert.match(html, /<span id="videos-section-header">Recently Added<\/span>/);
  assert.match(html, /<div class="section-actions">/);
  assert.match(html, /id="sort-select"/);
  assert.match(html, /id="shuffle-again-btn"/);
  assert.match(html, /id="rescan-library-btn"/);
});

test('index.html: the Shuffle again / Rescan Files button labels are wrapped in .btn-label (so mobile CSS can hide just the text)', () => {
  assert.match(html, /id="shuffle-again-btn"[^>]*>[\s\S]*?<span class="btn-label">Shuffle again<\/span>/);
  assert.match(html, /id="rescan-library-btn"[^>]*>[\s\S]*?<span class="btn-label">Rescan Files<\/span>/);
});

test('index.html: the Shuffle again / Rescan Files buttons carry an accessible name independent of the visible label', () => {
  assert.match(html, /id="shuffle-again-btn"[^>]*aria-label="Shuffle again"/);
  assert.match(html, /id="rescan-library-btn"[^>]*aria-label="Rescan Files"/);
});

test('mobile: .section-title wraps so the heading and the actions row are never forced onto one clipped line', () => {
  const body = mobileBlock();
  assert.match(body, /\.section-title\s*\{[^}]*flex-wrap:\s*wrap/);
});

test('mobile: .section-actions wraps and takes the full row width beneath the heading', () => {
  const body = mobileBlock();
  assert.match(body, /\.section-actions\s*\{[^}]*flex-wrap:\s*wrap[^}]*width:\s*100%/);
});

test('mobile: the Shuffle again / Rescan Files button labels collapse to icon-only (.btn-label hidden) so the row always fits', () => {
  const body = mobileBlock();
  assert.match(body, /\.section-actions \.btn-label\s*\{[^}]*display:\s*none/);
});

test('mobile: icon-only .section-actions buttons keep a comfortable minimum tap-target width', () => {
  const body = mobileBlock();
  const rule = /\.section-actions \.btn\s*\{([^}]*)\}/.exec(body);
  assert.ok(rule, 'expected a mobile .section-actions .btn rule');
  const minWidthMatch = /min-width:\s*(\d+)px/.exec(rule[1]);
  assert.ok(minWidthMatch, 'expected a min-width on the icon-only mobile buttons');
  assert.ok(Number(minWidthMatch[1]) >= 32, 'tap target should be at least 32px');
});

test('mobile: .video-grid uses a tighter column minimum + gap than the desktop 210px/20px so more than one card is comfortably visible', () => {
  const body = mobileBlock();
  const rule = /\.video-grid\s*\{([^}]*)\}/.exec(body);
  assert.ok(rule, 'expected a mobile .video-grid rule');
  const minWidthMatch = /minmax\((\d+)px/.exec(rule[1]);
  assert.ok(minWidthMatch, 'expected a minmax(...) column definition');
  assert.ok(Number(minWidthMatch[1]) < 210, 'mobile column minimum must be tighter than the desktop 210px');
  const gapMatch = /gap:\s*(\d+)px/.exec(rule[1]);
  assert.ok(gapMatch, 'expected an explicit gap');
  assert.ok(Number(gapMatch[1]) < 20, 'mobile gap must be tighter than the desktop 20px');
});

test('mobile: video-card text (.video-title/.video-uploader/.video-meta) shrinks alongside the tighter grid', () => {
  const body = mobileBlock();
  assert.match(body, /\.video-title\s*\{[^}]*font-size:\s*\d+px/);
  const titleRule = /\.video-title\s*\{([^}]*)\}/.exec(body);
  assert.ok(Number(/font-size:\s*(\d+)px/.exec(titleRule[1])[1]) < 13, 'mobile .video-title should be smaller than the desktop 13px');

  const uploaderRule = /\.video-uploader\s*\{([^}]*)\}/.exec(body);
  assert.ok(uploaderRule, 'expected a mobile .video-uploader rule');

  const metaRule = /\.video-meta\s*\{([^}]*)\}/.exec(body);
  assert.ok(metaRule, 'expected a mobile .video-meta rule');
});

test('desktop: the base .video-grid/.section-actions rules are untouched (210px/20px, no flex-wrap)', () => {
  const gridRule = /(?:^|\n)\.video-grid\s*\{([^}]*)\}/.exec(css);
  assert.ok(gridRule, 'expected the base .video-grid rule');
  assert.match(gridRule[1], /minmax\(210px,\s*1fr\)/);
  assert.match(gridRule[1], /gap:\s*20px/);

  const actionsRule = /(?:^|\n)\.section-actions\s*\{([^}]*)\}/.exec(css);
  assert.ok(actionsRule, 'expected the base .section-actions rule');
  assert.ok(!/flex-wrap/.test(actionsRule[1]), 'the base .section-actions rule should not itself declare flex-wrap');
});
