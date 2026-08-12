'use strict';

// [UNIT] v1.110 (Dean): the "Share video vs Share at current time" prompt.
// - showChoiceModal (common.js): behavioral jsdom test -- XSS-safe textContent
//   labels/title, one button per choice, settle-once (pick or cancel).
// - player.getCurrentTime + watch.js handleShareClick wiring: source-locked
//   (no player-boot jsdom harness in this repo -- CONTRIBUTING.md).
const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const COMMON = require.resolve('../../public/js/common.js');

let dom;
function bootCommon() {
  delete global.document; delete global.window;
  delete require.cache[COMMON];
  const common = require(COMMON); // boot skipped (no document at require time)
  dom = new JSDOM('<!DOCTYPE html><body></body>', { url: 'http://localhost/' });
  global.window = dom.window;
  global.document = dom.window.document;
  return common;
}
afterEach(() => {
  if (dom) dom.window.close();
  delete global.window; delete global.document;
  delete require.cache[COMMON];
});

test('showChoiceModal: title + labels are textContent (no HTML injection)', () => {
  const { showChoiceModal } = bootCommon();
  showChoiceModal('<img src=x onerror=alert(1)>Share', [
    { label: '<b>Share video</b>', onPick() {} },
  ]);
  const doc = global.document;
  const titleEl = doc.querySelector('.modal-title');
  assert.strictEqual(titleEl.textContent, '<img src=x onerror=alert(1)>Share', 'title kept as literal text');
  assert.strictEqual(titleEl.querySelector('img'), null, 'no injected element from the title');
  const btn = doc.querySelector('.choice-modal-btn');
  assert.strictEqual(btn.textContent, '<b>Share video</b>', 'label kept as literal text');
  assert.strictEqual(btn.querySelector('b'), null, 'no injected element from the label');
});

test('showChoiceModal: one button per choice + a Cancel; picking fires that onPick exactly once (settle-once)', () => {
  const { showChoiceModal } = bootCommon();
  const doc = global.document;
  let a = 0; let b = 0;
  showChoiceModal('Share', [
    { label: 'Share video', onPick() { a++; } },
    { label: 'Share at current time (2:14)', onPick() { b++; } },
  ]);
  const picks = doc.querySelectorAll('.choice-modal-btn');
  assert.strictEqual(picks.length, 2, 'one button per choice');
  assert.ok(doc.querySelector('.modal-actions .btn'), 'a Cancel button exists');
  // pick the second choice
  picks[1].click();
  assert.strictEqual(b, 1, 'the chosen onPick fired');
  assert.strictEqual(a, 0, 'the other did not');
  // settle-once: a second click (even on the other button) does nothing
  picks[0].click();
  assert.strictEqual(a, 0, 'settled -> no further onPick');
  assert.strictEqual(b, 1);
  // teardown was initiated (modal-closing added synchronously)
  assert.ok(doc.querySelector('.modal-backdrop').classList.contains('modal-closing'), 'teardown started on pick');
});

test('showChoiceModal: Cancel settles with NO onPick', () => {
  const { showChoiceModal } = bootCommon();
  const doc = global.document;
  let picked = 0;
  showChoiceModal('Share', [{ label: 'Share video', onPick() { picked++; } }]);
  doc.querySelector('.modal-actions .btn').click(); // Cancel
  assert.strictEqual(picked, 0, 'cancel fires no choice');
  assert.ok(doc.querySelector('.modal-backdrop').classList.contains('modal-closing'), 'teardown started on cancel');
});

// ---- source-locks: player.getCurrentTime + watch.js prompt wiring -----------
test('v1.110 source-lock: player.getCurrentTime is VOD-only (null for live), and watch prompts only >= 1s', () => {
  const playerSrc = fs.readFileSync(path.join(ROOT, 'public', 'js', 'player.js'), 'utf8');
  const getT = playerSrc.slice(playerSrc.indexOf('getCurrentTime: function ()'), playerSrc.indexOf('getCurrentTime: function ()') + 300);
  assert.match(getT, /if \(!currentId \|\| !mediaPlayer \|\| liveMode\) return null;/, 'null when nothing loaded or live');
  assert.match(getT, /return \(typeof t === 'number' && isFinite\(t\)\) \? t : null;/, 'returns the finite currentTime else null');

  const watchSrc = fs.readFileSync(path.join(ROOT, 'public', 'js', 'watch.js'), 'utf8');
  const fn = watchSrc.slice(watchSrc.indexOf('function handleShareClick()'), watchSrc.indexOf('function handleShareClick()') + 1200);
  assert.match(fn, /player\.getCurrentTime\(\)/, 'reads the live position from the player');
  assert.match(fn, /if \(typeof t === 'number' && isFinite\(t\) && t >= 1\) \{/, 'prompts only for a meaningful position (>= 1s)');
  assert.match(fn, /label: 'Share video', onPick: \(\) => runShare\(base\)/, 'a plain-link choice');
  assert.match(fn, /withShareStartTime\(base, t\)/, 'a share-at-current-time choice with ?t=');
  assert.match(fn, /runShare\(base\);/, 'falls back to the plain share under 1s / null');
});
