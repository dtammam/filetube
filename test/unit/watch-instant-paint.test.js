'use strict';

// [UNIT] v1.52 instant watch - the pure halves: the seed stash contract
// (single-entry, id-matched, aged), the paint-plan builder the watch painter
// applies verbatim, and the watch.html literal LOCK. The DOM applier itself
// is the usual untested-by-necessity thin shell; Dean's device probes are
// the layout gate.
//
// The literal lock asserts markup ABSENCE, which for a FLASH class is the
// honest binding: the flash was literal text in the statically-served
// fragment the SPA re-parses on every hop - if the literal is not in the
// file, it cannot flash. (There is no runtime here to bind to.)
//
// Divergent fixture spellings throughout (v1.41.9).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const {
  stashWatchSeed, consumeWatchSeed, deriveWatchPaintPlan, isFullWatchSeedItem,
} = require('../../public/js/common.js');

const FULL_ITEM = {
  id: 'a1b2c3d4e5f6',
  title: 'Ünmistakably Séeded Title',
  size: 123456789,
  filePath: '/library/Zephyr Chännel/Ünmistakably Séeded Title.mkv',
  ext: '.mkv',
  addedAt: Date.now() - 2 * 24 * 60 * 60 * 1000,
  channelName: 'Zephyr Chännel',
  channelAvatarUrl: 'https://yt3.example/zephyr.jpg',
  sourceViewCount: 424242,
  sourceViewCountCapturedAt: Date.now() - 24 * 60 * 60 * 1000,
  tags: { description: 'A divergent déscription body' },
};

// ---- seed stash contract ----------------------------------------------------

test('stash/consume: happy path carries the item and folderSettings, and is single-shot', () => {
  const fs2 = { '/library': { name: 'Library Näme' } };
  assert.equal(stashWatchSeed(FULL_ITEM, { folderSettings: fs2 }), true);
  const seed = consumeWatchSeed('a1b2c3d4e5f6');
  assert.ok(seed, 'consumed');
  assert.equal(seed.item.title, 'Ünmistakably Séeded Title');
  assert.equal(seed.folderSettings, fs2);
  assert.equal(consumeWatchSeed('a1b2c3d4e5f6'), null, 'single-shot: a second consume gets nothing');
});

test('stash/consume: an id MISMATCH burns the stash (never paints the wrong video)', () => {
  stashWatchSeed(FULL_ITEM);
  assert.equal(consumeWatchSeed('different-id'), null, 'mismatch returns nothing');
  assert.equal(consumeWatchSeed('a1b2c3d4e5f6'), null, 'and the stash is BURNED, not left for a later consume');
});

test('stash/consume: garbage is refused at stash time; stale seeds die at consume time', () => {
  assert.equal(stashWatchSeed(null), false);
  assert.equal(stashWatchSeed({}), false, 'no id, no stash');
  assert.equal(stashWatchSeed({ id: '' }), false);

  stashWatchSeed(FULL_ITEM);
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 11 * 1000; // beyond the 10s age gate
    assert.equal(consumeWatchSeed('a1b2c3d4e5f6'), null, 'a stash whose navigation never happened dies of age');
  } finally {
    Date.now = realNow;
  }
});

// ---- paint plan -------------------------------------------------------------

test('deriveWatchPaintPlan: a full item yields every field, strings identical to what hydration would derive', () => {
  const plan = deriveWatchPaintPlan(FULL_ITEM, 'Zephyr Chännel');
  assert.equal(plan.title, 'Ünmistakably Séeded Title');
  assert.match(plan.viewsLabel, /424,242 views/, 'captured count renders, not a mock');
  assert.equal(plan.channelName, 'Zephyr Chännel');
  assert.equal(plan.channelAvatarUrl, 'https://yt3.example/zephyr.jpg');
  assert.match(plan.subsLabel, /subscribers$/);
  assert.ok(plan.dateLabel && plan.dateLabel !== 'unknown date');
  assert.match(plan.sizeLabel, /MB|GB/);
  assert.equal(plan.typeLabel, 'MKV');
  assert.equal(plan.filePath, FULL_ITEM.filePath);
  assert.equal(plan.isFullItem, true);
  // Determinism across pre-paint and hydration: same input, same strings.
  assert.deepEqual(plan, deriveWatchPaintPlan(FULL_ITEM, 'Zephyr Chännel'));
});

