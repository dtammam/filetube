'use strict';

// [UNIT] v1.67 T1: the queue glyph promoted from an inline per-call-site
// <svg> to a real `icon-queue` alpha-mask (Dean approved: "good call"), so
// the card-corner renderer treats all six corner controls uniformly.
// Follows the heart/share/flame/history precedent EXACTLY: base
// (outlined-dir) mask only, every other icon set falls back to it
// automatically, and it is deliberately ABSENT from the emoji-set block
// (those four never joined it either - emoji queue codepoints render
// inconsistently on iOS, the v1.38 lesson).
//
// Source-text checks here strip comments first, SYMMETRICALLY (the v1.50.3
// lock lesson, re-struck in v1.66: a comment quoting the locked line must
// never satisfy - or defeat - a lock). The RENDERED bind (the real
// buildCardHtml emitting <i class="icon-queue"> into a real jsdom grid)
// lands with the T4 full-chain suite; this file locks the asset + CSS
// mechanics that rendering depends on.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PUB = path.join(__dirname, '..', '..', 'public');
const QUEUE_SVG_PATH = path.join(PUB, 'assets', 'icons', 'queue.svg');
const STYLE_CSS_PATH = path.join(PUB, 'css', 'style.css');
const MAIN_JS_PATH = path.join(PUB, 'js', 'main.js');

// The exact glyph shipped inline since v1.63 (three list lines + a play
// triangle - YouTube's queue vocabulary). Promotion preserves the drawing.
const QUEUE_GLYPH_D = 'M3 6h13v2H3V6zm0 4h13v2H3v-2zm0 4h9v2H3v-2zm14-1v6l5-3-5-3z';

function stripCssComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

// Block comments always; line comments only when the line STARTS with //
// (never mid-line, so protocol strings like "http://" survive).
function stripJsComments(js) {
  return js
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

const css = stripCssComments(fs.readFileSync(STYLE_CSS_PATH, 'utf8'));
const mainJs = stripJsComments(fs.readFileSync(MAIN_JS_PATH, 'utf8'));

test('queue.svg: base mask exists and draws the exact v1.63 glyph', () => {
  assert.ok(fs.existsSync(QUEUE_SVG_PATH), 'missing public/assets/icons/queue.svg');
  const svg = fs.readFileSync(QUEUE_SVG_PATH, 'utf8');
  assert.ok(svg.includes('<svg'), 'queue.svg is not an SVG');
  assert.ok(svg.includes(QUEUE_GLYPH_D), 'queue.svg must preserve the inline glyph path (visual identity)');
});

test('style.css: .icon-queue mask rule points at the base asset', () => {
  assert.match(
    css,
    /\.icon-queue\s*\{[^}]*-webkit-mask-image:\s*url\(\/assets\/icons\/queue\.svg\);[^}]*mask-image:\s*url\(\/assets\/icons\/queue\.svg\);/,
    'expected a .icon-queue rule masking /assets/icons/queue.svg (both -webkit- and standard)'
  );
});

test('style.css: .icon-queue joins the shared chrome-icon sizing group', () => {
  // The chrome group is the ONE block whose body carries mask-size: contain
  // and whose selector list already names .icon-heart (the base-only
  // precedent icon). .icon-queue must be a member - a mask rule without the
  // group renders an unsized, unpositioned smear.
  const blocks = css.match(/[^{}]+\{[^}]*\}/g) || [];
  const group = blocks.find(
    (b) => b.includes('mask-size') && b.includes('contain') && b.includes('.icon-heart')
  );
  assert.ok(group, 'could not locate the shared chrome-icon group (mask-size: contain + .icon-heart)');
  assert.ok(group.includes('.icon-queue'), '.icon-queue must join the shared chrome-icon sizing group');
});

test('style.css: .icon-queue joins the @supports currentColor-fill group', () => {
  const start = css.indexOf('@supports (mask-image');
  assert.ok(start !== -1, 'the @supports mask-image fill block must exist');
  const fillEnd = css.indexOf('currentColor', start);
  assert.ok(fillEnd !== -1, 'the @supports block must fill with currentColor');
  const supportsSelectors = css.slice(start, fillEnd);
  assert.ok(
    supportsSelectors.includes('.icon-queue'),
    '.icon-queue must join the @supports currentColor group (else the glyph paints transparent where masks are supported via the fallback path)'
  );
});

test('style.css: .icon-queue stays OUT of the emoji-set block (the heart/share/flame precedent)', () => {
  const emojiSelectorHits = css.match(/\[data-icons="emoji"\][^{]*\{/g) || [];
  for (const sel of emojiSelectorHits) {
    assert.ok(
      !sel.includes('.icon-queue'),
      `.icon-queue must not appear in any emoji-set selector, found in: ${sel.trim().slice(0, 120)}`
    );
  }
});

test('main.js: the card queue button renders the mask, and the inline glyph path is GONE from main.js', () => {
  assert.match(
    mainJs,
    /card-queue-btn[\s\S]{0,400}?<i class="icon-queue"><\/i>/,
    'the card queue button must emit <i class="icon-queue"></i>'
  );
  assert.ok(
    !mainJs.includes(QUEUE_GLYPH_D),
    'no inline copy of the queue glyph path may remain in main.js (the drift class; watch.html/common.js chrome copies are deliberately out of this lock\'s scope)'
  );
});

test('style.css: the card queue icon is sized like its corner siblings (14px)', () => {
  assert.match(
    css,
    /\.card-queue-btn\s+\.icon-queue\s*\{[^}]*width:\s*14px;[^}]*height:\s*14px;/,
    'expected .card-queue-btn .icon-queue sized 14px x 14px (the .card-*-btn sibling convention)'
  );
});
