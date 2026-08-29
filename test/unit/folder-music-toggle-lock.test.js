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

test('the toggle renders only for a library-write user on an audio-bearing folder', () => {
  const m = SRC.match(/if \(folderFilter && videosHeader && folderHasAudio[\s\S]{0,2000}?insertAdjacentElement\('afterend', mbtn\)/);
  assert.ok(m, 'the folder-music-toggle render block is present');
  const block = m[0];
  assert.match(block, /folderFilter/, 'folder views only');
  assert.match(block, /folderHasAudio/, 'gated on the folder having audio');
  assert.match(block, /cardCornerCaps\s*&&\s*cardCornerCaps\.canModifyLibrary === true/, 'gated on the library-write capability');
});

test('folderHasAudio derives from an actual audio item in the current folder', () => {
  assert.match(SRC, /const folderHasAudio = Array\.isArray\(currentItems\) && currentItems\.some\(\(it\) => it && it\.type === 'audio'\)/,
    'hasAudio is computed from a real type:audio item, not assumed');
});

test('the toggle reads the mark (GET) and writes the mark (POST) via the music-flag route', () => {
  assert.match(SRC, /fetch\(`\/api\/folders\/music-flag\?folderName=\$\{encodeURIComponent\(folderFilter\)\}`\)/, 'reads the effective state');
  assert.match(SRC, /fetch\('\/api\/folders\/music-flag',[\s\S]{0,140}?method: 'POST'[\s\S]{0,140}?folderName: folderFilter, music: next/, 'writes an explicit on/off override');
  assert.match(SRC, /const next = effectiveNow \? 'off' : 'on'/, 'the click flips the current effective state');
});

test('the on-state paints the is-on class (the glanceable accent)', () => {
  assert.match(SRC, /mbtn\.classList\.toggle\('is-on', !!effective\)/, 'the is-on class tracks the effective state');
});