test('deriveWatchPaintPlan: a PARTIAL seed (bell-row shape) plans only what it carries', () => {
  const plan = deriveWatchPaintPlan({
    id: 'a1b2c3d4e5f6',
    title: 'Bëll Row Title',
    channelName: 'Bëll Channel',
    channelAvatarUrl: '',
    hasThumbnail: true,
  }, 'Bëll Channel');
  assert.equal(plan.title, 'Bëll Row Title');
  assert.equal(plan.viewsLabel, undefined, 'NO views plan without a captured count or a real size -- a defaulted-size mock would visibly rewrite at hydration');
  assert.equal(plan.dateLabel, undefined);
  assert.equal(plan.sizeLabel, undefined);
  assert.equal(plan.filePath, undefined);
  assert.equal(plan.isFullItem, false, 'partial: description stays skeletoned');
  assert.match(plan.subsLabel, /subscribers$/, 'channel-derived fields still paint');
});

test('deriveWatchPaintPlan: views plan appears with EITHER a captured count or a real size; zero counts are real', () => {
  const noViews = { id: 'a1b2c3d4e5f6', title: 'T' };
  assert.equal(deriveWatchPaintPlan(noViews, '').viewsLabel, undefined);
  const zeroCount = deriveWatchPaintPlan({ id: 'a1b2c3d4e5f6', sourceViewCount: 0, sourceViewCountCapturedAt: Date.now() }, '');
  assert.match(zeroCount.viewsLabel, /^0 views/, 'a genuine 0-view capture renders, never falls to mock');
  const sizeOnly = deriveWatchPaintPlan({ id: 'a1b2c3d4e5f6', size: 999 }, '');
  assert.ok(sizeOnly.viewsLabel, 'mock views render when the mock inputs are real');
});

test('deriveWatchPaintPlan: no id, no plan; empty channel name plans no uploader fields', () => {
  assert.equal(deriveWatchPaintPlan({ title: 'x' }, 'C'), null);
  assert.equal(deriveWatchPaintPlan(null, 'C'), null);
  const plan = deriveWatchPaintPlan({ id: 'a1b2c3d4e5f6', title: 'x' }, '');
  assert.equal(plan.channelName, undefined);
  assert.equal(plan.subsLabel, undefined);
});

// ---- the pre-load gate ------------------------------------------------------

test('isFullWatchSeedItem: only a full list record (type + size + filePath) may drive a player pre-load', () => {
  assert.equal(isFullWatchSeedItem({ ...FULL_ITEM, type: 'video' }), true);
  assert.equal(isFullWatchSeedItem({ ...FULL_ITEM, type: 'audio' }), true);
  assert.equal(isFullWatchSeedItem(FULL_ITEM), false, 'no type -> no stream decision -> no pre-load');
  assert.equal(isFullWatchSeedItem({ id: 'a1b2c3d4e5f6', title: 'Bëll Row', type: 'video' }), false, 'a partial (bell) seed never pre-loads');
  assert.equal(isFullWatchSeedItem(null), false);
  assert.equal(isFullWatchSeedItem({ ...FULL_ITEM, type: 'video', id: '' }), false);
});

// ---- the reserved-frame CSS lock --------------------------------------------

test('LOCK: #player-slot reserves a 16/9 frame while empty (the zero-height jump killer)', () => {
  const css = fs.readFileSync(path.join(__dirname, '../../public/css/style.css'), 'utf8');
  const idx = css.indexOf('#player-slot:empty');
  assert.ok(idx !== -1, 'the empty-slot reservation rule exists');
  const rule = css.slice(idx, css.indexOf('}', idx));
  assert.match(rule, /aspect-ratio: 16 \/ 9/, 'reserved at the default aspect');
  assert.match(rule, /margin-bottom: 16px/, 'same outer geometry as .player-container');
});

// ---- the literal lock -------------------------------------------------------

test('LOCK: watch.html carries NO flashable placeholder literal, and the skeleton classes are present', () => {
  const html = fs.readFileSync(path.join(__dirname, '../../public/watch.html'), 'utf8');
  const viewRoot = html.slice(html.indexOf('id="view-root"'), html.indexOf('id="player-host-template"'));
  for (const forbidden of [
    'Loading title', '0 views', '10.5K subscribers', 'Folder uploader',
    '/loading...', 'unknown date', '0 MB',
  ]) {
    assert.ok(!viewRoot.includes(forbidden),
      `the literal "${forbidden}" is back in watch.html's #view-root -- it will flash on every SPA hop`);
  }
  assert.match(viewRoot, /id="media-title"[^>]*><\/h1>|class="watch-title skeleton-shimmer/,
    'the title ships as an empty skeleton');
  assert.ok(viewRoot.includes('skeleton-shimmer'), 'skeletons present for cold loads');
  // The "Show more" control ships hidden (it used to sit under an empty box).
  assert.match(viewRoot, /id="expand-desc-btn" style="display: none;"/);
  // The related header ships hidden (a lone header over an empty list).
  assert.match(viewRoot, /id="related-header" hidden/);
});
