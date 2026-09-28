'use strict';

// [UNIT] UI pass D7 (A5 of the music audit; F23's second half): leaving Pocket restores the Music
// list by its ANCHOR ROW, not a raw scroll offset. While the skin is up the list behind it keeps its
// scrollY, but a rotate re-flows it at the new width, so the old offset lands on other rows. The
// anchor is the first row still on screen (its id + its distance from the viewport top) taken at
// entry (and re-taken by any render behind the skin at the SAME width); at exit, if the width
// changed, the page goes back so that row sits where it did. Pure helpers here; the seams (entry,
// render, exit) are source-bound below.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { findListAnchor, anchorRestoreTarget } = require('../../public/js/music.js');

// a list whose rows report the rects a layout would give them (rowH per row, `top` = the first row's top)
function list(ids, attr, top, rowH, extra) {
  const dom = new JSDOM('<div id="c"></div>');
  const host = dom.window.document.getElementById('c');
  ids.forEach((id, i) => {
    const r = dom.window.document.createElement('div');
    r.setAttribute(attr, id);
    if (extra && extra[i]) for (const [k, v] of Object.entries(extra[i])) r.setAttribute(k, v);
    r.getBoundingClientRect = () => ({ top: top + i * rowH, bottom: top + (i + 1) * rowH, height: rowH, left: 0, right: 300, width: 300 });
    host.appendChild(r);
  });
  return host;
}

test('findListAnchor: the first row still on screen, by its id and its distance from the top (skeletons and off-screen rows skipped)', () => {
  // rows 0-1 scrolled above the viewport (bottom <= 0), row 2 straddles the top edge
  const host = list(['a', 'b', 'c', 'd', 'e'], 'data-id', -190, 64);
  assert.deepStrictEqual(findListAnchor(host, 390), { attr: 'data-id', value: 'c', viewTop: -190 + 2 * 64, width: 390 });
  const albums = list(['k1', 'k2'], 'data-album-key', 100, 150);
  assert.deepStrictEqual(findListAnchor(albums, 844), { attr: 'data-album-key', value: 'k1', viewTop: 100, width: 844 });
  const skel = list(['s1', 's2'], 'data-id', 0, 64, [{ 'aria-hidden': 'true' }]);
  assert.strictEqual(findListAnchor(skel, 390).value, 's2', 'a skeleton row is not a place');
  assert.strictEqual(findListAnchor(null, 390), null);
  assert.strictEqual(findListAnchor(list([], 'data-id', 0, 64), 390), null, 'an empty list has no anchor');
});

test('anchorRestoreTarget: after a rotate the page moves so the anchor row is back at its distance from the top', () => {
  const anchor = { attr: 'data-id', value: 'd', viewTop: 2, width: 390 };
  // at the new (landscape) width the rows re-flowed: 'd' now sits 530px below the top at scrollY 1200
  const after = list(['a', 'b', 'c', 'd'], 'data-id', 530 - 3 * 50, 50);
  assert.strictEqual(anchorRestoreTarget(anchor, after, 1200, 844), 1200 + 530 - 2, 'scroll so d is at 2px again');
  assert.strictEqual(anchorRestoreTarget(anchor, after, 1200, 390), null, 'the same width: the list kept its place - nothing to do');
  assert.strictEqual(anchorRestoreTarget({ ...anchor, value: 'gone' }, after, 1200, 844), null, 'the row is gone: nothing to do');
  assert.strictEqual(anchorRestoreTarget(anchor, list(['d'], 'data-id', -5000, 50), 100, 844), 0, 'never a negative scroll');
  assert.strictEqual(anchorRestoreTarget(null, after, 0, 844), null);
});

test('the seams: Pocket entry takes the anchor, a render behind the skin re-takes it at the same width only, the exit restores it through FileTubeBodyLock', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'music.js'), 'utf8');
  assert.match(src, /notePocketEnter\(\);\s*document\.body\.classList\.add\('mms-on'\); \/\/ CSS hides the default host chrome/, 'the skin paint takes it before mms-on');
  assert.match(src, /notePocketEnter\(\); \/\/ UI pass D7: the list anchor to restore on the way out\s*document\.body\.classList\.add\('mms-on'\);/, 'the ?play= launch cover too');
  assert.match(src, /if \(wasSkin\) restorePocketAnchor\(\);/, 'the exit (the skin docking / collapsing) restores');
  assert.match(src, /function refreshPocketAnchor\(\) \{\s*if \(!document\.body\.classList\.contains\('mms-on'\)\) return;\s*if \(pocketAnchor && pocketAnchor\.width !== window\.innerWidth\) return;/, 'a post-rotate render never replaces the pre-rotate anchor');
  assert.match(src, /revealMusicArt\(\);\s*refreshPocketAnchor\(\);/, 'render() re-takes it');
  assert.match(src, /BL\.scrollTo\(document, window, target\)/, 'the restore routes through the body lock (a haptic ghost may hold the body)');
});
