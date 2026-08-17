'use strict';

// [UNIT] v1.141 (Dean): desktop audio fullscreen goes REAL. The v1.22.2
// CSS-only expand exists because iPhone Safari refuses requestFullscreen()
// on non-video elements - a MOBILE constraint that had been applied to every
// platform, so desktop "fullscreen" on an audio item only filled the browser
// window. Now an explicit desktop signal (mobile === false) routes audio to
// 'audio-expand-fullscreen': the v1.138 stage fullscreen AND the expanded
// now-playing view together, one button press; one Esc (or any API exit)
// drops both. Mobile is byte-identical (Dean's intake rulings 2-4).
//
// Posture: pure rows by invocation + source locks (no DOM harness - the
// player-audio-expand.test.js precedent), with the v1.140 census lessons
// applied: every source lock runs on comment-STRIPPED source (the
// comment-shadow class), and spelling-tolerant where a respelling must not
// slip a writer past a lock.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { resolveFsButtonAction } = require('../../public/js/player.js');

// ---- resolveFsButtonAction: the v1.141 three-action table ------------------

test('audio + explicit desktop (mobile === false) -> the combined real-fullscreen action', () => {
  assert.strictEqual(resolveFsButtonAction({ audioMode: true, mobile: false }), 'audio-expand-fullscreen');
});

test('audio + mobile stays the CSS-only expand - byte-identical mobile behavior (Dean ruling 4)', () => {
  assert.strictEqual(resolveFsButtonAction({ audioMode: true, mobile: true }), 'audio-expand');
});

test('audio + ABSENT/undefined mobile signal fails SAFE to the CSS-only expand (only an explicit false unlocks the API path)', () => {
  assert.strictEqual(resolveFsButtonAction({ audioMode: true }), 'audio-expand');
  assert.strictEqual(resolveFsButtonAction({ audioMode: true, mobile: undefined }), 'audio-expand');
  assert.strictEqual(resolveFsButtonAction({ audioMode: true, mobile: 0 }), 'audio-expand', 'falsy-but-not-false must NOT unlock the API path');
});

test('video is untouched by the mobile signal - native-fullscreen on every form factor', () => {
  assert.strictEqual(resolveFsButtonAction({ audioMode: false, mobile: false }), 'native-fullscreen');
  assert.strictEqual(resolveFsButtonAction({ audioMode: false, mobile: true }), 'native-fullscreen');
});

// ---- source locks (comment-stripped - the v1.140 census lesson) ------------

const RAW = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'player.js'), 'utf8');
const SRC = RAW.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '');

test('the ENABLING WIRE: both consult sites pass the live form-factor signal (without it the resolver fail-safes and the wave is inert)', () => {
  // The v1.138 ADV-W1 lesson: bind the wire, not just the branch text. If a
  // call site drops `mobile: isMobileFormFactor()`, the resolver's fail-safe
  // default silently reverts that surface to the in-window expand - Dean's
  // exact pre-wave complaint - with every branch-text lock still green.
  const consults = (SRC.match(/resolveFsButtonAction\(\{ audioMode: host\.classList\.contains\('audio-mode'\), mobile: isMobileFormFactor\(\) \}\)/g) || []).length;
  assert.strictEqual(consults, 2, 'the #fs-btn click handler AND the f/F shortcut both pass { audioMode, mobile }');
});

test('both consult sites route the combined action to toggleAudioExpandFullscreen (click returns, the switch case breaks)', () => {
  assert.match(SRC, /if \(action === 'audio-expand-fullscreen'\) \{\s*toggleAudioExpandFullscreen\(\);\s*return;\s*\}/,
    'the #fs-btn click branch');
  assert.match(SRC, /if \(fsAction === 'audio-expand-fullscreen'\) \{\s*toggleAudioExpandFullscreen\(\);\s*break;\s*\}/,
    'the f/F case branch');
});

test('toggleAudioExpandFullscreen: FULL-only; ENTER arms BOTH halves (the expanded view AND the real Fullscreen API)', () => {
  const m = /function toggleAudioExpandFullscreen\(\) \{([\s\S]*?)\n {2}\}/.exec(SRC);
  assert.ok(m, 'toggleAudioExpandFullscreen found');
  const body = m[1];
  assert.match(body, /state !== STATE_FULL/, 'FULL-only, matching every fullscreen/gesture guard in this file');
  // The enter half: expanded class first, then the API request - deleting
  // either half leaves a broken hybrid ("fullscreen" without the now-playing
  // view, or the pre-wave in-window overlay).
  assert.match(body, /setAudioExpanded\(true\);\s*var pe = enterFullscreen\(\);\s*if \(pe && pe\.catch\) pe\.catch\(function \(\) \{\}\);/,
    'enter = setAudioExpanded(true) + enterFullscreen(), promise-guarded');
});

