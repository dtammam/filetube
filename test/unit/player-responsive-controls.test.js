'use strict';

// [UNIT] v1.22.0 FR-1 (T2) / v1.22.1 FR-1,FR-2,FR-4 (T2) -- the
// responsive-controls CSS. Originally (v1.22.0): hiding the custom
// #player-controls bar on mobile VIDEO (native controls took over) and
// dropping the redundant volume controls on mobile AUDIO. v1.22.1 RETIRES
// the mobile-video native-controls path entirely (player.js's
// applyControlsMode() no longer ever sets the native `controls` attribute --
// see test/unit/player-form-factor.test.js's regression lock) and routes
// mobile video through this SAME custom bar, so the v1.22.0 "hide the bar
// for mobile video" rule and its DOCKED re-assert are gone; volume is now
// hidden on ALL mobile (video included, iOS ignores the `volume` property on
// any media element); and mobile AUDIO additionally hides the (dead, no
// fullscreen concept for audio) #fs-btn. Also covers the v1.22.1 FR-4
// `#speed-btn` styling and the pre-existing press-hold-2x text-selection fix
// and mute-slash centering nit. All of it reacts to the `.ff-mobile` marker
// class player.js's applyControlsMode() sets (from the SAME
// isMobileFormFactor() signal) plus the existing `.audio-mode` class --
// `.ff-mobile` is the single source of truth in CSS, per the exec plan's
// design. Visual feel is Dean's on-device iOS arbiter; this is the
// mechanical CSS-presence guard.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const CSS_PATH = path.join(__dirname, '..', '..', 'public', 'css', 'style.css');
const css = fs.readFileSync(CSS_PATH, 'utf8');

// The file has several `@media (max-width: 768px) { ... }` blocks; the one
// this suite cares about (`.player-controls`/`.pc-btn`/`#speed-btn` sizing)
// is the one immediately preceding the "v1.22/v1.22.1 FR-1" section header.
// Located by INDEX (not a `[\s\S]*?` regex spanning the whole file, which
// would non-greedily match all the way from the FIRST `@media` occurrence in
// the file to the one-and-only "v1.22/v1.22.1 FR-1" header, swallowing every
// unrelated `@media` block in between).
const FR1_SECTION_MARKER = '/* === v1.22/v1.22.1 FR-1: responsive controls';
const sectionIdx = css.indexOf(FR1_SECTION_MARKER);
const beforeSection = css.slice(0, sectionIdx);
const mobileMediaBlock = beforeSection.slice(beforeSection.lastIndexOf('@media (max-width: 768px) {'));

test('v1.22/v1.22.1 FR-1 section: a labeled section header exists', () => {
  assert.match(css, /\/\*\s*===\s*v1\.22\/v1\.22\.1 FR-1: responsive controls/);
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

// ---- v1.22.1 FR-1: the mobile-video custom-bar hide is RETIRED -------------

test('v1.22.1 FR-1: the v1.22.0 "hide the custom bar for mobile video" rule no longer exists -- mobile video now shares the always-visible custom bar', () => {
  assert.ok(
    !/#player-wrapper\.ff-mobile:not\(\.audio-mode\)\s*\.player-controls\s*\{[^}]*display:\s*none/.test(css),
    'no rule should hide .player-controls for #player-wrapper.ff-mobile:not(.audio-mode) anymore -- the native-controls path is retired (player.js)'
  );
});

test('v1.22.1 FR-1: the v1.22.0 DOCKED re-assert for mobile video is also gone (no longer needed once the bar is never hidden in FULL)', () => {
  assert.ok(
    !/#player-dock\s*#player-wrapper\.ff-mobile:not\(\.audio-mode\)\s*\.player-controls/.test(css),
    'the DOCKED-scoped mobile-video .player-controls re-show rule should be removed -- superseded by the FULL-state fix'
  );
});

test('the base (unscoped) .player-controls rule is untouched -- still visible (flex), no display:none baked in', () => {
  const rule = /(?:^|\n)\.player-controls\s*\{([^}]*)\}/.exec(css);
  assert.ok(rule, 'expected to find the base .player-controls rule');
  assert.match(rule[1], /display:\s*flex;/);
  assert.ok(!/display:\s*none/.test(rule[1]), 'the base .player-controls rule must not itself hide the bar -- only a .ff-mobile-scoped rule may');
});

// ---- volume: hidden on ALL mobile now (video included), not just audio ----

test('v1.22.1 FR-1/FR-2: #player-wrapper.ff-mobile (unscoped by .audio-mode) hides #vol-bar and #mute-btn for EVERY mobile media type (iOS ignores the volume property on video too)', () => {
  const rule = /#player-wrapper\.ff-mobile\s*#vol-bar,\s*\n#player-wrapper\.ff-mobile\s*#mute-btn\s*\{([^}]*)\}/.exec(css);
  assert.ok(rule, 'expected a rule hiding #vol-bar and #mute-btn scoped to #player-wrapper.ff-mobile (not further scoped to .audio-mode)');
  assert.match(rule[1], /display:\s*none;/);
});

// ---- v1.22.1 FR-2: mobile AUDIO additionally hides the dead #fs-btn -------

test('v1.22.1 FR-2: #player-wrapper.ff-mobile.audio-mode hides #fs-btn (dead tap -- no fullscreen concept for audio-only on iOS)', () => {
  const rule = /#player-wrapper\.ff-mobile\.audio-mode\s*#fs-btn\s*\{([^}]*)\}/.exec(css);
  assert.ok(rule, 'expected a rule hiding #fs-btn scoped to #player-wrapper.ff-mobile.audio-mode');
  assert.match(rule[1], /display:\s*none;/);
});

test('v1.22.1 FR-2: #fs-btn stays visible for mobile VIDEO and desktop -- the hide rule is scoped ONLY to .ff-mobile.audio-mode, never a bare .ff-mobile', () => {
  assert.ok(
    !/#player-wrapper\.ff-mobile\s*#fs-btn\s*\{[^}]*display:\s*none/.test(css.replace(/#player-wrapper\.ff-mobile\.audio-mode\s*#fs-btn\s*\{[^}]*\}/, '')),
    '#fs-btn must not be hidden by an unscoped (non-audio-mode) .ff-mobile rule'
  );
});

// ---- mobile touch-target sizing (v1.22.1 FR-1/FR-4): .pc-btn -> 44px ------

test('mobile .pc-btn is 44px square (bumped from the v1.21/v1.22.0 36px) -- comfortable touch target now shared by mobile video too', () => {
  const pcBtnRule = /\.pc-btn\s*\{([^}]*)\}/.exec(mobileMediaBlock);
  assert.ok(pcBtnRule, 'expected a .pc-btn rule inside the mobile @media block immediately preceding the v1.22/v1.22.1 FR-1 section');
  assert.match(pcBtnRule[1], /width:\s*44px;/);
  assert.match(pcBtnRule[1], /height:\s*44px;/);
});

