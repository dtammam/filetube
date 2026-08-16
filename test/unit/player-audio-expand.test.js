'use strict';

// [UNIT] FR-1 (T1, v1.22.2): audio "fullscreen" -- a CSS full-viewport
// "expanded now-playing" view for AUDIO playback, driven by REUSING the
// existing `#fs-btn` (never the browser Fullscreen API, which iPhone Safari
// refuses on non-video elements -- exactly why v1.22.1 FR-2 hid the
// mobile-audio `#fs-btn` in the first place). See the exec plan's
// "## Design (FR-1)" (docs/exec-plans/completed/2026-07-07-v1.22.2-audio-
// fullscreen.md).
//
// `resolveFsButtonAction` is the pure decision seam: `.audio-mode` ->
// `'audio-expand'` (toggles `#player-wrapper.audio-expanded`, T2's CSS
// overlay), else `'native-fullscreen'` (the EXISTING, byte-identical video
// Fullscreen-API block). `toggleAudioExpand()`/`exitAudioExpand()` are
// impure (they read/write live DOM: `host`, `state`) and this codebase has
// no jsdom/browser harness, so -- mirroring test/unit/player-form-
// factor.test.js's own `applyControlsMode` regression-lock posture -- their
// contract (and the live `#fs-btn` handler's branch) is locked directly
// against the `public/js/player.js` source text instead of by invocation.
// The visual "does it actually fill the screen and restore cleanly" feel
// (AC2/AC3/AC9) is NOT covered here -- no headless/E2E infra
// (docs/RELIABILITY.md); Dean's iPhone on-device pass is the documented
// arbiter.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { resolveFsButtonAction } = require('../../public/js/player.js');

// ---- resolveFsButtonAction (pure) ------------------------------------------

test('resolveFsButtonAction: audioMode true routes to the CSS-expand path', () => {
  assert.strictEqual(resolveFsButtonAction({ audioMode: true }), 'audio-expand');
});

test('resolveFsButtonAction: audioMode false routes to the existing native-Fullscreen-API path', () => {
  assert.strictEqual(resolveFsButtonAction({ audioMode: false }), 'native-fullscreen');
});

test('resolveFsButtonAction: a falsy/missing audioMode signal (e.g. video, no `.audio-mode` class) defaults to native-fullscreen', () => {
  assert.strictEqual(resolveFsButtonAction({}), 'native-fullscreen');
  assert.strictEqual(resolveFsButtonAction(), 'native-fullscreen');
  assert.strictEqual(resolveFsButtonAction({ audioMode: undefined }), 'native-fullscreen');
});

test('resolveFsButtonAction: only ever returns one of the two documented action strings', () => {
  assert.ok(['audio-expand', 'native-fullscreen'].includes(resolveFsButtonAction({ audioMode: true })));
  assert.ok(['audio-expand', 'native-fullscreen'].includes(resolveFsButtonAction({ audioMode: false })));
});

// ---- source-level regression locks (no DOM harness -- see module comment) --

const PLAYER_JS = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'player.js'), 'utf8');

// Isolate the #fs-btn click handler's own callback body (the `if (fsBtn) {
// fsBtn.addEventListener('click', function () { ... }); }` block) so the
// assertions below are scoped to exactly the code this FR is allowed to
// touch, not the whole file.
const fsBtnHandlerMatch = /if \(fsBtn\) \{\s*fsBtn\.addEventListener\('click', function \(\) \{([\s\S]*?)\n {6}\}\);\s*\n {4}\}/.exec(PLAYER_JS);

test('#fs-btn click handler: the source block is found and isolated for inspection', () => {
  assert.ok(fsBtnHandlerMatch, 'expected to find the #fs-btn click handler\'s source body in player.js');
});

