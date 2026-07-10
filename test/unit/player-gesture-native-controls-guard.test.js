'use strict';

// [UNIT] Mobile-native-controls round: `wireSkipHoldGestures()`
// (public/js/player.js) wires the custom dblclick/touch skip + press-hold-2x
// gesture layer onto whichever surface is the active interaction target
// (`#media-player` for video, `#audio-bg-art` for audio -- see the function's
// own module comment). This round reinstates the NATIVE `controls` strip for
// mobile video while FULL (`applyControlsMode()`, `.native-controls` marker
// class -- see test/unit/player-form-factor.test.js), which means this same
// custom gesture layer can end up wired over the SAME `#media-player` the
// native strip now also controls. v1.22.1 previously retired native controls
// specifically because the (then-unconditional) gesture layer fought the
// native strip's own tap targets, leaving mobile-video users with no
// reliable controls at all -- this round avoids repeating that regression by
// having every gesture handler bail out early whenever `inNativeControlsMode()`
// is true, rather than by removing native controls again. `#audio-bg-art`
// shares this same wiring function, but audio never gets `.native-controls`
// (see applyControlsMode()), so `inNativeControlsMode()` is always false
// there and this guard is inert for audio -- it never suppresses the
// existing audio gesture/tap-to-toggle behavior.
//
// `wireSkipHoldGestures()` is impure (reads/writes live DOM/closure state:
// `el`, `holdTimer`, `state`, etc.) and this codebase has no jsdom/browser
// harness, so -- mirroring test/unit/player-form-factor.test.js's
// `applyControlsMode()` regression lock -- its contract is locked directly
// against its source text instead of by invocation. The on-device feel
// (does the native strip actually stay interactive, does a stray gesture
// still leak through) is Dean's iOS on-device arbiter to confirm.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PLAYER_JS = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'player.js'), 'utf8');
const wireSkipHoldGesturesMatch = /function wireSkipHoldGestures\(el, onSingleTap\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);

test('wireSkipHoldGestures: the function exists and is isolated for inspection', () => {
  assert.ok(wireSkipHoldGesturesMatch, 'expected to find wireSkipHoldGestures()\'s source body in player.js');
});

test('wireSkipHoldGestures: the dblclick handler early-returns under inNativeControlsMode(), before any skip/preventDefault happens', () => {
  const body = wireSkipHoldGesturesMatch[1];
  const dblclickMatch = /el\.addEventListener\(\s*'dblclick',\s*function \(e\) \{([\s\S]*?)\n {4}\}\);/.exec(body);
  assert.ok(dblclickMatch, 'expected a dblclick listener on el');
  assert.match(dblclickMatch[1].trim().split('\n')[0], /if \(inNativeControlsMode\(\)\) return;/, 'expected the dblclick handler\'s very first statement to bail out under inNativeControlsMode()');
});

test('wireSkipHoldGestures: the touchstart handler\'s existing hold/fullscreen bail also fires under inNativeControlsMode() (and still clears holdTimer)', () => {
  const body = wireSkipHoldGesturesMatch[1];
  const touchstartMatch = /el\.addEventListener\(\s*'touchstart',\s*function \(e\) \{([\s\S]*?)\}, \{ passive: true \}\);/.exec(body);
  assert.ok(touchstartMatch, 'expected a touchstart listener on el');
  const touchstartBody = touchstartMatch[1];
  assert.match(touchstartBody, /if \(inNativeFullscreen\(\) \|\| inNativeControlsMode\(\) \|\| e\.touches\.length > 1\) \{/, 'expected inNativeControlsMode() ORed into the existing touchstart bail condition');
  const bailBlockMatch = /if \(inNativeFullscreen\(\) \|\| inNativeControlsMode\(\) \|\| e\.touches\.length > 1\) \{([\s\S]*?)\}/.exec(touchstartBody);
  assert.ok(bailBlockMatch, 'expected the bail branch body');
  assert.match(bailBlockMatch[1], /clearTimeout\(holdTimer\);/, 'expected the bail branch to still clear holdTimer');
  assert.match(bailBlockMatch[1], /releaseHold\(\);/, 'expected the bail branch to still call releaseHold()');
});

test('wireSkipHoldGestures: the touchend handler early-returns under inNativeControlsMode(), before clearing holdTimer or classifying the tap', () => {
  const body = wireSkipHoldGesturesMatch[1];
  const touchendMatch = /el\.addEventListener\(\s*'touchend',\s*function \(e\) \{([\s\S]*?)\n {4}\}, \{ passive: false \}\);/.exec(body);
  assert.ok(touchendMatch, 'expected a touchend listener on el');
  const touchendBody = touchendMatch[1];
  assert.match(touchendBody.trim().split('\n')[0], /if \(inNativeControlsMode\(\)\) return;/, 'expected the touchend handler\'s very first statement to bail out under inNativeControlsMode()');
});

test('wireSkipHoldGestures: touchmove/touchcancel are untouched by this round (no inNativeControlsMode() reference) -- harmless no-ops when native controls suppressed touchstart from ever arming holdTimer', () => {
  const body = wireSkipHoldGesturesMatch[1];
  const touchmoveMatch = /el\.addEventListener\(\s*'touchmove',\s*function \(e\) \{([\s\S]*?)\}, \{ passive: true \}\);/.exec(body);
  const touchcancelMatch = /el\.addEventListener\(\s*'touchcancel',\s*function \(\) \{([\s\S]*?)\}, \{ passive: true \}\);/.exec(body);
  assert.ok(touchmoveMatch, 'expected a touchmove listener on el');
  assert.ok(touchcancelMatch, 'expected a touchcancel listener on el');
  assert.ok(!/inNativeControlsMode/.test(touchmoveMatch[1]), 'touchmove was not part of this round\'s guard list -- must stay unmodified');
  assert.ok(!/inNativeControlsMode/.test(touchcancelMatch[1]), 'touchcancel was not part of this round\'s guard list -- must stay unmodified');
});

test('inNativeControlsMode: inert for audio -- applyControlsMode() only ever adds `.native-controls` inside the mobile+video+FULL branch, never for audio', () => {
  const applyControlsModeMatch = /function applyControlsMode\(\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  assert.ok(applyControlsModeMatch, 'expected to find applyControlsMode()\'s source body in player.js');
  const nativeBranchMatch = /if \(native\) \{([\s\S]*?)\} else \{/.exec(applyControlsModeMatch[1]);
  assert.ok(nativeBranchMatch, 'expected an if (native) branch in applyControlsMode');
  assert.match(nativeBranchMatch[1], /host\.classList\.add\(\s*['"]native-controls['"]\s*\)/, 'expected .native-controls to only be added inside the native branch (gated on isVideo, which excludes audio)');
});
