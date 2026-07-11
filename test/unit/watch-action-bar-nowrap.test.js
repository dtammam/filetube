'use strict';

// [UNIT] v1.25.4 polish: the watch-page action-button row (Download/Delete/
// Move -- glyph + short label, shipped v1.25.0) wrapped on a narrow mobile
// viewport: Download+Delete stayed on row 1 but Move (the last button,
// appended by watch.js's setupMoveButton) dropped onto its own orphaned
// row 2. Fix: tighten `.watch-actions`'s gap and `.watch-actions .btn`'s
// padding/font-size inside the existing `@media (max-width: 768px)` block so
// all three buttons fit on one row, without reintroducing the vestigial
// `btn-sm` class or an inline style (both removed from this row in v1.25.0).
//
// v1.25.5 then forced the OUTER `.watch-actions` row itself to
// `flex-wrap: nowrap` at this breakpoint to guarantee the single row -- but
// `.watch-actions` has a SECOND child besides the button group: the
// read-only `.star-rating` (five non-shrinking 20px `★` glyphs + "N / 5").
// With the whole row forced nowrap, its min-content width (stars + all
// three buttons + gaps) could exceed a phone's viewport, which iOS Safari
// resolves by shrinking the ENTIRE page to fit (shrink-to-fit zoom) rather
// than by showing a scrollbar -- a live regression on both the audio and
// video watch pages.
//
// v1.25.6 hotfix: revert the outer `.watch-actions` row to `flex-wrap: wrap`
// (so it can wrap the star-rating and the button group onto separate lines,
// keeping its min-content within any viewport) and move the "never split"
// guarantee onto a new inner sub-group, `.watch-action-btns`, that wraps
// ONLY Download/Delete/Move and is itself always `flex-wrap: nowrap` --
// viewport-width independent, so it can't reintroduce the iOS zoom bug no
// matter how narrow the screen gets.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const CSS_PATH = path.join(__dirname, '..', '..', 'public', 'css', 'style.css');
const HTML_PATH = path.join(__dirname, '..', '..', 'public', 'watch.html');
const WATCH_JS_PATH = path.join(__dirname, '..', '..', 'public', 'js', 'watch.js');
const css = fs.readFileSync(CSS_PATH, 'utf8');
const html = fs.readFileSync(HTML_PATH, 'utf8');
const watchJs = fs.readFileSync(WATCH_JS_PATH, 'utf8');

// v1.30 C1 (AC7.1): style.css's font-size declarations are now token-driven
// (`var(--fs-*)`) rather than bare px literals -- resolve a declaration's
// value back to a px number via the :root token block so the size-comparison
// assertion below keeps working regardless of the token's source spelling.
function parseRootFsTokens(source) {
  const rootMatch = /:root\s*\{([\s\S]*?)\n\}/.exec(source);
  assert.ok(rootMatch, 'expected a :root block in style.css');
  const tokens = {};
  const re = /(--fs-[a-z0-9-]+):\s*([0-9]+)px/g;
  let m;
  while ((m = re.exec(rootMatch[1]))) {
    tokens[m[1]] = Number(m[2]);
  }
  return tokens;
}

const fsTokens = parseRootFsTokens(css);

function resolveFontSizePx(value) {
  const trimmed = value.trim();
  const varMatch = /^var\((--fs-[a-z0-9-]+)\)$/.exec(trimmed);
  if (varMatch) {
    const px = fsTokens[varMatch[1]];
    assert.ok(px !== undefined, `expected token ${varMatch[1]} to be defined in :root`);
    return px;
  }
  const pxMatch = /^([0-9]+)px$/.exec(trimmed);
  assert.ok(pxMatch, `expected a px literal or var(--fs-*) token, got "${value}"`);
  return Number(pxMatch[1]);
}

