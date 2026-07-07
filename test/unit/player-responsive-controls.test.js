'use strict';

// [UNIT] v1.22.0 FR-1 (T2) -- the responsive-controls CSS: hiding the custom
// #player-controls bar on mobile VIDEO (native controls take over), dropping
// the redundant volume controls on mobile AUDIO, the press-hold-2x
// text-selection fix, and the mute-slash centering nit. All of it reacts to
// the `.ff-mobile` marker class player.js's applyControlsMode() sets (from
// the SAME isMobileFormFactor() call that toggles the native `controls`
// attribute) plus the existing `.audio-mode` class -- `.ff-mobile` is the
// single source of truth in CSS, per the exec plan's design. Visual feel
// (AC5/AC6/AC13) is Dean's on-device iOS arbiter; this is the mechanical
// CSS-presence guard.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const CSS_PATH = path.join(__dirname, '..', '..', 'public', 'css', 'style.css');
const css = fs.readFileSync(CSS_PATH, 'utf8');

test('v1.22 FR-1 section: a labeled section header exists', () => {
  assert.match(css, /\/\*\s*===\s*v1\.22 FR-1: responsive controls/);
});

// ---- AC6: text-selection / touch-callout fix on the gesture surfaces --------

test('AC6: user-select/-webkit-touch-callout guards are applied to the gesture surfaces (#media-player, #audio-bg-art, .skip-controls, .speed-badge), not the native control strip', () => {
  const ruleRe = /#media-player,\s*\n#audio-bg-art,\s*\n\.skip-controls,\s*\n\.speed-badge\s*\{([^}]*)\}/;
  const match = ruleRe.exec(css);
  assert.ok(match, 'expected a single rule targeting #media-player, #audio-bg-art, .skip-controls, .speed-badge');
  assert.match(match[1], /user-select:\s*none;/);
  assert.match(match[1], /-webkit-user-select:\s*none;/);
  assert.match(match[1], /-webkit-touch-callout:\s*none;/);
});

// ---- AC4: mobile VIDEO hides the custom bar (mobile AUDIO keeps it) --------

test('AC4: .ff-mobile + :not(.audio-mode) hides the custom bar (mobile video only)', () => {
  const rule = /#player-wrapper\.ff-mobile:not\(\.audio-mode\)\s*\.player-controls\s*\{([^}]*)\}/.exec(css);
  assert.ok(rule, 'expected #player-wrapper.ff-mobile:not(.audio-mode) .player-controls rule');
  assert.match(rule[1], /display:\s*none;/);
});

test('AC4/desktop+mobile-audio: the base (unscoped) .player-controls rule is untouched -- still visible (flex), no display:none baked in', () => {
  const rule = /(?:^|\n)\.player-controls\s*\{([^}]*)\}/.exec(css);
  assert.ok(rule, 'expected to find the base .player-controls rule');
  assert.match(rule[1], /display:\s*flex;/);
  assert.ok(!/display:\s*none/.test(rule[1]), 'the base .player-controls rule must not itself hide the bar -- only the .ff-mobile-scoped rule may');
});

test('AC9 correction: while DOCKED, the custom bar re-appears for mobile video (play/pause + slim seek), out-specifying the FR-1 hide', () => {
  const rule = /#player-dock\s*#player-wrapper\.ff-mobile:not\(\.audio-mode\)\s*\.player-controls\s*\{([^}]*)\}/.exec(css);
  assert.ok(rule, 'expected a #player-dock #player-wrapper.ff-mobile:not(.audio-mode) .player-controls re-show rule scoped to the dock');
  assert.match(rule[1], /display:\s*flex;/);
  assert.ok(!/display:\s*none/.test(rule[1]), 'the dock re-assert must not itself hide the bar');
});

// ---- AC3/AC11: mobile AUDIO drops volume, keeps everything else -----------

test('AC3: .ff-mobile.audio-mode hides #vol-bar and #mute-btn (hardware volume buttons make them redundant on mobile)', () => {
  const rule = /#player-wrapper\.ff-mobile\.audio-mode\s*#vol-bar,\s*\n#player-wrapper\.ff-mobile\.audio-mode\s*#mute-btn\s*\{([^}]*)\}/.exec(css);
  assert.ok(rule, 'expected a rule hiding #vol-bar and #mute-btn scoped to #player-wrapper.ff-mobile.audio-mode');
  assert.match(rule[1], /display:\s*none;/);
});

test('AC11: the new v1.22 FR-1 section does not target #fs-btn (fullscreen stays on mobile audio, byte-identical to v1.21 minus volume)', () => {
  const sectionMatch = /\/\*\s*===\s*v1\.22 FR-1: responsive controls[\s\S]*?(?=\n\/\*\s*===)/.exec(css);
  assert.ok(sectionMatch, 'expected to isolate the v1.22 FR-1 section body');
  // Strip comments first -- doc prose referencing "#fs-btn remains" is fine;
  // only an actual selector targeting it would be a problem.
  const bodyNoComments = sectionMatch[0].replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/#fs-btn/.test(bodyNoComments), '#fs-btn must not be targeted by any rule in the v1.22 FR-1 section');
});

// ---- Mute-slash nit: shifted right off the original mis-centered value ----

test('mute-slash nit: .mute-icon-off::after is no longer left at the original mis-centered 1px', () => {
  const rule = /\.mute-icon-off::after\s*\{([^}]*)\}/.exec(css);
  assert.ok(rule, 'expected .mute-icon-off::after rule');
  const leftMatch = /left:\s*(-?\d+(?:\.\d+)?)px/.exec(rule[1]);
  assert.ok(leftMatch, 'expected a `left: <n>px` declaration on .mute-icon-off::after');
  const leftValue = Number(leftMatch[1]);
  assert.notStrictEqual(leftValue, 1, 'left should have moved off the original mis-centered 1px value');
  assert.ok(leftValue > 1 && leftValue <= 8, `expected the slash to shift RIGHT toward the glyph center (got left: ${leftValue}px)`);
  // currentColor only -- no new hardcoded color introduced by the nit fix (AC12).
  assert.match(rule[1], /background-color:\s*currentColor;/);
});

test('mute-slash nit: the rotation/anchoring mechanics are otherwise unchanged (still a 45deg diagonal anchored top-left)', () => {
  const rule = /\.mute-icon-off::after\s*\{([^}]*)\}/.exec(css);
  assert.match(rule[1], /transform:\s*rotate\(45deg\);/);
  assert.match(rule[1], /transform-origin:\s*top left;/);
});

// ---- AC12: no new hardcoded colors in the new section ----------------------

test('AC12: the new v1.22 FR-1 section introduces no hardcoded color values (display/user-select/transform only)', () => {
  const sectionMatch = /\/\*\s*===\s*v1\.22 FR-1: responsive controls[\s\S]*?(?=\n\/\*\s*===)/.exec(css);
  assert.ok(sectionMatch, 'expected to isolate the v1.22 FR-1 section body');
  const body = sectionMatch[0];
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(body), 'no hex colors expected in the v1.22 FR-1 section');
  assert.ok(!/rgba?\(/.test(body), 'no rgb()/rgba() colors expected in the v1.22 FR-1 section');
});
