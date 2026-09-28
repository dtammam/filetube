'use strict';

// [UNIT] v1.157 (P3, crispness): the in-app-nav skeletons that reserve space
// before a fetch so a surface does not paint empty then pop in. Pure string
// builders (the `buildSkeletonGrid` contract): shape-matched shimmer, every
// node aria-hidden + skeleton-shimmer, non-positive counts -> harmless.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { buildSetupFolderSkeleton } = require('../../public/js/setup.js');
const { buildPodcastShowSkeleton } = require('../../public/js/podcasts.js');

test('buildSetupFolderSkeleton: N shape-matched .folder-item shimmer cards, all aria-hidden', () => {
  const html = buildSetupFolderSkeleton(3);
  assert.strictEqual((html.match(/class="folder-item"/g) || []).length, 3, 'one skeleton per requested row');
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
  // UI pass S6: the header art is the real ui-art 2xl square inside the real .podcast-show-head.
  assert.match(html, /<div class="podcast-show-head" aria-hidden="true"><span class="ui-art ui-avatar--2xl skeleton-shimmer">/, 'reuses the real show-art box as the header shimmer');
  // header title + 6 episode rows each carry the shimmer line
  assert.ok((html.match(/skeleton-line-title/g) || []).length >= 2, 'a header title + per-row title bars');
  assert.strictEqual((html.match(/skeleton-line-meta/g) || []).length, 6, 'one meta bar per episode row');
  assert.doesNotMatch(html, /aria-hidden="false"/, 'no visible (AT-reachable) skeleton node');
  assert.ok((html.match(/aria-hidden="true"/g) || []).length >= 7, 'header + rows all aria-hidden');
});

test('buildPodcastShowSkeleton: zero rows still renders the header, negative/garbage is harmless', () => {
  assert.match(buildPodcastShowSkeleton(0), /class="podcast-show-head"[^>]*><span class="ui-art ui-avatar--2xl/, 'the header shows even with no episode rows');
  assert.doesNotThrow(() => buildPodcastShowSkeleton(-3));
  assert.doesNotThrow(() => buildPodcastShowSkeleton('x'));
});

// Gate WARNING (both seats): the ?play= deep link seeded the show skeleton but
// its catch was a no-op -> a failed /episodes fetch stranded the shimmer forever
// with the grid gone (the reveal-once error axis, 5+ prior strikes). openShow /
// consumeDeepLink are closure-internal, so this binds the invariant at the
// source: any function that SEEDS the show skeleton must also CLEAR content on
// its error path. Remove either clear and this goes red.
test('podcasts.js: every show-view skeleton seed pairs with a clear-on-error (no stranded shimmer)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'podcasts.js'), 'utf8');
  for (const fn of ['openShow', 'consumeDeepLink']) {
    const start = src.indexOf('function ' + fn + '(');
    assert.ok(start !== -1, `${fn} must exist`);
    // The whole function: up to its closing brace at the declaration's 4-space indent (v1.339 R1:
    // the T-C8 re-checks grew consumeDeepLink past the old fixed 2600-char window).
    const end = src.indexOf('\n    }\n', start);
    assert.ok(end !== -1, `${fn} must close`);
    const body = src.slice(start, end);
    if (body.includes('buildPodcastShowSkeleton')) {
      assert.match(body, /content\.innerHTML = ''/,
        `${fn} seeds the show skeleton but never clears content on error (stranded-shimmer regression)`);
    }
  }
});
