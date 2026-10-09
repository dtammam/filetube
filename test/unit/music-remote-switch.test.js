'use strict';

// [UNIT] v1.348 Listen Control: the desktop "Remote control" switch and the Music play hook.
// Static markup (no toolbar reflow), no box on a phone, bound to FileTube.remote, and the play
// handler it registers dies with the view (never a call into a dead closure).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const REPO = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8');
const MUSIC = read('public/js/music.js');
const CSS = read('public/css/style.css').replace(/\/\*[\s\S]*?\*\//g, '');

test('music.html ships the switch as static, visible markup with the tooltip and aria-pressed', () => {
  const dom = new JSDOM(read('public/music.html'));
  const el = dom.window.document.getElementById('music-remote-btn');
  assert.ok(el, 'the switch exists');
  assert.strictEqual(el.hidden, false, 'never [hidden]: the first paint has its box');
  assert.ok(!el.classList.contains('music-slot-reserved') && !el.hasAttribute('inert'), 'a live control, not a reserved slot');
  assert.strictEqual(el.getAttribute('aria-pressed'), 'false');
  assert.strictEqual(el.getAttribute('title'), 'Let your other devices play music in this tab. Bookmark /music?remote=on to open it this way', 'v1.352 R3: the tooltip names the speaker bookmark');
  assert.strictEqual(el.getAttribute('aria-label'), 'Remote control');
  assert.strictEqual(el.querySelector('.ui-btn__swap-off').textContent, 'Remote control');
  assert.strictEqual(el.querySelector('.ui-btn__swap-on').textContent, 'Remote control: On');
  const icon = /#i-([a-z_.]+)/.exec(el.innerHTML)[1];
  assert.match(read('public/js/icons.js'), new RegExp('"' + icon.replace('.', '\\.') + '":'), 'the glyph is in the registry');
  assert.ok(el.closest('.music-toolbar-actions'), 'it lives in the toolbar');
});

test('a phone is a controller, never a target: the switch has no box under html.is-phone', () => {
  assert.match(CSS, /html\.is-phone #music-remote-btn\s*\{\s*display:\s*none;\s*\}/);
});

test('music.js registers the play handler per view, routes it through playFromMenu flat, and clears it on abort', () => {
  assert.match(MUSIC, /REMOTE\.setMusicPlayHandler\(remotePlay\);/);
  // v1.352: the same abort also clears the chapter reader (music-remote-controller-wiring binds that half)
  assert.match(MUSIC, /signal\.addEventListener\('abort', function \(\) \{\s*REMOTE\.setMusicPlayHandler\(null\);/);
  // v1.378.0: the play options are built first (a station sent from the phone adds its context) and stay FLAT
  assert.match(MUSIC, /var play = \{ flat: true, label: 'From ' \+ \(req\.label \|\| 'another device'\) \};/);
  assert.match(MUSIC, /playFromMenu\(\{ tracks: req\.tracks, index: req\.index, play: play \}\);/);
  assert.match(MUSIC, /remoteBtn\.addEventListener\('click', function \(\) \{ REMOTE\.toggle\(\); paintRemote\(\); \}, \{ signal \}\);/);
  assert.match(MUSIC, /var offRemote = REMOTE\.onChange\(paintRemote\);\s*signal\.addEventListener\('abort', offRemote\);/);
});
