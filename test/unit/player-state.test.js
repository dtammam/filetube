'use strict';

// [UNIT] The pure FULL/DOCKED/CLOSED state-machine decisions extracted from
// the persistent player controller (public/js/player.js, FR-1, T2) and the
// router's `applyPlayerTransition` hook (public/js/common.js) it feeds. The
// DOM-heavy reparent/mount machinery those decisions drive (and the iOS
// reparent behavior itself) is intentionally NOT covered here (no jsdom/
// browser harness in this codebase -- see CONTRIBUTING.md); Dean's on-device
// pass is the arbiter for that.
const { test } = require('node:test');
const assert = require('node:assert');
const { isAdoptLoad, shouldDockOnTransition, nextPlayerState } = require('../../public/js/player.js');
const { shouldDockOnTransition: routerShouldDockOnTransition } = require('../../public/js/common.js');

// ---- isAdoptLoad ------------------------------------------------------------

test('isAdoptLoad: the same id while FULL is an adopt (no-restart reparent)', () => {
  assert.strictEqual(isAdoptLoad('abc', 'abc', 'full'), true);
});

test('isAdoptLoad: the same id while DOCKED is an adopt (dock-tap expand)', () => {
  assert.strictEqual(isAdoptLoad('abc', 'abc', 'docked'), true);
});

test('isAdoptLoad: the same id while CLOSED is NOT an adopt (source was released -- always a fresh load)', () => {
  assert.strictEqual(isAdoptLoad('abc', 'abc', 'closed'), false);
});

test('isAdoptLoad: a different id is never an adopt, regardless of state', () => {
  assert.strictEqual(isAdoptLoad('abc', 'xyz', 'full'), false);
  assert.strictEqual(isAdoptLoad('abc', 'xyz', 'docked'), false);
});

test('isAdoptLoad: nothing currently loaded (null currentId) is never an adopt', () => {
  assert.strictEqual(isAdoptLoad(null, 'abc', 'closed'), false);
});

// ---- shouldDockOnTransition (both the player.js and common.js copies agree) -

test('shouldDockOnTransition: leaving watch for home/setup/subscriptions docks', () => {
  assert.strictEqual(shouldDockOnTransition('watch', 'home'), true);
  assert.strictEqual(shouldDockOnTransition('watch', 'setup'), true);
  assert.strictEqual(shouldDockOnTransition('watch', 'subscriptions'), true);
});

test('shouldDockOnTransition: watch -> watch (a different video) does NOT dock', () => {
  assert.strictEqual(shouldDockOnTransition('watch', 'watch'), false);
});

test('shouldDockOnTransition: leaving a NON-hosting view (home/setup) never docks (nothing to dock FROM)', () => {
  assert.strictEqual(shouldDockOnTransition('home', 'watch'), false);
  assert.strictEqual(shouldDockOnTransition('setup', 'subscriptions'), false);
});

test('shouldDockOnTransition: v1.39.0 -- leaving read (book narration FULL host) docks like watch; read->read does not', () => {
  assert.strictEqual(shouldDockOnTransition('read', 'home'), true);
  assert.strictEqual(shouldDockOnTransition('read', 'books'), true);
  assert.strictEqual(shouldDockOnTransition('read', 'watch'), true);
  assert.strictEqual(shouldDockOnTransition('read', 'read'), false); // same-book/chapter reload adopts, no dock
});

test('shouldDockOnTransition: v1.44 -- leaving music (a track mounts FULL there) docks so the mini-player survives tapping Home; music->music does not', () => {
  assert.strictEqual(shouldDockOnTransition('music', 'home'), true);
  assert.strictEqual(shouldDockOnTransition('music', 'watch'), true);
  assert.strictEqual(shouldDockOnTransition('music', 'settings'), true);
  assert.strictEqual(shouldDockOnTransition('music', 'music'), false); // an in-page re-play adopts, no dock
});

