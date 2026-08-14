'use strict';

// [UNIT] v1.122 (Dean, on-device v1.121): the healed channel names (v1.115/116)
// showed on all CARDS but TWO surfaces still rendered the raw FOLDER name
// ("nestalgiamusic" instead of "NESTALGIA") - the recurring
// enumerate-every-surface class (v1.41.4, v1.113, v1.114, v1.117):
//   1. watch.js's related rail rendered `item.folderName` raw (predates
//      resolveChannelName, never swept).
//   2. main.js's `?root=` folder-view header (the channel-name tap target)
//      titled itself with the folder basename.
// Fix: the related rail routes through the SAME resolveChannelName every card
// uses; the header retitles via the new pure resolveRootHeaderLabel when page-0
// items all agree on ONE channel name (a mixed folder keeps its folder label).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { resolveRootHeaderLabel, resolveChannelName } = require('../../public/js/common.js');

const FALLBACK = 'nestalgiamusic';

test('resolveRootHeaderLabel: all items agreeing on ONE channel name wins over the folder label', () => {
  const items = [
    { channelName: 'NESTALGIA', folderName: 'nestalgiamusic' },
    { channelName: 'NESTALGIA', folderName: 'nestalgiamusic' },
  ];
  assert.strictEqual(resolveRootHeaderLabel(items, {}, FALLBACK), 'NESTALGIA');
});

test('resolveRootHeaderLabel: a MIXED folder keeps the folder label (never a guess)', () => {
  const items = [
    { channelName: 'Channel A', folderName: 'misc' },
    { channelName: 'Channel B', folderName: 'misc' },
  ];
  assert.strictEqual(resolveRootHeaderLabel(items, {}, 'Miscellaneous from SLS'), 'Miscellaneous from SLS');
});

test('resolveRootHeaderLabel: empty/absent items keep the fallback; nameless items unify on the resolver fallback (parity with cards)', () => {
  assert.strictEqual(resolveRootHeaderLabel([], {}, FALLBACK), FALLBACK);
  assert.strictEqual(resolveRootHeaderLabel(null, {}, FALLBACK), FALLBACK);
  // No channelName anywhere -> every item resolves to its folderName -> that IS
  // the unified label (identical to today's header, via the SAME resolver the
  // cards use).
  const nameless = [{ folderName: 'nestalgiamusic' }, { folderName: 'nestalgiamusic' }];
  assert.strictEqual(resolveRootHeaderLabel(nameless, {}, FALLBACK), 'nestalgiamusic');
});

test('resolveRootHeaderLabel: routes through resolveChannelName (an @handle strips, matching the cards)', () => {
  const items = [{ channelName: '@nestalgiamusic', folderName: 'nestalgiamusic' }];
  assert.strictEqual(resolveRootHeaderLabel(items, {}, FALLBACK), resolveChannelName(items[0]));
  assert.strictEqual(resolveRootHeaderLabel(items, {}, FALLBACK), 'nestalgiamusic'); // stripped @
});

// ---- source locks (no jsdom harness for these render paths) -----------------

const WATCH_JS = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'watch.js'), 'utf8');
const MAIN_JS = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'main.js'), 'utf8');

test('watch.js: the related rail renders resolveChannelName, NEVER raw folderName', () => {
  assert.match(WATCH_JS, /<div class="related-uploader">\$\{escapeHtml\(resolveChannelName\(item, folderSettings\)\)\}<\/div>/,
    'the uploader line routes through the shared resolver');
  assert.ok(!/related-uploader">\$\{escapeHtml\(item\.folderName\)\}/.test(WATCH_JS),
    'the raw folderName render must not return');
});

test('main.js: fetchLibraryPage0 retitles a ?root= view via resolveRootHeaderLabel with a DERIVED fallback', () => {
  const m = /async function fetchLibraryPage0\(\) \{([\s\S]*?)\n {4}\}/.exec(MAIN_JS);
  assert.ok(m, 'fetchLibraryPage0 exists');
  assert.match(m[1], /if \(rootFilter && videosHeader\) \{[\s\S]*?resolveRootHeaderLabel\(currentItems, folderSettings, rootLabel\)/,
    'root views retitle from page-0 items; non-root views are untouched by the gate');
  // The fallback is DERIVED (folderSettings name || basename), never read back
  // from the DOM (the count badge renders INSIDE the header).
  assert.match(m[1], /const rootLabel = \(folderSettings\[rootFilter\] && folderSettings\[rootFilter\]\.name\) \|\| rootBase;/,
    'derived fallback, not videosHeader.textContent');
  // The badge is re-rendered after the retitle (textContent wipes it).
  assert.match(m[1], /resolveRootHeaderLabel[\s\S]*?updateItemCountBadge\(\);/, 'badge re-render follows the retitle');
});
