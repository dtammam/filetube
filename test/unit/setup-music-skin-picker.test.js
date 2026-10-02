'use strict';

// [UNIT] v1.230 (Dean, on-device): the mobile Music-player SKIN picker lives on the
// Settings page (the Mobile player section, v1.349; Appearance before that). It moved to Settings after two
// misfires: the in-player switcher chips (v1.227/8) vanished against some skins, and
// a v1.229 account-menu picker often never appeared because the menu builds ONCE at
// boot and only some shells loaded the skins module. The root-cause guard is the
// shell-coverage test at the bottom: EVERY shell that runs setup.js must also load
// music-skins.js, so window.FileTubeMusicSkins is present when the picker renders.
//
// Setup.js has no jsdom harness in this repo (CONTRIBUTING.md) - these are source
// locks, mirroring setup-debug-lifecycle-toggle.test.js.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PUB = path.join(__dirname, '..', '..', 'public');
const SETUP_HTML = fs.readFileSync(path.join(PUB, 'setup.html'), 'utf8');
const SETUP_JS = fs.readFileSync(path.join(PUB, 'js', 'setup.js'), 'utf8');
const COMMON_JS = fs.readFileSync(path.join(PUB, 'js', 'common.js'), 'utf8');

// ---- setup.html: the Mobile player section carries the picker container -------------

// the <details> of one Settings section, by its data-collapse-key
function sectionHtml(key) {
  const m = new RegExp('<details[^>]*data-collapse-key="' + key + '"[\\s\\S]*?</details>').exec(SETUP_HTML);
  assert.ok(m, 'the ' + key + ' section exists in setup.html');
  return m[0];
}

test('setup.html: a "Music skin" heading + #music-skin-picker container exist', () => {
  assert.match(SETUP_HTML, /<h3[^>]*>Music skin<\/h3>/, 'a "Music skin" subheading');
  // v1.344 (W5, DELIBERATE conversion): the container is a preview GRID (a radiogroup of tiles), no
  // longer the grouped ui-list of text rows.
  assert.match(SETUP_HTML, /<div class="skin-picker" id="music-skin-picker" role="radiogroup"/, 'the picker container (a tile grid radiogroup)');
  // the copy tells the user it is phone-only (so a desktop change that does nothing
  // visible is not confusing).
  assert.match(SETUP_HTML, /on your phone/i, 'the hint says the skin applies to the phone player');
});

test('setup.html (v1.349): the skin grid lives in the mobile-player section and NOT in appearance', () => {
  assert.match(sectionHtml('mobile-player'), /id="music-skin-picker"/, 'inside mobile-player');
  assert.doesNotMatch(sectionHtml('appearance'), /music-skin-picker/, 'not inside appearance');
});

// ---- setup.js: renderMusicSkinPicker reads the registry + persists the pick -------

