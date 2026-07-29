'use strict';

// [UNIT] v1.15.1 hotfix (FIX-B): the "Shuffle again" and "Rescan Files"
// buttons on the home page previously both used .icon-refresh -- visually
// indistinguishable on mobile, where .btn-label collapses and only the icon
// remains. Shuffle now gets its own distinct .icon-shuffle glyph; Rescan
// keeps .icon-refresh.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const CSS_PATH = path.join(__dirname, '..', '..', 'public', 'css', 'style.css');
const HTML_PATH = path.join(__dirname, '..', '..', 'public', 'index.html');
const MAIN_JS_PATH = path.join(__dirname, '..', '..', 'public', 'js', 'main.js');
const css = fs.readFileSync(CSS_PATH, 'utf8');
const html = fs.readFileSync(HTML_PATH, 'utf8');
const mainJs = fs.readFileSync(MAIN_JS_PATH, 'utf8');

test('index.html: the shuffle-again button uses a distinct .icon-shuffle icon, not .icon-refresh', () => {
  const shuffleButtonMatch = /<button[^>]*id="shuffle-again-btn"[^>]*>[\s\S]*?<\/button>/.exec(html);
  assert.ok(shuffleButtonMatch, 'expected to find the shuffle-again-btn markup');
  assert.match(shuffleButtonMatch[0], /<i class="icon-shuffle"><\/i>/);
  assert.doesNotMatch(shuffleButtonMatch[0], /icon-refresh/);
});

test('index.html: the shuffle-again button keeps its accessible name/title unchanged', () => {
  assert.match(html, /id="shuffle-again-btn"[^>]*title="Shuffle again"/);
  assert.match(html, /id="shuffle-again-btn"[^>]*aria-label="Shuffle again"/);
});

test('index.html: the rescan-library button still uses .icon-refresh', () => {
  const rescanButtonMatch = /<button[^>]*id="rescan-library-btn"[^>]*>[\s\S]*?<\/button>/.exec(html);
  assert.ok(rescanButtonMatch, 'expected to find the rescan-library-btn markup');
  assert.match(rescanButtonMatch[0], /<i class="icon-refresh"><\/i>/);
});

test('main.js: rescanBtn re-renders keep .icon-refresh (never re-render the shuffle button\'s icon at all)', () => {
  assert.doesNotMatch(mainJs, /shuffleAgainBtn\.innerHTML/, 'the shuffle button markup is static; main.js must not overwrite its icon');
  const rescanInnerHtmlMatches = mainJs.match(/rescanBtn\.innerHTML\s*=\s*'[^']*'/g) || [];
  assert.ok(rescanInnerHtmlMatches.length > 0, 'expected at least one rescanBtn.innerHTML assignment');
  for (const assignment of rescanInnerHtmlMatches) {
    assert.match(assignment, /icon-refresh/, `rescanBtn re-render should keep icon-refresh: ${assignment}`);
  }
});

// v1.25.4 fix: .icon-shuffle previously rendered as a fixed ::before unicode
// glyph (U+1F500 🔀) OUTSIDE the icon-set system -- unlike every other
// .icon-* glyph (a real SVG mask painted in currentColor), which meant
// Shuffle showed a raw colored emoji even in non-emoji/modern icon-set
// themes (Rescan's .icon-refresh, right next to it, rendered correctly).
// .icon-shuffle now joins the same mask-image/currentColor mechanism as
// .icon-download (see style.css's chrome-icon block + icon-set-axis
// section), so it themes across every era x mode x icon-set combo. The
// emoji icon-set is UNCHANGED -- it still renders U+1F500 there on purpose.
test('style.css: .icon-shuffle is a real SVG mask (currentColor), not a fixed unicode ::before glyph', () => {
  assert.match(css, /\.icon-shuffle\s*\{[^}]*mask-image:\s*url\(\/assets\/icons\/shuffle\.svg\)/);
  // The OLD unscoped ::before rule must be gone -- that was the actual bug
  // (it fired in every icon-set, including non-emoji ones).
  assert.doesNotMatch(css, /^\.icon-shuffle::before/m);
});

test('style.css: .icon-shuffle is included in the base chrome-icon group (sizing) and the @supports currentColor fill guard', () => {
  // v1.49: asserts MEMBERSHIP of both groups rather than pinning
  // `.icon-shuffle` as their LAST member. The original regexes required the
  // selector list to END `..., .icon-download, .icon-shuffle {`, so adding any
  // new icon after it failed this test on a correct change -- the same
  // over-specification card-like.test.js already diagnosed and fixed for the
  // fill guard in v1.47.6 (see its own comment). What actually matters is that
  // `.icon-shuffle` is IN each list; an icon missing from one renders at the
  // wrong box size or as nothing at all, and that is what these now check.
  const sizingStart = css.indexOf('.icon-home,');
  assert.notEqual(sizingStart, -1, 'expected the shared chrome-icon sizing group');
  const sizingGroup = css.slice(sizingStart, css.indexOf('mask-repeat:', sizingStart));
  assert.ok(sizingGroup.includes('.icon-shuffle'), 'expected .icon-shuffle in the shared chrome-icon sizing/mask-repeat group');

  const supportsIdx = css.indexOf('@supports (mask-image: url("#"))');
  assert.notEqual(supportsIdx, -1, 'expected the @supports fill guard');
  const fillGuard = css.slice(supportsIdx, css.indexOf('background-color: currentColor', supportsIdx));
  assert.ok(fillGuard.includes('.icon-shuffle'), 'expected .icon-shuffle in the @supports currentColor fill guard');
});

test('style.css: .icon-shuffle gets a themed mask in the rounded and filled icon sets too', () => {
  assert.match(css, /\[data-icons="rounded"\]\s*\.icon-shuffle\s*\{[^}]*mask-image:\s*url\(\/assets\/icons\/rounded\/shuffle\.svg\)/);
  assert.match(css, /\[data-icons="filled"\]\s*\.icon-shuffle\s*\{[^}]*mask-image:\s*url\(\/assets\/icons\/filled\/shuffle\.svg\)/);
});

test('style.css: the emoji icon-set is unchanged -- .icon-shuffle still renders U+1F500 ONLY under [data-icons="emoji"]', () => {
  assert.match(css, /\[data-icons="emoji"\]\s*\.icon-shuffle::before\s*\{\s*content:\s*"\\1F500";?\s*\}/);
  // And the emoji-set group neutralizes the mask (same treatment as every
  // other icon-set glyph), so no solid currentColor box renders behind it.
  const emojiNeutralizeMatch = /\[data-icons="emoji"\][\s\S]*?\.icon-shuffle\s*\{\s*-webkit-mask-image:\s*none;/.exec(css);
  assert.ok(emojiNeutralizeMatch, 'expected .icon-shuffle in the emoji-set mask-neutralize group');
});

test('assets: shuffle.svg is bundled for all three vector icon sets (outlined/rounded/filled)', () => {
  const outlined = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'assets', 'icons', 'shuffle.svg'), 'utf8');
  const rounded = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'assets', 'icons', 'rounded', 'shuffle.svg'), 'utf8');
  const filled = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'assets', 'icons', 'filled', 'shuffle.svg'), 'utf8');
  for (const svg of [outlined, rounded, filled]) {
    assert.ok(svg.includes('<svg'), 'expected a valid <svg> document');
  }
});