test('#fs-btn click handler: branches on resolveFsButtonAction({ audioMode: ... }) before doing anything else', () => {
  const body = fsBtnHandlerMatch[1];
  assert.match(
    body,
    /resolveFsButtonAction\(\{\s*audioMode:\s*host\.classList\.contains\('audio-mode'\)\s*\}\)/,
    'expected the handler to call resolveFsButtonAction({ audioMode: host.classList.contains(\'audio-mode\') })'
  );
});

test('#fs-btn click handler: the audio-expand branch calls toggleAudioExpand() and returns without touching the native path', () => {
  const body = fsBtnHandlerMatch[1];
  assert.match(
    body,
    /if \(action === 'audio-expand'\) \{\s*toggleAudioExpand\(\);\s*return;\s*\}/,
    'expected an `if (action === \'audio-expand\') { toggleAudioExpand(); return; }` early branch'
  );
});

test('#fs-btn click handler: the native-fullscreen branch is present and byte-identical to the pre-FR-1 video path', () => {
  const body = fsBtnHandlerMatch[1];
  // The exact block this handler unconditionally ran BEFORE this FR --
  // copied verbatim inside the new branch (AC4: video fullscreen stays
  // byte-identical). Any edit to this exact text is a regression.
  const nativeBlock =
    "if (inNativeFullscreen()) {\n" +
    "          if (document.exitFullscreen) {\n" +
    "            var pe = document.exitFullscreen();\n" +
    "            if (pe && pe.catch) pe.catch(function () {});\n" +
    "          } else if (mediaPlayer.webkitExitFullscreen) {\n" +
    "            mediaPlayer.webkitExitFullscreen();\n" +
    "          }\n" +
    "        } else {\n" +
    "          var pf = enterFullscreen();\n" +
    "          if (pf && pf.catch) pf.catch(function () {});\n" +
    "        }";
  assert.ok(body.includes(nativeBlock), 'expected the native-fullscreen enter/exit block to be byte-identical to the pre-FR-1 handler body');
});

// ---- enterFullscreen()/inNativeFullscreen() -- untouched by this FR --------

