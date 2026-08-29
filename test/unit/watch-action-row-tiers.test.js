'use strict';

// [UNIT] v1.202 (Dean's action-row re-evaluation): the two-tier action row.
// PRIMARY (Like, Share, Transcript, Queue) stays in the row in compact mode;
// SECONDARY hides under "More". The tier list lives ONCE in watch.js
// (SECONDARY_ACTION_IDS) and style.css mirrors it as a selector - this lock
// keeps the two identical, and binds: the fixed `order` (primary first,
// More, then secondary), More hidden by default and shown only in the
// compact container query, the 639px glyph threshold, the container still
// being the bar, and the phone rule. Comments stripped at read.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PUB = path.join(__dirname, '..', '..', 'public');
const css = fs.readFileSync(path.join(PUB, 'css', 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const js = fs.readFileSync(path.join(PUB, 'js', 'watch.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
const html = fs.readFileSync(path.join(PUB, 'watch.html'), 'utf8');

const PRIMARY = ['like-media-btn', 'share-media-btn', 'transcript-media-btn', 'queue-add-btn'];

function jsSecondaryIds() {
  const m = /const SECONDARY_ACTION_IDS = \[([^\]]*)\];/.exec(js);
  assert.ok(m, 'watch.js declares SECONDARY_ACTION_IDS');
  return Array.from(m[1].matchAll(/'([a-z-]+)'/g)).map((x) => x[1]);
}

test('tiers: the CSS compact selector lists EXACTLY watch.js\'s SECONDARY_ACTION_IDS, and none of them is primary', () => {
  const ids = jsSecondaryIds();
  assert.deepEqual(ids, ['queue-next-btn', 'download-media-btn', 'delete-media-btn', 'move-media-btn', 'watched-media-btn', 'reheat-media-btn', 'attribute-media-btn']);
  for (const id of ids) assert.ok(!PRIMARY.includes(id), `${id} is not primary`);
  const compact = /@container watch-action-bar \(max-width: 959px\)\s*\{([\s\S]*?)\n\}/.exec(css);
  assert.ok(compact, 'the compact container query (column under 960px)');
  const hideRule = /((?:#[a-z-]+,?\s*)+)\{\s*display:\s*none;\s*\}/.exec(compact[1]);
  assert.ok(hideRule, 'a display:none rule over id selectors');
  const cssIds = Array.from(hideRule[1].matchAll(/#([a-z-]+)/g)).map((x) => x[1]);
  assert.deepEqual(cssIds, ids, 'CSS hides exactly the JS secondary list, same order');
  assert.match(compact[1], /#more-actions-btn\s*\{\s*display:\s*inline-flex;\s*\}/, 'More shows in compact mode');
  assert.ok(!/\.btn-label/.test(compact[1]), 'compact mode keeps the words (the glyph threshold is separate)');
});

test('tiers: fixed order - primary 1-4, More 5, secondary 10+; More is display:none outside compact mode', () => {
  const order = (id) => { const m = new RegExp('#' + id + '\\s*\\{[^}]*order:\\s*(\\d+);').exec(css); assert.ok(m, `order for ${id}`); return Number(m[1]); };
  assert.deepEqual(PRIMARY.map(order), [1, 2, 3, 4]);
  assert.equal(order('more-actions-btn'), 5);
  for (const id of jsSecondaryIds()) assert.ok(order(id) >= 10, `${id} sorts after More`);
  assert.match(css, /#more-actions-btn\s*\{\s*order:\s*5;\s*display:\s*none;\s*\}/, 'hidden by default');
});

test('tiers: the glyph threshold (639px) hides only the label span; the bar is still the container; the phone rule stands', () => {
  const glyph = /@container watch-action-bar \(max-width: 639px\)\s*\{([\s\S]*?)\n\}/.exec(css);
  assert.ok(glyph);
  assert.match(glyph[1], /\.watch-action-btns \.btn \.btn-label\s*\{\s*display:\s*none;\s*\}/);
  const bar = /\.watch-action-bar\s*\{([^}]*)\}/.exec(css);
  assert.match(bar[1], /container-type:\s*inline-size;/);
  assert.match(bar[1], /container-name:\s*watch-action-bar;/);
  assert.match(css.slice(css.indexOf('@media (max-width: 768px)')), /\.watch-action-btns \.btn \.btn-label\s*\{\s*display:\s*none;\s*\}/);
});

test('tiers: watch.html ships the More button inside .watch-action-btns with the shared markup shape, and watch.js wires it once', () => {
  const group = /<div class="watch-action-btns">([\s\S]*?)<\/div>\s*<\/div>/.exec(html);
  assert.ok(group);
  assert.match(group[1], /<button type="button" class="btn" id="more-actions-btn" title="More actions" aria-label="More actions" aria-haspopup="dialog">\s*<i class="icon-more"><\/i> <span class="btn-label">More<\/span>/);
  assert.match(js, /moreBtn\.addEventListener\('click', handleMoreActionsClick, \{ signal \}\);/);
  assert.match(css, /\.icon-more \{ -webkit-mask-image: url\(\/assets\/icons\/more_horiz\.svg\); mask-image: url\(\/assets\/icons\/more_horiz\.svg\); \}/);
  assert.ok(fs.existsSync(path.join(PUB, 'assets', 'icons', 'more_horiz.svg')));
});
