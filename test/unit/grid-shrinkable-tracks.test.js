'use strict';
// v1.341.3 (Dean: the Modern theme's phone folders rendered wider than the screen, Modern only).
// A bare `1fr` track is minmax(auto, 1fr): it cannot shrink below its card's longest unbreakable
// word, so one long title / channel name widened the grid past the screen. Modern hit it first:
// its channel avatar leaves each card ~36px less room. Measured headless at 430px (a long word
// injected into one card): the page went 556px wide (classic) and 628px (Modern); with
// minmax(0, 1fr) tracks and overflow-wrap:anywhere on the card text, 430px in both.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const CSS = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

test('no video-grid track is a bare 1fr (every fr track can shrink to 0)', () => {
  const rules = [...CSS.matchAll(/([^{}]*(?:\.video-grid|#video-grid)[^{}]*)\{([^}]*)\}/g)];
  const bad = [];
  for (const [, sel, body] of rules) {
    const m = body.match(/grid-template-columns:\s*([^;]+);/);
    if (!m) continue;
    const cols = m[1].replace(/minmax\([^)]*\)/g, '');
    if (/(^|[\s(,])\d*\.?\d*fr\b/.test(cols)) bad.push(sel.trim() + ' -> ' + m[1].trim());
  }
  assert.deepStrictEqual(bad, [], 'bare fr tracks let one long word widen the page');
});

test('the card text wraps a word longer than the card', () => {
  const m = CSS.match(/\.card-text\s*\{([^}]*)\}/);
  assert.ok(m);
  assert.match(m[1], /min-width:\s*0/);
  assert.match(m[1], /overflow-wrap:\s*anywhere/);
});