// Locate the SAME `@media (max-width: 768px)` block that already holds the
// `.watch-action-bar { flex-direction: column; ... }` mobile rule -- the fix
// is scoped inside it (this file has several independent 768px blocks for
// different features, so isolate by content, not just the media query).
function findMobileBlockContaining(marker) {
  const mediaRe = /@media \(max-width: 768px\)\s*\{/g;
  let m;
  while ((m = mediaRe.exec(css))) {
    const start = m.index + m[0].length;
    // Find this block's matching close brace by depth-counting.
    let depth = 1;
    let i = start;
    while (depth > 0 && i < css.length) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      i++;
    }
    const body = css.slice(start, i - 1);
    if (body.includes(marker)) return body;
  }
  return null;
}

const mobileBlock = findMobileBlockContaining('.watch-action-bar {');

test('style.css: the watch-action-bar mobile block exists (sanity check for the block-isolation helper)', () => {
  assert.ok(mobileBlock, 'expected to find the @media (max-width: 768px) block containing .watch-action-bar');
});

test('style.css: .watch-actions gets a tightened gap on mobile (scoped to the watch-action-bar mobile block)', () => {
  const rule = /\.watch-actions\s*\{([^}]*)\}/.exec(mobileBlock);
  assert.ok(rule, 'expected a mobile-scoped .watch-actions rule');
  assert.match(rule[1], /gap:\s*\d+px;/);
});

test('style.css: .watch-actions .btn is tightened (padding + font-size) on mobile so Download/Delete/Move fit on one row', () => {
  const rule = /\.watch-actions \.btn\s*\{([^}]*)\}/.exec(mobileBlock);
  assert.ok(rule, 'expected a mobile-scoped .watch-actions .btn rule');
  assert.match(rule[1], /padding:\s*[\d.]+px\s+[\d.]+px;/);
  const fontMatch = /font-size:\s*([^;]+);/.exec(rule[1]);
  assert.ok(fontMatch, 'expected a font-size declaration');
  const px = resolveFontSizePx(fontMatch[1]);
  assert.ok(px < 12, `expected the mobile .watch-actions .btn font-size to be smaller than the desktop 12px .btn default (got ${px}px)`);
});

test('style.css: the mobile .watch-actions .btn tightening is scoped ONLY to the watch-actions row, not the global .btn class', () => {
  // A bare, unscoped `.btn { ... font-size: 11px ... }` inside the SAME
  // mobile block would regress every other button on the page (header,
  // setup, sidebar). The fix must always be qualified by `.watch-actions`.
  assert.ok(!/(?:^|\n)\s*\.btn\s*\{[^}]*padding:\s*6px 10px;/.test(mobileBlock), 'the tightened padding must not leak onto the bare .btn class');
});

test('watch.html/watch.js: no btn-sm class or inline style is reintroduced for the Download/Delete/Move buttons (v1.25.0 removed both)', () => {
  assert.doesNotMatch(html, /id="download-media-btn"[^>]*style=/, 'the Download button must not carry an inline style');
  assert.doesNotMatch(html, /btn-sm/, 'watch.html must not reference btn-sm anywhere');
  assert.doesNotMatch(watchJs, /moveBtn\.className\s*=\s*'btn btn-sm'/, 'the Move button must not reintroduce btn-sm');
});

test('watch.html/watch.js: Download, Delete, and the dynamically-created Move button all still use the plain .btn class (one consistent family)', () => {
  assert.match(html, /class="btn"[^>]*id="download-media-btn"/);
  assert.match(html, /class="btn"[^>]*id="delete-media-btn"/);
  assert.match(watchJs, /moveBtn\.className\s*=\s*'btn';/);
});

test('watch.html: the three action buttons keep their aria-labels unchanged', () => {
  assert.match(html, /id="download-media-btn"[^>]*aria-label="Download video"/);
  assert.match(html, /id="delete-media-btn"[^>]*aria-label="Delete video"/);
  assert.match(watchJs, /moveBtn\.setAttribute\('aria-label',\s*'Move to another folder'\);/);
});

test('style.css: the base (desktop) .watch-actions rule keeps flex-wrap: wrap unchanged', () => {
  const rule = /\.watch-actions\s*\{([^}]*)\}/.exec(css);
  assert.ok(rule, 'expected the base .watch-actions rule');
  assert.match(rule[1], /flex-wrap:\s*wrap;/);
});

