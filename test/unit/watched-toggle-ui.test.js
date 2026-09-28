'use strict';

// [UNIT] v1.72 (cap 6) - source locks binding the watch page's manual
// Watched toggle to its USE (the card-like.test.js posture: bind the fetch
// call + state seams, not just a helper's existence).

const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert');

const watchSrc = fs.readFileSync(path.join(__dirname, '../../public/js/watch.js'), 'utf8');

test('the toggle round-trips POST/DELETE /api/watched/:id, non-optimistically', () => {
  assert.ok(watchSrc.includes("fetch(`/api/watched/${encodeURIComponent(mediaData.id)}`, { method: wasWatched ? 'DELETE' : 'POST' })"),
    'the fetch USE - DELETE when watched, POST when not');
  assert.ok(watchSrc.includes("console.error('Watched toggle failed:'"), 'a failed response never fakes success');
  assert.ok(watchSrc.includes('currentWatchedState = { watched: !wasWatched };'), 'the local mirror flips only inside the resolved ok-path');
});

test('the initial state reads the SERVER derivation (mediaData.watchState), never a client re-derivation', () => {
  assert.ok(watchSrc.includes("currentWatchedState = { watched: mediaData.watchState === 'watched' };"),
    'seeded from GET /api/videos/:id watchState');
  assert.ok(!/progressPercent[^\n]*>=\s*90/.test(watchSrc), 'no client-side watched-threshold re-derivation anywhere in watch.js');
});

// UI pass sweep S3 (D4.9): the toggle is a More-menu entry (the menu is built at each open
// from the live state and closes with the view's signal); driven behaviourally in
// watch-sweep-s3.test.js ("More: Mark as watched POSTs ... and the next open reads Mark as unwatched").
test('the More menu entry is wired to the toggle, and its label follows the state', () => {
  assert.ok(watchSrc.includes("else if (id === 'watched') handleToggleWatched();"), 'the menu pick runs the toggle');
  assert.ok(watchSrc.includes('setupWatchedState();'), 'the state is seeded in the media-resolved path');
  const { buildWatchMoreItems } = require('../../public/js/watch.js');
  assert.strictEqual(buildWatchMoreItems({ watched: false }).find((i) => i.id === 'watched').label, 'Mark as watched');
  assert.strictEqual(buildWatchMoreItems({ watched: true }).find((i) => i.id === 'watched').label, 'Mark as unwatched');
});