// ---- FIX 2 (v1.22.1 gate round): #speed-btn trimmed from the docked bar ---

test('FIX 2: #player-dock hides #speed-btn alongside the other secondary controls (time/mute/vol/fullscreen/PiP) -- impractical at 160-280px mini-dock width', () => {
  const rule = /#player-dock\s*\.pc-time,\s*\n#player-dock\s*\.mute-btn,\s*\n#player-dock\s*\.pc-vol,\s*\n#player-dock\s*\.fs-btn,\s*\n#player-dock\s*\.pip-btn,\s*\n#player-dock\s*\.speed-btn\s*\{([^}]*)\}/.exec(css);
  assert.ok(rule, 'expected #player-dock .speed-btn to be part of the same hidden-controls group as .pc-time/.mute-btn/.pc-vol/.fs-btn/.pip-btn');
  assert.match(rule[1], /display:\s*none;/);
});

// ---- v1.22.1 FR-4: #speed-btn styling --------------------------------------

test('v1.22.1 FR-4: #speed-btn has its own rule reusing .pc-btn sizing/theming (variable-width label, no fixed square)', () => {
  const rule = /(?:^|\n)#speed-btn\s*\{([^}]*)\}/.exec(css);
  assert.ok(rule, 'expected a top-level #speed-btn rule');
  assert.match(rule[1], /width:\s*auto;/);
});

test('v1.22.1 FR-4: mobile #speed-btn keeps a >=44px touch-target floor via min-width (not a clipping fixed width)', () => {
  const rule = /#speed-btn\s*\{([^}]*)\}/.exec(mobileMediaBlock);
  assert.ok(rule, 'expected a mobile-scoped #speed-btn rule inside the @media block immediately preceding the v1.22/v1.22.1 FR-1 section');
  const minWidthMatch = /min-width:\s*(\d+(?:\.\d+)?)px/.exec(rule[1]);
  assert.ok(minWidthMatch, 'expected a `min-width: <n>px` declaration');
  assert.ok(Number(minWidthMatch[1]) >= 44, `expected mobile #speed-btn min-width >= 44px (got ${minWidthMatch[1]}px)`);
});

test('AC24: the #speed-btn rules introduce no hardcoded color values (era tokens / .pc-btn theming only)', () => {
  const rule = /(?:^|\n)#speed-btn\s*\{([^}]*)\}/.exec(css);
  assert.ok(rule, 'expected a top-level #speed-btn rule');
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(rule[1]), 'no hex colors expected in the #speed-btn rule');
  assert.ok(!/rgba?\(/.test(rule[1]), 'no rgb()/rgba() colors expected in the #speed-btn rule');
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
  // currentColor only -- no new hardcoded color introduced by the nit fix.
  assert.match(rule[1], /background-color:\s*currentColor;/);
});

test('mute-slash nit: the rotation/anchoring mechanics are otherwise unchanged (still a 45deg diagonal anchored top-left)', () => {
  const rule = /\.mute-icon-off::after\s*\{([^}]*)\}/.exec(css);
  assert.match(rule[1], /transform:\s*rotate\(45deg\);/);
  assert.match(rule[1], /transform-origin:\s*top left;/);
});

// ---- AC12: no new hardcoded colors in the v1.22/v1.22.1 FR-1 section ------

test('AC12: the v1.22/v1.22.1 FR-1 section introduces no hardcoded color values (display/user-select/transform only)', () => {
  const sectionMatch = /\/\*\s*===\s*v1\.22\/v1\.22\.1 FR-1: responsive controls[\s\S]*?(?=\n\/\*\s*===)/.exec(css);
  assert.ok(sectionMatch, 'expected to isolate the v1.22/v1.22.1 FR-1 section body');
  const body = sectionMatch[0];
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(body), 'no hex colors expected in the v1.22/v1.22.1 FR-1 section');
  assert.ok(!/rgba?\(/.test(body), 'no rgb()/rgba() colors expected in the v1.22/v1.22.1 FR-1 section');
});