test('enterFullscreen: still routes iOS through webkitEnterFullscreen; desktop stage-first with the host fallback (v1.138) -- audio-expand untouched', () => {
  const enterFullscreenMatch = /function enterFullscreen\(\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  assert.ok(enterFullscreenMatch, 'expected to find enterFullscreen() in player.js');
  const body = enterFullscreenMatch[1];
  assert.match(body, /mediaPlayer\.webkitEnterFullscreen\(\)/);
  assert.match(body, /target\.requestFullscreen\(\)/);
  assert.ok(!/audio-expand/.test(body), 'enterFullscreen() must never reference the audio-expand path -- video fullscreen stays byte-identical');
});

test('inNativeFullscreen: single-expression definition incl. the v1.138 staged clause (no audio-expand branch added)', () => {
  const inNativeFullscreenMatch = /function inNativeFullscreen\(\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  assert.ok(inNativeFullscreenMatch, 'expected to find inNativeFullscreen() in player.js');
  const body = inNativeFullscreenMatch[1];
  assert.match(body, /document\.fullscreenElement/);
  assert.match(body, /mediaPlayer\.webkitDisplayingFullscreen/);
  assert.ok(!/audio-expanded/.test(body), 'inNativeFullscreen() must stay independent of the audio-expanded class');
});

// ---- toggleAudioExpand / exitAudioExpand (FULL-only, force-clear sites) ----

// v1.120: toggleAudioExpand / exitAudioExpand now route through the ONE
// setAudioExpanded(on) setter (which owns the class + aria + body freeze/black
// belt + the auto-hide cycle). These bind the new structure.
test('toggleAudioExpand: FULL-only guard, routes through setAudioExpanded(toggle)', () => {
  const toggleMatch = /function toggleAudioExpand\(\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  assert.ok(toggleMatch, 'expected to find toggleAudioExpand() in player.js');
  const body = toggleMatch[1];
  assert.match(body, /state !== STATE_FULL/, 'expected a FULL-only guard, matching every other fullscreen/gesture guard in this file');
  assert.match(body, /setAudioExpanded\(!host\.classList\.contains\('audio-expanded'\)\)/, 'expected it to route through setAudioExpanded with the toggled value');
});

test('setAudioExpanded: toggles the class, reflects aria-pressed (a11y), and freezes/blacks the body', () => {
  const m = /function setAudioExpanded\(on\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  assert.ok(m, 'expected to find setAudioExpanded(on) in player.js');
  const body = m[1];
  assert.match(body, /host\.classList\.toggle\('audio-expanded', !!on\)/, 'sets the expanded class from the bool');
  assert.match(body, /fsBtn\.setAttribute\('aria-pressed', on \? 'true' : 'false'\)/, "reflects the state on #fs-btn's aria-pressed");
  assert.match(body, /document\.body\.classList\.toggle\('ft-audio-expanded', !!on\)/, 'toggles the body freeze/black belt');
  // Drives the SAME auto-hide cycle as video faux fullscreen.
  assert.match(body, /if \(on\) revealControlsAndReArm\(\);\s*\n\s*else \{ clearControlsAutoHide\(\); showControlsBar\(\); \}/, 'drives the control-bar auto-hide cycle');
});

test('exitAudioExpand: unconditionally collapses via setAudioExpanded(false) (no state guard -- safe from any lifecycle exit)', () => {
  const exitMatch = /function exitAudioExpand\(\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  assert.ok(exitMatch, 'expected to find exitAudioExpand() in player.js');
  const body = exitMatch[1];
  assert.match(body, /setAudioExpanded\(false\)/, 'expected exitAudioExpand() to force-collapse via setAudioExpanded(false)');
  assert.ok(!/state !== STATE_FULL/.test(body), 'no state guard -- must be safe to call from any lifecycle exit');
});

test('teardownMediaState: force-clears the expanded state on every genuine new load (AC5; v1.130 carves out ONLY a carried immersive continuation)', () => {
  const teardownMatch = /function teardownMediaState\(opts\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  assert.ok(teardownMatch, 'expected to find teardownMediaState() in player.js');
  // v1.130 immersive carry-on-advance: the AC5 drop is now gated on the
  // per-load carry snapshot -- a NON-carried load (every fresh pick, and
  // every load whose arm/live-class capture came back null) still clears.
  // Locking the GATED spelling (not the bare call) means both hard-wiring
  // the drop back on (breaking the carry) and deleting it outright
  // (breaking AC5) go red here.
  assert.match(teardownMatch[1], /if \(!preserveImmersive\) exitAudioExpand\(\);/, 'expected teardownMediaState() to call exitAudioExpand() gated only by the v1.130 carry');
});

test('dock: force-clears the expanded state before docking (AC5 -- never dock a fixed-overlay expanded wrapper)', () => {
  const dockMatch = /function dock\(\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  assert.ok(dockMatch, 'expected to find dock() in player.js');
  assert.match(dockMatch[1], /exitAudioExpand\(\)\s*;/, 'expected dock() to call exitAudioExpand()');
});

test('close: force-clears the expanded state before closing (AC5 -- never leave a closed host expanded for a future re-open)', () => {
  const closeMatch = /function close\(\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  assert.ok(closeMatch, 'expected to find close() in player.js');
  assert.match(closeMatch[1], /exitAudioExpand\(\)\s*;/, 'expected close() to call exitAudioExpand()');
});

// ---- desktop f/F shortcut -- gate-round fix: routes through the SAME branch
// as the #fs-btn click handler, so the two "fullscreen audio" affordances
// never diverge ------------------------------------------------------------

// Isolate the `case 'f': case 'F': { ... }` block inside the existing
// FULL-only shortcut switch, scoping assertions to exactly the code this fix
// is allowed to touch.
function extractShortcutSwitchBody() {
  const wireMatch = /function wireHostListeners\(\) \{([\s\S]*?)\n {2}\}\n\n {2}\/\/ ---- per-media setup/.exec(PLAYER_JS);
  assert.ok(wireMatch, 'expected to find wireHostListeners() in player.js');
  const shortcutSwitchMatch = /switch \(e\.key\) \{([\s\S]*?)\n {6}\}/.exec(wireMatch[1]);
  assert.ok(shortcutSwitchMatch, 'expected to find the existing FULL-only shortcut switch');
  return shortcutSwitchMatch[1];
}

const fCaseMatch = /case 'f':\s*case 'F': \{([\s\S]*?)\n {8}\}/.exec(extractShortcutSwitchBody());

test('f/F shortcut: the case block is found and isolated for inspection', () => {
  assert.ok(fCaseMatch, 'expected to find the case \'f\': case \'F\': { ... } block in the shortcut switch');
});

test('f/F shortcut: branches on resolveFsButtonAction({ audioMode: ... }) before doing anything else', () => {
  const body = fCaseMatch[1];
  assert.match(
    body,
    /resolveFsButtonAction\(\{\s*audioMode:\s*host\.classList\.contains\('audio-mode'\)\s*\}\)/,
    'expected the f/F case to call resolveFsButtonAction({ audioMode: host.classList.contains(\'audio-mode\') }), same as the #fs-btn click handler'
  );
});

test('f/F shortcut: the audio-expand branch calls toggleAudioExpand() and breaks without touching the video path', () => {
  const body = fCaseMatch[1];
  assert.match(
    body,
    /if \(fsAction === 'audio-expand'\) \{\s*toggleAudioExpand\(\);\s*break;\s*\}/,
    'expected an `if (fsAction === \'audio-expand\') { toggleAudioExpand(); break; }` early branch'
  );
});

test('f/F shortcut: the video-fullscreen tail is present and byte-identical to the pre-fix path', () => {
  const body = fCaseMatch[1];
  // The exact block this case unconditionally ran BEFORE this fix -- must
  // remain untouched (video f/F behavior stays byte-identical).
  const videoTail =
    "if (document.fullscreenElement) {\n" +
    "            document.exitFullscreen();\n" +
    "          } else {\n" +
    "            // FR-2 (T2, v1.21.0): retargeted through enterFullscreen() --\n" +
    "            // desktop now goes fullscreen on .player-container (host), not\n" +
    "            // the bare <video>, so the custom bar is visible while fullscreen.\n" +
    "            var p3 = enterFullscreen();\n" +
    "            if (p3 && p3.catch) p3.catch(function () {});\n" +
    "          }";
  assert.ok(body.includes(videoTail), 'expected the video-fullscreen enter/exit block to be byte-identical to the pre-fix f/F case body');
});

test('f/F shortcut: the focused-BUTTON early-return guarding the whole shortcut switch is unchanged', () => {
  const wireMatch = /function wireHostListeners\(\) \{([\s\S]*?)\n {2}\}\n\n {2}\/\/ ---- per-media setup/.exec(PLAYER_JS);
  assert.ok(wireMatch);
  assert.match(
    wireMatch[1],
    /\['INPUT', 'TEXTAREA', 'BUTTON', 'SELECT', 'A'\]\.indexOf\(tag\) !== -1/,
    'expected the pre-existing focused-BUTTON (and other form-control) early-return to still guard the shortcut switch'
  );
});

// ---- desktop Escape exit affordance -- kept separate from the f/F switch ---

test('desktop Escape exit: a SEPARATE keydown listener (not folded into the existing FULL-only shortcut switch), scoped to FULL + expanded', () => {
  // Isolate wireHostListeners()'s source body to keep this assertion scoped.
  const wireMatch = /function wireHostListeners\(\) \{([\s\S]*?)\n {2}\}\n\n {2}\/\/ ---- per-media setup/.exec(PLAYER_JS);
  assert.ok(wireMatch, 'expected to find wireHostListeners() in player.js');
  const body = wireMatch[1];
  // The existing FULL-only shortcut switch keeps its own `f`/`F` case
  // untouched -- no `case 'Escape'` was added to it.
  const shortcutSwitchMatch = /switch \(e\.key\) \{([\s\S]*?)\n {6}\}/.exec(body);
  assert.ok(shortcutSwitchMatch, 'expected to find the existing FULL-only shortcut switch');
  assert.ok(!/case 'Escape'/.test(shortcutSwitchMatch[1]), 'Escape must NOT be folded into the existing f/F shortcut switch (that switch early-returns on a focused BUTTON, i.e. #fs-btn itself)');
  // A second, dedicated keydown listener exists, scoped to
  // FULL + audio-expanded, that calls exitAudioExpand() on Escape.
  const afterSwitch = body.slice(shortcutSwitchMatch.index + shortcutSwitchMatch[0].length);
  assert.match(afterSwitch, /document\.addEventListener\('keydown', function \(e\) \{/, 'expected a second, dedicated keydown listener after the shortcut switch');
  const secondListenerMatch = /document\.addEventListener\('keydown', function \(e\) \{([\s\S]*?)\n {4}\}\);/.exec(afterSwitch);
  assert.ok(secondListenerMatch, 'expected to isolate the second keydown listener\'s body');
  const secondBody = secondListenerMatch[1];
  assert.match(secondBody, /state !== STATE_FULL/, 'expected the Escape listener to be FULL-only');
  assert.match(secondBody, /audio-expanded/, 'expected the Escape listener to check the audio-expanded class');
  assert.match(secondBody, /exitAudioExpand\(\)/, 'expected the Escape listener to call exitAudioExpand()');
});

// ---- exported surface -------------------------------------------------------

test('module.exports: exposes resolveFsButtonAction for node:test (no DOM/browser harness needed)', () => {
  const playerModule = require('../../public/js/player.js');
  assert.strictEqual(typeof playerModule.resolveFsButtonAction, 'function');
});

// ---- T2 CSS overlay contract (style.css) -- gate-round fixes ---------------
// The DOM-level toggling above is only half the contract: `style.css` is what
// actually makes `.audio-expanded` fill the viewport. These lock in the three
// gate-round CSS fixes as source-level regressions (no headless/E2E infra --
// see module comment).

const CSS_PATH = path.join(__dirname, '..', '..', 'public', 'css', 'style.css');
const CSS = fs.readFileSync(CSS_PATH, 'utf8');
const overlayRuleMatch = /#player-wrapper\.audio-mode\.audio-expanded\s*\{([^}]*)\}/.exec(CSS);
// v1.120: require the body to contain `bottom: 0` so this picks the actual bar
// LAYOUT rule, not the (earlier) reduced-motion `{ transition: none }` rule that
// now also carries this selector.
const controlsRuleMatch = /#player-wrapper\.audio-mode\.audio-expanded \.player-controls\s*\{([^}]*bottom:\s*0[^}]*)\}/.exec(CSS);

test('CSS overlay rule: the #player-wrapper.audio-mode.audio-expanded rule is found and isolated for inspection', () => {
  assert.ok(overlayRuleMatch, 'expected to find the #player-wrapper.audio-mode.audio-expanded rule in style.css');
});

test('CRITICAL FIX -- CSS overlay rule: max-height: none overrides the mobile-portrait 45vh .player-container cap so the expand truly fills the viewport on a phone', () => {
  assert.match(overlayRuleMatch[1], /max-height:\s*none\s*;/, 'expected max-height: none, overriding the pre-existing portrait `.player-container { max-height: 45vh }` rule (same node as #player-wrapper)');
});

test('WARNING FIX -- CSS overlay rule: z-index sits above the app chrome but below the modal/toast tiers (Tier 4 re-ladder: token spelling + ordering asserted from the ladder definitions)', () => {
  // Tier 4 batch 4d (2026-07-31): 1100 -> var(--z-player-max). The ordering
  // semantics stay BOUND, not just spelled: the rung values are read from
  // the :root ladder definitions (token-scale-lock.test.js is the byte-exact
  // authority that those definitions carry the contract values).
  assert.match(overlayRuleMatch[1], /z-index:\s*var\(--z-player-max\)\s*;/,
    'expected the overlay to ride the --z-player-max rung');
  const zdef = (name) => {
    const m = new RegExp(name + ':\\s*(\\d+);').exec(CSS);
    assert.ok(m, `expected a :root definition for ${name}`);
    return Number(m[1]);
  };
  assert.ok(zdef('--z-player-max') > zdef('--z-header'), 'expected the overlay rung above the site header rung');
  assert.ok(zdef('--z-player-max') < zdef('--z-modal'), 'expected the overlay rung below the modal tier so async toasts/modals stay visible');
});

test('WARNING FIX -- CSS overlay rule: position/inset stay full-viewport (unchanged by the max-height/z-index fixes)', () => {
  assert.match(overlayRuleMatch[1], /position:\s*fixed\s*;/);
  assert.match(overlayRuleMatch[1], /inset:\s*0\s*;/);
});

test('SUGGESTION FIX -- CSS: the expanded control bar clears the bottom safe-area (iPhone home-indicator) without touching the normal in-slot/docked bar', () => {
  assert.ok(controlsRuleMatch, 'expected a #player-wrapper.audio-mode.audio-expanded .player-controls rule scoped to only the expanded overlay');
  // v1.34.6 (Dean): the bar is FLUSH to the true bottom edge now -- the
  // safe-area allowance lives INSIDE the bar as padding (the old bottom
  // lift left a black gap strip under it).
  assert.match(controlsRuleMatch[1], /bottom:\s*0\s*;/, 'the expanded bar sits flush at the bottom edge');
  // Step 3 opener (2026-07-31): the 4px member adopted var(--space-2) -
  // token-scale-lock.test.js is the byte-exact authority that
  // --space-2 == 4px, so this spelling lock stays bound to reality.
  assert.match(controlsRuleMatch[1], /padding-bottom:\s*calc\(var\(--space-2\) \+ env\(safe-area-inset-bottom,\s*0px\)\)\s*;/, 'safe-area clearance is internal padding');
  // The base `.player-controls` rule (unscoped) must stay untouched -- this
  // fix is scoped ONLY to the expanded overlay's bar.
  const baseControlsMatch = /(?:^|\n)\.player-controls\s*\{([^}]*)\}/.exec(CSS);
  assert.ok(baseControlsMatch, 'expected to find the base .player-controls rule');
  assert.ok(!/safe-area-inset-bottom/.test(baseControlsMatch[1]), 'the base .player-controls rule must not itself reference the safe-area inset -- that must stay scoped to .audio-expanded only');
});

// ---- v1.120 (Dean): audio-expanded parity CSS (bleed belt + body freeze) -----

test('CSS: the audio-expanded overlay covers the visual viewport (dvh/dvw belt) + body freezes/blacks', () => {
  assert.ok(overlayRuleMatch, 'the audio-expanded overlay rule');
  assert.match(overlayRuleMatch[1], /height:\s*100vh;\s*height:\s*100dvh;/, 'height pins to the visual viewport (dvh, vh fallback) -- iOS-landscape bleed belt');
  assert.match(overlayRuleMatch[1], /width:\s*100vw;\s*width:\s*100dvw;/, 'width pins to the visual viewport');
  assert.match(CSS, /body\.ft-audio-expanded \{[^}]*overflow:\s*hidden;[^}]*background:\s*#000;/, 'body freezes scroll + paints black as the bleed belt');
});

test('CSS: when the audio bar auto-hides, the cover art reclaims its reserved strip (bottom:0)', () => {
  assert.match(CSS, /#player-wrapper\.audio-mode\.audio-expanded\.controls-autohidden #audio-bg-art \{\s*bottom:\s*0;/,
    'a hidden audio bar lets the cover art fill to the true bottom edge');
});