test('shouldDockOnTransition: v1.151 -- leaving a FULL host for STATS docks (Stats is now a route; the mini-player must survive), both copies agree', () => {
  // The user-facing promise of the v1.151 fix: playing something and tapping
  // Stats keeps it playing as the mini-player. That relies on the transition
  // to a 'stats' destination docking, not tearing down. Bind it explicitly so
  // a future destination special-case can't silently regress it.
  for (const dock of [shouldDockOnTransition, routerShouldDockOnTransition]) {
    assert.strictEqual(dock('watch', 'stats'), true);
    assert.strictEqual(dock('music', 'stats'), true);
    assert.strictEqual(dock('read', 'stats'), true);
    assert.strictEqual(dock('podcasts', 'stats'), true);
  }
});

test('nextPlayerState: v1.151 -- watch -> stats docks; stats -> home stays docked; stats -> watch re-adopts; nothing playing stays closed', () => {
  assert.strictEqual(nextPlayerState('watch', 'stats', 'full', true), 'docked');   // tap Stats mid-watch -> mini-player
  assert.strictEqual(nextPlayerState('stats', 'home', 'docked', true), 'docked');  // Stats hosts nothing; keep the dock
  assert.strictEqual(nextPlayerState('stats', 'watch', 'docked', true), 'full');   // back to watch re-adopts full
  assert.strictEqual(nextPlayerState('watch', 'stats', 'closed', true), 'closed'); // nothing playing -> nothing to dock
});

test('shouldDockOnTransition: v1.71 -- leaving podcasts (the expanded now-playing FULL host) docks; podcasts->podcasts does not', () => {
  assert.strictEqual(shouldDockOnTransition('podcasts', 'home'), true);
  assert.strictEqual(shouldDockOnTransition('podcasts', 'watch'), true);
  assert.strictEqual(shouldDockOnTransition('podcasts', 'music'), true);
  assert.strictEqual(shouldDockOnTransition('podcasts', 'podcasts'), false); // the ?play=/?nowplaying= in-place nav adopts, no dock
});

test('shouldDockOnTransition: an unknown/null toView (progressive-enhancement boot has no "from") never docks', () => {
  assert.strictEqual(shouldDockOnTransition('watch', null), false);
  assert.strictEqual(shouldDockOnTransition(null, 'home'), false);
});

test('shouldDockOnTransition: player.js and common.js expose the identical decision (single source of truth)', () => {
  const cases = [
    ['watch', 'home'], ['watch', 'watch'], ['home', 'watch'], ['watch', 'setup'],
    ['watch', 'subscriptions'], ['setup', 'home'], ['watch', null], [null, 'watch'],
    ['read', 'home'], ['read', 'read'], ['read', 'watch'], ['books', 'read'],
    ['music', 'home'], ['music', 'music'], ['music', 'watch'], ['home', 'music'],
    ['podcasts', 'home'], ['podcasts', 'podcasts'], ['podcasts', 'watch'], ['home', 'podcasts'],
  ];
  for (const [from, to] of cases) {
    assert.strictEqual(shouldDockOnTransition(from, to), routerShouldDockOnTransition(from, to));
  }
});

// ---- nextPlayerState ---------------------------------------------------------

test('nextPlayerState: nothing loaded (hasMedia=false) never transitions to docked, regardless of views', () => {
  assert.strictEqual(nextPlayerState('watch', 'home', 'full', false), 'closed');
  assert.strictEqual(nextPlayerState('watch', 'home', 'closed', false), 'closed');
});

test('nextPlayerState: an already-CLOSED controller stays closed even if hasMedia is stale/true', () => {
  assert.strictEqual(nextPlayerState('watch', 'home', 'closed', true), 'closed');
});

test('nextPlayerState: leaving watch while media is loaded docks', () => {
  assert.strictEqual(nextPlayerState('watch', 'home', 'full', true), 'docked');
  assert.strictEqual(nextPlayerState('watch', 'setup', 'full', true), 'docked');
});

