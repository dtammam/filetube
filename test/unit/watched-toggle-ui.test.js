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

test('the control mounts into the action-bar group and is wired through the view signal', () => {
  assert.ok(watchSrc.includes("watchedBtn.id = 'watched-media-btn'"));
  assert.ok(watchSrc.includes("watchedBtn.addEventListener('click', handleToggleWatched, { signal });"),
    'abort-signal bound - the v1.41.11 stale-handler rule');
  assert.ok(watchSrc.includes('setupWatchedButton();'), 'the setup call actually runs in the media-resolved path');
});
