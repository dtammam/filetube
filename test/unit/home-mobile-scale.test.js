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

test('mobile: the Shuffle again / Rescan Files button WORDS are shown, not collapsed to icon-only (v1.23: Shuffle must not read as just an emoji)', () => {
  const body = mobileBlock();
  assert.doesNotMatch(
    body,
    /\.section-actions \.btn-label\s*\{[^}]*display:\s*none/,
    'section-actions button labels must NOT be hidden on mobile -- the row wraps (width:100% + flex-wrap) so the words fit'
  );
});

test('mobile: .section-actions buttons keep a comfortable minimum tap-target width', () => {
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

test('v1.19.0 FR-6 (mobile): #videos-section-header resets min-width and wraps long content -- a long Search Results for "<query>" heading must not force horizontal overflow (same flex min-width:auto family as the v1.17.0 .sort-select fix)', () => {
  const body = mobileBlock();
  const rule = /#videos-section-header\s*\{([^}]*)\}/.exec(body);
  assert.ok(rule, 'expected a mobile #videos-section-header rule');
  assert.match(rule[1], /min-width:\s*0/, 'the heading must be allowed to shrink below its intrinsic content width');
  assert.match(rule[1], /(overflow-wrap|word-break):\s*break-word/, 'a long unbroken query token must wrap, not force overflow');
});

test('desktop: #videos-section-header has exactly one rule in the whole stylesheet -- the mobile block above -- so desktop rendering is unaffected by the FR-6 fix', () => {
  const occurrences = (css.match(/#videos-section-header\s*\{/g) || []).length;
  assert.strictEqual(occurrences, 1, '#videos-section-header should be styled exactly once (inside the mobile breakpoint block), leaving desktop untouched');
});

// v1.21.0 FR-6, T4 -- the 768px auto-fill/minmax rule above SHOULD produce 2
// columns on a phone but reportedly didn't feel deterministic on-device;
// force it with a narrower, phone-only breakpoint that hard-sets exactly 2
// columns instead of relying on minmax()'s fluid auto-fill math.
test('mobile (<=480px): .video-grid forces exactly 2 columns via repeat(2, 1fr), guaranteed regardless of card min-width', () => {
  const phoneBlockRe = /@media \(max-width: 480px\) \{([\s\S]*?)\n\}\n/;
  const block = phoneBlockRe.exec(css);
  assert.ok(block, 'expected a @media (max-width: 480px) block');
  const rule = /\.video-grid\s*\{([^}]*)\}/.exec(block[1]);
  assert.ok(rule, 'expected a .video-grid rule inside the 480px block');
  assert.match(rule[1], /grid-template-columns:\s*repeat\(2,\s*1fr\)/, 'phones must get a deterministic 2-column grid');
});

test('mobile (<=480px): the .video-grid gap stays tight (< the 768px block\'s 12px) so 2 columns are comfortable, not cramped', () => {
  const phoneBlockRe = /@media \(max-width: 480px\) \{([\s\S]*?)\n\}\n/;
  const block = phoneBlockRe.exec(css);
  const rule = /\.video-grid\s*\{([^}]*)\}/.exec(block[1]);
  const gapMatch = /gap:\s*(\d+)px/.exec(rule[1]);
  assert.ok(gapMatch, 'expected an explicit gap in the 480px .video-grid rule');
  assert.ok(Number(gapMatch[1]) <= 12, 'the 480px gap should be no larger than the 768px block\'s 12px');
});

test('the existing 768px .video-grid rule (minmax(140px,1fr)/12px gap) stays byte-identical -- the 480px breakpoint is additive, not a replacement', () => {
  const body = mobileBlock();
  const rule = /\.video-grid\s*\{([^}]*)\}/.exec(body);
  assert.ok(rule, 'expected the pre-existing mobile .video-grid rule inside the 768px block');
  assert.match(rule[1], /grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(140px,\s*1fr\)\)/);
  assert.match(rule[1], /gap:\s*12px/);
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