// v1.25.6 hotfix: the v1.25.5 mobile `.watch-actions { flex-wrap: nowrap }`
// ignored the `.star-rating` sibling and could push the row's min-content
// past a phone's viewport width, triggering iOS Safari's shrink-to-fit zoom
// on the whole page. The outer row must be able to WRAP again -- this test
// would FAIL against the v1.25.5 `nowrap` rule.
test('style.css: the mobile .watch-actions rule (inside the watch-action-bar 768px block) is NOT flex-wrap: nowrap -- the outer row must stay able to wrap so it can never force horizontal/shrink-to-fit overflow', () => {
  const rule = /\.watch-actions\s*\{([^}]*)\}/.exec(mobileBlock);
  assert.ok(rule, 'expected a mobile-scoped .watch-actions rule');
  assert.doesNotMatch(rule[1], /flex-wrap:\s*nowrap;/, 'the outer .watch-actions row must not be forced nowrap at this breakpoint -- that ignores the .star-rating sibling and can overflow the viewport');
});

test('style.css: a .watch-action-btns nowrap flex sub-group exists (base rule, viewport-independent) so Download/Delete/Move never split across rows', () => {
  const rule = /\.watch-action-btns\s*\{([^}]*)\}/.exec(css);
  assert.ok(rule, 'expected a .watch-action-btns rule in style.css');
  assert.match(rule[1], /display:\s*flex;/);
  assert.match(rule[1], /flex-wrap:\s*nowrap;/, 'the button sub-group itself must stay nowrap so the three buttons are never split across two rows');
});

test('watch.html: Download and Delete buttons are wrapped in a .watch-action-btns sub-group inside .watch-actions', () => {
  const wrapperMatch = /<div class="watch-action-btns">([\s\S]*?)<\/div>\s*<\/div>/.exec(html);
  assert.ok(wrapperMatch, 'expected a <div class="watch-action-btns"> wrapper in watch.html');
  assert.match(wrapperMatch[1], /id="download-media-btn"/, 'expected the Download button inside .watch-action-btns');
  assert.match(wrapperMatch[1], /id="delete-media-btn"/, 'expected the Delete button inside .watch-action-btns');
});

test('watch.js: setupMoveButton appends the Move button into .watch-action-btns (falling back to .watch-actions if the sub-group is absent)', () => {
  assert.match(watchJs, /watchActions\.querySelector\('\.watch-action-btns'\)/, 'expected setupMoveButton to look up the .watch-action-btns sub-group');
  assert.match(watchJs, /\(btnGroup \|\| watchActions\)\.appendChild\(moveBtn\)/, 'expected Move to be appended into the sub-group, falling back to .watch-actions');
});

// Doc-style assertion (encodes the omitted-sibling root cause of the
// v1.25.5 regression, so a future "just re-nowrap .watch-actions" change is
// caught by the two tests above): `.star-rating` must remain a SIBLING of
// the button sub-group inside `.watch-actions`, not a descendant of it --
// that's what lets the outer row wrap the two of them independently.
test('watch.html: .star-rating is a sibling of .watch-action-btns inside .watch-actions, not nested inside it', () => {
  const watchActionsIdx = html.indexOf('class="watch-actions"');
  assert.ok(watchActionsIdx !== -1, 'expected a .watch-actions element in watch.html');
  const starIdx = html.indexOf('id="star-rating-control"', watchActionsIdx);
  const btnGroupIdx = html.indexOf('class="watch-action-btns"', watchActionsIdx);
  assert.ok(starIdx !== -1 && btnGroupIdx !== -1, 'expected both .star-rating and .watch-action-btns inside .watch-actions');
  assert.ok(starIdx < btnGroupIdx, '.star-rating must appear (as a sibling) before .watch-action-btns inside .watch-actions');

  const btnGroupOpenTag = html.indexOf('<div class="watch-action-btns">', watchActionsIdx);
  assert.ok(btnGroupOpenTag !== -1 && btnGroupOpenTag > starIdx, '.watch-action-btns must open after .star-rating, confirming sibling order, not nesting');
});
