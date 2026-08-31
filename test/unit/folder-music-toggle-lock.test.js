'use strict';

// [UNIT] Wave G - SOURCE-LOCK on the folder-header "Show in Music" toggle wiring
// in public/js/main.js. The toggle is thin glue over two routes that ARE
// behaviourally bound (test/integration/music-library-projection.test.js: GET +
// POST /api/folders/music-flag, capability + visibility + effective state). A
// full loadLibrary jsdom boot is disproportionate for the glue, so this locks
// the load-bearing invariants against silent removal: the render is gated on
// BOTH library-write capability AND the folder actually having audio, and it
// reads/writes the mark route. Comments are stripped ONCE (the comment-porous-
// lock lesson) so a commented-out gate cannot keep this green.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'main.js'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');

test('the toggle renders for a library-write user on a folder view, gated authoritatively on the server hasAudio', () => {
  // Anchor on the music block's own id ('folder-music-toggle') right after the
  // gate so this can never latch onto the byte-identical rename-button gate.
  const m = SRC.match(/if \(musicFolderName && videosHeader && cardCornerCaps && cardCornerCaps\.canModifyLibrary === true\)[\s\S]{0,200}?folder-music-toggle[\s\S]{0,2800}?insertAdjacentElement\('afterend', mbtn\)/);
  assert.ok(m, 'the folder-music-toggle render block is present');
  const block = m[0];
  assert.match(block, /cardCornerCaps\s*&&\s*cardCornerCaps\.canModifyLibrary === true/, 'gated on the library-write capability');
  // v1.224: hasAudio (server truth) is the authority, NOT the loaded-page
  // folderHasAudio - a folder with no audio removes the button, one WITH audio
  // reveals it even if the loaded page was all videos (the channel-view fix).
  assert.match(block, /s\.hasAudio !== true[\s\S]{0,140}?removeChild\(mbtn\)/, 'server hasAudio false -> the toggle is removed');
  assert.match(block, /mbtn\.hidden = false/, 'server hasAudio true -> revealed even if the loaded page had no audio');
});

test('folderHasAudio (loaded-page) drives only the OPTIMISTIC initial visibility, not the authority', () => {
  assert.match(SRC, /const folderHasAudio = Array\.isArray\(currentItems\) && currentItems\.some\(\(it\) => it && it\.type === 'audio'\)/,
    'hasAudio is computed from a real type:audio item, not assumed');
  assert.match(SRC, /mbtn\.hidden = !folderHasAudio/, 'the loaded-page check only sets the initial hidden state (no flash), the fetch confirms');
});

test('v1.225: the channel folder is the ?folder= value, else (a pinned ?root= view) the SINGLE folderName the items share', () => {
  // A pinned sidebar channel navigates via ?root= (not ?folder=), so derive the
  // channel from the loaded items' OWN folderName - correct by construction, and a
  // MULTI-channel root gets no single mark (skip).
  assert.match(SRC, /let musicFolderName = folderFilter;/, 'prefers an explicit ?folder=');
  assert.match(SRC, /if \(!musicFolderName && rootFilter\)[\s\S]{0,320}?if \(itemFolders\.length === 1\) musicFolderName = itemFolders\[0\]/,
    'on a ?root= view, uses the single shared folderName (a multi-folder root -> no mark)');
});

test('the toggle reads the mark (GET) and writes the mark (POST) via the music-flag route (keyed by the derived channel folder)', () => {
  assert.match(SRC, /fetch\(`\/api\/folders\/music-flag\?folderName=\$\{encodeURIComponent\(musicFolderName\)\}`\)/, 'reads the effective state for the derived channel folder');
  assert.match(SRC, /fetch\('\/api\/folders\/music-flag',[\s\S]{0,140}?method: 'POST'[\s\S]{0,140}?folderName: musicFolderName, music: next/, 'writes an explicit on/off override for the derived channel folder');
  assert.match(SRC, /const next = effectiveNow \? 'off' : 'on'/, 'the click flips the current effective state');
});

test('the on-state paints the is-on class (the glanceable accent)', () => {
  assert.match(SRC, /mbtn\.classList\.toggle\('is-on', !!effective\)/, 'the is-on class tracks the effective state');
});
