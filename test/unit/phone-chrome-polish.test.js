'use strict';

// [UNIT] Phone chrome polish (Dean 2026-11-15): (1) the Select bar sits BELOW the mini player on a phone, not
// stacked above it; (2) the immersive player's controls fade a second sooner on a phone; (3) the download chip
// is hidden while fullscreen. Source-level bindings in the repo's usual style: each assertion names the one
// line whose removal breaks the behaviour.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8');
const CSS = read('public/css/style.css');
const PLAYER = read('public/js/player.js');
const MAIN = read('public/js/main.js');

function fnBody(src, header) {
  const start = src.indexOf(header);
  assert.ok(start > 0, header + ' found');
  const end = src.indexOf('\n  }\n', start);
  return src.slice(start, end > 0 ? end : undefined);
}

test('controls fade: 2 s on a phone (html.is-phone), 3 s elsewhere', () => {
  const body = fnBody(PLAYER, 'function armControlsAutoHide()');
  assert.match(body, /classList\.contains\('is-phone'\)\) \? 2000 : 3000/);
  assert.match(body, /\}, hideAfterMs\);/);
  assert.doesNotMatch(body, /\}, 3000\);/, 'the timer no longer uses the literal 3000');
});

test('download chip: hidden while body.ft-css-fullscreen', () => {
  assert.match(CSS, /body\.ft-css-fullscreen #dl-status-chip \{\s*display: none;\s*\}/);
});

test('select bar: the phone dock rides above the bar by --select-bar-lift', () => {
  const phoneDock = CSS.match(/#player-dock \{\s*width: var\(--player-dock-w\);[\s\S]*?\n {2}\}/);
  assert.ok(phoneDock, 'phone #player-dock rule found');
  assert.match(phoneDock[0], /var\(--select-bar-lift\)/);
  assert.match(CSS, /html\.has-select-bar \{\s*--select-bar-lift: calc\(var\(--select-bar-h, 0px\) \+ var\(--space-4\)\);/);
});

test('select bar: the phone bar is lifted by the dock ONLY for the native dock (CSS cannot lift a native layer)', () => {
  assert.match(CSS, /html\.has-player-dock\.ft-native-dock \.select-bar \{/);
  assert.doesNotMatch(CSS, /\n {2}html\.has-player-dock \.select-bar \{/, 'the web dock no longer pushes the bar up on a phone');
});

test('select bar: things that stack above the dock also clear the lifted dock', () => {
  assert.match(CSS, /html\.has-player-dock #remote-pill \{\s*bottom: calc\([^;]*var\(--select-bar-lift\)/);
  assert.match(CSS, /html\.has-player-dock \.bottom-nav-tip \{\s*bottom: calc\([^;]*var\(--select-bar-lift, 0px\)/);
});

test('select bar: the height is published when the bar paints and cleared when it hides', () => {
  const paint = fnBody(MAIN, 'function paintSelectBar()');
  assert.match(paint, /if \(!selectMode\) \{ if \(selectBar\) selectBar\.hidden = true; publishSelectBarLift\(0\); return; \}/);
  assert.match(paint, /publishSelectBarLift\(bar\.offsetHeight\);/);
  const pub = fnBody(MAIN, 'function publishSelectBarLift(h)');
  assert.match(pub, /ft-native-dock/);
  assert.match(pub, /setProperty\('--select-bar-h'/);
  assert.match(pub, /classList\.add\('has-select-bar'\)/);
  assert.match(pub, /removeProperty\('--select-bar-h'\)/);
  assert.match(pub, /classList\.remove\('has-select-bar'\)/);
});
