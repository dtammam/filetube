'use strict';

// [UNIT] Transcript export: the `.icon-transcript` glyph (Material `chat`
// speech bubble). Locks the SAME three CSS sites the v1.47.6 share-glyph scar
// taught (size block, mask line, @supports fill - a mask without a fill is
// "a blank box" on device), the bundled asset, its README row, and the ONE
// renderer (watch.js's Transcript button) that emits it. Comments stripped
// first, symmetrically (the v1.50.3 lock lesson).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PUB = path.join(__dirname, '..', '..', 'public');
const stripCss = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const stripJs = (js) => js.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

test('icon-transcript: chat.svg is bundled (Material Symbols 960 viewBox, a single path) and documented', () => {
  const svg = fs.readFileSync(path.join(PUB, 'assets', 'icons', 'chat.svg'), 'utf8');
  assert.match(svg, /viewBox="0 -960 960 960"/, 'same coordinate system as every sibling glyph - 1em mask box sizing depends on it');
  assert.match(svg, /<path d="M240-400h320v-80H240v80Z/, 'the chat glyph (bubble + text lines), not a substitute');
  assert.match(fs.readFileSync(path.join(PUB, 'assets', 'icons', 'README.md'), 'utf8'), /`chat\.svg` \| `chat` \| `\.icon-transcript`/);
});

test('icon-transcript: style.css carries the mask, the 1em size-block membership AND the @supports currentColor fill', () => {
  const css = stripCss(fs.readFileSync(path.join(PUB, 'css', 'style.css'), 'utf8'));
  assert.match(css, /\.icon-transcript \{ -webkit-mask-image: url\(\/assets\/icons\/chat\.svg\); mask-image: url\(\/assets\/icons\/chat\.svg\); \}/);
  // Size block: a selector list containing .icon-share AND .icon-transcript
  // whose body sets width: 1em (the shared glyph box).
  const sizeBlock = /\.icon-share,\n\.icon-transcript,[\s\S]*?\{[^}]*width: 1em;[^}]*height: 1em;/;
  assert.match(css, sizeBlock, 'must join the shared 1em size block beside .icon-share');
  const supportsIdx = css.indexOf('@supports (mask-image: url("#"))');
  assert.ok(supportsIdx > 0);
  const supportsBlock = css.slice(supportsIdx, css.indexOf('background-color: currentColor', supportsIdx));
  assert.ok(supportsBlock.includes('.icon-transcript,'), 'must be in the @supports fill list (else a mask with no colour = blank box)');
  // Never in the emoji-set neutraliser (falls back to the mask there, like share).
  const emojiIdx = css.indexOf('[data-icons="emoji"] .icon-home,');
  const emojiBlock = css.slice(emojiIdx, css.indexOf('{', emojiIdx));
  assert.ok(!emojiBlock.includes('.icon-transcript'), 'share-precedent: the emoji set falls back to the mask');
});

test('icon-transcript: watch.js is the renderer - the Transcript button emits <i class="icon-transcript"> with a .btn-label', () => {
  const js = stripJs(fs.readFileSync(path.join(PUB, 'js', 'watch.js'), 'utf8'));
  assert.match(js, /icon\.className = 'icon-transcript';/);
  assert.match(js, /transcriptBtn\.id = 'transcript-media-btn';/);
  assert.match(js, /label\.textContent = 'Transcript';/);
});
