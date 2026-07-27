'use strict';

// [UNIT] v1.47.4 item 9 -- the Playlists sheet's late-pin layout shift.
//
// Dean: "When I open the phone and then click Playlists after about a half a
// sec all of the pins then load shifting everything up. It's like a FOUC but
// not exactly."
//
// It is not a FOUC. Two stacked causes:
//   1. the pins fetch was CHAINED behind /api/config, so content arrived in two
//      waves one network round-trip apart; and
//   2. the sheet is bottom-anchored, so appending the pinned section grows it
//      UPWARD -- hence "shifting everything up".
//
// These are source-locks rather than a DOM harness: the property that matters
// is structural (the requests are concurrent, and the body renders in exactly
// one pass), and a jsdom test cannot observe a layout shift anyway. Whether the
// shift is actually gone on-device is Dean's pass to confirm.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const COMMON = fs.readFileSync(path.join(__dirname, '../../public/js/common.js'), 'utf8');

function functionBody(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `expected to find ${name}`);
  // Walk braces from the signature's opening brace to its matching close.
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced braces reading ${name}`);
}

const OPEN_SHEET = functionBody(COMMON, 'openPlaylistsSheet');

test('THE FIX: the config and pins requests are CONCURRENT, not chained', () => {
  // The original code did `foldersRendered.then(() => fetch(pins))`, which cost
  // a full extra round-trip before the pinned section could even start loading.
  assert.match(OPEN_SHEET, /Promise\.all\(\[/, 'both requests must be issued together');
  assert.match(OPEN_SHEET, /fetch\('\/api\/config'\)/);
  assert.match(OPEN_SHEET, /fetch\('\/api\/subscriptions\/pins'\)/);
  // The specific regression to prevent: re-introducing a sequential chain where
  // the pins fetch only starts after the folders render resolves.
  assert.doesNotMatch(OPEN_SHEET, /foldersRendered/,
    'the pins fetch must not be chained behind the folders render');
  const configIdx = OPEN_SHEET.indexOf("fetch('/api/config')");
  const pinsIdx = OPEN_SHEET.indexOf("fetch('/api/subscriptions/pins')");
  const promiseAllIdx = OPEN_SHEET.indexOf('Promise.all([');
  assert.ok(promiseAllIdx < configIdx && promiseAllIdx < pinsIdx,
    'both fetches must live INSIDE the Promise.all, not before it');
});

test('THE FIX: the sheet body renders in exactly ONE pass, so it reaches its final height in one layout', () => {
  // renderPlaylistsSheet assigns innerHTML WHOLESALE and renderPinnedPlaylists
  // APPENDS, so order still matters -- that constraint is why the original code
  // chained. It is now satisfied by ordering within a single render pass
  // instead of by delaying the network.
  const render = functionBody(COMMON, 'renderPlaylistsSheetContent');
  const foldersIdx = render.indexOf('renderPlaylistsSheet(');
  const pinsIdx = render.indexOf('renderPinnedPlaylists(');
  assert.ok(foldersIdx !== -1 && pinsIdx !== -1, 'one pass renders both halves');
  assert.ok(foldersIdx < pinsIdx,
    'folders (wholesale innerHTML) must render BEFORE pins (append), or the pins get wiped');
  // The open handler must go through that shared pass, never render half.
  assert.match(OPEN_SHEET, /renderPlaylistsSheetContent\(/);
  assert.doesNotMatch(OPEN_SHEET, /renderPinnedPlaylists\(/,
    'the open path must not render the pinned half on its own');
});

test('a reopen paints cached content SYNCHRONOUSLY, before any await (zero shift on repeat opens)', () => {
  // Dean opens this repeatedly in a session; the cache is what makes every open
  // after the first shift-free, because the sheet animates open already at its
  // final height.
  assert.match(OPEN_SHEET, /if \(playlistsSheetCache\) renderPlaylistsSheetContent\(playlistsSheetCache\);/);
  const cacheRenderIdx = OPEN_SHEET.indexOf('if (playlistsSheetCache) renderPlaylistsSheetContent');
  const promiseAllIdx = OPEN_SHEET.indexOf('Promise.all([');
  assert.ok(cacheRenderIdx < promiseAllIdx,
    'the cached paint must happen before the network work is even started');
});

test('an out-of-order response from a superseded open can never paint', () => {
  // Close-and-reopen while a slow first response is in flight would otherwise
  // let the stale response overwrite the newer one.
  assert.match(OPEN_SHEET, /const generation = \+\+playlistsSheetGeneration;/);
  assert.match(OPEN_SHEET, /if \(generation !== playlistsSheetGeneration\) return;/);
});

test('a failed config fetch does NOT replace already-painted cached content with an error', () => {
  // Showing "Failed to load folders." over a perfectly good cached list would
  // be a downgrade; only a sheet with nothing in it should say so.
  assert.match(OPEN_SHEET, /if \(!playlistsSheetCache\) \{[\s\S]*?Failed to load folders\./);
});

test('the cache stays coherent when pins change elsewhere (unpin)', () => {
  // Without this, unpinning leaves the removed pin in the cache and the next
  // open paints it from cache then visibly drops it -- reintroducing exactly
  // the shift this item removes, on the flow most likely to trigger it.
  const refresh = functionBody(COMMON, 'refreshAllPinSurfaces');
  assert.match(refresh, /playlistsSheetCache = \{ \.\.\.playlistsSheetCache, pins, moduleEnabled: ytdlpEnabled \}/);
  assert.match(refresh, /if \(playlistsSheetCache\)/,
    'only update an EXISTING cache -- never materialize one from a background refresh');
});

test('the sheet still fetches fresh on every open (no stale-forever list)', () => {
  // The cache is a paint-first optimization, not a replacement for fetching.
  // A library change mid-session must still land.
  assert.match(OPEN_SHEET, /Promise\.all\(\[[\s\S]*?fetch\('\/api\/config'\)/,
    'config is re-fetched on every open, not read from cache');
  assert.match(OPEN_SHEET, /playlistsSheetCache = \{/, 'and the fresh payload replaces the cache');
});
