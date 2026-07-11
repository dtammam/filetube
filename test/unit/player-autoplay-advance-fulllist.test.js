'use strict';

// [UNIT, static source scan] v1.30.0 T7 (v1.30 Scale Performance + Polish
// Wave, A5) -- player.js's `handleAutoplayNext()` ('ended'-cascade
// autoplay-to-next-in-folder) fetches `GET /api/videos` to derive the ended
// item's next-in-order folder-mate. T6 made that endpoint paginated
// (`{ items, total, offset, limit }`, default page size 60) -- this caller
// MUST now (a) read `data.items` (not treat the raw response object as the
// array) AND (b) request the FULL matching set, or autoplay would silently
// stop advancing for any folder over 60 items (the ended item's own next
// neighbor could sit past the truncated first page).
//
// WHY A STATIC SCAN, NOT A jsdom HARNESS: this repo has an existing,
// documented boundary against building a jsdom/browser harness for player
// .js's live playback-engine 'ended' cascade -- see
// test/unit/player-loop-toggle.test.js's own header comment ("the DOM-heavy
// replay/navigate side effects are Dean's manual-test AC48/AC50/AC51/AC53 --
// no jsdom/browser harness in this codebase"). The equivalent client-fetch
// fix on the (comparatively standalone, non-playback-engine) watch.js side
// IS covered by a real interactive jsdom harness --
// test/integration/watch-fulllist-fetch.test.js, which behaviorally proves
// an item past position 60 is found. This file locks the SAME fix on the
// player.js side the way this repo already tests player.js's other 'ended'-
// cascade logic (resolveEndedAction, in that same file) -- by asserting
// against player.js's own source, in the SPECIFIC `handleAutoplayNext`
// function body (never a loose whole-file substring match, so this can't be
// satisfied by an unrelated occurrence of these tokens elsewhere in the
// file).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PLAYER_JS_PATH = path.join(__dirname, '..', '..', 'public', 'js', 'player.js');
const source = fs.readFileSync(PLAYER_JS_PATH, 'utf8');

// Extracts the full `function handleAutoplayNext() { ... }` body via brace
// counting (this function's body legitimately contains nested `{`/`}` --
// object literals, arrow-less `function(){}` callbacks -- so a naive
// non-greedy regex would truncate at the first inner `}`).
function extractFunctionBody(src, functionName) {
  const startMatch = src.match(new RegExp(`function\\s+${functionName}\\s*\\([^)]*\\)\\s*\\{`));
  assert.ok(startMatch, `expected to find "function ${functionName}(...) {" in player.js`);
  const bodyStart = startMatch.index + startMatch[0].length;
  let depth = 1;
  let i = bodyStart;
  for (; i < src.length && depth > 0; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') depth--;
  }
  assert.strictEqual(depth, 0, `expected to find the matching closing brace for function ${functionName}`);
  return src.slice(bodyStart, i - 1);
}

const handleAutoplayNextBody = extractFunctionBody(source, 'handleAutoplayNext');

test('handleAutoplayNext: a module-level full-list query-limit constant is defined and exceeds the 60-item default page size', () => {
  const constMatch = source.match(/var\s+AUTOPLAY_ADVANCE_FULL_LIST_LIMIT\s*=\s*(\d+)\s*;/);
  assert.ok(constMatch, 'expected a module-level `AUTOPLAY_ADVANCE_FULL_LIST_LIMIT` numeric constant in player.js');
  const limit = parseInt(constMatch[1], 10);
  assert.ok(limit > 60, `expected AUTOPLAY_ADVANCE_FULL_LIST_LIMIT (${limit}) to exceed the 60-item default page size`);
});

test('handleAutoplayNext: its own /api/videos fetch requests the full-list limit, not the bare default-paginated endpoint', () => {
  assert.match(
    handleAutoplayNextBody, /AUTOPLAY_ADVANCE_FULL_LIST_LIMIT/,
    'expected handleAutoplayNext() to reference AUTOPLAY_ADVANCE_FULL_LIST_LIMIT in its own /api/videos fetch URL'
  );
  // Both the scoped (?root=...) and unscoped variants must carry it -- this
  // asserts against the URL-building expression itself, not just "the
  // constant appears somewhere in this function".
  assert.match(
    handleAutoplayNextBody, /advanceBaseUrl\s*\+\s*advanceSeparator\s*\+\s*['"]limit=['"]\s*\+\s*AUTOPLAY_ADVANCE_FULL_LIST_LIMIT/,
    'expected the fetch URL to be built as `advanceBaseUrl + advanceSeparator + \'limit=\' + AUTOPLAY_ADVANCE_FULL_LIST_LIMIT`'
  );
});

test('handleAutoplayNext: reads the paginated response via `.items`, never treating the raw response object as the array', () => {
  // The FIXED shape: `data.items` (guarded), never the OLD broken shape of
  // handing the raw fetch-response object straight to
  // `Array.isArray(videos) ? videos : []` (which is always false against
  // `{ items, total, offset, limit }`, silently emptying autoplay-advance).
  assert.match(
    handleAutoplayNextBody, /Array\.isArray\(\s*data\s*&&\s*data\.items\s*\)\s*\?\s*data\.items\s*:\s*\[\]/,
    'expected `Array.isArray(data && data.items) ? data.items : []` -- the paginated response must be unwrapped via `.items`'
  );
  // Regression guard: the OLD broken pattern (feeding the whole response
  // object straight into Array.isArray as `videos`) must be gone.
  assert.doesNotMatch(
    handleAutoplayNextBody, /Array\.isArray\(videos\)\s*\?\s*videos\s*:\s*\[\]/,
    'the old pre-T7 pattern (treating the raw /api/videos response as the array itself) must no longer be present'
  );
  assert.match(
    handleAutoplayNextBody, /deriveOrderedIds\(videos,\s*sortKey\)/,
    'expected deriveOrderedIds to be called with the UNWRAPPED `videos` array (data.items), not the raw response'
  );
});
