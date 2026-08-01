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
};

test('every new-layer token is defined EXACTLY ONCE with its contract value (mode-invariant by construction)', () => {
  assert.equal(Object.keys(CONTRACT).length, 47, 'the 38-name contract + --thumbnail-bg (Tier 4) + six --reader-* + --header-h/--sidebar-w (tranche F.5; --radius-lg predates the layer and lives in the era blocks)');
  for (const [name, value] of Object.entries(CONTRACT)) {
    const defs = [...css.matchAll(new RegExp(name.replace(/[-]/g, '\\-') + '\\s*:\\s*([^;]+);', 'g'))]
      .map((m) => m[1].trim());
    assert.equal(defs.length, 1, `${name} must have exactly one definition (era overrides would break every var-spelling lock)`);
    assert.equal(defs[0], value, `${name} value drifted from the contract`);
  }
});
