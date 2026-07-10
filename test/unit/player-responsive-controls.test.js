'use strict';

// [UNIT] v1.22.0 FR-1 (T2) / v1.22.1 FR-1,FR-2,FR-4 (T2) / mobile-native-
// controls round -- the responsive-controls CSS. Originally (v1.22.0):
// hiding the custom #player-controls bar on mobile VIDEO (native controls
// took over) and dropping the redundant volume controls on mobile AUDIO.
// v1.22.1 retired that mobile-video native-controls path entirely and routed
// mobile video through this SAME custom bar instead (the "hide the bar for
// mobile video" rule and its DOCKED re-assert are gone -- see below); volume
// is hidden on ALL mobile (video included, iOS ignores the `volume` property
// on any media element); mobile AUDIO additionally hides the (dead, no
// fullscreen concept for audio) #fs-btn. The mobile-native-controls round
// REINSTATES native controls for mobile VIDEO, but ONLY while FULL, scoped
// to a NEW, distinct `.native-controls` marker class (player.js's
// applyControlsMode()) rather than reviving the old `.ff-mobile:not(.audio-
// mode)` rule below -- so the "retired" assertions for THAT specific old
// selector still hold true (it really is gone), while a separate section
// covers the new `.native-controls`-scoped hide + the v1.23.5 bar-below
// strip revert. Also covers the v1.22.1 FR-4 `#speed-btn` styling and the
// pre-existing press-hold-2x text-selection fix and mute-slash centering
// nit. Most of it reacts to the `.ff-mobile` marker class player.js's
// applyControlsMode() sets (from the SAME isMobileFormFactor() signal) plus
// the existing `.audio-mode` class -- `.ff-mobile` is the single source of
// truth in CSS, per the exec plan's design. Visual feel is Dean's on-device
// iOS arbiter; this is the mechanical CSS-presence guard.
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

// ---- Mobile-native-controls round: the new `.native-controls`-scoped hide -

test('native-controls round: `.native-controls` hides the custom `#player-controls` bar', () => {
  const rule = /#player-wrapper\.native-controls\s+\.player-controls\s*\{([^}]*)\}/.exec(css);
  assert.ok(rule, 'expected a rule hiding .player-controls scoped to #player-wrapper.native-controls');
  assert.match(rule[1], /display:\s*none;/);
});

test('native-controls round: `.native-controls` also hides the skip/speed gesture overlays (#skip-controls, #speed-badge) so they cannot visually fight the native strip', () => {
  const skipRule = /#player-wrapper\.native-controls\s+#skip-controls\s*\{([^}]*)\}/.exec(css);
  assert.ok(skipRule, 'expected a rule hiding #skip-controls scoped to #player-wrapper.native-controls');
  assert.match(skipRule[1], /display:\s*none/);

  const speedRule = /#player-wrapper\.native-controls\s+#speed-badge\s*\{([^}]*)\}/.exec(css);
  assert.ok(speedRule, 'expected a rule hiding #speed-badge scoped to #player-wrapper.native-controls');
  assert.match(speedRule[1], /display:\s*none;/);
});

// FIX C (player-hardening round): setupForMedia() (player.js) sets an inline
// `skipControls.style.display = 'block'` on every video load, which beats an
// external rule with no `!important` -- the un-`!important`-ed rule above was
// dead in practice for #skip-controls. Locks that the suppression is actually
// effective (matches the existing `#player-dock .skip-controls` precedent).
test('FIX C: the #skip-controls native-hide rule carries `!important` so it beats setupForMedia()\'s inline `display: block`', () => {
  const skipRule = /#player-wrapper\.native-controls\s+#skip-controls\s*\{([^}]*)\}/.exec(css);
  assert.ok(skipRule, 'expected a rule hiding #skip-controls scoped to #player-wrapper.native-controls');
  assert.match(skipRule[1], /display:\s*none\s*!important;/, 'expected #skip-controls\' native-hide rule to use !important to override the inline style.display setupForMedia() sets on every load');
});

