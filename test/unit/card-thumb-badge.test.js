'use strict';

// [UNIT] UI pass sweep S2 (F04, F53, D8.5) - the card thumbnail's ONE duration
// badge. Converted from test/unit/card-corner-br-css.test.js (AC12): the v1.204
// bottom-right corner slot, the badge's beside-corner offset and its armed-delete
// hide existed only because a corner control could share the badge's corner.
// There are no corner controls left (card-action-menu.test.js proves no button
// sits on the media), so the badge never moves; what the old locks guarded - the
// time stays visible while the hover clip plays, and the pill is one legible
// size - now binds the ui-thumb primitive and its paint order:
//   1. the badge is ui.css's .ui-thumb__duration at ONE size (--t-caption, never
//      larger than a card title - F04: it was 18px on phones next to a 12px
//      title), tabular numbers, pinned bottom-right;
//   2. the hover preview (.card-preview) has NO z-index, so the badge and the
//      progress bar - which follow it in DOM order (bound by the DOM test in
//      card-action-menu.test.js) - paint above it (v1.205.1's device report);
//   3. the thumb has no frame (F53): no border on the ui-thumb or the card media.

const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert');
const { cssRules } = require('../helpers/stylesheets');

const ROOT = path.join(__dirname, '..', '..', 'public', 'css');
const UI = cssRules(fs.readFileSync(path.join(ROOT, 'ui.css'), 'utf8'));
const STYLE = cssRules(fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8'));
const TOKENS = fs.readFileSync(path.join(ROOT, 'tokens.css'), 'utf8');
const rule = (rules, sel) => rules.filter((r) => r.sel.split(',').map((x) => x.trim()).includes(sel));
const px = (name) => { const m = new RegExp(`${name}:\\s*(\\d+)px`).exec(TOKENS); assert.ok(m, name); return Number(m[1]); };

test('F04: ONE badge size - .ui-thumb__duration is --t-caption, tabular, bottom-right, and no smaller-font twin exists', () => {
  const r = rule(UI, '.ui-thumb__duration');
  assert.strictEqual(r.length, 1, 'exactly one rule sizes the badge');
  assert.strictEqual(r[0].at, '', 'at every width (no phone or list-view size override)');
  assert.match(r[0].body, /font:\s*var\(--t-caption\)/);
  assert.match(r[0].body, /font-variant-numeric:\s*tabular-nums/);
  assert.match(r[0].body, /right:\s*var\(--space-3\)/);
  assert.match(r[0].body, /bottom:\s*var\(--space-3\)/);
  for (const rules of [UI, STYLE]) {
    for (const x of rules) {
      if (/ui-thumb__duration/.test(x.sel) && x !== r[0]) assert.doesNotMatch(x.body, /font/, `no other rule re-sizes the badge: ${x.sel}`);
    }
  }
});

test('F04: the badge is never larger than a card title (caption <= the phone title size)', () => {
  const caption = px('--t-caption-size');
  const phoneTitle = px('--fs-base'); // .video-title on a phone (the style.css 768px block)
  assert.ok(caption <= phoneTitle, `badge ${caption}px <= phone title ${phoneTitle}px`);
  const phone = STYLE.find((x) => x.sel === '.video-title' && /max-width:\s*768px/.test(x.at));
  assert.match(phone.body, /font-size:\s*var\(--fs-base\)/, 'the phone title size the comparison reads (F18: 13px, was 12)');
});

test('v1.205.1 (converted): the hover preview has no z-index, so the later-painted badge + bar stay above the playing clip', () => {
  const r = rule(STYLE, '.card-preview');
  assert.ok(r.length >= 1);
  for (const x of r) assert.doesNotMatch(x.body, /z-index/, 'a z-index here would lift the clip over the badge again');
  for (const sel of ['.ui-thumb__duration', '.ui-thumb__progress']) {
    for (const x of rule(UI, sel)) assert.match(x.body, /position:\s*absolute/, `${sel} is positioned (paints over the unpositioned image, in DOM order after the preview)`);
  }
});

test('F53: no frame - neither the ui-thumb nor the card media draws a border; the placeholder is --thumb-ground', () => {
  const thumb = rule(UI, '.ui-thumb')[0];
  assert.doesNotMatch(thumb.body, /border(?!-radius)/, 'no border on the primitive');
  assert.match(thumb.body, /background:\s*var\(--thumb-ground\)/);
  assert.match(thumb.body, /border-radius:\s*var\(--thumb-radius\)/, 'the era knob owns the radius (square in the retro eras)');
  for (const x of rule(STYLE, '.card-media')) assert.doesNotMatch(x.body, /border(?!-radius)/, '.card-media');
});
