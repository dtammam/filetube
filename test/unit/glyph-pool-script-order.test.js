'use strict';

// ---- v1.77 (QA gate W3): the shell script-order dependency -----------------
//
// v1.77 made common.js hard-depend on glyph-pool.js having already executed:
//   renderPlaylistsSheet          -> resolveFolderGlyphClass
//   applyLibraryGlyphs            -> LIBRARY_GLYPH_SLOTS, resolveLibraryGlyphClass
//   libraryGlyphClassFor          -> LIBRARY_GLYPH_SLOTS
// They are plain globals from a <script> tag, so the tag must be present AND
// earlier than common.js's in every shell.
//
// That is a hand-maintained list across 12 files - the same shape as the 140
// CSS enumerations this wave refused to hand-maintain, and the QA seat rightly
// pointed out the doctrine was applied to one and not the other.
//
// The failure is not hypothetical. Stop C's own commit records six tests dying
// with `ReferenceError: resolveFolderGlyphClass is not defined` the moment a
// harness lacked the registry. In a browser the same omission means: tapping
// Playlists throws out of renderPlaylistsSheet and the sheet renders EMPTY,
// and initLibraryGlyphs throws at boot into an unhandled rejection. Nothing
// else in the suite reads a shell's script tags, so the full suite stays green
// while that page is broken.
//
// The roster is DERIVED - any shell that loads common.js must load the
// registry first - so a shell added later is covered the day it lands.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.join(__dirname, '..', '..');

// Every served HTML shell, wherever it lives (public/ plus the optional
// yt-dlp module's own view, which is a real shell serving the same scripts).
function shellFiles() {
  const out = [];
  for (const dir of [path.join(REPO, 'public'), path.join(REPO, 'lib', 'ytdlp', 'views')]) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.html')) out.push(path.join(dir, f));
    }
  }
  return out;
}

const COMMON_TAG = /<script[^>]+src="\/js\/common\.js"/;
const POOL_TAG = /<script[^>]+src="\/js\/glyph-pool\.js"/;

const CONSUMERS = shellFiles().filter((p) => COMMON_TAG.test(fs.readFileSync(p, 'utf8')));

test('roster sanity: shells loading common.js are found', () => {
  // Without this the two assertions below go vacuous if the tag shape changes.
  assert.ok(CONSUMERS.length >= 12,
    `expected >=12 shells loading common.js, found ${CONSUMERS.length}`);
});

test('every shell that loads common.js also loads glyph-pool.js', () => {
  const missing = CONSUMERS
    .filter((p) => !POOL_TAG.test(fs.readFileSync(p, 'utf8')))
    .map((p) => path.relative(REPO, p));
  assert.deepEqual(missing, [],
    'these shells load common.js without the glyph registry it depends on - the ' +
    'Playlists sheet will render EMPTY and boot will throw:\n' + missing.join('\n'));
});

test('glyph-pool.js is loaded BEFORE common.js in every shell', () => {
  // Present-but-later is just as broken as absent: common.js reads the
  // registry's globals at call time, but initLibraryGlyphs runs on
  // DOMContentLoaded, which a later tag would still beat - and
  // renderPlaylistsSheet could be reached from a cached view swap at any point.
  const wrong = [];
  for (const p of CONSUMERS) {
    const src = fs.readFileSync(p, 'utf8');
    const poolAt = src.search(POOL_TAG);
    const commonAt = src.search(COMMON_TAG);
    if (poolAt === -1) continue; // reported by the test above
    if (poolAt > commonAt) wrong.push(`${path.relative(REPO, p)} (pool at ${poolAt}, common at ${commonAt})`);
  }
  assert.deepEqual(wrong, [],
    'the registry must execute before common.js:\n' + wrong.join('\n'));
});
