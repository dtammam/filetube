'use strict';

// [UNIT] v1.247 (Dean, F2): the mobile skin's MENU/collapse docks the mini-player back on the
// tab you LAUNCHED the player from (dock-to-mini, not close). The core decision is a pure reducer
// (nextPlayerLaunchOrigin) set at the router's navigate() choke: a launch nav (/music|/podcasts +
// ?play=) records the FROM tab; ANY other nav clears it -> an in-view session / notification
// cold-start docks in place. The router isn't boot-testable in jsdom here (bootRouter needs a
// full shell + fetch), so the reducer is bound BEHAVIORALLY and the wiring by source lock -
// the same posture as router-helpers.test.js.
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert');

const { isPlayerLaunchUrl, nextPlayerLaunchOrigin } = require('../../public/js/common.js');
const readSrc = (rel) => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');

// ---- behavioral: the pure decision -----------------------------------------

test('isPlayerLaunchUrl: only /music and /podcasts carrying ?play= are skin launches', () => {
  assert.equal(isPlayerLaunchUrl('/music', '?play=abc'), true);
  assert.equal(isPlayerLaunchUrl('/podcasts', '?season=1&play=ep9'), true, 'play= anywhere in the query');
  assert.equal(isPlayerLaunchUrl('/music', ''), false, 'the plain music tab is NOT a launch');
  assert.equal(isPlayerLaunchUrl('/music', '?folder=jazz'), false, 'browsing music is not a launch');
  assert.equal(isPlayerLaunchUrl('/', '?play=abc'), false, 'home is never a skin launch');
  assert.equal(isPlayerLaunchUrl('/watch.html', '?v=x&play=y'), false, 'the video page is never the skin');
  assert.equal(isPlayerLaunchUrl('/books', '?play=x'), false, 'books keep their reader');
});

test('nextPlayerLaunchOrigin: a launch records the FROM tab; any other nav clears it to null', () => {
  // cross-view launch: MENU should return to the FROM tab (currentViewUrl)
  assert.equal(nextPlayerLaunchOrigin('/music', '?play=t1', '/', 'x'), '/', 'launched from home -> origin home');
  assert.equal(nextPlayerLaunchOrigin('/music', '?play=t1', '/?search=lofi', 'x'), '/?search=lofi', 'launched from a search -> that tab');
  assert.equal(nextPlayerLaunchOrigin('/podcasts', '?play=ep', '/', 'x'), '/', 'a podcast launched from home -> home');
  // no currentViewUrl (early boot) -> the live-location fallback
  assert.equal(nextPlayerLaunchOrigin('/music', '?play=t1', null, '/?root=NES'), '/?root=NES', 'fallback when the router has no from-url yet');
  // any NON-launch navigation clears the origin (in-view session / cold-start docks in place)
  assert.equal(nextPlayerLaunchOrigin('/music', '', '/podcasts', 'x'), null, 'navigating to the plain music tab clears it');
  assert.equal(nextPlayerLaunchOrigin('/', '', '/music', 'x'), null, 'navigating home clears it');
  assert.equal(nextPlayerLaunchOrigin('/podcasts', '?season=1', '/', 'x'), null, 'a non-play podcasts nav clears it');
});

// ---- source locks: the choke, the return, and the three dock call sites -----

test('the router navigate() choke sets the origin via the pure reducer, AFTER the same-URL no-op', () => {
  const src = readSrc('public/js/common.js');
  const nav = src.slice(src.indexOf('function navigate('), src.indexOf('function navigate(') + 2600);
  assert.match(nav, /isSameLocationNav\([\s\S]*?return Promise\.resolve\(\);[\s\S]*?playerLaunchOrigin = nextPlayerLaunchOrigin\(parsed\.pathname, parsed\.search, currentViewUrl,/,
    'the origin is computed by the reducer, and only after the same-URL early-return (a same-tab re-nav never clears it)');
});

test('returnToPlayerOrigin navigates to the stored origin (and is a no-op / dock-in-place when null); both are exposed', () => {
  const src = readSrc('public/js/common.js');
  const body = src.slice(src.indexOf('function returnToPlayerOrigin()'), src.indexOf('function returnToPlayerOrigin()') + 1400);
  assert.match(body, /if \(!playerLaunchOrigin\) return;/, 'no origin -> no-op (dock in place)');
  assert.match(body, /new URL\(playerLaunchOrigin, window\.location\.href\)\.pathname === window\.location\.pathname\) return;/,
    'same-tab origin -> dock in place, not a redundant re-init nav (adversarial SUGGESTION)');
  assert.match(body, /navigate\(playerLaunchOrigin\);/, 'a different-tab origin navigates back to it');
  assert.match(src, /window\.FileTube\.returnToPlayerOrigin = returnToPlayerOrigin;/, 'exposed for the skin views');
  assert.match(src, /window\.FileTube\.playerLaunchOrigin = getPlayerLaunchOrigin;/, 'the getter is exposed');
});

test('the MUSIC skin docks to the origin on BOTH the collapse handle and the iPod MENU', () => {
  // v1.250 (F-UNIFY): both zones route through the ONE dockToOrigin hook - music.js supplies
  // it as the shared engine's onDock, and the engine dispatches [data-skin-collapse] AND the
  // non-list [data-skin-menu] to onDock. Lock BOTH halves of that chain.
  const src = readSrc('public/js/music.js');
  assert.match(src, /function dockToOrigin\(\) \{[\s\S]{0,420}pl\.dock\(\);[\s\S]{0,120}updateNowPlayingPanel\(\);[\s\S]{0,160}if \(window\.FileTube\.returnToPlayerOrigin\) window\.FileTube\.returnToPlayerOrigin\(\);/,
    'dockToOrigin docks, re-renders, then returns to the origin tab');
  assert.match(src, /onDock: dockToOrigin/, 'music supplies dockToOrigin as the engine onDock hook');
  const engine = readSrc('public/js/skin-surface.js');
  assert.match(engine, /data-skin-collapse[\s\S]{0,80}onDock\(\); return;/, 'the engine routes the grab-handle to onDock');
  assert.match(engine, /data-skin-menu[\s\S]{0,220}else \{ onDock\(\); \}/, 'the engine routes MENU (from Now Playing, not list mode) to onDock');
});

test('the PODCAST skin docks to the origin on its onDock hook', () => {
  const src = readSrc('public/js/podcasts.js');
  assert.match(src, /onDock: function \(\)[\s\S]{0,220}pp\.dock\(\)[\s\S]{0,120}updateNowPlayingPanel\(\); if \(window\.FileTube && window\.FileTube\.returnToPlayerOrigin\) window\.FileTube\.returnToPlayerOrigin\(\);/,
    'the podcast skin dock returns to origin');
});
