'use strict';

// [UNIT] Tier 2: THE VALUE AUTHORITY for the token layer. Surface-level CSS
// locks that used to pin literal px values (gap: 12px etc.) now pin token
// SPELLINGS (gap: var(--space-6)) - which is only sound if the token values
// themselves are pinned somewhere. This is that somewhere: every new-layer
// token's value, byte-exact, from the v1.1 contract. Editing a scale value
// is a RENDERING change on every consumer and must fail here loudly.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'style.css'), 'utf8');

const CONTRACT = {
  '--space-1': '2px', '--space-2': '4px', '--space-3': '6px', '--space-4': '8px',
  '--space-5': '10px', '--space-6': '12px', '--space-8': '16px', '--space-10': '20px',
  '--space-12': '24px', '--space-16': '32px',
  '--size-touch': '44px', '--size-control': '36px', '--size-control-sm': '32px',
  '--size-touch-watch-action': '39px', // v1.96: watch action-row buttons, 5px under the touch floor on mobile

  '--overlay-surface': '#222', '--overlay-border': '#444',
  '--on-overlay': '#fff', '--on-overlay-muted': '#ccc',
  '--scrim': 'rgba(0, 0, 0, 0.55)', '--scrim-heavy': 'rgba(0, 0, 0, 0.8)',
  '--fw-semibold': '600', '--fw-bold': '700', '--fw-black': '900',
  '--lh-tight': '1.25', '--lh-relaxed': '1.5',
  '--radius-full': '999px',
  '--shadow-modal': '0 8px 24px rgba(0, 0, 0, 0.45)',
  '--dur-fast': '0.15s', '--dur-slow': '0.25s', '--ease-ui': 'ease',
  '--z-nav': '900', '--z-chip': '940', '--z-dock': '950', '--z-header': '1000',
  '--z-player-max': '1100', '--z-sheet': '1500', '--z-panel': '1600',
  '--z-modal': '2000', '--z-top': '2200',
  // Tier 4 batch 4a (2026-07-31, Dean's OQ7 ruling): the media-placeholder
  // surface, ex-phantom. Joins the contract per the v1.1 addendum.
  '--thumbnail-bg': '#222',
  // Tranche F.5 (2026-07-31, Dean's ruling 2): the reading themes, the
  // reader's OWN AXIS - never era- or mode-wired. read.js derives these
  // same tokens for the epub iframe via getComputedStyle; this map is what
  // keeps that derivation honest.
  '--reader-paper-bg': '#f7f4ec', '--reader-paper-fg': '#1c1c1c',
  '--reader-sepia-bg': '#f0e3c9', '--reader-sepia-fg': '#3a2f20',
  '--reader-night-bg': '#101014', '--reader-night-fg': '#c8c8d0',
  // Tranche F.5 (Dean's ruling 4): the two structurally-coupled layout
  // constants - the NARROW amendment to "layout geometry stays literal".
  '--header-h': '56px',
  '--sidebar-w': '230px',
  // F.5 ruling 1 close-out (Dean-approved 2026-08-01): white on saturated
  // accent surfaces - the census's final family.
  '--on-accent': '#fff',
  // v1.152 master-detail menu: the group tile tones + era-reactive Appearance
  // tile tints (fixed, mode-invariant - the tile reads on both grounds), plus
  // its two layout constants (like --header-h/--sidebar-w above) and the
  // uppercase-label tracking. The value authority for the menu's look.
  '--md-graphite': '#3a3f47', '--md-steel': '#4a6178',
  '--md-era-2014': '#e62117', '--md-era-2009': '#c11a20', '--md-era-2005': '#b31217',
  '--md-tile-glyph': '#ffffff', '--md-tile-radius': '8px',
  '--md-nav-width': '250px', '--md-divider-inset': '56px',
  '--tracking-caps': '0.05em',
};

test('every new-layer token is defined EXACTLY ONCE with its contract value (mode-invariant by construction)', () => {
  assert.equal(Object.keys(CONTRACT).length, 59, 'the 38-name contract + --thumbnail-bg (Tier 4) + six --reader-* + --header-h/--sidebar-w + --on-accent (tranche F.5; --radius-lg predates the layer and lives in the era blocks) + --size-touch-watch-action (v1.96) + the ten --md-*/--tracking-caps master-detail tokens (v1.152)');
  for (const [name, value] of Object.entries(CONTRACT)) {
    const defs = [...css.matchAll(new RegExp(name.replace(/[-]/g, '\\-') + '\\s*:\\s*([^;]+);', 'g'))]
      .map((m) => m[1].trim());
    assert.equal(defs.length, 1, `${name} must have exactly one definition (era overrides would break every var-spelling lock)`);
    assert.equal(defs[0], value, `${name} value drifted from the contract`);
  }
});

// v1.70 (Dean's on-device report: "the Podcasts settings window background
// is translucent"): the root cause was `background: var(--bg-primary)` - a
// token that has NEVER existed. An undefined var() makes the whole
// declaration invalid at computed-value time, so the element renders with
// NO background, in EVERY era. Neither instrument could see it: the census
// only scans literals PRESENT in declarations, and the styling-source lock
// proves a className is BOUND, not that its variables resolve.
//
// This lock closes that blind spot for the whole stylesheet: every var()
// reference without a fallback must name a token the stylesheet actually
// defines. Comments are STRIPPED first (the v1.50 source-lock lesson - this
// file's own prose names the dead tokens, and an unstripped scan would
// flag itself).
test('v1.70: every fallback-less var() names a token the stylesheet defines (the undefined-token blind spot)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const raw = fs.readFileSync(path.join(__dirname, '../../public/css/style.css'), 'utf8');
  const css = raw.replace(/\/\*[\s\S]*?\*\//g, ''); // strip comments FIRST
  // Definitions: ';{'-anchored (an inline `:root { --a: 1; --b: 2 }` defines
  // BOTH) and case-SENSITIVE (custom properties are).
  const defined = new Set([...css.matchAll(/(?:^|[;{])\s*(--[A-Za-z0-9_-]+)\s*:/gm)].map((m) => m[1]));
  // Custom properties set from JS at runtime (never declared in CSS).
  // v1.132: --resume-countdown-duration is set inline by startResumeCountdown
  // (player.js, single-sourced from RESUME_COUNTDOWN_SECONDS) - deliberately
  // never declared in CSS so the timer and the drain can't drift.
  const jsSet = new Set(['--history-pct', '--media-aspect', '--music-sticky-top', '--ptr-pull', '--resume-countdown-duration', '--seek-fill', '--vol-fill']);
  const missing = new Set();
  // Usages: allow the whitespace shapes ordinary wrapped formatting produces
  // (`var(\n  --token\n)`, tabs, spaces) and the full custom-property
  // charset - the delta-round attack showed the first version missed five
  // shapes including plain line-wrapping, i.e. it would not have caught the
  // very bug it was written for had that line been formatted differently.
  for (const m of css.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)\s*\)/g)) { // no-fallback form only
    if (!defined.has(m[1]) && !jsSet.has(m[1])) missing.add(m[1]);
  }
  assert.deepStrictEqual([...missing].sort(), [],
    'these var() references name tokens that do not exist - the declaration silently does nothing (transparent backgrounds, missing shadows, unstyled text)');
});
