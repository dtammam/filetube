'use strict';

// [UNIT] v1.96 Wave A -- the watch-page action row (`.watch-actions`):
//   A1: (v1.96: its .btn buttons sat 5px under the 44px floor via a scoped token;
//       UI pass S3 retired that row) the bar's stacked ui-btns keep the primitive's
//       44px floor and the row reserves it.
//   A2: the row reveals ONCE in its final state -- watch.html ships it
//       `data-loading` (shimmered, all children hidden), and watch.js drops the
//       attribute only after every input the actions depend on has settled, so
//       the user never sees a partial set.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const CSS_PATH = path.join(__dirname, '..', '..', 'public', 'css', 'style.css');
const HTML_PATH = path.join(__dirname, '..', '..', 'public', 'watch.html');
const WATCH_JS_PATH = path.join(__dirname, '..', '..', 'public', 'js', 'watch.js');
const css = fs.readFileSync(CSS_PATH, 'utf8');
const html = fs.readFileSync(HTML_PATH, 'utf8');
const watchJs = fs.readFileSync(WATCH_JS_PATH, 'utf8');

// ---- A1: the bar height (UI pass S3: the stacked ui-btn floor) -----------

// UI pass sweep S3 (D4.9; converts the v1.96 A1 locks, AC12): the bar's buttons are stacked
// ui-btns (icon over a caption) whose height is the primitive's own --ctl-lg floor (44px, the
// hit area); the v1.96 39px scoped override (--size-touch-watch-action) is retired with the
// .btn row it shortened (gate r1 removed the token itself from tokens.css).
test('A1 (S3): the bar reserves the stacked button\'s 44px height; no scoped shorter override remains', () => {
  assert.match(css, /\n\.watch-actions \{[^}]*min-height: var\(--ctl-lg\);[^}]*\}/, 'the row reserves the stacked ui-btn height');
  assert.ok(!/var\(--size-touch-watch-action\)/.test(css), 'no rule reads the retired 39px knob');
  assert.match(watchJs, /const b = ui\.button\(Object\.assign\(\{ variant: 'plain', shape: 'stack' \}, o\)\);/, 'every bar button is a stacked plain ui-btn');
});

test('A1: the shorter height is SCOPED -- the global .btn keeps the v1.95 44px floor (no bare `.btn { min-height:39... }`)', () => {
  // The v1.95 global floor must still be present.
  assert.match(css, /\.btn\s*\{\s*min-height:\s*var\(--size-touch\);\s*\}/,
    'the v1.95 global `.btn { min-height: var(--size-touch) }` floor must remain');
  // And nothing may drop the BARE .btn to the shorter token (that would shrink
  // every button app-wide, not just the watch row).
  assert.doesNotMatch(css, /(?:^|\n)\s*\.btn\s*\{[^}]*min-height:\s*var\(--size-touch-watch-action\)/,
    'the shorter height must be scoped to `.watch-actions .btn`, never the bare `.btn`');
});

// ---- A2: reveal-once (no pop-in) -----------------------------------------

test('A2: watch.html ships .watch-actions with the data-loading attribute (shimmer-until-ready)', () => {
  assert.match(html, /<div class="watch-actions" id="watch-actions" role="toolbar" data-loading><\/div>/,
    'the action row must ship `data-loading` so it shimmers until the full button set is mounted');
  // The `class="watch-actions"` substring (bound by watch-sweep-s3.test.js) stays intact.
  assert.ok(html.includes('class="watch-actions"'),
    'the class="watch-actions" lock must be preserved (attribute, not a second class)');
});

test('A2: CSS hides every child of a loading row and shimmers it', () => {
  // v1.102 (tranche 4): the setup Automation toggles (`.reveal-toggle`) now
  // share this SAME reveal-once barrier via grouped selectors (one shared sweep
  // declaration, no duplicated colour literal). These `[^{]*` allowances tolerate
  // `.watch-actions[data-loading]` being one selector in a group while still
  // binding that IT wears the fill, hides its children, and reuses the sweep.
  assert.match(css, /\.watch-actions\[data-loading\]\s*>\s*\*[^{]*\{\s*visibility:\s*hidden;\s*\}/,
    'every child of a loading `.watch-actions` must be visibility:hidden (no partial button set shown)');
  const loadingRule = /\.watch-actions\[data-loading\][^{]*\{([^}]*)\}/.exec(css);
  assert.ok(loadingRule, 'expected a `.watch-actions[data-loading]` base rule');
  assert.match(loadingRule[1], /background-color:\s*var\(--surface-2\)/,
    'the loading row wears the shared skeleton fill');
  assert.match(css, /\.watch-actions\[data-loading\]::after[^{]*\{[\s\S]*?animation:\s*skeleton-sweep/,
    'the loading row reuses the shared skeleton-sweep shimmer');
});

test('A2: watch.js defines revealActionBar(), which removes data-loading', () => {
  const fn = /function revealActionBar\(\)\s*\{([\s\S]*?)\n {4}\}/.exec(watchJs);
  assert.ok(fn, 'expected a revealActionBar() helper');
  assert.match(fn[1], /removeAttribute\('data-loading'\)/,
    'revealActionBar must remove the data-loading attribute (the reveal-once effect)');
});

test('A2: the reveal is BARRIERED on all async inputs (media AND capability AND the v1.202 flag), never one alone', () => {
  // The row's final button set depends on BOTH the media record AND the write
  // capability (Move/Attribute mount from whichever resolves last), so the
  // reveal is gated on `actionMediaSettled && actionCapabilitySettled`. This is
  // a source smoke check; the BEHAVIOURAL binding (which mutation-kills a
  // reveal-on-media-alone regression and a stranded row) lives in
  // test/integration/watch-action-reveal.test.js. A bare `revealActionBar()`
  // that ignores the barrier is exactly the QA-CRITICAL-1 / adversarial-W2
  // capability-race pop-in, so assert the guarded form is present.
  // v1.202 DELIBERATE lock update: a THIRD input - the manual-attribution
  // opt-in (settings.attributeControlEnabled) - joins the barrier, because
  // Attribute mounts only once the flag is known and a late settings answer
  // popped it in after the reveal (gate finding). Settled on answer OR
  // failure, so a hung/failed settings fetch can never strand the reveal.
  assert.match(watchJs, /function maybeRevealActionBar\(\)\s*\{\s*if \(actionMediaSettled && actionCapabilitySettled && actionFlagSettled\) revealActionBar\(\);/,
    'reveal must be gated on media AND capability AND the attribution flag having settled');
  assert.strictEqual((watchJs.match(/actionFlagSettled = true;/g) || []).length, 2, 'the flag side releases on answer AND on failure');
  // Both async paths must release their side of the barrier: the media side
  // twice (success + catch), the capability side thrice (then + catch + the
  // no-fetchCurrentUser else). Deleting any release strands the reveal --
  // caught behaviourally by the integration suite.
  const mediaReleases = (watchJs.match(/actionMediaSettled = true;/g) || []).length;
  const capReleases = (watchJs.match(/actionCapabilitySettled = true;/g) || []).length;
  assert.equal(mediaReleases, 2, 'the media side releases in BOTH the success and catch paths');
  assert.equal(capReleases, 3, 'the capability side releases in the then, catch, and no-probe else paths');
});
