'use strict';

// [UNIT] v1.133 (Dean's screenshot + ruling, 2026-08-16): two fixes on the
// custom control bar.
//
// 1. CHAPTER-NAME WRAP TRAP: a wrapping flex container breaks lines on each
//    item's HYPOTHETICAL main size (content width clamped by max-width),
//    BEFORE shrinking. The v1.112 mobile rule set `flex: 1 1 auto;
//    max-width: none` on .chapter-now, so a long chapter name presented its
//    full text width to the line-breaker and shoved #fs-btn onto a clipped
//    third row (the v1.34.1 trap re-opened through this one gap; short names
//    fit, which is why it looked healed). Fix: flex-BASIS 0 - the label
//    claims only leftover row space and the base rule's ellipsis truncates.
//
// 2. PREV/NEXT FOR VIDEO, ALWAYS: updateTrackNavButtons' v1.73 audio-only
//    gate is superseded - the pair shows whenever a trackNav context is
//    registered, every kind. The page-level Prev/Next stay (both surfaces
//    read the SAME setTrackNav seam, so they cannot disagree); dock/reader
//    stay CSS-hidden; a single-item context registers no handlers -> hidden.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PLAYER_JS = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'player.js'), 'utf8');
const STYLE_CSS = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'style.css'), 'utf8');

// ---- fix 1: the chapter-name flex basis ------------------------------------

test('mobile chapter-now rule uses flex-basis 0 - the hypothetical-size wrap trap stays sealed', () => {
  assert.match(STYLE_CSS, /#player-slot \.player-controls \.chapter-now \{ order: 4; flex: 1 1 0; max-width: none; \}/,
    'basis auto here re-opens the v1.34.1 third-row clip for long chapter names');
});

test('the base .chapter-now keeps the truncation trio the basis-0 fix relies on', () => {
  // ^-anchored: the scoped mobile override contains the same substring.
  const base = /^\.chapter-now \{([\s\S]*?)\}/m.exec(STYLE_CSS);
  assert.ok(base, '.chapter-now base rule not found');
  assert.match(base[1], /min-width: 0;/);
  assert.match(base[1], /white-space: nowrap;/);
  assert.match(base[1], /text-overflow: ellipsis;/);
});

// ---- fix 2: the pair shows for video ---------------------------------------

test('updateTrackNavButtons: visibility keys on the trackNav registration ALONE (Dean supersedes v1.73)', () => {
  const body = /function updateTrackNavButtons\(\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  assert.ok(body, 'updateTrackNavButtons body not found');
  assert.match(body[1], /var show = !!trackNavHandlers;/, 'one term - re-adding an audio-mode/kind conjunct re-hides the pair for video');
  assert.ok(!/audioMode|autoAdvanceViaTrackNav/.test(body[1]), 'no trace of the v1.73 gate may remain in the body');
  // v1.73 W4 survives the reshape: shown buttons stay enabled so an edge tap
  // still reaches the queue consult.
  assert.match(body[1], /trackPrevBtn\.disabled = false;/);
  assert.match(body[1], /trackNextBtn\.disabled = false;/);
});

test('the mobile button row pins prev | play | next (unordered, both track buttons would sort ahead of play)', () => {
  assert.match(STYLE_CSS, /#player-slot \.player-controls #track-prev-btn \{ order: 0; \}/);
  assert.match(STYLE_CSS, /#player-slot \.player-controls #track-next-btn \{ order: 1; \}/);
  // The tie-break contract the next-button order relies on: play IS order 1
  // in the same scoped block (DOM order puts play first among equals).
  assert.match(STYLE_CSS, /#player-slot \.player-controls #pp-btn \{ order: 1; \}/);
});

test('dock and reader keep the pair hidden via CSS regardless of the new show rule', () => {
  assert.match(STYLE_CSS, /#player-dock #track-prev-btn, #player-dock #track-next-btn,\n\.reader-nowplaying #track-prev-btn, \.reader-nowplaying #track-next-btn \{ display: none; \}/);
  // The [hidden] belt (repo lesson 3: [hidden] loses to any author display
  // rule without this) survives.
  assert.match(STYLE_CSS, /\.track-nav-btn\[hidden\] \{ display: none !important; \}/);
});
