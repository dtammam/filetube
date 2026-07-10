'use strict';

// [UNIT] v1.26.4: fix for the frozen audio-CC overlay Dean hit on-device
// (iPhone) -- audio-mode captions rendered the FIRST line then never
// advanced. Root cause: iOS WebKit does not reliably fire `cuechange` on a
// TextTrack whose `mode` is 'hidden' during ACTIVE playback (documented:
// Apple Developer Forums thread 704536; video.js issue #7417) -- exactly
// the mode public/js/player.js's audio-mode overlay uses. None of the
// functions/listeners touched here are pure/exported (they live inside the
// DOM-only IIFE guarded by `if (typeof window === 'undefined' ...) return;`
// -- see player.js's own module-level guard), and this codebase has no
// jsdom/browser harness for player.js -- so, mirroring the existing
// precedent at test/unit/player-hardening.test.js and
// test/unit/player-gesture-native-controls-guard.test.js, their contracts
// are locked directly against source text rather than by invocation. Dean's
// on-device iOS pass remains the documented arbiter for actual runtime
// behavior.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PLAYER_JS = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'player.js'), 'utf8');

// ---------------------------------------------------------------------------
// Part 1: idempotent render guard (renderActiveCueOverlay / hideCaptionOverlay)
// ---------------------------------------------------------------------------

