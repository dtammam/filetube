'use strict';

// [UNIT] v1.45.8 — pull-to-refresh → rescan. Pure phase helper + source-locks
// for the touch wiring (no browser harness — Dean's on-device pass is the
// arbiter for the actual gesture feel). The load-bearing safety property is
// that it RIDES the native scroll/overscroll and never preventDefaults, so
// normal scrolling + the iOS bounce are untouched.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { pullRefreshState } = require('../../public/js/common.js');

// ---- pullRefreshState (pure) ----------------------------------------------

test('pullRefreshState: no/negative pull is idle', () => {
  assert.strictEqual(pullRefreshState(0, 70), 'idle');
  assert.strictEqual(pullRefreshState(-20, 70), 'idle');
});

test('pullRefreshState: below threshold is pulling, at/above is ready', () => {
  assert.strictEqual(pullRefreshState(1, 70), 'pulling');
  assert.strictEqual(pullRefreshState(69, 70), 'pulling');
  assert.strictEqual(pullRefreshState(70, 70), 'ready');
  assert.strictEqual(pullRefreshState(120, 70), 'ready');
});

test('pullRefreshState: bad inputs fail safe (non-number pull → idle; bad threshold → default 70)', () => {
  assert.strictEqual(pullRefreshState(undefined, 70), 'idle');
  assert.strictEqual(pullRefreshState('80', 70), 'idle', 'a non-number pull is treated as 0');
  assert.strictEqual(pullRefreshState(80, 0), 'ready', 'a 0/garbage threshold falls back to 70 → 80 is ready');
  assert.strictEqual(pullRefreshState(50, -5), 'pulling', 'negative threshold → default 70 → 50 is pulling');
});

// ---- source-locks: the touch wiring ----------------------------------------

const MAIN = fs.readFileSync(path.join(__dirname, '../../public/js/main.js'), 'utf8');
const CSS = fs.readFileSync(path.join(__dirname, '../../public/css/style.css'), 'utf8');

// Slice out just the pull-to-refresh block for focused assertions.
const PTR = MAIN.slice(MAIN.indexOf('const PULL_REFRESH_THRESHOLD_PX'), MAIN.indexOf("window.addEventListener('touchcancel'") + 120);

test('PTR SAFETY-LOCK: the pull handlers NEVER preventDefault — they ride native scroll/overscroll', () => {
  assert.doesNotMatch(PTR, /preventDefault/, 'preventDefault would break normal scrolling / the iOS bounce');
  // Passive listeners make that guarantee explicit (a passive listener CANNOT preventDefault).
  assert.match(PTR, /touchstart[\s\S]*?\{ signal, passive: true \}/, 'touchstart is passive');
  assert.match(PTR, /touchmove[\s\S]*?\{ signal, passive: true \}/, 'touchmove is passive');
});

test('PTR: a pull is only recognized at the very top (scrollY <= 0) and cancels on real scroll', () => {
  assert.match(PTR, /if \(window\.scrollY > 0[^)]*\) \{ ptrStartY = null; return; \}/, 'touchstart bails unless at the top');
  assert.match(PTR, /if \(window\.scrollY > 0\) \{ ptrReset\(\); return; \}/, 'a real scroll mid-pull cancels the gesture');
});

test('PTR: releasing while armed triggers the SAME rescan as the button, guarded against double-fire', () => {
  assert.match(PTR, /if \(ptrStartY !== null && ptrArmed && ptrIndicator\.isConnected\) runRescan\(\)/, 'release-while-armed (and Home live) runs the rescan');
  assert.match(MAIN, /async function runRescan\(\)/, 'the rescan is a shared function');
  assert.match(MAIN, /if \(rescanBtn\.disabled\) return;/, 'runRescan no-ops if a scan is already running');
  assert.match(MAIN, /rescanBtn\.addEventListener\('click', runRescan/, 'the button reuses the same function');
  assert.match(PTR, /pullRefreshState\(pull, PULL_REFRESH_THRESHOLD_PX\)/, 'arms via the pure phase helper');
});

test('PTR (gate CRITICAL fix): the pull path is INERT while Home is cached — guarded by ptrIndicator.isConnected', () => {
  // The window touch listeners are NOT torn down when Home is cached
  // (homeViewCache skips destroy()), so AbortController alone is insufficient —
  // the real guard is that the indicator (a child of the detached cached
  // #view-root) is not connected. Without this, a pull on /music fired a rescan.
  assert.match(PTR, /!ptrIndicator\.isConnected/, 'touchstart bails when Home is not the live (connected) view');
  assert.match(PTR, /ptrArmed && ptrIndicator\.isConnected\) runRescan\(\)/, 'release re-checks isConnected before the rescan');
  // Still signal-scoped so a FRESH home init never stacks a second listener set.
  const listeners = (PTR.match(/window\.addEventListener\('touch\w+',[\s\S]*?\{ signal[^}]*\}\)/g) || []);
  assert.ok(listeners.length >= 4, 'touchstart/move/end/cancel all signal-scoped (got ' + listeners.length + ')');
});

test('PTR (gate WARNING fix): dragging back to/above the start point DISARMS (no rescan on release)', () => {
  assert.match(PTR, /if \(pull <= 0\) \{ ptrArmed = false;/, 'the pull<=0 branch clears ptrArmed');
});

test('PTR: the indicator element + its CSS exist', () => {
  assert.match(MAIN, /className = 'ptr-indicator'/, 'indicator created');
  assert.match(CSS, /\.ptr-indicator \{/, 'indicator base CSS');
  assert.match(CSS, /\.ptr-indicator\.ready\b/, 'ready-state CSS');
});