test('nextPlayerState: entering/returning to watch while media is loaded ends up full (docked -> full expand, or a fresh watch load once load() has set hasMedia)', () => {
  assert.strictEqual(nextPlayerState('home', 'watch', 'docked', true), 'full');
  assert.strictEqual(nextPlayerState(null, 'watch', 'full', true), 'full');
});

test('nextPlayerState: a fresh watch entry with nothing loaded YET (before load() runs) is closed, not full -- there is no media to be "full" with', () => {
  assert.strictEqual(nextPlayerState(null, 'watch', 'closed', false), 'closed');
});

test('nextPlayerState: watch -> watch (different media) leaves the state unchanged (host stays in the slot)', () => {
  assert.strictEqual(nextPlayerState('watch', 'watch', 'full', true), 'full');
});

test('nextPlayerState: a non-watch -> non-watch transition (e.g. home -> setup) leaves state unchanged', () => {
  assert.strictEqual(nextPlayerState('home', 'setup', 'docked', true), 'docked');
});

// ---- applyAdoptFlavor (v1.253: the listen<->watch mini-bar mapping) ---------
//
// Dean's device repro: watch -> Listen -> "Watch" back -> dock -> the mini-bar
// tap returned to the iPod view. The same-id "Watch" load ADOPTS (pure
// reparent, data deliberately ignored), so currentData kept the listen play's
// readerHref '/music?nowplaying=1' - the return target belonged to whichever
// surface last did a GENUINE load. applyAdoptFlavor is the adopt branch's
// carried-field refresh for the surface-flavor fields (the browseCtx
// precedent): declared-with-value sets, declared-null clears, omitted leaves.
const { applyAdoptFlavor } = require('../../public/js/player.js');

test('applyAdoptFlavor: a declared readerHref/resumeMode REPLACES the stale flavor (watch -> Listen adopt gets the music return target)', () => {
  const cur = { readerHref: undefined, resumeMode: undefined, browseCtx: 'x' };
  applyAdoptFlavor(cur, { readerHref: '/music?nowplaying=1', resumeMode: 'music' });
  assert.strictEqual(cur.readerHref, '/music?nowplaying=1');
  assert.strictEqual(cur.resumeMode, 'music');
  assert.strictEqual(cur.browseCtx, 'x', 'only the flavor fields are touched');
});

test('applyAdoptFlavor: a declared NULL clears the stale flavor (Listen -> "Watch" adopt sheds the music return target - the device repro)', () => {
  const cur = { readerHref: '/music?nowplaying=1', resumeMode: 'music' };
  applyAdoptFlavor(cur, { browseCtx: '', readerHref: null, resumeMode: null });
  assert.strictEqual(cur.readerHref, undefined, 'the mini-bar tap now falls back to /watch.html?v=<id>');
  assert.strictEqual(cur.resumeMode, undefined, 'getCurrentMeta().isMusic no longer lies to the music view');
});

test('applyAdoptFlavor: an OMITTED field leaves the flavor untouched (a partial adopt call owns nothing it does not declare)', () => {
  const cur = { readerHref: '/read.html?b=bk1', resumeMode: 'music' };
  applyAdoptFlavor(cur, { browseCtx: 'ctx-only' });
  assert.strictEqual(cur.readerHref, '/read.html?b=bk1');
  assert.strictEqual(cur.resumeMode, 'music');
});

test('applyAdoptFlavor: null/absent currentData or data is a safe no-op (adopt of nothing, or a data-less call)', () => {
  assert.strictEqual(applyAdoptFlavor(null, { readerHref: null }), null);
  const cur = { readerHref: '/podcasts?nowplaying=1' };
  applyAdoptFlavor(cur, null);
  assert.strictEqual(cur.readerHref, '/podcasts?nowplaying=1');
});

