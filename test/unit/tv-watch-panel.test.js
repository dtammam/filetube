'use strict';

// [UNIT] The TV episode watch page (initTvWatch / paintTvEpisodePanel in public/js/watch.js):
// no comments section (TV has no real comments, only the fake retro bucket), and no
// forever-shimmering views-count bar (an episode carries no view count).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const WATCH_SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'public/js/watch.js'), 'utf8');
const tvInit = () => WATCH_SRC.slice(WATCH_SRC.indexOf('async function initTvWatch('));

test('initTvWatch hides the comments section and never loads comments or wires the posting form', () => {
  const body = tvInit();
  const end = body.indexOf('\n    }\n');
  const fn = body.slice(0, end > 0 ? end : undefined);
  assert.match(fn, /commentsSection\.hidden = true/);
  assert.doesNotMatch(fn, /loadComments\(\)/);
  assert.doesNotMatch(fn, /wireCommentForm\(\)/);
});

test('TV episode panel clears the views-count skeleton (an episode has no view count, the bar never filled)', () => {
  const start = WATCH_SRC.indexOf('function paintTvEpisodePanel(');
  const end = WATCH_SRC.indexOf('\n    function ', start + 10);
  assert.ok(start > 0 && end > start, 'paintTvEpisodePanel found');
  const body = WATCH_SRC.slice(start, end);
  assert.match(body, /viewsCount\.classList\.remove\('skeleton-shimmer'/);
  assert.match(body, /viewsCount\.hidden = true/);
});
