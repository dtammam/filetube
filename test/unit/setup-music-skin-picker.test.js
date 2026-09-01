'use strict';

// [UNIT] v1.230 (Dean, on-device): the mobile Music-player SKIN picker lives on the
// Settings page (Appearance), beside the Theme/Icon pickers. It moved here after two
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

// ---- setup.html: the Appearance section carries the picker container -------------

test('setup.html: an Appearance "Music skin" heading + #music-skin-picker container exist', () => {
  assert.match(SETUP_HTML, /<h3[^>]*>Music skin<\/h3>/, 'a "Music skin" subheading in Appearance');
  assert.match(SETUP_HTML, /<div class="theme-picker" id="music-skin-picker">/, 'the picker container (reuses the shared theme-picker style)');
  // the copy tells the user it is phone-only (so a desktop change that does nothing
  // visible is not confusing).
  assert.match(SETUP_HTML, /on your phone/i, 'the hint says the skin applies to the phone player');
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
  assert.match(body, /skins\.IDS/, 'iterates the three skin ids');
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
  assert.strictEqual(values.length, 4, 'one blurb per skin');
  for (const v of values) assert.ok(!/apple|spotify|ipod/i.test(v), 'blurb avoids the real product name: "' + v + '"');
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