test('native-controls round: the v1.23.5 "bar-below" reserved strip is reverted for `.native-controls` (padding-bottom: 0, #media-player fills the wrapper) -- both the base rule and the max-width:768px variant', () => {
  const baseRule = /#player-wrapper:not\(\.audio-expanded\)\.native-controls\s*\{([^}]*)\}/.exec(css);
  assert.ok(baseRule, 'expected a base #player-wrapper:not(.audio-expanded).native-controls rule');
  assert.match(baseRule[1], /padding-bottom:\s*0;/);

  const baseMediaPlayerRule = /#player-wrapper:not\(\.audio-expanded\)\.native-controls\s+#media-player\s*\{([^}]*)\}/.exec(css);
  assert.ok(baseMediaPlayerRule, 'expected a base #player-wrapper:not(.audio-expanded).native-controls #media-player rule');
  assert.match(baseMediaPlayerRule[1], /aspect-ratio:\s*auto;/);
  assert.match(baseMediaPlayerRule[1], /height:\s*100%;/);

  // Both instances of the selector must appear -- one at the top level, one
  // inside a `@media (max-width: 768px)` block (belt-and-suspenders revert,
  // matching the existing fullscreen-restore pattern above).
  const allBaseRuleMatches = css.match(/#player-wrapper:not\(\.audio-expanded\)\.native-controls\s*\{/g) || [];
  assert.strictEqual(allBaseRuleMatches.length, 2, 'expected the #player-wrapper:not(.audio-expanded).native-controls rule to appear twice (base + @media (max-width: 768px))');

  const mediaBlockMatch = /@media \(max-width: 768px\)\s*\{([\s\S]*?)\n\}/g;
  let found = false;
  let m;
  while ((m = mediaBlockMatch.exec(css))) {
    if (/#player-wrapper:not\(\.audio-expanded\)\.native-controls\s*\{[^}]*padding-bottom:\s*0;/.test(m[1]) &&
        /#player-wrapper:not\(\.audio-expanded\)\.native-controls\s+#media-player\s*\{[^}]*aspect-ratio:\s*auto;[^}]*height:\s*100%;/.test(m[1])) {
      found = true;
      break;
    }
  }
  assert.ok(found, 'expected a @media (max-width: 768px) block containing the same .native-controls bar-below revert (padding-bottom: 0 + #media-player aspect-ratio:auto/height:100%)');
});

// ---- mobile touch-target sizing (v1.22.1 FR-1/FR-4): .pc-btn -> 44px ------

test('mobile .pc-btn is 44px square (bumped from the v1.21/v1.22.0 36px) -- comfortable touch target now shared by mobile video too', () => {
  const pcBtnRule = /\.pc-btn\s*\{([^}]*)\}/.exec(mobileMediaBlock);
  assert.ok(pcBtnRule, 'expected a .pc-btn rule inside the mobile @media block immediately preceding the v1.22/v1.22.1 FR-1 section');
  assert.match(pcBtnRule[1], /width:\s*44px;/);
  assert.match(pcBtnRule[1], /height:\s*44px;/);
});

// ---- FIX 2 (v1.22.1 gate round): #speed-btn trimmed from the docked bar ---

test('FIX 2: #player-dock hides #speed-btn alongside the other secondary controls (time/mute/vol/fullscreen/PiP/CC) -- impractical at 160-280px mini-dock width', () => {
  const rule = /#player-dock\s*\.pc-time,\s*\n#player-dock\s*\.mute-btn,\s*\n#player-dock\s*\.pc-vol,\s*\n#player-dock\s*\.fs-btn,\s*\n#player-dock\s*\.pip-btn,\s*\n#player-dock\s*\.speed-btn,\s*\n#player-dock\s*\.cc-btn\s*\{([^}]*)\}/.exec(css);
  assert.ok(rule, 'expected #player-dock .speed-btn AND #player-dock .cc-btn to be part of the same hidden-controls group as .pc-time/.mute-btn/.pc-vol/.fs-btn/.pip-btn');
  assert.match(rule[1], /display:\s*none;/);
});

// ---- T16 completion follow-up (v1.24 UX Round): #cc-btn trimmed too -------

test('T16 follow-up FIX 2: #player-dock hides #cc-btn (the CC toggle added by T16) -- cramped/impractical at the ~26px docked control bar height', () => {
  assert.match(css, /#player-dock\s*\.cc-btn\s*\{[^}]*display:\s*none;/, 'expected #player-dock .cc-btn to be hidden in the docked mini-player');
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