const renderActiveCueOverlayMatch = /function renderActiveCueOverlay\(track\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
const hideCaptionOverlayMatch = /function hideCaptionOverlay\(\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);

test('renderActiveCueOverlay() and hideCaptionOverlay() exist and are isolated for inspection', () => {
  assert.ok(renderActiveCueOverlayMatch, 'expected to find renderActiveCueOverlay()\'s source body in player.js');
  assert.ok(hideCaptionOverlayMatch, 'expected to find hideCaptionOverlay()\'s source body in player.js');
});

test('a module-level lastCcOverlayText guard exists, initialized to null, near audioCaptionsOn', () => {
  assert.match(PLAYER_JS, /var audioCaptionsOn = false;/);
  assert.match(PLAYER_JS, /var lastCcOverlayText = null;/);
});

test('renderActiveCueOverlay() bails BEFORE touching the DOM when the computed text matches the last painted text', () => {
  const body = renderActiveCueOverlayMatch[1];
  assert.match(
    body,
    /if \(text === lastCcOverlayText\) return;/,
    'expected an idempotent early-return comparing the freshly computed text against lastCcOverlayText'
  );
  // The guard must appear AFTER computing `text` but BEFORE either DOM branch.
  const guardIndex = body.indexOf('if (text === lastCcOverlayText) return;');
  const computeIndex = body.indexOf('buildCaptionOverlayText(rawTexts)');
  const hiddenBranchIndex = body.indexOf('ccOverlayEl.hidden = false;');
  assert.ok(computeIndex > -1 && guardIndex > computeIndex, 'the guard must run after `text` is computed');
  assert.ok(hiddenBranchIndex > -1 && guardIndex < hiddenBranchIndex, 'the guard must run before the DOM is touched');
  assert.match(body, /lastCcOverlayText = text;/, 'expected the guard to update lastCcOverlayText after deciding to repaint');
});

test('hideCaptionOverlay() resets lastCcOverlayText to null so a re-toggle-on always repaints', () => {
  const body = hideCaptionOverlayMatch[1];
  assert.match(body, /lastCcOverlayText = null;/);
});

test('behavioral: the idempotent guard expression skips a repeated identical text and allows a changed one', () => {
  // Executable proof of the exact guard expression pulled from source above,
  // exercised against a stand-in DOM (mirrors the FIX A behavioral test in
  // test/unit/player-hardening.test.js).
  function makeRenderer() {
    let lastCcOverlayText = null;
    const el = { hidden: true };
    const textEl = { textContent: '' };
    let paints = 0;
    return {
      render(text) {
        if (text === lastCcOverlayText) return;
        lastCcOverlayText = text;
        paints++;
        if (text) {
          textEl.textContent = text;
          el.hidden = false;
        } else {
          textEl.textContent = '';
          el.hidden = true;
        }
      },
      paints: () => paints,
      textEl,
      el,
    };
  }

  const r = makeRenderer();
  r.render('Hello there');
  r.render('Hello there'); // repeat -- must be a no-op
  r.render('Hello there'); // repeat again -- must be a no-op
  assert.strictEqual(r.paints(), 1, 'repeated identical text must only paint once');
  r.render('Second line');
  assert.strictEqual(r.paints(), 2, 'a genuinely changed text must repaint');
  assert.strictEqual(r.textEl.textContent, 'Second line');
});

// ---------------------------------------------------------------------------
// Part 2: dual cuechange binding (element AND TextTrack)
// ---------------------------------------------------------------------------

test('a shared handleCcCueChange handler exists, gated on currentData.type === "audio", reading ccTrack.track FRESH', () => {
  assert.match(PLAYER_JS, /function handleCcCueChange\(\) \{[\s\S]*?\n {4}\}/);
  const fnMatch = /function handleCcCueChange\(\) \{([\s\S]*?)\n {4}\}/.exec(PLAYER_JS);
  assert.ok(fnMatch, 'expected to find handleCcCueChange()\'s source body');
  const body = fnMatch[1];
  assert.match(body, /if \(!currentData \|\| currentData\.type !== 'audio'\) return;/);
  assert.match(body, /renderActiveCueOverlay\(ccTrack\.track\)/, 'expected a fresh (uncached) read of ccTrack.track');
});

test('handleCcCueChange is bound via cuechange on BOTH the <track> element (ccTrack) and its TextTrack object (ccTrack.track)', () => {
  assert.match(
    PLAYER_JS,
    /if \(ccTrack\) ccTrack\.addEventListener\('cuechange', handleCcCueChange\);/,
    'expected an element-level cuechange binding on ccTrack itself (survives a replaced/recreated .track object)'
  );
  assert.match(
    PLAYER_JS,
    /if \(ccTrack && ccTrack\.track\) ccTrack\.track\.addEventListener\('cuechange', handleCcCueChange\);/,
    'expected a TextTrack-level cuechange binding on ccTrack.track'
  );
});

test('the old single TextTrack-only cuechange binding pattern is gone', () => {
  assert.ok(
    !/ccTrack\.track\.addEventListener\('cuechange', function \(\) \{/.test(PLAYER_JS),
    'the pre-v1.26.4 inline single-binding (TextTrack-only, anonymous function) must be replaced by the shared handleCcCueChange bound on both targets'
  );
});

// ---------------------------------------------------------------------------
// Part 3: timeupdate fallback -- the load-bearing fix
// ---------------------------------------------------------------------------

const wireHostListenersMatch = /function wireHostListeners\(\) \{([\s\S]*?)\n {2}\}\n/.exec(PLAYER_JS);

test('wireHostListeners() exists and is isolated for inspection', () => {
  assert.ok(wireHostListenersMatch, 'expected to find wireHostListeners()\'s source body in player.js');
});

test('a timeupdate fallback is wired on mediaPlayer, gated on audioCaptionsOn AND currentData.type === "audio"', () => {
  const body = wireHostListenersMatch[1];
  const tuMatch = /mediaPlayer\.addEventListener\('timeupdate', function \(\) \{\s*\n\s*if \(!audioCaptionsOn \|\| !currentData \|\| currentData\.type !== 'audio'\) return;\s*\n\s*if \(ccTrack && ccTrack\.track\) renderActiveCueOverlay\(ccTrack\.track\);\s*\n\s*\}\);/.exec(body);
  assert.ok(tuMatch, 'expected a gated mediaPlayer timeupdate listener calling renderActiveCueOverlay(ccTrack.track)');
});

test('the timeupdate fallback is inert when captions are off, item is video, or no track exists', () => {
  // Executable proof of the exact gate expression pulled from source above.
  function shouldRender(audioCaptionsOn, currentData, ccTrack) {
    if (!audioCaptionsOn || !currentData || currentData.type !== 'audio') return false;
    return !!(ccTrack && ccTrack.track);
  }
  assert.strictEqual(shouldRender(false, { type: 'audio' }, { track: {} }), false, 'CC off must not render');
  assert.strictEqual(shouldRender(true, { type: 'video' }, { track: {} }), false, 'video items must not render via this fallback');
  assert.strictEqual(shouldRender(true, null, { track: {} }), false, 'no currentData must not render');
  assert.strictEqual(shouldRender(true, { type: 'audio' }, null), false, 'no ccTrack must not render');
  assert.strictEqual(shouldRender(true, { type: 'audio' }, { track: null }), false, 'no live TextTrack must not render');
  assert.strictEqual(shouldRender(true, { type: 'audio' }, { track: {} }), true, 'CC on + audio + a live track must render');
});

test('video CC path is untouched: the VIDEO showing/hidden toggle branch in the #cc-btn click handler is unchanged', () => {
  assert.match(
    PLAYER_JS,
    /var showing = track\.mode === 'showing';\s*\n\s*track\.mode = showing \? 'hidden' : 'showing';\s*\n\s*ccBtn\.classList\.toggle\('active', !showing\);\s*\n\s*ccBtn\.setAttribute\('aria-pressed', showing \? 'false' : 'true'\);/,
    'expected the pre-existing VIDEO branch of the #cc-btn click handler to be byte-identical'
  );
});

// ---------------------------------------------------------------------------
// Part 4 (v1.26.4 wave-2 review fix, F8): regression lock -- both
// teardown/close call sites actually invoke the reset path
// ---------------------------------------------------------------------------
//
// The tests above lock hideCaptionOverlay()'s OWN body (it resets
// lastCcOverlayText), but nothing previously asserted that the two call
// sites responsible for preventing a stale overlay from bleeding across an
// item switch -- teardownMediaState() and close() -- actually CALL it. A
// regression that silently dropped either call site (e.g. during an
// unrelated refactor of either function) would pass every test above while
// reintroducing exactly the stale-suppression bug this fix addresses.
// Bracket-matching function-body extractor, mirroring test/unit/
// v1262-sheet-modal-transitions.test.js's extractFunctionBody() helper
// (same "balance braces from the opening `{`" technique) -- needed here
// because both functions are long enough, with enough nested `if` blocks,
// that a naive "\n  }" regex (as used for the shorter functions above) risks
// matching an INNER block's closing brace rather than the function's own.
function extractFunctionBody(source, functionName) {
  const re = new RegExp(`function\\s+${functionName}\\s*\\([^)]*\\)\\s*\\{`);
  const m = re.exec(source);
  if (!m) return null;
  let depth = 1;
  let i = m.index + m[0].length;
  while (depth > 0 && i < source.length) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') depth--;
    i++;
  }
  return source.slice(m.index, i);
}

const teardownMediaStateBody = extractFunctionBody(PLAYER_JS, 'teardownMediaState');
const closeBody = extractFunctionBody(PLAYER_JS, 'close');

test('teardownMediaState() and close() are found and isolated for inspection', () => {
  assert.ok(teardownMediaStateBody, 'expected to find teardownMediaState()\'s source body in player.js');
  assert.ok(closeBody, 'expected to find close()\'s source body in player.js');
});

test('teardownMediaState() resets audioCaptionsOn AND calls hideCaptionOverlay() (outgoing media\'s overlay must never bleed into the next item)', () => {
  assert.match(teardownMediaStateBody, /audioCaptionsOn = false;\s*\n\s*hideCaptionOverlay\(\);/);
});

test('close() resets audioCaptionsOn AND calls hideCaptionOverlay() (a closed player must never leave a stale overlay for a future re-open)', () => {
  assert.match(closeBody, /audioCaptionsOn = false;\s*\n\s*hideCaptionOverlay\(\);/);
});