test('toggleAudioExpandFullscreen: EXIT is total - EITHER live surface drops BOTH (one press, Dean ruling 3)', () => {
  const m = /function toggleAudioExpandFullscreen\(\) \{([\s\S]*?)\n {2}\}/.exec(SRC);
  assert.ok(m, 'toggleAudioExpandFullscreen found');
  const body = m[1];
  // The exit predicate consults BOTH surfaces: a bare staged fullscreen
  // (carried in from a video advance, no expanded class) must also read as
  // "in fullscreen -> this press exits".
  assert.match(body, /if \(host\.classList\.contains\('audio-expanded'\) \|\| inNativeFullscreen\(\)\) \{/,
    'the exit predicate reads either surface');
  assert.match(body, /exitAudioExpand\(\);\s*if \(inNativeFullscreen\(\) && document\.exitFullscreen\) \{/,
    'exit drops the class AND (when native is live) the API fullscreen');
});

test('enterFullscreen: audio NEVER takes the webkit video branch (a track-less element no-ops there silently - the wave-eating trap)', () => {
  const m = /function enterFullscreen\(\) \{([\s\S]*?)\n {2}\}/.exec(SRC);
  assert.ok(m, 'enterFullscreen found');
  const body = m[1];
  assert.match(body, /var audioItem = !!\(currentData && currentData\.type === 'audio'\);/,
    'the audio derivation');
  assert.match(body, /if \(!audioItem && typeof mediaPlayer\.webkitEnterFullscreen === 'function'\) \{/,
    'the webkit branch is gated on NOT-audio - audio falls through to the stage/host requestFullscreen paths');
});

test('leaving native fullscreen clears the expanded view - one Esc lands on the normal page, never a stranded overlay (Dean ruling 3)', () => {
  // The reveal-once two-axes lesson: the ENTER coupling above is one axis;
  // this is the CLEAR axis, and it must key on the class being LIVE (the
  // populate-first rule) - an exit transition with no expanded class is a
  // no-op by construction.
  assert.match(SRC, /if \(!document\.fullscreenElement && host && host\.classList\.contains\('audio-expanded'\)\) \{\s*exitAudioExpand\(\);\s*\}/,
    'a dedicated fullscreenchange listener drops a live expanded view on any API exit');
});

test('applyCarriedImmersive: a video destination NEVER gets the faux class while native (staged) fullscreen is live', () => {
  // Post-wave, desktop expanded+staged advancing to video carries 'audio' ->
  // target video-fs; stamping the MOBILE faux class there would strand the
  // desktop page in faux after the native exit (the staged-exit listener
  // knows nothing of the class). The stage keeps real fullscreen across the
  // advance by itself.
  const m = /function applyCarriedImmersive\(\) \{([\s\S]*?)\n {2}\}/.exec(SRC);
  assert.ok(m, 'applyCarriedImmersive found');
  const body = m[1];
  assert.match(body, /exitAudioExpand\(\);\s*if \(!inNativeFullscreen\(\)\) \{\s*setCssFullscreen\(true\);/,
    'the video-fs branch still drops a carried audio surface, then applies faux ONLY outside native fullscreen');
  // Both axes: the faux application must still exist (mobile carries are the
  // v1.130 headline) - a deleted setCssFullscreen(true) would also match a
  // lazy "never applies faux" spelling.
  assert.match(body, /setCssFullscreen\(true\);/, 'the mobile faux carry survives');
});

// ---- the staged+expanded CSS twin ------------------------------------------

const CSS = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'style.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

test('CSS: the staged twin restores the expanded art-canvas geometry (the v1.138 3-id restore rule would re-cover the bar strip)', () => {
  const m = /#fs-stage:fullscreen #player-wrapper\.audio-mode\.audio-expanded #audio-bg-art\s*\{([^}]*)\}/.exec(CSS);
  assert.ok(m, 'the staged+expanded #audio-bg-art twin exists');
  assert.match(m[1], /bottom:\s*calc\(52px \+ env\(safe-area-inset-bottom,\s*0px\)\)/,
    'same value as the unstaged expanded rule (v1.34.6: the art canvas ends above the bar)');
});
