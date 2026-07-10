'use strict';

// [UNIT] v1.25 post-gate cleanup (T5 flagged, this fix retires it): watch.js
// used to carry a vestigial `defaultMaxVideos` key left over from the old
// per-channel "download last N videos" cap model -- a `defaultMaxVideosForModal`
// closure variable, read from `GET /api/subscriptions/health`'s
// `defaultMaxVideos` field and passed into `buildSubscribeModal`'s options as
// `defaultMaxVideos`, even though the modal itself (public/js/common.js) no
// longer reads that option (v1.25 replaced the count cap with a per-channel
// `cutoffDate`). No jsdom/browser-DOM harness exists in this codebase (see
// CONTRIBUTING.md), so -- mirroring test/unit/watch-prev-next-flash.test.js's
// established pattern -- this is a source-text regression guard: it proves
// the dead key/variable never creeps back in, without needing a real DOM or
// fetch mock.

const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert');

const watchJs = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'watch.js'), 'utf8');

test('watch.js no longer references defaultMaxVideos anywhere (dead key from the retired max-videos-cap model)', () => {
  assert.ok(
    !watchJs.includes('defaultMaxVideos'),
    'expected watch.js to contain no "defaultMaxVideos" reference at all'
  );
});

test('watch.js no longer declares the vestigial defaultMaxVideosForModal closure variable', () => {
  assert.ok(
    !watchJs.includes('defaultMaxVideosForModal'),
    'expected watch.js to contain no "defaultMaxVideosForModal" reference at all'
  );
});

test('watch.js still builds the subscribe modal options without a defaultMaxVideos field', () => {
  assert.match(
    watchJs,
    /channelName: currentChannelName,\s*channelUrl: currentSubState\.identity\.channelUrl,\s*format: mediaData && mediaData\.type === 'audio' \? 'audio' : 'video',\s*\},/,
    'expected the buildSubscribeModal options object to end after `format`, with no defaultMaxVideos field'
  );
});
