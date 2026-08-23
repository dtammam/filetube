'use strict';

// [UNIT] v1.181 (Dean's settings-cleanup pass): TWO new Settings subpages -
// Troubleshooting (diagnostics) and Experimental (sharp-edged features) - as
// their own rows in a new Advanced group at the BOTTOM of the list (Dean:
// "explicitly on two separate subpages"). Everything in both is per-DEVICE
// localStorage; Dean's gating ruling: visible to everyone. This suite binds
// the MOVES: every relocated control lives in its new section and is GONE
// from its old one (ids unchanged, so the id-based wiring is untouched -
// the v1.48 wired-by-id-never-document-order rule is what makes the moves
// markup-only).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SETUP_HTML = fs.readFileSync(path.join(__dirname, '../../public/setup.html'), 'utf8');
const COMMON = fs.readFileSync(path.join(__dirname, '../../public/js/common.js'), 'utf8');

const section = (key, nextMarker) => {
  const start = SETUP_HTML.indexOf(`data-collapse-key="${key}"`);
  assert.ok(start !== -1, key + ' section exists');
  const end = nextMarker ? SETUP_HTML.indexOf(nextMarker, start) : SETUP_HTML.indexOf('</details>', start);
  return SETUP_HTML.slice(start, end === -1 ? undefined : end);
};

test('v1.181: TWO separate subpages in a new Advanced group at the bottom, both visible to everyone (no admin gating)', () => {
  assert.match(SETUP_HTML, /data-md-groups="Library,System,Account,Advanced"/, 'the Advanced group is declared LAST');
  const trouble = SETUP_HTML.match(/<details[^>]*data-collapse-key="troubleshooting"[^>]*>/)[0];
  const experimental = SETUP_HTML.match(/<details[^>]*data-collapse-key="experimental"[^>]*>/)[0];
  for (const [name, tag, icon] of [['troubleshooting', trouble, 'wrench'], ['experimental', experimental, 'flask']]) {
    assert.ok(tag.includes('data-md-group="Advanced"'), name + ' sits in the Advanced group');
    assert.ok(tag.includes(`data-md-icon="${icon}"`), name + ' carries its icon');
    assert.ok(!tag.includes('hidden') && !tag.includes('data-md-badge'), name + ' is NOT admin-gated (per-device settings only - Dean\'s ruling)');
  }
  assert.match(COMMON, /\n {2}flask: '<path/, 'the flask icon exists in MD_ICON_PATHS');
  assert.ok(SETUP_HTML.indexOf('data-collapse-key="troubleshooting"') < SETUP_HTML.indexOf('data-collapse-key="experimental"'),
    'Troubleshooting before Experimental');
  assert.ok(SETUP_HTML.indexOf('data-collapse-key="backup-restore"') < SETUP_HTML.indexOf('data-collapse-key="troubleshooting"'),
    'both sit BELOW the existing pages (after the last Account section)');
});

test('v1.181 the MOVES: each control lives in its NEW section and is GONE from its old one', () => {
  const troubleshooting = section('troubleshooting', 'data-collapse-key="experimental"');
  const experimental = section('experimental', '</details>\n      </div><!-- /.md-root -->');
  const automation = section('automation-storage', 'data-collapse-key="downloads"');
  const critters = section('critters', 'data-collapse-key="video-folders"');

  // Troubleshooting: the lifecycle debug log + the critter Voice check.
  for (const id of ['debug-lifecycle-check', 'critter-voice-check-btn', 'critter-voice-check-status']) {
    assert.ok(troubleshooting.includes(`id="${id}"`), id + ' lives in Troubleshooting');
  }
  // Experimental: the whole background-audio family + custom player.
  for (const id of ['background-audio-check', 'pre-extract-audio-check', 'bg-audio-sync-check',
    'bg-keepalive-check', 'audio-session-declare-check', 'mobile-custom-player-check']) {
    assert.ok(experimental.includes(`id="${id}"`), id + ' lives in Experimental');
  }
  // ...and none of them linger in their old homes (each id must appear
  // EXACTLY once in the whole file - moved, not duplicated).
  for (const id of ['debug-lifecycle-check', 'critter-voice-check-btn', 'background-audio-check',
    'pre-extract-audio-check', 'bg-audio-sync-check', 'bg-keepalive-check',
    'audio-session-declare-check', 'mobile-custom-player-check']) {
    assert.strictEqual(SETUP_HTML.split(`id="${id}"`).length - 1, 1, id + ' appears exactly once (moved, never duplicated)');
    assert.ok(!automation.includes(`id="${id}"`), id + ' left Automation & Storage');
    assert.ok(!critters.includes(`id="${id}"`), id + ' is not in the Critters section');
  }
  // The settled QoL settings deliberately STAYED put.
  for (const id of ['relocate-hydrated-check', 'notifications-enabled-check', 'per-page-sort-check',
    'resume-threshold-input', 'push-user-enabled-check']) {
    assert.ok(automation.includes(`id="${id}"`), id + ' stays in Automation & Storage (a settled preference, not an experiment)');
  }
});