test('setup.js: renderMusicSkinPicker builds cards from FileTubeMusicSkins and persists via setActiveSkin', () => {
  const m = /function renderMusicSkinPicker\(\) \{([\s\S]*?)\n\}/.exec(SETUP_JS);
  assert.ok(m, 'renderMusicSkinPicker() is defined');
  const body = m[1];
  assert.match(body, /getElementById\('music-skin-picker'\)/, 'targets its container');
  assert.match(body, /if \(!container \|\| !controller\) return;/, 'same premature-call guard as renderIconPicker');
  assert.match(body, /window\.FileTubeMusicSkins/, 'reads the skins registry');
  assert.match(body, /skins\.activeSkinId\(\)/, 'highlights the active skin from the stored pref');
  assert.match(body, /skins\.skinFamilies\(\)/, 'iterates the registry-derived families (every skin, none forgotten)');
  assert.match(body, /class="ui-tile skin-tile/, 'each skin is a tile');
  assert.ok(!/<img|<canvas|<video|<iframe/.test(body), 'a tile is static CSS: never an image request or a live player');
  assert.match(body, /data-skin-pref=/, 'each card carries its skin id');
  assert.match(body, /skins\.setActiveSkin\(btn\.dataset\.skinPref\)/, 'a click persists the pick (ft-music-skin)');
  assert.match(body, /renderMusicSkinPicker\(\);/, 're-highlights on click');
  assert.match(body, /\{ signal: controller\.signal \}/, 'the click listener is torn down with the view');
});

test('v1.232.1: the skin blurbs avoid the real product names (Dean: cheeky, not the companies)', () => {
  const m = /const MUSIC_SKIN_BLURB = \{([\s\S]*?)\n\};/.exec(SETUP_JS);
  assert.ok(m, 'the MUSIC_SKIN_BLURB map exists');
  // the VALUES (quoted descriptions), not the id keys (which are literally apple/spotify/ipod).
  const values = [...m[1].matchAll(/:\s*'([^']*)'/g)].map((x) => x[1]);
  assert.strictEqual(values.length, require('../../public/js/music-skins.js').IDS.length, 'one blurb per skin');
  // v1.332: the blurb map stays a map, but every registry id must have its blurb (a new colorway
  // without one would show an empty card) - the keys are the registry's ids, no more, no fewer
  const keys = [...m[1].matchAll(/^\s*'?([\w-]+)'?\s*:/gm)].map((x) => x[1]);
  assert.deepStrictEqual(keys.slice().sort(), require('../../public/js/music-skins.js').IDS.slice().sort(), 'a blurb for every registry skin');
  for (const v of values) assert.ok(!/apple|spotify|ipod|zune|microsoft/i.test(v), 'blurb avoids the real product name: "' + v + '"');
});

test('setup.js: renderMusicSkinPicker is CALLED in init (beside renderIconPicker) - not dead code', () => {
  assert.match(SETUP_JS, /renderIconPicker\(\);\s*\n\s*renderMusicSkinPicker\(\);/,
    'init calls renderMusicSkinPicker right after renderIconPicker');
});

test('setup.js: the picker degrades cleanly if the skins module is somehow absent (empties, no throw)', () => {
  const m = /function renderMusicSkinPicker\(\) \{([\s\S]*?)\n\}/.exec(SETUP_JS);
  assert.match(m[1], /if \(!skins[^)]*\) \{ container\.innerHTML = ''; return; \}/, 'no-module -> empty section, never a crash');
});

// ---- common.js: the v1.229 account-menu picker is fully GONE (no orphan) ----------

test('common.js: no account-menu music-skin picker remnant (it moved to Settings)', () => {
  assert.ok(!/buildAccountMusicSkinRow/.test(COMMON_JS), 'the builder is removed');
  assert.ok(!/account-menu-skinpicker|account-menu-skinchip/.test(COMMON_JS), 'no in-menu picker markup');
  assert.ok(!/ft-music-skin-changed/.test(COMMON_JS), 'no live-re-render event dispatch (unneeded now)');
});

// ---- THE ROOT-CAUSE GUARD: every shell running setup.js also loads music-skins.js -

test('every app shell that loads setup.js ALSO loads music-skins.js (so the picker registry is present)', () => {
  const shells = fs.readdirSync(PUB).filter((f) => f.endsWith('.html'));
  const offenders = [];
  for (const f of shells) {
    const html = fs.readFileSync(path.join(PUB, f), 'utf8');
    const hasSetup = /src="\/js\/setup\.js"/.test(html);
    const hasSkins = /src="\/js\/music-skins\.js"/.test(html);
    if (hasSetup && !hasSkins) offenders.push(f);
  }
  assert.deepStrictEqual(offenders, [],
    'these shells run setup.js (which renders the Music-skin picker) but never load music-skins.js, so FileTubeMusicSkins is undefined and the picker would silently render empty - the exact v1.229 bug');
});

// ---- the rendered grid, EXECUTED (v1.345): one group per generation, a tile named by its color ----

