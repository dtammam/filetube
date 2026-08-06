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
const { pullRefreshState, pullIsHorizontalDrag } = require('../../public/js/common.js');

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

// ---- v1.86.1: pullIsHorizontalDrag (pure) — reject horizontal-scroller swipes -

test('pullIsHorizontalDrag: a horizontal-dominant drag past the slop is rejected', () => {
  assert.strictEqual(pullIsHorizontalDrag(40, 5), true, 'clearly horizontal (avatar-bar swipe)');
  assert.strictEqual(pullIsHorizontalDrag(-40, 5), true, 'direction-agnostic (leftward swipe too)');
  assert.strictEqual(pullIsHorizontalDrag(40, -5), true, 'a slight UPWARD drift during a horizontal swipe is still horizontal');
});

test('pullIsHorizontalDrag: a vertical pull (even with small horizontal jitter) is NOT rejected', () => {
  assert.strictEqual(pullIsHorizontalDrag(5, 40), false, 'clearly vertical -> a real pull');
  assert.strictEqual(pullIsHorizontalDrag(10, 60), false, 'jitter under the vertical travel -> still a pull');
  assert.strictEqual(pullIsHorizontalDrag(0, 0), false, 'no movement yet -> not locked out');
});

test('pullIsHorizontalDrag: the slop stops the first noisy px from axis-locking a vertical pull', () => {
  // A vertical pull that starts with a few px of horizontal drift (dx <= slop)
  // must NOT be rejected even if dx momentarily exceeds dy.
  assert.strictEqual(pullIsHorizontalDrag(8, 3, 12), false, 'dx below the slop -> not yet horizontal-locked');
  assert.strictEqual(pullIsHorizontalDrag(13, 3, 12), true, 'dx past the slop AND > dy -> horizontal');
  // Bad inputs fail safe (treated as 0 -> not horizontal).
  assert.strictEqual(pullIsHorizontalDrag(undefined, undefined), false);
  assert.strictEqual(pullIsHorizontalDrag('40', 5), false, 'a non-number dx is treated as 0');
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
  // v1.47.4 item 3: the release now passes `{ fromPull: true }` so the
  // indicator can enter its released-and-working state; it is still the SAME
  // shared runRescan the button calls.
  assert.match(PTR, /if \(ptrStartY !== null && ptrArmed && ptrIndicator\.isConnected\) runRescan\(\{ fromPull: true \}\)/, 'release-while-armed (and Home live) runs the rescan');
  assert.match(MAIN, /async function runRescan\(opts\)/, 'the rescan is a shared function');
  assert.match(MAIN, /if \(rescanBtn\.disabled\) \{/, 'runRescan still no-ops the SCAN if one is already running');
  assert.match(MAIN, /rescanBtn\.addEventListener\('click', \(\) => runRescan\(\)/, 'the button reuses the same function');
  // Wrapped, not passed bare: a bare listener would deliver the click Event as
  // `opts`, so `fromPull` would be read off a DOM event.
  assert.doesNotMatch(MAIN, /addEventListener\('click', runRescan\b/, 'the click Event must never arrive as opts');
  assert.match(PTR, /pullRefreshState\(pull, PULL_REFRESH_THRESHOLD_PX\)/, 'arms via the pure phase helper');
});

// ---- v1.47.4 item 3: the indicator survives finger-release -----------------
//
// Dean: "if one pulls down from the top and initiates a rescan, the icon stays
// until the rescan is complete. Right now it goes away early." It went away
// early because ptrEnd() called runRescan() and then ptrReset(), which stripped
// the `visible` class immediately -- leaving the scan running with no on-screen
// affordance at all (the Rescan BUTTON's "Scanning..." label is typically
// scrolled off-screen on mobile).

test('PTR item 3: the released-and-working state is driven by the SCAN POLLER, not by finger-release', () => {
  // Raised on release...
  assert.match(MAIN, /function ptrBeginRefreshing\(\)/, 'a begin-refreshing helper exists');
  assert.match(MAIN, /ptrIndicator\.classList\.add\('refreshing'\)/, 'release raises the refreshing state');
  // ...and cleared ONLY where the scan is genuinely known to be over.
  assert.match(MAIN, /function ptrEndRefreshing\(\)/, 'an end-refreshing helper exists');
  const poller = MAIN.slice(MAIN.indexOf('function pollRescanStatus'));
  assert.match(poller, /__filetubeRefreshLibrary[\s\S]*?ptrEndRefreshing\(\)/,
    'the poller clears it only after the scan completes AND the grid is refreshed');
});

test('PTR item 3: ptrReset (finger-release) must NOT clear the refreshing state', () => {
  // This is the actual bug. ptrEnd() calls runRescan() and then ptrReset(); if
  // ptrReset stripped `refreshing` too, the indicator would die on release
  // exactly as before and the fix would silently regress.
  const reset = MAIN.slice(MAIN.indexOf('function ptrReset()'), MAIN.indexOf('function ptrReset()') + 320);
  assert.match(reset, /classList\.remove\('visible', 'ready'\)/, 'it drops the pull-tracking classes');
  assert.doesNotMatch(reset, /refreshing/, 'it must never drop the refreshing state');
});

test('PTR item 3: every path where the scan never starts brings the indicator back down', () => {
  // A raised indicator with no poller behind it would spin forever. Both
  // early-return paths in runRescan (non-ok response, network throw) must clear.
  const runRescanBody = MAIN.slice(MAIN.indexOf('async function runRescan(opts)'), MAIN.indexOf("rescanBtn.addEventListener('click'"));
  const clears = (runRescanBody.match(/ptrEndRefreshing\(\)/g) || []).length;
  assert.ok(clears >= 2, `both failure paths must clear the indicator (found ${clears})`);
});

test('PTR item 3: the refreshing CSS keeps it visible and respects reduced-motion', () => {
  assert.match(CSS, /\.ptr-indicator\.refreshing \{/, 'refreshing-state CSS exists');
  assert.match(CSS, /\.ptr-indicator\.refreshing \{[^}]*opacity: 1/, 'it stays visible after release');
  assert.match(CSS, /\.ptr-indicator\.refreshing \.icon-refresh \{[^}]*animation: spin/, 'it spins while working');
  // The spin is decorative; the VISIBILITY is the information. Reduced-motion
  // must drop only the animation.
  const reduced = CSS.slice(CSS.indexOf('@media (prefers-reduced-motion: reduce) {\n  .ptr-indicator.refreshing'));
  assert.match(reduced, /animation: none/, 'reduced-motion drops the spin');
  assert.doesNotMatch(reduced.slice(0, 200), /opacity: 0|display: none/, 'reduced-motion must NOT hide the indicator');
});

test('PTR (gate CRITICAL fix): the pull path is INERT while Home is cached — guarded by ptrIndicator.isConnected', () => {
  // The window touch listeners are NOT torn down when Home is cached
  // (homeViewCache skips destroy()), so AbortController alone is insufficient —
  // the real guard is that the indicator (a child of the detached cached
  // #view-root) is not connected. Without this, a pull on /music fired a rescan.
  assert.match(PTR, /!ptrIndicator\.isConnected/, 'touchstart bails when Home is not the live (connected) view');
  assert.match(PTR, /ptrArmed && ptrIndicator\.isConnected\) runRescan\(\{ fromPull: true \}\)/, 'release re-checks isConnected before the rescan');
  // Still signal-scoped so a FRESH home init never stacks a second listener set.
  const listeners = (PTR.match(/window\.addEventListener\('touch\w+',[\s\S]*?\{ signal[^}]*\}\)/g) || []);
  assert.ok(listeners.length >= 4, 'touchstart/move/end/cancel all signal-scoped (got ' + listeners.length + ')');
});

test('PTR (gate WARNING fix): dragging back to/above the start point DISARMS (no rescan on release)', () => {
  assert.match(PTR, /if \(pull <= 0\) \{ ptrArmed = false;/, 'the pull<=0 branch clears ptrArmed');
});

test('PTR (v1.86.1, Dean): a HORIZONTAL-dominant drag (avatar bar / chip row) is locked out via pullIsHorizontalDrag', () => {
  // The touchmove must reject horizontal-scroller swipes so the rescan spinner
  // no longer fires while swiping the subscriber circles.
  assert.match(PTR, /pullIsHorizontalDrag\(e\.touches\[0\]\.clientX - ptrStartX, pull\)/,
    'touchmove routes the horizontal-vs-vertical decision through the pure helper');
  assert.match(PTR, /if \(pullIsHorizontalDrag\([^)]*\)\) \{ ptrReset\(\); return; \}/,
    'a horizontal-dominant drag resets (nulls ptrStartY) -> locked out for the rest of the gesture');
  assert.match(PTR, /ptrStartX = e\.touches\[0\]\.clientX/, 'touchstart records the start X the guard needs');
});

test('PTR: the indicator element + its CSS exist', () => {
  assert.match(MAIN, /className = 'ptr-indicator'/, 'indicator created');
  assert.match(CSS, /\.ptr-indicator \{/, 'indicator base CSS');
  assert.match(CSS, /\.ptr-indicator\.ready\b/, 'ready-state CSS');
});