test('applyAdoptFlavor bindings: the adopt branch APPLIES it, and watch.js\'s two adopt-capable load calls stamp the null flavor claim (source lock; comments stripped)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const strip = (f) => fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', f), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const playerSrc = strip('player.js');
  // the adopt branch (between the isAdoptLoad guard's `if (adopt) {` and its
  // `return true;`) must call applyAdoptFlavor(currentData, data) - the pure
  // tests above are vacuous if load() never consults the helper.
  const adoptBranch = /if \(adopt\) \{([\s\S]*?)return true;/.exec(playerSrc);
  assert.ok(adoptBranch, 'the adopt branch exists');
  assert.match(adoptBranch[1], /applyAdoptFlavor\(currentData, data\);/, 'the adopt branch applies the flavor refresh');
  const watchSrc = strip('watch.js');
  const stamps = watchSrc.match(/readerHref: null, resumeMode: null/g) || [];
  assert.strictEqual(stamps.length, 2, 'BOTH adopt-capable watch load calls (the early adopt probe + the full initWatch call) claim the plain-video flavor');
});

// ---- presenceSurfaceForResumeMode (v1.304: the handoff ping's watch/listen) -
//
// A LISTENED video keeps its video extension, so the server cannot tell watch
// from listen - the playing device is the source of truth. This pure helper is
// the field the /api/handoff resolver routes on, so its output IS the modality
// the continue-here button lands in.
const { presenceSurfaceForResumeMode } = require('../../public/js/player.js');

test('presenceSurfaceForResumeMode: music and podcast are LISTEN; tv, plain video, and junk are WATCH', () => {
  assert.strictEqual(presenceSurfaceForResumeMode('music'), 'listen', 'the iPod/music skin + a Listen-a-video');
  assert.strictEqual(presenceSurfaceForResumeMode('podcast'), 'listen');
  assert.strictEqual(presenceSurfaceForResumeMode('tv'), 'watch', 'TV is watched');
  assert.strictEqual(presenceSurfaceForResumeMode(null), 'watch', 'plain video');
  assert.strictEqual(presenceSurfaceForResumeMode(undefined), 'watch', 'no flavor loaded');
  assert.strictEqual(presenceSurfaceForResumeMode(''), 'watch');
  assert.strictEqual(presenceSurfaceForResumeMode('books'), 'watch', 'an unknown mode is never mislabelled listen');
});

test('presenceSurfaceForResumeMode binding: saveProgressToServer STAMPS body.presenceSurface via the helper (not inert; comments stripped)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const playerSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'player.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  // The one ping writer must derive the surface from the loaded item's
  // resumeMode through THIS helper - the pure tests above are vacuous if the
  // ping never carries the field (the INERT-FEATURE guard).
  assert.match(playerSrc, /body\.presenceSurface = presenceSurfaceForResumeMode\(currentData && currentData\.resumeMode\);/,
    'the progress ping stamps presenceSurface from resumeMode');
});

test('v1.304 client-seam tripwire: the listen path routes through loadTrack, which stamps resumeMode "music" (QA suggestion)', () => {
  // The server-side surface tests inject `surface` at the store, so they stay
  // green even if music.js stops stamping resumeMode 'music' for a listened
  // video - at which point the browser silently reverts to sending 'watch' and
  // the handoff regresses to the ORIGINAL bug with no red. This binds the one
  // client fact those tests cannot see (the INERT-FEATURE class, forward-armed).
  const fs = require('node:fs');
  const path = require('node:path');
  const musicSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'music.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  // (a) the track loader stamps the audio surface flavor - the field the ping
  //     reads to send presenceSurface 'listen'.
  assert.match(musicSrc, /resumeMode:\s*'music'/, "loadTrack must stamp resumeMode 'music' for the listening surface");
  // (b) a LISTENED video actually reaches that loader: playListenItem enqueues
  //     and plays through the same queue loader (playAt -> loadTrack), so the
  //     listened video inherits the 'music' flavor and stamps 'listen'.
  assert.match(musicSrc, /async function playListenItem[\s\S]*?playAt\(/,
    'playListenItem plays the listened video through the queue loader that stamps the flavor');
});