test('v1.345: the rendered grid has 24 groups (Original, 22 line generations, Cider, Nordic) and a line tile is named by its color', () => {
  const vm = require('node:vm');
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<div id="music-skin-picker"></div>');
  const skins = require(path.join(PUB, 'js', 'music-skins.js'));
  const grab = (re) => { const m = re.exec(SETUP_JS); assert.ok(m, 'source found: ' + re); return m[0]; };
  const src = [
    grab(/function escStickerHtml\(s\) \{[\s\S]*?\n\}/),
    grab(/function skinSwatchClasses\(s\) \{[\s\S]*?\n\}/),
    "let musicSkinFilter = '';",
    grab(/function applyMusicSkinFilter\(container\) \{[\s\S]*?\n\}/),
    grab(/function renderMusicSkinPicker\(\) \{[\s\S]*?\n\}/),
  ].join('\n');
  const ctx = vm.createContext({
    document: dom.window.document,
    window: { FileTubeMusicSkins: Object.assign({}, skins, { activeSkinId: () => 'ipod-charcoal', setActiveSkin() {} }) },
    controller: new dom.window.AbortController(), MUSIC_SKIN_BLURB: {},
  });
  vm.runInContext(src + '\nrenderMusicSkinPicker();', ctx);
  const doc = dom.window.document;
  const heads = [...doc.querySelectorAll('.skin-family')].map((g) => g.querySelector('.skin-family-name').textContent);
  assert.deepStrictEqual(heads, ['Original', 'Classic 4G (2004)', 'Classic 5G (2005)', 'Classic 6G (2007)', 'Mini 1G (2004)', 'Mini 2G (2005)',
  'Nano 1G (2005)', 'Nano 2G (2006)', 'Nano 3G (2007)', 'Nano 4G (2008)', 'Nano 5G (2009)', 'Nano 6G (2010)', 'Nano 7G (2012)',
  'Shuffle 1G (2005)', 'Shuffle 2G (2006)', 'Shuffle 3G (2009)', 'Shuffle 4G (2010)',
  'Touch 1G-3G (2007)', 'Touch 4G (2010)', 'Touch 5G (2012)', 'Touch 6G-7G (2015)', 'Custom 5G (2005)', 'Cider', 'Nordic']);
  const tile = (id) => doc.querySelector(`[data-skin-pref="${id}"] .skin-tile-name`).textContent;
  assert.strictEqual(tile('ipod-charcoal'), 'Black (2007)');
  assert.strictEqual(tile('ipod-matte'), 'Black (2008)');
  assert.strictEqual(tile('ipod-red'), 'Red');
  assert.strictEqual(tile('apple'), 'Cider');
  assert.strictEqual(tile('ipod-original'), 'Original');
  assert.strictEqual(doc.querySelectorAll('.skin-tile').length, 131);
});

// ---- v1.354 W4: the name filter over the grid ---------------------------------------

test('setup.html + setup.js (v1.354): a "Find a skin" input filters the tiles by name, hiding emptied families', () => {
  assert.match(sectionHtml('mobile-player'), /<input type="search" id="music-skin-filter" class="ui-field__input"/, 'a search input in the mobile-player section');
  const { JSDOM } = require('jsdom');
  const m = /let musicSkinFilter = '';\n(function applyMusicSkinFilter[\s\S]*?\n\})\n/.exec(SETUP_JS);
  assert.ok(m, 'applyMusicSkinFilter is defined');
  const dom = new JSDOM('<div id="c"><div class="skin-family" aria-label="Click"><button class="skin-tile" aria-label="Silver Click"></button><button class="skin-tile" aria-label="Red Click"></button></div>'
    + '<div class="skin-family" aria-label="Nordic"><button class="skin-tile" aria-label="Nordic dark"></button></div></div>');
  const run = new dom.window.Function('c', 'filterRef', 'let musicSkinFilter = filterRef.q;\n' + m[1] + '\napplyMusicSkinFilter(c);');
  const c = dom.window.document.getElementById('c');
  const vis = () => [...c.querySelectorAll('.skin-tile')].filter((t) => !t.hidden).map((t) => t.getAttribute('aria-label'));
  run(c, { q: 'red' });
  assert.deepStrictEqual(vis(), ['Red Click'], 'only the matching tile shows');
  assert.strictEqual(c.querySelectorAll('.skin-family')[1].hidden, true, 'a family with no match hides');
  run(c, { q: 'NORDIC' });
  assert.deepStrictEqual(vis(), ['Nordic dark'], 'case-insensitive');
  run(c, { q: '' });
  assert.strictEqual(vis().length, 3, 'empty shows all');
  assert.ok(![...c.querySelectorAll('.skin-family')].some((f) => f.hidden), 'no family stays hidden');
  assert.match(SETUP_JS, /filterInput\.oninput = \(\) => \{ musicSkinFilter = filterInput\.value; applyMusicSkinFilter\(container\); \}/, 'the input is wired to the filter');
  assert.match(SETUP_JS, /applyMusicSkinFilter\(container\);\n\s+const filterInput/, 'a re-render (a tap re-marks the active tile) re-applies the filter');
});
