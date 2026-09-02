'use strict';

// [UNIT] v1.251 (Dean's consistency rule): "anything purely audio, tapped from ANYWHERE,
// opens the right player." The rule itself is common.js audioOpenHref (bound behaviorally in
// audio-opens-in-music.test.js); THIS file is the COMPLETENESS NET - the route-table-derived
// discipline (the v1.80/v1.97 access-control lesson): enumerate every `/watch.html?v=`
// producer in the client js and hold each file to a DISPOSITIONED count. A new producer (or
// a new file) FAILS this test until a human routes it through the rule or documents why it
// legitimately stays /watch - so the pinned-channel class of miss can never silently return.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const JS_DIR = path.join(__dirname, '..', '..', 'public', 'js');
const NEEDLE = /watch\.html\?v=/g;

// file -> { count, why } - the DISPOSITION LEDGER. Every entry names the sites' reasons;
// change a count ONLY together with a disposition for the new/removed site.
const DISPOSITIONS = {
  'common.js': {
    count: 3,
    why: 'bell-row + queue-chrome FALLBACKS after audioOpenHref returned null (video/item-less), '
      + 'plus the legacy watch-URL matcher comment-adjacent site - all rule-consulting or inert.',
  },
  'history.js': {
    count: 1,
    why: 'the video fallback after audioOpenHref returned null (audio rows route to Music).',
  },
  'main.js': {
    count: 4,
    why: 'card/row/grid FALLBACKS after musicHrefForItem (the common-rule delegate) returned '
      + 'null, plus the grid click-delegation SELECTOR (reads hrefs, produces none).',
  },
  'music.js': {
    count: 1,
    why: 'the deliberate ao=1 MISS-BOUNCE: a non-projected id tapped via the reroute returns '
      + 'to /watch (the v1.236 contract).',
  },
  'player.js': {
    count: 4,
    why: 'BYTE-FROZEN FILE (the standing contract): the player\'s own queue-advance / '
      + 'mini-bar-return navigations are chain steps, not browse taps - out of scope by '
      + 'ruling; a future player.js wave owns any change here.',
  },
  'watch.js': {
    count: 8,
    why: 'related-rail FALLBACK after audioOpenHref (audio related cards route), the '
      + 'queueEntryHref fallbacks (the helper carries the rule), prev/next CHAIN navigation '
      + '(keeps the browse context - dispositioned out of scope with the player advances), '
      + 'the post-move same-item re-key navigate, and href-reading selectors/comments.',
  },
};

test('every client file\'s /watch.html?v= producer count matches its DISPOSITION (a new producer must be routed or documented)', () => {
  const files = fs.readdirSync(JS_DIR).filter((f) => f.endsWith('.js') && !f.startsWith('.'));
  assert.ok(files.length >= 10, 'sanity: the client js enumeration found the real set (found ' + files.length + ')');
  const problems = [];
  const seen = new Set();
  for (const f of files) {
    const src = fs.readFileSync(path.join(JS_DIR, f), 'utf8');
    const count = (src.match(NEEDLE) || []).length;
    if (count === 0) continue;
    seen.add(f);
    const d = DISPOSITIONS[f];
    if (!d) { problems.push(`${f}: ${count} producer(s) with NO disposition - route them through audioOpenHref or document why they stay /watch`); continue; }
    if (d.count !== count) problems.push(`${f}: expected ${d.count} dispositioned producer(s), found ${count} - a producer was added/removed without re-dispositioning`);
  }
  for (const f of Object.keys(DISPOSITIONS)) {
    if (!seen.has(f)) problems.push(`${f}: dispositioned but no longer produces /watch.html?v= - prune the stale ledger entry`);
  }
  assert.deepStrictEqual(problems, [], 'the audio-routing completeness net:\n  ' + problems.join('\n  '));
});

test('the rule-consulting surfaces actually CONSULT the rule (the net is not just counting)', () => {
  // A count alone could stay stable while a consult is deleted and a hardcoded href added in
  // the same edit. Bind the consult per routed surface (spelling-level; the behavior is in
  // audio-opens-in-music.test.js).
  const read = (f) => fs.readFileSync(path.join(JS_DIR, f), 'utf8');
  assert.match(read('common.js'), /audioOpenHref\(\{ id: row\.mediaId, type: row\.type, chapterCount: row\.chapterCount \}\)/, 'bell rows consult the rule');
  assert.match(read('common.js'), /audioOpenHref\(\{ id: entry\.mediaId, kind: entry\.kind, type: entry\.item\.type/, 'the queue chrome consults the rule');
  assert.match(read('history.js'), /typeof audioOpenHref === 'function' && audioOpenHref\(item\)/, 'history rows consult the rule');
  assert.match(read('watch.js'), /typeof audioOpenHref === 'function' && audioOpenHref\(item\)/, 'the related rail consults the rule');
  assert.match(read('main.js'), /typeof audioOpenHref === 'function' && audioOpenHref/, 'main.js delegates to the rule');
});
