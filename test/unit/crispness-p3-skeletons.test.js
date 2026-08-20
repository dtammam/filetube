'use strict';

// [UNIT] v1.157 (P3, crispness): the in-app-nav skeletons that reserve space
// before a fetch so a surface does not paint empty then pop in. Pure string
// builders (the `buildSkeletonGrid` contract): shape-matched shimmer, every
// node aria-hidden + skeleton-shimmer, non-positive counts -> harmless.

const { test } = require('node:test');
const assert = require('node:assert');

const { buildSetupFolderSkeleton } = require('../../public/js/setup.js');
const { buildPodcastShowSkeleton } = require('../../public/js/podcasts.js');

test('buildSetupFolderSkeleton: N shape-matched .folder-item-row shimmer rows, all aria-hidden', () => {
  const html = buildSetupFolderSkeleton(3);
  assert.strictEqual((html.match(/class="folder-item-row"/g) || []).length, 3, 'one skeleton per requested row');
  assert.strictEqual((html.match(/aria-hidden="true"/g) || []).length, 3, 'every skeleton row is aria-hidden');
  assert.match(html, /skeleton-shimmer/, 'uses the shared shimmer primitive');
  assert.match(html, /skeleton-line-title/, 'has a title bar (mirrors the real folder-path row)');
});

test('buildSetupFolderSkeleton: non-positive / non-integer counts render nothing (harmless)', () => {
  assert.strictEqual(buildSetupFolderSkeleton(0), '');
  assert.strictEqual(buildSetupFolderSkeleton(-2), '');
  assert.strictEqual(buildSetupFolderSkeleton(1.5), '');
});

test('buildPodcastShowSkeleton: a show-art header over N episode-row shimmers, all aria-hidden', () => {
  const html = buildPodcastShowSkeleton(6);
  assert.match(html, /podcast-show-art skeleton-shimmer/, 'reuses the real show-art box as the header shimmer');
  // header title + 6 episode rows each carry the shimmer line
  assert.ok((html.match(/skeleton-line-title/g) || []).length >= 2, 'a header title + per-row title bars');
  assert.strictEqual((html.match(/skeleton-line-meta/g) || []).length, 6, 'one meta bar per episode row');
  assert.doesNotMatch(html, /aria-hidden="false"/, 'no visible (AT-reachable) skeleton node');
  assert.ok((html.match(/aria-hidden="true"/g) || []).length >= 7, 'header + rows all aria-hidden');
});

test('buildPodcastShowSkeleton: zero rows still renders the header, negative/garbage is harmless', () => {
  assert.match(buildPodcastShowSkeleton(0), /podcast-show-art/, 'the header shows even with no episode rows');
  assert.doesNotThrow(() => buildPodcastShowSkeleton(-3));
  assert.doesNotThrow(() => buildPodcastShowSkeleton('x'));
});
