'use strict';

// [UNIT] v1.381.0 Feed, TikTok style (plan docs/exec-plans/active/2026-10-09-feed-tiktok.md).
// W1 (D1, D2): the other-device card (#handoff-card) and the download chip (#dl-status-chip) are not shown
// in the Feed. Both live on <body>, outside #view-root, so the rule keys on body[data-view], which the router
// stamps on every view change (common.js applyZoomPolicy -> deriveRouteView). jsdom cannot measure the cascade:
// the rule is locked by source here and measured in a real browser by tools/feed-proof/layout.js.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const CSS = fs.readFileSync(path.join(ROOT, 'public/css/style.css'), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');

// a selector's specificity (ids, classes / attributes / pseudo-classes, types) - enough for the plain selectors this file uses
function specificity(sel) {
  const s = sel.replace(/::[\w-]+/g, '');
  const ids = (s.match(/#[\w-]+/g) || []).length;
  const cls = (s.match(/\.[\w-]+|\[[^\]]*\]|:(?!not\()[\w-]+/g) || []).length;
  const types = (s.replace(/#[\w-]+|\.[\w-]+|\[[^\]]*\]|:[\w-]+(\([^)]*\))?/g, ' ').match(/[a-z][\w-]*/gi) || []).length;
  return [ids, cls, types];
}
const beats = (a, b) => a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2];

test('W1: in the Feed the other-device card and the download chip are display:none (one rule, both ids)', () => {
  const css = stripComments(CSS);
  const rules = css.match(/[^{}]*\{[^{}]*\}/g) || [];
  const hits = rules.filter((r) => /body\[data-view="feed"\]\s*#(handoff-card|dl-status-chip)/.test(r));
  assert.strictEqual(hits.length, 1, 'exactly one rule carries the Feed hide');
  const [sel, body] = hits[0].split('{');
  const selectors = sel.split(',').map((x) => x.trim());
  assert.ok(selectors.includes('html:root body[data-view="feed"] #handoff-card'), 'the other-device card');
  assert.ok(selectors.includes('html:root body[data-view="feed"] #dl-status-chip'), 'the download chip');
  assert.match(body, /display:\s*none/);
  // no !important (ui-lint display-ownership): the rule must win on specificity, never on file order (LESSONS 6)
  for (const id of ['#handoff-card', '#dl-status-chip']) {
    const mine = specificity(selectors.find((x) => x.endsWith(id)));
    const rivals = rules.filter((r) => r !== hits[0] && /(^|[;{\s])display\s*:/.test(r.split('{')[1]))
      .flatMap((r) => r.split('{')[0].split(',').map((x) => x.trim()))
      .filter((x) => new RegExp(id + '$').test(x));
    assert.ok(rivals.length >= 1, id + ': its own display rule is found (non-vacuity)');
    for (const r of rivals) assert.ok(beats(mine, specificity(r)), `${id}: the Feed hide (${mine}) beats "${r}" (${specificity(r)})`);
  }
});

test('W1: the router stamps body[data-view="feed"] for /feed (the hook the rule keys on) and only there', () => {
  const common = require('../../public/js/common.js');
  assert.strictEqual(common.deriveRouteView('/feed'), 'feed');
  assert.notStrictEqual(common.deriveRouteView('/'), 'feed');
  assert.notStrictEqual(common.deriveRouteView('/music'), 'feed');
  const src = fs.readFileSync(path.join(ROOT, 'public/js/common.js'), 'utf8');
  const fn = src.slice(src.indexOf('function applyZoomPolicy('), src.indexOf('function applyZoomPolicy(') + 900);
  assert.match(fn, /deriveRouteView\(window\.location\.pathname/);
  assert.match(fn, /document\.body\.setAttribute\('data-view', view \|\| ''\)/);
});
