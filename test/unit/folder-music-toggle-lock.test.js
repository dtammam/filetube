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


test('v1.268: BOTH labels say what the button does, in hide/show terms - never "remove" (Dean tapped it and could not tell it had acted)', () => {
  // The control is OPT-OUT since v1.242 (every channel is in Music by default),
  // so the old "In your Music library - click to remove" both understated the
  // default and read like it might delete files. Comments are stripped above, so
  // a commented-out label cannot satisfy this.
  // ARM-anchored (slim CRITICAL-1): asserting mere PRESENCE let a swapped ternary
  // survive the whole suite - the button would then say "Hidden from Music" while
  // showing, a strictly worse version of the bug this wave exists to fix. The
  // v1.259 renderer-identity class, re-struck.
  // Condition-anchored (slim S-b): `const t = effective` PREFIX-matches, so
  // `effective === false` - or the realistic `effectiveNow` typo - inverted every
  // label while the arms themselves stayed put, and survived. Bind the whole head.
  assert.match(SRC, /const t = effective\s*\n\s*\? 'Showing in Music - tap to hide this channel/, 'the ON arm carries the SHOWING label, off the UNMODIFIED condition');
  assert.match(SRC, /: 'Hidden from Music - tap to show this channel/, 'the OFF arm carries the HIDDEN label');
  assert.ok(!/click to remove/.test(SRC), 'the delete-sounding wording is gone');
  // both strings must reach the user through the touch-reachable paths, not just title
  const m = SRC.match(/const t = effective[\s\S]{0,600}?setAttribute\('aria-pressed'[^\n]*\)/);
  assert.ok(m, 'one label source of truth feeds title, aria-label and the pressed state');
  assert.match(m[0], /mbtn\.title = t;/, 'title (pointer devices)');
  assert.match(m[0], /setAttribute\('aria-label', t\)/, 'aria-label (assistive tech)');
  assert.match(m[0], /setAttribute\('aria-pressed', effective \? 'true' : 'false'\)/,
    'the pressed state is exposed AND its arms are bound (slim S-a: swapping them alone survived - a screen reader would announce "Showing in Music, not pressed")');
});

test('v1.268 (slim W2): the optimistic pre-fetch paint seeds the v1.242 DEFAULT (on), not a pessimistic false', () => {
  assert.match(SRC, /let effectiveNow = true;/, 'the seed matches what the server almost always returns');
  assert.match(SRC, /paint\(true\);/, 'so no load flashes a struck-through "Hidden from Music" before the fetch corrects it');
  assert.ok(!/paint\(false\);/.test(SRC), 'the pessimistic paint is gone');
});

test('v1.268: the OFF state is legible WITHOUT hover - a struck-through note, not just a colour shift', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'style.css'), 'utf8');
  assert.match(css, /\.folder-music-toggle:not\(\.is-on\) \{\s*text-decoration: line-through;/,
    'OFF is struck through (a phone has no hover title - colour alone left the state unreadable)');
  assert.match(css, /\.folder-music-toggle\.is-on \{\s*color: var\(--text-link\);/, 'ON stays the link colour');
});
