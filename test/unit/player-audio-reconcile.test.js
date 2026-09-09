'use strict';

// [UNIT] v1.277 (Dean, iOS music stuck-state): the reliable-signal self-heal for
// the rotate-round-trip that strands a FULL mobile audio player. iOS drops the
// matchMedia 'change' onOrientationChange keys on, so the portrait-collapse never
// fires; the shared host ends up parked in #fs-stage / out of #player-slot / left
// `.audio-expanded`, and the now-playing panel below renders ALONE with no
// transport (Dean's screenshot: "no control over the player"). reconcileAudioSurface
// re-asserts the canonical FULL-in-slot inline surface on resize/pageshow/
// visibilitychange (signals iOS fires reliably on rotation + app-foreground). This
// binds the pure GATE and source-locks the DOM shell + wiring; the on-device feel
// is Dean's arbiter.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { shouldForceInlineAudioOnReconcile } = require('../../public/js/player.js');
const PLAYER_JS = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'player.js'), 'utf8');

// ---- the pure gate: FULL + mobile + audio + PORTRAIT only ----------------------

test('shouldForceInlineAudioOnReconcile is true ONLY for a FULL, mobile, audio player in PORTRAIT', () => {
  const base = { isFull: true, mobile: true, audio: true, landscape: false };
  assert.strictEqual(shouldForceInlineAudioOnReconcile(base), true);
  assert.strictEqual(shouldForceInlineAudioOnReconcile({ ...base, isFull: false }), false, 'not FULL (docked/closed) -> the panel is already hidden; no heal');
  assert.strictEqual(shouldForceInlineAudioOnReconcile({ ...base, mobile: false }), false, 'desktop -> the immersive/rotation surface does not apply');
  assert.strictEqual(shouldForceInlineAudioOnReconcile({ ...base, audio: false }), false, 'video/book on the shared host -> not this bug');
  assert.strictEqual(shouldForceInlineAudioOnReconcile({ ...base, landscape: true }), false, 'LANDSCAPE is the intended immersive overlay -> never forced inline');
});

test('shouldForceInlineAudioOnReconcile fails safe to false on missing/garbage context', () => {
  assert.strictEqual(shouldForceInlineAudioOnReconcile(undefined), false);
  assert.strictEqual(shouldForceInlineAudioOnReconcile({}), false);
  assert.strictEqual(shouldForceInlineAudioOnReconcile({ isFull: 1, mobile: 1, audio: 1, landscape: 0 }), true, 'truthy coercion still resolves');
});

// ---- the DOM reconcile shell (browser-only; source-locked) ----------------------

test('reconcileAudioSurface guards on the pure gate, then undoes stale stage / out-of-slot host / leftover .audio-expanded', () => {
  const m = /function reconcileAudioSurface\(\) \{([\s\S]*?)\n {4}\}/.exec(PLAYER_JS);
  assert.ok(m, 'reconcileAudioSurface() exists');
  const body = m[1];
  assert.match(body, /shouldForceInlineAudioOnReconcile\(\{[\s\S]*?\}\)\)\s*return;/, 'gated on the pure decision (FULL+mobile+audio+portrait), else no-op');
  assert.match(body, /audio:\s*!!\(currentData && currentData\.type === 'audio'\)/, 'the audio axis is the REAL loaded media type');
  assert.match(body, /landscape:\s*!!\(mql && mql\.matches\)/, 'the portrait/landscape axis is the LIVE matchMedia state');
  // 1) stale staged fullscreen -> exit the stage.
  assert.match(body, /if \(stagedFullscreen && document\.fullscreenElement !== fsStageEl\) \{[\s\S]*?placeHostAfterStageExit\(\);/, 'a stale stage (staged but not actually native-fullscreen) is exited');
  // 2) out-of-slot host -> re-seat.
  assert.match(body, /if \(host\.parentNode !== slot\) mountInSlot\(slot\);/, 're-seats a host reparented out of #player-slot');
  // 3) leftover overlay -> drop it.
  assert.match(body, /if \(host\.classList\.contains\('audio-expanded'\)\) setAudioExpanded\(false\);/, 'clears an .audio-expanded the dropped portrait-collapse left behind');
  // the slot it targets is the real #player-slot.
  assert.match(body, /getElementById\('player-slot'\)/, 'the canonical seat is #player-slot');
});

test('the heal is wired to RELIABLE signals (resize + pageshow + visibilitychange), rAF-coalesced - NOT the flaky orientation event', () => {
  assert.match(PLAYER_JS, /window\.addEventListener\('resize', scheduleAudioReconcile\)/, 'resize (iOS fires this reliably on rotation) re-heals');
  assert.match(PLAYER_JS, /window\.addEventListener\('pageshow', scheduleAudioReconcile\)/, 'pageshow catches an app-foreground');
  assert.match(PLAYER_JS, /addEventListener\('visibilitychange', function \(\) \{ if \(!document\.hidden\) scheduleAudioReconcile\(\); \}\)/, 'visibilitychange (visible) catches a foreground with no resize');
  const sched = /function scheduleAudioReconcile\(\) \{([\s\S]*?)\n {4}\}/.exec(PLAYER_JS);
  assert.ok(sched, 'scheduleAudioReconcile() exists');
  assert.match(sched[1], /audioReconcilePending/, 'coalesced with a single pending flag (iOS resize churn cannot thrash it)');
  assert.match(sched[1], /requestAnimationFrame\(/, 'run after a frame so layout/orientation has settled');
});
